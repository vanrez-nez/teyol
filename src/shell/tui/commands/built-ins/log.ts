import fs from "node:fs";
import { logger, type LogLevel, type LogMode } from "#logger";
import type { AgentSession } from "#shell/runtime/agent-session.js";
import { type AutocompleteItem, type Component, type Container, Spacer, Text, type TUI } from "#tui/index.js";
import { isDevMode } from "../../../../config.js";
import { theme } from "../../../theme/theme.js";
import { LogActionsSelectorComponent, type LogAction } from "../components/log-action-selector.js";
import { LogLevelsSelectorComponent } from "../components/log-levels-selector.js";
import { LogModeSelectorComponent } from "../components/log-mode-selector.js";
import { formatLogFileDisplay } from "../../display-helpers.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { TuiCommand } from "../types.js";

const logActions: Array<{ value: LogAction; description: string }> = [
	{ value: "view", description: "Show the current log file path and tail" },
	{ value: "enable", description: "Start writing log entries" },
	{ value: "disable", description: "Stop writing log entries" },
	{ value: "mode", description: "Choose between app and session log files" },
	{ value: "rotation_lines", description: "Set rotation line threshold (0 disables)" },
	{ value: "level", description: "Choose which severity levels are written" },
];

interface LogDependencies {
	session: AgentSession;
	chatContainer: Container;
	ui: TUI;
	layout: ShellLayoutComponent;
	getEditor(): Component;
}

async function reloadLoggerSettings(session: AgentSession): Promise<void> {
	await session.settingsManager.flush();
	logger.reloadConfig();
}

function showInfo({ chatContainer, ui }: Pick<LogDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(`${theme.fg("accent", "✓")} ${message}`, 1, 1));
	ui.requestRender();
}

export function printLogFile({ chatContainer, ui }: Pick<LogDependencies, "chatContainer" | "ui">): void {
	const logPath = logger.getFilePath();
	const exists = fs.existsSync(logPath);
	const tail = exists ? logger.readTail(40) : "";
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(formatLogFileDisplay(logPath, exists, tail), 1, 1));
	ui.requestRender();
}

async function applyLogMode(dependencies: LogDependencies, mode: LogMode): Promise<void> {
	dependencies.session.settingsManager.setLogMode(mode);
	await reloadLoggerSettings(dependencies.session);
	logger.info("log.mode", { mode });
	showInfo(dependencies, `Log mode set to ${mode}. File: ${logger.getFilePath()}`);
}

async function applyLogRotationLines(dependencies: LogDependencies, arg: string): Promise<void> {
	const parsed = Number.parseInt(arg, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		dependencies.chatContainer.addChild(new Spacer(1));
		dependencies.chatContainer.addChild(new Text(theme.fg("warning", `Warning: Invalid rotation_lines value: ${arg}. Must be an integer >= 0.`), 1, 0));
		dependencies.ui.requestRender();
		return;
	}
	dependencies.session.settingsManager.setLogRotationLines(parsed);
	await reloadLoggerSettings(dependencies.session);
	logger.info("log.rotation_lines", {
		rotation_lines: dependencies.session.settingsManager.getLogRotationLines(),
	});
	showInfo(
		dependencies,
		parsed === 0
			? "Log rotation disabled (rotation_lines=0)."
			: `Log rotation set to ${dependencies.session.settingsManager.getLogRotationLines()} lines.`,
	);
}

function showLogModeSelector(dependencies: LogDependencies): void {
	const { layout, getEditor, session, ui } = dependencies;
	const done = () => layout.restoreEditorHost(getEditor());
	const selector = new LogModeSelectorComponent(
		session.settingsManager.getLogMode(),
		(mode) => {
			done();
			void applyLogMode(dependencies, mode);
		},
		() => {
			done();
			ui.requestRender();
		},
	);
	layout.setEditorHost(selector, selector.getSelectList());
}

function showLogLevelsSelector(dependencies: LogDependencies): void {
	const { layout, getEditor, session, ui } = dependencies;
	const done = () => layout.restoreEditorHost(getEditor());
	const selector = new LogLevelsSelectorComponent(
		session.settingsManager.getLogLevels(),
		(levels: LogLevel[]) => {
			session.settingsManager.setLogLevels(levels);
			void reloadLoggerSettings(session).then(() => {
				logger.info("log.level", { level: levels });
				done();
				showInfo(dependencies, `Log levels set to: ${session.settingsManager.getLogLevels().join(", ") || "(none)"}`);
			});
		},
		() => {
			done();
			ui.requestRender();
		},
		(levels: LogLevel[]) => {
			session.settingsManager.setLogLevels(levels);
			void reloadLoggerSettings(session);
			ui.requestRender();
		},
	);
	layout.setEditorHost(selector, selector.getList());
}

