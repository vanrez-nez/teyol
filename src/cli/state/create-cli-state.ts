import { attachCliStateInspection, type CliStateInspectionOptions } from "./inspection.js";
import { createFooterState } from "./footer.js";
import { createQueueState } from "./queue.js";
import { createShellState } from "./shell.js";

export interface CreateCliStateOptions {
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	autoCompactEnabled: boolean;
	inspection?: CliStateInspectionOptions;
}

export function createCliState(options: CreateCliStateOptions) {
	const inspectionSubscription = attachCliStateInspection(options.inspection);
	const shell = createShellState({
		hideThinkingBlock: options.hideThinkingBlock,
		hiddenThinkingLabel: options.hiddenThinkingLabel,
	});
	const queue = createQueueState();
	const footer = createFooterState({ autoCompactEnabled: options.autoCompactEnabled });

	const dispose = () => {
		inspectionSubscription?.unsubscribe();
	};

	return {
		shell,
		queue,
		footer,
		dispose,
	};
}

export type CliState = ReturnType<typeof createCliState>;
