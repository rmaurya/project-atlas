#!/bin/sh
# project-atlas · keep the dashboard alive while a session is alive
#
# The session-start hook brings the server up and prints its URL. Nothing kept it up: the server exits when
# nothing has requested anything for a while, and "nothing requested anything" is true of every session
# where the developer is talking rather than reading the dashboard. So the link printed at the top of the
# session goes dead partway through, and — this is the part that matters — **nothing says so**. That is the
# exact silent failure this feature exists to remove, reintroduced by its own idle timer.
#
# `on-write.sh` already revived it, but only on a markdown write. A session spent editing code, running
# tests or discussing design never touches a `.md` file and never triggers it.
#
# So: any tool use at all is evidence the session is alive. This runs after every one, and is written to
# cost nothing in the overwhelmingly common case where the server is already up.
#
# **The cheap check comes first and is the whole design.** Reading a pidfile and sending signal 0 is
# microseconds; spawning `atlas serve` is not. Without that guard this would fork a process after every tool
# call, which is a worse problem than the one it fixes.

payload=$(cat 2>/dev/null)   # drained and discarded; nothing here reads what was run

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/project-atlas.config.json" ] || exit 0

# Already running? Then do nothing at all. The pid is verified rather than trusted: a killed process leaves
# its pidfile behind, and believing a stale claim is how the server stays dead while the file says it is up.
pidfile="$root/.atlas/serve.pid"
if [ -r "$pidfile" ]; then
  pid=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$pidfile")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then exit 0; fi
fi

# Not running. Bring it back, detached and silent — a tool call must never wait on a dashboard, and must
# never fail because one could not start.
("${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas" serve --quiet --no-open >/dev/null 2>&1 &)
exit 0
