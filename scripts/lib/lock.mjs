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
 */

import fs from 'node:fs';
import path from 'node:path';

export const LOCK_FILE = path.join('.atlas', 'build.lock');

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

/**
 * Take the lock, or say why not.
 *
 * Returns `{ ok, release, waited, stole }`. `release()` is always safe to call and never throws — it runs
 * in a finally, and a release that could fail would turn a successful build into a wedged directory.
 */
export function acquire(root, { waitMs = WAIT_MS, now = () => Date.now() } = {}) {
  const file = path.join(root, LOCK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const start = now();
  let stole = false;

  for (;;) {
    const held = read(file);
    const fresh = held && alive(held.pid) && (now() - (held.at || 0)) < STALE_AFTER_MS;

    if (!held || !fresh) {
      if (held) stole = true;         // an owner that died, or one that has been holding it implausibly long
      try {
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now() }), 'utf8');
      } catch {
        // An unwritable lock directory must not stop a build. Proceeding unlocked is the same behaviour the
        // tool had before locks existed, which is worse than serialised but far better than refusing.
        return { ok: true, release: () => {}, waited: now() - start, stole, unlocked: true };
      }
      return {
        ok: true,
        waited: now() - start,
        stole,
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
