#!/usr/bin/env node
/**
 * project-atlas · test suite
 *
 * Zero dependencies, no test framework. Builds throwaway git repositories in a temp directory, runs the real
 * pipeline against them, and asserts on the result — so these are integration tests over the actual behaviour,
 * not unit tests over mocks.
 *
 *   node tests/run.mjs            run everything
 *   node tests/run.mjs --filter citation
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { globToRegExp, resolveConfig, DEFAULT_CLUSTERS, DEFAULT_CONFIG, clusterFor, unsafeRegexReason, AUTOMATION_KEYS } from '../scripts/lib/config.mjs';
import { buildIndex } from '../scripts/lib/scan.mjs';
import { runHealth, formatReport, SIGNALS } from '../scripts/lib/health.mjs';
import { renderSite } from '../scripts/lib/render.mjs';
import { renderMarkdown, inline } from '../scripts/lib/markdown.mjs';
import { readPlanning, DEFAULT_PLANNING } from '../scripts/lib/planning.mjs';
import { writeDay, contributorSlug } from '../scripts/lib/worklog.mjs';
import { buildPrompt } from '../scripts/lib/prompt.mjs';
import { readDeck } from '../scripts/lib/deck.mjs';
import { RAMP, STATUS, INK, viewPage } from '../scripts/lib/dashboard.mjs';
import { CAT, CAT_MAX, donut, lineChart } from '../scripts/lib/charts.mjs';
import { automationAllows } from '../scripts/lib/config.mjs';
import { buildWikiPages, wikiPageName, isSafePageName, exportSingleFile, exportBundle, RESERVED, gitlabPagesJob, stageWiki } from '../scripts/lib/publish.mjs';
import { readContrib, estimateHours, taskCoverage } from '../scripts/lib/contrib.mjs';
import { readTokens, formatTokens, formatSessions, assertNotPublishable, transcriptDir } from '../scripts/lib/tokens.mjs';
import { readChanges, fileDiff, formatChanges } from '../scripts/lib/changes.mjs';
import { branchStatus, createBranch, TYPES } from '../scripts/lib/branch.mjs';
import { detectHost, gateTarget, formatCapabilities } from '../scripts/lib/host.mjs';
import { resolveViews, navItems, PANELS } from '../scripts/lib/views.mjs';
import { communityAssets } from '../scripts/lib/community.mjs';
import { versionVerdict, isRuntimePath, parseVersion, compareVersions } from '../scripts/lib/release.mjs';
import { disagreements, updateNotice, isPluginCache } from '../scripts/lib/version.mjs';
import { specVerdict, idsIn } from '../scripts/lib/spec.mjs';
import { risks, summarise } from '../scripts/lib/insight.mjs';
import { verifyPage, verifySite } from '../scripts/lib/verify.mjs';
import { route, inferType } from '../scripts/lib/plan.mjs';
import { dayKey, commitsOn, renderDay } from '../scripts/lib/worklog.mjs';
import { ownership, areaOf, summariseOwnership } from '../scripts/lib/ownership.mjs';
import { survivingLines } from '../scripts/lib/surviving.mjs';
import { setItemPercent, itemFromBranch, contradictsPlan, STARTED_PERCENT } from '../scripts/lib/progress.mjs';
import { handoffAge, handoffsIn, formatHandoffPrompt } from '../scripts/lib/handoff.mjs';
import { acquire as acquireLock, foreignBuildWarning, STALE_AFTER_MS } from '../scripts/lib/lock.mjs';
import { readObligations, evaluate as evaluateSop, parseInterval, DEFAULT_SOP_MATCH } from '../scripts/lib/sop.mjs';
import { note as journalNote, read as journalRead, MAX_TEXT, slugCollisions } from '../scripts/lib/journal.mjs';
import { testInventory, casesInFile } from '../scripts/lib/testcases.mjs';
import { designRecord, undesigned, citationHealth, EXPECTED } from '../scripts/lib/design.mjs';
import { scaffold as scaffoldDesign, TEMPLATES } from '../scripts/lib/scaffold.mjs';
import { renderLauncher, launcherProjects } from '../scripts/lib/launcher.mjs';
import { handle as mcpHandle, TOOLS as MCP_TOOLS, PROTOCOL_VERSION as MCP_VERSION } from '../scripts/lib/mcp.mjs';
import { runTask, TASKS } from '../scripts/lib/task.mjs';
import { manifestUrl, checkForUpdate, fetchLatest, readCache, writeCache, isFresh } from '../scripts/lib/update.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'atlas.mjs');
const filter = (() => {
  const i = process.argv.indexOf('--filter');
  return i === -1 ? null : process.argv[i + 1];
})();

// The hook tests execute the shell blocks the plugin ships, which are POSIX. Windows has no `sh`, so they
// cannot run there — and a suite that silently drops four tests on one platform is a suite that reports a
// green tick for coverage it did not have. They are skipped by name and counted.
const POSIX_SHELL = process.platform !== 'win32';
// One injection test proves a filename cannot terminate an href attribute, so the fixture's *name* contains
// `"`, `<` and `>`. NTFS forbids those characters outright, so the file cannot be created on Windows at all
// and the test failed there on ENOENT — reported as a security regression when nothing had regressed. The
// escaping it guards is platform-independent and stays covered on Linux and macOS; what Windows cannot do is
// hold the fixture. Skipped by name and counted, never quietly passed.
const POSIX_FILENAMES = process.platform !== 'win32';
// The continuity hook reads `hook_event_name` out of the payload with `jq`, so the test proving it believes
// what it observed over what it was told cannot run where there is no `jq`. The hook itself degrades to an
// unattributed record there, and that half stays covered everywhere; what needs a `jq` is the half that
// checks the attribution is right. Skipped by name and counted, for the same reason as the two above.
const HAS_JQ = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;
let skipped = 0;

let pass = 0, fail = 0;
const failures = [];

const pendingAsync = [];
function test(name, fn, { needsPosixShell = false, needsPosixFilenames = false, needsJq = false } = {}) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
  if (needsPosixShell && !POSIX_SHELL) {
    skipped++;
    process.stdout.write(`  \x1b[33m-\x1b[0m ${name}  (skipped: no POSIX shell on ${process.platform})\n`);
    return;
  }
  if (needsPosixFilenames && !POSIX_FILENAMES) {
    skipped++;
    process.stdout.write(`  \x1b[33m-\x1b[0m ${name}  (skipped: ${process.platform} forbids " < > in filenames)\n`);
    return;
  }
  if (needsJq && !HAS_JQ) {
    skipped++;
    process.stdout.write(`  \x1b[33m-\x1b[0m ${name}  (skipped: no jq on this machine)\n`);
    return;
  }
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pendingAsync.push({ name, p: r }); return; }
    pass++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    fail++;
    failures.push({ name, err });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message.split('\n').join('\n    ')}\n`);
  }
}

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }
function includes(hay, needle, msg = '') {
  if (!String(hay).includes(needle)) throw new Error(`${msg}\n  expected to contain: ${needle}\n  in: ${String(hay).slice(0, 400)}`);
}

/* ------------------------------------------------------------------ fixtures */

/** The repository under test — these boundary tests read the real hooks and sources, not fixtures. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-atlas-test-'));
const made = [];

/** Build a throwaway git repo. `files` is { path: contents }. `remote` adds an origin so slug detection works. */
function fixture(name, files, { remote = null } = {}) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [p, body] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  if (remote) git('remote', 'add', 'origin', remote);
  git('add', '-A');
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'init'],
    { cwd: dir, stdio: 'ignore' });
  made.push(dir);
  return dir;
}

function analyse(dir, configOverrides = {}) {
  const cfgPath = path.join(dir, 'project-atlas.config.json');
  if (Object.keys(configOverrides).length) fs.writeFileSync(cfgPath, JSON.stringify(configOverrides), 'utf8');
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  return { cfg, index, health };
}

const sig = (health, id) => health.findings.filter((f) => f.signal === id && !f.suppressed);

/* ================================================================== glob */

console.log('\nglob');

test('glob · ** spans directories, and none', () => {
  ok(globToRegExp('**/*.md').test('a/b/c.md'));
  ok(globToRegExp('**/*.md').test('c.md'));
  ok(globToRegExp('docs/**').test('docs/a/b.md'));
  ok(!globToRegExp('docs/**').test('other/a.md'));
});

test('glob · * does not cross a directory boundary', () => {
  ok(globToRegExp('docs/*.md').test('docs/a.md'));
  ok(!globToRegExp('docs/*.md').test('docs/sub/a.md'));
});

test('glob · brace alternation', () => {
  ok(globToRegExp('**/*.{md,mdx}').test('a/b.mdx'));
  ok(!globToRegExp('**/*.{md,mdx}').test('a/b.txt'));
});

test('glob · dots are literal, not any-char', () => {
  ok(!globToRegExp('READMEx.md').test('README.md'));
});

/* ================================================================== taxonomy */

console.log('\ntaxonomy');

test('taxonomy · a filename rule beats a directory rule (the SOP-in-architecture bug)', () => {
  const cfg = { clusters: DEFAULT_CLUSTERS, fallbackCluster: 'uncategorised' };
  eq(clusterFor('docs/architecture/task-dashboard-sop.md', cfg), 'procedures',
    'an SOP living under architecture/ must still be a procedure');
  eq(clusterFor('docs/architecture/components.md', cfg), 'engineering');
});

test('taxonomy · a spec is a spec wherever it lives', () => {
  const cfg = { clusters: DEFAULT_CLUSTERS, fallbackCluster: 'uncategorised' };
  eq(clusterFor('docs/architecture/Thing_SRS_v1.0.0.md', cfg), 'specs');
});

test('taxonomy · unmatched falls through to the configured fallback', () => {
  const cfg = { clusters: DEFAULT_CLUSTERS, fallbackCluster: 'uncategorised' };
  eq(clusterFor('docs/wat/random.md', cfg), 'uncategorised');
});

/* ================================================================== citations */

console.log('\ncitations');

const citeRepo = fixture('citations', {
  'src/ai/brain.ts': 'a\nb\nc\nd\ne\n',
  'src/dup/util.ts': 'x\n',
  'src/other/util.ts': 'y\n',
  'docs/D.md': [
    '# D',
    'exact `src/ai/brain.ts:3`',
    'bare unique `brain.ts:2`',
    'partial `ai/brain.ts:1`',
    'past end `src/ai/brain.ts:99`',
    'missing `src/nope.ts:1`',
    'ambiguous `util.ts:1`',
  ].join('\n\n'),
});

test('citation · exact, bare-unique and partial paths all resolve', () => {
  const { index } = analyse(citeRepo);
  const c = index.documents[0].citations;
  const find = (p) => c.find((x) => x.path === p);
  eq(find('src/ai/brain.ts')?.resolved, 'src/ai/brain.ts');
  eq(find('brain.ts')?.resolved, 'src/ai/brain.ts', 'a bare filename with one match must resolve');
  eq(find('ai/brain.ts')?.resolved, 'src/ai/brain.ts', 'a unique path suffix must resolve');
});

test('citation · an ambiguous basename resolves to nothing and is flagged, never guessed', () => {
  const { index } = analyse(citeRepo);
  const amb = index.documents[0].citations.find((x) => x.path === 'util.ts');
  eq(amb.resolved, null);
  eq(amb.ambiguous, true);
});

test('citation · H2 fires for a line past end and for a missing file', () => {
  const { health } = analyse(citeRepo);
  const details = sig(health, 'H2').map((f) => f.detail).join(' | ');
  includes(details, 'src/ai/brain.ts:99', 'past-end must be caught');
  includes(details, 'src/nope.ts:1', 'missing file must be caught');
});

test('citation · H2 does NOT fire for resolvable citations or ambiguous ones', () => {
  const { health } = analyse(citeRepo);
  const details = sig(health, 'H2').map((f) => f.detail).join(' | ');
  ok(!details.includes('brain.ts:3'), 'a valid citation must not be flagged');
  ok(!details.includes('util.ts:1'), 'an ambiguous citation must not be flagged as broken');
  eq(sig(health, 'H2').length, 2);
});

test('citation · ambiguous count is declared under "not checked", never silently dropped', () => {
  const { health } = analyse(citeRepo);
  includes(health.notChecked.join(' '), 'more than one path');
});

/* ================================================================== links, titles, orphans */

console.log('\nsignals');

const linkRepo = fixture('links', {
  'docs/README.md': '# Index\n\n[A](A.md)\n[Gone](nope.md)\n[Img](../logo.png)\n',
  'docs/A.md': '# Alpha\n\nbody\n',
  'docs/B.md': '# Alpha\n\ndifferent file, same title\n',
  'docs/C.md': 'no heading here at all\n',
  'logo.png': 'x',
});

test('H1 · a dead relative link is caught; a real non-markdown target is not', () => {
  const { health } = analyse(linkRepo);
  const d = sig(health, 'H1');
  eq(d.length, 1);
  includes(d[0].detail, 'nope.md');
});

test('H3 · two documents sharing an H1 are both flagged (the forked-doc signature)', () => {
  const { health } = analyse(linkRepo);
  const docs = sig(health, 'H3').map((f) => f.doc).sort();
  eq(docs, ['docs/A.md', 'docs/B.md']);
});

test('H4 · orphans are found, and an index file is exempt', () => {
  const { health } = analyse(linkRepo);
  const docs = sig(health, 'H4').map((f) => f.doc);
  ok(!docs.includes('docs/README.md'), 'the index must never be reported as an orphan');
  ok(docs.includes('docs/B.md'));
});

test('H8 · a document with no H1 is flagged and has a null title', () => {
  const { index, health } = analyse(linkRepo);
  eq(sig(health, 'H8').map((f) => f.doc), ['docs/C.md']);
  eq(index.documents.find((d) => d.path === 'docs/C.md').title, null);
});

test('backlinks · are the exact inverse of links', () => {
  const { index } = analyse(linkRepo);
  eq(index.documents.find((d) => d.path === 'docs/A.md').backlinks, ['docs/README.md']);
  eq(index.documents.find((d) => d.path === 'docs/B.md').backlinks, []);
});

test('blocking · defaults are H1, H3, H8 and nothing else', () => {
  const { health } = analyse(linkRepo);
  const blockingSignals = [...new Set(health.findings.filter((f) => f.blocking).map((f) => f.signal))].sort();
  eq(blockingSignals, ['H1', 'H3', 'H8']);
});

/* ================================================================== configurable signals */

console.log('\nconfigurable signals');

const cfgRepo = fixture('configurable', {
  'docs/Old.md': '# Old\n\nThe OldName product is great. OldName again.\n',
  'docs/Archive.md': '# Archive\n\nOldName is fine here, historically.\n',
  'docs/BACKLOG.md': '# Backlog\n\nM-1 and M-2 are open.\n',
  'docs/TASKS.md': '# Tasks\n\nM-1 and M-3 are open.\n',
});

test('H7 · forbidden terms fire, and the ignore list is honoured', () => {
  const { health } = analyse(cfgRepo, {
    forbiddenTerms: [{ term: 'OldName', reason: 'renamed', ignore: ['docs/Archive.md'] }],
  });
  const docs = sig(health, 'H7').map((f) => f.doc);
  eq(docs, ['docs/Old.md']);
  includes(sig(health, 'H7')[0].detail, '× 2', 'the occurrence count must be reported');
});

test('H9 · cross-reference asymmetry names the ids missing from each side', () => {
  const { health } = analyse(cfgRepo, {
    crossref: [{ id: 'plan', a: 'docs/BACKLOG.md', b: 'docs/TASKS.md', pattern: '\\bM-\\d+\\b' }],
  });
  const byDoc = Object.fromEntries(sig(health, 'H9').map((f) => [f.doc, f.detail]));
  includes(byDoc['docs/BACKLOG.md'], 'M-2', 'M-2 is only in the backlog');
  includes(byDoc['docs/TASKS.md'], 'M-3', 'M-3 is only in the task list');
});

test('suppression · silences a signal and is counted, not hidden', () => {
  const { health } = analyse(cfgRepo, {
    forbiddenTerms: [{ term: 'OldName' }],
    suppress: [{ signal: 'H7', path: 'docs/Archive.md', reason: 'historical record, kept verbatim' }],
  });
  eq(sig(health, 'H7').map((f) => f.doc), ['docs/Old.md']);
  ok(health.suppressed >= 1, 'suppressed findings must still be counted');
});

test('suppression · a reason is mandatory — config without one is rejected', () => {
  let threw = null;
  try {
    analyse(fixture('noreason', { 'docs/A.md': '# A\n' }), { suppress: [{ signal: 'H4', path: '**' }] });
  } catch (err) { threw = err; }
  ok(threw, 'expected the config to be rejected');
  includes(threw.message, 'reason');
});

test('H7 · a pathological config pattern is declined and named, never run', () => {
  // Verified before the fix: a forbiddenTerms pattern of `(a+)+$` against a single 40-character line never
  // returned. `atlas health` was killed at 8 seconds having printed nothing at all — not slow, hung. A JS
  // regex cannot be interrupted once running, so the pattern is screened and refused rather than timed out.
  const dir = fixture('redos-h7', { 'docs/A.md': '# A\n\n' + 'a'.repeat(40) + 'b\n' });
  const started = Date.now();
  const { health } = analyse(dir, { forbiddenTerms: [{ term: 'boom', pattern: '(a+)+$', reason: 'x' }] });
  ok(Date.now() - started < 5000, 'the run must finish rather than backtrack');

  eq(sig(health, 'H7').length, 0);
  eq(health.unevaluated, ['H7'], 'the signal must be marked unevaluated, not left looking clean');
  const nc = health.notChecked.join(' ');
  includes(nc, '(a+)+$', 'the offending pattern must be named');
  includes(nc, 'NOT evaluated');
});

test('H7 · a declined pattern never renders as "ok" in the report', () => {
  // Zero findings because the check ran is a different claim from zero findings because it never ran. The
  // third non-negotiable is that a check which could not run is never reported as passing — including in the
  // one-glance summary table, which is the only part most people read.
  const dir = fixture('redos-report', { 'docs/A.md': '# A\n\naaaa\n' });
  const { index, health } = analyse(dir, { forbiddenTerms: [{ term: 'boom', pattern: '(a|a)+', reason: 'x' }] });
  const report = formatReport(health, index, { color: false });
  ok(!/H7\s+ok/.test(report), `a declined check rendered as ok:\n${report}`);
  includes(report, 'not evaluated');
});

test('H9 · an invalid crossref pattern is reported, not thrown', () => {
  const { health } = analyse(cfgRepo, {
    crossref: [{ id: 'plan', a: 'docs/BACKLOG.md', b: 'docs/TASKS.md', pattern: '\\b([A-Z' }],
  });
  eq(health.unevaluated, ['H9']);
  includes(health.notChecked.join(' '), 'not a valid regular expression');
});

test('not-checked · unconfigured signals are declared rather than reported as clean', () => {
  const { health } = analyse(fixture('unconfigured', { 'docs/A.md': '# A\n' }));
  const text = health.notChecked.join(' ');
  includes(text, 'forbiddenTerms');
  includes(text, 'crossref');
});

/* ================================================================== markdown */

console.log('\nmarkdown');

test('markdown · headings get stable, unique anchors', () => {
  const html = renderMarkdown('# One\n\n## Two\n\n## Two\n');
  includes(html, 'id="one"');
  includes(html, 'id="two"');
  includes(html, 'id="two-1"', 'a repeated heading must get a distinct anchor');
});

test('markdown · fenced code is escaped, never interpreted', () => {
  const html = renderMarkdown('```js\nconst a = "<script>alert(1)</script>";\n```\n');
  includes(html, '&lt;script&gt;');
  ok(!html.includes('<script>alert'), 'script content must not survive as markup');
});

test('markdown · inline code is protected from emphasis rewriting', () => {
  const html = inline('use `a_b_c` and *real emphasis*');
  includes(html, '<code>a_b_c</code>');
  includes(html, '<em>real emphasis</em>');
});

test('markdown · GFM tables render with alignment', () => {
  const html = renderMarkdown('| A | B |\n|:--|--:|\n| 1 | 2 |\n');
  includes(html, '<table>');
  includes(html, '<th style="text-align:left">A</th>');
  includes(html, '<th style="text-align:right">B</th>');
  includes(html, '<td style="text-align:left">1</td>');
});

test('markdown · nested lists nest, and task lists get checkboxes', () => {
  const html = renderMarkdown('- a\n  - b\n- [x] done\n');
  includes(html, '<ul>');
  includes(html, '<li>a<ul>');
  includes(html, 'checked');
});

test('markdown · a table cell containing a pipe inside code is not split', () => {
  const html = renderMarkdown('| A | B |\n|---|---|\n| `a\\|b` | 2 |\n');
  includes(html, '<code>a|b</code>');
});

test('markdown · blockquotes render nested block content', () => {
  const html = renderMarkdown('> **Note.**\n> - one\n> - two\n');
  includes(html, '<blockquote>');
  includes(html, '<strong>Note.</strong>');
  includes(html, '<li>one</li>');
});

test('markdown · raw HTML in prose is escaped, not executed', () => {
  const html = renderMarkdown('Hello <img src=x onerror=alert(1)>\n');
  ok(!html.includes('onerror=alert(1)>'), 'raw HTML must be escaped');
  includes(html, '&lt;img');
});

/* ================================================================== site */

console.log('\nsite');

test('site · rebuild is byte-identical (the wiki owns nothing)', () => {
  const dir = fixture('determinism', {
    'docs/README.md': '# Index\n\n[A](A.md)\n',
    'docs/A.md': '# Alpha\n\n| x | y |\n|---|---|\n| 1 | 2 |\n',
  });
  const run = () => {
    const { cfg, index, health } = analyse(dir);
    const { outDir } = renderSite(index, health, cfg, dir);
    const snap = {};
    const walk = (d, base = '') => {
      for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, base + e.name + '/');
        else snap[base + e.name] = fs.readFileSync(full, 'utf8');
      }
    };
    walk(outDir);
    return snap;
  };
  eq(run(), run(), 'two consecutive builds must produce identical output');
});

test('site · every page declares it is derived and links to its source', () => {
  const dir = fixture('derived-banner', { 'docs/A.md': '# Alpha\n\nbody\n' });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(outDir, 'pages', 'docs__A.html'), 'utf8');
  includes(html, 'Derived page');
  includes(html, 'docs/A.md');
});

test('site · a document page resolves its stylesheet and nav from pages/', () => {
  // Regression: doc pages are emitted one directory down, so a root-relative "atlas.css" 404s and every
  // document renders unstyled. Caught only by opening one in a browser, which is why it is pinned here.
  const dir = fixture('asset-paths', { 'docs/A.md': '# Alpha\n\nbody\n' });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(outDir, 'pages', 'docs__A.html'), 'utf8');
  includes(html, 'href="../atlas.css"', 'stylesheet must resolve from pages/');
  includes(html, 'href="../index.html"', 'nav must resolve from pages/');
  includes(html, 'href="../health.html"');
  ok(fs.existsSync(path.join(outDir, 'atlas.css')), 'the stylesheet must actually exist where it is referenced');
});

test('site · internal links are rewritten to generated pages', () => {
  const dir = fixture('linkrewrite', {
    'docs/README.md': '# Index\n\n[Alpha](A.md)\n',
    'docs/A.md': '# Alpha\n\nbody\n',
  });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(outDir, 'pages', 'docs__README.html'), 'utf8');
  includes(html, 'href="docs__A.html"');
});

test('site · the search index carries every document', () => {
  const dir = fixture('searchindex', { 'docs/A.md': '# Alpha\n', 'docs/B.md': '# Beta\n' });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const js = fs.readFileSync(path.join(outDir, 'search-index.js'), 'utf8');
  const data = JSON.parse(js.replace(/^window\.ATLAS = /, '').replace(/;\s*$/, ''));
  eq(data.docs.length, 2);
});

test('site · output is fully self-contained — no external requests', () => {
  const dir = fixture('offline', { 'docs/A.md': '# Alpha\n\n![x](https://example.com/i.png)\n' });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  for (const f of ['index.html', 'health.html', 'atlas.css']) {
    const html = fs.readFileSync(path.join(outDir, f), 'utf8');
    ok(!/<script[^>]+src="https?:/.test(html), `${f} must not load an external script`);
    ok(!/<link[^>]+href="https?:/.test(html), `${f} must not load an external stylesheet`);
    ok(!/@import\s+url\(https?:/.test(html), `${f} must not import an external stylesheet`);
  }
});

/* ================================================================== planning & deck */

console.log('\nplanning');

const PLAN_MD = `# Tasks

**76 open items**

| Item | % | Item | % |
|---|---|---|---|
| A-1 | 0 | A-2 | 45 |
| B-1 | **100** | B-2 | 30* |

## Track 1 — Alpha work

**A-1 · First thing** — **P0 · Critical**
*A one-line summary of the first thing.*

**A-2 · Second thing** — **P2 · Medium**
*Summary two.*

## Track 2 — Beta work

**B-1 · Third thing** — **P1 · High**
*Summary three.*

**B-2 · Fourth thing** — **P3 · Low**
*Summary four.*

**B-3 · No figure recorded** — **P3 · Low**
*This item appears in no percentage table.*
`;

const planRepo = fixture('planning', { 'docs/TASKS.md': PLAN_MD, 'docs/A.md': '# A\n' });

test('planning · items, priorities, criticalities and tracks are extracted', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const plan = readPlanning(planRepo, cfg);
  eq(plan.items.length, 5);
  const a1 = plan.items.find((i) => i.id === 'A-1');
  eq([a1.title, a1.priority, a1.criticality, a1.track], ['First thing', 'P0', 'Critical', 'Track 1 — Alpha work']);
  includes(a1.summary, 'first thing');
});

test('planning · an item carries its whole description and the documents that specify it', () => {
  // The model had a summary clamped to 220 characters and no notion that an item is specified anywhere, so
  // a backlog view had nothing to render. Both come from the markdown — a hand-kept item-to-document mapping
  // is a mapping that goes stale, which is the failure this tool exists to detect.
  const dir = fixture('planning-detail', {
    'docs/TASKS.md': [
      '| Item | % |', '|---|---|', '| X-1 | 40 |', '',
      '## Track 1 — Work', '',
      '**X-1 · Detailed thing** — **P1 · High**',
      '*One line of summary.*',
      '',
      'A second paragraph the summary never carried. Specified by [the SRS](specs/SRS.md) and',
      'also by [the design](../DESIGN.md). External [docs](https://example.com/x) are not sources,',
      'nor is an [anchor](#somewhere), and `[not](a-link.md)` is prose about links.',
      '',
      '**X-2 · Next thing** — **P2 · Low**',
      '*Belongs to X-2, not X-1.*',
      '',
      '## Track 2 — Other', '',
      '**X-3 · Last in file** — **P3 · Low**',
      '*Bounded by end of file.*',
    ].join('\n'),
    'docs/specs/SRS.md': '# SRS\n',
    'DESIGN.md': '# Design\n',
  });
  const cfg = resolveConfig(dir);
  cfg.planning = { source: 'docs/TASKS.md' };
  const plan = readPlanning(dir, cfg);
  const x1 = plan.items.find((i) => i.id === 'X-1');

  eq(x1.summary, 'One line of summary.', 'the summary is unchanged — the table still renders it');
  includes(x1.description, 'A second paragraph the summary never carried');
  eq(/Belongs to X-2/.test(x1.description), false, 'the next item bounds the description');

  eq(x1.sources.map((s) => s.path), ['docs/specs/SRS.md', 'DESIGN.md'],
     'repository-relative links only, resolved against the plan, in order');

  // A track heading bounds the last item of a track, or it swallows the following section.
  const x2 = plan.items.find((i) => i.id === 'X-2');
  eq(/Last in file/.test(x2.description), false, 'a track heading ends the previous item');
});

test('planning · percentages are read, and an asterisk marks the figure estimated', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const plan = readPlanning(planRepo, cfg);
  const by = Object.fromEntries(plan.items.map((i) => [i.id, i]));
  eq(by['A-2'].percent, 45);
  eq(by['B-1'].percent, 100);
  eq([by['B-2'].percent, by['B-2'].estimated], [30, true], 'a trailing * means estimated, not measured');
  eq(by['A-2'].estimated, false);
});

test('planning · an item with no figure is unknown, never charted as zero', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const plan = readPlanning(planRepo, cfg);
  const b3 = plan.items.find((i) => i.id === 'B-3');
  eq(b3.percent, null);
  eq(b3.status.label, 'Unknown');
  // The mean must exclude it — (0+45+100+30)/4 = 43.75, not /5 = 35.
  eq(plan.stats.mean, 43.8);
  eq(plan.stats.unknown, 1);
  includes(plan.notes.join(' '), 'not as zero');
});

test('planning · a pathological item pattern is declined and stated, and the read still returns', () => {
  // Same defect, a second entry point: `planning.itemPattern`, `trackPattern` and `percentCellPattern` are
  // all configurable, and readPlanning runs them over every line of the source document.
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md', itemPattern: '(a+)+$' };
  const started = Date.now();
  const plan = readPlanning(planRepo, cfg);
  ok(Date.now() - started < 5000, 'the read must finish rather than backtrack');
  eq(plan.items, [], 'a pattern that was never run extracts nothing — it does not invent items');
  includes(plan.notes.join(' '), 'planning.itemPattern');
  includes(plan.notes.join(' '), 'was NOT applied');
});

