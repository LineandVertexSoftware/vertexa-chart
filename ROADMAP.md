# Vertexa Chart 1.0 Roadmap

Last updated: April 5, 2026

## Release assessment

Vertexa Chart already has a credible beta-level foundation:

- WebGPU renderer with marker, line, hover, and GPU pick pipelines
- D3 overlay for axes, grid, legend, zoom/pan, hover guides, and box/lasso selection
- Five implemented trace families: scatter, bar, area, heatmap, histogram
- Runtime APIs for updates, exports, sizing, performance tuning, and programmatic navigation
- Unit tests across renderer, overlay, interactions, data mutation, histogram logic, DOM mounting, and toolbar behavior
- A demo app plus a small visual snapshot harness

I would not call the current codebase a 1.0 yet. It looks closer to a strong `0.x` / public beta release: the core is real, but a few common product expectations are still missing and the hardening bar is not high enough for a stable major release.

## What exists today

| Area | Status | Notes |
|---|---|---|
| Platform | Ready | WebGPU-only, ESM-only, Node `>=20`, published as `@lineandvertexsoftware/vertexa-chart`. |
| Rendering core | Ready | WebGPU marker + line pipelines, hover highlight, frame capture for export, LOD for marker-heavy scenes. |
| Trace types | Ready | `scatter`, `bar`, `area`, `heatmap`, `histogram`. |
| Axes | Ready | `linear`, `log`, `time`, and `category` axes; secondary y-axis (`yaxis2`) with per-trace binding. |
| Layout and styling | Ready | Title, grid, legend, annotations, margins, theme, high-contrast theme defaults. |
| Interaction | Ready | Zoom, pan, hover (`closest`, `x`, `y`, `none`), click, legend toggle, box select, lasso select, fit-to-data, autoscale-y, aspect lock. |
| Programmatic API | Ready | `setTraces`, `appendPoints`, `setLayout`, `setSize`, `panBy`, `zoomBy`, `resetView`, `fitToData`, `autoscaleY`, `setAspectLock`, `setPerformanceMode`, `getPerformanceStats`, `destroy`. |
| Streaming/data mutation | Partial | `appendPoints()` works for x/y traces; fast GPU append path is limited to unsmoothed scatter traces when domains do not change. |
| Export and UI | Ready | PNG, SVG, CSV export; optional built-in toolbar with export and fullscreen controls. |
| Accessibility | Partial | Keyboard navigation, ARIA labels, live tooltip region, high-contrast mode are present; richer screen-reader behavior is not. |
| Testing | Partial | Good unit coverage, but visual regression only covers 3 demo scenarios. |
| Multi-chart workflows | Partial | Demo proves linked charts can be built from callbacks, but there is no built-in sync helper API. |

## Important gaps and risks

These are the main reasons I would hold back a `1.0.0` tag.

### 1. Missing common “core charting” features

- ~~No secondary y-axis (`yaxis2`) or per-trace axis binding~~ (shipped in 0.1.12)
- No persistent interaction state (`uirevision`-style behavior) when traces/layout are reset
- No built-in range slider or range selector
- No subplots/faceting support

Not every missing feature must be in 1.0, but interaction-state persistence is common enough that it materially affects whether the library feels “major-version complete.”

### 2. A few correctness and contract issues still need tightening

- `setLayout()` currently replaces the layout object; the top-level README describes it as a merge-style API
- `tooltip.renderer` string output is written through `innerHTML`, so the safety contract is currently “trusted HTML only,” but that is not clearly documented or tested
- Inference from the current `SceneCompiler` and `PickingEngine`: scatter traces with `mode: "lines"` appear to be non-pickable/non-selectable because picking structures are built from marker layers, not line layers

These are the kinds of gaps that create churn after 1.0 because they force either behavior changes or documentation walk-backs.

### 3. The quality gate is still too thin for a stable major

