import { type Component, truncateToWidth } from "#tui/index.js";
import { theme } from "../theme/theme.js";

export const SIDEBAR_MIN_TERMINAL_WIDTH = 120;
export const SIDEBAR_WIDTH = 32;
export const SIDEBAR_SEPARATOR = "│";

export class ShellLayoutComponent implements Component {
	constructor(
		private readonly timeline: Component,
		private readonly sidebar: Component,
	) {}

	invalidate(): void {
		this.timeline.invalidate();
		this.sidebar.invalidate();
	}

	render(width: number): string[] {
		if (width < SIDEBAR_MIN_TERMINAL_WIDTH) {
			return this.timeline.render(width);
		}

		const timelineWidth = width - SIDEBAR_WIDTH - 1;
		const timelineLines = this.timeline.render(timelineWidth);
		const sidebarLines = this.sidebar.render(SIDEBAR_WIDTH);
		const rowCount = Math.max(timelineLines.length, sidebarLines.length);
		const lines: string[] = [];

		for (let index = 0; index < rowCount; index++) {
			const timelineLine = truncateToWidth(timelineLines[index] ?? "", timelineWidth, "", true);
			const sidebarLine = truncateToWidth(sidebarLines[index] ?? "", SIDEBAR_WIDTH, "", true);
			const themedSeparator = theme.fg("sidebarBorder", SIDEBAR_SEPARATOR);
			const themedSidebar = theme.bg("sidebarBg", theme.fg("sidebarText", sidebarLine));
			lines.push(`${timelineLine}${themedSeparator}${themedSidebar}`);
		}

		return lines;
	}
}
