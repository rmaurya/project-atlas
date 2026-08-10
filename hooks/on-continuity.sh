#!/bin/sh
# project-atlas · flush continuity state at the moments a session can end
#
# A handoff written at the end of a session is written exactly when it cannot be: the session that gets
# killed, compacted or interrupted never reaches its own last step. An instruction telling an agent to
# journal is advisory, and a terminated agent reads nothing. The harness fires these events whether or not
# the agent cooperated, which is what makes them the tool's to claim.
#
# Called as: on-continuity.sh <stop|subagent|precompact>
#
# The event arrives as an argument rather than being parsed out of the payload, so this needs no `jq`. The
# payload is read and discarded — it carries `transcript_path`, and this never opens it. The journal records
# what was decided and touched, never what was said.
#
# **It always exits 0.** These fire while a session is being torn down; failing there would turn a missing
# record into a visible error at the least useful possible moment.

event="$1"
cat >/dev/null 2>&1 || true          # drain stdin; the payload is deliberately unused

A="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"
[ -x "$A" ] || exit 0

# Inert unless this repository has adopted the tool. Installing the plugin must not start writing a .atlas
# directory into every repository a session happens to touch.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/project-atlas.config.json" ] || exit 0

head=$(git -C "$root" rev-parse --short HEAD 2>/dev/null) || head='no commits'
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch='unknown'

case "$event" in
  precompact)
    # The one event that is unambiguously worth a record every time: context is about to be discarded, and
    # whatever is not on disk when it is will not survive. Rare, so it cannot flood anything.
    "$A" note progress "context compacted on $branch at $head — anything not journalled before this is gone" \
      --refs "$branch@$head" --agent compaction --quiet >/dev/null 2>&1
    ;;
  subagent)
    # A subagent's reasoning is discarded by design and only its final message reaches the main session, so a
    # finding it established is lost unless it was written down. Tagged so the main session can tell a
    # subagent's conclusion from its own.
    "$A" note progress "a subagent finished on $branch at $head" \
      --refs "$branch@$head" --agent subagent --quiet >/dev/null 2>&1
    ;;
  stop)
    # Stop fires at the end of every assistant turn, so recording unconditionally would write hundreds of
    # identical lines and bury the records a person actually wrote — a log nobody can read is a log nobody
    # reads. A turn that moved HEAD is a real boundary; a turn that did not is a heartbeat, and heartbeats do
    # not belong in an append-only file.
    #
    # The marker lives beside the journal but is not part of it: the journal is never rewritten, and this is
    # overwritten every time. Keeping them separate is what preserves that property.
    marker="$root/.atlas/last-stop"
    prev=$(cat "$marker" 2>/dev/null || echo '')
    [ "$prev" = "$head" ] && exit 0
    mkdir -p "$root/.atlas" 2>/dev/null || exit 0
    printf '%s' "$head" > "$marker" 2>/dev/null || true
    # First run has no marker, so there is nothing to compare and no move to report. Recording the current
    # position as if it were a change would put a false boundary in the record.
    [ -z "$prev" ] && exit 0
    "$A" note progress "work landed on $branch — now at $head" \
      --refs "$branch@$head" --quiet >/dev/null 2>&1
    ;;
esac
exit 0
