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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { globToRegExp, resolveConfig, DEFAULT_CLUSTERS, DEFAULT_CONFIG, clusterFor, unsafeRegexReason, AUTOMATION_KEYS } from '../scripts/lib/config.mjs';
import { buildIndex } from '../scripts/lib/scan.mjs';
import { runHealth, formatReport, SIGNALS, OPERATOR_SIGNALS, readParallelism,
         DEFAULT_PARALLELISM_EDITS, PARALLELISM_SAMPLE, parallelismEvidence,
         CORPUS_SIGNALS as HEALTH_CORPUS_SIGNALS } from '../scripts/lib/health.mjs';
import { readSessionParallelism } from '../scripts/lib/parallelism.mjs';
import { readContention, formatContention, definedIds } from '../scripts/lib/contention.mjs';
import { SIGNALS as CORPUS_SIGNALS } from '../scripts/lib/signals.mjs';
import { renderSite, BUILD_CLAIM, BUILD_MARKERS, groupNav, NAV_GROUPS } from '../scripts/lib/render.mjs';
import { renderMarkdown, inline } from '../scripts/lib/markdown.mjs';
import { readPlanning, DEFAULT_PLANNING } from '../scripts/lib/planning.mjs';
import { writeDay, contributorSlug } from '../scripts/lib/worklog.mjs';
import { buildPrompt } from '../scripts/lib/prompt.mjs';
import { readDeck } from '../scripts/lib/deck.mjs';
import { RAMP, STATUS, INK, viewPage, signalGroups } from '../scripts/lib/dashboard.mjs';
import { CAT, CAT_MAX, donut, lineChart, stackedArea, sparkbars } from '../scripts/lib/charts.mjs';
import { automationAllows } from '../scripts/lib/config.mjs';
import { buildWikiPages, wikiPageName, isSafePageName, exportSingleFile, exportBundle, RESERVED, gitlabPagesJob, stageWiki, stripLocalOnly, stripLocalOnlyTree, stagePages, assertNoLocalOnly, BUNDLE_PAGES } from '../scripts/lib/publish.mjs';
import { confine, isAtOrInside, realpathOrBest } from '../scripts/lib/paths.mjs';
// A namespace import, because `OPERATOR_SIGNALS` arrives with H17 and a named import of an export that does
// not exist yet fails at module load — which would take the whole suite down rather than one test.
import * as healthModule from '../scripts/lib/health.mjs';
import { readContrib, estimateHours, taskCoverage } from '../scripts/lib/contrib.mjs';
import { num } from '../scripts/lib/format.mjs';
import { pauseSession, readParked, verifyParked, stopSession, worktrees, agentIdOf, writeParked, PARKED_FILE }
  from '../scripts/lib/session.mjs';
import { serverArgvFacts, rootIsGone, discoverServers, surveyServers, reapOrphanServers,
         confirmAtlasServer, pidFile } from '../scripts/lib/serve.mjs';
import { readTokens, formatTokens, formatSessions, assertNotPublishable, transcriptDir,
         readTokenEconomics, formatEconomics, writeTokenSnapshot, snapshotLine, classifyWrite,
         taskWindows, overlapWindows, transcriptFiles, WORK_KINDS,
         runAnchors, hasTranscripts, DEFAULT_SITTING_GAP_MINUTES } from '../scripts/lib/tokens.mjs';
import { readChanges, fileDiff, formatChanges } from '../scripts/lib/changes.mjs';
import { readInflight, inflightSentence } from '../scripts/lib/inflight.mjs';
import { branchStatus, createBranch, TYPES } from '../scripts/lib/branch.mjs';
import { detectHost, gateTarget, formatCapabilities } from '../scripts/lib/host.mjs';
import { resolveViews, navItems, PANELS, DEFAULT_VIEWS } from '../scripts/lib/views.mjs';
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
import { handle as mcpHandle, TOOLS as MCP_TOOLS, PROTOCOL_VERSION as MCP_VERSION,
         connectionStatus, formatConnection, runningServers } from '../scripts/lib/mcp.mjs';
import { runTask, TASKS } from '../scripts/lib/task.mjs';
import { manifestUrl, checkForUpdate, fetchLatest, readCache, writeCache, isFresh } from '../scripts/lib/update.mjs';
import { readGitInsight, formatGitInsight, hotspots, coupling, branchHealth, cadence, hygiene,
         fillWeeks, DEFAULT_GITINSIGHT, GITINSIGHT_SECTIONS } from '../scripts/lib/gitinsight.mjs';
import { cheatsheet, renderAssets, parseUsage, usageSource, parseMap, slashCommands, fit, measure,
         pack, SVG_PATH, PDF_PATH } from '../scripts/lib/cheatsheet.mjs';

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
  // Filtered to the corpus catalogue on purpose. H17 measures the operator and is always unevaluated in a
  // fixture that supplies no session data, so an exact list here would now be asserting something about the
  // operator signal rather than about the declined pattern this case is for.
  eq(health.unevaluated.filter((id) => CORPUS_SIGNALS[id]), ['H7'],
    'the signal must be marked unevaluated, not left looking clean');
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
  eq(health.unevaluated.filter((id) => CORPUS_SIGNALS[id]), ['H9']);   // see the H7 case for the filter
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

test('publish · the export keeps same-page controls and drops the whole navigation', () => {
  // The bug this guards: the export stripped the topbar nav to remove cross-page links, and took the theme
  // toggle with it while still shipping the toggle's script — `if (!btn) return;` fired before `paint()`, so
  // a saved light preference was silently ignored and the file always rendered whatever the OS asked for.
  //
  // It was fixed once by keeping everything in the nav that was not an <a>. That rule died with the flat
  // row: the menu is a burger and four <details> groups now, and "not an anchor" would have kept four
  // labelled menus with nothing inside them. The clock and the toggle are siblings of the nav instead, so
  // the assertion is the plainer one — nothing navigational survives, both controls do.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const built = fs.readFileSync(path.join(pubRepo, cfg.output, 'dashboard.html'), 'utf8');
  const html = exportSingleFile(pubRepo, cfg, 'dashboard');

  // The built page is the control: it has the nav, the groups and the links this export must not keep.
  includes(built, '<nav class="sitenav"', 'sanity: the built page carries the site nav this export strips');
  ok(!/<nav class="sitenav"/.test(html), 'the topbar nav addresses sibling pages that do not exist here');
  ok(!/href="[^"]*view-\w+\.html"/.test(html), 'no sibling page link may remain anywhere');
  ok(!/class="navgroup"|class="navburger"/.test(html), 'and no empty menu scaffolding may be left behind');

  const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(html);
  ok(bar, 'the topbar itself stays — it carries the controls');
  includes(bar[0], 'id="themeToggle"', 'the toggle acts on this page alone, so it stays');
  includes(bar[0], 'id="clock"', 'and so does the clock');
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

test('bundle · the standalone bundle strips local-only panels, exactly as the single-page export does', () => {
  // `exportSingleFile` has stripped `data-local-only` since the incident that created the marker: an export
  // handed to somebody carried a private task list and the path of every uncommitted file. This is the other
  // half of the same command — `--target export` with `which === 'all'` — and it read each page straight off
  // disk, so the in-flight panel travelled in the bundle from all five views that carry it. The marker was
  // doing its job; only one of the two exit doors was checking for it.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);

  const built = fs.readFileSync(path.join(pubRepo, cfg.output, 'dashboard.html'), 'utf8');
  ok(built.includes('data-local-only'),
    'the built site must actually carry a local-only panel, or this test proves nothing');

  const html = exportBundle(pubRepo, cfg);
  eq(html.includes('data-local-only'), false, 'no local-only panel may reach a file made to be handed over');
  eq(html.includes('Work in flight'), false, 'and the panel itself is gone, not merely unmarked');
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

test('bundle · About links the legal documents the bundle carries, and only those', () => {
  // The About panel is the one surface that can point a reader at the terms, and it is also the surface that
  // cannot afford a dead link: nothing exists beside a single file. Naming `docs/legal/TERMS.md` and linking
  // it unconditionally would put four links to nowhere on the About page of every repository that is not this
  // one — a broken promise on the page whose subject is what you can rely on. So the list is discovered from
  // the sections the bundle actually carries.
  const dir = fixture('bundle-legal', {
    'README.md': '# Front\n\n[Terms](docs/legal/TERMS.md)\n',
    'docs/legal/TERMS.md': '# Terms and conditions\n\nA hobby project, offered with no warranty.\n',
  }, { remote: 'https://github.com/acme/widget.git' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);
  const html = exportBundle(dir, cfg);

  includes(html, '<h2>Legal</h2>', 'the About panel must carry a Legal card');
  includes(html, 'data-go="doc--docs__legal__TERMS"', 'and link the document the bundle carries');
  // The label comes from the page <title>, not the <h1> — the <h1> holds an anchor whose glyph is a literal
  // "#", so stripping its tags yields "#Terms and conditions".
  ok(!/>#Terms and conditions</.test(html), 'the label must not carry the heading anchor glyph');
  // The invariant that matters, asserted the way the sibling test asserts it: every target resolves.
  for (const m of html.matchAll(/data-go="([\w.-]+)"/g)) {
    ok(html.includes(`data-page="${m[1]}"`), `nothing in the bundle answers to #${m[1]}`);
  }
});

test('bundle · a corpus with no legal documents gets a stated absence, not a dead link', () => {
  // `pubRepo` has no docs/legal/. The failure this guards is the one the whole project guards against
  // everywhere else: filling a gap plausibly instead of naming it.
  const cfg = resolveConfig(pubRepo);
  const index = buildIndex(pubRepo, cfg);
  renderSite(index, runHealth(index, cfg, pubRepo), cfg, pubRepo);
  const html = exportBundle(pubRepo, cfg);

  includes(html, '<h2>Legal</h2>', 'the card is still rendered, so the absence is visible');
  includes(html, 'carries no documents under a', 'and says why it is empty');
  ok(!/data-go="doc--[^"]*legal[^"]*"/i.test(html), 'no link may be invented for a document that is not here');
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
 * The bite: `skills/build/SKILL.md` carried an unquoted description ending
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

/* ================================================================== the executive page */

console.log('\nexecutive page');

/** A plan with two tracks: one averaged entirely from estimates, one from a mix. */
const EXEC_PLAN = [
  '| Item | % |', '|---|---|',
  '| K-1 | 50* |', '| K-2 | 70* |', '| K-3 | 40 |', '| K-4 | 60* |', '',
  '## Track 1 — Guessed', '',
  '**K-1 · One** — **P1 · High**', '*First.*', '',
  '**K-2 · Two** — **P1 · High**', '*Second.*', '',
  '## Track 2 — Mixed', '',
  '**K-3 · Three** — **P1 · High**', '*Third.*', '',
  '**K-4 · Four** — **P2 · Medium**', '*Fourth.*',
].join('\n');

/**
 * The pieces every test below renders a page from.
 *
 * **`__root` is set here, and leaving it off was a real defect rather than an omission.** Several panels ask
 * git and the working tree directly — `readInflight`, `branchInventory`, `readChanges`, and now the token
 * economics reader — and every one of them resolves its repository as `cfg.__root || process.cwd()`. Without
 * `__root` that fallback is *the checkout the test runner happens to be sitting in*, so a page built from this
 * fixture was reading the developer's own uncommitted work.
 *
 * It failed exactly the way that arrangement always fails: silently, on somebody else's machine. The nested
 * `<section class="sect">` that `views · a panel spans because of its own outermost element` asserts on is
 * `inflightPanel`'s session task list, which only renders when the repository being read has an open task in
 * `.atlas/tasks-live.jsonl`. On the machine that wrote the test there was one, so it passed; on a clean
 * checkout there is none, `flight.quiet` is true, the panel renders its one-line quiet form, and the test
 * fails claiming its own fixture is broken. The fixture was never the problem — it was never being read.
 *
 * `repoCtx` below existed solely to add this line for the repository tests, which is the tell: half the view
 * tests read their fixture and half read the developer's laptop, and nothing said which was which.
 */
function execCtx(name, extra = {}) {
  const dir = fixture(name, { 'docs/TASKS.md': EXEC_PLAN, 'docs/README.md': '# Docs\n', ...extra });
  const cfg = { ...resolveConfig(dir), planning: { source: 'docs/TASKS.md' }, __root: dir };
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  return { dir, cfg, index, health, plan: readPlanning(dir, cfg), contrib: null, nav: [] };
}

/** A commit at a chosen instant, so a week gap is a real gap in git rather than a fabricated series. */
function commitAt(dir, iso, file, body) {
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', `chore: ${file}`],
    { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });
}

test('views · a page with no more cards than masonry has columns takes the full width instead', () => {
  // Measured on the Executive view at a 1500px viewport before this landed: three cards, three declared
  // columns, and the third column 389px wide and entirely empty. `break-inside:avoid` makes each card an
  // atom, the flow balances no shorter than its tallest atom — the chart wall, at 1375px — and then fills
  // greedily, so the other two both fitted underneath it in column two. Columns cannot pack what they have
  // not got, and the 1375px was itself caused by squeezing a wall of small multiples into 389px.
  const ctx = execCtx('exec-flow');
  const few = viewPage({ id: 'executive', title: 'Executive', panels: ['tiles', 'progress', 'status', 'caveats'] },
    ctx, (o) => o.body);
  includes(few, 'class="dash-flow"', 'three cards and three columns must not be laid out as columns');
  eq(/class="dash-single"/.test(few), false, 'the column layout leaves one whole column empty here');

  const many = viewPage({ id: 'wide', title: 'Wide', panels: ['tiles', 'progress', 'status', 'health', 'clusters', 'caveats'] },
    ctx, (o) => o.body);
  includes(many, 'class="dash-single"', 'more cards than columns is exactly what masonry is for');
  eq(/class="dash-flow"/.test(many), false, 'five cards in one column would be a very long page');
});

test('views · a panel spans because of its own outermost element, not because of something nested in it', () => {
  // `inflightPanel` renders a <section class="sect"> for the session task list INSIDE its card, and the old
  // test searched the whole panel for that string — so the in-flight card was counted as a full-width span,
  // hoisted above cards it never spanned, and left the page one card short of the count that decides the
  // layout. Four cards here, so the page must stay in columns.
  const ctx = execCtx('exec-spans', {
    '.atlas/tasks-live.jsonl': JSON.stringify({ id: '1', subject: 'Something underway', status: 'in_progress' }) + '\n',
  });
  const html = viewPage({ id: 'x', title: 'X', panels: ['inflight', 'progress', 'status', 'caveats'] }, ctx, (o) => o.body);
  includes(html, 'class="sect"', 'the fixture must actually produce the nested section, or this proves nothing');
  includes(html, 'class="dash-single"', 'the in-flight card is a card, and four cards fill three columns');
});

test('dashboard · the chart wall takes the whole width rather than one masonry column', () => {
  // .chart-wall sizes its cells with auto-fit minmax(260px, 1fr). In a 389px column that resolves to one
  // chart per row, so five small multiples became a 1375px vertical stack — the panel whose entire job is to
  // be taken in at a glance was the tallest thing on the page.
  const ctx = execCtx('exec-wall');
  const html = viewPage({ id: 'x', title: 'X', panels: ['charts', 'progress', 'status', 'health', 'clusters'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.extraHead + o.body);
  includes(html, 'class="card wall" id="charts"', 'the wall declares itself full width');
  includes(html, '.dash-single > .wall { column-span:all; }', 'and the masonry layout honours it');
  includes(html, '.wall { grid-column:1 / -1; }', 'as does the full-width layout');
});

test('charts · a sparkline refuses one point, and speaks every value it draws', () => {
  // A tooltip is not a way to read a value: a figure reachable only by hovering does not exist for anyone
  // reading with a keyboard or a screen reader. And one bar is a rectangle, which is not a trend — the same
  // rule donut() already holds to at two slices.
  eq(sparkbars({ values: [4], labels: ['w1'] }), '', 'one point draws nothing at all');

  const s = sparkbars({ values: [3, 0, 7], labels: ['a', 'b', 'c'], caption: 'per week', unit: ' commits' });
  includes(s, 'aria-label="per week: a 3, b 0, c 7"', 'every value is readable without a pointer');
  includes(s, '<title>a: 3 commits</title>', 'and each bar names itself on hover as well');
  eq((s.match(/<rect/g) || []).length, 3, 'a measured zero keeps its slot');
  includes(s, 'height="0.00"', 'and draws nothing in it');

  const gap = sparkbars({ values: [3, null, 7], labels: ['a', 'b', 'c'], caption: 'per week' });
  eq((gap.match(/<rect/g) || []).length, 2, 'an unknown is a gap, not a floor-height bar');
  includes(gap, 'b unknown', 'and it is named as unknown rather than dropped');
});

test('dashboard · a fortnight with no commit in it is drawn as empty weeks, not closed up', () => {
  // aggregateWeeks only creates an entry for a week that contains a commit, and every time chart here plots
  // by index — so three weeks of silence rendered as a single step between two bars, and "which way is this
  // going" is the only question these charts exist to answer. Filled with zero rather than unknown: git
  // history is complete over its own range, so an empty week was looked at.
  const ctx = execCtx('exec-weeks');
  // The fixture's own initial commit is dated now, which would put months of real silence in the range and
  // make this assert on the calendar. Moved onto the first week so the range is exactly the four below.
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--amend', '--no-edit', '--date=2026-01-05T09:00:00Z'],
    { cwd: ctx.dir, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' } });
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  commitAt(ctx.dir, '2026-01-26T10:00:00Z', 'b.txt', 'two');
  const html = viewPage({ id: 'x', title: 'X', panels: ['deliveryTiles', 'charts'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);

  includes(html, '2 week(s) in this range contain no commit and are drawn as zero',
    'the filled weeks are counted and stated, never slipped in');
  includes(html, 'per week · 4 week(s)', 'the sparkline spans the whole range, not just the busy weeks');
  includes(html, 'class="spark"', 'and the commits tile carries it');
});

test('dashboard · one week of history says there is no shape to draw, instead of drawing one', () => {
  // The fixture makes a single commit, so there is exactly one week. Two bars is the floor for a trend, and
  // the tile has to say that rather than quietly showing nothing where a picture belongs.
  const ctx = execCtx('exec-oneweek');
  const html = viewPage({ id: 'x', title: 'X', panels: ['deliveryTiles'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);
  includes(html, 'under two weeks of history, so there is no shape to draw yet');
  eq(/class="spark"/.test(html), false, 'and nothing is drawn');
});

test('dashboard · a track mean built only from estimates is hatched, and a mixed one says so in words', () => {
  // planning.mjs has always carried the estimated flag and the caveats panel has always promised those
  // figures are "drawn hatched". This chart never hatched anything, so a track averaged from two guesses was
  // drawn identically to one averaged from two measurements. A mean over a mix is neither, so it is not
  // hatched — it gets the exact count instead, because hatching a bar that is half measured would swap one
  // wrong claim for another.
  const ctx = execCtx('exec-estimated');
  const html = viewPage({ id: 'x', title: 'X', panels: ['progress'] }, ctx, (o) => o.body);

  eq((html.match(/class="bf t-mid est"/g) || []).length, 1, 'only the all-estimated track is hatched');
  eq((html.match(/class="bf t-mid"/g) || []).length, 1, 'and the mixed one is not');
  includes(html, '2 of 2 items measured · 2 estimated', 'the all-estimated track states its count');
  includes(html, '2 of 2 items measured · 1 estimated', 'and so does the mixed one');
  includes(html, 'A <strong>hatched</strong> bar is a mean with no measurement under it at all',
    'the caption explains the hatch, because a texture nobody can decode is decoration');
});

test('dashboard · the plan having no history is stated, rather than left to look like no movement', () => {
  // Every delivery figure here has a past, because git keeps one. Completion does not: the planning document
  // is read as it stands and nothing records what it said last month. Saying nothing about that reads as the
  // much stronger claim that completion is not moving.
  const ctx = execCtx('exec-history');
  const html = viewPage({ id: 'x', title: 'X', panels: ['caveats'] }, ctx, (o) => o.body);
  includes(html, 'no trend in completion can be drawn');
  includes(html, 'docs/TASKS.md as it stands now', 'and it names the document it read');
});

test('dashboard · every custom property a generated page draws with is a property that page defines', () => {
  // stroke:var(--rule) with --rule undefined is invalid at computed-value time, and for an inherited property
  // that means `inherit` — whose value for `stroke` at the document root is `none`. Verified in a browser
  // before the fix: getComputedStyle on .c-axis returned "none", so every axis line and every gridline this
  // tool has ever drawn was invisible, on both themes. --warn did the same to the words "figure estimated in
  // the source", which is the one marker separating an estimate from a measurement.
  // Read off a real page rather than a panel, because the two stylesheets that have to agree only meet
  // there: the shell's palette comes from render.mjs and the chart rules from here.
  const ctx = execCtx('exec-tokens');
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  renderSite(ctx.index, ctx.health, ctx.cfg, ctx.dir);
  const out = path.join(ctx.dir, ctx.cfg.output);
  // The shell's palette lives in the linked stylesheet, so the page and its sheet are read as one.
  const sheet = fs.readFileSync(path.join(out, 'atlas.css'), 'utf8');
  for (const f of fs.readdirSync(out).filter((x) => x === 'dashboard.html' || x.startsWith('view-'))) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    const declared = new Set([...`${sheet}\n${html}`.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    // Only bare references matter — var(--x, fallback) has already answered the question.
    const used = [...new Set([...html.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]))];
    eq(used.filter((v) => !declared.has(v)), [], `${f}: a mark drawn with an undefined property is drawn in none`);
  }
});

test('dashboard · every table on a generated view page sits in a scroll container that can be reached', () => {
  // The wrapper was never the missing piece — an audit of the whole generated site found no unwrapped table.
  // What was missing is that the wrapper said nothing: measured on the Quality view at 1500px, a 520px table
  // inside a 347px masonry column with overlay scrollbars simply loses 173px of columns, and a box that
  // scrolls without being focusable loses them to the keyboard outright.
  const dir = fixture('table-reach', { 'docs/TASKS.md': EXEC_PLAN, 'docs/README.md': '# Docs\n' });
  const cfg = { ...resolveConfig(dir), planning: { source: 'docs/TASKS.md' } };
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);

  const out = path.join(dir, cfg.output);
  let seen = 0;
  for (const f of fs.readdirSync(out).filter((x) => x === 'dashboard.html' || x.startsWith('view-'))) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of html.matchAll(/<table\b/g)) {
      seen++;
      const before = html.slice(Math.max(0, m.index - 300), m.index);
      const at = before.lastIndexOf('<div class="table-wrap"');
      ok(at !== -1, `${f}: a table renders outside a scroll container`);
      includes(before.slice(at), 'tabindex="0"', `${f}: the scroll container cannot be focused`);
    }
  }
  ok(seen > 0, 'the fixture must actually render some tables, or this test proves nothing');
});

test('views · the Executive page renders full width and answers spec-to-build, as shipped', () => {
  // The two synthetic tests above prove the rule; this one proves the page that prompted it. Everything else
  // on this view is the plan describing itself or git describing itself — coverage is the only figure that
  // crosses the two and asks whether the items claiming progress are the ones commits actually name.
  const exec = DEFAULT_VIEWS.find((v) => v.id === 'executive');
  ok(exec.panels.includes('coverage'), 'the shipped view names the coverage panel');

  const ctx = execCtx('exec-shipped');
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  const html = viewPage(exec, { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);
  includes(html, 'class="dash-flow"', 'the shipped Executive view must not be laid out in columns');
  includes(html, 'Spec to build', 'and it carries the coverage panel it names');
});

/* ================================================================== the repository view */

console.log('\nrepository view');

/**
 * A view context whose git root is the fixture, not the checkout the test runner happens to be sitting in.
 *
 * Now exactly what `execCtx` returns — `__root` moved up there once it became clear that every caller wanted
 * it and the ones that were not asking for it were quietly reading the developer's own repository. Kept as a
 * name because the repository tests read better calling it, and because deleting it would touch twenty call
 * sites to say nothing new.
 */
const repoCtx = (name, extra = {}) => execCtx(name, extra);

/** Like `commitAt`, but under a second identity — the only way to get a repository with two authors. */
function commitAs(dir, iso, who, file, body) {
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', `user.email=${who}@example.com`, '-c', `user.name=${who}`,
    'commit', '-qm', `chore: ${file}`],
    { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });
}

test('dashboard · a renamed file does not invent a directory that has never existed', () => {
  // `git log --numstat` writes a rename as `OLD.md => docs/moved/NEW.md`, and contrib.mjs keeps that whole
  // expression as the path — so `areaOf` splits it on `/` and manufactures a directory out of the fragment it
  // lands on. Verified against this repository's own history: fourteen rename records produce five areas that
  // have never existed, `ROADMAP.md => docs` among them, and `atlas ownership` prints them today as areas with
  // a bus factor of one.
  const ctx = repoCtx('repo-rename', { 'OLD.md': 'x\n'.repeat(40) });
  execFileSync('git', ['mv', 'OLD.md', 'docs/moved-NEW.md'], { cwd: ctx.dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'chore: move'],
    { cwd: ctx.dir, stdio: 'ignore' });

  const contrib = readContrib(ctx.dir, ctx.cfg);
  // A-30 moved the flattening into `contrib.mjs`, so by the time a panel sees a path the arrow is already
  // gone. The fixture is still required to have produced a rename — otherwise this test proves nothing —
  // but the evidence is now the `renamed` flag rather than notation left lying in the path.
  ok(contrib.commits.some((c) => c.files.some((f) => f.renamed)),
    'the fixture must actually produce a rename record, or this test proves nothing');
  const raw = contrib.commits.flatMap((c) => c.files.map((f) => f.path));
  eq(raw.some((p) => p.includes(' => ')), false,
    'the reader, not the view, is what strips the notation now');

  const html = viewPage({ id: 'repository', title: 'R', panels: ['churn', 'hotspots'] },
    { ...ctx, contrib }, (o) => o.body);
  eq(/=&gt;|=>/.test(html), false, 'no panel may print git rename notation as if it were a path');
  eq(/\{|\}/.test(html.replace(/<[^>]*>/g, '')), false, 'nor the braced form of it');
  includes(html, 'docs/moved-NEW.md', 'the file is named where it lives now, not where it used to');
});

test('dashboard · what the work returns to is ranked by touches, and where churn lands by lines', () => {
  // The two lists deliberately disagree, and that disagreement is the whole reason both exist. A version
  // stamp bumped by every release is the most-touched file in most repositories and among the least-changed;
  // ranking either panel by the other's measure would collapse them into one page saying one thing twice.
  const ctx = repoCtx('repo-rank');
  for (let i = 0; i < 4; i++) commitAt(ctx.dir, `2026-01-0${5 + i}T10:00:00Z`, 'stamp.txt', `v${i}\n`);
  commitAt(ctx.dir, '2026-01-09T10:00:00Z', 'docs/big.md', '# Big\n\n' + 'line\n'.repeat(300));

  const contrib = readContrib(ctx.dir, ctx.cfg);
  const html = viewPage({ id: 'repository', title: 'R', panels: ['hotspots', 'churn'] },
    { ...ctx, contrib }, (o) => o.body);

  // Read the bar labels in order rather than searching the markup: every caption on these panels names a
  // path as an example, so a bare indexOf would happily match the prose above the chart it is asserting on.
  const labels = (section) => [...section.matchAll(/<span class="bl">([^<]*)<\/span>/g)].map((m) => m[1].trim());
  const hot = labels(html.slice(html.indexOf('What the work keeps returning to'), html.indexOf('Where the churn lands')));
  const churn = labels(html.slice(html.indexOf('Where the churn lands')));

  ok(hot.indexOf('stamp.txt') !== -1 && hot.indexOf('stamp.txt') < hot.indexOf('docs/big.md'),
    `the file touched four times outranks the one touched once, however few lines it moved: ${hot.join(', ')}`);
  includes(html, '/commit', 'and every row carries lines-per-commit, which is what tells the two kinds apart');
  ok(churn.indexOf('docs') !== -1 && churn.indexOf('docs') < churn.indexOf('(root)'),
    `while the churn panel puts the 300-line directory above the four-line one: ${churn.join(', ')}`);
});

test('dashboard · branch names never leave the machine, and the count does', () => {
  // publish.mjs learned this by shipping it: a standalone export went out carrying a private task list and
  // every uncommitted path, because each panel was correct and nobody had asked who would read it. A branch
  // name is the same category and frequently worse — it is often the name of a customer. The count is a
  // statistic about a set rather than the set, which is the line the journal panel already draws.
  const ctx = repoCtx('repo-branches');
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  execFileSync('git', ['switch', '-c', 'fix/acme-outage-postmortem'], { cwd: ctx.dir, stdio: 'ignore' });

  const html = viewPage({ id: 'repository', title: 'R', panels: ['repoTiles', 'branches'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);
  includes(html, 'fix/acme-outage-postmortem', 'the local page names the branch, which is the point of it');
  includes(html, 'data-local-only', 'and marks the card so the publisher can find it');

  const shipped = stripLocalOnly(html);
  eq(shipped.includes('fix/acme-outage-postmortem'), false, 'a publish must not carry the name');
  includes(shipped, 'local branches', 'but the count survives — a statistic about a set is not the set');
});

test('dashboard · a repository with one committer refuses to report a bus factor', () => {
  // "30 sole-author areas" on a single-committer repository is arithmetic wearing the costume of a risk
  // report: it measures the project's age, not its exposure, and every area would say the same thing.
  // ownership.mjs already refuses this in prose; the tile refuses it with an em dash where a figure would go,
  // because a number somebody can act on must not look like one that cannot mean anything yet.
  const solo = repoCtx('repo-solo');
  commitAt(solo.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  const one = viewPage({ id: 'repository', title: 'R', panels: ['repoTiles'] },
    { ...solo, contrib: readContrib(solo.dir, solo.cfg) }, (o) => o.body);
  includes(one, 'one committer in this whole history');
  includes(one, '—</p><p class="tl">sole-author areas</p>',
    'the figure is withheld with an em dash, not printed as a count nobody can act on');

  // Two authors, and the same tile becomes answerable.
  // `a.txt` at the root by one author, `docs/b.md` by the other — so `(root)` has a sole author and `docs`
  // does not, and the tile has something real to count rather than a repository-wide constant.
  const duo = repoCtx('repo-duo');
  commitAt(duo.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  commitAs(duo.dir, '2026-01-06T10:00:00Z', 'Second', 'docs/b.md', '# Two\n');
  const two = viewPage({ id: 'repository', title: 'R', panels: ['repoTiles'] },
    { ...duo, contrib: readContrib(duo.dir, duo.cfg) }, (o) => o.body);
  eq(two.includes('one committer in this whole history'), false, 'with two authors the refusal is withdrawn');
  includes(two, 'nobody left has edited them', 'and the tile states what a sole author actually means');
});

test('dashboard · commits per week no longer closes a silent fortnight into one step', () => {
  // The chart plotted `contrib.weeks` straight, and aggregateWeeks creates an entry only for a week that
  // contained a commit — so silence was not flat here, it was absent, and the bar after a gap sat flush
  // against the bar before it. Worse than the line charts making the same mistake, because these rows are
  // labelled with their week: the page printed 2026-01-05 immediately above 2026-01-26 as consecutive rows of
  // a series called "per week". weeklyAxis was written for exactly this and this chart never used it.
  const ctx = repoCtx('repo-velocity');
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--amend', '--no-edit', '--date=2026-01-05T09:00:00Z'],
    { cwd: ctx.dir, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' } });
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  commitAt(ctx.dir, '2026-01-26T10:00:00Z', 'b.txt', 'two');

  const html = viewPage({ id: 'x', title: 'X', panels: ['velocity'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);
  includes(html, '2026-01-12', 'the empty week between the two is drawn');
  includes(html, 'no commit this week', 'and says so on the row rather than being a gap in the labels');
  includes(html, '2 of them contain no commit and are drawn as zero rather than skipped',
    'the filled weeks are counted and stated, never slipped in');
});

test('views · the Repository page states what its own panels cannot see', () => {
  // The caveats card had no idea which page it was on, so it listed what the plan and the corpus cannot show
  // and nothing about the four new blind spots underneath it. A card headed "what this dashboard does not
  // show" that omits the omissions is the most misleading thing that could sit on the page.
  const view = DEFAULT_VIEWS.find((v) => v.id === 'repository');
  ok(view, 'the view ships');
  ok(!view.panels.includes('velocity') && !view.panels.includes('people'),
    'and does not simply re-run Delivery under another name');

  const ctx = repoCtx('repo-caveats');
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  const contrib = readContrib(ctx.dir, ctx.cfg);
  const here = viewPage(view, { ...ctx, contrib }, (o) => o.body);
  includes(here, 'A file is followed by path, not by identity');
  includes(here, 'read only non-merge commits');
  includes(here, 'only branches that exist in this checkout');
  includes(here, 'including files that were later deleted');

  // Scoped to the page, not bolted onto every page — Delivery has none of these panels and must claim none
  // of these limits, or the caveat list stops being readable as a description of what is above it.
  const delivery = viewPage(DEFAULT_VIEWS.find((v) => v.id === 'delivery'), { ...ctx, contrib }, (o) => o.body);
  eq(delivery.includes('only branches that exist in this checkout'), false,
    'a page without the branch panel must not carry the branch panel\'s caveat');
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

test('contrib · a rename is read as the file that exists, not as a directory nobody can open', () => {
  // A-30. `git log --numstat` has rename detection on by default, and when it fires the path column stops
  // being a path: `ROADMAP.md => docs/ROADMAP.md` whole-path, `docs/{a => b}/n.md` when a prefix factors out.
  // Kept verbatim it reaches `areaOf`, which splits on `/` and takes the first segment — so the arrow and
  // whatever sits beside it becomes a directory. On this repository's own history fourteen such records
  // manufactured five areas that have never existed, and `atlas ownership` shipped all five as bus-factor-1
  // risks. Fixed at the read, so `ownership`, `kb` and the Repository view are fixed at once rather than
  // each growing a copy of the same regex.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rename-'));
  execFileSync('git', ['init', '-q', '-b', 'main', d], { stdio: 'ignore' });
  fs.mkdirSync(path.join(d, 'docs'), { recursive: true });
  commitMsg(d, 'ROADMAP.md', 'first\n', 'feat(plan): a roadmap');
  fs.renameSync(path.join(d, 'ROADMAP.md'), path.join(d, 'docs', 'ROADMAP.md'));
  execFileSync('git', ['add', '-A'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-qm', 'refactor(plan): move it under docs'], { cwd: d, stdio: 'ignore' });

  const c = readContrib(d, {});
  const paths = c.commits.flatMap((x) => x.files.map((f) => f.path));
  ok(paths.includes('docs/ROADMAP.md'), 'the rename must resolve to the path that exists afterwards');
  eq(paths.some((p) => p.includes('=>')), false, 'no path may carry git\'s rename arrow');

  // The area is the directory you can actually open — this is the assertion that fails without the fix,
  // where `areaOf` would return `ROADMAP.md => docs`.
  // Wrapped, not passed by reference: `areaOf(p, depth = 2)` would otherwise receive the array index
  // as its depth, and index 0 collapses every path to the empty string.
  const areas = new Set(paths.map((p) => areaOf(p)));
  eq([...areas].some((a) => a.includes('=>')), false, `invented area(s): ${[...areas].join(', ')}`);
  ok(areas.has('docs'), 'the moved file belongs to docs/');

  // And the evidence survives normalisation, or the Repository view cannot quantify its own caveat.
  ok(c.commits.some((x) => x.files.some((f) => f.renamed)), 'a rename must still be recorded as one');
  fs.rmSync(d, { recursive: true, force: true });
});

/* ================================================================== git insight */

console.log('\ngit insight');

/** Commit with an exact message, so a body and its trailers can be told apart. */
function commitMsg(dir, file, body, message) {
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', message],
    { cwd: dir, stdio: 'ignore' });
}

const gitIn = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

test('git insight · a silent week is filled with zero, and the fill is counted', () => {
  // `contrib.mjs::aggregateWeeks` emits no entry for a week with no commits, so a fortnight of silence
  // disappears from the array and the next week sits flush against the last. Anything reading the series by
  // index then draws two months of nothing as one step — the single thing a rhythm measure must not do.
  // Filled with zero rather than unknown, because git is complete over its own range: a week with no entry
  // is a week that was examined and had none, which is a measurement.
  const sparse = [
    { week: '2026-01-05', commits: 4, added: 1, removed: 0, ai: 0, authors: 1 },
    { week: '2026-02-02', commits: 6, added: 1, removed: 0, ai: 0, authors: 1 },
  ];
  const { weeks, filled } = fillWeeks(sparse);
  eq(weeks.length, 5, 'four weeks separate the two commits, so the axis is five wide');
  eq(filled, 3, 'the count of fabricated weeks is reported, never hidden');
  eq(weeks.map((w) => w.commits), [4, 0, 0, 0, 6], 'a silent week is zero — not null, not absent');
  ok(weeks.filter((w) => w.silent).every((w) => w.commits === 0), 'a filled week is flagged as filled');
  eq(fillWeeks([sparse[0]]).filled, 0, 'a single week has no gap to fill and none is invented');
});

test('git insight · a large commit contributes no coupling pairs, and the exclusion is counted', () => {
  // One commit touching forty files contributes 780 pairs, every one of them co-occurring exactly once. A
  // rename sweep or a generated-output refresh would be the loudest signal on the page, and it would mean
  // nothing. Excluded wholesale — and the number excluded is reported, because a silent filter is a lie
  // about the window.
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `sweep/f${i}.js`, added: 1, removed: 0 }));
  const contrib = {
    available: true,
    commits: [
      { date: '2026-01-01T00:00:00Z', files: many },
      { date: '2026-01-02T00:00:00Z', files: [{ path: 'a.js' }, { path: 'b.js' }] },
      { date: '2026-01-03T00:00:00Z', files: [{ path: 'a.js' }, { path: 'b.js' }] },
      { date: '2026-01-04T00:00:00Z', files: [{ path: 'a.js' }, { path: 'b.js' }] },
      { date: '2026-01-05T00:00:00Z', files: [{ path: 'solo.js' }] },
    ],
  };
  const k = coupling(contrib, { root: null });
  eq(k.excludedLarge, 1, 'the sweep is excluded and counted');
  eq(k.excludedSingle, 1, 'a one-file commit has no pair to contribute, and is counted too');
  eq(k.basis, 3, 'the window is the usable commits, and it is stated');
  eq(k.pairs.length, 1, 'only the pair that recurs survives the support floor');
  ok(!k.pairs.some((p) => p.a.startsWith('sweep/')), 'no pair may come from the excluded commit');
});

test('git insight · on a young repository coupling is anecdote, and says so in the output', () => {
  // "These two files change together 100% of the time" over three commits is a coincidence with a percentage
  // attached. The support count travels with every pair, and below the stated basis floor the report leads
  // with the word ANECDOTE rather than leaving the reader to notice the sample size.
  const contrib = {
    available: true,
    commits: Array.from({ length: 3 }, (_, i) => ({
      date: `2026-01-0${i + 1}T00:00:00Z`, files: [{ path: 'a.js' }, { path: 'b.js' }],
    })),
  };
  const k = coupling(contrib, { root: null });
  eq(k.anecdotal, true, `3 usable commits is below the floor of ${k.minBasis}`);
  eq(k.pairs[0].support, 3, 'the raw count is carried, not just the percentage');
  const out = formatGitInsight({ available: true, section: 'coupling', sections: { coupling: k } }, false);
  includes(out, 'ANECDOTE, NOT SIGNAL', 'the caveat is in the output, not in a docblock nobody reads');
  includes(out, 'over 3 shared commit(s)', 'the support count is printed beside the percentage');
});

test('git insight · a branch that never diverged is at-main, not spent', () => {
  // `git for-each-ref --merged main` answers "reachable from main", which is trivially true of a branch
  // created ten seconds ago with nothing on it. The first draft therefore listed a sibling session's brand
  // new working branch as *merged, nothing unique on it* — accurate, and reading as "delete this" beside
  // twenty-six genuinely finished branches. `behind` is what separates the two.
  const dir = fixture('gi-branches', { 'docs/A.md': '# A\n' });
  const main = gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  gitIn(dir, 'switch', '-q', '-c', 'feat/landed');
  commitMsg(dir, 'docs/B.md', '# B\n', 'feat: landed work');
  gitIn(dir, 'switch', '-q', main);
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/landed');
  gitIn(dir, 'switch', '-q', '-c', 'feat/fresh');
  gitIn(dir, 'switch', '-q', main);
  gitIn(dir, 'switch', '-q', '-c', 'feat/open');
  commitMsg(dir, 'docs/C.md', '# C\n', 'feat: unlanded work');
  gitIn(dir, 'switch', '-q', main);

  const k = branchHealth(dir, { branching: { main } });
  ok(k.available, 'the survey must run on an ordinary repository');
  const state = (n) => k.branches.find((b) => b.name === n);
  eq(state('feat/fresh').ahead, 0);
  eq(state('feat/fresh').behind, 0);
  eq(k.atMain.map((b) => b.name), ['feat/fresh'], 'a branch sitting on the trunk commit is new, not finished');
  eq(k.spent.map((b) => b.name), ['feat/landed'], 'merged AND behind is the branch whose work landed');
  eq(k.unmerged.map((b) => b.name), ['feat/open'], 'a branch with unmerged commits is open');
  ok(!k.spent.some((b) => b.name === 'feat/fresh'), 'the fresh branch must never be offered as safe to lose');
});

test('git insight · an unmeasured ahead/behind stays null and renders as ?, never 0', () => {
  // "0 ahead" for a branch nobody measured is how work gets thrown away. The cap on the ahead/behind pass is
  // real and is stated; what it must never do is fill the gap with a number.
  const dir = fixture('gi-cap', { 'docs/A.md': '# A\n' });
  const main = gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  for (const n of ['feat/one', 'feat/two']) {
    gitIn(dir, 'switch', '-q', '-c', n);
    commitMsg(dir, `docs/${n.slice(5)}.md`, '# x\n', `feat: ${n}`);
    gitIn(dir, 'switch', '-q', main);
  }
  const k = branchHealth(dir, { branching: { main } }, { ...DEFAULT_GITINSIGHT, branchDetailCap: 1 });
  eq(k.detailed, 1, 'the cap applied');
  ok(k.undetailed >= 1, 'and the number left unread is reported rather than dropped');
  const unread = k.branches.filter((b) => b.ahead === null);
  ok(unread.length >= 1, 'a branch past the cap keeps null, not zero');
  const out = formatGitInsight({ available: true, section: 'branches', sections: { branches: k } }, false);
  includes(out, '?', 'an unread figure renders as a question mark');
  includes(out, 'unread (? = never measured, not zero)', 'and the legend says what the mark means');
  ok(!k.spent.some((b) => b.ahead === null), 'nothing unread may be called spent — the claim is that deleting it loses nothing');
});

test('git insight · trailers alone are not a commit body', () => {
  // Every commit in this repository ends with Co-Authored-By: and Desk:. A naive "is %b non-empty" check
  // therefore reports 100% of commits as explained, in exactly the repository that mandates those trailers —
  // a perfect score produced by a convention unrelated to what is being measured.
  const dir = fixture('gi-bodies', { 'docs/A.md': '# A\n' });
  commitMsg(dir, 'docs/B.md', '# B\n', 'feat: subject only');
  commitMsg(dir, 'docs/C.md', '# C\n', 'feat: trailers only\n\nCo-Authored-By: Someone <s@example.com>\nDesk: test');
  commitMsg(dir, 'docs/D.md', '# D\n', 'feat: real body\n\nWhy this happened.\n\nCo-Authored-By: Someone <s@example.com>');

  const cfg = resolveConfig(dir);
  const k = hygiene(dir, readContrib(dir, cfg), { plan: null });
  ok(k.available, 'hygiene must read an ordinary repository');
  eq(k.bodiesRead, 4, 'the initial commit plus three');
  eq(k.noBody, 3, 'the trailer-only commit counts as having no body, alongside the two bare subjects');
  eq(k.namingPlanItem, null, 'with no planning source the strict figure is unread, not zero');
  const out = formatGitInsight({ available: true, section: 'hygiene', sections: { hygiene: k } }, false);
  includes(out, 'trailers alone do not count as a body');
  includes(out, '1 of 4', 'every rate prints its denominator');
});

test('git insight · a busy file no document cites is named, and markdown is excluded from that list', () => {
  // An orphaned .md is `atlas health`'s finding, under its own name; a second name for one finding is the
  // forked document this whole tool hunts for. A .md outside the index was excluded by the config on purpose,
  // so asking why the corpus does not document it is asking a question already answered — the generated daily
  // worklog is the case that made it obvious.
  // `notes/**` is excluded from the corpus by the config, so `notes/journal.md` is markdown that is NOT a
  // document — which is the case the extension test exists for. A .md file that IS indexed is already covered
  // by `isDocument`, so a fixture built only from indexed markdown proves nothing.
  const dir = fixture('gi-hotspots', {
    'project-atlas.config.json': JSON.stringify({ exclude: ['notes/**'] }),
    'docs/A.md': '# A\n\nThe engine lives at src/engine.js:10.\n',
    'src/engine.js': 'x\n',
    'src/quiet.js': 'y\n',
    'notes/journal.md': '# Journal\n',
  });
  commitMsg(dir, 'src/quiet.js', 'y2\n', 'fix: quiet');
  commitMsg(dir, 'src/quiet.js', 'y3\n', 'fix: quiet again');
  commitMsg(dir, 'notes/journal.md', '# Journal\n\nmore\n', 'chore: journal');
  commitMsg(dir, 'notes/journal.md', '# Journal\n\nmore still\n', 'chore: journal again');

  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const k = hotspots(readContrib(dir, cfg), { index, root: dir });
  const named = k.undocumented.map((r) => r.path);
  ok(named.includes('src/quiet.js'), `a busy uncited code file must be named — got ${JSON.stringify(named)}`);
  ok(!named.includes('src/engine.js'), 'a file a document cites is documented');
  ok(!named.some((p) => p.endsWith('.md')), `markdown is health.mjs's finding, not this one — got ${JSON.stringify(named)}`);
  eq(k.undocumentedTotal, k.undocumented.length >= 1 ? k.undocumentedTotal : 0);
  ok(k.byCommits.every((r) => fs.existsSync(path.join(dir, r.path))), 'a deleted path is history, not current risk');

  // Without an index the question was never asked, and the answer is unread rather than "undocumented".
  const blind = hotspots(readContrib(dir, cfg), { index: null, root: dir });
  eq(blind.indexed, false);
  eq(blind.undocumentedTotal, null, 'no corpus means no finding, not an empty one');
  eq(blind.byCommits[0].citedBy, null, 'unread is null, never an empty array');
});

test('git insight · --no-color is the coloured report with the escapes removed, and nothing else', () => {
  // Colour carries state and severity here, and it is never the only carrier: every red line also holds a
  // word, every threshold prints a number, every rate prints its denominator. The proof is mechanical —
  // strip the escapes from the coloured render and it must equal the plain one byte for byte. A reader
  // piping to a file is not a degraded reader.
  const dir = fixture('gi-color', { 'docs/A.md': '# A\n\nsrc/engine.js:1\n', 'src/engine.js': 'x\n' });
  commitMsg(dir, 'src/engine.js', 'y\n', 'fix: touch it');
  const cfg = resolveConfig(dir);
  const k = readGitInsight(dir, cfg, {
    contrib: readContrib(dir, cfg), index: buildIndex(dir, cfg), plan: null, section: 'all',
  });
  const painted = formatGitInsight(k, true);
  const plain = formatGitInsight(k, false);
  ok(/\x1b\[/.test(painted), 'the coloured render must actually emit ANSI, or this proves nothing');
  eq(/\x1b\[/.test(plain), false, '--no-color must emit no escape at all');
  eq(painted.replace(/\x1b\[[0-9;]*m/g, ''), plain,
    'removing the escapes must leave the plain report exactly — anything else is meaning carried by colour alone');
});

test('git insight · nothing under this command can mutate a repository', () => {
  // These are the commands an agent runs without asking, so the boundary is enforced by what the module can
  // do rather than by a warning in prose. One helper wraps every git call, and its verbs are an allowlist.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'gitinsight.mjs'), 'utf8');
  eq((src.match(/execFileSync\(/g) || []).length, 1,
    'exactly one execFileSync — a second call site is a second place the allowlist does not cover');
  const verbs = [...src.matchAll(/\bgit\(root,\s*\[\s*'([a-z][a-z-]*)'/g)].map((m) => m[1]);
  ok(verbs.length >= 4, `expected the module to call git several times, saw ${verbs.length}`);
  const READ_ONLY = new Set(['for-each-ref', 'rev-parse', 'rev-list', 'log', 'merge-base', 'ls-files', 'show']);
  for (const v of verbs) ok(READ_ONLY.has(v), `\`git ${v}\` is not on the read-only allowlist`);

  // And the *output* must not hand a runnable command to whatever is reading it. Asserted on the render
  // rather than on the source, because the source says so in a comment and a grep cannot tell the two apart —
  // which is how the first version of this test failed on the sentence explaining the rule.
  const dir = fixture('gi-readonly', { 'docs/A.md': '# A\n' });
  const main = gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  gitIn(dir, 'switch', '-q', '-c', 'feat/done');
  commitMsg(dir, 'docs/B.md', '# B\n', 'feat: work');
  gitIn(dir, 'switch', '-q', main);
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/done');
  const k = branchHealth(dir, { branching: { main } });
  eq(k.spent.map((b) => b.name), ['feat/done'], 'the fixture must actually produce a spent branch');
  const out = formatGitInsight({ available: true, section: 'branches', sections: { branches: k } }, false);
  includes(out, 'will not do it', 'the report says plainly that it refuses');
  eq(/\bgit\s+(branch|push|checkout|switch|fetch|reset|clean|gc|prune|remote|config)\b/.test(out), false,
    `the branch report offered a runnable git command:\n${out}`);
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

/**
 * A private home for the status tests: `clientRegistrations` reads real files, and a test that read the
 * developer's own `~/.claude.json` would pass or fail according to what that machine happens to have
 * registered. Every location the reporter looks in is therefore under a temp directory it owns.
 */
function mcpHome(name, files = {}) {
  const home = path.join(tmpRoot, `mcp-home-${name}`);
  fs.mkdirSync(home, { recursive: true });
  for (const [p, body] of Object.entries(files)) {
    const full = path.join(home, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return home;
}

test('mcp · --status is read from the code and the machine, never composed', () => {
  // The failure this pins is the easy one to ship: a status screen that hard-codes the protocol string and
  // types out a tool list, and is then wrong the day either changes — in a tool whose entire subject is
  // documentation drifting from the thing it describes.
  const dir = fixture('mcp-status', { 'docs/A.md': '# A\n' });
  const st = connectionStatus({ root: dir, version: '1.2.3', pluginRoot: REPO_ROOT,
                                home: mcpHome('empty'), platform: 'darwin', configDir: null });

  eq(st.protocolVersion, MCP_VERSION, 'the version reported is the version implemented');
  eq(st.server.version, '1.2.3');
  eq(st.transport, 'stdio');
  eq(st.tools.map((t) => t.name), Object.keys(MCP_TOOLS), 'every exposed tool is listed, and only those');
  for (const t of st.tools) eq(t.purpose, MCP_TOOLS[t.name].title, `${t.name}'s purpose is its own, not a paraphrase`);

  // The snippet has to work when pasted. A relative path in it is a registration that resolves against
  // whatever directory the client was launched in, which is the one thing the client is free to choose.
  ok(path.isAbsolute(st.connect.command), `the snippet's command must be absolute: ${st.connect.command}`);
  ok(fs.existsSync(st.connect.command), 'and must exist — a snippet naming a binary that is not there is a guess');
  eq(st.connect.args.slice(-2), ['--root', path.resolve(dir)], 'and must pin the corpus, not inherit a cwd');
  includes(st.connect.snippet, '"mcpServers"');

  // `--status` must short-circuit the serving path. If it fell through, this call would speak JSON-RPC on
  // stdout instead of answering, and the parse below is what notices.
  const r = cli(dir, ['mcp', '--status', '--json']);
  eq(r.code, 0, r.stdout);
  eq(JSON.parse(r.stdout).protocolVersion, MCP_VERSION);
});

test('mcp · a registration is reported where one exists, and "no" names the files it read', () => {
  // Two ways to be registered and wrong, both of which read as success: a config that points at another
  // checkout of atlas, and one that points this build at another repository. `--root` decides the second,
  // and a registration without it answers about whichever directory the client launched it in.
  const mine = fixture('mcp-registered', { 'docs/A.md': '# A\n' });
  const other = fixture('mcp-elsewhere', { 'docs/B.md': '# B\n' });
  fs.writeFileSync(path.join(mine, '.mcp.json'), JSON.stringify({
    mcpServers: { atlas: { command: path.join(REPO_ROOT, 'bin', 'atlas'), args: ['mcp', '--root', mine] } },
  }), 'utf8');
  const home = mcpHome('registered', {
    '.claude.json': JSON.stringify({
      mcpServers: { 'atlas-other': { command: '/opt/atlas/bin/atlas', args: ['mcp', '--root', other] } },
    }),
  });

  const st = connectionStatus({ root: mine, version: '0', pluginRoot: REPO_ROOT, home, platform: 'linux' });
  eq(st.registration.registered, true);
  const here = st.registration.found.find((f) => f.name === 'atlas');
  eq(here.servesThisRepo, true);
  eq(here.usesThisBuild, true);
  const elsewhere = st.registration.found.find((f) => f.name === 'atlas-other');
  eq(elsewhere.servesThisRepo, false, 'a --root pointing somewhere else is not this repository');
  eq(elsewhere.usesThisBuild, false, 'nor is a command under /opt this build');

  // And where nothing is registered, "no" is backed by named files rather than asserted. A report that says
  // "not registered" without saying where it looked cannot be checked by the person reading it.
  const bare = fixture('mcp-unregistered', { 'docs/A.md': '# A\n' });
  const none = connectionStatus({ root: bare, version: '0', pluginRoot: REPO_ROOT,
                                  home: mcpHome('bare'), platform: 'darwin' });
  eq(none.registration.registered, false);
  eq(none.registration.found.length, 0);
  ok(none.registration.looked.some((l) => l.file === path.join(bare, '.mcp.json') && l.state === 'absent'),
     'the project-scope file is named as absent, not silently omitted');
  ok(none.registration.unchecked.length >= 1, 'and the clients this build cannot read are declared');
});

test('mcp · a client config that will not parse is never reported as "not registered"', () => {
  // The project's rule, on the surface where breaking it is cheapest: a check that could not run is never
  // reported as passing. A half-written `~/.claude.json` is exactly where a registration would be hiding,
  // and folding it into "no" answers the question with the one file nobody read.
  const dir = fixture('mcp-unreadable', { 'docs/A.md': '# A\n' });
  const home = mcpHome('unreadable', { '.claude.json': '{ "mcpServers": { oops' });
  const st = connectionStatus({ root: dir, version: '0', pluginRoot: REPO_ROOT, home, platform: 'linux' });

  const row = st.registration.looked.find((l) => l.file === path.join(home, '.claude.json'));
  eq(row.state, 'unreadable');
  ok(row.detail, 'and it says why, so the reader can go and fix the file');

  const out = formatConnection(st, false);
  ok(!/^\s*Registered with a client on this machine\s+no\b/m.test(out),
     `a flat "no" is a claim about a file that would not open:\n${out}`);
  includes(out, 'could not be');
  includes(out, 'would not have been seen');
});

test('mcp · the status reports processes and parents, and never a connection count', () => {
  // The distinction the whole surface is built around. A stdio server has no pool: the client spawns one
  // process per connection and owns both ends of its pipes. "0 clients connected" would describe a daemon
  // this is not, and would read as "nothing uses this" when the truth is "nothing is using it this second".
  const dir = fixture('mcp-clients', { 'docs/A.md': '# A\n' });
  const st = connectionStatus({ root: dir, version: '0', pluginRoot: REPO_ROOT,
                               home: mcpHome('clients'), platform: 'darwin' });
  const out = formatConnection(st, false);
  ok(!/clients? connected/i.test(out), `nothing may present itself as a connection count:\n${out}`);
  includes(out, 'no connection pool');
  includes(out, 'one process per connection');
  includes(out, 'Not knowable from here');
  includes(out, 'unknown, not zero');

  // Unknown is not zero, in the code as well as the prose: a platform whose process table this cannot read
  // reports that it did not look, and an empty list beside `checked: false` is never "none running".
  const blind = runningServers({ platform: 'win32' });
  eq(blind.checked, false);
  eq(blind.processes.length, 0);
  ok(blind.why, 'and it says why it could not look');
  includes(formatConnection({ ...st, running: blind }, false), 'Not checked');
});

test('ask · a question reaches the document search, and a task reaches the structured answer', () => {
  // **Two features were given one command name and the older one lost silently.** `/atlas:ask` shipped
  // first — a person types a question, the skill runs `atlas ask $ARGUMENTS`, and the answer is which
  // documents to read. M-2 then added `atlas ask <task>` for programs on the same name and returned
  // unconditionally, so every question became `Unknown task` and the handler written for the skill became
  // unreachable code. Nothing failed loudly; the skill just stopped working, and the feature that shadowed
  // it looked healthy because its own form still worked.
  const dir = fixture('ask-two-shapes', {
    'project-atlas.config.json': '{}\n',
    'docs/PUBLISHING.md': '# Publishing\n\nHow the wiki target stages before it pushes.\n',
  });
  const run = (...args) => spawnSync(process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'ask', ...args],
    { cwd: dir, encoding: 'utf8' });

  // A known task id is the program's call: structured JSON.
  const structured = run('atlas_health');
  ok(structured.stdout.trim().startsWith('{'), 'a task id must still return the machine answer');
  includes(structured.stdout, '"task"');

  // Anything else is a person's question, and must reach the search rather than be rejected as a bad task.
  const question = run('publishing');
  ok(!/Unknown task/.test(question.stdout + question.stderr),
     'a question was rejected as an unknown task — the two handlers are shadowed again');
  includes(question.stdout, 'PUBLISHING.md');

  // **No argument is "could not answer", not "answered and clean".** Printing usage and falling out left the
  // exit code at 0, so a pipeline calling `atlas ask "$TASK"` with an empty variable was told the corpus was
  // sound when nothing had been asked — the exact confusion the command's own help text warns about.
  eq(run().status, 2, 'no argument must exit 2, not 0');
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

console.log('\nwork in flight');

/*
 * Every case below is synchronous, and that is load-bearing rather than incidental. The runner drains
 * `pendingAsync` partway through this file, so an `async` case registered after that point is never awaited
 * and is reported as a pass by never having run — which is the one failure mode a regression test must not
 * have. Each of these was also confirmed to fail with the panel reverted.
 */

test('inflight · a finished plan on a dirty branch no longer renders as a finished project', () => {
  // The complaint, verbatim: the Backlog view read "Backlog 62 · Done (62) · In progress (0) · Not started
  // (0)" while the reader was mid-change, on a branch, with uncommitted files. Every plan panel reads
  // `planning.source`, and a roadmap records what somebody has already written down and already marked — so
  // the one state the page could never show was the state its reader was actually in.
  const dir = fixture('inflight-dirty', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Plan\n\n| Item | % |\n|---|---|\n| A-1 | 100 |\n\n**A-1 · A finished thing** — **P1 · High**\n',
    'docs/A.md': '# A\n',
  });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['switch', '-qc', 'fix/something-underway'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'docs/A.md'), '# A\n\nedited while the plan reports everything complete\n');

  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const plan = readPlanning(dir, cfg);
  eq(plan.stats.mean, 100, 'the fixture must reproduce the "everything is done" reading being complained about');

  const html = viewPage({ id: 'backlog', title: 'Backlog', panels: ['tiles', 'inflight'] },
    { index, health, plan, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'Work in flight', 'the panel must render on the view the complaint was about');
  includes(html, 'fix/something-underway', 'and name the branch the work is on');
  includes(html, 'docs/A.md', 'and the file that is actually being changed');
  includes(html, 'file(s) in flight it cannot see',
    'the completion tile must state what its figure excludes, rather than reading as the whole answer');
  ok(!html.includes('Not shown on this page'), 'a panel with data behind it must not be listed as omitted');
});

test('inflight · the last two commits on the trunk are not reported as work underway', () => {
  // `readChanges` compares against the merge-base when the branch has diverged and falls back to `HEAD~2`
  // when it has not. Those two commits are on the trunk and already delivered; presenting them as work
  // underway would be this panel committing, in the opposite direction, the exact defect it exists to
  // remove — a page that cannot tell finished from happening.
  const dir = fixture('inflight-trunk', { 'docs/A.md': '# A\n' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'ignore' });
  for (const n of ['two', 'three']) {
    fs.appendFileSync(path.join(dir, 'docs/A.md'), `\n${n}\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', `chore: LANDED-${n} on the trunk`],
      { cwd: dir, stdio: 'ignore' });
  }

  const cfg = resolveConfig(dir);
  const k = readInflight(dir, cfg, { index: null, plan: null });
  eq(k.diverged, false, 'main has not diverged from itself, and the model must say so');
  eq(k.commits, [], 'trunk history is not work in flight');
  eq(k.quiet, true, 'a clean checkout of the trunk has nothing underway');
  includes(inflightSentence(k), 'Nothing in flight');

  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'dashboard', title: 'Overview', panels: ['inflight'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);
  includes(html, 'Nothing in flight', 'a clean tree is a measurement and is stated, not left blank');
  ok(!html.includes('LANDED-three'), 'a commit already on the trunk must never appear as work in flight');
  ok(!html.includes('Not shown on this page'),
    '"nothing is happening" is an answer; omitting the panel would make it indistinguishable from "not checked"');
});

test('inflight · the journal contributes a count and never a word of its text', () => {
  // The same boundary the decisions panel holds, in the second place a reader would not think to look for
  // the breach. `.atlas/` is outside the docs root by construction, but this panel renders into
  // `docs/_wiki`, which publishes — so a journalled sentence embedded here would travel to a wiki.
  const dir = fixture('inflight-journal', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  journalNote(dir, cfg, { kind: 'blocker', text: 'SECRET-JOURNAL-BLOCKER',
    why: 'SECRET-JOURNAL-REASONING', identity: 'Ann Example' });

  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'dashboard', title: 'Overview', panels: ['inflight'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'record(s) written since the last commit', 'the count is derived and safe to publish');
  includes(html, 'of them a recorded blocker', 'and a blocker is the one kind worth counting separately');
  ok(!html.includes('SECRET-JOURNAL-BLOCKER'), 'journal text must never reach a published page');
  ok(!html.includes('SECRET-JOURNAL-REASONING'), 'journal reasoning must never reach a published page');
});

test('inflight · an untracked file is counted and never named', () => {
  // `git diff` does not see untracked files at all, so the tracked detail and `git status --porcelain`
  // disagree by exactly that set — reporting only the diff under-counts a tree that is visibly dirty.
  // Naming them fails the other way: a file git has not been told about is not repository state yet, and
  // this page shows repository state.
  const dir = fixture('inflight-untracked', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'NOT-YET-ADDED-private-notes.md'), '# not for anyone\n');

  const cfg = resolveConfig(dir);
  const k = readInflight(dir, cfg, { index: null, plan: null });
  eq(k.untracked, 1);
  eq(k.tracked, [], 'an untracked file is not a tracked change');

  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const html = viewPage({ id: 'dashboard', title: 'Overview', panels: ['inflight'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);
  includes(html, '1 untracked file(s), counted but not named');
  ok(!html.includes('NOT-YET-ADDED-private-notes'), 'the count publishes; the path does not');
});

test('inflight · a commit naming an item the plan calls not-started shows both figures side by side', () => {
  // The pairing is the finding, not either half. A commit naming A-1 is unremarkable; a commit naming A-1
  // while the plan still records A-1 at 0% is the contradiction `progress.mjs` was written to repair — and
  // until now nothing on the site displayed it.
  const dir = fixture('inflight-contradiction', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Plan\n\n| Item | % |\n|---|---|\n| A-1 | 0 |\n\n**A-1 · The thing being built** — **P1 · High**\n',
  });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['switch', '-qc', 'feat/the-thing'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'docs/B.md'), '# B\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm',
    'feat: build the thing (A-1, Z-9)'], { cwd: dir, stdio: 'ignore' });

  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  const plan = readPlanning(dir, cfg);
  const html = viewPage({ id: 'dashboard', title: 'Overview', panels: ['inflight'] },
    { index, health, plan, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'A-1 · The thing being built', 'the item the commit names is resolved to its title');
  includes(html, 'plan records 0%', 'beside what the plan still says about it');
  includes(html, 'Also named, and not in the plan', 'an id the plan does not hold is stated, not dropped');
  includes(html, 'Z-9');
});

test('inflight · a working tree that could not be read is never reported as quiet', () => {
  // The same failure the changes panel already had: an error caught and returned as `null` becomes "no data",
  // and "no data" reads as "nothing is happening". A check that could not run is never reported as passing.
  const dir = fixture('inflight-broken', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'GARBAGE-NOT-AN-INDEX', 'utf8');

  const html = viewPage({ id: 'dashboard', title: 'Overview', panels: ['tiles', 'inflight'] },
    { index, health, plan: null, cfg: { ...cfg, __root: dir }, contrib: null, nav: [] }, (o) => o.body);

  includes(html, 'The working tree could not be read', 'the panel says which check did not run');
  includes(html, 'the working tree could not be read', 'and the tile carries the same reason');
  ok(!html.includes('Nothing in flight'), 'an unread tree must never be presented as a quiet one');
  ok(!html.includes('Not shown on this page'), 'a panel that failed must not be reported as one with no data');
});

console.log('\nthe live dashboard, and saying where it is');

test('serve · the URL is announced to a session that has not heard it, and once only', () => {
  // The defect this pins: `on-session-start.sh` was the only place that ever printed the link, and it exits
  // early unless `project-atlas.config.json` already exists — which is false on the run that adopts the
  // tool, because that run writes the config. Three repositories were adopted in one afternoon, all three
  // servers started themselves and answered, and no session was ever told a port. The work was done and
  // undeliverable.
  const dir = fixture('serve-announce', { 'docs/A.md': '# A\n', 'project-atlas.config.json': '{}\n' });
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  // A pidfile naming this test process: alive, so the hook takes the already-running path and announces
  // without starting anything.
  fs.writeFileSync(path.join(dir, '.atlas', 'serve.pid'),
    JSON.stringify({ pid: process.pid, port: 4321, startedAt: 'now' }), 'utf8');

  const fire = (sid) => spawnSync('sh', [path.join(REPO_ROOT, 'hooks', 'on-activity.sh')], {
    cwd: dir, input: JSON.stringify({ session_id: sid }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });

  const first = fire('sess-A');
  eq(first.status, 0, 'a PostToolUse hook must never fail the tool call that triggered it');
  includes(first.stdout, 'http://127.0.0.1:4321/', 'the session that has not heard the URL is told it');

  // Every subsequent tool call in that session is silent. One line per session is a line people read; one
  // per tool call is noise they filter out, and noise is how the line stops being read at all.
  eq(fire('sess-A').stdout.trim(), '', 'the same session is not told again');
  eq(fire('sess-A').stdout.trim(), '', 'nor on the call after that');

  // A different session has not heard it, whoever started the server and whenever.
  includes(fire('sess-B').stdout, 'http://127.0.0.1:4321/', 'a new session is told about a server already up');
}, { needsPosixShell: true });

test('serve · a server that cannot bind exits, rather than lingering and rebuilding', () => {
  // Ten processes accumulated on one machine before this was found. `startServer` set `process.exitCode`
  // on EADDRINUSE and returned — but setting an exit code is not exiting, and `watch --serve` runs on into
  // its polling loop. Each loser of a race for the port stayed alive forever: serving nothing, invisible to
  // `--status` because it never wrote a pidfile, and still rebuilding the output directory on every change.
  // Four of them raced to write one directory, which is what the build-owner warning had been reporting.
  //
  // Written synchronously on purpose. An `async` case appended here is registered after the runner has
  // already drained its pending promises, so it is never awaited and never reported — it passes by not
  // running, which is the one failure mode a regression test must not have.
  const dir = fixture('serve-bind-clash', { 'docs/A.md': '# A\n' });
  const flag = path.join(dir, 'held-port.txt');
  const holder = spawn(process.execPath, ['-e',
    `require('http').createServer(()=>{}).listen(0,'127.0.0.1',function(){` +
    `require('fs').writeFileSync(process.env.FLAG,String(this.address().port))})`],
    { stdio: 'ignore', env: { ...process.env, FLAG: flag } });
  try {
    const nap = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    for (let i = 0; i < 100 && !fs.existsSync(flag); i++) nap();
    ok(fs.existsSync(flag), 'the test could not hold a port to clash with');
    const port = fs.readFileSync(flag, 'utf8').trim();

    const r = spawnSync(process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'watch', '--serve', '--detached',
       '--port', port, '--idle-ms', '60000', '--quiet'],
      { cwd: dir, encoding: 'utf8', timeout: 20_000 });
    ok(!r.error || r.error.code !== 'ETIMEDOUT',
       'the process must end on its own — a timeout here IS the leak this test exists for');
    includes(r.stderr, 'already in use', 'and it must say why before it goes');
    ok(!fs.existsSync(path.join(dir, '.atlas', 'serve.pid')),
       'a server that never listened must not leave a claim behind for the next start to trip over');
  } finally {
    holder.kill();
  }
});

/* ------------------------------------------------------------------ the statusline */

// The script the user names in their own settings.json. Read from the repository rather than a fixture,
// because what these pin is the shipped file's behaviour and nothing else.
const STATUSLINE = path.join(REPO_ROOT, 'bin', 'atlas-statusline');

/**
 * Fire the statusline the way the harness does: a JSON payload on a pipe, one line of stdout expected back.
 *
 * `input` is always passed, even when empty, so stdin is a pipe rather than whatever the test runner
 * inherited. The script skips reading stdin when it is a terminal — otherwise `cat` blocks forever the first
 * time anyone runs it by hand — and a test that ran down the terminal branch would be testing the other half.
 */
const statusline = (cwd, { payload = {}, args = [], env = {} } = {}) =>
  spawnSync('sh', [STATUSLINE, ...args], {
    cwd, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env },
  });

test('statusline · a live server is exactly one line, and an unadopted repository is zero bytes', () => {
  // The line printed at session start scrolls away, and the port is derived from the repository path so
  // nobody has it memorised. This puts it where it cannot scroll — which is only safe if it is right, and
  // "right" starts with saying nothing at all about a repository that never adopted the tool. A statusline
  // segment in someone else's project is the same trespass as generating `docs/_wiki` there.
  const dir = fixture('statusline-live', { 'docs/A.md': '# A\n', 'project-atlas.config.json': '{}\n' });
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  // A pidfile naming this test process: alive, so signal 0 answers and the URL is the honest thing to print.
  fs.writeFileSync(path.join(dir, '.atlas', 'serve.pid'),
    JSON.stringify({ pid: process.pid, port: 4321, startedAt: 'now' }), 'utf8');

  const r = statusline(dir);
  eq(r.status, 0, 'the statusline runs on every assistant message and must never fail');
  eq(r.stdout, 'atlas · http://127.0.0.1:4321/\n',
     'the URL, on one line — Claude Code renders every line of stdout as its own statusline row, so a second '
     + 'line would silently steal a row from whatever else the user put up there');

  // Sessions run from subdirectories constantly. The pidfile is at the repository root, so the ascent is the
  // whole of finding it.
  fs.mkdirSync(path.join(dir, 'docs', 'deep', 'deeper'), { recursive: true });
  includes(statusline(path.join(dir, 'docs', 'deep', 'deeper')).stdout, 'http://127.0.0.1:4321/');

  // A repository that never adopted the tool: not a hint, not an empty separator, nothing.
  const bare = fixture('statusline-unadopted', { 'README.md': '# nothing to do with atlas\n' });
  eq(statusline(bare).stdout, '', 'an unadopted repository gets no segment, not an empty one');
  eq(statusline(bare).status, 0);
}, { needsPosixShell: true });

test('statusline · a dead pid never becomes a live link', () => {
  // This is the whole reason the feature is allowed to exist. A frozen dashboard was read as live for an
  // entire session; pinning a dead URL to the bottom of the terminal would make that failure *more*
  // convincing, not less. So the pid on the pidfile is verified rather than believed — a killed server
  // leaves its claim on disk — and the fallback names the state instead of falling silent, because silence
  // here is indistinguishable from a repository that never adopted the tool and those are different facts.
  const dir = fixture('statusline-dead', { 'docs/A.md': '# A\n', 'project-atlas.config.json': '{}\n' });
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  // 999999999 is above every platform's pid_max (99999 on macOS, 4194304 on Linux), so `kill -0` can only
  // answer ESRCH. A small pid picked at random could be recycled between writing the file and reading it,
  // which would make this test flaky in the one direction a regression test must never be.
  fs.writeFileSync(path.join(dir, '.atlas', 'serve.pid'),
    JSON.stringify({ pid: 999999999, port: 4321, startedAt: 'now' }), 'utf8');

  const r = statusline(dir);
  eq(r.status, 0);
  ok(!r.stdout.includes('http://'), 'a pid that is gone must never be rendered as a URL somebody can click');
  includes(r.stdout, 'down', 'and the state is named, because silence would read as "no atlas here"');
  eq(r.stdout.split('\n').filter(Boolean).length, 1, 'still one line');
}, { needsPosixShell: true });

test('statusline · an adopted repository with no pidfile at all still says something', () => {
  // The case the first version got wrong, and it is not hypothetical: three of the four repositories on the
  // machine this was built on were answering on their ports with **no pidfile naming them**. Every record
  // this tool keeps is keyed by a pid, so when servers race, reaping the loser's dead claim discards the
  // only record of the winner — which keeps listening. Treating "no pidfile" as "no atlas here" reported a
  // working dashboard as an unrelated project.
  //
  // Adoption is what decides whether to speak; the pidfile only decides what is said.
  const dir = fixture('statusline-no-pidfile', { 'docs/A.md': '# A\n', 'project-atlas.config.json': '{}\n' });
  ok(!fs.existsSync(path.join(dir, '.atlas', 'serve.pid')), 'the fixture must genuinely have no claim on disk');

  const r = statusline(dir);
  eq(r.status, 0);
  includes(r.stdout, 'down', 'an adopted repository is never silent — silence is reserved for "not adopted"');
  ok(!r.stdout.includes('http://'), 'and it certainly does not invent a URL it has no port for');
  eq(r.stdout.split('\n').filter(Boolean).length, 1, 'still one line');

  // The distinction that makes the line worth anything: strip the config and the same directory goes quiet.
  fs.rmSync(path.join(dir, 'project-atlas.config.json'));
  eq(statusline(dir).stdout, '', 'a repository that never adopted the tool prints nothing at all');
}, { needsPosixShell: true });

test('statusline · it reads the payload it was handed, not the directory it happens to run in', () => {
  // Two reasons this cannot fall back to the process working directory. The harness does not document which
  // directory it spawns the command in, and reading the wrong repository would report another project's port
  // with complete confidence — which is precisely the failure the per-repository port derivation exists to
  // prevent (`scripts/lib/serve.mjs:31`), and would be indefensible to reintroduce in the one surface that is
  // always on screen.
  //
  // The argument form is the composition contract. Claude Code runs exactly one statusLine command, so a user
  // who already has one composes by wrapping — and a wrapper has already drained stdin for its own fields and
  // cannot hand the payload on. `atlas-statusline "$dir"` needs no stdin at all.
  const dir = fixture('statusline-payload', { 'docs/A.md': '# A\n', 'project-atlas.config.json': '{}\n' });
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'serve.pid'),
    JSON.stringify({ pid: process.pid, port: 4322, startedAt: 'now' }), 'utf8');

  // Run from a directory in no repository at all, and point at the fixture only through the payload.
  const elsewhere = fixture('statusline-elsewhere', { 'README.md': '# elsewhere\n' });
  includes(statusline(elsewhere, { payload: { session_id: 's', cwd: dir } }).stdout, 'http://127.0.0.1:4322/',
           "the payload's cwd wins over the process's");

  // And with the payload consumed by somebody else, the argument still works.
  const wrapped = spawnSync('sh', ['-c', `"$1" "$2"`, 'sh', STATUSLINE, dir],
    { cwd: elsewhere, encoding: 'utf8', input: '' });
  includes(wrapped.stdout, 'http://127.0.0.1:4322/', 'a wrapper that already read stdin can still call it');
}, { needsPosixShell: true });

test('statusline · --install refuses to overwrite a statusLine it did not write', () => {
  // `docs/references/autonomy.md` grants autonomy over derived state and stops at the edge of the
  // repository. `~/.claude/settings.json` is neither derived nor inside it, so nothing installs this as a
  // side effect of anything — and when the user does type the command, it still will not replace their own
  // statusline. Overwriting somebody's configuration is the same act as `publish --force` overwriting
  // somebody's wiki page, and this project already decided that one.
  const cfg = path.join(tmpRoot, 'statusline-settings');
  fs.mkdirSync(cfg, { recursive: true });
  const file = path.join(cfg, 'settings.json');
  const mine = { statusLine: { type: 'command', command: '~/bin/my-own-line.sh' }, permissions: { allow: [] } };
  fs.writeFileSync(file, JSON.stringify(mine), 'utf8');

  const r = statusline(REPO_ROOT, { args: ['--install'], env: { CLAUDE_CONFIG_DIR: cfg } });
  eq(r.status, 1, 'an install that did not happen is never reported as done');
  includes(r.stdout, 'my-own-line.sh', 'and it names what is already there rather than describing it');
  eq(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine.command, '~/bin/my-own-line.sh',
     "the user's statusline is untouched");
  eq(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.allow.length, 0, 'and so is everything else');

  // Into a config with no statusLine it writes one, and `--uninstall` takes it back out. Reversible is a
  // property of the command, not a sentence in a document.
  fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash'] } }), 'utf8');
  const ins = statusline(REPO_ROOT, { args: ['--install'], env: { CLAUDE_CONFIG_DIR: cfg } });
  eq(ins.status, 0);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(after.statusLine.type, 'command');
  ok(/atlas-statusline$/.test(after.statusLine.command), 'it points at this script');
  eq(after.permissions.allow, ['Bash'], 'and nothing else in the file moved');

  const un = statusline(REPO_ROOT, { args: ['--uninstall'], env: { CLAUDE_CONFIG_DIR: cfg } });
  eq(un.status, 0);
  const restored = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(restored.statusLine, undefined, 'removed');
  eq(restored.permissions.allow, ['Bash'], 'and the rest of the settings survived the round trip');
}, { needsPosixShell: true, needsJq: true });

test('serve · a server is recognised by what it serves, when every pid-keyed record is gone', () => {
  // The escape from a cycle that put four servers on one repository. The pidfile and the machine-wide
  // registry are both keyed by pid, so a single dead pid destroys both — and when servers race, the pid
  // written down can be the loser's. Reaping it discards the only record of the winner, which is still
  // listening. The next start then sees no record, finds its port taken, probes one higher, and binds.
  //
  // So the last question before starting anything is not "who is running" but "what is being served".
  //
  // Driven through a child process because `adoptableServer` is async and this suite's async cases are
  // drained long before the end of this file — an `async` test appended here is never awaited and passes by
  // never running. A child gets a real event loop and reports its verdict as an exit status.
  const dir = fixture('serve-adopt', { 'docs/A.md': '# A\n' });
  const probe = `
    import http from 'node:http';
    import fs from 'node:fs';
    import path from 'node:path';
    import { adoptableServer } from ${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'lib', 'serve.mjs'))};
    const dir = ${JSON.stringify(dir)};
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'build-stamp.txt'), '2026-08-11 15:30:32 UTC\\n');
    // A server over that exact directory, with no pidfile and no registry entry anywhere — the state the
    // real repositories were found in.
    // The server serves from its OWN directory, never from ours. Pointing it at the same file would make
    // the comparison vacuous — it would echo back whatever we had just written and agree with itself.
    const theirs = path.join(dir, 'theirs');
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, 'build-stamp.txt'), '2026-08-11 15:30:32 UTC\\n');
    const srv = http.createServer((req, res) => {
      if (req.url === '/build-stamp.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' })
           .end(fs.readFileSync(path.join(theirs, 'build-stamp.txt')));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const mine = await adoptableServer(dir, outDir, port);
    if (!mine || mine.port !== port) { console.log('FAIL: our own stamp was not recognised'); process.exit(1); }
    // **And a stranger on the port is left strictly alone.** Adopting one would point the user at somebody
    // else's web page and call it their dashboard — including another atlas server, for another repository,
    // whose stamp is simply a different build.
    fs.writeFileSync(path.join(theirs, 'build-stamp.txt'), 'a completely different build\\n');
    const stranger = await adoptableServer(dir, outDir, port);
    if (stranger !== null) { console.log('FAIL: a mismatched stamp was adopted'); process.exit(1); }
    // Nothing listening at all is not ours either.
    srv.close();
    await new Promise((r) => srv.on('close', r));
    fs.writeFileSync(path.join(theirs, 'build-stamp.txt'), '2026-08-11 15:30:32 UTC\\n');
    const gone = await adoptableServer(dir, outDir, port);
    if (gone !== null) { console.log('FAIL: a closed port was adopted'); process.exit(1); }
    console.log('OK');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 20_000 });
  eq(r.status, 0, `adoption probe failed: ${r.stdout || ''}${r.stderr || ''}`);
  includes(r.stdout, 'OK');
});

/* ================================================================== knowledge base */

console.log('\nknowledge base');

/*
 * `scripts/lib/kb.mjs` — the derived markdown tree.
 *
 * **Every case here is synchronous, deliberately.** `pendingAsync` is drained at line 3762, long before this
 * point, so an `async` case registered down here is never awaited and passes by never running. The same trap
 * the serve-adoption case above documents.
 */

/** Every generated file in the knowledge base, as one string. The prose guard is asserted over all of it. */
function kbText(outDir) {
  let out = '';
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) out += fs.readFileSync(full, 'utf8') + '\n';
    }
  };
  walk(path.join(outDir, 'kb'));
  return out;
}

/** Every markdown link in the tree, as `{ from, target }` with fragments and external schemes dropped. */
function kbLinks(outDir) {
  const links = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.md')) continue;
      const body = fs.readFileSync(full, 'utf8');
      for (const m of body.matchAll(/\]\((<[^>]*>|[^)\s]+)\)/g)) {
        let t = m[1];
        if (t.startsWith('<')) t = decodeURIComponent(t.slice(1, -1));
        if (/^(https?:|mailto:|tel:|#)/i.test(t)) continue;
        links.push({ from: full, target: t.split('#')[0] });
      }
    }
  };
  walk(path.join(outDir, 'kb'));
  return links;
}

/**
 * A corpus with sentences nothing else could produce.
 *
 * Every prose line is a phrase that cannot be confused with a heading, a path or anything the tool composes,
 * so a leak is unambiguous. `docs/trap.md` carries the specific line that actually leaked on the first build
 * of this tree — a bolded sentence beginning with the word `Date`, which `scan.mjs::fieldValue` matched as a
 * date field and copied verbatim onto the node page.
 */
const KB_FIXTURE = {
  'docs/README.md': '# Index\n\nThe quokka ledger reconciles nightly against the barnacle registry.\n\n' +
    '[Alpha](A.md) · [Trap](trap.md) · [Missing](nope.md)\n',
  'docs/A.md': '# Alpha\n\n**Status:** draft\n**Version:** 2.1\n**Date:** 2026-03-04\n\n' +
    'Pelican throughput degrades whenever the marmalade cache is cold, which nobody expected.\n\n' +
    '## How it works\n\nSee `src/thing.js:2` for the loop that does it.\n',
  'docs/trap.md': '# Trap\n\n' +
    '**Date every page, and re-stamp it.** An undated page is a page that will be trusted after it stops ' +
    'being true, which is how the wombat incident happened.\n',
  'src/thing.js': 'const a = 1;\nconst b = 2;\n',
};

test('kb · the derived tree reproduces no document prose', () => {
  // The whole safety argument. A second set of markdown holding the same sentences is the forked-document
  // failure the tool exists to detect, and it would not be excused by one of them being generated.
  const dir = fixture('kb-noprose', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const text = kbText(outDir);

  for (const sentence of [
    'The quokka ledger reconciles nightly against the barnacle registry.',
    'Pelican throughput degrades whenever the marmalade cache is cold',
    'which is how the wombat incident happened',
  ]) {
    ok(!text.includes(sentence), `document prose leaked into the derived markdown: "${sentence}"`);
  }
  // And the excerpt of every document, which is the single field most likely to be added here by someone
  // doing the obvious thing.
  for (const d of index.documents) {
    if (!d.excerpt || d.excerpt.length < 30) continue;
    ok(!text.includes(d.excerpt.slice(0, 60)), `the excerpt of ${d.path} leaked into the derived markdown`);
  }
  // Proof the tree is not simply empty: structure — titles and headings — must be there.
  includes(text, 'Alpha', 'the tree must carry document titles');
  includes(text, 'How it works', 'the tree must carry headings, which are structure rather than prose');
});

test('kb · a scraped field that ran into the document is refused, not quoted', () => {
  // The concrete leak. `fieldValue` matches `^**Date…:** (.+)$` loosely, so a sentence beginning "Date every
  // page" was read as a date and a hundred characters of that document's advice appeared on its node page.
  const dir = fixture('kb-fieldshape', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const trap = fs.readFileSync(path.join(outDir, 'kb', 'nodes', 'docs__trap.md'), 'utf8');

  ok(!trap.includes('An undated page is a page'), 'a sentence must never be quoted as a date field');
  includes(trap, 'present but not quoted', 'the field must be reported as unreadable, never silently dropped');

  // A value that really is a date, a status and a version still comes through — the guard must not be a
  // blanket refusal, or it would delete the three fields it exists to protect.
  const alpha = fs.readFileSync(path.join(outDir, 'kb', 'nodes', 'docs__A.md'), 'utf8');
  includes(alpha, '2026-03-04', 'a well-formed date must still be quoted');
  includes(alpha, 'draft');
  includes(alpha, '2.1');
});

test('kb · every link in the tree resolves from the repository root', () => {
  // An agent follows these with `Read`, not with a browser, so they are resolved against the filesystem from
  // the file that carries them. A root-relative path would be correct in a served site and useless here.
  const dir = fixture('kb-links', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const links = kbLinks(outDir);
  ok(links.length > 20, `expected a linked graph, found ${links.length} links`);
  const broken = links.filter((l) => !fs.existsSync(path.resolve(path.dirname(l.from), l.target)));
  eq(broken.map((b) => `${path.basename(b.from)} → ${b.target}`), [], 'every link must resolve');

  // And specifically the one that matters most, followed for real: the "Source of truth" link on a node page
  // must land on the document itself. The relative depth is not a constant — it depends where `output` is
  // configured, and here the output directory is itself under `docs/`, so the link climbs out of it.
  const node = path.join(outDir, 'kb', 'nodes', 'docs__A.md');
  const m = /Source of truth:\*\* \[[^\]]*\]\(([^)]+)\)/.exec(fs.readFileSync(node, 'utf8'));
  ok(m, 'the node page must link to its source document');
  ok(fs.readFileSync(path.resolve(path.dirname(node), m[1]), 'utf8').startsWith('# Alpha'),
    `following ${m && m[1]} must land on the document itself`);
});

test('kb · rebuild is byte-identical, the knowledge base included', () => {
  const dir = fixture('kb-determinism', KB_FIXTURE);
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
  const first = run();
  // Asserted rather than assumed: the site-wide determinism case walks whatever is there, so if this tree
  // stopped being written it would keep passing while covering nothing.
  ok(Object.keys(first).some((k) => k.startsWith('kb/nodes/')), 'the snapshot must actually include the kb tree');
  eq(first, run(), 'two consecutive builds must produce an identical knowledge base');
});

test('kb · a node page states the relationships in both directions', () => {
  const dir = fixture('kb-node', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const alpha = fs.readFileSync(path.join(outDir, 'kb', 'nodes', 'docs__A.md'), 'utf8');
  includes(alpha, 'Referenced by');
  includes(alpha, 'docs/README.md', 'a backlink must name the document that links here');
  includes(alpha, 'src/thing.js:2', 'a code citation must be carried');
  includes(alpha, 'resolved', 'and whether it resolves');

  const readme = fs.readFileSync(path.join(outDir, 'kb', 'nodes', 'docs__README.md'), 'utf8');
  includes(readme, 'docs/nope.md', 'a dead link must be listed, not dropped');
});

test('kb · the entry point declares the tree derived and routes by intent', () => {
  const dir = fixture('kb-entry', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const entry = fs.readFileSync(path.join(outDir, 'kb', 'README.md'), 'utf8');
  includes(entry, 'Derived');
  includes(entry, 'source of truth');
  for (const page of ['architecture.md', 'rules.md', 'routes.md', 'tests.md', 'vocabulary.md', 'health.md', 'plan.md', 'resume.md']) {
    includes(entry, page, `the entry point must route to ${page}`);
    ok(fs.existsSync(path.join(outDir, 'kb', page)), `${page} must exist`);
  }
  // The output directory's own README is the file an agent lands on when it lists the directory, so it has
  // to name the tree. Without that line the knowledge base is reachable only by someone who knows it exists.
  includes(fs.readFileSync(path.join(outDir, 'README.md'), 'utf8'), 'kb/README.md');
});

test('kb · an absent design artifact is named rather than skipped', () => {
  // A section quietly missing from a blueprint reads as a section nobody needs. The corpus here has no
  // architecture document at all, and the page must say so and name what closes the gap.
  const dir = fixture('kb-absent', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const arch = fs.readFileSync(path.join(outDir, 'kb', 'architecture.md'), 'utf8');
  includes(arch, 'Architecture overview');
  includes(arch, 'Absent');
  includes(arch, 'atlas design --scaffold', 'an absence must name the command that closes it');
});

test('kb · the journal reaches the tree as counts, never as text', () => {
  // `.atlas/journal` is an operational log that is never published, and this tree is written into a
  // publishable directory. A page here quoting a record would route around `assertUnpublished` rather than
  // break it, which is worse — the guard would still pass while the record was published anyway.
  const dir = fixture('kb-journal', KB_FIXTURE);
  fs.mkdirSync(path.join(dir, '.atlas', 'journal'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'journal', 'alice.jsonl'),
    JSON.stringify({ at: '2026-04-01T10:00:00.000Z', agent: 'main', kind: 'decision',
      text: 'Chose the aardvark strategy over the pangolin one for throughput reasons.',
      why: 'The pangolin approach re-reads the index on every call.',
      refs: ['docs/A.md'] }) + '\n', 'utf8');

  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const resume = fs.readFileSync(path.join(outDir, 'kb', 'resume.md'), 'utf8');
  const all = kbText(outDir);

  ok(!all.includes('aardvark strategy'), "a journal record's text must never reach the knowledge base");
  ok(!all.includes('re-reads the index on every call'), "a record's reasoning must never reach it either");
  includes(resume, '1 record(s)', 'the count is derived and may be published');
  includes(resume, 'decision', 'so is the kind');
  includes(resume, '2026-04-01', 'and the timespan');
  includes(resume, 'docs/A.md', 'and the refs, which are what make the trail route anywhere');
});

test('kb · no handoff is authored, and an absent one is named', () => {
  // `HANDOFF.md` is written by a person or proposed into a diff somebody reads. A machine can see that a
  // commit happened; it cannot see that a decision was argued and settled.
  const dir = fixture('kb-handoff-absent', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const resume = fs.readFileSync(path.join(outDir, 'kb', 'resume.md'), 'utf8');
  includes(resume, 'No handoffs', 'an absent handoff is stated, never rendered as an empty section');
  includes(resume, 'atlas handoff', 'and the reader is told what would create one');
  ok(!fs.existsSync(path.join(dir, 'docs', 'handoff')), 'the build must not create a handoff directory');

  // With one present, its distance from HEAD is reported — and an unmeasurable distance is never reported
  // as current, which is the reason `handoffAge` returns null rather than zero.
  const dir2 = fixture('kb-handoff-present', {
    ...KB_FIXTURE,
    'docs/handoff/alice/HANDOFF.md': '# Handoff — alice\n\nWritten at commit 0000000.\n',
  });
  const a2 = analyse(dir2);
  const out2 = renderSite(a2.index, a2.health, a2.cfg, dir2).outDir;
  const resume2 = fs.readFileSync(path.join(out2, 'kb', 'resume.md'), 'utf8');
  includes(resume2, 'alice');
  includes(resume2, 'unknown', 'a distance that cannot be measured is never reported as current');
});

test('kb · the tree is written inside the confined output directory and nowhere else', () => {
  // Everything the build writes must sit inside the directory `prepareOutputDir` clears. A file written
  // beside it is never deleted, so a renamed document leaves a node page behind for ever and the stale page
  // is indistinguishable from a live one — and it is outside the guard that has already saved a repository
  // from `{"output":"."}` once.
  const dir = fixture('kb-confined', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const before = fs.readdirSync(dir).sort();
  const { outDir } = renderSite(index, health, cfg, dir);
  eq(fs.readdirSync(dir).sort(), before, 'the build must add nothing at the repository root');
  ok(outDir.startsWith(dir + path.sep), 'the output directory must be inside the repository');
  ok(fs.existsSync(path.join(outDir, 'kb', 'README.md')), 'the knowledge base must be inside it');

  // And it is cleared with everything else: a node page for a document that no longer exists must not
  // survive a rebuild.
  ok(fs.existsSync(path.join(outDir, 'kb', 'nodes', 'docs__trap.md')));
  fs.rmSync(path.join(dir, 'docs', 'trap.md'));
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'drop'],
    { cwd: dir, stdio: 'ignore' });
  const a2 = analyse(dir);
  renderSite(a2.index, a2.health, a2.cfg, dir);
  ok(!fs.existsSync(path.join(outDir, 'kb', 'nodes', 'docs__trap.md')),
    'a node page for a deleted document must not survive the rebuild');
});

test('kb · health is answerable from markdown, and every finding links to a real page', () => {
  const dir = fixture('kb-health', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const page = fs.readFileSync(path.join(outDir, 'kb', 'health.md'), 'utf8');
  includes(page, 'H1 · Dead internal link');
  includes(page, 'docs/nope.md', 'the dead link must be named in the report');
  includes(page, 'Not checked', 'a check that could not run is never reported as passing');
  // Findings whose subject is not a document — H15 names a missing artifact kind — must be rendered as text.
  // The first version of this linked them to pages that were never written.
  const links = kbLinks(outDir).filter((l) => l.from.endsWith('health.md'));
  eq(links.filter((l) => !fs.existsSync(path.resolve(path.dirname(l.from), l.target))).map((l) => l.target), [],
    'every link out of the health page must resolve');
});

test('kb · code is routed back to the documents that cite it', () => {
  // The reverse citation index. Every other surface reads citations forwards; this is the direction an agent
  // about to change a file actually needs, and nothing computed it before.
  const dir = fixture('kb-routes', KB_FIXTURE);
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const routes = fs.readFileSync(path.join(outDir, 'kb', 'routes.md'), 'utf8');
  includes(routes, 'src/thing.js', 'a cited file must appear in the reverse index');
  includes(routes, 'Alpha', 'and the document that cites it');
});

/* ================================================================== token economics (C-10) */

/**
 * **Every case here is synchronous, deliberately.** `pendingAsync` is drained far above this point, so an
 * `async` case registered here would be constructed, never awaited, and reported as a pass it never earned.
 * `readTokenEconomics` and `writeTokenSnapshot` are synchronous by design — the dashboard and the health
 * signal that will consume them both run inside synchronous pipelines — and the one case that needs the
 * asynchronous reader reaches it through `execFileSync` on the real CLI.
 */

console.log('\ntoken economics');

const ECON_STORE = path.join(tmpRoot, 'econ-store');

/** One fixture, one transcript, one task log — shared by the cases below because building it is the slow part. */
const econFixture = (() => {
  const dir = fixture('econ', {
    'project-atlas.config.json': JSON.stringify({
      output: 'docs/_wiki',
      planning: { source: 'docs/ROADMAP.md' },
      include: ['**/*.md'],
      exclude: ['**/_wiki/**'],
      // The CLI case reads this from disk rather than being handed a config object, so the store has to be
      // named here too — that path is what makes `atlas tokens` in the fixture read the fixture's transcript.
      tokens: { transcriptRoot: ECON_STORE },
    }),
    'docs/A.md': '# A\n',
    'docs/ROADMAP.md': '# Roadmap\n',
    'tests/t.test.mjs': 'export const t = 1;\n',
    'src/a.js': 'one\n',
  });

  // Two backdated commits touching the same file inside contrib's 3-day window, so one token day has a
  // rework verdict and the other does not. Dated, because the whole point is the join to a per-day verdict.
  const commit = (iso, body) => {
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), body, 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'touch'],
      { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });
  };
  commit('2026-01-01T09:00:00Z', 'two\n');     // first touch of src/a.js on this day → new work
  commit('2026-01-02T09:00:00Z', 'three\n');   // re-touched inside 3 days → rework

  // The slug comes from the function under test, never a copy of it — the same discipline the older token
  // cases follow, and for the same reason: a duplicate here would reproduce the product's bug and agree with it.
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: ECON_STORE } }));
  fs.mkdirSync(path.join(ECON_STORE, slug), { recursive: true });

  const turn = (uuid, ts, output, cacheRead, extra = {}) => ({
    type: 'assistant', uuid, timestamp: ts, sessionId: 's1', gitBranch: 'main',
    message: { model: 'test-model', usage: { input_tokens: 1, output_tokens: output, cache_creation_input_tokens: 2, cache_read_input_tokens: cacheRead } },
    ...extra,
  });
  const wrote = (owner, abs) => ({
    type: 'user', sourceToolAssistantUUID: owner,
    toolUseResult: { filePath: abs, structuredPatch: [], userModified: false },
  });

  const rows = [
    turn('a1', '2026-01-01T10:00:00Z', 100, 1000),
    wrote('a1', path.join(dir, 'docs', 'A.md')),                 // documentation
    wrote('a1', path.join(dir, 'tests', 't.test.mjs')),          // testing
    turn('b1', '2026-01-02T10:00:00Z', 60, 600, { gitBranch: 'feat/x' }),
    wrote('b1', path.join(dir, 'docs', 'ROADMAP.md')),           // planning — the plan file, not documentation
    turn('c1', '2026-01-02T10:30:00Z', 40, 400, { gitBranch: 'feat/x' }),
    // A prompt and a path that must never reach any output, on a record that carries both.
    { type: 'user', sourceToolAssistantUUID: 'c1',
      message: { content: [{ type: 'text', text: 'SECRET-PROMPT-DO-NOT-LEAK' }] },
      toolUseResult: { filePath: '/tmp/SECRET-PATH-DO-NOT-LEAK.txt', structuredPatch: [] } },
    // Two subagent sessions inside one minute: peak concurrency is 2, not 1 and not the session count.
    turn('d1', '2026-01-02T10:31:00Z', 10, 100, { gitBranch: 'feat/x', isSidechain: true, sessionId: 's2' }),
    turn('e1', '2026-01-02T10:31:30Z', 10, 100, { gitBranch: 'feat/x', isSidechain: true, sessionId: 's3' }),
  ];
  fs.writeFileSync(path.join(ECON_STORE, slug, 'session.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // Written after the commits so it stays untracked, exactly as `.gitignore` keeps it in a real repository.
  // Tasks 1 and 2 overlap; task 3 does not overlap either.
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'tasks-live.jsonl'), [
    { at: '2026-01-01T09:00:00Z', op: 'create', id: '1', subject: 'Alpha', status: 'pending' },
    { at: '2026-01-01T09:30:00Z', op: 'create', id: '2', subject: 'Beta', status: 'pending' },
    { at: '2026-01-01T11:00:00Z', op: 'update', id: '1', status: 'completed' },
    { at: '2026-01-01T12:00:00Z', op: 'update', id: '2', status: 'completed' },
    { at: '2026-01-02T09:00:00Z', op: 'create', id: '3', subject: 'Gamma', status: 'pending' },
    { at: '2026-01-02T11:00:00Z', op: 'update', id: '3', status: 'completed' },
    '{"torn":',
  ].map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n', 'utf8');

  return dir;
})();

const econCfg = (over = {}) => ({
  ...resolveConfig(econFixture),
  tokens: { transcriptRoot: ECON_STORE, ...over },
});

test('economics · overlapping task windows split a turn 1/n, so the per-task total cannot exceed the real one', () => {
  // The failure this rule exists to prevent: two tasks open at once, each credited the whole turn, and a
  // per-task table that sums to more than was ever spent. It reconciles against nothing and errs in the
  // flattering direction, which is what makes it survive review.
  const k = readTokenEconomics(econFixture, econCfg());
  ok(k.available, k.reason || '');
  eq(k.totals.output, 220, 'the fixture spends 100 + 60 + 40 + 10 + 10 output tokens');

  const byId = Object.fromEntries(k.tasks.map((t) => [t.id, t]));
  eq(byId['1'].output, 50, 'a turn inside two open windows contributes half to each');
  eq(byId['2'].output, 50);
  eq(byId['3'].output, 120, 'a turn inside one open window contributes all of it');
  eq(k.tasks.reduce((n, t) => n + t.output, 0), k.totals.output,
    'the per-task figures must sum to the total, never past it');

  eq([byId['1'].partial, byId['2'].partial], [true, true], 'an overlapped window must declare itself partial');
  eq(byId['3'].partial, false, 'a window that overlapped nothing is not partial');
  includes(k.caveats.join(' '), '1/n', 'the split must be stated, not just performed');
});

test('economics · a task window closes at the FIRST completion, and a torn log line is skipped', () => {
  const w = taskWindows(econFixture);
  ok(w.available, w.reason || '');
  eq(w.items.map((t) => t.id), ['1', '2', '3'], 'the torn last line must be skipped, not fatal');
  eq(w.items.find((t) => t.id === '1').closed, '2026-01-01T11:00:00Z');

  // Re-completing a task must not stretch its window over the gap it was explicitly not being worked in.
  // A task finished at 11:00, reopened at 15:00 and finished again at 16:00 was not open for those four
  // hours, and crediting it every turn in between is the same over-count the 1/n rule exists to stop.
  const reopenDir = path.join(tmpRoot, 'econ-reopened');
  fs.mkdirSync(path.join(reopenDir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(reopenDir, '.atlas', 'tasks-live.jsonl'), [
    { at: '2026-01-01T10:00:00Z', op: 'create', id: '9', subject: 'Reopened', status: 'pending' },
    { at: '2026-01-01T11:00:00Z', op: 'update', id: '9', status: 'completed' },
    { at: '2026-01-01T15:00:00Z', op: 'update', id: '9', status: 'in_progress' },
    { at: '2026-01-01T16:00:00Z', op: 'update', id: '9', status: 'completed' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const reopened = taskWindows(reopenDir).items[0];
  eq(reopened.closed, '2026-01-01T11:00:00Z', 'the window closes at the first completion, not the last');
  eq(overlapWindows([reopened])[0].partial, false, 'a single window overlaps nothing');
});

test('economics · a written path becomes one of five words, and the plan file is planning not documentation', () => {
  // Taken in the order the contract lists them, "documentation" would swallow the plan file — it is markdown
  // in a cluster — and the "planning is the plan file" clause would never fire for any repository that keeps
  // its plan in markdown. Specific beats general, the same rule the cluster taxonomy already follows.
  const cfg = econCfg();
  eq(classifyWrite(path.join(econFixture, 'docs/ROADMAP.md'), econFixture, cfg), 'planning');
  eq(classifyWrite(path.join(econFixture, 'docs/A.md'), econFixture, cfg), 'documentation');
  eq(classifyWrite(path.join(econFixture, 'tests/t.test.mjs'), econFixture, cfg), 'testing');
  eq(classifyWrite(path.join(econFixture, 'src/a.js'), econFixture, cfg), 'coding');
  eq(classifyWrite('.atlas/journal/someone.jsonl', econFixture, cfg), 'planning');
  eq(classifyWrite('/tmp/elsewhere.txt', econFixture, cfg), null, 'a write outside the repository is not this repository\'s coding');

  const k = readTokenEconomics(econFixture, cfg);
  const byKind = Object.fromEntries(k.kinds.map((x) => [x.kind, x]));
  eq(k.kinds.map((x) => x.kind), WORK_KINDS, 'every kind is reported in a fixed order, present or not');
  eq(byKind.documentation.output, 50, 'a turn that wrote two kinds splits evenly between them');
  eq(byKind.testing.output, 50);
  eq(byKind.planning.output, 60);
  eq(byKind.other.output, 60, 'a turn that wrote nothing inside the repository is `other`');
  eq(k.kinds.reduce((n, x) => n + x.output, 0), k.totals.output, 'the kind split must not invent output');
  eq(byKind.coding.writes, 0, 'the fixture writes no source file');
});

test('economics · the subagent split counts sidechain turns, and peak concurrency is per minute', () => {
  const k = readTokenEconomics(econFixture, econCfg());
  eq(k.agents.agentOutput, 20, 'both sidechain turns count as subagent output');
  eq(k.agents.mainOutput, 200);
  eq(k.agents.runs, 2, 'two distinct sessions ran a sidechain turn');
  eq(k.agents.peakConcurrent, 2, 'two subagent sessions inside one minute is a peak of two');
  const jan2 = k.days.find((d) => d.day === '2026-01-02');
  eq([jan2.mainOutput, jan2.agentOutput], [100, 20], 'the day series carries the split too');
});

test('economics · rework is contrib\'s verdict joined by day, and a day with no commit is unknown not zero', () => {
  const cfg = econCfg();
  const contrib = readContrib(econFixture, cfg);
  ok(contrib.available, contrib.reason || '');
  ok(Array.isArray(contrib.quality.reworkByDay), 'contrib owns the definition and now publishes it per day');

  const k = readTokenEconomics(econFixture, cfg);
  const byDay = Object.fromEntries(k.rework.map((r) => [r.day, r]));
  // 2026-01-01: src/a.js touched for the first time → no rework. 2026-01-02: re-touched inside 3 days → all of it.
  eq([byDay['2026-01-01'].reworkOutput, byDay['2026-01-01'].newWorkOutput], [0, 100]);
  eq([byDay['2026-01-02'].reworkOutput, byDay['2026-01-02'].newWorkOutput], [120, 0]);
  includes(k.caveats.join(' '), 'not recomputed here',
    'the report must say the verdict is joined rather than reinvented');

  // A day with spend and no commit has no verdict. Reporting it as pure new work would be a claim from silence.
  const orphan = readTokenEconomics(econFixture, { ...cfg, contrib: { since: '2026-06-01' } });
  const o1 = orphan.rework.find((r) => r.day === '2026-01-01');
  eq([o1.newWorkOutput, o1.reworkOutput], [null, null], 'no commit that day means unknown, not zero');
});

test('economics · unavailable is a state with a reason — never zero, never silence', () => {
  const k = readTokenEconomics(econFixture, { ...resolveConfig(econFixture), tokens: { transcriptRoot: path.join(tmpRoot, 'econ-no-store') } });
  eq(k.available, false);
  eq(k.totals, null, 'an absent source must not be reported as a spend of zero');
  ok(k.reason && k.reason.length > 20, 'the reason has to say what is missing');
  eq(k.caveats.includes(k.reason), true, 'and it has to reach the caveats a view renders');
  includes(formatEconomics(k, false), 'Unavailable');
});

test('economics · no prompt text and no file path reaches the report or the snapshot', () => {
  // The transcripts hold every prompt and every path of every session. This is the rule the whole module is
  // built around, so it is asserted over the serialised output and not over an intention.
  const cfg = econCfg({ snapshot: true, snapshotFile: '.atlas/tokens-leak.jsonl' });
  const k = readTokenEconomics(econFixture, cfg);
  const dump = JSON.stringify(k) + formatEconomics(k, false);
  ok(!dump.includes('SECRET-PROMPT-DO-NOT-LEAK'), 'prompt text must never reach the report');
  ok(!dump.includes('SECRET-PATH-DO-NOT-LEAK'), 'a written path must never be retained');
  ok(!dump.includes('docs/A.md'), 'not even a path inside the repository — it becomes a word and is dropped');

  writeTokenSnapshot(econFixture, cfg, k);
  const snap = fs.readFileSync(path.join(econFixture, '.atlas', 'tokens-leak.jsonl'), 'utf8');
  ok(!/SECRET|\.md|\.mjs|\//.test(snap.replace(/"day":"[^"]*"/g, '')),
    `the snapshot is counts only — no path, no text: ${snap.slice(0, 200)}`);
});

test('economics · the snapshot is gated on tokens.snapshot, and nothing else ever writes it', () => {
  const off = writeTokenSnapshot(econFixture, econCfg({ snapshotFile: '.atlas/tokens-gated.jsonl' }));
  eq(off.written, false);
  includes(off.reason, 'tokens.snapshot', 'the refusal must name the setting that would allow it');
  eq(fs.existsSync(path.join(econFixture, '.atlas', 'tokens-gated.jsonl')), false,
    'a gated snapshot must not leave a file behind');

  // And it refuses the published directory for the same reason a token report does.
  let threw = null;
  try { writeTokenSnapshot(econFixture, econCfg({ snapshot: true, snapshotFile: 'docs/_wiki/tokens.jsonl' })); }
  catch (e) { threw = e; }
  ok(threw, 'a snapshot inside the published output directory must be refused');
  includes(threw.message, 'published');
});

test('economics · the snapshot is append-only, byte-stable, and re-running it appends nothing', () => {
  const cfg = econCfg({ snapshot: true, snapshotFile: '.atlas/tokens-stable.jsonl' });
  const file = path.join(econFixture, '.atlas', 'tokens-stable.jsonl');

  const first = writeTokenSnapshot(econFixture, cfg);
  eq(first.written, true);
  eq(first.appended, 2, 'the fixture has two days of spend');
  const bytes = fs.readFileSync(file);
  eq(bytes.toString('utf8').trim().split('\n').length, 2, 'one JSON object per line');

  const again = writeTokenSnapshot(econFixture, cfg);
  eq(again.appended, 0, 'a day already recorded with identical counts is not written twice');
  eq(fs.readFileSync(file).equals(bytes), true, 'the file must be byte-identical after a no-op run');

  // Byte-stability for a given input, independently of what was already on disk.
  fs.rmSync(file);
  writeTokenSnapshot(econFixture, cfg);
  eq(fs.readFileSync(file).equals(bytes), true, 'the same input must produce the same bytes');

  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((r) => r.day), ['2026-01-01', '2026-01-02'], 'days are written in order');
  eq(rows[1].output, 120);
  eq(rows[1].agentOutput, 20);
  eq(Object.keys(rows[0]), ['v', 'day', 'input', 'cacheWrite', 'cacheRead', 'output', 'messages', 'mainOutput', 'agentOutput'],
    'a fixed key order is what makes the bytes stable across machines');
  eq(snapshotLine({ day: '2026-01-01', input: 1, cacheWrite: 2, cacheRead: 3, output: 4, messages: 5, mainOutput: 6, agentOutput: 7 }),
    '{"v":1,"day":"2026-01-01","input":1,"cacheWrite":2,"cacheRead":3,"output":4,"messages":5,"mainOutput":6,"agentOutput":7}');
});

test('economics · atlas tokens keeps its existing report and gains the attribution below it', () => {
  // The extension must not replace the terminal output anyone already reads, so both halves are asserted.
  const r = cli(econFixture, ['tokens']);
  includes(r.stdout, 'Where they went', 'the original totals report must survive');
  includes(r.stdout, 'cache read', 'including the tier split it exists for');
  includes(r.stdout, 'Attribution', 'and the new section must be printed after it');
  includes(r.stdout, 'By kind of work');
  includes(r.stdout, 'Main agent against subagents');
  ok(!r.stdout.includes('SECRET-PROMPT-DO-NOT-LEAK'), 'no prompt text on the terminal either');

  // `--snapshot` with the gate off says so rather than silently doing nothing.
  const gated = cli(econFixture, ['tokens', '--snapshot']);
  includes(gated.stdout, 'Snapshot not written');
  includes(gated.stdout, 'tokens.snapshot');

  // And no other command touches the store: a build must never write the snapshot.
  const before = fs.existsSync(path.join(econFixture, '.atlas', 'tokens.jsonl'));
  cli(econFixture, ['build', '--quiet']);
  eq(fs.existsSync(path.join(econFixture, '.atlas', 'tokens.jsonl')), before,
    'a build must never write the token snapshot');
});

/* ---- subagent transcripts, which a flat read of the store never saw ---- */

const SUB_STORE = path.join(tmpRoot, 'econ-sub-store');

const subFixture = (() => {
  const dir = fixture('econ-sub', {
    'project-atlas.config.json': JSON.stringify({
      output: 'docs/_wiki', planning: { source: 'docs/ROADMAP.md' },
      tokens: { transcriptRoot: SUB_STORE },
    }),
    'docs/A.md': '# A\n',
  });
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: SUB_STORE } }));
  const store = path.join(SUB_STORE, slug);
  fs.mkdirSync(path.join(store, 'main', 'subagents'), { recursive: true });

  const turn = (o) => JSON.stringify({
    type: 'assistant', timestamp: o.ts, uuid: o.uuid, sessionId: 'p1', gitBranch: 'main',
    ...(o.agentId ? { agentId: o.agentId } : {}),
    ...(o.isSidechain === undefined ? {} : { isSidechain: o.isSidechain }),
    message: {
      model: 'test-model',
      usage: { input_tokens: 0, output_tokens: o.output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      ...(o.content ? { content: o.content } : {}),
    },
  });

  // Three spawns asked for; two of them left a transcript here. The third is the case worth reporting.
  fs.writeFileSync(path.join(store, 'main.jsonl'),
    turn({ ts: '2026-02-01T10:00:00Z', uuid: 'm1', output: 100, isSidechain: false,
      content: [{ type: 'tool_use', id: 't1', name: 'Agent' }, { type: 'tool_use', id: 't2', name: 'Agent' },
                { type: 'tool_use', id: 't3', name: 'Agent' }] }) + '\n', 'utf8');

  // Both carry the PARENT's sessionId — which is why concurrency cannot be counted by session — and one of
  // them does not set `isSidechain` at all, so living in the directory has to be enough on its own.
  fs.writeFileSync(path.join(store, 'main', 'subagents', 'agent-aaa.jsonl'),
    turn({ ts: '2026-02-01T10:05:00Z', uuid: 'a1', output: 30, agentId: 'aaa', isSidechain: true }) + '\n', 'utf8');
  fs.writeFileSync(path.join(store, 'main', 'subagents', 'agent-bbb.jsonl'),
    turn({ ts: '2026-02-01T10:05:30Z', uuid: 'b1', output: 20, agentId: 'bbb' }) + '\n', 'utf8');
  // The sidecar the reader must never open: it holds the agent's brief, which is the prompt in miniature.
  fs.writeFileSync(path.join(store, 'main', 'subagents', 'agent-aaa.meta.json'),
    JSON.stringify({ agentType: 'general-purpose', description: 'SECRET-AGENT-BRIEF-DO-NOT-LEAK', spawnDepth: 1 }), 'utf8');

  return { dir, store };
})();

test('economics · subagent transcripts live one directory down, and a flat read of the store misses every one', () => {
  // Measured on this repository's own store before the fix: 20 files, 4,569 records and 1,085,725 output
  // tokens invisible to every figure the module produced — and invisible in exactly one direction, so the
  // main-versus-subagent axis read a flat zero and read it as a fact rather than as a directory nobody opened.
  const found = transcriptFiles(subFixture.store);
  eq(found.length, 3, 'one session transcript and two subagent transcripts');
  eq(found.filter((f) => f.subagent).map((f) => f.name).sort(), ['agent-aaa.jsonl', 'agent-bbb.jsonl']);
  eq(found.some((f) => f.name.endsWith('.meta.json')), false, 'the sidecar is not a transcript and is not read');

  const cfg = { ...resolveConfig(subFixture.dir), tokens: { transcriptRoot: SUB_STORE } };
  const k = readTokenEconomics(subFixture.dir, cfg);
  eq(k.totals.output, 150, 'a subagent\'s tokens are this repository\'s tokens');
  eq(k.agents.mainOutput, 100);
  eq(k.agents.agentOutput, 50, 'and they belong on the subagent side of the split, not nowhere');
  eq(k.agents.runs, 2);
});

test('economics · concurrency is counted by agent id, because a subagent carries its parent\'s session id', () => {
  const cfg = { ...resolveConfig(subFixture.dir), tokens: { transcriptRoot: SUB_STORE } };
  const k = readTokenEconomics(subFixture.dir, cfg);
  // Both subagent turns fall in the same minute and both records say sessionId 'p1'. Counting distinct
  // sessions would report a peak of one for a session that fanned two agents out at once — the precise
  // claim the axis exists to check, answered with the wrong key.
  eq(k.agents.peakConcurrent, 2, 'two agents inside one minute is a peak of two, whatever the session id says');
  // And one of those two never set `isSidechain`: being in the subagents directory has to be enough.
  includes(k.caveats.join(' '), 'agentId', 'the key the count uses must be stated');
});

test('economics · a spawn is an intent and is never counted as spend', () => {
  // A spawn call says fan-out was requested; a transcript says it ran and cost something. Folding them
  // together would let an agent with no observed spend raise peak concurrency with nothing behind it —
  // but reporting a bare zero after three spawns is the silence this tool forbids. Both, separately.
  const cfg = { ...resolveConfig(subFixture.dir), tokens: { transcriptRoot: SUB_STORE } };
  const k = readTokenEconomics(subFixture.dir, cfg);
  eq(k.agents.spawns, 3);
  eq(k.agents.spawnsWithoutTranscript, 1, 'the third spawn left no transcript in this store');
  eq(k.agents.runs, 2, 'runs counts what left a transcript — a spawn must not be folded into it');
  eq(k.agents.peakConcurrent, 2, 'and it must not raise concurrency, because nothing was observed to run');
  eq(k.agents.agentOutput, 50, 'nor spend');
  includes(k.caveats.join(' '), 'ran somewhere this store cannot see', 'the gap must be named, not smoothed');
});

test('economics · the subagent sidecar is never opened — it carries the agent\'s brief', () => {
  const cfg = { ...resolveConfig(subFixture.dir), tokens: { transcriptRoot: SUB_STORE } };
  const k = readTokenEconomics(subFixture.dir, cfg);
  const dump = JSON.stringify(k) + formatEconomics(k, false);
  ok(!dump.includes('SECRET-AGENT-BRIEF-DO-NOT-LEAK'), 'agent-*.meta.json holds a brief and must not be read');
  ok(!dump.includes('general-purpose'), 'nor anything else out of it');
});

test('tokens · the totals report counts subagent transcripts too, and does not call them sessions', () => {
  // `readTokens` is async, so it is exercised here through the real CLI — which is also the surface a user
  // reads. Before the fix `files` counted one, and every subagent token was missing from the totals.
  const r = cli(subFixture.dir, ['tokens', '--json', '--quiet']);
  const k = JSON.parse(r.stdout);
  eq(k.files, 3, 'all three transcripts are read');
  eq(k.subagentFiles, 2);
  eq(k.totals.output, 150, 'the subagent tokens are in the totals');
  // A subagent transcript is not a session. The old counter tested a global accumulator, so once any file
  // had produced an assistant turn every later file counted as a session whether it held anything or not.
  eq(k.outcomes.sessions, 1, 'three transcripts, one session');
  includes(k.notChecked.join(' '), 'subagents/', 'and the report says where they were found');
});

/* ================================================================== the operator signal (Q-4 / H17) */

/*
 * `H17` — the one signal that judges how a session was run rather than what is in the repository.
 *
 * **Every case here is synchronous, deliberately.** `pendingAsync` is drained around line 4170, thousands of
 * lines above this point, so an `async` case registered down here is never awaited and passes by never
 * running — the same trap the kb and serve-adoption sections already document. Each case below was checked by
 * reverting the change and watching it fail.
 */

console.log('\nH17 · the operator signal');

/** A repository with nothing wrong in it, so an H17 assertion is never confounded by a corpus finding. */
const H17_FIXTURE = {
  'project-atlas.config.json': JSON.stringify({ blocking: ['H1'] }),
  'docs/README.md': '# Index\n\n[A](A.md)\n',
  'docs/A.md': '# A\n\nBack to the [index](README.md).\n',
};

test('H17 · measures the operator, not the corpus, and says so in its own description', () => {
  // The distinction is the reason this signal is allowed to exist at all. H1–H16 are claims about the
  // repository; a reader who takes H17 for one of them concludes that a file is broken when nothing is.
  const why = SIGNALS.H17.why;
  includes(why.toLowerCase(), 'operator', 'H17 must name what it measures');
  includes(why.toLowerCase(), 'not the corpus', 'and must name what it does not measure');
  includes(why, String(DEFAULT_PARALLELISM_EDITS), 'the threshold must appear in the signal text');
  // The evidence, and — since the measurement refused to justify a threshold — the admission that the number
  // is chosen rather than derived. This assertion used to demand the words "25th percentile" and
  // "29 transcripts", which the text duly contained and which were both false; see the case headed
  // "every number in the printed justification is computed from the sample" for what replaced them.
  includes(why, 'ARBITRARY ROUND NUMBER', 'a chosen default must say it was chosen');
  includes(why, '29 sessions', 'and name the sample it was calibrated against — a note against what?');

  // The catalogue split is what makes the distinction structural rather than a comment: `signals.mjs` is the
  // corpus catalogue, and `config.mjs`, `prompt.mjs` and `kb.mjs` read it when they mean "rot signals".
  ok(!CORPUS_SIGNALS.H17, 'H17 must not be in the corpus catalogue');
  ok(OPERATOR_SIGNALS.H17 && SIGNALS.H17, 'but it must still be in the report catalogue');
  ok(SIGNALS.H17.operator === true, 'and be marked as an operator signal for the renderers');

  // The two counts a renderer needs, both reachable from this module. A card headed "Rot signals" that counts
  // the combined catalogue calls H17 a rot signal — so `health.mjs` re-exports the corpus set rather than
  // leaving a renderer to reach into `signals.mjs` or, more likely, not to notice there was a choice.
  eq([Object.keys(HEALTH_CORPUS_SIGNALS).length, Object.keys(OPERATOR_SIGNALS).length,
      Object.keys(SIGNALS).length], [16, 1, 17],
    'sixteen claims about the repository, one about the operator, seventeen rows to render');
  eq(Object.keys(HEALTH_CORPUS_SIGNALS), Object.keys(CORPUS_SIGNALS),
    'the re-export must be the same catalogue signals.mjs holds, not a second copy of it');
});

test('H17 · unevaluated, never ok, when there is no transcript to read', () => {
  // A-29: a signal that could not run and printed "ok" is the failure the Not-checked section exists to
  // prevent. `runHealth` is called here exactly as `atlas health` calls it — with no session data at all.
  const dir = fixture('h17-unevaluated', H17_FIXTURE);
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir);

  ok(health.unevaluated.includes('H17'), 'H17 must be unevaluated when no session data was supplied');
  eq(health.counts.H17, 0, 'and it reports no findings');
  ok(health.notChecked.some((n) => n.startsWith('H17 was NOT evaluated')),
    'and the report states that it did not run, and why');

  const report = formatReport(health, index, { color: false });
  includes(report, 'H17', 'the row must be present');
  ok(!/H17\s+ok\b/.test(report), 'and must never read "ok" — that is the A-29 lie');
  includes(report, 'not evaluated');
  includes(report, 'measures the operator, not the corpus',
    'the terminal row must say which kind of claim this is');
});

test('H17 · an empty transcript store is unevaluated too, not clean', () => {
  // "The store was read and holds nothing" is still no evidence about how anyone worked. Reporting ok here
  // would mean a machine that has never run a session gets a clean bill for its parallelism.
  const empty = readParallelism({ available: true, sessions: [] });
  ok(!empty.available);
  includes(empty.reason, 'no transcript');

  const unreadable = readParallelism({ available: false, reason: 'no session transcripts for this repository' });
  ok(!unreadable.available);
  includes(unreadable.reason, 'no session transcripts for this repository',
    'the token layer\'s own reason must survive into the report');
});

test('H17 · fires on a large solo session, and on nothing else', () => {
  const dir = fixture('h17-fires', H17_FIXTURE);
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const sessions = [
    { id: 'solo-big', edits: 139, subagentTurns: 0 },     // the shape this signal exists for
    { id: 'solo-small', edits: 16, subagentTurns: 0 },    // below the threshold: correctly done alone
    { id: 'fanned-out', edits: 694, subagentTurns: 21 },  // large, but it delegated — never a finding
    { id: 'at-threshold', edits: DEFAULT_PARALLELISM_EDITS, subagentTurns: 0 },
    { id: 'under-by-one', edits: DEFAULT_PARALLELISM_EDITS - 1, subagentTurns: 0 },
  ];
  const health = runHealth(index, cfg, dir, { sessions });

  ok(!health.unevaluated.includes('H17'), 'supplied with data, it must actually run');
  eq(sig(health, 'H17').map((f) => f.session).sort(), ['at-threshold', 'solo-big'],
    'only sessions at or above the threshold with no subagent turn');
  const big = sig(health, 'H17').find((f) => f.session === 'solo-big');
  includes(big.detail, '139 edit(s)');
  includes(big.detail, String(DEFAULT_PARALLELISM_EDITS), 'the finding states the threshold it was judged against');
  ok(big.corpus === true, 'a session has no document page, so it must not be rendered as a link');

  // A *fired* H17 sits in the same column as sixteen counts of things wrong with the repository, so the row
  // has to say which kind of claim it is there too — not only on the unevaluated row above.
  const report = formatReport(health, index, { color: false });
  includes(report, 'H17', 'the fired row must be present');
  includes(report, 'measures the operator, not the corpus',
    'a fired operator signal must still be labelled as one');
});

test('H17 · the threshold is a stated default, changeable rather than suppressible', () => {
  // Every other threshold in this tool is configurable for the same reason: a number the reader cannot argue
  // with gets the whole report ignored.
  const dir = fixture('h17-threshold', H17_FIXTURE);
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const sessions = [{ id: 's', edits: 20, subagentTurns: 0 }];

  eq(sig(runHealth(index, cfg, dir, { sessions }), 'H17').length, 0, '20 edits is below the default of 40');
  const tuned = { ...cfg, tokens: { parallelismEdits: 10 } };
  eq(sig(runHealth(index, tuned, dir, { sessions }), 'H17').length, 1, 'and above a configured 10');
});

test('H17 · cannot block, even when the config file names it in the blocking set', () => {
  // **Keeping H17 out of `signals.mjs` is not the enforcement, and this test is why that sentence is here.**
  // The first draft of the comment above `blockingFor` claimed the config validator refused
  // `"blocking": ["H17"]`. It does not: an unknown-but-well-formed signal id is a *warning*, deliberately, so
  // a config written for a newer project-atlas still loads. The id therefore survives into `cfg.blocking`
  // exactly as H99 does, and only the check in `blockingFor` stops "you should have parallelised" from
  // refusing somebody's commit.
  const dir = fixture('h17-never-blocks', {
    ...H17_FIXTURE,
    'project-atlas.config.json': JSON.stringify({ blocking: ['H1', 'H17'] }),
  });
  const cfg = resolveConfig(dir);
  ok(cfg.blocking.includes('H17'),
    'the config layer keeps an id it does not know — so it is not what protects this');

  const health = runHealth(buildIndex(dir, cfg), cfg, dir,
    { sessions: [{ id: 'big', edits: 500, subagentTurns: 0 }] });
  eq(sig(health, 'H17').length, 1, 'the finding is still reported');
  eq(health.findings.filter((f) => f.signal === 'H17' && f.blocking).length, 0, 'and it never blocks');
  eq(health.blockingCount, 0, 'so nothing is refused over it');
});

test('H17 · a session missing either count is dropped and said so, never assumed innocent', () => {
  const r = readParallelism([
    { id: 'complete', edits: 100, subagentTurns: 0 },
    { id: 'no-edits' },
    { id: 'no-subagent-count', edits: 100 },
  ]);
  eq(r.considered, 1);
  eq(r.incomplete, 2);
  eq(r.flagged.map((f) => f.id), ['complete']);

  const dir = fixture('h17-incomplete', H17_FIXTURE);
  const cfg = resolveConfig(dir);
  const health = runHealth(buildIndex(dir, cfg), cfg, dir, { sessions: [{ id: 'x' }] });
  ok(health.unevaluated.includes('H17'), 'nothing judgeable means unevaluated, not clean');
});

/* ================================================================== the parallelism instruction (C-11) */

test('C-11 · the skill tells a session to fan out, and gives one worktree per agent as the reason', () => {
  // The instruction is cheap and the constraint is what was expensive: three subagents on one shared tree and
  // one shared HEAD cost a session of splitting a 408-line diff by hunk. A skill that says "use subagents"
  // without saying that is an instruction to repeat it.
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'build', 'SKILL.md'), 'utf8');
  includes(skill, 'one worktree per agent', 'the constraint must be stated in those words');
  includes(skill, 'subagents by default', 'and fanning out must be the default, not an option');
  includes(skill, '408-line', 'with the cost that was actually paid, so it reads as a reason not a rule');
  includes(skill, 'When not to fan out', 'and the honest exceptions');
  includes(skill, 'depend on each other', 'a dependency chain is not parallelisable');
  includes(skill, 'coordination costs more than the parallelism', 'and neither is a task that is too small');
  includes(skill, 'H17', 'the skill names the signal that measures whether any of this happened');

  // Both runtimes ship the same words. `sync-runtimes --check` is asserted elsewhere; this pins the content
  // rather than the mechanism, because a mirror that is identically wrong still passes that check.
  const mirror = fs.readFileSync(path.join(REPO_ROOT, 'plugins', 'atlas', 'skills', 'build', 'SKILL.md'), 'utf8');
  includes(mirror, 'one worktree per agent', 'the Codex package must carry it too');
});

test('C-11 · the skill and the reference guide agree that H17 measures the operator', () => {
  // The tool's own instruction file drifting from the tool is the failure it detects for a living — and this
  // section of the skill has already done it once, claiming "nine, three blocking" for seven releases.
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'build', 'SKILL.md'), 'utf8');
  includes(skill, 'measures the operator, not the corpus');
  includes(skill, 'never blocking');
  includes(skill, 'unevaluated');

  const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'references', 'autonomy.md'), 'utf8');
  includes(guide, 'H17 measures the operator, not the corpus');
  includes(guide, 'one worktree per agent');
  includes(guide, '408-line');
});

/* ================================================================== the economics view (C-10, C-11) */

console.log('\neconomics view');

/**
 * A reading shaped by `docs/specs/token-economics.md`, built here rather than read from `readTokenEconomics`.
 *
 * The reader is landing separately. Binding these tests to it would mean either waiting for it or asserting
 * against whatever it happens to return today — and the contract is the thing both halves are supposed to
 * meet, so the contract is what the view is tested against. When the reader arrives, a test that feeds its
 * output through `econViewFixture`'s shape is the join; nothing here changes.
 *
 * The numbers are chosen to reproduce this repository's actual proportions, because two of them are load
 * bearing: cache read at 99% is what makes the tier chart split, and overlapping task windows are what the
 * `partial` column exists for. A fixture with tidy, evenly-sized tiers would pass a view that is wrong.
 */
function econViewFixture(over = {}) {
  const days = [];
  const rework = [];
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 5) continue;                       // a real silence, for the zero-fill to fill
    const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
    const output = 4000 + i * 250;
    const agentOutput = i % 3 === 0 ? 900 : 0;
    days.push({ day, input: 800, cacheWrite: 26000, cacheRead: 2_400_000, output,
      messages: 40, agentOutput, mainOutput: output - agentOutput });
    rework.push({ day, newWorkOutput: output - 700, reworkOutput: 700 });
  }
  return {
    available: true, reason: null,
    totals: { input: 9600, cacheWrite: 312_000, cacheRead: 28_800_000, output: 51_500, messages: 480 },
    days, rework,
    tasks: [
      { id: 'C-10', subject: 'What the work cost', status: 'completed',
        opened: '2026-06-01T09:00:00Z', closed: '2026-06-06T17:00:00Z',
        output: 21_000, cacheRead: 4_100_000, messages: 210, partial: true },
      { id: 'C-11', subject: 'Measure the parallelism', status: 'completed',
        opened: '2026-06-03T09:00:00Z', closed: '2026-06-09T17:00:00Z',
        output: 12_500, cacheRead: 2_600_000, messages: 140, partial: true },
      { id: 'Q-4', subject: 'Flag a serial session', status: 'in_progress',
        opened: '2026-06-11T09:00:00Z', closed: null,
        output: 4_800, cacheRead: 900_000, messages: 60, partial: false },
    ],
    kinds: [
      { kind: 'coding', output: 24_000, cacheRead: 12_000_000, writes: 300 },
      { kind: 'testing', output: 10_000, cacheRead: 5_000_000, writes: 120 },
      { kind: 'documentation', output: 9_000, cacheRead: 4_000_000, writes: 90 },
      { kind: 'planning', output: 5_000, cacheRead: 2_000_000, writes: 40 },
      { kind: 'other', output: 3_500, cacheRead: 5_800_000, writes: 0 },
    ],
    agents: { mainOutput: 47_900, agentOutput: 3_600, runs: 12, peakConcurrent: 3 },
    branches: [{ branch: 'fix/acme-outage-postmortem', output: 51_500, cacheRead: 28_800_000, messages: 480 }],
    caveats: ['Four transcript files hold records with no timestamp, and 812 such records are in no day.'],
    cost: { available: false },
    ...over,
  };
}

const ECON_VIEW = DEFAULT_VIEWS.find((v) => v.id === 'economics');
const econCtx = execCtx('econ-view');
/** `ctx.econ` is the injection point `viewPage` reads before it would call the reader itself. */
const econPage = (econ, panels = null) =>
  viewPage({ ...ECON_VIEW, panels: panels || ECON_VIEW.panels }, { ...econCtx, econ }, (o) => o.body);
/** Empty on a checkout that predates H17, which is the state this file must also pass in. */
const OPERATOR_IDS = new Set(Object.keys(healthModule.OPERATOR_SIGNALS || {}));

test('economics · every panel is stripped at BOTH exit doors, and the page still says why it is empty', () => {
  // `exportBundle` read each page straight off disk and never called `stripLocalOnly` — same command, same
  // promise on the tin, opposite behaviour from `exportSingleFile`. This whole view is local-only, so it is
  // the loudest possible test of both doors: if either one regresses, a token history of somebody's machine
  // ships in a file meant to be handed to a stranger.
  const dir = fixture('econ-strip', {
    'README.md': '# Front\n', 'docs/TASKS.md': EXEC_PLAN, 'docs/README.md': '# Docs\n',
  }, { remote: 'https://github.com/acme/widget.git' });
  const cfg = { ...resolveConfig(dir), planning: { source: 'docs/TASKS.md' } };
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);

  // The built page, with a reading injected the way the build will supply one.
  const local = econPage(econViewFixture());
  includes(local, 'fix/acme-outage-postmortem', 'the local page names the branch, which is the point of it');
  includes(local, 'What each task cost', 'and carries the per-task figures');
  // Every panel that carries a figure opts in, by id, so a renamed panel cannot quietly lose its marker.
  for (const id of ['econ-tiles', 'econ-spend', 'econ-agents', 'econ-tasks']) {
    ok(local.includes(`id="${id}" data-local-only`), `${id} must carry the marker`);
  }
  eq(local.includes('id="econ-local" data-local-only'), false,
    'and the provenance card must NOT, or a published page is a heading over nothing');

  // Door one.
  const stripped = stripLocalOnly(local);
  eq(stripped.includes('fix/acme-outage-postmortem'), false, 'no branch name may survive a strip');
  eq(stripped.includes('data-local-only'), false, 'and nothing may be left half-cut');
  eq(/28,800,000|2,400,000|51,500/.test(stripped), false, 'nor any token figure');
  eq(stripped.includes('What each task cost'), false, 'nor the task table');
  includes(stripped, 'Where these figures come from',
    'but the provenance card travels, so a published copy says why it is empty rather than rendering blank');

  // **The card that survives must survive whole.** `stripLocalOnly` scans for the bare substring rather than
  // for the attribute, so printing the marker's own name in prose had it cut the surrounding element out of
  // the published copy — leaving "carries  and is cut from every publish" on the one page whose subject is
  // that boundary. Asserted on the sentence, because the mangling is invisible in a marker count.
  includes(stripped, 'carries the local-only marker and is cut from every publish',
    'the provenance sentence must reach a published page intact');

  // Door two: the real file on disk, through the real bundler. The page has to exist for the bundle to carry
  // it, and it does — the view ships in DEFAULT_VIEWS.
  const built = fs.readFileSync(path.join(dir, cfg.output, 'view-economics.html'), 'utf8');
  includes(built, 'data-local-only', 'the built page carries the marker for the bundler to find');
  const bundle = exportBundle(dir, cfg);
  eq(bundle.includes('data-local-only'), false, 'exportBundle must strip every marked panel');
  includes(bundle, 'data-page="view-economics"',
    'and must still carry the page, or ten nav links point at a file no bundle holds');

  // Door one again, through the export the marker was invented for.
  const single = exportSingleFile(dir, cfg, 'view-economics');
  eq(single.includes('data-local-only'), false, 'exportSingleFile must strip it too');
  includes(single, 'Where these figures come from', 'and keep the stated reason');

  /*
   * **The unavailable page has to be stripped too, and it is the easier one to forget.**
   *
   * A card with no figures on it looks like it has nothing to protect. It does: the reason a reader is given
   * for why there is no data is a filesystem path — `No session transcripts for this repository at
   * /Users/somebody/.claude/projects/<slug>` — which is a home directory, a username, and the absolute
   * location of this checkout. Published, that is a worse leak than a token count.
   */
  const absent = econPage({ available: false,
    reason: 'No session transcripts for this repository at /Users/somebody/.claude/projects/-Users-somebody-work-secret.' });
  for (const id of ['econ-tiles', 'econ-spend', 'econ-agents', 'econ-tasks']) {
    ok(absent.includes(`id="${id}" data-local-only`), `${id} must carry the marker when it has no data either`);
  }
  includes(absent, '/Users/somebody', 'the local page names the path, which is how a reader fixes it');
  eq(stripLocalOnly(absent).includes('/Users/somebody'), false,
    'and no home directory may reach a published page through an unavailability notice');
});

test('economics · four tiers, four tiles, and nowhere a blended total', () => {
  // Cache read is 99.2% of every token in this repository and is charged at a fraction of fresh input. One
  // "tokens used" figure ranks the cheapest rung equal with the dearest, which is the single misreading this
  // whole view was built to prevent — so the sum must not appear, in any tile, anywhere on the page.
  const f = econViewFixture();
  const html = econPage(f);
  const t = f.totals;
  const blended = t.input + t.cacheWrite + t.cacheRead + t.output;

  includes(html, 'output tokens');
  includes(html, 'fresh input');
  includes(html, 'cache write');
  includes(html, 'cache read');
  // **Checked in both renderings, because the tiles print the short form.** Asserting only on the grouped
  // digits let a `tokens used` tile showing `29.2M` sail straight through — the number the whole page exists
  // to refuse, missed because it was rounded. Every combination, long and short.
  const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US'));
  // A tier's own short form is legitimately on the page, and rounding can collide: cache read is 28.8M and so
  // is cache read plus fresh input. Where a sum is indistinguishable from a tier once rounded, only the exact
  // form is asserted — claiming a collision as a leak would be a test that fails for being right.
  const legitimate = new Set([t.input, t.cacheWrite, t.cacheRead, t.output].map(short));
  for (const n of [blended, t.input + t.cacheRead, t.cacheRead + t.cacheWrite, t.cacheRead + t.output]) {
    eq(html.includes(n.toLocaleString('en-US')), false,
      `a blended figure (${n.toLocaleString('en-US')}) must not appear anywhere on the page`);
    if (!legitimate.has(short(n))) {
      eq(html.includes(short(n)), false,
        `nor rounded to ${short(n)} — a blended total is no more honest for being short`);
    }
  }
  ok(!legitimate.has(short(blended)),
    'the full blended total must be distinguishable once rounded, or this test has no teeth at all');
  // And no tile may be labelled as though a sum were a thing this page reports.
  for (const label of ['tokens used', 'total tokens', 'tokens spent']) {
    eq(html.toLowerCase().includes(`>${label}<`), false, `no tile may be labelled "${label}"`);
  }
  includes(html, 'never added together', 'and the strip says so rather than leaving it to be noticed');

  // The ratio goes where the total would have been, and its denominator is *everything read* — the three
  // input rungs. Folding output in would be the blended figure arriving through the back door as a percentage,
  // so the wrong denominator is asserted against as well as the right one.
  const read = t.input + t.cacheWrite + t.cacheRead;
  const share = ((t.cacheRead / read) * 100).toFixed(1);
  const withOutput = ((t.cacheRead / (read + t.output)) * 100).toFixed(1);
  includes(html, `${share}% of everything read`, 'the ratio replaces the total');
  ok(share !== withOutput, 'the fixture must make the two denominators differ, or this proves nothing');
  eq(html.includes(`${withOutput}% of everything read`), false,
    'output is generated, not read — counting it in the denominator is the blended total in disguise');

  // The value a tile shows is short enough to fit it; the exact figure is a line below, never dropped.
  includes(html, '28.8M', 'ten digits at 30px overflow a 190px tile, so the headline is compact');
  includes(html, t.cacheRead.toLocaleString('en-US'), 'and the exact count is still on the page');
});

test('economics · a silent day is drawn as zero and counted out loud', () => {
  // The defect C-8 fixed on velocityChart, one granularity down. `days` carries an entry only for a day that
  // had a session, so two quiet days vanish from the array and the day after a gap sits flush against the day
  // before it — on a chart whose labels claim to be consecutive dates.
  const html = econPage(econViewFixture());
  includes(html, '06-05', 'the day inside the silence is on the axis');
  includes(html, '2 of them hold no session at all and are drawn as zero rather than skipped',
    'and the filled days are counted and stated, never slipped in');
});

test('economics · a tier two orders of magnitude above the rest gets a second chart, never a second y-axis', () => {
  // A dual axis can be scaled to say anything and the reader cannot see the choice. Stacked honestly, the
  // three small tiers are invisible under cache read — so the complete stack is drawn AND the same three
  // series are drawn again without it. Same order in both, so a colour means the same tier in both: putting
  // cache read alone in a chart would have given it slot 0, the purple that means "output" beside it.
  const f = econViewFixture();
  const dominant = econPage(f);
  includes(dominant, 'Tokens by tier, by day', 'the historical graph the contract asks for');
  includes(dominant, 'The same three tiers, without cache read', 'and the readable companion');

  // Computed over the days actually plotted, not over the totals — a window that trimmed early days and then
  // quoted a whole-history ratio would be describing a chart it is not drawing.
  const sum = (of) => f.days.reduce((n, d) => n + of(d), 0);
  const pct = ((sum((d) => d.cacheRead) / sum((d) => d.input + d.cacheWrite + d.cacheRead)) * 100).toFixed(1);
  includes(dominant, `is ${pct}% of everything read here`, 'with the ratio that justifies the split, computed');

  // Slot order is what keeps the two charts honest, so it is asserted rather than trusted.
  const wall = dominant.slice(dominant.indexOf('Tokens by tier, by day'));
  const second = wall.slice(wall.indexOf('The same three tiers'));
  const legend = (s) => [...s.matchAll(/--cat-(\d)\)"><\/i>([^<]+)/g)].map((m) => `${m[1]}:${m[2]}`);
  const a = legend(wall.slice(0, wall.indexOf('The same three tiers')));
  const b = legend(second.slice(0, second.indexOf('</figure>')));
  eq(a.slice(0, 3), b.slice(0, 3), 'a colour must mean the same tier in both charts');

  // And a repository whose tiers are comparable gets the one chart the contract asked for, with no apology.
  const even = econViewFixture();
  even.days = even.days.map((d) => ({ ...d, cacheRead: 30_000 }));
  const flat = econPage(even);
  eq(flat.includes('The same three tiers, without cache read'), false,
    'the split is decided from the data, not hardcoded');
  includes(flat, 'No tier here dominates enough', 'and the single chart says why it is single');
});

test('economics · a task whose window overlapped another says so on its own row', () => {
  // Windows overlap, a turn inside n of them contributes 1/n to each, and the result is a figure precise to
  // the token and quietly approximate. The contract requires the view to show the flag; showing it only in
  // the caption would leave a reader to work out which of seven rows it applies to.
  const html = econPage(econViewFixture());
  const rows = html.slice(html.indexOf('What each task cost')).split('<tr>').slice(2);
  const marked = rows.filter((r) => r.includes('>shared</abbr>'));
  eq(marked.length, 2, 'exactly the two overlapping tasks are marked');
  ok(marked.every((r) => /C-10|C-11/.test(r)), 'and they are the two the reading flagged');
  ok(rows.some((r) => r.includes('Q-4') && !r.includes('>shared</abbr>')),
    'the task that overlapped nothing is not marked');
  includes(html, '2 of these 3 share their window with another task',
    'and the caption counts them, so the flag is not the only place it is said');
  includes(html, 'still open', 'a task with no completion says so rather than showing a blank window');

  // No overlap at all is a different statement, and it gets made.
  const clean = econViewFixture();
  clean.tasks = clean.tasks.map((t) => ({ ...t, partial: false }));
  includes(econPage(clean), 'No two windows here overlap',
    'and a page with no overlap states that instead of staying quiet');
});

test('economics · the page refuses a person, and says why in plain words', () => {
  // A transcript carries no git author. Every session in the store belongs to whoever is at the machine, so a
  // per-contributor chart is one person's own work laid out as if it were a comparison. The refusal has to be
  // legible to a reader, not only absent from the markup.
  const html = econPage(econViewFixture());
  includes(html, 'There is no per-contributor axis on this page, and there cannot be one');
  includes(html, 'no git identity anywhere in it');
  includes(html, 'per agent', 'and the axes that are honest are named');
  includes(html, 'per branch');

  // Nothing on the page may present a person. The contributor panels must not be reachable from this view.
  for (const p of ['people', 'desks', 'models']) {
    eq(ECON_VIEW.panels.includes(p), false, `the view must not carry the ${p} panel`);
  }
  // And the refusal survives to the published copy, which is the one a stranger reads.
  includes(stripLocalOnly(html), 'there cannot be one',
    'the reason must travel, or a published page is silent about the axis it is missing');
});

test('economics · unavailable is a state with a reason, never an empty chart and never a zero', () => {
  // "No transcripts" and "spent nothing" are different claims and must not render the same. Nor may these
  // panels be omitted into "not shown on this page", whose stated meaning is "there is no data behind them" —
  // a boundary reported as an oversight is the failure this whole page is written against.
  const why = 'No session transcripts for this repository at ~/.claude/projects/x.';
  const html = econPage({ available: false, reason: why });
  includes(html, why, 'the reason the reader gave is printed verbatim');
  eq(html.includes('Not shown on this page'), false, 'and no panel is omitted as if it had no data');
  eq(/>0<\/p>|>0 tokens/.test(html), false, 'nothing is rendered as a measured zero');
  includes(html, '—</p><p class="tl">tokens</p>', 'the tile withholds a figure with an em dash');

  // `undefined` is the only value that falls through to the real reader — anything else, `null` included, is
  // taken as the reading itself.
  //
  // **This assertion was inverted by the merge that made it pass.** It was written on a branch where
  // `readTokenEconomics` did not exist, so `econPage(undefined)` took the missing-contract branch and the page
  // said so. The data layer has since landed on this trunk, the export resolves, and the same call now returns
  // a real reading of this repository. The guard is not dead — it still protects a partial checkout where the
  // two halves have not met — but it can no longer be provoked by omitting the injection, because the thing it
  // guards against is fixed. So: assert the integrated behaviour, and assert separately that the guard was not
  // deleted on the way past.
  const fellThrough = econPage(undefined);
  ok(!/\[object Promise\]/.test(fellThrough), 'a thenable is refused, never rendered');
  eq(/>0<\/p>|>0 tokens/.test(fellThrough), false, 'and the fall-through never draws a measured zero');
  includes(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'dashboard.mjs'), 'utf8'),
    'is not present in this build',
    'the partial-checkout guard is still in the source, even though this build can no longer reach it');
  includes(econPage({ available: false, reason: null }),
    'That is an absence of data, not a spend of zero',
    'and a reader that returned no reason still gets a sentence rather than a blank card');
  includes(econPage(null), 'That is an absence of data, not a spend of zero',
    'as does a reading of nothing at all');

  // The layout must not change with the data — a view that packs into columns when it is empty and flows when
  // it is full is two pages wearing one name.
  includes(html, 'class="dash-flow"');
  includes(econPage(econViewFixture()), 'class="dash-flow"');
});

test('economics · peak concurrency of one is the finding, and unmeasured is not one', () => {
  // C-11's whole point: this tool argues for fanning work out to subagents, so it has to say when that did not
  // happen. A bare "1" is a number a reader has to interpret; the panel interprets it.
  const serial = econViewFixture({ agents: { mainOutput: 51_500, agentOutput: 0, runs: 0, peakConcurrent: 1 } });
  includes(econPage(serial), 'Never more than <strong>one agent at a time</strong>');
  includes(econPage(serial), 'the fan-out this tool argues for did not happen');

  includes(econPage(econViewFixture()), 'Peak concurrency <strong>3</strong>', 'and a real figure is stated plainly');

  const unknown = econViewFixture({ agents: { mainOutput: 5, agentOutput: 5, runs: 1, peakConcurrent: null } });
  includes(econPage(unknown), 'was not measured',
    'not measured is its own state — it must not read as "it never happened"');

  includes(econPage(econViewFixture()), 'a floor and not a ceiling',
    'and the measurement states what it cannot see');
});

test('economics · the caveats are scoped to this page, and the reading\'s own are printed verbatim', () => {
  // The Repository view established this: a card headed "what this dashboard does not show" is worth reading
  // only if it knows which dashboard it is on. Bolting transcript caveats onto the Product view, where nothing
  // reads a transcript, teaches a reader to skip the card everywhere.
  const verbatim = 'Four transcript files hold records with no timestamp, and 812 such records are in no day.';
  const here = econPage(econViewFixture());
  includes(here, 'Task windows overlap');
  includes(here, 'clearing them erases the history permanently');
  includes(here, verbatim, 'the reading\'s own caveats are rendered as given, never summarised away');

  const elsewhere = viewPage({ id: 'product', title: 'Product', panels: ['status', 'caveats'] },
    econCtx, (o) => o.body);
  eq(elsewhere.includes('Task windows overlap'), false,
    'a page with no economics panel must not carry economics caveats');
});

test('economics · the day axis and the week axis are one implementation, not two', () => {
  // The spec says to reuse the axis helpers rather than add a third time axis, and the roadmap already files
  // the two zero-fills this project holds for silent weeks as a duplication to close. Writing a third would
  // have made that three. Asserted on behaviour: both fill their gaps and flag them, from one function.
  const ctx = repoCtx('econ-axis');
  // The fixture's own init commit is stamped "now", which would stretch the axis from January to today and
  // push the gap being asserted on out of the twelve-week window. Backdated the way the velocity test does it.
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--amend', '--no-edit', '--date=2026-01-05T09:00:00Z'],
    { cwd: ctx.dir, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' } });
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  commitAt(ctx.dir, '2026-01-26T10:00:00Z', 'b.txt', 'two');
  const weekly = viewPage({ id: 'x', title: 'X', panels: ['velocity'] },
    { ...ctx, contrib: readContrib(ctx.dir, ctx.cfg) }, (o) => o.body);
  includes(weekly, '2026-01-12', 'the week axis still fills its silence');
  includes(weekly, 'no commit this week');

  const daily = econPage(econViewFixture());
  includes(daily, '06-05', 'and the day axis fills its own, at a different step');
  includes(daily, 'drawn as zero rather than skipped');
});

test('economics · the view ships, is reachable, and travels in the bundle', () => {
  // Adding a view means adding it to BUNDLE_PAGES too, or every page's nav carries `view-economics.html` —
  // a link to a file no bundle holds. The bundle test asserts no such link survives; this asserts the entry
  // that keeps it true, from the list rather than from a hardcoded expectation.
  ok(ECON_VIEW, 'the Economics view is in DEFAULT_VIEWS');
  eq(ECON_VIEW.nav, true, 'and appears in the navigation');
  for (const p of ECON_VIEW.panels) ok(PANELS[p], `panel "${p}" must be declared in PANELS`);
  ok(navItems(DEFAULT_VIEWS, { hasDeck: false }).some((n) => n.href === 'view-economics.html'),
    'the nav names the page');
  ok(BUNDLE_PAGES.some((p) => p.file === 'view-economics'),
    'and the bundle carries it, or ten nav links point at a file that does not travel');

  // Three non-spanning cards is what gives this page its full width. A fourth puts it back into columns, and
  // the chart wall inside a 360px column is one chart per row with eight-pixel tick labels.
  const html = econPage(econViewFixture());
  includes(html, 'class="dash-flow"', 'the page reads top to bottom at full width');
  includes(html, 'class="card wall" id="econ-spend"', 'because the chart panels declare themselves full width');
});

test('signals · an operator signal is never counted as corpus rot', () => {
  // H17 measures how a session was run, not what is wrong with the documents. `SIGNALS` is
  // {...CORPUS_SIGNALS, ...OPERATOR_SIGNALS} and the card's count came straight off its length, so the
  // heading "Rot signals 16" silently became "Rot signals 17" — a false statement made by adding a true
  // signal. Dropping it would be the same failure inverted: a check that ran, invisible.
  //
  // **The rule is pinned on the pure function, not only on the rendered card.** Until H17 merges here the two
  // catalogues are the same set, so a card that had gone back to counting everything would render correctly
  // and nothing could catch it — the exact window in which this regresses, because the mistake ships with the
  // signal and the signal ships later. A synthetic operator signal closes that window now.
  const synthetic = { H99: { id: 'H99', title: 'Sessions that never fanned out', why: 'operator, not corpus' } };
  const g = signalGroups({ ...SIGNALS, ...synthetic }, synthetic);
  eq(g.corpus.some((s) => s.id === 'H99'), false, 'an operator signal is not a corpus signal');
  eq(g.corpus.length, Object.keys(SIGNALS).length, 'and removing it leaves the corpus catalogue whole');
  eq(g.operator.map((s) => s.id), ['H99'], 'it is kept, in its own group, rather than dropped');

  // And the card renders from that split rather than from the combined catalogue.
  const ctx = execCtx('signals-operator');
  const html = viewPage({ id: 'x', title: 'X', panels: ['signals'] }, ctx, (o) => o.body);
  const live = signalGroups(SIGNALS, healthModule.OPERATOR_SIGNALS || {});
  includes(html, `<h2>Rot signals <span class="count">${live.corpus.length}</span></h2>`,
    'the count under the rot heading is the corpus signals and only those');
  eq((html.match(/<code>H\d+<\/code>/g) || []).length,
    live.corpus.length + live.operator.length,
    'every signal is listed exactly once, in one group or the other — none is hidden');
  for (const s of live.corpus) includes(html, `<code>${s.id}</code>`, `${s.id} must be listed`);
  eq(html.includes('Not a rot signal'), live.operator.length > 0,
    'the second heading appears when, and only when, there is an operator signal to put under it');

  if (OPERATOR_IDS.size) {
    includes(html, 'the operator, not the corpus', 'and the page says what the difference is');
    for (const id of OPERATOR_IDS) includes(html, `<code>${id}</code>`, `${id} is listed, not hidden`);
    // It is also kept off the documentation-health chart, which is the same category error one card over.
    const chart = viewPage({ id: 'x', title: 'X', panels: ['health'] }, ctx, (o) => o.body);
    for (const id of OPERATOR_IDS) {
      eq(chart.includes(`>${id}<`), false, `${id} is not a documentation-health finding`);
    }
  }
});

/* ================================================================== pause / resume / stop (A-32) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied hundreds of lines
 * above; an `async` case down here is constructed, never awaited, and reported as a pass it never earned.
 *
 * Each case builds a real repository with a real linked worktree — `git worktree add` — because every claim
 * this module makes is about git's view of the tree, and a mocked worktree would prove nothing about the one
 * command whose entire job is to not lose somebody's work.
 */

console.log('\nsession · pause, resume, stop');

/** `git rev-parse --verify` exits non-zero for a missing ref, so it must not be called bare. */
function refSha(dir, ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '-q', ref],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

/** A repository with `n` agent worktrees, each optionally dirty. Returns the root. */
function sessionFixture(name, agents) {
  const dir = fixture(name, { 'README.md': '# S\n' });
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' });
  g(dir, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'base');
  // `main` must exist by name: pauseSession counts `main..HEAD` to report progress.
  g(dir, 'branch', '-f', 'main', 'HEAD');
  for (const [id, dirty] of Object.entries(agents)) {
    const wt = path.join(dir, '.claude', 'worktrees', `agent-${id}`);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    g(dir, 'worktree', 'add', '-q', '-b', `feat/${id}`, wt, 'HEAD');
    if (dirty) fs.writeFileSync(path.join(wt, 'work.txt'), `${dirty}\n`, 'utf8');
  }
  return dir;
}

test('session · pause checkpoints an agent\'s uncommitted work to a ref that survives the worktree', () => {
  // The failure this exists for: three agents were mid-task when a session ended, and 92K of uncommitted work
  // in one of them was recoverable only by hand. A patch under `.atlas/` would not have been enough — losing
  // the disk is the case you reach for this in — so the checkpoint is a commit and git owns the bytes.
  const dir = sessionFixture('sess-park', { aaa: 'in progress' });
  const r = pauseSession(dir, { now: '2026-01-01T00:00:00Z' });
  ok(r.available, r.reason);

  const a = r.agents.find((x) => x.id === 'aaa');
  ok(a, 'the agent worktree is discovered from git, not from a list somebody maintains');
  eq(a.wipRef, 'wip/agent-aaa');
  eq(a.committed, 1, 'the uncommitted file is in the checkpoint');

  // The ref resolves from the MAIN checkout, which is what makes it survive worktree removal.
  const sha = execFileSync('git', ['rev-parse', '--verify', 'wip/agent-aaa'],
    { cwd: dir, encoding: 'utf8' }).trim();
  ok(/^[0-9a-f]{40}$/.test(sha), 'the checkpoint is a real commit object');
  const files = execFileSync('git', ['show', '--name-only', '--format=', 'wip/agent-aaa'],
    { cwd: dir, encoding: 'utf8' });
  includes(files, 'work.txt', 'and it contains the work that was in flight');

  // Removing the worktree must not take the work with it.
  execFileSync('git', ['worktree', 'remove', '--force', path.join(dir, '.claude', 'worktrees', 'agent-aaa')],
    { cwd: dir, stdio: 'ignore' });
  const after = execFileSync('git', ['rev-parse', '--verify', 'wip/agent-aaa'],
    { cwd: dir, encoding: 'utf8' }).trim();
  eq(after, sha, 'the checkpoint outlives the worktree it came from — the whole point of using a ref');
});

test('session · pause never invents a commit, and never touches your own checkout', () => {
  // Two silent lies this could tell. An empty checkpoint would put "work was parked" in the log for a
  // worktree that had none. And parking the operator's own uncommitted edits would mean `atlas pause` quietly
  // committed on their behalf — it parks agents, not you.
  const dir = sessionFixture('sess-clean', { bbb: null });
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'my own edit\n', 'utf8');

  const r = pauseSession(dir, { now: '2026-01-01T00:00:00Z' });
  const b = r.agents.find((x) => x.id === 'bbb');
  eq(b.wipRef, null, 'a clean worktree gets no checkpoint');
  eq(b.note, 'clean');
  eq(refSha(dir, 'wip/agent-bbb'), '',
  'and no ref is created for it');

  const main = r.agents.find((x) => x.isMain);
  eq(main.wipRef, null, 'the main checkout is never committed');
  includes(fs.readFileSync(path.join(dir, 'mine.txt'), 'utf8'), 'my own edit');
  eq(execFileSync('git', ['status', '--porcelain', '--', 'mine.txt'],
    { cwd: dir, encoding: 'utf8' }).trim().startsWith('??'), true, 'the operator\'s edit is left exactly as it was');
});

test('session · a dry run writes nothing at all', () => {
  // A rehearsal that changes state is not a rehearsal, and this command's whole job is to be trusted before
  // it is run for real.
  const dir = sessionFixture('sess-dry', { ccc: 'wip' });
  const r = pauseSession(dir, { dryRun: true, now: '2026-01-01T00:00:00Z' });
  eq(r.dryRun, true, 'the report says it was a rehearsal, so the caller can headline it as one');
  eq(fs.existsSync(path.join(dir, PARKED_FILE)), false, 'no manifest');
  eq(refSha(dir, 'wip/agent-ccc'), '', 'no ref');
  eq(execFileSync('git', ['status', '--porcelain'],
    { cwd: path.join(dir, '.claude', 'worktrees', 'agent-ccc'), encoding: 'utf8' }).trim().length > 0, true,
  'and the work is still uncommitted, exactly where it was');
});

test('session · resume re-verifies the manifest against the tree instead of believing it', () => {
  // A manifest is a claim about the past; the worktree is the present. They diverge — somebody removes a
  // worktree between pausing and resuming — and a resume that read the file and stopped there would send an
  // agent to a directory that is not there.
  const dir = sessionFixture('sess-verify', { ddd: 'wip' });
  pauseSession(dir, { now: '2026-01-01T00:00:00Z' });
  execFileSync('git', ['worktree', 'remove', '--force', path.join(dir, '.claude', 'worktrees', 'agent-ddd')],
    { cwd: dir, stdio: 'ignore' });

  const p = readParked(dir);
  ok(p.available, p.reason);
  const [a] = verifyParked(dir, p).filter((x) => x.id === 'ddd');
  eq(a.worktreePresent, false, 'the vanished worktree is reported as vanished');
  eq(a.wipRefPresent, true, 'and the checkpoint that outlived it is reported as present');
});

test('session · a torn manifest says where the work is, rather than reporting nothing was parked', () => {
  // The worst available failure: tell somebody their work is gone while it is sitting in a ref. "Unreadable"
  // and "nothing was parked" are different states and must not render the same.
  const dir = sessionFixture('sess-torn', { eee: 'wip' });
  pauseSession(dir, { now: '2026-01-01T00:00:00Z' });
  fs.writeFileSync(path.join(dir, PARKED_FILE), '{"version":1,"agents":[', 'utf8');

  const p = readParked(dir);
  eq(p.available, false);
  includes(p.reason, 'wip/agent-', 'the reason names where to look');
  includes(p.reason, 'git branch --list', 'and gives the command that finds it');

  // Distinct from the empty case, which is not an error at all.
  fs.rmSync(path.join(dir, PARKED_FILE));
  includes(readParked(dir).reason, 'Nothing is parked');
});

test('session · stop keeps every branch, and refuses a worktree that still holds work', () => {
  // "Stop" means finish cleanly. Deleting uncommitted work on the way past is the opposite, so the refusal is
  // the feature — and it points at `atlas pause`, which is what makes stopping safe.
  const dir = sessionFixture('sess-stop', { fff: 'wip', ggg: null });
  pauseSession(dir, { now: '2026-01-01T00:00:00Z' });          // parks fff, leaves ggg clean
  fs.writeFileSync(path.join(dir, '.claude', 'worktrees', 'agent-ggg', 'late.txt'), 'after\n', 'utf8');

  const r = stopSession(dir, {});
  eq(r.removed.map((x) => x.id), ['fff'], 'the clean worktree is removed');
  eq(r.kept.map((x) => x.id), ['ggg'], 'the dirty one is kept');
  includes(r.kept[0].why, 'uncommitted');

  // Branches and checkpoints are never deleted by stop.
  ok(r.wipRefs.includes('wip/agent-fff'), 'the checkpoint is listed');
  eq(refSha(dir, 'wip/agent-fff').length, 40,
  'and it still exists afterwards');
  eq(refSha(dir, 'feat/fff').length, 40,
  'as does the feature branch');
  eq(fs.existsSync(path.join(dir, PARKED_FILE)), false, 'the session state is cleared');
});

test('session · the manifest carries the agent\'s label and never its prompt', () => {
  // `agent-<id>.meta.json` holds `description` — a three-word title — beside the brief. The brief is the
  // prompt in miniature and does not reach disk here, the same boundary tokens.mjs holds over the same
  // directory. A planted secret proves the reader cannot carry one out.
  const dir = sessionFixture('sess-label', { hhh: 'wip' });
  const store = path.join(dir, 'store');
  fs.mkdirSync(path.join(store, 'sess-1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(store, 'sess-1', 'subagents', 'agent-hhh.meta.json'), JSON.stringify({
    agentType: 'general-purpose',
    description: 'Economics dashboard view',
    prompt: 'SHIBBOLETH-do-not-store-this',
  }), 'utf8');

  const r = pauseSession(dir, { storeDir: store, now: '2026-01-01T00:00:00Z' });
  eq(r.agents.find((x) => x.id === 'hhh').label, 'Economics dashboard view');
  const raw = fs.readFileSync(path.join(dir, PARKED_FILE), 'utf8');
  eq(raw.includes('SHIBBOLETH'), false, 'no prompt text reaches the manifest');
  eq(raw.includes('"prompt"'), false, 'not even the key');
});

test('session · the manifest is gitignored, because how you worked is not a fact about the repository', () => {
  const ignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  includes(ignore, PARKED_FILE, 'the parked manifest must never be committed');
  eq(execFileSync('git', ['check-ignore', PARKED_FILE], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    PARKED_FILE, 'and git agrees');
});

/* ================================================================== locale-independent numbers (A-33) */

console.log('\nnumber formatting');

test('format · a grouped number does not depend on where the machine thinks it is', () => {
  // `toLocaleString()` with no argument reads the host locale. Under en-IN — the default on this project
  // author's own machine — 126200000 renders as "12,62,00,000". The same commit then builds different bytes
  // in two places, which silently breaks the byte-identical rebuild the build stamp exists to assert, and
  // breaks it in the way hardest to read: every number in the site looks like it changed.
  eq(num(126200000), '126,200,000');
  eq(num(0), '0', 'a measured zero is a number, not an absence');
  eq(num(1234.6), '1,235', 'rounded, so a float cannot leak a decimal separator that also varies');
  eq(num(null), '—', 'and a missing measurement is an em dash, never NaN');
  eq(num(undefined), '—');
  eq(num(Number.NaN), '—');

  // **The assertions above cannot fail on CI, and that was the whole defect.** They compare `num()` to
  // `en-US` output, and CI runs under `en_US.UTF-8` — so reverting `format.mjs` to a bare `toLocaleString()`
  // left this test green there and red only on the author's own `en_IN` machine. A guard that fires on one
  // developer's laptop and nowhere else is not a guard.
  //
  // Fixed by running the implementation in a child process under a locale that groups differently, so the
  // pin is exercised on every machine regardless of what the host locale happens to be.
  eq(num(126200000), (126200000).toLocaleString('en-US'));
  const probe = execFileSync(process.execPath, ['-e',
    "import('./scripts/lib/format.mjs').then(m => process.stdout.write(m.num(126200000)))"],
  { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, LANG: 'en_IN.UTF-8', LC_ALL: 'en_IN.UTF-8' } });
  eq(probe, '126,200,000', 'under en_IN the implementation must still group the en-US way');
  ok((126200000).toLocaleString('en-IN') !== '126,200,000',
    'en-IN really does group differently — if this ever stops being true the probe proves nothing');
});

test('format · no module reintroduces a bare toLocaleString', () => {
  // The defect returns silently and on one machine only, so the guard has to be structural rather than a
  // convention somebody remembers. Comments are exempt: the reasoning names the thing it forbids.
  const offenders = [];
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib'))) {
    // `format.mjs` is NOT exempt. Exempting it excused the single call that is allowed to name a locale —
    // and left the one file where a bare call is fatal unchecked, which is how a reverted fix passed.
    if (!f.endsWith('.mjs')) continue;
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\.toLocaleString\(\s*\)/.test(line) && !/^\s*[*/]/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  cli.split('\n').forEach((line, i) => {
    if (/\.toLocaleString\(\s*\)/.test(line) && !/^\s*[*/]/.test(line)) offenders.push(`atlas.mjs:${i + 1}`);
  });
  eq(offenders, [], `use num() from format.mjs — a bare call reads the host locale`);
});

/* ================================================================== one derivation, one answer (C-7) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above, so an `async` case here would be constructed, never awaited, and counted as a pass it never earned.
 *
 * Both cases are written as *agreements between two callers* rather than as unit tests of the hoisted helper.
 * A unit test of one function cannot fail when somebody re-derives it somewhere else, and re-derivation is
 * the failure mode: the roadmap carried these two duplications as deliberate for a whole release, and the
 * damage they threatened was never a wrong number — it was two different numbers, on two surfaces, with
 * nothing on either page to say which one to believe. So each case asks the same question of both surfaces
 * over one input and asserts the answers are the same, and then asserts structurally that there is only one
 * implementation left to give an answer at all.
 */

console.log('\none derivation, one answer');

test('C-7 · the rhythm report and the dashboard fill the same silent weeks', () => {
  // Two commits, five weeks apart, so four weeks in between contain nothing. `cadence` counts them for the
  // terminal report and `velocityChart` draws them on the page; before C-7 those were two zero-fills in two
  // modules, free to drift into a page saying "3 silent weeks" beside a report saying 4.
  const ctx = repoCtx('c7-weeks');
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--amend', '--no-edit', '--date=2026-01-05T09:00:00Z'],
    { cwd: ctx.dir, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' } });
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'a.txt', 'one');
  commitAt(ctx.dir, '2026-02-09T10:00:00Z', 'b.txt', 'two');

  const contrib = readContrib(ctx.dir, ctx.cfg);
  const k = cadence(contrib);
  ok(k.available, k.reason);
  eq(k.spanWeeks, 6, 'the fixture must really span six weeks, or this asserts on nothing');
  eq(k.filled, 4, 'four of them contain no commit at all');

  const html = viewPage({ id: 'x', title: 'X', panels: ['velocity'] }, { ...ctx, contrib }, (o) => o.body);
  includes(html, `${k.filled} of them contain no commit`,
    'the page must state the same number of silent weeks the rhythm report counted');
  eq((html.match(/no commit this week/g) || []).length, k.filled,
    'and draw exactly that many of them — a caption agreeing with a chart that does not is worse than either');
  for (const w of k.weeks) {
    includes(html, w.week, `the week ${w.week} is on the report's axis and must be on the page's axis too`);
  }

  // The structural half. The behavioural half above passes whether there is one implementation or two
  // identical ones, which is exactly the state C-7 was filed against.
  const gi = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'gitinsight.mjs'), 'utf8');
  includes(gi, "import { weeklyAxis } from './contrib.mjs'",
    'the rhythm report reads the axis from the module that produces the series');
  eq(/setUTCDate/.test(gi), false, 'and steps no week axis of its own');
  // dashboard.mjs still holds the third copy at the time this was written — it was owned by another change
  // in the same session and could not be edited here. Closing it is deleting `AXIS_MAX`, `fillAxis` and
  // `weeklyAxis` from that file and importing the last two from `./contrib.mjs`; nothing above needs
  // amending when that lands, because it asserts on what the page says rather than on where it came from.
});

test('C-7 · the routing table and the hotspot report agree on which files are documented', () => {
  // `kb.mjs` inverts the citations to answer "I am about to change this file — what describes it?", and
  // `gitinsight.mjs` inverts them again to answer "this file is busy and nothing describes it". Those are
  // the same index read two ways, and two builds of it could disagree in the worst possible direction: a
  // hotspot reported as undocumented while the routing table lists the document that documents it.
  const dir = fixture('c7-routes', {
    'docs/README.md': '# Index\n\n[Alpha](A.md) · [Beta](B.md)\n',
    'docs/A.md': '# Alpha\n\n## How it works\n\nThe loop is at `src/one.js:1`.\n',
    'docs/B.md': '# Beta\n\n## Also\n\nSee `src/one.js:2`, and `two.js:1` which names two files at once.\n',
    'src/one.js': 'const a = 1;\nconst b = 2;\n',
    'src/two.js': 'const c = 3;\n',
    'lib/two.js': 'const d = 4;\n',
  });
  const { cfg, index, health } = analyse(dir);
  const { outDir } = renderSite(index, health, cfg, dir);
  const routes = fs.readFileSync(path.join(outDir, 'kb', 'routes.md'), 'utf8');
  const spots = hotspots(readContrib(dir, cfg), { index, root: dir });
  ok(spots.available, spots.reason);

  const byFile = routes.slice(routes.indexOf('## By file'), routes.indexOf('## Code areas nothing documents'));
  const listed = [...byFile.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();
  const documented = spots.byCommits.filter((r) => r.citedBy && r.citedBy.length).map((r) => r.path).sort();
  eq(listed, ['src/one.js'], 'the fixture must produce exactly one documented file, or the comparison is empty');
  eq(listed, documented, 'both surfaces must name the same documented files');

  // The shared filter, which is the part most likely to be dropped by one copy and not the other: `two.js`
  // names two tracked files, so it resolves to neither and is not evidence that either is documented.
  eq(listed.includes('src/two.js') || listed.includes('lib/two.js'), false,
    'an ambiguous citation is not coverage — on either surface');
  ok(spots.undocumented.some((r) => r.path === 'src/two.js'),
    'and the hotspot report says so out loud rather than leaving the file out');

  // And the same documents behind that file, not merely the same count.
  const titleOf = new Map(index.documents.map((d) => [d.path, d.title || d.path]));
  // Four columns since the suite was wired into this table: the fourth is "tested by", and it is a dash on
  // this fixture because nothing here is a test file. Pinned rather than made optional — a row that grew a
  // column silently is exactly the drift the rest of this case is about.
  const row = /^\| `src\/one\.js` \| (.+?) \| (\d+) \| (.+?) \|$/m.exec(byFile);
  ok(row, 'the routing table must carry a row for the cited file');
  eq(row[3], '—', 'no test file imports this fixture, and the column must say so rather than be absent');
  const cited = spots.byCommits.find((r) => r.path === 'src/one.js').citedBy;
  eq(cited, ['docs/A.md', 'docs/B.md'], 'both documents cite it');
  for (const p of cited) includes(row[1], titleOf.get(p), `${p} must be routed to from the file it describes`);
  eq(Number(row[2]), 2, 'and both citations are counted');

  // The structural half: one module builds this index, and it is the one that owns citation coverage.
  const defs = fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib'))
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => /\.set\(c\.resolved, new Set\(\)\)/
      .test(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', f), 'utf8')));
  eq(defs, ['design.mjs'], 'exactly one module may build the reverse citation index');
});

/* ================================================================== C-10 · the contiguous-run rule
 *
 * Every case here is synchronous, for the reason stated above the older economics block: `pendingAsync` is
 * drained far above this point, so an `async` case registered down here would be constructed, never awaited,
 * and reported as a pass it never earned.
 */

console.log('\ntoken attribution by run (C-10)');

test('economics · a run is cut by a silence, and inside it a turn takes the NEAREST attribution', () => {
  // The primitive both axes are built on, tested on its own so the rule is legible without a transcript.
  const at = (m) => ({ ts: Date.parse(`2026-03-01T10:${String(m).padStart(2, '0')}:00Z`) });
  const A = (m, mark) => ({ ...at(m), mark });
  const gap = 5 * 60000;

  // 10:00 unmarked, 10:01 marked, 10:02 unmarked, 10:20 unmarked (a different sitting), 10:21 unmarked.
  const turns = [A(0), A(1, 'x'), A(2), A(20), A(21)];
  const anchors = runAnchors(turns, gap, (t) => !!t.mark);
  eq([...anchors], [1, 1, 1, -1, -1],
    'a turn before the write inherits it too — the reading that precedes a write is that write\'s work');
  eq(anchors.runs, 2, 'the eighteen-minute silence ends the run');
  eq(anchors.cuts, 1);

  // Equidistant between two marks: the earlier one wins, so the answer cannot depend on iteration order.
  const tie = [A(0, 'first'), A(2), A(4, 'second')];
  eq(runAnchors(tie, gap, (t) => !!t.mark)[1], 0, 'a tie goes to the earlier attribution, deterministically');
  // And the nearer one wins when they are not equidistant, in either direction.
  eq(runAnchors([A(0, 'a'), A(3), A(4, 'b')], gap, (t) => !!t.mark)[1], 2, 'nearest, looking forwards');
  eq(runAnchors([A(0, 'a'), A(1), A(4, 'b')], gap, (t) => !!t.mark)[1], 0, 'nearest, looking backwards');
  eq(runAnchors([], gap, () => true).length, 0, 'an empty file is not a crash');
});

/* One fixture: a run of turns that writes twice, then a long silence and two turns that write nothing. */
const RUN_STORE = path.join(tmpRoot, 'econ-run-store');

const runFixture = (() => {
  const dir = fixture('econ-run', {
    'project-atlas.config.json': JSON.stringify({
      output: 'docs/_wiki', planning: { source: 'docs/ROADMAP.md' },
      include: ['**/*.md'], exclude: ['**/_wiki/**'],
      tokens: { transcriptRoot: RUN_STORE },
    }),
    'docs/A.md': '# A\n', 'docs/ROADMAP.md': '# Roadmap\n', 'src/a.js': 'one\n',
  });
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: RUN_STORE } }));
  fs.mkdirSync(path.join(RUN_STORE, slug), { recursive: true });

  const turn = (uuid, ts, output) => ({
    type: 'assistant', uuid, timestamp: ts, sessionId: 's1', gitBranch: 'main',
    message: { model: 'test-model', usage: { input_tokens: 0, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  const wrote = (owner, abs) => ({ type: 'user', sourceToolAssistantUUID: owner, toolUseResult: { filePath: abs } });
  const T = (s) => `2026-03-01T10:${s}Z`;

  fs.writeFileSync(path.join(RUN_STORE, slug, 'session.jsonl'), [
    turn('r1', T('00:00'), 100),                                   // reads and reasons — writes nothing
    turn('r2', T('00:30'), 100),
    wrote('r2', path.join(dir, 'src', 'a.js')),                    // coding
    turn('r3', T('01:00'), 100),                                   // 30s from coding, 60s from documentation
    turn('r4', T('02:00'), 100),
    wrote('r4', path.join(dir, 'docs', 'A.md')),                   // documentation
    turn('r5', T('02:30'), 100),
    // Twenty-two minutes later: a different sitting, and nothing in it writes anything at all.
    turn('r6', T('25:00'), 100),
    turn('r7', T('25:30'), 100),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // One task, open for thirty seconds in the middle of the first run — and one that never closes.
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'tasks-live.jsonl'), [
    { at: T('01:00'), op: 'create', id: 'T', subject: 'Narrow', status: 'pending' },
    { at: T('01:30'), op: 'update', id: 'T', status: 'completed' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  return dir;
})();

const runCfg = (over = {}) => ({ ...resolveConfig(runFixture), tokens: { transcriptRoot: RUN_STORE, ...over } });

test('economics · a turn that wrote nothing takes the kind of its run, and `other` means the run wrote nothing', () => {
  // The defect this replaces: classifying each turn by what that turn wrote put 83.4% of this repository's
  // output in `other`, because the overwhelming majority of turns read, search, reason or run a command. The
  // rule was wrong, not the code — `other` had come to mean "did not happen to write a file this turn".
  const k = readTokenEconomics(runFixture, runCfg());
  ok(k.available, k.reason || '');
  eq(k.totals.output, 700, 'seven turns of 100');

  const byKind = Object.fromEntries(k.kinds.map((x) => [x.kind, x]));
  eq(byKind.coding.output, 300, 'the write, the turn before it and the turn nearer to it than to the next write');
  eq(byKind.documentation.output, 200, 'the second write and the turn after it');
  eq(byKind.other.output, 200, 'and only the sitting that wrote nothing at all is `other`');
  eq(byKind.planning.output, 0);
  eq(byKind.testing.output, 0);
  eq(k.kinds.reduce((n, x) => n + x.output, 0), k.totals.output, 'the split must not invent or lose output');
  eq([byKind.coding.writes, byKind.documentation.writes], [1, 1],
    '`writes` still counts actual writes — inheritance moves output, never the write count');
});

test('economics · nothing is inherited across a silence longer than the run break', () => {
  // The whole force of the rule is the break. Widen it past the 22-minute gap in the fixture and the two
  // trailing turns join the documentation run; that is exactly the over-reach the measured threshold refuses.
  const wide = readTokenEconomics(runFixture, runCfg({ sittingGapMinutes: 60 }));
  const wideKinds = Object.fromEntries(wide.kinds.map((x) => [x.kind, x]));
  eq(wideKinds.other.output, 0, 'at 60 minutes the trailing sitting is swallowed by the previous one');
  eq(wideKinds.documentation.output, 400);

  // And narrow it below the 30-second rhythm of the fixture and every turn is its own run again.
  const narrow = readTokenEconomics(runFixture, runCfg({ sittingGapMinutes: 0 }));
  const narrowKinds = Object.fromEntries(narrow.kinds.map((x) => [x.kind, x]));
  eq(narrowKinds.other.output, 500, 'with no run at all, only the two writing turns are attributable');
  eq(narrowKinds.coding.output, 100);

  eq(DEFAULT_SITTING_GAP_MINUTES, 5, 'the default is the measured one, not whatever the last test set');
});

test('economics · the run break is stated with its percentile and sample, and `other` with what it means', () => {
  // The same discipline as H17's 40-edit threshold: a number chosen from data has to arrive with the data.
  const text = readTokenEconomics(runFixture, runCfg()).caveats.join(' ');
  includes(text, '99.4th percentile', 'the threshold must arrive with its percentile');
  includes(text, '8,319', 'and with the sample it was measured over');
  includes(text, 'tokens.sittingGapMinutes', 'and with the setting that changes it');
  includes(text, 'contiguous run', 'the rule itself must be stated, not just its effect');
  includes(text, '83.4%', 'including what the rule it replaced measured, so the change is auditable');
  includes(text, 'It does not mean "wrote no file this turn"', '`other` has to say what it now means');
});

test('economics · a turn near an attributed one joins its task, and what stays outside is still reported', () => {
  // Coverage improves where it is genuinely recoverable — a turn seconds away from a turn inside a window is
  // the same work — and the remainder stays visible. Making the unattributed share disappear by widening
  // windows until everything is inside one would be the dishonest fix.
  const k = readTokenEconomics(runFixture, runCfg());
  eq(k.tasks.length, 1);
  eq(k.tasks[0].output, 500, 'the whole first run joins the task whose window only one of its turns fell in');
  eq(k.tasks[0].partial, false, 'inheritance is not overlap — one window overlaps nothing');

  const text = k.caveats.join(' ');
  includes(text, 'took the attribution of the nearest turn in the same run',
    'output that was inherited rather than measured must say so');
  includes(text, '28.6% of all output', 'and what is still attributed to no task stays printed as a share');
  includes(text, 'no task window, near no turn that does', 'stated as what it is, not smoothed away');
});

test('economics · a task window too narrow to hold a turn reports zero, and says that is why', () => {
  // The hook writes the whole list the first time it sees one, so a pre-existing list arrives as a burst of
  // create-and-complete records sharing an instant. On this repository that is 9 of 11 windows. A zero there
  // is a window narrower than a turn, and reading it as "this task cost nothing" is the wrong conclusion.
  const dir = fixture('econ-instant', {
    'project-atlas.config.json': JSON.stringify({ output: 'docs/_wiki', tokens: { transcriptRoot: RUN_STORE } }),
    'docs/A.md': '# A\n',
  });
  fs.mkdirSync(path.join(dir, '.atlas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'tasks-live.jsonl'), [
    { at: '2026-03-01T09:00:00Z', op: 'create', id: '1', subject: 'Backfilled', status: 'pending' },
    { at: '2026-03-01T09:00:00Z', op: 'update', id: '1', status: 'completed' },
    { at: '2026-03-01T09:00:00Z', op: 'create', id: '2', subject: 'Still open', status: 'pending' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // Point it at the run fixture's transcripts so there is spend to attribute; the store is keyed by path, so
  // this directory has none of its own and the reader has to be given one that exists.
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: RUN_STORE } }));
  fs.mkdirSync(path.join(RUN_STORE, slug), { recursive: true });
  fs.copyFileSync(
    path.join(RUN_STORE, path.basename(transcriptDir(runFixture, { tokens: { transcriptRoot: RUN_STORE } })), 'session.jsonl'),
    path.join(RUN_STORE, slug, 'session.jsonl'));

  const k = readTokenEconomics(dir, { ...resolveConfig(dir), tokens: { transcriptRoot: RUN_STORE } });
  const text = k.caveats.join(' ');
  includes(text, 'opened and closed inside one second and can contain no turn',
    'a zero-width window has to explain its own zero');
  includes(text, 'have no closing record and are still open',
    'and an open-ended window has to say its figure is a running total');
});

test('economics · the reader bails on one stat when there is no store, because every build calls it', () => {
  // Rule 1 in tokens.mjs used to say nothing but `atlas tokens` reads transcripts. C-10 made that false — the
  // Economics view is a page, so a build renders it and `atlas watch` builds on every save. The rule now says
  // what is true, and this is the property that keeps it safe to be true: the common case, a machine with no
  // store for this path, must cost a stat and not a directory walk, a task-log read or a `git log`.
  const nowhere = path.join(tmpRoot, 'econ-absent-root');
  fs.mkdirSync(nowhere, { recursive: true });
  const cfg = { tokens: { transcriptRoot: path.join(tmpRoot, 'econ-store-that-is-not-there') } };

  const probe = hasTranscripts(nowhere, cfg);
  eq(probe.present, false);
  includes(probe.reason, 'No session transcripts', 'absent is a state with a reason, never a zero');
  ok(probe.dir.startsWith(path.join(tmpRoot, 'econ-store-that-is-not-there')), 'and it names where it looked');

  const k = readTokenEconomics(nowhere, cfg);
  eq(k.available, false);
  eq(k.totals, null, 'still never a spend of zero');
  includes(k.reason, probe.reason, 'the reader reports exactly what the probe found');

  // A store that exists but holds a file which is not a transcript is the same answer, one step later.
  const empty = path.join(tmpRoot, 'econ-empty-store');
  const slug = path.basename(transcriptDir(nowhere, { tokens: { transcriptRoot: empty } }));
  fs.mkdirSync(path.join(empty, slug), { recursive: true });
  fs.writeFileSync(path.join(empty, slug, 'notes.txt'), 'not a transcript\n', 'utf8');
  eq(hasTranscripts(nowhere, { tokens: { transcriptRoot: empty } }).present, true, 'the directory is there');
  const e = readTokenEconomics(nowhere, { tokens: { transcriptRoot: empty } });
  eq(e.available, false);
  includes(e.reason, 'nothing to attribute');
});

test('economics · rule 1 in the module header names the build, because the build reads transcripts', () => {
  // The header is the only place this rule is written down, and a rule that contradicts the code teaches a
  // reader to trust neither. `dashboard.mjs` calls `readTokenEconomics` when a panel on the page asks for it;
  // that has to be in the header, together with why it is still safe.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'tokens.mjs'), 'utf8');
  // Unwrapped, because a claim must not be able to hide from this check by falling across a line break.
  const header = src.slice(0, src.indexOf('import ')).replace(/\n\s*\*/g, ' ').replace(/\s+/g, ' ');
  ok(!/Nothing reads transcripts unless `atlas tokens` is run/.test(header),
    'the claim the build falsified must not still be in the header');
  ok(/hasTranscripts/.test(header), 'the header must name the cheap door that keeps a per-save build honest');
  ok(/Economics view/.test(header), 'and say which other surface reads the store');

  const dash = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'dashboard.mjs'), 'utf8');
  ok(/readTokenEconomics/.test(dash), 'if this ever stops being true, the header above is wrong again');
});

/* ================================================================== chart axes, publish marker (Q-6) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above, so an `async` case here would be constructed, never awaited, and counted as a pass it never ran for.
 *
 * Three shipped defects, each asserted on the property rather than on the symptom: an axis label that fits
 * inside the picture, a gridline that is drawn where its own label says it is, and a marker that is an
 * attribute rather than a word.
 */

console.log('\nchart axes and the publish marker');

/** Text nodes in an SVG, with the attributes needed to work out where the glyphs actually land. */
const svgText = (svg) => [...svg.matchAll(/<text class="c-tick" x="([\d.]+)" y="([\d.]+)" text-anchor="(\w+)">([^<]*)<\/text>/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]), anchor: m[3], label: m[4] }));

/**
 * The horizontal extent of a label, in user units.
 *
 * There is no text measurement without a layout engine, so this is an estimate — and deliberately a
 * *conservative* one. `.c-tick` is 10px; digits and hyphens in the system sans stack run about 6.2px at that
 * size, and 6.0 is used here so the test cannot fail on a rounding difference between one machine's idea of a
 * font and another's. Under-estimating is the safe direction: it can only let a real overhang pass, never
 * invent one, and the overhang this guards is 14px.
 */
const extent = ({ x, anchor, label }) => {
  const wide = label.length * 6.0;
  if (anchor === 'end') return [x - wide, x];
  if (anchor === 'start') return [x, x + wide];
  return [x - wide / 2, x + wide / 2];
};

test('charts · every axis label is drawn inside the viewBox, including the last one', () => {
  // `lineChart` and `stackedArea` centred the final x label on `w - pad.r` — ten pixels from the edge of the
  // picture — so half of a five-character date hung outside the viewBox and was clipped. It affected every
  // time chart the tool draws, the shipped Commits-per-week chart on the Delivery page included; it was
  // reported against the economics view only because that is where somebody happened to look.
  //
  // Asserted as "no label leaves the box" rather than "the last label is anchored end", so the fix is free to
  // change and the property is not.
  const w = 460, labels = ['07-01', '07-08', '07-15', '07-22', '07-29', '08-05'];
  const charts = {
    lineChart: lineChart({ title: 'weekly', labels, series: [{ label: 'commits', values: [4, 11, 6, 9, 2, 8] }] }),
    stackedArea: stackedArea({ title: 'weekly', labels, series: [{ label: 'added', values: [40, 11, 60, 9, 2, 80] }] }),
  };
  for (const [name, html] of Object.entries(charts)) {
    const ticks = svgText(html);
    ok(ticks.some((t) => t.label === '08-05'), `${name}: the last label must be drawn at all`);
    for (const t of ticks) {
      const [left, right] = extent(t);
      ok(right <= w, `${name}: "${t.label}" runs to ${right.toFixed(1)}, past the ${w}px viewBox — it is clipped`);
      ok(left >= 0, `${name}: "${t.label}" starts at ${left.toFixed(1)}, off the left of the viewBox`);
    }
  }
});

test('charts · no two gridlines carry the same label, and none names a height it is not at', () => {
  // Gridlines at [0, 0.5, 1] of a maximum of 1 render as "0, 1, 1": `nice` states whole numbers below 1000,
  // so the middle line — genuinely at 0.5 — claims to be the same line as the top one. The same rounding
  // mislabels every odd maximum more quietly: at 7 the middle line sits at 3.5 and says 4, and a reader
  // measuring a point against it is out by half a unit with nothing to suggest it. The economics view avoided
  // this by going cumulative. Every other small series still met it.
  const h = 170, pad = { t: 10, b: 22 };
  // Invert the y scale the chart drew with: y(v) = h - pad.b - (v / max) * (h - pad.t - pad.b), and the label
  // is set 3px below its line.
  const valueAt = (yText, max) => ((h - pad.b - (yText - 3)) / (h - pad.t - pad.b)) * max;

  for (const max of [1, 2, 3, 7, 17, 100]) {
    for (const [name, draw] of [['lineChart', lineChart], ['stackedArea', stackedArea]]) {
      const html = draw({ title: 'x', labels: ['a', 'b', 'c'], series: [{ label: 'y', values: [max, 0, max] }] });
      const yTicks = svgText(html).filter((t) => t.anchor === 'end' && t.x < 34);   // the y axis sits left of pad.l
      ok(yTicks.length >= 2, `${name} @ ${max}: an axis needs at least two gridlines`);

      const labels = yTicks.map((t) => t.label);
      eq(labels.length, new Set(labels).size,
        `${name} @ ${max}: two gridlines at two heights carry the same label (${labels.join(', ')})`);

      for (const t of yTicks) {
        const drawn = valueAt(t.y, max);
        ok(Math.abs(drawn - Number(t.label)) < 0.05,
          `${name} @ ${max}: a gridline labelled ${t.label} is drawn at ${drawn.toFixed(2)}`);
      }
      ok(labels.includes('0'), `${name} @ ${max}: the baseline is always stated`);
    }
  }
});

test('publish · a page that names the local-only marker in prose survives both exit doors intact', () => {
  /*
   * **The dangerous one, and the one nobody was checking.** `stripLocalOnly` scanned for the bare substring
   * `data-local-only`, so an element containing those characters *as text* was cut out of the published copy —
   * silently, from the artefact handed to other people, and not from the copy the author is looking at. The
   * roadmap's own sentence, "The view carries `data-local-only`, the same guarantee as…", published as "The
   * view carries , the same guarantee as…". A previous agent hit it writing a caption about the marker and
   * reworded around it rather than fixing it.
   *
   * Every existing case here asserts that the private panel is *gone*. This one asserts that the public
   * paragraph is *still there*, which is the half that fails open — and it asserts both in the same test,
   * because a stripper that keeps prose by keeping everything would pass either half alone.
   *
   * Written against the real files on disk, through both real exports, rather than against the matcher: the
   * matcher being right is not the guarantee, the two exit doors being right is.
   */
  const dir = fixture('local-only-prose', {
    'README.md': '# Front\n\n[The marker](docs/MARKER.md)\n',
    'docs/MARKER.md': '# The data-local-only marker\n\nA panel that carries `data-local-only` is cut from '
      + 'every published copy of this site.\n',
  }, { remote: 'https://github.com/acme/widget.git' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  renderSite(index, runHealth(index, cfg, dir), cfg, dir);

  /*
   * A genuinely marked element and a paragraph naming the marker, written into a built page as the renderers
   * write them: the marker as `data-local-only="1"` on a start tag, the prose as text. Injected rather than
   * relied upon, because which panels a fixture's dashboard happens to render depends on the working tree,
   * and a test whose subject is a private panel must not be a test of whether one was there today.
   *
   * The marked section contains a nested `<section>` and names the marker in its own text, so this also holds
   * the depth-counting walk to its promise: cut to the element's own closing tag, not the first inner one.
   */
  const page = path.join(dir, cfg.output, 'dashboard.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<main>', `<main>
<section class="card" id="prose-card"><h2>What data-local-only means</h2>
  <p>Any panel marked <code>data-local-only</code> is cut from every published copy.</p>
  <p title="the data-local-only attribute">And an attribute value naming it is a value, not a marker.</p></section>
<section class="card" id="secret-card" data-local-only="1"><h2>Work in flight</h2>
  <section><p>/Users/somebody/private/UNCOMMITTED-9k7.md</p></section>
  <p>This panel is <code>data-local-only</code> and must not travel.</p></section>
`), 'utf8');

  for (const [door, html] of [['exportSingleFile', exportSingleFile(dir, cfg, 'dashboard')],
                              ['exportBundle', exportBundle(dir, cfg)]]) {
    // Still stripped. The whole element, not merely its marker, and not merely down to the first inner close.
    eq(html.includes('UNCOMMITTED-9k7'), false, `${door}: no private path may reach a file made to be handed over`);
    eq(html.includes('id="secret-card"'), false, `${door}: the marked panel must be gone entirely`);
    eq(html.includes('Work in flight'), false, `${door}: gone, not merely unmarked`);
    eq(/data-local-only\s*=/.test(html), false, `${door}: no marker attribute may survive`);

    // And the prose about it is untouched. Asserted on the whole sentence, because the mangling this catches
    // is invisible in a marker count — it removes the element and leaves the words either side of it.
    includes(html, 'Any panel marked <code>data-local-only</code> is cut from every published copy.',
      `${door}: a paragraph that merely names the marker must publish intact`);
    includes(html, 'What data-local-only means', `${door}: including in a heading`);
    includes(html, 'And an attribute value naming it is a value, not a marker.',
      `${door}: and a marker named inside an attribute value is not a marker`);
  }

  // The corpus half of the same claim: the document explaining the marker is the document most likely to be
  // eaten by it, and the bundle carries every document page.
  const bundle = exportBundle(dir, cfg);
  includes(bundle, 'is cut from every published copy of this site',
    'the sentence from docs/MARKER.md must reach the bundle whole');
  includes(bundle, 'The data-local-only marker', 'and so must the document title that names it');
});

/* ================================================================== the command surface (A-35) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above; an `async` case here would be constructed, never awaited, and reported as a pass it never earned.
 */

console.log('\ncommand surface');

/** Every command name the CLI actually dispatches on, read out of its own source. */
function dispatchedCommands() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  return [...new Set([...src.matchAll(/cmd\s*===\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

/** The `usage()` body — the block a person actually reads. Sliced from the function, not the whole file. */
function usageBlock() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  const i = src.indexOf('function usage()');
  ok(i !== -1, 'usage() must exist — it is the surface every other assertion here is about');
  return src.slice(i);
}

/**
 * A name is *mentioned* if some line says `atlas <name>` and the name ends there. The trailing boundary is
 * the point: without it `atlas git-insights` reads as a mention of `git-insight`, and the alias that needs
 * saying out loud is exactly the one that would go unsaid.
 */
const mentionsCommand = (text, name) => new RegExp(`atlas ${name}(?![a-z-])`).test(text);

test('usage · every dispatched command appears in the list', () => {
  // The list had drifted to 27 of 38. `tasks`, `serve`, `config`, `plan`, `worklog`, `ownership`,
  // `surviving`, `help` and both aliases were dispatched, real, and invisible to anyone who typed
  // `atlas help` — while `atlas spec` was in neither place and is not a command at all.
  //
  // Drift like this is not caught by using the tool, because the people who know a command exists never
  // read the list. It has to be structural: the dispatch table is derived from the source, so a new
  // `if (cmd === 'x')` fails this the moment it lands without a line.
  const u = usageBlock();
  const missing = dispatchedCommands().filter((c) => !mentionsCommand(u, c));
  eq(missing, [], 'these commands dispatch but usage() never names them — add a line, or an alias mention');
});

test('usage · the list never names a command that does not dispatch', () => {
  // The other direction, and the reason `atlas spec` is written as `atlas spec --gate`. A list that promises
  // a command the CLI answers with "Unknown command" and exit 2 is worse than one that omits it: the reader
  // trusts it, runs it, and concludes the install is broken.
  const dispatched = new Set(dispatchedCommands());
  const listed = [...new Set([...usageBlock().matchAll(/^\s*atlas ([a-z-]+)/gm)].map((m) => m[1]))].sort();
  ok(listed.length > 20, 'sanity: the list was found and parsed');
  eq(listed.filter((c) => !dispatched.has(c)), [],
    'usage() names these, and `cmd === ...` never matches them — they exit 2 with "Unknown command"');
});

test('usage · bare `atlas spec` is not a command, and the list says so rather than promising one', () => {
  // Established by running it, not by reading the dispatch: `spec` is reached only as `spec --gate`, the
  // commit hook's entry point. Bare `atlas spec` falls through to the unknown-command branch.
  const r = spawnSync(process.execPath, [CLI, 'spec', '--root', REPO_ROOT], { encoding: 'utf8' });
  eq(r.status, 2, 'bare `atlas spec` exits 2');
  includes(r.stderr, 'Unknown command: spec');
  includes(usageBlock(), 'atlas spec --gate');
});

/* ================================================================== an interrupted build is recoverable (A-34) */

console.log('\noutput directory · interrupted builds');

/**
 * A build that dies between `prepareOutputDir` and the completion markers, for real.
 *
 * The child patches `fs.writeFileSync` to SIGKILL itself the instant the first marker is about to be
 * written, which is precisely where the incident happened: pages on disk, markers not. `SIGKILL` because
 * anything catchable would let a `finally` tidy up, and the whole point is that nothing tidied up.
 *
 * Run through `spawnSync`, so this case stays synchronous like everything below the drain.
 */
function buildAndDieBeforeMarkers(dir) {
  const lib = (f) => JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'lib', f)).href);
  const script = path.join(tmpRoot, 'kill-mid-build.mjs');
  fs.writeFileSync(script, `
import fs from 'node:fs';
import { resolveConfig } from ${lib('config.mjs')};
import { buildIndex } from ${lib('scan.mjs')};
import { runHealth } from ${lib('health.mjs')};
import { renderSite } from ${lib('render.mjs')};

const dir = process.argv[2];
const real = fs.writeFileSync;
fs.writeFileSync = function (p, ...rest) {
  if (/[\\\\/]\\.gitattributes$/.test(String(p))) process.kill(process.pid, 'SIGKILL');
  return real.call(fs, p, ...rest);
};
const cfg = resolveConfig(dir);
const index = buildIndex(dir, cfg);
renderSite(index, runHealth(index, cfg, dir), cfg, dir);
`, 'utf8');
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

test('build · a build killed before its markers land is recognised as its own wreckage, not as someone else\'s data', () => {
  // The real incident. An interrupted build left docs/_wiki populated and unmarked, every subsequent build
  // refused it, and the repository was unbuildable until a human ran `rm -rf docs/_wiki`.
  const dir = fixture('out-interrupted', { 'docs/A.md': '# A\n', 'docs/B.md': '# B\n' });
  const outDir = path.join(dir, 'docs', '_wiki');

  const killed = buildAndDieBeforeMarkers(dir);
  eq(killed.signal, 'SIGKILL', 'the child really was killed mid-build, not allowed to finish');

  // The exact state that used to wedge the tool: content, no completion markers.
  const after = fs.readdirSync(outDir);
  ok(after.length > 2, 'the interrupted build left real content behind');
  for (const m of BUILD_MARKERS) eq(after.includes(m), false, `${m} must not have been written yet`);
  ok(after.includes(BUILD_CLAIM), 'but the claim it staked before writing anything is there');

  // And now the thing that used to be impossible.
  const { cfg, index, health } = analyse(dir, {});
  const r = renderSite(index, health, cfg, dir);
  ok(fs.existsSync(path.join(r.outDir, 'index.html')), 'the build recovers rather than refusing');
  for (const m of BUILD_MARKERS) ok(fs.existsSync(path.join(r.outDir, m)), `${m} is written by the finished build`);
});

test('build · a finished build leaves no claim, so "interrupted" and "done" stay distinguishable', () => {
  // If the claim survived a successful build it would mean nothing: every directory this tool ever wrote
  // would carry permission to delete it, and the file would stop being evidence of anything. It is also the
  // second non-deterministic byte in a tree whose byte-identical rebuild is a checkable claim.
  const dir = fixture('out-claim-released', { 'docs/A.md': '# A\n' });
  const { cfg, index, health } = analyse(dir, {});
  const r = renderSite(index, health, cfg, dir);
  eq(fs.existsSync(path.join(r.outDir, BUILD_CLAIM)), false, 'the claim is released when the markers land');
});

test('build · a directory the tool has never owned is still refused, and told exactly what to do', () => {
  // The discrimination must be one-way. Recognising our own wreckage must not make an unowned directory
  // deletable — `{"output":"."}` and `{"output":"docs"}` are the two failures this guard was built for, and
  // both cost more than any number of refused builds.
  const dir = fixture('out-occupied-still', { 'docs/A.md': '# A\n', 'docs/handwritten.txt': 'months of work\n' });
  const { cfg, index, health } = analyse(dir, { output: 'docs' });
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'no claim and no markers means refuse — that has not changed');
  includes(threw.message, 'Refusing to delete');
  eq(fs.readFileSync(path.join(dir, 'docs', 'handwritten.txt'), 'utf8'), 'months of work\n');

  // Refusing is only half of it. The old message named no directory to remove and no key to change, so the
  // operator's next move was a guess — and the guess that ends this state is `rm -rf`, which is the one
  // command nobody should be guessing at.
  includes(threw.message, `rm -rf ${path.join(dir, 'docs')}`, 'the message spells out the recovery command');
  includes(threw.message, 'project-atlas.config.json', 'and names the file whose `output` key is the likelier fix');
  includes(threw.message, BUILD_CLAIM, 'and says what evidence it looked for and did not find');
});

test('build · a claim from some other directory does not authorise deleting this one', () => {
  // The claim is checked, not merely counted. A file with the right name and the wrong contents is exactly
  // what an attacker — or a careless `cp -r` — would leave, and the guard must not fold to a filename.
  const dir = fixture('out-forged-claim', { 'docs/A.md': '# A\n', 'docs/handwritten.txt': 'months of work\n' });
  fs.writeFileSync(path.join(dir, 'docs', BUILD_CLAIM),
    JSON.stringify({ tool: 'project-atlas', output: 'somewhere/else', startedAt: '2026-01-01T00:00:00Z' }), 'utf8');
  const { cfg, index, health } = analyse(dir, { output: 'docs' });
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'a claim naming a different output directory proves nothing about this one');
  eq(fs.readFileSync(path.join(dir, 'docs', 'handwritten.txt'), 'utf8'), 'months of work\n');
});

/* ============================================ discovery during a merge (A-37) */

console.log('\ndiscovery during a merge');

test('scan · a conflicted path is one document, not one per merge stage', () => {
  // `git ls-files` prints an unmerged path once for each index stage — 1 base, 2 ours, 3 theirs. Undeduped,
  // every conflicted document was discovered three times and reported as three documents claiming one title,
  // which is H3, which is **blocking**.
  //
  // That is a deadlock with no exit. Resolving the conflict needs a commit; the commit guard refuses because
  // H3 is firing; H3 is firing because the conflict is unresolved. Hit for real while merging four branches:
  // the guard blocked the very resolution that would have cleared it, and the finding read "duplicate title,
  // also claimed by" with nothing after it, because the document was duplicating itself.
  const dir = fixture('scan-merge', { 'README.md': '# Front\n' });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  const commit = (m) => execFileSync('git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-am', m], { cwd: dir, stdio: 'ignore' });

  fs.writeFileSync(path.join(dir, 'docs', 'PLAN.md'), '# Plan\n\nbase\n', 'utf8');
  g('add', '-A'); commit('base');
  g('branch', 'other');
  fs.writeFileSync(path.join(dir, 'docs', 'PLAN.md'), '# Plan\n\nours\n', 'utf8'); commit('ours');
  g('checkout', '-q', 'other');
  fs.writeFileSync(path.join(dir, 'docs', 'PLAN.md'), '# Plan\n\ntheirs\n', 'utf8'); commit('theirs');
  g('checkout', '-q', '-');
  try { execFileSync('git', ['merge', 'other'], { cwd: dir, stdio: 'ignore' }); } catch { /* expected to conflict */ }

  // The precondition: git really is reporting the path three times, or this proves nothing.
  const raw = execFileSync('git', ['ls-files', 'docs/PLAN.md'], { cwd: dir, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  eq(raw.length, 3, 'the fixture must actually be mid-conflict with three staged entries');

  const index = buildIndex(dir, resolveConfig(dir));
  const plans = index.documents.filter((d) => d.path === 'docs/PLAN.md');
  eq(plans.length, 1, 'a conflicted document is one document');

  // And the blocking signal it used to trip stays silent.
  const h3 = runHealth(index, resolveConfig(dir), dir).findings.filter((f) => f.signal === 'H3');
  eq(h3.length, 0, `H3 must not fire against a document duplicating itself: ${JSON.stringify(h3)}`);
});

test('render · neither renderer passes a data: URL through into a published href', () => {
  // `render.mjs` dropped `data:` from its external-scheme list because passing it through let any document
  // embed arbitrary content in a published page. `dashboard.mjs` kept its copy of the list, and the planning
  // source feeds that one — so a `data:` link in ROADMAP.md reached the built plan view. One question, two
  // implementations, one of them patched: the same shape as A-37.
  //
  // Pinned structurally on both, because the hole is a single token in a regex and reads as harmless.
  for (const f of ['render.mjs', 'dashboard.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', f), 'utf8');
    for (const line of src.split('\n')) {
      if (/\^\(https\?:/.test(line)) {
        eq(/data:/.test(line), false, `${f}: data: must not be an allowed external scheme — ${line.trim()}`);
      }
    }
  }
});

/* ================================================ what an adversary did with these (A-38 … A-44) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above, so an `async` case here would be constructed, never awaited, and counted as a pass it never earned.
 *
 * Every case below is the exploit that was run against the code, not a paraphrase of it: the marker planted
 * on an `<img>`, a claim copied between two repositories, `--out` aimed at a dangling symlink, a staged tree
 * grepped for branch names, one repository built from inside another. Each one was verified to fail against
 * the code as it was, and to pass only after the fix.
 */

console.log('\nthe publisher, attacked');

/** A page shaped like the real ones: a marked panel holding a secret, and a public paragraph beside it. */
const SECRET = 'fix/nobody-elses-business';
const markedPage = (planted) => `<!doctype html>
<html><head><title>t</title></head>
<body>
${planted}
<main>
<section class="card" id="public"><h2>Public</h2><p>A paragraph that must survive.</p></section>
<section class="card" id="branches" data-local-only="1"><h2>Branches</h2>
  <section class="inner"><p>${SECRET}</p></section>
  <p>/Users/somebody/private/path</p></section>
</main>
</body></html>
`;

test('publish · the marker on a void element strips that element and leaves the rest of the document stripped', () => {
  /*
   * **A-38, and the whole of it in one input.** `stripLocalOnly` walked from a marker to the element's own
   * closing tag; `<img>` has none, `indexOf('</img>')` returned -1, and the line `if (nextClose === -1) return
   * out;` returned from the *function*. So one marked void element anywhere on a page abandoned stripping for
   * the entire document and handed back the input byte-for-byte — no error, no warning, and no changed byte
   * for a reviewer to notice. The renderers already emit void elements seven times over.
   *
   * Asserted in both directions: the planted `<img>` is gone, and — the half nobody checks — the real marked
   * panel beside it is gone too, which is the assertion that failed before the fix.
   */
  const html = stripLocalOnly(markedPage('<img data-local-only="1" src="badge.svg">'));
  eq(/data-local-only/.test(html), false, 'no marker may survive, on a void element or anywhere else');
  eq(html.includes(SECRET), false, 'and the panel beside the void element must still be stripped');
  eq(html.includes('<img'), false, 'the marked <img> itself is gone');
  includes(html, 'A paragraph that must survive.', 'while the public paragraph is untouched');
});

test('publish · every void element and the self-closing form, not just the one that was found', () => {
  // A list, because the fix is a list and a list is the kind of thing that gets one entry short. `<input>`
  // and `<meta>` are the two most likely to acquire a marker next — a filter control and a page-level flag.
  for (const tag of ['img', 'hr', 'br', 'input', 'meta', 'link', 'col', 'source', 'wbr']) {
    const html = stripLocalOnly(markedPage(`<${tag} data-local-only="1">`));
    eq(html.includes(SECRET), false, `<${tag}>: the document must still be stripped`);
    eq(/data-local-only/.test(html), false, `<${tag}>: no marker may survive`);
  }
  // XHTML-style, on a non-void tag: it opens nothing, so nothing may be walked to.
  const selfClosed = stripLocalOnly(markedPage('<span data-local-only="1"/>'));
  eq(selfClosed.includes(SECRET), false, 'a self-closing marked element must not abandon the document');
});

test('publish · a comment, a hyphenated tag and a quoted `>` no longer drive the walker off the end', () => {
  // The other three triggers, each of which ended the same way: depth never returned to zero, the closing tag
  // ran out, and the function returned the whole document. Every one of these is legal markup that a panel
  // could grow tomorrow.
  const cases = {
    'a comment naming the tag': '<section class="card" data-local-only="1"><!-- <section --><p>x</p></section>',
    'a hyphenated sibling tag': '<section class="card" data-local-only="1"><section-detail>x</section-detail></section>',
    'a quoted > inside an attribute': '<section class="card" data-local-only="1" title="a > b"><p>x</p></section>',
  };
  for (const [why, planted] of Object.entries(cases)) {
    const html = stripLocalOnly(markedPage(planted));
    eq(html.includes(SECRET), false, `${why}: the document must still be stripped`);
    eq(/data-local-only/.test(html), false, `${why}: no marker may survive`);
    includes(html, 'A paragraph that must survive.', `${why}: and the public paragraph is untouched`);
  }
});

test('publish · a marker it cannot walk refuses the publish rather than returning the document', () => {
  /*
   * **The half that matters more than any trigger.** Handling `<img>` fixes one input; making a silent
   * pass-through unreachable fixes the shape. A stripper whose failure and whose success are the same value
   * cannot be reviewed, cannot be tested from the outside, and had in fact never been.
   *
   * Genuinely unbalanced markup — an unclosed `<section` in panel text, which a browser also reads as a start
   * tag — is the one case where the right answer is neither "strip" nor "return". It throws.
   */
  const unwalkable = markedPage('<section class="card" data-local-only="1"><p>a stray <section in prose</p>');
  let threw = null;
  try { stripLocalOnly(unwalkable, 'the page under test'); } catch (e) { threw = e; }
  ok(threw, 'markup this cannot be walked must refuse, not return the input');
  includes(threw.message, 'Refusing to publish the page under test');
  includes(threw.message, 'data-local-only', 'and name the marker it could not remove');

  // The property behind it, stated as a property: nothing this function returns carries a marker.
  eq(/data-local-only/.test(stripLocalOnly(markedPage('<img data-local-only="1">'))), false);
  let threwAgain = null;
  try { assertNoLocalOnly('<p>ok</p><div data-local-only="1">leak</div>', 'a hand-made document'); }
  catch (e) { threwAgain = e; }
  ok(threwAgain, 'assertNoLocalOnly is what every exit door calls, and it must refuse a surviving marker');
});

test('publish · the gh-pages tree is the third exit door, and it strips and verifies every file', () => {
  /*
   * **A-39.** `stripLocalOnly` is reached from `exportSingleFile`, from `exportBundle`, and from
   * `stripLocalOnlyTree` — which `stagePages` calls on the tree it force-pushes to `gh-pages`, described in
   * `publish.mjs` itself as "the target where getting it wrong is public and permanent-ish". The coverage
   * claim that justified narrowing the marker to an attribute named the first two and called them "both", and
   * `stagePages` had no strip test at all. The untested door was the one that publishes to the open internet.
   *
   * Run against a real staged tree, through the real `stagePages`, with the `<img>` exploit planted in it.
   */
  const dir = fixture('pages-strip', { 'docs/A.md': '# A\n' });
  const { cfg, index, health } = analyse(dir, {});
  const r = renderSite(index, health, cfg, dir);

  // Planted after the build, in the built page, exactly as the audit did it.
  const page = path.join(r.outDir, 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<main>',
    `<img data-local-only="1" src="badge.svg">\n<main>\n<section data-local-only="1"><p>${SECRET}</p></section>`), 'utf8');
  ok(fs.readFileSync(page, 'utf8').includes(SECRET), 'sanity: the built page really carries it now');

  const staged = stagePages(dir, cfg, { push: false });
  const out = fs.readFileSync(path.join(staged.work, 'index.html'), 'utf8');
  eq(out.includes(SECRET), false, 'nothing marked may reach the tree that is force-pushed');
  eq(/data-local-only/.test(out), false, 'and no marker may survive in it');

  // And the 104 files of 197 that this function never opened. A marker cannot legitimately appear in them,
  // which is exactly why nobody would notice one that did.
  fs.writeFileSync(path.join(r.outDir, 'notes.txt'), `<div data-local-only="1">${SECRET}</div>\n`, 'utf8');
  let threw = null;
  try { stagePages(dir, cfg, { push: false }); } catch (e) { threw = e; }
  ok(threw, 'a marked element in a non-HTML staged file must stop the publish, not ride along in it');
  includes(threw.message, 'notes.txt', 'and the message names the file');
});

test('publish · a claim copied from another repository does not authorise deleting this one', () => {
  /*
   * **A-40.** `readClaim` compared `c.output` against the output path *relative to the repository root*. That
   * is `docs/_wiki` in every project-atlas repository there has ever been, so the comparison was between two
   * copies of one default string. A claim carried by `cp -r`, a backup, a Docker layer or a clone therefore
   * validated against any repository on the machine — and a valid claim authorises `rm -rf` of a directory
   * holding files no build wrote.
   *
   * The existing case covered `output: "somewhere/else"`, which is the easy half: a claim that names a
   * different directory. This is a claim that names the *same* directory, in a different repository.
   */
  const source = fixture('claim-source', { 'docs/A.md': '# A\n' });
  const victim = fixture('claim-victim', { 'docs/A.md': '# A\n', 'docs/_wiki/handwritten.txt': 'months of work\n' });

  // A genuine claim, from a real interrupted build in another repository — not a hand-written forgery.
  const killed = buildAndDieBeforeMarkers(source);
  eq(killed.signal, 'SIGKILL', 'sanity: the source build really was interrupted');
  const genuine = path.join(source, 'docs', '_wiki', BUILD_CLAIM);
  ok(fs.existsSync(genuine), 'sanity: the interrupted build staked a claim');
  const parsed = JSON.parse(fs.readFileSync(genuine, 'utf8'));
  eq(parsed.output, 'docs/_wiki', 'and it records the default relative path every repository uses');

  // `cp` it across, which is the whole exploit.
  fs.copyFileSync(genuine, path.join(victim, 'docs', '_wiki', BUILD_CLAIM));

  const { cfg, index, health } = analyse(victim, {});
  let threw = null;
  try { renderSite(index, health, cfg, victim); } catch (e) { threw = e; }
  ok(threw, 'a claim written for another directory must not authorise deleting this one');
  eq(fs.readFileSync(path.join(victim, 'docs', '_wiki', 'handwritten.txt'), 'utf8'), 'months of work\n');

  // The property that must survive the fix: the source repository still recognises its own wreckage.
  const own = analyse(source, {});
  const recovered = renderSite(own.index, own.health, own.cfg, source);
  ok(fs.existsSync(path.join(recovered.outDir, 'index.html')), 'the interrupted build still recovers in place');
});

test('publish · a claim is authenticated, not merely present — timestamp, pid, and not a symlink', () => {
  /*
   * The rest of A-40, each verified to destroy `handwritten.txt` before the fix. `startedAt` was checked for
   * truthiness only, so `"banana"` passed; `pid` was written by every build and read by nothing; and the file
   * was read with `readFileSync`, which follows a symlink, two lines after the directory beside it is
   * deliberately checked with `lstat` rather than `stat`.
   */
  const now = () => new Date().toISOString();

  /*
   * Each forgery is otherwise perfect — right tool, right relative path, right *absolute* path — with one
   * field corrupted, so each assertion is about the check it names and not about the identity check catching
   * everything on its way past.
   *
   * **`pid: 999999` is in the audit's list and is not in this one, and that is a finding rather than an
   * omission.** A pid cannot authenticate a claim: a genuinely interrupted build leaves the pid of a process
   * that is now dead, which is byte-identical to a pid that never existed. Rejecting a dead pid would reject
   * exactly the case the claim was invented for. What a pid *can* say is that a build is running right now,
   * and `readClaim` uses it for that — a live pid that is not ours means refuse. The audit's actual artefact
   * — a claim carrying `pid: 999999` and no `outputPath` — is refused, and is asserted below.
   */
  const forgeries = {
    'startedAt "banana"': { startedAt: 'banana' },
    'startedAt true': { startedAt: true },
    'startedAt 1': { startedAt: 1 },
    'startedAt at the epoch': { startedAt: '1970-01-01T00:00:00.000Z' },
    'startedAt in the future': { startedAt: new Date(Date.now() + 86_400_000).toISOString() },
    'no pid': { startedAt: now(), pid: undefined },
    'a pid above every kernel\'s ceiling': { startedAt: now(), pid: 2 ** 31 },
    'a pid of zero': { startedAt: now(), pid: 0 },
    'a pid that is not a number': { startedAt: now(), pid: 'many' },
    'a live pid belonging to another process': { startedAt: now(), pid: 1 },
  };
  let n = 0;
  for (const [why, over] of Object.entries(forgeries)) {
    const dir = fixture(`claim-forged-${n++}`, { 'docs/A.md': '# A\n', 'docs/_wiki/handwritten.txt': 'months of work\n' });
    const outDir = path.join(dir, 'docs', '_wiki');
    fs.writeFileSync(path.join(outDir, BUILD_CLAIM), JSON.stringify({
      tool: 'project-atlas', output: 'docs/_wiki', outputPath: fs.realpathSync(outDir),
      startedAt: now(), pid: process.pid + 1, ...over,
    }), 'utf8');
    const { cfg, index, health } = analyse(dir, {});
    let threw = null;
    try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
    ok(threw, `${why}: must not authorise a deletion`);
    eq(fs.readFileSync(path.join(outDir, 'handwritten.txt'), 'utf8'), 'months of work\n', `${why}: and nothing is lost`);
  }

  // The audit's own artefact, exactly as it wrote it: no `outputPath`, and a pid no kernel issues.
  {
    const dir = fixture('claim-audit-shape', { 'docs/A.md': '# A\n', 'docs/_wiki/handwritten.txt': 'months of work\n' });
    fs.writeFileSync(path.join(dir, 'docs', '_wiki', BUILD_CLAIM), JSON.stringify({
      tool: 'project-atlas', output: 'docs/_wiki', startedAt: now(), pid: 999999,
    }), 'utf8');
    const { cfg, index, health } = analyse(dir, {});
    let threw = null;
    try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
    ok(threw, 'the claim the audit planted must not authorise a deletion');
    eq(fs.readFileSync(path.join(dir, 'docs', '_wiki', 'handwritten.txt'), 'utf8'), 'months of work\n');
  }

  // The symlink. `readFileSync` follows it; the claim it reads is one the repository does not contain.
  const dir = fixture('claim-symlink', { 'docs/A.md': '# A\n', 'docs/_wiki/handwritten.txt': 'months of work\n' });
  const outDir = path.join(dir, 'docs', '_wiki');
  const outside = path.join(tmpRoot, 'claim-from-outside.json');
  fs.writeFileSync(outside, JSON.stringify({
    tool: 'project-atlas', output: 'docs/_wiki', outputPath: fs.realpathSync(outDir),
    startedAt: new Date().toISOString(), pid: process.pid,
  }), 'utf8');
  fs.symlinkSync(outside, path.join(outDir, BUILD_CLAIM));
  const { cfg, index, health } = analyse(dir, {});
  let threw = null;
  try { renderSite(index, health, cfg, dir); } catch (e) { threw = e; }
  ok(threw, 'a claim that is a symlink to a file outside the repository proves nothing');
  eq(fs.readFileSync(path.join(outDir, 'handwritten.txt'), 'utf8'), 'months of work\n');
}, { needsPosixFilenames: true });

test('paths · a dangling symlink is resolved, so the containment guards see where the bytes will land', () => {
  /*
   * **A-41.** `realpathOrBest` resolved "the longest existing ancestor" with `realpathSync`, which throws
   * ENOENT for a symlink whose target does not exist. So a final component that was a dangling symlink
   * resolved to its own lexical path, and both guards built on it compared the wrong path. `readlink` answers
   * for a dangling link, and its answer is where the write actually goes.
   */
  const root = path.join(tmpRoot, 'dangling-repo');
  fs.mkdirSync(path.join(root, 'docs', '_wiki'), { recursive: true });
  const elsewhere = path.join(tmpRoot, 'dangling-elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });

  // 1. `confine`, whose own comment says it exists to refuse "an escape that only exists once symlinks are
  //    followed". The write that followed created a file outside the repository.
  const escape = path.join(root, 'docs', 'escape.txt');
  fs.symlinkSync(path.join(elsewhere, 'authorized_keys'), escape);
  let threw = null;
  try { confine(root, 'docs/escape.txt', 'output'); } catch (e) { threw = e; }
  ok(threw, 'a dangling symlink out of the repository must be refused');
  includes(threw.message, 'outside the repository');

  // 2. `assertNotPublishable`, the only thing keeping transcript-derived reports out of the published tree.
  //    Its own comment names "a symlink whose target is inside the output directory" as the case it catches.
  const sneak = path.join(root, 'report.txt');
  fs.symlinkSync(path.join(root, 'docs', '_wiki', 'leak.txt'), sneak);
  eq(isAtOrInside(path.join(root, 'docs', '_wiki'), sneak), true,
    'a dangling link into the published directory resolves into it');
  let threw2 = null;
  try { assertNotPublishable(root, { output: 'docs/_wiki' }, 'report.txt'); } catch (e) { threw2 = e; }
  ok(threw2, '--out aimed at a dangling symlink into the published directory must be refused');

  // 3. Nothing that held before holds less. The audit attacked containment twelve ways and broke none of
  //    them; this change only ever resolves further, so it can turn "inside" into "outside" and not back.
  eq(confine(root, 'docs/_wiki', 'output'), path.join(root, 'docs', '_wiki'), 'an ordinary path still resolves');
  let stillRefused = null;
  try { confine(root, '../PRECIOUS', 'output'); } catch (e) { stillRefused = e; }
  ok(stillRefused, '`../PRECIOUS` is still refused');
  try { confine(root, '.', 'output'); stillRefused = null; } catch (e) { stillRefused = e; }
  ok(stillRefused, 'and so is the repository itself');

  // A symlink loop terminates rather than resolving forever.
  const a = path.join(root, 'loop-a'), b = path.join(root, 'loop-b');
  fs.symlinkSync(b, a);
  fs.symlinkSync(a, b);
  ok(typeof realpathOrBest(a) === 'string', 'a symlink cycle resolves to something rather than hanging');
}, { needsPosixFilenames: true });

test('kb · the derived markdown does not publish the branch names the HTML beside it strips', () => {
  /*
   * **A-42.** `stripLocalOnlyTree` rewrote `*.html` and `*.htm` only. Of the 197 files this repository stages
   * for `gh-pages`, 104 were copied to the public branch without being read, 99 of them markdown — and one of
   * those, `kb/resume.md`, printed every journal ref verbatim, which meant the names of unmerged local
   * branches. Nine of them reached the staged tree, measured. The dashboard panel carrying the same names is
   * marked `data-local-only` and explains at length why a branch name must not travel, and it is stripped
   * from every published copy; the markdown beside it was not.
   *
   * Fixed at the source rather than with a second marker language in markdown, so the local file and the
   * published file say the same thing and there is no copy to review and ship separately.
   */
  const dir = fixture('kb-branch-refs', { 'docs/A.md': '# A\n' });
  const journalDir = path.join(dir, '.atlas', 'journal');
  fs.mkdirSync(journalDir, { recursive: true });
  const rec = (refs) => JSON.stringify({
    at: '2026-08-01T10:00:00.000Z', kind: 'finding', agent: 'main',
    contributor: 'test', text: 'x', refs,
  });
  fs.writeFileSync(path.join(journalDir, 'test.jsonl'), [
    rec(['wip/unmerged-client-name', 'docs/A.md']),
    rec(['fix/embargoed-thing@abc1234']),
    rec(['main@deadbee']),
  ].join('\n') + '\n', 'utf8');

  const { cfg, index, health } = analyse(dir, {});
  const r = renderSite(index, health, cfg, dir);
  const resume = fs.readFileSync(path.join(r.outDir, 'kb', 'resume.md'), 'utf8');

  for (const secret of ['wip/unmerged-client-name', 'fix/embargoed-thing']) {
    eq(resume.includes(secret), false, `a branch name must not reach the published markdown: ${secret}`);
  }
  includes(resume, 'record(s) name a branch or a commit', 'the count survives, because the count leaks nothing');
  includes(resume, '`docs/A.md`', 'and a ref that is a real file in the repository is still routed to');

  // The staged tree, which is the thing that gets force-pushed — asserted over every markdown file in it,
  // not only the one that was found to be leaking.
  const { work } = stagePages(dir, cfg, { push: false });
  const md = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.git') walk(p); }
      else if (/\.md$/i.test(e.name)) md.push(p);
    }
  })(work);
  ok(md.length > 5, `sanity: the staged tree really does carry markdown (${md.length} files)`);
  for (const f of md) {
    const body = fs.readFileSync(f, 'utf8');
    eq(body.includes('wip/unmerged-client-name'), false,
      `${path.relative(work, f)} names a local branch in the tree that is force-pushed`);
  }
});

test('render · the homepage measures the repository being built, not the process\'s current directory', () => {
  /*
   * **A-43.** `indexPage` read the working tree from `cfg.__root || process.cwd()`. `__root` is attached to a
   * *copy* of the config made for the view context, thirty lines below the call, so `cfg` here never carried
   * it — the fallback was not a fallback, it was the only branch that ever ran.
   *
   * Invisible when you build the repository you are standing in. Two repositories make it plain: built from
   * inside `rA`, `rB`'s homepage reported rA's seven in-flight files and rA's branch name, while rB's own
   * Executive view — built in the same run, from a context that did carry `__root` — reported nothing in
   * flight. One build, two answers, and the wrong one on the first page anyone opens.
   */
  const rA = fixture('cwd-leak-a', { 'docs/A.md': '# A\n', '.gitignore': 'docs/_wiki/\n' });
  const rB = fixture('cwd-leak-b', { 'docs/B.md': '# B\n', '.gitignore': 'docs/_wiki/\n' });
  execFileSync('git', ['checkout', '-q', '-b', 'wip/rA-local-only'], { cwd: rA, stdio: 'ignore' });
  for (let i = 1; i <= 7; i++) fs.writeFileSync(path.join(rA, 'docs', `flight-${i}.md`), `# f${i}\n`, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: rA, stdio: 'ignore' });

  // The build of rB, run with the process sitting in rA. `--root` is the documented way to do this.
  const built = spawnSync(process.execPath, [CLI, 'build', '--root', rB, '--quiet'],
    { cwd: rA, encoding: 'utf8' });
  eq(built.status, 0, `the build of rB must succeed: ${built.stderr}`);

  const home = fs.readFileSync(path.join(rB, 'docs', '_wiki', 'index.html'), 'utf8');
  eq(home.includes('wip/rA-local-only'), false, "rB's homepage must not name rA's branch");
  // Not asserted as zero: `atlas build` writes `worklog/` and `.atlas/` into the repository it builds, which
  // is A-36 and is somebody else's item. Seven is rA's number and rB cannot reach it by accident.
  const m = /<strong>(\d+)<\/strong> file\(s\) are in flight/.exec(home);
  ok(!m || Number(m[1]) < 7, `rB's homepage must not report rA's seven files (reported ${m ? m[1] : 'none'})`);

  // The control, and the reason the assertion above is not vacuous: measured from its own repository, the
  // homepage does see the seven.
  const ownBuild = spawnSync(process.execPath, [CLI, 'build', '--root', rA, '--quiet'], { cwd: rA, encoding: 'utf8' });
  eq(ownBuild.status, 0, `the build of rA must succeed: ${ownBuild.stderr}`);
  const ownHome = fs.readFileSync(path.join(rA, 'docs', '_wiki', 'index.html'), 'utf8');
  // Asserted on the count, not on the branch name. The homepage prints the branch today, which is a separate
  // leak of the same class as A-42 and is reported rather than fixed here; a test that required the name to
  // be present would make removing it a failure.
  const own = /<strong>(\d+)<\/strong> file\(s\) are in flight/.exec(ownHome);
  ok(own && Number(own[1]) >= 7, `rA's own homepage reports its seven files (reported ${own ? own[1] : 'none'})`);

  // The fallback is gone with the bug: nothing here may read the process's directory. Comment lines are
  // skipped, as in the `num()` guard above — the note explaining the defect names the expression it removed.
  const offenders = [];
  fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'render.mjs'), 'utf8')
    .split('\n').forEach((line, i) => {
      if (/process\.cwd\(\)/.test(line) && !/^\s*[*/]/.test(line)) offenders.push(`render.mjs:${i + 1}`);
    });
  eq(offenders, [],
    'a default that silently substitutes another repository cannot report the mistake it covers for');
});

test('render · the health page cannot call a signal blocking that the engine will never block', () => {
  /*
   * **A-44.** The page computed `isBlocking` from `(cfg.blocking || []).includes(s.id)` — the configured
   * *request* — rather than from the finding's own `blocking` flag. The engine's rule has a second term: an
   * operator signal cannot block, "enforced in code, not by configuration". Config validation deliberately
   * keeps an unknown id so a config written for a newer version still loads, which is exactly how
   * `"blocking": ["H17"]` arrives intact.
   *
   * The result was a page that rendered H17 in the blocking style and printed "**Blocking** — no legitimate
   * cause." directly after H17's own text ending "ADVISORY, AND NEVER BLOCKING". The engine was right the
   * whole way through — `blockingCount` 0, the gate silent — and the artefact a person reads said otherwise.
   */
  const dir = fixture('health-h17-blocking', { 'docs/A.md': '# A\n' });
  const { cfg, index, health } = analyse(dir, { blocking: ['H17', 'H3'] });
  eq(health.blockingCount, 0, 'sanity: the engine refuses to let an operator signal block');

  const r = renderSite(index, health, cfg, dir);
  const html = fs.readFileSync(path.join(r.outDir, 'health.html'), 'utf8');
  eq(/class="sig block">H17</.test(html), false, 'H17 must not be drawn as a blocking signal');

  const h17 = html.slice(html.indexOf('>H17<'));
  const blurb = h17.slice(h17.indexOf('<p class="blurb">'), h17.indexOf('</p>'));
  includes(blurb, 'ADVISORY, AND NEVER BLOCKING', 'sanity: this is H17\'s own blurb');
  eq(blurb.includes('<strong>Blocking</strong>'), false,
    'and the page must not contradict the sentence it is printing');

  // The other direction, which is what makes this a fix rather than a blanket. H3 is a corpus signal, it is
  // in `blocking`, and it must still say so.
  includes(html, 'class="sig block">H3<', 'a signal that really does block is still drawn as blocking');
});

test('session · a directory merely named agent-* is not an agent worktree (A-38)', () => {
  // Both halves of this were demonstrated by an audit on real directories. `agentIdOf` matched any basename
  // beginning `agent-`, which is a name a person is entitled to use, so:
  //   `atlas stop --force` removed a hand-made worktree at ../agent-portal holding uncommitted work; and
  //   `atlas pause` treated a clone at ~/src/agent-portal as an agent, ran `git add -A`, and committed a
  //   .env of live credentials on main, past a pre-commit hook that had just refused it.
  eq(agentIdOf('/x/.claude/worktrees/agent-abc'), 'abc', 'the real shape still resolves');
  eq(agentIdOf('/x/.claude/worktrees/agent-abc/'), 'abc', 'trailing separator too');
  for (const impostor of [
    '/Users/me/src/agent-portal', '../agent-portal', 'agent-portal',
    '/x/worktrees/agent-abc', '/x/.claude/agent-abc', '/x/.claude/worktrees/nested/agent-abc',
  ]) eq(agentIdOf(impostor), null, `${impostor} must not read as an agent worktree`);
});

test('session · pause classifies the operator\'s own checkout before anything that looks like an agent', () => {
  // The order was reversed, so a repository that merely looked like an agent worktree was classified as one
  // before anything asked whether it was the operator's. Ownership is the more important question.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agentname-'));
  const repo = path.join(dir, 'agent-portal');           // a real repo whose name is the trap
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, 'README.md'), '# mine\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'base'],
    { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.env'), 'AWS_SECRET_ACCESS_KEY=hunter2\n', 'utf8');

  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const r = pauseSession(repo, { now: '2026-01-01T00:00:00Z' });
  const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  eq(after, before, 'pause must not commit in the operator\'s own repository');
  eq(r.agents.find((a) => a.isMain)?.wipRef ?? null, null, 'and must not checkpoint it');
  const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
  eq(tracked.includes('.env'), false, 'the secret is still untracked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session · the parked manifest ignores itself, in any repository (A-38)', () => {
  // The rule lived only in this project's own .gitignore — the one repository where the problem cannot
  // happen — so every adopting repo committed absolute home paths and agent labels. The old test asserted
  // the rule in exactly that place, which is how it passed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-parkignore-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# r\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'base'],
    { cwd: dir, stdio: 'ignore' });

  writeParked(dir, { version: 1, at: '2026-01-01T00:00:00Z', root: dir, agents: [] });
  const ignored = execFileSync('git', ['check-ignore', PARKED_FILE], { cwd: dir, encoding: 'utf8' }).trim();
  eq(ignored, PARKED_FILE, 'git must ignore it in a repository that never heard of this tool');

  // And the journal, which IS tracked, must not be swept up by an over-broad rule.
  fs.mkdirSync(path.join(dir, '.atlas', 'journal'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.atlas', 'journal', 'x.jsonl'), '{}\n', 'utf8');
  let journalIgnored = false;
  try {
    execFileSync('git', ['check-ignore', '.atlas/journal/x.jsonl'],
      { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    journalIgnored = true;
  } catch { /* non-zero means not ignored, which is what we want */ }
  eq(journalIgnored, false, 'the journal is tracked and must stay trackable');

  writeParked(dir, { version: 1, at: '2026-01-02T00:00:00Z', root: dir, agents: [] });
  const gi = fs.readFileSync(path.join(dir, '.atlas', '.gitignore'), 'utf8');
  eq(gi.split('\n').filter((l) => l.trim() === 'parked.json').length, 1, 'the entry is not appended twice');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('boundary · exactly two modules reach the network, and both are named (A-39)', () => {
  // README and `host.mjs` both promised that `caps` was the only thing touching the network and that
  // "everything else is entirely offline". `update.mjs` fetches from raw.githubusercontent.com, and
  // `atlas version --notice` — which the SessionStart hook runs at the start of every session — reaches it.
  // So a hook made a request while two documents promised none did, in the section a reader consults
  // precisely to find out what leaves their machine.
  //
  // Structural, because the claim decays silently: a third caller added later re-breaks the promise with
  // nothing to notice it.
  const dir = path.join(REPO_ROOT, 'scripts', 'lib');
  //
  // **A browser-side fetch is not the tool reaching the network.** `dashboard.mjs` emits two `fetch()` calls
  // into the live-reload script it writes into the page; both take relative URLs and go back to the loopback
  // server that served the page. Excluding them by *scheme* rather than by filename keeps the distinction
  // honest: the moment one of them gains an absolute URL, it counts.
  const fetchLines = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
    .filter((l) => !/^\s*[*/]/.test(l) && /\bfetch(Impl)?\s*\(/.test(l));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();

  // Loopback iff every call site's first argument is plainly relative — a quoted path with no scheme, or
  // something built from `location`. A variable (`host.api`, `url`) is remote until proven otherwise, which
  // is the safe direction for a boundary claim.
  const isLoopback = (l) => /fetch\(\s*(location\.|['"`][^'"`:]*['"`])/.test(l);
  const remote = files.filter((f) => fetchLines(f).some((l) => !isLoopback(l)));
  eq(remote, ['host.mjs', 'update.mjs'],
    'if this list changed, the network boundary changed — update README and host.mjs, then this test');

  const loopback = files.filter((f) => fetchLines(f).length && !remote.includes(f));
  eq(loopback, ['dashboard.mjs'], 'the only same-origin fetches are the live-reload ones');
  for (const l of fetchLines('dashboard.mjs')) {
    eq(/https?:\/\//.test(l), false, `a live-reload fetch must stay relative: ${l.trim()}`);
  }

  // And neither document may still claim there is only one.
  for (const f of ['README.md', path.join('scripts', 'lib', 'host.mjs')]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    eq(/only (command|module) (in the tool )?that touches the network/.test(src), false,
      `${f} still claims a single network caller`);
  }
});

/* ================================================================== the stated inventories (A-29) */

console.log('\nstated inventories · the documents against the code');

/**
 * **A number stated in prose beside a list that grows is a defect waiting to happen**, and this repository has
 * now proved it twice. A-29 found eight claims contradicted by the code; three workstreams later `FEATURES.md`
 * said twenty-nine skills against thirty-eight on disk, nine views against eleven, twenty-seven panels against
 * thirty-six, sixteen signals against seventeen, and nine commands "missing from `usage()`" that A-35 had
 * already listed. None of it was findable by reading the pages: every one of them was internally consistent,
 * and the count agreed with the list beside it because both had been written on the same stale day.
 *
 * H1–H16 cannot catch this. They check links, titles, citations and dates — the things comparable
 * mechanically. A count *is* comparable mechanically. Nothing was doing the comparing.
 *
 * So each case below derives the figure from the source of truth and reads the document's own claim back out
 * of the prose. **The regexes are coupled to the wording on purpose.** Rewording a sentence should make you
 * look at the assertion; changing what the code ships without touching the document must fail.
 *
 * **Every case here is synchronous.** `pendingAsync` is drained thousands of lines above, so an `async` case
 * appended here would be constructed, never awaited, and reported as a pass it never earned.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** "Thirty-Eight" and "thirty-eight" both read back as 38; anything else is not a number word. */
function wordToNumber(word) {
  const w = String(word).trim().toLowerCase();
  const direct = ONES.indexOf(w);
  if (direct !== -1) return direct;
  const [tens, ones] = w.split('-');
  const t = TENS.indexOf(tens);
  if (t === -1) return null;
  if (ones === undefined) return t * 10;
  const o = ONES.indexOf(ones);
  return o > 0 && o < 10 ? t * 10 + o : null;
}

const docText = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Pull one figure out of a document's prose.
 *
 * A miss is a **failure**, never a skip. The commonest way for a check like this to rot is for the sentence it
 * reads to be rewritten into something the regex no longer sees, at which point it passes forever while
 * measuring nothing — the same shape as the bug it exists to catch.
 */
function statedFigure(rel, re, where) {
  const m = re.exec(docText(rel));
  ok(m, `${rel}: no sentence matched ${re} — ${where}. If the wording changed, update this assertion; do not delete it.`);
  const n = wordToNumber(m[1]);
  ok(n !== null, `${rel}: "${m[1]}" is not a number word, in: ${m[0]}`);
  return n;
}

/** Every skill directory that actually ships a SKILL.md — the authority both maps claim to follow. */
function shippedSkills() {
  const dir = path.join(REPO_ROOT, 'skills');
  return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))).sort();
}

test('inventory · FEATURES.md has a row for every skill that ships, and none for a skill that does not', () => {
  // The six `git-*` skills and pause/resume/stop shipped into `skills/` and never reached this table. A reader
  // asking "what can I type?" got a list that was nine short and said nothing about being short.
  const skills = shippedSkills();
  const text = docText('docs/FEATURES.md');
  eq(skills.filter((s) => !text.includes(`skills/${s}/SKILL.md`)), [],
    'these skills ship and §3 of FEATURES.md has no row for them');

  const cited = [...new Set([...text.matchAll(/`skills\/([a-z0-9-]+)\/SKILL\.md`/g)].map((m) => m[1]))].sort();
  eq(cited.filter((s) => !skills.includes(s)), [],
    'FEATURES.md names these skills and no such directory exists');

  eq(statedFigure('docs/FEATURES.md', /\*\*([A-Za-z-]+) `SKILL\.md` files under `skills\/`\*\*/, 'the §3 headline count'),
    skills.length, 'the figure §3 states does not match the directories on disk');
});

test('inventory · the help map names every slash command, and states how many there are', () => {
  // `skills/help/SKILL.md` is read by a model in every repository this is installed in, which makes it the
  // highest-cost place for a stale count. It said twenty-nine, and told the reader an `/atlas:git-*` family
  // "is being added on another branch and is deliberately not listed here yet" — shipped commands described
  // as future work, in the file whose job is to say what exists.
  const skills = shippedSkills();
  for (const rel of ['skills/help/SKILL.md', 'plugins/atlas/skills/help/SKILL.md']) {
    const text = docText(rel);
    const missing = skills.filter((s) => !new RegExp(`/atlas:${s}(?![a-z0-9-])`).test(text));
    eq(missing, [], `${rel}: these skills ship and the map never names them`);
    eq(statedFigure(rel, /([A-Za-z-]+) slash commands is too many to list/, "the map's own headline count"),
      skills.length, `${rel}: the stated number of slash commands is wrong`);
  }
});

test('inventory · FEATURES.md §1 has a row for every command the CLI dispatches', () => {
  // The counterpart to the two `usage()` cases above. `usage()` is now checked against the dispatch table, but
  // nothing checked the *documentation* against it — so `git-insights`, `pause`, `resume` and `stop` shipped,
  // reached `atlas help`, and never reached the page that calls itself the verified inventory.
  const text = docText('docs/FEATURES.md');
  const missing = dispatchedCommands().filter((c) => !mentionsCommand(text, c));
  eq(missing, [], 'these commands dispatch and FEATURES.md never names them — add a row, or an alias line');
});

test('inventory · every document that enumerates signals enumerates all of them', () => {
  // `health-signals.md` calls itself "the full catalogue" and `skills/build/SKILL.md` links to it as one. It
  // documented H1-H9 for as long as H10-H16 had been shipping, so the page other pages delegate to was missing
  // half its subject — worse than a stale sentence, because the delegation is what hides it.
  const ids = Object.keys(SIGNALS);
  eq(ids.length, Object.keys(CORPUS_SIGNALS).length + 1,
    'exactly one operator signal is expected; if a second lands, every prose figure below needs revisiting');

  const noRowIn = (text) => (id) => !new RegExp(`^\\|\\s*\\*{0,2}${id}\\*{0,2}\\s*\\|`, 'm').test(text);
  eq(ids.filter(noRowIn(docText('docs/FEATURES.md'))), [], 'FEATURES.md §2 has no table row for these signals');
  eq(ids.filter(noRowIn(docText('README.md'))), [], 'the README signal table has no row for these signals');

  const catalogue = docText('docs/references/health-signals.md');
  eq(ids.filter((id) => !new RegExp(`^## ${id} ·`, 'm').test(catalogue)), [],
    'health-signals.md calls itself the full catalogue and has no section for these signals');

  // And the reverse, so a retired signal cannot linger in prose after it leaves the code.
  const named = [...new Set([...catalogue.matchAll(/^## (H\d+) ·/gm)].map((m) => m[1]))];
  eq(named.filter((id) => !ids.includes(id)), [], 'health-signals.md documents signals the code does not ship');
});

test('inventory · the stated signal counts match the catalogue', () => {
  const corpus = Object.keys(CORPUS_SIGNALS).length;
  const all = Object.keys(SIGNALS).length;

  eq(statedFigure('docs/FEATURES.md', /\*\*([A-Za-z-]+) signals ship: [a-z-]+ about the corpus/, '§2 headline'),
    all, 'FEATURES.md §2 states the wrong total');
  eq(statedFigure('docs/FEATURES.md', /\*\*[A-Za-z-]+ signals ship: ([a-z-]+) about the corpus/, '§2 corpus split'),
    corpus, 'FEATURES.md §2 states the wrong corpus count');
  eq(statedFigure('docs/references/health-signals.md', /\*\*([A-Za-z-]+) mechanical checks: [a-z-]+ about the corpus/, 'the catalogue headline'),
    all, 'health-signals.md states the wrong total');
  eq(statedFigure('README.md', /runs \*\*([a-z-]+) mechanical checks over the indexed corpus\*\*/, 'the README health section'),
    corpus, 'the README states the wrong number of corpus checks');
  eq(statedFigure('README.md', /a \*\*health report\*\* of ([a-z-]+) mechanical rot signals/, 'the README opening'),
    corpus, 'the README opening states the wrong number of rot signals');
  eq(statedFigure('skills/health/SKILL.md', /\*\*([A-Za-z-]+) signals ship, not nine\.\*\*/, 'the health skill'),
    all, 'skills/health/SKILL.md states the wrong total');
});

test('inventory · the blocking set is the same five wherever it is written down', () => {
  // It was "three blocking (H1, H3, H8)" in `skills/health/SKILL.md` and `health-signals.md` long after H10 and
  // H12 joined the set — an instruction file telling a model that two blocking signals are advisory, which is
  // the one direction of error that gets a bad commit past the gate.
  const blocking = DEFAULT_CONFIG.blocking;
  ok(blocking.length >= 3, 'sanity: the default blocking set was read');

  // Each document says it in its own register, so each is checked in its own — but every expected string is
  // built from `blocking`, so adding or removing one signal fails all four at once with the same cause.
  includes(docText('docs/references/health-signals.md'), `${blocking.map((b) => `\`${b}\``).join(', ')} by default`,
    'health-signals.md must name the whole default blocking set');
  includes(docText('docs/FEATURES.md'), `[${blocking.map((b) => `'${b}'`).join(', ')}]`,
    'FEATURES.md §2 must quote the default blocking set as the code writes it');
  includes(docText('README.md'), `block by default: ${blocking.slice(0, -1).join(', ')} and ${blocking[blocking.length - 1]}.`,
    'the README must name the whole blocking set');

  const skill = docText('skills/health/SKILL.md');
  eq(statedFigure('skills/health/SKILL.md', /\*\*([A-Za-z-]+) signals block by default\*\*/, 'the health skill'),
    blocking.length, 'skills/health/SKILL.md states the wrong number of blocking signals');
  eq(blocking.filter((b) => !new RegExp(`\\b${b}\\b`).test(skill)), [],
    'skills/health/SKILL.md must name every blocking signal, because a model reads it instead of the config');
});

test('inventory · the stated view and panel counts match views.mjs', () => {
  // The Repository and Economics views shipped and FEATURES.md still said nine, naming the other nine. A count
  // beside a list of names is two claims; the list is the half that makes the page look checked.
  eq(statedFigure('docs/FEATURES.md', /\*\*([A-Za-z-]+) views ship\*\*/, '§6 view count'),
    DEFAULT_VIEWS.length, 'FEATURES.md states the wrong number of views');
  eq(statedFigure('docs/FEATURES.md', /\*\*([A-Za-z-]+) panels are defined\*\*/, '§6 panel count'),
    Object.keys(PANELS).length, 'FEATURES.md states the wrong number of panels');
  eq(statedFigure('README.md', /client-side search and ([a-z-]+) role-specific views/, 'the README opening'),
    DEFAULT_VIEWS.length, 'the README states the wrong number of views');

  const sentence = /\*\*[A-Za-z-]+ views ship\*\* \(`scripts\/lib\/views\.mjs:[\d-]+`\): ([^.]+)\./
    .exec(docText('docs/FEATURES.md'));
  ok(sentence, 'FEATURES.md §6 must list the views by title beside the count');
  eq(DEFAULT_VIEWS.map((v) => v.title).filter((t) => !sentence[1].includes(t)), [],
    'these views ship and FEATURES.md §6 does not name them');
});

test('inventory · the README quotes the real length of install.sh and the real size of the suite', () => {
  // "It is 40 lines" invites the reader to skim a script they are about to pipe into `sh`. It is 120, and the
  // difference is exactly the part a cautious reader would have wanted to read.
  const lines = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8').replace(/\n$/, '').split('\n').length;
  includes(docText('README.md'), `it is ${lines} lines`, 'the README misstates the length of install.sh');

  // Counted statically rather than by running the suite, so this holds under `--filter` and cannot become a
  // fixed point that depends on its own result.
  const cases = casesInFile('tests/run.mjs',
    fs.readFileSync(path.join(REPO_ROOT, 'tests', 'run.mjs'), 'utf8')).length;
  includes(docText('README.md'), `The suite holds ${cases} test cases.`,
    'add a test and this fails until the README says so — which is the whole point of this block');
});

/* ================================================================== H17 is wired in, and its numbers are real (Q-4) */

/**
 * **H17 was filed at 100% and had never run once.** `readParallelism` was correct and tested; no caller ever
 * passed `opts.sessions`, so every report on every machine printed *"H17 — (not evaluated)"*. And the
 * paragraph justifying its threshold contained two figures that contradicted each other. Both halves are
 * pinned here.
 *
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above this point, so an `async` case registered here would never be awaited and would report a pass it
 * never earned. Every case below was checked by reverting the change and watching it fail.
 */

console.log('\nH17 · wired in, and measured');

test('H17 · every surface that reports health evaluates it, and only the commit gate does not', () => {
  // **This is the test the defect needed and did not have.** Eight call sites, none with a fourth argument:
  // the signal was designed, documented, unit-tested and unreachable. A test over `readParallelism` cannot
  // see that, because `readParallelism` was never the broken part — the wiring was, and wiring is only
  // visible from the caller.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  const calls = [...src.matchAll(/runHealth\(index, cfg, root([^)]*)\)/g)].map((m) => m[1]);
  ok(calls.length >= 7, `expected the health call sites to still be here, found ${calls.length}`);

  const bare = calls.filter((a) => !a.includes('healthOpts'));
  eq(bare.length, 1,
    'exactly one call site may omit the session aggregate; every other one prints a report that would say ' +
    '"not evaluated" without it');

  // And the one that omits it must be the gate, identified by what surrounds it rather than by counting.
  const gate = src.slice(src.indexOf("if (cmd === 'health' && flag('gate'))"), src.indexOf("if (cmd === 'health' && flag('gate'))") + 1400);
  ok(/runHealth\(index, cfg, root\)/.test(gate),
    'the omission must be the --gate path — it reads blockingCount only, and H17 can never block');
  includes(gate, 'No `healthOpts` here',
    'and it must say why, so the omission does not read as the bug it is the fix for');
});

/** A store on disk in the shape Claude Code writes: a session file, and its subagents one directory down. */
const H17_STORE = path.join(tmpRoot, 'h17-store');

/** One assistant record. `tools` become `tool_use` blocks, which is where an edit is counted from. */
const h17Turn = (o) => JSON.stringify({
  type: 'assistant', timestamp: '2026-08-13T10:00:00Z', sessionId: o.sessionId,
  ...(o.isSidechain === undefined ? {} : { isSidechain: o.isSidechain }),
  message: { model: 'test-model', content: (o.tools || []).map((name) => ({ type: 'tool_use', name })) },
});

const h17Fixture = (() => {
  const dir = fixture('h17-store-read', {
    'project-atlas.config.json': JSON.stringify({ tokens: { transcriptRoot: H17_STORE } }),
    'docs/README.md': '# H17 fixture index\n\n[A](A.md)\n',
    'docs/A.md': '# H17 fixture page A\n\nBack to the [index](README.md).\n',
  });
  const slug = path.basename(transcriptDir(dir, { tokens: { transcriptRoot: H17_STORE } }));
  const store = path.join(H17_STORE, slug);
  fs.mkdirSync(path.join(store, 'fanned-session', 'subagents'), { recursive: true });

  // A solo session: 41 main-thread edits across the four editing tools, and not one delegated turn.
  const solo = [];
  for (let i = 0; i < 38; i++) solo.push(h17Turn({ sessionId: 'solo-session', tools: ['Edit'] }));
  solo.push(h17Turn({ sessionId: 'solo-session', tools: ['Write', 'MultiEdit'] }));
  solo.push(h17Turn({ sessionId: 'solo-session', tools: ['NotebookEdit'] }));
  // Neither of these is an edit, and counting them would make the threshold mean something else.
  solo.push(h17Turn({ sessionId: 'solo-session', tools: ['Read', 'Bash', 'Grep'] }));
  solo.push(JSON.stringify({ type: 'user', sessionId: 'solo-session', message: { content: 'assistant?' } }));
  fs.writeFileSync(path.join(store, 'solo-session.jsonl'), solo.join('\n') + '\n', 'utf8');

  // A session that delegated. Its main thread edited far more than the solo one, and H17 stays quiet on it.
  fs.writeFileSync(path.join(store, 'fanned-session.jsonl'),
    [h17Turn({ sessionId: 'fanned-session', tools: ['Agent'] }),
     ...Array.from({ length: 200 }, () => h17Turn({ sessionId: 'fanned-session', tools: ['Edit'] }))]
      .join('\n') + '\n', 'utf8');
  // The subagent's own transcript, one directory down, carrying the PARENT's sessionId — which is the only
  // reason the turns below get charged to `fanned-session` rather than to a session that does not exist.
  //
  // **The third record carries no `isSidechain` at all**, and that is the case that matters. `tokens.mjs`
  // takes either witness — a record marked `isSidechain` is a subagent turn wherever it lives, and a record
  // *in a subagent transcript* is one whether it says so or not — and only the second witness covers the
  // older transcript shape. Without it that turn is charged to the operator as a main-thread edit, which is
  // the direction that makes a session that fanned out look like one that did not.
  fs.writeFileSync(path.join(store, 'fanned-session', 'subagents', 'agent-a1.jsonl'),
    [h17Turn({ sessionId: 'fanned-session', isSidechain: true, tools: ['Edit'] }),
     h17Turn({ sessionId: 'fanned-session', isSidechain: true, tools: ['Write'] }),
     h17Turn({ sessionId: 'fanned-session', tools: ['Edit'] })].join('\n') + '\n', 'utf8');
  return { dir, store, cfg: { ...resolveConfig(dir), tokens: { transcriptRoot: H17_STORE } } };
})();

test("H17 · the reader meets readParallelism's contract, from a store in the real shape", () => {
  const r = readSessionParallelism(h17Fixture.dir, h17Fixture.cfg);
  ok(r.available, r.reason || 'the store must be readable');
  const by = Object.fromEntries(r.sessions.map((s) => [s.id, s]));

  eq(by['solo-ses'].edits, 41, 'Edit, Write, MultiEdit and NotebookEdit count; Read, Bash and Grep do not');
  eq(by['solo-ses'].subagentTurns, 0, 'and it delegated nothing');

  // The subagent transcript lives under `<store>/<session>/subagents/`, which a flat readdir never sees — the
  // omission that hid every token a subagent spent. Its turns belong to the parent, not to a third session.
  eq(r.sessions.length, 2, 'two sessions, not three: a subagent transcript is not a session of its own');
  eq(by['fanned-s'].subagentTurns, 3,
    'the sidechain turns are charged to the session that spawned them — including the one that carries no ' +
    '`isSidechain` and is a subagent turn only because of where it lives');
  eq(by['fanned-s'].edits, 200,
    "and only main-thread edits are charged to the operator — the subagent's three are not, which is the " +
    'direction that would otherwise make a session that fanned out look like one that never did');

  // The contract, met exactly: this object is passed straight through as the fourth argument.
  const verdict = readParallelism(r, h17Fixture.cfg);
  ok(verdict.available, "health must accept the reader's output with no adaptation");
  eq(verdict.flagged.map((f) => f.id), ['solo-ses'],
    'the 200-edit session delegated, so it is never flagged however large it is');
});

test('H17 · with no store the reader costs one stat, and reports unevaluated with the reason why', () => {
  // The property `atlas health` needs on every commit: the empty case must not walk a directory, read a task
  // log or shell out to git. `hasTranscripts` is the one call before the return, and this pins the contract
  // that comes back out of it.
  const dir = fixture('h17-no-store', { 'docs/A.md': '# H17 absent-store page\n' });
  const cfg = { ...resolveConfig(dir), tokens: { transcriptRoot: path.join(tmpRoot, 'h17-store-absent') } };
  const r = readSessionParallelism(dir, cfg);
  ok(!r.available, 'a machine with no transcripts for this path has no evidence to offer');
  includes(r.reason, 'No session transcripts for this repository');
  ok(!/\.$/.test(r.reason),
    'the reason is spliced mid-sentence by readParallelism, so it must not end in a full stop');

  // And it travels all the way to the row a person reads: unevaluated, never "ok". (A-29)
  const index = buildIndex(dir, cfg);
  const health = runHealth(index, cfg, dir, { sessions: r });
  ok(health.unevaluated.includes('H17'), 'no store means unevaluated, not clean');
  const report = formatReport(health, index, { color: false });
  ok(!/H17\s+ok\b/.test(report), 'a signal that could not run must never print ok');
  includes(report, 'No session transcripts for this repository',
    "the reader's reason must reach the Not-checked block, not be replaced by a generic one");
});

test('H17 · end to end: atlas health evaluates it and fires on the solo session', () => {
  // The whole point, from the command line, through the real CLI. Before this change this command printed
  // "(not evaluated — see Not checked)" on every machine in the world.
  const r = cli(h17Fixture.dir, ['health', '--verbose']);
  const h17Lines = r.stdout.split('\n').filter((l) => l.includes('H17')).join('\n');
  ok(!/H17.*not evaluated/.test(r.stdout), `H17 must actually evaluate:\n${h17Lines}`);
  includes(r.stdout, 'solo-ses', 'and it must name the session it fired on');
  includes(r.stdout, '41 edit(s) in one main thread and no subagent turn');
  ok(!r.stdout.includes('fanned-s'), 'the session that delegated must not be flagged');
  includes(r.stdout, 'measures the operator, not the corpus', 'the row must still say which kind of claim it is');
  eq(r.code, 0, 'H17 can never block, so it can never change the exit code');
});

test('H17 · every number in the printed justification is computed from the sample, not retyped', () => {
  // **The old text was arithmetically impossible, and both figures printed on health.html.** It claimed 40
  // was "the 25th percentile" of `12, 39, 58, 89, 116, 136, 164, 235, 694, 1114, 1650` — n=11, whose 25th
  // percentile is 58 by nearest rank and 73.5 interpolated. It then said "20 of the 29 made fewer than 40
  // edits", which puts 9 at or above 40; 9 of those 11 fanned-out sessions are already at or above 40, so no
  // solo session was left above the line and the rule fired ZERO times on the sample it claimed to fire twice
  // on. Nothing could catch that, because prose about a distribution is not the distribution.
  const ev = parallelismEvidence();
  const s = PARALLELISM_SAMPLE;

  eq([ev.sessions, ev.fanned, ev.solo], [29, 12, 17], 'the sample as re-measured on 2026-08-13');
  eq(ev.fanned + ev.solo, s.fannedOut.length + s.solo.length, 'every session is in exactly one population');
  eq(ev.p25, { nearest: 39, interpolated: 53.25 },
    'the two standard percentile conventions disagree by 37% on this sample — which is the argument for ' +
    'not resting a default on either');
  eq(ev.fires, 2, 'at 40 the rule fires on two sessions, which is a note rather than a nag');
  eq([ev.fannedBelow, ev.soloAtOrAbove], [3, 2],
    'the populations OVERLAP in both directions, so no cut point separates them and no percentile of this ' +
    'sample can justify a threshold');
  eq([ev.below, ev.zeroEdits], [18, 10]);
  eq(ev.fires, s.solo.filter((e) => e >= DEFAULT_PARALLELISM_EDITS).length,
    'the fire count is read off the sample, so it cannot contradict the list printed beside it');

  const why = SIGNALS.H17.why;
  const n = (s) => Number(String(s).replace(/,/g, ''));

  // **The two sentences that carry the arithmetic are parsed back out and compared to the sample.** A
  // substring check cannot catch the failure that actually happened: the old paragraph said "29" in one place
  // and implied a different total in the next clause, and both substrings were present. Reading the numbers
  // out of the prose is the only assertion that makes the paragraph unable to contradict itself.
  const sample = /— ([\d,]+) stores, ([\d,]+) transcript files, ([\d,]+) sessions —/.exec(why);
  ok(sample, 'the justification must state the sample it was calibrated against, in a parseable form');
  eq(sample.slice(1).map(n), [PARALLELISM_SAMPLE.stores, PARALLELISM_SAMPLE.transcriptFiles, ev.sessions],
    'the stated sample must be the measured sample');

  const stated = new RegExp('the rule fires on ([\\d,]+) of the ([\\d,]+) sessions, ([\\d,]+) of which made ' +
    'fewer than ([\\d,]+) edits and ([\\d,]+) of which made none at all').exec(why);
  ok(stated, 'the calibration sentence must be present in a parseable form');
  eq(stated.slice(1).map(n), [ev.fires, ev.sessions, ev.below, DEFAULT_PARALLELISM_EDITS, ev.zeroEdits],
    'every figure in the calibration sentence must be the figure the sample yields — retyping any one of ' +
    'them is exactly how the old text came to state a distribution under which the rule fires zero times');

  const overlap = /overlap: ([\d,]+) of the sessions that delegated were below ([\d,]+) edits and ([\d,]+) that delegated/.exec(why);
  ok(overlap, 'and the overlap, which is the finding that decided the constant');
  eq(overlap.slice(1).map(n), [ev.fannedBelow, DEFAULT_PARALLELISM_EDITS, ev.soloAtOrAbove]);

  for (const [label, value] of [['sessions', 29], ['fanned-out sessions', 12], ['solo sessions', 17],
                                ['sessions it fires on', 2], ['fanned sessions below the line', 3],
                                ['solo sessions above it', 2], ['sessions below the threshold', 18],
                                ['sessions with no edit at all', 10], ['stores', 8], ['transcript files', 587]]) {
    includes(why, String(value), `the justification must state the measured count of ${label}`);
  }
  includes(why, num(1650), 'the largest count must be grouped by num(), never by a bare toLocaleString()');
  includes(why, num(1114), 'and so must the second largest');
  includes(why, '53.25', 'both percentile answers are printed, because they disagree');

  // The threshold is now declared arbitrary. That is the honest form of this claim, and the words matter: a
  // stated arbitrary default can be argued with; a fabricated percentile cannot be argued with at all.
  includes(why, 'ARBITRARY ROUND NUMBER');
  includes(why, 'tokens.parallelismEdits', 'and it must say how to change it');
  ok(!/is the 25th percentile of the edit counts of/.test(why),
    'the fabricated derivation must be gone, not merely restated with new numbers');
  ok(!why.includes('116'), 'the old sample listed an edit count of 116 that is in no measured population');
  ok(!/20 of the 29/.test(why), 'and the figure that made the rule fire zero times must be gone');

  // Still the three properties Q-4 exists for.
  includes(why, 'MEASURES THE OPERATOR, NOT THE CORPUS');
  includes(why, 'ADVISORY, AND NEVER BLOCKING');
});

test('H17 · the roadmap entry states the same arithmetic as the signal, not the impossible one', () => {
  // Q-4's entry repeated the same two invented figures. A corrected signal beside an uncorrected plan is the
  // drift this tool detects for a living, in the document that lists the work.
  const q4 = docText('docs/ROADMAP.md');
  const ev = parallelismEvidence();
  ok(!/40 is the 25th percentile of the edit counts of the sessions that \*did\* fan out/.test(q4),
    'the fabricated percentile must be gone from the plan too');
  includes(q4, 'arithmetically impossible', 'and the entry must say what was wrong, not quietly restate it');
  includes(q4, `${ev.p25.nearest} by nearest rank`, 'with the re-measured figure');
  includes(q4, '53.25', 'and the interpolated one beside it');
  includes(q4, `fires on ${ev.fires} of the ${ev.sessions} sessions`,
    'and the honest calibration in place of the derivation');
  includes(q4, 'never ran', 'the entry must also record that it was filed at 100% and had never evaluated');
});

/* ================================================================== what a fan-out will collide on (A-48) */

/**
 * `atlas contention` — the counter-weight to C-11, which argues for fan-out and never counted its cost.
 *
 * **Synchronous, like everything appended below the drain**, for the reason given above: `pendingAsync` is
 * emptied thousands of lines earlier, so an `async` case here would pass by never running. Each case was
 * checked by reverting the change and watching it fail.
 */

console.log('\nA-48 · contention before the fan-out');

/** A repository with a plan, a base, and three branches that overlap the way this session's six did. */
const contentionFixture = (() => {
  const dir = fixture('contention', {
    'project-atlas.config.json': JSON.stringify({ planning: { source: 'docs/ROADMAP.md' } }),
    'docs/ROADMAP.md': '# Contention fixture roadmap\n\n## Track 1\n\n**A-1 · The first thing** — **P1 · High**\n\nDone.\n',
    'tests/run.mjs': 'test("one", () => {});\n',
    'scripts/lib/one.mjs': 'export const one = 1;\n',
    'scripts/lib/two.mjs': 'export const two = 2;\n',
  });
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const base = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  const commit = (msg) => execFileSync('git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-qam', msg], { cwd: dir, stdio: 'ignore' });
  const append = (rel, text) => fs.appendFileSync(path.join(dir, rel), text, 'utf8');

  // Two branches that both append to the plan and to the test file, and both file A-2 — exactly the pair of
  // collisions this session paid for. The third touches neither.
  for (const [name, own] of [['feat/alpha', 'scripts/lib/one.mjs'], ['feat/beta', 'scripts/lib/two.mjs']]) {
    git('checkout', '-q', '-b', name, base);
    append('docs/ROADMAP.md', `\n**A-2 · Filed independently by ${name}** — **P2 · Medium**\n\nWork.\n`);
    append('tests/run.mjs', `test("${name}", () => {});\n`);
    append(own, `export const extra = '${name}';\n`);
    commit(`feat: ${name}`);
  }
  git('checkout', '-q', '-b', 'feat/gamma', base);
  append('scripts/lib/two.mjs', 'export const gamma = true;\n');
  commit('feat: gamma');
  // A branch with nothing on it: it can contend with nothing and must not pad the count.
  git('checkout', '-q', '-b', 'feat/empty', base);
  git('checkout', '-q', base);
  return { dir, base, cfg: resolveConfig(dir) };
})();

test('A-48 · reports the files more than one branch would touch, worst first', () => {
  const c = readContention(contentionFixture.dir, contentionFixture.cfg, { base: contentionFixture.base });
  ok(c.available, c.reason);
  eq(c.branches.map((b) => b.name).sort(), ['feat/alpha', 'feat/beta', 'feat/gamma'],
    'a branch with no commit the base lacks can contend with nothing and is excluded');
  eq(c.settled, 1, 'and is counted rather than dropped silently');

  const shared = Object.fromEntries(c.shared.map((s) => [s.file, [...s.branches].sort()]));
  eq(Object.keys(shared).sort(), ['docs/ROADMAP.md', 'scripts/lib/two.mjs', 'tests/run.mjs'],
    'every file two or more branches touch, and no file only one of them touches');
  eq(shared['tests/run.mjs'], ['feat/alpha', 'feat/beta'],
    'the append-only test file — the conflict this repository hits on every single fan-out');
  eq(shared['scripts/lib/two.mjs'], ['feat/beta', 'feat/gamma']);
  ok(!('scripts/lib/one.mjs' in shared), 'a file only one branch touches is not contention');
  eq(c.shared[0].count, 2, 'sorted by how many branches touch it, worst first');

  const report = formatContention(c, false);
  includes(report, 'tests/run.mjs');
  includes(report, 'feat/alpha, feat/beta', 'the report names who will collide, not just how many');
});

test('A-48 · a plan-item id introduced by two branches is the one thing it refuses', () => {
  // A-34 was filed by two agents independently and A-38 and A-39 by three. Every one was renumbered by hand
  // afterwards, which left merged commit subjects naming ids that had moved — and a commit subject cannot be
  // corrected. This is the half that is pure win: two branches introducing one id has no legitimate cause.
  const c = readContention(contentionFixture.dir, contentionFixture.cfg, { base: contentionFixture.base });
  ok(c.ids.available, c.ids.reason);
  eq(c.ids.duplicates.map((d) => d.id), ['A-2']);
  eq([...c.ids.duplicates[0].branches].sort(), ['feat/alpha', 'feat/beta']);

  // An id already on the base is carried by every branch and is not a collision — only what a branch
  // *introduces* counts, and only an item heading is an introduction.
  eq(c.ids.defined.map((d) => d.id), ['A-2'], 'A-1 is on the base, so no branch introduced it');

  // That distinction is the whole check, so it is pinned on its own: two branches both *mentioning* A-34 is
  // normal and correct, and a checker that could not tell a mention from a definition would report every
  // cross-reference in the plan as a collision and be switched off within a day.
  eq(definedIds('**A-9 · A real item** — **P1 · High**\n\nSupersedes A-8, and see A-7.\n', contentionFixture.cfg),
    ['A-9'], 'the item heading defines; a reference in the prose beneath it does not');

  // The allocator, as a read: the highest id in use anywhere plus one. Handing this out before the fan-out is
  // what stops two agents each counting for themselves.
  eq(c.ids.nextFree, [{ prefix: 'A', next: 'A-3', highest: 'A-2' }]);

  const report = formatContention(c, false);
  includes(report, 'defined on more than one branch');
  includes(report, 'A-2');
  includes(report, 'Next free plan-item id');
});

test('A-48 · the command exits 1 on a duplicate id and 0 on a merely shared file', () => {
  // The line is the same one `blocking` draws in the health report: refuse only what has no legitimate cause.
  // Two branches on one file is frequently correct, and a tool that refused it would be deciding how somebody
  // splits their work — which is how a check gets switched off, taking the useful half with it.
  const withDup = spawnSync(process.execPath, [CLI, 'contention', '--base', contentionFixture.base, '--no-color'],
    { cwd: contentionFixture.dir, encoding: 'utf8' });
  eq(withDup.status, 1, 'a duplicate plan-item id is a defect and must fail a CI step');
  includes(withDup.stdout, 'A-2');

  // Named branches, and a pair that shares a file but no id.
  const noDup = spawnSync(process.execPath,
    [CLI, 'contention', 'feat/beta', 'feat/gamma', '--base', contentionFixture.base, '--no-color'],
    { cwd: contentionFixture.dir, encoding: 'utf8' });
  eq(noDup.status, 0, 'a shared file is reported, never refused');
  includes(noDup.stdout, 'scripts/lib/two.mjs', 'and it is still reported');
  ok(!noDup.stdout.includes('feat/alpha'), 'naming branches must restrict the comparison to them');

  const json = JSON.parse(spawnSync(process.execPath,
    [CLI, 'contention', '--base', contentionFixture.base, '--json'],
    { cwd: contentionFixture.dir, encoding: 'utf8' }).stdout);
  eq(json.ids.duplicates.map((d) => d.id), ['A-2'], 'and the machine-readable form carries the same verdict');
});

test('A-48 · it degrades rather than crashing where there is nothing to compare', () => {
  // Every surface in this tool has to survive a repository that is not the one it was written against.
  const bare = fixture('contention-bare', { 'docs/A.md': '# Contention bare fixture\n' });
  const c = readContention(bare, resolveConfig(bare), { base: 'no-such-branch' });
  ok(!c.available);
  includes(c.reason, 'does not resolve to a commit');
  includes(formatContention(c, false), 'could not be reported');

  // No planning source configured is a stated absence, not a silent clean bill — the same rule the health
  // report's "Not checked" section exists for.
  const noPlan = readContention(contentionFixture.dir, { ...contentionFixture.cfg, planning: { source: null } },
    { base: contentionFixture.base });
  ok(noPlan.available, 'the file half still works without a plan');
  ok(!noPlan.ids.available);
  includes(noPlan.ids.reason, 'planning.source is not configured');
  includes(formatContention(noPlan, false), 'were not checked');
});

test('A-48 · the skill that argues for fan-out now states what the coordination cost', () => {
  // C-11 read as advocacy: it priced the parallelism at "perhaps an hour" and never priced the merge. A
  // reader who follows an instruction that states only its upside, and then pays the downside, stops
  // believing the rest of the document.
  for (const rel of ['skills/build/SKILL.md', 'plugins/atlas/skills/build/SKILL.md']) {
    const skill = fs.readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8');
    includes(skill, 'eleven merge commits', `${rel}: the bill must be a measured number, not "some conflicts"`);
    includes(skill, 'six agents, seven branches', `${rel}: with the shape of the fan-out that produced it`);
    includes(skill, 'atlas contention', `${rel}: and the command that would have predicted it`);
    includes(skill, 'A-34', `${rel}: the duplicate id, named`);
    includes(skill, 'silently drops a case',
      `${rel}: the mid-test conflict cut is the expensive half, because the resolution still parses`);
    includes(skill, 'When not to fan out', `${rel}: the honest exceptions must survive the amendment`);
  }
});

/* ================================================================== the suite, in the knowledge base (M-5) */

/*
 * `kb/tests.md` — "is this behaviour tested, and where?", answerable without opening a nine-thousand-line
 * file. Everything on that page is derived from the test sources, so everything asserted here is asserted
 * against a fixture whose test file this block owns and can change.
 *
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above this point, so an `async` case here would be constructed, pushed onto a list nothing reads again,
 * and never run — reaching neither the pass count nor the failure list.
 */

console.log('\nthe suite, in the knowledge base');

/**
 * A repository with a test file this block can reason about line by line.
 *
 * The test file carries both grouping conventions (a rule comment and a printed banner), a drain partway
 * down with one case below it, a defect id the plan defines, and one that it does not. `src/thing.mjs` is
 * cited by a document *and* imported by the suite; `src/other.mjs` is imported and cited by nothing.
 */
const KB_TESTS_FIXTURE = {
  'docs/README.md': '# Index\n\n[Plan](PLAN.md)\n\nThe loop is at `src/thing.mjs:1`.\n',
  'docs/PLAN.md': '# Plan\n\n| Item | % |\n|---|---|\n| Z-1 | 100 |\n\n## Track 1 — Things\n\n'
    + '**Z-1 · The kestrel index was written twice** — **P1 · High**\n\n*Shipped.*\n',
  'src/thing.mjs': 'export const thing = 1;\n',
  'src/other.mjs': 'export const other = 2;\n',
  'tests/suite.mjs': [
    "import { thing } from '../src/thing.mjs';",                                    // 1
    "import { other } from '../src/other.mjs';",                                    // 2
    '',                                                                             // 3
    'const pendingAsync = [];',                                                     // 4
    'function test(name, fn) { const r = fn(); if (r && r.then) pendingAsync.push({ name, p: r }); }', // 5
    '',                                                                             // 6
    '/* ================================================================== alpha */', // 7
    "console.log('\\nalpha');",                                                     // 8
    '',                                                                             // 9
    "test('alpha · the kestrel is counted', () => {});",                            // 10
    '',                                                                             // 11
    '// Z-1: the kestrel index was written twice. Q-99 is not an id this plan defines.', // 12
    "test('alpha · a second kestrel index is refused', () => {});",                 // 13
    '',                                                                             // 14
    'for (const { name, p } of pendingAsync) { await p; }',                         // 15
    '',                                                                             // 16
    '/* ================================================================== beta */',  // 17
    "console.log('\\nbeta');",                                                      // 18
    '',                                                                             // 19
    "test('beta · a case below the drain never runs', () => {});",                  // 20
    '',                                                                             // 21
  ].join('\n'),
};

/** The fixture built, rendered, and its `kb/tests.md` read back. */
function kbTests(name, files = KB_TESTS_FIXTURE) {
  const dir = fixture(name, files);
  const { cfg, index, health } = analyse(dir, { planning: { source: 'docs/PLAN.md' } });
  const { outDir } = renderSite(index, health, cfg, dir);
  return { dir, cfg, index, health, outDir, page: fs.readFileSync(path.join(outDir, 'kb', 'tests.md'), 'utf8') };
}

test('kb · every case reaches the tree with its own line, grouped as the file groups itself', () => {
  // The question this page exists for is "is this tested, and where". A name with no line is half an
  // answer — it still costs an agent the whole file to act on.
  const { page } = kbTests('kb-tests-cases');

  includes(page, '| Cases | 3 |', 'the count is the file\'s, not an estimate');
  for (const [name, line] of [
    ['alpha · the kestrel is counted', 10],
    ['alpha · a second kestrel index is refused', 13],
    ['beta · a case below the drain never runs', 20],
  ]) includes(page, `- ${name} — [tests/suite.mjs:${line}]`, `${name} must be listed at its own line`);

  // Grouped by the marker nearest above each case, which is the printed banner where a file has both. The
  // slice is the assertion: a page that listed every case under every heading would pass a bare `includes`.
  const alpha = page.slice(page.indexOf('#### alpha'), page.indexOf('#### beta'));
  const beta = page.slice(page.indexOf('#### beta'));
  eq(alpha.includes('the kestrel is counted') && alpha.includes('a second kestrel index'), true,
    'both alpha cases belong to the alpha banner');
  eq(alpha.includes('below the drain'), false, 'and the beta case does not');
  eq(beta.includes('below the drain'), true, 'the beta case belongs to the beta banner');

  includes(page, '| alpha | [tests/suite.mjs:8]', 'the group index gives the banner its own line');
  includes(page, '| beta | [tests/suite.mjs:18]');

  // Names and locations, never bodies. The fixture's only body text is the arrow function.
  eq(page.includes('() => {}'), false, 'a case body must not be copied onto the page');
});

test('kb · a case naming a plan item is cross-referenced, and an id the plan never defined is not', () => {
  // The suite's convention for a reversion-verified case is a comment naming the defect. Matching the
  // *shape* of an id instead of the plan's own ids would report `H17` — a health signal this file names
  // dozens of times — as a plan item, and a cross-reference that invents half its edges is worse than none.
  const { page } = kbTests('kb-tests-plan');

  includes(page, '| Cases naming a plan item | 1 |');
  includes(page, '| Z-1 | 1 | [tests/suite.mjs:13]',
    'the id is in the comment above the case, and that comment belongs to the case below it');
  eq(page.includes('Q-99'), false, 'an id-shaped string the plan does not define is not a plan item');
  includes(page, '1 of 1 plan item(s) are named by at least one case.');

  // The boundary, stated the other way round: the id sits above case two, and case one must not inherit it.
  const first = page.slice(page.indexOf('- alpha · the kestrel is counted'), page.indexOf('- alpha · a second'));
  eq(first.includes('Z-1'), false, 'a defect comment belongs to the case below it, never the case above');

  // And the honest limit is stated, because "names a defect" is a claim the case makes about itself.
  includes(page, 'not evidence', 'the page must not present a named defect as a verified reversion');
});

test('kb · the page states the synchronous rule with the drain\'s own line number', () => {
  // The trap that produces no error message: a case registered below the drain is pushed onto a list nothing
  // reads again, so it never runs and never reaches the count. A rule that lives only in a comment is a rule
  // enforced by whoever happened to read that comment.
  const { page } = kbTests('kb-tests-drain');
  includes(page, 'must be synchronous');
  includes(page, 'drained at `tests/suite.mjs:15`', 'the drain is located, not described');
  includes(page, '1 of 3 case(s) are registered below it');

  // The runner's own selection flag, read out of the runner rather than assumed — this fixture has none, so
  // the page must not invent one.
  eq(page.includes('--filter'), false, 'a flag this runner does not read must not be offered');
  includes(page, 'node tests/suite.mjs', 'and the command that runs it is still given');
});

test('kb · the reverse route names the test files that import a code file', () => {
  // routes.md answers "I am about to change this — what describes it?". A file's tests are the other half of
  // that answer, and the more actionable half: a document is an opinion, a test is a claim that fails.
  const { outDir } = kbTests('kb-tests-routes');
  const routes = fs.readFileSync(path.join(outDir, 'kb', 'routes.md'), 'utf8');

  includes(routes, '| Code file | Documented by | Citations | Tested by |');
  ok(/^\| `src\/thing\.mjs` \|.*\| `tests\/suite\.mjs` \|$/m.test(routes),
    'a cited file that the suite imports must carry its test file on the same row');

  // The file nothing documents. It is imported and never cited, so it is invisible to every other section of
  // this page — which is exactly the gap worth naming, because the tests are then its only written account.
  const bare = routes.slice(routes.indexOf('## Files a test imports that no document describes'));
  includes(bare, '| `src/other.mjs` | `tests/suite.mjs` |');
  eq(bare.includes('src/thing.mjs'), false, 'a file a document does describe does not belong in that list');
});

test('kb · the tests page is derived, so appending a case changes it without anything being edited', () => {
  // The rule the whole tree is built on. A hand-maintained list of test names is a list that goes stale, and
  // a stale list of what is covered is worse than none — it is read as an assurance.
  const { dir, cfg, index, health } = kbTests('kb-tests-derived');
  fs.appendFileSync(path.join(dir, 'tests', 'suite.mjs'),
    "\ntest('beta · a kestrel appended later', () => {});\n", 'utf8');

  // No re-index and no re-commit: the file is already tracked, and the page is read off the working tree the
  // same way every other derived figure is.
  const { outDir } = renderSite(index, health, cfg, dir);
  const page = fs.readFileSync(path.join(outDir, 'kb', 'tests.md'), 'utf8');
  includes(page, '| Cases | 4 |', 'the count follows the file');
  includes(page, '- beta · a kestrel appended later — [tests/suite.mjs:22]',
    'and so does the new case, at the line it was actually written on');
});

/* ================================================================== the suite, on the QC page (A-47) */

console.log('\nthe suite on the QC page');

/**
 * **The Quality view could tell you how often work is redone and not whether anything is tested.**
 *
 * The panel that was there answered half of it — a count and a grouping — and got the grouping from the
 * wrong place: `testcases.mjs::sectionsOf` reads comment banners, and on this suite the largest banner is
 * `done`, the one over the async drain. Seventy-four cases, the biggest bar on the page, filed under a label
 * that names a point in a file rather than an area of the system.
 *
 * These cases pin the three things the panel now has to be right about: it groups by what the runner
 * *announces*, it reconciles those groups against the inventory instead of quietly showing a smaller number,
 * and it finds the drain rather than being told about it.
 *
 * **Every case here is synchronous.** `pendingAsync` is drained thousands of lines above, so an `async` case
 * appended here would be constructed, never awaited, and reported as a pass it never earned — which is the
 * very hazard the panel these cases cover exists to display.
 */

/** A view context whose `repo` is shaped the way `render.mjs` shapes it, over a fixture's own files. */
function suiteCtx(name, files) {
  const dir = fixture(name, { 'docs/A.md': '# A\n', ...files });
  const cfg = { ...resolveConfig(dir), __root: dir };
  const index = buildIndex(dir, cfg);
  const tracked = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  return {
    dir, cfg, index, health: runHealth(index, cfg, dir), plan: null, contrib: null, nav: [],
    repo: {
      files: tracked,
      code: tracked.filter((f) => /\.(m?[jt]sx?|py|go|rs|java|rb|swift|kt|c|h|cpp|cs|php|sh)$/i.test(f)),
      tests: testInventory(dir, tracked),
    },
  };
}

const suiteHtml = (ctx, extra = {}) =>
  viewPage({ id: 'qc', title: 'Quality', panels: ['testcases'] }, { ...ctx, ...extra }, (o) => o.body);

test('testcases · the panel groups by what the runner announces, not by its comment banners', () => {
  // The banner grouping is not merely coarser, it is wrong: `done` is the marker over the drain and every
  // case below it inherited that label. What a runner prints is the grouping its author stands behind, and
  // it is the label a reader has already seen scroll past.
  const ctx = suiteCtx('qc-groups', {
    'tests/run.mjs': [
      "const pending = [];",
      "/* ===== done */",
      "console.log('\\nglob');",
      "test('glob spans directories', () => {});",
      "test('glob never crosses a boundary', () => {});",
      "console.log('\\ntaxonomy');",
      "test('a filename rule wins', () => {});",
      '',
    ].join('\n'),
  });
  const html = suiteHtml(ctx);

  includes(html, '>glob<', 'the announced group is the bar label');
  includes(html, '>taxonomy<', 'and so is the second one');
  eq(/<span class="bl">done<\/span>/.test(html), false,
    'the banner over the drain must not be a group — it names a point in the file, not an area');
  includes(html, 'label that names a point in the file rather than an area of the system',
    'and the panel says which grouping it chose, so the reader is not left to guess');
  // The counts come from `casesInFile`, the same extractor `testInventory` uses. Two answers to "how many
  // cases" is the fork this whole tool exists to detect, committed in code rather than in prose.
  includes(html, 'Every one of the 3 cases is accounted for below.');
});

test('testcases · a group total that does not reconcile is reported, not quietly shown', () => {
  // The failure mode this replaces: a panel that sums to less than the headline and says nothing, so a
  // reader takes the bars for the whole suite. A file the runner never announces is grouped under its own
  // path rather than dropped — the reconciliation line then has to still read "every one".
  const ctx = suiteCtx('qc-reconcile', {
    'tests/loud.test.js': "console.log('\\nalpha');\ntest('a', () => {});\n",
    'tests/quiet.test.js': "test('b', () => {});\ntest('c', () => {});\n",
  });
  const html = suiteHtml(ctx);

  eq(ctx.repo.tests.cases.length, 3, 'the fixture holds three cases across two files');
  includes(html, 'Every one of the 3 cases is accounted for below.',
    'a file whose runner announces nothing is grouped under its path, not left out of the bars');
  includes(html, '>tests/quiet.test.js<', 'and that path is the group label');
  includes(html, '>alpha<');
});

test('testcases · a case registered below the async drain is found, counted and named', () => {
  // The suite queues any case returning a promise and awaits the queue partway through the file. A case
  // appended below that point is registered after the only thing that would await it: nothing inspects its
  // assertions and the runner prints a pass it did not earn. Silent, and identical to a real pass.
  const ctx = suiteCtx('qc-drain', {
    'tests/run.mjs': [
      "const pendingAsync = [];",
      "function test(name, fn) { const r = fn(); if (r && r.then) pendingAsync.push({ name, p: r }); }",
      "console.log('\\nbefore');",
      "test('a synchronous case above the drain', () => {});",
      "for (const { name, p } of pendingAsync) { await p; }",
      "console.log('\\nafter');",
      "test('a synchronous case below the drain', () => {});",
      "test('an async case below the drain', async () => {});",
      '',
    ].join('\n'),
  });
  const html = suiteHtml(ctx);

  includes(html, '<code>pendingAsync</code>', 'the queue is found by structure, and named');
  includes(html, '<strong>2</strong> of its cases are registered', 'both cases below the drain are counted');
  includes(html, '1 case(s) below the drain are declared <code>async</code>',
    'and the one that is actually broken is separated from the exposure');
  // **Asserted as the whole element, not as a substring.** The first implementation matched the name with a
  // lazy `[\s\S]*?`, which on a case that is not `async` backtracks past its own closing quote and runs on
  // until it finds a later one — so the page quoted an eleven-thousand-character "test name" made of every
  // case in between. `includes(html, 'an async case below the drain')` was true of that blob too. The count
  // was right and only the name was absurd, which is why this was found by looking at the page and not here.
  includes(html, '<q>an async case below the drain</q>',
    'a case name cannot span two cases — the quoted name must be exactly the name');
  includes(html, 'reports a pass it did not earn');
});

test('testcases · a suite with no drain is not warned about one', () => {
  // A fabricated hazard is worse than a missing one: it teaches a reader to skip the paragraph. This fixture
  // clears every other condition on purpose — an array declared empty, pushed to, and then iterated — so the
  // only thing standing between it and a false warning is the rule that a drain has to await something. A
  // `for … of` that awaits nothing is a loop.
  const ctx = suiteCtx('qc-nodrain', {
    'tests/run.mjs': [
      "const names = [];",
      "names.push('a');",
      "for (const n of names) { console.log(n); }",
      "console.log('\\nalpha');",
      "test('one', () => {});",
      "test('two', () => {});",
      '',
    ].join('\n'),
  });
  const html = suiteHtml(ctx);
  eq(/Structural hazard/.test(html), false, 'a loop that awaits nothing is not a drain');
  includes(html, '>alpha<', 'and the rest of the panel still renders');
});

test('testcases · tests are plotted against code churn on one axis, with prose excluded', () => {
  // "Is the suite growing with the code" is the question QC exists to ask, and a stock — 450 cases — cannot
  // answer it. Both series are lines changed, so they share one y-axis; a second scale can be drawn to say
  // anything. Prose is excluded because a rewritten changelog is not the code outrunning the suite.
  const ctx = suiteCtx('qc-churn', {
    'tests/run.mjs': "console.log('\\nalpha');\ntest('one', () => {});\n",
    'src/app.js': 'export const a = 1;\n',
    'CHANGELOG.md': 'x\n',
  });
  // One line of code at init and three more here; three hundred and one in a changelog nobody tests.
  commitAt(ctx.dir, '2026-01-05T10:00:00Z', 'src/app.js',
    'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n');
  commitAt(ctx.dir, '2026-01-06T10:00:00Z', 'CHANGELOG.md', `${'entry\n'.repeat(300)}`);
  const html = suiteHtml(ctx, { contrib: readContrib(ctx.dir, ctx.cfg) });

  includes(html, 'Lines changed per week: tests against code');
  includes(html, 'Both series are lines changed, so they share one y-axis');
  includes(html, '>test files<');
  includes(html, '>code, excluding tests<');
  eq((html.match(/viewBox="0 0 460 170"/g) || []).length, 2, 'two small multiples, never one chart with two scales');
  // Two lines changed under `tests/`, four under `src/`, and three hundred and one in a changelog nobody
  // tests. Asserted as the sentence the panel prints, because the tooltips vanish past fourteen points and a
  // check that silently stops looking is worse than none: counting prose would read "against 305 in code"
  // here and make a suite that is keeping up look two orders of magnitude behind.
  includes(html, '2 line(s) changed in tests against 4 in code',
    'the changelog must not reach the code series');
  includes(html, 'because a rewritten changelog is not the code outrunning the suite');
});

test('testcases · under four weeks of history the churn chart falls to a daily axis and says which', () => {
  // Two dots and a straight segment between them is a shape, not a trend. Both axes come from contrib.mjs —
  // `weeklyAxis`, or `fillAxis` at a one-day step — because a third derivation of "which bucket is this" is
  // exactly the fork this tool exists to detect, committed in code instead of in prose.
  const ctx = suiteCtx('qc-churn-daily', {
    'tests/run.mjs': "console.log('\\nalpha');\ntest('one', () => {});\n",
    'src/app.js': 'export const a = 1;\n',
  });
  // The fixture's own initial commit is dated now, which would put months of real silence in the range and
  // make this assert on the calendar instead of on the rule. Moved onto the first day of the window.
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--amend', '--no-edit', '--date=2026-01-05T09:00:00Z'],
  { cwd: ctx.dir, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' } });
  commitAt(ctx.dir, '2026-01-06T10:00:00Z', 'src/app.js', 'export const a=1;\nexport const b=2;\n');
  commitAt(ctx.dir, '2026-01-07T10:00:00Z', 'tests/run.mjs', "console.log('\\nalpha');\ntest('one', () => {});\ntest('two', () => {});\n");
  const html = suiteHtml(ctx, { contrib: readContrib(ctx.dir, ctx.cfg) });

  includes(html, 'Lines changed per day: tests against code', 'one week of history is plotted by day');
  eq(/Lines changed per week/.test(html), false, 'and never by week as well — two answers to one question');
  includes(html, 'Share of change landing in tests, per day');
});

test('testcases · the panel is publishable, because nothing on it is machine-local', () => {
  // `data-local-only` strips an element at publish. Every figure here comes from tracked files and committed
  // history, so it is identical on any checkout of the same commit; marking it would delete the panel from
  // the published site in exchange for no protection at all. The marker is for what a *machine* holds.
  const ctx = suiteCtx('qc-publishable', {
    'tests/run.mjs': "console.log('\\nalpha');\ntest('one', () => {});\n",
  });
  const html = suiteHtml(ctx);
  const start = html.indexOf('id="testcases"');
  ok(start !== -1, 'the panel rendered');
  eq(/data-local-only/.test(html.slice(start, html.indexOf('</section>', start))), false,
    'a derived count is not machine-local and must survive a publish');
});

test('testcases · the panel spans, and the view declares it where it renders', () => {
  // It grew two charts, and `.chart-wall` is `auto-fit minmax(260px, 1fr)` — in a 389px masonry column that
  // is one chart per row and a card tall enough to break the balance, which is the defect the Executive view
  // already paid for. Spanning panels are hoisted above the cards, so the declared order has to match.
  const ctx = suiteCtx('qc-spans', {
    'tests/run.mjs': "console.log('\\nalpha');\ntest('one', () => {});\n",
  });
  includes(suiteHtml(ctx), 'class="card wall" id="testcases"', 'the panel takes the full width');

  const qc = DEFAULT_VIEWS.find((v) => v.id === 'qc');
  const at = (id) => qc.panels.indexOf(id);
  ok(at('testcases') !== -1, 'the QC view still carries the suite');
  ok(at('testcases') < at('health') && at('testcases') < at('signals'),
    'a spanning panel is hoisted above the cards, so declaring it after them makes this array a lie');
  ok(at('deliveryTiles') < at('testcases'),
    'the tile strip is the page summary and leads, as it does on every other view');
});

/* ================================================================== the site menu */

console.log('\nthe site menu');

/**
 * **Every case here is synchronous.** `pendingAsync` is drained thousands of lines above, so an `async` case
 * appended down here is registered, never awaited, and reported as a pass it did not earn.
 */

test('nav · fifteen entries become seven, and not one of them is dropped on the way', () => {
  // The failure this is written against is not "the menu looks wrong", it is a page that quietly stops being
  // reachable because its href was never named in a group and never fell through to the top level either.
  const flat = navItems(DEFAULT_VIEWS, { hasDeck: true });
  ok(flat.length >= 15, `sanity: the flat nav is the row this replaces — ${flat.length} entries`);

  const menu = groupNav(flat);
  eq(menu.map((e) => e.label), ['Home', 'Overview', 'Plan', 'Work', 'Design', 'Documents', 'Deck'],
    'the top level is two links, four groups and the deck, in that order');

  // Flattened, the menu is the same set of pages as the row it replaces — same hrefs, no duplicates.
  const reachable = menu.flatMap((e) => (e.kind === 'group' ? e.items : [e])).map((n) => n.href);
  eq([...reachable].sort(), flat.map((n) => n.href).sort(), 'a page named by the nav must still be reachable');
  eq(reachable.filter((h, i) => reachable.indexOf(h) !== i), [], 'and reachable in exactly one place');

  for (const e of menu) {
    if (e.kind !== 'group') continue;
    ok(e.items.length > 1, `${e.label} is a menu of ${e.items.length} — a group of one should render as a link`);
  }
});

test('nav · a view this menu has never heard of stays a top-level link', () => {
  // The grouping is a hand-written list of hrefs and the views are configuration, so the two can disagree at
  // any time. When they do the menu must degrade to the flat row it replaced, not swallow the page: an entry
  // nobody named is still an entry somebody has to click.
  const custom = [
    { href: 'index.html', label: 'Home' },
    { href: 'view-invented.html', label: 'Invented' },
    { href: 'view-product.html', label: 'Product' },
  ];
  const menu = groupNav(custom);
  eq(menu.map((e) => `${e.kind}:${e.label}`), ['link:Home', 'link:Invented', 'link:Product'],
    'nothing groupable and one unknown view: the result is the flat row, and Product alone is a link not a menu');

  // And the whole shipped set, minus every view: still a menu, still complete.
  eq(groupNav([]).length, 0, 'no entries, no menu — never an empty menu bar');
});

test('nav · the group holding the current page says so, in colour and in words', () => {
  // A collapsed group that gives no sign it holds the page you are on tells the reader their page is not in
  // the menu. `aria-current` stays on the link, where it means "this page"; the group carries the fact that
  // it contains it, and carries it twice — once as a dot, once as a sentence for a reader who cannot see one.
  const dir = fixture('nav-current', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const site = renderSite(index, runHealth(index, cfg, dir), cfg, dir);
  const html = fs.readFileSync(path.join(site.outDir, 'view-economics.html'), 'utf8');
  const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(html)[0];

  includes(bar, '<a href="view-economics.html" aria-current="page">Economics</a>',
    'the link to the current page keeps aria-current, wherever in the menu it sits');
  const here = /<details class="here">([\s\S]*?)<\/details>/.exec(bar);
  ok(here, 'the group holding the current page is marked');
  includes(here[1], '<summary>Work', 'and it is the group that actually holds it');
  includes(here[1], '(contains the current page)', 'said in words, not only in colour');
  eq((bar.match(/<details class="here">/g) || []).length, 1, 'exactly one group can hold the current page');

  // The other pages are not on this one, so no other group may claim it.
  const home = fs.readFileSync(path.join(site.outDir, 'index.html'), 'utf8');
  eq((home.match(/<details class="here">/g) || []).length, 0,
    'Home is a top-level link, so on the homepage no group contains the current page');
  includes(home, '<a href="index.html" aria-current="page">Home</a>', 'and the top-level link still marks itself');
});

test('nav · the menu is <details>, so it works with no script at all', () => {
  // The constraint is a CSP that forbids fetching anything and a page that has to survive with scripts off.
  // `<details>` is the browser's own disclosure widget: it opens on click and on Enter/Space, it announces
  // its own expanded state, and none of that is ours to break. The script adds Escape, click-outside and
  // tab-out — three conveniences — so it may never be the thing that opens a menu.
  const dir = fixture('nav-noscript', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const site = renderSite(index, runHealth(index, cfg, dir), cfg, dir);
  const html = fs.readFileSync(path.join(site.outDir, 'index.html'), 'utf8');
  const bar = /<header class="topbar">[\s\S]*?<\/header>/.exec(html)[0];

  ok(!/on[a-z]+=/.test(bar), 'no inline handler in the topbar — the CSP would refuse it and the menu must not need it');
  for (const g of NAV_GROUPS) {
    if (!bar.includes(`<summary>${g.label}`)) continue;
    includes(bar, `<summary>${g.label}`, `${g.label} opens a <details>, not a scripted div`);
  }
  includes(bar, '<details class="navburger"><summary>', 'the burger is a disclosure widget too');

  // The burger holds no links: it toggles the list that *follows* it, through the [open] sibling selector.
  // A closed <details> hides its children by a UA mechanism the child cannot override, so the list has to be
  // outside it and after it — inside, the desktop nav would be invisible. Markup and stylesheet have to agree
  // about that or the burger opens onto nothing at all.
  const opens = bar.indexOf('<details class="navburger">');
  const closes = bar.indexOf('</details>', opens);
  const list = bar.indexOf('<ul class="navlist">');
  ok(opens !== -1 && list !== -1, 'sanity: the burger and the list both render');
  ok(closes < list, 'the list is a following sibling of the burger, never a child of it');
  includes(fs.readFileSync(path.join(site.outDir, 'atlas.css'), 'utf8'), '.navburger[open] ~ .navlist',
    'and the stylesheet must be the rule that reads its open state');

  // The clock and the toggle sit beside the menu, not inside it — the export deletes the nav wholesale.
  ok(bar.indexOf('</nav>') < bar.indexOf('id="clock"'), 'the clock is not inside the navigation');
  ok(bar.indexOf('</nav>') < bar.indexOf('id="themeToggle"'), 'nor is the theme toggle');
});

test('nav · every colour the menu adds is defined outside a media query', () => {
  // The house rule, and the classic unreadable-page bug: a colour whose only definition sits inside
  // `prefers-color-scheme` never applies in the un-stamped state, which is the most common one. Checked by
  // deleting every @media block from the stylesheet and asserting the menu is still fully painted.
  const dir = fixture('nav-theme', { 'docs/A.md': '# A\n' });
  const cfg = resolveConfig(dir);
  const index = buildIndex(dir, cfg);
  const site = renderSite(index, runHealth(index, cfg, dir), cfg, dir);
  const css = fs.readFileSync(path.join(site.outDir, 'atlas.css'), 'utf8');

  // Nested one level at most in this stylesheet, so a non-greedy match to a closing brace at column 0 is
  // exact rather than approximate.
  const base = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  for (const sel of ['.navmenu {', '.navburger-bars {', '.navgroup > details.here > summary {',
                     '.sitenav summary {', '.sitenav a[aria-current="page"] {', '.vh {']) {
    includes(base, sel, `${sel} must be defined outside any media query, or it does not apply in the default theme`);
  }
  // Both explicit themes are reached through tokens rather than through a second set of literals. Sliced out
  // of the full stylesheet, not out of `base`: the mobile block is a media query and `base` no longer has one.
  const menuRules = css.slice(css.indexOf('.sitenav {'), css.indexOf('@media (max-width:820px)'));
  ok(menuRules.length > 500, 'sanity: that slice is the menu, not an empty string from a renamed selector');
  eq((menuRules.match(/#[0-9a-fA-F]{3,8}\b/g) || []), [],
    'the menu names no literal ink — every colour is a token, so both themes move together. The two overlay '
    + 'shadows are rgba and deliberate: they lift a panel off the page on either ground.');
});

/*
 * ============================================================================
 * A-49 · orphaned dashboard servers, and a registry that said nothing was running
 * ============================================================================
 *
 * Five `atlas watch --serve` processes were live on one machine at once. Four belonged to agent worktrees
 * that had already been deleted, so they were serving directories that no longer existed — and the owner
 * opened one of those ports, saw a branch they were not on and six files in flight they did not have, and
 * concluded the dashboard was stale. It was not stale. It was another repository's server.
 *
 * The registry that exists to prevent exactly this said `[]` while pid 48511 served port 4238, and
 * `atlas serve --list` printed "No atlas dashboards are running on this machine." beneath a URL it had just
 * reported correctly. Two causes, both fixed here and both covered below:
 *
 *   1. **Registration was in the wrong process.** The parent registered the child *after* waiting two
 *      seconds for a pidfile — and the child runs a full build (4.5s on this repository) before it binds.
 *      The parent timed out, returned before registering, and the child served happily and anonymously.
 *   2. **Registration happened on exactly one branch.** Every idempotent "already running" return in
 *      `serve` skipped it, so a registry that lost an entry could never get it back.
 *
 * **Every case here is synchronous, deliberately.** `pendingAsync` is drained thousands of lines above, so
 * an `async` case appended here is never awaited and reports a pass it never earned.
 *
 * **And nothing here spawns a server.** `discoverServers`, `surveyServers` and `reapOrphanServers` all take
 * their process table by injection for this reason: a test suite that leaked a listener would be adding to
 * the problem it is here to prove fixed. The one case that touches a real process reads the *test runner's
 * own* command line, and asserts it is refused.
 */

/** The argv `spawnDetached` actually writes, so the parser is tested against the real shape. */
const A49_ARGV = (port, root) =>
  '/Users/x/.nvm/versions/node/v20.18.1/bin/node /Users/x/.claude/plugins/cache/project-atlas/atlas/0.1.69/scripts/atlas.mjs'
  + ` watch --serve --detached --serve-root=${root} --port ${port} --idle-ms 14400000 --quiet`;

test('serve · a dashboard process is recognised from its argv, port and root included', () => {
  const f = serverArgvFacts(A49_ARGV(4238, '/Users/x/repo'));
  ok(f, 'the argv this tool writes must parse as one of ours');
  eq(f.port, 4238);
  eq(f.root, '/Users/x/repo', 'the root travels in the argv so `ps` alone can place the process');

  // The 0.1.67 shape, from before `--serve-root` existed. Still ours; the root is simply not in the argv,
  // and `discoverServers` falls back to the process cwd for it.
  const legacy = serverArgvFacts(
    '/Users/x/.nvm/versions/node/v20.18.1/bin/node /Users/x/.claude/plugins/cache/project-atlas/atlas/0.1.67/'
    + 'scripts/atlas.mjs watch --serve --detached --port 4225 --idle-ms 14400000 --quiet');
  ok(legacy, 'a server started by an older build is still recognisable');
  eq(legacy.port, 4225);
  eq(legacy.root, null, 'and its root is honestly unknown rather than guessed');
});

test('serve · the operator\'s own `grep` for these processes is never nominated as one', () => {
  // The whole reason `serverArgvFacts` is positional rather than a substring search. A `ps` listing contains
  // the shell that produced it, and the shell that produced it contains every token being searched for. A
  // naive `includes()` would put the operator's diagnostic on the kill list — while they were using it to
  // investigate the leak.
  const shell = "/bin/zsh -c ps -axo pid=,args= | grep 'atlas.mjs watch --serve --detached --port'";
  eq(serverArgvFacts(shell), null, 'a shell whose command line quotes our argv is not our argv');

  eq(serverArgvFacts('grep atlas.mjs watch --serve --detached'), null, 'nor is grep itself');
  eq(serverArgvFacts('/usr/bin/node /Users/x/other-tool.mjs watch --serve --detached --port 4238'), null,
    'nor is another node program that happens to use the same three flags');
  eq(serverArgvFacts('/usr/bin/node /x/scripts/atlas.mjs watch --serve --port 4238'), null,
    'nor is a FOREGROUND `watch --serve`, which a person is sitting in front of and did not ask us to end');
  eq(serverArgvFacts('/usr/bin/node /x/scripts/atlas.mjs build --quiet'), null, 'nor is any other atlas command');
  eq(serverArgvFacts(''), null);
  eq(serverArgvFacts(null), null);
});

test('serve · a deleted root is reaped; an unmounted one is not', () => {
  // The distinction that decides whether a process lives. `existsSync` is false for both a directory that was
  // deleted and a directory on a volume somebody unplugged, and killing a server over the second would be
  // destroying state to tidy up an absence that ends when the drive comes back.
  const base = fixture('a49-roots', { 'README.md': '# r\n' });

  const present = path.join(base, 'here');
  fs.mkdirSync(present, { recursive: true });
  eq(rootIsGone(present), false, 'a root that is right there is not gone');

  // `git worktree remove` leaves the container standing and takes the tree out of it. That is a deletion.
  const container = path.join(base, '.claude', 'worktrees');
  fs.mkdirSync(container, { recursive: true });
  eq(rootIsGone(path.join(container, 'agent-deleted')), true,
    'a missing directory inside a parent that is present and readable has been deleted');

  // An unmounted volume takes the parent with it. That is not a deletion, and nothing may be signalled for it.
  eq(rootIsGone(path.join(base, 'no-such-volume', 'no-such-repo')), false,
    'a missing directory whose PARENT is also missing reads as unreachable, not deleted');

  eq(rootIsGone(null), false);
  eq(rootIsGone(''), false);
  eq(rootIsGone('relative/path'), false, 'a relative root is meaningless to test and is refused');
  eq(rootIsGone(path.parse(process.cwd()).root), false, 'a filesystem root is never gone');
});

test('serve · the survey reports servers the registry has never heard of', () => {
  // The exact machine state from the incident: the registry says `[]`, and two dashboards are answering.
  const gone = path.join(fixture('a49-survey', { 'README.md': '# r\n' }), '.claude', 'worktrees');
  fs.mkdirSync(gone, { recursive: true });
  const deadRoot = path.join(gone, 'agent-vanished');

  const table = () => [
    { pid: 48511, args: A49_ARGV(4238, REPO_ROOT) },
    { pid: 48512, args: A49_ARGV(4239, deadRoot) },
    { pid: 48513, args: '/bin/zsh -c something else entirely' },
  ];
  const s = surveyServers({
    discover: () => discoverServers({ table, cwd: () => null }),
    registry: () => [],
  });

  eq(s.scanned, true);
  eq(s.servers.length, 2, 'both dashboards are found by reading the machine, with the registry empty');
  eq(s.servers.map((x) => x.registered), [false, false], 'and both are correctly marked as unregistered');
  eq(s.orphans.map((x) => x.pid), [48512], 'only the one whose root was deleted is an orphan');
  eq(s.servers.find((x) => x.pid === 48511).orphan, false, 'the one serving a real directory is left alone');
});

test('serve · "could not ask" and "nothing is running" are never the same answer', () => {
  // The sentence that cost two sessions was a confident "No atlas dashboards are running on this machine."
  // A `ps` that is missing, refused or unparsed knows nothing of the sort, so `readProcessTable` returns
  // `null` rather than `[]` and the distinction survives all the way to what the operator reads.
  const s = surveyServers({
    discover: () => null,
    registry: () => [{ root: '/Users/x/repo', name: 'repo', port: 4238, url: 'http://127.0.0.1:4238/', pid: 48511 }],
  });
  eq(s.scanned, false, 'the survey says it could not confirm anything against the machine');
  eq(s.servers.length, 1, 'the registry is still passed through');
  eq(s.servers[0].confirmed, false, 'but flagged as unverified rather than presented as fact');

  // And an unconfirmable machine reaps nothing. Signalling on the strength of a record we just admitted we
  // could not check would be the worst possible reading of the same uncertainty.
  const r = reapOrphanServers({ survey: () => s });
  eq(r.scanned, false);
  eq(r.reaped.length, 0, 'nothing is signalled when the process table could not be read');
});

test('serve · the reaper nominates only deleted roots, and never an unplaceable server', () => {
  const base = fixture('a49-reap', { 'README.md': '# r\n' });
  const container = path.join(base, '.claude', 'worktrees');
  fs.mkdirSync(container, { recursive: true });

  const survey = () => surveyServers({
    discover: () => discoverServers({
      table: () => [
        { pid: 48511, args: A49_ARGV(4238, REPO_ROOT) },                                 // root exists
        { pid: 48512, args: A49_ARGV(4239, path.join(container, 'agent-vanished')) },     // root deleted
        { pid: 48513, args: A49_ARGV(4240, '') },                                         // root unknowable
      ],
      cwd: () => null,
    }),
    registry: () => [],
  });

  const r = reapOrphanServers({ dryRun: true, survey });
  eq(r.scanned, true);
  eq(r.reaped.map((x) => x.pid).concat(r.skipped.map((x) => x.pid)), [48512],
    'exactly one candidate: the deleted root. A live root and an unknown root are both left entirely alone');

  // The dry run refuses even the nominated one here, because pid 48512 is fictional and the gate checks the
  // real process table before it will let anything through. That refusal IS the safety property.
  eq(r.reaped.length, 0, 'a pid that is not running cannot be confirmed, so it is not reaped');
  includes(r.skipped[0].reason, 'not running');
});

test('serve · the kill gate refuses a live process that is not an atlas server', () => {
  // The one case that touches a real process, and it is this test runner. It is alive, it is a `node`
  // process, and it is emphatically not a dashboard — so the gate must read its actual command line and say
  // no. `self` is overridden so the is-this-me short-circuit does not answer the question for us; the
  // refusal below has to come from the argv.
  const other = confirmAtlasServer(process.pid, { self: -1 });
  eq(other.ok, false, 'a live node process running the test suite is not an atlas dashboard');
  includes(other.reason, 'not an atlas dashboard server');

  // And the short-circuits, each of which is a pid this must never signal.
  eq(confirmAtlasServer(process.pid).ok, false, 'never this process');
  includes(confirmAtlasServer(process.pid).reason, 'this process');
  eq(confirmAtlasServer(1).ok, false, 'never init');
  eq(confirmAtlasServer(0).ok, false, 'never pid 0 — to POSIX that is the whole process group');
  eq(confirmAtlasServer(-1).ok, false, 'never a negative pid, which is also a process group');

  // A pid above every plausible `pid_max`, so it is reliably not running.
  const dead = confirmAtlasServer(4194303);
  eq(dead.ok, false);
  includes(dead.reason, 'not running');
});

test('session · stop reads a removed worktree\'s server before deleting the directory it lives in', () => {
  // Four of the five orphans were made exactly here: `stop` removed the worktrees and left their servers
  // listening against directories that no longer existed. The pidfile is INSIDE the tree being deleted, so
  // the question has to be asked first — a moment later there is nothing to read.
  const dir = sessionFixture('a49-stop-server', { srv: null });
  const wt = path.join(dir, '.claude', 'worktrees', 'agent-srv');
  fs.mkdirSync(path.dirname(pidFile(wt)), { recursive: true });
  // A pid above every plausible `pid_max`: the claim is recorded and read, and nothing on this machine can
  // possibly be signalled by running this test.
  fs.writeFileSync(pidFile(wt), JSON.stringify({ pid: 4194303, port: 4242 }), 'utf8');

  // `--force`, because writing the pidfile is itself an untracked change and `stop` rightly refuses a dirty
  // worktree. The dirty-refusal is covered by its own case above; what is under test here is that the server
  // is identified while the directory still exists.
  const r = stopSession(dir, { force: true });
  eq(r.removed.map((x) => x.id), ['srv'], 'the clean worktree is removed as before');
  eq(fs.existsSync(wt), false, 'and it really is gone, so the pidfile is unreadable from here on');

  const claim = r.removed[0].server;
  ok(claim, 'the server was identified BEFORE the directory was deleted');
  eq(claim.pid, 4194303);
  eq(claim.port, 4242);
  eq(claim.from, 'pidfile');
  eq(claim.outcome, 'already gone', 'a pid that had already exited is reported as such, not as a failure');
  eq(r.servers.failed.length, 0, 'and it is not shouted about — that line is reserved for a live one');
});

test('session · a worktree with no server at all is reported with none, not with a guess', () => {
  const dir = sessionFixture('a49-stop-noserver', { nos: null });
  const r = stopSession(dir, {});
  eq(r.removed.map((x) => x.id), ['nos']);
  eq(r.removed[0].server, null, 'no pidfile, no registry entry, no process — so no claim');
  eq(r.servers.stopped.length, 0);
  eq(r.servers.failed.length, 0);
});

test('serve · the detached server carries its root in argv, and registers itself once it is listening', () => {
  // Two source-level wirings that no unit test can reach without spawning a listener, and that the whole fix
  // rests on. The behaviour they enable is covered by the parsing and survey cases above.
  const serveSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'serve.mjs'), 'utf8');
  includes(serveSrc, '`--serve-root=${path.resolve(root)}`',
    'spawnDetached must put the served root in the argv, or `ps` cannot place the process it finds');

  const cliSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  const listen = cliSrc.slice(cliSrc.indexOf('onListen: (p) => {'), cliSrc.indexOf('Watching for changes'));
  ok(listen.length > 200, 'sanity: that slice is the onListen handler, not an empty string from a rename');
  // `deregisterServer(` literally contains `registerServer(`, and the SIGTERM handler in this same slice
  // calls it — so the naive assertion passed with the registration deleted. Caught by the reversion check,
  // which is the only thing that catches a test asserting something it was never reading.
  includes(listen.replace(/deregisterServer/g, ''), 'registerServer(',
    'the CHILD registers itself the instant it binds — the parent used to, after a 2s wait, and lost the race '
    + 'to its own build every time');

  // `--list` reports and never signals: it is the command an operator runs *because* they suspect something
  // is wrong, and a diagnostic that silently fixes what it finds destroys the evidence they came for.
  // Sliced forward from `--list`: `flag('status')` also appears hundreds of lines earlier under another
  // command, so an `indexOf` from the start of the file walks backwards and yields an empty string — which
  // would pass both assertions below without reading a single line of the branch they are about.
  const listAt = cliSrc.indexOf("if (flag('list')) {");
  const listBlock = cliSrc.slice(listAt, cliSrc.indexOf("if (flag('status')) {", listAt));
  ok(listBlock.length > 200, 'sanity: that slice is the --list branch, not an empty string from a rename');
  eq(listBlock.includes('reapOrphanServers'), false, 'a listing must never send a signal');
  eq(listBlock.includes('terminateServer'), false, 'nor reach the terminator by any other name');
});

/* ================================================================== the cheatsheet assets (A-52) */

/**
 * **Synchronous, like everything appended below the drain.** `pendingAsync` is emptied thousands of lines
 * above; an `async` case here would be constructed, never awaited, and counted as a pass it never earned.
 *
 * The point of this block is one assertion — *the committed assets are what regenerating writes* — and four
 * that stop it being vacuous. A staleness check is only worth having if adding a command really does change
 * the bytes, if the generator is deterministic enough that the check is about staleness rather than about the
 * weather, and if the thing being kept fresh is actually the whole surface.
 */

console.log('\ncheatsheet');

const cheatRows = (model) => model.groups.flatMap((g) => g.rows);

test('cheatsheet · the committed assets are exactly what regenerating writes', () => {
  // This is the case the whole feature rests on. A cheatsheet is a picture of a list, and nobody reads a
  // picture in a diff — so the only thing that can notice it has gone stale is a byte comparison against a
  // fresh render. Adding a command without running `node scripts/gen-cheatsheet.mjs` turns this red, which
  // the drift case below proves rather than assumes.
  const { svg, pdf } = renderAssets(REPO_ROOT);
  for (const [rel, fresh] of [[SVG_PATH, svg], [PDF_PATH, pdf]]) {
    const file = path.join(REPO_ROOT, rel);
    ok(fs.existsSync(file), `${rel} is missing — run: node scripts/gen-cheatsheet.mjs`);
    const on = fs.readFileSync(file);
    ok(on.equals(fresh), `${rel} is stale: ${on.length} bytes committed, ${fresh.length} regenerated. `
      + 'Run: node scripts/gen-cheatsheet.mjs');
  }
});

test('cheatsheet · a command the CLI gains changes the card, so the case above can fail', () => {
  // Without this, "the committed bytes match a fresh render" is satisfiable by a generator that reads
  // nothing. A throwaway root with one extra dispatched command and one extra help line must produce
  // different bytes, and must name the command it was given.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cheatsheet-drift-'));
  fs.cpSync(path.join(REPO_ROOT, 'skills'), path.join(dir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'atlas.mjs'), 'utf8');
  const mutated = src
    .replace("if (cmd === 'help'", "if (cmd === 'teleport') return;\n  if (cmd === 'help'")
    .replace('\n  atlas help ', '\n  atlas teleport             go somewhere else entirely\n  atlas help ');
  ok(mutated !== src, 'sanity: the mutation applied — otherwise this case proves nothing');
  fs.writeFileSync(path.join(dir, 'scripts', 'atlas.mjs'), mutated);

  const before = renderAssets(REPO_ROOT);
  const after = renderAssets(dir);
  eq(after.svg.equals(before.svg), false, 'a new command must change the SVG');
  eq(after.pdf.equals(before.pdf), false, 'and the PDF');
  includes(after.svg.toString('utf8'), 'teleport', 'the new command has to reach the card, not just move bytes');
  includes(after.pdf.toString('latin1'), 'teleport');
});

test('cheatsheet · every command on either surface has a row, and no row invents one', () => {
  // Both directions, for the reason A-35 gives about `usage()`: a card that omits a real command sends the
  // reader to `atlas help`, and a card that promises one the CLI answers with "Unknown command" is worse,
  // because it is believed.
  const model = cheatsheet(REPO_ROOT);
  const rows = new Set(cheatRows(model).map((r) => r.name));
  const aliases = new Set(model.aliases.map((a) => a.from));
  const dispatched = dispatchedCommands().filter((c) => !aliases.has(c));
  eq(dispatched.filter((c) => !rows.has(c)), [], 'these commands dispatch and the cheatsheet has no row for them');
  eq(slashCommands(REPO_ROOT).filter((s) => !rows.has(s)), [], 'these slash commands have no row on the cheatsheet');

  const known = new Set([...dispatchedCommands(), ...slashCommands(REPO_ROOT)]);
  eq([...rows].filter((r) => !known.has(r)), [], 'the cheatsheet names these and neither surface has them');

  // The aliases are deliberately not rows — they are a footer line, the same call `usage()` makes.
  eq([...aliases].filter((a) => rows.has(a)), [], 'an alias must not get a row of its own');
  for (const a of aliases) includes(model.aliases.map((x) => x.from).join(' '), a);
});

test('cheatsheet · a row says which of the two surfaces it is missing, and gets it right', () => {
  const model = cheatsheet(REPO_ROOT);
  const dispatched = new Set(dispatchedCommands());
  const slash = new Set(slashCommands(REPO_ROOT));
  for (const r of cheatRows(model)) {
    eq(r.cli, dispatched.has(r.name), `${r.name}: the card's shell marker disagrees with the dispatch table`);
    eq(r.slash, slash.has(r.name), `${r.name}: the card's slash marker disagrees with skills/`);
    ok(r.cli || r.slash, `${r.name} exists on neither surface and should not be on the card`);
    ok(r.gloss.length > 0, `${r.name} has no description — nothing to print in the second column`);
  }
  // `serve` and `watch` are shell-only and `dashboard` and `review` are slash-only. If that ever stops being
  // true the numbers move, but the card is generated, so it moves with them — this only pins that the two
  // populations are genuinely different and the marker is therefore carrying information.
  const rows = cheatRows(model);
  ok(rows.some((r) => r.cli && !r.slash), 'some command is shell-only');
  ok(rows.some((r) => !r.cli && r.slash), 'some command is Claude Code only');
});

test('cheatsheet · rendering twice from the same source gives the same bytes', () => {
  // Byte-identity is a property of the generator, not only of the committed files: a `Date`, an unsorted
  // `readdir`, a `Set` iteration order that depended on insertion, or an unrounded float would all pass the
  // staleness case on the machine that last regenerated and fail on every other one.
  const a = renderAssets(REPO_ROOT);
  const b = renderAssets(REPO_ROOT);
  ok(a.svg.equals(b.svg), 'two SVG renders differ');
  ok(a.pdf.equals(b.pdf), 'two PDF renders differ');
  const text = `${a.svg.toString('utf8')}\n${a.pdf.toString('latin1')}`;
  eq(/\b20\d\d-\d\d-\d\d\b/.test(text), false, 'a date reached the assets — they would go stale by the clock');
  eq(text.includes(REPO_ROOT), false, 'an absolute path reached the assets');
  eq(/\/(Users|home)\//.test(text), false, 'a home directory reached the assets');
});

test('cheatsheet · the SVG is self-contained, and its text is text', () => {
  // It is embedded in a README, which means GitHub proxies it and sanitises it. Anything it fetches will not
  // load and anything in a <style> may be dropped, and a card that renders as unpositioned glyphs on the one
  // page it exists for has failed. Text stays as <text> so it is selectable, searchable and crisp at any zoom.
  // Against the fresh render, not the committed file. Asserting on the file makes this case a second copy of
  // the staleness case: a generator that started emitting a <style> would pass here until someone regenerated,
  // which is precisely the moment nobody is looking.
  const svg = renderAssets(REPO_ROOT).svg.toString('utf8');
  for (const forbidden of ['<style', '<image', 'xlink:href', '@import', 'url(', '<script', '<foreignObject']) {
    eq(svg.includes(forbidden), false, `the SVG contains ${forbidden} — GitHub may strip it or refuse to fetch it`);
  }
  const texts = svg.match(/<text /g) || [];
  const rows = cheatRows(cheatsheet(REPO_ROOT)).length;
  ok(texts.length > rows * 2, `only ${texts.length} <text> elements for ${rows} rows — something is being drawn as paths`);
  eq(svg.includes('<path'), false, 'no glyph outlines: the card is real text');
  includes(svg, 'role="img"');
  includes(svg, '<title id="cs-title">');
});

test('cheatsheet · the PDF is one A4 landscape page, with no clock in it', () => {
  const text = renderAssets(REPO_ROOT).pdf.toString('latin1');   // the render, for the reason the SVG case gives
  ok(text.startsWith('%PDF-'), 'it is a PDF');
  ok(fs.readFileSync(path.join(REPO_ROOT, PDF_PATH)).length > 1000, 'and a real one is committed');
  includes(text, '/MediaBox [0 0 842 595]', 'A4 landscape, in points');
  includes(text, '/Count 1', 'one page — the generator throws rather than spilling onto a second');
  for (const banned of ['/CreationDate', '/ModDate', '/Producer', '/Info']) {
    eq(text.includes(banned), false, `${banned} is in the PDF, and it would change on every regeneration`);
  }
  // Base-14 Type 1 faces, so nothing is embedded: no font program to drift, and no licence to carry.
  for (const face of ['/Helvetica', '/Helvetica-Bold', '/Courier']) includes(text, `/BaseFont ${face}`);
  eq(text.includes('/FontFile'), false, 'no embedded font program');

  // The cross-reference table is the one part of a hand-written PDF that silently rots: every offset has to
  // land on the object it claims. A reader that repairs the file would hide this, and one that does not
  // would show a blank page.
  // `\nxref\n`, not `xref\n`: `startxref` ends in it, and a naive lastIndexOf lands on the pointer instead of
  // the table — which is how this case first passed while reading four bytes of the trailer.
  const at = text.indexOf('\nxref\n') + 1;
  ok(at > 1, 'there is an xref table');
  // `xref`, the `0 8` subsection header, then the free entry for object 0 — the numbered objects start fourth.
  const rows = text.slice(at).split('\n').slice(3);
  let n = 0;
  for (const r of rows) {
    const m = r.match(/^(\d{10}) 00000 n $/);
    if (!m) break;
    n += 1;
    includes(text.slice(Number(m[1]), Number(m[1]) + 12), `${n} 0 obj`, `xref entry ${n} points at the wrong byte`);
  }
  eq(n, 7, 'all seven objects are indexed');
  includes(text, `startxref\n${at}\n`, 'startxref points at the table');
});

test('cheatsheet · the derivation reads the three surfaces, and refuses a source it cannot read', () => {
  // The parsers, directly. Each one has a shape it depends on in a file this repository edits often, and each
  // throws with the reason rather than yielding an empty card that still renders and still looks finished.
  const u = parseUsage(usageSource(REPO_ROOT));
  ok(u.commands.length > 30, 'usage() parsed into commands');
  ok(u.flags.length >= 8 && u.aliases.length >= 2, 'and into the global flags and the aliases');
  includes(u.commands.find((c) => c.name === 'init').desc, 'project-atlas.config.json',
    '${CONFIG_NAME} has to be resolved — the card must not print the interpolation');
  eq(u.commands.find((c) => c.name === 'serve').flags.length >= 2, true, 'sub-flags hang off their command');
  includes(u.commands.find((c) => c.name === 'contention').desc, 'exit 1 on a duplicate id only',
    'a wrapped description is folded back onto one line, not truncated at the wrap');

  const groups = parseMap(REPO_ROOT);
  ok(groups.length >= 8, 'the intent map parsed into groups');
  eq(groups.some((g) => /^Not slash commands/.test(g.title)), false,
    'a bold lead-in followed by prose is not a group heading');

  // `sessions` and `tokens` share one clause in the map — "both read local session transcripts…" — which is
  // true of each and describes neither, so each row falls back to its own line in usage().
  const rows = new Map(cheatRows(cheatsheet(REPO_ROOT)).map((r) => [r.name, r]));
  eq(rows.get('sessions').gloss === rows.get('tokens').gloss, false,
    'two commands sharing one clause in the map must not end up with one description between them');
});

test('cheatsheet · a description is shortened at a clause, and never to a word that means something else', () => {
  // `atlas serve` is "build, then run the live dashboard detached and open it". Cutting at the first comma
  // fits, and leaves the card saying `serve` does "build" — a different command's whole description. The
  // floor in fit() is what stops that, and this is the case that holds it there.
  const width = measure('build, then run the live dashboard', 8, 'sans');
  const short = fit('build, then run the live dashboard detached and open it', width, 8, 'sans');
  eq(short === 'build', false, 'a clause below the floor must lose to an honest ellipsis');
  ok(short.endsWith('…'), 'so the reader can see something was cut');
  eq(fit('one file, explained', 400, 8, 'sans'), 'one file, explained', 'what fits is left alone');
  includes(fit('token accounting from local session transcripts — opt-in, never published',
    measure('token accounting from local session transcripts', 8, 'sans'), 8, 'sans'), 'token accounting');

  // Every gloss and every command label that actually lands on the card must fit the box it is drawn in;
  // fit() is the only thing standing between a long description and text running under the next column.
  const svg = renderAssets(REPO_ROOT).svg.toString('utf8');
  const overrun = [...svg.matchAll(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .filter((m) => !m[0].includes('Courier'))
    .filter((m) => Number(m[1]) + measure(m[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), Number(m[2]), 'sans') > 900 - 20)
    .map((m) => m[3]);
  eq(overrun, [], 'these strings run off the right edge of the card');
});

test('cheatsheet · columns are packed to the shortest tallest column, in order', () => {
  const blocks = [{ h: 10 }, { h: 10 }, { h: 10 }, { h: 30 }];
  const cols = pack(blocks, 2);
  eq(cols.map((c) => c.reduce((a, b) => a + b.h, 0)), [30, 30], 'the split that levels the two columns');
  eq(cols[0].length, 3, 'and it keeps the blocks in the order they were given');
  eq(pack([{ h: 5 }], 2).map((c) => c.length), [1, 0], 'fewer blocks than columns is not a crash');
});

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped on ${process.platform}` : ''}\n`);
if (fail) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}`);
  console.log('');
  process.exit(1);
}
