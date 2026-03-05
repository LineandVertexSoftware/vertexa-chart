import type { AxisType, Datum, LineSmoothingMode, Trace } from "./types.js";
import type { WebGPURenderer } from "@lineandvertexsoftware/renderer-webgpu";
import {
  type DomainNum,
  type ResolvedChartTheme,
  type Padding,
  DEFAULT_BAR_WIDTH_PX,
  DEFAULT_AREA_OPACITY,
  DEFAULT_HEATMAP_OPACITY,
  clamp01,
  parseColor,
  toNumber,
  sortedOrder,
  buildCategoryOrder,
  makeCategoryMap
} from "./chart-utils.js";
import {
  toHeatmapRows,
  normalizeAxisValues,
  computeAxisEdges,
  resolveHeatmapScale,
  resolveHeatmapZRange,
  interpolateHeatmapColor,
  estimateHeatmapHoverSize
} from "./heatmap.js";
import {
  computeAxisDomain,
  normalizeInterleaved,
  smoothLinePoints,
  getTraceColor,
  normalizeBarBaseY,
  normalizeScalarX,
  normalizeScalarY,
  normalizeAreaBaseY,
  computeAreaFillWidthPx,
  computeStackedYDomain,
  type BarStackEntry
} from "./scene.js";
import { computeHistogram, type ComputedHistogram } from "./histogram.js";
import type { AxisManager } from "./AxisManager.js";

export type TraceDataEntry = { xs: Datum[]; ys: Datum[]; name: string };
export type SceneResult = Parameters<WebGPURenderer["setLayers"]>[0];

export class SceneCompiler {
  traceData: Array<TraceDataEntry | null> = [];
  heatmapValueByTrace = new Map<number, Float64Array>();
  heatmapHoverSizeByTrace = new Map<number, number>();
  markerNormByTrace = new Map<number, Float32Array>();
  markerNormByTraceDirty = new Set<number>();
  markerNormLayers: { traceIndex: number; points01: Float32Array }[] = [];
  idRanges: { baseId: number; count: number; traceIndex: number }[] = [];
  traceToMarkerLayerIdx = new Map<number, number>();
  traceToLineLayerIdxs = new Map<number, number[]>();
  xSorted: { traceIndex: number; order: Uint32Array; xsNum: Float64Array }[] = [];
  ySorted: { traceIndex: number; order: Uint32Array; ysNum: Float64Array }[] = [];
  xDomainNum: DomainNum = [0, 1];
  yDomainNum: DomainNum = [0, 1];
  xCategories: string[] | null = null;
  yCategories: string[] | null = null;
  private xCatMap: Map<string, number> = new Map();
  private yCatMap: Map<string, number> = new Map();

