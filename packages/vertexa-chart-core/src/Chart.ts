import {
  OverlayD3,
  type AnnotationPrimitive as OverlayAnnotationPrimitive,
  type AxisSpec,
  type GridStyle,
  type HoverEvent,
  type LegendItem,
  type PlotSelectEvent
} from "@vertexa-chart/overlay-d3";
import { WebGPURenderer } from "@vertexa-chart/renderer-webgpu";
import type {
  Axis,
  AxisType,
  ChartA11yOptions,
  ChartAppendPointsOptions,
  ChartExportCsvPointsOptions,
  ChartExportPngOptions,
  ChartExportSvgOptions,
  ChartAppendPointsUpdate,
  ChartClickEvent,
  ChartHoverEvent,
  ChartLegendToggleEvent,
  ChartOptions,
  ChartPerformanceMode,
  ChartPerformanceStats,
  ChartPoint,
  ChartPublicApi,
  ChartSelectionEvent,
  ChartTooltipContext,
  ChartZoomEvent,
  ChartTheme,
  ChartToolbarOptions,
  ChartToolbarPosition,
  ChartToolbarExportFormat,
  Datum,
  HoverMode,
  Layout,
  LineSmoothingMode,
  AreaTrace,
  BarTrace,
  HeatmapTrace,
  Trace,
  Visible
} from "./types.js";

type DomainNum = [number, number];

type PickResult = {
  traceIndex: number;
  pointIndex: number;
  x: Datum;
  y: Datum;
  screenX: number; // CSS px in chart container coords
  screenY: number; // CSS px
};

const DEFAULT_PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"];
const DEFAULT_FONT_FAMILY = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DEFAULT_BAR_WIDTH_PX = 10;
const DEFAULT_AREA_OPACITY = 0.26;
const DEFAULT_HEATMAP_OPACITY = 0.84;
const DEFAULT_HEATMAP_COLORSCALE = ["#0b3c5d", "#328cc1", "#8fd694", "#f6ae2d", "#d7263d"];
const HIGH_CONTRAST_PALETTE = ["#00e5ff", "#ffd700", "#ff3ea5", "#7dff4d", "#ff8c00", "#8ab4ff"];
const DEFAULT_TOOLBAR_EXPORT_FORMATS: ChartToolbarExportFormat[] = ["png", "svg", "csv"];

