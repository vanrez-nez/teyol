# Task 03: Extract TUI Framework (pi-tui)

## Goal
Extract the Terminal User Interface library and integrate it into `src/tui`.

## Source Path
`external/pi-mono/packages/tui/src`

## Target Path
`src/tui`

## Files to Extract
- `tui.ts`: Main TUI controller and component management.
- `terminal.ts`: Low-level terminal I/O.
- `keys.ts`: Key definition and matching logic.
- `components/`: Generic UI components (Bordered container, Scrollable, etc.).
- `utils.ts`: Terminal string utilities (visible width, column slicing).
- `terminal-image.ts`: Image rendering support.
- `autocomplete.ts`: Generic autocomplete engine.

## Integration Steps
1. **Copy Files**: Transfer files to `src/tui`.
2. **Generic Components**: Identify and move base components that were previously in `coding-agent` but are generic enough for the TUI library (e.g., standard dialogs).
3. **Dependency Check**: Ensure `chalk` and other terminal-related dependencies are available in the root.

## Agnostic Adaptation
- **Differential Rendering**: This core pattern remains unchanged.
- **Overlays**: Maintain the overlay stack as it allows for modal interactions (settings, model selection) in the non-coding CLI.
