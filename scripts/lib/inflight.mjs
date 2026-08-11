/**
 * project-atlas · work in flight
 *
 * Every plan figure on the dashboard is read from `planning.source` — `docs/ROADMAP.md` here — which records
 * what somebody has already written down and already marked. So the Backlog view read
 * "Backlog 62 · Done (62) · In progress (0) · Not started (0)" on a dirty branch, mid-change, with seven
 * pieces of work open. The page was not wrong; it was blind. A project in the middle of a change rendered as
 * a finished one, because the only thing it could see was the record of finished things.
 *
 * `atlas.mjs` already carries the same defect in another instance: the spec gate repairs an item the plan
 * still records as never started, "which means the dashboard reported 'nothing in progress' for the whole
 * time the work was being done". That repair fires on a commit that names an item. **Before the first commit
 * there is no subject to name anything**, and that window — a branch, a set of edits, a session in the middle
 * of it — is what this module reads.
 *
 * ## What "in flight" is allowed to mean
 *
 * Only what the repository can be asked. There is a task list in the agent session driving this change, and
 * it would answer the question perfectly; it is also not in the repository, cannot be verified from it, and
 * bridging to it would put unreviewable state on a page whose entire warranty is that everything on it is
 * derived. So the answer is assembled from four things git and the working tree already know, and each of
 * them is reported as the thing it is:
 *
 *   1. **The branch**, and whether it is protected — `branch.mjs`, which already models that.
 *   2. **Uncommitted and staged files** with their line counts — `changes.mjs`, which already reads them.
 *   3. **Commits since this branch diverged**, and which plan items their subjects name.
 *   4. **The journal**, as a count and never as content.
 *
 * ## Four rules, each of which is a way this could otherwise lie
 *
 * **1. Committed work is in flight only when the branch actually diverged.** `readChanges` compares against
 * the merge-base when there is one and falls back to `HEAD~2` when there is not. Those last two commits are
 * on the trunk and already delivered — presenting them as work underway would be this module committing the
 * exact defect it exists to remove, in the opposite direction.
 *
 * **2. Untracked files are counted, never named.** `git diff` does not see them at all, so the tracked-file
 * detail and `git status --porcelain` disagree by precisely the untracked set; reporting only the diff would
 * under-count a tree that is obviously dirty. Naming them would go the other way: a file git has not been
 * told about is not yet part of the repository, and this page shows repository state. Its count is
 * observable. Its path is not yet a fact about this project.
 *
 * **3. The journal contributes a count and a timespan, and nothing else.** Same boundary the decisions panel
 * already holds: `.atlas/journal/` never publishes, so "3 records since the last commit" ships and the three
 * sentences do not. A statistic about a log is not the log.
 *
 * **4. No completion figure, ever.** There is no denominator for work nobody has written down. A percentage
 * here would be the most confident lie on the page — worse than the blind panel it replaces, because it
 * would look like it had been measured.
 */

import { execFileSync } from 'node:child_process';
import { readChanges } from './changes.mjs';
import { branchStatus } from './branch.mjs';
import { read as readJournal } from './journal.mjs';

/**
 * The shape of a plan item id in a commit subject.
 *
 * Same expression `contrib.mjs` already uses to pull `taskRefs` out of a subject, and the same idea as the
 * configured `crossref[].pattern` that pairs the roadmap with the changelog. Written here rather than read
 * from the config on purpose: `crossref` describes a document pair, its `pattern` is untrusted input that
 * `config.mjs` has to screen before compiling, and a subject is neither of those documents. Matching two
 * different things with one configured regex would make a change to the crossref rule silently change what
 * this panel claims about commits.
 */
const ID_IN_SUBJECT = /\b[A-Z]{1,3}-\d{1,4}\b/g;

function git(root, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;                                  // the caller distinguishes null from empty; see below
  }
}

/**
 * How many files git is not tracking. `null`, not `0`, when the command failed.
 *
 * Unknown is not zero is a rule this project enforces on plan items, and it is the same rule here: a `0`
 * reported because `git status` could not run would put "working tree clean" on the page as a measurement
 * nobody made.
 */
