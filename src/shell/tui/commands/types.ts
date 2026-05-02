import type { AutocompleteItem, SlashCommand } from "#tui/index.js";

export interface CommandInvocation {
	raw: string;
	name: string;
	canonicalName: string;
	args: string;
}

export interface TuiCommandContext {
	openSettings(): void;
	openScopedModels(): Promise<void>;
	runModelCommand(text: string): Promise<void>;
	runNameCommand(text: string): void;
	runSessionCommand(text: string): Promise<void>;
	showHotkeys(): void;
	openAuth(mode: "login" | "logout"): Promise<void>;
	reload(): Promise<void>;
	runLogCommand(text: string): Promise<void>;
	shutdown(): Promise<void>;
	getModelArgumentCompletions(prefix: string, valuePrefix?: string): AutocompleteItem[] | null;
	isDevMode(): boolean;
}

export interface TuiCommand {
	name: string;
	aliases?: ReadonlyArray<string>;
	description: string;
	argumentHint?: string;
	isVisible?(context: TuiCommandContext): boolean;
	complete?(context: TuiCommandContext, invocation: CommandInvocation): AutocompleteItem[] | null;
	execute(context: TuiCommandContext, invocation: CommandInvocation): void | Promise<void>;
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

export function commandNames(command: TuiCommand): ReadonlyArray<string> {
	return [command.name, ...(command.aliases ?? [])];
}

export function matchesCommand(command: TuiCommand, name: string): boolean {
	return commandNames(command).includes(name);
}

export function toSlashCommand(command: TuiCommand, context: TuiCommandContext): SlashCommand | null {
	if (command.isVisible && !command.isVisible(context)) {
		return null;
	}

	return {
		name: command.name,
		description: command.description,
		...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
		...(command.complete
			? {
					getArgumentCompletions: (prefix: string): AutocompleteItem[] | null =>
						command.complete!(context, {
							raw: `/${command.name}${prefix ? ` ${prefix}` : ""}`,
							name: command.name,
							canonicalName: command.name,
							args: prefix,
						}),
				}
			: {}),
	};
}
