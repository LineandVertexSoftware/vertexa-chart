import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost"
});
const { window: jsWindow } = dom;
globalThis.window = jsWindow;
globalThis.document = jsWindow.document;
globalThis.SVGElement = jsWindow.SVGElement;
globalThis.SVGSVGElement = jsWindow.SVGSVGElement;
Object.defineProperty(globalThis, "navigator", {
  value: jsWindow.navigator,
  writable: true,
  configurable: true,
});

test("OverlayD3 — secondary y-axis (y2)", async (t) => {
  const { OverlayD3 } = await import("../dist/index.js");

  function makeSvgs() {
    const container = jsWindow.document.createElement("div");
    jsWindow.document.body.appendChild(container);
    const svg = jsWindow.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const gridSvg = jsWindow.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "300");
    gridSvg.setAttribute("width", "400");
    gridSvg.setAttribute("height", "300");
    container.appendChild(gridSvg);
    container.appendChild(svg);
    return { container, svg, gridSvg };
  }

  function makeOpts(overrides = {}) {
    const { svg, gridSvg } = makeSvgs();
    return {
      svg,
      gridSvg,
      width: 400,
      height: 300,
      padding: { l: 40, r: 55, t: 20, b: 30 },
      xAxis: { type: "linear", domain: [0, 100] },
      yAxis: { type: "linear", domain: [0, 50] },
      onZoom: () => {},
      ...overrides
    };
  }

  await t.test("constructor with y2Axis creates y2-axis group", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    const y2Group = opts.svg.querySelector(".y2-axis");
    assert.ok(y2Group, "y2-axis group should exist in the SVG");
  });

  await t.test("constructor without y2Axis does not create y2-axis group", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    const y2Group = opts.svg.querySelector(".y2-axis");
    assert.equal(y2Group, null, "y2-axis group should not exist without y2Axis");
  });

  await t.test("setAxes with y2Axis creates y2 group lazily", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    // Initially no y2 axis
    assert.equal(opts.svg.querySelector(".y2-axis"), null);
    // Set axes with y2
    overlay.setAxes(
      { type: "linear", domain: [0, 100] },
      { type: "linear", domain: [0, 50] },
      { type: "linear", domain: [0, 1000] }
    );
    assert.ok(opts.svg.querySelector(".y2-axis"), "y2-axis group should be created");
  });

  await t.test("setAxes without y2Axis removes y2 group", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    assert.ok(opts.svg.querySelector(".y2-axis"), "y2-axis group should exist initially");
    // Remove y2
    overlay.setAxes(
      { type: "linear", domain: [0, 100] },
      { type: "linear", domain: [0, 50] }
    );
    assert.equal(opts.svg.querySelector(".y2-axis"), null, "y2-axis group should be removed");
  });

  await t.test("y2 axis renders tick marks", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    const y2Group = opts.svg.querySelector(".y2-axis");
    assert.ok(y2Group, "y2-axis group should exist");
    // D3 should have rendered tick elements
    const ticks = y2Group.querySelectorAll(".tick");
    assert.ok(ticks.length > 0, "y2 axis should have tick marks");
  });

  await t.test("y2 axis ticks are on the right (axisRight)", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    const y2Group = opts.svg.querySelector(".y2-axis");
    assert.ok(y2Group);
    // axisRight draws tick lines extending to the right (positive x),
    // and the domain line on the left side. Check that the transform places
    // the group at x = plotW.
    const plotW = 400 - 40 - 55; // width - padding.l - padding.r
    const transform = y2Group.getAttribute("transform");
    assert.ok(
      transform && transform.includes(`${plotW}`),
      `y2 axis group should be positioned at plotW=${plotW}, got: ${transform}`
    );
  });

  await t.test("setAxes with y2Axis log type does not throw", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    assert.doesNotThrow(() => {
      overlay.setAxes(
        { type: "linear", domain: [0, 100] },
        { type: "linear", domain: [0, 50] },
        { type: "log", domain: [1, 10000] }
      );
    });
  });

  await t.test("setAxes with y2Axis time type does not throw", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    const now = Date.now();
    assert.doesNotThrow(() => {
      overlay.setAxes(
        { type: "linear", domain: [0, 100] },
        { type: "linear", domain: [0, 50] },
        { type: "time", domain: [now - 86400000, now] }
      );
    });
  });

  await t.test("setAxes with y2Axis category type renders category labels", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    overlay.setAxes(
      { type: "linear", domain: [0, 100] },
      { type: "linear", domain: [0, 50] },
      { type: "category", domain: [-0.5, 2.5], categories: ["Low", "Medium", "High"] }
    );
    const y2Group = opts.svg.querySelector(".y2-axis");
    assert.ok(y2Group, "y2-axis group should exist");
    const tickTexts = y2Group.querySelectorAll(".tick text");
    assert.ok(tickTexts.length > 0, "y2 category axis should have tick labels");
  });

  await t.test("y2 axis styled with y2-axis CSS class", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    const styleEl = opts.svg.querySelector("style");
    assert.ok(styleEl, "should have a style element");
    const css = styleEl.textContent ?? "";
    assert.ok(css.includes(".y2-axis .tick text"), "CSS should style y2-axis tick text");
  });

  await t.test("destroy cleans up y2 axis group", () => {
    const opts = makeOpts({
      y2Axis: { type: "linear", domain: [0, 1000] }
    });
    const overlay = new OverlayD3(opts);
    assert.ok(opts.svg.querySelector(".y2-axis"), "y2 group exists before destroy");
    overlay.destroy();
    // After destroy, the overlay-root (which contains y2-axis) should be removed
    assert.equal(opts.svg.querySelector(".overlay-root"), null, "overlay root removed after destroy");
  });
});
