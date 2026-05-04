import type { AgentSession } from "#shell/runtime/agent-session.js";
import { type Container, Spacer, Text, type TUI } from "#tui/index.js";
import { theme } from "../../../theme/theme.js";
import type { TuiCommand } from "../types.js";

export const nameCommand: TuiCommand<{
	session: AgentSession;
	chatContainer: Container;
	ui: TUI;
}> = {
	name: "name",
	description: "Set session display name",
	execute({ session, chatContainer, ui }, invocation) {
		const name = invocation.args.trim();
		if (!name) {
			const currentName = session.sessionManager.getSessionName();
			if (currentName) {
				chatContainer.addChild(new Spacer(1));
				chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
			} else {
				chatContainer.addChild(new Spacer(1));
				chatContainer.addChild(new Text(theme.fg("warning", "Warning: Usage: /name <name>"), 1, 0));
			}
			ui.requestRender();
			return;
		}

		session.setSessionName(name);
		chatContainer.addChild(new Spacer(1));
		chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0));
		ui.requestRender();
	},
};
