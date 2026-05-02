import type { TuiCommand } from "../types.js";

export const nameCommand: TuiCommand = {
	name: "name",
	description: "Set session display name",
	execute(context, invocation) {
		context.runNameCommand(invocation.raw);
	},
};
