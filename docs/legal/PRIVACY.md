# Privacy and data handling

**Last verified: 2026-08-13**, against `HEAD = 714d202`. Every claim on this page was read out of the source
in the session that wrote it, and cites `path:line`. Where something could not be established, it says
`UNKNOWN` rather than a plausible answer.

**One claim on this page had gone false and is corrected below** — see *Local session transcripts*. The
statement that nothing but `atlas tokens` reads your session transcripts stopped being true when the
Economics view shipped, and it stayed on this page for two releases. Every `path:line` above and below was
re-resolved on the date above; sixteen of them had drifted and now land on what they name.

**The short version: project-atlas is a local tool. It reads your repository, writes into it, and — apart from
two named HTTP requests and the git operations you ask for — nothing leaves your machine.** There is no
telemetry, no analytics, no account, no server belonging to this project, and nothing that phones home with
anything about your code.

---

## What it reads

**Markdown that git already tracks.** Discovery runs `git ls-files -z` (`scripts/lib/scan.mjs:34`) and filters
to `include: ['**/*.md']` (`scripts/lib/config.mjs:230`). `trackedOnly` defaults to `true`
(`scripts/lib/config.mjs:237`), so **a file has to be committed before the tool can index or publish it** — an
uncommitted draft in your working tree cannot reach a wiki.

That boundary can degrade, and it says so when it does. If git cannot answer, discovery falls back to walking
the filesystem and pushes a note into the report's "Not checked" section (`scripts/lib/scan.mjs:69-78`) rather
than switching mode silently.

**Git metadata.** Authors, dates, commit messages and trailers, via `git log` and friends —
`scripts/lib/scan.mjs:289-290` for document history, `scripts/lib/health.mjs:38` for the author list H11 checks
against. `atlas contrib`, `atlas ownership` and `atlas surviving` are built from git history and nothing else.

**Source files, only to check citations.** `allFiles()` lists every tracked path so a `path:line` citation can
be resolved (`scripts/lib/scan.mjs:60-62`), and H2 reads a cited file to count its lines
(`scripts/lib/health.mjs:228`). It never executes anything it finds.

**Local session transcripts — read by three surfaces, and only when each is asked for.** The store is
`~/.claude/projects/<slug>`, resolved at `scripts/lib/tokens.mjs:115` and overridable with
`tokens.transcriptRoot`. What opens it:

| Surface | When it reads | Why |
|---|---|---|
| `atlas tokens` | Only when you run it. | The token report. |
| `atlas sessions` | Only when you run it. | Turns, interruptions, friction, rework. |
| `atlas build` / `atlas watch` | **Only when a view being rendered includes the Economics panels.** | The Economics view puts the attribution on a page, so the build calls `readTokenEconomics` (`scripts/lib/tokens.mjs:766`). `atlas watch` builds on every save, so under a watcher this is a read per save. |

**This page previously said the opposite, and it was wrong.** It stated that nothing but `atlas tokens`
touched that directory, and cited `scripts/lib/tokens.mjs:14` — a line which, since C-10 shipped the
Economics view, is *the sentence recording that the rule changed*. The rule now reads "read only by the
surfaces that show them, and only when they are asked for", and it is stated where it is enforced rather than
only here.

**Nothing else opens the store**, and that is the part the table above is for: not `scan`, not `health` (H17
is handed an aggregate by its caller and reads nothing itself), not a hook, not `serve`, and **not a build of
a site whose views do not include Economics** — `dashboard.mjs` resolves the reader only when a panel on the
page asks for it (`scripts/lib/dashboard.mjs:1815`). The default view set does include Economics, so on a
default configuration a build reads the store; remove the view and it does not.

**What that read can carry out of the file is unchanged, and is the reason the widened surface is still
safe.** It is **one-way and counts-only**: `classifyWrite` is the only function that sees a path and it
returns one of five words, so no path, prompt or message text survives it. The reports are aggregate only —
counts, sums and model names, never prompt text, never a file path that was read
(`scripts/lib/tokens.mjs:36-38`). The Economics panels carry `data-local-only` and are removed by
`stripLocalOnly` at both publish doors. **Nothing reaches disk** unless you run `atlas tokens --snapshot`
with `tokens.snapshot` set: no build writes the snapshot, and a test asserts it.

**Plugin registrations**, to work out which build is answering you: `${CLAUDE_CONFIG_DIR:-~/.claude}`
(`scripts/atlas.mjs:135`).

## What it writes, and where

**Inside your repository:**

