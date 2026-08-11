# Capabilities — what project-atlas can do for you

**This page is organised by the job you came to do and says where each job stops; [`FEATURES.md`](FEATURES.md)
is the flat inventory of every command, signal and file.** Nothing is listed twice: if you want to know
whether the tool can do a thing, read this; if you want to know what exactly exists and where it is
implemented, read that.

**Last verified:** 2026-08-11. Every capability below was checked against the code in that session and cites
`path:line`. Where something is partial or absent it says so, because a capability list that flatters itself
is the exact defect this tool was built to find.

---

## What it is, in one paragraph

project-atlas builds a derived knowledgebase over the markdown a repository already contains. It indexes
those files, classifies them into clusters, resolves their internal links and their `path:line` code
citations, checks sixteen mechanical rot signals against the result, and generates a static site — index,
document pages with backlinks, role views, a health report and an optional slide deck. It owns no prose of
its own: the whole output directory is cleared and rewritten on every build (`scripts/lib/render.mjs:50`),
which is what makes it unable to fork from the documents it describes.

---

## Find out whether the documentation is currently true

This is the core job. `atlas health` (`scripts/atlas.mjs:910`) runs sixteen checks and exits 1 when a
**blocking** one fires (`scripts/atlas.mjs:916`).

What it can actually establish, mechanically:

- **A link points at a file that is not there** — checked against the index and then against the filesystem,
  so a link to a real image is not a finding (`scripts/lib/health.mjs:70-75`).
- **A `path:line` citation names a file that is gone, or a line past its end**
  (`scripts/lib/health.mjs:76-83`).
- **Two documents claim the same `# ` title** — the signature of a forked document
  (`scripts/lib/health.mjs:86-97`).
- **A document is older than the code it cites**, past a configurable grace period
  (`scripts/lib/health.mjs:115-138`).
- **A document nothing links to** (`scripts/lib/health.mjs:99-104`), and one that matched no cluster rule
  (`scripts/lib/health.mjs:106-113`).
- **A retired term still in use**, once you have configured which terms those are
  (`scripts/lib/health.mjs:146-163`).
- **An SOP past its own declared review date, with no live owner, or citing a step that cannot be resolved**
  (`scripts/lib/health.mjs:236-253`).
- **A design document whose citations no longer resolve**, judged with no grace period because a design
  document is a claim about how the code works (`scripts/lib/health.mjs:200-209`).
- **A kind of design artifact that is missing entirely, and code areas no design document cites**
  (`scripts/lib/health.mjs:214-228`, `scripts/lib/health.mjs:284-298`).

**What it cannot establish.** Every signal is a fact about the repository, never a judgement about quality —
"this link is dead" is checkable, "this document is wrong" is not, and the catalogue deliberately contains
nothing of the second kind (`scripts/lib/health.mjs:4-6`). A clean report means the mechanical checks found
nothing; it is not a statement that the prose is correct.

**Three things it will not let itself get away with.** A check whose pattern was declined, or whose input
could not be read, is reported as *not evaluated* rather than green (`scripts/lib/health.mjs:357-359`). Every
run prints a *Not checked* section naming what was skipped and why (`scripts/lib/health.mjs:321-336`). A
suppressed finding is counted and stated rather than deleted (`scripts/lib/health.mjs:47`,
`scripts/lib/health.mjs:366`).

**Before it can tell you much, two checks are off.** H7 (forbidden terms) and H9 (cross-reference symmetry)
have nothing to compare against until you configure them, and the report says so on every run rather than
implying they passed (`scripts/lib/health.mjs:330-331`).

---

## Make an existing corpus navigable

`atlas scan` (`scripts/atlas.mjs:345`) builds the index; `atlas build` (`scripts/atlas.mjs:920`) turns it into
a site you can open. What you get that you did not have:

- **A taxonomy.** Every document lands in a cluster by glob rule, with a named fallback so nothing is silently
  dropped (`scripts/lib/scan.mjs:127`, `scripts/lib/health.mjs:106-113`).
- **Backlinks.** Each document page carries the documents that link *to* it — the direction markdown does not
  give you (`scripts/lib/render.mjs:108`).
- **Client-side full-text search**, over titles, headings, excerpts and bodies, with long bodies truncated to a
  configurable limit and the truncation counted (`scripts/lib/render.mjs:111-118`, `scripts/lib/render.mjs:172`).
