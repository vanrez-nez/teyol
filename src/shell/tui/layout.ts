import type { AgentSession } from "#shell/runtime/agent-session.js";
import { FooterDataProvider } from "#shell/runtime/footer-data-provider.js";
import { type Component, Container, ProcessTerminal, truncateToWidth, TUI } from "#tui/index.js";
import { theme } from "../theme/theme.js";
import { FooterComponent } from "./components/footer.js";

export const SIDEBAR_MIN_TERMINAL_WIDTH = 120;
export const SIDEBAR_WIDTH = 32;
export const SIDEBAR_SEPARATOR = "│";

export interface ShellLayoutComponentOptions {
	session: AgentSession;
	cwd: string;
	showHardwareCursor: boolean;
	clearOnShrink: boolean;
	editor?: Component;
}

export class ShellLayoutComponent implements Component {
	readonly ui: TUI;
	readonly timeline = new Container();
	readonly sidebar = new Container();
	readonly chat = new Container();
	readonly pendingMessages = new Container();
	readonly status = new Container();
	readonly widgetsAbove = new Container();
	readonly widgetsBelow = new Container();
	readonly editorHost = new Container();
	readonly footerDataProvider: FooterDataProvider;
	readonly footer: FooterComponent;

	private attached = false;

	constructor(options: ShellLayoutComponentOptions) {
		this.ui = new TUI(new ProcessTerminal(), options.showHardwareCursor);
		this.ui.setClearOnShrink(options.clearOnShrink);

		if (options.editor) {
			this.editorHost.addChild(options.editor);
		}

		this.timeline.addChild(this.chat);
		this.timeline.addChild(this.pendingMessages);
		this.timeline.addChild(this.status);
		this.timeline.addChild(this.widgetsAbove);
		this.timeline.addChild(this.editorHost);
		this.timeline.addChild(this.widgetsBelow);

		this.footerDataProvider = new FooterDataProvider(options.cwd);
		this.footer = new FooterComponent(options.session, this.footerDataProvider);
	}

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

	attachRoot(): void {
		if (this.attached) return;
		this.ui.addChild(this);
		this.ui.addChild(this.footer);
		this.attached = true;
	}

	setEditorHost(component: Component, focus: Component = component): void {
		this.editorHost.clear();
		this.editorHost.addChild(component);
		this.ui.setFocus(focus);
		this.ui.requestRender();
	}

	restoreEditorHost(editor: Component): void {
		this.setEditorHost(editor);
	}

	dispose(): void {
		this.footer.dispose();
		this.footerDataProvider.dispose();
	}
}
