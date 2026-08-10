/**
 * project-atlas · the day, written down
 *
 * `atlas contrib` and `atlas sessions` compute how a day went and print it to a terminal that scrolls away.
 * This writes it to `worklog/YYYY-MM-DD/log.md` so a week later there is a record, and so a team can read
 * each other's without asking.
 *
 * ## What it does not contain, and why that is not squeamishness
 *
 * **No prompt text.** `tokens.mjs` rule 3 — *aggregate only; never prompt text, never a file path that was
 * read, never a session title* — has a test that plants `SECRET-PROMPT-TEXT` in a fixture and asserts it
 * never surfaces. A worklog is committed and pushed, so prose that entered it would be permanent and public
 * in a way a terminal report never is. The rule matters more here, not less.
 *
 * **No prompt-quality score.** A transcript records what happened after a prompt, not whether the prompt was
 * well judged. What is written down is what the repository can see: what changed, what it cost in rework,
 * and which plan items the work claimed to advance.
 *
 * ## Why the date format is not the one that was asked for
 *
 * `YYYY-DD-MM` was requested. Directory names sort lexicographically, so `2026-09-08` would sort before
 * `2026-08-09` and every listing of a worklog would be wrong. `YYYY-MM-DD` is the one format where sorted
 * and chronological are the same thing.
 */

import fs from 'node:fs';
import path from 'node:path';

/** `YYYY-MM-DD` in the machine's own timezone — the one the person reading it lives in. */
export function dayKey(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Commits made on a given local day, with the plan items their subjects name. */
export function commitsOn(contrib, day) {
  if (!contrib?.available) return [];
  return (contrib.commits || []).filter((c) => (c.date || '').slice(0, 10) === day);
}

/**
 * The day's entry.
 *
 * Every figure is measured. Where nothing can be measured the line is omitted rather than written as zero —
 * a worklog claiming "0 commits" on a day of design discussion would be a false record, and a record that
 * lies about a quiet day is worse than no record.
 */
export function renderDay({ day, identity, contrib, health, plan, commits }) {
  const L = [];
  L.push(`# ${day} — ${identity || 'unknown author'}`);
  L.push('');
  L.push(`_Written by \`atlas worklog\`. Measured from git and the corpus; no prompt text, and nothing here` +
         ` scores how anyone worked._`);
  L.push('');

  if (!commits.length) {
    L.push('No commits landed on this day. That is not the same as no work — this file records what the');
    L.push('repository can see, which is commits and their consequences.');
  } else {
    const added = commits.reduce((a, c) => a + (c.added || 0), 0);
    const removed = commits.reduce((a, c) => a + (c.removed || 0), 0);
    const ai = commits.filter((c) => c.agent).length;
    const desks = [...new Set(commits.map((c) => c.desk).filter(Boolean))];

    L.push('## What landed');
    L.push('');
    L.push(`| | |`);
    L.push(`|---|---|`);
    L.push(`| Commits | ${commits.length}${ai ? ` · ${ai} AI-assisted` : ''} |`);
    L.push(`| Lines | +${added.toLocaleString()} / −${removed.toLocaleString()} |`);
    if (desks.length) L.push(`| Desks | ${desks.join(', ')} |`);
    if (contrib?.quality) {
      L.push(`| Rework rate | ${contrib.quality.reworkRate}% — a file re-touched within ${contrib.quality.reworkWindowDays} days |`);
      L.push(`| Reverts | ${contrib.quality.reverts} |`);
    }
    if (health) L.push(`| Documentation | ${health.blockingCount} blocking finding(s) at end of day |`);
    L.push('');

    // Items named by the day's commits. This is the link between the work and the plan, and it is only
    // populated because the commit gate now requires a shipped change to name one.
    const ids = [...new Set(commits.flatMap((c) => [...String(c.subject || '').matchAll(/\b([A-Z]{1,2}-\d{1,3})\b/g)].map((m) => m[1])))];
    const known = new Map((plan?.items || []).map((i) => [i.id, i]));
    const named = ids.filter((id) => known.has(id));
    L.push('## Plan items advanced');
    L.push('');
    if (named.length) {
      for (const id of named) L.push(`- **${id}** ${known.get(id).title} — ${known.get(id).percent ?? 0}%`);
    } else {
      L.push('_None named. Work that names no item is work the plan cannot see._');
    }
    L.push('');

    L.push('## Commits');
    L.push('');
    for (const c of commits) L.push(`- \`${c.hash?.slice(0, 7) || '???????'}\` ${c.subject}`);
  }

  L.push('');
  L.push('---');
  L.push('');
  L.push('_Not recorded here: prompt text, prompt quality, or difficulty. A transcript records what happened');
  L.push('after a prompt, not whether the prompt was well judged, and a turn on a hard problem and a turn on');
  L.push('a typo count the same._');
  L.push('');
  return L.join('\n');
}

/**
 * A filename-safe slug for a contributor, from the same identity the rest of the analysis groups by.
 *
 * The display name, not the email: `worklog/2026-08-10/hi-at-example-com.md` helps nobody. Collisions are
 * possible and are the caller's problem to notice — `atlas contrib` groups by email and would show two
 * people, which is where a collision is visible and meaningful.
 */
export function contributorSlug(identity) {
  const name = String(identity || '').split('<')[0].trim() || 'unknown';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Write the day's entry. Returns the path written, or `null` when the log is switched off.
 *
 * One file per contributor per day, not one file per day. `worklog/YYYY-MM-DD/log.md` was a single file the
 * whole repository shared: two people working the same day overwrote each other, and in git they collided on
 * every line. The date stays the directory because "what happened on Tuesday" is the question a work log is
 * read to answer; the contributor is the filename, so nobody contends.
 *
 * A log written before this change stays where it is. Migrating it would rewrite history that was true when
 * it was written, and the old file is a legitimate record of a day when one person worked.
 */
export function writeDay(root, cfg, entry, day, identity) {
  if (cfg.worklog?.enabled === false) return null;
  const dir = path.join(root, cfg.worklog?.dir || 'worklog', day);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${contributorSlug(identity)}.md`);
  fs.writeFileSync(file, entry, 'utf8');
  return file;
}
