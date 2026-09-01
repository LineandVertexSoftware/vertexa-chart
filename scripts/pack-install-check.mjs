#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keepTemp = process.env.KEEP_PACK_INSTALL_CHECK === "1";

const packages = [
  {
    key: "renderer",
    dir: "packages/renderer-webgpu",
    requiredFiles: ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"],
    verify(root) {
      const shaderFiles = walk(root).filter((file) => file.endsWith(".wgsl"));
      assert(shaderFiles.length > 0, "renderer-webgpu package should include WGSL shader files");
    }
  },
  {
    key: "overlay",
    dir: "packages/overlay-d3",
    requiredFiles: ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"]
  },
  {
    key: "chart",
    dir: "packages/vertexa-chart",
    requiredFiles: ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"],
    verify(root) {
      const manifest = readJson(join(root, "package.json"));
      const workspaceDependencyDirs = {
        "@lineandvertexsoftware/overlay-d3": "packages/overlay-d3",
        "@lineandvertexsoftware/renderer-webgpu": "packages/renderer-webgpu"
      };
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        assert(
          !String(version).startsWith("workspace:"),
          `${manifest.name} dependency ${name} should be rewritten from workspace protocol`
        );
        if (workspaceDependencyDirs[name]) {
          const sourceManifest = readJson(join(rootDir, workspaceDependencyDirs[name], "package.json"));
          assert(
            version === sourceManifest.version,
            `${manifest.name} dependency ${name} should resolve to ${sourceManifest.version}, got ${version}`
          );
        }
      }
    }
  }
];

const buildSteps = [
  ["corepack", ["pnpm", "-C", "packages/overlay-d3", "exec", "tsc"]],
  ["corepack", ["pnpm", "-C", "packages/renderer-webgpu", "exec", "tsc"]],
  ["node", ["scripts/copy-shaders.js"], { cwd: join(rootDir, "packages/renderer-webgpu") }],
  ["corepack", ["pnpm", "-C", "packages/vertexa-chart", "exec", "tsc"]]
];

function run(command, args, options = {}) {
  const cwd = options.cwd ?? rootDir;
  const relativeCwd = relative(rootDir, cwd);
  const displayCwd =
    relativeCwd === ""
      ? "."
      : relativeCwd && !relativeCwd.startsWith("..") && !isAbsolute(relativeCwd)
        ? relativeCwd
        : cwd;
  console.log(`\n$ ${[command, ...args].join(" ")} (${displayCwd})`);

  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: { ...process.env, CI: process.env.CI ?? "true" }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }

  return result.stdout?.trim() ?? "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function findPackedTarball(packDir, knownFiles) {
  const created = readdirSync(packDir)
    .filter((file) => file.endsWith(".tgz") && !knownFiles.has(file))
    .map((file) => ({
      file,
      mtimeMs: statSync(join(packDir, file)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  assert(created.length > 0, "pnpm pack did not create a tarball");
  return join(packDir, created[0].file);
}

function unpack(tarball, extractDir) {
  const outDir = join(extractDir, basename(tarball, ".tgz"));
  mkdirSync(outDir, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", outDir]);
  return join(outDir, "package");
}

function writeConsumerFixture(consumerDir, packageManager, tarballsByKey) {
  mkdirSync(join(consumerDir, "src"), { recursive: true });

  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "vertexa-pack-install-check",
        private: true,
        type: "module",
        packageManager,
        scripts: {
          typecheck: "tsc --noEmit",
          build: "vite build"
        },
        dependencies: {
          "@lineandvertexsoftware/overlay-d3": `file:${tarballsByKey.overlay}`,
          "@lineandvertexsoftware/renderer-webgpu": `file:${tarballsByKey.renderer}`,
          "@lineandvertexsoftware/vertexa-chart": `file:${tarballsByKey.chart}`
        },
        devDependencies: {
          typescript: "^5.6.3",
          vite: "^5.4.10"
        }
      },
      null,
      2
    )}\n`
  );

  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          lib: ["ES2022", "DOM"],
          skipLibCheck: false,
          noEmit: true
        },
        include: ["src"]
      },
      null,
      2
    )}\n`
  );

  writeFileSync(
    join(consumerDir, "index.html"),
    `<div id="chart"></div>
<script type="module" src="/src/main.ts"></script>
`
  );

  writeFileSync(
    join(consumerDir, "src/main.ts"),
    `import {
  Chart,
  type ChartExportCsvPointsOptions,
  type ChartExportPngOptions,
  type ChartExportSvgOptions,
  type ChartOptions,
  type ChartPublicApi,
  type ChartToolbarOptions,
  type Trace
} from "@lineandvertexsoftware/vertexa-chart";

const traces: Trace[] = [
  {
    type: "scatter",
    name: "Series",
    x: [1, 2, 3],
    y: [2, 4, 3],
    mode: "lines+markers"
  }
];

const toolbar: ChartToolbarOptions = {
  show: true,
  export: true,
  exportFormats: ["png", "svg", "csv"],
  exportFilename: "consumer-check",
  exportPixelRatio: 2
};

const options: ChartOptions = {
  width: 640,
  height: 360,
  traces,
  toolbar,
  layout: {
    title: "Consumer check",
    xaxis: { type: "linear" },
    yaxis: { type: "linear" },
    hovermode: "closest"
  }
};

const root = document.querySelector("#chart");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing chart root");
}

const chart: ChartPublicApi = new Chart(root, options);
const pngOptions: ChartExportPngOptions = {
  pixelRatio: 2,
  includeGrid: true,
  includeOverlay: true
};
const svgOptions: ChartExportSvgOptions = {
  includePlot: true,
  includeGrid: true,
  includeOverlay: false
};
const csvOptions: ChartExportCsvPointsOptions = {
  includeHeader: true,
  includeHidden: false
};

void chart.exportPng(pngOptions);
void chart.exportSvg(svgOptions);
chart.exportCsvPoints(csvOptions);
`
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), "vertexa-pack-install-check-"));
const packDir = join(tempRoot, "packs");
const extractDir = join(tempRoot, "extract");
const consumerDir = join(tempRoot, "consumer");

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const rootManifest = readJson(join(rootDir, "package.json"));
  const tarballsByKey = {};

  for (const [command, args, options] of buildSteps) {
    run(command, args, options);
  }

  for (const pkg of packages) {
    const knownFiles = new Set(readdirSync(packDir));
    run("corepack", ["pnpm", "-C", pkg.dir, "pack", "--pack-destination", packDir]);
    const tarball = findPackedTarball(packDir, knownFiles);
    tarballsByKey[pkg.key] = tarball;

    const packageRoot = unpack(tarball, extractDir);
    for (const file of pkg.requiredFiles) {
      assert(existsSync(join(packageRoot, file)), `${pkg.dir} package is missing ${file}`);
    }

    pkg.verify?.(packageRoot);
  }

  writeConsumerFixture(consumerDir, rootManifest.packageManager ?? "pnpm@9.12.0", tarballsByKey);

  run("corepack", ["pnpm", "install", "--frozen-lockfile=false"], { cwd: consumerDir });
  run("corepack", ["pnpm", "run", "typecheck"], { cwd: consumerDir });
  run("corepack", ["pnpm", "run", "build"], { cwd: consumerDir });

  console.log("\nPackage install check passed.");
} finally {
  if (keepTemp) {
    console.log(`Kept package install check files at ${tempRoot}`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
