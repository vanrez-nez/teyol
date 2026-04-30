# Task 05: Refactor CLI Entry & Interactive Mode

## Goal
Extract and refactor the main CLI entry point and the interactive TUI loop into `src/cli`.

## Source Path
`external/pi-mono/packages/coding-agent/src/modes/interactive`
`external/pi-mono/packages/coding-agent/src/main.ts`

## Target Path
`src/cli`

## Files to Extract
- `interactive-mode.ts`: The main TUI loop. **Requires Heavy Refactoring.**
- `main.ts`: Application bootstrap.
- `cli.ts`: Argument parsing.
- `components/`: Reusable UI components for the interactive mode.

## Refactor Requirements
1. **Interactive Mode Cleansing**:
    - Remove coding-specific keybindings (e.g., build, run, diff).
    - Remove UI components like the Diff viewer or Bash output blocks.
    - Focus on a clean chat interface with support for tool call status and thinking blocks.
2. **Generic Persona**:
    - Refactor `system-prompt.ts` (to be moved to `src/session`) to use a generic assistant persona instead of a "Coding Agent".
3. **App Bootstrap**:
    - Update `main.ts` to initialize the `AgentSession` with a generic toolset and the new extension loader.
4. **Binary Name**:
    - Plan for a new binary name (e.g., `ai-cli` or just `pi`) that reflects its new non-coding purpose.

## Integration Steps
1. **Component Selection**: Only copy generic UI components from `src/modes/interactive/components`.
2. **Main Loop Refactor**: Simplify the `doRender` logic in `interactive-mode.ts` to handle generic message types and tool results.
3. **Keybinding Update**: Reset the `keybindings.ts` to a minimal set of navigation and session management shortcuts.
