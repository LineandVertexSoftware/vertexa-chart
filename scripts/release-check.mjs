#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const SUPPORTED_NODE_MAJORS = new Set([22, 24]);

const args = new Set(process.argv.slice(2));
const full = args.has("--full");
const help = args.has("--help") || args.has("-h");

if (help) {
  console.log(`Usage: pnpm release:check [--full]

Runs the local release gate.

Default:
  release preflight, clean, install --frozen-lockfile, build, typecheck, test, pack:check

With --full:
  also run demo build, visual snapshots, demo benchmark, and performance thresholds

Set ALLOW_UNSUPPORTED_NODE=1 to bypass the Node 22/24 release-check guard.`);
  process.exit(0);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
if (!SUPPORTED_NODE_MAJORS.has(nodeMajor) && process.env.ALLOW_UNSUPPORTED_NODE !== "1") {
  console.error(
    `Release checks must run on Node 22 or Node 24 LTS. Current Node: ${process.version}.`
  );
  console.error("Use `nvm use 22` or `nvm use 24`, then rerun the command.");
  process.exit(1);
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, CI: process.env.CI ?? "true" }
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, CI: process.env.CI ?? "true" }
  });

  if (result.error || result.status !== 0) {
    return "unknown";
  }

  return result.stdout.trim();
}

console.log(`Node: ${process.version}`);
console.log(`pnpm: ${output("pnpm", ["-v"])}`);

run("pnpm", ["release:preflight"]);
run("pnpm", ["clean"]);
run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["build"]);
run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("pnpm", ["pack:check"]);

if (full) {
  run("pnpm", ["build:demo"]);
  run("pnpm", ["test:visual"]);
  run("pnpm", ["-C", "apps/demo", "bench"]);
  run("pnpm", ["-C", "apps/demo", "bench:check"]);
}

console.log(`\nRelease check passed${full ? " with demo gates" : ""}.`);
