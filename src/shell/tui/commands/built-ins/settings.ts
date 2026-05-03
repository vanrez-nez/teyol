import type { AgentSession } from "#shell/runtime/agent-session.js";
import { type Component, type Container, type EditorComponent, Spacer, Text, type TUI } from "#tui/index.js";
import { setTheme, getAvailableThemes, theme } from "../../../theme/theme.js";
import { AssistantMessageComponent } from "../../components/assistant-message.js";
import type { CustomEditor } from "../../components/custom-editor.js";
import { SettingsSelectorComponent } from "../../components/settings-selector.js";
import { ToolExecutionComponent } from "../../components/tool-execution.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { CliState } from "../../state/index.js";
import type { TuiCommand } from "../types.js";

export const settingsCommand: TuiCommand<{
	session: AgentSession;
	state: CliState;
	ui: TUI;
	layout: ShellLayoutComponent;
	chatContainer: Container;
	footer: ShellLayoutComponent["footer"];
	defaultEditor: CustomEditor;
	getEditor(): EditorComponent;
	refreshAutocomplete(): void;
	rebuildChatFromMessages(): void;
	updateEditorBorderColor(): void;
}> = {
	name: "settings",
	description: "Open settings menu",
	execute({
		session,
		state,
		ui,
		layout,
		chatContainer,
		footer,
		defaultEditor,
		getEditor,
		refreshAutocomplete,
		rebuildChatFromMessages,
		updateEditorBorderColor,
	}) {
		const restoreEditor = () => {
			layout.restoreEditorHost(getEditor() as Component);
		};
		const selector = new SettingsSelectorComponent(
			{
				autoCompact: session.autoCompactionEnabled,
				showImages: session.settingsManager.getShowImages(),
				imageWidthCells: session.settingsManager.getImageWidthCells(),
				autoResizeImages: session.settingsManager.getImageAutoResize(),
				blockImages: session.settingsManager.getBlockImages(),
				enableSkillCommands: session.settingsManager.getEnableSkillCommands(),
				steeringMode: session.steeringMode,
				followUpMode: session.followUpMode,
				transport: session.settingsManager.getTransport(),
				thinkingLevel: session.thinkingLevel,
				availableThinkingLevels: session.getAvailableThinkingLevels(),
				currentTheme: session.settingsManager.getTheme() || "dark",
				availableThemes: getAvailableThemes(),
				hideThinkingBlock: state.shell.$hideThinkingBlock.getState(),
				collapseChangelog: session.settingsManager.getCollapseChangelog(),
				enableInstallTelemetry: session.settingsManager.getEnableInstallTelemetry(),
				doubleEscapeAction: session.settingsManager.getDoubleEscapeAction(),
				treeFilterMode: session.settingsManager.getTreeFilterMode(),
				showHardwareCursor: session.settingsManager.getShowHardwareCursor(),
				editorPaddingX: session.settingsManager.getEditorPaddingX(),
				autocompleteMaxVisible: session.settingsManager.getAutocompleteMaxVisible(),
				quietStartup: session.settingsManager.getQuietStartup(),
				clearOnShrink: session.settingsManager.getClearOnShrink(),
				showTerminalProgress: session.settingsManager.getShowTerminalProgress(),
				warnings: session.settingsManager.getWarnings(),
			},
			{
				onAutoCompactChange: (enabled) => {
					session.setAutoCompactionEnabled(enabled);
					state.footer.setAutoCompactEnabled(enabled);
					footer.setAutoCompactEnabled(enabled);
				},
				onShowImagesChange: (enabled) => {
					session.settingsManager.setShowImages(enabled);
					for (const child of chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setShowImages(enabled);
						}
					}
				},
				onImageWidthCellsChange: (width) => {
					session.settingsManager.setImageWidthCells(width);
					for (const child of chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setImageWidthCells(width);
						}
					}
				},
				onAutoResizeImagesChange: (enabled) => {
					session.settingsManager.setImageAutoResize(enabled);
				},
				onBlockImagesChange: (blocked) => {
					session.settingsManager.setBlockImages(blocked);
				},
				onEnableSkillCommandsChange: (enabled) => {
					session.settingsManager.setEnableSkillCommands(enabled);
					refreshAutocomplete();
				},
				onSteeringModeChange: (mode) => {
					session.setSteeringMode(mode);
				},
				onFollowUpModeChange: (mode) => {
					session.setFollowUpMode(mode);
				},
				onTransportChange: (transport) => {
					session.settingsManager.setTransport(transport);
					session.agent.transport = transport;
				},
				onThinkingLevelChange: (level) => {
					session.setThinkingLevel(level);
					footer.invalidate();
					updateEditorBorderColor();
				},
				onThemeChange: (themeName) => {
					const result = setTheme(themeName, true);
					session.settingsManager.setTheme(themeName);
					ui.invalidate();
					if (!result.success) {
						chatContainer.addChild(new Spacer(1));
						chatContainer.addChild(
							new Text(theme.fg("error", `Error: Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`), 1, 0),
						);
						ui.requestRender();
					}
				},
				onThemePreview: (themeName) => {
					const result = setTheme(themeName, true);
					if (result.success) {
						ui.invalidate();
						ui.requestRender();
					}
				},
				onHideThinkingBlockChange: (hidden) => {
					state.shell.setHideThinkingBlock(hidden);
					session.settingsManager.setHideThinkingBlock(hidden);
					for (const child of chatContainer.children) {
						if (child instanceof AssistantMessageComponent) {
							child.setHideThinkingBlock(hidden);
						}
					}
					chatContainer.clear();
					rebuildChatFromMessages();
				},
				onCollapseChangelogChange: (collapsed) => {
					session.settingsManager.setCollapseChangelog(collapsed);
				},
				onEnableInstallTelemetryChange: (enabled) => {
					session.settingsManager.setEnableInstallTelemetry(enabled);
				},
				onQuietStartupChange: (enabled) => {
					session.settingsManager.setQuietStartup(enabled);
				},
				onDoubleEscapeActionChange: (action) => {
					session.settingsManager.setDoubleEscapeAction(action);
				},
				onTreeFilterModeChange: (mode) => {
					session.settingsManager.setTreeFilterMode(mode);
				},
				onShowHardwareCursorChange: (enabled) => {
					session.settingsManager.setShowHardwareCursor(enabled);
					ui.setShowHardwareCursor(enabled);
				},
				onEditorPaddingXChange: (padding) => {
					session.settingsManager.setEditorPaddingX(padding);
					defaultEditor.setPaddingX(padding);
					const editor = getEditor();
					if (editor !== defaultEditor && editor.setPaddingX !== undefined) {
						editor.setPaddingX(padding);
					}
				},
				onAutocompleteMaxVisibleChange: (maxVisible) => {
					session.settingsManager.setAutocompleteMaxVisible(maxVisible);
					defaultEditor.setAutocompleteMaxVisible(maxVisible);
					const editor = getEditor();
					if (editor !== defaultEditor && editor.setAutocompleteMaxVisible !== undefined) {
						editor.setAutocompleteMaxVisible(maxVisible);
					}
				},
				onClearOnShrinkChange: (enabled) => {
					session.settingsManager.setClearOnShrink(enabled);
					ui.setClearOnShrink(enabled);
				},
				onShowTerminalProgressChange: (enabled) => {
					session.settingsManager.setShowTerminalProgress(enabled);
				},
				onWarningsChange: (warnings) => {
					session.settingsManager.setWarnings(warnings);
				},
				onCancel: () => {
					restoreEditor();
					ui.requestRender();
				},
			},
		);
		layout.setEditorHost(selector, selector.getSettingsList());
	},
};
