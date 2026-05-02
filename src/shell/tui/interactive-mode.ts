/**
 * Interactive mode for the AI CLI.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import type { AgentMessage } from "#agent/index.js";
import {
  type AssistantMessage,
  getProviderMetadata,
  getProviders,
  getSelfHostedProviderDefaultBaseUrl,
  type ImageContent,
  type Model,
  type OAuthProviderId,
} from "#ai/index.js";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  EditorComponent,
  KeyId,
  MarkdownTheme,
  OverlayHandle,
  OverlayOptions,
} from "#tui/index.js";
import {
  type Component,
  Container,
  fuzzyFilter,
  Loader,
  type LoaderIndicatorOptions,
  Markdown,
  matchesKey,
  Spacer,
  setKeybindings,
  Text,
  TruncatedText,
  TUI,
  visibleWidth,
} from "#tui/index.js";
import { type AgentSessionRuntime, SessionImportFileNotFoundError } from "#shell/runtime/agent-session-runtime.js";
import {
  APP_NAME,
  APP_TITLE,
  getAgentDir,
  getAuthPath,
  getDocsPath,
  getShareViewerUrl,
  isDevMode,
  VERSION,
} from "../../config.js";
import {
  configureLogger,
  getLogFilePath,
  getLogger,
  type LogLevel,
  type LogMode,
  readLogTail,
} from "#shell/runtime/logger.js";
import type {
  AutocompleteProviderFactory,
  EditorFactory,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionRunner,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
} from "#shell/runtime/extensions/index.js";
import { type AgentSessionEvent, parseSkillBlock } from "#shell/runtime/agent-session.js";
import type { ReadonlyFooterDataProvider } from "#shell/runtime/footer-data-provider.js";
import { type AppKeybinding, KeybindingsManager } from "#shell/runtime/keybindings.js";
import { createCompactionSummaryMessage } from "#shell/runtime/messages.js";
import { defaultModelPerProvider, findExactModelReferenceMatch, resolveModelScope } from "#shell/runtime/model-resolver.js";
import { DefaultPackageManager } from "#shell/runtime/package-manager.js";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "#shell/runtime/provider-display-names.js";
import type { ResourceDiagnostic } from "#shell/runtime/resource-loader.js";
import {
  formatMissingSessionCwdPrompt,
  MissingSessionCwdError,
  type SessionContext,
  SessionManager,
} from "#shell/runtime/session-manager.js";
import type { SourceInfo } from "#shell/runtime/source-info.js";
import { killTrackedDetachedChildren } from "../../utils/shell.js";
import { isInstallTelemetryEnabled } from "../../utils/telemetry.js";
import type { TruncationResult } from "../../utils/truncate.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CountdownTimer } from "./components/countdown-timer.js";
import { CustomEditor } from "./components/custom-editor.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { ExtensionEditorComponent } from "./components/extension-editor.js";
import { ExtensionInputComponent } from "./components/extension-input.js";
import { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";
import { loadAsciiLogo, LogoComponent } from "./logo.js";
import { LoginDialogComponent } from "./components/login-dialog.js";
import { type LogAction, LogActionsSelectorComponent } from "./components/log-action-selector.js";
import { LogLevelsSelectorComponent } from "./components/log-levels-selector.js";
import { LogModeSelectorComponent } from "./components/log-mode-selector.js";
import { type ModelAction, ModelActionsSelectorComponent } from "./components/model-actions-selector.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { type AuthSelectorProvider, OAuthSelectorComponent } from "./components/oauth-selector.js";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.js";
import { type SessionAction, SessionActionsSelectorComponent } from "./components/session-actions-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { SettingsSelectorComponent } from "./components/settings-selector.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { TreeSelectorComponent } from "./components/tree-selector.js";
import { UserMessageComponent } from "./components/user-message.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import { createCliState, type CliState, type QueuedMessage } from "./state/index.js";
import {
  getAvailableThemes,
  getAvailableThemesWithPaths,
  getEditorTheme,
  getMarkdownTheme,
  getThemeByName,
  initTheme,
  onThemeChange,
  setRegisteredThemes,
  setTheme,
  setThemeInstance,
  stopThemeWatcher,
  Theme,
  type ThemeColor,
  theme,
} from "../theme/theme.js";
import { dispatchBuiltInCommand } from "./commands/built-in.js";
import { buildAutocomplete, getBuiltInCommandConflictDiagnostics } from "./commands/autocomplete.js";
import type { TuiCommandContext } from "./commands/types.js";
import {
  buildScopeGroups,
  formatAppKeyDisplay,
  formatContextPath,
  formatDiagnostics,
  formatDisplayPath,
  formatExtensionDisplayPath,
  formatLogFileDisplay,
  formatScopeGroups,
  formatSessionInfo,
  getCompactExtensionLabels,
  getCompactPathLabel,
  getShortPath,
  getUserMessageText,
} from "./display-helpers.js";
import { setupBuiltInHotkeys } from "./hotkeys/built-in.js";
import { buildHotkeyHelpMarkdown } from "./hotkeys/help.js";
import { ShellComposition } from "./layout/composition.js";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
  setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
  return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

class ExpandableText extends Text implements Expandable {
  constructor(
    private readonly getCollapsedText: () => string,
    private readonly getExpandedText: () => string,
    expanded = false,
    paddingX = 0,
    paddingY = 0,
  ) {
    super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
  }

  setExpanded(expanded: boolean): void {
    this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
  }
}

function isUnknownModel(model: Model<any> | undefined): boolean {
  return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
  return providerId in defaultModelPerProvider;
}

const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

export function isApiKeyLoginProvider(
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

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning) */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored */
  modelFallbackMessage?: string;
  /** Initial message to send on startup (can include @file content) */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup (overrides quietStartup setting) */
  verbose?: boolean;
}

export class InteractiveMode {
  private runtimeHost: AgentSessionRuntime;
  private state: CliState;
  private composition: ShellComposition;
  private ui: TUI;
  private chatContainer: Container;
  private pendingMessagesContainer: Container;
  private statusContainer: Container;
  private defaultEditor: CustomEditor;
  private editor: EditorComponent;
  private editorComponentFactory: EditorFactory | undefined;
  private autocompleteProvider: AutocompleteProvider | undefined;
  private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
  private fdPath: string | undefined;
  private footer: ShellComposition["footer"];
  private footerDataProvider: ShellComposition["footerDataProvider"];
  private readonly commandContext: TuiCommandContext;
  // Stored so the same manager can be injected into custom editors, selectors, and extension UI.
  private keybindings: KeybindingsManager;
  private version: string;
  private isInitialized = false;
  private onInputCallback?: (text: string) => void;
  private loadingAnimation: Loader | undefined = undefined;
  private readonly defaultWorkingMessage = "Working...";
  private readonly defaultHiddenThinkingLabel = "Thinking...";

  private lastSigintTime = 0;
  private changelogMarkdown: string | undefined = undefined;
  private startupNoticesShown = false;

  // Status line tracking (for mutating immediately-sequential status updates)
  private lastStatusSpacer: Spacer | undefined = undefined;
  private lastStatusText: Text | undefined = undefined;

  // Streaming message tracking
  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private streamingMessage: AssistantMessage | undefined = undefined;

  // Tool execution tracking: toolCallId -> component
  private pendingTools = new Map<string, ToolExecutionComponent>();

  // Agent subscription unsubscribe function
  private unsubscribe?: () => void;
  private signalCleanupHandlers: Array<() => void> = [];

  // Shell-like input shortcuts are intentionally extension-owned in the generic CLI.

  // Track current bash execution component

  // Track pending bash components (shown in pending area, moved to chat on submit)

  // Auto-compaction state
  private autoCompactionLoader: Loader | undefined = undefined;
  private autoCompactionEscapeHandler?: () => void;

  // Auto-retry state
  private retryLoader: Loader | undefined = undefined;
  private retryCountdown: CountdownTimer | undefined = undefined;
  private retryEscapeHandler?: () => void;

  private shutdownRequested = false;

  // Extension UI state
  private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
  private extensionInput: ExtensionInputComponent | undefined = undefined;
  private extensionEditor: ExtensionEditorComponent | undefined = undefined;
  private extensionTerminalInputUnsubscribers = new Set<() => void>();

  // Extension widgets (components rendered above/below the editor)
  private extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
  private extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
  private widgetContainerAbove!: Container;
  private widgetContainerBelow!: Container;

  // Custom footer from extension (undefined = use built-in footer)
  private customFooter: (Component & { dispose?(): void }) | undefined = undefined;

  // Built-in startup content rendered into the scrollable timeline.
  private startupContent: Component | undefined = undefined;

  private get compactionQueuedMessages(): QueuedMessage[] {
    return [...this.state.queue.$compactionQueuedMessages.getState()];
  }

  private set compactionQueuedMessages(messages: QueuedMessage[]) {
    this.state.queue.restoreCompactionQueue(messages);
  }

