import * as os from "node:os";
import type { Container } from "#tui/index.js";
import { Spacer, Text } from "#tui/index.js";
import type { ResourceDiagnostic, ResourceLoader } from "#shell/runtime/resource-loader.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import type { ExtensionRunner } from "#shell/runtime/extensions/index.js";
import type { RegisteredCommand } from "../commands/types.js";
import { getBuiltInCommandConflictDiagnostics } from "../commands/autocomplete.js";
import {
	buildScopeGroups,
	formatContextPath,
	formatDiagnostics,
	formatDisplayPath,
	formatExtensionDisplayPath,
	formatScopeGroups,
	getCompactExtensionLabels,
	getCompactPathLabel,
	getShortPath,
} from "../display-helpers.js";
import { type ThemeColor, theme } from "../../theme/theme.js";

interface Expandable {
	setExpanded(expanded: boolean): void;
}

class ExpandableText extends Text implements Expandable {
	constructor(
		private readonly getCollapsedText: () => string,
		private readonly getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}

export interface ShowLoadedResourcesOptions {
	chatContainer: Container;
	resourceLoader: ResourceLoader;
	extensionRunner: ExtensionRunner;
	commands: ReadonlyArray<RegisteredCommand>;
	promptTemplates: ReadonlyArray<{ name: string; filePath: string; sourceInfo?: SourceInfo }>;
	cwd: string;
	verbose: boolean;
	quietStartup: boolean;
	getStartupExpansionState(): boolean;
	extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
	force?: boolean;
	showDiagnosticsWhenQuiet?: boolean;
}

export function showLoadedResources(options: ShowLoadedResourcesOptions): void {
	const showListing = options.force || options.verbose || !options.quietStartup;
	const showDiagnostics = showListing || options.showDiagnosticsWhenQuiet === true;
	if (!showListing && !showDiagnostics) {
		return;
	}

	const { chatContainer, resourceLoader } = options;
	const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
	const formatCompactList = (items: string[], formatOptions?: { sort?: boolean }): string => {
		const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
		if (formatOptions?.sort !== false) {
			labels.sort((a, b) => a.localeCompare(b));
		}
		return theme.fg("dim", `  ${labels.join(", ")}`);
	};
	const addLoadedSection = (
		name: string,
		collapsedBody: string,
		expandedBody = collapsedBody,
		color: ThemeColor = "mdHeading",
	): void => {
		const section = new ExpandableText(
			() => `${sectionHeader(name, color)}\n${collapsedBody}`,
			() => `${sectionHeader(name, color)}\n${expandedBody}`,
			options.getStartupExpansionState(),
			0,
			0,
		);
		chatContainer.addChild(section);
		chatContainer.addChild(new Spacer(1));
	};

	const homeDir = os.homedir();
	const skillsResult = resourceLoader.getSkills();
	const promptsResult = resourceLoader.getPrompts();
	const themesResult = resourceLoader.getThemes();
	const extensions =
		options.extensions ??
		resourceLoader.getExtensions().extensions.map((extension) => ({
			path: extension.path,
			sourceInfo: extension.sourceInfo,
		}));
	const sourceInfos = new Map<string, SourceInfo>();
	for (const extension of extensions) {
		if (extension.sourceInfo) {
			sourceInfos.set(extension.path, extension.sourceInfo);
		}
	}
	for (const skill of skillsResult.skills) {
		if (skill.sourceInfo) {
			sourceInfos.set(skill.filePath, skill.sourceInfo);
		}
	}
	for (const prompt of promptsResult.prompts) {
		if (prompt.sourceInfo) {
			sourceInfos.set(prompt.filePath, prompt.sourceInfo);
		}
	}
	for (const loadedTheme of themesResult.themes) {
		if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
			sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
		}
	}

