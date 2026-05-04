import type { TextContent } from "#ai/index.js";
import type { MessageRenderer } from "#shell/runtime/extensions/types.js";
import type { CustomMessage } from "#shell/runtime/messages.js";
import type { Component, MarkdownTheme } from "#tui/index.js";
import { Markdown, Spacer, Text } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockEdges, type TimelineBlockOptions } from "./base-block.js";

export interface CustomMessageBlockState {
	message: CustomMessage<unknown>;
	expanded: boolean;
}

export interface SerializedCustomMessageBlock {
	type: "custom-message";
	id: string;
	state: CustomMessageBlockState;
}

export interface CustomMessageBlockOptions extends TimelineBlockOptions {
	message: CustomMessage<unknown>;
	renderer?: MessageRenderer;
	markdownTheme?: MarkdownTheme;
	expanded: boolean;
}

export class CustomMessageBlock extends TimelineBlock {
	private readonly message: CustomMessage<unknown>;
	private readonly renderer: MessageRenderer | undefined;
	private readonly markdownTheme: MarkdownTheme;
	private expanded: boolean;

	constructor(options: CustomMessageBlockOptions) {
		super("custom-message", {
			...options,
			margin: mergeEdges({ top: 1 }, options.margin),
			padding: mergeEdges({ left: 1, top: 1, right: 1, bottom: 1 }, options.padding),
			background: options.background ?? "customMessageBg",
		});
		this.message = options.message;
		this.renderer = options.renderer;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
		this.expanded = options.expanded;
	}

	setDetailsExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.markDirty();
	}

	protected override rebuildChildren(): void {
		if (this.renderer) {
			try {
				const component = this.renderer(this.message, { expanded: this.expanded }, theme);
				if (component) {
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering.
			}
		}

		const label = theme.fg("customMessageLabel", `\x1b[1m[${this.message.customType}]\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		this.addChild(
			new Markdown(this.getTextContent(), 0, 0, this.markdownTheme, {
				color: (content: string) => theme.fg("customMessageText", content),
			}),
		);
	}

	serialize(): SerializedCustomMessageBlock {
		return {
			type: "custom-message",
			id: this.id,
			state: {
				message: this.message,
				expanded: this.expanded,
			},
		};
	}

	private getTextContent(): string {
		if (typeof this.message.content === "string") {
			return this.message.content;
		}

		return this.message.content
			.filter((content): content is TextContent => content.type === "text")
			.map((content) => content.text)
			.join("\n");
	}
}

function mergeEdges(defaults: TimelineBlockEdges, overrides: TimelineBlockEdges | undefined): TimelineBlockEdges {
	return { ...defaults, ...overrides };
}