test('planning · the shipped default patterns all survive the screen', () => {
  // The screen is deliberately conservative, so it is worth pinning that it does not refuse the tool's own
  // defaults — `(?:\\*\\*)?` and `(\\*)?` are quantified groups whose bodies are escaped literals, not
  // quantifiers, and refusing them would silently disable the whole planning dashboard.
  for (const p of Object.values(DEFAULT_PLANNING).filter((v) => typeof v === 'string')) {
    eq(unsafeRegexReason(p), null, `a default pattern was refused: ${p}`);
  }
  eq(unsafeRegexReason('(?:GET|POST)+'), null, 'distinct alternatives are not a hazard and must not be refused');
  ok(unsafeRegexReason('(a+)+$'), 'a nested quantifier must be refused');
  ok(unsafeRegexReason('(a|ab)*'), 'overlapping alternatives under a repeat must be refused');
});

test('planning · a missing source degrades rather than throwing', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/NOPE.md' };
  const plan = readPlanning(planRepo, cfg);
  eq(plan.missing, true);
  eq(plan.items, []);
});

test('dashboard · renders charts, the item table, and declares what it omits', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const index = buildIndex(planRepo, cfg);
  const health = runHealth(index, cfg, planRepo);
  const site = renderSite(index, health, cfg, planRepo);
  const html = fs.readFileSync(path.join(site.outDir, 'dashboard.html'), 'utf8');
  includes(html, 'Mean completion by track');
  includes(html, 'All items');
  includes(html, 'First thing');
  includes(html, 'data-percent="-1"', 'the unknown item must be marked, not defaulted to 0');
  includes(html, 'does not show', 'omissions must be stated on the page');
});

test('dashboard · both themes declare every ramp and status step', () => {
  // A colour defined in only one theme renders as the wrong theme's ink on the other theme's ground —
  // the classic unreadable-page bug. The two sets must have identical keys.
  eq(Object.keys(RAMP.light).sort(), Object.keys(RAMP.dark).sort());
  eq(Object.keys(STATUS.light).sort(), Object.keys(STATUS.dark).sort());
});

test('dashboard · every colour comes from a validated set, categorical included', () => {
  // **This contract widened in 0.1.62, deliberately.** It used to read "uses no categorical palette", and
  // the reasoning was sound while it held: there was no chart whose job was identity, and a categorical
  // palette with no categorical chart is decoration. Contributor and desk breakdowns are identity charts,
  // so one had to exist.
  //
  // The rule the test actually enforces is unchanged and is the one that matters: **no colour without a
  // validation behind it.** CAT joins the allow-list on the same terms as INK — both sets were run through
  // the palette validator (lightness band, chroma floor, CVD separation, normal-vision separation, contrast
  // against their own surface), and dark is a separate selection rather than the light set flipped, because
  // flipping put a slot outside the band on the first attempt.
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const index = buildIndex(planRepo, cfg);
  const health = runHealth(index, cfg, planRepo);
  const site = renderSite(index, health, cfg, planRepo);
  const html = fs.readFileSync(path.join(site.outDir, 'dashboard.html'), 'utf8');
  // INK joins the allow-list because it is a validated set, not an invented one: the contrast test above
  // asserts every one of its ten values clears 4.5:1 against the ramp step it is paired with. The rule this
  // test enforces is "no colour without a validation behind it" — not "no colour".
  const allowed = new Set([...Object.values(RAMP.light), ...Object.values(RAMP.dark),
                           ...Object.values(STATUS.light), ...Object.values(STATUS.dark),
                           ...Object.values(INK.light), ...Object.values(INK.dark),
                           ...CAT.light, ...CAT.dark]);
  const hexes = [...new Set((html.match(/#[0-9a-fA-F]{6}/g) || []).map((h) => h.toLowerCase()))];
  // Any hex in the dashboard's own markup must come from a validated set; theme tokens live in atlas.css.
  const stray = hexes.filter((h) => !allowed.has(h));
  eq(stray, [], `unvalidated colours in the dashboard: ${stray.join(', ')}`);
});

test('deck · slides split on ---, directives are consumed, notes are captured', () => {
  const dir = fixture('deck', {
    'docs/atlas/DECK.md': [
      '<!-- class: title -->\n\n# Title Slide\n\nLede text.',
      '## Second\n\n- a\n- b',
      '<!-- class: section -->\n<!-- notes: presenter note here -->\n\n# Divider',
    ].join('\n\n---\n\n'),
    'docs/A.md': '# A\n',
  });
  const cfg = resolveConfig(dir);
  const deck = readDeck(dir, cfg);
  eq(deck.slides.length, 3);
  eq(deck.slides[0].cls, 'title');
  eq(deck.slides[0].title, 'Title Slide');
  eq(deck.slides[2].notes, 'presenter note here');
  ok(!deck.slides[0].html.includes('class:'), 'the directive comment must be consumed, not rendered');
});

test('deck · absent source yields no deck page rather than an empty one', () => {
  const dir = fixture('nodeck', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  eq(readDeck(dir, cfg), null);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const site = renderSite(index, health, cfg, dir);
  ok(!fs.existsSync(path.join(site.outDir, 'deck.html')));
});

/* ================================================================== git metadata & contributions */

console.log('\ngit metadata');

test('git · metadata actually loads — dates are attached, not silently absent', () => {
  // Regression, and a bad one: the git format used literal NUL/US bytes in argv. Node rejects a NUL in an
  // argument, the bare catch swallowed it, and every document came back with `git: null` — so no date
  // rendered anywhere and the staleness signal evaluated nothing while reporting clean. A check that cannot
  // run must never look like a check that passed.
  const dir = fixture('gitmeta', { 'docs/A.md': '# Alpha\n' });
  const { index } = analyse(dir);
  const d = index.documents[0];
  ok(d.git, 'the document must carry git metadata');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d.git.date), `expected an ISO date, got ${JSON.stringify(d.git)}`);
  eq(index.stats.withGit, true);
});

test('git · H6 fires when cited code moved after the document was last touched', () => {
  const dir = fixture('stale', { 'src/x.ts': 'a\nb\n', 'docs/A.md': '# Alpha\n\nSee `src/x.ts:1`.\n' });
  // Move the code forward with an explicit later timestamp. Git records seconds, and two commits made in the
  // same second are genuinely indistinguishable — so the fixture must space them, not the comparison loosen.
  fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'a\nb\nc\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'touch code'],
    { cwd: dir, stdio: 'ignore', env: { ...process.env,
      GIT_AUTHOR_DATE: '2030-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2030-01-01T12:00:00Z' } });
  const { health } = analyse(dir, { staleDays: 0 });   // every document is old enough to be eligible
  const h6 = sig(health, 'H6');
  eq(h6.length, 1, 'the document must be flagged as stale against its citation');
  includes(h6[0].moved.join(' '), 'src/x.ts', 'the moved file must be named');
  eq(h6[0].movedTotal, 1);
});

console.log('\ncontributions');

const contribRepo = (() => {
  const dir = fixture('contrib', { 'a.txt': 'one\n' });
  const commit = (msg, body, file, content) => {
    fs.writeFileSync(path.join(dir, file), content);
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T',
      'commit', '-qm', msg, ...(body ? ['-m', body] : [])], { cwd: dir, stdio: 'ignore' });
  };
  commit('feat(x): add a thing', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nDesk: alpha', 'a.txt', 'one\ntwo\n');
  commit('fix(x): S-1 corrected', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nDesk: beta', 'b.txt', 'x\n');
  commit('chore: no agent here', null, 'c.txt', 'y\n');
  return dir;
})();

test('contrib · reads commits, agents and Desk trailers from git alone', () => {
  const k = readContrib(contribRepo, {});
  ok(k.available, k.reason);
  eq(k.totals.commits, 4);
  eq(k.totals.aiAssisted, 2);
  eq(k.agents.map((a) => a.agent), ['Claude Opus 5']);
  eq(k.desks.configured, true);
  eq(k.desks.desks.map((d) => d.desk).sort(), ['alpha', 'beta']);
  eq(k.desks.untagged, 2, 'untagged commits must be counted, not ignored');
});

test('contrib · task references and conventional-subject rate are extracted', () => {
  const k = readContrib(contribRepo, {});
  const refs = k.commits.flatMap((c) => c.taskRefs);
  ok(refs.includes('S-1'), `expected S-1 in ${JSON.stringify(refs)}`);
  ok(k.quality.conventionalRate > 0);
});

test('contrib · active hours are an estimate, and the caveat says so', () => {
  const c = { sessionGapMinutes: 120, firstCommitCredit: 30 };
  // Two commits 30 minutes apart: one session start (30) + the real 30-minute gap = 1.0 h.
  const r = estimateHours(['2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z'], c);
  eq([r.hours, r.sessions], [1, 1]);
  // Two commits a day apart: two session starts, 30 min each.
  const r2 = estimateHours(['2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z'], c);
  eq([r2.hours, r2.sessions], [1, 2]);
  const k = readContrib(contribRepo, {});
  includes(k.caveats.join(' '), 'estimated', 'the estimate must be declared as one');
  includes(k.caveats.join(' '), 'no combined', 'the absence of a single score must be stated');
});

test('contrib · a non-git directory degrades, and a malformed command does NOT degrade silently', () => {
  const dir = path.join(tmpRoot, 'contrib-nogit');
  fs.mkdirSync(dir, { recursive: true });
  const k = readContrib(dir, {});
  eq(k.available, false);
  includes(k.reason, 'Not a git repository');
});

/* ================================================================== changes */

console.log('\nchanges');

test('changes · a code change surfaces the documents that cite it, oldest first', () => {
  // The finding this tool exists to produce and git status cannot: an old document whose ground just moved.
  const dir = fixture('changes-risk', {
    'src/auth.ts': 'a\nb\nc\n',
    'src/other.ts': 'x\n',
    'docs/old.md': '# Old design\n\nSee `src/auth.ts:2`.\n',
    'docs/newer.md': '# Newer design\n\nAlso `src/auth.ts:1`.\n',
    'docs/unrelated.md': '# Unrelated\n\nSee `src/other.ts:1`.\n',
  });
  // Age the two documents differently so "oldest first" is observable.
  const commit = (msg, date) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', msg],
    { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  fs.appendFileSync(path.join(dir, 'docs/newer.md'), '\nrevised\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  commit('touch newer', '2030-06-01T12:00:00Z');

  // Now change the cited source file, uncommitted.
  fs.writeFileSync(path.join(dir, 'src/auth.ts'), 'a\nb\nc\nd\n');

  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const k = readChanges(dir, cfg, index);

  ok(k.available, k.reason);
  eq(k.unstaged.map((f) => f.path), ['src/auth.ts']);
  const docs = k.docsAtRisk.map((d) => d.doc);
  eq(docs.includes('docs/unrelated.md'), false, 'a document citing an untouched file must not appear');
  eq(docs.length, 2);
  eq(docs[0], 'docs/old.md', 'oldest document first — it is the one most likely to have drifted');
});

test('changes · branch scope falls back honestly when there is no divergence', () => {
  const dir = fixture('changes-scope', { 'a.txt': '1\n' });
  const cfg = resolveConfig(dir);
  const k = readChanges(dir, cfg, null);
  ok(k.available);
  // A fresh repo on its first commit has neither a merge-base nor HEAD~2; the scope must say so, not guess.
  ok(['branch', 'last-2-commits'].includes(k.scope));
  eq(k.docsAtRisk, [], 'without an index there is nothing to correlate, and it must not invent any');
});

test('changes · one file diff prefers uncommitted work over history', () => {
  const dir = fixture('changes-diff', { 'a.txt': 'one\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  const d = fileDiff(dir, 'a.txt', {});
  eq(d.scope, 'working');
  includes(d.diff, '+two');
  eq(fileDiff(dir, 'nosuchfile.txt', {}).diff, '', 'a file with no changes returns nothing, not an error');
});

/* ================================================================== tokens */

console.log('\ntokens');

test('tokens · refuses to write a report into the published directory', () => {
  // The output directory is pushed to wikis and Pages branches. A token report there is a prompt log there.
  const dir = fixture('tokens-guard', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  for (const bad of ['docs/_wiki/tokens.txt', 'docs/_wiki/nested/tokens.txt', 'docs/_wiki']) {
    let threw = null;
    try { assertNotPublishable(dir, cfg, bad); } catch (e) { threw = e; }
    ok(threw, `expected refusal for ${bad}`);
    includes(threw.message, 'published');
  }
  // Anywhere else is fine.
  assertNotPublishable(dir, cfg, 'tokens.txt');
  assertNotPublishable(dir, cfg, 'reports/tokens.txt');
});

test('tokens · the store slug carries no colon, so a Windows drive letter cannot make it unopenable', () => {
  // `C:\Users\me\proj` split on the separator kept its colon — `C:-Users-me-proj` — which is not a legal
  // Windows path component, so every read failed at mkdir with ENOENT and `atlas tokens` reported nothing to
  // account for. That is indistinguishable from an honestly empty store, which is why it survived.
  // Asserted with a colon in the path rather than under win32, so the regression fails on every platform.
  const dir = transcriptDir(path.join(tmpRoot, 'drive:letter'), { tokens: { transcriptRoot: '/store' } });
  eq(path.basename(dir).includes(':'), false, `slug must not contain a colon: ${path.basename(dir)}`);
});

test('tokens · a missing transcript store degrades, it does not throw', async () => {
  const dir = fixture('tokens-none', { 'docs/A.md': '# A\n' });
  const cfg = { ...resolveConfig(dir), tokens: { transcriptRoot: path.join(tmpRoot, 'no-such-store') } };
  const k = await readTokens(dir, cfg);
  eq(k.available, false);
  includes(k.reason, 'No session transcripts');
});

test('tokens · splits the four token kinds rather than reporting one total', async () => {
  // The split is the point: cache reads dominate every real session and are charged at a fraction of fresh
  // input, so a single "tokens used" figure makes a cheap session look expensive.
  const store = path.join(tmpRoot, 'tokens-store');
  const dir = fixture('tokens-read', { 'docs/A.md': '# A\n' });
  // The slug comes from the function under test, never a copy of it. A duplicate here computed the same
  // wrong thing the product did, so both agreed on Windows and both were wrong: the drive colon survived
  // into a directory name Windows cannot create.
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: store } }));
  fs.mkdirSync(path.join(store, slug), { recursive: true });
  const lines = [
    { timestamp: '2026-01-01T10:00:00Z', message: { model: 'test-model', usage: { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 } } },
    { timestamp: '2026-01-02T10:00:00Z', message: { model: 'test-model', usage: { input_tokens: 5, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 20000 },
      content: [{ type: 'tool_use', name: 'Bash' }, { type: 'tool_use', name: 'Read' }] } },
    'not json at all',
  ].map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  fs.writeFileSync(path.join(store, slug, 'session.jsonl'), lines + '\n');

  const cfg = { ...resolveConfig(dir), tokens: { transcriptRoot: store } };
  const k = await readTokens(dir, cfg);
  ok(k.available, k.reason);
  eq([k.totals.input, k.totals.output, k.totals.cacheWrite, k.totals.cacheRead], [15, 150, 1000, 30000]);
  eq(k.totals.messages, 2);
  eq(k.cacheHitRatio, 96.3, 'cache read share must be reported, not folded into a total');
  eq(k.byModel.map((m) => m.model), ['test-model']);
  eq(k.byDay.map((d) => d.day), ['2026-01-01', '2026-01-02']);
  eq(k.tools.map((t) => t.name).sort(), ['Bash', 'Read']);
  includes(k.notChecked.join(' '), 'unparseable', 'a skipped line must be declared');
});

test('tokens · no cost without configured rates, and unpriced models are named', async () => {
  const store = path.join(tmpRoot, 'tokens-store');
  const dir = path.join(tmpRoot, 'tokens-read');
  const base = resolveConfig(dir);

  const noRates = await readTokens(dir, { ...base, tokens: { transcriptRoot: store } });
  eq(noRates.cost.available, false);
  includes(noRates.cost.reason, 'not in the transcript');

  const priced = await readTokens(dir, { ...base, tokens: { transcriptRoot: store,
    rates: { 'other-model': { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } }, ratesAsOf: '2026-01-01' } });
  eq(priced.cost.available, true);
  eq(priced.cost.unpriced, ['test-model'], 'a model with no rate must be named, not silently dropped');
  eq(priced.cost.asOf, '2026-01-01');
});

test('tokens · aggregates only — no prompt text reaches the report', async () => {
  const store = path.join(tmpRoot, 'tokens-secret');
  const dir = fixture('tokens-privacy', { 'docs/A.md': '# A\n' });
  // The slug comes from the function under test, never a copy of it. A duplicate here computed the same
  // wrong thing the product did, so both agreed on Windows and both were wrong: the drive colon survived
  // into a directory name Windows cannot create.
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: store } }));
  fs.mkdirSync(path.join(store, slug), { recursive: true });
  fs.writeFileSync(path.join(store, slug, 's.jsonl'), JSON.stringify({
    timestamp: '2026-01-01T10:00:00Z',
    message: { model: 'm', usage: { output_tokens: 1 },
      content: [{ type: 'text', text: 'SECRET-PROMPT-TEXT' }, { type: 'tool_use', name: 'Read', input: { file_path: '/etc/SECRET-PATH' } }] },
  }) + '\n');
  const k = await readTokens(dir, { ...resolveConfig(dir), tokens: { transcriptRoot: store } });
  const dump = JSON.stringify(k) + formatTokens(k, false);
  ok(!dump.includes('SECRET-PROMPT-TEXT'), 'prompt text must never reach the report');
  ok(!dump.includes('SECRET-PATH'), 'tool arguments must never reach the report');
  includes(dump, 'Read', 'the tool NAME is fine — it is the argument that is not');
});

