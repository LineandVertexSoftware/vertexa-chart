// ----------------------------
// Internal resolved types
// ----------------------------

import type {
  Axis,
  AxisType,
  ChartA11yOptions,
  ChartTheme,
  ChartToolbarOptions,
  ChartToolbarPosition,
  ChartToolbarExportFormat,
  Datum,
  Visible
} from "./types.js";

export type DomainNum = [number, number];
export type Padding = { l: number; r: number; t: number; b: number };
export type Zoom = { k: number; x: number; y: number };

export type ResolvedChartTheme = {
  colors: {
    background: string;
    text: string;
    axis: string;
    grid: string;
    tooltipBackground: string;
    tooltipText: string;
    palette: string[];
  };
  fonts: {
    family: string;
    sizePx: number;
    axisFamily: string;
    axisSizePx: number;
    tooltipFamily: string;
    tooltipSizePx: number;
  };
  axis: {
    color: string;
    textColor: string;
    fontFamily: string;
    fontSizePx: number;
  };
  grid: {
    show: boolean;
    color: string;
    opacity: number;
    strokeWidth: number;
  };
  tooltip: {
    background: string;
    textColor: string;
    fontFamily: string;
    fontSizePx: number;
    borderRadiusPx: number;
    paddingX: number;
    paddingY: number;
    boxShadow: string;
  };
};

export type ResolvedChartA11y = {
  label: string;
  description: string;
  keyboardNavigation: boolean;
  highContrast: boolean;
};

export type ResolvedChartToolbar = {
  show: boolean;
  position: ChartToolbarPosition;
  fullscreen: boolean;
  export: boolean;
  exportFormats: ChartToolbarExportFormat[];
  exportFilename: string;
  exportPixelRatio: number;
};

// ----------------------------
// Constants
// ----------------------------

export const DEFAULT_PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"];
export const DEFAULT_FONT_FAMILY = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const DEFAULT_BAR_WIDTH_PX = 10;
export const DEFAULT_AREA_OPACITY = 0.26;
export const DEFAULT_HEATMAP_OPACITY = 0.84;
export const DEFAULT_HEATMAP_COLORSCALE = ["#0b3c5d", "#328cc1", "#8fd694", "#f6ae2d", "#d7263d"];
export const HIGH_CONTRAST_PALETTE = ["#00e5ff", "#ffd700", "#ff3ea5", "#7dff4d", "#ff8c00", "#8ab4ff"];
export const DEFAULT_TOOLBAR_EXPORT_FORMATS: ChartToolbarExportFormat[] = ["png", "svg", "csv"];

// ----------------------------
// Resolve helpers
// ----------------------------

export function resolveChartA11y(a11y?: ChartA11yOptions): ResolvedChartA11y {
  return {
    label: resolveOptionalString(a11y?.label),
    description: resolveOptionalString(a11y?.description),
    keyboardNavigation: a11y?.keyboardNavigation ?? true,
    highContrast: a11y?.highContrast ?? false
  };
}

