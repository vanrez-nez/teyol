import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	statSync,
	writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "./config.js";

export type LogLevel = "debug" | "info" | "warning" | "error";

export const LOG_LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warning", "error"];

export type LogMode = "session" | "app";

export interface LogRecord {
	ts: string;
	level: LogLevel;
	message: string;
	data?: unknown;
}

interface LogSettings {
	enabled: boolean;
	mode: LogMode;
	rotationLines: number;
	levels: LogLevel[];
	sessionDir?: string;
}

interface LoggerState {
	settingsLoaded: boolean;
	enabled: boolean;
	levels: Set<LogLevel>;
	path: string;
	rotationLines: number;
	lineCount: number;
	fd: number | undefined;
	writeFailed: boolean;
}

const SECRET_KEY_PATTERN =
	/api[_-]?key|authorization|bearer|^token$|^cookie$|set-cookie|secret|password|access[_-]?token|refresh[_-]?token|x-api-key/i;

const MAX_STRING_BYTES = 4 * 1024;
const STRING_KEEP_PREFIX = 256;
const BASE64_MIN_LENGTH = 256;
const BASE64_PATTERN = /^[A-Za-z0-9+/=\r\n]+$/;
const FULL_STRING_DEBUG_MESSAGES = new Set(["llm.request.context", "llm.response.full"]);

let state: LoggerState = {
	settingsLoaded: false,
	enabled: false,
	levels: new Set(["info"]),
	path: join(getAgentDir(), "teyol.log"),
	rotationLines: 10000,
	lineCount: 0,
	fd: undefined,
	writeFailed: false,
};

function getCurrentAgentDir(): string {
	return getAgentDir();
}

function getSettingsPath(): string {
	return join(getCurrentAgentDir(), "settings.json");
}

function getAppLogPath(): string {
	return join(getCurrentAgentDir(), "teyol.log");
}

function resolveConfiguredPath(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return value;
}

function resolvePath(mode: LogMode, sessionDir: string | undefined): string {
	if (mode === "session") {
		return join(sessionDir ?? join(getCurrentAgentDir(), "sessions"), "teyol.log");
	}
	return getAppLogPath();
}

function readSettings(): LogSettings {
	if (!existsSync(getSettingsPath())) {
		return {
			enabled: false,
			mode: "app",
			rotationLines: 10000,
			levels: ["info"],
		};
	}

	try {
		const settings = JSON.parse(readFileSync(getSettingsPath(), "utf-8")) as {
			log?: {
				enabled?: boolean;
				mode?: LogMode;
				rotation_lines?: number;
				level?: LogLevel[];
			};
			sessionDir?: string;
		};
		const log = settings.log ?? {};
		const levels = Array.isArray(log.level)
			? log.level.filter((level): level is LogLevel => (LOG_LEVELS as ReadonlyArray<string>).includes(level))
			: [];
		return {
			enabled: log.enabled ?? false,
			mode: log.mode === "session" ? "session" : "app",
			rotationLines:
				typeof log.rotation_lines === "number" && Number.isFinite(log.rotation_lines)
					? Math.max(0, Math.floor(log.rotation_lines))
					: 10000,
			levels: levels.length > 0 ? levels : ["info"],
			sessionDir: resolveConfiguredPath(settings.sessionDir),
		};
	} catch {
		return {
			enabled: false,
			mode: "app",
			rotationLines: 10000,
			levels: ["info"],
		};
	}
}

function countLines(path: string): number {
	if (!existsSync(path)) return 0;
	try {
		const content = readFileSync(path, "utf-8");
		if (!content) return 0;
		let count = 0;
		for (let i = 0; i < content.length; i++) {
			if (content.charCodeAt(i) === 10) count++;
		}
		if (content.length > 0 && content.charCodeAt(content.length - 1) !== 10) {
			count++;
		}
		return count;
	} catch {
		return 0;
	}
}

function ensureFd(): number | undefined {
	if (state.fd !== undefined) return state.fd;
	try {
		mkdirSync(dirname(state.path), { recursive: true });
		state.fd = openSync(state.path, "a");
		return state.fd;
	} catch (err) {
		reportWriteError(err);
		return undefined;
	}
}

function closeFd(): void {
	if (state.fd !== undefined) {
		try {
			closeSync(state.fd);
		} catch {
			// best-effort
		}
		state.fd = undefined;
	}
}

function rotateIfNeeded(): void {
	if (state.rotationLines <= 0) return;
	if (state.lineCount < state.rotationLines) return;
	closeFd();
	try {
		if (existsSync(state.path)) {
			const rolled = `${state.path}.1`;
			if (existsSync(rolled)) {
				try {
					const fd = openSync(rolled, "w");
					closeSync(fd);
				} catch {
					// ignore
				}
			}
			renameSync(state.path, rolled);
		}
	} catch (err) {
		reportWriteError(err);
	}
	state.lineCount = 0;
}

