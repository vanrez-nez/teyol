import {
	getProviderMetadata,
	getProviders,
	getSelfHostedProviderDefaultBaseUrl,
	type Model,
	type OAuthProviderId,
} from "#ai/index.js";
import type { AgentSession } from "#shell/runtime/agent-session.js";
import { defaultModelPerProvider } from "#shell/runtime/model-resolver.js";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "#shell/runtime/provider-display-names.js";
import { type Component, type Container, Spacer, Text, type TUI } from "#tui/index.js";
import { getAuthPath } from "../../../../config.js";
import { theme } from "../../../theme/theme.js";
import { ExtensionSelectorComponent } from "../../components/extension-selector.js";
import { LoginDialogComponent } from "../../components/commands/login-dialog.js";
import { type AuthSelectorProvider, OAuthSelectorComponent } from "../../components/commands/oauth-selector.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { CliState } from "../../state/index.js";
import { updateAvailableProviderCount } from "./model.js";

const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

export interface AuthCommandDependencies {
	session: AgentSession;
	ui: TUI;
	layout: ShellLayoutComponent;
	footer: ShellLayoutComponent["footer"];
	footerDataProvider: ShellLayoutComponent["footerDataProvider"];
	state: CliState;
	chatContainer: Container;
	getEditor(): Component;
	updateEditorBorderColor(): void;
}

export function showLoginAuthTypeSelector(dependencies: AuthCommandDependencies): void {
	const subscriptionLabel = "Use a subscription";
	const apiKeyLabel = "Use an API key";
	const selfHostedLabel = "Use a self-hosted provider";
	showSelector(dependencies, (done) => {
		const selector = new ExtensionSelectorComponent(
			"Select authentication method:",
			[subscriptionLabel, apiKeyLabel, selfHostedLabel],
			(option) => {
				done();
				const authType = option === subscriptionLabel ? "oauth" : option === apiKeyLabel ? "api_key" : "self_hosted";
				showLoginProviderSelector(dependencies, authType);
			},
			() => {
				done();
				dependencies.ui.requestRender();
			},
		);
		return { component: selector, focus: selector };
	});
}

export function showLogoutProviderSelector(dependencies: AuthCommandDependencies): void {
	const providerOptions = getLogoutProviderOptions(dependencies);
	if (providerOptions.length === 0) {
		showStatus(
			dependencies,
			"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
		);
		return;
	}

	showSelector(dependencies, (done) => {
		const selector = new OAuthSelectorComponent(
			"logout",
			dependencies.session.modelRegistry.authStorage,
			providerOptions,
			async (providerId: string) => {
				done();

				const providerOption = providerOptions.find((provider) => provider.id === providerId);
				if (!providerOption) {
					return;
				}

				try {
					dependencies.session.modelRegistry.authStorage.logout(providerOption.id);
					dependencies.session.modelRegistry.refresh();
					await dependencies.session.modelRegistry.refreshDynamic();
					await dependencies.session.revalidateSelectedModel();
					await updateAvailableProviderCount(dependencies);
					const message =
						providerOption.authType === "oauth"
							? `Logged out of ${providerOption.name}`
							: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
					dependencies.footer.invalidate();
					dependencies.updateEditorBorderColor();
					showStatus(dependencies, message);
				} catch (error: unknown) {
					showError(dependencies, `Logout failed: ${error instanceof Error ? error.message : String(error)}`);
				}
			},
			() => {
				done();
				dependencies.ui.requestRender();
			},
		);
		return { component: selector, focus: selector };
	});
}

function showLoginProviderSelector(
	dependencies: AuthCommandDependencies,
	authType: "oauth" | "api_key" | "self_hosted",
): void {
	const providerOptions = getLoginProviderOptions(dependencies, authType);
	if (providerOptions.length === 0) {
		const noProvidersMessage =
			authType === "oauth"
				? "No subscription providers available."
				: authType === "api_key"
					? "No API key providers available."
					: "No self-hosted providers available.";
		showStatus(dependencies, noProvidersMessage);
		return;
	}

	showSelector(dependencies, (done) => {
		const selector = new OAuthSelectorComponent(
			"login",
			dependencies.session.modelRegistry.authStorage,
			providerOptions,
			async (providerId: string) => {
				done();

				const providerOption = providerOptions.find((provider) => provider.id === providerId);
				if (!providerOption) {
					return;
				}

				if (providerOption.authType === "oauth") {
					await showLoginDialog(dependencies, providerOption.id, providerOption.name);
				} else if (providerOption.authType === "api_key") {
					await showApiKeyLoginDialog(dependencies, providerOption.id, providerOption.name);
				} else {
					await showSelfHostedProviderDialog(dependencies, providerOption.id, providerOption.name);
				}
			},
			() => {
				done();
				showLoginAuthTypeSelector(dependencies);
			},
			(providerId) => dependencies.session.modelRegistry.getProviderAuthStatus(providerId),
		);
		return { component: selector, focus: selector };
	});
}

