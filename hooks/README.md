# Hooks

**The enforcement layer.** Everything else project-atlas asks of an assistant is prose in `SKILL.md` — advisory,
and any session can drift from it. A hook is executed by the harness, so it cannot be forgotten, reasoned
around, or skipped because a change "seemed small".

There are **six hook scripts, wired to eight entries across six events**, and **two helpers** beside them that
`hooks.json` never names. *This paragraph said "two" for as long as there were more than two — a count in
prose, next to a list that grew, with nothing checking the two against each other. It is the same drift the
tool detects in documentation, in the documentation of the tool.*

| When | Hook | What it does | Blocks? |
|---|---|---|---|
| session start | `on-session-start.sh` | update notice, then starts the dashboard and prints its URL | never |
| after a `.md` write | `on-write.sh` | `atlas build` — index, dashboard, health, role views, knowledge graph | never |
| after `TaskCreate` / `TaskUpdate` | `on-task.sh` | records the task change, then rebuilds so the page is not stale | never |
| after **any** tool use | `on-activity.sh` | keeps the dashboard alive; tells this session its URL once | never |
| before `git commit` | `on-commit.sh` | `atlas branch`, `atlas health --gate`, `atlas spec --gate` | only on documentation rot |
| `Stop` · `SubagentStop` · `PreCompact` | `on-continuity.sh` | flushes a journal record at each boundary | never |

Every one of them is inert in a repository with no `project-atlas.config.json`. The plugin is installed
user-wide, and a plugin that starts writing `docs/_wiki` into unrelated repositories — or refusing their
commits — has decided someone else's policy for them.

Two files here are helpers rather than hooks. `atlas-bin.sh` decides *which build answers*, so that working on
this tool does not have the installed copy rebuild the working copy's output with an older feature set.
`atlas-root.sh` decides *which repository is the subject*, which is the section below.

## Which repository a hook is talking about

**Every script here opened with `root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0`, and that line
switched the whole tool off for anyone whose session directory is not itself a repository.**

Measured, not imagined. A session run from a directory holding thirteen independent checkouts — the ordinary
shape of a multi-repo product — with the work done inside one of them. `git rev-parse` fails from the parent,
every hook exits 0, and nothing happens: no task recorded, no rebuild after a write, no dashboard. One such
child's `tasks-live.jsonl` held **five** records against a session's worth of work, and those five existed
only because a few commands happened to `cd` into it before the hook fired. **The failure looked exactly like
success** — a hook that exits 0 having done nothing is indistinguishable from a hook that had nothing to do,
which is why it survived releases and cost a session spent asking why dashboards were missing tasks.

Three sources now, tried in order. The first that names a repository wins.

| | Source | Used by | Cost |
|---|---|---|---|
| 1 | the **path the tool call touched** | `on-write.sh` (`file_path`), `on-commit.sh` (the `cd` target A-47 parses) | one `git -C` |
| 2 | the **session's own directory** | all of them | one `git rev-parse` |
| 3 | the repository this session was **already seen working in** | `on-task.sh`, `on-activity.sh`, `on-continuity.sh` | two `test`s, no subprocess |

Source 1 is the strong one and it is not a guess: the repository containing the file that changed *is* the
tree that changed. Source 2 is the ordinary single-repository session, and it stays the only line that runs
there — the common path costs exactly what it always cost. Source 3 exists because a `TaskCreate` payload and
a `Stop` payload name no path at all; the hooks that *can* identify a repository from a path write it down,
keyed by session id, and the hooks that cannot read it back.

**Descending from the session directory was the obvious fourth candidate and it is a guess.** A parent
holding thirteen checkouts offers thirteen answers with no way to choose between them, and finding out costs
a directory scan on every tool call. Source 3 is the same information obtained by observation instead.

