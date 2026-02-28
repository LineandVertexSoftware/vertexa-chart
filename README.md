# vertexa-chart

WebGPU charting with a D3 overlay for axes, zoom/pan, legend, and hover guides.

## Getting Started

### Prerequisites
- Node 20+ required
- `pnpm`
- A browser with WebGPU enabled (recent Chrome/Edge)

### Install and run
```bash
pnpm install
pnpm dev
```

Then open the local URL from Vite.

## Core API

Import:
```ts
import { Chart } from "@vertexa-chart/vertexa-chart-core";
```

Create a chart:
```ts
const chart = new Chart(targetElement, {
  width: 920,
  height: 520,
  traces: []
});
```

Public instance API:

| Method | Purpose |
|---|---|
| `setTraces(traces)` | Replace all traces and redraw. |
| `appendPoints(updates, options?)` | Incrementally append points; supports sliding window via `maxPoints`. |
| `exportPng(options?)` | Export the current view as PNG (`Promise<Blob>`). |
| `exportSvg(options?)` | Export the current view as SVG (`Promise<Blob>`). |
| `exportCsvPoints(options?)` | Export chart points as CSV (`Blob`). |
| `setLayout(layout)` | Replace layout and redraw. |
| `setSize(width, height)` | Resize the chart viewport and redraw. |
| `panBy(dxCss, dyCss)` | Programmatically pan view in CSS px. |
| `zoomBy(factor, centerPlot?)` | Programmatically zoom view. |
| `resetView()` | Reset zoom/pan transform. |
| `fitToData()` | Clear manual bounds and fit to full data extent. |
| `autoscaleY()` | Recompute y-domain for current visible x-range. |
| `setAspectLock(enabled)` | Lock/unlock equal-unit aspect ratio behavior. |
| `setPerformanceMode(mode)` | Switch between `quality`, `balanced`, `max-fps`. |
| `getPerformanceStats()` | Read runtime stats (`fps`, sampled points, render/pick ms). |
| `destroy()` | Release resources and detach chart from DOM. Idempotent. |

## Core Types (Summary)

### `ChartOptions`
- `width`, `height`, `padding`
- `theme`:
  - `colors`: `background`, `text`, `axis`, `grid`, `tooltipBackground`, `tooltipText`, `palette`
  - `fonts`: `family`, `sizePx`, `axisFamily`, `axisSizePx`, `tooltipFamily`, `tooltipSizePx`
  - `axis`: `color`, `textColor`, `fontFamily`, `fontSizePx`
  - `grid`: `show`, `color`, `opacity`, `strokeWidth`
  - `tooltip`: `background`, `textColor`, `fontFamily`, `fontSizePx`, `borderRadiusPx`, `paddingX`, `paddingY`, `boxShadow`
- `a11y`:
  - `label`, `description`
  - `keyboardNavigation` (default `true`)
  - `highContrast` (default `false`)
- `toolbar` (optional built-in UI, default disabled):
  - `show` (default `false`)
  - `position`: `"top-right" | "top-left" | "bottom-right" | "bottom-left"`
  - `fullscreen` (default `true`)
  - `export` (default `true`)
  - `exportFormats`: `("png" | "svg" | "csv")[]`
  - `exportFilename` (default `"vertexa-chart"`)
  - `exportPixelRatio` (default `2`)
- `traces`
- incremental data:
  - `appendPoints([{ traceIndex, x, y, maxPoints? }], { maxPoints? })`
  - sliding window: set `maxPoints` per update or as default options
- `layout`
- `pickingMode`: `"cpu" | "gpu" | "both"`
- event hooks:
  - `onHover`
  - `onClick`
  - `onZoom`
  - `onLegendToggle`
  - `onSelect` (box selection, `Shift + drag`)
- `tooltip`:
  - `formatter(context) => string`
  - `renderer(context) => string | Node | null`
  - precedence: `renderer` > `formatter` > `hovertemplate` > default label

Keyboard shortcuts (when chart container is focused):
- Arrow keys: pan
- `+` / `-`: zoom in/out
- `0`: reset zoom
- `F`: fit to data
- `Y`: autoscale Y
- `L`: toggle aspect lock

### Built-in Toolbar (Optional)
Enable an official toolbar UI (export dropdown + fullscreen toggle):

```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: [],
  toolbar: {
    show: true,
    position: "top-right",
    exportFormats: ["png", "svg", "csv"],
    exportFilename: "my-plot"
  }
});
```

