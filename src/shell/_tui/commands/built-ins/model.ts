import type { AgentSession } from "#shell/runtime/agent-session.js";
import { findExactModelReferenceMatch, resolveModelScope } from "#shell/runtime/model-resolver.js";
import type { Model } from "#ai/index.js";
import { type AutocompleteItem, type Component, fuzzyFilter, Spacer, Text, type TUI } from "#tui/index.js";
import { theme } from "../../../theme/theme.js";
import type { ShellLayoutComponent } from "../../layout.js";
import type { CliState } from "../../state/index.js";
import { type ModelAction, ModelActionsSelectorComponent } from "../components/model-actions-selector.js";
import { ModelSelectorComponent } from "../components/model-selector.js";
import { ScopedModelsSelectorComponent } from "../components/scoped-models-selector.js";
import type { TuiCommand } from "../types.js";

const modelActions: Array<{ value: ModelAction; description: string }> = [
	{ value: "select", description: "Choose the active model" },
	{ value: "fast-cycle", description: "Configure models for Ctrl+P cycling" },
];

export interface ModelCommandDependencies {
	session: AgentSession;
	ui: TUI;
	layout: ShellLayoutComponent;
	footer: ShellLayoutComponent["footer"];
	footerDataProvider: ShellLayoutComponent["footerDataProvider"];
	state: CliState;
	chatContainer: Component & { addChild(child: Component): void };
	getEditor(): Component;
	updateEditorBorderColor(): void;
}

function showStatus({ chatContainer, ui }: Pick<ModelCommandDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
	ui.requestRender();
}

function showError({ chatContainer, ui }: Pick<ModelCommandDependencies, "chatContainer" | "ui">, message: string): void {
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
	ui.requestRender();
}

async function getModelCandidates(session: AgentSession): Promise<Model<any>[]> {
	if (session.scopedModels.length > 0) {
		return session.scopedModels.map((scoped) => scoped.model);
	}

	session.modelRegistry.refresh();
	try {
		await session.modelRegistry.refreshDynamic();
		return await session.modelRegistry.getAvailable();
	} catch {
		return [];
	}
}

export async function updateAvailableProviderCount(dependencies: Pick<ModelCommandDependencies, "session" | "state" | "footerDataProvider">): Promise<void> {
	const models = await getModelCandidates(dependencies.session);
	const uniqueProviders = new Set(models.map((m) => m.provider));
	dependencies.state.footer.setAvailableProviderCount(uniqueProviders.size);
	dependencies.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
}

export function getModelArgumentCompletions(
	session: AgentSession,
	prefix: string,
	valuePrefix = "",
): AutocompleteItem[] | null {
	const models =
		session.scopedModels.length > 0 ? session.scopedModels.map((s) => s.model) : session.modelRegistry.getAvailable();

	if (models.length === 0) return null;

	const items = models.map((m) => ({
		id: m.id,
		provider: m.provider,
		label: `${m.provider}/${m.id}`,
	}));
	const filtered = fuzzyFilter(items, prefix, (item) => `${item.id} ${item.provider}`);

	if (filtered.length === 0) return null;

	return filtered.map((item) => ({
		value: `${valuePrefix}${item.label}`,
		label: item.id,
		description: item.provider,
	}));
}

export function showModelSelector(dependencies: ModelCommandDependencies, initialSearchInput?: string): void {
	const { layout, footer, session, ui, updateEditorBorderColor } = dependencies;
	const done = () => layout.restoreEditorHost(dependencies.getEditor());
	const selector = new ModelSelectorComponent(
		ui,
		session.model,
		session.settingsManager,
		session.modelRegistry,
		session.scopedModels,
		async (model) => {
			try {
				await session.setModel(model);
				footer.invalidate();
				updateEditorBorderColor();
				done();
				showStatus(dependencies, `Model: ${model.id}`);
			} catch (error) {
				done();
				showError(dependencies, error instanceof Error ? error.message : String(error));
			}
		},
		() => {
			done();
			ui.requestRender();
		},
		initialSearchInput,
	);
	layout.setEditorHost(selector, selector);
}

async function handleModelSelectCommand(
	dependencies: ModelCommandDependencies,
	searchTerm?: string,
): Promise<void> {
	const { footer, session, updateEditorBorderColor } = dependencies;
	if (!searchTerm) {
		showModelSelector(dependencies);
		return;
	}

	const models = await getModelCandidates(session);
	const model = findExactModelReferenceMatch(searchTerm, models);
	if (model) {
		try {
			await session.setModel(model);
			footer.invalidate();
			updateEditorBorderColor();
			showStatus(dependencies, `Model: ${model.id}`);
		} catch (error) {
			showError(dependencies, error instanceof Error ? error.message : String(error));
		}
		return;
	}

	showModelSelector(dependencies, searchTerm);
}

