import {
  OverlayD3,
  type LegendItem
} from "@lineandvertexsoftware/overlay-d3";
import { WebGPURenderer } from "@lineandvertexsoftware/renderer-webgpu";
import type {
  Axis,
  ChartAppendPointsOptions,
  ChartExportCsvPointsOptions,
  ChartExportPngOptions,
  ChartExportSvgOptions,
  ChartAppendPointsUpdate,
  ChartLegendToggleEvent,
  ChartOptions,
  ChartPerformanceMode,
  ChartPerformanceStats,
  ChartPublicApi,
  ChartZoomEvent,
  Layout,
  Trace,
  Visible
} from "./types.js";
import {
  type ResolvedChartTheme,
  type ResolvedChartA11y,
  type ResolvedChartToolbar,
  resolveChartA11y,
  resolveChartTheme,
  resolveChartToolbar,
  normalizeMaxPoints,
  toMutableDatumArray,
  toNumber,
  fromAxisNumber,
  axisSpan,
  lockAxisSpan,
  stripAxisBounds,
  isTextEntryElement
} from "./chart-utils.js";
import {
  computeAxisDomain,
  getTraceColor
} from "./scene.js";
import { GridIndex } from "./GridIndex.js";
import type { GridBuildParams } from "./GridIndex.js";
import { Toolbar } from "./Toolbar.js";
import { mountDom } from "./DomMounter.js";
import { AxisManager } from "./AxisManager.js";
import { ExportManager } from "./ExportManager.js";
import { SceneCompiler } from "./SceneCompiler.js";
import { PickingEngine } from "./PickingEngine.js";
import { HoverManager } from "./HoverManager.js";
import { DataMutationManager, type PreparedUpdate } from "./DataMutationManager.js";

/**
 * High-performance chart component with a frozen, minimal public API.
 *
 * Public API (v1):
 * - `setTraces`
 * - `appendPoints`
 * - `exportPng`
 * - `exportSvg`
 * - `exportCsvPoints`
 * - `setLayout`
 * - `setSize`
 * - `getPerformanceStats`
 * - `destroy`
 */
export class Chart implements ChartPublicApi {
  private root: HTMLElement;
  private container!: HTMLDivElement;
  private svgGrid!: SVGSVGElement;
  private canvas!: HTMLCanvasElement;
  private svg!: SVGSVGElement;
  private tooltip!: HTMLDivElement;
  private toolbarConfig: ResolvedChartToolbar;
  private chartToolbar: Toolbar | null = null;

  private overlay!: OverlayD3;
  private renderer = new WebGPURenderer();
  private initialized = false;
  private destroyed = false;
  private initPromise: Promise<void> | null = null;

  private width: number;
  private height: number;
  private basePadding: { l: number; r: number; t: number; b: number };
  private padding: { l: number; r: number; t: number; b: number };

  private layout: Layout = {};
  private theme: ResolvedChartTheme;
  private a11y: ResolvedChartA11y;
  private traces: Trace[];
  private pickingMode: "cpu" | "gpu" | "both" = "both";
  private onHoverHook?: ChartOptions["onHover"];
  private onClickHook?: ChartOptions["onClick"];
  private onZoomHook?: ChartOptions["onZoom"];
  private onLegendToggleHook?: ChartOptions["onLegendToggle"];
  private onSelectHook?: ChartOptions["onSelect"];
  private tooltipFormatter?: NonNullable<ChartOptions["tooltip"]>["formatter"];
  private tooltipRenderer?: NonNullable<ChartOptions["tooltip"]>["renderer"];
  private handleContainerKeyDown = (event: KeyboardEvent) => this.onContainerKeyDown(event);

  private zoom = { k: 1, x: 0, y: 0 };
  private dpr = Math.max(1, window.devicePixelRatio || 1);

  private sceneCompiler = new SceneCompiler();
  private pickingEngine!: PickingEngine;
  private hoverManager!: HoverManager;
  private dataMutationManager!: DataMutationManager;

