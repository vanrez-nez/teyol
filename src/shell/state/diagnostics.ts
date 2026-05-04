export type ShellDiagnosticType = "info" | "warning" | "error" | "collision";

export interface ShellDiagnostic {
	type: ShellDiagnosticType;
	message: string;
	path?: string;
	collision?: {
		resourceType: "extension" | "skill" | "prompt" | "theme";
		name: string;
		winnerPath: string;
		loserPath: string;
		winnerSource?: string;
		loserSource?: string;
	};
}
