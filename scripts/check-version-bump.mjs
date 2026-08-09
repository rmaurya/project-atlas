#!/usr/bin/env node
/**
 * project-atlas · CI gate — a runtime change bumps the version
 *
 * Why this exists at all is in `scripts/lib/release.mjs`. This file is only the part that has to touch git:
 * work out what to compare against, read the manifest on both sides, and hand the decision to `versionVerdict`.
 *
 *   node scripts/check-version-bump.mjs                  infer the base from the CI event
 *   node scripts/check-version-bump.mjs --base main      compare against a ref explicitly
 *
 * Base resolution, in order: `--base`, then `GITHUB_BASE_REF` (pull request), then `.before` from the push
 * event payload, then `HEAD~1`.
 *
 * **It runs on push as well as on pull requests, and that is deliberate.** The commit that motivated this gate
 * went straight to `main` without one, so a gate that only sees pull requests would not have caught the very
 * thing it is named after.
 *
 * **If the base cannot be resolved, this exits 1.** Exiting 0 would paint the check green while it evaluated
 * nothing, which is the exact shape of the bug it is here to prevent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { versionVerdict } from './lib/release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = '.claude-plugin/plugin.json';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** `git show <ref>:<path>`, or `null` when the file did not exist there. Absent is a valid state, not an error. */
function manifestAt(ref) {
  try { return JSON.parse(git('show', `${ref}:${MANIFEST}`)); }
  catch { return null; }
}

function resolveBase() {
  const i = process.argv.indexOf('--base');
  if (i !== -1 && process.argv[i + 1]) return { ref: process.argv[i + 1], how: 'passed with --base' };

  // Pull request: GitHub checks out a merge commit, and the target branch is only present as a remote ref.
  if (process.env.GITHUB_BASE_REF) return { ref: `origin/${process.env.GITHUB_BASE_REF}`, how: 'the pull request base' };

  // Push: the payload carries the tip the branch was at beforehand. All zeros means the branch is new.
  const payloadPath = process.env.GITHUB_EVENT_PATH;
  if (payloadPath && fs.existsSync(payloadPath)) {
    try {
      const before = JSON.parse(fs.readFileSync(payloadPath, 'utf8')).before;
      if (before && !/^0+$/.test(before)) return { ref: before, how: 'the commit this push moved from' };
    } catch { /* fall through to HEAD~1 — a malformed payload is not worth guessing at */ }
  }

  return { ref: 'HEAD~1', how: 'the previous commit' };
}

const { ref, how } = resolveBase();

let base;
try { base = git('rev-parse', '--verify', `${ref}^{commit}`); }
catch {
  console.error(`Could not resolve ${JSON.stringify(ref)} (${how}), so nothing was compared and this check did NOT run.`);
  console.error('  In CI, check that the checkout has full history (fetch-depth: 0). Otherwise pass --base <ref>.');
  process.exit(1);
}

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const after = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8')).version;
const beforeManifest = manifestAt(base);

const verdict = versionVerdict({ changed, before: beforeManifest ? beforeManifest.version : null, after });

console.log(`Comparing against ${base.slice(0, 7)} (${how}) — ${changed.length} file(s) changed.`);

if (!verdict.ok) {
  console.error(`\n${verdict.message}\n`);
  process.exit(1);
}

console.log(verdict.message);
