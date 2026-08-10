# Roadmap — project-atlas

**Last updated:** 2026-08-10 · **Version:** 0.1.36 · **Status:** pre-release, dogfooding

Open work, with an honest completion figure against each item. A figure marked `*` is estimated rather than
measured against the code — the same distinction the tool preserves everywhere else, applied to itself.

> **This file went stale for 35 commits, was rewritten, and went stale again inside one session.** Track 1 was
> delivered while the table read 0%. It was corrected at 0.1.7 — and then six releases shipped without
> touching it. Both times the dashboard reported the drift on its front page (*Spec to build — named by a
> commit: 0 of 20*) and both times nobody read it. The tool detects documentation drift; its own plan is the
> document that keeps drifting. **D-6 and D-8 exist because writing this by hand does not work.**

| Item | % | Item | % | Item | % |
|---|---|---|---|---|---|
| C-1 | 100 | C-2 | 100 | C-3 | 100 |
| C-4 | 100 | C-5 | 100 | C-6 | 100 |
| P-1 | 100 | P-2 | 90 | P-3 | 100 |
| Q-1 | 100 | Q-2 | 100 | Q-3 | 100 |
| D-1 | 100 | D-2 | 100 | D-3 | 100 |
| D-4 | 100 | D-5 | 100 | D-6 | 100 |
| D-7 | 100 | D-8 | 100 | D-9 | 100 |
| D-10 | 100 | I-1 | 100 | | |
| I-3 | 100 | D-11 | 100 | I-2 | 100 |
| A-1 | 0 | A-2 | 0 | A-3 | 0 |
| A-4 | 0 | A-5 | 0 | A-6 | 0 |
| A-7 | 0 | A-8 | 0 | A-9 | 0 |
| A-10 | 0 | A-11 | 0 | A-12 | 0 |
| S-1 | 0 | S-2 | 0 | S-3 | 0 |
| S-4 | 0 | S-5 | 0 | S-6 | 0 |
| S-7 | 0 | | | | |

---

## Track 1 — Capability

**C-1 · Contribution analytics on the dashboard** — **P1 · High**
*The engine reads people, agents, desks, estimated hours and outcome rates from git.*
Shipped. The dashboard carries commits per week, model mix, desks, a people table and spec-to-build coverage.
No combined contribution score, deliberately.

**C-2 · Role-scoped views** — **P1 · High**
*One dashboard serves nobody in particular; six audiences want six different first screens.*
Shipped: QC, product, delivery, architecture, developer, executive. Config-driven panel selection over the
same derived data, not six hand-written pages.

**C-3 · Selectable themes with a one-click toggle** — **P2 · Medium**
*Light and dark are generated, but the viewer cannot choose.*
Shipped, three-state, persisted. Both ramps cleared the palette validator against their own surfaces. The
standalone export dropped the toggle for one release (0.1.5 fixed it); a test now asserts the export cannot
delete a control the built page rendered.

**C-4 · GitLab support** — **P2 · Medium**
*Publishing assumed GitHub.*
Shipped. The host is detected from the remote, and Pages is emitted as a CI job rather than a branch.

**C-5 · Surviving-lines analysis** — **P3 · Low**
*Shipped in 0.1.22.* `atlas surviving` — a `git blame` pass counting lines still in the file today. It does
not reward churn: a thousand lines written and replaced next week count once, for whoever wrote what remains.

Capped and opt-in, and **the cap is reported**: a sample presented as a total is the quiet lie this project
refuses everywhere else. Reported beside the other measures, never combined into a score, and it still does
not measure quality — deleted work counts for nothing here and removing a bad abstraction leaves no surviving
lines at all.

**C-6 · Bus factor and ownership** — **P3 · Medium**
*Shipped in 0.1.21.* `atlas ownership` — per area, not per repository. "Bus factor 1" for a whole project
says one person wrote everything, which on a young repository is a fact about its age; *these seven
directories have exactly one author, and one of them is the publishing path* names something to do.

An area with a single commit is excluded — it is new, not concentrated, and the first week of any project
would otherwise bury the real risks. A second author counts however little they wrote: "meaningful
contribution" is a judgement this cannot make.

