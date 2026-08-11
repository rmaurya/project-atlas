# Disclaimer — what the reports do not guarantee

**Last verified: 2026-08-11.**

**project-atlas reports mechanical facts about a repository. It does not know whether your documentation is
true, and it never claims to.** Everything below follows from that one sentence.

This page is about the *output*. For the terms you accept by installing it, see [TERMS.md](TERMS.md).

---

## The tool never verifies that a document is correct

Every check is a fact about the repository, never a judgment about quality — the catalogue module says so in
its own header: *"'this link points at a file that does not exist' is checkable; 'this document is badly
written' is not, and a tool that mixes the two teaches people to distrust both"*
(`scripts/lib/health.mjs:4-6`).

So the checks answer questions like *does this link resolve*, *does this `path:line` exist*, *do two documents
claim the same title*, *has cited code been committed since this document was last touched*. They do not
answer *is this paragraph accurate*, *is this advice good*, or *does this describe the system as it is today*.

**Internal consistency is not truth.** A document can pass every signal in the catalogue and still be wrong in
every sentence: perfectly resolving links to files whose contents contradict it, citations that point at real
lines that say the opposite, a title nobody else uses. The tool would report it clean, and would be correct to
— nothing it measures was violated.

## A clean health report is not a statement that the documentation is correct

`atlas health` printing **"No blocking findings"** means exactly this: *no signal configured as blocking fired
on the documents that were checked, with the suppressions in force*. It means nothing more.

Three qualifiers hide inside that sentence, and the tool prints all three rather than letting them be assumed:

- **On the documents that were checked.** Discovery is scoped by `include` (`scripts/lib/config.mjs:230`),
  `exclude` (`scripts/lib/config.mjs:231`) and `roots`, and defaults to tracked markdown only
  (`scripts/lib/config.mjs:237`). Anything outside that scope was never looked at.
- **With the suppressions in force.** Every suppression requires a stated reason and the config is rejected
  without one, but a suppression is still a check that deliberately did not fire.
- **A check that could not run is never reported as passing.** Anything skipped goes into the report's
  "Not checked" section rather than being folded into the clean count. Read it.

## Advisory signals have legitimate causes

The blocking/advisory split is the design's load-bearing compromise, and it exists because **advisory signals
fire on documents that are correct**: *"an archived record SHOULD cite code that has since moved"*
(`scripts/lib/health.mjs:8-10`).

The catalogue is explicit about this, signal by signal — the `why` strings in `scripts/lib/signals.mjs:13-53`
name the legitimate exception where there is one:

| Signal | Fires on | And is often fine because |
|---|---|---|
| **H4** Orphan | Nothing links to the document | Templates, per-contributor handoffs and community files are reached from outside the corpus |
| **H5** Unclassified | It matched no cluster rule | The taxonomy is yours; a document with no cluster is a config gap, not a defect |
| **H6** Stale against citations | Cited code was committed after the document was last touched | The document may be a historical record, or the commit may have been a rename |
| **H7** Forbidden term | It uses a retired name | A changelog or an archived spec *should* name the product it shipped under |
| **H11** SOP has no live owner | The owner names nobody with commits here | *"people leave and names are spelled inconsistently"* (`scripts/lib/signals.mjs:43`) |
| **H15** Expected design artifact absent | No LLD, no PRD, no manual of style | *"a small repository legitimately has no LLD, and demanding one would be cargo cult"* (`scripts/lib/signals.mjs:50`) |
| **H16** Undesigned area | Code no design document cites | *"this is a question rather than an accusation"* (`scripts/lib/signals.mjs:52`) |

**An advisory finding is a place to look, not a defect to fix.** A campaign to drive the advisory count to zero
produces an unreviewable diff, which is an unverified one.

## It can be wrong in both directions

**False positives.** A citation the resolver cannot place is reported as unresolvable even when the file is
there — a bare filename that exists at two paths is deliberately reported as unchecked rather than guessed at,
and on one real corpus 454 citations were unverifiable for exactly that reason
([`docs/references/authoring.md`](../references/authoring.md)). H6 compares commit timestamps, so a
whitespace-only reformat of a cited file makes every document citing it look stale.

**False negatives, which matter more.** Nothing detects a document that is confidently, fluently wrong. Nothing
detects a document describing behaviour that was removed a year ago, if the file it cites still exists at that
line. Nothing detects an omission. **The absence of a signal is the absence of a signal.**

## The generated site is derived, and only as good as its source

Every page in the output is derived from committed markdown; delete the output directory, rebuild, and the same
bytes come back. That property makes the site trustworthy *as a view of your documentation* — and says nothing
at all about whether the documentation is right. **A faithful rendering of a wrong document is a wrong page.**

Figures on the dashboard come from the files and from `git log`. None of them measures difficulty or prompt
quality: a repository cannot see a prompt, and a turn on a hard problem and a turn on a typo count the same.
Active hours are estimated from commit rhythm and are a floor, not a timesheet. There is deliberately no
combined contribution score and no leaderboard of people.

## Where writing comes from

**The build script never generates prose.** The tool generates *structure*; a human — or an assistant in a
session, landing in a diff someone reads — writes the words. That division is the whole safety argument, and it
is why nothing here can be a confident source of wrong facts *of its own invention*. It can, of course, present
your own wrong facts beautifully.

Where the tool has nothing to say, it says so rather than filling in. `atlas design --scaffold` writes the
questions an artifact has to answer and refuses to answer them, marking the file as a stub until a person
writes the substance (`scripts/lib/scaffold.mjs:127`, marker at `scripts/lib/design.mjs:37`).

## No liability

Nothing on this page creates a warranty, and none of these reports comes with one. **The owner, any related or
respective companies, and every contributor are not liable for decisions taken on the strength of this tool's
output.** See [TERMS.md](TERMS.md), and note in particular that liability disclaimers are not enforceable to
the same extent in every jurisdiction — the terms state intent, not a guaranteed outcome.

---

## Related

- [TERMS.md](TERMS.md) — the terms, and the questions a lawyer would still have to answer.
- [PRIVACY.md](PRIVACY.md) — what is read, written and transmitted.
- [THIRD-PARTY.md](THIRD-PARTY.md) — the dependency position.
- [`docs/references/health-signals.md`](../references/health-signals.md) — the full catalogue, with detection
  details and legitimate exceptions.
