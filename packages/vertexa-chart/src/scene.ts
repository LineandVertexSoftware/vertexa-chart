import type { AreaTrace, Axis, AxisType, BarTrace, LineSmoothingMode, Trace } from "./types.js";
import { catmullRom, clamp01, DEFAULT_BAR_WIDTH_PX, DEFAULT_PALETTE, toNumber } from "./chart-utils.js";
import type { DomainNum } from "./chart-utils.js";
import { getHeatmapLegendColor } from "./heatmap.js";

// ----------------------------
// Axis domain
// ----------------------------

export function computeAxisDomain(
  traces: Trace[],
  which: "x" | "y",
  axis: Axis | undefined,
  type: AxisType
): DomainNum {
  if (axis?.domain) {
    return [toNumber(axis.domain[0], type), toNumber(axis.domain[1], type)];
  }
  if (axis?.range) {
    return [toNumber(axis.range[0], type), toNumber(axis.range[1], type)];
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const t of traces) {
    const vis = t.visible ?? true;
    if (vis === false) continue;

    const arr = which === "x" ? t.x : t.y;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const v = toNumber(arr[i], type);
      if (!Number.isFinite(v)) continue;
      if (type === "log" && v <= 0) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (which === "y" && t.type === "bar") {
      const baseDatum = t.bar?.base;
      const baseValue = baseDatum !== undefined
        ? toNumber(baseDatum, type)
        : (type === "log" ? Number.NaN : 0);
      if (Number.isFinite(baseValue) && (type !== "log" || baseValue > 0)) {
        if (baseValue < min) min = baseValue;
        if (baseValue > max) max = baseValue;
      }
    }

    if (which === "y" && t.type === "area") {
      const baseDatum = t.area?.base;
      const baseValue = baseDatum !== undefined
        ? toNumber(baseDatum, type)
        : (type === "log" ? Number.NaN : 0);
      if (Number.isFinite(baseValue) && (type !== "log" || baseValue > 0)) {
        if (baseValue < min) min = baseValue;
        if (baseValue > max) max = baseValue;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    if (!Number.isFinite(min)) return applyAxisBounds([0, 1], axis, type);
    return applyAxisBounds([min - 0.5, max + 0.5], axis, type);
  }

  const pad = (max - min) * 0.02;
  return applyAxisBounds([min - pad, max + pad], axis, type);
}

export function applyAxisBounds(domain: DomainNum, axis: Axis | undefined, type: AxisType): DomainNum {
  let [d0, d1] = domain;
  let minBound = axis?.min !== undefined ? toNumber(axis.min, type) : undefined;
  let maxBound = axis?.max !== undefined ? toNumber(axis.max, type) : undefined;

  if (type === "log") {
    if (minBound !== undefined && minBound <= 0) minBound = undefined;
    if (maxBound !== undefined && maxBound <= 0) maxBound = undefined;
  }

  if (minBound !== undefined && maxBound !== undefined && minBound > maxBound) {
    const t = minBound;
    minBound = maxBound;
    maxBound = t;
  }

  if (minBound !== undefined) d0 = Math.max(d0, minBound);
  if (maxBound !== undefined) d1 = Math.min(d1, maxBound);

  if (d0 < d1) return [d0, d1];

  if (minBound !== undefined && maxBound !== undefined && minBound < maxBound) {
    return [minBound, maxBound];
  }

  if (minBound !== undefined && maxBound === undefined) {
    return [minBound, minBound + 1];
  }
  if (maxBound !== undefined && minBound === undefined) {
    return [maxBound - 1, maxBound];
  }

  const mid = Number.isFinite(d0) ? d0 : 0;
  return [mid - 0.5, mid + 0.5];
}

// ----------------------------
// Normalization
// ----------------------------

export function normalizeInterleaved(
  xs: ArrayLike<unknown>,
  ys: ArrayLike<unknown>,
  xType: AxisType,
  yType: AxisType,
  xDom: DomainNum,
  yDom: DomainNum
): Float32Array {
  const n = Math.min(xs.length, ys.length);
  const out = new Float32Array(n * 2);

  const [x0, x1] = xDom;
  const [y0, y1] = yDom;

  const lx0 = xType === "log" ? Math.log10(x0) : x0;
  const lx1 = xType === "log" ? Math.log10(x1) : x1;
  const ly0 = yType === "log" ? Math.log10(y0) : y0;
  const ly1 = yType === "log" ? Math.log10(y1) : y1;

  const invX = 1 / (lx1 - lx0);
  const invY = 1 / (ly1 - ly0);

  for (let i = 0; i < n; i++) {
    let xv = toNumber(xs[i] as Parameters<typeof toNumber>[0], xType);
    let yv = toNumber(ys[i] as Parameters<typeof toNumber>[0], yType);

    if (xType === "log") xv = xv > 0 ? Math.log10(xv) : NaN;
    if (yType === "log") yv = yv > 0 ? Math.log10(yv) : NaN;

    const xn = Number.isFinite(xv) ? (xv - lx0) * invX : NaN;
    // Overlay y-axis uses range [plotH, 0], so flip normalized y for renderer parity.
    const yn = Number.isFinite(yv) ? 1 - ((yv - ly0) * invY) : NaN;

    // Keep off-domain points outside [0,1] so zoom/pan can bring them into view.
    out[i * 2 + 0] = xn;
    out[i * 2 + 1] = yn;
  }

  return out;
}

export function smoothLinePoints(points01: Float32Array, mode: LineSmoothingMode): Float32Array {
  if (mode === "none") return points01;

  const count = Math.floor(points01.length / 2);
  if (count < 3) return points01;

  const subdivisions = 4;
  const out: number[] = [];

  const getX = (idx: number) => points01[idx * 2 + 0];
  const getY = (idx: number) => points01[idx * 2 + 1];
  const pushPoint = (x: number, y: number) => {
    out.push(x, y);
  };

  const appendRun = (start: number, end: number) => {
    const runLen = end - start;
    if (runLen <= 0) return;

    if (runLen < 3) {
      for (let i = start; i < end; i++) {
        pushPoint(getX(i), getY(i));
      }
      return;
    }

    pushPoint(getX(start), getY(start));

    for (let i = start; i < end - 1; i++) {
      const i0 = Math.max(start, i - 1);
      const i1 = i;
      const i2 = i + 1;
      const i3 = Math.min(end - 1, i + 2);

      const p0x = getX(i0);
      const p1x = getX(i1);
      const p2x = getX(i2);
      const p3x = getX(i3);
      const p0y = getY(i0);
      const p1y = getY(i1);
      const p2y = getY(i2);
      const p3y = getY(i3);

      for (let step = 1; step <= subdivisions; step++) {
        const t = step / subdivisions;
        const x = catmullRom(p0x, p1x, p2x, p3x, t);
        const y = catmullRom(p0y, p1y, p2y, p3y, t);
        pushPoint(x, y);
      }
    }
  };

  let runStart = -1;
  for (let i = 0; i <= count; i++) {
    const valid = i < count && Number.isFinite(getX(i)) && Number.isFinite(getY(i));
    if (valid) {
      if (runStart < 0) runStart = i;
      continue;
    }

    if (runStart >= 0) {
      appendRun(runStart, i);
      runStart = -1;
    }

    if (i < count) {
      pushPoint(Number.NaN, Number.NaN);
    }
  }

  return out.length > 0 ? new Float32Array(out) : points01;
}

// ----------------------------
// Trace color / size
// ----------------------------

function paletteColor(index: number, palette: string[]): string {
  if (palette.length === 0) return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
  return palette[index % palette.length];
}

export function getTraceColor(trace: Trace, traceIndex: number, palette: string[]): string {
  if (trace.type === "bar") {
    return trace.bar?.color ?? trace.marker?.color ?? paletteColor(traceIndex, palette);
  }
  if (trace.type === "heatmap") {
    return getHeatmapLegendColor(trace) ?? paletteColor(traceIndex, palette);
  }
  if (trace.type === "area") {
    return trace.area?.color ?? trace.line?.color ?? trace.marker?.color ?? paletteColor(traceIndex, palette);
  }
  return trace.marker?.color ?? trace.line?.color ?? paletteColor(traceIndex, palette);
}

export function getTraceHoverSizePx(
  trace: Trace,
  traceIndex: number,
  heatmapHoverSizeByTrace: Map<number, number>
): number {
  if (trace.type === "bar") {
    return Math.max(8, (trace.bar?.widthPx ?? DEFAULT_BAR_WIDTH_PX) + 2);
  }
  if (trace.type === "heatmap") {
    return heatmapHoverSizeByTrace.get(traceIndex) ?? 10;
  }
  if (trace.type === "area") {
    return (trace.marker?.sizePx ?? 2) + 5;
  }
  return (trace.marker?.sizePx ?? 2) + 5;
}

// ----------------------------
// Bar / area base normalization
// ----------------------------

export function normalizeBarBaseY(trace: BarTrace, yType: AxisType, yDom: DomainNum): number {
  const defaultBase = yType === "log" ? yDom[0] : 0;
  let yv = toNumber(trace.bar?.base ?? defaultBase, yType);
  if (yType === "log") yv = yv > 0 ? Math.log10(yv) : Number.NaN;

  const [y0, y1] = yDom;
  const ly0 = yType === "log" ? Math.log10(y0) : y0;
  const ly1 = yType === "log" ? Math.log10(y1) : y1;
  const invY = 1 / (ly1 - ly0);
  return Number.isFinite(yv) ? 1 - ((yv - ly0) * invY) : Number.NaN;
}

export function normalizeAreaBaseY(trace: AreaTrace, yType: AxisType, yDom: DomainNum): number {
  const defaultBase = yType === "log" ? yDom[0] : 0;
  let yv = toNumber(trace.area?.base ?? defaultBase, yType);
  if (yType === "log") yv = yv > 0 ? Math.log10(yv) : Number.NaN;

  const [y0, y1] = yDom;
  const ly0 = yType === "log" ? Math.log10(y0) : y0;
  const ly1 = yType === "log" ? Math.log10(y1) : y1;
  const invY = 1 / (ly1 - ly0);
  return Number.isFinite(yv) ? 1 - ((yv - ly0) * invY) : Number.NaN;
}

export function computeAreaFillWidthPx(points01: Float32Array, plotW: number): number {
  const deltas: number[] = [];
  let prevX = Number.NaN;

  for (let i = 0; i < points01.length; i += 2) {
    const x = points01[i];
    if (!Number.isFinite(x)) {
      prevX = Number.NaN;
      continue;
    }

    if (Number.isFinite(prevX)) {
      const dx = Math.abs(x - prevX);
      if (dx > 0) deltas.push(dx);
    }
    prevX = x;
  }

  if (deltas.length === 0) return Math.max(2, Math.min(24, plotW / 24));

  deltas.sort((a, b) => a - b);
  const mid = deltas[Math.floor(deltas.length / 2)];
  const widthPx = mid * plotW * 0.98;
  return Math.max(1, Math.min(24, widthPx));
}
