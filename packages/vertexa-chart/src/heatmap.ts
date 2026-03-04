import type { AxisType, Datum, HeatmapTrace } from "./types.js";
import { clamp01, parseColor, DEFAULT_HEATMAP_COLORSCALE } from "./chart-utils.js";
import type { DomainNum } from "./chart-utils.js";

export function toHeatmapRows(z: ArrayLike<ArrayLike<number>>): number[][] {
  return Array.from(z as ArrayLike<ArrayLike<number>>, (row) => Array.from(row as ArrayLike<number>, (v) => Number(v)));
}

export function normalizeAxisValues(values: Datum[], type: AxisType, dom: DomainNum, flipY: boolean): Float32Array {
  const out = new Float32Array(values.length);
  const [d0, d1] = dom;
  const l0 = type === "log" ? Math.log10(d0) : d0;
  const l1 = type === "log" ? Math.log10(d1) : d1;
  const inv = 1 / (l1 - l0);

  for (let i = 0; i < values.length; i++) {
    let v = type === "time"
      ? (values[i] instanceof Date ? (values[i] as Date).getTime() : Number(values[i]))
      : (values[i] instanceof Date ? (values[i] as Date).getTime() : Number(values[i]));
    if (type === "log") v = v > 0 ? Math.log10(v) : Number.NaN;
    const n = Number.isFinite(v) ? (v - l0) * inv : Number.NaN;
    out[i] = flipY ? (1 - n) : n;
  }
  return out;
}

export function computeAxisEdges(centers: Float32Array): Float32Array {
  const n = centers.length;
  const edges = new Float32Array(n + 1);
  if (n === 0) return edges;

  if (n === 1) {
    const c = centers[0];
    edges[0] = c - 0.5;
    edges[1] = c + 0.5;
    return edges;
  }

  for (let i = 1; i < n; i++) {
    const a = centers[i - 1];
    const b = centers[i];
    edges[i] = (a + b) * 0.5;
  }

  edges[0] = centers[0] - (edges[1] - centers[0]);
  edges[n] = centers[n - 1] + (centers[n - 1] - edges[n - 1]);
  return edges;
}

export function resolveHeatmapScale(trace: HeatmapTrace): Array<[number, number, number]> {
  const source = trace.heatmap?.colorscale?.length ? trace.heatmap.colorscale : DEFAULT_HEATMAP_COLORSCALE;
  const out: Array<[number, number, number]> = [];
  for (const c of source) {
    const parsed = parseColor(c);
    if (parsed) out.push(parsed);
  }
  return out.length > 0 ? out : [[0.12, 0.55, 0.95]];
}

export function resolveHeatmapZRange(trace: HeatmapTrace, rows: number[][]): [number, number] {
  let zMin = Number.isFinite(trace.heatmap?.zmin) ? Number(trace.heatmap?.zmin) : Number.POSITIVE_INFINITY;
  let zMax = Number.isFinite(trace.heatmap?.zmax) ? Number(trace.heatmap?.zmax) : Number.NEGATIVE_INFINITY;

  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) {
    zMin = Number.POSITIVE_INFINITY;
    zMax = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      for (const value of row) {
        if (!Number.isFinite(value)) continue;
        if (value < zMin) zMin = value;
        if (value > zMax) zMax = value;
      }
    }
  }

  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) return [0, 1];
  if (zMin === zMax) return [zMin - 0.5, zMax + 0.5];
  return [zMin, zMax];
}

export function interpolateHeatmapColor(
  z: number,
  zMin: number,
  zMax: number,
  scale: Array<[number, number, number]>
): [number, number, number] {
  if (scale.length === 1) return scale[0];
  if (!Number.isFinite(z) || !Number.isFinite(zMin) || !Number.isFinite(zMax) || zMax <= zMin) {
    return scale[0];
  }

  const tRaw = (z - zMin) / (zMax - zMin);
  const t = clamp01(tRaw);
  const scaled = t * (scale.length - 1);
  const idx = Math.min(scale.length - 2, Math.max(0, Math.floor(scaled)));
  const localT = scaled - idx;
  const a = scale[idx];
  const b = scale[idx + 1];
  return [
    a[0] + (b[0] - a[0]) * localT,
    a[1] + (b[1] - a[1]) * localT,
    a[2] + (b[2] - a[2]) * localT
  ];
}

export function estimateHeatmapHoverSize(widthPx: number[], heightPx: number[]): number {
  if (widthPx.length === 0 || heightPx.length === 0) return 10;
  const median = (values: number[]) => {
    const v = values.slice().sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const m = Math.max(median(widthPx), median(heightPx));
  return Math.max(6, Math.min(36, m + 2));
}

export function getHeatmapLegendColor(trace: HeatmapTrace): string | undefined {
  const colors = trace.heatmap?.colorscale;
  if (!colors || colors.length === 0) return undefined;
  return colors[Math.floor(colors.length / 2)];
}
