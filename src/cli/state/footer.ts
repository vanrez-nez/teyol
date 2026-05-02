import { combine, createEvent, createStore } from "effector";

export interface FooterStateSnapshot {
	extensionStatuses: ReadonlyMap<string, string>;
	availableProviderCount: number;
	autoCompactEnabled: boolean;
}

export function createFooterState(options?: { autoCompactEnabled?: boolean }) {
	const setExtensionStatus = createEvent<{ key: string; text: string | undefined }>();
	const clearExtensionStatuses = createEvent<void>();
	const setAvailableProviderCount = createEvent<number>();
	const setAutoCompactEnabled = createEvent<boolean>();

	const $extensionStatuses = createStore<ReadonlyMap<string, string>>(new Map())
		.on(setExtensionStatus, (statuses, { key, text }) => {
			const next = new Map(statuses);
			if (text === undefined) {
				next.delete(key);
			} else {
				next.set(key, text);
			}
			return next;
		})
		.on(clearExtensionStatuses, () => new Map());

	const $availableProviderCount = createStore(0).on(setAvailableProviderCount, (_, count) => count);
	const $autoCompactEnabled = createStore(options?.autoCompactEnabled ?? true).on(
		setAutoCompactEnabled,
		(_, enabled) => enabled,
	);

	const $snapshot = combine({
		extensionStatuses: $extensionStatuses,
		availableProviderCount: $availableProviderCount,
		autoCompactEnabled: $autoCompactEnabled,
	});

	return {
		$extensionStatuses,
		$availableProviderCount,
		$autoCompactEnabled,
		$snapshot,
		setExtensionStatus,
		clearExtensionStatuses,
		setAvailableProviderCount,
		setAutoCompactEnabled,
	};
}
