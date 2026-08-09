---
description: Publish the generated site to a wiki, a pages branch, or a single file — capability-aware, and never without confirmation. Use when the user wants to publish or share the docs, or types /atlas:publish.
disable-model-invocation: true
---

# Host capabilities

!`atlas caps || echo "(atlas is not on PATH — the plugin is not installed where this is running)"`
# What would be published

!`atlas scan || echo "(atlas is not on PATH — the plugin is not installed where this is running)"`
---

Help the user publish. **Every target stages by default and pushes only with `--push`.**

```bash
atlas publish --target wiki     # flattened markdown, links rewritten, drift-guarded
atlas publish --target pages    # the full site to a gh-pages branch
atlas publish --target export   # one self-contained HTML file
```

**The rule that is not negotiable: never pass `--push` without explicit confirmation from the user, every
time — not once per session.** Publishing is outward-facing and effectively irreversible. Stage first, show
exactly what would go where, and ask.

**Before suggesting a target, read the capability report above.** A feature that is off is named with the
setting to flip. One distinction that costs real confusion: **a wiki being enabled is not the same as its
repository existing** — GitHub creates it only when the first page is saved by hand, and the tool will say so.

**If publish refuses because of drift**, someone edited the wiki by hand. Do **not** reach for `--force`
first: re-run with `--import`, which copies the edited pages out with a mapping back to their source files.
Fold the change into the source markdown and publish again. `--force` destroys their text — if the user asks
for it, say that plainly before running it.

**Before any push, check health.** Publishing a corpus with blocking findings makes them public.
