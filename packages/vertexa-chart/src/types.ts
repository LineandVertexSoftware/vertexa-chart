export type Datum = number | Date | string;

export type AxisType = "linear" | "log" | "time" | "category";

export type Axis = {
  type?: AxisType;           // default linear
  title?: string;
  range?: [Datum, Datum];    // overrides autorange if provided
  autorange?: boolean;       // default true
  domain?: [Datum, Datum];   // explicit domain override
  min?: Datum;               // lower autorange bound clamp
  max?: Datum;               // upper autorange bound clamp
  tickValues?: Datum[];      // fixed tick positions (data units)
  tickFormat?: string;       // d3-format (numeric) or d3-time-format (time)
  precision?: number;        // numeric decimal/significant precision
  timeFormat?: string;       // explicit d3-time-format for time axes
  categories?: string[];     // explicit category order for type "category"
};

/**
 * Visual theme options for chart-wide styling.
 *
 * All fields are optional and are merged with internal defaults.
 */
export type ChartTheme = {
  colors?: {
    background?: string;
    text?: string;
    axis?: string;
    grid?: string;
    tooltipBackground?: string;
    tooltipText?: string;
    palette?: string[];
  };
  fonts?: {
    family?: string;
    sizePx?: number;
    axisFamily?: string;
    axisSizePx?: number;
    tooltipFamily?: string;
    tooltipSizePx?: number;
  };
  axis?: {
    color?: string;
    textColor?: string;
    fontFamily?: string;
    fontSizePx?: number;
  };
  grid?: {
    show?: boolean;
    color?: string;
    opacity?: number;
    strokeWidth?: number;
  };
  tooltip?: {
    background?: string;
    textColor?: string;
    fontFamily?: string;
    fontSizePx?: number;
    borderRadiusPx?: number;
    paddingX?: number;
    paddingY?: number;
    boxShadow?: string;
  };
};

export type ChartA11yOptions = {
  /**
   * Accessible label announced for the chart region.
   *
   * Defaults to `layout.title` when available, otherwise `"Interactive chart"`.
   */
  label?: string;

  /**
   * Additional description announced by assistive technologies.
   */
  description?: string;

  /**
   * Enable keyboard pan/zoom shortcuts on the chart container.
   *
   * Defaults to `true`.
   */
  keyboardNavigation?: boolean;

  /**
   * Use high-contrast fallback theme defaults.
   *
   * Defaults to `false`.
   */
  highContrast?: boolean;
};

export type ChartToolbarPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left";
export type ChartToolbarExportFormat = "png" | "svg" | "csv";

export type ChartToolbarOptions = {
  /**
   * Show the built-in toolbar UI.
   *
   * Defaults to `false`.
   */
  show?: boolean;

  /**
   * Toolbar placement inside the chart viewport.
   *
   * Defaults to `"top-right"`.
   */
  position?: ChartToolbarPosition;

  /**
   * Show fullscreen toggle button.
   *
   * Defaults to `true` when toolbar is shown.
   */
  fullscreen?: boolean;

  /**
   * Show export button/dropdown.
   *
   * Defaults to `true` when toolbar is shown.
   */
  export?: boolean;

  /**
   * Export formats in dropdown order.
   *
   * Defaults to `["png", "svg", "csv"]`.
   */
  exportFormats?: ChartToolbarExportFormat[];

  /**
   * Base filename used by built-in export actions.
   *
   * Defaults to `"vertexa-chart"`.
   */
  exportFilename?: string;

  /**
   * Pixel ratio used by built-in PNG/SVG exports.
   *
   * Defaults to `2`.
   */
  exportPixelRatio?: number;
};

/**
 * Grid styling and visibility options.
 *
 * Defaults:
 * - `show`: `true`
 * - `color`: `"#e5e7eb"`
 * - `axisColor`: `"#9ca3af"`
 * - `textColor`: `"#4b5563"`
 * - `opacity`: `1`
 * - `strokeWidth`: `1`
 */
