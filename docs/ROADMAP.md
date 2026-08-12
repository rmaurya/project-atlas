# Roadmap — project-atlas

**Last updated:** 2026-08-12 · **Version:** 0.1.67 · **Status:** pre-release, dogfooding

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
| P-1 | 100 | P-2 | 100 | P-3 | 100 |
| P-4 | 100 | P-5 | 100 | P-6 | 100 |
| Q-1 | 100 | Q-2 | 100 | Q-3 | 100 |
| D-1 | 100 | D-2 | 100 | D-3 | 100 |
| D-4 | 100 | D-5 | 100 | D-6 | 100 |
| D-7 | 100 | D-8 | 100 | D-9 | 100 |
| D-10 | 100 | I-1 | 100 | | |
| I-3 | 100 | D-11 | 100 | I-2 | 100 |
| A-1 | 100 | A-2 | 100 | A-3 | 100 |
| A-4 | 100 | A-5 | 100 | A-6 | 100 |
| A-7 | 100 | A-8 | 100 | A-9 | 100 |
| A-10 | 100 | A-11 | 100 | A-12 | 100 |
| S-1 | 100 | S-2 | 100 | S-3 | 100 |
| S-4 | 100 | S-5 | 100 | S-6 | 100 |
| S-7 | 100 | M-1 | 100 | M-2 | 100 |
| A-13 | 100 | A-14 | 100 | A-15 | 100 |
| A-16 | 100 | A-17 | 100 | A-18 | 100 |
| A-19 | 100 | P-7 | 100 | P-8 | 100 |
| A-20 | 100 | A-21 | 100 | A-22 | 100 |
| A-23 | 100 | A-24 | 100 | M-3 | 40 |
| A-25 | 100 | A-26 | 100 | A-27 | 100 |
| A-28 | 100 | M-4 | 100 | A-29 | 100 |
| C-7 | 100 | C-8 | 100 | A-30 | 10 |
| C-9 | 100 | A-31 | 100 | | |

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

**C-7 · Git insight in the terminal** — **P2 · Medium**
*Shipped.* `atlas git-insights`, and six slash commands over it. `contrib` already read people, agents, desks
and churn; `changes` already read the working tree; `branch` already read where you are. What nothing read was
the repository's own shape: which files history keeps returning to, which files move together, what is true of
*every* branch, the rhythm, and whether the record is legible. `scripts/lib/gitinsight.mjs` computes those and
nothing else — the conventional-subject rate, the revert rate and the weekly aggregation are read from
`contrib.mjs` rather than counted a second time, because two answers to one question is the fork this tool
exists to detect.

*Four things it refuses to compute, each because the data cannot carry them.* **No combined risk score per
file** — commits, churn, authors and documentation coverage ship side by side, for the reason `contrib.mjs`
gives about people: collapsing them hides which one is driving, and the first person to dispute the total has
nothing to argue with. **No claim about code quality** — `git log` records that a file changed, never whether
the change was good. **No forecast** — there is no denominator for work nobody has written down, the argument
`inflight.mjs` makes for its own missing percentage. **No coupling below a stated support floor**, and above it
every pair still prints the raw number of commits it rests on; on a young repository "these two files change
together 100% of the time" means they were both in one commit, twice, and the report says `ANECDOTE, NOT
SIGNAL` in those words rather than leaving a reader to notice the sample size.

*Read-only is enforced, not promised.* One `execFileSync` in the module, an allowlist of verbs over it, and a
test that fails on a second call site. The branch report will not delete a branch **and does not print a
command that would** — these are the commands an agent runs blind, and a read-only report whose output is a
destructive command is read-only in name only.

*Two known duplications, both deliberate and both worth closing.* The zero-fill for silent weeks exists here
and as a private function in `dashboard.mjs`; the reverse citation index exists here and as a local `const`
inside `kb.mjs`. Neither is exported, both modules were owned by other work in the session that wrote this,
and re-deriving eight lines was the lesser evil against editing them. Hoisting one of each pair into a shared
helper is the follow-up.

**C-8 · Where the work lands** — **P2 · Medium**
*Shipped.* A Repository view. Delivery's unit of analysis is the commit and the person — how many, by whom,
in which week, with which model assisting — and not one of its eleven panels ever names a path. **Where** is
orthogonal to **when** and **who**, not a filter on them, and this tool had no page that answered it.

Six panels: tiles, where the churn lands by area, what the work keeps returning to, branches, in-flight and
caveats. The hotspot table carries **lines-per-commit** on every row, which is the column that separates a
version stamp touched seventy-one times two lines at a time from the test file touched seventy times at
eighty-five — Delivery ranks both by commit count and cannot tell them apart.

Staleness is measured against the repository's newest commit rather than the wall clock, so a rebuild an hour
later is byte-identical. "The areas holding half the churn" rather than a top-three share: no magic constant
to defend at any repository size.

*Four things it refuses.* **No weekly chart** — Delivery owns the time axis three times over; the fix went
there instead, where `velocityChart` had been plotting weeks by index so a silent fortnight closed into one
step while the rows still carried week labels. **No surviving-lines panel** — `surviving.mjs` is opt-in
precisely because blame runs to minutes, and this page builds on every `atlas watch`. **No hour-of-day
heatmap** — on a single-author repository that is a timesheet of one person. **No bus-factor number** where
there is one committer; the tile prints an em dash and says why.

**C-9 · Every capability reachable by hand** — **P2 · Medium**
*Shipped.* The CLI had thirty-three commands and thirteen slash commands over them. The twenty that were
missing were not the unimportant ones — `ownership`, `contrib`, `surviving`, `tasks`, `state`, `handoff`,
`note`, `sessions`, `tokens`, `worklog`, `caps`, `design`, `prompt`, `version`, `branch`, `community` — they
were simply the ones nobody had written a skill for. A capability an agent can reach and a person cannot is a
capability the person has to be told about, every time.

Sixteen new skills, and four existing ones amended. The amendment matters as much as the additions: with a
surface this size the failure is never a missing command, it is three commands a reader cannot tell apart. So
`status`, `changes`, `diff` and `help` now each carry a **nearest-neighbour** paragraph naming the commands
they are most likely to be confused with and saying which question each one actually answers — `/atlas:status`
is the corpus, `/atlas:tasks` is the plan, `/atlas:state` is the session.

`help` was rewritten as a map by intent rather than an alphabetical list, for the same reason.

*`docs/FEATURES.md` was re-verified against `skills/` on the day of this change by running every command in the
repository, and the Slash column now carries a dash with a stated reason wherever no command exposes a
capability — an absence that is explained is not an oversight.*

**C-11 · Fan independent work out, one worktree per agent** — **P1 · High**
*The skill tells a session to do independent work in parallel, and states the constraint that makes it safe.*

The instruction is cheap; the constraint is not, and it was paid for. Three subagents were run here against
one shared working tree and one shared `HEAD`. Nothing crashed and nothing warned: they all edited at once,
none of them committed, and the changes arrived interleaved with no record of whose was whose. Untangling it
took a full session — a 408-line diff in one test file, split by hunk and argued back to the branch each hunk
belonged on. The parallelism saved about an hour; the reconciliation cost a day.

So the rule is written as its reason rather than as an instruction to obey: `HEAD` is per worktree, an
uncommitted hunk has no author, the later write to a shared file wins silently, and an agent handed a tree it
does not recognise correctly refuses to commit it. One worktree per agent removes all four, because there is
nothing left to contend over — the same argument that produced one handoff directory per contributor.

Stated with its exceptions, because a default that never says "not this time" gets applied to work with a
genuine dependency chain and to two-file tasks where writing the briefs costs more than the parallelism saves.
Designed in [`docs/references/autonomy.md`](references/autonomy.md).

## Track 2 — Product

**P-1 · Core generation** — **P0 · Critical**
*Index, taxonomy, backlinks, search, document pages, health report.*
Built, tested, and dogfooded on a 387-file corpus.

**P-2 · Dashboard and deck** — **P1 · High**
*Charts, a sortable item table, and a browser slide deck from a markdown source.*

**The deck path has now run on real content.** For its whole life this repository had no `DECK.md`, so every
build printed *"Deck: none"* and the renderer was exercised only by three unit tests — the same shape as the
wiki drift path that went nineteen releases without touching a real wiki. `docs/atlas/DECK.md` is now a real
eleven-slide deck about the project, and it renders: title and section classes, presenter notes, the
overview list, the counter, and a print path.

*Remaining: slide-to-slide navigation is unconfirmed. Smooth scrolling does not animate under browser
automation, so every measurement of "did it advance" was meaningless — the counter moved and the view did
not, which looks exactly like a defect and is indistinguishable from the test harness. It needs one human
with the deck open and the arrow keys.*

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

**It serves. That was stated as an open item long after it stopped being one.** For several releases this
paragraph read *"GitHub Pages has never served this site"* and named an unset repository setting as the last
missing piece. Checked on 2026-08-11: `https://rmaurya.github.io/project-atlas/` returns **200** and serves
this project's own generated site, as do `health.html`, `dashboard.html`, `wiki.html` and `view-blueprint.html`.
The setting was evidently changed and nothing told the plan.

