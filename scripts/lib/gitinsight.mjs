/**
 * project-atlas · git insight
 *
 * Five questions about a repository's history that nothing else here answered, plus one about the change
 * currently in the working tree. Everything is read from `git`; nothing is written, fetched, checked out or
 * configured. Run any of it blind on a stranger's repository and the worst outcome is a slow command.
 *
 * ## What this deliberately does NOT recompute
 *
 * Most of the plumbing already existed and re-deriving it would have produced two answers to one question —
 * the forked-document failure this whole tool exists to detect, committed in code instead of prose.
 *
 *   - **Commits, people, agents, desks, churn, weekly aggregation** — `contrib.mjs`. This module takes a
 *     `readContrib` result as an argument and never runs `git log --numstat` itself. The **continuous week
 *     axis** that fills silent weeks with zero comes from there too (`weeklyAxis`), rather than being
 *     re-derived here as it was until C-7.
 *   - **The reverse citation index** — `design.mjs::reverseCitations`, which `kb.mjs` reads for its routing
 *     table. Both surfaces answer "which documents describe this file", and they must not answer differently.
 *   - **Conventional-subject rate, revert rate, rework rate** — `contrib.mjs::aggregateQuality`. The hygiene
 *     section reads those figures rather than counting them again.
 *   - **Working tree, staged, this branch's diff, cluster mapping** — `changes.mjs::readChanges`.
 *   - **Where you are and whether it is safe to commit** — `branch.mjs::branchStatus`. The branch section
 *     here answers a different question: what is true of *every* branch, not the one you are on.
 *   - **Bus factor per area** — `ownership.mjs`. **Surviving lines** — `surviving.mjs`.
 *
 * ## What it refuses to compute, and why
 *
 *   - **A combined "risk score" per file.** Collapsing commits, churn, authors and documentation coverage
 *     into one number hides which of them is driving it, and there is no answer when someone disputes it.
 *     Same rule `contrib.mjs` states for people, applied to files. The four numbers ship side by side.
 *   - **Anything about code quality, complexity or correctness.** `git log` records that a file changed. It
 *     records nothing about whether the change was good, and a metric named "risk" over that data would be
 *     an opinion wearing a measurement's clothes.
 *   - **A forecast.** No velocity projection, no "at this rate", no completion date. There is no denominator
 *     for work nobody has written down — the argument `inflight.mjs` makes for its own missing percentage.
 *   - **Coupling below a stated support floor.** See `coupling()`: on a young repository the pair counts are
 *     dominated by two files that happened to land in the same commit once.
 *
 * ## Unknown is not zero
 *
 * Every section returns `available: false` with a reason when its git call could not run, and callers render
 * that as unread rather than as an empty result. A `0` printed because `for-each-ref` failed would put
 * "one branch, all clean" on screen as a measurement nobody made.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readChanges, defaultBranch } from './changes.mjs';
import { weeklyAxis } from './contrib.mjs';
import { reverseCitations } from './design.mjs';
import { inferAncestry, ANCESTRY_CAP } from './branch.mjs';
import { num } from './format.mjs';

// Record and field separators for the one `git log` this module runs of its own. Same names and the same
// reason as contrib.mjs: argv cannot carry a NUL, so these are git's own `%x00`/`%x1f` escapes on the way
// out and named constants on the way back — a literal control byte written into this file would make every
// grep over it report a binary match and find nothing.
const NUL = '\x00';
const US = '\x1f';

export const DEFAULT_GITINSIGHT = {
  hotspotLimit: 12,           // rows shown; the count above the cap is always stated
  couplingMinSupport: 3,      // a pair must co-occur at least this often to be reported at all
  couplingMaxFiles: 12,       // commits touching more files than this are excluded from pair counting
  couplingLimit: 10,
  couplingMinBasis: 20,       // below this many usable commits, pairs are reported as anecdote, not signal
  branchStaleDays: 30,
  branchDetailCap: 40,        // branches given an ahead/behind reading; the rest are listed without one
  ancestryCap: ANCESTRY_CAP,  // branch tips taken into the parent inference; the rest are reported unmeasured
  largeCommitFiles: 20,       // "large" is this threshold, stated in the output rather than implied
};

const SECTIONS = ['hotspots', 'coupling', 'branches', 'cadence', 'hygiene', 'change'];
export const GITINSIGHT_SECTIONS = SECTIONS;

/**
 * The one git call site in this module, and it never throws.
 *
 * Every question asked below has a legitimate "no" — a default branch that does not exist locally, a
 * repository with no refs, a `rev-list` against a ref that was deleted between two commands. `changes.mjs`
 * splits raising and probing because it needs to distinguish an unexpected failure from an absent ref; here
 * there is nothing to distinguish, because **`null` is carried all the way to the screen as "not read"**
 * rather than collapsing into an empty result. A single call site is also what makes the read-only
 * allowlist over this module's git verbs checkable, and a test asserts there is only one.
 */
function git(root, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;                       // `null` is "could not be read" everywhere below, and never becomes 0
  }
}

/* ------------------------------------------------------------------ the corpus cross-reference */

/*
 * Code file → the documents that cite it is `design.mjs::reverseCitations`, imported above. It was written
 * out here as well until C-7 closed the pair: `kb.mjs` builds the same index for its routing table, and a
 * hotspot report that called a file undocumented while the routing table listed two documents describing it
 * would be this tool contradicting itself on its own output.
 */

/* ------------------------------------------------------------------ hotspots */

/**
 * The files history keeps coming back to.
 *
 * Two measures, reported side by side and never combined: **how often** a file changed, and **how much** moved
 * when it did. They disagree usefully — a config touched forty times for one line each is not the same object
 * as a module rewritten twice.
 *
 * **A file that no longer exists is excluded, and the exclusion is counted.** Deleted files accumulate history
 * forever and would sit permanently at the top of a list whose whole purpose is to say where to look now. They
 * are dropped rather than hidden: the count of dropped paths is reported.
 *
 * **The cross-reference is the finding, not the ranking.** "`scripts/lib/render.mjs` changed 41 times" is a
 * fact about a busy file. "It changed 41 times and no document in this corpus cites it" is the thing worth
 * doing something about, and it is the one question a documentation tool is better placed to ask than `git`.
 */
export function hotspots(contrib, { index = null, root = null, cfg = DEFAULT_GITINSIGHT } = {}) {
  if (!contrib?.available) return { available: false, reason: contrib?.reason || 'no git history' };

  const citedBy = reverseCitations(index);
  const docPaths = new Set((index?.documents || []).map((d) => d.path));

  const by = new Map();
  for (const cm of contrib.commits) {
    for (const f of cm.files) {
      if (!by.has(f.path)) {
        by.set(f.path, { path: f.path, commits: 0, added: 0, removed: 0, authors: new Set(), first: cm.date, last: cm.date });
      }
      const h = by.get(f.path);
      h.commits++;
      h.added += f.added; h.removed += f.removed;
      h.authors.add(cm.email || cm.author);
      if (cm.date < h.first) h.first = cm.date;
      if (cm.date > h.last) h.last = cm.date;
    }
  }

  const all = [...by.values()];
  const present = root
    ? all.filter((h) => fs.existsSync(path.join(root, h.path)))
    : all;
  const gone = all.length - present.length;

  const rows = present.map((h) => ({
    path: h.path,
    commits: h.commits,
    added: h.added,
    removed: h.removed,
    churn: h.added + h.removed,
    authors: h.authors.size,
    first: h.first.slice(0, 10),
    last: h.last.slice(0, 10),
    // `null` is not an empty array here: with no index there was no corpus to ask, which is a different
    // statement from "the corpus was read and nothing cites this".
    citedBy: index ? [...(citedBy.get(h.path) || [])].sort() : null,
    isDocument: docPaths.has(h.path),
  }));

  const byCommits = rows.slice().sort((a, b) => b.commits - a.commits || b.churn - a.churn);
  const byChurn = rows.slice().sort((a, b) => b.churn - a.churn || b.commits - a.commits);

  /*
   * "Busy and undocumented" is asked of code, and markdown is excluded from it entirely.
   *
   * Two different reasons, and both had to be handled or the finding drowned. A `.md` file **in** the index
   * that nothing cites is an orphan, and `health.mjs` already reports that under its own name — a second
   * name for one finding is the fork this project spends its time detecting. A `.md` file **outside** the
   * index was excluded from the corpus on purpose by the config, and asking why the corpus does not document
   * it is asking a question that was already answered. The generated daily worklog is the case that made
   * this obvious: twenty commits, nothing cites it, and nothing should.
   *
   * What survives is still imperfect and the output says so: nothing in `git log` distinguishes a generated
   * file from a hand-written one, so a lockfile or a derived manifest can appear here legitimately.
   */
  const askable = (r) => !r.isDocument && !/\.(md|markdown)$/i.test(r.path);
  const limit = cfg.hotspotLimit;
  const undocumented = index
    ? byCommits.filter((r) => askable(r) && r.citedBy.length === 0).slice(0, limit)
    : [];

  return {
    available: true,
    files: rows.length,
    gone,
    limit,
    indexed: !!index,
    byCommits: byCommits.slice(0, limit),
    byChurn: byChurn.slice(0, limit),
    undocumented,
    undocumentedTotal: index ? byCommits.filter((r) => askable(r) && r.citedBy.length === 0).length : null,
    // Everything above ranks within the commit range `readContrib` was given. A configured `contrib.since`
    // silently narrows it, so the window travels with the numbers.
    since: contrib.config?.since || null,
    range: { first: contrib.totals.first, last: contrib.totals.last, commits: contrib.totals.commits },
  };
}

