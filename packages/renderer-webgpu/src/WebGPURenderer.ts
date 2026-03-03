import { initWebGPU } from "./initDevice.js";
import scatterWGSL from "./shaders/scatter/scatter.wgsl?raw";
import lineWGSL from "./shaders/line/line.wgsl?raw";
import pickWGSL from "./shaders/scatter/scatter_pick.wgsl?raw";
import hoverWGSL from "./shaders/scatter/scatter_hover.wgsl?raw";

export type RendererInit = { canvas: HTMLCanvasElement };

export type FrameState = {
  width: number;
  height: number;
  dpr: number;
  padding: { l: number; r: number; t: number; b: number };
  zoom: { k: number; x: number; y: number };
};

export type MarkerLayerInput = {
  points01: Float32Array; // [x,y] in [0,1]
  pointSizePx: number;    // CSS px
  rgba: [number, number, number, number];
  baseId: number;
};

export type LineLayerInput = {
  points01: Float32Array;
  rgba: [number, number, number, number];
  widthPx?: number;
  dash?: "solid" | "dash" | "dot" | "dashdot" | readonly number[];
};

export type PerformanceStats = {
  lastRenderMs: number;
  lastPickMs: number;
  avgRenderMs: number;
  avgPickMs: number;
  frameCount: number;
  effectiveSampledPoints: number;
};

type MarkerLayerGPU = {
  buf: GPUBuffer;
  count: number;
  capacity: number;   // total allocated points in buf (buf.size / 8)
  firstPoint: number; // ring-buffer offset: logical point 0 is at physical index firstPoint
  pointSizePx: number;
  rgba: [number, number, number, number];
  baseId: number;
};

type LineLayerGPU = {
  buf: GPUBuffer;
  segmentCount: number;
  capacity: number;    // total allocated segments in buf (buf.size / 16)
  firstSegment: number; // GPU draw offset: first valid segment in buf
  rgba: [number, number, number, number];
  widthPx: number;
  dashPattern: [number, number, number, number];
  dashCount: number;
};

export class WebGPURenderer {
  private canvas!: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  private scatterPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private hoverPipeline!: GPURenderPipeline;

  private hoverUniformsBuf!: GPUBuffer;
  private hoverBindGroup!: GPUBindGroup;

  private quadBuf!: GPUBuffer;
  private lineQuadBuf!: GPUBuffer;

  private markerLayers: MarkerLayerGPU[] = [];
  private lineLayers: LineLayerGPU[] = [];

  // ---- Per-layer uniform buffers (FIX for color issue) ----
  private markerUniformsBufs: GPUBuffer[] = [];
  private markerBindGroups: GPUBindGroup[] = [];
  private lineUniformsBufs: GPUBuffer[] = [];
  private lineBindGroups: GPUBindGroup[] = [];

  // ---- pick ----
  private pickPipeline!: GPURenderPipeline;
  private pickUniformsBufs: GPUBuffer[] = [];   // Pool of buffers, one per layer
  private pickBindGroups: GPUBindGroup[] = [];  // Corresponding bind groups
  private pickTex!: GPUTexture;
  private pickTexW = 0;
  private pickTexH = 0;
  private pickReadback!: GPUBuffer;
  private pickReadbackSize = 0;

  // ---- hover highlight ----
  private hoverBuf!: GPUBuffer;
  private hoverActive = false;
  private hoverInnerRgba: [number, number, number, number] = [0, 0, 0, 0];
  private hoverOutlineRgba: [number, number, number, number] = [0, 0, 0, 0];
  private hoverSizePx = 6;

  // ---- LOD ----
  private enableLOD = true;
  private lodThreshold = 50000; // Start LOD when total points > this

  // ---- Performance stats ----
  private stats: PerformanceStats = {
    lastRenderMs: 0,
    avgRenderMs: 0,
    lastPickMs: 0,
    avgPickMs: 0,
    frameCount: 0,
    effectiveSampledPoints: 0
  };
  private renderTimes: number[] = [];
  private pickTimes: number[] = [];
  private maxTimeSamples = 60;

