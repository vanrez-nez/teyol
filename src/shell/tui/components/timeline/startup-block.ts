import { Text } from "#tui/index.js";
import { TimelineBlock, type TimelineBlockEdges, type TimelineBlockOptions } from "./base-block.js";

export interface StartupBlockState {
	expandedInstructions: string;
	compactInstructions: string;
	compactOnboarding: string;
	onboarding: string;
	expanded: boolean;
	padding: Required<TimelineBlockEdges>;
}

export interface SerializedStartupBlock {
	type: "startup";
	id: string;
	state: StartupBlockState;
}

export interface StartupBlockOptions extends TimelineBlockOptions {
	expandedInstructions: string;
	compactInstructions: string;
	compactOnboarding: string;
	onboarding: string;
	expanded: boolean;
}

export class StartupBlock extends TimelineBlock {
	private expanded: boolean;
	private readonly expandedInstructions: string;
	private readonly compactInstructions: string;
	private readonly compactOnboarding: string;
	private readonly onboarding: string;
	private readonly text: Text;

	constructor(options: StartupBlockOptions) {
		super("startup", { ...options, padding: { left: 1, ...options.padding } });
		this.expanded = options.expanded;
		this.expandedInstructions = options.expandedInstructions;
		this.compactInstructions = options.compactInstructions;
		this.compactOnboarding = options.compactOnboarding;
		this.onboarding = options.onboarding;
		this.text = new Text(this.getText(), 0, 0);
		this.addChild(this.text);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.text.setText(this.getText());
	}

	serialize(): SerializedStartupBlock {
		return {
			type: "startup",
			id: this.id,
			state: {
				expandedInstructions: this.expandedInstructions,
				compactInstructions: this.compactInstructions,
				compactOnboarding: this.compactOnboarding,
				onboarding: this.onboarding,
				expanded: this.expanded,
				padding: this.getPresentationState().padding,
			},
		};
	}

	private getText(): string {
		if (this.expanded) {
			return `${this.expandedInstructions}\n\n${this.onboarding}`;
		}
		return `${this.compactInstructions}\n${this.compactOnboarding}\n\n${this.onboarding}`;
	}
}