*Worth keeping as an entry rather than deleting, because of how it was found.* Nobody re-read this item; an
agent writing the README needed a live URL, tried the obvious one, and got a 200 back. The tool measures
documentation against **code**, and a claim about a hosting setting is outside everything it can check —
`git`, the corpus and the filesystem all agree with a sentence that the internet contradicts. That is the
shape of the drift this project cannot detect, and the reason the README now links the live site: a page
somebody clicks is a claim that gets tested.

**P-4 · The brand appears in what the tool generates** — **P2 · Medium**
*`assets/atlas-logo.svg`, `atlas-logo-dark.svg` and `atlas-mark.svg` exist and the palette they use is
already in the stylesheet as `--atlas-contour`, `--atlas-summit` and `--atlas-benchmark`. Nothing renders
them: `.brand` in the topbar is a text span, and every generated page is wordmark-free.*

*Four constraints decide the implementation, and three of them rule out the obvious approach:*

- ***Inline the SVG, never link it.*** *The single-file export, the published artifact and the wiki all
  forbid an external request — the artifact CSP blocks it outright. A `<img src>` would work locally and
  break in exactly the places the output is meant to travel to.*
- ***One themed mark, not two files.*** *Pages have three theme states, and the un-stamped one is the most
  common. A light/dark pair chosen at build time picks the wrong one for half of all viewers; an inline SVG
  drawn with the existing tokens follows the viewer's theme for free. The two exported variants stay as
  source-of-truth artwork rather than as what ships.*
- ***`#7FB3A8` has no token.*** *It appears in the artwork and in no palette. Either it earns a name or the
  artwork loses it — an unnamed colour in a themed system is the thing that later renders wrong in one mode.*
- ***The wiki cannot take inline SVG.*** *GitHub strips it from rendered markdown, so a wiki wordmark needs a
  committed image referenced by URL — a different mechanism from every other surface, and one that only works
  while the repository is public.*

*Also a favicon, as a `data:` URI, for the exported page and the artifact.*

**P-5 · The dashboard updates in place, and stops polling where it cannot** — **P2 · Medium**
*Today the page fetches `build-stamp.txt` every three seconds and, when it moves, calls `location.reload()` —
a full reload that discards scroll position, sort order, every column filter and the theme transition. Patch
the numbers instead: emit the dashboard's data as JSON beside the page, fetch it on change, and update only
the nodes whose values differ.*

***First, a defect that ships today.** `writeBuildStamp` runs only when a caller asks for live reload, so a
plain `atlas build` emits no stamp — but the poll is unconditional in the markup. Verified against the
published site: `build-stamp.txt` returns **404**, and every open tab requests it every three seconds
forever, roughly 1,200 requests an hour each, on a page that can never update. The poll must be emitted only
where something can answer it.*

***Where this works, and where it cannot — the answer to "is this achievable on a public URL":***

| Surface | Live patching | Why |
|---|---|---|
| `atlas watch`, local | **yes** | the stamp moves on every rebuild; this is the case worth optimising |
| A static host (Pages, S3, Netlify) | **yes, bounded** | JSON can be fetched and patched, but it only changes when the site is redeployed — freshness equals deploy cadence, so poll in minutes, not seconds, and use a conditional request rather than a timer |
| GitHub Wiki | **no** | markdown only; scripts are stripped |
| Single-file export | **no** | there is no second file to fetch — that is the point of it |
| Published artifact | **no** | the CSP blocks every external request by design |

*So the page must stay fully correct as static HTML and **upgrade** to patching only where a data endpoint is
reachable — the same shape as the existing export, which strips the poll rather than shipping a broken one.*

***Real-time is a different product.*** *Push (SSE or WebSocket) needs a server running somewhere, which
contradicts the zero-dependency, no-service promise this tool makes on its first page. "Live" here means
updating without a full reload when new data is published — not a socket.*

