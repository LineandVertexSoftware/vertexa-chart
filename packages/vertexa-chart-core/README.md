# @vertexa-chart/vertexa-chart-core

Core chart API for Vertexa Chart.

## Install

```bash
npm install @vertexa-chart/vertexa-chart-core
```

## Usage

```ts
import { Chart } from "@vertexa-chart/vertexa-chart-core";

const chart = new Chart(document.querySelector("#root")!, {
  width: 920,
  height: 520,
  traces: []
});
```

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
[https://github.com/art/vertexa-chart#readme](https://github.com/art/vertexa-chart#readme)
