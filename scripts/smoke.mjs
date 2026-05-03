import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "../dist/ai/index.js";
import { createAgentSession } from "../dist/shell/runtime/sdk.js";
import { AuthStorage } from "../dist/shell/runtime/auth-storage.js";
import { ModelRegistry } from "../dist/shell/runtime/model-registry.js";
import { DefaultResourceLoader } from "../dist/shell/runtime/resource-loader.js";
import { SessionManager } from "../dist/shell/runtime/session-manager.js";
import { SettingsManager } from "../dist/shell/runtime/settings-manager.js";
import { buildSystemPrompt } from "../dist/shell/runtime/system-prompt.js";
import { loadExtensions } from "../dist/shell/runtime/extensions/loader.js";
import { validateUiDescriptorFixtures } from "../dist/shell/descriptors/ui-descriptors.fixtures.js";
import {
	ShellLayoutComponent,
	SIDEBAR_MIN_TERMINAL_WIDTH,
} from "../dist/shell/tui/layout.js";
import { initTheme, theme } from "../dist/shell/theme/theme.js";
import { createCliState } from "../dist/shell/tui/state/index.js";
import { dispatchBuiltInCommand } from "../dist/shell/tui/commands/built-in.js";
import { buildAutocomplete, getBuiltInCommandConflictDiagnostics } from "../dist/shell/tui/commands/autocomplete.js";
import { registerCommand } from "../dist/shell/tui/commands/types.js";
import {
	buildScopeGroups,
	formatAppKeyDisplay,
	formatContextPath,
	formatDiagnostics,
	formatDisplayPath,
	formatLogFileDisplay,
	formatSessionInfo,
	getCompactExtensionLabels,
	getShortPath,
	getUserMessageText,
} from "../dist/shell/tui/display-helpers.js";
import { Timeline } from "../dist/shell/tui/timeline.js";
import { TimelineBlock, UserMessageBlock } from "../dist/shell/tui/components/index.js";
import { buildHotkeyHelpMarkdown } from "../dist/shell/tui/hotkeys/help.js";
import { Container, visibleWidth } from "../dist/tui/index.js";

const repoRoot = process.cwd();
const cliRoot = mkdtempSync(join(tmpdir(), "teyol-cli-"));
const cliEnv = { ...process.env, TEYOL_AGENT_DIR: join(cliRoot, "agent") };

function makeServices(name) {
	const root = mkdtempSync(join(tmpdir(), `teyol-${name}-`));
	const agentDir = join(root, "agent");
	const authStorage = AuthStorage.create(join(root, "auth.json"));
	const settingsManager = SettingsManager.create(root, agentDir);
	const modelRegistry = ModelRegistry.create(authStorage, join(root, "models.json"));
	return { root, agentDir, authStorage, settingsManager, modelRegistry };
}

function createEchoTool(name) {
	return {
		name,
		label: name,
		description: `Return a fixed ${name} response`,
		promptSnippet: `${name} test tool`,
		parameters: Type.Object({
			text: Type.Optional(Type.String()),
		}),
		async execute() {
			return {
				content: [{ type: "text", text: `${name}:ok` }],
			};
		},
	};
}

async function createSessionWithTools(toolNames, options = {}) {
	const services = makeServices("tools");
	const resourceLoader = new DefaultResourceLoader({
		cwd: services.root,
		agentDir: services.agentDir,
		settingsManager: services.settingsManager,
		extensionFactories: [
			(ai) => {
				for (const name of toolNames) {
					ai.registerTool(createEchoTool(name));
				}
			},
		],
	});
	await resourceLoader.reload();
	const result = await createAgentSession({
		cwd: services.root,
		agentDir: services.agentDir,
		authStorage: services.authStorage,
		settingsManager: services.settingsManager,
		modelRegistry: services.modelRegistry,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		...options,
	});
	return result.session;
}

async function testNoToolsByDefault() {
	const services = makeServices("no-tools");
	const { session } = await createAgentSession({
		cwd: services.root,
		agentDir: services.agentDir,
		authStorage: services.authStorage,
		settingsManager: services.settingsManager,
		modelRegistry: services.modelRegistry,
		sessionManager: SessionManager.inMemory(),
	});
	try {
		assert.deepEqual(session.getActiveToolNames(), []);
	} finally {
		session.dispose();
	}
}

