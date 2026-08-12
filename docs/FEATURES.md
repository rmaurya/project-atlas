# Features — the verified inventory

**This page lists what exists; [`CAPABILITIES.md`](CAPABILITIES.md) explains what it is for.** One row per
command, signal, slash command, hook, MCP tool and generated file, each with the line of code that implements
it. No advice, no ordering by audience — that is the other document's job, and duplicating it here is how two
pages become a fork.

**Last verified:** 2026-08-11, against the working tree at `HEAD = be9bf48` on branch
`fix/dashboard-url-never-announced-after-adoption`, with uncommitted work present. Every `path:line` below was
read in that session and re-resolved against the tree immediately before this page was finished. A row marked
**not built** was checked and found absent; a row marked **partial** ships less than a document elsewhere in
this repository claims.

**Section 3 and the Slash column in section 1 were re-verified later, on 2026-08-12**, on branch
`feat/manual-command-surface`, after sixteen slash commands were added. Nothing else on this page was
re-checked that day, so every other row still carries the date above and should be read as that old.

**A line number is the weakest part of a citation.** If one of these no longer lands on what it names, the
surrounding symbol — the `if (cmd === …)`, the `export function`, the signal id — is the thing to search for;
that is what was verified, and the number is only how it was reached on the date above.

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

The **Slash** column was re-verified on 2026-08-12 against `skills/` on branch
`feat/manual-command-surface`, by running every command in this repository. A dash means no slash command
exposes it, and §3 gives the reason for each dash rather than leaving it to be read as an oversight.

