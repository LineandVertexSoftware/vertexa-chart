import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost"
});
const { window: jsWindow } = dom;

globalThis.window = jsWindow;
globalThis.document = jsWindow.document;
globalThis.Element = jsWindow.Element;
globalThis.Node = jsWindow.Node;
globalThis.XMLSerializer = jsWindow.XMLSerializer;
globalThis.Blob = jsWindow.Blob;
globalThis.requestAnimationFrame = (cb) => jsWindow.setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => jsWindow.clearTimeout(id);

class ImageStub {
  onload = null;
  onerror = null;
  decoding = "async";
  _src = "";

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this._src;
  }
}

globalThis.Image = ImageStub;
jsWindow.URL.createObjectURL = () => "blob:test-url";
jsWindow.URL.revokeObjectURL = () => {};
Object.defineProperty(jsWindow, "devicePixelRatio", {
  value: 1,
  configurable: true
});

const canvasOps = [];
const createdRenderers = [];
const createdOverlays = [];

function makeCanvasContext(canvas) {
  return {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillStyle: "",
    fillRect: (...args) => canvasOps.push(["fillRect", canvas, ...args]),
    drawImage: (...args) => canvasOps.push(["drawImage", canvas, ...args]),
    putImageData: (...args) => canvasOps.push(["putImageData", canvas, ...args])
  };
}

jsWindow.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type !== "2d") return null;
  if (!this.__testContext) this.__testContext = makeCanvasContext(this);
  return this.__testContext;
};

jsWindow.HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
  callback(new jsWindow.Blob(["png"], { type: type ?? "image/png" }));
};

jsWindow.HTMLCanvasElement.prototype.toDataURL = function toDataURL(type) {
  assert.equal(type, "image/png");
  return "data:image/png;base64,mixed-chart";
};

class WebGPURendererStub {
  constructor() {
    this.layers = null;
    this.renderCalls = [];
    this.captureCalls = [];
    createdRenderers.push(this);
  }

  async mount() {}

  setLayers(layers) {
    this.layers = layers;
  }

  render(frame) {
    this.renderCalls.push(frame);
  }

  setLOD() {}

  setLODThreshold() {}

  setHoverHighlight() {}

  getStats() {
    return {
      fps: 60,
      renderMs: { last: 1, avg: 1, min: 1, max: 1 },
      gpuRenderMs: null,
      pickMs: { last: 0, avg: 0, min: 0, max: 0 },
      sampledPoints: 0,
      frameCount: this.renderCalls.length
    };
  }

  async captureFrameImageData(frame) {
    this.captureCalls.push(frame);
    return {
      width: Math.max(1, Math.round(frame.width * frame.dpr)),
      height: Math.max(1, Math.round(frame.height * frame.dpr)),
      data: new Uint8ClampedArray(Math.max(1, Math.round(frame.width * frame.dpr)) * Math.max(1, Math.round(frame.height * frame.dpr)) * 4)
    };
  }

  destroy() {}
}

class OverlayD3Stub {
  constructor(opts) {
    this.opts = opts;
    createdOverlays.push(this);

    const gridRect = opts.gridSvg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
    gridRect.setAttribute("class", "grid-regression-layer");
    gridRect.setAttribute("width", String(opts.width));
    gridRect.setAttribute("height", String(opts.height));
    opts.gridSvg.appendChild(gridRect);

    const legendGroup = opts.svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    legendGroup.setAttribute("class", "legend-regression-layer");
    legendGroup.setAttribute("data-items", String(opts.legend?.items?.length ?? 0));
    opts.svg.appendChild(legendGroup);
  }

  setAxes() {}

  setGrid() {}

  setAnnotations() {}

  setLegend() {}

  setHoverGuides() {}

  setZoomTransform() {}

  resetZoom() {}

  destroy() {}
}

function resetHarness() {
  canvasOps.length = 0;
  createdRenderers.length = 0;
  createdOverlays.length = 0;
  jsWindow.document.body.replaceChildren();
}

