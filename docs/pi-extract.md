# Pi Extraction Plan: Non-Coding CLI

This document analyzes the components of the `pi-mono` repository for extraction into a generic, non-coding AI agent CLI.

## Summary of Dropped Modules
- `packages/pods`: GPU infrastructure management. (Dropped)
- `packages/web-ui`: Web interface components. (Dropped)
- `packages/mom`: Slack bot implementation. (Dropped)
- `packages/coding-agent/src/core/tools/*`: Most tools like `bash.ts`, `edit.ts` are coding-specific. (Dropped)
- `packages/coding-agent/src/core/package-manager.ts`: Node.js specific. (Dropped)

---

## Package: pi-ai (`packages/ai`)
**Overall Status:** High Relevance. This is the foundation for multi-provider LLM support.

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `api-registry.ts` | High | Low | Essential for managing different LLM providers. |
| `types.ts` | High | Low | Defines the core message and model interfaces. |
| `models.ts` / `models.generated.ts` | High | Low | Contains model definitions and pricing. |
| `providers/*` | High | Low | Implementation of various LLM providers (Anthropic, OpenAI, etc.). |
| `stream.ts` | High | Low | Unified streaming logic. |

---

## Package: pi-agent-core (`packages/agent`)
**Overall Status:** High Relevance. This is the stateful agent runtime.

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `agent.ts` | High | Low | Main Agent class. Manages transcript and event loop. Agnostic to tool content. |
| `agent-loop.ts` | High | Low | The actual execution loop. Fully generic. |
| `types.ts` | High | Low | Core agent types. |
| `proxy.ts` | High | Low | Utility for handling tool calls. |

---

## Package: pi-tui (`packages/tui`)
**Overall Status:** High Relevance. Provides the terminal UI framework.

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `tui.ts` | High | Low | Base TUI class and component management. |
| `terminal.ts` | High | Low | Abstraction over TTY. |
| `components/*` | Medium | Low | UI components (Scrollable, Editor, etc.). Mostly reusable. |
| `autocomplete.ts` | Medium | Medium | Useful for CLI interaction. |
| `terminal-image.ts` | Medium | Low | Support for rendering images in terminal (Kitty/iTerm protocol). |

---

## Package: pi-coding-agent (`packages/coding-agent`)
**Overall Status:** Partial Relevance. Requires surgical extraction of session and extension logic.

### Root Files (`src/`)

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `cli.ts` | High | Low | Entry point for the CLI. Reusable with new command name. |
| `config.ts` | High | Low | Configuration schema and defaults. Reusable. |
| `index.ts` | High | Low | Exports core abstractions. Reusable. |
| `main.ts` | High | Medium | Main application logic. Needs decoupling from coding-specific setup. |
| `migrations.ts` | Medium | Low | Database/Session migration logic. Mostly generic. |
| `package-manager-cli.ts` | None | - | **DROPPED.** |
| `utils/` | High | Low | General utilities (sleep, path, logging). Reusable. |

### Core Logic (`src/core`)

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `agent-session.ts` | High | Medium | **Core logic.** Orchestrates session, extensions, and agent. Needs removal of hardcoded bash hooks. |
| `agent-session-runtime.ts` | High | Low | Runtime state for the session. Reusable. |
| `agent-session-services.ts` | High | Low | Service registry for the session. Reusable. |
| `auth-storage.ts` | High | Low | Persists API keys and OAuth tokens. Essential. |
| `bash-executor.ts` | None | - | **DROPPED.** Coding-specific shell execution. |
| `compaction/` | High | Low | Context management via summarization. Reusable. |
| `config.ts` | High | Low | Configuration schema. Needs stripping of coding defaults. |
| `event-bus.ts` | High | Low | Simple pub/sub for session events. Reusable. |
| `extensions/` | High | Low | **Extension Framework.** Crucial for extensibility. |
| `footer-data-provider.ts` | Medium | Low | Provides status info for the TUI footer. Reusable. |
| `keybindings.ts` | Medium | Medium | Defines global shortcuts. Needs removal of coding-specific keys (e.g., Ctrl+B for build). |
| `messages.ts` | High | Low | Custom message types (Bash, Compaction, etc.). Reusable. |
| `model-registry.ts` | High | Low | LLM provider and key management. Essential. |
| `model-resolver.ts` | High | Low | Logic for selecting the best model for a task. Reusable. |
| `package-manager.ts` | None | - | **DROPPED.** Node.js specific logic. |
| `prompt-templates.ts` | High | Low | Logic for expanding templates in prompts. Reusable. |
| `resource-loader.ts` | High | Low | Loads prompts, skills, and themes from disk. Reusable. |
| `session-manager.ts` | High | Low | Persistence and branching logic. Reusable. |
| `settings-manager.ts` | High | Low | User preference management. Reusable. |
| `skills.ts` | High | Low | Skill document loading logic. Reusable. |
| `slash-commands.ts` | High | Low | Framework for `/command` handling. Reusable. |
| `system-prompt.ts` | Medium | Medium | Needs refactoring to remove coding-specific personas. |
| `tools/` | Partial | Medium | Keep framework, drop specific coding tools (`bash`, `edit`, etc.). |

### UI Components (`src/modes/interactive/components`)

| File | Relevance | Effort | Analysis |
|------|-----------|--------|----------|
| `assistant-message.ts` | High | Low | Renders LLM responses. Reusable. |
| `user-message.ts` | High | Low | Renders user input. Reusable. |
| `footer.ts` | High | Low | Status bar. Reusable. |
| `model-selector.ts` | High | Low | Modal for choosing LLMs. Reusable. |
| `session-selector.ts` | High | Low | Modal for switching sessions. Reusable. |
| `settings-selector.ts` | High | Low | Modal for changing preferences. Reusable. |
| `bash-execution.ts` | None | - | **DROPPED.** |
| `diff.ts` | None | - | **DROPPED.** |
| `tool-execution.ts` | High | Low | Renders tool call status. Reusable. |
| `tree-selector.ts` | Medium | Low | File tree browser. Useful for generic file agents. |
| `login-dialog.ts` | High | Low | OAuth/API key entry. Reusable. |

---

## Refactor Roadmap

1. **Decouple `AgentSession`**: Remove hard dependencies on `bash.ts` and `BashExecutor`. Use the extension system to register tools instead of hardcoding them in the core.
2. **Generic System Prompt**: Create a `BaseSystemPrompt` that focuses on general assistant capabilities, allowing users to extend it via "Skills".
3. **Cleanse `InteractiveMode`**: Remove coding-specific UI components (like the code editor or diff view) from the main TUI loop.
4. **Modular Tools**: Refactor `core/tools/index.ts` to allow dynamic registration of tools from extensions, moving all "coding" tools to a separate optional package/extension.
5. **Agnostic Keybindings**: Move coding-specific shortcuts to an optional "Coding Extension".
