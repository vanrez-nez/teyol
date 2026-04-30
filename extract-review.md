# Generic LLM CLI Extraction Review

## Current State

The repository has been ported into a single TypeScript CLI package named `ai-cli` with binary name `ai`. The extracted subsystems are present under `src/`:

- `src/ai`: multi-provider model registry, provider adapters, streaming, OAuth helpers, and model metadata.
- `src/agent`: generic stateful agent runtime, queueing, event stream, and tool-call execution loop.
- `src/tui`: terminal UI framework and reusable components.
- `src/session`: session persistence, settings, model resolution, compaction, resources, skills, prompt templates, and SDK construction.
- `src/extensions`: extension loading, registered tools, commands, flags, providers, UI hooks, and event hooks.
- `src/cli`: interactive, print, JSON, and RPC modes.

The port is intended to be a generic LLM CLI, not a bundled coding agent. The default runtime should provide chat, sessions, model selection, compaction, skills, prompt templates, themes, and extension support. Tools are provided by extensions or SDK custom tools.

## Decisions

- The product name is `ai`, package name is `ai-cli`, and config directory is `.ai-cli`.
- The default CLI ships with zero app-owned built-in tools.
- Extension and SDK custom tools are the primary tool mechanism.
- `--no-tools` disables all registered tools.
- `--tools a,b` is an allowlist over registered extension/custom/base override tools.
- `baseToolsOverride` remains available for SDK hosts that want app-owned base tools.
- The default system prompt is generic and only mentions tools that are actually registered with prompt snippets.
- Package/resource loading remains in scope for extensions, skills, prompts, and themes.
- `AI_OFFLINE` is the preferred offline environment variable. `PI_OFFLINE` remains a compatibility alias.
- `@ai-cli` is the preferred extension import alias. `@pi-mono` remains a temporary compatibility alias.

## Completed Cleanup

- Replaced the default coding-oriented system prompt with a generic assistant prompt.
- Removed hardcoded default active tools from the core session runtime.
- Updated CLI help to stop advertising unsupported update/config commands and non-existent built-in tools.
- Wired parsed extension flags into runtime service creation.
- Added parse diagnostic reporting before session startup.
- Rebranded core config fallbacks to `ai-cli`/`ai`/`.ai-cli`.
- Removed `/share` from built-in slash command discovery and interactive dispatch.
- Rebranded stale extension context messages and key user-facing comments.
- Updated offline checks to prefer `AI_OFFLINE`.
- Retained compatibility aliases only where they avoid breaking existing extension/resource setups.
- Added `npm run smoke` with repeatable checks for CLI help, unknown flags, zero-tool defaults, extension tool activation, allowlists, and generic prompt content.

## Task Breakdown for Follow-Up Work

### Task 1: Finish Branding Audit

Goal: ensure the generic CLI has no stale user-facing `pi` or coding-agent branding.

Instructions:

1. Search user-facing files first:
   - `src/cli`
   - `src/session`
   - `src/extensions`
   - `theme`
   - `package.json`
2. Use this command:

   ```bash
   rg -n "pi|pi-mono|coding agent|coding assistant|share\\.pi|@pi-mono|PI_OFFLINE" src package.json theme
   ```

3. Classify every hit as one of:
   - Compatibility alias that should remain temporarily.
   - Upstream provider behavior that should not be changed.
   - Historical docs/test text.
   - Stale generic CLI wording that must be changed.
4. For each stale CLI hit:
   - Replace `pi` with `ai`, `AI CLI`, or `assistant` as appropriate.
   - Replace “coding agent” with “AI CLI” or “assistant”.
   - Replace hardcoded URLs with either generic URLs or no link.
5. Do not modify provider prompts that belong to provider-specific APIs unless they are injected by the generic CLI itself.

Acceptance criteria:

- `node dist/cli/main.js --help` contains only generic branding.
- No interactive command/help/status text claims this is a coding agent.
- Remaining `@pi-mono` and `PI_OFFLINE` references are documented compatibility aliases.

