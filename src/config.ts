import { existsSync, readFileSync } from "fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

export const isBunRuntime = !!(globalThis as any).Bun;

export function getPackageDir(): string {
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return __dirname;
}

export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));

export const PACKAGE_NAME: string = pkg.name || "teyol";
export const APP_NAME: string = pkg.teyolConfig?.name || "teyol";
export const APP_TITLE: string = pkg.teyolConfig?.title || pkg.teyolConfig?.name || "Teyol";
export const CONFIG_DIR_NAME: string = pkg.teyolConfig?.configDir || ".teyol";
export const VERSION: string = pkg.version || "0.0.0";

export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_AGENT_DIR`;

export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

export function getBinDir(): string {
	return join(getPackageDir(), "bin");
}

export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

export function getThemesDir(): string {
	return join(getPackageDir(), "theme");
}

export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

export function getLogPath(): string {
	return join(getAgentDir(), "teyol.log");
}

export function isDevMode(): boolean {
	return process.env.ENVIRONMENT === "dev";
}

export function getShareViewerUrl(): string {
	return "";
}
