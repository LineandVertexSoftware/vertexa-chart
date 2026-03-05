import assert from "node:assert/strict";
import test from "node:test";

test("WebGPURenderer — pure logic (no GPU device required)", async (t) => {
  // WGSL shader files are handled by test/wgsl-loader.mjs (returns empty string default export).
  // No module mocks needed — the loader hook intercepts before Node checks the .wgsl extension.
  const { WebGPURenderer } = await import("../dist/WebGPURenderer.js");

  // Construct without calling mount() — class field initialisers still run
  function makeRenderer() {
    return new WebGPURenderer();
  }

  // ---- getStats / setLOD -----------------------------------------------

  await t.test("getStats returns default zeroed stats object", () => {
    const r = makeRenderer();
    const stats = r.getStats();
    assert.equal(typeof stats, "object");
    assert.equal(stats.frameCount, 0);
    assert.equal(stats.lastRenderMs, 0);
    assert.equal(stats.lastPickMs, 0);
    assert.equal(stats.effectiveSampledPoints, 0);
  });

  await t.test("getStats returns a copy (mutation does not affect internal state)", () => {
    const r = makeRenderer();
    const stats = r.getStats();
    stats.frameCount = 999;
    assert.equal(r.getStats().frameCount, 0);
  });

  await t.test("setLOD(false) disables LOD flag", () => {
    const r = makeRenderer();
    r.setLOD(false);
    // LOD disabled → calculateLODStride always returns 1
    assert.equal(r["calculateLODStride"](1_000_000, 1), 1);
  });

  await t.test("setLOD(true) re-enables LOD flag", () => {
    const r = makeRenderer();
    r.setLOD(false);
    r.setLOD(true);
    // 1 million points, zoom=1 → should stride
    assert.ok(r["calculateLODStride"](1_000_000, 1) > 1);
  });

  // ---- setHoverHighlight -----------------------------------------------

  await t.test("setHoverHighlight(null) sets hoverActive=false without touching GPU", () => {
    const r = makeRenderer();
    // Manually enable hover first so we can verify null clears it
    r["hoverActive"] = true;
    r.setHoverHighlight(null);
    assert.equal(r["hoverActive"], false);
  });

  // ---- destroy with empty layers (no GPU) --------------------------------

  await t.test("destroy() on uninitialised instance does not throw", () => {
    const r = makeRenderer();
    // markerLayers and lineLayers are empty, uniform arrays are empty.
    // The optional-chained GPU fields will be undefined — the code uses ?.destroy?.()
    assert.doesNotThrow(() => r.destroy());
  });

  // ---- LOD stride calculation -------------------------------------------

  await t.test("calculateLODStride returns 1 when totalPoints <= lodThreshold", () => {
    const r = makeRenderer();
    assert.equal(r["calculateLODStride"](100, 1), 1);
    assert.equal(r["calculateLODStride"](50000, 1), 1);
  });

  await t.test("calculateLODStride returns >1 when totalPoints exceeds lodThreshold", () => {
    const r = makeRenderer();
    // 100 000 points, zoom=1 → baseStride = ceil(100000/50000) = 2
    assert.equal(r["calculateLODStride"](100_000, 1), 2);
  });

  await t.test("calculateLODStride is reduced at higher zoom levels", () => {
    const r = makeRenderer();
    const low = r["calculateLODStride"](100_000, 1);
    const high = r["calculateLODStride"](100_000, 4);
    assert.ok(high <= low, "higher zoom should produce equal or lower stride");
  });

  // ---- LOD offset calculation -------------------------------------------

  await t.test("calculateLODOffset returns 0 when stride=1", () => {
    const r = makeRenderer();
    assert.equal(r["calculateLODOffset"](0, 1), 0);
    assert.equal(r["calculateLODOffset"](42, 1), 0);
  });

  await t.test("calculateLODOffset is in range [0, stride) for stride>1", () => {
    const r = makeRenderer();
    for (const baseId of [0, 1, 2, 100, 999]) {
      const stride = 4;
      const offset = r["calculateLODOffset"](baseId, stride);
      assert.ok(offset >= 0 && offset < stride, `offset ${offset} out of range for baseId ${baseId}`);
    }
  });

  // ---- LOD instance count calculation -----------------------------------

  await t.test("calculateLODInstanceCount returns 0 for empty layer", () => {
    const r = makeRenderer();
    assert.equal(r["calculateLODInstanceCount"](0, 1, 0), 0);
  });

  await t.test("calculateLODInstanceCount returns total when stride=1", () => {
    const r = makeRenderer();
    assert.equal(r["calculateLODInstanceCount"](100, 1, 0), 100);
  });

  await t.test("calculateLODInstanceCount with stride=2 returns ~half the points", () => {
    const r = makeRenderer();
    const count = r["calculateLODInstanceCount"](10, 2, 0);
    // points at indices 0,2,4,6,8 → 5
    assert.equal(count, 5);
  });

  await t.test("calculateLODInstanceCount returns 0 when offset >= total", () => {
    const r = makeRenderer();
    assert.equal(r["calculateLODInstanceCount"](5, 2, 10), 0);
  });
});

test("initWebGPU — failure modes", async (t) => {
  const { initWebGPU } = await import("../dist/initDevice.js");

  await t.test("rejects when navigator.gpu is absent", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, writable: true, configurable: true });
    await assert.rejects(
      () => initWebGPU({}),
      /WebGPU not supported/
    );
  });

  await t.test("rejects when adapter request returns null", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: { requestAdapter: async () => null, getPreferredCanvasFormat: () => "bgra8unorm" } },
      writable: true, configurable: true
    });
    await assert.rejects(
      () => initWebGPU({}),
      /Failed to get GPU adapter/
    );
  });

  await t.test("rejects when canvas context is not available", async () => {
    const mockDevice = {};
    const mockAdapter = { requestDevice: async () => mockDevice };
    const mockCanvas = { getContext: () => null }; // no webgpu context
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: { requestAdapter: async () => mockAdapter, getPreferredCanvasFormat: () => "bgra8unorm" } },
      writable: true, configurable: true
    });
    await assert.rejects(
      () => initWebGPU(mockCanvas),
      /Failed to get WebGPU context/
    );
  });

  await t.test("resolves with device, context and format on success", async () => {
    const mockDevice = {};
    const mockContext = {};
    const mockAdapter = { requestDevice: async () => mockDevice };
    const mockCanvas = { getContext: () => mockContext };
    Object.defineProperty(globalThis, "navigator", {
      value: { gpu: { requestAdapter: async () => mockAdapter, getPreferredCanvasFormat: () => "bgra8unorm" } },
      writable: true, configurable: true
    });
    const result = await initWebGPU(mockCanvas);
    assert.equal(result.device, mockDevice);
    assert.equal(result.context, mockContext);
    assert.equal(result.format, "bgra8unorm");
  });
});
