# Vertexa Chart 1.0 Roadmap

Last updated: August 23, 2026

## Release assessment

Current state:

- WebGPU renderer with marker, line, hover, and GPU pick pipelines
- D3 overlay for axes, grid, legend, zoom/pan, hover guides, and box/lasso selection
- Five implemented trace families: scatter, bar, area, heatmap, histogram
- Runtime APIs for updates, exports, sizing, performance tuning, and programmatic navigation
- Unit tests across renderer, overlay, interactions, data mutation, histogram logic, DOM mounting, and toolbar behavior
- A demo app plus a small visual snapshot harness

The code is close to a stable release, but a few checks still need to be boring
and repeatable before tagging `1.0.0`.

## What exists today

| Area | Status | Notes |
|---|---|---|
| Platform | Ready | WebGPU-only, ESM-only, Node `>=20`, published as `@lineandvertexsoftware/vertexa-chart`. |
| Rendering core | Ready | WebGPU marker + line pipelines, hover highlight, frame capture for export, LOD for marker-heavy scenes. |
| Trace types | Ready | `scatter`, `bar`, `area`, `heatmap`, `histogram`. |
| Axes | Ready | `linear`, `log`, `time`, and `category` axes; secondary y-axis (`yaxis2`) with per-trace binding. |
| Layout and styling | Ready | Title, grid, legend, annotations, margins, theme, high-contrast theme defaults. |
| Interaction | Ready | Zoom, pan, hover (`closest`, `x`, `y`, `none`), click, legend toggle, box select, lasso select, fit-to-data, autoscale-y, aspect lock. |
| Programmatic API | Ready | `setTraces`, `appendPoints`, `setLayout`, `setSize`, `panBy`, `zoomBy`, `setViewTransform`, `setInteractionRenderMode`, `resetView`, `fitToData`, `autoscaleY`, `setAspectLock`, `setPerformanceMode`, `setXRange`, `getPerformanceStats`, `destroy`. |
| Streaming/data mutation | Partial | `appendPoints()` works for x/y traces plus hover `text` and `customdata`; fast GPU append path is limited to unsmoothed scatter traces when domains do not change. |
| Export and UI | Ready | PNG, SVG, CSV export; optional built-in toolbar with export and fullscreen controls. |
| Accessibility | Partial | Keyboard navigation, ARIA labels, live tooltip region, high-contrast mode are present; richer screen-reader behavior is not. |
| Testing | Partial | Good unit coverage, plus visual regression across 9 deterministic demo scenarios. |
| Multi-chart workflows | Partial | Demo proves linked charts can be built from callbacks, but there is no built-in sync helper API. |

## Important gaps and risks

Remaining items that should be settled before `1.0.0`.

### 1. Missing common “core charting” features

- ~~No secondary y-axis (`yaxis2`) or per-trace axis binding~~ (shipped in 0.1.12)
- ~~No persistent interaction state (`uirevision`-style behavior) when traces/layout are reset~~ (shipped)
- ~~No built-in range slider or range selector~~ (shipped in 0.1.13)
- No subplots/faceting support

Not every missing chart feature belongs in 1.0. The remaining question is which
ones are part of the supported dashboard baseline and which ones move to 1.1.

### 2. A few correctness and contract issues still need tightening

- ~~`setLayout()` currently replaces the layout object; the top-level README describes it as a merge-style API~~ (fixed and covered by tests)
- ~~`tooltip.renderer` string output is written through `innerHTML`, so the safety contract is currently “trusted HTML only,” but that is not clearly documented or tested~~ (documented and covered by tests)
- ~~Scatter traces with `mode: "lines"` appear to be non-pickable/non-selectable~~ (fixed for CPU picking and covered by tests)
- ~~Broader hover/click/select regression coverage is still needed across all implemented trace families~~ (covered by tests)
- ~~CPU/GPU picking fallback behavior still needs a clearer tested contract~~ (documented and covered by tests)

The fixed items above are now covered by tests or docs so they do not turn into
post-1.0 behavior changes.

### 3. The quality gate is still too thin for a stable major

- ~~Visual regression currently covers only `getting-started`, `axis-grid`, and `events-api`~~ (expanded to 9 deterministic scenarios)
- Broad visual coverage now includes dedicated scatter, bar, area, heatmap, and histogram routes plus toolbar, legend, and selected-state UI
- Mobile/touch expectations are documented and the D3 touch zoom surface is smoke-tested; deeper device QA is still pending
- Performance claims are plausible, and the demo benchmark now has automated threshold checks

