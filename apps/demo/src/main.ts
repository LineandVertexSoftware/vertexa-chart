import "./style.css";
import {
  Chart,
  type ChartOptions,
  type ChartPerformanceMode,
  type HoverMode,
  type Trace
} from "@vertexa-chart/vertexa-chart-core";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Missing #root container.");
const params = new URLSearchParams(window.location.search);

const requestedSeed = Number(params.get("seed") ?? Number.NaN);
const snapshotMode = params.get("snapshot") === "1";
const highContrastMode = params.get("contrast") === "1";
const seededRandom = makeSeededRandom(Number.isFinite(requestedSeed) ? requestedSeed : 20260228);
const rand = () => (snapshotMode ? seededRandom() : Math.random());
const baseNowMs = snapshotMode ? Date.UTC(2026, 0, 1, 12, 0, 0) : Date.now();

type ExampleId =
  | "getting-started"
  | "axis-grid"
  | "events-api"
  | "vertexa-workbench"
  | "modebar-multi"
  | "perf-sync-6"
  | "bar-basics"
  | "bar-time"
  | "bar-interactions"
  | "heatmap-basics";

const EXAMPLES: Array<{ id: ExampleId; title: string; summary: string }> = [
  { id: "getting-started", title: "Getting Started", summary: "Minimal chart setup and basic trace rendering." },
  { id: "axis-grid", title: "Axis + Grid", summary: "Tick formatting, precision, time formatting, and grid styling." },
  { id: "events-api", title: "Events + API", summary: "Event hooks, live API updates, resize, and runtime stats." },
  { id: "vertexa-workbench", title: "Vertexa Workbench", summary: "Production-style toolbar, layer controls, selection workflow, and status telemetry." },
  { id: "modebar-multi", title: "Modebar Multi-Chart", summary: "Two charts on one page, each with a local integrated modebar." },
  { id: "perf-sync-6", title: "Perf Sync 6x1M", summary: "Six charts with 1M points each, synchronized zoom/pan and selection, no sampling." },
  { id: "bar-basics", title: "Bar Basics", summary: "Use bar traces with custom width, color, opacity, and base." },
  { id: "bar-time", title: "Bar + Time Axis", summary: "Render time-bucket bars and a trend line on a time axis." },
  { id: "bar-interactions", title: "Bar Interactions", summary: "Stream bar data in real time with appendPoints()." },
  { id: "heatmap-basics", title: "Heatmap Basics", summary: "Render a 2D heatmap with colorscale and z-range controls." }
];

function linkBar(active: ExampleId) {
  const baseQuery = new URLSearchParams();
  if (highContrastMode) baseQuery.set("contrast", "1");
  return EXAMPLES
    .map((example) => {
      const cls = example.id === active ? "demo-link is-active" : "demo-link";
      const query = new URLSearchParams(baseQuery);
      query.set("example", example.id);
      return `<a class="${cls}" href="/?${query.toString()}">${example.title}</a>`;
    })
    .join("");
}

function createDemoChart(host: HTMLElement, options: ChartOptions) {
  return new Chart(host, {
    ...options,
    a11y: {
      keyboardNavigation: true,
      highContrast: highContrastMode,
      ...(options.a11y ?? {})
    }
  });
}

type ExportFormat = "png" | "svg" | "csv";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportChartFile(chart: Chart, format: ExportFormat, fileStem: string) {
  const timestamp = Date.now();
  if (format === "png") {
    const blob = await chart.exportPng({ pixelRatio: 2 });
    downloadBlob(blob, `${fileStem}-${timestamp}.png`);
    return blob.size;
  }
  if (format === "svg") {
    const blob = await chart.exportSvg({ pixelRatio: 2 });
    downloadBlob(blob, `${fileStem}-${timestamp}.svg`);
    return blob.size;
  }
  const blob = chart.exportCsvPoints();
  downloadBlob(blob, `${fileStem}-points-${timestamp}.csv`);
  return blob.size;
}

function attachExportMenu(options: {
  container: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  chart: Chart;
  fileStem: string;
}) {
  const { container, trigger, menu, chart, fileStem } = options;
  let isOpen = false;
  let isExporting = false;

  const setOpen = (next: boolean) => {
    isOpen = next;
    container.classList.toggle("is-open", isOpen);
    trigger.setAttribute("aria-expanded", String(isOpen));
    menu.toggleAttribute("hidden", !isOpen);
  };

  const onTriggerClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isExporting) return;
    setOpen(!isOpen);
  };

  const onMenuClick = async (event: MouseEvent) => {
    if (isExporting) return;
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLButtonElement>("button[data-export-format]");
    if (!action) return;
    const format = action.dataset.exportFormat as ExportFormat | undefined;
    if (!format) return;
    isExporting = true;
    trigger.disabled = true;
    try {
      await exportChartFile(chart, format, fileStem);
    } catch (error) {
      console.error("Export failed.", error);
    } finally {
      isExporting = false;
      trigger.disabled = false;
      setOpen(false);
    }
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!isOpen) return;
    const target = event.target;
    if (target instanceof Node && container.contains(target)) return;
    setOpen(false);
  };

  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  };

  trigger.addEventListener("click", onTriggerClick);
  menu.addEventListener("click", onMenuClick);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
  setOpen(false);

  return () => {
    trigger.removeEventListener("click", onTriggerClick);
    menu.removeEventListener("click", onMenuClick);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onDocumentKeyDown);
  };
}

function attachFullscreenToggle(options: {
  button: HTMLButtonElement;
  target: HTMLElement;
  chart: Chart;
  normalSize: { width: number; height: number };
}) {
  const { button, target, chart, normalSize } = options;

  const setButtonState = (active: boolean) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    const label = active ? "Exit full screen" : "Enter full screen";
    button.title = label;
    button.setAttribute("aria-label", label);
  };

  const resizeForFullscreen = () => {
    if (document.fullscreenElement !== target) return;
    chart.setSize(Math.max(320, window.innerWidth), Math.max(240, window.innerHeight));
  };

  const onFullscreenChange = () => {
    const active = document.fullscreenElement === target;
    setButtonState(active);
    if (active) {
      resizeForFullscreen();
      return;
    }
    chart.setSize(normalSize.width, normalSize.height);
  };

  const onResize = () => {
    resizeForFullscreen();
  };

  const onClick = async () => {
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement && document.fullscreenElement !== target) {
        await document.exitFullscreen();
      }
      await target.requestFullscreen();
    } catch (error) {
      console.error("Fullscreen toggle failed.", error);
    }
  };

  button.addEventListener("click", onClick);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  window.addEventListener("resize", onResize);
  setButtonState(document.fullscreenElement === target);

  return () => {
    button.removeEventListener("click", onClick);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("resize", onResize);
  };
}

function mountShell(active: ExampleId, title: string, summary: string, panelHtml: string) {
  root.innerHTML = `
    <div class="demo-shell">
      <header class="demo-header">
        <h1>vertexa-chart docs playground</h1>
        <p>${summary}</p>
        ${highContrastMode ? "<p><strong>High-contrast mode:</strong> enabled via <code>?contrast=1</code>.</p>" : ""}
        <nav class="demo-links">${linkBar(active)}</nav>
      </header>
      <main class="demo-main">
        <section class="demo-chart-wrap">
          <h2>${title}</h2>
          <div id="chart-host" class="chart-host"></div>
        </section>
        <aside class="demo-panel">${panelHtml}</aside>
      </main>
    </div>
  `;

  const host = root.querySelector<HTMLDivElement>("#chart-host");
  const panel = root.querySelector<HTMLDivElement>(".demo-panel");
  if (!host || !panel) throw new Error("Demo shell did not render correctly.");
  return { host, panel };
}

function linspace(n: number, start: number, end: number) {
  const out = new Float32Array(n);
  if (n === 1) {
    out[0] = start;
    return out;
  }
  const span = end - start;
  for (let i = 0; i < n; i++) out[i] = start + (i / (n - 1)) * span;
  return out;
}

function makeWaveFromX(x: Float32Array, phase: number, amplitude: number, center: number, noise = 0) {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const t = i / Math.max(1, x.length - 1);
    y[i] = center + amplitude * Math.sin(t * Math.PI * 6 + phase) + (rand() - 0.5) * noise;
  }
  return y;
}

function makeRandomWalk(n: number, start = 50) {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let v = start;
  for (let i = 0; i < n; i++) {
    x[i] = i;
    v += (rand() - 0.5) * 2.2;
    y[i] = v;
  }
  return { x, y };
}

function runGettingStarted() {
  const { host, panel } = mountShell(
    "getting-started",
    "Example 1: Getting Started",
    "Create a chart, set layout, and render one line+marker trace.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=getting-started</code></p>
      <p>Chart methods used: <code>new Chart()</code>, <code>destroy()</code>.</p>
    `
  );
  const x = linspace(1600, 0, 100);
  const y = makeWaveFromX(x, 0.25, 18, 50, 1.2);

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    pickingMode: "both",
    theme: {
      colors: {
        background: "#f8fafc",
        text: "#0f172a",
        axis: "#64748b",
        grid: "#dbeafe",
        tooltipBackground: "#0f172a",
        tooltipText: "#f8fafc",
        palette: ["#0f766e", "#f97316", "#4338ca"]
      },
      fonts: {
        family: "\"IBM Plex Sans\", ui-sans-serif, system-ui, sans-serif",
        sizePx: 12,
        axisFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, sans-serif",
        axisSizePx: 12,
        tooltipFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, sans-serif",
        tooltipSizePx: 12
      },
      axis: {
        color: "#64748b",
        textColor: "#334155"
      },
      grid: {
        show: true,
        color: "#dbeafe",
        opacity: 0.9,
        strokeWidth: 1
      },
      tooltip: {
        background: "#0f172a",
        textColor: "#f8fafc",
        borderRadiusPx: 10,
        paddingX: 10,
        paddingY: 7,
        boxShadow: "0 10px 24px rgba(15,23,42,0.28)"
      }
    },
    layout: {
      title: "Sensor baseline",
      xaxis: { type: "linear", title: "Time (s)", tickFormat: ".0f" },
      yaxis: { type: "linear", title: "Value", precision: 2 },
      hovermode: "closest",
      annotations: [
        {
          type: "region",
          x0: 18,
          y0: 41,
          x1: 36,
          y1: 60,
          fill: "#67e8f9",
          fillOpacity: 0.18,
          stroke: "#0891b2",
          strokeOpacity: 0.35
        },
        {
          type: "line",
          x0: 62,
          y0: 28,
          x1: 78,
          y1: 74,
          color: "#0f172a",
          opacity: 0.55,
          widthPx: 1.5,
          dash: "dash"
        },
        {
          type: "label",
          x: 66,
          y: 72,
          text: "Drift window",
          color: "#0f172a",
          background: "#ffffff",
          backgroundOpacity: 0.85,
          anchor: "start",
          offsetXPx: 4,
          offsetYPx: -6
        }
      ],
      grid: {
        show: true,
        color: "#e5e7eb",
        axisColor: "#9ca3af",
        textColor: "#4b5563",
        opacity: 1,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "scatter",
        name: "Primary",
        x,
        y,
        mode: "lines+markers",
        line: { color: "#1f77b4", opacity: 0.7 },
        marker: { color: "#1f77b4", opacity: 0.35, sizePx: 2 },
        hovertemplate: "%{trace.name}<br>x=%{x}<br>y=%{y}<br>i=%{pointIndex}"
      }
    ]
  });

  panel.insertAdjacentHTML("beforeend", "<p>Use mouse wheel + drag in the plot area to zoom/pan.</p>");
  return () => chart.destroy();
}

function runAxisGrid() {
  const { host, panel } = mountShell(
    "axis-grid",
    "Example 2: Axis Tick Formatters + Grid Config",
    "Use time axes, numeric formatters, precision, and customized grid visuals.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=axis-grid</code></p>
      <p>Focus: <code>xaxis.timeFormat</code>, <code>yaxis.tickFormat</code>, <code>grid.*</code>.</p>
    `
  );

  const points = 96;
  const start = baseNowMs - 95 * 15 * 60_000;
  const x = Array.from({ length: points }, (_, i) => new Date(start + i * 15 * 60_000));
  const xTickValues = [x[0], x[24], x[48], x[72], x[95]];
  const y = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / Math.max(1, points - 1);
    y[i] = 20 + Math.sin(t * Math.PI * 3) * 1.2 + (rand() - 0.5) * 0.22;
  }

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    layout: {
      title: "Temperature (15-minute intervals)",
      hovermode: "x",
      xaxis: {
        type: "time",
        title: "Timestamp",
        tickValues: xTickValues,
        timeFormat: "%b %d %H:%M"
      },
      yaxis: {
        type: "linear",
        title: "Temp (C)",
        min: 18,
        max: 22,
        tickFormat: ".2f",
        precision: 2
      },
      annotations: [
        {
          type: "line",
          x0: x[48],
          y0: 18,
          x1: x[48],
          y1: 22,
          color: "#1e3a8a",
          opacity: 0.45,
          widthPx: 1.5,
          dash: "dot"
        },
        {
          type: "region",
          x0: x[28],
          y0: 18.7,
          x1: x[42],
          y1: 21.6,
          fill: "#bfdbfe",
          fillOpacity: 0.22,
          stroke: "#1d4ed8",
          strokeOpacity: 0.25
        },
        {
          type: "label",
          x: x[43],
          y: 21.7,
          text: "Service window",
          color: "#1e3a8a",
          background: "#eff6ff",
          backgroundOpacity: 0.92,
          anchor: "start",
          offsetXPx: 6
        }
      ],
      grid: {
        show: true,
        color: "#dbeafe",
        axisColor: "#334155",
        textColor: "#0f172a",
        opacity: 0.85,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "scatter",
        name: "Ambient",
        x,
        y,
        mode: "lines+markers",
        line: { color: "#2563eb", opacity: 0.8 },
        marker: { color: "#2563eb", opacity: 0.45, sizePx: 3 },
        hovertemplate: "%{trace.name}<br>%{x}<br>%{y}"
      }
    ]
  });

  panel.insertAdjacentHTML("beforeend", "<p>Hover in <code>x</code> mode to inspect aligned values.</p>");
  return () => chart.destroy();
}

