/**
 * Main entry point for the AI CLI.
 */

import { createInterface } from "node:readline";
import { modelsAreEqual } from "#ai/index.js";
import chalk from "chalk";
import { type Args, type Mode, parseArgs, printHelp } from "./args.js";
import { processFileArguments } from "./file-processor.js";
import { buildInitialMessage } from "./initial-message.js";
import { listModels } from "./list-models.js";
import { selectSession } from "./session-picker.js";
import { getAgentDir, VERSION } from "../config.js";
import { createAgentSessionRuntime } from "../agent/agent-session-runtime.js";
import {
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../session/agent-session-services.js";
import { AuthStorage } from "../session/auth-storage.js";
import type { ModelRegistry } from "../session/model-registry.js";
import { resolveCliModel, resolveModelScope, type ScopedModel } from "../session/model-resolver.js";
import { SessionManager } from "../session/session-manager.js";
import { SettingsManager } from "../session/settings-manager.js";
import { InteractiveMode } from "./interactive-mode.js";
import { runPrintMode } from "./print-mode.js";
import { runRpcMode } from "./rpc/rpc-mode.js";
import { initTheme, stopThemeWatcher } from "./interactive/theme/theme.js";

/**
 * Read all content from piped stdin.
 */
async function readPipedStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => { data += chunk; });
		process.stdin.on("end", () => { resolve(data.trim() || undefined); });
		process.stdin.resume();
	});
}