## Track 2 — Product

**P-1 · Core generation** — **P0 · Critical**
*Index, taxonomy, backlinks, search, document pages, health report.*
Built, tested, and dogfooded on a 387-file corpus.

**P-2 · Dashboard and deck** — **P1 · High**
*Charts, a sortable item table, and a browser slide deck from a markdown source.*
Built. **The breakpoints have now been checked in a real viewport, and they were wrong.** At 390px the top
navigation rendered 778px wide and `overflow-x:hidden` clipped it, so every link past the second was
invisible and unscrollable while nothing appeared broken. Fixed in 0.1.35 and verified at 320, 390, 430, 768,
1024 and 1440 across the dashboard, index, role views, health and wiki: no horizontal page scroll, no clipped
element, 44px tap targets. The claim that stood here for nineteen releases was that the media queries were
"standard" — which is exactly the kind of untested assertion this project exists to catch.

**P-3 · Publishing** — **P1 · High**
*GitHub Wiki with drift detection, a pages branch, and a single-file export.*
*Complete in 0.1.24, on the tool's side.* All three targets stage correctly and refuse to push without
`--push`. `--page all` carries every page in one file with the navigation working, which is what makes the
Artifact path useful.

**The drift path has now actually run.** It was "written but never exercised against a real edited wiki" for
nineteen releases — the only thing standing between a colleague's typo fix in the web UI and a force
overwrite. Three tests build a bare repository, publish into it, edit a page the way a person would, and
assert: the publish refuses, `--import` rescues the human text with a `MAPPING.json` back to the source, and
`--force` is the only way past.

**One thing remains and it is not code.** GitHub Pages has never served this site: the workflow builds and
uploads on every push, and the repository's Pages source is not set to *GitHub Actions*. That is a setting in
this repository, the same class as branch protection, and no amount of tool work reaches it.

## Track 3 — Quality

**Q-1 · Test suite** — **P0 · Critical**
*189 integration tests against throwaway git repositories, no mocks.*
Every bug the tool has shipped is pinned by a test that fails without its fix.

**Q-2 · Defaults that fit real repositories** — **P1 · High**
*Shipped in 0.1.23.* Running `init` on this repository classified 4 of 39 documents and dropped 35 into the
fallback: every `SKILL.md`, every reference guide, `AGENTS.md` and the whole of `.github`. The taxonomy was
tuned for product repositories and said "uncategorised" about the shape of repository this tool is most often
installed into.

Three clusters added — **Agent instructions**, **Reference guides**, **Community** — plus `hooks/**` under
Operations and `ANALYSIS.md` under Research. The same corpus now classifies **39 of 39**. A regression test
pins the product-repo shapes, because the new rules are filename-driven and run before the directory catches,
so they could shadow what already worked.

**Q-3 · CI on a matrix** — **P2 · Low**
*Shipped in 0.1.20.* Six combinations: ubuntu, macOS and Windows against Node 20 and 22, `fail-fast: false`
so a Windows-only failure cannot hide whether Linux passed.

macOS earns its place separately from Linux: it is case-insensitive by default, which is precisely the
property `isAtOrInside` exists to defend against and the only runner where that guard is exercised.

**The matrix was red on Windows from the day it was added until 0.1.32, and never once for the reason it was
added.** `core.autocrlf false` was set *after* `actions/checkout`, which cannot undo a conversion already
applied — so the tree arrived as CRLF, `sync-runtimes --check` called every skill stale, and the job died at
its second step. A `.gitattributes` of `* text=auto eol=lf` fixes it at checkout, and the workflow now
asserts the tree is LF rather than claiming it. With the tree readable the matrix immediately earned itself:
`atlas tokens` reported nothing on Windows (a drive colon in the store slug), a first wiki publish was
refused as unreachable (an empty `stderr` Buffer is truthy), and every in-document link in a single-file
export was dead (`path.join` made `pages\A.html`, so a `startsWith('pages/')` test went false).