function runEventsApi() {
  const { host, panel } = mountShell(
    "events-api",
    "Example 3: Event Hooks + Core Runtime API",
    "Track hover/click/zoom/legend events, mutate traces/layout/size, and inspect performance stats.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=events-api</code></p>
      <div class="btn-row">
        <button id="btn-traces">setTraces()</button>
        <button id="btn-append">appendPoints()</button>
        <button id="btn-layout">setLayout()</button>
        <button id="btn-export">exportPng()</button>
        <button id="btn-export-svg">exportSvg()</button>
        <button id="btn-export-csv">exportCsvPoints()</button>
        <button id="btn-size">setSize()</button>
        <button id="btn-stats">getPerformanceStats()</button>
      </div>
      <pre id="event-log" class="event-log"></pre>
    `
  );

  const logEl = panel.querySelector<HTMLPreElement>("#event-log");
  const tracesBtn = panel.querySelector<HTMLButtonElement>("#btn-traces");
  const appendBtn = panel.querySelector<HTMLButtonElement>("#btn-append");
  const layoutBtn = panel.querySelector<HTMLButtonElement>("#btn-layout");
  const exportBtn = panel.querySelector<HTMLButtonElement>("#btn-export");
  const exportSvgBtn = panel.querySelector<HTMLButtonElement>("#btn-export-svg");
  const exportCsvBtn = panel.querySelector<HTMLButtonElement>("#btn-export-csv");
  const sizeBtn = panel.querySelector<HTMLButtonElement>("#btn-size");
  const statsBtn = panel.querySelector<HTMLButtonElement>("#btn-stats");
  if (!logEl || !tracesBtn || !appendBtn || !layoutBtn || !exportBtn || !exportSvgBtn || !exportCsvBtn || !sizeBtn || !statsBtn) {
    throw new Error("Events example controls missing.");
  }

  const pushLog = (line: string) => {
    const rows = (logEl.textContent ?? "").split("\n").filter(Boolean);
    rows.unshift(line);
    logEl.textContent = rows.slice(0, 14).join("\n");
  };

  const traceA = makeRandomWalk(1400, 42);
  const traceB = makeRandomWalk(1400, 58);
  const STREAM_WINDOW = 1400;
  let streamStep = Math.max(
    Number(traceA.x[traceA.x.length - 1] ?? 0),
    Number(traceB.x[traceB.x.length - 1] ?? 0)
  ) + 1;
  let streamA = Number(traceA.y[traceA.y.length - 1] ?? 42);
  let streamB = Number(traceB.y[traceB.y.length - 1] ?? 58);
  let compact = false;
  let altLayout = false;
  let lastHoverKey = "";

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    pickingMode: "both",
    layout: {
      title: "Live interactions",
      hovermode: "closest",
      xaxis: { type: "linear", title: "Step", tickFormat: ".0f" },
      yaxis: { type: "linear", title: "Value", precision: 2 },
      annotations: [
        {
          type: "line",
          x0: 450,
          y0: 20,
          x1: 450,
          y1: 90,
          color: "#334155",
          opacity: 0.35,
          dash: "dash"
        },
        {
          type: "label",
          x: 450,
          y: 88,
          text: "checkpoint",
          color: "#334155",
          background: "#f8fafc",
          backgroundOpacity: 0.9,
          anchor: "middle",
          offsetYPx: -8
        }
      ],
      grid: {
        show: true,
        color: "#e5e7eb",
        axisColor: "#9ca3af",
        textColor: "#4b5563",
        opacity: 1,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "scatter",
        name: "Alpha",
        x: traceA.x,
        y: traceA.y,
        mode: "lines",
        line: { color: "#0f766e", opacity: 0.75 }
      },
      {
        type: "scatter",
        name: "Beta",
        x: traceB.x,
        y: traceB.y,
        mode: "lines+markers",
        line: { color: "#f97316", opacity: 0.65 },
        marker: { color: "#f97316", opacity: 0.28, sizePx: 2 }
      }
    ],
    onHover: (event) => {
      const p = event.point;
      if (!p) return;
      const key = `${p.traceIndex}:${p.pointIndex}`;
      if (key === lastHoverKey) return;
      lastHoverKey = key;
      pushLog(`hover trace=${p.traceIndex} point=${p.pointIndex}`);
    },
    onClick: (event) => {
      if (!event.point) {
        pushLog("click outside plot");
        return;
      }
      pushLog(`click trace=${event.point.traceIndex} point=${event.point.pointIndex}`);
    },
    onZoom: (event) => {
      pushLog(`zoom k=${event.k.toFixed(2)} x=${event.x.toFixed(0)} y=${event.y.toFixed(0)}`);
    },
    onLegendToggle: (event) => {
      pushLog(`legend trace=${event.traceIndex} ${String(event.previousVisible)} -> ${String(event.visible)}`);
    },
    onSelect: (event) => {
      pushLog(`select total=${event.totalPoints} traces=${event.points.length}`);
    },
    tooltip: {
      renderer: (ctx) =>
        `<strong>${ctx.trace.name ?? "Trace"}</strong><br/>i=${ctx.pointIndex}<br/>x=${ctx.x}<br/>y=${ctx.y}`
    }
  });

  tracesBtn.addEventListener("click", () => {
    const nextA = makeRandomWalk(1400, 40 + rand() * 4);
    const nextB = makeRandomWalk(1400, 57 + rand() * 4);
    chart.setTraces([
      {
        type: "scatter",
        name: "Alpha",
        x: nextA.x,
        y: nextA.y,
        mode: "lines",
        line: { color: "#0f766e", opacity: 0.75 }
      },
      {
        type: "scatter",
        name: "Beta",
        x: nextB.x,
        y: nextB.y,
        mode: "lines+markers",
        line: { color: "#f97316", opacity: 0.65 },
        marker: { color: "#f97316", opacity: 0.28, sizePx: 2 }
      }
    ]);
    streamStep = Math.max(
      Number(nextA.x[nextA.x.length - 1] ?? 0),
      Number(nextB.x[nextB.x.length - 1] ?? 0)
    ) + 1;
    streamA = Number(nextA.y[nextA.y.length - 1] ?? streamA);
    streamB = Number(nextB.y[nextB.y.length - 1] ?? streamB);
    pushLog("setTraces() applied");
  });

  appendBtn.addEventListener("click", () => {
    streamA += (rand() - 0.5) * 1.8;
    streamB += (rand() - 0.5) * 2.1;
    chart.appendPoints(
      [
        { traceIndex: 0, x: [streamStep], y: [streamA], maxPoints: STREAM_WINDOW },
        { traceIndex: 1, x: [streamStep], y: [streamB], maxPoints: STREAM_WINDOW }
      ],
      { maxPoints: STREAM_WINDOW }
    );
    pushLog(`appendPoints() step=${streamStep} window=${STREAM_WINDOW}`);
    streamStep += 1;
  });

  layoutBtn.addEventListener("click", () => {
    altLayout = !altLayout;
    chart.setLayout({
      title: altLayout ? "Live interactions (x-hover mode)" : "Live interactions",
      hovermode: altLayout ? "x" : "closest",
      xaxis: { type: "linear", title: "Step", tickFormat: ".0f" },
      yaxis: { type: "linear", title: "Value", precision: 2 },
      annotations: altLayout
        ? [
            {
              type: "region",
              x0: streamStep - 220,
              y0: 35,
              x1: streamStep - 80,
              y1: 72,
              fill: "#fde68a",
              fillOpacity: 0.22,
              stroke: "#92400e",
              strokeOpacity: 0.28
            },
            {
              type: "label",
              x: streamStep - 76,
              y: 73,
              text: "focus band",
              color: "#78350f",
              background: "#fffbeb",
              backgroundOpacity: 0.9,
              anchor: "start"
            }
          ]
        : [
            {
              type: "line",
              x0: streamStep - 180,
              y0: 20,
              x1: streamStep - 180,
              y1: 90,
              color: "#334155",
              opacity: 0.35,
              dash: "dash"
            }
          ],
      grid: altLayout
        ? { show: true, color: "#fde68a", axisColor: "#78350f", textColor: "#78350f", opacity: 0.75, strokeWidth: 1 }
        : { show: true, color: "#e5e7eb", axisColor: "#9ca3af", textColor: "#4b5563", opacity: 1, strokeWidth: 1 }
    });
    pushLog(`setLayout() hovermode=${altLayout ? "x" : "closest"}`);
  });

  exportBtn.addEventListener("click", async () => {
    const blob = await chart.exportPng({ pixelRatio: 2 });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vertexa-chart-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushLog(`exportPng() bytes=${blob.size}`);
  });

  exportSvgBtn.addEventListener("click", async () => {
    const blob = await chart.exportSvg({ pixelRatio: 2 });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vertexa-chart-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushLog(`exportSvg() bytes=${blob.size}`);
  });

  exportCsvBtn.addEventListener("click", () => {
    const blob = chart.exportCsvPoints();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vertexa-chart-points-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushLog(`exportCsvPoints() bytes=${blob.size}`);
  });

  sizeBtn.addEventListener("click", () => {
    compact = !compact;
    chart.setSize(compact ? 760 : 920, compact ? 430 : 520);
    pushLog(`setSize() -> ${compact ? "760x430" : "920x520"}`);
  });

  statsBtn.addEventListener("click", () => {
    const stats = chart.getPerformanceStats();
    pushLog(
      `stats fps=${stats.fps.toFixed(1)} sampled=${stats.sampledPoints} render=${stats.renderMs.last.toFixed(2)}ms pick=${stats.pickMs.last.toFixed(2)}ms`
    );
  });

  pushLog("Ready. Hover, click, shift-drag(box)/shift+alt-drag(lasso), zoom, and click legend.");
  return () => chart.destroy();
}

function runVertexaWorkbench() {
  root.innerHTML = `
    <section class="vx-shell">
      <header class="vx-topbar">
        <div class="vx-topbar-title">
          <h1>Vertexa Workbench</h1>
          <p>WebGPU traces + D3 overlay with pro-grade navigation and selection workflow.</p>
          <p class="vx-hint">Tip: use <code>Shift + drag</code> for box select and <code>Shift + Alt + drag</code> for lasso.</p>
        </div>
      </header>
      <div class="vx-main">
        <article class="vx-plot-card">
          <div class="vx-plot-head">
            <div>
              <h2>GPU Telemetry Sweep</h2>
              <p>Inspect live traces with snap modes, brush selection, and render tuning.</p>
            </div>
          </div>
          <div id="vx-chart-frame" class="vx-chart-frame">
            <div id="vx-chart-host" class="vx-chart-host"></div>
            <div class="vx-overlay-controls">
              <div class="vx-toolbar vx-modebar" role="toolbar" aria-label="Chart toolbar">
                <button id="vx-pan" class="vx-tool vx-tool-icon vx-tool--pan" title="Pan (drag + arrow keys)"><span class="sr-only">Pan</span></button>
                <button id="vx-zoom-in" class="vx-tool vx-tool-icon vx-tool--zoom-in" title="Zoom in (+)"><span class="sr-only">Zoom in</span></button>
                <button id="vx-zoom-out" class="vx-tool vx-tool-icon vx-tool--zoom-out" title="Zoom out (-)"><span class="sr-only">Zoom out</span></button>
                <button id="vx-reset" class="vx-tool vx-tool-icon vx-tool--reset" title="Reset view (0)"><span class="sr-only">Reset view</span></button>
                <button id="vx-fit" class="vx-tool vx-tool-icon vx-tool--fit" title="Fit to data (F)"><span class="sr-only">Fit to data</span></button>
                <button id="vx-autoscale-y" class="vx-tool vx-tool-icon vx-tool--autoscale" title="Autoscale Y (Y)"><span class="sr-only">Autoscale Y</span></button>
                <button id="vx-lock-aspect" class="vx-tool vx-tool-icon vx-tool--lock" title="Lock aspect (L)"><span class="sr-only">Lock aspect</span></button>
                <button id="vx-fullscreen" class="vx-tool vx-tool-icon vx-tool--fullscreen" title="Enter full screen"><span class="sr-only">Toggle full screen</span></button>
                <div id="vx-export-wrap" class="vx-export-menu">
                  <button id="vx-export" class="vx-tool vx-tool-icon vx-tool--export vx-tool-cta" title="Export" aria-haspopup="menu" aria-expanded="false"><span class="sr-only">Export</span></button>
                  <div id="vx-export-menu" class="vx-export-dropdown" role="menu" aria-label="Export options" hidden>
                    <button type="button" role="menuitem" data-export-format="png">PNG</button>
                    <button type="button" role="menuitem" data-export-format="svg">SVG</button>
                    <button type="button" role="menuitem" data-export-format="csv">CSV</button>
                  </div>
                </div>
              </div>
              <div class="vx-inspectbar">
                <label class="vx-field vx-overlay-field">
                  <span>Hover</span>
                  <select id="vx-hovermode">
                    <option value="closest">Nearest point</option>
                    <option value="x">Snap to x</option>
                    <option value="y">Snap to y</option>
                    <option value="none">No snap</option>
                  </select>
                </label>
                <details class="vx-legend-menu vx-overlay-legend">
                  <summary>Legend</summary>
                  <div id="vx-legend-list"></div>
                </details>
              </div>
            </div>
            <div id="vx-selection-pill" class="vx-selection-pill is-hidden">
              <span id="vx-selection-count">0 selected</span>
              <button id="vx-selection-clear" type="button">Clear</button>
              <button id="vx-selection-invert" type="button">Invert</button>
              <button id="vx-selection-filter" type="button">Filter</button>
            </div>
          </div>
          <footer id="vx-status" class="vx-status">Initializing chart...</footer>
        </article>
        <aside class="vx-panel">
          <h3>Layers</h3>
          <div id="vx-layers" class="vx-layers"></div>
          <h3>Render Modes</h3>
          <div class="vx-mode-row" id="vx-perf-modes">
            <button data-mode="quality" type="button">Quality</button>
            <button data-mode="balanced" type="button" class="is-active">Balanced</button>
            <button data-mode="max-fps" type="button">Max FPS</button>
          </div>
          <label class="vx-field">
            <span>Density / aggregation</span>
            <select id="vx-density">
              <option value="points">Points</option>
              <option value="density">Density heat</option>
              <option value="hexbin">Hexbin style</option>
            </select>
          </label>
          <button id="vx-thin-preset" type="button" class="vx-panel-btn">Thin lines preset</button>
          <div class="vx-badges">
            <span id="vx-lod-badge">LOD: 100%</span>
            <span id="vx-buffer-badge">GPU buffers: 0 MB</span>
          </div>
          <div class="vx-meter">
            <div id="vx-buffer-meter"></div>
          </div>
        </aside>
      </div>
    </section>
  `;

  const host = root.querySelector<HTMLDivElement>("#vx-chart-host");
  const statusEl = root.querySelector<HTMLElement>("#vx-status");
  const layersEl = root.querySelector<HTMLDivElement>("#vx-layers");
  const legendEl = root.querySelector<HTMLDivElement>("#vx-legend-list");
  const hoverModeEl = root.querySelector<HTMLSelectElement>("#vx-hovermode");
  const densityEl = root.querySelector<HTMLSelectElement>("#vx-density");
  const selectionPillEl = root.querySelector<HTMLDivElement>("#vx-selection-pill");
  const selectionCountEl = root.querySelector<HTMLSpanElement>("#vx-selection-count");
  const lodBadgeEl = root.querySelector<HTMLSpanElement>("#vx-lod-badge");
  const bufferBadgeEl = root.querySelector<HTMLSpanElement>("#vx-buffer-badge");
  const bufferMeterEl = root.querySelector<HTMLDivElement>("#vx-buffer-meter");
  if (!host || !statusEl || !layersEl || !legendEl || !hoverModeEl || !densityEl || !selectionPillEl || !selectionCountEl || !lodBadgeEl || !bufferBadgeEl || !bufferMeterEl) {
    throw new Error("Workbench shell failed to mount.");
  }

  type DensityMode = "points" | "density" | "hexbin";
  type LayerState = {
    id: string;
    name: string;
    color: string;
    visible: boolean;
    markerSize: number;
    lineWidth: number;
    x: number[];
    y: number[];
  };

  const makeSeries = (count: number, offset: number, jitter: number) => {
    const x: number[] = new Array(count);
    const y: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1);
      x[i] = t * 1200;
      y[i] = 52 + Math.sin(t * Math.PI * 11 + offset) * 14 + Math.cos(t * Math.PI * 5 + offset * 0.7) * 7 + (rand() - 0.5) * jitter;
    }
    return { x, y };
  };

  const a = makeSeries(120_000, 0.15, 1.3);
  const b = makeSeries(120_000, 1.1, 1.65);
  const c = makeSeries(90_000, 2.4, 2.1);
  const layers: LayerState[] = [
    { id: "alpha", name: "Alpha stream", color: "#126e82", visible: true, markerSize: 2, lineWidth: 1.4, x: a.x, y: a.y },
    { id: "beta", name: "Beta stream", color: "#f97316", visible: true, markerSize: 2, lineWidth: 1.2, x: b.x, y: b.y },
    { id: "gamma", name: "Gamma stream", color: "#0f172a", visible: true, markerSize: 1.6, lineWidth: 1.1, x: c.x, y: c.y }
  ];

  const selectedByLayer = new Map<string, Set<number>>();
  let hoverMode: HoverMode = "closest";
  let densityMode: DensityMode = "points";
  let perfMode: ChartPerformanceMode = "balanced";
  let aspectLocked = false;
  let selectedCount = 0;
  let lastPointer = { x: Number.NaN, y: Number.NaN };

  const layoutBase = {
    title: "GPU telemetry sweep",
    legend: { show: false },
    margin: { top: 26, right: 24, bottom: 44, left: 58 },
    xaxis: { type: "linear", title: "sample index", tickFormat: ".0f" },
    yaxis: { type: "linear", title: "value", precision: 2 },
    annotations: [
      { type: "line" as const, x0: 420, y0: 22, x1: 420, y1: 88, color: "#0f172a", opacity: 0.25, dash: "dash" as const },
      { type: "region" as const, x0: 660, y0: 34, x1: 820, y1: 74, fill: "#99f6e4", fillOpacity: 0.18, stroke: "#0f766e", strokeOpacity: 0.35 },
      { type: "label" as const, x: 824, y: 75, text: "Inspection region", color: "#115e59", background: "#ecfeff", backgroundOpacity: 0.9, anchor: "start" as const, offsetXPx: 5 }
    ],
    grid: { show: true, color: "#d6f5f0", axisColor: "#0e4c5a", textColor: "#12343b", opacity: 0.75, strokeWidth: 1 }
  };

  const buildSelectionTrace = (): Trace | null => {
    const x: number[] = [];
    const y: number[] = [];
    layers.forEach((layer) => {
      const set = selectedByLayer.get(layer.id);
      if (!set || set.size === 0) return;
      set.forEach((idx) => {
        if (idx < 0 || idx >= layer.x.length) return;
        x.push(layer.x[idx]);
        y.push(layer.y[idx]);
      });
    });
    if (x.length === 0) return null;
    return {
      type: "scatter",
      name: "Selection",
      x,
      y,
      mode: "markers",
      marker: { sizePx: 5, color: "#facc15", opacity: 0.95 },
      hovertemplate: "Selection<br>x=%{x}<br>y=%{y}<br>i=%{pointIndex}"
    };
  };

  const layerMode = (layer: LayerState) => {
    if (densityMode === "points") return "lines+markers" as const;
    return "markers" as const;
  };

  const layerMarker = (layer: LayerState) => {
    if (densityMode === "density") return { sizePx: Math.max(1, layer.markerSize - 1), color: layer.color, opacity: 0.14 };
    if (densityMode === "hexbin") return { sizePx: Math.max(2, layer.markerSize + 2), color: layer.color, opacity: 0.22 };
    return { sizePx: layer.markerSize, color: layer.color, opacity: 0.3 };
  };

  const layerLine = (layer: LayerState) => ({
    color: layer.color,
    opacity: densityMode === "points" ? 0.78 : 0.05,
    widthPx: densityMode === "points" ? layer.lineWidth : 0.8
  });

  const buildRenderableTraces = (): Trace[] => {
    const traces: Trace[] = layers.map((layer) => ({
      type: "scatter",
      name: layer.name,
      visible: layer.visible ? true : "legendonly",
      x: layer.x,
      y: layer.y,
      mode: layerMode(layer),
      marker: layerMarker(layer),
      line: layerLine(layer),
      hovertemplate: "%{trace.name}<br>x=%{x}<br>y=%{y}<br>i=%{pointIndex}"
    }));
    const selectionTrace = buildSelectionTrace();
    if (selectionTrace) traces.push(selectionTrace);
    return traces;
  };

  const WORKBENCH_SIZE = { width: 980, height: 620 };

  const chart = createDemoChart(host, {
    width: WORKBENCH_SIZE.width,
    height: WORKBENCH_SIZE.height,
    pickingMode: "both",
    theme: {
      colors: {
        background: "#f9fffd",
        text: "#0f172a",
        axis: "#0e4c5a",
        grid: "#d6f5f0",
        tooltipBackground: "#082f49",
        tooltipText: "#f8fafc",
        palette: layers.map((layer) => layer.color)
      },
      fonts: {
        family: "\"Space Grotesk\", \"Manrope\", ui-sans-serif, system-ui, sans-serif",
        sizePx: 12,
        axisFamily: "\"Space Grotesk\", \"Manrope\", ui-sans-serif, system-ui, sans-serif",
        axisSizePx: 12,
        tooltipFamily: "\"Manrope\", \"Space Grotesk\", ui-sans-serif, system-ui, sans-serif",
        tooltipSizePx: 12
      },
      tooltip: {
        borderRadiusPx: 10,
        paddingX: 10,
        paddingY: 7,
        boxShadow: "0 12px 26px rgba(8,47,73,0.24)"
      }
    },
    layout: {
      ...layoutBase,
      hovermode: hoverMode
    },
    traces: buildRenderableTraces(),
    onHover: (event) => {
      lastPointer = {
        x: Number(event.cursor.xData),
        y: Number(event.cursor.yData)
      };
    },
    onSelect: (event) => {
      selectedByLayer.clear();
      event.points.forEach((group) => {
        const layer = layers[group.traceIndex];
        if (!layer) return;
        selectedByLayer.set(layer.id, new Set(group.pointIndices));
      });
      updateSelectionState();
      chart.setTraces(buildRenderableTraces());
      renderLegend();
    }
  });
  chart.setPerformanceMode(perfMode);

  const fmtValue = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "n/a");
  const computeTotalPoints = () => layers.reduce((sum, layer) => sum + (layer.visible ? layer.x.length : 0), 0);
  const computeBufferMb = () => (computeTotalPoints() * 2 * 4 * 3) / (1024 * 1024);

  const updateSelectionState = () => {
    selectedCount = 0;
    layers.forEach((layer) => {
      selectedCount += selectedByLayer.get(layer.id)?.size ?? 0;
    });
    selectionCountEl.textContent = `${selectedCount.toLocaleString()} selected`;
    selectionPillEl.classList.toggle("is-hidden", selectedCount === 0);
  };

  const updateStatus = () => {
    const stats = chart.getPerformanceStats();
    const total = computeTotalPoints();
    const sampledPct = total > 0 ? (stats.sampledPoints / total) * 100 : 100;
    statusEl.textContent = `${total.toLocaleString()} points • ${stats.fps.toFixed(0)} FPS • ${selectedCount.toLocaleString()} selected • x=${fmtValue(lastPointer.x)} y=${fmtValue(lastPointer.y)}`;
    lodBadgeEl.textContent = sampledPct >= 99.5 ? "LOD: 100%" : `LOD: ${(sampledPct).toFixed(0)}% sample`;
    const bufferMb = computeBufferMb();
    bufferBadgeEl.textContent = `GPU buffers: ${bufferMb.toFixed(1)} MB`;
    bufferMeterEl.style.width = `${Math.max(4, Math.min(100, (bufferMb / 240) * 100))}%`;
  };

  const renderLegend = () => {
    legendEl.innerHTML = layers
      .map((layer) => `<div class="vx-legend-row"><span style="background:${layer.color}"></span>${layer.name}${layer.visible ? "" : " (hidden)"}</div>`)
      .join("");
  };

  const syncChartLayout = () => {
    chart.setLayout({
      ...layoutBase,
      hovermode: hoverMode
    });
  };

  const renderLayersPanel = () => {
    layersEl.innerHTML = layers
      .map((layer, idx) => `
        <section class="vx-layer-row" data-layer-id="${layer.id}">
          <header>
            <span class="vx-swatch" style="background:${layer.color}"></span>
            <strong>${layer.name}</strong>
          </header>
          <label><input type="checkbox" data-action="visible" ${layer.visible ? "checked" : ""}/> visible</label>
          <label>size <input type="range" min="1" max="8" step="0.5" value="${layer.markerSize}" data-action="size"/></label>
          <label>line <input type="range" min="0.6" max="4" step="0.2" value="${layer.lineWidth}" data-action="line"/></label>
          <div class="vx-layer-row-actions">
            <button type="button" data-action="up" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-action="down" ${idx === layers.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </section>
      `)
      .join("");

    layersEl.querySelectorAll<HTMLElement>(".vx-layer-row").forEach((row) => {
      const layerId = row.dataset.layerId ?? "";
      const layer = layers.find((candidate) => candidate.id === layerId);
      if (!layer) return;

      const visible = row.querySelector<HTMLInputElement>('input[data-action="visible"]');
      const size = row.querySelector<HTMLInputElement>('input[data-action="size"]');
      const line = row.querySelector<HTMLInputElement>('input[data-action="line"]');
      const up = row.querySelector<HTMLButtonElement>('button[data-action="up"]');
      const down = row.querySelector<HTMLButtonElement>('button[data-action="down"]');

      visible?.addEventListener("change", () => {
        layer.visible = visible.checked;
        chart.setTraces(buildRenderableTraces());
        updateStatus();
        renderLegend();
      });
      size?.addEventListener("input", () => {
        layer.markerSize = Number(size.value);
        chart.setTraces(buildRenderableTraces());
      });
      line?.addEventListener("input", () => {
        layer.lineWidth = Number(line.value);
        chart.setTraces(buildRenderableTraces());
      });
      up?.addEventListener("click", () => {
        const i = layers.findIndex((candidate) => candidate.id === layerId);
        if (i <= 0) return;
        const moved = layers.splice(i, 1)[0];
        layers.splice(i - 1, 0, moved);
        renderLayersPanel();
        chart.setTraces(buildRenderableTraces());
        renderLegend();
      });
      down?.addEventListener("click", () => {
        const i = layers.findIndex((candidate) => candidate.id === layerId);
        if (i < 0 || i >= layers.length - 1) return;
        const moved = layers.splice(i, 1)[0];
        layers.splice(i + 1, 0, moved);
        renderLayersPanel();
        chart.setTraces(buildRenderableTraces());
        renderLegend();
      });
    });
  };

  const selectionClearBtn = root.querySelector<HTMLButtonElement>("#vx-selection-clear");
  const selectionInvertBtn = root.querySelector<HTMLButtonElement>("#vx-selection-invert");
  const selectionFilterBtn = root.querySelector<HTMLButtonElement>("#vx-selection-filter");
  const thinPresetBtn = root.querySelector<HTMLButtonElement>("#vx-thin-preset");
  const chartFrame = root.querySelector<HTMLDivElement>("#vx-chart-frame");
  const exportWrap = root.querySelector<HTMLDivElement>("#vx-export-wrap");
  const exportMenu = root.querySelector<HTMLDivElement>("#vx-export-menu");
  const exportBtn = root.querySelector<HTMLButtonElement>("#vx-export");
  const fullscreenBtn = root.querySelector<HTMLButtonElement>("#vx-fullscreen");
  const zoomInBtn = root.querySelector<HTMLButtonElement>("#vx-zoom-in");
  const zoomOutBtn = root.querySelector<HTMLButtonElement>("#vx-zoom-out");
  const panBtn = root.querySelector<HTMLButtonElement>("#vx-pan");
  const resetBtn = root.querySelector<HTMLButtonElement>("#vx-reset");
  const fitBtn = root.querySelector<HTMLButtonElement>("#vx-fit");
  const autoscaleBtn = root.querySelector<HTMLButtonElement>("#vx-autoscale-y");
  const lockAspectBtn = root.querySelector<HTMLButtonElement>("#vx-lock-aspect");
  const perfModeWrap = root.querySelector<HTMLDivElement>("#vx-perf-modes");
  if (!selectionClearBtn || !selectionInvertBtn || !selectionFilterBtn || !thinPresetBtn || !chartFrame || !exportWrap || !exportMenu || !exportBtn || !fullscreenBtn || !zoomInBtn || !zoomOutBtn || !panBtn || !resetBtn || !fitBtn || !autoscaleBtn || !lockAspectBtn || !perfModeWrap) {
    throw new Error("Workbench controls failed to mount.");
  }

  selectionClearBtn.addEventListener("click", () => {
    selectedByLayer.clear();
    updateSelectionState();
    chart.setTraces(buildRenderableTraces());
    updateStatus();
  });

  selectionInvertBtn.addEventListener("click", () => {
    layers.forEach((layer) => {
      const prior = selectedByLayer.get(layer.id) ?? new Set<number>();
      const inverted = new Set<number>();
      for (let i = 0; i < layer.x.length; i++) {
        if (!prior.has(i)) inverted.add(i);
      }
      selectedByLayer.set(layer.id, inverted);
    });
    updateSelectionState();
    chart.setTraces(buildRenderableTraces());
    updateStatus();
  });

  selectionFilterBtn.addEventListener("click", () => {
    layers.forEach((layer) => {
      const selected = selectedByLayer.get(layer.id);
      if (!selected || selected.size === 0) return;
      const nextX: number[] = [];
      const nextY: number[] = [];
      selected.forEach((idx) => {
        if (idx < 0 || idx >= layer.x.length) return;
        nextX.push(layer.x[idx]);
        nextY.push(layer.y[idx]);
      });
      layer.x = nextX;
      layer.y = nextY;
    });
    selectedByLayer.clear();
    updateSelectionState();
    chart.setTraces(buildRenderableTraces());
    chart.fitToData();
    renderLayersPanel();
    renderLegend();
    updateStatus();
  });

  thinPresetBtn.addEventListener("click", () => {
    layers.forEach((layer) => {
      layer.lineWidth = 0.9;
      layer.markerSize = 1.2;
    });
    renderLayersPanel();
    chart.setTraces(buildRenderableTraces());
  });

  hoverModeEl.addEventListener("change", () => {
    hoverMode = hoverModeEl.value as HoverMode;
    syncChartLayout();
  });

  densityEl.addEventListener("change", () => {
    densityMode = densityEl.value as DensityMode;
    chart.setTraces(buildRenderableTraces());
  });

  perfModeWrap.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      perfMode = btn.dataset.mode as ChartPerformanceMode;
      chart.setPerformanceMode(perfMode);
      perfModeWrap.querySelectorAll("button").forEach((node) => node.classList.remove("is-active"));
      btn.classList.add("is-active");
      updateStatus();
    });
  });

  zoomInBtn.addEventListener("click", () => chart.zoomBy(1.22));
  zoomOutBtn.addEventListener("click", () => chart.zoomBy(1 / 1.22));
  panBtn.addEventListener("click", () => host.focus());
  resetBtn.addEventListener("click", () => chart.resetView());
  fitBtn.addEventListener("click", () => chart.fitToData());
  autoscaleBtn.addEventListener("click", () => chart.autoscaleY());
  lockAspectBtn.addEventListener("click", () => {
    aspectLocked = !aspectLocked;
    chart.setAspectLock(aspectLocked);
    lockAspectBtn.classList.toggle("is-active", aspectLocked);
  });

  const detachExportMenu = attachExportMenu({
    container: exportWrap,
    trigger: exportBtn,
    menu: exportMenu,
    chart,
    fileStem: "vertexa-workbench"
  });
  const detachFullscreenToggle = attachFullscreenToggle({
    button: fullscreenBtn,
    target: chartFrame,
    chart,
    normalSize: WORKBENCH_SIZE
  });

  const statusTimer = window.setInterval(() => updateStatus(), 700);
  renderLayersPanel();
  renderLegend();
  updateSelectionState();
  updateStatus();

  return () => {
    window.clearInterval(statusTimer);
    detachExportMenu();
    detachFullscreenToggle();
    chart.destroy();
  };
}

function runModebarMulti() {
  root.innerHTML = `
    <div class="demo-shell">
      <header class="demo-header">
        <h1>vertexa-chart docs playground</h1>
        <p>Integrated per-chart modebars for multi-chart pages (Plotly-style placement).</p>
        <nav class="demo-links">${linkBar("modebar-multi")}</nav>
      </header>
      <section class="vx-multi-grid">
        <article class="vx-mini-card">
          <h2>Chart A: Throughput</h2>
          <div id="mc-a-frame" class="vx-mini-frame">
            <div id="mc-a-host" class="vx-mini-host"></div>
            <div class="vx-mini-controls">
              <div class="vx-toolbar vx-modebar" role="toolbar" aria-label="Chart A modebar">
                <button id="mc-a-pan" class="vx-tool vx-tool-icon vx-tool--pan" title="Pan nudge / focus"><span class="sr-only">Pan</span></button>
                <button id="mc-a-zoom-in" class="vx-tool vx-tool-icon vx-tool--zoom-in" title="Zoom in"><span class="sr-only">Zoom in</span></button>
                <button id="mc-a-zoom-out" class="vx-tool vx-tool-icon vx-tool--zoom-out" title="Zoom out"><span class="sr-only">Zoom out</span></button>
                <button id="mc-a-reset" class="vx-tool vx-tool-icon vx-tool--reset" title="Reset view"><span class="sr-only">Reset view</span></button>
                <button id="mc-a-fit" class="vx-tool vx-tool-icon vx-tool--fit" title="Fit to data"><span class="sr-only">Fit to data</span></button>
                <button id="mc-a-autoscale" class="vx-tool vx-tool-icon vx-tool--autoscale" title="Autoscale Y"><span class="sr-only">Autoscale Y</span></button>
                <button id="mc-a-lock" class="vx-tool vx-tool-icon vx-tool--lock" title="Lock aspect"><span class="sr-only">Lock aspect</span></button>
                <button id="mc-a-fullscreen" class="vx-tool vx-tool-icon vx-tool--fullscreen" title="Enter full screen"><span class="sr-only">Toggle full screen</span></button>
                <div id="mc-a-export-wrap" class="vx-export-menu">
                  <button id="mc-a-export" class="vx-tool vx-tool-icon vx-tool--export vx-tool-cta" title="Export" aria-haspopup="menu" aria-expanded="false"><span class="sr-only">Export</span></button>
                  <div id="mc-a-export-menu" class="vx-export-dropdown" role="menu" aria-label="Export options" hidden>
                    <button type="button" role="menuitem" data-export-format="png">PNG</button>
                    <button type="button" role="menuitem" data-export-format="svg">SVG</button>
                    <button type="button" role="menuitem" data-export-format="csv">CSV</button>
                  </div>
                </div>
              </div>
              <label class="vx-field vx-overlay-field">
                <span>Hover</span>
                <select id="mc-a-hover">
                  <option value="closest">Nearest</option>
                  <option value="x">Snap x</option>
                  <option value="y">Snap y</option>
                  <option value="none">No snap</option>
                </select>
              </label>
            </div>
          </div>
          <footer id="mc-a-status" class="vx-status">Chart A ready</footer>
        </article>
        <article class="vx-mini-card">
          <h2>Chart B: Latency</h2>
          <div id="mc-b-frame" class="vx-mini-frame">
            <div id="mc-b-host" class="vx-mini-host"></div>
            <div class="vx-mini-controls">
              <div class="vx-toolbar vx-modebar" role="toolbar" aria-label="Chart B modebar">
                <button id="mc-b-pan" class="vx-tool vx-tool-icon vx-tool--pan" title="Pan nudge / focus"><span class="sr-only">Pan</span></button>
                <button id="mc-b-zoom-in" class="vx-tool vx-tool-icon vx-tool--zoom-in" title="Zoom in"><span class="sr-only">Zoom in</span></button>
                <button id="mc-b-zoom-out" class="vx-tool vx-tool-icon vx-tool--zoom-out" title="Zoom out"><span class="sr-only">Zoom out</span></button>
                <button id="mc-b-reset" class="vx-tool vx-tool-icon vx-tool--reset" title="Reset view"><span class="sr-only">Reset view</span></button>
                <button id="mc-b-fit" class="vx-tool vx-tool-icon vx-tool--fit" title="Fit to data"><span class="sr-only">Fit to data</span></button>
                <button id="mc-b-autoscale" class="vx-tool vx-tool-icon vx-tool--autoscale" title="Autoscale Y"><span class="sr-only">Autoscale Y</span></button>
                <button id="mc-b-lock" class="vx-tool vx-tool-icon vx-tool--lock" title="Lock aspect"><span class="sr-only">Lock aspect</span></button>
                <button id="mc-b-fullscreen" class="vx-tool vx-tool-icon vx-tool--fullscreen" title="Enter full screen"><span class="sr-only">Toggle full screen</span></button>
                <div id="mc-b-export-wrap" class="vx-export-menu">
                  <button id="mc-b-export" class="vx-tool vx-tool-icon vx-tool--export vx-tool-cta" title="Export" aria-haspopup="menu" aria-expanded="false"><span class="sr-only">Export</span></button>
                  <div id="mc-b-export-menu" class="vx-export-dropdown" role="menu" aria-label="Export options" hidden>
                    <button type="button" role="menuitem" data-export-format="png">PNG</button>
                    <button type="button" role="menuitem" data-export-format="svg">SVG</button>
                    <button type="button" role="menuitem" data-export-format="csv">CSV</button>
                  </div>
                </div>
              </div>
              <label class="vx-field vx-overlay-field">
                <span>Hover</span>
                <select id="mc-b-hover">
                  <option value="closest">Nearest</option>
                  <option value="x">Snap x</option>
                  <option value="y">Snap y</option>
                  <option value="none">No snap</option>
                </select>
              </label>
            </div>
          </div>
          <footer id="mc-b-status" class="vx-status">Chart B ready</footer>
        </article>
      </section>
    </div>
  `;

  const makeSeries = (count: number, phase: number, amp: number, center: number, noise: number) => {
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1);
      x[i] = i;
      y[i] = center + Math.sin(t * Math.PI * 8 + phase) * amp + Math.cos(t * Math.PI * 3 + phase * 0.8) * (amp * 0.3) + (rand() - 0.5) * noise;
    }
    return { x, y };
  };

  const initMiniChart = (
    prefix: "mc-a" | "mc-b",
    title: string,
    palette: [string, string],
    seriesA: { x: Float32Array; y: Float32Array },
    seriesB: { x: Float32Array; y: Float32Array }
  ) => {
    const MINI_SIZE = { width: 640, height: 360 };
    const host = root.querySelector<HTMLDivElement>(`#${prefix}-host`);
    const frame = root.querySelector<HTMLDivElement>(`#${prefix}-frame`);
    const status = root.querySelector<HTMLElement>(`#${prefix}-status`);
    const pan = root.querySelector<HTMLButtonElement>(`#${prefix}-pan`);
    const zoomIn = root.querySelector<HTMLButtonElement>(`#${prefix}-zoom-in`);
    const zoomOut = root.querySelector<HTMLButtonElement>(`#${prefix}-zoom-out`);
    const reset = root.querySelector<HTMLButtonElement>(`#${prefix}-reset`);
    const fit = root.querySelector<HTMLButtonElement>(`#${prefix}-fit`);
    const autoscale = root.querySelector<HTMLButtonElement>(`#${prefix}-autoscale`);
    const lock = root.querySelector<HTMLButtonElement>(`#${prefix}-lock`);
    const exportWrap = root.querySelector<HTMLDivElement>(`#${prefix}-export-wrap`);
    const exportMenu = root.querySelector<HTMLDivElement>(`#${prefix}-export-menu`);
    const exportBtn = root.querySelector<HTMLButtonElement>(`#${prefix}-export`);
    const fullscreenBtn = root.querySelector<HTMLButtonElement>(`#${prefix}-fullscreen`);
    const hover = root.querySelector<HTMLSelectElement>(`#${prefix}-hover`);
    if (!host || !frame || !status || !pan || !zoomIn || !zoomOut || !reset || !fit || !autoscale || !lock || !exportWrap || !exportMenu || !exportBtn || !fullscreenBtn || !hover) {
      throw new Error(`Missing modebar controls for ${prefix}.`);
    }

    let hoverMode: HoverMode = "closest";
    let aspectLocked = false;
    let pointer = { x: Number.NaN, y: Number.NaN };
    const baseLayout = {
      title,
      legend: { show: false },
      margin: { top: 22, right: 18, bottom: 36, left: 52 },
      xaxis: { type: "linear", title: "sample", tickFormat: ".0f" },
      yaxis: { type: "linear", title: "value", precision: 2 },
      grid: { show: true, color: "#dbeafe", axisColor: "#3b82f6", textColor: "#1e3a8a", opacity: 0.65, strokeWidth: 1 }
    } as const;

    const chart = createDemoChart(host, {
      width: MINI_SIZE.width,
      height: MINI_SIZE.height,
      pickingMode: "both",
      theme: {
        colors: {
          background: "#f8fbff",
          text: "#0f172a",
          axis: "#1e40af",
          grid: "#dbeafe",
          tooltipBackground: "#0f172a",
          tooltipText: "#f8fafc",
          palette
        }
      },
      layout: { ...baseLayout, hovermode: hoverMode },
      traces: [
        {
          type: "scatter",
          name: "Primary",
          x: seriesA.x,
          y: seriesA.y,
          mode: "lines+markers",
          line: { color: palette[0], widthPx: 1.4, opacity: 0.76 },
          marker: { color: palette[0], sizePx: 2, opacity: 0.25 }
        },
        {
          type: "scatter",
          name: "Secondary",
          x: seriesB.x,
          y: seriesB.y,
          mode: "lines",
          line: { color: palette[1], widthPx: 1.2, opacity: 0.82 }
        }
      ],
      onHover: (event) => {
        pointer = {
          x: Number(event.cursor.xData),
          y: Number(event.cursor.yData)
        };
      }
    });

    const syncStatus = () => {
      const stats = chart.getPerformanceStats();
      const x = Number.isFinite(pointer.x) ? pointer.x.toFixed(1) : "n/a";
      const y = Number.isFinite(pointer.y) ? pointer.y.toFixed(2) : "n/a";
      status.textContent = `${stats.fps.toFixed(0)} FPS • ${stats.sampledPoints.toLocaleString()} sampled • x=${x} y=${y}`;
    };

    pan.addEventListener("click", () => {
      host.focus();
      chart.panBy(56, 0);
    });
    zoomIn.addEventListener("click", () => chart.zoomBy(1.2));
    zoomOut.addEventListener("click", () => chart.zoomBy(1 / 1.2));
    reset.addEventListener("click", () => chart.resetView());
    fit.addEventListener("click", () => chart.fitToData());
    autoscale.addEventListener("click", () => chart.autoscaleY());
    lock.addEventListener("click", () => {
      aspectLocked = !aspectLocked;
      chart.setAspectLock(aspectLocked);
      lock.classList.toggle("is-active", aspectLocked);
    });
    hover.addEventListener("change", () => {
      hoverMode = hover.value as HoverMode;
      chart.setLayout({ ...baseLayout, hovermode: hoverMode });
    });
    const detachExportMenu = attachExportMenu({
      container: exportWrap,
      trigger: exportBtn,
      menu: exportMenu,
      chart,
      fileStem: prefix
    });
    const detachFullscreenToggle = attachFullscreenToggle({
      button: fullscreenBtn,
      target: frame,
      chart,
      normalSize: MINI_SIZE
    });

    const timer = window.setInterval(syncStatus, 650);
    syncStatus();
    return () => {
      window.clearInterval(timer);
      detachExportMenu();
      detachFullscreenToggle();
      chart.destroy();
    };
  };

  const a1 = makeSeries(14_000, 0.2, 12, 56, 1.2);
  const a2 = makeSeries(14_000, 0.9, 8, 51, 0.8);
  const b1 = makeSeries(10_000, 1.4, 7.5, 31, 0.7);
  const b2 = makeSeries(10_000, 2.1, 5.2, 28, 0.5);

  const destroyA = initMiniChart("mc-a", "Ingress throughput", ["#0f766e", "#0284c7"], a1, a2);
  const destroyB = initMiniChart("mc-b", "P95 latency", ["#dc2626", "#7c3aed"], b1, b2);

  return () => {
    destroyA();
    destroyB();
  };
}

function runPerfSync6() {
  const CHART_COUNT = 6;
  const POINTS_PER_CHART = 1_000_000;
  const CHART_HEIGHT = 250;
  const chartTitles = [
    "Ingress Throughput",
    "P95 Latency",
    "Queue Depth",
    "CPU Saturation",
    "I/O Wait",
    "Error Burst"
  ] as const;
  const palette = ["#0f766e", "#0ea5e9", "#f97316", "#ef4444", "#7c3aed", "#1d4ed8"] as const;

  const cardHtml = chartTitles
    .map(
      (title, i) => `
        <article class="perf-card">
          <header class="perf-card-head">
            <h2>${title}</h2>
            <p>
              <span id="perf-fps-${i}">-- FPS</span>
              <span class="perf-divider">|</span>
              <span id="perf-sampled-${i}">-- drawn</span>
              <span class="perf-divider">|</span>
              <span id="perf-selected-${i}">0 selected</span>
            </p>
          </header>
          <div id="perf-host-${i}" class="perf-host"></div>
        </article>
      `
    )
    .join("");

  root.innerHTML = `
    <div class="demo-shell perf-shell">
      <header class="demo-header">
        <h1>vertexa-chart performance playground</h1>
        <p>6 charts, 1,000,000 points each, synchronized zoom + selection, full-resolution rendering.</p>
        ${highContrastMode ? "<p><strong>High-contrast mode:</strong> enabled via <code>?contrast=1</code>.</p>" : ""}
        <nav class="demo-links">${linkBar("perf-sync-6")}</nav>
        <div class="perf-toolbar">
          <button id="perf-reset-all" class="perf-btn" type="button">Reset All Views</button>
          <button id="perf-clear-selection" class="perf-btn" type="button">Clear Selection</button>
          <span id="perf-zoom-state" class="perf-pill">Zoom k=1.00 tx=0 ty=0</span>
          <span id="perf-selection-state" class="perf-pill">Selection: none</span>
          <span id="perf-sampling-state" class="perf-pill">Sampling check pending...</span>
        </div>
      </header>
      <main class="perf-main">
        <section class="perf-grid">${cardHtml}</section>
        <aside class="demo-panel perf-panel">
          <h3>Scenario</h3>
          <p>Every chart renders all 1,000,000 points with <code>setPerformanceMode("quality")</code> (LOD off).</p>
          <p>Zoom or pan any chart and the same transform is mirrored to the other five charts.</p>
          <p>Use <code>Shift + drag</code> to box-select; the selected data window is synchronized across all charts.</p>
          <p>Selection counts are computed against the full arrays, not sampled subsets.</p>
        </aside>
      </main>
    </div>
  `;

  const resetAllBtn = root.querySelector<HTMLButtonElement>("#perf-reset-all");
  const clearSelectionBtn = root.querySelector<HTMLButtonElement>("#perf-clear-selection");
  const zoomStateEl = root.querySelector<HTMLSpanElement>("#perf-zoom-state");
  const selectionStateEl = root.querySelector<HTMLSpanElement>("#perf-selection-state");
  const samplingStateEl = root.querySelector<HTMLSpanElement>("#perf-sampling-state");
  if (!resetAllBtn || !clearSelectionBtn || !zoomStateEl || !selectionStateEl || !samplingStateEl) {
    throw new Error("Performance demo controls failed to render.");
  }

  const hosts: HTMLDivElement[] = [];
  const fpsEls: HTMLSpanElement[] = [];
  const sampledEls: HTMLSpanElement[] = [];
  const selectedEls: HTMLSpanElement[] = [];
  for (let i = 0; i < CHART_COUNT; i++) {
    const host = root.querySelector<HTMLDivElement>(`#perf-host-${i}`);
    const fps = root.querySelector<HTMLSpanElement>(`#perf-fps-${i}`);
    const sampled = root.querySelector<HTMLSpanElement>(`#perf-sampled-${i}`);
    const selected = root.querySelector<HTMLSpanElement>(`#perf-selected-${i}`);
    if (!host || !fps || !sampled || !selected) {
      throw new Error(`Performance card ${i + 1} failed to render.`);
    }
    hosts.push(host);
    fpsEls.push(fps);
    sampledEls.push(sampled);
    selectedEls.push(selected);
  }

  const xSeries = new Float32Array(POINTS_PER_CHART);
  for (let i = 0; i < POINTS_PER_CHART; i++) xSeries[i] = i;

  const ySeries = Array.from({ length: CHART_COUNT }, (_unused, chartIndex) => {
    const out = new Float32Array(POINTS_PER_CHART);
    const phase = chartIndex * 0.62;
    const freqA = 2.4 + chartIndex * 0.21;
    const freqB = 7.8 + chartIndex * 0.35;
    const freqC = 21 + chartIndex * 1.2;
    for (let i = 0; i < POINTS_PER_CHART; i++) {
      const t = i / Math.max(1, POINTS_PER_CHART - 1);
      out[i] =
        Math.sin(t * Math.PI * freqA + phase) * 0.76 +
        Math.cos(t * Math.PI * freqB + phase * 0.8) * 0.31 +
        Math.sin(t * Math.PI * freqC + phase * 0.4) * 0.08;
    }
    return out;
  });

  type SelectionWindow = { x0: number; x1: number; y0: number; y1: number };
  let selection: SelectionWindow | null = null;
  const zoomStates = Array.from({ length: CHART_COUNT }, () => ({ k: 1, x: 0, y: 0 }));
  const charts: Chart[] = [];
  let syncingZoom = false;

  const buildLayout = (title: string, selected: SelectionWindow | null): ChartOptions["layout"] => {
    const x0 = selected ? Math.min(selected.x0, selected.x1) : 0;
    const x1 = selected ? Math.max(selected.x0, selected.x1) : 0;
    const y0 = selected ? Math.min(selected.y0, selected.y1) : 0;
    const y1 = selected ? Math.max(selected.y0, selected.y1) : 0;
    return {
      title,
      hovermode: "none",
      legend: { show: false },
      margin: { top: 24, right: 14, bottom: 36, left: 52 },
      xaxis: { type: "linear", title: "Index", tickFormat: ".0f", min: 0, max: POINTS_PER_CHART - 1 },
      yaxis: { type: "linear", title: "Signal", min: -1.35, max: 1.35, precision: 3 },
      annotations: selected
        ? [
            {
              type: "region",
              x0,
              y0,
              x1,
              y1,
              fill: "#0ea5e9",
              fillOpacity: 0.12,
              stroke: "#0369a1",
              strokeOpacity: 0.42,
              strokeWidthPx: 1.5
            },
            {
              type: "label",
              x: x1,
              y: y1,
              text: "synced selection",
              color: "#0f172a",
              background: "#ecfeff",
              backgroundOpacity: 0.9,
              anchor: "end",
              offsetYPx: -8
            }
          ]
        : [],
      grid: {
        show: true,
        color: "#dbeafe",
        axisColor: "#2563eb",
        textColor: "#1e3a8a",
        opacity: 0.75,
        strokeWidth: 1
      }
    };
  };

  const toNumberOrNull = (value: unknown): number | null => {
    if (value instanceof Date) return value.getTime();
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const updateZoomPill = (zoom: { k: number; x: number; y: number }) => {
    zoomStateEl.textContent = `Zoom k=${zoom.k.toFixed(2)} tx=${zoom.x.toFixed(0)} ty=${zoom.y.toFixed(0)}`;
  };

  const countSelectedPoints = (series: Float32Array, window: SelectionWindow) => {
    const minX = Math.max(0, Math.ceil(Math.min(window.x0, window.x1)));
    const maxX = Math.min(series.length - 1, Math.floor(Math.max(window.x0, window.x1)));
    if (maxX < minX) return 0;
    const minY = Math.min(window.y0, window.y1);
    const maxY = Math.max(window.y0, window.y1);
    let count = 0;
    for (let i = minX; i <= maxX; i++) {
      const y = series[i];
      if (y >= minY && y <= maxY) count++;
    }
    return count;
  };

  const applySelection = () => {
    let totalSelected = 0;
    for (let i = 0; i < CHART_COUNT; i++) {
      charts[i].setLayout(buildLayout(chartTitles[i], selection));
      const count = selection ? countSelectedPoints(ySeries[i], selection) : 0;
      totalSelected += count;
      selectedEls[i].textContent = `${count.toLocaleString()} selected`;
    }

    if (!selection) {
      selectionStateEl.textContent = "Selection: none";
      return;
    }
    const x0 = Math.min(selection.x0, selection.x1);
    const x1 = Math.max(selection.x0, selection.x1);
    const y0 = Math.min(selection.y0, selection.y1);
    const y1 = Math.max(selection.y0, selection.y1);
    selectionStateEl.textContent =
      `Selection x=[${x0.toFixed(0)}, ${x1.toFixed(0)}] y=[${y0.toFixed(2)}, ${y1.toFixed(2)}] (${totalSelected.toLocaleString()} total)`;
  };

  const syncZoomFrom = (sourceIndex: number, target: { k: number; x: number; y: number }) => {
    syncingZoom = true;
    try {
      for (let i = 0; i < CHART_COUNT; i++) {
        if (i === sourceIndex) continue;
        const current = zoomStates[i];
        const safeCurrentK = Math.max(1e-6, current.k);
        const safeTargetK = Math.max(1e-6, target.k);
        const factor = safeTargetK / safeCurrentK;
        if (Math.abs(factor - 1) > 1e-9) {
          charts[i].zoomBy(factor, { x: 0, y: 0 });
        }

        const scaledX = current.x * factor;
        const scaledY = current.y * factor;
        const dx = target.x - scaledX;
        const dy = target.y - scaledY;
        if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) {
          charts[i].panBy(dx, dy);
        }
        zoomStates[i] = { ...target };
      }
    } finally {
      syncingZoom = false;
    }
    updateZoomPill(target);
  };

  const renderPerfStats = () => {
    let allFullResolution = true;
    let slowestFps = Number.POSITIVE_INFINITY;
    let totalRendered = 0;
    for (let i = 0; i < CHART_COUNT; i++) {
      const stats = charts[i].getPerformanceStats();
      const fps = Number.isFinite(stats.fps) ? stats.fps : 0;
      slowestFps = Math.min(slowestFps, fps);
      totalRendered += stats.sampledPoints;
      allFullResolution = allFullResolution && stats.sampledPoints === POINTS_PER_CHART;
      fpsEls[i].textContent = `${fps.toFixed(1)} FPS`;
      sampledEls[i].textContent = `${stats.sampledPoints.toLocaleString()} drawn`;
    }

    samplingStateEl.textContent = allFullResolution
      ? `Sampling OFF (quality mode): ${totalRendered.toLocaleString()} points/frame`
      : `Sampling detected: ${totalRendered.toLocaleString()} points/frame`;
    samplingStateEl.classList.toggle("is-ok", allFullResolution);
    samplingStateEl.classList.toggle("is-warn", !allFullResolution);
    if (Number.isFinite(slowestFps)) {
      samplingStateEl.title = `Slowest chart: ${slowestFps.toFixed(1)} FPS`;
    }
  };

  for (let i = 0; i < CHART_COUNT; i++) {
    const chart = createDemoChart(hosts[i], {
      width: Math.max(320, Math.floor(hosts[i].clientWidth || 320)),
      height: CHART_HEIGHT,
      pickingMode: "cpu",
      layout: buildLayout(chartTitles[i], selection),
      traces: [
        {
          type: "scatter",
          name: chartTitles[i],
          x: xSeries,
          y: ySeries[i],
          mode: "markers",
          marker: {
            color: palette[i],
            sizePx: 1.2,
            opacity: 0.62
          }
        }
      ],
      onZoom: (event) => {
        zoomStates[i] = { ...event };
        if (syncingZoom) return;
        syncZoomFrom(i, event);
      },
      onSelect: (event) => {
        const x0 = toNumberOrNull(event.box.x0Data);
        const x1 = toNumberOrNull(event.box.x1Data);
        const y0 = toNumberOrNull(event.box.y0Data);
        const y1 = toNumberOrNull(event.box.y1Data);
        if (x0 === null || x1 === null || y0 === null || y1 === null) return;
        selection = { x0, x1, y0, y1 };
        applySelection();
      }
    });
    chart.setPerformanceMode("quality");
    charts.push(chart);
    selectedEls[i].textContent = "0 selected";
  }

  const resizeAll = () => {
    for (let i = 0; i < CHART_COUNT; i++) {
      const width = Math.max(320, Math.floor(hosts[i].clientWidth || 320));
      charts[i].setSize(width, CHART_HEIGHT);
    }
  };

  const onResetAll = () => {
    syncingZoom = true;
    try {
      for (let i = 0; i < CHART_COUNT; i++) {
        charts[i].resetView();
        zoomStates[i] = { k: 1, x: 0, y: 0 };
      }
    } finally {
      syncingZoom = false;
    }
    updateZoomPill({ k: 1, x: 0, y: 0 });
  };

  const onClearSelection = () => {
    if (!selection) return;
    selection = null;
    applySelection();
  };

  window.requestAnimationFrame(resizeAll);
  window.addEventListener("resize", resizeAll);
  resetAllBtn.addEventListener("click", onResetAll);
  clearSelectionBtn.addEventListener("click", onClearSelection);

  updateZoomPill({ k: 1, x: 0, y: 0 });
  applySelection();
  renderPerfStats();
  const statsTimer = window.setInterval(renderPerfStats, 900);

  return () => {
    window.clearInterval(statsTimer);
    window.removeEventListener("resize", resizeAll);
    resetAllBtn.removeEventListener("click", onResetAll);
    clearSelectionBtn.removeEventListener("click", onClearSelection);
    for (const chart of charts) chart.destroy();
  };
}

function runBarBasics() {
  const { host, panel } = mountShell(
    "bar-basics",
    "Example 4: Bar Trace Basics",
    "Render grouped bars with per-trace width/color/opacity and toggle custom base values.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=bar-basics</code></p>
      <div class="btn-row">
        <button id="btn-randomize-bars">setTraces()</button>
        <button id="btn-toggle-base">toggle bar.base</button>
      </div>
      <pre id="bar-log" class="event-log"></pre>
    `
  );

  const randomizeBtn = panel.querySelector<HTMLButtonElement>("#btn-randomize-bars");
  const baseBtn = panel.querySelector<HTMLButtonElement>("#btn-toggle-base");
  const logEl = panel.querySelector<HTMLPreElement>("#bar-log");
  if (!randomizeBtn || !baseBtn || !logEl) throw new Error("Bar basics controls missing.");

  const pushLog = (line: string) => {
    const rows = (logEl.textContent ?? "").split("\n").filter(Boolean);
    rows.unshift(line);
    logEl.textContent = rows.slice(0, 10).join("\n");
  };

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  let baseMode = false;

  const makeValues = (seedOffset: number) =>
    new Float32Array(
      months.map((m) => 45 + Math.sin((m + seedOffset) * 0.55) * 12 + (rand() - 0.5) * 6)
    );

  let north = makeValues(0.2);
  let south = makeValues(1.3);

  const buildTraces = () => [
    {
      type: "bar" as const,
      name: "North",
      x: months.map((m) => m - 0.14),
      y: north,
      bar: {
        widthPx: 14,
        color: "#0f766e",
        opacity: 0.72,
        base: baseMode ? 35 : 0
      }
    },
    {
      type: "bar" as const,
      name: "South",
      x: months.map((m) => m + 0.14),
      y: south,
      bar: {
        widthPx: 14,
        color: "#f97316",
        opacity: 0.66,
        base: baseMode ? 35 : 0
      }
    }
  ];

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    layout: {
      title: "Regional monthly totals",
      hovermode: "closest",
      xaxis: { type: "linear", title: "Month", tickFormat: ".0f", min: 0.5, max: 12.5 },
      yaxis: { type: "linear", title: "Units", precision: 1 },
      annotations: [
        {
          type: "region",
          x0: 3.5,
          y0: 35,
          x1: 6.5,
          y1: 72,
          fill: "#dcfce7",
          fillOpacity: 0.28,
          stroke: "#166534",
          strokeOpacity: 0.25
        },
        {
          type: "label",
          x: 6.55,
          y: 71,
          text: "Q2 focus",
          color: "#14532d",
          background: "#f0fdf4",
          backgroundOpacity: 0.92,
          anchor: "start"
        }
      ],
      grid: {
        show: true,
        color: "#dcfce7",
        axisColor: "#065f46",
        textColor: "#14532d",
        opacity: 0.7,
        strokeWidth: 1
      }
    },
    traces: buildTraces(),
    tooltip: {
      formatter: (ctx) => `${ctx.trace.name ?? "bar"} month=${ctx.x} value=${ctx.y}`
    }
  });

  randomizeBtn.addEventListener("click", () => {
    north = makeValues(0.2 + rand());
    south = makeValues(1.3 + rand());
    chart.setTraces(buildTraces());
    pushLog("setTraces() regenerated bar values");
  });

  baseBtn.addEventListener("click", () => {
    baseMode = !baseMode;
    chart.setTraces(buildTraces());
    pushLog(`bar.base=${baseMode ? 35 : 0}`);
  });

  pushLog("Ready. Click buttons to mutate bar traces.");
  return () => chart.destroy();
}

function runBarTime() {
  const { host, panel } = mountShell(
    "bar-time",
    "Example 5: Bar + Time Axis",
    "Combine time-bucket bar traces with a trend line for mixed bar/scatter workflows.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=bar-time</code></p>
      <p>Focus: <code>type: \"bar\"</code> with <code>xaxis.type: \"time\"</code> + scatter trend line.</p>
    `
  );

  const count = 24;
  const stepMs = 60 * 60 * 1000;
  const start = baseNowMs - (count - 1) * stepMs;
  const xs = Array.from({ length: count }, (_, i) => new Date(start + i * stepMs));
  const bars = new Float32Array(count);
  const trend = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const v = 70 + Math.sin(t * Math.PI * 4.5) * 18 + (rand() - 0.5) * 9;
    bars[i] = v;
    trend[i] = 68 + Math.sin(t * Math.PI * 4.5) * 12;
  }

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    layout: {
      title: "Hourly requests",
      hovermode: "x",
      xaxis: {
        type: "time",
        title: "Hour",
        tickValues: [xs[0], xs[6], xs[12], xs[18], xs[count - 1]],
        timeFormat: "%b %d %H:%M"
      },
      yaxis: { type: "linear", title: "Req/s", min: 35, max: 105, tickFormat: ".1f", precision: 1 },
      annotations: [
        {
          type: "line",
          x0: xs[12],
          y0: 35,
          x1: xs[12],
          y1: 105,
          color: "#1e40af",
          opacity: 0.4,
          dash: "dot"
        },
        {
          type: "region",
          x0: xs[8],
          y0: 35,
          x1: xs[11],
          y1: 105,
          fill: "#bfdbfe",
          fillOpacity: 0.18,
          stroke: "#1d4ed8",
          strokeOpacity: 0.2
        },
        {
          type: "label",
          x: xs[11],
          y: 102,
          text: "peak band",
          color: "#1e3a8a",
          background: "#eff6ff",
          backgroundOpacity: 0.9,
          anchor: "end"
        }
      ],
      grid: {
        show: true,
        color: "#dbeafe",
        axisColor: "#1d4ed8",
        textColor: "#1e3a8a",
        opacity: 0.7,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "bar",
        name: "Observed",
        x: xs,
        y: bars,
        bar: { widthPx: 10, color: "#2563eb", opacity: 0.65, base: 35 }
      },
      {
        type: "scatter",
        name: "Trend",
        x: xs,
        y: trend,
        mode: "lines",
        line: { color: "#0f172a", opacity: 0.9, widthPx: 2, dash: "dash" }
      }
    ],
    tooltip: {
      renderer: (ctx) => `<strong>${ctx.trace.name ?? "trace"}</strong><br/>${ctx.x}<br/>${ctx.y}`
    }
  });

  panel.insertAdjacentHTML("beforeend", "<p>Use x-hover mode to inspect aligned values across bars + line.</p>");
  return () => chart.destroy();
}

