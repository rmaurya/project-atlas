/**
 * project-atlas · the update check, and the promise it has to keep
 *
 * `SECURITY.md` says this tool makes one network request, from `atlas caps`, and names it. This adds a second,
 * so the same standard applies: it is named, it is bounded, it is cached, and it can be turned off without
 * editing anything that ships.
 *
 * The rules it holds to:
 *
 *   - **At most once every 24 hours.** The result is cached outside the repository, so a check never appears
 *     in anyone's diff.
 *   - **A failure is cached too.** Otherwise an offline machine retries on every single session start, which
 *     is worse than the staleness it was trying to report.
 *   - **Two seconds, then give up.** A session must never wait on this. A slow answer is no answer.
 *   - **Silent on failure.** Not knowing whether an update exists is the normal case, not an incident. The one
 *     thing it must never do is claim you are current when it could not find out — so `latest` stays `null`
 *     and `atlas version` prints "not checked" rather than a reassuring tick.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 86400000;
const TIMEOUT_MS = 2000;

/** Outside the repository, always. A tool that writes its own state into your project has made it your problem. */
export function cachePath() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'project-atlas', 'update-check.json');
}

export function readCache(file = cachePath()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeCache(entry, file = cachePath()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry), 'utf8');
  } catch { /* an unwritable cache directory means we re-check tomorrow, which is not worth reporting */ }
}

/** -1, 0, 1 — or null when either side is unparseable. Local to this module so the cache logic has no imports. */
function cmpVersions(a, b) {
  const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
  const [x, y] = [p(a), p(b)];
  if (x.length !== 3 || y.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** `YYYY-MM-DD` in the machine's own timezone, which is the only one the person reading it lives in. */
export function localDate(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Is a cached answer still good? `now` is passed in so this is testable without waiting a day. */
export function isFresh(entry, now, maxAgeMs = DAY) {
  return !!entry && typeof entry.at === 'number' && now - entry.at < maxAgeMs;
}

/**
 * Where the manifest lives, derived from the `repository` field rather than hardcoded — a fork should check
 * itself, not this repository.
 *
 * Only github.com is supported, and an unrecognised host returns `null` rather than a guessed URL: silently
 * fetching from somewhere the user did not point at is worse than not checking.
 */
export function manifestUrl(repository, branch = 'main') {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)/.exec(String(repository || ''));
  if (!m) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${branch}/.claude-plugin/plugin.json`;
}

/**
 * The published version, or `null`. Never throws — every failure path is a `null`, because no caller of this
 * has anything useful to do with an exception and all of them are running somewhere that must not break.
 */
export async function fetchLatest(url, { timeoutMs = TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!url || typeof fetchImpl !== 'function') return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, redirect: 'follow' });
    if (!res || !res.ok) return null;
    const body = JSON.parse(await res.text());
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;                    // offline, DNS, timeout, rate limit, malformed JSON — all the same answer
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The cached check. Returns `{ latest, checkedAt, fromCache }`; `latest` is `null` when unknown.
 *
 * `force` skips the cache for an explicit `atlas version --check`, where the user is asking on purpose and a
 * day-old answer is not what they wanted.
 */
export async function checkForUpdate({ repository, force = false, now = null, file = cachePath(), fetchImpl, installed = null } = {}) {
  const t = now ?? new Date().getTime();
  const cached = readCache(file);

  // **A cache the installed version has overtaken is provably wrong.**
  //
  // The 24-hour window assumes releases are rarer than a day. This project shipped twenty-six versions in
  // one, and the consequence was silence exactly when the notice mattered: the cache held 0.1.3, the install
  // was 0.1.10, the real latest was 0.1.26 — and because 0.1.10 is *newer* than the cached figure, the notice
  // concluded "ahead of the release, nothing to say" and never spoke.
  //
  // You cannot be ahead of the published version under normal use, so being ahead is free evidence that the
  // cached answer is stale. Refetch rather than trust it.
  const overtaken = installed && cached?.latest && cmpVersions(installed, cached.latest) === 1;

  if (!force && !overtaken && isFresh(cached, t)) {
    return { latest: cached.latest ?? null, checkedAt: cached.date || null, fromCache: true };
  }
  const latest = await fetchLatest(manifestUrl(repository), { fetchImpl });
  // Local date, not `toISOString`. UTC renders as yesterday for anyone east of Greenwich after their evening,
  // and "checked yesterday" on a check that just ran reads as a bug in the check.
  const date = localDate(t);
  writeCache({ at: t, date, latest }, file);       // a null result is cached too, so a failure is not retried
  return { latest, checkedAt: date, fromCache: false };
}