The four hook tests execute POSIX shell blocks and cannot run on Windows. They are **skipped by name and
counted in the summary** rather than dropped — a suite that quietly runs 202 of 206 on one platform reports a
green tick for coverage it did not have.


## Track 4 — Delivery

*Added 2026-08-10. The tool enforced discipline on the repository's documentation and none on its own
release path — four versions shipped with no tag, and a version-string comparison that reported success
while fetching nothing.*

**D-1 · A runtime change bumps the version** — **P0 · Critical**
*`/plugin` compares one string, so a release that does not move it reaches nobody.*
Shipped. CI refuses any change under `scripts/ bin/ skills/ hooks/ plugins/ .claude-plugin/` without a higher
version. Verified by replaying the commit that motivated it: 37 shipped files, version unmoved, refused.

**D-2 · Documentation keeps itself current** — **P1 · High**
*A derived surface that refreshes only when someone remembers is a stale surface.*
Shipped. A write hook rebuilds the site after any `.md` write; a commit hook refuses a commit that would land
a blocking signal. Both default on, both switchable, both inert in a repository that never adopted the tool.

**D-3 · Which build is answering** — **P1 · High**
*Three versions were installed at once and nothing said so.*
Shipped. `atlas version` reports the running build, its path, whether it is a working copy or an installed
plugin, and every registration. A session-start notice prints one line when the install is behind.

**D-4 · `install.sh` compares versions** — **P0 · Critical**
*Shipped in 0.1.16.*
*It prints "already installed" and exits without checking what is installed.*
The same silent-gate shape D-1 fixed in CI, still live in the installer — and it is why the user-scope plugin
sat five releases behind while every command reported success. **Nothing else in this track reaches a user
until this is fixed.**

**D-5 · Tag the release when the version moves** — **P1 · High**
*Shipped in 0.1.17.* Sixteen tags existed and every one was typed by hand.
The first five were created retroactively; the rest were remembered, one release at a time, which is the
definition of a step that will eventually be forgotten. A CI job on push to `main`: if
`.claude-plugin/plugin.json` declares a version with no matching tag, create the annotated tag. The version
gate already proves the number moved; nothing marks the commit. **The figure is 30% because the tags exist
and the automation does not** — the visible symptom is fixed and the cause is not, which is exactly the state
this project distrusts most.

**D-6 · `atlas plan` — propose the route and wait** — **P1 · High**
*Shipped in 0.1.18.*
*The branch guard refuses a commit. Nothing proposes a route or waits for approval.*
Designed, not built. Reads the working tree, infers the type from the changed paths, requires a slug rather
than inventing one, states whether the change ships and therefore needs a version bump, and prints the route —
executing nothing without `--apply`. The PR rule is prose in CONTRIBUTING.md:88 and was bypassed three times
in one session with nothing objecting.

**D-7 · Daily work log** — **P2 · Medium**
*Shipped in 0.1.19.*
*`atlas sessions` computes friction and outcomes; nothing writes them down.*
`worklog/YYYY-MM-DD/` with git identity, tracked and excluded from the corpus. Aggregates and outcomes only —
no prompt text, keeping the guarantee `tokens.mjs` rule 3 makes and its test enforces. Prompt quality is not
scored: a transcript records what happened after a prompt, not whether the prompt was well judged.

**D-8 · The tool audits its own output** — **P0 · Critical**
*Shipped in 0.1.15.* `atlas build --verify`, and CI runs it.
*`atlas health` audits your markdown. Nothing audits what the generator produces.*
**Raised from P2. Six defects shipped in one afternoon and every single one was found by a human looking at
the rendered page:** an export that deleted the theme toggle while keeping its script; an update row that told
the reader to downgrade; a bundle that shipped every figure with none of its stylesheets, so the charts
vanished; 69 links pointing at files that do not travel with a single-file export; panels leaving holes the
height of their tallest neighbour; and a paragraph rendered as vertical strips because `.empty` was
`display:flex`. Each is now pinned by a test written *after* a screenshot arrived.

A `build --verify` pass — no duplicate ids, every scripted control rendered, every in-document link resolving,
every class the page styles present in its stylesheet — would have caught all six before anyone saw them. The
tool checks other people's documentation scrupulously and has never once looked at its own HTML.