- Visual regression currently covers only `getting-started`, `axis-grid`, and `events-api`
- There is no broad regression matrix for grouped/stacked bars, area fills, heatmap hover, histogram export, toolbar states, or selection overlays
- Mobile/touch behavior largely depends on D3 defaults and is not explicitly hardened
- Performance claims are plausible, but there is no release baseline or threshold documented in the repo

## What I would require before calling this 1.0

### P0: Must ship before `1.0.0`

1. Lock the public contract
- Decide the supported public API surface and document it in one place
- Align README/API docs with actual behavior
- Explicitly document WebGPU-only support and supported browser expectations

2. Close correctness gaps in the current feature set
- Fix or explicitly disallow unsupported picking cases, especially line-only scatter traces
- Add regression tests for hover/click/select across all implemented trace families
- Define and test the CPU/GPU picking fallback behavior

3. Add the missing “core dashboard” features
- ~~Secondary y-axis (`yaxis2`)~~ (shipped in 0.1.12)
- ~~Per-trace axis binding~~ (shipped in 0.1.12)
- Persistent interaction state across `setTraces()` / `setLayout()` updates

4. Harden tooltip and export behavior
- Either sanitize custom tooltip HTML or document `tooltip.renderer` as trusted HTML only
- Add dedicated regression tests for PNG, SVG, and CSV export on mixed-layer charts

5. Raise the release bar
- Expand visual regression coverage to bar, area, heatmap, histogram, toolbar, legend, and selection states
- Define a simple performance baseline and acceptable regression threshold
- Treat `build`, `typecheck`, `test`, and `pack:check` as the minimum release gate

### P1: Strong candidates for 1.0 if the target user is dashboard/product teams

- Range slider + range selector
- Unified hover / shared crosshair mode for dense time series
- Mobile gesture hardening
- User-facing decimation or downsampling controls

These are the first features I would pull forward if the goal is “replace incumbent charting libs in real dashboards,” not just “ship a solid chart engine.”

### Not required for 1.0

These are valuable, but I would treat them as `1.1+` work:

- Error bars
- Candlestick / OHLC
- Box / violin traces
- Animation frames / playback
- Subplots
- Plugin hooks
- WebGL or Canvas fallback

## Recommended roadmap

### Phase 1: Hardening pass

Target: immediate next milestone

- Audit docs against implementation and remove contradictions
- Fix line-only picking/select behavior or formally mark it unsupported
- Add tests for tooltip security contract and export behavior
- Expand visual coverage beyond the current 3 snapshot scenarios

### Phase 2: 1.0 blockers

Target: `1.0.0`

- ~~Add `yaxis2` and per-trace axis binding~~ (shipped in 0.1.12)
- Add interaction-state persistence across layout/data updates
- Tighten interaction correctness across all existing trace types
- Publish a clean “supported features” matrix

### Phase 3: Release candidate

Target: `1.0.0-rc`

- Run full release check in CI and locally
- Verify package contents and install flow
- Add one demo example per major supported trace family / workflow
- Freeze semver expectations for the public runtime API

### Phase 4: Post-1.0 expansion

Target: `1.1.x` and later

- Range controls
- Unified hover
- Error bars
- Financial traces
- Distribution traces
- Subplots and animation

## Suggested 1.0 definition of done

Call the project `1.0` when all of the following are true:

- The README describes the product that actually ships today
- All currently advertised trace types and interactions behave correctly under test
- There are no known unsupported “normal use” paths in the implemented feature set
- ~~Secondary-axis~~ (done) and state-persistence workflows exist
- Release checks pass cleanly
- The team is willing to preserve the documented API under semver

## Bottom line

The codebase is already beyond a toy or prototype. It has enough substance to justify a public beta today.

The shortest honest path to `1.0` is not “add lots more trace types.” It is:

1. Harden the features already present
2. ~~Add secondary-axis~~ (done) and state-persistence support
3. Tighten docs, tests, and release guarantees until the public contract is stable
