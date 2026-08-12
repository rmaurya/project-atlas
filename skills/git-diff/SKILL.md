---
description: "One file's diff read against its own history — what changed, how often this file changes, and which files usually move with it but have not this time. Use when the user asks what a change looks like in git terms, or types /atlas:git-diff."
argument-hint: <path>
disable-model-invocation: true
---

# The diff

!`atlas diff $ARGUMENTS`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the file is unchanged". With no path given the command
> lists what there is to ask about instead, which is not an empty block either.

# The same change, against history

!`atlas git-insights change --no-color`

> **If the block above is empty**, the history read did not run. Say so, and do not conclude that nothing
> habitually changes alongside this file.

---

Explain the change **and what history says about it**. Do not paste the diff back — the user can see it.

1. **What the change does**, in plain language. Not "modified line 40"; what behaviour changed.
2. **How settled this file is.** The second block prints how many prior commits touched it. A file with
   forty-four is a file the project keeps returning to; a file marked `new` has no history to read at all.
   Say which, in one clause.
3. **What usually moves with it and has not.** This is the reason to run this rather than `/atlas:diff`.
   Name the strongest one or two, with the support count: "`tests/run.mjs` moved with this file in 29 of its
   32 commits and is untouched."
4. **Whether the change looks complete** — a fix with no test, a new export nobody calls, a documented
   behaviour that just changed.

## Reading the coupling honestly

- **Support first, percentage second.** The output prints both because the percentage alone is unreadable on
  a young repository: three co-occurrences out of three is 100% and means nothing.
- **These are questions.** "Did you mean to leave X out?" — never "you forgot X". Coupling is correlation over
  a small window, and the window is printed in the output.
- **A partner that no longer exists is already excluded**, as is any pair below the stated support floor. If
  the section reports no partners, that is a measurement, not a silence.

## How this differs from `/atlas:diff`

`/atlas:diff` reads a diff as **documentation review**: does this citation resolve, is the date re-stamped, is
this a second copy of something that exists. It is the right command for a markdown change.

This one reads the same diff as **repository history**: how often this file moves, and what moves with it.
Reach for it on a code change, before a commit, when the question is "have I missed something".

**If no path was given**, the first block listed the files worth asking about. Offer them; do not pick one.
