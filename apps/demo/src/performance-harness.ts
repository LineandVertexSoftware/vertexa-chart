import {
  Chart,
  type ChartPerformanceStats,
  type ChartPerformanceMode
} from "@lineandvertexsoftware/vertexa-chart";

export type BenchmarkScenarioId =
  | "mount-scatter-200k-quality"
  | "pan-scatter-200k-balanced"
  | "pan-scatter-1m-quality"
  | "pan-grid-6x1m-unsynced-quality"
  | "pan-sync-6x1m-quality"
  | "append-scatter-50k-window";

type BenchmarkHarnessOptions = {
  root: HTMLDivElement;
  highContrastMode: boolean;
  seed: number;
};

type BenchmarkEnvironment = {
  url: string;
  userAgent: string;
  language: string;
  platform: string;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  webgpuAvailable: boolean;
  gpuAdapter: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  } | null;
};

type MetricSummary = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
};

type FrameBudgetSummary = MetricSummary & {
  sampleCount: number;
  spanMs: number;
  fps: number;
  p99: number;
  over16_7Count: number;
  over16_7Ratio: number;
  over33_3Count: number;
  over33_3Ratio: number;
  longestFrameMs: number;
};

type BenchmarkReport = {
  version: 1;
  status: "running" | "ok" | "error";
  scenario: BenchmarkScenarioId;
  description: string;
  startedAt: string;
  finishedAt?: string;
  config: Record<string, number | string | boolean | null>;
  environment?: BenchmarkEnvironment;
  metrics?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
  };
};

type MountScenario = {
  id: BenchmarkScenarioId;
  kind: "mount";
  description: string;
  width: number;
  height: number;
  points: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  timeoutMs: number;
};

type PanScenario = {
  id: BenchmarkScenarioId;
  kind: "pan";
  description: string;
  width: number;
  height: number;
  points: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  stepPx: number;
  samples: number;
  warmup: number;
  measureDurationMs: number;
  timeoutMs: number;
  reverseEvery: number;
};

type AppendScenario = {
  id: BenchmarkScenarioId;
  kind: "append";
  description: string;
  width: number;
  height: number;
  initialPoints: number;
  appendBatch: number;
  samples: number;
  warmup: number;
  maxPoints: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  timeoutMs: number;
};

type SyncPanScenario = {
  id: BenchmarkScenarioId;
  kind: "sync-pan";
  description: string;
  syncCharts: boolean;
  width: number;
  chartCount: number;
  chartHeight: number;
  columns: number;
  gapPx: number;
  pointsPerChart: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  stepPx: number;
  samples: number;
  warmup: number;
  measureDurationMs: number;
  timeoutMs: number;
  reverseEvery: number;
};

type BenchmarkScenario = MountScenario | PanScenario | AppendScenario | SyncPanScenario;

declare global {
  interface Window {
    __VERTEXA_BENCHMARK_RESULT__?: BenchmarkReport;
  }
}

const DEFAULT_SCENARIO: BenchmarkScenarioId = "pan-scatter-200k-balanced";

const SCENARIOS: Record<BenchmarkScenarioId, BenchmarkScenario> = {
  "mount-scatter-200k-quality": {
    id: "mount-scatter-200k-quality",
    kind: "mount",
    description: "Mount a single 200k-point scatter trace and wait for the first rendered frame.",
    width: 1280,
    height: 720,
    points: 200_000,
    performanceMode: "quality",
    pointSizePx: 1.2,
    timeoutMs: 20_000
  },
  "pan-scatter-200k-balanced": {
    id: "pan-scatter-200k-balanced",
    kind: "pan",
    description: "Measure steady-state pan latency and throughput on a 200k-point scatter trace.",
    width: 1280,
    height: 720,
    points: 200_000,
    performanceMode: "balanced",
    pointSizePx: 1.2,
    stepPx: 18,
    samples: 72,
    warmup: 8,
    measureDurationMs: 1_000,
    timeoutMs: 20_000,
    reverseEvery: 12
  },
  "pan-scatter-1m-quality": {
    id: "pan-scatter-1m-quality",
    kind: "pan",
    description: "Measure pan latency and throughput on a 1M-point scatter trace in quality mode.",
    width: 1280,
    height: 720,
    points: 1_000_000,
    performanceMode: "quality",
    pointSizePx: 1.1,
    stepPx: 12,
    samples: 36,
    warmup: 4,
    measureDurationMs: 1_500,
    timeoutMs: 35_000,
    reverseEvery: 6
  },
  "pan-sync-6x1m-quality": {
    id: "pan-sync-6x1m-quality",
    kind: "sync-pan",
    description: "Measure synchronized pan latency across six linked 1M-point scatter charts in quality mode.",
    syncCharts: true,
    width: 1280,
    chartCount: 6,
    chartHeight: 250,
    columns: 2,
    gapPx: 16,
    pointsPerChart: 1_000_000,
    performanceMode: "quality",
    pointSizePx: 1.2,
    stepPx: 12,
    samples: 18,
    warmup: 3,
    measureDurationMs: 2_500,
    timeoutMs: 60_000,
    reverseEvery: 6
  },
  "pan-grid-6x1m-unsynced-quality": {
    id: "pan-grid-6x1m-unsynced-quality",
    kind: "sync-pan",
    description: "Measure pan latency on one active chart inside an unsynchronized 6x1M dashboard in quality mode.",
    syncCharts: false,
    width: 1280,
    chartCount: 6,
    chartHeight: 250,
    columns: 2,
    gapPx: 16,
    pointsPerChart: 1_000_000,
    performanceMode: "quality",
    pointSizePx: 1.2,
    stepPx: 12,
    samples: 18,
    warmup: 3,
    measureDurationMs: 2_500,
    timeoutMs: 60_000,
    reverseEvery: 6
  },
  "append-scatter-50k-window": {
    id: "append-scatter-50k-window",
    kind: "append",
    description: "Measure appendPoints() throughput with a fixed 50k-point sliding window.",
    width: 1280,
    height: 720,
    initialPoints: 50_000,
    appendBatch: 512,
    samples: 48,
    warmup: 6,
    maxPoints: 50_000,
    performanceMode: "balanced",
    pointSizePx: 1.5,
    timeoutMs: 20_000
  }
};

