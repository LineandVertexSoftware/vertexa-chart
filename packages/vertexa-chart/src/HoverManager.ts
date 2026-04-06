import {
  type OverlayD3,
  type HoverEvent,
  type PlotSelectEvent
} from "@lineandvertexsoftware/overlay-d3";
import { WebGPURenderer } from "@lineandvertexsoftware/renderer-webgpu";
import type {
  ChartOptions,
  ChartClickEvent,
  ChartHoverEvent,
  ChartPoint,
  ChartSelectionEvent,
  ChartTooltipContext,
  Datum,
  Trace,
  TraceYAxisBinding
} from "./types.js";
import {
  type Padding,
  type Zoom,
  type ResolvedChartTheme,
  toNumber,
  fmtDatum,
  fmtNumber,
  escapeHtml,
  cssColorToRgba,
  pointInPolygon
} from "./chart-utils.js";
import { getTraceColor, getTraceHoverSizePx } from "./scene.js";
import type { PickResult } from "./PickingEngine.js";
import type { PickingEngine } from "./PickingEngine.js";
import type { AxisManager } from "./AxisManager.js";
import type { SceneCompiler } from "./SceneCompiler.js";

export type HoverManagerState = {
  destroyed: boolean;
  hoverThrottleMs: number;
  pickingMode: "cpu" | "gpu" | "both";
  width: number;
  height: number;
  dpr: number;
  padding: Padding;
  zoom: Zoom;
  traces: Trace[];
  theme: ResolvedChartTheme;
};

export type HoverManagerHooks = {
  onHover?: ChartOptions["onHover"];
  onClick?: ChartOptions["onClick"];
  onSelect?: ChartOptions["onSelect"];
  tooltipFormatter?: NonNullable<ChartOptions["tooltip"]>["formatter"];
  tooltipRenderer?: NonNullable<ChartOptions["tooltip"]>["renderer"];
};

export class HoverManager {
  private lastHoverTs = 0;

  constructor(
    private pickingEngine: PickingEngine,
    private renderer: WebGPURenderer,
    private getOverlay: () => OverlayD3 | undefined,
    private tooltip: HTMLDivElement,
    private getState: () => HoverManagerState,
    private hooks: HoverManagerHooks,
    private axisManager: AxisManager,
    private sceneCompiler: SceneCompiler,
    private doRequestRender: () => void
  ) {}

