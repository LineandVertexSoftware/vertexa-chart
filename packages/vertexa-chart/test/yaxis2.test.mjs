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
  axis: {
    color: "#9ca3af",
    textColor: "#4b5563",
    fontFamily: "sans-serif",
    fontSizePx: 12
  },
  grid: {
    show: true,
    color: "#e5e7eb",
    opacity: 1,
    strokeWidth: 1
  },
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

const BASE_PADDING = { l: 55, r: 55, t: 20, b: 45 };
const BASE_ZOOM = { k: 1, x: 0, y: 0 };

test("Secondary y-axis (yaxis2)", async (t) => {
  const { AxisManager } = await import("../dist/AxisManager.js");
  const { SceneCompiler } = await import("../dist/SceneCompiler.js");

  function makeAxisManager(overrides = {}) {
    const state = {
      layout: {},
      traces: [],
      theme: BASE_THEME,
      zoom: BASE_ZOOM,
      xDomainNum: [0, 1],
      yDomainNum: [0, 1],
      y2DomainNum: null,
      width: 400,
      height: 300,
      padding: BASE_PADDING,
      ...overrides
    };
    return new AxisManager(() => state);
  }

  await t.test("AxisManager.hasY2Traces returns false when no y2 traces", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: [3, 4] },
        { type: "scatter", x: [5, 6], y: [7, 8] }
      ]
    });
    assert.equal(am.hasY2Traces(), false);
  });

  await t.test("AxisManager.hasY2Traces returns true when y2 traces present", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: [3, 4] },
        { type: "scatter", x: [5, 6], y: [7, 8], yaxis: "y2" }
      ]
    });
    assert.equal(am.hasY2Traces(), true);
  });

  await t.test("AxisManager.getAxis('y2') returns layout.yaxis2", () => {
    const am = makeAxisManager({
      layout: { yaxis2: { type: "log", title: "Temperature" } }
    });
    const axis = am.getAxis("y2");
    assert.equal(axis?.type, "log");
    assert.equal(axis?.title, "Temperature");
  });

  await t.test("AxisManager.getAxis('y2') returns undefined when not set", () => {
    const am = makeAxisManager({});
    assert.equal(am.getAxis("y2"), undefined);
  });

  await t.test("AxisManager.resolveAxisType('y2') infers from y2 traces only", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: ["a", "b"] }, // y1 = category
        { type: "scatter", x: [1, 2], y: [100, 200], yaxis: "y2" } // y2 = linear
      ]
    });
    assert.equal(am.resolveAxisType("y"), "category");
    assert.equal(am.resolveAxisType("y2"), "linear");
  });

  await t.test("AxisManager.resolveAxisType('y2') uses explicit axis type", () => {
    const am = makeAxisManager({
      layout: { yaxis2: { type: "log" } },
      traces: [
        { type: "scatter", x: [1, 2], y: [100, 200], yaxis: "y2" }
      ]
    });
    assert.equal(am.resolveAxisType("y2"), "log");
  });

  await t.test("AxisManager.resolveLayoutPadding adds right padding for y2 traces", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: [3, 4], yaxis: "y2" }
      ]
    });
    const pad = am.resolveLayoutPadding({}, { l: 55, r: 20, t: 20, b: 45 });
    assert.ok(pad.r >= 55, `right padding should be >= 55, got ${pad.r}`);
  });

  await t.test("AxisManager.resolveLayoutPadding respects explicit right margin", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: [3, 4], yaxis: "y2" }
      ]
    });
    const pad = am.resolveLayoutPadding({ margin: { right: 30 } }, { l: 55, r: 20, t: 20, b: 45 });
    assert.equal(pad.r, 30, "explicit right margin should be respected");
  });

  await t.test("AxisManager.makeOverlayAxisSpec for y2 uses y2 axis config", () => {
    const am = makeAxisManager({
      layout: { yaxis2: { title: "Temp (°C)", precision: 1 } }
    });
    const spec = am.makeOverlayAxisSpec("y2", "linear", [10, 100]);
    assert.equal(spec.title, "Temp (°C)");
    assert.equal(spec.precision, 1);
    assert.equal(spec.type, "linear");
    assert.deepEqual(spec.domain, [10, 100]);
  });

  await t.test("SceneCompiler computes separate y2 domain", () => {
    const traces = [
      { type: "scatter", x: [1, 2, 3], y: [10, 20, 30] },
      { type: "scatter", x: [1, 2, 3], y: [1000, 2000, 3000], yaxis: "y2" }
    ];
    const am = makeAxisManager({ traces });
    const sc = new SceneCompiler();
    sc.compile(traces, am, BASE_THEME, 400, 300, BASE_PADDING);

    // y1 domain should cover ~10-30 range
    assert.ok(sc.yDomainNum[0] <= 10, `y1 domain min should be <= 10, got ${sc.yDomainNum[0]}`);
    assert.ok(sc.yDomainNum[1] >= 30, `y1 domain max should be >= 30, got ${sc.yDomainNum[1]}`);

    // y2 domain should cover ~1000-3000 range
    assert.ok(sc.y2DomainNum != null, "y2DomainNum should not be null");
    assert.ok(sc.y2DomainNum[0] <= 1000, `y2 domain min should be <= 1000, got ${sc.y2DomainNum[0]}`);
    assert.ok(sc.y2DomainNum[1] >= 3000, `y2 domain max should be >= 3000, got ${sc.y2DomainNum[1]}`);

    // y1 and y2 domains should be independent
    assert.ok(sc.yDomainNum[1] < 100, "y1 domain max should be < 100 (not mixed with y2 data)");
    assert.ok(sc.y2DomainNum[0] > 100, "y2 domain min should be > 100 (not mixed with y1 data)");
  });

  await t.test("SceneCompiler records traceYAxisBinding", () => {
    const traces = [
      { type: "scatter", x: [1], y: [10] },
      { type: "scatter", x: [1], y: [100], yaxis: "y2" },
      { type: "scatter", x: [1], y: [20] }
    ];
    const am = makeAxisManager({ traces });
    const sc = new SceneCompiler();
    sc.compile(traces, am, BASE_THEME, 400, 300, BASE_PADDING);

    assert.equal(sc.traceYAxisBinding.get(0), "y");
    assert.equal(sc.traceYAxisBinding.get(1), "y2");
    assert.equal(sc.traceYAxisBinding.get(2), "y");
  });

  await t.test("SceneCompiler y2DomainNum is null when no y2 traces", () => {
    const traces = [
      { type: "scatter", x: [1, 2], y: [10, 20] }
    ];
    const am = makeAxisManager({ traces });
    const sc = new SceneCompiler();
    sc.compile(traces, am, BASE_THEME, 400, 300, BASE_PADDING);

    assert.equal(sc.y2DomainNum, null);
  });

  await t.test("SceneCompiler normalizes y2 traces against y2 domain", () => {
    const traces = [
      { type: "scatter", x: [0, 1], y: [0, 100] },           // y1: 0-100
      { type: "scatter", x: [0, 1], y: [0, 10000], yaxis: "y2" } // y2: 0-10000
    ];
    const am = makeAxisManager({ traces });
    const sc = new SceneCompiler();
    sc.compile(traces, am, BASE_THEME, 400, 300, BASE_PADDING);

    // Both traces should have markers normalized to [0, 1] within their respective domains.
    const y1Norm = sc.markerNormByTrace.get(0);
    const y2Norm = sc.markerNormByTrace.get(1);
    assert.ok(y1Norm, "y1 trace should have normalized markers");
    assert.ok(y2Norm, "y2 trace should have normalized markers");

    // For both traces, the max y in normalized coords should be close to 1.
    // y1: y=100 should normalize to ~1.0 within y1 domain (0-100)
    // y2: y=10000 should normalize to ~1.0 within y2 domain (0-10000)
    const y1MaxNorm = y1Norm[3]; // second point, y component
    const y2MaxNorm = y2Norm[3]; // second point, y component
    assert.ok(
      Math.abs(y1MaxNorm - y2MaxNorm) < 0.15,
      `Both trace maxes should normalize similarly: y1=${y1MaxNorm}, y2=${y2MaxNorm}`
    );
  });

  await t.test("SceneCompiler handles mixed trace types with y2 binding", () => {
    const traces = [
      { type: "scatter", x: [1, 2], y: [10, 20] },
      { type: "bar", x: [1, 2], y: [500, 600], yaxis: "y2" },
      { type: "area", x: [1, 2], y: [15, 25], mode: "lines" }
    ];
    const am = makeAxisManager({ traces });
    const sc = new SceneCompiler();
    // Should not throw
    assert.doesNotThrow(() => {
      sc.compile(traces, am, BASE_THEME, 400, 300, BASE_PADDING);
    });

    assert.ok(sc.y2DomainNum != null, "y2 domain should be computed for bar y2 trace");
    assert.equal(sc.traceYAxisBinding.get(1), "y2");
  });

  await t.test("AxisManager.resolveAxisType('y') excludes y2 traces", () => {
    const am = makeAxisManager({
      traces: [
        { type: "scatter", x: [1, 2], y: [10, 20] },   // y1 = linear
        { type: "scatter", x: [1, 2], y: ["a", "b"], yaxis: "y2" } // y2 = category
      ]
    });
    // y1 should be linear (not polluted by y2 category data)
    assert.equal(am.resolveAxisType("y"), "linear");
    assert.equal(am.resolveAxisType("y2"), "category");
  });
});
