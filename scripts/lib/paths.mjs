/**
 * project-atlas · path containment
 *
 * One question, asked in four places and previously answered four different ways: **is this path inside that
 * directory?**
 *
 * Getting it wrong was not theoretical. `renderSite` passed a configured `output` straight to a recursive
 * `rmSync`, so `{"output":"../PRECIOUS"}` deleted a directory outside the repository and `{"output":"."}`
 * deleted the repository including `.git` — and reported success. `assertNotPublishable`, the single mechanism
 * keeping session-transcript data out of a published wiki, compared strings with `startsWith`, which
 * `DOCS/_WIKI/t.txt` walks straight past on a case-insensitive filesystem.
 *
 * Two rules, both learned from those:
 *
 *  1. **Compare real paths, on both sides.** A lexical comparison is defeated by a symlink, and resolving only
 *     one side breaks on macOS, where `/tmp` is itself a symlink to `/private/tmp` — the two sides must be
 *     normalised the same way or every temp-directory check reports a false escape.
 *  2. **Compare the way the filesystem compares.** darwin and win32 are case-insensitive by default, so a
 *     case-sensitive check there is a check that can be walked around by holding down shift.
 */

import fs from 'node:fs';
import path from 'node:path';

/** How the host filesystem compares names. Not a guess about the volume — the platform default, which is what
 *  an attacker gets for free. A case-sensitive volume on darwin only makes this check stricter, never looser. */
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

const fold = (p) => (CASE_INSENSITIVE ? p.toLowerCase() : p);

/**
 * `fs.realpathSync` for a path that may not exist yet: resolve the longest existing ancestor and re-attach the
 * rest. Without this, containment could only be checked for paths already on disk — which is the wrong half,
 * since the dangerous case is a path about to be created or deleted.
 *
 * ## A dangling symlink is a resolvable path, and treating it as an unresolved one was a hole
 *
 * "Longest **existing** ancestor" was measured with `realpathSync`, which throws ENOENT for a symlink whose
 * target does not exist. So a final component that was a dangling symlink resolved to *itself* — the link's own
 * lexical path — and every caller then compared the wrong path. Both guards built on this were walked past,
 * with the write landing exactly where the guard exists to prevent:
 *
 *  - `confine(root, 'docs/evil.txt')` returned a path "inside the repository" for a link pointing at
 *    `~/.ssh/authorized_keys`, and the subsequent write created that file outside the repository.
 *  - `assertNotPublishable(root, cfg, 'report.txt')` allowed a link whose target was `docs/_wiki/leak.txt`, and
 *    the transcript-derived report landed in the directory that is force-pushed to Pages. Its own comment
 *    names "a symlink whose target is inside the output directory" as the case it exists to catch.
 *
 * The link is not missing information: `readlink` answers even when the target does not exist, and that answer
 * is where the bytes will go, which is the only thing containment is asking about. So a dangling link is
 * followed by hand and the walk restarts at the target. `seen` bounds a symlink cycle, which `readlink` would
 * otherwise follow forever; a cycle resolves to nothing writable, so returning the lexical path is safe there.
 *
 * This strictly *adds* resolution — it can turn "inside" into "outside", never the reverse — so no containment
 * check that held before holds less now.
 */
export function realpathOrBest(p) {
  let abs = path.resolve(p);
  const tail = [];
  const seen = new Set();
  for (;;) {
    try { return path.join(fs.realpathSync(abs), ...tail); } catch { /* does not exist yet, or dangles */ }

    let target = null;
    try { if (fs.lstatSync(abs).isSymbolicLink()) target = fs.readlinkSync(abs); } catch { /* not a link */ }
    if (target !== null && !seen.has(abs)) {
      seen.add(abs);
      abs = path.resolve(path.dirname(abs), target);
      continue;
    }

    const parent = path.dirname(abs);
    if (parent === abs) return path.resolve(p);      // reached the filesystem root without resolving anything
    tail.unshift(path.basename(abs));
    abs = parent;
  }
}

/**
 * Is `target` strictly inside `dir`? `dir` itself is NOT inside `dir`: every caller here is protecting a
 * directory from something written into or deleted from it, and "the whole thing" is precisely the case that
 * has to be refused.
 */
export function isInside(dir, target) {
  const d = fold(realpathOrBest(dir));
  const t = fold(realpathOrBest(target));
  if (t === d) return false;
  const rel = path.relative(d, t);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** `isInside`, but the directory itself also counts. For "may this path be deleted", see `isInside`. */
export function isAtOrInside(dir, target) {
  return fold(realpathOrBest(dir)) === fold(realpathOrBest(target)) || isInside(dir, target);
}

/**
 * Resolve a configured path against the repository root and refuse anything that escapes it — including the
 * root itself, and including an escape that only exists once symlinks are followed.
 *
 * `what` names the configuration key in the error, because the person reading it is looking at a config file,
 * not at this function.
 */
export function confine(root, p, what, configPath = null) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error(`${what} must be a non-empty string${where(configPath)}.`);
  }
  const abs = path.resolve(root, p);
  if (!isInside(root, abs)) {
    throw new Error(
      `${what} is ${JSON.stringify(p)}, which resolves to ${abs} — outside the repository at ${root}${where(configPath)}.\n` +
      `  A path here is written to, and in the case of the output directory deleted first. It must stay inside the repository.`);
  }
  return abs;
}

const where = (configPath) => (configPath ? ` (set in ${configPath})` : '');
