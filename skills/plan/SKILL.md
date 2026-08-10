---
description: Propose the git route for the work in progress — branch, type, version bump, and the way to main — and execute nothing without approval. Use before starting a change, or when the user types /atlas:plan.
argument-hint: <slug>
disable-model-invocation: true
---

# The route

!`atlas plan $ARGUMENTS`


> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing to report".

---

Read the route above to the user. **Do not run any of it.**

- If `type` or `slug` shows `?`, ask. They need intent a diff does not carry, and guessing puts the wrong
  word in front of a reader who trusts it. A slug names *the change*, not the file.
- If there are blockers, they are the conversation. Resolve them before proposing to proceed.
- `atlas plan <slug> --apply` creates the branch and **nothing else**. Committing and pushing stay explicit,
  because pushing is outward-facing and irreversible.
- The pull request step is the one rule in this project that nothing enforces. Say so rather than implying
  the tool will catch a bypass — it will not.