async function testExtensionToolsActiveByDefault() {
	const session = await createSessionWithTools(["echo"]);
	try {
		assert.deepEqual(session.getActiveToolNames(), ["echo"]);
	} finally {
		session.dispose();
	}
}

async function testNoToolsDisablesExtensionTools() {
	const session = await createSessionWithTools(["echo"], { noTools: "all" });
	try {
		assert.deepEqual(session.getActiveToolNames(), []);
	} finally {
		session.dispose();
	}
}

async function testToolAllowlist() {
	const session = await createSessionWithTools(["one", "two"], { tools: ["one"] });
	try {
		assert.deepEqual(session.getActiveToolNames(), ["one"]);
	} finally {
		session.dispose();
	}
}

async function testExtensionModuleCanImportTeyol() {
	const root = mkdtempSync(join(tmpdir(), "teyol-extension-alias-"));
	const extensionPath = join(root, "index.ts");
	writeFileSync(
		extensionPath,
		`
import { Type } from "@teyol";

export default function extension(teyol) {
\tteyol.registerTool({
\t\tname: "alias_test",
\t\tlabel: "Alias Test",
\t\tdescription: "Verifies @teyol resolves for extension modules.",
\t\tparameters: Type.Object({}),
\t\tasync execute() {
\t\t\treturn { content: [{ type: "text", text: "ok" }] };
\t\t},
\t});
}
`,
		"utf8",
	);

	const result = await loadExtensions([extensionPath], root);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	assert.deepEqual(Array.from(result.extensions[0].tools.keys()), ["alias_test"]);
}

function testSystemPrompt() {
	const prompt = buildSystemPrompt({ cwd: repoRoot, selectedTools: [] });
	assert.match(prompt, /Available tools:\n\(none\)/);
	assert.match(prompt, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(prompt, /coding assistant|coding agent|bash|edit|write|pi-mono|ai-cli/i);

	const toolPrompt = buildSystemPrompt({
		cwd: repoRoot,
		selectedTools: ["echo"],
		toolSnippets: { echo: "Echo input text" },
	});
	assert.match(toolPrompt, /echo: Echo input text/);
	assert.doesNotMatch(toolPrompt, /otherTool/);
}

function testCliHelp() {
	const help = execFileSync(process.execPath, ["dist/cli/main.js", "--help"], {
		cwd: repoRoot,
		env: cliEnv,
		encoding: "utf-8",
	});
	assert.match(help, /^teyol - Generic AI assistant/m);
	assert.doesNotMatch(help, /Built-in Tool|update \[source|Run bash|coding agent/i);
}

function testUnknownFlagDiagnostics() {
	assert.throws(() => {
		execFileSync(process.execPath, ["dist/cli/main.js", "-z"], {
			cwd: repoRoot,
			env: cliEnv,
			encoding: "utf-8",
			stdio: "pipe",
		});
	}, /Unknown option: -z/);

	assert.throws(() => {
		execFileSync(process.execPath, ["dist/cli/main.js", "--fake-extension-flag", "--list-models"], {
			cwd: repoRoot,
			env: cliEnv,
			encoding: "utf-8",
			stdio: "pipe",
		});
	}, /Unknown option: --fake-extension-flag/);
}

function testUiDescriptorContracts() {
	const results = validateUiDescriptorFixtures();
	for (const result of results) {
		assert.equal(result.actual, result.expected, result.name);
	}
}

async function testLocalOllamaCompactionWithoutApiKey() {
	const services = makeServices("local-ollama-compaction");
	writeFileSync(
		join(services.root, "models.json"),
		JSON.stringify(
			{
				providers: {
					ollama: {
						baseUrl: "http://exena.local:11434/api",
						models: [{ id: "gemma4:e4b" }],
					},
				},
			},
			null,
			2,
		),
		"utf8",
	);
	services.modelRegistry.refresh();
	const model = services.modelRegistry.find("ollama", "gemma4:e4b");
	assert.ok(model);
	assert.equal(services.modelRegistry.hasConfiguredAuth(model), true);
	const requestAuth = await services.modelRegistry.getApiKeyAndHeaders(model);
	assert.equal(requestAuth.ok, true);
	assert.equal(requestAuth.apiKey, undefined);

	const resourceLoader = new DefaultResourceLoader({
		cwd: services.root,
		agentDir: services.agentDir,
		settingsManager: services.settingsManager,
		extensionFactories: [
			(ai) => {
				ai.on("session_before_compact", (event) => ({
					compaction: {
						summary: "local ollama compaction",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				}));
			},
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: services.root,
		agentDir: services.agentDir,
		authStorage: services.authStorage,
		settingsManager: services.settingsManager,
		modelRegistry: services.modelRegistry,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		model,
	});
	try {
		session.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `Earlier session context ${"x".repeat(1200)}` }],
			timestamp: Date.now(),
		});
		session.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `Earlier assistant response ${"y".repeat(1200)}` }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			timestamp: Date.now(),
		});
		session.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `Recent user message ${"z".repeat(1200)}` }],
			timestamp: Date.now(),
		});
		session.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `Recent assistant response ${"w".repeat(1200)}` }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			timestamp: Date.now(),
		});

		const result = await session.compact();
		assert.equal(result.summary, "local ollama compaction");
		assert.equal(session.sessionManager.getEntries().at(-1)?.type, "compaction");
	} finally {
		session.dispose();
	}
}