  compile(
    traces: Trace[],
    axisManager: AxisManager,
    theme: ResolvedChartTheme,
    width: number,
    height: number,
    padding: Padding
  ): SceneResult {
    const tracePairs = traces.map((trace, traceIndex) => ({ trace, traceIndex }));

    const xType = axisManager.resolveAxisType("x");
    const yType = axisManager.resolveAxisType("y");

    // Build category orders and maps (empty for non-category axes).
    this.xCategories = null;
    this.yCategories = null;
    this.xCatMap = new Map();
    this.yCatMap = new Map();
    if (xType === "category") {
      this.xCategories = buildCategoryOrder(traces, "x", axisManager.getAxis("x")?.categories);
      this.xCatMap = makeCategoryMap(this.xCategories);
    }
    if (yType === "category") {
      this.yCategories = buildCategoryOrder(traces, "y", axisManager.getAxis("y")?.categories);
      this.yCatMap = makeCategoryMap(this.yCategories);
    }
    validateCategoryConsistency(traces, xType, yType);

    // Pre-compute histogram bins (needs axis types, independent of domain).
    const histogramData = computeAllHistogramData(traces, xType, yType);

    // Cache raw trace data by source trace index to keep ID->trace mapping stable.
    this.traceData = new Array(traces.length).fill(null);
    this.heatmapValueByTrace.clear();
    this.heatmapHoverSizeByTrace.clear();
    for (const { trace, traceIndex } of tracePairs) {
      if (trace.type === "heatmap") {
        const xVals = Array.from(trace.x);
        const yVals = Array.from(trace.y);
        const rows = toHeatmapRows(trace.z);
        const ny = Math.min(yVals.length, rows.length);

        const xs: Datum[] = [];
        const ys: Datum[] = [];
        const zs: number[] = [];
        for (let yi = 0; yi < ny; yi++) {
          const row = rows[yi];
          const nx = Math.min(xVals.length, row.length);
          for (let xi = 0; xi < nx; xi++) {
            const z = Number(row[xi]);
            if (!Number.isFinite(z)) continue;
            xs.push(xVals[xi]);
            ys.push(yVals[yi]);
            zs.push(z);
          }
        }

        this.traceData[traceIndex] = { xs, ys, name: trace.name ?? `Trace ${traceIndex + 1}` };
        this.heatmapValueByTrace.set(traceIndex, new Float64Array(zs));
        continue;
      }

      if (trace.type === "histogram") {
        // Store computed bin centres / values so the hover/picking system can
        // return meaningful x/y data without exposing raw input arrays.
        const hd = histogramData.get(traceIndex);
        const xs: Datum[] = hd ? Array.from(hd.binCenters) : [];
        const ys: Datum[] = hd ? Array.from(hd.binValues)  : [];
        this.traceData[traceIndex] = { xs, ys, name: trace.name ?? `Trace ${traceIndex + 1}` };
        continue;
      }

      const n = Math.min(trace.x.length, trace.y.length);
      const xs: Datum[] = new Array(n);
      const ys: Datum[] = new Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = trace.x[i];
        ys[i] = trace.y[i];
      }
      this.traceData[traceIndex] = { xs, ys, name: trace.name ?? `Trace ${traceIndex + 1}` };
    }

    // compute domains from traces (include legendonly by default to keep axes stable)
    this.xDomainNum = computeAxisDomain(traces, "x", axisManager.getAxis("x"), xType, this.xCategories ?? undefined);
    this.yDomainNum = computeAxisDomain(traces, "y", axisManager.getAxis("y"), yType, this.yCategories ?? undefined);

    // Extend domain to cover histogram bin extents and bar heights.
    for (const [, hd] of histogramData) {
      if (hd.binEdges.length < 2) continue;
      const edgeMin = hd.binEdges[0];
      const edgeMax = hd.binEdges[hd.binEdges.length - 1];
      let valueMax = 0;
      for (let i = 0; i < hd.binValues.length; i++) {
        if (hd.binValues[i] > valueMax) valueMax = hd.binValues[i];
      }
      const pad = valueMax * 0.05;
      if (hd.orientation === "v") {
        const [xd0, xd1] = this.xDomainNum;
        const [yd0, yd1] = this.yDomainNum;
        this.xDomainNum = [Math.min(xd0, edgeMin), Math.max(xd1, edgeMax)];
        this.yDomainNum = [Math.min(yd0, 0), Math.max(yd1, valueMax + pad)];
      } else {
        const [xd0, xd1] = this.xDomainNum;
        const [yd0, yd1] = this.yDomainNum;
        this.yDomainNum = [Math.min(yd0, edgeMin), Math.max(yd1, edgeMax)];
        this.xDomainNum = [Math.min(xd0, 0), Math.max(xd1, valueMax + pad)];
      }
    }

    // barmode layout
    const barmode = axisManager.getBarMode();
    const plotWidth = Math.max(1, width - padding.l - padding.r);
    const barGroupInfo = barmode === "group" ? computeBarGroupInfo(traces) : null;
    const barStackData = barmode === "stack" ? computeBarStackData(traces, xType, yType) : null;
    if (barmode === "stack" && barStackData && barStackData.size > 0) {
      this.yDomainNum = computeStackedYDomain(barStackData, axisManager.getAxis("y"), yType);
    }

    // clear caches
    this.markerNormByTrace.clear();
    this.markerNormLayers = [];
    this.idRanges = [];
    this.traceToMarkerLayerIdx.clear();
    this.traceToLineLayerIdxs.clear();
    this.markerNormByTraceDirty.clear();

    const markers: SceneResult["markers"] = [];
    const lines: SceneResult["lines"] = [];

