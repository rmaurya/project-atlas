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

## [0.1.34] — 2026-08-10

### Fixed
- **The wiki writer produced page names its own reader refuses, which silently disabled the drift guard.**
  `wikiPageName` turned `.github/DISCUSSIONS-WELCOME.md` into `.github-DISCUSSIONS-WELCOME`, and
  `isSafePageName` — correctly — rejects a leading dot, because a page name is joined onto a path and a
  manifest is editable by anyone with wiki write access. So from the very first publish the manifest could
  not be read back: every later publish reported atlas's own page as `unsafe-name` drift, refused, and
  skipped the drift check for that page. The protection read as tampering because the writer and the reader
  disagreed about one character. Leading dots are now stripped, and the regression is a **property** —
  every name the writer produces, over a list of adversarial paths and over this repository's whole corpus,
  must satisfy the reader — rather than one example that would not have caught the next variant.

### Changed
- Pages already published under a dotted name (`.github-…`) will be re-created under the corrected name on
  the next publish. The old page remains in the wiki until deleted by hand; publish does not remove pages it
  no longer recognises, deliberately.

## [0.1.33] — 2026-08-10

### Fixed
- **A cached "no wiki yet" outlived the thing it described, and the refusal kept advising an action already
  taken.** 0.1.30 stored `wikiInitialised` so `publish` could reuse the probe's answer instead of paying for
  a second `ls-remote`. But the two directions are not symmetric: a wiki that exists does not stop existing,
  while a negative is precisely the state the refusal message instructs the user to go and fix — so it is
  stale seconds later. The result was `publish --target wiki` refusing for up to an hour *after* the first
  page was saved, printing "create the first page, then re-run" to someone who had just done exactly that.
  Worse than what it replaced: before 0.1.30, publish always ran a live check and would have succeeded
  immediately. A cached `true` is still trusted; a cached `false` is re-probed, in both the publish gate and
  the `caps` report, so the two cannot disagree.

## [0.1.32] — 2026-08-10

### Fixed
- **A wiki that is not there is classified the same way whatever wording git chose.** For a target that does
  not exist, POSIX git says "does not exist" while Windows git reports it through the remote-helper path as
  "does not appear to be a git repository" — so the same first publish was a normal first publish on Linux
  and a refused-as-unreachable failure on Windows. The phrasing is now matched too. It stays distinct from
  the failures that branch exists to catch: missing credentials, a proxy or a refused connection say
  "Permission denied", "Authentication failed" or "could not read Username", and none of them claim anything
  about whether a repository is there.
- **The token-store tests computed the slug instead of calling the function that computes it.** Three copies
  of `path.resolve(dir).split(path.sep).join('-')` lived in the suite, so when the product's version was
  corrected in 0.1.31 the tests kept asserting against the old, broken derivation and stayed red on Windows
  for the original reason. They now call `transcriptDir`, which is the thing under test.

## [0.1.31] — 2026-08-10

### Fixed
- **Windows CI was red on every commit since the matrix was added, and never once for the reason under
  test.** GitHub's windows-latest runners default `core.autocrlf` to true, so checkout rewrote the tree to
  CRLF before any step ran; `sync-runtimes --check` then called all eleven skills stale and failed the job at
  the second step. `ci.yml` set `core.autocrlf false` *after* checkout, which cannot undo a conversion
  already applied. A `.gitattributes` of `* text=auto eol=lf` fixes it at checkout, for contributors on
  Windows as well as CI, and the workflow step now asserts the tree is LF rather than claiming it.
- With the tree readable, the matrix found the three Windows defects it was added to find:
  - **`atlas tokens` and `atlas sessions` reported nothing on Windows.** The transcript-store slug kept the
    drive colon — `C:-Users-me-proj` — which is not a legal Windows path component, so every read failed at
    mkdir. An empty report is exactly what an honestly empty store produces, so nothing looked wrong.
  - **A first wiki publish was refused as unreachable, with a blank reason.** The clone's failure text was
    read as `err.stderr || err.message`, and an *empty Buffer is truthy* — so where git left stderr empty the
    fallback never ran, an empty string matched none of the "repository not found" patterns, and the normal
    first-publish case was misclassified.
  - **Every in-document link in a single-file export was dead.** `from` was built with `path.join`, giving
    `pages\A.html`, so the `startsWith('pages/')` test that decides how a document's links resolve went false
    for every document.