async function testBuiltInCommandDispatch() {
	const calls = [];
	const commands = [
		registerCommand(
			{
				name: "model",
				description: "model",
				execute: async (dependencies, invocation) => dependencies.calls.push(["model", invocation.raw]),
			},
			{ calls },
		),
		registerCommand(
			{
				name: "exit",
				aliases: ["quit"],
				description: "exit",
				execute: async (dependencies) => dependencies.calls.push(["exit"]),
			},
			{ calls },
		),
	];

	assert.equal(await dispatchBuiltInCommand("/model select openrouter/auto", commands), true);
	assert.equal(await dispatchBuiltInCommand("/quit", commands), true);
	assert.equal(await dispatchBuiltInCommand("/unknown", commands), false);
	assert.deepEqual(calls, [
		["model", "/model select openrouter/auto"],
		["exit"],
	]);
}

async function testInteractiveAutocompleteContracts() {
	const extensionRunner = {
		getRegisteredCommands() {
			return [
				{
					name: "session",
					invocationName: "session:extension",
					description: "conflict",
					sourceInfo: { path: "/tmp/ext.ts", scope: "user", source: "local" },
				},
				{
					name: "calendar",
					invocationName: "calendar",
					description: "calendar command",
					sourceInfo: { path: "/tmp/calendar.ts", scope: "project", source: "local" },
				},
			];
		},
	};

	const commands = [
		registerCommand(
			{
				name: "session",
				description: "session",
				execute: () => {},
			},
			{},
		),
		registerCommand(
			{
				name: "model",
				description: "model",
				complete: (dependencies, invocation) =>
					invocation.args === "select open"
						? [{ value: dependencies.value, label: dependencies.value, description: "model" }]
						: null,
				execute: () => {},
			},
			{ value: "openrouter/auto" },
		),
		registerCommand(
			{
				name: "log",
				description: "log",
				complete: () => [{ value: "enable", label: "enable", description: "Start writing log entries" }],
				execute: () => {},
			},
			{},
		),
	];

	const diagnostics = getBuiltInCommandConflictDiagnostics(extensionRunner, commands);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /conflicts with built-in interactive command/);

	const result = buildAutocomplete({
		promptTemplates: [],
		skills: [
			{
				name: "brief",
				description: "Be concise",
				filePath: "/tmp/SKILL.md",
				sourceInfo: { path: "/tmp/SKILL.md", scope: "user", source: "local" },
			},
		],
		enableSkillCommands: true,
		extensionRunner,
		cwd: repoRoot,
		commands,
	});
	assert.equal(typeof result.provider.getSuggestions, "function");
	assert.deepEqual(Array.from(result.skillCommands.entries()), [["skill:brief", "/tmp/SKILL.md"]]);

	const modelText = "/model select open";
	const modelSuggestions = await result.provider.getSuggestions([modelText], 0, modelText.length, {
		signal: new AbortController().signal,
	});
	assert.deepEqual(modelSuggestions?.items.map((item) => item.value), ["openrouter/auto"]);

	const logText = "/log ";
	const logSuggestions = await result.provider.getSuggestions([logText], 0, logText.length, {
		signal: new AbortController().signal,
	});
	assert.ok(logSuggestions?.items.some((item) => item.value === "enable"));
}

