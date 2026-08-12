/**
 * project-atlas · lines that survived
 *
 * Every contribution figure in this tool carries the same disclaimer: *lines added is shown because it is
 * cheap to compute, not because it measures value.* It rewards a generated file and punishes a deletion, and
 * everyone reading it knows that, which makes it a number people learn to discount.
 *
 * Lines that are **still in the file today** is the closest honest measure available from git alone. It does
 * not reward churn: a thousand lines written and replaced next week count once, for whoever wrote what
 * remains. It cannot be gamed by volume, only by writing code that lasts.
 *
 * ## Why it is opt-in
 *
 * `git blame` walks the history of every line of every file. On this repository that is fractions of a
 * second; on a large one it is minutes, and a report that hangs is a report nobody runs twice. So it is a
 * separate command with a file cap, and the cap is **reported** — a truncated measurement presented as a
 * total is exactly the kind of quiet lie the rest of this project refuses.
 *
 * ## What it still does not measure
 *
 * Survival is not quality. A line nobody has revisited may be load-bearing or may be in a corner nobody
 * reads. Deleted work counted for nothing here and may have been the most valuable thing anyone did that
 * week — removing a bad abstraction leaves no surviving lines at all. This is a better number than lines
 * added. It is not a good number, and it is never combined into a score.
 */

import { execFileSync } from 'node:child_process';
import { num } from './format.mjs';

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** Authors of the lines currently in one file. Returns `null` when the file cannot be blamed. */
export function blameFile(root, file) {
  let out;
  try { out = git(root, ['blame', '--line-porcelain', '-w', '--', file]); }
  catch { return null; }                       // binary, deleted between listing and blaming, or unreadable
  const counts = new Map();
  for (const m of out.matchAll(/^author (.+)$/gm)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  return counts;
}

/**
 * Surviving lines per author across the tracked text files.
 *
 * `limit` caps how many files are blamed. The result always states how many were skipped, because a partial
 * count that presents itself as a whole is worse than no count.
 */
export function survivingLines(root, { limit = 400, include = /\.(m?js|ts|tsx|jsx|py|go|rs|java|rb|swift|kt|c|h|cpp|cs|php|sh|sql|json|ya?ml|md|css|html)$/i } = {}) {
  let files;
  try { files = git(root, ['ls-files', '-z']).split('\0').filter(Boolean); }
  catch { return { available: false, reason: 'not a git repository' }; }

  const candidates = files.filter((f) => include.test(f));
  const chosen = candidates.slice(0, limit);
  const skipped = candidates.length - chosen.length;

  const byAuthor = new Map();
  let lines = 0, unreadable = 0;
  for (const f of chosen) {
    const counts = blameFile(root, f);
    if (!counts) { unreadable++; continue; }
    for (const [author, n] of counts) {
      byAuthor.set(author, (byAuthor.get(author) || 0) + n);
      lines += n;
    }
  }

  // git names uncommitted lines "Not Committed Yet". It is a placeholder, not a person, and leaving it in
  // the list puts a fictional contributor in a report about contribution.
  const uncommitted = byAuthor.get('Not Committed Yet') || 0;
  byAuthor.delete('Not Committed Yet');
  lines -= uncommitted;

  const people = [...byAuthor.entries()]
    .map(([author, surviving]) => ({ author, surviving, share: lines ? Math.round((surviving / lines) * 1000) / 10 : 0 }))
    .sort((a, b) => b.surviving - a.surviving);

  return {
    available: true,
    people, lines, uncommitted,
    filesBlamed: chosen.length - unreadable,
    skipped,
    unreadable,
    // Stated, always. The rest of this tool reports what it did not check, and a capped blame is exactly that.
    notChecked: [
      skipped ? `${skipped} file(s) beyond the ${limit}-file cap were not blamed, so this is a sample.` : null,
      unreadable ? `${unreadable} file(s) could not be blamed and are excluded.` : null,
      `${files.length - candidates.length} tracked file(s) are not text this measures.`,
      uncommitted ? `${uncommitted} line(s) are not committed yet and belong to nobody until they are.` : null,
    ].filter(Boolean),
  };
}

export function formatSurviving(k, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });
  if (!k.available) return `Cannot measure surviving lines: ${k.reason}`;

  const L = [];
  L.push(c.bold(`${num(k.lines)} surviving line(s) across ${k.filesBlamed} file(s)`));
  L.push('');
  for (const p of k.people) {
    L.push(`  ${String(p.share).padStart(5)}%  ${String(p.surviving).padStart(7)}  ${p.author}`);
  }
  L.push('');
  L.push(c.bold('  What this is not'));
  L.push(c.dim('  · A quality measure. A line nobody revisited may be load-bearing or may be in a corner nobody reads.'));
  L.push(c.dim('  · A record of deleted work, which counted for nothing here and may have been the best thing done.'));
  L.push(c.dim('  · Part of any score. It is reported beside the other measures and never combined with them.'));
  for (const n of k.notChecked) L.push(c.dim(`  · ${n}`));
  return L.join('\n');
}
