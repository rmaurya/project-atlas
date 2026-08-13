# Capabilities — what project-atlas can do for you

**This page is organised by the job you came to do and says where each job stops; [`FEATURES.md`](FEATURES.md)
is the flat inventory of every command, signal and file.** Nothing is listed twice: if you want to know
whether the tool can do a thing, read this; if you want to know what exactly exists and where it is
implemented, read that.

**This page carries no "last verified" date, and that is deliberate.** It used to open *"Last verified:
2026-08-11. Every capability below was checked against the code in that session and cites `path:line`."*
Neither half held. The page had never heard of `pause`, `resume`, `stop`, `contention`, the six `git-*`
commands or the Economics view; it called `atlas ask <question>` broken two days after it was fixed; and its
line numbers matched **no committed tree at all** — against the three candidate trees from that date the
offsets came out at +29, +21 and +24 on different citations, so they cannot all have been read from one
checkout. A date is a claim a reader cannot check and a test cannot either.

**What replaces it.** Every command citation on this page is the line its own `if (cmd === …)` sits on,
re-derived from `scripts/atlas.mjs` by `tests/run.mjs` and compared against what is written here — so these
numbers cannot drift again without failing the suite. Citations into other modules name the **symbol** rather
than a line, because a symbol is greppable and a line number is a guess with a decimal point. Where something
is partial or absent it says so, because a capability list that flatters itself is the exact defect this tool
was built to find (A-50).

---

## What it is, in one paragraph

project-atlas builds a derived knowledgebase over the markdown a repository already contains. It indexes
those files, classifies them into clusters, resolves their internal links and their `path:line` code
citations, checks sixteen mechanical rot signals against the result, and generates a static site — index,
document pages with backlinks, eleven role views, a health report and an optional slide deck. A seventeenth
signal, H17, is reported beside the sixteen and is a claim about how the **session** was run rather than about
the repository; it can never block. It owns no prose of its own: the whole output directory is cleared and
rewritten on every build (`prepareOutputDir` in `scripts/lib/render.mjs`), which is what makes it unable to
fork from the documents it describes.

---

## Find out whether the documentation is currently true

This is the core job. `atlas health` (`scripts/atlas.mjs:1050`) runs sixteen checks over the corpus, reports
H17 beside them, and exits 1 when a **blocking** one fires (the exit-1 branch of `atlas health`). **Five
signals block by default** — H1, H3, H8, H10 and H12 — and the set is overridable per repository.

What it can actually establish, mechanically:

- **A link points at a file that is not there** — checked against the index and then against the filesystem,
  so a link to a real image is not a finding (`scripts/lib/health.mjs:322`).
- **A `path:line` citation names a file that is gone, or a line past its end**
  (`scripts/lib/health.mjs:326`).
- **Two documents claim the same `# ` title** — the signature of a forked document
  (`scripts/lib/health.mjs:344`).
- **A document is older than the code it cites**, past a configurable grace period
  (`scripts/lib/health.mjs:382`).
- **A document nothing links to** (`scripts/lib/health.mjs:351`), and one that matched no cluster rule
  (`scripts/lib/health.mjs:357`).
- **A retired term still in use**, once you have configured which terms those are
  (`scripts/lib/health.mjs:407`).
- **An SOP past its own declared review date, with no live owner, or citing a step that cannot be resolved**
  (`scripts/lib/sop.mjs:113`, `scripts/lib/health.mjs:497`).
- **A design document whose citations no longer resolve**, judged with no grace period because a design
  document is a claim about how the code works (`scripts/lib/health.mjs:454`).
- **A kind of design artifact that is missing entirely, and code areas no design document cites**
  (`scripts/lib/health.mjs:472`, `scripts/lib/health.mjs:546`).

**What it cannot establish.** Every signal is a fact about the repository, never a judgement about quality —
"this link is dead" is checkable, "this document is wrong" is not, and the catalogue deliberately contains
nothing of the second kind (the header comment of `scripts/lib/health.mjs`). A clean report means the mechanical checks found
nothing; it is not a statement that the prose is correct.

**Three things it will not let itself get away with.** A check whose pattern was declined, or whose input
could not be read, is reported as *not evaluated* rather than green (`unevaluated` in `runHealth`). Every
run prints a *Not checked* section naming what was skipped and why (the *Not checked* block of `formatHealth`). A
suppressed finding is counted and stated rather than deleted (`suppressionFor`,
the suppression count in `formatHealth`).

