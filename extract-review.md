# Akah Extract Review

## Current State

Akah is a generic, non-coding LLM CLI. The active product identity is:

- Package: `akah`
- Binary: `akah`
- Config directory: `.akah`
- User agent/config environment prefix: `AKAH_`
- Built-in model providers: `ollama` and `openrouter`

The CLI keeps the shared session/runtime, model registry, prompt templates, themes, skills, extensions, compaction, and interactive terminal UI. Coding-agent-specific defaults, provider adapters, compatibility aliases, and old package names have been removed from the built-in runtime.

## Provider Surface

Built-in providers are intentionally small:

- `ollama` uses the OpenAI-compatible chat completions endpoint at `http://127.0.0.1:11434/v1`.
- `openrouter` uses the OpenAI-compatible chat completions endpoint at `https://openrouter.ai/api/v1`.
- `OPENROUTER_API_KEY` is the canonical hosted-provider key.
- `OLLAMA_API_KEY` is recognized for custom Ollama setups, but local Ollama works without a real key.

Removed built-in provider adapters:

- Anthropic
- Amazon Bedrock
- Azure OpenAI Responses
- Cloudflare Workers AI
- Google Gemini
- Gemini CLI
- Google Vertex
- GitHub Copilot
- Mistral
- OpenAI Responses
- OpenAI Codex Responses

Custom providers remain possible through the generic model/provider registration path, but removed providers are no longer bundled, registered, or advertised as built-ins.

## Branding and Paths

Canonical paths and environment variables:

- `~/.akah/agent`
- project `.akah`
- `AKAH_AGENT_DIR`
- `AKAH_OFFLINE`
- `AKAH_CACHE_RETENTION`
- `AKAH_CLEAR_ON_SHRINK`
- `AKAH_HARDWARE_CURSOR`
- `AKAH_TIMING`
- `AKAH_TELEMETRY`
- `AKAH_TUI_WRITE_LOG`
- `AKAH_DEBUG_REDRAW`
- `AKAH_TUI_DEBUG`

Extension package manifests now use the `akah` package field. Extension virtual imports expose `@akah`.

## Verification Checklist

Run these checks before treating the port as clean:

```sh
npx tsc --noEmit
npm run build
node dist/cli/main.js --help
node dist/cli/main.js --list-models
npm run smoke
```

Expected model list behavior:

- Built-in providers are limited to `ollama` and `openrouter`.
- Removed provider names do not appear as built-in providers.

Residue checks:

```sh
rg -n "pi|pi-mono|ai-cli|PI_|AI_OFFLINE|@pi-mono|@ai-cli|coding agent|coding assistant" src package.json scripts theme
rg -n "anthropic|bedrock|gemini|vertex|mistral|copilot|cloudflare|azure|openai-codex|openai-responses" src package.json
```

Remaining matches must either be ordinary words, OpenRouter model IDs, supported OpenAI-compatible protocol names, or explicitly intentional documentation.

## Follow-Up Review Points

- Decide whether historical extraction docs under `docs/` should be rewritten, archived, or removed before release.
- Review extension API naming in third-party examples, if any examples are added later.
- Consider dynamic Ollama model discovery in a future pass; current built-ins are static defaults.
