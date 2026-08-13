#!/bin/sh
# project-atlas · which repository is a hook talking about, and what it does when it cannot tell
#
# **Every hook here opened with `root=$(git rev-parse --show-toplevel) || exit 0`, and that one line switched
# the whole tool off for anyone whose session directory is not itself a repository.**
#
# Measured, not imagined. A session run from `~/Working/GitHub/UtilityServer/` — a plain directory holding
# thirteen independent checkouts, which is the ordinary shape of a multi-repo product — with the work done
# inside `utility-server-edge/`. `git rev-parse` from the session directory fails, every hook exits 0, and
# nothing happens: no task recorded, no rebuild after a write, no dashboard announcement. The child's
# `tasks-live.jsonl` held five records against a session's worth of work, and those five existed only because
# a handful of commands happened to `cd` into the child before the hook fired.
#
# **The failure looked exactly like success.** A hook that exits 0 having done nothing is indistinguishable
# from a hook that had nothing to do, and that is why this survived: the owner spent a session asking why
# tasks were missing from dashboards, and this was most of the answer.
#
# ---------------------------------------------------------------- how a hook finds its repository now
#
# Three sources, tried in order, cheapest-and-strongest first. The first that names a repository wins.
#
#   1 · **the path the tool call touched.** `on-write.sh` is handed a `file_path`; the repository containing
#       that file is not a guess, it is the tree that actually changed. `on-commit.sh` has the same thing in
#       a different form — the explicit `cd <dir>` A-47 already parses out of the command.
#
#   2 · **the session's own directory.** One `git rev-parse`, and in the ordinary single-repository session
#       this is the only step that ever runs. It stays first-and-only there so the common path costs what it
#       always cost.
#
#   3 · **the repository this session has already been seen working in.** `TaskCreate` carries no path and
#       neither does `Stop`; when the session directory is not a repository there is nothing left in the call
#       itself to go on. Rather than guess, a hook that *did* resolve a repository from a path writes it
#       down, keyed by session id, and the hooks with nothing to go on read it back.
#
# **Why not descend from the session directory.** It is the obvious fourth candidate and it is a guess: a
# parent holding thirteen checkouts offers thirteen answers and no way to choose between them, and finding
# out costs a directory scan on every tool call. The memo below is the same information obtained by
# observation instead — it only ever names a repository this session demonstrably wrote into, and reading it
# is two `test`s.
#
# **What the memo may never do is name somebody else's project.** Three things hold that line: it is written
# only from a path the tool call itself touched, only when that repository has adopted the tool, and it is
# re-validated on every read — a memo naming a directory that has since gone away, or has stopped being
# adopted, is discarded rather than acted on. It is scoped to one session id, so it can never carry
# yesterday's repository into today's session.
#
# ---------------------------------------------------------------- and when there is no repository at all
#
# **It says so, once.** That is the whole of the fix that could not be got wrong: the defect above cost a
# session because the failure was silent, and a silent failure in a tool whose entire subject is silent
# failure is not a defect anyone gets to leave in. But a hook that prints on every Bash call is a hook people
# switch off within an hour, after which nothing is reported ever again — so the notice is bound to one
# appearance per session, tracked by the same session-scoped marker the memo uses.
#
# Two distinctions the notice depends on, because getting either wrong makes it noise:
#
#   · **no repository** is what speaks. Nothing anywhere named a tree, so the tool is inert and nobody knows.
#   · **a repository that never adopted the tool** stays silent, exactly as it always has. The plugin is
#     installed per-user; announcing itself in every unrelated repository somebody opens is how it would
#     earn being uninstalled. `atlas version --notice` already covers the one repository worth suggesting
#     adoption in — the one the session is standing in.
#
# Off with ATLAS_HOOK_NOTICE=0. An environment variable rather than a config key, for the reason the update
# notice gives: this speaks precisely where there is no `project-atlas.config.json` to read a key out of.