/* ------------------------------------------------------------------ coupling */

/**
 * Files that keep changing in the same commit.
 *
 * The classic use is finding a dependency nobody wrote down: a header and its implementation, a route and its
 * test, a config key and the four places that read it. It is also **the measure here most likely to mislead**,
 * for two reasons that are both handled explicitly rather than in a footnote.
 *
 * **1. A large commit manufactures pairs.** One commit touching forty files contributes 780 pairs, all of them
 * co-occurring exactly once and none of them meaning anything. Commits above `couplingMaxFiles` are excluded
 * from pair counting entirely, and the number excluded is reported — a rename sweep or a generated-output
 * refresh would otherwise be the loudest signal on the page.
 *
 * **2. A young repository has no basis for the question.** With eleven commits, "these two files change
 * together 100% of the time" means they were both in one commit, twice. So the usable-commit count is carried
 * on the result as `basis`, every pair carries its raw `support` count, and below `couplingMinBasis` the
 * result is flagged `anecdotal` so the caller must say so out loud.
 *
 * Confidence is directional and both directions are given. "When A changes, B changes 80% of the time" and
 * the reverse are different claims, and a single symmetric number hides which one holds — a heavily-edited
 * file dragged along by a rarely-edited one looks identical to the reverse until you separate them.
 */
export function coupling(contrib, { root = null, cfg = DEFAULT_GITINSIGHT } = {}) {
  if (!contrib?.available) return { available: false, reason: contrib?.reason || 'no git history' };

  const maxFiles = cfg.couplingMaxFiles;
  const minSupport = cfg.couplingMinSupport;

  const touches = new Map();               // path → commits touching it, among usable commits only
  const pairs = new Map();
  let basis = 0, excludedLarge = 0, excludedSingle = 0;

  for (const cm of contrib.commits) {
    const paths = [...new Set(cm.files.map((f) => f.path))].sort();
    if (paths.length < 2) { excludedSingle++; continue; }
    if (paths.length > maxFiles) { excludedLarge++; continue; }
    basis++;
    for (const p of paths) touches.set(p, (touches.get(p) || 0) + 1);
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = `${paths[i]}${NUL}${paths[j]}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  }

  const exists = (p) => (root ? fs.existsSync(path.join(root, p)) : true);
  let goneDropped = 0;
  const rows = [];
  for (const [key, support] of pairs) {
    if (support < minSupport) continue;
    const [a, b] = key.split(NUL);
    // A pair where either side has been deleted is history, not a dependency anyone can act on.
    if (!exists(a) || !exists(b)) { goneDropped++; continue; }
    const ta = touches.get(a) || 0, tb = touches.get(b) || 0;
    rows.push({
      a, b, support,
      aTouches: ta, bTouches: tb,
      confAtoB: ta ? Math.round((support / ta) * 100) : null,
      confBtoA: tb ? Math.round((support / tb) * 100) : null,
    });
  }
  rows.sort((x, y) => y.support - x.support || Math.max(y.confAtoB, y.confBtoA) - Math.max(x.confAtoB, x.confBtoA));

  return {
    available: true,
    pairs: rows,
    total: rows.length,
    limit: cfg.couplingLimit,
    basis,
    minSupport,
    maxFiles,
    excludedLarge,
    excludedSingle,
    goneDropped,
    anecdotal: basis < cfg.couplingMinBasis,
    minBasis: cfg.couplingMinBasis,
  };
}

/* ------------------------------------------------------------------ branch health */

/**
 * Every branch, not the one you are standing on.
 *
 * `branch.mjs` answers "is it safe to commit here", which is the question at the moment of committing. This
 * answers the one that accumulates: thirty-one local branches, most of them merged months ago, and no way to
 * tell which three still hold work without checking each by hand.
 *
 * **It reports and it stops there.** Nothing here deletes a branch, and it does not print a `git branch -d`
 * for someone to paste either. A read-only report whose output is a destructive command is a read-only report
 * in name only — and these commands are built to be safe to run blind, including by an agent that will act on
 * whatever it reads. "Merged, nothing unique on it" is the finding; what to do about it is a person's call.
 *
 * The ahead/behind reading costs one `rev-list` per branch, so it is capped at `branchDetailCap` branches by
 * most-recent commit. Branches past the cap are still listed — with `ahead: null`, which renders as unread
 * rather than as zero, because a branch reported as "0 ahead" that was never measured is how work gets
 * thrown away.
 */
export function branchHealth(root, cfg = {}, opts = DEFAULT_GITINSIGHT) {
  const main = defaultBranch(root, cfg);
  // `%(refname)` is carried alongside the short form deliberately. The short form of `refs/remotes/origin/HEAD`
  // is the bare word `origin` — no slash, nothing to pattern-match on — so a first draft counted the remote's
  // default-branch symref as a *local* branch called `origin`, listed it as holding unmerged work, and
  // inflated the local count by one. The full ref answers both questions without guessing at the shape of a
  // name, and a remote called `main` or `feature` would have defeated any guess that did.
  const FMT = ['%(refname)', '%(refname:short)', '%(objectname:short)', '%(committerdate:iso8601-strict)',
    '%(upstream:short)', '%(upstream:track)', '%(contents:subject)', '%(objectname)',
    '%(committerdate:unix)'].join(US);

  const raw = git(root, ['for-each-ref', `--format=${FMT}`, 'refs/heads', 'refs/remotes']);
  if (raw === null) return { available: false, reason: 'git for-each-ref could not run — not a repository, or no refs' };

  const current = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || null;
  const protectedSet = new Set([main, 'master', 'develop', ...(cfg.branching?.protected || [])]);

  const mergedRaw = git(root, ['for-each-ref', '--merged', main, '--format=%(refname:short)', 'refs/heads']);
  // `null` here is not "nothing is merged" — it is "the merge question could not be asked", which happens
  // when the default branch does not exist locally. Every row's `merged` stays null in that case.
  const merged = mergedRaw === null ? null : new Set(mergedRaw.split('\n').filter(Boolean));

  const all = raw.split('\n').filter(Boolean).map((line) => {
    const [ref, name, sha, date, upstream, track, subject, full, unix] = line.split(US);
    const remote = ref.startsWith('refs/remotes/');
    return {
      ref, name, sha, date, subject: subject || '',
      full,                              // the whole object name: what the commit graph is keyed on
      unix: Number(unix) || 0,
      remote,
      upstream: upstream || null,
      track: (track || '').trim() || null,
      isCurrent: name === current,
      isProtected: protectedSet.has(name),
      merged: remote ? null : (merged ? merged.has(name) : null),
      ageDays: null,                     // filled below, against the newest commit rather than the clock
      ahead: null, behind: null,
      ancestry: null,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // A remote's HEAD is a symref pointing at one of the branches already listed, not a branch of its own.
  const rows = all.filter((b) => !/\/HEAD$/.test(b.ref));

  /*
   * **Age is measured against the newest commit in the repository, not against the clock.**
   *
   * `dashboard.mjs::branchInventory` made this decision first and for the reason that matters here too: a
   * figure derived from `Date.now()` changes on every run, so the same repository prints a different report
   * every morning with nothing having happened, and nothing downstream can be compared or tested against it.
   * "Eleven days behind the last thing that happened here" is also the more useful sentence on a repository
   * that has been idle for a month, where "eleven days old" is mostly a fact about today.
   *
   * `unix` and not the ISO string, because `iso8601-strict` carries each committer's own offset and sorting
   * those compares `+05:30` against `Z` — typography rather than time, the mismatch that cost `inflight.mjs`
   * its journal window.
   */
  const newest = rows.length ? Math.max(...rows.map((b) => b.unix)) : 0;
  for (const b of rows) b.ageDays = Math.max(0, Math.floor((newest - b.unix) / 86400));

  const detailed = rows.slice(0, opts.branchDetailCap);
  for (const b of detailed) {
    const out = git(root, ['rev-list', '--left-right', '--count', `${main}...${b.name}`]);
    if (out === null) continue;                                   // stays null: unread, not zero
    const [behind, ahead] = out.trim().split(/\s+/).map(Number);
    if (Number.isFinite(behind)) b.behind = behind;
    if (Number.isFinite(ahead)) b.ahead = ahead;
  }

  const local = rows.filter((b) => !b.remote);
  const ancestry = readAncestry(root, main, local, opts);
  for (const b of local) b.ancestry = ancestry.of.get(b.name) || null;

  const stale = local.filter((b) => b.ageDays >= opts.branchStaleDays && !b.isCurrent && !b.isProtected);
  /*
   * **"Merged" and "never diverged" are not the same branch, and collapsing them was wrong in the direction
   * that costs work.** `git for-each-ref --merged main` answers "is this reachable from main", which is
   * trivially true of a branch created ten seconds ago that has no commits on it at all. The first draft
   * therefore listed a sibling session's freshly-created working branch as *spent, merged, nothing unique on
   * it* — advice which was technically accurate and would have read as "delete this" beside twenty-six
   * genuinely finished branches.
   *
   * So `behind` decides. Merged with commits behind main means work that landed. Merged with nothing behind
   * and nothing ahead means a label sitting on the same commit as the trunk: new, not finished. Both halves
   * must have been measured — a branch whose `ahead` could not be read is in neither list, because the claim
   * being made about `spent` is that deleting it loses nothing.
   */
  const spent = local.filter((b) => b.merged === true && b.ahead === 0 && b.behind > 0 && !b.isCurrent && !b.isProtected);
  const atMain = local.filter((b) => b.ahead === 0 && b.behind === 0 && !b.isCurrent && !b.isProtected);
  const unmerged = local.filter((b) => b.merged === false && !b.isCurrent);

  return {
    available: true,
    main, current,
    branches: rows,
    localCount: local.length,
    remoteCount: rows.length - local.length,
    detailCap: opts.branchDetailCap,
    detailed: detailed.length,
    undetailed: Math.max(0, rows.length - detailed.length),
    mergeCheckRan: merged !== null,
    staleDays: opts.branchStaleDays,
    newestUnix: newest,
    ancestry,
    stale, spent, atMain, unmerged,
  };
}

/* ------------------------------------------------------------------ where each branch was cut from (A-55) */

/**
 * The git half of the parent inference: read the commit graph once, hand it to `branch.mjs::inferAncestry`,
 * and then ask the reflog whether it still remembers the same fork.
 *
 * **One `rev-list` for the whole answer.** The obvious implementation is `git merge-base` per pair, which on
 * thirty branches is nine hundred subprocesses to fill in one column. `--topo-order --parents` over the tips
 * gives the same information in a single read, and the inference over it is pure and therefore testable
 * without a repository — see the docblock on `inferAncestry` for what each verdict does and does not claim.
 *
 * **The reflog is corroboration, never the verdict.** `git merge-base --fork-point` finds where a branch
 * diverged using the *other* branch's reflog, which knows things the graph cannot — a trunk that was rebased
 * or amended leaves a fork point in the reflog that no longer exists as a common ancestor. It also expires,
 * is per-clone, and is empty in a fresh clone, so it can only ever add a fact, never remove one: where it
 * disagrees with the graph the report prints both and says the reflog is local to this machine.
 */
function readAncestry(root, main, local, opts = DEFAULT_GITINSIGHT) {
  const cap = Math.max(1, Number(opts.ancestryCap) || ANCESTRY_CAP);
  const mainSha = (git(root, ['rev-parse', '--verify', '--quiet', `${main}^{commit}`]) || '').trim();
  if (!mainSha) {
    return { available: false, cap, of: new Map(),
      reason: `\`${main}\` does not resolve to a commit here, so there is no trunk to measure a fork point against` };
  }

  // `main` first so the cap can never drop it, then the rest newest-first — `local` arrives sorted that way.
  const tips = [{ name: main, sha: mainSha }, ...local.filter((b) => b.name !== main).map((b) => ({ name: b.name, sha: b.full }))]
    .filter((t) => t.sha);
  const considered = tips.slice(0, Math.min(cap, 31));

  const raw = git(root, ['rev-list', '--topo-order', '--parents', ...considered.map((t) => t.sha)]);
  if (raw === null) {
    return { available: false, cap, of: new Map(),
      reason: 'the commit graph could not be read (git rev-list failed), so no fork point was measured' };
  }
  const commits = raw.split('\n').filter(Boolean).map((line) => {
    const parts = line.split(' ');
    return { sha: parts[0], parents: parts.slice(1) };
  });

  const of = inferAncestry({ main, tips, commits, cap });

  /*
   * **Where a branch was created, as the reflog remembers it.**
   *
   * `git merge-base --fork-point` was the obvious tool and it is the wrong one for the tie this has to break:
   * asked both ways round about a branch and the branch it was cut from, it answers with the same commit both
   * times, because each side's reflog contains that commit. It agrees, informatively, with the symmetry.
   *
   * The reflog's *oldest* entry is the discriminating fact — and only when its message says the entry is a
   * creation, which is why the message is read rather than just the commit. A trimmed reflog leaves an oldest
   * entry that is merely the oldest surviving state, and treating that as the branch point would invent a
   * fork out of an expiry. No creation entry, no claim.
   *
   * `branch: Created from <ref>` also names the ref where the branch was cut from something other than
   * `HEAD` — the only place in this whole feature where git records a parent outright rather than leaving it
   * to be inferred. It is used when it is there, and it is still labelled: **a reflog is per-clone and
   * expires, so anything it establishes is true on this machine and unverifiable anywhere else.**
   */
  const creationOf = (branch) => {
    const raw = git(root, ['log', '-g', `--format=%H${US}%gs`, branch]);
    if (raw === null) return null;
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return null;
    const [sha, msg] = lines[lines.length - 1].split(US);
    const m = /^branch: Created from (.+)$/.exec(msg || '');
    return m ? { sha, from: m[1].trim() } : null;
  };

  let reflogRead = 0;
  const creation = new Map();
  const created = (name) => {
    if (!creation.has(name)) { reflogRead += 1; creation.set(name, creationOf(name)); }
    return creation.get(name);
  };

  const settled = new Set();
  for (const rec of of.values()) {
    if (rec.basis !== 'unordered' || !rec.counterpart || settled.has(rec.name)) continue;
    const mate = of.get(rec.counterpart);
    if (!mate) continue;
    settled.add(rec.name); settled.add(mate.name);

    const a = created(rec.name);
    const b = created(mate.name);
    // Named outright beats matched-by-commit, and a pair that names each other is no answer at all.
    const namesMate = !!a && a.from === mate.name;
    const namesRec = !!b && b.from === rec.name;
    const atFork = (x) => !!x && !!rec.forkCommit && x.sha === rec.forkCommit;
    let child = null;
    if (namesMate !== namesRec) child = namesMate ? rec : mate;
    else if (atFork(a) !== atFork(b)) child = atFork(a) ? rec : mate;
    if (!child) continue;                                      // the tie stands, and stands as the answer

    const parent = child === rec ? mate : rec;
    child.basis = 'diverged';
    child.parent = parent.name;
    child.orderedBy = 'reflog';
    child.reflogFork = created(child.name)?.sha || null;
    child.reason = null;
    // The other half falls back to the trunk rather than to whatever its next-nearest candidate was. That is
    // deliberately the weaker claim: if a third branch also shares history with it past the trunk, this draws
    // the branch one level too high rather than under a candidate the reflog said nothing about. The reason
    // travels with the record so the under-claim is on the page and not only in this comment.
    parent.basis = 'trunk';
    parent.parent = main;
    parent.forkCommit = parent.trunkFork;
    parent.counterpart = null;
    // No `orderedBy` and no reason on this half. The caveat belongs on the child, whose position rests on the
    // reflog; repeating it here put the same warning on two consecutive lines and read as two findings.
    parent.reason = null;
  }

  // And for every branch that ended with a named parent, where the reflog says it was created — reported only
  // where it *disagrees* with the graph, which is what a rebase of the parent produces and the case in which a
  // reader would otherwise be handed a fork point that no longer exists.
  for (const rec of of.values()) {
    if (!rec.parent || rec.basis === 'self' || rec.reflogFork) continue;
    rec.reflogFork = created(rec.name)?.sha || null;
  }

  return {
    available: true,
    cap,
    considered: considered.length,
    unmeasured: Math.max(0, tips.length - considered.length),
    commitsRead: commits.length,
    reflogRead,
    reason: null,
    of,
  };
}