- The injection test whose fixture *filename* contains `"`, `<` and `>` is skipped on Windows, which forbids
  those characters outright — by name and counted, never silently passed. The escaping it guards is
  platform-independent and stays covered elsewhere.

## [0.1.30] — 2026-08-10

### Fixed
- **`caps` and `publish` disagreed about the same wiki.** `atlas caps` reported the wiki as `on` from
  GitHub's `has_wiki` alone, which says the *feature* is enabled and nothing about whether the wiki
  repository exists — GitHub creates `<repo>.wiki.git` only when the first page is saved by hand. So `caps`
  said the wiki was ready, `publish --target wiki` ran a real `git ls-remote` and refused, and the reasonable
  reading of that was that publishing was broken. The probe now runs the same check `publish` runs and
  reports a third state — `half  Wiki — enabled, but not initialised` — with the fix named inline. `publish`
  reuses the stored result instead of paying for a second call, and a capability cache written before the
  field existed reports *unverified* rather than guessing. This is why `caps` now makes two requests on a
  cold run and not one; the result is cached together, so the second call costs nothing.
- **This repository was indexing its own worklog.** `DEFAULT_CONFIG` excludes `worklog/**` — but a config
  that sets `exclude` **replaces** the default list rather than extending it, so a repository that had ever
  customised exclusions silently lost every default the tool added afterwards. One file per day was landing
  in the corpus. Fixed here; the merge behaviour itself is worth revisiting, because the same trap applies to
  `citationExtensions` and `blocking`.
- Four documents fell through to `uncategorised` because this repository's own cluster rules predate the
  taxonomy widened for tool repos in 0.1.23. `CODE_OF_CONDUCT.md` and `SECURITY.md` live at the root here,
  not under `.github/`; `hooks/**` is what an assistant is *governed by* rather than asked, so it joins the
  agent cluster; `docs/ANALYSIS.md` is what the figures mean, so it joins planning.
- The illustrative `src/auth.ts:88` in the review skill is suppressed with a stated reason — the same case
  as the example citation already suppressed under `docs/references/`.

  **Health is now clean on every signal except orphans**, which are 16 skill and community files that
  nothing links to by design.

## [0.1.29] — 2026-08-10

### Added
- **A session that loaded an older build than the one installed now says so.** `atlas version` reported what
  is *installed*; nothing reported what the running session actually loaded, and that gap caused most of a
  day's debugging — a dashboard that would not rebuild, a branch guard that never fired, an update notice
  that stayed silent, and a skill failing with syntax replaced fifteen releases earlier.

  It needs no configuration to detect: the binary lives in a version-keyed plugin directory, so it knows
  which build is running. Older than what is registered means the session is holding a stale copy, and no
  amount of updating the disk will reach it.

  **The real cause on the machine this was written on was worse and is worth recording.** The plugin was
  registered twice — a project-scoped `local` entry pinned to `0.1.10`, and a `user` entry at `0.1.28`.
  `/plugin` updates one scope. Inside that repository the local registration won, so every fix looked correct
  on disk, the plugin UI showed the new version, and the session loaded the old one. Two registrations for
  one plugin is a version pin nobody asked for.

## [0.1.28] — 2026-08-10

