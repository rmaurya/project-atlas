# Roadmap — project-atlas

**Last updated:** 2026-08-10 · **Version:** 0.1.6 · **Status:** pre-release, dogfooding

Open work, with an honest completion figure against each item. A figure marked `*` is estimated rather than
measured against the code — the same distinction the tool preserves everywhere else, applied to itself.

> **This file went stale for 35 commits.** Every item in Track 1 was delivered while the table still read 0%,
> and the dashboard said so the whole time: *Spec to build — named by a commit: 0 of 12*. Nobody read it. The
> tool detects documentation drift and its own plan was the drifted document. Track 4 exists because of that.

| Item | % | Item | % | Item | % |
|---|---|---|---|---|---|
| C-1 | 100 | C-2 | 100 | C-3 | 100 |
| C-4 | 100 | C-5 | 0* | C-6 | 0 |
| P-1 | 100 | P-2 | 90 | P-3 | 70* |
| Q-1 | 100 | Q-2 | 30* | Q-3 | 0 |
| D-1 | 100 | D-2 | 100 | D-3 | 100 |
| D-4 | 0 | D-5 | 0 | D-6 | 0 |
| D-7 | 0 | D-8 | 0 | | |

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
*Lines added is a poor measure; lines that survived is the closest honest one available.*
A `git blame` pass, capped and opt-in because it is slow on a large repository. Reported beside the other
measures, never combined into a score.

**C-6 · Bus factor and ownership** — **P3 · Medium**
*Which areas have exactly one author who has ever touched them.*
Derivable from the history already being read.

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
All three stage correctly and refuse to push without `--push`. `--page all` now carries every page in one file
with the navigation working, which is what makes the Artifact path useful. Remaining: the drift **import**
path has still never run against a real edited wiki, and GitHub Pages has never served this site — the
workflow builds and uploads, but the repository's Pages source is not set to GitHub Actions.

## Track 3 — Quality

**Q-1 · Test suite** — **P0 · Critical**
*173 integration tests against throwaway git repositories, no mocks.*
Every bug the tool has shipped is pinned by a test that fails without its fix.

**Q-2 · Defaults that fit real repositories** — **P1 · High**
*The shipped taxonomy is tuned for product repos and fits tool repos badly.*
Running `init` on this repository matched 1 of 9 default clusters. Found by dogfooding.

**Q-3 · CI on a matrix** — **P2 · Low**
*CI runs on Node 20 and Linux only.*
Windows path handling is unverified: the code normalises to posix separators throughout, but no test has run
there.

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
*It prints "already installed" and exits without checking what is installed.*
The same silent-gate shape D-1 fixed in CI, still live in the installer — and it is why the user-scope plugin
sat five releases behind while every command reported success. **Nothing else in this track reaches a user
until this is fixed.**

**D-5 · Tag the release when the version moves** — **P1 · High**
*Six versions shipped and the first five tags were created by hand, retroactively.*
A CI job on push to `main`: if `.claude-plugin/plugin.json` declares a version with no matching tag, create the
annotated tag. The version gate already proves the number moved; nothing marks the commit.

**D-6 · `atlas plan` — propose the route and wait** — **P1 · High**
*The branch guard refuses a commit. Nothing proposes a route or waits for approval.*
Designed, not built. Reads the working tree, infers the type from the changed paths, requires a slug rather
than inventing one, states whether the change ships and therefore needs a version bump, and prints the route —
executing nothing without `--apply`. The PR rule is prose in CONTRIBUTING.md:88 and was bypassed three times
in one session with nothing objecting.

**D-7 · Daily work log** — **P2 · Medium**
*`atlas sessions` computes friction and outcomes; nothing writes them down.*
`worklog/YYYY-MM-DD/` with git identity, tracked and excluded from the corpus. Aggregates and outcomes only —
no prompt text, keeping the guarantee `tokens.mjs` rule 3 makes and its test enforces. Prompt quality is not
scored: a transcript records what happened after a prompt, not whether the prompt was well judged.

**D-8 · The tool audits its own output** — **P2 · High**
*`atlas health` audits your markdown. Nothing audits what the generator produces.*
Two defects shipped inside one hour because of this: an export that deleted a control while keeping its
script, and an update row that told the reader to downgrade. Both were caught by tests written afterwards. A
`build --verify` pass over the generated site — no duplicate ids, every scripted control present, no dead
in-document link — would catch the class rather than the instances.
