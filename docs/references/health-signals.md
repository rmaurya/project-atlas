# Rot signals — the full catalogue

Nine mechanical checks. Every one is a **fact about the repository**, never a judgment about quality. "This
link points at a file that does not exist" is checkable; "this document is badly written" is not, and a tool
that mixes the two teaches people to distrust both.

---

## The blocking / advisory split

**This is the design's load-bearing compromise.** Get it wrong and the report is ignored within a week.

**Blocking** (`H1`, `H3`, `H8` by default) — defects with **no legitimate cause**. There is no repository in
which a link to a nonexistent file is correct. These exit non-zero and can gate a commit.

**Advisory** (everything else) — real signals with **legitimate exceptions**. An archived record *should* cite
code that has since moved. A historical specification *should* name a retired product. These are reported and
exit zero.

> **Do not promote an advisory signal to blocking to "raise standards."** You will train everyone — including
> yourself — to ignore the whole report. If a signal fires constantly and correctly, the fix is a suppression
> with a reason, not a stricter gate.

**Read the delta, not the absolute.** After the first run, absolute counts are noise. What matters is what
appeared since last time.

---

## H1 · Dead internal link — *blocking*

A relative markdown link whose target does not exist.

**Detection:** the link is resolved relative to the linking document; if no file exists there — markdown or
otherwise — it fires. A link to a real non-markdown file (an image, a script) does **not** fire.

**Why blocking:** there is no correct version of this. Either the link is wrong or the target moved.

**Fixing:** check whether the document *moved* before assuming the link is wrong. A moved document means every
link to it is now wrong, and fixing them one at a time will take three passes.

---

## H2 · Unresolvable code citation — *advisory*

A `path:line` citation naming a file that is gone, or a line past the file's end.

**Detection, and the important subtlety:** documentation cites code as `brain.ts:301` far more often than as
`src/ai/brain.ts:301`. Treating a bare filename as a repo-root path marks almost every citation broken — this
was **measured at 77% false positives** before the resolver existed. So the resolver tries, in order: the
literal path; a unique path *suffix* (`ai/brain.ts`); a unique *basename*. If a basename matches more than one
file, it resolves to **nothing** and is reported under *"Not checked"*.

**Why it never guesses:** an ambiguous citation resolved by guessing would have its line number verified
against the *wrong file*, and a confident wrong answer is worse than a declared unknown.

**Why advisory:** a historical document citing since-deleted code is behaving correctly.

**Fixing:** write full paths. It is the only way to make a citation checkable.

---

## H3 · Duplicate title — *blocking*

Two documents claiming the same `#` heading.

**Why blocking:** this is the signature of a **forked document**, and forked documentation is the failure this
whole tool exists to prevent. On the corpus this was built against it immediately found two user manuals
differing only by a hyphen in the filename — one of them still using a product name retired a month earlier.

**Fixing:** decide which is authoritative. Merge, then retire the other with a status header pointing at the
survivor. Do not delete it — the redirect is worth more than the disk space.

---

## H4 · Orphan — *advisory*

No other document links to it.

**Expect this in bulk on the first run**, and do not treat it as a to-do list. Index files are exempt.

**Why advisory:** whole categories of document are legitimately unlinked. Session logs and work records are
found by date and by search, not by navigation.

**Fixing:** for anything meant to be *found*, link it from the index. For records not meant to be navigated,
suppress the directory with a stated reason.

---

## H5 · Unclassified — *advisory*

Fell through every cluster rule into the fallback.

**Fixing:** add a rule, or reclassify. A large fallback count is a **missing taxonomy rule, not a problem with
the documents**. Set `fallbackCluster: null` to make this blocking if you want strict classification.

---

## H6 · Stale against its citations — *advisory*

The document cites code that was committed **after** the document was last touched.

**Detection:** compares exact commit timestamps (not dates — day granularity cannot order two changes made on
the same day). Only fires for documents older than `staleDays`, so a document edited last week is never stale.

**Choosing `staleDays`:** the default is 90. On a fast-moving repository that is far too lax — one corpus at
234 documentation commits per six weeks needed **30** before the signal said anything useful. Tune it until it
reports something you would act on.

**Why advisory:** an archived record is *supposed* to describe the code as it was.

**Fixing:** re-read the cited code and update the document, or add a status header saying it describes a past
state.

---

## H7 · Forbidden term — *advisory*

Contains a term the project has retired — an old product name, old branding, a renamed concept.

**Configured, not built in:**

```json
"forbiddenTerms": [
  { "term": "OldName", "reason": "renamed 2026-01", "ignore": ["docs/archive/**", "docs/logs/**"] }
]
```

**Why advisory, and why `ignore` matters:** the historical record *should* contain the old name. Exempt
archives and session logs, or this fires forever on documents that are correct.

---

## H8 · Missing title — *blocking*

No `#` heading, so the document has no name in any index.

**Why blocking:** it costs one line to fix and the document is unnavigable without it.

---

## H9 · Cross-reference asymmetry — *advisory*

An identifier appears in one of a paired set of documents but not the other.

```json
"crossref": [
  { "id": "plan", "a": "docs/BACKLOG.md", "b": "docs/TASKS.md", "pattern": "\\b[A-Z]-\\d+\\b" }
]
```

**Why advisory, emphatically:** asymmetry is often *by design*. On one corpus, 15 of 17 module-scale items
lived in the task list and not the backlog, deliberately — the backlog reasons an item out, the task list
counts everything. Establishing that took a grep, which is exactly the work this signal saves. **It is a
prompt to check, never a defect.**

---

## Suppression

```json
"suppress": [
  { "signal": "H6", "path": "docs/logs/**",
    "reason": "Session records are historical by nature. Citing code as it was on the day is correct behaviour, not rot." }
]
```

**The `reason` is mandatory** — the config is rejected without it. An unexplained suppression is a defect: six
months later nobody can tell a considered exemption from someone silencing an inconvenient warning.

Suppressed findings are still **counted** and reported as a total. Nothing is silently dropped.

---

## "Not checked"

Every report ends with what could **not** be evaluated and why: git unavailable, `forbiddenTerms` unconfigured,
ambiguous citations skipped.

**Read it aloud when reporting.** A check that did not run is not a check that passed — and a report that
quietly omits its own gaps reads as "everything is fine" when it is not. This has bitten this tool itself: a
git-metadata bug once meant staleness evaluated nothing while the report showed `ok`.