**P-6 · The backlog paginates, and hides what is finished** — **P2 · Medium**
*Shipped in 0.1.58.*
*The backlog is one page of 49 rows and 45 of them are done. The work someone opens it to see is five items
buried under everything already finished, and it gets worse with every item that lands.*

*Two controls, answering different questions:*

- *A **page size** — 10, 25, 50, all — because "show me everything" and "show me a screenful" are both
  legitimate and neither should be the only option.*
- *A **hide-done toggle**, separate from the Status filter. Status answers "show me exactly this state";
  hide-done answers "show me what is left", which is the question the page is actually opened with. Making
  someone express that as a status filter forces them to pick one of `Not started` or `In progress` and
  lose the other.*

*Three constraints, and the last is what makes this harder than it looks:*

- ***Paginate the filtered set, not the raw one.*** *Page 2 of a filter must be page 2 of what matched.*
- ***State survives a live update.*** *The page patches itself in place when a rebuild lands, and
  `readState`/`applyState` already carry the filters across that swap. Page number, page size and the
  toggle join them — otherwise a rebuild silently returns the reader to page 1, which on a live dashboard
  happens while they are reading it.*
- ***The count must say what it counts.*** *A footer reading "10 tasks" while 49 match, or while 45 are
  hidden, is a sample presented as a total — the quiet lie this project refuses everywhere else. It states
  the shown range, the matched total, and how many the toggle is hiding.*

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

**Q-4 · A signal that measures whether the advice was taken** — **P1 · High**
*H17: a session that made many edits and never delegated one. Advisory, and it measures the operator.*

An instruction nobody can check is a preference. C-11 tells a session to fan independent work out; H17 is the
number that says whether it did — 40 or more edits in one main thread with no subagent turn anywhere in it.

**Three properties are the whole design, and dropping any one of them makes it worse than nothing.** It is
**never blocking**: the blocking set is reserved for claims that the repository is *wrong*, and "you should
have parallelised" is advice about somebody's working method. Its own description states plainly that it
**measures the operator, not the corpus** — H1–H16 are settled by reading files, this one is not, and putting
it in the same table without saying so would be smuggling. And it reports **unevaluated, never "ok"**, when
there is no transcript to read, which is the rule A-29 was filed for.

The threshold is a stated default with its evidence in the signal's own text rather than a constant somebody
liked the look of: 40 is the 25th percentile of the edit counts of the sessions that *did* fan out, across
the 29 transcripts available when it was written. On that sample it fires twice, which is a note rather than
a nag.

**It does not read transcripts itself.** `atlas tokens` is the only thing that opens them — rule 1 of
`scripts/lib/tokens.mjs`, because those files hold every prompt that passed through a session — so the
aggregate is passed in by the caller and H17 is unevaluated until it is.


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
*Shipped in 0.1.50.*
*One config block, default on, with a single `enabled: false` that turns off every automatic action. A
feature that can only be disabled key by key is a feature nobody disables.*
Written as `automation.enabled` rather than the new `autonomy` block this item first specified: the config
already carried an `automation` block with the three switches and a validated key list, and a second block
governing the same three actions would have been two vocabularies for one thing — the drift this project
exists to detect. One resolver, `automationAllows(cfg, key)`, answers it for every call site, because a
master switch some code respects and other code ignores is worse than none: it is believed.

**A-2 · Derived output maintains itself** — **P1 · High**
*Shipped in 0.1.56.*
*Build, stats, worklog and analysis refresh when their inputs change, rather than when someone remembers.
All of it is derived and safe to delete, which is exactly what makes it safe to automate.*

**A-3 · Task list reconciliation** — **P2 · Medium**
*The plan and the task list drift apart silently. Reconcile them and report the difference, without editing
anyone's prose.*
*Closed in 0.1.61 — by configuring the mechanism that already existed, which was the finding.*
**No second mechanism was built.** H9 — cross-reference
asymmetry — does exactly this: an identifier present in one of a paired set of documents and absent from
the other. `atlas health` already reports *"No crossref pairs configured — H9 checked nothing"* on every
run. Building a second reconciliation beside it would be two mechanisms for one question, which is the
drift this tool exists to detect, committed by the tool.
The earlier reading — that this repository had no second list to pair — was wrong, and wrong in an
instructive way: it looked for a *task list* and missed the pair sitting in plain sight. **Every item
that ships should be named in the changelog**, so `docs/ROADMAP.md` and `CHANGELOG.md` are the pair.
Configured, H9 immediately reported **27 shipped items the changelog never named** — real drift, found
by a check that had been printing *"no crossref pairs configured"* on every run for its entire life.
The lesson is worth more than the fix: a check nobody configured is indistinguishable from a check that
passes, which is the same confusion `In progress (0)` and the Not-checked section both exist to prevent.

**A-4 · SOP obligations** — **P1 · High**
*Shipped in 0.1.60.*
*An SOP is wrong rather than stale when it drifts, so it carries an owner, a review interval and a
last-verified date. Three signals — H10 past review (blocking), H11 no live owner (advisory), H12 dead
citation (blocking).*

**A-5 · Branching posture: follow, warn, unfollow** — **P2 · Medium**
*Shipped in 0.1.56 — with `enforce` as the default, not the `warn` specified here.*
*The guard already existed and already refused. Shipping `warn` as the default would have silently removed
protection from every repository that upgrades, applied to people who never asked and would not be told —
the exact class of change this project exists to catch. Two existing tests encoded the old contract and
broke, which is how the deviation was noticed rather than absorbed. An off-convention branch *name* stays
advisory at every posture: blocking work over a name would make `enforce` unusable and teach people to
switch the whole posture off, taking the protected-branch guard with it.*
*`enforce` | `warn` | `off`, defaulting to `warn`. Unfollowing the strategy is allowed; unfollowing it
silently is not.*

**A-6 · Artifact publishing** — **P3 · Low**
*Shipped in 0.1.56.*
*Generate the self-contained page automatically. Sharing it stays manual, because a shared artifact is
outward-facing.*

