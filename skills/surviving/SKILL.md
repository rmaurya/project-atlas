---
description: Surviving lines per author — how much of what somebody wrote is still in the tree today, from git blame. Use when the user asks whose code is still standing, or types /atlas:surviving.
disable-model-invocation: true
---

# Surviving lines

!`atlas surviving`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing survives".

---

This is a blame census of the current tree: every line that is in the repository right now, attributed to
whoever last touched it. It is the one contribution measure that ignores history entirely.

**Lead with what it excludes, because the number invites the wrong reading:**

- **Deleted work counts for nothing here**, and deletion is often the best thing anyone did all week. A
  refactor that removed two thousand lines shows up in this report as its author losing two thousand lines.
- **It is not a quality measure.** A line nobody has revisited may be load-bearing, or may be in a corner
  nobody reads. Survival distinguishes them not at all.
- **Last touched is not authored.** A formatting pass, a rename or a licence-header sweep reattributes every
  line it walks, and this report cannot see the difference.
- **It is never combined with anything.** No score, no ranking against commits or hours. It is reported beside
  the other measures precisely so it cannot be read as a total.

The footnotes matter as much as the table: binary files this cannot measure, and uncommitted lines that belong
to nobody until they are committed, are both counted and stated rather than dropped.

**If the repository has one committer, this report is a single row at 100%.** Say that in one line. There is
no analysis to add and reciting the count implies one.

**Nearest neighbour.** `/atlas:surviving` counts **lines still in the tree** — the present. `/atlas:contrib`
counts **commits over the period** — the history, including everything since removed. `/atlas:ownership`
counts **authors per area** — not volume at all, but who would have to be asked. The three disagree on
purpose; a repository where they agree has had exactly one contributor.
