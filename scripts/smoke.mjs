import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "../dist/ai/index.js";
import { createAgentSession } from "../dist/session/sdk.js";
import { AuthStorage } from "../dist/session/auth-storage.js";
import { ModelRegistry } from "../dist/session/model-registry.js";
import { DefaultResourceLoader } from "../dist/session/resource-loader.js";
import { SessionManager } from "../dist/session/session-manager.js";
import { SettingsManager } from "../dist/session/settings-manager.js";
import { buildSystemPrompt } from "../dist/session/system-prompt.js";
import { validateUiDescriptorFixtures } from "../dist/session/ui-descriptors.fixtures.js";
import {
	ShellLayoutComponent,
	SIDEBAR_MIN_TERMINAL_WIDTH,
	SIDEBAR_SEPARATOR,
	SIDEBAR_WIDTH,
} from "../dist/cli/interactive/components/shell-layout.js";
import { initTheme, theme } from "../dist/cli/interactive/theme/theme.js";
import { visibleWidth } from "../dist/tui/index.js";

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

function staticComponent(lines) {
	return {
		invalidate() {},
		render() {
			return lines;
		},
	};
}

function testShellLayoutNarrowWidth() {
	initTheme("dark", false);
	const layout = new ShellLayoutComponent(staticComponent(["timeline"]), staticComponent(["sidebar"]));
	assert.deepEqual(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH - 1), ["timeline"]);
}

function testShellLayoutWideWidth() {
	initTheme("dark", false);
	const layout = new ShellLayoutComponent(staticComponent(["timeline"]), staticComponent(["sidebar"]));
	const width = SIDEBAR_MIN_TERMINAL_WIDTH;
	const [line] = layout.render(width);

	assert.equal(visibleWidth(line), width);
	assert.ok(line.includes(theme.getFgAnsi("sidebarBorder")));
	assert.ok(line.includes(theme.getBgAnsi("sidebarBg")));
	assert.ok(line.includes(`${theme.getFgAnsi("sidebarText")}sidebar`));
	assert.equal(line.slice(0, "timeline".length), "timeline");
}

function testShellLayoutUsesTallerSide() {
	initTheme("dark", false);
	const layout = new ShellLayoutComponent(staticComponent(["timeline"]), staticComponent(["one", "two"]));
	const lines = layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

	assert.equal(lines.length, 2);
	assert.equal(visibleWidth(lines[1]), SIDEBAR_MIN_TERMINAL_WIDTH);
	assert.ok(lines[1].includes(theme.getFgAnsi("sidebarBorder")));
	assert.ok(lines[1].includes(theme.getBgAnsi("sidebarBg")));
	assert.ok(lines[1].includes(`${theme.getFgAnsi("sidebarText")}two`));
}

await testNoToolsByDefault();
await testExtensionToolsActiveByDefault();
await testNoToolsDisablesExtensionTools();
await testToolAllowlist();
testSystemPrompt();
testCliHelp();
testUnknownFlagDiagnostics();
testUiDescriptorContracts();
testShellLayoutNarrowWidth();
testShellLayoutWideWidth();
testShellLayoutUsesTallerSide();

console.log("smoke ok");
