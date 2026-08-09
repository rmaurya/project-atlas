# Changelog

All notable changes to project-atlas. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Selectable light/dark themes with a one-click toggle, defaulting to the system setting.
- Role-scoped views (QC, product, delivery, architecture, developer, executive).
- Contribution analytics surfaced on the dashboard, not just the CLI.
- GitLab support alongside GitHub for the wiki and pages targets.
- `atlas plan` — propose the git route for the working tree and wait for approval, rather than only refusing a
  commit once it is attempted.

## [0.1.7] — 2026-08-10

### Fixed
- **The bundle shipped every number with none of the presentation.** `atlas.css` is only the base; the
  dashboard and each role view add ~130 lines on top — the cards, the tiles, the bar charts. Collecting a
  page's `<main>` and `<script>` and not its `<style>` produced an unstyled outline: every figure present,
  every chart gone.
- **Rewriting the menu was not rewriting the links.** "Open the wiki →" on the home page, and all 61 document
  links on the Wiki page, still pointed at `.html` files that do not exist beside a single document. Then a
  third of them survived the first fix, because a link *inside* a document page addresses its sibling as
  `README.html` while the Wiki index addresses the same document as `pages/README.html` — the target depends
  on where the link sits, not only on what it names.

### Added
- **The 27 document pages travel with the bundle** (595 KB total), reachable by link but deliberately absent
  from the menu. A bundle carrying the index of a corpus and not the corpus is a table of contents for a book
  you did not bring.
- Two tests: no `href` may point at a file, every `data-go` must have a section answering to it, and every
  class the built page styles must exist in the bundle's stylesheet.

## [0.1.6] — 2026-08-10

### Added
- **`atlas publish --target export --page all` — every page in one file, with the menu working.** Exporting
  one page of a ten-page site shipped the least useful nine-tenths of it: published as an Artifact, the reader
  got a single view and no way to reach the others. Each page's `<main>` becomes a section and the nav
  switches between them in-document. 265 KB, no request made.
- **An About page**, always present: version, build commit, the assisting model read from `Co-Authored-By`
  trailers, repository links, contributors from `git log` — listed, never ranked — and a plain statement that
  every page is derived from the markdown.
- **The header names the build and the model**, e.g. `project-atlas 0.1.6 · Claude Opus 5 (1M context)`.
- **An update row**, shown only when a newer release was known *at build time*. A generated file cannot poll
  and an Artifact's policy blocks outbound requests, so it states what was true when it was made and dates it.
  When the build had no answer there is no row: a page that cannot know must not reassure.

### Fixed
- **The update row fired when the build was *ahead* of the last release**, telling the reader to upgrade
  `0.1.5` to `0.1.3`. It compared `latest !== version` where it needed ordering. About now also explains an
  ahead build rather than printing a figure that reads as a contradiction.
- **`stamp` was treated as chrome and deduplicated**, leaving seven elements sharing one id with six
  unreachable. Chrome means *outside the body the bundle copies* — the toggle, which the bundle rebuilds — not
  *looks like furniture*. Ids that collide across pages are prefixed per page, and that page's own script and
  selectors are rewritten with them.

## [0.1.5] — 2026-08-10

### Fixed
- **The standalone export deleted the theme toggle and kept its script.** `exportSingleFile` stripped `<nav>`
  wholesale to remove cross-page links, which are genuinely dead in a single file — but the theme toggle lives
  in there and acts on the current page alone. The shipped script then hit `if (!btn) return;` and bailed
  before `paint()`, so the export had no theme control *and* silently ignored a saved light preference,
  always rendering in whatever the operating system asked for. Nothing errored; the page just quietly did
  less. The nav now keeps everything that is not an `<a>`, and is removed only when nothing is left.
- This shipped in the artifact the skill tells you to publish — the one surface built for other people to
  look at.

### Added
- **A test that the export may not drop a control the built page rendered.** Asserting the toggle alone would
  catch only the bug that already happened; this compares every `getElementById` in the exported scripts
  against the built page and fails when the export removed something that was there. Optional elements a
  repository never renders — `#itbl` without a planning source — are excluded, because their scripts already
  guard for absence. Verified to fail with the fix reverted.

## [0.1.4] — 2026-08-10

### Added
- **`atlas version` — which build is actually answering.** There was no way to ask. `atlas --version` printed
  the usage banner, and establishing the truth took `which atlas` plus a `grep` through
  `installed_plugins.json`. It now reports the running version, its commit, its path, whether that path is an
  installed plugin or a working copy, and **every registration and its version**. On the machine this was
  written on that is three different versions at once — working copy `0.1.3`, `local 0.1.1`, `user 0.1.0` —
  with `atlas` on `PATH` resolving to the oldest and nothing saying so.
