## What the numbers above are actually saying

**Written by hand on 2026-08-10, against v0.1.12.** The panel above is computed; this is judgement, and it is
here so the two are never confused.

Four signals sit outside their band, and three of them have the same cause: **this repository is two days
old and has one author.** A 68.8% rework rate on a project whose design is still being argued with is not the
same defect it would be on a mature codebase — files are re-touched because decisions are being reversed in
public, which is the intended way to work here. Bus factor 1 is a fact about the future, not the present.

The one that is a real defect is **spec coverage: 1 of 26 items named by a commit.** Two separate incidents,
both recorded in the changelog: the plan went stale for 35 commits, was rewritten with a paragraph explaining
how it had gone stale, and then went stale again across the next six releases. The dashboard printed the
evidence throughout and nobody read it. `D-11` now refuses a shipped change that names no item, so this figure
should climb from here; if it does not, the gate is not working.

**Orphans at 51.9% is mostly taxonomy, not neglect.** Ten of the fourteen are `skills/*/SKILL.md`, which the
plugin loader discovers by directory and which nothing links to by design. `Q-2` covers the underlying issue:
the shipped cluster rules fit product repositories and fit this one badly.

### What is not measured, and why it matters here

Six generated-output defects shipped in one afternoon — a deleted theme toggle, an update row advertising a
downgrade, a bundle with no stylesheets, 69 dead links, panels leaving holes, a paragraph rendered as vertical
strips. **Every one was found by a human looking at the rendered page.** None of them appears anywhere in the
figures above, because the tool audits documentation and has never once audited its own HTML. That is `D-8`,
now P0, and until it exists the honest reading of a clean panel is *"nothing the tool knows how to check has
failed"* — which is a narrower claim than it looks.

Nothing here scores prompt quality or contributor performance. `I-2` will add outcome measures with weights
declared in config, so the judgement can be argued with. A score the tool invents cannot be.