**The memo may never name somebody else's project.** Four things hold that line: it is written only from a
path the tool call itself touched, only when that repository has a `project-atlas.config.json`, and it is
re-validated on every read — a memo naming a directory that has gone away, or stopped being adopted, is
discarded rather than acted on. It is scoped to one session id, so it cannot carry yesterday's repository
into today's session. It lives beside the update check's cache under `XDG_CACHE_HOME`, never inside a
repository — least of all inside one the code has just failed to identify.

### And when there is no repository at all, it says so — once

That is the half of this that could not be got wrong. The defect above cost a session *because* it was
silent, and a silent failure in a tool whose entire subject is silent failure is not one anybody gets to
leave in. But a hook that prints after every Bash call is a hook people switch off within the hour, after
which nothing is ever reported again — so the notice is bound to one appearance per session, tracked by the
same session-scoped marker the memo uses. `on-session-start.sh` is where it usually lands, being the one
script here that runs exactly once and can therefore speak without any bookkeeping at all.

Two distinctions it depends on, because getting either wrong turns it into noise:

- **no repository** speaks. Nothing named a tree, the tool is inert, and nobody knows.
- **a repository that never adopted the tool** stays silent, exactly as it always has. This plugin is
  installed per user; announcing itself in every unrelated repository somebody opens is how it would earn
  being uninstalled. `atlas version --notice` already covers the one repository worth suggesting adoption
  in — the one the session is standing in.

Off with `ATLAS_HOOK_NOTICE=0`. An environment variable rather than a config key, for the same reason the
update notice gives: it speaks precisely where there is no `project-atlas.config.json` to read a key out of.

Once a root is resolved, every command a hook runs is given it explicitly — `atlas build --root`,
`atlas serve --root`, `atlas note --root`, and the three gates in `on-commit.sh`. A hook that resolved the
right repository and then invoked a command that asks `git` where *it* is has resolved nothing.

## Two verdicts, and the line between them

The commit hook runs three checks and they do not all carry the same weight.

| Check | The claim | Verdict |
|---|---|---|
| `atlas health --gate` | the **repository** is wrong: a dead link, a duplicate title, a missing `# ` | refuses, exit 2 |
| `atlas branch` | you are on a protected branch, or off the naming convention | warns |
| `atlas spec --gate` | this shipped change names no plan item | warns |
| any check that could not run | the **guard** is broken | warns, and says "NOT checked" |

**Blocking is reserved for a claim nobody can reasonably disagree with.** The other two are process SOPs —
statements about how work is organised, which is a judgement a person makes. Advisory health signals say
nothing at all here, for the same reason: they have legitimate causes, and a gate that fires on them is a
gate that gets switched off within a week.

That split was learned late and expensively. For one release everything here refused, and it stalled a live
session: each refusal opened with *"Safe to commit here. Branch follows the convention and is not
protected"* and then blocked over a commit message that **could not exist yet** — a `PreToolUse` hook runs
before the shell, so `cat > msg.txt && git commit -F msg.txt` was refused whole, the file was never written,
and the retry failed because the file was missing. One refusal was a crash inside the gate rather than a
finding. **A guard people disable is worse than no guard.**

**Exit 2 is the whole mechanism, and it is why a warning cannot simply be printed.** Claude Code feeds a
`PreToolUse` hook's stderr back to the model, and blocks the call, only on exit code 2; on exit 0 the same
text goes to the debug log. So warnings are written to stderr *and* emitted as hook JSON on stdout —
`systemMessage` for the person, `hookSpecificOutput.additionalContext` for the model — which is what makes a
non-blocking warning something anybody actually sees. (An earlier version shipped as `... && atlas branch >&2
|| exit 0`, where `A && B || exit 0` swallows B's status: eleven lines of refusal, exit 0, nothing ever
blocked and nothing ever read.)

The branch half exists because this project's own first five commits went straight to `main` while its
contributing guide preached discipline. A rule nobody notices being broken is not a rule — but noticing is
what it is for, and noticing does not require refusing.

**It only fires on `git commit`.** Every other Bash call exits 0 immediately, so the cost is one `jq` and one
`grep` per Bash invocation. It is silent when everything passes.

