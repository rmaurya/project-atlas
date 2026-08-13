# Rot signals — the full catalogue

**Seventeen mechanical checks: sixteen about the corpus, and one about the operator.** Every corpus signal is
a **fact about the repository**, never a judgment about quality. "This link points at a file that does not
exist" is checkable; "this document is badly written" is not, and a tool that mixes the two teaches people to
distrust both. H17 is the exception and is labelled as one everywhere it appears — it measures how a session
was run, not what is in the tree.

*This page opened with "Nine mechanical checks" for as long as H10–H16 had been shipping, and described the
blocking set as three when it had been five since the SOP work. It is linked from `skills/build/SKILL.md` as
**the full catalogue**, so the gap was not a stale sentence but a missing half of a document other documents
delegate to. `tests/run.mjs` now fails when a signal in the code has no section here.*

**The catalogue lives in two files, on purpose.** `scripts/lib/signals.mjs` holds H1–H16; H17 is defined in
`scripts/lib/health.mjs` and joined to them only at the point of rendering. A consumer that wants claims about
the repository imports the first; a consumer rendering the whole report imports the second. Keeping them apart
is what makes "H17 is not a rot signal" enforceable rather than merely stated.

---

## The blocking / advisory split

**This is the design's load-bearing compromise.** Get it wrong and the report is ignored within a week.

**Blocking** — `H1`, `H3`, `H8`, `H10`, `H12` by default (`scripts/lib/config.mjs:245`). Defects with **no
legitimate cause**. There is no repository in which a link to a nonexistent file is correct, and no reading of
an SOP past its own review date under which the review happened. These exit non-zero and can gate a commit.
The set is overridable per repository, and an id in `blocking` that names no signal is reported rather than
silently ignored — a gate that never fires is worse than no gate.

**Advisory** (everything else) — real signals with **legitimate exceptions**. An archived record *should* cite
code that has since moved. A historical specification *should* name a retired product. These are reported and
exit zero.

**Advisory in code, not by configuration** — `H17` alone. Naming it in `blocking` loads without error and
still does nothing (`scripts/lib/health.mjs:124-125`). See its section below for why.

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

## H10 · SOP past its review date — *blocking*

A standard operating procedure has exceeded the review interval **it declared for itself**.

**Detection:** a document is treated as an SOP when its path matches `sop.match` — by default `**/sop/**`,
`**/SOP-*.md`, `**/*-sop.md`, `**/runbook*/**`, `**/*-runbook.md` (`scripts/lib/sop.mjs:38`). Its obligations
are read from front matter *or* from a bolded `key: value` line near the top, because both spellings are in
the wild. An SOP naming no interval is judged against `sop.reviewDays`, default **180**
(`scripts/lib/sop.mjs:41`). Every document in one run is measured against the same day, taken once.

**Why blocking:** most documentation degrades gently — a stale architecture note is misleading and a reader
who knows the code can tell. **An SOP degrades into incorrect instructions somebody follows**, and the cost
lands on whoever trusted it, who is the person least able to notice. Exceeding a deadline the document set
itself has no innocent reading: the check the document said was required did not happen.

**Fixing:** do the review, then update `last-verified`. **Never bump the date to clear the signal** — the
tool refuses to write that field for exactly this reason, and doing it by hand is the same lie by another
route.

---

## H11 · SOP has no live owner — *advisory*

It names no owner, or names one with no commits in this repository.

**Detection:** the owner is compared against every author in `git log` (`scripts/lib/health.mjs:38`). When git
cannot answer, the list is empty and the check degrades to "is an owner *named*" — never to "this owner is
wrong", because *git could not answer* and *this person does not exist* are different facts.

**Why advisory:** people leave, names are spelled inconsistently, and a repository with one contributor
legitimately has an owner git has never seen. Refusing a commit over a spelling teaches people to suppress
the signal, and then it protects nothing.

---

## H12 · Dead citation in an SOP — *blocking*

A `path:line` in a procedure that cannot be resolved.

**Detection:** it reuses the resolution H2 already did rather than re-resolving, so there is one answer to
"does this path exist" (`scripts/lib/health.mjs:394-398`).

**Why blocking, when H2 is not:** the same fact, judged by a stricter rule because the document is a
procedure. An unresolvable citation is untidy in a design document; in an SOP it means **the step referring
to it cannot be followed**.

---

## H13 · Handoff far behind HEAD — *advisory*

A handoff names the commit it was written against, and the repository has moved a long way past it.

**Detection:** the distance in commits between the named commit and `HEAD`, against `handoff.staleAfter`,
default **50** (`scripts/lib/handoff.mjs:31`). Reported **per contributor**, because handoffs are per
contributor and a shared count would say "one handoff is stale" about a team of six and name nobody. When git
cannot resolve the named commit the distance is *unknown*, and an unknown distance is reported as unknown
rather than as current.