**A-8 · The dashboard tracks work as it happens** — **P1 · High**
*Shipped in 0.1.54 — by the escape hatch this item named, not by the mechanism it proposed.*
The specified answer was a `PostToolUse` hook rebuilding the dashboard alone. This took the alternative the
item itself allowed: **make a watcher always be running**, so the "no watcher" case the trigger existed for
stops occurring. `atlas serve` starts one per repository at session start, detached, on a port derived from
the repository path, exiting after 30 idle minutes. That reopens no `PostToolUse` decision and adds nothing
to the edit path — the rebuild happens in a process the edit never waits on.
*What made it urgent was not the plan.* A frozen single-file export, served from a local port, was read as
the live dashboard for an entire session — and the tool said nothing, because a detached snapshot polls a
build stamp it can never reach and gives up silently. Both halves are fixed: exports now declare themselves
snapshots, and a live dashboard is something that is simply running rather than something to remember.
*Completing or adding a task updates the dashboard immediately. Half of this already works — every page polls
a build stamp and `atlas watch` moves it — so what is missing is the trigger when no watcher is running: a
hook on the planning source alone, rebuilding the dashboard alone, detached so the edit never waits. That
reopens the `PostToolUse` decision this project made and reversed once; if a dashboard-only rebuild cannot be
made invisible, this stays with `atlas watch` and says so.*

**A-9 · Memory and handoff** — **P1 · High**
*Shipped in 0.1.56.*
*A session ends and everything it learned that was not written down is gone; the next one rediscovers the
same traps by hitting them. [`handoff/SHARED.md`](handoff/SHARED.md) holds what cannot be derived — decisions taken, traps
paid for, work in flight — and the tool never generates it, because a machine can see that a commit happened
but not that a decision was argued and settled. `atlas handoff` prints the derived half as a prompt for a
human to write the rest. One signal, H13: the handoff names a commit far behind HEAD (advisory — a stale
handoff is a cost, not a hazard).*

**A-10 · Continuity: state that survives a termination** — **P0 · Critical**
*Shipped in 0.1.52.*
*A handoff written at the end of a session is written exactly when it cannot be — the session that is killed,
compacted or interrupted never reaches its own last step. `.atlas/journal.jsonl`, append-only, one flushed
line per record, written by every agent as work happens and tagged with which agent wrote it, so a subagent's
findings outlive the subagent. `atlas note` appends; `atlas state` reconstructs. Enforced by `SubagentStop`,
`Stop` and `PreCompact` hooks, because an instruction to journal is advisory and a terminated agent reads
nothing. Never carries prompt text and is never published — the same rule `atlas tokens` already holds to.*

**A-11 · Handoff travels to the wiki, the journal never does** — **P2 · Medium**
*Shipped in 0.1.56.*
*`HANDOFF.md` is part of the corpus and publishes with it. The journal is excluded by construction, the way a
token report is refused a path inside the output directory. The distinction is the point: curated prose is
for readers, an operational record is not.*

**A-12 · Contributor-scoped state** — **P1 · High**
*Shipped in 0.1.56.*
*One `HANDOFF.md` and one journal are contention points the moment two people work in parallel — same file,
same conflict, and a merge between two people's half-finished thoughts. `docs/handoff/SHARED.md` holds what
constrains everyone; `docs/handoff/<contributor>/` and `.atlas/journal/<contributor>.jsonl` hold what only
helps that person resume. Separate files cannot conflict, which is what makes it scale to a team rather than
relying on discipline about who edits what. Identity reuses the key `atlas contrib` already groups by
(`scripts/lib/contrib.mjs:159`), and a slug collision is reported rather than silently merging two people.
Personal handoffs default to unpublished; a half-formed note should not reach a public wiki because someone
else ran a publish.*

**A-13 · The plan marks itself in progress** — **P0 · Critical**
*Shipped in 0.1.55.*
*The one step in this project's SOP that depends on somebody remembering, and the evidence says nobody does:
A-7 was worked on for an hour while the table read 0%, and A-1 and A-10 were marked by hand only because a
complaint prompted it. An agent that forgets is not an unusual agent — it is the normal case, which is why
"mark it in progress" belongs in the tool rather than in prose nobody re-reads.*

*The enforcement point is where work demonstrably starts: `atlas branch`. Binding a branch to the item it
advances lets the tool set that item in progress itself, and lets the commit gate catch the contradiction it
cannot catch today — a commit shipping runtime code for an item still recorded as never started.*

***This is allowed to write to the plan, and the distinction matters.*** *Autonomy never rewrites prose,
because a machine cannot see that a sentence was meant. A percentage cell is not prose: it is a figure the
tool already parses with `percentCellPattern`, in a table whose format it defines. Rewriting one cell
deterministically is the same class of act as regenerating a dashboard — and the roadmap's own header says
that maintaining these figures by hand does not work.*

**A-17 · The dashboard recovers itself** — **P1 · High**
*Shipped in 0.1.59.* *The session hook starts the server and nothing brought it back if it later died — a
crash, a stray kill, an idle timeout, a sleeping machine. The failure is silent in the worst way: the page in
front of someone keeps looking like a dashboard while serving nothing, which is exactly the confusion this
project already spent a session chasing. Every markdown write now also ensures it is up (idempotent, cheap
when it already is, backgrounded so no edit waits), and the session hook prints the URL so the link is
surfaced without anyone asking for it.*

**A-18 · The design record can be started, never written** — **P1 · High**
*Shipped in 0.1.60.* *The Architecture page reported eight artifacts absent and offered no way to close the
gap — accurate and useless in equal measure. Generating the documents was rejected: a design document is a
set of claims about what the code is **for** and what was **rejected**, and generated claims nobody reviewed
would land in the corpus every other check measures drift against, so the repository would begin lying to
its own health report.*
*What is actually hard is knowing which questions each document owes an answer to, and that is a template.
`atlas design --scaffold` writes them. The safety is a **third state**: `absent` / `stub` / `written`. A
scaffold never counts as a design record, because converting an honest absence into a false presence is
worse than the gap — an absence is visible, a false presence is trusted. Nothing removes the stub marker
automatically; a tool that cleared it would be asserting the document had been written.*

**A-19 · One doorway to every dashboard** — **P2 · Medium**
*Shipped in 0.1.61.* *A hand-written link to one project's dashboard is wrong the moment you switch
projects — and silently wrong, because it opens a real dashboard belonging to something else, which is the
exact failure this project spent a session chasing. `atlas serve --launcher` generates a page listing every
project atlas knows about, each with the port derived from its own path. Published as an artifact it becomes
a permanent entry in the editor's footer.*
***It states that it cannot check.*** *An artifact runs under a policy that blocks outbound requests, so the
page cannot know whether a server is up and does not imply it — a status dot it could not have earned would
be the same lie as a build stamp nobody checked. What it can rely on is that a port is a pure function of a
repository path, so a recorded link stays correct for that checkout whether or not the server is running.*

