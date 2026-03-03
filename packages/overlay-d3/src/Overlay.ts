import * as d3 from "d3";

export type ZoomState = { k: number; x: number; y: number };

export type LegendItem = {
  name: string;
  color: string;
  visible: boolean;
};

export type AxisType = "linear" | "log" | "time";

export type AxisStyle = {
  fontFamily?: string;
  fontSizePx?: number;
};

export type AxisSpec = {
  type: AxisType;
  domain: [number, number]; // numeric domain; time uses ms
  title?: string;
  tickValues?: Array<number | Date>;
  tickFormat?: string;
  precision?: number;
  timeFormat?: string;
  style?: AxisStyle;
};

export type HoverEvent = {
  xSvg: number; ySvg: number;      // SVG coords (CSS px)
  xPlot: number; yPlot: number;    // plot-local coords
  xData: number | Date;
  yData: number | Date;
  inside: boolean;
};

export type BoxSelectEvent = {
  mode?: "box";
  x0Svg: number; y0Svg: number;
  x1Svg: number; y1Svg: number;
  x0Plot: number; y0Plot: number;
  x1Plot: number; y1Plot: number;
  x0Data: number | Date;
  y0Data: number | Date;
  x1Data: number | Date;
  y1Data: number | Date;
};

export type LassoSelectEvent = {
  mode: "lasso";
  x0Svg: number; y0Svg: number;
  x1Svg: number; y1Svg: number;
  x0Plot: number; y0Plot: number;
  x1Plot: number; y1Plot: number;
  x0Data: number | Date;
  y0Data: number | Date;
  x1Data: number | Date;
  y1Data: number | Date;
  lassoSvg: Array<{ x: number; y: number }>;
  lassoPlot: Array<{ x: number; y: number }>;
  lassoData: Array<{ x: number | Date; y: number | Date }>;
};

export type PlotSelectEvent = BoxSelectEvent | LassoSelectEvent;

export type OverlayLineDash = "solid" | "dash" | "dot" | "dashdot" | number[];

export type AnnotationLine = {
  type: "line";
  x0: number | Date;
  y0: number | Date;
  x1: number | Date;
  y1: number | Date;
  color?: string;
  opacity?: number;
  widthPx?: number;
  dash?: OverlayLineDash;
};

export type AnnotationRegion = {
  type: "region";
  x0: number | Date;
  y0: number | Date;
  x1: number | Date;
  y1: number | Date;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidthPx?: number;
};

