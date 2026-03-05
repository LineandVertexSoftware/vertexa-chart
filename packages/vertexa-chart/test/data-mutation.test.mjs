import assert from "node:assert/strict";
import test from "node:test";

function spy(impl = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return impl(...args); };
  fn.calls = [];
  return fn;
}

test("DataMutationManager", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: { WebGPURenderer: class {} }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: { OverlayD3: class {} }
  });

  const { DataMutationManager } = await import("../dist/DataMutationManager.js");

  /** Build a minimal manager with sensible defaults. */
  function makeManager(traces, opts = {}) {
    const sceneCompiler = {
      traceToMarkerLayerIdx: new Map([[0, 0]]),
      traceToLineLayerIdxs: new Map(),
      xDomainNum: [0, 10],
      yDomainNum: [0, 10],
      traceData: traces.map(tr => ({ xs: tr.x, ys: tr.y })),
      idRanges: traces.map((tr, i) => ({ traceIndex: i, baseId: i * 1000, count: tr.x.length })),
      markerNormByTraceDirty: new Set(),
      xSorted: [],
      ySorted: [],
      markerNormLayers: [],
      ...opts.sceneCompiler
    };
    const renderer = {
      appendToMarkerLayer: spy(),
      appendToLineLayer: spy(),
      updateMarkerLayerBaseId: spy(),
      ...opts.renderer
    };
    const axisManager = {
      resolveAxisType: () => "linear",
      // Return a fixed domain so computeAxisDomain doesn't apply auto-padding
      getAxis: () => ({ domain: [0, 10] }),
      getHoverMode: () => "closest",
      ...opts.axisManager
    };
    const mgr = new DataMutationManager(sceneCompiler, renderer, () => traces, axisManager);
    return { mgr, sceneCompiler, renderer, axisManager };
  }

  await t.test("returns false for non-scatter trace type", () => {
    const traces = [{ type: "bar", x: [1, 2], y: [3, 4], visible: true }];
    const { mgr } = makeManager(traces);
    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [3], yNew: [5], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, false);
  });

  await t.test("returns false when line smoothing is not none", () => {
    const traces = [
      { type: "scatter", x: [1, 2], y: [3, 4], line: { smoothing: "cubic" }, visible: true }
    ];
    const { mgr } = makeManager(traces);
    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [3], yNew: [5], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, false);
  });

  await t.test("returns false when trace has no GPU layer mapping", () => {
    const traces = [{ type: "scatter", x: [1, 2], y: [3, 4], visible: true }];
    const { mgr, sceneCompiler } = makeManager(traces);
    sceneCompiler.traceToMarkerLayerIdx.clear();
    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [3], yNew: [5], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, false);
  });

  await t.test("returns false for category x-axis", () => {
    const traces = [{ type: "scatter", x: ["a", "b"], y: [3, 4], visible: true }];
    const { mgr } = makeManager(traces, {
      axisManager: {
        resolveAxisType: (axis) => axis === "x" ? "category" : "linear",
        getAxis: () => undefined,
        getHoverMode: () => "closest"
      }
    });
    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: ["c"], yNew: [5], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, false);
  });

  await t.test("returns false when new point expands x-domain", () => {
    // trace x now includes 20; sceneCompiler still has the old domain before the append.
    // Use getAxis: undefined so computeAxisDomain auto-computes from data (with padding).
    // x=[0,5,10,20] → auto domain ≈ [-0.4, 20.4]; old xDomainNum = [-0.2, 10.2]
    const traces = [{ type: "scatter", x: [0, 5, 10, 20], y: [0, 5, 10, 10], visible: true }];
    const { mgr } = makeManager(traces, {
      axisManager: {
        resolveAxisType: () => "linear",
        getAxis: () => undefined,
        getHoverMode: () => "closest"
      },
      sceneCompiler: { xDomainNum: [-0.2, 10.2], yDomainNum: [-0.2, 10.2] }
    });
    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [20], yNew: [10], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, false);
  });

  await t.test("returns true and calls appendToMarkerLayer for valid scatter+markers", () => {
    const traces = [{ type: "scatter", x: [0, 5, 10], y: [0, 5, 10], mode: "markers", visible: true }];
    const { mgr, renderer, sceneCompiler } = makeManager(traces, {
      sceneCompiler: { xDomainNum: [0, 10], yDomainNum: [0, 10] }
    });
    sceneCompiler.traceToMarkerLayerIdx = new Map([[0, 0]]);
    sceneCompiler.traceData = [{ xs: traces[0].x, ys: traces[0].y }];
    sceneCompiler.idRanges = [{ traceIndex: 0, baseId: 0, count: 3 }];

    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [7], yNew: [7], nNew: 1, trimCount: 0 }
    ]);
    assert.equal(result, true);
    assert.equal(renderer.appendToMarkerLayer.calls.length, 1);
    assert.equal(renderer.appendToMarkerLayer.calls[0][0], 0); // layer index 0
    assert.ok(renderer.appendToMarkerLayer.calls[0][1] instanceof Float32Array);
    // baseId recalculation
    assert.equal(renderer.updateMarkerLayerBaseId.calls.length, 1);
  });

  await t.test("skips appendToMarkerLayer when nNew=0 but still returns true", () => {
    const traces = [{ type: "scatter", x: [0, 5], y: [0, 5], visible: true }];
    const { mgr, renderer, sceneCompiler } = makeManager(traces, {
      sceneCompiler: { xDomainNum: [0, 10], yDomainNum: [0, 10] }
    });
    sceneCompiler.traceData = [{ xs: traces[0].x, ys: traces[0].y }];
    sceneCompiler.idRanges = [{ traceIndex: 0, baseId: 0, count: 2 }];

    const result = mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [], yNew: [], nNew: 0, trimCount: 0 }
    ]);
    assert.equal(result, true);
    assert.equal(renderer.appendToMarkerLayer.calls.length, 0);
  });

  await t.test("rebuilds xSorted and ySorted when hovermode is 'x'", () => {
    const traces = [{ type: "scatter", x: [0, 5, 10], y: [0, 5, 10], mode: "markers", visible: true }];
    const { mgr, sceneCompiler } = makeManager(traces, {
      axisManager: {
        resolveAxisType: () => "linear",
        getAxis: () => ({ domain: [0, 10] }),
        getHoverMode: () => "x"
      }
    });
    sceneCompiler.traceToMarkerLayerIdx = new Map([[0, 0]]);
    sceneCompiler.traceData = [{ xs: traces[0].x, ys: traces[0].y }];
    sceneCompiler.idRanges = [{ traceIndex: 0, baseId: 0, count: 3 }];
    sceneCompiler.xSorted = [];
    sceneCompiler.ySorted = [];

    mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [7], yNew: [7], nNew: 1, trimCount: 0 }
    ]);

    assert.equal(sceneCompiler.xSorted.length, 1);
    assert.equal(sceneCompiler.xSorted[0].traceIndex, 0);
    assert.ok(sceneCompiler.xSorted[0].order instanceof Uint32Array);
    assert.ok(sceneCompiler.xSorted[0].xsNum instanceof Float64Array);
    assert.equal(sceneCompiler.ySorted.length, 1);
  });

  await t.test("recalculates baseIds across all id ranges", () => {
    // Two traces; append to trace 0, verify both baseIds are updated
    const traces = [
      { type: "scatter", x: [0, 5], y: [0, 5], mode: "markers", visible: true },
      { type: "scatter", x: [1, 6], y: [1, 6], mode: "markers", visible: true }
    ];
    const { mgr, renderer, sceneCompiler } = makeManager(traces, {
      sceneCompiler: { xDomainNum: [0, 10], yDomainNum: [0, 10] }
    });
    sceneCompiler.traceToMarkerLayerIdx = new Map([[0, 0], [1, 1]]);
    sceneCompiler.traceData = [
      { xs: traces[0].x, ys: traces[0].y },
      { xs: traces[1].x, ys: traces[1].y }
    ];
    sceneCompiler.idRanges = [
      { traceIndex: 0, baseId: 0, count: 2 },
      { traceIndex: 1, baseId: 2, count: 2 }
    ];

    mgr.tryAppendFast([
      { update: { traceIndex: 0 }, xNew: [7], yNew: [7], nNew: 1, trimCount: 0 }
    ]);

    // updateMarkerLayerBaseId called once per idRange
    assert.equal(renderer.updateMarkerLayerBaseId.calls.length, 2);
    // Trace 0 baseId stays 0, trace 1 baseId is now trace0.count
    assert.equal(renderer.updateMarkerLayerBaseId.calls[0][0], 0); // layer 0
    assert.equal(renderer.updateMarkerLayerBaseId.calls[0][1], 0); // baseId 0
    assert.equal(renderer.updateMarkerLayerBaseId.calls[1][0], 1); // layer 1
  });
});