async function handleLogAction(dependencies: LogDependencies, action: LogAction): Promise<void> {
	const { session } = dependencies;
	switch (action) {
		case "view":
			printLogFile(dependencies);
			return;
		case "enable":
			session.settingsManager.setLogEnabled(true);
			await reloadLoggerSettings(session);
			logger.info("log.enabled");
			showInfo(dependencies, `Logging enabled. File: ${logger.getFilePath()}`);
			return;
		case "disable":
			logger.info("log.disabled");
			session.settingsManager.setLogEnabled(false);
			await reloadLoggerSettings(session);
			showInfo(dependencies, "Logging disabled.");
			return;
		case "mode":
			showLogModeSelector(dependencies);
			return;
		case "rotation_lines":
			showInfo(
				dependencies,
				`Current rotation_lines: ${session.settingsManager.getLogRotationLines()}. ` +
					"Use '/log rotation_lines <number>' to change (0 disables).",
			);
			return;
		case "level":
			showLogLevelsSelector(dependencies);
			return;
	}
}

function showLogActionsSelector(dependencies: LogDependencies): void {
	const { layout, getEditor, session, ui } = dependencies;
	const done = () => layout.restoreEditorHost(getEditor());
	const selector = new LogActionsSelectorComponent(
		session.settingsManager.getLogEnabled(),
		(action) => {
			done();
			void handleLogAction(dependencies, action);
		},
		() => {
			done();
			ui.requestRender();
		},
	);
	layout.setEditorHost(selector, selector.getSelectList());
}

export const logCommand: TuiCommand<LogDependencies> = {
	name: "log",
	description: "Configure logging",
	isVisible() {
		return isDevMode();
	},
	complete(_dependencies, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart().toLowerCase();
		const filtered = logActions.filter((action) => action.value.startsWith(normalizedPrefix));
		if (filtered.length === 0) return null;
		return filtered.map((action) => ({
			value: action.value,
			label: action.value,
			description: action.description,
		}));
	},
	async execute(dependencies, invocation) {
		const argumentText = invocation.args.trim() || undefined;
		if (!argumentText) {
			showLogActionsSelector(dependencies);
			return;
		}
		const [action, ...rest] = argumentText.split(/\s+/);
		const actionArgument = rest.join(" ").trim();

		switch (action) {
			case "view":
				printLogFile(dependencies);
				return;
			case "enable":
				dependencies.session.settingsManager.setLogEnabled(true);
				await reloadLoggerSettings(dependencies.session);
				logger.info("log.enabled");
				showInfo(dependencies, `Logging enabled. File: ${logger.getFilePath()}`);
				return;
			case "disable":
				logger.info("log.disabled");
				dependencies.session.settingsManager.setLogEnabled(false);
				await reloadLoggerSettings(dependencies.session);
				showInfo(dependencies, "Logging disabled.");
				return;
			case "mode":
				if (actionArgument === "app" || actionArgument === "session") {
					await applyLogMode(dependencies, actionArgument);
				} else {
					showLogModeSelector(dependencies);
				}
				return;
			case "rotation_lines":
			case "rotation-lines":
				if (actionArgument.length > 0) {
					await applyLogRotationLines(dependencies, actionArgument);
				} else {
					showInfo(
						dependencies,
						`Current rotation_lines: ${dependencies.session.settingsManager.getLogRotationLines()}. ` +
							"Usage: /log rotation_lines <number> (0 disables rotation)",
					);
				}
				return;
			case "level":
			case "levels":
				showLogLevelsSelector(dependencies);
				return;
			default:
				dependencies.chatContainer.addChild(new Spacer(1));
				dependencies.chatContainer.addChild(
					new Text(
						theme.fg("warning", `Warning: Unknown /log subcommand: ${action}. Try: view | enable | disable | mode | rotation_lines | level`),
						1,
						0,
					),
				);
				dependencies.ui.requestRender();
				return;
		}
	},
};
