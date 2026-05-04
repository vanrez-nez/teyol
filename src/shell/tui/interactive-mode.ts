import { renderHelloWorldApp } from "#tui/index.js";
import type { AgentSessionRuntime } from "#shell/runtime/agent-session-runtime.js";

export interface InteractiveModeOptions {
	modelFallbackMessage?: string;
	initialMessage?: string;
	initialImages?: unknown[];
	initialMessages?: string[];
	verbose?: boolean;
}

export class InteractiveMode {
	constructor(
		private readonly runtimeHost: AgentSessionRuntime,
		private readonly options: InteractiveModeOptions = {},
	) {}

	async run(): Promise<void> {
		void this.runtimeHost;
		void this.options;
		await renderHelloWorldApp();
	}
}
