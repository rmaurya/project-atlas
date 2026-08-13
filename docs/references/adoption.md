# First run on a repository

The first hour with a new corpus decides whether this tool gets used or ignored. The failure mode is
predictable: run everything, produce a 400-line report, and hand someone a to-do list they will never start.

---

## 1. Measure before you propose

**Never open with a plan.** Run the scan first:

```bash
node scripts/atlas.mjs scan
```

That alone tells you file count, line count, how the corpus clusters, and whether an index already exists. A
proposal written without it is a proposal about an imagined repository — and most repositories contain more
documentation than anyone remembers, some of it better than what you would write.

Report what you found, in numbers, before suggesting anything.

## 2. Generate a config

```bash
node scripts/atlas.mjs init
```

`init` inspects the layout and keeps only the default clusters that actually matched something, so you get a
taxonomy shaped like this repository rather than a generic nine.

Then review it. Two things are worth doing immediately:

- **`forbiddenTerms`** — any retired product name, old branding, renamed concept. Off until configured, and
  the report will tell you so.
- **`crossref`** — paired documents, most commonly a backlog and a task list. Also off until configured.

### The plan, which `init` looks for and will not guess at

`init` also looks for the document `planning.source` should point at — the backlog or task list that drives
the item table, both charts, spec-to-build coverage, the timeline and the commit gate. It looks using the
taxonomy's own Planning globs plus the roadmap rule, so there is exactly one answer in the tool to "what does
a plan document look like": `BACKLOG`, `TASKS`, `TODO`, `HANDOFF`, `PLAN-…`, `…-PLAN`, `ROADMAP`, and
anything under `docs/planning/`.

What it does with what it finds:

| Found | `init` writes | Why |
|---|---|---|
| Nothing | `"planning": {}` | The key is written empty rather than omitted, so it is visible to whoever adds a plan later |
| Exactly one | `"planning": { "source": "…" }` | There is nothing to choose between, and it says on the terminal what it set |
| More than one | `"planning": {}`, and names them all | **This is the normal case, not the edge** |

**Several candidates is normal.** One repository this was tested against offers seven, and three of the seven
parse to zero items. Nothing is picked for you there, because the plan is the spine of the dashboard: the
wrong document does not produce a smaller dashboard, it produces a confident and wrong one. Answer it in one
command instead of an editor:

```bash
node scripts/atlas.mjs init --force --plan docs/DEVELOPMENT-BACKLOG.md
```

**If this repository adopted the tool a long time ago,** `init` has already run and will not run again. Every
`atlas build` prints the same finding in its summary — the candidates, by name, as one advisory line that
gates nothing — and the Backlog page states it too. Neither writes to your configuration: `init` is the only
command that ever does.

Check what a candidate actually yields before committing to it, because "it is named like a plan" and "this
tool can read it" are different claims:

```bash
node scripts/atlas.mjs tasks
```

Zero items is a real answer — a roadmap written as five narrative phases has no items to find, and the
dashboard says which two dialects it looked for and did not match rather than showing an empty page.

## 3. Run health as a *survey*

```bash
node scripts/atlas.mjs health
```

**The first report is a survey, not a to-do list.** Orphans and staleness will fire in bulk on any real
corpus and always will.

Report it in this order:

1. **Blocking findings.** Usually few, usually real. Dead links and duplicate titles almost always indicate
   an actual defect.
2. **The two or three advisory signals that look like genuine problems** — a duplicate title is a forked
   document; a large forbidden-term count means a rename never finished.
3. **The "Not checked" section.** What could not be evaluated, and why.

Do **not** present 250 orphans as work. Say what the number is, say why it is expected, and move on.

## 4. Write the entry point before anything else

If there is no `docs/README.md`, **that single hand-written index is worth more than the entire generated
site.** It is usually a one-session job and it is the thing people actually use. See `authoring.md`.

## 5. Build, then stop

```bash
node scripts/atlas.mjs build
```

Show the user. **Do not go on to reorganise documents in the same pass.** Phase 1 is "the corpus is navigable
and rot is visible" — it modifies nothing that already exists, so it carries no risk and needs no argument.
Acting on what it found is Phase 2, and it should be driven by measured signals rather than by enthusiasm.

---

## Working with an existing docs tree

**Do not restructure on day one.** The existing arrangement usually encodes something, even when it looks
arbitrary. Index it as it is, let the signals accumulate, and reorganise later with evidence.

**Suppress the historical clusters early.** Session logs, work records, changelogs and archives will fire H4
(orphan), H6 (stale) and H7 (forbidden term) forever, all correctly. Suppress those directories with a stated
reason on the first pass, or the report is noise from the start.

**Exclude generated copies of your own documents.** Any directory holding a build output, a vendored copy, or
a mirror of documents that also live elsewhere will make every one of them a duplicate title — a blocking
signal, and correctly so, since two files claiming one H1 is the forked-document signature. Excluding it is a
one-line change and the alternative is a permanently red report.

**Watch for the fallback cluster.** A large `Uncategorised` count is a missing rule, not a problem with the
documents. Add rules until it is small enough to read.

**Order matters in the taxonomy.** First match wins, and **filename patterns must come before directory
patterns**. A repository that keeps its SOPs under `docs/architecture/` will otherwise have every one of them
swallowed by the directory rule, and the Procedures cluster reads as empty when it is in fact full.

---

## Committing the output

Two defensible positions:

- **Commit `docs/_wiki/`** — anyone who clones gets a browsable wiki with no build step. Costs a large derived
  diff on documentation commits, though a rebuild with no source change produces an empty diff.
- **Git-ignore it** — clean history, but the wiki only exists where someone has run the build.

Commit it if collaborators matter; ignore it if only you use it. Either way, the output directory is safe to
delete at any moment.

---

## What to say when someone asks "is this worth it?"

The honest answer, and the one that holds up: **Phase 1 costs one session and modifies nothing.** An index and
a generator do not rot. If nobody opens the site in a month, you have lost an afternoon and kept a working
index. Name that trigger in advance — it is cheaper than arguing about it later.
