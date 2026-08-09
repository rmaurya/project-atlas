/**
 * project-atlas · project deck
 *
 * Renders a markdown source into a browser slide deck. **The deck has a markdown source file** like everything
 * else here — it is authored prose, committed and reviewed in a diff, and this module only presents it. There
 * is no "generate me a deck from the codebase" path, because that would be exactly the unreviewed generated
 * prose the whole design refuses.
 *
 * Source format: slides separated by a line of `---`. The first `#` in a slide is its title. A slide may carry
 * directives on its first line as an HTML comment:
 *   <!-- class: title -->     a title slide, centred and large
 *   <!-- class: section -->   a section divider
 *   <!-- notes: ... -->       presenter notes, shown only in overview
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, escapeHtml } from './markdown.mjs';
import { confine } from './paths.mjs';

export function readDeck(root, cfg) {
  const src = (cfg.deck && cfg.deck.source) || 'docs/atlas/DECK.md';
  // The deck is rendered into `deck.html`, which `publish --target pages` force-pushes to a public branch.
  // `path.join` accepted anything: `{"deck":{"source":"../../creds.env"}}` put `SECRET=hunter2` on the web.
  // Confined to the repository — and to the repository as the filesystem sees it, so a symlink is no route out.
  const file = confine(root, src, 'deck.source', cfg.__configPath);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, 'utf8');
  const chunks = raw.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);

  const slides = chunks.map((body, i) => {
    let cls = '';
    let notes = '';
    const b = body
      .replace(/<!--\s*class:\s*([\w -]+)\s*-->/i, (_, c) => { cls = c.trim(); return ''; })
      .replace(/<!--\s*notes:\s*([\s\S]*?)-->/i, (_, n) => { notes = n.trim(); return ''; })
      .trim();
    const title = (/^#{1,3}\s+(.+)$/m.exec(b) || [, `Slide ${i + 1}`])[1].replace(/[*`]/g, '');
    return { index: i, cls, notes, title, html: renderMarkdown(b) };
  });

  return { source: src, slides };
}

export function deckPage(deck, index, cfg) {
  const slides = deck.slides.map((s) => `
  <section class="slide ${escapeHtml(s.cls)}" id="s${s.index}" aria-label="${escapeHtml(s.title)}">
    <div class="slide-inner prose">${s.html}</div>
    ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ''}
  </section>`).join('\n');

  const toc = deck.slides.map((s) =>
    `<li><button type="button" data-go="${s.index}">${s.index + 1}. ${escapeHtml(s.title)}</button></li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(index.siteTitle)} — deck</title>
<link rel="stylesheet" href="atlas.css">
<style>${DECK_CSS}</style>
</head>
<body class="deck-body">
<div class="deck-bar">
  <a class="brand" href="index.html">← ${escapeHtml(index.siteTitle)}</a>
  <span class="spacer"></span>
  <button type="button" id="btnOverview" title="Overview (O)">Overview</button>
  <button type="button" id="btnPrint" title="Print / export to PDF">Print</button>
  <span class="counter"><span id="cur">1</span> / ${deck.slides.length}</span>
</div>

<div class="deck" id="deck">
${slides}
</div>

<nav class="deck-nav">
  <button type="button" id="prev" aria-label="Previous slide">‹</button>
  <button type="button" id="next" aria-label="Next slide">›</button>
</nav>

<aside class="overview" id="overview" hidden>
  <p class="ov-title">Slides</p>
  <ul>${toc}</ul>
</aside>

<p class="deck-hint">← → or space to move · <kbd>O</kbd> overview · <kbd>Esc</kbd> close · derived from
<code>${escapeHtml(deck.source)}</code></p>

<script>${DECK_JS}</script>
</body>
</html>
`;
}

const DECK_CSS = `
.deck-body { overflow-x:hidden; }
.deck-bar { position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:12px;
  padding:10px 5%; background:var(--bg); border-bottom:1px solid var(--line); font-size:13px; }
.deck-bar .spacer { margin-left:auto; }
.deck-bar button { font:inherit; color:var(--ink); background:var(--panel); border:1px solid var(--line);
  border-radius:7px; padding:4px 11px; cursor:pointer; }
.deck-bar button:hover { border-color:var(--link); color:var(--link); }
.counter { color:var(--muted); font-variant-numeric:tabular-nums; }
.deck { scroll-snap-type:y mandatory; height:calc(100vh - 45px); overflow-y:auto; scroll-behavior:smooth; }
.slide { scroll-snap-align:start; min-height:calc(100vh - 45px); display:flex; flex-direction:column;
  justify-content:center; padding:44px 0; border-bottom:1px solid var(--line); }
.slide-inner { width:80%; max-width:1000px; margin:0 auto; }
.slide h1 { font-size:38px; line-height:1.2; }
.slide h2 { font-size:27px; margin-top:0; }
.slide.title { text-align:center; }
.slide.title h1 { font-size:52px; letter-spacing:-.02em; }
.slide.title .prose p { font-size:19px; color:var(--muted); }
.slide.section { background:var(--panel); }
.slide.section h1,.slide.section h2 { font-size:34px; }
.notes { width:80%; max-width:1000px; margin:22px auto 0; padding-top:12px; border-top:1px dashed var(--line);
  color:var(--muted); font-size:13px; display:none; }
.deck-nav { position:fixed; right:18px; bottom:18px; display:flex; gap:8px; z-index:20; }
.deck-nav button { width:40px; height:40px; font-size:21px; line-height:1; cursor:pointer;
  color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:10px; }
.deck-nav button:hover { border-color:var(--link); color:var(--link); }
.overview { position:fixed; inset:45px 0 0 0; z-index:30; background:var(--bg); overflow-y:auto; padding:26px 5%; }
.overview .ov-title { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
.overview ul { list-style:none; padding:0; margin:0; display:grid; gap:6px; max-width:760px; }
.overview button { width:100%; text-align:left; font:inherit; color:var(--ink); background:var(--panel);
  border:1px solid var(--line); border-radius:8px; padding:11px 14px; cursor:pointer; }
.overview button:hover { border-color:var(--link); color:var(--link); }
.deck-hint { position:fixed; left:18px; bottom:18px; margin:0; font-size:11.5px; color:var(--muted); z-index:20; }
kbd { font-family:ui-monospace,monospace; font-size:11px; border:1px solid var(--line);
  border-bottom-width:2px; border-radius:4px; padding:0 4px; }
@media print {
  .deck-bar,.deck-nav,.deck-hint,.overview { display:none !important; }
  .deck { height:auto; overflow:visible; }
  .slide { min-height:auto; page-break-after:always; border:0; padding:24px 0; }
  .notes { display:block; }
}
@media (max-width:820px) { .slide-inner,.notes { width:92%; } .slide h1 { font-size:30px; } .slide.title h1 { font-size:38px; } }
`;

const DECK_JS = `
(function () {
  var deck = document.getElementById('deck');
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  var cur = document.getElementById('cur'), ov = document.getElementById('overview');
  var i = 0;
  function go(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    cur.textContent = i + 1;
  }
  document.getElementById('next').addEventListener('click', function () { go(i + 1); });
  document.getElementById('prev').addEventListener('click', function () { go(i - 1); });
  document.getElementById('btnPrint').addEventListener('click', function () { window.print(); });
  document.getElementById('btnOverview').addEventListener('click', function () { ov.hidden = !ov.hidden; });
  ov.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (!b) return;
    ov.hidden = true; go(Number(b.dataset.go));
  });
  // Keep the counter honest when the user scrolls rather than clicks.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { i = slides.indexOf(en.target); cur.textContent = i + 1; }
      });
    }, { threshold: 0.5 });
    slides.forEach(function (s) { io.observe(s); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input,textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1); }
    else if (e.key === 'o' || e.key === 'O') { ov.hidden = !ov.hidden; }
    else if (e.key === 'Escape') { ov.hidden = true; }
  });
})();
`;