    let nextBaseId = 0;

    // Build layers
    tracePairs.forEach(({ trace, traceIndex }) => {
      const vis = trace.visible ?? true;
      const renderable = vis === true;

      // still keep legendonly in legend; just skip render
      if (!renderable) return;

      if (trace.type === "bar") {
        const points01 = normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum, this.xCatMap, this.yCatMap);
        const count = points01.length / 2;
        if (count <= 0) return;

        const widthPx = Math.max(1, trace.bar?.widthPx ?? DEFAULT_BAR_WIDTH_PX);

        // --- group: compute x offset in normalized space ---
        let xOffsetNorm = 0;
        if (barmode === "group" && barGroupInfo) {
          const info = barGroupInfo.get(traceIndex);
          if (info && info.totalGroups > 1) {
            const gap = 2; // px between adjacent grouped bars
            const offsetPx = (info.groupIndex - (info.totalGroups - 1) / 2) * (widthPx + gap);
            xOffsetNorm = offsetPx / plotWidth;
          }
        }

        // --- stack: retrieve per-point base/top in data units ---
        const stackEntries = barmode === "stack" ? (barStackData?.get(traceIndex) ?? null) : null;

        // Build adjusted marker points (shifted x for group; stacked top y for stack).
        let markerPoints01 = points01;
        if (xOffsetNorm !== 0 || stackEntries) {
          const adj = new Float32Array(count * 2);
          for (let i = 0; i < count; i++) {
            adj[i * 2] = points01[i * 2] + xOffsetNorm;
            if (stackEntries) {
              const e = stackEntries[i];
              adj[i * 2 + 1] = e ? normalizeScalarY(e.top, yType, this.yDomainNum) : points01[i * 2 + 1];
            } else {
              adj[i * 2 + 1] = points01[i * 2 + 1];
            }
          }
          markerPoints01 = adj;
        }

        const baseId = nextBaseId;
        nextBaseId += count;

        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, markerPoints01);
        this.markerNormLayers.push({ traceIndex, points01: markerPoints01 });

        markers.push({
          points01: markerPoints01,
          // Keep pick/hover support for bars without rendering marker sprites.
          pointSizePx: Math.max(2, widthPx),
          rgba: [0, 0, 0, 0],
          baseId
        });

        // Build bar line segments with group offset and/or stack bases applied.
        const defaultBaseYn = normalizeBarBaseY(trace, yType, this.yDomainNum);
        const barPoints: number[] = [];
        for (let i = 0; i < count; i++) {
          const xn = points01[i * 2] + xOffsetNorm;
          let baseYn: number;
          let topYn: number;
          if (stackEntries) {
            const e = stackEntries[i];
            if (e) {
              baseYn = normalizeScalarY(e.base, yType, this.yDomainNum);
              topYn = normalizeScalarY(e.top, yType, this.yDomainNum);
            } else {
              baseYn = defaultBaseYn;
              topYn = points01[i * 2 + 1];
            }
          } else {
            baseYn = defaultBaseYn;
            topYn = points01[i * 2 + 1];
          }
          if (Number.isFinite(xn) && Number.isFinite(topYn) && Number.isFinite(baseYn)) {
            barPoints.push(xn, baseYn, xn, topYn, Number.NaN, Number.NaN);
          } else {
            barPoints.push(Number.NaN, Number.NaN);
          }
        }

        const baseColor = getTraceColor(trace, traceIndex, theme.colors.palette);
        const c = parseColor(baseColor) ?? [0.12, 0.55, 0.95];
        const a = clamp01(trace.bar?.opacity ?? trace.marker?.opacity ?? 0.65);
        lines.push({
          points01: new Float32Array(barPoints),
          rgba: [c[0], c[1], c[2], a],
          widthPx,
          dash: "solid"
        });
        return;
      }

