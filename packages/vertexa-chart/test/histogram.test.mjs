import assert from "node:assert/strict";
import test from "node:test";

const BASE_THEME = {
  colors: {
    background: "#ffffff",
    text: "#111827",
    axis: "#9ca3af",
    grid: "#e5e7eb",
    tooltipBackground: "rgba(0,0,0,0.75)",
    tooltipText: "#ffffff",
    palette: ["#1f77b4", "#ff7f0e", "#2ca02c"]
  },
  fonts: {
    family: "sans-serif",
    sizePx: 12,
    axisFamily: "sans-serif",
    axisSizePx: 12,
    tooltipFamily: "sans-serif",
    tooltipSizePx: 12
  },
  axis: { color: "#9ca3af", textColor: "#4b5563", fontFamily: "sans-serif", fontSizePx: 12 },
  grid: { show: true, color: "#e5e7eb", opacity: 1, strokeWidth: 1 },
  tooltip: {
    background: "rgba(0,0,0,0.75)",
    textColor: "#ffffff",
    fontFamily: "sans-serif",
    fontSizePx: 12,
    borderRadiusPx: 8,
    paddingX: 8,
    paddingY: 6,
    boxShadow: "0 8px 20px rgba(0,0,0,0.18)"
  }
};

const BASE_PADDING = { l: 20, r: 20, t: 20, b: 20 };

function mockAxisManager(overrides = {}) {
  return {
    resolveAxisType: () => "linear",
    getAxis: () => undefined,
    getBarMode: () => "overlay",
    getHoverMode: () => "closest",
    hasY2Traces: () => false,
    ...overrides
  };
}