## Required before 1.0

### P0: Must ship before `1.0.0`

1. Lock the public contract
- ~~Decide the supported public API surface and document it in one place~~ (`PUBLIC_CONTRACT.md`)
- ~~Align README/API docs with actual behavior~~ (public contract linked from package docs)
- ~~Explicitly document WebGPU-only support and supported browser expectations~~ (`README.md` and `PUBLIC_CONTRACT.md`)

2. Close correctness gaps in the current feature set
- ~~Fix or explicitly disallow unsupported picking cases, especially line-only scatter traces~~ (fixed and covered by tests)
- ~~Add regression tests for hover/click/select across all implemented trace families~~ (covered)
- ~~Define and test the CPU/GPU picking fallback behavior~~ (documented and covered)

3. Add the missing “core dashboard” features
- ~~Secondary y-axis (`yaxis2`)~~ (shipped in 0.1.12)
- ~~Per-trace axis binding~~ (shipped in 0.1.12)
- ~~Persistent interaction state across `setTraces()` / `setLayout()` updates~~ (shipped)

4. Harden tooltip and export behavior
- ~~Either sanitize custom tooltip HTML or document `tooltip.renderer` as trusted HTML only~~ (documented as trusted HTML)
- ~~Add dedicated regression tests for PNG, SVG, and CSV export on mixed-layer charts~~ (covered, including export option flags and toolbar downloads)

5. Raise the release bar
- Expand visual regression coverage to bar, area, heatmap, histogram, toolbar, legend, and selection states
- ~~Define and automate a simple performance baseline and acceptable threshold~~ (`pnpm bench:demo:check`)
- ~~Treat `build`, `typecheck`, `test`, and `pack:check` as the minimum release gate~~ (`pnpm release:check`)

### P1: Good candidates if 1.0 targets dashboard/product teams

- ~~Range slider + range selector~~ (shipped in 0.1.13)
- Unified hover / shared crosshair mode for dense time series
- Mobile gesture hardening beyond documented pan/pinch zoom
- User-facing decimation or downsampling controls

These are useful for real dashboard adoption, but they can also land after 1.0
if the public contract stays honest about what is supported.

### Not required for 1.0

Useful later, but not required for the first stable API:

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
- ~~Fix line-only picking/select behavior or formally mark it unsupported~~ (fixed for CPU picking)
- ~~Add tests for tooltip security contract and export behavior~~ (covered)
- ~~Expand visual coverage beyond the current 3 snapshot scenarios~~ (expanded to 7 deterministic scenarios)

### Phase 2: 1.0 blockers

Target: `1.0.0`

- ~~Add `yaxis2` and per-trace axis binding~~ (shipped in 0.1.12)
- ~~Add interaction-state persistence across layout/data updates~~ (shipped)
- Tighten interaction correctness across all existing trace types
- ~~Publish a clean “supported features” matrix~~ (`PUBLIC_CONTRACT.md`)

### Phase 3: Release candidate

Target: `1.0.0-rc`

- ~~Run Node 22/24 package release gate in CI~~ (`.github/workflows/ci.yml`)
- Run full local gate before publishing
- ~~Verify package contents and install flow~~ (`pnpm pack:install-check`)
- ~~Add one demo example per major supported trace family / workflow~~ (scatter, bar, area, heatmap, histogram, runtime events, and multi-chart workflows)
- ~~Freeze semver expectations for the public runtime API~~ (`PUBLIC_CONTRACT.md`)

### Phase 4: Post-1.0 expansion

Target: `1.1.x` and later

- ~~Range controls~~ (shipped in 0.1.13)
- Unified hover
- Error bars
- Financial traces
- Distribution traces
- Subplots and animation

## 1.0 definition of done

Tag `1.0.0` when all of the following are true:

- The README describes the product that actually ships today
- All currently advertised trace types and interactions behave correctly under test
- There are no known unsupported “normal use” paths in the implemented feature set
- ~~Secondary-axis~~ (done) and ~~state-persistence workflows~~ (done) exist
- Release checks pass cleanly
- The team is willing to preserve the documented API under semver

## Short path to 1.0

1. Harden the features already present
2. ~~Add secondary-axis~~ (done) and ~~state-persistence support~~ (done)
3. Tighten docs, tests, and release guarantees until the public contract is stable
