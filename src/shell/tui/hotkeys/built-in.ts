import type { TUI } from "#tui/index.js";
import type { SettingsManager } from "#shell/runtime/settings-manager.js";
import { CustomEditor } from "../components/custom-editor.js";

export interface BuiltInHotkeyHandlers {
	restoreQueuedMessagesToEditor(options: { abort: true }): void;
	clear(): void;
	exit(): void;
	suspend(): void;
	cycleThinkingLevel(): void;
	cycleModel(direction: "forward" | "backward"): void;
	showModelSelector(): void;
	toggleToolOutputExpansion(): void;
	toggleThinkingBlockVisibility(): void;
	openExternalEditor(): void;
	followUp(): void;
	dequeue(): void;
	newSession(): void;
	showTreeSelector(): void;
	showUserMessageSelector(): void;
	showSessionSelector(): void;
	printLogFile(): void;
	pasteImage(): void;
}

export interface SetupBuiltInHotkeysOptions {
	defaultEditor: CustomEditor;
	ui: TUI;
	settingsManager: SettingsManager;
	isStreaming(): boolean;
	getEditorText(): string;
	handlers: BuiltInHotkeyHandlers;
}

export function setupBuiltInHotkeys(options: SetupBuiltInHotkeysOptions): void {
	const { defaultEditor, handlers, settingsManager, ui } = options;
	let lastEscapeTime = 0;

	defaultEditor.onEscape = () => {
		if (options.isStreaming()) {
			handlers.restoreQueuedMessagesToEditor({ abort: true });
		} else if (!options.getEditorText().trim()) {
		} else if (!options.getEditorText().trim()) {
			const action = settingsManager.getDoubleEscapeAction();
			if (action !== "none") {
				const now = Date.now();
				if (now - lastEscapeTime < 500) {
					if (action === "tree") {
						handlers.showTreeSelector();
					} else {
						handlers.showUserMessageSelector();
					}
					lastEscapeTime = 0;
				} else {
					lastEscapeTime = now;
				}
			}
		}
	};

	defaultEditor.onAction("app.clear", () => handlers.clear());
	defaultEditor.onCtrlD = () => handlers.exit();
	defaultEditor.onAction("app.suspend", () => handlers.suspend());
	defaultEditor.onAction("app.thinking.cycle", () => handlers.cycleThinkingLevel());
	defaultEditor.onAction("app.model.cycleForward", () => handlers.cycleModel("forward"));
	defaultEditor.onAction("app.model.cycleBackward", () => handlers.cycleModel("backward"));
	ui.onDebug = () => handlers.printLogFile();
	defaultEditor.onAction("app.model.select", () => handlers.showModelSelector());
	defaultEditor.onAction("app.tools.expand", () => handlers.toggleToolOutputExpansion());
	defaultEditor.onAction("app.thinking.toggle", () => handlers.toggleThinkingBlockVisibility());
	defaultEditor.onAction("app.editor.external", () => handlers.openExternalEditor());
	defaultEditor.onAction("app.message.followUp", () => handlers.followUp());
	defaultEditor.onAction("app.message.dequeue", () => handlers.dequeue());
	defaultEditor.onAction("app.session.new", () => handlers.newSession());
	defaultEditor.onAction("app.session.tree", () => handlers.showTreeSelector());
	defaultEditor.onAction("app.session.fork", () => handlers.showUserMessageSelector());
	defaultEditor.onAction("app.session.resume", () => handlers.showSessionSelector());
	defaultEditor.onChange = (_text: string) => {};
	defaultEditor.onPasteImage = () => {
		handlers.pasteImage();
	};
}
