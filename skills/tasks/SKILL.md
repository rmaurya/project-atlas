---
description: The planning document as progress bars — items by track and priority, with completion. Takes an optional filter. Use when the user asks what is in flight, what is left, or types /atlas:tasks.
argument-hint: "[filter]"
disable-model-invocation: true
---

# The plan

!`atlas tasks $ARGUMENTS`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the plan is empty".

---

This is the repository's own planning markdown, parsed — not a task list this tool owns. Editing the plan
means editing that file; nothing here writes to it.

Report, in this order:

1. **What is actually in flight** — the items that are neither 0% nor 100%. On a mature plan that is one or
   two lines out of seventy, and it is the only part anyone needs.
2. **The mean, with the caveat that it is a mean.** A 99% mean across seventy items says the plan is a record
   of finished work, not a forecast. Say that rather than presenting it as progress.
3. **The single next item worth picking up**, by id and title.

**Rules:**

- **Percentages are typed by hand into the plan document.** They are a claim by whoever last edited it, not a
  measurement of the code. Never present one as verified. If it matters, check the item against the tree.
- **An item at 100% with no commit naming it** is the interesting case, and `/atlas:contrib` prints exactly
  that list under "Spec → build coverage". It is worth a look, not an accusation.
- **A filter argument is a plain substring** matched against the whole item — id, title and priority. It is
  not a query language, and a filter that matches nothing prints a zero count rather than an error.
- **If the block says the plan is missing**, this repository has no `planning.source` configured. Say so and
  point at `/atlas:config`; do not invent a plan, and do not offer to write one.

**Nearest neighbour.** `/atlas:tasks` is what the plan *claims*; `/atlas:status` is the corpus and its rot,
with the plan as one line of it; `/atlas:state` is what this session recorded and knows nothing about either.
`/atlas:contrib` is the only one of the four that checks the plan against the commits.