  // Tooltip / hover
  private hoverRpx = 8;
  private hoverThrottleMs = 16;
  private hoverRaf = 0;
  private aspectLockEnabled = false;
  private performanceMode: ChartPerformanceMode = "balanced";

  // ---- CPU grid index ----
  private gridIndex = new GridIndex();

  private axisManager!: AxisManager;
  private exportManager!: ExportManager;

  // Performance monitoring
  private enablePerfMonitoring = false;
  private perfStats = {
    lastGridBuildMs: 0,
    avgGridBuildMs: 0,
    gridBuildCount: 0
  };

  /**
   * Create a new chart and start async renderer initialization immediately.
   */
  constructor(target: string | HTMLElement, opts: ChartOptions) {
    this.root = typeof target === "string" ? (document.querySelector(target) as HTMLElement) : target;
    if (!this.root) throw new Error("Chart target not found.");

    this.width = opts.width;
    this.height = opts.height;
    this.layout = opts.layout ?? {};
    this.basePadding = opts.padding ?? { l: 55, r: 20, t: 20, b: 45 };
    this.exportManager = new ExportManager(
      () => ({
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        padding: this.padding,
        zoom: this.zoom,
        theme: this.theme,
        traces: this.traces
      }),
      this.renderer,
      () => ({ canvas: this.canvas, svgGrid: this.svgGrid, svg: this.svg }),
      () => this.initPromise ?? Promise.resolve()
    );
    this.axisManager = new AxisManager(() => ({
      layout: this.layout,
      traces: this.traces ?? [],
      theme: this.theme,
      zoom: this.zoom,
      xDomainNum: this.sceneCompiler.xDomainNum,
      yDomainNum: this.sceneCompiler.yDomainNum,
      width: this.width,
      height: this.height,
      padding: this.padding
    }));
    this.padding = this.axisManager.resolveLayoutPadding(this.layout, this.basePadding);
    this.a11y = resolveChartA11y(opts.a11y);
    this.theme = resolveChartTheme(opts.theme, this.a11y.highContrast);
    this.toolbarConfig = resolveChartToolbar(opts.toolbar);
    this.traces = opts.traces.map((t) => this.toRuntimeTrace(t));
    this.pickingMode = opts.pickingMode ?? "both";
    this.onHoverHook = opts.onHover;
    this.onClickHook = opts.onClick;
    this.onZoomHook = opts.onZoom;
    this.onLegendToggleHook = opts.onLegendToggle;
    this.onSelectHook = opts.onSelect;
    this.tooltipFormatter = opts.tooltip?.formatter;
    this.tooltipRenderer = opts.tooltip?.renderer;

    this.pickingEngine = new PickingEngine(
      this.sceneCompiler,
      this.gridIndex,
      () => ({
        width: this.width,
        height: this.height,
        padding: this.padding,
        zoom: this.zoom,
        hoverRpx: this.hoverRpx,
        traces: this.traces
      }),
      this.axisManager
    );
    this.setPerformanceMode("balanced");
    this.mountDom();
    this.hoverManager = new HoverManager(
      this.pickingEngine,
      this.renderer,
      () => this.overlay,
      this.tooltip,
      () => ({
        destroyed: this.destroyed,
        hoverThrottleMs: this.hoverThrottleMs,
        pickingMode: this.pickingMode,
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        padding: this.padding,
        zoom: this.zoom,
        traces: this.traces,
        theme: this.theme
      }),
      {
        onHover: this.onHoverHook,
        onClick: this.onClickHook,
        onSelect: this.onSelectHook,
        tooltipFormatter: this.tooltipFormatter,
        tooltipRenderer: this.tooltipRenderer
      },
      this.axisManager,
      this.sceneCompiler,
      () => this.requestRender()
    );
    this.dataMutationManager = new DataMutationManager(
      this.sceneCompiler,
      this.renderer,
      () => this.traces,
      this.axisManager
    );
    this.initPromise = this.init().catch((error) => {
      if (!this.destroyed) {
        console.error("[vertexa-chart] Chart initialization failed.", error);
      }
    });
  }