export type AnnotationLabel = {
  type: "label";
  x: number | Date;
  y: number | Date;
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

export type AnnotationPrimitive = AnnotationLine | AnnotationRegion | AnnotationLabel;

export type GridStyle = {
  show?: boolean;
  color?: string;
  axisColor?: string;
  textColor?: string;
  opacity?: number;
  strokeWidth?: number;
};

const DEFAULT_GRID_STYLE: Required<GridStyle> = {
  show: true,
  color: "#e5e7eb",
  axisColor: "#9ca3af",
  textColor: "#4b5563",
  opacity: 1,
  strokeWidth: 1
};

export type OverlayOptions = {
  svg: SVGSVGElement;
  gridSvg?: SVGSVGElement;
  width: number;
  height: number;
  padding: { l: number; r: number; t: number; b: number };
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  onZoom: (z: ZoomState) => void;
  onHover?: (e: HoverEvent) => void;
  onClick?: (e: HoverEvent) => void;
  onBoxSelect?: (e: PlotSelectEvent) => void;
  annotations?: AnnotationPrimitive[];
  grid?: GridStyle;

  legend?: {
    items: LegendItem[];
    onToggle: (index: number) => void;
  };
};

export class OverlayD3 {
  private svgSel: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gridSvgSel?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gRoot: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gGridRoot?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gXAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gYAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private zoomRect: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private gLegend: d3.Selection<SVGGElement, unknown, null, undefined>;

  private gGuides: d3.Selection<SVGGElement, unknown, null, undefined>;
  private vGuide: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private hGuide: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private selectionRect: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private selectionPath: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private gAnnotations: d3.Selection<SVGGElement, unknown, null, undefined>;

  private width = 0;
  private height = 0;
  private padding!: OverlayOptions["padding"];
  private plotW = 1;
  private plotH = 1;

  private baseX!: any;
  private baseY!: any;
  private gridStyle: Required<GridStyle>;

  private currentT = d3.zoomIdentity;
  private zoomBehavior: d3.ZoomBehavior<SVGRectElement, unknown> | null = null;
  private annotations: AnnotationPrimitive[] = [];
  private _annotationsVersion = 0;
  private selecting = false;
  private selectionMode: "box" | "lasso" = "box";
  private selectionStart: { xPlot: number; yPlot: number } | null = null;
  private lassoPoints: Array<{ xPlot: number; yPlot: number }> = [];
  private suppressClickUntil = 0;
  private _dragMoveHandler: ((e: MouseEvent) => void) | null = null;
  private _dragUpHandler: ((e: MouseEvent) => void) | null = null;
  private readonly _oid = `ov${Math.random().toString(36).slice(2, 9)}`;
  private _axisStyleEl!: d3.Selection<SVGStyleElement, unknown, null, undefined>;

  constructor(private opts: OverlayOptions) {
    this.svgSel = d3.select(opts.svg);
    this.svgSel.style("overflow", "hidden");
    if (opts.gridSvg) {
      this.gridSvgSel = d3.select(opts.gridSvg);
      this.gridSvgSel.style("overflow", "hidden").style("pointer-events", "none");
      this.gGridRoot = this.gridSvgSel.append("g").attr("class", "grid-root");
    }

    this.svgSel.attr("data-oid", this._oid);
    this._axisStyleEl = this.svgSel.append("style") as any;

    this.gRoot = this.svgSel.append("g").attr("class", "overlay-root");
    this.gXAxis = this.gRoot.append("g").attr("class", "x-axis");
    this.gYAxis = this.gRoot.append("g").attr("class", "y-axis");
    this.gAnnotations = this.gRoot.append("g").attr("class", "annotations").style("pointer-events", "none");

    // Guides (in plot coords)
    this.gGuides = this.gRoot.append("g").attr("class", "guides").style("pointer-events", "none");
    this.vGuide = this.gGuides.append("line")
      .attr("class", "v-guide")
      .attr("stroke", "#111")
      .attr("stroke-opacity", 0)
      .attr("stroke-width", 1)
      .attr("shape-rendering", "crispEdges");
    this.hGuide = this.gGuides.append("line")
      .attr("class", "h-guide")
      .attr("stroke", "#111")
      .attr("stroke-opacity", 0)
      .attr("stroke-width", 1)
      .attr("shape-rendering", "crispEdges");

    this.selectionRect = this.gRoot.append("rect")
      .attr("class", "selection-rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", 0)
      .attr("height", 0)
      .attr("fill", "rgba(37,99,235,0.18)")
      .attr("stroke", "#2563eb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 3")
      .attr("visibility", "hidden")
      .style("pointer-events", "none");
    this.selectionPath = this.gRoot.append("path")
      .attr("class", "selection-path")
      .attr("fill", "rgba(37,99,235,0.16)")
      .attr("stroke", "#2563eb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 3")
      .attr("visibility", "hidden")
      .style("pointer-events", "none");

    // Legend in SVG coords (top-right)
    this.gLegend = this.svgSel.append("g").attr("class", "legend");

    // Transparent rect to catch zoom
    this.zoomRect = this.gRoot
      .append("rect")
      .attr("class", "zoom-rect")
      .attr("fill", "transparent")
      .style("cursor", "crosshair");

    this.gridStyle = resolveGridStyle(opts.grid);
    this.annotations = opts.annotations ?? [];
    this.applyAxisStyles();
    this.setSize(opts.width, opts.height, opts.padding);
    this.installZoom(opts.onZoom);
    this.renderAxes({ k: 1, x: 0, y: 0 });

    if (opts.legend) this.setLegend(opts.legend.items, opts.legend.onToggle);
  }

  setSize(width: number, height: number, padding: OverlayOptions["padding"]) {
    this.width = width;
    this.height = height;
    this.padding = padding;

    this.svgSel.attr("width", width).attr("height", height);
    this.gridSvgSel?.attr("width", width).attr("height", height);

    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);
    this.plotW = plotW;
    this.plotH = plotH;

    this.baseX = makeScale(this.opts.xAxis.type, this.opts.xAxis.domain, [0, plotW]);
    this.baseY = makeScale(this.opts.yAxis.type, this.opts.yAxis.domain, [plotH, 0]);

    this.gRoot.attr("transform", `translate(${padding.l},${padding.t})`);
    this.gGridRoot?.attr("transform", `translate(${padding.l},${padding.t})`);
    this.gXAxis.attr("transform", `translate(0,${plotH})`);
    this.gYAxis.attr("transform", `translate(0,0)`);

    this.zoomRect.attr("x", 0).attr("y", 0).attr("width", plotW).attr("height", plotH);

    // Legend anchor
    this.gLegend.attr("transform", `translate(${padding.l + plotW - 8},${padding.t + 8})`);

    this.renderAxes({ k: this.currentT.k, x: this.currentT.x, y: this.currentT.y });
  }

  setAxes(xAxis: AxisSpec, yAxis: AxisSpec) {
    this.opts.xAxis = xAxis;
    this.opts.yAxis = yAxis;
    this.applyAxisStyles();
    this.setSize(this.width, this.height, this.padding);
  }

  setGrid(grid?: GridStyle) {
    this.gridStyle = resolveGridStyle(grid);
    this.applyAxisStyles();
    this.renderAxes({ k: this.currentT.k, x: this.currentT.x, y: this.currentT.y });
  }

  setAnnotations(annotations: AnnotationPrimitive[]) {
    this.annotations = annotations.slice();
    this._annotationsVersion++;
    this.renderAxes({ k: this.currentT.k, x: this.currentT.x, y: this.currentT.y });
  }

  setLegend(items: LegendItem[], onToggle: (index: number) => void) {
    const rowH = 18;
    const g = this.gLegend;
    g.attr("role", "group").attr("aria-label", "Chart legend");
    g.selectAll("*").remove();

    const rows = g
      .selectAll<SVGGElement, LegendItem>("g.row")
      .data(items)
      .enter()
      .append("g")
      .attr("class", "row")
      .attr("transform", (_d: LegendItem, i: number) => `translate(0,${i * rowH})`)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("focusable", "true")
      .attr("aria-pressed", (d: LegendItem) => (d.visible ? "true" : "false"))
      .attr("aria-label", (d: LegendItem) => `${d.name} (${d.visible ? "visible" : "hidden"})`)
      .style("cursor", "pointer")
      .on("click", function(this: SVGGElement) {
        const nodes = rows.nodes();
        const i = nodes.indexOf(this);
        if (i >= 0) onToggle(i);
      })
      .on("keydown", function(this: SVGGElement, event: KeyboardEvent) {
        const nodes = rows.nodes();
        const i = nodes.indexOf(this);
        if (i < 0) return;

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onToggle(i);
          return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const dir = event.key === "ArrowDown" ? 1 : -1;
          const next = (i + dir + nodes.length) % nodes.length;
          nodes[next]?.focus?.();
        }
      });

    rows.append("rect")
      .attr("x", -160)
      .attr("y", -12)
      .attr("width", 160)
      .attr("height", 18)
      .attr("fill", "transparent");

    rows.append("rect")
      .attr("x", -150)
      .attr("y", -9)
      .attr("width", 10)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", (d: LegendItem) => (d.visible ? d.color : this.gridStyle.axisColor))
      .attr("stroke", this.gridStyle.axisColor)
      .attr("stroke-opacity", 0.35);

    rows.append("text")
      .attr("x", -134)
      .attr("y", 0)
      .attr("dominant-baseline", "middle")
      .attr("text-anchor", "start")
      .attr("font-size", 12)
      .attr("fill", this.gridStyle.textColor)
      .attr("fill-opacity", (d: LegendItem) => (d.visible ? 1 : 0.65))
      .text((d: LegendItem) => d.name)
  }

  setHoverGuides(args: { mode: "closest" | "x" | "y" | "none"; xPlot: number; yPlot: number; inside: boolean } | null) {
    if (!args || !args.inside) {
      this.vGuide.attr("stroke-opacity", 0);
      this.hGuide.attr("stroke-opacity", 0);
      return;
    }
    const { mode, xPlot, yPlot } = args;

    if (mode === "x") {
      this.vGuide
        .attr("x1", xPlot).attr("y1", 0)
        .attr("x2", xPlot).attr("y2", this.plotH)
        .attr("stroke-opacity", 0.25);
      this.hGuide.attr("stroke-opacity", 0);
      return;
    }

    if (mode === "y") {
      this.hGuide
        .attr("x1", 0).attr("y1", yPlot)
        .attr("x2", this.plotW).attr("y2", yPlot)
        .attr("stroke-opacity", 0.25);
      this.vGuide.attr("stroke-opacity", 0);
      return;
    }

    this.vGuide
      .attr("x1", xPlot).attr("y1", 0)
      .attr("x2", xPlot).attr("y2", this.plotH)
      .attr("stroke-opacity", 0.28);
    this.hGuide
      .attr("x1", 0).attr("y1", yPlot)
      .attr("x2", this.plotW).attr("y2", yPlot)
      .attr("stroke-opacity", 0.28);
  }

  private installZoom(onZoom: (z: ZoomState) => void) {
    const clampPlot = (value: number, max: number) => Math.max(0, Math.min(max, value));

    const emitPointerEvent = (event: unknown, cb: ((e: HoverEvent) => void) | undefined) => {
      if (!cb) return;
      if (this.selecting) return;

      const [sx, sy] = d3.pointer(event as any, this.svgSel.node() as any);
      const xPlot = sx - this.padding.l;
      const yPlot = sy - this.padding.t;
      const inside = xPlot >= 0 && yPlot >= 0 && xPlot <= this.plotW && yPlot <= this.plotH;

      const zx = this.currentT.rescaleX(this.baseX);
      const zy = this.currentT.rescaleY(this.baseY);

      const xData = invertValue(this.opts.xAxis.type, zx, xPlot);
      const yData = invertValue(this.opts.yAxis.type, zy, yPlot);

      cb({ xSvg: sx, ySvg: sy, xPlot, yPlot, xData, yData, inside });
    };

    const zoomed = (event: d3.D3ZoomEvent<SVGRectElement, unknown>) => {
      const t = event.transform;
      this.currentT = t;
      this.renderAxes({ k: t.k, x: t.x, y: t.y });
      onZoom({ k: t.k, x: t.x, y: t.y });
    };

    const zoomBehavior = d3.zoom<SVGRectElement, unknown>()
      .scaleExtent([0.5, 50])
      .filter((event: any) => {
        if (this.selecting) return false;
        if (event?.shiftKey) return false;
        if (typeof event?.button === "number" && event.button !== 0) return false;
        return true;
      })
      .on("zoom", zoomed);

    this.zoomBehavior = zoomBehavior;
    this.zoomRect.call(zoomBehavior as any);

    // Hover events
	this.zoomRect.on("mousemove", (event) => {
      emitPointerEvent(event, this.opts.onHover);
    });
    this.zoomRect.on("click", (event) => {
      if (performance.now() < this.suppressClickUntil) return;
      emitPointerEvent(event, this.opts.onClick);
    });

    this.zoomRect.on("mouseleave", () => {
      if (!this.opts.onHover) return;
      this.opts.onHover({
        xSvg: -1, ySvg: -1, xPlot: -1, yPlot: -1,
        xData: NaN, yData: NaN,
        inside: false
      });
    });

    this.zoomRect.on("mousedown.selection", (event: MouseEvent) => {
      if (!this.opts.onBoxSelect) return;
      if (!event.shiftKey || event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      const [sx, sy] = d3.pointer(event as any, this.svgSel.node() as any);
      const xPlot = clampPlot(sx - this.padding.l, this.plotW);
      const yPlot = clampPlot(sy - this.padding.t, this.plotH);

      this.selecting = true;
      this.selectionMode = event.altKey ? "lasso" : "box";
      this.selectionStart = { xPlot, yPlot };
      if (this.selectionMode === "lasso") {
        this.lassoPoints = [{ xPlot, yPlot }];
        this.selectionRect.attr("visibility", "hidden").attr("width", 0).attr("height", 0);
        this.selectionPath.attr("d", `M ${xPlot} ${yPlot}`).attr("visibility", "visible");
      } else {
        this.lassoPoints = [];
        this.selectionPath.attr("visibility", "hidden").attr("d", "");
        this.selectionRect
          .attr("x", xPlot)
          .attr("y", yPlot)
          .attr("width", 0)
          .attr("height", 0)
          .attr("visibility", "visible");
      }

      const onMove = (moveEvent: MouseEvent) => {
        if (!this.selecting || !this.selectionStart) return;

        const [mx, my] = d3.pointer(moveEvent as any, this.svgSel.node() as any);
        const cx = clampPlot(mx - this.padding.l, this.plotW);
        const cy = clampPlot(my - this.padding.t, this.plotH);

        if (this.selectionMode === "lasso") {
          const last = this.lassoPoints[this.lassoPoints.length - 1];
          if (!last || Math.hypot(cx - last.xPlot, cy - last.yPlot) >= 2) {
            this.lassoPoints.push({ xPlot: cx, yPlot: cy });
            this.selectionPath
              .attr("d", this.makeLassoPath(this.lassoPoints))
              .attr("visibility", "visible");
          }
          return;
        }

        const x0 = Math.min(this.selectionStart.xPlot, cx);
        const x1 = Math.max(this.selectionStart.xPlot, cx);
        const y0 = Math.min(this.selectionStart.yPlot, cy);
        const y1 = Math.max(this.selectionStart.yPlot, cy);
        this.selectionRect
          .attr("x", x0)
          .attr("y", y0)
          .attr("width", x1 - x0)
          .attr("height", y1 - y0);
      };

      const finishSelection = (upEvent: MouseEvent) => {
        if (!this.selecting || !this.selectionStart) return;

        const start = this.selectionStart;
        this.selecting = false;
        this.selectionStart = null;

        const [ux, uy] = d3.pointer(upEvent as any, this.svgSel.node() as any);
        const endX = clampPlot(ux - this.padding.l, this.plotW);
        const endY = clampPlot(uy - this.padding.t, this.plotH);

        let x0Plot = Math.min(start.xPlot, endX);
        let x1Plot = Math.max(start.xPlot, endX);
        let y0Plot = Math.min(start.yPlot, endY);
        let y1Plot = Math.max(start.yPlot, endY);

        this.selectionRect.attr("visibility", "hidden").attr("width", 0).attr("height", 0);
        this.selectionPath.attr("visibility", "hidden").attr("d", "");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishSelection);
        this._dragMoveHandler = null;
        this._dragUpHandler = null;

        const zx = this.currentT.rescaleX(this.baseX);
        const zy = this.currentT.rescaleY(this.baseY);
        this.suppressClickUntil = performance.now() + 140;

        if (this.selectionMode === "lasso") {
          const pts = this.lassoPoints.length > 1
            ? [...this.lassoPoints, { xPlot: endX, yPlot: endY }]
            : this.lassoPoints;
          if (pts.length < 3) return;
          const bounds = this.computeLassoBounds(pts);
          x0Plot = bounds.x0;
          x1Plot = bounds.x1;
          y0Plot = bounds.y0;
          y1Plot = bounds.y1;
          const w = x1Plot - x0Plot;
          const h = y1Plot - y0Plot;
          if (w < 2 || h < 2) return;

          const lassoSvg = pts.map((p) => ({ x: p.xPlot + this.padding.l, y: p.yPlot + this.padding.t }));
          const lassoData = pts.map((p) => ({
            x: invertValue(this.opts.xAxis.type, zx, p.xPlot),
            y: invertValue(this.opts.yAxis.type, zy, p.yPlot)
          }));

          this.opts.onBoxSelect?.({
            mode: "lasso",
            x0Svg: x0Plot + this.padding.l,
            y0Svg: y0Plot + this.padding.t,
            x1Svg: x1Plot + this.padding.l,
            y1Svg: y1Plot + this.padding.t,
            x0Plot,
            y0Plot,
            x1Plot,
            y1Plot,
            x0Data: invertValue(this.opts.xAxis.type, zx, x0Plot),
            y0Data: invertValue(this.opts.yAxis.type, zy, y0Plot),
            x1Data: invertValue(this.opts.xAxis.type, zx, x1Plot),
            y1Data: invertValue(this.opts.yAxis.type, zy, y1Plot),
            lassoSvg,
            lassoPlot: pts.map((p) => ({ x: p.xPlot, y: p.yPlot })),
            lassoData
          });
          return;
        }

        const w = x1Plot - x0Plot;
        const h = y1Plot - y0Plot;
        if (w < 2 || h < 2) return;

        this.opts.onBoxSelect?.({
          mode: "box",
          x0Svg: x0Plot + this.padding.l,
          y0Svg: y0Plot + this.padding.t,
          x1Svg: x1Plot + this.padding.l,
          y1Svg: y1Plot + this.padding.t,
          x0Plot,
          y0Plot,
          x1Plot,
          y1Plot,
          x0Data: invertValue(this.opts.xAxis.type, zx, x0Plot),
          y0Data: invertValue(this.opts.yAxis.type, zy, y0Plot),
          x1Data: invertValue(this.opts.xAxis.type, zx, x1Plot),
          y1Data: invertValue(this.opts.yAxis.type, zy, y1Plot)
        });
      };

      this._dragMoveHandler = onMove;
      this._dragUpHandler = finishSelection;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishSelection);
    });
  }

  panBy(dxCss: number, dyCss: number) {
    if (!this.zoomBehavior) return;
    if (!Number.isFinite(dxCss) || !Number.isFinite(dyCss)) return;

    const k = Math.max(1e-6, this.currentT.k);
    const next = this.currentT.translate(dxCss / k, dyCss / k);
    this.zoomRect.call(this.zoomBehavior.transform as any, next);
  }

  zoomBy(factor: number, centerPlot?: { x: number; y: number }) {
    if (!this.zoomBehavior) return;
    if (!Number.isFinite(factor) || factor <= 0) return;

    const oldK = this.currentT.k;
    const nextK = clamp(oldK * factor, 0.5, 50, oldK);
    if (Math.abs(nextK - oldK) < 1e-9) return;

    const cx = clamp(centerPlot?.x, 0, this.plotW, this.plotW * 0.5);
    const cy = clamp(centerPlot?.y, 0, this.plotH, this.plotH * 0.5);
    const s = nextK / oldK;
    const nextX = cx - (cx - this.currentT.x) * s;
    const nextY = cy - (cy - this.currentT.y) * s;
    const next = d3.zoomIdentity.translate(nextX, nextY).scale(nextK);
    this.zoomRect.call(this.zoomBehavior.transform as any, next);
  }

  resetZoom() {
    if (!this.zoomBehavior) return;
    this.zoomRect.call(this.zoomBehavior.transform as any, d3.zoomIdentity);
  }

  destroy() {
    if (this._dragMoveHandler) {
      window.removeEventListener("mousemove", this._dragMoveHandler);
      this._dragMoveHandler = null;
    }
    if (this._dragUpHandler) {
      window.removeEventListener("mouseup", this._dragUpHandler);
      this._dragUpHandler = null;
    }
    if (this.zoomBehavior) {
      this.zoomRect.on(".zoom", null);
      this.zoomBehavior = null;
    }
    this.zoomRect
      .on("mousemove", null)
      .on("click", null)
      .on("mouseleave", null)
      .on("mousedown.selection", null);
    this.gRoot.remove();
    this.gGridRoot?.remove();
    this.gLegend.remove();
  }

  private makeLassoPath(points: Array<{ xPlot: number; yPlot: number }>) {
    if (points.length === 0) return "";
    const [first, ...rest] = points;
    let d = `M ${first.xPlot} ${first.yPlot}`;
    for (const p of rest) d += ` L ${p.xPlot} ${p.yPlot}`;
    d += " Z";
    return d;
  }

  private computeLassoBounds(points: Array<{ xPlot: number; yPlot: number }>) {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      if (p.xPlot < x0) x0 = p.xPlot;
      if (p.xPlot > x1) x1 = p.xPlot;
      if (p.yPlot < y0) y0 = p.yPlot;
      if (p.yPlot > y1) y1 = p.yPlot;
    }
    return { x0, y0, x1, y1 };
  }

  private renderAxes(z: ZoomState) {
    const plotW = this.plotW;
    const plotH = this.plotH;
    const grid = this.gridStyle;

    const t = d3.zoomIdentity.translate(z.x, z.y).scale(z.k);
    const zx = t.rescaleX(this.baseX);
    const zy = t.rescaleY(this.baseY);
    this.renderAnnotations(zx, zy);

    const xTickCount = Math.max(2, Math.floor(plotW / 80));
    const yTickCount = Math.max(2, Math.floor(plotH / 60));
    this.renderGridLines(zx, zy, xTickCount, yTickCount);

    const drawGridInAxisLayer = !this.gGridRoot && grid.show;
    const xTickSize = drawGridInAxisLayer ? -plotH : 6;
    const yTickSize = drawGridInAxisLayer ? -plotW : 6;

    const xAxis = d3.axisBottom(zx)
      .ticks(xTickCount)
      .tickSize(xTickSize)
      .tickSizeOuter(0);
    const yAxis = d3.axisLeft(zy)
      .ticks(yTickCount)
      .tickSize(yTickSize)
      .tickSizeOuter(0);

    if (this.opts.xAxis.tickValues && this.opts.xAxis.tickValues.length > 0) {
      xAxis.tickValues(this.opts.xAxis.tickValues as any);
    }
    if (this.opts.yAxis.tickValues && this.opts.yAxis.tickValues.length > 0) {
      yAxis.tickValues(this.opts.yAxis.tickValues as any);
    }

    const xTickFormatter = makeTickFormatter(this.opts.xAxis);
    const yTickFormatter = makeTickFormatter(this.opts.yAxis);
    if (xTickFormatter) xAxis.tickFormat(xTickFormatter as any);
    if (yTickFormatter) yAxis.tickFormat(yTickFormatter as any);

    this.gXAxis.call(xAxis as any);
    this.gYAxis.call(yAxis as any);
  }

  private applyAxisStyles() {
    const grid = this.gridStyle;
    const drawGridInAxisLayer = !this.gGridRoot && grid.show;
    const tickStroke = drawGridInAxisLayer ? grid.color : grid.axisColor;
    const tickOpacity = drawGridInAxisLayer ? grid.opacity : 0.45;
    const xFontFamily = normalizeFontFamily(this.opts.xAxis.style?.fontFamily);
    const yFontFamily = normalizeFontFamily(this.opts.yAxis.style?.fontFamily);
    const xFontSizePx = clamp(this.opts.xAxis.style?.fontSizePx, 1, 96, 12);
    const yFontSizePx = clamp(this.opts.yAxis.style?.fontSizePx, 1, 96, 12);
    const s = `[data-oid="${this._oid}"]`;
    this._axisStyleEl.text(
      `${s} .domain{opacity:0.6;stroke:${grid.axisColor}}` +
      `${s} .tick line{stroke:${tickStroke};stroke-width:${grid.strokeWidth};stroke-opacity:${tickOpacity};shape-rendering:crispEdges}` +
      `${s} .x-axis .tick text{opacity:0.9;fill:${grid.textColor};font-family:${xFontFamily};font-size:${xFontSizePx}px}` +
      `${s} .y-axis .tick text{opacity:0.9;fill:${grid.textColor};font-family:${yFontFamily};font-size:${yFontSizePx}px}`
    );
  }

  private renderGridLines(zx: any, zy: any, xTickCount: number, yTickCount: number) {
    if (!this.gGridRoot) return;

    if (!this.gridStyle.show) {
      this.gGridRoot.selectAll("line").remove();
      return;
    }

    const xTicks = (this.opts.xAxis.tickValues && this.opts.xAxis.tickValues.length > 0
      ? this.opts.xAxis.tickValues
      : getTickValues(zx, xTickCount)).filter((d) => Number.isFinite(Number(zx(d))));
    const yTicks = (this.opts.yAxis.tickValues && this.opts.yAxis.tickValues.length > 0
      ? this.opts.yAxis.tickValues
      : getTickValues(zy, yTickCount)).filter((d) => Number.isFinite(Number(zy(d))));

    this.gGridRoot
      .selectAll<SVGLineElement, number | Date>("line.grid-x")
      .data(xTicks)
      .join("line")
      .attr("class", "grid-x")
      .attr("x1", (d) => Number(zx(d)))
      .attr("y1", 0)
      .attr("x2", (d) => Number(zx(d)))
      .attr("y2", this.plotH)
      .attr("stroke", this.gridStyle.color)
      .attr("stroke-width", this.gridStyle.strokeWidth)
      .attr("stroke-opacity", this.gridStyle.opacity)
      .attr("shape-rendering", "crispEdges");

    this.gGridRoot
      .selectAll<SVGLineElement, number | Date>("line.grid-y")
      .data(yTicks)
      .join("line")
      .attr("class", "grid-y")
      .attr("x1", 0)
      .attr("y1", (d) => Number(zy(d)))
      .attr("x2", this.plotW)
      .attr("y2", (d) => Number(zy(d)))
      .attr("stroke", this.gridStyle.color)
      .attr("stroke-width", this.gridStyle.strokeWidth)
      .attr("stroke-opacity", this.gridStyle.opacity)
      .attr("shape-rendering", "crispEdges");
  }

  private renderAnnotations(zx: any, zy: any) {
    const version = this._annotationsVersion;

    this.gAnnotations
      .selectAll<SVGGElement, AnnotationPrimitive>("g.anno")
      .data(this.annotations, (_d, i) => `${version}-${i}`)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "anno");
          g.each(function (d) {
            const sel = d3.select(this as SVGGElement);
            if (d.type === "line") {
              const [dashArray, dashCount] = overlayDashToStrokeArray(d.dash);
              sel.append("line")
                .attr("stroke", d.color ?? "#2563eb")
                .attr("stroke-opacity", clamp(d.opacity, 0, 1, 0.9))
                .attr("stroke-width", Math.max(0.5, d.widthPx ?? 1.5))
                .attr("stroke-dasharray", dashCount > 0 ? dashArray : null)
                .attr("shape-rendering", "geometricPrecision");
            } else if (d.type === "region") {
              sel.append("rect")
                .attr("fill", d.fill ?? "#2563eb")
                .attr("fill-opacity", clamp(d.fillOpacity, 0, 1, 0.14))
                .attr("stroke", d.stroke ?? "#2563eb")
                .attr("stroke-opacity", clamp(d.strokeOpacity, 0, 1, 0.35))
                .attr("stroke-width", Math.max(0, d.strokeWidthPx ?? 1));
            } else {
              const text = sel.append("text")
                .text(d.text)
                .attr("x", 0)
                .attr("y", 0)
                .attr("text-anchor", d.anchor ?? "start")
                .attr("dominant-baseline", "central")
                .attr("fill", d.color ?? "#111827")
                .attr("font-family", normalizeFontFamily(d.fontFamily))
                .attr("font-size", `${clamp(d.fontSizePx, 1, 96, 12)}px`);
              if (d.background) {
                const node = text.node();
                if (node) {
                  try {
                    const bb = node.getBBox();
                    const px = Math.max(0, d.paddingX ?? 4);
                    const py = Math.max(0, d.paddingY ?? 2);
                    sel.insert("rect", "text")
                      .attr("x", bb.x - px)
                      .attr("y", bb.y - py)
                      .attr("width", bb.width + px * 2)
                      .attr("height", bb.height + py * 2)
                      .attr("rx", 3)
                      .attr("fill", d.background)
                      .attr("fill-opacity", clamp(d.backgroundOpacity, 0, 1, 0.85));
                  } catch {
                    // Ignore text bbox failures in non-layout contexts.
                  }
                }
              }
            }
          });
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      )
      .each(function (d) {
        const sel = d3.select(this as SVGGElement);
        if (d.type === "line") {
          sel.select<SVGLineElement>("line")
            .attr("x1", Number(zx(d.x0)))
            .attr("y1", Number(zy(d.y0)))
            .attr("x2", Number(zx(d.x1)))
            .attr("y2", Number(zy(d.y1)));
        } else if (d.type === "region") {
          const rx0 = Number(zx(d.x0));
          const rx1 = Number(zx(d.x1));
          const ry0 = Number(zy(d.y0));
          const ry1 = Number(zy(d.y1));
          sel.select<SVGRectElement>("rect")
            .attr("x", Math.min(rx0, rx1))
            .attr("y", Math.min(ry0, ry1))
            .attr("width", Math.abs(rx1 - rx0))
            .attr("height", Math.abs(ry1 - ry0));
        } else {
          sel.attr("transform", `translate(${Number(zx(d.x)) + (d.offsetXPx ?? 0)},${Number(zy(d.y)) + (d.offsetYPx ?? 0)})`);
        }
      });
  }
}

