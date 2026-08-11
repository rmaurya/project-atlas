#!/bin/sh
# project-atlas · "the build answering you is not the one you shipped"
#
# A whole session was spent debugging a tool that had already been fixed, because `atlas` on PATH resolved to a
# plugin cache two weeks behind the working copy in the same terminal. `/plugin` reported success and fetched
# nothing. Nothing anywhere said so.
#
# So: one line, at session start, only when something is actually behind. Never blocks, never repeats itself
# more than once a day, and says nothing at all when everything is current — a notice that appears every
# session is a notice people learn to scroll past, which costs it the one moment it needed to be read.
#
# **This makes a network request**, which is the second one this tool makes and is named in SECURITY.md
# alongside `atlas caps`. It is capped at one per 24 hours, times out after two seconds, caches its result
# outside any repository, and caches failures too so an offline machine does not retry every session.
#
# Turn it off with ATLAS_UPDATE_CHECK=0 in your environment. It is deliberately an environment variable and
# not a config key: this runs in every session, including in repositories that have no project-atlas config to
# read a key from.

payload=$(cat 2>/dev/null)   # only the session id is read from this

[ "${ATLAS_UPDATE_CHECK:-1}" = "0" ] && exit 0

S="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"
[ -x "$S" ] || exit 0

# Synchronous on purpose. A SessionStart hook's output only becomes context while the process is alive, so
# backgrounding this would print into the void. The wait is bounded by the two-second fetch timeout, and only
# on the one session a day that actually performs a fetch — every other session reads the cache and returns
# immediately. Any failure inside prints nothing and exits 0.
"$S" version --notice 2>/dev/null || true

# ---------------------------------------------------------------- live dashboard
#
# The dashboard is only useful if it is up, and a server someone has to remember to start is a server that
# is usually not running. Worse, its absence is silent: the page keeps polling a stamp it can no longer
# reach, gives up after three misses, and goes on looking exactly like a live dashboard. A frozen page was
# read as the dashboard for an entire session before anyone noticed.
#
# So it starts here. Three things keep that from becoming litter: the port is derived from the repository
# (so several projects run at once without contending), the server exits after 30 idle minutes, and it is
# inert unless this repository has adopted the tool. It is backgrounded because a session must never wait
# on a dashboard.
#
# Off with ATLAS_SERVE=0 in the environment.
[ "${ATLAS_SERVE:-1}" = "0" ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/project-atlas.config.json" ] || exit 0
# Started in the background so the session never waits, then the URL is printed once it is answering. A
# SessionStart hook's stdout becomes context, so this is the one place a link can be surfaced at the top of
# every session without anyone running a command to ask for it.
"$S" serve --quiet --no-open >/dev/null 2>&1 &
i=0
while [ $i -lt 20 ]; do
  url=$("$S" serve --status 2>/dev/null | sed -n 's|.*\(http://127\.0\.0\.1:[0-9]*/\).*|\1|p' | head -1)
  [ -n "$url" ] && break
  i=$((i + 1))
  sleep 0.25
done
[ -n "$url" ] && echo "project-atlas: live dashboard at $url (rebuilds and patches itself on every change)"

# Record which session was told, so `on-activity.sh` — which announces the URL to any session that has not
# heard it, and is the only thing that covers the run where this hook exited early because the config did
# not exist yet — does not repeat the line after every tool call for the rest of this session.
if [ -n "$url" ] && command -v jq >/dev/null 2>&1; then
  sid=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
  [ -n "$sid" ] && printf '%s' "$sid" > "$root/.atlas/serve-announced" 2>/dev/null
fi
exit 0
