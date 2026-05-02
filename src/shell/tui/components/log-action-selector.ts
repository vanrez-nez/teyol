import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "#tui/index.js";
import { getSelectListTheme } from "../../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export type LogAction = "view" | "enable" | "disable" | "mode" | "rotation_lines" | "level";

const LOG_ACTION_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 16,
	maxPrimaryColumnWidth: 24,
};

export class LogActionsSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentlyEnabled: boolean, onSelect: (action: LogAction) => void, onCancel: () => void) {
		super();

		const items: SelectItem[] = [
			{ value: "view", label: "View", description: "Show the current log file path and tail" },
			currentlyEnabled
				? { value: "disable", label: "Disable", description: "Stop writing log entries" }
				: { value: "enable", label: "Enable", description: "Start writing log entries" },
			{ value: "mode", label: "Mode", description: "Choose between app and session log files" },
			{
				value: "rotation_lines",
				label: "Rotation lines",
				description: "Set rotation line threshold (0 disables)",
			},
			{ value: "level", label: "Levels", description: "Choose which severity levels are written" },
		];

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(items, items.length, getSelectListTheme(), LOG_ACTION_SELECT_LIST_LAYOUT);
		this.selectList.onSelect = (item) => {
			onSelect(item.value as LogAction);
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
