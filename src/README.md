# Web application (`src/`)

Browser UI for the Audio Visualizer. Built with **Vite** and plain **TypeScript** (no React).

## Files

| File | Purpose |
|------|---------|
| `main.ts` | Loads WAV, runs SPL/Leq analysis, fills graph dropdown, handles upload. |
| `chart.ts` | Draws the level-vs-time line chart on `<canvas>`. |
| `style.css` | Dark layout for header, controls, chart panel, loading overlay. |

## Flow

1. `main.ts` creates `Wav`, `SPL`, and `Leq` from `../audio analysis/`.
2. Default file: `/test_1kHz.wav` from `public/`.
3. All 12 graph traces (9 SPL + 3 Leq) are computed once after load.
4. User picks a trace from the dropdown; `SplChart.draw()` renders it.

## Related docs

- [Project README](../README.md) — concepts and npm scripts
- [Audio analysis API](../audio%20analysis/README.md) — library reference
