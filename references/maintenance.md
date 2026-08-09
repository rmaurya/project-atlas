# Maintenance — keeping it true

A generator does not keep documentation honest. A **procedure with a trigger** does.

Documentation surfaces go unfed. That is the normal outcome, not the unlucky one, and any design that assumes
otherwise fails quietly. This file is the part that decides whether the tool is still useful in three months.

---

## The trigger

**A session touched documentation.** Not a schedule, not a sprint ritual, not "periodically".

Run it the way you run tests: because you changed something, before you commit.

```bash
node scripts/atlas.mjs health   # what did I just break?
node scripts/atlas.mjs build    # regenerate
```

Commit the regenerated output **in the same commit as the source change**, so the wiki and the documents are
never more than one commit apart. That single habit removes the entire class of "the site is three weeks
behind the docs" problems, because there is no window in which it can be.

---

## The loop

1. **Change the source markdown.** The `.md` files are the only thing anyone edits.
2. **`health`.** Read the *delta* — what appeared that was not there before.
3. **Act on new signals.** Blocking findings get fixed now. New advisory findings get fixed, suppressed with a
   reason, or filed. **Never left silently** — an unexamined advisory finding is how a report becomes noise.
4. **`build`.**
5. **Commit together.**

---

## What is mechanical, and what is yours

**Mechanical** — the index, taxonomy assignment, backlinks, staleness, every signal, search, all HTML. Runs on
one command, needs no judgment, cannot be forgotten because the build does it.

**Yours** — four things, none automatable, all landing as reviewable diffs:

1. **Classify** a new document into a cluster (a one-line config edit).
2. **Maintain the overview pages** — the only prose the system adds.
3. **Act on signals** — merge a fork, fix a citation, retire a superseded document, suppress with a reason.
4. **Re-stamp dates.** An undated page is a page that will be trusted after it stops being true.

---

## Reporting a health run

**Lead with the delta.** Absolute counts are noise after the first run; "three new dead links since Tuesday"
is actionable, "252 orphans" is wallpaper.

**Read the "Not checked" section aloud.** A check that did not run is not a check that passed. This tool has
itself shipped a bug where git metadata silently failed to load — staleness evaluated nothing and the report
showed `ok`. The section exists because of that, and skipping it defeats the point.

**Never fix advisory findings in bulk.** A hundred-file diff is unreviewable, which means unverified, which
means you have traded a visible problem for an invisible one.

---

## Suppression discipline

Suppress when the signal is **correct and permanently uninteresting** — session logs will always be stale,
archives will always contain retired names.

Do **not** suppress because a finding is inconvenient. The `reason` string is mandatory precisely so that, six
months later, a reader can tell a considered exemption from someone silencing a warning. Write the reason for
that reader.

---

## The abandonment trigger

Name it in advance. It is cheaper now than the argument later.

A workable one: **if after 30 days the blocking-signal count has not fallen, the tool is not being maintained.**
Stop adding to it. Keep the generator and the index — they cost nothing and cannot rot — and drop the rest.

Concluding that the index alone was the whole value is a **success**, not a failed project. Most of the value
in this tool is in the first hour.
