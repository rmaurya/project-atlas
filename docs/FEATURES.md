# Features — the verified inventory

**This page lists what exists; [`CAPABILITIES.md`](CAPABILITIES.md) explains what it is for.** One row per
command, signal, slash command, hook, MCP tool and generated file, each with the line of code that implements
it. No advice, no ordering by audience — that is the other document's job, and duplicating it here is how two
pages become a fork.

**There is no "last verified" stamp on this page any more, and its removal is the point.** This line used to
read *"Last verified: 2026-08-13, against the working tree at `HEAD = 714d202`"*, and **that claim was false
when it was written**: at `714d202`, `atlas help` dispatches on line 309, while the table below said 338.
Nobody could have discovered that by reading the page. A hand-written stamp asserts an act of verification
that no reader and no test can check, it is written by the one person already certain the page is right, and
it goes stale silently the moment anything below it moves — which is how this page drifted twice. **A-50
replaced it with derivation.** Nothing on this page now dates itself; the figures and the line numbers are
re-read from the code by `tests/run.mjs` on every run, and disagreement is a failing test naming the right
value rather than a sentence nobody re-reads.

**Every count here is derived and enforced.** The skill list, the dispatch table, the views, the panels and
the signal catalogue are read out of the source by `tests/run.mjs` and compared against the figures stated
here — see *the stated inventories* in the suite. A number in prose beside a list that grows is a defect
waiting to happen; this repository has now proved that three times (A-29, A-50).

**The line numbers in §1 and §2 are derived and enforced too.** Each command row cites the line its own
`if (cmd === …)` sits on, and each signal row the line its finding is constructed on; both are re-derived from
`scripts/atlas.mjs`, `scripts/lib/health.mjs` and `scripts/lib/sop.mjs` by the suite. This was worth doing
because a line number is otherwise the weakest part of a citation, and it had already failed completely:
**every one of the 41 command citations and all 17 signal citations was wrong** before A-50 — `scripts/atlas.mjs`
had shifted by one line and `scripts/lib/health.mjs` by ninety-nine, so the page pointed at plausible,
adjacent, incorrect code throughout. H2 did not catch it, and cannot: H2 asks only whether the file is long
enough.

**Line numbers outside §1 and §2 are checked only by H2.** They were re-resolved by hand for A-50, and they
carry the ordinary risk of drifting again. Where one no longer lands on what it names, the surrounding symbol
— the `export function`, the config key, the signal id — is the thing to search for. A row marked **not built**
was checked and found absent; a row marked **partial** ships less than a document elsewhere in this repository
claims.

---

## How to read the status column

| Status | Means |
|---|---|
| **shipped** | The code path was read, and in most cases run, in the verifying session. |
| **partial** | It exists and does less than its own documentation says. The gap is stated in the row. |
| **defect** | It exists, is reachable by a user, and does not do what it says. |
| **not built** | Described in a plan or design document; no implementing code found. |

---

## 1. Command-line surface

Every command below is dispatched from `scripts/atlas.mjs`. The line given is the `if (cmd === …)` that
selects it — verified by reading the file, not by reading `usage()`.

The **Slash** column is checked against `skills/` by `tests/run.mjs` rather than by hand: every `/atlas:…` it
names must be a directory that ships a `SKILL.md`, so a renamed or deleted skill fails the suite here. A dash
means no slash command exposes the command, and §3 gives the reason for each dash rather than leaving it to be
read as an oversight.

**Every row below is checked by `tests/run.mjs`.** The dispatch table is derived from `scripts/atlas.mjs`'s
own source and compared against the command names in this table, so a new `if (cmd === …)` cannot land
without a row here. That check is why `git-insights`, `pause`, `resume` and `stop` are present: they shipped
while this page said thirty-two commands, and nothing noticed.