      if (trace.type === "heatmap") {
        const xVals = Array.from(trace.x);
        const yVals = Array.from(trace.y);
        const rows = toHeatmapRows(trace.z);
        const ny = Math.min(yVals.length, rows.length);
        if (xVals.length === 0 || ny === 0) return;

        const xCenters01 = normalizeAxisValues(xVals, xType, this.xDomainNum, false);
        const yCenters01 = normalizeAxisValues(yVals, yType, this.yDomainNum, true);
        const xEdges01 = computeAxisEdges(xCenters01);
        const yEdges01 = computeAxisEdges(yCenters01);

        const plotW = Math.max(1, width - padding.l - padding.r);
        const plotH = Math.max(1, height - padding.t - padding.b);
        const fillOpacity = clamp01(trace.heatmap?.opacity ?? DEFAULT_HEATMAP_OPACITY);
        const colors = resolveHeatmapScale(trace);
        const zRange = resolveHeatmapZRange(trace, rows);
        const markerPoints: number[] = [];
        const widthSamples: number[] = [];
        const heightSamples: number[] = [];

        for (let yi = 0; yi < ny; yi++) {
          const row = rows[yi];
          const nx = Math.min(xVals.length, row.length);
          for (let xi = 0; xi < nx; xi++) {
            const z = Number(row[xi]);
            const xc = xCenters01[xi];
            const y0 = yEdges01[yi];
            const y1 = yEdges01[yi + 1];
            const x0 = xEdges01[xi];
            const x1 = xEdges01[xi + 1];
            if (!Number.isFinite(z) || !Number.isFinite(xc) || !Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(x0) || !Number.isFinite(x1)) continue;

            markerPoints.push(xc, (y0 + y1) * 0.5);
            const widthPx = Math.max(1, Math.min(48, Math.abs(x1 - x0) * plotW * 0.98));
            const heightPx = Math.max(1, Math.min(48, Math.abs(y1 - y0) * plotH));
            widthSamples.push(widthPx);
            heightSamples.push(heightPx);

            const col = interpolateHeatmapColor(z, zRange[0], zRange[1], colors);
            lines.push({
              points01: new Float32Array([xc, y0, xc, y1]),
              rgba: [col[0], col[1], col[2], fillOpacity],
              widthPx,
              dash: "solid"
            });
          }
        }

        const count = markerPoints.length / 2;
        if (count <= 0) return;
        const baseId = nextBaseId;
        nextBaseId += count;

        const markerSize = estimateHeatmapHoverSize(widthSamples, heightSamples);
        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, new Float32Array(markerPoints));
        this.markerNormLayers.push({ traceIndex, points01: new Float32Array(markerPoints) });
        this.heatmapHoverSizeByTrace.set(traceIndex, markerSize);
        markers.push({
          points01: new Float32Array(markerPoints),
          pointSizePx: markerSize,
          rgba: [0, 0, 0, 0],
          baseId
        });
        return;
      }

      if (trace.type === "area") {
        const points01 = normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum, this.xCatMap, this.yCatMap);
        const count = points01.length / 2;
        if (count <= 0) return;

        const mode = trace.mode ?? "lines";
        const showMarkers = mode === "markers" || mode === "lines+markers";
        const showBoundary = mode === "lines" || mode === "lines+markers";
        const baseColor = getTraceColor(trace, traceIndex, theme.colors.palette);

        const markerRgb = parseColor(trace.marker?.color ?? baseColor) ?? [0.12, 0.55, 0.95];
        const markerAlpha = clamp01(showMarkers ? (trace.marker?.opacity ?? 0.35) : 0);

        const baseId = nextBaseId;
        nextBaseId += count;
        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, points01);
        this.markerNormLayers.push({ traceIndex, points01 });
        markers.push({
          points01,
          pointSizePx: trace.marker?.sizePx ?? 2,
          rgba: [markerRgb[0], markerRgb[1], markerRgb[2], markerAlpha],
          baseId
        });

        const baseYn = normalizeAreaBaseY(trace, yType, this.yDomainNum);
        const fillPoints: number[] = [];
        for (let i = 0; i < count; i++) {
          const xn = points01[i * 2 + 0];
          const yn = points01[i * 2 + 1];
          if (Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(baseYn)) {
            fillPoints.push(xn, baseYn, xn, yn, Number.NaN, Number.NaN);
          } else {
            fillPoints.push(Number.NaN, Number.NaN);
          }
        }

        const fillRgb = parseColor(trace.area?.color ?? baseColor) ?? [0.12, 0.55, 0.95];
        lines.push({
          points01: new Float32Array(fillPoints),
          rgba: [fillRgb[0], fillRgb[1], fillRgb[2], clamp01(trace.area?.opacity ?? DEFAULT_AREA_OPACITY)],
          widthPx: computeAreaFillWidthPx(points01, Math.max(1, width - padding.l - padding.r)),
          dash: "solid"
        });

        if (showBoundary) {
          const smoothingMode = (trace.line?.smoothing ?? "none") as LineSmoothingMode;
          const linePoints01 = smoothLinePoints(points01, smoothingMode);
          const c = parseColor(trace.line?.color ?? baseColor) ?? [0.12, 0.12, 0.12];
          const a = clamp01(trace.line?.opacity ?? 0.8);
          lines.push({
            points01: linePoints01,
            rgba: [c[0], c[1], c[2], a],
            widthPx: trace.line?.widthPx ?? 1.5,
            dash: trace.line?.dash ?? "solid"
          });
        }
        return;
      }

      if (trace.type === "histogram") {
        const hd = histogramData.get(traceIndex);
        if (!hd || hd.binCenters.length === 0) return;

        const nBins = hd.binCenters.length;
        const isH = hd.orientation === "h";
        const plotH = Math.max(1, height - padding.t - padding.b);

        // Compute bar visual size in pixels from bin width in data units.
        const binSpan = hd.binEdges.length > 1 ? hd.binEdges[1] - hd.binEdges[0] : 1;
        let barWidthPx: number;
        if (trace.bar?.widthPx != null) {
          barWidthPx = Math.max(1, trace.bar.widthPx);
        } else if (isH) {
          const [yd0, yd1] = this.yDomainNum;
          barWidthPx = yd1 > yd0 ? Math.max(1, (binSpan / (yd1 - yd0)) * plotH * 0.98) : DEFAULT_BAR_WIDTH_PX;
        } else {
          const [xd0, xd1] = this.xDomainNum;
          barWidthPx = xd1 > xd0 ? Math.max(1, (binSpan / (xd1 - xd0)) * plotWidth * 0.98) : DEFAULT_BAR_WIDTH_PX;
        }

        // Normalize bin centres and values into [0,1] space.
        // For "v": x = centres, y = values.  For "h": x = values, y = centres.
        const points01 = isH
          ? normalizeInterleaved(hd.binValues, hd.binCenters, xType, yType, this.xDomainNum, this.yDomainNum)
          : normalizeInterleaved(hd.binCenters, hd.binValues, xType, yType, this.xDomainNum, this.yDomainNum);
        const count = points01.length / 2;
        if (count <= 0) return;

        const baseId = nextBaseId;
        nextBaseId += count;
        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, points01);
        this.markerNormLayers.push({ traceIndex, points01 });

        markers.push({
          points01,
          pointSizePx: Math.max(2, barWidthPx),
          rgba: [0, 0, 0, 0],
          baseId
        });

        const baseColor = getTraceColor(trace, traceIndex, theme.colors.palette);
        const c = parseColor(baseColor) ?? [0.12, 0.55, 0.95];
        const a = clamp01(trace.bar?.opacity ?? trace.marker?.opacity ?? 0.65);

        const barPoints: number[] = [];
        if (isH) {
          // Horizontal bars: from x=0 to x=binValue[i] at y=binCentre[i].
          const baseXn = normalizeScalarX(0, xType, this.xDomainNum);
          for (let i = 0; i < nBins; i++) {
            const yn    = points01[i * 2 + 1];
            const topXn = points01[i * 2];
            if (Number.isFinite(yn) && Number.isFinite(topXn) && Number.isFinite(baseXn)) {
              barPoints.push(baseXn, yn, topXn, yn, Number.NaN, Number.NaN);
            } else {
              barPoints.push(Number.NaN, Number.NaN);
            }
          }
        } else {
          // Vertical bars: from y=0 to y=binValue[i] at x=binCentre[i].
          const baseYn = normalizeScalarY(0, yType, this.yDomainNum);
          for (let i = 0; i < nBins; i++) {
            const xn    = points01[i * 2];
            const topYn = points01[i * 2 + 1];
            if (Number.isFinite(xn) && Number.isFinite(topYn) && Number.isFinite(baseYn)) {
              barPoints.push(xn, baseYn, xn, topYn, Number.NaN, Number.NaN);
            } else {
              barPoints.push(Number.NaN, Number.NaN);
            }
          }
        }

        lines.push({
          points01: new Float32Array(barPoints),
          rgba: [c[0], c[1], c[2], a],
          widthPx: barWidthPx,
          dash: "solid"
        });
        return;
      }

      // scatter (default fallthrough — type narrowed to ScatterTrace here)
      const mode = trace.mode ?? "markers";
      const points01 = normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum, this.xCatMap, this.yCatMap);

      const baseColor = getTraceColor(trace, traceIndex, theme.colors.palette);

      if (mode === "markers" || mode === "lines+markers") {
        const c = parseColor(baseColor) ?? [0.12, 0.55, 0.95];
        const a = clamp01(trace.marker?.opacity ?? 0.35);

        const count = points01.length / 2;
        const baseId = nextBaseId;
        nextBaseId += count;

        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, points01);
        this.markerNormLayers.push({ traceIndex, points01 });
        this.traceToMarkerLayerIdx.set(traceIndex, markers.length);

        markers.push({
          points01,
          pointSizePx: trace.marker?.sizePx ?? 2,
          rgba: [c[0], c[1], c[2], a],
          baseId
        });
      }

      if (mode === "lines" || mode === "lines+markers") {
        const smoothingMode = (trace.line?.smoothing ?? "none") as LineSmoothingMode;
        const linePoints01 = smoothLinePoints(points01, smoothingMode);
        const c = parseColor(trace.line?.color ?? baseColor) ?? [0.12, 0.12, 0.12];
        const a = clamp01(trace.line?.opacity ?? 0.55);
        // Track line layer index for fast-path incremental updates
        const existing = this.traceToLineLayerIdxs.get(traceIndex) ?? [];
        existing.push(lines.length);
        this.traceToLineLayerIdxs.set(traceIndex, existing);
        lines.push({
          points01: linePoints01,
          rgba: [c[0], c[1], c[2], a],
          widthPx: trace.line?.widthPx ?? 1,
          dash: trace.line?.dash ?? "solid"
        });
      }
    });

    // build sorted indices for hovermode x/y (small traces only)
    this.xSorted = [];
    this.ySorted = [];
    const hovermode = axisManager.getHoverMode();
    if (hovermode === "x" || hovermode === "y") {
      const SORT_LIMIT = 300_000;

      for (const L of this.markerNormLayers) {
        const tIdx = L.traceIndex;
        const td = this.traceData[tIdx];
        if (!td) continue;

        const n = td.xs.length;
        if (n > SORT_LIMIT) continue;

        const xsNum = new Float64Array(n);
        const ysNum = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsNum[i] = xType === "category"
            ? (this.xCatMap.get(String(td.xs[i])) ?? NaN)
            : toNumber(td.xs[i], xType);
          ysNum[i] = yType === "category"
            ? (this.yCatMap.get(String(td.ys[i])) ?? NaN)
            : toNumber(td.ys[i], yType);
        }

        const orderX = sortedOrder(xsNum);
        const orderY = sortedOrder(ysNum);
        this.xSorted.push({ traceIndex: tIdx, order: orderX, xsNum });
        this.ySorted.push({ traceIndex: tIdx, order: orderY, ysNum });
      }
    }

    return { markers, lines };
  }
}