export type GridConfig = {
  show?: boolean;
  color?: string;
  axisColor?: string;
  textColor?: string;
  opacity?: number;
  strokeWidth?: number;
};

export type AnnotationLine = {
  type: "line";
  x0: Datum;
  y0: Datum;
  x1: Datum;
  y1: Datum;
  color?: string;
  opacity?: number;
  widthPx?: number;
  dash?: LineDashPattern;
};

export type AnnotationRegion = {
  type: "region";
  x0: Datum;
  y0: Datum;
  x1: Datum;
  y1: Datum;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidthPx?: number;
};

export type AnnotationLabel = {
  type: "label";
  x: Datum;
  y: Datum;
  text: string;
  color?: string;
  fontFamily?: string;
  fontSizePx?: number;
  anchor?: "start" | "middle" | "end";
  offsetXPx?: number;
  offsetYPx?: number;
  background?: string;
  backgroundOpacity?: number;
  paddingX?: number;
  paddingY?: number;
};

export type Annotation = AnnotationLine | AnnotationRegion | AnnotationLabel;

export type HoverMode = "closest" | "x" | "y" | "none";

export type LegendLayout = {
  show?: boolean;
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
};

export type Margin = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type Layout = {
  title?: string;
  xaxis?: Axis;
  yaxis?: Axis;
  axes?: {
    x?: Axis;
    y?: Axis;
  };
  hovermode?: HoverMode;
  grid?: GridConfig;
  annotations?: Annotation[];
  legend?: LegendLayout;
  margin?: Margin;
};

export type Visible = true | false | "legendonly";

export type LineDashPattern = "solid" | "dash" | "dot" | "dashdot" | number[];
export type LineSmoothingMode = "none" | "catmull-rom";

type TraceBase = {
  id?: string;
  name?: string;
  visible?: Visible;

  x: ArrayLike<Datum>;
  y: ArrayLike<Datum>;

  hovertemplate?: string; // supports %{x} %{y} %{pointIndex} %{trace.name} and %{z} for heatmaps
};

export type ScatterTrace = TraceBase & {
  type: "scatter";

  mode?: "markers" | "lines" | "lines+markers";

  marker?: { sizePx?: number; color?: string; opacity?: number };
  line?: {
    color?: string;
    opacity?: number;
    widthPx?: number; // default 1
    dash?: LineDashPattern; // default "solid"
    smoothing?: LineSmoothingMode; // default "none"
  };
};

export type BarTrace = TraceBase & {
  type: "bar";

  marker?: { color?: string; opacity?: number };
  bar?: {
    widthPx?: number; // default 10
    color?: string;
    opacity?: number;
    base?: Datum; // default 0
  };
};

export type AreaTrace = TraceBase & {
  type: "area";

  mode?: "markers" | "lines" | "lines+markers"; // default "lines"

  marker?: { sizePx?: number; color?: string; opacity?: number };
  line?: {
    color?: string;
    opacity?: number;
    widthPx?: number; // default 1.5
    dash?: LineDashPattern; // default "solid"
    smoothing?: LineSmoothingMode; // default "none"
  };
  area?: {
    base?: Datum; // default 0
    color?: string;
    opacity?: number; // default 0.26
  };
};

export type HeatmapTrace = TraceBase & {
  type: "heatmap";
  z: ArrayLike<ArrayLike<number>>;
  heatmap?: {
    colorscale?: string[];
    zmin?: number;
    zmax?: number;
    opacity?: number; // default 0.84
  };
};

export type Trace = ScatterTrace | BarTrace | AreaTrace | HeatmapTrace;

export type ChartPoint = {
  traceIndex: number;
  pointIndex: number;
  x: Datum;
  y: Datum;
  screenX: number; // CSS px in chart container coordinates
  screenY: number; // CSS px in chart container coordinates
};

export type ChartHoverEvent = {
  mode: HoverMode;
  inside: boolean;
  cursor: {
    screenX: number; // CSS px
    screenY: number; // CSS px
    xData: Datum;
    yData: Datum;
  };
  point: ChartPoint | null;
};