function testHotkeyHelpContracts() {
	const markdown = buildHotkeyHelpMarkdown({
		platform: "win32",
		extensionShortcuts: new Map([["ctrl+k", { description: "Calendar action", extensionPath: "/tmp/calendar.ts" }]]),
	});
	assert.match(markdown, /Keyboard|Navigation|Editing|Other/);
	assert.match(markdown, /Ctrl\+Enter on Windows Terminal/);
	assert.match(markdown, /Calendar action/);
}

function testDisplayHelperContracts() {
	initTheme("dark", false);
	const homeDir = "/Users/test";
	const cwd = "/Users/test/project";

	assert.equal(formatDisplayPath("/Users/test/project/file.md", homeDir), "~/project/file.md");
	assert.equal(formatContextPath("/Users/test/project/docs/notes.md", cwd, homeDir), "docs/notes.md");
	assert.equal(formatContextPath("/Users/test/other/notes.md", cwd, homeDir), "~/other/notes.md");

	const packageSource = { source: "npm:@scope/pkg", scope: "project", path: "/tmp/pkg", baseDir: "/tmp/pkg" };
	assert.equal(getShortPath("/tmp/pkg/extensions/calendar/index.ts", packageSource, homeDir), "extensions/calendar/index.ts");
	assert.deepEqual(getCompactExtensionLabels([{ path: "/tmp/pkg/extensions/calendar/index.ts", sourceInfo: packageSource }], homeDir), [
		"@scope/pkg:calendar",
	]);

	const groups = buildScopeGroups([
		{ path: "/Users/test/project/a.md", sourceInfo: { source: "local", scope: "project", path: "/Users/test/project/a.md" } },
		{ path: "/Users/test/b.md", sourceInfo: { source: "local", scope: "user", path: "/Users/test/b.md" } },
		{ path: "/tmp/pkg/extensions/calendar/index.ts", sourceInfo: packageSource },
	]);
	assert.deepEqual(groups.map((group) => group.scope), ["project", "user"]);
	assert.equal(groups[0].packages.get("npm:@scope/pkg").length, 1);

	const diagnostics = formatDiagnostics(
		[
			{
				type: "collision",
				message: "collision",
				collision: {
					name: "calendar",
					winnerPath: "/tmp/pkg/extensions/calendar/index.ts",
					loserPath: "/Users/test/project/extensions/calendar/index.ts",
				},
			},
		],
		new Map([["/tmp/pkg", packageSource]]),
		homeDir,
	);
	assert.match(diagnostics, /"calendar" collision/);
	assert.match(diagnostics, /npm:@scope\/pkg \(project\) extensions\/calendar\/index.ts/);
	assert.match(diagnostics, /skipped/);

	assert.equal(
		getUserMessageText({
			role: "user",
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", image: "ignored" },
				{ type: "text", text: " world" },
			],
		}),
		"hello world",
	);
	assert.equal(formatAppKeyDisplay("ctrl+shift+p/alt+enter"), "Ctrl+Shift+P/Alt+Enter");

	const sessionInfo = formatSessionInfo(
		{
			sessionFile: undefined,
			sessionId: "session-1",
			userMessages: 1,
			assistantMessages: 2,
			toolCalls: 3,
			toolResults: 4,
			totalMessages: 7,
			tokens: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 3, total: 3003 },
			cost: 0.25,
		},
		"Research",
	);
	assert.match(sessionInfo, /Session Info/);
	assert.match(sessionInfo, /Research/);
	assert.match(sessionInfo, /Cache Write/);
	assert.match(formatLogFileDisplay("/tmp/app.log", false, ""), /no log file yet/);
	assert.match(formatLogFileDisplay("/tmp/app.log", true, "recent"), /recent/);
}

function staticComponent(lines) {
	return {
		invalidate() {},
		render() {
			return lines;
		},
	};
}

