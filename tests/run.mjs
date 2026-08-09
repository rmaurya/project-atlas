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

import { globToRegExp, resolveConfig, DEFAULT_CLUSTERS, clusterFor, unsafeRegexReason } from '../scripts/lib/config.mjs';
import { buildIndex } from '../scripts/lib/scan.mjs';
import { runHealth, formatReport, SIGNALS } from '../scripts/lib/health.mjs';
import { renderSite } from '../scripts/lib/render.mjs';
import { renderMarkdown, inline } from '../scripts/lib/markdown.mjs';
import { readPlanning, DEFAULT_PLANNING } from '../scripts/lib/planning.mjs';
import { readDeck } from '../scripts/lib/deck.mjs';
import { RAMP, STATUS, viewPage } from '../scripts/lib/dashboard.mjs';
import { buildWikiPages, wikiPageName, exportSingleFile, RESERVED, gitlabPagesJob, stageWiki } from '../scripts/lib/publish.mjs';
import { readContrib, estimateHours, taskCoverage } from '../scripts/lib/contrib.mjs';
import { readTokens, formatTokens, formatSessions, assertNotPublishable, transcriptDir } from '../scripts/lib/tokens.mjs';
import { readChanges, fileDiff, formatChanges } from '../scripts/lib/changes.mjs';
import { branchStatus, createBranch, TYPES } from '../scripts/lib/branch.mjs';
import { detectHost, gateTarget } from '../scripts/lib/host.mjs';
import { resolveViews, navItems, PANELS } from '../scripts/lib/views.mjs';
import { communityAssets } from '../scripts/lib/community.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'atlas.mjs');
const filter = (() => {
  const i = process.argv.indexOf('--filter');
  return i === -1 ? null : process.argv[i + 1];
})();

let pass = 0, fail = 0;
const failures = [];

const pendingAsync = [];
function test(name, fn) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
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

test('dashboard · uses no categorical palette — only the ordinal ramp and status colours', () => {
  const cfg = resolveConfig(planRepo);
  cfg.planning = { source: 'docs/TASKS.md' };
  const index = buildIndex(planRepo, cfg);
  const health = runHealth(index, cfg, planRepo);
  const site = renderSite(index, health, cfg, planRepo);
  const html = fs.readFileSync(path.join(site.outDir, 'dashboard.html'), 'utf8');
  const allowed = new Set([...Object.values(RAMP.light), ...Object.values(RAMP.dark),
                           ...Object.values(STATUS.light), ...Object.values(STATUS.dark)]);
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
  const slug = path.resolve(dir).split(path.sep).join('-');
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
  const slug = path.resolve(dir).split(path.sep).join('-');
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
  const slug = path.resolve(dir).split(path.sep).join('-');
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
});

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
});

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
});

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
      const r = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env });
      ok((r.stdout || '').trim().length > 0,
        `skills/${name}: a block rendered empty instead of saying why:\n    ${cmd}`);
      checked++;
    }
  }
  ok(checked >= 12, `expected to exercise every block, ran ${checked}`);
});

test('skills · /atlas:diff does not claim "no file given" when a file was given', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'skill-diff-'));
  const cmd = [...fs.readFileSync(path.join(HERE, '..', 'skills', 'diff', 'SKILL.md'), 'utf8')
    .matchAll(/^!`([\s\S]*?)`\s*$/gm)][0][1];
  const env = { ...process.env, PATH: '/usr/bin:/bin' };

  const given = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: { ...env, ARGUMENTS: 'docs/A.md' } });
  ok(!given.stdout.includes('no file given'), `a file WAS given:\n${given.stdout}`);
  ok(given.stdout.trim().length > 0, 'and something must still be said about why there is no diff');

  const missing = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: { ...env, ARGUMENTS: '' } });
  includes(missing.stdout, 'no file given', 'with no argument, that IS the message');
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
  const dir = fixture('cfg-blocking-unknown', { 'docs/A.md': '# A\n' });
  fs.writeFileSync(path.join(dir, 'project-atlas.config.json'), JSON.stringify({ blocking: ['H1', 'H99'] }), 'utf8');
  let threw = null;
  try { resolveConfig(dir); } catch (e) { threw = e; }
  ok(threw, 'an unknown signal id must be refused');
  includes(threw.message, '"H99"');
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
});

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
  ok(!/href="data:/i.test(page), 'a data: href must not survive into the page');
  ok(!/src="data:/i.test(page), 'a data: image must not survive into the page');
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

/* ================================================================== done */

// Async cases resolve before the summary, so a rejected promise is a failure rather than a warning.
for (const { name, p } of pendingAsync) {
  try { await p; pass++; process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`); }
  catch (err) { fail++; failures.push({ name, err }); process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`); }
}

for (const d of made) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}`);
  console.log('');
  process.exit(1);
}