**Why advisory:** a stale handoff is a cost, not a hazard, and a blocking signal on a document this subjective
would train people to suppress it.

---

## H14 · Design document cites code that moved — *advisory*

A design document has citations that no longer resolve.

**Detection:** the same broken-citation set as H2, restricted to documents the design record recognises, and
**with no grace period** — unlike H6, which waits for `staleDays`.

**Why stricter than H6:** a design document is a *claim about how the code works*. When the code it cites has
moved, the claim is wrong rather than merely aging, and there is no grace period for wrong.

**Why still advisory:** an archived or superseded design document is *supposed* to describe the code as it
was. Retire it with a status header rather than suppressing the signal for the whole directory.

---

## H15 · Expected design artifact absent — *advisory*

A kind of design document the record normally carries is missing entirely, or exists only as a scaffold.

**Detection:** eight kinds are recognised (`scripts/lib/design.mjs:45`) — high-level design, low-level design,
architecture overview, data flow, decision records, specifications, product requirements, and a manual of
style. **A stub is not an absence**: a scaffold that names the questions it owes an answer to is a different
state from nothing at all, and the two are reported separately. The finding has no document to attach itself
to, so it is marked as a corpus-level finding and the renderer prints the subject as text rather than minting
a link to a page that was never written.

**Why advisory:** a small repository legitimately has no LLD, and a tool that demands one is asking for a file
rather than for design.

**Fixing:** `atlas design --scaffold` writes the questions, never the answers.

---

## H16 · Undesigned area — *advisory*

A directory of source files that no design document cites.

**Detection:** tracked code files are grouped two directories deep and matched against the citations in the
design record. Areas of fewer than **two** files are ignored — one file is not an area worth a design
document, and listing them buries the ones that are.

**Unevaluated, never clean.** The file list comes from `git ls-files`; when that cannot run — no repository,
or `--no-git` — H16 declares itself unevaluated (`scripts/lib/health.mjs:443`). The first version of this
checked a property that did not exist, so the signal silently never ran and printed `ok`, which is precisely
the lie the *Not checked* section exists to prevent.

**Why advisory:** not everything needs a design document. This is a question — *which important area has
none?* — rather than an accusation.

---

## H17 · Large session, no subagent — *advisory, and it can never block*

**This one is not about the corpus, and it is labelled as such everywhere it appears.**

H1–H16 are statements about the repository, every one settled by reading the files. H17 is a statement about
**how a session was run**: it made 40 or more file edits in its main thread and never delegated a single turn
to a subagent, so independent work that could have run at the same time ran one item after another.

**Detection:** local session transcripts, read by `atlas tokens`' machinery and **passed in** — `health.mjs`
opens nothing itself. Only edits in the main thread count; work a subagent did is not charged to the operator
who delegated it. Sessions carrying no edit or subagent count are excluded and the exclusion is reported.

**Where the threshold comes from.** 40 is the 25th percentile of the edit counts of the sessions that *did*
fan out, over the 29 transcripts on the machine where it was written. Below it the sample is dominated by
read-and-answer work, which is exactly the work that should not be fanned out: 20 of the 29 made fewer than 40
edits and 9 made none at all. On that sample the rule fires twice — a note, not a nag. Change it with
`tokens.parallelismEdits`.

**Why it can never block, and why that is enforced in code.** A dependency chain has to be worked in order,
and a task small enough that coordination costs more than the parallelism is correctly done alone. This signal
cannot tell those apart from a missed opportunity. The blocking set is reserved for claims that the
*repository* is wrong; "you should have parallelised" is an opinion about somebody's afternoon. Naming H17 in
`blocking` is accepted by the config loader — an unknown-but-well-formed id is a warning so that a config
written for a newer build still loads — and `blockingFor` refuses it anyway
(`scripts/lib/health.mjs:124-125`).

**Unevaluated, never "ok".** With no transcript to read, H17 reports as not evaluated
(`scripts/lib/health.mjs:458`). "Not measured" is not the same claim as "nothing to report".

**Reading it:** it is a prompt to say "these three are independent, these two are a chain" out loud before
starting, which is most of the skill. It is not a target.

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

Every report ends with what could **not** be evaluated and why: git unavailable (H6, and H16 with it),
`forbiddenTerms` or `crossref` unconfigured (H7, H9), ambiguous citations skipped (H2), no session transcript
to read (H17).

**Read it aloud when reporting.** A check that did not run is not a check that passed — and a report that
quietly omits its own gaps reads as "everything is fine" when it is not. This has bitten this tool itself: a
git-metadata bug once meant staleness evaluated nothing while the report showed `ok`.
