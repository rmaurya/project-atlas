---
description: What a resuming session reads first — the branch, what is uncommitted, and every decision, trap and blocker the journal recorded. Use at the start of a session, after a compaction, when picking up someone else's work, or when the user types /atlas:state.
disable-model-invocation: true
---

# Where this session resumes

!`atlas state`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there is nothing recorded and nothing in flight".

---

This is the cold-start surface. Assume you know nothing about what happened before this block.

Report it in this order, and stop:

1. **Where you are** — branch, and how much is uncommitted. Uncommitted work is the only part that can be
   lost, so it leads.
2. **Blockers and traps first, however old.** A `BLOCKER` is something that stopped, and a `TRAP` is a
   mistake somebody already paid for. Both stay true until someone acts on them; a `PROGRESS` record stopped
   being interesting the moment the next one landed.
3. **Decisions, as constraints.** A decision record says what was ruled *out*. Re-proposing something the
   journal already settled is the specific waste this file exists to prevent — say what is closed before you
   suggest anything.
4. **The single next action**, with the command. One, not a list.

**Rules that make this worth reading:**

- **Do not narrate the progress records.** Hooks write them at every subagent teardown, so they arrive in
  runs of near-identical lines. Collapse them to one sentence — "last movement: `<branch>` at `<sha>`" — and
  spend the screen on the four kinds a human typed.
- **The journal is what was recorded, not what happened.** A quiet journal means nobody wrote anything down;
  it is not evidence that the work was uneventful. Say which, if you can tell.
- **Nothing here is a summary of the code.** If a record names a file, read the file before repeating the
  claim — records age exactly like documents do.
- **If the branch line reports a block**, say so before anything else; the user is a keystroke from
  committing to a protected branch.

**Nearest neighbour.** `/atlas:status` is the state of the *corpus* — documents, rot, plan. `/atlas:state` is
the state of the *work* — where you are and what was recorded. `/atlas:tasks` is the state of the *plan*, and
knows nothing about this session. Ask for state when resuming, status when deciding what to fix.

To add to what this reads, `/atlas:note`. To hand it to a person rather than a session, `/atlas:handoff`.