| Command | What it does | Dispatch | Slash | Status |
|---|---|---|---|---|
| `atlas help` | Print the command list. Also the default when no command is given. | `scripts/atlas.mjs:304`, `scripts/atlas.mjs:1493` | `/atlas:help` | shipped |
| `atlas version` | Which build is executing, where it lives, what is registered, whether it is behind. | `scripts/atlas.mjs:307` | `/atlas:version` | shipped |
| `atlas version --notice` | One line for a `SessionStart` hook, silent when current. | `scripts/atlas.mjs:322` | — | shipped |
| `atlas init` | Write `project-atlas.config.json` from a probe of the repository's layout. | `scripts/atlas.mjs:340`, `scripts/atlas.mjs:1438` | — | shipped |
| `atlas scan` | Build the corpus index and summarise it. `--json` emits the model without document bodies. | `scripts/atlas.mjs:345` | `/atlas:status` | shipped |
| `atlas tasks [filter]` | The planning document as progress bars, grouped by track. | `scripts/atlas.mjs:359`, `scripts/atlas.mjs:1270` | `/atlas:tasks` | shipped |
| `atlas branch [type slug]` | Report branch safety, or create `type/short-slug` carrying uncommitted work. | `scripts/atlas.mjs:368` | `/atlas:branch` | shipped |
| `atlas caps` (alias `capabilities`) | Probe which host features are on. Makes a network request, and says so. | `scripts/atlas.mjs:415` | `/atlas:caps` | shipped |
| `atlas community [--write]` | Generate issue/PR/Discussions scaffolding for the features the host supports. | `scripts/atlas.mjs:423` | `/atlas:community` | shipped |
| `atlas note <kind> "<text>"` | Append one record to the continuity journal. **The only writing slash command.** | `scripts/atlas.mjs:457` | `/atlas:note` | shipped |
| `atlas state` | What a resuming session reads first: branch, uncommitted work, journal. | `scripts/atlas.mjs:488` | `/atlas:state` | shipped |
| `atlas design [--scaffold]` | The design record's state; `--scaffold` writes question stubs, never answers. | `scripts/atlas.mjs:517` | `/atlas:design` | shipped |
| `atlas ask <task>` | One structured JSON answer with a meaningful exit code. Takes a **task id**, not a question. | `scripts/atlas.mjs:558` | `/atlas:ask` | shipped |
| `atlas mcp` | Serve the corpus over MCP on stdio. `--status` reports what a client would connect to. | `scripts/atlas.mjs:591` | `/atlas:mcp` | shipped |
| `atlas handoff` | The derived half of a handoff, printed as a prompt. Writes no file. | `scripts/atlas.mjs:603` | `/atlas:handoff` | shipped |
| `atlas changes` | Uncommitted work, branch-local work, and the documents that cite the files touched. | `scripts/atlas.mjs:619` | `/atlas:changes`, `/atlas:review` | shipped |
| `atlas config` | The merged configuration — user overrides shown against the defaults. | `scripts/atlas.mjs:631` | `/atlas:config` | shipped |
| `atlas plan [slug]` | Propose the git route for work in progress. `--apply` creates the branch and nothing else. | `scripts/atlas.mjs:676` | `/atlas:plan` | shipped |
| `atlas surviving` | Surviving lines per file, by author. | `scripts/atlas.mjs:711` | `/atlas:surviving` | shipped |
| `atlas ownership` | Areas by author, and where the bus factor is one. | `scripts/atlas.mjs:718` | `/atlas:ownership` | shipped |
| `atlas worklog` | Write the day's log to `worklog/`. `--stdout` prints instead. | `scripts/atlas.mjs:735` | `/atlas:worklog` (via `--stdout`) | shipped |
| `atlas diff [file]` | One file's diff; with no path, lists what there is to ask about. | `scripts/atlas.mjs:753` | `/atlas:diff` | shipped |
| `atlas tokens` | Token accounting from local session transcripts. | `scripts/atlas.mjs:788` | `/atlas:tokens` | shipped |
| `atlas sessions` | Session outcomes — turns, interruptions, compactions, tool friction, rework. | `scripts/atlas.mjs:815` | `/atlas:sessions` | shipped |
| `atlas prompt` | A system prompt assembled from this repository's own config, plan and corpus. | `scripts/atlas.mjs:831` | `/atlas:prompt` | shipped |
| `atlas contrib` | Contribution analysis from `git log` alone. | `scripts/atlas.mjs:851` | `/atlas:contrib` | shipped |
| `atlas spec --gate` | Commit gate: refuse a staged change whose message names no plan item. | `scripts/atlas.mjs:863` | — | shipped |
| `atlas health --gate` | Commit gate: refuse a commit that would land a blocking signal. | `scripts/atlas.mjs:893` | — | shipped |
| `atlas health` | The rot report. Exit 1 when any blocking signal fires. | `scripts/atlas.mjs:910` | `/atlas:health` | shipped |
| `atlas build` | Generate the static site. `--verify` audits what was just written. | `scripts/atlas.mjs:920` | `/atlas:build` | shipped |
| `atlas all` | `scan` + `health` + `build`; exit 1 if blocking. | `scripts/atlas.mjs:920`, `scripts/atlas.mjs:935` | — | shipped |
| `atlas publish --target wiki\|pages\|export` | Stage a publish target. Nothing pushes without `--push`. | `scripts/atlas.mjs:939` | `/atlas:publish` | shipped |
| `atlas serve` | Start (or adopt) the live dashboard server and open it. | `scripts/atlas.mjs:1029` | `/atlas:dashboard` | shipped |
| `atlas serve --stop \| --status \| --list \| --launcher` | Stop it, report it, list every dashboard on the machine, or write a launcher page. | `scripts/atlas.mjs:1032`, `scripts/atlas.mjs:1069`, `scripts/atlas.mjs:1056`, `scripts/atlas.mjs:1043` | `/atlas:dashboard` (`--list`) | shipped |
| `atlas watch [--serve]` | Rebuild on change; `--serve` hosts the output on loopback. | `scripts/atlas.mjs:1207` | — | shipped |

An unrecognised command prints the usage block and exits 2 (`scripts/atlas.mjs:1264`).

### Commands that dispatch but are absent from `usage()`

`usage()` (`scripts/atlas.mjs:1493`) is **not** a complete inventory. These nine dispatch and work, and are
not listed there: `tasks`, `config`, `plan`, `surviving`, `ownership`, `worklog`, `serve`, `capabilities`
(the alias for `caps`), and `spec --gate`. Verified by comparing the `if (cmd === …)` list against the
`console.log` template at `scripts/atlas.mjs:1494-1535`.

### Global flags

| Flag | Effect | Where |
|---|---|---|
| `--root <dir>` | Repository root; default is the git toplevel, else `cwd`. | `scripts/atlas.mjs:102` |
| `--config <path>` | Config file to read. | `scripts/atlas.mjs:338` |
| `--json` | Machine-readable output, on the commands that support it. | e.g. `scripts/atlas.mjs:347` |
| `--verbose[=all]` | List findings rather than counts. | `scripts/atlas.mjs:913` |
| `--no-git` | Skip git metadata; H6 is then reported as unevaluated. | `scripts/atlas.mjs:343`, `scripts/lib/health.mjs:329` |
| `--offline` | Skip the capability probe and say so. | `scripts/atlas.mjs:417` |
| `--quiet` | Suppress progress output. | `scripts/atlas.mjs:97` |
| `--no-color` | Disable ANSI colour. | `scripts/atlas.mjs:99` |

