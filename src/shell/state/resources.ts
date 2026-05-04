import { createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface ResourceState<T> {
	status: ResourceStatus;
	entries: T[];
	diagnostics: ShellDiagnostic[];
}

function getStatus(diagnostics: ShellDiagnostic[]): ResourceStatus {
	return diagnostics.some((diagnostic) => diagnostic.type === "error") ? "error" : "ready";
}

function createResourceStore<T>() {
	const initialState: ResourceState<T> = {
		status: "idle",
		entries: [],
		diagnostics: [],
	};
	const loading = createEvent<void>();
	const ready = createEvent<{ entries: T[]; diagnostics: ShellDiagnostic[] }>();

	const $store = createStore<ResourceState<T>>(initialState)
		.on(loading, () => ({
			status: "loading",
			entries: [],
			diagnostics: [],
		}))
		.on(ready, (_, payload) => ({
			status: getStatus(payload.diagnostics),
			entries: payload.entries,
			diagnostics: payload.diagnostics,
		}));

	return { $store, loading, ready };
}

const skillsResource = createResourceStore<unknown>();
const promptsResource = createResourceStore<unknown>();
const themesResource = createResourceStore<unknown>();

export const $skills = skillsResource.$store;
export const skillsLoading = skillsResource.loading;
export const skillsReady = skillsResource.ready;

export const $prompts = promptsResource.$store;
export const promptsLoading = promptsResource.loading;
export const promptsReady = promptsResource.ready;

export const $themes = themesResource.$store;
export const themesLoading = themesResource.loading;
export const themesReady = themesResource.ready;
