/**
 * project-atlas · what the automatic rebuild costs, said out loud
 *
 * `buildOnWrite` rebuilds the site after every markdown write, and the hook that does it carries a number in
 * its own comment: *"roughly half a second on a 27-document corpus."* Measured on 2026-08-16 against a
 * 411-document corpus — 76,853 lines, 458 links, 2,045 citations — **one rebuild took 36.8 seconds**, and one
 * ran after every markdown write in the session. The hook was behaving exactly as designed. What was wrong is
 * that the design had a corpus-size assumption baked into it that nothing checked and nothing restated as the
 * corpus grew, so the cost was invisible right up to the point where it was a complaint.
 *
 * **A tool that measures a repository's health should measure its own.** So every build times itself and says
 * how long it took, and the automatic rebuild — the one nobody asked for and nobody is watching — says it on
 * stderr, where it reaches the session rather than a terminal no one is reading.
 *
 * Two rules keep that from becoming a nag of its own:
 *
 *  1. **Only when it is worth saying.** Under `NOTICE_AT_MS` the number is in the ordinary build summary and
 *     nowhere else. Half a second is not news.
 *  2. **Not on every write.** The full sentence — the cost, and the switch that turns it off — is repeated at
 *     most once every `NOTICE_EVERY_MS` per repository. A message printed after every edit is a message people
 *     learn to scroll past, which costs it the one moment it needed to be read.
 *
 * **Nothing here turns anything off by itself.** `buildOnWriteMaxSeconds` exists for someone who decides the
 * trade is not worth it, is unset by default, and when it does skip a build it says the site is now older than
 * the markdown. A derived surface that quietly stopped refreshing is precisely the failure this whole tool
 * exists to detect; it is not one this tool gets to introduce, however expensive the alternative.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Beside the lock and the owner record, and gitignored for the same reason they are: it describes what one
 * machine measured a moment ago, which is churn rather than record.
 */
export const COST_FILE = path.join('.atlas', 'build.cost.json');

/** Under this, a build is fast enough that saying so is noise. */
export const NOTICE_AT_MS = 5000;

/** How often the automatic rebuild repeats the full sentence in one repository. */
export const NOTICE_EVERY_MS = 30 * 60 * 1000;

/** The last build's cost, or `null` — never a guess. An unreadable record means "not measured". */
export function readCost(root) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, COST_FILE), 'utf8'));
    return Number.isFinite(c?.ms) && c.ms >= 0 ? c : null;
  } catch { return null; }
}

/**
 * Record what this build cost. Failure is swallowed: the measurement is a courtesy, and a build that failed
 * because it could not write down how long it took would be a worse tool than one that says nothing.
 */
export function noteCost(root, cost) {
  try {
    fs.mkdirSync(path.join(root, path.dirname(COST_FILE)), { recursive: true });
    fs.writeFileSync(path.join(root, COST_FILE), JSON.stringify(cost) + '\n', 'utf8');
  } catch { /* unwritable, like the lock beside it — costs a message, never a build */ }
  return cost;
}

/** `36.8s`, `1m 04s`, `840ms` — whichever reads as a duration a person can weigh. */
export function duration(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

/**
 * What the automatic rebuild should say about what it just cost, or `null`.
 *
 * `now` and `last` are passed in rather than read, so the rate limit is testable without waiting half an hour.
 */
export function costNotice(ms, { now = Date.now(), lastNoticedAt = null, configPath = 'project-atlas.config.json' } = {}) {
  if (!Number.isFinite(ms) || ms < NOTICE_AT_MS) return null;
  const repeat = Number.isFinite(lastNoticedAt) && now - lastNoticedAt < NOTICE_EVERY_MS;
  if (repeat) return null;
  return `project-atlas: that rebuild took ${duration(ms)}, and one runs after every markdown write. ` +
    `Set "automation": { "buildOnWrite": false } in ${configPath} to stop them — \`atlas build\` still runs ` +
    `on demand — or "buildOnWriteMaxSeconds" to skip the automatic one once it costs more than you want to pay.`;
}

/**
 * Should the automatic rebuild be skipped, and what does the session need to be told if so?
 *
 * Reads the **last** build's cost, because the only honest way to know what this one will cost is what the
 * last one did, and the alternative — start it and give up partway — leaves a half-written directory.
 *
 * Unset is the default and means never skip. A budget of zero means every automatic build is skipped, which is
 * a strange thing to want and a legitimate thing to say; it is `buildOnWrite: false` written the long way, and
 * refusing to honour it would be second-guessing a number the user typed.
 */
export function budgetSkip(cfg, cost) {
  const seconds = cfg?.automation?.buildOnWriteMaxSeconds;
  if (!Number.isFinite(seconds)) return null;
  if (!cost || !Number.isFinite(cost.ms)) return null;   // never measured here — not a reason to skip
  if (cost.ms <= seconds * 1000) return null;
  return `project-atlas: skipped the automatic rebuild — the last build here took ${duration(cost.ms)}, over ` +
    `the ${seconds}s budget in automation.buildOnWriteMaxSeconds. The site is now older than the markdown — ` +
    `run \`atlas build\` when you want it current.`;
}
