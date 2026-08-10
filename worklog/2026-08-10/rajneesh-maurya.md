# 2026-08-10 — Rajneesh Maurya

_Written by `atlas worklog`. Measured from git and the corpus; no prompt text, and nothing here scores how anyone worked._

## What landed

| | |
|---|---|
| Commits | 60 |
| Lines | +8,206 / −904 |
| Desks | atlas |
| Rework rate | 80% — a file re-touched within 3 days |
| Reverts | 0 |
| Documentation | 0 blocking finding(s) at end of day |

## Plan items advanced

- **D-11** A shipped change names the item it advances — 100%
- **I-1** An analysed homepage — 100%
- **D-2** Documentation keeps itself current — 100%
- **D-1** A runtime change bumps the version — 100%
- **I-2** Contributor and resource scorecard — 100%
- **D-8** The tool audits its own output — 100%
- **D-4** `install.sh` compares versions — 100%
- **D-5** Tag the release when the version moves — 100%
- **D-6** `atlas plan` — propose the route and wait — 100%
- **D-7** Daily work log — 100%
- **Q-3** CI on a matrix — 100%
- **C-6** Bus factor and ownership — 100%
- **C-5** Surviving-lines analysis — 100%
- **Q-2** Defaults that fit real repositories — 100%
- **P-3** Publishing — 100%
- **P-2** Dashboard and deck — 100%
- **C-2** Role-scoped views — 100%
- **D-3** Which build is answering — 100%
- **A-1** The autonomy switch — 0%
- **A-8** The dashboard tracks work as it happens — 0%
- **A-9** Memory and handoff — 0%
- **A-12** Contributor-scoped state — 0%
- **S-1** PRD and the manual of style join the design record — 100%
- **S-7** The item model carries a description and its sources — 100%
- **P-4** The brand appears in what the tool generates — 0%
- **P-5** The dashboard updates in place, and stops polling where it cannot — 100%
- **S-6** A backlog dashboard with the detail in it — 100%
- **S-2** The design record is enforced, not only reported — 100%

## Commits