export function runPerformanceHarness(options: BenchmarkHarnessOptions): () => void {
  const { root, highContrastMode, seed } = options;
  const params = new URLSearchParams(window.location.search);
  const resolvedScenario = resolveScenario(params);
  const hostSize = getHostContainerSize(resolvedScenario);

  root.innerHTML = `
    <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 20px; color: #111827; background: #f8fafc; min-height: 100vh; box-sizing: border-box;">
      <h1 style="margin: 0 0 8px; font-size: 20px;">Vertexa Benchmark Harness</h1>
      <p id="benchmark-status" style="margin: 0 0 16px; font-size: 14px;">Preparing benchmark...</p>
      <div id="benchmark-host" style="width: ${hostSize.width}px; max-width: 100%; min-height: ${hostSize.height}px; border: 1px solid #cbd5e1; background: #ffffff;"></div>
      <pre id="benchmark-output" style="margin: 16px 0 0; padding: 16px; background: #0f172a; color: #e2e8f0; overflow: auto; white-space: pre-wrap; word-break: break-word;"></pre>
    </div>
  `;

  const statusEl = root.querySelector<HTMLParagraphElement>("#benchmark-status");
  const hostEl = root.querySelector<HTMLDivElement>("#benchmark-host");
  const outputEl = root.querySelector<HTMLPreElement>("#benchmark-output");
  if (!statusEl || !hostEl || !outputEl) {
    throw new Error("Benchmark harness failed to mount DOM.");
  }

  let disposed = false;
  let activeCleanup: (() => void) | null = null;

  const reportEl = document.createElement("script");
  reportEl.id = "benchmark-report";
  reportEl.type = "application/json";
  document.body.appendChild(reportEl);
  const startedAt = new Date().toISOString();
  const runId = params.get("runId");
  let runnerNotified = false;

  const notifyRunner = async (report: BenchmarkReport) => {
    if (report.status === "running" || !runId || runnerNotified) return;

    const url = `${window.location.origin}/__benchmark-report?runId=${encodeURIComponent(runId)}`;
    const payload = JSON.stringify(report);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt === 0 && typeof navigator.sendBeacon === "function") {
          const body = new Blob([payload], { type: "application/json" });
          if (navigator.sendBeacon(url, body)) {
            runnerNotified = true;
            return;
          }
        }

        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true
        });
        if (!response.ok) {
          throw new Error(`Runner notification failed with HTTP ${response.status}`);
        }
        runnerNotified = true;
        return;
      } catch (error) {
        if (attempt === 2) {
          console.warn("Failed to deliver benchmark report to runner.", error);
          return;
        }
        await sleepMs(150 * (attempt + 1));
      }
    }
  };

  const publish = (report: BenchmarkReport) => {
    if (disposed) return;
    reportEl.textContent = JSON.stringify(report, null, 2);
    outputEl.textContent = JSON.stringify(report, null, 2);
    statusEl.textContent =
      report.status === "running"
        ? `Running ${report.scenario}...`
        : report.status === "ok"
          ? `${report.scenario} completed`
          : `${report.scenario} failed`;
    document.documentElement.setAttribute("data-benchmark-status", report.status);
    document.documentElement.setAttribute("data-benchmark-scenario", report.scenario);
    window.__VERTEXA_BENCHMARK_RESULT__ = report;
    void notifyRunner(report);
  };

  const replaceCleanup = (cleanup: () => void) => {
    activeCleanup?.();
    activeCleanup = cleanup;
  };

  publish({
    version: 1,
    status: "running",
    scenario: resolvedScenario.id,
    description: resolvedScenario.description,
    startedAt,
    config: scenarioConfigToRecord(resolvedScenario)
  });

  void (async () => {
    try {
      const environment = await collectEnvironment();
      const report = await executeScenario({
        scenario: resolvedScenario,
        hostEl,
        highContrastMode,
        seed,
        registerCleanup: replaceCleanup
      });

      publish({
        version: 1,
        status: "ok",
        scenario: resolvedScenario.id,
        description: resolvedScenario.description,
        startedAt,
        finishedAt: new Date().toISOString(),
        config: scenarioConfigToRecord(resolvedScenario),
        environment,
        metrics: report
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      publish({
        version: 1,
        status: "error",
        scenario: resolvedScenario.id,
        description: resolvedScenario.description,
        startedAt,
        finishedAt: new Date().toISOString(),
        config: scenarioConfigToRecord(resolvedScenario),
        error: {
          message: err.message,
          stack: err.stack
        }
      });
    }
  })();

  return () => {
    disposed = true;
    activeCleanup?.();
    activeCleanup = null;
    reportEl.remove();
    document.documentElement.removeAttribute("data-benchmark-status");
    document.documentElement.removeAttribute("data-benchmark-scenario");
  };
}

async function executeScenario(options: {
  scenario: BenchmarkScenario;
  hostEl: HTMLDivElement;
  highContrastMode: boolean;
  seed: number;
  registerCleanup: (cleanup: () => void) => void;
}) {
  const { scenario } = options;
  if (scenario.kind === "mount") {
    return runMountScenario(options, scenario);
  }
  if (scenario.kind === "pan") {
    return runPanScenario(options, scenario);
  }
  if (scenario.kind === "sync-pan") {
    return runSyncPanScenario(options, scenario);
  }
  return runAppendScenario(options, scenario);
}

async function runMountScenario(
  options: {
    hostEl: HTMLDivElement;
    highContrastMode: boolean;
    seed: number;
    registerCleanup: (cleanup: () => void) => void;
  },
  scenario: MountScenario
) {
  const frameBudgetTracker = startFrameBudgetTracker();
  const mount = await mountScatterChart({
    hostEl: options.hostEl,
    width: scenario.width,
    height: scenario.height,
    points: scenario.points,
    performanceMode: scenario.performanceMode,
    pointSizePx: scenario.pointSizePx,
    highContrastMode: options.highContrastMode,
    seed: options.seed,
    timeoutMs: scenario.timeoutMs
  });
  options.registerCleanup(() => {
    mount.chart.destroy();
  });

  const stats = mount.chart.getPerformanceStats();
  return {
    mountMs: round(mount.mountMs),
    firstFrameWaitMs: round(mount.firstFrameWaitMs),
    frameCount: stats.frameCount,
    renderMsLast: round(stats.renderMs.last),
    renderMsAvg: round(stats.renderMs.avg),
    gpuRenderMsLast: stats.gpuRenderMs ? round(stats.gpuRenderMs.last) : null,
    gpuRenderMsAvg: stats.gpuRenderMs ? round(stats.gpuRenderMs.avg) : null,
    sampledPoints: stats.sampledPoints,
    totalPoints: scenario.points,
    lodRatio: round(stats.sampledPoints / scenario.points),
    frameBudgetMs: frameBudgetTracker.stop()
  };
}

async function runPanScenario(
  options: {
    hostEl: HTMLDivElement;
    highContrastMode: boolean;
    seed: number;
    registerCleanup: (cleanup: () => void) => void;
  },
  scenario: PanScenario
) {
  const mount = await mountScatterChart({
    hostEl: options.hostEl,
    width: scenario.width,
    height: scenario.height,
    points: scenario.points,
    performanceMode: scenario.performanceMode,
    pointSizePx: scenario.pointSizePx,
    highContrastMode: options.highContrastMode,
    seed: options.seed,
    timeoutMs: scenario.timeoutMs
  });
  options.registerCleanup(() => {
    mount.chart.destroy();
  });

  let direction = 1;
  for (let i = 0; i < scenario.warmup; i++) {
    const before = mount.chart.getPerformanceStats().frameCount;
    mount.chart.panBy(direction * scenario.stepPx, 0);
    await waitForFrameCount(mount.chart, before + 1, scenario.timeoutMs);
    await nextPaint();
    if ((i + 1) % scenario.reverseEvery === 0) direction *= -1;
  }

  const frameBudgetTracker = startFrameBudgetTracker();
  const latencies: number[] = [];
  const renderTimes: number[] = [];
  const gpuRenderTimes: number[] = [];
  const sampledPoints: number[] = [];
  const frameStart = mount.chart.getPerformanceStats().frameCount;
  const started = performance.now();
  let panCount = 0;

  while (panCount < scenario.samples || performance.now() - started < scenario.measureDurationMs) {
    const before = mount.chart.getPerformanceStats().frameCount;
    const opStarted = performance.now();
    mount.chart.panBy(direction * scenario.stepPx, 0);
    await waitForFrameCount(mount.chart, before + 1, scenario.timeoutMs);
    await nextPaint();
    const stats = mount.chart.getPerformanceStats();
    latencies.push(performance.now() - opStarted);
    renderTimes.push(stats.renderMs.last);
    if (stats.gpuRenderMs) {
      gpuRenderTimes.push(stats.gpuRenderMs.last);
    }
    sampledPoints.push(stats.sampledPoints);
    panCount += 1;
    if (panCount % scenario.reverseEvery === 0) direction *= -1;
  }

  const totalMs = performance.now() - started;
  const finalStats = mount.chart.getPerformanceStats();
  const frameDelta = finalStats.frameCount - frameStart;
  const frameBudgetMs = frameBudgetTracker.stop();

  return {
    mountMs: round(mount.mountMs),
    firstFrameWaitMs: round(mount.firstFrameWaitMs),
    panCount,
    stepPx: scenario.stepPx,
    totalDurationMs: round(totalMs),
    observedFps: round(frameBudgetMs.fps),
    chartRenderFps: round(frameDelta * 1000 / Math.max(1, totalMs)),
    panOpsPerSecond: round(panCount * 1000 / Math.max(1, totalMs)),
    operationLatencyMs: summarize(latencies),
    renderMs: summarize(renderTimes),
    gpuRenderMs: summarizeOptional(gpuRenderTimes),
    frameBudgetMs,
    sampledPoints: {
      last: finalStats.sampledPoints,
      avg: round(average(sampledPoints)),
      totalPoints: scenario.points,
      lodRatio: round(finalStats.sampledPoints / scenario.points)
    }
  };
}

async function runSyncPanScenario(
  options: {
    hostEl: HTMLDivElement;
    highContrastMode: boolean;
    seed: number;
    registerCleanup: (cleanup: () => void) => void;
  },
  scenario: SyncPanScenario
) {
  const activeChartIndex = 0;
  const mount = await mountSynchronizedCharts({
    hostEl: options.hostEl,
    syncCharts: scenario.syncCharts,
    width: scenario.width,
    chartCount: scenario.chartCount,
    chartHeight: scenario.chartHeight,
    columns: scenario.columns,
    gapPx: scenario.gapPx,
    pointsPerChart: scenario.pointsPerChart,
    performanceMode: scenario.performanceMode,
    pointSizePx: scenario.pointSizePx,
    highContrastMode: options.highContrastMode,
    timeoutMs: scenario.timeoutMs
  });
  options.registerCleanup(() => {
    mount.destroy();
  });

  if (scenario.warmup > 0) {
    await driveContinuousPanFrames({
      charts: mount.charts,
      activeChartIndex,
      stepPx: scenario.stepPx,
      reverseEvery: scenario.reverseEvery,
      minOps: scenario.warmup,
      minDurationMs: 0,
      timeoutMs: scenario.timeoutMs
    });
  }

  const frameBudgetTracker = startFrameBudgetTracker();
  const latencies: number[] = [];
  const slowestRenderTimes: number[] = [];
  const averageRenderTimes: number[] = [];
  const slowestGpuRenderTimes: number[] = [];
  const averageGpuRenderTimes: number[] = [];
  const totalSampledPoints: number[] = [];
  const perChartSampledTotals = Array.from({ length: mount.charts.length }, () => 0);
  const frameStart = mount.charts.map((chart) => chart.getPerformanceStats().frameCount);
  const motion = await driveContinuousPanFrames({
    charts: mount.charts,
    activeChartIndex,
    stepPx: scenario.stepPx,
    reverseEvery: scenario.reverseEvery,
    minOps: scenario.samples,
    minDurationMs: scenario.measureDurationMs,
    timeoutMs: scenario.timeoutMs,
    onFrame: ({ latencyMs, stats }) => {
      latencies.push(latencyMs);
      slowestRenderTimes.push(Math.max(...stats.map((entry) => entry.renderMs.last)));
      averageRenderTimes.push(average(stats.map((entry) => entry.renderMs.last)));
      const gpuFrameStats = stats.flatMap((entry) => (entry.gpuRenderMs ? [entry.gpuRenderMs.last] : []));
      if (gpuFrameStats.length > 0) {
        slowestGpuRenderTimes.push(Math.max(...gpuFrameStats));
        averageGpuRenderTimes.push(average(gpuFrameStats));
      }

      const sampledThisFrame = stats.map((entry) => entry.sampledPoints);
      totalSampledPoints.push(sampledThisFrame.reduce((sum, value) => sum + value, 0));
      for (let chartIndex = 0; chartIndex < sampledThisFrame.length; chartIndex++) {
        perChartSampledTotals[chartIndex] += sampledThisFrame[chartIndex];
      }
    }
  });

  const totalMs = motion.totalDurationMs;
  const panCount = motion.panCount;
  const finalStats = motion.finalStats;
  const frameDelta = finalStats.map((stats, index) => stats.frameCount - frameStart[index]);
  const primaryFrameDelta = frameDelta[0] ?? 0;
  const averageFrameDelta = average(frameDelta);
  const totalPoints = scenario.chartCount * scenario.pointsPerChart;
  const totalSampledLast = finalStats.reduce((sum, stats) => sum + stats.sampledPoints, 0);
  const frameBudgetMs = frameBudgetTracker.stop();

  return {
    mountMs: round(mount.mountMs),
    firstFrameWaitMs: round(mount.firstFrameWaitMs),
    chartCount: scenario.chartCount,
    pointsPerChart: scenario.pointsPerChart,
    totalPoints,
    chartHeight: scenario.chartHeight,
    columns: scenario.columns,
    panCount,
    stepPx: scenario.stepPx,
    totalDurationMs: round(totalMs),
    syncCharts: scenario.syncCharts,
    activeChartIndex,
    observedFps: round(frameBudgetMs.fps),
    chartRenderFps: round((scenario.syncCharts ? averageFrameDelta : primaryFrameDelta) * 1000 / Math.max(1, totalMs)),
    panOpsPerSecond: round(panCount * 1000 / Math.max(1, totalMs)),
    operationLatencyMs: summarize(latencies),
    renderMs: {
      slowest: summarize(slowestRenderTimes),
      average: summarize(averageRenderTimes)
    },
    gpuRenderMs:
      slowestGpuRenderTimes.length > 0
        ? {
            slowest: summarize(slowestGpuRenderTimes),
            average: summarize(averageGpuRenderTimes)
          }
        : null,
    frameBudgetMs,
    sampledPoints: {
      last: totalSampledLast,
      avg: round(average(totalSampledPoints)),
      totalPoints,
      lodRatio: round(totalSampledLast / totalPoints),
      perChartLast: finalStats.map((stats) => stats.sampledPoints),
      perChartAvg: perChartSampledTotals.map((value) => round(value / Math.max(1, panCount)))
    },
    charts: finalStats.map((stats, index) => ({
      index,
      title: mount.chartTitles[index],
      frameDelta: frameDelta[index],
      sampledPoints: stats.sampledPoints,
      renderMsLast: round(stats.renderMs.last),
      renderMsAvg: round(stats.renderMs.avg),
      gpuRenderMsLast: stats.gpuRenderMs ? round(stats.gpuRenderMs.last) : null,
      gpuRenderMsAvg: stats.gpuRenderMs ? round(stats.gpuRenderMs.avg) : null,
      fps: round(stats.fps)
    }))
  };
}

async function runAppendScenario(
  options: {
    hostEl: HTMLDivElement;
    highContrastMode: boolean;
    seed: number;
    registerCleanup: (cleanup: () => void) => void;
  },
  scenario: AppendScenario
) {
  const rng = makeSeededRandom(options.seed);
  const maxProjectedX = scenario.initialPoints + scenario.appendBatch * (scenario.samples + scenario.warmup + 2);
  const x = new Float32Array(scenario.initialPoints);
  const y = new Float32Array(scenario.initialPoints);
  for (let i = 0; i < scenario.initialPoints; i++) {
    x[i] = i;
    y[i] = signalAt(i, rng);
  }

  options.hostEl.replaceChildren();
  const chartStarted = performance.now();
  const chart = new Chart(options.hostEl, {
    width: scenario.width,
    height: scenario.height,
    pickingMode: "cpu",
    a11y: {
      keyboardNavigation: false,
      highContrast: options.highContrastMode
    },
    layout: {
      title: "appendPoints benchmark",
      hovermode: "none",
      legend: { show: false },
      margin: { top: 28, right: 20, bottom: 42, left: 52 },
      xaxis: { type: "linear", title: "Index", min: 0, max: maxProjectedX },
      yaxis: { type: "linear", title: "Signal", min: -1.5, max: 1.5, precision: 3 },
      grid: {
        show: true,
        color: "#dbeafe",
        axisColor: "#2563eb",
        textColor: "#1e3a8a",
        opacity: 0.7,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "scatter",
        name: "Signal",
        x,
        y,
        mode: "markers",
        marker: {
          color: "#2563eb",
          sizePx: scenario.pointSizePx,
          opacity: 0.62
        }
      }
    ]
  });

  chart.setPerformanceMode(scenario.performanceMode);
  options.registerCleanup(() => {
    chart.destroy();
  });

  const waitStarted = performance.now();
  await waitForFrameCount(chart, 1, scenario.timeoutMs);
  await nextPaint();
  const mountMs = performance.now() - chartStarted;
  const firstFrameWaitMs = performance.now() - waitStarted;

  let nextX = scenario.initialPoints;
  const appendOnce = async () => {
    const batchX = new Float32Array(scenario.appendBatch);
    const batchY = new Float32Array(scenario.appendBatch);
    for (let i = 0; i < scenario.appendBatch; i++) {
      batchX[i] = nextX;
      batchY[i] = signalAt(nextX, rng);
      nextX += 1;
    }

    const before = chart.getPerformanceStats().frameCount;
    const started = performance.now();
    chart.appendPoints(
      { traceIndex: 0, x: batchX, y: batchY, maxPoints: scenario.maxPoints },
      { maxPoints: scenario.maxPoints }
    );
    await waitForFrameCount(chart, before + 1, scenario.timeoutMs);
    await nextPaint();
    return performance.now() - started;
  };

  for (let i = 0; i < scenario.warmup; i++) {
    await appendOnce();
  }

  const frameBudgetTracker = startFrameBudgetTracker();
  const latencies: number[] = [];
  const renderTimes: number[] = [];
  const gpuRenderTimes: number[] = [];
  const sampledPoints: number[] = [];
  const started = performance.now();

  for (let i = 0; i < scenario.samples; i++) {
    const latency = await appendOnce();
    latencies.push(latency);
    const stats = chart.getPerformanceStats();
    renderTimes.push(stats.renderMs.last);
    if (stats.gpuRenderMs) {
      gpuRenderTimes.push(stats.gpuRenderMs.last);
    }
    sampledPoints.push(stats.sampledPoints);
  }

  const totalMs = performance.now() - started;
  const finalStats = chart.getPerformanceStats();
  const totalAppendedPoints = scenario.samples * scenario.appendBatch;

  return {
    mountMs: round(mountMs),
    firstFrameWaitMs: round(firstFrameWaitMs),
    appendCount: scenario.samples,
    appendBatch: scenario.appendBatch,
    windowSize: scenario.maxPoints,
    totalDurationMs: round(totalMs),
    totalAppendedPoints,
    throughputPointsPerSecond: round(totalAppendedPoints * 1000 / Math.max(1, totalMs)),
    operationLatencyMs: summarize(latencies),
    renderMs: summarize(renderTimes),
    gpuRenderMs: summarizeOptional(gpuRenderTimes),
    frameBudgetMs: frameBudgetTracker.stop(),
    sampledPoints: {
      last: finalStats.sampledPoints,
      avg: round(average(sampledPoints)),
      totalPoints: scenario.maxPoints,
      lodRatio: round(finalStats.sampledPoints / scenario.maxPoints)
    }
  };
}

async function mountScatterChart(options: {
  hostEl: HTMLDivElement;
  width: number;
  height: number;
  points: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  highContrastMode: boolean;
  seed: number;
  timeoutMs: number;
}) {
  const { hostEl, width, height, points, performanceMode, pointSizePx, highContrastMode, seed, timeoutMs } = options;
  const rng = makeSeededRandom(seed);
  const x = new Float32Array(points);
  const y = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    x[i] = i;
    y[i] = signalAt(i, rng);
  }

  hostEl.replaceChildren();

  const t0 = performance.now();
  const chart = new Chart(hostEl, {
    width,
    height,
    pickingMode: "cpu",
    a11y: {
      keyboardNavigation: false,
      highContrast: highContrastMode
    },
    layout: {
      title: "benchmark scatter",
      hovermode: "none",
      legend: { show: false },
      margin: { top: 28, right: 20, bottom: 42, left: 52 },
      xaxis: { type: "linear", title: "Index", min: 0, max: points - 1 },
      yaxis: { type: "linear", title: "Signal", min: -1.5, max: 1.5, precision: 3 },
      grid: {
        show: true,
        color: "#dbeafe",
        axisColor: "#2563eb",
        textColor: "#1e3a8a",
        opacity: 0.7,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "scatter",
        name: "Signal",
        x,
        y,
        mode: "markers",
        marker: {
          color: "#2563eb",
          sizePx: pointSizePx,
          opacity: 0.62
        }
      }
    ]
  });
  chart.setPerformanceMode(performanceMode);

  const waitStarted = performance.now();
  await waitForFrameCount(chart, 1, timeoutMs);
  await nextPaint();

  return {
    chart,
    mountMs: performance.now() - t0,
    firstFrameWaitMs: performance.now() - waitStarted
  };
}