Flags written with a space consume the next argument only if they are in `VALUE_FLAGS`
(`scripts/atlas.mjs:73`); everything else is boolean, so a positional after a boolean flag stays positional
(`scripts/atlas.mjs:77`).

---

## 2. Rot signals

**Sixteen signals ship, not nine.** The catalogue is `scripts/lib/signals.mjs:13-53`; every one is evaluated
in `scripts/lib/health.mjs`.

| Id | Title | Evaluated at | Blocking by default |
|---|---|---|---|
| H1 | Dead internal link | `scripts/lib/health.mjs:70-75` | **yes** |
| H2 | Unresolvable code citation | `scripts/lib/health.mjs:76-83` | no |
| H3 | Duplicate title | `scripts/lib/health.mjs:86-97` | **yes** |
| H4 | Orphan | `scripts/lib/health.mjs:99-104` | no |
| H5 | Unclassified (fell through to the fallback cluster) | `scripts/lib/health.mjs:106-113` | no |
| H6 | Stale against its citations | `scripts/lib/health.mjs:115-138` | no |
| H7 | Forbidden term | `scripts/lib/health.mjs:146-163` | no |
| H8 | Missing title | `scripts/lib/health.mjs:184-185` | **yes** |
| H9 | Cross-reference asymmetry | `scripts/lib/health.mjs:165-182` | no |
| H10 | SOP past its review date | `scripts/lib/health.mjs:236-245` | **yes** |
| H11 | SOP has no live owner | `scripts/lib/health.mjs:236-245` | no |
| H12 | Dead citation in an SOP | `scripts/lib/health.mjs:245-250` | **yes** |
| H13 | Handoff far behind HEAD | `scripts/lib/health.mjs:262-273` | no |
| H14 | Design document cites code that moved | `scripts/lib/health.mjs:200-209` | no |
| H15 | Expected design artifact absent | `scripts/lib/health.mjs:214-228` | no |
| H16 | Undesigned area | `scripts/lib/health.mjs:284-298` | no |

The default blocking set is `['H1', 'H3', 'H8', 'H10', 'H12']` (`scripts/lib/config.mjs:245`) and is
overridable per repository. This repository sets the same five (`project-atlas.config.json:157-163`).

**Two signals check nothing until configured.** H7 needs `forbiddenTerms` and H9 needs `crossref`; when
either list is empty the report says so under *Not checked* rather than reporting the signal clean
(`scripts/lib/health.mjs:330-331`).

**Signals that could not run are never reported as passing.** A signal whose configured regular expression was
declined, or whose input could not be read, is added to `unevaluated` and rendered as `—` rather than green
(`scripts/lib/health.mjs:143-144`, `scripts/lib/health.mjs:357-359`). H16 declares itself unevaluated when
`git ls-files` fails (`scripts/lib/health.mjs:291-293`).

**Suppressions carry a reason.** `suppressionFor` marks a finding suppressed rather than deleting it
(`scripts/lib/health.mjs:47`), and the count is reported (`scripts/lib/health.mjs:366`).

---

## 3. Slash commands (Claude Code skills)

**Twenty-nine `SKILL.md` files under `skills/`**, up from thirteen on 2026-08-12. Twenty-eight set
`disable-model-invocation: true`, which makes them typed-only; `skills/build/SKILL.md` does not and is the one
the model may invoke on its own. Every command below was run in this repository before its skill was written.

