# The cluster taxonomy

Every document belongs to exactly one cluster. Clusters are what turn 400 files into something a person can
hold in their head.

---

## The ordering rule

**First match wins, and filename patterns must come before directory patterns.**

This is the one rule that is not obvious and that will bite you. A repository keeping its SOPs in
`docs/architecture/` will have every one of them swallowed by a `docs/architecture/**` rule — the Procedures
cluster then reads as empty when it is in fact full, and nobody notices because an empty cluster looks like a
cluster you don't use.

**Specific beats general, and a name is more specific than a location.** The shipped defaults are ordered
accordingly: `start` → filename-driven (`procedures`, `specs`, `planning`, `manuals`, `operations`) →
directory-driven (`product`, `research`, `engineering`).

---

## The default clusters

| Cluster | Holds | Matched by |
|---|---|---|
| **Start here** | The way in for someone who has never seen the repository | `README.md`, `docs/README.md`, `CONTRIBUTING.md` |
| **Procedures** | How work is done — SOPs, playbooks, runbooks | `**/*sop*.md`, `docs/playbooks/**` |
| **Specifications** | Specified behaviour, with build status | `**/*SRS*.md`, `**/*RFC*.md`, `docs/specs/**` |
| **Planning** | What is open, what is next | `**/BACKLOG.md`, `**/TASKS.md`, `**/TODO.md` |
| **Manuals** | For the user, and for the developer | `**/*MANUAL*.md`, `**/*GUIDE*.md` |
| **Operations** | Build, ship, run, secure | `**/DEPLOYMENT.md`, `**/SECURITY.md`, `docs/ops/**` |
| **Product & direction** | What is being built, and why | `docs/vision/**`, `**/ROADMAP.md` |
| **Research & record** | Findings, session records, prior art — historical by nature | `docs/research/**`, `**/*worklog*.md` |
| **Engineering** | How it is built | `docs/architecture/**`, `**/HLD.md`, `**/ARCHITECTURE.md` |

`atlas init` keeps only the clusters that matched something in your repository, so you start with a taxonomy
shaped like your project rather than a generic nine.

---

## Customising

```json
"clusters": [
  { "id": "start",  "title": "Start here", "blurb": "…", "match": ["docs/README.md"] },
  { "id": "adr",    "title": "Decision records", "blurb": "One decision each, dated, never edited.",
    "match": ["docs/adr/**", "**/ADR-*.md"] },
  { "id": "engineering", "title": "Engineering", "match": ["docs/architecture/**"] }
]
```

- **`id`** — stable; used in anchors and suppressions. Renaming breaks bookmarks.
- **`title`** — what a reader sees.
- **`blurb`** — one line under the heading. Worth writing: it is where you say *what kind of thing this is*,
  which a filename cannot.
- **`match`** — globs supporting `**`, `*`, `?` and `{a,b}`. Order within a cluster does not matter; order
  *between* clusters does.

**Glob semantics:** `**/` spans any number of directories including none, so `**/*.md` matches `a.md` and
`x/y/a.md`. `*` never crosses a `/`. Dots are literal.

---

## The fallback

Anything matching nothing lands in `fallbackCluster` (default `"uncategorised"`) and fires H5.

**A large fallback count is a missing rule, not a problem with the documents.** Read what landed there, and
either add a rule or accept it.

Set `fallbackCluster: null` to make unclassified documents a **blocking** failure. Reasonable for a small
curated corpus; punishing for a large organic one.

---

## Designing your own

**Cluster by what a reader is trying to do**, not by where files happen to sit. "I need the deploy steps" and
"I need to know why we chose Postgres" are different errands, and they should be different clusters even if
both documents live under `docs/`.

**Keep it under about ten.** Past that, the index stops being scannable and you have rebuilt the problem.

**Give history its own cluster.** Session logs, work records and archives behave differently from living
documentation — they are *supposed* to be stale and to name retired things. Separating them lets you suppress
their signals in one line instead of fighting them forever.

**Sealed clusters.** A self-contained subtree with its own internal README (vendored docs, an agent-tooling
tree) can be indexed and searchable without being folded into the main taxonomy. Give it one cluster and leave
it alone — otherwise a subtree that is 40% of your file count swamps everything else.