  private async init() {
    if (this.initialized || this.destroyed) return;

    await this.renderer.mount({ canvas: this.canvas });
    if (this.destroyed) {
      this.renderer.destroy();
      return;
    }

    // Compile once before overlay creation
    const scene = this.sceneCompiler.compile(this.traces, this.axisManager, this.theme, this.width, this.height, this.padding);
    this.renderer.setLayers(scene);
    const gridBuildResult = this.gridIndex.build(this.makeGridBuildParams());
    if (this.enablePerfMonitoring) {
      this.perfStats.lastGridBuildMs = gridBuildResult.buildMs;
      this.perfStats.gridBuildCount++;
      this.perfStats.avgGridBuildMs =
        (this.perfStats.avgGridBuildMs * (this.perfStats.gridBuildCount - 1) + gridBuildResult.buildMs) /
        this.perfStats.gridBuildCount;
    }

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");

    this.overlay = new OverlayD3({
      svg: this.svg,
      gridSvg: this.svgGrid,
      width: this.width,
      height: this.height,
      padding: this.padding,
      xAxis: this.axisManager.makeOverlayAxisSpec("x", xType, this.sceneCompiler.xDomainNum, this.sceneCompiler.xCategories ?? undefined),
      yAxis: this.axisManager.makeOverlayAxisSpec("y", yType, this.sceneCompiler.yDomainNum, this.sceneCompiler.yCategories ?? undefined),
      grid: this.axisManager.resolveOverlayGrid(),
      annotations: this.axisManager.makeOverlayAnnotations(xType, yType),
      onZoom: (z) => {
        this.zoom = z;
        this.render();
        this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
        this.onZoomHook?.(z satisfies ChartZoomEvent);
      },
      onHover: (e) => this.hoverManager.onHover(e),
      onClick: this.onClickHook ? (e) => {
        void this.hoverManager.handleClick(e).catch(() => {
          // ignore click handler errors
        });
      } : undefined,
      onBoxSelect: this.onSelectHook ? (e) => this.hoverManager.handleSelection(e) : undefined,
      legend: {
        items: this.axisManager.isLegendVisible() ? this.makeLegendItems() : [],
        onToggle: (i) => this.toggleTrace(i)
      }
    });

    this.initialized = true;
    this.render();
  }

