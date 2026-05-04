import { APP_NAME } from "../../../../config.js";
import type { TuiCommand } from "../types.js";

export const exitCommand: TuiCommand<{ shutdown(): Promise<void> }> = {
	name: "exit",
	aliases: ["quit"],
	description: `Quit ${APP_NAME}`,
	execute({ shutdown }) {
		return shutdown();
	},
};
