import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(__dirname, "..");
const baselineDir = path.join(__dirname, "visual-snapshots");
const artifactsDir = path.join(__dirname, "visual-artifacts");

const HOST = "127.0.0.1";
const PORT = Number(process.env.VISUAL_PORT ?? 4173);
const BASE_URL = process.env.VISUAL_BASE_URL ?? `http://${HOST}:${PORT}`;
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === "1";
const CHROME_PATH = process.env.CHROME_PATH ?? findChromeExecutable();
const WINDOW_SIZE = "1420,920";
const distDir = path.join(demoDir, "dist");

const scenarios = [
  { id: "getting-started", name: "getting-started" },
  { id: "axis-grid", name: "axis-grid" },
  { id: "events-api", name: "events-api" }
];

if (!CHROME_PATH) {
  throw new Error("No Chrome executable found. Set CHROME_PATH to run visual regression tests.");
}

await fs.mkdir(baselineDir, { recursive: true });
await fs.mkdir(artifactsDir, { recursive: true });

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error(
    "Missing apps/demo/dist. Build the demo first (pnpm build:demo) before running visual snapshots."
  );
}

const server = await startStaticServer();

try {
  await waitForHttp(BASE_URL, 30_000);
  const failures = await runSnapshots();
  if (failures.length > 0) {
    const lines = failures.map((name) => ` - ${name}`).join("\n");
    throw new Error(`Visual regression failures:\n${lines}`);
  }
  console.log(`Visual snapshots passed (${scenarios.length} scenarios).`);
} finally {
  await stopServer(server);
}

async function runSnapshots() {
  const failures = [];

  for (const scenario of scenarios) {
    console.log(`Capturing scenario: ${scenario.name}`);
    const currentPath = path.join(artifactsDir, `${scenario.name}.current.png`);
    const baselinePath = path.join(baselineDir, `${scenario.name}.png`);
    const scenarioUrl = `${BASE_URL}/?example=${scenario.id}&snapshot=1&seed=20260228`;

    await captureChromeScreenshot({
      screenshotPath: currentPath,
      url: scenarioUrl
    });

    if (UPDATE_SNAPSHOTS || !existsSync(baselinePath)) {
      await fs.copyFile(currentPath, baselinePath);
      await fs.unlink(currentPath);
      console.log(`${UPDATE_SNAPSHOTS ? "Updated" : "Created"} snapshot: ${scenario.name}`);
      continue;
    }

    const [baselineBuf, currentBuf] = await Promise.all([
      fs.readFile(baselinePath),
      fs.readFile(currentPath)
    ]);

    if (baselineBuf.equals(currentBuf)) {
      await fs.unlink(currentPath);
      continue;
    }

    const actualPath = path.join(artifactsDir, `${scenario.name}.actual.png`);
    await fs.copyFile(currentPath, actualPath);
    failures.push(scenario.name);
    console.error(`Snapshot mismatch: ${scenario.name}`);
    console.error(`  baseline: ${baselinePath}`);
    console.error(`  actual:   ${actualPath}`);
  }

  return failures;
}

async function captureChromeScreenshot({ screenshotPath, url }) {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--hide-scrollbars",
    "--mute-audio",
    "--timeout=7000",
    `--window-size=${WINDOW_SIZE}`,
    `--screenshot=${screenshotPath}`,
    url
  ];

  await runCommand(CHROME_PATH, args, { cwd: demoDir, stdio: "ignore", timeoutMs: 45_000 });
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const requestPath = new URL(req.url ?? "/", BASE_URL).pathname;
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

async function runCommand(command, args, options) {
  await new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 0;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.stdio ?? "inherit"
    });

    let timeout = null;
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? -1}`));
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