function createTimelineForTest(options = {}) {
	const chatContainer = new Container();
	const editor = options.editor ?? {
		addToHistory() {},
	};
	const timeline = new Timeline(
		{
			ui: {
				requestRender() {},
			},
			chatContainer,
			pendingMessagesContainer: new Container(),
			statusContainer: new Container(),
			state: createCliState({
				hideThinkingBlock: false,
				hiddenThinkingLabel: "thinking",
				autoCompactEnabled: false,
			}),
			footer: {
				invalidate() {},
			},
			getSession: () => undefined,
			getEditor: () => editor,
			getMarkdownTheme: () => undefined,
			getRegisteredToolDefinition: () => undefined,
			updateEditorBorderColor() {},
		},
		options.timelineOptions ?? options,
	);
	return { timeline, chatContainer, editor };
}

function createShellLayoutForTest(options = {}) {
	const session = {
		state: { model: undefined },
		sessionManager: {
			getEntries: () => [],
			getCwd: () => repoRoot,
			getSessionName: () => undefined,
		},
		getContextUsage: () => undefined,
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};
	const layout = new ShellLayoutComponent({
		session,
		cwd: repoRoot,
		showHardwareCursor: false,
		clearOnShrink: false,
		...options,
	});
	layout.ui.requestRender = () => {};
	return layout;
}

function createShellLayoutRenderFixture(timelineLines, sidebarLines) {
	const layout = createShellLayoutForTest();
	layout.timeline.clear();
	layout.sidebar.clear();
	layout.timeline.addChild(staticComponent(timelineLines));
	layout.sidebar.addChild(staticComponent(sidebarLines));
	return layout;
}

function testTimelineBlockBaseContract() {
	class TestTimelineBlock extends TimelineBlock {
		constructor(options = {}) {
			super("test-block", { id: "block-1", ...options });
		}

		serialize() {
			return {
				type: "test-block",
				id: this.id,
				state: { text: "hello" },
			};
		}
	}

	const block = new TestTimelineBlock();
	block.addChild(staticComponent(["hello"]));
	const rendered = block.render(80);
	assert.equal(rendered.length, 1);
	assert.ok(rendered[0].includes("hello"));
	assert.deepEqual(block.serialize(), {
		type: "test-block",
		id: "block-1",
		state: { text: "hello" },
	});

	const padded = new TestTimelineBlock({ padding: { left: 2, top: 1, right: 1, bottom: 1 } });
	padded.addChild(staticComponent(["x"]));
	assert.deepEqual(padded.render(8), ["        ", "  x     ", "        "]);

	const bordered = new TestTimelineBlock({ border: { left: 1, top: 1, right: 1, bottom: 1 } });
	bordered.addChild(staticComponent(["x"]));
	const borderedLines = bordered.render(5);
	assert.equal(visibleWidth(borderedLines[0]), 5);
	assert.ok(borderedLines[0].includes("┌"));
	assert.ok(borderedLines[0].includes("┐"));
	assert.ok(borderedLines[1].includes("│"));
	assert.ok(borderedLines[2].includes("└"));
	assert.ok(borderedLines[2].includes("┘"));

	const margin = new TestTimelineBlock({ margin: { left: 1, top: 1, right: 1, bottom: 1 } });
	margin.addChild(staticComponent(["x"]));
	assert.deepEqual(margin.render(5), ["     ", " x   ", "     "]);

	initTheme("dark", false);
	const background = new TestTimelineBlock({ background: "userMessageBg" });
	background.addChild(staticComponent(["x"]));
	const [backgroundLine] = background.render(5);
	assert.ok(backgroundLine.includes(theme.getBgAnsi("userMessageBg")));
	assert.equal(visibleWidth(backgroundLine), 5);
}

function testTimelineBlockRendering() {
	class TestTimelineBlock extends TimelineBlock {
		constructor(id, text) {
			super("test-block", { id });
			this.addChild(staticComponent([text]));
		}

		serialize() {
			return {
				type: "test-block",
				id: this.id,
			};
		}
	}

	const { timeline } = createTimelineForTest({ maxVisibleBlocks: 2 });
	timeline.pushBlock(new TestTimelineBlock("one", "one"));
	timeline.pushBlock(new TestTimelineBlock("two", "two"));
	timeline.pushBlock(new TestTimelineBlock("three", "three"));
	assert.deepEqual(timeline.render(8), ["two     ", "three   "]);
}

