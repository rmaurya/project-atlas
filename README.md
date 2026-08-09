```
██████   █████   ██████  ██████      █████  ███████ ██       █████   ██████
██   ██ ██   ██ ██      ██          ██   ██    ██   ██      ██   ██ ██
██   ██ ██   ██ ██       █████      ██   ██    ██   ██      ██   ██  █████
██   ██ ██   ██ ██           ██     ███████    ██   ██      ███████      ██
██   ██ ██   ██ ██           ██     ██   ██    ██   ██      ██   ██      ██
██████   █████   ██████ ██████      ██   ██    ██   ███████ ██   ██ ██████
```

[github.com/rmaurya/docs-atlas](https://github.com/rmaurya/docs-atlas)

A derived, auditable knowledgebase over your repository's own documentation. Indexes the markdown you already
have, detects rot mechanically, and generates a searchable site, a project dashboard and a browser slide deck.
Your markdown stays the source of truth; everything generated regenerates byte-identically, so it cannot fork
from your docs. Ships as a Claude Code skill, a portable `AGENTS.md` for any LLM agent, and a standalone CLI.
Zero dependencies, Node ≥ 18, no network.

---

[Install](#install) ·
[Quick start](#quick-start) ·
[Why](#why) ·
[What it produces](#what-it-produces) ·
[Rot signals](#rot-signals) ·
[Contributions](#contribution-analytics) ·
[Publishing](#publishing) ·
[Honesty rules](#honesty-rules-enforced-in-the-output) ·
[Configuration](#configuration) ·
[Reference guides](#reference-guides) ·
[Contributing](#contributing) ·
[Changelog](CHANGELOG.md) ·
[Roadmap](ROADMAP.md) ·
[Licence](#licence)

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

Claude loads it automatically when you ask about documentation, a docs index, doc health, a developer manual,
or a project knowledgebase.

**As a CLI, or for any other agent** — clone anywhere:

```bash
git clone https://github.com/rmaurya/docs-atlas.git
node docs-atlas/scripts/atlas.mjs --help
```

For non-Claude runtimes, point your agent at [`AGENTS.md`](AGENTS.md).

## Quick start

```bash
S=.claude/skills/docs-atlas/scripts/atlas.mjs

node $S init            # write a config, detecting your repository's layout
node $S scan            # index the corpus                      --json for the raw model
node $S health          # the rot report — exit 1 on blocking findings
node $S build           # generate the site: index, dashboard, deck, health
```

Then open `docs/_wiki/index.html`. Nothing existing is modified — the output is one directory you can delete
at any time.

**Everything else:**

```bash
node $S tasks [filter]  # your planning document, with progress bars
node $S contrib         # who did what, from git history alone
node $S watch           # rebuild on change; the open page reloads itself
node $S all             # scan + health + build
```

## What it produces

| Page | What it is |
|---|---|
| **Index** | Every document, grouped by a cluster taxonomy, with client-side full-text search |
| **Document pages** | Rendered markdown with a table of contents, **backlinks**, and its own signals |
| **Dashboard** | Progress by track, items by status, health signals, and a sortable, per-column-filterable item table |
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

**Suppressions require a stated reason.** An unexplained suppression is itself a defect, and the config is
rejected without one.

Full catalogue, with detection details and legitimate exceptions:
[`references/health-signals.md`](references/health-signals.md).

## Contribution analytics

`atlas contrib` reads `git log` and nothing else — no telemetry, no service, no new file to maintain. It
reports people, AI co-authors by model, per-desk attribution, estimated active hours, rework and revert rates,
commit-message conformance, and spec-to-build coverage.

Three things it deliberately will not do, and why they matter more than the features:

- **No combined contribution score, and no leaderboard of people.** Commits, files, churn and surviving lines
  are reported side by side; collapsing them into one number hides which one is driving it.
- **Active hours are an estimate and are labelled one everywhere.** They come from gaps between commits, so
  they measure commit rhythm, not time worked. A floor, not a timesheet.
- **Prompt quality is not measured, because a repository cannot see a prompt.** Outcome proxies ship under
  their real names.

## Publishing

```bash
node $S publish --target wiki     # GitHub Wiki — flattened markdown, links rewritten, drift-guarded
node $S publish --target pages    # the full site to a gh-pages branch
node $S publish --target export   # one self-contained HTML file
```

**Nothing pushes without an explicit `--push`.** The default stages to a temp directory and prints what would
go where.

GitHub offers no pull-request review on wiki repositories, so every push there is immediately live. Each page
therefore carries a do-not-edit banner, and each publish records a content hash per page. When a hash no
longer matches, publish **refuses** — `--import` copies the hand-edited pages out for review rather than
destroying them.

## Honesty rules, enforced in the output

These are why the tool is worth trusting, and they are not negotiable in contributions:

- **A check that could not run is never reported as a check that passed.** Every report carries a
  *"Not checked"* section naming what was skipped and why.
- **Nothing is silently dropped.** Truncated, sampled, skipped and suppressed are all counted and stated.
- **Unknown is not zero.** An item with no recorded figure is charted as unknown and excluded from means —
  charting it as 0% would invent data.
- **Estimated is not measured.** Where a source marks a figure as estimated, the chart draws it hatched.

## Configuration

`atlas init` writes `docs-atlas.config.json` after inspecting your layout. Everything is overridable: the
cluster taxonomy, which signals block, the stale window, forbidden terms, cross-reference pairs, suppressions,
the planning source, and the deck source. Every key is documented in
[`references/configuration.md`](references/configuration.md).

## Reference guides

Loaded on demand, one topic each.

| Guide | Answers |
|---|---|
| [adoption](references/adoption.md) | First run on a repository, and what to do with an existing docs tree |
| [authoring](references/authoring.md) | The evidence rules and page shapes — **read before writing documentation** |
| [taxonomy](references/taxonomy.md) | The cluster model, and why filename rules must precede directory rules |
| [health-signals](references/health-signals.md) | Every signal, its detection, and its legitimate exceptions |
| [maintenance](references/maintenance.md) | The loop, the trigger, and the abandonment criterion |
| [configuration](references/configuration.md) | Every config key |

## Contributing

```bash
node tests/run.mjs               # 66 integration tests against throwaway git repositories
node tests/run.mjs --filter H6   # or a subset
```

No mocks — the tests build real git repos and run the real pipeline, because every bug this tool has shipped
lived in the seam between the code and git. Several tests exist because a bug shipped once and must not
return; those carry a comment saying what went wrong. Please keep that habit, and read
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the non-negotiables before proposing a change that removes one.

## Licence

MIT. See [`LICENSE`](LICENSE).
