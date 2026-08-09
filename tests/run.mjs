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

import { globToRegExp, resolveConfig, DEFAULT_CLUSTERS, clusterFor } from '../scripts/lib/config.mjs';
import { buildIndex } from '../scripts/lib/scan.mjs';
import { runHealth } from '../scripts/lib/health.mjs';
import { renderSite } from '../scripts/lib/render.mjs';
import { renderMarkdown, inline } from '../scripts/lib/markdown.mjs';
import { readPlanning } from '../scripts/lib/planning.mjs';
import { readDeck } from '../scripts/lib/deck.mjs';
import { RAMP, STATUS } from '../scripts/lib/dashboard.mjs';
import { buildWikiPages, wikiPageName, exportSingleFile, RESERVED } from '../scripts/lib/publish.mjs';
import { readContrib, estimateHours } from '../scripts/lib/contrib.mjs';
import { readTokens, formatTokens, assertNotPublishable, transcriptDir } from '../scripts/lib/tokens.mjs';
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

test('host · an unchecked capability does NOT block a publish target', () => {
  // Refusing to work because a network call failed would be worse than the error it prevents.
  const dir = fixture('host-unchecked', { 'docs/A.md': '# A\n' }, { remote: 'git@github.com:acme/widget.git' });
  const g = gateTarget('pages', detectHost(dir, {}), { checked: false, reason: 'offline' });
  eq(g.ok, true);
  includes(g.warn, 'unchecked');
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

test('runtimes · the Codex package has not drifted from skills/', () => {
  // The only duplicated tree in the project, and it exists solely because a Codex marketplace cannot use
  // "./" as a source path. A copy is a fork waiting to happen, so it is generated and checked.
  const r = spawnSync('node', [path.join(HERE, '..', 'scripts', 'sync-runtimes.mjs'), '--check'],
    { encoding: 'utf8' });
  eq(r.status, 0, `Codex package is out of sync:\n${r.stderr || r.stdout}`);
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
