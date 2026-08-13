/**
 * project-atlas · branch discipline
 *
 * Reports where you are and whether it is safe to commit there. Exists because this project's own first five
 * commits went straight to `main` while its contributing guide preached discipline — a rule nobody notices
 * being broken is not a rule, so this makes breaking it visible.
 *
 * It reports and it can create. It never commits, never pushes, and never switches away from a branch with
 * uncommitted work.
 *
 * It also holds `inferAncestry` — **which branch a branch was probably cut from**. That is inference and
 * nothing here ever prints it as fact; see the docblock above the function for what git does and does not
 * record, and for the four answers it can give including "cannot tell".
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

  /*
   * A-5 · follow, warn, unfollow.
   *
   * A branching strategy is a team's decision, not this tool's, and a tool that only knows how to refuse
   * gets switched off entirely by the first team whose workflow it does not fit — taking every other check
   * with it. So the posture is a setting: `enforce` refuses, `warn` says so and proceeds, `off` is silent
   * about the convention.
   *
   * **`off` still reports.** Unfollowing the strategy is allowed; unfollowing it *silently* is not, which is
   * why even `off` leaves the state visible in `atlas branch` — it stops objecting, it does not stop telling
   * you where you are. A posture that could hide the fact would be a switch for making the repository lie
   * about itself.
   *
   * **The default is `enforce`, not the `warn` the plan specified.** That deviation is deliberate: this
   * guard already exists and already refuses, so shipping `warn` as the default would silently remove
   * protection from every repository that upgrades — a weakened safety default, applied to people who never
   * asked for it and would not be told. That is the exact class of change this project exists to catch.
   * Relaxing it stays available and stays a decision someone makes on purpose.
   */
  const posture = ['enforce', 'warn', 'off'].includes(cfg.branching?.posture) ? cfg.branching.posture : 'enforce';
  const level = posture === 'enforce' ? 'block' : 'warn';

  const problems = [];
  if (onProtected && posture !== 'off') {
    problems.push({
      level,
      text: `You are on \`${current}\`, which is protected. Branch before making changes.`,
      fix: 'atlas branch <type> <slug>',
    });
  } else if (!followsConvention && posture !== 'off') {
    problems.push({
      // Always advisory, at every posture. A name that does not match the convention is a readability
      // question, not a safety one — blocking work over it would make `enforce` unusable and teach people
      // to switch the whole posture off, taking the protected-branch guard with it.
      level: 'warn',
      text: `\`${current}\` does not match \`type/short-slug\`. Types: ${Object.keys(TYPES).join(', ')}.`,
      fix: null,
    });
  }
  if (onProtected && dirty && posture !== 'off') {
    problems.push({
      level,
      text: `${dirty} uncommitted change(s) on a protected branch. Move them to a branch before committing.`,
      fix: 'atlas branch <type> <slug>   (carries the changes across)',
    });
  }

  return {
    ok: true, current, main, dirty, ahead,
    onProtected, followsConvention, posture,
    // Only `enforce` makes a protected branch unsafe to commit on. Under `warn` the commit proceeds and the
    // warning stands in the record — which is the whole point of allowing a team to unfollow deliberately.
    safeToCommit: posture === 'enforce' ? !onProtected : true,
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

/* ------------------------------------------------------------------ where a branch came from (A-55) */

/**
 * How many branch tips take part in the ancestry pass. Anything past it is reported as *not measured* rather
 * than dropped, and never as "cut from main". 31 is a hard ceiling — the reachability pass below is one bit
 * per tip in a 32-bit integer — so a configured value above that is clamped and the clamp is stated.
 */
export const ANCESTRY_CAP = 24;

/** The answers, in the order the inference tries them. `unknown` is a result, not a failure to report. */
export const ANCESTRY_BASES = ['self', 'trunk', 'contained', 'diverged', 'unordered', 'ambiguous', 'unknown'];

const unknownAncestry = (name, reason) => ({
  name, parent: null, basis: 'unknown', forkCommit: null, trunkFork: null, reason,
  candidates: [], sharedWith: [], atForkPoint: [], sameCommit: [], descendants: [],
  counterpart: null, orderedBy: null, reflogFork: null,
});

/**
 * Which branch this branch was probably cut from.
 *
 * **Git does not record a parent.** A branch is a moving pointer at a commit and nothing anywhere stores where
 * that pointer started; `git switch -c` writes one line to a reflog that expires, and after ninety days even
 * that is gone. Everything below is therefore *inference from the commit graph*, and the whole design of this
 * function is about making the inference honest rather than making it always answer:
 *
 *   - **`self`** — this is the default branch. It has no parent to find.
 *   - **`trunk`** — nothing but the default branch's own history sits under this branch's fork point, so the
 *     branch was cut from the trunk. `sharedWith` names the other branches cut at the *same commit*, which is
 *     the one thing that stops this reading as "and nothing else was". Two branches 59 commits ahead of main
 *     off one fork point are siblings; picking either as the other's parent would be a coin toss printed as a
 *     finding.
 *   - **`contained`** — another branch's tip is an ancestor of this one, beyond the trunk fork point. The
 *     strongest evidence available, and *still* not proof: if X was cut from B and has not moved since, X's
 *     tip is an ancestor of B and this reads it backwards. The report says "probably" for exactly that reason.
 *   - **`diverged`** — this branch and another share history past the trunk, and split at a commit that is on
 *     neither tip. One was cut from the other, or both were cut from a third branch that has since moved or
 *     been deleted. The fork commit is a fact; which side is the parent is not, and only the fork commit is
 *     stated as one.
 *   - **`unordered`** — the same relation, seen from *both* sides: each of two branches is the other's nearest
 *     candidate, which is exactly what "cut a branch, then keep committing on the one you cut it from" looks
 *     like in the graph. **The DAG is genuinely symmetric here and no amount of reading it harder will break
 *     the tie** — the first draft of this function did not notice, and printed *`development` was cut from
 *     `feat/nested`* on one row and *`feat/nested` was cut from `development`* two rows below. Two rows of one
 *     report contradicting each other is worse than either being wrong alone. The relation is reported
 *     undirected, and `readAncestry` may then order it from the reflog, which knows something the graph does
 *     not; when it does, `orderedBy` says so, because a fact that holds only on this machine has to be labelled.
 *   - **`ambiguous`** — two or more candidates are equally good: the same fork commit, two branch names on one
 *     commit, or two ancestors that are not ancestors of each other. **Every candidate is named and no parent
 *     is chosen.** This is the case that a "pick the first one" implementation turns into a fabricated fact.
 *   - **`unknown`** — the question could not be asked at all: no common ancestor with the trunk, a trunk that
 *     is not among the refs read, a tip missing from the graph, or a branch past the cap. Reported with its
 *     reason and never softened into `trunk`.
 *
 * Pure over the graph it is handed, which is what makes it testable without a repository:
 *
 *   - `main`     the default branch's name.
 *   - `tips`     `[{ name, sha }]`, the branch tips to consider, **most interesting first** — the cap keeps a
 *                prefix of this list and reports the tail as unmeasured.
 *   - `commits`  `[{ sha, parents }]` in **topological order, children before parents** (`git rev-list
 *                --topo-order --parents`). The order is what makes the first commit carrying two tips' marks
 *                their merge base; a commit-date order would answer wrongly on a repository with a skewed clock.
 *
 * Where a pair has more than one merge base — a criss-cross merge — the topologically first one is used, and
 * it is the same one `git merge-base` would print. That is a real limitation of every answer here and the only
 * honest thing to do with it is to say so rather than to widen the vocabulary of a report nobody would read.
 */
export function inferAncestry({ main, tips = [], commits = [], cap = ANCESTRY_CAP } = {}) {
  const out = new Map();
  const limit = Math.max(1, Math.min(Number(cap) || ANCESTRY_CAP, 31));

  // The trunk always takes part, whatever the cap and wherever the caller put it: every other answer is
  // measured against it, so dropping it would turn one cap into an unknown for every branch.
  const seen = new Set();
  const ordered = [];
  for (const t of tips) {
    if (!t || !t.name || !t.sha || seen.has(t.name)) continue;
    seen.add(t.name);
    (t.name === main ? ordered.unshift(t) : ordered.push(t));
  }
  const considered = ordered.slice(0, limit);
  for (const t of ordered.slice(considered.length)) {
    out.set(t.name, unknownAncestry(t.name,
      `past the ancestry cap of ${limit} branch(es), so its topology was never measured`));
  }
  if (!considered.length) return out;

  const parentsOf = new Map();
  const topo = new Map();
  commits.forEach((c, i) => { parentsOf.set(c.sha, c.parents || []); topo.set(c.sha, i); });

  /*
   * One bit per tip, propagated from children to parents in one pass over the graph.
   *
   * After it, `mask[sha]` is the set of tips that can reach `sha`, so the merge base of any two tips is the
   * first commit in topological order carrying both bits — every pairwise merge base out of one `rev-list`
   * rather than one subprocess per pair. On thirty branches the subprocess version is nine hundred processes
   * spawned to fill in a column, which is the kind of cost that gets a report switched off.
   */
  const mask = new Map();
  considered.forEach((t, i) => mask.set(t.sha, (mask.get(t.sha) || 0) | (1 << i)));
  for (const c of commits) {
    const m = mask.get(c.sha);
    if (!m) continue;
    for (const p of c.parents || []) mask.set(p, (mask.get(p) || 0) | m);
  }

  const pairBase = new Map();
  const wanted = (considered.length * (considered.length - 1)) / 2;
  let found = 0;
  for (const c of commits) {
    if (found >= wanted) break;
    const m = mask.get(c.sha) || 0;
    if (!m || (m & (m - 1)) === 0) continue;                 // fewer than two tips reach it
    const bits = [];
    for (let i = 0; i < considered.length; i += 1) if (m & (1 << i)) bits.push(i);
    for (let a = 0; a < bits.length; a += 1) {
      for (let b = a + 1; b < bits.length; b += 1) {
        const key = `${bits[a]}:${bits[b]}`;
        if (!pairBase.has(key)) { pairBase.set(key, c.sha); found += 1; }
      }
    }
  }
  const mergeBase = (i, j) => (i === j ? considered[i].sha : pairBase.get(i < j ? `${i}:${j}` : `${j}:${i}`) || null);

  /** Is `target` an ancestor of `from`, or the same commit? Walked rather than indexed — used a few times per branch. */
  const reaches = (from, target) => {
    if (from === target) return true;
    const been = new Set([from]);
    const stack = [from];
    while (stack.length) {
      for (const p of parentsOf.get(stack.pop()) || []) {
        if (p === target) return true;
        if (!been.has(p)) { been.add(p); stack.push(p); }
      }
    }
    return false;
  };

  /**
   * The nearest candidate, and whether "nearest" is even a well-formed question here.
   *
   * Topological order settles it when the fork points are comparable — an ancestor always sorts after its
   * descendant — so the lowest index is the deepest fork. What it cannot settle is a tie (two candidates
   * forking at one commit) or two forks on unrelated lines, and both come back as `tied`/`incomparable` for
   * the caller to report as ambiguity rather than resolve by position in a list.
   */
  const nearest = (list) => {
    if (!list.length) return null;
    const at = list.slice().sort((a, b) => (topo.get(a.at) ?? 1e9) - (topo.get(b.at) ?? 1e9))[0].at;
    return {
      at,
      tied: list.filter((x) => x.at === at).map((x) => x.name).sort(),
      incomparable: list.filter((x) => x.at !== at && !reaches(at, x.at)).map((x) => x.name).sort(),
    };
  };

  const mainIdx = considered.findIndex((t) => t.name === main);

  for (let i = 0; i < considered.length; i += 1) {
    const { name, sha } = considered[i];
    const rec = {
      name, parent: null, basis: 'unknown', forkCommit: null, trunkFork: null, reason: null,
      candidates: [], sharedWith: [], atForkPoint: [], sameCommit: [], descendants: [],
      counterpart: null, orderedBy: null, reflogFork: null,
    };

    if (i === mainIdx) {
      out.set(name, { ...rec, basis: 'self', reason: 'the default branch — there is nothing above it to be cut from' });
      continue;
    }
    if (mainIdx === -1) {
      out.set(name, unknownAncestry(name, `\`${main}\` is not among the refs read, so nothing can be measured against it`));
      continue;
    }
    if (!topo.has(sha)) {
      out.set(name, unknownAncestry(name, 'its tip is not in the commit graph that was read'));
      continue;
    }

    const base = mergeBase(i, mainIdx);
    if (!base) {
      out.set(name, unknownAncestry(name,
        `no commit is reachable from both \`${name}\` and \`${main}\` — unrelated histories, so there is no fork point to find`));
      continue;
    }
    rec.forkCommit = base;
    rec.trunkFork = base;                                    // kept whatever the verdict: the trunk edge is always true

    // Named before the parent is chosen, because these three lists are true whatever the verdict turns out to
    // be and two of them are what stop a verdict being read as more than it is.
    const contained = [];
    const diverged = [];
    for (let j = 0; j < considered.length; j += 1) {
      if (j === i || j === mainIdx) continue;
      const other = considered[j];
      const m = mergeBase(i, j);
      if (!m) continue;                                        // shares no history with this branch at all
      if (other.sha === sha) { rec.sameCommit.push(other.name); continue; }
      if (m === sha) { rec.descendants.push(other.name); continue; }
      if (m === base) {
        // Forked from the trunk at the same commit this branch did. A sibling, unless it *is* that commit, in
        // which case it is a branch label sitting exactly on this branch's fork point and cannot be ruled out.
        (other.sha === base ? rec.atForkPoint : rec.sharedWith).push(other.name);
        continue;
      }
      const kind = m === other.sha ? 'contained' : 'diverged';
      (kind === 'contained' ? contained : diverged).push({ name: other.name, at: m, kind });
    }
    rec.sameCommit.sort(); rec.descendants.sort(); rec.sharedWith.sort(); rec.atForkPoint.sort();

    if (sha === base) {
      // Nothing on it that main does not have. Never "finished" and never "cut from a feature branch": the
      // label sits on the trunk's own commit, which is where a branch created a minute ago sits.
      /*
       * **`forkCommit` is null here, and the first draft got this wrong in a way that read as a fact.**
       * When everything on a branch is already in the trunk, its merge base with the trunk is its own tip —
       * which is the commit where its work *landed*, not the commit it was *cut from*. Printing that as
       * "cut from main at d5b489b" named the merge as the fork. The graph genuinely does not hold the answer
       * for a branch like this; only the reflog might, and `readAncestry` asks it.
       */
      out.set(name, { ...rec, basis: 'trunk', parent: main, forkCommit: null });
      continue;
    }

    /*
     * Both kinds of candidate compete on one axis — how deep the fork is — rather than `contained` winning by
     * category. A branch whose parent has moved on since the cut is `diverged`, and if that fork is nearer
     * this branch's tip than some older branch whose tip merely sits underneath it, the nearer one is the
     * better guess. Ranking by category would have answered with the older, weaker relation.
     */
    const rivals = [...contained, ...diverged];
    const near = nearest(rivals);
    if (!near) {
      out.set(name, { ...rec, basis: 'trunk', parent: main });
      continue;
    }
    const rival = [...new Set([...near.tied, ...near.incomparable])].sort();
    if (rival.length > 1) {
      out.set(name, {
        ...rec, basis: 'ambiguous', parent: null, forkCommit: near.at, candidates: rival,
        reason: near.tied.length > 1
          ? 'these branches all meet this one at the same commit, and git records nothing that separates them'
          : 'these branches are each an ancestor of this one and of neither each other, so no one of them is the parent',
      });
      continue;
    }
    out.set(name, {
      ...rec,
      basis: rivals.find((x) => x.name === rival[0]).kind,
      parent: rival[0],
      forkCommit: near.at,
    });
  }

  /*
   * **Two branches that each name the other are one undirected fact, not two contradictory ones.**
   *
   * Cut `feat/nested` off `development` and then commit once more on `development`, and the graph that
   * results is symmetric: neither tip is an ancestor of the other, and each is the other's nearest candidate.
   * The first draft reported "`development` was probably cut from `feat/nested`" and, four lines below,
   * "`feat/nested` was probably cut from `development`" — a report disagreeing with itself on its own page.
   * The pair is collapsed here into one relation with no direction, which is what the graph actually holds.
   */
  // Collected before anything is mutated, and then both halves are changed together. Mutating in the walk
  // rewrote the first branch of the pair, which cleared the `parent` the second branch's test reads — so the
  // second kept its directed answer and the report still contradicted itself, in one direction instead of two.
  const mutual = [];
  for (const rec of out.values()) {
    const other = rec.basis === 'diverged' && rec.parent ? out.get(rec.parent) : null;
    if (other && other.basis === 'diverged' && other.parent === rec.name && rec.name < other.name) {
      mutual.push([rec, other]);
    }
  }
  for (const [a, b] of mutual) {
    for (const [rec, mate] of [[a, b], [b, a]]) {
      rec.counterpart = mate.name;
      rec.parent = null;
      rec.basis = 'unordered';
      rec.reason = 'nothing in the commit graph orders them';
    }
  }

  /*
   * **A sibling is a branch cut from the trunk at the same commit — not merely one that meets this branch
   * there.** Everything downstream of a sibling meets it at that commit too, so the unfiltered list put a
   * branch's own grandchildren and a long-merged branch in beside the one branch a reader wanted: "same point
   * as development, docs/second-look, feat/nested, fix/landed" for a fork with exactly one true sibling. The
   * filter needs every record finished, which is why it is a second pass rather than part of the loop.
   */
  for (const rec of out.values()) {
    if (!rec.sharedWith.length) continue;
    rec.sharedWith = rec.sharedWith.filter((n) => {
      const o = out.get(n);
      return o && o.basis === 'trunk' && o.trunkFork === rec.trunkFork && o.name !== main;
    });
  }

  return out;
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