**Before it can tell you much, two checks are off.** H7 (forbidden terms) and H9 (cross-reference symmetry)
have nothing to compare against until you configure them, and the report says so on every run rather than
implying they passed (the *Not checked* block of `formatHealth`).

---

## Make an existing corpus navigable

`atlas scan` (`scripts/atlas.mjs:380`) builds the index; `atlas build` (`scripts/atlas.mjs:1060`) turns it into
a site you can open. What you get that you did not have:

- **A taxonomy.** Every document lands in a cluster by glob rule, with a named fallback so nothing is silently
  dropped (`classify` in `scripts/lib/scan.mjs`, `scripts/lib/health.mjs:357`).
- **Backlinks.** Each document page carries the documents that link *to* it — the direction markdown does not
  give you (`backlinksFor` in `scripts/lib/render.mjs`).
- **Client-side full-text search**, over titles, headings, excerpts and bodies, with long bodies truncated to a
  configurable limit and the truncation counted (the search-index build in `renderSite`).
- **Eleven role views over one body of data** — Overview, Backlog, Quality, Product, Delivery, Repository,
  Economics, Architecture, Blueprint, Developer, Executive (`DEFAULT_VIEWS` in `scripts/lib/views.mjs`), built
  from **thirty-six panels**. They are lists of panel ids rather than separate pages, so they cannot drift from
  each other. This sentence said *nine* and named nine for as long as Repository and Economics had been
  shipping; both figures and the list of names are now read out of it by `tests/run.mjs` and compared against
  `DEFAULT_VIEWS` and `PANELS`.
- **The same derived facts as markdown**, under `kb/`, for an agent that has `Read` and `Grep` and no browser
  (`scripts/lib/render.mjs:302`, `scripts/lib/kb.mjs`).

**The limit worth knowing.** The site is derived from what is committed. `trackedOnly` defaults to true
(`scripts/lib/config.mjs:237`), so an uncommitted document is not indexed, and the report says when that
setting has been turned off (the *Not checked* block of `formatHealth`).

**What it will not do.** It will not write your prose. The one narrative section on the homepage is a
markdown file a person authored; absent, no section is rendered rather than a generated placeholder
(the optional analysis section in `indexPage`). `atlas design --scaffold` writes the *questions* a missing design document
owes an answer to and marks the result a stub until a human deletes the marker (`scripts/atlas.mjs:569`,
`scaffold`).

---

## Keep it current without having to remember

The failure mode this addresses is that keeping documentation current has always been a separate decision
(the `automation` defaults in `scripts/lib/config.mjs`).

- **Rebuild when a session writes markdown** — a `PostToolUse` hook, non-blocking
  (`hooks/hooks.json:24-33`, `hooks/on-write.sh:42`).
- **Rebuild while you work** — `atlas watch` polls a fingerprint of every input and rebuilds on change
  (`scripts/atlas.mjs:1506`, the fingerprint poll in the `watch` block).
- **A live dashboard that patches itself** — `atlas serve` builds, starts a loopback server on a port derived
  from the repository path so several projects coexist, and adopts an existing server rather than starting a
  rival (`scripts/atlas.mjs:1225`, `scripts/lib/serve.mjs:55`, the adopt-an-existing-server path in the `serve` block).
- **Refuse a commit that would land known rot** — the branch guard, then the health gate, then the plan gate
  (`hooks/on-commit.sh:40`, `hooks/on-commit.sh:47`, `hooks/on-commit.sh:78`).

**Every one of these is switchable, and off is one line.** Four automation switches plus a master switch,
all defaulting on (the `automation` defaults in `scripts/lib/config.mjs`); a misspelled switch is refused rather than silently
failing open (the known-key check in `scripts/lib/config.mjs`).

**Every one of these is inert in a repository that has not adopted the tool.** No
`project-atlas.config.json`, no gate and no build — checked in the hook scripts (`hooks/on-write.sh:11`,
`hooks/on-commit.sh` via `atlas health --gate` at `scripts/atlas.mjs:1030`) and in the commands themselves
(the adoption check each command runs). Installing the plugin does not start writing `docs/_wiki` into unrelated
repositories.

---

## Share it outside the repository

`atlas publish` (`scripts/atlas.mjs:1079`) stages one of three targets. **Nothing is pushed without an explicit
`--push`** (the `--push` guard in the `publish` block); the default writes to a temporary directory and tells you what would go
where.

- **A GitHub or GitLab wiki** — flattened markdown, links rewritten, a do-not-edit banner on every page
  (`buildWikiPages`). Because wiki repositories have no pull-request review, each publish
  records a content hash per page and **refuses** when a page has been edited by hand; `--import` copies the
  edited pages out for review instead of destroying them (the drift guard in `stageWiki`,
  `--import`).