export type ChartClickEvent = {
  inside: boolean;
  cursor: {
    screenX: number; // CSS px
    screenY: number; // CSS px
    xData: Datum;
    yData: Datum;
  };
  point: ChartPoint | null;
};

export type ChartZoomEvent = {
  k: number;
  x: number;
  y: number;
};

export type ChartLegendToggleEvent = {
  traceIndex: number;
  previousVisible: Visible;
  visible: Visible;
  trace: Trace;
};

export type ChartSelectedTracePoints = {
  traceIndex: number;
  pointIndices: number[];
};

export type ChartTooltipContext = {
  traceIndex: number;
  pointIndex: number;
  trace: Trace;
  x: Datum;
  y: Datum;
  z?: number;
  screenX: number; // CSS px in chart container coordinates
  screenY: number; // CSS px in chart container coordinates
  defaultLabel: string;
};

export type ChartTooltipOptions = {
  /**
   * Return plain text tooltip content.
   * Used when `renderer` is not provided.
   */
  formatter?: (context: ChartTooltipContext) => string;

  /**
   * Return custom tooltip content.
   * - `string`: rendered as HTML
   * - `Node`: mounted directly in the tooltip container
   * - `null`: hide tooltip
   */
  renderer?: (context: ChartTooltipContext) => string | Node | null;
};

export type ChartSelectionEvent = {
  mode: "box" | "lasso";
  box: {
    x0: number; // CSS px in chart container coordinates
    y0: number; // CSS px in chart container coordinates
    x1: number; // CSS px in chart container coordinates
    y1: number; // CSS px in chart container coordinates
    x0Data: Datum;
    y0Data: Datum;
    x1Data: Datum;
    y1Data: Datum;
  };
  lasso?: {
    svg: Array<{ x: number; y: number }>; // CSS px in chart container coordinates
    plot: Array<{ x: number; y: number }>; // plot-local px
    data: Array<{ x: Datum; y: Datum }>;
  };
  points: ChartSelectedTracePoints[];
  totalPoints: number;
};

export type ChartLatencyStats = {
  last: number;
  avg: number;
};

export type ChartAppendPointsUpdate = {
  /**
   * Target trace index in the current chart trace list.
   */
  traceIndex: number;

  /**
   * New x values to append.
   */
  x: ArrayLike<Datum>;

  /**
   * New y values to append.
   */
  y: ArrayLike<Datum>;

  /**
   * Optional per-trace sliding window size applied after append.
   */
  maxPoints?: number;
};

export type ChartAppendPointsOptions = {
  /**
   * Default sliding window size applied to updates without `maxPoints`.
   */
  maxPoints?: number;
};

export type ChartExportPngOptions = {
  /**
   * Export scale factor relative to chart CSS size.
   *
   * Defaults to `1`.
   */
  pixelRatio?: number;

  /**
   * Background fill color before compositing chart layers.
   *
   * Defaults to theme background.
   */
  background?: string;

  /**
   * Include the SVG grid layer in export.
   *
   * Defaults to `true`.
   */
  includeGrid?: boolean;

  /**
   * Include the SVG overlay layer (axes, legend, guides) in export.
   *
   * Defaults to `true`.
   */
  includeOverlay?: boolean;
};

export type ChartExportSvgOptions = {
  /**
   * Export scale factor relative to chart CSS size for the embedded plot image.
   *
   * Defaults to `1`.
   */
  pixelRatio?: number;

  /**
   * Background fill color for the root SVG.
   *
   * Defaults to theme background.
   */
  background?: string;

  /**
   * Include the rendered plot layer as an embedded PNG image in the SVG.
   *
   * Defaults to `true`.
   */
  includePlot?: boolean;

  /**
   * Include the SVG grid layer in export.
   *
   * Defaults to `true`.
   */
  includeGrid?: boolean;

  /**
   * Include the SVG overlay layer (axes, legend, guides) in export.
   *
   * Defaults to `true`.
   */
  includeOverlay?: boolean;
};