### Fixed
- **Every skill still prompted, and the `|| echo` fallback was the reason.** 0.1.13 removed command
  substitution and control flow from the blocks and kept a trailing fallback, on the grounds that a block
  rendering blank when `atlas` is missing reads as "nothing to report". Claude Code refuses to auto-approve
  **any** compound command — *"contains multiple operations"* — whatever the allowlist says. So the fallback
  did not make the block resilient; it made every skill unrunnable without a prompt.

  The blocks are now a single invocation with no operators at all. **The guarantee moved into the prose**,
  where it always belonged: each skill states that an empty block means `atlas` is not on `PATH`, and that
  an empty section must not be read as nothing to report. The model reads that; the shell no longer has to
  carry it.

## [0.1.27] — 2026-08-10

### Fixed
- **The update notice went silent exactly when it mattered.** The check caches for 24 hours, which assumes
  releases are rarer than a day. Twenty-six shipped in one. The cache held `latest: 0.1.3` from the morning,
  the install was `0.1.10`, and the real published version was `0.1.26` — and because the install was
  *newer* than the cached figure, the notice concluded "ahead of the release, nothing to say".

  A cache the installed version has overtaken is **provably wrong**: you cannot be ahead of the published
  version under normal use. That is free evidence to refetch, and it now does. A cache that has not been
  overtaken is still honoured, or every command would hit the network.

### Added
- **Any `atlas` command warns when the install is behind**, not only the session-start hook. A session open
  for hours is precisely the one running stale skills, and the failure arrives as *"/atlas:ask is broken"* —
  it was not broken, it was thirteen releases old, and nothing said so at the moment it failed.

  Reads the cache, never the network: a command that made an HTTP request would be a command that hangs
  offline, and this runs on every invocation. Silent with `--json`, `--quiet`, `ATLAS_UPDATE_CHECK=0`, and
  on `atlas version` itself, which already says it better.

  The line names both steps: `/plugin`, **then** `/reload-plugins` — because hooks and skills are read once
  at session start, so an updated plugin does not reach a running session.

## [0.1.26] — 2026-08-10

### Added
- **Quality now shows what is covered, not only how often it broke.** A rework rate is a symptom; the test
  inventory is what a QC reader came for. 220 cases here, grouped by the suite's own section headings, with
  the share **named for a defect rather than a capability** — 56%, the part that exists because something
  broke. Read from source in five languages, never from a run: parsing reporter output would make a
  documentation tool depend on a passing suite, an installed runner and a stable JSON format.

  A repository with no tests reports zero rather than hiding the panel. An answer of "none" is the one worth
  seeing most.
- **Architecture answers the three questions an architect actually has.**
  - **Design record** — HLD, LLD, data flow, decision records, specifications: present or absent, as rows.
    An absence is the finding, and a list of what exists cannot show one. This repository has none of the six.
  - **Undesigned areas** — the inversion, and the only panel that finds something you were not already
    looking for: code areas no design document cites. `scripts/lib`, 30 files, cited by nothing.
  - **Design documents against the code** — citations per document, with **"not checked" kept apart from
    "broken"**. Collapsing them reports a document as sound because nobody looked.

  All three are coverage, not quality, and say so: a documented area may be described badly, and three
  utility files may need no design at all.

## [0.1.25] — 2026-08-10

### Fixed
- **A single card before the tile strip left two thirds of the row blank.** `column-span:all` splits a
  multi-column flow into fragments: everything before the spanning element is balanced on its own. On the
  Quality view that fragment held one card, so it took column one and left the rest empty — the exact hole
  masonry was added in 0.1.8 to remove, reintroduced by the mechanism that removed it.

  Full-width panels are hoisted to the top, leaving one contiguous run of cards to pack. It reads better
  too: a summary strip belongs above the detail, which is the order the Overview page already used.

## [0.1.24] — 2026-08-10

### Added
- **The wiki drift path has actually run.** It was written nineteen releases ago and never exercised against
  a real edited wiki — while being the only thing standing between a colleague's typo fix in the web UI and
  a force overwrite. Three tests now build a bare repository, publish into it, edit a page the way a person
  would, and assert the behaviour end to end: the second publish **refuses**, `--import` copies the human
  text out with a `MAPPING.json` pointing back to its source file, and `--force` is the only way past.

  The mapping is an index, not a second copy of the text — asserted, because a rescue that duplicates the
  content into two files creates the fork it was meant to prevent.