function testTimelineStartupBlocks() {
	initTheme("dark", false);
	const { timeline, chatContainer } = createTimelineForTest();
	timeline.renderStartupContent({
		versionLine: "version 1",
		expandedInstructions: "expanded",
		compactInstructions: "compact",
		compactOnboarding: "compact onboarding",
		onboarding: "onboarding",
		expanded: false,
	});

	assert.equal(chatContainer.children.length, 1);
	assert.ok(timeline.getStartupContent());
	const startupLines = timeline.render(80).join("\n");
	assert.match(startupLines, /version 1/);
	assert.match(startupLines, /compact/);
	assert.match(startupLines, /onboarding/);

	timeline.renderStartupContent(undefined);
	assert.equal(timeline.getStartupContent(), undefined);
	assert.deepEqual(timeline.render(80), []);
}

function testUserMessageBlock() {
	initTheme("dark", false);
	const block = new UserMessageBlock({ id: "user-1", text: "hello **world**" });
	const rendered = block.render(80);
	assert.ok(rendered[0].includes("\x1b]133;A\x07"));
	assert.ok(rendered[rendered.length - 1].includes("\x1b]133;B\x07"));
	assert.ok(rendered[rendered.length - 1].includes("\x1b]133;C\x07"));
	assert.match(rendered.join("\n"), /hello/);
	assert.match(rendered.join("\n"), /world/);
	assert.deepEqual(block.serialize(), {
		type: "user-message",
		id: "user-1",
		state: { text: "hello **world**" },
	});
}

function testTimelineUserMessageBlocks() {
	initTheme("dark", false);
	const history = [];
	const editor = {
		addToHistory(text) {
			history.push(text);
		},
	};
	const { timeline, chatContainer } = createTimelineForTest({ editor });

	timeline.addMessage({ role: "user", content: "hello from timeline", timestamp: Date.now() }, { populateHistory: true });

	assert.equal(chatContainer.children.length, 1);
	assert.deepEqual(history, ["hello from timeline"]);
	assert.match(timeline.render(80).join("\n"), /hello from timeline/);
}

function testTimelineSkillBlockTrailingUserMessage() {
	initTheme("dark", false);
	const { timeline } = createTimelineForTest();
	timeline.addMessage({
		role: "user",
		content: '<skill name="demo" location="/tmp/demo">\nbody\n</skill>\n\ncontinue here',
		timestamp: Date.now(),
	});

	assert.match(timeline.render(80).join("\n"), /continue here/);
}

function testShellLayoutNarrowWidth() {
	initTheme("dark", false);
	const layout = createShellLayoutRenderFixture(["timeline"], ["sidebar"]);
	assert.deepEqual(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH - 1), ["timeline"]);
	layout.dispose();
}

function testShellLayoutWideWidth() {
	initTheme("dark", false);
	const layout = createShellLayoutRenderFixture(["timeline"], ["sidebar"]);
	const width = SIDEBAR_MIN_TERMINAL_WIDTH;
	const [line] = layout.render(width);

	assert.equal(visibleWidth(line), width);
	assert.ok(line.includes(theme.getFgAnsi("sidebarBorder")));
	assert.ok(line.includes(theme.getBgAnsi("sidebarBg")));
	assert.ok(line.includes(`${theme.getFgAnsi("sidebarText")}sidebar`));
	assert.equal(line.slice(0, "timeline".length), "timeline");
	layout.dispose();
}

function testShellLayoutUsesTallerSide() {
	initTheme("dark", false);
	const layout = createShellLayoutRenderFixture(["timeline"], ["one", "two"]);
	const lines = layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

	assert.equal(lines.length, 2);
	assert.equal(visibleWidth(lines[1]), SIDEBAR_MIN_TERMINAL_WIDTH);
	assert.ok(lines[1].includes(theme.getFgAnsi("sidebarBorder")));
	assert.ok(lines[1].includes(theme.getBgAnsi("sidebarBg")));
	assert.ok(lines[1].includes(`${theme.getFgAnsi("sidebarText")}two`));
	layout.dispose();
}

