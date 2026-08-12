---
description: Who did what, from git history alone — commits, lines, active days, AI-assisted share, rework and revert rates, and which plan items no commit names. Use when the user asks about contributions, delivery or velocity, or types /atlas:contrib.
disable-model-invocation: true
---

# Contribution history

!`atlas contrib`

> **This section is empty** when there is no git history to read, or when `atlas` is not on `PATH` — the
> plugin is not installed where this is running. If the block above is empty, say which of the two it is
> before saying anything about contributions.

---

Everything above came from `git log`. No transcript, no timer, no prompt text.

Lead with the **outcomes** block and the **spec → build coverage** block. The counts above them are context;
those two are the only parts that can change what anyone does next.

**Read the caveats out loud rather than around them:**

- **Estimated hours are a floor derived from commit rhythm**, not time worked. Thinking, reading and reverted
  work leave no commit. Never present the figure as effort, and never divide anything by it.
- **There is no combined score and no leaderboard**, by design. If the user asks for one, say the tool refuses
  to build it and why: a single number over commits, lines and hours ranks people on the three things easiest
  to inflate.
- **Rework rate counts a file re-touched within three days.** On a repository under active construction it is
  supposed to be high — iteration reads identically to churn from the outside, and this measure cannot tell
  them apart.
- **The AI-assisted share is read from `Co-Authored-By:` trailers.** A commit without one is counted as
  unattributed, not as human. Untagged desks are stated separately for the same reason.

**Spec → build coverage is the finding worth acting on.** An item the plan records as done that no commit
names is either work that landed under another id or a percentage somebody typed optimistically. It is worth
a look, not an accusation — say it that way.

If this repository has one committer, say so once and drop the per-person table: a table of one is noise
dressed as analysis.

**Nearest neighbour.** Three history commands, and the difference is what they count. `/atlas:contrib` counts
**commits** — activity over time, including work later deleted. `/atlas:surviving` counts **lines still in the
tree today** — what remains, saying nothing about who wrote what was removed. `/atlas:ownership` counts
**authors per area** — not volume at all, but what happens if one of them stops.
