# @lineandvertexsoftware/vertexa-chart

Core chart API for Vertexa Chart.

## Install

```bash
npm install @lineandvertexsoftware/vertexa-chart
```

## Usage

```ts
import { Chart } from "@lineandvertexsoftware/vertexa-chart";

const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: [
    { type: "scatter", x: [1, 2, 3], y: [10, 20, 30] }
  ]
});
```

### Secondary Y-Axis (Dual Scale)

Bind any trace to a right-side secondary y-axis by setting `yaxis: "y2"`:

```ts
const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: [
    { type: "scatter", x: [1, 2, 3], y: [10, 20, 30], name: "Revenue" },
    { type: "scatter", x: [1, 2, 3], y: [1000, 2000, 3000], yaxis: "y2", name: "Users" }
  ],
  layout: {
    yaxis2: { title: "Users", type: "linear" }
  }
});
```

- Each axis computes its own domain independently, so different scales don't interfere.
- Right-side padding is added automatically when y2 traces are present (override with `layout.margin.right`).
- Hover and click events report which axis a point belongs to via the `yAxis` field on `ChartPoint`.
- Supports all axis types on y2: `linear`, `log`, `time`, and `category`.
- Works with all trace types: `scatter`, `bar`, `area`, `histogram`.

## Public API

- `setTraces(traces)`
- `appendPoints(updates, options?)`
- `exportPng(options?)`
- `exportSvg(options?)`
- `exportCsvPoints(options?)`
- `setLayout(layout)`
- `setSize(width, height)`
- `panBy(dxCss, dyCss)`
- `zoomBy(factor, centerPlot?)`
- `resetView()`
- `fitToData()`
- `autoscaleY()`
- `setAspectLock(enabled)`
- `setPerformanceMode(mode)`
- `getPerformanceStats()`
- `destroy()`

For full examples and docs, see the monorepo README:
[https://github.com/LineandVertexSoftware/vertexa-chart/blob/main/README.md](https://github.com/LineandVertexSoftware/vertexa-chart/blob/main/README.md)
