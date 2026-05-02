import type { Keybinding } from "#tui/index.js";
import type { AppKeybinding, KeyId } from "#shell/runtime/keybindings.js";
import { keyText } from "../components/keybinding-hints.js";

export interface BuildHotkeyHelpOptions {
	extensionShortcuts: Map<KeyId, { description?: string; extensionPath: string }>;
	platform?: NodeJS.Platform;
}

function capitalizeKey(key: string): string {
	return key
		.split("/")
		.map((k) =>
			k
				.split("+")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join("/");
}

function appKey(action: AppKeybinding): string {
	return capitalizeKey(keyText(action));
}

function editorKey(action: Keybinding): string {
	return capitalizeKey(keyText(action));
}

export function buildHotkeyHelpMarkdown(options: BuildHotkeyHelpOptions): string {
	const platform = options.platform ?? process.platform;
	const cursorUp = editorKey("tui.editor.cursorUp");
	const cursorDown = editorKey("tui.editor.cursorDown");
	const cursorLeft = editorKey("tui.editor.cursorLeft");
	const cursorRight = editorKey("tui.editor.cursorRight");
	const cursorWordLeft = editorKey("tui.editor.cursorWordLeft");
	const cursorWordRight = editorKey("tui.editor.cursorWordRight");
	const cursorLineStart = editorKey("tui.editor.cursorLineStart");
	const cursorLineEnd = editorKey("tui.editor.cursorLineEnd");
	const jumpForward = editorKey("tui.editor.jumpForward");
	const jumpBackward = editorKey("tui.editor.jumpBackward");
	const pageUp = editorKey("tui.editor.pageUp");
	const pageDown = editorKey("tui.editor.pageDown");
	const submit = editorKey("tui.input.submit");
	const newLine = editorKey("tui.input.newLine");
	const deleteWordBackward = editorKey("tui.editor.deleteWordBackward");
	const deleteWordForward = editorKey("tui.editor.deleteWordForward");
	const deleteToLineStart = editorKey("tui.editor.deleteToLineStart");
	const deleteToLineEnd = editorKey("tui.editor.deleteToLineEnd");
	const yank = editorKey("tui.editor.yank");
	const yankPop = editorKey("tui.editor.yankPop");
	const undo = editorKey("tui.editor.undo");
	const tab = editorKey("tui.input.tab");
	const interrupt = appKey("app.interrupt");
	const clear = appKey("app.clear");
	const exit = appKey("app.exit");
	const suspend = appKey("app.suspend");
	const cycleThinkingLevel = appKey("app.thinking.cycle");
	const cycleModelForward = appKey("app.model.cycleForward");
	const selectModel = appKey("app.model.select");
	const expandTools = appKey("app.tools.expand");
	const toggleThinking = appKey("app.thinking.toggle");
	const externalEditor = appKey("app.editor.external");
	const cycleModelBackward = appKey("app.model.cycleBackward");
	const followUp = appKey("app.message.followUp");
	const dequeue = appKey("app.message.dequeue");
	const pasteImage = appKey("app.clipboard.pasteImage");

	let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image from clipboard |
| \`/\` | Slash commands |
	`;

	if (options.extensionShortcuts.size > 0) {
		hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
		for (const [key, shortcut] of options.extensionShortcuts) {
			const description = shortcut.description ?? shortcut.extensionPath;
			const keyDisplay = key.replace(/\b\w/g, (c) => c.toUpperCase());
			hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
		}
	}

	return hotkeys.trim();
}
