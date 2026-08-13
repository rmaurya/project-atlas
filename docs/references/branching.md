# Branching

How work reaches `main` in this project, and what an assistant working on it must do.

This exists because the first five commits of project-atlas went **straight to `main`** while its own
`CONTRIBUTING.md` preached discipline. That is the honest reason, and it is the reason worth writing down: a
rule nobody notices being broken is not a rule.

---

## The shape

**`main` is always releasable.** It is the branch CI runs, Pages deploys from, and anyone cloning gets. It is
never a work-in-progress.

**Every change happens on a branch, and reaches `main` through a pull request.** Including small ones.
Especially small ones — the small ones are where "just this once" starts.

```
type/short-slug
```

| Type | For |
|---|---|
| `feat/` | New capability |
| `fix/` | A defect, with a test that fails without the fix |
| `docs/` | Documentation only — no behaviour change |
| `refactor/` | Behaviour identical, structure different |
| `test/` | Tests only |
| `chore/` | Tooling, CI, packaging, dependencies |

The slug is two to four words, hyphenated, describing **the change, not the file**:
`fix/citation-resolver-false-positives`, not `fix/scan-mjs`.

## One logical change per branch

A branch that does two things cannot be partly accepted, cannot be cleanly reverted, and cannot be reviewed
without holding both in your head at once.

The test: **can the branch be described in one sentence without "and"?** If not, split it. "Fix the citation
resolver **and** tidy the CSS" is two branches.

## Before opening a pull request

- `node tests/run.mjs` passes.
- A fix carries a test that **fails without it**. Write the test first and watch it fail; a test that has
  never failed proves nothing.
- `node scripts/atlas.mjs health` reports no new blocking findings.
- The branch does one thing.

## Commit messages

```
type(scope): the finding, in plain language

Why it mattered, what was actually wrong, what it cost.
```

**The subject states the defect, not the patch.** `fix(scan): git metadata never loaded — NUL bytes cannot be
passed in argv` is useful six months later. `fix(scan): update handler` is not.

## Trailers

Two trailers, and the analytics read both. Neither can be added retroactively, so they only work going
forward — which is the whole argument for adopting them before you want the data.

```
type(scope): the finding

Body.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Desk: atlas
```

**`Co-Authored-By`** names the model that assisted. `atlas contrib` reads it for the model-mix panel. Without
it the panel reports 0% AI-assisted — which is what this repository showed for its first eighteen commits,
correctly, because the trailer was missing.

**`Desk:`** names the working context — a machine, a person, an agent lane. It is what makes per-desk
attribution possible when several sessions share one git identity, which is the normal case for a solo
maintainer running more than one agent. With one desk and one author it adds nothing; adopt it anyway, because
`atlas contrib` cannot tag history after the fact.

Set the template once:

```bash
git config commit.template .gitmessage
```

## Merging

Squash-merge into `main`, keeping the branch's subject as the commit subject. CI must be green. Delete the
branch after merge.

**A branch merged with a red CI is a `main` that lies about being releasable.**

---

## For an assistant working on this repository

These are not suggestions. An assistant that commits to `main` because a change "seemed small" has broken the
one rule this file exists to state.

1. **Check where you are before writing anything.** `atlas branch` reports the current branch, whether it
   follows the convention, and whether it is safe to commit there.
2. **If you are on `main`, branch first.** Do not stage, do not commit, do not ask whether it matters.
3. **Name the branch from the work you are about to do**, not from the files you expect to touch. You often do
   not yet know which files those are.
4. **One branch, one sentence.** If the user asks for a second unrelated thing mid-branch, finish and merge
   the first, or start a second branch. Do not let them accumulate.
5. **Never push without being asked.** Branching is local and reversible; pushing is neither. The rule that
   nothing publishes without explicit confirmation covers `git push` too.
6. **Say which branch you are on** when you report work. The user cannot see your shell.

## The commit guard warns and refuses in different cases

`hooks/on-commit.sh` runs three checks before any `git commit`, and they do not all carry the same weight.

| Check | The claim it makes | Verdict |
|---|---|---|
| `atlas health --gate` | a dead link, two documents with one title, a file with no `# ` heading | **refuses** (exit 2) |
| `atlas branch` | you are committing on a protected branch, or off the naming convention | warns |
| `atlas spec --gate` | this shipped change names no plan item | warns |
| any of the three failing to run | the guard is broken | warns, always |

**Blocking is reserved for claims that the repository is wrong.** Nobody can reasonably disagree with a dead
link, and the commit would land known rot. Which branch you are on and whether you named an item are claims
about *how the work is organised* — right, worth saying every time, and still a judgement a person makes.
This is the same line [`autonomy.md`](autonomy.md) draws in keeping H17 advisory, and the same reasoning that
made `branching.posture` a setting rather than a rule.

It was learned the expensive way. For one release the guard refused on all three, and it stalled a live
session: every refusal opened with *"Safe to commit here. Branch follows the convention and is not
protected"* — nothing was wrong — and then blocked because it could not read a commit message that could not
yet exist. A hook runs **before** the shell, so `cat > msg.txt && git commit -F msg.txt` was refused whole,
the file was never written, and the retry failed because the file was missing. One of those refusals was not
a refusal at all but a crash inside the gate. **A guard people disable is worse than no guard.**

So a warning has to earn the interruption: it names the SOP, says why the SOP exists, says what to do, and
gets out of the way. It travels as hook JSON as well as on stderr, because on exit 0 stderr reaches only the
debug log — a "warning" nobody can see is a silent gate.

**To restore the old strictness**, in `project-atlas.config.json`:

```json
{ "branching": { "sopGate": "enforce" } }
```

Then the branch guard, the plan gate, and a gate that could not run all refuse, exactly as they did before.
`ATLAS_COMMIT_SOP=enforce` does the same for one command or one CI job. The default is `warn`.

This is separate from `branching.posture`, which decides whether `atlas branch` itself calls a protected
branch unsafe; `sopGate` decides what the *commit hook* does with that answer.

## When to break this

Genuinely: almost never. But it is a real question, so it gets a real answer.

A hotfix to a broken `main` may go direct if the alternative is leaving it broken while a review waits — and
the commit message must say that is what happened. "It was faster" is not a reason; "`main` was red and this
turns it green" is.