If you prefer full control, leave `toolbar.show` unset/`false` and build your own controls using the public chart API.

### `Layout`
- `title`
- `hovermode`: `"closest" | "x" | "y" | "none"`
- `legend`:
  - `show`
  - `position`: `"top-right" | "top-left" | "bottom-right" | "bottom-left"`
- `margin`:
  - `top`, `right`, `bottom`, `left` (alias to chart padding)
- `axes` alias:
  - `axes.x` and `axes.y` are accepted as aliases for `xaxis`/`yaxis`
- `annotations`:
  - `line`: `{ type: "line", x0, y0, x1, y1, color?, opacity?, widthPx?, dash? }`
  - `region`: `{ type: "region", x0, y0, x1, y1, fill?, fillOpacity?, stroke?, strokeOpacity?, strokeWidthPx? }`
  - `label`: `{ type: "label", x, y, text, color?, fontFamily?, fontSizePx?, anchor?, offsetXPx?, offsetYPx?, background?, backgroundOpacity?, paddingX?, paddingY? }`
- `xaxis` / `yaxis`:
  - `type`: `"linear" | "log" | "time"`
  - `title`, `range`, `domain`, `min`, `max`
  - `tickValues` (fixed tick positions)
  - `tickFormat` (numeric or time formatter)
  - `precision`
  - `timeFormat`
- `grid`:
  - `show`
  - `color`
  - `axisColor`
  - `textColor`
  - `opacity`
  - `strokeWidth`

Grid defaults:
- `show: true`
- `color: "#e5e7eb"`
- `axisColor: "#9ca3af"`
- `textColor: "#4b5563"`
- `opacity: 1`
- `strokeWidth: 1`

### `Trace.line` style controls
- `line.color`
- `line.opacity`
- `line.widthPx` (default `1`)
- `line.dash`:
  - named: `"solid" | "dash" | "dot" | "dashdot"`
  - custom: `number[]` dash/gap sequence
- `line.smoothing`: `"none" | "catmull-rom"`

## Runnable Examples (9)

All examples are available in `apps/demo/src/main.ts` and selectable by URL query param.
High-contrast mode can be toggled with `&contrast=1` (for example: `/?example=events-api&contrast=1`).

1. `/?example=getting-started`
2. `/?example=axis-grid`
3. `/?example=events-api`
4. `/?example=bar-basics`
5. `/?example=bar-time`
6. `/?example=bar-interactions`
7. `/?example=heatmap-basics`
8. `/?example=vertexa-workbench` (advanced interaction shell with toolbar/layers/perf status)
9. `/?example=perf-sync-6` (six synchronized charts, each with 1M points and no sampling)

### Example 1: Getting Started
```ts
import { Chart } from "@vertexa-chart/vertexa-chart-core";

const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  theme: {
    colors: {
      background: "#f8fafc",
      palette: ["#0f766e", "#f97316", "#4338ca"]
    },
    axis: { textColor: "#334155" },
    grid: { color: "#dbeafe", opacity: 0.85 }
  },
  layout: {
    title: "Sensor baseline",
    xaxis: { type: "linear", title: "Time (s)", tickFormat: ".0f" },
    yaxis: { type: "linear", title: "Value", precision: 2 },
    hovermode: "closest"
  },
  traces: [
    {
      type: "scatter",
      name: "Primary",
      x: new Float32Array([0, 1, 2, 3]),
      y: new Float32Array([10, 14, 13, 16]),
      mode: "lines+markers"
    }
  ]
});
```

### Example 2: Axis + Grid Config
```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  layout: {
    title: "Temperature",
    hovermode: "x",
    xaxis: {
      type: "time",
      title: "Timestamp",
      tickValues: [new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T12:00:00Z")],
      timeFormat: "%b %d %H:%M"
    },
    yaxis: { type: "linear", title: "Temp (C)", min: 18, max: 22, tickFormat: ".2f", precision: 2 },
    grid: {
      show: true,
      color: "#dbeafe",
      axisColor: "#334155",
      textColor: "#0f172a",
      opacity: 0.85,
      strokeWidth: 1
    }
  },
  traces: [{ type: "scatter", name: "Ambient", x: [new Date()], y: [21.5], mode: "lines+markers" }]
});
```