- **A session-start notice when the install is behind.** One line, only when something is actually behind,
  silent otherwise: a line that appears every session is a line people learn to scroll past.
- `ATLAS_UPDATE_CHECK=0` disables it. An environment variable rather than a config key, because it runs in
  every session including repositories with no config file to read one from.

### Security
- **A second network request now exists, and `SECURITY.md` names it** rather than continuing to claim there is
  exactly one. The check `GET`s the published manifest from `raw.githubusercontent.com`, derived from the
  `repository` field of the installed manifest so a fork checks itself and a non-GitHub repository is not
  checked at all. It sends nothing, times out in two seconds, runs at most once per 24 hours, and caches its
  result — including failures, so an offline machine does not retry every session — outside any repository, in
  `${XDG_CACHE_HOME:-~/.cache}/project-atlas/`.
- An unknown result is reported as *"not checked"*, never as up to date. The one thing this must not do is
  reassure you it confirmed something it could not reach.

## [0.1.3] — 2026-08-10

### Added
- **The site regenerates itself.** A `PostToolUse` hook rebuilds after any session writes a `.md` file —
  index, dashboard, health page and all six role views, 14 files in 0.47s on a 27-document corpus. The
  dashboard is no longer something anyone remembers to refresh.
- **A blocking signal now refuses the commit.** The existing commit hook runs `atlas health --gate` after the
  branch guard passes. Dead internal links, duplicate titles and missing `# ` headings stop the commit with
  exit 2; advisory signals say nothing, because a gate that fires on findings with legitimate causes is a gate
  switched off within a week. Silent when the corpus is clean.
- `automation.buildOnWrite` and `automation.healthOnCommit`, both `true`. This is the only config object
  merged one level deep — a shallow merge would let a setting about the build silently disable the commit
  gate. An unknown switch is refused rather than ignored, and so is a non-boolean: `"false"` is truthy, and a
  switch that fails open leaves you believing you turned something off that is still running.
- Both hooks are inert in a repository with no `project-atlas.config.json`. The plugin is installed per user,
  not per project; without that rule, editing any markdown anywhere would generate a `docs/_wiki` nobody asked
  for, and a dead link in a stranger's repository would block their commit.

### Changed
- The hooks moved out of `hooks.json` into `hooks/on-commit.sh` and `hooks/on-write.sh`. A guard whose
  reasoning cannot fit next to it is a guard nobody audits. The inline wrapper still refuses a commit when the
  script is unreadable — a half-installed plugin must not wave commits through.
- `hooks/README.md` argued there should never be a second hook. That reasoning applied to running *health* on
  every edit, and still holds; the build is a regeneration rather than a check, and was measured before being
  added. The reversal is recorded rather than quietly overwritten.

## [0.1.2] — 2026-08-10

### Changed
- **The reference guides and the roadmap live under `docs/`.** `references/**` → `docs/references/**` and
  `ROADMAP.md` → `docs/ROADMAP.md`, which is where a reader looks first. Twenty-six path references were
  rewritten with them — fifteen in `skills/knowledgebase/SKILL.md` alone, where they are not links but runtime
  instructions ("Read `docs/references/authoring.md` before writing a line"), so a missed one would have made
  the skill silently read nothing. H1 is blocking in this repository, so `atlas health` is the proof: dead
  internal links **ok** across 27 documents and 13 links.
- `README.md`, `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md` stay at
  the root, and `.github/` and `skills/` are unchanged — GitHub and the plugin loader both resolve those by
  location, so moving them would break discovery rather than tidy it.

## [0.1.1] — 2026-08-10

Everything below the Security heading was written for 0.1.0 and never reached anyone. `/plugin` compares
version strings alone, so shipping those fixes without moving the version meant every installed copy answered
"already at the latest version" and fetched none of them. This release is that release, plus the gate that
stops it recurring.

### Added
- **CI refuses a runtime change that does not bump the version.** If anything under `scripts/`, `bin/`,
  `skills/`, `hooks/`, `plugins/` or `.claude-plugin/` changed, `.claude-plugin/plugin.json` must declare a
  higher version — checked on pushes as well as pull requests, because the commit that motivated this went
  straight to `main`. The verdict is pure and unit-tested (`scripts/lib/release.mjs`); only the git plumbing
  lives in the CI entry point.

