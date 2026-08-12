```
████  ████   ███     ██ █████  ████ █████     ███  █████ █      ███   ████
█   █ █   █ █   █     █ █     █       █      █   █   █   █     █   █ █
████  ████  █   █     █ ███   █       █      █████   █   █     █████  ███
█     █  █  █   █ █   █ █     █       █      █   █   █   █     █   █     █
█     █   █  ███   ███  █████  ████   █      █   █   █   █████ █   █ ████
```

[github.com/rmaurya/project-atlas](https://github.com/rmaurya/project-atlas)

**project-atlas is a documentation knowledgebase generator for software repositories.** It indexes the
markdown files you already have, detects documentation drift mechanically — dead links, forked documents,
stale code citations, orphan pages, SOPs past their review date — and generates a searchable static site, a
project dashboard, a health report and a browser slide deck.

Your markdown stays the source of truth; everything generated regenerates byte-identically, so it cannot fork
from your docs. It adapts to what your host actually offers — Wiki, Pages, Issues and Discussions are each
detected, never assumed. It ships as a Claude Code skill, a portable `AGENTS.md` for any LLM agent, an MCP
server, and a standalone CLI. Zero dependencies, Node ≥ 18, and network access from **one** optional command
(`atlas caps`).

### See it running on its own documentation

**[rmaurya.github.io/project-atlas](https://rmaurya.github.io/project-atlas/)** — this repository's own
markdown, indexed and measured by this tool, published by `atlas publish --target pages`. It is the same
output any repository gets. Three pages make the argument on their own:

- **[The health report](https://rmaurya.github.io/project-atlas/health.html)** — every rot signal against this
  corpus, split into blocking and advisory, with a *Not checked* section naming what could not be verified.
- **[The dashboard](https://rmaurya.github.io/project-atlas/dashboard.html)** — plan progress, contribution
  history and corpus health on one page, all of it derived from the repository.
- **[The wiki index](https://rmaurya.github.io/project-atlas/wiki.html)** — every document, grouped by
  cluster, with client-side search.

The published site deliberately omits the work-in-flight and session-task panels. Those describe the machine
that ran the build — the subject lines of a private task list and the paths of uncommitted files — so they are
stripped when a site is staged for publishing, before anyone reviews it, rather than at push time. Install the
tool and `atlas serve` gives you those panels on a loopback-only dashboard that never leaves your machine.

---

[Live site](https://rmaurya.github.io/project-atlas/) ·
[Install](#install) ·
[Quick start](#quick-start) ·
[Why](#why) ·
[What project-atlas does](#what-project-atlas-does) ·
[Capabilities](docs/CAPABILITIES.md) ·
[Features](docs/FEATURES.md) ·
[FAQ](docs/FAQ.md) ·
[What it produces](#what-it-produces) ·
[Health check](#how-the-documentation-health-check-works) ·
[Contributions](#contribution-analytics) ·
[Publishing](#publishing) ·
[Host capabilities](#host-capabilities) ·
[Honesty rules](#honesty-rules-enforced-in-the-output) ·
[Configuration](#configuration) ·
[Reference guides](#reference-guides) ·
[Questions](#frequently-asked-questions) ·
[Contributing](#contributing) ·
[Changelog](CHANGELOG.md) ·
[Roadmap](docs/ROADMAP.md) ·
[Licence and legal](#licence-and-legal)

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

## What project-atlas does

project-atlas reads the markdown in a repository and produces four things from it: an **index** with a cluster
taxonomy and backlinks, a **health report** of sixteen mechanical rot signals, a **static site** with
client-side search and eleven role-specific views, and a **structured API** — an MCP server and a JSON command
with CI-shaped exit codes — so an agent or a build can ask the same questions without a terminal.

It does not write your documentation, move it, or keep a copy of it. Everything it generates lands in one
directory that is cleared and rewritten on every build — after the build has proved the directory is its own
to clear — which is what makes it unable to drift from the documents it describes.

Three pages cover this in full, and they are kept honest by the same rule the tool enforces on everything
else — every claim in them cites the code, `path:line`:

| Page | Answers |
|---|---|
| [**What project-atlas can do**](docs/CAPABILITIES.md) | Organised by the job you came to do: audit a corpus, make it navigable, keep it current, publish it, query it from software, see how work is going. Each section says where the capability stops. |
| [**The feature inventory**](docs/FEATURES.md) | Every command, rot signal, slash command, hook, MCP tool and generated file, each with the line of code that implements it and a status — including what is partial, what is not built, and what a document claims that the code does not do. |
| [**Frequently asked questions**](docs/FAQ.md) | The questions that come up before installing and in the first hour after. |

## Install

**One line, any runtime:**

```bash
curl -fsSL https://raw.githubusercontent.com/rmaurya/project-atlas/main/install.sh | sh
```

It detects Claude Code, Codex or Antigravity and installs accordingly; with none of them it installs the
standalone CLI. Read it first if you would rather not pipe a script — it is 120 lines and does nothing but
clone this repository and call your agent's own plugin command.

<details>
<summary><b>Or install by hand</b></summary>

**Claude Code** — `atlas` lands on your PATH in sessions started after the install:

```bash
claude plugin marketplace add rmaurya/project-atlas && claude plugin install atlas@project-atlas
```

Skills arrive namespaced — **thirty-eight of them**, one per directory under `skills/`. `/atlas:help` prints
the map. The ones worth knowing on day one: `/atlas:build` `/atlas:status` `/atlas:health` `/atlas:changes`
`/atlas:diff` `/atlas:ask` `/atlas:review` `/atlas:config` `/atlas:publish` `/atlas:dashboard` `/atlas:mcp`
`/atlas:plan`. The full list, each with the command it shells out to, is
[§3 of the feature inventory](docs/FEATURES.md#3-slash-commands-claude-code-skills).

**OpenAI Codex:**

```bash
codex plugin marketplace add rmaurya/project-atlas && codex plugin add atlas@project-atlas
```

**Google Antigravity** — it scans its plugin directories on start, so a clone is the whole install:

```bash
git clone https://github.com/rmaurya/project-atlas.git ~/.gemini/config/plugins/project-atlas
```

**No agent at all:**

```bash
git clone https://github.com/rmaurya/project-atlas.git && ./project-atlas/bin/atlas --help
```

</details>

<details>
<summary><b>Why two commands and not one</b></summary>

Adding a marketplace is **local to your machine** — it writes `~/.claude/plugins/known_marketplaces.json` and
caches a clone. Nothing about it is published, so every user runs it themselves. A single
`claude plugin install atlas@project-atlas` only works once that marketplace is already registered, which is
why the two are chained above.

For a **team**, add it with `--scope project`: the marketplace is then declared in `.claude/settings.json`,
which you commit, and anyone cloning the repository gets it without running anything.

</details>

### How much is actually shared

**One repository, one `skills/` directory, three manifests.** The `SKILL.md` format is common to all three
runtimes, so the instructions are written once:

| Runtime | Manifest | Reads `skills/` |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | in place |
| Antigravity | `plugin.json` at the repository root | in place |
| Codex | `.agents/plugins/marketplace.json` → `plugins/atlas/.codex-plugin/plugin.json` | **via a generated copy** |

Codex is the one exception: its marketplace resolves `source.path` relative to the marketplace root and
**requires a subdirectory** — `"./"` is rejected — so the repository cannot be its own Codex plugin entry the
way it can be its own Claude one. `plugins/atlas/` exists only to satisfy that, and because a copy is a fork
waiting to happen it is **generated and drift-checked** rather than hand-maintained:

```bash
node scripts/sync-runtimes.mjs --check   # runs in CI and in the test suite
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

| Command | What it does |
|---|---|
| `atlas version` | Which build is answering, where it lives, and whether it is behind the installed one. |
| `atlas init` | Write `project-atlas.config.json` by detecting this repo's layout — nothing existing is modified. |
| `atlas scan` | Build the index and summarise it: documents, clusters, links, citations. |
| `atlas ask <task>` | One structured JSON answer for a program — `atlas_health`, `atlas_plan`, `atlas_search`, `atlas_changes`, `atlas_contrib`, `atlas_design`, `atlas_state`. Exit 0 clean, 1 on a blocking finding, 2 if it could not run. |
| `atlas mcp` | Serve the corpus over MCP on stdio — the same seven tools, read-only. `--status` says what a client would connect to. |
| `atlas note` / `atlas state` / `atlas handoff` | The continuity journal: record what was decided, read back what a resuming session needs, print the derived half of a handoff. |
| `atlas design [--scaffold]` | Which design artifacts exist; `--scaffold` writes the questions a missing one owes an answer to, never the answers. |
| `atlas serve` | The live dashboard on loopback — build, start, open, and print the URL. `--list` shows every one running on this machine. |
| `atlas changes` | Uncommitted work, what this branch does, and which documents cite the files you touched. |
| `atlas diff <file>` | One file's diff — uncommitted, else across the branch. |
| `atlas health` | Documentation rot report: dead links, forked documents, stale citations, orphans. Exit 1 if a blocking signal fires. |
| `atlas plan` | The git route for work in progress: branch, type, version bump, way to main. Executes nothing without approval. |
| `atlas branch [type slug]` | Branch state, or create `type/short-slug` carrying your changes. |
| `atlas config` | The merged configuration — your overrides shown against the defaults. |
| `atlas tasks [filter]` | Your planning document, with progress bars. |
| `atlas caps` | Which host features are on — wiki, pages, issues, discussions. |
| `atlas community --write` | Scaffolding for the features this host actually supports. |
| `atlas contrib` | Who did what, from git history alone. |
| `atlas ownership` | Areas by author, and where the bus factor is one. |
| `atlas surviving` | Surviving lines by file — what of the work is still standing. |
| `atlas worklog` | Write the day's log to `worklog/` — commits, rework rate, items closed. |
| `atlas git-insights [section]` | What git history says that nothing else here reads: hotspots, coupling, branches, cadence, hygiene, change. Read-only. |
| `atlas tokens` | Where the tokens went — local transcripts, opt-in, never published. |
| `atlas sessions` | How sessions went — turns, interruptions, friction, rework. |
| `atlas prompt` | A system prompt assembled from this repository's own rules and state, for an agent that cannot load the plugin. |
| `atlas pause` / `atlas resume` / `atlas stop` | The state of the *work*: checkpoint every agent worktree to a `wip/agent-*` ref, print the re-spawn plan, or clear session state. Every branch and checkpoint survives a `stop`. |
| `atlas build` | Generate the site: index, dashboard, deck, health. |
| `atlas watch` | Rebuild on change; the open page reloads itself. |
| `atlas all` | scan + health + build. |
| `atlas publish` | Stage a wiki, pages branch, or single-file export — nothing is pushed without `--push`. |

`atlas help` prints the same list from the CLI, and **that list is complete** — a test derives the dispatch
table from the source and fails when a command is missing from it, or when it names one that does not exist.

`atlas status` and `atlas review` are not CLI commands — they exist only as the `/atlas:status` and
`/atlas:review` slash commands, which read the same index and add the judgement a table cannot.

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

## How the documentation health check works

`atlas health` runs **sixteen mechanical checks over the indexed corpus**, and reports one more — H17 — that
is about how the session was run rather than about the repository. It exits 1 if any **blocking** signal
fires. Every corpus signal is a fact about the repository — "this link points at a file that does not exist"
— never a judgement about writing quality, because a tool that mixes the two teaches people to distrust both.

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
| **H10** | SOP past its own declared review date | **blocking** |
| H11 | SOP names no owner, or one with no commits here | advisory |
| **H12** | A step in an SOP cites something that cannot be resolved | **blocking** |
| H13 | Handoff written far behind HEAD | advisory |
| H14 | Design document cites code that has moved — stricter than H6, with no grace period | advisory |
| H15 | An expected design artifact is absent, or is still a scaffold | advisory |
| H16 | A code area no design document cites | advisory |
| H17 | Large session, no subagent — **measures the operator, not the corpus** | advisory, and can never block |

**Five of the seventeen block by default: H1, H3, H8, H10 and H12.** H10 and H12 join them because an SOP that
has drifted is not out of date, it is incorrect instructions somebody is following.

**H17 is a different kind of claim, and the table says so.** H1–H16 are statements about the repository,
settled by reading the files. H17 reads local session transcripts and observes a working method — a lot of
editing in one thread with nothing delegated — which is legitimate and often right. It is advisory
**in code**, not by configuration: `"blocking": ["H17"]` loads without error and still does nothing.

**Blocking versus advisory is the design's load-bearing compromise.** Blocking signals have no legitimate
cause. Advisory ones do — an archived record *should* cite code that has since moved, and a historical spec
*should* name a retired product. Making everything blocking is the reliable way to get the whole report
ignored within a week.

**Suppressions require a stated reason.** An unexplained suppression is itself a defect, and the config is
rejected without one.

Full catalogue, with detection details and legitimate exceptions:
[`docs/references/health-signals.md`](docs/references/health-signals.md).

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

## What changed

```bash
atlas changes              # working tree, this branch, and the documentation it puts at risk
atlas diff <file>          # one file — uncommitted changes, else across the branch
```

Two scopes, because they answer different questions. **Working** is what is not saved yet. **Branch** is the
diff against its merge-base with the trunk — which is *not* the last few commits: a branch off an older base
contains work the last two commits miss, and a branch with ten commits is still one change. The trunk is
detected, not assumed to be `main`.

**The third section is why this exists rather than `git status`.** A changed source file is uninteresting
alone. A changed source file that a four-month-old architecture document cites is the finding — and the corpus
index already knows which documents those are. They are listed oldest first, with the files they name.

They are not necessarily wrong. They are the documents whose ground just moved.

Typed: `/atlas:changes` and `/atlas:diff <path>`. Both summarise rather than pasting a diff back at you.

## Token accounting

```bash
atlas tokens               # the split; --out FILE to save, --json for the raw model
```

**Transcripts are read by exactly two surfaces, and only when they are asked for**: `atlas tokens` and
`atlas sessions` on the command line, and a build that renders the **Economics** view — which reads the same
store to put the attribution on a page, and which `atlas watch` therefore triggers on every save. Nothing
else opens it: not `scan`, not `health`, not a hook, not `serve`, and not a build whose views do not include
Economics. This sentence used to say "the only command that reads session transcripts", which stopped being
true when the Economics view shipped; the rule is stated where it is enforced, `scripts/lib/tokens.mjs:14`.

Transcripts are not part of the repository — machine-local, unversioned, and holding every prompt and file
read of every session. So the read is one-way and counts-only, the report aggregates only, never publishes,
and **refuses to write into the output directory**, which is pushed to wikis and Pages branches. The
Economics panels carry `data-local-only` and are stripped at both publish doors. Full detail, with the line
of code for each claim: [`docs/legal/PRIVACY.md`](docs/legal/PRIVACY.md).

The split is the point. On one real project: **11.9 billion tokens, 98.7% of them cache reads** — context
re-read each turn, charged at a fraction of fresh input. A single "tokens used" figure would treat those as
equal and make a cheap session look expensive.

Cost appears only when you configure rates, because prices are not in the transcript and they change; the
report prints the date you entered them, and names any model it had no rate for.

## Session outcomes

```bash
atlas sessions             # turns per prompt, interruptions, compactions, tool friction, rework
```

Reads the same local transcripts as `atlas tokens`, under the same rules.

**It does not measure prompt quality, and it says so on every run.** A transcript records what happened *after*
a prompt, not whether the prompt was well judged — and a richer source does not change that. Every figure is
named for the thing it observes: turns per typed prompt, queued prompts, interruptions, compactions, tool
error rate, human-edited results. **None of them is combined into a score**, and there is a test asserting no
score appears under any name.

Read them as questions, not conclusions. A high tool-error rate might be a flaky environment. A high
turns-per-prompt might be one large well-scoped request rather than a misunderstood small one.

## Publishing

```bash
atlas publish --target wiki       # GitHub Wiki — flattened markdown, links rewritten, drift-guarded
atlas publish --target pages      # the full site to a gh-pages branch
atlas publish --target export     # one self-contained HTML file
```

**Nothing pushes without an explicit `--push`.** The default stages to a temp directory and prints what would
go where.

**GitHub and GitLab differ in two ways that matter**, and the tool handles both rather than assuming GitHub:
wiki repositories default to `master` on GitHub and `main` on GitLab — pushing to the wrong one silently
creates a branch the wiki UI never shows, which looks exactly like a push that did nothing. And **GitLab Pages
is a CI artifact, not a branch**: `--target pages --push` refuses there and points at `--ci`, which writes the
`pages` job that publishes `public/`.

GitHub offers no pull-request review on wiki repositories, so every push there is immediately live. Each page
therefore carries a do-not-edit banner, and each publish records a content hash per page. When a hash no
longer matches, publish **refuses** — `--import` copies the hand-edited pages out for review rather than
destroying them.

## What the hooks do, and which one can stop you

Everything else this tool asks of an assistant is prose — advisory, and any session can drift from it. Hooks
are executed by the harness rather than by the model, so they cannot be reasoned around. The plugin declares
eight of them across six events, and **exactly one can block**:

| When | What runs | Blocks? |
|---|---|---|
| Before any `git commit` | Branch guard, then the health gate, then the plan gate | **yes** — exit 2 |
| At session start | Update notice; starts the live dashboard and prints its URL | never |
| After a markdown write | Rebuilds the site | never |
| After a task-list change | Records the task state, then rebuilds | never |
| After any tool call | Keeps the dashboard alive; announces its URL once per session | never |
| At `Stop`, `SubagentStop` and `PreCompact` | Flushes continuity state to the journal | never |

**The commit guard is the one that matters.** It refuses when the working branch is protected, when a blocking
documentation signal would land, or when the message names no plan item — showing the fix before the commit
rather than after review. It exists because this project's own first five commits went straight to `main`
while its contributing guide preached discipline. Every Bash call that is not a `git commit` exits
immediately, so the cost is one `jq` and one `grep`.

**Health still does not run on every markdown edit.** That was written and removed, because a check that makes
every edit slower is a check people disable. The write hook only regenerates derived output — a rebuild, not
a check. Every hook is inert in a repository with no `project-atlas.config.json`, and
each is switchable under `automation` in the config. See [`hooks/README.md`](hooks/README.md).

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

`caps` reports that as a third state rather than folding it into `on`:

```
  half   Wiki        enabled, but not initialised — no page has ever been saved
```

This is why `caps` makes two requests on a cold run and not one — the host API answers whether the feature is
on, and only git answers whether the repository is there. Reporting `on` from the API alone told people the
wiki was ready to receive a publish, and `publish` then refused: two commands disagreeing about one
repository. The result is cached together, so the second call costs nothing.

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
[`docs/references/configuration.md`](docs/references/configuration.md).

## Reference guides

Loaded on demand, one topic each.

| Guide | Answers |
|---|---|
| [adoption](docs/references/adoption.md) | First run on a repository, and what to do with an existing docs tree |
| [authoring](docs/references/authoring.md) | The evidence rules and page shapes — **read before writing documentation** |
| [taxonomy](docs/references/taxonomy.md) | The cluster model, and why filename rules must precede directory rules |
| [health-signals](docs/references/health-signals.md) | Every signal, its detection, and its legitimate exceptions |
| [branching](docs/references/branching.md) | How work reaches `main`, and what an assistant must check first |
| [maintenance](docs/references/maintenance.md) | The loop, the trigger, and the abandonment criterion |
| [configuration](docs/references/configuration.md) | Every config key |
| [autonomy](docs/references/autonomy.md) | What may run unattended, what may never, and the line between them |
| [agent-control](docs/references/agent-control.md) | Why an external orchestrator is not part of this tool — **design, not built** |

## Frequently asked questions

[**docs/FAQ.md**](docs/FAQ.md) answers the questions that come up before installing and in the first hour
after — what it writes and where, what happens on a repository that already has a docs tree, whether it can
be run without an agent, and what it refuses to do.

Two more pages sit beside it: [what project-atlas can do](docs/CAPABILITIES.md), organised by the job you came
to do, and [the feature inventory](docs/FEATURES.md), which lists every command and signal with the line of
code that implements it.

## Contributing

```bash
node tests/run.mjs               # integration tests against throwaway git repositories
node tests/run.mjs --filter H6   # or a subset
```

**The suite holds 435 test cases.** That figure is not maintained by hand: a test reads it out of this
sentence and compares it against the cases it can count in `tests/run.mjs`, so adding a test and forgetting
this line fails the suite. A count stated in prose beside a list that grows is a defect waiting to happen,
and this repository has proved that twice (A-29).

No mocks — the tests build real git repos and run the real pipeline, because every bug this tool has shipped
lived in the seam between the code and git. Several tests exist because a bug shipped once and must not
return; those carry a comment saying what went wrong. Please keep that habit, and read
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the non-negotiables before proposing a change that removes one.

## Licence and legal

**MIT. See [`LICENSE`](LICENSE).**

**This is a hobby project, non-commercial, and nobody carries liability for what it does on your machine.**
Four pages state that position and the facts behind it. They sit *alongside* the MIT grant, not over it — where
the two appear to conflict, `LICENSE` governs.

| Page | What it says |
|---|---|
| [Terms and conditions](docs/legal/TERMS.md) | Hobby project, no warranty, no liability for the owner, related companies or any contributor — and installing it is acceptance. Ends with the questions a lawyer would still have to answer, unanswered on purpose. |
| [Privacy and data handling](docs/legal/PRIVACY.md) | What is read, what is written and where, and exactly what leaves the machine. Every claim cites `path:line`. |
| [Disclaimer](docs/legal/DISCLAIMER.md) | Why a clean health report is not a statement that your documentation is correct, and why advisory signals fire on documents that are fine. |
| [Third-party code](docs/legal/THIRD-PARTY.md) | There is none — no manifest, no lockfile, no vendored assets — and how that was checked. |

**No compliance with any jurisdiction is asserted anywhere in them.** No GDPR statement, no CCPA statement, no
export-control claim, no legal advice. Liability disclaimers are not enforceable to the same extent everywhere,
so the terms state the owner's intent rather than guaranteeing an outcome — and the open questions are written
down instead of answered, in the same spirit as `atlas design --scaffold`.