**P-8 · Charts whose job is identity** — **P2 · Medium**
*Shipped in 0.1.62.* *Contribution, effort, weekly rhythm and plan composition, as donuts, lines and stacked
areas. This required the first categorical palette in the project — the design note in `dashboard.mjs` said
there was none "because there is no chart whose job is identity", which was true until a contributor
breakdown existed.*
***The palette was computed, not chosen.*** *Both sets were run through the validator against their own
surface; the first two candidates failed (a teal reading as grey on light, two steps outside the band on
dark). Dark is a separate selection, because flipping the light set failed immediately. Adjacent tritan
separation on dark is ΔE 3.8, below the safe floor — legal only with secondary encoding — so every slice is
direct-labelled and the labels are load-bearing rather than decorative.*
*Three refusals are the point: a breakdown of one contributor prints the name and the number instead of a
circle labelled 100%; a gap in a series breaks the line rather than being drawn through, because a straight
segment across a gap claims nothing happened; and untagged work is its own slice rather than dropped, since
dropping it would make the tagged remainder look like the whole.*

**P-7 · Every signal, including the ones that found nothing** — **P2 · Medium**
*Shipped in 0.1.61.* *The signal catalogue lived only on the Health page, one navigation away from the page
people keep open, so "what can go wrong in this repository" was something you had to go and ask for. It is
now a panel on the dashboard and the QC view.*
*Signals that fired zero times are listed too, and that is the point: a catalogue showing only what is
currently wrong cannot distinguish "this check passed" from "this check does not exist here". `ok` is a
result; absence is not. A signal that could not run says so, and is never reported as clean.*

**A-16 · The reasoning behind a decision outlives the session that made it** — **P1 · High**
*Shipped in 0.1.59, with one part deliberately not built the way it was specified.*
*The item said "surface it on the Architecture view". The Architecture view **publishes** — to a wiki, to
Pages, into a shared artifact — and A-11 draws the line that the journal never travels. Embedding journalled
decisions there would publish the journal through the back door: worse than not shipping the panel, because
it breaks a boundary quietly, in the one place a reader would not look for the breach. So the panel carries
the **written** decision record, which is curated prose somebody wrote for readers, plus a **count** of
decisions the journal holds that the written record does not — a statistic, carrying none of the words.
That count is the useful half anyway: "twelve decisions were made and three are written down" is drift,
reported the way this tool reports every other kind, with the fix left to a person.*
*The journal already records that a decision was taken (`kind: decision`), and `atlas state` reads it back.
What it does not do is keep the **reasoning** anywhere a reader will find it later: a record saying "chose X"
answers what, and the expensive question is always why — because the next person's instinct is to undo it,
and they will, unless the argument against is written where they are standing.*

*Three parts, and the third is the one that makes it worth building:*

- ***Capture is already free.*** *`atlas note decision "…"` exists and agents already call it. What is
  missing is a place for the argument: what was chosen, what it rules out, what was tried first and why it
  failed. That is a second field, not a second mechanism.*
- ***Surface it on the Architecture view***, beside the design record it explains. Architecture answers
  "how is this built"; the decisions are why it is built that way, and separating them is how a design
  document ends up describing a shape nobody can justify.*
- ***Link each decision to what it touched.*** *A decision carries `refs` — files, commits, plan items —
  and those already resolve to pages elsewhere in the site. A decision floating free of the code it governs
  is an anecdote; one linked to the file it constrains is a warning the next reader actually receives.*

***The tool must never write the reasoning.*** *Same boundary as `HANDOFF.md`: a machine can see that a
choice was made, not what was argued and settled. It prompts, groups, links and surfaces — the words stay
whoever's they were. A generated rationale would be exactly the confident unreviewed prose this project
exists to detect, attached to the decisions people trust most.*

*Distinct from a formal ADR directory, which `design.mjs:31` already recognises. An ADR is a document
somebody sat down to write; this is the reasoning that accumulates during the work and is otherwise lost
when the session ends. A project with both should have them agree — which is a crossref pair, and therefore
already H9's job.*

**A-20 · A journal record must not name an agent that never ran** — **P2 · Medium**
*Shipped in 0.1.64.* *The hook now reads `hook_event_name` off the payload — that one field, piped
straight into the record so a transcript path is never even held in a variable — and believes what it
observed rather than the argument it was passed. When no event name can be read it records the boundary
with **no actor at all**: "a session boundary was crossed", which is true, rather than naming a subagent,
which was not. An unattributed true statement beats an attributed false one. Why the original session saw a
`SubagentStop` without a subagent was never established, and no longer needs to be — the hook believes the
payload either way.*
*The continuity hooks recorded `a subagent finished on main at b23b05f` in a session where no subagent ran.
The boundary event is real — something fired `SubagentStop` — but the sentence attributes it to an actor
that does not exist, and a record whose whole value is being trustworthy cannot carry an attribution nobody
checked.*
*Not patched blind. The hook takes the event name as an argument and cannot see what the harness actually
fired, so the fix needs to establish which event occurs when — guessing would replace a wrong record with a
differently wrong one. Until then the record stays as written, because deleting it would hide the evidence
the fix depends on.*

**A-21 · The dashboard stays up for as long as the session does** — **P1 · High**
*Shipped in 0.1.63.* *The server exited after thirty idle minutes, and "idle" was measured correctly — an
open tab polls its build stamp, so no requests really does mean no reader. What it does not mean is that the
work stopped. A session spent talking, writing code or running tests never fetches the dashboard, so the
link printed at session start went dead partway through **with nothing saying so** — the silent failure this
whole feature exists to remove, reintroduced by its own safety valve.*
*Two changes. `on-activity.sh` revives it on any tool use, not only a markdown write, guarded by a pidfile
check that costs ~22ms when the server is already up — without that guard it would fork after every tool
call, which is worse than the bug. And the idle window is four hours rather than thirty minutes: long enough
to outlast a working session, short enough that a machine left overnight is not still serving.*

**A-22 · Two builds of different versions must not share an output directory** — **P2 · Medium**
*Shipped in 0.1.64.* *The crux turned out to be that the two builds never overlap in time — they take
the lock politely, in turn — so the lock file is always gone by the time the other looks. Only a record that
**outlives** the lock can see the disagreement, so the holder's version and path are written to
`.atlas/build.owner.json` and deliberately not deleted on release. It reports and proceeds: whose build
should win is the user's call, and refusing would break the exact case where someone is testing a working
copy.*
***It cannot fire against a build that predates it.*** *The older build never writes the owner record, so
the newer one sees itself as last holder and stays silent — including for the 0.1.62-versus-working-copy
collision that motivated the item, which cost an hour of this session. Inherent rather than a gap: an old
build cannot announce what it does not know about.*
*A-14's lock serialises builds, which is the right fix for two copies of the same build. It cannot tell two
**different** builds apart: the installed plugin's watcher and a working-copy build both hold the lock
legitimately, take turns, and overwrite each other's output. A branding fix appeared not to work three times
in a row because the 0.1.62 watcher was rebuilding over it seconds later.*
*The lock should record which build holds it and say so when the answer changes — "your working copy is
building into a directory an installed 0.1.62 watcher is also writing" is a sentence that would have saved
the whole detour. Stopping one of them is the user's call, not the tool's.*

