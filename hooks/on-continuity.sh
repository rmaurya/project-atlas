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
# **The argument is no longer what gets recorded.** It says which `hooks.json` entry invoked this script,
# which is not the same claim as which event the harness fired — and the difference reached the journal: a
# session in which no subagent ever ran still carries `a subagent finished on main at b23b05f`, because the
# hook wrote down what it was told rather than what it saw. A record whose whole value is that nobody has to
# check it cannot carry an attribution nobody checked. The event is now read out of the payload, and when the
# payload does not say, the record names no actor at all — an unattributed true statement beats an attributed
# false one.
#
# The argument is still passed by `hooks.json` and still accepted here, because dropping it would mean an
# older copy of this script installed alongside a newer `hooks.json` matched no branch and recorded nothing,
# silently. Accepting an argument this ignores costs nothing; the reverse costs the whole record.
#
# **Exactly two fields are read out of the payload, in one pass.** It also carries `transcript_path`, and
# this never opens it: the journal records what was decided and touched, never what was said. `jq` reads
# stdin straight off the pipe and hands back those fields joined by a space, so the payload is never captured
# and the transcript path is never so much as held in a variable here. The second field is the session id,
# which arrives with the repository fix below — a session directory that is not a repository is answered out
# of a memo keyed on it, and reading the payload twice is not an option when stdin is a pipe that jq drains.
#
# **It always exits 0.** These fire while a session is being torn down; failing there would turn a missing
# record into a visible error at the least useful possible moment.

# Without `jq` there is nothing to parse the payload with, so stdin is drained exactly as before and the
# event stays unknown. Unknown is a case this handles, below, rather than a case it guesses at: falling back
# to the argument is precisely what put an actor that never existed into an append-only file.
observed=''
sid=''
if command -v jq >/dev/null 2>&1; then
  # Joined with a space rather than emitted on two lines, so both come back through one command substitution
  # without a temporary file or a second read of a pipe that has already been drained. Neither field can
  # contain a space, so the split below is exact: an absent first field leaves the string starting with the
  # separator, and an absent second leaves it ending with one.
  fields=$(jq -r '[(.hook_event_name // ""), (.session_id // "")] | join(" ")' 2>/dev/null)
  observed=$(printf '%s' "${fields%% *}" | tr 'A-Z' 'a-z')
  sid=${fields#* }
fi
[ -n "$fields" ] || cat >/dev/null 2>&1 || true

# Lower-cased before matching so a harness that spells an event differently than the docs do is still
# recognised, rather than being demoted to an unattributed record over a capital letter.
case "$observed" in
  stop)         event=stop ;;
  subagentstop) event=subagent ;;
  precompact)   event=precompact ;;
  *)            event=unknown ;;
esac

A="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"
[ -x "$A" ] || exit 0

# Inert unless this repository has adopted the tool. Installing the plugin must not start writing a .atlas
# directory into every repository a session happens to touch.
#
# **Which repository, though, is not a question `git rev-parse` could answer here.** A `Stop` payload names
# no path, and a session directory that holds several checkouts is not a repository — so this exited 0 at
# every boundary and the journal recorded nothing at all for such a session. The resolver falls through to
# the repository this session was seen writing into; when there is none, it says so once rather than adding
# another silent exit at the one moment state was supposed to be flushed.
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
atlas_resolve_root '' "$sid"
case $? in
  0) root=$ATLAS_ROOT ;;
  1) exit 0 ;;
  *) atlas_warn_no_repo "$sid"; exit 0 ;;
esac

head=$(git -C "$root" rev-parse --short HEAD 2>/dev/null) || head='no commits'
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null) || branch='unknown'

case "$event" in
  precompact)
    # The one event that is unambiguously worth a record every time: context is about to be discarded, and
    # whatever is not on disk when it is will not survive. Rare, so it cannot flood anything.
    "$A" note progress "context compacted on $branch at $head — anything not journalled before this is gone" \
      --root "$root" --refs "$branch@$head" --agent compaction --quiet >/dev/null 2>&1
    ;;
  subagent)
    # A subagent's reasoning is discarded by design and only its final message reaches the main session, so a
    # finding it established is lost unless it was written down. Tagged so the main session can tell a
    # subagent's conclusion from its own — which is only worth anything now that the tag is observed.
    "$A" note progress "a subagent finished on $branch at $head" \
      --root "$root" --refs "$branch@$head" --agent subagent --quiet >/dev/null 2>&1
    ;;
  stop|unknown)
    # Stop fires at the end of every assistant turn, so recording unconditionally would write hundreds of
    # identical lines and bury the records a person actually wrote — a log nobody can read is a log nobody
    # reads. A turn that moved HEAD is a real boundary; a turn that did not is a heartbeat, and heartbeats do
    # not belong in an append-only file.
    #
    # An unidentified event takes the same guard, because Stop is the overwhelming majority of what fires
    # here: an unknown boundary recorded every time would flood the journal on any machine without `jq`,
    # which trades a misattributed record for an unreadable file. The cost is that on such a machine a
    # compaction whose HEAD did not move goes unrecorded. That is the honest half of the trade — the journal
    # under-reports rather than reporting something nobody observed.
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
    if [ "$event" = stop ]; then
      "$A" note progress "work landed on $branch — now at $head" \
        --root "$root" --refs "$branch@$head" --quiet >/dev/null 2>&1
    else
      # No actor is named because none was observed. The boundary itself is not in doubt — something fired a
      # hook and HEAD moved — so the record says that much and stops, rather than borrowing a name from the
      # argument and asserting a session that may never have happened.
      "$A" note progress "a session boundary was crossed on $branch — now at $head" \
        --root "$root" --refs "$branch@$head" --quiet >/dev/null 2>&1
    fi
    ;;
esac
exit 0