export type ChartExportCsvPointsOptions = {
  /**
   * Include a CSV header row.
   *
   * Defaults to `true`.
   */
  includeHeader?: boolean;

  /**
   * Include traces with `visible: false` or `visible: "legendonly"`.
   *
   * Defaults to `false`.
   */
  includeHidden?: boolean;
};

/**
 * Runtime performance snapshot for a chart instance.
 *
 * - `fps` is estimated from the rolling average render time.
 * - `sampledPoints` is the effective marker instance count from the latest frame.
 * - `renderMs` and `pickMs` are timings in milliseconds.
 */
export type ChartPerformanceStats = {
  fps: number;
  sampledPoints: number;
  renderMs: ChartLatencyStats;
  pickMs: ChartLatencyStats;
  frameCount: number;
};

export type ChartPerformanceMode = "quality" | "balanced" | "max-fps";

/**
 * Frozen public API for `Chart` instances.
 *
 * Only these methods are part of the supported runtime contract.
 */
export interface ChartPublicApi {
  /**
   * Replace all traces and redraw.
   */
  setTraces(traces: Trace[]): void;

  /**
   * Incrementally append points to one or more traces and redraw.
   *
   * Supports optional sliding-window trimming via `maxPoints`.
   */
  appendPoints(
    updates: ChartAppendPointsUpdate | ChartAppendPointsUpdate[],
    options?: ChartAppendPointsOptions
  ): void;

  /**
   * Export the current chart view as PNG.
   */
  exportPng(options?: ChartExportPngOptions): Promise<Blob>;

  /**
   * Export the current chart view as SVG.
   */
  exportSvg(options?: ChartExportSvgOptions): Promise<Blob>;

  /**
   * Export chart points as CSV rows.
   */
  exportCsvPoints(options?: ChartExportCsvPointsOptions): Blob;

  /**
   * Replace layout and redraw.
   */
  setLayout(layout: Layout): void;

  /**
   * Resize the chart viewport in CSS pixels and redraw.
   */
  setSize(width: number, height: number): void;

  /**
   * Programmatically pan the current view in CSS pixels.
   */
  panBy(dxCss: number, dyCss: number): void;

  /**
   * Programmatically zoom the current view around an optional plot-local center.
   */
  zoomBy(factor: number, centerPlot?: { x: number; y: number }): void;

  /**
   * Reset zoom/pan transform to the default view.
   */
  resetView(): void;

  /**
   * Fit current data extents and reset view transform.
   */
  fitToData(): void;

  /**
   * Recompute y-axis domain for currently visible x-range.
   */
  autoscaleY(): void;

  /**
   * Enable or disable equal-unit aspect lock.
   */
  setAspectLock(enabled: boolean): void;

  /**
   * Switch renderer performance mode.
   */
  setPerformanceMode(mode: ChartPerformanceMode): void;

  /**
   * Read runtime performance stats for rendering and picking.
   */
  getPerformanceStats(): ChartPerformanceStats;

  /**
   * Release resources and detach the chart from the DOM.
   *
   * Idempotent: repeated calls are safe.
   */
  destroy(): void;
}

export type ChartOptions = {
  width: number;
  height: number;
  padding?: { l: number; r: number; t: number; b: number };
  /**
   * Global visual theme for colors, fonts, axis, grid, and tooltip styling.
   */
  theme?: ChartTheme;
  a11y?: ChartA11yOptions;

  layout?: Layout;
  traces: Trace[];

  pickingMode?: "cpu" | "gpu" | "both";
  onHover?: (event: ChartHoverEvent) => void;
  onClick?: (event: ChartClickEvent) => void;
  onZoom?: (event: ChartZoomEvent) => void;
  onLegendToggle?: (event: ChartLegendToggleEvent) => void;
  onSelect?: (event: ChartSelectionEvent) => void;
  tooltip?: ChartTooltipOptions;
  toolbar?: ChartToolbarOptions;
};