| Command | What it does | Dispatch | Slash | Status |
|---|---|---|---|---|
| `atlas help` | Print the command list. Also the default when no command is given. | `scripts/atlas.mjs:340` | `/atlas:help` | shipped |
| `atlas version` | Which build is executing, where it lives, what is registered, whether it is behind. | `scripts/atlas.mjs:343` | `/atlas:version` | shipped |
| `atlas version --notice` | One line for a `SessionStart` hook, silent when current. | `scripts/atlas.mjs:343`, the `flag('notice')` branch | — | shipped |
| `atlas init` | Write `project-atlas.config.json` from a probe of the repository's layout. | `scripts/atlas.mjs:376` | — | shipped |
| `atlas scan` | Build the corpus index and summarise it. `--json` emits the model without document bodies. | `scripts/atlas.mjs:462` | `/atlas:status` | shipped |
| `atlas tasks [filter]` | The planning document as progress bars, grouped by track. | `scripts/atlas.mjs:476` | `/atlas:tasks` | shipped |
| `atlas branch [type slug]` | Report branch safety, or create `type/short-slug` carrying uncommitted work. | `scripts/atlas.mjs:493` | `/atlas:branch`, `/atlas:git-branch`, `/atlas:git-status` | shipped |
| `atlas contention [branch…]` | What a fan-out will collide on: files more than one branch touches, plan-item ids more than one branch defines, and the next free id. `--base REF`. Exit 1 on a duplicate id only. | `scripts/atlas.mjs:541` | — | shipped |
| `atlas caps` (alias `capabilities`) | Probe which host features are on. Makes a network request, and says so. | `scripts/atlas.mjs:557` | `/atlas:caps` | shipped |
| `atlas community [--write]` | Generate issue/PR/Discussions scaffolding for the features the host supports. | `scripts/atlas.mjs:565` | `/atlas:community` | shipped |
| `atlas note <kind> "<text>"` | Append one record to the continuity journal. **The only writing slash command.** | `scripts/atlas.mjs:599` | `/atlas:note` | shipped |
| `atlas state` | What a resuming session reads first: branch, uncommitted work, journal. | `scripts/atlas.mjs:630` | `/atlas:state` | shipped |
| `atlas design [--scaffold]` | The design record's state; `--scaffold` writes question stubs, never answers. | `scripts/atlas.mjs:659` | `/atlas:design` | shipped |
| `atlas ask <task>` | One structured JSON answer with a meaningful exit code. Takes a **task id**. | `scripts/atlas.mjs:716` | `/atlas:ask` | shipped |
| `atlas ask <question>` | The documents worth reading, for a person. Anything that is not a task id takes this path. | `scripts/atlas.mjs:716`, `scripts/atlas.mjs:811` | `/atlas:ask` | shipped |
| `atlas mcp` | Serve the corpus over MCP on stdio. `--status` reports what a client would connect to. | `scripts/atlas.mjs:758` | `/atlas:mcp` | shipped |
| `atlas handoff` | The derived half of a handoff, printed as a prompt. Writes no file. | `scripts/atlas.mjs:770` | `/atlas:handoff` | shipped |
| `atlas changes` | Uncommitted work, branch-local work, and the documents that cite the files touched. | `scripts/atlas.mjs:786` | `/atlas:changes`, `/atlas:review`, `/atlas:git-status` | shipped |
| `atlas config` | The merged configuration — user overrides shown against the defaults. | `scripts/atlas.mjs:798` | `/atlas:config` | shipped |
| `atlas plan [slug]` | Propose the git route for work in progress. `--apply` creates the branch and nothing else. | `scripts/atlas.mjs:843` | `/atlas:plan` | shipped |
| `atlas surviving` | Surviving lines per file, by author. | `scripts/atlas.mjs:878` | `/atlas:surviving` | shipped |
| `atlas ownership` | Areas by author, and where the bus factor is one. | `scripts/atlas.mjs:885` | `/atlas:ownership`, `/atlas:git-hotspots` | shipped |
| `atlas worklog` | Write the day's log to `worklog/`. `--stdout` prints instead. | `scripts/atlas.mjs:902` | `/atlas:worklog` (via `--stdout`) | shipped |
| `atlas diff [file]` | One file's diff; with no path, lists what there is to ask about. | `scripts/atlas.mjs:920` | `/atlas:diff`, `/atlas:git-diff` | shipped |
| `atlas tokens` | Token accounting from local session transcripts. | `scripts/atlas.mjs:955` | `/atlas:tokens` | shipped |
| `atlas sessions` | Session outcomes — turns, interruptions, compactions, tool friction, rework. | `scripts/atlas.mjs:999` | `/atlas:sessions` | shipped |
| `atlas prompt` | A system prompt assembled from this repository's own config, plan and corpus. | `scripts/atlas.mjs:1015` | `/atlas:prompt` | shipped |
| `atlas contrib` | Contribution analysis from `git log` alone. | `scripts/atlas.mjs:1035` | `/atlas:contrib` | shipped |
| `atlas git-insights [section]` (alias `git-insight`) | What git history says that nothing else here reads: hotspots, coupling, branches, cadence, hygiene, change. Read-only. | `scripts/atlas.mjs:1061` | `/atlas:git-insights`, `/atlas:git-hotspots`, `/atlas:git-history`, `/atlas:git-branch`, `/atlas:git-diff`, `/atlas:git-status` | shipped |
| `atlas git-tree` | Branch topology: what was cut from what, where each split off, what has gone back. Every origin is inferred from the commit graph and marked as such — git records no parent for a branch. Read-only. | `scripts/atlas.mjs:1098` | `/atlas:git-tree` | shipped |
| `atlas spec --gate` | Commit gate: refuse a staged change whose message names no plan item. | `scripts/atlas.mjs:1115` | — | shipped |
| `atlas health --gate` | Commit gate: refuse a commit that would land a blocking signal. | `scripts/atlas.mjs:1145` | — | shipped |
| `atlas health` | The rot report. Exit 1 when any blocking signal fires. | `scripts/atlas.mjs:1165` | `/atlas:health` | shipped |
| `atlas build` | Generate the static site. `--verify` audits what was just written. | `scripts/atlas.mjs:1175` | `/atlas:build` | shipped |
| `atlas all` | `scan` + `health` + `build`; exit 1 if blocking. | `scripts/atlas.mjs:1175`, `scripts/atlas.mjs:1175` | — | shipped |
| `atlas publish --target wiki\|pages\|export` | Stage a publish target. Nothing pushes without `--push`. | `scripts/atlas.mjs:1194` | `/atlas:publish` | shipped |
| `atlas pause [--dry-run]` | Checkpoint every agent worktree to a `wip/agent-*` ref and record the session. | `scripts/atlas.mjs:1291`, `scripts/atlas.mjs:1291` | `/atlas:pause` | shipped |
| `atlas resume` | The re-spawn plan for a paused session — branch, worktree, checkpoint. Writes nothing. | `scripts/atlas.mjs:1291`, `scripts/atlas.mjs:1291` | `/atlas:resume` | shipped |
| `atlas stop [--force]` | Clear session state and agent worktrees; every branch and checkpoint survives. | `scripts/atlas.mjs:1291` | `/atlas:stop` | shipped |
| `atlas serve` | Start (or adopt) the live dashboard server and open it. | `scripts/atlas.mjs:1340` | `/atlas:dashboard` | shipped |
| `atlas serve --stop \| --status \| --list \| --launcher` | Stop it, report it, list every dashboard on the machine, or write a launcher page. | `scripts/atlas.mjs:1340`, then `--stop`, `--status`, `--list`, `--launcher` | `/atlas:dashboard` (`--list`) | shipped |
| `atlas product [--product DIR] [--deep]` | One page across sibling repositories under a directory that is **not** a repository. Members discovered, unadopted ones stated; written outside every checkout so it can never be committed. | `scripts/atlas.mjs:388` | `/atlas:product` | shipped |
| `atlas watch [--serve]` | Rebuild on change; `--serve` hosts the output on loopback. | `scripts/atlas.mjs:1674` | — | shipped |

