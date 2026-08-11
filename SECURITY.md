# Security

## What this tool touches

project-atlas **reads** your repository and **writes** one output directory (`docs/_wiki` by default), plus a
config file on `init`. It has **no runtime dependencies** and runs no code it finds in your repository —
markdown is parsed, never executed.

Three things are worth knowing precisely, because they are where a surprise could come from:

**1 · Every network request this tool can make is named here — the two it makes itself, and the two it asks
`git` to make.**

*The capability probe, which you ask for.* `atlas caps` (and the probe that `atlas publish` and
`atlas community` run before touching a target) makes a single unauthenticated `GET` to the host's repository
API — `https://api.github.com/repos/<owner>/<repo>` or the GitLab equivalent — to read which features are
enabled: wiki, pages, issues, discussions. It sends no repository content and no credentials, times out in six
seconds, and caches the answer for an hour in `.git/`. `--offline` skips it and the command says what it
therefore assumed. It lives in one file, `scripts/lib/host.mjs`.

*The update check, which runs on its own.* The `SessionStart` hook runs `atlas version --notice`, which makes
an unauthenticated `GET` for the published manifest — `raw.githubusercontent.com/<owner>/<repo>/main/.claude-plugin/plugin.json`
— to compare the released version against the installed one. The URL is derived from the `repository` field of
your own installed manifest, so a fork checks itself; a non-GitHub repository is not checked at all rather
than guessed at. It sends nothing, times out in two seconds, and runs **at most once every 24 hours** —
including after a failure, which is cached so an offline machine does not retry each session. The result is
written to `${XDG_CACHE_HOME:-~/.cache}/project-atlas/update-check.json`, deliberately outside your repository.
Set `ATLAS_UPDATE_CHECK=0` to disable it, or `atlas version --offline` to inspect your build without it. It
lives in one file, `scripts/lib/update.mjs`.

*Git also reaches the network on your behalf, and this section used to omit it.* The two paragraphs above
count the requests **this tool makes itself**, and for nineteen releases the sentence that followed them said
publish staging made none — which was wrong, and wrong in a document that invites you to check it rather than
believe it. `git` is a subprocess, so its traffic did not appear in any audit of this codebase's own HTTP:

- **`git ls-remote`** (`scripts/lib/host.mjs:179`) — asks whether a wiki exists. Part of the capability probe
  above, so it is covered by `--offline`, and it authenticates with nothing: `GIT_TERMINAL_PROMPT=0` and
  `GIT_ASKPASS=echo` mean it fails rather than prompting for a credential.
- **`git clone --depth 1`** (`scripts/lib/publish.mjs:241`) — runs during `atlas publish --target wiki`
  **without `--push`**. This one is worth understanding rather than just noting: the drift guard exists to
  stop a force-overwrite of a colleague's edit in the web UI, and it cannot detect an edit it has not read.
  Staging a wiki publish therefore *reads* the remote. It still writes nothing without `--push`.

**Every other command — `scan`, `health`, `build`, `tasks`, `changes`, `diff`, `branch`, and publish staging
for the `pages` and `export` targets — makes no network request at all.** Each item above names a file and a
line, precisely so this can be checked rather than believed. The previous, tidier claim is the reason the
citations are here: a round number that nobody could verify held for nineteen releases while being false.

**2 · `trackedOnly` is a real safety boundary.** With the default `trackedOnly: true`, documents are discovered
via `git ls-files`, so a file must be committed before it can be indexed or published. A half-written draft in
your working tree cannot leak into a wiki or a Pages site. Turning it off removes that boundary.

**3 · Publishing never happens implicitly.** `atlas publish` stages to a temp directory and prints what would
go where. It writes to a remote only with an explicit `--push`. If you automate it, that flag is the one to
review.

## Generated pages

The generated HTML inlines your markdown content. The renderer **escapes all HTML** in prose and code — raw
`<script>` and event handlers in a document are rendered as text, and there is a test asserting it. The site
loads no external script, stylesheet or font, so a published page makes no third-party requests.

**Escaping prose was not enough, and this is worth stating rather than implying.** The client-side search index
carries document body text as JSON, and `publish --target export` inlines that file into a `<script>` element.
`JSON.stringify` does not escape `<`, so a document containing the literal text `</script>` closed the script
element and everything after it ran as markup — in the single-file export, which is the artifact people publish.
JSON bound for a page now goes through `jsonForScript`, and the inliner escapes `</script` again on the way in.
There is a test asserting the payload cannot produce a literal `</script>` in the export.

If you publish to a Pages branch or a wiki, remember that **everything indexed becomes as public as that
target**. Use `exclude` to keep private directories out, and check `atlas scan` output before the first push.

## Reporting a vulnerability

Open a [security advisory](https://github.com/rmaurya/project-atlas/security/advisories/new) rather than a public
issue.

Useful things to include: the command, the repository shape (`atlas scan` output), and what an attacker would
gain. A crash on malformed input is a bug, not usually a vulnerability — file it as a bug and it will be
handled the same day either way.

## Supported versions

Pre-1.0. Fixes land on `main`; there are no backport branches yet.
