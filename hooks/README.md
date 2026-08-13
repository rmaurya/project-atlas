# Hooks

**The enforcement layer.** Everything else project-atlas asks of an assistant is prose in `SKILL.md` — advisory,
and any session can drift from it. A hook is executed by the harness, so it cannot be forgotten, reasoned
around, or skipped because a change "seemed small".

There are **six scripts, wired to eight entries across six events**. *This paragraph said "two" for as long as
there were more than two — a count in prose, next to a list that grew, with nothing checking the two against
each other. It is the same drift the tool detects in documentation, in the documentation of the tool.*

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

`atlas-bin.sh` is a helper rather than a hook: it decides *which build answers*, so that working on this tool
does not have the installed copy rebuild the working copy's output with an older feature set.

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
