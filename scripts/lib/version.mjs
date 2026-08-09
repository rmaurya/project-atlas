/**
 * project-atlas · which build is answering
 *
 * A session spent debugging a tool that had already been fixed, because `atlas` on `PATH` resolved to a plugin
 * cache two weeks behind the working copy in the same terminal, and nothing anywhere said so. `/plugin`
 * reported "already at the latest version" while the fixes sat unshipped, and the only way to establish the
 * truth was `which atlas` plus a `grep` through `installed_plugins.json`.
 *
 * Three facts have to be visible at once, because any two of them agreeing proves nothing:
 *
 *   1. the version of the code **currently executing**
 *   2. **where** that code lives — a working copy behaves differently from an installed plugin, and they can
 *      sit in the same directory tree with different contents
 *   3. what is **registered as installed**, per scope, because a plugin can be registered twice and the two
 *      registrations drift independently. This machine had `local 0.1.1` and `user 0.1.0` simultaneously.
 *
 * Everything here is pure: it takes already-read data and returns a report. Reading files and talking to the
 * network is the caller's job, so the disagreement logic is testable without a filesystem or a socket.
 */

/** Parse `major.minor.patch`, ignoring any suffix. `null` for anything else — never coerced to a number. */
export function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0, 1 — or `null` when either side is unparseable, which callers must handle rather than ignore. */
export function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * Is this path inside an installed plugin cache rather than a checkout someone is working in?
 *
 * The distinction matters more than it looks: edits to a working copy take effect immediately, edits to a
 * cache are overwritten by the next update, and a stale cache answering for a repository you are actively
 * editing is the exact confusion this module exists to end.
 */
export function isPluginCache(p) {
  return /[/\\]plugins[/\\]cache[/\\]/.test(String(p || ''));
}

/**
 * Every disagreement worth printing, given the running build and the registrations found on disk.
 *
 * Returns an array of `{ level, text }`. `warn` means the user is very likely running something other than
 * what they think; `info` is a difference that is expected and harmless.
 */
export function disagreements({ running, registrations = [], latest = null }) {
  const out = [];
  const versions = new Set(registrations.map((r) => r.version));

  if (versions.size > 1) {
    out.push({
      level: 'warn',
      text: `${registrations.length} registrations disagree: ` +
            registrations.map((r) => `${r.version} ${r.scope}`).join(' · ') +
            `. Updating one scope leaves the others behind.`,
    });
  }

  for (const r of registrations) {
    if (compare(r.version, running.version) === -1 && !running.fromCache) {
      out.push({
        level: 'warn',
        text: `The installed ${r.scope} plugin is ${r.version}, older than this working copy at ${running.version}. ` +
              `Anything invoking \`atlas\` from PATH gets ${r.version}.`,
      });
    }
  }

  if (latest && compare(running.version, latest) === -1) {
    out.push({ level: 'warn', text: `${running.version} → ${latest} is available. Run /plugin to update.` });
  }

  return out;
}

/**
 * The one-line notice for a session-start hook, or `null` when there is nothing worth interrupting for.
 *
 * One line, and only when something is actually behind. A notice that appears every session is a notice
 * people learn to scroll past, which costs it the one moment it needed to be read.
 */
export function updateNotice({ registrations = [], latest = null }) {
  if (!latest) return null;
  const behind = registrations.filter((r) => compare(r.version, latest) === -1);
  if (!behind.length) return null;
  const worst = behind.reduce((a, b) => (compare(a.version, b.version) === -1 ? a : b));
  const scopes = behind.map((r) => r.scope).join(' and ');
  return `project-atlas ${worst.version} → ${latest} available (${scopes}). Run /plugin to update.`;
}

/** The `atlas version` report. `useColor` follows the same convention as every other formatter here. */
export function formatVersion({ running, registrations = [], latest = null, checkedAt = null }, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
        red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  const L = [];
  L.push(`${c.bold('project-atlas ' + running.version)}`);
  L.push(`  ${c.dim('commit   ')} ${running.commit || c.dim('unknown — not a git checkout')}`);
  L.push(`  ${c.dim('running  ')} ${running.path}`);
  L.push(`  ${c.dim('source   ')} ${running.fromCache ? 'installed plugin' : 'working copy — not the installed plugin'}`);

  if (registrations.length) {
    L.push(`  ${c.dim('installed')} ` + registrations.map((r) => `${r.version} ${c.dim(r.scope)}`).join(' · '));
  } else {
    L.push(`  ${c.dim('installed')} ${c.dim('no registration found — running outside a plugin install')}`);
  }

  if (latest) L.push(`  ${c.dim('latest   ')} ${latest}${checkedAt ? c.dim(`  (checked ${checkedAt})`) : ''}`);
  else L.push(`  ${c.dim('latest   ')} ${c.dim('not checked — no network call was made')}`);

  const problems = disagreements({ running, registrations, latest });
  if (problems.length) {
    L.push('');
    for (const p of problems) L.push(`  ${p.level === 'warn' ? c.yellow('!') : c.dim('·')} ${p.text}`);
  }

  return L.join('\n');
}
