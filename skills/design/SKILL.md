---
description: Which design documents exist, which are scaffolds still owing their substance, and which are absent — plus the scaffolder that writes the questions and never the answers. Use when the user asks about design docs, architecture records or an HLD, or types /atlas:design.
disable-model-invocation: true
---

# The design record

!`atlas design`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "the design record is complete".

---

Three states, and the middle one is the one that matters:

- **`✓` written** — the document holds substance.
- **`~` scaffolded** — the file exists, carries its questions, and still owes every answer. It is counted as
  a stub, not as a document, and it stays that way until a person deletes the marker line. Nothing removes it
  automatically, because nothing else can know the substance arrived.
- **`·` absent** — signal H15, an expected artifact that is not there.

**A tree full of `~` is worse than a tree full of `·`, and say so.** An absent document is an honest gap; a
scaffold is a filename that looks like an answer in every listing, every link and every search result.

Report:

1. **How many are written**, against how many are scaffolds. One line.
2. **The one document worth writing next** — usually the architecture overview, because everything else cites
   it.
3. **What `--scaffold` would add**, if anything is absent.

```bash
atlas design --scaffold     # writes the questions for whatever is absent — never the answers
```

**Rules:**

- **Never fill a scaffold with generated prose.** A design document is a set of claims about what the code is
  *for* and what was rejected; generated claims nobody reviewed would land in the exact corpus every other
  check measures drift against. Write it in a session, with the user, in a diff they read.
- **Offer to write one, not eight.** Eight documents in one pass is an unreviewable diff, which is an
  unverified one.
- **Answer from the source.** Every claim cites `path:line`, read this session. `docs/references/authoring.md`
  carries the rules and the page shapes; read it before writing a line.
- **`UNKNOWN` is a valid answer in a design document** and is usually the valuable one — it tells a reader
  where the decision has not been made yet.

**Nearest neighbour.** `/atlas:design` reports whether the *design record* exists. `/atlas:health` reports
whether the *whole corpus* is rotting, and carries the same gaps as signals H14, H15 and H16 among fifteen
others. Ask for design when the question is "what should we write", health when it is "what is broken".
