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
# (so several projects run at once without contending), the server exits after four idle hours, and it is
# inert unless this repository has adopted the tool. It is backgrounded because a session must never wait
# on a dashboard. *This comment said thirty minutes for four releases after A-21 widened the window — a
# stale comment beside the code it describes, which no signal checks and only a reader catches.*
#
# Off with ATLAS_SERVE=0 in the environment.
[ "${ATLAS_SERVE:-1}" = "0" ] && exit 0

# **This is the natural place to say that nothing is going to work, and it said nothing.**
#
# `git rev-parse` from the session directory is right for a session started inside a checkout and wrong for
# the ordinary multi-repository shape — a parent directory holding thirteen independent repositories, with
# the work in one of them. There it fails, this exits 0, and so does every other hook for the rest of the
# session: no dashboard, no task record, no rebuild, and not one word about any of it.
#
# So this hook is where the notice lands, because it is the one script here that runs exactly once per
# session and can therefore say something once without any bookkeeping at all. A session id is not even
# needed — `always` covers the case where `jq` is missing and there is none to read.
#
# It is still silent for a repository that has simply not adopted the tool. That is a different fact, it is
# already covered by the adoption line `atlas version --notice` prints above, and announcing it here would
# put a line into every unrelated repository the user opens.
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
sid=""
if command -v jq >/dev/null 2>&1; then
  sid=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
fi
atlas_resolve_root '' "$sid"
case $? in
  0) root=$ATLAS_ROOT ;;
  1) exit 0 ;;
  # `plain`, because a SessionStart hook's stdout becomes the session's context as it stands. Wrapping this
  # in hook JSON would put an object into the transcript where a sentence belongs.
  *) atlas_warn_no_repo "$sid" always plain; exit 0 ;;
esac
# Started in the background so the session never waits, then the URL is printed once it is answering. A
# SessionStart hook's stdout becomes context, so this is the one place a link can be surfaced at the top of
# every session without anyone running a command to ask for it.
"$S" serve --quiet --no-open --root "$root" >/dev/null 2>&1 &
i=0
while [ $i -lt 20 ]; do
  url=$("$S" serve --status --root "$root" 2>/dev/null | sed -n 's|.*\(http://127\.0\.0\.1:[0-9]*/\).*|\1|p' | head -1)
  [ -n "$url" ] && break
  i=$((i + 1))
  sleep 0.25
done
[ -n "$url" ] && echo "project-atlas: live dashboard at $url (rebuilds and patches itself on every change)"

# Record which session was told, so `on-activity.sh` — which announces the URL to any session that has not
# heard it, and is the only thing that covers the run where this hook exited early because the config did
# not exist yet — does not repeat the line after every tool call for the rest of this session.
if [ -n "$url" ] && [ -n "$sid" ]; then
  mkdir -p "$root/.atlas" 2>/dev/null
  printf '%s' "$sid" > "$root/.atlas/serve-announced" 2>/dev/null
fi
exit 0
