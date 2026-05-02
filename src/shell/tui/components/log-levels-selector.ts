import {
	type Component,
	Container,
	type Focusable,
	getKeybindings,
	matchesKey,
	truncateToWidth,
} from "#tui/index.js";
import { LOG_LEVELS, type LogLevel } from "#shell/runtime/logger.js";
import { theme } from "../../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

class LogLevelsList implements Component, Focusable {
	private selectedIndex = 0;
	private current: Set<LogLevel>;

	public onCancel?: () => void;
	public onConfirm?: (levels: LogLevel[]) => void;
	public onToggle?: (levels: LogLevel[]) => void;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(initial: LogLevel[]) {
		this.current = new Set(initial);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "  Toggle log levels (space) — confirm with enter, cancel with esc"));
		lines.push("");
		for (let i = 0; i < LOG_LEVELS.length; i++) {
			const level = LOG_LEVELS[i];
			const isSelected = i === this.selectedIndex;
			const isOn = this.current.has(level);
			const cursor = isSelected ? "> " : "  ";
			const checkbox = isOn ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
			const name = isSelected ? theme.bold(level) : level;
			lines.push(truncateToWidth(`${cursor}${checkbox} ${name}`, width, "..."));
		}
		return lines;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? LOG_LEVELS.length - 1 : this.selectedIndex - 1;
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.selectedIndex = (this.selectedIndex + 1) % LOG_LEVELS.length;
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.onCancel?.();
			return;
		}
		if (data === " ") {
			const level = LOG_LEVELS[this.selectedIndex];
			if (this.current.has(level)) {
				this.current.delete(level);
			} else {
				this.current.add(level);
			}
			this.onToggle?.(this.snapshot());
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.onConfirm?.(this.snapshot());
			return;
		}
	}

	private snapshot(): LogLevel[] {
		return LOG_LEVELS.filter((l) => this.current.has(l));
	}
}

export class LogLevelsSelectorComponent extends Container implements Focusable {
	private list: LogLevelsList;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.list.focused = value;
	}

	constructor(
		initial: LogLevel[],
		onConfirm: (levels: LogLevel[]) => void,
		onCancel: () => void,
		onToggle?: (levels: LogLevel[]) => void,
	) {
		super();
		this.addChild(new DynamicBorder());
		this.list = new LogLevelsList(initial);
		this.list.onConfirm = onConfirm;
		this.list.onCancel = onCancel;
		if (onToggle) this.list.onToggle = onToggle;
		this.addChild(this.list);
		this.addChild(new DynamicBorder());
	}

	getList(): LogLevelsList {
		return this.list;
	}
}