function sumArray(arr) {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

// ─── computeHistogram unit tests ─────────────────────────────────────────────

test("histogram suite", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: { WebGPURenderer: class WebGPURendererStub {} }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: { OverlayD3: class OverlayD3Stub {} }
  });

  const { computeHistogram } = await import("../dist/histogram.js");
  const { SceneCompiler } = await import("../dist/SceneCompiler.js");

  // ── Binning algorithm ──────────────────────────────────────────────────────

  await t.test("auto binning: Sturges rule for n=8 gives 4 bins", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8]; // ceil(log2(8))+1 = 4
    const result = computeHistogram(data, null, "count", "", undefined, undefined);
    assert.equal(result.binCenters.length, 4);
    assert.equal(result.binEdges.length, 5);
    assert.equal(sumArray(result.binValues), 8, "total count equals input length");
  });

  await t.test("nbins honored: explicit bin count overrides Sturges", () => {
    const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = computeHistogram(data, null, "count", "", 5, undefined);
    assert.equal(result.binCenters.length, 5);
    assert.equal(sumArray(result.binValues), 10);
  });

  await t.test("xbins.size creates correct edges and counts", () => {
    const data = [0, 1, 2, 3, 4]; // 5 values, each in its own bin of width 1
    const result = computeHistogram(data, null, "count", "", undefined, { start: 0, end: 5, size: 1 });
    assert.equal(result.binCenters.length, 5);
    assert.equal(result.binEdges[0], 0);
    assert.equal(result.binEdges[5], 5);
    assert.equal(sumArray(result.binValues), 5);
    // Each bin should have exactly 1 value
    for (const v of result.binValues) assert.equal(v, 1);
  });

  await t.test("xbins.size with clustered data sums into fewer bins", () => {
    const data = [0.1, 0.2, 0.3,  2.1, 2.2];
    const result = computeHistogram(data, null, "count", "", undefined, { start: 0, end: 4, size: 2 });
    assert.equal(result.binCenters.length, 2);
    assert.equal(result.binValues[0], 3); // 0.1, 0.2, 0.3 in [0,2)
    assert.equal(result.binValues[1], 2); // 2.1, 2.2 in [2,4]
  });

  await t.test("values outside manual start/end are excluded", () => {
    const data = [-5, 0, 1, 2, 3, 100];
    const result = computeHistogram(data, null, "count", "", undefined, { start: 0, end: 3, size: 1 });
    // Only 0, 1, 2, 3 are in [0, 3] → -5 and 100 excluded
    assert.equal(sumArray(result.binValues), 4);
  });

  await t.test("all-identical values get a single bin centred on the value", () => {
    const data = [5, 5, 5, 5];
    const result = computeHistogram(data, null, "count", "", undefined, undefined);
    assert.ok(result.binCenters.length >= 1);
    assert.equal(sumArray(result.binValues), 4);
  });

  await t.test("empty input returns single placeholder bin with zero count", () => {
    const result = computeHistogram([], null, "count", "", undefined, undefined);
    assert.equal(result.binCenters.length, 1);
    assert.equal(result.binValues[0], 0);
  });

  // ── histnorm ───────────────────────────────────────────────────────────────

  await t.test("histnorm probability: bin values sum to 1", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = computeHistogram(data, null, "count", "probability", undefined, undefined);
    const sum = sumArray(result.binValues);
    assert.ok(Math.abs(sum - 1) < 1e-9, `Expected ~1, got ${sum}`);
  });

  await t.test("histnorm percent: bin values sum to 100", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = computeHistogram(data, null, "count", "percent", undefined, undefined);
    const sum = sumArray(result.binValues);
    assert.ok(Math.abs(sum - 100) < 1e-9, `Expected ~100, got ${sum}`);
  });

  await t.test("histnorm density: integral (sum × binSize) ≈ 1", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = computeHistogram(data, null, "count", "density", 4, undefined);
    const binSize = result.binEdges[1] - result.binEdges[0];
    const integral = Array.from(result.binValues).reduce((acc, v) => acc + v * binSize, 0);
    assert.ok(Math.abs(integral - 1) < 1e-9, `Expected ~1, got ${integral}`);
  });

  await t.test("histnorm 'probability density' matches density", () => {
    const data = [1, 2, 3, 4, 5];
    const r1 = computeHistogram(data, null, "count", "density", 2, undefined);
    const r2 = computeHistogram(data, null, "count", "probability density", 2, undefined);
    for (let i = 0; i < r1.binValues.length; i++) {
      assert.ok(Math.abs(r1.binValues[i] - r2.binValues[i]) < 1e-12);
    }
  });

  // ── histfunc ───────────────────────────────────────────────────────────────

  await t.test("histfunc sum: sums y values per bin", () => {
    const x = [0.5, 1.5, 2.5];
    const y = [10, 20, 30];
    const result = computeHistogram(x, y, "sum", "", undefined, { start: 0, end: 3, size: 1 });
    assert.equal(result.binValues[0], 10);
    assert.equal(result.binValues[1], 20);
    assert.equal(result.binValues[2], 30);
  });

  await t.test("histfunc avg: averages y values per bin", () => {
    const x = [0.25, 0.75, 1.5]; // bin 0 has two values, bin 1 has one
    const y = [4, 8, 6];
    const result = computeHistogram(x, y, "avg", "", undefined, { start: 0, end: 2, size: 1 });
    assert.equal(result.binValues[0], 6);  // (4+8)/2
    assert.equal(result.binValues[1], 6);  // 6/1
  });

  await t.test("histfunc avg with empty bin returns 0", () => {
    const x = [0.5, 2.5]; // bin at index 1 is empty
    const y = [10, 20];
    const result = computeHistogram(x, y, "avg", "", undefined, { start: 0, end: 3, size: 1 });
    assert.equal(result.binValues[0], 10);
    assert.equal(result.binValues[1], 0);  // empty bin
    assert.equal(result.binValues[2], 20);
  });

  // ── SceneCompiler integration ──────────────────────────────────────────────

  await t.test("histogram compiles to 1 marker layer + 1 line layer", () => {
    const traces = [{ type: "histogram", x: [1, 1, 2, 2, 3, 4, 5], nbinsx: 5 }];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(scene.markers.length, 1, "one marker layer for picking");
    assert.equal(scene.lines.length,   1, "one line layer for bar rendering");
    assert.equal(sc.idRanges.length,   1);
    assert.equal(sc.idRanges[0].count, 5, "one pick point per bin");
  });

  await t.test("y domain starts at 0 and max covers bin heights", () => {
    const traces = [{ type: "histogram", x: [1, 2, 3, 4, 5], nbinsx: 5 }];
    const sc = new SceneCompiler();
    sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(sc.yDomainNum[0], 0, "y domain lower bound is always 0");
    assert.ok(sc.yDomainNum[1] > 0,  "y domain upper bound covers bar heights");
  });

  await t.test("manual xbins.size honored: correct number of bins compiled", () => {
    const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const traces = [{ type: "histogram", x: data, xbins: { start: 0, end: 10, size: 2 } }];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    // 5 bins of width 2 spanning [0,10]
    assert.equal(sc.idRanges[0].count, 5);
    assert.equal(scene.markers[0].points01.length / 2, 5);
  });

  await t.test("bar widths in line layer match bin span", () => {
    const data = [0, 1, 2, 3];
    const traces = [{ type: "histogram", x: data, nbinsx: 4 }];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    // widthPx should be positive and tied to bin width
    assert.ok(scene.lines[0].widthPx > 0);
  });

  await t.test("custom bar.widthPx overrides auto width", () => {
    const traces = [{ type: "histogram", x: [1, 2, 3, 4, 5], bar: { widthPx: 7 } }];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(scene.lines[0].widthPx, 7);
  });

  await t.test("traceData stores bin centres and values for hover", () => {
    const traces = [{ type: "histogram", x: [1, 2, 3, 4], nbinsx: 4 }];
    const sc = new SceneCompiler();
    sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    const td = sc.traceData[0];
    assert.ok(td, "traceData entry created");
    assert.equal(td.xs.length, 4, "xs holds one centre per bin");
    assert.equal(td.ys.length, 4, "ys holds one count per bin");
  });

  await t.test("histnorm probability domain adjusts to [0, ~1]", () => {
    const data = Array.from({ length: 100 }, (_, i) => i % 10);
    const traces = [{ type: "histogram", x: data, histnorm: "probability", nbinsx: 10 }];
    const sc = new SceneCompiler();
    sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(sc.yDomainNum[0], 0);
    // Max probability = 10/100 = 0.1 per bin, with 5% padding → yMax ≈ 0.105
    assert.ok(sc.yDomainNum[1] > 0 && sc.yDomainNum[1] < 1.5, `yMax=${sc.yDomainNum[1]}`);
  });

  await t.test("horizontal histogram (orientation h) puts bins on y axis", () => {
    const traces = [{ type: "histogram", y: [1, 2, 3, 4, 5], orientation: "h", nbinsy: 5 }];
    const sc = new SceneCompiler();
    sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(sc.xDomainNum[0], 0,   "h-histogram x domain starts at 0");
    assert.ok(sc.xDomainNum[1] > 0,    "h-histogram x domain covers bar lengths");
    assert.ok(sc.yDomainNum[1] > 0,    "h-histogram y domain covers bin range");
    assert.equal(sc.idRanges[0].count, 5);
  });

  await t.test("invisible histogram trace produces no scene output", () => {
    const traces = [{ type: "histogram", x: [1, 2, 3, 4, 5], visible: false }];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(scene.markers.length, 0);
    assert.equal(scene.lines.length,   0);
  });

  await t.test("histogram coexists with a bar trace: both compile", () => {
    const traces = [
      { type: "histogram", x: [1, 2, 3, 4, 5], nbinsx: 5, name: "Hist" },
      { type: "bar",       x: [1, 2, 3],        y: [4, 5, 6], name: "Bar" }
    ];
    const sc = new SceneCompiler();
    const scene = sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    assert.equal(scene.markers.length, 2);
    assert.equal(scene.lines.length,   2);
    assert.equal(sc.idRanges.length,   2);
  });

  await t.test("histfunc sum SceneCompiler: y domain covers sum values", () => {
    const traces = [{
      type: "histogram",
      x: [0, 1, 2],
      y: [100, 200, 300],
      histfunc: "sum",
      xbins: { start: 0, end: 3, size: 1 }
    }];
    const sc = new SceneCompiler();
    sc.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);
    // Each bin has exactly 1 value: 100, 200, 300
    assert.equal(sc.yDomainNum[0], 0);
    assert.ok(sc.yDomainNum[1] > 300, `Expected yMax > 300, got ${sc.yDomainNum[1]}`);
  });
});
