# Roadmap — project-atlas

**Last updated:** 2026-08-10 · **Version:** 0.1.33 · **Status:** pre-release, dogfooding

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
| A-7 | 0 | A-8 | 0 | | |

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
Built. Remaining: the two-column layout is verified on desktop only — the tablet breakpoints rest on standard
media queries but have not been checked in a real viewport.

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

**A-7 · The boundary holds** — **P0 · Critical**
*Tests that assert autonomy never pushes, never publishes, never rewrites prose and never acts on an
unadopted repository. The feature's whole risk is in its defaults, so the defaults are what gets tested.*