**A-23 · A dashboard nobody was told about was never delivered** — **P0 · Critical**
*Shipped in 0.1.65.* *Three repositories were adopted in one afternoon. All three servers started
themselves and answered on their derived ports, and no session ever printed a URL — so as far as the person
who asked for a knowledgebase could tell, the feature had not run at all. The autonomy worked; the hand-over
did not exist.*
*The cause is that `on-session-start.sh` was the only place in the whole tool that named the link, and it
requires `project-atlas.config.json` to exist **at session start** — which is precisely false on the run
that adopts the tool, because that run writes the config. Every other path that starts a server did so with
`>/dev/null 2>&1`. The one session where somebody is waiting to see what they just built is the exact
session that was told nothing.*
*So the announcement now follows the **session** rather than the server: `on-activity.sh` tells any session
that has not heard the URL, whichever path brought the server up, exactly once. A marker holding the session
id is what keeps "once" honest — a line repeated after every tool call is a line people stop reading, which
costs it the one moment it needed to be read. And `knowledgebase/SKILL.md`, which never mentioned
`atlas serve` at all, now ends every run with the link; a first run that reports `docs/_wiki/index.html` and
stops has named a file, not handed over a dashboard.*

**A-24 · A server that cannot bind must not linger** — **P1 · High**
*Shipped in 0.1.65.* *Ten server processes were found on one machine, against four repositories. Four of
them belonged to a single repo and only one held a port.*
*`startServer` set `process.exitCode` on `EADDRINUSE` and returned — and setting an exit code is not
exiting. `watch --serve` ran on into its polling loop, so every loser of a race for a port stayed alive
indefinitely: serving nothing, invisible to `--status` because it never wrote a pidfile, and **still
rebuilding the output directory on every change**. That is what A-22's build-owner warning had been
reporting all along; the duplicate builds it named were these.*
*Two fixes. A server that cannot bind exits, because it has no remaining job. And `atlas serve` stops
treating a missing pidfile as proof that nothing is running — the machine-wide registry is a second record,
keyed by live pid rather than by a file this repository may have lost, and when it names a server for this
root that still answers, the claim is restored instead of a rival being stood up one port higher.*

**A-25 · The dashboard could not see the work the session was doing** — **P0 · Critical**
*Shipped in 0.1.66.* *Three times in one afternoon the owner pointed at a page reporting a finished project
while sitting beside a session with seven open items, and each time the answer was that the task list is not
in the repository. That answer was true and useless. A-22's panel had already reasoned its way to leaving it
out — "not in the repository, cannot be verified from it" — which is the right constraint and the wrong
conclusion: **"I cannot verify that data" is a reason to get it onto disk, not a licence to render a page
that is confidently wrong.***
*So `on-task.sh` appends one record per task change to `.atlas/tasks-live.jsonl`, the same append-only shape
the journal uses and for the same survives-a-kill reason, and the panel replays it. Nothing reaches into the
harness; the harness writes to the repository, which was always allowed. Statuses are shown as recorded and
never re-derived from the diff — inferring "done" from a finished-looking file is the guess the panel exists
to avoid.*
***The second half was the one that had been missing.*** *Data on disk would still have looked frozen,
because nothing rebuilt on a task change — `on-write.sh` fires for markdown only. The hook rebuilds detached,
and the open page picks it up through the stamp it already polls.*

**A-26 · Every page linked its own source, and the link 404'd** — **P1 · High**
*Shipped in 0.1.66.* *Each derived page opens with "Source: `docs/references/authoring.md` — edit that file,
not this one". The href is relative to the repository root: correct from the filesystem, dead through the
server, which hosts the output directory while the source sits above it. The banner's only job is to send a
reader to the file they should edit, so it was failing at it on every page, silently, since the server
existed.*
*The fix is not a path rule. Serving "anything under the root" would trade one broken link for a loopback
file browser over `.env` and `.git`; what is served is the exact set of documents the build indexed, written
to `sources.json` and re-read per miss so a document added by the watcher resolves without a restart.
Verified: the failing link returns 200, `package-lock.json` and `.git/config` still 404.*

**A-31 · A rebuild the open page cannot see is worse than no rebuild** — **P1 · High**
*The hooks added for A-25 ran `atlas build --auto --quiet` without `--stamp`.* Every build clears the output
directory before writing it, so a rebuild with no stamp **deletes** the `build-stamp.txt` that `atlas serve`
wrote and nothing replaces it. The open page polls that file, gets a 404, gives up after three misses, and
then sits there looking exactly like a live dashboard displaying an hour-old figure.

*The failure is worth stating precisely, because it is the one this whole surface exists to remove and the fix
for it is what reintroduced it.* A dashboard that is obviously down gets reloaded. A dashboard that is silently
frozen gets believed. Every build since the hooks landed had been quietly disarming the reload it was firing.

*Both hooks now pass `--stamp`.* The general lesson is that the stamp is not a detail of `serve` — it is the
contract between any writer of the output directory and any page holding it open, and a command that clears
that directory is a writer whether it means to be or not.

**A-27 · A dashboard people leave open should say when now is** — **P3 · Low**
*Shipped in 0.1.66.* *Local time and UTC in the header — local for the reader, UTC because every stamp this
tool writes is UTC and comparing them should not require arithmetic. Rendered by the browser, never by the
build: a baked timestamp would break byte-identical rebuilds and would be wrong within a second and stay
wrong for as long as the page was open, which is the same class of lie as a frozen dashboard.*

**A-28 · The Executive view was the least readable page in the site** — **P2 · Medium**
*Shipped in 0.1.66.* *Its promise is "the few numbers that survive summarising" and it carried the in-flight
panel: a twenty-row table of paths and line counts, the tallest thing on the page, squeezed into one masonry
column with its columns clipped. Meanwhile the one view with both a plan figure and a delivery figure had no
picture of either — the audience least able to spend time reading was handed the most prose. The file table
comes off, the charts go on, and the headline tile still says how many files are in flight and links to the
view that lists them.*