**To restore the old strictness**, per repository:

```json
{ "branching": { "sopGate": "enforce" } }
```

or `ATLAS_COMMIT_SOP=enforce` for one command. Then the SOPs and the could-not-run case refuse as well.

## The rebuild, and a reversal

An earlier version of this file argued there should never be a second hook, on the grounds that running
`atlas health` after every markdown edit costs seconds and *"a check that makes every edit slower is a check
people disable"*. That reasoning still holds, and health is still not run on write — it runs at the commit,
where a person is already pausing.

What changed is that **the build is not a check**. It is a regeneration of a derived artifact, it is measured
rather than assumed, and it is cheap:

```
atlas build    0.47s     27 documents, 14 generated files
atlas health   0.10s
```

A derived surface that refreshes only when someone remembers is a stale surface — which is the entire failure
this project exists to detect. So the write hook rebuilds, always exits 0, and never blocks the edit that
triggered it: a build failing is a problem with the generator, not with what the author just wrote. It still
says so on stderr, because nothing here degrades silently.

## The update notice

A session was spent debugging a tool that had already been fixed, because `atlas` on `PATH` resolved to a
plugin cache two weeks behind the working copy in the same terminal. `/plugin` reported *"already at the
latest version"* and fetched nothing, because it compares version strings and the version had not moved.

So this prints one line at session start, and only when something is behind:

```
project-atlas 0.1.0 → 0.1.3 available (local and user). Run /plugin to update.
```

Silent otherwise. **This is the only hook here that makes a network request**, so it is bound tightly: at most
once per 24 hours, two-second timeout, result cached outside any repository, failures cached too so an offline
machine does not retry every session. It is named in [SECURITY.md](../SECURITY.md) beside `atlas caps`.

Turn it off with `ATLAS_UPDATE_CHECK=0`. That is an environment variable rather than a config key on purpose:
it runs in every session, including in repositories with no `project-atlas.config.json` to read a key from.

For the same question asked deliberately rather than at startup:

```
$ atlas version
project-atlas 0.1.3
  commit    5a8fcfe
  running   /Users/you/Working/project-atlas
  source    working copy — not the installed plugin
  installed 0.1.1 local · 0.1.0 user
  latest    0.1.3  (checked 2026-08-10)

  ! 2 registrations disagree: 0.1.1 local · 0.1.0 user. Updating one scope leaves the others behind.
```

`--offline` skips the network entirely; `--check` forces a fetch rather than reading the day's cache.

## Continuity — `Stop`, `SubagentStop`, `PreCompact`

A handoff written at the end of a session is written exactly when it cannot be: the session that gets
killed, compacted or interrupted never reaches its own last step. An instruction telling an agent to journal
is advisory, and a terminated agent reads nothing — so the harness fires these three whether or not the
agent cooperated.

They append to `.atlas/journal/<contributor>.jsonl`, one line per record, and record **what was decided and
touched, never what was said**. Exactly one field is read out of the payload — `hook_event_name`, with `jq`,
straight off the pipe. The payload also carries `transcript_path`, and these never open it.

**The record names the event that fired, not the entry that invoked the script.** `hooks.json` passes the
event as an argument, and for a while that argument was what got written down — so a session in which no
subagent ever ran still carries `a subagent finished on main at b23b05f`. An attribution nobody checked has
no business in the one file whose value is that nobody has to check it. When the payload and the argument
disagree, the payload wins; when the payload does not say, no actor is named at all.

- **`PreCompact`** always records. Context is about to be discarded, and whatever is not on disk when it is
  will not survive. It is rare, so it cannot flood anything.
- **`SubagentStop`** always records, tagged `subagent`. A subagent's reasoning is discarded by design and
  only its final message reaches the main session.
