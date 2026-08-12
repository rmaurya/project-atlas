---
description: "Pick up exactly where a paused session left off — every parked agent's branch, worktree, checkpoint and label, as a plan to re-spawn from. Use at the start of a session that follows an interrupted one, or when the user types /atlas:resume."
disable-model-invocation: true
---

# Resume

!`atlas resume --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing was parked".

---

`atlas resume` has already run. **Your job is to turn that list into running agents again** — and to be
straight about what "again" means.

## The one thing you must not imply

**A subagent's context died with the process that ran it.** Nothing on disk can bring back its reasoning.
Re-spawning is a *fresh agent picking up a real tree* — the branch, the worktree and the checkpoint are
genuinely restored; the thinking is not.

Say that once, plainly. A session that reads as "the agents are back" will let somebody assume an agent
remembers a decision it has never seen, and they will only discover otherwise after paying for it twice.

## What to do with the list

For each numbered entry, spawn one subagent, and give it:

- **Its worktree** — `isolation: "worktree"` is not enough on its own; the existing directory is named in the
  output and already holds the work. Point the agent at it explicitly.
- **Its branch** — named in the entry.
- **Its checkpoint** — `wip/agent-*`. Tell the agent this commit is a mid-thought checkpoint made by
  `atlas pause`, not a finished change, and that it should squash or amend rather than build on it as-is.
- **What it had reached** — the label and the commits-ahead count. If a `HANDOFF.md` or journal entry exists
  for that line of work, hand it over too.

**Spawn them in one message** so they run concurrently, which is the whole reason they were separate agents.

## Reading the states

- **`worktree … — GONE`** — the directory was removed but the checkpoint survived, which is exactly why the
  checkpoint is a git ref. Re-create a worktree on that branch and carry on from the ref.
- **`checkpoint … — ref missing`** — somebody deleted the ref. Say so; do not guess at recovering it. `git
  reflog` may still have it and that is the operator's call, not yours.
- **`Nothing is parked`** — no pause was taken. Not an error. Offer `atlas pause` for next time.

## What it does not do

It does not re-spawn anything by itself, and it never will. This command prints a plan; spending tokens is a
decision that belongs to whoever is reading it.