An unrecognised command prints the usage block and exits 2 (`scripts/atlas.mjs:1691`).

### `usage()` is a complete inventory, and that is now enforced

This section used to say the opposite. It named nine commands — `tasks`, `config`, `plan`, `surviving`,
`ownership`, `worklog`, `serve`, `capabilities` and `spec --gate` — as dispatching but missing from
`usage()`, and told the reader not to trust the block `atlas help` prints. **A-35 closed that**, and
`tests/run.mjs` now asserts it in both directions: every `if (cmd === …)` must appear in `usage()`
(`scripts/atlas.mjs:2094`), and `usage()` may not name a command the CLI would answer with "Unknown
command". Aliases are mentioned in an alias block rather than given a line of their own.

Leaving the old paragraph up was the more expensive error of the two. A stale "this list is incomplete" tells
every reader and every model to distrust output that is now correct, and there is no way to check that from
inside the page.

### Global flags

| Flag | Effect | Where |
|---|---|---|
| `--root <dir>` | Repository root; default is the git toplevel, else `cwd`. | `scripts/atlas.mjs:113` |
| `--config <path>` | Config file to read. | `scripts/atlas.mjs:374` |
| `--json` | Machine-readable output, on the commands that support it. | e.g. `scripts/atlas.mjs:464` |
| `--verbose[=all]` | List findings rather than counts. | `scripts/atlas.mjs:1160` |
| `--no-git` | Skip git metadata; H6 is then reported as unevaluated, and H16 with it. | `scripts/atlas.mjs:460`, `scripts/lib/health.mjs:542` |
| `--offline` | Skip the capability probe and say so. | `scripts/atlas.mjs:551` |
| `--quiet` | Suppress progress output. | `scripts/atlas.mjs:108` |
| `--no-color` | Disable ANSI colour. | `scripts/atlas.mjs:110` |

Flags written with a space consume the next argument only if they are in `VALUE_FLAGS`
(`scripts/atlas.mjs:84`); everything else is boolean, so a positional after a boolean flag stays positional
(`scripts/atlas.mjs:97`).

---

## 2. Rot signals

**Seventeen signals ship: sixteen about the corpus, and one about the operator.** The corpus catalogue is
`scripts/lib/signals.mjs:13-53`. H17 is deliberately **not** in that file — it lives in
`scripts/lib/health.mjs:163-197`, and the two sets are joined only at
`scripts/lib/health.mjs:213` (`SIGNALS = { ...CORPUS_SIGNALS, ...OPERATOR_SIGNALS }`). A consumer that wants
only claims about the repository imports `signals.mjs`; a consumer rendering the whole report imports
`health.mjs`. Every one is evaluated in `runHealth` (`scripts/lib/health.mjs:291`).

| Id | Title | Raised at | Blocking by default |
|---|---|---|---|
| H1 | Dead internal link | `scripts/lib/health.mjs:322` | **yes** |
| H2 | Unresolvable code citation | `scripts/lib/health.mjs:326` | no |
| H3 | Duplicate title | `scripts/lib/health.mjs:344` | **yes** |
| H4 | Orphan | `scripts/lib/health.mjs:351` | no |
| H5 | Unclassified (fell through to the fallback cluster) | `scripts/lib/health.mjs:357` | no |
| H6 | Stale against its citations | `scripts/lib/health.mjs:382` | no |
| H7 | Forbidden term | `scripts/lib/health.mjs:407` | no |
| H8 | Missing title | `scripts/lib/health.mjs:433` | **yes** |
| H9 | Cross-reference asymmetry | `scripts/lib/health.mjs:428` | no |
| H10 | SOP past its review date | `scripts/lib/sop.mjs:113`, delivered at `scripts/lib/health.mjs:492` | **yes** |
| H11 | SOP has no live owner | `scripts/lib/sop.mjs:127`, delivered at `scripts/lib/health.mjs:492` | no |
| H12 | Dead citation in an SOP | `scripts/lib/health.mjs:497` | **yes** |
| H13 | Handoff far behind HEAD | `scripts/lib/health.mjs:516` | no |
| H14 | Design document cites code that moved | `scripts/lib/health.mjs:454` | no |
| H15 | Expected design artifact absent | `scripts/lib/health.mjs:472` | no |
| H16 | Undesigned area | `scripts/lib/health.mjs:546` | no |
| H17 | Large session, no subagent — **measures the operator, not the corpus** | `scripts/lib/health.mjs:566` | **never**, enforced in code |

The default blocking set is **five** ids — `['H1', 'H3', 'H8', 'H10', 'H12']` (`scripts/lib/config.mjs:245`)
— and is overridable per repository. This repository sets the same five
(`project-atlas.config.json:157-163`).

**H17 cannot be made blocking by configuration.** An unknown-but-well-formed id in `blocking` is a warning
rather than a rejection, so a config written for a newer build still loads — which means `"blocking": ["H17"]`
survives validation and arrives intact. `blockingFor` is what makes it harmless: it returns false for
anything in `OPERATOR_SIGNALS` regardless of the config (`scripts/lib/health.mjs:223-224`). The blocking set
is reserved for claims that the *repository* is wrong.

**Two signals check nothing until configured.** H7 needs `forbiddenTerms` and H9 needs `crossref`; when
either list is empty the report says so under *Not checked* rather than reporting the signal clean
(`scripts/lib/health.mjs:399`, `scripts/lib/health.mjs:420`).

**Signals that could not run are never reported as passing.** A signal whose configured regular expression was
declined, or whose input could not be read, is added to `unevaluated` (`scripts/lib/health.mjs:392`) and
rendered as `—` rather than green (`scripts/lib/health.mjs:629-631`). H16 declares itself unevaluated when
`git ls-files` fails (`scripts/lib/health.mjs:542`), and H17 when there is no transcript to read
(`scripts/lib/health.mjs:557`).

