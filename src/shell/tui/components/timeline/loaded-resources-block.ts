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
	private readonly text: Text;

	constructor(options: LoadedResourcesBlockOptions) {
		super("loaded-resources", options);
		this.sections = options.sections;
		this.expanded = options.expanded;
		this.text = new Text(this.getText(), 0, 0);
		this.addChild(this.text);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.text.setText(this.getText());
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