/* ------------------------------------------------------------------ branch topology (A-56) */

/**
 * The shape of the branches, rather than a ranking of them.
 *
 * `branchHealth` answers *how far ahead* — a table, one row per branch, every row independent. This answers
 * *how they relate*: what was cut from what, where each split off, and what has already gone back into the
 * trunk. The two questions want different pictures and the same facts, so **this derives nothing of its own**
 * — every number, state and origin on the tree comes off the `branchHealth` row it is drawn from. A second
 * derivation of the same facts is the forked-answer defect this whole tool exists to detect, and shipping one
 * inside the tool would be the loudest possible way to fail at it.
 *
 * Three things it will not do:
 *
 *   - **Guess.** A branch whose origin the graph cannot settle is not attached to the trunk "for tidiness". It
 *     comes out in `unplaced`, with the reason, and the renderer prints it.
 *   - **Invent an order for a cycle.** Two branches that each name the other — which is what two branches cut
 *     from a since-deleted third look like — are both unplaced, together, with that stated. Breaking the tie
 *     by iteration order would put a fabricated ancestry on screen and nothing downstream could tell.
 *   - **Offer a command.** Read-only, like every other `git-*` surface here, down to not printing a
 *     `git branch -d` for somebody to paste. See `branchHealth`.
 */
