# Release Baseline

Minimum local checks before publishing Vertexa Chart packages.

## Runtime

- Use Node 22 or Node 24 LTS for release checks.
- The packages support Node `>=20`, but Node 26 currently trips `c8` through its `yargs` dependency during package tests.
- Use the repo-pinned package manager when possible: `pnpm@9.12.0`.

```bash
nvm use 22
node -v
pnpm -v
```

Run the same checks on Node 24 before publishing:

```bash
nvm use 24
node -v
pnpm -v
```

If `pnpm -v` does not report `9.12.0`, let Corepack activate the repo-pinned
version:

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm -v
```

## Package Gate

Run from the repo root:

```bash
pnpm release:check
```

The script refuses to run outside Node 22/24 unless
`ALLOW_UNSUPPORTED_NODE=1` is set. It runs:

- `pnpm clean`
- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm pack:check`

The CI workflow runs this gate on Node 22 and Node 24 for pushes to `main` and
`dev`, pull requests to `main`, and manual workflow dispatches.

## Package Install Check

Before publishing a release candidate, verify the packed artifacts in a clean
consumer app:

```bash
pnpm pack:install-check
```

The script builds the packages, packs each workspace package to a temp
directory, checks the packed payloads, installs those tarballs into a small Vite
app, then runs TypeScript and production bundling against the public
`vertexa-chart` API. Set `KEEP_PACK_INSTALL_CHECK=1` to keep the temp files for
inspection.

CI also runs this check on Node 22 and Node 24.

## Full Local Gate

Run the package gate plus demo build, visual snapshots, and benchmark:

```bash
pnpm release:check:full
```

The visual gate covers nine deterministic demo scenarios:

- `getting-started`
- `axis-grid`
- `events-api`
- `bar-basics`
- `bar-time`
- `area-basics`
- `histogram-basics`
- `heatmap-basics`
- `visual-matrix`

If the visual change is intentional, update snapshots explicitly:

```bash
UPDATE_SNAPSHOTS=1 pnpm -C apps/demo test:visual
```

Review the updated PNGs before committing them.

## Performance Baseline

The full gate runs the default demo benchmark set and checks the results against
committed thresholds:

```bash
pnpm bench:demo:check
```

The default benchmark scenarios are:

- `mount-scatter-200k-quality`
- `pan-scatter-200k-balanced`
- `append-scatter-50k-window`

Results are written to:

```text
apps/demo/test/perf-artifacts/benchmark-results.json
```

Thresholds live in:

```text
apps/demo/test/perf-thresholds.json
```

Treat threshold failures in mount time, pan latency, append throughput,
long-frame ratio, sampled-point density, or observed FPS as release blockers
unless the changelog explains the tradeoff. Set `BENCH_THRESHOLD_MODE=warn` only
when collecting comparison data that should not fail the run.

For a fuller local sweep, run:

```bash
BENCH_FULL=1 pnpm bench:demo
```

This fuller benchmark is useful before a release candidate, but it is not part
of `pnpm release:check:full` because it takes longer and is noisier on local
machines.

## Publish

After the Node 22 and Node 24 gates pass and the version/changelog are
committed:

For a release candidate:

```bash
npm login
npm whoami
pnpm version:1.0.0-rc
pnpm release:check:full
pnpm pack:install-check
git commit -am "Prepare 1.0.0 release candidate"
pnpm publish:packages:next
git tag v1.0.0-rc.0
git push origin HEAD --tags
```

For the stable release:

```bash
npm login
npm whoami
pnpm version:1.0.0
pnpm release:check:full
pnpm pack:install-check
git commit -am "Release 1.0.0"
pnpm publish:packages
git tag v1.0.0
git push origin HEAD --tags
```

Do not publish from the repo root with plain `npm publish`; use the workspace
publish script so all publishable packages are handled consistently.
The publish scripts publish `renderer-webgpu` and `overlay-d3` before
`vertexa-chart`, so the primary package's internal dependencies are available
before it is published.
