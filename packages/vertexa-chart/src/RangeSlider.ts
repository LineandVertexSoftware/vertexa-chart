import type { ResolvedRangeSlider, ResolvedChartTheme, DomainNum, Padding } from "./chart-utils.js";
import { getTraceColor } from "./scene.js";
import { toNumber } from "./chart-utils.js";
import type { AxisType, Datum, Trace } from "./types.js";

/**
 * Mini overview range slider rendered below the main chart.
 *
 * Uses Canvas 2D for the overview line chart and an SVG overlay for
 * the draggable selection window.
 */
export class RangeSlider {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private svgEl: SVGSVGElement;
  private maskLeft: SVGRectElement;
  private maskRight: SVGRectElement;
  private windowRect: SVGRectElement;
  private handleLeft: SVGRectElement;
  private handleRight: SVGRectElement;

  private width: number;
  private heightPx: number;
  private padding: Padding;
  private config: ResolvedRangeSlider;

  // Current window in normalized [0,1] space
  private n0 = 0;
  private n1 = 1;

  // Drag state
  private dragType: "left" | "right" | "center" | null = null;
  private dragStartX = 0;
  private dragStartN0 = 0;
  private dragStartN1 = 0;
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnMouseUp: (e: MouseEvent) => void;

  private onRangeChange: (n0: number, n1: number) => void;