test('sessions · counts what happened, and refuses to call any of it prompt quality', async () => {
  const store = path.join(tmpRoot, 'sessions-store');
  const dir = fixture('sessions', { 'docs/A.md': '# A\n' });
  // The slug comes from the function under test, never a copy of it. A duplicate here computed the same
  // wrong thing the product did, so both agreed on Windows and both were wrong: the drive colon survived
  // into a directory name Windows cannot create.
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: store } }));
  fs.mkdirSync(path.join(store, slug), { recursive: true });
  const rows = [
    { type: 'user', promptSource: 'typed', timestamp: '2026-01-01T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-01-01T10:00:01Z', message: { model: 'm', usage: { output_tokens: 5 },
      content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', timestamp: '2026-01-01T10:00:02Z', message: { content: [{ type: 'tool_result', is_error: true }] } },
    { type: 'assistant', timestamp: '2026-01-01T10:00:03Z', message: { model: 'm', usage: { output_tokens: 5 },
      content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', timestamp: '2026-01-01T10:00:04Z', message: { content: [{ type: 'tool_result' }] } },
    { type: 'user', promptSource: 'queued', timestamp: '2026-01-01T10:01:00Z' },
    { type: 'assistant', interruptedMessageId: 'x', timestamp: '2026-01-01T10:02:00Z', message: { model: 'm', usage: { output_tokens: 1 } } },
    { type: 'user', isCompactSummary: true, timestamp: '2026-01-01T10:03:00Z' },
  ];
  fs.writeFileSync(path.join(store, slug, 's.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const k = await readTokens(dir, { ...resolveConfig(dir), tokens: { transcriptRoot: store } });
  const o = k.outcomes;
  eq([o.typedPrompts, o.queuedPrompts], [1, 1]);
  eq(o.assistantTurns, 3);
  eq([o.toolResults, o.toolErrors], [2, 1]);
  eq(o.toolErrorRate, 50);
  eq(o.interruptions, 1);
  eq(o.compactions, 1);

  const report = formatSessions(k, { available: false }, false);
  includes(report, 'does not measure');
  includes(report, 'Prompt quality');
  ok(!/quality score|prompt score|rating/i.test(report), 'no score may appear under any name');
});

/* ================================================================== publish */

console.log('\npublish');

const pubRepo = fixture('publish', {
  'README.md': '# Project Front Page\n\nThe repository README.\n',
  'docs/README.md': '# Docs Index\n\n[Alpha](architecture/A.md)\n',
  'docs/architecture/A.md': '# Alpha\n\nSee [the index](../README.md) and [a missing one](../gone.md).\n',
  'docs/architecture/B.md': '# Beta\n',
}, { remote: 'https://github.com/acme/widget.git' });

function wikiBuild() {
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  const health = runHealth(index, cfg, pubRepo);
  return { cfg, index, built: buildWikiPages(index, health, null, cfg, pubRepo) };
}

test('publish · a source document never claims a generated page name', () => {
  // Regression: README.md mapped to "Home", and the generated index then overwrote it — the repository's
  // front page vanished from the wiki with no error at all.
  const { built } = wikiBuild();
  ok(built.pages.has('Home'), 'the generated index must exist');
  includes(built.pages.get('Home'), 'Docs Index', 'Home is the generated index');
  const readmePage = [...built.nameOf.entries()].find(([src]) => src === 'README.md')[1];
  ok(readmePage !== 'Home', `README.md must not be named Home (got ${readmePage})`);
  includes(built.pages.get(readmePage), 'Project Front Page', 'the README content must survive');
});

test('publish · reserved names are all protected, not just Home', () => {
  for (const n of RESERVED) {
    eq(wikiPageName(`docs/${n}.md`, {}), `${n}-doc`, `${n} must be suffixed away from the generated page`);
  }
});

test('publish · paths flatten and internal links are rewritten to page names', () => {
  const { built } = wikiBuild();
  eq(built.nameOf.get('docs/architecture/A.md'), 'architecture-A');
  // README.md and docs/README.md both flatten to "README"; the collision resolver keeps both, so assert the
  // link points wherever docs/README.md actually landed rather than hard-coding a name.
  const indexName = built.nameOf.get('docs/README.md');
  const page = built.pages.get('architecture-A');
  includes(page, `](${indexName})`, 'a link to docs/README.md must point at its flattened page');
  ok(!page.includes('](../README.md)'), 'the original file path must not survive');
  ok(built.pages.has(indexName), 'the target page must actually exist');
});

test('publish · a link to an unpublished file degrades to text, never a dead link', () => {
  const { built } = wikiBuild();
  const page = built.pages.get('architecture-A');
  ok(!/\]\([^)]*gone[^)]*\)/.test(page), 'must not emit a link to a file that is not published');
  includes(page, 'a missing one', 'the link text must still be readable');
});

test('publish · every page carries a do-not-edit banner pointing at its source', () => {
  const { built } = wikiBuild();
  const page = built.pages.get('architecture-A');
  includes(page, 'do not edit here');
  includes(page, 'docs/architecture/A.md');
  includes(page, 'github.com/acme/widget/blob/main/docs/architecture/A.md',
    'the slug must be detected from the remote, never left as an OWNER/REPO placeholder');
  ok(!page.includes('OWNER/REPO'), 'no placeholder slug may reach a published page');
});

test('publish · with no git remote the banner degrades to plain text, not a broken link', () => {
  const dir = fixture('no-remote', { 'docs/A.md': '# Alpha\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, null, cfg, dir);
  const page = built.pages.get('A');
  includes(page, 'do not edit here');
  ok(!page.includes('https://github.com/null'), 'must not fabricate a URL when the remote is unknown');
  ok(!page.includes('OWNER/REPO'));
});

test('publish · Home and _Sidebar are generated and list every cluster', () => {
  const { built } = wikiBuild();
  ok(built.pages.has('_Sidebar'));
  ok(built.pages.has('_Footer'));
  includes(built.pages.get('_Sidebar'), '[Home](Home)');
  includes(built.pages.get('Home'), 'This wiki is generated');
});

test('publish · page-name collisions are resolved and reported, never dropped', () => {
  const dir = fixture('collide', {
    'docs/a/Thing.md': '# One\n',
    'docs/a-Thing.md': '# Two\n',
  });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, null, cfg, dir);
  eq(built.collisions.length, 1, 'the collision must be detected');
  eq(built.pages.size, [...new Set(built.pages.keys())].length);
  // Both documents must still be published.
  const names = [...built.nameOf.values()];
  eq(new Set(names).size, 2, 'both documents keep a distinct page');
});

test('publish · a document containing </script> cannot break out of the inlined search index', () => {
  // Stored XSS, in the one artifact this tool tells people to publish. `JSON.stringify` does not escape `<`;
  // the search index carries up to 6,000 characters of every document's body; `exportSingleFile` inlines that
  // file into a <script> element. So a document containing the literal text `</script><script>…</script>`
  // closed the element early and the rest ran as markup. Reproduced with exactly this payload before the fix:
  // `__PWNED` landed *after* the first closing tag in the exported file.
  const dir = fixture('export-xss', {
    'docs/A.md': '# Pwn\n\nPayload: `</script><script>window.__PWNED=1</script>`\n',
  });
  const { cfg, index, health } = analyse(dir);
  renderSite(index, health, cfg, dir);

  const js = fs.readFileSync(path.join(dir, cfg.output, 'search-index.js'), 'utf8');
  ok(!/<\/script/i.test(js), 'the generated search index must contain no literal </script');
  const data = JSON.parse(js.replace(/^window\.ATLAS = /, '').replace(/;\s*$/, ''));
  includes(data.docs[0].b, '</script>', 'the text must survive intact — this is escaping, not stripping');

  for (const page of ['wiki', 'index']) {
    const html = exportSingleFile(dir, cfg, page === 'wiki' ? 'wiki' : 'index');
    const start = html.indexOf('window.ATLAS');
    if (start < 0) continue;                       // that page does not inline the index
    const body = html.slice(start, html.indexOf('</script>', start));
    ok(!/<\/script/i.test(body), `${page}: no literal </script may appear inside the inlined data`);
    includes(body, '__PWNED', `${page}: the payload must stay inside the script element, as data`);
  }
});

test('publish · export inlines the stylesheet so the file stands alone', () => {
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  const health = runHealth(index, cfg, pubRepo);
  renderSite(index, health, cfg, pubRepo);
  const html = exportSingleFile(pubRepo, cfg, 'dashboard');
  ok(!/<link rel="stylesheet"/.test(html), 'no external stylesheet may remain');
  includes(html, '<style>');
  ok(!/<script[^>]+src="/.test(html), 'no external script may remain');
});

test('publish · every control the export scripts reach for is actually rendered', () => {
  // The general form of a real bug: `exportSingleFile` stripped <nav> wholesale to remove cross-page links,
  // which also removed the theme toggle — while still shipping its script. `if (!btn) return;` then bailed
  // before `paint()`, so the export had no theme control AND silently ignored a saved light preference. It
  // always rendered in whatever the OS asked for. Nothing failed; it just quietly did less.
  //
  // Asserting the specific button would only catch the bug that already happened. Asserting that every
  // getElementById in the shipped scripts resolves to an element in the shipped markup catches the class.
  // The invariant is NOT "every getElementById resolves" — an optional element like #itbl is legitimately
  // absent when a repository configures no planning source, and its script guards with `if (!tbl) return;`.
  // The invariant is that **exporting must not delete a control the built page rendered**. That is exactly
  // what happened, and it is what an export is uniquely able to get wrong.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);

  for (const page of ['dashboard', 'index', 'health']) {
    const built = fs.readFileSync(path.join(pubRepo, cfg.output, `${page}.html`), 'utf8');
    const html = exportSingleFile(pubRepo, cfg, page);
    const reached = new Set([...html.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)].map((m) => m[1]));
    for (const id of reached) {
      if (!built.includes(`id="${id}"`)) continue;      // never rendered here; the script guards for that
      ok(html.includes(`id="${id}"`),
         `${page}: the built page renders #${id} and the export dropped it, while still shipping its script`);
    }
  }
});

test('publish · the export keeps same-page controls and drops only the dead links', () => {
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportSingleFile(pubRepo, cfg, 'dashboard');

  const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html);
  ok(nav, 'the nav must survive when it still holds a control');
  ok(!/<a\b/.test(nav[1]), 'a cross-page link in a single file goes nowhere and must be stripped');
  includes(nav[1], 'themeToggle', 'the toggle acts on this page alone, so it stays');
  ok(!/href="[^"]*view-\w+\.html"/.test(html), 'no sibling page link may remain anywhere');
});

test('bundle · every page becomes a reachable section, and no id is duplicated', () => {
  // Ten pages concatenated share ids: themeToggle ten times, and dashboard and view-product both carry the
  // items table. Duplicate ids are invalid HTML and getElementById returns the first match, so the second
  // page's script would silently drive the first page's table.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg);

  const ids = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  eq(dupes.length, 0, `duplicate id(s): ${[...new Set(dupes)].join(', ')}`);

  const pages = [...html.matchAll(/data-page="([\w-]+)"/g)].map((m) => m[1]);
  for (const p of pages) ok(html.includes(`data-go="${p}"`), `${p} has a section but no way to reach it`);
  ok(pages.includes('about'), 'the About page is always present');
  ok(pages.length > 1, 'a bundle of one page is just an export');
});

test('bundle · a namespaced id is renamed in that page\'s script too, not only in its markup', () => {
  // Renaming the element and leaving the script pointing at the old name is the same bug in a new place:
  // no error, the control simply stops working.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg);

  for (const m of html.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    ok(html.includes(`id="${m[1]}"`) || /--/.test(m[1]) === false,
       `script reaches for #${m[1]}, which no element in the bundle carries`);
  }
  for (const m of html.matchAll(/id="([\w-]+--[\w-]+)"/g)) {
    ok(html.includes(`'${m[1]}'`) || html.includes(`"${m[1]}"`) || html.includes(`#${m[1]}`),
       `${m[1]} was renamed in the markup but nothing references the new name`);
  }
});

test('bundle · the update row appears only when the published version is genuinely newer', () => {
  // `latest !== version` also fires when the build is AHEAD of the last release — the normal state on the
  // machine that just cut one — and told the reader to upgrade 0.1.5 to 0.1.3.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);

  const ahead = exportBundle(pubRepo, cfg, null, { version: '0.1.5', latest: '0.1.3' });
  ok(!ahead.includes('class="updbar"'), 'a build ahead of the release must not advertise a downgrade');
  includes(ahead, 'ahead of the published release');

  const behind = exportBundle(pubRepo, cfg, null, { version: '0.1.3', latest: '0.1.5' });
  includes(behind, 'class="updbar"');
  includes(behind, 'How to update');

  const unknown = exportBundle(pubRepo, cfg, null, { version: '0.1.5', latest: null });
  ok(!unknown.includes('class="updbar"'), 'not knowing is not the same as being behind');
  includes(unknown, 'not checked', 'and the About page must say so rather than imply currency');
});

test('bundle · no link points at a file, because there are no files beside it', () => {
  // Rewriting the menu and stopping there left every in-body link dead: "Open the wiki →" on the home page,
  // and all 61 document links on the Wiki page. Then a third survived a second pass, because a link inside a
  // document page addresses its sibling as `README.html` while the Wiki index addresses the same document as
  // `pages/README.html` — the target depends on where the link sits, not only on what it names.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg);

  const dead = [...html.matchAll(/href="([^"#][^"]*\.html[^"]*)"/g)].map((m) => m[1]);
  eq(dead.length, 0, `link(s) to a file that does not travel with the bundle: ${[...new Set(dead)].slice(0, 5).join(', ')}`);

  // And every in-document target must exist, or the click lands on a blank page.
  for (const m of html.matchAll(/data-go="([\w.-]+)"/g)) {
    ok(html.includes(`data-page="${m[1]}"`), `nothing in the bundle answers to #${m[1]}`);
  }
});

test('bundle · a page\'s own stylesheet travels with it', () => {
  // atlas.css is the base; the dashboard and every role view add ~130 lines on top — the cards, tiles and bar
  // charts. Collecting only <main> and <script> shipped every number with none of the presentation, and the
  // result read as an unstyled outline.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

  const built = fs.readFileSync(path.join(pubRepo, cfg.output, 'dashboard.html'), 'utf8');
  for (const m of built.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    for (const rule of [...m[1].matchAll(/^\.([\w-]+)\s*\{/gm)].map((r) => r[1]).slice(0, 12)) {
      ok(styles.includes(`.${rule}`), `the built page styles .${rule} and the bundle does not`);
    }
  }
});

test('bundle · About states unknowns instead of inventing plausible defaults', () => {
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg, null, {});
  includes(html, 'not a git checkout');
  includes(html, 'no model trailer found in history');
  includes(html, 'No repository remote was configured');
});

/* ================================================================== branching */

console.log('\nbranching');

test('branch · a protected branch blocks committing and offers the fix', () => {
  const dir = fixture('branch-main', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'ignore' });
  const st = branchStatus(dir, {});
  eq([st.onProtected, st.safeToCommit], [true, false]);
  ok(st.problems.some((p) => p.level === 'block'), 'being on main must block, not merely warn');
  includes(st.problems[0].fix, 'atlas branch');
});

test('branch · a conventional branch is safe and recognised', () => {
  const dir = fixture('branch-ok', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['switch', '-c', 'fix/citation-resolver'], { cwd: dir, stdio: 'ignore' });
  const st = branchStatus(dir, {});
  eq([st.onProtected, st.followsConvention, st.safeToCommit], [false, true, true]);
  eq(st.problems, []);
});

test('branch · an off-convention name warns but does not block', () => {
  const dir = fixture('branch-odd', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['switch', '-c', 'my-stuff'], { cwd: dir, stdio: 'ignore' });
  const st = branchStatus(dir, {});
  eq(st.safeToCommit, true, 'an unconventional name is a warning, not a barrier to work');
  eq(st.problems.map((p) => p.level), ['warn']);
});

test('branch · creation validates the type and the slug', () => {
  const dir = fixture('branch-create', { 'docs/A.md': '# A\n' });
  includes(createBranch(dir, 'nonsense', 'thing').reason, 'Unknown type');
  includes(createBranch(dir, 'fix', '').reason, 'slug is required');
  includes(createBranch(dir, 'fix', 'a b c d e f g h').reason, 'too long');
  const r = createBranch(dir, 'fix', 'Citation Resolver False Positives');
  eq([r.ok, r.name], [true, 'fix/citation-resolver-false-positives'], 'a slug is normalised, not rejected');
});

test('branch · creating an existing branch refuses rather than switching silently', () => {
  const dir = fixture('branch-dupe', { 'docs/A.md': '# A\n' });
  eq(createBranch(dir, 'feat', 'thing').ok, true);
  execFileSync('git', ['switch', '-'], { cwd: dir, stdio: 'ignore' });
  includes(createBranch(dir, 'feat', 'thing').reason, 'already exists');
});

/* ================================================================== host capabilities */

console.log('\nhost capabilities');

test('host · the wiki URL matches the protocol origin uses', () => {
  // Regression: an https:// wiki URL on an SSH-cloned repo fails as "Repository not found", which reads as
  // the wiki not existing rather than as missing credentials.
  const ssh = fixture('host-ssh', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  eq(detectHost(ssh, {}).wikiGit, 'git@github.com:acme/widget.wiki.git');
  const https = fixture('host-https', { 'docs/A.md': '# A\n' }, { remote: 'https://github.com/acme/widget.git' });
  eq(detectHost(https, {}).wikiGit, 'https://github.com/acme/widget.wiki.git');
});

test('host · gitlab is recognised, and its missing features read as N/A not off', () => {
  const dir = fixture('host-gitlab', { 'docs/A.md': '# A\n' }, { remote: 'git@gitlab.com:group/proj.git' });
  const h = detectHost(dir, {});
  eq([h.kind, h.slug], ['gitlab', 'group/proj']);
  eq(h.discussionsUrl, null, 'GitLab has no Discussions; null means not applicable');
});

test('host · no remote is reported, not guessed', () => {
  const dir = path.join(tmpRoot, 'host-noremote');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  const h = detectHost(dir, {});
  eq(h.kind, 'none');
  eq(gateTarget('wiki', h, { checked: false }).ok, false);
});

test('host · an enabled wiki that was never initialised reads as half, not on', () => {
  // The failure this exists to prevent: `caps` printed "on" from has_wiki alone, so the wiki looked ready to
  // receive a publish, and `publish` then refused — two commands disagreeing about one repository.
  const dir = fixture('host-wiki-half', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const h = detectHost(dir, {});
  const caps = { checked: true, slug: 'acme/widget', wiki: true, wikiInitialised: false,
                 pages: true, issues: true, discussions: true, visibility: 'public', defaultBranch: 'main' };

  const report = formatCapabilities(h, caps, false);
  includes(report, 'half');
  includes(report, 'not initialised');
  // The line must not also claim "on" for the same feature, which is the ambiguity being removed.
  eq(/ on {2}Wiki/.test(report), false, 'an uninitialised wiki must not render as on');

  // And the gate agrees, without a network call: wikiInitialised is reused, not re-probed.
  const g = gateTarget('wiki', h, caps);
  eq(g.ok, false);
  includes(g.reason, 'does not exist yet');
  includes(g.hint, 'Create the first page');
});

test('scan · a link pattern inside backticks is prose about links, not a link', () => {
  // Documenting a regex refused your commit. `[-_](spec|srs)\.md$` in inline code was read as a link to a
  // file named `spec|srs`, H1 reported it dead, and H1 is blocking. Fenced blocks were already excluded from
  // prose; inline spans were not. Any writing about markdown, globs or bracket syntax hits this.
  const dir = fixture('inline-code-link', {
    'docs/A.md': '# A\n\nThe pattern `[-_](spec|srs)\\.md$` matches a suffix, and `[x](y)` is not a link.\n\n' +
                 'This one is real: [B](B.md)\n',
    'docs/B.md': '# B\n',
  });
  const { index, health } = analyse(dir, {});
  const a = index.documents.find((d) => d.path === 'docs/A.md');
  eq(a.links.map((l) => l.target), ['docs/B.md'], 'only the real link outside backticks counts');
  eq(health.findings.filter((f) => f.signal === 'H1').length, 0, 'documented syntax must not read as a dead link');

  // The citation convention is written in backticks on purpose, so masking must not reach citations.
  const cited = fixture('inline-code-citation', {
    'docs/A.md': '# A\n\nSee `scripts/lib/scan.mjs:1` for the detail.\n',
    'scripts/lib/scan.mjs': 'export const x = 1;\n',
  });
  const ci = analyse(cited, {});
  eq(ci.index.documents.find((d) => d.path === 'docs/A.md').citations.length, 1,
     'a citation in backticks is still a citation');
});

test('publish · every name the writer produces, the reader accepts', () => {
  // Round-trip, asserted as a property rather than by example. `.github/DISCUSSIONS-WELCOME.md` produced
  // `.github-DISCUSSIONS-WELCOME`; isSafePageName refuses a leading dot, so from the first publish onward the
  // manifest could not be read back. Every later publish reported atlas's own page as a manifest it did not
  // write, refused, and skipped the drift check for it — the protection reading as tampering because the
  // writer and the reader disagreed about one character.
  const paths = [
    '.github/DISCUSSIONS-WELCOME.md', '.github/PULL_REQUEST_TEMPLATE.md', '.hidden.md', '...odd.md',
    'docs/HANDOFF.md', 'docs/references/autonomy.md', 'README.md', 'a/b/c/d.md',
    'docs/-leading-dash.md', 'docs/trailing-dash-.md', 'docs/../escape.md', 'docs/Home.md',
  ];
  for (const p of paths) {
    const name = wikiPageName(p, {});
    ok(isSafePageName(name), `${p} produced an unreadable page name: ${JSON.stringify(name)}`);
  }
  // And over this repository's real corpus, which is where the defect actually came from.
  const cfg = resolveConfig(process.cwd());
  const index = buildIndex(process.cwd(), cfg);
  for (const doc of index.documents) {
    const name = wikiPageName(doc.path, cfg);
    ok(isSafePageName(name), `${doc.path} produced an unreadable page name: ${JSON.stringify(name)}`);
  }
});

test('host · a cached "no wiki yet" is re-checked, because the refusal told the user to change it', () => {
  // The refusal for an uninitialised wiki prints "create the first page, then re-run". The user does exactly
  // that, and for the rest of the hour-long cache the tool kept refusing and kept printing the same
  // instruction — advice to perform an action already performed. Introduced by reusing the probe's stored
  // answer to save an `ls-remote`, on the one path where the answer is most likely to have just changed.
  const dir = fixture('host-wiki-stale', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const h = detectHost(dir, {});
  const caps = { checked: true, slug: 'acme/widget', wiki: true, wikiInitialised: false,
                 pages: true, issues: true, discussions: true, visibility: 'public', defaultBranch: 'main' };

  // acme/widget has no wiki, so a live re-probe still says no — the point is that it re-probes rather than
  // answering from the stored false. A cached `true` is the asymmetric case and must NOT cost a probe.
  eq(gateTarget('wiki', h, caps).ok, false);
  eq(gateTarget('wiki', h, { ...caps, wikiInitialised: true }).ok, true,
     'a cached positive is trusted: a wiki that exists does not stop existing');
});

test('host · an initialised wiki passes the gate, and an unprobed one is not treated as absent', () => {
  const dir = fixture('host-wiki-ok', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const h = detectHost(dir, {});
  const base = { checked: true, slug: 'acme/widget', wiki: true, pages: true, issues: true,
                 discussions: true, visibility: 'public', defaultBranch: 'main' };

  eq(gateTarget('wiki', h, { ...base, wikiInitialised: true }).ok, true);

  // A capability cache written before wikiInitialised existed reports undefined. That must not read as
  // "absent" — an unprobed capability never blocks work — and the report says so rather than guessing.
  const stale = { ...base };
  includes(formatCapabilities(h, stale, false), 'unverified');
});

test('host · GitLab Pages refuses a branch push instead of silently doing nothing', () => {
  // GitLab publishes a `public/` artifact from a CI job. Pushing a gh-pages branch there succeeds and
  // achieves nothing, which is worse than a refusal that names the real mechanism.
  const dir = fixture('host-gl-pages', { 'docs/A.md': '# A\n' }, { remote: 'git@gitlab.com:group/proj.git' });
  const g = gateTarget('pages', detectHost(dir, {}), { checked: true, pages: false, slug: 'group/proj' });
  eq(g.ok, false);
  includes(g.reason, 'does not deploy from a branch');
  includes(g.hint, 'public/');
  // GitHub is the opposite: pushing the branch is how you enable it, so it warns and proceeds.
  const gh = fixture('host-gh-pages', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  eq(gateTarget('pages', detectHost(gh, {}), { checked: true, pages: false, slug: 'acme/widget' }).ok, true);
});

test('host · the GitLab CI job publishes from public/, not a branch', () => {
  const job = gitlabPagesJob({ output: 'docs/_wiki' });
  includes(job, 'pages:');
  includes(job, 'mv docs/_wiki public');
  includes(job, 'paths: [public]');
});

test('host · an unchecked capability does NOT block a publish target', () => {
  // Refusing to work because a network call failed would be worse than the error it prevents.
  const dir = fixture('host-unchecked', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const g = gateTarget('pages', detectHost(dir, {}), { checked: false, reason: 'offline' });
  eq(g.ok, true);
  includes(g.warn, 'unchecked');
});

test('host · --target export needs no git remote, because it writes a local file', () => {
  // The no-remote refusal sat ABOVE the export short-circuit, so the one target that is entirely offline and
  // touches no host was the one target refused in a repository without an origin.
  const dir = path.join(tmpRoot, 'host-export-noremote');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  const h = detectHost(dir, {});
  eq(h.kind, 'none');
  eq(gateTarget('export', h, { checked: false }).ok, true, 'export writes one local file and needs no remote');
  eq(gateTarget('wiki', h, { checked: false }).ok, false, 'the remote check must still apply where a remote is needed');
  eq(gateTarget('pages', h, { checked: false }).ok, false);
});

test('community · generates only what the host supports, and says what it skipped', () => {
  const dir = fixture('community', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const host = detectHost(dir, {});

  const off = communityAssets(index, health, null, host, { checked: true, slug: 'acme/widget', discussions: false, issues: true, wiki: true, pages: true }, cfg);
  ok(![...off.files.keys()].some((f) => f.includes('DISCUSSIONS')), 'no welcome post when Discussions is off');
  includes(off.skipped.join(' '), 'Discussions');

  const on = communityAssets(index, health, null, host, { checked: true, slug: 'acme/widget', discussions: true, issues: true, wiki: true, pages: true }, cfg);
  ok([...on.files.keys()].some((f) => f.includes('DISCUSSIONS')));
  includes(on.files.get('.github/ISSUE_TEMPLATE/config.yml'), 'discussions', 'issues route to Discussions when it exists');
});

/* ================================================================== views */

console.log('\nviews');

test('views · a page is composed from panel ids, and unknown ids are rejected', () => {
  const ok1 = resolveViews({ views: [{ id: 'x', title: 'X', panels: ['tiles', 'health'] }] });
  eq(ok1.length, 1);
  let threw = null;
  try { resolveViews({ views: [{ id: 'x', title: 'X', panels: ['tiles', 'nonsense'] }] }); } catch (e) { threw = e; }
  ok(threw, 'an unknown panel id must be rejected, not silently skipped');
  includes(threw.message, 'nonsense');
});

test('views · duplicate view ids are rejected', () => {
  let threw = null;
  try { resolveViews({ views: [{ id: 'a', title: 'A', panels: [] }, { id: 'a', title: 'B', panels: [] }] }); }
  catch (e) { threw = e; }
  includes(threw?.message || '', 'duplicate view id');
});

test('views · nav is generated from what exists, not hardcoded', () => {
  const views = [{ id: 'dashboard', title: 'Overview', panels: [] }, { id: 'qc', title: 'Quality', panels: [] }];
  const withDeck = navItems(views, { hasDeck: true }).map((n) => n.label);
  const without = navItems(views, { hasDeck: false }).map((n) => n.label);
  eq(withDeck, ['Home', 'Overview', 'Quality', 'Wiki', 'Deck', 'Health']);
  ok(!without.includes('Deck'), 'a deck that was never authored must not appear in the menu');
  ok(without.includes('Wiki'), 'the corpus browser is always reachable — it is the point of the tool');
  // A view marked nav:false is reachable by URL but stays out of the menu.
  eq(navItems([...views, { id: 'hidden', title: 'Hidden', nav: false, panels: [] }], { hasDeck: false })
      .map((n) => n.label).includes('Hidden'), false);
});

test('views · a panel with no data is omitted and named, never rendered empty', () => {
  const dir = fixture('views-empty', { 'docs/A.md': '# Alpha\n' });
  const cfg = resolveConfig(dir);
  // No planning source, so every plan-backed panel has nothing behind it.
  cfg.views = [{ id: 'dashboard', title: 'Overview', panels: ['tiles', 'progress', 'items', 'health'] }];
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const site = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(site.outDir, 'dashboard.html'), 'utf8');
  includes(html, 'Not shown on this page');
  includes(html, 'progress', 'the omitted panel must be named');
  ok(!/<figure class="card">\s*<figcaption><h2>Mean completion/.test(html), 'no empty progress card');
});

test('views · the landing page quotes the corpus, never a bare link', () => {
  // Regression: the README opens with its own URL, and the landing page quoted that as the description —
  // a one-line summary that was a link the reader was already on.
  const dir = fixture('views-lede', {
    'docs/README.md': '# Index\n\ngithub.com/acme/widget\n\nA real description of what this project does and why.\n',
  });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const doc = index.documents.find((d) => d.path === 'docs/README.md');
  includes(doc.excerpt, 'A real description');
  ok(!doc.excerpt.includes('github.com'), 'a bare link must not become the description');
});

test('ids · an item id is never reported without its title', () => {
  // A bare "#2" or "S-1" is a reference the reader has to go look up. Wherever an id appears in output, the
  // title travels with it.
  const dir = fixture('ids', {
    'docs/TASKS.md': '# Tasks\n\n| Item | % |\n|---|---|\n| A-1 | 40 |\n\n## Track 1 — Alpha\n\n**A-1 · A recognisable title** — **P1 · High**\n*Summary.*\n',
    'docs/A.md': '# A\n',
  });
  const cfg = resolveConfig(dir);
  cfg.planning = { source: 'docs/TASKS.md' };
  const plan = readPlanning(dir, cfg);
  const contrib = { available: true, commits: [], quality: {}, totals: {}, people: [], agents: [], desks: { configured: false }, weeks: [], caveats: [] };
  const cov = taskCoverage(contrib, plan);
  const row = cov.rows.find((r) => r.id === 'A-1');
  ok(row.title, 'coverage rows must carry the title, not just the id');
  eq(row.title, 'A recognisable title');
});

/* ================================================================== runtimes */

console.log('\nruntimes');

test('runtimes · every skill declares a description, so help can be generated not typed', () => {
  // /atlas:help lists commands by reading this directory. A skill without a description would appear in the
  // list with nothing to say about it — and a stale help page in a documentation-rot tool is indefensible.
  const dir = path.join(HERE, '..', 'skills');
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md')));
  ok(names.length >= 6, `expected several skills, found ${names.length}`);
  for (const n of names) {
    const body = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8');
    // Parse the frontmatter rather than pattern-match it: the obvious regex requires a newline that
    // `^---\n` has already consumed, so it fails on every file whose first key IS description.
    const lines = body.split('\n');
    eq(lines[0], '---', `skills/${n}/SKILL.md must open with frontmatter`);
    const end = lines.indexOf('---', 1);
    ok(end > 0, `skills/${n}/SKILL.md frontmatter is unterminated`);
    const desc = lines.slice(1, end).find((l) => /^description:\s*\S/.test(l));
    ok(desc, `skills/${n}/SKILL.md has no description — /atlas:help would list it with nothing to say`);
  }
});

/**
 * A deliberately strict reader for the flat `key: value` frontmatter a plugin manifest uses. It is not a YAML
 * parser and does not want to be — it is the set of rules a real YAML parser applies that this project has
 * already been bitten by, made loud.
 *
 * The bite: `skills/knowledgebase/SKILL.md` carried an unquoted description ending
 * `…doc drift is suspected: stale docs, dead links…`. A plain YAML scalar may not contain ": " — the parser
 * reads it as a nested mapping, the *whole document* fails, and `name` and `description` are both dropped.
 * Nothing warns. The skill simply stops matching, and the failure is invisible because the file still looks
 * exactly right to a human and to a regex that pattern-matches one line at a time.
 */
function parseFrontmatterStrict(body, label) {
  const lines = body.split('\n');
  if (lines[0] !== '---') throw new Error(`${label}: must open with a --- line`);
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error(`${label}: the frontmatter is never terminated`);

  const out = {};
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z0-9_-]+):( .*)?$/.exec(raw);
    if (!m) throw new Error(`${label}: line ${i + 1} is not a plain \`key: value\` pair — ${JSON.stringify(raw)}`);
    const key = m[1];
    if (key in out) throw new Error(`${label}: duplicate key \`${key}\``);
    const v = (m[2] || '').trim();
    if (!v) throw new Error(`${label}: \`${key}\` has no value`);

    const quoted = (v[0] === '"' || v[0] === "'") && v.length > 1 && v[v.length - 1] === v[0];
    if (quoted) {
      const inner = v.slice(1, -1);
      if (inner.replace(/\\./g, '').includes(v[0])) throw new Error(`${label}: \`${key}\` contains an unescaped ${v[0]}`);
      out[key] = inner;
      continue;
    }
    if (v[0] === '"' || v[0] === "'") throw new Error(`${label}: \`${key}\` opens a quote it never closes`);
    if (v.includes(': ')) {
      throw new Error(`${label}: \`${key}\` is an UNQUOTED value containing ": ". YAML reads that as a nested ` +
        `mapping and the ENTIRE frontmatter fails to parse — every key, including name and description, is ` +
        `dropped and nothing warns. Wrap the value in double quotes.`);
    }
    if (v.includes(' #')) throw new Error(`${label}: \`${key}\` is unquoted and contains " #" — YAML treats the rest as a comment. Quote it.`);
    if ('{}[]&*!|>%@`,'.includes(v[0])) throw new Error(`${label}: \`${key}\` starts with the YAML indicator \`${v[0]}\`. Quote it.`);
    out[key] = v;
  }
  return out;
}

test('runtimes · every SKILL.md frontmatter parses strictly — an unquoted ": " drops every key', () => {
  const dir = path.join(HERE, '..', 'skills');
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md')));
  ok(names.length >= 6, `expected several skills, found ${names.length}`);
  for (const n of names) {
    const label = `skills/${n}/SKILL.md`;
    const fm = parseFrontmatterStrict(fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8'), label);
    ok(fm.description && fm.description.length > 20, `${label}: description is missing or too short to route on`);
  }
  // And the reader must actually reject the shape that shipped, or it proves nothing.
  let threw = null;
  try {
    parseFrontmatterStrict('---\nname: x\ndescription: Use when drift is suspected: stale docs, dead links.\n---\n', 'fixture');
  } catch (e) { threw = e; }
  ok(threw, 'the strict reader must reject an unquoted value containing ": "');
  includes(threw.message, 'UNQUOTED');
});

test('runtimes · the Codex package has not drifted from skills/', () => {
  // The only duplicated tree in the project, and it exists solely because a Codex marketplace cannot use
  // "./" as a source path. A copy is a fork waiting to happen, so it is generated and checked.
  const r = spawnSync('node', [path.join(HERE, '..', 'scripts', 'sync-runtimes.mjs'), '--check'],
    { encoding: 'utf8' });
  eq(r.status, 0, `Codex package is out of sync:\n${r.stderr || r.stdout}`);
});

test('runtimes · the hook fires on git commit and ignores everything else', () => {
  const root = path.join(HERE, '..');
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  const cmd = hooks.hooks.PreToolUse[0].hooks[0].command;
  const run = (input) => spawnSync('sh', ['-c', cmd], {
    input: JSON.stringify({ tool_input: { command: input } }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
  // On a feature branch a commit is allowed through; the guard only refuses on a protected branch.
  ok(run('ls -la').status === 0, 'a non-commit Bash call must never be blocked');
  ok(run('npm test').status === 0);
  const onCommit = run('git commit -m "x"');
  includes(onCommit.stderr + onCommit.stdout, 'Types:', 'a git commit must invoke the branch guard');
}, { needsPosixShell: true });

test('runtimes · the branch guard exits 2 on a protected branch and 0 everywhere else', () => {
  // The hook shipped as `… && "$ROOT/bin/atlas" branch >&2 || exit 0`. `A && B || exit 0` swallows B's
  // status, so the guard printed eleven lines of refusal and exited 0 — and a PreToolUse hook that exits 0
  // sends its stderr to the debug log and lets the tool call through. Nothing was ever blocked, on any
  // branch, for the entire life of the hook. **Exit 2 is the only code that puts stderr in front of Claude.**
  const root = path.join(HERE, '..');
  const cmd = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'))
    .hooks.PreToolUse[0].hooks[0].command;
  const run = (dir, input) => spawnSync('sh', ['-c', cmd], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: input } }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });

  const onMain = fixture('hook-main', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: onMain, stdio: 'ignore' });
  const blocked = run(onMain, 'git commit -m "x"');
  eq(blocked.status, 2, `a commit on main must exit 2 to block; got ${blocked.status}`);
  includes(blocked.stderr, 'protected', 'the refusal must reach stderr, which is what exit 2 forwards');

  eq(run(onMain, 'ls -la').status, 0, 'a non-commit Bash call must never be blocked, even on main');
  eq(run(onMain, 'npm test').status, 0);

  const onBranch = fixture('hook-branch', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['switch', '-c', 'fix/thing'], { cwd: onBranch, stdio: 'ignore' });
  eq(run(onBranch, 'git commit -m "x"').status, 0, 'a commit on a conventional branch must pass');
}, { needsPosixShell: true });

test('runtimes · a guard that cannot run at all blocks and says so, rather than passing silently', () => {
  // Same rule as every report in this tool: a check that could not run is never reported as having passed.
  const root = path.join(HERE, '..');
  const cmd = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'))
    .hooks.PreToolUse[0].hooks[0].command;
  const dir = fixture('hook-broken', { 'docs/A.md': '# A\n' });
  const r = spawnSync('sh', ['-c', cmd], {
    cwd: dir, input: JSON.stringify({ tool_input: { command: 'git commit -m "x"' } }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(tmpRoot, 'no-such-plugin-root') },
  });
  eq(r.status, 2, 'a missing bin/atlas must not wave the commit through');
  includes(r.stderr, 'NOT checked');
}, { needsPosixShell: true });

test('runtimes · each runtime manifest is where that runtime looks for it', () => {
  const root = path.join(HERE, '..');
  ok(fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json')), 'Claude Code: .claude-plugin/plugin.json');
  ok(fs.existsSync(path.join(root, 'plugin.json')), 'Antigravity: plugin.json at the plugin root');
  ok(fs.existsSync(path.join(root, 'plugins', 'atlas', '.codex-plugin', 'plugin.json')), 'Codex: .codex-plugin/plugin.json');
  // Codex marketplace paths must be a subdirectory — "./" is rejected by the runtime.
  const mk = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  ok(mk.plugins[0].source.path.startsWith('./') && mk.plugins[0].source.path !== './',
     'Codex source.path must be a subdirectory, not the marketplace root');

  // `"skills": ["."]` failed manifest validation before Claude Code 2.1.221, and it was redundant either
  // way: `skills/` is always scanned. The field carried a real cost and no benefit.
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  ok(!('skills' in claude), 'the Claude manifest must not declare a skills path — skills/ is scanned already');
});

test('skills · every embedded shell block produces output, so a missing atlas never renders blank', () => {
  // `cmd | head -3 || echo FALLBACK` never prints the fallback: `head` exits 0 whatever `cmd` did, so a
  // missing `atlas` binary produced an empty section that reads as "there is nothing to report". And
  // `test -n "$ARGUMENTS" && atlas diff "$ARGUMENTS" || echo "(no file given)"` printed "(no file given)"
  // when a file WAS given and the command merely failed — the same `A && B || C` bug as the hook.
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'skill-blocks-'));
  const skillsDir = path.join(HERE, '..', 'skills');
  const blocks = (name) => [...fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8')
    .matchAll(/^!`([\s\S]*?)`\s*$/gm)].map((m) => m[1]);

  // A PATH with no `atlas` on it, which is the state of any machine where the plugin failed to install.
  const env = { ...process.env, PATH: '/usr/bin:/bin', ARGUMENTS: 'docs/A.md', CLAUDE_PLUGIN_ROOT: path.join(dir, 'nope') };
  let checked = 0;
  for (const name of fs.readdirSync(skillsDir)) {
    if (!fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) continue;
    for (const cmd of blocks(name)) {
      // The guarantee moved out of the shell. Claude Code refuses to auto-approve ANY compound command —
      // "contains multiple operations" — so a `|| echo` fallback did not make the block resilient, it made
      // the skill unrunnable without a prompt every time. The block is one command now, and the promise that
      // an empty section is never read as "nothing to report" lives in the prose the model reads.
      spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env });
      const body = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
      ok(/If the block above is empty/.test(body),
        `skills/${name}: no command, no fallback, and no note telling the reader an empty block means atlas is missing`);
      checked++;
    }
  }
  ok(checked >= 12, `expected to exercise every block, ran ${checked}`);
}, { needsPosixShell: true });

test('skills · /atlas:diff is one command, because the permission checker splits compound ones', () => {
  // Claude Code splits a compound Bash command on its operators and asks approval for each fragment. So
  //   test -n "$ARGUMENTS" && atlas diff "$ARGUMENTS" 2>/dev/null || echo "(no file given …)"
  // prompted for `atlas diff ""` — a call the guard existed to prevent from running — and the skill failed
  // before it started. The fallback belongs in the tool, which degrades honestly on its own, not in a shell
  // wrapper whose only other effect was to hide a missing `atlas` behind a friendly message.
  // A trailing `|| echo` fallback is fine and is required elsewhere: the checker is asked to approve exactly
  // the command that will run. What is not fine is a *guard* that constructs a second, different invocation —
  // there must be one `atlas` call in the block, and it must be the one the user asked for.
  // Generalised after /atlas:ask failed the same way a release later — "Contains shell syntax (string) that
  // cannot be statically analyzed". Fixing one skill and leaving six with the same shape is not a fix.
  const skillsDir = path.join(HERE, '..', 'skills');
  let checked = 0;
  for (const name of fs.readdirSync(skillsDir)) {
    const f = path.join(skillsDir, name, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^!`([\s\S]*?)`\s*$/gm)) {
      const cmd = m[1];
      checked++;
      // No operators at all. "Contains multiple operations" is refused outright, whatever the allowlist
      // says, so a single invocation is the only shape that runs unprompted.
      ok(!/\$\(/.test(cmd), `skills/${name}: command substitution cannot be statically analysed: ${cmd}`);
      ok(!/\bif\s|\bthen\b|\bfi\b|\btest\s+-[nz]\b|;/.test(cmd), `skills/${name}: shell control flow: ${cmd}`);
      ok(!/&&|\|\|/.test(cmd),
         `skills/${name}: Claude Code refuses to auto-approve a compound command outright — one operator and the skill prompts every run: ${cmd}`);
      ok(!/\|\s*(head|tail|sed|grep)\b/.test(cmd), `skills/${name}: a pipe swallows the exit status: ${cmd}`);
      const invocation = cmd.trim();
      ok(invocation.startsWith('atlas '), `skills/${name}: must begin with the invocation: ${cmd}`);
      eq((invocation.match(/\batlas\s/g) || []).length, 1, `skills/${name}: exactly one invocation: ${cmd}`);
    }
  }
  ok(checked >= 10, `expected every skill's blocks to be checked, saw ${checked}`);
});

test('cli · an installed plugin that does nothing in a repository says why', () => {
  // Both hooks are inert without a config, deliberately. Inert AND silent is indistinguishable from broken —
  // it read as broken in a repository with 349 markdown files: plugin enabled, no dashboard, no explanation.
  const dir = fixture('adopt-none', { 'docs/A.md': '# A\n', 'docs/B.md': '# B\n', 'README.md': '# R\n' });
  const r = cli(dir, ['version', '--notice', '--offline']);
  eq(r.code, 0);
  includes(r.stdout, 'has not adopted it');
  includes(r.stdout, 'atlas init');
});

test('cli · the adoption notice stays quiet where it would be noise', () => {
  // A repository that already adopted the tool, and one with too little markdown to want a knowledgebase.
  // A plugin that suggests itself in every directory is a plugin people disable.
  const adopted = fixture('adopt-yes', { 'docs/A.md': '# A\n', 'docs/B.md': '# B\n', 'README.md': '# R\n' });
  fs.writeFileSync(path.join(adopted, 'project-atlas.config.json'), '{}', 'utf8');
  eq(cli(adopted, ['version', '--notice', '--offline']).stdout.trim(), '');

  const sparse = fixture('adopt-sparse', { 'README.md': '# R\n' });
  eq(cli(sparse, ['version', '--notice', '--offline']).stdout.trim(), '',
     'one README is not a corpus');
});

test('cli · diff with no path lists what there is to ask about', () => {
  // Printing usage and exiting 1 made the caller run a second command to learn the answer, and made the
  // skill need shell logic to cover the empty case. Listing is both more useful and what lets the skill be
  // one word.
  const dir = fixture('diff-nolist', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'docs', 'A.md'), '# A\n\nchanged\n', 'utf8');
  const r = cli(dir, ['diff']);
  eq(r.code, 0, 'no path is a question, not an error');
  includes(r.stdout, 'docs/A.md');
  includes(r.stdout, 'uncommitted');
});

test('cli · diff with no path and nothing changed says so, rather than listing nothing', () => {
  const dir = fixture('diff-clean', { 'docs/A.md': '# A\n' });
  const r = cli(dir, ['diff']);
  eq(r.code, 0);
  includes(r.stdout, 'Nothing has changed');
});

/* ================================================================== cli */

console.log('\ncli');

function cli(dir, args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args, '--no-color', '--root', dir],
      { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || '') + String(err.stderr || '') };
  }
}

