/**
 * project-atlas · static site generation
 *
 * Every page carries a banner saying it is derived and linking to its source, because the one way this system
 * fails badly is someone editing the output and losing the work. Output is deterministic: no timestamps except
 * those read from git, stable ordering everywhere, so a rebuild with no source change yields an empty diff.
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, escapeHtml, escapeAttr } from './markdown.mjs';
import { confine } from './paths.mjs';
import { SIGNALS } from './health.mjs';
import { readPlanning } from './planning.mjs';
import { viewPage } from './dashboard.mjs';
import { readDeck, deckPage } from './deck.mjs';
import { readContrib, taskCoverage } from './contrib.mjs';
import { writeKnowledgeGraph, KB_DIR } from './kb.mjs';
import { readInflight } from './inflight.mjs';
import { resolveViews, navItems, viewFile } from './views.mjs';
import { risks, summarise } from './insight.mjs';
import { repoComponents, scorecard } from './score.mjs';
import { testInventory } from './testcases.mjs';
import { execFileSync } from 'node:child_process';
import { PANELS } from './views.mjs';

export { flatName } from './render-shared.mjs';
import { flatName, pageNames, jsonForScript } from './render-shared.mjs';
import { num } from './format.mjs';

/**
 * Files every **completed** build of this tool writes into its output directory. They are the proof that a
 * finished build owned the directory — see `prepareOutputDir`. They are written near the end, which is
 * exactly why they cannot be the only proof: see `BUILD_CLAIM`.
 */
export const BUILD_MARKERS = ['README.md', '.gitattributes'];

/**
 * The claim a build stakes on its output directory **before** it writes anything into it, and removes once
 * the completion markers are down. (A-34)
 *
 * `BUILD_MARKERS` answer "did a build finish here". Nothing answered "did a build *start* here", and the
 * window between those two questions is the whole of a build. A build killed inside that window left the
 * directory populated and unmarked — which is byte-for-byte what somebody else's data looks like — so the
 * provenance guard refused every subsequent build and the repository was unbuildable until a human ran
 * `rm -rf` on it by hand.
 *
 * The claim closes the window without opening the guard: it is written by this tool, into a directory this
 * tool had just proved was its own to clear, and it says so on its face. A directory carrying a valid claim
 * is this tool's own wreckage. A directory carrying neither claim nor markers has never been ours, and is
 * still refused.
 *
 * It is deleted on success, which matters twice: a finished build's output stays byte-identical between
 * rebuilds (the claim carries a timestamp and a pid, and would be the second non-deterministic file in a
 * tree whose determinism is a checkable claim), and the *presence* of the file stays meaningful — it means
 * "a build is running here or died here", never "a build once ran here".
 */
export const BUILD_CLAIM = '.atlas-build-claim.json';

/**
 * Is this a claim staked by this tool, on this directory?
 *
 * Checked rather than trusted, because the whole value of the guard is that it does not delete on the
 * strength of a filename. The recorded `output` is the path **relative to the repository root**, so a
 * checkout that moved on disk still recognises its own interrupted build, while a claim copied out of some
 * other directory does not authorise deleting this one.
 */
function readClaim(outDir, root) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(outDir, BUILD_CLAIM), 'utf8'));
    if (c?.tool !== 'project-atlas' || !c.startedAt) return null;
    const rel = path.relative(root, outDir).split(path.sep).join('/');
    return c.output === rel ? c : null;
  } catch { return null; }
}

/**
 * The output directory is **deleted recursively** on every build, and until this existed the path came
 * straight from an unvalidated config key. Two verified outcomes, both destructive and both reported as
 * success: `{"output":"../PRECIOUS"}` removed a directory outside the repository, and `{"output":"."}` removed
 * the repository itself, `.git` included.
 *
 * Two independent guards, because either one alone has a hole:
 *
 *  1. **Containment.** The directory must resolve to somewhere strictly inside the repository — checked
 *     through `realpath` on both sides, so a symlinked `output` cannot point the deletion elsewhere.
 *  2. **Provenance.** A directory that already holds files but carries no evidence this tool wrote them was
 *     written by someone else. `docs/` is a plausible typo for `docs/_wiki`, and the difference between those
 *     two is a day's work. An empty directory, or a missing one, is fine — there is nothing to lose.
 *
 * **Neither guard is relaxed here; the second one was taught to read a second kind of evidence.** (A-34) A
 * completed build proves ownership with `BUILD_MARKERS`; a build that started and never finished proves it
 * with `BUILD_CLAIM`. Anything else still refuses, because deleting a directory you are not certain you own
 * is unrecoverable and refusing to build is not.
 */
function prepareOutputDir(root, cfg) {
  const outDir = confine(root, cfg.output, 'output', cfg.__configPath);

  if (fs.existsSync(outDir)) {
    const stat = fs.lstatSync(outDir);
    if (!stat.isDirectory()) throw new Error(`output resolves to ${outDir}, which is not a directory.`);
    const entries = fs.readdirSync(outDir);
    const finished = BUILD_MARKERS.every((m) => entries.includes(m));
    const interrupted = !finished && !!readClaim(outDir, root);
    if (entries.length && !finished && !interrupted) {
      const rel = path.relative(root, outDir).split(path.sep).join('/') || '.';
      throw new Error(
        `Refusing to delete ${outDir}: it holds ${num(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}, ` +
        `none of the files a completed project-atlas build leaves behind (${BUILD_MARKERS.join(', ')}), ` +
        `and no ${BUILD_CLAIM} from a build that was interrupted.\n` +
        `  A build clears its output directory completely, so this would destroy work that is not derived.\n` +
        `  Do one of these:\n` +
        `    • If \`output\` is pointing at the wrong place, change it in ` +
        `${cfg.__configPath ? path.relative(root, cfg.__configPath) : 'project-atlas.config.json'} — ` +
        `give the build a directory of its own, e.g. "output": "docs/_wiki". Nothing is deleted by fixing this.\n` +
        `    • If everything in ${rel} really is generated and you want it gone, delete it yourself:\n` +
        `        rm -rf ${outDir}\n` +
        `      then build again. This tool will not run that for you — it cannot prove the directory is its own.`);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  // The claim goes down before a single generated byte does, so there is no instant at which this directory
  // is populated and unattributable. Written after the clear, not before it: a claim written before the
  // `rmSync` would be deleted by it, and a claim written into a directory that was refused would hand the
  // next build permission the guard had just withheld.
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, BUILD_CLAIM), JSON.stringify({
    tool: 'project-atlas',
    output: path.relative(root, outDir).split(path.sep).join('/'),
    startedAt: new Date().toISOString(),
    pid: process.pid,
    note: 'A build is writing this directory, or died writing it. Everything here is derived and safe to delete.',
  }, null, 2) + '\n', 'utf8');

  return outDir;
}

/**
 * Release the claim. Called only once the completion markers are on disk, so the two states are never both
 * true and never both false: while a build is in flight the claim is the proof, and afterwards the markers
 * are. (A-34)
 */
function releaseOutputDir(outDir) {
  fs.rmSync(path.join(outDir, BUILD_CLAIM), { force: true });
}

