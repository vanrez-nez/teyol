import type { ParsedSkillBlock } from "#shell/runtime/agent-session.js";
import type { MarkdownTheme } from "#tui/index.js";
import { Markdown, Text } from "#tui/index.js";
import { getMarkdownTheme, theme } from "../../../theme/theme.js";
import { keyText } from "../keybinding-hints.js";
import { TimelineBlock, type TimelineBlockEdges, type TimelineBlockOptions } from "./base-block.js";

export interface SkillInvocationBlockState {
	skillBlock: ParsedSkillBlock;
	expanded: boolean;
}

export interface SerializedSkillInvocationBlock {
	type: "skill-invocation";
	id: string;
	state: SkillInvocationBlockState;
}

export interface SkillInvocationBlockOptions extends TimelineBlockOptions {
	skillBlock: ParsedSkillBlock;
	expanded: boolean;
	markdownTheme?: MarkdownTheme;
}

export class SkillInvocationBlock extends TimelineBlock {
	private readonly skillBlock: ParsedSkillBlock;
	private readonly markdownTheme: MarkdownTheme;
	private expanded: boolean;

	constructor(options: SkillInvocationBlockOptions) {
		super("skill-invocation", {
			...options,
			margin: mergeEdges({ top: 1 }, options.margin),
			padding: mergeEdges({ left: 1, top: 1, right: 1, bottom: 1 }, options.padding),
			background: options.background ?? "customMessageBg",
		});
		this.skillBlock = options.skillBlock;
		this.expanded = options.expanded;
		this.markdownTheme = options.markdownTheme ?? getMarkdownTheme();
	}

	setDetailsExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.markDirty();
	}

	protected override rebuildChildren(): void {
		if (this.expanded) {
			const label = theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m`);
			const header = `**${this.skillBlock.name}**\n\n`;
			this.addChild(new Text(label, 0, 0));
			this.addChild(
				new Markdown(header + this.skillBlock.content, 0, 0, this.markdownTheme, {
					color: (content: string) => theme.fg("customMessageText", content),
				}),
			);
			return;
		}

		this.addChild(
			new Text(
				theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
					theme.fg("customMessageText", this.skillBlock.name) +
					theme.fg("dim", ` (${keyText("app.details.expand")} to expand)`),
				0,
				0,
			),
		);
	}

	serialize(): SerializedSkillInvocationBlock {
		return {
			type: "skill-invocation",
			id: this.id,
			state: {
				skillBlock: this.skillBlock,
				expanded: this.expanded,
			},
		};
	}
}

function mergeEdges(defaults: TimelineBlockEdges, overrides: TimelineBlockEdges | undefined): TimelineBlockEdges {
	return { ...defaults, ...overrides };
}
