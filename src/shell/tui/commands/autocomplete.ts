import type { AutocompleteProvider, SlashCommand } from "#tui/index.js";
import { CombinedAutocompleteProvider } from "#tui/index.js";
import type { ExtensionRunner } from "#shell/runtime/extensions/index.js";
import type { ResourceDiagnostic } from "#shell/runtime/resource-loader.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import type { Skill } from "#shell/runtime/skills.js";
import type { PromptTemplate } from "#shell/runtime/prompt-templates.js";
import { getBuiltInCommandNames, getBuiltInSlashCommands } from "./built-in.js";
import type { RegisteredCommand } from "./types.js";

export interface BuildAutocompleteInput {
	promptTemplates: ReadonlyArray<PromptTemplate>;
	skills: ReadonlyArray<Skill>;
	enableSkillCommands: boolean;
	extensionRunner: ExtensionRunner;
	cwd: string;
	fdPath?: string;
	commands: ReadonlyArray<RegisteredCommand>;
}

export interface BuildAutocompleteResult {
	provider: AutocompleteProvider;
	skillCommands: Map<string, string>;
}

function getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
	if (!sourceInfo) {
		return undefined;
	}

	const scopePrefix = sourceInfo.scope === "user" ? "u" : "t";
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

export function getBuiltInCommandConflictDiagnostics(
	extensionRunner: ExtensionRunner,
	commands: ReadonlyArray<RegisteredCommand>,
): ResourceDiagnostic[] {
	const builtinNames = getBuiltInCommandNames(commands);
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
	const slashCommands: SlashCommand[] = getBuiltInSlashCommands(input.commands);

	const templateCommands: SlashCommand[] = input.promptTemplates.map((cmd) => ({
		name: cmd.name,
		description: prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
		...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
	}));

	const builtinCommandNames = getBuiltInCommandNames(input.commands);
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