  onHover(e: HoverEvent) {
    const { destroyed, hoverThrottleMs } = this.getState();
    if (destroyed) return;

    const now = performance.now();
    if (now - this.lastHoverTs < hoverThrottleMs) return;
    this.lastHoverTs = now;

    const hovermode = this.axisManager.getHoverMode();
    const overlay = this.getOverlay();

    if (!e.inside) {
      overlay?.setHoverGuides(null);
      this.renderer.setHoverHighlight(null);
      this.hideTooltip();
      this.doRequestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    if (hovermode === "none") {
      overlay?.setHoverGuides({ mode: "none", xPlot: e.xPlot, yPlot: e.yPlot, inside: true });
      this.renderer.setHoverHighlight(null);
      this.showCursorTooltip(e);
      this.doRequestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    // Choose pick mode
    const xNum = toNumber(e.xData, this.axisManager.resolveAxisType("x"));
    const yNum = toNumber(e.yData, this.axisManager.resolveAxisType("y"));

    let hit: PickResult | null = null;

    if (hovermode === "x") {
      hit = this.pickingEngine.pickSnapX(xNum, e.xSvg);
    } else if (hovermode === "y") {
      hit = this.pickingEngine.pickSnapY(yNum, e.ySvg);
    } else {
      // closest (CPU grid first)
      hit = this.pickingEngine.cpuPickClosest(e.xSvg, e.ySvg);
    }

    // Snap guides to picked point if present, else cursor
    if (hit) {
      const { xPlot, yPlot } = this.pickingEngine.screenToPlot(hit.screenX, hit.screenY);
      overlay?.setHoverGuides({ mode: hovermode, xPlot, yPlot, inside: true });
    } else {
      overlay?.setHoverGuides({ mode: hovermode, xPlot: e.xPlot, yPlot: e.yPlot, inside: true });
    }

    // GPU override for closest mode (more accurate)
    const { pickingMode } = this.getState();
    if ((hovermode === "closest") && (pickingMode === "gpu" || pickingMode === "both")) {
      this.gpuPickOverride(e, hit).catch(() => {
        // ignore pick errors
      });
    }

    if (!hit) {
      this.renderer.setHoverHighlight(null);
      this.hideTooltip();
      this.doRequestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    this.applyHover(hit);
    this.emitHoverHook(e, hovermode, hit);
  }

  private async gpuPickOverride(e: HoverEvent, cpuHit: PickResult | null) {
    const { destroyed, width, height, dpr, padding, zoom } = this.getState();
    if (destroyed) return;

    const { pickX, pickY } = this.normalizePickCss(e.xSvg, e.ySvg);

    const id = await this.renderer.pick(
      { width, height, dpr, padding, zoom },
      pickX, pickY
    );

    if (this.getState().destroyed) return;

    const gpuHit = this.pickingEngine.idToHit(id);
    if (!gpuHit) {
      // keep CPU hit if present
      return;
    }

    // If CPU and GPU disagree, prefer GPU
    if (!cpuHit || cpuHit.traceIndex !== gpuHit.traceIndex || cpuHit.pointIndex !== gpuHit.pointIndex) {
      this.applyHover(gpuHit);
      this.emitHoverHook(e, "closest", gpuHit);
    }
  }

  async handleClick(e: HoverEvent) {
    const { destroyed, width, height, dpr, padding, zoom, pickingMode } = this.getState();
    if (destroyed) return;
    if (!this.hooks.onClick) return;

    if (!e.inside) {
      this.emitClickHook(e, null);
      return;
    }

    const hovermode = this.axisManager.getHoverMode();
    if (hovermode === "none") {
      this.emitClickHook(e, null);
      return;
    }
    const xNum = toNumber(e.xData, this.axisManager.resolveAxisType("x"));
    const yNum = toNumber(e.yData, this.axisManager.resolveAxisType("y"));

    let hit: PickResult | null = null;
    if (hovermode === "x") {
      hit = this.pickingEngine.pickSnapX(xNum, e.xSvg);
    } else if (hovermode === "y") {
      hit = this.pickingEngine.pickSnapY(yNum, e.ySvg);
    } else {
      hit = this.pickingEngine.cpuPickClosest(e.xSvg, e.ySvg);

      if (pickingMode === "gpu" || pickingMode === "both") {
        try {
          const { pickX, pickY } = this.normalizePickCss(e.xSvg, e.ySvg);
          const id = await this.renderer.pick(
            { width, height, dpr, padding, zoom },
            pickX,
            pickY
          );
          if (this.getState().destroyed) return;
          hit = this.pickingEngine.idToHit(id) ?? hit;
        } catch {
          // Keep CPU result on pick failures.
        }
      }
    }

    this.emitClickHook(e, hit);
  }

  handleSelection(e: PlotSelectEvent) {
    if (!this.hooks.onSelect) return;

    const x0 = Math.min(e.x0Svg, e.x1Svg);
    const x1 = Math.max(e.x0Svg, e.x1Svg);
    const y0 = Math.min(e.y0Svg, e.y1Svg);
    const y1 = Math.max(e.y0Svg, e.y1Svg);
    const mode = e.mode ?? "box";
    const isLasso = mode === "lasso" && ("lassoSvg" in e);
    const lassoPoly = isLasso ? e.lassoSvg : undefined;

    const points: ChartSelectionEvent["points"] = [];
    let totalPoints = 0;

    for (const layer of this.sceneCompiler.markerNormLayers) {
      const traceIndex = layer.traceIndex;
      const coords = layer.points01;
      const count = Math.floor(coords.length / 2);
      const pointIndices: number[] = [];

      for (let i = 0; i < count; i++) {
        const xn = coords[i * 2 + 0];
        const yn = coords[i * 2 + 1];
        if (!Number.isFinite(xn) || !Number.isFinite(yn)) continue;

        const { screenX, screenY } = this.pickingEngine.toScreenFromNorm(xn, yn);
        const insideBox = screenX >= x0 && screenX <= x1 && screenY >= y0 && screenY <= y1;
        const selected = mode === "lasso"
          ? (insideBox && lassoPoly ? pointInPolygon(screenX, screenY, lassoPoly) : false)
          : insideBox;
        if (selected) {
          pointIndices.push(i);
        }
      }

      if (pointIndices.length > 0) {
        points.push({ traceIndex, pointIndices });
        totalPoints += pointIndices.length;
      }
    }

    this.hooks.onSelect({
      mode,
      box: {
        x0: e.x0Svg,
        y0: e.y0Svg,
        x1: e.x1Svg,
        y1: e.y1Svg,
        x0Data: e.x0Data,
        y0Data: e.y0Data,
        x1Data: e.x1Data,
        y1Data: e.y1Data
      },
      lasso: isLasso
        ? {
            svg: e.lassoSvg,
            plot: e.lassoPlot,
            data: e.lassoData as Array<{ x: Datum; y: Datum }>
          }
        : undefined,
      points,
      totalPoints
    } satisfies ChartSelectionEvent);
  }

  private applyHover(hit: PickResult) {
    const { traces, theme } = this.getState();
    const trace = traces[hit.traceIndex];
    if (!trace) return;

    this.showTooltip(this.makeTooltipContext(trace, hit));

    const norm = this.pickingEngine.getNormPoint(hit.traceIndex, hit.pointIndex);
    if (norm) {
      const baseColor = getTraceColor(trace, hit.traceIndex, theme.colors.palette);
      const inner = cssColorToRgba(baseColor, 0.95);
      const outline: [number, number, number, number] = [0, 0, 0, 0.55];

      this.renderer.setHoverHighlight({
        point01: [norm.xn, norm.yn],
        sizePx: getTraceHoverSizePx(trace, hit.traceIndex, this.sceneCompiler.heatmapHoverSizeByTrace),
        innerRgba: inner,
        outlineRgba: outline
      });
    }

    this.doRequestRender();
  }

  private normalizeHoverToCss(x: number, y: number) {
    // HoverEvent.xSvg/ySvg are always CSS pixels (SVG coordinate space).
    // No DPR conversion needed; the overlay contract guarantees this.
    return { xCss: x, yCss: y };
  }

  private normalizePickCss(x: number, y: number) {
    const { width, height } = this.getState();
    const { xCss, yCss } = this.normalizeHoverToCss(x, y);
    const maxX = Math.max(0, width - Number.EPSILON);
    const maxY = Math.max(0, height - Number.EPSILON);
    return {
      pickX: Math.min(maxX, Math.max(0, xCss)),
      pickY: Math.min(maxY, Math.max(0, yCss))
    };
  }

  private toChartPoint(hit: PickResult | null): ChartPoint | null {
    if (!hit) return null;
    const yAxis: TraceYAxisBinding = this.sceneCompiler.traceYAxisBinding.get(hit.traceIndex) ?? "y";
    return {
      traceIndex: hit.traceIndex,
      pointIndex: hit.pointIndex,
      x: hit.x,
      y: hit.y,
      screenX: hit.screenX,
      screenY: hit.screenY,
      yAxis
    };
  }

  private emitHoverHook(e: HoverEvent, mode: ChartHoverEvent["mode"], hit: PickResult | null) {
    if (!this.hooks.onHover) return;
    this.hooks.onHover({
      mode,
      inside: e.inside,
      cursor: {
        screenX: e.xSvg,
        screenY: e.ySvg,
        xData: e.xData,
        yData: e.yData
      },
      point: this.toChartPoint(hit)
    });
  }

  private emitClickHook(e: HoverEvent, hit: PickResult | null) {
    if (!this.hooks.onClick) return;
    this.hooks.onClick({
      inside: e.inside,
      cursor: {
        screenX: e.xSvg,
        screenY: e.ySvg,
        xData: e.xData,
        yData: e.yData
      },
      point: this.toChartPoint(hit)
    } satisfies ChartClickEvent);
  }

  private formatHover(trace: Trace, hit: PickResult) {
    const zValue =
      trace.type === "heatmap"
        ? this.sceneCompiler.heatmapValueByTrace.get(hit.traceIndex)?.[hit.pointIndex]
        : undefined;
    const tpl = trace.hovertemplate;
    if (!tpl) {
      if (trace.type === "heatmap") {
        return `${trace.name ?? "Trace"}  i=${hit.pointIndex}  x=${fmtDatum(hit.x)}  y=${fmtDatum(hit.y)}  z=${fmtNumber(zValue)}`;
      }
      return `${trace.name ?? "Trace"}  i=${hit.pointIndex}  x=${fmtDatum(hit.x)}  y=${fmtDatum(hit.y)}`;
    }

    return tpl
      .replaceAll("%{x}", escapeHtml(fmtDatum(hit.x)))
      .replaceAll("%{y}", escapeHtml(fmtDatum(hit.y)))
      .replaceAll("%{z}", escapeHtml(fmtNumber(zValue)))
      .replaceAll("%{pointIndex}", escapeHtml(String(hit.pointIndex)))
      .replaceAll("%{trace.name}", escapeHtml(String(trace.name ?? "")));
  }

  private makeTooltipContext(trace: Trace, hit: PickResult): ChartTooltipContext {
    const z =
      trace.type === "heatmap"
        ? this.sceneCompiler.heatmapValueByTrace.get(hit.traceIndex)?.[hit.pointIndex]
        : undefined;
    return {
      traceIndex: hit.traceIndex,
      pointIndex: hit.pointIndex,
      trace,
      x: hit.x,
      y: hit.y,
      z,
      screenX: hit.screenX,
      screenY: hit.screenY,
      defaultLabel: this.formatHover(trace, hit)
    };
  }

  showTooltip(context: ChartTooltipContext) {
    if (this.hooks.tooltipRenderer) {
      const rendered = this.hooks.tooltipRenderer(context);
      if (rendered === null) {
        this.hideTooltip();
        return;
      }
      const hasDomNode = typeof Node !== "undefined";
      if (hasDomNode && rendered instanceof Node) {
        this.tooltip.replaceChildren(rendered);
      } else {
        // String renderer output is a trusted-HTML escape hatch.
        this.tooltip.innerHTML = String(rendered);
      }
    } else if (this.hooks.tooltipFormatter) {
      this.tooltip.textContent = String(this.hooks.tooltipFormatter(context));
    } else {
      this.tooltip.textContent = context.defaultLabel;
    }

    this.tooltip.setAttribute("aria-hidden", "false");
    this.tooltip.style.transform = `translate(${context.screenX + 12}px, ${context.screenY + 12}px)`;
  }

  showCursorTooltip(e: HoverEvent) {
    const x = fmtDatum(e.xData as Datum);
    const y = fmtDatum(e.yData as Datum);
    this.tooltip.textContent = `x=${x}  y=${y}`;
    this.tooltip.setAttribute("aria-hidden", "false");
    this.tooltip.style.transform = `translate(${e.xSvg + 12}px, ${e.ySvg + 12}px)`;
  }

  hideTooltip() {
    this.tooltip.setAttribute("aria-hidden", "true");
    this.tooltip.style.transform = "translate(-9999px,-9999px)";
  }

}
