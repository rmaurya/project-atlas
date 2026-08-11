---
name: project-atlas
description: "Index, audit and generate a knowledgebase from a repository's own markdown — taxonomy, backlinks, search, dashboard, and mechanical rot detection. Use when asked to create, audit, index or reorganise documentation, write a developer manual or architecture overview, or when doc drift is suspected: stale docs, dead links, duplicate or forked documents, broken code citations, or no index at all."
---

# project-atlas — skill instructions

Turn a repository's scattered markdown into a navigable, verifiable knowledgebase — and keep it true.

## The one rule everything else follows

**The markdown files are the source of truth. The wiki is derived.**

The wiki owns no prose that is not itself a committed `.md` file in the repository. Every generated artifact is
regenerable from the source documents alone: delete the entire output directory, rebuild, get a byte-identical
result. A surface that owns nothing cannot drift from anything.

This is not a style preference. A wiki that holds its own copy of a fact is a second thing to maintain, and it
will fork — the same way hand-maintained documentation already forks. Refuse designs that migrate content out of
markdown into a wiki store, and refuse build steps that generate unreviewed prose.

**Corollary — where prose is allowed.** You *do* write documentation here. But you write it as ordinary `.md`
files, in a session, landing in a diff a human reviews. You never emit prose from the build script. The
difference is reviewability, and it is the whole safety argument.

## The two layers

| Layer | Who | What | Fails how |
|---|---|---|---|
| **Mechanical** | `scripts/atlas.mjs` | Index, taxonomy, backlinks, staleness, rot signals, search, HTML | Loudly, with an exit code |
| **Editorial** | You, in a session | Classification, overview pages, acting on signals, source-grounded authoring | Silently — so it needs the discipline below |

## Workflow

Pick the entry point that matches the request.

### A · First run on a repository ("set up a wiki", "index our docs")

1. **Measure before proposing.** Never open with a plan. Run:
   ```bash
   atlas scan --json | head -40
   ```
   This alone tells you file count, line count, clusters, and whether an index already exists. A proposal that
   ignores what is already there is a bad proposal — most repositories have more documentation than anyone
   remembers, and some of it is better than what you would write.
2. **Read `docs/references/adoption.md`** and generate a config with `init`.
3. **Run `health`.** The first report is a *survey*, not a to-do list. Expect orphans and staleness in bulk.
   Report the counts and the two or three signals that indicate real defects (duplicate titles and dead links
   almost always do).
4. **Write the entry point first.** If there is no `docs/README.md`, that single hand-written index is worth
   more than the whole generated site. See `docs/references/authoring.md`.
5. **Build, serve, and hand over a URL.** Run `atlas serve` and **report the
   `http://127.0.0.1:<port>/` link it prints, on its own line.** Then stop — do not proceed to reorganising
   documents in the same pass.

**Ending a first run without a URL is a failed run.** See "Finish with the link" below; it is not optional
and it is not a thing to ask permission for.

### B · Authoring knowledge ("write the developer manual", "document the architecture")

**Read `docs/references/authoring.md` before writing a line.** It carries the evidence rules, the page templates,
and the failure modes. The short version, which is not a substitute for reading it:

- **Every claim about the code cites the code** — `path:line`, verified by reading it in this session.
- **`UNKNOWN` is a valid and valuable answer.** A gap named is worth more than a gap filled plausibly. The
  characteristic failure of an LLM writing documentation is not lying — it is reporting a corner as the whole.
- **Read the source, not the existing docs.** Documents lag code. A document is a *lead*, never a status.
- **Date every page you write**, and re-stamp when you revise. An undated page is a page that will be trusted
  after it stops being true.

### C · Maintenance ("update the wiki", after any change to docs)

Read `docs/references/maintenance.md`. The loop is: `scan` → `health` → act on new signals → `build` → commit
together with the source change, so the wiki and the documents are never more than one commit apart.

**The trigger is: a session touched documentation.** Not a schedule. Run it the way you run tests.

### D · Audit ("is our documentation any good?", "find stale docs")

Run `health --verbose`, then read `docs/references/health-signals.md` to interpret. Lead with the *delta* since the
last run, not the absolute counts — absolutes are noise after the first run, and a report that cries wolf gets
ignored, which is the failure mode that kills these systems.

## Finish with the link

**Every run that builds anything ends by running `atlas serve` and stating the URL it prints.** First line of
the summary, on its own line, clickable. This is not a step to propose, confirm or defer — it is the last
step of the work.

`atlas serve` builds first, starts the server only if one is not already up, opens the browser, and is
idempotent — running it twice opens the page rather than fighting for the port. It is loopback-only and
exits after 30 idle minutes, so starting one is as reversible as any other derived artifact. Nothing about
it is outward-facing, which is exactly why it needs no permission.

**A filesystem path is not a hand-over.** Reporting `docs/_wiki/index.html` and stopping is the failure this
rule exists to prevent: it names a file whose live-reload polling cannot reach a server, so the page looks
current forever. Three repositories were once adopted in one afternoon, all three servers came up and
answered, and not one session printed a port — the work was done and undeliverable.

If the port is held or the server will not listen, **say that instead** — a named failure is a hand-over too.
Never substitute the file path silently.

## Commands

