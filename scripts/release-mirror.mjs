#!/usr/bin/env node
/**
 * project-atlas · the public distribution mirror
 *
 * The marketplace installs a plugin by cloning its repository, whole. There is no packaging manifest in
 * `plugin.json` and no `files` list anywhere, so before this script existed *distribution was the entire
 * working tree* — and `worklog/2026-08-10/log.md` was sitting in every installed copy, along with whatever
 * else happened to be committed. What is kept private and what is shipped were the same set.
 *
 * ## An allow-list, never a deny-list
 *
 * This is the load-bearing decision. A deny-list ships anything nobody remembered to exclude: add
 * `docs/handoff/<someone>/HANDOFF.md` and it goes out with the next release, silently. An allow-list fails
 * closed — a new path ships only when a person adds it here, and the failure mode of forgetting is a missing
 * file, which is loud, rather than a leaked one, which is not.
 *
 * ## Two audiences, two sets
 *
 * `SHIP` is what the plugin needs to run. `PUBLIC_DOCS` is what a user should read. They overlap but are not
 * the same: the reference guides are both, the roadmap is neither, and `AGENTS.md` ships because an assistant
 * loads it while staying off the wiki because it is instructions to a machine, not a manual for a person.
 *
 * ## What must never cross
 *
 * The plan, the analysis, the handoffs, the work logs, the design record for unbuilt features, and the test
 * suite. Those are how the work is made, not what is delivered.
 *
 *   node scripts/release-mirror.mjs --out <dir>   assemble the mirror
 *   node scripts/release-mirror.mjs --check       fail if anything outside the allow-list would ship
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The public distribution repository. The mirror's URLs must point here, not at the source. */
export const PUBLIC_REPO = 'rmaurya/atlas-plugin';

/**
 * Everything the installed plugin needs, and nothing else. Directories are taken whole; a trailing `/**`
 * is only for emphasis — the rule is that a listed directory ships and an unlisted path does not.
 */
export const SHIP = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'bin/atlas',
  'scripts/atlas.mjs',
  'scripts/sync-runtimes.mjs',
  'scripts/lib',            // the whole engine
  'skills',                 // the source of truth for both runtimes
  'plugins',                // the generated Codex package, which must travel with skills/
  'hooks',
  'install.sh',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'AGENTS.md',
  '.gitattributes',
  '.gitignore',
  '.gitmessage',            // CONTRIBUTING points at it, so it travels with CONTRIBUTING
  'plugin.json',            // the root marker Antigravity reads; without it that runtime sees no plugin
  '.agents/plugins/marketplace.json',
  'docs/references/adoption.md',
  'docs/references/authoring.md',
  'docs/references/branching.md',
  'docs/references/configuration.md',
  'docs/references/health-signals.md',
  'docs/references/maintenance.md',
  'docs/references/taxonomy.md',
];

/**
 * What belongs on the public wiki: a manual and a knowledgebase. Deliberately narrower than SHIP.
 *
 * `AGENTS.md` and every `SKILL.md` ship but are not here — they are instructions to an assistant, and a
 * reader looking for how to use the tool is not helped by the prompt that drives it. `CHANGELOG.md` is not
 * here either: this project's changelog is a defect record written for whoever maintains the code, naming
 * internal functions and the mistakes behind each fix. That is the right thing for a repository and the
 * wrong thing for a user manual.
 */
export const PUBLIC_DOCS = [
  'README.md',
  'docs/references/adoption.md',
  'docs/references/authoring.md',
  'docs/references/branching.md',
  'docs/references/configuration.md',
  'docs/references/health-signals.md',
  'docs/references/maintenance.md',
  'docs/references/taxonomy.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
];

/** Named so a reader can see the intent, and so `--check` can explain a refusal rather than just fail. */
export const NEVER_SHIP = [
  { path: 'worklog/', why: 'daily work logs are a record of how the work was made, per person' },
  { path: 'docs/handoff/', why: 'handoffs are working state, and the per-contributor ones are personal' },
  { path: 'docs/ROADMAP.md', why: 'the plan, including unbuilt work and internal reasoning' },
  { path: 'docs/ANALYSIS.md', why: 'internal analysis' },
  { path: 'docs/references/autonomy.md', why: 'a design document for features that do not exist yet' },
  { path: 'tests/', why: 'the suite proves the code; it is not part of it' },
  { path: '.atlas/', why: 'operational journal' },
  { path: '.claude/', why: 'local session configuration' },
  { path: '.github/', why: 'this repository\'s CI, not the plugin\'s' },
  { path: 'project-atlas.config.json', why: 'this repository\'s own tuning; the mirror gets a generated one' },
  { path: 'scripts/check-version-bump.mjs', why: 'a CI gate on this repository; the plugin never runs it' },
  { path: 'scripts/release-mirror.mjs', why: 'the packaging tool itself does not travel in the package' },
];

const listed = (rel) => SHIP.some((s) => rel === s || rel.startsWith(s.replace(/\/\*\*$/, '') + '/'));

/** Every tracked file, so the check is against what git would actually publish. */
function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

