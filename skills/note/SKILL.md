---
description: "Append one record — decision, finding, trap, progress or blocker — to the continuity journal, so it survives a killed session. WRITES to .atlas/journal/. Use when something was settled, learned or paid for, or when the user types /atlas:note."
argument-hint: '<decision|finding|trap|progress|blocker> "<what happened>"'
disable-model-invocation: true
---

# Journal record

!`atlas note $ARGUMENTS`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the record was written".

---

**This command writes.** Every other read-only surface in this plugin leaves the repository alone; this one
appends a single JSON line to `.atlas/journal/<git user.name>.jsonl` inside the repository, where it lands in
a diff and gets committed with everything else. Nothing is published, and no prompt text is ever recorded —
the journal holds what was decided and touched, never what was said.

**With no arguments, the block above printed the five kinds and wrote nothing.** That is the usage, not a
failure. Read the kinds back and ask which one this is:

| Kind | Use it when |
|---|---|
| `decision` | A question was settled. Say what it rules out — that is the half a later session cannot reconstruct. |
| `finding` | Something true about the repository turned out not to be obvious. |
| `trap` | A mistake was paid for. This is the highest-value kind; it is the only one that stops a repeat. |
| `progress` | A piece of work reached a state worth resuming from. |
| `blocker` | Work stopped and cannot continue without something external. |

**Write the record the way it will be read.** One sentence, in the past tense, naming the thing and not the
session: *"MCP server hand-written; the SDK was rejected as a runtime dependency"* is useful in four months.
*"Worked on MCP"* is not. Add `--refs path/one,path/two` when a file is the subject; `/atlas:state` prints the
refs under the text and they are how a reader gets from a claim to the code.

**Rules:**

- **Do not record on the user's behalf without saying so.** Show the exact line you are about to append.
- **One record, one fact.** A record needing an "and" is two records.
- **A `progress` record is the cheapest and the least valuable.** The hooks already write those at teardown.
  Prefer `decision`, `trap` and `blocker` — the three no automation can infer.
- **Never write a record you would not sign.** It carries the git identity and cannot be corrected later
  except by a second record contradicting the first.

**Nearest neighbour.** `/atlas:note` adds one line as it happens; `/atlas:state` reads back everything that
was added; `/atlas:handoff` is the prose summary a person writes at the end. Only this one mutates.