export function resolveChartTheme(theme?: ChartTheme, highContrast = false): ResolvedChartTheme {
  const defaults = highContrast
    ? {
        colors: {
          background: "#000000",
          text: "#ffffff",
          axis: "#ffffff",
          grid: "#8a8a8a",
          tooltipBackground: "#000000",
          tooltipText: "#ffffff",
          palette: HIGH_CONTRAST_PALETTE
        },
        axisText: "#ffffff",
        gridOpacity: 1,
        gridStrokeWidth: 1.2,
        tooltipShadow: "0 0 0 rgba(0,0,0,0)"
      }
    : {
        colors: {
          background: "#ffffff",
          text: "#111827",
          axis: "#9ca3af",
          grid: "#e5e7eb",
          tooltipBackground: "rgba(0,0,0,0.75)",
          tooltipText: "#ffffff",
          palette: DEFAULT_PALETTE
        },
        axisText: "#4b5563",
        gridOpacity: 1,
        gridStrokeWidth: 1,
        tooltipShadow: "0 8px 20px rgba(0,0,0,0.18)"
      };

  const colors = {
    background: resolveString(theme?.colors?.background, defaults.colors.background),
    text: resolveString(theme?.colors?.text, defaults.colors.text),
    axis: resolveString(theme?.colors?.axis, defaults.colors.axis),
    grid: resolveString(theme?.colors?.grid, defaults.colors.grid),
    tooltipBackground: resolveString(theme?.colors?.tooltipBackground, defaults.colors.tooltipBackground),
    tooltipText: resolveString(theme?.colors?.tooltipText, defaults.colors.tooltipText),
    palette: resolvePalette(theme?.colors?.palette, defaults.colors.palette)
  };

  const fonts = {
    family: resolveString(theme?.fonts?.family, DEFAULT_FONT_FAMILY),
    sizePx: clampToFinite(theme?.fonts?.sizePx, 1, 96, 12),
    axisFamily: resolveString(theme?.fonts?.axisFamily, resolveString(theme?.fonts?.family, DEFAULT_FONT_FAMILY)),
    axisSizePx: clampToFinite(theme?.fonts?.axisSizePx, 1, 96, clampToFinite(theme?.fonts?.sizePx, 1, 96, 12)),
    tooltipFamily: resolveString(theme?.fonts?.tooltipFamily, resolveString(theme?.fonts?.family, DEFAULT_FONT_FAMILY)),
    tooltipSizePx: clampToFinite(theme?.fonts?.tooltipSizePx, 1, 96, clampToFinite(theme?.fonts?.sizePx, 1, 96, 12))
  };

  const axis = {
    color: resolveString(theme?.axis?.color, colors.axis),
    textColor: resolveString(theme?.axis?.textColor, resolveString(theme?.colors?.text, defaults.axisText)),
    fontFamily: resolveString(theme?.axis?.fontFamily, fonts.axisFamily),
    fontSizePx: clampToFinite(theme?.axis?.fontSizePx, 1, 96, fonts.axisSizePx)
  };

  const grid = {
    show: theme?.grid?.show ?? true,
    color: resolveString(theme?.grid?.color, colors.grid),
    opacity: clampToFinite(theme?.grid?.opacity, 0, 1, defaults.gridOpacity),
    strokeWidth: clampToFinite(theme?.grid?.strokeWidth, 0, Number.POSITIVE_INFINITY, defaults.gridStrokeWidth)
  };

  const tooltip = {
    background: resolveString(theme?.tooltip?.background, colors.tooltipBackground),
    textColor: resolveString(theme?.tooltip?.textColor, colors.tooltipText),
    fontFamily: resolveString(theme?.tooltip?.fontFamily, fonts.tooltipFamily),
    fontSizePx: clampToFinite(theme?.tooltip?.fontSizePx, 1, 96, fonts.tooltipSizePx),
    borderRadiusPx: clampToFinite(theme?.tooltip?.borderRadiusPx, 0, 999, 8),
    paddingX: clampToFinite(theme?.tooltip?.paddingX, 0, 48, 8),
    paddingY: clampToFinite(theme?.tooltip?.paddingY, 0, 48, 6),
    boxShadow: resolveString(theme?.tooltip?.boxShadow, defaults.tooltipShadow)
  };

  return { colors, fonts, axis, grid, tooltip };
}

export function resolveChartToolbar(toolbar?: ChartToolbarOptions): ResolvedChartToolbar {
  const show = toolbar?.show ?? false;
  const position = resolveToolbarPosition(toolbar?.position);
  const fullscreen = toolbar?.fullscreen ?? true;
  const exportEnabled = toolbar?.export ?? true;
  const exportFormats = resolveToolbarExportFormats(toolbar?.exportFormats);
  const exportFilename = resolveString(toolbar?.exportFilename, "vertexa-chart");
  const exportPixelRatio = clampToFinite(toolbar?.exportPixelRatio, 0.25, 8, 2);
  return {
    show,
    position,
    fullscreen,
    export: exportEnabled,
    exportFormats,
    exportFilename,
    exportPixelRatio
  };
}

export function resolveToolbarPosition(value: ChartToolbarPosition | undefined): ChartToolbarPosition {
  if (value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right") {
    return value;
  }
  return "top-right";
}

export function resolveToolbarExportFormats(
  values: ChartToolbarExportFormat[] | undefined
): ChartToolbarExportFormat[] {
  if (!Array.isArray(values) || values.length === 0) {
    return DEFAULT_TOOLBAR_EXPORT_FORMATS.slice();
  }
  const deduped: ChartToolbarExportFormat[] = [];
  for (const value of values) {
    if (!isToolbarExportFormat(value)) continue;
    if (deduped.includes(value)) continue;
    deduped.push(value);
  }
  return deduped.length > 0 ? deduped : DEFAULT_TOOLBAR_EXPORT_FORMATS.slice();
}

export function isToolbarExportFormat(value: unknown): value is ChartToolbarExportFormat {
  return value === "png" || value === "svg" || value === "csv";
}

export function sanitizeFilenamePart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "vertexa-chart";
  const safe = trimmed.replaceAll(/[^a-zA-Z0-9._-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "vertexa-chart";
}

export function resolvePalette(values: string[] | undefined, fallback: string[] = DEFAULT_PALETTE) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback.slice();
  }
  const palette = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return palette.length > 0 ? palette : fallback.slice();
}

