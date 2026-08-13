/**
 * project-atlas · what a fan-out will collide on, before it collides
 *
 * **C-11 is one-sided and this is the other side.** The skill tells a session to fan independent work out to
 * subagents by default, gives one worktree per agent as the constraint, and prices the parallelism at "perhaps
 * an hour saved". It says nothing about what coordination costs, because when it was written nobody had
 * measured that. Now somebody has: six agents, seven branches off one base, **eleven merge commits**, and
 * hours of conflict resolution — in the session that produced this file.
 *
 * The important thing about that bill is that most of it was **knowable in advance**. Not predictable in
 * principle, not inferable from experience — *knowable*, from data sitting in the repository before the first
 * agent started:
 *
 *  - **Every branch appended to `tests/run.mjs` and `docs/ROADMAP.md`.** Both are append-only-by-convention
 *    files that every piece of work in this repository touches. Six branches sharing two files is six merges
 *    with a guaranteed conflict each, and the conflict region repeatedly cut mid-test, so the `});` below the
 *    marker closed whichever side survived — a resolution that compiles and silently drops a case.
 *  - **Duplicate plan-item ids.** `A-34` was filed by two agents independently; `A-38` and `A-39` by three.
 *    Every one had to be renumbered by hand *after* the fact, which left commit subjects naming ids that had
 *    since moved — permanently, because a commit subject cannot be corrected once it is merged.
 *
 * Both are contention over a shared namespace: one over lines in a file, one over the integers in an id. Both
 * are visible from `git diff --name-only` and one read of the plan per branch. So this module answers one
 * question — *given this base and these branches, what will they all touch?* — and answers it in both
 * namespaces, because two commands would mean the second one never gets run.
 *
 * ## What it deliberately does not do
 *
 * **It does not refuse anything.** Two branches touching one file is often correct and sometimes unavoidable;
 * a gate here would be a tool deciding how somebody splits their work, and it would be wrong often enough to
 * be switched off. It reports, in the order that matters, and the reader decides. The same argument H17 makes
 * about advising rather than blocking.
 *
 * **It does not allocate ids by writing to anything.** `nextFree` is a read: the highest id in use anywhere
 * across the base and every branch, plus one. An allocator with a lock file would be a second source of truth
 * for a fact the plan already holds, and the plan is the source of truth — the one rule everything else in
 * this tool follows.
 *
 * **It does not predict semantic conflict.** Two branches editing different functions in one file are listed
 * exactly like two branches editing the same line, because `git` cannot tell them apart before a merge and
 * neither can this. The claim is "these will need reconciling", never "these will fail".
 */

import { execFileSync } from 'node:child_process';
import { DEFAULT_PLANNING } from './planning.mjs';
import { compileRule } from './config.mjs';
import { defaultBranch } from './changes.mjs';
import { num } from './format.mjs';

/** Git, or `null`. Every caller here is a report that must degrade, not a gate that may crash. */
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

