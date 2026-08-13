#!/bin/sh
# project-atlas · commit guard
#
# Two checks, in the order that matters: you cannot be told your documentation is broken on a branch you
# should not have been committing to anyway.
#
#   1. atlas branch        — protected branch, or a name that does not follow type/short-slug
#   2. atlas health --gate — a blocking signal (dead link, duplicate title, missing H1) this commit would land
#
# **Exit 2 is the only code that stops the tool call and puts stderr in front of Claude.** Exit 1 is treated as
# an ordinary command failure and the commit proceeds, which is how the first version of this hook printed
# eleven lines of refusal and then let the commit through.
#
# When a check cannot run, this refuses anyway and says so. A guard that waves the commit past because it could
# not evaluate is the failure this project exists to detect.
#
# Turn the health half off with `automation.healthOnCommit: false` in project-atlas.config.json. It is also
# inert in any repository with no config file, so installing the plugin does not start policing repositories
# that never adopted it.

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  cmd=$payload          # no jq: match against the raw payload, which over-matches rather than under-matches
fi

# Not a commit? Say nothing. This hook sees every Bash call.
printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_./-])git[[:space:]]+commit' || exit 0

command -v jq >/dev/null 2>&1 || \
  echo 'project-atlas: jq was not found, so this matched the raw hook payload instead of .tool_input.command. Install jq for exact matching.' >&2

ATLAS="${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"

# **Judge the repository being committed in, not the one the session happens to be sitting in.**
#
# Every check below ran against the process cwd, which is the session's directory. Committing in a *second*
# repository — a sibling checkout, a worktree, anything reached with `cd` — therefore evaluated the wrong tree.
# Observed twice in one session: a commit in another project was refused because *this* repository was on a
# protected branch, and later because *this* repository had a blocking finding. Neither had anything to do
# with the commit being made, and the only way past it was to change branch in an unrelated project.
#
# The target comes from an explicit `cd <dir>` in the command when there is one, and otherwise from the
# payload's own `cwd`. Both are what the shell will actually use, so the guard and the commit agree on the
# subject. A directory that is not a repository, or one that never adopted this tool, leaves the guard inert —
# which it already promised to be, and now is across repository boundaries too.
target=$(printf '%s' "$cmd" | awk '
  match($0, /(^|[;&|][[:space:]]*)cd[[:space:]]+/) {
    s = substr($0, RSTART + RLENGTH)
    if (substr(s,1,1) == "\"")     { sub(/^"/,"",s);  sub(/".*/,"",s) }
    else if (substr(s,1,1) == "'"'"'") { sub(/^'"'"'/,"",s); sub(/'"'"'.*/,"",s) }
    else                            { sub(/[[:space:];&|].*/,"",s) }
    print s; exit
  }')
if [ -z "$target" ] && command -v jq >/dev/null 2>&1; then
  target=$(printf '%s' "$payload" | jq -r '.cwd // ""')
fi
ROOTARG=""
if [ -n "$target" ] && [ -d "$target" ]; then
  ROOTARG="--root $target"
fi

"$ATLAS" branch $ROOTARG >&2
st=$?
if [ $st -ne 0 ]; then
  [ $st -ne 1 ] && echo "project-atlas: the branch guard could not run (exit $st). This commit was NOT checked." >&2
  exit 2
fi

"$ATLAS" health --gate $ROOTARG >&2
st=$?
if [ $st -ne 0 ]; then
  [ $st -ne 1 ] && echo "project-atlas: the health gate could not run (exit $st). This commit was NOT checked." >&2
  exit 2
fi

# The plan gate needs the commit message. It is piped rather than passed as an argument so nothing has to be
# quoted back into a shell — a message containing a quote would otherwise rewrite the command running it.
#
# `git commit -F -` takes the message on stdin, where this hook cannot see it. That is reported as unreadable
# and refused by the gate rather than waved through: a check that silently skips the cases it cannot parse is
# a check that is off.
msg=$(printf '%s' "$cmd" | sed -n 's/.*-m[[:space:]][[:space:]]*"\([^"]*\)".*/\1/p')
[ -z "$msg" ] && msg=$(printf '%s' "$cmd" | sed -n "s/.*-m[[:space:]][[:space:]]*'\([^']*\)'.*/\1/p")

# Why the message is missing is something only this script can tell, and the difference matters: the gate
# used to name stdin for every case, which told someone who had written `-F "$DIR/msg.txt"` to use `-F
# <file>` — advice to do the thing they had just done. A guard is trusted, so misdiagnosis costs more than
# silence.
why=absent
if [ -z "$msg" ]; then
  f=$(printf '%s' "$cmd" | sed -n 's/.*-F[[:space:]][[:space:]]*\([^[:space:]]*\).*/\1/p')
  f=$(printf '%s' "$f" | sed "s/^[\"']//; s/[\"']$//")     # a quoted path is still quoted at hook time
  if [ "$f" = "-" ]; then
    why=stdin
  elif [ -n "$f" ]; then
    if [ -r "$f" ]; then msg=$(cat "$f"); else why=unresolved; fi
  fi
fi

printf '%s' "$msg" | "$ATLAS" spec --gate $ROOTARG --why "$why" >&2
st=$?
[ $st -eq 0 ] && exit 0
[ $st -ne 1 ] && echo "project-atlas: the plan gate could not run (exit $st). This commit was NOT checked." >&2
exit 2