function runBarInteractions() {
  const { host, panel } = mountShell(
    "bar-interactions",
    "Example 6: Bar Interactions + appendPoints()",
    "Stream a bar trace in real time, maintain a sliding window, and pair it with an EMA line.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=bar-interactions</code></p>
      <div class="btn-row">
        <button id="btn-stream-toggle">Start stream</button>
        <button id="btn-stream-step">appendPoints()</button>
        <button id="btn-stream-reset">setTraces()</button>
      </div>
      <pre id="stream-log" class="event-log"></pre>
    `
  );

  const toggleBtn = panel.querySelector<HTMLButtonElement>("#btn-stream-toggle");
  const stepBtn = panel.querySelector<HTMLButtonElement>("#btn-stream-step");
  const resetBtn = panel.querySelector<HTMLButtonElement>("#btn-stream-reset");
  const logEl = panel.querySelector<HTMLPreElement>("#stream-log");
  if (!toggleBtn || !stepBtn || !resetBtn || !logEl) throw new Error("Bar interactions controls missing.");

  const pushLog = (line: string) => {
    const rows = (logEl.textContent ?? "").split("\n").filter(Boolean);
    rows.unshift(line);
    logEl.textContent = rows.slice(0, 12).join("\n");
  };

  const WINDOW = 64;
  const START_POINTS = 24;
  const STREAM_MS = 450;
  let step = 0;
  let level = 62;
  let ema = level;
  let streamTimer: number | null = null;

  const buildInitial = () => {
    const x = new Float32Array(START_POINTS);
    const y = new Float32Array(START_POINTS);
    const yEma = new Float32Array(START_POINTS);

    let localLevel = 56 + rand() * 8;
    let localEma = localLevel;
    for (let i = 0; i < START_POINTS; i++) {
      localLevel = localLevel + (rand() - 0.5) * 9 + Math.sin(i * 0.3) * 1.4;
      const clamped = Math.max(25, Math.min(105, localLevel));
      localEma = localEma * 0.82 + clamped * 0.18;

      x[i] = i;
      y[i] = clamped;
      yEma[i] = localEma;
    }

    step = START_POINTS - 1;
    level = y[START_POINTS - 1];
    ema = yEma[START_POINTS - 1];
    return { x, y, yEma };
  };

  const init = buildInitial();

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    layout: {
      title: "Realtime throughput bars",
      hovermode: "closest",
      xaxis: { type: "linear", title: "Tick", tickFormat: ".0f" },
      yaxis: { type: "linear", title: "Requests / sec", min: 20, max: 110, tickFormat: ".1f", precision: 1 },
      annotations: [
        {
          type: "line",
          x0: 0,
          y0: 90,
          x1: WINDOW + 8,
          y1: 90,
          color: "#991b1b",
          opacity: 0.45,
          dash: "dash"
        },
        {
          type: "label",
          x: WINDOW + 6,
          y: 90,
          text: "alert threshold",
          color: "#7f1d1d",
          background: "#fef2f2",
          backgroundOpacity: 0.9,
          anchor: "end",
          offsetYPx: -10
        }
      ],
      grid: {
        show: true,
        color: "#e0e7ff",
        axisColor: "#3730a3",
        textColor: "#312e81",
        opacity: 0.72,
        strokeWidth: 1
      }
    },
    traces: [
      {
        type: "bar",
        name: "Throughput",
        x: init.x,
        y: init.y,
        bar: { widthPx: 8, color: "#0284c7", opacity: 0.65, base: 0 }
      },
      {
        type: "scatter",
        name: "EMA",
        x: init.x,
        y: init.yEma,
        mode: "lines",
        line: { color: "#111827", opacity: 0.9, widthPx: 2 }
      }
    ],
    tooltip: {
      formatter: (ctx) => `${ctx.trace.name ?? "trace"} tick=${ctx.x} value=${Number(ctx.y).toFixed(2)}`
    }
  });

  const appendTick = () => {
    step += 1;
    level = level + (rand() - 0.5) * 10 + Math.sin(step * 0.2) * 1.8;
    const value = Math.max(20, Math.min(110, level));
    ema = ema * 0.82 + value * 0.18;

    chart.appendPoints(
      [
        { traceIndex: 0, x: [step], y: [value], maxPoints: WINDOW },
        { traceIndex: 1, x: [step], y: [ema], maxPoints: WINDOW }
      ],
      { maxPoints: WINDOW }
    );

    pushLog(`appendPoints() tick=${step} throughput=${value.toFixed(1)} ema=${ema.toFixed(1)}`);
  };

  const stopStream = () => {
    if (streamTimer !== null) {
      window.clearInterval(streamTimer);
      streamTimer = null;
    }
    toggleBtn.textContent = "Start stream";
  };

  const startStream = () => {
    if (streamTimer !== null) return;
    streamTimer = window.setInterval(() => appendTick(), STREAM_MS);
    toggleBtn.textContent = "Stop stream";
  };

  toggleBtn.addEventListener("click", () => {
    if (streamTimer !== null) {
      stopStream();
      pushLog("stream paused");
    } else {
      startStream();
      pushLog(`stream started (${STREAM_MS}ms interval)`);
    }
  });

  stepBtn.addEventListener("click", () => appendTick());

  resetBtn.addEventListener("click", () => {
    stopStream();
    const next = buildInitial();
    chart.setTraces([
      {
        type: "bar",
        name: "Throughput",
        x: next.x,
        y: next.y,
        bar: { widthPx: 8, color: "#0284c7", opacity: 0.65, base: 0 }
      },
      {
        type: "scatter",
        name: "EMA",
        x: next.x,
        y: next.yEma,
        mode: "lines",
        line: { color: "#111827", opacity: 0.9, widthPx: 2 }
      }
    ]);
    pushLog("setTraces() reset stream history");
  });

  pushLog("Ready. Start stream or append manually.");

  return () => {
    stopStream();
    chart.destroy();
  };
}

function runHeatmapBasics() {
  const { host, panel } = mountShell(
    "heatmap-basics",
    "Example 7: Heatmap Basics",
    "Render a heatmap trace, control z-range, and swap colorscales.",
    `
      <h3>Run This Example</h3>
      <p>URL: <code>/?example=heatmap-basics</code></p>
      <div class="btn-row">
        <button id="btn-heatmap-randomize">setTraces()</button>
        <button id="btn-heatmap-zrange">toggle z-range</button>
        <button id="btn-heatmap-colors">toggle colorscale</button>
      </div>
      <pre id="heatmap-log" class="event-log"></pre>
    `
  );

  const randomizeBtn = panel.querySelector<HTMLButtonElement>("#btn-heatmap-randomize");
  const zrangeBtn = panel.querySelector<HTMLButtonElement>("#btn-heatmap-zrange");
  const colorsBtn = panel.querySelector<HTMLButtonElement>("#btn-heatmap-colors");
  const logEl = panel.querySelector<HTMLPreElement>("#heatmap-log");
  if (!randomizeBtn || !zrangeBtn || !colorsBtn || !logEl) throw new Error("Heatmap controls missing.");

  const pushLog = (line: string) => {
    const rows = (logEl.textContent ?? "").split("\n").filter(Boolean);
    rows.unshift(line);
    logEl.textContent = rows.slice(0, 10).join("\n");
  };

  const NX = 18;
  const NY = 10;
  const xs = Array.from({ length: NX }, (_, i) => i + 1);
  const ys = Array.from({ length: NY }, (_, i) => i + 1);
  const colorsA = ["#0b3c5d", "#328cc1", "#8fd694", "#f6ae2d", "#d7263d"];
  const colorsB = ["#1f2937", "#4338ca", "#06b6d4", "#a3e635", "#f97316", "#ef4444"];
  let usePaletteB = false;
  let constrainedRange = false;

  const buildHeat = (phase: number) =>
    Array.from({ length: NY }, (_, yi) =>
      Array.from({ length: NX }, (_, xi) => {
        const x = xi / Math.max(1, NX - 1);
        const y = yi / Math.max(1, NY - 1);
        const v =
          Math.sin((x * 4.8 + phase) * Math.PI) * 0.55 +
          Math.cos((y * 3.6 + phase * 0.6) * Math.PI) * 0.35 +
          (rand() - 0.5) * 0.18;
        return (v + 1.2) * 36;
      })
    );

  let phase = 0.15;
  let z = buildHeat(phase);

  const buildTrace = () => ({
    type: "heatmap" as const,
    name: "Utilization",
    x: xs,
    y: ys,
    z,
    heatmap: {
      colorscale: usePaletteB ? colorsB : colorsA,
      opacity: 0.86,
      zmin: constrainedRange ? 20 : undefined,
      zmax: constrainedRange ? 75 : undefined
    },
    hovertemplate: "%{trace.name}<br>x=%{x}<br>y=%{y}<br>z=%{z}"
  });

  const chart = createDemoChart(host, {
    width: 920,
    height: 520,
    layout: {
      title: "Grid utilization heatmap",
      hovermode: "closest",
      xaxis: { type: "linear", title: "Column", tickFormat: ".0f", min: 1, max: NX },
      yaxis: { type: "linear", title: "Row", tickFormat: ".0f", min: 1, max: NY },
      annotations: [
        {
          type: "region",
          x0: 6,
          y0: 3,
          x1: 11,
          y1: 7,
          fill: "#fef3c7",
          fillOpacity: 0.2,
          stroke: "#b45309",
          strokeOpacity: 0.35
        },
        {
          type: "line",
          x0: 9,
          y0: 1,
          x1: 9,
          y1: NY,
          color: "#78350f",
          opacity: 0.3,
          dash: "dot"
        },
        {
          type: "label",
          x: 11.2,
          y: 7.2,
          text: "Hot zone",
          color: "#92400e",
          background: "#fffbeb",
          backgroundOpacity: 0.9
        }
      ],
      grid: {
        show: true,
        color: "#e5e7eb",
        axisColor: "#6b7280",
        textColor: "#374151",
        opacity: 0.65,
        strokeWidth: 1
      }
    },
    traces: [buildTrace()],
    tooltip: {
      formatter: (ctx) => `${ctx.trace.name ?? "heatmap"} x=${ctx.x} y=${ctx.y} z=${ctx.z ?? "n/a"}`
    }
  });

  randomizeBtn.addEventListener("click", () => {
    phase += 0.33 + rand() * 0.2;
    z = buildHeat(phase);
    chart.setTraces([buildTrace()]);
    pushLog("setTraces() regenerated heatmap values");
  });

  zrangeBtn.addEventListener("click", () => {
    constrainedRange = !constrainedRange;
    chart.setTraces([buildTrace()]);
    pushLog(`z-range ${constrainedRange ? "locked to [20,75]" : "auto"}`);
  });

  colorsBtn.addEventListener("click", () => {
    usePaletteB = !usePaletteB;
    chart.setTraces([buildTrace()]);
    pushLog(`colorscale ${usePaletteB ? "B" : "A"}`);
  });

  pushLog("Ready. Randomize values, clamp range, and swap palettes.");
  return () => chart.destroy();
}

const requestedExample = params.get("example");
const activeExample: ExampleId =
  requestedExample === "axis-grid" ||
  requestedExample === "events-api" ||
  requestedExample === "vertexa-workbench" ||
  requestedExample === "modebar-multi" ||
  requestedExample === "perf-sync-6" ||
  requestedExample === "bar-basics" ||
  requestedExample === "bar-time" ||
  requestedExample === "bar-interactions" ||
  requestedExample === "heatmap-basics" ||
  requestedExample === "getting-started"
    ? requestedExample
    : "getting-started";

const cleanup =
  activeExample === "axis-grid"
    ? runAxisGrid()
    : activeExample === "events-api"
      ? runEventsApi()
      : activeExample === "vertexa-workbench"
        ? runVertexaWorkbench()
        : activeExample === "modebar-multi"
          ? runModebarMulti()
          : activeExample === "perf-sync-6"
            ? runPerfSync6()
      : activeExample === "bar-basics"
        ? runBarBasics()
        : activeExample === "bar-time"
          ? runBarTime()
          : activeExample === "bar-interactions"
            ? runBarInteractions()
            : activeExample === "heatmap-basics"
              ? runHeatmapBasics()
          : runGettingStarted();

window.addEventListener("beforeunload", () => {
  cleanup();
});

function makeSeededRandom(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