async function mountSynchronizedCharts(options: {
  hostEl: HTMLDivElement;
  syncCharts: boolean;
  width: number;
  chartCount: number;
  chartHeight: number;
  columns: number;
  gapPx: number;
  pointsPerChart: number;
  performanceMode: ChartPerformanceMode;
  pointSizePx: number;
  highContrastMode: boolean;
  timeoutMs: number;
}) {
  const {
    hostEl,
    syncCharts,
    width,
    chartCount,
    chartHeight,
    columns,
    gapPx,
    pointsPerChart,
    performanceMode,
    pointSizePx,
    highContrastMode,
    timeoutMs
  } = options;
  const chartTitles = SYNC_CHART_TITLES.slice(0, chartCount);
  const palette = SYNC_PALETTE.slice(0, chartCount);

  hostEl.replaceChildren();
  hostEl.style.width = `${width}px`;
  hostEl.style.display = "grid";
  hostEl.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  hostEl.style.gap = `${gapPx}px`;
  hostEl.style.alignItems = "start";
  hostEl.style.padding = `${gapPx}px`;
  hostEl.style.boxSizing = "border-box";

  const hosts = Array.from({ length: chartCount }, () => {
    const host = document.createElement("div");
    host.style.minWidth = "0";
    host.style.height = `${chartHeight}px`;
    host.style.border = "1px solid #dbeafe";
    host.style.background = "#ffffff";
    hostEl.appendChild(host);
    return host;
  });

  const xSeries = new Float32Array(pointsPerChart);
  for (let i = 0; i < pointsPerChart; i++) {
    xSeries[i] = i;
  }

  const ySeries = Array.from({ length: chartCount }, (_unused, chartIndex) => {
    const out = new Float32Array(pointsPerChart);
    const phase = chartIndex * 0.62;
    const freqA = 2.4 + chartIndex * 0.21;
    const freqB = 7.8 + chartIndex * 0.35;
    const freqC = 21 + chartIndex * 1.2;
    for (let i = 0; i < pointsPerChart; i++) {
      const t = i / Math.max(1, pointsPerChart - 1);
      out[i] =
        Math.sin(t * Math.PI * freqA + phase) * 0.76 +
        Math.cos(t * Math.PI * freqB + phase * 0.8) * 0.31 +
        Math.sin(t * Math.PI * freqC + phase * 0.4) * 0.08;
    }
    return out;
  });

  const zoomStates = Array.from({ length: chartCount }, () => ({ k: 1, x: 0, y: 0 }));
  const charts: Chart[] = [];
  let syncingZoom = false;

  const syncZoomFrom = (sourceIndex: number, target: { k: number; x: number; y: number }) => {
    syncingZoom = true;
    try {
      for (let i = 0; i < chartCount; i++) {
        if (i === sourceIndex) continue;
        const current = zoomStates[i];
        if (
          Math.abs(current.k - target.k) < 1e-9 &&
          Math.abs(current.x - target.x) < 1e-3 &&
          Math.abs(current.y - target.y) < 1e-3
        ) {
          continue;
        }
        charts[i].setViewTransform(target, { renderMode: "next-frame" });
        zoomStates[i] = { ...target };
      }
    } finally {
      syncingZoom = false;
    }
  };

  const buildLayout = (title: string) => ({
    title,
    hovermode: "none" as const,
    legend: { show: false },
    margin: { top: 24, right: 14, bottom: 36, left: 52 },
    xaxis: { type: "linear" as const, title: "Index", tickFormat: ".0f", min: 0, max: pointsPerChart - 1 },
    yaxis: { type: "linear" as const, title: "Signal", min: -1.35, max: 1.35, precision: 3 },
    grid: {
      show: true,
      color: "#dbeafe",
      axisColor: "#2563eb",
      textColor: "#1e3a8a",
      opacity: 0.75,
      strokeWidth: 1
    }
  });

  const chartStarted = performance.now();
  for (let i = 0; i < chartCount; i++) {
    const widthPx = Math.max(320, Math.floor(hosts[i].clientWidth || width / columns));
    const chart = new Chart(hosts[i], {
      width: widthPx,
      height: chartHeight,
      pickingMode: "cpu",
      a11y: {
        keyboardNavigation: false,
        highContrast: highContrastMode
      },
      layout: buildLayout(chartTitles[i] ?? `Chart ${i + 1}`),
      traces: [
        {
          type: "scatter",
          name: chartTitles[i] ?? `Chart ${i + 1}`,
          x: xSeries,
          y: ySeries[i],
          mode: "markers",
          marker: {
            color: palette[i] ?? "#2563eb",
            sizePx: pointSizePx,
            opacity: 0.62
          }
        }
      ],
      onZoom: (event) => {
        zoomStates[i] = { ...event };
        if (syncingZoom || !syncCharts) return;
        syncZoomFrom(i, event);
      }
    });
    chart.setPerformanceMode(performanceMode);
    if (syncCharts) {
      chart.setInteractionRenderMode("next-frame");
    }
    charts.push(chart);
  }

  const waitStarted = performance.now();
  await waitForFrameCounts(charts, charts.map(() => 1), timeoutMs);
  await nextPaint();

  return {
    charts,
    chartTitles,
    mountMs: performance.now() - chartStarted,
    firstFrameWaitMs: performance.now() - waitStarted,
    destroy: () => {
      for (const chart of charts) {
        chart.destroy();
      }
    }
  };
}

