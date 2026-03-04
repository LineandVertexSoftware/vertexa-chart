import assert from "node:assert/strict";
import test from "node:test";

function spy(impl = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl(...args);
  };
  fn.calls = [];
  return fn;
}

function elementStub() {
  const attrs = new Map();
  return {
    style: {},
    setAttribute: spy((key, value) => {
      attrs.set(String(key), String(value));
    }),
    getAttribute: (key) => attrs.get(String(key))
  };
}

function tooltipElementStub() {
  const attrs = new Map();
  const el = {
    style: {},
    textContent: "",
    innerHTML: "",
    children: [],
    setAttribute: spy((key, value) => {
      attrs.set(String(key), String(value));
    }),
    removeAttribute: spy((key) => {
      attrs.delete(String(key));
    }),
    getAttribute: (key) => attrs.get(String(key)),
    replaceChildren: (...nodes) => {
      el.children = nodes;
      el.textContent = "";
      el.innerHTML = "";
    }
  };
  return el;
}

function keyboardEventStub(key, extra = {}) {
  const event = {
    key,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    preventDefault: spy(() => {
      event.defaultPrevented = true;
    }),
    ...extra
  };
  return event;
}

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

const BASE_PADDING = { l: 20, r: 20, t: 20, b: 20 };
const BASE_ZOOM = { k: 1, x: 0, y: 0 };

function baseChart(Chart) {
  return Object.assign(Object.create(Chart.prototype), {
    destroyed: false,
    initialized: true,
    width: 320,
    height: 240,
    padding: BASE_PADDING,
    layout: {},
    theme: BASE_THEME,
    traces: [],
    zoom: BASE_ZOOM,
    dpr: 1
  });
}

// Minimal AxisManager mock for SceneCompiler.compile
function mockAxisManager(overrides = {}) {
  return {
    resolveAxisType: () => "linear",
    getAxis: () => undefined,
    getHoverMode: () => "closest",
    ...overrides
  };
}

