---
description: A system prompt assembled from this repository's own configuration, plan, taxonomy and corpus — for an agent that will not load the plugin. Use when the user wants instructions for another tool or model, or types /atlas:prompt.
disable-model-invocation: true
---

# The generated system prompt

!`atlas prompt`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "there is nothing to hand another agent".

---

Every statement in the block above was read from this repository — the config, the plan, the cluster rules,
the corpus figures. **None of it was written by a model**, and that is what makes it safe to paste into a tool
whose output nobody will review as carefully.

What it is for: an agent that cannot load this plugin. A different model, a CI job, a colleague's editor. It
carries the rules that would otherwise be invisible — where a document belongs, which signals block, what the
plan says — without carrying the plugin.

Say what it is, offer the file, and stop:

```bash
atlas prompt --out AGENT-PROMPT.md     # write it into the repository instead of printing it
```

**Rules:**

- **Regenerate; never edit.** The block carries a do-not-edit banner for a real reason: an edit here changes
  nothing about the tool and is silently overwritten the next time anyone runs it. If a statement in it is
  wrong, the fix is in the config, the plan or the markdown.
- **A written copy is a snapshot, and it will drift.** If the user wants the file committed, say plainly that
  it becomes another document to keep current — and that the tool's own health check will start measuring it.
- **`--out` is confined to the repository root**, so a path climbing out of the tree is refused rather than
  followed.
- **This is not the plugin's instructions.** `AGENTS.md` is the hand-written file for a runtime that loads
  one instruction file; this is derived state assembled per repository. Do not offer one in place of the other.

**Nearest neighbour.** `/atlas:prompt` produces instructions *for another agent*. `/atlas:help` orients *a
person* to the commands in this one. `/atlas:mcp` is the third way to hand this repository to a program — a
live read-only tool surface rather than a block of text.
