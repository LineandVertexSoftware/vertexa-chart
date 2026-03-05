import { WebGPURenderer } from "@lineandvertexsoftware/renderer-webgpu";
import type { AxisType, Datum, ScatterTrace, Trace } from "./types.js";
import { toNumber, sortedOrder } from "./chart-utils.js";
import { computeAxisDomain, normalizeInterleaved } from "./scene.js";
import type { SceneCompiler } from "./SceneCompiler.js";
import type { AxisManager } from "./AxisManager.js";

export type PreparedUpdate = {
  update: { traceIndex: number };
  xNew: Datum[];
  yNew: Datum[];
  nNew: number;
  trimCount: number;
};

export class DataMutationManager {
  constructor(
    private sceneCompiler: SceneCompiler,
    private renderer: WebGPURenderer,
    private getTraces: () => Trace[],
    private axisManager: AxisManager
  ) {}

  /**
   * Attempt an O(N_new) incremental GPU update for appendPoints instead of a full recompile.
   * Returns true if the fast path was taken, false if a full compileScene+setLayers is needed.
   *
   * Conditions for fast path:
   *  - All updated traces are scatter type with smoothing "none"
   *  - All have existing GPU layer mappings (compileScene was run at least once)
   *  - Domain is unchanged after the append (new points within current domain, or domain fixed)
   */
  tryAppendFast(prepared: PreparedUpdate[]): boolean {
    const traces = this.getTraces();

    // Gate 1: all updated traces must be scatter with no line smoothing
    for (const { update, nNew } of prepared) {
      if (nNew <= 0) continue;
      const trace = traces[update.traceIndex];
      if (!trace || trace.type !== "scatter") return false;
      if ((trace.line?.smoothing ?? "none") !== "none") return false;
      if (!this.sceneCompiler.traceToMarkerLayerIdx.has(update.traceIndex)) return false;
    }

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");

    // Gate 1b: fast path is not supported for category axes
    if (xType === "category" || yType === "category") return false;

    // Gate 2: domain must not change (new points within current domain, or domain is overridden)
    const newXDomain = computeAxisDomain(traces, "x", this.axisManager.getAxis("x"), xType);
    const newYDomain = computeAxisDomain(traces, "y", this.axisManager.getAxis("y"), yType);
    const EPS = 1e-10;
    if (
      Math.abs(newXDomain[0] - this.sceneCompiler.xDomainNum[0]) > EPS ||
      Math.abs(newXDomain[1] - this.sceneCompiler.xDomainNum[1]) > EPS ||
      Math.abs(newYDomain[0] - this.sceneCompiler.yDomainNum[0]) > EPS ||
      Math.abs(newYDomain[1] - this.sceneCompiler.yDomainNum[1]) > EPS
    ) {
      return false;
    }

    // Fast path: perform incremental updates per trace
    for (const { update, xNew, yNew, nNew, trimCount } of prepared) {
      if (nNew <= 0) continue;
      const { traceIndex } = update;
      const trace = traces[traceIndex];
      const mode = (trace as ScatterTrace).mode ?? "markers";

      // Normalize only the new points using the current (unchanged) domain
      const newNorm = normalizeInterleaved(xNew, yNew, xType, yType, this.sceneCompiler.xDomainNum, this.sceneCompiler.yDomainNum);

      const markerLayerIdx = this.sceneCompiler.traceToMarkerLayerIdx.get(traceIndex)!;

      // --- Marker layer ---
      const hasMarkers = mode === "markers" || mode === "lines+markers";
      if (hasMarkers) {
        this.renderer.appendToMarkerLayer(markerLayerIdx, newNorm, trimCount);
        // Mark the CPU norm cache as dirty — will be lazily rebuilt in getNormPoint()
        this.sceneCompiler.markerNormByTraceDirty.add(traceIndex);
      }

      // --- Line layer ---
      const lineLayerIdxs = this.sceneCompiler.traceToLineLayerIdxs.get(traceIndex);
      const hasLines = mode === "lines" || mode === "lines+markers";
      if (hasLines && lineLayerIdxs && lineLayerIdxs.length > 0) {
        // Build new segments: junction (last-old → first-new) + segments within new points
        // After mutation, trace.x[length - nNew - 1] is the last OLD point in the window
        // (histogram traces are never passed here; Chart.appendPoints throws for them)
        if (!trace.x || !trace.y) continue;
        const lastOldIdx = trace.x.length - nNew - 1;
        const newSegments = this.buildFastAppendSegments(
          lastOldIdx >= 0 ? trace.x[lastOldIdx] : null,
          lastOldIdx >= 0 ? trace.y[lastOldIdx] : null,
          xNew, yNew, nNew,
          xType, yType
        );
        this.renderer.appendToLineLayer(lineLayerIdxs[0], newSegments, trimCount);
      }

      // Update traceData (O(1) reference swap — no copy)
      const td = this.sceneCompiler.traceData[traceIndex];
      if (td) {
        td.xs = trace.x as Datum[];
        td.ys = trace.y as Datum[];
      }

      // Update idRanges count for this trace
      const idRange = this.sceneCompiler.idRanges.find(r => r.traceIndex === traceIndex);
      if (idRange && trace.x && trace.y) {
        idRange.count = Math.min(trace.x.length, trace.y.length);
      }
    }

    // Recompute all baseIds to prevent id collisions after count changes
    let runningBaseId = 0;
    for (let i = 0; i < this.sceneCompiler.idRanges.length; i++) {
      this.sceneCompiler.idRanges[i].baseId = runningBaseId;
      this.renderer.updateMarkerLayerBaseId(i, runningBaseId);
      runningBaseId += this.sceneCompiler.idRanges[i].count;
    }

    // Rebuild sorted hover indices for affected traces
    const hovermode = this.axisManager.getHoverMode();
    if (hovermode === "x" || hovermode === "y") {
      const SORT_LIMIT = 300_000;
      for (const { update, nNew } of prepared) {
        if (nNew <= 0) continue;
        const { traceIndex } = update;
        const td = this.sceneCompiler.traceData[traceIndex];
        if (!td || td.xs.length > SORT_LIMIT) continue;

        const n = td.xs.length;
        const xsNum = new Float64Array(n);
        const ysNum = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsNum[i] = toNumber(td.xs[i], xType);
          ysNum[i] = toNumber(td.ys[i], yType);
        }
        const orderX = sortedOrder(xsNum);
        const orderY = sortedOrder(ysNum);

        const xi = this.sceneCompiler.xSorted.findIndex(s => s.traceIndex === traceIndex);
        if (xi >= 0) {
          this.sceneCompiler.xSorted[xi] = { traceIndex, order: orderX, xsNum };
          this.sceneCompiler.ySorted[xi] = { traceIndex, order: orderY, ysNum };
        } else {
          this.sceneCompiler.xSorted.push({ traceIndex, order: orderX, xsNum });
          this.sceneCompiler.ySorted.push({ traceIndex, order: orderY, ysNum });
        }
      }
    }

