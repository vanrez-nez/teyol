import type { AgentMessage } from "#agent/index.js";
import type { AssistantMessage } from "#ai/index.js";
import type { AgentSession, AgentSessionEvent } from "#shell/runtime/agent-session.js";
import { parseSkillBlock } from "#shell/runtime/agent-session.js";
import type { SessionContext } from "#shell/runtime/session-manager.js";
import type { ToolDefinition } from "#shell/runtime/extensions/types.js";
import type { Component, Container, EditorComponent, MarkdownTheme, TUI } from "#tui/index.js";
import { Spacer, Text, TruncatedText } from "#tui/index.js";
import { APP_NAME } from "../../config.js";
import { theme } from "../theme/theme.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { formatAppKeyDisplay } from "./display-helpers.js";
import { keyText } from "./components/keybinding-hints.js";
import { LogoBlock } from "./components/timeline/logo-block.js";
import { StartupBlock } from "./components/timeline/startup-block.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import type { ShellLayoutComponent } from "./layout.js";
import type { CliState } from "./state/index.js";
import { getUserMessageText } from "./display-helpers.js";

interface Expandable {
  setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
  return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export interface TimelineDependencies {
  ui: TUI;
  chatContainer: Container;
  pendingMessagesContainer: Container;
  statusContainer: Container;
  state: CliState;
  footer: ShellLayoutComponent["footer"];
  getSession(): AgentSession;
  getEditor(): EditorComponent;
  getMarkdownTheme(): MarkdownTheme;
  getRegisteredToolDefinition(toolName: string): ToolDefinition<any, any> | undefined;
  updateEditorBorderColor(): void;
}

export interface StartupContentOptions {
  versionLine: string;
  expandedInstructions: string;
  compactInstructions: string;
  compactOnboarding: string;
  onboarding: string;
  expanded: boolean;
}

export class Timeline {
  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private streamingMessage: AssistantMessage | undefined = undefined;
  private pendingTools = new Map<string, ToolExecutionComponent>();
  private lastStatusSpacer: Spacer | undefined = undefined;
  private lastStatusText: Text | undefined = undefined;
  private startupContent: Component | undefined = undefined;

  constructor(private readonly dependencies: TimelineDependencies) {}

  getStartupContent(): Component | undefined {
    return this.startupContent;
  }

  renderStartupContent(options: StartupContentOptions | undefined): void {
    if (!options) {
      this.startupContent = undefined;
      return;
    }

    this.startupContent = new StartupBlock({
      expandedInstructions: options.expandedInstructions,
      compactInstructions: options.compactInstructions,
      compactOnboarding: options.compactOnboarding,
      onboarding: options.onboarding,
      expanded: options.expanded,
      padding: { left: 1 },
    });

    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new LogoBlock({ versionLine: options.versionLine, padding: { bottom: 1 } }));
    this.dependencies.chatContainer.addChild(this.startupContent);
    this.dependencies.chatContainer.addChild(new Spacer(1));
  }

  clear(): void {
    this.dependencies.chatContainer.clear();
    this.dependencies.pendingMessagesContainer.clear();
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();
    this.lastStatusSpacer = undefined;
    this.lastStatusText = undefined;
  }

  clearStatus(): void {
    this.dependencies.statusContainer.clear();
  }

  addStatusComponent(component: Component): void {
    this.dependencies.statusContainer.addChild(component);
  }

  showStatus(message: string): void {
    const { chatContainer, ui } = this.dependencies;
    const children = chatContainer.children;
    const last = children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

    if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
      this.lastStatusText.setText(theme.fg("dim", message));
      ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", message), 1, 0);
    chatContainer.addChild(spacer);
    chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
    this.dependencies.ui.requestRender();
  }

