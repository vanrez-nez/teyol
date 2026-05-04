import { $settings } from "#shell/state/index.js";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isInstallTelemetryEnabled(
	telemetryEnv: string | undefined = process.env.TEYOL_TELEMETRY,
): boolean {
	return telemetryEnv !== undefined ? isTruthyEnvFlag(telemetryEnv) : $settings.getState().values.enableInstallTelemetry;
}
