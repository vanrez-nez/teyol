import React from "react";
import { render, Text } from "ink";
import { setTimeout as delay } from "node:timers/promises";

export function HelloWorldApp() {
	return React.createElement(Text, null, "hello world");
}

export async function renderHelloWorldApp(): Promise<void> {
	const instance = render(React.createElement(HelloWorldApp));
	await delay(0);
	instance.unmount();
	await instance.waitUntilExit();
}

// Temporary compatibility surface while the custom TUI is archived under src/_tui.
// These exports keep non-rendering runtime modules compiling without reintroducing
// the old component implementation.
export interface AutocompleteItem {
	value: string;
	label?: string;
	description?: string;
}

export interface AutocompleteSuggestions {
	items: AutocompleteItem[];
	replacementStart?: number;
	replacementEnd?: number;
}

export interface AutocompleteProvider {
	getSuggestions(input: string, cursor: number): AutocompleteSuggestions | Promise<AutocompleteSuggestions>;
}

export interface Component {
	render(width?: number, height?: number): string[];
}

export interface Focusable {
	handleKey?(key: KeyId): boolean;
}

export interface EditorComponent extends Component, Focusable {
	getText(): string;
	setText(text: string): void;
	focus?(): void;
	blur?(): void;
}

export interface OverlayMargin {
	top?: number;
	right?: number;
	bottom?: number;
	left?: number;
}

export interface OverlayOptions {
	anchor?: "center" | "top" | "bottom" | "left" | "right";
	width?: number | string;
	height?: number | string;
	margin?: OverlayMargin;
}

export interface OverlayHandle {
	close(): void;
	update?(options: OverlayOptions): void;
}

export type StyleFn = (text: string, selected?: boolean) => string;

export interface EditorTheme {
	border?: string | StyleFn;
	borderFocused?: string | StyleFn;
	text?: string | StyleFn;
	placeholder?: string | StyleFn;
	background?: string | StyleFn;
	selectList?: SelectListTheme;
	[key: string]: unknown;
}

export interface MarkdownTheme {
	text?: string | StyleFn;
	heading?: string | StyleFn;
	link?: string | StyleFn;
	code?: string | StyleFn;
	codeBlock?: string | StyleFn;
	[key: string]: unknown;
}

export interface SelectListTheme {
	text?: string | StyleFn;
	selected?: string | StyleFn;
	muted?: string | StyleFn;
	border?: string | StyleFn;
	[key: string]: unknown;
}

export interface SettingsListTheme extends SelectListTheme {
	value?: string | StyleFn;
}

export type KeyId = string;
export type Keybinding = KeyId;

export interface KeybindingDefinition {
	defaultKeys: KeyId | KeyId[];
	description: string;
}

export type KeybindingDefinitions = Record<string, KeybindingDefinition>;
export type KeybindingsConfig = Record<string, KeyId | KeyId[]>;

export interface Keybindings {}

export const TUI_KEYBINDINGS = {} as const satisfies KeybindingDefinitions;

let activeKeybindings: KeybindingsManager | undefined;

export function setKeybindings(keybindings: KeybindingsManager): void {
	activeKeybindings = keybindings;
}

export function getKeybindings(): KeybindingsManager | undefined {
	return activeKeybindings;
}

export class KeybindingsManager {
	private userBindings: KeybindingsConfig;

	constructor(
		private readonly definitions: KeybindingDefinitions = {},
		userBindings: KeybindingsConfig = {},
	) {
		this.userBindings = userBindings;
	}

	static create(): KeybindingsManager {
		return new KeybindingsManager();
	}

	setUserBindings(bindings: KeybindingsConfig): void {
		this.userBindings = bindings;
	}

	getResolvedBindings(): KeybindingsConfig {
		const resolved: KeybindingsConfig = {};
		for (const [name, definition] of Object.entries(this.definitions)) {
			resolved[name] = definition.defaultKeys;
		}
		return { ...resolved, ...this.userBindings };
	}
}

export class TUI {
	requestRender(): void {}
	stop(): void {}
}

export function fuzzyFilter<T>(items: T[], pattern: string, getText: (item: T) => string): T[] {
	const query = pattern.trim().toLowerCase();
	if (!query) return items;
	return items.filter((item) => getText(item).toLowerCase().includes(query));
}