test("interaction suite (zoom/pan, hover, legend toggle, resize)", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: {
      WebGPURenderer: class WebGPURendererStub {}
    }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: {
      OverlayD3: class OverlayD3Stub {}
    }
  });

  const { Chart } = await import("../dist/Chart.js");
  const { GridIndex } = await import("../dist/GridIndex.js");
  const { SceneCompiler } = await import("../dist/SceneCompiler.js");
  const { HoverManager } = await import("../dist/HoverManager.js");
  const { AxisManager } = await import("../dist/AxisManager.js");
  const { ExportManager } = await import("../dist/ExportManager.js");
  const { computeAxisDomain } = await import("../dist/scene.js");

  await t.test("zoom/pan triggers grid rebuild thresholds", () => {
    const gridIndex = new GridIndex();
    const baseParams = {
      markerNormLayers: [],
      width: 320,
      height: 240,
      padding: BASE_PADDING,
      zoom: { k: 1, x: 0, y: 0 }
    };

    // Build at initial zoom to establish baseline
    gridIndex.build(baseParams);

    // Small pan (40px / plotW=280 = 0.143 < 0.3) — should NOT rebuild
    assert.equal(gridIndex.shouldRebuild({ ...baseParams, zoom: { k: 1, x: 40, y: 0 } }), false);

    // Large pan (90px / 280 = 0.321 > 0.3) — should rebuild
    assert.equal(gridIndex.shouldRebuild({ ...baseParams, zoom: { k: 1, x: 90, y: 0 } }), true);

    // Scale change (dk = 0.08/1 = 0.08 >= 0.06) — should rebuild
    assert.equal(gridIndex.shouldRebuild({ ...baseParams, zoom: { k: 1.08, x: 0, y: 0 } }), true);
  });

  await t.test("hover outside plot clears guides/highlight and emits event", () => {
    const setHoverGuides = spy();
    const setHoverHighlight = spy();
    const requestRender = spy();
    const hoverEvents = [];
    const tooltip = tooltipElementStub();

    const hoverManager = new HoverManager(
      null, // pickingEngine — not used for outside hover
      { setHoverHighlight }, // renderer
      () => ({ setHoverGuides }), // getOverlay
      tooltip,
      () => ({
        destroyed: false,
        hoverThrottleMs: 0,
        pickingMode: "cpu",
        width: 320,
        height: 240,
        dpr: 1,
        padding: BASE_PADDING,
        zoom: BASE_ZOOM,
        traces: [],
        theme: BASE_THEME
      }),
      { onHover: (event) => hoverEvents.push(event) },
      { getHoverMode: () => "closest" }, // axisManager
      { markerNormLayers: [] }, // sceneCompiler
      requestRender
    );

    hoverManager.onHover({
      inside: false,
      xSvg: 11,
      ySvg: 22,
      xPlot: 0,
      yPlot: 0,
      xData: 11,
      yData: 22
    });

    assert.equal(setHoverGuides.calls.length, 1);
    assert.deepEqual(setHoverGuides.calls[0], [null]);
    assert.equal(setHoverHighlight.calls.length, 1);
    assert.deepEqual(setHoverHighlight.calls[0], [null]);
    // tooltip is hidden via setAttribute
    assert.equal(tooltip.getAttribute("aria-hidden"), "true");
    assert.equal(requestRender.calls.length, 1);

    assert.equal(hoverEvents.length, 1);
    assert.equal(hoverEvents[0].inside, false);
    assert.equal(hoverEvents[0].mode, "closest");
    assert.equal(hoverEvents[0].point, null);
  });

  await t.test("legend toggle flips visibility and emits hook payload", () => {
    const rendererSetLayers = spy();
    const rebuildGridIndex = spy(() => ({ buildMs: 0 }));
    const setAxes = spy();
    const setGrid = spy();
    const setAnnotations = spy();
    const setLegend = spy();
    const scheduleGridRebuild = spy();
    const render = spy();
    const legendEvents = [];

    const chart = baseChart(Chart);
    Object.assign(chart, {
      traces: [{ type: "scatter", x: [1], y: [2], visible: true, name: "A" }],
      sceneCompiler: {
        compile: spy(() => ({ markers: [], lines: [] })),
        xDomainNum: [0, 1],
        yDomainNum: [0, 1],
        markerNormLayers: []
      },
      renderer: { setLayers: rendererSetLayers },
      gridIndex: { build: rebuildGridIndex, scheduleRebuild: scheduleGridRebuild },
      axisManager: {
        resolveAxisType: () => "linear",
        makeOverlayAxisSpec: () => ({ type: "linear", domain: [0, 1] }),
        resolveOverlayGrid: () => ({ show: true }),
        makeOverlayAnnotations: () => [],
        isLegendVisible: () => false
      },
      overlay: { setAxes, setGrid, setAnnotations, setLegend },
      enablePerfMonitoring: false,
      render,
      onLegendToggleHook: (event) => legendEvents.push(event)
    });

    chart.toggleTrace(0);
    assert.equal(chart.traces[0].visible, "legendonly");
    assert.equal(legendEvents.length, 1);
    assert.equal(legendEvents[0].previousVisible, true);
    assert.equal(legendEvents[0].visible, "legendonly");

    chart.toggleTrace(0);
    assert.equal(chart.traces[0].visible, true);
    assert.equal(legendEvents.length, 2);
    assert.equal(legendEvents[1].previousVisible, "legendonly");
    assert.equal(legendEvents[1].visible, true);

    assert.equal(rendererSetLayers.calls.length, 2);
    assert.equal(rebuildGridIndex.calls.length, 2);
    assert.equal(setAxes.calls.length, 2);
    assert.equal(setGrid.calls.length, 2);
    assert.equal(setAnnotations.calls.length, 2);
    assert.equal(setLegend.calls.length, 2);
    assert.equal(scheduleGridRebuild.calls.length, 2);
    assert.equal(render.calls.length, 2);
  });

  await t.test("resize updates viewport and triggers redraw pipeline", () => {
    const overlaySetSize = spy();
    const render = spy();
    const scheduleGridRebuild = spy();
    const container = elementStub();
    const canvas = elementStub();
    const svgGrid = elementStub();
    const svg = elementStub();

    const chart = baseChart(Chart);
    Object.assign(chart, {
      container,
      canvas,
      svgGrid,
      svg,
      overlay: { setSize: overlaySetSize },
      render,
      gridIndex: { scheduleRebuild: scheduleGridRebuild },
      aspectLockEnabled: false
    });

    chart.setSize(640, 480);

    assert.equal(chart.width, 640);
    assert.equal(chart.height, 480);
    assert.equal(container.style.width, "640px");
    assert.equal(container.style.height, "480px");
    assert.equal(canvas.style.width, "640px");
    assert.equal(canvas.style.height, "480px");
    assert.equal(svgGrid.getAttribute("width"), "640");
    assert.equal(svgGrid.getAttribute("height"), "480");
    assert.equal(svg.getAttribute("width"), "640");
    assert.equal(svg.getAttribute("height"), "480");
    assert.deepEqual(overlaySetSize.calls[0], [640, 480, chart.padding]);
    assert.equal(render.calls.length, 1);
    assert.equal(scheduleGridRebuild.calls.length, 1);
  });

  await t.test("keyboard navigation pans, zooms, and resets zoom", () => {
    const panBy = spy();
    const zoomBy = spy();
    const resetZoom = spy();

    const chart = baseChart(Chart);
    Object.assign(chart, {
      initialized: true,
      a11y: { label: "", description: "", keyboardNavigation: true, highContrast: false },
      overlay: { panBy, zoomBy, resetZoom }
    });

    chart.onContainerKeyDown(keyboardEventStub("ArrowLeft"));
    chart.onContainerKeyDown(keyboardEventStub("ArrowRight", { shiftKey: true }));
    chart.onContainerKeyDown(keyboardEventStub("+"));
    chart.onContainerKeyDown(keyboardEventStub("-"));
    chart.onContainerKeyDown(keyboardEventStub("0"));

    assert.deepEqual(panBy.calls[0], [-40, 0]);
    assert.deepEqual(panBy.calls[1], [120, 0]);
    assert.equal(zoomBy.calls.length, 2);
    assert.equal(zoomBy.calls[0][0] > 1, true);
    assert.equal(zoomBy.calls[1][0] < 1, true);
    assert.equal(resetZoom.calls.length, 1);
  });

  await t.test("keyboard navigation ignores text entry targets", () => {
    const panBy = spy();

    const chart = baseChart(Chart);
    Object.assign(chart, {
      initialized: true,
      a11y: { label: "", description: "", keyboardNavigation: true, highContrast: false },
      overlay: { panBy, zoomBy: spy(), resetZoom: spy() }
    });

    chart.onContainerKeyDown(keyboardEventStub("ArrowLeft", {
      target: { tagName: "INPUT", isContentEditable: false }
    }));

    assert.equal(panBy.calls.length, 0);
  });

  await t.test("box select emits selected point indices grouped by trace", () => {
    const selectEvents = [];

    // toScreenFromNorm with padding={l:20,r:20,t:20,b:20}, width=320, height=240, zoom={k:1,x:0,y:0}:
    // screenX = 20 + xn * 280, screenY = 20 + yn * 200
    const mockPickingEngine = {
      toScreenFromNorm(xn, yn) {
        return { screenX: 20 + xn * 280, screenY: 20 + yn * 200 };
      }
    };
    const markerNormLayers = [
      { traceIndex: 0, points01: new Float32Array([0.1, 0.1, 0.4, 0.4, 0.9, 0.9]) },
      { traceIndex: 2, points01: new Float32Array([0.3, 0.35, 0.8, 0.2]) }
    ];

    const hoverManager = new HoverManager(
      mockPickingEngine,
      null,
      () => undefined,
      tooltipElementStub(),
      () => ({ destroyed: false, hoverThrottleMs: 0, pickingMode: "cpu", width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, traces: [], theme: BASE_THEME }),
      { onSelect: (event) => selectEvents.push(event) },
      { getHoverMode: () => "closest" },
      { markerNormLayers },
      () => {}
    );

    hoverManager.handleSelection({
      x0Svg: 40,
      y0Svg: 30,
      x1Svg: 170,
      y1Svg: 120,
      x0Data: 0,
      y0Data: 0,
      x1Data: 1,
      y1Data: 1
    });

    assert.equal(selectEvents.length, 1);
    assert.equal(selectEvents[0].totalPoints, 3);
    assert.deepEqual(selectEvents[0].points, [
      { traceIndex: 0, pointIndices: [0, 1] },
      { traceIndex: 2, pointIndices: [0] }
    ]);
    assert.equal(selectEvents[0].box.x0, 40);
    assert.equal(selectEvents[0].box.y1, 120);
    assert.equal(selectEvents[0].mode, "box");
  });

  await t.test("lasso select emits selected point indices grouped by trace", () => {
    const selectEvents = [];

    const mockPickingEngine = {
      toScreenFromNorm(xn, yn) {
        return { screenX: 20 + xn * 280, screenY: 20 + yn * 200 };
      }
    };
    const markerNormLayers = [
      { traceIndex: 0, points01: new Float32Array([0.1, 0.1, 0.4, 0.4, 0.9, 0.9]) },
      { traceIndex: 2, points01: new Float32Array([0.3, 0.35, 0.8, 0.2]) }
    ];

    const hoverManager = new HoverManager(
      mockPickingEngine,
      null,
      () => undefined,
      tooltipElementStub(),
      () => ({ destroyed: false, hoverThrottleMs: 0, pickingMode: "cpu", width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, traces: [], theme: BASE_THEME }),
      { onSelect: (event) => selectEvents.push(event) },
      { getHoverMode: () => "closest" },
      { markerNormLayers },
      () => {}
    );

    hoverManager.handleSelection({
      mode: "lasso",
      x0Svg: 40,
      y0Svg: 30,
      x1Svg: 170,
      y1Svg: 130,
      x0Data: 0,
      y0Data: 0,
      x1Data: 1,
      y1Data: 1,
      lassoSvg: [
        { x: 40, y: 30 },
        { x: 170, y: 30 },
        { x: 170, y: 130 },
        { x: 40, y: 130 }
      ],
      lassoPlot: [
        { x: 20, y: 10 },
        { x: 150, y: 10 },
        { x: 150, y: 110 },
        { x: 20, y: 110 }
      ],
      lassoData: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ]
    });

    assert.equal(selectEvents.length, 1);
    assert.equal(selectEvents[0].mode, "lasso");
    assert.equal(selectEvents[0].totalPoints, 3);
    assert.deepEqual(selectEvents[0].points, [
      { traceIndex: 0, pointIndices: [0, 1] },
      { traceIndex: 2, pointIndices: [0] }
    ]);
    assert.equal(selectEvents[0].lasso.svg.length, 4);
  });

  await t.test("tooltip formatter provides plain-text tooltip content", () => {
    const tooltip = tooltipElementStub();

    const hoverManager = new HoverManager(
      null, null, () => undefined, tooltip,
      () => ({ destroyed: false, hoverThrottleMs: 0, pickingMode: "cpu", width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, traces: [], theme: BASE_THEME }),
      { tooltipFormatter: (ctx) => `#${ctx.traceIndex}:${ctx.pointIndex} x=${ctx.x} y=${ctx.y}` },
      { getHoverMode: () => "closest" },
      { markerNormLayers: [] },
      () => {}
    );

    hoverManager.showTooltip({
      traceIndex: 1,
      pointIndex: 7,
      trace: { type: "scatter", x: [1], y: [2] },
      x: 42,
      y: 9,
      screenX: 50,
      screenY: 60,
      defaultLabel: "default"
    });

    assert.equal(tooltip.textContent, "#1:7 x=42 y=9");
    assert.equal(tooltip.style.transform, "translate(62px, 72px)");
  });

  await t.test("tooltip renderer can return html string and hide tooltip", () => {
    const tooltip = tooltipElementStub();

    const hoverManager = new HoverManager(
      null, null, () => undefined, tooltip,
      () => ({ destroyed: false, hoverThrottleMs: 0, pickingMode: "cpu", width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, traces: [], theme: BASE_THEME }),
      { tooltipRenderer: (ctx) => (ctx.pointIndex % 2 === 0 ? `<b>${ctx.defaultLabel}</b>` : null) },
      { getHoverMode: () => "closest" },
      { markerNormLayers: [] },
      () => {}
    );

    hoverManager.showTooltip({
      traceIndex: 0,
      pointIndex: 4,
      trace: { type: "scatter", x: [1], y: [2] },
      x: 1,
      y: 2,
      screenX: 10,
      screenY: 20,
      defaultLabel: "rendered"
    });
    assert.equal(tooltip.innerHTML, "<b>rendered</b>");
    assert.equal(tooltip.style.transform, "translate(22px, 32px)");

    hoverManager.showTooltip({
      traceIndex: 0,
      pointIndex: 5,
      trace: { type: "scatter", x: [1], y: [2] },
      x: 1,
      y: 2,
      screenX: 10,
      screenY: 20,
      defaultLabel: "rendered"
    });
    assert.equal(tooltip.style.transform, "translate(-9999px,-9999px)");
  });

  await t.test("fixed tick values are propagated to overlay axis spec", () => {
    const axisManager = new AxisManager(() => ({
      layout: {
        xaxis: { tickValues: [0, 2.5, 5] },
        yaxis: {}
      },
      traces: [],
      theme: BASE_THEME,
      zoom: BASE_ZOOM,
      xDomainNum: [0, 5],
      yDomainNum: [0, 1],
      width: 320,
      height: 240,
      padding: BASE_PADDING
    }));

    const linear = axisManager.makeOverlayAxisSpec("x", "linear", [0, 5]);
    assert.deepEqual(linear.tickValues, [0, 2.5, 5]);

    const t0 = new Date("2024-01-01T00:00:00.000Z");
    const t1 = new Date("2024-01-01T01:00:00.000Z");

    const axisManagerTime = new AxisManager(() => ({
      layout: {
        xaxis: { tickValues: [t0, t1.getTime()] },
        yaxis: {}
      },
      traces: [],
      theme: BASE_THEME,
      zoom: BASE_ZOOM,
      xDomainNum: [t0.getTime(), t1.getTime()],
      yDomainNum: [0, 1],
      width: 320,
      height: 240,
      padding: BASE_PADDING
    }));

    const timeSpec = axisManagerTime.makeOverlayAxisSpec("x", "time", [t0.getTime(), t1.getTime()]);
    assert.equal(timeSpec.tickValues.length, 2);
    assert.equal(timeSpec.tickValues[0] instanceof Date, true);
    assert.equal(timeSpec.tickValues[1] instanceof Date, true);
    assert.equal(timeSpec.tickValues[0].getTime(), t0.getTime());
    assert.equal(timeSpec.tickValues[1].getTime(), t1.getTime());
  });

  await t.test("appendPoints appends incrementally and applies sliding window", () => {
    const rendererSetLayers = spy();
    const setAxes = spy();
    const setGrid = spy();
    const setAnnotations = spy();
    const scheduleGridRebuild = spy();
    const render = spy();

    const chart = baseChart(Chart);
    Object.assign(chart, {
      traces: [
        { type: "scatter", x: [0, 1], y: [10, 11], visible: true, name: "A" },
        { type: "scatter", x: new Float32Array([0, 1]), y: new Float32Array([20, 21]), visible: true, name: "B" }
      ],
      dataMutationManager: { tryAppendFast: () => false },
      sceneCompiler: {
        compile: spy(() => ({ markers: [], lines: [] })),
        xDomainNum: [0, 1],
        yDomainNum: [0, 1],
        markerNormLayers: []
      },
      renderer: { setLayers: rendererSetLayers },
      axisManager: {
        resolveAxisType: () => "linear",
        makeOverlayAxisSpec: () => ({ type: "linear", domain: [0, 1] }),
        resolveOverlayGrid: () => ({ show: true }),
        makeOverlayAnnotations: () => []
      },
      overlay: { setAxes, setGrid, setAnnotations },
      gridIndex: { scheduleRebuild: scheduleGridRebuild },
      render
    });

    chart.appendPoints(
      [
        { traceIndex: 0, x: [2, 3, 4], y: [12, 13, 14] },
        { traceIndex: 1, x: [2, 3], y: [22, 23], maxPoints: 3 }
      ],
      { maxPoints: 4 }
    );

    assert.deepEqual(chart.traces[0].x, [1, 2, 3, 4]);
    assert.deepEqual(chart.traces[0].y, [11, 12, 13, 14]);
    assert.deepEqual(chart.traces[1].x, [1, 2, 3]);
    assert.deepEqual(chart.traces[1].y, [21, 22, 23]);

    assert.equal(rendererSetLayers.calls.length, 1);
    assert.equal(setAxes.calls.length, 1);
    assert.equal(setGrid.calls.length, 1);
    assert.equal(setAnnotations.calls.length, 1);
    assert.equal(scheduleGridRebuild.calls.length, 1);
    assert.equal(render.calls.length, 1);
  });

  await t.test("makeOverlayAnnotations converts annotation datums by axis type", () => {
    const t0 = new Date("2024-01-01T00:00:00.000Z");
    const axisManager = new AxisManager(() => ({
      layout: {
        annotations: [
          { type: "line", x0: t0, y0: 1, x1: t0.getTime() + 3600000, y1: 2 },
          { type: "label", x: t0, y: 3, text: "checkpoint" }
        ]
      },
      traces: [],
      theme: BASE_THEME,
      zoom: BASE_ZOOM,
      xDomainNum: [0, 1],
      yDomainNum: [0, 1],
      width: 320,
      height: 240,
      padding: BASE_PADDING
    }));

    const out = axisManager.makeOverlayAnnotations("time", "linear");
    assert.equal(out.length, 2);
    assert.equal(out[0].type, "line");
    assert.equal(out[0].x0 instanceof Date, true);
    assert.equal(out[0].x1 instanceof Date, true);
    assert.equal(out[1].type, "label");
    assert.equal(out[1].x instanceof Date, true);
  });

  await t.test("appendPoints throws for unknown trace index", () => {
    const chart = baseChart(Chart);
    chart.traces = [{ type: "scatter", x: [0], y: [0], visible: true }];

    assert.throws(
      () => chart.appendPoints({ traceIndex: 4, x: [1], y: [1] }),
      /traceIndex 4 is out of range/
    );
  });

  await t.test("exportPng composites base canvas and svg layers into PNG blob", async () => {
    const drawSvgLayerToContext = spy(async () => {});
    const fillRect = spy();
    const drawImage = spy();

    const ctx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillStyle: "",
      fillRect,
      drawImage
    };

    const blob = new Blob(["png"], { type: "image/png" });
    const exportCanvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb, type) => {
        assert.equal(type, "image/png");
        cb(blob);
      }
    };

    const chart = baseChart(Chart);
    Object.assign(chart, {
      canvas: { id: "render-canvas" },
      svgGrid: { id: "grid-layer" },
      svg: { id: "overlay-layer" }
    });

    const exportManager = new ExportManager(
      () => ({ width: chart.width, height: chart.height, dpr: chart.dpr, padding: chart.padding, zoom: chart.zoom, theme: chart.theme, traces: chart.traces }),
      {}, // renderer — no captureFrameImageData
      () => ({ canvas: chart.canvas, svgGrid: chart.svgGrid, svg: chart.svg }),
      async () => {}
    );
    // Override private methods on the instance (TypeScript private ≠ JS private)
    exportManager.createExportCanvas = (w, h) => {
      exportCanvas.width = w;
      exportCanvas.height = h;
      return exportCanvas;
    };
    exportManager.drawSvgLayerToContext = drawSvgLayerToContext;
    chart.exportManager = exportManager;

    const out = await chart.exportPng({ pixelRatio: 2, background: "#010203" });
    assert.equal(out, blob);
    assert.equal(exportCanvas.width, 640);
    assert.equal(exportCanvas.height, 480);
    assert.equal(ctx.fillStyle, "#010203");
    assert.deepEqual(fillRect.calls[0], [0, 0, 640, 480]);
    assert.deepEqual(drawImage.calls[0], [chart.canvas, 0, 0, 640, 480]);
    assert.equal(drawSvgLayerToContext.calls.length, 2);
    assert.equal(drawSvgLayerToContext.calls[0][1], chart.svgGrid);
    assert.equal(drawSvgLayerToContext.calls[1][1], chart.svg);
  });

  await t.test("exportSvg embeds plot image and svg layers into SVG blob", async () => {
    const captureCanvasLayerDataUrl = spy(async (pixelRatio) => {
      assert.equal(pixelRatio, 2);
      return "data:image/png;base64,AAAA";
    });
    const serializeSvgLayerForExport = spy((svg) => `<svg data-layer="${svg.id}"></svg>`);

    const chart = baseChart(Chart);
    Object.assign(chart, {
      svgGrid: { id: "grid-layer" },
      svg: { id: "overlay-layer" }
    });

    const exportManager = new ExportManager(
      () => ({ width: chart.width, height: chart.height, dpr: chart.dpr, padding: chart.padding, zoom: chart.zoom, theme: chart.theme, traces: chart.traces }),
      {},
      () => ({ canvas: null, svgGrid: chart.svgGrid, svg: chart.svg }),
      async () => {}
    );
    exportManager.captureCanvasLayerDataUrl = captureCanvasLayerDataUrl;
    exportManager.serializeSvgLayerForExport = serializeSvgLayerForExport;
    chart.exportManager = exportManager;

    const out = await chart.exportSvg({ pixelRatio: 2, background: "#010203" });
    const markup = await out.text();
    assert.equal(out.type, "image/svg+xml;charset=utf-8");
    assert.equal(captureCanvasLayerDataUrl.calls.length, 1);
    assert.equal(serializeSvgLayerForExport.calls.length, 2);
    assert.match(markup, /fill="#010203"/);
    assert.match(markup, /data:image\/png;base64,AAAA/);
    assert.match(markup, /data-layer="grid-layer"/);
    assert.match(markup, /data-layer="overlay-layer"/);
  });

  await t.test("exportCsvPoints flattens visible traces and can include hidden traces", async () => {
    const traces = [
      {
        type: "scatter",
        name: "Alpha,One",
        x: [new Date("2026-01-01T00:00:00.000Z"), 2],
        y: [3, 4],
        visible: true
      },
      {
        type: "heatmap",
        name: "Heat",
        x: [10, 20],
        y: [100],
        z: [[1, 2]],
        visible: "legendonly"
      }
    ];

    const exportManager = new ExportManager(
      () => ({ traces, width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, theme: BASE_THEME }),
      null, null, null
    );

    const chart = baseChart(Chart);
    chart.traces = traces;
    chart.exportManager = exportManager;

    const visibleOnly = await chart.exportCsvPoints().text();
    assert.match(visibleOnly, /^traceIndex,traceName,traceType,pointIndex,x,y,z/m);
    assert.match(visibleOnly, /0,"Alpha,One",scatter,0,2026-01-01T00:00:00.000Z,3,/);
    assert.equal(visibleOnly.includes("1,Heat,heatmap"), false);

    const includeHidden = await chart.exportCsvPoints({ includeHidden: true }).text();
    assert.match(includeHidden, /1,Heat,heatmap,0,10,100,1/);
    assert.match(includeHidden, /1,Heat,heatmap,1,20,100,2/);
  });

  await t.test("theme merges grid defaults and axis style into overlay specs", () => {
    const theme = {
      colors: {
        background: "#ffffff",
        text: "#111827",
        axis: "#9ca3af",
        grid: "#e5e7eb",
        tooltipBackground: "rgba(0,0,0,0.75)",
        tooltipText: "#ffffff",
        palette: ["#123456", "#654321"]
      },
      fonts: {
        family: "IBM Plex Sans",
        sizePx: 12,
        axisFamily: "IBM Plex Sans",
        axisSizePx: 13,
        tooltipFamily: "IBM Plex Sans",
        tooltipSizePx: 12
      },
      axis: {
        color: "#0f172a",
        textColor: "#1e293b",
        fontFamily: "IBM Plex Sans",
        fontSizePx: 13
      },
      grid: {
        show: true,
        color: "#cbd5e1",
        opacity: 0.9,
        strokeWidth: 2
      },
      tooltip: {
        background: "#0f172a",
        textColor: "#ffffff",
        fontFamily: "IBM Plex Sans",
        fontSizePx: 12,
        borderRadiusPx: 8,
        paddingX: 8,
        paddingY: 6,
        boxShadow: "0 8px 20px rgba(0,0,0,0.18)"
      }
    };

    const axisManager = new AxisManager(() => ({
      layout: {
        xaxis: {},
        yaxis: {},
        grid: { opacity: 0.42, show: false }
      },
      traces: [],
      theme,
      zoom: BASE_ZOOM,
      xDomainNum: [0, 1],
      yDomainNum: [0, 1],
      width: 320,
      height: 240,
      padding: BASE_PADDING
    }));

    const grid = axisManager.resolveOverlayGrid();
    assert.deepEqual(grid, {
      show: false,
      color: "#cbd5e1",
      axisColor: "#0f172a",
      textColor: "#1e293b",
      opacity: 0.42,
      strokeWidth: 2
    });

    const spec = axisManager.makeOverlayAxisSpec("x", "linear", [0, 1]);
    assert.equal(spec.style.fontFamily, "IBM Plex Sans");
    assert.equal(spec.style.fontSizePx, 13);
  });

  await t.test("axis min/max bounds clamp computed autorange domain", () => {
    const traces = [
      {
        type: "scatter",
        x: new Float32Array([0, 50, 100]),
        y: new Float32Array([0, 50, 100])
      }
    ];

    const d = computeAxisDomain(traces, "x", { min: 20, max: 80 }, "linear");
    assert.deepEqual(d, [20, 80]);

    const noDataMin = computeAxisDomain([], "x", { min: 10 }, "linear");
    assert.deepEqual(noDataMin, [10, 11]);

    const noDataMax = computeAxisDomain([], "x", { max: 25 }, "linear");
    assert.deepEqual(noDataMax, [0, 1]);
  });

  await t.test("bar traces compile to line layers and keep pick metadata", () => {
    const traces = [
      {
        type: "bar",
        x: [0, 1, 2],
        y: [3, 8, 5],
        visible: true,
        name: "Bars",
        bar: { widthPx: 14, color: "#224466", opacity: 0.8 }
      }
    ];

    const sceneCompiler = new SceneCompiler();
    const scene = sceneCompiler.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);

    assert.equal(scene.lines.length, 1);
    assert.equal(scene.lines[0].widthPx, 14);
    assert.equal(scene.markers.length, 1);
    assert.equal(scene.markers[0].pointSizePx, 14);
    assert.equal(scene.markers[0].rgba[3], 0);
    assert.equal(sceneCompiler.idRanges.length, 1);
    assert.equal(sceneCompiler.idRanges[0].count, 3);
    assert.equal(sceneCompiler.yDomainNum[0] <= 0, true);
    assert.equal(sceneCompiler.yDomainNum[1] >= 8, true);
  });

  await t.test("bar y-axis autorange includes explicit base value", () => {
    const traces = [
      {
        type: "bar",
        x: [0, 1, 2],
        y: [7, 8, 9],
        bar: { base: 4 }
      }
    ];

    const domain = computeAxisDomain(traces, "y", undefined, "linear");
    assert.equal(domain[0] <= 4, true);
    assert.equal(domain[1] >= 9, true);
  });

  await t.test("area traces compile to fill + boundary layers and keep pick metadata", () => {
    const traces = [
      {
        type: "area",
        x: [0, 1, 2, 3],
        y: [2, 6, 4, 7],
        visible: true,
        name: "Area A",
        area: { color: "#0ea5e9", opacity: 0.3, base: 1 },
        line: { color: "#075985", widthPx: 2 },
        marker: { sizePx: 3, opacity: 0.4 },
        mode: "lines+markers"
      }
    ];

    const sceneCompiler = new SceneCompiler();
    const scene = sceneCompiler.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);

    assert.equal(scene.lines.length, 2);
    assert.equal(scene.markers.length, 1);
    assert.equal(scene.markers[0].pointSizePx, 3);
    assert.equal(sceneCompiler.idRanges.length, 1);
    assert.equal(sceneCompiler.idRanges[0].count, 4);
    assert.equal(sceneCompiler.yDomainNum[0] <= 1, true);
    assert.equal(sceneCompiler.yDomainNum[1] >= 7, true);
  });

  await t.test("area y-axis autorange includes explicit base value", () => {
    const traces = [
      {
        type: "area",
        x: [0, 1, 2],
        y: [7, 8, 9],
        area: { base: 5 }
      }
    ];

    const domain = computeAxisDomain(traces, "y", undefined, "linear");
    assert.equal(domain[0] <= 5, true);
    assert.equal(domain[1] >= 9, true);
  });

  await t.test("heatmap traces compile to per-cell line layers and keep pick metadata", () => {
    const traces = [
      {
        type: "heatmap",
        x: [0, 1, 2],
        y: [10, 20],
        z: [
          [1, 2, 3],
          [4, 5, 6]
        ],
        visible: true,
        name: "Heat",
        heatmap: {
          colorscale: ["#0000ff", "#00ff00", "#ff0000"],
          opacity: 0.7
        }
      }
    ];

    const sceneCompiler = new SceneCompiler();
    const scene = sceneCompiler.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);

    assert.equal(scene.markers.length, 1);
    assert.equal(scene.lines.length, 6);
    assert.equal(sceneCompiler.idRanges.length, 1);
    assert.equal(sceneCompiler.idRanges[0].count, 6);
    assert.equal(sceneCompiler.traceData[0].xs.length, 6);
    assert.equal(sceneCompiler.traceData[0].ys.length, 6);
    assert.equal(sceneCompiler.heatmapValueByTrace.get(0).length, 6);
  });

  await t.test("heatmap hover formatting resolves %{z}", () => {
    const traces = [
      {
        type: "heatmap",
        name: "Heat",
        x: [0, 1],
        y: [0, 1],
        z: [
          [10, 20],
          [30, 40]
        ],
        hovertemplate: "%{trace.name} x=%{x} y=%{y} z=%{z}"
      }
    ];

    const sceneCompiler = new SceneCompiler();
    sceneCompiler.compile(traces, mockAxisManager(), BASE_THEME, 320, 240, BASE_PADDING);

    const hoverManager = new HoverManager(
      null, null, () => undefined, tooltipElementStub(),
      () => ({ destroyed: false, hoverThrottleMs: 0, pickingMode: "cpu", width: 320, height: 240, dpr: 1, padding: BASE_PADDING, zoom: BASE_ZOOM, traces, theme: BASE_THEME }),
      {},
      { getHoverMode: () => "closest" },
      sceneCompiler,
      () => {}
    );

    // formatHover is private in TypeScript but accessible at runtime
    const label = hoverManager.formatHover(traces[0], {
      traceIndex: 0,
      pointIndex: 1,
      x: 1,
      y: 0,
      screenX: 0,
      screenY: 0
    });

    assert.equal(label, "Heat x=1 y=0 z=20");
  });

  await t.test("appendPoints throws for heatmap traces", () => {
    const chart = baseChart(Chart);
    chart.traces = [
      {
        type: "heatmap",
        x: [0, 1],
        y: [0, 1],
        z: [
          [1, 2],
          [3, 4]
        ],
        visible: true
      }
    ];

    assert.throws(
      () => chart.appendPoints({ traceIndex: 0, x: [2], y: [2] }),
      /is a heatmap trace; use setTraces/
    );
  });
});
