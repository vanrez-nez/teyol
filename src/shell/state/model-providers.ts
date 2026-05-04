import { createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export type ModelProvidersStatus = "idle" | "loading" | "ready" | "error";

export interface ModelProvidersState {
	status: ModelProvidersStatus;
	diagnostics: ShellDiagnostic[];
	availableCount: number;
	totalCount: number;
}

const initialState: ModelProvidersState = {
	status: "idle",
	diagnostics: [],
	availableCount: 0,
	totalCount: 0,
};

export const modelProvidersLoading = createEvent<{ totalCount: number }>();
export const modelProvidersReady = createEvent<{
	diagnostics: ShellDiagnostic[];
	availableCount: number;
	totalCount: number;
}>();
export const modelProvidersFailed = createEvent<{
	diagnostics: ShellDiagnostic[];
	availableCount: number;
	totalCount: number;
}>();

export const $modelProviders = createStore<ModelProvidersState>(initialState)
	.on(modelProvidersLoading, (_, payload) => ({
		status: "loading",
		diagnostics: [],
		availableCount: 0,
		totalCount: payload.totalCount,
	}))
	.on(modelProvidersReady, (_, payload) => ({
		status: "ready",
		diagnostics: payload.diagnostics,
		availableCount: payload.availableCount,
		totalCount: payload.totalCount,
	}))
	.on(modelProvidersFailed, (_, payload) => ({
		status: "error",
		diagnostics: payload.diagnostics,
		availableCount: payload.availableCount,
		totalCount: payload.totalCount,
	}));
