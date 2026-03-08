# vertexa-chart

**GPU-accelerated charting for the browser — WebGPU rendering with a D3 overlay for axes, zoom/pan, legend, tooltips, and data selection.**

[![npm](https://img.shields.io/npm/v/@lineandvertexsoftware/vertexa-chart)](https://www.npmjs.com/package/@lineandvertexsoftware/vertexa-chart)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![WebGPU](https://img.shields.io/badge/requires-WebGPU-orange)](https://caniuse.com/webgpu)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)

---

## Why vertexa-chart?

- **GPU rendering** — WebGPU pipelines handle scatter, line, bar, area, and heatmap traces at 60 fps even with millions of points.
- **Interactive D3 overlay** — axes, legend, zoom/pan, hover guides, box/lasso selection, and annotations are all SVG-rendered via D3.
- **Streaming-ready** — `appendPoints()` pushes incremental data with optional sliding-window eviction.
- **Framework-agnostic** — plain TypeScript; no React, Vue, or Angular required.
- **Typed API** — full TypeScript types for traces, layout, theme, events, and export options.
- **Built-in accessibility** — keyboard navigation, ARIA labels, and high-contrast mode.

---

## Browser support

WebGPU is required. Use a browser that supports it natively:

| Browser | Minimum version |
|---|---|
| Chrome / Chromium | 113+ |
| Edge | 113+ |
| Firefox | 141+ (behind flag in earlier versions) |
| Safari | 18+ (macOS 15 / iOS 18) |

---

## Installation

```bash
npm install @lineandvertexsoftware/vertexa-chart
```

```bash
pnpm add @lineandvertexsoftware/vertexa-chart
```

> **Note:** This package is ESM-only (`"type": "module"`). Bundlers that support ESM (Vite, webpack 5, Rollup, esbuild) work out of the box.

---

## Quick start

```ts
import { Chart } from "@lineandvertexsoftware/vertexa-chart";

const chart = new Chart(document.querySelector("#chart")!, {
  width: 920,
  height: 520,
  layout: {
    title: "Sensor readings",
    xaxis: { type: "linear", title: "Time (s)" },
    yaxis: { type: "linear", title: "Value" },
    hovermode: "closest"
  },
  traces: [
    {
      type: "scatter",
      name: "Channel A",
      x: new Float32Array([0, 1, 2, 3, 4]),
      y: new Float32Array([10, 14, 13, 16, 15]),
      mode: "lines+markers"
    }
  ],
  onHover: (e) => console.log("hover", e.point),
  onClick: (e) => console.log("click", e.point)
});

// Push new data without a full redraw
chart.appendPoints([{ traceIndex: 0, x: [5], y: [17], maxPoints: 100 }]);
```

---

## Chart types

| Type | Trace field | Notes |
|---|---|---|
| Scatter | `type: "scatter"` | `mode: "markers" \| "lines" \| "lines+markers"` |
| Line | `type: "scatter"` | `mode: "lines"` with optional dash/smoothing |
| Bar | `type: "bar"` | Stacking, custom width, base value |
| Area | `type: "area"` | Filled region under/above a line |
| Heatmap | `type: "heatmap"` | 2D z-value matrix with colorscale |
| Histogram | `type: "histogram"` | Auto-bins, aggregation: count/sum/avg |

---

## API reference

### Constructor

```ts
new Chart(element: Element, options: ChartOptions)
```

`ChartOptions` accepts:

| Option | Type | Description |
|---|---|---|
| `width` | `number` | Initial width in CSS pixels |
| `height` | `number` | Initial height in CSS pixels |
| `traces` | `Trace[]` | Array of trace definitions |
| `layout` | `Layout` | Axes, annotations, title, hover mode |
| `theme` | `ChartTheme` | Colors, fonts, grid, tooltip styling |
| `a11y` | `A11yOptions` | `label`, `description`, `highContrast`, `keyboardNavigation` |
| `toolbar` | `ToolbarOptions` | Built-in export/fullscreen toolbar (off by default) |
| `pickingMode` | `"cpu" \| "gpu" \| "both"` | Hit-detection backend |
| `onHover` | `(e: ChartHoverEvent) => void` | Pointer-move event |
| `onClick` | `(e: ChartClickEvent) => void` | Point click |
| `onZoom` | `(e: ChartZoomEvent) => void` | Zoom/pan change |
| `onLegendToggle` | `(e: ChartLegendToggleEvent) => void` | Legend item click |
| `onSelect` | `(e: ChartSelectionEvent) => void` | Box/lasso selection complete |
| `tooltip` | `TooltipOptions` | Custom `formatter` or `renderer` function |

### Instance methods

| Method | Description |
|---|---|
| `setTraces(traces)` | Replace all traces and redraw |
| `appendPoints(updates, options?)` | Append data incrementally; supports sliding window via `maxPoints` |
| `setLayout(layout)` | Merge layout changes and redraw |
| `setSize(width, height)` | Resize the chart |
| `panBy(dxCss, dyCss)` | Pan by CSS-pixel delta |
| `zoomBy(factor, centerPlot?)` | Zoom around an optional plot-space point |
| `resetView()` | Reset zoom and pan |
| `fitToData()` | Fit view to full data extent |
| `autoscaleY()` | Recompute y-domain for the visible x-range |
| `setAspectLock(enabled)` | Lock equal-unit aspect ratio |
| `setPerformanceMode(mode)` | `"quality" \| "balanced" \| "max-fps"` |
| `getPerformanceStats()` | Returns `{ fps, renderMs, pickMs, sampledPoints }` |
| `exportPng(options?)` | Export current view as PNG — `Promise<Blob>` |
| `exportSvg(options?)` | Export current view as SVG — `Promise<Blob>` |
| `exportCsvPoints(options?)` | Export chart data as CSV — `Blob` |
| `destroy()` | Release all GPU and DOM resources |

`setLayout()` merges the provided patch into the current layout. Nested objects such as
`xaxis`, `yaxis`, `grid`, `legend`, and `margin` are shallow-merged; arrays such as
`annotations` replace the previous value.

### Keyboard shortcuts

When the chart container has focus:

| Key | Action |
|---|---|
| Arrow keys | Pan |
| `+` / `-` | Zoom in / out |
| `0` | Reset view |
| `F` | Fit to data |
| `Y` | Autoscale Y |
| `L` | Toggle aspect lock |
| `Shift + drag` | Box selection |
| `Shift + Alt + drag` | Lasso selection |

---

## Layout options

```ts
layout: {
  title: "My chart",
  hovermode: "closest",       // "closest" | "x" | "y" | "none"
  xaxis: {
    type: "linear",           // "linear" | "log" | "time"
    title: "X axis",
    range: [0, 100],
    tickFormat: ".1f",
    precision: 2
  },
  yaxis: { type: "linear", title: "Y axis" },
  legend: { show: true, position: "top-right" },
  grid: { show: true, color: "#e5e7eb", opacity: 1, strokeWidth: 1 },
  annotations: [
    { type: "line", x0: 5, y0: 0, x1: 5, y1: 100, color: "red", dash: "dash" },
    { type: "region", x0: 2, y0: 10, x1: 8, y1: 90, fill: "#3b82f6", fillOpacity: 0.15 },
    { type: "label", x: 5, y: 95, text: "Threshold", color: "#111" }
  ]
}
```

---

## Theming

```ts
theme: {
  colors: {
    background: "#0f172a",
    text: "#f8fafc",
    palette: ["#38bdf8", "#f97316", "#a78bfa"]
  },
  fonts: { family: "Inter, sans-serif", sizePx: 13 },
  grid: { color: "#1e293b", opacity: 0.8 },
  tooltip: { background: "#1e293b", textColor: "#f8fafc", borderRadiusPx: 6 }
}
```

---

## Streaming data

```ts
// Append points with a sliding window of 200 samples per trace
chart.appendPoints(
  [
    { traceIndex: 0, x: [Date.now()], y: [sensor.read()], maxPoints: 200 }
  ]
);
```

---

## Built-in toolbar

```ts
const chart = new Chart(el, {
  width: 920,
  height: 520,
  traces: [],
  toolbar: {
    show: true,
    position: "top-right",
    exportFormats: ["png", "svg", "csv"],
    exportFilename: "my-chart"
  }
});
```

---

## Custom tooltip

```ts
// String formatter
tooltip: {
  formatter: (ctx) => `${ctx.trace.name} — x: ${ctx.x}, y: ${ctx.y}`
}

// Trusted HTML renderer
tooltip: {
  renderer: (ctx) => `<strong>${ctx.trace.name}</strong><br>${ctx.y}`
}

// DOM renderer (avoids innerHTML)
tooltip: {
  renderer: (ctx) => {
    const div = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = String(ctx.trace.name ?? "Trace");
    div.append(title, document.createElement("br"), document.createTextNode(String(ctx.y)));
    return div;
  }
}
```

If `tooltip.renderer` returns a `string`, Vertexa Chart inserts it with `innerHTML`.
Only return trusted HTML strings. Use `formatter` for plain text.

---

## Performance notes

- **LOD sampling** kicks in automatically above ~50 k visible points, keeping rendering smooth.
- **`pickingMode: "both"`** (default) uses a CPU grid index for hover stability during pan and GPU picking for accurate hit detection in dense data.
- Use `setPerformanceMode("max-fps")` when rendering at high frequency; `"quality"` prefers anti-aliasing.
- `getPerformanceStats()` returns live FPS, render latency, pick latency, and sampled point count.

---

## Monorepo structure

```
packages/
  vertexa-chart      — public chart API (this package)
  renderer-webgpu    — WebGPU rendering engine
  overlay-d3         — D3 axes, zoom, legend, selection overlay
apps/
  demo               — Vite dev app with 9 runnable examples
```

Internal packages (`renderer-webgpu`, `overlay-d3`) are published separately but are intended as implementation details of `vertexa-chart`.

---

## Running the demo locally

```bash
git clone https://github.com/LineandVertexSoftware/vertexa-chart.git
cd vertexa-chart
pnpm install
pnpm dev
```

Open the URL printed by Vite. Append `?example=<name>` to switch between examples:

| Example | URL param |
|---|---|
| Getting started | `getting-started` |
| Axis & grid config | `axis-grid` |
| Events & runtime API | `events-api` |
| Bar basics | `bar-basics` |
| Bar + time axis | `bar-time` |
| Bar streaming | `bar-interactions` |
| Heatmap | `heatmap-basics` |
| Advanced workbench | `vertexa-workbench` |
| 6 synchronized charts × 1M points | `perf-sync-6` |

Add `&contrast=1` to any URL to toggle high-contrast mode.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

[MIT](LICENSE) — © 2026 Line and Vertex Software contributors
