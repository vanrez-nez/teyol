export interface AgentLogger {
	debug(event: string, data?: unknown): void;
	info(event: string, data?: unknown): void;
	error(event: string, data?: unknown): void;
}

const noopLogger: AgentLogger = {
	debug() {},
	info() {},
	error() {},
};

let currentLogger: AgentLogger = noopLogger;

export function setAgentLogger(logger: AgentLogger): void {
	currentLogger = logger;
}

export function getAgentLogger(): AgentLogger {
	return currentLogger;
}