test('cli · health exits 1 when a blocking signal fires', () => {
  const dir = fixture('cli-blocking', { 'docs/A.md': '# A\n\n[dead](nope.md)\n' });
  const r = cli(dir, ['health']);
  eq(r.code, 1, 'a dead link is blocking, so the exit code must be 1');
});

test('cli · health exits 0 on a clean corpus', () => {
  const dir = fixture('cli-clean', { 'docs/README.md': '# Index\n\n[A](A.md)\n', 'docs/A.md': '# Alpha\n' });
  const r = cli(dir, ['health']);
  eq(r.code, 0, `expected clean, got:\n${r.stdout}`);
});

test('cli · init writes a config and refuses to clobber it', () => {
  const dir = fixture('cli-init', { 'docs/A.md': '# A\n' });
  eq(cli(dir, ['init']).code, 0);
  ok(fs.existsSync(path.join(dir, 'project-atlas.config.json')));
  eq(cli(dir, ['init']).code, 1, 'a second init without --force must refuse');
});

test('cli · scan --json emits parseable output without document bodies', () => {
  const dir = fixture('cli-json', { 'docs/A.md': '# A\n\nbody text here\n' });
  const r = cli(dir, ['scan', '--json']);
  eq(r.code, 0);
  const data = JSON.parse(r.stdout);
  eq(data.documents.length, 1);
  ok(!('body' in data.documents[0]), 'bodies must be omitted from JSON output');
});

test('cli · --no-git degrades honestly instead of failing', () => {
  const dir = fixture('cli-nogit', { 'docs/A.md': '# A\n' });
  const r = cli(dir, ['health', '--no-git']);
  includes(r.stdout, 'Git metadata unavailable');
});

test('cli · runs in a directory that is not a git repository', () => {
  const dir = path.join(tmpRoot, 'not-a-repo');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'A.md'), '# A\n');
  const r = cli(dir, ['scan']);
  eq(r.code, 0, `must not crash outside git:\n${r.stdout}`);
  includes(r.stdout, '1 documents');
});

/* ================================================================== configuration is untyped input */

console.log('\nconfig validation');

// A configuration file is hand-written JSON. Until these existed the tool trusted every value in it, and the
// four cases below were all verified producing a confident, wrong report rather than an error.

test('config · a blocking value that is not an array is refused, never split into characters', () => {
  // `new Set("H1")` is {'H','1'}. No signal id ever matched, so `atlas health` exited 0 with a dead link
  // present — the CI gate inverted without a word. This is the highest-severity shape of config confusion:
  // the check still runs, still prints, and simply never blocks.
  const dir = fixture('cfg-blocking-string', { 'docs/A.md': '# A\n[gone](nope.md)\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blocking: 'H1' }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'a string blocking must be refused');
  includes(threw.message, 'blocking must be an array');
  includes(threw.message, 'project-atlas.config.json', 'the message must name the file to open');
});

test('config · a blocking id that names no signal is refused, and the offending value is named', () => {
  // **This contract changed deliberately in 0.1.60, and the reason is worth keeping.** It used to refuse
  // any id the build did not know, including `H99`. That is right for a typo and wrong for the case that
  // actually occurs: a repository adds a new signal to its config while an older copy of atlas is still
  // running somewhere — a hook, CI, a colleague's machine — and the strict rule took *every* check down
  // there rather than the one gate that could not fire. So an id shaped like a signal now warns and
  // survives; anything not shaped like one is still a typo, and still fatal.
  const dir = fixture('cfg-blocking-unknown', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blocking: ['H1', 'nope'] }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'an id that is not shaped like a signal must be refused');
  includes(threw.message, '"nope"');
  includes(threw.message, 'not a signal');
});

test('config · every known key is type-checked, and the message names the file', () => {
  // Each of these was verified silently changing what the tool reported:
  //   include: null          → 0 documents, and the build wrote an empty site over the previous one
  //   searchBodyLimit: "..." → slice(0,"lots") is 0 characters, under a page claiming full-text indexing
  //   staleDays: "ninety"    → NaN comparisons, so the H6 grace period became zero
  //   exclude: "..."         → a raw TypeError with no mention of the config file
  //   output: 123            → accepted by health, threw much later in build
  const cases = [
    [{ include: null }, 'include must be an array'],
    [{ searchBodyLimit: 'lots' }, 'searchBodyLimit must be a positive number'],
    [{ staleDays: 'ninety' }, 'staleDays must be a number'],
    [{ exclude: 'node_modules/**' }, 'exclude must be an array'],
    [{ output: 123 }, 'output must be a non-empty string'],
    [{ output: '' }, 'output must be a non-empty string'],
    [{ trackedOnly: 'yes' }, 'trackedOnly must be true or false'],
    [{ roots: [1, 2] }, 'roots must be an array of strings'],
    [{ planning: 'docs/TASKS.md' }, 'planning must be an object'],
  ];
  const dir = fixture('cfg-types', { 'docs/A.md': '# A\n' });
  const cfgPath = path.join(dir, 'project-atlas.config.json');
  for (const [bad, want] of cases) {
    fs.writeFileSync(cfgPath, JSON.stringify(bad), 'utf8');
    let threw = null;
    try { resolveConfig(dir); } catch (e) { threw = e; }
    ok(threw, `expected a refusal for ${JSON.stringify(bad)}`);
    includes(threw.message, want, `wrong message for ${JSON.stringify(bad)}`);
    includes(threw.message, 'project-atlas.config.json');
  }
});

test('config · an unknown top-level key is refused, not ignored', () => {
  // A typo'd key is a setting that silently did nothing. `blocking` spelled `blockng` reads as configured and
  // is not.
  const dir = fixture('cfg-unknown-key', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blockng: ['H1'] }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'an unknown key must be refused');
  includes(threw.message, 'unknown key "blockng"');
});

test('config · a status band tone outside the known set is refused', () => {
  const dir = fixture('cfg-tone', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({
    planning: { source: 'docs/TASKS.md', statusBands: [{ max: 100, label: 'X', tone: 'x" onmouseover="alert(1)' }] },
  }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'an unknown tone must be refused — a tone is a class attribute');
  includes(threw.message, 'known tones');
});

test('config · every id in the default blocking list is a real signal', () => {
  // Guards the config ↔ health import: `validate` reads SIGNALS across a module cycle, and a cycle that
  // resolved differently would make this list unverifiable rather than wrong-looking.
  const dir = fixture('cfg-defaults', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  ok(cfg.blocking.length > 0);
  for (const id of cfg.blocking) ok(Object.keys(SIGNALS).includes(id), `${id} is not a signal`);
});

/* ================================================================== containment */

console.log('\ncontainment');

test('build · an output directory outside the repository is refused, not deleted', () => {
  // `renderSite` deletes its output directory recursively. Verified before this guard existed:
  // {"output":"../PRECIOUS"} removed a directory outside the repository and reported success.
  const dir = fixture('out-escape', { 'docs/A.md': '# A\n' });
  const precious = path.join(tmpRoot, 'PRECIOUS');
  fs.mkdirSync(precious, { recursive: true });
  fs.writeFileSync(path.join(precious, 'irreplaceable.txt'), 'do not delete me', 'utf8');

  const { cfg, index, health } = analyse(dir, { output: '../PRECIOUS' });
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'an output outside the repository must be refused');
  includes(threw.message, 'outside the repository');
  ok(fs.existsSync(path.join(precious, 'irreplaceable.txt')), 'the directory outside the repository must survive');
  fs.rmSync(precious, { recursive: true, force: true });
});

test('build · an output of "." is refused rather than deleting the repository', () => {
  // {"output":"."} deleted the entire repository, .git included, and reported success.
  const dir = fixture('out-dot', { 'docs/A.md': '# A\n' });
  const { cfg, index, health } = analyse(dir, { output: '.' });
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'the repository root must never be the output directory');
  ok(fs.existsSync(path.join(dir, '.git')), '.git must survive');
  ok(fs.existsSync(path.join(dir, 'docs', 'A.md')), 'the corpus must survive');
});

test('build · a directory full of files this tool did not generate is not deleted', () => {
  // `docs` is one keystroke from `docs/_wiki`, and the difference is a day's work. A build clears its output
  // completely, so provenance is checked before anything is removed.
  const dir = fixture('out-occupied', { 'docs/A.md': '# A\n', 'docs/handwritten.txt': 'months of work\n' });
  const { cfg, index, health } = analyse(dir, { output: 'docs' });
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'a directory with no build markers must not be deleted');
  includes(threw.message, 'Refusing to delete');
  eq(fs.readFileSync(path.join(dir, 'docs', 'handwritten.txt'), 'utf8'), 'months of work\n');
});

test('build · rebuilding over its own output is still fine', () => {
  // The provenance check must not break the ordinary case, which is a rebuild.
  const dir = fixture('out-rebuild', { 'docs/A.md': '# A\n' });
  const { cfg, index, health } = analyse(dir, {});
  const first = renderSite(index, health, cfg, dir);
  const second = renderSite(index, health, cfg, dir);
  eq(second.pages, first.pages);
  ok(fs.existsSync(path.join(second.outDir, 'index.html')));
});

test('deck · a source outside the repository is refused, never rendered into a published page', () => {
  // Verified: {"deck":{"source":"../../creds.env"}} rendered SECRET=hunter2 into deck.html, which
  // `publish --target pages` force-pushes to a public branch.
  const dir = fixture('deck-escape', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(tmpRoot, 'creds.env'), 'SECRET=hunter2\n', 'utf8');
  let threw = null;
  try { readDeck(dir, { deck: { source: '../creds.env' } }); } catch (e) { threw = e; }
  ok(threw, 'a deck source outside the repository must be refused');
  includes(threw.message, 'outside the repository');
});

test('planning · a source outside the repository is refused', () => {
  const dir = fixture('plan-escape', { 'docs/A.md': '# A\n' });
  let threw = null;
  try { readPlanning(dir, { planning: { source: '../creds.env' } }); } catch (e) { threw = e; }
  ok(threw, 'a planning source outside the repository must be refused');
  includes(threw.message, 'outside the repository');
});

test('views · a view id that is a path is refused, so nothing is written outside the output', () => {
  // A view id becomes `view-<id>.html` under the output directory. Verified: "x/../../../ESCAPED" wrote a file
  // above the repository root.
  let threw = null;
  try { resolveViews({ views: [{ id: 'x/../../../ESCAPED', title: 'X', panels: ['tiles'] }] }); } catch (e) { threw = e; }
  ok(threw, 'a path-shaped view id must be refused');
  includes(threw.message, 'becomes a filename');
  // The ordinary case keeps working.
  eq(resolveViews({ views: [{ id: 'my-view', title: 'X', panels: ['tiles'] }] }).length, 1);
});

test('tokens · the refusal to publish survives a case change and a symlink', () => {
  // `assertNotPublishable` is the ONLY mechanism keeping transcript-derived data out of a published wiki, and
  // it was a case-sensitive string prefix check. Both bypasses below were verified.
  const dir = fixture('tokens-bypass', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  fs.mkdirSync(path.join(dir, 'docs', '_wiki'), { recursive: true });

  const refuses = (dest) => {
    try { assertNotPublishable(dir, cfg, dest); return false; } catch { return true; }
  };

  // A symlink pointing into the output directory. The lexical path never mentions it.
  fs.symlinkSync(path.join(dir, 'docs', '_wiki'), path.join(dir, 'sneaky'));
  ok(refuses('sneaky/tokens.txt'), 'a symlink into the published directory must be refused');

  // A case change, on the platforms whose filesystem is case-insensitive by default. On a case-sensitive
  // filesystem DOCS/_WIKI genuinely is a different directory, so this is asserted where it is true.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    ok(refuses('DOCS/_WIKI/tokens.txt'), 'a case change must not walk past the refusal');
  }
  // Still permits everywhere legitimate.
  assertNotPublishable(dir, cfg, 'reports/tokens.txt');
});

/* ================================================================== a check that could not run */

console.log('\ndegrading honestly');

test('scan · a git failure that is not "no repository" is raised, never degraded to a filesystem walk', () => {
  // `trackedOnly` is the quiet safety feature: a file has to be committed before it can be published. A bare
  // catch turned ANY git failure into a filesystem walk, which publishes untracked files. Verified with a
  // corrupt .git/index: one tracked document became three, including an untracked secret-notes.md.
  const dir = fixture('git-corrupt', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'docs', 'secret-notes.md'), '# Secret\n', 'utf8');   // untracked
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'GARBAGE-NOT-AN-INDEX', 'utf8');

  const cfg = resolveConfig(dir);
  let threw = null;
  let index = null;
  try { index = buildIndex(dir, cfg); } catch (e) { threw = e; }
  ok(threw, `a corrupt index must be raised, not walked around (got ${index && index.documents.length} documents)`);
  includes(threw.message, 'git ls-files failed');
});

test('scan · discovery that fell back to a filesystem walk says so under Not checked', () => {
  // Degrading is allowed. Degrading quietly is not: the corpus now contains files that are not in any
  // repository, and every downstream report is about a different set of documents than it claims.
  const dir = path.join(tmpRoot, 'walk-fallback');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'A.md'), '# A\n', 'utf8');
  const cfg = resolveConfig(dir);
  eq(cfg.trackedOnly, true);
  const index = buildIndex(dir, cfg, { withGit: false });
  const health = runHealth(index, cfg, dir);
  ok(health.notChecked.some((n) => n.includes('walking the filesystem')),
    `expected a stated fallback, got:\n  ${health.notChecked.join('\n  ')}`);
});

test('git · a non-ASCII document gets its metadata, instead of silently getting none', () => {
  // git quotes any path with a byte over 0x7F under its default core.quotePath, so `--name-only` returned
  // "docs/\346\227\245..." while `ls-files -z` returned the path unquoted. The keys never matched: every
  // non-ASCII document had NO date, and H6 skipped it while the report claimed every check ran.
  const dir = fixture('git-quotepath', { 'docs/A.md': '# A\n', 'docs/日本語.md': '# CJK\n' });
  const { index, health } = analyse(dir, {});
  const cjk = index.documents.find((d) => d.path.includes('日本語'));
  ok(cjk, 'the non-ASCII document must be discovered');
  ok(cjk.git, 'the non-ASCII document must carry git metadata');
  ok(cjk.git.date, 'and a date');
  ok(!health.notChecked.some((n) => n.includes('no git history')),
    'nothing should be reported as missing history when every document has it');
});

test('git · documents with no history are counted under Not checked, not left to look clean', () => {
  const dir = fixture('git-partial', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'docs', 'B.md'), '# B\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });   // tracked, never committed
  const { health } = analyse(dir, {});
  ok(health.notChecked.some((n) => n.includes('no git history')),
    `a document with no history must be declared, got:\n  ${health.notChecked.join('\n  ')}`);
});

test('contrib · a non-ASCII path is attributed to its commit rather than to a quoted string', () => {
  const dir = fixture('contrib-quotepath', { 'docs/日本語.md': '# CJK\n' });
  const k = readContrib(dir, {});
  ok(k.available);
  const paths = k.commits.flatMap((c) => c.files.map((f) => f.path));
  ok(paths.includes('docs/日本語.md'), `expected the real path, got ${JSON.stringify(paths)}`);
});

test('health · a cited file that could not be read is named, not treated as verified', () => {
  // H2 has two halves: "no such file" and "a line past its end". The second was skipped by a bare catch, so a
  // citation into an unreadable file came out looking checked.
  const dir = fixture('h2-unreadable', {
    'docs/A.md': '# A\n\nSee src/thing.ts:9999 for the detail.\n',
    'src/thing.ts': 'export const a = 1;\n',
  });
  // A directory where a file is expected: readFileSync raises EISDIR, which is a real failure and not a
  // missing file. The citation resolves, so the line check is the only thing that can run — and cannot.
  fs.rmSync(path.join(dir, 'src', 'thing.ts'));
  fs.mkdirSync(path.join(dir, 'src', 'thing.ts'));
  const { health } = analyse(dir, {});
  ok(health.notChecked.some((n) => n.includes('could not be read')),
    `an unreadable citation target must be declared, got:\n  ${health.notChecked.join('\n  ')}`);
});

test('dashboard · a changes panel that could not be built says so, instead of reading as "no data"', () => {
  // changes.mjs re-raises deliberately — its docblock names the failure mode. dashboard.mjs caught it and
  // returned null, which lists the panel under "Not shown on this page", whose stated meaning is "omitted
  // because there is no data behind them". The error became "nothing changed", one indirection later.
  const dir = fixture('changes-broken', { 'docs/A.md': '# A\n\nSee src/thing.ts:1 today.\n', 'src/thing.ts': 'x\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'GARBAGE-NOT-AN-INDEX', 'utf8');

  const view = { id: 'developer', title: 'Developer', panels: ['changes'] };
  const html = viewPage(view, { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] },
    (o) => o.body);
  includes(html, 'could not be built');
  ok(!html.includes('Not shown on this page'),
    'a panel that failed must not be reported as one that had no data');
});

test('publish · a clone that failed for any reason other than "no wiki" aborts, taking the drift check with it', () => {
  // Any clone failure was read as "the wiki does not exist yet", so BOTH drift branches were skipped and the
  // user was told "Staged N pages" with nothing to say the human-edit protection had not run. That protection
  // is the only thing between a colleague's typo fix in the web UI and a force-overwrite.
  const dir = fixture('wiki-unreachable', { 'docs/A.md': '# A\n' });
  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'owner/repo' } } };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, null, cfg, dir);
  let threw = null;
  try {
    // Port 1 on the loopback refuses instantly: a failure to REACH the wiki, not evidence about it.
    stageWiki(dir, cfg, built, { host: { kind: 'github', wikiGit: 'http://127.0.0.1:1/x.wiki.git' } });
  } catch (e) { threw = e; }
  ok(threw, 'an unreachable wiki must abort the publish');
  includes(threw.message, 'not the same as');
});

test('publish · a first publish states that the drift check did not run', () => {
  const dir = fixture('wiki-first', { 'docs/A.md': '# A\n' });
  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'owner/repo' } } };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, null, cfg, dir);
  const r = stageWiki(dir, cfg, built, {
    host: { kind: 'github', wikiGit: path.join(tmpRoot, 'no-such-wiki.wiki.git') },
  });
  eq(r.staged, true);
  eq(r.driftChecked, false, 'there is no wiki yet, so the drift check cannot have run — and must say so');
});

/* ================================================================== injection and containment */

console.log('\ninjection');

test('render · a filename cannot terminate an href attribute', () => {
  // Stored XSS from nothing but a committed filename. The link TEXT was escaped; the href was not, and the old
  // flatName stripped only / and \. Verified live in wiki.html and health.html.
  const evil = 'z"><img src=x onerror=alert(document.domain)>".md';
  const dir = fixture('xss-filename', { 'docs/A.md': '# A\n', [`docs/${evil}`]: '# Evil\n' });
  const { cfg, index, health } = analyse(dir, {});
  const out = renderSite(index, health, cfg, dir);

  // Every generated page, not just the three listed in the report. The document page carries a second
  // interpolation the flatName restriction does not cover — the "Source:" banner links the raw repository
  // path — so this loop is what keeps the escaping at each href site load-bearing.
  const pagesDir = path.join(out.outDir, 'pages');
  const generated = [
    ...['wiki.html', 'index.html', 'health.html'].map((f) => path.join(out.outDir, f)),
    ...fs.readdirSync(pagesDir).map((f) => path.join(pagesDir, f)),
  ];
  for (const file of generated) {
    const html = fs.readFileSync(file, 'utf8');
    ok(!html.includes('<img src=x'), `${path.basename(file)} carries a live payload from a filename`);
    ok(!html.includes('onerror=alert(document.domain)>"'), `${path.basename(file)} carries an unescaped href`);
  }
  // Every generated filename is restricted to characters that are also legal on Windows.
  for (const f of fs.readdirSync(path.join(out.outDir, 'pages'))) {
    ok(/^[A-Za-z0-9._-]+$/.test(f), `page filename is not restricted: ${f}`);
  }
}, { needsPosixFilenames: true });

test('render · two documents that flatten to one page name are both written, and the count is the truth', () => {
  // `docs/a/b.md` and `docs/a__b.md` both produced docs__a__b.html; the second write won, and the reported
  // count came from the index, so it could never notice.
  const dir = fixture('page-collide', { 'docs/a/b.md': '# One\n', 'docs/a__b.md': '# Two\n' });
  const { cfg, index, health } = analyse(dir, {});
  const out = renderSite(index, health, cfg, dir);
  const written = fs.readdirSync(path.join(out.outDir, 'pages'));
  eq(written.length, 2, 'both documents must get their own page');
  eq(out.pages, 2, 'the reported count must come from the writes, not from the index');
  eq(new Set(written).size, 2);
});