## [0.1.23] — 2026-08-10

### Changed
- **The default taxonomy classifies tool and plugin repositories.** Running `init` on this one matched 4 of
  39 documents and put 35 in the fallback — every `SKILL.md`, every reference guide, `AGENTS.md`, the whole
  of `.github`. The defaults were tuned for product repositories and said "uncategorised" about the shape
  this tool is most often installed into.

  Three clusters: **Agent instructions** (`**/SKILL.md`, `**/skills/**`, `AGENTS.md`, `CLAUDE.md`),
  **Reference guides** (`references/**`), **Community** (`.github/**`, `CODE_OF_CONDUCT.md`). Plus
  `hooks/**` under Operations and `ANALYSIS.md` under Research. Same corpus, **39 of 39 classified**.

  A regression test pins the product-repo shapes. The new rules are filename-driven and run before the
  directory catches, so adding a shape could have silently moved one that already worked.

## [0.1.22] — 2026-08-10

### Added
- **`atlas surviving` — lines still in the file today.** Every contribution figure here carries the same
  disclaimer: *lines added is shown because it is cheap, not because it measures value.* Survival is the
  closest honest number git alone can give. It cannot be gamed by volume — a thousand lines written and
  replaced next week count once, for whoever wrote what remains.

  Opt-in and capped, because `git blame` walks every line of every file: fractions of a second here, minutes
  on a large repository, and a report that hangs is one nobody runs twice. **The cap is always reported** —
  a sample presenting itself as a total is the quiet lie this project refuses everywhere else.

  `Not Committed Yet` is git's placeholder for uncommitted lines and is excluded: leaving it in puts a
  fictional contributor in a report about contribution.

  It still does not measure quality. A line nobody revisited may be load-bearing or may be in a corner
  nobody reads, and removing a bad abstraction leaves no surviving lines at all.

## [0.1.21] — 2026-08-10

### Added
- **`atlas ownership` — bus factor per area, which is the version anyone can act on.** A repository-wide
  "bus factor 1" says one person wrote everything; on a young project that is a fact about its age. Per area
  it names something: *these directories have exactly one author who has ever touched them.*

  An area with a single commit is excluded — new is not concentrated, and otherwise the first week of any
  project buries the real risks. A second author counts however little they wrote, because "meaningful
  contribution" is a judgement this cannot make and should not pretend to.

  Caught before shipping: `commit.files` entries are `{ path, added, removed }`, not strings. Read as
  strings, every path fell into one `(root)` bucket and it reported 401 files under a single area — a number
  plausible enough to ship and saying nothing at all.

## [0.1.20] — 2026-08-10

### Added
- **CI runs on a matrix** — ubuntu, macOS and Windows against Node 20 and 22, `fail-fast: false`. Windows
  path handling had been unverified for nineteen releases: the code normalises to posix separators
  throughout and folds case on win32, and neither claim had ever been executed there. macOS earns its own
  row because it is case-insensitive by default, which is the exact property `isAtOrInside` defends against.
- Windows needs `shell: bash` and `core.autocrlf false`, or every `run:` block is a PowerShell syntax error
  and every hash differs by platform for reasons unrelated to the code.
- **Tests that need a POSIX shell are skipped by name and counted**, not dropped. A suite quietly running
  202 of 206 on one platform reports a green tick for coverage it did not have.

### Fixed
- `I-3` was marked 40% in the roadmap table after shipping at 0.1.19 — the edit that was meant to update it
  matched a row shape that no longer existed, and failed silently. The figure was wrong on the dashboard for
  one release.

## [0.1.19] — 2026-08-10

