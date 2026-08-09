# Hooks

**The enforcement layer.** Everything else project-atlas asks of an assistant is prose in `SKILL.md` — advisory,
and any session can drift from it. A hook is executed by the harness, so it cannot be forgotten, reasoned
around, or skipped because a change "seemed small".

There are **two**, and they answer different questions: *is the derived site current?* and *is this commit
about to land known rot?*

| When | Hook | What it does | Blocks? |
|---|---|---|---|
| session start | `on-session-start.sh` | `atlas version --notice` — one line if the install is behind | never |
| after a `.md` write | `on-write.sh` | `atlas build` — index, dashboard, health page, six role views | never |
| before `git commit` | `on-commit.sh` | `atlas branch`, then `atlas health --gate` | yes, exit 2 |

Both are inert in a repository with no `project-atlas.config.json`. The plugin is installed user-wide, and a
plugin that starts writing `docs/_wiki` into unrelated repositories — or refusing their commits — has decided
someone else's policy for them.

## The branch guard

Before any `git commit`, `atlas branch` runs and exits non-zero when the working branch is protected. The
assistant sees the refusal and the fix — `atlas branch <type> <slug>` — before the commit happens rather than
after review.

**The hook exits 2, and that number is the whole mechanism.** Claude Code only feeds a `PreToolUse` hook's
stderr back to the model, and only blocks the call, on exit code 2; on exit 0 the same text goes to the debug
log and the tool call proceeds. This hook shipped as `... && atlas branch >&2 || exit 0`, where `A && B ||
exit 0` swallows B's status — the guard printed eleven lines of refusal and exited 0, so nothing was ever
blocked and nothing ever reached the assistant.

It exists because this project's own first five commits went straight to `main` while its contributing guide
preached discipline. A rule nobody notices being broken is not a rule.

**It only fires on `git commit`.** Every other Bash call exits 0 immediately, so the cost is one `jq` and one
`grep` per Bash invocation.

## The health gate

`atlas health --gate` runs after the branch guard passes and refuses the commit if a **blocking** signal fires
— a dead internal link, a duplicate title, a missing `# ` heading. Advisory signals say nothing: they have
legitimate causes, and a gate that fires on them is a gate that gets switched off within a week.

It is silent when the corpus is clean. A hook that prints on every commit is a hook people disable.

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

## Turning them off

Both switches live in `project-atlas.config.json`, both default to `true`:

```json
{ "automation": { "buildOnWrite": true, "healthOnCommit": true } }
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
— exits 2 and names the exit code rather than waving the commit through unchecked.

To remove them entirely: `/plugin` → disable the plugin. They are guards, not locks.
