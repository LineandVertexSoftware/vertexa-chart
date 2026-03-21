import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(__dirname, "..");
const distDir = path.join(demoDir, "dist");
const artifactsDir = path.join(__dirname, "perf-artifacts");

const HOST = "127.0.0.1";
const PORT = Number(process.env.BENCH_PORT ?? 4174);
const BASE_URL = process.env.BENCH_BASE_URL ?? `http://${HOST}:${PORT}`;
const CHROME_PATH = process.env.CHROME_PATH ?? findChromeExecutable();
const WINDOW_SIZE = process.env.BENCH_WINDOW_SIZE ?? "1600,1200";
const CLI_ARGS = new Set(process.argv.slice(2));
const HEADLESS = CLI_ARGS.has("--headed")
  ? false
  : CLI_ARGS.has("--headless")
    ? true
    : process.env.BENCH_HEADLESS !== "0";
const RUN_TIMEOUT_MS = Number(process.env.BENCH_RUN_TIMEOUT_MS ?? process.env.BENCH_VIRTUAL_TIME_BUDGET_MS ?? 120000);
const EXTRA_QUERY_PARAMS = normalizeQueryParams(process.env.BENCH_QUERY_PARAMS ?? "");
const CHROME_APP_NAME = resolveChromeAppName(CHROME_PATH);
const ACTIVATE_WINDOW = !HEADLESS && process.env.BENCH_ACTIVATE_WINDOW !== "0" && Boolean(CHROME_APP_NAME);
const EXTERNAL_VISIBLE_BROWSER = !HEADLESS && process.env.BENCH_VISIBLE_SPAWN === "1" ? false : !HEADLESS;
const CHROME_EXTRA_ARGS = splitArgs(process.env.BENCH_CHROME_ARGS ?? "");
const scenarioIds = resolveScenarioIds();
const postedReports = new Map();
const reportWaiters = new Map();

if (!CHROME_PATH) {
  throw new Error("No Chrome executable found. Set CHROME_PATH to run the benchmark harness.");
}

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error(
    "Missing apps/demo/dist. Build the demo first (pnpm build:demo) before running the benchmark harness."
  );
}

await fs.mkdir(artifactsDir, { recursive: true });

const server = await startStaticServer();

