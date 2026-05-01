import { Type, type ExtensionAPI } from "@teyol";

interface HelpSection {
	document: string;
	title: string;
	keywords: string[];
	description: string;
	content: string;
}

interface ScoredSection {
	section: HelpSection;
	score: number;
}

const MAX_RESULTS = 5;

const SECTIONS: HelpSection[] = [
	{
		document: "Teyol Basics",
		title: "Using Teyol",
		keywords: ["teyol", "cli", "usage", "prompt", "assistant"],
		description: "Teyol is an interactive command-line assistant that can answer prompts and use configured tools.",
		content:
			"Start Teyol in a project directory, type a prompt, and submit it. Slash commands manage local behavior such as settings, model selection, sessions, hotkeys, reload, and exit.",
	},
	{
		document: "Teyol Basics",
		title: "Slash Commands",
		keywords: ["slash", "commands", "model", "session", "settings", "hotkeys"],
		description: "Slash commands are user-facing interactive commands.",
		content:
			"Use /model to manage model selection and fast-cycle models. Use /session to manage session actions. Use /settings for runtime toggles, /hotkeys for shortcuts, /reload to reload resources, and /exit to quit.",
	},
	{
		document: "Teyol Extensions",
		title: "Extensions",
		keywords: ["extensions", "project", "global", "autoload", "register"],
		description: "Extensions are TypeScript or JavaScript modules loaded from Teyol extension directories.",
		content:
			"Project-local extensions live under .teyol/extensions. An extension exports a default factory function that receives the Teyol extension API and can register tools, commands, shortcuts, flags, event handlers, message renderers, providers, and UI behavior.",
	},
	{
		document: "Teyol Extensions",
		title: "LLM Tools",
		keywords: ["tools", "function", "call", "registerTool", "schema", "promptSnippet"],
		description: "Extensions can register LLM-callable tools with schemas and execution handlers.",
		content:
			"Use teyol.registerTool with a name, label, description, TypeBox parameters, and execute handler. Tools with a promptSnippet appear in the available tools section of the system prompt. Extension tools are active by default unless a tool allowlist is configured.",
	},
	{
		document: "Teyol Extensions",
		title: "Help Search",
		keywords: ["help", "docs", "documentation", "search", "keyword"],
		description: "The teyol_help tool searches small documentation sections by keyword.",
		content:
			"Call teyol_help with a keyword or short phrase when a user asks how Teyol works. The tool ranks section title matches first, keyword matches second, then description and content matches.",
	},
];

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_-]+/i)
		.map((token) => token.trim())
		.filter(Boolean);
}

function fieldScore(queryTokens: string[], value: string, exactWeight: number, fuzzyWeight: number): number {
	const valueTokens = tokenize(value);
	const valueText = value.toLowerCase();
	let score = 0;

	for (const queryToken of queryTokens) {
		if (valueTokens.includes(queryToken)) {
			score += exactWeight;
			continue;
		}
		if (valueText.includes(queryToken)) {
			score += fuzzyWeight;
			continue;
		}
		if (valueTokens.some((valueToken) => valueToken.includes(queryToken) || queryToken.includes(valueToken))) {
			score += Math.max(1, Math.floor(fuzzyWeight / 2));
		}
	}

	return score;
}

function scoreSection(keyword: string, section: HelpSection): number {
	const queryTokens = tokenize(keyword);
	if (queryTokens.length === 0) return 0;

	return (
		fieldScore(queryTokens, section.title, 12, 8) +
		fieldScore(queryTokens, section.keywords.join(" "), 8, 5) +
		fieldScore(queryTokens, section.description, 4, 2) +
		fieldScore(queryTokens, section.content, 2, 1)
	);
}

function searchSections(keyword: string): ScoredSection[] {
	return SECTIONS.map((section) => ({ section, score: scoreSection(keyword, section) }))
		.filter((result) => result.score > 0)
		.sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title))
		.slice(0, MAX_RESULTS);
}

function formatResults(keyword: string, results: ScoredSection[]): string {
	if (results.length === 0) {
		return `No matching Teyol help found for "${keyword}". Try broader keywords such as "extensions", "tools", "model", "session", or "commands".`;
	}

	const lines = [`Teyol help results for "${keyword}":`];
	for (const { section } of results) {
		lines.push("");
		lines.push(`## ${section.title}`);
		lines.push(`Document: ${section.document}`);
		lines.push(section.description);
		lines.push(section.content);
		lines.push(`Keywords: ${section.keywords.join(", ")}`);
	}
	return lines.join("\n");
}

export default function teyolHelpExtension(teyol: ExtensionAPI): void {
	teyol.registerTool({
		name: "teyol_help",
		label: "Teyol Help",
		description: "Search Teyol usage, command, extension, and tool documentation by keyword.",
		promptSnippet: "Search concise Teyol usage and extension documentation by keyword.",
		parameters: Type.Object({
			keyword: Type.String({
				description: "Keyword or short phrase to search for in Teyol help documentation.",
			}),
		}),
		async execute(_toolCallId, params) {
			const keyword = params.keyword.trim();
			const results = searchSections(keyword);
			return {
				content: [{ type: "text", text: formatResults(keyword, results) }],
				details: {
					keyword,
					matches: results.map(({ section, score }) => ({
						document: section.document,
						title: section.title,
						score,
					})),
				},
			};
		},
	});
}
