import type { AgentMessage } from "#agent/index.js";
import type { AssistantMessage } from "#ai/index.js";
import type { AgentSession } from "#shell/runtime/agent-session.js";
import { parseSkillBlock } from "#shell/runtime/agent-session.js";
import type { SessionContext } from "#shell/runtime/session-manager.js";
import type { ToolDefinition } from "#shell/runtime/extensions/types.js";
import type { Component, Container, EditorComponent, MarkdownTheme, TUI } from "#tui/index.js";
import { Spacer, Text, TruncatedText } from "#tui/index.js";
import { APP_NAME } from "../../config.js";
import { theme } from "../theme/theme.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { keyText } from "./components/keybinding-hints.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { AssistantMessageBlock, type AssistantMessageBlockOptions } from "./components/timeline/assistant-message-block.js";
import { CompactionSummaryBlock } from "./components/timeline/compaction-summary-block.js";
import type { LoadedResourcesBlock } from "./components/timeline/loaded-resources-block.js";
import type { TimelineBlock } from "./components/timeline/base-block.js";
import { LogoBlock } from "./components/timeline/logo-block.js";
import { StartupBlock } from "./components/timeline/startup-block.js";
import { UserMessageBlock } from "./components/timeline/user-message-block.js";
import { formatAppKeyDisplay, getUserMessageText } from "./display-helpers.js";
import type { ShellLayoutComponent } from "./layout.js";
import type { CliState } from "./state/index.js";
import { Timeline } from "./timeline.js";

interface Expandable {
	setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export interface TimelineCompositionDependencies {
	ui: TUI;
	timeline: Timeline;
	chatContainer: Container;
	pendingMessagesContainer: Container;
	statusContainer: Container;
	state: CliState;
	footer: ShellLayoutComponent["footer"];
	getSession(): AgentSession;
	getEditor(): EditorComponent;
	getMarkdownTheme(): MarkdownTheme;
	getRegisteredToolDefinition(toolName: string): ToolDefinition<any, any> | undefined;
	updateEditorBorderColor(): void;
}

export interface StartupContentOptions {
	versionLine: string;
	expandedInstructions: string;
	compactInstructions: string;
	compactOnboarding: string;
	onboarding: string;
	expanded: boolean;
}

export class TimelineComposition {
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: Text | undefined = undefined;
	private startupContent: TimelineBlock | undefined = undefined;
	private loadedResourcesBlock: LoadedResourcesBlock | undefined = undefined;

	constructor(private readonly dependencies: TimelineCompositionDependencies) {}

	getStartupContent(): Component | undefined {
		return this.startupContent;
	}

	renderStartupContent(options: StartupContentOptions | undefined): void {
		this.dependencies.timeline.clearBlocks();
		this.loadedResourcesBlock = undefined;
		if (!options) {
			this.startupContent = undefined;
			this.dependencies.ui.requestRender();
			return;
		}

		const startupBlock = new StartupBlock({
			expandedInstructions: options.expandedInstructions,
			compactInstructions: options.compactInstructions,
			compactOnboarding: options.compactOnboarding,
			onboarding: options.onboarding,
			expanded: options.expanded,
			padding: { left: 1 },
			margin: { bottom: 1 },
		});
		this.startupContent = startupBlock;

		this.dependencies.timeline.pushBlock(new LogoBlock({ versionLine: options.versionLine, margin: { top: 1 }, padding: { bottom: 1 } }));
		this.dependencies.timeline.pushBlock(startupBlock);
		this.dependencies.ui.requestRender();
	}

	setLoadedResourcesBlock(block: LoadedResourcesBlock | undefined): void {
		if (this.loadedResourcesBlock) {
			this.dependencies.timeline.removeBlock(this.loadedResourcesBlock);
		}

		this.loadedResourcesBlock = block;
		if (!block) {
			this.dependencies.ui.requestRender();
			return;
		}

		const inserted = this.startupContent ? this.dependencies.timeline.insertBlockAfter(this.startupContent, block) : false;
		if (!inserted) {
			this.dependencies.timeline.pushBlock(block);
		}

		this.dependencies.ui.requestRender();
	}

	clear(): void {
		this.dependencies.timeline.clear();
		this.startupContent = undefined;
		this.loadedResourcesBlock = undefined;
		this.dependencies.pendingMessagesContainer.clear();
		this.lastStatusSpacer = undefined;
		this.lastStatusText = undefined;
	}

