/**
 * project-atlas · the derived half of a handoff, and nothing else
 *
 * A session ends and everything it learned that was not written down is gone. The next one re-derives what
 * it can and rediscovers the rest by hitting it again, which is how the same trap costs time twice.
 *
 * `HANDOFF.md` is the answer, and **the tool must never write it.** A machine can see that a commit
 * happened; it cannot see that a decision was argued and settled, or that an approach was tried and
 * abandoned for a reason worth not repeating. A generated handoff would be exactly what this project exists
 * to detect: confident prose nobody reviewed, going stale from the moment it was written.
 *
 * So this prints the half that *is* derivable — what moved, what the plan says, what the journal recorded —
 * as a prompt for a person to write the rest. The distinction is the whole design: it reports, and the
 * words stay yours.
 *
 * ## The one thing it does maintain
 *
 * A handoff's header names the commit it was written against. That is a fact, not a judgement, and letting
 * it rot defeats the document — a reader cannot tell whether they are reading something current or
 * something from forty commits ago. H13 raises it when the distance gets long, and it is **advisory**: a
 * stale handoff is a cost, not a hazard, and a blocking signal on a file this subjective would train people
 * to suppress it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { contributorSlug } from './worklog.mjs';

/** How far behind HEAD a handoff's recorded commit may fall before H13 says so. */
export const DEFAULT_STALE_AFTER = 50;

const git = (root, args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

export function handoffPath(root, cfg, identity) {
  const dir = cfg.handoff?.dir || 'docs/handoff';
  return path.join(root, dir, contributorSlug(identity), 'HANDOFF.md');
}

export function sharedPath(root, cfg) {
  return path.join(root, cfg.handoff?.dir || 'docs/handoff', 'SHARED.md');
}

/**
 * Every contributor handoff in the repository.
 *
 * Enumerated from disk rather than from a list, so a person who joins gets their handoff checked without
 * anyone adding them anywhere. `SHARED.md` is deliberately not included: it is the team's standing
 * constraints, which do not go stale by a commit count the way a personal "here is where I got to" does.
 */
export function handoffsIn(root, cfg) {
  const dir = path.join(root, cfg?.handoff?.dir || 'docs/handoff');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ slug: e.name, file: path.join(dir, e.name, 'HANDOFF.md'), rel: path.posix.join(cfg?.handoff?.dir || 'docs/handoff', e.name, 'HANDOFF.md') }))
    .filter((h) => fs.existsSync(h.file));
}

/**
 * The commit a handoff says it was written against, and how far HEAD has moved since.
 *
 * `distance` is null rather than 0 when it cannot be computed — an unknown distance reported as zero would
 * say "current" about a document nobody checked, which is the failure mode this whole tool is aimed at.
 */
export function handoffAge(root, file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { exists: false }; }

  const m = /(?:^|\n)[^\n]*\b(?:commit|at)\b[^\n]*?\b([0-9a-f]{7,40})\b/i.exec(text);
  if (!m) return { exists: true, commit: null, distance: null, reason: 'names no commit' };

  const commit = m[1];
  const count = git(root, ['rev-list', '--count', `${commit}..HEAD`]);
  if (count === null) return { exists: true, commit, distance: null, reason: 'the named commit is not in this history' };
  return { exists: true, commit, distance: Number(count) };
}

/**
 * The prompt.
 *
 * Deliberately a set of questions with the derived facts attached, not a draft. A draft would be prose the
 * tool wrote and a person signed, which is the arrangement that produces documents nobody trusts.
 */
export function formatHandoffPrompt({ branch, version, journal, plan, changes, age, identity, file }) {
  const L = [];
  L.push('');
  L.push(`  Handoff for ${identity || 'you'} — ${file}`);
  L.push(`  ${version || 'unknown version'} · ${branch?.ok ? branch.current : 'unknown branch'}` +
         `${branch?.dirty ? ` · ${branch.dirty} uncommitted` : ''}`);
  L.push('');

  if (!age.exists) {
    L.push('  No handoff exists yet. Everything below is derived; write the rest yourself.');
  } else if (age.distance === null) {
    L.push(`  The existing handoff ${age.reason}, so its age cannot be measured.`);
  } else {
    L.push(`  The existing handoff was written ${age.distance} commit(s) ago (${age.commit}).`);
  }
  L.push('');

  if (plan && !plan.missing) {
    const moving = plan.items.filter((i) => (i.percent ?? 0) > 0 && (i.percent ?? 0) < 100);
    L.push(`  In flight: ${moving.length ? moving.map((i) => `${i.id} (${i.percent}%)`).join(', ') : 'nothing'}`);
  }
  if (changes?.available) {
    const n = (changes.unstaged?.length || 0) + (changes.staged?.length || 0);
    if (n) L.push(`  Uncommitted: ${n} file(s)`);
  }
  L.push('');

  if (journal?.records?.length) {
    const recent = journal.records.slice(-12);
    L.push(`  The journal recorded ${journal.records.length} thing(s); the last ${recent.length}:`);
    L.push('');
    for (const r of recent) L.push(`    ${r.kind.padEnd(9)} ${r.text}`);
    L.push('');
  }

  L.push('  Now write what none of the above can say:');
  L.push('');
  L.push('    · What did you decide, and what does it rule out?');
  L.push('    · What did you try that did not work, and why not?');
  L.push('    · What will bite the next person that nothing in the repository reveals?');
  L.push('    · What is half-done, and what state is it in?');
  L.push('');
  L.push('  Delete anything from your handoff that the repository already answers. A handoff that');
  L.push('  duplicates derived state goes stale exactly the way this project exists to detect.');
  L.push('');
  L.push('  Nothing was written. The tool reports; the words stay yours.');
  L.push('');
  return L.join('\n');
}
