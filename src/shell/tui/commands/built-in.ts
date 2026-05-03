import type { RegisteredCommand } from "./types.js";
import { commandNames, matchesCommand, parseCommandInvocation, toSlashCommand } from "./types.js";

export function getBuiltInCommandNames(commands: ReadonlyArray<RegisteredCommand>): Set<string> {
	return new Set(commands.flatMap((registration) => commandNames(registration.command)));
}

export function getBuiltInSlashCommands(commands: ReadonlyArray<RegisteredCommand>) {
	return commands.map((registration) => toSlashCommand(registration)).filter((command) => command !== null);
}

export async function dispatchBuiltInCommand(
	text: string,
	commands: ReadonlyArray<RegisteredCommand>,
): Promise<boolean> {
	const parsed = parseCommandInvocation(text);
	if (!parsed) {
		return false;
	}

	const registration = commands.find((candidate) => matchesCommand(candidate.command, parsed.name));
	if (!registration) {
		return false;
	}

	await registration.command.execute(registration.dependencies, {
		...parsed,
		canonicalName: registration.command.name,
	});
	return true;
}