### Security
- **A configured `output` was passed unvalidated to a recursive delete.** `{"output":"../PRECIOUS"}` removed a
  directory outside the repository; `{"output":"."}` removed the repository including `.git` — and both
  reported success. The path is now confined to the repository through `realpath` on both sides, and a
  directory holding files but none of this tool's build markers is refused rather than cleared.
- **Stored XSS from a committed filename.** A file named
  `z"><img src=x onerror=alert(document.domain)>".md` terminated the `href` attribute on five interpolation
  sites and went live in `wiki.html` and `health.html`. The link *text* was escaped; the href was not.
  Generated page filenames are now restricted to `[A-Za-z0-9._-]` with the remainder hashed — which also makes
  them legal on Windows — and every href is escaped at the point of use.
- **Two documents could silently overwrite each other's page.** `docs/a/b.md` and `docs/a__b.md` both flattened
  to `docs__a__b.html`; the second write won, and the reported page count came from the index, so it could
  never notice. Names are now injective, collisions are resolved and reported, and the count comes from the
  writes.
- **`deck.source` and `planning.source` read any path on disk** and rendered it into pages that
  `publish --target pages` force-pushes. `{"deck":{"source":"../../creds.env"}}` put `SECRET=hunter2` on the
  web. Both are confined to the repository.
- **A view id was interpolated into a write path.** `{"id":"x/../../../ESCAPED"}` wrote a file above the
  repository root. Ids are constrained to `[A-Za-z0-9-]+`.
- **`assertNotPublishable` was a case-sensitive string prefix check** — the only mechanism keeping
  transcript-derived data out of a published wiki. `DOCS/_WIKI/t.txt` walked past it on macOS and Windows, and
  so did a symlink. Both sides are now resolved through `realpath` and compared the way the filesystem does.
- **Wiki drift manifest names were joined onto a path unchecked.** An entry of `"../victim-notes"` made
  `stageWiki` read outside its staging directory and surface the contents as drift. The manifest lives in a
  repository other people can write to; unsafe names are refused and reported.
- **A tone from `planning.statusBands` was interpolated into a quoted class attribute**, so
  `"tone": "x\" onmouseover=\"alert(1)"` produced a live event handler. Rejected by config validation and
  allow-listed at the point of use.
- **`data:` URLs were allow-listed in links, and `<img src>` was not scheme-checked at all.** A published page
  could carry arbitrary embedded content. One scheme policy now covers both.
- **Stored XSS in the standalone export.** `search-index.js` was written with `JSON.stringify`, which does not
  escape `<`, and `publish --target export` inlines that file into a `<script>` element. A document containing
  the literal text `</script>` closed the element early and anything after it ran — in the single-file export,
  which is the artifact this tool tells people to publish. JSON bound for a page now goes through
  `jsonForScript`, and the inliner escapes `</script` again on the way in.

### Fixed
- **The config was untyped input the tool trusted.** `{"blocking":"H1"}` became the character set `{'H','1'}`,
  so no signal ever matched and `atlas health` exited 0 with a dead link present — the CI gate inverted
  silently. `{"include":null}` discovered zero documents and wrote an empty site over the previous one;
  `{"searchBodyLimit":"lots"}` indexed zero characters under a page claiming full-text search;
  `{"staleDays":"ninety"}` made the H6 grace period NaN. Every known key is now type-checked, `blocking` ids
  are checked against the signal list, unknown top-level keys are refused rather than ignored, and every
  message names the config file.
- **Any git failure during discovery degraded to a filesystem walk**, which publishes untracked files. A
  corrupt `.git/index` turned one tracked document into three, including an untracked `secret-notes.md`, and
  nothing said discovery had changed mode — `trackedOnly` is the safety feature that a bare `catch` turned off.
  Only a genuinely missing repository degrades now, and when it does it is stated under "Not checked".
- **Non-ASCII documents got no git metadata at all.** git quotes paths with bytes over 0x7F by default, so
  `--name-only` returned `"docs/\303\251tude.md"` while `ls-files -z` returned it unquoted; the keys never
  matched. Every affected document had no date and was skipped by H6 while the report claimed every check ran.
  `-c core.quotePath=false` on the history, contribution and change queries. Documents that still have no
  history are counted and declared.
- **The dashboard swallowed the error `changes.mjs` deliberately re-raises**, then listed the panel under
  "Not shown on this page" — whose stated meaning is "omitted because there is no data behind them". A failed
  panel now says it failed.
- **A cited file that could not be read had its line-number check skipped silently**, so the citation came out
  looking verified. Unreadable targets are named under "Not checked".
