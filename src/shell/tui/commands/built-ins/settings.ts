import type { TuiCommand } from "../types.js";

export const settingsCommand: TuiCommand = {
	name: "settings",
	description: "Open settings menu",
	execute(context) {
		context.openSettings();
	},
};
