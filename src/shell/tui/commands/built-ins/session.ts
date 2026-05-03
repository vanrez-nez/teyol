import type { AgentSession } from "#shell/runtime/agent-session.js";
import type { AgentSessionRuntime } from "#shell/runtime/agent-session-runtime.js";
import { MissingSessionCwdError, SessionManager } from "#shell/runtime/session-manager.js";
import type { ExtensionCommandContext } from "#shell/runtime/extensions/index.js";
import type { KeybindingsManager } from "#shell/runtime/keybindings.js";
import { type AutocompleteItem, type Container, type EditorComponent, Loader, Spacer, Text, type TUI } from "#tui/index.js";
import { theme } from "../../../theme/theme.js";
import { SessionActionsSelectorComponent, type SessionAction } from "../../components/commands/session-actions-selector.js";
import { formatSessionInfo } from "../../display-helpers.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { TuiCommand } from "../types.js";
import { SessionSelectorComponent } from "../../components/session-selector.js";
import { TreeSelectorComponent } from "../../components/commands/tree-selector.js";
import { UserMessageSelectorComponent } from "../../components/commands/user-message-selector.js";
import { keyText } from "../../components/keybinding-hints.js";
import type { CustomEditor } from "../../components/custom-editor.js";

const sessionActions: Array<{ value: SessionAction; description: string }> = [
	{ value: "info", description: "Show current session info and stats" },
	{ value: "new", description: "Start a new session" },
	{ value: "resume", description: "Resume a different session" },
	{ value: "compact", description: "Manually compact session context" },
	{ value: "tree", description: "Navigate session tree" },
	{ value: "clone", description: "Duplicate current session position" },
	{ value: "fork", description: "Fork from a previous user message" },
];

export interface SessionCommandDependencies {
	session: AgentSession;
	runtimeHost: AgentSessionRuntime;
	chatContainer: Container;
	statusContainer: Container;
	layout: ShellLayoutComponent;
	ui: TUI;
	editor: EditorComponent;
	defaultEditor: CustomEditor;
	keybindings: KeybindingsManager;
	stopLoadingAnimation(): void;
	renderCurrentSessionState(): void;
	renderInitialMessages(): void;
	showExtensionSelector(title: string, options: string[]): Promise<string | undefined>;
	showExtensionEditor(title: string, prefill?: string): Promise<string | undefined>;
	promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
	handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
	flushCompactionQueue(options: { willRetry: boolean }): void | Promise<void>;
	shutdown(): Promise<void>;
}

function isSessionAction(action: string | undefined): action is SessionAction {
	return (
		action === "info" ||
		action === "new" ||
		action === "resume" ||
		action === "compact" ||
		action === "tree" ||
		action === "clone" ||
		action === "fork"
	);
}

function showSessionInfo({ chatContainer, session, ui }: SessionCommandDependencies): void {
	const stats = session.getSessionStats();
	const sessionName = session.sessionManager.getSessionName();
	const info = formatSessionInfo(stats, sessionName);

	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(info, 1, 0));
	ui.requestRender();
}

async function handleSessionAction(dependencies: SessionCommandDependencies, action: SessionAction): Promise<void> {
	switch (action) {
		case "info":
			showSessionInfo(dependencies);
			return;
		case "new":
			await startNewSession(dependencies);
			return;
		case "resume":
			showSessionSelector(dependencies);
			return;
		case "compact":
			await compactSession(dependencies);
			return;
		case "tree":
			showTreeSelector(dependencies);
			return;
		case "clone":
			await cloneSession(dependencies);
			return;
		case "fork":
			showUserMessageSelector(dependencies);
			return;
	}
}

function showSessionActionsSelector(dependencies: SessionCommandDependencies): void {
	const { layout, ui } = dependencies;
	const done = () => layout.restoreEditorHost(dependencies.editor);
	const selector = new SessionActionsSelectorComponent(
		(action) => {
			done();
			void handleSessionAction(dependencies, action);
		},
		() => {
			done();
			ui.requestRender();
		},
	);
	layout.setEditorHost(selector, selector.getSelectList());
}

