import type {
  AnnotationPrimitive as OverlayAnnotationPrimitive,
  AxisSpec,
  GridStyle
} from "@lineandvertexsoftware/overlay-d3";
import type { Axis, AxisType, BarMode, HoverMode, Layout, Trace } from "./types.js";
import {
  type DomainNum,
  type Padding,
  type Zoom,
  type ResolvedChartTheme,
  coerceMargin,
  toAxisDatum,
  fromNormalizedDomain
} from "./chart-utils.js";

export type AxisManagerState = {
  layout: Layout;
  traces: Trace[];
  theme: ResolvedChartTheme;
  zoom: Zoom;
  xDomainNum: DomainNum;
  yDomainNum: DomainNum;
  width: number;
  height: number;
  padding: Padding;
};

export class AxisManager {
  constructor(private getState: () => AxisManagerState) {}

  resolveLayoutPadding(layout: Layout, base: Padding): Padding {
    const margin = layout.margin;
    if (!margin) return { ...base };
    return {
      l: coerceMargin(margin.left, base.l),
      r: coerceMargin(margin.right, base.r),
      t: coerceMargin(margin.top, base.t),
      b: coerceMargin(margin.bottom, base.b)
    };
  }

  isLegendVisible(): boolean {
    return this.getState().layout.legend?.show ?? true;
  }

  getAxis(which: "x" | "y"): Axis | undefined {
    const layout = this.getState().layout;
    if (which === "x") return layout.xaxis ?? layout.axes?.x;
    return layout.yaxis ?? layout.axes?.y;
  }

  setAxisInLayout(layout: Layout, which: "x" | "y", axis: Axis | undefined): Layout {
    const next: Layout = { ...layout };
    if (which === "x") {
      if (layout.axes?.x !== undefined || (layout.axes && layout.xaxis === undefined)) {
        next.axes = { ...(layout.axes ?? {}), x: axis };
      } else {
        next.xaxis = axis;
      }
      return next;
    }

    if (layout.axes?.y !== undefined || (layout.axes && layout.yaxis === undefined)) {
      next.axes = { ...(layout.axes ?? {}), y: axis };
    } else {
      next.yaxis = axis;
    }
    return next;
  }

  getVisibleAxisRangeNum(which: "x" | "y"): DomainNum {
    const { zoom, xDomainNum, yDomainNum, width, height, padding } = this.getState();
    const type = this.resolveAxisType(which);
    const domain = which === "x" ? xDomainNum : yDomainNum;
    const plotSize = which === "x"
      ? Math.max(1, width - padding.l - padding.r)
      : Math.max(1, height - padding.t - padding.b);
    const translate = which === "x" ? zoom.x : zoom.y;
    const k = Math.max(1e-6, zoom.k);
    const n0 = (0 - translate) / (plotSize * k);
    const n1 = (plotSize - translate) / (plotSize * k);
    return [
      fromNormalizedDomain(n0, domain, type),
      fromNormalizedDomain(n1, domain, type)
    ];
  }

  getBarMode(): BarMode {
    return this.getState().layout.barmode ?? "overlay";
  }

  getHoverMode(): HoverMode {
    const mode = this.getState().layout.hovermode;
    return mode === "x" || mode === "y" || mode === "none" || mode === "closest"
      ? mode
      : "closest";
  }

  resolveAxisType(which: "x" | "y"): AxisType {
    const { traces } = this.getState();
    const axis = this.getAxis(which);
    if (axis?.type) return axis.type;

    // Infer category axes from string-valued data.
    for (const trace of traces) {
      const arr = which === "x" ? trace.x : trace.y;
      if (!arr || arr.length === 0) continue; // optional x/y (e.g. HistogramTrace)
      const probe = Math.min(arr.length, 8);
      for (let i = 0; i < probe; i++) {
        if (typeof arr[i] === "string") return "category";
      }
    }

    // Infer time axes from Date-valued data when no explicit type is provided.
    for (const trace of traces) {
      const arr = which === "x" ? trace.x : trace.y;
      if (!arr) continue; // optional x/y (e.g. HistogramTrace)
      const n = arr.length;
      if (n === 0) continue;

      const first = arr[0];
      if (first instanceof Date) return "time";

      const last = arr[n - 1];
      if (last instanceof Date) return "time";

      const probe = Math.min(n, 8);
      for (let i = 1; i < probe; i++) {
        if (arr[i] instanceof Date) return "time";
      }
    }

    return "linear";
  }

  makeOverlayAxisSpec(which: "x" | "y", type: AxisType, domain: DomainNum, categories?: string[]): AxisSpec {
    const { theme } = this.getState();
    const axis = this.getAxis(which);

    if (type === "category" && categories && categories.length > 0) {
      return {
        type: "category",
        domain,
        title: axis?.title,
        tickValues: categories.map((_, i) => i),
        categories,
        style: {
          fontFamily: theme.axis.fontFamily,
          fontSizePx: theme.axis.fontSizePx
        }
      };
    }

    const tickValues = axis?.tickValues?.map((v) => toAxisDatum(v, type));
    return {
      type,
      domain,
      title: axis?.title,
      tickValues,
      tickFormat: axis?.tickFormat,
      precision: axis?.precision,
      timeFormat: axis?.timeFormat,
      style: {
        fontFamily: theme.axis.fontFamily,
        fontSizePx: theme.axis.fontSizePx
      }
    };
  }

  makeOverlayAnnotations(xType: AxisType, yType: AxisType): OverlayAnnotationPrimitive[] {
    const { layout } = this.getState();
    const annotations = layout.annotations;
    if (!annotations || annotations.length === 0) return [];

    const out: OverlayAnnotationPrimitive[] = [];
    for (const a of annotations) {
      if (a.type === "line") {
        out.push({
          ...a,
          x0: toAxisDatum(a.x0, xType),
          y0: toAxisDatum(a.y0, yType),
          x1: toAxisDatum(a.x1, xType),
          y1: toAxisDatum(a.y1, yType)
        });
        continue;
      }
      if (a.type === "region") {
        out.push({
          ...a,
          x0: toAxisDatum(a.x0, xType),
          y0: toAxisDatum(a.y0, yType),
          x1: toAxisDatum(a.x1, xType),
          y1: toAxisDatum(a.y1, yType)
        });
        continue;
      }
      out.push({
        ...a,
        x: toAxisDatum(a.x, xType),
        y: toAxisDatum(a.y, yType)
      });
    }
    return out;
  }

  resolveOverlayGrid(): GridStyle {
    const { layout, theme } = this.getState();
    const grid = layout.grid;
    return {
      show: grid?.show ?? theme.grid.show,
      color: grid?.color ?? theme.grid.color,
      axisColor: grid?.axisColor ?? theme.axis.color,
      textColor: grid?.textColor ?? theme.axis.textColor,
      opacity: grid?.opacity ?? theme.grid.opacity,
      strokeWidth: grid?.strokeWidth ?? theme.grid.strokeWidth
    };
  }
}
