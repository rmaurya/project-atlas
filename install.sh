#!/usr/bin/env sh
# project-atlas — one-line install for any runtime.
#
#   curl -fsSL https://raw.githubusercontent.com/rmaurya/project-atlas/main/install.sh | sh
#
# Detects what you have and installs accordingly. Nothing is downloaded that is not this repository, and
# nothing is written outside the target directory it prints.
set -eu

REPO="https://github.com/rmaurya/project-atlas.git"
say() { printf '%s\n' "$*"; }

if command -v claude >/dev/null 2>&1; then
  say "Claude Code detected — installing as a plugin."
  claude plugin marketplace add rmaurya/project-atlas
  claude plugin install atlas@project-atlas
  say ""
  say "Done. Try /atlas:help — and 'atlas' is on your PATH in the next session."
  exit 0
fi

if command -v codex >/dev/null 2>&1; then
  say "Codex detected — installing as a plugin."
  codex plugin marketplace add rmaurya/project-atlas
  codex plugin add atlas@project-atlas
  say ""
  say "Done. Start a new thread and use @atlas."
  exit 0
fi

# Antigravity scans its plugin directories on start, so a clone is the whole install.
for d in "$PWD/.agents/plugins" "$HOME/.gemini/config/plugins"; do
  if [ -d "$(dirname "$d")" ]; then
    mkdir -p "$d"
    say "Antigravity plugin directory found — cloning into $d/project-atlas"
    git clone --depth 1 "$REPO" "$d/project-atlas"
    say ""
    say "Done. Restart Antigravity to pick it up."
    exit 0
  fi
done

say "No supported agent found — installing the standalone CLI."
TARGET="${1:-$HOME/.local/share/project-atlas}"
git clone --depth 1 "$REPO" "$TARGET"
say ""
say "Done. Run it with:  $TARGET/bin/atlas --help"
say "Add $TARGET/bin to your PATH to use it as 'atlas'."