- **A Pages branch** — the built site, force-pushed to `gh-pages` by default. Panels describing the local
  machine are stripped **at staging** rather than at push, so the tree a person reviews is the tree that goes
  out (`stagePages`, `stripLocalOnlyTree`).
- **One self-contained HTML file** — `--page all` carries every generated page and the document pages, with
  navigation working in-document (`exportBundle`, `exportSingleFile`).

**It checks the host rather than assuming one.** `atlas caps` (`scripts/atlas.mjs:467`) asks which of Wiki,
Pages, Issues and Discussions are actually on, and a publish aimed at a disabled feature is refused with a
reason instead of an obscure git error (the refusal path in the `publish` block). GitLab Pages is a CI artifact rather
than a branch, so `--target pages --push` refuses there and `--ci` writes the job instead
(the GitLab branch of the `publish` block).

**This is the one command that touches the network,** and only this one: `probeCapabilities` is reached from
`caps`, `community` and `publish` (the `caps` block, the `community` block, the `publish` block), and `--offline` skips it and says
the result is an assumption.

---

## Ask the corpus a question from software, not a terminal

Two surfaces, both read-only, both answering from the same handlers so they cannot disagree
(`TASKS` in `scripts/lib/task.mjs`).

- **An MCP server on stdio** — `atlas mcp` (`scripts/atlas.mjs:668`) exposes seven tools: health, plan,
  search, changes, contrib, design record, continuity journal (`TOOLS` in `scripts/lib/mcp.mjs`). Hand-written
  JSON-RPC, no dependency (`scripts/lib/mcp.mjs:294`). `atlas mcp --status` answers what a client would
  connect to, because the serving path is silent by design and silence looks like a hang
  (`atlas mcp --status`).
- **One structured answer with a meaningful exit code** — `atlas ask <task>` (`scripts/atlas.mjs:626`) returns
  JSON and exits 0 clean, 1 with a blocking finding, 2 could not answer (`scripts/lib/task.mjs:87`, `scripts/lib/task.mjs:56`,
  `scripts/lib/task.mjs:66`). **That 1/2 split is the capability**: a CI job can fail on findings without failing on a tool that
  could not run.

**What neither can do.** Nothing here lets outside software drive a session. MCP runs client → server; a
server publishes tools and a client decides to call them, and there is no channel to start work or steer a
run (`scripts/lib/mcp.mjs:31-34`, `scripts/lib/task.mjs:15-20`). If you want that, it is the Agent SDK, and it
is deliberately not in this tool.

**A guard worth knowing about.** Pointed at a directory that never adopted the tool, `atlas ask` refuses with
exit 2 rather than scanning everything beneath it and reporting a large finding count about files that were
never documentation (`scripts/lib/task.mjs:74-80`).

---

## See how the work is actually going

All of this is derived from `git log` and the plan document. There is no telemetry, no service and no second
file to maintain (`scripts/lib/contrib.mjs`).

- **Who did what** — `atlas contrib` (`scripts/atlas.mjs:945`): people, AI co-authors by model, per-desk
  attribution, estimated active hours, rework and revert rates, spec-to-build coverage
  (`scripts/lib/contrib.mjs`, `scripts/lib/contrib.mjs`).
- **Where the bus factor is one** — `atlas ownership` (`scripts/atlas.mjs:795`).
- **What of the work is still standing** — `atlas surviving` (`scripts/atlas.mjs:788`).
- **The plan, with progress bars** — `atlas tasks [filter]` (`scripts/atlas.mjs:394`).
- **What changed and what it endangers** — `atlas changes` (`scripts/atlas.mjs:696`). The third section is the
  reason it exists rather than `git status`: a changed source file that an old architecture document cites is
  the finding, and the index already knows which documents those are.
- **The day's log** — `atlas worklog` (`scripts/atlas.mjs:812`), also refreshed automatically after a build
  (the post-build worklog refresh).
- **Where the tokens went, and how sessions ran** — `atlas tokens` and `atlas sessions`
  (`scripts/atlas.mjs:865`, `scripts/atlas.mjs:909`). They aggregate only and refuse to write into the
  published output directory (the `tokens` block, the `sessions` block).
