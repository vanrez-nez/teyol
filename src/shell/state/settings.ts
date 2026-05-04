import { createEvent, createStore } from "effector";
import type { ShellDiagnostic } from "./diagnostics.js";

export type SettingsStatus = "idle" | "ready" | "error";

export interface SettingsState {
	status: SettingsStatus;
	diagnostics: ShellDiagnostic[];
}

const initialState: SettingsState = {
	status: "idle",
	diagnostics: [],
};

export const settingsReady = createEvent<void>();
export const settingsFailed = createEvent<{ diagnostics: ShellDiagnostic[] }>();

export const $settings = createStore<SettingsState>(initialState)
	.on(settingsReady, () => ({
		status: "ready",
		diagnostics: [],
	}))
	.on(settingsFailed, (_, payload) => ({
		status: "error",
		diagnostics: payload.diagnostics,
	}));
