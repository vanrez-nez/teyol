/**
 * TUI config selector for `teyol config` command
 */

import type { ResolvedPaths } from "#shell/runtime/package-manager.js";
import type { SettingsManager } from "#shell/runtime/settings-manager.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	void options;
	console.error("Interactive config selector is disabled during the Ink TUI migration.");
	return;
	/*
	OLD CUSTOM TUI IMPLEMENTATION DISABLED DURING INK MIGRATION.

	// Initialize theme before showing TUI
	initTheme($settings.getState().values.theme, true);

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new ConfigSelectorComponent(
			options.resolvedPaths,
			options.settingsManager,
			options.cwd,
			options.agentDir,
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					stopThemeWatcher();
					resolve();
				}
			},
			() => {
				ui.stop();
				stopThemeWatcher();
				process.exit(0);
			},
			() => ui.requestRender(),
		);

		ui.addChild(selector);
		ui.setFocus(selector.getResourceList());
		ui.start();
	});
	*/
}
