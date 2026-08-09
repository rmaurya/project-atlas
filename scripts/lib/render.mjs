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
import { readContrib } from './contrib.mjs';
import { resolveViews, navItems, viewFile } from './views.mjs';
import { risks, summarise } from './insight.mjs';
import { repoComponents, scorecard } from './score.mjs';
import { execFileSync } from 'node:child_process';
import { PANELS } from './views.mjs';

export { flatName } from './render-shared.mjs';
import { flatName, pageNames, jsonForScript } from './render-shared.mjs';

/**
 * Files every build of this tool writes into its output directory. They are the proof that the directory is
 * ours to delete — see `prepareOutputDir`.
 */
const BUILD_MARKERS = ['README.md', '.gitattributes'];

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
 *  2. **Provenance.** A directory that already holds files but carries none of this tool's markers was written
 *     by someone else. `docs/` is a plausible typo for `docs/_wiki`, and the difference between those two is a
 *     day's work. An empty directory, or a missing one, is fine — there is nothing to lose.
 */
function prepareOutputDir(root, cfg) {
  const outDir = confine(root, cfg.output, 'output', cfg.__configPath);

  if (fs.existsSync(outDir)) {
    const stat = fs.lstatSync(outDir);
    if (!stat.isDirectory()) throw new Error(`output resolves to ${outDir}, which is not a directory.`);
    const entries = fs.readdirSync(outDir);
    const ours = BUILD_MARKERS.every((m) => entries.includes(m));
    if (entries.length && !ours) {
      throw new Error(
        `Refusing to delete ${outDir}: it contains ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} ` +
        `but none of the files a project-atlas build leaves behind (${BUILD_MARKERS.join(', ')}).\n` +
        `  The build clears its output directory completely, so this would destroy work that is not derived.\n` +
        `  Point \`output\` at a directory of its own, or delete this one by hand if it really is generated.`);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  return outDir;
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
    buildDate = execFileSync('git', ['-C', root, 'log', '-1', '--format=%cs'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim() || null;
  } catch { buildDate = null; }

  // `jsonForScript`, not `JSON.stringify`: this file is inlined verbatim into a <script> tag by
  // `exportSingleFile`, and it carries document body text. See render-shared.mjs for what that cost.
  fs.writeFileSync(path.join(outDir, 'search-index.js'),
    'window.ATLAS = ' + jsonForScript({ docs: searchRows, truncated }) + ';\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(index, health, cfg, truncated, docNav.map((n) => ({ ...n, current: n.href === 'index.html' })), views0, plan, contrib, nameFor, analysisHtml, releaseFacts, buildDate), 'utf8');
  fs.writeFileSync(path.join(outDir, 'wiki.html'), wikiPage(index, cfg, truncated,
    docNav.map((n) => ({ ...n, current: n.href === 'wiki.html' })), nameFor), 'utf8');
  fs.writeFileSync(path.join(outDir, 'health.html'), healthPage(index, health, cfg, docNav.map((n) => ({ ...n, current: n.href === 'health.html' })), nameFor), 'utf8');
  const views = views0;
  const baseNav = docNav;
  const ctx = { index, health, plan, cfg: { ...cfg, __root: root }, contrib, nameFor };
  for (const v of views) {
    const nav = baseNav.map((n) => ({ ...n, current: n.href === viewFile(v.id) }));
    fs.writeFileSync(path.join(outDir, viewFile(v.id)), viewPage(v, { ...ctx, nav }, shell), 'utf8');
  }
  if (deck) fs.writeFileSync(path.join(outDir, 'deck.html'), deckPage(deck, index, cfg), 'utf8');
  fs.writeFileSync(path.join(outDir, 'atlas.css'), CSS, 'utf8');
  fs.writeFileSync(path.join(outDir, '.gitattributes'), '* linguist-generated=true\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'README.md'), derivedReadme(cfg), 'utf8');

  return { outDir, pages: written.size, truncated, plan, deck, collisions };
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
      <span class="dm">${d.git ? d.git.date + ' · ' : ''}${d.lines.toLocaleString()} lines</span>
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
<h1>Wiki</h1>
<p class="lede">${index.stats.documents} documents · ${index.stats.lines.toLocaleString()} lines ·
${index.stats.clusters} clusters. Every page is derived from the markdown in this repository — edit the source,
never the page.</p>

<div class="searchbox">
  <input id="q" type="search" placeholder="Search titles, headings and body text…" autocomplete="off" autofocus>
  <p id="qhint" class="hint">${truncated ? `${truncated} long document(s) are indexed to the first ${(cfg.searchBodyLimit || 6000).toLocaleString()} characters.` : 'Full text of every document is indexed.'}</p>
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

function shell({ title, siteTitle, base = '', body, extraHead = '', scripts = '', nav = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}atlas.css">
<script>${THEME_BOOT}</script>
${extraHead}
</head>
<body>
<header class="topbar">
  <a class="brand" href="${base}index.html">${escapeHtml(siteTitle)}</a>
  <nav>
    ${(nav || []).map((n) => `<a href="${escapeAttr(base + n.href)}"${n.current ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`).join('\n    ')}
    <button type="button" class="theme-toggle" id="themeToggle" aria-label="Theme: system">◐</button>
  </nav>
</header>
<main>
${body}
</main>
<footer><p>Generated by <strong>project-atlas</strong>. This page is derived — edit the markdown, not this file.</p></footer>
${scripts}
<script>${THEME_WIRE}</script>
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
  meta.push(`<span>${d.lines.toLocaleString()} lines</span>`);
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
      <span class="dm">${d.git ? d.git.date + ' · ' : ''}${d.lines.toLocaleString()} lines</span>
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
  ${buildDate ? `<p class="built-on">Last updated <strong>${escapeHtml(buildDate)}</strong> <span class="cap">· from the last commit, so a rebuild with no change says the same thing</span></p>` : ''}
  ${lede(index)}
  <p class="hero-stats">
    <strong>${index.stats.documents}</strong> documents ·
    <strong>${index.stats.lines.toLocaleString()}</strong> lines ·
    <strong>${index.stats.clusters}</strong> clusters${plan && !plan.missing ? ` ·
    <strong>${plan.stats.total}</strong> open items at <strong>${plan.stats.mean ?? '—'}%</strong>` : ''}${contrib?.available ? ` ·
    <strong>${contrib.totals.commits}</strong> commits` : ''}
  </p>
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
      `<li><a href="pages/${escapeAttr(nameFor(f.doc))}">${escapeHtml(f.doc)}</a> <span class="det">${escapeHtml(f.detail || '')}</span></li>`).join('')}
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
<h1>Documentation health</h1>
<p class="lede">${health.blockingCount
  ? `<strong class="bad">${health.blockingCount} blocking finding(s).</strong>`
  : '<span class="ok">No blocking findings.</span>'}
${health.suppressed ? ` ${health.suppressed} suppressed by configuration, each with a stated reason.` : ''}</p>
${notChecked}
${sections}
`,
  });
}

function derivedReadme(cfg) {
  return `# Derived output — do not edit

Everything in this directory is generated by **project-atlas** from the repository's markdown.

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
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#0a0a0f; --surface:#14141c; --surface-2:#101018; --surface-3:#1c1c28;
    --fg:#f0f0ff; --fg-soft:#c8c8e0; --mut:#a3a3c4;
    --bd:#2a2a3d; --bd-soft:#1e1e2c;
    --acc:#5eb3ff; --brand:#b98cff; --acc-ink:#ffffff;
    --ok:#3ef2a0; --warm:#ffc857; --danger:#ff5c7a;
    --shadow:none;
  }
}
:root[data-theme="dark"] {
  --bg:#0a0a0f; --surface:#14141c; --surface-2:#101018; --surface-3:#1c1c28;
  --fg:#f0f0ff; --fg-soft:#c8c8e0; --mut:#a3a3c4;
  --bd:#2a2a3d; --bd-soft:#1e1e2c;
  --acc:#5eb3ff; --brand:#b98cff; --acc-ink:#ffffff;
  --ok:#3ef2a0; --warm:#ffc857; --danger:#ff5c7a;
  --shadow:none;
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

.topbar {
  position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:24px;
  padding:12px 5%; background:var(--bg); border-bottom:1px solid var(--line);
}
.brand { font-weight:650; color:var(--ink); white-space:nowrap; }
.topbar nav { display:flex; gap:16px; margin-left:auto; }
footer { border-top:1px solid var(--line); padding:20px 5%; color:var(--muted); font-size:13px; }

h1 { font-size:30px; line-height:1.25; margin:8px 0 12px; letter-spacing:-.01em; }
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