export function branchTree(root, cfg = {}, opts = null) {
  const o = opts || { ...DEFAULT_GITINSIGHT, ...(cfg.gitInsight || {}) };
  const health = branchHealth(root, cfg, o);
  if (!health.available) return { available: false, reason: health.reason };

  const main = health.main;
  const local = health.branches.filter((b) => !b.remote);
  const mk = (b, name) => ({ name: name || b.name, branch: b, state: b ? branchState(b) : 'trunk', children: [] });
  const nodes = new Map(local.map((b) => [b.name, mk(b)]));

  // A trunk that is not a local branch still has to be the root. `main` resolved to a commit — `readAncestry`
  // would have refused otherwise — so the branches cut from it are placed under a node that says plainly it is
  // not a local ref, rather than every one of them being reported as an orphan.
  const trunkIsLocal = nodes.has(main);
  if (!trunkIsLocal && health.ancestry?.available) nodes.set(main, mk(null, main));

  const unplaced = [];
  const parentOf = new Map();
  const trunkFallback = new Set();
  for (const b of local) {
    const a = b.ancestry;
    if (a?.basis === 'self') continue;                       // the trunk is a root, not a child
    const p = a?.parent && a.parent !== b.name && nodes.has(a.parent) ? a.parent : null;
    if (p) { parentOf.set(b.name, p); continue; }
    /*
     * No single parent, but still descended from the trunk — `unordered` and `ambiguous` both mean *we know
     * where it joins the trunk and cannot say which branch it left*. Hanging it off the trunk is the
     * strongest statement that is actually true, and it keeps a real branch in the picture; the note on the
     * row carries the part the edge cannot. Only a branch with no common ancestor at all is unplaced.
     */
    if (a?.trunkFork && nodes.has(main)) {
      parentOf.set(b.name, main);
      trunkFallback.add(b.name);
      continue;
    }
    unplaced.push({ node: nodes.get(b.name), reason: ancestryPhrase(a, main) });
  }

  /*
   * Cycles, before any edge is drawn. Walking up from each node and recording where it lands means an A→B→A
   * pair is caught as a pair — both members named in one finding — rather than one of them being silently
   * reparented by whichever the loop reached first.
   */
  const cyclic = new Set();
  for (const name of parentOf.keys()) {
    const path = [];
    let cur = name;
    const onPath = new Set();
    while (cur && parentOf.has(cur) && !onPath.has(cur)) { onPath.add(cur); path.push(cur); cur = parentOf.get(cur); }
    if (cur && onPath.has(cur)) for (const n of path.slice(path.indexOf(cur))) cyclic.add(n);
  }
  for (const name of cyclic) {
    parentOf.delete(name);
    const others = [...cyclic].filter((n) => n !== name).sort();
    unplaced.push({
      node: nodes.get(name),
      reason: `each of ${[name, ...others].join(', ')} names another as its origin — git records nothing that orders them`,
    });
  }

  // The row's fork column has to describe the edge that was actually drawn, not the nearer one that was
  // rejected: a branch hung off the trunk because its own split could not be ordered must print the trunk
  // fork beside it, or the drawing and the number beside it are describing two different relations.
  for (const n of trunkFallback) nodes.get(n).viaTrunk = true;
  for (const [child, parent] of parentOf) nodes.get(parent).children.push(nodes.get(child));

  // Newest first inside every level, name as the tie-break, so the drawing is one function of the refs and
  // does not move between runs.
  const sortKids = (n) => {
    n.children.sort((a, b) => (b.branch?.unix || 0) - (a.branch?.unix || 0) || a.name.localeCompare(b.name));
    n.children.forEach(sortKids);
  };
  const placed = new Set(parentOf.keys());
  const roots = [...nodes.values()].filter((n) => !placed.has(n.name) && !unplaced.some((u) => u.node === n));
  roots.sort((a, b) => (a.name === main ? -1 : b.name === main ? 1 : (b.branch?.unix || 0) - (a.branch?.unix || 0) || a.name.localeCompare(b.name)));
  roots.forEach(sortKids);
  unplaced.sort((a, b) => a.node.name.localeCompare(b.node.name));

  return {
    available: true,
    empty: !local.length,
    main, trunkIsLocal,
    current: health.current,
    roots, unplaced,
    localCount: local.length,
    remoteCount: health.remoteCount,
    newestUnix: health.newestUnix,
    ancestry: health.ancestry,
    mergeCheckRan: health.mergeCheckRan,
    // Carried so the renderer can repeat the caps beside the drawing rather than in a footnote: a branch drawn
    // without an ahead count and a branch measured at zero must never look the same.
    detailCap: health.detailCap,
    undetailed: health.undetailed,
    staleDays: health.staleDays,
  };
}

/* ------------------------------------------------------------------ cadence */

/**
 * Weeks with no commits are weeks, and they have to be drawn.
 *
 * The zero-fill itself is `contrib.mjs::weeklyAxis`, beside the aggregation whose gaps it closes. It used to
 * be written out a second time here and a third time inside `dashboard.mjs`, because both of those modules
 * were owned by other work in the session that wrote this and re-deriving eight lines was the lesser evil
 * against editing them. That excuse expired when the branches merged: three copies of one derivation in one
 * tree are three answers waiting to disagree, on pages that would then print two different numbers for the
 * same week with nothing to say which was right. C-7 filed the hoist and this is it.
 *
 * What stays here is the *count*, which is the only thing this module needs beyond the series: the rhythm
 * report states how many weeks it filled, so a reader can tell a measured zero from a drawn one. Read off the
 * `silent` flag the shared fill sets rather than counted during it, so the two can never come apart.
 */
