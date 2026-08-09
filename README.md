# docs-atlas

**A derived, auditable knowledgebase over your repository's own documentation** — index, dashboard, deck and
rot detection, generated from the markdown you already have.

Zero dependencies. Node ≥ 18. No network, no service, no database. It reads your repository and writes one
directory you can delete at any time.

Ships as a [Claude Code](https://claude.com/claude-code) skill, and as a standalone CLI that runs anywhere.

---

## The one rule everything else follows

**Your markdown is the source of truth. Everything docs-atlas produces is derived.**

Delete the output directory, rebuild, and you get a byte-identical result. The tool owns no prose that is not
already a committed `.md` file in your repository — so it cannot drift from your documentation, because it has
nothing of its own to drift with.

This is not a stylistic preference. A documentation system that keeps its own copy of a fact is a second thing
to maintain, and it will fork exactly the way hand-maintained documentation already forks.

## Why

Documentation rots quietly, and the rot is mechanically detectable long before anyone notices it. On the
repository this tool was built against — 387 markdown files, 73,000 lines, 234 doc commits in six weeks — the
first run found:

- **two copies of the user manual**, differing only by a hyphen in the filename, one of them still using a
  product name retired a month earlier;
- **7 dead internal links**;
- an architecture document citing **21 source files that had all changed since it was last touched**;
- a task listed as open that had been **closed and verified weeks before**;
- and **no index of any kind** — no way in but `ls` and prior knowledge.

None of that needed judgment to find. All of it needed someone to look.

## Install

**As a Claude Code skill** — clone into your skills directory:

```bash
git clone https://github.com/rmaurya/docs-atlas.git .claude/skills/docs-atlas
```

Claude then loads it automatically when you ask about documentation, a docs index, doc health, a developer
manual, or a project knowledgebase.

**As a CLI** — clone anywhere and call the script:

```bash
git clone https://github.com/rmaurya/docs-atlas.git
node docs-atlas/scripts/atlas.mjs --help
```

## Use

```bash
S=.claude/skills/docs-atlas/scripts/atlas.mjs

node $S init            # write a config, detecting your repository's layout
node $S scan            # index the corpus                      --json for the raw model
node $S tasks           # your planning document, with progress bars
node $S contrib         # who did what, from git history alone
node $S health          # the rot report — exit 1 on blocking findings
node $S build           # generate the site: index, dashboard, deck, health
node $S watch           # rebuild on change; the open page reloads itself
node $S all             # scan + health + build
```

Publishing stages by default and **never pushes without an explicit `--push`**:

```bash
node $S publish --target wiki     # GitHub Wiki — flattened markdown, links rewritten, drift-guarded
node $S publish --target pages    # the full site to a gh-pages branch
node $S publish --target export   # one self-contained HTML file
```

## What it produces

| Page | What it is |
|---|---|
| **Index** | Every document, grouped by a cluster taxonomy, with client-side full-text search |
| **Document pages** | Rendered markdown with a table of contents, **backlinks**, and its own signals |
| **Dashboard** | Progress by track, items by status, health signals, and a sortable/searchable item table |
| **Deck** | A browser slide deck from a markdown source — keyboard nav, overview, print to PDF |
| **Health** | Every rot signal, split into blocking and advisory |

## Rot signals

| | Signal | Default |
|---|---|---|
| **H1** | Dead internal link | **blocking** |
| H2 | Unresolvable `path:line` citation | advisory |
| **H3** | Duplicate title across documents — the signature of a forked doc | **blocking** |
| H4 | Orphan — nothing links to it | advisory |
| H5 | Landed in the fallback cluster | advisory |
| H6 | Stale — cited code moved after the doc was last touched | advisory |
| H7 | Forbidden term (retired names, old branding) | advisory |
| **H8** | No `#` title | **blocking** |
| H9 | Cross-reference asymmetry between paired documents | advisory |

**Blocking versus advisory is the design's load-bearing compromise.** Blocking signals have no legitimate
cause. Advisory ones do — an archived record *should* cite code that has since moved, and a historical spec
*should* name a retired product. Making everything blocking is the reliable way to get the whole report
ignored within a week.

**Suppressions require a stated reason.** An unexplained suppression is itself a defect.

## Honesty rules, enforced in the output

These are why the tool is worth trusting, and they are not negotiable in contributions:

- **A check that could not run is never reported as a check that passed.** Every report carries a
  *"Not checked"* section naming what was skipped and why.
- **Unknown is not zero.** An item with no recorded figure is charted as unknown and excluded from means —
  charting it as 0% would invent data.
- **Estimated is not measured.** Where a source marks a figure as estimated, the chart draws it hatched.
- **Active hours are an estimate and say so.** They are derived from gaps between commits, so they measure
  commit rhythm, not time worked. They are a floor, not a timesheet.
- **There is no combined "contribution score", and there will not be one.** Commits, files, churn and
  surviving lines are reported side by side. A ranked leaderboard of people is the one output this tool
  deliberately refuses to produce.
- **Prompt quality is not measured, because a repository cannot see a prompt.** What is reported are outcomes
  under their real names: rework rate, revert rate, commit-message conformance.

## Configuration

`atlas init` writes `llm-wiki.config.json` after inspecting your layout. Everything is overridable: the
cluster taxonomy, which signals block, the stale window, forbidden terms, cross-reference pairs, suppressions,
the planning source, and the deck source.

## Contributing

Run the tests:

```bash
node tests/run.mjs               # 66 integration tests against throwaway git repositories
node tests/run.mjs --filter H6   # or a subset
```

They build real git repos in a temp directory and run the real pipeline — there are no mocks. Several of them
exist because a bug shipped once and must not return; those carry a comment saying what went wrong. Please
keep that habit.

## Licence

MIT. See [`LICENSE`](LICENSE).
