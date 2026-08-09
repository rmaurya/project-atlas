# Configuration reference

`project-atlas.config.json` at the repository root. Generate a starting point with `atlas init`; every key below is
optional and falls back to the documented default.

---

## Discovery

| Key | Default | What it does |
|---|---|---|
| `siteTitle` | the repository directory name | Shown in the header and page titles |
| `roots` | `["."]` | Directories to index; `"."` means the whole repository |
| `include` | `["**/*.md"]` | Globs to index |
| `exclude` | `node_modules/**`, `.git/**`, `dist/**`, `build/**`, `**/_wiki/**`, `**/CHANGELOG.md`, … | Globs to skip |
| `output` | `"docs/_wiki"` | Where the generated site is written. Deleted and rewritten on every build |
| `trackedOnly` | `true` | Discover via `git ls-files`, so untracked scratch files never enter the wiki |

**`trackedOnly` is the quiet safety feature.** With it on, a file has to be committed before it can be
published — a half-written draft in your working tree cannot leak into a wiki or a Pages site.

---

## Taxonomy

| Key | Default | What it does |
|---|---|---|
| `clusters` | nine defaults | Ordered; **first match wins**. See `taxonomy.md` |
| `fallbackCluster` | `"uncategorised"` | Where unmatched documents land. `null` makes H5 blocking |

---

## Signals

| Key | Default | What it does |
|---|---|---|
| `blocking` | `["H1","H3","H8"]` | Which signals exit non-zero |
| `staleDays` | `90` | Grace period before H6 can fire. **`0` means no grace period** and is honoured |
| `citationExtensions` | `.ts .js .py .go .rs .java .rb .swift …` | Which extensions count as a code citation |
| `forbiddenTerms` | `[]` | H7 is off until configured |
| `crossref` | `[]` | H9 is off until configured |
| `suppress` | `[]` | Per-signal, per-path exemptions. **`reason` is mandatory** |

```json
"forbiddenTerms": [
  { "term": "OldName", "reason": "renamed 2026-01", "ignore": ["docs/archive/**"] },
  { "pattern": "\\bTODO\\(nobody\\)", "flags": "gi", "reason": "unowned todos" }
]
```

```json
"crossref": [
  { "id": "plan", "a": "docs/BACKLOG.md", "b": "docs/TASKS.md", "pattern": "\\b[A-Z]-\\d+\\b" }
]
```

```json
"suppress": [
  { "signal": "H6", "path": "docs/logs/**",
    "reason": "Session records are historical by nature; citing code as it was is correct, not rot." }
]
```

A `suppress` entry without a `reason` **rejects the whole config**. That is deliberate: six months on, nobody
can distinguish a considered exemption from a silenced warning unless someone wrote it down.

**On `staleDays`:** the default of 90 is deliberately conservative. On a fast-moving repository it is far too
lax — one corpus needed **30** before H6 said anything useful. Tune it until it reports something you would
act on. Note it uses `??`, not `||`, so a configured `0` genuinely means zero.

---

## Planning

| Key | Default | What it does |
|---|---|---|
| `planning.source` | `null` | A task list to chart. Without it, the dashboard shows no item charts — deliberately, rather than charting nothing and calling it zero |
| `planning.backlog` | `null` | A backlog document, counted alongside |
| `planning.itemPattern` | `**ID · Title** — **P1 · Criticality**` | Regex for an item heading |
| `planning.trackPattern` | `^##\s+(.+)$` | Regex for a track heading |
| `planning.percentCellPattern` | `\| ID \| 42 \|` | Regex for a completion-table cell. A trailing `*` marks the figure **estimated** |
| `planning.statusBands` | Not started / In progress / Nearly done / Done | Ordered; first `max` that fits wins |

**Estimated versus measured is preserved everywhere** — estimated figures are drawn hatched, and an item with
no figure is charted as **unknown, never as zero**, and excluded from means.

---

## Deck

| Key | Default | What it does |
|---|---|---|
| `deck.source` | `"docs/atlas/DECK.md"` | Markdown slide deck. Absent means no deck page is generated |

Slides separate on `---`. Per-slide directives: `<!-- class: title -->`, `<!-- class: section -->`,
`<!-- notes: … -->`.

---

## Contributions

| Key | Default | What it does |
|---|---|---|
| `contrib.sessionGapMinutes` | `120` | A gap longer than this starts a new working session |
| `contrib.firstCommitCredit` | `30` | Minutes credited to a session's first commit |
| `contrib.reworkWindowDays` | `3` | A file re-touched inside this window counts as rework |
| `contrib.since` | `null` | Limit history, e.g. `"2026-01-01"` |
| `contrib.aiCoAuthorPattern` | `(claude\|gpt\|copilot\|gemini\|codex)` | Which `Co-Authored-By` trailers count as an agent |

**Active hours are an estimate and are labelled one everywhere.** They are computed from commit rhythm, not
time worked, and are a floor: thinking that produces one commit registers `firstCommitCredit` minutes.

---

## Tokens — a different source, and the only one that is not the repository

| Key | Default | What it does |
|---|---|---|
| `tokens.transcriptRoot` | `~/.claude/projects` | Where session transcripts live |
| `tokens.since` | `null` | ISO date; messages before it are excluded and counted as such |
| `tokens.rates` | `null` | `{ model: { input, output, cacheWrite, cacheRead } }` — **per million tokens** |
| `tokens.ratesAsOf` | `null` | The date those rates were correct. Printed with any cost figure |

`atlas tokens` is the **only** command that reads session transcripts, and nothing else in the tool touches
them. That separation is deliberate:

- Transcripts are **not in the repository** — machine-local, unversioned, gone if cleared. Unlike every other
  figure the tool reports, these are **not reproducible from a clone**, and the report says so.
- They contain **every prompt, every file read and every secret** that passed through a session. The report
  therefore aggregates only: counts, sums, model names and tool *names*. Never prompt text, never a path,
  never a tool argument. There is a test asserting it.
- Writing a report into the output directory is **refused** — that directory is pushed to wikis and Pages
  branches, and a token report there is a prompt log there.

**On cost:** prices are not in the transcript and they change, so no cost appears unless you configure rates,
and the report prints the date you entered them. A model with no rate is **named and excluded**, never
silently dropped.

**On reading the numbers:** the split matters far more than the total. A turn re-reads its whole context, so
cache reads dominate — measured at **98.7% of 11.9 billion tokens** on one real project. A single "tokens
used" figure would treat that as equal to fresh input, which is what makes a cheap session look expensive.

---

## Publishing

| Key | Default | What it does |
|---|---|---|
| `publish.wiki.slug` | detected from `origin` | `owner/repo` |
| `publish.wiki.sourceBranch` | `"main"` | Branch the do-not-edit banners link into |
| `publish.wiki.stripPrefixes` | `["docs/"]` | Trimmed before flattening a path into a page name |
| `publish.pages.branch` | `"gh-pages"` | Branch the site is force-pushed to |

**Nothing publishes without an explicit `--push`.** The default stages to a temp directory and prints what
would go where.

---

## Search

| Key | Default | What it does |
|---|---|---|
| `searchBodyLimit` | `6000` | Characters per document entering the client-side search index |

The index is one file the browser loads up front, so this is a real budget: at 20,000 a 400-document corpus
produced 3.3 MB. Documents past the limit are **counted and reported**, never silently truncated.
