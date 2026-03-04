// ----------------------------
// Spatial hash grid for fast CPU point picking
// ----------------------------

export type GridBuildParams = {
  markerNormLayers: { traceIndex: number; points01: Float32Array }[];
  width: number;
  height: number;
  padding: { l: number; r: number; t: number; b: number };
  zoom: { k: number; x: number; y: number };
};

export class GridIndex {
  readonly cellPx: number;
  readonly minBuildIntervalMs: number;
  readonly minScaleRelDelta: number;
  readonly minTransRelDelta: number;

  gridMap = new Map<bigint, number[]>();
  gridX = new Float32Array(0);
  gridY = new Float32Array(0);
  gridTrace = new Uint32Array(0);
  gridPoint = new Uint32Array(0);
  built = false;

  lastZoomK = 1;
  lastZoomX = 0;
  lastZoomY = 0;

  private rebuildPending = false;
  private rebuildTimer: number | null = null;
  private lastBuildTs = 0;

  constructor(
    cellPx = 18,
    minBuildIntervalMs = 60,
    minScaleRelDelta = 0.06,
    minTransRelDelta = 0.3
  ) {
    this.cellPx = cellPx;
    this.minBuildIntervalMs = minBuildIntervalMs;
    this.minScaleRelDelta = minScaleRelDelta;
    this.minTransRelDelta = minTransRelDelta;
  }

  /**
   * Schedule a throttled rebuild. `getParams` is called lazily at build time
   * so zoom/pan changes that occur during the delay are reflected.
   */
  scheduleRebuild(getParams: () => GridBuildParams, isDestroyed: () => boolean): void {
    if (isDestroyed()) return;
    if (!this.shouldRebuild(getParams())) return;
    if (this.rebuildPending) return;

    const now = performance.now();
    const elapsed = now - this.lastBuildTs;
    const delay = elapsed >= this.minBuildIntervalMs ? 0 : (this.minBuildIntervalMs - elapsed);

    this.rebuildPending = true;
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildPending = false;
      this.rebuildTimer = null;
      if (isDestroyed()) return;
      if (!this.shouldRebuild(getParams())) return;
      this.build(getParams());
    }, delay);
  }

  shouldRebuild(params: GridBuildParams): boolean {
    if (!this.built) return true;

    const { width, height, padding, zoom } = params;

    const dk = Math.abs(zoom.k - this.lastZoomK) / Math.max(1e-6, this.lastZoomK);
    if (dk >= this.minScaleRelDelta) return true;

    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);

    const relDeltaX = Math.abs(zoom.x - this.lastZoomX) / plotW;
    const relDeltaY = Math.abs(zoom.y - this.lastZoomY) / plotH;

    if (relDeltaX > this.minTransRelDelta || relDeltaY > this.minTransRelDelta) return true;

    return false;
  }

  /** Returns true if the grid exists but the current transform has drifted beyond thresholds. */
  isStale(params: GridBuildParams): boolean {
    if (!this.built) return false;

    const { width, height, padding, zoom } = params;

    const dk = Math.abs(zoom.k - this.lastZoomK) / Math.max(1e-6, this.lastZoomK);
    if (dk >= this.minScaleRelDelta) return true;

    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);

    const relDeltaX = Math.abs(zoom.x - this.lastZoomX) / plotW;
    const relDeltaY = Math.abs(zoom.y - this.lastZoomY) / plotH;

    return relDeltaX > this.minTransRelDelta || relDeltaY > this.minTransRelDelta;
  }

  build(params: GridBuildParams): { buildMs: number } {
    const t0 = performance.now();
    const { markerNormLayers, width, height, padding, zoom } = params;

    const plotW = Math.max(1, width - padding.l - padding.r);
    const plotH = Math.max(1, height - padding.t - padding.b);
    const ox = padding.l;
    const oy = padding.t;

    const k = zoom.k;
    const tx = zoom.x;
    const ty = zoom.y;

    let total = 0;
    for (const L of markerNormLayers) total += L.points01.length / 2;

    this.gridX = new Float32Array(total);
    this.gridY = new Float32Array(total);
    this.gridTrace = new Uint32Array(total);
    this.gridPoint = new Uint32Array(total);
    this.gridMap.clear();

    let gi = 0;

    for (const L of markerNormLayers) {
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

        const cx = Math.floor(px / this.cellPx);
        const cy = Math.floor(py / this.cellPx);
        const key = this.key(cx, cy);

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

    this.built = true;
    this.lastBuildTs = performance.now();
    this.lastZoomK = zoom.k;
    this.lastZoomX = zoom.x;
    this.lastZoomY = zoom.y;

    return { buildMs: performance.now() - t0 };
  }

  key(cx: number, cy: number): bigint {
    return (BigInt(cx) << 32n) ^ (BigInt(cy) & 0xffffffffn);
  }

  dispose(): void {
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }
}
