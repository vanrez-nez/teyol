import { APP_NAME } from "../../../../config.js";
import type { TuiCommand } from "../types.js";

export const exitCommand: TuiCommand = {
	name: "exit",
	aliases: ["quit"],
	description: `Quit ${APP_NAME}`,
	execute(context) {
		return context.shutdown();
	},
};
