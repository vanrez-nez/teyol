import { createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export type AuthStatus = "idle" | "ready" | "error";

export interface AuthState {
	status: AuthStatus;
	diagnostics: ShellDiagnostic[];
}

const initialState: AuthState = {
	status: "idle",
	diagnostics: [],
};

export const authReady = createEvent<void>();
export const authFailed = createEvent<{ diagnostics: ShellDiagnostic[] }>();

export const $auth = createStore<AuthState>(initialState)
	.on(authReady, () => ({
		status: "ready",
		diagnostics: [],
	}))
	.on(authFailed, (_, payload) => ({
		status: "error",
		diagnostics: payload.diagnostics,
	}));