  /**
   * Replace all traces and redraw the chart.
   *
   * @param traces New full trace list.
   * @throws Error if called after `destroy()`.
   */
  setTraces(traces: Trace[]) {
    this.assertActive("setTraces");
    this.traces = traces.map((t) => this.toRuntimeTrace(t));
    if (!this.initialized) return;

    const scene = this.sceneCompiler.compile(this.traces, this.axisManager, this.theme, this.width, this.height, this.padding);
    this.renderer.setLayers(scene);

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");
    this.overlay.setAxes(
      this.axisManager.makeOverlayAxisSpec("x", xType, this.sceneCompiler.xDomainNum, this.sceneCompiler.xCategories ?? undefined),
      this.axisManager.makeOverlayAxisSpec("y", yType, this.sceneCompiler.yDomainNum, this.sceneCompiler.yCategories ?? undefined)
    );
    this.overlay.setGrid(this.axisManager.resolveOverlayGrid());
    this.overlay.setAnnotations(this.axisManager.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.axisManager.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
    this.render();
  }

  /**
   * Incrementally append points to one or more traces and redraw.
   *
   * Use `maxPoints` for sliding-window behavior.
   *
   * @throws Error if called after `destroy()`.
   * @throws RangeError if a target `traceIndex` does not exist.
   */
  appendPoints(
    updates: ChartAppendPointsUpdate | ChartAppendPointsUpdate[],
    options?: ChartAppendPointsOptions
  ) {
    this.assertActive("appendPoints");
    const updateList = Array.isArray(updates) ? updates : [updates];
    if (updateList.length === 0) return;

    const defaultMaxPoints = normalizeMaxPoints(options?.maxPoints);

    // Pre-compute new data and trim counts in a single pass so tryAppendFast has all context
    const prepared: PreparedUpdate[] = [];

    for (const update of updateList) {
      const trace = this.traces[update.traceIndex];
      if (!trace) {
        throw new RangeError(`Chart.appendPoints(): traceIndex ${update.traceIndex} is out of range.`);
      }
      if (trace.type === "heatmap") {
        throw new Error(`Chart.appendPoints(): traceIndex ${update.traceIndex} is a heatmap trace; use setTraces().`);
      }
      if (trace.type === "histogram") {
        throw new Error(`Chart.appendPoints(): traceIndex ${update.traceIndex} is a histogram trace; use setTraces() to update binned data.`);
      }

      const xNew = Array.from(update.x);
      const yNew = Array.from(update.y);
      const nNew = Math.min(xNew.length, yNew.length);

      const maxPoints = normalizeMaxPoints(update.maxPoints) ?? defaultMaxPoints;
      const currentLen = Math.min(trace.x.length, trace.y.length);
      const trimCount = maxPoints !== undefined ? Math.max(0, currentLen + nNew - maxPoints) : 0;

      prepared.push({ update, xNew, yNew, nNew, trimCount });
    }

    // Mutate traces
    for (const { update, xNew, yNew, nNew, trimCount } of prepared) {
      if (nNew <= 0) continue;
      const trace = this.traces[update.traceIndex];
      // histogram throws in the validation loop above; x/y are always present here
      if (!trace.x || !trace.y) continue;
      const xOut = toMutableDatumArray(trace.x);
      const yOut = toMutableDatumArray(trace.y);
      for (let i = 0; i < nNew; i++) {
        xOut.push(xNew[i]);
        yOut.push(yNew[i]);
      }
      if (trimCount > 0) {
        xOut.splice(0, trimCount);
        yOut.splice(0, trimCount);
      }
      trace.x = xOut;
      trace.y = yOut;
    }

    if (!this.initialized) return;

    const usedFastPath = this.dataMutationManager.tryAppendFast(prepared);
    if (!usedFastPath) {
      const scene = this.sceneCompiler.compile(this.traces, this.axisManager, this.theme, this.width, this.height, this.padding);
      this.renderer.setLayers(scene);
    }

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");
    this.overlay.setAxes(
      this.axisManager.makeOverlayAxisSpec("x", xType, this.sceneCompiler.xDomainNum, this.sceneCompiler.xCategories ?? undefined),
      this.axisManager.makeOverlayAxisSpec("y", yType, this.sceneCompiler.yDomainNum, this.sceneCompiler.yCategories ?? undefined)
    );
    this.overlay.setGrid(this.axisManager.resolveOverlayGrid());
    this.overlay.setAnnotations(this.axisManager.makeOverlayAnnotations(xType, yType));

    this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
    this.render();
  }


  /**
   * Export the current chart view as a PNG image.
   */
  async exportPng(options: ChartExportPngOptions = {}): Promise<Blob> {
    this.assertActive("exportPng");
    return this.exportManager.exportPng(options);
  }

  /**
   * Export the current chart view as an SVG document.
   *
   * The rendered plot layer is embedded as a PNG image to preserve the WebGPU output,
   * while grid/overlay layers remain SVG.
   */
  async exportSvg(options: ChartExportSvgOptions = {}): Promise<Blob> {
    this.assertActive("exportSvg");
    return this.exportManager.exportSvg(options);
  }

  /**
   * Export chart points as CSV rows.
   */
  exportCsvPoints(options: ChartExportCsvPointsOptions = {}): Blob {
    this.assertActive("exportCsvPoints");
    return this.exportManager.exportCsvPoints(options);
  }

  /**
   * Replace the chart layout and redraw.
   *
   * @param layout New layout object.
   * @throws Error if called after `destroy()`.
   */
  setLayout(layout: Layout) {
    this.assertActive("setLayout");
    this.layout = layout;
    this.padding = this.axisManager.resolveLayoutPadding(this.layout, this.basePadding);
    this.applyAriaAttributes();
    if (!this.initialized) return;

    this.overlay.setSize(this.width, this.height, this.padding);
    const scene = this.sceneCompiler.compile(this.traces, this.axisManager, this.theme, this.width, this.height, this.padding);
    this.renderer.setLayers(scene);

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");
    this.overlay.setAxes(
      this.axisManager.makeOverlayAxisSpec("x", xType, this.sceneCompiler.xDomainNum, this.sceneCompiler.xCategories ?? undefined),
      this.axisManager.makeOverlayAxisSpec("y", yType, this.sceneCompiler.yDomainNum, this.sceneCompiler.yCategories ?? undefined)
    );
    this.overlay.setGrid(this.axisManager.resolveOverlayGrid());
    this.overlay.setAnnotations(this.axisManager.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.axisManager.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
    this.render();
  }

  // Internal controls not part of the public API contract.
  private setLOD(enabled: boolean) {
    this.renderer.setLOD(enabled);
    this.render();
  }

  setPerformanceMode(mode: ChartPerformanceMode) {
    this.assertActive("setPerformanceMode");
    this.performanceMode = mode;
    if (mode === "quality") {
      this.hoverThrottleMs = 8;
      this.hoverRpx = 9;
      this.renderer.setLOD(false);
    } else if (mode === "max-fps") {
      this.hoverThrottleMs = 42;
      this.hoverRpx = 6;
      this.renderer.setLOD(true);
    } else {
      this.hoverThrottleMs = 16;
      this.hoverRpx = 8;
      this.renderer.setLOD(true);
    }

    if (this.initialized) this.render();
  }

  /**
   * Read runtime performance stats for rendering and picking.
   */
  getPerformanceStats(): ChartPerformanceStats {
    const rendererStats = this.renderer.getStats();
    const fpsBaseMs = rendererStats.avgRenderMs > 0 ? rendererStats.avgRenderMs : rendererStats.lastRenderMs;
    return {
      fps: fpsBaseMs > 0 ? 1000 / fpsBaseMs : 0,
      sampledPoints: rendererStats.effectiveSampledPoints,
      renderMs: {
        last: rendererStats.lastRenderMs,
        avg: rendererStats.avgRenderMs
      },
      pickMs: {
        last: rendererStats.lastPickMs,
        avg: rendererStats.avgPickMs
      },
      frameCount: rendererStats.frameCount
    };
  }

  private toggleTrace(index: number) {
    const t = this.traces[index];
    if (!t) return;

    // Toggle between true and legendonly (keeps legend visible)
    const previousVisible = (t.visible ?? true) as Visible;
    t.visible = previousVisible === true ? "legendonly" : true;
    const visible = (t.visible ?? true) as Visible;
    this.onLegendToggleHook?.({
      traceIndex: index,
      previousVisible,
      visible,
      trace: { ...t }
    } satisfies ChartLegendToggleEvent);

    const scene = this.sceneCompiler.compile(this.traces, this.axisManager, this.theme, this.width, this.height, this.padding);
    this.renderer.setLayers(scene);
    const gridBuildResult = this.gridIndex.build(this.makeGridBuildParams());
    if (this.enablePerfMonitoring) {
      this.perfStats.lastGridBuildMs = gridBuildResult.buildMs;
      this.perfStats.gridBuildCount++;
      this.perfStats.avgGridBuildMs =
        (this.perfStats.avgGridBuildMs * (this.perfStats.gridBuildCount - 1) + gridBuildResult.buildMs) /
        this.perfStats.gridBuildCount;
    }

    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");
    this.overlay.setAxes(
      this.axisManager.makeOverlayAxisSpec("x", xType, this.sceneCompiler.xDomainNum, this.sceneCompiler.xCategories ?? undefined),
      this.axisManager.makeOverlayAxisSpec("y", yType, this.sceneCompiler.yDomainNum, this.sceneCompiler.yCategories ?? undefined)
    );
    this.overlay.setGrid(this.axisManager.resolveOverlayGrid());
    this.overlay.setAnnotations(this.axisManager.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.axisManager.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
    this.render();
  }

  /**
   * Resize the chart viewport in CSS pixels and redraw.
   *
   * @param width New outer width in CSS pixels.
   * @param height New outer height in CSS pixels.
   * @throws Error if called after `destroy()`.
   */
  setSize(width: number, height: number) {
    this.assertActive("setSize");
    this.width = width;
    this.height = height;
    this.container.style.width = `${width}px`;
    this.container.style.height = `${height}px`;

    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.svgGrid.setAttribute("width", String(width));
    this.svgGrid.setAttribute("height", String(height));
    this.svgGrid.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svgGrid.setAttribute("preserveAspectRatio", "none");
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("preserveAspectRatio", "none");

    if (!this.initialized) return;

    this.overlay.setSize(width, height, this.padding);
    this.render();

    this.gridIndex.scheduleRebuild(() => this.makeGridBuildParams(), () => this.destroyed);
    if (this.aspectLockEnabled) {
      this.setAspectLock(true);
    }
  }

  panBy(dxCss: number, dyCss: number) {
    this.assertActive("panBy");
    if (!this.initialized) return;
    this.overlay.panBy(dxCss, dyCss);
  }

  zoomBy(factor: number, centerPlot?: { x: number; y: number }) {
    this.assertActive("zoomBy");
    if (!this.initialized) return;
    this.overlay.zoomBy(factor, centerPlot);
  }

  resetView() {
    this.assertActive("resetView");
    if (!this.initialized) return;
    this.overlay.resetZoom();
  }

  fitToData() {
    this.assertActive("fitToData");

    const xAxis = this.axisManager.getAxis("x");
    const yAxis = this.axisManager.getAxis("y");
    const nextX = stripAxisBounds(xAxis);
    const nextY = stripAxisBounds(yAxis);

    const layoutWithDataBounds = this.axisManager.setAxisInLayout(this.axisManager.setAxisInLayout(this.layout, "x", nextX), "y", nextY);
    this.setLayout(layoutWithDataBounds);
    this.resetView();
  }

  autoscaleY() {
    this.assertActive("autoscaleY");

    const yAxis = this.axisManager.getAxis("y");
    const yType = this.axisManager.resolveAxisType("y");
    const xType = this.axisManager.resolveAxisType("x");
    const [visibleX0, visibleX1] = this.axisManager.getVisibleAxisRangeNum("x");
    const [xMin, xMax] = visibleX0 <= visibleX1 ? [visibleX0, visibleX1] : [visibleX1, visibleX0];

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const trace of this.traces) {
      const vis = trace.visible ?? true;
      if (vis !== true) continue;

      if (trace.type === "heatmap") {
        const xs = Array.from(trace.x);
        const hasVisibleX = xs.some((xDatum) => {
          const x = toNumber(xDatum, xType);
          return Number.isFinite(x) && x >= xMin && x <= xMax;
        });
        if (!hasVisibleX) continue;
        for (const yDatum of Array.from(trace.y)) {
          const y = toNumber(yDatum, yType);
          if (!Number.isFinite(y) || (yType === "log" && y <= 0)) continue;
          if (y < min) min = y;
          if (y > max) max = y;
        }
        continue;
      }

      // Histogram bin values are computed by SceneCompiler; skip raw data scan.
      if (trace.type === "histogram") continue;

      const n = Math.min(trace.x.length, trace.y.length);
      for (let i = 0; i < n; i++) {
        const x = toNumber(trace.x[i], xType);
        if (!Number.isFinite(x) || x < xMin || x > xMax) continue;
        const y = toNumber(trace.y[i], yType);
        if (!Number.isFinite(y) || (yType === "log" && y <= 0)) continue;
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const domain = computeAxisDomain(this.traces, "y", yAxis, yType);
      min = domain[0];
      max = domain[1];
    }

    if (min === max) {
      min -= 0.5;
      max += 0.5;
    } else {
      const pad = (max - min) * 0.02;
      min -= pad;
      max += pad;
    }

    const nextAxis: Axis = {
      ...(yAxis ?? {}),
      autorange: false,
      domain: [fromAxisNumber(min, yType), fromAxisNumber(max, yType)]
    };
    delete nextAxis.range;
    const nextLayout = this.axisManager.setAxisInLayout(this.layout, "y", nextAxis);
    this.setLayout(nextLayout);
  }

  setAspectLock(enabled: boolean) {
    this.assertActive("setAspectLock");
    this.aspectLockEnabled = enabled;
    if (!enabled) return;

    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const xType = this.axisManager.resolveAxisType("x");
    const yType = this.axisManager.resolveAxisType("y");
    const xSpan = axisSpan(this.sceneCompiler.xDomainNum, xType);
    if (!Number.isFinite(xSpan) || xSpan <= 0) return;
    const targetYSpan = xSpan * (plotH / plotW);
    if (!Number.isFinite(targetYSpan) || targetYSpan <= 0) return;

    const [y0, y1] = this.sceneCompiler.yDomainNum;
    const nextDomain = lockAxisSpan([y0, y1], targetYSpan, yType);
    const yAxis = this.axisManager.getAxis("y");
    const nextAxis: Axis = {
      ...(yAxis ?? {}),
      autorange: false,
      domain: [fromAxisNumber(nextDomain[0], yType), fromAxisNumber(nextDomain[1], yType)]
    };
    delete nextAxis.range;
    this.setLayout(this.axisManager.setAxisInLayout(this.layout, "y", nextAxis));
  }

  /**
   * Release GPU/DOM resources and make the chart unusable.
   *
   * Idempotent: calling this multiple times is safe.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.hoverRaf) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
    }

    this.gridIndex.dispose();

    this.overlay?.setHoverGuides(null);
    this.overlay?.destroy();
    this.renderer.setHoverHighlight(null);
    this.renderer.destroy();

    this.sceneCompiler.markerNormByTrace.clear();
    this.sceneCompiler.heatmapValueByTrace.clear();
    this.sceneCompiler.heatmapHoverSizeByTrace.clear();
    this.sceneCompiler.markerNormLayers = [];
    this.sceneCompiler.idRanges = [];
    this.sceneCompiler.xSorted = [];
    this.sceneCompiler.ySorted = [];
    this.sceneCompiler.traceData = [];
    this.initialized = false;
    this.container.removeEventListener("keydown", this.handleContainerKeyDown);
    this.chartToolbar?.cleanup();
    if (document.fullscreenElement === this.container) {
      void document.exitFullscreen().catch(() => {
        // ignore teardown fullscreen errors
      });
    }

    if (this.root.contains(this.container)) {
      this.root.removeChild(this.container);
    } else {
      this.root.innerHTML = "";
    }
  }

  private assertActive(
    method:
      | "setTraces"
      | "appendPoints"
      | "exportPng"
      | "exportSvg"
      | "exportCsvPoints"
      | "setLayout"
      | "setSize"
      | "panBy"
      | "zoomBy"
      | "resetView"
      | "fitToData"
      | "autoscaleY"
      | "setAspectLock"
      | "setPerformanceMode"
  ) {
    if (this.destroyed) {
      throw new Error(`Chart.${method}() called after destroy().`);
    }
  }

  private toRuntimeTrace(trace: Trace): Trace {
    if (trace.type === "histogram") {
      return {
        ...trace,
        visible: trace.visible ?? true,
        x: trace.x ? Array.from(trace.x) : undefined,
        y: trace.y ? Array.from(trace.y) : undefined
      };
    }
    return {
      ...trace,
      visible: trace.visible ?? true,
      x: Array.from(trace.x),
      y: Array.from(trace.y)
    };
  }




  private makeGridBuildParams(): GridBuildParams {
    return {
      markerNormLayers: this.sceneCompiler.markerNormLayers,
      width: this.width,
      height: this.height,
      padding: this.padding,
      zoom: this.zoom
    };
  }

  private render() {
    if (!this.initialized) return;
    if (this.destroyed) return;

    this.renderer.render({
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      padding: this.padding,
      zoom: this.zoom
    });
  }

  private requestRender() {
    if (this.destroyed) return;
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      if (this.destroyed) return;
      this.render();
    });
  }


  private makeLegendItems(): LegendItem[] {
    return this.traces.map((t, i) => {
      const name = t.name ?? `Trace ${i + 1}`;
      const color = getTraceColor(t, i, this.theme.colors.palette);
      const visible = (t.visible ?? true) === true;
      return { name, color, visible };
    });
  }

  private onContainerKeyDown(event: KeyboardEvent) {
    if (!this.a11y.keyboardNavigation) return;
    if (!this.initialized) return;
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    if (isTextEntryElement(target)) return;

    const panStep = event.shiftKey ? 120 : 40;
    const zoomStep = event.shiftKey ? 1.24 : 1.12;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        this.overlay.panBy(-panStep, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        this.overlay.panBy(panStep, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        this.overlay.panBy(0, -panStep);
        return;
      case "ArrowDown":
        event.preventDefault();
        this.overlay.panBy(0, panStep);
        return;
      case "+":
      case "=":
      case "NumpadAdd":
        event.preventDefault();
        this.overlay.zoomBy(zoomStep);
        return;
      case "-":
      case "_":
      case "NumpadSubtract":
        event.preventDefault();
        this.overlay.zoomBy(1 / zoomStep);
        return;
      case "0":
      case "Numpad0":
        event.preventDefault();
        this.overlay.resetZoom();
        return;
      case "f":
      case "F":
        event.preventDefault();
        this.fitToData();
        return;
      case "y":
      case "Y":
        event.preventDefault();
        this.autoscaleY();
        return;
      case "l":
      case "L":
        event.preventDefault();
        this.setAspectLock(!this.aspectLockEnabled);
        return;
      default:
        return;
    }
  }

  private applyAriaAttributes() {
    const label = this.a11y.label || this.layout.title || "Interactive chart";

    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-roledescription", "interactive chart");
    this.container.setAttribute("aria-label", label);
    if (this.a11y.description) {
      this.container.setAttribute("aria-description", this.a11y.description);
    } else {
      this.container.removeAttribute("aria-description");
    }

    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", `${label} plot overlay`);
  }

  // ----------------------------
  // DOM
  // ----------------------------

  private mountDom() {
    const dom = mountDom(
      this.root,
      { width: this.width, height: this.height, theme: this.theme, a11y: this.a11y, toolbarConfig: this.toolbarConfig },
      {
        exportPng: (opts) => this.exportPng(opts),
        exportSvg: (opts) => this.exportSvg(opts),
        exportCsvPoints: (opts) => this.exportCsvPoints(opts),
        setSize: (w, h) => this.setSize(w, h),
        getSize: () => ({ width: this.width, height: this.height })
      },
      this.handleContainerKeyDown
    );
    this.container = dom.container;
    this.canvas = dom.canvas;
    this.svgGrid = dom.svgGrid;
    this.svg = dom.svg;
    this.tooltip = dom.tooltip;
    this.chartToolbar = dom.chartToolbar;
    this.applyAriaAttributes();
  }
}

