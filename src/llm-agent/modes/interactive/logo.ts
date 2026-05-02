import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Component, visibleWidth } from "#tui/index.js";
import { getPackageDir } from "../../../config.js";
import { theme } from "./theme/theme.js";

export function loadAsciiLogo(): string | undefined {
	const logoPath = join(getPackageDir(), "logo-ascii.txt");
	if (!existsSync(logoPath)) return undefined;

	const logo = readFileSync(logoPath, "utf-8").trimEnd();
	return logo.trim() ? logo : undefined;
}

export function withVerticalPadding(text: string, top: number, bottom: number): string {
	const topPadding = "\n".repeat(Math.max(0, top));
	const bottomPadding = "\n".repeat(Math.max(0, bottom));
	return `${topPadding}${text}${bottomPadding}`;
}

export function withHorizontalPadding(text: string, width: number, align: "center" = "center"): string {
	if (align !== "center") return text;

	return text
		.split("\n")
		.map((line) => {
			const lineWidth = visibleWidth(line);
			const padding = Math.max(0, Math.floor((width - lineWidth) / 2));
			return `${" ".repeat(padding)}${line}`;
		})
		.join("\n");
}

export class LogoComponent implements Component {
	constructor(
		private readonly logo: string | undefined,
		private readonly versionLine: string,
		private readonly paddingTop = 0,
		private readonly paddingBottom = 1,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.logo) {
			return [withHorizontalPadding(theme.bold(theme.fg("accent", this.versionLine)), width, "center")];
		}

		const logo = theme.bold(theme.fg("accent", this.logo));
		const centeredLogo = withHorizontalPadding(logo, width, "center");
		const centeredVersion = withHorizontalPadding(theme.fg("dim", this.versionLine), width, "center");
		return withVerticalPadding(`${centeredLogo}\n${centeredVersion}`, this.paddingTop, this.paddingBottom).split("\n");
	}
}