type ResolvedChartTheme = {
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

type ResolvedChartA11y = {
  label: string;
  description: string;
  keyboardNavigation: boolean;
  highContrast: boolean;
};

type ResolvedChartToolbar = {
  show: boolean;
  position: ChartToolbarPosition;
  fullscreen: boolean;
  export: boolean;
  exportFormats: ChartToolbarExportFormat[];
  exportFilename: string;
  exportPixelRatio: number;
};

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
  private toolbar: ResolvedChartToolbar;
  private toolbarEl: HTMLDivElement | null = null;
  private toolbarExportWrap: HTMLDivElement | null = null;
  private toolbarExportMenu: HTMLDivElement | null = null;
  private toolbarExportButton: HTMLButtonElement | null = null;
  private toolbarFullscreenButton: HTMLButtonElement | null = null;
  private toolbarExportOpen = false;
  private toolbarExportBusy = false;
  private toolbarPreFullscreenSize: { width: number; height: number } | null = null;

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
  private handleToolbarExportToggle = (event: MouseEvent) => this.onToolbarExportToggle(event);
  private handleToolbarExportMenuClick = (event: MouseEvent) => {
    void this.onToolbarExportMenuClick(event);
  };
  private handleToolbarFullscreenClick = () => {
    void this.onToolbarFullscreenClick();
  };
  private handleToolbarDocumentPointerDown = (event: PointerEvent) => this.onToolbarDocumentPointerDown(event);
  private handleToolbarDocumentKeyDown = (event: KeyboardEvent) => this.onToolbarDocumentKeyDown(event);
  private handleToolbarFullscreenChange = () => this.onToolbarFullscreenChange();
  private handleToolbarWindowResize = () => this.onToolbarWindowResize();

  private zoom = { k: 1, x: 0, y: 0 };
  private dpr = Math.max(1, window.devicePixelRatio || 1);

  // numeric domains (time uses ms)
  private xDomainNum: DomainNum = [0, 1];
  private yDomainNum: DomainNum = [0, 1];

  // trace data cache (raw)
  private traceData: Array<{ xs: Datum[]; ys: Datum[]; name: string } | null> = [];
  private heatmapValueByTrace = new Map<number, Float64Array>();
  private heatmapHoverSizeByTrace = new Map<number, number>();

  // cache normalized markers per trace for CPU operations
  private markerNormByTrace = new Map<number, Float32Array>();
  private markerNormLayers: { traceIndex: number; points01: Float32Array }[] = [];

  // GPU id mapping (markers only)
  private idRanges: { baseId: number; count: number; traceIndex: number }[] = [];

  // Hover sorting for hovermode x/y (only built for smaller traces)
  private xSorted: { traceIndex: number; order: Uint32Array; xsNum: Float64Array }[] = [];
  private ySorted: { traceIndex: number; order: Uint32Array; ysNum: Float64Array }[] = [];

  // Tooltip / hover
  private hoverRpx = 8;
  private hoverThrottleMs = 16;
  private lastHoverTs = 0;
  private hoverRaf = 0;
  private aspectLockEnabled = false;
  private performanceMode: ChartPerformanceMode = "balanced";

  // ---- CPU grid index (screen space, stored in "grid base space") ----
  private gridCellPx = 18;
  private gridMap = new Map<bigint, number[]>(); // cell -> global indices
  private gridX = new Float32Array(0); // base-space x
  private gridY = new Float32Array(0); // base-space y
  private gridTrace = new Uint32Array(0); // global -> trace
  private gridPoint = new Uint32Array(0); // global -> point
  private gridBuilt = false;

  private gridRebuildPending = false;
  private gridRebuildTimer: number | null = null;
  private gridLastBuildTs = 0;
  private gridMinBuildIntervalMs = 60;

  // grid transform signature - IMPROVED: now checks translation too
  private lastGridZoomK = 1;
  private lastGridZoomX = 0;
  private lastGridZoomY = 0;

  private gridMinScaleRelDelta = 0.06; // rebuild if scale changes > ~6%
  private gridMinTransRelDelta = 0.3;  // NEW: rebuild if translation > 30% of plot size

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
    this.padding = this.resolveLayoutPadding(this.layout, this.basePadding);
    this.a11y = resolveChartA11y(opts.a11y);
    this.theme = resolveChartTheme(opts.theme, this.a11y.highContrast);
    this.toolbar = resolveChartToolbar(opts.toolbar);
    this.traces = opts.traces.map((t) => this.toRuntimeTrace(t));
    this.pickingMode = opts.pickingMode ?? "both";
    this.onHoverHook = opts.onHover;
    this.onClickHook = opts.onClick;
    this.onZoomHook = opts.onZoom;
    this.onLegendToggleHook = opts.onLegendToggle;
    this.onSelectHook = opts.onSelect;
    this.tooltipFormatter = opts.tooltip?.formatter;
    this.tooltipRenderer = opts.tooltip?.renderer;

    this.setPerformanceMode("balanced");
    this.mountDom();
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
    const scene = this.compileScene();
    this.renderer.setLayers(scene);
    this.rebuildGridIndex();

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");

    this.overlay = new OverlayD3({
      svg: this.svg,
      gridSvg: this.svgGrid,
      width: this.width,
      height: this.height,
      padding: this.padding,
      xAxis: this.makeOverlayAxisSpec("x", xType, this.xDomainNum),
      yAxis: this.makeOverlayAxisSpec("y", yType, this.yDomainNum),
      grid: this.resolveOverlayGrid(),
      annotations: this.makeOverlayAnnotations(xType, yType),
      onZoom: (z) => {
        this.zoom = z;
        this.render();
        this.scheduleGridRebuild();
        this.onZoomHook?.(z satisfies ChartZoomEvent);
      },
      onHover: (e) => this.onHover(e),
      onClick: this.onClickHook ? (e) => {
        void this.handleClick(e).catch(() => {
          // ignore click handler errors
        });
      } : undefined,
      onBoxSelect: this.onSelectHook ? (e) => this.handleSelection(e) : undefined,
      legend: {
        items: this.isLegendVisible() ? this.makeLegendItems() : [],
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

    const scene = this.compileScene();
    this.renderer.setLayers(scene);

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");
    this.overlay.setAxes(
      this.makeOverlayAxisSpec("x", xType, this.xDomainNum),
      this.makeOverlayAxisSpec("y", yType, this.yDomainNum)
    );
    this.overlay.setGrid(this.resolveOverlayGrid());
    this.overlay.setAnnotations(this.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridBuilt = false;
    this.scheduleGridRebuild();
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

    for (const update of updateList) {
      const trace = this.traces[update.traceIndex];
      if (!trace) {
        throw new RangeError(`Chart.appendPoints(): traceIndex ${update.traceIndex} is out of range.`);
      }
      if (trace.type === "heatmap") {
        throw new Error(`Chart.appendPoints(): traceIndex ${update.traceIndex} is a heatmap trace; use setTraces().`);
      }

      const xIn = Array.from(update.x);
      const yIn = Array.from(update.y);
      const n = Math.min(xIn.length, yIn.length);
      if (n <= 0) continue;

      const xOut = toMutableDatumArray(trace.x);
      const yOut = toMutableDatumArray(trace.y);

      for (let i = 0; i < n; i++) {
        xOut.push(xIn[i]);
        yOut.push(yIn[i]);
      }

      const maxPoints = normalizeMaxPoints(update.maxPoints) ?? defaultMaxPoints;
      if (maxPoints !== undefined && xOut.length > maxPoints) {
        const trimCount = xOut.length - maxPoints;
        xOut.splice(0, trimCount);
        yOut.splice(0, trimCount);
      }

      trace.x = xOut;
      trace.y = yOut;
    }

    if (!this.initialized) return;

    const scene = this.compileScene();
    this.renderer.setLayers(scene);

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");
    this.overlay.setAxes(
      this.makeOverlayAxisSpec("x", xType, this.xDomainNum),
      this.makeOverlayAxisSpec("y", yType, this.yDomainNum)
    );
    this.overlay.setGrid(this.resolveOverlayGrid());
    this.overlay.setAnnotations(this.makeOverlayAnnotations(xType, yType));

    this.gridBuilt = false;
    this.scheduleGridRebuild();
    this.render();
  }

  /**
   * Export the current chart view as a PNG image.
   */
  async exportPng(options: ChartExportPngOptions = {}): Promise<Blob> {
    this.assertActive("exportPng");
    if (this.initPromise) {
      await this.initPromise;
    }

    const pixelRatio = normalizeExportPixelRatio(options.pixelRatio);
    const exportWidth = Math.max(1, Math.round(this.width * pixelRatio));
    const exportHeight = Math.max(1, Math.round(this.height * pixelRatio));

    const exportCanvas = this.createExportCanvas(exportWidth, exportHeight);
    const ctx = this.getExport2dContext(exportCanvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const background = resolveString(options.background, this.theme.colors.background);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, exportWidth, exportHeight);

    // Base WebGPU render layer. Some browsers do not reliably support drawing
    // a WebGPU canvas directly into a 2D canvas context.
    await this.drawCanvasLayerToContext(ctx, exportWidth, exportHeight, pixelRatio);

    if (options.includeGrid ?? true) {
      await this.drawSvgLayerToContext(ctx, this.svgGrid, exportWidth, exportHeight);
    }
    if (options.includeOverlay ?? true) {
      await this.drawSvgLayerToContext(ctx, this.svg, exportWidth, exportHeight);
    }

    return canvasToPngBlob(exportCanvas);
  }

  /**
   * Export the current chart view as an SVG document.
   *
   * The rendered plot layer is embedded as a PNG image to preserve the WebGPU output,
   * while grid/overlay layers remain SVG.
   */
  async exportSvg(options: ChartExportSvgOptions = {}): Promise<Blob> {
    this.assertActive("exportSvg");
    if (this.initPromise) {
      await this.initPromise;
    }

    const pixelRatio = normalizeExportPixelRatio(options.pixelRatio);
    const background = resolveString(options.background, this.theme.colors.background);
    const includePlot = options.includePlot ?? true;
    const includeGrid = options.includeGrid ?? true;
    const includeOverlay = options.includeOverlay ?? true;

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" preserveAspectRatio="none">`,
      `<rect x="0" y="0" width="${this.width}" height="${this.height}" fill="${escapeXmlAttribute(background)}"/>`
    ];

    if (includePlot) {
      const imageHref = await this.captureCanvasLayerDataUrl(pixelRatio);
      const escaped = escapeXmlAttribute(imageHref);
      parts.push(
        `<image x="0" y="0" width="${this.width}" height="${this.height}" preserveAspectRatio="none" href="${escaped}" xlink:href="${escaped}"/>`
      );
    }
    if (includeGrid) {
      parts.push(this.serializeSvgLayerForExport(this.svgGrid));
    }
    if (includeOverlay) {
      parts.push(this.serializeSvgLayerForExport(this.svg));
    }

    parts.push("</svg>");
    return new Blob([parts.join("")], { type: "image/svg+xml;charset=utf-8" });
  }

  /**
   * Export chart points as CSV rows.
   */
  exportCsvPoints(options: ChartExportCsvPointsOptions = {}): Blob {
    this.assertActive("exportCsvPoints");
    const includeHeader = options.includeHeader ?? true;
    const includeHidden = options.includeHidden ?? false;

    const rows: string[] = [];
    if (includeHeader) {
      rows.push("traceIndex,traceName,traceType,pointIndex,x,y,z");
    }

    for (let traceIndex = 0; traceIndex < this.traces.length; traceIndex++) {
      const trace = this.traces[traceIndex];
      if (!trace) continue;
      if (!includeHidden && (trace.visible ?? true) !== true) continue;

      const traceName = trace.name ?? "";

      if (trace.type === "heatmap") {
        const xVals = Array.from(trace.x);
        const yVals = Array.from(trace.y);
        const zRows = Array.from(trace.z, (row) => Array.from(row));
        let pointIndex = 0;

        for (let rowIndex = 0; rowIndex < zRows.length; rowIndex++) {
          const yDatum = yVals[rowIndex];
          if (yDatum === undefined) continue;

          const zRow = zRows[rowIndex];
          const colCount = Math.min(xVals.length, zRow.length);
          for (let colIndex = 0; colIndex < colCount; colIndex++) {
            const xDatum = xVals[colIndex];
            if (xDatum === undefined) continue;

            const zValue = zRow[colIndex];
            rows.push(toCsvRow([
              String(traceIndex),
              traceName,
              trace.type,
              String(pointIndex),
              fmtDatum(xDatum),
              fmtDatum(yDatum),
              Number.isFinite(zValue) ? String(zValue) : ""
            ]));
            pointIndex += 1;
          }
        }
        continue;
      }

      const xs = Array.from(trace.x);
      const ys = Array.from(trace.y);
      const n = Math.min(xs.length, ys.length);
      for (let pointIndex = 0; pointIndex < n; pointIndex++) {
        rows.push(toCsvRow([
          String(traceIndex),
          traceName,
          trace.type,
          String(pointIndex),
          fmtDatum(xs[pointIndex]),
          fmtDatum(ys[pointIndex]),
          ""
        ]));
      }
    }

    return new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
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
    this.padding = this.resolveLayoutPadding(this.layout, this.basePadding);
    this.applyAriaAttributes();
    if (!this.initialized) return;

    this.overlay.setSize(this.width, this.height, this.padding);
    const scene = this.compileScene();
    this.renderer.setLayers(scene);

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");
    this.overlay.setAxes(
      this.makeOverlayAxisSpec("x", xType, this.xDomainNum),
      this.makeOverlayAxisSpec("y", yType, this.yDomainNum)
    );
    this.overlay.setGrid(this.resolveOverlayGrid());
    this.overlay.setAnnotations(this.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridBuilt = false;
    this.scheduleGridRebuild();
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

    const scene = this.compileScene();
    this.renderer.setLayers(scene);
    this.rebuildGridIndex();

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");
    this.overlay.setAxes(
      this.makeOverlayAxisSpec("x", xType, this.xDomainNum),
      this.makeOverlayAxisSpec("y", yType, this.yDomainNum)
    );
    this.overlay.setGrid(this.resolveOverlayGrid());
    this.overlay.setAnnotations(this.makeOverlayAnnotations(xType, yType));
    this.overlay.setLegend(this.isLegendVisible() ? this.makeLegendItems() : [], (i) => this.toggleTrace(i));

    this.gridBuilt = false;
    this.scheduleGridRebuild();
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

    this.gridBuilt = false;
    this.scheduleGridRebuild();
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

    const xAxis = this.getAxis("x");
    const yAxis = this.getAxis("y");
    const nextX = stripAxisBounds(xAxis);
    const nextY = stripAxisBounds(yAxis);

    const layoutWithDataBounds = this.setAxisInLayout(this.setAxisInLayout(this.layout, "x", nextX), "y", nextY);
    this.setLayout(layoutWithDataBounds);
    this.resetView();
  }

  autoscaleY() {
    this.assertActive("autoscaleY");

    const yAxis = this.getAxis("y");
    const yType = this.resolveAxisType("y");
    const xType = this.resolveAxisType("x");
    const [visibleX0, visibleX1] = this.getVisibleAxisRangeNum("x");
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
      const domain = this.computeAxisDomain(this.traces, "y", yAxis, yType);
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
    const nextLayout = this.setAxisInLayout(this.layout, "y", nextAxis);
    this.setLayout(nextLayout);
  }

  setAspectLock(enabled: boolean) {
    this.assertActive("setAspectLock");
    this.aspectLockEnabled = enabled;
    if (!enabled) return;

    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");
    const xSpan = axisSpan(this.xDomainNum, xType);
    if (!Number.isFinite(xSpan) || xSpan <= 0) return;
    const targetYSpan = xSpan * (plotH / plotW);
    if (!Number.isFinite(targetYSpan) || targetYSpan <= 0) return;

    const [y0, y1] = this.yDomainNum;
    const nextDomain = lockAxisSpan([y0, y1], targetYSpan, yType);
    const yAxis = this.getAxis("y");
    const nextAxis: Axis = {
      ...(yAxis ?? {}),
      autorange: false,
      domain: [fromAxisNumber(nextDomain[0], yType), fromAxisNumber(nextDomain[1], yType)]
    };
    delete nextAxis.range;
    this.setLayout(this.setAxisInLayout(this.layout, "y", nextAxis));
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

    if (this.gridRebuildTimer !== null) {
      clearTimeout(this.gridRebuildTimer);
      this.gridRebuildTimer = null;
    }
    this.gridRebuildPending = false;

    this.overlay?.setHoverGuides(null);
    this.renderer.setHoverHighlight(null);
    this.renderer.destroy();

    this.markerNormByTrace.clear();
    this.heatmapValueByTrace.clear();
    this.heatmapHoverSizeByTrace.clear();
    this.markerNormLayers = [];
    this.idRanges = [];
    this.xSorted = [];
    this.ySorted = [];
    this.traceData = [];
    this.gridMap.clear();
    this.gridX = new Float32Array(0);
    this.gridY = new Float32Array(0);
    this.gridTrace = new Uint32Array(0);
    this.gridPoint = new Uint32Array(0);
    this.gridBuilt = false;
    this.initialized = false;
    this.container.removeEventListener("keydown", this.handleContainerKeyDown);
    this.cleanupToolbar();
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
    return {
      ...trace,
      visible: trace.visible ?? true,
      x: Array.from(trace.x),
      y: Array.from(trace.y)
    };
  }

  private resolveLayoutPadding(layout: Layout, base: { l: number; r: number; t: number; b: number }) {
    const margin = layout.margin;
    if (!margin) return { ...base };
    return {
      l: coerceMargin(margin.left, base.l),
      r: coerceMargin(margin.right, base.r),
      t: coerceMargin(margin.top, base.t),
      b: coerceMargin(margin.bottom, base.b)
    };
  }

  private isLegendVisible() {
    return this.layout.legend?.show ?? true;
  }

  private getAxis(which: "x" | "y"): Axis | undefined {
    if (which === "x") return this.layout.xaxis ?? this.layout.axes?.x;
    return this.layout.yaxis ?? this.layout.axes?.y;
  }

  private setAxisInLayout(layout: Layout, which: "x" | "y", axis: Axis | undefined): Layout {
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

  private getVisibleAxisRangeNum(which: "x" | "y"): DomainNum {
    const type = this.resolveAxisType(which);
    const domain = which === "x" ? this.xDomainNum : this.yDomainNum;
    const plotSize = which === "x"
      ? Math.max(1, this.width - this.padding.l - this.padding.r)
      : Math.max(1, this.height - this.padding.t - this.padding.b);
    const translate = which === "x" ? this.zoom.x : this.zoom.y;
    const k = Math.max(1e-6, this.zoom.k);
    const n0 = (0 - translate) / (plotSize * k);
    const n1 = (plotSize - translate) / (plotSize * k);
    return [
      fromNormalizedDomain(n0, domain, type),
      fromNormalizedDomain(n1, domain, type)
    ];
  }

  private getHoverMode(): HoverMode {
    const mode = this.layout.hovermode;
    return mode === "x" || mode === "y" || mode === "none" || mode === "closest"
      ? mode
      : "closest";
  }

  private createExportCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private getExport2dContext(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Chart.exportPng(): 2D canvas context is not available.");
    return ctx;
  }

  private async drawSvgLayerToContext(
    ctx: CanvasRenderingContext2D,
    svg: SVGSVGElement,
    exportWidth: number,
    exportHeight: number
  ) {
    const dataUrl = serializeSvgToDataUrl(svg, this.width, this.height);
    const image = await loadImageFromUrl(dataUrl);
    ctx.drawImage(image, 0, 0, exportWidth, exportHeight);
  }

  private serializeSvgLayerForExport(svg: SVGSVGElement): string {
    return serializeSvgMarkup(svg, this.width, this.height);
  }

  private async captureCanvasLayerDataUrl(pixelRatio: number): Promise<string> {
    const exportWidth = Math.max(1, Math.round(this.width * pixelRatio));
    const exportHeight = Math.max(1, Math.round(this.height * pixelRatio));
    const exportCanvas = this.createExportCanvas(exportWidth, exportHeight);
    const ctx = this.getExport2dContext(exportCanvas);
    await this.drawCanvasLayerToContext(ctx, exportWidth, exportHeight, pixelRatio);
    return canvasToPngDataUrl(exportCanvas);
  }

  private async drawCanvasLayerToContext(
    ctx: CanvasRenderingContext2D,
    exportWidth: number,
    exportHeight: number,
    exportDpr: number
  ) {
    const capture = (
      this.renderer as unknown as {
        captureFrameImageData?: (frame: {
          width: number;
          height: number;
          dpr: number;
          padding: { l: number; r: number; t: number; b: number };
          zoom: { k: number; x: number; y: number };
        }) => Promise<ImageData>;
      } | undefined
    )?.captureFrameImageData;

    if (typeof capture === "function") {
      try {
        const imageData = await capture.call(this.renderer, {
          width: this.width,
          height: this.height,
          dpr: exportDpr,
          padding: this.padding,
          zoom: this.zoom
        });
        const gpuCanvas = this.createExportCanvas(imageData.width, imageData.height);
        this.getExport2dContext(gpuCanvas).putImageData(imageData, 0, 0);
        ctx.drawImage(gpuCanvas, 0, 0, exportWidth, exportHeight);
        return;
      } catch {
        // Fall through to canvas snapshot fallbacks.
      }
    }

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(this.canvas);
        try {
          ctx.drawImage(bitmap, 0, 0, exportWidth, exportHeight);
          return;
        } finally {
          bitmap.close();
        }
      } catch {
        // Fall through to blob/object URL snapshot path.
      }
    }

    try {
      const blob = await canvasToPngBlob(this.canvas);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = await loadImageFromUrl(objectUrl);
        ctx.drawImage(image, 0, 0, exportWidth, exportHeight);
        return;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      // Fall through to direct drawImage as a last resort.
    }

    ctx.drawImage(this.canvas, 0, 0, exportWidth, exportHeight);
  }

  private resolveAxisType(which: "x" | "y"): AxisType {
    const axis = this.getAxis(which);
    if (axis?.type) return axis.type;

    // Infer time axes from Date-valued data when no explicit type is provided.
    for (const trace of this.traces) {
      const arr = which === "x" ? trace.x : trace.y;
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

  private makeOverlayAxisSpec(which: "x" | "y", type: AxisType, domain: DomainNum): AxisSpec {
    const axis = this.getAxis(which);
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
        fontFamily: this.theme.axis.fontFamily,
        fontSizePx: this.theme.axis.fontSizePx
      }
    };
  }

  private makeOverlayAnnotations(xType: AxisType, yType: AxisType): OverlayAnnotationPrimitive[] {
    const annotations = this.layout.annotations;
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

  private resolveOverlayGrid(): GridStyle {
    const grid = this.layout.grid;
    return {
      show: grid?.show ?? this.theme.grid.show,
      color: grid?.color ?? this.theme.grid.color,
      axisColor: grid?.axisColor ?? this.theme.axis.color,
      textColor: grid?.textColor ?? this.theme.axis.textColor,
      opacity: grid?.opacity ?? this.theme.grid.opacity,
      strokeWidth: grid?.strokeWidth ?? this.theme.grid.strokeWidth
    };
  }

  private paletteColor(index: number) {
    const palette = this.theme.colors.palette;
    if (palette.length === 0) {
      return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
    }
    return palette[index % palette.length];
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

  // ----------------------------
  // Hover handling
  // ----------------------------

  private onHover(e: HoverEvent) {
    if (this.destroyed) return;

    const now = performance.now();
    if (now - this.lastHoverTs < this.hoverThrottleMs) return;
    this.lastHoverTs = now;

    const hovermode = this.getHoverMode();

    if (!e.inside) {
      this.overlay?.setHoverGuides(null);
      this.renderer.setHoverHighlight(null);
      this.hideTooltip();
      this.requestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    if (hovermode === "none") {
      this.overlay.setHoverGuides({ mode: "none", xPlot: e.xPlot, yPlot: e.yPlot, inside: true });
      this.renderer.setHoverHighlight(null);
      this.showCursorTooltip(e);
      this.requestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    // Choose pick mode
    const xNum = toNumber(e.xData, this.resolveAxisType("x"));
    const yNum = toNumber(e.yData, this.resolveAxisType("y"));

    let hit: PickResult | null = null;

    if (hovermode === "x") {
      hit = this.pickSnapX(xNum, e.xSvg);
    } else if (hovermode === "y") {
      hit = this.pickSnapY(yNum, e.ySvg);
    } else {
      // closest (CPU grid first)
      hit = this.cpuPickClosest(e.xSvg, e.ySvg);
    }

    // Snap guides to picked point if present, else cursor
    if (hit) {
      const { xPlot, yPlot } = this.screenToPlot(hit.screenX, hit.screenY);
      this.overlay.setHoverGuides({ mode: hovermode, xPlot, yPlot, inside: true });
    } else {
      this.overlay.setHoverGuides({ mode: hovermode, xPlot: e.xPlot, yPlot: e.yPlot, inside: true });
    }

    // GPU override for closest mode (more accurate)
    if ((hovermode === "closest") && (this.pickingMode === "gpu" || this.pickingMode === "both")) {
      this.gpuPickOverride(e, hit).catch(() => {
        // ignore pick errors
      });
    }

    if (!hit) {
      this.renderer.setHoverHighlight(null);
      this.hideTooltip();
      this.requestRender();
      this.emitHoverHook(e, hovermode, null);
      return;
    }

    this.applyHover(hit);
    this.emitHoverHook(e, hovermode, hit);
  }

  private async gpuPickOverride(e: HoverEvent, cpuHit: PickResult | null) {
    if (this.destroyed) return;
    
    const { pickX, pickY } = this.normalizePickCss(e.xSvg, e.ySvg);

    const id = await this.renderer.pick(
      {
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        padding: this.padding,
        zoom: this.zoom
      },
      pickX, pickY
    );

    if (this.destroyed) return;

    const gpuHit = this.idToHit(id);
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

  private async handleClick(e: HoverEvent) {
    if (this.destroyed) return;
    if (!this.onClickHook) return;

    if (!e.inside) {
      this.emitClickHook(e, null);
      return;
    }

    const hovermode = this.getHoverMode();
    if (hovermode === "none") {
      this.emitClickHook(e, null);
      return;
    }
    const xNum = toNumber(e.xData, this.resolveAxisType("x"));
    const yNum = toNumber(e.yData, this.resolveAxisType("y"));

    let hit: PickResult | null = null;
    if (hovermode === "x") {
      hit = this.pickSnapX(xNum, e.xSvg);
    } else if (hovermode === "y") {
      hit = this.pickSnapY(yNum, e.ySvg);
    } else {
      hit = this.cpuPickClosest(e.xSvg, e.ySvg);

      if (this.pickingMode === "gpu" || this.pickingMode === "both") {
        try {
          const { pickX, pickY } = this.normalizePickCss(e.xSvg, e.ySvg);
          const id = await this.renderer.pick(
            {
              width: this.width,
              height: this.height,
              dpr: this.dpr,
              padding: this.padding,
              zoom: this.zoom
            },
            pickX,
            pickY
          );
          if (this.destroyed) return;
          hit = this.idToHit(id) ?? hit;
        } catch {
          // Keep CPU result on pick failures.
        }
      }
    }

    this.emitClickHook(e, hit);
  }

  private normalizeHoverToCss(x: number, y: number) {
  // If x/y are already CSS px, they should be within [0..width/height].
  // If they are device px on a DPR=2 display, they'll be within [0..width*dpr].
  const looksLikeDevicePx =
    (x > this.width + 1 || y > this.height + 1) &&
    (x <= this.width * this.dpr + 2) &&
    (y <= this.height * this.dpr + 2);

  if (looksLikeDevicePx) {
    return { xCss: x / this.dpr, yCss: y / this.dpr };
  }
  return { xCss: x, yCss: y };
}

  private normalizePickCss(x: number, y: number) {
    const { xCss, yCss } = this.normalizeHoverToCss(x, y);
    const maxX = Math.max(0, this.width - Number.EPSILON);
    const maxY = Math.max(0, this.height - Number.EPSILON);
    return {
      pickX: Math.min(maxX, Math.max(0, xCss)),
      pickY: Math.min(maxY, Math.max(0, yCss))
    };
  }

  private toChartPoint(hit: PickResult | null): ChartPoint | null {
    if (!hit) return null;
    return {
      traceIndex: hit.traceIndex,
      pointIndex: hit.pointIndex,
      x: hit.x,
      y: hit.y,
      screenX: hit.screenX,
      screenY: hit.screenY
    };
  }

  private emitHoverHook(e: HoverEvent, mode: ChartHoverEvent["mode"], hit: PickResult | null) {
    if (!this.onHoverHook) return;
    this.onHoverHook({
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
    if (!this.onClickHook) return;
    this.onClickHook({
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

  private handleSelection(e: PlotSelectEvent) {
    if (!this.onSelectHook) return;

    const x0 = Math.min(e.x0Svg, e.x1Svg);
    const x1 = Math.max(e.x0Svg, e.x1Svg);
    const y0 = Math.min(e.y0Svg, e.y1Svg);
    const y1 = Math.max(e.y0Svg, e.y1Svg);
    const mode = e.mode ?? "box";
    const isLasso = mode === "lasso" && ("lassoSvg" in e);
    const lassoPoly = isLasso ? e.lassoSvg : undefined;

    const points: ChartSelectionEvent["points"] = [];
    let totalPoints = 0;

    for (const layer of this.markerNormLayers) {
      const traceIndex = layer.traceIndex;
      const coords = layer.points01;
      const count = Math.floor(coords.length / 2);
      const pointIndices: number[] = [];

      for (let i = 0; i < count; i++) {
        const xn = coords[i * 2 + 0];
        const yn = coords[i * 2 + 1];
        if (!Number.isFinite(xn) || !Number.isFinite(yn)) continue;

        const { screenX, screenY } = this.toScreenFromNorm(xn, yn);
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

    this.onSelectHook({
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

  // Back-compat for existing internal tests/callers.
  private handleBoxSelect(e: PlotSelectEvent) {
    this.handleSelection(e);
  }

  private applyHover(hit: PickResult) {
    const trace = this.traces[hit.traceIndex];
    if (!trace) return;

    this.showTooltip(this.makeTooltipContext(trace, hit));

    const norm = this.getNormPoint(hit.traceIndex, hit.pointIndex);
    if (norm) {
      const baseColor = this.getTraceColor(trace, hit.traceIndex);
      const inner = cssColorToRgba(baseColor, 0.95);
      const outline: [number, number, number, number] = [0, 0, 0, 0.55];

      this.renderer.setHoverHighlight({
        point01: [norm.xn, norm.yn],
        sizePx: this.getTraceHoverSizePx(trace, hit.traceIndex),
        innerRgba: inner,
        outlineRgba: outline
      });
    }

    this.requestRender();
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

  private screenToPlot(screenX: number, screenY: number) {
    return { xPlot: screenX - this.padding.l, yPlot: screenY - this.padding.t };
  }

  // ----------------------------
  // Picking: closest (CPU grid) + snap x/y
  // ----------------------------

  private cpuPickClosest(xCss: number, yCss: number): PickResult | null {
    if (!this.gridBuilt) return this.cpuPickFallbackScan(xCss, yCss);

    // Check both scale AND translation changes
    const dk = Math.abs(this.zoom.k - this.lastGridZoomK) / Math.max(1e-6, this.lastGridZoomK);
    if (dk >= this.gridMinScaleRelDelta) return this.cpuPickFallbackScan(xCss, yCss);
    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const relDeltaX = Math.abs(this.zoom.x - this.lastGridZoomX) / plotW;
    const relDeltaY = Math.abs(this.zoom.y - this.lastGridZoomY) / plotH;
    if (relDeltaX > this.gridMinTransRelDelta || relDeltaY > this.gridMinTransRelDelta) {
      return this.cpuPickFallbackScan(xCss, yCss);
    }

    // Convert pointer into grid base space (pan compensation)
    const dxPan = this.zoom.x - this.lastGridZoomX;
    const dyPan = this.zoom.y - this.lastGridZoomY;
    const xBase = xCss - dxPan;
    const yBase = yCss - dyPan;

    const r2 = this.hoverRpx * this.hoverRpx;

    const cx = Math.floor(xBase / this.gridCellPx);
    const cy = Math.floor(yBase / this.gridCellPx);
    const dc = Math.ceil(this.hoverRpx / this.gridCellPx);

    let bestGi = -1;
    let bestD2 = Number.POSITIVE_INFINITY;

    for (let oy = -dc; oy <= dc; oy++) {
      for (let ox = -dc; ox <= dc; ox++) {
        const key = this.gridKey(cx + ox, cy + oy);
        const bucket = this.gridMap.get(key);
        if (!bucket) continue;

        for (let bi = 0; bi < bucket.length; bi++) {
          const gi = bucket[bi];
          const px = this.gridX[gi];
          const py = this.gridY[gi];

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

    const tIdx = this.gridTrace[bestGi];
    const pIdx = this.gridPoint[bestGi];
    const td = this.traceData[tIdx];
    if (!td) return null;

    const norm = this.getNormPoint(tIdx, pIdx);
    if (!norm) return null;

    const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
    return { traceIndex: tIdx, pointIndex: pIdx, x: td.xs[pIdx], y: td.ys[pIdx], screenX, screenY };
  }

  private cpuPickFallbackScan(xCss: number, yCss: number): PickResult | null {
    const cap = 40_000;
    const r2 = this.hoverRpx * this.hoverRpx;

    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const ox = this.padding.l;
    const oy = this.padding.t;
    const k = this.zoom.k;
    const tx = this.zoom.x;
    const ty = this.zoom.y;

    let best: PickResult | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    let scanned = 0;

    for (const L of this.markerNormLayers) {
      const tIdx = L.traceIndex;
      const pts = L.points01;
      const count = pts.length / 2;
      const td = this.traceData[tIdx];
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

  private pickSnapX(cursorXNum: number, cursorScreenX: number): PickResult | null {
    let best: PickResult | null = null;
    let bestDx = Number.POSITIVE_INFINITY;

    for (const s of this.xSorted) {
      const tIdx = s.traceIndex;
      const td = this.traceData[tIdx];
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

  private pickSnapY(cursorYNum: number, cursorScreenY: number): PickResult | null {
    let best: PickResult | null = null;
    let bestDy = Number.POSITIVE_INFINITY;

    for (const s of this.ySorted) {
      const tIdx = s.traceIndex;
      const td = this.traceData[tIdx];
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

  // ----------------------------
  // Scene compilation
  // ----------------------------

  private compileScene() {
    const traces = this.traces.map((trace, traceIndex) => ({ trace, traceIndex }));

    const xType = this.resolveAxisType("x");
    const yType = this.resolveAxisType("y");

    // Cache raw trace data by source trace index to keep ID->trace mapping stable.
    this.traceData = new Array(this.traces.length).fill(null);
    this.heatmapValueByTrace.clear();
    this.heatmapHoverSizeByTrace.clear();
    for (const { trace, traceIndex } of traces) {
      if (trace.type === "heatmap") {
        const xVals = Array.from(trace.x);
        const yVals = Array.from(trace.y);
        const rows = this.toHeatmapRows(trace.z);
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
    this.xDomainNum = this.computeAxisDomain(this.traces, "x", this.getAxis("x"), xType);
    this.yDomainNum = this.computeAxisDomain(this.traces, "y", this.getAxis("y"), yType);

    // clear caches
    this.markerNormByTrace.clear();
    this.markerNormLayers = [];
    this.idRanges = [];

    const markers: Parameters<WebGPURenderer["setLayers"]>[0]["markers"] = [];
    const lines: Parameters<WebGPURenderer["setLayers"]>[0]["lines"] = [];

    let nextBaseId = 0;

    // Build layers
    traces.forEach(({ trace, traceIndex }) => {
      const vis = trace.visible ?? true;
      const renderable = vis === true;

      // still keep legendonly in legend; just skip render
      if (!renderable) return;

      if (trace.type === "bar") {
        const points01 = this.normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum);
        const count = points01.length / 2;
        if (count <= 0) return;

        const widthPx = Math.max(1, trace.bar?.widthPx ?? DEFAULT_BAR_WIDTH_PX);
        const baseId = nextBaseId;
        nextBaseId += count;

        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, points01);
        this.markerNormLayers.push({ traceIndex, points01 });

        markers.push({
          points01,
          // Keep pick/hover support for bars without rendering marker sprites.
          pointSizePx: Math.max(2, widthPx),
          rgba: [0, 0, 0, 0],
          baseId
        });

        const baseYn = this.normalizeBarBaseY(trace, yType, this.yDomainNum);
        const barPoints: number[] = [];
        for (let i = 0; i < count; i++) {
          const xn = points01[i * 2 + 0];
          const yn = points01[i * 2 + 1];
          if (Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(baseYn)) {
            barPoints.push(xn, baseYn, xn, yn, Number.NaN, Number.NaN);
          } else {
            barPoints.push(Number.NaN, Number.NaN);
          }
        }

        const baseColor = this.getTraceColor(trace, traceIndex);
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
        const rows = this.toHeatmapRows(trace.z);
        const ny = Math.min(yVals.length, rows.length);
        if (xVals.length === 0 || ny === 0) return;

        const xCenters01 = this.normalizeAxisValues(xVals, xType, this.xDomainNum, false);
        const yCenters01 = this.normalizeAxisValues(yVals, yType, this.yDomainNum, true);
        const xEdges01 = this.computeAxisEdges(xCenters01);
        const yEdges01 = this.computeAxisEdges(yCenters01);

        const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
        const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
        const fillOpacity = clamp01(trace.heatmap?.opacity ?? DEFAULT_HEATMAP_OPACITY);
        const colors = this.resolveHeatmapScale(trace);
        const zRange = this.resolveHeatmapZRange(trace, rows);
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

            const c = this.interpolateHeatmapColor(z, zRange[0], zRange[1], colors);
            lines.push({
              points01: new Float32Array([xc, y0, xc, y1]),
              rgba: [c[0], c[1], c[2], fillOpacity],
              widthPx,
              dash: "solid"
            });
          }
        }

        const count = markerPoints.length / 2;
        if (count <= 0) return;
        const baseId = nextBaseId;
        nextBaseId += count;

        const markerSize = this.estimateHeatmapHoverSize(widthSamples, heightSamples);
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
        const points01 = this.normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum);
        const count = points01.length / 2;
        if (count <= 0) return;

        const mode = trace.mode ?? "lines";
        const showMarkers = mode === "markers" || mode === "lines+markers";
        const showBoundary = mode === "lines" || mode === "lines+markers";
        const baseColor = this.getTraceColor(trace, traceIndex);

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

        const baseYn = this.normalizeAreaBaseY(trace, yType, this.yDomainNum);
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
          widthPx: this.computeAreaFillWidthPx(points01),
          dash: "solid"
        });

        if (showBoundary) {
          const smoothingMode = (trace.line?.smoothing ?? "none") as LineSmoothingMode;
          const linePoints01 = this.smoothLinePoints(points01, smoothingMode);
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

      const mode = trace.mode ?? "markers";
      const points01 = this.normalizeInterleaved(trace.x, trace.y, xType, yType, this.xDomainNum, this.yDomainNum);

      const baseColor = this.getTraceColor(trace, traceIndex);

      if (mode === "markers" || mode === "lines+markers") {
        const c = parseColor(baseColor) ?? [0.12, 0.55, 0.95];
        const a = clamp01(trace.marker?.opacity ?? 0.35);

        const count = points01.length / 2;
        const baseId = nextBaseId;
        nextBaseId += count;

        this.idRanges.push({ baseId, count, traceIndex });
        this.markerNormByTrace.set(traceIndex, points01);
        this.markerNormLayers.push({ traceIndex, points01 });

        markers.push({
          points01,
          pointSizePx: trace.marker?.sizePx ?? 2,
          rgba: [c[0], c[1], c[2], a],
          baseId
        });
      }

      if (mode === "lines" || mode === "lines+markers") {
        const smoothingMode = (trace.line?.smoothing ?? "none") as LineSmoothingMode;
        const linePoints01 = this.smoothLinePoints(points01, smoothingMode);
        const c = parseColor(trace.line?.color ?? baseColor) ?? [0.12, 0.12, 0.12];
        const a = clamp01(trace.line?.opacity ?? 0.55);
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
    const hovermode = this.getHoverMode();
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
          xsNum[i] = toNumber(td.xs[i], xType);
          ysNum[i] = toNumber(td.ys[i], yType);
        }

        const orderX = sortedOrder(xsNum);
        const orderY = sortedOrder(ysNum);
        this.xSorted.push({ traceIndex: tIdx, order: orderX, xsNum });
        this.ySorted.push({ traceIndex: tIdx, order: orderY, ysNum });
      }
    }

    return { markers, lines };
  }

  private computeAxisDomain(
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
      if (!Number.isFinite(min)) return this.applyAxisBounds([0, 1], axis, type);
      return this.applyAxisBounds([min - 0.5, max + 0.5], axis, type);
    }

    const pad = (max - min) * 0.02;
    const bounded = this.applyAxisBounds([min - pad, max + pad], axis, type);
    return bounded;
  }

  private applyAxisBounds(domain: DomainNum, axis: Axis | undefined, type: AxisType): DomainNum {
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

  private normalizeInterleaved(
    xs: ArrayLike<Datum>,
    ys: ArrayLike<Datum>,
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
      let xv = toNumber(xs[i], xType);
      let yv = toNumber(ys[i], yType);

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

  private smoothLinePoints(points01: Float32Array, mode: LineSmoothingMode): Float32Array {
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

  private getTraceColor(trace: Trace, traceIndex: number): string {
    if (trace.type === "bar") {
      return trace.bar?.color ?? trace.marker?.color ?? this.paletteColor(traceIndex);
    }
    if (trace.type === "heatmap") {
      return this.getHeatmapLegendColor(trace) ?? this.paletteColor(traceIndex);
    }
    if (trace.type === "area") {
      return trace.area?.color ?? trace.line?.color ?? trace.marker?.color ?? this.paletteColor(traceIndex);
    }
    return trace.marker?.color ?? trace.line?.color ?? this.paletteColor(traceIndex);
  }

  private getTraceHoverSizePx(trace: Trace, traceIndex: number): number {
    if (trace.type === "bar") {
      return Math.max(8, (trace.bar?.widthPx ?? DEFAULT_BAR_WIDTH_PX) + 2);
    }
    if (trace.type === "heatmap") {
      return this.heatmapHoverSizeByTrace.get(traceIndex) ?? 10;
    }
    if (trace.type === "area") {
      return (trace.marker?.sizePx ?? 2) + 5;
    }
    return (trace.marker?.sizePx ?? 2) + 5;
  }

  private normalizeBarBaseY(trace: BarTrace, yType: AxisType, yDom: DomainNum): number {
    const defaultBase = yType === "log" ? yDom[0] : 0;
    let yv = toNumber(trace.bar?.base ?? defaultBase, yType);
    if (yType === "log") yv = yv > 0 ? Math.log10(yv) : Number.NaN;

    const [y0, y1] = yDom;
    const ly0 = yType === "log" ? Math.log10(y0) : y0;
    const ly1 = yType === "log" ? Math.log10(y1) : y1;
    const invY = 1 / (ly1 - ly0);
    return Number.isFinite(yv) ? 1 - ((yv - ly0) * invY) : Number.NaN;
  }

  private normalizeAreaBaseY(trace: AreaTrace, yType: AxisType, yDom: DomainNum): number {
    const defaultBase = yType === "log" ? yDom[0] : 0;
    let yv = toNumber(trace.area?.base ?? defaultBase, yType);
    if (yType === "log") yv = yv > 0 ? Math.log10(yv) : Number.NaN;

    const [y0, y1] = yDom;
    const ly0 = yType === "log" ? Math.log10(y0) : y0;
    const ly1 = yType === "log" ? Math.log10(y1) : y1;
    const invY = 1 / (ly1 - ly0);
    return Number.isFinite(yv) ? 1 - ((yv - ly0) * invY) : Number.NaN;
  }

  private computeAreaFillWidthPx(points01: Float32Array): number {
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

    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    if (deltas.length === 0) return Math.max(2, Math.min(24, plotW / 24));

    deltas.sort((a, b) => a - b);
    const mid = deltas[Math.floor(deltas.length / 2)];
    const widthPx = mid * plotW * 0.98;
    return Math.max(1, Math.min(24, widthPx));
  }

  private toHeatmapRows(z: ArrayLike<ArrayLike<number>>): number[][] {
    const rows = Array.from(z as ArrayLike<ArrayLike<number>>, (row) => Array.from(row as ArrayLike<number>, (v) => Number(v)));
    return rows;
  }

  private normalizeAxisValues(values: Datum[], type: AxisType, dom: DomainNum, flipY: boolean): Float32Array {
    const out = new Float32Array(values.length);
    const [d0, d1] = dom;
    const l0 = type === "log" ? Math.log10(d0) : d0;
    const l1 = type === "log" ? Math.log10(d1) : d1;
    const inv = 1 / (l1 - l0);

    for (let i = 0; i < values.length; i++) {
      let v = toNumber(values[i], type);
      if (type === "log") v = v > 0 ? Math.log10(v) : Number.NaN;
      const n = Number.isFinite(v) ? (v - l0) * inv : Number.NaN;
      out[i] = flipY ? (1 - n) : n;
    }
    return out;
  }

  private computeAxisEdges(centers: Float32Array): Float32Array {
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

  private resolveHeatmapScale(trace: HeatmapTrace): Array<[number, number, number]> {
    const source = trace.heatmap?.colorscale?.length ? trace.heatmap.colorscale : DEFAULT_HEATMAP_COLORSCALE;
    const out: Array<[number, number, number]> = [];
    for (const c of source) {
      const parsed = parseColor(c);
      if (parsed) out.push(parsed);
    }
    return out.length > 0 ? out : [[0.12, 0.55, 0.95]];
  }

  private resolveHeatmapZRange(trace: HeatmapTrace, rows: number[][]): [number, number] {
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

  private interpolateHeatmapColor(
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

  private estimateHeatmapHoverSize(widthPx: number[], heightPx: number[]): number {
    if (widthPx.length === 0 || heightPx.length === 0) return 10;
    const median = (values: number[]) => {
      const v = values.slice().sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    const m = Math.max(median(widthPx), median(heightPx));
    return Math.max(6, Math.min(36, m + 2));
  }

  private getHeatmapLegendColor(trace: HeatmapTrace): string | undefined {
    const colors = trace.heatmap?.colorscale;
    if (!colors || colors.length === 0) return undefined;
    return colors[Math.floor(colors.length / 2)];
  }

  private makeLegendItems(): LegendItem[] {
    return this.traces.map((t, i) => {
      const name = t.name ?? `Trace ${i + 1}`;
      const color = this.getTraceColor(t, i);
      const visible = (t.visible ?? true) === true;
      return { name, color, visible };
    });
  }

  // ----------------------------
  // Grid index build (base space) - IMPROVED
  // ----------------------------

  private scheduleGridRebuild() {
    if (this.destroyed) return;
    if (!this.shouldRebuildGrid()) return;

    const now = performance.now();
    if (this.gridRebuildPending) return;

    const elapsed = now - this.gridLastBuildTs;
    const delay = elapsed >= this.gridMinBuildIntervalMs ? 0 : (this.gridMinBuildIntervalMs - elapsed);

    this.gridRebuildPending = true;
    this.gridRebuildTimer = window.setTimeout(() => {
      this.gridRebuildPending = false;
      this.gridRebuildTimer = null;
      if (!this.shouldRebuildGrid()) return;
      this.rebuildGridIndex();
    }, delay);
  }

  private shouldRebuildGrid() {
    if (!this.gridBuilt) return true;
    
    // Check scale change
    const dk = Math.abs(this.zoom.k - this.lastGridZoomK) / Math.max(1e-6, this.lastGridZoomK);
    if (dk >= this.gridMinScaleRelDelta) return true;
    
    // NEW: Check translation change (relative to plot size)
    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    
    const relDeltaX = Math.abs(this.zoom.x - this.lastGridZoomX) / plotW;
    const relDeltaY = Math.abs(this.zoom.y - this.lastGridZoomY) / plotH;
    
    if (relDeltaX > this.gridMinTransRelDelta || relDeltaY > this.gridMinTransRelDelta) {
      return true;
    }
    
    return false;
  }

  private rebuildGridIndex() {
    const t0 = performance.now();
    
    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const ox = this.padding.l;
    const oy = this.padding.t;

    const k = this.zoom.k;
    const tx = this.zoom.x;
    const ty = this.zoom.y;

    let total = 0;
    for (const L of this.markerNormLayers) total += L.points01.length / 2;

    this.gridX = new Float32Array(total);
    this.gridY = new Float32Array(total);
    this.gridTrace = new Uint32Array(total);
    this.gridPoint = new Uint32Array(total);
    this.gridMap.clear();

    let gi = 0;

    for (const L of this.markerNormLayers) {
      const tIdx = L.traceIndex;
      const pts = L.points01;
      const count = pts.length / 2;

      for (let i = 0; i < count; i++) {
        const xn = pts[i * 2 + 0];
        const yn = pts[i * 2 + 1];
        if (!Number.isFinite(xn) || !Number.isFinite(yn)) continue;

        const px = ox + (xn * plotW) * k + tx;
        const py = oy + (yn * plotH) * k + ty;

        if (px < ox - 50 || px > ox + plotW + 50 || py < oy - 50 || py > oy + plotH + 50) continue;

        this.gridX[gi] = px;
        this.gridY[gi] = py;
        this.gridTrace[gi] = tIdx;
        this.gridPoint[gi] = i;

        const cx = Math.floor(px / this.gridCellPx);
        const cy = Math.floor(py / this.gridCellPx);
        const key = this.gridKey(cx, cy);

        let bucket = this.gridMap.get(key);
        if (!bucket) {
          bucket = [];
          this.gridMap.set(key, bucket);
        }
        bucket.push(gi);

        gi++;
      }
    }

    if (gi !== total) {
      this.gridX = this.gridX.slice(0, gi);
      this.gridY = this.gridY.slice(0, gi);
      this.gridTrace = this.gridTrace.slice(0, gi);
      this.gridPoint = this.gridPoint.slice(0, gi);
    }

    this.gridBuilt = true;
    this.gridLastBuildTs = performance.now();
    this.lastGridZoomK = this.zoom.k;
    this.lastGridZoomX = this.zoom.x;
    this.lastGridZoomY = this.zoom.y;
    
    // Performance tracking
    if (this.enablePerfMonitoring) {
      const elapsed = performance.now() - t0;
      this.perfStats.lastGridBuildMs = elapsed;
      this.perfStats.gridBuildCount++;
      this.perfStats.avgGridBuildMs = 
        (this.perfStats.avgGridBuildMs * (this.perfStats.gridBuildCount - 1) + elapsed) / 
        this.perfStats.gridBuildCount;
    }
  }

  private gridKey(cx: number, cy: number) {
    return (BigInt(cx) << 32n) ^ (BigInt(cy) & 0xffffffffn);
  }

  // ----------------------------
  // GPU id -> PickResult
  // ----------------------------

  private idToHit(id: number): PickResult | null {
    if (!id) return null;
    const gid = id - 1;

    for (const r of this.idRanges) {
      if (gid >= r.baseId && gid < r.baseId + r.count) {
        const pointIndex = gid - r.baseId;

        const tIdx = r.traceIndex;
        const td = this.traceData[tIdx];
        if (!td) return null;

        const norm = this.getNormPoint(tIdx, pointIndex);
        if (!norm) return null;

        const { screenX, screenY } = this.toScreenFromNorm(norm.xn, norm.yn);
        return { traceIndex: tIdx, pointIndex, x: td.xs[pointIndex], y: td.ys[pointIndex], screenX, screenY };
      }
    }
    return null;
  }

  // ----------------------------
  // Screen transforms from normalized points
  // ----------------------------

  private toScreenFromNorm(xn: number, yn: number) {
    const plotW = Math.max(1, this.width - this.padding.l - this.padding.r);
    const plotH = Math.max(1, this.height - this.padding.t - this.padding.b);
    const ox = this.padding.l;
    const oy = this.padding.t;
    const k = this.zoom.k;
    const tx = this.zoom.x;
    const ty = this.zoom.y;
    return {
      screenX: ox + (xn * plotW) * k + tx,
      screenY: oy + (yn * plotH) * k + ty
    };
  }

  private getNormPoint(traceIndex: number, pointIndex: number) {
    const pts = this.markerNormByTrace.get(traceIndex);
    if (!pts) return null;
    const i = pointIndex * 2;
    if (i + 1 >= pts.length) return null;
    return { xn: pts[i], yn: pts[i + 1] };
  }

  // ----------------------------
  // Tooltip
  // ----------------------------

  private formatHover(trace: Trace, hit: PickResult) {
    const zValue =
      trace.type === "heatmap"
        ? this.heatmapValueByTrace.get(hit.traceIndex)?.[hit.pointIndex]
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
      .replaceAll("%{pointIndex}", String(hit.pointIndex))
      .replaceAll("%{trace.name}", escapeHtml(String(trace.name ?? "")));
  }

  private makeTooltipContext(trace: Trace, hit: PickResult): ChartTooltipContext {
    const z =
      trace.type === "heatmap"
        ? this.heatmapValueByTrace.get(hit.traceIndex)?.[hit.pointIndex]
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

  private showTooltip(context: ChartTooltipContext) {
    if (this.tooltipRenderer) {
      const rendered = this.tooltipRenderer(context);
      if (rendered === null) {
        this.hideTooltip();
        return;
      }
      const hasDomNode = typeof Node !== "undefined";
      if (hasDomNode && rendered instanceof Node) {
        this.tooltip.replaceChildren(rendered);
      } else {
        this.tooltip.innerHTML = String(rendered);
      }
    } else if (this.tooltipFormatter) {
      this.tooltip.textContent = String(this.tooltipFormatter(context));
    } else if (context.trace.hovertemplate) {
      this.tooltip.innerHTML = context.defaultLabel;
    } else {
      this.tooltip.textContent = context.defaultLabel;
    }

    this.tooltip.setAttribute("aria-hidden", "false");
    this.tooltip.style.transform = `translate(${context.screenX + 12}px, ${context.screenY + 12}px)`;
  }

  private showCursorTooltip(e: HoverEvent) {
    const x = fmtDatum(e.xData as Datum);
    const y = fmtDatum(e.yData as Datum);
    this.tooltip.textContent = `x=${x}  y=${y}`;
    this.tooltip.setAttribute("aria-hidden", "false");
    this.tooltip.style.transform = `translate(${e.xSvg + 12}px, ${e.ySvg + 12}px)`;
  }

  private hideTooltip() {
    this.tooltip.setAttribute("aria-hidden", "true");
    this.tooltip.style.transform = "translate(-9999px,-9999px)";
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

  private mountToolbar() {
    if (!this.toolbar.show) return;
    const enableExport = this.toolbar.export && this.toolbar.exportFormats.length > 0;
    const enableFullscreen = this.toolbar.fullscreen;
    if (!enableExport && !enableFullscreen) return;

    const toolbar = document.createElement("div");
    this.toolbarEl = toolbar;
    toolbar.className = "chart-toolbar";
    Object.assign(toolbar.style, {
      position: "absolute",
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px",
      borderRadius: "10px",
      border: `1px solid ${this.theme.axis.color}`,
      background: this.a11y.highContrast ? "#000000" : "rgba(255,255,255,0.9)",
      boxShadow: this.a11y.highContrast ? "none" : "0 6px 16px rgba(15,23,42,0.12)",
      pointerEvents: "auto",
      zIndex: "1100"
    });
    switch (this.toolbar.position) {
      case "top-left":
        toolbar.style.top = "10px";
        toolbar.style.left = "10px";
        break;
      case "bottom-right":
        toolbar.style.right = "10px";
        toolbar.style.bottom = "10px";
        break;
      case "bottom-left":
        toolbar.style.left = "10px";
        toolbar.style.bottom = "10px";
        break;
      case "top-right":
      default:
        toolbar.style.top = "10px";
        toolbar.style.right = "10px";
        break;
    }

    if (enableFullscreen) {
      const button = this.createToolbarButton("Full", "Enter full screen");
      this.toolbarFullscreenButton = button;
      button.addEventListener("click", this.handleToolbarFullscreenClick);
      toolbar.appendChild(button);
    }

    if (enableExport) {
      const wrap = document.createElement("div");
      this.toolbarExportWrap = wrap;
      Object.assign(wrap.style, {
        position: "relative",
        display: "inline-flex",
        alignItems: "center"
      });

      const trigger = this.createToolbarButton("Export", "Export chart");
      this.toolbarExportButton = trigger;
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", this.handleToolbarExportToggle);
      wrap.appendChild(trigger);

      const menu = document.createElement("div");
      this.toolbarExportMenu = menu;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Export options");
      Object.assign(menu.style, {
        position: "absolute",
        top: "calc(100% + 6px)",
        right: "0",
        minWidth: "100px",
        display: "none",
        flexDirection: "column",
        gap: "4px",
        padding: "6px",
        borderRadius: "8px",
        border: `1px solid ${this.theme.axis.color}`,
        background: this.a11y.highContrast ? "#000000" : "#ffffff",
        boxShadow: this.a11y.highContrast ? "none" : "0 10px 22px rgba(15,23,42,0.16)"
      });
      for (const format of this.toolbar.exportFormats) {
        const item = this.createToolbarButton(format.toUpperCase(), `Export ${format.toUpperCase()}`);
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.dataset.vxExportFormat = format;
        item.style.width = "100%";
        item.style.justifyContent = "flex-start";
        item.style.padding = "4px 8px";
        item.style.borderRadius = "6px";
        item.style.fontSize = "11px";
        menu.appendChild(item);
      }
      menu.addEventListener("click", this.handleToolbarExportMenuClick);
      wrap.appendChild(menu);
      toolbar.appendChild(wrap);
    }

    this.container.appendChild(toolbar);
    document.addEventListener("pointerdown", this.handleToolbarDocumentPointerDown);
    document.addEventListener("keydown", this.handleToolbarDocumentKeyDown);
    document.addEventListener("fullscreenchange", this.handleToolbarFullscreenChange);
    window.addEventListener("resize", this.handleToolbarWindowResize);

    this.setToolbarExportMenuOpen(false);
    this.syncToolbarFullscreenButton(document.fullscreenElement === this.container);
  }

  private createToolbarButton(label: string, title: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    Object.assign(button.style, {
      appearance: "none",
      border: `1px solid ${this.theme.axis.color}`,
      background: this.a11y.highContrast ? "#000000" : "#ffffff",
      color: this.theme.colors.text,
      borderRadius: "8px",
      fontFamily: this.theme.fonts.family,
      fontSize: "12px",
      fontWeight: "600",
      lineHeight: "1",
      minHeight: "28px",
      padding: "6px 9px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    });
    return button;
  }

  private setToolbarExportMenuOpen(open: boolean) {
    this.toolbarExportOpen = open;
    if (this.toolbarExportMenu) {
      this.toolbarExportMenu.style.display = open ? "flex" : "none";
    }
    if (this.toolbarExportButton) {
      this.toolbarExportButton.setAttribute("aria-expanded", String(open));
    }
  }

  private onToolbarExportToggle(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (this.toolbarExportBusy || !this.toolbarExportMenu) return;
    this.setToolbarExportMenuOpen(!this.toolbarExportOpen);
  }

  private async onToolbarExportMenuClick(event: MouseEvent) {
    if (this.toolbarExportBusy) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>("button[data-vx-export-format]");
    if (!button) return;
    const format = button.dataset.vxExportFormat;
    if (!isToolbarExportFormat(format)) return;

    this.toolbarExportBusy = true;
    if (this.toolbarExportButton) this.toolbarExportButton.disabled = true;
    this.toolbarExportMenu?.querySelectorAll<HTMLButtonElement>("button[data-vx-export-format]").forEach((node) => {
      node.disabled = true;
    });
    try {
      const timestamp = Date.now();
      if (format === "png") {
        const blob = await this.exportPng({ pixelRatio: this.toolbar.exportPixelRatio });
        this.downloadToolbarBlob(blob, `${sanitizeFilenamePart(this.toolbar.exportFilename)}-${timestamp}.png`);
      } else if (format === "svg") {
        const blob = await this.exportSvg({ pixelRatio: this.toolbar.exportPixelRatio });
        this.downloadToolbarBlob(blob, `${sanitizeFilenamePart(this.toolbar.exportFilename)}-${timestamp}.svg`);
      } else {
        const blob = this.exportCsvPoints();
        this.downloadToolbarBlob(blob, `${sanitizeFilenamePart(this.toolbar.exportFilename)}-points-${timestamp}.csv`);
      }
    } catch (error) {
      console.error("[vertexa-chart] Toolbar export failed.", error);
    } finally {
      this.toolbarExportBusy = false;
      if (this.toolbarExportButton) this.toolbarExportButton.disabled = false;
      this.toolbarExportMenu?.querySelectorAll<HTMLButtonElement>("button[data-vx-export-format]").forEach((node) => {
        node.disabled = false;
      });
      this.setToolbarExportMenuOpen(false);
    }
  }

  private downloadToolbarBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private async onToolbarFullscreenClick() {
    if (!this.toolbarFullscreenButton) return;
    try {
      if (document.fullscreenElement === this.container) {
        await document.exitFullscreen();
        return;
      }
      if (!this.toolbarPreFullscreenSize) {
        this.toolbarPreFullscreenSize = { width: this.width, height: this.height };
      }
      if (document.fullscreenElement && document.fullscreenElement !== this.container) {
        await document.exitFullscreen();
      }
      await this.container.requestFullscreen();
    } catch (error) {
      this.toolbarPreFullscreenSize = null;
      console.error("[vertexa-chart] Fullscreen toggle failed.", error);
    }
  }

  private onToolbarDocumentPointerDown(event: PointerEvent) {
    if (!this.toolbarExportOpen || !this.toolbarExportWrap) return;
    const target = event.target;
    if (target instanceof Node && this.toolbarExportWrap.contains(target)) return;
    this.setToolbarExportMenuOpen(false);
  }

  private onToolbarDocumentKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      this.setToolbarExportMenuOpen(false);
    }
  }

  private onToolbarFullscreenChange() {
    const active = document.fullscreenElement === this.container;
    this.syncToolbarFullscreenButton(active);
    if (active) {
      if (!this.toolbarPreFullscreenSize) {
        this.toolbarPreFullscreenSize = { width: this.width, height: this.height };
      }
      this.resizeToFullscreenViewport();
      return;
    }
    const previousSize = this.toolbarPreFullscreenSize;
    this.toolbarPreFullscreenSize = null;
    if (!previousSize) return;
    if (previousSize.width !== this.width || previousSize.height !== this.height) {
      this.setSize(previousSize.width, previousSize.height);
    }
  }

  private onToolbarWindowResize() {
    if (document.fullscreenElement !== this.container) return;
    this.resizeToFullscreenViewport();
  }

  private resizeToFullscreenViewport() {
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(240, window.innerHeight);
    if (width === this.width && height === this.height) return;
    this.setSize(width, height);
  }

  private syncToolbarFullscreenButton(active: boolean) {
    if (!this.toolbarFullscreenButton) return;
    this.toolbarFullscreenButton.textContent = active ? "Exit" : "Full";
    this.toolbarFullscreenButton.title = active ? "Exit full screen" : "Enter full screen";
    this.toolbarFullscreenButton.setAttribute("aria-label", active ? "Exit full screen" : "Enter full screen");
    this.toolbarFullscreenButton.setAttribute("aria-pressed", String(active));
    this.toolbarFullscreenButton.style.borderColor = active ? this.theme.colors.axis : this.theme.axis.color;
    this.toolbarFullscreenButton.style.background = active ? this.theme.colors.axis : (this.a11y.highContrast ? "#000000" : "#ffffff");
    this.toolbarFullscreenButton.style.color = active ? this.theme.colors.background : this.theme.colors.text;
  }

  private cleanupToolbar() {
    this.toolbarExportOpen = false;
    this.toolbarExportBusy = false;
    this.toolbarPreFullscreenSize = null;
    document.removeEventListener("pointerdown", this.handleToolbarDocumentPointerDown);
    document.removeEventListener("keydown", this.handleToolbarDocumentKeyDown);
    document.removeEventListener("fullscreenchange", this.handleToolbarFullscreenChange);
    window.removeEventListener("resize", this.handleToolbarWindowResize);
    this.toolbarExportButton?.removeEventListener("click", this.handleToolbarExportToggle);
    this.toolbarExportMenu?.removeEventListener("click", this.handleToolbarExportMenuClick);
    this.toolbarFullscreenButton?.removeEventListener("click", this.handleToolbarFullscreenClick);
    this.toolbarEl = null;
    this.toolbarExportWrap = null;
    this.toolbarExportMenu = null;
    this.toolbarExportButton = null;
    this.toolbarFullscreenButton = null;
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
    this.root.innerHTML = "";

    const container = document.createElement("div");
    this.container = container;
    container.className = "chart-container";
    Object.assign(container.style, {
      position: "relative",
      width: `${this.width}px`,
      height: `${this.height}px`,
      overflow: "hidden",
      background: this.theme.colors.background,
      color: this.theme.colors.text,
      fontFamily: this.theme.fonts.family,
      fontSize: `${this.theme.fonts.sizePx}px`
    });
    container.tabIndex = this.a11y.keyboardNavigation ? 0 : -1;
    if (this.a11y.keyboardNavigation) {
      container.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 F Y L");
      container.addEventListener("keydown", this.handleContainerKeyDown);
    }

    this.canvas = document.createElement("canvas");
    this.canvas.className = "chart-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      display: "block"
    });

    this.svgGrid = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgGrid.setAttribute("width", String(this.width));
    this.svgGrid.setAttribute("height", String(this.height));
    this.svgGrid.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.svgGrid.setAttribute("preserveAspectRatio", "none");
    this.svgGrid.setAttribute("aria-hidden", "true");
    this.svgGrid.classList.add("chart-grid");
    Object.assign((this.svgGrid as any).style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      display: "block"
    });

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("width", String(this.width));
    this.svg.setAttribute("height", String(this.height));
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute("preserveAspectRatio", "none");

    this.svg.classList.add("chart-overlay");
    Object.assign((this.svg as any).style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "auto",
      display: "block"
    });

    this.tooltip = document.createElement("div");
    this.tooltip.className = "chart-tooltip";
    this.tooltip.setAttribute("role", "status");
    this.tooltip.setAttribute("aria-live", "polite");
    this.tooltip.setAttribute("aria-atomic", "true");
    this.tooltip.setAttribute("aria-hidden", "true");
    Object.assign(this.tooltip.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      transform: "translate(-9999px,-9999px)",
      pointerEvents: "none",
      background: this.theme.tooltip.background,
      color: this.theme.tooltip.textColor,
      padding: `${this.theme.tooltip.paddingY}px ${this.theme.tooltip.paddingX}px`,
      borderRadius: `${this.theme.tooltip.borderRadiusPx}px`,
      fontFamily: this.theme.tooltip.fontFamily,
      fontSize: `${this.theme.tooltip.fontSizePx}px`,
      whiteSpace: "nowrap",
      boxShadow: this.theme.tooltip.boxShadow,
      zIndex: "1000"
    });

    container.appendChild(this.svgGrid);
    container.appendChild(this.canvas);
    container.appendChild(this.svg);
    container.appendChild(this.tooltip);
    this.mountToolbar();
    this.applyAriaAttributes();
    this.root.appendChild(container);
  }
}

// ----------------------------
// Helpers
// ----------------------------

function resolveChartA11y(a11y?: ChartA11yOptions): ResolvedChartA11y {
  return {
    label: resolveOptionalString(a11y?.label),
    description: resolveOptionalString(a11y?.description),
    keyboardNavigation: a11y?.keyboardNavigation ?? true,
    highContrast: a11y?.highContrast ?? false
  };
}

function resolveChartTheme(theme?: ChartTheme, highContrast = false): ResolvedChartTheme {
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

function resolveChartToolbar(toolbar?: ChartToolbarOptions): ResolvedChartToolbar {
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

function resolveToolbarPosition(value: ChartToolbarPosition | undefined): ChartToolbarPosition {
  if (value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right") {
    return value;
  }
  return "top-right";
}

function resolveToolbarExportFormats(
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

function isToolbarExportFormat(value: unknown): value is ChartToolbarExportFormat {
  return value === "png" || value === "svg" || value === "csv";
}

function sanitizeFilenamePart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "vertexa-chart";
  const safe = trimmed.replaceAll(/[^a-zA-Z0-9._-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "vertexa-chart";
}

function resolvePalette(values: string[] | undefined, fallback: string[] = DEFAULT_PALETTE) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback.slice();
  }
  const palette = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return palette.length > 0 ? palette : fallback.slice();
}

function resolveString(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function resolveOptionalString(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function clampToFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeMaxPoints(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  if (floored < 1) return undefined;
  return floored;
}

function toMutableDatumArray(values: ArrayLike<Datum>): Datum[] {
  return Array.isArray(values) ? values : Array.from(values);
}

function normalizeExportPixelRatio(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value < 0.25) return 0.25;
  if (value > 8) return 8;
  return value;
}

function serializeSvgMarkup(svg: SVGSVGElement, width: number, height: number): string {
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

function serializeSvgToDataUrl(svg: SVGSVGElement, width: number, height: number): string {
  const markup = serializeSvgMarkup(svg, width, height);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Chart.exportPng(): failed to rasterize SVG layer."));
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
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

function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  if (typeof canvas.toDataURL !== "function") {
    throw new Error("Chart.exportSvg(): canvas.toDataURL() is not available.");
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("Chart.exportSvg(): failed to encode embedded plot image.");
  }
}

function toNumber(d: Datum | number | Date, type: AxisType): number {
  if (type === "time") return d instanceof Date ? d.getTime() : Number(d);
  return d instanceof Date ? d.getTime() : Number(d);
}

function toAxisDatum(d: Datum | number | Date, type: AxisType): number | Date {
  if (type === "time") {
    const n = d instanceof Date ? d.getTime() : Number(d);
    return new Date(n);
  }
  return d instanceof Date ? d.getTime() : Number(d);
}

function fromAxisNumber(value: number, type: AxisType): Datum {
  if (type === "time") return new Date(value);
  return value;
}

function fromNormalizedDomain(n: number, domain: DomainNum, type: AxisType): number {
  const [d0, d1] = domain;
  if (type === "log") {
    const l0 = Math.log10(d0);
    const l1 = Math.log10(d1);
    return 10 ** (l0 + (l1 - l0) * n);
  }
  return d0 + (d1 - d0) * n;
}

function axisSpan(domain: DomainNum, type: AxisType): number {
  if (type === "log") {
    return Math.log10(domain[1]) - Math.log10(domain[0]);
  }
  return domain[1] - domain[0];
}

function lockAxisSpan(domain: DomainNum, targetSpan: number, type: AxisType): DomainNum {
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

function coerceMargin(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function stripAxisBounds(axis: Axis | undefined): Axis | undefined {
  if (!axis) return undefined;
  const next: Axis = { ...axis };
  delete next.domain;
  delete next.range;
  delete next.min;
  delete next.max;
  next.autorange = true;
  return next;
}

function fmtDatum(d: Datum): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function fmtNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return String(value);
}

function toCsvRow(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}

function isTextEntryElement(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  const htmlNode = node as HTMLElement;
  return Boolean(htmlNode.isContentEditable);
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function parseColor(s?: string): [number, number, number] | null {
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

function cssColorToRgba(color: string, alpha: number): [number, number, number, number] {
  const c = parseColor(color) ?? [0.12, 0.55, 0.95];
  return [c[0], c[1], c[2], alpha];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function lowerBoundIdx(order: Uint32Array, values: Float64Array, x: number) {
  let lo = 0, hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = values[order[mid]];
    if (v < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sortedOrder(values: Float64Array): Uint32Array {
  const n = values.length;
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  arr.sort((a, b) => values[a] - values[b]);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[i];
  return out;
}

function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
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

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}
