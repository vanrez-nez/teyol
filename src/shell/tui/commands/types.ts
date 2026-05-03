import type { AutocompleteItem, SlashCommand } from "#tui/index.js";

export interface CommandInvocation {
	raw: string;
	name: string;
	canonicalName: string;
	args: string;
}

export interface TuiCommand<Dependencies> {
	name: string;
	aliases?: ReadonlyArray<string>;
	description: string;
	argumentHint?: string;
	isVisible?(dependencies: Dependencies): boolean;
	complete?(dependencies: Dependencies, invocation: CommandInvocation): AutocompleteItem[] | null;
	execute(dependencies: Dependencies, invocation: CommandInvocation): void | Promise<void>;
}

export interface RegisteredCommand {
	command: TuiCommand<any>;
	dependencies: any;
}

export function registerCommand<Dependencies>(
	command: TuiCommand<Dependencies>,
	dependencies: Dependencies,
): RegisteredCommand {
	return { command, dependencies };
}

export function parseCommandInvocation(text: string): Omit<CommandInvocation, "canonicalName"> | null {
	const match = /^\/([^\s]+)(?:\s+(.*))?$/s.exec(text);
	if (!match) {
		return null;
	}

	return {
		raw: text,
		name: match[1],
		args: match[2] ?? "",
	};
}

export function commandNames(command: TuiCommand<any>): ReadonlyArray<string> {
	return [command.name, ...(command.aliases ?? [])];
}

export function matchesCommand(command: TuiCommand<any>, name: string): boolean {
	return commandNames(command).includes(name);
}

export function toSlashCommand(registration: RegisteredCommand): SlashCommand | null {
	const { command, dependencies } = registration;
	if (command.isVisible && !command.isVisible(dependencies)) {
		return null;
	}

	return {
		name: command.name,
		description: command.description,
		...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
		...(command.complete
			? {
					getArgumentCompletions: (prefix: string): AutocompleteItem[] | null =>
						command.complete!(dependencies, {
							raw: `/${command.name}${prefix ? ` ${prefix}` : ""}`,
							name: command.name,
							canonicalName: command.name,
							args: prefix,
						}),
				}
			: {}),
	};
}
