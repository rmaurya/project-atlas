# Welcome post for GitHub Discussions

**Not rendered anywhere.** This is the text to paste when opening Discussions on the repository.

Discussions is a repository *setting*, so it has to be turned on by hand:
**Settings → General → Features → ✅ Discussions**, then **Discussions → New discussion → Announcements**.

Title: `Welcome to docs-atlas Discussions`

---

## Welcome

**docs-atlas** builds a derived, auditable knowledgebase over a repository's own documentation — an index, a
dashboard, a deck, and nine mechanical rot signals, all generated from the markdown you already have.

This is the place for anything that is not a defect or a concrete proposal. Those go to
[Issues](https://github.com/rmaurya/docs-atlas/issues), which have templates.

### What is genuinely useful to post here

- **What the first run found in your repository.** The signal counts, and whether they were fair. The default
  taxonomy is tuned against a handful of real corpora and it will fit yours imperfectly — the shape of that
  mismatch is the single most useful thing you can tell me. It already found its own: running `init` on this
  repository matched **1 of 9** default clusters, because a tool repo does not look like a product repo.
- **A signal that fired wrongly, or one that stayed quiet when it should not have.** A check that reports clean
  when it is not is the worst class of bug in this project, and it has happened: a git-metadata bug once meant
  staleness evaluated nothing while the report said `ok`.
- **Taxonomies that worked.** If you found a cluster arrangement that fits a kind of project well — a monorepo,
  a library, an ops repo — post it. That is directly reusable by everyone else.
- **Where the honesty rules got in your way.** They are deliberate, and several plausible features are refused
  because of them ([CONTRIBUTING.md](https://github.com/rmaurya/docs-atlas/blob/main/CONTRIBUTING.md)). If one
  is wrong, argue it here rather than working around it.

### What this project will not do, so nobody spends effort proposing it

These are settled, and the reasoning is written down rather than assumed:

- **No prose generated at build time.** Unreviewed generated text at scale is a confident source of wrong facts.
- **No migrating content out of markdown into a store.** It breaks every citation and every grep, and fixes
  neither discoverability nor drift.
- **No combined contribution score, and no leaderboard of people.**
- **No "prompt quality" metric.** A repository cannot see a prompt. Outcome proxies ship under their real names.

### Before you post

Skim [README](https://github.com/rmaurya/docs-atlas/blob/main/README.md) and the
[reference guides](https://github.com/rmaurya/docs-atlas/tree/main/references) — most "how do I…" questions are
answered in `adoption.md` or `configuration.md`, and the answers there are more precise than I will manage in a
comment.

The [roadmap](https://github.com/rmaurya/docs-atlas/blob/main/ROADMAP.md) carries honest completion figures,
including which items are estimated rather than measured. If something you need is on it, say so — that is how
it gets prioritised.
