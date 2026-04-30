# Pi Project Analysis

A monorepo for building AI agents and managing LLM deployments, primarily focused on an interactive coding agent.

## Folder Structure

| Path | Description |
|------|-------------|
| `packages/ai` | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.). |
| `packages/agent` | Core agent runtime with tool calling and state management. |
| `packages/coding-agent` | Interactive coding agent CLI, session management, and extensions. |
| `packages/tui` | Terminal User Interface library with differential rendering and overlay support. |
| `packages/mom` | Slack bot that delegates messages to the pi coding agent. |
| `packages/web-ui` | Web components for AI chat interfaces. |
| `packages/pods` | CLI for managing vLLM deployments on GPU pods (e.g., RunPod). |
| `.pi` | Project-specific configuration, extensions, prompts, and npm/git helpers. |

---

## Core Abstractions & Patterns

### 1. pi-ai (Unified LLM API)

#### Classes & Types
- **`Model`**: Interface representing an LLM, including its provider, API type, costs, and capabilities (reasoning, image input).
- **`Message`**: Unified message structure with roles: `user`, `assistant`, and `toolResult`.
- **`Context`**: Encapsulates the conversation state (system prompt, messages, and available tools).
- **`AssistantMessageEventStream`**: An event-driven stream protocol for real-time assistant responses (text deltas, thinking deltas, tool call deltas).
- **`StreamFunction`**: A standard interface for provider implementations to handle streaming requests.

#### Patterns
- **Provider Registry**: A centralized registry (`api-registry.ts`) where different LLM providers (OpenAI, Anthropic, etc.) are registered and looked up by API type.
- **Lazy Loading**: Providers are loaded on-demand (`register-builtins.ts`) to minimize initial startup time and dependencies.
- **Unified Streaming**: All providers emit a standardized set of events (`text_delta`, `thinking_delta`, `toolcall_end`), allowing the consumer to be provider-agnostic.

### 2. pi-agent-core (Agent Runtime)

#### Classes & Types
- **`Agent`**: A stateful wrapper around the low-level loop. It manages the message transcript, event listeners, and message queues.
- **`AgentLoop`**: The core execution engine that coordinates the conversation with the LLM, processes tool calls, and handles retries.
- **`AgentState`**: Represents the current runtime state, including active tools, model, and the message history.
- **`AgentTool`**: A tool definition that includes the execution logic (handler) and the parameter schema.

#### Patterns
- **Steering & Follow-up**: Specialized message queues. **Steering** injects messages immediately after the current turn, while **Follow-up** runs messages after the agent would otherwise stop.
- **Event-Driven Lifecycle**: The agent emits events at every stage (`agent_start`, `turn_start`, `tool_execution_start`, etc.), which listeners can subscribe to for logging, UI updates, or side effects.
- **Parallel Tool Execution**: Support for executing multiple tool calls in parallel or sequence based on model output.

### 3. pi-coding-agent (The "Pi" CLI)

#### Classes & Types
- **`AgentSession`**: The primary orchestrator. It manages the lifecycle of a coding session, integrating the agent runtime with persistence, bash execution, and extensions.
- **`SessionManager`**: Handles session persistence (loading/saving to disk), branching (forking sessions), and history.
- **`ExtensionRunner`**: A plugin system that allows external code to hook into agent events, register new tools, or modify the system prompt.
- **`BashExecutor`**: Manages the execution of shell commands, capturing stdout/stderr and handling long-running processes.
- **`Compaction`**: A strategy for managing large context windows by summarizing or "compacting" older parts of the conversation.

#### Patterns
- **Extension System**: Uses a "capabilities" approach where extensions can register for specific hooks (e.g., `onBeforeToolCall`, `onMessageEnd`).
- **Slash Commands**: A pattern for user-driven actions (e.g., `/compact`, `/session`, `/fork`) implemented outside the LLM loop.
- **Prompt Templating**: Dynamic system prompt construction using templates and resource loaders.

### 4. pi-tui (Terminal UI)

#### Classes & Types
- **`TUI`**: The main controller for the terminal interface. It manages a tree of components and coordinates rendering.
- **`Component`**: A base interface for UI elements. Components are responsible for their own rendering based on a given width.
- **`Terminal`**: An abstraction over the raw terminal (tty), handling escape sequences, cursor movement, and input raw mode.
- **`Overlay`**: A modal system for rendering components (like dropdowns or dialogs) on top of the main content.

#### Patterns
- **Differential Rendering**: TUI compares the current frame with the previous one and only sends the necessary escape sequences to update changed lines, reducing flicker.
- **Overlay Stack**: Manages a stack of modal components with their own focus and input handling, allowing for complex nested UIs.
- **Hardware Cursor Positioning**: Specific support for positioning the real terminal cursor to support IME (Input Method Editor) windows for international users.

### 5. pi-pods (GPU Infrastructure)

#### Patterns
- **Remote Model Management**: Patterns for starting/stopping vLLM instances on remote GPU pods via SSH.
- **SSH Streaming**: Tunnelling logs and command output from remote pods to the local CLI.