### Task 2: Formalize Tool Registry Tests

Goal: convert the smoke checks into repeatable tests.

Instructions:

1. Add a test script under a suitable location, for example `scripts/smoke.mjs` or `test/smoke.mjs`.
2. Test zero-tool default:
   - Create `AuthStorage`, `ModelRegistry`, `SettingsManager`, and `SessionManager.inMemory()`.
   - Call `createAgentSession()` with no extensions and no custom tools.
   - Assert `session.getActiveToolNames()` is `[]`.
3. Test extension tool activation:
   - Create a `DefaultResourceLoader` with one inline `extensionFactory`.
   - Register a TypeBox-backed tool named `echo`.
   - Reload the resource loader.
   - Create a session using that loader.
   - Assert `session.getActiveToolNames()` is `["echo"]`.
4. Test `--no-tools` behavior at the session level:
   - Use the same extension tool setup.
   - Create a session with `noTools: "all"`.
   - Assert no active tools.
5. Test allowlist behavior:
   - Register two tools.
   - Create a session with `tools: ["one"]`.
   - Assert only `one` is active.
6. Dispose every created session.
7. Use temp paths under `/tmp` for auth/models/settings files so tests do not affect user config.

Acceptance criteria:

- The smoke script exits nonzero on failure.
- The script does not require provider auth or network.
- The script is wired into `package.json`, for example `"smoke": "npm run build && node scripts/smoke.mjs"`.

### Task 3: Formalize Prompt Tests

Goal: make the generic prompt contract explicit.

Instructions:

1. Add prompt checks to the smoke script or a separate test file.
2. For `buildSystemPrompt({ cwd, selectedTools: [] })`, assert:
   - It includes `Available tools:\n(none)`.
   - It includes the current working directory.
   - It does not include `coding assistant`, `coding agent`, `bash`, `edit`, `write`, or `pi`.
3. For a fake registered tool snippet:
   - Call `buildSystemPrompt({ cwd, selectedTools: ["echo"], toolSnippets: { echo: "Echo input text" } })`.
   - Assert it includes `echo`.
   - Assert it does not include unregistered tool names.
4. For custom prompt behavior:
   - Pass `customPrompt`.
   - Assert context files and skills are appended consistently.

Acceptance criteria:

- Prompt tests cover zero-tool and one-tool states.
- Prompt tests fail if coding-agent wording returns.

### Task 4: Finish CLI Diagnostics Coverage

Goal: ensure argument parsing and extension flags behave predictably.

Instructions:

1. Add CLI smoke assertions for:
   - `node dist/cli/main.js --help` exits 0.
   - `node dist/cli/main.js -z` exits nonzero and prints `Unknown option`.
   - `node dist/cli/main.js --fake-extension-flag --list-models` exits nonzero when no extension registers that flag.
2. Add an extension flag fixture:
   - Load an extension that registers a boolean flag.
   - Run a mode that initializes services without provider calls.
   - Assert the flag is accepted.
3. Keep stdout/stderr assertions loose enough to avoid terminal-color brittleness.

Acceptance criteria:

- Unknown short flags fail before session work.
- Unknown extension flags fail after extension discovery.
- Known extension flags are accepted.

### Task 5: Review Interactive-Only Surfaces

Goal: remove hidden stale coding affordances from interactive mode.

Instructions:

1. Audit `src/cli/interactive-mode.ts` for commands and help text.
2. Confirm `/share` is absent from:
   - `BUILTIN_SLASH_COMMANDS`
   - interactive dispatch
   - slash command autocomplete
   - user help screens
3. If `handleShareCommand()` remains unused:
   - Either delete it, or leave a comment that it is intentionally disabled pending generic sharing design.
   - Preferred final state is deletion to avoid accidental reactivation.
4. Audit hotkeys:
   - No `!` or `!!` shell shortcuts should be advertised by default.
   - Shell behavior should come from extensions if needed.
