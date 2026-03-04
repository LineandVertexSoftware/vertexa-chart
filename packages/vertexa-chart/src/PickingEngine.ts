import type { Datum, Trace } from "./types.js";
import { type Padding, type Zoom, lowerBoundIdx } from "./chart-utils.js";
import { normalizeInterleaved } from "./scene.js";
import type { GridIndex } from "./GridIndex.js";
import type { SceneCompiler } from "./SceneCompiler.js";
import type { AxisManager } from "./AxisManager.js";

export type PickResult = {
  traceIndex: number;
  pointIndex: number;
  x: Datum;
  y: Datum;
  screenX: number; // CSS px in chart container coords
  screenY: number; // CSS px
};

export type PickingEngineState = {
  width: number;
  height: number;
  padding: Padding;
  zoom: Zoom;
  hoverRpx: number;
  traces: Trace[];
};

export class PickingEngine {
  constructor(
    private sceneCompiler: SceneCompiler,
    private gridIndex: GridIndex,
    private getState: () => PickingEngineState,
    private axisManager: AxisManager
  ) {}

  screenToPlot(screenX: number, screenY: number) {
    const { padding } = this.getState();
    return { xPlot: screenX - padding.l, yPlot: screenY - padding.t };
  }

  toScreenFromNorm(xn: number, yn: number) {
    const { width, height, padding, zoom } = this.getState();
    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);
    const ox = padding.l;
    const oy = padding.t;
    const k = zoom.k;
    const tx = zoom.x;
    const ty = zoom.y;
    return {
      screenX: ox + (xn * plotW) * k + tx,
      screenY: oy + (yn * plotH) * k + ty
    };
  }

  getNormPoint(traceIndex: number, pointIndex: number) {
    const { traces } = this.getState();
    // Rebuild if the CPU cache was invalidated by a fast-path append
    if (this.sceneCompiler.markerNormByTraceDirty.has(traceIndex)) {
      const trace = traces[traceIndex];
      if (trace) {
        const xType = this.axisManager.resolveAxisType("x");
        const yType = this.axisManager.resolveAxisType("y");
        const rebuilt = normalizeInterleaved(
          trace.x, trace.y, xType, yType,
          this.sceneCompiler.xDomainNum, this.sceneCompiler.yDomainNum
        );
        this.sceneCompiler.markerNormByTrace.set(traceIndex, rebuilt);
      }
      this.sceneCompiler.markerNormByTraceDirty.delete(traceIndex);
    }
    const pts = this.sceneCompiler.markerNormByTrace.get(traceIndex);
    if (!pts) return null;
    const i = pointIndex * 2;
    if (i + 1 >= pts.length) return null;
    return { xn: pts[i], yn: pts[i + 1] };
  }

  idToHit(id: number): PickResult | null {
    if (!id) return null;
    const gid = id - 1;

    for (const r of this.sceneCompiler.idRanges) {
      if (gid >= r.baseId && gid < r.baseId + r.count) {
        const pointIndex = gid - r.baseId;

        const tIdx = r.traceIndex;
        const td = this.sceneCompiler.traceData[tIdx];
        if (!td) return null;

        const norm = this.getNormPoint(tIdx, pointIndex);
        if (!norm) return null;

        const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
        return { traceIndex: tIdx, pointIndex, x: td.xs[pointIndex], y: td.ys[pointIndex], screenX, screenY };
      }
    }
    return null;
  }

  cpuPickClosest(xCss: number, yCss: number): PickResult | null {
    if (!this.gridIndex.built) return this.cpuPickFallbackScan(xCss, yCss);

    const { width, height, padding, zoom, hoverRpx } = this.getState();

    // Check both scale AND translation changes
    const dk = Math.abs(zoom.k - this.gridIndex.lastZoomK) / Math.max(1e-6, this.gridIndex.lastZoomK);
    if (dk >= this.gridIndex.minScaleRelDelta) return this.cpuPickFallbackScan(xCss, yCss);
    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);
    const relDeltaX = Math.abs(zoom.x - this.gridIndex.lastZoomX) / plotW;
    const relDeltaY = Math.abs(zoom.y - this.gridIndex.lastZoomY) / plotH;
    if (relDeltaX > this.gridIndex.minTransRelDelta || relDeltaY > this.gridIndex.minTransRelDelta) {
      return this.cpuPickFallbackScan(xCss, yCss);
    }

    // Convert pointer into grid base space (pan compensation)
    const dxPan = zoom.x - this.gridIndex.lastZoomX;
    const dyPan = zoom.y - this.gridIndex.lastZoomY;
    const xBase = xCss - dxPan;
    const yBase = yCss - dyPan;

    const r2 = hoverRpx * hoverRpx;

    const cx = Math.floor(xBase / this.gridIndex.cellPx);
    const cy = Math.floor(yBase / this.gridIndex.cellPx);
    const dc = Math.ceil(hoverRpx / this.gridIndex.cellPx);

    let bestGi = -1;
    let bestD2 = Number.POSITIVE_INFINITY;

    for (let oy = -dc; oy <= dc; oy++) {
      for (let ox = -dc; ox <= dc; ox++) {
        const key = this.gridIndex.key(cx + ox, cy + oy);
        const bucket = this.gridIndex.gridMap.get(key);
        if (!bucket) continue;

        for (let bi = 0; bi < bucket.length; bi++) {
          const gi = bucket[bi];
          const px = this.gridIndex.gridX[gi];
          const py = this.gridIndex.gridY[gi];

          const dx = px - xBase;
          const dy = py - yBase;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2 && d2 < bestD2) {
            bestD2 = d2;
            bestGi = gi;
          }
        }
      }
    }

    if (bestGi < 0) return null;

    const tIdx = this.gridIndex.gridTrace[bestGi];
    const pIdx = this.gridIndex.gridPoint[bestGi];
    const td = this.sceneCompiler.traceData[tIdx];
    if (!td) return null;

    const norm = this.getNormPoint(tIdx, pIdx);
    if (!norm) return null;

    const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
    return { traceIndex: tIdx, pointIndex: pIdx, x: td.xs[pIdx], y: td.ys[pIdx], screenX, screenY };
  }

  cpuPickFallbackScan(xCss: number, yCss: number): PickResult | null {
    const cap = 40_000;
    const { width, height, padding, zoom, hoverRpx } = this.getState();
    const r2 = hoverRpx * hoverRpx;

    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);
    const ox = padding.l;
    const oy = padding.t;
    const k = zoom.k;
    const tx = zoom.x;
    const ty = zoom.y;

    let best: PickResult | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    let scanned = 0;

    for (const L of this.sceneCompiler.markerNormLayers) {
      const tIdx = L.traceIndex;
      const pts = L.points01;
      const count = pts.length / 2;
      const td = this.sceneCompiler.traceData[tIdx];
      if (!td) continue;

      for (let i = 0; i < count; i++) {
        scanned++;
        if (scanned > cap) return best;

        const xn = pts[i * 2 + 0];
        const yn = pts[i * 2 + 1];

        const px = ox + (xn * plotW) * k + tx;
        const py = oy + (yn * plotH) * k + ty;

        const dx = px - xCss;
        const dy = py - yCss;
        const d2 = dx * dx + dy * dy;

        if (d2 < r2 && d2 < bestD2) {
          bestD2 = d2;
          best = { traceIndex: tIdx, pointIndex: i, x: td.xs[i], y: td.ys[i], screenX: px, screenY: py };
        }
      }
    }
    return best;
  }

  pickSnapX(cursorXNum: number, cursorScreenX: number): PickResult | null {
    let best: PickResult | null = null;
    let bestDx = Number.POSITIVE_INFINITY;

    for (const s of this.sceneCompiler.xSorted) {
      const tIdx = s.traceIndex;
      const td = this.sceneCompiler.traceData[tIdx];
      if (!td) continue;

      const j = lowerBoundIdx(s.order, s.xsNum, cursorXNum);
      const cand = [j - 1, j, j + 1];

      for (const cj of cand) {
        if (cj < 0 || cj >= s.order.length) continue;
        const pIdx = s.order[cj];

        const norm = this.getNormPoint(tIdx, pIdx);
        if (!norm) continue;

        const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
        const dx = Math.abs(screenX - cursorScreenX);

        if (dx < bestDx) {
          bestDx = dx;
          best = { traceIndex: tIdx, pointIndex: pIdx, x: td.xs[pIdx], y: td.ys[pIdx], screenX, screenY };
        }
      }
    }

    return best;
  }

  pickSnapY(cursorYNum: number, cursorScreenY: number): PickResult | null {
    let best: PickResult | null = null;
    let bestDy = Number.POSITIVE_INFINITY;

    for (const s of this.sceneCompiler.ySorted) {
      const tIdx = s.traceIndex;
      const td = this.sceneCompiler.traceData[tIdx];
      if (!td) continue;

      const j = lowerBoundIdx(s.order, s.ysNum, cursorYNum);
      const cand = [j - 1, j, j + 1];

      for (const cj of cand) {
        if (cj < 0 || cj >= s.order.length) continue;
        const pIdx = s.order[cj];

        const norm = this.getNormPoint(tIdx, pIdx);
        if (!norm) continue;

        const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
        const dy = Math.abs(screenY - cursorScreenY);

        if (dy < bestDy) {
          bestDy = dy;
          best = { traceIndex: tIdx, pointIndex: pIdx, x: td.xs[pIdx], y: td.ys[pIdx], screenX, screenY };
        }
      }
    }

    return best;
  }
}
