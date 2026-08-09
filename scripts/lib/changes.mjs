/**
 * project-atlas · what changed
 *
 * A developer's most common question is "what changed, and what did it touch" — and until now neither the CLI
 * nor any view answered it.
 *
 * Two scopes, because they answer different questions:
 *  - **working** — uncommitted and staged. What have I done that is not saved.
 *  - **branch** — this branch against its merge-base with the default branch. What does this branch *do*.
 *    That is not the same as the last N commits: a branch off an older base includes work the last two
 *    commits miss, and a branch with ten commits is still one change.
 *
 * ## The part that only this tool can do
 *
 * Changing `src/auth.ts` is uninteresting on its own. Changing it when `docs/architecture/auth.md` cites that
 * file and has not been touched in four months is the finding — and the corpus index already knows it. Every
 * changed source file is matched against the documents that cite it, so a code change surfaces the
 * documentation it has just put out of date.
 */

import { execFileSync } from 'node:child_process';

/**
 * Two shapes deliberately. `git()` raises on an unexpected failure, because a command that silently returns
 * nothing looks exactly like a repository with no changes — the failure mode this project cares about most.
 * `probe()` is for questions whose answer may legitimately be "no": a ref that does not exist, a branch that
 * was never created. There, a non-zero exit is the answer, not an error.
 */
function run(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

const git = (root, args) => {
  try {
    return run(root, args);
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not a git repository|unknown revision|bad revision|ambiguous argument|not a valid object name|no merge base/i.test(msg)) return null;
    throw new Error(`git ${args[0]} failed: ${msg.split('\n')[0]}`);
  }
};

const probe = (root, args) => { try { return run(root, args); } catch { return null; } };

/** Parse `--numstat` into rows. `-` means binary, which is reported as such rather than as zero. */
function numstat(out) {
  if (!out) return [];
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
    if (!m) return null;
    return {
      path: m[3],
      added: m[1] === '-' ? null : Number(m[1]),
      removed: m[2] === '-' ? null : Number(m[2]),
      binary: m[1] === '-',
    };
  }).filter(Boolean);
}

/**
 * The branch this repository actually treats as its trunk. Assuming `main` breaks on every repository that
 * still uses `master` or a custom default — and it broke the test fixtures here, which is how it was found.
 */
