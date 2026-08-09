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

[ "${ATLAS_UPDATE_CHECK:-1}" = "0" ] && exit 0

S="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"
[ -x "$S" ] || exit 0

# Synchronous on purpose. A SessionStart hook's output only becomes context while the process is alive, so
# backgrounding this would print into the void. The wait is bounded by the two-second fetch timeout, and only
# on the one session a day that actually performs a fetch — every other session reads the cache and returns
# immediately. Any failure inside prints nothing and exits 0.
"$S" version --notice 2>/dev/null || true
exit 0
