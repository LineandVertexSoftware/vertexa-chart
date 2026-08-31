# Public Contract

This is the API and behavior Vertexa Chart intends to support for the `1.0`
line.

## Packages

### `@lineandvertexsoftware/vertexa-chart`

Primary package. Public runtime export:

- `Chart`

Public type exports come from `packages/vertexa-chart/src/index.ts`: chart
options, traces, layout, events, themes, toolbar options, export options, and
performance stats.

### `@lineandvertexsoftware/overlay-d3`

Advanced package for direct D3 overlay usage. Public runtime export:

- `OverlayD3`

The exported overlay option and event types are public. The package is lower
level than `@lineandvertexsoftware/vertexa-chart` and exposes D3-specific
behavior.

### `@lineandvertexsoftware/renderer-webgpu`

Advanced package for direct WebGPU rendering usage. Public runtime export:

- `WebGPURenderer`

The exported renderer input and stats types are public. Most applications should
use the `Chart` API instead.

## Runtime Environment

- Packages are ESM-only.
- Browser usage requires WebGPU.
- Supported release checks run on Node 22 or Node 24 LTS with `pnpm@9.12.0`.
- Package engines are `node >=20`, but Node 26 is not a release-check target
  while the current `c8` dependency path trips Node 26 ESM loading behavior.

## Chart Constructor

```ts
new Chart(target: string | HTMLElement, options: ChartOptions)
```

`target` may be a selector or an `HTMLElement`. The chart owns the DOM it mounts
inside that target until `destroy()` is called.

## Chart Instance API

Supported `Chart` instance methods:

| Method | Contract |
|---|---|
| `setTraces(traces)` | Replace all traces and redraw. |
| `appendPoints(updates, options?)` | Append scatter data incrementally, with optional sliding-window trimming. |
| `setLayout(layout)` | Shallow-merge layout patches and redraw. Nested layout objects are shallow-merged; `annotations` replaces the previous array. |
| `setSize(width, height)` | Resize the chart viewport in CSS pixels and redraw. |
| `panBy(dxCss, dyCss)` | Pan the visible plot by CSS-pixel deltas. |
| `zoomBy(factor, centerPlot?)` | Zoom around an optional plot-local CSS-pixel center. |
| `setViewTransform(transform, options?)` | Apply an exact `{ k, x, y }` zoom/pan transform. |
| `setInteractionRenderMode(mode)` | Set zoom/pan redraw behavior: `"immediate"` or `"next-frame"`. |
| `resetView()` | Reset zoom and pan to the default view. |
| `fitToData()` | Recompute data domains and reset the view. |
| `autoscaleY()` | Recompute the y-domain for the visible x-range. |
| `setAspectLock(enabled)` | Enable or disable equal-unit aspect locking. |
| `setPerformanceMode(mode)` | Set renderer mode to `"quality"`, `"balanced"`, or `"max-fps"`. |
| `getPerformanceStats()` | Return the latest render, GPU render, picking, frame, and sampled-point stats. |
| `setXRange(x0, x1)` | Set the visible x-range using values compatible with the x-axis type. |
| `exportPng(options?)` | Return a PNG `Blob` for the current view. |
| `exportSvg(options?)` | Return an SVG `Blob` for the current view. |
| `exportCsvPoints(options?)` | Return a CSV `Blob` of chart points. |
| `destroy()` | Release GPU and DOM resources. Safe to call more than once. |

Internal fields, private methods, generated `dist` paths, DOM class names, and
renderer/overlay internals are not part of the public `Chart` contract.

## Supported Data And Layout

- Data values are `number`, `Date`, or `string`.
- Axis types are `"linear"`, `"log"`, `"time"`, and `"category"`.
- Primary `y` and secondary `y2` axes are supported.
- Per-trace `yaxis: "y" | "y2"` binding is supported.
- `layout.uirevision` preserves the visible zoom/pan window across trace and
  layout updates while unchanged.
- `layout.rangeSlider` and `layout.rangeSelector` control the visible x-range
  and stay synchronized with pan/zoom.

## Supported Trace Families

| Trace | Supported shape |
|---|---|
| `scatter` | Markers, lines, or lines plus markers. Dashed and Catmull-Rom smoothed lines are supported. |
| `bar` | Vertical bars with grouping, stacking, overlay mode, custom width, and base value. |
| `area` | Filled area with optional boundary line and markers. |
| `heatmap` | Rectangular `z` matrix with optional color scale and z-domain. |
| `histogram` | Vertical or horizontal bins with count, sum, avg, percent, probability, and density modes. |

Candlestick, OHLC, box, violin, subplots, animation frames, and error bars are
outside the `1.0` contract.

## Interaction Contract

- Mouse wheel zoom and drag pan are handled by the plot overlay.
- Touch devices support one-finger pan and two-finger pinch zoom in the plot
  area.
- Hover is pointer-hover first. On touch devices, use tap/click callbacks and
  visible chart state rather than persistent hover.
- `Shift + drag` performs box selection.
- `Shift + Alt + drag` performs lasso selection.
- Dedicated touch selection gestures are not part of the `1.0` contract.
- Keyboard pan, zoom, reset, fit, autoscale, and aspect-lock shortcuts work when
  keyboard navigation is enabled.

## Picking Contract

`pickingMode` controls closest-point hover/click hit detection:

- `"both"` is the default. CPU picking supplies the initial result; GPU picking
  may refine it.
- If GPU picking misses or fails in `"both"` mode, the CPU result is preserved.
- `"cpu"` uses only CPU grid/scan picking.
- `"gpu"` uses only GPU picking.

## Tooltip Contract

- `tooltip.formatter` returns plain text.
- `tooltip.renderer` may return a `Node`, `string`, or `null`.
- Renderer strings are inserted as text. Return a `Node` when custom markup is
  needed.

Trace `hovertemplate` strings support escaped token substitution for `%{x}`,
`%{y}`, `%{pointIndex}`, `%{trace.name}`, `%{text}`, `%{customdata}`,
`%{customdata[i]}`, `%{meta}`, `%{meta.path}`, and `%{z}` for heatmaps.

## Export Contract

- `exportPng()` composites the rendered WebGPU plot layer with SVG grid and
  overlay layers.
- `exportSvg()` returns an SVG wrapper and can embed the plot layer as a PNG
  image.
- PNG and SVG exports support `pixelRatio`, `background`, `includeGrid`, and
  `includeOverlay`. SVG export also supports `includePlot`.
- `exportCsvPoints()` exports trace rows with optional header and optional
  hidden traces.
- The built-in toolbar uses these same export APIs.

## Semver Expectations

Patch releases may fix bugs and tighten behavior without changing documented
method signatures. Minor releases may add optional fields, methods, trace
features, or package exports. Removing public exports, changing documented
method signatures, or changing documented behavior in a breaking way requires a
major release.