| Path | Written by | Note |
|---|---|---|
| `docs/_wiki/` (configurable) | `atlas build` | The whole generated site. Default at `scripts/lib/config.mjs:236`. Delete it and rebuild; you get the same bytes. |
| `project-atlas.config.json` | `atlas init` | Nothing existing is modified. |
| `worklog/<day>/<slug>.md` | `atlas worklog` | `scripts/lib/worklog.mjs:133-138`. Derived from git. |
| `.atlas/journal/<slug>.jsonl` | `atlas note` and the hooks | `scripts/lib/journal.mjs:46`, appended one line at a time at `scripts/lib/journal.mjs:170`. |
| `.git/project-atlas-capabilities.json` | `atlas caps` | The one-hour capability cache, `scripts/lib/host.mjs:80`. Never committed. |
| `.atlas/serve.pid`, `.atlas/serve-announced`, `.atlas/tasks-live.jsonl`, `.atlas/build.lock` | `atlas serve`, the hooks | Machine-local churn, all git-ignored — see `.gitignore`. |

**Outside your repository:**

| Path | Written by | Note |
|---|---|---|
| `${XDG_CACHE_HOME:-~/.cache}/project-atlas/update-check.json` | the update check | `scripts/lib/update.mjs:28-31`. Outside the repo on purpose, so a check never appears in anyone's diff. |
| `${CLAUDE_CONFIG_DIR:-~/.claude}/atlas-servers.json` | `atlas serve` | The cross-project server registry, `scripts/lib/serve.mjs:66-68`. Project name, root path, port, pid. |
| `$TMPDIR/atlas-wiki-*`, `$TMPDIR/atlas-pages-*` | `atlas publish` | Staging directories, `scripts/lib/publish.mjs:232`, `:306`, `:374`. Staging is the default; nothing is pushed from them without `--push`. |

### The journal: what it holds, and what it does not

**`.atlas/journal/` never carries prompt text**, and that is enforced rather than asked for. The rule is stated
at `scripts/lib/journal.mjs:23`; `note()` caps a record at 500 characters (`scripts/lib/journal.mjs:72`) and
refuses a longer one with the reason (`scripts/lib/journal.mjs:141-145`), and the reasoning field is capped at
2,000 (`scripts/lib/journal.mjs:82`). A cap cannot detect prompt text — nothing can — but a transcript pasted
into a one-sentence field fails loudly instead of landing in a file that is never rewritten.

**It is excluded from publishing by construction.** `.atlas/` sits outside the docs root, so no scan reaches
it and no publish target can carry it (`scripts/lib/journal.mjs:27-29`). `assertUnpublished()` states that as
a check rather than an assumption and throws if a reconfigured `output` would ever overlap it
(`scripts/lib/journal.mjs:117-125`).

**It is, however, committed to git.** That is deliberate — `.gitignore` says so in as many words: "The journal
itself IS committed: it is the record that survives a machine, and a teammate reading it is the point." So it
is not published *to a wiki or a Pages site*, and it **is** visible to anyone who can see the repository. If
your repository is public, your journal is public. Treat it as you would any committed file.

## What leaves the machine, and when

**Two HTTP requests are made by this tool's own code. Both are named here, both live in one file each, and
both are checkable rather than believed.**

**1 · The capability probe — you ask for it.** `atlas caps` makes a single unauthenticated `GET` to the host's
repository API (`scripts/lib/host.mjs:111`) to read which features are enabled. It sends no repository content
and no credentials, times out in six seconds (`scripts/lib/host.mjs:86`), and caches the answer for one hour
in `.git/` (`scripts/lib/host.mjs:27`, `:80`). `--offline` skips it entirely and the command states what it
therefore assumed (`scripts/lib/host.mjs:89`). `atlas publish` and `atlas community` run the same probe before
touching a target.

**2 · The update check — it runs on its own, once a day at most.** The `SessionStart` hook runs
`atlas version --notice` (`hooks/on-session-start.sh:31`), which fetches the published plugin manifest from
`raw.githubusercontent.com/<owner>/<repo>/main/.claude-plugin/plugin.json`
(`scripts/lib/update.mjs:72-75`, fetched at `scripts/lib/update.mjs:87`). The URL is derived from the
`repository` field of your own installed manifest, so a fork checks itself; a non-GitHub repository returns
`null` and is not checked at all rather than guessed at (`scripts/lib/update.mjs:73-74`).

