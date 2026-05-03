import type { AgentSession } from "#shell/runtime/agent-session.js";
import type { KeybindingsManager } from "#shell/runtime/keybindings.js";
import { type Component, Container, Spacer, Text, type TUI } from "#tui/index.js";
import { getLogger } from "#shell/runtime/logger.js";
import { setRegisteredThemes, setTheme, theme } from "../../../theme/theme.js";
import { DynamicBorder } from "../../components/dynamic-border.js";
import type { CustomEditor } from "../../components/custom-editor.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { CliState } from "../../state/index.js";
import type { TuiCommand } from "../types.js";
import { applyLoggerConfig } from "./log.js";

interface Expandable {
	setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export interface ReloadDependencies {
	session: AgentSession;
	state: CliState;
	ui: TUI;
	layout: ShellLayoutComponent;
	chatContainer: Container;
	keybindings: KeybindingsManager;
	defaultEditor: CustomEditor;
	getEditor(): Component & {
		setPaddingX?(padding: number): void;
		setAutocompleteMaxVisible?(maxVisible: number): void;
	};
	startupContent: Component | undefined;
	resetExtensionUI(): void;
	refreshAutocomplete(): void;
	setupExtensionShortcuts(): void;
	rebuildChatFromMessages(): void;
	showLoadedResources(): void;
}

export async function runReload({
		session,
		state,
		ui,
		layout,
		chatContainer,
		keybindings,
		defaultEditor,
		getEditor,
		startupContent,
		resetExtensionUI,
		refreshAutocomplete,
		setupExtensionShortcuts,
		rebuildChatFromMessages,
		showLoadedResources,
}: ReloadDependencies): Promise<void> {
		if (session.isStreaming) {
			showWarning({ chatContainer, ui }, "Wait for the current response to finish before reloading.");
			return;
		}
		if (session.isCompacting) {
			showWarning({ chatContainer, ui }, "Wait for compaction to finish before reloading.");
			return;
		}

		resetExtensionUI();

		const reloadBox = new Container();
		const borderColor = (s: string) => theme.fg("border", s);
		reloadBox.addChild(new DynamicBorder(borderColor));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new DynamicBorder(borderColor));

		const previousEditor = getEditor();
		layout.setEditorHost(reloadBox);
		ui.requestRender(true);
		await new Promise((resolve) => process.nextTick(resolve));

		const dismissReloadBox = (editor: Component) => {
			layout.restoreEditorHost(editor);
		};

		getLogger().info("reload.start");

		try {
			await session.reload();
			keybindings.reload();
			if (isExpandable(startupContent)) {
				startupContent.setExpanded(state.shell.$toolOutputExpanded.getState());
			}
			setRegisteredThemes(session.resourceLoader.getThemes().themes);
			state.shell.setHideThinkingBlock(session.settingsManager.getHideThinkingBlock());
			const themeName = session.settingsManager.getTheme();
			const themeResult = themeName ? setTheme(themeName, true) : { success: true };
			if (!themeResult.success) {
				showError({ chatContainer, ui }, `Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`);
			}
			const editorPaddingX = session.settingsManager.getEditorPaddingX();
			const autocompleteMaxVisible = session.settingsManager.getAutocompleteMaxVisible();
			defaultEditor.setPaddingX(editorPaddingX);
			defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
			const editor = getEditor();
			if (editor !== defaultEditor) {
				editor.setPaddingX?.(editorPaddingX);
				editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
			}
			ui.setShowHardwareCursor(session.settingsManager.getShowHardwareCursor());
			ui.setClearOnShrink(session.settingsManager.getClearOnShrink());
			refreshAutocomplete();
			setupExtensionShortcuts();
			rebuildChatFromMessages();
			dismissReloadBox(getEditor());
			showLoadedResources();
			const modelsJsonError = session.modelRegistry.getError();
			if (modelsJsonError) {
				showError({ chatContainer, ui }, `models.json error: ${modelsJsonError}`);
			}
			applyLoggerConfig(session);
			getLogger().info("reload.complete");
			showStatus({ chatContainer, ui }, "Reloaded keybindings, extensions, skills, prompts, themes");
		} catch (error) {
			dismissReloadBox(previousEditor);
			getLogger().error("reload.error", { error });
			showError({ chatContainer, ui }, `Reload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
}

export const reloadCommand: TuiCommand<ReloadDependencies> = {
	name: "reload",
	description: "Reload keybindings, extensions, skills, prompts, and themes",
	execute(dependencies) {
		return runReload(dependencies);
	},
};

function showStatus({ chatContainer, ui }: { chatContainer: Container; ui: TUI }, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("success", `✓ ${message}`), 1, 0));
	ui.requestRender();
}

function showWarning({ chatContainer, ui }: { chatContainer: Container; ui: TUI }, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${message}`), 1, 0));
	ui.requestRender();
}

function showError({ chatContainer, ui }: { chatContainer: Container; ui: TUI }, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
	ui.requestRender();
}