function gitLines(root, args) {
  const out = git(root, args);
  return out === null ? null : out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Every local branch except the base, newest commit first.
 *
 * Local only, and deliberately: the question is what *this* fan-out will collide on, and the agents in a
 * fan-out work in worktrees of one clone. A remote branch nobody here is working on is noise.
 */
function localBranches(root, base) {
  const refs = gitLines(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/']);
  if (!refs) return null;
  return refs.filter((b) => b !== base);
}

/**
 * The ids a plan file *defines*, by the same pattern `readPlanning` uses to find an item.
 *
 * The item heading, not every mention: `planning.itemPattern` matches the bold line that introduces an item,
 * so a paragraph that merely refers to `A-34` is not a definition of it. That distinction is the whole check —
 * two branches both *mentioning* A-34 is normal and correct; two branches both *introducing* it is the defect.
 */
export function definedIds(text, cfg = {}) {
  const p = { ...DEFAULT_PLANNING, ...(cfg.planning || {}) };
  const { re } = compileRule(p.itemPattern, '');
  if (!re) return null;
  const ids = new Set();
  for (const line of String(text ?? '').split('\n')) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/** `A-34` → `{ prefix: 'A', n: 34 }`. Anything else is left alone rather than guessed at. */
function splitId(id) {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(id);
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

/**
 * What a set of branches would contend over, against one base.
 *
 * `files` is per branch and computed from the **merge base**, not from the base tip: `diff base...branch`
 * asks "what has this branch changed since it diverged", which is the question. `diff base branch` would also
 * report every file the base moved on afterwards, so a long-lived branch would appear to touch half the
 * repository and the real overlap would be buried in it.
 */
export function readContention(root, cfg = {}, { base = null, branches = null } = {}) {
  const notes = [];
  if (git(root, ['rev-parse', '--git-dir']) === null) {
    return { available: false, reason: 'not a git repository, so there are no branches to compare', notes };
  }

  const baseRef = base || cfg.branching?.main || defaultBranch(root, cfg);
  if (git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]) === null) {
    return { available: false, reason: `the base \`${baseRef}\` does not resolve to a commit`, notes };
  }

  let names = branches && branches.length ? branches : localBranches(root, baseRef);
  if (names === null) return { available: false, reason: 'the branch list could not be read', notes };

  const planSource = (cfg.planning || DEFAULT_PLANNING).source || DEFAULT_PLANNING.source;

  const rows = [];
  const unresolved = [];
  for (const name of names) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`]) === null) { unresolved.push(name); continue; }
    const mergeBase = git(root, ['merge-base', baseRef, name])?.trim();
    if (!mergeBase) { unresolved.push(name); continue; }
    const files = gitLines(root, ['diff', '--name-only', `${mergeBase}..${name}`]) || [];
    const ahead = Number((git(root, ['rev-list', '--count', `${mergeBase}..${name}`]) || '0').trim()) || 0;
    // A branch with nothing on it cannot contend with anything, and listing it would pad the count that the
    // headline reports. Counted separately so "seven branches, one of them empty" stays sayable.
    rows.push({ name, ahead, files: [...new Set(files)].sort(), merged: ahead === 0 });
  }
  if (unresolved.length) {
    notes.push(`${unresolved.length} named ref(s) could not be resolved and were skipped: ${unresolved.join(', ')}.`);
  }

  const active = rows.filter((r) => !r.merged);
  const settled = rows.length - active.length;
  if (settled) notes.push(`${num(settled)} branch(es) have no commit the base does not already have, so they can contend with nothing and are excluded.`);

  /* ---- namespace one: files ---- */
  const byFile = new Map();
  for (const r of active) for (const f of r.files) {
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r.name);
  }
  const shared = [...byFile.entries()]
    .filter(([, bs]) => bs.length > 1)
    .map(([file, bs]) => ({ file, branches: bs, count: bs.length }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

  /* ---- namespace two: plan-item ids ---- */
  const ids = { source: planSource, available: false, reason: null, duplicates: [], defined: [], nextFree: [] };
  if (!planSource) {
    ids.reason = 'planning.source is not configured, so there is no plan file to read ids from';
  } else {
    const baseText = git(root, ['show', `${baseRef}:${planSource}`]);
    const baseIds = new Set(baseText === null ? [] : (definedIds(baseText, cfg) || []));
    if (baseText === null) {
      notes.push(`\`${planSource}\` does not exist on \`${baseRef}\`, so every id found on a branch counts as newly defined.`);
    }
    const all = new Set(baseIds);
    const byId = new Map();
    let read = 0;
    for (const r of active) {
      const text = git(root, ['show', `${r.name}:${planSource}`]);
      if (text === null) continue;
      read++;
      const found = definedIds(text, cfg);
      if (found === null) { ids.reason = 'planning.itemPattern was declined, so no id was read'; break; }
      for (const id of found) {
        all.add(id);
        // Only ids the branch *introduces*. An id already on the base is shared by construction and is not a
        // collision — every branch that carries the plan file carries every id in it.
        if (baseIds.has(id)) continue;
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(r.name);
      }
    }
    if (!ids.reason) {
      ids.available = true;
      ids.branchesRead = read;
      ids.defined = [...byId.entries()].map(([id, bs]) => ({ id, branches: bs })).sort((a, b) => a.id.localeCompare(b.id));
      ids.duplicates = ids.defined.filter((d) => d.branches.length > 1);
      // The allocator, as a read rather than a lock: the highest number in use anywhere — base or branch —
      // plus one, per prefix. Two agents given this answer at the same instant still collide; two agents given
      // it before they start, and told to take consecutive blocks, do not. It removes the guessing, not the
      // need to say who takes what.
      const top = new Map();
      for (const id of all) {
        const s = splitId(id);
        if (!s) continue;
        top.set(s.prefix, Math.max(top.get(s.prefix) ?? 0, s.n));
      }
      ids.nextFree = [...top.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([prefix, n]) => ({ prefix, next: `${prefix}-${n + 1}`, highest: `${prefix}-${n}` }));
    }
  }

  return {
    available: true, reason: null,
    base: baseRef,
    branches: active,
    settled,
    shared,
    ids,
    notes,
  };
}