function getLoginProviderOptions(
	{ session }: AuthCommandDependencies,
	authType?: "oauth" | "api_key" | "self_hosted",
): AuthSelectorProvider[] {
	const authStorage = session.modelRegistry.authStorage;
	const oauthProviders = authStorage.getOAuthProviders();
	const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
	const options: AuthSelectorProvider[] = oauthProviders.map((provider) => ({
		id: provider.id,
		name: provider.name,
		authType: "oauth",
	}));

	const modelProviders = new Set(session.modelRegistry.getAll().map((model) => model.provider));
	for (const providerId of modelProviders) {
		if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) {
			continue;
		}
		options.push({
			id: providerId,
			name: session.modelRegistry.getProviderDisplayName(providerId),
			authType: "api_key",
		});
	}

	for (const providerId of getProviders()) {
		const metadata = getProviderMetadata(providerId);
		if (!metadata?.auth?.selfHosted) continue;
		if (options.some((option) => option.id === providerId && option.authType === "self_hosted")) continue;
		options.push({
			id: providerId,
			name: session.modelRegistry.getProviderDisplayName(providerId),
			authType: "self_hosted",
		});
	}

	const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
	return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));
}

function getLogoutProviderOptions({ session }: AuthCommandDependencies): AuthSelectorProvider[] {
	const authStorage = session.modelRegistry.authStorage;
	const options: AuthSelectorProvider[] = [];

	for (const providerId of authStorage.list()) {
		const credential = authStorage.get(providerId);
		if (!credential) {
			continue;
		}
		options.push({
			id: providerId,
			name: session.modelRegistry.getProviderDisplayName(providerId),
			authType: credential.type,
		});
	}

	return options.sort((a, b) => a.name.localeCompare(b.name));
}