function untrackedCount(root) {
  const out = git(root, ['status', '--porcelain']);
  if (out === null) return null;
  return out.split('\n').filter((l) => l.startsWith('??')).length;
}

/**
 * A commit's own timestamp, normalised to UTC.
 *
 * `%cI` carries the committer's offset — `2026-08-11T16:43:00+05:30` — and journal records carry
 * `new Date().toISOString()`, which is always `Z`. `journal.read({ since })` compares the two as **strings**,
 * so handing it the raw `%cI` would order `+05:30` against `Z` lexicographically and silently include or drop
 * records by however many hours the machine sits from Greenwich. Both sides are pushed through
 * `toISOString()` so the comparison is between two of the same thing.
 */
function commitInstant(root, rev) {
  const iso = git(root, ['log', '-1', '--format=%cI', rev]);
  if (!iso || !iso.trim()) return null;
  const d = new Date(iso.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One row per path, with the line counts summed across every state that path appears in.
 *
 * A file is routinely changed by a commit on this branch *and* modified again in the working tree, and the
 * panel names both states on the one row — so keeping only the first numstat found would print a line count
 * that quietly contradicts the states printed beside it. Summed, matching the dedupe `changes.mjs` already
 * does, so the figure answers the question the row is asking: how much this change has moved this file.
 *
 * A binary file has no line counts to sum and keeps none. `null` stays `null` rather than collapsing into a
 * `0` that would read as "nothing changed here".
 */
const dedupe = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const cur = by.get(r.path);
    if (!cur) { by.set(r.path, { ...r }); continue; }
    cur.binary = cur.binary || r.binary;
    cur.added = cur.binary ? null : (cur.added || 0) + (r.added || 0);
    cur.removed = cur.binary ? null : (cur.removed || 0) + (r.removed || 0);
  }
  return [...by.values()];
};

/**
 * Everything the repository knows about work that has not landed yet.
 *
 * Never throws. `readChanges` re-raises an unexpected git failure deliberately — its docblock explains that a
 * command silently returning nothing looks exactly like a repository with no changes — and that distinction
 * has to survive up to the page, so it comes back as `failed: true` rather than as an absence. A caller that
 * rendered `available: false` and `failed: true` the same way would turn "the check did not run" into
 * "nothing is happening", which is the one claim this whole project refuses to let a tool make.
 */
