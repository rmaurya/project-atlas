# Frequently asked questions

**Last verified: 2026-08-11**, against `0.1.66` (`.claude-plugin/plugin.json:3`). Every answer that makes a
claim about the code cites the code, and every answer that has a longer form links to it rather than
restating it.

These are the questions that come up **before installing** and **in the first hour after**. Most of them exist
because somebody was surprised — several are recorded as defects in [`ROADMAP.md`](ROADMAP.md), and the
unflattering answers are here for the same reason the tool ships a *Not checked* section.

---

## Before you install

### What does it do to my repository?

It writes **one config file** and **one output directory**, and touches nothing else you wrote.

- `project-atlas.config.json` at the root. `atlas init` refuses to overwrite an existing one without
  `--force` (`scripts/atlas.mjs:1435-1438`), and it writes that file and nothing else
  (`scripts/atlas.mjs:1473`).
- `docs/_wiki/` by default (`scripts/lib/config.mjs:236`), cleared and rewritten on every build.
- `.atlas/` for operational state — a build lock, the server pidfile, the continuity journal. Most of it is
  git-ignored (`.gitignore:9-31`).

The build **refuses to clear an output directory that does not look like its own**: if the directory has
content but none of the markers a build leaves behind, it stops rather than deleting
(`scripts/lib/render.mjs:53-64`). That guard has already stopped `{"output": "."}` from deleting a repository.

### Will it rewrite, move, or summarise my documentation?