- **What the work cost, per task, kind, agent and branch** — the **Economics** view, built by `atlas build`
  from the same transcript store (`scripts/lib/tokens.mjs:766`). **Six panels** — Where the figures come
  from, tokens by tier, spend over time, main agent against subagents, per-task windows, and the shared
  caveats — and the only part of a build that opens a transcript. The number of charts inside them is not
  quoted here on purpose: several render only when there is data to render, so any figure would be this
  machine's rather than the tool's.

  **This bullet used to say `tokens` and `sessions` were "the only commands that read session transcripts".**
  That stopped being true when the Economics view shipped as C-10, and it was still here after the same
  sentence had been corrected in `README.md`, `docs/legal/PRIVACY.md` and `docs/references/configuration.md` —
  a retired privacy rule surviving in the one page organised by capability, which is where somebody deciding
  whether to adopt the tool would look for it. Three surfaces read transcripts, not two, and a build that
  renders Economics is the third. `atlas watch` therefore triggers it on every save.

**Four things it will not report, on purpose.** No combined contribution score and no leaderboard of people.
Active hours are labelled an estimate derived from commit rhythm everywhere they appear. An item with no
figure is charted as unknown and excluded from means rather than as zero. Prompt quality is not measured,
because a repository cannot see a prompt — the outcome proxies ship under their real names. These are stated
as project rules in `AGENTS.md:99-108`; the underlying figures are computed in `scripts/lib/contrib.mjs`
(hours) and `scripts/lib/contrib.mjs` (coverage).

---

## Carry state across sessions

- **Append one record of what was decided or touched** — `atlas note <kind> "<text>"`
  (`scripts/atlas.mjs:509`), with five kinds: decision, finding, trap, progress, blocker
  (`KINDS` in `scripts/lib/journal.mjs`). It **records what was decided and touched, never what was said**, and it is
  never published (`scripts/lib/journal.mjs`).
- **Read back what a resuming session needs first** — `atlas state` (`scripts/atlas.mjs:540`): where you are,
  what is uncommitted, then the journal. It groups and orders; it does not summarise, because summarising
  would be the tool writing prose about work it did not do (the `state` block).
- **The derived half of a handoff, as a prompt** — `atlas handoff` (`scripts/atlas.mjs:680`). **It never
  writes the file.** A machine can see that a commit happened; it cannot see that a decision was argued and
  settled (the `handoff` block).
- **Flushed at the moments a session can end** — `Stop`, `SubagentStop` and `PreCompact` hooks, all
  non-blocking (`hooks/hooks.json:52-81`, `hooks/on-continuity.sh:108`).

---

## Put the work down and pick it up again

**None of this was on this page until A-50**, though it shipped as A-32. The three commands are about the
state of the *work*, not of the corpus, and they are the only ones here that touch git refs.

- **Checkpoint everything in flight** — `atlas pause` (`scripts/atlas.mjs:1176`) writes every agent worktree
  to a `wip/agent-*` ref and records the session. `--dry-run` says what it would do and writes nothing.
- **Get the re-spawn plan back** — `atlas resume` (`scripts/atlas.mjs:1176`): branch, worktree and checkpoint
  per agent. **It writes nothing** — it prints what to run, and a person runs it.
- **Clear the session without losing the work** — `atlas stop` (`scripts/atlas.mjs:1176`) removes session
  state and agent worktrees. **Every branch and every checkpoint survives it**; that is the whole contract,
  and it is why `stop` is safe to type.

**Where it stops.** A checkpoint is a git ref, so it survives anything git survives — and nothing else. An
uncommitted change in a worktree that was never checkpointed is not recoverable by `resume`, and `resume`
says what it found rather than implying completeness.

---

## Split work across agents without them colliding

- **Know what a fan-out will collide on, before it starts** — `atlas contention`
  (`scripts/atlas.mjs:451`): files more than one branch touches, plan-item ids more than one branch defines,
  and the **next free id per prefix**. It exits 1 on a duplicate id and on nothing else.
- **Why the id matters more than the file.** Two branches editing one file is a merge, which git already
  handles. Two agents that each counted "the next free plan item" for themselves both write `A-34`, and the
  collision is only discovered at merge time in a document git will happily merge cleanly. This command exists
  because that happened: A-34 was filed twice, A-38 and A-39 three times each.

**Where it stops.** **It refuses nothing.** It reports before the split and has no opinion about the answer;
two branches on one file is often correct.

---

## Read what git history says

`atlas git-insights [section]` (`scripts/atlas.mjs:971`, alias `git-insight`) is read-only and derives
everything from `git log`. Six sections: hotspots, coupling, branches, cadence, hygiene, change. Six slash
commands cut it into the questions people actually ask — `/atlas:git-status`, `/atlas:git-branch`,
`/atlas:git-diff`, `/atlas:git-history`, `/atlas:git-hotspots`, `/atlas:git-insights`.

