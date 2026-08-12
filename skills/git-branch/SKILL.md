---
description: "Every branch in this repository — where you are, what is safe to commit, which branches still hold work and which are merged and spent. Use when the user asks about branches, whether one is finished, or types /atlas:git-branch."
disable-model-invocation: true
---

# Where you are

!`atlas branch --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "you are on a safe branch".

# Every branch

!`atlas git-insights branches --no-color`

> **If the block above is empty**, the branch survey did not run. Say so. Reporting "one branch" because a
> command failed would be a count nobody took.

---

Lead with **the branch the user is standing on and whether it is safe to commit there.** Everything else is
context. If the first block reports a block-level problem, that sentence comes before any survey.

Then, in a few lines:

1. **What still holds work** — the `open` branches, with how far ahead of the default branch each is.
2. **What is finished** — the `spent` count, as a count. Do not list twenty-four branch names.
3. **Anything unmeasured** — a `?` in the ahead or behind column.

## The five states, and the two that get misread

- **`open`** — holds commits the default branch does not. This is work.
- **`spent`** — merged, zero ahead, and *behind* the default branch. The work landed; nothing unique is left.
- **`at-main`** — never diverged at all: the branch label sits on the same commit as the trunk. **Git calls
  this merged too, and it is not the same thing.** A branch created ten minutes ago has nothing on it, which
  is new, not finished. Never describe an `at-main` branch as done — a sibling session's working branch looks
  exactly like this.
- **`protected`** / **`current`** — self-explanatory, and both are excluded from the spent and stale lists.
- **`unread`, or a `?`** — the reading did not happen, because the survey caps its ahead/behind measurement
  and says where the cap fell. **It is not zero.** A branch reported as "0 ahead" that was never measured is
  how work gets deleted.

## Rules

- **This command deletes nothing, and does not print a command that would.** That is deliberate: these
  reports are built to be safe to run blind, including by something that acts on what it reads. If the user
  asks to clean up branches, tell them the tool will not, name the branches, and let them type it.
- **Stale is not a verdict.** A long-lived release branch and one somebody forgot look identical from here.
  Report the age; do not conclude from it.
- **Do not fetch.** Remote-tracking rows are as fresh as the last fetch *somebody else* ran, and this command
  does not run one. If the remote figures look wrong, say that they may be stale rather than refreshing them.

## How this differs from `atlas branch` alone

The first block is the commit guard: one branch, one question, non-zero exit when it is unsafe. The second is
the survey nothing else here does — what is true of *every* branch, which is the thing that accumulates
silently until nobody can tell which three of thirty still matter.
