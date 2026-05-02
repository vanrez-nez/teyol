import { inspect } from "effector/inspect";

export interface CliStateInspectionOptions {
	enabled?: boolean;
	onEvent?: (event: { kind: string; name?: string; value?: unknown }) => void;
}

export function attachCliStateInspection(options?: CliStateInspectionOptions): ReturnType<typeof inspect> | undefined {
	if (!options?.enabled || !options.onEvent) {
		return undefined;
	}

	return inspect({
		fn(update) {
			options.onEvent?.({
				kind: update.type,
				name: update.name,
				value: update.value,
			});
		},
	});
}
