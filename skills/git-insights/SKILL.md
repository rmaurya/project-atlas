---
description: "Everything git history says about this repository — hotspots, coupling, branch health, cadence and commit hygiene, in one read-only report. Use when the user asks what the history shows, where the risk is, how the project has been going, or types /atlas:git-insights."
disable-model-invocation: true
---

# Git insight

!`atlas git-insights --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the history is clean".

---

Six sections ran above. **Read them all, report one screen.**

The order to say it in:

1. **One line of shape** — commits, span, active weeks, local branches. What kind of repository this is.
2. **The single strongest finding**, named with its number and its denominator. One. Not a tour of six
   sections — the report is already the tour.
3. **The one thing worth doing about it**, with the command.

Then stop.

## What each section is for, and how to read it honestly

- **Hotspots** — where change concentrates. Commits and churn are printed side by side and are *never*
  combined into a score; they disagree usefully, and a config touched forty times for one line each is not
  the same object as a module rewritten twice. The finding worth reporting is a busy file marked `(uncited)`:
  nothing in the corpus explains it, so a newcomer has only the code.
- **Coupling** — files that keep changing together. **Check the window line before you quote a percentage.**
  If the header says `ANECDOTE, NOT SIGNAL`, say that out loud rather than repeating the number; below the
  stated floor these pairs are two files that landed in one commit twice. Every pair prints its raw support
  count for exactly this reason.
- **Branches** — `spent` means merged with nothing unique on it. `at-main` means never diverged, which is new
  work, not finished work. `?` means never measured — it is not zero, and treating it as zero is how a branch
  gets thrown away.
- **Cadence** — shape, not trend. **Do not extrapolate.** There is no forecast in the output because there is
  no basis for one, and inventing "at this rate" is the failure this whole tool exists to prevent.
- **Hygiene** — every rate carries its denominator. Quote both. "62%" alone is not a finding; "79 of 127
  commits name a real plan item" is.
- **This change, against history** — the coupling partners you have *not* touched. These are questions, not
  defects. Ask; do not assert.

## Rules

- **Never restate a truncated list as a total.** Every cap in that output is printed next to what it capped.
  Carry it: "the twelve busiest of 141", not "the twelve busiest files".
- **`?` and `—` are unread, never zero.** A section that says a check did not run has not said the check
  passed.
- **This is read-only and it says so.** Nothing above fetched, checked out, pruned, deleted or configured
  anything, and it will not offer to. If the user wants a branch deleted, that is theirs to type.

## Which command they wanted

- `/atlas:status` — the **documentation** state and the plan. Different question entirely.
- `/atlas:changes` — what *you* changed and which documents cite it.
- `/atlas:git-status` — the working tree in git terms, no corpus.
- `/atlas:git-hotspots`, `/atlas:git-branch`, `/atlas:git-history` — one section each, when this is too much.