# ---------------------------------------------------------------- the session-scoped state file
#
# Beside the update check's cache, under the same XDG root, because it is the same kind of thing: state that
# belongs to this machine and this user and must never be written inside a repository — least of all inside
# one this code has just failed to identify.
#
# ATLAS_STATE_DIR overrides it, which is what lets the suite drive these hooks without writing into the
# developer's own cache.
atlas_state_file() {
  ATLAS_STATE_FILE=''
  ATLAS_STATE_DIR_RESOLVED=''
  # A session id becomes part of a filename, so it is validated rather than sanitised: `case` matches with no
  # subprocess at all, and this runs on every tool call of a session whose directory is not a repository.
  # Anything outside the safe set is treated as no id — an unusable id must not become a path.
  case "$1" in
    '') return 1 ;;
    *[!A-Za-z0-9_-]*) return 1 ;;
  esac
  if [ -n "${ATLAS_STATE_DIR:-}" ]; then
    ATLAS_STATE_DIR_RESOLVED=$ATLAS_STATE_DIR
  elif [ -n "${XDG_CACHE_HOME:-}" ]; then
    ATLAS_STATE_DIR_RESOLVED=$XDG_CACHE_HOME/project-atlas/sessions
  elif [ -n "${HOME:-}" ]; then
    ATLAS_STATE_DIR_RESOLVED=$HOME/.cache/project-atlas/sessions
  else
    return 1                       # nowhere safe to write; the hooks degrade to sources 1 and 2 and say so
  fi
  ATLAS_STATE_FILE=$ATLAS_STATE_DIR_RESOLVED/$1
  return 0
}

