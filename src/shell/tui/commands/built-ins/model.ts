import type { AutocompleteItem } from "#tui/index.js";
import type { ModelAction } from "../../components/model-actions-selector.js";
import type { TuiCommand } from "../types.js";

const modelActions: Array<{ value: ModelAction; description: string }> = [
	{ value: "select", description: "Choose the active model" },
	{ value: "fast-cycle", description: "Configure models for Ctrl+P cycling" },
];

export const modelCommand: TuiCommand = {
	name: "model",
	description: "Manage model selection and fast-cycle models",
	complete(context, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart();
		const lowerPrefix = normalizedPrefix.toLowerCase();

		if (lowerPrefix.startsWith("select ")) {
			return context.getModelArgumentCompletions(normalizedPrefix.slice("select ".length), "select ");
		}

		const actionCompletions = modelActions
			.filter((action) => action.value.startsWith(lowerPrefix))
			.map((action) => ({
				value: action.value,
				label: action.value,
				description: action.description,
			}));
		const modelCompletions = context.getModelArgumentCompletions(normalizedPrefix) ?? [];
		const completions = [...actionCompletions, ...modelCompletions];
		return completions.length > 0 ? completions : null;
	},
	execute(context, invocation) {
		return context.runModelCommand(invocation.raw);
	},
};