**D-9 · The published export is the whole site** — **P1 · High**
*Shipped across 0.1.5–0.1.8.* One page of a ten-page site is not the site. `--page all` carries every page and
all 27 document pages in one 660 KB file with the menu, the stylesheets and every link working, plus an About
page and a build-time update row. Panels pack Pinterest-style rather than leaving holes.

**D-10 · An unadopted repository is told, not left guessing** — **P1 · High**
*Shipped in 0.1.10.* The hooks are inert without a config, deliberately — but inert and silent is
indistinguishable from broken, and read as broken in a repository holding 349 indexable markdown files. One
line at session start, narrow enough to stay quiet where it would be noise.

**D-11 · A shipped change names the item it advances** — **P0 · Critical**
*Shipped in 0.1.11.* The plan went stale twice because keeping it current was something to remember. The
commit hook now refuses a change under `scripts/ bin/ skills/ hooks/` whose message names no roadmap item, and
lists the open ones so the refusal is actionable from the message.

Deliberately the weakest useful rule: it enforces that the plan was **opened**, not that a percentage moved. A
machine cannot know whether `D-6` went from 0% to 40%, and a gate that guessed would either be wrong or train
people to type a number to get past it. A message it cannot read — `git commit -F -` hands the text to git on
stdin, where a hook cannot see it — is refused rather than skipped.

## Track 5 — Insight

*Added 2026-08-10. The dashboard reports what is measurable and stops there. What it does not do is tell a
reader what any of it means, which is the first thing anyone asks of it.*

**I-1 · An analysed homepage** — **P1 · High**
*Shipped in 0.1.12.* Two halves, deliberately separate.

A **mechanical** risk panel: six signals computed from the corpus and from `git log`, each carrying its
number, the band it is judged against, what it implies, and — where the figure is commonly over-read — what
it does not mean. Every threshold is a stated default, so a reader who disagrees can change it and the page
changes with it. A signal whose input is unavailable is omitted rather than shown as zero.

And a **narrative** rendered from `docs/ANALYSIS.md` when a repository has written one, absent otherwise. The
build never generates prose. That rule is what keeps the site byte-reproducible and keeps claims nobody
reviewed off a page people will quote.

**I-2 · Contributor and resource scorecard** — **P1 · High**
*Shipped in 0.1.14.*
*Throughput, rework, revert rate, spec coverage, bus factor and review latency, per contributor and per desk.*
Requested explicitly from an organisational perspective. **The weights live in the config, not in the code** —
a score the tool invents is unfalsifiable, and the first time someone disputes it there is no answer; a score
whose components and weights are declared can be argued with, which is the only kind worth publishing. Each
component states what it can and cannot support.

Prompt quality stays out of it, and that is not squeamishness: a transcript records what happened *after* a
prompt, not whether the prompt was well judged. In the session that produced this file the user interrupted
twice and was right both times, and caught six generated-output defects the tool missed. Every friction-based
scorer marks that as the user's failure. Interaction *outcomes* — rework after a session, turns to land,
corrections by hand — measure whether the collaboration worked, which is the question actually being asked.

**I-3 · Completed work visible on its own terms** — **P2 · Medium**
*Shipped in 0.1.19.*
*Done items are in the table and indistinguishable from a filter that hid them.*
All 20 items are listed and the Status column filters to `Done`, so the data is there; what is missing is a
deliberate control and a count, so "show me what landed" is one click rather than a filter someone has to
discover.

## Track 6 — Autonomy

*Added 2026-08-10. Everything the tool can already do, it does when asked. Each of those asks is a step
someone has to remember, and a step people forget is a surface that goes stale — which is the failure this
project exists to detect, reproduced in its own operation. Designed in
[`docs/references/autonomy.md`](references/autonomy.md); the boundary is that autonomy covers derived state
and stops at anything outward-facing.*

**A-1 · The autonomy switch** — **P1 · High**
*One `autonomy` config block, default on, with a single `enabled: false` that turns off every automatic
action. A feature that can only be disabled key by key is a feature nobody disables.*

