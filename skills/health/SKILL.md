---
description: Documentation rot report — dead links, forked documents, stale citations, orphans. Use when the user asks about documentation health, doc rot, or types /atlas:health.
disable-model-invocation: true
---

# Report

!`atlas health --no-color $ARGUMENTS`

> **If the block above is empty**, `atlas` is not on `PATH` — the plugin is not installed where this is
> running. Say so; do not read an empty section as "nothing to report".

---

Interpret the report above. **Do not paste it back**; the user can already see it.

**Lead with the blocking count.** **Five signals block by default** — H1 (dead link), H3 (duplicate title),
H8 (missing title), H10 (SOP past the review date it set itself) and H12 (a step in an SOP citing something
that cannot be resolved). None has a legitimate cause: the first three are defects in the document, and the
two SOP signals mean somebody is following instructions that are wrong rather than merely old. Everything
else is advisory and has legitimate exceptions: an archived record *should* cite code that has since moved;
a historical specification *should* name a retired product.

*This section said "three block" long after H10 and H12 joined the set — the tool's own instruction file
drifting from the tool, which is the failure it detects for a living. The set lives in one place,
`scripts/lib/config.mjs:245`, and a repository may override it.*

**Seventeen signals ship, not nine.** Sixteen are claims about the corpus; **H17 is a claim about how the
session was run** — a lot of editing in one thread with nothing delegated — and it is advisory in code, so
it can never block whatever the config says. Read an H17 row as a note about the operator, never as something
wrong with the documentation. The full catalogue, with detection details and the legitimate exceptions for
each, is `docs/references/health-signals.md`.

**Report the delta, not the absolute.** H4 and H6 fire in bulk on any real corpus. Saying "252 orphans"
trains the reader to ignore the report; saying "three new since Tuesday" does not.

**Read the "Not checked" section aloud.** A check that did not run is not a check that passed. If
`forbiddenTerms` or `crossref` are unconfigured, say so and offer to configure them — for most repositories
the obvious pair is a backlog and a task list.

**A duplicate title is the finding to take seriously.** It is the signature of a forked document, and forked
documentation is the failure this whole tool exists to prevent.

**If the user asks to fix things:**

- Blocking first, and verify each by reading the file — a dead link is often a *moved document*, and that has
  a different fix from a wrong link.
- **Never fix in bulk.** A hundred-file diff is unreviewable, which means unverified.
- Suppressing a signal needs a reason string in the config. An unexplained suppression is itself a defect.
