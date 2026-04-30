# Task 02: Extract Agent Runtime (pi-agent-core)

## Goal
Extract the stateful agent runtime and event loop from `pi-mono` and integrate it into `src/agent`.

## Source Path
`external/pi-mono/packages/agent/src`

## Target Path
`src/agent`

## Files to Extract
- `agent.ts`: Stateful `Agent` class.
- `agent-loop.ts`: Low-level execution loop and tool calling logic.
- `types.ts`: Agent-specific types (Events, State, Tools).
- `proxy.ts`: Tool call proxy utilities.

## Integration Steps
1. **Copy Files**: Transfer files to `src/agent`.
2. **Path Mapping**: Update imports that previously pointed to `@mariozechner/pi-ai` to point to `../ai`.
3. **Internal Consistency**: Ensure the `Agent` class uses the extracted `src/ai` types and streaming functions.

## Agnostic Adaptation
- **Tool Logic**: The runtime is agnostic to tool content. However, we must ensure it doesn't assume any specific coding tools are present by default.
- **Steering/Follow-up**: Maintain these queues as they are highly useful for any complex agent interaction, regardless of the domain.