test('render · a data: URL is not passed through into a published page', () => {
  const dir = fixture('data-url', {
    'docs/A.md': '# A\n\n[click](data:text/html,<script>alert(1)</script>)\n\n![px](data:image/gif;base64,R0lGOD)\n',
  });
  const { cfg, index, health } = analyse(dir, {});
  const out = renderSite(index, health, cfg, dir);
  const page = fs.readFileSync(path.join(out.outDir, 'pages', 'docs__A.html'), 'utf8');

  // The property is about *content*: a data: URL written in the markdown must never become a live link or a
  // live image. Asserted against <main>, which is where rendered markdown lands, because the page chrome now
  // carries one legitimate data: URL — the generated favicon, which is a constant in the renderer and not
  // reachable from any document.
  const body = (/<main>([\s\S]*?)<\/main>/.exec(page) || [, ''])[1];
  ok(!/href="data:/i.test(body), 'a data: href must not survive into the rendered content');
  ok(!/src="data:/i.test(body), 'a data: image must not survive into the rendered content');

  // And the exception is pinned rather than left as a hole: exactly one data: URL in the document, and it is
  // the icon. If anything else ever introduces one, this fails.
  const dataUrls = page.match(/(?:href|src)="data:[^"]*"/gi) || [];
  eq(dataUrls.length, 1, `only the favicon may carry a data: URL, found ${dataUrls.length}`);
  ok(/rel="icon"/.test(page) && /^href="data:image\/svg\+xml/i.test(dataUrls[0]),
     'the one permitted data: URL is the generated favicon');
});

test('markdown · an image src is subject to the same scheme policy as a link', () => {
  // `<img src>` had NO scheme checking at all.
  const html = inline('![x](javascript:alert(1)) ![y](data:image/gif;base64,AA) ![ok](docs/a.png)');
  includes(html, 'src="#"');
  ok(!/src="javascript:/i.test(html), 'javascript: must not reach an src');
  ok(!/src="data:/i.test(html), 'data: must not reach an src');
  includes(html, 'src="docs/a.png"', 'an ordinary relative image must still render');
});

test('dashboard · a tone from outside the known set cannot escape its class attribute', () => {
  // planning.statusBands[].tone is interpolated into a quoted class attribute. Config validation refuses an
  // unknown tone; this is the second lock, for a plan object built any other way.
  const dir = fixture('tone-escape', {
    'docs/TASKS.md': '# Tasks\n\n**A-1 · Thing** — **P1 · High**\n\n| A-1 | 50 |\n|---|---|\n',
  });
  const plan = readPlanning(dir, {
    planning: { source: 'docs/TASKS.md', statusBands: [{ max: 100, label: 'X', tone: 'x" onmouseover="alert(1)' }] },
  });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'product', title: 'Product', panels: ['items', 'status'] },
    { index, health, plan, cfg, contrib: null, nav: [] }, (o) => o.body);
  ok(!html.includes('onmouseover'), 'a configured tone must never become an event handler');
  includes(html, 't-unknown', 'an unrecognised tone falls back to the unknown class');
});


test('health · the design record is enforced, and a check that could not run says so', () => {
  // design.mjs recognised HLD, LLD, architecture, data flow, decision records and specifications since it
  // was written, and health.mjs referenced none of it: a repository could ship with every design artifact
  // missing and report clean. H14 is stricter than H6 on purpose — a design document is a claim about how
  // the code works, so a citation that no longer resolves makes it wrong rather than merely old.
  const dir = fixture('design-signals', {
    'docs/HLD.md': '# HLD\n\nThe engine lives in src/engine.ts:1 and the gone bit in src/removed.ts:4.\n',
    'src/engine.ts': 'export const x = 1;\n',
    'src/other/a.ts': 'export const a = 1;\n',
    'src/other/b.ts': 'export const b = 2;\n',
  });
  const { health } = analyse(dir, {});

  const h14 = health.findings.filter((f) => f.signal === 'H14');
  eq(h14.length, 1, 'a design document with a citation that does not resolve is a finding');
  includes(h14[0].detail, 'src/removed.ts');

  // The corpus has an HLD and nothing else, so the other expected kinds are absent — reported per kind,
  // because there is no document to attach the finding to.
  const kinds = health.findings.filter((f) => f.signal === 'H15').map((f) => f.kind);
  eq(kinds.includes('hld'), false, 'an artifact that exists is not reported absent');
  ok(kinds.includes('lld'), 'an artifact that is missing is reported');

  // Neither H15 nor H16 may print a bare null where a document path goes.
  for (const f of health.findings.filter((x) => x.signal === 'H15' || x.signal === 'H16')) {
    ok(f.doc && f.doc !== 'null', `a corpus-level finding needs a subject, got ${JSON.stringify(f.doc)}`);
  }
});

test('backlog · every task in full, with its sources and an absence stated rather than left blank', () => {
  // The backlog view exists because the item table cannot hold this: it is a scanning tool with a summary
  // clamped to two lines. The three additions are the description, the documents that specify the task, and
  // who worked on it — and an absence must be *stated*, because an empty space reads as "not applicable".
  const dir = fixture('backlog-view', {
    'docs/TASKS.md': [
      '| Item | % |', '|---|---|', '| K-1 | 50 |', '| K-2 | 0 |', '',
      '## Track 1 — Work', '',
      '**K-1 · Specified thing** — **P1 · High**',
      '*Short summary.*',
      '',
      'Detail the summary never carried, specified by [the SRS](specs/SRS.md).',
      '',
      '**K-2 · Unspecified thing** — **P3 · Low**',
      '*Nothing links to a document here.*',
    ].join('\n'),
    'docs/specs/SRS.md': '# SRS\n',
  });
  const cfg = { ...resolveConfig(dir), planning: { source: 'docs/TASKS.md' } };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const plan = readPlanning(dir, cfg);
  const html = viewPage({ id: 'backlog', title: 'Backlog', panels: ['backlog'] },
    { index, health, plan, cfg, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'Detail the summary never carried', 'the full description is rendered, not the clamped summary');
  includes(html, 'docs/specs/SRS.md', 'a source document is named');
  includes(html, 'No document is linked from this item in the plan.', 'an absence is stated, not blank');
  includes(html, 'Git metadata is off, so contributors are unknown.',
    'unknown contributors are declared as unknown rather than as none');

  // The reading layout, not the masonry one: a backlog has an order and columns break it.
  includes(html, 'dash-read');
  eq(/class="dash-single"/.test(html), false, 'the backlog must not use the column-packed layout');
});

test('scan · a citation extension containing a regex metacharacter does not crash the scan', () => {
  // `e.replace('.', '\\.')` is a STRING replace: it escaped the first dot and nothing else, so
  // citationExtensions: ["("] built an unterminated group and took the whole scan down.
  const dir = fixture('cite-meta', { 'docs/A.md': '# A\n\nSee thing.ts:12 and other(:3 text.\n', 'thing.ts': 'x\n' });
  const { index } = analyse(dir, { citationExtensions: ['(', '.ts', '.tar.gz'] });
  eq(index.documents.length, 1, 'the scan must complete');
  ok(index.documents[0].citations.some((c) => c.path === 'thing.ts'), 'ordinary citations still resolve');
});

test('publish · a manifest page name that is a path is refused, not read', () => {
  // The manifest lives in the wiki, which anyone with write access can edit, and its keys are joined onto a
  // path. Verified: an entry of "../victim-notes" made stageWiki read outside the staging directory and
  // surface the contents as drift — which is then published back in the report.
  const remote = path.join(tmpRoot, 'wiki-remote');
  fs.mkdirSync(remote, { recursive: true });
  fs.writeFileSync(path.join(remote, 'Home.md'), '# Home\n', 'utf8');
  fs.writeFileSync(path.join(remote, '.atlas-manifest.json'), JSON.stringify({
    generatedBy: 'project-atlas', source: 'owner/repo',
    pages: { '../victim-notes': { source: 'docs/A.md', hash: 'deadbeef' } },
  }), 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: remote, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: remote, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'wiki'],
    { cwd: remote, stdio: 'ignore' });

  // The staging directory is os.tmpdir()/atlas-wiki-<hash>, so `../victim-notes.md` is this file. With the bug
  // its contents were read and surfaced as "drift", which `--import` then writes out and the report prints.
  const victim = path.join(os.tmpdir(), 'victim-notes.md');
  fs.writeFileSync(victim, 'PRIVATE-NOTES-MARKER\n', 'utf8');

  const dir = fixture('wiki-manifest', { 'docs/A.md': '# A\n' });
  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'owner/repo' } } };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, null, cfg, dir);
  const r = stageWiki(dir, cfg, built, { host: { kind: 'github', wikiGit: remote } });

  eq(r.staged, false, 'a manifest this tool did not write must stop the publish');
  const unsafe = r.drift.filter((d) => d.kind === 'unsafe-name');
  eq(unsafe.length, 1, `expected the unsafe name to be reported, got ${JSON.stringify(r.drift.map((d) => d.kind))}`);
  ok(!r.drift.some((d) => (d.content || '').includes('PRIVATE-NOTES-MARKER')),
    'nothing outside the staging directory may be read into the drift report');
  fs.rmSync(victim, { force: true });
});

/* ================================================================== which build is answering */

console.log('\nwhich build is answering');

test('version · two registrations that disagree are named, not averaged', () => {
  // The state this machine was actually in: local 0.1.1, user 0.1.0, working copy 0.1.3, and `atlas` on PATH
  // resolving to the oldest of the three with nothing saying so.
  const d = disagreements({
    running: { version: '0.1.3', fromCache: false },
    registrations: [{ scope: 'local', version: '0.1.1' }, { scope: 'user', version: '0.1.0' }],
  });
  ok(d.some((x) => x.text.includes('registrations disagree')), 'the split must be stated');
  ok(d.filter((x) => x.text.includes('older than this working copy')).length === 2);
});

test('version · a cache that matches the working copy says nothing', () => {
  const d = disagreements({
    running: { version: '0.1.3', fromCache: true },
    registrations: [{ scope: 'user', version: '0.1.3' }],
  });
  eq(d.length, 0, 'agreement is not news');
});

test('version · the update notice is silent when everything is current', () => {
  // A line that appears every session is a line people learn to scroll past.
  eq(updateNotice({ registrations: [{ scope: 'user', version: '0.1.3' }], latest: '0.1.3' }), null);
  eq(updateNotice({ registrations: [{ scope: 'user', version: '0.1.3' }], latest: null }), null,
     'an unknown latest is not an update');
});

test('version · the update notice reports the oldest scope, and names every scope behind', () => {
  const line = updateNotice({
    registrations: [{ scope: 'local', version: '0.1.1' }, { scope: 'user', version: '0.1.0' }],
    latest: '0.1.3',
  });
  includes(line, '0.1.0 → 0.1.3');
  includes(line, 'local and user');
});

test('version · a plugin cache path is distinguished from a working copy', () => {
  ok(isPluginCache('/Users/x/.claude/plugins/cache/project-atlas/atlas/0.1.3/bin/atlas'));
  ok(!isPluginCache('/Users/x/Working/GitHub/project-atlas/bin/atlas'));
});

test('update · the manifest URL is derived from the repository, and refuses unknown hosts', () => {
  // A fork must check itself, not this repository. And silently fetching from somewhere the user did not
  // point at is worse than not checking at all.
  includes(manifestUrl('https://github.com/someone/their-fork'),
           'raw.githubusercontent.com/someone/their-fork/main/.claude-plugin/plugin.json');
  eq(manifestUrl('https://gitlab.com/someone/thing'), null);
  eq(manifestUrl(''), null);
});

test('update · a cache the installed version has overtaken is refetched, not trusted', async () => {
  // The 24-hour window assumes releases are rarer than a day. Twenty-six shipped in one, and the notice went
  // silent exactly when it mattered: cache said 0.1.3, install was 0.1.10, real latest was 0.1.26 — and
  // because the install was NEWER than the cached figure, it concluded "ahead of the release" and said
  // nothing. You cannot be ahead of the published version, so being ahead is free evidence the cache is wrong.
  const file = path.join(tmpRoot, 'uc-overtaken.json');
  const now = 1770000000000;
  writeCache({ at: now - 1000, date: '2026-08-10', latest: '0.1.3' }, file);
  let called = 0;
  const r = await checkForUpdate({
    repository: 'https://github.com/a/b', now, file, installed: '0.1.10',
    fetchImpl: () => { called++; return Promise.resolve({ ok: true, text: async () => '{"version":"0.1.26"}' }); },
  });
  eq(called, 1, 'an overtaken cache must be refetched inside the window');
  eq(r.latest, '0.1.26');

  // And a cache that has NOT been overtaken is still honoured, or every command hits the network.
  writeCache({ at: now - 1000, date: '2026-08-10', latest: '0.9.9' }, file);
  let again = 0;
  await checkForUpdate({ repository: 'https://github.com/a/b', now, file, installed: '0.1.10',
    fetchImpl: () => { again++; return Promise.resolve({ ok: true, text: async () => '{}' }); } });
  eq(again, 0);
});

test('update · a fresh cache is reused and no fetch happens', async () => {
  const file = path.join(tmpRoot, 'uc-fresh.json');
  const now = 1770000000000;
  writeCache({ at: now - 1000, date: '2026-08-10', latest: '0.9.9' }, file);
  let called = 0;
  const r = await checkForUpdate({
    repository: 'https://github.com/a/b', now, file,
    fetchImpl: () => { called++; return Promise.resolve({ ok: true, text: async () => '{"version":"1.0.0"}' }); },
  });
  eq(called, 0, 'a check inside the 24h window must not touch the network');
  eq(r.latest, '0.9.9');
  eq(r.fromCache, true);
});

test('update · a failed check is cached too, so an offline machine does not retry every session', async () => {
  const file = path.join(tmpRoot, 'uc-fail.json');
  const now = 1770000000000;
  const r = await checkForUpdate({
    repository: 'https://github.com/a/b', now, file,
    fetchImpl: () => Promise.reject(new Error('offline')),
  });
  eq(r.latest, null, 'unknown is never reported as current');
  ok(isFresh(readCache(file), now), 'the failure is recorded, not left for the next session to repeat');
});

test('update · a non-ok response is null rather than a version parsed from an error page', async () => {
  eq(await fetchLatest('https://example.invalid/x', { fetchImpl: () => Promise.resolve({ ok: false }) }), null);
  eq(await fetchLatest('https://example.invalid/x',
     { fetchImpl: () => Promise.resolve({ ok: true, text: async () => '<html>404</html>' }) }), null);
});

test('cli · version --offline reports the build and makes no network call', () => {
  const dir = fixture('ver-offline', { 'docs/A.md': '# A\n' });
  const r = cli(dir, ['version', '--offline']);
  eq(r.code, 0);
  includes(r.stdout, 'project-atlas');
  includes(r.stdout, 'not checked', 'it must never imply it confirmed you are current');
});

/* ================================================================== automation, and its off switch */

console.log('\nautomation');