function testShellLayoutBuildsStaticRegions() {
	const editor = staticComponent(["editor"]);
	const replacement = staticComponent(["replacement"]);
	const layout = createShellLayoutForTest({ editor });

	try {
		layout.attachRoot();
		layout.sidebar.addChild(staticComponent(["sidebar"]));

		assert.equal(layout.ui.children[0], layout);
		assert.equal(layout.ui.children[1], layout.footer);
		assert.deepEqual(layout.timeline.children, [
			layout.chat,
			layout.pendingMessages,
			layout.status,
			layout.widgetsAbove,
			layout.editorHost,
			layout.widgetsBelow,
		]);
		assert.deepEqual(layout.editorHost.children, [editor]);
		assert.deepEqual(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH - 1), ["editor"]);

		layout.setEditorHost(replacement);
		assert.deepEqual(layout.editorHost.children, [replacement]);
		layout.restoreEditorHost(editor);
		assert.deepEqual(layout.editorHost.children, [editor]);
	} finally {
		layout.dispose();
	}
}

function testCliStateQueue() {
	const state = createCliState({
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		autoCompactEnabled: true,
	});
	try {
		state.queue.queueCompactionMessage({ text: "interrupt after compact", mode: "steer" });
		state.queue.queueCompactionMessage({ text: "follow after compact", mode: "followUp" });

		assert.deepEqual(
			state.queue.getAllQueuedMessages({
				steering: ["interrupt now"],
				followUp: ["follow now"],
			}),
			{
				steering: ["interrupt now", "interrupt after compact"],
				followUp: ["follow now", "follow after compact"],
			},
		);

		const taken = state.queue.takeCompactionQueue();
		assert.deepEqual(taken, [
			{ text: "interrupt after compact", mode: "steer" },
			{ text: "follow after compact", mode: "followUp" },
		]);
		assert.deepEqual(state.queue.getAllQueuedMessages({ steering: [], followUp: [] }), {
			steering: [],
			followUp: [],
		});

		state.queue.restoreCompactionQueue(taken);
		assert.deepEqual(state.queue.clearAllQueues({ steering: [], followUp: [] }), {
			steering: ["interrupt after compact"],
			followUp: ["follow after compact"],
		});
	} finally {
		state.dispose();
	}
}

function testCliStateShellAndFooter() {
	const state = createCliState({
		hideThinkingBlock: true,
		hiddenThinkingLabel: "Thinking...",
		autoCompactEnabled: false,
	});
	try {
		assert.equal(state.shell.$hideThinkingBlock.getState(), true);
		state.shell.setToolsExpanded(true);
		assert.equal(state.shell.$toolOutputExpanded.getState(), true);
		state.shell.setHiddenThinkingLabel("Reasoning hidden");
		assert.equal(state.shell.$hiddenThinkingLabel.getState(), "Reasoning hidden");
		state.shell.setWorkingMessage("Syncing");
		state.shell.setWorkingVisible(false);
		assert.deepEqual(state.shell.$working.getState(), {
			visible: false,
			message: "Syncing",
			indicator: undefined,
		});

		state.footer.setExtensionStatus({ key: "calendar", text: "syncing" });
		state.footer.setAvailableProviderCount(2);
		state.footer.setAutoCompactEnabled(true);
		const footer = state.footer.$snapshot.getState();
		assert.equal(footer.extensionStatuses.get("calendar"), "syncing");
		assert.equal(footer.availableProviderCount, 2);
		assert.equal(footer.autoCompactEnabled, true);
	} finally {
		state.dispose();
	}
}

await testNoToolsByDefault();
await testExtensionToolsActiveByDefault();
await testNoToolsDisablesExtensionTools();
await testToolAllowlist();
await testExtensionModuleCanImportTeyol();
await testLocalOllamaCompactionWithoutApiKey();
await testBuiltInCommandDispatch();
await testInteractiveAutocompleteContracts();
testHotkeyHelpContracts();
testDisplayHelperContracts();
testSystemPrompt();
testCliHelp();
testUnknownFlagDiagnostics();
testUiDescriptorContracts();
testTimelineBlockBaseContract();
testTimelineBlockRendering();
testTimelineStartupBlocks();
testUserMessageBlock();
testTimelineUserMessageBlocks();
testTimelineSkillBlockTrailingUserMessage();
testShellLayoutNarrowWidth();
testShellLayoutWideWidth();
testShellLayoutUsesTallerSide();
testShellLayoutBuildsStaticRegions();
testCliStateQueue();
testCliStateShellAndFooter();

console.log("smoke ok");
