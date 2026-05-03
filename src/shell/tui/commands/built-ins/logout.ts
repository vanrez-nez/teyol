import type { TuiCommand } from "../types.js";
import { type AuthCommandDependencies, showLogoutProviderSelector } from "./auth.js";

export const logoutCommand: TuiCommand<AuthCommandDependencies> = {
	name: "logout",
	description: "Remove provider authentication",
	execute(dependencies) {
		showLogoutProviderSelector(dependencies);
	},
};