export function renderSite(index, health, cfg, root) {
  const outDir = prepareOutputDir(root, cfg);
  const pagesDir = path.join(outDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  const byPath = new Map(index.documents.map((d) => [d.path, d]));
  const toRoot = path.relative(pagesDir, root).split(path.sep).join('/') || '.';

  // One name per document, collisions resolved and reported rather than left to overwrite each other.
  const { nameOf, collisions } = pageNames(index.documents.map((d) => d.path));
  const nameFor = (p) => nameOf.get(p) || flatName(p);

  const resolveFrom = (docPath) => (href) => {
    // `data:` is deliberately gone from this list. It used to be treated as an external scheme and passed
    // through untouched, which made every document able to embed arbitrary content in a published page.
    if (/^(https?:|mailto:|tel:|#)/i.test(href)) return { href, cls: '' };
    const [target, anchor] = href.split('#');
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docPath), target || ''));
    if (byPath.has(resolved)) return { href: nameFor(resolved) + (anchor ? '#' + anchor : ''), cls: 'wl' };
    if (fs.existsSync(path.join(root, resolved))) return { href: `${toRoot}/${resolved}`, cls: 'src' };
    return { href: `${toRoot}/${resolved}`, cls: 'dead' };
  };

  const plan0 = readPlanning(root, cfg);
  const deck0 = readDeck(root, cfg);
  const views0 = resolveViews(cfg);
  const docNav = navItems(views0, { hasDeck: !!deck0 }).map((n) => ({ ...n, current: false }));

  let truncated = 0;
  const searchRows = [];
  // The count that gets reported. Taken from the writes, never from `index.documents.length`: a count read
  // from the index is a count that cannot notice two documents landing on one file.
  const written = new Set();

  for (const d of index.documents) {
    const findings = health.findings.filter((f) => f.doc === d.path && !f.suppressed);
    const body = renderMarkdown(d.body, { resolveLink: resolveFrom(d.path) });
    const file = nameFor(d.path);
    fs.writeFileSync(path.join(pagesDir, file), docPage(d, body, findings, index, cfg, toRoot, docNav, nameFor), 'utf8');
    written.add(file);

    const limit = cfg.searchBodyLimit || 6000;
    const text = d.body.replace(/\s+/g, ' ').trim();
    if (text.length > limit) truncated++;
    searchRows.push({
      p: d.path, t: d.title || d.path, c: d.cluster,
      h: d.headings.filter((h) => h.depth <= 3).map((h) => h.text).join(' · ').slice(0, 600),
      x: d.excerpt, b: text.slice(0, limit), f: file,
    });
  }

  const plan = plan0;
  const deck = deck0;
  const contrib = readContrib(root, cfg);

  // The narrative half of the homepage, and the only prose on it. **The build never writes this** — it renders
  // a markdown file a person or a session authored, which landed in a diff someone reviewed. Absent is the
  // normal state and produces no section at all, rather than a placeholder implying analysis that nobody did.
  const analysisPath = cfg.analysis?.source || 'docs/ANALYSIS.md';
  let analysisHtml = null;
  try {
    const abs = confine(root, analysisPath, 'analysis.source', cfg.__configPath);
    if (fs.existsSync(abs)) {
      analysisHtml = renderMarkdown(fs.readFileSync(abs, 'utf8'), { resolveLink: resolveFrom(analysisPath) });
    }
  } catch { analysisHtml = null; }             // a path outside the repository is refused, not read

  // Tags against declared versions, for the release-marked component. Read, never assumed: a repository with
  // no tags scores zero there, and one with no manifest is omitted from the scorecard entirely.
  let releaseFacts = {};
  try {
    const tags = execFileSync('git', ['-C', root, 'tag', '-l', 'v*'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] })
      .split('\n').filter(Boolean).length;
    const changelog = path.join(root, 'CHANGELOG.md');
    const versions = fs.existsSync(changelog)
      ? new Set([...fs.readFileSync(changelog,'utf8').matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m=>m[1])).size
      : null;
    if (versions) releaseFacts = { tags, versions };
  } catch { /* not a repository, or no tags — the component is omitted rather than guessed */ }

  // **The build date, rendered statically.** It used to be written by the live-reload poll, which the
  // standalone export disables because there is nothing to poll — so the one artifact people actually share
  // was the one page that never said when it was made. Read from git's own HEAD date where possible so a
  // rebuild with no source change still produces an identical file.
  let buildDate = null;
  try {
    // %cI is the commit's own ISO timestamp with its offset — a date, a time and a zone, all of them read
    // rather than generated, so the build stays byte-reproducible. `new Date()` here would put a different
    // string in the file on every run and break that.
    const iso = execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
    if (iso) {
      const d = new Date(iso);
      const offset = iso.slice(-6);
      buildDate = {
        local: `${iso.slice(0, 10)} ${iso.slice(11, 16)} ${offset === 'Z' ? 'UTC' : `UTC${offset}`}`,
        utc: `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`,
      };
    }
  } catch { buildDate = null; }

  // `jsonForScript`, not `JSON.stringify`: this file is inlined verbatim into a <script> tag by
  // `exportSingleFile`, and it carries document body text. See render-shared.mjs for what that cost.
  fs.writeFileSync(path.join(outDir, 'search-index.js'),
    'window.ATLAS = ' + jsonForScript({ docs: searchRows, truncated }) + ';\n', 'utf8');

  // The allowlist `atlas serve` answers source links from — see the `serveSource` note in serve.mjs. It is
  // exactly the documents this build indexed and nothing else, so the server can honour the "edit that file"
  // banner on every page without becoming a file browser over the checkout. Paths only; no content.
  fs.writeFileSync(path.join(outDir, 'sources.json'),
    JSON.stringify(index.documents.map((d) => d.path).sort()), 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(index, health, cfg, truncated, docNav.map((n) => ({ ...n, current: n.href === 'index.html' })), views0, plan, contrib, nameFor, analysisHtml, releaseFacts, buildDate), 'utf8');
  fs.writeFileSync(path.join(outDir, 'wiki.html'), wikiPage(index, cfg, truncated,
    docNav.map((n) => ({ ...n, current: n.href === 'wiki.html' })), nameFor), 'utf8');
  fs.writeFileSync(path.join(outDir, 'health.html'), healthPage(index, health, cfg, docNav.map((n) => ({ ...n, current: n.href === 'health.html' })), nameFor), 'utf8');
  const views = views0;
  const baseNav = docNav;
  // What the QC and Architecture panels read: the tracked file list, and the test inventory taken from it.
  // Computed once here rather than per panel — three panels want the same `git ls-files` and running it
  // three times would make the build slower for no answer it did not already have.
  let repo = { files: [], code: [], tests: null };
  try {
    const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
    repo = {
      files,
      code: files.filter((f) => /\.(m?[jt]sx?|py|go|rs|java|rb|swift|kt|c|h|cpp|cs|php|sh)$/i.test(f)),
      tests: testInventory(root, files),
    };
  } catch { /* not a repository — the panels that need this return null rather than inventing a corpus */ }

  const ctx = { index, health, plan, cfg: { ...cfg, __root: root }, contrib, nameFor, repo };
  for (const v of views) {
    const nav = baseNav.map((n) => ({ ...n, current: n.href === viewFile(v.id) }));
    fs.writeFileSync(path.join(outDir, viewFile(v.id)), viewPage(v, { ...ctx, nav }, shell), 'utf8');
  }
  if (deck) fs.writeFileSync(path.join(outDir, 'deck.html'), deckPage(deck, index, cfg), 'utf8');
  fs.writeFileSync(path.join(outDir, 'atlas.css'), CSS, 'utf8');
  fs.writeFileSync(path.join(outDir, '.gitattributes'), '* linguist-generated=true\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'README.md'), derivedReadme(cfg), 'utf8');

  // **The same derived facts again, as markdown, for the reader who has no browser.**
  //
  // Everything above this line addresses a person looking at a screen. On the corpus this was measured
  // against — 403 source documents, 417 generated files, no `.mcp.json` — an agent holding `Read` and `Grep`
  // could open every source document and reach none of the analysis: taxonomy, backlinks, citation
  // resolution, health, the design record, the plan cross-reference, the memory trail. See kb.mjs for the
  // rule that keeps this from becoming a second copy of the corpus, and for why it lives inside the
  // directory `prepareOutputDir` clears rather than beside it.
  //
  // Written last, because it reads everything the rest of this function assembled: `plan`, `contrib` (for
  // `taskCoverage`) and `repo.code` (for the design-coverage inversion). Recomputing any of them here would
  // be a second `git ls-files` for an answer this function already has.
  const kb = writeKnowledgeGraph({
    outDir, root, index, health, cfg, plan,
    coverage: taskCoverage(contrib, plan),
    // `null`, not `[]`, when git could not answer. An empty list would report every area as uncovered; null
    // makes the page say the check did not run, which is the honest reading and the one the rest of this
    // tool holds to.
    codeFiles: repo.files.length ? repo.code : null,
    nameFor,
  });

  // The build finished. The completion markers are down, so the claim has nothing left to say — and leaving
  // it would make "interrupted" indistinguishable from "done", which is the distinction it exists to draw.
  // Anything that throws above this line leaves the claim in place deliberately: that is the wreckage the
  // next build has to be able to recognise as its own. (A-34)
  releaseOutputDir(outDir);

  return { outDir, pages: written.size, truncated, plan, deck, collisions, kb };
}

