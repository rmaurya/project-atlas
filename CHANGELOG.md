# Changelog

All notable changes to docs-atlas. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Selectable light/dark themes with a one-click toggle, defaulting to the system setting.
- Role-scoped views (QC, product, delivery, architecture, developer, executive).
- Contribution analytics surfaced on the dashboard, not just the CLI.
- GitLab support alongside GitHub for the wiki and pages targets.

## [0.1.0] — 2026-08-09

First release. Built against a 387-file, 73,000-line corpus, and every signal below fired on something real
there before it shipped.

### Added
- **Index and site generation** — cluster taxonomy, backlinks, per-document tables of contents, client-side
  full-text search. Offline, deterministic, byte-identical on rebuild.
- **Nine rot signals** split into blocking and advisory, with mandatory-reason suppressions and a
  "Not checked" section on every report.
- **Citation resolution** — literal path, unique suffix, then unique basename; ambiguous citations resolve to
  nothing and are declared rather than guessed.
- **Dashboard** — stat tiles, progress by track, items by status, health signals, documents by cluster, and a
  sortable/searchable item table. Single-hue ordinal ramp, validated in both themes.
- **Deck** — a browser slide deck from a markdown source, with keyboard navigation, overview and print.
- **Contribution analytics** (`atlas contrib`) — people, agents, desks, estimated active hours, rework and
  revert rates, spec-to-build coverage. Derived entirely from `git log`.
- **Publishing** — GitHub Wiki (flattened, re-linked, drift-guarded via a content manifest), a `gh-pages`
  branch, and a single self-contained HTML export. Nothing pushes without an explicit `--push`.
- **`atlas watch`** — rebuild on change; the open page reloads itself.
- 66 integration tests against throwaway git repositories.

### Fixed during development, and pinned by regression tests
- Bare-filename code citations were reported as broken at a **77% false-positive rate** before the resolver
  existed.
- Document pages loaded their stylesheet from the wrong path, so every one rendered unstyled — caught only by
  opening one in a browser.
- SOPs living under an `architecture/` directory were swallowed by the directory rule, leaving the Procedures
  cluster falsely empty. Filename patterns now precede directory patterns.
- `README.md` flattened to the wiki page name `Home` and was silently overwritten by the generated index.
- Git metadata never loaded at all: raw NUL bytes cannot be passed in `argv`, and a bare `catch` absorbed the
  error — so staleness evaluated nothing while reporting clean.
- `cfg.staleDays || 90` reinterpreted a configured `0` as the default.
- Staleness compared day-granularity dates, so same-day drift was invisible.
- The estimated-figure marker was swallowed by a greedy quantifier, reporting every estimate as measured.