function makeScale(type: AxisType, domain: [number, number], range: [number, number]): any {
  if (type === "log") {
    return d3.scaleLog().domain(domain).range(range).clamp(true);
  }
  if (type === "time") {
    return d3.scaleTime().domain([new Date(domain[0]), new Date(domain[1])]).range(range);
  }
  return d3.scaleLinear().domain(domain).range(range);
}

function invertValue(type: AxisType, scale: any, v: number): number | Date {
  const inv = scale.invert(v);
  if (type === "time") return inv as Date;
  return Number(inv);
}

function resolveGridStyle(grid?: GridStyle): Required<GridStyle> {
  const show = grid?.show ?? DEFAULT_GRID_STYLE.show;
  const color = resolveColor(grid?.color, DEFAULT_GRID_STYLE.color);
  const axisColor = resolveColor(grid?.axisColor, DEFAULT_GRID_STYLE.axisColor);
  const textColor = resolveColor(grid?.textColor, DEFAULT_GRID_STYLE.textColor);
  const opacity = clamp(grid?.opacity, 0, 1, DEFAULT_GRID_STYLE.opacity);
  const strokeWidth = clamp(grid?.strokeWidth, 0, Number.POSITIVE_INFINITY, DEFAULT_GRID_STYLE.strokeWidth);

  return {
    show,
    color,
    axisColor,
    textColor,
    opacity,
    strokeWidth
  };
}

