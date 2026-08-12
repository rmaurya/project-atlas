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
 *     `readContrib` result as an argument and never runs `git log --numstat` itself.
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

/**
 * Code file → the documents that cite it.
 *
 * `kb.mjs::writeKnowledgeGraph` builds exactly this and holds it as a local `const`, so there is nothing to
 * import. Named by function rather than by line: both files are under active change, and a line number that
 * is wrong within the hour is worse than no citation at all.
 *
 * Eight duplicated lines was the lesser of two evils against editing a module owned by a different change in
 * the same session; hoisting one of the two into a shared helper is the right follow-up, and C-7 records it.
 * Both must stay filtered on `typeof resolved === 'string'` — an unresolved
 * or ambiguous citation is not evidence that anything is documented, and counting it would turn the one
 * finding this section exists for ("nothing documents this file") into a false negative.
 */
function reverseCitations(index) {
  const by = new Map();
  if (!index?.documents) return by;
  for (const d of index.documents) {
    for (const c of d.citations || []) {
      if (typeof c.resolved !== 'string') continue;
      if (!by.has(c.resolved)) by.set(c.resolved, new Set());
      by.get(c.resolved).add(d.path);
    }
  }
  return by;
}

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
    '%(upstream:short)', '%(upstream:track)', '%(contents:subject)'].join(US);

  const raw = git(root, ['for-each-ref', `--format=${FMT}`, 'refs/heads', 'refs/remotes']);
  if (raw === null) return { available: false, reason: 'git for-each-ref could not run — not a repository, or no refs' };

  const current = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || null;
  const protectedSet = new Set([main, 'master', 'develop', ...(cfg.branching?.protected || [])]);

  const mergedRaw = git(root, ['for-each-ref', '--merged', main, '--format=%(refname:short)', 'refs/heads']);
  // `null` here is not "nothing is merged" — it is "the merge question could not be asked", which happens
  // when the default branch does not exist locally. Every row's `merged` stays null in that case.
  const merged = mergedRaw === null ? null : new Set(mergedRaw.split('\n').filter(Boolean));

  const all = raw.split('\n').filter(Boolean).map((line) => {
    const [ref, name, sha, date, upstream, track, subject] = line.split(US);
    const remote = ref.startsWith('refs/remotes/');
    return {
      ref, name, sha, date, subject: subject || '',
      remote,
      upstream: upstream || null,
      track: (track || '').trim() || null,
      isCurrent: name === current,
      isProtected: protectedSet.has(name),
      merged: remote ? null : (merged ? merged.has(name) : null),
      ageDays: Math.floor((Date.now() - Date.parse(date)) / 86400000),
      ahead: null, behind: null,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // A remote's HEAD is a symref pointing at one of the branches already listed, not a branch of its own.
  const rows = all.filter((b) => !/\/HEAD$/.test(b.ref));

  const detailed = rows.slice(0, opts.branchDetailCap);
  for (const b of detailed) {
    const out = git(root, ['rev-list', '--left-right', '--count', `${main}...${b.name}`]);
    if (out === null) continue;                                   // stays null: unread, not zero
    const [behind, ahead] = out.trim().split(/\s+/).map(Number);
    if (Number.isFinite(behind)) b.behind = behind;
    if (Number.isFinite(ahead)) b.ahead = ahead;
  }

  const local = rows.filter((b) => !b.remote);
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
    stale, spent, atMain, unmerged,
  };
}

/* ------------------------------------------------------------------ cadence */

/**
 * Weeks with no commits are weeks, and they have to be drawn.
 *
 * `contrib.mjs::aggregateWeeks` creates an entry only for a week that contains a commit, so a fortnight of
 * silence vanishes from the array and the next week sits flush against the last one. Anything reading the
 * series by index therefore reads a two-month gap as a single step, which is the one thing a rhythm measure
 * must not do.
 *
 * **The gaps are filled with zero, not with unknown**, and that distinction is the whole justification: git
 * history is complete over its own range, so a week with no entry is a week that was examined and had none.
 * That is a measurement. Nothing is invented — every non-zero figure is exactly the one `aggregateWeeks`
 * produced — and the number of filled weeks is carried on the result so the caller can state it.
 *
 * `dashboard.mjs::weeklyAxis` reaches the same conclusion for the charts and holds it as a private function
 * in a module that renders HTML. The rule is stated in both places rather than imported
 * through a renderer; C-7 records that one of the two should be hoisted.
 */
export function fillWeeks(weeks) {
  const src = weeks || [];
  if (src.length < 2) return { weeks: src, filled: 0 };
  const by = new Map(src.map((w) => [w.week, w]));
  const last = src[src.length - 1].week;
  const out = [];
  let filled = 0;
  // Every key comes from `isoWeekStart`, so both ends are a Monday and a 7-day step lands on Mondays.
  for (const d = new Date(`${src[0].week}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 7)) {
    const week = d.toISOString().slice(0, 10);
    const hit = by.get(week);
    if (hit) out.push(hit);
    else { out.push({ week, commits: 0, added: 0, removed: 0, ai: 0, authors: 0, silent: true }); filled++; }
    if (week >= last) break;
  }
  return { weeks: out, filled };
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
    const line = `  ${pad(r.commits, 8)} ${pad(r.churn.toLocaleString(), 8)} ${pad(r.authors, 4)}   ${r.last}  ${trim(r.path, 52)}`;
    // The word is the marker; the colour repeats it. Piped to a file, "(uncited)" is still on the line.
    L.push(uncited.has(r.path) ? c.yellow(line) + c.dim('  (uncited)') : line);
  }
  L.push(c.dim(`  Top ${Math.min(k.limit, k.byCommits.length)} of ${k.files} by commit count. Ranked by churn instead:`));
  for (const r of k.byChurn.slice(0, 5)) {
    L.push(c.dim(`    ${pad(r.churn.toLocaleString(), 8)} lines moved over ${r.commits} commit(s)  ${trim(r.path, 46)}`));
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

function renderBranches(k, c) {
  const L = [];
  L.push(c.bold('Branches') + c.dim('  every branch, not the one you are on — `atlas branch` answers that'));
  if (!k.available) { L.push(c.dim(`  Not read: ${k.reason}`)); return L; }

  L.push(c.dim(`  ${k.localCount} local, ${k.remoteCount} remote-tracking. Default branch: ${k.main}.` +
    (k.undetailed ? `  Ahead/behind read for the ${k.detailed} most recent; ${k.undetailed} left unread.` : '')));
  if (!k.mergeCheckRan) L.push(c.yellow(`  MERGE CHECK DID NOT RUN — \`${k.main}\` is not resolvable here, so "merged" is unread for every branch.`));
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
      L.push(`      ${b.ahead === null ? '?' : b.ahead} ahead, ${b.ageDays}d old  ${b.name}`);
    }
    if (k.unmerged.length > 10) L.push(c.dim(`      … and ${k.unmerged.length - 10} more`));
  }
  if (k.stale.length) {
    L.push('');
    L.push(c.dim(`  ${k.stale.length} branch(es) have had no commit for ${k.staleDays}+ days. Age alone is not a verdict —`));
    L.push(c.dim('  a long-lived release branch looks identical to one somebody forgot.'));
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
    L.push(c.dim(`    ${pad(b.files, 4)} files  ${pad(b.churn.toLocaleString(), 8)} lines  ${b.date}  ${b.hash}  ${trim(b.subject, 44)}`));
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
    L.push(`  ${label}  ${pad(f.priorChurn.toLocaleString(), 8)}   ${trim(f.path, 50)}` +
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
