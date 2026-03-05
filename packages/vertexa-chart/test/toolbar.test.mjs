import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Set up a global jsdom environment before any modules are imported
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost"
});
const { window: jsWindow } = dom;
globalThis.window = jsWindow;
globalThis.document = jsWindow.document;
globalThis.Element = jsWindow.Element;
globalThis.Node = jsWindow.Node;
// Patch APIs jsdom doesn't fully implement
jsWindow.URL.createObjectURL = () => "blob:test-url";
jsWindow.URL.revokeObjectURL = () => {};
Object.defineProperty(jsWindow.document, "fullscreenElement", {
  get: () => null,
  configurable: true
});
jsWindow.document.exitFullscreen = () => Promise.resolve();

const BASE_THEME = {
  colors: {
    background: "#ffffff",
    text: "#111827",
    axis: "#9ca3af",
    grid: "#e5e7eb",
    tooltipBackground: "rgba(0,0,0,0.75)",
    tooltipText: "#ffffff",
    palette: ["#1f77b4"]
  },
  fonts: { family: "sans-serif", sizePx: 12 },
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
    boxShadow: "none"
  }
};

const BASE_A11Y = { keyboardNavigation: true, highContrast: false };

const FULL_CONFIG = {
  show: true,
  export: true,
  exportFormats: ["png", "csv"],
  exportPixelRatio: 1,
  exportFilename: "chart",
  fullscreen: false,
  position: "top-right"
};

function makeSpy(impl = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return impl(...args); };
  fn.calls = [];
  return fn;
}

test("Toolbar", async (t) => {
  t.mock.module("@lineandvertexsoftware/renderer-webgpu", {
    namedExports: { WebGPURenderer: class {} }
  });
  t.mock.module("@lineandvertexsoftware/overlay-d3", {
    namedExports: { OverlayD3: class {} }
  });

  const { Toolbar } = await import("../dist/Toolbar.js");

  function makeCallbacks() {
    return {
      exportPng: makeSpy(() => Promise.resolve(new jsWindow.Blob())),
      exportSvg: makeSpy(() => Promise.resolve(new jsWindow.Blob())),
      exportCsvPoints: makeSpy(() => new jsWindow.Blob()),
      setSize: makeSpy(),
      getSize: makeSpy(() => ({ width: 320, height: 240 }))
    };
  }

  await t.test("does not create toolbar DOM when config.show=false", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(
      container,
      { ...FULL_CONFIG, show: false },
      BASE_THEME,
      BASE_A11Y,
      makeCallbacks()
    );
    assert.equal(toolbar["toolbarEl"], null);
    assert.equal(container.children.length, 0);
  });

  await t.test("does not create toolbar when export disabled and fullscreen disabled", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(
      container,
      { ...FULL_CONFIG, export: false, fullscreen: false },
      BASE_THEME,
      BASE_A11Y,
      makeCallbacks()
    );
    assert.equal(toolbar["toolbarEl"], null);
  });

  await t.test("creates toolbar div appended to container when enabled", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());
    assert.ok(toolbar["toolbarEl"] !== null, "toolbarEl should be created");
    assert.ok(container.querySelector(".chart-toolbar") !== null);
  });

  await t.test("creates export button and menu items for given formats", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());
    const exportBtn = toolbar["exportButton"];
    assert.ok(exportBtn !== null, "export button should exist");
    assert.equal(exportBtn.getAttribute("aria-haspopup"), "menu");

    const menu = toolbar["exportMenu"];
    assert.ok(menu !== null, "export menu should exist");
    const items = menu.querySelectorAll("button[data-vx-export-format]");
    assert.equal(items.length, 2); // png and csv
    assert.equal(items[0].dataset.vxExportFormat, "png");
    assert.equal(items[1].dataset.vxExportFormat, "csv");
  });

  await t.test("export toggle opens menu on first click and closes on second", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());

    assert.equal(toolbar["exportOpen"], false);
    toolbar["exportButton"].click();
    assert.equal(toolbar["exportOpen"], true);
    assert.equal(toolbar["exportMenu"].style.display, "flex");
    assert.equal(toolbar["exportButton"].getAttribute("aria-expanded"), "true");

    toolbar["exportButton"].click();
    assert.equal(toolbar["exportOpen"], false);
    assert.equal(toolbar["exportMenu"].style.display, "none");
  });

  await t.test("ESC keydown closes open export menu", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());

    toolbar["exportButton"].click(); // open
    assert.equal(toolbar["exportOpen"], true);

    const escEvent = new jsWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    jsWindow.document.dispatchEvent(escEvent);
    assert.equal(toolbar["exportOpen"], false);
  });

  await t.test("pointer outside exportWrap closes menu", () => {
    const container = jsWindow.document.createElement("div");
    jsWindow.document.body.appendChild(container);
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());

    toolbar["exportButton"].click(); // open
    assert.equal(toolbar["exportOpen"], true);

    // Pointer outside: dispatch on body which is not inside exportWrap
    const ptrEvent = new jsWindow.PointerEvent("pointerdown", { bubbles: true });
    jsWindow.document.body.dispatchEvent(ptrEvent);
    assert.equal(toolbar["exportOpen"], false);
    container.remove();
  });

  await t.test("pointer inside exportWrap does not close menu", () => {
    const container = jsWindow.document.createElement("div");
    jsWindow.document.body.appendChild(container);
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());

    toolbar["exportButton"].click(); // open
    assert.equal(toolbar["exportOpen"], true);

    // Pointer inside: dispatch on exportWrap itself (bubbles to document handler)
    const ptrEvent = new jsWindow.PointerEvent("pointerdown", { bubbles: true });
    toolbar["exportWrap"].dispatchEvent(ptrEvent);
    assert.equal(toolbar["exportOpen"], true, "menu should stay open");
    container.remove();
  });

  await t.test("export menu click calls exportPng callback", async () => {
    const container = jsWindow.document.createElement("div");
    const callbacks = makeCallbacks();
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, callbacks);

    toolbar["exportButton"].click(); // open menu
    const pngBtn = toolbar["exportMenu"].querySelector("button[data-vx-export-format='png']");
    pngBtn.click();
    // Wait for the async handler to complete
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(callbacks.exportPng.calls.length, 1);
    assert.deepEqual(callbacks.exportPng.calls[0], [{ pixelRatio: 1 }]);
  });

  await t.test("export menu click calls exportCsvPoints callback", async () => {
    const container = jsWindow.document.createElement("div");
    const callbacks = makeCallbacks();
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, callbacks);

    toolbar["exportButton"].click();
    const csvBtn = toolbar["exportMenu"].querySelector("button[data-vx-export-format='csv']");
    csvBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(callbacks.exportCsvPoints.calls.length, 1);
  });

  await t.test("cleanup nullifies all element refs", () => {
    const container = jsWindow.document.createElement("div");
    const toolbar = new Toolbar(container, FULL_CONFIG, BASE_THEME, BASE_A11Y, makeCallbacks());
    toolbar.cleanup();
    assert.equal(toolbar["toolbarEl"], null);
    assert.equal(toolbar["exportButton"], null);
    assert.equal(toolbar["exportMenu"], null);
    assert.equal(toolbar["exportWrap"], null);
    assert.equal(toolbar["fullscreenButton"], null);
  });
});
