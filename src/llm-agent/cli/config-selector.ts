/**
 * TUI config selector for `teyol config` command
 */

import { ProcessTerminal, TUI } from "#tui/index.js";
import type { ResolvedPaths } from "#llm-agent/core/package-manager.js";
import type { SettingsManager } from "#llm-agent/core/settings-manager.js";
import { ConfigSelectorComponent } from "#llm-agent/modes/interactive/components/config-selector.js";
import { initTheme, stopThemeWatcher } from "#llm-agent/modes/interactive/theme/theme.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	// Initialize theme before showing TUI
	initTheme(options.settingsManager.getTheme(), true);

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
}
