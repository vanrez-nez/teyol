import type { AutocompleteItem } from "#tui/index.js";
import type { SessionAction } from "../../components/session-actions-selector.js";
import type { TuiCommand } from "../types.js";

const sessionActions: Array<{ value: SessionAction; description: string }> = [
	{ value: "info", description: "Show current session info and stats" },
	{ value: "new", description: "Start a new session" },
	{ value: "resume", description: "Resume a different session" },
	{ value: "compact", description: "Manually compact session context" },
	{ value: "tree", description: "Navigate session tree" },
	{ value: "clone", description: "Duplicate current session position" },
	{ value: "fork", description: "Fork from a previous user message" },
];

export const sessionCommand: TuiCommand = {
	name: "session",
	description: "Manage sessions",
	complete(_context, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart().toLowerCase();
		const filtered = sessionActions.filter((action) => action.value.startsWith(normalizedPrefix));
		if (filtered.length === 0) return null;
		return filtered.map((action) => ({
			value: action.value,
			label: action.value,
			description: action.description,
		}));
	},
	execute(context, invocation) {
		return context.runSessionCommand(invocation.raw);
	},
};
