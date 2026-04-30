# Task 01: Extract AI Layer (pi-ai)

## Goal
Extract the unified LLM provider API from `pi-mono` and integrate it into `src/ai`.

## Source Path
`external/pi-mono/packages/ai/src`

## Target Path
`src/ai`

## Files to Extract
- `api-registry.ts`: Provider management.
- `types.ts`: Core interfaces for Models, Messages, and Context.
- `models.ts` & `models.generated.ts`: Model definitions and metadata.
- `stream.ts`: Unified streaming logic.
- `providers/`: All provider implementations (Anthropic, OpenAI, Gemini, etc.).
- `utils/`: Core utilities like `event-stream.ts`.

## Integration Steps
1. **Copy Files**: Transfer all listed files to `src/ai`.
2. **Import Refactoring**: Replace all `@mariozechner/pi-ai` imports with local relative paths or a centralized internal alias.
3. **Dependency Check**: Ensure `typebox` and other necessary peer dependencies are added to the root `package.json`.
4. **Validation**: Verify that `registerBuiltInApiProviders()` successfully initializes the registry with available providers.

## Agnostic Adaptation
- The AI layer is already highly decoupled. No significant changes are needed to the core logic.
- Ensure any `process.env` lookups for API keys are consistent with the new CLI's configuration strategy.