### Added
- **`atlas worklog` — the day, written down.** `contrib` and `sessions` computed how a day went and printed
  it to a terminal that scrolls away. This writes `worklog/YYYY-MM-DD/log.md`: what landed, lines, desks,
  rework, reverts, documentation state, and **which plan items the day's commits named** — a link that only
  exists because the commit gate now requires one.

  `YYYY-MM-DD`, not the `YYYY-DD-MM` that was asked for: directory names sort lexicographically, so
  `2026-09-08` would sort before `2026-08-09` and every listing would be wrong.

  No prompt text, and no score attributed to anyone. A worklog is committed and pushed, so anything that
  entered it would be permanent and public in a way a terminal report never is — `tokens.mjs` rule 3 matters
  more here, not less. A day with no commits says so rather than reporting zero, because a day of design
  discussion is not a day of nothing.

  `worklog/**` is excluded from the corpus: a log of what happened is not documentation of how the thing
  works, and indexing it would drown the taxonomy in one file per day.
- **A "Show completed" control on the item table.** The done items were always in the list, mixed in and
  indistinguishable from a filter that had hidden them. On by default — "what landed" is the first thing
  anyone asks of a plan.

## [0.1.18] — 2026-08-10

### Added
- **`atlas plan` and `/atlas:plan` — the route, before the decision.** Every other guard here is a refusal
  that fires at `git commit`, which is after the fact. Nothing proposed a route, so the pull-request rule
  lived as prose and was bypassed three times in one session with nothing objecting.

  It prints the branch, the type, whether the change ships and therefore needs a version bump, and the way
  to `main` — and **runs nothing without `--apply`**. `--apply` creates the branch and stops: committing and
  pushing stay explicit, because pushing is outward-facing.

  Two things it refuses to infer. The **slug** names the change, not the file, and inferring it from paths
  produces `fix/scan-mjs` — exactly what the branching guide forbids. **`feat` versus `fix`** is not in a
  diff: both touch the same files, and the difference is whether the old behaviour was intended. Both print
  `?` and block `--apply` rather than guessing, because a wrong guess is accepted by a reader who trusts it.

  A type is inferred only when *every* changed file agrees — a change touching `tests/` and `scripts/lib/`
  is not a test change.

## [0.1.17] — 2026-08-10

### Added
- **CI tags the release.** Sixteen versions shipped and every tag was typed by hand — the first five
  retroactively, the rest remembered one release at a time, which is the definition of a step that
  eventually gets forgotten. The release gate already proved the version moved; nothing marked the commit.

  A job on pushes that touch `.claude-plugin/plugin.json` creates the annotated tag, with that version's
  changelog section as its message. Idempotent: a manifest change that does not move the version finds the
  tag already there and exits 0, because a workflow that fails the second time it runs is a workflow people
  disable.

## [0.1.16] — 2026-08-10

### Fixed
- **`install.sh` reported success without checking what was installed.** `claude plugin install` prints
  "already installed" and exits 0 without comparing versions, and the installer printed "Done." underneath
  it. A user-scope plugin sat five releases behind for a full day while the installer, the updater and the
  reload each reported success at a different layer — the same silent-gate shape the release gate fixed in
  CI, live in the thing people run first.

  It now reads every registration, reads the published manifest, prints them side by side, and **exits 1
  when anything is behind**. Disagreeing scopes are called out, because updating one leaves the others.
  Without `node`, or when the manifest cannot be fetched, it says the check did not run rather than
  implying it passed.

## [0.1.15] — 2026-08-10

### Added
- **`atlas build --verify` — the tool audits its own output, and CI runs it.** `atlas health` checked other
  people's markdown scrupulously and had never once looked at the HTML it writes. Six defects shipped in one
  afternoon because of that, and a person found every one of them.

  Four checks, all decidable from the file: no duplicate id, no control that is scripted but never rendered
  in a block with no early return, no local link with nothing behind it, no page whose stylesheet failed to
  travel. Those are the general form of four of the six. The other two — a flex paragraph and a grid leaving
  holes — need a browser, and are declared out of scope rather than faked.

  Getting it right took three passes, each a false positive worth recording: 358 "dead" links that were
  parent-relative and fine; 15 "unrendered" controls guarded by an early `return` further up the same script;
  and one `href` inside a JavaScript string template.

