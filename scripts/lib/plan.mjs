/**
 * project-atlas · propose the route, then wait
 *
 * Every other guard in this project is a refusal. `atlas branch` refuses a protected branch, the health gate
 * refuses known rot, the release gate refuses an unmoved version, the plan gate refuses work that names no
 * item. All of them fire at `git commit` — which is after the decision, not before it.
 *
 * Nothing proposed a route. The PR rule lived as prose in CONTRIBUTING.md:88 and was bypassed three times in
 * one session with nothing objecting, because the only mechanism watching was a commit hook and merging is
 * not committing.
 *
 * So this reads the working tree and prints what it would do — branch, type, whether the change ships and
 * therefore needs a version bump, and the route to `main` — and **executes nothing without `--apply`**.
 *
 * ## What it refuses to infer
 *
 * **The slug.** It names the change, not the file, which means it needs intent, and intent is not in a diff.
 * Inferring it from paths produces `fix/scan-mjs`, exactly what `references/branching.md` forbids. So it is
 * required, and without one the route still prints — with `slug ?` — and `--apply` refuses.
 *
 * **`feat` versus `fix`.** Both touch the same files; the difference is whether the old behaviour was
 * intended, which no diff records. The mechanical types are inferred (`test`, `docs`, `chore` follow from
 * paths alone) and the rest prints `type ?` rather than guessing. A wrong guess here is worse than a blank:
 * it would be accepted by a reader who trusted it.
 */

import { isRuntimePath } from './release.mjs';

/** Paths that decide a type on their own. Order matters — the first whose predicate holds all files wins. */
const MECHANICAL = [
  { type: 'test', holds: (p) => p.startsWith('tests/') },
  { type: 'docs', holds: (p) => p.endsWith('.md') },
  { type: 'chore', holds: (p) => p.startsWith('.github/') || p.startsWith('plugins/') ||
                                 p === 'install.sh' || p.endsWith('.json') || p.endsWith('.yml') },
];

/**
 * The type, or `null` when only a person can say.
 *
 * A change is only mechanically typed when **every** file agrees. A commit touching `tests/` and
 * `scripts/lib/` is not a test change, and calling it one would put the wrong word in front of the wrong
 * reader.
 */
export function inferType(paths) {
  if (!paths.length) return null;
  for (const m of MECHANICAL) if (paths.every(m.holds)) return m.type;
  return null;
}

/**
 * The whole route. Pure: it takes facts and returns a plan, so every branch of it is testable without a
 * repository in a particular state.
 */
export function route({ changed = [], slug = null, branch, main = 'main', protectedBranch = false,
                        version = null, hasRemote = false, items = [], namedItems = [] }) {
  const ships = changed.some((p) => isRuntimePath(p));
  const type = inferType(changed);
  const onTarget = branch && !protectedBranch && /^(feat|fix|docs|refactor|test|chore)\//.test(branch);

  const steps = [];
  const blockers = [];

  if (!changed.length) {
    return { empty: true, steps: [], blockers: ['Nothing has changed — there is no route to propose.'], ships, type, slug };
  }

  if (protectedBranch) {
    if (!slug) blockers.push(`On ${branch}, which is protected, and no slug was given. A slug names the change, not the file — it needs intent a diff does not carry.`);
    if (!type) blockers.push('The type cannot be inferred from these paths. feat and fix touch the same files; only you know whether the old behaviour was intended.');
    steps.push({ id: 'branch', text: `atlas branch ${type || '<type>'} ${slug || '<slug>'}`, note: 'carries the uncommitted work across' });
  } else if (!onTarget) {
    blockers.push(`\`${branch}\` does not match type/short-slug, so nothing downstream can read the type from it.`);
  } else {
    steps.push({ id: 'branch', text: `already on ${branch}`, done: true });
  }

  if (ships) {
    steps.push({
      id: 'version',
      text: version ? `bump ${version} in .claude-plugin/plugin.json` : 'bump the version in .claude-plugin/plugin.json',
      note: 'a shipped file changed, so CI refuses this without it',
    });
    steps.push({ id: 'sync', text: 'node scripts/sync-runtimes.mjs', note: 'the Codex copy travels with skills/' });
  }

  if (items.length && ships && !namedItems.length) {
    blockers.push('No roadmap item is named. The commit gate refuses a shipped change that names none — pick the item this advances.');
  }

  steps.push({ id: 'verify', text: 'node tests/run.mjs && atlas build --verify', note: 'the suite, and the generated site' });
  steps.push({ id: 'commit', text: 'git commit', note: 'branch guard, health gate and plan gate all run here' });

  if (hasRemote) {
    steps.push({ id: 'push', text: `git push -u origin ${branch && !protectedBranch ? branch : '<branch>'}`, note: 'outward-facing — never part of --apply' });
    steps.push({ id: 'pr', text: `open a pull request into ${main}`, note: 'CONTRIBUTING.md:88 — prose, and the only rule here nothing enforces' });
  }

  return { empty: false, steps, blockers, ships, type, slug, branch, protectedBranch };
}

/** The printed plan. Everything it will not do is stated, because a plan that hides its limits is a promise. */
export function formatRoute(r, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  const L = [];
  if (r.empty) return c.dim(r.blockers[0]);

  L.push(`  ${c.dim('type    ')} ${r.type || c.yellow('?  feat or fix — I cannot tell from the diff')}`);
  L.push(`  ${c.dim('slug    ')} ${r.slug || c.yellow('?  required — it names the change, not the file')}`);
  L.push(`  ${c.dim('ships   ')} ${r.ships ? 'yes — a version bump is required' : 'no'}`);
  L.push('');
  for (const s of r.steps) {
    L.push(`  ${s.done ? c.green('✓') : c.dim('·')} ${s.text}${s.note ? c.dim(`   ${s.note}`) : ''}`);
  }
  if (r.blockers.length) {
    L.push('');
    for (const b of r.blockers) L.push(`  ${c.red('✗')} ${b}`);
  }
  L.push('');
  L.push(r.blockers.length
    ? c.dim('  Nothing has been run. Answer the above, then: atlas plan <slug> --apply')
    : c.dim('  Nothing has been run.  atlas plan ' + (r.slug || '<slug>') + ' --apply   does the branch step only.'));
  return L.join('\n');
}
