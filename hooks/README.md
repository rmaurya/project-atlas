# Hooks

**The enforcement layer.** Everything else project-atlas asks of an assistant is prose in `SKILL.md` — advisory,
and any session can drift from it. A hook is executed by the harness, so it cannot be forgotten, reasoned
around, or skipped because a change "seemed small".

There is deliberately **one** hook.

## The branch guard

Before any `git commit`, `atlas branch` runs and exits non-zero when the working branch is protected. The
assistant sees the refusal and the fix — `atlas branch <type> <slug>` — before the commit happens rather than
after review.

It exists because this project's own first five commits went straight to `main` while its contributing guide
preached discipline. A rule nobody notices being broken is not a rule.

**It only fires on `git commit`.** Every other Bash call exits 0 immediately, so the cost is one `jq` and one
`grep` per Bash invocation.

## Why there is not a second one

A `PostToolUse` hook running `atlas health` after every markdown edit was written and removed. On a corpus of
any size it costs seconds per edit, and a check that makes every edit slower is a check people disable. Health
belongs at the point of commit — where a person is already pausing — not after every keystroke.

## Requirements

`jq`, which ships with macOS and most Linux distributions. Without it the hook exits 0 and the guard is simply
absent — it never blocks work because a dependency is missing.

## Turning it off

`/plugin` → disable the plugin, or remove this file from your copy. It is a guard, not a lock.