export function readInflight(root, cfg = {}, { index = null, plan = null } = {}) {
  let changes;
  try {
    changes = readChanges(root, cfg, index);
  } catch (err) {
    return { available: false, failed: true, reason: String(err?.message || err) };
  }
  if (!changes.available) return { available: false, failed: false, reason: changes.reason };

  const br = branchStatus(root, cfg);

  // Rule 1. Anything `readChanges` found under the `last-2-commits` fallback is trunk history, not work in
  // flight, and is dropped here rather than relabelled — `diverged` is reported so the panel can say which
  // question it was able to ask.
  const diverged = changes.scope === 'branch';
  const committed = diverged ? changes.committed : [];
  const commitLines = diverged ? changes.commits : [];

  const commits = commitLines.map((line) => {
    const sp = line.indexOf(' ');
    const subject = sp === -1 ? '' : line.slice(sp + 1);
    return {
      hash: sp === -1 ? line : line.slice(0, sp),
      subject,
      refs: [...new Set(subject.match(ID_IN_SUBJECT) || [])],
    };
  });

  // Which plan items this branch's commits name, and what the plan currently records for each.
  //
  // The pairing is the finding, not either half: a commit naming A-23 is unremarkable, and a commit naming
  // A-23 while the plan still records A-23 at 0% is the contradiction `progress.mjs` was written to repair.
  const items = plan && !plan.missing ? plan.items : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const named = [...new Set(commits.flatMap((c) => c.refs))].sort();
  const namedItems = named.filter((id) => byId.has(id)).map((id) => {
    const it = byId.get(id);
    return { id: it.id, title: it.title, percent: it.percent, estimated: it.estimated, status: it.status };
  });
  // Reported only when there is a plan to have been checked against. With no plan every token that merely
  // looks like an id would be listed as unrecognised, and `UTF-8` is not an unrecognised plan item — it is a
  // question nothing in this repository was in a position to ask.
  const unrecognised = items.length ? named.filter((id) => !byId.has(id)) : [];

  const tracked = dedupe([...changes.unstaged, ...changes.staged, ...committed]);
  const untracked = untrackedCount(root);

  // Which parts of the corpus the change lands in. `readChanges` resolves a path to its cluster only for
  // documents the index holds, so everything else is code or an unindexed file — counted under its own name
  // rather than folded into a cluster it is not in.
  const clusters = new Map();
  let outsideCorpus = 0;
  for (const f of tracked) {
    const c = changes.clusters?.[f.path];
    if (!c) { outsideCorpus++; continue; }
    clusters.set(c, (clusters.get(c) || 0) + 1);
  }

  // Rule 3. Anchored on HEAD's own timestamp, so the window is "since the last thing was committed" — which
  // is the uncommitted window exactly, and is the same question on a branch as on the trunk. Anchoring on the
  // merge-base instead would have counted a long branch's whole life as happening now.
  const since = commitInstant(root, 'HEAD');
  let journal = { available: false, since, records: 0, blockers: 0, contributors: 0, skipped: 0 };
  try {
    const j = readJournal(root, { since });
    journal = {
      available: j.available,
      since,
      records: j.records.length,
      blockers: j.records.filter((r) => r.kind === 'blocker').length,
      contributors: [...new Set(j.records.map((r) => r.by))].length,
      skipped: j.skipped,
    };
  } catch { /* an unreadable journal is stated as absent, never as empty */ }

  const quiet = !tracked.length && !untracked && !journal.records;

  return {
    available: true,
    failed: false,
    branch: changes.branch,
    main: changes.main,
    onProtected: br.ok ? br.onProtected : null,
    ahead: br.ok ? br.ahead : null,
    diverged,
    base: changes.base,
    staged: changes.staged,
    unstaged: changes.unstaged,
    committed,
    commits,
    tracked,
    untracked,
    namedItems,
    unrecognised,
    hasPlan: items.length > 0,
    clusters: [...clusters.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    outsideCorpus,
    journal,
    quiet,
  };
}

/**
 * The one sentence a reader needs before any of the detail.
 *
 * Deliberately dull, and deliberately willing to say very little. "3 uncommitted file(s) on `fix/x`; no
 * commit on this branch names a plan item" is true, checkable and useful. A tool that stretched the same
 * facts into a progress figure would be more satisfying to read and worth nothing.
 */
export function inflightSentence(k) {
  if (!k.available) return null;
  if (k.quiet) {
    return `Nothing in flight: no uncommitted change on \`${k.branch}\`` +
      (k.diverged ? ', and nothing committed here since it diverged' : '') + '.';
  }

  const parts = [];
  const working = k.unstaged.length + k.staged.length;
  if (working) parts.push(`${working} uncommitted file(s)`);
  // `null` is "could not be read" and is stated as such; `0` is a measurement and needs no mention.
  if (k.untracked === null) parts.push('an unknown number of untracked files');
  else if (k.untracked) parts.push(`${k.untracked} untracked`);
  if (k.commits.length) parts.push(`${k.commits.length} commit(s) since \`${k.main}\``);
  if (!parts.length && k.journal.records) parts.push(`${k.journal.records} journal record(s) since the last commit`);

  const lead = `${parts.join(', ')} on \`${k.branch}\`.`;
  if (!k.hasPlan) return `${lead} No planning document is configured, so none of it can be matched to an item.`;
  if (!k.namedItems.length) return `${lead} No plan item is named by any of it.`;
  return `${lead} Names ${k.namedItems.map((i) => i.id).join(', ')}.`;
}
