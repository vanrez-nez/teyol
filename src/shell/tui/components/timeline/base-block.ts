import { randomUUID } from "node:crypto";
import { Container, truncateToWidth, visibleWidth } from "#tui/index.js";
import type { Component } from "#tui/index.js";
import { theme, type ThemeBg } from "../../../theme/theme.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export interface TimelineBlockEdges {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
}

export interface TimelineBlockPresentation {
	margin: Required<TimelineBlockEdges>;
	padding: Required<TimelineBlockEdges>;
	border: Required<TimelineBlockEdges>;
	background?: ThemeBg;
	terminal: TimelineBlockTerminalPresentation;
}

export interface TimelineBlockTerminalPresentation {
	promptBoundary: boolean;
}

export interface TimelineBlockOptions {
	id?: string;
	margin?: TimelineBlockEdges;
	padding?: TimelineBlockEdges;
	border?: TimelineBlockEdges;
	background?: ThemeBg;
	terminal?: Partial<TimelineBlockTerminalPresentation>;
}

export abstract class TimelineBlock extends Container {
	readonly id: string;
	readonly type: string;
	private readonly presentation: TimelineBlockPresentation;
	protected dirty = true;
	protected buffer: string[] = [];
	private bufferWidth: number | undefined;
	private parent: TimelineBlock | undefined;

	protected constructor(type: string, options: TimelineBlockOptions = {}) {
		super();
		this.type = type;
		this.id = options.id ?? randomUUID();
		this.presentation = {
			margin: normalizeEdges(options.margin),
			padding: normalizeEdges(options.padding),
			border: normalizeEdges(options.border),
			background: options.background,
			terminal: {
				promptBoundary: options.terminal?.promptBoundary ?? false,
			},
		};
	}

	override addChild(component: Component): void {
		super.addChild(component);
		if (component instanceof TimelineBlock) {
			component.parent = this;
		}
		this.markDirty();
	}

	override removeChild(component: Component): void {
		super.removeChild(component);
		if (component instanceof TimelineBlock && component.parent === this) {
			component.parent = undefined;
		}
		this.markDirty();
	}

	override clear(): void {
		for (const child of this.children) {
			if (child instanceof TimelineBlock && child.parent === this) {
				child.parent = undefined;
			}
		}
		super.clear();
		this.markDirty();
	}

	override invalidate(): void {
		for (const child of this.children) {
			child.invalidate?.();
		}
		this.markDirty();
	}

	isDirty(): boolean {
		return this.dirty;
	}

	markDirty(): void {
		this.dirty = true;
		this.parent?.markDirty();
	}

	override render(width: number): string[] {
		const targetWidth = Math.max(1, width);
		if (!this.dirty && this.bufferWidth === targetWidth) {
			return this.buffer;
		}

		this.clear();
		this.rebuildChildren();
		if (!this.shouldRender()) {
			this.buffer = [];
			this.bufferWidth = targetWidth;
			this.dirty = false;
			return this.buffer;
		}

		const { margin, padding, border, background } = this.presentation;
		const horizontalSpace = margin.left + margin.right + border.left + border.right + padding.left + padding.right;
		const contentWidth = Math.max(1, targetWidth - horizontalSpace);

		const contentLines = this.renderContent(contentWidth);
		const paddedLines = applyPadding(contentLines, contentWidth, padding);
		const borderedLines = applyBorder(paddedLines, border);
		const backgroundLines = background ? applyBackground(borderedLines, background) : borderedLines;
		const marginLines = applyMargin(backgroundLines, targetWidth, margin);
		this.buffer = this.applyTerminalPresentation(marginLines);
		this.bufferWidth = targetWidth;
		this.dirty = false;
		return this.buffer;
	}

	protected rebuildChildren(): void {}

	protected shouldRender(): boolean {
		return true;
	}

	protected renderContent(width: number): string[] {
		return super.render(width);
	}

	protected shouldApplyTerminalBoundary(): boolean {
		return this.presentation.terminal.promptBoundary && !this.hasTerminalBoundaryAncestor();
	}

	protected getPresentationState(): TimelineBlockPresentation {
		return this.presentation;
	}

