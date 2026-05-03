import type { AssistantMessage } from "#ai/index.js";
import { Markdown, type MarkdownTheme, Spacer, Text } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

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
}

export class AssistantMessageBlock extends TimelineBlock {
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;

	constructor(options: AssistantMessageBlockOptions = {}) {
		super("assistant-message", options);
		this.hideThinkingBlock = options.hideThinkingBlock ?? false;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
		this.hiddenThinkingLabel = options.hiddenThinkingLabel ?? "Thinking...";

		if (options.message) {
			this.updateContent(options.message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;
		this.clear();

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
			}
		}

		this.hasToolCalls = message.content.some((content) => content.type === "toolCall");
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
