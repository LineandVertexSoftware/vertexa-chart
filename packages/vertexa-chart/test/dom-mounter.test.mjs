import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Set up jsdom global environment
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost"
});
const { window: jsWindow } = dom;
globalThis.window = jsWindow;
globalThis.document = jsWindow.document;
jsWindow.URL.createObjectURL = () => "blob:test-url";
jsWindow.URL.revokeObjectURL = () => {};
Object.defineProperty(jsWindow.document, "fullscreenElement", {
  get: () => null,
  configurable: true
});
jsWindow.document.exitFullscreen = () => Promise.resolve();

const BASE_THEME = {
  colors: { background: "#fff", text: "#000", axis: "#999", grid: "#eee" },
  fonts: { family: "sans-serif", sizePx: 12 },
  axis: { color: "#999", textColor: "#444", fontFamily: "sans-serif", fontSizePx: 12 },
  grid: { show: true, color: "#eee", opacity: 1, strokeWidth: 1 },
  tooltip: {
    background: "rgba(0,0,0,0.75)",
    textColor: "#fff",
    fontFamily: "sans-serif",
    fontSizePx: 12,
    borderRadiusPx: 8,
    paddingX: 8,
    paddingY: 6,
    boxShadow: "none"
  }
};

const BASE_TOOLBAR = {
  show: false,
  export: false,
  exportFormats: [],
  exportPixelRatio: 1,
  exportFilename: "chart",
  fullscreen: false,
  position: "top-right"
};

function makeCallbacks() {
  return {
    exportPng: async () => new jsWindow.Blob(),
    exportSvg: async () => new jsWindow.Blob(),
    exportCsvPoints: () => new jsWindow.Blob(),
    setSize: () => {},
    getSize: () => ({ width: 320, height: 240 })
  };
}

test("mountDom", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: { WebGPURenderer: class {} }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: { OverlayD3: class {} }
  });

  const { mountDom } = await import("../dist/DomMounter.js");
  const { Toolbar } = await import("../dist/Toolbar.js");

  function baseOpts(overrides = {}) {
    return {
      width: 400,
      height: 300,
      theme: BASE_THEME,
      a11y: { keyboardNavigation: false, highContrast: false },
      toolbarConfig: BASE_TOOLBAR,
      ...overrides
    };
  }

  await t.test("returns object with container, canvas, svgGrid, svg, tooltip, chartToolbar", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts(), makeCallbacks(), () => {});
    assert.ok(result.container instanceof jsWindow.HTMLElement);
    assert.ok(result.canvas instanceof jsWindow.HTMLCanvasElement);
    assert.ok(result.svgGrid instanceof jsWindow.SVGSVGElement);
    assert.ok(result.svg instanceof jsWindow.SVGSVGElement);
    assert.ok(result.tooltip instanceof jsWindow.HTMLElement);
    assert.equal(result.chartToolbar, null); // toolbar disabled
  });

  await t.test("container has correct width and height styles", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts({ width: 500, height: 350 }), makeCallbacks(), () => {});
    assert.equal(result.container.style.width, "500px");
    assert.equal(result.container.style.height, "350px");
  });

  await t.test("container uses theme background color", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts(), makeCallbacks(), () => {});
    // jsdom may normalise "#fff" → "rgb(255, 255, 255)"; check it is set at all
    assert.ok(result.container.style.background.length > 0, "container should have a background style");
  });

  await t.test("canvas has aria-hidden attribute", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts(), makeCallbacks(), () => {});
    assert.equal(result.canvas.getAttribute("aria-hidden"), "true");
  });

  await t.test("tooltip has role=status and aria-live=polite", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts(), makeCallbacks(), () => {});
    assert.equal(result.tooltip.getAttribute("role"), "status");
    assert.equal(result.tooltip.getAttribute("aria-live"), "polite");
    assert.equal(result.tooltip.getAttribute("aria-atomic"), "true");
  });

  await t.test("container has tabIndex=0 and aria-keyshortcuts when keyboardNavigation=true", () => {
    const root = jsWindow.document.createElement("div");
    const keydownSpy = [];
    const result = mountDom(
      root,
      baseOpts({ a11y: { keyboardNavigation: true, highContrast: false } }),
      makeCallbacks(),
      (e) => keydownSpy.push(e)
    );
    assert.equal(result.container.tabIndex, 0);
    assert.ok(result.container.getAttribute("aria-keyshortcuts") !== null);
    // Fire keydown event to verify the handler is wired
    const evt = new jsWindow.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: false });
    result.container.dispatchEvent(evt);
    assert.equal(keydownSpy.length, 1);
  });

  await t.test("container has tabIndex=-1 and no keydown listener when keyboardNavigation=false", () => {
    const root = jsWindow.document.createElement("div");
    const keydownSpy = [];
    const result = mountDom(
      root,
      baseOpts({ a11y: { keyboardNavigation: false, highContrast: false } }),
      makeCallbacks(),
      (e) => keydownSpy.push(e)
    );
    assert.equal(result.container.tabIndex, -1);
    assert.equal(result.container.getAttribute("aria-keyshortcuts"), null);
    result.container.dispatchEvent(new jsWindow.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    assert.equal(keydownSpy.length, 0);
  });

  await t.test("creates Toolbar instance when toolbarConfig.show=true", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(
      root,
      baseOpts({
        toolbarConfig: {
          show: true,
          export: true,
          exportFormats: ["png"],
          exportPixelRatio: 1,
          exportFilename: "chart",
          fullscreen: false,
          position: "top-right"
        }
      }),
      makeCallbacks(),
      () => {}
    );
    assert.ok(result.chartToolbar !== null, "chartToolbar should be non-null");
    assert.ok(result.chartToolbar instanceof Toolbar);
  });

  await t.test("chartToolbar is null when toolbarConfig.show=false", () => {
    const root = jsWindow.document.createElement("div");
    const result = mountDom(root, baseOpts({ toolbarConfig: BASE_TOOLBAR }), makeCallbacks(), () => {});
    assert.equal(result.chartToolbar, null);
  });

  await t.test("root.innerHTML is cleared before mounting (idempotent)", () => {
    const root = jsWindow.document.createElement("div");
    root.innerHTML = "<p>old content</p>";
    mountDom(root, baseOpts(), makeCallbacks(), () => {});
    assert.equal(root.querySelector("p"), null);
    assert.ok(root.querySelector(".chart-container") !== null);
  });
});