function overlayDashToStrokeArray(dash: OverlayLineDash | undefined): [string, number] {
  if (!dash || dash === "solid") return ["", 0];
  if (dash === "dash") return ["8 6", 2];
  if (dash === "dot") return ["2 4", 2];
  if (dash === "dashdot") return ["8 4 2 4", 4];
  const parts = dash.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  if (parts.length === 0) return ["", 0];
  return [parts.join(" "), parts.length];
}

function resolveColor(input: string | undefined, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeFontFamily(input: string | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getTickValues(scale: any, count: number): Array<number | Date> {
  if (typeof scale?.ticks === "function") {
    return scale.ticks(count) as Array<number | Date>;
  }
  return [];
}

function makeTickFormatter(axis: AxisSpec): ((d: number | Date) => string) | null {
  if (axis.type === "time") {
    const fmtPattern = axis.timeFormat ?? axis.tickFormat;
    if (!fmtPattern) return null;
    const tf = d3.timeFormat(fmtPattern);
    return (d) => tf(d instanceof Date ? d : new Date(Number(d)));
  }

  if (axis.tickFormat) {
    try {
      const f = d3.format(axis.tickFormat);
      return (d) => f(Number(d));
    } catch {
      return null;
    }
  }

  if (typeof axis.precision === "number" && Number.isFinite(axis.precision)) {
    const p = Math.max(0, Math.min(20, Math.floor(axis.precision)));
    try {
      const spec = axis.type === "log" ? `.${p}~g` : `.${p}f`;
      const f = d3.format(spec);
      return (d) => f(Number(d));
    } catch {
      return null;
    }
  }

  return null;
}