| Skill | Shells out to | Source |
|---|---|---|
| `/atlas:ask` | `atlas ask $ARGUMENTS`, `atlas scan` | `skills/ask/SKILL.md` |
| `/atlas:branch` | `atlas branch` | `skills/branch/SKILL.md` |
| `/atlas:caps` | `atlas caps` — **network** | `skills/caps/SKILL.md` |
| `/atlas:changes` | `atlas changes --no-color` | `skills/changes/SKILL.md` |
| `/atlas:community` | `atlas community` — **network**, previews only | `skills/community/SKILL.md` |
| `/atlas:config` | `atlas config`, `atlas scan`, `atlas health --no-color` | `skills/config/SKILL.md` |
| `/atlas:contrib` | `atlas contrib` | `skills/contrib/SKILL.md` |
| `/atlas:dashboard` | `atlas serve`, `atlas serve --list` | `skills/dashboard/SKILL.md` |
| `/atlas:design` | `atlas design` | `skills/design/SKILL.md` |
| `/atlas:diff <path>` | `atlas diff $ARGUMENTS` | `skills/diff/SKILL.md` |
| `/atlas:handoff` | `atlas handoff` | `skills/handoff/SKILL.md` |
| `/atlas:health` | `atlas health --no-color $ARGUMENTS` | `skills/health/SKILL.md` |
| `/atlas:help` | `atlas help`, `atlas caps --offline` | `skills/help/SKILL.md` |
| `/atlas:mcp` | `atlas mcp --status` | `skills/mcp/SKILL.md` |
| `/atlas:note <kind> "<text>"` | `atlas note $ARGUMENTS` — **writes** `.atlas/journal/` | `skills/note/SKILL.md` |
| `/atlas:ownership` | `atlas ownership` | `skills/ownership/SKILL.md` |
| `/atlas:plan <slug>` | `atlas plan $ARGUMENTS` | `skills/plan/SKILL.md` |
| `/atlas:prompt` | `atlas prompt` | `skills/prompt/SKILL.md` |
| `/atlas:publish` | `atlas caps` — **network**, `atlas scan` | `skills/publish/SKILL.md` |
| `/atlas:review` | `atlas changes --no-color`, `atlas health --no-color`, `atlas branch` | `skills/review/SKILL.md` |
| `/atlas:sessions` | `atlas sessions` — reads **local transcripts**, outside the repository | `skills/sessions/SKILL.md` |
| `/atlas:state` | `atlas state` | `skills/state/SKILL.md` |
| `/atlas:status` | `atlas scan`, `atlas health --no-color`, `atlas tasks`, `atlas branch` | `skills/status/SKILL.md` |
| `/atlas:surviving` | `atlas surviving` | `skills/surviving/SKILL.md` |
| `/atlas:tasks [filter]` | `atlas tasks $ARGUMENTS` | `skills/tasks/SKILL.md` |
| `/atlas:tokens` | `atlas tokens` — reads **local transcripts**, outside the repository | `skills/tokens/SKILL.md` |
| `/atlas:version` | `atlas version` | `skills/version/SKILL.md` |
| `/atlas:worklog` | `atlas worklog --stdout` | `skills/worklog/SKILL.md` |
| build (model-invoked) | nothing; instructions only | `skills/build/SKILL.md` |

`atlas status` and `atlas review` are not CLI commands — no `if (cmd === 'status')` or `'review'` exists in
`scripts/atlas.mjs`. They are slash commands only, built over `atlas scan` and `atlas changes`.

Line numbers are omitted from this table on purpose. Every one of these files is prose around one or two
shell blocks and the blocks move whenever the prose does; the command string is the durable citation, and it
is what a reader can grep for.

### Five dispatched commands have no slash command, deliberately

A command per dispatch would make the useful ones harder to find. Each of these was considered and refused,
and the reason is recorded here so the gap is not read as an oversight and closed by the next person.

| Command | Why there is no slash command |
|---|---|
| `atlas watch` | **It blocks until interrupted** — verified by running it, still alive after six seconds. A slash command that never returns is a trap. `/atlas:dashboard` starts the same server, returns, and hands back a URL. |
| `atlas all` | `scan` + `health` + `build`, which is `/atlas:build`; the first two are also `/atlas:status` and `/atlas:health`. A fourth name for the same work splits the path without adding a capability. |
| `atlas init` | Step two of a first run, and `/atlas:build` does the whole run. A command that writes a config and stops ends adoption with no index, no site and no URL — the failure `skills/build/SKILL.md` exists to prevent. |
| `atlas capabilities` | The alias for `caps`. One implementation, one skill. |
| `atlas spec --gate` | The commit hook's entry point. Bare `atlas spec` is not a command at all (it falls through to the usage block and exits 2), and `--gate` reads the commit message from **stdin** — with staged files and no stdin it would wait, and it prints nothing at all when it passes. |

### `/atlas:ask` is currently broken — defect

`skills/ask/SKILL.md:12` runs `atlas ask $ARGUMENTS` with a natural-language question, but
`scripts/atlas.mjs:558` routes `ask` to `runTask`, whose vocabulary is the seven MCP task ids
(`scripts/lib/task.mjs:45`). Run in this session:

```
$ ./bin/atlas ask "what is the taxonomy"
{ "ok": false, "task": "what is the taxonomy",
  "error": "Unknown task \"what is the taxonomy\". One of: atlas_health, atlas_plan, … " }
```

