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
  type ImageContent,
  type Model,
} from "#ai/index.js";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  EditorComponent,
  MarkdownTheme,
} from "#tui/index.js";
import {
  type Component,
  Container,
  Loader,
  type LoaderIndicatorOptions,
  Markdown,
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
  getDocsPath,
  getShareViewerUrl,
  isDevMode,
  VERSION,
} from "../../config.js";
import { getLogger } from "#shell/runtime/logger.js";
import type {
  ExtensionCommandContext,
  ExtensionCommandContextActions,
} from "#shell/runtime/extensions/index.js";
import { type AgentSessionEvent, parseSkillBlock } from "#shell/runtime/agent-session.js";
import { type AppKeybinding, KeybindingsManager } from "#shell/runtime/keybindings.js";
import { createCompactionSummaryMessage } from "#shell/runtime/messages.js";
import { DefaultPackageManager } from "#shell/runtime/package-manager.js";
import {
  formatMissingSessionCwdPrompt,
  MissingSessionCwdError,
  type SessionContext,
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
import { keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";
import { loadAsciiLogo, LogoComponent } from "./logo.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { createCliState, type CliState, type QueuedMessage } from "./state/index.js";
import {
  getEditorTheme,
  getMarkdownTheme,
  initTheme,
  onThemeChange,
  setRegisteredThemes,
  setTheme,
  stopThemeWatcher,
  theme,
} from "../theme/theme.js";
import { dispatchBuiltInCommand } from "./commands/built-in.js";
import { buildAutocomplete, getBuiltInCommandConflictDiagnostics } from "./commands/autocomplete.js";
import { exitCommand } from "./commands/built-ins/exit.js";
import { hotkeysCommand } from "./commands/built-ins/hotkeys.js";
import { applyLoggerConfig, logCommand, printLogFile } from "./commands/built-ins/log.js";
import { loginCommand } from "./commands/built-ins/login.js";
import { logoutCommand } from "./commands/built-ins/logout.js";
import {
  type ModelCommandDependencies,
  modelCommand,
  showModelSelector,
  updateAvailableProviderCount,
} from "./commands/built-ins/model.js";
import { nameCommand } from "./commands/built-ins/name.js";
import { type ReloadDependencies, reloadCommand, runReload } from "./commands/built-ins/reload.js";
import {
  cloneSession,
  compactSession,
  forkSessionAtEntry,
  navigateSessionTree,
  resumeSession,
  type SessionCommandDependencies,
  sessionCommand,
  showSessionSelector,
  showTreeSelector,
  showUserMessageSelector,
  startNewSession,
} from "./commands/built-ins/session.js";
import { settingsCommand } from "./commands/built-ins/settings.js";
import { type RegisteredCommand, registerCommand } from "./commands/types.js";
import {
  formatAppKeyDisplay,
  getUserMessageText,
} from "./display-helpers.js";
import { InteractiveExtensions } from "./extensions/interactive-extensions.js";
import { showLoadedResources } from "./extensions/loaded-resources.js";
import { setupBuiltInHotkeys } from "./hotkeys/built-in.js";
import { ShellComposition } from "./layout/composition.js";

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
  private autocompleteProvider: AutocompleteProvider | undefined;
  private interactiveExtensions: InteractiveExtensions;
  private fdPath: string | undefined;
  private footer: ShellComposition["footer"];
  private footerDataProvider: ShellComposition["footerDataProvider"];
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

  private widgetContainerAbove!: Container;
  private widgetContainerBelow!: Container;

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
    this.runtimeHost.setRebindSession(async () => {
      await this.rebindCurrentSession();
    });
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
    this.interactiveExtensions = new InteractiveExtensions({
      ui: this.ui,
      composition: this.composition,
      state: this.state,
      chatContainer: this.chatContainer,
      widgetContainerAbove: this.widgetContainerAbove,
      widgetContainerBelow: this.widgetContainerBelow,
      footer: this.footer,
      footerDataProvider: this.footerDataProvider,
      defaultEditor: this.defaultEditor,
      keybindings: this.keybindings,
      getSession: () => this.runtimeHost.session,
      getEditor: () => this.editor,
      setEditor: (editor) => {
        this.editor = editor;
      },
      getAutocompleteProvider: () => this.autocompleteProvider,
      setupAutocompleteProvider: () => this.setupAutocompleteProvider(),
      updateTerminalTitle: () => this.updateTerminalTitle(),
      showStatus: (message) => this.showStatus(message),
      showWarning: (message) => this.showWarning(message),
      showError: (message) => this.showError(message),
      setShutdownRequested: (requested) => {
        this.shutdownRequested = requested;
      },
      shutdown: () => this.shutdown(),
      setWorkingMessage: (message) => this.setWorkingMessage(message),
      setWorkingVisible: (visible) => this.setWorkingVisible(visible),
      setWorkingIndicator: (options) => this.setWorkingIndicator(options),
      setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
      getToolsExpanded: () => this.state.shell.$toolOutputExpanded.getState(),
      pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      setEditorText: (text) => this.editor.setText(text),
      getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
      bindCommandContextActions: () => this.createExtensionCommandContextActions(),
      showLoadedResources: () => this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true }),
      showStartupNoticesIfNeeded: () => this.showStartupNoticesIfNeeded(),
    });
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.interactiveExtensions.reset();
    });

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
      commands: this.getBuiltInCommands(),
    });
    let provider = result.provider;
    for (const wrapProvider of this.interactiveExtensions.getAutocompleteWrappers()) {
      provider = wrapProvider(provider);
    }

    this.autocompleteProvider = provider;
    this.defaultEditor.setAutocompleteProvider(provider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(provider);
    }
  }

  private getBuiltInCommands(): ReadonlyArray<RegisteredCommand> {
    return [
      registerCommand(settingsCommand, {
        session: this.runtimeHost.session,
        state: this.state,
        ui: this.ui,
        composition: this.composition,
        chatContainer: this.chatContainer,
        footer: this.footer,
        defaultEditor: this.defaultEditor,
        getEditor: () => this.editor,
        refreshAutocomplete: () => this.setupAutocompleteProvider(),
        rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
        updateEditorBorderColor: () => this.updateEditorBorderColor(),
      }),
      registerCommand(modelCommand, {
        ...this.createModelCommandDependencies(),
      }),
      registerCommand(nameCommand, {
        session: this.runtimeHost.session,
        chatContainer: this.chatContainer,
        ui: this.ui,
      }),
      registerCommand(sessionCommand, {
        ...this.createSessionCommandDependencies(),
      }),
      registerCommand(hotkeysCommand, {
        chatContainer: this.chatContainer,
        extensionRunner: this.runtimeHost.session.extensionRunner,
        keybindings: this.keybindings,
        markdownTheme: this.getMarkdownThemeWithSettings(),
        ui: this.ui,
      }),
      registerCommand(loginCommand, {
        session: this.runtimeHost.session,
        ui: this.ui,
        composition: this.composition,
        footer: this.footer,
        footerDataProvider: this.footerDataProvider,
        state: this.state,
        chatContainer: this.chatContainer,
        getEditor: () => this.editor as Component,
        updateEditorBorderColor: () => this.updateEditorBorderColor(),
      }),
      registerCommand(logoutCommand, {
        session: this.runtimeHost.session,
        ui: this.ui,
        composition: this.composition,
        footer: this.footer,
        footerDataProvider: this.footerDataProvider,
        state: this.state,
        chatContainer: this.chatContainer,
        getEditor: () => this.editor as Component,
        updateEditorBorderColor: () => this.updateEditorBorderColor(),
      }),
      registerCommand(reloadCommand, {
        ...this.createReloadDependencies(),
      }),
      registerCommand(logCommand, {
        session: this.runtimeHost.session,
        chatContainer: this.chatContainer,
        ui: this.ui,
        composition: this.composition,
        getEditor: () => this.editor as Component,
      }),
      registerCommand(exitCommand, { shutdown: () => this.shutdown() }),
    ];
  }

  private createModelCommandDependencies(): ModelCommandDependencies {
    return {
      session: this.runtimeHost.session,
      ui: this.ui,
      composition: this.composition,
      footer: this.footer,
      footerDataProvider: this.footerDataProvider,
      state: this.state,
      chatContainer: this.chatContainer,
      getEditor: () => this.editor as Component,
      updateEditorBorderColor: () => this.updateEditorBorderColor(),
    };
  }

  private createSessionCommandDependencies(): SessionCommandDependencies {
    return {
      session: this.runtimeHost.session,
      runtimeHost: this.runtimeHost,
      chatContainer: this.chatContainer,
      statusContainer: this.statusContainer,
      composition: this.composition,
      ui: this.ui,
      editor: this.editor,
      defaultEditor: this.defaultEditor,
      keybindings: this.keybindings,
      stopLoadingAnimation: () => this.stopLoadingAnimation(),
      renderCurrentSessionState: () => this.renderCurrentSessionState(),
      renderInitialMessages: () => this.renderInitialMessages(),
      showExtensionSelector: (title, options) => this.interactiveExtensions.showSelector(title, options),
      showExtensionEditor: (title, prefill) => this.interactiveExtensions.showEditor(title, prefill),
      promptForMissingSessionCwd: (error) => this.promptForMissingSessionCwd(error),
      handleFatalRuntimeError: (prefix, error) => this.handleFatalRuntimeError(prefix, error),
      flushCompactionQueue: (options) => this.flushCompactionQueue(options),
      shutdown: () => this.shutdown(),
    };
  }

  private createReloadDependencies(): ReloadDependencies {
    return {
      session: this.runtimeHost.session,
      state: this.state,
      ui: this.ui,
      composition: this.composition,
      chatContainer: this.chatContainer,
      keybindings: this.keybindings,
      defaultEditor: this.defaultEditor,
      getEditor: () =>
        this.editor as Component & {
          setPaddingX?(padding: number): void;
          setAutocompleteMaxVisible?(maxVisible: number): void;
        },
      startupContent: this.startupContent,
      resetExtensionUI: () => this.interactiveExtensions.reset(),
      refreshAutocomplete: () => this.setupAutocompleteProvider(),
      setupExtensionShortcuts: () => this.interactiveExtensions.setupShortcuts(this.runtimeHost.session.extensionRunner),
      rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
      showLoadedResources: () => this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true }),
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActions {
    return {
      waitForIdle: () => this.runtimeHost.session.agent.waitForIdle(),
      newSession: async (options) => {
        const result = await startNewSession(this.createSessionCommandDependencies(), options);
        return result ?? { cancelled: false };
      },
      fork: async (entryId, options) => {
        return forkSessionAtEntry(this.createSessionCommandDependencies(), entryId, options);
      },
      navigateTree: async (targetId, options) => {
        return navigateSessionTree(this.createSessionCommandDependencies(), targetId, options);
      },
      switchSession: async (sessionPath, options) => {
        return resumeSession(this.createSessionCommandDependencies(), sessionPath, options);
      },
      reload: async () => {
        await runReload(this.createReloadDependencies());
      },
    };
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

    applyLoggerConfig(this.runtimeHost.session);
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

    this.interactiveExtensions.renderWidgets(); // Initialize with default spacer
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
    await updateAvailableProviderCount(this.createModelCommandDependencies());
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
    showLoadedResources({
      chatContainer: this.chatContainer,
      resourceLoader: this.runtimeHost.session.resourceLoader,
      extensionRunner: this.runtimeHost.session.extensionRunner,
      commands: this.getBuiltInCommands(),
      promptTemplates: this.runtimeHost.session.promptTemplates,
      cwd: this.runtimeHost.session.sessionManager.getCwd(),
      verbose: this.options.verbose ?? false,
      quietStartup: this.runtimeHost.session.settingsManager.getQuietStartup(),
      getStartupExpansionState: () => this.getStartupExpansionState(),
      extensions: options?.extensions,
      force: options?.force,
      showDiagnosticsWhenQuiet: options?.showDiagnosticsWhenQuiet,
    });
  }

  /**
   * Initialize the extension system with TUI-based UI context.
   */
  private async bindCurrentSessionExtensions(): Promise<void> {
    setRegisteredThemes(this.runtimeHost.session.resourceLoader.getThemes().themes);
    await this.interactiveExtensions.bindCurrentSession();
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
    await updateAvailableProviderCount(this.createModelCommandDependencies());
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

  private stopLoadingAnimation(): void {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
  }

  /**
   * Get a registered tool definition by name (for custom rendering).
   */
  private getRegisteredToolDefinition(toolName: string) {
    return this.runtimeHost.session.getToolDefinition(toolName);
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

  private setWorkingMessage(message: string | undefined): void {
    this.state.shell.setWorkingMessage(message);
    if (this.loadingAnimation) {
      this.loadingAnimation.setMessage(message ?? this.defaultWorkingMessage);
    }
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

  private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
    const confirmed = await this.interactiveExtensions.showConfirm(
      "Session cwd not found",
      formatMissingSessionCwdPrompt(error.cwd),
    );
    return confirmed ? process.cwd() : undefined;
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
        showModelSelector: () => showModelSelector(this.createModelCommandDependencies()),
        toggleToolOutputExpansion: () => this.toggleToolOutputExpansion(),
        toggleThinkingBlockVisibility: () => this.toggleThinkingBlockVisibility(),
        openExternalEditor: () => this.openExternalEditor(),
        followUp: () => this.handleFollowUp(),
        dequeue: () => this.handleDequeue(),
        newSession: () => {
          void startNewSession(this.createSessionCommandDependencies());
        },
        showTreeSelector: () => showTreeSelector(this.createSessionCommandDependencies()),
        showUserMessageSelector: () => showUserMessageSelector(this.createSessionCommandDependencies()),
        showSessionSelector: () => showSessionSelector(this.createSessionCommandDependencies()),
        printLogFile: () => printLogFile({ chatContainer: this.chatContainer, ui: this.ui }),
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

      const commandHandled = await dispatchBuiltInCommand(text, this.getBuiltInCommands());
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
    return this.interactiveExtensions.isExtensionCommand(text);
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

  stop(): void {
    this.unregisterSignalHandlers();
    if (this.runtimeHost.session.settingsManager.getShowTerminalProgress()) {
      this.ui.terminal.setProgress(false);
    }
    if (this.loadingAnimation) {
      this.loadingAnimation.stop();
      this.loadingAnimation = undefined;
    }
    this.interactiveExtensions.dispose();
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