export function resolveString(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function resolveOptionalString(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

export function clampToFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeMaxPoints(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  if (floored < 1) return undefined;
  return floored;
}

export function toMutableDatumArray(values: ArrayLike<Datum>): Datum[] {
  return Array.isArray(values) ? values : Array.from(values);
}

export function normalizeExportPixelRatio(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value < 0.25) return 0.25;
  if (value > 8) return 8;
  return value;
}

export function serializeSvgMarkup(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  return new XMLSerializer().serializeToString(clone);
}

export function serializeSvgToDataUrl(svg: SVGSVGElement, width: number, height: number): string {
  const markup = serializeSvgMarkup(svg, width, height);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Chart.exportPng(): failed to rasterize SVG layer."));
    image.src = url;
  });
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Chart.exportPng(): canvas.toBlob() is not available."));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Chart.exportPng(): failed to encode PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  if (typeof canvas.toDataURL !== "function") {
    throw new Error("Chart.exportSvg(): canvas.toDataURL() is not available.");
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("Chart.exportSvg(): failed to encode embedded plot image.");
  }
}

export function toNumber(d: Datum | number | Date, type: AxisType): number {
  if (type === "time") return d instanceof Date ? d.getTime() : Number(d);
  return d instanceof Date ? d.getTime() : Number(d);
}

export function toAxisDatum(d: Datum | number | Date, type: AxisType): number | Date {
  if (type === "time") {
    const n = d instanceof Date ? d.getTime() : Number(d);
    return new Date(n);
  }
  return d instanceof Date ? d.getTime() : Number(d);
}

export function fromAxisNumber(value: number, type: AxisType): Datum {
  if (type === "time") return new Date(value);
  return value;
}

export function fromNormalizedDomain(n: number, domain: DomainNum, type: AxisType): number {
  const [d0, d1] = domain;
  if (type === "log") {
    const l0 = Math.log10(d0);
    const l1 = Math.log10(d1);
    return 10 ** (l0 + (l1 - l0) * n);
  }
  return d0 + (d1 - d0) * n;
}

export function axisSpan(domain: DomainNum, type: AxisType): number {
  if (type === "log") {
    return Math.log10(domain[1]) - Math.log10(domain[0]);
  }
  return domain[1] - domain[0];
}

export function lockAxisSpan(domain: DomainNum, targetSpan: number, type: AxisType): DomainNum {
  if (type === "log") {
    const ly0 = Math.log10(domain[0]);
    const ly1 = Math.log10(domain[1]);
    const center = (ly0 + ly1) * 0.5;
    const half = targetSpan * 0.5;
    return [10 ** (center - half), 10 ** (center + half)];
  }
  const center = (domain[0] + domain[1]) * 0.5;
  const half = targetSpan * 0.5;
  return [center - half, center + half];
}

export function coerceMargin(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export function stripAxisBounds(axis: Axis | undefined): Axis | undefined {
  if (!axis) return undefined;
  const next: Axis = { ...axis };
  delete next.domain;
  delete next.range;
  delete next.min;
  delete next.max;
  next.autorange = true;
  return next;
}

export function fmtDatum(d: Datum): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

export function fmtNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return String(value);
}

export function toCsvRow(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

export function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}

export function isTextEntryElement(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  const htmlNode = node as HTMLElement;
  return Boolean(htmlNode.isContentEditable);
}

export function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function parseColor(s?: string): [number, number, number] | null {
  if (!s) return null;
  const str = s.trim().toLowerCase();

  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r / 255, g / 255, b / 255];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r / 255, g / 255, b / 255];
    }
    return null;
  }

  const m = str.match(/^rgba?\((.+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      if ([r, g, b].every(Number.isFinite)) return [r / 255, g / 255, b / 255];
    }
  }

  return null;
}

export function cssColorToRgba(color: string, alpha: number): [number, number, number, number] {
  const c = parseColor(color) ?? [0.12, 0.55, 0.95];
  return [c[0], c[1], c[2], alpha];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function lowerBoundIdx(order: Uint32Array, values: Float64Array, x: number) {
  let lo = 0, hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = values[order[mid]];
    if (v < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sortedOrder(values: Float64Array): Uint32Array {
  const n = values.length;
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  arr.sort((a, b) => values[a] - values[b]);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[i];
  return out;
}

// ----------------------------
// Category axis helpers
// ----------------------------

/**
 * Build a stable, ordered list of unique category strings from trace data.
 * If `explicit` is provided and non-empty, it is returned as-is.
 * Otherwise, categories are collected in first-seen order across visible traces.
 */
export function buildCategoryOrder(
  traces: ReadonlyArray<{ x?: ArrayLike<unknown>; y?: ArrayLike<unknown>; visible?: Visible }>,
  which: "x" | "y",
  explicit?: string[]
): string[] {
  if (explicit && explicit.length > 0) return explicit.slice();
  const seen = new Set<string>();
  const order: string[] = [];
  for (const t of traces) {
    if (t.visible === false) continue;
    const arr = which === "x" ? t.x : t.y;
    if (!arr) continue; // optional x/y (e.g. HistogramTrace)
    for (let i = 0; i < arr.length; i++) {
      const v = String(arr[i]);
      if (!seen.has(v)) { seen.add(v); order.push(v); }
    }
  }
  return order;
}

/** Build a string→integer-index map from an ordered category list. */
export function makeCategoryMap(categories: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < categories.length; i++) m.set(categories[i], i);
  return m;
}

export function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}
