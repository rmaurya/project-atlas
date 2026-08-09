/**
 * project-atlas · the release marker
 *
 * `/plugin` compares exactly one string: `version` in `.claude-plugin/plugin.json`. It does not consult the
 * commit SHA it recorded at install time. So a release whose code changed but whose version did not is not a
 * release at all — the updater answers "already at the latest version", fetches nothing, and every installed
 * copy stays on the old code while reporting itself current.
 *
 * This is not hypothetical, and it happened here. `7573809` rewrote every file in `scripts/lib/`, added two
 * more, and left the version at `0.1.0`. The fixes it carried — an `output` setting that deleted the
 * repository including `.git`, a `</script>` that escaped the inlined search index — reached nobody, and
 * `/plugin` called that success.
 *
 * A check that cannot fail is worse than no check, because it reports success. That is the failure class this
 * project exists to detect, so it does not get to live in this project's own delivery path. Hence one
 * mechanical rule, enforced in CI: **if a shipped file changed, the version changed.**
 *
 * The logic here is pure — it takes a list of changed paths and two version strings. Resolving those from git
 * is `scripts/check-version-bump.mjs`, so the decision can be tested without building a repository per case.
 */

import { globToRegExp } from './config.mjs';

/**
 * What "shipped" means: the files an installed plugin actually executes or reads.
 *
 * `plugins/**` is the generated Codex copy — derived from `skills/`, but committed and installed from, so a
 * change there reaches users exactly like a change to the original. `.claude-plugin/**` is the manifest itself;
 * editing it without a bump ships a new description under an old version, which is the same lie in miniature.
 *
 * Deliberately absent: `tests/**`, `references/**`, `docs/**`, `.github/**`, and the root markdown. None of
 * them is installed, and requiring a version bump to fix a typo in CONTRIBUTING would train everyone to bump
 * without meaning it — which costs the signal its entire value.
 */
export const RUNTIME_GLOBS = [
  'scripts/**',
  'bin/**',
  'skills/**',
  'hooks/**',
  'plugins/**',
  '.claude-plugin/**',
];

const compiled = new WeakMap();

/** Does this repository-relative path ship? */
export function isRuntimePath(p, globs = RUNTIME_GLOBS) {
  if (!compiled.has(globs)) compiled.set(globs, globs.map(globToRegExp));
  const norm = String(p).replace(/^\.\//, '');
  return compiled.get(globs).some((re) => re.test(norm));
}

/**
 * Parse `major.minor.patch`, ignoring any `-prerelease` or `+build` suffix for ordering purposes.
 *
 * Returns `null` rather than throwing or coercing: an unparseable version is a real answer here, and the
 * caller refuses on it. Treating a malformed version as `0.0.0` would silently pass a bump from `garbage` to
 * `also-garbage`.
 */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0, 1 — or `null` if either side is unparseable, which the caller must handle rather than ignore. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * The verdict.
 *
 * `before` may be `null`, meaning the manifest did not exist at the base commit — a plugin being introduced.
 * Any parseable version counts as a bump in that case, because there is nothing installed to be stale against.
 *
 * The message names the files, not just the count. A gate that says "3 files changed" sends you to run the
 * diff yourself; one that names them is one you can act on from the CI log.
 */
export function versionVerdict({ changed = [], before, after }) {
  const runtime = changed.filter((p) => isRuntimePath(p)).sort();

  if (!runtime.length) {
    return { ok: true, runtime, message: 'No shipped file changed — the version does not need to move.' };
  }

  const shown = runtime.slice(0, 10);
  const rest = runtime.length - shown.length;
  const list = '  ' + shown.join('\n  ') + (rest > 0 ? `\n  … and ${rest} more` : '');

  if (!parseVersion(after)) {
    return {
      ok: false, runtime,
      message: `${runtime.length} shipped file(s) changed, and the version ${JSON.stringify(after ?? null)} is not major.minor.patch.\n${list}`,
    };
  }

  if (before === null || before === undefined) {
    return { ok: true, runtime, message: `New plugin manifest at version ${after}.` };
  }

  const cmp = compareVersions(before, after);

  if (cmp === null) {
    return {
      ok: false, runtime,
      message: `${runtime.length} shipped file(s) changed, and the previous version ${JSON.stringify(before)} cannot be compared to ${JSON.stringify(after)}.\n${list}`,
    };
  }

  if (cmp === 0) {
    return {
      ok: false, runtime,
      message:
        `${runtime.length} shipped file(s) changed, but the version is still ${after}.\n${list}\n\n` +
        `  Every installed copy compares version strings alone. Shipping this as ${after} means /plugin\n` +
        `  answers "already at the latest version" and fetches none of it.\n\n` +
        `  Bump "version" in .claude-plugin/plugin.json, then: node scripts/sync-runtimes.mjs`,
    };
  }

  if (cmp > 0) {
    return {
      ok: false, runtime,
      message: `The version went backwards: ${before} → ${after}. An installed ${before} would never see ${after} as an update.`,
    };
  }

  return { ok: true, runtime, message: `${runtime.length} shipped file(s) changed, and the version moved ${before} → ${after}.` };
}
