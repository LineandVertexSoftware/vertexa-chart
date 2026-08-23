# Release Baseline

This is the minimum local release baseline for publishing Vertexa Chart packages.

## Runtime

- Use Node 22 or Node 24 LTS for release checks.
- The packages support Node `>=20`, but Node 26 currently trips `c8` through its `yargs` dependency during package tests.
- Use the repo-pinned package manager when possible: `pnpm@9.12.0`.

```bash
node -v
pnpm -v
```

If Homebrew or another global install shadows pnpm, run through Corepack:

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
corepack pnpm -v
```

## Package Gate

Run the package release check from the repo root:

```bash
pnpm release:check
```

This runs a clean install, package builds, package type checks, package tests,
and dry-run package packing.

## Demo Visual Gate

Build the demo and compare the checked-in visual snapshots:

```bash
pnpm build:demo
pnpm test:visual
```

The visual gate covers seven deterministic demo scenarios:

- `getting-started`
- `axis-grid`
- `events-api`
- `bar-basics`
- `bar-time`
- `heatmap-basics`
- `visual-matrix`

If the visual change is intentional, update snapshots explicitly:

```bash
UPDATE_SNAPSHOTS=1 pnpm -C apps/demo test:visual
```

Review the updated PNGs before committing them.

## Performance Baseline

Run the default demo benchmark set after `pnpm build:demo`:

```bash
pnpm bench:demo
```

The default benchmark scenarios are:

- `mount-scatter-200k-quality`
- `pan-scatter-200k-balanced`
- `append-scatter-50k-window`

Results are written to:

```text
apps/demo/test/perf-artifacts/benchmark-results.json
```

Compare against the previous release or a known-good main-branch run. Treat a
regression above roughly 10% in mount time, pan latency, append throughput, or
observed FPS as a release blocker unless the changelog explains the tradeoff.

For a fuller local sweep, run:

```bash
BENCH_FULL=1 pnpm bench:demo
```

## Publish

After the baseline passes and the version/changelog are committed:

```bash
npm login
npm whoami
pnpm publish:packages
git tag v<version>
git push origin HEAD --tags
```

Do not publish from the repo root with plain `npm publish`; use the workspace
publish script so all publishable packages are handled consistently.
