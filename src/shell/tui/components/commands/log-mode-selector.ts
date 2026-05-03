import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "#tui/index.js";
import type { LogMode } from "#shell/runtime/logger.js";
import { getSelectListTheme } from "../../../theme/theme.js";
import { DynamicBorder } from "../dynamic-border.js";

const LOG_MODE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 20,
};

export class LogModeSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentMode: LogMode, onSelect: (mode: LogMode) => void, onCancel: () => void) {
		super();

		const items: SelectItem[] = [
			{
				value: "app",
				label: currentMode === "app" ? "App  (current)" : "App",
				description: "Single shared log at ~/.teyol/agent/teyol.log",
			},
			{
				value: "session",
				label: currentMode === "session" ? "Session  (current)" : "Session",
				description: "Per-session log under the active session directory",
			},
		];

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(items, 2, getSelectListTheme(), LOG_MODE_SELECT_LIST_LAYOUT);
		this.selectList.onSelect = (item) => {
			onSelect(item.value as LogMode);
		};
		this.selectList.onCancel = () => {
			onCancel();
		};
		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
