# Hooks

**The enforcement layer.** Everything else project-atlas asks of an assistant is prose in `SKILL.md` — advisory,
and any session can drift from it. A hook is executed by the harness, so it cannot be forgotten, reasoned
around, or skipped because a change "seemed small".

There is deliberately **one** hook.

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

## Why there is not a second one

A `PostToolUse` hook running `atlas health` after every markdown edit was written and removed. On a corpus of
any size it costs seconds per edit, and a check that makes every edit slower is a check people disable. Health
belongs at the point of commit — where a person is already pausing — not after every keystroke.

## Requirements

`jq`, which ships with macOS and most Linux distributions. **Without it the guard still runs**, matching the
raw hook payload instead of `.tool_input.command` and saying so on stderr. That is coarser — a commit command
quoted inside another string can match — but it fails towards checking rather than towards a guard that is
silently absent, which is the same rule the reports follow: a check that did not run is never reported as
having passed.

For the same reason, an `atlas branch` that cannot run at all — a half-installed plugin, a missing `bin/atlas`
— exits 2 and names the exit code rather than waving the commit through unchecked.

## Turning it off

`/plugin` → disable the plugin, or remove this file from your copy. It is a guard, not a lock.
