import { WebGPURenderer } from "@lineandvertexsoftware/renderer-webgpu";
import type {
  ChartExportCsvPointsOptions,
  ChartExportPngOptions,
  ChartExportSvgOptions,
  Trace
} from "./types.js";
import type { Padding, ResolvedChartTheme, Zoom } from "./chart-utils.js";
import {
  normalizeExportPixelRatio,
  serializeSvgToDataUrl,
  loadImageFromUrl,
  canvasToPngBlob,
  canvasToPngDataUrl,
  fmtDatum,
  fmtNumber,
  toCsvRow,
  escapeXmlAttribute,
  resolveString,
  serializeSvgMarkup
} from "./chart-utils.js";

export type ExportManagerState = {
  width: number;
  height: number;
  dpr: number;
  padding: Padding;
  zoom: Zoom;
  theme: ResolvedChartTheme;
  traces: Trace[];
};

export class ExportManager {
  constructor(
    private getState: () => ExportManagerState,
    private renderer: WebGPURenderer,
    private getDomElements: () => { canvas: HTMLCanvasElement; svgGrid: SVGSVGElement; svg: SVGSVGElement },
    private waitForInit: () => Promise<void>
  ) {}

  async exportPng(options: ChartExportPngOptions = {}): Promise<Blob> {
    await this.waitForInit();
    const { width, height, theme } = this.getState();

    const pixelRatio = normalizeExportPixelRatio(options.pixelRatio);
    const exportWidth = Math.max(1, Math.round(width * pixelRatio));
    const exportHeight = Math.max(1, Math.round(height * pixelRatio));

    const exportCanvas = this.createExportCanvas(exportWidth, exportHeight);
    const ctx = this.getExport2dContext(exportCanvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const background = resolveString(options.background, theme.colors.background);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, exportWidth, exportHeight);

    await this.drawCanvasLayerToContext(ctx, exportWidth, exportHeight, pixelRatio);

    const { svgGrid, svg } = this.getDomElements();
    if (options.includeGrid ?? true) {
      await this.drawSvgLayerToContext(ctx, svgGrid, exportWidth, exportHeight);
    }
    if (options.includeOverlay ?? true) {
      await this.drawSvgLayerToContext(ctx, svg, exportWidth, exportHeight);
    }

    return canvasToPngBlob(exportCanvas);
  }

  async exportSvg(options: ChartExportSvgOptions = {}): Promise<Blob> {
    await this.waitForInit();
    const { width, height, theme } = this.getState();
    const { svgGrid, svg } = this.getDomElements();

    const pixelRatio = normalizeExportPixelRatio(options.pixelRatio);
    const background = resolveString(options.background, theme.colors.background);
    const includePlot = options.includePlot ?? true;
    const includeGrid = options.includeGrid ?? true;
    const includeOverlay = options.includeOverlay ?? true;

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXmlAttribute(background)}"/>`
    ];

    if (includePlot) {
      const imageHref = await this.captureCanvasLayerDataUrl(pixelRatio);
      const escaped = escapeXmlAttribute(imageHref);
      parts.push(
        `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="${escaped}" xlink:href="${escaped}"/>`
      );
    }
    if (includeGrid) {
      parts.push(this.serializeSvgLayerForExport(svgGrid));
    }
    if (includeOverlay) {
      parts.push(this.serializeSvgLayerForExport(svg));
    }

    parts.push("</svg>");
    return new Blob([parts.join("")], { type: "image/svg+xml;charset=utf-8" });
  }

  exportCsvPoints(options: ChartExportCsvPointsOptions = {}): Blob {
    const { traces } = this.getState();
    const includeHeader = options.includeHeader ?? true;
    const includeHidden = options.includeHidden ?? false;

    const rows: string[] = [];
    if (includeHeader) {
      rows.push("traceIndex,traceName,traceType,pointIndex,x,y,z");
    }

    for (let traceIndex = 0; traceIndex < traces.length; traceIndex++) {
      const trace = traces[traceIndex];
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

      // For histograms, export raw input data (x and/or y arrays).
      if (trace.type === "histogram") {
        const hxs = trace.x ? Array.from(trace.x) : [];
        const hys = trace.y ? Array.from(trace.y) : [];
        const hn = Math.max(hxs.length, hys.length);
        for (let pointIndex = 0; pointIndex < hn; pointIndex++) {
          rows.push(toCsvRow([
            String(traceIndex),
            traceName,
            trace.type,
            String(pointIndex),
            pointIndex < hxs.length ? fmtDatum(hxs[pointIndex]) : "",
            pointIndex < hys.length ? fmtDatum(hys[pointIndex]) : "",
            ""
          ]));
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

  private createExportCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private getExport2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
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
    const { width, height } = this.getState();
    const dataUrl = serializeSvgToDataUrl(svg, width, height);
    const image = await loadImageFromUrl(dataUrl);
    ctx.drawImage(image, 0, 0, exportWidth, exportHeight);
  }

  private serializeSvgLayerForExport(svg: SVGSVGElement): string {
    const { width, height } = this.getState();
    return serializeSvgMarkup(svg, width, height);
  }

  private async captureCanvasLayerDataUrl(pixelRatio: number): Promise<string> {
    const { width, height } = this.getState();
    const exportWidth = Math.max(1, Math.round(width * pixelRatio));
    const exportHeight = Math.max(1, Math.round(height * pixelRatio));
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
    const { width, height, padding, zoom } = this.getState();
    const { canvas } = this.getDomElements();

    const capture = (
      this.renderer as unknown as {
        captureFrameImageData?: (frame: {
          width: number;
          height: number;
          dpr: number;
          padding: Padding;
          zoom: Zoom;
        }) => Promise<ImageData>;
      } | undefined
    )?.captureFrameImageData;

    if (typeof capture === "function") {
      try {
        const imageData = await capture.call(this.renderer, { width, height, dpr: exportDpr, padding, zoom });
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
        const bitmap = await createImageBitmap(canvas);
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
      const blob = await canvasToPngBlob(canvas);
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

    ctx.drawImage(canvas, 0, 0, exportWidth, exportHeight);
  }
}
