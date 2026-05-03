import { randomUUID } from "node:crypto";
import { Container } from "#tui/index.js";

export type TimelineBlockState = object;

export interface SerializedTimelineBlock<TState extends TimelineBlockState = TimelineBlockState> {
	type: string;
	id: string;
	state: TState;
}

export interface TimelineBlockOptions {
	id?: string;
	terminalZone?: boolean;
}

export abstract class TimelineBlock<TState extends TimelineBlockState = TimelineBlockState> extends Container {
	readonly id: string;
	readonly type: string;
	private readonly terminalZone: boolean;

	protected constructor(type: string, options: TimelineBlockOptions = {}) {
		super();
		this.type = type;
		this.id = options.id ?? randomUUID();
		this.terminalZone = options.terminalZone ?? true;
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (!this.terminalZone || lines.length === 0) {
			return lines;
		}
		return lines;
	}

	serialize(): SerializedTimelineBlock<TState> {
		return {
			type: this.type,
			id: this.id,
			state: this.serializeState(),
		};
	}

	protected abstract serializeState(): TState;
}