**Suppressions carry a reason.** `suppressionFor` marks a finding suppressed rather than deleting it
(`scripts/lib/health.mjs:295-296`), and the count is reported (`scripts/lib/health.mjs:642`).

---

## 3. Slash commands (Claude Code skills)

**Forty-one `SKILL.md` files under `skills/`**, up from twenty-nine on 2026-08-12. Forty set
`disable-model-invocation: true`, which makes them typed-only; `skills/build/SKILL.md` does not and is the one
the model may invoke on its own. Every command below was run in this repository before its skill was written.

**Nine of these rows were missing from this page until 2026-08-13** — the six `git-*` commands and
`pause`/`resume`/`stop`. `tests/run.mjs` now compares this table against `skills/` on disk and fails on a
skill with no row, or a row naming a skill that is not there. Both counts in the paragraph above are read
back out of it and compared against the directories and their frontmatter, so neither can drift from the
other.

**One row here shells out to a command that is not its own.** `/atlas:artifact` runs `atlas publish --target
export`, because everything the CLI needed to do for it was already done for that target — see [§1's note on
the deliberate absence of `atlas artifact`](#1-cli-commands).

| Skill | Shells out to | Source |
|---|---|---|
| `/atlas:artifact` | `atlas publish --target export --page dashboard` — **network**, and the page leaves this machine | `skills/artifact/SKILL.md` |
| `/atlas:ask` | `atlas ask $ARGUMENTS`, `atlas scan` | `skills/ask/SKILL.md` |
| `/atlas:branch` | `atlas branch` | `skills/branch/SKILL.md` |
| build (model-invoked) | nothing; instructions only | `skills/build/SKILL.md` |
| `/atlas:caps` | `atlas caps` — **network** | `skills/caps/SKILL.md` |
| `/atlas:changes` | `atlas changes --no-color` | `skills/changes/SKILL.md` |
| `/atlas:community` | `atlas community` — **network**, previews only | `skills/community/SKILL.md` |
| `/atlas:config` | `atlas config`, `atlas scan`, `atlas health --no-color` | `skills/config/SKILL.md` |
| `/atlas:contrib` | `atlas contrib` | `skills/contrib/SKILL.md` |
| `/atlas:dashboard` | `atlas serve`, `atlas serve --list` | `skills/dashboard/SKILL.md` |
| `/atlas:design` | `atlas design` | `skills/design/SKILL.md` |
| `/atlas:diff <path>` | `atlas diff $ARGUMENTS` | `skills/diff/SKILL.md` |
| `/atlas:git-branch` | `atlas branch --no-color`, `atlas git-insights branches --no-color` | `skills/git-branch/SKILL.md` |
| `/atlas:git-diff <path>` | `atlas diff $ARGUMENTS`, `atlas git-insights change --no-color` | `skills/git-diff/SKILL.md` |
| `/atlas:git-history` | `atlas git-insights cadence --no-color`, `atlas git-insights hygiene --no-color` | `skills/git-history/SKILL.md` |
| `/atlas:git-hotspots` | `atlas git-insights hotspots --no-color`, `… coupling --no-color`, `atlas ownership` | `skills/git-hotspots/SKILL.md` |
| `/atlas:git-insights` | `atlas git-insights --no-color` | `skills/git-insights/SKILL.md` |
| `/atlas:git-status` | `atlas branch --no-color`, `atlas changes --no-index --no-color`, `atlas git-insights change --no-color` | `skills/git-status/SKILL.md` |
| `/atlas:git-tree` | `atlas git-tree --no-color` | `skills/git-tree/SKILL.md` |
| `/atlas:handoff` | `atlas handoff` | `skills/handoff/SKILL.md` |
| `/atlas:health` | `atlas health --no-color $ARGUMENTS` | `skills/health/SKILL.md` |
| `/atlas:help` | `atlas help`, `atlas caps --offline` | `skills/help/SKILL.md` |
| `/atlas:mcp` | `atlas mcp --status` | `skills/mcp/SKILL.md` |
| `/atlas:note <kind> "<text>"` | `atlas note $ARGUMENTS` — **writes** `.atlas/journal/` | `skills/note/SKILL.md` |
| `/atlas:ownership` | `atlas ownership` | `skills/ownership/SKILL.md` |
| `/atlas:pause` | `atlas pause --no-color` — **writes** `wip/agent-*` refs and `.atlas/parked.json` | `skills/pause/SKILL.md` |
| `/atlas:plan <slug>` | `atlas plan $ARGUMENTS` | `skills/plan/SKILL.md` |
| `/atlas:product` | `atlas product` — reads members only; writes one page outside every repository | `skills/product/SKILL.md` |
| `/atlas:prompt` | `atlas prompt` | `skills/prompt/SKILL.md` |
| `/atlas:publish` | `atlas caps` — **network**, `atlas scan` | `skills/publish/SKILL.md` |
| `/atlas:resume` | `atlas resume --no-color` — reads only | `skills/resume/SKILL.md` |
| `/atlas:review` | `atlas changes --no-color`, `atlas health --no-color`, `atlas branch` | `skills/review/SKILL.md` |
| `/atlas:sessions` | `atlas sessions` — reads **local transcripts**, outside the repository | `skills/sessions/SKILL.md` |
| `/atlas:state` | `atlas state` | `skills/state/SKILL.md` |
| `/atlas:status` | `atlas scan`, `atlas health --no-color`, `atlas tasks`, `atlas branch` | `skills/status/SKILL.md` |
| `/atlas:stop` | `atlas stop --dry-run --no-color` — the block is a dry run; the destructive form is typed by hand | `skills/stop/SKILL.md` |
| `/atlas:surviving` | `atlas surviving` | `skills/surviving/SKILL.md` |
| `/atlas:tasks [filter]` | `atlas tasks $ARGUMENTS` | `skills/tasks/SKILL.md` |
| `/atlas:tokens` | `atlas tokens` — reads **local transcripts**, outside the repository | `skills/tokens/SKILL.md` |
| `/atlas:version` | `atlas version` | `skills/version/SKILL.md` |
| `/atlas:worklog` | `atlas worklog --stdout` | `skills/worklog/SKILL.md` |

**`plugins/atlas/skills/` holds a byte-identical copy of every one of these**, generated for the Codex
marketplace by `scripts/sync-runtimes.mjs` and drift-checked by `node scripts/sync-runtimes.mjs --check`. It
is not a second inventory and is excluded from the corpus, or every skill would be a duplicate title.

`atlas status` and `atlas review` are not CLI commands — no `if (cmd === 'status')` or `'review'` exists in
`scripts/atlas.mjs`. They are slash commands only, built over `atlas scan` and `atlas changes`.

Line numbers are omitted from this table on purpose. Every one of these files is prose around one or two
shell blocks and the blocks move whenever the prose does; the command string is the durable citation, and it
is what a reader can grep for.

### Seven table rows have no slash command, deliberately

A command per dispatch would make the useful ones harder to find. Each of these was considered and refused,
and the reason is recorded here so the gap is not read as an oversight and closed by the next person.

| Command | Why there is no slash command |
|---|---|
| `atlas watch` | **It blocks until interrupted** — verified by running it, still alive after six seconds. A slash command that never returns is a trap. `/atlas:dashboard` starts the same server, returns, and hands back a URL. |
| `atlas all` | `scan` + `health` + `build`, which is `/atlas:build`; the first two are also `/atlas:status` and `/atlas:health`. A fourth name for the same work splits the path without adding a capability. |
| `atlas init` | Step two of a first run, and `/atlas:build` does the whole run. A command that writes a config and stops ends adoption with no index, no site and no URL — the failure `skills/build/SKILL.md` exists to prevent. |
| `atlas capabilities` | The alias for `caps`. One implementation, one skill. |
| `atlas git-insight` | The alias for `git-insights`, and the same reasoning. Two entries describing one implementation is drift in miniature; the second copy is the one that goes stale. |
| `atlas contention` | Read before a fan-out, by whoever is deciding how to split the work — a moment, not a routine. A forty-second slash command would be paid for by every reader of the other forty-one, and `skills/build/SKILL.md` names the command where the decision is actually made. |
| `atlas spec --gate` | The commit hook's entry point. Bare `atlas spec` is not a command at all (it falls through to the usage block and exits 2), and `--gate` reads the commit message from **stdin** — with staged files and no stdin it would wait, and it prints nothing at all when it passes. |

### And one slash command has no CLI command, for the same reason in reverse

**There is no `atlas artifact`, deliberately.** `/atlas:artifact` runs
`atlas publish --target export --page dashboard --out .atlas/artifact-page.html`, which already existed:
`--target export` writes a self-contained page with every stylesheet and script inlined and no external
request. A second command over that same code would be two names for one thing, which is the duplication
this tool exists to detect. What the CLI **cannot** do is reach claude.ai — only a session can, and that gap
is the whole of the skill. Typing `atlas artifact` exits 2 with *Unknown command*, and a test asserts it
stays that way, so the absence reads as a decision rather than as something nobody got to.

It is also a **fifth exit door** for `stripLocalOnly`. The export strips the machine-local panels and
`assertNoLocalOnly` verifies its own output before the file exists, so the boundary is held in code rather
than in the skill's instructions — worth recording, because A-45 was that stripper failing open through the
other four doors and returning a document unchanged.

### `/atlas:ask` answers both kinds of question — fixed

This section used to read *"`/atlas:ask` is currently broken — defect"*, and it is not. M-2 gave two
features one command name and the question path lost; the fix routes on the **argument** rather than on the
handler order, and the test is exact rather than heuristic — a known task id is a program's call, anything
else is a person's question (`scripts/atlas.mjs:621`).

```
$ ./bin/atlas ask "what is the taxonomy"
No document contains "what is the taxonomy" literally. The corpus may still answer it in other
words — 77 document(s) across 13 clusters.
$ echo $?
0
```

Run against this tree on 2026-08-13. `atlas ask atlas_health` still takes the structured path
(`scripts/atlas.mjs:710`) and still carries the 0/1/2 exit codes. The README described the command **working**
in its command table and **broken** in its install section, two hundred lines apart, and linked here for the
detail — a document contradicting itself and citing this page as the authority for the wrong half. That is
what made removing the claim the right move rather than merely dating it.

---

## 4. Hooks

**Eight hook entries across six events**, declared in `hooks/hooks.json:1-83`. Every one is inert in a
repository with no `project-atlas.config.json`.

| Event | Matcher | Script | Effect | Can block? |
|---|---|---|---|---|
| `PreToolUse` | `Bash` | `hooks/on-commit.sh` | Branch guard, then health gate, then plan gate. | **yes, exit 2** (`hooks/hooks.json:9`) |
| `SessionStart` | — | `hooks/on-session-start.sh` | Update notice, then start the dashboard server and print its URL. | never (`hooks/on-session-start.sh:69`) |
| `PostToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit` | `hooks/on-write.sh` | `atlas build --auto` after a markdown write. | never (`hooks/on-write.sh:48`) |
| `PostToolUse` | `TaskCreate\|TaskUpdate` | `hooks/on-task.sh` | Append the session's task state to `.atlas/tasks-live.jsonl`, then rebuild. | never (`hooks/on-task.sh:77`) |
| `PostToolUse` | (all tools) | `hooks/on-activity.sh` | Keep the dashboard server alive and announce its URL once per session. | never (`hooks/on-activity.sh:90`) |
| `Stop` | — | `hooks/on-continuity.sh stop` | Flush continuity state. | never (`hooks/on-continuity.sh:108`) |
| `SubagentStop` | — | `hooks/on-continuity.sh subagent` | Same, at subagent teardown. | never |
| `PreCompact` | — | `hooks/on-continuity.sh precompact` | Same, before a compaction. | never |

The commit guard runs three checks in order and each maps a non-1 exit to "this commit was NOT checked"
rather than to silence: `atlas branch` (`hooks/on-commit.sh:40`), `atlas health --gate`
(`hooks/on-commit.sh:47`) and the plan gate (`hooks/on-commit.sh:78`). It exits early on any Bash call that
is not a `git commit` (`hooks/on-commit.sh:30`).

**`hooks/README.md:7` used to state there are two hooks; it no longer does** — it now reads "six scripts,
wired to eight entries across six events", and dates its own correction. Re-checked 2026-08-13.

### Automation switches

Four switches, all defaulting to on, plus a master switch (`scripts/lib/config.mjs:269-281`), resolved
through one function (`scripts/lib/config.mjs:385-389`) and validated against a known-key list so a
misspelling is refused rather than failing open (`scripts/lib/config.mjs:392-398`, `scripts/lib/config.mjs:474-479`).

| Key | Turns off | Read at |
|---|---|---|
| `automation.enabled` | every automatic action below | `scripts/lib/config.mjs:387` |
| `automation.buildOnWrite` | the rebuild after a markdown write | `scripts/atlas.mjs:1172`, `scripts/atlas.mjs:1955` |
| `automation.healthOnCommit` | the blocking-signal commit gate | `scripts/atlas.mjs:1140` |
| `automation.specOnCommit` | the plan-item commit gate | `scripts/atlas.mjs:1107` |
| `automation.planOnBranch` | marking a plan item in progress at branch creation | `scripts/atlas.mjs:549`, `scripts/atlas.mjs:1124` |

---

## 5. MCP server

Hand-written JSON-RPC 2.0 over newline-delimited stdio, no dependency (`scripts/lib/mcp.mjs:294`). Protocol
revision `2025-06-18`, pinned and echoed back (`scripts/lib/mcp.mjs:51`). Methods implemented: `initialize`,
`notifications/initialized`, `notifications/cancelled`, `ping`, `tools/list`, `tools/call`
(`scripts/lib/mcp.mjs:236-284`). Anything else returns `-32601`.

**Seven tools, all read-only** (`scripts/lib/mcp.mjs:62-218`):

| Tool | Answers | Arguments | Source |
|---|---|---|---|
| `atlas_health` | Every rot finding, plus which signals could not be evaluated. | none | `scripts/lib/mcp.mjs:63` |
| `atlas_plan` | Plan items with completion, status, track, priority. | `open` (boolean) | `scripts/lib/mcp.mjs:86` |
| `atlas_search` | Documents matching a string in title, path or body, with an excerpt. Capped at 25. | `query` (required) | `scripts/lib/mcp.mjs:110` |
| `atlas_changes` | Working and staged changes, and the documents they put at risk. | none | `scripts/lib/mcp.mjs:144` |
| `atlas_contrib` | People, weeks, AI-assisted share, and the caveats. | none | `scripts/lib/mcp.mjs:163` |
| `atlas_design` | Which design artifacts exist and in what state. | none | `scripts/lib/mcp.mjs:183` |
| `atlas_state` | The continuity journal, last 40 records. | none | `scripts/lib/mcp.mjs:200` |

`atlas ask <task>` exposes **the same seven** through the same handlers rather than a second implementation
(`scripts/lib/task.mjs:45`, `scripts/lib/task.mjs:83`). Its exit codes: 0 answered and clean, 1 answered with
something blocking, 2 could not answer (`scripts/lib/task.mjs:87`, `scripts/lib/task.mjs:56`,
`scripts/lib/task.mjs:66`, `scripts/lib/task.mjs:74-80`). An argument that is *not* one of the seven ids is a
person's question and takes the document-search path instead — see §1 and §3.

**§5 is the only section of this page whose citations have never drifted**, at the 2026-08-13 audit and again
at A-50: `scripts/lib/mcp.mjs` and `scripts/lib/task.mjs` are byte-identical to the tree the stamp named, which
is why they survived while §1 and §2 did not. Every
`scripts/lib/mcp.mjs` and `scripts/lib/task.mjs` line below resolved unchanged; §1, §2 and §6 had all drifted
by between 5 and 261 lines.

---

## 6. Generated output

Written by `renderSite` into `output` (default `docs/_wiki`, `scripts/lib/config.mjs:236`).

**The output directory is cleared and repopulated on every build — but only after the build proves the
directory is its own to clear.** This page said the first half of that sentence and stopped, which reads as
an unconditional `rm -rf` and is not what happens. `prepareOutputDir` (`scripts/lib/render.mjs:166`) runs two
guards before the `rmSync` at `scripts/lib/render.mjs:190`: **containment**, resolved through `realpath` on
both sides so a symlinked `output` cannot aim the deletion elsewhere, and **provenance** — a directory
holding files but none of `BUILD_MARKERS` (`scripts/lib/render.mjs:36`) is refused with a message naming the
config key to change and the exact `rm -rf` to run by hand. `{"output":"."}` removed a repository including
its `.git` before those existed.

**A-34 added a second kind of evidence, not a lower standard of proof.** The markers answer *did a build
finish here*; nothing answered *did a build start here*, and the gap between the two is the whole duration of
a build — so a build killed mid-write left the directory populated and unmarked, indistinguishable from
somebody else's data, and the guard correctly refused forever. A build now stakes `.atlas-build-claim.json`
(`scripts/lib/render.mjs:58`) into the directory *before* the first generated byte and releases it once the
markers are down (`scripts/lib/render.mjs:217`). The claim is checked rather than counted: it must name this
tool and record the output path relative to the repository root (`scripts/lib/render.mjs:95-104`).

**One build at a time, and the lock is documented nowhere else.** `.atlas/build.lock`
(`scripts/lib/lock.mjs:37`) serialises builds, because `atlas watch` made overlapping builds the normal case
and the guard above cannot tell a half-written build from someone's real files. A lock is honoured only while
its owner is alive and its age is plausible — past sixty seconds (`scripts/lib/lock.mjs:47`) or a dead pid it
is **stolen, and said to have been stolen** (`scripts/atlas.mjs:1834`), because a lock that can only wedge is
the worse failure when the thing it protects is regenerable. A waiter gives up after ten seconds
(`scripts/lib/lock.mjs:50`). Each acquisition also records *which build* took it, in `.atlas/build.owner.json`
(`scripts/lib/lock.mjs:44`), which is kept after release: two **different** builds — an installed plugin's
watcher and a working copy — take turns politely and overwrite each other's output, and that failure is
silent and lies. A build that finds a different owner says so and builds anyway; which should win is the
user's call.

| File | Contents | Written at |
|---|---|---|
| `pages/<name>.html` | One page per source document: rendered markdown, table of contents, backlinks, its own findings. | `scripts/lib/render.mjs:186` |
| `index.html` | Home — corpus figures, health headline, clusters, optional hand-written analysis. | `scripts/lib/render.mjs:258` |
| `wiki.html` | Every document, grouped by cluster. | `scripts/lib/render.mjs:259` |
| `health.html` | Every signal, blocking and advisory. | `scripts/lib/render.mjs:261` |
| `dashboard.html` and `view-*.html` | One file per configured view. | `scripts/lib/render.mjs:283`, `scripts/lib/views.mjs:296` |
| `deck.html` | A browser slide deck, only when a deck source exists. | `scripts/lib/render.mjs:285` |
| `search-index.js` | The client-side full-text index. | `scripts/lib/render.mjs:250` |
| `sources.json` | The allowlist `atlas serve` answers source links from — paths only, no content. | `scripts/lib/render.mjs:256` |
| `atlas.css` | The stylesheet. | `scripts/lib/render.mjs:286` |
| `.gitattributes` | Marks the tree `linguist-generated`. | `scripts/lib/render.mjs:287` |
| `README.md` | A note that this directory is derived. | `scripts/lib/render.mjs:288` |
| `kb/` | The same derived facts as markdown, for an agent with only `Read` and `Grep`. | `scripts/lib/render.mjs:302`, `scripts/lib/kb.mjs:298` |
| `build-stamp.txt` | Written only with `--stamp` or under `watch`; the page polls it to patch itself, and the footer reads it to say when the site was last built. Absent on a plain `atlas build`, and the footer then says "not recorded" rather than guessing. | `scripts/lib/render.mjs:399`, `scripts/lib/render.mjs:663` |
| `.atlas-build-claim.json` | Present only while a build is running here, or died here. Deleted on success. | `scripts/lib/render.mjs:128`, `scripts/lib/render.mjs:145` |
| `all.standalone.html` | The whole site as one file, refreshed after an automated build. | `scripts/atlas.mjs:1957` |

**The page count a build prints is document pages only.** `pages` is the size of the set of files written in
the per-document loop (`scripts/lib/render.mjs:180`, `scripts/lib/render.mjs:187`,
`scripts/lib/render.mjs:319`) — the index, wiki, health, views, deck,
stylesheet and knowledgebase are written but not counted, so the reported figure is always lower than the
number of files in the directory. No count is quoted here on purpose: the output directory is git-ignored
(`.gitignore:4`) and rewritten by any session that edits markdown.

### Views and panels

**Twelve views ship** (`scripts/lib/views.mjs:73-267`): Overview, Backlog, Timeline, Quality, Product,
Delivery, Repository, Economics, Architecture, Blueprint, Developer, Executive. Repository and Economics were missing
from this list until 2026-08-13; Economics is the view that made C-10 read session transcripts during a
build, which is why the privacy page had to change with it. A view is a list of panel ids, so adding one is a
config entry rather than a file. **Thirty-seven panels are defined** (`scripts/lib/views.mjs:18-56`). A view id
is constrained to `/^[A-Za-z0-9-]+$/` because it becomes a filename (`scripts/lib/views.mjs:275`) — verified
with `{"id":"x/../../../ESCAPED"}`, which wrote a file above the repository root.

Both figures and both name lists are checked by `tests/run.mjs` against `DEFAULT_VIEWS` and `PANELS`.

### Publish targets

| Target | Produces | Source |
|---|---|---|
| `wiki` | Flattened markdown with links rewritten, a do-not-edit banner per page, a per-page content hash, and a drift check that refuses rather than overwrites. | `scripts/lib/publish.mjs:95`, `scripts/lib/publish.mjs:226` |
| `pages` | The built site copied to a branch (default `gh-pages`), with local-only panels stripped **at staging**, not at push. | `scripts/lib/publish.mjs:368`, `scripts/lib/publish.mjs:412` |
| `export` | One self-contained HTML file; `--page all` bundles every generated page plus the document pages. | `scripts/lib/publish.mjs:957`, `scripts/lib/publish.mjs:561` |

On GitLab, `--target pages --push` refuses and `--ci` writes the `pages` job instead
(`scripts/atlas.mjs:1238`, `scripts/lib/publish.mjs:436`).

---

## 7. Not built, partial, and untrue

The entries this page exists to make unambiguous.

### Not built

**M-3 · the external control plane.** `docs/references/agent-control.md:7` marks itself *"design, not built
here"*, and `docs/ROADMAP.md` carries M-3 at 40%. No orchestrator, session driver or write-capable MCP surface
exists in `scripts/`. `scripts/lib/mcp.mjs:31-34` states the read-only boundary as a construction rather than
a promise, and `scripts/lib/task.mjs:15-20` states that driving a session is out of scope.

**M-3 is not the only item below 100%.** The plan holds **118 items** at a mean completion of **96.9%**, and
**seven** of them are not at 100% — of which **zero** carry no figure at all and are reported as unknown rather
than as zero. This paragraph twice claimed a smaller number than was true, most recently *"reports six … mean
completion 94.4%"* while the real figures were eight and 96.2%, so all four are now read out of this sentence
by `tests/run.mjs` and compared against `readPlanning`. Filing A-50 and A-51 moved every one of them in the
same commit that wrote this sentence, and the new test is what caught it. The per-item breakdown is deliberately **not** repeated
here: it changes whenever anybody edits a percentage, and `atlas tasks` prints it correctly on demand. A page
that copies a moving figure is the defect this section exists to record.

### Partial

Nothing is currently listed here. **`atlas ask` as a question-answering command** sat in this section and has
shipped — see §3.

### Documented but not true of the code

Each is a claim in a committed document that the code contradicts. **Re-measured 2026-08-13**; the rows that
had been closed since the previous pass are recorded as closed rather than deleted, because a table of
findings that only ever grows teaches nobody anything about how long a finding survives.

**Line numbers are given only for rows that are still live.** A citation into a paragraph this change
rewrote would point at whatever moved into its place, which is the failure this page is about.

| Where | The claim | What the code says |
|---|---|---|
| `docs/legal/PRIVACY.md`, *What it reads* (before this change) | *"nothing else in the tool touches that directory"* — only `atlas tokens` and `atlas sessions` read transcripts, cited to `scripts/lib/tokens.mjs:14`. | **C-10 made that false and `tokens.mjs:14` is now the sentence recording that it changed.** A build that renders the Economics view calls `readTokenEconomics` (`scripts/lib/tokens.mjs:766`), and `atlas watch` builds on every save. A **legal page** carrying a retired privacy rule, and the highest-priority row in this table. Fixed in this change. |
| `docs/references/configuration.md`, *Tokens* (before this change) | The same retired rule, in the tokens key table. | Same. Fixed in this change. |
| `README.md`, *Token accounting* (before this change) | *"The only command that reads session transcripts"*. | Same. Fixed in this change. |
| **`docs/ROADMAP.md:449-451`** | *"`atlas tokens` is the only thing that opens them — rule 1 of `scripts/lib/tokens.mjs`"*, in the H17 entry. | Same retired rule, fourth copy. **Not fixed — `docs/ROADMAP.md` is not owned by this change**, and it is reported here rather than edited. The claim it supports is still true: H17 opens nothing itself and is handed an aggregate. Only *"the only thing"* is not. |
| `docs/FEATURES.md` §1 and `skills/help/SKILL.md` (before this change) | `usage()` is not a complete inventory; nine named commands dispatch and are missing from it. | A-35 listed all of them and `tests/run.mjs` enforces it in both directions. Telling a reader to distrust correct output is a defect in its own right, and neither page could refute itself. Fixed in this change. |
| `README.md` and `docs/FEATURES.md` §3 (before this change) | *"`/atlas:ask` is broken"*. | Fixed by M-2's follow-up (`scripts/atlas.mjs:708`). The README said both things in one file. Fixed in this change. |
| `docs/CAPABILITIES.md`, *Where it stops*, and `docs/FAQ.md`, *Can a program query it* (before A-50) | *"`atlas ask <question>` does not work"* and *"the `/atlas:ask` slash command is currently broken"*, the latter linking to a `FEATURES.md` anchor renamed by the fix. | Both were false when written and stayed up for two more releases. The FAQ's link had been **dead** the whole time, and no signal sees it: H1 resolves the file, never the fragment. Fixed in A-50, and `tests/run.mjs` now fails on any sentence that names a command and calls it broken. |
| `README.md` and `docs/references/health-signals.md` (before this change) | Nine / sixteen rot signals; three blocking. | Seventeen signals, sixteen of them about the corpus; **five** block (`scripts/lib/config.mjs:245`). Fixed in this change, and now asserted by `tests/run.mjs`. |
| `README.md`, *Install* (before this change) | `install.sh` *"is 40 lines"*. | 120 lines — and the gap is exactly the part a reader about to pipe it into `sh` would want to have read. Fixed in this change, and asserted. |
| `hooks/README.md:7` | *"There are **two**"* hooks. | **Closed.** It now reads "six scripts, wired to eight entries across six events". |
| `docs/references/autonomy.md:6` | *"a capability that is **not yet built**"*. | **Closed.** The opening now says the capability exists and dates its own correction. |
| `.claude-plugin/marketplace.json:10` | *"nine mechanical rot signals"*. | **Closed.** It now says sixteen, which is right: H17 is not a rot signal. |
| `docs/references/configuration.md:69` | `"blocking": ["H10"]` given as an example of a value that *"names no signal"*. | H10 has been a signal since the SOP work, and is in the **default** blocking set. The example still demonstrates the check; it just picks an id that would now pass. Fixed in this change. |

**One place the retired rule was expected and is not there.** The *Not checked* line `atlas health` prints
when no session data was supplied (`scripts/lib/health.mjs:260-262`) says *"`atlas health` never reads session
transcripts itself"*, not *"`atlas tokens` is the only thing that reads them"* — and the comment above it
(`scripts/lib/health.mjs:256-259`) records why the wording was narrowed when C-10 landed. Checked because it
is the only copy of that claim a **user sees at runtime**; it is correct.

### Not verified

- **`atlas publish --push` was not run** against any host. Only the staging paths were read.
- **The Codex and Antigravity installs were not exercised.** Only the manifests were read.
- **`atlas tokens` and `atlas sessions` produce machine-local figures.** Both were run against this tree, but
  what they report is one machine's transcripts and proves nothing about another. The dispatch
  (`scripts/atlas.mjs:869`, `scripts/atlas.mjs:911`) and the refusal to write into the published output
  directory (`scripts/atlas.mjs:950`, `scripts/atlas.mjs:950`) were read as well as exercised.
- **`scripts/lib/kb.mjs` is now tracked**, so the note that used to sit here — a citation resolving against
  the working tree but not `git ls-files` — no longer applies. Confirmed with `git ls-files` on 2026-08-13.
