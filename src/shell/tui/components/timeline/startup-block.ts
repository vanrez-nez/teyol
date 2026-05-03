import { Text } from "#tui/index.js";
import { TimelineBlock } from "./base-block.js";

export interface StartupBlockState {
	expandedInstructions: string;
	compactInstructions: string;
	compactOnboarding: string;
	onboarding: string;
	expanded: boolean;
	paddingX: number;
	paddingY: number;
}

export interface SerializedStartupBlock {
	type: "startup";
	id: string;
	state: StartupBlockState;
}

export interface StartupBlockOptions {
	id?: string;
	expandedInstructions: string;
	compactInstructions: string;
	compactOnboarding: string;
	onboarding: string;
	expanded: boolean;
	paddingX?: number;
	paddingY?: number;
}

export class StartupBlock extends TimelineBlock {
	private expanded: boolean;
	private readonly expandedInstructions: string;
	private readonly compactInstructions: string;
	private readonly compactOnboarding: string;
	private readonly onboarding: string;
	private readonly paddingX: number;
	private readonly paddingY: number;
	private readonly text: Text;

	constructor(options: StartupBlockOptions) {
		super("startup", options.id);
		this.expanded = options.expanded;
		this.expandedInstructions = options.expandedInstructions;
		this.compactInstructions = options.compactInstructions;
		this.compactOnboarding = options.compactOnboarding;
		this.onboarding = options.onboarding;
		this.paddingX = options.paddingX ?? 1;
		this.paddingY = options.paddingY ?? 0;
		this.text = new Text(this.getText(), this.paddingX, this.paddingY);
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
				paddingX: this.paddingX,
				paddingY: this.paddingY,
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