5. Audit session tree tool formatting:
   - Hardcoded handling of `read`, `write`, `edit`, `grep`, `find`, and `ls` should be generic or renderer-driven.
   - Default fallback should render arbitrary tool name plus concise JSON args.

Acceptance criteria:

- Interactive hotkeys screen is generic.
- Slash command list is generic.
- Tool-call rendering works for unknown extension tools.

### Task 6: Resource Package Scope Review

Goal: keep resource packages useful without implying a coding-only workflow.

Instructions:

1. Keep npm/git/local package loading unless product direction changes.
2. Rename user-facing settings/help from “package manager” to “resource packages” where appropriate.
3. Add a generic context filename such as `AI.md` or `ASSISTANT.md` to `loadContextFileFromDir()`.
4. Keep `AGENTS.md` and `CLAUDE.md` as compatibility filenames.
5. Confirm package loading honors:
   - project resources before user resources,
   - explicit CLI resources,
   - extension-provided resource paths,
   - `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-themes`.

Acceptance criteria:

- Generic context files are supported.
- Existing compatibility context files still load.
- Resource package UI does not describe the app as a coding agent.

### Task 7: Extension API Migration Notes

Goal: make extension compatibility explicit.

Instructions:

1. Document `@ai-cli` as the preferred extension import alias.
2. Document `@pi-mono` as deprecated compatibility, if it remains.
3. Confirm TypeBox aliases still work:
   - `typebox`
   - `typebox/compiler`
   - `typebox/value`
   - `@sinclair/typebox`
4. Confirm extensions can register:
   - tools,
   - commands,
   - flags,
   - message renderers,
   - providers,
   - UI widgets/hooks.
5. Avoid renaming public extension event names unless a migration plan is added.

Acceptance criteria:

- Existing extensions can migrate by changing import alias only.
- New extensions can use `@ai-cli`.
- Deprecated aliases are easy to find and remove later.

### Task 8: Release Readiness Checklist

Goal: define the final go/no-go checks before publishing or tagging.

Instructions:

1. Run all verification commands below.
2. Run manual smoke:
   - Start interactive mode.
   - Open model selector.
   - Open settings.
   - Open hotkeys.
   - Start a new session.
   - Resume a session.
   - Export a session.
3. Test print mode with no API key and confirm the error is clear.
4. Test print mode with a real provider only after local tests pass.
5. Inspect generated `dist` only through build output; do not manually edit it.

Acceptance criteria:

- Build and smoke scripts pass.
- Manual interactive flow does not show coding-agent wording.
- No default tool can mutate files or execute shell commands.

## Remaining Review Tasks

- Audit package/resource manager UI labels for any remaining project-specific language.
- Decide whether `@pi-mono` compatibility should be removed before a public release.
- Decide whether `PI_OFFLINE` compatibility should be removed before a public release.
- Convert the smoke script into formal unit tests if the project later adopts a test runner.

## Acceptance Criteria

- A fresh session without extensions exposes no active tools.
- A session with one extension tool exposes that tool by default.
- Help output does not advertise unsupported commands or bundled coding tools.
- The default system prompt makes no claims about file mutation, shell execution, or coding.
- `npm run build` succeeds.
- `npx tsc --noEmit` succeeds.
- `node dist/cli/main.js --help` exits 0.

## Verification Commands

```bash
npx tsc --noEmit
npm run build
node dist/cli/main.js --help
node dist/cli/main.js --list-models
rg -n "coding agent|coding assistant|Run bash|bash mode|share\\.pi|Built-in Tool" src package.json theme
```

The broader terms `pi`, `@pi-mono`, `PI_OFFLINE`, and provider-specific coding prompts may still appear as compatibility aliases or upstream provider behavior. Treat those as follow-up cleanup only when they are user-facing in this generic CLI.

## Deferred Work

- Bundled coding tools are intentionally out of scope for v1.
- Default shell execution is intentionally out of scope for v1.
- Default file mutation is intentionally out of scope for v1.
- Provider network calls should not be required for smoke tests.
