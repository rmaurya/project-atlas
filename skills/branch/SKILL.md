---
description: Where you are and whether it is safe to commit there — the branch guard, and how to carry uncommitted work onto a new branch. Use before making changes, before committing, or when the user types /atlas:branch.
disable-model-invocation: true
---

# Branch safety

!`atlas branch`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the branch is safe".

---

**Run this before writing, not after.** The same check runs as a `PreToolUse` hook on every `git commit`, and
by then the work already exists in the wrong place. Reading it here is the cheap version of the same answer.

Say, in one screen:

1. **The branch, and the verdict.** "Safe to commit here" or the reason it is not — protected, or a name the
   convention does not recognise.
2. **How much is uncommitted.** That is what a mistaken branch puts at risk.
3. **The exact command**, if a branch is needed.

**If the verdict is a block, that is the whole message.** Do not proceed with the change first and mention it
afterwards.

```bash
atlas branch <type> <slug>     # feat fix docs refactor test chore
```

**It carries uncommitted work across, so branching is never a reason to stage or stash first.** Creating a
branch is local and reversible; the guard exists because this project's own first five commits went straight
to `main` while its guide preached the opposite.

**Rules:**

- **The slug names the change, not the file.** `fix/citation-resolver-false-positives`, not `fix/scan-mjs`.
- **One branch, one sentence.** If the description needs an "and", it is two branches.
- **Never `git push` without being asked.** Branching is reversible; pushing is not.
- **`--item <ID>` records which plan item the branch advances**, and the line about no item being named is a
  prompt to add one, not an error.
- **Say the branch name when you report work.** The user cannot see your shell, and this is the single most
  common thing a session forgets to state.

**Nearest neighbour.** `/atlas:branch` answers one question — is it safe to commit here — and can create the
branch. `/atlas:plan` proposes the whole route: type, slug, version bump and the way to `main`, and executes
none of it. Ask for `branch` when you are already moving, `plan` when deciding what the change even is.
