import type { TuiCommand } from "../types.js";

export const logoutCommand: TuiCommand = {
	name: "logout",
	description: "Remove provider authentication",
	execute(context) {
		return context.openAuth("logout");
	},
};
