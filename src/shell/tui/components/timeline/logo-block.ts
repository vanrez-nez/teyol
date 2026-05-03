import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "#tui/index.js";
import { getPackageDir } from "../../../../config.js";
import { theme } from "../../../theme/theme.js";
import { TimelineBlock } from "./base-block.js";

export interface LogoBlockState {
	logo?: string;
	versionLine: string;
	paddingTop: number;
	paddingBottom: number;
}

export interface SerializedLogoBlock {
	type: "logo";
	id: string;
	state: LogoBlockState;
}

export interface LogoBlockOptions {
	id?: string;
	logo?: string;
	versionLine: string;
	paddingTop?: number;
	paddingBottom?: number;
}

export function loadAsciiLogo(): string | undefined {
	const logoPath = join(getPackageDir(), "logo-ascii.txt");
	if (!existsSync(logoPath)) return undefined;

	const logo = readFileSync(logoPath, "utf-8").trimEnd();
	return logo.trim() ? logo : undefined;
}

function withVerticalPadding(text: string, top: number, bottom: number): string {
	const topPadding = "\n".repeat(Math.max(0, top));
	const bottomPadding = "\n".repeat(Math.max(0, bottom));
	return `${topPadding}${text}${bottomPadding}`;
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
	private readonly paddingTop: number;
	private readonly paddingBottom: number;

	constructor(options: LogoBlockOptions) {
		super("logo", options.id);
		this.logo = options.logo ?? loadAsciiLogo();
		this.versionLine = options.versionLine;
		this.paddingTop = options.paddingTop ?? 0;
		this.paddingBottom = options.paddingBottom ?? 1;
	}

	override render(width: number): string[] {
		if (!this.logo) {
			return [withHorizontalPadding(theme.bold(theme.fg("accent", this.versionLine)), width)];
		}

		const logo = theme.bold(theme.fg("accent", this.logo));
		const centeredLogo = withHorizontalPadding(logo, width);
		const centeredVersion = withHorizontalPadding(theme.fg("dim", this.versionLine), width);
		return withVerticalPadding(`${centeredLogo}\n${centeredVersion}`, this.paddingTop, this.paddingBottom).split("\n");
	}

	serialize(): SerializedLogoBlock {
		return {
			type: "logo",
			id: this.id,
			state: {
				logo: this.logo,
				versionLine: this.versionLine,
				paddingTop: this.paddingTop,
				paddingBottom: this.paddingBottom,
			},
		};
	}
}