function resolveScenario(params: URLSearchParams): BenchmarkScenario {
  const requested = params.get("scenario");
  const fallback = SCENARIOS[DEFAULT_SCENARIO];
  const base = requested && requested in SCENARIOS
    ? SCENARIOS[requested as BenchmarkScenarioId]
    : fallback;

  const points = getPositiveInteger(params.get("points"));
  const samples = getPositiveInteger(params.get("samples"));
  const warmup = getPositiveInteger(params.get("warmup"));
  const stepPx = getPositiveNumber(params.get("stepPx"));
  const appendBatch = getPositiveInteger(params.get("appendBatch"));
  const measureDurationMs = getPositiveNumber(params.get("measureDurationMs"));

  if (base.kind === "mount") {
    return {
      ...base,
      points: points ?? base.points
    };
  }

  if (base.kind === "pan") {
    return {
      ...base,
      points: points ?? base.points,
      samples: samples ?? base.samples,
      warmup: warmup ?? base.warmup,
      measureDurationMs: measureDurationMs ?? base.measureDurationMs,
      stepPx: stepPx ?? base.stepPx
    };
  }

  if (base.kind === "sync-pan") {
    return {
      ...base,
      pointsPerChart: points ?? base.pointsPerChart,
      samples: samples ?? base.samples,
      warmup: warmup ?? base.warmup,
      measureDurationMs: measureDurationMs ?? base.measureDurationMs,
      stepPx: stepPx ?? base.stepPx
    };
  }

  return {
    ...base,
    initialPoints: points ?? base.initialPoints,
    samples: samples ?? base.samples,
    warmup: warmup ?? base.warmup,
    appendBatch: appendBatch ?? base.appendBatch
  };
}