### Example 3: Event Hooks + Runtime API
```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: [{ type: "scatter", x: [0, 1, 2], y: [4, 5, 3], mode: "lines+markers" }],
  onHover: (e) => console.log("hover", e.point),
  onClick: (e) => console.log("click", e.point),
  onZoom: (e) => console.log("zoom", e),
  onLegendToggle: (e) => console.log("legend", e),
  onSelect: (e) => console.log("selected point indices", e.points),
  tooltip: {
    formatter: (ctx) => `${ctx.trace.name ?? "trace"} #${ctx.pointIndex} x=${ctx.x} y=${ctx.y}`
  }
});

chart.setSize(760, 430);
chart.setLayout({ hovermode: "x" });
chart.setTraces([{ type: "scatter", x: [0, 1, 2], y: [3, 4, 6], mode: "lines" }]);
chart.appendPoints([{ traceIndex: 0, x: [3, 4], y: [7, 8], maxPoints: 4 }]);
const pngBlob = await chart.exportPng({ pixelRatio: 2 });
const svgBlob = await chart.exportSvg({ pixelRatio: 2 });
const csvBlob = chart.exportCsvPoints({ includeHidden: false });
console.log(chart.getPerformanceStats());
```

### Example 4: Bar Trace Basics
```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  layout: {
    title: "Regional monthly totals",
    xaxis: { type: "linear", title: "Month", min: 0.5, max: 12.5 },
    yaxis: { type: "linear", title: "Units" }
  },
  traces: [
    { type: "bar", name: "North", x: [1, 2, 3], y: [44, 52, 49], bar: { widthPx: 14, color: "#0f766e", opacity: 0.72, base: 0 } },
    { type: "bar", name: "South", x: [1.25, 2.25, 3.25], y: [41, 47, 51], bar: { widthPx: 14, color: "#f97316", opacity: 0.66, base: 0 } }
  ]
});
```

### Example 5: Bar + Time Axis
```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  layout: {
    title: "Hourly requests",
    hovermode: "x",
    xaxis: { type: "time", title: "Hour", timeFormat: "%b %d %H:%M" },
    yaxis: { type: "linear", title: "Req/s", min: 35, max: 105 }
  },
  traces: [
    { type: "bar", name: "Observed", x: [new Date()], y: [72], bar: { widthPx: 10, color: "#2563eb", opacity: 0.65, base: 35 } },
    { type: "scatter", name: "Trend", x: [new Date()], y: [69], mode: "lines", line: { color: "#0f172a", dash: "dash" } }
  ]
});
```

### Example 6: Bar Interactions + appendPoints()
```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: [
    { type: "bar", name: "Throughput", x: [0, 1, 2], y: [60, 64, 59], bar: { widthPx: 8, color: "#0284c7", opacity: 0.65, base: 0 } },
    { type: "scatter", name: "EMA", x: [0, 1, 2], y: [60, 61, 60.6], mode: "lines", line: { color: "#111827", widthPx: 2 } }
  ]
});

chart.appendPoints(
  [
    { traceIndex: 0, x: [3], y: [66], maxPoints: 64 },
    { traceIndex: 1, x: [3], y: [61.6], maxPoints: 64 }
  ],
  { maxPoints: 64 }
);
```

## Notes
- Hover modes: `layout.hovermode = "closest" | "x" | "y" | "none"`
- CPU picking uses a screen-space grid index and remains stable during pan.
- GPU picking is used in closest mode to improve point hit accuracy in dense data.
- Selection is available with `Shift + drag` (box) and `Shift + Alt + drag` (lasso) when `onSelect` is provided.

## Visual Regression Snapshots
- Run: `pnpm test:visual`
- Baselines: `apps/demo/test/visual-snapshots/*.png`
- Artifacts on mismatch: `apps/demo/test/visual-artifacts/*.actual.png`

## Monorepo Packages

- `@vertexa-chart/vertexa-chart-core`: public chart API package
- `@vertexa-chart/overlay-d3`: D3 overlay module
- `@vertexa-chart/renderer-webgpu`: WebGPU renderer module
- `apps/demo`: local demo app and visual regression harness

## Open Source Release Flow

1. Create/push the GitHub repository:
   - `git remote add origin git@github.com:art/vertexa-chart.git`
   - `git push -u origin main`
2. Validate release artifacts:
   - `pnpm release:check`
3. Log in to npm:
   - `npm login`
4. Publish all public packages from the monorepo root:
   - `pnpm publish:packages --no-git-checks`

Notes:
- Packages are configured with `publishConfig.access = "public"`.
- `prepublishOnly` builds each package before publish.
- `files` in each package limits published contents to `dist/`, `README.md`, and `LICENSE`.