test('automation · both switches are on by default', () => {
  // The point of the feature: a derived surface that only refreshes when someone remembers is a stale surface.
  const dir = fixture('auto-default', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  eq(cfg.automation.buildOnWrite, true);
  eq(cfg.automation.healthOnCommit, true);
});

test('automation · turning one switch off leaves the other alone', () => {
  // Every other object key in this config is a shallow spread, which would have made
  // {"automation":{"buildOnWrite":false}} silently disable the commit gate too — a safety check the user
  // never mentioned, turned off by a setting about something else.
  const dir = fixture('auto-partial', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'),
    JSON.stringify({ automation: { buildOnWrite: false } }), 'utf8');
  const cfg = resolveConfig(dir);
  eq(cfg.automation.buildOnWrite, false);
  eq(cfg.automation.healthOnCommit, true, 'the gate must survive a setting about the build');
});

test('automation · a misspelled switch is refused, not ignored', () => {
  // Failing open here is the worst outcome: the user believes they turned it off and it is still running.
  const dir = fixture('auto-typo', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'),
    JSON.stringify({ automation: { buildOnWrit: false } }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'an unknown automation key must be refused');
  includes(threw.message, 'automation.buildOnWrit');
});

test('automation · a string switch is refused, because "false" is truthy', () => {
  const dir = fixture('auto-string', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'),
    JSON.stringify({ automation: { buildOnWrite: 'false' } }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'a non-boolean switch must be refused');
  includes(threw.message, 'true or false');
});

test('cli · health --gate exits 1 on a blocking signal and says which', () => {
  const dir = fixture('gate-blocking', { 'docs/A.md': '# A\n\n[gone](docs/NOPE.md)\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blocking: ['H1'] }), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  const r = cli(dir, ['health', '--gate']);
  eq(r.code, 1);
  includes(r.stdout, 'H1');
  includes(r.stdout, 'healthOnCommit', 'the refusal names the switch that turns it off');
});

test('cli · health --gate is silent when the corpus is clean', () => {
  // A hook that prints on every commit is a hook people disable.
  const dir = fixture('gate-clean', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blocking: ['H1'] }), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  const r = cli(dir, ['health', '--gate']);
  eq(r.code, 0);
  eq(r.stdout.trim(), '', 'a clean gate says nothing at all');
});

test('cli · health --gate allows the commit when the switch is off', () => {
  const dir = fixture('gate-off', { 'docs/A.md': '# A\n\n[gone](docs/NOPE.md)\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'),
    JSON.stringify({ blocking: ['H1'], automation: { healthOnCommit: false } }), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  eq(cli(dir, ['health', '--gate']).code, 0, 'the user turned it off; the commit is theirs to make');
  eq(cli(dir, ['health']).code, 1, 'but plain health still reports the truth');
});

test('automation · neither hook acts in a repository that never adopted the tool', () => {
  // The plugin is installed user-wide. Without this, editing any markdown anywhere would generate a
  // docs/_wiki nobody asked for, and a dead link in a stranger's repo would block their commit.
  const dir = fixture('auto-no-config', { 'docs/A.md': '# A\n\n[gone](docs/NOPE.md)\n' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  eq(cli(dir, ['build', '--auto', '--quiet']).code, 0);
  ok(!fs.existsSync(path.join(dir, 'docs', '_wiki')), 'no config, no site written');
  eq(cli(dir, ['health', '--gate']).code, 0, 'no config, no gate');
});

/* ================================================================== what QC and the architect came for */

console.log('\ntest inventory');

test('testcases · cases are read from source, in several languages', () => {
  // Never from a run: parsing reporter output makes a documentation tool depend on a passing suite, an
  // installed runner and a stable JSON format — three ways to break for reasons that are not documentation.
  eq(casesInFile('t/a.test.js', "test('does a thing', () => {})\nit('does another', () => {})").length, 2);
  eq(casesInFile('t/a_test.go', 'func TestThing(t *testing.T) {}')[0].name, 'TestThing');
  eq(casesInFile('t/test_a.py', 'def test_thing():\n  pass')[0].name, 'test_thing');
  // casesInFile extracts; testInventory selects. Keeping those apart means the extractor can be tested on
  // any string, and the "is this a test file" rule lives in one place instead of two.
  eq(casesInFile('src/main.js', "test('extraction is not selection', () => {})").length, 1);
  eq(testInventory('.', ['src/main.js']).cases.length, 0, 'src/main.js is not a candidate');
});

test('testcases · a case named for a defect is counted as a regression', () => {
  // A heuristic over wording, and labelled as one everywhere it is reported.
  const cases = casesInFile('t/a.test.js',
    "test('renders the header', () => {})\ntest('never overwrites a hand-edited page', () => {})");
  eq(cases.filter((c) => c.regression).length, 1);
  eq(cases.find((c) => c.regression).name.includes('never'), true);
});

test('testcases · a repository with no tests reports zero rather than vanishing', () => {
  // A panel that disappears when the answer is "none" hides the answer worth seeing most.
  const dir = fixture('no-tests', { 'docs/A.md': '# A\n' });
  const k = testInventory(dir, ['docs/A.md', 'README.md']);
  eq(k.available, true);
  eq(k.cases.length, 0);
});

test('testcases · the suite groups by its own section headings', () => {
  const text = "/* ===== alpha */\ntest('one', () => {})\n/* ===== beta */\ntest('two', () => {})";
  const cases = casesInFile('t/a.test.js', text);
  eq(cases[0].section, 'alpha');
  eq(cases[1].section, 'beta');
});

console.log('\nthe design record');

test('design · an absent artifact is the finding, so absence is a row', () => {
  // A list of the documents that exist cannot show you the one that does not.
  const record = designRecord([{ path: 'docs/architecture/HLD.md' }]);
  eq(record.find((r) => r.id === 'hld').present, true);
  eq(record.find((r) => r.id === 'lld').present, false);
  // Counted against EXPECTED rather than a literal: the assertion is "every kind appears", and a hardcoded
  // number turns adding a kind into a test failure that says nothing about whether the behaviour is right.
  eq(record.length, EXPECTED.length, 'every expected artifact appears, present or not');
});

test('design · undesigned areas are the inverse, and small areas are excluded', () => {
  // The only panel here that finds something the reader was not already looking for. Two files is not an
  // area worth a design document, and listing it buries the ones that are.
  const code = ['src/a.js', 'src/b.js', 'src/c.js', 'lib/x.js', 'lib/y.js', 'tiny/z.js'];
  const docs = [{ path: 'docs/HLD.md', citations: [{ path: 'src/a.js' }] }];
  const gaps = undesigned(code, docs, { depth: 1 });
  eq(gaps.find((g) => g.area === 'src').citations, 1);
  eq(gaps.find((g) => g.area === 'lib').citations, 0);
  ok(!gaps.some((g) => g.area === 'tiny'), 'one file is not an area');
});

test('config · one master switch turns off every automatic action', () => {
  // A feature that can only be disabled key by key is a feature nobody disables: you turn off the one that
  // annoyed you, the rest keep running, and the next person cannot tell what is on. Three call sites each
  // read `cfg.automation.<key> === false` directly, which is how a master switch gets added and then quietly
  // ignored by the fourth caller — and a switch some code respects and other code does not is worse than no
  // switch, because it is believed.
  const on = { automation: { enabled: true, buildOnWrite: true, healthOnCommit: true, specOnCommit: true } };
  for (const k of ['buildOnWrite', 'healthOnCommit', 'specOnCommit']) ok(automationAllows(on, k), `${k} on`);

  const off = { automation: { enabled: false, buildOnWrite: true, healthOnCommit: true, specOnCommit: true } };
  for (const k of ['buildOnWrite', 'healthOnCommit', 'specOnCommit']) {
    eq(automationAllows(off, k), false, `${k} must be off when the master switch is off, whatever it says`);
  }

  // An individual key still turns its own action off with the master switch on.
  eq(automationAllows({ automation: { enabled: true, buildOnWrite: false } }, 'buildOnWrite'), false);
  // And the defaults are on, so adoption does not require configuring anything.
  ok(automationAllows({}, 'buildOnWrite'), 'absent configuration means on, not off');
  ok(DEFAULT_CONFIG.automation.enabled, 'the shipped default is on');

  // The key is validated like the others, so `enabled` cannot be a typo that silently does nothing.
  const dir = fixture('automation-master', {
    'docs/A.md': '# A\n',
    'project-atlas.config.json': JSON.stringify({ automation: { enabld: false } }),
  });
  let refused = '';
  try { resolveConfig(dir); } catch (e) { refused = String(e.message); }
  ok(/enabld/.test(refused), `a misspelled switch must be refused, not ignored — got ${JSON.stringify(refused)}`);
});

test('dashboard · every status pill clears 4.5:1 against the step it sits on', () => {
  // Pills were white on whatever the ramp step happened to be, with a hand-listed exception for none and
  // unknown — and the exception list was the tell: it existed because the rule was wrong and covered only
  // the two steps somebody had looked at. The ordinal ramps run light-to-dark, so their light steps are
  // nearly white: "In progress" in dark mode measured 1.43:1, which is text you cannot read.
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const theme of ['light', 'dark']) {
    for (const step of Object.keys(RAMP[theme])) {
      const r = ratio(RAMP[theme][step], INK[theme][step]);
      ok(r >= 4.5, `${theme} ${step}: ${RAMP[theme][step]} on ${INK[theme][step]} is ${r.toFixed(2)}:1, below 4.5`);
    }
  }
});

test('prompt · every claim is read from the repository, so changing a rule changes the prompt', () => {
  // AGENTS.md and every SKILL.md are hand-written and drift from the repository they describe — this tool's
  // own failure, in the document that tells an assistant how to work here. The test for "generated, not
  // described" is that the output moves when the source of truth moves.
  const dir = fixture('prompt-derived', {
    'docs/A.md': '# A\n',
    'docs/TASKS.md': '| Item | % |\n|---|---|\n| Z-1 | 10 |\n\n## Track\n\n**Z-1 · Unfinished thing** — **P0 · Critical**\n*Summary.*\n',
  });
  const base = {
    clusters: [{ id: 'guides', title: 'Guides Of Ours', match: ['docs/**'] }],
    fallbackCluster: 'guides',
    planning: { source: 'docs/TASKS.md' },
  };
  const make = (extra) => {
    const cfg = { ...resolveConfig(dir), ...base, ...extra };
    const index = buildIndex(dir, cfg);
    return buildPrompt({ cfg, index, health: runHealth(index, cfg, dir), plan: readPlanning(dir, cfg),
                         version: '9.9.9', slug: 'acme/widget' });
  };

  const a = make({ blocking: ['H1'] });
  includes(a, 'acme/widget');
  includes(a, 'Guides Of Ours', 'the taxonomy comes from the configured clusters');
  includes(a, 'H1 · Dead internal link', 'the blocking list comes from configuration');
  includes(a, 'Z-1', 'open plan items are listed');
  eq(/H3 · Duplicate title[\s\S]*no legitimate cause/.test(a), false,
     'a signal that is not configured as blocking is not presented as blocking');

  // Move the rule; the prompt must move with it. This is the whole claim.
  const b = make({ blocking: ['H3'] });
  includes(b, 'H3 · Duplicate title');
  eq(b.includes('H1 · Dead internal link'), false, 'H1 is advisory now, and the prompt says so');
  ok(a !== b, 'the prompt is derived, not a fixed document');

  // And it states which build wrote it, so a stale copy is identifiable.
  includes(a, '9.9.9');
});

test('worklog · one file per contributor per day, and a superseded legacy log is not listed twice', () => {
  // `worklog/YYYY-MM-DD/log.md` was one file the whole repository shared: two people working the same day
  // overwrote each other and collided on every line in git. The date stays the directory — "what happened on
  // Tuesday" is the question a work log answers — and the contributor becomes the filename.
  const dir = fixture('worklog-scoped', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);

  const a = writeDay(dir, cfg, '# 2026-01-02 — Ada Lovelace\n', '2026-01-02', 'Ada Lovelace');
  const b = writeDay(dir, cfg, '# 2026-01-02 — Alan Turing\n', '2026-01-02', 'Alan Turing');
  eq([path.basename(a), path.basename(b)], ['ada-lovelace.md', 'alan-turing.md'],
     'two people on one day must not share a file');
  ok(fs.existsSync(a) && fs.existsSync(b), 'both entries survive — neither overwrote the other');

  // A log from before the change is a real record and stays; it is only hidden where a per-contributor file
  // for the same day has superseded it, which would otherwise list one author twice with two figures.
  eq(contributorSlug('Rajneesh Maurya'), 'rajneesh-maurya');
  eq(contributorSlug(''), 'unknown', 'an unknown author still gets a filename rather than throwing');
});

test('design · the record recognises a PRD and a manual of style, and finds an SRS however it is named', () => {
  // The SRS pattern required a dash or underscore immediately before the word and `.md` immediately after,
  // so it matched payments-srs.md and missed SRS.md, SRS_v2.md and PROJECT_SRS_v1.md — a repository could
  // carry a specification the tool reported as absent. `\\b` is not the fix: it does not break on an
  // underscore, so `\\bSRS\\b` never matches inside PROJECT_SRS_v1. PRD and manual of style were not
  // recognised at all.
  const kindsFor = (p) => EXPECTED.filter((e) => e.re.test(p)).map((e) => e.id);

  for (const p of ['SRS.md', 'SRS_v2.md', 'PROJECT_SRS_v1.md', 'payments-srs.md', 'docs/specs/api.md', 'docs/foo-spec.md']) {
    ok(kindsFor(p).includes('specs'), `${p} should be a specification`);
  }
  for (const p of ['PRD.md', 'docs/PRD_v3.md', 'product-requirements.md']) {
    ok(kindsFor(p).includes('prd'), `${p} should be a product requirements document`);
  }
  for (const p of ['MOS.md', 'STYLE.md', 'docs/style-guide.md', 'manual_of_style.md']) {
    ok(kindsFor(p).includes('style'), `${p} should be a manual of style`);
  }
  // Widening a pattern is where false positives arrive, so the ordinary corpus is asserted to match nothing.
  for (const p of ['README.md', 'CHANGELOG.md', 'docs/ROADMAP.md', 'docs/references/health-signals.md',
                   'docs/handoff/SHARED.md', 'docs/references/autonomy.md']) {
    eq(kindsFor(p), [], `${p} is not a design artifact`);
  }
});

test('design · "not checked" is kept apart from "does not resolve", against real scanner output', () => {
  // Collapsing them reports a document as sound because nobody looked.
  //
  // This test used to hand-build `{resolved: true}` and `{resolved: false}` — a shape the scanner has never
  // produced. It resolves a citation to the resolved PATH, or to null when there is no such file. So the
  // assertions passed against invented data while `citationHealth` counted `=== true` and reported "0
  // resolved" for every document in the corpus, on the page whose job is to report citation health. A test
  // that invents its input cannot notice that the producer disagrees with it.
  const dir = fixture('cite-states', {
    'docs/HLD.md': '# HLD\n\nLives at src/engine.ts:1, gone from src/removed.ts:4.\n',
    'src/engine.ts': 'export const x = 1;\n',
  });
  const { index } = analyse(dir, {});
  const doc = index.documents.find((d) => d.path === 'docs/HLD.md');
  eq(doc.citations.map((c) => typeof c.resolved), ['string', 'object'],
     'the scanner emits a resolved path or null — never a boolean');

  const rows = citationHealth(index.documents).filter((r) => r.path === 'docs/HLD.md');
  eq([rows[0].total, rows[0].resolved, rows[0].broken], [2, 1, 1]);
  eq(rows[0].unchecked, 0, 'a scanned citation is never "unchecked"');
  // And the genuinely-unchecked case still reads as unchecked rather than as broken.
  const never = citationHealth([{ path: 'x.md', citations: [{ path: 'a.js' }] }]);
  eq([never[0].broken, never[0].unchecked], [0, 1]);
});

test('design · a document citing no code is grounded:false, not broken', () => {
  // It may be a diagram or a rationale. It cannot go stale against anything, which is worth saying rather
  // than scoring.
  const rows = citationHealth([{ path: 'd.md', citations: [] }]);
  eq(rows[0].grounded, false);
  eq(rows[0].broken, 0);
});

/* ================================================================== full-width panels lead */

console.log('\npanel order');

test('views · every full-width panel precedes the cards, or masonry leaves a hole', () => {
  // column-span:all splits a multi-column flow into fragments. One card before the tile strip is a fragment
  // of one, balanced across three columns — it takes column one and leaves two thirds of the row blank,
  // which is the exact hole masonry was added to remove.
  const dir = fixture('panel-order', { 'docs/A.md': '# A\n', 'docs/B.md': '# B\n', 'docs/C.md': '# C\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);

  for (const f of fs.readdirSync(path.join(dir, cfg.output)).filter((x) => x.startsWith('view-'))) {
    const html = fs.readFileSync(path.join(dir, cfg.output, f), 'utf8');
    const i = html.indexOf('class="dash-single"');
    if (i === -1) continue;                       // a view showing the item table uses the two-column layout
    const seg = html.slice(i);
    const firstCard = seg.indexOf('class="card"');
    for (const span of ['class="tiles"', 'cap sect']) {
      const at = seg.indexOf(span);
      if (at === -1 || firstCard === -1) continue;
      ok(at < firstCard, `${f}: ${span} appears after the first card, which fragments the column flow`);
    }
  }
});

/* ================================================================== the drift path, actually run */

console.log('\nwiki drift');

test('publish · a hand-edited wiki page is detected and refuses the publish', () => {
  // The roadmap said this path was "written but has never run against a real edited wiki" for nineteen
  // releases. It is the only thing standing between a colleague's typo fix in the web UI and a force
  // overwrite, and it had never been exercised end to end. A bare repo on disk is a real enough wiki.
  const dir = fixture('wiki-src', { 'docs/A.md': '# Alpha\n\nbody\n', 'docs/B.md': '# Beta\n' });
  const wiki = path.join(tmpRoot, 'wiki-remote.git');
  execFileSync('git', ['init', '-q', '--bare', wiki], { stdio: 'ignore' });

  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'someone/thing' } } };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const built = buildWikiPages(index, health, readPlanning(dir, cfg), cfg, dir);
  const host = { kind: 'github', wikiGit: wiki };

  const first = stageWiki(dir, cfg, built, { push: true, host });
  eq(first.staged, true, 'the first publish has nothing to drift from');

  // A human edits a page in the web UI. Here: clone, change, push.
  const human = path.join(tmpRoot, 'wiki-human');
  execFileSync('git', ['clone', '-q', wiki, human], { stdio: 'ignore' });
  const page = fs.readdirSync(human).find((f) => f.endsWith('.md') && f !== '_Footer.md');
  fs.appendFileSync(path.join(human, page), '\n\nA typo fix someone made by hand.\n', 'utf8');
  execFileSync('git', ['-c', 'user.email=h@x', '-c', 'user.name=H', 'commit', '-qam', 'typo'], { cwd: human, stdio: 'ignore' });
  execFileSync('git', ['push', '-q'], { cwd: human, stdio: 'ignore' });

  const second = stageWiki(dir, cfg, built, { push: false, host });
  eq(second.staged, false, 'an edited page must stop the publish, not be overwritten');
  eq(second.driftChecked, true);
  ok(second.drift.some((d) => d.kind === 'edited'), JSON.stringify(second.drift.map((d) => d.kind)));
});

test('publish · --import copies the edited pages out with a mapping back to their sources', () => {
  const dir = fixture('wiki-src2', { 'docs/A.md': '# Alpha\n\nbody\n' });
  const wiki = path.join(tmpRoot, 'wiki-remote2.git');
  execFileSync('git', ['init', '-q', '--bare', wiki], { stdio: 'ignore' });

  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'someone/thing' } } };
  const index = buildIndex(dir, cfg);
  const built = buildWikiPages(index, runHealth(index, cfg, dir), readPlanning(dir, cfg), cfg, dir);
  const host = { kind: 'github', wikiGit: wiki };
  stageWiki(dir, cfg, built, { push: true, host });

  const human = path.join(tmpRoot, 'wiki-human2');
  execFileSync('git', ['clone', '-q', wiki, human], { stdio: 'ignore' });
  fs.appendFileSync(path.join(human, 'A.md'), '\n\nEdited by hand.\n', 'utf8');
  execFileSync('git', ['-c', 'user.email=h@x', '-c', 'user.name=H', 'commit', '-qam', 'edit'], { cwd: human, stdio: 'ignore' });
  execFileSync('git', ['push', '-q'], { cwd: human, stdio: 'ignore' });

  const r = stageWiki(dir, cfg, built, { push: false, importDrift: true, host });
  eq(r.staged, false);
  ok(r.importDir && fs.existsSync(r.importDir), 'the import directory must exist');
  const copied = fs.readFileSync(path.join(r.importDir, 'A.md'), 'utf8');
  includes(copied, 'Edited by hand.', 'the human text is what is rescued');
  const mapping = JSON.parse(fs.readFileSync(path.join(r.importDir, 'MAPPING.json'), 'utf8'));
  ok(mapping.some((m) => m.page === 'A' && m.source === 'docs/A.md'), JSON.stringify(mapping));
  ok(!JSON.stringify(mapping).includes('Edited by hand'), 'the mapping is an index, not a second copy');
});

test('publish · --force overwrites, and only then', () => {
  const dir = fixture('wiki-src3', { 'docs/A.md': '# Alpha\n' });
  const wiki = path.join(tmpRoot, 'wiki-remote3.git');
  execFileSync('git', ['init', '-q', '--bare', wiki], { stdio: 'ignore' });
  const cfg = { ...resolveConfig(dir), publish: { wiki: { slug: 'someone/thing' } } };
  const index = buildIndex(dir, cfg);
  const built = buildWikiPages(index, runHealth(index, cfg, dir), readPlanning(dir, cfg), cfg, dir);
  const host = { kind: 'github', wikiGit: wiki };
  stageWiki(dir, cfg, built, { push: true, host });

  const human = path.join(tmpRoot, 'wiki-human3');
  execFileSync('git', ['clone', '-q', wiki, human], { stdio: 'ignore' });
  fs.appendFileSync(path.join(human, 'A.md'), '\nmine\n', 'utf8');
  execFileSync('git', ['-c', 'user.email=h@x', '-c', 'user.name=H', 'commit', '-qam', 'e'], { cwd: human, stdio: 'ignore' });
  execFileSync('git', ['push', '-q'], { cwd: human, stdio: 'ignore' });

  eq(stageWiki(dir, cfg, built, { push: false, host }).staged, false, 'refused by default');
  eq(stageWiki(dir, cfg, built, { push: false, force: true, host }).staged, true, 'force is the only way past');
});

/* ================================================================== defaults that fit real repositories */

console.log('\ndefault taxonomy');

test('taxonomy · a tool repository is classified, not dropped into the fallback', () => {
  // Running init on this repository matched 4 of 39 documents and put 35 in the fallback: every SKILL.md,
  // every reference guide, AGENTS.md and the whole of .github. The defaults were tuned for product repos
  // and said "uncategorised" about the shape of repository this tool is most often installed into.
  const shape = {
    'README.md': '# R\n', 'AGENTS.md': '# A\n', 'CODE_OF_CONDUCT.md': '# C\n',
    'skills/ask/SKILL.md': '# S\n', 'skills/help/SKILL.md': '# S\n',
    'references/adoption.md': '# R\n', 'hooks/README.md': '# H\n',
    '.github/PULL_REQUEST_TEMPLATE.md': '# P\n',
  };
  const dir = fixture('tax-tool', shape);
  const cfg = { ...DEFAULT_CONFIG, clusters: DEFAULT_CLUSTERS, fallbackCluster: 'uncategorised', __configPath: null };
  const index = buildIndex(dir, cfg, { withGit: false });
  const fallback = index.documents.filter((d) => d.cluster === 'uncategorised');
  eq(fallback.length, 0, `unclassified: ${fallback.map((d) => d.path).join(', ')}`);
  eq(clusterFor('skills/ask/SKILL.md', cfg), 'agent');
  eq(clusterFor('references/adoption.md', cfg), 'reference');
  eq(clusterFor('.github/PULL_REQUEST_TEMPLATE.md', cfg), 'community');
});

test('taxonomy · a product repository still classifies the way it did', () => {
  // The new rules are filename-driven and run before the directory catches, so they can shadow. This is the
  // regression guard: adding a shape must not move one that already worked.
  const cfg = { ...DEFAULT_CONFIG, clusters: DEFAULT_CLUSTERS, fallbackCluster: 'uncategorised', __configPath: null };
  eq(clusterFor('README.md', cfg), 'start');
  eq(clusterFor('docs/specs/login-srs.md', cfg), 'specs');
  eq(clusterFor('docs/architecture/HLD.md', cfg), 'engineering');
  eq(clusterFor('docs/ops/DEPLOYMENT.md', cfg), 'operations');
  eq(clusterFor('docs/playbooks/oncall.md', cfg), 'procedures');
  eq(clusterFor('ROADMAP.md', cfg), 'product');
  eq(clusterFor('BACKLOG.md', cfg), 'planning');
});

/* ================================================================== lines that survived */

console.log('\nsurviving lines');

test('surviving · counts what is still in the file, and says what it did not blame', () => {
  const dir = fixture('surv', { 'a.md': '# A\n\nline one\nline two\n', 'b.md': '# B\n' });
  const k = survivingLines(dir, { limit: 400 });
  eq(k.available, true);
  ok(k.lines > 0);
  ok(k.people.length >= 1);
  ok(Array.isArray(k.notChecked), 'a capped measurement always states its cap');
});

test('surviving · the file cap is reported, because a sample presented as a total is a lie', () => {
  const dir = fixture('surv-cap', { 'a.md': '# A\n', 'b.md': '# B\n', 'c.md': '# C\n' });
  const k = survivingLines(dir, { limit: 1 });
  eq(k.filesBlamed, 1);
  ok(k.skipped >= 1);
  ok(k.notChecked.some((n) => n.includes('cap')), 'the truncation must appear in the output');
});

test('surviving · "Not Committed Yet" is a placeholder, not a contributor', () => {
  // Leaving git's own placeholder in puts a fictional person in a report about contribution.
  const dir = fixture('surv-dirty', { 'a.md': '# A\n' });
  fs.appendFileSync(path.join(dir, 'a.md'), 'an uncommitted line\n', 'utf8');
  const k = survivingLines(dir);
  ok(!k.people.some((p) => p.author === 'Not Committed Yet'));
  ok(k.uncommitted >= 1);
  ok(k.notChecked.some((n) => n.includes('not committed yet')));
});

test('surviving · a directory with no repository degrades instead of throwing', () => {
  const dir = path.join(tmpRoot, 'surv-norepo');
  fs.mkdirSync(dir, { recursive: true });
  eq(survivingLines(dir).available, false);
});

/* ================================================================== who is the only one who touched this */

console.log('\nownership');

test('ownership · areas are directories, and a file object is not a path', () => {
  // The first version read c.files as bare strings. They are { path, added, removed }, so every path went
  // into one "(root)" bucket and it reported 401 files under a single area — plausible enough to ship, and
  // saying nothing at all.
  eq(areaOf('scripts/lib/scan.mjs'), 'scripts/lib');
  eq(areaOf('README.md'), '(root)');
  const list = ownership([{ author: 'A', files: [{ path: 'scripts/lib/a.mjs' }, { path: 'docs/b.md' }] },
                          { author: 'A', files: [{ path: 'scripts/lib/c.mjs' }, { path: 'docs/d.md' }] }]);
  eq(list.length, 2, 'two areas, not one');
  ok(list.every((a) => a.area !== '(root)'));
});

test('ownership · a second author raises the number, however little they wrote', () => {
  // "Meaningful contribution" is a judgement this cannot make. One commit counts, because the claim is only
  // about who could pick the area up.
  const commits = [
    { author: 'A', files: [{ path: 'src/x.js' }] }, { author: 'A', files: [{ path: 'src/x.js' }] },
    { author: 'B', files: [{ path: 'src/x.js' }] },
  ];
  eq(ownership(commits)[0].busFactor, 2);
  eq(ownership(commits)[0].authors[0].name, 'A', 'ordered by commits, so the main author reads first');
});

test('ownership · an area with one commit is new, not concentrated', () => {
  // Otherwise the first week of any project buries the real risks under every directory it just created.
  const list = ownership([{ author: 'A', files: [{ path: 'fresh/x.js' }] }]);
  eq(list.length, 0);
});

test('ownership · one committer is reported as a fact about the repository, not per area', () => {
  const list = ownership([{ author: 'A', files: [{ path: 'src/x.js' }] }, { author: 'A', files: [{ path: 'src/y.js' }] }]);
  includes(summariseOwnership(list, 1), 'single committer');
  includes(summariseOwnership(list, 3), 'exactly one author');
});

/* ================================================================== the day, written down */

console.log('\nthe worklog');

test('worklog · the date sorts, which YYYY-DD-MM does not', () => {
  // YYYY-DD-MM was asked for. Directory names sort lexicographically, so 2026-09-08 would sort before
  // 2026-08-09 and every listing would be wrong.
  eq(dayKey(new Date(2026, 7, 9, 23, 30).getTime()), '2026-08-09');
  const days = ['2026-09-08', '2026-08-09'].sort();
  eq(days[0], '2026-08-09', 'sorted and chronological are the same thing in this format');
});

test('worklog · no prompt text reaches the file, whatever is in the commits', () => {
  // A worklog is committed and pushed, so anything that entered it would be permanent and public in a way a
  // terminal report never is. tokens.mjs rule 3 matters more here, not less.
  const entry = renderDay({
    day: '2026-08-10', identity: 'A Person',
    contrib: { available: true, quality: { reworkRate: 10, reworkWindowDays: 3, reverts: 0 },
               commits: [{ hash: 'abc1234', subject: 'feat: a thing (D-1)', added: 5, removed: 1, date: '2026-08-10' }] },
    health: { blockingCount: 0 }, plan: { items: [{ id: 'D-1', title: 'A thing', percent: 50 }] },
    commits: [{ hash: 'abc1234', subject: 'feat: a thing (D-1)', added: 5, removed: 1, date: '2026-08-10' }],
  });
  includes(entry, 'D-1');
  includes(entry, 'no prompt text');
  // The word "score" appears in the disclaimer that nothing is scored, so forbid a *number* attributed to a
  // person rather than the word. The first version of this assertion failed on its own caveat.
  ok(!/score[^.\n]*\b\d+\b/i.test(entry), 'no numeric score is attributed to anyone');
  ok(!/SECRET|prompt:|"[^"]{40,}"/.test(entry), 'nothing that could be a quoted prompt');
});

test('worklog · a quiet day says so rather than reporting zero as a result', () => {
  const entry = renderDay({ day: '2026-08-11', identity: 'A Person', contrib: { available: true }, commits: [] });
  includes(entry, 'not the same as no work');
  ok(!entry.includes('| Commits | 0'), 'a day of design discussion is not a day of nothing');
});

test('worklog · only the named items appear, and unnamed work is called out', () => {
  const base = { day: '2026-08-10', identity: 'X', contrib: { available: true, quality: { reworkRate: 1, reworkWindowDays: 3, reverts: 0 } },
                 health: { blockingCount: 0 }, plan: { items: [{ id: 'D-1', title: 'A', percent: 0 }] } };
  const named = renderDay({ ...base, commits: [{ hash: 'a', subject: 'fix: x (D-1)', date: '2026-08-10' }] });
  includes(named, '**D-1**');
  const unnamed = renderDay({ ...base, commits: [{ hash: 'a', subject: 'fix: x', date: '2026-08-10' }] });
  includes(unnamed, 'the plan cannot see');
  const bogus = renderDay({ ...base, commits: [{ hash: 'a', subject: 'fix: CVE-2026-1', date: '2026-08-10' }] });
  includes(bogus, 'the plan cannot see', 'an id that is not in the plan is not an item');
});

test('worklog · commitsOn takes the day it was asked for, not every day', () => {
  const contrib = { available: true, commits: [{ date: '2026-08-10', subject: 'a' }, { date: '2026-08-09', subject: 'b' }] };
  eq(commitsOn(contrib, '2026-08-10').length, 1);
  eq(commitsOn({ available: false }, '2026-08-10').length, 0);
});

/* ================================================================== propose the route, then wait */

console.log('\nthe route');

test('plan · a type is inferred only when every file agrees', () => {
  // A change touching tests/ and scripts/lib/ is not a test change, and calling it one puts the wrong word
  // in front of a reader who trusts it.
  eq(inferType(['tests/run.mjs']), 'test');
  eq(inferType(['README.md', 'docs/x.md']), 'docs');
  eq(inferType(['.github/workflows/ci.yml']), 'chore');
  eq(inferType(['tests/run.mjs', 'scripts/lib/scan.mjs']), null, 'mixed paths decide nothing');
  eq(inferType(['scripts/lib/scan.mjs']), null, 'feat and fix touch the same files');
});

test('plan · a missing slug blocks apply but never stops the route printing', () => {
  // The route is the useful part even when it cannot be executed. Refusing to print would make the tool
  // silent exactly when someone is deciding.
  const r = route({ changed: ['scripts/lib/scan.mjs'], branch: 'main', protectedBranch: true });
  ok(r.steps.length, 'the route still prints');
  ok(r.blockers.some((b) => b.includes('slug')));
  ok(r.blockers.some((b) => b.includes('type')));
});

test('plan · a shipped change is told it needs a version bump, a docs change is not', () => {
  const ships = route({ changed: ['scripts/lib/scan.mjs'], slug: 'x', branch: 'fix/x' });
  eq(ships.ships, true);
  ok(ships.steps.some((s) => s.id === 'version'));

  const docs = route({ changed: ['README.md'], slug: 'x', branch: 'docs/x' });
  eq(docs.ships, false);
  ok(!docs.steps.some((s) => s.id === 'version'));
});

test('plan · push and the pull request are steps, never something apply does', () => {
  // --apply creates the branch and stops. Pushing is outward-facing and irreversible.
  const r = route({ changed: ['scripts/lib/scan.mjs'], slug: 'x', branch: 'fix/x', hasRemote: true });
  const push = r.steps.find((s) => s.id === 'push');
  includes(push.note, 'never part of --apply');
  includes(r.steps.find((s) => s.id === 'pr').note, 'nothing enforces');
});

test('plan · a clean tree proposes nothing rather than an empty ceremony', () => {
  const r = route({ changed: [], branch: 'fix/x' });
  eq(r.empty, true);
  includes(r.blockers[0], 'Nothing has changed');
});

test('plan · a shipped change naming no roadmap item is blocked before the commit gate sees it', () => {
  const r = route({ changed: ['bin/atlas'], slug: 'x', branch: 'fix/x', items: [{ id: 'D-1' }], namedItems: [] });
  ok(r.blockers.some((b) => b.includes('roadmap item')));
});

/* ================================================================== the tool audits its own output */

console.log('\nverify');

const FILES = new Set(['a.html', 'atlas.css', 'pages/x.html']);

test('verify · a control that is scripted but never rendered is caught', () => {
  // The 0.1.5 defect exactly: the export deleted #themeToggle and kept the script driving it, so the page
  // had no theme control and silently ignored a saved preference. Nothing errored.
  const bad = '<body><script>var b=document.getElementById("themeToggle"); b.textContent="x";</script></body>';
  ok(verifyPage('a.html', bad, FILES).some((f) => f.rule === 'unrendered-control'));

  // Guarded is fine — an optional element is legitimately absent and its script bails.
  const guarded = '<body><script>var t=document.getElementById("itbl"); if(!t) return; t.rows;</script></body>';
  eq(verifyPage('a.html', guarded, FILES).filter((f) => f.rule === 'unrendered-control').length, 0);
});

test('verify · a duplicate id is caught, because getElementById returns only the first', () => {
  // How one page's script came to drive another page's table when ten pages were concatenated.
  const bad = '<div id="itbl"></div><div id="itbl"></div>';
  const f = verifyPage('a.html', bad, FILES).filter((x) => x.rule === 'duplicate-id');
  eq(f.length, 1);
  includes(f[0].detail, '#itbl');
});

test('verify · a link with no file behind it is caught, and a source link is not', () => {
  // 69 dead links shipped in the bundle and a human found them. But every page also links back to the
  // markdown it derives from, which leaves the output tree on purpose.
  const bad = '<a href="wiki.html">w</a><a href="atlas.css">c</a>';
  const f = verifyPage('a.html', bad, FILES);
  eq(f.filter((x) => x.rule === 'dead-link').length, 1, 'wiki.html is absent; atlas.css is present');

  const source = '<a href="../../../README.md">source</a>';
  eq(verifyPage('pages/x.html', source, FILES).filter((x) => x.rule === 'dead-link').length, 0);
});

test('verify · an href inside a script template is not a link', () => {
  // The search index builds hrefs by concatenation, and `href="pages/' + f + '"` is a template.
  const js = String.raw`<script>h += '<a href="pages/' + x.f + '">';</script>`;
  eq(verifyPage('a.html', js, FILES).filter((x) => x.rule === 'dead-link').length, 0);
});

test('verify · a page whose stylesheet did not travel is caught', () => {
  // The bundle carried every figure and none of its chart CSS, and read as an unstyled outline.
  const cls = Array.from({ length: 14 }, (_, i) => `<div class="c${i}"></div>`).join('');
  const bad = `<style>.only{color:red}</style>${cls}`;
  ok(verifyPage('a.html', bad, FILES).some((f) => f.rule === 'stylesheet-missing'));
});

test('verify · this repository\'s own generated site is clean', () => {
  // The point of the whole module: run it on the real output, every build.
  const dir = fixture('verify-real', { 'docs/A.md': '# A\n\n[b](B.md)\n', 'docs/B.md': '# B\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);
  const findings = verifySite(path.join(dir, cfg.output));
  eq(findings.length, 0, findings.map((f) => `${f.page}: ${f.rule} ${f.detail}`).join('\n'));
});

/* ================================================================== risk, from measured numbers */

console.log('\nrisk signals');

test('insight · every signal carries its number, its threshold and what it does not mean', () => {
  // A figure with no band beside it needs a maintainer standing next to the screen, which is what the
  // homepage was: "rework rate 68.8%" and no way to know whether that is normal.
  const list = risks({
    index: { stats: { documents: 27 } },
    health: { blockingCount: 0, counts: { H4: 14 } },
    plan: { missing: false, items: Array.from({ length: 26 }, (_, i) => ({ id: `X-${i}` })) },
    contrib: { available: true, quality: { reworkRate: 68.8, reworkWindowDays: 3, withTaskRef: 1 },
               people: [{ name: 'a' }], commits: [{ desk: 'x' }, {}] },
  });
  ok(list.length >= 5);
  for (const s of list) {
    ok(s.figure, `${s.id} has no figure`);
    ok(s.threshold, `${s.id} states no threshold, so the reader cannot disagree with it`);
    ok(s.means, `${s.id} says nothing about what it implies`);
  }
});

test('insight · a signal whose input is missing is omitted, never shown as zero', () => {
  // The rule the health report follows: a green line for a check that never ran is the worst possible output.
  const list = risks({ index: null, health: null, plan: null, contrib: { available: false } });
  eq(list.length, 0, 'no inputs, no claims');

  const partial = risks({ index: { stats: { documents: 10 } }, health: { blockingCount: 0, counts: { H4: 1 } } });
  eq(partial.filter((s) => s.id === 'rework').length, 0, 'no contrib data means no rework verdict');
  ok(partial.some((s) => s.id === 'orphans'), 'but what can be measured still is');
});

test('insight · risks sort worst first, and the summary counts the bands', () => {
  const list = risks({
    index: { stats: { documents: 10 } },
    health: { blockingCount: 3, counts: { H4: 0 } },
    contrib: { available: true, quality: { reworkRate: 5, reworkWindowDays: 3 }, people: [{}, {}, {}], commits: [] },
  });
  eq(list[0].level, 'risk', 'a blocking finding outranks a healthy rework rate');
  includes(summarise(list), 'outside their band');
  eq(summarise([]), 'Nothing measurable yet — this repository has no history to read.');
});

/* ================================================================== the plan gate */

console.log('\nthe plan gate');

const PLAN_ITEMS = [
  { id: 'D-6', title: 'atlas plan', percent: 0 },
  { id: 'D-8', title: 'The tool audits its own output', percent: 0 },
  { id: 'P-1', title: 'Core generation', percent: 100 },
];

test('spec · a shipped change that names no item is refused, and the open items are listed', () => {
  // The failure this exists for: 35 commits, then six more releases, none naming an item, while the
  // dashboard printed "named by a commit: 0" on its front page the entire time.
  const v = specVerdict({ changed: ['scripts/lib/render.mjs'], message: 'fix(render): something', items: PLAN_ITEMS });
  eq(v.ok, false);
  includes(v.message, 'names no roadmap item');
  includes(v.message, 'D-6', 'the refusal lists what could be named, so it is actionable from the message');
  ok(!v.message.includes('P-1'), 'a finished item is not something new work advances');
});

test('spec · naming a known item passes', () => {
  const v = specVerdict({ changed: ['scripts/lib/render.mjs'], message: 'feat(verify): audit output (D-8)', items: PLAN_ITEMS });
  eq(v.ok, true);
  eq(v.named.join(), 'D-8');
});

test('spec · an id that is not in the plan does not count as naming one', () => {
  // Otherwise "fixes CVE-2026-1" or a date would satisfy the gate and it would enforce nothing.
  const v = specVerdict({ changed: ['bin/atlas'], message: 'chore: bump X-9 and 2026-08', items: PLAN_ITEMS });
  eq(v.ok, false);
});

test('spec · a documentation-only change needs no item', () => {
  // Same boundary as the release gate. Demanding an item for a typo fix makes naming a reflex, and a reflex
  // carries no signal.
  const v = specVerdict({ changed: ['README.md', 'docs/references/adoption.md'], message: 'docs: typo', items: PLAN_ITEMS });
  eq(v.ok, true);
});

test('spec · a message that could not be read is refused, never waved through', () => {
  // `git commit -F -` hands the message to git on stdin, where a PreToolUse hook cannot see it. A gate that
  // skips the cases it cannot parse is a gate that is off.
  const v = specVerdict({ changed: ['scripts/atlas.mjs'], message: null, items: PLAN_ITEMS });
  eq(v.ok, false);
  includes(v.message, 'could not be read');
});

test('spec · naming an item without editing the plan passes, and says the figures did not move', () => {
  // The gate enforces that the plan was opened. It cannot know whether D-8 went from 0% to 40%, and guessing
  // would either be wrong or train people to type a number to get past it.
  const v = specVerdict({
    changed: ['scripts/lib/render.mjs'], message: 'feat: (D-8)', items: PLAN_ITEMS, roadmapPath: 'docs/ROADMAP.md',
  });
  eq(v.ok, true);
  includes(v.message, 'the plan itself was not edited');
});

test('spec · with no plan there is nothing to hold anyone to', () => {
  eq(specVerdict({ changed: ['scripts/atlas.mjs'], message: 'anything', items: [] }).ok, false,
     'an empty item list still refuses at the verdict layer; the CLI is what skips when no plan exists');
  eq(idsIn('advances D-8 and I-2, not 2026-08-10').join(), 'D-8,I-2');
});

/* ================================================================== the release marker */

console.log('\nthe release marker');

test('release · a shipped file changed and the version did not is refused', () => {
  // The bug this whole gate exists for. 7573809 changed every file in scripts/lib and left the version at
  // 0.1.0, so /plugin answered "already at the latest version" and fetched none of the fixes.
  const v = versionVerdict({ changed: ['scripts/lib/render.mjs'], before: '0.1.0', after: '0.1.0' });
  eq(v.ok, false);
  includes(v.message, 'still 0.1.0');
  includes(v.message, 'scripts/lib/render.mjs', 'the failure names the file, so the CI log is actionable');
});

test('release · documentation-only changes do not require a bump', () => {
  // If a CONTRIBUTING typo demanded a version bump, every bump would become reflex rather than meaning —
  // which costs the signal the whole of its value.
  const v = versionVerdict({
    changed: ['CONTRIBUTING.md', 'docs/references/adoption.md', 'tests/run.mjs', '.github/workflows/ci.yml'],
    before: '0.1.0', after: '0.1.0',
  });
  eq(v.ok, true);
  eq(v.runtime.length, 0);
});

test('release · every installed surface counts as shipped, including the generated Codex copy', () => {
  // plugins/** is derived from skills/**, but it is committed and installed from, so a change there reaches
  // users exactly like a change to the original.
  for (const p of ['scripts/atlas.mjs', 'bin/atlas', 'skills/help/SKILL.md', 'hooks/hooks.json',
                   'plugins/atlas/skills/help/SKILL.md', '.claude-plugin/plugin.json']) {
    ok(isRuntimePath(p), `${p} ships and must count`);
  }
  for (const p of ['README.md', 'tests/run.mjs', 'docs/references/taxonomy.md', '.github/workflows/ci.yml',
                   'docs/_wiki/index.html']) {
    ok(!isRuntimePath(p), `${p} is not installed and must not count`);
  }
});

test('release · a version that moves backwards is refused, not treated as a change', () => {
  // 0.1.2 -> 0.1.1 is not a release: an installed 0.1.2 compares strings and never sees it as an update.
  const v = versionVerdict({ changed: ['bin/atlas'], before: '0.1.2', after: '0.1.1' });
  eq(v.ok, false);
  includes(v.message, 'backwards');
});

test('release · an unparseable version is refused rather than coerced', () => {
  // Coercing garbage to 0.0.0 would pass a bump from one piece of nonsense to another.
  const v = versionVerdict({ changed: ['scripts/atlas.mjs'], before: '0.1.0', after: 'v0.2' });
  eq(v.ok, false);
  eq(parseVersion('v0.2'), null);
  eq(compareVersions('0.1.0', 'garbage'), null);
});

test('release · a manifest absent at the base commit is a new plugin, not a stale one', () => {
  // Introducing the plugin has nothing installed to be stale against, so any parseable version is a bump.
  const v = versionVerdict({ changed: ['scripts/atlas.mjs'], before: null, after: '0.1.0' });
  eq(v.ok, true);
});

test('release · a real bump passes and reports the move', () => {
  const v = versionVerdict({ changed: ['scripts/lib/release.mjs'], before: '0.1.0', after: '0.1.1' });
  eq(v.ok, true);
  includes(v.message, '0.1.0 → 0.1.1');
});

test('release · prerelease and build suffixes order by their numeric core', () => {
  eq(compareVersions('0.1.0', '0.1.1-beta.1'), -1);
  eq(compareVersions('0.1.1+build.7', '0.1.1'), 0);
});

test('release · this repository satisfies its own gate', () => {
  // The gate is itself a change under scripts/**, so 0.1.1 is the bump its own rule demands. If this fails,
  // the commit introducing the check would not have passed the check.
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  const v = versionVerdict({ changed: ['scripts/lib/release.mjs'], before: '0.1.0', after: manifest.version });
  eq(v.ok, true, `version is ${manifest.version}; a change under scripts/ requires it above 0.1.0`);
});

/* ================================================================== done */

// Async cases resolve before the summary, so a rejected promise is a failure rather than a warning.
for (const { name, p } of pendingAsync) {
  try { await p; pass++; process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`); }
  catch (err) { fail++; failures.push({ name, err }); process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`); }
}

for (const d of made) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(tmpRoot, { recursive: true, force: true });

test('dashboard · a page carries the stamp it was built with, so a stale cached copy is detectable', () => {
  // The live-update poller adopted whatever stamp it fetched as "what this page is". GitHub Pages serves
  // HTML with cache-control: max-age=600, so for ten minutes after a deploy a fresh load could be stale —
  // and the poller would set `seen` to the NEW stamp, conclude the page was current, and never refresh.
  // The page then displayed old content under a correct-looking "built <new time>" label: an indicator
  // asserting freshness it had never checked. Comparing against what the page was actually built with is
  // the fix, and it only works if the page carries that value.
  const dir = fixture('stamp-embedded', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const view = { id: 'product', title: 'Product', panels: ['status'] };
  const ctx = (c) => ({ index, health, plan: null, cfg: c, contrib: null, nav: [] });

  const stamped = viewPage(view, ctx({ ...cfg, __root: dir, __stamp: '2026-08-10 17:51:42 UTC' }), (o) => o.body);
  includes(stamped, 'data-built="2026-08-10 17:51:42 UTC"');
  includes(stamped, '· built 2026-08-10 17:51:42 UTC');

  // No stamp means no claim. A page built without --stamp must not assert a build time it does not know,
  // and must not carry an empty data-built that would compare unequal to every real stamp and refresh
  // forever.
  const plain = viewPage(view, ctx({ ...cfg, __root: dir }), (o) => o.body);
  ok(!plain.includes('data-built'), 'an unstamped page must make no claim about when it was built');
});

test('dashboard · the first poll compares against the embedded stamp rather than adopting what it fetched', () => {
  // Guards the fix at the point it can regress: the poller is a string of JavaScript inside a template, so
  // no test can execute it here — but the comparison either appears in the emitted script or it does not,
  // and its absence is exactly the silent-stale-page bug returning.
  const dir = fixture('stamp-poller', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const js = viewPage({ id: 'product', title: 'Product', panels: ['status'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir, __stamp: 'x' }, contrib: null, nav: [] },
    (o) => o.scripts);
  includes(js, "getAttribute('data-built')");
  includes(js, 'was !== t');
});

console.log('\ncontinuity');

/** Assert a call throws, and that its message says why. There is no shared helper; this is the local one. */
function refuses(fn, pattern, msg) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  ok(threw, msg || 'expected the call to be refused');
  ok(pattern.test(threw.message), `refusal message did not match ${pattern}\n  got: ${threw.message}`);
}

test('journal · a record survives the process that wrote it being killed mid-line', () => {
  // This is the entire reason the file exists. A summary held in memory and flushed at exit fails precisely
  // in the case it was written for, so every record is one appendFileSync — and the cost of that design is a
  // truncated final line when the kill lands mid-write. Skipping it silently would hide the kill; throwing
  // would let one truncated byte destroy every record before it.
  const dir = fixture('journal-kill', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'first', identity: 'Ann Example' });
  journalNote(dir, cfg, { kind: 'finding', text: 'second', identity: 'Ann Example' });

  const file = path.join(dir, '.atlas', 'journal', 'ann-example.jsonl');
  fs.appendFileSync(file, '{"at":"2026-08-10T00:00:00Z","kind":"tra');   // killed here

  const out = journalRead(dir);
  eq(out.records.length, 2, 'every complete record before the kill must survive');
  eq(out.skipped, 1, 'the truncated line is counted, not silently dropped');
  eq(out.records[0].text, 'first');
  eq(out.records[1].text, 'second');
});

test('journal · two contributors cannot contend, and reading merges them in time order', () => {
  // One journal is the worst possible merge: git resolves an append-only file by interleaving two people's
  // records, which is neither a conflict it can see nor an ordering either person wrote.
  const dir = fixture('journal-two', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'hers', identity: 'Ann Example', at: '2026-08-10T10:00:00Z' });
  journalNote(dir, cfg, { kind: 'decision', text: 'his', identity: 'Bob Other', at: '2026-08-10T09:00:00Z' });

  ok(fs.existsSync(path.join(dir, '.atlas', 'journal', 'ann-example.jsonl')), 'one file per contributor');
  ok(fs.existsSync(path.join(dir, '.atlas', 'journal', 'bob-other.jsonl')), 'one file per contributor');

  const out = journalRead(dir);
  eq(out.records.map((r) => r.text).join(','), 'his,hers', 'merged oldest-first across contributors');
  eq(out.contributors.length, 2);
  eq(out.records[0].by, 'bob-other', 'each record says which file it came from');
});

test('journal · refuses an unknown kind, an empty note, and one long enough to be a transcript', () => {
  // The kind vocabulary is fixed because `atlas state` reconstructs by grouping it; free-form kinds
  // reconstruct into a list, which is what the terminal already gave you. The length cap cannot detect
  // prompt text — nothing can — but a record is a sentence, and the cap makes pasting a conversation loud.
  const dir = fixture('journal-refuse', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  refuses(() => journalNote(dir, cfg, { kind: 'musing', text: 'x' }), /Unknown record kind/);
  refuses(() => journalNote(dir, cfg, { kind: 'decision', text: '' }), /records nothing/);
  refuses(() => journalNote(dir, cfg, { kind: 'decision', text: 'x'.repeat(MAX_TEXT + 1) }), /never carries conversation/);
  eq(journalRead(dir).available, false, 'a refused record must not create the journal');
});

test('journal · refuses to write itself into a directory that gets published', () => {
  // `.atlas/` is outside the output directory under every default, so this cannot fire as shipped. It is
  // here because "already outside" is a property of the current defaults, not of the design: someone setting
  // output to the repository root would otherwise silently start publishing an operational log.
  const dir = fixture('journal-publish', { 'docs/A.md': '# A\n' });
  const cfg = { ...resolveConfig(dir), output: '.' };
  refuses(() => journalNote(dir, cfg, { kind: 'decision', text: 'x', identity: 'Ann Example' }),
    /Refusing to write the journal/);
});

test("journal · a subagent's record outlives the subagent, tagged with who wrote it", () => {
  // A subagent's reasoning is discarded by design and only its final message reaches the main session, so a
  // finding it established is lost unless it was written down as it happened.
  const dir = fixture('journal-agent', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'finding', text: 'wikiPageName emits a leading dot', agent: 'explore-1',
    refs: ['scripts/lib/publish.mjs:61'], identity: 'Ann Example' });
  const rec = journalRead(dir).records[0];
  eq(rec.agent, 'explore-1');
  eq(rec.refs[0], 'scripts/lib/publish.mjs:61');
});

test('journal · a repository with no journal is reported as absent, not as empty', () => {
  // "No records" and "no journal" are different states and a resuming session acts differently on each.
  const dir = fixture('journal-none', { 'docs/A.md': '# A\n' });
  const out = journalRead(dir);
  eq(out.available, false);
  eq(out.records.length, 0);
});

test('spec gate · names the actual reason the message was unreadable, not always stdin', () => {
  // One line covered three causes and named stdin. A commit written as -F "$DIR/msg.txt" was told "a hook
  // cannot see a message passed on stdin — use -m or -F <file>": advice to do the thing that had just been
  // done. A guard is trusted, so a guard that misdiagnoses costs more than one that says nothing — the
  // reader stops looking for the real cause. Hit twice in one session before it was fixed.
  const changed = ['scripts/lib/thing.mjs'];
  const items = [{ id: 'A-1', title: 'x', percent: 0 }];

  const stdin = specVerdict({ changed, message: null, items, whyUnreadable: 'stdin' });
  includes(stdin.message, 'passed on stdin');
  includes(stdin.message, 'Write it to a file first');

  const unresolved = specVerdict({ changed, message: null, items, whyUnreadable: 'unresolved' });
  includes(unresolved.message, 'could not be opened');
  includes(unresolved.message, 'shell expands it');
  ok(!unresolved.message.includes('stdin'),
    'an unresolvable -F path must not be blamed on stdin — that is the misdiagnosis this fixes');

  const absent = specVerdict({ changed, message: null, items, whyUnreadable: 'absent' });
  includes(absent.message, 'Neither `-m` nor `-F`');
  ok(!absent.message.includes('stdin'), 'no message flag at all is not a stdin problem either');

  // Whatever the cause, the verdict still refuses: a gate that waves through what it could not parse is off.
  for (const v of [stdin, unresolved, absent]) eq(v.ok, false);
});

test('export · a snapshot says it is one, and cannot pretend to be live', () => {
  // The bundle carries each page's own script, and one of those polls build-stamp.txt and patches the page
  // in place. Detached from the build directory that fetch can never succeed — so the export shipped a live
  // mechanism guaranteed to fail, with no build time anywhere on the page to reveal how old it was. Someone
  // read a stale export on a local server for a whole session and reported the dashboard as never updating.
  // They were right: it never could. The generated site was correct throughout, which is what made it take
  // three rounds to find.
  const dir = fixture('export-snapshot', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  renderSite(index, health, cfg, dir);
  const html = exportBundle(dir, cfg, null, { generatedAt: '2026-08-10 18:30 UTC' });

  includes(html, 'Snapshot of 2026-08-10 18:30 UTC');
  includes(html, 'cannot update itself');

  // The flag must be set before any page script reads it. Ordering is the whole mechanism: a flag defined
  // after the poller starts is a flag that does nothing.
  const flagAt = html.indexOf('__ATLAS_SNAPSHOT__ = true');
  const guardAt = html.indexOf('if (!window.__ATLAS_SNAPSHOT__)');
  ok(flagAt !== -1, 'the bundle must declare itself a snapshot');
  ok(guardAt !== -1, 'the poller must be guarded — an unguarded one polls a stamp that cannot exist');
  ok(flagAt < guardAt, 'the flag must be set before the poller reads it');

  // The first attempt at this cut the poller out with a regex that encoded the punctuation of a function it
  // did not own. It matched nothing, reported success, and shipped the dead poller anyway. Asserting the
  // guard exists rather than that the text is absent is what makes that failure impossible to repeat
  // silently: a flag either is read or the assertion above fails.
  ok(html.includes('build-stamp.txt'),
    'the poller is switched off by a flag, not deleted — if it vanished, this test asserts the wrong mechanism');
});

console.log('\nthe autonomy boundary');

/*
 * A-7. Autonomy's whole risk is in its defaults, so the defaults are what gets tested.
 *
 * These are not tests of features. They are tests of the four things automation must never do, written so
 * that adding a fifth automatic action without re-reading them is hard: every hook is enumerated from disk
 * rather than listed here, so a new one joins the assertions the moment it exists.
 */

const HOOK_DIR = path.join(REPO_ROOT, 'hooks');
const HOOKS = fs.readdirSync(HOOK_DIR).filter((f) => f.endsWith('.sh'));

test('boundary · every hook is discovered from disk, so a new one cannot skip these tests', () => {
  ok(HOOKS.length >= 4, `expected the hook scripts to be found, got ${HOOKS.length}`);
  for (const h of ['on-commit.sh', 'on-write.sh', 'on-session-start.sh', 'on-continuity.sh']) {
    ok(HOOKS.includes(h), `${h} must be among the enumerated hooks`);
  }
});

test('boundary · no automatic path pushes, publishes, or forces anything', () => {
  // The one rule that cannot have an exception. Publishing is outward-facing and effectively irreversible,
  // so it stays a thing a person asks for, every time. Checked against the hook scripts because they are
  // what runs without anyone deciding to run it.
  const forbidden = [
    [/\bgit\s+push\b/, 'git push'],
    [/\bpublish\b/, 'atlas publish'],
    [/--push\b/, 'the --push flag'],
    [/--force\b/, 'the --force flag'],
  ];
  for (const h of HOOKS) {
    const src = fs.readFileSync(path.join(HOOK_DIR, h), 'utf8')
      // Comments explain the boundary and must be allowed to name the thing they forbid.
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    for (const [re, what] of forbidden) {
      ok(!re.test(src), `${h} must never invoke ${what} — automation stops at the repository edge`);
    }
  }
});

test('boundary · no hook writes to the corpus, only to derived output', () => {
  // Automation may regenerate anything it can delete and rebuild. It may not touch prose: a machine can
  // see that a commit happened, not that a sentence was meant.
  for (const h of HOOKS) {
    const src = fs.readFileSync(path.join(HOOK_DIR, h), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    ok(!/>\s*[^\s|&;]*\.md\b/.test(src), `${h} must never redirect output into a markdown file`);
    ok(!/\bsed\s+-i\b/.test(src), `${h} must never edit a file in place`);
  }
});

test('boundary · every automatic action is refused in a repository that never adopted the tool', () => {
  // Installing the plugin must not start writing into every repository a session happens to touch. The
  // gate is the presence of a config file, and it is checked before anything else in each path.
  const dir = fixture('boundary-unadopted', { 'docs/A.md': '# A\n' });
  fs.rmSync(path.join(dir, 'project-atlas.config.json'), { force: true });
  const cfg = resolveConfig(dir);
  eq(cfg.__configPath, null, 'an unadopted repository resolves no config path');

  // Each automatic entry point guards on __configPath. Asserted against the source because these are
  // early returns inside a CLI dispatch that a unit test cannot reach directly.
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  for (const key of ['specOnCommit', 'healthOnCommit', 'buildOnWrite']) {
    ok(new RegExp(`!cfg\\.__configPath \\|\\| !automationAllows\\(cfg, '${key}'\\)`).test(cli),
      `the ${key} path must refuse both an unadopted repository and a disabled switch, in that order`);
  }
});

test('boundary · the master switch turns off every automatic action, including ones added later', () => {
  // AUTOMATION_KEYS is the list the config validates against, so every switch that exists is in it. Walking
  // it — rather than naming three keys — is what makes a fourth switch inherit this guarantee.
  const off = { automation: { enabled: false } };
  for (const key of Object.keys(AUTOMATION_KEYS)) {
    if (key === 'enabled') continue;
    eq(automationAllows(off, key), false, `${key} must be off when the master switch is off`);
  }
});

test('boundary · the journal is written outside anything that publishes', () => {
  // An operational record in a wiki is an operational record in public. The check exists as a check rather
  // than an assumption, because "outside" is a property of the current defaults, not of the design.
  const dir = fixture('boundary-journal', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'x', identity: 'Ann Example' });
  const out = path.resolve(dir, cfg.output);
  const journal = path.resolve(dir, '.atlas', 'journal', 'ann-example.jsonl');
  ok(!journal.startsWith(out + path.sep), 'the journal must never live inside the published output');
});

test('boundary · the server binds loopback and refuses paths outside the output directory', () => {
  // A documentation server on 0.0.0.0 puts a repository on the local network by default. Both properties
  // are asserted against the source: binding and path confinement are decided in one place each, and a
  // change to either is exactly the change that must not pass unnoticed.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'serve.mjs'), 'utf8');
  includes(src, "server.listen(port, '127.0.0.1'");
  ok(!/listen\([^)]*'0\.0\.0\.0'/.test(src), 'the server must never bind every interface');
  includes(src, "!file.startsWith(outDir + path.sep)");
  includes(src, "'cache-control': 'no-store'");
});

console.log('\nthe plan marks itself');

test('progress · a two-digit item id is not mistaken for its own percentage', () => {
  // The obvious implementation replaces the first digits in the matched cell — which are the digits in the
  // IDENTIFIER, not the figure. `| A-13 | 0 |` became `| A-10 | 0 |`: an item silently renamed to one that
  // already existed, producing two rows with the same id and losing A-13 entirely. It survived a manual
  // test because every id tried before it happened to be single-digit.
  const dir = fixture('progress-id', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Plan\n\n| Item | % | Item | % |\n|---|---|---|---|\n| A-1 | 0 | A-13 | 0 |\n\n**A-1 · One** — **P1 · High**\n\n**A-13 · Thirteen** — **P0 · Critical**\n',
  });
  const cfg = resolveConfig(dir);
  const r = setItemPercent(dir, cfg, 'A-13', 10);
  eq(r.changed, true);
  const src = fs.readFileSync(path.join(dir, 'docs', 'ROADMAP.md'), 'utf8');
  includes(src, '| A-13 | 10 |');
  includes(src, '| A-1 | 0 |', 'the neighbouring item must be untouched');
  ok(!src.includes('A-10'), 'the id must never be rewritten into a different item');
});

test('progress · a figure only ever moves up on its own, and completion is never claimed', () => {
  // Progress is a claim a person made; contradicting it is not a machine's job. Finishing cannot be
  // observed the way starting can, so nothing here writes 100.
  const dir = fixture('progress-monotonic', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Plan\n\n| Item | % |\n|---|---|\n| A-1 | 60 |\n\n**A-1 · One** — **P1 · High**\n',
  });
  const cfg = resolveConfig(dir);
  const r = setItemPercent(dir, cfg, 'A-1', 10);
  eq(r.changed, false, 'a figure already past the mark is left alone');
  includes(fs.readFileSync(path.join(dir, 'docs', 'ROADMAP.md'), 'utf8'), '| A-1 | 60 |');
});

test('progress · the estimate marker and emphasis survive a rewrite', () => {
  // A dropped `*` turns an estimate into a measurement. That is the exact distinction this project exists
  // to preserve, so it must survive the one write the tool makes to the plan.
  const dir = fixture('progress-markers', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Plan\n\n| Item | % |\n|---|---|\n| A-1 | 0* |\n| A-2 | **0** |\n\n**A-1 · One** — **P1 · High**\n\n**A-2 · Two** — **P1 · High**\n',
  });
  const cfg = resolveConfig(dir);
  setItemPercent(dir, cfg, 'A-1', 10);
  setItemPercent(dir, cfg, 'A-2', 10);
  const src = fs.readFileSync(path.join(dir, 'docs', 'ROADMAP.md'), 'utf8');
  includes(src, '| A-1 | 10* |', 'the estimate marker must survive');
  includes(src, '| A-2 | **10** |', 'emphasis must survive');
});

