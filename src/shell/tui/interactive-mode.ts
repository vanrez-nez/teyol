import { renderTuiApp } from "#tui/index.js";

export interface InteractiveModeOptions {
	initialMessage?: string;
	initialImages?: unknown[];
	initialMessages?: string[];
	verbose?: boolean;
}

export class InteractiveMode {
	constructor(private readonly options: InteractiveModeOptions = {}) {}

	async run(): Promise<void> {
		void this.options;
		await renderTuiApp();
	}
}
