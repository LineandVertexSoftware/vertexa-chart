# Contributing to vertexa-chart

Thank you for your interest in contributing! This document covers the development workflow, project conventions, and pull request process.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| pnpm | 9.12+ |
| Browser | Chrome/Edge 113+ or any browser with WebGPU support |

Install pnpm if you don't have it:

```bash
npm install -g pnpm
```

---

## Local setup

```bash
git clone https://github.com/LineandVertexSoftware/vertexa-chart.git
cd vertexa-chart
pnpm install
pnpm build          # build all packages
pnpm dev            # start the Vite demo app
```

The demo runs at `http://localhost:5173`. Append `?example=<name>` to navigate between examples (see `apps/demo/src/main.ts`).

---

## Monorepo layout

```
packages/
  vertexa-chart      — public chart API
  renderer-webgpu    — WebGPU rendering pipelines and shaders
  overlay-d3         — D3 axes, zoom/pan, legend, selection
apps/
  demo               — Vite dev app and visual regression harness
```

Each package has its own `tsconfig.json` and `package.json`. All packages share `tsconfig.base.json` at the root.

---

## Development workflow

### Making changes

1. Work in the relevant package under `packages/`.
2. Run `pnpm dev` in the repo root to get the demo hot-reloading against the source.
   Alternatively, run `pnpm build --watch` from the package root.
3. If you change public types in `packages/vertexa-chart/src/types.ts`, re-run `pnpm build` so downstream packages pick up the new declarations.

### Checking your work

```bash
pnpm build          # compile all packages
pnpm typecheck      # type-check all packages
pnpm test           # run unit tests
```

Full release validation (what CI runs):

```bash
pnpm release:check
```

---

## Tests

Unit tests live in each package's `test/` directory and use Node's built-in test runner.

```bash
# Run tests for all packages
pnpm test

# Run tests for a single package
pnpm -C packages/vertexa-chart test
```

**Visual regression tests** capture screenshots of the demo app using Chromium. They require a local Chromium installation:

```bash
pnpm test:visual
```

Baseline snapshots live in `apps/demo/test/visual-snapshots/`. If you intentionally change a chart's appearance, update the baselines by deleting the affected snapshot and re-running.

---

## Code style

- **TypeScript strict mode** is enabled across all packages.
- Imports use NodeNext module resolution — always include `.js` extensions even for `.ts` sources.
- Keep the public API surface of `vertexa-chart` minimal. Internals should live in `renderer-webgpu` or `overlay-d3`.
- GPU-specific code (WGSL shaders, buffer management) belongs in `renderer-webgpu`.
- D3-specific code (axes, zoom behavior, SVG annotations) belongs in `overlay-d3`.

---

## Pull request process

1. **Fork** the repository and create a branch from `main`.
2. **Keep PRs focused** — one logical change per PR makes review faster.
3. **Add tests** for new behavior where practical.
4. **Update the README** if you change the public API or add a new chart type.
5. Open a pull request and fill in the PR template.

PRs that break the `pnpm release:check` pipeline will not be merged.

---

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml) when opening an issue. Include:

- Browser and version
- A minimal reproduction (CodePen, StackBlitz, or a code snippet)
- Expected vs. actual behaviour

---

## Proposing new features

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) before writing code for larger changes. This avoids duplicated effort and helps us align on design before implementation.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org). Patch releases fix bugs; minor releases add backward-compatible features; major releases may include breaking API changes.

Maintainers handle version bumps and publishing:

```bash
pnpm version:patch   # bump all packages to next patch
pnpm publish:packages
```

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.