**Three refusals worth knowing**, because each is a number the report will not give you:

- **Hotspots never combine commits and churn into a score.** They disagree usefully, and a config touched
  forty times for one line each is not the same object as a module rewritten twice.
- **Coupling prints its own denominator and marks itself `ANECDOTE, NOT SIGNAL`** below a support floor. Two
  files that landed in one commit twice are not a coupled pair.
- **Cadence carries no forecast.** There is no basis for one, and "at this rate" is the class of invention
  this tool exists to prevent.

---

## Keep a change on the rails

- **Check before you write** — `atlas branch` (`scripts/atlas.mjs:403`) reports where you are and exits
  non-zero when it is not safe to commit there (the non-zero exit in the `branch` block).
- **Propose the route before the decision, not after** — `atlas plan` (`scripts/atlas.mjs:753`) works out
  branch, type, version bump and the way to `main`. `--apply` creates the branch and **only** the branch;
  committing and pushing stay explicit (the `--apply` branch of the `plan` block).
- **Mark the plan item in progress at the one observable moment** — branch creation, rather than an
  instruction someone has to remember (the branch-creation path). A figure only ever moves up on its own
  (`setItemPercent`, which only ever raises a figure).
- **Two commit gates** — a blocking documentation signal (`scripts/atlas.mjs:1030`) and a commit that names no
  plan item (`scripts/atlas.mjs:1000`).

---

## Where it stops

**It will not summarise your documents.** Unreviewed generated prose at scale is a confident source of wrong
facts, and it is the one thing a tool that measures drift must not add to the corpus it measures
(`AGENTS.md:128-129`, the `design` block).

**It will not move your content.** The markdown stays where it is; everything generated is derived and safe
to delete (`AGENTS.md:13-16`).

**It will not push anything you did not ask for.** `--push` is required for every publish, every time
(the `--push` guard in the `publish` block).

**It cannot be driven from outside.** See above; the external control plane is **designed and not built** —
`docs/references/agent-control.md:7` says so in its own status line, and `docs/ROADMAP.md` carries M-3 at 40%.
It is **not** the only item below 100%: the plan holds 105 items at a mean of 95.4%, seven of them short of
100%. This page claimed M-3 was the only one, which was a smaller and more flattering number than the truth;
§7 of [`FEATURES.md`](FEATURES.md) now carries those figures and a test that re-derives them.

**`atlas ask <question>` works, and this page said otherwise for longer than it was ever broken.** The
paragraph that stood here read *"`atlas ask <question>` does not work"* and told the reader to use
`atlas_search` or the site search *"until that is repaired"* — after M-2's follow-up had already repaired it.
Dispatch routes on the **argument**: a known task id is a program's call and takes the structured path
(`scripts/atlas.mjs:629`), anything else is a person's question and takes the document search
(`scripts/atlas.mjs:626`). Verified by running it against this tree:

```
$ ./bin/atlas ask "what is the health of this repo"
No document contains "what is the health of this repo" literally. The corpus may still answer it
in other words — 77 document(s) across 13 clusters.
$ echo $?
0
```

A stale *"this is broken"* is the most expensive kind of wrong entry on a page like this: it costs the reader
the feature, it cannot be refuted from inside the page, and nobody who knows the command works ever reads the
sentence saying it does not. `tests/run.mjs` now fails if any of these three pages calls a dispatched command
broken, missing or not built.

---

## What has to be true before any of it works

| Requirement | Why | Where |
|---|---|---|
| Node ≥ 18, and nothing else | There are no runtime dependencies, no manifest and no lockfile. The version floor is stated, not enforced by an `engines` field — there is no `package.json`. | `AGENTS.md:39`, `docs/legal/THIRD-PARTY.md` |
| A git repository | Discovery uses `git ls-files` by default, and staleness needs commit dates. Without it, H6 and H16 are reported unevaluated rather than clean. | `scripts/lib/config.mjs:237`, `scripts/lib/health.mjs:542`, the *Not checked* block of `formatHealth` |
| A `project-atlas.config.json` | Written by `atlas init`. Without one, the hooks are inert and `atlas ask` refuses with exit 2. | `scripts/atlas.mjs:375`, `scripts/lib/task.mjs:74-80` |
| Markdown worth indexing | The adoption notice stays silent below three markdown files — a repository with one README does not want a knowledgebase. | `adoptionNotice`, `adoptionNotice` |
