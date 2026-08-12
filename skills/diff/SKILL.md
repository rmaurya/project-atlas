---
description: Show and explain one file's diff — uncommitted changes, or across the branch. Use when the user asks what changed in a specific file, or types /atlas:diff.
argument-hint: <path>
disable-model-invocation: true
---

# Diff

!`atlas diff $ARGUMENTS`


> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing to report".

---

Explain the diff above. **Do not paste it back** — the user can already see it.

Say, in a few lines:

1. **What the change does**, in plain language. Not "modified line 40" — what behaviour or claim changed.
2. **What it might break.** For code: callers, tests, anything documented that depends on it. For a document:
   whether it introduces a dead link, resolves or creates a duplicate title, or adds a `path:line` citation
   that does not resolve.
3. **Whether it is complete.** A fix without a test, a new function nobody calls, a document that asserts
   something about code without citing it.

**If the file is markdown**, check the change against the corpus rules: full paths in citations rather than
bare filenames, a re-stamped date on a revised page, no second copy of something that already exists.

**If no file was given**, ask which one, and offer `/atlas:changes` to list them. Do not pick one yourself.

**If the diff is large**, summarise by theme rather than walking it top to bottom. A file-length recital is
not a review.

**Nearest neighbour.** `/atlas:diff <path>` is **one file, in detail**. `/atlas:changes` is **every changed
file, without the diffs**, plus the documents that cite them. `/atlas:review` is the pre-commit judgement over
the whole change. Reach for diff when you already know which file is in question.
