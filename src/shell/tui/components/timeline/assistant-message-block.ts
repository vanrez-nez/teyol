import type { AssistantMessage, ToolCall } from "#ai/index.js";
import type { ToolDefinition } from "#shell/runtime/extensions/types.js";
import { Markdown, type MarkdownTheme, Spacer, Text } from "#tui/index.js";
import type { TUI } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { AssistantToolBlock } from "./assistant-tool-block.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

export interface AssistantMessageBlockState {
	message?: AssistantMessage;
}

export interface SerializedAssistantMessageBlock {
	type: "assistant-message";
	id: string;
	state: AssistantMessageBlockState;
}

export interface AssistantMessageBlockOptions extends TimelineBlockOptions {
	message?: AssistantMessage;
	hideThinkingBlock?: boolean;
	markdownTheme?: MarkdownTheme;
	hiddenThinkingLabel?: string;
	showImages?: boolean;
	imageWidthCells?: number;
	getToolDefinition?: (toolName: string) => ToolDefinition<any, any> | undefined;
	ui?: TUI;
	cwd?: string;
}

export class AssistantMessageBlock extends TimelineBlock {
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private toolBlocks = new Map<string, AssistantToolBlock>();
	private showImages: boolean;
	private imageWidthCells: number;
	private getToolDefinition: (toolName: string) => ToolDefinition<any, any> | undefined;
	private ui: TUI | undefined;
	private cwd: string;

	constructor(options: AssistantMessageBlockOptions = {}) {
		super("assistant-message", { ...options, terminal: { ...options.terminal, promptBoundary: true } });
		this.hideThinkingBlock = options.hideThinkingBlock ?? false;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
		this.hiddenThinkingLabel = options.hiddenThinkingLabel ?? "Thinking...";
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.getToolDefinition = options.getToolDefinition ?? (() => undefined);
		this.ui = options.ui;
		this.cwd = options.cwd ?? process.cwd();

		if (options.message) {
			this.updateContent(options.message);
		}
	}

	override invalidate(): void {
		super.invalidate();
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.markDirty();
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		this.markDirty();
	}

	getToolBlock(toolCallId: string): AssistantToolBlock | undefined {
		return this.toolBlocks.get(toolCallId);
	}

	getToolBlocks(): AssistantToolBlock[] {
		return [...this.toolBlocks.values()];
	}

	override findBlockById(id: string): TimelineBlock | undefined {
		if (this.id === id) {
			return this;
		}

		for (const block of this.toolBlocks.values()) {
			const found = block.findBlockById(id);
			if (found) {
				return found;
			}
		}

		return super.findBlockById(id);
	}

	ensureToolBlock(toolCall: ToolCall): AssistantToolBlock {
		const existing = this.toolBlocks.get(toolCall.id);
		if (existing) {
			existing.updateArgs(toolCall.arguments);
			return existing;
		}

		const block = new AssistantToolBlock({
			toolName: toolCall.name,
			toolCallId: toolCall.id,
			args: toolCall.arguments,
			showImages: this.showImages,
			imageWidthCells: this.imageWidthCells,
			toolDefinition: this.getToolDefinition(toolCall.name),
			ui: this.ui ?? ({ requestRender() {} } as TUI),
			cwd: this.cwd,
		});
		this.toolBlocks.set(toolCall.id, block);
		this.markDirty();
		return block;
	}

	setToolImagesVisible(show: boolean): void {
		this.showImages = show;
		for (const block of this.toolBlocks.values()) {
			block.setShowImages(show);
		}
		this.markDirty();
	}

	setToolImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		for (const block of this.toolBlocks.values()) {
			block.setImageWidthCells(width);
		}
		this.markDirty();
	}

	setToolsExpanded(expanded: boolean): void {
		for (const block of this.toolBlocks.values()) {
			block.setExpanded(expanded);
		}
		this.markDirty();
	}

	protected override shouldApplyTerminalBoundary(): boolean {
		return !this.hasToolCalls && super.shouldApplyTerminalBoundary();
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;
		this.hasToolCalls = message.content.some((content) => content.type === "toolCall");
		for (const content of message.content) {
			if (content.type === "toolCall") {
				this.ensureToolBlock(content);
			}
		}
		this.markDirty();
	}

	protected override rebuildChildren(): void {
		const message = this.lastMessage;
		if (!message) {
			return;
		}

		const hasVisibleContent = message.content.some(
			(content) =>
				(content.type === "text" && content.text.trim()) ||
				(content.type === "thinking" && content.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.addChild(new Spacer(1));
		}

		for (let index = 0; index < message.content.length; index++) {
			const content = message.content[index];
			if (content.type === "text" && content.text.trim()) {
				this.addChild(new Markdown(content.text.trim(), 1, 0, this.markdownTheme));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				const hasVisibleContentAfter = message.content
					.slice(index + 1)
					.some(
						(nextContent) =>
							(nextContent.type === "text" && nextContent.text.trim()) ||
							(nextContent.type === "thinking" && nextContent.thinking.trim()),
					);

				if (this.hideThinkingBlock) {
					this.addChild(new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), 1, 0));
					if (hasVisibleContentAfter) {
						this.addChild(new Spacer(1));
					}
				} else {
					this.addChild(
						new Markdown(content.thinking.trim(), 1, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.addChild(new Spacer(1));
					}
				}
			} else if (content.type === "toolCall") {
				this.addChild(this.ensureToolBlock(content));
			}
		}

		if (!this.hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.addChild(new Spacer(1));
				this.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.addChild(new Spacer(1));
				this.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}

	serialize(): SerializedAssistantMessageBlock {
		return {
			type: "assistant-message",
			id: this.id,
			state: {
				message: this.lastMessage,
			},
		};
	}
}