**A-29 · The tool's own documentation had drifted from the tool** — **P1 · High**
*Shipped in 0.1.67.* *Eight claims in this corpus were contradicted by the code, and all eight were found the
same way: an agent told to verify before writing, doing so. Nine rot signals in `SKILL.md` and both manifests
when sixteen ship. Two hooks in `hooks/README.md` when there are eight entries across six events. An
`autonomy.md` opening that still called a shipped subsystem "not yet built". A P-3 paragraph naming an unset
Pages setting as the last missing piece, while the site returns 200. A hook comment quoting an idle window
A-21 changed four releases ago. `/atlas:ask` broken since M-2 gave two features one command name. Six of the
eight cluster ids the shipped views reference missing from the taxonomy, leaving their document panels
empty.*
***The pattern is worth more than the list.*** *Every one sits in a place no signal reaches — a count in
prose, an opening paragraph, a code comment, a hosting setting, a command name shared by two handlers, a
cluster id referenced in code and defined in config. H1 through H16 check links, titles, citations and dates:
the things that can be compared mechanically. None of these could be, and none of them was noticed by the
tool that exists to notice this. The corpus was internally consistent throughout.*
*What generalises: `SKILL.md` is the highest-cost instance, because it is read by an agent in every
repository, and it had been describing a different tool for seven releases. The narrow lesson is that a count
stated in prose beside a list that grows is a defect waiting to happen. The broad one is that "the
documentation is clean" and "the documentation is true" are different claims, and this tool only measures the
first.*

**A-30 · Rename notation reaches `areaOf` as though it were a path** — **P2 · Medium**
*Open.* `git log --numstat` writes a rename as `ROADMAP.md => docs/ROADMAP.md` in the path column.
`contrib.mjs::readContrib` keeps that column verbatim, so `areaOf` reads the arrow and everything around it as
a directory name and manufactures areas that have never existed. Fourteen records produce five fictional ones
here, and **`atlas ownership` ships them today as bus-factor-1 risks** — the exact output C-6 exists to make
actionable, naming directories nobody can go and look at.

Resolve in `contrib.mjs`, at the read, so every consumer is fixed at once — `ownership`, `kb.mjs` and the
Repository view each bucket on `areaOf` and each is wrong in the same way. The local `unrename` added in
`dashboard.mjs` for C-8 is a stopgap and should be deleted in the same change.

*The open question is whether history should follow renames at all.* Without `-M`, a moved file reads as two
shorter histories, so a file's true churn is split across its old and new home and neither figure is the one a
reader wants. Turning it on changes every number on two shipped pages, which is why this is a plan item rather
than a patch.

**A-7 · The boundary holds** — **P0 · Critical**
*Shipped in 0.1.55.*
*Tests that assert autonomy never pushes, never publishes, never rewrites prose and never acts on an
unadopted repository. The feature's whole risk is in its defaults, so the defaults are what gets tested.*

**A-14 · Two builds must not fight over the output directory** — **P1 · High**
*Shipped in 0.1.58.*
*A consequence of A-8, found twice in the session that shipped it. A watcher now always runs, so a build
started by hand races the one the watcher is already doing: the output directory is cleared and repopulated,
and whichever build looks at it mid-clear sees a directory with content but none of its markers and refuses.
The guard is right to refuse — it cannot tell a half-written build from someone's real files — so the fix is
not to weaken it but to stop the two builds overlapping. A lock, held for the length of a build and released
whether it succeeds or not, with a waiter that gives up rather than blocking forever.*

**A-15 · A server the tool cannot see is a server it cannot stop** — **P1 · High**
*Shipped in 0.1.58.*
*`serve --status` reported "Not running" while a detached server was alive and rebuilding, because status is
read from a pidfile and the pidfile was gone. The process outlived its own record, which is the orphan the
idle timer exists to bound — but a 30-minute bound is not the same as being able to answer the question.
Status should probe the derived port as well as the pidfile, and report the disagreement plainly: something
is serving here and this repository did not record starting it. A tool that says "not running" about a
running process teaches people to stop believing it.*

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
*Shipped in 0.1.64.* *One page, in dependency order — requirements before the design that satisfies
them, not the `EXPECTED` order that hands a reader the LLD before the thing it is detail of. **Every field
is read off a document**: its path, its own headings, its opening paragraph verbatim, its git date, its
citation health. The only thing the assembler contributes is the order.*
*A scaffold is never laid out in the shape a written document gets: no quote, no contents list, and the
section says the substance is owed. A stub's opening paragraph is the template warning about itself, and
reprinting it under a heading would put boilerplate where a reader expects the system's own account. This
repository's real page says so today — 0 written, 8 scaffolded — which is the honest state rather than a
page pretending to be a design record.*
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

## Track 8 — Integration

*Added 2026-08-10. Everything this tool knows is reachable through one CLI and one generated site, both of
which assume a person is present. The request behind this track was "let other local software talk to Claude
Code" — and that turns out to be two different mechanisms pointing in opposite directions, which is why it is
two items rather than one. Specifying the wrong one is the expensive mistake here: an MCP server does not
let anything drive a session, and no amount of implementing it would deliver what M-2 describes.*

**M-1 · atlas as an MCP server** — **P2 · Medium**
*Shipped in 0.1.64.* *Seven read-only tools over stdio — health, plan, search, changes, contrib,
design, state — returning the derived data as structure rather than terminal output formatted for a person.*
***The dependency was declined deliberately, as this item required.*** *The protocol surface actually needed
is `initialize`, `tools/list`, `tools/call` and one notification over newline-delimited JSON-RPC: about one
file. `@modelcontextprotocol/sdk` would have been this project's first runtime dependency, bringing a
version to track and an install step to a tool whose distribution story is "clone it and run it with Node".
The cost is named rather than hidden: when the protocol revises, that file is ours. The version is pinned
and echoed back, so a client negotiating something else is told plainly.*
*Direction: an agent asks atlas. MCP servers expose tools that a client — Claude Code, Claude Desktop, any
MCP-speaking editor — decides to call. So this makes the corpus queryable in-session without shelling out:
`atlas_health`, `atlas_plan`, `atlas_search`, `atlas_changes`, `atlas_contrib`, each returning the same
derived data the CLI prints, as structured results rather than parsed stdout. The value is that an assistant
working in a repository can ask "what is failing and which document cites it" as a tool call, and get the
answer atlas already computes rather than a re-derivation from `grep`.*

