import type { AutocompleteItem } from "#tui/index.js";
import type { LogAction } from "../../components/log-action-selector.js";
import type { TuiCommand } from "../types.js";

const logActions: Array<{ value: LogAction; description: string }> = [
	{ value: "view", description: "Show the current log file path and tail" },
	{ value: "enable", description: "Start writing log entries" },
	{ value: "disable", description: "Stop writing log entries" },
	{ value: "mode", description: "Choose between app and session log files" },
	{ value: "rotation_lines", description: "Set rotation line threshold (0 disables)" },
	{ value: "level", description: "Choose which severity levels are written" },
];

export const logCommand: TuiCommand = {
	name: "log",
	description: "Configure logging",
	isVisible(context) {
		return context.isDevMode();
	},
	complete(_context, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart().toLowerCase();
		const filtered = logActions.filter((action) => action.value.startsWith(normalizedPrefix));
		if (filtered.length === 0) return null;
		return filtered.map((action) => ({
			value: action.value,
			label: action.value,
			description: action.description,
		}));
	},
	execute(context, invocation) {
		return context.runLogCommand(invocation.raw);
	},
};