/** The mirror's own config: the same tool, pointed at the public repository and a public corpus. */
function mirrorConfig() {
  return {
    $schema: './project-atlas.schema.json',
    siteTitle: 'atlas',
    output: 'docs/_wiki',
    trackedOnly: true,
    // The corpus is the manual, not the source tree. Everything excluded here still *ships* — the plugin
    // cannot run without it — it simply is not documentation. `skills/` and `AGENTS.md` are instructions to
    // an assistant, `hooks/` and `scripts/` are the machinery, and a reader looking for how to use the tool
    // is not served by either. This is the difference between what a package contains and what a manual says.
    exclude: ['node_modules/**', '.git/**', '**/_wiki/**', 'LICENSE', 'plugins/**',
              'skills/**', 'hooks/**', 'scripts/**', 'bin/**', 'install.sh',
              'AGENTS.md', 'CHANGELOG.md', '.agents/**', '.claude-plugin/**'],
    clusters: [
      { id: 'start', title: 'Start here', blurb: 'What this is, and how to run it.', match: ['README.md'] },
      { id: 'guides', title: 'Guides', blurb: 'One topic each. Read the one your task calls for.',
        match: ['docs/references/**'] },
      { id: 'community', title: 'Community', blurb: 'How to contribute, and the rules that apply.',
        match: ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'] },
    ],
    fallbackCluster: 'guides',
    // Carried from the source config, because the reasons still hold in the mirror. Dropping them made two
    // findings fire here that are suppressed there — an illustrative citation in the guides, and a README
    // whose first line is block art rather than an H1 — and publishing a corpus with blocking findings makes
    // those findings public.
    suppress: [
      { signal: 'H2', path: 'docs/references/**',
        reason: 'The reference guides use src/ai/brain.ts:301 as an illustrative citation, not a real one.' },
      { signal: 'H8', path: 'README.md',
        reason: 'The README opens with a block-art banner spelling the project name, which is the title.' },
    ],
    publish: { wiki: { slug: PUBLIC_REPO } },
  };
}


/**
 * The source repository's URLs are wrong in the mirror: they point at a repo a public user cannot clone.
 *
 * And its links to withheld documents are worse than wrong — they are dead. The README's nav row links to
 * `docs/ROADMAP.md`, which is deliberately not shipped, so the published README carried a link to nothing.
 * Caught by running health against the assembled mirror before pushing it, which is the only place the
 * defect is visible: in the source repository that link resolves perfectly.
 */
function repointUrls(outDir, sourceSlug) {
  const targets = ['install.sh', 'README.md'];
  let changed = 0;
  for (const rel of targets) {
    const f = path.join(outDir, rel);
    if (!fs.existsSync(f)) continue;
    const before = fs.readFileSync(f, 'utf8');
    let after = before.split(sourceSlug).join(PUBLIC_REPO);
    // Drop nav entries pointing at anything NEVER_SHIP covers, rather than shipping a dead link.
    for (const n of NEVER_SHIP) {
      after = after.replace(new RegExp(`^\\[[^\\]]+\\]\\(${n.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) ·\\n`, 'gm'), '');
    }
    if (after !== before) { fs.writeFileSync(f, after, 'utf8'); changed++; }
  }
  return changed;
}

/**
 * Materialise a commit, not the working tree.
 *
 * The first version of this copied straight out of `ROOT`, which meant a release carried whatever happened
 * to be uncommitted — someone's half-finished branding, a debug line, a file being renamed. Caught by
 * assembling a mirror while a colleague had ten modified skills and an unfinished brand palette in the tree.
 * `git archive` gives the tree exactly as committed, and touches nothing the author is working on.
 */
function exportCommit(ref, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', ref], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar, maxBuffer: 256 * 1024 * 1024 });
  return dest;
}

export function buildMirror(outDir, { sourceSlug = 'rmaurya/project-atlas', ref = 'HEAD', staging } = {}) {
  const src = staging || path.join(path.dirname(outDir), '.atlas-release-src');
  exportCommit(ref, src);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let files = 0;
  // Copy from the exported commit, not from ROOT.
  const copyFrom = (rel) => {
    const from = path.join(src, rel);
    if (!fs.existsSync(from)) return 0;
    const to = path.join(outDir, rel);
    if (fs.statSync(from).isDirectory()) {
      let n = 0;
      for (const e of fs.readdirSync(from)) n += copyFrom(path.posix.join(rel, e));
      return n;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return 1;
  };
  for (const rel of SHIP) files += copyFrom(rel);
  fs.writeFileSync(path.join(outDir, 'project-atlas.config.json'),
    JSON.stringify(mirrorConfig(), null, 2) + '\n', 'utf8');
  const repointed = repointUrls(outDir, sourceSlug);
  return { files: files + 1, repointed };
}

/** Anything tracked, not shipped, and not named in NEVER_SHIP is an unclassified path — report, never guess. */
export function checkMirror() {
  const unclassified = [];
  for (const rel of tracked()) {
    if (listed(rel)) continue;
    if (NEVER_SHIP.some((n) => rel === n.path || rel.startsWith(n.path))) continue;
    unclassified.push(rel);
  }
  return unclassified;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const unclassified = checkMirror();
    if (unclassified.length) {
      console.error(`${unclassified.length} tracked path(s) are neither shipped nor deliberately withheld.`);
      console.error('Add each to SHIP or to NEVER_SHIP in scripts/release-mirror.mjs — silence is not a decision.\n');
      for (const u of unclassified.slice(0, 40)) console.error(`  ${u}`);
      process.exit(1);
    }
    console.log(`Every tracked path is classified. ${SHIP.length} ship rule(s), ${NEVER_SHIP.length} withheld.`);
    process.exit(0);
  }
  const i = args.indexOf('--out');
  if (i === -1 || !args[i + 1]) {
    console.error('Usage: release-mirror.mjs --out <dir> | --check');
    process.exit(2);
  }
  const out = path.resolve(args[i + 1]);
  const { files, repointed } = buildMirror(out);
  console.log(`Mirror assembled → ${out}`);
  console.log(`  ${files} file(s); ${repointed} file(s) repointed at ${PUBLIC_REPO}`);
}