export function defaultBranch(root, cfg = {}) {
  if (cfg.branching?.main) return cfg.branching.main;
  const head = probe(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) return head.trim().replace(/^refs\/remotes\/origin\//, '');
  for (const b of ['main', 'master', 'develop']) {
    if (probe(root, ['rev-parse', '--verify', '--quiet', b])) return b;
  }
  return 'main';
}

export function readChanges(root, cfg = {}, index = null) {
  const main = defaultBranch(root, cfg);
  const branch = (probe(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
  if (!branch) return { available: false, reason: 'not a git repository, or no commits yet' };

  const unstaged = numstat(git(root, ['diff', '--numstat']));
  const staged = numstat(git(root, ['diff', '--cached', '--numstat']));

  // The branch's own work: everything since it diverged. Falls back to the last two commits when the branch
  // has not diverged — on `main` there is no merge-base to compare against.
  let base = null, scope = 'branch';
  const mb = probe(root, ['merge-base', 'HEAD', main]);
  const head = probe(root, ['rev-parse', 'HEAD']);
  if (mb && head && mb.trim() !== head.trim()) base = mb.trim();
  if (!base) { base = (probe(root, ['rev-parse', 'HEAD~2']) || '').trim() || null; scope = 'last-2-commits'; }
  const committed = base ? numstat(git(root, ['diff', '--numstat', `${base}..HEAD`])) : [];
  const commits = base
    ? (git(root, ['log', '--format=%h %s', `${base}..HEAD`]) || '').split('\n').filter(Boolean)
    : [];

  const all = dedupe([...unstaged, ...staged, ...committed]);
  return {
    available: true, branch, main, scope, base: base && base.slice(0, 8),
    unstaged, staged, committed, commits,
    docsAtRisk: index ? docsCiting(all.map((f) => f.path), index) : [],
    clusters: index ? clusterOf(all.map((f) => f.path), index) : {},
  };
}

function dedupe(rows) {
  const by = new Map();
  for (const r of rows) {
    const cur = by.get(r.path);
    if (!cur) { by.set(r.path, { ...r }); continue; }
    cur.added = (cur.added || 0) + (r.added || 0);
    cur.removed = (cur.removed || 0) + (r.removed || 0);
  }
  return [...by.values()];
}

/**
 * Documents that cite a file which just changed. The finding is the pair, not either half: a stale document
 * matters when the code under it moves, and a code change matters when something documented depends on it.
 */
function docsCiting(changedPaths, index) {
  const changed = new Set(changedPaths);
  const out = [];
  for (const d of index.documents) {
    const hits = d.citations.filter((c) => c.resolved && changed.has(c.resolved));
    if (!hits.length) continue;
    out.push({
      doc: d.path, title: d.title, date: d.git?.date || null,
      cites: [...new Set(hits.map((c) => c.resolved))],
    });
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));   // oldest document first
}

function clusterOf(paths, index) {
  const by = {};
  for (const p of paths) {
    const d = index.documents.find((x) => x.path === p);
    if (d) by[p] = d.cluster;
  }
  return by;
}

/** One file's diff. Returned as text for a caller to summarise — never dumped at a model unasked. */
export function fileDiff(root, file, { scope = 'auto', cfg = {} } = {}) {
  const main = defaultBranch(root, cfg);
  const working = git(root, ['diff', '--', file]) || '';
  const stagedD = git(root, ['diff', '--cached', '--', file]) || '';
  if (scope !== 'branch' && (working.trim() || stagedD.trim())) {
    return { scope: 'working', diff: (stagedD + working).trim(), from: 'uncommitted and staged changes' };
  }
  const mb = probe(root, ['merge-base', 'HEAD', main]);
  const head = probe(root, ['rev-parse', 'HEAD']);
  let base = mb && head && mb.trim() !== head.trim() ? mb.trim() : null;
  let from = `this branch against its merge-base with ${main}`;
  if (!base) { base = (probe(root, ['rev-parse', 'HEAD~2']) || '').trim() || null; from = 'the last two commits'; }
  if (!base) return { scope: 'none', diff: '', from: 'no history to compare against' };
  return { scope: 'branch', diff: (git(root, ['diff', `${base}..HEAD`, '--', file]) || '').trim(), from };
}

/* ------------------------------------------------------------------ report */

export function formatChanges(k, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });
  if (!k.available) return `No change data: ${k.reason}`;

  const L = [];
  const row = (f) => `  ${(f.binary ? 'bin' : `+${f.added}/-${f.removed}`).padStart(11)}  ${f.path}`;

  L.push(c.bold(k.branch) + c.dim(`  comparing against ${k.base || '—'} (${k.scope === 'branch' ? `merge-base with ${k.main}` : 'the last two commits'})`));
  L.push('');

  if (k.staged.length) { L.push(c.bold(`Staged (${k.staged.length})`)); k.staged.forEach((f) => L.push(row(f))); L.push(''); }
  if (k.unstaged.length) { L.push(c.bold(`Uncommitted (${k.unstaged.length})`)); k.unstaged.forEach((f) => L.push(row(f))); L.push(''); }

  if (k.committed.length) {
    L.push(c.bold(`Committed on this branch (${k.committed.length} file(s), ${k.commits.length} commit(s))`));
    k.committed.slice(0, 30).forEach((f) => L.push(row(f)));
    if (k.committed.length > 30) L.push(c.dim(`  … and ${k.committed.length - 30} more`));
    L.push('');
    for (const cm of k.commits.slice(0, 10)) L.push(c.dim(`  ${cm}`));
    L.push('');
  }

  if (!k.staged.length && !k.unstaged.length && !k.committed.length) L.push(c.dim('  Nothing changed.'));

  if (k.docsAtRisk.length) {
    L.push(c.bold('Documentation that cites what you changed') + c.dim('  oldest first'));
    for (const d of k.docsAtRisk.slice(0, 12)) {
      L.push(`  ${c.yellow(d.date || 'undated')}  ${d.doc}`);
      L.push(c.dim(`               cites ${d.cites.slice(0, 3).join(', ')}${d.cites.length > 3 ? ` and ${d.cites.length - 3} more` : ''}`));
    }
    if (k.docsAtRisk.length > 12) L.push(c.dim(`  … and ${k.docsAtRisk.length - 12} more`));
    L.push('');
    L.push(c.dim('  These are not necessarily wrong. They are the documents whose ground just moved.'));
  }
  return L.join('\n');
}
