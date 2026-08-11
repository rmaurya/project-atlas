# Third-party code and dependencies

**Last verified: 2026-08-11**, against the working tree at that date. Re-verify before relying on it; this is a
statement about a commit, not a standing guarantee.

**There are none. project-atlas ships no third-party code at all — no runtime dependencies, no build
dependencies, no test dependencies, and nothing vendored.** The repository has no `package.json`, no lockfile,
and no `node_modules`. Every line that ships was written here.

The rest of this page is the evidence, and the three things that are *not* covered by that sentence.

---

## How that was verified

Four checks, all run in the session that wrote this page:

1. **No manifest and no lockfile.** `git ls-files` matched against `package*.json`, `*lock*`, `node_modules`
   and `vendor` returns one file — `scripts/lib/lock.mjs`, which is this project's own build lock and matched
   only on the word "lock". There is no `package.json` anywhere in the repository.
2. **Every import is a `node:` builtin or a relative path.** Collecting every `import … from '…'` across
   `scripts/`, `hooks/`, `tests/` and `bin/` yields exactly two kinds of specifier: relative paths inside this
   repository, and eight Node builtins — `node:child_process`, `node:crypto`, `node:fs`, `node:http`,
   `node:os`, `node:path`, `node:readline`, `node:url`. **No bare package specifier appears anywhere.**
3. **Nothing is vendored under `assets/`.** It holds three files, all of them SVGs authored in this
   repository: `assets/atlas-logo.svg`, `assets/atlas-logo-dark.svg` and `assets/atlas-mark.svg`. They carry
   hand-written path data and inline comments describing the design decisions behind it; there is no upstream
   they were copied from. There is no other asset directory, no bundled font file, and no bundled stylesheet
   from anywhere else.
4. **The generated site pulls nothing in either.** No external script, stylesheet or font is referenced by the
   output — see [PRIVACY.md](PRIVACY.md#the-generated-pages). Typefaces are system stacks (`ui-monospace`,
   `Menlo`, `Consolas`, `monospace`), which name fonts already installed on the reader's machine rather than
   downloading any.

This is what the README means by *"Zero dependencies, Node ≥ 18"*, and it is checkable rather than believed.

## What that sentence does not cover

**1 · Node.js itself.** The tool requires Node 18 or later and uses its standard library. Node is not
distributed with project-atlas and is not covered by its licence; it is your installation, under its own terms.

**2 · External programs it invokes.** These are called as subprocesses, not bundled — you already have them,
and this project neither ships nor licenses them:

| Program | Used for | Where |
|---|---|---|
| `git` | Everything: discovery, history, remotes, publishing | 33 `execFileSync('git', …)` call sites across `scripts/`, plus 6 invocations in the shell hooks |
| `jq` | Parsing hook payloads | The shell hooks, e.g. `hooks/on-session-start.sh:66` |
| `sed`, `grep` | Small text extraction in the hooks | e.g. `hooks/on-session-start.sh:55` |

`install.sh` additionally calls `curl` and your agent's own plugin command (`claude`, `codex`) during
installation only.

**3 · Your agent runtime.** project-atlas runs as a plugin inside Claude Code, Codex or Antigravity. Those are
separate products with their own licences and their own terms, and nothing here speaks for them.

## Why there are no dependencies

Not asceticism — it is what makes the security and privacy claims checkable. A dependency tree is a supply
chain, and the statement *"there are exactly two network requests, and both are named"*
([PRIVACY.md](PRIVACY.md#what-leaves-the-machine-and-when)) is only verifiable when the code making requests
is code you can read in this repository. With no third-party package installed, there is no transitive
behaviour to audit and no lockfile to keep honest.

The cost is real and worth naming: the markdown parser, the HTML renderer, the glob matcher, the chart drawing
and the CLI argument handling are all written here rather than taken from libraries that do them better.
That is a maintenance burden this project accepts deliberately.

## Licence

project-atlas is MIT — see [`LICENSE`](../../LICENSE). Because nothing third-party is bundled, **there is no
combined-work licence question, no notice file to reproduce, and no attribution owed to anyone.** If that ever
changes, this page changes with it, and the addition names the package, the version and its licence.

---

## Related

- [TERMS.md](TERMS.md) — the terms you accept by installing it.
- [PRIVACY.md](PRIVACY.md) — what the tool reads, writes and transmits.
- [DISCLAIMER.md](DISCLAIMER.md) — what the reports do and do not mean.
- [`LICENSE`](../../LICENSE) — the MIT grant.
