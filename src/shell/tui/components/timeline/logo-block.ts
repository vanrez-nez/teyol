import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "#tui/index.js";
import { getPackageDir } from "../../../../config.js";
import { theme } from "../../../theme/theme.js";
import { TimelineBlock, type TimelineBlockEdges, type TimelineBlockOptions } from "./base-block.js";

export interface LogoBlockState {
	logo?: string;
	versionLine: string;
	padding: Required<TimelineBlockEdges>;
}

export interface SerializedLogoBlock {
	type: "logo";
	id: string;
	state: LogoBlockState;
}

export interface LogoBlockOptions extends TimelineBlockOptions {
	logo?: string;
	versionLine: string;
}

export function loadAsciiLogo(): string | undefined {
	const logoPath = join(getPackageDir(), "logo-ascii.txt");
	if (!existsSync(logoPath)) return undefined;

	const logo = readFileSync(logoPath, "utf-8").trimEnd();
	return logo.trim() ? logo : undefined;
}

function withHorizontalPadding(text: string, width: number): string {
	return text
		.split("\n")
		.map((line) => {
			const lineWidth = visibleWidth(line);
			const padding = Math.max(0, Math.floor((width - lineWidth) / 2));
			return `${" ".repeat(padding)}${line}`;
		})
		.join("\n");
}

export class LogoBlock extends TimelineBlock {
	private readonly logo: string | undefined;
	private readonly versionLine: string;

	constructor(options: LogoBlockOptions) {
		super("logo", { ...options, padding: { top: 0, bottom: 1, ...options.padding } });
		this.logo = options.logo ?? loadAsciiLogo();
		this.versionLine = options.versionLine;
	}

	protected override renderContent(width: number): string[] {
		if (!this.logo) {
			return [withHorizontalPadding(theme.bold(theme.fg("accent", this.versionLine)), width)];
		}

		const logo = theme.bold(theme.fg("accent", this.logo));
		const centeredLogo = withHorizontalPadding(logo, width);
		const centeredVersion = withHorizontalPadding(theme.fg("dim", this.versionLine), width);
		return `${centeredLogo}\n${centeredVersion}`.split("\n");
	}

	serialize(): SerializedLogoBlock {
		return {
			type: "logo",
			id: this.id,
			state: {
				logo: this.logo,
				versionLine: this.versionLine,
				padding: this.getPresentationState().padding,
			},
		};
	}
}
