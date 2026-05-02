import * as path from "node:path";
import type { Message } from "#ai/index.js";
import type { SessionStats } from "#shell/runtime/agent-session.js";
import type { ResourceDiagnostic } from "#shell/runtime/resource-loader.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import { theme } from "../theme/theme.js";

export interface ResourcePathItem {
	path: string;
	sourceInfo?: SourceInfo;
}

export interface ScopeGroup {
	scope: "user" | "project" | "path";
	paths: ResourcePathItem[];
	packages: Map<string, ResourcePathItem[]>;
}

export interface DisplaySourceInfo {
	label: string;
	scopeLabel?: string;
	color: "accent" | "muted";
}

export function formatDisplayPath(p: string, homeDir: string): string {
	if (p.startsWith(homeDir)) {
		return `~${p.slice(homeDir.length)}`;
	}
	return p;
}

export function formatExtensionDisplayPath(p: string, homeDir: string): string {
	return formatDisplayPath(p, homeDir).replace(/\/index\.ts$/, "").replace(/\/index\.js$/, "");
}

export function formatContextPath(p: string, cwd: string, homeDir: string): string {
	const resolvedCwd = path.resolve(cwd);
	const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(resolvedCwd, p);
	const relativePath = path.relative(resolvedCwd, absolutePath);
	const isInsideCwd =
		relativePath === "" ||
		(!relativePath.startsWith("..") && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));

	if (isInsideCwd) {
		return relativePath || ".";
	}

	return formatDisplayPath(absolutePath, homeDir);
}

export function isPackageSource(sourceInfo?: SourceInfo): boolean {
	const source = sourceInfo?.source ?? "";
	return source.startsWith("npm:") || source.startsWith("git:");
}

export function getShortPath(fullPath: string, sourceInfo: SourceInfo | undefined, homeDir: string): string {
	const baseDir = sourceInfo?.baseDir;
	if (baseDir && isPackageSource(sourceInfo)) {
		const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
		if (
			relativePath &&
			relativePath !== "." &&
			!relativePath.startsWith("..") &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath)
		) {
			return relativePath.replace(/\\/g, "/");
		}
	}

	const source = sourceInfo?.source ?? "";
	const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
	if (npmMatch && source.startsWith("npm:")) {
		return npmMatch[2]!;
	}

	const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
	if (gitMatch && source.startsWith("git:")) {
		return gitMatch[1]!;
	}

	return formatDisplayPath(fullPath, homeDir);
}

export function getCompactPathLabel(resourcePath: string, sourceInfo: SourceInfo | undefined, homeDir: string): string {
	const shortPath = getShortPath(resourcePath, sourceInfo, homeDir);
	const normalizedPath = shortPath.replace(/\\/g, "/");
	const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
	if (segments.length > 0) {
		return segments[segments.length - 1]!;
	}
	return shortPath;
}

export function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
	const source = sourceInfo?.source ?? "";
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length) || source;
	}

	return source;
}

export function getCompactExtensionLabel(
	resourcePath: string,
	sourceInfo: SourceInfo | undefined,
	homeDir: string,
): string {
	if (!isPackageSource(sourceInfo)) {
		return getCompactPathLabel(resourcePath, sourceInfo, homeDir);
	}

	const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
	if (!sourceLabel) {
		return getCompactPathLabel(resourcePath, sourceInfo, homeDir);
	}

	const shortPath = getShortPath(resourcePath, sourceInfo, homeDir).replace(/\\/g, "/");
	const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
	const parsedPath = path.posix.parse(packagePath);

	if (parsedPath.name === "index") {
		return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
	}

	return `${sourceLabel}:${packagePath}`;
}

export function getCompactDisplayPathSegments(resourcePath: string, homeDir: string): string[] {
	return formatDisplayPath(resourcePath, homeDir)
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== "~");
}

