import type { TuiCommand } from "../types.js";

export const hotkeysCommand: TuiCommand = {
	name: "hotkeys",
	description: "Show all keyboard shortcuts",
	execute(context) {
		context.showHotkeys();
	},
};
