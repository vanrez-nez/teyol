import { Box, type Component, Container, getCapabilities, Image, Spacer, Text, type TUI } from "#tui/index.js";
import type { ToolDefinition, ToolRenderContext } from "#shell/runtime/extensions/types.js";
import { theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockOptions } from "./base-block.js";

const createAllToolDefinitions = (_cwd: string): any => ({});
const getRenderedTextOutput = (result: any, _showImages: boolean): string => {
	if (!result) return "";
	return result.content
		.filter((content: any) => content.type === "text")
		.map((content: any) => content.text)
		.join("\n");
};
const convertToPng = async (
	_data: string,
	_mimeType: string,
): Promise<{ data: string; mimeType: string } | undefined> => undefined;

export interface AssistantToolBlockOptions extends TimelineBlockOptions {
	toolName: string;
	toolCallId: string;
	args: any;
	showImages?: boolean;
	imageWidthCells?: number;
	expanded?: boolean;
	toolDefinition?: ToolDefinition<any, any>;
	ui: TUI;
	cwd: string;
}

export interface AssistantToolBlockState {
	toolName: string;
	toolCallId: string;
	args: any;
}

export interface SerializedAssistantToolBlock {
	type: "assistant-tool";
	id: string;
	state: AssistantToolBlockState;
}

export class AssistantToolBlock extends TimelineBlock {
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded: boolean;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolDefinition<any, any>;
	private builtInToolDefinition?: ToolDefinition<any, any>;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	private hideComponent = false;

	constructor(options: AssistantToolBlockOptions) {
		super("assistant-tool", options);
		this.toolName = options.toolName;
		this.toolCallId = options.toolCallId;
		this.args = options.args;
		this.toolDefinition = options.toolDefinition;
		this.builtInToolDefinition = createAllToolDefinitions(options.cwd)[options.toolName];
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.expanded = options.expanded ?? false;
		this.ui = options.ui;
		this.cwd = options.cwd;
	}

	getToolCallId(): string {
		return this.toolCallId;
	}

	updateArgs(args: any): void {
		this.args = args;
		this.markDirty();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.markDirty();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.markDirty();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.markDirty();
		this.maybeConvertImagesForKitty();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.markDirty();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.markDirty();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.markDirty();
	}

	serialize(): SerializedAssistantToolBlock {
		return {
			type: "assistant-tool",
			id: this.id,
			state: {
				toolName: this.toolName,
				toolCallId: this.toolCallId,
				args: this.args,
			},
		};
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderCall;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderCall;
		}
		return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderResult;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderResult;
		}
		return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderShell ?? "default";
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderShell ?? "default";
		}
		return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
		};
	}

	private createCallFallback(): Component {
		return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}
		return new Text(theme.fg("toolOutput", output), 0, 0);
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((content) => content.type === "image");
		for (let index = 0; index < imageBlocks.length; index++) {
			const image = imageBlocks[index];
			if (!image.data || !image.mimeType) continue;
			if (image.mimeType === "image/png") continue;
			if (this.convertedImages.has(index)) continue;

			convertToPng(image.data, image.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.markDirty();
					this.ui.requestRender();
				}
			});
		}
	}

	protected override rebuildChildren(): void {
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		let hasContent = false;
		this.hideComponent = false;
		this.addChild(new Spacer(1));

		if (this.hasRendererDefinition()) {
			const renderContainer =
				this.getRenderShell() === "self" ? new Container() : new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
			}

			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				renderContainer.addChild(this.createCallFallback());
				hasContent = true;
			} else {
				try {
					const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
					this.callRendererComponent = component;
					renderContainer.addChild(component);
					hasContent = true;
				} catch {
					this.callRendererComponent = undefined;
					renderContainer.addChild(this.createCallFallback());
					hasContent = true;
				}
			}

			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					const component = this.createResultFallback();
					if (component) {
						renderContainer.addChild(component);
						hasContent = true;
					}
				} else {
					try {
						const component = resultRenderer(
							{ content: this.result.content as any, details: this.result.details },
							{ expanded: this.expanded, isPartial: this.isPartial },
							theme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = component;
						renderContainer.addChild(component);
						hasContent = true;
					} catch {
						this.resultRendererComponent = undefined;
						const component = this.createResultFallback();
						if (component) {
							renderContainer.addChild(component);
							hasContent = true;
						}
					}
				}
			}

			if (hasContent) {
				this.addChild(renderContainer);
			}
		} else {
			this.addChild(new Text(this.formatToolExecution(), 1, 1, bgFn));
			hasContent = true;
		}

		let imageCount = 0;
		if (this.result) {
			const imageBlocks = this.result.content.filter((content) => content.type === "image");
			const caps = getCapabilities();
			for (let index = 0; index < imageBlocks.length; index++) {
				const image = imageBlocks[index];
				if (caps.images && this.showImages && image.data && image.mimeType) {
					const converted = this.convertedImages.get(index);
					const imageData = converted?.data ?? image.data;
					const imageMimeType = converted?.mimeType ?? image.mimeType;
					if (caps.images === "kitty" && imageMimeType !== "image/png") continue;

					this.addChild(new Spacer(1));
					this.addChild(
						new Image(imageData, imageMimeType, { fallbackColor: (text: string) => theme.fg("toolOutput", text) }, {
							maxWidthCells: this.imageWidthCells,
						}),
					);
					imageCount++;
				}
			}
		}

		if (this.hasRendererDefinition() && !hasContent && imageCount === 0) {
			this.hideComponent = true;
			this.clear();
		}
	}

	protected override shouldRender(): boolean {
		return !this.hideComponent;
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	private formatToolExecution(): string {
		let text = theme.fg("toolTitle", theme.bold(this.toolName));
		const content = JSON.stringify(this.args, null, 2);
		if (content) {
			text += `\n\n${content}`;
		}
		const output = this.getTextOutput();
		if (output) {
			text += `\n${output}`;
		}
		return text;
	}
}