- `9c9f15a` chore(release): a shipped change that never moves the version reaches nobody
- `6c065a9` chore(ci): the dogfood step asked init to overwrite a config it is built to protect
- `7b95952` docs(layout): the reference guides sat at the repository root, where nobody looks for them
- `5a8fcfe` feat(automation): the site regenerated only when someone remembered, which is how documentation rots
- `ac73b0f` feat(version): nothing could tell you which build was answering, and three were installed
- `ec96510` fix(export): the standalone file deleted the theme toggle and shipped its script anyway
- `b31309c` feat(export): one page of a ten-page site is not the site
- `fcd5c02` docs(roadmap): the plan went stale for 35 commits while the dashboard said so
- `4403e28` fix(export): the bundle carried the numbers and left the charts behind
- `8ac95d9` fix(views): a grid reserved the tallest card's height for every card beside it
- `4c1df93` fix(skills): the guard asked you to approve a call it existed to prevent
- `a997451` feat(adoption): a plugin that deliberately does nothing still has to say so
- `e08b2b8` docs(roadmap): it went stale again, six releases after being rewritten for going stale
- `daed90b` feat(spec): work that names nothing is work the plan cannot see (D-11)
- `24be0fc` feat(insight): the homepage stated figures and drew no conclusion from any of them (I-1)
- `b7ceddb` fix(skills): fixing one block and leaving six with the same shape is not a fix (D-2)
- `0549f02` chore(release): 0.1.13 shipped as 0.1.12 because a semicolon is not an ampersand (D-1)
- `cfd8151` feat(score): a score you can argue with, and the date the page lost (I-2)
- `af0d1f2` feat(verify): the tool checked everyone's documentation except its own output (D-8)
- `55d947a` fix(install): 'already installed' is not 'current' (D-4)
- `a370867` chore(ci): sixteen releases, sixteen tags typed by hand (D-5)
- `ca82722` feat(plan): every guard here refuses after the decision; none proposed a route (D-6)
- `523b980` feat(worklog): the day scrolled off the terminal, and completed work hid in plain sight (D-7)
- `3ec6796` chore(ci): nineteen releases claiming Windows support, none tested there (Q-3)
- `92f7903` feat(ownership): bus factor for a repository is a fact; per area it is a decision (C-6)
- `7725ef0` feat(surviving): the only contribution number that cannot be gamed by volume (C-5)
- `a7c6a98` feat(taxonomy): the defaults said 'uncategorised' about the repos this ships into (Q-2)
- `57b8cd6` test(publish): the drift guard was never once run against an edited wiki (P-3)
- `e6c4676` fix(views): masonry reintroduced the hole it was added to remove (P-2)
- `7816603` feat(views): QC saw a rework rate and never what was covered (C-2)
- `4994db1` fix(update): the notice was silent because the install had overtaken its own cache (D-3)
- `37164c0` fix(skills): the fallback that made them safe made them unrunnable (D-2)
- `bfd907e` feat(version): nothing said which build the SESSION loaded, only which was installed (D-3)
- `c290782` fix(config): a custom exclude list silently dropped every default added since (Q-2)
- `d83c900` fix(caps): the wiki read as ready while publish refused to touch it (P-3)
- `6304d01` fix(ci): Windows failed every run, and never once for the reason under test (Q-3)
- `59fae84` fix(windows): the three defects the matrix was added to find, found (Q-3)
- `ef2552b` fix(windows): a test that copies the logic it tests agrees with the bug (Q-3)
- `2934eb9` fix(caps): a cached "no wiki yet" outlived the wiki it described (P-3)
- `399765a` docs(roadmap): autonomy, designed before it is built, with the boundary stated (A-1..A-8)
- `f2434ea` docs(handoff): the taxonomy looked for HANDOFF.md and this repository never had one (A-9)
- `9c9dc56` fix(publish): the writer emitted page names its own reader refuses (P-3)
- `b36e260` fix(render): the navigation was unreachable on a phone and nothing looked wrong (P-2)
- `fcc0d39` docs(handoff): one file for everyone is a merge conflict waiting for a second person (A-12)
- `f100e51` feat(roadmap): the design record is reported and never enforced (S-1..S-7)
- `4d1b418` chore(release): distribution was the whole working tree, and shipped a work log
- `a55d399` chore(release): drop the distribution mirror — its target no longer exists
- `ddeba5a` docs(roadmap): the brand exists in assets/ and appears in nothing generated (P-4)
- `c813e83` docs(roadmap): the dashboard reloads the whole page, and polls a 404 to decide when (P-5)
- `2849253` docs(deck): the deck renderer had never rendered a deck (P-2)
- `8400d1e` feat(dashboard): update in place, and stop polling a file that will never exist (P-5)
- `cb4b0b0` feat(planning): an item had no description and no idea where it was specified (S-7)
- `2af0db8` feat(backlog): a page that shows the task, not a row about the task (S-6)
- `dfe456d` fix(backlog): a description's links are relative to the plan, not to the page (S-6)
- `d57630d` chore(config): personal handoffs are in the repository, not on the wiki (A-12)
- `0226aca` feat(backlog): rows are accordions, closed, and descriptions get the whole width (S-6)
- `4688400` feat(health): the design record was detected, charted, and never enforced (S-2)
- `5713ab9` feat(pages): the deployed site can update itself, and the backlog gains filters (P-5, S-6)
- `40c201b` fix(backlog): the filter row took a whole phone screen before the first task (S-6)
- `7f77898` feat(design): a specification named SRS.md was reported as absent (S-1)

---

_Not recorded here: prompt text, prompt quality, or difficulty. A transcript records what happened
after a prompt, not whether the prompt was well judged, and a turn on a hard problem and a turn on
a typo count the same._
