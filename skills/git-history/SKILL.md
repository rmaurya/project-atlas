---
description: "How this repository commits over time — week-by-week rhythm, and whether history is legible: conventional subjects, prose bodies, plan references and trailers. Use when the user asks about pace, activity, commit quality, or types /atlas:git-history."
disable-model-invocation: true
---

# Cadence

!`atlas git-insights cadence --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "no activity".

# Commit hygiene

!`atlas git-insights hygiene --no-color`

> **If the block above is empty**, the hygiene pass did not run. Say so rather than reporting rates of zero —
> a check that could not run has not been passed.

---

Two questions: **how often work lands, and whether the record of it is readable a year from now.**

One screen:

1. **The span and the shape** — first commit to last, how many weeks had any commit, the median active week.
   With the sample size attached, always.
2. **The weakest hygiene rate**, quoted with its denominator.
3. **One thing to change about the next commit.** Not a policy document — the next commit.

## Reading cadence honestly

- **Silent weeks are drawn as zero, not as unknown, and the count of filled weeks is printed.** That
  distinction is load-bearing: git history is complete over its own range, so a week with no commits is a week
  that was examined and had none. It is a measurement. Say the filled count if the user asks why the chart has
  gaps.
- **There is no trend line and no forecast, deliberately.** Over a short span the direction reverses on the
  next commit. **Do not compute one yourself** — "commits are down 40%" over four weeks of a nine-week-old
  repository is arithmetic wearing a conclusion's clothes, and it is exactly the invented signal this tool
  exists to keep off a page.
- **Commits per active day is a rate over days that had a commit**, and both terms are printed. Never restate
  it as a rate over calendar days.

## Reading hygiene honestly

- **Every rate carries `n of m`. Quote both.** "62%" is not a finding; "79 of 127 commits name a real plan
  item" is one, and it means something different across 30 commits than across 300.
- **A prose body means prose.** Trailers alone do not count — every commit here ends with `Co-Authored-By:`
  and `Desk:`, and counting those as documentation would report a perfect score produced by a convention that
  has nothing to do with what is being measured.
- **`names a real plan item` differs from `names any XX-0 token`.** The first is checked against the planning
  document; the second only matches the shape. If no planning source is configured the strict figure reads
  `—`, which is unread, not zero.
- **`Co-Authored-By:` and `Desk:` cannot be added to history afterwards.** A low rate is a fact about commits
  already made and is not fixable — say so, and point the advice at the next commit instead.
- **"Large" is a printed threshold, not a verdict.** A commit touching forty files may be a rename sweep, a
  generated-output refresh, or a genuinely unreviewable change, and nothing in `git log` tells them apart. The
  list is *the biggest commits*, which is a fact. It is not *the bad ones*.

## How this differs from its neighbours

- **`/atlas:contrib`** is the people axis: who committed, which models assisted, which desks, estimated hours,
  rework and revert rates. If the question is *who*, send them there — and remember there is deliberately no
  combined score and no leaderboard.
- **`/atlas:git-hotspots`** is the file axis of the same history.
- **`/atlas:status`** answers where the project stands against its plan, which none of this does.