export function fillWeeks(weeks) {
  const out = weeklyAxis(weeks);
  return { weeks: out, filled: out.filter((w) => w.silent).length };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

/**
 * Commit rhythm over the life of the repository.
 *
 * Reports shape, not a trend line. "Commits are down 40%" over four weeks of a nine-week-old repository is
 * arithmetic dressed as a conclusion, and the direction reverses on the next commit. What is stated instead:
 * the span, how much of it was active, the busiest week, the longest silence, and the median — from which a
 * reader draws their own conclusion, with the sample size in front of them.
 */
export function cadence(contrib) {
  if (!contrib?.available) return { available: false, reason: contrib?.reason || 'no git history' };
  const { weeks, filled } = fillWeeks(contrib.weeks);
  if (!weeks.length) return { available: false, reason: 'no weekly aggregation to read' };

  const counts = weeks.map((w) => w.commits);
  const active = weeks.filter((w) => w.commits > 0);
  const busiest = weeks.slice().sort((a, b) => b.commits - a.commits)[0];

  // Longest run of consecutive zero-commit weeks, measured over the filled series — which is the only series
  // in which a silence is representable at all.
  let longestSilence = 0, run = 0;
  for (const w of weeks) {
    if (w.commits === 0) { run++; longestSilence = Math.max(longestSilence, run); }
    else run = 0;
  }

  const days = new Set(contrib.commits.map((c) => c.date.slice(0, 10)));
  const spanDays = Math.max(1, Math.round(
    (Date.parse(contrib.totals.last) - Date.parse(contrib.totals.first)) / 86400000) + 1);

  return {
    available: true,
    weeks,
    filled,
    spanWeeks: weeks.length,
    activeWeeks: active.length,
    medianActiveWeek: median(active.map((w) => w.commits)),
    medianWeek: median(counts),
    busiest: busiest ? { week: busiest.week, commits: busiest.commits } : null,
    longestSilence,
    activeDays: days.size,
    spanDays,
    // A rate over calendar days, with both terms shown so nobody has to trust the division.
    commitsPerActiveDay: Math.round((contrib.totals.commits / days.size) * 10) / 10,
    first: contrib.totals.first,
    last: contrib.totals.last,
  };
}

/* ------------------------------------------------------------------ commit hygiene */

/**
 * Whether a commit body carries prose, once its trailers are removed.
 *
 * Every commit in this repository ends with `Co-Authored-By:` and `Desk:`, which are machine-read metadata,
 * not an explanation. A naive "is `%b` non-empty" check therefore reports 100% of commits as documented in
 * exactly the repository that mandates those trailers — a measure that reads perfect because of a convention
 * unrelated to what it claims to measure.
 */
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:\s/;
function hasProseBody(body) {
  return (body || '').split('\n')
    .map((l) => l.trim())
    .some((l) => l && !TRAILER.test(l));
}

/**
 * Whether history is legible to the people and the tools that read it.
 *
 * Four of the five figures come straight from `contrib.mjs` rather than being counted again; the one new read
 * is the commit body, which nothing else in this tool has ever looked at. Each is a **rate with its
 * denominator shown**, because "12 commits name no plan item" means something different across 30 commits
 * than across 300.
 *
 * "Large" is a stated threshold and not a judgement. A commit touching fifty files may be a rename sweep, a
 * generated-output refresh, or a genuinely unreviewable change, and nothing in `git log` distinguishes them.
 * The list is offered as *the biggest commits*, which is a fact, rather than as *the bad ones*, which is not.
 */
export function hygiene(root, contrib, { plan = null, cfg = DEFAULT_GITINSIGHT } = {}) {
  if (!contrib?.available) return { available: false, reason: contrib?.reason || 'no git history' };
  const n = contrib.totals.commits;

  // One extra `git log`, formatted as NUL-delimited records the way `contrib.mjs` does, for the same reason:
  // a body contains newlines and a line-oriented parser would split one commit into twenty.
  const args = ['log', '--no-merges', '--format=%x00%H%x1f%b'];
  if (contrib.config?.since) args.push(`--since=${contrib.config.since}`);
  const raw = git(root, args);

  let noBody = null, bodiesRead = null;
  if (raw !== null) {
    noBody = 0; bodiesRead = 0;
    for (const rec of raw.split(NUL)) {
      if (!rec.trim()) continue;
      const us = rec.indexOf(US);
      if (us === -1) continue;
      bodiesRead++;
      if (!hasProseBody(rec.slice(us + 1))) noBody++;
    }
  }

  // A token shaped like a plan id is not a plan item. With a plan loaded the two are separated; without one,
  // the stricter figure is reported as unavailable rather than silently softened into the looser one.
  const planIds = new Set((plan && !plan.missing ? plan.items : []).map((i) => i.id));
  const namingAnyRef = contrib.commits.filter((c) => c.taskRefs.length).length;
  const namingPlanItem = planIds.size
    ? contrib.commits.filter((c) => c.taskRefs.some((r) => planIds.has(r))).length
    : null;

  const sized = contrib.commits.map((c) => ({
    hash: c.hash, subject: c.subject, date: c.date.slice(0, 10),
    files: c.files.length, churn: c.added + c.removed,
  }));
  const large = sized.filter((c) => c.files > cfg.largeCommitFiles);
  const biggest = sized.slice().sort((a, b) => b.files - a.files || b.churn - a.churn).slice(0, 5);

  return {
    available: true,
    commits: n,
    // Reused verbatim from contrib.mjs::aggregateQuality — not recounted here.
    conventional: contrib.quality.conventional,
    conventionalRate: contrib.quality.conventionalRate,
    reverts: contrib.quality.reverts,
    aiAssisted: contrib.totals.aiAssisted,
    deskTagged: contrib.totals.deskTagged,
    namingAnyRef,
    namingPlanItem,
    planItems: planIds.size || null,
    noBody,
    bodiesRead,
    bodyReadFailed: raw === null,
    largeThreshold: cfg.largeCommitFiles,
    large: large.length,
    biggest,
  };
}

/* ------------------------------------------------------------------ this change, against history */

/**
 * The current working-tree change, measured against everything that came before it.
 *
 * This is the section that pays for the two above it, and it asks one question `git status` cannot:
 * **what usually moves with these files, and has not moved this time.** A file that has changed alongside
 * this one in seven of its last nine commits, sitting untouched in the working tree, is either a deliberate
 * decision or the bug that ships. Naming it costs nothing and the alternative is remembering it.
 *
 * It is a prompt, never a verdict. Coupling is correlation over a small sample — every partner is printed
 * with the raw number of commits it rests on, and the caller is told to read them as questions.
 */
export function changeAgainstHistory(root, cfg, { contrib, index = null, coup = null } = {}) {
  let changes;
  try {
    changes = readChanges(root, cfg, index);
  } catch (err) {
    return { available: false, reason: String(err?.message || err) };
  }
  if (!changes.available) return { available: false, reason: changes.reason };

  const touched = [...new Set([...changes.unstaged, ...changes.staged].map((f) => f.path))];
  if (!touched.length) {
    return { available: true, empty: true, branch: changes.branch, main: changes.main };
  }

  /*
   * Each changed file's own prior history — counted here rather than looked up in the hotspot ranking.
   *
   * The ranking is capped for display, so a changed file outside the top twelve would come back as "not a
   * hotspot" when what actually happened is that the list was cut. A raw count per file has no cap to be
   * wrong about, and it is the number a reader wants anyway: forty-four prior commits says more than a
   * boolean does.
   */
  const wanted = new Set(touched);
  const historyOf = new Map();
  for (const cm of contrib?.available ? contrib.commits : []) {
    for (const f of cm.files) {
      if (!wanted.has(f.path)) continue;
      const h = historyOf.get(f.path) || { commits: 0, churn: 0 };
      h.commits++; h.churn += f.added + f.removed;
      historyOf.set(f.path, h);
    }
  }

  /*
   * One row per **missing** file, not one per pair.
   *
   * Changing `scripts/atlas.mjs` and `scripts/lib/dashboard.mjs` together produces two separate pairs against
   * `tests/run.mjs`, and the first draft printed it twice, three lines apart, with different percentages.
   * That is one question — "you have not touched the tests" — and asking it twice makes the list look longer
   * than the finding is. The strongest pair is kept as the evidence and the others are counted beside it, so
   * nothing is dropped silently.
   */
  const partners = [];
  if (coup?.available) {
    const set = new Set(touched);
    const by = new Map();
    for (const p of coup.pairs) {
      const inA = set.has(p.a), inB = set.has(p.b);
      if (inA === inB) continue;                       // both touched, or neither — no question to ask
      const changed = inA ? p.a : p.b;
      const missing = inA ? p.b : p.a;
      const row = {
        changed, missing, support: p.support,
        confidence: inA ? p.confAtoB : p.confBtoA,
        of: inA ? p.aTouches : p.bTouches,
        alsoPairedWith: 0,
      };
      const cur = by.get(missing);
      if (!cur) { by.set(missing, row); continue; }
      const better = row.support > cur.support || (row.support === cur.support && row.confidence > cur.confidence);
      if (better) { row.alsoPairedWith = cur.alsoPairedWith + 1; by.set(missing, row); }
      else cur.alsoPairedWith++;
    }
    partners.push(...by.values());
    partners.sort((a, b) => b.support - a.support || (b.confidence || 0) - (a.confidence || 0));
  }

  const citedBy = reverseCitations(index);
  const files = touched.map((p) => ({
    path: p,
    priorCommits: historyOf.get(p)?.commits ?? 0,
    priorChurn: historyOf.get(p)?.churn ?? 0,
    citedBy: index ? [...(citedBy.get(p) || [])].sort() : null,
  })).sort((a, b) => b.priorCommits - a.priorCommits);

  return {
    available: true,
    empty: false,
    branch: changes.branch,
    main: changes.main,
    files,
    partners: partners.slice(0, 10),
    partnersTotal: partners.length,
    // Carried through so the caller can repeat the caveat next to the pairs rather than in a footnote
    // somebody scrolls past.
    couplingBasis: coup?.available ? coup.basis : null,
    couplingAnecdotal: coup?.available ? coup.anecdotal : null,
    new: files.filter((f) => f.priorCommits === 0).length,
  };
}

/* ------------------------------------------------------------------ assembly */

/**
 * Everything, or one section of it.
 *
 * `contrib` and `index` are arguments rather than reads, so `atlas git-insights` costs exactly one
 * `git log --numstat` however many sections were asked for — and so a caller that already has both (the
 * build, a future dashboard panel) pays nothing twice.
 */
export function readGitInsight(root, cfg = {}, { contrib, index = null, plan = null, section = 'all' } = {}) {
  const opts = { ...DEFAULT_GITINSIGHT, ...(cfg.gitInsight || {}) };
  const want = section === 'all' ? SECTIONS : [section];
  const out = { available: true, section, sections: {}, opts };

  if (!contrib?.available) {
    return { available: false, section, reason: contrib?.reason || 'no git history to read', sections: {}, opts };
  }

  // `change` needs the full pair set, not the display slice, so the coupling pass is computed once and shared
  // rather than run again with a different cap — two answers from one measure is how the numbers in a report
  // stop agreeing with each other.
  const coup = want.includes('coupling') || want.includes('change')
    ? coupling(contrib, { root, cfg: opts }) : null;

  if (want.includes('hotspots')) out.sections.hotspots = hotspots(contrib, { index, root, cfg: opts });
  if (want.includes('coupling')) out.sections.coupling = coup;
  if (want.includes('branches')) out.sections.branches = branchHealth(root, cfg, opts);
  if (want.includes('cadence')) out.sections.cadence = cadence(contrib);
  if (want.includes('hygiene')) out.sections.hygiene = hygiene(root, contrib, { plan, cfg: opts });
  if (want.includes('change')) out.sections.change = changeAgainstHistory(root, cfg, { contrib, index, coup });

  return out;
}

/* ------------------------------------------------------------------ terminal report */

/**
 * Colour, on the same convention as `formatTasks` in `scripts/atlas.mjs` and `formatReport` in `health.mjs`:
 * a plain object of wrappers when colour is wanted, a Proxy returning the identity function when it is not.
 * The caller decides — `atlas.mjs` computes `process.stdout.isTTY && !flag('no-color')` once — so a pipe, a
 * file, a CI log and `--no-color` all take the same branch.
 *
 * **Colour is never the only carrier.** Every red line also begins with a word, every threshold is printed as
 * a number, and every rate is printed with its denominator. Redirect this to a file and nothing is lost but
 * the emphasis; that is the test applied to each line below, because a reader piping to a file is not a
 * degraded reader.
 */
function palette(useColor) {
  return useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, blue: (s) => `\x1b[34m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
        cyan: (s) => `\x1b[36m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });
}

const pad = (v, n) => String(v).padStart(n);
const trim = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

