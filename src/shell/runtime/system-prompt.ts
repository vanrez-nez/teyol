/**
 * System prompt construction and context loading.
 */

import { logger } from "#logger";
import { formatSkillsForPrompt, type Skill } from "./skills.js";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: no tools. */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

function appendContextAndSkills(prompt: string, contextFiles: Array<{ path: string; content: string }>, skills: Skill[]): string {
	let next = prompt;

	if (contextFiles.length > 0) {
		next += "\n\n# Context Files\n\n";
		next += "Additional instructions and context provided by the user or environment:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			next += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	if (skills.length > 0) {
		next += formatSkillsForPrompt(skills);
	}

	return next;
}

/** Build the system prompt with tools, guidelines, and context. */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		prompt = appendContextAndSkills(prompt, contextFiles, skills);

		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		logger.debug("prompt.system", { custom: true, prompt });
		return prompt;
	}

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools ?? [];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Be explicit when you are relying only on conversation context");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are a helpful general-purpose AI assistant running in a command-line interface.

Available tools:
${toolsList}

Only claim you can use a tool when it is listed above. If no tools are listed, answer from the conversation, attached content, and any context files provided.

Guidelines:
${guidelines}`;

	if (appendSection) {
		prompt += appendSection;
	}

	prompt = appendContextAndSkills(prompt, contextFiles, skills);

	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	logger.debug("prompt.system", {
		custom: false,
		visibleTools,
		prompt,
	});
	return prompt;
}
