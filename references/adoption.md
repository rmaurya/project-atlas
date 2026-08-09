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