function renderHotspots(k, c) {
  const L = [];
  L.push(c.bold('Hotspots') + c.dim('  where history keeps coming back — commits and churn, side by side, never combined'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  L.push(c.dim(`  ${k.files} file(s) still present, over ${k.range.commits} commit(s) ${k.range.first} → ${k.range.last}` +
    (k.since ? ` (contrib.since=${k.since})` : '')));
  if (k.gone) L.push(c.dim(`  ${k.gone} path(s) in history no longer exist and are excluded — history, not current risk.`));
  L.push('');
  L.push(c.dim('   commits    churn  auth   last        file'));
  const uncited = new Set(k.undocumented.map((r) => r.path));
  for (const r of k.byCommits) {
    const line = `  ${pad(r.commits, 8)} ${pad(num(r.churn), 8)} ${pad(r.authors, 4)}   ${r.last}  ${trim(r.path, 52)}`;
    // The word is the marker; the colour repeats it. Piped to a file, "(uncited)" is still on the line.
    L.push(uncited.has(r.path) ? c.yellow(line) + c.dim('  (uncited)') : line);
  }
  L.push(c.dim(`  Top ${Math.min(k.limit, k.byCommits.length)} of ${k.files} by commit count. Ranked by churn instead:`));
  for (const r of k.byChurn.slice(0, 5)) {
    L.push(c.dim(`    ${pad(num(r.churn), 8)} lines moved over ${r.commits} commit(s)  ${trim(r.path, 46)}`));
  }

  L.push('');
  if (!k.indexed) {
    L.push(c.dim('  The corpus cross-reference did not run (--no-index), so nothing here says whether these files'));
    L.push(c.dim('  are documented. That is unread, not "undocumented".'));
  } else if (!k.undocumented.length) {
    L.push(c.green('  Every busy file is cited by at least one document.'));
  } else {
    L.push(c.yellow(`  ${k.undocumentedTotal} busy file(s) that no document cites`) +
      c.dim(`  — showing ${k.undocumented.length}. Marked (uncited) above.`));
    for (const r of k.undocumented.slice(0, 6)) {
      L.push(`    ${pad(r.commits, 4)} commit(s)  ${trim(r.path, 56)}`);
    }
    L.push(c.dim('  A busy file nothing documents is where a newcomer has only the code to go on. It is a'));
    L.push(c.dim('  candidate for a page, not a defect — health.mjs owns the defects, and orphaned markdown.'));
    L.push(c.dim('  Markdown is excluded from this list on both counts. Generated files are not: nothing in git'));
    L.push(c.dim('  history distinguishes a derived manifest from a hand-written one, so some of these want no page.'));
  }
  return L;
}

function renderCoupling(k, c) {
  const L = [];
  L.push(c.bold('Coupling') + c.dim('  files that keep changing in the same commit'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  L.push(c.dim(`  Window: ${k.basis} commit(s) touching 2–${k.maxFiles} files. ` +
    `${k.excludedLarge} larger commit(s) and ${k.excludedSingle} single-file commit(s) excluded.`));
  if (k.excludedLarge) {
    L.push(c.dim(`  A commit touching ${k.maxFiles + 1}+ files contributes hundreds of pairs that co-occur once. Those are noise, not coupling.`));
  }
  if (k.goneDropped) L.push(c.dim(`  ${k.goneDropped} pair(s) dropped because one side no longer exists.`));

  if (k.anecdotal) {
    L.push('');
    L.push(c.yellow(`  ANECDOTE, NOT SIGNAL: ${k.basis} usable commit(s) is below the ${k.minBasis} this measure needs.`));
    L.push(c.dim('  Every figure below rests on the support count printed beside it. Read them as coincidences'));
    L.push(c.dim('  until the repository is older.'));
  }
  L.push('');
  if (!k.pairs.length) {
    L.push(c.dim(`  No pair of files changed together ${k.minSupport} or more times. That is a measurement, not an absence of data.`));
    return L;
  }
  // Labelled A and B rather than named again in the confidence line. Two of the top pairs in this very
  // repository are `.claude-plugin/plugin.json` and `plugins/atlas/.codex-plugin/plugin.json`, and a sentence
  // built from basenames read "when plugin.json changes, plugin.json changes 97% of the time" — true, useless,
  // and impossible to act on. Full paths stay on their own lines where they fit.
  for (const p of k.pairs.slice(0, k.limit)) {
    L.push(`  ${c.cyan(pad(`${p.support}×`, 4))}  A  ${trim(p.a, 56)}` + c.dim(`  (${p.aTouches} commits)`));
    L.push(`        B  ${trim(p.b, 56)}` + c.dim(`  (${p.bTouches} commits)`));
    L.push(c.dim(`           A→B ${p.confAtoB}%   B→A ${p.confBtoA}%   over ${p.support} shared commit(s)`));
  }
  if (k.total > k.limit) L.push(c.dim(`  … and ${k.total - k.limit} more pair(s) at or above ${k.minSupport} co-occurrences.`));
  return L;
}

/**
 * One word per branch, and the order of the tests is the meaning.
 *
 * `unread` outranks every merge verdict on purpose: a branch whose ahead/behind could not be measured must
 * not be labelled with a conclusion drawn from the half that was.
 */
function branchState(b) {
  if (b.isCurrent) return 'current';
  if (b.isProtected) return 'protected';
  if (b.ahead === null || b.behind === null || b.merged === null) return 'unread';
  if (b.ahead > 0) return 'open';
  return b.behind === 0 ? 'at-main' : 'spent';
}

/**
 * One branch's inferred origin, as a sentence a person can argue with.
 *
 * **Every phrase carries the evidence and the hedge, and neither is optional.** Git records no parent, so
 * "cut from `feat/x`" printed flat is a claim this tool cannot support — and a report that fabricates an
 * ancestry is worse than one that omits the column, because the wrong parent is the input to somebody's
 * rebase. `unknown` and `ambiguous` therefore print at the same size as an answer: they *are* the answer.
 *
 * Returned uncoloured. The caller paints it, and the sentence still says everything when it does not.
 */
/**
 * A list of branch names, three of them, then a count.
 *
 * Not decoration. Six sibling worktree branches sitting on one commit put five names on every one of six
 * consecutive rows, each row naming the other five — thirty names to say one thing, and the line that
 * mattered (`same point as feat/charts-interactive-2`) was invisible inside it. The count keeps the claim
 * complete; the truncation is what makes it readable, which is the only reason anyone would read it.
 */
const names = (list, keep = 3) => list.slice(0, keep).join(', ') +
  (list.length > keep ? ` and ${list.length - keep} more` : '');

export function ancestryPhrase(rec, main) {
  if (!rec) return 'origin not measured';
  const extra = [];
  if (rec.orderedBy === 'reflog') extra.push('ordered from this clone\'s reflog, which the graph could not do');
  // Both of these are real caveats and both are counted before they are named: a branch label sitting on the
  // fork commit cannot be ruled out as what this was cut from, and with six of them on screen the count is
  // the part that carries.
  // Named while there are few enough to be worth naming, counted once there are not. Six agent worktrees on
  // one commit is a fact about the session, not six candidates anybody will read.
  const few = (list) => (list.length <= 3 ? names(list) : `${list.length} branch labels`);
  if (rec.atForkPoint?.length) extra.push(`${few(rec.atForkPoint)} sit on that commit and cannot be ruled out`);
  if (rec.sameCommit?.length) extra.push(`${few(rec.sameCommit)} point at this branch's own tip`);
  if (rec.reflogFork && rec.forkCommit && rec.reflogFork !== rec.forkCommit) {
    extra.push(`this clone's reflog has it created at ${rec.reflogFork.slice(0, 7)} instead`);
  }
  const tail = extra.length ? ` (${extra.join('; ')})` : '';
  const at = rec.forkCommit ? rec.forkCommit.slice(0, 7) : '?';
  const sibs = rec.sharedWith?.length ? `, same point as ${names(rec.sharedWith)}` : '';

  switch (rec.basis) {
    case 'self':
      return `the default branch — nothing above it to be cut from${tail}`;
    case 'trunk':
      return (rec.forkCommit
        ? `probably cut from ${main} at ${at}${sibs}`
        : `cut from ${main} — everything on it is already in the trunk, so the graph cannot locate the fork`) +
        (rec.reason ? ` — ${rec.reason}` : '') + tail;
    case 'contained':
      return `probably cut from ${rec.parent} — its tip is an ancestor of this branch${tail}`;
    case 'diverged':
      return `probably cut from ${rec.parent} — they split at ${at} and ${rec.parent} has moved on since${tail}`;
    case 'unordered':
      return `split from ${rec.counterpart} at ${at}; ${rec.reason}, so neither is named the parent${tail}`;
    case 'ambiguous':
      return `cut from one of ${rec.candidates.join(', ')} at ${at} — ${rec.reason}${tail}`;
    default:
      return `origin unknown — ${rec.reason || 'not measured'}`;
  }
}

/** Green for the trunk, blue for a named parent, yellow for anything the graph could not settle. */
const ancestryPaint = (rec, c) => (!rec ? c.yellow
  : rec.basis === 'self' || rec.basis === 'trunk' ? c.dim
  : rec.basis === 'contained' || rec.basis === 'diverged' ? c.blue
  : c.yellow);

function renderBranches(k, c) {
  const L = [];
  L.push(c.bold('Branches') + c.dim('  every branch, not the one you are on — `atlas branch` answers that'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  L.push(c.dim(`  ${k.localCount} local, ${k.remoteCount} remote-tracking. Default branch: ${k.main}.` +
    (k.undetailed ? `  Ahead/behind read for the ${k.detailed} most recent; ${k.undetailed} left unread.` : '')));
  if (!k.mergeCheckRan) L.push(c.yellow(`  MERGE CHECK DID NOT RUN — \`${k.main}\` is not resolvable here, so "merged" is unread for every branch.`));
  if (!k.ancestry?.available) {
    L.push(c.yellow(`  ORIGINS NOT MEASURED — ${k.ancestry?.reason || 'the commit graph was not read'}.`));
  } else if (k.ancestry.unmeasured) {
    L.push(c.dim(`  Origin inferred for the ${k.ancestry.considered} most recent branch(es); ` +
      `${k.ancestry.unmeasured} past the cap of ${k.ancestry.cap} were not measured.`));
  }
  L.push('');

  const show = k.branches.filter((b) => !b.remote).slice(0, 20);
  L.push(c.dim('  last commit  ahead  behind  state       branch'));
  for (const b of show) {
    const state = branchState(b);
    // Colour is a second reading of the `state` column beside it, never the only one: green current, blue
    // holds work, yellow could not be measured, dim finished. Piped to a file the word is still there.
    const paint = state === 'current' ? c.green
      : state === 'open' ? c.blue
      : state === 'unread' ? c.yellow
      : state === 'spent' ? c.dim
      : (s) => s;
    const ahead = b.ahead === null ? '  ?' : pad(b.ahead, 3);
    const behind = b.behind === null ? '  ?' : pad(b.behind, 3);
    L.push(paint(`  ${b.date.slice(0, 10)}    ${ahead}     ${behind}  ${state.padEnd(10)}  ${trim(b.name, 40)}`));
  }
  if (k.localCount > show.length) L.push(c.dim(`  … and ${k.localCount - show.length} more local branch(es), oldest last.`));

  L.push('');
  L.push(c.dim('  current · protected · open (holds commits main does not) · spent (merged, 0 ahead of main)'));
  L.push(c.dim('  at-main (never diverged — new, not finished) · unread (? = never measured, not zero)'));
  L.push('');
  if (k.spent.length) {
    L.push(`  ${c.dim('spent')}    ${k.spent.length} branch(es) are merged into ${k.main} with nothing unique on them:`);
    for (const b of k.spent.slice(0, 10)) L.push(c.dim(`      ${b.name}  (last commit ${b.date.slice(0, 10)})`));
    if (k.spent.length > 10) L.push(c.dim(`      … and ${k.spent.length - 10} more`));
    L.push(c.dim('  Deleting them loses nothing. This command will not do it and does not print a command that would —'));
    L.push(c.dim('  these reports are built to be safe to run blind, including by something that acts on what it reads.'));
  }
  if (k.atMain.length) {
    L.push('');
    L.push(`  ${c.dim('at-main')}  ${k.atMain.length} branch(es) sit on ${k.main}'s own commit with nothing on them yet.`);
    L.push(c.dim(`      ${k.atMain.slice(0, 6).map((b) => b.name).join(', ')}${k.atMain.length > 6 ? `, and ${k.atMain.length - 6} more` : ''}`));
    L.push(c.dim('  These are new, not finished. Git calls them merged because reachability cannot tell the difference.'));
  }
  if (k.unmerged.length) {
    L.push('');
    L.push(`  ${c.blue('open')}   ${k.unmerged.length} branch(es) hold commits ${k.main} does not:`);
    for (const b of k.unmerged.slice(0, 10)) {
      L.push(`      ${b.ahead === null ? '?' : num(b.ahead)} ahead, ${num(b.ageDays)}d old  ${b.name}`);
      // The origin gets its own line rather than a column, because the honest answers are sentences: "cut from
      // one of two branches at the same commit" does not fit a heading and must not be truncated into one.
      L.push(ancestryPaint(b.ancestry, c)(`         ${ancestryPhrase(b.ancestry, k.main)}`));
    }
    if (k.unmerged.length > 10) L.push(c.dim(`      … and ${k.unmerged.length - 10} more`));
    L.push('');
    L.push(c.dim('  Origins are inferred from the commit graph. Git records no parent for a branch, so an unknown'));
    L.push(c.dim('  or an ambiguous origin above is the measurement, not a gap — atlas git-tree draws the whole shape.'));
  }
  if (k.stale.length) {
    L.push('');
    L.push(c.dim(`  ${k.stale.length} branch(es) have had no commit in the ${k.staleDays} days before this repository's newest`));
    L.push(c.dim('  commit. Age alone is not a verdict — a long-lived release branch looks identical to one somebody'));
    L.push(c.dim('  forgot. Measured against the newest commit rather than the clock, so the figure does not move on'));
    L.push(c.dim('  a day when nothing happened.'));
  }
  return L;
}

function renderCadence(k, c) {
  const L = [];
  L.push(c.bold('Cadence') + c.dim('  commit rhythm, week by week'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  L.push(c.dim(`  ${k.first} → ${k.last} · ${k.spanDays} calendar day(s) · ${k.activeDays} with a commit`));
  L.push('');

  // A bar per week, drawn from the filled series so a silent week occupies its own column. The count is
  // printed beside every bar: the glyphs are the shape, the number is the value.
  const max = Math.max(1, ...k.weeks.map((w) => w.commits));
  const shown = k.weeks.slice(-16);
  for (const w of shown) {
    const width = Math.round((w.commits / max) * 28);
    const bar = w.commits === 0 ? c.dim('·') : c.blue('█'.repeat(Math.max(1, width)));
    L.push(`  ${w.week}  ${pad(w.commits, 4)}  ${bar}${w.silent ? c.dim('  (no commits)') : ''}`);
  }
  if (k.weeks.length > shown.length) L.push(c.dim(`  (last ${shown.length} of ${k.spanWeeks} week(s))`));
  L.push('');
  L.push(`  ${pad(k.activeWeeks, 4)} of ${k.spanWeeks} week(s) had a commit` +
    (k.filled ? c.dim(`  · ${k.filled} silent week(s) filled with zero, not unknown — git is complete over its own range`) : ''));
  L.push(`  ${pad(k.medianActiveWeek ?? '—', 4)} commits in the median active week` +
    c.dim(`  · median over all weeks ${k.medianWeek ?? '—'}`));
  if (k.busiest) L.push(`  ${pad(k.busiest.commits, 4)} in the busiest, week of ${k.busiest.week}`);
  L.push(`  ${pad(k.commitsPerActiveDay, 4)} commits per active day` + c.dim(`  (${k.spanDays} day span, ${k.activeDays} active)`));
  if (k.longestSilence) L.push(`  ${pad(k.longestSilence, 4)} week(s) is the longest silence`);
  L.push('');
  L.push(c.dim('  No trend and no forecast. Over a span this short the direction reverses on the next commit,'));
  L.push(c.dim('  and a rate with no denominator is the figure people quote back at you.'));
  return L;
}

function renderHygiene(k, c) {
  const L = [];
  L.push(c.bold('Commit hygiene') + c.dim('  whether history is legible to the next person to read it'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  const rate = (num, den) => (den ? `${Math.round((num / den) * 100)}%` : '—');
  const row = (label, num, den, note) => {
    const pct = den ? Math.round((num / den) * 100) : null;
    const paint = pct === null ? c.dim : pct >= 90 ? c.green : pct >= 60 ? c.blue : c.yellow;
    return `  ${label.padEnd(26)} ${paint(pad(rate(num, den), 5))}  ${c.dim(`${num} of ${den}`)}${note ? c.dim(`  ${note}`) : ''}`;
  };

  L.push(row('conventional subject', k.conventional, k.commits, 'type(scope): …'));
  L.push(row('carries a prose body', k.bodiesRead === null ? 0 : k.bodiesRead - k.noBody, k.bodiesRead || 0,
    'trailers alone do not count as a body'));
  if (k.bodyReadFailed) L.push(c.yellow('  body check DID NOT RUN — git log failed; this is unread, not zero.'));
  L.push(row('names any XX-0 token', k.namingAnyRef, k.commits, null));
  if (k.namingPlanItem === null) {
    L.push(`  ${'names a real plan item'.padEnd(26)} ${c.dim(pad('—', 5))}  ${c.dim('no planning source configured, so the token could not be checked against one')}`);
  } else {
    L.push(row('names a real plan item', k.namingPlanItem, k.commits, `${k.planItems} item(s) in the plan`));
  }
  L.push(row('carries Co-Authored-By', k.aiAssisted, k.commits, 'the model that assisted'));
  L.push(row('carries Desk:', k.deskTagged, k.commits, 'neither trailer can be added afterwards'));
  L.push('');
  L.push(`  ${k.large} commit(s) touch more than ${k.largeThreshold} files.` +
    c.dim('  That threshold is a stated default, not a verdict — a rename sweep looks the same as a sprawl.'));
  for (const b of k.biggest) {
    L.push(c.dim(`    ${pad(b.files, 4)} files  ${pad(num(b.churn), 8)} lines  ${b.date}  ${b.hash}  ${trim(b.subject, 44)}`));
  }
  if (k.reverts) L.push(c.dim(`  ${k.reverts} revert commit(s).`));
  return L;
}

function renderChange(k, c) {
  const L = [];
  L.push(c.bold('This change, against history') + c.dim('  what usually moves with these files'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }
  if (k.empty) { L.push(c.dim(`  Nothing uncommitted on \`${k.branch}\` — no change to measure.`)); return L; }

  L.push(c.dim(`  ${k.files.length} uncommitted file(s) on \`${k.branch}\`` +
    (k.new ? `, ${k.new} of them new to this repository` : '')));
  L.push('');
  L.push(c.dim('   prior     churn   file'));
  for (const f of k.files.slice(0, 15)) {
    const label = f.priorCommits === 0 ? c.green('   new  ') : pad(f.priorCommits + '×', 7);
    const uncited = f.citedBy && f.citedBy.length === 0 && !/\.md$/.test(f.path);
    L.push(`  ${label}  ${pad(num(f.priorChurn), 8)}   ${trim(f.path, 50)}` +
      (uncited ? c.dim('  (no document cites it)') : ''));
  }
  if (k.files.length > 15) L.push(c.dim(`  … and ${k.files.length - 15} more changed file(s).`));

  L.push('');
  if (!k.partners.length) {
    L.push(c.dim('  Nothing that habitually changes with these files has been left out.'));
    return L;
  }
  L.push(c.yellow(`  ${k.partnersTotal} file(s) usually change with something you touched, and have not:`));
  for (const p of k.partners) {
    L.push(`    ${c.yellow('?')} ${trim(p.missing, 52)}`);
    L.push(c.dim(`        changed with ${p.changed} in ${p.support} of that file's ${p.of} commit(s) — ${p.confidence}%` +
      (p.alsoPairedWith ? `; also pairs with ${p.alsoPairedWith} other file${p.alsoPairedWith === 1 ? '' : 's'} you changed` : '')));
  }
  if (k.partnersTotal > k.partners.length) {
    L.push(c.dim(`    … and ${k.partnersTotal - k.partners.length} more, shown ${k.partners.length} strongest first.`));
  }
  L.push('');
  L.push(c.dim(`  These are questions, not defects. The pairs rest on ${k.couplingBasis} usable commit(s)` +
    (k.couplingAnecdotal ? ' — below the floor this measure needs, so treat each as a coincidence until shown otherwise.' : '.')));
  return L;
}

/* ------------------------------------------------------------------ drawing the topology (A-56) */

/**
 * Childless siblings in one state, past this many under one parent, fold into a single counted line.
 *
 * Both folded states hold nothing to draw underneath them and say nothing individually. Twenty-six finished
 * branches, or six agent worktrees all sitting on the trunk's own commit, are a page of noise around the two
 * or three branches the drawing exists to show — and this repository produces the second case every session.
 * Folded, not hidden: the count is the finding and the names are on the line beside it.
 */
const FOLD_AT = 4;
const FOLDABLE = { spent: 'merged into', 'at-main': 'sitting on the same commit as' };

/**
 * The tree, in box-drawing characters, with every figure read off the row it belongs to.
 *
 * **Colour is never the only carrier, and neither is the drawing.** Every row states its ahead count, its age
 * and its state as words and numbers; the glyphs say who descends from whom and the indentation repeats it.
 * `--no-color` removes the escapes and nothing else, which is asserted the same way the rest of this module
 * asserts it: strip the escapes from the painted render and it must equal the plain one byte for byte.
 */
export function formatBranchTree(k, useColor) {
  const c = palette(useColor);
  if (!k.available) {
    return `No branch topology: ${k.reason}\n`
      + '  This reads refs and the commit graph. Without either there is nothing to draw, and an empty tree\n'
      + '  would be a repository with no branches, which is a different claim.';
  }

  const L = [];
  L.push(c.bold('Branch topology') + c.dim('  what descends from what, where each split off, what has gone back'));
  L.push(c.dim(`  ${k.localCount} local, ${k.remoteCount} remote-tracking. Default branch: ${k.main}` +
    (k.trunkIsLocal || !k.localCount ? '.' : ' — not a local branch here, drawn as the root anyway.') +
    (k.undetailed ? `  Ahead/behind read for the ${k.detailCap} most recent; ${k.undetailed} left unread.` : '')));
  // A detached HEAD has no row to mark `current`, and a reader who does not know that reads the absence as a
  // report that lost track of where they are.
  if (k.current === 'HEAD') L.push(c.dim('  HEAD is detached — no branch is current here, which is why no row is marked one.'));
  if (!k.mergeCheckRan) L.push(c.yellow(`  MERGE CHECK DID NOT RUN — \`${k.main}\` is not resolvable here.`));
  if (!k.ancestry?.available) L.push(c.yellow(`  ORIGINS NOT MEASURED — ${k.ancestry?.reason || 'the commit graph was not read'}.`));
  else if (k.ancestry.unmeasured) {
    L.push(c.dim(`  ${k.ancestry.considered} branch(es) taken into the inference; ${k.ancestry.unmeasured} past the cap of ${k.ancestry.cap} were not.`));
  }
  L.push('');

  if (!k.localCount) {
    L.push(c.dim('  No local branches. Nothing to draw — this is a measurement of an empty ref namespace, not a failure.'));
    return L.join('\n');
  }

  /* ------------------------------------------------ collect rows before drawing, so the columns can line up */

  const rows = [];
  const push = (kind, label, node, notes = []) => rows.push({ kind, label, node, notes: notes.filter(Boolean) });

  const notesFor = (b) => {
    const a = b?.ancestry;
    if (!a || a.basis === 'self') return [];
    // The edge already says "cut from the node above". A note is added only where the phrase carries something
    // the edge cannot: a sibling at the same fork, a parent that has moved on, a reflog that disagrees, a name
    // sharing the commit. Restating the parent on every row would bury those in noise.
    const extra = a.sharedWith?.length || a.atForkPoint?.length || a.sameCommit?.length || a.reason
      || a.basis === 'diverged' || a.basis === 'unordered' || a.basis === 'ambiguous'
      || (a.reflogFork && a.forkCommit && !a.forkCommit.startsWith(a.reflogFork));
    return extra ? [ancestryPhrase(a, k.main)] : [];
  };

  const walk = (node, prefix, isLast, depth) => {
    const glyph = depth === 0 ? '' : isLast ? '└─ ' : '├─ ';
    push('node', prefix + glyph + node.name, node, notesFor(node.branch));
    const kidPrefix = depth === 0 ? '' : prefix + (isLast ? '   ' : '│  ');

    // Only a childless branch may be folded: one with descendants is a junction in the drawing, whatever its
    // own state, and collapsing it would take its children off the page with it.
    const kids = node.children;
    const groups = Object.keys(FOLDABLE)
      .map((state) => ({ state, of: kids.filter((n) => n.state === state && !n.children.length) }))
      .filter((g) => g.of.length >= FOLD_AT);
    const foldedSet = new Set(groups.flatMap((g) => g.of));
    const keep = kids.filter((n) => !foldedSet.has(n));

    keep.forEach((kid, i) => walk(kid, kidPrefix, i === keep.length - 1 && !groups.length, depth + 1));
    groups.forEach((g, gi) => {
      const list = g.of.map((n) => n.name).sort();
      push('fold', `${kidPrefix}${gi === groups.length - 1 ? '└─' : '├─'} ${g.of.length} ${g.state} branch(es)`, null,
        [`${FOLDABLE[g.state]} ${node.name}: ${names(list, 8)}`]);
    });
  };

  k.roots.forEach((r, i) => walk(r, '', i === k.roots.length - 1, 0));

  if (k.unplaced.length) {
    push('blank', '');
    push('heading', `  ${k.unplaced.length} branch(es) whose topology could not be established`);
    for (const u of k.unplaced) push('orphan', `    ${u.node.name}`, u.node, [u.reason]);
  }

  /* ------------------------------------------------ draw */

  const width = Math.min(52, Math.max(...rows.map((r) => (r.kind === 'node' || r.kind === 'orphan' ? r.label.length : 0))) + 2);
  // Notes sit under the names they belong to, not under the number columns: a continuation indented past the
  // metrics reads as a caption for the figures rather than as a second sentence about the branch.
  const noteIndent = '        ';
  for (const r of rows) {
    const b = r.node?.branch;
    if (r.kind === 'blank') L.push('');
    else if (r.kind === 'heading') L.push(c.yellow(r.label));
    else if (r.kind === 'fold') L.push(c.dim(`  ${r.label}`));
    else if (!b) {
      // The synthetic trunk: a label with no row behind it. No measurement columns rather than a line of
      // zeros, because a zero here is four figures nobody took.
      L.push(`  ${r.label.padEnd(width)}${c.dim(k.trunkIsLocal ? '' : 'not a local branch')}`);
    } else {
      const state = r.node.state;
      const paint = state === 'current' ? c.green
        : state === 'open' ? c.blue
        : state === 'unread' ? c.yellow
        : state === 'spent' ? c.dim
        : (s) => s;
      const ahead = b.ahead === null ? '?' : num(b.ahead);
      const a = b.ancestry;
      const drawnFork = r.node.viaTrunk ? a?.trunkFork : a?.forkCommit;
      const at = a?.basis === 'self' ? 'the trunk itself'
        : drawnFork ? `forked at ${drawnFork.slice(0, 7)}`
        : a?.reflogFork ? `reflog: created at ${a.reflogFork.slice(0, 7)}`
        : a?.basis === 'trunk' ? 'fork point not in the graph'
        : 'fork point unread';
      L.push(`  ${paint(r.label.padEnd(width))}${pad(ahead, 5)} ahead  ${pad(`${num(b.ageDays)}d`, 5)}  ` +
        `${state.padEnd(9)}` + c.dim(`  ${at}`));
    }
    for (const note of r.notes) L.push(c.dim(`${noteIndent}${note}`));
  }

  L.push('');
  L.push(c.dim('  Every edge is inferred. Git records no parent for a branch, so the shape above is read out of the'));
  L.push(c.dim('  commit graph: `forked at` is a merge base, which is a fact — which side of it is the parent is'));
  L.push(c.dim('  not, and a branch whose origin could not be settled is listed with its reason rather than hung'));
  L.push(c.dim(`  off ${k.main} to tidy the picture.`));
  L.push(c.dim('  Age is days behind this repository\'s newest commit, not days on a calendar, so the drawing does'));
  L.push(c.dim('  not change on a day when nothing happened.'));
  L.push(c.dim('  current · protected · open (holds commits the trunk does not) · spent (merged, 0 ahead)'));
  L.push(c.dim('  at-main (never diverged — new, not finished) · unread (? = never measured, not zero)'));
  L.push('');
  L.push(c.dim('  Read-only. Nothing here fetched, checked out, deleted, rebased or configured anything, and it'));
  L.push(c.dim('  prints no command that would. atlas git-insights branches is the same refs as a table.'));
  return L.join('\n');
}

const RENDER = {
  hotspots: renderHotspots,
  coupling: renderCoupling,
  branches: renderBranches,
  cadence: renderCadence,
  hygiene: renderHygiene,
  change: renderChange,
};

export function formatGitInsight(k, useColor) {
  const c = palette(useColor);
  if (!k.available) {
    return `No git insight: ${k.reason}\n  Every section here reads git history. Without commits there is nothing to read, and\n  reporting zeros would be a measurement nobody made.`;
  }
  const L = [];
  const order = k.section === 'all' ? SECTIONS : [k.section];
  for (const s of order) {
    const data = k.sections[s];
    if (!data) continue;
    if (L.length) { L.push(''); L.push(c.dim('─'.repeat(78))); L.push(''); }
    L.push(...RENDER[s](data, c));
  }
  if (k.section === 'all') {
    L.push('');
    L.push(c.dim('  Read-only. Nothing above fetched, checked out, deleted or configured anything.'));
    L.push(c.dim(`  One section at a time: atlas git-insights ${SECTIONS.join('|')}`));
  }
  return L.join('\n');
}