function showModelActionsSelector(dependencies: ModelCommandDependencies): void {
	const { layout, ui } = dependencies;
	const done = () => layout.restoreEditorHost(dependencies.getEditor());
	const selector = new ModelActionsSelectorComponent(
		(action) => {
			done();
			switch (action) {
				case "select":
					showModelSelector(dependencies);
					return;
				case "fast-cycle":
					void showScopedModelsSelector(dependencies);
					return;
			}
		},
		() => {
			done();
			ui.requestRender();
		},
	);
	layout.setEditorHost(selector, selector.getSelectList());
}

export async function showScopedModelsSelector(dependencies: ModelCommandDependencies): Promise<void> {
	const { layout, session, ui } = dependencies;
	session.modelRegistry.refresh();
	await session.modelRegistry.refreshDynamic();
	const allModels = session.modelRegistry.getAvailable();

	if (allModels.length === 0) {
		showStatus(dependencies, "No models available");
		return;
	}

	const sessionScopedModels = session.scopedModels;
	const hasSessionScope = sessionScopedModels.length > 0;

	let currentEnabledIds: string[] | null = null;

	if (hasSessionScope) {
		currentEnabledIds = sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
	} else {
		const patterns = session.settingsManager.getEnabledModels();
		if (patterns !== undefined && patterns.length > 0) {
			const scopedModels = await resolveModelScope(patterns, session.modelRegistry);
			currentEnabledIds = scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
		}
	}

	const updateSessionModels = async (enabledIds: string[] | null) => {
		currentEnabledIds = enabledIds === null ? null : [...enabledIds];
		if (enabledIds && enabledIds.length > 0 && enabledIds.length < allModels.length) {
			const newScopedModels = await resolveModelScope(enabledIds, session.modelRegistry);
			session.setScopedModels(
				newScopedModels.map((sm) => ({
					model: sm.model,
					thinkingLevel: sm.thinkingLevel,
				})),
			);
		} else {
			session.setScopedModels([]);
		}
		await updateAvailableProviderCount(dependencies);
		ui.requestRender();
	};

	const done = () => layout.restoreEditorHost(dependencies.getEditor());
	const selector = new ScopedModelsSelectorComponent(
		{
			allModels,
			enabledModelIds: currentEnabledIds,
		},
		{
			onChange: async (enabledIds) => {
				await updateSessionModels(enabledIds);
			},
			onPersist: (enabledIds) => {
				const newPatterns = enabledIds === null || enabledIds.length === allModels.length ? undefined : enabledIds;
				session.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
				showStatus(dependencies, "Model selection saved to settings");
			},
			onCancel: () => {
				done();
				ui.requestRender();
			},
		},
	);
	layout.setEditorHost(selector, selector);
}

export const modelCommand: TuiCommand<ModelCommandDependencies> = {
	name: "model",
	description: "Manage model selection and fast-cycle models",
	complete({ session }, invocation): AutocompleteItem[] | null {
		const normalizedPrefix = invocation.args.trimStart();
		const lowerPrefix = normalizedPrefix.toLowerCase();

		if (lowerPrefix.startsWith("select ")) {
			return getModelArgumentCompletions(session, normalizedPrefix.slice("select ".length), "select ");
		}

		const actionCompletions = modelActions
			.filter((action) => action.value.startsWith(lowerPrefix))
			.map((action) => ({
				value: action.value,
				label: action.value,
				description: action.description,
			}));
		const modelCompletions = getModelArgumentCompletions(session, normalizedPrefix) ?? [];
		const completions = [...actionCompletions, ...modelCompletions];
		return completions.length > 0 ? completions : null;
	},
	async execute(dependencies, invocation) {
		const argumentText = invocation.args.trim() || undefined;

		if (!argumentText) {
			showModelActionsSelector(dependencies);
			return;
		}

		const [action, ...rest] = argumentText.split(/\s+/);
		const actionArgument = rest.join(" ").trim();

		if (action === "select") {
			await handleModelSelectCommand(dependencies, actionArgument || undefined);
			return;
		}

		if (action === "fast-cycle") {
			await showScopedModelsSelector(dependencies);
			return;
		}

		await handleModelSelectCommand(dependencies, argumentText);
	},
};