function scenarioConfigToRecord(scenario: BenchmarkScenario): Record<string, number | string | boolean | null> {
  if (scenario.kind === "mount") {
    return {
      kind: scenario.kind,
      width: scenario.width,
      height: scenario.height,
      points: scenario.points,
      performanceMode: scenario.performanceMode,
      pointSizePx: scenario.pointSizePx,
      timeoutMs: scenario.timeoutMs
    };
  }

  if (scenario.kind === "pan") {
    return {
      kind: scenario.kind,
      width: scenario.width,
      height: scenario.height,
      points: scenario.points,
      performanceMode: scenario.performanceMode,
      pointSizePx: scenario.pointSizePx,
      stepPx: scenario.stepPx,
      samples: scenario.samples,
      warmup: scenario.warmup,
      measureDurationMs: scenario.measureDurationMs,
      reverseEvery: scenario.reverseEvery,
      timeoutMs: scenario.timeoutMs
    };
  }

  if (scenario.kind === "sync-pan") {
    return {
      kind: scenario.kind,
      syncCharts: scenario.syncCharts,
      width: scenario.width,
      chartCount: scenario.chartCount,
      chartHeight: scenario.chartHeight,
      columns: scenario.columns,
      gapPx: scenario.gapPx,
      pointsPerChart: scenario.pointsPerChart,
      performanceMode: scenario.performanceMode,
      pointSizePx: scenario.pointSizePx,
      stepPx: scenario.stepPx,
      samples: scenario.samples,
      warmup: scenario.warmup,
      measureDurationMs: scenario.measureDurationMs,
      reverseEvery: scenario.reverseEvery,
      timeoutMs: scenario.timeoutMs
    };
  }

  return {
    kind: scenario.kind,
    width: scenario.width,
    height: scenario.height,
    initialPoints: scenario.initialPoints,
    appendBatch: scenario.appendBatch,
    samples: scenario.samples,
    warmup: scenario.warmup,
    maxPoints: scenario.maxPoints,
    performanceMode: scenario.performanceMode,
    pointSizePx: scenario.pointSizePx,
    timeoutMs: scenario.timeoutMs
  };
}

