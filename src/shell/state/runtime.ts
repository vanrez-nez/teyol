import { createEvent, createStore } from "effector";
import type { AgentSessionRuntime } from "#shell/runtime/agent-session-runtime.js";
import type { ShellDiagnostic } from "./diagnostics.js";

export type RuntimeStatus = "idle" | "loading" | "ready" | "error";

export interface RuntimeState {
	status: RuntimeStatus;
	diagnostics: ShellDiagnostic[];
	runtime?: AgentSessionRuntime;
}

const initialState: RuntimeState = {
	status: "idle",
	diagnostics: [],
};

export const runtimeLoading = createEvent<void>();
export const runtimeReady = createEvent<{
	runtime: AgentSessionRuntime;
}>();
export const runtimeFailed = createEvent<{
	diagnostics: ShellDiagnostic[];
}>();

export const $runtime = createStore<RuntimeState>(initialState)
	.on(runtimeLoading, () => ({
		status: "loading",
		diagnostics: [],
	}))
	.on(runtimeReady, (_, payload) => ({
		status: "ready",
		diagnostics: [],
		runtime: payload.runtime,
	}))
	.on(runtimeFailed, (_, payload) => ({
		status: "error",
		diagnostics: payload.diagnostics,
	}));
