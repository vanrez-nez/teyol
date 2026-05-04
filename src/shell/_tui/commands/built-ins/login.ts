import type { TuiCommand } from "../types.js";
import { type AuthCommandDependencies, showLoginAuthTypeSelector } from "./auth.js";

export const loginCommand: TuiCommand<AuthCommandDependencies> = {
	name: "login",
	description: "Configure provider authentication",
	execute(dependencies) {
		showLoginAuthTypeSelector(dependencies);
	},
};