function collectSettingsDiagnostics(
	settingsManager: SettingsManager,
	context: string,
): AgentSessionRuntimeDiagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${context}, ${scope} settings) ${error.message}`,
	}));
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
		const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}

type AppMode = "interactive" | "print" | "json" | "rpc";

function resolveAppMode(parsed: Args, stdinIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") return "rpc";
	if (parsed.mode === "json") return "json";
	if (parsed.print || !stdinIsTTY) return "print";
	return "interactive";
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: any[]; // Simplified
}> {
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}
	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images as any,
		stdinContent,
	});
}

async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string) {
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path" as const, path: sessionArg };
	}
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatches = localSessions.filter((s) => s.id.startsWith(sessionArg));
	if (localMatches.length >= 1) return { type: "local" as const, path: localMatches[0].path };
	const allSessions = await SessionManager.listAll();
	const globalMatches = allSessions.filter((s) => s.id.startsWith(sessionArg));
	if (globalMatches.length >= 1) return { type: "global" as const, path: globalMatches[0].path, cwd: globalMatches[0].cwd };
	return { type: "not_found" as const, arg: sessionArg };
}

async function promptConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.noSession) return SessionManager.inMemory();
	if (parsed.fork) {
		const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);
		if (resolved.type !== "not_found") return SessionManager.forkFrom(resolved.path, cwd, sessionDir);
		console.error(chalk.red(`No session found matching '${parsed.fork}'`));
		process.exit(1);
	}
	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);
		if (resolved.type === "path" || resolved.type === "local") return SessionManager.open(resolved.path, sessionDir);
		if (resolved.type === "global") {
			console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
			if (await promptConfirm("Fork this session into current directory?")) {
				return SessionManager.forkFrom(resolved.path, cwd, sessionDir);
			}
			process.exit(0);
		}
		console.error(chalk.red(`No session found matching '${parsed.session}'`));
		process.exit(1);
	}
	if (parsed.resume) {
		initTheme(settingsManager.getTheme(), true);
		try {
			const selectedPath = await selectSession(
				(onProgress) => SessionManager.list(cwd, sessionDir, onProgress),
				SessionManager.listAll,
			);
			if (!selectedPath) process.exit(0);
			return SessionManager.open(selectedPath, sessionDir);
		} finally {
			stopThemeWatcher();
		}
	}
	if (parsed.continue) return SessionManager.continueRecent(cwd, sessionDir);
	return SessionManager.create(cwd, sessionDir);
}

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	hasExistingSession: boolean,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
) {
	const options: any = {};
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	let cliThinkingFromModel = false;

	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			modelRegistry,
		});
		if (resolved.warning) diagnostics.push({ type: "warning", message: resolved.warning });
		if (resolved.error) diagnostics.push({ type: "error", message: resolved.error });
		if (resolved.model) {
			options.model = resolved.model;
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;
		if (savedInScope) {
			options.model = savedInScope.model;
			if (!parsed.thinking && savedInScope.thinkingLevel) options.thinkingLevel = savedInScope.thinkingLevel;
		} else {
			options.model = scopedModels[0].model;
			if (!parsed.thinking && scopedModels[0].thinkingLevel) options.thinkingLevel = scopedModels[0].thinkingLevel;
		}
	}

	if (parsed.thinking) options.thinkingLevel = parsed.thinking;
	if (scopedModels.length > 0) {
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel,
		}));
	}

	if (parsed.noTools) {
		options.noTools = "all";
	}
	if (parsed.tools) {
		options.tools = [...parsed.tools];
	}

	return { options, cliThinkingFromModel, diagnostics };
}

export async function main(args: string[]) {
	const parsed = parseArgs(args);
	if (parsed.help) {
		printHelp();
		process.exit(0);
	}

	if (parsed.diagnostics.length > 0) {
		for (const diagnostic of parsed.diagnostics) {
			const color = diagnostic.type === "error" ? chalk.red : chalk.yellow;
			const prefix = diagnostic.type === "error" ? "Error: " : "Warning: ";
			console.error(color(`${prefix}${diagnostic.message}`));
		}
		if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
			process.exit(1);
		}
	}

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	const sessionDir = parsed.sessionDir ?? startupSettingsManager.getSessionDir();
	
	let appMode = resolveAppMode(parsed, process.stdin.isTTY);
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	
	const authStorage = AuthStorage.create();
	const runtime = await createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			resourceLoaderOptions: {
				additionalExtensionPaths: parsed.extensions,
				additionalSkillPaths: parsed.skills,
				additionalPromptTemplatePaths: parsed.promptTemplates,
				additionalThemePaths: parsed.themes,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
			},
			extensionFlagValues: parsed.unknownFlags,
		});
		
		const { settingsManager, modelRegistry } = services;
		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels = modelPatterns ? await resolveModelScope(modelPatterns, modelRegistry) : [];
		
		const { options: sessionOptions, diagnostics } = buildSessionOptions(
			parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRegistry,
			settingsManager
		);
		
		if (parsed.apiKey && sessionOptions.model) {
			authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			noTools: sessionOptions.noTools,
		});

		return { ...created, services, diagnostics };
	}, { cwd, agentDir, sessionManager });

	const { session, modelFallbackMessage } = runtime;
	const { settingsManager, modelRegistry } = runtime.services;
	const runtimeDiagnostics = [...runtime.services.diagnostics, ...(runtime.diagnostics ?? [])];
	if (runtimeDiagnostics.length > 0) {
		reportDiagnostics(runtimeDiagnostics);
		if (runtimeDiagnostics.some((diagnostic) => diagnostic.type === "error")) {
			process.exit(1);
		}
	}

	if (parsed.listModels) {
		await listModels(modelRegistry, typeof parsed.listModels === "string" ? parsed.listModels : undefined);
		process.exit(0);
	}

	let stdinContent = await readPipedStdin();
	if (stdinContent !== undefined && appMode === "interactive") appMode = "print";

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, settingsManager.getImageAutoResize(), stdinContent);
	
	initTheme(settingsManager.getTheme(), appMode === "interactive");

	if (appMode === "rpc") {
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		const interactiveMode = new InteractiveMode(runtime as any, {
			modelFallbackMessage,
			initialMessage,
			initialImages: initialImages as any,
			initialMessages: parsed.messages,
			verbose: parsed.verbose,
		});
		await interactiveMode.run();
	} else {
		const exitCode = await runPrintMode(runtime as any, {
			mode: toPrintOutputMode(appMode),
			messages: parsed.messages,
			initialMessage,
			initialImages: initialImages as any,
		});
		process.exit(exitCode);
	}
}

main(process.argv.slice(2)).catch((error) => {
	console.error(error);
	process.exit(1);
});