The question-answering implementation still exists at `scripts/atlas.mjs:644-673` — a literal search across
the index that ranks title, heading and body hits — but it is **unreachable**: the earlier `ask` block at
`scripts/atlas.mjs:558` returns on both of its branches. Two commands were given one name and the second
one lost.

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

**`hooks/README.md:7` states there are two hooks.** There are eight entries over six events. That file
predates the continuity, task and activity hooks.

### Automation switches

Four switches, all defaulting to on, plus a master switch (`scripts/lib/config.mjs:269-281`), resolved
through one function (`scripts/lib/config.mjs:385-389`) and validated against a known-key list so a
misspelling is refused rather than failing open (`scripts/lib/config.mjs:392-398`, `scripts/lib/config.mjs:474-479`).

| Key | Turns off | Read at |
|---|---|---|
| `automation.enabled` | every automatic action below | `scripts/lib/config.mjs:387` |
| `automation.buildOnWrite` | the rebuild after a markdown write | `scripts/atlas.mjs:925` |
| `automation.healthOnCommit` | the blocking-signal commit gate | `scripts/atlas.mjs:896` |
| `automation.specOnCommit` | the plan-item commit gate | `scripts/atlas.mjs:864` |
| `automation.planOnBranch` | marking a plan item in progress at branch creation | `scripts/atlas.mjs:386` |

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

`atlas ask` exposes **the same seven** through the same handlers rather than a second implementation
(`scripts/lib/task.mjs:45`, `scripts/lib/task.mjs:83`). Its exit codes: 0 answered and clean, 1 answered with
something blocking, 2 could not answer (`scripts/lib/task.mjs:87`, `scripts/lib/task.mjs:56`, `scripts/lib/task.mjs:66`, `scripts/lib/task.mjs:74-80`).

---

## 6. Generated output

Written by `renderSite` into `output` (default `docs/_wiki`, `scripts/lib/config.mjs:236`). The output
directory is cleared and repopulated on every build (`scripts/lib/render.mjs:50`).

| File | Contents | Written at |
|---|---|---|
| `pages/<name>.html` | One page per source document: rendered markdown, table of contents, backlinks, its own findings. | `scripts/lib/render.mjs:108` |
| `index.html` | Home — corpus figures, health headline, clusters, optional hand-written analysis. | `scripts/lib/render.mjs:180` |
| `wiki.html` | Every document, grouped by cluster. | `scripts/lib/render.mjs:181` |
| `health.html` | Every signal, blocking and advisory. | `scripts/lib/render.mjs:183` |
| `dashboard.html` and `view-*.html` | One file per configured view. | `scripts/lib/render.mjs:203`, `scripts/lib/views.mjs:175` |
| `deck.html` | A browser slide deck, only when a deck source exists. | `scripts/lib/render.mjs:205` |
| `search-index.js` | The client-side full-text index. | `scripts/lib/render.mjs:172` |
| `sources.json` | The allowlist `atlas serve` answers source links from — paths only, no content. | `scripts/lib/render.mjs:178` |
| `atlas.css` | The stylesheet. | `scripts/lib/render.mjs:206` |
| `.gitattributes` | Marks the tree `linguist-generated`. | `scripts/lib/render.mjs:207` |
| `README.md` | A note that this directory is derived. | `scripts/lib/render.mjs:208` |
| `kb/` | The same derived facts as markdown, for an agent with only `Read` and `Grep`. | `scripts/lib/render.mjs:222`, `scripts/lib/kb.mjs:298` |
| `build-stamp.txt` | Written only with `--stamp` or under `watch`; the page polls it to patch itself. | `scripts/lib/render.mjs:240` |
| `all.standalone.html` | The whole site as one file, refreshed after an automated build. | `scripts/atlas.mjs:1377-1382` |

**The page count a build prints is document pages only.** `pages` is the size of the set of files written in
the per-document loop (`scripts/lib/render.mjs:102`, `scripts/lib/render.mjs:109`,
`scripts/lib/render.mjs:232`) — the index, wiki, health, views, deck,
stylesheet and knowledgebase are written but not counted, so the reported figure is always lower than the
number of files in the directory. No count is quoted here on purpose: the output directory is git-ignored
(`.gitignore:4`) and rewritten by any session that edits markdown.

### Views and panels

