/**
 * project-atlas · one build at a time
 *
 * A build clears its output directory completely and then repopulates it. That was safe while builds only
 * happened when somebody asked for one. A-8 made a watcher always run, so two builds overlapping is now the
 * normal case rather than an unlucky one — and the overlap is not benign: whichever build looks at the
 * directory mid-clear sees content but none of the markers a build leaves behind, and refuses.
 *
 * **The guard is right to refuse.** It cannot tell a half-written build from a directory holding someone's
 * real files, and guessing wrong deletes work. So the fix is not to weaken it but to stop the two builds
 * overlapping at all.
 *
 * ## Why the lock can be stolen
 *
 * A process killed mid-build leaves its lock behind, and a lock that can only be released by the process
 * that took it is a lock that eventually wedges the tool permanently — the worst outcome here, because the
 * thing being protected is regenerable output. So a lock is honoured only while its owner is alive and its
 * age is plausible; past either, it is stolen and said to have been stolen. A stale lock must never be able
 * to stop a build forever.
 *
 * ## Why the lock also records *which build* took it
 *
 * Serialising builds is the right fix for two copies of the same build. It is no fix at all for two
 * **different** builds: an installed plugin's watcher and a developer's working copy both take the lock
 * legitimately, take turns politely, and overwrite each other's output. That failure is silent and it lies —
 * a fix appears not to work, three times in a row, because the older installed build rebuilt over it seconds
 * later. So each acquisition writes down which build it was, the record outlives the lock, and a build that
 * finds a different one there says so.
 *
 * It says so and then builds anyway. Which of the two should win is the user's call: refusing would break the
 * one case this most needs to support, someone deliberately testing a working copy against a real repository.
 */

import fs from 'node:fs';
import path from 'node:path';

export const LOCK_FILE = path.join('.atlas', 'build.lock');

/**
 * Which build last held the lock. Kept beside the lock and deliberately **not** deleted on release: the lock
 * answers "is a build running here", and this answers "which build built here last" — a question that only
 * has an answer once the lock is gone, which is exactly when the two builds are taking turns.
 */
export const OWNER_FILE = path.join('.atlas', 'build.owner.json');

/** Longer than any real build, short enough that a wedged lock is a nuisance rather than an outage. */
export const STALE_AFTER_MS = 60_000;

/** How long a waiter tries before giving up. A build that waits forever is a hang, not a queue. */
export const WAIT_MS = 10_000;

const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const same = (a, b) => (a || 'unknown') === (b || 'unknown');

/**
 * Write down the build taking the lock, and return the previous one when it was a *different* build.
 *
 * The identity is passed in rather than computed here. It belongs to the executing copy of atlas — its
 * version and where it lives — and atlas.mjs already works that out for the About page; importing atlas.mjs
 * from a leaf module to get at it would buy one function at the price of a cycle.
 *
 * A caller that does not identify itself gets exactly the old behaviour. Recording an anonymous holder would
 * mean the next real build compares itself against "unknown" and cries conflict at nobody.
 */
function noteHolder(root, build, now) {
  if (!build || !build.path) return null;
  const file = path.join(root, OWNER_FILE);
  const prev = read(file);
  try {
    fs.writeFileSync(file, JSON.stringify({ version: build.version || 'unknown', path: build.path, at: now() }), 'utf8');
  } catch {
    // Unwritable, for the same reasons the lock itself can be — and with the same answer. Losing the record
    // costs a warning; refusing the build costs the build.
  }
  if (!prev || !prev.path) return null;
  if (same(prev.version, build.version) && prev.path === build.path) return null;
  return { version: prev.version || 'unknown', path: prev.path, at: prev.at || null };
}

/**
 * The sentence a person can act on. One line, both builds named, and the thing they are fighting over — a
 * warning that says only "another build was here" sends the reader looking for a bug in their own change,
 * which is the hour this exists to save.
 */
export function foreignBuildWarning(previous, build, outDir) {
  return `project-atlas: two different builds are writing the same output directory ${outDir} — this build is ` +
    `${build.version || 'unknown'} at ${build.path} and the last build here was ${previous.version} at ` +
    `${previous.path}, so they overwrite each other's output and whichever runs last silently wins; ` +
    `stop the one you are not testing.`;
}

/**
 * Take the lock, or say why not.
 *
 * Returns `{ ok, release, waited, stole, foreign }`. `release()` is always safe to call and never throws — it
 * runs in a finally, and a release that could fail would turn a successful build into a wedged directory.
 *
 * `foreign` is the previously recorded holder when it was a different build, and it is reported, never acted
 * on: see the note on identity at the top of this file.
 */
export function acquire(root, { waitMs = WAIT_MS, now = () => Date.now(), build = null } = {}) {
  const file = path.join(root, LOCK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const start = now();
  let stole = false;

  for (;;) {
    const held = read(file);
    const fresh = held && alive(held.pid) && (now() - (held.at || 0)) < STALE_AFTER_MS;

    if (!held || !fresh) {
      if (held) stole = true;         // an owner that died, or one that has been holding it implausibly long
      const foreign = noteHolder(root, build, now);
      try {
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now() }), 'utf8');
      } catch {
        // An unwritable lock directory must not stop a build. Proceeding unlocked is the same behaviour the
        // tool had before locks existed, which is worse than serialised but far better than refusing.
        return { ok: true, release: () => {}, waited: now() - start, stole, foreign, unlocked: true };
      }
      return {
        ok: true,
        waited: now() - start,
        stole,
        foreign,
        release: () => { try { const m = read(file); if (!m || m.pid === process.pid) fs.unlinkSync(file); } catch {} },
      };
    }

    if (now() - start >= waitMs) {
      return { ok: false, waited: now() - start, heldBy: held.pid, release: () => {} };
    }
    // Busy-wait deliberately: this is a short, rare contention between two local processes, and pulling in
    // an async wait would make every caller of doBuild async for it.
    const until = now() + 50;
    while (now() < until) { /* spin */ }
  }
}