```bash
atlas init                  # write project-atlas.config.json, detecting the repo's layout
atlas scan                  # build the index; --json for the raw model
atlas tasks [filter]        # the planning document, with progress bars
atlas health                # rot report; --verbose for every instance; exit 1 on blocking
atlas build                 # generate the site: index, dashboard, deck, health
atlas serve                 # build + start the live dashboard, open it, print the URL — idempotent
atlas serve --list          # every atlas dashboard running on this machine, one port per project
atlas serve --stop          # end this repository's server now, rather than at its idle timeout
atlas watch                 # rebuild on change; the open page reloads itself
atlas all                   # scan + health + build
```

Flags: `--config <path>` · `--root <dir>` · `--quiet` · `--json` · `--no-git` (skip git metadata; staleness
degrades to unknown rather than failing).

Zero dependencies, Node ≥ 18. Installed as a plugin, `atlas` is on your PATH; otherwise it is
`./bin/atlas` or `node scripts/atlas.mjs`. Only `atlas caps` touches the network, and it says so. Safe to run anywhere.

## Publishing

```bash
atlas publish --target wiki     # GitHub Wiki: flattened markdown, links rewritten, drift-guarded
atlas publish --target pages    # the full site to a gh-pages branch — dashboard and deck survive
atlas publish --target export   # one self-contained HTML file (--page dashboard|index|health)
```

**Nothing is pushed without `--push`.** The default stages to a temp directory and prints what would go where.
Pushing is outward-facing and effectively irreversible, so it is never a side effect of running a build.
**Confirm with the user before passing `--push`** — every time, not once per session.

**The wiki has no review gate.** GitHub offers no pull requests on wiki repositories; only the default branch
is live, so every push is immediately public. The only safe arrangement is that humans never author there —
each page carries a do-not-edit banner, and each publish writes `.atlas-manifest.json` recording a hash of
what we wrote.

**When drift is detected, publish refuses.** A page whose hash no longer matches is a human edit. Re-run with
`--import` to copy the edited pages out with a `MAPPING.json` back to their source files; fold the change into
the source markdown and publish again. `--force` overwrites — reach for it only when the user says the edit is
disposable, and say plainly that their text will be destroyed.

**Publishing the dashboard as an Artifact:** export the standalone file, then publish it with the Artifact
tool. Re-publishing the same path keeps the same URL, which is the point — a dashboard that mints a new link
every time is a dashboard nobody bookmarks. This is the fix for a task board that goes stale because updating
it is manual.

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

- **Carry the trailers.** `Co-Authored-By:` names the assisting model and `Desk:` names the working context.
  The delivery analytics read both, and **neither can be added to history afterwards** — a commit without them
  is permanently unattributed.

Full rules: `docs/references/branching.md`.

## Rot signals

Nine, all mechanical. Full catalogue with detection details and legitimate exceptions in
`docs/references/health-signals.md`.

| | Signal | Default |
|---|---|---|
| **H1** | Dead internal link | **blocking** |
| H2 | Unresolvable `path:line` citation | advisory |
| **H3** | Duplicate title across documents | **blocking** |
| H4 | Orphan — nothing links to it | advisory |
| H5 | Landed in the fallback cluster | advisory |
| H6 | Stale — cited code moved after the doc was last touched | advisory |
| H7 | Forbidden term (retired names, old branding) | advisory |
| **H8** | No `# ` title | **blocking** |
| H9 | Cross-reference asymmetry between paired documents | advisory |

**Blocking versus advisory is the design's load-bearing compromise.** Blocking signals have no legitimate
cause. Advisory ones do — an archived record *should* cite code that has since moved; a historical spec *should*
name a retired product. Never make an advisory signal blocking to "raise standards"; you will train everyone to
ignore the report.

**Suppression requires a reason.** `suppress` entries carry a mandatory `reason` string. An unexplained
suppression is itself a defect. What is excluded is stated, never quietly dropped.

## Reference material

Load on demand — do not read these unless the task calls for them.

- `docs/references/adoption.md` — first run, config generation, what to do with an existing docs tree
- `docs/references/authoring.md` — **the evidence rules and page templates; read before writing any documentation**
- `docs/references/taxonomy.md` — the cluster model, classification, customising for a project
- `docs/references/health-signals.md` — full signal catalogue, tuning, suppression
- `docs/references/maintenance.md` — the ongoing loop, triggers, and the abandonment criterion
- `docs/references/configuration.md` — every config key
- `docs/references/branching.md` — how work reaches `main`, and the trailers `atlas contrib` reads
- `docs/references/agent-control.md` — **read before anyone asks the MCP server to drive a session.** It
  cannot: MCP runs client → server. The Agent SDK is the surface that can, and the safety contract a driver
  owes this project is written there.

The page skeletons — an index, a cluster overview, a developer manual, an architecture document — are section
3 of `docs/references/authoring.md`. There is no separate templates directory.

## Failure modes to refuse

These have all killed documentation systems before. Push back rather than comply.

- **"Just have the model summarise every doc."** Unreviewed generated prose at scale is a confident source of
  wrong facts. Authoring happens in sessions, in diffs.
- **"Move everything into the wiki."** Breaks every citation and every `Grep`, and solves neither
  discoverability nor drift.
- **"Make all the signals blocking."** Guarantees the report is ignored within a week.
- **"Fix all 200 advisory signals now."** Phase it, or the diff is unreviewable and nothing is verified.
- **"Skip the index, go straight to the site."** The index is most of the value; the site is presentation.
