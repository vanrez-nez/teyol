# Task 04: Extract Session & Extensions (pi-coding-agent core)

## Goal
Extract the core session management, extension framework, and persistence logic into `src/session` and `src/extensions`.

## Source Path
`external/pi-mono/packages/coding-agent/src/core`

## Target Paths
- `src/session`: Session and state management.
- `src/extensions`: Extension framework.

## Files to Extract
- `agent-session.ts`: Main session orchestrator. **Requires Refactoring.**
- `session-manager.ts`: Persistence and branching.
- `settings-manager.ts`: User preferences.
- `model-registry.ts`: API keys and provider management.
- `extensions/`: The entire extension framework (`loader.ts`, `runner.ts`, `types.ts`).
- `compaction/`: Context summarization logic.
- `skills.ts`: Skill loading logic.
- `prompt-templates.ts`: Template expansion.

## Refactor Requirements
1. **Remove Coding Dependencies**: 
    - Strip `agent-session.ts` of hardcoded references to `bash-executor`, `package-manager`, and specific coding tools.
    - Remove the `installAgentToolHooks` logic that assumes the presence of a file-system-based bash environment.
2. **Generic Extension Hook**: Ensure the extension runner is the *primary* way tools are registered. The core should provide zero tools by default, or only a minimal set (e.g., `read` for file access).
3. **Internal Imports**: Update all imports to point to the new `src/ai`, `src/agent`, and `src/tui` directories.

## Dropped Files
- `bash-executor.ts`
- `package-manager.ts`
- `core/tools/*` (except generic ones like `read.ts` or `ls.ts` if desired).