**A-2 · Derived output maintains itself** — **P1 · High**
*Build, stats, worklog and analysis refresh when their inputs change, rather than when someone remembers.
All of it is derived and safe to delete, which is exactly what makes it safe to automate.*

**A-3 · Task list reconciliation** — **P2 · Medium**
*The plan and the task list drift apart silently. Reconcile them and report the difference, without editing
anyone's prose.*

**A-4 · SOP obligations** — **P1 · High**
*An SOP is wrong rather than stale when it drifts, so it carries an owner, a review interval and a
last-verified date. Three signals — H10 past review (blocking), H11 no live owner (advisory), H12 dead
citation (blocking).*

**A-5 · Branching posture: follow, warn, unfollow** — **P2 · Medium**
*`enforce` | `warn` | `off`, defaulting to `warn`. Unfollowing the strategy is allowed; unfollowing it
silently is not.*

**A-6 · Artifact publishing** — **P3 · Low**
*Generate the self-contained page automatically. Sharing it stays manual, because a shared artifact is
outward-facing.*

**A-8 · The dashboard tracks work as it happens** — **P1 · High**
*Completing or adding a task updates the dashboard immediately. Half of this already works — every page polls
a build stamp and `atlas watch` moves it — so what is missing is the trigger when no watcher is running: a
hook on the planning source alone, rebuilding the dashboard alone, detached so the edit never waits. That
reopens the `PostToolUse` decision this project made and reversed once; if a dashboard-only rebuild cannot be
made invisible, this stays with `atlas watch` and says so.*

**A-9 · Memory and handoff** — **P1 · High**
*A session ends and everything it learned that was not written down is gone; the next one rediscovers the
same traps by hitting them. [`handoff/SHARED.md`](handoff/SHARED.md) holds what cannot be derived — decisions taken, traps
paid for, work in flight — and the tool never generates it, because a machine can see that a commit happened
but not that a decision was argued and settled. `atlas handoff` prints the derived half as a prompt for a
human to write the rest. One signal, H13: the handoff names a commit far behind HEAD (advisory — a stale
handoff is a cost, not a hazard).*

**A-10 · Continuity: state that survives a termination** — **P0 · Critical**
*A handoff written at the end of a session is written exactly when it cannot be — the session that is killed,
compacted or interrupted never reaches its own last step. `.atlas/journal.jsonl`, append-only, one flushed
line per record, written by every agent as work happens and tagged with which agent wrote it, so a subagent's
findings outlive the subagent. `atlas note` appends; `atlas state` reconstructs. Enforced by `SubagentStop`,
`Stop` and `PreCompact` hooks, because an instruction to journal is advisory and a terminated agent reads
nothing. Never carries prompt text and is never published — the same rule `atlas tokens` already holds to.*

**A-11 · Handoff travels to the wiki, the journal never does** — **P2 · Medium**
*`HANDOFF.md` is part of the corpus and publishes with it. The journal is excluded by construction, the way a
token report is refused a path inside the output directory. The distinction is the point: curated prose is
for readers, an operational record is not.*

**A-12 · Contributor-scoped state** — **P1 · High**
*One `HANDOFF.md` and one journal are contention points the moment two people work in parallel — same file,
same conflict, and a merge between two people's half-finished thoughts. `docs/handoff/SHARED.md` holds what
constrains everyone; `docs/handoff/<contributor>/` and `.atlas/journal/<contributor>.jsonl` hold what only
helps that person resume. Separate files cannot conflict, which is what makes it scale to a team rather than
relying on discipline about who edits what. Identity reuses the key `atlas contrib` already groups by
(`scripts/lib/contrib.mjs:159`), and a slug collision is reported rather than silently merging two people.
Personal handoffs default to unpublished; a half-formed note should not reach a public wiki because someone
else ran a publish.*

**A-7 · The boundary holds** — **P0 · Critical**
*Tests that assert autonomy never pushes, never publishes, never rewrites prose and never acts on an
unadopted repository. The feature's whole risk is in its defaults, so the defaults are what gets tested.*

