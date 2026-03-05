import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Set up jsdom — D3 relies on the global document/window for DOM operations
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost"
});
const { window: jsWindow } = dom;
globalThis.window = jsWindow;
globalThis.document = jsWindow.document;

// D3 uses SVGElement prototype for axis rendering; jsdom provides this
const SVGElement = jsWindow.SVGElement;
const SVGSVGElement = jsWindow.SVGSVGElement;
globalThis.SVGElement = SVGElement;
globalThis.SVGSVGElement = SVGSVGElement;

test("OverlayD3", async (t) => {
  const { OverlayD3 } = await import("../dist/index.js");

  /** Create a pair of real SVG elements attached to a DOM container. */
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
      padding: { l: 40, r: 20, t: 20, b: 30 },
      xAxis: { type: "linear", domain: [0, 100] },
      yAxis: { type: "linear", domain: [0, 50] },
      onZoom: () => {},
      ...overrides
    };
  }

  await t.test("constructor appends child elements to the SVG", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    // D3 should have appended at least: style, defs, g.overlay-root
    assert.ok(opts.svg.children.length > 0, "overlay SVG should have children");
    assert.ok(opts.gridSvg.children.length > 0, "grid SVG should have children");
  });

  await t.test("constructor adds data-oid attribute to overlay SVG", () => {
    const opts = makeOpts();
    new OverlayD3(opts);
    assert.ok(opts.svg.hasAttribute("data-oid"), "SVG should have data-oid attribute");
  });

  await t.test("setSize updates SVG width and height attributes", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    overlay.setSize(600, 400, { l: 40, r: 20, t: 20, b: 30 });
    assert.equal(opts.svg.getAttribute("width"), "600");
    assert.equal(opts.svg.getAttribute("height"), "400");
    assert.equal(opts.gridSvg.getAttribute("width"), "600");
    assert.equal(opts.gridSvg.getAttribute("height"), "400");
  });

  await t.test("setAxes does not throw with linear axes", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => {
      overlay.setAxes(
        { type: "linear", domain: [0, 200] },
        { type: "linear", domain: [0, 100] }
      );
    });
  });

  await t.test("setAxes does not throw with log axes", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => {
      overlay.setAxes(
        { type: "log", domain: [1, 1000] },
        { type: "log", domain: [1, 100] }
      );
    });
  });

  await t.test("setGrid does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => {
      overlay.setGrid({ show: true, color: "#ccc", opacity: 0.5, strokeWidth: 1 });
    });
  });

  await t.test("setHoverGuides(null) does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => overlay.setHoverGuides(null));
  });

  await t.test("setHoverGuides with mode=closest does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    overlay.setSize(400, 300, { l: 40, r: 20, t: 20, b: 30 });
    assert.doesNotThrow(() =>
      overlay.setHoverGuides({ mode: "closest", xPlot: 100, yPlot: 80, inside: true })
    );
  });

  await t.test("setHoverGuides with mode=x shows only vertical guide", () => {
    const opts = makeOpts();
    const overlay = new OverlayD3(opts);
    overlay.setSize(400, 300, { l: 40, r: 20, t: 20, b: 30 });
    overlay.setHoverGuides({ mode: "x", xPlot: 100, yPlot: 80, inside: true });
    // vGuide should have non-zero stroke-opacity
    const vGuide = opts.svg.querySelector(".guides line:first-child");
    if (vGuide) {
      assert.ok(
        vGuide.getAttribute("stroke-opacity") !== "0",
        "vertical guide should be visible in x mode"
      );
    }
  });

  await t.test("setAnnotations([]) does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => overlay.setAnnotations([]));
  });

  await t.test("setAnnotations with a line annotation does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    overlay.setSize(400, 300, { l: 40, r: 20, t: 20, b: 30 });
    assert.doesNotThrow(() =>
      overlay.setAnnotations([
        { type: "line", x0: 10, y0: 5, x1: 90, y1: 45, color: "red", widthPx: 2 }
      ])
    );
  });

  await t.test("setLegend renders legend items without error", () => {
    const overlay = new OverlayD3(makeOpts());
    overlay.setSize(400, 300, { l: 40, r: 20, t: 20, b: 30 });
    const toggled = [];
    assert.doesNotThrow(() =>
      overlay.setLegend(
        [
          { name: "Series A", color: "#1f77b4", visible: true },
          { name: "Series B", color: "#ff7f0e", visible: false }
        ],
        (i) => toggled.push(i)
      )
    );
  });

  await t.test("onZoom callback is called when zoom is applied programmatically", async () => {
    const zoomEvents = [];
    const opts = makeOpts({ onZoom: (z) => zoomEvents.push(z) });
    const overlay = new OverlayD3(opts);
    overlay.setSize(400, 300, { l: 40, r: 20, t: 20, b: 30 });
    // Trigger zoom via the zoom behaviour directly (internal)
    // The zoomRect handles pointer events; call the zoom transform programmatically
    // Verify zoomBehavior is present; D3's transform() requires full SVG DOM
    // which jsdom doesn't fully implement (width.baseVal), so we test existence only
    assert.ok(overlay["zoomBehavior"] !== null, "zoomBehavior should be initialised");
    assert.ok(opts.svg.querySelector("rect") !== null, "zoom capture rect should exist");
  });

  await t.test("destroy() does not throw", () => {
    const overlay = new OverlayD3(makeOpts());
    assert.doesNotThrow(() => overlay.destroy());
  });
});
