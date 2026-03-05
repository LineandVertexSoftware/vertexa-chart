# Vertexa Chart Roadmap

Last updated: March 5, 2026

## Platform requirements

Vertexa Chart is **WebGPU-only**. There is no WebGL or Canvas2D fallback for rendering. The library throws at initialization if WebGPU is unavailable.

Minimum browser support:

| Browser | Minimum version |
|---|---|
| Chrome / Chromium | 113+ |
| Edge | 113+ |
| Firefox | 141+ |
| Safari | 18+ (macOS 15 / iOS 18) |

Other requirements: Node.js 20+, ES modules only (`"type": "module"`).

## Versioning and release milestones

| Phase | Sprints | Target version |
|---|---|---|
| Phase 0 — Foundations | 1 | 0.x (pre-release) |
| Phase 1 — Core parity | 2–3 | 1.0.0 |
| Phase 2 — Financial + distribution traces | 4–5 | 1.1.0 |
| Phase 3 — Motion and storytelling | 6–7 | 1.2.0 |
| Near-term backlog items | TBD | 1.x patch/minor |

## Compatibility and semver policy

- The library follows [Semantic Versioning](https://semver.org).
- The public API surface is defined by `Chart.ts` and the renderer's `RendererInit`, `FrameState`, `MarkerLayerInput`, and `LineLayerInput` types. Breaking changes to these require a major version bump.
- Internal rendering interfaces (`WebGPURenderer`, WGSL shaders, `SceneCompiler`) are not considered public API and may change in minor releases.
- Experimental APIs gated behind feature flags do not carry semver stability guarantees until the flag is removed.

## Planning assumptions

- Team capacity: 2 engineers + 1 part-time reviewer/QA.
- Timeline unit: 2-week sprints.
- Goal: maximize parity and adoption while protecting stability/performance.

## Guiding priorities

1. Protect interaction and rendering correctness first.
2. Prioritize features that unlock broad chart classes (time series + finance + uncertainty).
3. Build extensible trace/axis primitives before adding many new trace types.

## Already implemented baseline (not backlog)

- Visual regression harness already exists with snapshot scenarios in `apps/demo/test/visual-regression.mjs`.
- Interaction stack already includes zoom/pan, legend toggle, box/lasso selection, and related events.
- Export API already supports layer/background controls (`includePlot`, `includeGrid`, `includeOverlay`, `background`).
- Tooltip system already supports formatter/renderer hooks; current `hovertemplate` tokens are escaped.
- Renderer already includes LOD-based decimation (`enableLOD`, `lodThreshold`).
- Four WGSL shader programs ship today: `scatter`, `line`, `scatter_hover`, `scatter_pick`.
- GPU picking is implemented for scatter/marker layers via a 5×5 offscreen `rgba8unorm` render target. Line layers currently use CPU-side spatial index picking only.

## Phase 0 (Sprint 1): Foundations and guardrails

- Expand existing visual-regression coverage from 3 demo scenarios to include multi-trace interaction cases and key trace families.
- Add explicit XSS regression tests for tooltip renderer paths and extended `hovertemplate` token parsing.
- Add feature flags for experimental APIs (`frames`, new traces) to limit rollout risk. Document graduation criteria for each flag.
- Establish a performance benchmark baseline (CPU-side `performance.now()` around `queue.submit()`) to anchor the render-time release gate. Evaluate WebGPU timestamp queries for GPU-side profiling.

Why now: upcoming features touch core rendering and interaction contracts. Baseline tests and a measurable performance baseline should land before major surface area expands.

## Phase 1 (Sprints 2–3): Core parity blockers (P0/P1)

1. Secondary Y-axis (`yaxis2`) [P0]
2. Persistent interaction state (`uirevision`-style) [P1]
3. Hover/template v2 (`customdata`, `meta`, `text`) [P1]
4. Range slider + range selector [P1]
5. Error bars (`error_x`, `error_y`) [P1] — requires a new WGSL shader for capped vertical/horizontal line segments; GPU pick coverage for error bar geometry is also needed.

Sequencing rationale:
- `yaxis2` affects axis model, picking, and overlay contracts; other features build on that structure.
- `uirevision` should land before slider/selector to avoid interaction reset bugs.
- Hover v2 and error bars both need schema and tooltip plumbing; shared work lowers total cost.

## Phase 2 (Sprints 4–5): Financial + distribution traces (P2, high adoption)

Each trace type below requires at least one new WGSL shader program in addition to schema and tooltip work.

1. Candlestick/OHLC [P2] — filled rect (candle body) + wick lines; needs a new bar/rect shader.
2. Box trace [P2] — quartile boxes + whiskers + outlier points; needs rect fill shader (shared with candlestick where possible).
3. Violin trace [P2] — filled distribution curves; needs a polygon/area fill shader.

Sequencing rationale:
- Candlestick is high-value for finance users and shares time-axis work with existing line traces.
- Box should precede violin because quartile/outlier machinery can feed violin overlays and hover summaries.
- The rect/fill shader introduced for candlestick should be designed for reuse by box and future bar traces.

## Phase 3 (Sprints 6–7): Motion and storytelling

1. Animation frames API [P2] — design prerequisite: agree on GPU buffer management strategy (pre-allocated pools, ring-buffer extension, or shader-side interpolation) before implementation begins. This decision affects render loop semantics.
2. Playback controls in demo/docs.
3. Performance safeguards (frame throttling, interpolation policy, cancel-in-flight).

Sequencing rationale:
- Frames touch `setTraces`/render loop semantics; best after `uirevision` and additional trace types stabilize.

## Dependency notes

- `yaxis2` should include per-trace axis binding for all relevant trace types, including future candlestick/error bars.
- Hover v2 should define token grammar once (parser utility) and be reused by all traces.
- Error bars should have GPU pick coverage consistent with scatter layers; CPU fallback is acceptable short-term.
- `uirevision` should gate not only zoom but also legend visibility and selection mode state.
- New WGSL shaders added in Phases 1–2 should follow the existing uniform layout conventions and be covered by visual regression scenarios before shipping.

## Backlog

### Near-term additions (recommended)

- `[P1]` Unified hover/crosshair mode (`hovermode: "x unified"`-style): major usability improvement for dense time series.
- `[P1]` Tick density + auto-formatter improvements: prevents axis label overlap in zoomed and mobile views.
- `[P1]` Mobile gesture support hardening (pinch zoom inertia, two-finger pan): needed for production dashboards.
- `[P1]` User-facing decimation/downsampling controls for large streams (internal LOD exists, but API controls do not).
- `[P1]` GPU pick coverage for line layers (currently CPU-only via spatial index).

### Mid-term additions

- `[P2]` Subplots/faceting (shared x-axis): biggest structural unlock after multi-axis. Requires a multi-viewport or scissor-rect management strategy on the GPU side; the current renderer uses a single scissor rect per chart.
- `[P2]` Built-in linked-chart sync helpers (today this is manual via `onZoom`/`onSelect` callbacks).
- `[P2]` Plugin hooks for custom trace renderers/tooltips: ecosystem leverage.
- `[P2]` Export presets/profiles (transparent, print, presentation) on top of existing export toggles.

### Accessibility (a11y)

Accessibility is not in the active roadmap but should not be deferred indefinitely. Key areas to address before a 2.0 milestone:

- Keyboard navigation for chart interactions (zoom, pan, legend toggle).
- Screen reader support via ARIA roles and live region announcements for hover/selection events.
- High-contrast and reduced-motion modes.

Adding a11y to an existing GPU-rendered canvas is significantly harder than building it in from the start. An Epic F should be scoped before the 2.0 planning cycle.

### Out of scope (current planning horizon)

- WebGL or Canvas2D rendering fallback.
- Server-side rendering (SSR) of GPU traces.
- 3D trace types.

## Suggested issue epics

- Epic A: Axis and layout evolution (`yaxis2`, tick engine, subplot prep)
- Epic B: Interaction continuity (`uirevision`, slider/selector, unified hover)
- Epic C: Trace parity (`error bars`, `candlestick`, `box`, `violin`) — includes new WGSL shader work per trace
- Epic D: Motion and storytelling (`frames`, playback controls) — includes GPU buffer strategy design
- Epic E: Reliability (`security tests`, visual regression, performance benchmarks, GPU pick coverage)

## Release gates per phase

- No >5% regression in average render time versus the Phase 0 benchmark baseline (measured CPU-side around `queue.submit()`).
- No tooltip XSS regressions (explicit automated tests).
- Hover/click/select correctness preserved across all visible trace types.
- New WGSL shaders covered by at least one visual regression scenario before shipping.
- Docs + demo scenario added for each net-new public API surface.
