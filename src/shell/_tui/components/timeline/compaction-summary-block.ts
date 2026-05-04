import type { CompactionSummaryMessage } from "#shell/runtime/messages.js";
import { Markdown, type MarkdownTheme, Spacer, Text } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { keyText } from "../keybinding-hints.js";
import { TimelineBlock, type TimelineBlockEdges, type TimelineBlockOptions } from "./base-block.js";

export interface CompactionSummaryBlockState {
	message: CompactionSummaryMessage;
	expanded: boolean;
}

export interface SerializedCompactionSummaryBlock {
	type: "compaction-summary";
	id: string;
	state: CompactionSummaryBlockState;
}

export interface CompactionSummaryBlockOptions extends TimelineBlockOptions {
	message: CompactionSummaryMessage;
	expanded: boolean;
	markdownTheme?: MarkdownTheme;
}

export class CompactionSummaryBlock extends TimelineBlock {
	private readonly message: CompactionSummaryMessage;
	private readonly markdownTheme: MarkdownTheme;
	private expanded: boolean;

	constructor(options: CompactionSummaryBlockOptions) {
		super("compaction-summary", {
			...options,
			margin: mergeEdges({ top: 1 }, options.margin),
			padding: mergeEdges({ left: 1, top: 1, right: 1, bottom: 1 }, options.padding),
			background: options.background ?? "customMessageBg",
		});
		this.message = options.message;
		this.expanded = options.expanded;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
	}

	setDetailsExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.markDirty();
	}

	protected override rebuildChildren(): void {
		const tokenStr = this.message.tokensBefore.toLocaleString();
		const label = theme.fg("customMessageLabel", `\x1b[1m[compaction]\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const header = `**Compacted from ${tokenStr} tokens**\n\n`;
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
			return;
		}

		this.addChild(
			new Text(
				theme.fg("customMessageText", `Compacted from ${tokenStr} tokens (`) +
					theme.fg("dim", keyText("app.details.expand")) +
					theme.fg("customMessageText", " to expand)"),
				0,
				0,
			),
		);
	}

	serialize(): SerializedCompactionSummaryBlock {
		return {
			type: "compaction-summary",
			id: this.id,
			state: {
				message: this.message,
				expanded: this.expanded,
			},
		};
	}
}

function mergeEdges(defaults: TimelineBlockEdges, overrides: TimelineBlockEdges | undefined): TimelineBlockEdges {
	return { ...defaults, ...overrides };
}