  constructor(
    container: HTMLElement,
    opts: {
      width: number;
      heightPx: number;
      padding: Padding;
      theme: ResolvedChartTheme;
      config: ResolvedRangeSlider;
      onRangeChange: (n0: number, n1: number) => void;
    }
  ) {
    this.width = opts.width;
    this.heightPx = opts.heightPx;
    this.padding = opts.padding;
    this.config = opts.config;
    this.onRangeChange = opts.onRangeChange;

    this.boundOnMouseMove = (e) => this.onMouseMove(e);
    this.boundOnMouseUp = (e) => this.onMouseUp(e);

    // Wrapper
    this.el = document.createElement("div");
    this.el.className = "vx-range-slider";
    Object.assign(this.el.style, {
      position: "relative",
      width: `${opts.width}px`,
      height: `${opts.heightPx}px`,
      overflow: "hidden",
      background: opts.theme.colors.background
    });

    // Canvas for the mini overview
    this.canvas = document.createElement("canvas");
    this.canvas.width = opts.width * (window.devicePixelRatio || 1);
    this.canvas.height = opts.heightPx * (window.devicePixelRatio || 1);
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%"
    });
    this.el.appendChild(this.canvas);

    // SVG overlay for the selection window
    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.setAttribute("width", String(opts.width));
    this.svgEl.setAttribute("height", String(opts.heightPx));
    this.svgEl.setAttribute("viewBox", `0 0 ${opts.width} ${opts.heightPx}`);
    Object.assign((this.svgEl as unknown as HTMLElement).style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      cursor: "default"
    });

    const maskColor = opts.config.maskColor;
    const maskOpacity = String(opts.config.maskOpacity);
    const handleColor = opts.config.handleColor;

    // Left mask
    this.maskLeft = this.createRect(0, 0, 0, opts.heightPx, maskColor, maskOpacity);
    this.svgEl.appendChild(this.maskLeft);

    // Right mask
    this.maskRight = this.createRect(0, 0, 0, opts.heightPx, maskColor, maskOpacity);
    this.svgEl.appendChild(this.maskRight);

    // Selection window border
    this.windowRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    this.windowRect.setAttribute("y", "0");
    this.windowRect.setAttribute("height", String(opts.heightPx));
    this.windowRect.setAttribute("fill", "none");
    this.windowRect.setAttribute("stroke", handleColor);
    this.windowRect.setAttribute("stroke-width", "1");
    this.windowRect.style.cursor = "grab";
    this.svgEl.appendChild(this.windowRect);

    // Drag handles (small vertical bars)
    const hw = 5;
    this.handleLeft = this.createRect(0, 0, hw, opts.heightPx, handleColor, "0.8");
    this.handleLeft.style.cursor = "ew-resize";
    this.svgEl.appendChild(this.handleLeft);

    this.handleRight = this.createRect(0, 0, hw, opts.heightPx, handleColor, "0.8");
    this.handleRight.style.cursor = "ew-resize";
    this.svgEl.appendChild(this.handleRight);

    this.el.appendChild(this.svgEl);

    // Mouse events on SVG
    this.svgEl.addEventListener("mousedown", (e) => this.onMouseDown(e));

    container.appendChild(this.el);
    this.updateWindowElements();
  }

  private createRect(x: number, y: number, w: number, h: number, fill: string, opacity: string): SVGRectElement {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("fill", fill);
    r.setAttribute("fill-opacity", opacity);
    return r;
  }

  private get plotLeft() { return this.padding.l; }
  private get plotRight() { return this.width - this.padding.r; }
  private get plotW() { return Math.max(1, this.plotRight - this.plotLeft); }

  /** Set the selection window from external zoom changes. */
  setWindow(n0: number, n1: number) {
    this.n0 = Math.max(0, Math.min(1, n0));
    this.n1 = Math.max(0, Math.min(1, n1));
    if (this.n1 - this.n0 < 0.001) {
      this.n1 = Math.min(1, this.n0 + 0.001);
    }
    this.updateWindowElements();
  }

  setSize(width: number) {
    this.width = width;
    this.el.style.width = `${width}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.svgEl.setAttribute("width", String(width));
    this.svgEl.setAttribute("viewBox", `0 0 ${width} ${this.heightPx}`);
    this.updateWindowElements();
  }

  setPadding(padding: Padding) {
    this.padding = padding;
    this.updateWindowElements();
  }

  /** Render a simplified line overview of the trace data. */
  renderMiniChart(
    traces: Trace[],
    xDomainNum: DomainNum,
    xType: AxisType,
    yType: AxisType,
    theme: ResolvedChartTheme
  ) {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, cw, ch);

    const pxL = this.plotLeft * dpr;
    const pxW = this.plotW * dpr;
    const h = ch;
    const marginY = 4 * dpr;

    // Compute a combined y extent across all visible traces for the overview
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const trace of traces) {
      if ((trace.visible ?? true) !== true) continue;
      if (trace.type === "heatmap" || trace.type === "histogram") continue;
      const n = Math.min(trace.x.length, trace.y.length);
      for (let i = 0; i < n; i++) {
        const y = toNumber(trace.y[i], yType);
        if (!Number.isFinite(y)) continue;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
      yMin = 0; yMax = 1;
    }

    const [xd0, xd1] = xDomainNum;
    const xSpan = xd1 - xd0 || 1;
    const ySpan = yMax - yMin || 1;

    let traceIdx = 0;
    for (const trace of traces) {
      if ((trace.visible ?? true) !== true) { traceIdx++; continue; }
      if (trace.type === "heatmap" || trace.type === "histogram") { traceIdx++; continue; }

      const color = getTraceColor(trace, traceIdx, theme.colors.palette);
      const n = Math.min(trace.x.length, trace.y.length);
      if (n === 0) { traceIdx++; continue; }

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * dpr;
      ctx.globalAlpha = 0.7;

      let started = false;
      for (let i = 0; i < n; i++) {
        const x = toNumber(trace.x[i], xType);
        const y = toNumber(trace.y[i], yType);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const px = pxL + ((x - xd0) / xSpan) * pxW;
        const py = marginY + (1 - (y - yMin) / ySpan) * (h - 2 * marginY);

        if (!started) { ctx.moveTo(px, py); started = true; }
        else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      traceIdx++;
    }
  }

  private updateWindowElements() {
    const x0 = this.plotLeft + this.n0 * this.plotW;
    const x1 = this.plotLeft + this.n1 * this.plotW;
    const hw = 5;

    // Left mask
    this.maskLeft.setAttribute("x", String(this.plotLeft));
    this.maskLeft.setAttribute("width", String(Math.max(0, x0 - this.plotLeft)));

    // Right mask
    this.maskRight.setAttribute("x", String(x1));
    this.maskRight.setAttribute("width", String(Math.max(0, this.plotRight - x1)));

    // Selection window
    this.windowRect.setAttribute("x", String(x0));
    this.windowRect.setAttribute("width", String(Math.max(0, x1 - x0)));

    // Handles
    this.handleLeft.setAttribute("x", String(x0 - hw / 2));
    this.handleRight.setAttribute("x", String(x1 - hw / 2));
  }

  private onMouseDown(e: MouseEvent) {
    const rect = this.svgEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const x0 = this.plotLeft + this.n0 * this.plotW;
    const x1 = this.plotLeft + this.n1 * this.plotW;
    const hw = 8; // larger hit zone than visual

    if (Math.abs(mx - x0) <= hw) {
      this.dragType = "left";
    } else if (Math.abs(mx - x1) <= hw) {
      this.dragType = "right";
    } else if (mx > x0 && mx < x1) {
      this.dragType = "center";
    } else {
      // Click outside: jump window center
      const clickN = (mx - this.plotLeft) / this.plotW;
      const span = this.n1 - this.n0;
      this.n0 = Math.max(0, Math.min(1 - span, clickN - span / 2));
      this.n1 = this.n0 + span;
      this.updateWindowElements();
      this.onRangeChange(this.n0, this.n1);
      return;
    }

    this.dragStartX = e.clientX;
    this.dragStartN0 = this.n0;
    this.dragStartN1 = this.n1;
    e.preventDefault();
    this.windowRect.style.cursor = "grabbing";

    document.addEventListener("mousemove", this.boundOnMouseMove);
    document.addEventListener("mouseup", this.boundOnMouseUp);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.dragType) return;
    const dx = e.clientX - this.dragStartX;
    const dn = dx / this.plotW;
    const minSpan = 0.001;

    if (this.dragType === "left") {
      this.n0 = Math.max(0, Math.min(this.dragStartN1 - minSpan, this.dragStartN0 + dn));
    } else if (this.dragType === "right") {
      this.n1 = Math.min(1, Math.max(this.dragStartN0 + minSpan, this.dragStartN1 + dn));
    } else {
      const span = this.dragStartN1 - this.dragStartN0;
      let newN0 = this.dragStartN0 + dn;
      if (newN0 < 0) newN0 = 0;
      if (newN0 + span > 1) newN0 = 1 - span;
      this.n0 = newN0;
      this.n1 = newN0 + span;
    }

    this.updateWindowElements();
    this.onRangeChange(this.n0, this.n1);
  }

  private onMouseUp(_e: MouseEvent) {
    this.dragType = null;
    this.windowRect.style.cursor = "grab";
    document.removeEventListener("mousemove", this.boundOnMouseMove);
    document.removeEventListener("mouseup", this.boundOnMouseUp);
  }

  destroy() {
    document.removeEventListener("mousemove", this.boundOnMouseMove);
    document.removeEventListener("mouseup", this.boundOnMouseUp);
    this.el.remove();
  }
}