export function getCompactNonPackageExtensionLabel(
	resourcePath: string,
	index: number,
	allPaths: Array<{ path: string; segments: string[] }>,
	homeDir: string,
): string {
	const segments = allPaths[index]?.segments;
	if (!segments || segments.length === 0) {
		return getCompactPathLabel(resourcePath, undefined, homeDir);
	}

	for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
		const candidate = segments.slice(-segmentCount).join("/");
		const isUnique = allPaths.every((item, itemIndex) => {
			if (itemIndex === index) {
				return true;
			}
			return item.segments.slice(-segmentCount).join("/") !== candidate;
		});

		if (isUnique) {
			return candidate;
		}
	}

	return segments.join("/");
}

export function getCompactExtensionLabels(extensions: ResourcePathItem[], homeDir: string): string[] {
	const nonPackageExtensions = extensions
		.map((extension) => {
			const segments = getCompactDisplayPathSegments(extension.path, homeDir);
			const lastSegment = segments[segments.length - 1];
			if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
				segments.pop();
			}
			return {
				path: extension.path,
				sourceInfo: extension.sourceInfo,
				segments,
			};
		})
		.filter((extension) => !isPackageSource(extension.sourceInfo));

	return extensions.map((extension) => {
		if (isPackageSource(extension.sourceInfo)) {
			return getCompactExtensionLabel(extension.path, extension.sourceInfo, homeDir);
		}

		const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
		if (nonPackageIndex === -1) {
			return getCompactPathLabel(extension.path, extension.sourceInfo, homeDir);
		}

		return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions, homeDir);
	});
}

export function getDisplaySourceInfo(sourceInfo?: SourceInfo): DisplaySourceInfo {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "local") {
		if (scope === "user") {
			return { label: "user", color: "muted" };
		}
		if (scope === "project") {
			return { label: "project", color: "muted" };
		}
		if (scope === "temporary") {
			return { label: "path", scopeLabel: "temp", color: "muted" };
		}
		return { label: "path", color: "muted" };
	}

	if (source === "cli") {
		return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined, color: "muted" };
	}

	const scopeLabel =
		scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
	return { label: source, scopeLabel, color: "accent" };
}

export function getScopeGroup(sourceInfo?: SourceInfo): ScopeGroup["scope"] {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "cli" || scope === "temporary") return "path";
	if (scope === "user") return "user";
	if (scope === "project") return "project";
	return "path";
}

export function buildScopeGroups(items: ResourcePathItem[]): ScopeGroup[] {
	const groups: Record<ScopeGroup["scope"], ScopeGroup> = {
		user: { scope: "user", paths: [], packages: new Map() },
		project: { scope: "project", paths: [], packages: new Map() },
		path: { scope: "path", paths: [], packages: new Map() },
	};

	for (const item of items) {
		const groupKey = getScopeGroup(item.sourceInfo);
		const group = groups[groupKey];
		const source = item.sourceInfo?.source ?? "local";

		if (isPackageSource(item.sourceInfo)) {
			const list = group.packages.get(source) ?? [];
			list.push(item);
			group.packages.set(source, list);
		} else {
			group.paths.push(item);
		}
	}

	return [groups.project, groups.user, groups.path].filter(
		(group) => group.paths.length > 0 || group.packages.size > 0,
	);
}

export function formatScopeGroups(
	groups: ScopeGroup[],
	options: {
		formatPath: (item: ResourcePathItem) => string;
		formatPackagePath: (item: ResourcePathItem, source: string) => string;
	},
): string {
	const lines: string[] = [];

	for (const group of groups) {
		lines.push(`  ${theme.fg("accent", group.scope)}`);

		const sortedPaths = [...group.paths].sort((a, b) => a.path.localeCompare(b.path));
		for (const item of sortedPaths) {
			lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
		}

		const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
		for (const [source, items] of sortedPackages) {
			lines.push(`    ${theme.fg("mdLink", source)}`);
			const sortedPackagePaths = [...items].sort((a, b) => a.path.localeCompare(b.path));
			for (const item of sortedPackagePaths) {
				lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
			}
		}
	}

	return lines.join("\n");
}

export function findSourceInfoForPath(p: string, sourceInfos: ReadonlyMap<string, SourceInfo>): SourceInfo | undefined {
	const exact = sourceInfos.get(p);
	if (exact) return exact;

	let current = p;
	while (current.includes("/")) {
		current = current.substring(0, current.lastIndexOf("/"));
		const parent = sourceInfos.get(current);
		if (parent) return parent;
	}

	return undefined;
}

