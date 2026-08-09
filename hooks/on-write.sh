#!/bin/sh
# project-atlas · rebuild after a markdown write
#
# The wiki is derived, so it should never be something anyone remembers to regenerate. This runs after a
# session writes a `.md` file and rebuilds the site — roughly half a second on a 27-document corpus.
#
# **It always exits 0.** This is a refresh, not a check: failing the edit that triggered it would punish the
# author for a problem in the generator. A build that fails still says so on stderr, which reaches Claude — the
# rule this project cares about is that nothing degrades *silently*, not that everything blocks.
#
# Inert unless the repository has a project-atlas.config.json, so installing the plugin does not start writing
# a docs/_wiki into unrelated repositories. Turn it off with `automation.buildOnWrite: false`.

payload=$(cat)

# Without jq the file path cannot be read, and rebuilding on every write regardless would be worse than not
# running: most writes are not markdown.
command -v jq >/dev/null 2>&1 || exit 0

p=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')
case "$p" in
  *.md) ;;
  *) exit 0 ;;
esac

out=$("${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas" build --auto --quiet 2>&1)
st=$?
if [ $st -ne 0 ]; then
  echo "project-atlas: the site did not rebuild after $p (exit $st). It is now older than the markdown." >&2
  [ -n "$out" ] && echo "$out" >&2
fi
exit 0