export async function startNewSession(
	dependencies: SessionCommandDependencies,
	options?: Parameters<ExtensionCommandContext["newSession"]>[0],
): Promise<{ cancelled: boolean }> {
	dependencies.stopLoadingAnimation();
	dependencies.statusContainer.clear();
	try {
		const result = await dependencies.runtimeHost.newSession(options);
		if (result.cancelled) {
			return result;
		}
		dependencies.renderCurrentSessionState();
		dependencies.chatContainer.addChild(new Spacer(1));
		dependencies.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
		dependencies.ui.requestRender();
		return result;
	} catch (error: unknown) {
		return dependencies.handleFatalRuntimeError("Failed to create session", error);
	}
}

export async function forkSessionAtEntry(
	dependencies: SessionCommandDependencies,
	entryId: string,
	options?: Parameters<ExtensionCommandContext["fork"]>[1],
): Promise<{ cancelled: boolean }> {
	try {
		const result = await dependencies.runtimeHost.fork(entryId, options);
		if (!result.cancelled) {
			dependencies.renderCurrentSessionState();
			dependencies.editor.setText(result.selectedText ?? "");
			showStatus(dependencies, "Forked to new session");
		}
		return { cancelled: result.cancelled };
	} catch (error: unknown) {
		return dependencies.handleFatalRuntimeError("Failed to fork session", error);
	}
}

export async function navigateSessionTree(
	dependencies: SessionCommandDependencies,
	targetId: string,
	options?: Parameters<ExtensionCommandContext["navigateTree"]>[1],
): Promise<{ cancelled: boolean }> {
	const result = await dependencies.session.navigateTree(targetId, {
		summarize: options?.summarize,
		customInstructions: options?.customInstructions,
		replaceInstructions: options?.replaceInstructions,
		label: options?.label,
	});
	if (result.cancelled) {
		return { cancelled: true };
	}

	dependencies.chatContainer.clear();
	dependencies.renderInitialMessages();
	if (result.editorText && !dependencies.editor.getText().trim()) {
		dependencies.editor.setText(result.editorText);
	}
	showStatus(dependencies, "Navigated to selected point");
	void dependencies.flushCompactionQueue({ willRetry: false });
	return { cancelled: false };
}

export function showUserMessageSelector(dependencies: SessionCommandDependencies): void {
	const userMessages = dependencies.session.getUserMessagesForForking();

	if (userMessages.length === 0) {
		showStatus(dependencies, "No messages to fork from");
		return;
	}

	const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;
	const done = () => dependencies.layout.restoreEditorHost(dependencies.editor);
	const selector = new UserMessageSelectorComponent(
		userMessages.map((m) => ({ id: m.entryId, text: m.text })),
		async (entryId) => {
			try {
				const result = await dependencies.runtimeHost.fork(entryId);
				if (result.cancelled) {
					done();
					dependencies.ui.requestRender();
					return;
				}

				dependencies.renderCurrentSessionState();
				dependencies.editor.setText(result.selectedText ?? "");
				done();
				showStatus(dependencies, "Forked to new session");
			} catch (error: unknown) {
				done();
				showError(dependencies, error instanceof Error ? error.message : String(error));
			}
		},
		() => {
			done();
			dependencies.ui.requestRender();
		},
		initialSelectedId,
	);
	dependencies.layout.setEditorHost(selector, selector.getMessageList());
}

export async function cloneSession(dependencies: SessionCommandDependencies): Promise<void> {
	const leafId = dependencies.session.sessionManager.getLeafId();
	if (!leafId) {
		showStatus(dependencies, "Nothing to clone yet");
		return;
	}

	try {
		const result = await dependencies.runtimeHost.fork(leafId, { position: "at" });
		if (result.cancelled) {
			dependencies.ui.requestRender();
			return;
		}

		dependencies.renderCurrentSessionState();
		dependencies.editor.setText("");
		showStatus(dependencies, "Cloned to new session");
	} catch (error: unknown) {
		showError(dependencies, error instanceof Error ? error.message : String(error));
	}
}