	abstract serialize(): object;

	private hasTerminalBoundaryAncestor(): boolean {
		let parent = this.parent;
		while (parent) {
			if (parent.presentation.terminal.promptBoundary) {
				return true;
			}
			parent = parent.parent;
		}
		return false;
	}

	private applyTerminalPresentation(lines: string[]): string[] {
		if (!this.shouldApplyTerminalBoundary() || lines.length === 0) {
			return lines;
		}

		const wrapped = [...lines];
		wrapped[0] = OSC133_ZONE_START + wrapped[0];
		wrapped[wrapped.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + wrapped[wrapped.length - 1];
		return wrapped;
	}
}

function normalizeEdges(edges: TimelineBlockEdges | undefined): Required<TimelineBlockEdges> {
	return {
		left: normalizeEdge(edges?.left),
		top: normalizeEdge(edges?.top),
		right: normalizeEdge(edges?.right),
		bottom: normalizeEdge(edges?.bottom),
	};
}

function normalizeEdge(value: number | undefined): number {
	return Math.max(0, Math.floor(value ?? 0));
}

function applyPadding(lines: string[], contentWidth: number, padding: Required<TimelineBlockEdges>): string[] {
	const paddedWidth = contentWidth + padding.left + padding.right;
	const result: string[] = [];
	const emptyLine = " ".repeat(paddedWidth);

	for (let i = 0; i < padding.top; i++) {
		result.push(emptyLine);
	}

	for (const line of lines.length > 0 ? lines : [""]) {
		const content = truncateToWidth(line, contentWidth, "", true);
		result.push(`${" ".repeat(padding.left)}${content}${" ".repeat(padding.right)}`);
	}

	for (let i = 0; i < padding.bottom; i++) {
		result.push(emptyLine);
	}

	return result;
}

function applyBorder(lines: string[], border: Required<TimelineBlockEdges>): string[] {
	if (border.left === 0 && border.top === 0 && border.right === 0 && border.bottom === 0) {
		return lines;
	}

	const contentWidth = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	const bodyLines = lines.map((line) => padVisible(line, contentWidth));
	const result: string[] = [];

	for (let i = 0; i < border.top; i++) {
		result.push(borderLine(contentWidth, border, "top"));
	}

	for (const line of bodyLines) {
		result.push(`${theme.fg("border", "│".repeat(border.left))}${line}${theme.fg("border", "│".repeat(border.right))}`);
	}

	for (let i = 0; i < border.bottom; i++) {
		result.push(borderLine(contentWidth, border, "bottom"));
	}

	return result;
}

function borderLine(contentWidth: number, border: Required<TimelineBlockEdges>, edge: "top" | "bottom"): string {
	const leftCorner = edge === "top" ? "┌" : "└";
	const rightCorner = edge === "top" ? "┐" : "┘";
	const left = border.left > 0 ? leftCorner + "─".repeat(border.left - 1) : "";
	const right = border.right > 0 ? "─".repeat(border.right - 1) + rightCorner : "";
	return theme.fg("border", `${left}${"─".repeat(contentWidth)}${right}`);
}

function applyBackground(lines: string[], background: ThemeBg): string[] {
	const width = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
	return lines.map((line) => theme.bg(background, padVisible(line, width)));
}

function applyMargin(lines: string[], width: number, margin: Required<TimelineBlockEdges>): string[] {
	const leftMargin = Math.min(margin.left, width);
	const rightMargin = Math.min(margin.right, Math.max(0, width - leftMargin));
	const contentWidth = Math.max(0, width - leftMargin - rightMargin);
	const result: string[] = [];
	const emptyLine = " ".repeat(width);

	for (let i = 0; i < margin.top; i++) {
		result.push(emptyLine);
	}

	for (const line of lines) {
		const content = truncateToWidth(line, contentWidth, "", true);
		result.push(`${" ".repeat(leftMargin)}${content}${" ".repeat(rightMargin)}`);
	}

	for (let i = 0; i < margin.bottom; i++) {
		result.push(emptyLine);
	}

	return result;
}

function padVisible(line: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(line));
	return line + " ".repeat(padding);
}