async function completeProviderAuthentication(
	dependencies: AuthCommandDependencies,
	providerId: string,
	providerName: string,
	authType: "oauth" | "api_key",
	previousModel: Model<any> | undefined,
): Promise<void> {
	const { session } = dependencies;
	session.modelRegistry.refresh();
	await session.modelRegistry.refreshDynamic();

	const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

	let selectedModel: Model<any> | undefined;
	let selectionError: string | undefined;
	if (isUnknownModel(previousModel)) {
		const availableModels = session.modelRegistry.getAvailable();
		const providerModels = availableModels.filter((model) => model.provider === providerId);
		if (!hasDefaultModelProvider(providerId)) {
			selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
		} else if (providerModels.length === 0) {
			selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
		} else {
			const defaultModelId = defaultModelPerProvider[providerId];
			selectedModel = providerModels.find((model) => model.id === defaultModelId);
			if (!selectedModel) {
				selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
			} else {
				try {
					await session.setModel(selectedModel);
				} catch (error: unknown) {
					selectedModel = undefined;
					const errorMessage = error instanceof Error ? error.message : String(error);
					selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
				}
			}
		}
	}

	await updateAvailableProviderCount(dependencies);
	dependencies.footer.invalidate();
	dependencies.updateEditorBorderColor();
	if (selectedModel) {
		showStatus(dependencies, `${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
	} else {
		showStatus(dependencies, `${actionLabel}. Credentials saved to ${getAuthPath()}`);
		if (selectionError) {
			showError(dependencies, selectionError);
		}
	}
}

async function showApiKeyLoginDialog(
	dependencies: AuthCommandDependencies,
	providerId: string,
	providerName: string,
): Promise<void> {
	const previousModel = dependencies.session.model;
	const dialog = new LoginDialogComponent(
		dependencies.ui,
		providerId,
		(_success, _message) => {
			// Completion handled below.
		},
		providerName,
	);

	dependencies.layout.setEditorHost(dialog);

	try {
		const apiKey = (await dialog.showPrompt("Enter API key:")).trim();
		if (!apiKey) {
			throw new Error("API key cannot be empty.");
		}

		dependencies.session.modelRegistry.authStorage.set(providerId, { type: "api_key", key: apiKey });
		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		await completeProviderAuthentication(dependencies, providerId, providerName, "api_key", previousModel);
	} catch (error: unknown) {
		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled") {
			showError(dependencies, `Failed to save API key for ${providerName}: ${errorMsg}`);
		}
	}
}

async function showSelfHostedProviderDialog(
	dependencies: AuthCommandDependencies,
	providerId: string,
	providerName: string,
): Promise<void> {
	const previousModel = dependencies.session.model;
	const defaultBaseUrl =
		process.env[`${providerId.toUpperCase()}_HOST`]?.trim() ||
		getSelfHostedProviderDefaultBaseUrl(providerId) ||
		"http://localhost:11434";

	const dialog = new LoginDialogComponent(
		dependencies.ui,
		providerId,
		(_success, _message) => {
			// Completion handled below.
		},
		providerName,
		`Configure self-hosted ${providerName}`,
	);

	dependencies.layout.setEditorHost(dialog);

	try {
		const enteredBaseUrl = (await dialog.showPrompt("Enter base URL:", defaultBaseUrl)).trim();
		const baseUrl = enteredBaseUrl || defaultBaseUrl;

		dependencies.session.modelRegistry.configureProviderBaseUrl(providerId, baseUrl);
		await dependencies.session.modelRegistry.refreshDynamic();

		const providerModels = dependencies.session.modelRegistry.getAvailable().filter((model) => model.provider === providerId);
		if (providerModels.length === 0) {
			const loadError = dependencies.session.modelRegistry.getError();
			throw new Error(loadError || `No models discovered for ${providerName}.`);
		}

		let selectedModel: Model<any> | undefined;
		if (isUnknownModel(previousModel)) {
			selectedModel = providerModels[0];
			await dependencies.session.setModel(selectedModel);
		}

		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		await updateAvailableProviderCount(dependencies);
		dependencies.footer.invalidate();
		dependencies.updateEditorBorderColor();
		showStatus(
			dependencies,
			selectedModel
				? `Configured self-hosted ${providerName}. Selected ${selectedModel.id}.`
				: `Configured self-hosted ${providerName}.`,
		);
	} catch (error: unknown) {
		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled") {
			showError(dependencies, `Failed to configure self-hosted ${providerName}: ${errorMsg}`);
		}
	}
}

async function showLoginDialog(
	dependencies: AuthCommandDependencies,
	providerId: string,
	providerName: string,
): Promise<void> {
	const providerInfo = dependencies.session.modelRegistry.authStorage
		.getOAuthProviders()
		.find((provider) => provider.id === providerId);
	const previousModel = dependencies.session.model;
	const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;
	const dialog = new LoginDialogComponent(
		dependencies.ui,
		providerId,
		(_success, _message) => {
			// Completion handled below.
		},
		providerName,
	);

	dependencies.layout.setEditorHost(dialog);

	let manualCodeResolve: ((code: string) => void) | undefined;
	let manualCodeReject: ((err: Error) => void) | undefined;
	const manualCodePromise = new Promise<string>((resolve, reject) => {
		manualCodeResolve = resolve;
		manualCodeReject = reject;
	});

	try {
		await dependencies.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
			onAuth: (info: { url: string; instructions?: string }) => {
				dialog.showAuth(info.url, info.instructions);

				if (usesCallbackServer) {
					dialog
						.showManualInput("Paste redirect URL below, or complete login in browser:")
						.then((value) => {
							if (value && manualCodeResolve) {
								manualCodeResolve(value);
								manualCodeResolve = undefined;
							}
						})
						.catch(() => {
							if (manualCodeReject) {
								manualCodeReject(new Error("Login cancelled"));
								manualCodeReject = undefined;
							}
						});
				}
			},

			onPrompt: async (prompt: { message: string; placeholder?: string }) => {
				return dialog.showPrompt(prompt.message, prompt.placeholder);
			},

			onProgress: (message: string) => {
				dialog.showProgress(message);
			},

			onManualCodeInput: () => manualCodePromise,

			signal: dialog.signal,
		});

		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		await completeProviderAuthentication(dependencies, providerId, providerName, "oauth", previousModel);
	} catch (error: unknown) {
		dependencies.layout.restoreEditorHost(dependencies.getEditor());
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled") {
			showError(dependencies, `Failed to login to ${providerName}: ${errorMsg}`);
		}
	}
}

function showSelector(
	dependencies: AuthCommandDependencies,
	create: (done: () => void) => { component: Component; focus: Component },
): void {
	const done = () => {
		dependencies.layout.restoreEditorHost(dependencies.getEditor());
	};
	const { component, focus } = create(done);
	dependencies.layout.setEditorHost(component, focus);
}

function isUnknownModel(model: Model<any> | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}

function isApiKeyLoginProvider(
	providerId: string,
	oauthProviderIds: ReadonlySet<string>,
	builtInProviderIds: ReadonlySet<string> = BUILT_IN_MODEL_PROVIDERS,
): boolean {
	if (BUILT_IN_PROVIDER_DISPLAY_NAMES[providerId]) {
		return true;
	}
	if (builtInProviderIds.has(providerId)) {
		return false;
	}
	return !oauthProviderIds.has(providerId);
}

function showStatus({ chatContainer, ui }: AuthCommandDependencies, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("success", `✓ ${message}`), 1, 0));
	ui.requestRender();
}

function showError({ chatContainer, ui }: AuthCommandDependencies, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
	ui.requestRender();
}