### Fixed
- **The homepage date now carries a time and both zones** — `2026-08-10 04:07 UTC+05:30 · 2026-08-09 22:37
  UTC`. Read from the commit's own `%cI` rather than generated, so the build stays byte-reproducible; a
  `new Date()` here would write a different string on every run.

## [0.1.14] — 2026-08-10

### Added
- **A scorecard on the homepage, with the weights in your config.** Eight measured components across
  Practice and Outcome, each printing its figure, its target, the weight it carried and its score — then a
  ranked list of what to improve, ordered by weighted loss rather than by raw score, so a 15 carrying ×2
  outranks a 52 carrying ×1.

  `score.weights` lives in `project-atlas.config.json`. **The organisation owns the judgement; the tool owns
  the arithmetic.** A score whose weighting is hidden can be resented but not disagreed with.

  A component whose input is unavailable is omitted and its weight leaves the denominator with it — a missing
  measurement must never quietly count as zero and drag a total down.
- **Interaction components** (`atlas score --sessions`, never the build): tool-call success, results not
  corrected by hand, sessions that fitted their window. These measure whether the collaboration worked.
  Prompt quality is still not scored, and the reason is in `score.mjs`: a transcript records what happened
  *after* a prompt, not whether the prompt was well judged.
- `analysis.source`, so the rendered narrative can live somewhere other than `docs/ANALYSIS.md`.

### Fixed
- **The homepage lost its "last updated" date.** It was written by the live-reload poll, which the standalone
  export disables because there is nothing to poll — so the one artifact people actually share was the single
  page that never said when it was made. It is now rendered statically from the last commit date, which also
  keeps the build byte-reproducible.

## [0.1.13] — 2026-08-10

### Fixed
- **Every skill block, not just the one that was reported.** `/atlas:diff` was fixed in 0.1.9; `/atlas:ask`
  failed identically a release later — *"Contains shell syntax (string) that cannot be statically analyzed"*.
  Six skills still carried command substitution, `if/then/fi`, and pipes into `head`, any of which stops the
  permission checker cold. All twelve blocks are now a single `atlas` invocation with a trailing `|| echo`
  fallback, which is required: a block that renders blank when `atlas` is missing reads as "nothing to
  report".
- The test that covered one skill now covers **every block in every skill**.

### Added
- **`atlas ask <question>`** — ranks documents by whether the phrase appears in the title, a heading or the
  body. `grep -ril -- "$ARGUMENTS"` in a skill block is precisely what the checker refuses to parse.
- **`atlas config`** prints the *resolved* configuration rather than catting a file that hid every unset key
  behind an invisible default.

### Note on this release
- `b7ceddb` shipped 17 changed files declaring `0.1.12`, and was tagged `v0.1.13`. The release gate refused
  it and the refusal was stepped over: the push used `;` where `&&` belonged, so a non-zero exit did not stop
  the chain. The bump in that same command had never run either — a `PreToolUse` hook blocks the whole shell
  call, so when the commit was refused, the `perl` beside it was refused with it. The tag has been moved to
  the commit that actually declares `0.1.13`.

## [0.1.12] — 2026-08-10

### Added
- **The homepage draws a conclusion.** It stated figures and left every reader to already know whether 68.8%
  rework is normal, what a three-day window counts, or how many orphans a 27-document corpus should have.
  Six signals now carry a number, the band it is judged against, what it implies, and — where a figure is
  commonly over-read — what it does not mean. Thresholds are stated on the page, so a reader who disagrees
  can change them and the page changes with them.

  A signal whose input is unavailable is **omitted, not shown as zero**. A green line for a check that never
  ran is the worst output this tool could produce.
- **`docs/ANALYSIS.md` renders beneath it** when a repository writes one. The build never generates prose —
  that rule keeps the site byte-reproducible and keeps unreviewed claims off a page people quote. This
  repository now has one, and it argues with three of its own four red signals.

