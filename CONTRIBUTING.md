# Contributing

Thanks for looking. This is a small, opinionated tool, and the opinions are the point — please read them
before proposing a change that removes one.

## Running it

```bash
node tests/run.mjs               # the whole suite
node tests/run.mjs --filter H6   # a subset, matched against test names
```

76 integration tests. They build real git repositories in a temp directory and run the real pipeline — there
are **no mocks**, because the bugs this tool has actually shipped were all in the seams between the code and
git, and a mock would have hidden every one of them.

No dependencies, no build step, no test framework. `node tests/run.mjs` is the entire contract.

## The non-negotiables

A pull request that breaks one of these will be declined even if the code is good.

**1. The markdown is the source of truth. Everything generated is derived.**
Delete the output directory, rebuild, get a byte-identical result. There is a test for this. Any feature that
gives the tool its own copy of a fact is out of scope — that copy will drift, which is the exact failure the
tool exists to detect.

**2. No prose is generated at build time.**
The tool emits structure. Humans (or an assistant, in a session, in a reviewable diff) write prose. Unreviewed
generated text at scale is a confident source of wrong facts.

**3. A check that could not run is never reported as passing.**
Every report carries a "Not checked" section. This rule exists because the tool once shipped a bug where git
metadata silently failed to load: staleness evaluated nothing and the report said `ok`. If your change can
fail partially, it must say so.

**4. Nothing is silently dropped.**
Truncated, sampled, skipped, suppressed — all of it gets counted and stated. Suppressions require a written
reason, enforced by config validation.

**5. Unknown is not zero, and estimated is not measured.**
An item with no figure is charted as unknown and excluded from means. A figure a source marks as estimated is
drawn hatched. Flattening either distinction is lying quietly.

**6. No combined contribution score, and no leaderboard of people.**
Commits, files, churn and surviving lines are reported side by side. Collapsing them into one number hides
which one is driving it, and ranking people by it is the one output this tool refuses to produce.

**7. Prompt quality is not measured.**
A repository cannot see a prompt. Outcome proxies ship under their real names — rework rate, revert rate,
message conformance — never relabelled as something they are not.

## Colour

Charts use a **single-hue ordinal ramp** and a reserved status palette. There is no categorical palette,
because no chart here has identity as its job.

If you change a colour, **re-run the validator** — do not eyeball contrast:

```bash
node validate_palette.js "#b9a3fa,#8a5cf6,#4f2ea8" --mode light --surface "#f7f6f4" --ordinal
```

Every ramp must pass in **both** light and dark against the surface it actually sits on. Status colours never
appear without a text label.

## Code style

- Match the surrounding code.
- **Comment the *why*, never the *what*.** A comment recording a real failure — "measured at 77% false
  positives before this existed" — is worth ten explaining syntax.
- Errors degrade: one malformed input is reported and skipped; the run continues. But a *programming* error
  must surface, not be absorbed by a bare `catch`.
- Zero runtime dependencies. This is a hard constraint, not a preference: the tool has to run in any
  repository with `node` and no install step.

## Tests

**A bug fix comes with a test that fails without it.** Several existing tests carry a comment saying what went
wrong and how it was found — keep that habit. Two were only caught by opening the output in a browser, and
they say so.

Name tests for the behaviour, not the function: `H2 does NOT fire for ambiguous citations` beats
`test extractCitations`.

## Branching

`main` is always releasable. Every change reaches it through a branch named `type/short-slug` and a pull
request — including small ones, especially small ones. Run `node scripts/atlas.mjs branch` to check where you
are. Full rules, and the honest reason they exist, in [`docs/references/branching.md`](docs/references/branching.md).

## Commits

```
type(scope): the finding, in plain language
```

The subject states the defect, not the patch. `fix(scan): git metadata never loaded — NUL bytes cannot be
passed in argv` is useful in six months. `fix(scan): update handler` is not.

## Reporting a bug

Include the repository shape (`atlas scan` output is ideal), the command, what you expected, and what
happened. If the tool reported something as clean that was not, say so prominently — that is the most serious
class of bug here.
