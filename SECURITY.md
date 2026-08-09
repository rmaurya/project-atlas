# Security

## What this tool touches

docs-atlas **reads** your repository and **writes** one output directory (`docs/_wiki` by default), plus a
config file on `init`. It makes **no network requests**, has **no runtime dependencies**, and runs no code it
finds in your repository — markdown is parsed, never executed.

Two things are worth knowing precisely, because they are where a surprise could come from:

**1 · `trackedOnly` is a real safety boundary.** With the default `trackedOnly: true`, documents are discovered
via `git ls-files`, so a file must be committed before it can be indexed or published. A half-written draft in
your working tree cannot leak into a wiki or a Pages site. Turning it off removes that boundary.

**2 · Publishing never happens implicitly.** `atlas publish` stages to a temp directory and prints what would
go where. It writes to a remote only with an explicit `--push`. If you automate it, that flag is the one to
review.

## Generated pages

The generated HTML inlines your markdown content. The renderer **escapes all HTML** in prose and code — raw
`<script>` and event handlers in a document are rendered as text, and there is a test asserting it. The site
loads no external script, stylesheet or font, so a published page makes no third-party requests.

If you publish to a Pages branch or a wiki, remember that **everything indexed becomes as public as that
target**. Use `exclude` to keep private directories out, and check `atlas scan` output before the first push.

## Reporting a vulnerability

Open a [security advisory](https://github.com/rmaurya/docs-atlas/security/advisories/new) rather than a public
issue.

Useful things to include: the command, the repository shape (`atlas scan` output), and what an attacker would
gain. A crash on malformed input is a bug, not usually a vulnerability — file it as a bug and it will be
handled the same day either way.

## Supported versions

Pre-1.0. Fixes land on `main`; there are no backport branches yet.
