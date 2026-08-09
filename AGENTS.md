# project-atlas — portable agent instructions

**For any LLM agent, not just Claude Code.** If your runtime loads a single instruction file, load this one.
Claude Code users should use `SKILL.md` instead, which the runtime picks up automatically.

You are working with **project-atlas**: a tool that builds a derived, auditable knowledgebase over a
repository's own markdown.

---

## The one rule everything else follows

**The markdown files are the source of truth. Everything the tool generates is derived.**

The output owns no prose that is not already a committed `.md` file in the repository. Delete the output
directory, rebuild, get a byte-identical result. A surface that owns nothing cannot drift from anything.

Refuse designs that migrate content *out* of markdown into a wiki store, and refuse build steps that generate
unreviewed prose. You do write documentation — as ordinary `.md` files, in a session, landing in a diff a
human reviews. Never emitted from the build script. That difference is the entire safety argument.

---

## Commands

```bash
atlas init            # write a config, detecting the repository's layout
atlas scan            # index the corpus                        --json for the raw model
atlas tasks [filter]  # the planning document, with progress bars
atlas contrib         # who did what, from git history alone
atlas health          # rot report; --verbose for instances; exit 1 on blocking
atlas build           # generate the site
atlas watch           # rebuild on change
atlas all             # scan + health + build

atlas publish --target wiki|pages|export     # stages only; --push is required to publish
```

Zero dependencies, Node ≥ 18. Installed as a plugin, `atlas` is on your PATH; otherwise it is
`./bin/atlas` or `node scripts/atlas.mjs`. Only `atlas caps` touches the network, and it says so.

---

## Workflows

### First run on a repository

1. **Measure before proposing.** Run `scan` first and report the numbers. Never open with a plan — most
   repositories hold more documentation than anyone remembers, and some of it is better than what you would
   write.
2. `init`, then review the generated config. `forbiddenTerms` and `crossref` are off until configured, and
   the report will say so.
3. Run `health`. **The first report is a survey, not a to-do list.** Orphans and staleness fire in bulk on any
   real corpus. Lead with blocking findings.
4. **If there is no `docs/README.md`, write it.** That single hand-written index is worth more than the entire
   generated site.
5. `build`, then stop and show the user. Do not reorganise documents in the same pass.

### Authoring documentation

- **Every claim about the code cites the code** — `path:line`, verified by reading it in this session.
- **Prefer full paths** over bare filenames; a bare name that exists twice cannot be verified at all.
- **`UNKNOWN` is a valid answer.** The characteristic failure here is not lying — it is **reporting a corner
  as the whole**.
- **Read the source, not the existing docs.** A document is a lead, never a status.
- **Date every page**, and re-stamp on revision.

### Maintenance

The trigger is: **a session touched documentation**. Not a schedule. Run `health` → act on new signals →
`build` → commit the output together with the source change, so the two are never more than one commit apart.

Report the **delta**, not absolute counts. Read the "Not checked" section aloud.

---

## Branching — check before you write

**Run `atlas branch` before making changes.** It reports where you are and exits non-zero when it is not safe
to commit there.

If you are on `main`, branch first — `atlas branch <type> <slug>` carries your uncommitted work across. Do not
stage, do not commit, and do not decide the change is small enough to skip it. This project's own first five
commits went straight to `main` while its guide preached discipline; that is the failure this rule exists to
prevent.

- `type` is one of `feat fix docs refactor test chore`.
- The slug names **the change, not the file**: `fix/citation-resolver-false-positives`, not `fix/scan-mjs`.
- **One branch, one sentence.** If describing it needs an "and", it is two branches.
- **Never `git push` without being asked.** Branching is local and reversible; pushing is neither.
- **Say which branch you are on** when reporting work — the user cannot see your shell.

Full rules: `references/branching.md`.

## Honesty rules — enforced in output, and in any change you make

- **A check that could not run is never reported as passing.**
- **Nothing is silently dropped** — truncated, sampled, skipped and suppressed are all counted and stated.
- **Unknown is not zero.** An item with no figure is charted as unknown and excluded from means.
- **Estimated is not measured.** Estimated figures are drawn hatched.
- **Active hours are an estimate** derived from commit rhythm, not time worked. They are a floor.
- **No combined contribution score, and no leaderboard of people.**
- **Prompt quality is not measured** — a repository cannot see a prompt. Outcome proxies ship under their real
  names.

---

## Publishing

**Never pass `--push` without explicit confirmation from the user — every time, not once per session.**
Publishing is outward-facing and effectively irreversible.

GitHub offers **no pull-request review on wiki repositories**; every push is immediately live. So humans never
author there: each page carries a do-not-edit banner, and each publish records a content hash per page. When
a hash no longer matches, publish **refuses** — re-run with `--import` to copy the edited pages out for review.
`--force` overwrites, and destroys someone's text; say so plainly before using it.

---

## Refuse these

They have all killed documentation systems before.

- *"Have the model summarise every doc."* Unreviewed generated prose at scale is a confident source of wrong
  facts.
- *"Move everything into the wiki."* Breaks every citation and every grep, and fixes neither discoverability
  nor drift.
- *"Make all the signals blocking."* Guarantees the report is ignored within a week.
- *"Fix all 200 advisory findings now."* An unreviewable diff is an unverified one.
- *"Skip the index, go straight to the site."* The index is most of the value.