No. **The build never generates prose**, and that is the founding rule rather than a current limitation —
see [the one rule](../README.md#the-one-rule-everything-else-follows). Everything generated is derived from
markdown you committed, so deleting the output and rebuilding gives a byte-identical result.

An *assistant* using this tool does write documentation, as ordinary `.md` files landing in a diff you
review. The build script does not. [`references/authoring.md`](references/authoring.md) is the rule set for
the first case.

### What leaves my machine?

Four network calls exist in the whole tool, all of them named with the file and line that makes them, in
[`SECURITY.md`](../SECURITY.md#what-this-tool-touches):

| Call | When | Skippable |
|---|---|---|
| `GET api.github.com/repos/…` | `atlas caps`, and the probe before `publish` / `community` | `--offline` |
| `GET raw.githubusercontent.com/…/plugin.json` | the update check, at most once per 24 h | `ATLAS_UPDATE_CHECK=0` |
| `git ls-remote` (`scripts/lib/host.mjs:179`) | part of the same capability probe | `--offline` |
| `git clone --depth 1` (`scripts/lib/publish.mjs:241`) | staging `publish --target wiki`, **even without `--push`** | do not publish to a wiki |

**The last one is the one people do not expect**, and it is why this list has line numbers. Wiki staging
reads the remote because the drift guard cannot detect an edit it has not read. It still writes nothing
without `--push`. Everything else — `scan`, `health`, `build`, `tasks`, `changes`, `diff`, `branch`, and
`pages` / `export` staging — makes no request at all.

No telemetry, no account, no server belonging to this project. The evidence, claim by claim, is in
[`legal/PRIVACY.md`](legal/PRIVACY.md).

### Do I need Claude Code, or any agent at all?

No. `bin/atlas` is a five-line shim that execs `node scripts/atlas.mjs` (`bin/atlas:5`). Clone the repository
and run it. The plugin installs put `atlas` on your PATH and add the slash commands and hooks; none of that
is required for the CLI to work.

### Do my documents have to be committed first?

Yes, by default. Discovery runs `git ls-files -z` (`scripts/lib/scan.mjs:34`) and `trackedOnly` defaults to
`true` (`scripts/lib/config.mjs:237`), so an uncommitted draft in your working tree cannot be indexed and
cannot reach a published wiki. That is a deliberate safety boundary; turning it off removes it.

### What does it cost me if I try it and stop?

An afternoon. Phase 1 modifies nothing that already exists, and the output directory is safe to delete at any
moment. [`references/adoption.md`](references/adoption.md#what-to-say-when-someone-asks-is-this-worth-it)
argues this properly, including naming the abandonment trigger in advance.

---

## The first run

### Why is it reporting dozens of orphans? Is my documentation that bad?

No. **Orphans (H4) and staleness (H6) fire in bulk on any real corpus and always will.** This repository's own
report on 2026-08-11: 49 documents, 28 orphans, 11 unclassified — and none of them is a defect. Session logs,
work records and design scaffolds are found by search and by date, not by navigation.

That is why they are advisory rather than blocking. **The first report is a survey, not a to-do list**: read
the blocking findings, the two or three advisory signals that look like real problems, and the *Not checked*
section. Full reasoning per signal in
[`references/health-signals.md`](references/health-signals.md#h4--orphan--advisory); how to present the first
run in [`references/adoption.md`](references/adoption.md#3-run-health-as-a-survey).

### Everything landed in "uncategorised". What did I do wrong?

Nothing — a large fallback count is a **missing taxonomy rule, not a problem with the documents**
(`scripts/lib/config.mjs:239` sets the fallback). Add cluster rules until it is small enough to read.

One ordering trap accounts for most surprises: **filename patterns must come before directory patterns**,
because first match wins. A repository keeping its SOPs under `docs/architecture/` will otherwise have every
one swallowed by the directory rule, and the Procedures cluster reads as empty when it is full.
[`references/taxonomy.md`](references/taxonomy.md).

**This page is one of the eleven.** No cluster rule in `project-atlas.config.json` matches `docs/FAQ.md`, so
it fell through to `uncategorised` on the run that created it — which is the signal working, and a missing
rule rather than a misplaced document.

### Why was my commit refused?

The commit guard ran. It is the **only** hook that can block, and it runs three checks in order — protected
branch, then a blocking documentation signal this commit would land, then whether the message names a plan
item (`hooks/on-commit.sh:1-19`). It exits 2, which is the only code that stops the tool call and puts the
reason in front of the model.

**A check that could not run refuses too, and says so** (`hooks/on-commit.sh:37-49`). A guard that waves a
commit past because it failed to evaluate is the failure this project exists to detect.

Turn the health half off with `automation.healthOnCommit: false`; the full switch list is
`scripts/lib/config.mjs:392-398`. Every hook is inert in a repository with no config file.

### Something started a web server I did not ask for. What is it?

`atlas serve` — the live dashboard, started by the session-start hook
(`hooks/on-session-start.sh:46-52`). Three things bound it:

- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0` (`scripts/lib/serve.mjs:347`).
- **A port derived from the repository path**, so several projects run at once without contending
  (`scripts/lib/serve.mjs:55-63`).
- **It exits after four idle hours** (`scripts/lib/serve.mjs:124`).

`atlas serve --status` says what is running here, `--list` says what is running anywhere on this machine, and
`--stop` ends it. `ATLAS_SERVE=0` in your environment stops it starting.

### I adopted the tool and never got a dashboard URL. Was it running?

Almost certainly yes, and **nothing told you** — that was a real defect
([A-23](ROADMAP.md#track-6--autonomy), fixed in 0.1.65). Three repositories were adopted in one afternoon,
all three servers came up and answered on their derived ports, and no session ever printed a link.

The cause is worth knowing because it explains the shape of the fix: the session-start hook was the only
place in the tool that named the URL, and it exits early when there is no config
(`hooks/on-session-start.sh:48`) — which is exactly true of the run that *creates* the config. So the one
session where somebody is waiting to see what they just built was the one session told nothing.

The announcement now follows the **session** rather than the server: `on-activity.sh` tells any session that
has not heard the URL, once, whichever path brought the server up (`hooks/on-activity.sh:59-69`). If you are
on an older build, `atlas serve --status` prints it.

---

## Things that behaved unexpectedly, and why

### Why did the dashboard say my project was finished when it was not?

Because it could not see the work. **This happened three times in one afternoon** — a page reporting
"62 items, all Done" beside a session with six open pieces of work
([A-25](ROADMAP.md#track-6--autonomy), fixed in 0.1.66).

The plan panel reads `docs/ROADMAP.md`, which only knows what somebody wrote down. The in-flight panel reads
git, which sees files but not intent. The session's actual task list lived in the harness, outside the
repository. *"I cannot verify that data"* was true, and it was not a licence to render a page that was
confidently wrong.

The fix writes the task state **into the repository** as it changes — one appended record per task change to
`.atlas/tasks-live.jsonl` (`hooks/on-task.sh:65`) — and rebuilds, because data on disk would still have
looked frozen with nothing regenerating the page (`hooks/on-task.sh:71`). Two honest limits remain: the hook
needs `jq` and records nothing without it (`hooks/on-task.sh:28`), and statuses are shown as recorded, never
inferred from what a diff looks like.

### My change kept getting overwritten, or the site rebuilt over my fix

Two different builds were writing into one output directory — typically an installed plugin's watcher and
your working copy. They do not overlap in time; they take the build lock politely, in turn, and overwrite
each other's output ([A-22](ROADMAP.md#track-6--autonomy), 0.1.64). A branding fix appeared not to work three
times in a row for exactly this reason.

Each acquisition now records which build took the lock, in a file that deliberately **outlives** the lock
(`scripts/lib/lock.mjs:39-44`), and a build that finds a different one there says so. **It reports and then
builds anyway** (`scripts/lib/lock.mjs:30-31`) — which of the two should win is your call, and refusing would
break the case of deliberately testing a working copy.

**It cannot fire against a build that predates it.** An older build never writes the owner record, so the
newer one sees itself as the last holder and stays silent. That is inherent, not a gap.

### Why are there several atlas server processes on my machine?

There should not be, on 0.1.65 or later. Ten were once found against four repositories: `startServer` set
`process.exitCode` on `EADDRINUSE` and returned, **and setting an exit code is not exiting** — so every loser
of a race for a port stayed alive, serving nothing, invisible to `--status`, and still rebuilding the output
directory on every change ([A-24](ROADMAP.md#track-6--autonomy)). A server that cannot bind now exits
(`scripts/lib/serve.mjs:324-342`). `atlas serve --list` enumerates what is actually running.

### `atlas serve --status` said "not running" while something was clearly serving

Status used to be read from a pidfile alone, and a process can outlive its own record. It now also probes the
derived port and reports the disagreement rather than denying it (`scripts/lib/serve.mjs:142-153`). A tool
that says "not running" about a running process teaches people to stop believing it.

---

## Limits and boundaries

### Can I drive Claude Code through the MCP server?

**No, and no amount of implementing it would work.** MCP runs client → server: a server publishes tools and a
*client* decides whether to call them. Claude Code is the client; `atlas mcp` is a thing it calls. Nothing a
server can send starts work, steers a run, or asks a question.

The capability you want is real and lives on the Claude Agent SDK — a different surface, deliberately not
part of this tool. [`references/agent-control.md`](references/agent-control.md) is the whole argument,
including the safety contract an external driver has to hold up.

### Can a program or an agent query it without a terminal?

Yes, two ways, both read-only:

- `atlas mcp` serves the corpus over stdio. Every handler reads; a test asserts `mcp.mjs` never reaches
  `writeFileSync`, `stagePages`, `stageWiki`, `setItemPercent` or `--push` (`tests/run.mjs:4762-4775`).
- `atlas ask <task>` answers one task as JSON with **exit 0 clean, 1 blocking, 2 could not run**. That 1/2
  split is the point: a tool that exits non-zero for both tells a pipeline the documentation is broken when
  the truth was that atlas could not run.

**The `/atlas:ask` slash command is currently broken** and is documented as a defect, with the reproduction,
in [`FEATURES.md`](FEATURES.md#atlasask-is-currently-broken--defect). The CLI and MCP paths work.

### Does a clean health report mean my documentation is correct?

No. Every check is a **fact about the repository** — does this link resolve, does this `path:line` exist, do
two documents claim the same title — never a judgment about whether a document is true or well written. A
document can be entirely wrong and pass every signal. [`legal/DISCLAIMER.md`](legal/DISCLAIMER.md) states
what the reports do and do not support.

### What is *not* built?

The [roadmap](ROADMAP.md) is the list, and a roadmap entry is a claim to verify rather than a fact. Three
worth knowing before you plan around them, all verified today:

- **No session driver, and none is planned here** (M-2, M-3). See above.
- **The design record is detected and reported, never authored.** `atlas design --scaffold` writes the
  questions a missing document owes an answer to, never the answers, and a scaffold never counts as a design
  record — this repository's own blueprint reads *0 written, 8 scaffolded* (S-3, A-18).
- **GitHub Pages has never served this project's own site** — the workflow builds and uploads, and the
  repository's Pages source is not set to *GitHub Actions*. That is a repository setting, not a tool gap
  (P-3).

---

## Legal, and getting rid of it

### What dependencies am I taking on?

None. No `package.json`, no lockfile, no `node_modules`, nothing vendored — and
[`legal/THIRD-PARTY.md`](legal/THIRD-PARTY.md) shows the four checks that established it, plus the three
things that sentence does *not* cover.

### Who is liable if it breaks something?

Nobody, and that is stated rather than implied: it is a hobby project, given away, with no warranty and no
liability for the owner, related companies or any contributor. [`legal/TERMS.md`](legal/TERMS.md) says so in
plain language and ends with the questions a lawyer would still have to answer, left unanswered on purpose.
MIT governs where the two appear to conflict ([`LICENSE`](../LICENSE)).

### How do I turn the automation off?

One line: `"automation": { "enabled": false }` — the master switch, because a feature that can only be
disabled key by key is a feature nobody disables. The individual switches are `buildOnWrite`,
`healthOnCommit`, `specOnCommit` and `planOnBranch` (`scripts/lib/config.mjs:392-398`), and a misspelled key
is **refused rather than ignored** (`scripts/lib/config.mjs:472-479`), because a typo that fails open leaves
you believing you turned something off. The two environment switches are `ATLAS_SERVE=0` and
`ATLAS_UPDATE_CHECK=0`.

### How do I remove it?

Stop the server (`atlas serve --stop`), delete the output directory, delete `project-atlas.config.json` and
`.atlas/`, and uninstall the plugin from your agent. Nothing of yours was modified, so there is nothing to
restore. Every hook is inert in a repository with no config file, so an uninstalled-but-still-present plugin
does nothing.

---

**Something here wrong or missing?** The evidence rules that govern every answer above are in
[`references/authoring.md`](references/authoring.md); corrections are welcome as a PR against this file, and
[`CONTRIBUTING.md`](../CONTRIBUTING.md) has the non-negotiables.