- **Nine role views over one body of data** — Overview, Backlog, Quality, Product, Delivery, Architecture,
  Blueprint, Developer, Executive (`scripts/lib/views.mjs:63-146`). They are lists of panel ids rather than
  separate pages, so they cannot drift from each other (`scripts/lib/views.mjs:4-8`).
- **The same derived facts as markdown**, under `kb/`, for an agent that has `Read` and `Grep` and no browser
  (`scripts/lib/render.mjs:222`, `scripts/lib/kb.mjs:298`).

**The limit worth knowing.** The site is derived from what is committed. `trackedOnly` defaults to true
(`scripts/lib/config.mjs:237`), so an uncommitted document is not indexed, and the report says when that
setting has been turned off (`scripts/lib/health.mjs:332`).

**What it will not do.** It will not write your prose. The one narrative section on the homepage is a
markdown file a person authored; absent, no section is rendered rather than a generated placeholder
(`scripts/lib/render.mjs:128-135`). `atlas design --scaffold` writes the *questions* a missing design document
owes an answer to and marks the result a stub until a human deletes the marker (`scripts/atlas.mjs:517`,
`scripts/atlas.mjs:544-547`).

---

## Keep it current without having to remember

The failure mode this addresses is that keeping documentation current has always been a separate decision
(`scripts/lib/config.mjs:266-268`).

- **Rebuild when a session writes markdown** — a `PostToolUse` hook, non-blocking
  (`hooks/hooks.json:24-33`, `hooks/on-write.sh:42`).
- **Rebuild while you work** — `atlas watch` polls a fingerprint of every input and rebuilds on change
  (`scripts/atlas.mjs:1207`, `scripts/atlas.mjs:1408`).
- **A live dashboard that patches itself** — `atlas serve` builds, starts a loopback server on a port derived
  from the repository path so several projects coexist, and adopts an existing server rather than starting a
  rival (`scripts/atlas.mjs:1029`, `scripts/lib/serve.mjs:55`, `scripts/atlas.mjs:1142`).
- **Refuse a commit that would land known rot** — the branch guard, then the health gate, then the plan gate
  (`hooks/on-commit.sh:40`, `hooks/on-commit.sh:47`, `hooks/on-commit.sh:78`).

**Every one of these is switchable, and off is one line.** Four automation switches plus a master switch,
all defaulting on (`scripts/lib/config.mjs:269-281`); a misspelled switch is refused rather than silently
failing open (`scripts/lib/config.mjs:474-479`).

**Every one of these is inert in a repository that has not adopted the tool.** No
`project-atlas.config.json`, no gate and no build — checked in the hook scripts (`hooks/on-write.sh:11`,
`hooks/on-commit.sh` via `atlas health --gate` at `scripts/atlas.mjs:896`) and in the commands themselves
(`scripts/atlas.mjs:925`). Installing the plugin does not start writing `docs/_wiki` into unrelated
repositories.

---

## Share it outside the repository

`atlas publish` (`scripts/atlas.mjs:939`) stages one of three targets. **Nothing is pushed without an explicit
`--push`** (`scripts/atlas.mjs:941`); the default writes to a temporary directory and tells you what would go
where.

- **A GitHub or GitLab wiki** — flattened markdown, links rewritten, a do-not-edit banner on every page
  (`scripts/lib/publish.mjs:112-114`). Because wiki repositories have no pull-request review, each publish
  records a content hash per page and **refuses** when a page has been edited by hand; `--import` copies the
  edited pages out for review instead of destroying them (`scripts/lib/publish.mjs:225`,
  `scripts/atlas.mjs:961-971`).
- **A Pages branch** — the built site, force-pushed to `gh-pages` by default. Panels describing the local
  machine are stripped **at staging** rather than at push, so the tree a person reviews is the tree that goes
  out (`scripts/lib/publish.mjs:367`, `scripts/lib/publish.mjs:394`).
- **One self-contained HTML file** — `--page all` carries every generated page and the document pages, with
  navigation working in-document (`scripts/lib/publish.mjs:907`, `scripts/lib/publish.mjs:532`).

