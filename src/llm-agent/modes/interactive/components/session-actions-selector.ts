import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "#tui/index.js";
import { getSelectListTheme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export type SessionAction = "info" | "new" | "resume" | "compact" | "tree" | "clone" | "fork";

const SESSION_ACTION_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 24,
};

const SESSION_ACTION_ITEMS: SelectItem[] = [
	{ value: "info", label: "Info", description: "Show current session info and stats" },
	{ value: "new", label: "New", description: "Start a new session" },
	{ value: "resume", label: "Resume", description: "Resume a different session" },
	{ value: "compact", label: "Compact", description: "Manually compact session context" },
	{ value: "tree", label: "Tree", description: "Navigate session tree" },
	{ value: "clone", label: "Clone", description: "Duplicate current session position" },
	{ value: "fork", label: "Fork", description: "Fork from a previous user message" },
];

export class SessionActionsSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(onSelect: (action: SessionAction) => void, onCancel: () => void) {
		super();

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(
			SESSION_ACTION_ITEMS,
			7,
			getSelectListTheme(),
			SESSION_ACTION_SELECT_LIST_LAYOUT,
		);
		this.selectList.onSelect = (item) => {
			onSelect(item.value as SessionAction);
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
