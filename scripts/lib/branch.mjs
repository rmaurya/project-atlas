/**
 * docs-atlas · branch discipline
 *
 * Reports where you are and whether it is safe to commit there. Exists because this project's own first five
 * commits went straight to `main` while its contributing guide preached discipline — a rule nobody notices
 * being broken is not a rule, so this makes breaking it visible.
 *
 * It reports and it can create. It never commits, never pushes, and never switches away from a branch with
 * uncommitted work.
 */

import { execFileSync } from 'node:child_process';

export const TYPES = {
  feat: 'New capability',
  fix: 'A defect, with a test that fails without the fix',
  docs: 'Documentation only — no behaviour change',
  refactor: 'Behaviour identical, structure different',
  test: 'Tests only',
  chore: 'Tooling, CI, packaging, dependencies',
};

const CONVENTION = new RegExp(`^(${Object.keys(TYPES).join('|')})/[a-z0-9]+(-[a-z0-9]+)*$`);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function branchStatus(root, cfg = {}) {
  let current, dirty, protectedBranches, ahead = null;
  const main = cfg.branching?.main || 'main';
  protectedBranches = new Set([main, 'master', 'develop', ...(cfg.branching?.protected || [])]);

  try {
    current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return { ok: false, reason: 'not a git repository, or no commits yet' };
  }
  try {
    dirty = git(root, ['status', '--porcelain']).split('\n').filter(Boolean).length;
  } catch { dirty = 0; }
  try {
    ahead = Number(git(root, ['rev-list', '--count', `origin/${current}..${current}`]));
  } catch { ahead = null; }         // no upstream yet, which is normal for a fresh branch

  const onProtected = protectedBranches.has(current);
  const followsConvention = CONVENTION.test(current);

  const problems = [];
  if (onProtected) {
    problems.push({
      level: 'block',
      text: `You are on \`${current}\`, which is protected. Branch before making changes.`,
      fix: 'atlas branch <type> <slug>',
    });
  } else if (!followsConvention) {
    problems.push({
      level: 'warn',
      text: `\`${current}\` does not match \`type/short-slug\`. Types: ${Object.keys(TYPES).join(', ')}.`,
      fix: null,
    });
  }
  if (onProtected && dirty) {
    problems.push({
      level: 'block',
      text: `${dirty} uncommitted change(s) on a protected branch. Move them to a branch before committing.`,
      fix: 'atlas branch <type> <slug>   (carries the changes across)',
    });
  }

  return {
    ok: true, current, main, dirty, ahead,
    onProtected, followsConvention,
    safeToCommit: !onProtected,
    problems,
  };
}

/**
 * Create and switch to a conventional branch. Uncommitted work comes along — `git switch -c` keeps the
 * working tree, which is exactly what you want when you realise mid-change that you are on `main`.
 */
export function createBranch(root, type, slug) {
  if (!TYPES[type]) {
    return { ok: false, reason: `Unknown type "${type}". Use one of: ${Object.keys(TYPES).join(', ')}.` };
  }
  const clean = String(slug || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!clean) return { ok: false, reason: 'A slug is required — two to four words describing the change.' };
  if (clean.split('-').length > 6) {
    return { ok: false, reason: `"${clean}" is too long. Two to four words describing the change, not the files.` };
  }

  const name = `${type}/${clean}`;
  try {
    git(root, ['rev-parse', '--verify', name]);
    return { ok: false, reason: `Branch \`${name}\` already exists. Switch to it, or pick another slug.` };
  } catch { /* does not exist, which is what we want */ }

  try {
    git(root, ['switch', '-c', name]);
  } catch (err) {
    return { ok: false, reason: String(err?.stderr || err.message).split('\n')[0] };
  }
  return { ok: true, name };
}

export function formatBranch(st, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
        red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  if (!st.ok) return `Cannot read branch state: ${st.reason}`;

  const L = [];
  L.push(c.bold(st.current) + c.dim(
    `  ${st.dirty ? `${st.dirty} uncommitted change(s)` : 'clean'}` +
    (st.ahead ? ` · ${st.ahead} unpushed commit(s)` : '')));
  L.push('');

  if (!st.problems.length) {
    L.push(c.green('  Safe to commit here.') + c.dim(' Branch follows the convention and is not protected.'));
  }
  for (const p of st.problems) {
    L.push(`  ${p.level === 'block' ? c.red('✗') : c.yellow('!')} ${p.text}`);
    if (p.fix) L.push(c.dim(`      ${p.fix}`));
  }

  L.push('');
  L.push(c.dim('  Types: ' + Object.entries(TYPES).map(([k, v]) => `${k} — ${v.toLowerCase()}`).join('\n         ')));
  return L.join('\n');
}
