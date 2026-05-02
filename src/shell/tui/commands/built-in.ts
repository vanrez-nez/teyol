import { exitCommand } from "./built-ins/exit.js";
import { hotkeysCommand } from "./built-ins/hotkeys.js";
import { logCommand } from "./built-ins/log.js";
import { loginCommand } from "./built-ins/login.js";
import { logoutCommand } from "./built-ins/logout.js";
import { modelCommand } from "./built-ins/model.js";
import { nameCommand } from "./built-ins/name.js";
import { reloadCommand } from "./built-ins/reload.js";
import { scopedModelsCommand } from "./built-ins/scoped-models.js";
import { sessionCommand } from "./built-ins/session.js";
import { settingsCommand } from "./built-ins/settings.js";
import type { TuiCommand, TuiCommandContext } from "./types.js";
import { commandNames, matchesCommand, parseCommandInvocation, toSlashCommand } from "./types.js";

export const BUILT_IN_TUI_COMMANDS: ReadonlyArray<TuiCommand> = [
	settingsCommand,
	scopedModelsCommand,
	modelCommand,
	nameCommand,
	sessionCommand,
	hotkeysCommand,
	loginCommand,
	logoutCommand,
	reloadCommand,
	logCommand,
	exitCommand,
];

export function getBuiltInCommandNames(): Set<string> {
	return new Set(BUILT_IN_TUI_COMMANDS.flatMap((command) => commandNames(command)));
}

export function getBuiltInSlashCommands(context: TuiCommandContext) {
	return BUILT_IN_TUI_COMMANDS.map((command) => toSlashCommand(command, context)).filter((command) => command !== null);
}

export async function dispatchBuiltInCommand(text: string, context: TuiCommandContext): Promise<boolean> {
	const parsed = parseCommandInvocation(text);
	if (!parsed) {
		return false;
	}

	const command = BUILT_IN_TUI_COMMANDS.find((candidate) => matchesCommand(candidate, parsed.name));
	if (!command) {
		return false;
	}

	await command.execute(context, {
		...parsed,
		canonicalName: command.name,
	});
	return true;
}