# ---------------------------------------------------------------- the three sources, in order
#
# atlas_resolve_root <hint-path> <session-id>
#
#   0 · ATLAS_ROOT is an adopted repository — act on it
#   1 · a repository was found which has not adopted the tool — the caller exits, silently, as it always has
#   2 · nothing named a repository at all — the caller says so, once, and exits
#
# ATLAS_ROOT_FROM records which of the three answered, so a test can assert the order rather than the result.
atlas_resolve_root() {
  _hint=$1
  _sid=$2
  ATLAS_ROOT=''
  ATLAS_ROOT_FROM=''

  # 1 · the path this tool call touched. A hint is a preference and not an override: a markdown file written
  # to a scratch directory outside every repository must fall through to the session's own directory rather
  # than take the whole hook down with it, which is the shape that would have made this fix a regression.
  if [ -n "$_hint" ]; then
    _dir=$_hint
    if [ ! -d "$_dir" ]; then
      _dir=${_hint%/*}
      [ "$_dir" = "$_hint" ] && _dir=.        # a bare filename, so the directory is the one we are in
      [ -n "$_dir" ] || _dir=/                # a path directly under the root
    fi
    ATLAS_ROOT=$(git -C "$_dir" rev-parse --show-toplevel 2>/dev/null) || ATLAS_ROOT=''
    [ -n "$ATLAS_ROOT" ] && ATLAS_ROOT_FROM=path
  fi

  # 2 · the session's own directory. One `git`, and the only line that runs in an ordinary session.
  if [ -z "$ATLAS_ROOT" ]; then
    ATLAS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || ATLAS_ROOT=''
    [ -n "$ATLAS_ROOT" ] && ATLAS_ROOT_FROM=cwd
  fi

  # 3 · what this session was already observed working in. Two `test`s and a builtin read — no subprocess —
  # because for the session this whole file exists for, this branch is taken on every single tool call.
  if [ -z "$ATLAS_ROOT" ] && atlas_state_file "$_sid" && [ -r "$ATLAS_STATE_FILE.root" ]; then
    IFS= read -r ATLAS_ROOT < "$ATLAS_STATE_FILE.root" || :
    # Re-validated on read. A remembered path is a claim about the past, and acting on a claim that has since
    # stopped being true is exactly how a hook would write into a repository nobody is working in.
    if [ -n "$ATLAS_ROOT" ] && [ -d "$ATLAS_ROOT" ]; then
      ATLAS_ROOT_FROM=memo
    else
      ATLAS_ROOT=''
    fi
  fi

  [ -n "$ATLAS_ROOT" ] || return 2
  # The adoption guard, unchanged and still the last word. A hook must never act on a repository that has not
  # asked for it, however the root was arrived at.
  [ -f "$ATLAS_ROOT/project-atlas.config.json" ] || return 1
  return 0
}

# ---------------------------------------------------------------- writing the memo
#
# atlas_remember_root <root> <session-id>
#
# Called only by the hooks that resolved a repository from something the tool call itself touched — a written
# file, a `cd` target. Never from the session directory: that path needs no memo, and recording it would put
# a repository into the file on the strength of nothing having gone wrong yet.
atlas_remember_root() {
  _r=$1
  [ -n "$_r" ] || return 1
  # Only an adopted repository is worth remembering, and only an adopted repository is safe to remember: a
  # memo naming an unadopted tree would answer a later hook with a repository it must not touch anyway, and
  # would mask the adopted one the session goes on to work in.
  [ -f "$_r/project-atlas.config.json" ] || return 1
  atlas_state_file "$2" || return 1
  if [ ! -d "$ATLAS_STATE_DIR_RESOLVED" ]; then
    mkdir -p "$ATLAS_STATE_DIR_RESOLVED" 2>/dev/null || return 1
  fi
  # One file per session arrives here and none is ever revisited, so the sweep runs on the first write of a
  # session and never on the path of an ordinary tool call. Left out, this would grow a directory nobody ever
  # looks at — small, but the kind of litter this tool exists to notice rather than to leave.
  [ -e "$ATLAS_STATE_FILE.root" ] || \
    find "$ATLAS_STATE_DIR_RESOLVED" -type f -mtime +14 -exec rm -f {} + 2>/dev/null || :
  printf '%s\n' "$_r" > "$ATLAS_STATE_FILE.root" 2>/dev/null || return 1
  return 0
}

# ---------------------------------------------------------------- saying so, once
#
# atlas_warn_no_repo <session-id> [always] [plain]
#
# `always` is for the one hook that runs exactly once per session — `on-session-start.sh` — which therefore
# cannot repeat itself even without an id to key on. Everywhere else, no session id means no way to tell the
# first tool call from the thousandth, and the honest answer is to stay quiet: the same rule `on-activity.sh`
# already applies to the dashboard URL, for the same reason.
#
# `plain` skips the hook JSON. A SessionStart hook's stdout becomes context as it stands, so wrapping it
# would put a JSON object into the session rather than a sentence.
atlas_warn_no_repo() {
  [ "${ATLAS_HOOK_NOTICE:-1}" = "0" ] && return 1
  if atlas_state_file "$1"; then
    [ -e "$ATLAS_STATE_FILE.said" ] && return 1
    [ -d "$ATLAS_STATE_DIR_RESOLVED" ] || mkdir -p "$ATLAS_STATE_DIR_RESOLVED" 2>/dev/null
    : > "$ATLAS_STATE_FILE.said" 2>/dev/null
  elif [ "$2" != always ]; then
    return 1
  fi

  # Names the failure, the cause, what it costs, and the two ways out. A notice that only says something is
  # wrong is a notice that gets read once and ignored afterwards. Present tense throughout, because this is
  # said both at session start — where it is a forecast — and mid-session, where it is a report.
  _msg="project-atlas: no repository found, so this tool's hooks are doing nothing here — no task recorded, no
rebuild after a write, no dashboard. That is it being inert rather than having nothing to do, and the two are
otherwise indistinguishable, which is why this says so.

  session directory   ${PWD}
  which is            not a git repository

A hook finds its repository from the path a write touched, from an explicit \`cd <dir>\`, or from the session
directory — and on this call none of the three named one. If this directory holds several checkouts, that is
expected: work through paths inside one of them, or start the session in the checkout itself, and the hooks
pick it up from there. Said once per session; ATLAS_HOOK_NOTICE=0 turns it off."

  printf '%s\n' "$_msg" >&2
  if [ "$3" = plain ] || ! command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$_msg"
  else
    # On exit 0 stderr reaches only the debug log, so the line above reaches nobody by itself. `systemMessage`
    # is what puts it in front of the person, which is who can act on it.
    printf '%s' "$_msg" | jq -Rs '{systemMessage: .}'
  fi
  return 0
}
