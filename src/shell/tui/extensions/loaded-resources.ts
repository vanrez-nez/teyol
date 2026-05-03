import * as os from "node:os";
import type { ResourceDiagnostic, ResourceLoader } from "#shell/runtime/resource-loader.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import type { ExtensionRunner } from "#shell/runtime/extensions/index.js";
import { LoadedResourcesBlock, type LoadedResourcesSection } from "../components/timeline/loaded-resources-block.js";
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

export interface ShowLoadedResourcesOptions {
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

export function showLoadedResources(options: ShowLoadedResourcesOptions): LoadedResourcesBlock | undefined {
	const showListing = options.force || options.verbose || !options.quietStartup;
	const showDiagnostics = showListing || options.showDiagnosticsWhenQuiet === true;
	if (!showListing && !showDiagnostics) {
		return undefined;
	}

	const { resourceLoader } = options;
	const formatCompactList = (items: string[], formatOptions?: { sort?: boolean }): string => {
		const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
		if (formatOptions?.sort !== false) {
			labels.sort((a, b) => a.localeCompare(b));
		}
		return theme.fg("dim", `  ${labels.join(", ")}`);
	};
	const sections: LoadedResourcesSection[] = [];
	const addLoadedSection = (
		name: string,
		collapsedBody: string,
		expandedBody = collapsedBody,
		color: ThemeColor = "mdHeading",
	): void => {
		sections.push({ title: name, collapsedBody, expandedBody, color });
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
		addDiagnostics("Skill conflicts", skillsResult.diagnostics, sections, sourceInfos, homeDir);
		addDiagnostics("Prompt conflicts", promptsResult.diagnostics, sections, sourceInfos, homeDir);

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
		addDiagnostics("Extension issues", extensionDiagnostics, sections, sourceInfos, homeDir);

		addDiagnostics("Theme conflicts", themesResult.diagnostics, sections, sourceInfos, homeDir);
	}

	if (sections.length === 0) {
		return undefined;
	}

	return new LoadedResourcesBlock({
		sections,
		expanded: options.getStartupExpansionState(),
	});
}

function addDiagnostics(
	label: string,
	diagnostics: ResourceDiagnostic[],
	sections: LoadedResourcesSection[],
	sourceInfos: Map<string, SourceInfo>,
	homeDir: string,
): void {
	if (diagnostics.length === 0) {
		return;
	}
	const warningLines = formatDiagnostics(diagnostics, sourceInfos, homeDir);
	sections.push({
		title: label,
		collapsedBody: warningLines,
		expandedBody: warningLines,
		color: "warning",
	});
}
