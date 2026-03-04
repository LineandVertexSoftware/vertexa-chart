import type { ResolvedChartTheme, ResolvedChartA11y, ResolvedChartToolbar } from "./chart-utils.js";
import type {
  ChartExportPngOptions,
  ChartExportSvgOptions,
  ChartExportCsvPointsOptions
} from "./types.js";
import { Toolbar } from "./Toolbar.js";

export type MountedDom = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  svgGrid: SVGSVGElement;
  svg: SVGSVGElement;
  tooltip: HTMLDivElement;
  chartToolbar: Toolbar | null;
};

export type DomMountCallbacks = {
  exportPng(opts?: ChartExportPngOptions): Promise<Blob>;
  exportSvg(opts?: ChartExportSvgOptions): Promise<Blob>;
  exportCsvPoints(opts?: ChartExportCsvPointsOptions): Blob;
  setSize(w: number, h: number): void;
  getSize(): { width: number; height: number };
};

export function mountDom(
  root: HTMLElement,
  opts: {
    width: number;
    height: number;
    theme: ResolvedChartTheme;
    a11y: ResolvedChartA11y;
    toolbarConfig: ResolvedChartToolbar;
  },
  callbacks: DomMountCallbacks,
  handleKeyDown: (e: KeyboardEvent) => void
): MountedDom {
  root.innerHTML = "";

  const container = document.createElement("div");
  container.className = "chart-container";
  Object.assign(container.style, {
    position: "relative",
    width: `${opts.width}px`,
    height: `${opts.height}px`,
    overflow: "hidden",
    background: opts.theme.colors.background,
    color: opts.theme.colors.text,
    fontFamily: opts.theme.fonts.family,
    fontSize: `${opts.theme.fonts.sizePx}px`
  });
  container.tabIndex = opts.a11y.keyboardNavigation ? 0 : -1;
  if (opts.a11y.keyboardNavigation) {
    container.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 F Y L");
    container.addEventListener("keydown", handleKeyDown);
  }

  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    display: "block"
  });

  const svgGrid = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgGrid.setAttribute("width", String(opts.width));
  svgGrid.setAttribute("height", String(opts.height));
  svgGrid.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  svgGrid.setAttribute("preserveAspectRatio", "none");
  svgGrid.setAttribute("aria-hidden", "true");
  svgGrid.classList.add("chart-grid");
  Object.assign((svgGrid as any).style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    display: "block"
  });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(opts.width));
  svg.setAttribute("height", String(opts.height));
  svg.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("chart-overlay");
  Object.assign((svg as any).style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "auto",
    display: "block"
  });

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("role", "status");
  tooltip.setAttribute("aria-live", "polite");
  tooltip.setAttribute("aria-atomic", "true");
  tooltip.setAttribute("aria-hidden", "true");
  Object.assign(tooltip.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    transform: "translate(-9999px,-9999px)",
    pointerEvents: "none",
    background: opts.theme.tooltip.background,
    color: opts.theme.tooltip.textColor,
    padding: `${opts.theme.tooltip.paddingY}px ${opts.theme.tooltip.paddingX}px`,
    borderRadius: `${opts.theme.tooltip.borderRadiusPx}px`,
    fontFamily: opts.theme.tooltip.fontFamily,
    fontSize: `${opts.theme.tooltip.fontSizePx}px`,
    whiteSpace: "nowrap",
    boxShadow: opts.theme.tooltip.boxShadow,
    zIndex: "1000"
  });

  container.appendChild(svgGrid);
  container.appendChild(canvas);
  container.appendChild(svg);
  container.appendChild(tooltip);

  let chartToolbar: Toolbar | null = null;
  if (opts.toolbarConfig.show) {
    chartToolbar = new Toolbar(container, opts.toolbarConfig, opts.theme, opts.a11y, {
      exportPng: (o) => callbacks.exportPng(o),
      exportSvg: (o) => callbacks.exportSvg(o),
      exportCsvPoints: (o) => callbacks.exportCsvPoints(o),
      setSize: (w, h) => callbacks.setSize(w, h),
      getSize: () => callbacks.getSize()
    });
  }

  root.appendChild(container);

  return { container, canvas, svgGrid, svg, tooltip, chartToolbar };
}