  async mount(init: RendererInit) {
    this.canvas = init.canvas;
    const { device, context, format } = await initWebGPU(this.canvas);
    this.device = device;
    this.context = context;
    this.format = format;

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied"
    });

    this.createPipelines();
    this.createQuadBuffer();
    this.createLineQuadBuffer();
    this.createHoverBuffer();
    this.createUniforms();
  }

  setLayers(scene: { markers: MarkerLayerInput[]; lines: LineLayerInput[] }) {
    // Clean up old marker resources
    for (const m of this.markerLayers) m.buf.destroy();
    for (const buf of this.markerUniformsBufs) buf.destroy();
    this.markerLayers = [];
    this.markerUniformsBufs = [];
    this.markerBindGroups = [];

    // Clean up old line resources
    for (const l of this.lineLayers) l.buf.destroy();
    for (const buf of this.lineUniformsBufs) buf.destroy();
    this.lineLayers = [];
    this.lineUniformsBufs = [];
    this.lineBindGroups = [];

    // Clean up old pick uniforms/bind groups (bind groups reference marker buffers)
    for (const buf of this.pickUniformsBufs) buf?.destroy();
    this.pickUniformsBufs = [];
    this.pickBindGroups = [];
    this.pickLayerBufs = [];

    // Create marker layers with per-layer uniform buffers
    for (const m of scene.markers) {
      const count = m.points01.length / 2;
      const capacity = Math.max(count * 2, 64);
      const buf = this.device.createBuffer({
        size: capacity * 8, // 2 floats × 4 bytes per point
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
      this.device.queue.writeBuffer(buf, 0, m.points01.buffer, m.points01.byteOffset, m.points01.byteLength);
      this.markerLayers.push({ buf, count, capacity, firstPoint: 0, pointSizePx: m.pointSizePx, rgba: m.rgba, baseId: m.baseId });

      // Create dedicated uniform buffer for this layer
      const uniformBuf = this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.markerUniformsBufs.push(uniformBuf);

      const bindGroup = this.device.createBindGroup({
        layout: this.scatterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: { buffer: buf } }
        ]
      });
      this.markerBindGroups.push(bindGroup);
    }

    // Create line layers with per-layer uniform buffers
    for (const l of scene.lines) {
      const segments = this.buildLineSegments(l.points01);
      const segmentCount = segments.length / 4;
      if (segmentCount < 1) continue;

      const capacity = Math.max(segmentCount * 2, 64);
      const buf = this.device.createBuffer({
        size: capacity * 16, // 4 floats × 4 bytes per segment
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
      this.device.queue.writeBuffer(buf, 0, segments.buffer, segments.byteOffset, segments.byteLength);

      const { dashPattern, dashCount } = this.resolveDashPattern(l.dash);
      this.lineLayers.push({
        buf,
        segmentCount,
        capacity,
        firstSegment: 0,
        rgba: l.rgba,
        widthPx: Math.max(0.5, l.widthPx ?? 1),
        dashPattern,
        dashCount
      });

      // Create dedicated uniform buffer for this layer
      const uniformBuf = this.device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.lineUniformsBufs.push(uniformBuf);

      const bindGroup = this.device.createBindGroup({
        layout: this.linePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuf } }]
      });
      this.lineBindGroups.push(bindGroup);
    }
  }

  setHoverHighlight(args: null | {
    point01: [number, number];
    sizePx?: number;
    innerRgba: [number, number, number, number];
    outlineRgba?: [number, number, number, number];
  }) {
    if (!args) {
      this.hoverActive = false;
      return;
    }
    this.hoverActive = true;
    this.hoverSizePx = args.sizePx ?? 7;
    this.hoverInnerRgba = args.innerRgba;
    this.hoverOutlineRgba = args.outlineRgba ?? [0, 0, 0, 0.55];

    const a = new Float32Array([args.point01[0], args.point01[1]]);
    this.device.queue.writeBuffer(this.hoverBuf, 0, a);
  }

  setLOD(enabled: boolean) {
    this.enableLOD = enabled;
  }

  getStats(): PerformanceStats {
    return { ...this.stats };
  }

  destroy() {
    for (const m of this.markerLayers) m.buf.destroy();
    for (const l of this.lineLayers) l.buf.destroy();
    for (const buf of this.markerUniformsBufs) buf.destroy();
    for (const buf of this.lineUniformsBufs) buf.destroy();
    for (const buf of this.pickUniformsBufs) buf.destroy();

    (this.hoverUniformsBuf as GPUBuffer | undefined)?.destroy?.();
    (this.quadBuf as GPUBuffer | undefined)?.destroy?.();
    (this.lineQuadBuf as GPUBuffer | undefined)?.destroy?.();
    (this.hoverBuf as GPUBuffer | undefined)?.destroy?.();

    (this.pickTex as GPUTexture | undefined)?.destroy?.();
    if ((this.pickReadback as GPUBuffer | undefined)) {
      try {
        if (this.pickReadback.mapState === "mapped") {
          this.pickReadback.unmap();
        }
      } catch {
        // best-effort cleanup
      }
      this.pickReadback.destroy();
    }

    (this.context as GPUCanvasContext | undefined)?.unconfigure?.();

    this.markerLayers = [];
    this.lineLayers = [];
    this.markerUniformsBufs = [];
    this.markerBindGroups = [];
    this.lineUniformsBufs = [];
    this.lineBindGroups = [];
    this.pickUniformsBufs = [];
    this.pickBindGroups = [];
    this.pickTexW = 0;
    this.pickTexH = 0;
    this.pickReadbackSize = 0;
    this.hoverActive = false;
    this.renderTimes = [];
    this.pickTimes = [];
  }

  render(frame: FrameState) {
    const t0 = performance.now();

    const w = Math.max(1, Math.floor(frame.width * frame.dpr));
    const h = Math.max(1, Math.floor(frame.height * frame.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
    }

    const plotW = Math.max(1, frame.width - frame.padding.l - frame.padding.r);
    const plotH = Math.max(1, frame.height - frame.padding.t - frame.padding.b);

    const canvasSize = [w, h] as const;
    const plotOrigin = [frame.padding.l * frame.dpr, frame.padding.t * frame.dpr] as const;
    const plotSize = [plotW * frame.dpr, plotH * frame.dpr] as const;
    const zoom = [frame.zoom.k, frame.zoom.x * frame.dpr, frame.zoom.y * frame.dpr] as const;

    // Calculate LOD stride based on zoom level
    const totalPoints = this.markerLayers.reduce((sum, l) => sum + l.count, 0);
    const lodStride = this.calculateLODStride(totalPoints, frame.zoom.k);

    const view = this.context.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          // Transparent clear so SVG grid underlay remains visible beneath traces.
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });
    pass.setScissorRect(
      Math.floor(frame.padding.l * frame.dpr),      // x
      Math.floor(frame.padding.t * frame.dpr),      // y
      Math.floor(plotW * frame.dpr),                 // width
      Math.floor(plotH * frame.dpr)                  // height
    );
    
    // Lines - now using per-layer bind groups
    for (let i = 0; i < this.lineLayers.length; i++) {
      const layer = this.lineLayers[i];
      if (layer.segmentCount < 1) continue;

      this.writeLineUniformsToBuffer(this.lineUniformsBufs[i], {
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        lineWidthPx: layer.widthPx * frame.dpr,
        rgba: layer.rgba,
        dashPattern: [
          layer.dashPattern[0] * frame.dpr,
          layer.dashPattern[1] * frame.dpr,
          layer.dashPattern[2] * frame.dpr,
          layer.dashPattern[3] * frame.dpr
        ],
        dashCount: layer.dashCount
      });
      
      pass.setBindGroup(0, this.lineBindGroups[i]);
      pass.setPipeline(this.linePipeline);
      pass.setVertexBuffer(0, this.lineQuadBuf);
      pass.setVertexBuffer(1, layer.buf);
      pass.draw(6, layer.segmentCount, 0, layer.firstSegment);
    }

    let effectiveSampledPoints = 0;

    // Markers with LOD - now using per-layer bind groups
    for (let i = 0; i < this.markerLayers.length; i++) {
      const layer = this.markerLayers[i];
      if (layer.count < 1) continue;

      this.writeUniformsToBuffer(this.markerUniformsBufs[i], {
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        pointSizePx: layer.pointSizePx * frame.dpr,
        rgba: layer.rgba,
        pointCount: layer.count,
        lodStride,
        lodOffset: this.calculateLODOffset(layer.baseId, lodStride),
        firstPoint: layer.firstPoint
      });
      
      pass.setBindGroup(0, this.markerBindGroups[i]);
      pass.setPipeline(this.scatterPipeline);
      pass.setVertexBuffer(0, this.quadBuf);
      
      // Apply LOD by reducing instance count
      const lodOffset = this.calculateLODOffset(layer.baseId, lodStride);
      const instanceCount = this.calculateLODInstanceCount(layer.count, lodStride, lodOffset);
      effectiveSampledPoints += instanceCount;
      pass.draw(6, instanceCount, 0, 0);
    }

    // Hover highlight on top (single pass with ring shader)
    if (this.hoverActive) {
      this.writeHoverUniforms({
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        pointSizePx: this.hoverSizePx * frame.dpr,
        innerRgba: this.hoverInnerRgba,
        outlineRgba: this.hoverOutlineRgba
      });
      pass.setBindGroup(0, this.hoverBindGroup);
      pass.setPipeline(this.hoverPipeline);
      pass.setVertexBuffer(0, this.quadBuf);
      pass.setVertexBuffer(1, this.hoverBuf);
      pass.draw(6, 1, 0, 0);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // Update stats
    const elapsed = performance.now() - t0;
    this.stats.lastRenderMs = elapsed;
    this.stats.frameCount++;
    this.stats.effectiveSampledPoints = effectiveSampledPoints;
    this.renderTimes.push(elapsed);
    if (this.renderTimes.length > this.maxTimeSamples) this.renderTimes.shift();
    this.stats.avgRenderMs = this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length;
  }

  async captureFrameImageData(frame: FrameState): Promise<ImageData> {
    const w = Math.max(1, Math.floor(frame.width * frame.dpr));
    const h = Math.max(1, Math.floor(frame.height * frame.dpr));

    const targetTex = this.device.createTexture({
      size: { width: w, height: h },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const readback = this.device.createBuffer({
      size: bytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const plotW = Math.max(1, frame.width - frame.padding.l - frame.padding.r);
    const plotH = Math.max(1, frame.height - frame.padding.t - frame.padding.b);
    const canvasSize = [w, h] as const;
    const plotOrigin = [frame.padding.l * frame.dpr, frame.padding.t * frame.dpr] as const;
    const plotSize = [plotW * frame.dpr, plotH * frame.dpr] as const;
    const zoom = [frame.zoom.k, frame.zoom.x * frame.dpr, frame.zoom.y * frame.dpr] as const;
    const totalPoints = this.markerLayers.reduce((sum, l) => sum + l.count, 0);
    const lodStride = this.calculateLODStride(totalPoints, frame.zoom.k);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetTex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    pass.setScissorRect(
      Math.floor(frame.padding.l * frame.dpr),
      Math.floor(frame.padding.t * frame.dpr),
      Math.floor(plotW * frame.dpr),
      Math.floor(plotH * frame.dpr)
    );

    for (let i = 0; i < this.lineLayers.length; i++) {
      const layer = this.lineLayers[i];
      if (layer.segmentCount < 1) continue;

      this.writeLineUniformsToBuffer(this.lineUniformsBufs[i], {
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        lineWidthPx: layer.widthPx * frame.dpr,
        rgba: layer.rgba,
        dashPattern: [
          layer.dashPattern[0] * frame.dpr,
          layer.dashPattern[1] * frame.dpr,
          layer.dashPattern[2] * frame.dpr,
          layer.dashPattern[3] * frame.dpr
        ],
        dashCount: layer.dashCount
      });

      pass.setBindGroup(0, this.lineBindGroups[i]);
      pass.setPipeline(this.linePipeline);
      pass.setVertexBuffer(0, this.lineQuadBuf);
      pass.setVertexBuffer(1, layer.buf);
      pass.draw(6, layer.segmentCount, 0, layer.firstSegment);
    }

    for (let i = 0; i < this.markerLayers.length; i++) {
      const layer = this.markerLayers[i];
      if (layer.count < 1) continue;
      const lodOffset = this.calculateLODOffset(layer.baseId, lodStride);

      this.writeUniformsToBuffer(this.markerUniformsBufs[i], {
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        pointSizePx: layer.pointSizePx * frame.dpr,
        rgba: layer.rgba,
        pointCount: layer.count,
        lodStride,
        lodOffset,
        firstPoint: layer.firstPoint
      });

      pass.setBindGroup(0, this.markerBindGroups[i]);
      pass.setPipeline(this.scatterPipeline);
      pass.setVertexBuffer(0, this.quadBuf);
      pass.draw(6, this.calculateLODInstanceCount(layer.count, lodStride, lodOffset), 0, 0);
    }

    if (this.hoverActive) {
      this.writeHoverUniforms({
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        pointSizePx: this.hoverSizePx * frame.dpr,
        innerRgba: this.hoverInnerRgba,
        outlineRgba: this.hoverOutlineRgba
      });
      pass.setBindGroup(0, this.hoverBindGroup);
      pass.setPipeline(this.hoverPipeline);
      pass.setVertexBuffer(0, this.quadBuf);
      pass.setVertexBuffer(1, this.hoverBuf);
      pass.draw(6, 1, 0, 0);
    }

    pass.end();
    encoder.copyTextureToBuffer(
      { texture: targetTex, origin: { x: 0, y: 0 } },
      { buffer: readback, bytesPerRow },
      { width: w, height: h }
    );
    this.device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readback.getMappedRange());
    const rgba = new Uint8ClampedArray(w * h * 4);
    const isBgra = String(this.format).startsWith("bgra8");

    for (let y = 0; y < h; y++) {
      const rowOffset = y * bytesPerRow;
      const outOffset = y * w * 4;
      for (let x = 0; x < w; x++) {
        const src = rowOffset + x * 4;
        const dst = outOffset + x * 4;
        if (isBgra) {
          rgba[dst + 0] = mapped[src + 2];
          rgba[dst + 1] = mapped[src + 1];
          rgba[dst + 2] = mapped[src + 0];
          rgba[dst + 3] = mapped[src + 3];
        } else {
          rgba[dst + 0] = mapped[src + 0];
          rgba[dst + 1] = mapped[src + 1];
          rgba[dst + 2] = mapped[src + 2];
          rgba[dst + 3] = mapped[src + 3];
        }
      }
    }

    readback.unmap();
    readback.destroy();
    targetTex.destroy();
    return new ImageData(rgba, w, h);
  }

  async pick(frame: FrameState, xCss: number, yCss: number): Promise<number> {
    const t0 = performance.now();

    const W = 5;
    const H = 5;
    this.ensurePickTarget(W, H);
    const bytesPerRow = this.ensurePickReadback(W, H);

    const encoder = this.device.createCommandEncoder();
    const view = this.pickTex.createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });

    const plotW = Math.max(1, frame.width - frame.padding.l - frame.padding.r);
    const plotH = Math.max(1, frame.height - frame.padding.t - frame.padding.b);

    const cx = Math.floor(xCss * frame.dpr);
    const cy = Math.floor(yCss * frame.dpr);
    const hw = Math.floor(W / 2);
    const hh = Math.floor(H / 2);

    const canvasSize = [W, H] as const;
    const plotOriginX = (frame.padding.l * frame.dpr) - (cx - hw);
    const plotOriginY = (frame.padding.t * frame.dpr) - (cy - hh);
    const plotOrigin = [plotOriginX, plotOriginY] as const;
    const plotSize = [plotW * frame.dpr, plotH * frame.dpr] as const;
    const zoom = [frame.zoom.k, frame.zoom.x * frame.dpr, frame.zoom.y * frame.dpr] as const;

    const totalPoints = this.markerLayers.reduce((sum, l) => sum + l.count, 0);
    const lodStride = this.calculateLODStride(totalPoints, frame.zoom.k);

    for (let i = 0; i < this.markerLayers.length; i++) {
      const layer = this.markerLayers[i];
      if (layer.count < 1) continue;
      const lodOffset = this.calculateLODOffset(layer.baseId, lodStride);

      const { buffer, bindGroup } = this.ensurePickBuffer(i, layer.buf);
      this.writePickUniforms(buffer, {
        canvasSize,
        plotOrigin,
        plotSize,
        zoom,
        pointSizePx: layer.pointSizePx * frame.dpr,
        baseId: layer.baseId,
        pointCount: layer.count,
        lodStride,
        lodOffset,
        firstPoint: layer.firstPoint
      });

      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(this.pickPipeline);
      pass.setVertexBuffer(0, this.quadBuf);

      const instanceCount = this.calculateLODInstanceCount(layer.count, lodStride, lodOffset);
      pass.draw(6, instanceCount, 0, 0);
    }

    pass.end();

    encoder.copyTextureToBuffer(
      { texture: this.pickTex, origin: { x: 0, y: 0 } },
      { buffer: this.pickReadback, bytesPerRow },
      { width: W, height: H }
    );

    this.device.queue.submit([encoder.finish()]);

    await this.pickReadback.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(this.pickReadback.getMappedRange().slice(0));
    this.pickReadback.unmap();

    const centerIdx = (Math.floor(H / 2)) * bytesPerRow + (Math.floor(W / 2)) * 4;
    const r = data[centerIdx];
    const g = data[centerIdx + 1];
    const b = data[centerIdx + 2];
    const id = r | (g << 8) | (b << 16);

    // Update stats
    const elapsed = performance.now() - t0;
    this.stats.lastPickMs = elapsed;
    this.pickTimes.push(elapsed);
    if (this.pickTimes.length > this.maxTimeSamples) this.pickTimes.shift();
    this.stats.avgPickMs = this.pickTimes.reduce((a, b) => a + b, 0) / this.pickTimes.length;

    return id;
  }

  private calculateLODStride(totalPoints: number, zoomK: number): number {
    if (!this.enableLOD || totalPoints <= this.lodThreshold) return 1;

    const baseStride = Math.ceil(totalPoints / this.lodThreshold);
    const zoomAdjusted = Math.max(1, Math.ceil(baseStride / zoomK));
    return Math.max(1, zoomAdjusted);
  }

  private calculateLODOffset(baseId: number, stride: number): number {
    if (stride <= 1) return 0;
    const hash = ((baseId >>> 0) * 2654435761) >>> 0;
    return hash % stride;
  }

  private calculateLODInstanceCount(total: number, stride: number, offset: number): number {
    if (total <= 0) return 0;
    if (stride <= 1) return total;
    if (offset >= total) return 0;
    return Math.floor((total - 1 - offset) / stride) + 1;
  }

  // ----------------------------
  // Pipelines
  // ----------------------------

  private createPipelines() {
    // Scatter pipeline
    {
      const module = this.device.createShaderModule({ code: scatterWGSL });
      this.scatterPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 2 * 4,
              stepMode: "vertex",
              attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
            }
          ]
        },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [
            {
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
              }
            }
          ]
        },
        primitive: { topology: "triangle-list" }
      });
    }

    // Line pipeline
    {
      const module = this.device.createShaderModule({ code: lineWGSL });
      this.linePipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 2 * 4,
              stepMode: "vertex",
              attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
            },
            {
              arrayStride: 4 * 4,
              stepMode: "instance",
              attributes: [
                { shaderLocation: 1, offset: 0, format: "float32x2" },
                { shaderLocation: 2, offset: 2 * 4, format: "float32x2" }
              ]
            }
          ]
        },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [
            {
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
              }
            }
          ]
        },
        primitive: { topology: "triangle-list" }
      });
    }

    // Hover pipeline (ring shader)
    {
      const module = this.device.createShaderModule({ code: hoverWGSL });
      this.hoverPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 2 * 4,
              stepMode: "vertex",
              attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
            },
            {
              arrayStride: 2 * 4,
              stepMode: "instance",
              attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }]
            }
          ]
        },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [
            {
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
              }
            }
          ]
        },
        primitive: { topology: "triangle-list" }
      });
    }

    // Pick pipeline -> rgba8unorm offscreen
    {
      const module = this.device.createShaderModule({ code: pickWGSL });
      this.pickPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 2 * 4,
              stepMode: "vertex",
              attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
            }
          ]
        },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [{ format: "rgba8unorm" }]
        },
        primitive: { topology: "triangle-list" }
      });

      // Pick uniform buffers created dynamically per-layer in ensurePickBuffer()

    }
  }

  private createQuadBuffer() {
    const quad = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
       0.5,  0.5,
      -0.5, -0.5,
       0.5,  0.5,
      -0.5,  0.5
    ]);

    this.quadBuf = this.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.quadBuf, 0, quad);
  }

  private createLineQuadBuffer() {
    const quad = new Float32Array([
      0, -1,
      1, -1,
      1,  1,
      0, -1,
      1,  1,
      0,  1
    ]);

    this.lineQuadBuf = this.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(this.lineQuadBuf, 0, quad);
  }

  private createHoverBuffer() {
    this.hoverBuf = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  private createUniforms() {
    // Hover uniform buffer - 80 bytes for inner + outline colors
    this.hoverUniformsBuf = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.hoverBindGroup = this.device.createBindGroup({
      layout: this.hoverPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.hoverUniformsBuf } }]
    });
  }

  // Write uniforms to a specific buffer (used for per-layer rendering)
  private writeUniformsToBuffer(buffer: GPUBuffer, args: {
    canvasSize: readonly [number, number];
    plotOrigin: readonly [number, number];
    plotSize: readonly [number, number];
    zoom: readonly [number, number, number];
    pointSizePx: number;
    rgba: readonly [number, number, number, number];
    pointCount?: number;
    lodStride?: number;
    lodOffset?: number;
    firstPoint?: number;
  }) {
    // Updated to match new shader layout with proper vec3 alignment
    const u = new Float32Array(20);

    // 0..1  canvasSize (offset 0)
    u[0] = args.canvasSize[0]; 
    u[1] = args.canvasSize[1];

    // 2..3  plotOrigin (offset 8)
    u[2] = args.plotOrigin[0]; 
    u[3] = args.plotOrigin[1];

    // 4..5  plotSize (offset 16)
    u[4] = args.plotSize[0];   
    u[5] = args.plotSize[1];

    // 6..7  padding (offset 24) - NEW! For vec3 alignment
    u[6] = 0;
    u[7] = 0;

    // 8..10 zoom (vec3, offset 32) - NOW PROPERLY ALIGNED!
    u[8] = args.zoom[0]; 
    u[9] = args.zoom[1]; 
    u[10] = args.zoom[2];

    // 11 pointSizePx (offset 44)
    u[11] = args.pointSizePx;

    // 12..15 rgba (vec4, offset 48)
    u[12] = args.rgba[0];
    u[13] = args.rgba[1];
    u[14] = args.rgba[2];
    u[15] = args.rgba[3];

    const u32 = new Uint32Array(u.buffer);
    u32[16] = args.pointCount ?? 0;
    u32[17] = args.lodStride ?? 1;
    u32[18] = args.lodOffset ?? 0;
    u32[19] = args.firstPoint ?? 0;

    this.device.queue.writeBuffer(buffer, 0, u);
  }

  private writeLineUniformsToBuffer(buffer: GPUBuffer, args: {
    canvasSize: readonly [number, number];
    plotOrigin: readonly [number, number];
    plotSize: readonly [number, number];
    zoom: readonly [number, number, number];
    lineWidthPx: number;
    rgba: readonly [number, number, number, number];
    dashPattern: readonly [number, number, number, number];
    dashCount: number;
  }) {
    const u = new Float32Array(24);

    u[0] = args.canvasSize[0];
    u[1] = args.canvasSize[1];
    u[2] = args.plotOrigin[0];
    u[3] = args.plotOrigin[1];
    u[4] = args.plotSize[0];
    u[5] = args.plotSize[1];
    u[6] = 0;
    u[7] = 0;
    u[8] = args.zoom[0];
    u[9] = args.zoom[1];
    u[10] = args.zoom[2];
    u[11] = args.lineWidthPx;

    u[12] = args.rgba[0];
    u[13] = args.rgba[1];
    u[14] = args.rgba[2];
    u[15] = args.rgba[3];

    u[16] = args.dashPattern[0];
    u[17] = args.dashPattern[1];
    u[18] = args.dashPattern[2];
    u[19] = args.dashPattern[3];

    u[20] = args.dashCount;
    u[21] = 0;
    u[22] = 0;
    u[23] = 0;

    this.device.queue.writeBuffer(buffer, 0, u);
  }

  private writeHoverUniforms(args: {
    canvasSize: readonly [number, number];
    plotOrigin: readonly [number, number];
    plotSize: readonly [number, number];
    zoom: readonly [number, number, number];
    pointSizePx: number;
    innerRgba: readonly [number, number, number, number];
    outlineRgba: readonly [number, number, number, number];
  }) {
    const u = new Float32Array(20);

    u[0] = args.canvasSize[0]; 
    u[1] = args.canvasSize[1];
    u[2] = args.plotOrigin[0]; 
    u[3] = args.plotOrigin[1];
    u[4] = args.plotSize[0];   
    u[5] = args.plotSize[1];
    u[6] = 0; // padding
    u[7] = 0;
    u[8] = args.zoom[0]; 
    u[9] = args.zoom[1]; 
    u[10] = args.zoom[2];
    u[11] = args.pointSizePx;

    // Inner color (offset 48)
    u[12] = args.innerRgba[0];
    u[13] = args.innerRgba[1];
    u[14] = args.innerRgba[2];
    u[15] = args.innerRgba[3];

    // Outline color (offset 64)
    u[16] = args.outlineRgba[0];
    u[17] = args.outlineRgba[1];
    u[18] = args.outlineRgba[2];
    u[19] = args.outlineRgba[3];

    this.device.queue.writeBuffer(this.hoverUniformsBuf, 0, u);
  }

  private resolveDashPattern(dash: LineLayerInput["dash"]): {
    dashPattern: [number, number, number, number];
    dashCount: number;
  } {
    if (!dash || dash === "solid") {
      return { dashPattern: [0, 0, 0, 0], dashCount: 0 };
    }

    if (dash === "dash") {
      return { dashPattern: [8, 6, 0, 0], dashCount: 2 };
    }
    if (dash === "dot") {
      return { dashPattern: [2, 4, 0, 0], dashCount: 2 };
    }
    if (dash === "dashdot") {
      return { dashPattern: [8, 4, 2, 4], dashCount: 4 };
    }

    const cleaned = dash
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .slice(0, 4);

    if (cleaned.length === 0) {
      return { dashPattern: [0, 0, 0, 0], dashCount: 0 };
    }
    if (cleaned.length === 1) {
      return { dashPattern: [cleaned[0], cleaned[0], 0, 0], dashCount: 2 };
    }

    const dashPattern: [number, number, number, number] = [
      cleaned[0] ?? 0,
      cleaned[1] ?? 0,
      cleaned[2] ?? 0,
      cleaned[3] ?? 0
    ];
    const dashCount = cleaned.length;
    return { dashPattern, dashCount };
  }

  /**
   * Append new normalized points to an existing marker layer, O(nNew) in the common case.
   * Handles capacity growth by GPU-side buffer copy + reallocation when needed.
   */
  appendToMarkerLayer(layerIdx: number, newPoints01: Float32Array, trimCount: number) {
    const layer = this.markerLayers[layerIdx];
    if (!layer) return;

    const nNew = newPoints01.length / 2;
    const newFirstPoint = layer.firstPoint + trimCount;
    const newCount = layer.count - trimCount + nNew;
    const endPos = newFirstPoint + newCount; // = layer.firstPoint + layer.count + nNew

    if (endPos <= layer.capacity) {
      // Fast path: write new points directly at the end of the live window
      const writeByteOffset = (layer.firstPoint + layer.count) * 8;
      this.device.queue.writeBuffer(layer.buf, writeByteOffset, newPoints01.buffer, newPoints01.byteOffset, newPoints01.byteLength);
      layer.firstPoint = newFirstPoint;
      layer.count = newCount;
    } else {
      // Overflow: reallocate with 2× the new window size
      const newCapacity = Math.max(newCount * 2, 64);
      const newBuf = this.device.createBuffer({
        size: newCapacity * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
      // GPU-side copy of the existing live window (firstPoint..firstPoint+count-trimCount)
      const liveCount = layer.count - trimCount;
      if (liveCount > 0) {
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(layer.buf, newFirstPoint * 8, newBuf, 0, liveCount * 8);
        this.device.queue.submit([encoder.finish()]);
      }
      // Append new points after the copied window
      this.device.queue.writeBuffer(newBuf, liveCount * 8, newPoints01.buffer, newPoints01.byteOffset, newPoints01.byteLength);

      // Update bind groups referencing the old buf
      const newUniformBuf = this.markerUniformsBufs[layerIdx];
      const newBindGroup = this.device.createBindGroup({
        layout: this.scatterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: newUniformBuf } },
          { binding: 1, resource: { buffer: newBuf } }
        ]
      });
      this.markerBindGroups[layerIdx] = newBindGroup;

      layer.buf.destroy();
      layer.buf = newBuf;
      layer.capacity = newCapacity;
      layer.firstPoint = 0;
      layer.count = newCount;

      // Invalidate the stale pick bind group (it referenced the old buf)
      if (this.pickUniformsBufs[layerIdx]) {
        this.pickUniformsBufs[layerIdx].destroy();
        this.pickUniformsBufs[layerIdx] = undefined!;
        this.pickBindGroups[layerIdx] = undefined!;
        this.pickLayerBufs[layerIdx] = undefined!;
      }
    }
  }

  /**
   * Append new line segments to an existing line layer, O(nNewSegs) in the common case.
   * Uses firstInstance-based offset to avoid shifting data on trim.
   */
  appendToLineLayer(layerIdx: number, newSegments: Float32Array, trimCount: number) {
    const layer = this.lineLayers[layerIdx];
    if (!layer) return;

    const nNew = newSegments.length / 4;
    const newFirstSegment = layer.firstSegment + trimCount;
    const newSegmentCount = layer.segmentCount - trimCount + nNew;
    const endPos = newFirstSegment + newSegmentCount; // = firstSegment + segmentCount + nNew

    if (endPos <= layer.capacity) {
      // Fast path: append new segments at the tail of the live window
      const writeByteOffset = (layer.firstSegment + layer.segmentCount) * 16;
      this.device.queue.writeBuffer(layer.buf, writeByteOffset, newSegments.buffer, newSegments.byteOffset, newSegments.byteLength);
      layer.firstSegment = newFirstSegment;
      layer.segmentCount = newSegmentCount;
    } else {
      // Overflow: reallocate
      const newCapacity = Math.max(newSegmentCount * 2, 64);
      const newBuf = this.device.createBuffer({
        size: newCapacity * 16,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
      const liveSeg = layer.segmentCount - trimCount;
      if (liveSeg > 0) {
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(layer.buf, newFirstSegment * 16, newBuf, 0, liveSeg * 16);
        this.device.queue.submit([encoder.finish()]);
      }
      this.device.queue.writeBuffer(newBuf, liveSeg * 16, newSegments.buffer, newSegments.byteOffset, newSegments.byteLength);

      layer.buf.destroy();
      layer.buf = newBuf;
      layer.capacity = newCapacity;
      layer.firstSegment = 0;
      layer.segmentCount = newSegmentCount;
    }
  }

  /** Update the baseId for a marker layer (called after count changes to avoid id collisions). */
  updateMarkerLayerBaseId(layerIdx: number, newBaseId: number) {
    const layer = this.markerLayers[layerIdx];
    if (layer) layer.baseId = newBaseId;
  }

  private buildLineSegments(points01: Float32Array): Float32Array {
    const n = Math.floor(points01.length / 2);
    if (n < 2) return new Float32Array(0);

    const out = new Float32Array((n - 1) * 4);
    let oi = 0;

    for (let i = 0; i < n - 1; i++) {
      const ax = points01[i * 2 + 0];
      const ay = points01[i * 2 + 1];
      const bx = points01[(i + 1) * 2 + 0];
      const by = points01[(i + 1) * 2 + 1];
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;

      out[oi + 0] = ax;
      out[oi + 1] = ay;
      out[oi + 2] = bx;
      out[oi + 3] = by;
      oi += 4;
    }

    if (oi === out.length) return out;
    return out.slice(0, oi);
  }

  private ensurePickTarget(w: number, h: number) {
    if (this.pickTex && this.pickTexW === w && this.pickTexH === h) return;
    this.pickTex?.destroy?.();
    this.pickTexW = w;
    this.pickTexH = h;
    this.pickTex = this.device.createTexture({
      size: { width: w, height: h },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
  }

  private ensurePickReadback(w: number, h: number) {
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const requiredSize = bytesPerRow * h;
    if (this.pickReadback && this.pickReadbackSize >= requiredSize) return bytesPerRow;

    this.pickReadback?.destroy?.();
    this.pickReadbackSize = requiredSize;
    this.pickReadback = this.device.createBuffer({
      size: requiredSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    return bytesPerRow;
  }

  private pickLayerBufs: GPUBuffer[] = []; // tracks which layer buf each pick bind group was built for

  private ensurePickBuffer(index: number, layerBuf: GPUBuffer): { buffer: GPUBuffer; bindGroup: GPUBindGroup } {
    // Invalidate if the layer data buffer was reallocated
    if (this.pickLayerBufs[index] !== layerBuf && this.pickUniformsBufs[index]) {
      this.pickUniformsBufs[index].destroy();
      this.pickUniformsBufs[index] = undefined!;
      this.pickBindGroups[index] = undefined!;
    }
    if (!this.pickUniformsBufs[index]) {
      const buffer = this.device.createBuffer({
        size: 80, // extended from 64 to 80 to hold firstPoint + 3 pads
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const bindGroup = this.device.createBindGroup({
        layout: this.pickPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: { buffer: layerBuf } }
        ]
      });
      this.pickUniformsBufs[index] = buffer;
      this.pickBindGroups[index] = bindGroup;
      this.pickLayerBufs[index] = layerBuf;
    }
    return {
      buffer: this.pickUniformsBufs[index],
      bindGroup: this.pickBindGroups[index]
    };
  }

  private writePickUniforms(buffer: GPUBuffer, args: {
    canvasSize: readonly [number, number];
    plotOrigin: readonly [number, number];
    plotSize: readonly [number, number];
    zoom: readonly [number, number, number];
    pointSizePx: number;
    baseId: number;
    pointCount: number;
    lodStride: number;
    lodOffset: number;
    firstPoint: number;
  }) {
    const f = new Float32Array(20); // 80 bytes to match extended PickUniforms struct

    f[0] = args.canvasSize[0];
    f[1] = args.canvasSize[1];
    f[2] = args.plotOrigin[0];
    f[3] = args.plotOrigin[1];
    f[4] = args.plotSize[0];
    f[5] = args.plotSize[1];
    f[6] = 0; // padding
    f[7] = 0;
    f[8] = args.zoom[0];
    f[9] = args.zoom[1];
    f[10] = args.zoom[2];
    f[11] = args.pointSizePx;

    // u32 fields at offsets 48..76 (float indices 12..19)
    const u32 = new Uint32Array(f.buffer);
    u32[12] = args.baseId >>> 0;
    u32[13] = args.pointCount >>> 0;
    u32[14] = args.lodStride >>> 0;
    u32[15] = args.lodOffset >>> 0;
    u32[16] = args.firstPoint >>> 0;
    u32[17] = 0; // _pad1
    u32[18] = 0; // _pad2
    u32[19] = 0; // _pad3

    this.device.queue.writeBuffer(buffer, 0, f);
  }
}