function reportWriteError(err: unknown): void {
	if (state.writeFailed) return;
	state.writeFailed = true;
	try {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[logger] write failed (suppressing further errors): ${msg}`);
	} catch {
		// ignore
	}
}

function writeRecord(record: LogRecord): void {
	const fd = ensureFd();
	if (fd === undefined) return;
	try {
		const line = `${JSON.stringify(record)}\n`;
		writeSync(fd, line);
		state.lineCount++;
		rotateIfNeeded();
	} catch (err) {
		reportWriteError(err);
		closeFd();
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeBase64(value: string): boolean {
	if (value.length < BASE64_MIN_LENGTH) return false;
	return BASE64_PATTERN.test(value);
}

function redactString(value: string): string {
	const byteLen = Buffer.byteLength(value, "utf-8");
	if (looksLikeBase64(value)) {
		return `[REDACTED base64 ${byteLen} bytes]`;
	}
	if (byteLen > MAX_STRING_BYTES) {
		return `${value.slice(0, STRING_KEEP_PREFIX)}…[truncated ${byteLen} bytes]`;
	}
	return value;
}

function redactStringFull(value: string): string {
	const byteLen = Buffer.byteLength(value, "utf-8");
	if (looksLikeBase64(value)) {
		return `[REDACTED base64 ${byteLen} bytes]`;
	}
	return value;
}

function redactValue(value: unknown, depth: number, fullStrings: boolean): unknown {
	if (depth > 20) return "[REDACTED depth-limit]";
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return fullStrings ? redactStringFull(value) : redactString(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
	if (value instanceof Error) {
		return {
			name: value.name,
			message: fullStrings ? redactStringFull(value.message) : redactString(value.message),
			stack: value.stack ? (fullStrings ? redactStringFull(value.stack) : redactString(value.stack)) : undefined,
		};
	}
	if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
		return `[REDACTED binary ${value.length} bytes]`;
	}
	if (value instanceof Uint8Array) {
		return `[REDACTED binary ${value.byteLength} bytes]`;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, depth + 1, fullStrings));
	}
	if (typeof (value as { entries?: unknown }).entries === "function" && !isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		try {
			for (const [k, v] of (value as Iterable<[string, unknown]>) as Iterable<[string, unknown]>) {
				out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redactValue(v, depth + 1, fullStrings);
			}
			return out;
		} catch {
			// fall through
		}
	}
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redactValue(v, depth + 1, fullStrings);
		}
		return out;
	}
	return String(value);
}

export function redact(value: unknown, depth = 0): unknown {
	return redactValue(value, depth, false);
}

function applySettings(settings: LogSettings): void {
	const newPath = resolvePath(settings.mode, settings.sessionDir);
	const pathChanged = newPath !== state.path;
	if (pathChanged) {
		closeFd();
	}
	state.path = newPath;
	state.rotationLines = settings.rotationLines;
	state.levels = new Set(settings.levels);
	state.enabled = settings.enabled;
	state.writeFailed = false;
	state.settingsLoaded = true;
	if (state.enabled) {
		try {
			mkdirSync(dirname(state.path), { recursive: true });
		} catch (err) {
			reportWriteError(err);
		}
		state.lineCount = countLines(state.path);
	} else {
		closeFd();
	}
}

function ensureSettingsLoaded(): void {
	if (state.settingsLoaded) return;
	applySettings(readSettings());
}

function log(level: LogLevel, message: string, data?: unknown): void {
	ensureSettingsLoaded();
	if (!state.enabled) return;
	if (!state.levels.has(level)) return;
	const fullStrings = level === "debug" && FULL_STRING_DEBUG_MESSAGES.has(message);
	writeRecord({
		ts: new Date().toISOString(),
		level,
		message,
		data: data === undefined ? undefined : redactValue(data, 0, fullStrings),
	});
}

export const logger = {
	debug(message: string, data?: unknown): void {
		log("debug", message, data);
	},
	info(message: string, data?: unknown): void {
		log("info", message, data);
	},
	warning(message: string, data?: unknown): void {
		log("warning", message, data);
	},
	error(message: string, data?: unknown): void {
		log("error", message, data);
	},
	reloadConfig(): void {
		applySettings(readSettings());
	},
	isEnabled(): boolean {
		ensureSettingsLoaded();
		return state.enabled;
	},
	getFilePath(): string {
		ensureSettingsLoaded();
		return state.path;
	},
	readTail(maxLines = 200): string {
		ensureSettingsLoaded();
		if (!existsSync(state.path)) return "";
		try {
			const stat = statSync(state.path);
			const readBytes = Math.min(stat.size, 256 * 1024);
			const buf = Buffer.alloc(readBytes);
			const fd = openSync(state.path, "r");
			try {
				const start = Math.max(0, stat.size - readBytes);
				readSync(fd, buf, 0, readBytes, start);
			} finally {
				closeSync(fd);
			}
			const text = buf.toString("utf-8");
			const lines = text.split("\n").filter((line) => line.length > 0);
			return lines.slice(-maxLines).join("\n");
		} catch {
			return "";
		}
	},
	shutdown(): void {
		closeFd();
	},
};

export const _internal = {
	getState: () => state,
	resetForTests: () => {
		closeFd();
		state = {
			settingsLoaded: false,
			enabled: false,
			levels: new Set(["info"]),
			path: getAppLogPath(),
			rotationLines: 10000,
			lineCount: 0,
			fd: undefined,
			writeFailed: false,
		};
	},
};
