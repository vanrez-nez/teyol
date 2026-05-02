import type { TuiCommand } from "../types.js";

export const loginCommand: TuiCommand = {
	name: "login",
	description: "Configure provider authentication",
	execute(context) {
		return context.openAuth("login");
	},
};
