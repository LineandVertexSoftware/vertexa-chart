import assert from "node:assert/strict";
import test from "node:test";

test("PickingEngine", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: { WebGPURenderer: class {} }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: { OverlayD3: class {} }
  });

  const { PickingEngine } = await import("../dist/PickingEngine.js");

  const BASE_STATE = {
    width: 320,
    height: 240,
    padding: { l: 20, r: 20, t: 20, b: 20 },
    zoom: { k: 1, x: 0, y: 0 },
    hoverRpx: 20,
    traces: []
  };

  function makeCompiler(overrides = {}) {
    return {
      markerNormByTraceDirty: new Set(),
      markerNormByTrace: new Map(),
      idRanges: [],
      traceData: [],
      markerNormLayers: [],
      xSorted: [],
      ySorted: [],
      xDomainNum: [0, 1],
      yDomainNum: [0, 1],
      ...overrides
    };
  }

  function makeGridIndex(overrides = {}) {
    return {
      built: false,
      lastZoomK: 1,
      lastZoomX: 0,
      lastZoomY: 0,
      minScaleRelDelta: 0.06,
      minTransRelDelta: 0.3,
      cellPx: 50,
      gridMap: new Map(),
      gridX: new Float32Array(0),
      gridY: new Float32Array(0),
      gridTrace: new Int32Array(0),
      gridPoint: new Int32Array(0),
      key: (cx, cy) => `${cx},${cy}`,
      ...overrides
    };
  }

  function makeEngine(compilerOvr = {}, gridOvr = {}, stateOvr = {}, axisOvr = {}) {
    const sceneCompiler = makeCompiler(compilerOvr);
    const gridIndex = makeGridIndex(gridOvr);
    const getState = () => ({ ...BASE_STATE, ...stateOvr });
    const axisManager = { resolveAxisType: () => "linear", ...axisOvr };
    const engine = new PickingEngine(sceneCompiler, gridIndex, getState, axisManager);
    return { engine, sceneCompiler, gridIndex };
  }

  await t.test("screenToPlot subtracts padding", () => {
    const { engine } = makeEngine();
    const result = engine.screenToPlot(80, 60);
    assert.equal(result.xPlot, 60); // 80 - 20 (padding.l)
    assert.equal(result.yPlot, 40); // 60 - 20 (padding.t)
  });

  await t.test("toScreenFromNorm applies zoom and padding", () => {
    const { engine } = makeEngine();
    // plotW = 320 - 20 - 20 = 280, plotH = 240 - 20 - 20 = 200
    // ox = 20, oy = 20, k = 1, tx = 0, ty = 0
    // screenX = 20 + (0.5 * 280) * 1 + 0 = 20 + 140 = 160
    // screenY = 20 + (0.5 * 200) * 1 + 0 = 20 + 100 = 120
    const result = engine.toScreenFromNorm(0.5, 0.5);
    assert.equal(result.screenX, 160);
    assert.equal(result.screenY, 120);
  });

  await t.test("toScreenFromNorm applies zoom scale and translation", () => {
    const { engine } = makeEngine({}, {}, { zoom: { k: 2, x: 10, y: 5 } });
    // plotW = 280, plotH = 200
    // screenX = 20 + (0.5 * 280) * 2 + 10 = 20 + 280 + 10 = 310
    // screenY = 20 + (0.5 * 200) * 2 + 5 = 20 + 200 + 5 = 225
    const result = engine.toScreenFromNorm(0.5, 0.5);
    assert.equal(result.screenX, 310);
    assert.equal(result.screenY, 225);
  });

  await t.test("idToHit returns null for id=0", () => {
    const { engine } = makeEngine();
    assert.equal(engine.idToHit(0), null);
  });

  await t.test("idToHit resolves trace and point from id ranges", () => {
    const norm = new Float32Array([0, 1, 0.5, 0.5]); // 2 points
    const { engine, sceneCompiler } = makeEngine({
      idRanges: [{ traceIndex: 0, baseId: 0, count: 2 }],
      traceData: [{ xs: [10, 20], ys: [30, 40] }],
      markerNormByTrace: new Map([[0, norm]])
    });
    // id=2 → gid=1 → range [0, 2) → pointIndex=1
    const hit = engine.idToHit(2);
    assert.ok(hit !== null);
    assert.equal(hit.traceIndex, 0);
    assert.equal(hit.pointIndex, 1);
    assert.equal(hit.x, 20);
    assert.equal(hit.y, 40);
  });

  await t.test("idToHit returns null for id beyond all ranges", () => {
    const { engine } = makeEngine({
      idRanges: [{ traceIndex: 0, baseId: 0, count: 2 }],
      traceData: [{ xs: [1, 2], ys: [3, 4] }],
      markerNormByTrace: new Map([[0, new Float32Array([0, 1, 0.5, 0.5])]])
    });
    assert.equal(engine.idToHit(100), null);
  });

  await t.test("getNormPoint returns cached normalized point", () => {
    const norm = new Float32Array([0.2, 0.8, 0.6, 0.4]);
    const { engine } = makeEngine({
      markerNormByTrace: new Map([[0, norm]])
    });
    const result = engine.getNormPoint(0, 1); // second point
    assert.ok(result !== null);
    assert.ok(Math.abs(result.xn - 0.6) < 1e-6);
    assert.ok(Math.abs(result.yn - 0.4) < 1e-6);
  });

  await t.test("getNormPoint rebuilds from trace data when dirty", () => {
    // Dirty flag set; no cached norm; trace has real data
    const trace = { type: "scatter", x: [0, 1], y: [0, 1], visible: true };
    const { engine, sceneCompiler } = makeEngine(
      {
        markerNormByTraceDirty: new Set([0]),
        markerNormByTrace: new Map(),
        xDomainNum: [0, 1],
        yDomainNum: [0, 1]
      },
      {},
      { traces: [trace] }
    );
    const result = engine.getNormPoint(0, 0);
    assert.ok(result !== null);
    // After rebuilding, dirty flag should be cleared
    assert.equal(sceneCompiler.markerNormByTraceDirty.has(0), false);
    // first point x=0 in domain [0,1] → xn=0
    assert.ok(Math.abs(result.xn) < 1e-6);
  });

  await t.test("cpuPickClosest falls back to scan when grid not built", () => {
    // With no markerNormLayers, scan finds nothing → null
    const { engine } = makeEngine({ markerNormLayers: [] }, { built: false });
    const result = engine.cpuPickClosest(160, 120);
    assert.equal(result, null);
  });

  await t.test("cpuPickClosest falls back to scan when zoom scale changed beyond threshold", () => {
    // grid built with k=1 but current zoom k=1.1 → dk=0.1 >= 0.06 → fallback
    const { engine } = makeEngine(
      { markerNormLayers: [] },
      { built: true, lastZoomK: 1, minScaleRelDelta: 0.06 },
      { zoom: { k: 1.1, x: 0, y: 0 } }
    );
    const result = engine.cpuPickClosest(160, 120);
    assert.equal(result, null); // scan with empty layers → null
  });

  await t.test("cpuPickClosest uses grid when zoom is valid and finds point", () => {
    // Setup: grid built, zoom unchanged, one point in grid at (150, 120)
    const norm = new Float32Array([
      // point 0: xn=(150-20)/280 ≈ 0.4643, yn=(120-20)/200 = 0.5
      (150 - 20) / 280, (120 - 20) / 200
    ]);
    const gridX = new Float32Array([150]);
    const gridY = new Float32Array([120]);
    const gridTrace = new Int32Array([0]);
    const gridPoint = new Int32Array([0]);
    const gridMap = new Map([["3,2", [0]]]); // cx=floor(150/50)=3, cy=floor(120/50)=2
    const { engine } = makeEngine(
      {
        idRanges: [{ traceIndex: 0, baseId: 0, count: 1 }],
        traceData: [{ xs: [5], ys: [3] }],
        markerNormByTrace: new Map([[0, norm]])
      },
      {
        built: true,
        lastZoomK: 1,
        lastZoomX: 0,
        lastZoomY: 0,
        minScaleRelDelta: 0.06,
        minTransRelDelta: 0.3,
        cellPx: 50,
        gridMap,
        gridX,
        gridY,
        gridTrace,
        gridPoint,
        key: (cx, cy) => `${cx},${cy}`
      },
      { zoom: { k: 1, x: 0, y: 0 }, hoverRpx: 30 }
    );

    const result = engine.cpuPickClosest(152, 122);
    assert.ok(result !== null, "should find a point");
    assert.equal(result.traceIndex, 0);
    assert.equal(result.pointIndex, 0);
    assert.equal(result.x, 5);
    assert.equal(result.y, 3);
  });

  await t.test("cpuPickFallbackScan returns closest point within radius", () => {
    // 2 points; cursor near point 1
    const pts = new Float32Array([0, 1, 0.5, 0.5]); // [xn0,yn0, xn1,yn1]
    const { engine } = makeEngine({
      markerNormLayers: [{ traceIndex: 0, points01: pts }],
      traceData: [{ xs: [0, 1], ys: [0, 1] }]
    });
    // point 0 at screen (20, 220), point 1 at screen (160, 120)
    // cursor at (165, 125) → closer to point 1
    const result = engine.cpuPickFallbackScan(165, 125);
    assert.ok(result !== null);
    assert.equal(result.traceIndex, 0);
    assert.equal(result.pointIndex, 1);
  });

  await t.test("cpuPickFallbackScan returns null when no points within radius", () => {
    const pts = new Float32Array([0, 0]); // single point at top-left screen corner
    const { engine } = makeEngine({
      markerNormLayers: [{ traceIndex: 0, points01: pts }],
      traceData: [{ xs: [0], ys: [0] }]
    });
    // point at screen (20, 220), cursor at (160, 120) — far away
    const result = engine.cpuPickFallbackScan(160, 120);
    assert.equal(result, null);
  });

  await t.test("pickSnapX returns point with closest x", () => {
    // 3 points at x=1,5,9 with cursor at x=5 → should pick point 1 (x=5)
    const norm = new Float32Array([
      0, 0.9,    // point 0: xn=0 → screenX=20
      0.5, 0.5,  // point 1: xn=0.5 → screenX=160
      1, 0.1     // point 2: xn=1 → screenX=300
    ]);
    const { engine, sceneCompiler } = makeEngine({
      markerNormByTrace: new Map([[0, norm]]),
      traceData: [{ xs: [1, 5, 9], ys: [10, 20, 30] }],
      xSorted: [
        {
          traceIndex: 0,
          order: new Uint32Array([0, 1, 2]),
          xsNum: new Float64Array([1, 5, 9])
        }
      ]
    });
    const result = engine.pickSnapX(5, 160); // cursorXNum=5, cursorScreenX=160
    assert.ok(result !== null);
    assert.equal(result.traceIndex, 0);
    assert.equal(result.pointIndex, 1);
    assert.equal(result.x, 5);
    assert.equal(result.y, 20);
  });

  await t.test("pickSnapY returns point with closest y", () => {
    // 3 points at y=0,1,2 with cursor at y=1 → should pick point 1 (y=1)
    const norm = new Float32Array([
      0.5, 1.0,  // point 0: yn=1.0 → screenY=220
      0.5, 0.5,  // point 1: yn=0.5 → screenY=120
      0.5, 0.0   // point 2: yn=0.0 → screenY=20
    ]);
    const { engine } = makeEngine({
      markerNormByTrace: new Map([[0, norm]]),
      traceData: [{ xs: [5, 5, 5], ys: [0, 1, 2] }],
      ySorted: [
        {
          traceIndex: 0,
          order: new Uint32Array([0, 1, 2]),
          ysNum: new Float64Array([0, 1, 2])
        }
      ]
    });
    const result = engine.pickSnapY(1, 120); // cursorYNum=1, cursorScreenY=120
    assert.ok(result !== null);
    assert.equal(result.traceIndex, 0);
    assert.equal(result.pointIndex, 1);
    assert.equal(result.x, 5);
    assert.equal(result.y, 1);
  });
});