Nine views ship (`scripts/lib/views.mjs:63-146`): Overview, Backlog, Quality, Product, Delivery,
Architecture, Blueprint, Developer, Executive. A view is a list of panel ids, so adding one is a config entry
rather than a file. Twenty-seven panels are defined (`scripts/lib/views.mjs:18-46`). A view id is constrained
to `/^[A-Za-z0-9-]+$/` because it becomes a filename (`scripts/lib/views.mjs:154`).

### Publish targets

| Target | Produces | Source |
|---|---|---|
| `wiki` | Flattened markdown with links rewritten, a do-not-edit banner per page, a per-page content hash, and a drift check that refuses rather than overwrites. | `scripts/lib/publish.mjs:94`, `scripts/lib/publish.mjs:225` |
| `pages` | The built site copied to a branch (default `gh-pages`), with local-only panels stripped **at staging**, not at push. | `scripts/lib/publish.mjs:367`, `scripts/lib/publish.mjs:394` |
| `export` | One self-contained HTML file; `--page all` bundles every generated page plus the document pages. | `scripts/lib/publish.mjs:907`, `scripts/lib/publish.mjs:532` |

On GitLab, `--target pages --push` refuses and `--ci` writes the `pages` job instead
(`scripts/atlas.mjs:987-993`, `scripts/lib/publish.mjs:435`).

---

## 7. Not built, partial, and untrue

The entries this page exists to make unambiguous.

### Not built

**M-3 · the external control plane.** `docs/references/agent-control.md:7` marks itself *"design, not built
here"*, and `docs/ROADMAP.md` carries M-3 at 40% — the only item in the plan below 100% (`atlas tasks`, run
2026-08-11). No orchestrator, session driver or write-capable MCP surface exists in `scripts/`. `scripts/lib/mcp.mjs:31-34` states the read-only boundary as a
construction rather than a promise, and `scripts/lib/task.mjs:15-20` states that driving a session is out of
scope.

### Partial

**`atlas ask` as a question-answering command.** See §3. The question path is written and unreachable.

### Documented but not true of the code

Found while verifying this page. Each is a claim in a committed document that the code contradicts.

| Where | The claim | What the code says |
|---|---|---|
| `README.md:197-209` | Nine rot signals, three blocking (H1, H3, H8). | Sixteen signals (`scripts/lib/signals.mjs:13-53`); five block by default, adding H10 and H12 (`scripts/lib/config.mjs:245`). Fixed in this change. |
| `README.md:314-325` (before this change) | *"The plugin ships one hook … There is deliberately no second hook."* | Eight entries over six events (`hooks/hooks.json:1-83`). Fixed in this change. |
| `README.md:160` (before this change) | `atlas ask <question>` — *"Answer a question from the project's own documentation, with citations."* | `atlas ask` takes a task id (`scripts/atlas.mjs:558`, `scripts/lib/task.mjs:45`). Fixed in this change. |
| `README.md:397` (before this change) | *"76 integration tests"*. | `node tests/run.mjs` reported 341 passing on 2026-08-11. Fixed in this change. |
| `hooks/README.md:7` | *"There are **two**"* hooks, with a three-row table. | Eight entries over six events (`hooks/hooks.json:1-83`). Not fixed — that file is not owned by this change. |
| `docs/references/autonomy.md:6` | *"a capability that is **not yet built**"*. | The automation layer ships: five switches, all defaulting on, enforced at `scripts/atlas.mjs:386`, `scripts/atlas.mjs:864`, `scripts/atlas.mjs:896`, `scripts/atlas.mjs:925` (`scripts/lib/config.mjs:269-281`). Not fixed. |
| `.claude-plugin/marketplace.json:10` | *"nine mechanical rot signals"*. | Sixteen (`scripts/lib/signals.mjs:13-53`). Not fixed. |

### Not verified

- **`atlas tokens` and `atlas sessions` were not run** in the verifying session — they read machine-local
  transcripts outside the repository, and running them proves nothing about another machine. The dispatch
  (`scripts/atlas.mjs:788`, `scripts/atlas.mjs:815`) and the refusal to write into the published output directory
  (`scripts/atlas.mjs:792`, `scripts/atlas.mjs:817`) were read, not exercised.
- **`atlas publish --push` was not run** against any host. Only the staging paths were read.
- **The Codex and Antigravity installs were not exercised.** Only the manifests were read.
- **`scripts/lib/kb.mjs` was untracked when this page was written**, so the citation to it resolves against
  the working tree but not against `git ls-files`. Until it is committed, H2 reports that one citation as
  unresolvable — correctly, and this note is the reason rather than an excuse.
