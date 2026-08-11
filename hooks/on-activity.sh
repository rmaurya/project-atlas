#!/bin/sh
# project-atlas · keep the dashboard alive while a session is alive, and say where it is
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
#
# ---------------------------------------------------------------- announcing the URL
#
# For a while this hook started the server and said nothing, and `on-session-start.sh` was the only place in
# the whole tool that ever printed the link. That hook requires `project-atlas.config.json` to exist *at
# session start* — which is precisely false on the run that adopts the tool, because the config is written
# by that run. So the first session in a repository, the one where someone is waiting to see the thing they
# just built, is the exact session that was never told the port. Three repositories were adopted in one
# afternoon, all three servers came up and answered, and none of them ever produced a link.
#
# The rule now is: **every session is told the URL exactly once, whichever path brought the server up.** A
# session marker holds the id we last announced to, so the announcement follows the session rather than the
# server — a server that was already running from yesterday still gets announced to a session that has not
# heard of it, and a session that was told at start is not told again on every tool call.
#
# The port is read out of the pidfile rather than by asking `atlas serve --status`, because this runs after
# every tool use and spawning node to learn a number we already have written down is the kind of cost that
# gets a hook deleted.

payload=$(cat 2>/dev/null)   # only the session id is read from this; never what was run

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/project-atlas.config.json" ] || exit 0

pidfile="$root/.atlas/serve.pid"
marker="$root/.atlas/serve-announced"

# The session id scopes the announcement. Without jq it cannot be read, and the fallback is to announce only
# when this hook is the one that starts the server — which still covers adoption, the case that was broken.
sid=""
if command -v jq >/dev/null 2>&1; then
  sid=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
fi

port_of() { [ -r "$pidfile" ] && sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$pidfile"; }

# Says the URL once per session. `announce always` is for the moment this hook actually starts a server —
# rare by nature, so it is said whether or not the session id could be read. `announce once` is for the
# already-running case, which happens after every single tool call: without a session id there is no way to
# tell the first from the thousandth, and the honest answer is to stay quiet rather than repeat.
announce() {
  p=$(port_of)
  [ -n "$p" ] || return 0
  if [ -n "$sid" ]; then
    [ -r "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$sid" ] && return 0
    printf '%s' "$sid" > "$marker" 2>/dev/null
  elif [ "$1" != "always" ]; then
    return 0
  fi
  echo "project-atlas: live dashboard at http://127.0.0.1:$p/ (rebuilds and patches itself on every change)"
}

# Already running? Then there is nothing to start — but this session may still never have been told where it
# is, which is the whole defect above. The pid is verified rather than trusted: a killed process leaves its
# pidfile behind, and believing a stale claim is how the server stays dead while the file says it is up.
if [ -r "$pidfile" ]; then
  pid=$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$pidfile")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then announce once; exit 0; fi
fi

# Not running. Bring it back, detached — a tool call must never wait on a dashboard, and must never fail
# because one could not start. Then wait, briefly and boundedly, for it to write its pidfile, so the link can
# be named in the same turn rather than one tool call later.
("${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas" serve --quiet --no-open >/dev/null 2>&1 &)
i=0
while [ $i -lt 12 ]; do
  [ -n "$(port_of)" ] && break
  i=$((i + 1))
  sleep 0.25
done
announce always
exit 0
