import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(__dirname, "perf-artifacts");
const defaultResultsPath = path.join(artifactsDir, "benchmark-results.json");
const defaultThresholdsPath = path.join(__dirname, "perf-thresholds.json");

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node test/performance-thresholds.mjs [--results <file>] [--thresholds <file>] [--warn-only]

Checks benchmark-results.json against committed performance thresholds.

Environment:
  BENCH_THRESHOLD_MODE=warn   Report failures without exiting non-zero.`);
  process.exit(0);
}

const warnOnly = args.warnOnly || process.env.BENCH_THRESHOLD_MODE === "warn";
const resultsPath = args.results ? path.resolve(args.results) : defaultResultsPath;
const thresholdsPath = args.thresholds ? path.resolve(args.thresholds) : defaultThresholdsPath;

const results = JSON.parse(await fs.readFile(resultsPath, "utf8"));
const thresholds = JSON.parse(await fs.readFile(thresholdsPath, "utf8"));
const scenarioReports = new Map((results.scenarios ?? []).map((report) => [report.scenario, report]));
const failures = [];
let checkCount = 0;

for (const [scenarioId, checks] of Object.entries(thresholds.scenarios ?? {})) {
  const report = scenarioReports.get(scenarioId);
  if (!report) {
    failures.push(`${scenarioId}: missing benchmark report`);
    continue;
  }
  if (report.status !== "ok") {
    failures.push(`${scenarioId}: benchmark status is ${report.status}`);
    continue;
  }

  for (const check of checks) {
    checkCount += 1;
    const value = getPath(report, check.path);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      failures.push(`${scenarioId}: ${check.path} is not a finite number`);
      continue;
    }

    if (typeof check.max === "number" && value > check.max) {
      failures.push(formatFailure(scenarioId, check, value, "<=", check.max));
    }
    if (typeof check.min === "number" && value < check.min) {
      failures.push(formatFailure(scenarioId, check, value, ">=", check.min));
    }
  }
}

if (failures.length > 0) {
  console.error(`Performance threshold ${warnOnly ? "warnings" : "failures"}:`);
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  if (!warnOnly) {
    process.exit(1);
  }
}

console.log(
  `Performance thresholds ${failures.length > 0 ? "checked with warnings" : "passed"} (${checkCount} checks).`
);

function parseArgs(values) {
  const parsed = {
    help: false,
    results: "",
    thresholds: "",
    warnOnly: false
  };

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--warn-only") {
      parsed.warnOnly = true;
    } else if (value === "--results") {
      parsed.results = values[++i] ?? "";
    } else if (value === "--thresholds") {
      parsed.thresholds = values[++i] ?? "";
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return parsed;
}

function getPath(value, pointer) {
  return pointer.split(".").reduce((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return current[key];
    }
    return undefined;
  }, value);
}

function formatFailure(scenarioId, check, value, operator, expected) {
  const unit = check.unit ? ` ${check.unit}` : "";
  const label = check.description ? `${check.description} (${check.path})` : check.path;
  return `${scenarioId}: ${label} expected ${operator} ${expected}${unit}, got ${round(value)}${unit}`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
