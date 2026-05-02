import { type Component, Container, ProcessTerminal, TUI } from "#tui/index.js";
import type { AgentSession } from "#shell/runtime/agent-session.js";
import { FooterDataProvider } from "#shell/runtime/footer-data-provider.js";
import { FooterComponent } from "../components/footer.js";
import { ShellLayoutComponent } from "../components/shell-layout.js";

export interface ShellCompositionOptions {
	session: AgentSession;
	cwd: string;
	showHardwareCursor: boolean;
	clearOnShrink: boolean;
	editor?: Component;
}

export class ShellComposition {
	readonly ui: TUI;
	readonly layout: ShellLayoutComponent;
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

	constructor(options: ShellCompositionOptions) {
		this.ui = new TUI(new ProcessTerminal(), options.showHardwareCursor);
		this.ui.setClearOnShrink(options.clearOnShrink);

		this.layout = new ShellLayoutComponent(this.timeline, this.sidebar);
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

	attachRoot(): void {
		if (this.attached) return;
		this.ui.addChild(this.layout);
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
