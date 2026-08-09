```
████  ████   ███     ██ █████  ████ █████     ███  █████ █      ███   ████
█   █ █   █ █   █     █ █     █       █      █   █   █   █     █   █ █
████  ████  █   █     █ ███   █       █      █████   █   █     █████  ███
█     █  █  █   █ █   █ █     █       █      █   █   █   █     █   █     █
█     █   █  ███   ███  █████  ████   █      █   █   █   █████ █   █ ████
```

[github.com/rmaurya/project-atlas](https://github.com/rmaurya/project-atlas)

A derived, auditable knowledgebase over your repository's own documentation. Indexes the markdown you already
have, detects rot mechanically, and generates a searchable site, a project dashboard and a browser slide deck.
Your markdown stays the source of truth; everything generated regenerates byte-identically, so it cannot fork
from your docs. Adapts to what your host actually offers — Wiki, Pages, Issues and Discussions are each
detected, never assumed. Ships as a Claude Code skill, a portable `AGENTS.md` for any LLM agent, and a
standalone CLI. Zero dependencies, Node ≥ 18, and **one** optional network call (`atlas caps`).

---

[Install](#install) ·
[Quick start](#quick-start) ·
[Why](#why) ·
[What it produces](#what-it-produces) ·
[Rot signals](#rot-signals) ·
[Contributions](#contribution-analytics) ·
[Publishing](#publishing) ·
[Host capabilities](#host-capabilities) ·
[Honesty rules](#honesty-rules-enforced-in-the-output) ·
[Configuration](#configuration) ·
[Reference guides](#reference-guides) ·
[Contributing](#contributing) ·
[Changelog](CHANGELOG.md) ·
[Roadmap](ROADMAP.md) ·
[Licence](#licence)

---

## The one rule everything else follows

**Your markdown is the source of truth. Everything project-atlas produces is derived.**

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

One source of skills, three runtimes. Pick yours.

**Claude Code** (native plugin) — the CLI lands on your PATH as `atlas` in sessions started after the install:

```bash
/plugin marketplace add rmaurya/project-atlas
/plugin install atlas@project-atlas
```

Skills arrive namespaced: `/atlas:help`, `/atlas:status`, `/atlas:health`, `/atlas:ask`, `/atlas:review`,
`/atlas:config`, `/atlas:publish`.

**OpenAI Codex** (marketplace plugin):

```bash
codex plugin marketplace add rmaurya/project-atlas
codex plugin add atlas@project-atlas
```

Or from a local checkout:

```bash
codex plugin marketplace add /absolute/path/to/project-atlas
codex plugin add atlas@project-atlas
```

**Google Antigravity** (drop-in plugin) — Antigravity scans its plugin directories on start, so a clone into
either location is the whole install:

```bash
# workspace-scoped
git clone https://github.com/rmaurya/project-atlas.git .agents/plugins/project-atlas

# or user-scoped, available in every project
git clone https://github.com/rmaurya/project-atlas.git ~/.gemini/config/plugins/project-atlas
```

**Any other agent, or none at all** — clone and run it:

```bash
git clone https://github.com/rmaurya/project-atlas.git
./project-atlas/bin/atlas --help
```

Agents without a plugin system should load [`AGENTS.md`](AGENTS.md), which carries the same instructions in a
portable form.

### How much is actually shared

**One repository, one `skills/` directory, three manifests.** The `SKILL.md` format is common across all
three runtimes, so the instructions are written once:

| Runtime | Manifest | Reads `skills/` |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | in place |
| Antigravity | `plugin.json` at the repository root | in place |
| Codex | `.agents/plugins/marketplace.json` → `plugins/atlas/.codex-plugin/plugin.json` | **via a generated copy** |

Codex is the one exception, and for a specific reason: a Codex marketplace resolves `source.path` relative to
the marketplace root and **requires a subdirectory** — `"./"` is rejected — so the repository cannot be its
own Codex plugin entry the way it can be its own Claude one. `plugins/atlas/` exists only to satisfy that.

A copy is a fork waiting to happen, which is precisely what this tool exists to detect, so it is **generated
and drift-checked** rather than hand-maintained:

```bash
node scripts/sync-runtimes.mjs           # regenerate
node scripts/sync-runtimes.mjs --check   # fail if it has drifted — runs in CI and in the test suite
```

## Quick start

```bash
atlas init      # write a config, detecting your repository's layout
atlas scan      # index the corpus                    --json for the raw model
atlas health    # the rot report — exit 1 on blocking findings
atlas build     # generate the site: index, dashboard, deck, health
```

Then open `docs/_wiki/index.html`. Nothing existing is modified — the output is one directory you can delete
at any time.

**Everything else:**

```bash
atlas branch [type slug]   # where you are, and whether it is safe to commit there
atlas tasks [filter]       # your planning document, with progress bars
atlas contrib              # who did what, from git history alone
atlas tokens               # where the tokens went — local transcripts, opt-in, never published
atlas caps                 # which host features are on (wiki/pages/issues/discussions)
atlas community --write    # scaffolding for the features this host supports
atlas watch                # rebuild on change; the open page reloads itself
atlas all                  # scan + health + build
```

If `atlas` is not on your PATH — you cloned it rather than installing the plugin — every command works the
same as `./bin/atlas <command>` or `node scripts/atlas.mjs <command>`.

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

## Token accounting

```bash
atlas tokens               # the split; --out FILE to save, --json for the raw model
```

**The only command that reads session transcripts**, and nothing else in the tool touches them. They are not
part of the repository — machine-local, unversioned, and holding every prompt and file read of every session.
So the report aggregates only, never publishes, and **refuses to write into the output directory**, which is
pushed to wikis and Pages branches.

The split is the point. On one real project: **11.9 billion tokens, 98.7% of them cache reads** — context
re-read each turn, charged at a fraction of fresh input. A single "tokens used" figure would treat those as
equal and make a cheap session look expensive.

Cost appears only when you configure rates, because prices are not in the transcript and they change; the
report prints the date you entered them, and names any model it had no rate for.

## Publishing

```bash
atlas publish --target wiki       # GitHub Wiki — flattened markdown, links rewritten, drift-guarded
atlas publish --target pages      # the full site to a gh-pages branch
atlas publish --target export     # one self-contained HTML file
```

**Nothing pushes without an explicit `--push`.** The default stages to a temp directory and prints what would
go where.

GitHub offers no pull-request review on wiki repositories, so every push there is immediately live. Each page
therefore carries a do-not-edit banner, and each publish records a content hash per page. When a hash no
longer matches, publish **refuses** — `--import` copies the hand-edited pages out for review rather than
destroying them.

## Host capabilities

Wiki, Pages, Issues and Discussions can each be off, and a publish target aimed at a disabled feature fails
with an obscure git error. So the tool checks:

```bash
atlas caps          # which features are on; --offline to skip the check entirely
atlas community     # generate scaffolding for the ones that exist; --write to create it
```

`caps` is **the only command that touches the network**, it says so when it runs, and the result is cached for
an hour inside `.git/`. Everything else is entirely offline. When the check cannot run — offline, rate
limited, private without a token — targets proceed on a **stated assumption** rather than blocking or guessing
silently.

`community` generates issue templates, a PR template and a Discussions welcome post **seeded from your own
repository** — its real document counts, cluster names and open items — and generates *only* what the host
supports. It lists what it skipped and why, and never overwrites your files without `--force`.

One distinction worth knowing, because it cost a confusing failure to find: **a wiki being enabled is not the
same as its repository existing.** GitHub creates `<repo>.wiki.git` only when the first page is saved by hand,
so the tool checks reachability with `git ls-remote` and tells you exactly that, rather than letting the push
fail as "Repository not found".

## Honesty rules, enforced in the output

These are why the tool is worth trusting, and they are not negotiable in contributions:

- **A check that could not run is never reported as a check that passed.** Every report carries a
  *"Not checked"* section naming what was skipped and why.
- **Nothing is silently dropped.** Truncated, sampled, skipped and suppressed are all counted and stated.
- **Unknown is not zero.** An item with no recorded figure is charted as unknown and excluded from means —
  charting it as 0% would invent data.
- **Estimated is not measured.** Where a source marks a figure as estimated, the chart draws it hatched.

## Configuration

`atlas init` writes `project-atlas.config.json` after inspecting your layout. Everything is overridable: the
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
| [branching](references/branching.md) | How work reaches `main`, and what an assistant must check first |
| [maintenance](references/maintenance.md) | The loop, the trigger, and the abandonment criterion |
| [configuration](references/configuration.md) | Every config key |

## Contributing

```bash
node tests/run.mjs               # 76 integration tests against throwaway git repositories
node tests/run.mjs --filter H6   # or a subset
```

No mocks — the tests build real git repos and run the real pipeline, because every bug this tool has shipped
lived in the seam between the code and git. Several tests exist because a bug shipped once and must not
return; those carry a comment saying what went wrong. Please keep that habit, and read
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the non-negotiables before proposing a change that removes one.

## Licence

MIT. See [`LICENSE`](LICENSE).