  showRawError(errorMessage: string): void {
    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new Text(theme.fg("error", errorMessage), 1, 0));
    this.dependencies.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
    this.dependencies.ui.requestRender();
  }

  showNewVersionNotification(newVersion: string): void {
    const action = theme.fg("accent", `${APP_NAME} update`);
    const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;

    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.dependencies.chatContainer.addChild(
      new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`, 1, 0),
    );
    this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.dependencies.ui.requestRender();
  }

  showPackageUpdateNotification(packages: string[]): void {
    const action = theme.fg("accent", `${APP_NAME} update`);
    const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.dependencies.chatContainer.addChild(new Spacer(1));
    this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.dependencies.chatContainer.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.dependencies.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.dependencies.ui.requestRender();
  }

  addMessage(message: AgentMessage, options?: { populateHistory?: boolean }): void {
    const { chatContainer, state } = this.dependencies;
    switch (message.role) {
      case "custom": {
        if (message.display) {
          const renderer = this.dependencies.getSession().extensionRunner.getMessageRenderer(message.customType);
          const component = new CustomMessageComponent(message, renderer, this.dependencies.getMarkdownTheme());
          component.setExpanded(state.shell.$toolOutputExpanded.getState());
          chatContainer.addChild(component);
        }
        break;
      }
      case "compactionSummary": {
        chatContainer.addChild(new Spacer(1));
        const component = new CompactionSummaryMessageComponent(message, this.dependencies.getMarkdownTheme());
        component.setExpanded(state.shell.$toolOutputExpanded.getState());
        chatContainer.addChild(component);
        break;
      }
      case "user": {
        const textContent = getUserMessageText(message);
        if (textContent) {
          if (chatContainer.children.length > 0) {
            chatContainer.addChild(new Spacer(1));
          }
          const skillBlock = parseSkillBlock(textContent);
          if (skillBlock) {
            const component = new SkillInvocationMessageComponent(skillBlock, this.dependencies.getMarkdownTheme());
            component.setExpanded(state.shell.$toolOutputExpanded.getState());
            chatContainer.addChild(component);
            if (skillBlock.userMessage) {
              chatContainer.addChild(new UserMessageComponent(skillBlock.userMessage, this.dependencies.getMarkdownTheme()));
            }
          } else {
            chatContainer.addChild(new UserMessageComponent(textContent, this.dependencies.getMarkdownTheme()));
          }
          if (options?.populateHistory) {
            this.dependencies.getEditor().addToHistory?.(textContent);
          }
        }
        break;
      }
      case "assistant": {
        chatContainer.addChild(
          new AssistantMessageComponent(
            message,
            state.shell.$hideThinkingBlock.getState(),
            this.dependencies.getMarkdownTheme(),
            state.shell.$hiddenThinkingLabel.getState(),
          ),
        );
        break;
      }
      case "toolResult":
      case "branchSummary":
        break;
      default: {
        const _exhaustive: never = message;
        void _exhaustive;
      }
    }
  }

  renderSessionContext(
    sessionContext: SessionContext,
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    this.pendingTools.clear();

    if (options.updateFooter) {
      this.dependencies.footer.invalidate();
      this.dependencies.updateEditorBorderColor();
    }

    for (const message of sessionContext.messages) {
      if (message.role === "assistant") {
        this.addMessage(message);
        for (const content of message.content) {
          if (content.type === "toolCall") {
            const component = this.createToolComponent(content.name, content.id, content.arguments);
            this.dependencies.chatContainer.addChild(component);

            if (message.stopReason === "aborted" || message.stopReason === "error") {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.dependencies.getSession().retryAttempt;
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
        const component = this.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.pendingTools.delete(message.toolCallId);
        }
      } else {
        this.addMessage(message, options);
      }
    }

    this.pendingTools.clear();
    this.dependencies.ui.requestRender();
  }

  renderInitialMessages(): void {
    const context = this.dependencies.getSession().sessionManager.buildSessionContext();
    this.renderSessionContext(context, {
      updateFooter: true,
      populateHistory: true,
    });

    const allEntries = this.dependencies.getSession().sessionManager.getEntries();
    const compactionCount = allEntries.filter((entry) => entry.type === "compaction").length;
    if (compactionCount > 0) {
      const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }
  }

  rebuildFromMessages(): void {
    this.dependencies.chatContainer.clear();
    const context = this.dependencies.getSession().sessionManager.buildSessionContext();
    this.renderSessionContext(context);
  }

  startAssistantMessage(message: AssistantMessage): void {
    this.streamingComponent = new AssistantMessageComponent(
      undefined,
      this.dependencies.state.shell.$hideThinkingBlock.getState(),
      this.dependencies.getMarkdownTheme(),
      this.dependencies.state.shell.$hiddenThinkingLabel.getState(),
    );
    this.streamingMessage = message;
    this.dependencies.chatContainer.addChild(this.streamingComponent);
    this.streamingComponent.updateContent(this.streamingMessage);
    this.dependencies.ui.requestRender();
  }

  updateAssistantMessage(message: AssistantMessage): void {
    if (!this.streamingComponent) {
      return;
    }

    this.streamingMessage = message;
    this.streamingComponent.updateContent(this.streamingMessage);

    for (const content of this.streamingMessage.content) {
      if (content.type === "toolCall") {
        const existing = this.pendingTools.get(content.id);
        if (!existing) {
          const component = this.createToolComponent(content.name, content.id, content.arguments);
          this.dependencies.chatContainer.addChild(component);
          this.pendingTools.set(content.id, component);
        } else {
          existing.updateArgs(content.arguments);
        }
      }
    }
    this.dependencies.ui.requestRender();
  }

  finishAssistantMessage(message: AssistantMessage): void {
    if (!this.streamingComponent) {
      return;
    }

    this.streamingMessage = message;
    let errorMessage: string | undefined;
    if (this.streamingMessage.stopReason === "aborted") {
      const retryAttempt = this.dependencies.getSession().retryAttempt;
      errorMessage =
        retryAttempt > 0 ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}` : "Operation aborted";
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
      for (const [, component] of this.pendingTools.entries()) {
        component.setArgsComplete();
      }
    }
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.dependencies.footer.invalidate();
    this.dependencies.ui.requestRender();
  }

  removeStreamingAssistant(): void {
    if (this.streamingComponent) {
      this.dependencies.chatContainer.removeChild(this.streamingComponent);
      this.streamingComponent = undefined;
      this.streamingMessage = undefined;
    }
  }

  clearPendingTools(): void {
    this.pendingTools.clear();
  }

  startToolExecution(event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>): void {
    let component = this.pendingTools.get(event.toolCallId);
    if (!component) {
      component = this.createToolComponent(event.toolName, event.toolCallId, event.args);
      this.dependencies.chatContainer.addChild(component);
      this.pendingTools.set(event.toolCallId, component);
    }
    component.markExecutionStarted();
    this.dependencies.ui.requestRender();
  }

  updateToolExecution(event: Extract<AgentSessionEvent, { type: "tool_execution_update" }>): void {
    const component = this.pendingTools.get(event.toolCallId);
    if (component) {
      component.updateResult({ ...event.partialResult, isError: false }, true);
      this.dependencies.ui.requestRender();
    }
  }

  finishToolExecution(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): void {
    const component = this.pendingTools.get(event.toolCallId);
    if (component) {
      component.updateResult({ ...event.result, isError: event.isError });
      this.pendingTools.delete(event.toolCallId);
      this.dependencies.ui.requestRender();
    }
  }

  updatePendingMessagesDisplay(messages: { steering: string[]; followUp: string[] }): void {
    this.dependencies.pendingMessagesContainer.clear();
    if (messages.steering.length > 0 || messages.followUp.length > 0) {
      this.dependencies.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of messages.steering) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of messages.followUp) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = formatAppKeyDisplay(keyText("app.message.dequeue"));
      const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
      this.dependencies.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  setHiddenThinkingLabel(label?: string): void {
    this.dependencies.state.shell.setHiddenThinkingLabel(label);
    for (const child of this.dependencies.chatContainer.children) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.dependencies.state.shell.$hiddenThinkingLabel.getState());
      }
    }
    if (this.streamingComponent) {
      this.streamingComponent.setHiddenThinkingLabel(this.dependencies.state.shell.$hiddenThinkingLabel.getState());
    }
    this.dependencies.ui.requestRender();
  }

  setToolsExpanded(expanded: boolean): void {
    this.dependencies.state.shell.setToolsExpanded(expanded);
    if (isExpandable(this.startupContent)) {
      this.startupContent.setExpanded(expanded);
    }
    for (const child of this.dependencies.chatContainer.children) {
      if (isExpandable(child)) {
        child.setExpanded(expanded);
      }
    }
    this.dependencies.ui.requestRender();
  }

  rebuildForThinkingVisibility(): void {
    this.dependencies.chatContainer.clear();
    this.rebuildFromMessages();

    if (this.streamingComponent && this.streamingMessage) {
      this.streamingComponent.setHideThinkingBlock(this.dependencies.state.shell.$hideThinkingBlock.getState());
      this.streamingComponent.updateContent(this.streamingMessage);
      this.dependencies.chatContainer.addChild(this.streamingComponent);
    }
  }

  private createToolComponent(toolName: string, toolCallId: string, args: unknown): ToolExecutionComponent {
    const session = this.dependencies.getSession();
    const component = new ToolExecutionComponent(
      toolName,
      toolCallId,
      args,
      {
        showImages: session.settingsManager.getShowImages(),
        imageWidthCells: session.settingsManager.getImageWidthCells(),
      },
      this.dependencies.getRegisteredToolDefinition(toolName),
      this.dependencies.ui,
      session.sessionManager.getCwd(),
    );
    component.setExpanded(this.dependencies.state.shell.$toolOutputExpanded.getState());
    return component;
  }
}
