# Roadmap — docs-atlas

**Last updated:** 2026-08-09 · **Version:** 0.1.0 · **Status:** pre-release, dogfooding

Open work, with an honest completion figure against each item. A figure marked `*` is estimated rather than
measured against the code — the same distinction the tool preserves everywhere else, applied to itself.

| Item | % | Item | % | Item | % |
|---|---|---|---|---|---|
| C-1 | 60 | C-2 | 0 | C-3 | 0 |
| C-4 | 0 | C-5 | 0* | C-6 | 0 |
| P-1 | 100 | P-2 | 90 | P-3 | 40* |
| Q-1 | 100 | Q-2 | 30* | Q-3 | 0 |

---

## Track 1 — Capability

**C-1 · Contribution analytics on the dashboard** — **P1 · High**
*The engine reads people, agents, desks, estimated hours and outcome rates from git; only the CLI surfaces it.*
`atlas contrib` works and is tested. What is missing is the dashboard panel: velocity by week, model mix over
time, rework and revert trend, and spec-to-build coverage. The data is already computed — this is presentation.

**C-2 · Role-scoped views** — **P1 · High**
*One dashboard serves nobody in particular; six audiences want six different first screens.*
QC (health, rework, revert), product (progress, scope), delivery (throughput, risk), architecture (drift,
never-started specs), developer (my files, bus factor, stale-near-me), executive (portfolio, leverage).
Config-driven panel selection over the same derived data — **not** six hand-written pages, which would fork.

**C-3 · Selectable themes with a one-click toggle** — **P2 · Medium**
*Light and dark are generated, but the viewer cannot choose; they get whatever the system says.*
A high-contrast soft light palette and a high-contrast neon dark one, toggled by an icon, persisted, defaulting
to the system setting. The three-state token structure must survive, and both ramps must clear the palette
validator against their own surfaces. **Do not eyeball contrast.**

**C-4 · GitLab support** — **P2 · Medium**
*Publishing assumes GitHub. GitLab wikis are also a `.wiki.git` repo, but Pages is a CI artifact, not a branch.*
Detect the host from the remote rather than assuming.

**C-5 · Surviving-lines analysis** — **P3 · Low**
*Lines added is a poor measure; lines that survived is the closest honest one available.*
A `git blame` pass, capped and opt-in because it is slow on a large repository. Reported beside the other
measures, never combined into a score.

**C-6 · Bus factor and ownership** — **P3 · Medium**
*Which areas have exactly one author who has ever touched them.*
Derivable from the same history already being read. Useful to a developer and to a delivery manager for
different reasons.

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
All three stage correctly and refuse to push without `--push`. The drift **import** path — copying hand-edited
wiki pages back out for review — is written but has never run against a real edited wiki.

## Track 3 — Quality

**Q-1 · Test suite** — **P0 · Critical**
*66 integration tests against throwaway git repositories, no mocks.*
Every bug the tool has shipped is pinned by a test that fails without its fix.

**Q-2 · Defaults that fit real repositories** — **P1 · High**
*The shipped taxonomy is tuned for product repos and fits tool repos badly.*
Running `init` on this very repository matched **1 of 9** default clusters — `references/`, `SKILL.md` and
`AGENTS.md` fall through. Found by dogfooding, which is the argument for dogfooding.

**Q-3 · CI on a matrix** — **P2 · Low**
*CI runs the suite and the tool against itself on Node 20 and Linux only.*
Windows path handling in particular is unverified: the code normalises to posix separators throughout, but no
test has ever run there.
