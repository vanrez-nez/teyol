import { createEvent, createStore } from "effector";
import type { LogLevel, LogMode } from "#logger";
import type {
	BranchSummarySettings,
	CompactionSettings,
	ImageSettings,
	PackageSource,
	ProviderRetrySettings,
	RetrySettings,
	Settings,
	TerminalSettings,
	ThinkingBudgetsSettings,
	TransportSetting,
	WarningSettings,
} from "#shell/runtime/settings-manager.js";
import type { ShellDiagnostic } from "./diagnostics.js";
import { homedir } from "node:os";
import { join } from "node:path";

export type SettingsStatus = "idle" | "ready" | "error";

export interface SettingsValues {
	raw: Settings;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	transport: TransportSetting;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	theme?: string;
	compaction: Required<CompactionSettings>;
	branchSummary: Required<BranchSummarySettings>;
	retry: Required<Omit<RetrySettings, "provider">> & { provider: Required<Pick<ProviderRetrySettings, "maxRetryDelayMs">> & ProviderRetrySettings };
	hideThinkingBlock: boolean;
	shellPath?: string;
	quietStartup: boolean;
	shellCommandPrefix?: string;
	npmCommand?: string[];
	enableInstallTelemetry: boolean;
	packages: PackageSource[];
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
	enableSkillCommands: boolean;
	thinkingBudgets?: ThinkingBudgetsSettings;
	terminal: Required<TerminalSettings>;
	images: Required<ImageSettings>;
	enabledModels?: string[];
	doubleEscapeAction: "fork" | "tree" | "none";
	treeFilterMode: "default" | "no-tools" | "user-only" | "labeled-only" | "all";
	showHardwareCursor: boolean;
	editorPaddingX: number;
	autocompleteMaxVisible: number;
	codeBlockIndent: string;
	warnings: WarningSettings;
	sessionDir?: string;
	log: { enabled: boolean; mode: LogMode; rotation_lines: number; level: LogLevel[] };
}

export interface SettingsState {
	status: SettingsStatus;
	values: SettingsValues;
	diagnostics: ShellDiagnostic[];
}

const LOG_LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warning", "error"];

function resolveSessionDir(sessionDir: string | undefined): string | undefined {
	if (!sessionDir) return sessionDir;
	if (sessionDir === "~") return homedir();
	if (sessionDir.startsWith("~/")) return join(homedir(), sessionDir.slice(2));
	return sessionDir;
}

function resolveImageWidth(width: number | undefined): number {
	if (typeof width !== "number" || !Number.isFinite(width)) return 60;
	return Math.max(1, Math.floor(width));
}

function resolveTreeFilterMode(mode: Settings["treeFilterMode"]): SettingsValues["treeFilterMode"] {
	const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
	return mode && valid.includes(mode) ? mode : "default";
}

function resolveLogLevels(stored: LogLevel[] | undefined): LogLevel[] {
	if (!stored || stored.length === 0) return ["info"];
	const valid = stored.filter((level): level is LogLevel => LOG_LEVELS.includes(level));
	return valid.length > 0 ? valid : ["info"];
}

export function resolveSettingsValues(settings: Settings): SettingsValues {
	const raw = structuredClone(settings);
	return {
		raw,
		defaultProvider: settings.defaultProvider,
		defaultModel: settings.defaultModel,
		defaultThinkingLevel: settings.defaultThinkingLevel,
		transport: settings.transport ?? "sse",
		steeringMode: settings.steeringMode || "one-at-a-time",
		followUpMode: settings.followUpMode || "one-at-a-time",
		theme: settings.theme,
		compaction: {
			enabled: settings.compaction?.enabled ?? true,
			reserveTokens: settings.compaction?.reserveTokens ?? 16384,
			keepRecentTokens: settings.compaction?.keepRecentTokens ?? 20000,
		},
		branchSummary: {
			reserveTokens: settings.branchSummary?.reserveTokens ?? 16384,
			skipPrompt: settings.branchSummary?.skipPrompt ?? false,
		},
		retry: {
			enabled: settings.retry?.enabled ?? true,
			maxRetries: settings.retry?.maxRetries ?? 3,
			baseDelayMs: settings.retry?.baseDelayMs ?? 2000,
			provider: {
				timeoutMs: settings.retry?.provider?.timeoutMs,
				maxRetries: settings.retry?.provider?.maxRetries,
				maxRetryDelayMs: settings.retry?.provider?.maxRetryDelayMs ?? 60000,
			},
		},
		hideThinkingBlock: settings.hideThinkingBlock ?? false,
		shellPath: settings.shellPath,
		quietStartup: settings.quietStartup ?? false,
		shellCommandPrefix: settings.shellCommandPrefix,
		npmCommand: settings.npmCommand ? [...settings.npmCommand] : undefined,
		enableInstallTelemetry: settings.enableInstallTelemetry ?? true,
		packages: [...(settings.packages ?? [])],
		extensions: [...(settings.extensions ?? [])],
		skills: [...(settings.skills ?? [])],
		prompts: [...(settings.prompts ?? [])],
		themes: [...(settings.themes ?? [])],
		enableSkillCommands: settings.enableSkillCommands ?? true,
		thinkingBudgets: settings.thinkingBudgets,
		terminal: {
			showImages: settings.terminal?.showImages ?? true,
			imageWidthCells: resolveImageWidth(settings.terminal?.imageWidthCells),
			clearOnShrink: settings.terminal?.clearOnShrink ?? process.env.TEYOL_CLEAR_ON_SHRINK === "1",
			showTerminalProgress: settings.terminal?.showTerminalProgress ?? false,
		},
		images: {
			autoResize: settings.images?.autoResize ?? true,
			blockImages: settings.images?.blockImages ?? false,
		},
		enabledModels: settings.enabledModels ? [...settings.enabledModels] : undefined,
		doubleEscapeAction: settings.doubleEscapeAction ?? "tree",
		treeFilterMode: resolveTreeFilterMode(settings.treeFilterMode),
		showHardwareCursor: settings.showHardwareCursor ?? process.env.TEYOL_HARDWARE_CURSOR === "1",
		editorPaddingX: settings.editorPaddingX ?? 0,
		autocompleteMaxVisible: settings.autocompleteMaxVisible ?? 5,
		codeBlockIndent: settings.markdown?.codeBlockIndent ?? "  ",
		warnings: { ...(settings.warnings ?? {}) },
		sessionDir: resolveSessionDir(settings.sessionDir),
		log: {
			enabled: settings.log?.enabled ?? false,
			mode: settings.log?.mode ?? "app",
			rotation_lines: settings.log?.rotation_lines ?? 10000,
			level: resolveLogLevels(settings.log?.level),
		},
	};
}

const initialState: SettingsState = {
	status: "idle",
	values: resolveSettingsValues({}),
	diagnostics: [],
};

export const settingsReady = createEvent<{ values: SettingsValues }>();
export const settingsChanged = createEvent<{ values: SettingsValues }>();
export const settingsFailed = createEvent<{ diagnostics: ShellDiagnostic[] }>();

export const $settings = createStore<SettingsState>(initialState)
	.on(settingsReady, (_, payload) => ({
		status: "ready",
		values: payload.values,
		diagnostics: [],
	}))
	.on(settingsChanged, (state, payload) => ({
		...state,
		values: payload.values,
	}))
	.on(settingsFailed, (state, payload) => ({
		status: "error",
		values: state.values,
		diagnostics: payload.diagnostics,
	}));