try {
  await waitForHttp(BASE_URL, 30_000);
  const startedAt = new Date().toISOString();
  const reports = [];

  for (const scenarioId of scenarioIds) {
    console.log(`Running benchmark scenario: ${scenarioId}`);
    const runId = createRunId(scenarioId);
    const url = buildBenchmarkUrl(scenarioId, runId);
    const chrome = EXTERNAL_VISIBLE_BROWSER ? await launchVisibleBrowser(url) : await launchChrome(url);
    let report;
    try {
      await maybeActivateChromeWindow();
      report = await waitForBenchmarkReport(runId, chrome);
    } finally {
      await closeChrome(chrome);
      postedReports.delete(runId);
      reportWaiters.delete(runId);
    }

    if (report.status !== "ok") {
      const failurePath = path.join(artifactsDir, `${scenarioId}.failed.json`);
      await fs.writeFile(failurePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      throw new Error(
        `Scenario ${scenarioId} failed: ${report.error?.message ?? "unknown error"}\nFailure report: ${failurePath}\n${chrome.outputTail()}`
      );
    }

    reports.push(report);
    const scenarioPath = path.join(artifactsDir, `${scenarioId}.json`);
    await fs.writeFile(scenarioPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(formatScenarioSummary(report));
  }

  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    windowSize: WINDOW_SIZE,
    headless: HEADLESS,
    runTimeoutMs: RUN_TIMEOUT_MS,
    chromePath: CHROME_PATH,
    scenarios: reports
  };

  const aggregatePath = path.join(artifactsDir, "benchmark-results.json");
  await fs.writeFile(aggregatePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Benchmark results saved to ${aggregatePath}`);
} finally {
  await stopServer(server);
}

function resolveScenarioIds() {
  const fromEnv = (process.env.BENCH_SCENARIOS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  const defaults = [
    "mount-scatter-200k-quality",
    "pan-scatter-200k-balanced",
    "append-scatter-50k-window"
  ];
  if (process.env.BENCH_FULL === "1") {
    defaults.push("pan-scatter-1m-quality");
    defaults.push("pan-grid-6x1m-unsynced-quality");
    defaults.push("pan-sync-6x1m-quality");
  }
  return defaults;
}

function buildBenchmarkUrl(scenarioId, runId) {
  const url = new URL("/", BASE_URL);
  url.searchParams.set("benchmark", "1");
  url.searchParams.set("scenario", scenarioId);
  url.searchParams.set("snapshot", "1");
  url.searchParams.set("seed", "20260228");
  url.searchParams.set("runId", runId);
  for (const [key, value] of EXTRA_QUERY_PARAMS) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function resolveChromeAppName(chromePath) {
  if (!chromePath) return null;
  if (chromePath.includes("Chromium.app")) return "Chromium";
  if (chromePath.includes("Google Chrome.app")) return "Google Chrome";
  return null;
}

async function launchChrome(url) {
  const userDataDir = path.join(
    artifactsDir,
    `.chrome-profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  await fs.mkdir(userDataDir, { recursive: true });

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-webgpu",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${WINDOW_SIZE}`,
    ...CHROME_EXTRA_ARGS,
    url
  ];
  if (HEADLESS) {
    args.unshift("--hide-scrollbars");
    args.unshift("--mute-audio");
    args.unshift("--headless=new");
  } else {
    args.unshift("--new-window");
  }

  const child = spawn(CHROME_PATH, args, {
    cwd: demoDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let tail = "";
  const appendOutput = (label, chunk) => {
    tail += `[${label}] ${chunk.toString()}`;
    if (tail.length > 16_000) {
      tail = tail.slice(-16_000);
    }
  };

  child.stdout.on("data", (chunk) => {
    appendOutput("stdout", chunk);
  });
  child.stderr.on("data", (chunk) => {
    appendOutput("stderr", chunk);
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? -1);
    });
  });

  return {
    child,
    userDataDir,
    exitPromise,
    outputTail: () => tail.trim()
  };
}

async function launchVisibleBrowser(url) {
  console.log(`  opening ${url}`);
  await openVisibleUrl(url);
  return {
    external: true,
    child: null,
    userDataDir: null,
    exitPromise: new Promise(() => {}),
    outputTail: () => ""
  };
}

async function waitForBenchmarkReport(runId, chrome) {
  if (chrome.external) {
    return waitForPostedReport(runId, RUN_TIMEOUT_MS);
  }
  const reportPromise = waitForPostedReport(runId, RUN_TIMEOUT_MS);
  const exitPromise = chrome.exitPromise.then(async (code) => {
    await sleep(1000);
    const fallback = postedReports.get(runId);
    if (fallback) {
      postedReports.delete(runId);
      return fallback;
    }
    throw new Error(
      `Chrome exited before benchmark report was received (code ${code}).${chrome.outputTail() ? `\n${chrome.outputTail()}` : ""}`
    );
  });
  return Promise.race([reportPromise, exitPromise]);
}

async function closeChrome(chrome) {
  if (chrome.external) {
    return;
  }
  try {
    if (chrome.child.exitCode === null && !chrome.child.killed) {
      chrome.child.kill("SIGTERM");
      await Promise.race([chrome.exitPromise.catch(() => {}), sleep(5000)]);
      if (chrome.child.exitCode === null && !chrome.child.killed) {
        chrome.child.kill("SIGKILL");
        await chrome.exitPromise.catch(() => {});
      }
    }
  } finally {
    await fs.rm(chrome.userDataDir, { recursive: true, force: true });
  }
}

