/**
 * project-atlas · the plan records that work started, without anyone remembering to
 *
 * Every other figure this tool reports is derived. The plan's completion column is the exception: it is
 * typed by hand, and the evidence that this does not work is in the plan's own header — it went stale for
 * thirty-five commits, was rewritten, and went stale again inside one session. The same failure recurred
 * while Track 6 was being built: an item was worked on for an hour while the table read 0%, and two others
 * were marked only because someone complained that the dashboard showed nothing in progress.
 *
 * An agent that forgets is not an unusual agent. It is the normal case. So "mark it in progress" moves out
 * of prose nobody re-reads and into the tool.
 *
 * ## Why this is allowed to write to the plan
 *
 * Autonomy in this project never rewrites prose, because a machine can see that a commit happened but not
 * that a sentence was meant. **A percentage cell is not prose.** It is a figure the tool already parses,
 * in a table whose format it defines, and rewriting one cell is deterministic and reversible. The rule the
 * boundary actually draws is *never author, never publish, never touch what a person wrote for a reader* —
 * and a number in a status column is none of those.
 *
 * What this will not do, deliberately:
 *
 *   - **Never move a figure down.** Progress is a claim a person made; contradicting it is not a machine's
 *     job. A cell already at 60 stays at 60 when work resumes.
 *   - **Never mark anything complete.** Done is a judgement — tests pass, the thing works, someone looked.
 *     Starting can be observed; finishing cannot.
 *   - **Never touch an item's description.** One cell in one table, matched by the plan's own pattern.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PLANNING } from './planning.mjs';

/**
 * The figure written when work is observed to start.
 *
 * Deliberately small. It says "somebody has begun" and nothing about how far along the work is — a tool
 * that guessed 50% would be inventing a measurement, which is the one thing this project refuses
 * everywhere else.
 */
export const STARTED_PERCENT = 10;

/**
 * Set an item's completion figure in the plan source.
 *
 * Returns `{ changed, from, to, reason }` — never throws for the ordinary cases, because callers are hooks
 * and a hook that throws at the start of a session is worse than one that does nothing.
 */
export function setItemPercent(root, cfg, id, percent, { allowDecrease = false } = {}) {
  const p = { ...DEFAULT_PLANNING, ...(cfg.planning || {}) };
  if (!p.source) return { changed: false, reason: 'no planning source configured' };

  const file = path.resolve(root, p.source);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return { changed: false, reason: `cannot read ${p.source}` }; }

  const re = new RegExp(p.percentCellPattern, 'g');
  let found = null;
  let out = src.replace(re, (whole, cellId, value, estimated) => {
    if (cellId !== id) return whole;
    const from = Number(value);
    found = from;
    if (!allowDecrease && percent <= from) return whole;   // never move a figure backwards
    // **Anchored past the id, not at the first digits in the match.** The obvious `whole.replace(/\d{1,3}/)`
    // rewrites the digits in the *identifier* — `| A-13 | 0 |` became `| A-10 | 0 |`, silently renaming an
    // item to one that already existed and producing two rows with the same id. It survived exactly one
    // manual test because every id tried before it was single-digit. Emphasis and the estimate marker are
    // preserved by matching them rather than rebuilding the cell: a dropped `*` would turn an estimate into
    // a measurement, which is the distinction this tool exists to keep.
    const anchored = new RegExp(`(${cellId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*(?:\\*\\*)?)\\d{1,3}`);
    return whole.replace(anchored, (_m, prefix) => prefix + String(percent));
  });

  if (found === null) return { changed: false, reason: `${id} has no row in ${p.source}` };
  if (out === src) return { changed: false, from: found, reason: `${id} is at ${found}%, already at or past ${percent}%` };

  fs.writeFileSync(file, out, 'utf8');
  return { changed: true, from: found, to: percent, source: p.source };
}

/**
 * The item a branch is about.
 *
 * Read from the branch name, because that is the one place the information already exists at the moment
 * work starts — `feat/a-13-plan-marks-itself` names its item, and a convention already used by hand costs
 * nobody anything to formalise. An explicit id always wins; nothing is inferred from a branch that does not
 * carry one, because guessing which item someone meant is how the wrong row gets marked.
 */
export function itemFromBranch(branch, items = []) {
  if (!branch) return null;
  const known = new Set(items.map((i) => i.id.toUpperCase()));
  for (const m of String(branch).matchAll(/\b([A-Za-z]+-\d+)\b/g)) {
    const id = m[1].toUpperCase();
    if (known.has(id)) return id;
  }
  return null;
}

/**
 * Does a commit contradict the plan?
 *
 * The spec gate already refuses a commit that names no item. This catches the opposite arrangement, which
 * it cannot see today: a commit that names an item the plan still records as never started. That is not a
 * style violation — it means the dashboard has been reporting "nothing in progress" while the work was
 * being done, which is precisely the thing this tool exists to detect happening to itself.
 */
export function contradictsPlan(namedIds, items) {
  const by = new Map(items.map((i) => [i.id, i]));
  return namedIds
    .map((id) => by.get(id))
    .filter((i) => i && (i.percent ?? 0) === 0)
    .map((i) => i.id);
}
