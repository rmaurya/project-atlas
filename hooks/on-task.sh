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

# Without jq the payload cannot be parsed, and guessing at it with sed would record malformed lines that the
# reader then has to defend against. Recording nothing is the honest failure.
command -v jq >/dev/null 2>&1 || exit 0

tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""' 2>/dev/null)
case "$tool" in
  TaskCreate|TaskUpdate) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/project-atlas.config.json" ] || exit 0

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
("${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas" build --auto --quiet >/dev/null 2>&1 &)
exit 0