function getHostContainerSize(scenario: BenchmarkScenario) {
  if (scenario.kind === "sync-pan") {
    const rows = Math.ceil(scenario.chartCount / scenario.columns);
    return {
      width: scenario.width,
      height: rows * scenario.chartHeight + (rows + 1) * scenario.gapPx
    };
  }

  return {
    width: scenario.width,
    height: scenario.height
  };
}

async function waitForFrameCount(chart: Chart, expectedFrameCount: number, timeoutMs: number) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const stats = chart.getPerformanceStats();
    if (stats.frameCount >= expectedFrameCount) return stats;
    await nextPaint();
  }
  throw new Error(`Timed out waiting for frame ${expectedFrameCount}.`);
}

async function waitForFrameCounts(charts: Chart[], expectedFrameCounts: number[], timeoutMs: number) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    let allReady = true;
    for (let i = 0; i < charts.length; i++) {
      if (charts[i].getPerformanceStats().frameCount < expectedFrameCounts[i]) {
        allReady = false;
        break;
      }
    }
    if (allReady) return;
    await nextPaint();
  }
  throw new Error(`Timed out waiting for synchronized frame counts: ${expectedFrameCounts.join(", ")}.`);
}

async function driveContinuousPanFrames(options: {
  charts: Chart[];
  activeChartIndex: number;
  stepPx: number;
  reverseEvery: number;
  minOps: number;
  minDurationMs: number;
  timeoutMs: number;
  onFrame?: (sample: { latencyMs: number; stats: ChartPerformanceStats[] }) => void;
}) {
  const { charts, activeChartIndex, stepPx, minOps, minDurationMs, timeoutMs } = options;
  const reverseEvery = Math.max(1, options.reverseEvery);

  return new Promise<{
    panCount: number;
    totalDurationMs: number;
    finalStats: ChartPerformanceStats[];
  }>((resolve, reject) => {
    let settled = false;
    let rafId = 0;
    let startedAt = 0;
    let lastIssuedAt: number | null = null;
    let direction = 1;
    let panCount = 0;

    const cleanup = () => {
      settled = true;
      window.clearTimeout(timeoutId);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out driving continuous pan motion after ${timeoutMs}ms.`));
    }, timeoutMs);

    const tick = (timestamp: number) => {
      if (settled) return;
      if (startedAt === 0) {
        startedAt = timestamp;
      }

      const stats = charts.map((chart) => chart.getPerformanceStats());
      if (lastIssuedAt !== null) {
        options.onFrame?.({ latencyMs: timestamp - lastIssuedAt, stats });
      }

      const elapsedMs = timestamp - startedAt;
      if (panCount >= minOps && elapsedMs >= minDurationMs) {
        cleanup();
        resolve({
          panCount,
          totalDurationMs: elapsedMs,
          finalStats: stats
        });
        return;
      }

      lastIssuedAt = timestamp;
      charts[activeChartIndex].panBy(direction * stepPx, 0);
      panCount += 1;
      if (panCount % reverseEvery === 0) {
        direction *= -1;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  });
}

async function collectEnvironment(): Promise<BenchmarkEnvironment> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: {
      requestAdapter?: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<unknown>;
    };
  };
  const adapter = await nav.gpu?.requestAdapter?.({ powerPreference: "high-performance" });
  const gpuAdapter = normalizeAdapterInfo(adapter);

  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    webgpuAvailable: Boolean(nav.gpu && adapter),
    gpuAdapter
  };
}

function normalizeAdapterInfo(adapter: unknown) {
  if (!adapter || typeof adapter !== "object") return null;
  const info = "info" in adapter ? (adapter as { info?: Record<string, unknown> }).info : undefined;
  if (!info || typeof info !== "object") return null;
  const vendor = typeof info.vendor === "string" ? info.vendor : undefined;
  const architecture = typeof info.architecture === "string" ? info.architecture : undefined;
  const device = typeof info.device === "string" ? info.device : undefined;
  const description = typeof info.description === "string" ? info.description : undefined;
  return { vendor, architecture, device, description };
}

function signalAt(index: number, rand: () => number) {
  const t = index / 8192;
  return (
    Math.sin(t * Math.PI * 4.8) * 0.76 +
    Math.cos(t * Math.PI * 13.4) * 0.22 +
    Math.sin(t * Math.PI * 29.6) * 0.08 +
    (rand() - 0.5) * 0.05
  );
}

const SYNC_CHART_TITLES = [
  "Ingress Throughput",
  "P95 Latency",
  "Queue Depth",
  "CPU Saturation",
  "I/O Wait",
  "Error Burst"
] as const;

const SYNC_PALETTE = ["#0f766e", "#0ea5e9", "#f97316", "#ef4444", "#7c3aed", "#1d4ed8"] as const;

function makeSeededRandom(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function summarize(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    avg: round(average(sorted)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function summarizeOptional(values: number[]) {
  return values.length > 0 ? summarize(values) : null;
}

function summarizeFrameBudget(intervals: number[]): FrameBudgetSummary {
  if (intervals.length === 0) {
    return {
      sampleCount: 0,
      spanMs: 0,
      fps: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      over16_7Count: 0,
      over16_7Ratio: 0,
      over33_3Count: 0,
      over33_3Ratio: 0,
      longestFrameMs: 0
    };
  }

  const sorted = [...intervals].sort((a, b) => a - b);
  const over16_7Count = intervals.filter((value) => value > 16.7).length;
  const over33_3Count = intervals.filter((value) => value > 33.3).length;
  const longestFrameMs = sorted[sorted.length - 1];
  const spanMs = intervals.reduce((sum, value) => sum + value, 0);
  const avg = average(sorted);
  return {
    sampleCount: intervals.length,
    spanMs: round(spanMs),
    fps: round(1000 / Math.max(avg, 1e-6)),
    min: round(sorted[0]),
    max: round(longestFrameMs),
    avg: round(avg),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    over16_7Count,
    over16_7Ratio: round(over16_7Count / Math.max(1, intervals.length)),
    over33_3Count,
    over33_3Ratio: round(over33_3Count / Math.max(1, intervals.length)),
    longestFrameMs: round(longestFrameMs)
  };
}

function startFrameBudgetTracker() {
  if (typeof requestAnimationFrame !== "function") {
    return {
      stop: () => summarizeFrameBudget([])
    };
  }

  let stopped = false;
  let frameHandle = 0;
  let lastTimestamp: number | null = null;
  const intervals: number[] = [];

  const tick = (timestamp: number) => {
    if (stopped) return;
    if (lastTimestamp !== null) {
      intervals.push(timestamp - lastTimestamp);
    }
    lastTimestamp = timestamp;
    frameHandle = requestAnimationFrame(tick);
  };

  frameHandle = requestAnimationFrame(tick);
  return {
    stop: () => {
      if (stopped) return summarizeFrameBudget(intervals);
      stopped = true;
      cancelAnimationFrame(frameHandle);
      return summarizeFrameBudget(intervals);
    }
  };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function getPositiveInteger(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getPositiveNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const timeoutId = window.setTimeout(finish, 16);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        window.clearTimeout(timeoutId);
        finish();
      });
      return;
    }

    finish();
  });
}
