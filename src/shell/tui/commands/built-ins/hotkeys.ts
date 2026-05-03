import type { ExtensionRunner } from "#shell/runtime/extensions/index.js";
import type { KeybindingsManager } from "#shell/runtime/keybindings.js";
import { type Container, Markdown, type MarkdownTheme, Spacer, Text, type TUI } from "#tui/index.js";
import { theme } from "../../../theme/theme.js";
import { DynamicBorder } from "../../components/dynamic-border.js";
import { buildHotkeyHelpMarkdown } from "../../hotkeys/help.js";
import type { TuiCommand } from "../types.js";

export const hotkeysCommand: TuiCommand<{
	chatContainer: Container;
	extensionRunner: ExtensionRunner;
	keybindings: KeybindingsManager;
	markdownTheme: MarkdownTheme;
	ui: TUI;
}> = {
	name: "hotkeys",
	description: "Show all keyboard shortcuts",
	execute({ chatContainer, extensionRunner, keybindings, markdownTheme, ui }) {
		const hotkeys = buildHotkeyHelpMarkdown({
			extensionShortcuts: extensionRunner.getShortcuts(keybindings.getEffectiveConfig()),
		});

		chatContainer.addChild(new Spacer(1));
		chatContainer.addChild(new DynamicBorder());
		chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		chatContainer.addChild(new Spacer(1));
		chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, markdownTheme));
		chatContainer.addChild(new DynamicBorder());
		ui.requestRender();
	},
};
