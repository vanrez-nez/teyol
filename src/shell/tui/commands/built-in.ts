export interface BuiltInCommandHandlers {
	settings(): void;
	scopedModels(): Promise<void>;
	model(text: string): Promise<void>;
	name(text: string): void;
	session(text: string): Promise<void>;
	hotkeys(): void;
	login(): void;
	logout(): void;
	reload(): Promise<void>;
	log(text: string): Promise<void>;
	exit(): Promise<void>;
}

export async function dispatchBuiltInCommand(text: string, handlers: BuiltInCommandHandlers): Promise<boolean> {
	if (text === "/settings") {
		handlers.settings();
		return true;
	}
	if (text === "/scoped-models") {
		await handlers.scopedModels();
		return true;
	}
	if (text === "/model" || text.startsWith("/model ")) {
		await handlers.model(text);
		return true;
	}
	if (text === "/name" || text.startsWith("/name ")) {
		handlers.name(text);
		return true;
	}
	if (text === "/session" || text.startsWith("/session ")) {
		await handlers.session(text);
		return true;
	}
	if (text === "/hotkeys") {
		handlers.hotkeys();
		return true;
	}
	if (text === "/login") {
		handlers.login();
		return true;
	}
	if (text === "/logout") {
		handlers.logout();
		return true;
	}
	if (text === "/reload") {
		await handlers.reload();
		return true;
	}
	if (text === "/log" || text.startsWith("/log ")) {
		await handlers.log(text);
		return true;
	}
	if (text === "/exit" || text === "/quit") {
		await handlers.exit();
		return true;
	}

	return false;
}
