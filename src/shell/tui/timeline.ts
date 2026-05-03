import type { Container } from "#tui/index.js";
import type { TimelineBlock } from "./components/timeline/base-block.js";

export interface TimelineOptions {
	maxVisibleBlocks?: number;
}

export class Timeline {
	maxVisibleBlocks: number;
	private blocks: TimelineBlock[] = [];
	private readonly blockHost = {
		invalidate: () => {},
		render: (width: number) => this.render(width),
	};

	constructor(
		private readonly chatContainer: Container,
		options: TimelineOptions = {},
	) {
		this.maxVisibleBlocks = options.maxVisibleBlocks ?? Number.POSITIVE_INFINITY;
	}

	getBlockCount(): number {
		return this.blocks.length;
	}

	getBlocks(): readonly TimelineBlock[] {
		return this.blocks;
	}

	pushBlock(block: TimelineBlock): void {
		this.blocks.push(block);
		this.ensureBlockHostMounted();
	}

	insertBlockAfter(target: TimelineBlock, block: TimelineBlock): boolean {
		const index = this.blocks.indexOf(target);
		if (index < 0) {
			return false;
		}

		this.blocks.splice(index + 1, 0, block);
		this.ensureBlockHostMounted();
		return true;
	}

	clearBlocks(): void {
		this.blocks = [];
	}

	removeBlock(block: TimelineBlock): void {
		this.blocks = this.blocks.filter((existingBlock) => existingBlock !== block);
	}

	clear(): void {
		this.chatContainer.clear();
		this.clearBlocks();
	}

	findBlockById(id: string): TimelineBlock | undefined {
		for (const block of this.blocks) {
			const found = block.findBlockById(id);
			if (found) {
				return found;
			}
		}

		return undefined;
	}

	render(width: number): string[] {
		const maxVisibleBlocks = Number.isFinite(this.maxVisibleBlocks)
			? Math.max(0, Math.floor(this.maxVisibleBlocks))
			: Number.POSITIVE_INFINITY;
		const blocks = Number.isFinite(maxVisibleBlocks) ? this.blocks.slice(-maxVisibleBlocks) : this.blocks;
		const lines: string[] = [];

		for (const block of blocks) {
			lines.push(...block.render(width));
		}

		return lines;
	}

	private ensureBlockHostMounted(): void {
		if (!this.chatContainer.children.includes(this.blockHost)) {
			this.chatContainer.addChild(this.blockHost);
		}
	}
}