// ----------------------------
// Bar layout helpers
// ----------------------------

type BarGroupInfo = { groupIndex: number; totalGroups: number };

function computeBarGroupInfo(traces: Trace[]): Map<number, BarGroupInfo> {
  const result = new Map<number, BarGroupInfo>();
  let idx = 0;
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i];
    if (t.type !== "bar" || (t.visible ?? true) !== true) continue;
    result.set(i, { groupIndex: idx++, totalGroups: 0 });
  }
  for (const v of result.values()) v.totalGroups = idx;
  return result;
}

function computeBarStackData(traces: Trace[], xType: AxisType, yType: AxisType): Map<number, BarStackEntry[]> {
  const result = new Map<number, BarStackEntry[]>();
  const posRunning = new Map<string, number>(); // xKey → current positive top
  const negRunning = new Map<string, number>(); // xKey → current negative bottom

  for (let ti = 0; ti < traces.length; ti++) {
    const t = traces[ti];
    if (t.type !== "bar" || (t.visible ?? true) !== true) continue;

    const n = Math.min(t.x.length, t.y.length);
    const entries: BarStackEntry[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const xKey = xType === "category"
        ? String(t.x[i])
        : String(toNumber(t.x[i] as Datum, xType));
      const yv = toNumber(t.y[i] as Datum, yType);

      if (!Number.isFinite(yv) || yv >= 0) {
        const base = posRunning.get(xKey) ?? 0;
        const top = base + (Number.isFinite(yv) ? yv : 0);
        entries[i] = { base, top };
        if (Number.isFinite(yv)) posRunning.set(xKey, top);
      } else {
        const currentBottom = negRunning.get(xKey) ?? 0;
        const newBottom = currentBottom + yv;
        entries[i] = { base: newBottom, top: currentBottom };
        negRunning.set(xKey, newBottom);
      }
    }

    result.set(ti, entries);
  }
  return result;
}

