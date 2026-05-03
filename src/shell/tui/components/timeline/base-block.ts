import { randomUUID } from "node:crypto";
import { Container } from "#tui/index.js";

export abstract class TimelineBlock extends Container {
	readonly id: string;
	readonly type: string;

	protected constructor(type: string, id?: string) {
		super();
		this.type = type;
		this.id = id ?? randomUUID();
	}

	abstract serialize(): object;
}
