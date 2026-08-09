/**
 * project-atlas · static site generation
 *
 * Every page carries a banner saying it is derived and linking to its source, because the one way this system
 * fails badly is someone editing the output and losing the work. Output is deterministic: no timestamps except
 * those read from git, stable ordering everywhere, so a rebuild with no source change yields an empty diff.
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, escapeHtml } from './markdown.mjs';
import { SIGNALS } from './health.mjs';
import { readPlanning } from './planning.mjs';
import { dashboardPage } from './dashboard.mjs';
import { readDeck, deckPage } from './deck.mjs';

export const flatName = (p) => p.replace(/\.md$/i, '').replace(/[/\\]/g, '__') + '.html';

export function renderSite(index, health, cfg, root) {
  const outDir = path.resolve(root, cfg.output);
  const pagesDir = path.join(outDir, 'pages');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });

  const byPath = new Map(index.documents.map((d) => [d.path, d]));
  const toRoot = path.relative(pagesDir, root).split(path.sep).join('/') || '.';

  const resolveFrom = (docPath) => (href) => {
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(href)) return { href, cls: '' };
    const [target, anchor] = href.split('#');
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docPath), target || ''));
    if (byPath.has(resolved)) return { href: flatName(resolved) + (anchor ? '#' + anchor : ''), cls: 'wl' };
    if (fs.existsSync(path.join(root, resolved))) return { href: `${toRoot}/${resolved}`, cls: 'src' };
    return { href: `${toRoot}/${resolved}`, cls: 'dead' };
  };

  let truncated = 0;
  const searchRows = [];

  for (const d of index.documents) {
    const findings = health.findings.filter((f) => f.doc === d.path && !f.suppressed);
    const body = renderMarkdown(d.body, { resolveLink: resolveFrom(d.path) });
    fs.writeFileSync(path.join(pagesDir, flatName(d.path)), docPage(d, body, findings, index, cfg, toRoot), 'utf8');

    const limit = cfg.searchBodyLimit || 6000;
    const text = d.body.replace(/\s+/g, ' ').trim();
    if (text.length > limit) truncated++;
    searchRows.push({
      p: d.path, t: d.title || d.path, c: d.cluster,
      h: d.headings.filter((h) => h.depth <= 3).map((h) => h.text).join(' · ').slice(0, 600),
      x: d.excerpt, b: text.slice(0, limit), f: flatName(d.path),
    });
  }

  const plan = readPlanning(root, cfg);
  const deck = readDeck(root, cfg);

  fs.writeFileSync(path.join(outDir, 'search-index.js'),
    'window.ATLAS = ' + JSON.stringify({ docs: searchRows, truncated }) + ';\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(index, health, cfg, truncated), 'utf8');
  fs.writeFileSync(path.join(outDir, 'health.html'), healthPage(index, health, cfg), 'utf8');
  fs.writeFileSync(path.join(outDir, 'dashboard.html'), dashboardPage(index, health, plan, cfg, shell), 'utf8');
  if (deck) fs.writeFileSync(path.join(outDir, 'deck.html'), deckPage(deck, index, cfg), 'utf8');
  fs.writeFileSync(path.join(outDir, 'atlas.css'), CSS, 'utf8');
  fs.writeFileSync(path.join(outDir, '.gitattributes'), '* linguist-generated=true\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'README.md'), derivedReadme(cfg), 'utf8');

  return { outDir, pages: index.documents.length, truncated, plan, deck };
}

/**
 * A stamp the open page polls to notice a rebuild and reload itself. It is the only non-deterministic byte in
 * the output, so it is written separately and excluded from the byte-identical guarantee — `renderSite` stays
 * pure, and this is called by the CLI when a caller asked for live reload.
 */
export function writeBuildStamp(root, cfg, value) {
  const outDir = path.resolve(root, cfg.output);
  fs.writeFileSync(path.join(outDir, 'build-stamp.txt'), String(value) + '\n', 'utf8');
}

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

