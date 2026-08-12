---
description: "Where this working tree stands in git terms — branch safety, staged and unstaged work, and what history says about the files in play. Use before committing, when resuming work, or when the user types /atlas:git-status."
disable-model-invocation: true
---

# Branch

!`atlas branch --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "you are safe to commit".

# Working tree

!`atlas changes --no-index --no-color`

> **If the block above is empty**, the command did not run. Say so. An empty section here is not
> "the tree is clean" — `atlas changes` prints `Nothing changed.` when it means that.

# These files, against history

!`atlas git-insights change --no-color`

> **If the block above is empty**, the history read did not run. Say so; do not conclude that nothing
> usually changes alongside what the user touched.

---

Answer in this order, one screen:

1. **Is it safe to commit here?** If the branch check reports a block, that is the first sentence and the
   only one that matters until it is resolved. The user is about to commit to a protected branch.
2. **What is unsaved.** Staged and unstaged, separately. It is the only part that can be lost.
3. **What history says about it.** The prior-commit count beside each file, and — the reason to run this
   rather than `git status` — **the files that usually change alongside these and have not.**

That third point is the whole value. A file that moved with this one in twenty-nine of its thirty-two commits
and is sitting untouched is either a decision or the bug that ships. Name it, with the count. Then stop.

## Reading it honestly

- **The coupling partners are questions.** Say "you have not touched `tests/run.mjs`, which has moved with
  `scripts/atlas.mjs` in 29 of its 32 commits — deliberate?" Do not say the change is incomplete.
- **Read the support count, not the percentage.** A pair resting on three commits is a coincidence with a
  percentage attached. The output prints both; quote both.
- **`new` beside a file means git has never seen it.** That is a fact, not a warning.
- **Never paste a diff.** One file's text is `/atlas:git-diff <path>`.

## How this differs from its neighbours

- **`/atlas:status`** is documentation-centric: the corpus, health signals, the plan. It opens markdown files.
  This one never does — `--no-index` is deliberate, so it runs in a repository that has not adopted the tool
  and answers in git's own terms.
- **`/atlas:changes`** shares the middle block but exists for a different payoff: *which documents cite the
  files you touched*. If the user's question is about documentation going stale, send them there.
- **`/atlas:git-branch`** answers "what about all the other branches", which this deliberately does not.