function createRunId(scenarioId) {
  return `${scenarioId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function waitForPostedReport(runId, timeoutMs) {
  if (postedReports.has(runId)) {
    const report = postedReports.get(runId);
    postedReports.delete(runId);
    return Promise.resolve(report);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reportWaiters.delete(runId);
      reject(new Error(`Timed out waiting ${timeoutMs}ms for benchmark report ${runId}.`));
    }, timeoutMs);

    reportWaiters.set(runId, (report) => {
      clearTimeout(timeout);
      reportWaiters.delete(runId);
      postedReports.delete(runId);
      resolve(report);
    });
  });
}

function formatScenarioSummary(report) {
  const metrics = report.metrics ?? {};
  const frameBudget = metrics.frameBudgetMs ?? null;
  const frameSummary = frameBudget
    ? ` frameP95=${frameBudget.p95 ?? "n/a"}ms >16.7=${formatPercent(frameBudget.over16_7Ratio)}`
    : "";
  if ("observedFps" in metrics) {
    const chartSummary = "chartRenderFps" in metrics ? ` chartFps=${metrics.chartRenderFps}` : "";
    const opsSummary = "panOpsPerSecond" in metrics ? ` ops=${metrics.panOpsPerSecond}/s` : "";
    return `  observedFps=${metrics.observedFps}${chartSummary}${opsSummary} opP50=${metrics.operationLatencyMs?.p50 ?? "n/a"}ms${frameSummary} lod=${metrics.sampledPoints?.lodRatio ?? "n/a"}`;
  }
  if ("throughputPointsPerSecond" in metrics) {
    return `  throughput=${metrics.throughputPointsPerSecond} pts/s opP50=${metrics.operationLatencyMs?.p50 ?? "n/a"}ms${frameSummary} lod=${metrics.sampledPoints?.lodRatio ?? "n/a"}`;
  }
  if ("mountMs" in metrics) {
    return `  mountMs=${metrics.mountMs} firstFrame=${metrics.firstFrameWaitMs ?? "n/a"}ms${frameSummary} lod=${metrics.lodRatio ?? "n/a"}`;
  }
  return `  status=${report.status}`;
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", BASE_URL);
      if (requestUrl.pathname === "/__benchmark-report") {
        await handleBenchmarkReport(req, res, requestUrl);
        return;
      }

      const requestPath = requestUrl.pathname;
      const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
      const filePath = path.join(distDir, normalizedPath);
      if (!filePath.startsWith(distDir)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      const data = await fs.readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", getContentType(filePath));
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("Not Found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });

  return server;
}

async function handleBenchmarkReport(req, res, requestUrl) {
  const runId = requestUrl.searchParams.get("runId");
  if (!runId) {
    res.statusCode = 400;
    res.end("Missing runId");
    return;
  }

  if (req.method === "GET") {
    const report = postedReports.get(runId);
    if (!report) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(report));
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const body = await readRequestBody(req);
  const report = JSON.parse(body);
  postedReports.set(runId, report);
  const waiter = reportWaiters.get(runId);
  if (waiter) {
    waiter(report);
  }
  res.statusCode = 204;
  res.end();
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Benchmark report payload exceeded 2MB."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}. Last error: ${String(lastError)}`);
}

function findChromeExecutable() {
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    candidates.push(
      path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe")
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function splitArgs(value) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeQueryParams(value) {
  const trimmed = value.trim().replace(/^\?/, "");
  return new URLSearchParams(trimmed);
}

async function openVisibleUrl(url) {
  if (process.platform === "darwin") {
    const args = CHROME_APP_NAME ? ["-a", CHROME_APP_NAME, url] : [url];
    await runBestEffortCommand("open", args);
    return;
  }

  if (process.platform === "linux") {
    await runBestEffortCommand("xdg-open", [url]);
    return;
  }

  if (process.platform === "win32") {
    await runBestEffortCommand("cmd", ["/c", "start", "", url]);
    return;
  }

  throw new Error(`Unsupported platform for visible browser launch: ${process.platform}`);
}

async function maybeActivateChromeWindow() {
  if (!ACTIVATE_WINDOW || process.platform !== "darwin" || !CHROME_APP_NAME) return;
  await sleep(500);
  await runBestEffortCommand("osascript", ["-e", `tell application "${CHROME_APP_NAME}" to activate`]);
  await sleep(500);
}

async function runBestEffortCommand(command, args) {
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: demoDir,
        env: process.env,
        stdio: ["ignore", "ignore", "ignore"]
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command} exited with code ${code ?? -1}`));
      });
    });
  } catch {
    // Activation is a best-effort hint for visible runs; benchmarking still works without it.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 1000) / 10}%`;
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