**It checks the host rather than assuming one.** `atlas caps` (`scripts/atlas.mjs:415`) asks which of Wiki,
Pages, Issues and Discussions are actually on, and a publish aimed at a disabled feature is refused with a
reason instead of an obscure git error (`scripts/atlas.mjs:948-955`). GitLab Pages is a CI artifact rather
than a branch, so `--target pages --push` refuses there and `--ci` writes the job instead
(`scripts/atlas.mjs:987-993`).

**This is the one command that touches the network,** and only this one: `probeCapabilities` is reached from
`caps`, `community` and `publish` (`scripts/atlas.mjs:417`, `scripts/atlas.mjs:425`, `scripts/atlas.mjs:947`), and `--offline` skips it and says
the result is an assumption.

---

## Ask the corpus a question from software, not a terminal

Two surfaces, both read-only, both answering from the same handlers so they cannot disagree
(`scripts/lib/task.mjs:39-45`).

- **An MCP server on stdio** — `atlas mcp` (`scripts/atlas.mjs:591`) exposes seven tools: health, plan,
  search, changes, contrib, design record, continuity journal (`scripts/lib/mcp.mjs:62-218`). Hand-written
  JSON-RPC, no dependency (`scripts/lib/mcp.mjs:294`). `atlas mcp --status` answers what a client would
  connect to, because the serving path is silent by design and silence looks like a hang
  (`scripts/atlas.mjs:592`).
- **One structured answer with a meaningful exit code** — `atlas ask <task>` (`scripts/atlas.mjs:558`) returns
  JSON and exits 0 clean, 1 with a blocking finding, 2 could not answer (`scripts/lib/task.mjs:87`, `scripts/lib/task.mjs:56`,
  `scripts/lib/task.mjs:66`). **That 1/2 split is the capability**: a CI job can fail on findings without failing on a tool that
  could not run.

**What neither can do.** Nothing here lets outside software drive a session. MCP runs client → server; a
server publishes tools and a client decides to call them, and there is no channel to start work or steer a
run (`scripts/lib/mcp.mjs:9-12`, `scripts/lib/task.mjs:5-8`). If you want that, it is the Agent SDK, and it
is deliberately not in this tool.

**A guard worth knowing about.** Pointed at a directory that never adopted the tool, `atlas ask` refuses with
exit 2 rather than scanning everything beneath it and reporting a large finding count about files that were
never documentation (`scripts/lib/task.mjs:74-80`).

---

## See how the work is actually going

All of this is derived from `git log` and the plan document. There is no telemetry, no service and no second
file to maintain (`scripts/lib/contrib.mjs:41`).

- **Who did what** — `atlas contrib` (`scripts/atlas.mjs:851`): people, AI co-authors by model, per-desk
  attribution, estimated active hours, rework and revert rates, spec-to-build coverage
  (`scripts/lib/contrib.mjs:41`, `scripts/lib/contrib.mjs:276`).
- **Where the bus factor is one** — `atlas ownership` (`scripts/atlas.mjs:718`).
- **What of the work is still standing** — `atlas surviving` (`scripts/atlas.mjs:711`).
- **The plan, with progress bars** — `atlas tasks [filter]` (`scripts/atlas.mjs:359`).
- **What changed and what it endangers** — `atlas changes` (`scripts/atlas.mjs:619`). The third section is the
  reason it exists rather than `git status`: a changed source file that an old architecture document cites is
  the finding, and the index already knows which documents those are.
- **The day's log** — `atlas worklog` (`scripts/atlas.mjs:735`), also refreshed automatically after a build
  (`scripts/atlas.mjs:1367-1375`).
- **Where the tokens went, and how sessions ran** — `atlas tokens` and `atlas sessions`
  (`scripts/atlas.mjs:788`, `scripts/atlas.mjs:815`). These are the only commands that read session transcripts; they
  aggregate only and refuse to write into the published output directory (`scripts/atlas.mjs:792`, `scripts/atlas.mjs:817`).

**Four things it will not report, on purpose.** No combined contribution score and no leaderboard of people.
Active hours are labelled an estimate derived from commit rhythm everywhere they appear. An item with no
figure is charted as unknown and excluded from means rather than as zero. Prompt quality is not measured,
because a repository cannot see a prompt — the outcome proxies ship under their real names. These are stated
as project rules in `AGENTS.md:99-108`; the underlying figures are computed in `scripts/lib/contrib.mjs:140`
(hours) and `scripts/lib/contrib.mjs:276` (coverage).

---

## Carry state across sessions

