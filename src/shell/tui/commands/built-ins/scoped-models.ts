import type { TuiCommand } from "../types.js";

export const scopedModelsCommand: TuiCommand = {
	name: "scoped-models",
	description: "Open scoped model selector",
	execute(context) {
		return context.openScopedModels();
	},
};