	if (showListing) {
		const contextFiles = resourceLoader.getAgentsFiles().agentsFiles;
		if (contextFiles.length > 0) {
			chatContainer.addChild(new Spacer(1));
			const contextList = contextFiles.map((file) => theme.fg("dim", `  ${formatDisplayPath(file.path, homeDir)}`)).join("\n");
			const contextCompactList = formatCompactList(
				contextFiles.map((contextFile) => formatContextPath(contextFile.path, options.cwd, homeDir)),
				{ sort: false },
			);
			addLoadedSection("Context", contextCompactList, contextList);
		}

		const skills = skillsResult.skills;
		if (skills.length > 0) {
			const groups = buildScopeGroups(
				skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
			);
			const skillList = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path, homeDir),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo, homeDir),
			});
			const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
			addLoadedSection("Skills", skillCompactList, skillList);
		}

		const templates = options.promptTemplates;
		if (templates.length > 0) {
			const groups = buildScopeGroups(
				templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
			);
			const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
			const templateList = formatScopeGroups(groups, {
				formatPath: (item) => {
					const template = templateByPath.get(item.path);
					return template ? `/${template.name}` : formatDisplayPath(item.path, homeDir);
				},
				formatPackagePath: (item) => {
					const template = templateByPath.get(item.path);
					return template ? `/${template.name}` : formatDisplayPath(item.path, homeDir);
				},
			});
			const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
			addLoadedSection("Prompts", promptCompactList, templateList);
		}

		if (extensions.length > 0) {
			const groups = buildScopeGroups(extensions);
			const extensionList = formatScopeGroups(groups, {
				formatPath: (item) => formatExtensionDisplayPath(item.path, homeDir),
				formatPackagePath: (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo, homeDir), homeDir),
			});
			const extensionCompactList = formatCompactList(getCompactExtensionLabels(extensions, homeDir));
			addLoadedSection("Extensions", extensionCompactList, extensionList, "mdHeading");
		}

		const customThemes = themesResult.themes.filter((loadedTheme) => loadedTheme.sourcePath);
		if (customThemes.length > 0) {
			const groups = buildScopeGroups(
				customThemes.map((loadedTheme) => ({
					path: loadedTheme.sourcePath!,
					sourceInfo: loadedTheme.sourceInfo,
				})),
			);
			const themeList = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path, homeDir),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo, homeDir),
			});
			const themeCompactList = formatCompactList(
				customThemes.map(
					(loadedTheme) =>
						loadedTheme.name ?? getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo, homeDir),
				),
			);
			addLoadedSection("Themes", themeCompactList, themeList);
		}
	}

	if (showDiagnostics) {
		addDiagnostics("Skill conflicts", skillsResult.diagnostics, chatContainer, sourceInfos, homeDir);
		addDiagnostics("Prompt conflicts", promptsResult.diagnostics, chatContainer, sourceInfos, homeDir);

		const extensionDiagnostics: ResourceDiagnostic[] = [];
		const extensionErrors = resourceLoader.getExtensions().errors;
		if (extensionErrors.length > 0) {
			for (const error of extensionErrors) {
				extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
			}
		}
		extensionDiagnostics.push(...options.extensionRunner.getCommandDiagnostics());
		extensionDiagnostics.push(...getBuiltInCommandConflictDiagnostics(options.extensionRunner, options.commands));
		extensionDiagnostics.push(...options.extensionRunner.getShortcutDiagnostics());
		addDiagnostics("Extension issues", extensionDiagnostics, chatContainer, sourceInfos, homeDir);

		addDiagnostics("Theme conflicts", themesResult.diagnostics, chatContainer, sourceInfos, homeDir);
	}
}

function addDiagnostics(
	label: string,
	diagnostics: ResourceDiagnostic[],
	chatContainer: Container,
	sourceInfos: Map<string, SourceInfo>,
	homeDir: string,
): void {
	if (diagnostics.length === 0) {
		return;
	}
	const warningLines = formatDiagnostics(diagnostics, sourceInfos, homeDir);
	chatContainer.addChild(new Text(`${theme.fg("warning", `[${label}]`)}\n${warningLines}`, 0, 0));
	chatContainer.addChild(new Spacer(1));
}
