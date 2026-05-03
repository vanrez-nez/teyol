import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "#tui/index.js";
import { getSelectListTheme } from "../../../theme/theme.js";
import { DynamicBorder } from "../../components/dynamic-border.js";

export type ModelAction = "select" | "fast-cycle";

const MODEL_ACTION_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 24,
};

const MODEL_ACTION_ITEMS: SelectItem[] = [
	{ value: "select", label: "Select", description: "Choose the active model" },
	{ value: "fast-cycle", label: "Fast-cycle", description: "Configure models for Ctrl+P cycling" },
];

export class ModelActionsSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(onSelect: (action: ModelAction) => void, onCancel: () => void) {
		super();

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(
			MODEL_ACTION_ITEMS,
			2,
			getSelectListTheme(),
			MODEL_ACTION_SELECT_LIST_LAYOUT,
		);
		this.selectList.onSelect = (item) => {
			onSelect(item.value as ModelAction);
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
