---
description: "Clear the session cleanly and non-resumably — remove agent worktrees and parked state, keeping every branch and checkpoint. Use when finishing a line of work for good, or when the user types /atlas:stop."
disable-model-invocation: true
---

# Stop

!`atlas stop --dry-run --no-color`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there is nothing to clear".

---

**What ran above is a rehearsal.** `--dry-run` removes nothing. Report what *would* happen and let the
operator decide, because this is the one command in the pair that does not preserve anything.

## Report, then wait

Say plainly:

- which worktrees would be **removed**,
- which would be **kept**, and why — "has uncommitted work" is the important one,
- that **every branch and every `wip/agent-*` checkpoint survives**. Nothing that reached git is deleted here,
- **which dashboard servers would be stopped**, if any line says so.

Then stop. Run `atlas stop` for real only when the operator asks for it. Do not chain the two.

## If anything is kept

A kept worktree means uncommitted work would be destroyed. **Offer `atlas pause` first** — it checkpoints
that work to a branch, after which `atlas stop` removes the worktree with nothing at risk. That sequence is
the whole design: pause makes stop safe.

`atlas stop --force` discards the work instead. Say what it does and let them type it. Never run it on your
own initiative, and never suggest it before offering `atlas pause`.

## Stop against pause

They are not two strengths of the same thing.

- `atlas pause` — **resumable.** Preserves everything, changes nothing about the shape of the session, and
  writes a manifest `atlas resume` reads back.
- `atlas stop` — **not resumable.** Clears the manifest and the worktrees so the next session starts clean.
  It is for finishing, not for pausing overnight.

If the operator says "stop for today", they almost certainly mean `atlas pause`. Ask.

## The dashboard servers it stops

A removed worktree's line may carry `· dashboard on port NNNN (pid N) stopped`. **Report that.** `stop` used
to remove the worktrees and leave their servers running, and that omission manufactured four of the five
orphaned dashboards found on one machine in a single session — each still listening, still rebuilding,
serving a directory that no longer existed, so anyone who opened the port read another repository's branch
believing it was their own (A-49).

It also sweeps for the backlog those earlier runs left behind, and prints a `Stopped N orphaned dashboard
server(s)` block naming every pid, port and deleted directory. Say it. Silence there is how the leak went
unnoticed twice.

A `left` line is the opposite: a process the tool refused to signal because it could not establish that it
was an atlas server for a root that is gone. It is **still running**. Pass on the reason verbatim — deciding
what that process is belongs to the operator, not to this skill.

## What it never touches

Branches, commits, checkpoints, the journal, the corpus, and the operator's own working tree. `stop` clears
*session state* — which worktrees existed, what was parked, and the dashboard servers of the worktrees it
removed — and nothing else.
