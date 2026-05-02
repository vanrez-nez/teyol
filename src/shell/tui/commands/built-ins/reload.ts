import type { TuiCommand } from "../types.js";

export const reloadCommand: TuiCommand = {
	name: "reload",
	description: "Reload keybindings, extensions, skills, prompts, and themes",
	execute(context) {
		return context.reload();
	},
};