  constructor(
    runtimeHost: AgentSessionRuntime,
    private options: InteractiveModeOptions = {},
  ) {
    this.runtimeHost = runtimeHost;
    this.state = createCliState({
      hideThinkingBlock: this.runtimeHost.session.settingsManager.getHideThinkingBlock(),
      hiddenThinkingLabel: this.defaultHiddenThinkingLabel,
      autoCompactEnabled: this.runtimeHost.session.autoCompactionEnabled,
    });
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.resetExtensionUI();
    });
    this.runtimeHost.setRebindSession(async () => {
      await this.rebindCurrentSession();
    });
    this.commandContext = {
      openSettings: () => this.showSettingsSelector(),
      openScopedModels: () => this.showModelsSelector(),
      runModelCommand: (text) => this.handleModelCommand(text),
      runNameCommand: (text) => this.handleNameCommand(text),
      runSessionCommand: (text) => this.handleSessionCommand(text),
      showHotkeys: () => this.handleHotkeysCommand(),
      openAuth: (mode) => this.showOAuthSelector(mode),
      reload: () => this.handleReloadCommand(),
      runLogCommand: (text) => this.handleLogCommand(text),
      shutdown: () => this.shutdown(),
      getModelArgumentCompletions: (prefix, valuePrefix) => this.getModelArgumentCompletions(prefix, valuePrefix),
      isDevMode: () => isDevMode(),
    };
    this.version = VERSION;
    this.composition = new ShellComposition({
      session: this.runtimeHost.session,
      cwd: this.runtimeHost.session.sessionManager.getCwd(),
      showHardwareCursor: this.runtimeHost.session.settingsManager.getShowHardwareCursor(),
      clearOnShrink: this.runtimeHost.session.settingsManager.getClearOnShrink(),
    });
    this.ui = this.composition.ui;
    this.chatContainer = this.composition.chat;
    this.pendingMessagesContainer = this.composition.pendingMessages;
    this.statusContainer = this.composition.status;
    this.widgetContainerAbove = this.composition.widgetsAbove;
    this.widgetContainerBelow = this.composition.widgetsBelow;
    this.footerDataProvider = this.composition.footerDataProvider;
    this.footer = this.composition.footer;
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    const editorPaddingX = this.runtimeHost.session.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.runtimeHost.session.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
      paddingX: editorPaddingX,
      autocompleteMaxVisible,
    });
    this.editor = this.defaultEditor;
    this.composition.restoreEditorHost(this.editor as Component);
    this.footer.setAutoCompactEnabled(this.runtimeHost.session.autoCompactionEnabled);
    this.state.footer.setAutoCompactEnabled(this.runtimeHost.session.autoCompactionEnabled);

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.runtimeHost.session.resourceLoader.getThemes().themes);
    initTheme(this.runtimeHost.session.settingsManager.getTheme(), true);
  }

  private setupAutocompleteProvider(): void {
    const result = buildAutocomplete({
      promptTemplates: this.runtimeHost.session.promptTemplates,
      skills: this.runtimeHost.session.resourceLoader.getSkills().skills,
      enableSkillCommands: this.runtimeHost.session.settingsManager.getEnableSkillCommands(),
      extensionRunner: this.runtimeHost.session.extensionRunner,
      cwd: this.runtimeHost.session.sessionManager.getCwd(),
      fdPath: this.fdPath,
      commandContext: this.commandContext,
    });
    let provider = result.provider;
    for (const wrapProvider of this.autocompleteProviderWrappers) {
      provider = wrapProvider(provider);
    }

    this.autocompleteProvider = provider;
    this.defaultEditor.setAutocompleteProvider(provider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(provider);
    }
  }

  private showStartupNoticesIfNeeded(): void {
    if (this.startupNoticesShown) {
      return;
    }
    this.startupNoticesShown = true;

    if (!this.changelogMarkdown) {
      return;
    }

    if (this.chatContainer.children.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
    if (this.runtimeHost.session.settingsManager.getCollapseChangelog()) {
      const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
      const latestVersion = versionMatch ? versionMatch[1] : this.version;
      const condensedText = `Updated to v${latestVersion}.`;
      this.chatContainer.addChild(new Text(condensedText, 1, 0));
    } else {
      this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
      );
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.applyLoggerConfig();
    getLogger().info("startup", { version: this.version, cwd: this.runtimeHost.session.sessionManager.getCwd() });

    this.registerSignalHandlers();

    // Load changelog (only show new entries, skip for resumed sessions)
    this.changelogMarkdown = undefined;

    // Ensure fd and rg are available (downloads if missing, adds to PATH via getBinDir)
    // Both are needed: fd for autocomplete, rg for grep tool and bash commands
    // ensureTool calls removed for generic CLI

    // Add header with keybindings from config (unless silenced)
    if (this.options.verbose || !this.runtimeHost.session.settingsManager.getQuietStartup()) {
      const versionLine = `${APP_NAME} v${this.version}`;

      // Build startup instructions using keybinding hint helpers
      const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

      const expandedInstructions = [
        hint("app.interrupt", "to interrupt"),
        hint("app.clear", "to clear"),
        rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
        hint("app.exit", "to exit (empty)"),
        hint("app.suspend", "to suspend"),
        keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
        hint("app.thinking.cycle", "to cycle thinking level"),
        rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
        hint("app.model.select", "to select model"),
        hint("app.tools.expand", "to expand tools"),
        hint("app.thinking.toggle", "to expand thinking"),
        hint("app.editor.external", "for external editor"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
        rawKeyHint("!!", "to run bash (no context)"),
        hint("app.message.followUp", "to queue follow-up"),
        hint("app.message.dequeue", "to edit all queued messages"),
        hint("app.clipboard.pasteImage", "to paste image"),
        rawKeyHint("drop files", "to attach"),
      ].join("\n");
      const compactInstructions = [
        hint("app.interrupt", "interrupt"),
        rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
        rawKeyHint("/", "commands"),
        rawKeyHint("!", "bash"),
        hint("app.tools.expand", "more"),
      ].join(theme.fg("muted", " · "));
      const compactOnboarding = theme.fg(
        "dim",
        `Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
      );
      const onboarding = theme.fg(
        "dim",
        `Teyol can explain its own features and look up its docs. Ask it how to use or extend Teyol.`,
      );
      this.startupContent = new ExpandableText(
        () => `${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
        () => `${expandedInstructions}\n\n${onboarding}`,
        this.getStartupExpansionState(),
        1,
        0,
      );

      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new LogoComponent(loadAsciiLogo(), versionLine, 0, 1));
      this.chatContainer.addChild(this.startupContent);
      this.chatContainer.addChild(new Spacer(1));
    } else {
      this.startupContent = undefined;
    }

    this.renderWidgets(); // Initialize with default spacer
    this.composition.attachRoot();
    this.ui.setFocus(this.editor);

    this.setupKeyHandlers();
    this.setupEditorSubmitHandler();

    // Start the UI before initializing extensions so session_start handlers can use interactive dialogs
    this.ui.start();
    this.isInitialized = true;

    // Initialize extensions first so resources are shown before messages
    await this.rebindCurrentSession();

    // Render initial messages AFTER showing loaded resources
    this.renderInitialMessages();

    // Set up theme file watcher
    onThemeChange(() => {
      this.ui.invalidate();
      this.updateEditorBorderColor();
      this.ui.requestRender();
    });

    // Set up git branch watcher (uses provider instead of footer)
    this.footerDataProvider.onBranchChange(() => {
      this.ui.requestRender();
    });

    // Initialize available provider count for footer display
    await this.updateAvailableProviderCount();
  }

  /**
   * Update terminal title with session name and cwd.
   */
  private updateTerminalTitle(): void {
    const cwdBasename = path.basename(this.runtimeHost.session.sessionManager.getCwd());
    const sessionName = this.runtimeHost.session.sessionManager.getSessionName();
    if (sessionName) {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
    } else {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
    }
  }

  /**
   * Run the interactive mode. This is the main entry point.
   * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
   */
  async run(): Promise<void> {
    await this.init();

    // Start version check asynchronously
    // checkForNewPiVersion removed for generic CLI

    // Start package update check asynchronously
    this.checkForPackageUpdates().then((updates) => {
      if (updates.length > 0) {
        this.showPackageUpdateNotification(updates);
      }
    });

    // Check tmux keyboard setup asynchronously
    this.checkTmuxKeyboardSetup().then((warning) => {
      if (warning) {
        this.showWarning(warning);
      }
    });

    // Show startup warnings
    const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = this.options;

    if (migratedProviders && migratedProviders.length > 0) {
      this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
    }

    const modelsJsonError = this.runtimeHost.session.modelRegistry.getError();
    if (modelsJsonError) {
      this.showError(`models.json error: ${modelsJsonError}`);
    }

    if (modelFallbackMessage) {
      this.showWarning(modelFallbackMessage);
    }

    // Process initial messages
    if (initialMessage) {
      try {
        await this.runtimeHost.session.prompt(initialMessage, { images: initialImages });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }

    if (initialMessages) {
      for (const message of initialMessages) {
        try {
          await this.runtimeHost.session.prompt(message);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
          this.showError(errorMessage);
        }
      }
    }

    // Main interactive loop
    while (true) {
      const userInput = await this.getUserInput();
      try {
        await this.runtimeHost.session.prompt(userInput);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }
  }

  private async checkForPackageUpdates(): Promise<string[]> {
    if (process.env.TEYOL_OFFLINE) {
      return [];
    }

    try {
      const packageManager = new DefaultPackageManager({
        cwd: this.runtimeHost.session.sessionManager.getCwd(),
        agentDir: getAgentDir(),
        settingsManager: this.runtimeHost.session.settingsManager,
      });
      const updates = await packageManager.checkForAvailableUpdates();
      return updates.map((update) => update.displayName);
    } catch {
      return [];
    }
  }

  private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
    if (!process.env.TMUX) return undefined;

    const runTmuxShow = (option: string): Promise<string | undefined> => {
      return new Promise((resolve) => {
        const proc = spawn("tmux", ["show", "-gv", option], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        let stdout = "";
        const timer = setTimeout(() => {
          proc.kill();
          resolve(undefined);
        }, 2000);

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.on("error", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve(code === 0 ? stdout.trim() : undefined);
        });
      });
    };

    const [extendedKeys, extendedKeysFormat] = await Promise.all([
      runTmuxShow("extended-keys"),
      runTmuxShow("extended-keys-format"),
    ]);

    // If we couldn't query tmux (timeout, sandbox, etc.), don't warn
    if (extendedKeys === undefined) return undefined;

    if (extendedKeys !== "on" && extendedKeys !== "always") {
      return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
    }

    if (extendedKeysFormat === "xterm") {
      return "tmux extended-keys-format is xterm. Teyol works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
    }

    return undefined;
  }

  private getMarkdownThemeWithSettings(): MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.runtimeHost.session.settingsManager.getCodeBlockIndent(),
    };
  }

  // =========================================================================
  // Extension System
  // =========================================================================

  private getStartupExpansionState(): boolean {
    return this.options.verbose || this.state.shell.$toolOutputExpanded.getState();
  }

  private showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const showListing = options?.force || this.options.verbose || !this.runtimeHost.session.settingsManager.getQuietStartup();
    const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
    if (!showListing && !showDiagnostics) {
      return;
    }

    const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
    const formatCompactList = (items: string[], options?: { sort?: boolean }): string => {
      const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
      if (options?.sort !== false) {
        labels.sort((a, b) => a.localeCompare(b));
      }
      return theme.fg("dim", `  ${labels.join(", ")}`);
    };
    const addLoadedSection = (
      name: string,
      collapsedBody: string,
      expandedBody = collapsedBody,
      color: ThemeColor = "mdHeading",
    ): void => {
      const section = new ExpandableText(
        () => `${sectionHeader(name, color)}\n${collapsedBody}`,
        () => `${sectionHeader(name, color)}\n${expandedBody}`,
        this.getStartupExpansionState(),
        0,
        0,
      );
      this.chatContainer.addChild(section);
      this.chatContainer.addChild(new Spacer(1));
    };

    const cwd = this.runtimeHost.session.sessionManager.getCwd();
    const homeDir = os.homedir();
    const skillsResult = this.runtimeHost.session.resourceLoader.getSkills();
    const promptsResult = this.runtimeHost.session.resourceLoader.getPrompts();
    const themesResult = this.runtimeHost.session.resourceLoader.getThemes();
    const extensions =
      options?.extensions ??
      this.runtimeHost.session.resourceLoader.getExtensions().extensions.map((extension) => ({
        path: extension.path,
        sourceInfo: extension.sourceInfo,
      }));
    const sourceInfos = new Map<string, SourceInfo>();
    for (const extension of extensions) {
      if (extension.sourceInfo) {
        sourceInfos.set(extension.path, extension.sourceInfo);
      }
    }
    for (const skill of skillsResult.skills) {
      if (skill.sourceInfo) {
        sourceInfos.set(skill.filePath, skill.sourceInfo);
      }
    }
    for (const prompt of promptsResult.prompts) {
      if (prompt.sourceInfo) {
        sourceInfos.set(prompt.filePath, prompt.sourceInfo);
      }
    }
    for (const loadedTheme of themesResult.themes) {
      if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
        sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
      }
    }

    if (showListing) {
      const contextFiles = this.runtimeHost.session.resourceLoader.getAgentsFiles().agentsFiles;
      if (contextFiles.length > 0) {
        this.chatContainer.addChild(new Spacer(1));
        const contextList = contextFiles.map((f) => theme.fg("dim", `  ${formatDisplayPath(f.path, homeDir)}`)).join("\n");
        const contextCompactList = formatCompactList(
          contextFiles.map((contextFile) => formatContextPath(contextFile.path, cwd, homeDir)),
          { sort: false },
        );
        addLoadedSection("Context", contextCompactList, contextList);
      }

      const skills = skillsResult.skills;
      if (skills.length > 0) {
        const groups = buildScopeGroups(
          skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
        );
        const skillList = formatScopeGroups(groups, {
          formatPath: (item) => formatDisplayPath(item.path, homeDir),
          formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo, homeDir),
        });
        const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
        addLoadedSection("Skills", skillCompactList, skillList);
      }

      const templates = this.runtimeHost.session.promptTemplates;
      if (templates.length > 0) {
        const groups = buildScopeGroups(
          templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
        );
        const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
        const templateList = formatScopeGroups(groups, {
          formatPath: (item) => {
            const template = templateByPath.get(item.path);
            return template ? `/${template.name}` : formatDisplayPath(item.path, homeDir);
          },
          formatPackagePath: (item) => {
            const template = templateByPath.get(item.path);
            return template ? `/${template.name}` : formatDisplayPath(item.path, homeDir);
          },
        });
        const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
        addLoadedSection("Prompts", promptCompactList, templateList);
      }

      if (extensions.length > 0) {
        const groups = buildScopeGroups(extensions);
        const extList = formatScopeGroups(groups, {
          formatPath: (item) => formatExtensionDisplayPath(item.path, homeDir),
          formatPackagePath: (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo, homeDir), homeDir),
        });
        const extensionCompactList = formatCompactList(getCompactExtensionLabels(extensions, homeDir));
        addLoadedSection("Extensions", extensionCompactList, extList, "mdHeading");
      }

      // Show loaded themes (excluding built-in)
      const loadedThemes = themesResult.themes;
      const customThemes = loadedThemes.filter((t) => t.sourcePath);
      if (customThemes.length > 0) {
        const groups = buildScopeGroups(
          customThemes.map((loadedTheme) => ({
            path: loadedTheme.sourcePath!,
            sourceInfo: loadedTheme.sourceInfo,
          })),
        );
        const themeList = formatScopeGroups(groups, {
          formatPath: (item) => formatDisplayPath(item.path, homeDir),
          formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo, homeDir),
        });
        const themeCompactList = formatCompactList(
          customThemes.map(
            (loadedTheme) =>
              loadedTheme.name ?? getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo, homeDir),
          ),
        );
        addLoadedSection("Themes", themeCompactList, themeList);
      }
    }

    if (showDiagnostics) {
      const skillDiagnostics = skillsResult.diagnostics;
      if (skillDiagnostics.length > 0) {
        const warningLines = formatDiagnostics(skillDiagnostics, sourceInfos, homeDir);
        this.chatContainer.addChild(new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`, 0, 0));
        this.chatContainer.addChild(new Spacer(1));
      }

      const promptDiagnostics = promptsResult.diagnostics;
      if (promptDiagnostics.length > 0) {
        const warningLines = formatDiagnostics(promptDiagnostics, sourceInfos, homeDir);
        this.chatContainer.addChild(new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0));
        this.chatContainer.addChild(new Spacer(1));
      }

      const extensionDiagnostics: ResourceDiagnostic[] = [];
      const extensionErrors = this.runtimeHost.session.resourceLoader.getExtensions().errors;
      if (extensionErrors.length > 0) {
        for (const error of extensionErrors) {
          extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
        }
      }

      const commandDiagnostics = this.runtimeHost.session.extensionRunner.getCommandDiagnostics();
      extensionDiagnostics.push(...commandDiagnostics);
      extensionDiagnostics.push(...getBuiltInCommandConflictDiagnostics(this.runtimeHost.session.extensionRunner));

      const shortcutDiagnostics = this.runtimeHost.session.extensionRunner.getShortcutDiagnostics();
      extensionDiagnostics.push(...shortcutDiagnostics);

      if (extensionDiagnostics.length > 0) {
        const warningLines = formatDiagnostics(extensionDiagnostics, sourceInfos, homeDir);
        this.chatContainer.addChild(new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0));
        this.chatContainer.addChild(new Spacer(1));
      }

      const themeDiagnostics = themesResult.diagnostics;
      if (themeDiagnostics.length > 0) {
        const warningLines = formatDiagnostics(themeDiagnostics, sourceInfos, homeDir);
        this.chatContainer.addChild(new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0));
        this.chatContainer.addChild(new Spacer(1));
      }
    }
  }

  /**
   * Initialize the extension system with TUI-based UI context.
   */
  private async bindCurrentSessionExtensions(): Promise<void> {
    const uiContext = this.createExtensionUIContext();
    await this.runtimeHost.session.bindExtensions({
      uiContext,
      commandContextActions: {
        waitForIdle: () => this.runtimeHost.session.agent.waitForIdle(),
        newSession: async (options) => {
          if (this.loadingAnimation) {
            this.loadingAnimation.stop();
            this.loadingAnimation = undefined;
          }
          this.statusContainer.clear();
          try {
            const result = await this.runtimeHost.newSession(options);
            if (!result.cancelled) {
              this.renderCurrentSessionState();
              this.ui.requestRender();
            }
            return result;
          } catch (error: unknown) {
            return this.handleFatalRuntimeError("Failed to create session", error);
          }
        },
        fork: async (entryId, options) => {
          try {
            const result = await this.runtimeHost.fork(entryId, options);
            if (!result.cancelled) {
              this.renderCurrentSessionState();
              this.editor.setText(result.selectedText ?? "");
              this.showStatus("Forked to new session");
            }
            return { cancelled: result.cancelled };
          } catch (error: unknown) {
            return this.handleFatalRuntimeError("Failed to fork session", error);
          }
        },
        navigateTree: async (targetId, options) => {
          const result = await this.runtimeHost.session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          if (result.cancelled) {
            return { cancelled: true };
          }

          this.chatContainer.clear();
          this.renderInitialMessages();
          if (result.editorText && !this.editor.getText().trim()) {
            this.editor.setText(result.editorText);
          }
          this.showStatus("Navigated to selected point");
          void this.flushCompactionQueue({ willRetry: false });
          return { cancelled: false };
        },
        switchSession: async (sessionPath, options) => {
          return this.handleResumeSession(sessionPath, options);
        },
        reload: async () => {
          await this.handleReloadCommand();
        },
      },
      shutdownHandler: () => {
        this.shutdownRequested = true;
        if (!this.runtimeHost.session.isStreaming) {
          void this.shutdown();
        }
      },
      onError: (error) => {
        this.showExtensionError(error.extensionPath, error.error, error.stack);
      },
    });

    setRegisteredThemes(this.runtimeHost.session.resourceLoader.getThemes().themes);
    this.setupAutocompleteProvider();

    const extensionRunner = this.runtimeHost.session.extensionRunner;
    this.setupExtensionShortcuts(extensionRunner);
    this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
    this.showStartupNoticesIfNeeded();
  }

  private applyRuntimeSettings(): void {
    this.footer.setSession(this.runtimeHost.session);
    this.footer.setAutoCompactEnabled(this.runtimeHost.session.autoCompactionEnabled);
    this.state.footer.setAutoCompactEnabled(this.runtimeHost.session.autoCompactionEnabled);
    this.footerDataProvider.setCwd(this.runtimeHost.session.sessionManager.getCwd());
    this.state.shell.setHideThinkingBlock(this.runtimeHost.session.settingsManager.getHideThinkingBlock());
    this.ui.setShowHardwareCursor(this.runtimeHost.session.settingsManager.getShowHardwareCursor());
    this.ui.setClearOnShrink(this.runtimeHost.session.settingsManager.getClearOnShrink());
    const editorPaddingX = this.runtimeHost.session.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.runtimeHost.session.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor.setPaddingX(editorPaddingX);
    this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (this.editor !== this.defaultEditor) {
      this.editor.setPaddingX?.(editorPaddingX);
      this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
  }

  private async rebindCurrentSession(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.applyRuntimeSettings();
    await this.bindCurrentSessionExtensions();
    this.subscribeToAgent();
    await this.updateAvailableProviderCount();
    this.updateEditorBorderColor();
    this.updateTerminalTitle();
  }

  private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
    const message = error instanceof Error ? error.message : String(error);
    this.showError(`${prefix}: ${message}`);
    stopThemeWatcher();
    this.stop();
    process.exit(1);
  }

  private renderCurrentSessionState(): void {
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();
    this.renderInitialMessages();
  }

  /**
   * Get a registered tool definition by name (for custom rendering).
   */
  private getRegisteredToolDefinition(toolName: string) {
    return this.runtimeHost.session.getToolDefinition(toolName);
  }

  /**
   * Set up keyboard shortcuts registered by extensions.
   */
  private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
    if (shortcuts.size === 0) return;

    // Create a context for shortcut handlers
    const createContext = (): ExtensionContext => ({
      ui: this.createExtensionUIContext(),
      hasUI: true,
      cwd: this.runtimeHost.session.sessionManager.getCwd(),
      sessionManager: this.runtimeHost.session.sessionManager,
      modelRegistry: this.runtimeHost.session.modelRegistry,
      model: this.runtimeHost.session.model,
      isIdle: () => !this.runtimeHost.session.isStreaming,
      signal: this.runtimeHost.session.agent.signal,
      abort: () => this.runtimeHost.session.abort(),
      hasPendingMessages: () => this.runtimeHost.session.pendingMessageCount > 0,
      shutdown: () => {
        this.shutdownRequested = true;
      },
      getContextUsage: () => this.runtimeHost.session.getContextUsage(),
      compact: (options) => {
        void (async () => {
          try {
            const result = await this.runtimeHost.session.compact(options?.customInstructions);
            options?.onComplete?.(result);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            options?.onError?.(err);
          }
        })();
      },
      getSystemPrompt: () => this.runtimeHost.session.systemPrompt,
    });

    // Set up the extension shortcut handler on the default editor
    this.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        // Cast to KeyId - extension shortcuts use the same format
        if (matchesKey(data, shortcutStr as KeyId)) {
          // Run handler async, don't block input
          Promise.resolve(shortcut.handler(createContext())).catch((err) => {
            this.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
          });
          return true;
        }
      }
      return false;
    };
  }

  /**
   * Set extension status text in the footer.
   */
  private setExtensionStatus(key: string, text: string | undefined): void {
    this.state.footer.setExtensionStatus({ key, text });
    this.footerDataProvider.setExtensionStatus(key, text);
    this.ui.requestRender();
  }

  private getWorkingLoaderMessage(): string {
    return this.state.shell.$working.getState().message ?? this.defaultWorkingMessage;
  }

  private createWorkingLoader(): Loader {
    return new Loader(
      this.ui,
      (spinner) => theme.fg("accent", spinner),
      (text) => theme.fg("muted", text),
      this.getWorkingLoaderMessage(),
      this.state.shell.$working.getState().indicator,
    );
  }

  private stopWorkingLoader(): void {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();
  }

  private setWorkingVisible(visible: boolean): void {
    this.state.shell.setWorkingVisible(visible);
    if (!visible) {
      this.stopWorkingLoader();
      this.ui.requestRender();
      return;
    }
    if (this.runtimeHost.session.isStreaming && !this.loadingAnimation) {
      this.statusContainer.clear();
      this.loadingAnimation = this.createWorkingLoader();
      this.statusContainer.addChild(this.loadingAnimation);
    }
    this.ui.requestRender();
  }

  private setWorkingIndicator(options?: LoaderIndicatorOptions): void {
    this.state.shell.setWorkingIndicator(options);
    this.loadingAnimation?.setIndicator(options);
    this.ui.requestRender();
  }

  private setHiddenThinkingLabel(label?: string): void {
    this.state.shell.setHiddenThinkingLabel(label);
    for (const child of this.chatContainer.children) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.state.shell.$hiddenThinkingLabel.getState());
      }
    }
    if (this.streamingComponent) {
      this.streamingComponent.setHiddenThinkingLabel(this.state.shell.$hiddenThinkingLabel.getState());
    }
    this.ui.requestRender();
  }

  /**
   * Set an extension widget (string array or custom component).
   */
  private setExtensionWidget(
    key: string,
    content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
    options?: ExtensionWidgetOptions,
  ): void {
    const placement = options?.placement ?? "aboveEditor";
    const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
      const existing = map.get(key);
      if (existing?.dispose) existing.dispose();
      map.delete(key);
    };

    removeExisting(this.extensionWidgetsAbove);
    removeExisting(this.extensionWidgetsBelow);

    if (content === undefined) {
      this.renderWidgets();
      return;
    }

    let component: Component & { dispose?(): void };

    if (Array.isArray(content)) {
      // Wrap string array in a Container with Text components
      const container = new Container();
      for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
        container.addChild(new Text(line, 1, 0));
      }
      if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
        container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
      }
      component = container;
    } else {
      // Factory function - create component
      component = content(this.ui, theme);
    }

    const targetMap = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
    targetMap.set(key, component);
    this.renderWidgets();
  }

  private clearExtensionWidgets(): void {
    for (const widget of this.extensionWidgetsAbove.values()) {
      widget.dispose?.();
    }
    for (const widget of this.extensionWidgetsBelow.values()) {
      widget.dispose?.();
    }
    this.extensionWidgetsAbove.clear();
    this.extensionWidgetsBelow.clear();
    this.renderWidgets();
  }

  private resetExtensionUI(): void {
    if (this.extensionSelector) {
      this.hideExtensionSelector();
    }
    if (this.extensionInput) {
      this.hideExtensionInput();
    }
    if (this.extensionEditor) {
      this.hideExtensionEditor();
    }
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.clearExtensionWidgets();
    this.state.footer.clearExtensionStatuses();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.autocompleteProviderWrappers = [];
    this.setCustomEditorComponent(undefined);
    this.setupAutocompleteProvider();
    this.defaultEditor.onExtensionShortcut = undefined;
    this.updateTerminalTitle();
    this.state.shell.setWorkingMessage(undefined);
    this.state.shell.setWorkingVisible(true);
    this.setWorkingIndicator();
    if (this.loadingAnimation) {
      this.loadingAnimation.setMessage(`${this.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`);
    }
    this.setHiddenThinkingLabel();
  }

  // Maximum total widget lines to prevent viewport overflow
  private static readonly MAX_WIDGET_LINES = 10;

  /**
   * Render all extension widgets to the widget container.
   */
  private renderWidgets(): void {
    if (!this.widgetContainerAbove || !this.widgetContainerBelow) return;
    this.renderWidgetContainer(this.widgetContainerAbove, this.extensionWidgetsAbove, true, true);
    this.renderWidgetContainer(this.widgetContainerBelow, this.extensionWidgetsBelow, false, false);
    this.ui.requestRender();
  }

  private renderWidgetContainer(
    container: Container,
    widgets: Map<string, Component & { dispose?(): void }>,
    spacerWhenEmpty: boolean,
    leadingSpacer: boolean,
  ): void {
    container.clear();

    if (widgets.size === 0) {
      if (spacerWhenEmpty) {
        container.addChild(new Spacer(1));
      }
      return;
    }

    if (leadingSpacer) {
      container.addChild(new Spacer(1));
    }
    for (const component of widgets.values()) {
      container.addChild(component);
    }
  }

  /**
   * Set a custom footer component, or restore the built-in footer.
   */
  private setExtensionFooter(
    factory:
      | ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
      | undefined,
  ): void {
    // Dispose existing custom footer
    if (this.customFooter?.dispose) {
      this.customFooter.dispose();
    }

    // Remove current footer from UI
    if (this.customFooter) {
      this.ui.removeChild(this.customFooter);
    } else {
      this.ui.removeChild(this.footer);
    }

    if (factory) {
      // Create and add custom footer, passing the data provider
      this.customFooter = factory(this.ui, theme, this.footerDataProvider);
      this.ui.addChild(this.customFooter);
    } else {
      // Restore built-in footer
      this.customFooter = undefined;
      this.ui.addChild(this.footer);
    }

    this.ui.requestRender();
  }

  /**
   * Permanent headers conflict with the V1 shell timeline model: startup and
   * extension output must scroll with the rest of the timeline.
   */
  private setExtensionHeader(_factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
    this.ui.requestRender();
  }

  private addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const unsubscribe = this.ui.addInputListener(handler);
    this.extensionTerminalInputUnsubscribers.add(unsubscribe);
    return () => {
      unsubscribe();
      this.extensionTerminalInputUnsubscribers.delete(unsubscribe);
    };
  }

  private clearExtensionTerminalInputListeners(): void {
    for (const unsubscribe of this.extensionTerminalInputUnsubscribers) {
      unsubscribe();
    }
    this.extensionTerminalInputUnsubscribers.clear();
  }

  /**
   * Create the ExtensionUIContext for extensions.
   */
  private createExtensionUIContext(): ExtensionUIContext {
    return {
      select: (title, options, opts) => this.showExtensionSelector(title, options, opts),
      confirm: (title, message, opts) => this.showExtensionConfirm(title, message, opts),
      input: (title, placeholder, opts) => this.showExtensionInput(title, placeholder, opts),
      notify: (message, type) => this.showExtensionNotify(message, type),
      onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler),
      setStatus: (key, text) => this.setExtensionStatus(key, text),
      setWorkingMessage: (message) => {
        this.state.shell.setWorkingMessage(message);
        if (this.loadingAnimation) {
          this.loadingAnimation.setMessage(message ?? this.defaultWorkingMessage);
        }
      },
      setWorkingVisible: (visible) => this.setWorkingVisible(visible),
      setWorkingIndicator: (options) => this.setWorkingIndicator(options),
      setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
      setWidget: (key, content, options) => this.setExtensionWidget(key, content, options),
      setFooter: (factory) => this.setExtensionFooter(factory),
      setHeader: (factory) => this.setExtensionHeader(factory),
      setTitle: (title) => this.ui.terminal.setTitle(title),
      custom: (factory, options) => this.showExtensionCustom(factory, options),
      pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      setEditorText: (text) => this.editor.setText(text),
      getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
      editor: (title, prefill) => this.showExtensionEditor(title, prefill),
      addAutocompleteProvider: (factory) => {
        this.autocompleteProviderWrappers.push(factory);
        this.setupAutocompleteProvider();
      },
      setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
      getEditorComponent: () => this.editorComponentFactory,
      get theme() {
        return theme;
      },
      getAllThemes: () => getAvailableThemesWithPaths(),
      getTheme: (name) => getThemeByName(name),
      setTheme: (themeOrName) => {
        if (themeOrName instanceof Theme) {
          setThemeInstance(themeOrName);
          this.ui.requestRender();
          return { success: true };
        }
        const result = setTheme(themeOrName, true);
        if (result.success) {
          if (this.runtimeHost.session.settingsManager.getTheme() !== themeOrName) {
            this.runtimeHost.session.settingsManager.setTheme(themeOrName);
          }
          this.ui.requestRender();
        }
        return result;
      },
      getToolsExpanded: () => this.state.shell.$toolOutputExpanded.getState(),
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
    };
  }

  /**
   * Show a selector for extensions.
   */
  private showExtensionSelector(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionSelector();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.extensionSelector = new ExtensionSelectorComponent(
        title,
        options,
        (option) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(option);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(undefined);
        },
        { tui: this.ui, timeout: opts?.timeout },
      );

      this.composition.setEditorHost(this.extensionSelector);
    });
  }

  /**
   * Hide the extension selector.
   */
  private hideExtensionSelector(): void {
    this.extensionSelector?.dispose();
    this.extensionSelector = undefined;
    this.composition.restoreEditorHost(this.editor);
  }

  /**
   * Show a confirmation dialog for extensions.
   */
  private async showExtensionConfirm(
    title: string,
    message: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<boolean> {
    const result = await this.showExtensionSelector(`${title}\n${message}`, ["Yes", "No"], opts);
    return result === "Yes";
  }

  private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
    const confirmed = await this.showExtensionConfirm(
      "Session cwd not found",
      formatMissingSessionCwdPrompt(error.cwd),
    );
    return confirmed ? process.cwd() : undefined;
  }

  /**
   * Show a text input for extensions.
   */
  private showExtensionInput(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionInput();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.extensionInput = new ExtensionInputComponent(
        title,
        placeholder,
        (value) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(value);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(undefined);
        },
        { tui: this.ui, timeout: opts?.timeout },
      );

      this.composition.setEditorHost(this.extensionInput);
    });
  }

  /**
   * Hide the extension input.
   */
  private hideExtensionInput(): void {
    this.extensionInput?.dispose();
    this.extensionInput = undefined;
    this.composition.restoreEditorHost(this.editor);
  }

  /**
   * Show a multi-line editor for extensions (with Ctrl+G support).
   */
  private showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.extensionEditor = new ExtensionEditorComponent(
        this.ui,
        this.keybindings,
        title,
        prefill,
        (value) => {
          this.hideExtensionEditor();
          resolve(value);
        },
        () => {
          this.hideExtensionEditor();
          resolve(undefined);
        },
      );

      this.composition.setEditorHost(this.extensionEditor);
    });
  }

  /**
   * Hide the extension editor.
   */
  private hideExtensionEditor(): void {
    this.extensionEditor = undefined;
    this.composition.restoreEditorHost(this.editor);
  }

  /**
   * Set a custom editor component from an extension.
   * Pass undefined to restore the default editor.
   */
  private setCustomEditorComponent(factory: EditorFactory | undefined): void {
    this.editorComponentFactory = factory;

    // Save text from current editor before switching
    const currentText = this.editor.getText();

    if (factory) {
      // Create the custom editor with tui, theme, and keybindings
      const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

      // Wire up callbacks from the default editor
      newEditor.onSubmit = this.defaultEditor.onSubmit;
      newEditor.onChange = this.defaultEditor.onChange;

      // Copy text from previous editor
      newEditor.setText(currentText);

      // Copy appearance settings if supported
      if (newEditor.borderColor !== undefined) {
        newEditor.borderColor = this.defaultEditor.borderColor;
      }
      if (newEditor.setPaddingX !== undefined) {
        newEditor.setPaddingX(this.defaultEditor.getPaddingX());
      }

      // Set autocomplete if supported
      if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
        newEditor.setAutocompleteProvider(this.autocompleteProvider);
      }

      // If extending CustomEditor, copy app-level handlers
      // Use duck typing since instanceof fails across jiti module boundaries
      const customEditor = newEditor as unknown as Record<string, unknown>;
      if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
        if (!customEditor.onEscape) {
          customEditor.onEscape = () => this.defaultEditor.onEscape?.();
        }
        if (!customEditor.onCtrlD) {
          customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
        }
        if (!customEditor.onPasteImage) {
          customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
        }
        if (!customEditor.onExtensionShortcut) {
          customEditor.onExtensionShortcut = (data: string) => this.defaultEditor.onExtensionShortcut?.(data);
        }
        // Copy action handlers (clear, suspend, model switching, etc.)
        for (const [action, handler] of this.defaultEditor.actionHandlers) {
          (customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
        }
      }

      this.editor = newEditor;
    } else {
      // Restore default editor with text from custom editor
      this.defaultEditor.setText(currentText);
      this.editor = this.defaultEditor;
    }

    this.composition.restoreEditorHost(this.editor as Component);
  }

  /**
   * Show a notification for extensions.
   */
  private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  /** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
  private async showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    const savedText = this.editor.getText();
    const isOverlay = options?.overlay ?? false;

    const restoreEditor = () => {
      this.editor.setText(savedText);
      this.composition.restoreEditorHost(this.editor);
    };

    return new Promise((resolve, reject) => {
      let component: Component & { dispose?(): void };
      let closed = false;

      const close = (result: T) => {
        if (closed) return;
        closed = true;
        if (isOverlay) this.ui.hideOverlay();
        else restoreEditor();
        // Note: both branches above already call requestRender
        resolve(result);
        try {
          component?.dispose?.();
        } catch {
          /* ignore dispose errors */
        }
      };

      Promise.resolve(factory(this.ui, theme, this.keybindings, close))
        .then((c) => {
          if (closed) return;
          component = c;
          if (isOverlay) {
            // Resolve overlay options - can be static or dynamic function
            const resolveOptions = (): OverlayOptions | undefined => {
              if (options?.overlayOptions) {
                const opts =
                  typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
                return opts;
              }
              // Fallback: use component's width property if available
              const w = (component as { width?: number }).width;
              return w ? { width: w } : undefined;
            };
            const handle = this.ui.showOverlay(component, resolveOptions());
            // Expose handle to caller for visibility control
            options?.onHandle?.(handle);
          } else {
            this.composition.setEditorHost(component);
          }
        })
        .catch((err) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          reject(err);
        });
    });
  }

  /**
   * Show an extension error in the UI.
   */
  private showExtensionError(extensionPath: string, error: string, stack?: string): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
    this.chatContainer.addChild(errorText);
    if (stack) {
      // Show stack trace in dim color, indented
      const stackLines = stack
        .split("\n")
        .slice(1) // Skip first line (duplicates error message)
        .map((line) => theme.fg("dim", `  ${line.trim()}`))
        .join("\n");
      if (stackLines) {
        this.chatContainer.addChild(new Text(stackLines, 1, 0));
      }
    }
    this.ui.requestRender();
  }

  // =========================================================================
  // Key Handlers
  // =========================================================================

  private setupKeyHandlers(): void {
    setupBuiltInHotkeys({
      defaultEditor: this.defaultEditor,
      ui: this.ui,
      settingsManager: this.runtimeHost.session.settingsManager,
      isStreaming: () => this.runtimeHost.session.isStreaming,
      getEditorText: () => this.editor.getText(),
      handlers: {
        restoreQueuedMessagesToEditor: (options) => this.restoreQueuedMessagesToEditor(options),
        clear: () => this.handleCtrlC(),
        exit: () => this.handleCtrlD(),
        suspend: () => this.handleCtrlZ(),
        cycleThinkingLevel: () => this.cycleThinkingLevel(),
        cycleModel: (direction) => this.cycleModel(direction),
        showModelSelector: () => this.showModelSelector(),
        toggleToolOutputExpansion: () => this.toggleToolOutputExpansion(),
        toggleThinkingBlockVisibility: () => this.toggleThinkingBlockVisibility(),
        openExternalEditor: () => this.openExternalEditor(),
        followUp: () => this.handleFollowUp(),
        dequeue: () => this.handleDequeue(),
        newSession: () => this.handleClearCommand(),
        showTreeSelector: () => this.showTreeSelector(),
        showUserMessageSelector: () => this.showUserMessageSelector(),
        showSessionSelector: () => this.showSessionSelector(),
        printLogFile: () => this.printLogFile(),
        pasteImage: () => this.handleClipboardImagePaste(),
      },
    });
  }

  private async handleClipboardImagePaste(): Promise<void> {
    // Mocked for now as readClipboardImage is missing
  }

  private setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = async (text: string) => {
      text = text.trim();
      if (!text) return;

      if (text.startsWith("/")) {
        getLogger().info("slash.dispatch", { text });
      }

      const commandHandled = await dispatchBuiltInCommand(text, this.commandContext);
      if (commandHandled) {
        this.editor.setText("");
        return;
      }

      // Queue input during compaction (extension commands execute immediately)
      if (this.runtimeHost.session.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          await this.runtimeHost.session.prompt(text);
        } else {
          this.queueCompactionMessage(text, "steer");
        }
        return;
      }

      // If streaming, use prompt() with steer behavior
      // This handles extension commands (execute immediately), prompt template expansion, and queueing
      if (this.runtimeHost.session.isStreaming) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        await this.runtimeHost.session.prompt(text, { streamingBehavior: "steer" });
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
        return;
      }

      if (this.onInputCallback) {
        this.onInputCallback(text);
      }
      this.editor.addToHistory?.(text);
    };
  }

  private subscribeToAgent(): void {
    this.unsubscribe = this.runtimeHost.session.subscribe(async (event) => {
      await this.handleEvent(event);
    });
  }

  private async handleEvent(event: AgentSessionEvent): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    this.footer.invalidate();

    switch (event.type) {
      case "agent_start":
        if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
          this.ui.terminal.setProgress(true);
        }
        // Restore main escape handler if retry handler is still active
        // (retry success event fires later, but we need main handler now)
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        if (this.retryCountdown) {
          this.retryCountdown.dispose();
          this.retryCountdown = undefined;
        }
        if (this.retryLoader) {
          this.retryLoader.stop();
          this.retryLoader = undefined;
        }
        this.stopWorkingLoader();
        if (this.state.shell.$working.getState().visible) {
          this.loadingAnimation = this.createWorkingLoader();
          this.statusContainer.addChild(this.loadingAnimation);
        }
        this.ui.requestRender();
        break;

      case "queue_update":
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
        break;

      case "session_info_changed":
        this.updateTerminalTitle();
        this.footer.invalidate();
        this.ui.requestRender();
        break;

      case "message_start":
        if (event.message.role === "custom") {
          this.addMessageToChat(event.message);
          this.ui.requestRender();
        } else if (event.message.role === "user") {
          this.addMessageToChat(event.message);
          this.updatePendingMessagesDisplay();
          this.ui.requestRender();
        } else if (event.message.role === "assistant") {
          this.streamingComponent = new AssistantMessageComponent(
            undefined,
            this.state.shell.$hideThinkingBlock.getState(),
            this.getMarkdownThemeWithSettings(),
            this.state.shell.$hiddenThinkingLabel.getState(),
          );
          this.streamingMessage = event.message;
          this.chatContainer.addChild(this.streamingComponent);
          this.streamingComponent.updateContent(this.streamingMessage);
          this.ui.requestRender();
        }
        break;

      case "message_update":
        if (this.streamingComponent && event.message.role === "assistant") {
          this.streamingMessage = event.message;
          this.streamingComponent.updateContent(this.streamingMessage);

          for (const content of this.streamingMessage.content) {
            if (content.type === "toolCall") {
              if (!this.pendingTools.has(content.id)) {
                const component = new ToolExecutionComponent(
                  content.name,
                  content.id,
                  content.arguments,
                  {
                    showImages: this.runtimeHost.session.settingsManager.getShowImages(),
                    imageWidthCells: this.runtimeHost.session.settingsManager.getImageWidthCells(),
                  },
                  this.getRegisteredToolDefinition(content.name),
                  this.ui,
                  this.runtimeHost.session.sessionManager.getCwd(),
                );
                component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
                this.chatContainer.addChild(component);
                this.pendingTools.set(content.id, component);
              } else {
                const component = this.pendingTools.get(content.id);
                if (component) {
                  component.updateArgs(content.arguments);
                }
              }
            }
          }
          this.ui.requestRender();
        }
        break;

      case "message_end":
        if (event.message.role === "user") break;
        if (this.streamingComponent && event.message.role === "assistant") {
          this.streamingMessage = event.message;
          let errorMessage: string | undefined;
          if (this.streamingMessage.stopReason === "aborted") {
            const retryAttempt = this.runtimeHost.session.retryAttempt;
            errorMessage =
              retryAttempt > 0
                ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                : "Operation aborted";
            this.streamingMessage.errorMessage = errorMessage;
          }
          this.streamingComponent.updateContent(this.streamingMessage);

          if (this.streamingMessage.stopReason === "aborted" || this.streamingMessage.stopReason === "error") {
            if (!errorMessage) {
              errorMessage = this.streamingMessage.errorMessage || "Error";
            }
            for (const [, component] of this.pendingTools.entries()) {
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
            }
            this.pendingTools.clear();
          } else {
            // Args are now complete - trigger diff computation for edit tools
            for (const [, component] of this.pendingTools.entries()) {
              component.setArgsComplete();
            }
          }
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
          this.footer.invalidate();
        }
        this.ui.requestRender();
        break;

      case "tool_execution_start": {
        let component = this.pendingTools.get(event.toolCallId);
        if (!component) {
          component = new ToolExecutionComponent(
            event.toolName,
            event.toolCallId,
            event.args,
            {
              showImages: this.runtimeHost.session.settingsManager.getShowImages(),
              imageWidthCells: this.runtimeHost.session.settingsManager.getImageWidthCells(),
            },
            this.getRegisteredToolDefinition(event.toolName),
            this.ui,
            this.runtimeHost.session.sessionManager.getCwd(),
          );
          component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
          this.chatContainer.addChild(component);
          this.pendingTools.set(event.toolCallId, component);
        }
        component.markExecutionStarted();
        this.ui.requestRender();
        break;
      }

      case "tool_execution_update": {
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult({ ...event.partialResult, isError: false }, true);
          this.ui.requestRender();
        }
        break;
      }

      case "tool_execution_end": {
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult({ ...event.result, isError: event.isError });
          this.pendingTools.delete(event.toolCallId);
          this.ui.requestRender();
        }
        break;
      }

      case "agent_end":
        if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
          this.ui.terminal.setProgress(false);
        }
        if (this.loadingAnimation) {
          this.loadingAnimation.stop();
          this.loadingAnimation = undefined;
          this.statusContainer.clear();
        }
        if (this.streamingComponent) {
          this.chatContainer.removeChild(this.streamingComponent);
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
        }
        this.pendingTools.clear();

        await this.checkShutdownRequested();

        this.ui.requestRender();
        break;

      case "compaction_start": {
        if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
          this.ui.terminal.setProgress(true);
        }
        // Keep editor active; submissions are queued during compaction.
        this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.runtimeHost.session.abortCompaction();
        };
        this.statusContainer.clear();
        const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
        const label =
          event.reason === "manual"
            ? `Compacting context... ${cancelHint}`
            : `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
        this.autoCompactionLoader = new Loader(
          this.ui,
          (spinner) => theme.fg("accent", spinner),
          (text) => theme.fg("muted", text),
          label,
        );
        this.statusContainer.addChild(this.autoCompactionLoader);
        this.ui.requestRender();
        break;
      }

      case "compaction_end": {
        if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
          this.ui.terminal.setProgress(false);
        }
        if (this.autoCompactionEscapeHandler) {
          this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
          this.autoCompactionEscapeHandler = undefined;
        }
        if (this.autoCompactionLoader) {
          this.autoCompactionLoader.stop();
          this.autoCompactionLoader = undefined;
          this.statusContainer.clear();
        }
        if (event.aborted) {
          if (event.reason === "manual") {
            this.showError("Compaction cancelled");
          } else {
            this.showStatus("Auto-compaction cancelled");
          }
        } else if (event.result) {
          this.chatContainer.clear();
          this.rebuildChatFromMessages();
          this.addMessageToChat(
            createCompactionSummaryMessage(event.result.summary, event.result.tokensBefore, new Date().toISOString()),
          );
          this.footer.invalidate();
        } else if (event.errorMessage) {
          if (event.reason === "manual") {
            this.showError(event.errorMessage);
          } else {
            this.chatContainer.addChild(new Spacer(1));
            this.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
          }
        }
        void this.flushCompactionQueue({ willRetry: event.willRetry });
        this.ui.requestRender();
        break;
      }

      case "auto_retry_start": {
        // Set up escape to abort retry
        this.retryEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.runtimeHost.session.abortRetry();
        };
        // Show retry indicator
        this.statusContainer.clear();
        this.retryCountdown?.dispose();
        const retryMessage = (seconds: number) =>
          `Retrying (${event.attempt}/${event.maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
        this.retryLoader = new Loader(
          this.ui,
          (spinner) => theme.fg("warning", spinner),
          (text) => theme.fg("muted", text),
          retryMessage(Math.ceil(event.delayMs / 1000)),
        );
        this.retryCountdown = new CountdownTimer(
          event.delayMs,
          this.ui,
          (seconds) => {
            this.retryLoader?.setMessage(retryMessage(seconds));
          },
          () => {
            this.retryCountdown = undefined;
          },
        );
        this.statusContainer.addChild(this.retryLoader);
        this.ui.requestRender();
        break;
      }

      case "auto_retry_end": {
        // Restore escape handler
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        if (this.retryCountdown) {
          this.retryCountdown.dispose();
          this.retryCountdown = undefined;
        }
        // Stop loader
        if (this.retryLoader) {
          this.retryLoader.stop();
          this.retryLoader = undefined;
          this.statusContainer.clear();
        }
        // Show error only on final failure (success shows normal response)
        if (!event.success) {
          this.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
        }
        this.ui.requestRender();
        break;
      }
    }
  }

  /**
   * Show a status message in the chat.
   *
   * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
   * we update the previous status line instead of appending new ones to avoid log spam.
   */
  private showStatus(message: string): void {
    const children = this.chatContainer.children;
    const last = children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

    if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
      this.lastStatusText.setText(theme.fg("dim", message));
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", message), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.ui.requestRender();
  }

  private addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
    switch (message.role) {
      case "custom": {
        if (message.display) {
          const renderer = this.runtimeHost.session.extensionRunner.getMessageRenderer(message.customType);
          const component = new CustomMessageComponent(message, renderer, this.getMarkdownThemeWithSettings());
          component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
          this.chatContainer.addChild(component);
        }
        break;
      }
      case "compactionSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new CompactionSummaryMessageComponent(message, this.getMarkdownThemeWithSettings());
        component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
        this.chatContainer.addChild(component);
        break;
      }
      case "user": {
          const textContent = getUserMessageText(message);
        if (textContent) {
          if (this.chatContainer.children.length > 0) {
            this.chatContainer.addChild(new Spacer(1));
          }
          const skillBlock = parseSkillBlock(textContent);
          if (skillBlock) {
            // Render skill block (collapsible)
            const component = new SkillInvocationMessageComponent(skillBlock, this.getMarkdownThemeWithSettings());
            component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
            this.chatContainer.addChild(component);
            // Render user message separately if present
            if (skillBlock.userMessage) {
              const userComponent = new UserMessageComponent(
                skillBlock.userMessage,
                this.getMarkdownThemeWithSettings(),
              );
              this.chatContainer.addChild(userComponent);
            }
          } else {
            const userComponent = new UserMessageComponent(textContent, this.getMarkdownThemeWithSettings());
            this.chatContainer.addChild(userComponent);
          }
          if (options?.populateHistory) {
            this.editor.addToHistory?.(textContent);
          }
        }
        break;
      }
      case "assistant": {
        const assistantComponent = new AssistantMessageComponent(
          message,
          this.state.shell.$hideThinkingBlock.getState(),
          this.getMarkdownThemeWithSettings(),
          this.state.shell.$hiddenThinkingLabel.getState(),
        );
        this.chatContainer.addChild(assistantComponent);
        break;
      }
      case "toolResult":
      case "compactionSummary":
      case "branchSummary":
        // Handled separately or via custom message component
        break;
      default: {
        const _exhaustive: never = message;
      }
    }
  }

  /**
   * Render session context to chat. Used for initial load and rebuild after compaction.
   * @param sessionContext Session context to render
   * @param options.updateFooter Update footer state
   * @param options.populateHistory Add user messages to editor history
   */
  private renderSessionContext(
    sessionContext: SessionContext,
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    this.pendingTools.clear();

    if (options.updateFooter) {
      this.footer.invalidate();
      this.updateEditorBorderColor();
    }

    for (const message of sessionContext.messages) {
      // Assistant messages need special handling for tool calls
      if (message.role === "assistant") {
        this.addMessageToChat(message);
        // Render tool call components
        for (const content of message.content) {
          if (content.type === "toolCall") {
            const component = new ToolExecutionComponent(
              content.name,
              content.id,
              content.arguments,
              {
                showImages: this.runtimeHost.session.settingsManager.getShowImages(),
                imageWidthCells: this.runtimeHost.session.settingsManager.getImageWidthCells(),
              },
              this.getRegisteredToolDefinition(content.name),
              this.ui,
              this.runtimeHost.session.sessionManager.getCwd(),
            );
            component.setExpanded(this.state.shell.$toolOutputExpanded.getState());
            this.chatContainer.addChild(component);

            if (message.stopReason === "aborted" || message.stopReason === "error") {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.runtimeHost.session.retryAttempt;
                errorMessage =
                  retryAttempt > 0
                    ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                    : "Operation aborted";
              } else {
                errorMessage = message.errorMessage || "Error";
              }
              component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
            } else {
              this.pendingTools.set(content.id, component);
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match tool results to pending tool components
        const component = this.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.pendingTools.delete(message.toolCallId);
        }
      } else {
        // All other messages use standard rendering
        this.addMessageToChat(message, options);
      }
    }

    this.pendingTools.clear();
    this.ui.requestRender();
  }

  renderInitialMessages(): void {
    // Get aligned messages and entries from session context
    const context = this.runtimeHost.session.sessionManager.buildSessionContext();
    this.renderSessionContext(context, {
      updateFooter: true,
      populateHistory: true,
    });

    // Show compaction info if session was compacted
    const allEntries = this.runtimeHost.session.sessionManager.getEntries();
    const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
    if (compactionCount > 0) {
      const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }
  }

  async getUserInput(): Promise<string> {
    return new Promise((resolve) => {
      this.onInputCallback = (text: string) => {
        this.onInputCallback = undefined;
        resolve(text);
      };
    });
  }

  private rebuildChatFromMessages(): void {
    this.chatContainer.clear();
    const context = this.runtimeHost.session.sessionManager.buildSessionContext();
    this.renderSessionContext(context);
  }

  // =========================================================================
  // Key handlers
  // =========================================================================

  private handleCtrlC(): void {
    const now = Date.now();
    if (now - this.lastSigintTime < 500) {
      void this.shutdown();
    } else {
      this.clearEditor();
      this.lastSigintTime = now;
    }
  }

  private handleCtrlD(): void {
    // Only called when editor is empty (enforced by CustomEditor)
    void this.shutdown();
  }

  /**
   * Gracefully shutdown the agent.
   * Stops the TUI before emitting shutdown events so extension UI cleanup cannot
   * repaint the final frame while the process is exiting.
   */
  private isShuttingDown = false;

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();

    // Drain any in-flight Kitty key release events before stopping.
    // This prevents escape sequences from leaking to the parent shell over slow SSH.
    await this.ui.terminal.drainInput(1000);

    this.stop();
    await this.runtimeHost.dispose();
    process.exit(0);
  }

  /**
   * Check if shutdown was requested and perform shutdown if so.
   */
  private async checkShutdownRequested(): Promise<void> {
    if (!this.shutdownRequested) return;
    await this.shutdown();
  }

  private registerSignalHandlers(): void {
    this.unregisterSignalHandlers();

    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void this.shutdown();
      };
      process.on(signal, handler);
      this.signalCleanupHandlers.push(() => process.off(signal, handler));
    }
  }

  private unregisterSignalHandlers(): void {
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
  }

  private handleCtrlZ(): void {
    if (process.platform === "win32") {
      this.showStatus("Suspend to background is not supported on Windows");
      return;
    }

    // Keep the event loop alive while suspended. Without this, stopping the TUI
    // can leave Node with no ref'ed handles, causing the process to exit on fg
    // before the SIGCONT handler gets a chance to restore the terminal.
    const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

    // Ignore SIGINT while suspended so Ctrl+C in the terminal does not
    // kill the backgrounded process. The handler is removed on resume.
    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);

    // Set up handler to restore TUI when resumed
    process.once("SIGCONT", () => {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      this.ui.start();
      this.ui.requestRender(true);
    });

    try {
      // Stop the TUI (restore terminal to normal mode)
      this.ui.stop();

      // Send SIGTSTP to process group (pid=0 means all processes in group)
      process.kill(0, "SIGTSTP");
    } catch (error) {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
  }

  private async handleFollowUp(): Promise<void> {
    const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
    if (!text) return;

    // Queue input during compaction (extension commands execute immediately)
    if (this.runtimeHost.session.isCompacting) {
      if (this.isExtensionCommand(text)) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        await this.runtimeHost.session.prompt(text);
      } else {
        this.queueCompactionMessage(text, "followUp");
      }
      return;
    }

    // Alt+Enter queues a follow-up message (waits until agent finishes)
    // This handles extension commands (execute immediately), prompt template expansion, and queueing
    if (this.runtimeHost.session.isStreaming) {
      this.editor.addToHistory?.(text);
      this.editor.setText("");
      await this.runtimeHost.session.prompt(text, { streamingBehavior: "followUp" });
      this.updatePendingMessagesDisplay();
      this.ui.requestRender();
    }
    // If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
    else if (this.editor.onSubmit) {
      this.editor.setText("");
      this.editor.onSubmit(text);
    }
  }

  private handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.showStatus("No queued messages to restore");
    } else {
      this.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
    }
  }

  private updateEditorBorderColor(): void {
    const level = this.runtimeHost.session.thinkingLevel || "off";
    this.editor.borderColor = theme.getThinkingBorderColor(level);
    this.ui.requestRender();
  }

  private cycleThinkingLevel(): void {
    const newLevel = this.runtimeHost.session.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.showStatus("Current model does not support thinking");
    } else {
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  private async cycleModel(direction: "forward" | "backward"): Promise<void> {
    try {
      const result = await this.runtimeHost.session.cycleModel(direction);
      if (result === undefined) {
        const msg = this.runtimeHost.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
        this.showStatus(msg);
      } else {
        this.footer.invalidate();
        this.updateEditorBorderColor();
        const thinkingStr =
          result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
        this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.state.shell.$toolOutputExpanded.getState());
  }

  private setToolsExpanded(expanded: boolean): void {
    this.state.shell.setToolsExpanded(expanded);
    if (isExpandable(this.startupContent)) {
      this.startupContent.setExpanded(expanded);
    }
    for (const child of this.chatContainer.children) {
      if (isExpandable(child)) {
        child.setExpanded(expanded);
      }
    }
    this.ui.requestRender();
  }

  private toggleThinkingBlockVisibility(): void {
    this.state.shell.setHideThinkingBlock(!this.state.shell.$hideThinkingBlock.getState());
    this.runtimeHost.session.settingsManager.setHideThinkingBlock(this.state.shell.$hideThinkingBlock.getState());

    // Rebuild chat from session messages
    this.chatContainer.clear();
    this.rebuildChatFromMessages();

    // If streaming, re-add the streaming component with updated visibility and re-render
    if (this.streamingComponent && this.streamingMessage) {
      this.streamingComponent.setHideThinkingBlock(this.state.shell.$hideThinkingBlock.getState());
      this.streamingComponent.updateContent(this.streamingMessage);
      this.chatContainer.addChild(this.streamingComponent);
    }

    this.showStatus(`Thinking blocks: ${this.state.shell.$hideThinkingBlock.getState() ? "hidden" : "visible"}`);
  }

  private openExternalEditor(): void {
    // Determine editor (respect $VISUAL, then $EDITOR)
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
      return;
    }

    const currentText = this.editor.getExpandedText?.() ?? this.editor.getText();
    const tmpFile = path.join(os.tmpdir(), `ai-editor-${Date.now()}.md`);

    try {
      // Write current content to temp file
      fs.writeFileSync(tmpFile, currentText, "utf-8");

      // Stop TUI to release terminal
      this.ui.stop();

      // Split by space to support editor arguments (e.g., "code --wait")
      const [editor, ...editorArgs] = editorCmd.split(" ");

      // Spawn editor synchronously with inherited stdio for interactive editing
      const result = spawnSync(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      // On successful exit (status 0), replace editor content
      if (result.status === 0) {
        const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
        this.editor.setText(newContent);
      }
      // On non-zero exit, keep original text (no action needed)
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }

      // Restart TUI
      this.ui.start();
      // Force full re-render since external editor uses alternate screen
      this.ui.requestRender(true);
    }
  }

  // =========================================================================
  // UI helpers
  // =========================================================================

  clearEditor(): void {
    this.editor.setText("");
    this.ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
    this.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
    this.ui.requestRender();
  }

  showNewVersionNotification(newVersion: string): void {
    const action = theme.fg("accent", `${APP_NAME} update`);
    const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;
    const changelogUrl = theme.fg("accent", "");
    const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`, 1, 0),
    );
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }

  showPackageUpdateNotification(packages: string[]): void {
    const action = theme.fg("accent", `${APP_NAME} update`);
    const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }

  /**
   * Get all queued messages (read-only).
   * Combines session queue and compaction queue.
   */
  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return this.state.queue.getAllQueuedMessages({
      steering: [...this.runtimeHost.session.getSteeringMessages()],
      followUp: [...this.runtimeHost.session.getFollowUpMessages()],
    });
  }

  /**
   * Clear all queued messages and return their contents.
   * Clears both session queue and compaction queue.
   */
  private clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.runtimeHost.session.clearQueue();
    return this.state.queue.clearAllQueues({ steering, followUp });
  }

  private updatePendingMessagesDisplay(): void {
    this.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = formatAppKeyDisplay(keyText("app.message.dequeue"));
      const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
      this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  private restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort) {
        this.runtimeHost.session.agent.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.editor.getText();
    const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
    this.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort) {
      this.runtimeHost.session.agent.abort();
    }
    return allQueued.length;
  }

  private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
    this.state.queue.queueCompactionMessage({ text, mode });
    this.editor.addToHistory?.(text);
    this.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.showStatus("Queued message for after compaction");
  }

  private isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.runtimeHost.session.extensionRunner;

    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return !!extensionRunner.getCommand(commandName);
  }

  private async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
    if (this.compactionQueuedMessages.length === 0) {
      return;
    }

    const queuedMessages = this.state.queue.takeCompactionQueue();
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.runtimeHost.session.clearQueue();
      this.state.queue.restoreCompactionQueue(queuedMessages);
      this.updatePendingMessagesDisplay();
      this.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    };

    try {
      if (options?.willRetry) {
        // When retry is pending, queue messages for the retry turn
        for (const message of queuedMessages) {
          if (this.isExtensionCommand(message.text)) {
            await this.runtimeHost.session.prompt(message.text);
          } else if (message.mode === "followUp") {
            await this.runtimeHost.session.followUp(message.text);
          } else {
            await this.runtimeHost.session.steer(message.text);
          }
        }
        this.updatePendingMessagesDisplay();
        return;
      }

      // Find first non-extension-command message to use as prompt
      const firstPromptIndex = queuedMessages.findIndex((message) => !this.isExtensionCommand(message.text));
      if (firstPromptIndex === -1) {
        // All extension commands - execute them all
        for (const message of queuedMessages) {
          await this.runtimeHost.session.prompt(message.text);
        }
        return;
      }

      // Execute any extension commands before the first prompt
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const firstPrompt = queuedMessages[firstPromptIndex];
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        await this.runtimeHost.session.prompt(message.text);
      }

      // Send first prompt (starts streaming)
      const promptPromise = this.runtimeHost.session.prompt(firstPrompt.text).catch((error) => {
        restoreQueue(error);
      });

      // Queue remaining messages
      for (const message of rest) {
        if (this.isExtensionCommand(message.text)) {
          await this.runtimeHost.session.prompt(message.text);
        } else if (message.mode === "followUp") {
          await this.runtimeHost.session.followUp(message.text);
        } else {
          await this.runtimeHost.session.steer(message.text);
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    } catch (error) {
      restoreQueue(error);
    }
  }

  /** Move pending bash components from pending area to chat */

  // =========================================================================
  // Selectors
  // =========================================================================

  /**
   * Shows a selector component in place of the editor.
   * @param create Factory that receives a `done` callback and returns the component and focus target
   */
  private showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
    const done = () => {
      this.composition.restoreEditorHost(this.editor);
    };
    const { component, focus } = create(done);
    this.composition.setEditorHost(component, focus);
  }

  private showSettingsSelector(): void {
    this.showSelector((done) => {
      const selector = new SettingsSelectorComponent(
        {
          autoCompact: this.runtimeHost.session.autoCompactionEnabled,
          showImages: this.runtimeHost.session.settingsManager.getShowImages(),
          imageWidthCells: this.runtimeHost.session.settingsManager.getImageWidthCells(),
          autoResizeImages: this.runtimeHost.session.settingsManager.getImageAutoResize(),
          blockImages: this.runtimeHost.session.settingsManager.getBlockImages(),
          enableSkillCommands: this.runtimeHost.session.settingsManager.getEnableSkillCommands(),
          steeringMode: this.runtimeHost.session.steeringMode,
          followUpMode: this.runtimeHost.session.followUpMode,
          transport: this.runtimeHost.session.settingsManager.getTransport(),
          thinkingLevel: this.runtimeHost.session.thinkingLevel,
          availableThinkingLevels: this.runtimeHost.session.getAvailableThinkingLevels(),
          currentTheme: this.runtimeHost.session.settingsManager.getTheme() || "dark",
          availableThemes: getAvailableThemes(),
          hideThinkingBlock: this.state.shell.$hideThinkingBlock.getState(),
          collapseChangelog: this.runtimeHost.session.settingsManager.getCollapseChangelog(),
          enableInstallTelemetry: this.runtimeHost.session.settingsManager.getEnableInstallTelemetry(),
          doubleEscapeAction: this.runtimeHost.session.settingsManager.getDoubleEscapeAction(),
          treeFilterMode: this.runtimeHost.session.settingsManager.getTreeFilterMode(),
          showHardwareCursor: this.runtimeHost.session.settingsManager.getShowHardwareCursor(),
          editorPaddingX: this.runtimeHost.session.settingsManager.getEditorPaddingX(),
          autocompleteMaxVisible: this.runtimeHost.session.settingsManager.getAutocompleteMaxVisible(),
          quietStartup: this.runtimeHost.session.settingsManager.getQuietStartup(),
          clearOnShrink: this.runtimeHost.session.settingsManager.getClearOnShrink(),
          showTerminalProgress: this.runtimeHost.session.settingsManager.getShowTerminalProgress(),
          warnings: this.runtimeHost.session.settingsManager.getWarnings(),
        },
        {
          onAutoCompactChange: (enabled) => {
            this.runtimeHost.session.setAutoCompactionEnabled(enabled);
            this.state.footer.setAutoCompactEnabled(enabled);
            this.footer.setAutoCompactEnabled(enabled);
          },
          onShowImagesChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setShowImages(enabled);
            for (const child of this.chatContainer.children) {
              if (child instanceof ToolExecutionComponent) {
                child.setShowImages(enabled);
              }
            }
          },
          onImageWidthCellsChange: (width) => {
            this.runtimeHost.session.settingsManager.setImageWidthCells(width);
            for (const child of this.chatContainer.children) {
              if (child instanceof ToolExecutionComponent) {
                child.setImageWidthCells(width);
              }
            }
          },
          onAutoResizeImagesChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setImageAutoResize(enabled);
          },
          onBlockImagesChange: (blocked) => {
            this.runtimeHost.session.settingsManager.setBlockImages(blocked);
          },
          onEnableSkillCommandsChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setEnableSkillCommands(enabled);
            this.setupAutocompleteProvider();
          },
          onSteeringModeChange: (mode) => {
            this.runtimeHost.session.setSteeringMode(mode);
          },
          onFollowUpModeChange: (mode) => {
            this.runtimeHost.session.setFollowUpMode(mode);
          },
          onTransportChange: (transport) => {
            this.runtimeHost.session.settingsManager.setTransport(transport);
            this.runtimeHost.session.agent.transport = transport;
          },
          onThinkingLevelChange: (level) => {
            this.runtimeHost.session.setThinkingLevel(level);
            this.footer.invalidate();
            this.updateEditorBorderColor();
          },
          onThemeChange: (themeName) => {
            const result = setTheme(themeName, true);
            this.runtimeHost.session.settingsManager.setTheme(themeName);
            this.ui.invalidate();
            if (!result.success) {
              this.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
            }
          },
          onThemePreview: (themeName) => {
            const result = setTheme(themeName, true);
            if (result.success) {
              this.ui.invalidate();
              this.ui.requestRender();
            }
          },
          onHideThinkingBlockChange: (hidden) => {
            this.state.shell.setHideThinkingBlock(hidden);
            this.runtimeHost.session.settingsManager.setHideThinkingBlock(hidden);
            for (const child of this.chatContainer.children) {
              if (child instanceof AssistantMessageComponent) {
                child.setHideThinkingBlock(hidden);
              }
            }
            this.chatContainer.clear();
            this.rebuildChatFromMessages();
          },
          onCollapseChangelogChange: (collapsed) => {
            this.runtimeHost.session.settingsManager.setCollapseChangelog(collapsed);
          },
          onEnableInstallTelemetryChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setEnableInstallTelemetry(enabled);
          },
          onQuietStartupChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setQuietStartup(enabled);
          },
          onDoubleEscapeActionChange: (action) => {
            this.runtimeHost.session.settingsManager.setDoubleEscapeAction(action);
          },
          onTreeFilterModeChange: (mode) => {
            this.runtimeHost.session.settingsManager.setTreeFilterMode(mode);
          },
          onShowHardwareCursorChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setShowHardwareCursor(enabled);
            this.ui.setShowHardwareCursor(enabled);
          },
          onEditorPaddingXChange: (padding) => {
            this.runtimeHost.session.settingsManager.setEditorPaddingX(padding);
            this.defaultEditor.setPaddingX(padding);
            if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
              this.editor.setPaddingX(padding);
            }
          },
          onAutocompleteMaxVisibleChange: (maxVisible) => {
            this.runtimeHost.session.settingsManager.setAutocompleteMaxVisible(maxVisible);
            this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
            if (this.editor !== this.defaultEditor && this.editor.setAutocompleteMaxVisible !== undefined) {
              this.editor.setAutocompleteMaxVisible(maxVisible);
            }
          },
          onClearOnShrinkChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setClearOnShrink(enabled);
            this.ui.setClearOnShrink(enabled);
          },
          onShowTerminalProgressChange: (enabled) => {
            this.runtimeHost.session.settingsManager.setShowTerminalProgress(enabled);
          },
          onWarningsChange: (warnings) => {
            this.runtimeHost.session.settingsManager.setWarnings(warnings);
          },
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
        },
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }

  private getModelArgumentCompletions(prefix: string, valuePrefix = ""): AutocompleteItem[] | null {
    const models =
      this.runtimeHost.session.scopedModels.length > 0
        ? this.runtimeHost.session.scopedModels.map((s) => s.model)
        : this.runtimeHost.session.modelRegistry.getAvailable();

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

  private async handleModelCommand(text: string): Promise<void> {
    const argumentText = text === "/model" ? undefined : text.slice("/model".length).trim();

    if (!argumentText) {
      this.showModelActionsSelector();
      return;
    }

    const [action, ...rest] = argumentText.split(/\s+/);
    const actionArgument = rest.join(" ").trim();

    if (action === "select") {
      await this.handleModelSelectCommand(actionArgument || undefined);
      return;
    }

    if (action === "fast-cycle") {
      await this.showModelsSelector();
      return;
    }

    await this.handleModelSelectCommand(argumentText);
  }

  private showModelActionsSelector(): void {
    this.showSelector((done) => {
      const selector = new ModelActionsSelectorComponent(
        (action) => {
          done();
          void this.handleModelAction(action);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getSelectList() };
    });
  }

  private async handleModelAction(action: ModelAction): Promise<void> {
    switch (action) {
      case "select":
        this.showModelSelector();
        return;
      case "fast-cycle":
        await this.showModelsSelector();
        return;
    }
  }

  private async handleModelSelectCommand(searchTerm?: string): Promise<void> {
    if (!searchTerm) {
      this.showModelSelector();
      return;
    }

    const model = await this.findExactModelMatch(searchTerm);
    if (model) {
      try {
        await this.runtimeHost.session.setModel(model);
        this.footer.invalidate();
        this.updateEditorBorderColor();
        this.showStatus(`Model: ${model.id}`);
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    this.showModelSelector(searchTerm);
  }

  private async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
    const models = await this.getModelCandidates();
    return findExactModelReferenceMatch(searchTerm, models);
  }

  private async getModelCandidates(): Promise<Model<any>[]> {
    if (this.runtimeHost.session.scopedModels.length > 0) {
      return this.runtimeHost.session.scopedModels.map((scoped) => scoped.model);
    }

    this.runtimeHost.session.modelRegistry.refresh();
    try {
      await this.runtimeHost.session.modelRegistry.refreshDynamic();
      return await this.runtimeHost.session.modelRegistry.getAvailable();
    } catch {
      return [];
    }
  }

  /** Update the footer's available provider count from current model candidates */
  private async updateAvailableProviderCount(): Promise<void> {
    const models = await this.getModelCandidates();
    const uniqueProviders = new Set(models.map((m) => m.provider));
    this.state.footer.setAvailableProviderCount(uniqueProviders.size);
    this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  private showModelSelector(initialSearchInput?: string): void {
    this.showSelector((done) => {
      const selector = new ModelSelectorComponent(
        this.ui,
        this.runtimeHost.session.model,
        this.runtimeHost.session.settingsManager,
        this.runtimeHost.session.modelRegistry,
        this.runtimeHost.session.scopedModels,
        async (model) => {
          try {
            await this.runtimeHost.session.setModel(model);
            this.footer.invalidate();
            this.updateEditorBorderColor();
            done();
            this.showStatus(`Model: ${model.id}`);
          } catch (error) {
            done();
            this.showError(error instanceof Error ? error.message : String(error));
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        initialSearchInput,
      );
      return { component: selector, focus: selector };
    });
  }

  private async showModelsSelector(): Promise<void> {
    // Get all available models
    this.runtimeHost.session.modelRegistry.refresh();
    await this.runtimeHost.session.modelRegistry.refreshDynamic();
    const allModels = this.runtimeHost.session.modelRegistry.getAvailable();

    if (allModels.length === 0) {
      this.showStatus("No models available");
      return;
    }

    // Check if session has scoped models (from previous session-only changes or CLI --models)
    const sessionScopedModels = this.runtimeHost.session.scopedModels;
    const hasSessionScope = sessionScopedModels.length > 0;

    // Build enabled model IDs from session state or settings
    let currentEnabledIds: string[] | null = null;

    if (hasSessionScope) {
      // Use current session's scoped models
      currentEnabledIds = sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
    } else {
      // Fall back to settings
      const patterns = this.runtimeHost.session.settingsManager.getEnabledModels();
      if (patterns !== undefined && patterns.length > 0) {
        const scopedModels = await resolveModelScope(patterns, this.runtimeHost.session.modelRegistry);
        currentEnabledIds = scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
      }
    }

    // Helper to update session's scoped models (session-only, no persist)
    const updateSessionModels = async (enabledIds: string[] | null) => {
      currentEnabledIds = enabledIds === null ? null : [...enabledIds];
      if (enabledIds && enabledIds.length > 0 && enabledIds.length < allModels.length) {
        const newScopedModels = await resolveModelScope(enabledIds, this.runtimeHost.session.modelRegistry);
        this.runtimeHost.session.setScopedModels(
          newScopedModels.map((sm) => ({
            model: sm.model,
            thinkingLevel: sm.thinkingLevel,
          })),
        );
      } else {
        // All enabled or none enabled = no filter
        this.runtimeHost.session.setScopedModels([]);
      }
      await this.updateAvailableProviderCount();
      this.ui.requestRender();
    };

    this.showSelector((done) => {
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
            // Persist to settings
            const newPatterns =
              enabledIds === null || enabledIds.length === allModels.length
                ? undefined // All enabled = clear filter
                : enabledIds;
            this.runtimeHost.session.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
            this.showStatus("Model selection saved to settings");
          },
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private showUserMessageSelector(): void {
    const userMessages = this.runtimeHost.session.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.showStatus("No messages to fork from");
      return;
    }

    const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

    this.showSelector((done) => {
      const selector = new UserMessageSelectorComponent(
        userMessages.map((m) => ({ id: m.entryId, text: m.text })),
        async (entryId) => {
          try {
            const result = await this.runtimeHost.fork(entryId);
            if (result.cancelled) {
              done();
              this.ui.requestRender();
              return;
            }

            this.renderCurrentSessionState();
            this.editor.setText(result.selectedText ?? "");
            done();
            this.showStatus("Forked to new session");
          } catch (error: unknown) {
            done();
            this.showError(error instanceof Error ? error.message : String(error));
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        initialSelectedId,
      );
      return { component: selector, focus: selector.getMessageList() };
    });
  }

  private async handleCloneCommand(): Promise<void> {
    const leafId = this.runtimeHost.session.sessionManager.getLeafId();
    if (!leafId) {
      this.showStatus("Nothing to clone yet");
      return;
    }

    try {
      const result = await this.runtimeHost.fork(leafId, { position: "at" });
      if (result.cancelled) {
        this.ui.requestRender();
        return;
      }

      this.renderCurrentSessionState();
      this.editor.setText("");
      this.showStatus("Cloned to new session");
    } catch (error: unknown) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private showTreeSelector(initialSelectedId?: string): void {
    const tree = this.runtimeHost.session.sessionManager.getTree();
    const realLeafId = this.runtimeHost.session.sessionManager.getLeafId();
    const initialFilterMode = this.runtimeHost.session.settingsManager.getTreeFilterMode();

    if (tree.length === 0) {
      this.showStatus("No entries in session");
      return;
    }

    this.showSelector((done) => {
      const selector = new TreeSelectorComponent(
        tree,
        realLeafId,
        this.ui.terminal.rows,
        async (entryId) => {
          // Selecting the current leaf is a no-op (already there)
          if (entryId === realLeafId) {
            done();
            this.showStatus("Already at this point");
            return;
          }

          // Ask about summarization
          done(); // Close selector first

          // Loop until user makes a complete choice or cancels to tree
          let wantsSummary = false;
          let customInstructions: string | undefined;

          // Check if we should skip the prompt (user preference to always default to no summary)
          if (!this.runtimeHost.session.settingsManager.getBranchSummarySkipPrompt()) {
            while (true) {
              const summaryChoice = await this.showExtensionSelector("Summarize branch?", [
                "No summary",
                "Summarize",
                "Summarize with custom prompt",
              ]);

              if (summaryChoice === undefined) {
                // User pressed escape - re-show tree selector with same selection
                this.showTreeSelector(entryId);
                return;
              }

              wantsSummary = summaryChoice !== "No summary";

              if (summaryChoice === "Summarize with custom prompt") {
                customInstructions = await this.showExtensionEditor("Custom summarization instructions");
                if (customInstructions === undefined) {
                  // User cancelled - loop back to summary selector
                  continue;
                }
              }

              // User made a complete choice
              break;
            }
          }

          // Set up escape handler and loader if summarizing
          let summaryLoader: Loader | undefined;
          const originalOnEscape = this.defaultEditor.onEscape;

          if (wantsSummary) {
            this.defaultEditor.onEscape = () => {
              this.runtimeHost.session.abortBranchSummary();
            };
            this.chatContainer.addChild(new Spacer(1));
            summaryLoader = new Loader(
              this.ui,
              (spinner) => theme.fg("accent", spinner),
              (text) => theme.fg("muted", text),
              `Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
            );
            this.statusContainer.addChild(summaryLoader);
            this.ui.requestRender();
          }

          try {
            const result = await this.runtimeHost.session.navigateTree(entryId, {
              summarize: wantsSummary,
              customInstructions,
            });

            if (result.aborted) {
              // Summarization aborted - re-show tree selector with same selection
              this.showStatus("Branch summarization cancelled");
              this.showTreeSelector(entryId);
              return;
            }
            if (result.cancelled) {
              this.showStatus("Navigation cancelled");
              return;
            }

            // Update UI
            this.chatContainer.clear();
            this.renderInitialMessages();
            if (result.editorText && !this.editor.getText().trim()) {
              this.editor.setText(result.editorText);
            }
            this.showStatus("Navigated to selected point");
            void this.flushCompactionQueue({ willRetry: false });
          } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
          } finally {
            if (summaryLoader) {
              summaryLoader.stop();
              this.statusContainer.clear();
            }
            this.defaultEditor.onEscape = originalOnEscape;
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        (entryId, label) => {
          this.runtimeHost.session.sessionManager.appendLabelChange(entryId, label);
          this.ui.requestRender();
        },
        initialSelectedId,
        initialFilterMode,
      );
      return { component: selector, focus: selector };
    });
  }

  private showSessionSelector(): void {
    this.showSelector((done) => {
      const selector = new SessionSelectorComponent(
        (onProgress) =>
          SessionManager.list(this.runtimeHost.session.sessionManager.getCwd(), this.runtimeHost.session.sessionManager.getSessionDir(), onProgress),
        SessionManager.listAll,
        async (sessionPath) => {
          done();
          await this.handleResumeSession(sessionPath);
        },
        () => {
          done();
          this.ui.requestRender();
        },
        () => {
          void this.shutdown();
        },
        () => this.ui.requestRender(),
        {
          renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
            const next = (nextName ?? "").trim();
            if (!next) return;
            const mgr = SessionManager.open(sessionFilePath);
            mgr.appendSessionInfo(next);
          },
          showRenameHint: true,
          keybindings: this.keybindings,
        },

        this.runtimeHost.session.sessionManager.getSessionFile(),
      );
      return { component: selector, focus: selector };
    });
  }

  private async handleResumeSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
  ): Promise<{ cancelled: boolean }> {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();
    try {
      const result = await this.runtimeHost.switchSession(sessionPath, {
        withSession: options?.withSession,
      });
      if (result.cancelled) {
        return result;
      }
      this.renderCurrentSessionState();
      this.showStatus("Resumed session");
      return result;
    } catch (error: unknown) {
      if (error instanceof MissingSessionCwdError) {
        const selectedCwd = await this.promptForMissingSessionCwd(error);
        if (!selectedCwd) {
          this.showStatus("Resume cancelled");
          return { cancelled: true };
        }
        const result = await this.runtimeHost.switchSession(sessionPath, {
          cwdOverride: selectedCwd,
          withSession: options?.withSession,
        });
        if (result.cancelled) {
          return result;
        }
        this.renderCurrentSessionState();
        this.showStatus("Resumed session in current cwd");
        return result;
      }
      return this.handleFatalRuntimeError("Failed to resume session", error);
    }
  }

  private getLoginProviderOptions(authType?: "oauth" | "api_key" | "self_hosted"): AuthSelectorProvider[] {
    const authStorage = this.runtimeHost.session.modelRegistry.authStorage;
    const oauthProviders = authStorage.getOAuthProviders();
    const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
    const options: AuthSelectorProvider[] = oauthProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      authType: "oauth",
    }));

    const modelProviders = new Set(this.runtimeHost.session.modelRegistry.getAll().map((model) => model.provider));
    for (const providerId of modelProviders) {
      if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) {
        continue;
      }
      options.push({
        id: providerId,
        name: this.runtimeHost.session.modelRegistry.getProviderDisplayName(providerId),
        authType: "api_key",
      });
    }

    for (const providerId of getProviders()) {
      const metadata = getProviderMetadata(providerId);
      if (!metadata?.auth?.selfHosted) continue;
      if (options.some((option) => option.id === providerId && option.authType === "self_hosted")) continue;
      options.push({
        id: providerId,
        name: this.runtimeHost.session.modelRegistry.getProviderDisplayName(providerId),
        authType: "self_hosted",
      });
    }

    const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
    return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));
  }

  private getLogoutProviderOptions(): AuthSelectorProvider[] {
    const authStorage = this.runtimeHost.session.modelRegistry.authStorage;
    const options: AuthSelectorProvider[] = [];

    for (const providerId of authStorage.list()) {
      const credential = authStorage.get(providerId);
      if (!credential) {
        continue;
      }
      options.push({
        id: providerId,
        name: this.runtimeHost.session.modelRegistry.getProviderDisplayName(providerId),
        authType: credential.type,
      });
    }

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }

  private showLoginAuthTypeSelector(): void {
    const subscriptionLabel = "Use a subscription";
    const apiKeyLabel = "Use an API key";
    const selfHostedLabel = "Use a self-hosted provider";
    this.showSelector((done) => {
      const selector = new ExtensionSelectorComponent(
        "Select authentication method:",
        [subscriptionLabel, apiKeyLabel, selfHostedLabel],
        (option) => {
          done();
          const authType = option === subscriptionLabel ? "oauth" : option === apiKeyLabel ? "api_key" : "self_hosted";
          this.showLoginProviderSelector(authType);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private showLoginProviderSelector(authType: "oauth" | "api_key" | "self_hosted"): void {
    const providerOptions = this.getLoginProviderOptions(authType);
    if (providerOptions.length === 0) {
      const noProvidersMessage =
        authType === "oauth"
          ? "No subscription providers available."
          : authType === "api_key"
            ? "No API key providers available."
            : "No self-hosted providers available.";
      this.showStatus(noProvidersMessage);
      return;
    }

    this.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        "login",
        this.runtimeHost.session.modelRegistry.authStorage,
        providerOptions,
        async (providerId: string) => {
          done();

          const providerOption = providerOptions.find((provider) => provider.id === providerId);
          if (!providerOption) {
            return;
          }

          if (providerOption.authType === "oauth") {
            await this.showLoginDialog(providerOption.id, providerOption.name);
          } else if (providerOption.authType === "api_key") {
            await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
          } else {
            await this.showSelfHostedProviderDialog(providerOption.id, providerOption.name);
          }
        },
        () => {
          done();
          this.showLoginAuthTypeSelector();
        },
        (providerId) => this.runtimeHost.session.modelRegistry.getProviderAuthStatus(providerId),
      );
      return { component: selector, focus: selector };
    });
  }

  private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
    if (mode === "login") {
      this.showLoginAuthTypeSelector();
      return;
    }

    const providerOptions = this.getLogoutProviderOptions();
    if (providerOptions.length === 0) {
      this.showStatus(
        "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
      );
      return;
    }

    this.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        mode,
        this.runtimeHost.session.modelRegistry.authStorage,
        providerOptions,
        async (providerId: string) => {
          done();

          const providerOption = providerOptions.find((provider) => provider.id === providerId);
          if (!providerOption) {
            return;
          }

          try {
            this.runtimeHost.session.modelRegistry.authStorage.logout(providerOption.id);
            this.runtimeHost.session.modelRegistry.refresh();
            await this.runtimeHost.session.modelRegistry.refreshDynamic();
            await this.runtimeHost.session.revalidateSelectedModel();
            await this.updateAvailableProviderCount();
            const message =
              providerOption.authType === "oauth"
                ? `Logged out of ${providerOption.name}`
                : `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
            this.footer.invalidate();
            this.updateEditorBorderColor();
            this.showStatus(message);
          } catch (error: unknown) {
            this.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private async completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: "oauth" | "api_key",
    previousModel: Model<any> | undefined,
  ): Promise<void> {
    this.runtimeHost.session.modelRegistry.refresh();
    await this.runtimeHost.session.modelRegistry.refreshDynamic();

    const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

    let selectedModel: Model<any> | undefined;
    let selectionError: string | undefined;
    if (isUnknownModel(previousModel)) {
      const availableModels = this.runtimeHost.session.modelRegistry.getAvailable();
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
            await this.runtimeHost.session.setModel(selectedModel);
          } catch (error: unknown) {
            selectedModel = undefined;
            const errorMessage = error instanceof Error ? error.message : String(error);
            selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
          }
        }
      }
    }

    await this.updateAvailableProviderCount();
    this.footer.invalidate();
    this.updateEditorBorderColor();
    if (selectedModel) {
      this.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
    } else {
      this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
      if (selectionError) {
        this.showError(selectionError);
      }
    }
  }

  private async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
    const previousModel = this.runtimeHost.session.model;

    const dialog = new LoginDialogComponent(
      this.ui,
      providerId,
      (_success, _message) => {
        // Completion handled below
      },
      providerName,
    );

    this.composition.setEditorHost(dialog);

    const restoreEditor = () => {
      this.composition.restoreEditorHost(this.editor);
    };

    try {
      const apiKey = (await dialog.showPrompt("Enter API key:")).trim();
      if (!apiKey) {
        throw new Error("API key cannot be empty.");
      }

      this.runtimeHost.session.modelRegistry.authStorage.set(providerId, { type: "api_key", key: apiKey });

      restoreEditor();
      await this.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
      }
    }
  }

  private async showSelfHostedProviderDialog(providerId: string, providerName: string): Promise<void> {
    const previousModel = this.runtimeHost.session.model;
    const defaultBaseUrl =
      process.env[`${providerId.toUpperCase()}_HOST`]?.trim() ||
      getSelfHostedProviderDefaultBaseUrl(providerId) ||
      "http://localhost:11434";

    const dialog = new LoginDialogComponent(
      this.ui,
      providerId,
      (_success, _message) => {
        // Completion handled below
      },
      providerName,
      `Configure self-hosted ${providerName}`,
    );

    this.composition.setEditorHost(dialog);

    const restoreEditor = () => {
      this.composition.restoreEditorHost(this.editor);
    };

    try {
      const enteredBaseUrl = (await dialog.showPrompt("Enter base URL:", defaultBaseUrl)).trim();
      const baseUrl = enteredBaseUrl || defaultBaseUrl;

      this.runtimeHost.session.modelRegistry.configureProviderBaseUrl(providerId, baseUrl);
      await this.runtimeHost.session.modelRegistry.refreshDynamic();

      const providerModels = this.runtimeHost.session.modelRegistry.getAvailable().filter((model) => model.provider === providerId);
      if (providerModels.length === 0) {
        const loadError = this.runtimeHost.session.modelRegistry.getError();
        throw new Error(loadError || `No models discovered for ${providerName}.`);
      }

      let selectedModel: Model<any> | undefined;
      if (isUnknownModel(previousModel)) {
        selectedModel = providerModels[0];
        await this.runtimeHost.session.setModel(selectedModel);
      }

      restoreEditor();
      await this.updateAvailableProviderCount();
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(
        selectedModel
          ? `Configured self-hosted ${providerName}. Selected ${selectedModel.id}.`
          : `Configured self-hosted ${providerName}.`,
      );
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.showError(`Failed to configure self-hosted ${providerName}: ${errorMsg}`);
      }
    }
  }

  private async showLoginDialog(providerId: string, providerName: string): Promise<void> {
    const providerInfo = this.runtimeHost.session.modelRegistry.authStorage
      .getOAuthProviders()
      .find((provider) => provider.id === providerId);
    const previousModel = this.runtimeHost.session.model;

    // Providers that use callback servers (can paste redirect URL)
    const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

    // Create login dialog component
    const dialog = new LoginDialogComponent(
      this.ui,
      providerId,
      (_success, _message) => {
        // Completion handled below
      },
      providerName,
    );

    // Show dialog in editor container
    this.composition.setEditorHost(dialog);

    // Promise for manual code input (racing with callback server)
    let manualCodeResolve: ((code: string) => void) | undefined;
    let manualCodeReject: ((err: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    // Restore editor helper
    const restoreEditor = () => {
      this.composition.restoreEditorHost(this.editor);
    };

    try {
      await this.runtimeHost.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
        onAuth: (info: { url: string; instructions?: string }) => {
          dialog.showAuth(info.url, info.instructions);

          if (usesCallbackServer) {
            // Show input for manual paste, racing with callback
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

      // Success
      restoreEditor();
      await this.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
      }
    }
  }

  // =========================================================================
  // Command handlers
  // =========================================================================

  private async handleReloadCommand(): Promise<void> {
    if (this.runtimeHost.session.isStreaming) {
      this.showWarning("Wait for the current response to finish before reloading.");
      return;
    }
    if (this.runtimeHost.session.isCompacting) {
      this.showWarning("Wait for compaction to finish before reloading.");
      return;
    }

    this.resetExtensionUI();

    const reloadBox = new Container();
    const borderColor = (s: string) => theme.fg("border", s);
    reloadBox.addChild(new DynamicBorder(borderColor));
    reloadBox.addChild(new Spacer(1));
    reloadBox.addChild(
      new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0),
    );
    reloadBox.addChild(new Spacer(1));
    reloadBox.addChild(new DynamicBorder(borderColor));

    const previousEditor = this.editor;
    this.composition.setEditorHost(reloadBox);
    this.ui.requestRender(true);
    await new Promise((resolve) => process.nextTick(resolve));

    const dismissReloadBox = (editor: Component) => {
      this.composition.restoreEditorHost(editor);
    };

    getLogger().info("reload.start");

    try {
      await this.runtimeHost.session.reload();
      this.keybindings.reload();
      if (isExpandable(this.startupContent)) {
        this.startupContent.setExpanded(this.state.shell.$toolOutputExpanded.getState());
      }
      setRegisteredThemes(this.runtimeHost.session.resourceLoader.getThemes().themes);
      this.state.shell.setHideThinkingBlock(this.runtimeHost.session.settingsManager.getHideThinkingBlock());
      const themeName = this.runtimeHost.session.settingsManager.getTheme();
      const themeResult = themeName ? setTheme(themeName, true) : { success: true };
      if (!themeResult.success) {
        this.showError(`Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`);
      }
      const editorPaddingX = this.runtimeHost.session.settingsManager.getEditorPaddingX();
      const autocompleteMaxVisible = this.runtimeHost.session.settingsManager.getAutocompleteMaxVisible();
      this.defaultEditor.setPaddingX(editorPaddingX);
      this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
      if (this.editor !== this.defaultEditor) {
        this.editor.setPaddingX?.(editorPaddingX);
        this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
      }
      this.ui.setShowHardwareCursor(this.runtimeHost.session.settingsManager.getShowHardwareCursor());
      this.ui.setClearOnShrink(this.runtimeHost.session.settingsManager.getClearOnShrink());
      this.setupAutocompleteProvider();
      const runner = this.runtimeHost.session.extensionRunner;
      this.setupExtensionShortcuts(runner);
      this.rebuildChatFromMessages();
      dismissReloadBox(this.editor as Component);
      this.showLoadedResources({
        force: false,
        showDiagnosticsWhenQuiet: true,
      });
      const modelsJsonError = this.runtimeHost.session.modelRegistry.getError();
      if (modelsJsonError) {
        this.showError(`models.json error: ${modelsJsonError}`);
      }
      this.applyLoggerConfig();
      getLogger().info("reload.complete");
      this.showStatus("Reloaded keybindings, extensions, skills, prompts, themes");
    } catch (error) {
      dismissReloadBox(previousEditor as Component);
      getLogger().error("reload.error", { error });
      this.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleShareCommand(): Promise<void> {
    // Check if gh is available and logged in
    try {
      const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
      if (authResult.status !== 0) {
        this.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
        return;
      }
    } catch {
      this.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
      return;
    }

    // Export to a temp file
    const tmpFile = path.join(os.tmpdir(), "session.html");
    try {
      await this.runtimeHost.session.exportToHtml(tmpFile);
    } catch (error: unknown) {
      this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }

    // Show cancellable loader, replacing the editor
    const loader = new Loader(
      this.ui,
      (spinner) => theme.fg("accent", spinner),
      (text) => theme.fg("muted", text),
      "Creating gist...",
    );
    this.composition.setEditorHost(loader);

    const restoreEditor = () => {
      this.composition.restoreEditorHost(this.editor);
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    };

    // Create a secret gist asynchronously
    let proc: ReturnType<typeof spawn> | null = null;

    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
        proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
      });

      restoreEditor();

      if (result.code !== 0) {
        const errorMsg = result.stderr?.trim() || "Unknown error";
        this.showError(`Failed to create gist: ${errorMsg}`);
        return;
      }

      // Extract gist ID from the URL returned by gh
      // gh returns something like: https://gist.github.com/username/GIST_ID
      const gistUrl = result.stdout?.trim();
      const gistId = gistUrl?.split("/").pop();
      if (!gistId) {
        this.showError("Failed to parse gist ID from gh output");
        return;
      }
    } catch (error: unknown) {
      if (true) {
        restoreEditor();
        this.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  private handleNameCommand(text: string): void {
    const name = text.replace(/^\/name\s*/, "").trim();
    if (!name) {
      const currentName = this.runtimeHost.session.sessionManager.getSessionName();
      if (currentName) {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
      } else {
        this.showWarning("Usage: /name <name>");
      }
      this.ui.requestRender();
      return;
    }

    this.runtimeHost.session.setSessionName(name);
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0));
    this.ui.requestRender();
  }

  private async handleSessionCommand(text: string): Promise<void> {
    const actionText = text === "/session" ? undefined : text.slice("/session".length).trim();
    if (!actionText) {
      this.showSessionActionsSelector();
      return;
    }

    const [action] = actionText.split(/\s+/, 1);
    if (this.isSessionAction(action)) {
      await this.handleSessionAction(action);
      return;
    }

    this.showError("Unknown session action. Use: info, new, resume, compact, tree, clone, fork");
  }

  private isSessionAction(action: string | undefined): action is SessionAction {
    return (
      action === "info" ||
      action === "new" ||
      action === "resume" ||
      action === "compact" ||
      action === "tree" ||
      action === "clone" ||
      action === "fork"
    );
  }

  private showSessionActionsSelector(): void {
    this.showSelector((done) => {
      const selector = new SessionActionsSelectorComponent(
        (action) => {
          done();
          void this.handleSessionAction(action);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getSelectList() };
    });
  }

  private async handleSessionAction(action: SessionAction): Promise<void> {
    switch (action) {
      case "info":
        this.showSessionInfo();
        return;
      case "new":
        await this.handleClearCommand();
        return;
      case "resume":
        this.showSessionSelector();
        return;
      case "compact":
        await this.handleCompactCommand();
        return;
      case "tree":
        this.showTreeSelector();
        return;
      case "clone":
        await this.handleCloneCommand();
        return;
      case "fork":
        this.showUserMessageSelector();
        return;
    }
  }

  private showSessionInfo(): void {
    const stats = this.runtimeHost.session.getSessionStats();
    const sessionName = this.runtimeHost.session.sessionManager.getSessionName();
    const info = formatSessionInfo(stats, sessionName);

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(info, 1, 0));
    this.ui.requestRender();
  }

  private handleHotkeysCommand(): void {
    const hotkeys = buildHotkeyHelpMarkdown({
      extensionShortcuts: this.runtimeHost.session.extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig()),
    });

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  private async handleClearCommand(): Promise<void> {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();
    try {
      const result = await this.runtimeHost.newSession();
      if (result.cancelled) {
        return;
      }
      this.renderCurrentSessionState();
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
      this.ui.requestRender();
    } catch (error: unknown) {
      await this.handleFatalRuntimeError("Failed to create session", error);
    }
  }

  private applyLoggerConfig(): void {
    const cfg = this.runtimeHost.session.settingsManager.getLogSettings();
    let sessionLogDir: string | undefined;
    if (cfg.mode === "session") {
      try {
        const dir = this.runtimeHost.session.sessionManager.getSessionDir();
        if (typeof dir === "string" && dir.length > 0) {
          sessionLogDir = dir;
        }
      } catch {
        sessionLogDir = undefined;
      }
    }
    configureLogger({
      enabled: cfg.enabled,
      mode: cfg.mode,
      rotationLines: cfg.rotation_lines,
      levels: cfg.level,
      sessionLogDir,
    });
  }

  private async handleLogCommand(text: string): Promise<void> {
    const argumentText = text === "/log" ? undefined : text.slice("/log".length).trim();
    if (!argumentText) {
      this.showLogActionsSelector();
      return;
    }
    const [action, ...rest] = argumentText.split(/\s+/);
    const actionArgument = rest.join(" ").trim();

    switch (action) {
      case "view":
        this.printLogFile();
        return;
      case "enable":
        this.runtimeHost.session.settingsManager.setLogEnabled(true);
        this.applyLoggerConfig();
        getLogger().info("log.enabled");
        this.showInfo(`Logging enabled. File: ${getLogFilePath()}`);
        return;
      case "disable":
        getLogger().info("log.disabled");
        this.runtimeHost.session.settingsManager.setLogEnabled(false);
        this.applyLoggerConfig();
        this.showInfo("Logging disabled.");
        return;
      case "mode":
        if (actionArgument === "app" || actionArgument === "session") {
          this.applyLogMode(actionArgument);
        } else {
          this.showLogModeSelector();
        }
        return;
      case "rotation_lines":
      case "rotation-lines":
        if (actionArgument.length > 0) {
          this.applyLogRotationLines(actionArgument);
        } else {
          this.showInfo(
            `Current rotation_lines: ${this.runtimeHost.session.settingsManager.getLogRotationLines()}. ` +
              "Usage: /log rotation_lines <number> (0 disables rotation)",
          );
        }
        return;
      case "level":
      case "levels":
        this.showLogLevelsSelector();
        return;
      default:
        this.showWarning(
          `Unknown /log subcommand: ${action}. Try: view | enable | disable | mode | rotation_lines | level`,
        );
        return;
    }
  }

  private applyLogMode(mode: LogMode): void {
    this.runtimeHost.session.settingsManager.setLogMode(mode);
    this.applyLoggerConfig();
    getLogger().info("log.mode", { mode });
    this.showInfo(`Log mode set to ${mode}. File: ${getLogFilePath()}`);
  }

  private applyLogRotationLines(arg: string): void {
    const parsed = Number.parseInt(arg, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.showWarning(`Invalid rotation_lines value: ${arg}. Must be an integer >= 0.`);
      return;
    }
    this.runtimeHost.session.settingsManager.setLogRotationLines(parsed);
    this.applyLoggerConfig();
    getLogger().info("log.rotation_lines", { rotation_lines: this.runtimeHost.session.settingsManager.getLogRotationLines() });
    this.showInfo(
      parsed === 0
        ? "Log rotation disabled (rotation_lines=0)."
        : `Log rotation set to ${this.runtimeHost.session.settingsManager.getLogRotationLines()} lines.`,
    );
  }

  private printLogFile(): void {
    const logPath = getLogFilePath();
    const exists = fs.existsSync(logPath);
    const tail = exists ? readLogTail(40) : "";
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(formatLogFileDisplay(logPath, exists, tail), 1, 1));
    this.ui.requestRender();
  }

  private showInfo(message: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓")} ${message}`, 1, 1));
    this.ui.requestRender();
  }

  private showLogActionsSelector(): void {
    this.showSelector((done) => {
      const selector = new LogActionsSelectorComponent(
        this.runtimeHost.session.settingsManager.getLogEnabled(),
        (action) => {
          done();
          void this.handleLogAction(action);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getSelectList() };
    });
  }

  private async handleLogAction(action: LogAction): Promise<void> {
    switch (action) {
      case "view":
        this.printLogFile();
        return;
      case "enable":
        this.runtimeHost.session.settingsManager.setLogEnabled(true);
        this.applyLoggerConfig();
        getLogger().info("log.enabled");
        this.showInfo(`Logging enabled. File: ${getLogFilePath()}`);
        return;
      case "disable":
        getLogger().info("log.disabled");
        this.runtimeHost.session.settingsManager.setLogEnabled(false);
        this.applyLoggerConfig();
        this.showInfo("Logging disabled.");
        return;
      case "mode":
        this.showLogModeSelector();
        return;
      case "rotation_lines":
        this.showInfo(
          `Current rotation_lines: ${this.runtimeHost.session.settingsManager.getLogRotationLines()}. ` +
            "Use '/log rotation_lines <number>' to change (0 disables).",
        );
        return;
      case "level":
        this.showLogLevelsSelector();
        return;
    }
  }

  private showLogModeSelector(): void {
    this.showSelector((done) => {
      const selector = new LogModeSelectorComponent(
        this.runtimeHost.session.settingsManager.getLogMode(),
        (mode) => {
          done();
          this.applyLogMode(mode);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getSelectList() };
    });
  }

  private showLogLevelsSelector(): void {
    this.showSelector((done) => {
      const selector = new LogLevelsSelectorComponent(
        this.runtimeHost.session.settingsManager.getLogLevels(),
        (levels: LogLevel[]) => {
          this.runtimeHost.session.settingsManager.setLogLevels(levels);
          this.applyLoggerConfig();
          getLogger().info("log.level", { level: levels });
          done();
          this.showInfo(`Log levels set to: ${this.runtimeHost.session.settingsManager.getLogLevels().join(", ") || "(none)"}`);
        },
        () => {
          done();
          this.ui.requestRender();
        },
        (levels: LogLevel[]) => {
          this.runtimeHost.session.settingsManager.setLogLevels(levels);
          this.applyLoggerConfig();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getList() };
    });
  }

  private async handleCompactCommand(customInstructions?: string): Promise<void> {
    const entries = this.runtimeHost.session.sessionManager.getEntries();
    const messageCount = entries.filter((e) => e.type === "message").length;

    if (messageCount < 2) {
      this.showWarning("Nothing to compact (no messages yet)");
      return;
    }

    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();

    try {
      await this.runtimeHost.session.compact(customInstructions);
    } catch {
      // Ignore, will be emitted as an event
    }
  }

  stop(): void {
    this.unregisterSignalHandlers();
    if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
      this.ui.terminal.setProgress(false);
    }
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.clearExtensionTerminalInputListeners();
    this.composition.dispose();
    this.state.dispose();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.isInitialized) {
      this.ui.stop();
      this.isInitialized = false;
    }
  }
}