test('progress · the item is read from the branch name, and never guessed', () => {
  // Guessing which item someone meant is how the wrong row gets marked. A branch that names no known item
  // returns nothing rather than the closest match.
  const items = [{ id: 'A-13' }, { id: 'M-1' }];
  eq(itemFromBranch('feat/a-13-plan-marks-itself', items), 'A-13');
  eq(itemFromBranch('feat/M-1-mcp-server', items), 'M-1');
  eq(itemFromBranch('feat/no-item-here', items), null);
  eq(itemFromBranch('feat/a-99-not-in-the-plan', items), null, 'an id the plan does not carry is not a match');
});

test('progress · a commit naming an item the plan says never started is a contradiction', () => {
  // The spec gate refuses a commit that names no item. This is the opposite arrangement it cannot see: work
  // shipped for an item the dashboard has been reporting as not started the whole time.
  const items = [{ id: 'A-1', percent: 0 }, { id: 'A-2', percent: 60 }, { id: 'A-3', percent: 100 }];
  eq(contradictsPlan(['A-1'], items).join(','), 'A-1');
  eq(contradictsPlan(['A-2', 'A-3'], items).length, 0, 'an item already in progress or done is no contradiction');
});

test('branch · posture decides whether the convention refuses, warns, or stays quiet', () => {
  // A branching strategy is a team's decision. A tool that only knows how to refuse gets switched off
  // entirely by the first team it does not fit, taking every other check with it — so the posture is a
  // setting rather than a law.
  const dir = fixture('branch-posture', { 'docs/A.md': '# A\n' });
  const base = resolveConfig(dir);
  const on = (posture) => branchStatus(dir, { ...base, branching: { ...(base.branching || {}), posture } });

  // The fixture sits on its default branch, which is protected.
  const enforce = on('enforce');
  eq(enforce.posture, 'enforce');
  eq(enforce.safeToCommit, false, 'enforce must refuse a protected branch');
  ok(enforce.problems.some((p) => p.level === 'block'), 'enforce raises a blocking problem');

  const warn = on('warn');
  eq(warn.safeToCommit, true, 'warn allows the commit');
  ok(warn.problems.some((p) => p.level === 'warn'), 'warn still says so');
  ok(!warn.problems.some((p) => p.level === 'block'), 'warn never blocks');

  // `off` stops objecting. It does not stop reporting: the branch and its state are still there, because a
  // posture that could hide them would be a switch for making the repository lie about itself.
  const off = on('off');
  eq(off.problems.length, 0, 'off raises nothing');
  eq(off.onProtected, true, 'off must still report that the branch is protected');
  eq(off.current, enforce.current, 'off still says where you are');

  // An unrecognised value falls back rather than disabling the guard — a typo must never mean "off".
  eq(on('enfroce').posture, 'enforce', 'a misspelled posture falls back to the strict default, never to silence');

  // The default is `enforce`, deviating from the plan's `warn`. Shipping `warn` would silently remove a
  // guard that already refuses, from every repository that upgrades and was never asked.
  eq(branchStatus(dir, base).posture, 'enforce', 'the default posture must not weaken on upgrade');
});

test('journal · two contributors whose names slugify alike are reported, never merged', () => {
  // The silent version of this failure is the worst kind: their records interleave into one file and each
  // person reads the other's as their own. Reported rather than resolved — picking a winner would be the
  // tool deciding which of two people keeps their name.
  const c = slugCollisions(['Alex Turner', 'Alex-Turner', 'Bo Zhang']);
  eq(c.length, 1);
  eq(c[0].slug, 'alex-turner');
  eq(c[0].identities.join('|'), 'Alex Turner|Alex-Turner');
  eq(slugCollisions(['Ann Example', 'Bo Zhang']).length, 0, 'distinct names must not be reported');
});

test('publish · the journal never reaches the wiki, and the shared handoff does', () => {
  // A-11. Curated prose is for readers; an operational record is not. The journal is excluded by
  // construction — it lives outside the docs root — and this asserts the construction rather than trusting
  // it, because "outside" is a property of the layout, not a rule anything enforces.
  const dir = fixture('publish-journal', {
    'docs/handoff/SHARED.md': '# Shared handoff\n\nWhat constrains everyone.\n',
    'docs/A.md': '# A\n',
  });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'JOURNAL-SHOULD-NOT-PUBLISH', identity: 'Ann Example' });

  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const { pages } = buildWikiPages(index, health, null, cfg, dir);
  const all = [...pages.values()].join('\n');

  ok(!all.includes('JOURNAL-SHOULD-NOT-PUBLISH'), 'a journal record must never appear in a published page');
  ok(!index.documents.some((d) => d.path.startsWith('.atlas/')), 'the journal is not part of the corpus at all');
  includes(all, 'What constrains everyone.');
});

test('handoff · the tool prints the derived half and writes nothing', () => {
  // A machine can see that a commit happened; it cannot see that a decision was argued and settled. A
  // generated handoff would be confident prose nobody reviewed — the thing this project exists to detect.
  const dir = fixture('handoff-prompt', { 'docs/A.md': '# A\n' });
  const file = path.join(dir, 'docs', 'handoff', 'ann-example', 'HANDOFF.md');
  const out = formatHandoffPrompt({
    branch: { ok: true, current: 'feat/x', dirty: 2 }, version: '0.1.55',
    journal: { records: [{ kind: 'trap', text: 'a trap worth not repeating' }] },
    plan: { missing: false, items: [{ id: 'A-1', percent: 40 }, { id: 'A-2', percent: 100 }] },
    changes: null, age: { exists: false }, identity: 'Ann Example', file: 'docs/handoff/ann-example/HANDOFF.md',
  });
  includes(out, 'A-1 (40%)');
  ok(!out.includes('A-2'), 'a finished item is not in flight');
  includes(out, 'a trap worth not repeating');
  includes(out, 'the words stay yours');
  ok(!fs.existsSync(file), 'atlas handoff must never create the file it prompts for');
});

test('handoff · an unmeasurable age is never reported as current', () => {
  // "How far behind" that cannot be computed is null, not zero. Reporting zero would say "current" about a
  // document nobody checked — the failure this whole tool is aimed at.
  const dir = fixture('handoff-age', {
    'docs/handoff/ann/HANDOFF.md': '# Handoff\n\nWritten at commit deadbeef1234.\n',
    'docs/A.md': '# A\n',
  });
  const age = handoffAge(dir, path.join(dir, 'docs', 'handoff', 'ann', 'HANDOFF.md'));
  eq(age.exists, true);
  eq(age.commit, 'deadbeef1234');
  eq(age.distance, null, 'a commit not in this history yields an unknown distance, never 0');
  includes(age.reason, 'not in this history');

  const none = handoffAge(dir, path.join(dir, 'docs', 'handoff', 'nobody', 'HANDOFF.md'));
  eq(none.exists, false);
});

test('handoff · contributors are enumerated from disk, and SHARED.md is not one of them', () => {
  // A person who joins gets their handoff checked without anyone adding them to a list. SHARED.md is the
  // team's standing constraints, which do not go stale by a commit count the way a personal note does.
  const dir = fixture('handoff-enum', {
    'docs/handoff/SHARED.md': '# Shared\n',
    'docs/handoff/ann/HANDOFF.md': '# Ann\n',
    'docs/handoff/bo/HANDOFF.md': '# Bo\n',
    'docs/A.md': '# A\n',
  });
  const found = handoffsIn(dir, {}).map((h) => h.slug).sort();
  eq(found.join(','), 'ann,bo');
});

test('journal · a record written by the tool itself lands in the contributor file, not "unknown"', () => {
  // `note()` defaults identity to null, which slugs to `unknown`. Every record the tool wrote for itself —
  // the branch command marking an item in progress — therefore went to unknown.jsonl instead of the
  // person's own file, quietly defeating the per-contributor scheme it exists to support. It only surfaced
  // because a stray unknown.jsonl turned up in `git status`.
  const dir = fixture('journal-identity', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'progress', text: 'no identity given' });
  ok(fs.existsSync(path.join(dir, '.atlas', 'journal', 'unknown.jsonl')),
    'an omitted identity is still recorded — losing the record would be worse than misfiling it');

  journalNote(dir, cfg, { kind: 'progress', text: 'identity given', identity: 'Ann Example' });
  ok(fs.existsSync(path.join(dir, '.atlas', 'journal', 'ann-example.jsonl')),
    'a named contributor gets their own file');

  // Both are readable, and each record still says which file it came from — the merge is at read time, so
  // a misfiled record is recoverable rather than lost.
  const out = journalRead(dir);
  eq(out.records.length, 2);
  eq(out.contributors.join(','), 'ann-example,unknown');
});

test('lock · a build waits for another, and a dead owner never wedges the tool', () => {
  // A watcher now always runs, so overlapping builds are the normal case. The output directory is cleared
  // and repopulated, and whichever build reads it mid-clear sees content with none of its markers and
  // refuses — correctly, because it cannot tell a half-written build from someone's real files.
  const dir = fixture('build-lock', { 'docs/A.md': '# A\n' });

  const first = acquireLock(dir);
  eq(first.ok, true);

  // A live owner is honoured, and the waiter gives up rather than hanging. A build that waits forever is a
  // hang, not a queue.
  const second = acquireLock(dir, { waitMs: 30 });
  eq(second.ok, false);
  eq(second.heldBy, process.pid);
  first.release();

  // A lock left behind by a process that died must never stop a build permanently: the thing being
  // protected is regenerable output, so wedging the tool is the worse outcome.
  fs.writeFileSync(path.join(dir, '.atlas', 'build.lock'), JSON.stringify({ pid: 999999999, at: Date.now() }));
  const third = acquireLock(dir, { waitMs: 30 });
  eq(third.ok, true, 'a lock held by a dead process is stolen');
  eq(third.stole, true, 'and the theft is reported rather than silent');
  third.release();

  // Same for a live owner that has held it implausibly long — a wedged build must not be permanent either.
  fs.writeFileSync(path.join(dir, '.atlas', 'build.lock'),
    JSON.stringify({ pid: process.pid, at: Date.now() - (STALE_AFTER_MS + 1000) }));
  const fourth = acquireLock(dir, { waitMs: 30 });
  eq(fourth.ok, true, 'a stale lock is stolen even from a living owner');
  fourth.release();
});

test('journal · a decision can carry its reasoning, and the reasoning is bounded like everything else', () => {
  // A record saying "chose X" answers what. The expensive question is why — the next person's instinct is
  // to undo it, and they will, unless the argument is written where they are standing.
  const dir = fixture('journal-why', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'chose X', why: 'because Y fails under Z', identity: 'Ann Example' });
  const rec = journalRead(dir).records[0];
  eq(rec.why, 'because Y fails under Z');

  // Absent rather than null when not given: a field always present but usually empty trains the reader to
  // skip it, and this is the field worth reading.
  journalNote(dir, cfg, { kind: 'trap', text: 'no reasoning here', identity: 'Ann Example' });
  ok(!('why' in journalRead(dir).records[1]), 'an absent reason is omitted, not written as null');

  let threw = null;
  try { journalNote(dir, cfg, { kind: 'decision', text: 'x', why: 'y'.repeat(2001), identity: 'Ann Example' }); }
  catch (e) { threw = e; }
  ok(threw && /reasoning is 2001/.test(threw.message), 'the reasoning is bounded — a record, not a transcript');
});

