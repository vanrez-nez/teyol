import type {
	AutocompleteProvider,
	Component,
	EditorComponent,
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "#tui/index.js";
import { Container, matchesKey, Spacer, Text, type KeyId } from "#tui/index.js";
import type {
	AutocompleteProviderFactory,
	EditorFactory,
	ExtensionContext,
	ExtensionRunner,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "#shell/runtime/extensions/index.js";
import type { AgentSession } from "#shell/runtime/agent-session.js";
import type { KeybindingsManager } from "#shell/runtime/keybindings.js";
import type { ReadonlyFooterDataProvider } from "#shell/runtime/footer-data-provider.js";
import type { CliState } from "../state/index.js";
import type { ShellLayoutComponent } from "../layout.js";
import { ExtensionEditorComponent } from "../components/extension-editor.js";
import { ExtensionInputComponent } from "../components/extension-input.js";
import { ExtensionSelectorComponent } from "../components/extension-selector.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { getEditorTheme, getAvailableThemesWithPaths, getThemeByName, setTheme, setThemeInstance, Theme, theme } from "../../theme/theme.js";

export interface InteractiveExtensionsOptions {
	ui: TUI;
	layout: ShellLayoutComponent;
	state: CliState;
	chatContainer: Container;
	widgetContainerAbove: Container;
	widgetContainerBelow: Container;
	footer: ShellLayoutComponent["footer"];
	footerDataProvider: ShellLayoutComponent["footerDataProvider"];
	defaultEditor: CustomEditor;
	keybindings: KeybindingsManager;
	getSession(): AgentSession;
	getEditor(): EditorComponent;
	setEditor(editor: EditorComponent): void;
	getAutocompleteProvider(): AutocompleteProvider | undefined;
	setupAutocompleteProvider(): void;
	updateTerminalTitle(): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	showError(message: string): void;
	setShutdownRequested(requested: boolean): void;
	shutdown(): Promise<void>;
	setWorkingMessage(message: string | undefined): void;
	setWorkingVisible(visible: boolean): void;
	setWorkingIndicator(options?: Parameters<ExtensionUIContext["setWorkingIndicator"]>[0]): void;
	setHiddenThinkingLabel(label?: string): void;
	setToolsExpanded(expanded: boolean): void;
	getToolsExpanded(): boolean;
	pasteToEditor(text: string): void;
	setEditorText(text: string): void;
	getEditorText(): string;
	bindCommandContextActions(): Parameters<AgentSession["bindExtensions"]>[0]["commandContextActions"];
	showLoadedResources(): void;
}

export class InteractiveExtensions {
	private selector: ExtensionSelectorComponent | undefined = undefined;
	private input: ExtensionInputComponent | undefined = undefined;
	private extensionEditor: ExtensionEditorComponent | undefined = undefined;
	private terminalInputUnsubscribers = new Set<() => void>();
	private widgetsAbove = new Map<string, Component & { dispose?(): void }>();
	private widgetsBelow = new Map<string, Component & { dispose?(): void }>();
	private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;
	private editorComponentFactory: EditorFactory | undefined = undefined;

	private static readonly MAX_WIDGET_LINES = 10;

	constructor(private readonly options: InteractiveExtensionsOptions) {}

	getAutocompleteWrappers(): ReadonlyArray<AutocompleteProviderFactory> {
		return this.autocompleteProviderWrappers;
	}

	getEditorComponent(): EditorFactory | undefined {
		return this.editorComponentFactory;
	}

	async bindCurrentSession(): Promise<void> {
		const session = this.options.getSession();
		await session.bindExtensions({
			uiContext: this.createUIContext(),
			commandContextActions: this.options.bindCommandContextActions(),
			shutdownHandler: () => {
				this.options.setShutdownRequested(true);
				if (!session.isStreaming) {
					void this.options.shutdown();
				}
			},
			onError: (error) => {
				this.showError(error.extensionPath, error.error, error.stack);
			},
		});

		this.options.setupAutocompleteProvider();
		this.setupShortcuts(session.extensionRunner);
		this.options.showLoadedResources();
	}

	setupShortcuts(extensionRunner: ExtensionRunner): void {
		const shortcuts = extensionRunner.getShortcuts(this.options.keybindings.getEffectiveConfig());
		if (shortcuts.size === 0) return;

		const createContext = (): ExtensionContext => {
			const session = this.options.getSession();
			return {
				ui: this.createUIContext(),
				hasUI: true,
				cwd: session.sessionManager.getCwd(),
				sessionManager: session.sessionManager,
				modelRegistry: session.modelRegistry,
				model: session.model,
				isIdle: () => !session.isStreaming,
				signal: session.agent.signal,
				abort: () => session.abort(),
				hasPendingMessages: () => session.pendingMessageCount > 0,
				shutdown: () => {
					this.options.setShutdownRequested(true);
				},
				getContextUsage: () => session.getContextUsage(),
				compact: (options) => {
					void (async () => {
						try {
							const result = await session.compact(options?.customInstructions);
							options?.onComplete?.(result);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							options?.onError?.(err);
						}
					})();
				},
				getSystemPrompt: () => session.systemPrompt,
			};
		};

		this.options.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [shortcutStr, shortcut] of shortcuts) {
				if (matchesKey(data, shortcutStr as KeyId)) {
					Promise.resolve(shortcut.handler(createContext())).catch((err) => {
						this.options.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
					});
					return true;
				}
			}
			return false;
		};
	}

	reset(): void {
		if (this.selector) {
			this.hideSelector();
		}
		if (this.input) {
			this.hideInput();
		}
		if (this.extensionEditor) {
			this.hideEditor();
		}
		this.options.ui.hideOverlay();
		this.clearTerminalInputListeners();
		this.setFooter(undefined);
		this.setHeader(undefined);
		this.clearWidgets();
		this.options.state.footer.clearExtensionStatuses();
		this.options.footerDataProvider.clearExtensionStatuses();
		this.options.footer.invalidate();
		this.autocompleteProviderWrappers = [];
		this.setEditorComponent(undefined);
		this.options.setupAutocompleteProvider();
		this.options.defaultEditor.onExtensionShortcut = undefined;
		this.options.updateTerminalTitle();
		this.options.setWorkingMessage(undefined);
		this.options.setWorkingVisible(true);
		this.options.setWorkingIndicator();
		this.options.setHiddenThinkingLabel();
	}

	dispose(): void {
		this.clearTerminalInputListeners();
	}

	isExtensionCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return !!this.options.getSession().extensionRunner.getCommand(commandName);
	}

	createUIContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) => this.showSelector(title, options, opts),
			confirm: (title, message, opts) => this.showConfirm(title, message, opts),
			input: (title, placeholder, opts) => this.showInput(title, placeholder, opts),
			notify: (message, type) => this.showNotify(message, type),
			onTerminalInput: (handler) => this.addTerminalInputListener(handler),
			setStatus: (key, text) => this.setStatus(key, text),
			setWorkingMessage: (message) => this.options.setWorkingMessage(message),
			setWorkingVisible: (visible) => this.options.setWorkingVisible(visible),
			setWorkingIndicator: (indicatorOptions) => this.options.setWorkingIndicator(indicatorOptions),
			setHiddenThinkingLabel: (label) => this.options.setHiddenThinkingLabel(label),
			setWidget: (key, content, widgetOptions) => this.setWidget(key, content, widgetOptions),
			setFooter: (factory) => this.setFooter(factory),
			setHeader: (factory) => this.setHeader(factory),
			setTitle: (title) => this.options.ui.terminal.setTitle(title),
			custom: (factory, customOptions) => this.showCustom(factory, customOptions),
			pasteToEditor: (text) => this.options.pasteToEditor(text),
			setEditorText: (text) => this.options.setEditorText(text),
			getEditorText: () => this.options.getEditorText(),
			editor: (title, prefill) => this.showEditor(title, prefill),
			addAutocompleteProvider: (factory) => {
				this.autocompleteProviderWrappers.push(factory);
				this.options.setupAutocompleteProvider();
			},
			setEditorComponent: (factory) => this.setEditorComponent(factory),
			getEditorComponent: () => this.editorComponentFactory,
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					setThemeInstance(themeOrName);
					this.options.ui.requestRender();
					return { success: true };
				}
				const result = setTheme(themeOrName, true);
				if (result.success) {
					const settings = this.options.getSession().settingsManager;
					if (settings.getTheme() !== themeOrName) {
						settings.setTheme(themeOrName);
					}
					this.options.ui.requestRender();
				}
				return result;
			},
			getToolsExpanded: () => this.options.getToolsExpanded(),
			setToolsExpanded: (expanded) => this.options.setToolsExpanded(expanded),
		};
	}

	showSelector(title: string, options: string[], dialogOptions?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (dialogOptions?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideSelector();
				resolve(undefined);
			};
			dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });

			this.selector = new ExtensionSelectorComponent(
				title,
				options,
				(option) => {
					dialogOptions?.signal?.removeEventListener("abort", onAbort);
					this.hideSelector();
					resolve(option);
				},
				() => {
					dialogOptions?.signal?.removeEventListener("abort", onAbort);
					this.hideSelector();
					resolve(undefined);
				},
				{ tui: this.options.ui, timeout: dialogOptions?.timeout },
			);

			this.options.layout.setEditorHost(this.selector);
		});
	}

	async showConfirm(title: string, message: string, options?: ExtensionUIDialogOptions): Promise<boolean> {
		const result = await this.showSelector(`${title}\n${message}`, ["Yes", "No"], options);
		return result === "Yes";
	}

	showInput(title: string, placeholder?: string, options?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (options?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideInput();
				resolve(undefined);
			};
			options?.signal?.addEventListener("abort", onAbort, { once: true });

			this.input = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideInput();
					resolve(value);
				},
				() => {
					options?.signal?.removeEventListener("abort", onAbort);
					this.hideInput();
					resolve(undefined);
				},
				{ tui: this.options.ui, timeout: options?.timeout },
			);

			this.options.layout.setEditorHost(this.input);
		});
	}

	showEditor(title: string, prefill?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.extensionEditor = new ExtensionEditorComponent(
				this.options.ui,
				this.options.keybindings,
				title,
				prefill,
				(value) => {
					this.hideEditor();
					resolve(value);
				},
				() => {
					this.hideEditor();
					resolve(undefined);
				},
			);

			this.options.layout.setEditorHost(this.extensionEditor);
		});
	}

	private hideSelector(): void {
		this.selector?.dispose();
		this.selector = undefined;
		this.options.layout.restoreEditorHost(this.options.getEditor());
	}

	private hideInput(): void {
		this.input?.dispose();
		this.input = undefined;
		this.options.layout.restoreEditorHost(this.options.getEditor());
	}

	private hideEditor(): void {
		this.extensionEditor = undefined;
		this.options.layout.restoreEditorHost(this.options.getEditor());
	}

	private setStatus(key: string, text: string | undefined): void {
		this.options.state.footer.setExtensionStatus({ key, text });
		this.options.footerDataProvider.setExtensionStatus(key, text);
		this.options.ui.requestRender();
	}

	private setWidget(
		key: string,
		content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void {
		const placement = options?.placement ?? "aboveEditor";
		const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
			const existing = map.get(key);
			if (existing?.dispose) existing.dispose();
			map.delete(key);
		};

		removeExisting(this.widgetsAbove);
		removeExisting(this.widgetsBelow);

		if (content === undefined) {
			this.renderWidgets();
			return;
		}

		let component: Component & { dispose?(): void };
		if (Array.isArray(content)) {
			const container = new Container();
			for (const line of content.slice(0, InteractiveExtensions.MAX_WIDGET_LINES)) {
				container.addChild(new Text(line, 1, 0));
			}
			if (content.length > InteractiveExtensions.MAX_WIDGET_LINES) {
				container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
			}
			component = container;
		} else {
			component = content(this.options.ui, theme);
		}

		const targetMap = placement === "belowEditor" ? this.widgetsBelow : this.widgetsAbove;
		targetMap.set(key, component);
		this.renderWidgets();
	}

	private clearWidgets(): void {
		for (const widget of this.widgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.widgetsBelow.values()) {
			widget.dispose?.();
		}
		this.widgetsAbove.clear();
		this.widgetsBelow.clear();
		this.renderWidgets();
	}

	renderWidgets(): void {
		this.renderWidgetContainer(this.options.widgetContainerAbove, this.widgetsAbove, true, true);
		this.renderWidgetContainer(this.options.widgetContainerBelow, this.widgetsBelow, false, false);
		this.options.ui.requestRender();
	}

	private renderWidgetContainer(
		container: Container,
		widgets: Map<string, Component & { dispose?(): void }>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		container.clear();

		if (widgets.size === 0) {
			if (spacerWhenEmpty) {
				container.addChild(new Spacer(1));
			}
			return;
		}

		if (leadingSpacer) {
			container.addChild(new Spacer(1));
		}
		for (const component of widgets.values()) {
			container.addChild(component);
		}
	}

	private setFooter(
		factory:
			| ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void {
		if (this.customFooter?.dispose) {
			this.customFooter.dispose();
		}

		if (this.customFooter) {
			this.options.ui.removeChild(this.customFooter);
		} else {
			this.options.ui.removeChild(this.options.footer);
		}

		if (factory) {
			this.customFooter = factory(this.options.ui, theme, this.options.footerDataProvider);
			this.options.ui.addChild(this.customFooter);
		} else {
			this.customFooter = undefined;
			this.options.ui.addChild(this.options.footer);
		}

		this.options.ui.requestRender();
	}

	private setHeader(_factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
		this.options.ui.requestRender();
	}

	private addTerminalInputListener(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		const unsubscribe = this.options.ui.addInputListener(handler);
		this.terminalInputUnsubscribers.add(unsubscribe);
		return () => {
			unsubscribe();
			this.terminalInputUnsubscribers.delete(unsubscribe);
		};
	}

	private clearTerminalInputListeners(): void {
		for (const unsubscribe of this.terminalInputUnsubscribers) {
			unsubscribe();
		}
		this.terminalInputUnsubscribers.clear();
	}

	private setEditorComponent(factory: EditorFactory | undefined): void {
		this.editorComponentFactory = factory;
		const currentEditor = this.options.getEditor();
		const currentText = currentEditor.getText();

		if (factory) {
			const newEditor = factory(this.options.ui, getEditorTheme(), this.options.keybindings);
			newEditor.onSubmit = this.options.defaultEditor.onSubmit;
			newEditor.onChange = this.options.defaultEditor.onChange;
			newEditor.setText(currentText);

			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.options.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.options.defaultEditor.getPaddingX());
			}
			const autocompleteProvider = this.options.getAutocompleteProvider();
			if (newEditor.setAutocompleteProvider && autocompleteProvider) {
				newEditor.setAutocompleteProvider(autocompleteProvider);
			}

			const customEditor = newEditor as unknown as Record<string, unknown>;
			if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
				if (!customEditor.onEscape) {
					customEditor.onEscape = () => this.options.defaultEditor.onEscape?.();
				}
				if (!customEditor.onCtrlD) {
					customEditor.onCtrlD = () => this.options.defaultEditor.onCtrlD?.();
				}
				if (!customEditor.onPasteImage) {
					customEditor.onPasteImage = () => this.options.defaultEditor.onPasteImage?.();
				}
				if (!customEditor.onExtensionShortcut) {
					customEditor.onExtensionShortcut = (data: string) => this.options.defaultEditor.onExtensionShortcut?.(data);
				}
				for (const [action, handler] of this.options.defaultEditor.actionHandlers) {
					(customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
				}
			}

			this.options.setEditor(newEditor);
		} else {
			this.options.defaultEditor.setText(currentText);
			this.options.setEditor(this.options.defaultEditor);
		}

		this.options.layout.restoreEditorHost(this.options.getEditor());
	}

	private showNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.options.showError(message);
		} else if (type === "warning") {
			this.options.showWarning(message);
		} else {
			this.options.showStatus(message);
		}
	}

	private async showCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
		},
	): Promise<T> {
		const editor = this.options.getEditor();
		const savedText = editor.getText();
		const isOverlay = options?.overlay ?? false;

		const restoreEditor = () => {
			this.options.getEditor().setText(savedText);
			this.options.layout.restoreEditorHost(this.options.getEditor());
		};

		return new Promise((resolve, reject) => {
			let component: Component & { dispose?(): void };
			let closed = false;

			const close = (result: T) => {
				if (closed) return;
				closed = true;
				if (isOverlay) this.options.ui.hideOverlay();
				else restoreEditor();
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					/* ignore dispose errors */
				}
			};

			Promise.resolve(factory(this.options.ui, theme, this.options.keybindings, close))
				.then((c) => {
					if (closed) return;
					component = c;
					if (isOverlay) {
						const resolveOptions = (): OverlayOptions | undefined => {
							if (options?.overlayOptions) {
								return typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
							}
							const width = (component as { width?: number }).width;
							return width ? { width } : undefined;
						};
						const handle = this.options.ui.showOverlay(component, resolveOptions());
						options?.onHandle?.(handle);
					} else {
						this.options.layout.setEditorHost(component);
					}
				})
				.catch((err) => {
					if (closed) return;
					if (!isOverlay) restoreEditor();
					reject(err);
				});
		});
	}

	private showError(extensionPath: string, error: string, stack?: string): void {
		const errorMsg = `Extension "${extensionPath}" error: ${error}`;
		this.options.chatContainer.addChild(new Text(theme.fg("error", errorMsg), 1, 0));
		if (stack) {
			const stackLines = stack
				.split("\n")
				.slice(1)
				.map((line) => theme.fg("dim", `  ${line.trim()}`))
				.join("\n");
			if (stackLines) {
				this.options.chatContainer.addChild(new Text(stackLines, 1, 0));
			}
		}
		this.options.ui.requestRender();
	}
}
