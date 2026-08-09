# Security

## What this tool touches

project-atlas **reads** your repository and **writes** one output directory (`docs/_wiki` by default), plus a
config file on `init`. It has **no runtime dependencies** and runs no code it finds in your repository —
markdown is parsed, never executed.

Three things are worth knowing precisely, because they are where a surprise could come from:

**1 · There is exactly one network request, and you have to ask for it.** `atlas caps` (and the capability
probe that `atlas publish` and `atlas community` run before touching a target) makes a single unauthenticated
`GET` to the host's repository API — `https://api.github.com/repos/<owner>/<repo>` or the GitLab equivalent —
to read which features are enabled: wiki, pages, issues, discussions. It sends no repository content and no
credentials, times out in six seconds, and caches the answer for an hour in `.git/`. `--offline` skips it and
the command says what it therefore assumed. **Every other command — `scan`, `health`, `build`, `tasks`,
`changes`, `diff`, `branch`, and all publish staging — makes no network request at all.** It lives in one
file, `scripts/lib/host.mjs`, precisely so that this paragraph can be checked rather than believed.

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
