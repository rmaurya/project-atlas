---
description: "How sessions actually went — turns per prompt, queued prompts, interruptions, compactions, tool error rate and rework. Reads local session transcripts outside the repository and is never published. Use when the user asks about friction or how the work went, or types /atlas:sessions."
disable-model-invocation: true
---

# Session outcomes

!`atlas sessions`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the sessions were clean".

---

**Say where this came from first.** The block read session transcripts from this machine — files *outside*
the repository, holding every prompt and file read of every session in this project. It aggregates only: no
prompt text is extracted, nothing is written into the repository, nothing is published, and the figures cannot
be reproduced from a clone because the transcripts are machine-local and disposable.

Report the **friction** block before the interaction block. Turn counts describe size; error rates and
interruptions describe whether the work was going well.

**What each signal actually supports, and what it does not:**

- **Turns per typed prompt** is work done per instruction. High can mean a large request handled cleanly, or
  a small one misread. It cannot distinguish them, so present it as a question rather than a verdict.
- **Interruptions and queued prompts** are the closest thing here to a person disagreeing with a run in
  progress. One interruption in a hundred prompts is not a pattern; say so rather than reporting the rate.
- **Compactions count sessions that outgrew their context window** — a proxy for scope that was not split.
  This is the figure most likely to be worth acting on.
- **Rework and revert rates come from git, not from the transcripts**, and are the same numbers
  `/atlas:contrib` prints. They are the only lines in this report a colleague could reproduce.

**Rules:**

- **Prompt quality is not measured, and nothing here is a proxy for it.** A transcript records what happened
  after a prompt, never whether the prompt was well judged. Refuse the question if it is asked.
- **A hard turn and a typo turn count the same.** Difficulty is invisible here.
- **Never compare people with it.** On one git author the per-person split is a table of one, and the tool
  says so instead of drawing it.

**Nearest neighbour.** `/atlas:sessions` counts **what happened in the sessions**; `/atlas:tokens` counts
**what they consumed**; both read the same local transcripts. `/atlas:contrib` and `/atlas:worklog` read the
repository instead, and are the two a colleague can check.