function mixedTraces() {
  return [
    {
      type: "scatter",
      name: "Scatter, quoted",
      x: [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z")],
      y: [1, 2],
      mode: "lines+markers"
    },
    {
      type: "bar",
      name: "Bars",
      x: [1, 2],
      y: [3, 4]
    },
    {
      type: "area",
      name: "Area",
      x: [1, 2],
      y: [2, 3]
    },
    {
      type: "heatmap",
      name: "Heat",
      x: ["A", "B"],
      y: ["North", "South"],
      z: [
        [5, 6],
        [7, Number.NaN]
      ]
    },
    {
      type: "histogram",
      name: "Histogram",
      x: [1, 1, 2],
      visible: true
    },
    {
      type: "scatter",
      name: "Hidden",
      x: [9],
      y: [9],
      visible: "legendonly"
    }
  ];
}

async function makeMixedChart(Chart) {
  const root = jsWindow.document.createElement("div");
  jsWindow.document.body.appendChild(root);

  const chart = new Chart(root, {
    width: 420,
    height: 260,
    traces: mixedTraces(),
    layout: {
      title: "Mixed export regression",
      xaxis: { type: "linear" },
      yaxis: { type: "linear" },
      legend: { show: true }
    }
  });

  await chart["initPromise"];
  return chart;
}

test("mixed chart export regressions", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    exports: {
      WebGPURenderer: WebGPURendererStub
    }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    exports: {
      OverlayD3: OverlayD3Stub
    }
  });

  const { Chart } = await import("../dist/Chart.js");

  await t.test("exportPng captures a mixed trace chart and composites grid and overlay layers", async () => {
    resetHarness();
    const chart = await makeMixedChart(Chart);
    const renderer = createdRenderers.at(-1);

    const blob = await chart.exportPng({ pixelRatio: 2, background: "#f8fafc" });

    assert.equal(blob.type, "image/png");
    assert.equal(renderer.captureCalls.length, 1);
    assert.deepEqual(renderer.captureCalls[0], {
      width: 420,
      height: 260,
      dpr: 2,
      padding: chart["padding"],
      zoom: chart["zoom"]
    });
    assert.equal(createdOverlays.length, 1);
    assert.ok(canvasOps.some((op) => op[0] === "fillRect" && op[2] === 0 && op[3] === 0 && op[4] === 840 && op[5] === 520));
    assert.equal(canvasOps.filter((op) => op[0] === "putImageData").length, 1);
    assert.ok(canvasOps.filter((op) => op[0] === "drawImage").length >= 3, "plot, grid, and overlay layers should be drawn");

    chart.destroy();
  });

  await t.test("exportSvg embeds the mixed plot image and serializes grid and overlay layers", async () => {
    resetHarness();
    const chart = await makeMixedChart(Chart);
    const renderer = createdRenderers.at(-1);

    const blob = await chart.exportSvg({ pixelRatio: 1.5, background: "#ffffff" });
    const markup = await blob.text();

    assert.equal(blob.type, "image/svg+xml;charset=utf-8");
    assert.equal(renderer.captureCalls.length, 1);
    assert.equal(renderer.captureCalls[0].dpr, 1.5);
    assert.match(markup, /^<svg[^>]+width="420"[^>]+height="260"/);
    assert.match(markup, /<image[^>]+data:image\/png;base64,mixed-chart/);
    assert.match(markup, /grid-regression-layer/);
    assert.match(markup, /legend-regression-layer/);

    chart.destroy();
  });

  await t.test("exportCsvPoints flattens mixed trace families and excludes hidden rows by default", async () => {
    resetHarness();
    const chart = await makeMixedChart(Chart);

    const visibleCsv = await chart.exportCsvPoints().text();
    const rows = visibleCsv.split("\n");

    assert.equal(rows[0], "traceIndex,traceName,traceType,pointIndex,x,y,z");
    assert.match(visibleCsv, /0,"Scatter, quoted",scatter,0,2026-01-01T00:00:00.000Z,1,/);
    assert.match(visibleCsv, /1,Bars,bar,1,2,4,/);
    assert.match(visibleCsv, /2,Area,area,1,2,3,/);
    assert.match(visibleCsv, /3,Heat,heatmap,0,A,North,5/);
    assert.match(visibleCsv, /3,Heat,heatmap,3,B,South,/);
    assert.match(visibleCsv, /4,Histogram,histogram,2,2,,/);
    assert.equal(visibleCsv.includes("5,Hidden"), false);

    const allCsv = await chart.exportCsvPoints({ includeHidden: true, includeHeader: false }).text();
    assert.match(allCsv, /^0,"Scatter, quoted",scatter,0,2026-01-01T00:00:00.000Z,1,/);
    assert.match(allCsv, /5,Hidden,scatter,0,9,9,/);

    chart.destroy();
  });
});
