#!/bin/sh
# project-atlas · which build should answer, when the repository IS the tool
#
# **A-22, in the form that actually costs work.** Every hook here invokes `${CLAUDE_PLUGIN_ROOT}/bin/atlas`,
# which is the *installed* plugin. That is right in every repository except one: this tool's own. Working on
# project-atlas, the installed copy is whatever was last published — 0.1.64 while the working copy was on
# 0.1.66 — and it rebuilds the same output directory from older code.
#
# The failure is not a version banner nobody reads. A build with an older feature set does not merely produce
# stale pages; it produces a *different set of files*, and the output directory is cleared on every build. A
# session spent adding the markdown knowledge graph watched `docs/_wiki/kb/` — 65 files it had just written —
# disappear repeatedly, because each markdown edit fired `on-write.sh`, which ran the installed build, which
# had no `kb.mjs` and so regenerated the directory without it. The work was correct and kept vanishing, and
# nothing said why.
#
# A-22's build-owner record reports the disagreement after the fact. This prevents it for the case that
# matters: **when the repository being built is this tool, build it with its own code.** Anywhere else, the
# installed plugin is correct and is what gets used.
#
# The test is deliberately narrow. A repository merely containing a file called `scripts/atlas.mjs` is not
# this tool, so the plugin manifest has to name it too — the same identity check, and the same reason, as the
# marker files that let a build know an output directory is its own to delete.

# **The root is passed in now, and asking `git` is the fallback rather than the rule.** This asked the
# process cwd which repository it was in, which is the same question every hook used to ask and has the same
# wrong answer: a session sitting in a parent directory that holds several checkouts is in no repository at
# all, so this returned the installed plugin — correct by luck there, and *incorrect* the moment the session
# directory is one repository while the work is in another. `hooks/atlas-root.sh` has already worked out which
# tree is the subject by the time this is called; taking its answer is what keeps the two agreeing.
atlas_bin() {
  _root=${1:-}
  [ -n "$_root" ] || _root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$_root" ] && [ -x "$_root/bin/atlas" ] && [ -f "$_root/scripts/atlas.mjs" ] &&
     grep -q '"name"[[:space:]]*:[[:space:]]*"atlas"' "$_root/.claude-plugin/plugin.json" 2>/dev/null; then
    printf '%s' "$_root/bin/atlas"
    return 0
  fi
  printf '%s' "${CLAUDE_PLUGIN_ROOT:-.}/bin/atlas"
}