/**
 * A stamp the open page polls to notice a rebuild and reload itself. It is the only non-deterministic byte in
 * the output, so it is written separately and excluded from the byte-identical guarantee — `renderSite` stays
 * pure, and this is called by the CLI when a caller asked for live reload.
 */
export function writeBuildStamp(root, cfg, value) {
  const outDir = confine(root, cfg.output, 'output', cfg.__configPath);
  fs.writeFileSync(path.join(outDir, 'build-stamp.txt'), String(value) + '\n', 'utf8');
}


/**
 * The corpus browser. Split off the landing page because the two answer different questions: the landing
 * page says what this project is and where to look; the wiki is where you actually look. Merging them meant
 * a reader scrolling past a search box to reach the dashboards, or past the dashboards to reach the search.
 */
function wikiPage(index, cfg, truncated, nav, nameFor) {
  const clusters = index.clusters.map((c) => {
    const docs = c.documents.map((p) => index.documents.find((d) => d.path === p)).filter(Boolean)
      .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
    return `
<section class="cluster" id="c-${escapeHtml(c.id)}">
  <h2>${escapeHtml(c.title)} <span class="count">${docs.length}</span></h2>
  ${c.blurb ? `<p class="blurb">${escapeHtml(c.blurb)}</p>` : ''}
  <ul class="docs">
    ${docs.map((d) => `<li>
      <a class="dt" href="pages/${escapeAttr(nameFor(d.path))}">${escapeHtml(d.title || d.path)}</a>
      <span class="dm">${d.git ? d.git.date + ' · ' : ''}${num(d.lines)} lines</span>
      ${d.excerpt ? `<span class="dx">${escapeHtml(d.excerpt.slice(0, 190))}</span>` : ''}
      <code class="dp">${escapeHtml(d.path)}</code>
    </li>`).join('\n')}
  </ul>
</section>`;
  }).join('\n');

  const clusterNav = index.clusters.map((c) =>
    `<a href="#c-${escapeHtml(c.id)}">${escapeHtml(c.title)} <span>${c.documents.length}</span></a>`).join('');

  return shell({
    title: `Wiki · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
    nav,
    body: `
<h1><span class="h1-proj">${escapeHtml(index.siteTitle)}</span>Wiki</h1>
<p class="lede">${index.stats.documents} documents · ${num(index.stats.lines)} lines ·
${index.stats.clusters} clusters. Every page is derived from the markdown in this repository — edit the source,
never the page.</p>

<div class="searchbox">
  <input id="q" type="search" placeholder="Search titles, headings and body text…" autocomplete="off" autofocus>
  <p id="qhint" class="hint">${truncated ? `${truncated} long document(s) are indexed to the first ${num(cfg.searchBodyLimit || 6000)} characters.` : 'Full text of every document is indexed.'}</p>
</div>
<div id="results" hidden></div>

<nav class="clusternav">${clusterNav}</nav>
<div id="browse">
${clusters}
</div>
`,
    scripts: `<script src="search-index.js"></script>
<script>${SEARCH_JS}</script>`,
  });
}

const SEARCH_JS = `(function () {
  var q = document.getElementById('q'), res = document.getElementById('results'), browse = document.getElementById('browse');
  var docs = (window.ATLAS && window.ATLAS.docs) || [];
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function score(d, terms) {
    var t = (d.t||'').toLowerCase(), h = (d.h||'').toLowerCase(), b = (d.b||'').toLowerCase(), p = (d.p||'').toLowerCase(), s = 0;
    for (var i=0;i<terms.length;i++) {
      var w = terms[i];
      if (!t.includes(w) && !h.includes(w) && !b.includes(w) && !p.includes(w)) return 0;
      if (t.includes(w)) s += 100;
      if (p.includes(w)) s += 40;
      if (h.includes(w)) s += 20;
      var n = b.split(w).length - 1; s += Math.min(n, 25);
    }
    return s;
  }
  function snippet(d, w) {
    var b = d.b || '', i = b.toLowerCase().indexOf(w);
    if (i < 0) return esc((d.x || '').slice(0, 180));
    var s = Math.max(0, i - 70);
    return (s ? '…' : '') + esc(b.slice(s, s + 190)) + '…';
  }
  function run() {
    var v = q.value.trim().toLowerCase();
    if (v.length < 2) { res.hidden = true; browse.hidden = false; return; }
    var terms = v.split(/\\\\s+/);
    var hits = docs.map(function (d) { return { d: d, s: score(d, terms) }; })
                   .filter(function (x) { return x.s > 0; })
                   .sort(function (a, b) { return b.s - a.s; }).slice(0, 60);
    browse.hidden = true; res.hidden = false;
    res.innerHTML = hits.length
      ? '<p class="hint">' + hits.length + ' match' + (hits.length === 1 ? '' : 'es') + '</p><ul class="docs">' + hits.map(function (x) {
          return '<li><a class="dt" href="pages/' + x.d.f + '">' + esc(x.d.t) + '</a>' +
                 '<span class="dm">' + esc(x.d.c) + '</span>' +
                 '<span class="dx">' + snippet(x.d, terms[0]) + '</span>' +
                 '<code class="dp">' + esc(x.d.p) + '</code></li>';
        }).join('') + '</ul>'
      : '<p class="hint">No match.</p>';
  }
  q.addEventListener('input', run);
  window.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
})();`;

/* ------------------------------------------------------------------ theme */

/**
 * Applied in <head>, before the first paint. Reading the stored choice after the body renders produces a
 * flash of the wrong theme on every navigation, which is worse than not offering a toggle at all.
 *
 * Three states, and "auto" is the absence of a stamp rather than a third value — that is what lets the
 * media query decide, and it is why the toggle removes the attribute instead of setting it to "auto".
 */
const THEME_BOOT = `try{var t=localStorage.getItem('atlas-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

/**
 * The header clock — local time and UTC, updated in the browser.
 *
 * Ticks on a whole-second boundary rather than every 1000ms from load, so the displayed second changes when
 * the second actually changes instead of drifting a fraction behind it. The zone abbreviation comes from the
 * runtime rather than a table: the reader's offset is theirs, and a hardcoded map would be wrong twice a year.
 */
const CLOCK_WIRE = `(function(){
  var el = document.getElementById('clock');
  if (!el) return;
  var zone = (function(){
    try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date()).find(function(p){ return p.type === 'timeZoneName'; }).value; }
    catch (e) { return 'local'; }
  })();
  var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
  function tick(){
    var d = new Date();
    var local = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    var utc = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    var day = d.toISOString().slice(0, 10);
    el.setAttribute('datetime', d.toISOString());
    el.innerHTML = '<span class="clock-date">' + day + '</span>' +
      '<span class="clock-t">' + local + '<span class="clock-z">' + zone + '</span></span>' +
      '<span class="clock-t">' + utc + '<span class="clock-z">UTC</span></span>';
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }
  tick();
})();`;

const THEME_WIRE = `(function(){
  var KEY='atlas-theme', root=document.documentElement, btn=document.getElementById('themeToggle');
  if(!btn) return;
  var order=['auto','light','dark'];
  var glyph={auto:'\u25D0',light:'\u2600',dark:'\u263E'};
  var name={auto:'system',light:'light',dark:'dark'};
  var cur='auto';
  try{ var v=localStorage.getItem(KEY); if(v==='light'||v==='dark') cur=v; }catch(e){}
  function paint(){
    if(cur==='auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme',cur);
    btn.textContent=glyph[cur];
    btn.title='Theme: '+name[cur]+' \u2014 click to change';
    btn.setAttribute('aria-label','Theme: '+name[cur]+'. Click to change.');
  }
  paint();
  btn.addEventListener('click',function(){
    cur=order[(order.indexOf(cur)+1)%order.length];
    try{ if(cur==='auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY,cur); }catch(e){}
    paint();
  });
})();`;

/* ------------------------------------------------------------------ shell */

/**
 * The atlas mark, inlined.
 *
 * Inline and not `<img src>`: the single-file export, the published artifact and the wiki all forbid an
 * external request, and the artifact's CSP blocks one outright — a linked file would work locally and fail
 * in exactly the places this output is built to travel to.
 *
 * One themed mark rather than the two exported variants. Pages have three theme states and the un-stamped
 * one is the most common, so a light/dark pair chosen at build time is wrong for a large share of viewers.
 * Drawn with the brand tokens, it follows the viewer's theme without choosing anything.
 *
 * It sits in the footer, beside "Generated by", and deliberately NOT in the topbar: that slot carries the
 * reader's own `siteTitle`, and stamping this tool's logo on someone else's documentation is not branding,
 * it is trespass.
 */
export const MARK = `<svg class="atlas-mark" viewBox="14 10 100 101" width="18" height="18" aria-hidden="true" focusable="false">
  <path d="M88 108 L26 108 C19.5 108 17.5 102 20 96.5 L56.5 19.5 C58.5 15.5 61 13.5 64 13.5 C67 13.5 69.5 15.5 71.5 19.5 L106.5 93 C108.8 98 106 103 100 103.5" fill="none" stroke="var(--atlas-contour)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M64 28 C61.8 28 60 29.5 58.5 32.5 L33 87.5 C31 92 32.5 96.5 38 96.5 L90 96.5 C95.5 96.5 97 92 95 87.5 L69.5 32.5 C68 29.5 66.2 28 64 28 Z" fill="none" stroke="var(--atlas-contour)" stroke-width="4.2" stroke-linejoin="round"/>
  <path d="M64 44 C62.5 44 61.4 45 60.4 47 L44.5 81 C43 84.2 44.2 87 48 87 L80 87 C83.8 87 85 84.2 83.5 81 L67.6 47 C66.6 45 65.5 44 64 44 Z" fill="var(--atlas-summit)" stroke="var(--atlas-summit)" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="64" cy="70.5" r="6" fill="var(--atlas-benchmark)"/>
</svg>`;

/**
 * The same mark as a favicon, with literal colours.
 *
 * A favicon is fetched by browser chrome, outside the document, so it cannot read a CSS variable — the
 * tokens above are unavailable and the light palette is used. The benchmark dot is the one colour that does
 * not move between themes, which is what keeps the mark legible against either browser chrome.
 */
export const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
  '<path d="M88 108 L26 108 C19.5 108 17.5 102 20 96.5 L56.5 19.5 C58.5 15.5 61 13.5 64 13.5 C67 13.5 69.5 15.5 71.5 19.5 L106.5 93 C108.8 98 106 103 100 103.5" fill="none" stroke="#4E8F84" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M64 44 C62.5 44 61.4 45 60.4 47 L44.5 81 C43 84.2 44.2 87 48 87 L80 87 C83.8 87 85 84.2 83.5 81 L67.6 47 C66.6 45 65.5 44 64 44 Z" fill="#1C3A3E" stroke="#1C3A3E" stroke-width="4" stroke-linejoin="round"/>' +
  '<circle cx="64" cy="70.5" r="6" fill="#E5A33C"/></svg>');

function shell({ title, siteTitle, base = '', body, extraHead = '', scripts = '', nav = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}atlas.css">
<link rel="icon" href="${FAVICON}">
<script>${THEME_BOOT}</script>
${extraHead}
</head>
<body>
<header class="topbar">
  <a class="brand" href="${base}index.html">${MARK}<span class="brand-text">${
    // The wordmark is split so the generic half recedes and the name carries: the same treatment the
    // footer already used, which is why the two disagreed until now. P-4 put the mark in the footer and
    // stopped, so the one place a reader looks for identity — the top-left of every page — stayed a plain
    // text span while the credit line at the bottom was branded.
    siteTitle === 'project-atlas'
      ? '<span class="wordmark"><span>project-</span>atlas</span>'
      : escapeHtml(siteTitle)}</span></a>
  <nav>
    ${(nav || []).map((n) => `<a href="${escapeAttr(base + n.href)}"${n.current ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`).join('\n    ')}
    ${/*
      * **The clock is rendered by the browser, never by the build.**
      *
      * A dashboard people leave open needs to say when "now" is, and both zones: local for the person reading
      * it, UTC because every stamp this tool writes — build stamps, journal records, commit times — is UTC,
      * and a reader comparing the two shouldn't have to do the arithmetic.
      *
      * It cannot be baked in. Output is deterministic by rule: a rebuild with no source change produces a
      * byte-identical directory, which is what makes "delete it and regenerate" safe and what keeps a git
      * diff meaningful. A server-rendered timestamp would put a fresh diff in every build and, worse, would
      * be **wrong within a second** and stay wrong for as long as the page is open — a frozen clock is the
      * same class of lie as a frozen dashboard, which is the failure this whole surface exists to remove.
      *
      * So the markup ships empty and JavaScript fills it. `<time>` with no datetime and no text: a reader
      * without scripts sees nothing rather than a stale time presented as the current one.
      */''}<time class="clock" id="clock" aria-live="off"></time>
    <button type="button" class="theme-toggle" id="themeToggle" aria-label="Theme: system">◐</button>
  </nav>
</header>
<main>
${body}
</main>
<footer><p class="genby">${MARK}<span>Generated by <strong class="wordmark"><span>project-</span>atlas</strong>. This page is derived — edit the markdown, not this file.</span></p></footer>
${scripts}
<script>${THEME_WIRE}</script>
<script>${CLOCK_WIRE}</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ pages */

/**
 * The one-line description on the landing page. Taken from whatever document the taxonomy put in the entry
 * cluster — normally the README — rather than written here. A landing page that describes the project in
 * words the project never used is the first thing to go stale.
 */
function lede(index) {
  const entry = index.clusters.find((c) => c.id === 'start');
  const doc = entry && index.documents.find((d) => d.path === entry.documents[0]);
  if (doc?.excerpt) return `<p class="lede">${escapeHtml(doc.excerpt)}</p>`;
  return `<p class="lede muted">No entry document is classified under "start", so there is nothing to quote here.
    Add one — a hand-written <code>docs/README.md</code> is worth more than the rest of this site.</p>`;
}


function docPage(d, bodyHtml, findings, index, cfg, toRoot, nav, nameFor) {
  const meta = [];
  if (d.git) meta.push(`<span title="${escapeHtml(d.git.subject)}">Last commit <strong>${d.git.date}</strong> <code>${d.git.hash}</code></span>`);
  meta.push(`<span>${num(d.lines)} lines</span>`);
  meta.push(`<span>Cluster <strong>${escapeHtml(d.cluster || '—')}</strong></span>`);
  if (d.status) meta.push(`<span>Status <strong>${escapeHtml(d.status)}</strong></span>`);
  if (d.version) meta.push(`<span>v${escapeHtml(d.version)}</span>`);

  const toc = d.headings.filter((h) => h.depth >= 2 && h.depth <= 3);
  const tocHtml = toc.length >= 3
    ? `<nav class="toc"><p class="toc-title">On this page</p><ul>${toc.map((h) =>
        `<li class="d${h.depth}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`
    : '';

  const backlinks = d.backlinks.length
    ? `<section class="panel"><h2>Referenced by</h2><ul class="linklist">${d.backlinks.map((b) => {
        const t = index.documents.find((x) => x.path === b);
        return `<li><a href="${escapeAttr(nameFor(b))}">${escapeHtml(t?.title || b)}</a> <code>${escapeHtml(b)}</code></li>`;
      }).join('')}</ul></section>`
    : `<section class="panel muted"><h2>Referenced by</h2><p>Nothing links here — this document is reachable only by knowing it exists.</p></section>`;

  const flags = findings.length
    ? `<section class="panel flags"><h2>Signals</h2><ul>${findings.map((f) =>
        `<li><span class="sig ${f.blocking ? 'block' : 'adv'}">${f.signal}</span> ${escapeHtml(SIGNALS[f.signal]?.title || '')} — ${escapeHtml(f.detail || '')}</li>`).join('')}</ul></section>`
    : '';

  return shell({
    title: `${d.title || d.path} · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
    nav,
    base: '../',                     // document pages live in pages/; the stylesheet and nav are one level up
    body: `
<div class="derived">Derived page. Source: <a href="${escapeAttr(`${toRoot}/${d.path}`)}"><code>${escapeHtml(d.path)}</code></a> — edit that file, not this one.</div>
<div class="doc-meta">${meta.join('')}</div>
${tocHtml}
<article class="prose">
${bodyHtml}
</article>
${flags}
${backlinks}
`,
  });
}

/**
 * The risk panel, and the narrative beneath it if a human wrote one.
 *
 * Every line states its number, the band it is judged against and what it implies — because a figure with no
 * threshold beside it needs a maintainer standing next to the screen, which is what this page was before.
 */
/**
 * The scorecard. Every component prints its figure, its target and the weight it carried, because a score
 * whose arithmetic is hidden cannot be disagreed with — only resented.
 */
function scoreSection(card) {
  if (!card || card.total === null) return '';
  const tone = card.total >= 80 ? 'ok' : card.total >= 55 ? 'warn' : 'bad';
  const groups = [...new Set(card.components.map((c) => c.group))];

  return `
<section class="score">
  <h2>Scorecard <span class="stotal ${tone}">${card.total}</span></h2>
  <p class="cap">Weighted across ${card.components.length} measured component(s). <strong>The weights live in
  <code>score.weights</code> in this repository's config, not in the tool</strong> — change one and this
  number changes with it. Prompt quality is not among them: a transcript records what happened after a
  prompt, not whether the prompt was well judged.</p>
  ${groups.map((g) => `
  <h3 class="sgroup">${escapeHtml(g)}</h3>
  <div class="table-wrap"><table class="mini-table">
    <thead><tr><th>Component</th><th>Measured</th><th>Target</th><th class="num">Weight</th><th class="num">Score</th></tr></thead>
    <tbody>${card.components.filter((c) => c.group === g).map((c) => `
      <tr><td>${escapeHtml(c.label)}</td><td>${escapeHtml(c.figure)}</td>
        <td class="cap">${escapeHtml(c.target)}</td>
        <td class="num">×${c.weight}</td>
        <td class="num ${c.score >= 80 ? 'ok' : c.score >= 55 ? 'warn' : 'bad'}">${c.score}</td></tr>`).join('')}
    </tbody>
  </table></div>`).join('')}
  ${card.actions.length ? `
  <h3 class="sgroup">What to improve, worst weighted loss first</h3>
  <ol class="actions">
    ${card.actions.map((a) => `<li><strong>${escapeHtml(a.label)}</strong> — ${escapeHtml(a.figure)}
      <span class="cap">(scored ${a.score}, weight ×${a.weight})</span><br><span class="cap">${escapeHtml(a.suggestion)}</span></li>`).join('')}
  </ol>` : '<p class="cap">Every measured component is at or above 80. Nothing here is worth acting on yet.</p>'}
</section>`;
}

function riskSection(list, analysisHtml) {
  if (!list.length && !analysisHtml) return '';
  const dot = { risk: 'bad', watch: 'warn', ok: 'ok' };
  const label = { risk: 'Outside its band', watch: 'Approaching its band', ok: 'Clear' };

  return `
<section class="risks">
  <h2>Where this stands</h2>
  <p class="cap">${escapeHtml(summarise(list))}</p>
  <ul class="risklist">
    ${list.map((s) => `
    <li class="r-${s.level}">
      <p class="rh"><span class="rfig ${dot[s.level]}">${escapeHtml(s.figure)}</span>
        <span class="rt">${escapeHtml(s.headline)}</span>
        <span class="rl">${label[s.level]}</span></p>
      <p class="cap">${escapeHtml(s.means)}</p>
      <p class="cap rband">Threshold: ${escapeHtml(s.threshold)}.${
        s.notMeans ? ` <em>What it does not mean:</em> ${escapeHtml(s.notMeans)}` : ''}</p>
    </li>`).join('')}
  </ul>
</section>
${analysisHtml ? `
<section class="analysis prose">
  ${analysisHtml}
  <p class="cap">Written by hand and rendered from its markdown source. Nothing on this page is generated prose.</p>
</section>` : ''}`;
}

function indexPage(index, health, cfg, truncated, nav, views, plan, contrib, nameFor, analysisHtml, releaseFacts, buildDate) {
  // Read once, and defensively: this is a homepage, and a git call that throws must cost a qualifying
  // sentence rather than the whole page. `readInflight` already returns `{available:false}` rather than
  // throwing for the cases it anticipates; the catch is for the ones it does not.
  let flight = null;
  try { flight = readInflight(cfg.__root || process.cwd(), cfg, { index, plan }); } catch { flight = null; }
  const flightFiles = flight?.available && !flight.quiet
    ? flight.unstaged.length + flight.staged.length + (flight.untracked || 0)
    : 0;
  const clusters = index.clusters.map((c) => {
    const docs = c.documents.map((p) => index.documents.find((d) => d.path === p)).filter(Boolean)
      .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
    return `
<section class="cluster" id="c-${escapeHtml(c.id)}">
  <h2>${escapeHtml(c.title)} <span class="count">${docs.length}</span></h2>
  ${c.blurb ? `<p class="blurb">${escapeHtml(c.blurb)}</p>` : ''}
  <ul class="docs">
    ${docs.map((d) => `<li>
      <a class="dt" href="pages/${escapeAttr(nameFor(d.path))}">${escapeHtml(d.title || d.path)}</a>
      <span class="dm">${d.git ? d.git.date + ' · ' : ''}${num(d.lines)} lines</span>
      ${d.excerpt ? `<span class="dx">${escapeHtml(d.excerpt.slice(0, 190))}</span>` : ''}
      <code class="dp">${escapeHtml(d.path)}</code>
    </li>`).join('\n')}
  </ul>
</section>`;
  }).join('\n');

  const clusterNav = index.clusters.map((c) => `<a href="#c-${escapeHtml(c.id)}">${escapeHtml(c.title)} <span>${c.documents.length}</span></a>`).join('');

  return shell({
    title: escapeHtml(index.siteTitle),
    siteTitle: index.siteTitle,
    nav,
    body: `
<section class="hero">
  <h1>${escapeHtml(index.siteTitle)}</h1>
  ${buildDate ? `<p class="built-on">Last updated <strong>${escapeHtml(buildDate.local)}</strong>${
    buildDate.utc === buildDate.local ? '' : ` <span class="cap">· ${escapeHtml(buildDate.utc)}</span>`} <span class="cap">· the last commit's own timestamp, so a rebuild with no change says the same thing</span></p>` : ''}
  ${lede(index)}
  <p class="hero-stats">
    <strong>${index.stats.documents}</strong> documents ·
    <strong>${num(index.stats.lines)}</strong> lines ·
    <strong>${index.stats.clusters}</strong> clusters${plan && !plan.missing ? ` ·
    <strong>${plan.stats.total}</strong> open items at <strong>${plan.stats.mean ?? '—'}%</strong>` : ''}${contrib?.available ? ` ·
    <strong>${contrib.totals.commits}</strong> commits` : ''}${flightFiles ? ` ·
    <strong>${flightFiles}</strong> file(s) in flight` : ''}
  </p>
  ${/*
     * **The homepage made the same claim the dashboard tiles made, and had to stop making it.**
     *
     * "64 open items at 100%" is read as "this project is finished". It is really "the plan, which only
     * knows what somebody has already written down and marked complete, records nothing outstanding" — and
     * on a working tree with two dozen modified files those are opposite statements. The tiles now carry a
     * measured count of files in flight beside the recorded percentage; this line is the first thing anyone
     * sees, so leaving it unqualified would mean fixing the quieter half of the same defect.
     *
     * No figure is adjusted. Work nobody has written down has no denominator, so folding it into a
     * completion percentage would invent a measurement — which is worse than the blind number, because it
     * would look measured. A count sits next to a percentage and the sentence says which is which.
     */''}
  ${flightFiles ? `<p class="hero-flight cap">That percentage is what the plan <em>records</em>. Measured against
    the working tree, <strong>${flightFiles}</strong> file(s) are in flight on
    <code>${escapeHtml(flight.branch || '')}</code> that no figure above can see.</p>` : ''}
  <p class="hero-health">
    ${health.blockingCount
      ? `<a href="health.html"><strong class="bad">${health.blockingCount} blocking finding(s)</strong></a> — defects with no legitimate cause`
      : `<a href="health.html"><span class="ok">No blocking findings</span></a> — every mechanical check is clean`}
  </p>
</section>

${riskSection(risks({ index, health, plan, contrib }), analysisHtml)}
${scoreSection(scorecard(repoComponents({ contrib, health, plan, index, ...releaseFacts }), cfg.score?.weights))}

<section class="viewgrid">
  ${views.filter((v) => v.nav !== false).map((v) => `
  <a class="viewcard" href="${escapeAttr(viewFile(v.id))}">
    <span class="vt">${escapeHtml(v.title)}</span>
    <span class="vb">${escapeHtml(v.blurb || '')}</span>
    <span class="vp">${v.panels.length} panel(s)</span>
  </a>`).join('')}
</section>

<section class="browse-cta">
  <h2>Browse the corpus</h2>
  <p class="cap">${index.stats.documents} documents across ${index.stats.clusters} clusters, with full-text
  search over titles, headings and body text.</p>
  <p><a class="cta" href="wiki.html">Open the wiki →</a></p>
</section>
`,
    scripts: `<script>

</script>`,
  });
}

function healthPage(index, health, cfg, nav, nameFor) {
  const sections = Object.values(SIGNALS).map((s) => {
    const items = health.findings.filter((f) => f.signal === s.id && !f.suppressed);
    const isBlocking = (cfg.blocking || []).includes(s.id);
    // Zero findings because the check ran, or zero because its pattern was declined? Those are different
    // claims, and only one of them is "clean". See health.mjs::runHealth.
    const skipped = (health.unevaluated || []).includes(s.id);
    return `
<section class="panel">
  <h2><span class="sig ${isBlocking ? 'block' : 'adv'}">${s.id}</span> ${escapeHtml(s.title)}
    <span class="count ${skipped ? 'warn' : items.length ? (isBlocking ? 'bad' : 'warn') : 'ok'}">${skipped ? 'not evaluated' : items.length}</span></h2>
  <p class="blurb">${escapeHtml(s.why)} ${isBlocking ? '<strong>Blocking</strong> — no legitimate cause.' : 'Advisory — legitimate exceptions exist.'}</p>
  ${items.length ? `<ul class="findings">${items.slice(0, 300).map((f) =>
      (f.corpus
        // Not a document: H15 names a kind that is missing and H16 names a code area, and neither has a page
        // to link to. Rendered as text rather than as a link to a file that was never written.
        ? `<li><span class="mono">${escapeHtml(f.doc)}</span> <span class="det">${escapeHtml(f.detail || '')}</span></li>`
        : `<li><a href="pages/${escapeAttr(nameFor(f.doc))}">${escapeHtml(f.doc)}</a> <span class="det">${escapeHtml(f.detail || '')}</span></li>`)).join('')}
      ${items.length > 300 ? `<li class="det">… and ${items.length - 300} more (run <code>atlas health --verbose=all</code>)</li>` : ''}</ul>` : ''}
</section>`;
  }).join('\n');

  const notChecked = health.notChecked.length
    ? `<section class="panel muted"><h2>Not checked</h2><ul>${health.notChecked.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></section>`
    : '';

  return shell({
    title: `Health · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
    nav,
    body: `
<h1><span class="h1-proj">${escapeHtml(index.siteTitle)}</span>Documentation health</h1>
<p class="lede">${health.blockingCount
  ? `<strong class="bad">${health.blockingCount} blocking finding(s).</strong>`
  : '<span class="ok">No blocking findings.</span>'}
${health.suppressed ? ` ${health.suppressed} suppressed by configuration, each with a stated reason.` : ''}</p>
${notChecked}
${sections}
`,
  });
}

/**
 * The one file in the output directory that is markdown and always has been — which makes it the file an
 * agent lands on when it lists the directory, and therefore the right place to say where the machine-readable
 * half lives. Without this line `kb/` is discoverable only by someone who already knows to look for it, which
 * is the orphan condition H4 exists to report.
 */
function derivedReadme(cfg) {
  return `# Derived output — do not edit

Everything in this directory is generated by **project-atlas** from the repository's markdown.

**Reading this as an agent?** Start at [\`${KB_DIR}/README.md\`](${KB_DIR}/README.md) — the derived knowledge
graph, in markdown: the taxonomy, the link graph, backlinks, code citations, health findings and the plan
cross-reference, all with working relative links and no document prose. The HTML here is for people.

Regenerate with:

\`\`\`bash
node .claude/skills/project-atlas/scripts/atlas.mjs all
\`\`\`

Edits made here are lost on the next build. Edit the source \`.md\` files instead.
Output directory is configured as \`${cfg.output}\`.
`;
}

/* ------------------------------------------------------------------ style */

const CSS = `/* project-atlas — generated. No external assets.
 *
 * Two selected themes, not one palette flipped.
 *
 * LIGHT is a soft English ground — parchment and clay rather than office grey — carrying near-black text at
 * 16.3:1 on the page and 17.5:1 on a card. Soft does not mean low contrast; it means the *ground* is warm
 * while the ink stays hard.
 *
 * DARK is near-black with neon accents: violet #b98cff at 7.4:1, blue #5eb3ff at 8.4:1, green #3ef2a0. Both
 * ordinal ramps were run through the palette validator against their own surface — monotone lightness,
 * ΔL ≥ 0.06 per step, light end clearing 2:1 (2.27:1 light, 2.96:1 dark). Do not adjust a step by eye.
 *
 * Three states, not two: bare :root is light, the media query covers an OS preference, and [data-theme]
 * covers an explicit choice and wins both ways. A colour defined only inside a media block never applies in
 * the un-stamped state, which is the classic unreadable-page bug.
 */
:root {
  --bg:#f2f0ec; --surface:#ffffff; --surface-2:#faf8f5; --surface-3:#ece8e1;
  --fg:#14130f; --fg-soft:#3d382f; --mut:#5f574a;
  --bd:#ddd7cc; --bd-soft:#ebe6dc;
  --acc:#2f5fd0; --brand:#6d4bc4; --acc-ink:#0b0a08;
  --ok:#2f7d4f; --warm:#9a5f16; --danger:#b03530;
  --shadow:0 1px 2px rgba(20,19,15,.06);
  /* Brand. Four roles, from assets/atlas-*.svg: the contour lines, the solid summit, the benchmark point,
   * and the muted half of the wordmark. The benchmark is the one colour that does not move between themes —
   * it is the survey point everything else is measured from, and it reads on both grounds. */
  --atlas-contour:#4E8F84; --atlas-summit:#1C3A3E; --atlas-benchmark:#E5A33C; --atlas-ink-soft:#4E8F84;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#0a0a0f; --surface:#14141c; --surface-2:#101018; --surface-3:#1c1c28;
    --fg:#f0f0ff; --fg-soft:#c8c8e0; --mut:#a3a3c4;
    --bd:#2a2a3d; --bd-soft:#1e1e2c;
    --acc:#5eb3ff; --brand:#b98cff; --acc-ink:#ffffff;
    --ok:#3ef2a0; --warm:#ffc857; --danger:#ff5c7a;
    --shadow:none;
    --atlas-contour:#5FA396; --atlas-summit:#EAF2EF; --atlas-benchmark:#E5A33C; --atlas-ink-soft:#7FB3A8;
  }
}
:root[data-theme="dark"] {
  --bg:#0a0a0f; --surface:#14141c; --surface-2:#101018; --surface-3:#1c1c28;
  --fg:#f0f0ff; --fg-soft:#c8c8e0; --mut:#a3a3c4;
  --bd:#2a2a3d; --bd-soft:#1e1e2c;
  --acc:#5eb3ff; --brand:#b98cff; --acc-ink:#ffffff;
  --ok:#3ef2a0; --warm:#ffc857; --danger:#ff5c7a;
  --shadow:none;
  --atlas-contour:#5FA396; --atlas-summit:#EAF2EF; --atlas-benchmark:#E5A33C; --atlas-ink-soft:#7FB3A8;
}
/* Legacy aliases, so component rules below read against one vocabulary. */
:root, :root[data-theme="dark"] { --panel:var(--surface-2); --ink:var(--fg); --muted:var(--mut);
  --line:var(--bd); --link:var(--acc); --accent:var(--brand); --bad:var(--danger); --code-bg:var(--surface-3); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --panel:var(--surface-2); --ink:var(--fg); --muted:var(--mut); --line:var(--bd);
  --link:var(--acc); --accent:var(--brand); --bad:var(--danger); --code-bg:var(--surface-3); } }

.theme-toggle {
  font:inherit; font-size:15px; line-height:1; cursor:pointer; color:var(--mut);
  background:var(--surface-2); border:1px solid var(--bd); border-radius:999px;
  width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0;
}
.theme-toggle:hover { color:var(--acc); border-color:var(--acc); }
.theme-toggle:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }

* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui,sans-serif; }
/* The page body never scrolls sideways. Wide content scrolls inside its own container instead. */
html, body { max-width:100%; overflow-x:hidden; }

/* Width ladder. 80% of the parent with a ceiling, per the house rule — but the ceiling rises on large
 * displays instead of stranding the content in a narrow column with two feet of empty grey either side.
 * Narrow devices give back the margin they cannot afford: a 10" iPad has no room for a 20% gutter. */
:root { --maxw:1180px; }
@media (min-width:1500px) { :root { --maxw:1460px; } }
@media (min-width:1800px) { :root { --maxw:1680px; } }
main { width:80%; max-width:var(--maxw); margin:0 auto; padding:32px 0 96px; }
@media (max-width:1280px) { main { width:88%; } }     /* 13" laptop */
@media (max-width:900px)  { main { width:92%; } }     /* 10" tablet */
@media (max-width:600px)  { main { width:94%; } }
.topbar { padding-inline:max(3%, calc((100% - var(--maxw)) / 2)); }
a { color:var(--link); text-decoration:none; }
a:hover { text-decoration:underline; }
code, pre, .dp { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }

/* The navigation wraps, and that is the whole fix.
 *
 * Measured at 390px: the nav was 778px wide inside a 386px viewport. The overflow-x:hidden on html and body
 * meant the page did not scroll sideways — so nothing *looked* broken — and every link past the second was
 * simply clipped away and unreachable. A menu that is invisible and unscrollable is worse than one that
 * overflows visibly, because there is no cue that anything is missing.
 *
 * Wrapped rather than turned into a horizontal scroll strip: a scroll strip reintroduces exactly that
 * problem, hiding items behind a gesture with no indication they exist. Ten links over two or three lines
 * costs vertical space and hides nothing. */
.topbar {
  position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:12px 24px;
  flex-wrap:wrap; padding:12px 5%; background:var(--bg); border-bottom:1px solid var(--line);
}
.brand { font-weight:650; color:var(--ink); white-space:nowrap; }
.topbar nav { display:flex; flex-wrap:wrap; gap:10px 16px; margin-left:auto; align-items:center; }
@media (max-width:760px) {
  /* Below this the brand and ten links cannot share a line at a readable size. The nav takes its own row
   * and starts at the left edge, so it reads as a menu rather than as a ragged tail of the title. */
  .topbar { gap:8px; padding:10px 4%; }
  .topbar nav { margin-left:0; width:100%; gap:8px 14px; }
  /* 44px of vertical target, per the platform guidance, without moving the text. Measured rather than
   * assumed: 6px of padding produced 38px and had to be raised. */
  .topbar nav a { padding:9px 0; }
}
/* Sticky only while the bar is a single row.
 *
 * CSS cannot ask whether a flex line wrapped, so this is a width proxy — and the first attempt put it at
 * 760px, which left a 768px tablet pinning a 130px two-row bar to the top of every scroll. Ten links need
 * roughly a laptop to sit on one line, so that is where sticky resumes. Below it the bar scrolls away and is
 * one flick back, which costs less than a sixth of the screen held permanently by navigation, on pages whose
 * whole job is to show figures. */
@media (max-width:1024px) { .topbar { position:static; } }
footer { border-top:1px solid var(--line); padding:20px 5%; color:var(--muted); font-size:13px; }
.genby { display:flex; align-items:center; gap:9px; margin:0; }
.atlas-mark { flex:0 0 auto; }
.wordmark span { color:var(--atlas-ink-soft); font-weight:500; }
/* The mark sits with the wordmark rather than floating beside it: baseline-aligned, and it never shrinks
   when the nav wraps on a narrow viewport — a logo that squashes at 390px is worse than no logo. */
/* The mark is sized to the wordmark, not to a number picked once and left. 18px beside ~17px text read as
   an afterthought — a logo smaller than the letters next to it looks dropped in rather than designed.
   1.8em ties it to the text, so it stays proportional if the topbar type ever changes.
   **The viewBox was the real problem.** The artwork spans y 13.5→108 inside a 0→128 box, so about a
   quarter of every rendered pixel was empty padding and the triangle came out far smaller than the box it
   was given. Cropping the viewBox to the art makes the drawn mark fill its space, which is why this reads
   as bigger without the layout moving. The footer keeps a smaller mark deliberately: there it is a credit,
   and a credit competing with its own sentence is the opposite mistake. */
.brand { display:inline-flex; align-items:center; gap:9px; text-decoration:none; }
.brand .atlas-mark { flex:0 0 auto; width:1.8em; height:1.8em; }
.brand-text { line-height:1; }
.wordmark { color:var(--atlas-summit); }

/* The header clock. Sits after the nav links and before the theme toggle, right-aligned with them. Tabular
   figures so the digits do not jitter as the seconds tick — a clock whose width changes every second drags
   the eye to the one part of the page that is never news. */
.clock { display:inline-flex; align-items:baseline; gap:10px; margin-left:14px; padding-left:14px;
  border-left:1px solid var(--line); font-size:12px; color:var(--muted);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.clock:empty { display:none; }            /* no script, no clock — never a stale time presented as current */
.clock-date { opacity:.75; }
.clock-t { color:var(--ink); }
.clock-z { margin-left:4px; font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
@media (max-width:1100px) { .clock .clock-date { display:none; } }
@media (max-width:820px) { .clock { display:none; } }

h1 { font-size:30px; line-height:1.25; margin:8px 0 12px; letter-spacing:-.01em; }
/* Which project am I looking at?
   Every repository gets its own dashboard on its own port, so several are open at once as a matter of
   routine — and a page headed "Overview" answers "overview of what?" with nothing. The nav carries the
   project name, but at 13px beside a logo it reads as branding rather than as the answer. So the heading
   states it too, muted enough that the page name still leads. */
.h1-proj { color:var(--muted); font-weight:600; }
.h1-proj::after { content:" · "; color:var(--line); font-weight:400; }
h2 { font-size:22px; margin:34px 0 10px; letter-spacing:-.005em; }
h3 { font-size:18px; margin:26px 0 8px; }
h4,h5,h6 { font-size:16px; margin:20px 0 6px; }
.lede { color:var(--muted); margin:0 0 24px; }
.ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }

.derived {
  background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent);
  border-radius:6px; padding:10px 14px; font-size:13px; color:var(--muted); margin-bottom:16px;
}
.doc-meta { display:flex; flex-wrap:wrap; gap:8px 18px; font-size:13px; color:var(--muted); margin-bottom:24px; }

.toc {
  background:var(--panel); border:1px solid var(--line); border-radius:8px;
  padding:14px 18px; margin:0 0 28px;
}
.toc-title { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); }
.toc ul { list-style:none; margin:0; padding:0; columns:2; }
@media (max-width:700px) { .toc ul { columns:1; } }
.toc li { break-inside:avoid; font-size:14px; padding:2px 0; }
.toc li.d3 { padding-left:16px; font-size:13px; }

.prose { overflow-wrap:anywhere; }
.prose h1,.prose h2,.prose h3 { position:relative; }
.prose .anchor { position:absolute; left:-.75em; opacity:0; color:var(--muted); font-weight:400; }
.prose h1:hover .anchor,.prose h2:hover .anchor,.prose h3:hover .anchor { opacity:1; }
.prose p { margin:14px 0; }
.prose ul,.prose ol { margin:14px 0; padding-left:26px; }
.prose li { margin:5px 0; }
.prose li.task { list-style:none; margin-left:-22px; }
.prose blockquote {
  margin:18px 0; padding:2px 18px; border-left:3px solid var(--accent);
  background:var(--panel); border-radius:0 6px 6px 0; color:var(--ink);
}
.prose pre {
  background:var(--code-bg); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; overflow-x:auto; font-size:13.5px; line-height:1.55;
}
.prose :not(pre) > code { background:var(--code-bg); padding:.12em .4em; border-radius:4px; font-size:.9em; }
.prose img { max-width:100%; height:auto; }
.prose hr { border:0; border-top:1px solid var(--line); margin:28px 0; }
.table-wrap { overflow-x:auto; margin:18px 0; }
.prose table { border-collapse:collapse; width:100%; font-size:14px; }
.prose th,.prose td { border:1px solid var(--line); padding:8px 11px; text-align:left; vertical-align:top; }
.prose th { background:var(--panel); font-weight:620; }
a.dead { color:var(--bad); text-decoration:line-through wavy; }
a.src { color:var(--muted); }

.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 20px; margin:24px 0; }
.panel.muted { color:var(--muted); }
.panel h2 { margin:0 0 8px; font-size:17px; }
.blurb { color:var(--muted); font-size:14px; margin:0 0 10px; }
.linklist,.findings { list-style:none; margin:0; padding:0; }
.linklist li,.findings li { padding:5px 0; border-bottom:1px solid var(--line); font-size:14px; }
.linklist li:last-child,.findings li:last-child { border-bottom:0; }
.det { color:var(--muted); font-size:13px; }
.sig { display:inline-block; min-width:26px; text-align:center; padding:1px 6px; border-radius:5px; font-size:12px; font-weight:700; }
.sig.block { background:var(--bad); color:#fff; }
.sig.adv { background:var(--line); color:var(--muted); }
.count { font-size:13px; color:var(--muted); font-weight:500; }

.searchbox { margin:8px 0 6px; }
#q {
  width:100%; padding:12px 14px; font-size:16px; color:var(--ink);
  background:var(--panel); border:1px solid var(--line); border-radius:9px;
}
#q:focus { outline:2px solid var(--accent); outline-offset:1px; }
.hint { color:var(--muted); font-size:12.5px; margin:6px 2px 0; }

.hero { padding:14px 0 6px; }
.hero h1 { font-size:40px; letter-spacing:-.02em; margin:0 0 10px; }
.hero .lede { font-size:17px; max-width:66ch; margin:0 0 16px; color:var(--fg-soft); }
.hero-stats { margin:0 0 6px; font-size:14px; color:var(--muted); }
.hero-stats strong { color:var(--ink); font-variant-numeric:tabular-nums; }
.hero-health { margin:0 0 8px; font-size:14px; }
@media (max-width:600px) { .hero h1 { font-size:30px; } .hero .lede { font-size:15.5px; } }

.built-on { margin:6px 0 14px; font-size:13.5px; color:var(--muted); }
.score { margin:26px 0 8px; }
.score h2 { display:flex; align-items:center; gap:12px; }
.stotal { font-size:15px; font-weight:700; padding:3px 12px; border-radius:999px; border:1px solid currentColor; }
.sgroup { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:18px 0 6px; }
.actions { margin:10px 0 0; padding-left:22px; }
.actions li { margin:9px 0; }
.risks { margin:28px 0 8px; }
.risklist { list-style:none; margin:14px 0 0; padding:0; display:grid; gap:10px; }
.risklist li { border:1px solid var(--line); border-left:3px solid var(--line); border-radius:8px; padding:11px 14px; background:var(--panel); }
.risklist li.r-risk { border-left-color:var(--bad); }
.risklist li.r-watch { border-left-color:var(--warn); }
.risklist li.r-ok { border-left-color:var(--ok); }
.rh { margin:0 0 4px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.rfig { font-weight:680; font-variant-numeric:tabular-nums; }
.rt { font-weight:560; }
.rl { margin-left:auto; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
.rband { opacity:.85; }
.analysis { margin:22px 0 8px; padding:16px 18px; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
.viewgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin:22px 0 34px; }
.viewcard {
  display:flex; flex-direction:column; gap:5px; padding:14px 16px;
  background:var(--panel); border:1px solid var(--line); border-radius:10px; color:var(--ink);
  box-shadow:var(--shadow); transition:border-color .1s ease;
}
.viewcard:hover { border-color:var(--accent); text-decoration:none; }
.viewcard .vt { font-weight:650; font-size:15px; color:var(--link); }
.viewcard .vb { font-size:13px; color:var(--muted); line-height:1.5; }
.viewcard .vp { font-size:11.5px; color:var(--muted); opacity:.8; margin-top:2px; }
.browse-title { margin:34px 0 4px; }

.clusternav { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 8px; }
.clusternav a {
  font-size:13px; padding:5px 11px; border:1px solid var(--line);
  background:var(--panel); border-radius:999px; color:var(--ink);
}
.clusternav a span { color:var(--muted); }
.cluster { margin:34px 0; }
.docs { list-style:none; margin:12px 0 0; padding:0; display:grid; gap:10px; }
.docs li {
  background:var(--panel); border:1px solid var(--line); border-radius:9px;
  padding:11px 14px; box-shadow:var(--shadow);
}
.dt { font-weight:600; }
.dm { color:var(--muted); font-size:12.5px; margin-left:10px; }
.dx { display:block; color:var(--muted); font-size:13.5px; margin-top:3px; }
.dp { display:block; color:var(--muted); font-size:12px; margin-top:5px; opacity:.8; }
`;
