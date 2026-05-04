import { combine, createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export type ExtensionsStatus = "idle" | "loading" | "ready" | "error";

export interface ExtensionStateEntry {
	path: string;
	resolvedPath?: string;
	status: Exclude<ExtensionsStatus, "idle">;
	diagnostics: ShellDiagnostic[];
}

export interface ExtensionsState {
	status: ExtensionsStatus;
	entries: ExtensionStateEntry[];
}

const initialState: ExtensionsState = {
	status: "idle",
	entries: [],
};

export const extensionsLoading = createEvent<void>();
export const extensionsReady = createEvent<void>();
export const extensionLoading = createEvent<{ path: string }>();
export const extensionReady = createEvent<{ path: string; resolvedPath?: string }>();
export const extensionFailed = createEvent<{ path: string; diagnostics: ShellDiagnostic[] }>();

function upsertEntry(entries: ExtensionStateEntry[], entry: ExtensionStateEntry): ExtensionStateEntry[] {
	const index = entries.findIndex((candidate) => candidate.path === entry.path);
	if (index === -1) {
		return [...entries, entry];
	}
	return [...entries.slice(0, index), entry, ...entries.slice(index + 1)];
}

function getStatus(entries: ExtensionStateEntry[]): ExtensionsStatus {
	if (entries.length === 0) return "idle";
	if (entries.some((entry) => entry.status === "error")) return "error";
	if (entries.some((entry) => entry.status === "loading")) return "loading";
	return "ready";
}

function withEntry(state: ExtensionsState, entry: ExtensionStateEntry): ExtensionsState {
	const entries = upsertEntry(state.entries, entry);
	return {
		status: getStatus(entries),
		entries,
	};
}

export const $extensions = createStore<ExtensionsState>(initialState)
	.on(extensionsLoading, () => ({
		status: "loading",
		entries: [],
	}))
	.on(extensionsReady, (state) => ({
		status: state.entries.some((entry) => entry.status === "error") ? "error" : "ready",
		entries: state.entries,
	}))
	.on(extensionLoading, (state, payload) =>
		withEntry(state, {
			path: payload.path,
			status: "loading",
			diagnostics: [],
		}),
	)
	.on(extensionReady, (state, payload) =>
		withEntry(state, {
			path: payload.path,
			resolvedPath: payload.resolvedPath,
			status: "ready",
			diagnostics: [],
		}),
	)
	.on(extensionFailed, (state, payload) =>
		withEntry(state, {
			path: payload.path,
			status: "error",
			diagnostics: payload.diagnostics,
		}),
	);

export const $extensionCounts = combine($extensions, (state) => ({
	total: state.entries.length,
	loading: state.entries.filter((entry) => entry.status === "loading").length,
	ready: state.entries.filter((entry) => entry.status === "ready").length,
	error: state.entries.filter((entry) => entry.status === "error").length,
}));
