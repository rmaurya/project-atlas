#!/usr/bin/env sh
# project-atlas — one-line install for any runtime.
#
#   curl -fsSL https://raw.githubusercontent.com/rmaurya/project-atlas/main/install.sh | sh
#
# Detects what you have and installs accordingly. Nothing is downloaded that is not this repository, and
# nothing is written outside the target directory it prints.
set -eu

REPO="https://github.com/rmaurya/project-atlas.git"
MANIFEST="https://raw.githubusercontent.com/rmaurya/project-atlas/main/.claude-plugin/plugin.json"
say() { printf '%s\n' "$*"; }

# **Report what is installed, not that something was attempted.**
#
# `claude plugin install` prints "already installed" and exits 0 without comparing versions, and this script
# printed "Done." underneath it. A user-scope plugin sat five releases behind for a whole day while the
# installer, the updater and the reload each reported success at a different layer. That is the same
# silent-gate shape the release gate fixed in CI, and it was live in the thing people run first.
#
# So: read the registrations, read the published version, and say which is which. Exits 1 when anything is
# behind, because "installed" and "current" are not the same claim.
verify_install() {
  command -v node >/dev/null 2>&1 || { say "node not found, so the installed version was NOT checked."; return 0; }
  node - "$MANIFEST" <<'NODE'
const fs = require('fs'), os = require('os'), path = require('path');
const cmp = (a, b) => {
  const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
  const [x, y] = [p(a), p(b)];
  if (x.length !== 3 || y.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
(async () => {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let regs = [];
  try {
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), 'utf8'));
    regs = Object.entries(db.plugins || {}).filter(([k]) => k.startsWith('atlas@'))
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
  } catch { console.log('No plugin registration found — the install did not record itself.'); process.exit(1); }

  let latest = null;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(process.argv[2], { signal: ac.signal }); clearTimeout(t);
    if (r.ok) latest = JSON.parse(await r.text()).version;
  } catch {}

  let behind = 0;
  for (const e of regs) {
    const c = latest ? cmp(e.version, latest) : null;
    if (c === -1) behind++;
    console.log(`  ${(e.scope || 'unknown').padEnd(6)} ${e.version}${c === -1 ? `  BEHIND ${latest}` : c === 0 ? '  current' : ''}`);
  }
  if (!latest) { console.log('  (the published version could not be read, so nothing was compared)'); process.exit(0); }
  if (regs.length > 1 && new Set(regs.map((e) => e.version)).size > 1) {
    console.log('  ! Registrations disagree. Updating one scope leaves the others behind.');
  }
  if (behind) {
    console.log(`\n  ${behind} registration(s) are behind ${latest}. Run /plugin inside Claude Code to update,`);
    console.log('  then `atlas version` to confirm the hooks in your session are the ones you just installed.');
    process.exit(1);
  }
})();
NODE
}

if command -v claude >/dev/null 2>&1; then
  say "Claude Code detected — installing as a plugin."
  claude plugin marketplace add rmaurya/project-atlas
  claude plugin install atlas@project-atlas
  say ""
  say "Installed versions:"
  if verify_install; then
    say ""
    say "Done and current. Try /atlas:help — and 'atlas' is on your PATH in the next session."
    # **Stated, not done.** The statusline puts the live dashboard's URL in the bar at the bottom of the
    # terminal, and turning it on means writing `statusLine` into ~/.claude/settings.json — the user's
    # configuration for every repository they open, not this tool's to edit. `docs/references/autonomy.md`
    # draws that line at the edge of the repository, and an installer that quietly reconfigured someone's
    # terminal would be the clearest possible crossing of it. So the installer names the command and stops;
    # the command itself refuses to overwrite a statusline somebody else wrote, and `--uninstall` undoes it.
    say ""
    say "Optional — pin the live dashboard's URL to your statusline, so it never scrolls away:"
    say "  atlas-statusline --install        (undo: atlas-statusline --uninstall)"
    exit 0
  fi
  say ""
  say "The install ran, but what is registered is not the published version. See above."
  exit 1
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
