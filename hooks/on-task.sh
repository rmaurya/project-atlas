#!/bin/sh
# project-atlas · record the session's task list into the repository, as it changes
#
# **The dashboard said a project with seven open pieces of work was finished, three times in a row.**
#
# The plan panel reads `docs/ROADMAP.md`, which only knows what somebody has already written down and marked
# complete. The in-flight panel reads git, which sees files but not intent. Neither can see the task list the
# session is actually working from, because that list lives in the harness — and the owner, watching a page
# that claimed "62 items, all Done" while six things were open, quite reasonably read that as the dashboard
# being broken.
#
# The founding rule is that the dashboard shows what the repository knows. That rule is not the obstacle here;
# it is the instruction. The fix is not to teach the build to reach into the harness — it is to **write the
# task state into the repository as it happens**, which is exactly what `.atlas/journal/` already does for
# decisions and findings. Once it is on disk it is ordinary derived state, and the build reads it the same way
# it reads everything else.
#
# So: one append per task change, and a rebuild so the open page shows it. Both detached — a task update must
# never wait on a dashboard.
#
# The record is an operation, not a snapshot. Replaying the log yields current state, and a killed session
# loses at most the line it was writing — the same append-only discipline, for the same reason.

payload=$(cat 2>/dev/null)

# Which build answers. Working on this tool itself, the installed plugin is an older feature set writing the
# same output directory — see hooks/atlas-bin.sh. The inline fallback keeps the hook working if the helper is
# missing, because a hook that cannot find a helper must still do its job rather than silently stop.
ATLAS_BIN_HELPER="${CLAUDE_PLUGIN_ROOT:-.}/hooks/atlas-bin.sh"
if [ -r "$ATLAS_BIN_HELPER" ]; then . "$ATLAS_BIN_HELPER"; else
  atlas_bin() { printf '%s' "${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"; }
fi
# **`[ -r ]` before `.`, never `. file || fallback`.** A failed `.` is a special built-in failing, which ends
# the script outright under a POSIX shell — the `||` never runs, and the hook dies in the one case the
# fallback exists for: a half-installed plugin. Measured, on the test that already covers exactly that.
ATLAS_HELPER="${CLAUDE_PLUGIN_ROOT:-.}/hooks/atlas-root.sh"
if [ -r "$ATLAS_HELPER" ]; then . "$ATLAS_HELPER"; else
  # No helper, so the behaviour that shipped before it: the session's own directory, and silence when that
  # is not a repository. Worse than the fix, and still a working hook.
  atlas_resolve_root() { ATLAS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    [ -n "$ATLAS_ROOT" ] || return 2; [ -f "$ATLAS_ROOT/project-atlas.config.json" ] || return 1; }
  atlas_remember_root() { return 0; }
  atlas_warn_no_repo() { return 1; }
fi

# Without jq the payload cannot be parsed, and guessing at it with sed would record malformed lines that the
# reader then has to defend against. Recording nothing is the honest failure.
command -v jq >/dev/null 2>&1 || exit 0

tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""' 2>/dev/null)
case "$tool" in
  TaskCreate|TaskUpdate) ;;
  *) exit 0 ;;
esac

# **The line above this used to be `root=$(git rev-parse --show-toplevel) || exit 0`, and that is where the
# task log went.** A task change carries no file path — there is nothing in a `TaskCreate` payload that names
# a tree — so when the session directory is a parent holding several checkouts, this hook had nothing to go
# on and did the one thing it must not: exited 0, silently, on every task the session created. Five records
# in a whole session's log, all of them from commands that happened to `cd` first.
#
# It now asks `hooks/atlas-root.sh`, which falls through to the repository this session was already observed
# writing into. That is an observation rather than a guess — and when there is no observation either, this
# says so once instead of adding a sixth silent exit.
sid=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
atlas_resolve_root '' "$sid"
case $? in
  0) root=$ATLAS_ROOT ;;
  1) exit 0 ;;
  *) atlas_warn_no_repo "$sid"; exit 0 ;;
esac

mkdir -p "$root/.atlas" 2>/dev/null

# The id is the one field neither tool puts in its input on create: `TaskCreate` returns it in prose
# ("Task #7 created successfully: …"), so it is read back out of the response. An operation whose id cannot be
# recovered is dropped rather than written with a guessed one — a log that invents identifiers reconstructs a
# task list that never existed.
line=$(printf '%s' "$payload" | jq -c --arg tool "$tool" '
  (.tool_response // "" | if type == "string" then . else (.content? // "" | tostring) end) as $resp
  | (if $tool == "TaskCreate"
       then ($resp | capture("#(?<id>[0-9]+)").id? // "")
       else (.tool_input.taskId // "" | tostring)
     end) as $id
  | select($id != "")
  | {
      at: (now | todate),
      op: (if $tool == "TaskCreate" then "create" else "update" end),
      id: $id,
      subject: (.tool_input.subject // null),
      status: (.tool_input.status // (if $tool == "TaskCreate" then "pending" else null end)),
      activeForm: (.tool_input.activeForm // null),
    }' 2>/dev/null)

[ -n "$line" ] || exit 0

# One `printf` of one line, appended. A single write is what makes a killed session lose at most this record
# and never corrupt the ones before it.
printf '%s\n' "$line" >> "$root/.atlas/tasks-live.jsonl" 2>/dev/null

# **Rebuild, or the page keeps showing the state before the change.** This is the half that was missing: the
# data could have been on disk and the dashboard would still have looked frozen, because nothing regenerates
# it on a task change — `on-write.sh` only fires for markdown. Detached, so marking a task done never blocks
# on a build, and the open page picks it up through the stamp it already polls.
# **`--stamp` is what makes the rebuild visible.** Without it this hook was actively worse than doing
# nothing: every build clears the output directory first, so a rebuild with no stamp *deletes* the
# `build-stamp.txt` that `atlas serve` wrote. The open page then polls a file that 404s, gives up after
# three misses, and sits there looking exactly like a live dashboard showing figures from an hour ago —
# the precise failure this whole surface exists to remove, reintroduced by the fix for it.
#
# **`--root` for the same reason the record above is written to `$root` rather than to `.`.** A build with no
# root asks `git` where it is, from a cwd that has just been established as no repository at all — so the
# rebuild that makes the record visible would either fail or regenerate a different project's dashboard.
("$(atlas_bin "$root")" build --auto --quiet --stamp --root "$root" >/dev/null 2>&1 &)
exit 0
