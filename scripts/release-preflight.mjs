#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

const packages = [
  {
    name: "@lineandvertexsoftware/renderer-webgpu",
    dir: "packages/renderer-webgpu",
    runtimeExport: "WebGPURenderer"
  },
  {
    name: "@lineandvertexsoftware/overlay-d3",
    dir: "packages/overlay-d3",
    runtimeExport: "OverlayD3"
  },
  {
    name: "@lineandvertexsoftware/vertexa-chart",
    dir: "packages/vertexa-chart",
    runtimeExport: "Chart",
    internalDependencies: [
      "@lineandvertexsoftware/overlay-d3",
      "@lineandvertexsoftware/renderer-webgpu"
    ]
  }
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireFile(path, message) {
  if (!existsSync(path)) {
    fail(message);
  }
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function changelogMatchesVersion(changelog, version) {
  if (changelog.includes(`## ${version} -`)) {
    return true;
  }

  const prereleaseIndex = version.indexOf("-");
  if (prereleaseIndex !== -1) {
    const stableVersion = version.slice(0, prereleaseIndex);
    return changelog.includes(`## ${stableVersion} -`);
  }

  return false;
}

const rootManifest = readJson(join(rootDir, "package.json"));

requireEqual(rootManifest.name, "vertexa-chart-monorepo", "root package name");
requireEqual(rootManifest.private, true, "root package private flag");
requireEqual(rootManifest.packageManager, "pnpm@9.12.0", "root package manager");
if (hasOwn(rootManifest, "workspaces")) {
  fail("root package.json should not define workspaces; use pnpm-workspace.yaml");
}
requireFile(join(rootDir, "pnpm-workspace.yaml"), "pnpm-workspace.yaml is missing");

const manifests = new Map();
for (const pkg of packages) {
  const manifestPath = join(rootDir, pkg.dir, "package.json");
  const manifest = readJson(manifestPath);
  manifests.set(pkg.name, manifest);

  requireEqual(manifest.name, pkg.name, `${pkg.dir} package name`);
  requireEqual(manifest.type, "module", `${pkg.name} module type`);
  requireEqual(manifest.license, "MIT", `${pkg.name} license`);
  requireEqual(manifest.sideEffects, false, `${pkg.name} sideEffects flag`);
  requireEqual(manifest.publishConfig?.access, "public", `${pkg.name} publish access`);
  requireEqual(manifest.engines?.node, ">=20", `${pkg.name} Node engine`);
  requireEqual(manifest.main, "./dist/index.js", `${pkg.name} main entry`);
  requireEqual(manifest.types, "./dist/index.d.ts", `${pkg.name} types entry`);
  requireEqual(manifest.exports?.["."]?.import, "./dist/index.js", `${pkg.name} export import entry`);
  requireEqual(manifest.exports?.["."]?.types, "./dist/index.d.ts", `${pkg.name} export types entry`);

  for (const file of ["dist", "README.md", "LICENSE"]) {
    if (!manifest.files?.includes(file)) {
      fail(`${pkg.name} package files should include ${file}`);
    }
  }

  requireFile(join(rootDir, pkg.dir, "README.md"), `${pkg.name} README.md is missing`);
  requireFile(join(rootDir, pkg.dir, "LICENSE"), `${pkg.name} LICENSE is missing`);
}

const versions = new Set([...manifests.values()].map((manifest) => manifest.version));
if (versions.size !== 1) {
  fail(`package versions should match: ${[...versions].join(", ")}`);
}
const version = [...versions][0];

const chartManifest = manifests.get("@lineandvertexsoftware/vertexa-chart");
for (const dependency of packages.find((pkg) => pkg.name === chartManifest.name).internalDependencies) {
  requireEqual(
    chartManifest.dependencies?.[dependency],
    "workspace:*",
    `${chartManifest.name} source dependency ${dependency}`
  );
}

const changelog = readFileSync(join(rootDir, "CHANGELOG.md"), "utf8");
if (!changelogMatchesVersion(changelog, version)) {
  fail(`CHANGELOG.md should include an entry for ${version} or its stable release line`);
}

if (!rootManifest.scripts?.["publish:packages"]?.includes("packages/vertexa-chart publish")) {
  fail("publish:packages should publish packages/vertexa-chart");
}
if (!rootManifest.scripts?.["publish:packages:next"]?.includes("--tag next")) {
  fail("publish:packages:next should publish with the next npm tag");
}

if (failures.length > 0) {
  console.error("Release preflight failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release preflight passed for ${version}.`);