/* ------------------------------------------------------------------ reporting */

export function formatContention(c, useColor = false) {
  const k = useColor
    ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
    : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

  const L = [];
  if (!c.available) {
    L.push(k.yellow(`  Contention could not be reported — ${c.reason}.`));
    return L.join('\n');
  }

  L.push(k.bold(`project-atlas · contention against ${c.base}`));
  L.push(k.dim(`${num(c.branches.length)} branch(es) with work the base does not have`));
  L.push('');

  if (!c.branches.length) {
    L.push(k.green('  No branch carries a commit the base does not already have — nothing can contend.'));
  } else if (!c.shared.length) {
    L.push(k.green('  No file is touched by more than one branch. These merge in any order.'));
  } else {
    L.push(k.bold('  Files more than one branch would touch'));
    L.push(k.dim('  Each is one conflict per merge after the first. The count is the number of branches.'));
    for (const s of c.shared) {
      const mark = s.count >= 3 ? k.red(String(s.count).padStart(4)) : k.yellow(String(s.count).padStart(4));
      L.push(`  ${mark}  ${s.file}`);
      L.push(k.dim(`        ${s.branches.join(', ')}`));
    }
  }

  L.push('');
  if (!c.ids.available) {
    L.push(k.dim(`  Plan-item ids were not checked — ${c.ids.reason}.`));
  } else {
    if (c.ids.duplicates.length) {
      L.push(k.bold('  Plan-item ids defined on more than one branch'));
      L.push(k.dim('  Each of these has to be renumbered by hand after the merge, and the commit subjects that'));
      L.push(k.dim('  name it cannot be corrected once it has landed.'));
      for (const d of c.ids.duplicates) L.push(`  ${k.red(d.id.padStart(6))}  ${d.branches.join(', ')}`);
    } else {
      L.push(k.green(`  No plan-item id is defined on more than one branch (${num(c.ids.defined.length)} new id(s) across ${num(c.ids.branchesRead || 0)} branch(es)).`));
    }
    if (c.ids.nextFree.length) {
      L.push('');
      L.push(k.bold('  Next free plan-item id, per prefix'));
      L.push(k.dim(`  Highest in use anywhere — ${c.ids.source} on ${c.base} or on any branch above — plus one.`));
      L.push(k.dim('  Hand these out before the fan-out starts. Two agents that both counted for themselves is'));
      L.push(k.dim('  how A-34 was filed twice and A-38 and A-39 three times each.'));
      for (const n of c.ids.nextFree) L.push(`    ${n.prefix.padStart(4)}  ${k.bold(n.next)}${k.dim(`   (highest in use: ${n.highest})`)}`);
    }
  }

  if (c.notes.length) {
    L.push('');
    L.push(k.bold('  Not counted'));
    for (const n of c.notes) L.push(k.dim(`    · ${n}`));
  }

  L.push('');
  L.push(k.dim('  This refuses nothing. Two branches on one file is often correct — the point is to know before'));
  L.push(k.dim('  the fan-out, not during the merge. Give each agent disjoint files where you can, and where you'));
  L.push(k.dim('  cannot, merge those branches first and rebase the rest onto the result.'));
  return L.join('\n');
}