function shell({ title, siteTitle, base = '', body, extraHead = '', scripts = '', nav = true }) {
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
    <a href="${base}index.html">Index</a>
    <a href="${base}dashboard.html">Dashboard</a>
    <a href="${base}deck.html">Deck</a>
    <a href="${base}health.html">Health</a>
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

function docPage(d, bodyHtml, findings, index, cfg, toRoot) {
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
        return `<li><a href="${flatName(b)}">${escapeHtml(t?.title || b)}</a> <code>${escapeHtml(b)}</code></li>`;
      }).join('')}</ul></section>`
    : `<section class="panel muted"><h2>Referenced by</h2><p>Nothing links here — this document is reachable only by knowing it exists.</p></section>`;

  const flags = findings.length
    ? `<section class="panel flags"><h2>Signals</h2><ul>${findings.map((f) =>
        `<li><span class="sig ${f.blocking ? 'block' : 'adv'}">${f.signal}</span> ${escapeHtml(SIGNALS[f.signal]?.title || '')} — ${escapeHtml(f.detail || '')}</li>`).join('')}</ul></section>`
    : '';

  return shell({
    title: `${d.title || d.path} · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
    base: '../',                     // document pages live in pages/; the stylesheet and nav are one level up
    body: `
<div class="derived">Derived page. Source: <a href="${toRoot}/${d.path}"><code>${escapeHtml(d.path)}</code></a> — edit that file, not this one.</div>
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

function indexPage(index, health, cfg, truncated) {
  const clusters = index.clusters.map((c) => {
    const docs = c.documents.map((p) => index.documents.find((d) => d.path === p)).filter(Boolean)
      .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
    return `
<section class="cluster" id="c-${escapeHtml(c.id)}">
  <h2>${escapeHtml(c.title)} <span class="count">${docs.length}</span></h2>
  ${c.blurb ? `<p class="blurb">${escapeHtml(c.blurb)}</p>` : ''}
  <ul class="docs">
    ${docs.map((d) => `<li>
      <a class="dt" href="pages/${flatName(d.path)}">${escapeHtml(d.title || d.path)}</a>
      <span class="dm">${d.git ? d.git.date + ' · ' : ''}${d.lines.toLocaleString()} lines</span>
      ${d.excerpt ? `<span class="dx">${escapeHtml(d.excerpt.slice(0, 190))}</span>` : ''}
      <code class="dp">${escapeHtml(d.path)}</code>
    </li>`).join('\n')}
  </ul>
</section>`;
  }).join('\n');

  const nav = index.clusters.map((c) => `<a href="#c-${escapeHtml(c.id)}">${escapeHtml(c.title)} <span>${c.documents.length}</span></a>`).join('');

  return shell({
    title: `${index.siteTitle} · project-atlas`,
    siteTitle: index.siteTitle,
    body: `
<h1>${escapeHtml(index.siteTitle)}</h1>
<p class="lede">${index.stats.documents} documents · ${index.stats.lines.toLocaleString()} lines · ${index.stats.clusters} clusters ·
<a href="health.html">${health.blockingCount ? `<strong class="bad">${health.blockingCount} blocking</strong>` : '<span class="ok">no blocking findings</span>'}</a></p>

<div class="searchbox">
  <input id="q" type="search" placeholder="Search titles, headings and body text…" autocomplete="off" autofocus>
  <p id="qhint" class="hint">${truncated ? `${truncated} long document(s) are indexed to the first ${(cfg.searchBodyLimit || 6000).toLocaleString()} characters.` : 'Full text of every document is indexed.'}</p>
</div>
<div id="results" hidden></div>

<nav class="clusternav">${nav}</nav>
<div id="browse">
${clusters}
</div>
`,
    scripts: `<script src="search-index.js"></script>
<script>
(function () {
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
    var terms = v.split(/\\s+/);
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
})();
</script>`,
  });
}

function healthPage(index, health, cfg) {
  const sections = Object.values(SIGNALS).map((s) => {
    const items = health.findings.filter((f) => f.signal === s.id && !f.suppressed);
    const isBlocking = (cfg.blocking || []).includes(s.id);
    return `
<section class="panel">
  <h2><span class="sig ${isBlocking ? 'block' : 'adv'}">${s.id}</span> ${escapeHtml(s.title)}
    <span class="count ${items.length ? (isBlocking ? 'bad' : 'warn') : 'ok'}">${items.length}</span></h2>
  <p class="blurb">${escapeHtml(s.why)} ${isBlocking ? '<strong>Blocking</strong> — no legitimate cause.' : 'Advisory — legitimate exceptions exist.'}</p>
  ${items.length ? `<ul class="findings">${items.slice(0, 300).map((f) =>
      `<li><a href="pages/${flatName(f.doc)}">${escapeHtml(f.doc)}</a> <span class="det">${escapeHtml(f.detail || '')}</span></li>`).join('')}
      ${items.length > 300 ? `<li class="det">… and ${items.length - 300} more (run <code>atlas health --verbose=all</code>)</li>` : ''}</ul>` : ''}
</section>`;
  }).join('\n');

  const notChecked = health.notChecked.length
    ? `<section class="panel muted"><h2>Not checked</h2><ul>${health.notChecked.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></section>`
    : '';

  return shell({
    title: `Health · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
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
.brand { font-weight:650; color:var(--ink); }
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
