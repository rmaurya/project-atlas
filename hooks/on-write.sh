#!/bin/sh
# project-atlas · rebuild after a markdown write
#
# The wiki is derived, so it should never be something anyone remembers to regenerate. This runs after a
# session writes a `.md` file and rebuilds the site.
#
# **What that costs is a function of the corpus, and this comment used to state one corpus as if it were the
# rule** — "roughly half a second", measured at 27 documents. At 411 documents, 76,853 lines and 2,045
# citations it is **36.8 seconds**, once per markdown write. The hook was doing exactly what it was designed
# to do; what was missing is that nothing measured the assumption or restated it as the corpus grew. So the
# build now times itself and says so on the way past (A-67), and `automation.buildOnWriteMaxSeconds` is there
# for a repository that decides the trade is no longer worth paying on every edit.
#
# **It always exits 0.** This is a refresh, not a check: failing the edit that triggered it would punish the
# author for a problem in the generator. A build that fails still says so on stderr, which reaches Claude — the
# rule this project cares about is that nothing degrades *silently*, not that everything blocks.
#
# Inert unless the repository has a project-atlas.config.json, so installing the plugin does not start writing
# a docs/_wiki into unrelated repositories. Turn it off with `automation.buildOnWrite: false`.
#
# **This hook holds the one unambiguous answer to "which repository", and for four releases it threw it
# away.** It is handed the path that was written. The repository containing that path is not a guess and not
# a preference — it is the tree that just changed. Everything here ran from the process cwd instead, so a
# session whose directory is a parent holding several checkouts rebuilt nothing at all. See
# hooks/atlas-root.sh for the measurement and for what the other hooks do with the answer this one finds.

payload=$(cat)

# Which build answers. Working on this tool itself, the installed plugin is an older feature set writing the
# same output directory — see hooks/atlas-bin.sh. The inline fallback keeps the hook working if the helper is
# missing, because a hook that cannot find a helper must still do its job rather than silently stop.
ATLAS_BIN_HELPER="${CLAUDE_PLUGIN_ROOT:-.}/hooks/atlas-bin.sh"
if [ -r "$ATLAS_BIN_HELPER" ]; then . "$ATLAS_BIN_HELPER"; else
  atlas_bin() { printf '%s' "${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"; }
fi
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

# Without jq the file path cannot be read, and rebuilding on every write regardless would be worse than not
# running: most writes are not markdown.
command -v jq >/dev/null 2>&1 || exit 0

p=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')
sid=$(printf '%s' "$payload" | jq -r '.session_id // ""')

# **Resolved before the markdown filter, on purpose.** The build below only ever wants a `.md`, but the
# *answer to which repository* is wanted by `on-task.sh`, `on-activity.sh` and `on-continuity.sh`, none of
# which is handed a path by anything. A session editing only TypeScript would otherwise never establish one,
# and the task log would stay as empty as it was before this was fixed — so every write records the
# repository it landed in, and only markdown goes on to rebuild.
atlas_resolve_root "$p" "$sid"
case $? in
  0) root=$ATLAS_ROOT ;;
  1) exit 0 ;;                          # a repository that never adopted this: inert, and quiet about it
  *) atlas_warn_no_repo "$sid"; exit 0 ;;
esac
[ "$ATLAS_ROOT_FROM" = path ] && atlas_remember_root "$root" "$sid"

case "$p" in
  *.md) ;;
  *) exit 0 ;;
esac

# **Recover the dashboard if it died.**
#
# The session-start hook brings the server up, and nothing brought it back if it later stopped — a crash, a
# stray kill, an idle timeout, a machine asleep. The failure is silent in the worst way: the page in front of
# someone keeps looking like a dashboard while serving nothing, which is the exact confusion this project
# spent a session chasing. So every markdown write also makes sure it is up.
#
# `atlas serve` is idempotent and cheap when the server is already running — it reads a pidfile, finds a live
# pid and returns. Backgrounded regardless, because an edit must never wait on a dashboard.
#
# `--root` because the server it is reviving belongs to the repository that changed, which is not necessarily
# the one this process is standing in — the port is derived from the root, so a `serve` pointed at the wrong
# tree brings up a second dashboard for a project nobody asked about.
("${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas" serve --quiet --no-open --root "$root" >/dev/null 2>&1 &)

# **`--stamp` is what makes the rebuild visible.** Without it this hook was actively worse than doing
# nothing: every build clears the output directory first, so a rebuild with no stamp *deletes* the
# `build-stamp.txt` that `atlas serve` wrote. The open page then polls a file that 404s, gives up after
# three misses, and sits there looking exactly like a live dashboard showing figures from an hour ago —
# the precise failure this whole surface exists to remove, reintroduced by the fix for it.
out=$("$(atlas_bin "$root")" build --auto --quiet --stamp --root "$root" 2>&1)
st=$?
if [ $st -ne 0 ]; then
  echo "project-atlas: the site did not rebuild after $p (exit $st). It is now older than the markdown." >&2
  [ -n "$out" ] && echo "$out" >&2
else
  # **A successful build is not always a silent one.** (A-67) `--quiet` suppresses the summary, which is
  # right: nobody asked for this build and nobody is reading a page count. What it must not suppress is the
  # build saying what it cost, or saying it skipped itself — those are addressed to the session, they are
  # rate-limited at the source, and until this line existed they were captured into `$out` and thrown away on
  # the successful path, which is every path that matters. Anything the tool prefixes with its own name is
  # meant to be read; everything else stays swallowed.
  printf '%s\n' "$out" | grep '^project-atlas:' >&2
fi
exit 0