export function showTreeSelector(dependencies: SessionCommandDependencies, initialSelectedId?: string): void {
	const tree = dependencies.session.sessionManager.getTree();
	const realLeafId = dependencies.session.sessionManager.getLeafId();
	const initialFilterMode = dependencies.session.settingsManager.getTreeFilterMode();

	if (tree.length === 0) {
		showStatus(dependencies, "No entries in session");
		return;
	}

	const done = () => dependencies.layout.restoreEditorHost(dependencies.editor);
	const selector = new TreeSelectorComponent(
		tree,
		realLeafId,
		dependencies.ui.terminal.rows,
		async (entryId) => {
			if (entryId === realLeafId) {
				done();
				showStatus(dependencies, "Already at this point");
				return;
			}

			done();

			let wantsSummary = false;
			let customInstructions: string | undefined;

			if (!dependencies.session.settingsManager.getBranchSummarySkipPrompt()) {
				while (true) {
					const summaryChoice = await dependencies.showExtensionSelector("Summarize branch?", [
						"No summary",
						"Summarize",
						"Summarize with custom prompt",
					]);

					if (summaryChoice === undefined) {
						showTreeSelector(dependencies, entryId);
						return;
					}

					wantsSummary = summaryChoice !== "No summary";

					if (summaryChoice === "Summarize with custom prompt") {
						customInstructions = await dependencies.showExtensionEditor("Custom summarization instructions");
						if (customInstructions === undefined) {
							continue;
						}
					}

					break;
				}
			}

			let summaryLoader: Loader | undefined;
			const originalOnEscape = dependencies.defaultEditor.onEscape;

			if (wantsSummary) {
				dependencies.defaultEditor.onEscape = () => {
					dependencies.session.abortBranchSummary();
				};
				dependencies.chatContainer.addChild(new Spacer(1));
				summaryLoader = new Loader(
					dependencies.ui,
					(spinner) => theme.fg("accent", spinner),
					(text) => theme.fg("muted", text),
					`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
				);
				dependencies.statusContainer.addChild(summaryLoader);
				dependencies.ui.requestRender();
			}

			try {
				const result = await dependencies.session.navigateTree(entryId, {
					summarize: wantsSummary,
					customInstructions,
				});

				if (result.aborted) {
					showStatus(dependencies, "Branch summarization cancelled");
					showTreeSelector(dependencies, entryId);
					return;
				}
				if (result.cancelled) {
					showStatus(dependencies, "Navigation cancelled");
					return;
				}

				dependencies.chatContainer.clear();
				dependencies.renderInitialMessages();
				if (result.editorText && !dependencies.editor.getText().trim()) {
					dependencies.editor.setText(result.editorText);
				}
				showStatus(dependencies, "Navigated to selected point");
				void dependencies.flushCompactionQueue({ willRetry: false });
			} catch (error) {
				showError(dependencies, error instanceof Error ? error.message : String(error));
			} finally {
				if (summaryLoader) {
					summaryLoader.stop();
					dependencies.statusContainer.clear();
				}
				dependencies.defaultEditor.onEscape = originalOnEscape;
			}
		},
		() => {
			done();
			dependencies.ui.requestRender();
		},
		(entryId, label) => {
			dependencies.session.sessionManager.appendLabelChange(entryId, label);
			dependencies.ui.requestRender();
		},
		initialSelectedId,
		initialFilterMode,
	);
	dependencies.layout.setEditorHost(selector, selector);
}

export function showSessionSelector(dependencies: SessionCommandDependencies): void {
	const done = () => dependencies.layout.restoreEditorHost(dependencies.editor);
	const selector = new SessionSelectorComponent(
		(onProgress) =>
			SessionManager.list(dependencies.session.sessionManager.getCwd(), dependencies.session.sessionManager.getSessionDir(), onProgress),
		SessionManager.listAll,
		async (sessionPath) => {
			done();
			await resumeSession(dependencies, sessionPath);
		},
		() => {
			done();
			dependencies.ui.requestRender();
		},
		() => {
			void dependencies.shutdown();
		},
		() => dependencies.ui.requestRender(),
		{
			renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
				const next = (nextName ?? "").trim();
				if (!next) return;
				const mgr = SessionManager.open(sessionFilePath);
				mgr.appendSessionInfo(next);
			},
			showRenameHint: true,
			keybindings: dependencies.keybindings,
		},
		dependencies.session.sessionManager.getSessionFile(),
	);
	dependencies.layout.setEditorHost(selector, selector);
}

export async function resumeSession(
	dependencies: SessionCommandDependencies,
	sessionPath: string,
	options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
): Promise<{ cancelled: boolean }> {
	dependencies.stopLoadingAnimation();
	dependencies.statusContainer.clear();
	try {
		const result = await dependencies.runtimeHost.switchSession(sessionPath, {
			withSession: options?.withSession,
		});
		if (result.cancelled) {
			return result;
		}
		dependencies.renderCurrentSessionState();
		showStatus(dependencies, "Resumed session");
		return result;
	} catch (error: unknown) {
		if (error instanceof MissingSessionCwdError) {
			const selectedCwd = await dependencies.promptForMissingSessionCwd(error);
			if (!selectedCwd) {
				showStatus(dependencies, "Resume cancelled");
				return { cancelled: true };
			}
			const result = await dependencies.runtimeHost.switchSession(sessionPath, {
				cwdOverride: selectedCwd,
				withSession: options?.withSession,
			});
			if (result.cancelled) {
				return result;
			}
			dependencies.renderCurrentSessionState();
			showStatus(dependencies, "Resumed session in current cwd");
			return result;
		}
		return dependencies.handleFatalRuntimeError("Failed to resume session", error);
	}
}

export async function compactSession(
	dependencies: SessionCommandDependencies,
	customInstructions?: string,
): Promise<void> {
	const entries = dependencies.session.sessionManager.getEntries();
	const messageCount = entries.filter((e) => e.type === "message").length;

	if (messageCount < 2) {
		showWarning(dependencies, "Nothing to compact (no messages yet)");
		return;
	}

	dependencies.stopLoadingAnimation();
	dependencies.statusContainer.clear();

	try {
		await dependencies.session.compact(customInstructions);
	} catch {
		// Ignore, will be emitted as an event.
	}
}

function showStatus({ chatContainer, ui }: Pick<SessionCommandDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("success", `✓ ${message}`), 1, 0));
	ui.requestRender();
}

function showWarning({ chatContainer, ui }: Pick<SessionCommandDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${message}`), 1, 0));
	ui.requestRender();
}

function showError({ chatContainer, ui }: Pick<SessionCommandDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
	ui.requestRender();
}

export const sessionCommand: TuiCommand<SessionCommandDependencies> = {
	name: "session",
	description: "Manage sessions",
	complete(_dependencies, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart().toLowerCase();
		const filtered = sessionActions.filter((action) => action.value.startsWith(normalizedPrefix));
		if (filtered.length === 0) return null;
		return filtered.map((action) => ({
			value: action.value,
			label: action.value,
			description: action.description,
		}));
	},
	async execute(dependencies, invocation) {
		const actionText = invocation.args.trim() || undefined;
		if (!actionText) {
			showSessionActionsSelector(dependencies);
			return;
		}

		const [action] = actionText.split(/\s+/, 1);
		if (isSessionAction(action)) {
			await handleSessionAction(dependencies, action);
			return;
		}

		dependencies.chatContainer.addChild(new Spacer(1));
		dependencies.chatContainer.addChild(
			new Text(theme.fg("error", "Error: Unknown session action. Use: info, new, resume, compact, tree, clone, fork"), 1, 0),
		);
		dependencies.ui.requestRender();
	},
};