- **Append one record of what was decided or touched** — `atlas note <kind> "<text>"`
  (`scripts/atlas.mjs:457`), with five kinds: decision, finding, trap, progress, blocker
  (`scripts/lib/journal.mjs:56`). It **records what was decided and touched, never what was said**, and it is
  never published (`scripts/lib/journal.mjs:117`).
- **Read back what a resuming session needs first** — `atlas state` (`scripts/atlas.mjs:488`): where you are,
  what is uncommitted, then the journal. It groups and orders; it does not summarise, because summarising
  would be the tool writing prose about work it did not do (`scripts/atlas.mjs:484-486`).
- **The derived half of a handoff, as a prompt** — `atlas handoff` (`scripts/atlas.mjs:603`). **It never
  writes the file.** A machine can see that a commit happened; it cannot see that a decision was argued and
  settled (`scripts/atlas.mjs:501-506`).
- **Flushed at the moments a session can end** — `Stop`, `SubagentStop` and `PreCompact` hooks, all
  non-blocking (`hooks/hooks.json:52-81`, `hooks/on-continuity.sh:108`).

---

## Keep a change on the rails

- **Check before you write** — `atlas branch` (`scripts/atlas.mjs:368`) reports where you are and exits
  non-zero when it is not safe to commit there (`scripts/atlas.mjs:375`).
- **Propose the route before the decision, not after** — `atlas plan` (`scripts/atlas.mjs:676`) works out
  branch, type, version bump and the way to `main`. `--apply` creates the branch and **only** the branch;
  committing and pushing stay explicit (`scripts/atlas.mjs:699-707`).
- **Mark the plan item in progress at the one observable moment** — branch creation, rather than an
  instruction someone has to remember (`scripts/atlas.mjs:386-411`). A figure only ever moves up on its own
  (`scripts/atlas.mjs:405`).
- **Two commit gates** — a blocking documentation signal (`scripts/atlas.mjs:893`) and a commit that names no
  plan item (`scripts/atlas.mjs:863`).

---

## Where it stops

**It will not summarise your documents.** Unreviewed generated prose at scale is a confident source of wrong
facts, and it is the one thing a tool that measures drift must not add to the corpus it measures
(`AGENTS.md:128-129`, `scripts/atlas.mjs:508-514`).

**It will not move your content.** The markdown stays where it is; everything generated is derived and safe
to delete (`AGENTS.md:13-16`).

**It will not push anything you did not ask for.** `--push` is required for every publish, every time
(`scripts/atlas.mjs:941`).

**It cannot be driven from outside.** See above; the external control plane is **designed and not built** —
`docs/references/agent-control.md:7` says so in its own status line, and it is the only item in the plan
below 100% (`atlas tasks`, run 2026-08-11: M-3 at 40%, every other item at 100%).

**`atlas ask <question>` does not work.** The slash command `/atlas:ask` passes a natural-language question
(`skills/ask/SKILL.md:12`) to a command that expects one of seven task ids (`scripts/atlas.mjs:558`,
`scripts/lib/task.mjs:45`), and it returns an error. The question-answering code exists at
`scripts/atlas.mjs:644-673` and is unreachable behind the earlier block. Use `atlas mcp`'s `atlas_search`
tool, or the site's search, until that is repaired. Details in [`FEATURES.md`](FEATURES.md).

---

## What has to be true before any of it works

| Requirement | Why | Where |
|---|---|---|
| Node ≥ 18, and nothing else | There are no runtime dependencies, no manifest and no lockfile. The version floor is stated, not enforced by an `engines` field — there is no `package.json`. | `AGENTS.md:39`, `docs/legal/THIRD-PARTY.md` |
| A git repository | Discovery uses `git ls-files` by default, and staleness needs commit dates. Without it, H6 and H16 are reported unevaluated rather than clean. | `scripts/lib/config.mjs:237`, `scripts/lib/health.mjs:291-293`, `scripts/lib/health.mjs:329` |
| A `project-atlas.config.json` | Written by `atlas init`. Without one, the hooks are inert and `atlas ask` refuses with exit 2. | `scripts/atlas.mjs:340`, `scripts/lib/task.mjs:74-80` |
| Markdown worth indexing | The adoption notice stays silent below three markdown files — a repository with one README does not want a knowledgebase. | `scripts/atlas.mjs:231`, `scripts/atlas.mjs:249` |
