# Task 00: Setup Project Pipeline

## Goal
Initialize the workspace with a unified integration pipeline, including `package.json`, `tsconfig.json`, and build scripts for the new single monorepo structure.

## Target Path
Root directory (`ɑkɑh/`)

## 1. Package Configuration (`package.json`)
Create a root `package.json` that includes all necessary dependencies for the extracted modules.

### Key Dependencies to Include:
- **LLM/AI**: `@sinclair/typebox`, `eventsource`, `undici`.
- **TUI/CLI**: `chalk`, `get-east-asian-width`, `node-pty` (if needed for terminal features).
- **Development**: `typescript`, `@types/node`, `@biomejs/biome` (for linting/formatting).

### Key Scripts:
- `build`: Run `tsc` to compile the entire `src/` directory.
- `start`: Run the compiled entry point (e.g., `node dist/cli/main.js`).
- `dev`: Use `tsx` or `ts-node` to run the CLI directly from source for rapid testing.
- `check`: Run biome for linting and type checking.

## 2. TypeScript Configuration (`tsconfig.json`)
Setup a single `tsconfig.json` that treats `src/` as the root of the project.

### Configuration Details:
- `target`: `ES2022`
- `module`: `NodeNext` (to support ESM and proper imports)
- `baseUrl`: `./`
- `paths`: Map internal modules for cleaner imports:
  - `@ai/*`: `["src/ai/*"]`
  - `@agent/*`: `["src/agent/*"]`
  - `@tui/*`: `["src/tui/*"]`
  - `@session/*`: `["src/session/*"]`
  - `@cli/*`: `["src/cli/*"]`

## 3. Directory Initialization
Ensure the following directory structure exists:
```text
src/
├── ai/
├── agent/
├── tui/
├── session/
├── extensions/
└── cli/
```

## 4. Environment & Tools
- **`.gitignore`**: Ensure `node_modules`, `dist`, and `.env` are ignored.
- **`biome.json`**: Adopt the `pi-mono` linting and formatting rules for consistency.
- **`.env.example`**: Create a template for API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.).
