/**
 * project-atlas · documents that are wrong rather than merely old
 *
 * Most documentation degrades gently: a stale architecture note is misleading, and a reader who knows the
 * code can tell. **An SOP degrades differently.** It tells somebody what to do, and they do it — so a
 * procedure that has drifted is not out of date, it is *incorrect instructions being followed*. The cost
 * lands on whoever trusted it, which is exactly the person least able to notice.
 *
 * That difference is why an SOP carries obligations no other document does: a named owner, a review
 * interval, and the date it was last verified. Those three turn "somebody should check this eventually"
 * into a fact the tool can check.
 *
 * ## Why two of the three signals block
 *
 * The catalogue's rule is that a signal blocks only when it has no legitimate cause.
 *
 *   - **H10 · past its review date — blocking.** The document itself declares the interval. Exceeding a
 *     deadline the document set for itself has no innocent explanation; it means nobody did the thing the
 *     document said was required.
 *   - **H12 · dead citation in an SOP — blocking.** A citation this tool cannot resolve is already H2. In
 *     an SOP it is worse: the step referring to it cannot be followed, so the procedure is broken rather
 *     than untidy.
 *   - **H11 · no live owner — advisory.** People leave, names are written inconsistently, and a repository
 *     with one contributor legitimately has an owner git has never seen. Blocking on it would refuse
 *     commits over a spelling.
 *
 * ## What this deliberately does not do
 *
 * It never edits the obligations. Bumping a `last-verified` date because a build ran would be the tool
 * asserting that a human verified something — a lie of exactly the kind the whole project exists to catch,
 * told in the one document where being wrong is most expensive.
 */

import fs from 'node:fs';
import path from 'node:path';

/** How an SOP is recognised when the config says nothing. */
export const DEFAULT_SOP_MATCH = ['**/sop/**', '**/SOP-*.md', '**/*-sop.md', '**/runbook*/**', '**/*-runbook.md'];

/** Assumed review interval, in days, for an SOP that names none. */
export const DEFAULT_REVIEW_DAYS = 180;

/**
 * The obligations declared in a document.
 *
 * Read from front matter or from a bolded key-value line near the top, because both spellings are in the
 * wild and refusing one would make adoption a rewrite. A field that is absent is absent — never defaulted
 * into looking present, because "no owner" and "owner unknown" are different statements.
 */
export function readObligations(body) {
  const head = String(body || '').slice(0, 4000);
  const pick = (names) => {
    for (const n of names) {
      const re = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${n}(?:\\*\\*)?\\s*[:=]\\s*([^\\n]+)`, 'i');
      const m = re.exec(head);
      if (m) return m[1].replace(/\*\*/g, '').trim();
    }
    return null;
  };

  const owner = pick(['owner', 'maintainer', 'responsible']);
  const verified = pick(['last[- _]?verified', 'last[- _]?reviewed', 'verified', 'reviewed']);
  const every = pick(['review[- _]?every', 'review[- _]?interval', 'reviewed[- _]?every', 'cadence']);

  return {
    owner: owner || null,
    lastVerified: verified ? parseDate(verified) : null,
    lastVerifiedRaw: verified,
    reviewDays: every ? parseInterval(every) : null,
    reviewRaw: every,
  };
}

/** `2026-08-11`, or a date any Date can parse. Unparseable is null — never today's date. */
export function parseDate(s) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(s));
  if (m) return m[1];
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** `90 days`, `6 months`, `1 year`, `quarterly`. Returns days, or null when it cannot be read. */
export function parseInterval(s) {
  const t = String(s).toLowerCase().trim();
  const named = { weekly: 7, fortnightly: 14, monthly: 30, quarterly: 91, biannually: 182, annually: 365, yearly: 365 };
  if (named[t]) return named[t];
  const m = /(\d+)\s*(day|week|month|quarter|year)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return { day: n, week: n * 7, month: n * 30, quarter: n * 91, year: n * 365 }[m[2]];
}

/** Whole days between two `YYYY-MM-DD` dates. */
export function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Evaluate one SOP against its own declared obligations.
 *
 * `today` is injected rather than read from the clock so a test can pin it — a signal that fires only on
 * certain days of the year is a signal nobody can write a test for.
 */
export function evaluate(doc, { today, owners = [], reviewDaysDefault = DEFAULT_REVIEW_DAYS } = {}) {
  const ob = readObligations(doc.body);
  const out = { path: doc.path, ...ob, findings: [] };

  // H10 — past the review date the document set for itself.
  const interval = ob.reviewDays ?? reviewDaysDefault;
  if (!ob.lastVerified) {
    out.findings.push({ id: 'H10', detail: ob.lastVerifiedRaw
      ? `last-verified reads "${ob.lastVerifiedRaw}", which is not a date that can be checked`
      : 'no last-verified date, so whether it has ever been checked is unknown' });
  } else {
    const age = daysBetween(ob.lastVerified, today);
    if (age !== null && age > interval) {
      out.findings.push({ id: 'H10',
        detail: `verified ${ob.lastVerified} (${age} days ago); its own interval is ${interval} days` });
    }
    out.ageDays = age;
  }

  // H11 — an owner nobody can be found for. Advisory: people leave, and names are spelled inconsistently.
  if (!ob.owner) {
    out.findings.push({ id: 'H11', detail: 'names no owner, so there is nobody the review falls to' });
  } else if (owners.length && !owners.some((o) => sameName(o, ob.owner))) {
    out.findings.push({ id: 'H11',
      detail: `owner "${ob.owner}" has no commits in this repository — they may have left, or the name may be spelled differently` });
  }

  return out;
}

/** Loose enough for "Ann Example" vs "ann example" vs "Ann Example <ann@x>", strict enough to be useful. */
function sameName(a, b) {
  const norm = (s) => String(s).split('<')[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
}