	clearStatus(): void {
		this.dependencies.statusContainer.clear();
	}

	addStatusComponent(component: Component): void {
		this.dependencies.statusContainer.addChild(component);
	}

	showStatus(message: string): void {
		const { chatContainer, ui } = this.dependencies;
		const children = chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
			this.lastStatusText.setText(theme.fg("dim", message));
			ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		chatContainer.addChild(spacer);
		chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.dependencies.chatContainer.addChild(new Spacer(1));
		this.dependencies.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.dependencies.ui.requestRender();
	}

	showRawError(errorMessage: string): void {
		this.dependencies.chatContainer.addChild(new Spacer(1));
		this.dependencies.chatContainer.addChild(new Text(theme.fg("error", errorMessage), 1, 0));
		this.dependencies.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.dependencies.chatContainer.addChild(new Spacer(1));
		this.dependencies.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.dependencies.ui.requestRender();
	}

	showNewVersionNotification(newVersion: string): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;

		this.dependencies.chatContainer.addChild(new Spacer(1));
		this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.dependencies.chatContainer.addChild(
			new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`, 1, 0),
		);
		this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.dependencies.ui.requestRender();
	}

	showPackageUpdateNotification(packages: string[]): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
		const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

		this.dependencies.chatContainer.addChild(new Spacer(1));
		this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.dependencies.chatContainer.addChild(
			new Text(
				`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
				1,
				0,
			),
		);
		this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.dependencies.ui.requestRender();
	}

	addMessage(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		const { chatContainer, state } = this.dependencies;
		switch (message.role) {
			case "custom": {
				if (message.display) {
					const renderer = this.dependencies.getSession().extensionRunner.getMessageRenderer(message.customType);
					const component = new CustomMessageComponent(message, renderer, this.dependencies.getMarkdownTheme());
					component.setExpanded(state.shell.$toolOutputExpanded.getState());
					chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.dependencies.timeline.pushBlock(
					new CompactionSummaryBlock({
						message,
						expanded: state.shell.$toolOutputExpanded.getState(),
						markdownTheme: this.dependencies.getMarkdownTheme(),
					}),
				);
				break;
			}
			case "user": {
				const textContent = getUserMessageText(message);
				if (textContent) {
					const skillBlock = parseSkillBlock(textContent);
					if (skillBlock) {
						const component = new SkillInvocationMessageComponent(skillBlock, this.dependencies.getMarkdownTheme());
						component.setExpanded(state.shell.$toolOutputExpanded.getState());
						chatContainer.addChild(component);
						if (skillBlock.userMessage) {
							this.pushUserMessageBlock(skillBlock.userMessage);
						}
					} else {
						this.pushUserMessageBlock(textContent);
					}
					if (options?.populateHistory) {
						this.dependencies.getEditor().addToHistory?.(textContent);
					}
				}
				break;
			}
			case "assistant": {
				this.pushAssistantMessageBlock(message);
				break;
			}
			case "toolResult":
			case "branchSummary":
				break;
			default: {
				const _exhaustive: never = message;
				void _exhaustive;
			}
		}
	}

	renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		let currentAssistantBlock: AssistantMessageBlock | undefined;

		if (options.updateFooter) {
			this.dependencies.footer.invalidate();
			this.dependencies.updateEditorBorderColor();
		}

		for (const message of sessionContext.messages) {
			if (message.role === "assistant") {
				const assistantBlock = this.pushAssistantMessageBlock(message);
				currentAssistantBlock = assistantBlock;
				for (const content of message.content) {
					if (content.type === "toolCall") {
						if (message.stopReason === "aborted" || message.stopReason === "error") {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = this.dependencies.getSession().retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							assistantBlock.setToolResult(content.id, { content: [{ type: "text", text: errorMessage }] }, true);
						}
					}
				}
			} else if (message.role === "toolResult") {
				currentAssistantBlock?.setToolResult(message.toolCallId, message, message.isError);
			} else {
				this.addMessage(message, options);
			}
		}

		this.dependencies.ui.requestRender();
	}

	renderInitialMessages(): void {
		const context = this.dependencies.getSession().sessionManager.buildSessionContext();
		this.renderSessionContext(context, {
			updateFooter: true,
			populateHistory: true,
		});

		const allEntries = this.dependencies.getSession().sessionManager.getEntries();
		const compactionCount = allEntries.filter((entry) => entry.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
	}

	rebuildFromMessages(): void {
		this.dependencies.timeline.clear();
		this.startupContent = undefined;
		this.loadedResourcesBlock = undefined;
		const context = this.dependencies.getSession().sessionManager.buildSessionContext();
		this.renderSessionContext(context);
	}

	updatePendingMessagesDisplay(messages: { steering: string[]; followUp: string[] }): void {
		this.dependencies.pendingMessagesContainer.clear();
		if (messages.steering.length > 0 || messages.followUp.length > 0) {
			this.dependencies.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of messages.steering) {
				const text = theme.fg("dim", `Steering: ${message}`);
				this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			for (const message of messages.followUp) {
				const text = theme.fg("dim", `Follow-up: ${message}`);
				this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			const dequeueHint = formatAppKeyDisplay(keyText("app.message.dequeue"));
			const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
			this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
	}

	setHiddenThinkingLabel(label?: string): void {
		this.dependencies.state.shell.setHiddenThinkingLabel(label);
		for (const block of this.dependencies.timeline.getBlocks()) {
			if (block instanceof AssistantMessageBlock) {
				block.setHiddenThinkingLabel(this.dependencies.state.shell.$hiddenThinkingLabel.getState());
			}
		}
		this.dependencies.ui.requestRender();
	}

	setToolsExpanded(expanded: boolean): void {
		this.dependencies.state.shell.setToolsExpanded(expanded);
		if (isExpandable(this.startupContent)) {
			this.startupContent.setExpanded(expanded);
		}
		for (const block of this.dependencies.timeline.getBlocks()) {
			if (isExpandable(block)) {
				block.setExpanded(expanded);
			}
			if (block instanceof AssistantMessageBlock) {
				block.setToolsExpanded(expanded);
			}
		}
		for (const child of this.dependencies.chatContainer.children) {
			if (isExpandable(child)) {
				child.setExpanded(expanded);
			}
		}
		this.dependencies.ui.requestRender();
	}

	rebuildForThinkingVisibility(): void {
		for (const block of this.dependencies.timeline.getBlocks()) {
			if (block instanceof AssistantMessageBlock) {
				block.setHideThinkingBlock(this.dependencies.state.shell.$hideThinkingBlock.getState());
			}
		}
		this.dependencies.ui.requestRender();
	}

	setToolImagesVisible(show: boolean): void {
		for (const block of this.dependencies.timeline.getBlocks()) {
			if (block instanceof AssistantMessageBlock) {
				block.setToolImagesVisible(show);
			}
		}
		this.dependencies.ui.requestRender();
	}

	setToolImageWidthCells(width: number): void {
		for (const block of this.dependencies.timeline.getBlocks()) {
			if (block instanceof AssistantMessageBlock) {
				block.setToolImageWidthCells(width);
			}
		}
		this.dependencies.ui.requestRender();
	}

	private pushUserMessageBlock(text: string): void {
		this.dependencies.timeline.pushBlock(
			new UserMessageBlock({
				text,
				markdownTheme: this.dependencies.getMarkdownTheme(),
				margin: { top: this.dependencies.timeline.getBlockCount() > 0 ? 1 : 0 },
			}),
		);
	}

	private pushAssistantMessageBlock(message: AssistantMessage): AssistantMessageBlock {
		return this.addAssistantMessageBlock(message);
	}

	addAssistantMessageBlock(message?: AssistantMessage): AssistantMessageBlock {
		const block = this.createAssistantMessageBlock({
			message,
			margin: { top: this.dependencies.timeline.getBlockCount() > 0 ? 1 : 0 },
		});
		this.dependencies.timeline.pushBlock(block);
		return block;
	}

	private createAssistantMessageBlock(options: AssistantMessageBlockOptions = {}): AssistantMessageBlock {
		const session = this.dependencies.getSession();
		return new AssistantMessageBlock({
			hideThinkingBlock: this.dependencies.state.shell.$hideThinkingBlock.getState(),
			markdownTheme: this.dependencies.getMarkdownTheme(),
			hiddenThinkingLabel: this.dependencies.state.shell.$hiddenThinkingLabel.getState(),
			showImages: session.settingsManager.getShowImages(),
			imageWidthCells: session.settingsManager.getImageWidthCells(),
			toolsExpanded: this.dependencies.state.shell.$toolOutputExpanded.getState(),
			getToolDefinition: (toolName) => this.dependencies.getRegisteredToolDefinition(toolName),
			ui: this.dependencies.ui,
			cwd: session.sessionManager.getCwd(),
			...options,
		});
	}

}