    return true;
  }

  /**
   * Build the line segments for a fast-path append: junction segment (lastOld → firstNew)
   * plus all consecutive segments within the new points.
   */
  private buildFastAppendSegments(
    lastOldX: Datum | null,
    lastOldY: Datum | null,
    xNew: Datum[],
    yNew: Datum[],
    nNew: number,
    xType: AxisType,
    yType: AxisType
  ): Float32Array {
    const [x0, x1] = this.sceneCompiler.xDomainNum;
    const [y0, y1] = this.sceneCompiler.yDomainNum;
    const lx0 = xType === "log" ? Math.log10(x0) : x0;
    const lx1 = xType === "log" ? Math.log10(x1) : x1;
    const ly0 = yType === "log" ? Math.log10(y0) : y0;
    const ly1 = yType === "log" ? Math.log10(y1) : y1;
    const invX = 1 / (lx1 - lx0);
    const invY = 1 / (ly1 - ly0);

    const normPoint = (xv: Datum, yv: Datum): [number, number] => {
      let xn = toNumber(xv, xType);
      let yn = toNumber(yv, yType);
      if (xType === "log") xn = xn > 0 ? Math.log10(xn) : NaN;
      if (yType === "log") yn = yn > 0 ? Math.log10(yn) : NaN;
      return [
        Number.isFinite(xn) ? (xn - lx0) * invX : NaN,
        Number.isFinite(yn) ? 1 - (yn - ly0) * invY : NaN
      ];
    };

    // Collect all points: [lastOld (if any), new[0], new[1], ..., new[nNew-1]]
    const pts: Array<[number, number]> = [];
    if (lastOldX !== null && lastOldY !== null) {
      pts.push(normPoint(lastOldX, lastOldY));
    }
    for (let i = 0; i < nNew; i++) {
      pts.push(normPoint(xNew[i], yNew[i]));
    }

    // Build segments between consecutive finite points
    const out: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(bx) && Number.isFinite(by)) {
        out.push(ax, ay, bx, by);
      }
    }
    return new Float32Array(out);
  }
}
