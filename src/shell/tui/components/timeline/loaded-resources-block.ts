import { Text } from "#tui/index.js";
import type { ThemeColor } from "../../../theme/theme.js";
import { theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

export interface LoadedResourcesSection {
	title: string;
	collapsedBody: string;
	expandedBody: string;
	color?: ThemeColor;
}

export interface LoadedResourcesBlockState {
	sections: LoadedResourcesSection[];
	expanded: boolean;
}

export interface SerializedLoadedResourcesBlock {
	type: "loaded-resources";
	id: string;
	state: LoadedResourcesBlockState;
}

export interface LoadedResourcesBlockOptions extends TimelineBlockOptions {
	sections: LoadedResourcesSection[];
	expanded: boolean;
}

export class LoadedResourcesBlock extends TimelineBlock {
	private readonly sections: LoadedResourcesSection[];
	private expanded: boolean;

	constructor(options: LoadedResourcesBlockOptions) {
		super("loaded-resources", options);
		this.sections = options.sections;
		this.expanded = options.expanded;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.markDirty();
	}

	protected override rebuildChildren(): void {
		this.addChild(new Text(this.getText(), 0, 0));
	}

	serialize(): SerializedLoadedResourcesBlock {
		return {
			type: "loaded-resources",
			id: this.id,
			state: {
				sections: this.sections,
				expanded: this.expanded,
			},
		};
	}

	private getText(): string {
		return this.sections.map((section) => this.renderSection(section)).join("\n\n");
	}

	private renderSection(section: LoadedResourcesSection): string {
		const color = section.color ?? "mdHeading";
		const header = theme.fg(color, `[${section.title}]`);
		const body = this.expanded ? section.expandedBody : section.collapsedBody;
		return `${header}\n${body}`;
	}
}