- **Any wiki clone failure was read as "the wiki does not exist yet"** — no network, bad credentials, a proxy —
  so both drift branches were skipped and the user was told "Staged N pages" with nothing to say the
  human-edit protection had not run. Unreachable is now distinguished from absent and aborts, and every
  publish reports whether the drift check ran.
- **`citationExtensions` was escaped with a string `replace`**, which substitutes one occurrence: only the
  first dot was escaped, and `citationExtensions:["("]` crashed the whole scan.
- **The commit hook never blocked.** `… && atlas branch >&2 || exit 0` swallowed the guard's exit status, so
  it printed eleven lines of refusal and exited 0 — and only exit 2 makes a `PreToolUse` hook's stderr reach
  Claude or stop the call. It now exits 2 on a protected branch, and also when the guard cannot run at all
  rather than waving the commit through unchecked. A missing `jq` no longer disables it silently.
- **`skills/knowledgebase/SKILL.md` frontmatter was invalid YAML.** An unquoted `description` containing `": "`
  made the whole block unparseable, so `name` and `description` were both dropped and model invocation never
  matched. The value is quoted, and the test suite now parses every skill's frontmatter strictly.
- **A configured regex could hang the build forever.** `forbiddenTerms[].pattern`, `crossref[].pattern` and
  `planning.*Pattern` are user-supplied; `(a+)+$` against one 40-character line never returned. Patterns whose
  shape can backtrack exponentially are now declined, and the affected signal is reported as *not evaluated*
  with the pattern named under "Not checked" — never as clean.
- **`publish --target export` refused without a git remote**, although it writes a local file and contacts no
  host. The remote check now applies only to the targets that need one.
- **`head` and `sed` swallowed exit status in the typed skills**, so `cmd | head -3 || echo FALLBACK` never
  printed the fallback and a missing `atlas` rendered an empty section that read as "nothing to report".
  `/atlas:diff` also reported "(no file given)" when a file *had* been given.
- **`SECURITY.md` claimed the tool makes no network requests.** `atlas caps` makes one. It is now named,
  scoped and described.
- Dead references inside the flagship skill: `scripts/llm-wiki.mjs` (renamed to `scripts/atlas.mjs`) and an
  `assets/templates/` directory that does not exist.

### Changed
- `.claude-plugin/plugin.json` no longer declares `"skills": ["."]` — it failed manifest validation before
  Claude Code 2.1.221 and was redundant, since `skills/` is always scanned.

## [0.1.0] — 2026-08-09

First release. Built against a 387-file, 73,000-line corpus, and every signal below fired on something real
there before it shipped.

### Added
- **Index and site generation** — cluster taxonomy, backlinks, per-document tables of contents, client-side
  full-text search. Offline, deterministic, byte-identical on rebuild.
- **Nine rot signals** split into blocking and advisory, with mandatory-reason suppressions and a
  "Not checked" section on every report.
- **Citation resolution** — literal path, unique suffix, then unique basename; ambiguous citations resolve to
  nothing and are declared rather than guessed.
- **Dashboard** — stat tiles, progress by track, items by status, health signals, documents by cluster, and a
  sortable/searchable item table. Single-hue ordinal ramp, validated in both themes.
- **Deck** — a browser slide deck from a markdown source, with keyboard navigation, overview and print.
- **Contribution analytics** (`atlas contrib`) — people, agents, desks, estimated active hours, rework and
  revert rates, spec-to-build coverage. Derived entirely from `git log`.
- **Publishing** — GitHub Wiki (flattened, re-linked, drift-guarded via a content manifest), a `gh-pages`
  branch, and a single self-contained HTML export. Nothing pushes without an explicit `--push`.
- **`atlas watch`** — rebuild on change; the open page reloads itself.
- 66 integration tests against throwaway git repositories.

### Fixed during development, and pinned by regression tests
- Bare-filename code citations were reported as broken at a **77% false-positive rate** before the resolver
  existed.
- Document pages loaded their stylesheet from the wrong path, so every one rendered unstyled — caught only by
  opening one in a browser.
- SOPs living under an `architecture/` directory were swallowed by the directory rule, leaving the Procedures
  cluster falsely empty. Filename patterns now precede directory patterns.
- `README.md` flattened to the wiki page name `Home` and was silently overwritten by the generated index.
- Git metadata never loaded at all: raw NUL bytes cannot be passed in `argv`, and a bare `catch` absorbed the
  error — so staleness evaluated nothing while reporting clean.
- `cfg.staleDays || 90` reinterpreted a configured `0` as the default.
- Staleness compared day-granularity dates, so same-day drift was invisible.
- The estimated-figure marker was swallowed by a greedy quantifier, reporting every estimate as measured.
