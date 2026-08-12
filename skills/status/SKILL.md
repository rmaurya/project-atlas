---
description: Project status at a glance and the single highest-value next action. Use when the user asks where the project stands, what to do next, or types /atlas:status.
disable-model-invocation: true
---

# Corpus

!`atlas scan`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing to report".

# Health

!`atlas health --no-color`
# Plan

!`atlas tasks`
# Branch

!`atlas branch`
---

Give the user **one screen**, in this order:

1. **One line of shape** — documents, lines, clusters, open items, mean completion.
2. **Blocking findings, if any.** These are defects with no legitimate cause. Name them; do not summarise
   them away.
3. **The single highest-value next action**, with the exact command to run. One action, not a list — a list
   is a to-do dump and gets ignored.

Then stop.

**Rules that make this worth reading:**

- **Lead with the delta.** Absolute counts are wallpaper after the first run. "Three new dead links since
  Tuesday" is actionable; "252 orphans" is not.
- **Advisory findings are not a to-do list.** Orphans and staleness fire in bulk on any real corpus and always
  will. Mention the number, say it is expected, move on.
- **Read the "Not checked" section.** A check that did not run is not a check that passed.
- **If the branch check reports a block**, say so before anything else — the user is about to commit to a
  protected branch.
- If nothing is configured, say that plainly and point at `/atlas:help`.

**Nearest neighbour.** `/atlas:status` is the state of the **corpus** — documents, rot, plan, branch, in one
screen. `/atlas:tasks` is the state of the **plan** alone, in detail. `/atlas:state` is the state of the
**work** — where this session is and what the journal recorded. Status is the one to ask for when the question
is "what should I do next"; the other two answer narrower questions and answer them better.
