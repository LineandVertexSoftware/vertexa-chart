# Changelog

## 1.0.0 - Unreleased

- Locked the public `Chart` contract and documented the supported runtime,
  trace, interaction, picking, tooltip, export, and semver behavior.
- Changed `tooltip.renderer` string output to render as text. Return a `Node`
  for custom tooltip markup.
- Hardened export coverage for PNG, SVG, CSV, toolbar downloads, and export
  option flags on mixed-layer charts.
- Expanded deterministic demo visual coverage to nine scenarios across scatter,
  bar, area, heatmap, histogram, runtime events, toolbar, legend, and selected
  states.
- Added release gates for Node 22 and Node 24, package install smoke tests,
  demo builds, visual snapshots, and performance thresholds.
- Added release preflight checks for package metadata, version alignment, and
  publish-script shape.
- Added a manual browser smoke checklist for release candidates.
- Made the monorepo root private so package publishing goes through the
  workspace publish flow.
- Added explicit release-candidate version and `next` publish scripts.

## 0.2.0 - 2026-08-23

- Added richer hover template fields for text, customdata, trace metadata, and heatmap z values.
- Added `appendPoints()` alignment for hover text and customdata.
- Added `layout.uirevision` support to preserve interaction state across data and layout updates.
- Expanded visual regression coverage across seven deterministic demo scenarios.
