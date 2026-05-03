import { combine, createEvent, createStore } from "effector";
import type { LoaderIndicatorOptions } from "#tui/index.js";

export interface WorkingIndicatorState {
	visible: boolean;
	message: string | undefined;
	indicator: LoaderIndicatorOptions | undefined;
}

export interface ShellStateSnapshot {
	detailsExpanded: boolean;
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	working: WorkingIndicatorState;
}

export interface ShellStateOptions {
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
}

export function createShellState(options: ShellStateOptions) {
	const setDetailsExpanded = createEvent<boolean>();
	const setHideThinkingBlock = createEvent<boolean>();
	const setHiddenThinkingLabel = createEvent<string | undefined>();
	const setWorkingMessage = createEvent<string | undefined>();
	const setWorkingVisible = createEvent<boolean>();
	const setWorkingIndicator = createEvent<LoaderIndicatorOptions | undefined>();
	const resetExtensionShell = createEvent<void>();

	const $detailsExpanded = createStore(false).on(setDetailsExpanded, (_, expanded) => expanded);
	const $hideThinkingBlock = createStore(options.hideThinkingBlock).on(setHideThinkingBlock, (_, hidden) => hidden);
	const $hiddenThinkingLabel = createStore(options.hiddenThinkingLabel).on(
		setHiddenThinkingLabel,
		(_, label) => label ?? options.hiddenThinkingLabel,
	);
	const $working = createStore<WorkingIndicatorState>({
		visible: true,
		message: undefined,
		indicator: undefined,
	})
		.on(setWorkingMessage, (state, message) => ({ ...state, message }))
		.on(setWorkingVisible, (state, visible) => ({ ...state, visible }))
		.on(setWorkingIndicator, (state, indicator) => ({ ...state, indicator }))
		.on(resetExtensionShell, () => ({ visible: true, message: undefined, indicator: undefined }));

	const $snapshot = combine({
		detailsExpanded: $detailsExpanded,
		hideThinkingBlock: $hideThinkingBlock,
		hiddenThinkingLabel: $hiddenThinkingLabel,
		working: $working,
	});

	return {
		$detailsExpanded,
		$hideThinkingBlock,
		$hiddenThinkingLabel,
		$working,
		$snapshot,
		setDetailsExpanded,
		setHideThinkingBlock,
		setHiddenThinkingLabel,
		setWorkingMessage,
		setWorkingVisible,
		setWorkingIndicator,
		resetExtensionShell,
	};
}