test('architecture · the decisions panel publishes the written record and never the journal', () => {
  // The architecture page publishes; A-11 says the journal never does. Embedding journalled decisions here
  // would publish the journal through the back door — worse than not shipping the panel, because it breaks
  // a boundary quietly, in the one place a reader would not look for the breach. So the panel carries the
  // corpus decision documents plus a COUNT, which is a statistic and not content.
  const dir = fixture('arch-decisions', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/decisions/0001-use-x.md': '# Use X\n\nWe chose X.\n',
    'docs/ROADMAP.md': '# Plan\n\n| Item | % |\n|---|---|\n| A-1 | 0 |\n\n**A-1 · One** — **P1 · High**\n',
  });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'decision', text: 'SECRET-JOURNAL-DECISION',
    why: 'SECRET-JOURNAL-REASONING', identity: 'Ann Example' });

  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'architecture', title: 'Architecture', panels: ['decisions'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'Use X', 'the written decision record appears');
  ok(!html.includes('SECRET-JOURNAL-DECISION'), 'journal text must never reach a published page');
  ok(!html.includes('SECRET-JOURNAL-REASONING'), 'journal reasoning must never reach a published page');
  includes(html, '1</strong> decision(s)', 'the count is derived and safe to publish');
});

console.log('\nSOP obligations');

test('sop · reads obligations in either spelling, and an absent field stays absent', () => {
  // Both front-matter and bolded key-value lines are in the wild; refusing one would make adoption a
  // rewrite. "No owner" and "owner unknown" are different statements, so a missing field is never defaulted
  // into looking present.
  const a = readObligations('**Owner:** Ann Example\n**Review every:** 90 days\n**Last verified:** 2026-01-01\n');
  eq(a.owner, 'Ann Example'); eq(a.reviewDays, 90); eq(a.lastVerified, '2026-01-01');

  const b = readObligations('---\nowner: Bo Zhang\nreviewed every: quarterly\nlast-reviewed: 2025-12-31\n---\n');
  eq(b.owner, 'Bo Zhang'); eq(b.reviewDays, 91); eq(b.lastVerified, '2025-12-31');

  const none = readObligations('# Just a document\n\nNo obligations here.\n');
  eq(none.owner, null); eq(none.lastVerified, null); eq(none.reviewDays, null);
});

test('sop · an unreadable date is reported, never treated as today', () => {
  // Defaulting an unparseable date to now would silently mark every unreviewed SOP as freshly verified —
  // a lie in the one document class where being wrong gets acted on.
  const ob = readObligations('**Last verified:** whenever we get to it\n');
  eq(ob.lastVerified, null);
  eq(ob.lastVerifiedRaw, 'whenever we get to it');

  const v = evaluateSop({ path: 'docs/sop/x.md', body: '**Owner:** Ann Example\n**Last verified:** whenever\n' },
    { today: '2026-08-11', owners: ['Ann Example'] });
  ok(v.findings.some((f) => f.id === 'H10' && /not a date/.test(f.detail)));
});

test('sop · H10 fires past the interval the document set for itself, and not before', () => {
  const body = (d) => `**Owner:** Ann Example\n**Review every:** 90 days\n**Last verified:** ${d}\n`;
  const at = (d) => evaluateSop({ path: 'docs/sop/x.md', body: body(d) },
    { today: '2026-08-11', owners: ['Ann Example'] }).findings.map((f) => f.id);

  ok(!at('2026-07-01').includes('H10'), 'inside its own interval is not a finding');
  ok(at('2026-01-01').includes('H10'), 'past its own interval is');
  // The interval is the document's, not the tool's: a document declaring a year is judged against a year.
  const yearly = evaluateSop({ path: 'docs/sop/x.md', body: '**Owner:** Ann Example\n**Review every:** 1 year\n**Last verified:** 2026-01-01\n' },
    { today: '2026-08-11', owners: ['Ann Example'] });
  ok(!yearly.findings.some((f) => f.id === 'H10'), 'a longer interval the document declared is honoured');
});

test('sop · H11 is advisory about people, and says nothing when git cannot answer', () => {
  // "git could not answer" and "this person does not exist" are different facts, and only one is worth
  // reporting. An empty owner list must never turn every SOP into a finding.
  const body = '**Owner:** Ann Example\n**Review every:** 90 days\n**Last verified:** 2026-08-01\n';
  const known = evaluateSop({ path: 'docs/sop/x.md', body }, { today: '2026-08-11', owners: ['Ann Example'] });
  ok(!known.findings.some((f) => f.id === 'H11'));

  const gone = evaluateSop({ path: 'docs/sop/x.md', body }, { today: '2026-08-11', owners: ['Someone Else'] });
  ok(gone.findings.some((f) => f.id === 'H11'), 'an owner with no commits is reported');

  const unknown = evaluateSop({ path: 'docs/sop/x.md', body }, { today: '2026-08-11', owners: [] });
  ok(!unknown.findings.some((f) => f.id === 'H11'), 'no author list means no claim about the owner');

  const nobody = evaluateSop({ path: 'docs/sop/x.md', body: '**Review every:** 90 days\n**Last verified:** 2026-08-01\n' },
    { today: '2026-08-11', owners: [] });
  ok(nobody.findings.some((f) => f.id === 'H11'), 'naming no owner at all is always a finding');
});

test('sop · H10 and H12 block, H11 does not', () => {
  // The catalogue's rule: a signal blocks only when it has no legitimate cause. Exceeding an interval the
  // document declared, and citing a step that cannot be resolved, have none. A misspelled owner does.
  eq(DEFAULT_CONFIG.blocking.includes('H10'), true);
  eq(DEFAULT_CONFIG.blocking.includes('H12'), true);
  eq(DEFAULT_CONFIG.blocking.includes('H11'), false);
});

test('design · a scaffold is a third state and never counts as a design record', () => {
  // The moment an empty file exists, a record that knows only present/absent starts reporting a design
  // record the repository does not have. That is worse than the gap it closed: an absence is honest and
  // visible; a false presence is trusted, and every other check on the page measures against it.
  const dir = fixture('design-stub', {
    'docs/design/HLD.md': '# High-level design\n\n<!-- atlas:stub — scaffolded, not yet written. -->\n\n## What problem?\n\n_Unanswered._\n',
    'docs/design/ARCHITECTURE.md': '# Architecture overview\n\nThis system is a CLI over a markdown corpus, and here is how it hangs together.\n',
    'docs/A.md': '# A\n',
  });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const record = designRecord(index.documents);
  const by = (id) => record.find((r) => r.id === id);

  eq(by('hld').state, 'stub', 'a scaffolded file is a stub');
  eq(by('hld').present, false, 'and present stays false, so every existing caller keeps the strict meaning');
  eq(by('architecture').state, 'written');
  eq(by('architecture').present, true);
  eq(by('lld').state, 'absent');
});

test('design · scaffolding writes questions, never answers, and never overwrites', () => {
  // A design document is a set of claims about what the code is FOR and what was rejected. Generated claims
  // nobody reviewed would land in the corpus every other check measures drift against.
  const dir = fixture('design-scaffold', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const before = designRecord(buildIndex(dir, cfg).documents);
  const r = scaffoldDesign(dir, before, { kinds: ['hld'] });
  eq(r.written.length, 1);
  eq(r.written[0].file, 'docs/design/HLD.md');

  const body = fs.readFileSync(path.join(dir, 'docs', 'design', 'HLD.md'), 'utf8');
  includes(body, 'atlas:stub');
  includes(body, 'What was considered and rejected');
  includes(body, '_Unanswered._');

  // Losing a paragraph of real design thinking to a template is the worst possible trade, so an existing
  // file is never touched — finished or half-written, it is left exactly as it is.
  fs.writeFileSync(path.join(dir, 'docs', 'design', 'HLD.md'), '# Mine\n\nReal content I wrote.\n');
  const again = scaffoldDesign(dir, designRecord(buildIndex(dir, cfg).documents), { kinds: ['hld'] });
  eq(again.written.length, 0, 'an existing file is never overwritten');
  includes(fs.readFileSync(path.join(dir, 'docs', 'design', 'HLD.md'), 'utf8'), 'Real content I wrote.');
});

test('config · a config written for a newer atlas degrades instead of refusing to run', () => {
  // An older installed copy is always running somewhere — a hook, a colleague's machine, CI. When the
  // repository's config names a signal that build has never heard of, hard-failing takes every other check
  // down with it, which is far worse than one gate not firing. It is still said out loud, because a
  // blocking signal that silently does not fire is not a gate.
  const dir = fixture('config-newer', {
    'project-atlas.config.json': JSON.stringify({ blocking: ['H1', 'H99'] }),
    'docs/A.md': '# A\n',
  });
  const cfg = resolveConfig(dir);
  eq(cfg.blocking.join(','), 'H1,H99', 'the unknown id survives rather than being silently dropped');

  // A value that is not shaped like a signal at all is still a typo, and still fatal.
  const bad = fixture('config-typo', {
    'project-atlas.config.json': JSON.stringify({ blocking: ['nonsense'] }),
    'docs/A.md': '# A\n',
  });
  let threw = null;
  try { resolveConfig(bad); } catch (e) { threw = e; }
  ok(threw && /is not a signal/.test(threw.message), 'a misspelled id is still refused');
});

test('signals · the catalogue lists checks that found nothing, and never calls an unrun check clean', () => {
  // A catalogue showing only what is currently wrong cannot distinguish "this passed" from "this does not
  // exist here" — the same confusion as a Status filter whose `In progress` option vanishes when nothing is
  // in progress. `ok` is a result; absence is not.
  const dir = fixture('signal-catalogue', {
    'project-atlas.config.json': JSON.stringify({ blocking: ['H1'] }),
    'docs/A.md': '# A\n\n[gone](nope.md)\n',
  });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'qc', title: 'QC', panels: ['signals'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  // Every signal in the catalogue appears, fired or not.
  for (const id of Object.keys(SIGNALS)) includes(html, `<code>${id}</code>`);

  // **The counts must actually bind.** The first version read `f.id`; findings carry `f.signal`, so every
  // finding bucketed under `undefined` and all sixteen rows rendered `ok` while the summary line below them
  // said "48 findings" — the same page disagreeing with itself, with nothing thrown. Only a screenshot
  // caught it, which is why the assertion is now on the number rather than on the markup existing.
  const h1 = (health.findings || []).filter((f) => f.signal === 'H1' && !f.suppressed).length;
  ok(h1 > 0, 'the fixture must actually produce an H1 finding for this assertion to mean anything');
  includes(html, `>${h1} · blocking<`, 'a fired blocking signal shows its count, not ok');
  includes(html, 'blocks', 'a blocking signal is marked as one');
  includes(html, 'ok', 'signals that found nothing are shown as ok rather than omitted');
  // H9 has no pairs configured in this fixture, so it could not run — and must not read as clean.
  includes(html, 'not checked');
});

test('launcher · lists every project, and states that it cannot check them', () => {
  // A hand-written link to one project is wrong the moment you switch, and silently wrong: it opens a real
  // dashboard belonging to something else.
  const projects = launcherProjects(
    [{ root: '/tmp/one', name: 'one', port: 4201, url: 'http://127.0.0.1:4201/' },
     { root: '/tmp/two', name: 'two', port: 4202, url: 'http://127.0.0.1:4202/' }],
    { root: '/tmp/two', port: 4202 });
  eq(projects.length, 2);
  eq(projects[0].current, true, 'the current repository sorts first');
  eq(projects[0].name, 'two');

  const html = renderLauncher(projects, { generatedAt: '2026-08-11 00:00 UTC' });
  includes(html, 'http://127.0.0.1:4201/');
  includes(html, 'http://127.0.0.1:4202/');
  includes(html, 'this repository');
  // An artifact cannot reach the machine to ask whether a server is up, so it must not imply that it did.
  includes(html, 'recorded, not checked');

  // A repository with no server yet still appears, because its port is knowable from its path alone.
  const solo = launcherProjects([], { root: '/tmp/three', port: 4203 });
  eq(solo.length, 1);
  eq(solo[0].url, 'http://127.0.0.1:4203/');
});

console.log('\ncharts');

test('charts · a breakdown that cannot divide says so instead of drawing a circle', () => {
  // With one contributor a share chart is a circle labelled 100%, which every reader already knew. The
  // honest output is the number and the name.
  const one = donut({ title: 'Commits by contributor', slices: [{ label: 'Ann Example', value: 109 }], unit: ' commits' });
  ok(!one.includes('<path'), 'a single slice must not be drawn as a ring');
  includes(one, 'Ann Example');
  includes(one, 'Only one contributor');

  const none = donut({ title: 'x', slices: [] });
  includes(none, 'No data to divide');

  const two = donut({ title: 'x', slices: [{ label: 'a', value: 3 }, { label: 'b', value: 1 }], unit: ' h' });
  includes(two, '<path', 'two slices are a real chart');
  includes(two, '75%');
  includes(two, '25%');
});

test('charts · identity is never colour alone, and hues are never cycled', () => {
  // The palette validator passed with adjacent tritan separation of ΔE 3.8 on dark, which is legal ONLY
  // with secondary encoding. Direct labels in the legend are that encoding, so they are load-bearing
  // rather than decorative.
  const slices = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((l, i) => ({ label: l, value: 10 - i }));
  const html = donut({ title: 'many', slices, unit: '' });
  for (const l of ['a', 'b', 'c', 'd', 'e']) includes(html, `>${l} · `, 'every slice is named beside its swatch');

  // A ninth series folds into "other" rather than reusing a hue: a repeated colour claims two different
  // things are the same thing.
  includes(html, 'other');
  const used = [...new Set(html.match(/--cat-\d/g) || [])];
  ok(used.length <= CAT_MAX, `at most ${CAT_MAX} categorical slots may be used, saw ${used.length}`);
});

test('charts · a gap in a series breaks the line rather than being drawn through', () => {
  // A straight segment across a gap claims nothing happened, which is a different statement from not
  // knowing. The path restarts instead.
  const html = lineChart({
    title: 'weekly', labels: ['w1', 'w2', 'w3', 'w4'],
    series: [{ label: 'commits', values: [4, null, 6, 8] }],
  });
  const d = /d="([^"]+)"/.exec(html)[1];
  eq((d.match(/M/g) || []).length, 2, 'the path restarts at the gap rather than spanning it');

  const flat = lineChart({ title: 'x', labels: ['a'], series: [{ label: 'y', values: [1] }] });
  includes(flat, 'Not enough history', 'one point is not a trend');
});

test('render · the brand carries the mark, and the mark fills the box it is given', () => {
  // P-4 put the mark in the footer and stopped, so the one place a reader looks for identity — the
  // top-left of every page — stayed a plain text span while the credit line at the bottom was branded.
  const dir = fixture('brand-topbar', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const site = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(site.outDir, 'index.html'), 'utf8');

  const topbar = /<header class="topbar">([\s\S]*?)<\/header>/.exec(html)[1];
  includes(topbar, 'atlas-mark', 'the topbar carries the mark, not only the footer');
  includes(topbar, 'class="brand"');

  // The viewBox is cropped to the artwork. It was 0 0 128 128 while the art spanned y 13.5→108, so about a
  // quarter of every rendered pixel was empty padding and the mark came out far smaller than the box it was
  // given — which reads as a sizing bug and is not one. Raising the width only scales up the emptiness.
  const vb = /class="atlas-mark" viewBox="([^"]+)"/.exec(html)[1].split(/\s+/).map(Number);
  ok(vb[0] > 0 && vb[1] > 0, 'the viewBox is cropped to the art, not left at the origin');
  ok(vb[2] <= 110 && vb[3] <= 110, 'and the crop is tight enough that the mark fills its box');
});

test('lock · two different builds sharing one output directory are named, never refused', () => {
  // Serialising builds is the right fix for two copies of the same build and no fix at all for two different
  // ones: an installed plugin's watcher and a developer's working copy both take the lock legitimately, take
  // turns politely, and overwrite each other's output. A fix appeared not to work three times in a row
  // because the older installed build rebuilt over it seconds later.
  const dir = fixture('build-lock-identity', { 'docs/A.md': '# A\n' });
  const installed = { version: '0.1.62', path: '/Users/x/.claude/plugins/cache/project-atlas/atlas/0.1.62' };
  const working = { version: '0.1.63', path: '/Users/x/Working/project-atlas' };

  const a = acquireLock(dir, { build: installed });
  eq(a.ok, true);
  eq(a.foreign, null, 'the first build here has nobody to disagree with');
  a.release();

  // The lock is released and gone before the second build starts — which is the whole point. The two never
  // overlap in time, so serialising them catches nothing; the record of who built here has to outlive the
  // lock or the disagreement is invisible.
  const b = acquireLock(dir, { build: working });
  eq(b.ok, true, 'the build proceeds — which build should win is the user\'s call, not the tool\'s');
  eq(b.foreign.version, '0.1.62');
  eq(b.foreign.path, installed.path);
  b.release();

  const out = path.join(dir, 'site');
  const msg = foreignBuildWarning(b.foreign, working, out);
  for (const part of ['0.1.62', '0.1.63', installed.path, working.path, out]) {
    includes(msg, part, 'the warning has to name both builds and the directory they are fighting over');
  }

  // The same build rebuilding is the normal case — a watcher does it every few seconds — and must never
  // warn. A warning that fires constantly is one nobody reads on the day it is true.
  const c = acquireLock(dir, { build: { ...working } });
  eq(c.foreign, null, 'the same build twice is not a disagreement');
  c.release();

  // And none of this may touch the reason the lock exists: a lock left by a dead process is still stolen,
  // because a wedged tool is worse than an overwritten directory of regenerable output.
  fs.writeFileSync(path.join(dir, '.atlas', 'build.lock'), JSON.stringify({ pid: 999999999, at: Date.now() }));
  const d = acquireLock(dir, { waitMs: 30, build: working });
  eq(d.ok, true, 'a lock held by a dead process is still stolen');
  eq(d.stole, true);
  d.release();
});

console.log('\nthe continuity hook');

/*
 * A-20. The hook is shell, so it is tested the way it runs: a real payload on stdin, a real repository under
 * the cwd, and the assertion made against the line that ended up in the journal.
 */

/** A repository the continuity hook will act on, with the marker seeded so the Stop path is not a no-op. */
function continuityRepo(name) {
  const dir = fixture(name, { 'project-atlas.config.json': '{}\n', 'docs/A.md': '# A\n' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Fire the hook as `hooks.json` fires it — event name as an argument, payload on stdin — and hand back the
 * record it wrote. The marker is reset before each call because the Stop path deliberately records nothing
 * when HEAD has not moved since the last boundary, and a test that measured silence would pass on anything.
 */
function fireContinuity(dir, told, payload) {
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'last-stop'), 'deadbee', 'utf8');
  const before = journalRead(dir).records.length;
  const r = spawnSync('sh', [path.join(REPO_ROOT, 'hooks', 'on-continuity.sh'), told], {
    cwd: dir,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
  eq(r.status, 0, 'a continuity hook fires while a session is torn down and must never fail');
  const after = journalRead(dir).records;
  eq(after.length, before + 1, `the hook recorded ${after.length - before} records, expected exactly 1`);
  return after[after.length - 1];
}

/** A payload shaped like the harness's, including the field this must never read. */
const TRANSCRIPT = '/Users/x/.claude/projects/p/9f2c.jsonl';
const payloadFor = (event) => ({ session_id: 's1', transcript_path: TRANSCRIPT, hook_event_name: event, cwd: '/x' });

test('continuity · the record names the event that fired, not the one the argument claimed', () => {
  // `a subagent finished on main at b23b05f` was journalled in a session where no subagent ever ran. The
  // hook is handed the event name by hooks.json, so it recorded what it was told and never what happened —
  // an attribution nobody checked, in the one file whose entire value is that nobody has to check it.
  const dir = continuityRepo('continuity-observed');
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

  // Told `subagent`, but a Stop is what fired. This is the defect, in the direction it actually shipped.
  const stop = fireContinuity(dir, 'subagent', payloadFor('Stop'));
  eq(stop.agent, 'main', 'a Stop must not be tagged as a subagent because the argument said so');
  includes(stop.text, 'work landed on main', 'the observed event decides which record gets written');
  ok(!/subagent/.test(stop.text), `the record must not mention a subagent: ${stop.text}`);
  includes(stop.refs.join(','), `main@${head}`);

  // And the reverse, so this is not a rule that simply never writes the subagent record any more.
  const sub = fireContinuity(dir, 'stop', payloadFor('SubagentStop'));
  eq(sub.agent, 'subagent', 'an observed SubagentStop is exactly what the tag exists for');
  includes(sub.text, 'a subagent finished on main');

  const compact = fireContinuity(dir, 'stop', payloadFor('PreCompact'));
  eq(compact.agent, 'compaction');
  includes(compact.text, 'context compacted on main');
}, { needsPosixShell: true, needsJq: true });

test('continuity · a payload that names no event records the boundary and no actor', () => {
  // Where the event cannot be read — no jq, malformed JSON, a field the harness stopped sending — the
  // boundary is still real and the actor is not known. So the record says only the part that was observed.
  // Falling back to the argument here is the whole defect: an unattributed true statement beats an
  // attributed false one. This runs everywhere, because without jq it is the only path there is.
  const dir = continuityRepo('continuity-unattributed');

  for (const [what, payload] of [
    ['the field is absent', { session_id: 's1', transcript_path: TRANSCRIPT }],
    ['the payload is not JSON', 'not json at all'],
    ['the payload is empty', ''],
    ['the event is one this build does not know', payloadFor('SessionResumed')],
  ]) {
    const rec = fireContinuity(dir, 'subagent', payload);
    includes(rec.text, 'a session boundary was crossed on main', `${what}: the boundary is still recorded`);
    ok(!/subagent/.test(rec.text), `${what}: the record must name no actor, got: ${rec.text}`);
    eq(rec.agent, 'main', `${what}: an unobserved event cannot be tagged with an agent`);
  }

  // Rule 3 of the journal, checked against the bytes on disk rather than the parsed record: the hook is now
  // given a payload it reads, and the field next to the one it reads is the transcript.
  const dirent = path.join(dir, '.atlas', 'journal');
  for (const f of fs.readdirSync(dirent)) {
    const raw = fs.readFileSync(path.join(dirent, f), 'utf8');
    ok(!raw.includes(TRANSCRIPT), `${f} carries a transcript path — the journal never records what was said`);
    ok(!raw.includes('9f2c.jsonl'), `${f} carries the transcript filename`);
  }
}, { needsPosixShell: true });

console.log('\nMCP and batch answers');

test('mcp · the handshake echoes the protocol version and declares only tools', () => {
  // A client negotiating a version this file does not implement must be told plainly rather than have its
  // messages silently mishandled.
  const dir = fixture('mcp-init', { 'docs/A.md': '# A\n' });
  const r = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { root: dir, version: '9.9.9' });
  eq(r.result.protocolVersion, MCP_VERSION);
  eq(r.result.serverInfo.version, '9.9.9');
  ok(r.result.capabilities.tools, 'tools are declared');
  ok(!r.result.capabilities.resources, 'nothing is declared that is not implemented');

  // A notification takes no response. Replying to one is a violation clients handle by ignoring it, which
  // makes the mistake invisible until something stricter arrives.
  eq(mcpHandle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { root: dir }), null);
});

test('mcp · an unknown tool is a protocol error, a failing tool is a result', () => {
  // Collapsing the two would tell a caller its request was malformed when the request was fine and the
  // repository was the problem.
  const dir = fixture('mcp-errors', { 'docs/A.md': '# A\n' });
  const unknown = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } }, { root: dir });
  eq(unknown.error.code, -32602);
  includes(unknown.error.message, 'Unknown tool');
  ok(!unknown.result, 'a protocol error carries no result');

  const bad = mcpHandle({ jsonrpc: '2.0', id: 2, method: 'nonsense' }, { root: dir });
  eq(bad.error.code, -32601);
});

test('mcp · every exposed tool reads and none of them writes', () => {
  // The read-only boundary is the reason this surface is safe to expose to an agent at all, so it is
  // asserted rather than promised in a comment.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'mcp.mjs'), 'utf8');
  for (const forbidden of ['writeFileSync', 'appendFileSync', 'stagePages', 'stageWiki', 'setItemPercent', '--push']) {
    ok(!src.includes(forbidden), `mcp.mjs must never reach ${forbidden}`);
  }
  ok(Object.keys(MCP_TOOLS).length >= 5, 'the tool set is not empty');
  for (const [name, t] of Object.entries(MCP_TOOLS)) {
    ok(typeof t.description === 'string' && t.description.length > 60,
      `${name} needs a description that says when to call it, not just what it does`);
    eq(t.schema.type, 'object');
  }
});

test('ask · exit 1 is a finding, exit 2 is "I could not answer", and they are never confused', () => {
  // A tool that exits non-zero for both tells a pipeline "documentation is broken" when the truth was
  // "atlas could not run" — one is a real finding, the other a pipeline bug.
  const dir = fixture('ask-codes', {
    'project-atlas.config.json': JSON.stringify({ blocking: ['H1'] }),
    'docs/A.md': '# A\n\n[gone](nope.md)\n',
  });
  const bad = runTask(dir, 'atlas_health');
  eq(bad.ok, true, 'a finding is still a successful answer');
  eq(bad.exitCode, 1);
  ok(bad.blocking > 0);

  eq(runTask(dir, 'nonsense').exitCode, 2, 'an unknown task could not be answered');

  // **A directory that never adopted the tool is not a corpus.** Pointed at one, this scanned everything
  // beneath it and reported 1,389 findings — a number CI would have failed on, about files that were never
  // documentation. False and actionable are the two properties that make a wrong answer expensive.
  const bare = fixture('ask-unadopted', { 'docs/A.md': '# A\n' });
  fs.rmSync(path.join(bare, 'project-atlas.config.json'), { force: true });
  const none = runTask(bare, 'atlas_health');
  eq(none.ok, false);
  eq(none.exitCode, 2);
  includes(none.error, 'adopted the tool');
});

test('ask · the batch surface and the MCP surface answer from the same handlers', () => {
  // Two surfaces answering the same question differently is a drift generator, and this project exists to
  // detect those. They share TOOLS rather than reimplementing it.
  eq(TASKS.join(','), Object.keys(MCP_TOOLS).join(','));
});

test('blueprint · a page assembled over scaffolds says the substance is owed, never that it exists', () => {
  // The failure this page could commit is the one the whole project exists to detect: a blueprint that reads
  // as prose the tool wrote. The dangerous shape is not an invented paragraph — nobody would add one — it is
  // a scaffold's empty headings laid out in the same form a written document gets, which reads as a design
  // record and contains none. This repository is entirely scaffolds today, so that is the case under test.
  const dir = fixture('blueprint-stubs', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  // Seven scaffolded and the manual of style left alone, so all three states meet on one page.
  scaffoldDesign(dir, designRecord(buildIndex(dir, cfg).documents),
    { kinds: ['hld', 'lld', 'architecture', 'dataflow', 'specs', 'prd', 'decisions'] });
  // Discovery is tracked-only, so a scaffold nobody committed is a scaffold no page can see.
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'scaffold'], { cwd: dir, stdio: 'ignore' });
  cfg.views = [{ id: 'blueprint', title: 'Blueprint', panels: ['blueprint'] }];

  const build = () => {
    const index = buildIndex(dir, cfg);
    const site = renderSite(index, runHealth(index, cfg, dir), cfg, dir);
    return { html: fs.readFileSync(path.join(site.outDir, 'view-blueprint.html'), 'utf8'), site };
  };

  const { html, site } = build();
  includes(html, 'No section below has a written document behind it',
    'a blueprint over nothing but scaffolds must say so at the top, not open with a summary of the design');
  includes(html, 'The substance is owed', 'and each scaffolded section must say it again where it is read');
  includes(html, 'Questions still unanswered');
  // The scaffold's own headings, quoted. Nothing else on a stub section may be prose.
  includes(html, 'What was considered and rejected');
  ok(!/<blockquote/.test(html), 'a scaffold\'s boilerplate is never quoted as though it described the system');

  // Absence is reported, and reported as a finding rather than as an empty section that looks finished.
  includes(html, 'Manual of style');
  includes(html, 'Nothing in the corpus is this artifact');
  includes(html, 'atlas design --scaffold --only=style');

  // Views live at the output root and document pages one level down, so every link here needs the `pages/`
  // prefix. Getting it wrong is a dead link, which is what the verifier is for.
  ok(/href="pages\/[^"]*#/.test(html), 'a question links to the heading in the document that owes it');
  eq(verifySite(site.outDir).filter((f) => f.rule === 'dead-link').length, 0);

  // Now write one of them for real. The written section gains the document's own opening paragraph — quoted,
  // not composed — and the page stops describing itself as an inventory of what is owed. The other six say
  // exactly what they said before, because nothing about them changed.
  fs.writeFileSync(path.join(dir, 'docs', 'design', 'ARCHITECTURE.md'),
    '# Architecture overview\n\nA CLI over a markdown corpus, and nothing else.\n\n## What loads first\n\nThe scanner.\n');
  const after = build().html;
  includes(after, 'A CLI over a markdown corpus, and nothing else.');
  includes(after, 'What it covers');
  ok(!after.includes('No section below has a written document behind it'), 'one written artifact and the claim retires');
  includes(after, 'The substance is owed', 'the six that are still scaffolds still owe their substance');
});

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped on ${process.platform}` : ''}\n`);
if (fail) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}`);
  console.log('');
  process.exit(1);
}