## [0.1.11] — 2026-08-10

### Added
- **A shipped change must name the roadmap item it advances.** The plan in this repository went stale for 35
  commits, was rewritten with a paragraph explaining how it had gone stale, and then went stale again across
  the next six releases — while the dashboard printed *"Spec to build — named by a commit: 0 of 20"* on its
  front page throughout. Keeping it current was something to remember, and remembering does not work.

  The commit hook now refuses a change under `scripts/ bin/ skills/ hooks/ plugins/ .claude-plugin/` whose
  message names no item, and lists the open ones so the refusal is actionable without opening another file.
  `automation.specOnCommit`, default `true`.

  Deliberately the weakest useful rule: it enforces that the plan was **opened**, not that a percentage moved.
  A machine cannot know whether `D-6` went from 0% to 40%, and a gate that guessed would either be wrong or
  train people to type a number to get past it. Finished items are not offered — new work does not advance
  something already at 100%.

  A message the hook cannot read is **refused, not skipped**: `git commit -F -` hands the text to git on
  stdin, out of the hook's sight, and a gate that waves through the cases it cannot parse is a gate that is
  off. The message is piped to the gate rather than passed as an argument, so a quote in a commit message can
  never rewrite the command checking it.

## [0.1.10] — 2026-08-10

### Added
- **A repository where the plugin does nothing now says so.** Both hooks are inert without a
  `project-atlas.config.json` — deliberately, so installing the plugin does not start writing `docs/_wiki`
  into every repository you open or gating commits in projects that never adopted it. But *inert and silent*
  is indistinguishable from *broken*, and it read as broken: enabled in the plugin list, no dashboard, no
  explanation, in a repository holding 349 indexable markdown files.

  One line at session start, naming the count and the two commands. It stays quiet outside a git repository,
  quiet where a config exists, and quiet below three markdown files — a Swift app with one README does not
  want a knowledgebase, and a plugin that suggests itself in every directory is one people disable.

## [0.1.9] — 2026-08-10

### Fixed
- **`/atlas:diff` failed before it started, on a permission prompt for a call that would never run.** The
  block was `test -n "$ARGUMENTS" && atlas diff "$ARGUMENTS" || echo "(no file given …)"`. Claude Code splits
  a compound command on its operators and asks approval per fragment, so it asked for `atlas diff ""` — the
  invocation the guard existed to prevent. A trailing `|| echo` fallback is fine; a guard that *constructs* a
  second, nonsense invocation is not.

### Changed
- **`atlas diff` with no path lists the changed files** instead of printing usage and exiting 1. It is more
  useful on its own, and it is what lets the skill drop the guard: the tool handles the empty case, so the
  shell does not have to. On a branch that has not diverged it says "in the last commit(s)" rather than the
  previous "on main since main".
- Two tests: the skill block must contain exactly one `atlas diff` invocation and no guard around it, and
  `atlas diff` with no path must list files rather than error. The existing guarantee — that no skill block
  renders blank when `atlas` is missing — still holds and still has its test.

## [0.1.8] — 2026-08-10

### Fixed
- **Role-view panels left holes the size of their tallest neighbour.** The panels were a CSS grid, which lays
  out uniform row tracks, so one long card — "What this dashboard does not show" runs to a dozen lines —
  reserved that height for every short card beside it. `align-items:start` stops a card stretching; it cannot
  stop the row being tall. They now pack Pinterest-style with CSS columns, `column-span:all` keeping the tile
  strip and section blurb full width. Applied only where panels are peers, because column flow trades reading
  order for density.
- **A paragraph rendered as vertical strips of shredded text.** `.empty` was `display:flex`, which makes every
  inline fragment a flex item — so "This view claims the cluster(s) `engineering, specs`, and none of them
  exists…" became three boxes side by side. Six of the seven such messages are ordinary sentences with inline
  code; only one opens with a status dot, and an inline-block dot needs no flex container.

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
