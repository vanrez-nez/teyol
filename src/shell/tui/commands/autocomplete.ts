import type { AutocompleteItem, AutocompleteProvider, SlashCommand } from "#tui/index.js";
import { CombinedAutocompleteProvider } from "#tui/index.js";
import type { ExtensionRunner } from "#shell/runtime/extensions/index.js";
import type { ResourceDiagnostic } from "#shell/runtime/resource-loader.js";
import { BUILTIN_SLASH_COMMANDS } from "#shell/runtime/slash-commands.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import type { Skill } from "#shell/runtime/skills.js";
import type { PromptTemplate } from "#shell/runtime/prompt-templates.js";
import { isDevMode } from "../../../config.js";
import type { LogAction } from "../components/log-action-selector.js";
import type { ModelAction } from "../components/model-actions-selector.js";
import type { SessionAction } from "../components/session-actions-selector.js";

export interface BuildAutocompleteInput {
	promptTemplates: ReadonlyArray<PromptTemplate>;
	skills: ReadonlyArray<Skill>;
	enableSkillCommands: boolean;
	extensionRunner: ExtensionRunner;
	cwd: string;
	fdPath?: string;
	getModelArgumentCompletions(prefix: string, valuePrefix?: string): AutocompleteItem[] | null;
}

export interface BuildAutocompleteResult {
	provider: AutocompleteProvider;
	skillCommands: Map<string, string>;
}

function getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
	if (!sourceInfo) {
		return undefined;
	}

	const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
	const source = sourceInfo.source.trim();

	if (source === "auto" || source === "local" || source === "cli") {
		return scopePrefix;
	}

	if (source.startsWith("npm:")) {
		return `${scopePrefix}:${source}`;
	}

	return scopePrefix;
}

function prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
	const sourceTag = getAutocompleteSourceTag(sourceInfo);
	if (!sourceTag) {
		return description;
	}
	return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
}

export function getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
	const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
	return extensionRunner
		.getRegisteredCommands()
		.filter((command) => builtinNames.has(command.name))
		.map((command) => ({
			type: "warning" as const,
			message:
				command.invocationName === command.name
					? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
					: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
			path: command.sourceInfo.path,
		}));
}

export function buildAutocomplete(input: BuildAutocompleteInput): BuildAutocompleteResult {
	const devMode = isDevMode();
	const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS
		.filter((command) => command.name !== "log" || devMode)
		.map((command) => ({
			name: command.name,
			description: command.description,
		}));

	const logCommand = slashCommands.find((command) => command.name === "log");
	if (logCommand) {
		const logActions: Array<{ value: LogAction; description: string }> = [
			{ value: "view", description: "Show the current log file path and tail" },
			{ value: "enable", description: "Start writing log entries" },
			{ value: "disable", description: "Stop writing log entries" },
			{ value: "mode", description: "Choose between app and session log files" },
			{ value: "rotation_lines", description: "Set rotation line threshold (0 disables)" },
			{ value: "level", description: "Choose which severity levels are written" },
		];
		logCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const normalizedPrefix = prefix.trimStart().toLowerCase();
			const filtered = logActions.filter((action) => action.value.startsWith(normalizedPrefix));
			if (filtered.length === 0) return null;
			return filtered.map((action) => ({
				value: action.value,
				label: action.value,
				description: action.description,
			}));
		};
	}

	const modelCommand = slashCommands.find((command) => command.name === "model");
	if (modelCommand) {
		modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const normalizedPrefix = prefix.trimStart();
			const lowerPrefix = normalizedPrefix.toLowerCase();
			const modelActions: Array<{ value: ModelAction; description: string }> = [
				{ value: "select", description: "Choose the active model" },
				{ value: "fast-cycle", description: "Configure models for Ctrl+P cycling" },
			];

			if (lowerPrefix.startsWith("select ")) {
				return input.getModelArgumentCompletions(normalizedPrefix.slice("select ".length), "select ");
			}

			const actionCompletions = modelActions
				.filter((action) => action.value.startsWith(lowerPrefix))
				.map((action) => ({
					value: action.value,
					label: action.value,
					description: action.description,
				}));
			const modelCompletions = input.getModelArgumentCompletions(normalizedPrefix) ?? [];
			const completions = [...actionCompletions, ...modelCompletions];
			return completions.length > 0 ? completions : null;
		};
	}

	const sessionCommand = slashCommands.find((command) => command.name === "session");
	if (sessionCommand) {
		const sessionActions: Array<{ value: SessionAction; description: string }> = [
			{ value: "info", description: "Show current session info and stats" },
			{ value: "new", description: "Start a new session" },
			{ value: "resume", description: "Resume a different session" },
			{ value: "compact", description: "Manually compact session context" },
			{ value: "tree", description: "Navigate session tree" },
			{ value: "clone", description: "Duplicate current session position" },
			{ value: "fork", description: "Fork from a previous user message" },
		];
		sessionCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const normalizedPrefix = prefix.trimStart().toLowerCase();
			const filtered = sessionActions.filter((action) => action.value.startsWith(normalizedPrefix));
			if (filtered.length === 0) return null;
			return filtered.map((action) => ({
				value: action.value,
				label: action.value,
				description: action.description,
			}));
		};
	}

	const templateCommands: SlashCommand[] = input.promptTemplates.map((cmd) => ({
		name: cmd.name,
		description: prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
		...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
	}));

	const builtinCommandNames = new Set(slashCommands.map((command) => command.name));
	const extensionCommands: SlashCommand[] = input.extensionRunner
		.getRegisteredCommands()
		.filter((cmd) => !builtinCommandNames.has(cmd.name))
		.map((cmd) => ({
			name: cmd.invocationName,
			description: prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
			getArgumentCompletions: cmd.getArgumentCompletions,
		}));

	const skillCommands = new Map<string, string>();
	const skillCommandList: SlashCommand[] = [];
	if (input.enableSkillCommands) {
		for (const skill of input.skills) {
			const commandName = `skill:${skill.name}`;
			skillCommands.set(commandName, skill.filePath);
			skillCommandList.push({
				name: commandName,
				description: prefixAutocompleteDescription(skill.description, skill.sourceInfo),
			});
		}
	}

	return {
		provider: new CombinedAutocompleteProvider(
			[...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
			input.cwd,
			input.fdPath,
		),
		skillCommands,
	};
}