- **`Stop`** records **only when HEAD moved**. It fires at the end of every assistant turn, so recording
  unconditionally would write hundreds of identical lines and bury the records a person actually wrote. A
  turn that moved HEAD is a boundary; a turn that did not is a heartbeat, and heartbeats do not belong in an
  append-only file. The comparison uses `.atlas/last-stop`, which is deliberately *not* part of the journal —
  it is overwritten every time, and the journal is never rewritten.
- **An event that cannot be read** — no `jq`, a malformed payload, a name this build does not know — records
  `a session boundary was crossed on <branch> — now at <sha>`, with no agent tag, and only when HEAD moved.
  The boundary is not in doubt; the actor is. An unattributed true statement beats an attributed false one,
  and the HEAD guard is what stops a machine without `jq` from writing one of these after every turn.

All three are inert unless the repository has a `project-atlas.config.json`, and all three exit 0 always:
they fire while a session is being torn down, and failing there would turn a missing record into a visible
error at the least useful possible moment.

## What is *not* here: the statusline

`bin/atlas-statusline` prints the live dashboard's URL into the Claude Code statusline. It reads a JSON
payload on stdin and writes one line to stdout, which is the shape of everything in this directory — and it
is deliberately not in this directory.

Every script here is named by [`hooks.json`](hooks.json), where the harness expands `${CLAUDE_PLUGIN_ROOT}`
for us. Nothing here is ever typed by a person, and nothing here is optional: install the plugin and the
hooks are live. The statusline is the opposite on both counts. `statusLine` is a key in the user's own
`settings.json`, so the string naming that file is written down by a human in a file this plugin does not
own, and it has to keep resolving across upgrades — which is why it lives in `bin/`, on `PATH`, addressable
as the bare name `atlas-statusline`.

**And nothing installs it.** Editing `~/.claude/settings.json` is a change to the user's environment across
every repository they open, which is outside the line [`autonomy.md`](../docs/references/autonomy.md) draws.
It is one stated command, `atlas-statusline --install`, reversed by `--uninstall`, and it refuses to
overwrite a statusline somebody else wrote. Full description in
[configuration.md](../docs/references/configuration.md#the-statusline--the-dashboard-url-where-it-cannot-scroll-away).

## Turning them off

The switches live in `project-atlas.config.json`, and all default to `true`:

```json
{ "automation": { "buildOnWrite": true, "healthOnCommit": true, "specOnCommit": true } }
```

An unknown key under `automation` is refused rather than ignored, and so is a non-boolean — `"false"` is a
truthy string, and a switch that fails open leaves you believing you turned something off that is still
running.

### What the write hook costs

Its own comment used to price the rebuild at *"roughly half a second"*, measured on a 27-document corpus. On a
411-document one — 76,853 lines, 2,045 citations — it is **36.8 seconds**, once per markdown write. Nothing
was wrong with the hook; what was missing is that a corpus-size assumption sat inside a default and nothing
measured it as the corpus grew.

So every build now says how long it took, and this hook forwards that sentence to the session rather than
swallowing it on the successful path. If the trade stops being worth it in your repository:

```json
{ "automation": { "buildOnWriteMaxSeconds": 10 } }
```

The automatic rebuild is then skipped once the last build here cost more than ten seconds — **and says so
every time, including that the site is now older than the markdown**. A build you type is never skipped.
Nothing here turns itself off quietly.

## Requirements

`jq`, which ships with macOS and most Linux distributions. **Without it the guard still runs**, matching the
raw hook payload instead of `.tool_input.command` and saying so on stderr. That is coarser — a commit command
quoted inside another string can match — but it fails towards checking rather than towards a guard that is
silently absent, which is the same rule the reports follow: a check that did not run is never reported as
having passed.

For the same reason, an `atlas branch` that cannot run at all — a half-installed plugin, a missing `bin/atlas`
— says so and names the exit code rather than waving the commit through unchecked. It does not refuse: the
plugin is installed for a user rather than a project, so a broken guard that blocked would stop commits in
repositories that never adopted this tool, over a defect in the tool.

To remove them entirely: `/plugin` → disable the plugin. They are guards, not locks.