It sends nothing. It times out in two seconds (`scripts/lib/update.mjs:25`). It runs **at most once every 24
hours** (`scripts/lib/update.mjs:24`, gated at `scripts/lib/update.mjs:119`), **including after a failure** —
a `null` result is cached too, so an offline machine does not retry every session
(`scripts/lib/update.mjs:126`). The cache is written outside any repository
(`scripts/lib/update.mjs:28-31`).

**Turn it off with `ATLAS_UPDATE_CHECK=0`.** The hook exits before doing anything
(`hooks/on-session-start.sh:22`), and the per-command stale banner is suppressed too
(`scripts/atlas.mjs:300`). That banner never makes a request in any case — it reads the cache and nothing else
(`scripts/atlas.mjs:321`).

**Beyond those two, git subprocesses also reach the network — and only when you invoke the command that needs
them.** This is worth stating precisely, because "two network requests" counts HTTP calls made by this code
and not the git processes it starts:

- `git ls-remote` against the wiki repository, to settle whether it actually exists rather than trusting the
  API's `has_wiki` flag (`scripts/lib/host.mjs:179`). Runs under `atlas caps` and in the publish gate.
- `git clone --depth 1` of the wiki, during `atlas publish --target wiki` — **including without `--push`**,
  because the drift check that protects hand-edited pages has to read what is there
  (`scripts/lib/publish.mjs:242`).
- `git push`, only under an explicit `--push` (`scripts/lib/publish.mjs:343` for the wiki,
  `scripts/lib/publish.mjs:404` for a Pages branch). This is the one operation that sends repository content
  anywhere, and it is the one that is never implicit.

**Every other command — `scan`, `health`, `build`, `tasks`, `changes`, `diff`, `branch`, `contrib`, `tokens`,
`sessions`, and all publish staging — makes no network request at all.**

## The local server

`atlas serve` binds **loopback only**: `server.listen(port, '127.0.0.1', …)` at `scripts/lib/serve.mjs:347`,
never `0.0.0.0` (`scripts/lib/serve.mjs:16`), and the probe that checks whether a port is taken uses the same
host (`scripts/lib/serve.mjs:373`). It serves the generated output directory to your own machine. The port is
derived from the repository path so several projects can run at once (`scripts/lib/serve.mjs:55-63`), and it
exits after idling.

## The generated pages

**The site loads no external script, stylesheet or font**, so a published page makes no third-party request.
Verified this session by grepping `scripts/lib/render.mjs` and `scripts/lib/dashboard.mjs` — the two modules
that emit the page's CSS and JavaScript — for any `http://` or `https://` URL outside repository links: there
are none. Typefaces are system stacks (`ui-monospace`, `Menlo`, and so on), not downloads. The same claim is
made in [`SECURITY.md`](../../SECURITY.md).

The one exception is same-origin and only alive under a server: the live dashboard polls `build-stamp.txt` and
re-fetches its own URL to patch itself in place (`scripts/lib/dashboard.mjs:3217`, `:3198`). Nothing else is
contacted. In the single-file export that poller is switched off, because a detached file could never reach it
and a snapshot that looks live is worse than one that admits it (`scripts/lib/publish.mjs:984`).

## What is not claimed here

**No jurisdiction-specific compliance is asserted anywhere on this page.** There is no GDPR statement, no CCPA
statement, no UK DPA statement, and no "we comply with X". That is not an oversight — see
[What a lawyer would still have to answer](TERMS.md#what-a-lawyer-would-still-have-to-answer) in the terms.
This page describes mechanisms that were read in the source. It does not characterise them against any legal
regime.

**`UNKNOWN`: what your agent runtime does with your data.** project-atlas runs *inside* Claude Code, Codex or
Antigravity, and those are separate products with their own data handling. Nothing on this page describes them,
and this project cannot speak for them. Read their policies.

**`UNKNOWN`: what your host does.** Publishing to a GitHub wiki, a Pages branch or a GitLab CI artifact hands
content to that host under that host's terms. Once `--push` succeeds, this tool is out of it.

**Everything indexed becomes as public as the target you publish to.** Use `exclude` to keep directories out,
and read `atlas scan` output before the first push.

---

## Related

- [TERMS.md](TERMS.md) — the terms you accept by installing it.
- [DISCLAIMER.md](DISCLAIMER.md) — what a clean health report does and does not mean.
- [THIRD-PARTY.md](THIRD-PARTY.md) — the dependency position.
- [`SECURITY.md`](../../SECURITY.md) — the security posture, and how to report a vulnerability.
