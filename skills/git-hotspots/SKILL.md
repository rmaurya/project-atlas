---
description: "Where change and risk concentrate — the files history keeps returning to, the files that change together, and how many people know each area. Use when the user asks where the risky code is, what to test hardest, what to document first, or types /atlas:git-hotspots."
disable-model-invocation: true
---

# Hotspots

!`atlas git-insights hotspots --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "no file is a hotspot".

# Coupling

!`atlas git-insights coupling --no-color`

> **If the block above is empty**, the coupling pass did not run. Say so. "No hidden dependencies" is a
> conclusion, and an empty block is not evidence for it.

# Who knows each area

!`atlas ownership`

> **If the block above is empty**, the ownership read did not run. Say so rather than reporting a bus factor
> nobody measured.

---

Three readings of one question: **where would a change go wrong, and who would have to fix it.**

Give the user one screen:

1. **The two or three files that matter**, with both numbers — commits *and* churn. They are printed side by
   side and are never combined, because they disagree usefully: a manifest touched seventy times for two
   lines each is a different object from a module rewritten twice.
2. **The strongest coupling pair**, with its raw support count.
3. **The one area with a bus factor of 1 that also appears in the hotspot list.** That intersection is the
   finding — busy code only one person has ever touched. Neither list alone says it.

Then name **one** action. Not a list.

## Reading it honestly

- **`(uncited)` means no document in the corpus cites that file.** It is a candidate for a page, not a defect.
  Markdown is excluded from that list on purpose — an orphaned document is `atlas health`'s finding, under its
  own name, and repeating it here under a second name is how a corpus forks. Generated files are *not*
  excluded, because nothing in git history distinguishes a derived manifest from a hand-written module. Some
  of those rows want no page at all; say so rather than proposing twelve documents.
- **Check the coupling window line before quoting any percentage.** If it says `ANECDOTE, NOT SIGNAL`, lead
  with that. Below the stated floor a pair is two files that landed in one commit three times.
- **Large commits are excluded from coupling and the count is printed.** A rename sweep would otherwise be the
  loudest signal on the page. If that exclusion count is high, the pairs rest on less history than the total
  commit count suggests — say which number the pairs actually rest on.
- **Deleted paths are excluded and counted.** A file that dominated history and no longer exists is history,
  not current risk.
- **Bus factor is authors who ever committed, not a judgement of the code.** On a young single-author
  repository "bus factor 1" everywhere is a fact about its age. Say that plainly instead of raising an alarm.
- **There is no risk score, and do not invent one.** Four numbers side by side is deliberate: collapsing them
  hides which one is driving, and the first person to dispute the total has no way to argue with it.

## Caps

Every list above prints what it capped and out of how many. **Carry that.** "The twelve busiest of 141 files"
is the finding; "the twelve busiest files" is a truncated list presented as a total, which is the one thing
this project refuses everywhere.

## How this differs from its neighbours

- **`/atlas:health`** finds defects in the documentation — dead links, duplicate titles, orphans. Hotspots are
  not defects and never appear there.
- **`/atlas:git-history`** is the time axis of the same history: rhythm and commit hygiene, not files.
- **`/atlas:git-status`** applies the coupling data to the change in front of you right now.
