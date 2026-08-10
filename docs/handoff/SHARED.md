# Shared handoff

What the **project** has decided and what will bite **anyone** — not what any one person was in the middle
of. Personal working state lives in `docs/handoff/<contributor>/`, one directory each, so two people writing
at once never touch the same file.

The split is the point. A decision recorded in someone's personal notes is a decision the team does not have;
a half-finished thought recorded here is noise for everyone else. **If it constrains other people, it belongs
in this file. If it only helps you resume, it belongs in yours.**

Everything derivable lives elsewhere and is not repeated here — the plan is [`../ROADMAP.md`](../ROADMAP.md),
the history is `git log`, the corpus is `atlas health`. **If a fact here can be read from the repository,
delete it from this file.** A handoff that duplicates derived state goes stale exactly the way this project
exists to detect, and there is a standing warning at the top of `ROADMAP.md` about precisely that failure.

**Last handed off:** 2026-08-10, at `b36e260` · version 0.1.35

---

## Where things stand

Green on all nine CI checks including both Windows jobs — the first time since the matrix was added. Wiki,
Pages and the artifact export are all live and current.

| Surface | State |
|---|---|
| `main` | `b36e260`, v0.1.35, CI green |
| Wiki | published, 36 pages, manifest readable so the drift guard actually works |
| Pages | live, deployed **by workflow** (`pages.yml`), not from a branch |
| Artifact | whole site as one page, private, a snapshot rather than live |
| Tests | 234 passing, 1 skipped on Windows by name |

## Decided, so don't re-litigate

- **Autonomy stops at the repository edge.** Derived state may maintain itself; pushing, publishing and
  sharing never happen unattended, and that is not a config option. Full reasoning in
  [`../references/autonomy.md`](../references/autonomy.md). Raised as "make it fully autonomous", answered with a
  stated boundary rather than a flag.
- **`gh-pages` must not exist here.** Pages deploys from a workflow, so a pushed branch serves nothing and
  GitHub advertises it for days. One was created and deleted on 2026-08-10; `atlas publish --target pages`
  will happily recreate it, which is the open bug below.
- **`--force` on a wiki publish is never sticky.** Each publish re-runs the drift check and asks again.

## Traps, each of which has already cost time

- **`atlas` on `PATH` is the installed plugin, not this checkout.** Use `./bin/atlas` to test local changes.
  Verifying a fix against the installed build and seeing the old behaviour is a wasted round trip; `atlas
  version` names which build answered.
- **The commit guard cannot read a message on stdin.** `git commit -F -` fails the plan gate. Use
  `-m` or `-F <file>`.
- **The guard inspects the command text before it runs**, so chaining `atlas branch … && git commit …` is
  evaluated while still on the protected branch and refuses. Run them as separate commands.
- **Percentages live in the grid table at the top of `ROADMAP.md`**, not inline beside each item. An item
  without a row there is reported as "without a figure".
- **A test that copies the logic it tests cannot fail when that logic is wrong.** Three copies of the
  transcript-slug derivation kept Windows red through a release that had already fixed the product.

## Open, not yet started

- **`atlas publish --target pages` should refuse on workflow-deployed repositories.** It cannot currently
  tell: `/repos/{owner}/{repo}/pages` needs authentication, and the probe sends none.
- **Authenticated probe** — read `GITHUB_TOKEN` / `GH_TOKEN` when present. Unlocks the refusal above, private
  repository detection, and 5,000 requests/hour instead of 60. Deliberately *not* a `gh` dependency: `git` is
  the only external binary this tool runs, and that is worth keeping.
- **Dashboard discoverability.** The build prints `Open: …/index.html` and never the dashboard's path, and
  the index labels it "Overview". Two people have now had to ask where it was.
- **Track 6 — Autonomy**, A-1 to A-9, designed and unbuilt. A-1 is the foundation; A-8 is the one you feel.

## Running it

```bash
./bin/atlas all        # scan + health + build, against this checkout
node tests/run.mjs     # 233 tests, no mocks, throwaway git repositories
./bin/atlas watch      # rebuild on change; the open page reloads itself
```

CI logs need authentication. `gh` is not installed here; the REST API with a token works
(`/actions/jobs/{id}/logs`), and reading the real log beat guessing twice on the Windows failure.
