import { Box, Markdown, type MarkdownTheme } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

export interface UserMessageBlockState {
	text: string;
}

export interface SerializedUserMessageBlock {
	type: "user-message";
	id: string;
	state: UserMessageBlockState;
}

export interface UserMessageBlockOptions extends TimelineBlockOptions {
	text: string;
	markdownTheme?: MarkdownTheme;
}

export class UserMessageBlock extends TimelineBlock {
	private readonly text: string;
	private readonly markdownTheme: MarkdownTheme;

	constructor(options: UserMessageBlockOptions) {
		super("user-message", { ...options, terminal: { ...options.terminal, promptBoundary: true } });
		this.text = options.text;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
	}

	protected override rebuildChildren(): void {
		const contentBox = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
		contentBox.addChild(
			new Markdown(this.text, 0, 0, this.markdownTheme, {
				color: (content: string) => theme.fg("userMessageText", content),
			}),
		);
		this.addChild(contentBox);
	}

	serialize(): SerializedUserMessageBlock {
		return {
			type: "user-message",
			id: this.id,
			state: {
				text: this.text,
			},
		};
	}
}