## Track 7 — Specification and consistency

*Added 2026-08-10. The design record is **detected and reported, never enforced and never authored** — a
missing HLD is a row that says "absent" and nothing more, and `atlas` has never written a design document in
its life. That gap is the track: make the record complete (PRD and a manual of style are not recognised at
all), make it enforceable where enforcement has no legitimate exception, and give the two audiences that read
it — architecture and delivery — a page each.*

**S-1 · PRD and the manual of style join the design record** — **P1 · High**
*`design.mjs:25` recognises HLD, LLD, architecture, data flow, decision records and specifications. It does
not recognise a PRD at all, and has no concept of a manual of style — the document that makes every other
document consistent. The SRS pattern is also weaker than it looks — it requires a `spec` or `srs` suffix
introduced by a dash or underscore, so it matches `payments-srs.md` but not `SRS.md` or `PROJECT_SRS_v1.md`,
and a repository can carry an SRS this tool reports as absent. Two new kinds, one corrected pattern, and a
test per shape.*

**S-2 · The design record is enforced, not only reported** — **P1 · High**
*Nothing in `health.mjs` references `designRecord`. A repository can ship for a year with every design
artifact missing and the corpus reports clean. Enforcement follows the rule the release and plan gates
already use — enforce only what has no legitimate exception: **H14** a design document cites code that has
moved (blocking, it is now wrong rather than merely old); **H15** an expected artifact is absent (advisory,
because a small repository legitimately has no LLD); **H16** a shipped area no design document cites
(advisory — `undesigned` already computes it and nothing acts on it).*

**S-3 · The blueprint — one page that assembles the design record** — **P2 · Medium**
*HLD, LLD, SRS, PRD and the style manual exist as separate documents and are read as separate documents, so
nobody holds the shape of the system in one view. A generated blueprint page assembles them in dependency
order with each section's freshness and citation health beside it. Generated, never authored: the words stay
in the source documents.*

**S-4 · A generated system prompt** — **P1 · High**
*`AGENTS.md` and each `SKILL.md` are hand-written and drift from the repository they describe — the same
failure this tool detects everywhere else, in the one document that tells an assistant how to work here.
`atlas prompt` emits a markdown system prompt assembled from what is actually true: the taxonomy, the
blocking signals, the branching convention, the release gate, the style manual, and the current state of the
plan. Opt-in, written to a path the user names, and regenerated rather than edited.*

**S-5 · Daily work log, per contributor, on the Delivery dashboard** — **P2 · Medium**
*`atlas worklog` writes `worklog/YYYY-MM-DD/log.md` — one file per day for the whole repository, which two
people writing on the same day contend for, and which no dashboard shows. Split it per contributor under the
same scheme as A-12, and add a `worklog` panel to the Delivery view so the record is read where delivery is
read.*

**S-6 · A backlog dashboard with the detail in it** — **P2 · Medium**
*The `items` panel is a sortable table embedded in other views: an id, a percentage and a summary clamped to
two lines by CSS. The full text of an item appears nowhere on the site, and no item links to the document
that specifies it. A dedicated Backlog view, in the nav beside the others, with an expandable detail per
task carrying three things it does not have today:*

- *the **whole description**, not the clamped summary;*
- *the **documents that specify it** — the HLD, LLD, SRS or PRD sections that define the work, resolved the
  way `crossref` already pairs documents rather than by hand-maintained links;*
- ***who worked on it**, derived from the commits that name the item. `coverage` already computes which items
  a commit named and reports a single count — the authors are in the same data and are thrown away.*

*Derived from git and the corpus, never typed: an item's contributor list that someone has to maintain is a
list that goes stale, which is the failure this whole tool exists to detect.*

**S-7 · The item model carries a description and its sources** — **P1 · High**
*Prerequisite for S-6, and the reason the backlog has nothing to show. `planning.mjs` parses an id, title,
percentage, status, track, priority and criticality out of the plan, plus a summary it truncates. It has no
field for a full description and no notion that an item is specified somewhere. Both must exist in the model
before any view can render them, and both must come from the markdown rather than a second store.*
