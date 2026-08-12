---
description: "Park every agent worktree before the session ends — each one's uncommitted work is checkpointed to a git ref that survives a reboot, a re-clone and a cleared scratchpad. Use when stopping for the day with subagents still running, or when the user types /atlas:pause."
disable-model-invocation: true
---

# Pause

!`atlas pause --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there was nothing to park".

---

`atlas pause` has already run. Report **what was checkpointed and where**, in one screen.

## Why this command exists

Three subagents were mid-task when a session ended. Nothing knew they existed. Their branches, their
worktrees and 92K of uncommitted work in one of them were recoverable only because somebody went and looked
by hand at `git worktree list` and three `git diff HEAD`s. **An agent's work is the most expensive thing this
tool touches and it was the only thing with no record.**

## Reading the block above

- **Worktrees were parked** — say how many, and name the `wip/agent-*` refs. That ref is the answer to "where
  did my work go", and it is the only thing worth remembering from this output.
- **"clean"** — that agent had committed everything already. Nothing to do, and nothing was invented: a
  checkpoint with no content would put a false claim in the log.
- **"nothing but ignored files"** — there was uncommitted content but all of it is gitignored, so there is
  nothing git can carry. Say so plainly; the operator may want to know their work is in ignored files.
- **"could not park"** — read the reason out. Do not retry, and do not work around it by moving files.
- **No agent worktrees** — nothing was in flight. That is a normal state, not a failure.

## What it deliberately does not do

- **It does not touch the operator's own checkout.** Their uncommitted edits are theirs. `pause` parks
  agents.
- **It does not stop anything.** The agents are not killed and the dashboard keeps serving. This command
  makes the *work* safe; `atlas stop` is what clears up.
- **It does not push.** A checkpoint is local until somebody decides otherwise.

## Say this, every time

The checkpoints are **not finished changes**. They are commits made mid-thought, and they should be squashed
or amended before they land on a branch anybody reviews. If you omit this, somebody will merge one.

## Next

`atlas resume` reads the manifest back and prints a re-spawn plan. `atlas stop` clears the state and the
worktrees, and never deletes a branch.
