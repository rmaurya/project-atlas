# Authoring documentation

**Read this before writing a line of documentation.** It carries the evidence rules, the page shapes, and the
failure modes that actually occur.

The tool generates *structure*. You write the *prose*. That division is the whole safety argument: a build
script emitting unreviewed text is a confident source of wrong facts, whereas a `.md` file you wrote in a
session lands in a diff a human reads before it is believed.

---

## 1. The evidence rules

These are not style. They are what separates documentation from plausible-sounding fiction.

**Every claim about the code cites the code.** `path:line`, and you read that line *in this session*. Not
"I recall this file does X". Not "the architecture doc says X". Read it.

**Prefer a full path over a bare filename.** `src/ai/brain.ts:301`, not `brain.ts:301`. A bare filename that
exists at two paths cannot be verified by anything — the tool will report it as unchecked rather than guess,
and an unchecked citation is a citation nobody can rely on. On one real corpus, 454 citations were
unverifiable for exactly this reason.

**`UNKNOWN` is a valid answer, and usually the valuable one.** A named gap tells the reader where to look. A
gap filled plausibly tells them nothing and costs them a day when they discover it.

> The characteristic failure of a language model writing documentation is not lying. It is **reporting a
> corner as the whole** — describing the part it looked at as though it were the system. Guard against that
> specifically: before writing "the system does X", ask what you actually read, and whether anything else
> could also be true.

**Read the source, not the existing docs.** Documents lag code. An existing document is a *lead* — it tells
you where to look, never what is true now.

**Mark what was checked.** A figure read from source and a figure estimated from a document are different
claims. If you cannot verify something, say so inline: *"reported as ~40% in the task list; not verified
against the code this session."*

**Date every page, and re-stamp when you revise.** An undated page is a page that will be trusted after it
stops being true.

---

## 2. Before you write anything

1. **Search first.** Most repositories contain more documentation than anyone remembers, and some of it is
   better than what you would write. `atlas scan` gives you the shape; grep gives you the specifics.
2. **If a document already covers this, improve it.** A second document on the same subject is how forks
   start — and the tool will flag the duplicate title as a blocking defect, correctly.
3. **Check what the reader already has.** A page that restates the README is a page nobody needs.

---

## 3. Page shapes

### The index (`docs/README.md`)

**The single highest-value page in any corpus, and the one most often missing.** Before any generated site,
before any dashboard: if a newcomer cannot find their way in, nothing else matters.

Keep it navigational. It answers *"where do I look for X"*, not *"what is X"*. Group by what a reader is
trying to do, not by directory. Say which documents are authoritative and which are historical — that
distinction is invisible from a filename and expensive to learn the hard way.

### A cluster overview

One per cluster. Four questions, in order:

1. What is this cluster?
2. What do I read first?
3. What here is authoritative, and what is a historical record?
4. What is *not* here, and where does it live instead?

Short. Navigational. Dated. If it grows past a screen, it has stopped being an overview.

### A developer manual

The document that lets a competent stranger get productive. It is almost always missing, and it is almost
always the highest-value thing you can write.

- **Set up** — exact commands, from a clean clone. Run them; do not transcribe them from memory.
- **Run** — how to start it, and how to tell it worked.
- **Test** — the command, what passes look like, what to do when they don't.
- **The shape of the codebase** — the four or five directories that matter and what lives in each.
- **House rules** — the conventions that are not obvious from reading the code, and *why* each exists.
- **Deploy** — or an honest statement that it is manual.
- **Where to ask** — the escape hatch when the manual is wrong.

Verify every command by running it. A setup guide with one broken step is worse than none, because the reader
now distrusts the other nine.

### An architecture document

Structure, boundaries, and the decisions that produced them. **Record why, not just what** — the *what* is in
the code and will drift; the *why* is nowhere else and is what a reader actually needs.

Cite the code. Say what you did not verify.

---

## 4. Prose

- **Lead with the finding, not the journey.** The reader wants the conclusion; the path is context.
- **Specific beats hedged.** A number, if you have one. If it is estimated, say so.
- **No hedging stack.** "It's probably likely that this might…" — pick one and commit.
- **No self-congratulation.** Not "comprehensive", "robust", "world-class", "seamless". Describe what it does.
- **Structure encodes meaning.** Numbered steps mean the order matters. If it doesn't, use bullets.
- **Absolute dates.** `2026-08-09`, never "last week".

---

## 5. Failure modes

| Symptom | What actually went wrong |
|---|---|
| A confident paragraph with no citation | Written from memory of the code, not a reading of it |
| "The system handles X" | One code path handles X; the rest was never checked |
| A second document on an existing subject | Search was skipped |
| A page that restates the README | Written to look thorough |
| Aspirational documentation of behaviour that doesn't exist | No status header saying so |
| A setup guide that fails at step 3 | Transcribed instead of run |

---

## 6. After writing

Run `atlas health`. If your new page is an orphan, link it from the index — a document nothing points at is
reachable only by people who already know it exists, which is the opposite of why you wrote it.
