export interface AiLogger {
	debug(event: string, data?: unknown): void;
	error(event: string, data?: unknown): void;
}

const noopLogger: AiLogger = {
	debug() {},
	error() {},
};

let currentLogger: AiLogger = noopLogger;

export function setAiLogger(logger: AiLogger): void {
	currentLogger = logger;
}

export function getAiLogger(): AiLogger {
	return currentLogger;
}
