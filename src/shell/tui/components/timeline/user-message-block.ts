import { Box, Markdown, type MarkdownTheme } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

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

	constructor(options: UserMessageBlockOptions) {
		super("user-message", options);
		this.text = options.text;

		const contentBox = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
		contentBox.addChild(
			new Markdown(options.text, 0, 0, options.markdownTheme ?? getMarkdownTheme(), {
				color: (content: string) => theme.fg("userMessageText", content),
			}),
		);
		this.addChild(contentBox);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
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