export function formatPathWithSource(p: string, sourceInfo: SourceInfo | undefined, homeDir: string): string {
	if (sourceInfo) {
		const shortPath = getShortPath(p, sourceInfo, homeDir);
		const { label, scopeLabel } = getDisplaySourceInfo(sourceInfo);
		const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
		return `${labelText} ${shortPath}`;
	}
	return formatDisplayPath(p, homeDir);
}

export function formatDiagnostics(
	diagnostics: readonly ResourceDiagnostic[],
	sourceInfos: ReadonlyMap<string, SourceInfo>,
	homeDir: string,
): string {
	const lines: string[] = [];
	const collisions = new Map<string, ResourceDiagnostic[]>();
	const otherDiagnostics: ResourceDiagnostic[] = [];

	for (const diagnostic of diagnostics) {
		if (diagnostic.type === "collision" && diagnostic.collision) {
			const list = collisions.get(diagnostic.collision.name) ?? [];
			list.push(diagnostic);
			collisions.set(diagnostic.collision.name, list);
		} else {
			otherDiagnostics.push(diagnostic);
		}
	}

	for (const [name, collisionList] of collisions) {
		const first = collisionList[0]?.collision;
		if (!first) continue;
		lines.push(theme.fg("warning", `  "${name}" collision:`));
		lines.push(
			theme.fg(
				"dim",
				`    ${theme.fg("success", "✓")} ${formatPathWithSource(
					first.winnerPath,
					findSourceInfoForPath(first.winnerPath, sourceInfos),
					homeDir,
				)}`,
			),
		);
		for (const diagnostic of collisionList) {
			if (!diagnostic.collision) continue;
			lines.push(
				theme.fg(
					"dim",
					`    ${theme.fg("warning", "✗")} ${formatPathWithSource(
						diagnostic.collision.loserPath,
						findSourceInfoForPath(diagnostic.collision.loserPath, sourceInfos),
						homeDir,
					)} (skipped)`,
				),
			);
		}
	}

	for (const diagnostic of otherDiagnostics) {
		if (diagnostic.path) {
			const formattedPath = formatPathWithSource(
				diagnostic.path,
				findSourceInfoForPath(diagnostic.path, sourceInfos),
				homeDir,
			);
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `  ${formattedPath}`));
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `    ${diagnostic.message}`));
		} else {
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `  ${diagnostic.message}`));
		}
	}

	return lines.join("\n");
}

export function getUserMessageText(message: Message): string {
	if (message.role !== "user") return "";
	const textBlocks =
		typeof message.content === "string"
			? [{ type: "text", text: message.content }]
			: message.content.filter((content: { type: string }) => content.type === "text");
	return textBlocks.map((content) => (content as { text: string }).text).join("");
}

export function formatAppKeyDisplay(keyTextValue: string): string {
	return keyTextValue
		.split("/")
		.map((key) =>
			key
				.split("+")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join("/");
}

export function formatSessionInfo(stats: SessionStats, sessionName: string | undefined): string {
	let info = `${theme.bold("Session Info")}\n\n`;
	if (sessionName) {
		info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
	}
	info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
	info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
	info += `${theme.bold("Messages")}\n`;
	info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
	info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
	info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
	info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
	info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
	info += `${theme.bold("Tokens")}\n`;
	info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
	info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
	if (stats.tokens.cacheRead > 0) {
		info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
	}
	if (stats.tokens.cacheWrite > 0) {
		info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
	}
	info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

	if (stats.cost > 0) {
		info += `\n${theme.bold("Cost")}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
	}

	return info;
}

export function formatLogFileDisplay(logPath: string, exists: boolean, tail: string): string {
	const lines = [`${theme.fg("accent", "Log file")}: ${theme.fg("muted", logPath)}`];
	if (!exists) {
		lines.push(theme.fg("muted", "(no log file yet)"));
	} else if (!tail) {
		lines.push(theme.fg("muted", "(empty)"));
	} else {
		lines.push("");
		lines.push(theme.fg("muted", "Recent entries:"));
		lines.push(tail);
	}
	return lines.join("\n");
}