// ----------------------------
// Histogram layout helpers
// ----------------------------

type HistogramEntry = ComputedHistogram & { orientation: "v" | "h" };

function computeAllHistogramData(traces: Trace[], xType: AxisType, yType: AxisType): Map<number, HistogramEntry> {
  const result = new Map<number, HistogramEntry>();

  for (let ti = 0; ti < traces.length; ti++) {
    const t = traces[ti];
    if (t.type !== "histogram") continue;
    if ((t.visible ?? true) === false) continue;

    // Determine orientation: explicit > presence of x > presence of y > default "v".
    const orientation: "v" | "h" = t.orientation ?? (t.x ? "v" : (t.y ? "h" : "v"));

    const binDimRaw  = orientation === "v" ? t.x : t.y;
    const funcDimRaw = orientation === "v" ? t.y : t.x;
    if (!binDimRaw || binDimRaw.length === 0) continue;

    const binAxisType  = orientation === "v" ? xType : yType;
    const funcAxisType = orientation === "v" ? yType : xType;
    const histfunc = t.histfunc ?? "count";

    // Convert Datum arrays to numbers.
    const binData: number[] = [];
    for (let i = 0; i < binDimRaw.length; i++) {
      binData.push(toNumber(binDimRaw[i], binAxisType));
    }

    let funcData: number[] | null = null;
    if (histfunc !== "count" && funcDimRaw && funcDimRaw.length > 0) {
      funcData = [];
      for (let i = 0; i < binDimRaw.length; i++) {
        funcData.push(toNumber(funcDimRaw[i], funcAxisType));
      }
    }

    const nbins    = orientation === "v" ? t.nbinsx : t.nbinsy;
    const binsSpec = orientation === "v" ? t.xbins  : t.ybins;

    const computed = computeHistogram(binData, funcData, histfunc, t.histnorm ?? "", nbins, binsSpec);
    result.set(ti, { ...computed, orientation });
  }

  return result;
}

function validateCategoryConsistency(traces: Trace[], xType: AxisType, yType: AxisType): void {
  for (const which of ["x", "y"] as const) {
    const axisType = which === "x" ? xType : yType;
    if (axisType !== "category") continue;

    let hasStrings = false;
    let hasNums = false;
    for (let ti = 0; ti < traces.length; ti++) {
      const t = traces[ti];
      if (t.visible === false) continue;
      const arr = which === "x" ? t.x : t.y;
      if (!arr) continue; // optional x/y (e.g. HistogramTrace)
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v === "string") hasStrings = true;
        else if (typeof v === "number" && !Number.isNaN(v)) hasNums = true;
        if (hasStrings && hasNums) {
          throw new Error(
            `Category ${which}-axis: trace ${ti} mixes string and numeric values. ` +
            `All ${which} values must be strings for a category axis. ` +
            `Use axis.type "linear" or "time" if the data is numeric.`
          );
        }
      }
    }
  }
}
