---
description: What changed — uncommitted work, what this branch does, and which documents cite the files you touched. Use before committing, when picking up work, or when the user types /atlas:changes.
disable-model-invocation: true
---

# Changes

!`atlas changes --no-color 2>/dev/null || echo "NOT_A_REPO"`

---

Tell the user what changed, in this order:

1. **Uncommitted and staged** — what is not saved yet. This is what they lose if something goes wrong.
2. **What this branch does** — the diff against its merge-base, which is not the same as the last few
   commits. A branch off an older base contains work the last two commits miss, and a branch with ten commits
   is still one change.
3. **The documentation that cites what they touched** — oldest first.

**That third section is the point of running this here rather than `git status`.** A changed source file is
uninteresting alone; a changed source file that a four-month-old architecture document cites is the finding.
Say which document, when it was last touched, and which of their files it names.

Be precise about what it means: **those documents are not necessarily wrong** — they are the ones whose ground
just moved. Offer to check one; do not assert it is stale.

**Rules:**

- **Never paste a diff.** Summarise. If they want one file, that is `/atlas:diff <path>`.
- **Lead with what is unsaved.** It is the only part that can be lost.
- If a changed document introduces a new blocking signal, say so before anything else — that is a defect
  going into the commit.
- If nothing changed, say so in one line and stop.