*Two constraints this must respect, both of which the CLI already holds to. **Read-only**: no tool publishes,
pushes, or writes prose — the same boundary Track 6 draws, and the reason a server is safe to expose at all.
**Zero-dependency is a real cost here**: `@modelcontextprotocol/sdk` is the official implementation and
would be this project's first runtime dependency, against a stdio JSON-RPC loop that is small enough to
write by hand. Decide that deliberately and record the decision, rather than adding a dependency because a
package existed.*

**M-2 · Driving a session from local software** — **P3 · Low**
*Shipped in 0.1.64, at the narrow scope this item argued for.* *`atlas ask <task>` answers one question
as JSON with a meaningful exit code: **0** answered and clean, **1** answered and something blocking, **2**
could not answer. That 1/2 split is the whole value — a tool that exits non-zero for both tells a pipeline
"the documentation is broken" when the truth was "atlas could not run", and only one of those is a real
finding.*
*It does not drive a session, and the file says so: that is the Agent SDK, and a general-purpose agent
runner inside a documentation tool would be two products sharing a package. Building it revealed a defect
worth the exercise — pointed at a directory that never adopted the tool, it scanned everything beneath and
reported **1,389 findings** as though that were a corpus. A number CI would have failed on, about files
that were never documentation. It refuses with exit 2 now.*
*Direction: software drives Claude Code. This is what the original request described — send instructions,
take an update, send input, get output — and **it is not MCP**. MCP has no channel for an outside process to
start work, steer it mid-run, or read its output; the client always initiates. The mechanisms that do this
are the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`) and headless `claude -p`,
neither of which atlas currently touches.*

*Scoped low deliberately, and it may not be atlas's job at all. Atlas is a knowledgebase over a repository;
a session driver is a different product that would happen to live in the same package. The plausible
version is narrow — a thin wrapper that runs an atlas-shaped task headlessly and returns structured output,
so CI or a local tool can ask for a health report or a publish dry-run without a terminal. Anything wider
than that is a general-purpose agent runner wearing this project's name.*

**M-3 · The control plane belongs outside this tool** — **P2 · Medium**
*Designed, not built here. [`agent-control.md`](references/agent-control.md).*
*The request that produced this item was to give the MCP server full control so an external orchestrator
could drive development through it. **That cannot be built**, and the reason is the same one M-1 and M-2 both
recorded: MCP runs client → server, so a server publishes tools a client chooses to call and has no channel
to start work, steer a run, or answer a question. Built literally, the request yields a corpus server with
its read-only guarantee deleted and none of the control anyone asked for — which is the failure `mcp.mjs`
names in its own header.*
*The capability is real and lives on the Agent SDK, so the two planes are drawn apart rather than merged:
the orchestrator drives sessions, and those sessions call this tool's read-only server through
`options.mcpServers`. The corpus stays queryable from inside a driven run without the server gaining any
ability to drive one, and the test asserting no handler reaches a writing module keeps passing.*
***The one detail that decides whether the safety story survives automation:*** *`canUseTool` is not invoked
for auto-approved tools, so a refusal implemented only there has a hole precisely where it matters — the
configuration that makes a run autonomous is the configuration that skips the check. The push and publish
refusals must be a `PreToolUse` hook, which runs first and fires on every call, with a deny rule behind it
and a test that fails when the hook is removed. An untested refusal is a claim.*
*The runner itself is not built here, for the reason M-2 already gave. What this project owes an external
driver is the contract, and that is what the reference document is.*

**M-4 · The derived layer, in markdown, for an agent with only Read and Grep** — **P1 · High**
*Shipped.* *`scripts/lib/kb.mjs` writes `<output>/kb/` on every build: an entry point, a node page per
document, cluster pages, and an orientation layer — architecture, rules, routes, vocabulary, health, plan,
resume. Interconnected with working relative links, and carrying no document prose.*

***The gap was measured, not assumed.*** *A 403-document repository built 417 files, every one of them HTML,
and had no `.mcp.json`. So an agent could read all 403 sources and reach **none** of the analysis: the
taxonomy, the link graph, backlinks, whether a citation still resolves, the health findings, which commits
name a plan item, what the last session was doing. Both channels this tool offers — a browser and
[M-1](#track-8--integration)'s server — assume something the working case does not have. The third channel
is the one every agent always has, and it was the one the tool never wrote to.*

**The constraint is the feature, and it is the only way this could have gone wrong.** The derived markdown
carries relationships and derived facts; **every explanation is a link**. A second set of `.md` files holding
the same sentences is the forked document this project exists to detect, and it would not be excused by one
of them being generated — an agent would grep, find two copies, and have no way to tell which is
authoritative. So node pages state path, title, cluster, status, version, date, git last-touched, headings
with line numbers, links out, backlinks, citations and their resolution state, findings, and the plan items
that name the document. Excerpts are prose and are emitted nowhere, including from `blueprint()`, which
offers one.

*The guard that was actually needed was not the obvious one.* `scan.mjs::fieldValue` is deliberately loose,
and on the first build it read the sentence *"**Date every page, and re-stamp when you revise.** An undated
page…"* out of `docs/references/authoring.md` as that document's date and printed a hundred and ten
characters of its advice onto the node page. A scraped field is now quoted only when it has the shape of the
thing it claims to be, and a value that fails is reported as unquotable rather than dropped.

*Three boundaries are held rather than described.* **Journal text never appears** — `resume.md` carries
counts, kinds, timespans, agents and refs, because the tree is written into a publishable directory and a
page quoting a record would route around `assertUnpublished` instead of breaking it. **No handoff is
authored** — the page routes to `SHARED.md` and each contributor's `HANDOFF.md`, reports how far HEAD has
moved past the commit each names, and says plainly when there is none. **No working-tree state** — a dirty
count baked into a file is wrong within a second and stays wrong, which is the frozen-clock argument
`render.mjs` already makes; `atlas state` is named as the live reading instead.

*It lives inside the output directory rather than beside it, and that is not a filing preference.
`prepareOutputDir` clears exactly one directory, and its two guards have already stopped `{"output":"."}`
from deleting a repository. Anything written outside that directory is never cleared, so a renamed document
would leave a node page behind for ever and the stale page would be indistinguishable from a live one —
which would end the sentence the whole safety argument rests on, that you can delete the output and rebuild.*

*Nothing is reimplemented. `buildPrompt` is embedded verbatim in `rules.md` rather than restated,
`blueprint()` orders the design record, `taskCoverage` supplies the commits naming each plan item, and
`undesigned` supplies the coverage inversion. The one thing computed here that nothing computed before is
the **reverse citation index**: code file → the documents that cite it, which is the direction of the
question an agent about to change a file actually has.*
