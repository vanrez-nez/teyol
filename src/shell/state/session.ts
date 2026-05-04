import { createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export interface SessionState {
	diagnostics: ShellDiagnostic[];
}

const initialState: SessionState = {
	diagnostics: [],
};

export const sessionDiagnosticsReported = createEvent<{ diagnostics: ShellDiagnostic[] }>();
export const sessionDiagnosticsCleared = createEvent<void>();

export const $session = createStore<SessionState>(initialState)
	.on(sessionDiagnosticsReported, (state, payload) => ({
		diagnostics: [...state.diagnostics, ...payload.diagnostics],
	}))
	.on(sessionDiagnosticsCleared, () => initialState);
