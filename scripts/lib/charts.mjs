/**
 * project-atlas · chart primitives
 *
 * Inline SVG, no dependencies, no script needed to draw — the same constraints every other generated page
 * here works under, because these charts travel into a wiki, a single file and an artifact whose policy
 * blocks outbound requests.
 *
 * ## The categorical palette, and why there was not one before
 *
 * This file's older sibling states: *"Every chart is single-series or ordinal. There is no categorical
 * palette here, because there is no chart whose job is identity."* That was true and is no longer: a
 * contributor breakdown is exactly a chart whose job is identity, so a categorical palette had to exist.
 *
 * **It was computed, not chosen.** Both sets below were run through the palette validator against their own
 * surface — lightness band, chroma floor, colour-vision separation, normal-vision separation, contrast — and
 * the first two candidates failed (a teal that read as grey on light; two steps outside the band on dark).
 * Dark is a **separate selection**, not the light set flipped: flipping put a slot outside the band
 * immediately.
 *
 * One result carries an obligation. Adjacent tritan separation is ΔE 3.8 on the dark set, below the safe
 * floor, which is legal **only with secondary encoding** — so every categorical chart here is direct-labelled
 * and never relies on colour alone. That is not a nicety; it is the condition under which this palette is
 * allowed to ship.
 *
 * ## Interaction, and why there is no JavaScript in it
 *
 * Every chart here answers "what is the value at this point" on hover and on focus, without a line of
 * script. That is not minimalism for its own sake; three constraints leave no other route.
 *
 * - **The published page runs under a strict CSP.** Whatever these charts do has to survive it. The pages
 *   deliver behaviour as an inline `<script>` block (`THEME_WIRE`, `TABLE_JS` — never an `onclick=`
 *   attribute, never an external file), so a script *is* possible. It is simply not necessary here.
 * - **`<main>` is replaced wholesale by live reload.** `TABLE_JS::refresh` sets `main.innerHTML` from a
 *   freshly fetched page, and markup injected that way never executes its own `<script>`. A chart that
 *   needed script to be readable would go dead on the first rebuild, on the one surface — a dashboard left
 *   open under `atlas watch` — where that happens every few seconds. `:hover` and `:focus` cannot go dead.
 * - **No ids.** `verifyPage` fails a page with a duplicate id and `exportSingleFile` rewrites colliding ones
 *   across every bundled page. Interaction keyed on ids would owe both of those a per-chart unique key;
 *   interaction keyed on structure owes them nothing.
 *
 * So the interactive parts are drawn by the build — a hit band per x position, a crosshair, a readout — and
 * revealed by CSS. Two consequences worth stating. Keyboard reaches exactly what the pointer reaches,
 * because a hit band is `tabindex="0"` and `:focus` shows the same readout `:hover` does; and nothing on
 * these charts moves except a readout appearing, which is the only movement that carries information.
 *
 * ## What these will not do
 *
 * - **No dual axis.** Two measures of different scale get two charts. A second y-scale can be drawn to say
 *   anything the author wants, and readers cannot see the choice.
 * - **No pie beyond a few slices, and none at all for one.** A pie of a single contributor is a circle; a
 *   pie of twelve is a lottery wheel. Both are answered better by a bar.
 * - **Nothing invented.** A missing figure is drawn as missing, never as zero, and an estimate says it is
 *   one — the rule the rest of this project already holds to.
 * - **No legend toggling.** Hiding a band on a *stacked* chart moves every band above it, and hiding a line
 *   leaves a y-axis scaled to a series that is no longer on the page: both restate the remaining data
 *   without saying so. Legend hover highlights instead, which changes nothing about what is claimed.
 */

import { escapeHtml, escapeAttr } from './markdown.mjs';
import { num } from './format.mjs';

/**
 * Identity colours, in fixed order. Never cycled: a ninth series folds into "other" rather than reusing a
 * hue, because a repeated colour is a claim that two different things are the same thing.
 */
export const CAT = {
  light: ['#7c4dee', '#0d9488', '#b45309', '#9d174d', '#1d4ed8', '#4d7c0f'],
  dark: ['#9575e8', '#0f9e8f', '#d97706', '#e05a8a', '#3b82f6', '#6ba310'],
};
export const CAT_MAX = CAT.light.length;

/**
 * How much of a band's own colour survives into an area fill.
 *
 * **Computed against each theme's own card, not chosen, and not one number for both.** A band sits on
 * `--panel` — `#faf8f5` on light, `#101018` on dark — and an alpha does opposite things to the two: over the
 * near-white card a colour washes *towards* the ground and loses contrast, over the near-black one it stands
 * away from it. Requiring the same floor from both therefore requires two alphas.
 *
 * The floor: every one of the six slots must reach **1.6:1 against its own card** as a fill — enough that the
 * region is visible as a region and not only as its edge. Weakest slot at these values is teal on light
 * (1.62:1) and the fourth slot on dark (1.61:1), so the two themes are held to the same line rather than to
 * whatever each could manage. Going higher costs the thing transparency was for: a gridline read through the
 * fill keeps 84% of its native contrast at .40 on light and 82% at .34 on dark, and at the old solid .82 it
 * kept 29% and 16% — which is why the axis vanished under the bands.
 *
 * Identity is never carried by the fill. It is carried by the opaque full-strength edge above it, which
 * clears 3.5:1 on light and 5.1:1 on dark for every slot, and by the direct label — the condition the palette
 * validator attached to this palette and the reason a translucent fill does not weaken it.
 */
export const BAND_FILL = { light: '.40', dark: '.34' };

/** CSS custom properties for the categorical slots, emitted once per page. */
export function catTokens() {
  const decl = (mode) => `${CAT[mode].map((c, i) => `--cat-${i}:${c};`).join(' ')} --band-fill:${BAND_FILL[mode]};`;
  // Legend hover highlights its own series and dims the rest. Generated per slot because CSS cannot compare
  // one element's class to another's; six rules, and no chart needs a seventh because no chart gets a
  // seventh hue. Hover only, deliberately: a focusable <span> that is not a control is a role nobody can
  // name, and the keyboard reader already has the better path — every data point is focusable and states
  // its series by name.
  const highlight = CAT.light.map((_, i) =>
    `.chart:has(.lg-${i}:hover) .cs:not(.cs-${i}) { opacity:.16; }`).join('\n');
  return `
:root { ${decl('light')} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${decl('dark')} } }
:root[data-theme="dark"] { ${decl('dark')} }
.chart-note { font-size:11.5px; color:var(--muted); margin:6px 0 0; }
.legend { display:flex; flex-wrap:wrap; gap:4px 14px; margin:10px 0 0; font-size:12px; }
.legend span { display:inline-flex; align-items:center; gap:6px; color:var(--ink-soft, var(--muted)); }
.legend i { width:9px; height:9px; border-radius:2px; display:inline-block; flex:0 0 auto; }
.c-axis { stroke:var(--rule); stroke-width:1; }
.c-grid { stroke:var(--rule); stroke-width:1; opacity:.55; }
.c-tick { font-size:10px; fill:var(--muted); }
.c-lbl { font-size:11px; fill:var(--ink-soft, var(--muted)); }
.spark { margin:10px 0 0; }
/* A fixed height, and a viewBox drawn at its natural size inside it. The tile this sits in is between 190px
 * and 300px wide depending on how many tiles share the row, and a sparkline that grew taller as its tile grew
 * wider would leave one tile in a strip of five standing a centimetre proud of its neighbours. Aligned left
 * (xMinYMid) so a short series starts under the number it belongs to rather than floating mid-tile. */
.spark svg { display:block; width:100%; height:34px; }
.spark-cap { margin:3px 0 0; font-size:11px; color:var(--muted); }

/* ---------------------------------------------------------------- area fills and their edges
 * The fill states extent; the edge states identity and where the band stops. They are two elements because
 * they are two jobs: one is translucent so the gridlines it crosses stay readable, the other is opaque so
 * the boundary between two bands is a line somebody drew rather than a change of tint.
 *
 * The edge replaced a 2px stroke in var(--surface) drawn around the *whole* band. That was wrong twice
 * over: --surface is the page's white, not the card's --panel, so the "gap" was a visible pale outline on
 * light; and painting a boundary in the background colour erases it instead of stating it. */
.c-fill { fill-opacity:var(--band-fill); stroke:none; }
.c-edge { fill:none; stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }

/* ---------------------------------------------------------------- interaction
 * No script; see the note at the top of this file for why not. Everything here is :hover / :focus on
 * elements the build already emitted, so it survives a strict CSP, survives live reload replacing the page
 * body (which re-parses markup and would never re-run a script), and needs no ids.
 *
 * A caution for whoever edits this text: it is emitted into a style block in the document head, and two of
 * the tools downstream read the page with regular expressions rather than a parser. exportBundle finds a
 * page body by matching from the first opening main tag to the first closing one, and it censuses ids by
 * matching the id attribute pattern. Writing either of those shapes here — even inside a comment — is
 * writing them into the page. The first draft of this block did both, and the bundle came out with every
 * page's topbar nested inside another page's section and the clock declared a dozen times. */
.c-band { cursor:crosshair; }
.c-hit { fill:transparent; }
/* Hidden, and out of the way: an invisible readout that still swallowed pointer events would stop the band
 * next to it from ever being hovered. */
.c-read { opacity:0; pointer-events:none; }
.c-band:hover .c-read, .c-band:focus .c-read, .c-band:focus-within .c-read { opacity:1; }
/* The focus ring is drawn, not delegated: an SVG element's UA outline is inconsistent between engines and
 * clipped by the viewBox in some of them. Dashed --ink reads on both themes without borrowing a hue that
 * means something else on a chart. */
.c-band:focus { outline:none; }
.c-band:focus-visible { outline:none; }
/* **:focus-within is the one that fires; :focus is kept only as belt and braces.** Measured in Chrome
 * against a focused band: document.activeElement is the group, matches(":focus-within") is true and
 * matches(":focus") is false. A tabbable SVG group is focused there without ever matching :focus, so every
 * rule below that depends on focus states both — written the other way round, a keyboard reader would move
 * a focus ring around a chart that never changed. (No backticks in this stylesheet: it is a template
 * literal, and the first draft of this paragraph ended the string and broke the build.) */
/* rect.c-hit, not .c-hit: a donut's hit area is a 36px-wide transparent arc, and a stroke declared in CSS
 * beats the stroke-width attribute that makes it wide. The ring would have collapsed the hit path to a
 * 1.5px line hidden under the slice — no ring drawn, and the pointer target quietly gone. The donut states
 * focus the other way, by dimming every slice that is not the focused one and putting that slice's own
 * figure in the hub. */
.c-band:focus rect.c-hit,
.c-band:focus-within rect.c-hit { stroke:var(--ink); stroke-width:1.5; stroke-dasharray:3 3; }
.c-cross { stroke:var(--ink); stroke-width:1; stroke-dasharray:2 3; opacity:.5; }
.c-dot { stroke:var(--surface); stroke-width:1.6; }
/* Sparkline bars are one to sixteen pixels wide, where a half-pixel edge is a visible smear rather than an
 * antialiased nicety. */
.sb { shape-rendering:crispEdges; }
.c-tipbg { fill:var(--surface); stroke:var(--rule); stroke-width:1; }
.c-tip { font-size:11px; fill:var(--ink); }
.c-tip-k { font-weight:660; }
.c-tip-m { fill:var(--muted); }
.c-tip-s { font-size:10px; }
/* The donut's hub carries the total until a slice is pointed at, and that slice's own figure while it is.
 * One number in one place, rather than a second readout competing with it. */
.c-hub-n { font-size:17px; font-weight:640; fill:var(--ink); }
.chart:has(.c-band:hover) .c-hub, .chart:has(.c-band:focus-within) .c-hub { opacity:0; }
.chart svg:has(.c-band:hover) .c-band:not(:hover) .c-arc,
.chart svg:has(.c-band:focus-within) .c-band:not(:focus-within) .c-arc { opacity:.3; }
.spark svg:focus-visible { outline:2px solid var(--link); outline-offset:2px; }
.lg { border-radius:4px; }
${highlight}
`;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const nice = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/**
 * The values a time chart's gridlines are drawn at, for a series whose maximum is `max`.
 *
 * **Evenly spaced thirds are right for a large maximum and a lie for a small one.** `nice` states a whole
 * number below 1000, so with a maximum of 1 the middle line — drawn at 0.5 — is labelled `1`, and the axis
 * reads *0, 1, 1*: two lines at two heights claiming the same value, with nothing on the page to say which one
 * to believe. It is not only the duplicate. Every odd maximum is mislabelled the same way and more quietly: at
 * 7 the middle line sits at 3.5 and says `4`, so a reader measuring a point against it is off by half a unit
 * and has no reason to suspect it. The economics view sidestepped this by going cumulative; every other series
 * that peaks in single figures still walked into it.
 *
 * So below 1000 the lines are placed on **whole units — the granularity their own labels are stated at** — and
 * a line is dropped rather than drawn wrong: one whose label would name a value it is not at, and one whose
 * label would repeat a line already drawn. Two gridlines are a legitimate axis; two contradictory ones are not.
 *
 * At 1000 and above `nice` is openly approximate (`12k` for 12,345) and the thirds stand: rounding a label
 * that already declares itself rounded is not the same defect.
 */
function gridValues(max) {
  const small = max < 1000;
  const mid = small ? Math.round(max / 2) : max / 2;
  const wanted = mid > 0 && mid < max ? [0, mid, max] : [0, max];
  const seen = new Set();
  return wanted.filter((v) => {
    if (small && Number(nice(v)) !== v) return false;    // the label would name a height this line is not at
    const label = nice(v);
    if (seen.has(label)) return false;                   // and no two lines may carry the same one
    seen.add(label);
    return true;
  });
}

/** Horizontal gridlines with their labels, shared by every chart that has a y-axis so the rule cannot fork. */
function yGrid({ max, y, pad, w }) {
  return gridValues(max).map((v) =>
    `<line class="c-grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
     <text class="c-tick" x="${pad.l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${nice(v)}</text>`).join('');
}

/**
 * The x labels: one every `step`, and always the last one.
 *
 * **The final label is anchored at its right edge, not centred.** Centred, it sits at `w - pad.r` — ten pixels
 * from the edge of the viewBox — so half of a five-character date, some fourteen pixels, hung outside the
 * viewBox and was clipped on every time chart this tool draws, including the Commits-per-week chart shipped on
 * the Delivery page.
 *
 * Anchoring rather than widening `pad.r`, for two reasons. A wider right pad is a fixed guess about how wide
 * the widest label will ever be, and the next caller with a longer one re-breaks it silently; `text-anchor`
 * is bounded by construction, whatever the label says. And `pad.r` is in the x scale, so widening it moves
 * every plotted point, path and gridline in every chart — a far larger change than the defect. This touches
 * one attribute on one label and nothing that carries data.
 */
function xTicks({ labels, x, h }) {
  const step = Math.ceil(labels.length / 6);
  const last = labels.length - 1;
  // **And the one before it is dropped when the two would collide.** The stepped labels land on multiples of
  // `step`; the last one lands on `n - 1`, which is only a multiple when the count divides evenly. With
  // fourteen points the step is 3, so a label is drawn at index 12 and another at 13 — two five-character
  // dates seventeen pixels apart, printed over each other. Measured against the last label's own left edge
  // rather than against an index rule, because the collision is about pixels: a wide chart with a short
  // label has room for both, and dropping one there would throw away a tick for nothing.
  const lastLeft = x(last) - textWidth(labels[last], 10) - 4;
  return labels.map((l, i) => {
    if (i !== last && (i % step !== 0 || x(i) + textWidth(l, 10) / 2 > lastLeft)) return '';
    return `<text class="c-tick" x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="${i === last ? 'end' : 'middle'}">${escapeHtml(l)}</text>`;
  }).join('');
}

/**
 * The width a run of text occupies, in user units, at a given font size.
 *
 * There is no text measurement without a layout engine, so this is an estimate and deliberately a generous
 * one: it sizes the plate a readout is printed on, and a plate half a character too wide is invisible while
 * one half a character too narrow puts a descender over a gridline. 0.56em is the average advance of the
 * system sans stack across digits, lower case and the separators these labels use.
 */
const textWidth = (s, size) => s.length * size * 0.56;

/**
 * The hover-and-focus layer for a chart with an x index: one band per position, each carrying a crosshair, a
 * dot on every series at that position, and a readout stating the label and every value under it.
 *
 * **The band spans the full plot height, not the mark.** Asking a reader to land on a 3px dot is asking them
 * to already know where the value is, which is the question. A band reaches from halfway to its left
 * neighbour to halfway to its right, so every pixel of the plot belongs to exactly one x position.
 *
 * **The plate is placed away from the data, and the placement is computed here rather than at read time.**
 * Horizontally it flips to the other side of the crosshair past the midline and is then clamped inside the
 * viewBox, so no readout is ever half off the picture — the same defect `xTicks` fixed for the last axis
 * label, arrived at from the other direction. Vertically it takes the half of the plot the data is not in.
 *
 * Every band is `tabindex="0"` and carries the whole row as `aria-label`, so the keyboard and the screen
 * reader get exactly what the pointer gets. That is the whole reason this is markup and not a script.
 */
function readBands({ labels, rowsAt, x, y, w, h, pad }) {
  const mid = (pad.l + (w - pad.r)) / 2;
  const plotMid = (pad.t + (h - pad.b)) / 2;
  const lineH = 13, size = 11;

  return labels.map((label, j) => {
    const rows = rowsAt(j);
    // Half-way to each neighbour, and flush to the axis ends at the two extremes: a strip of unclaimed
    // pixels at the edge of the plot is a place where hovering the chart does nothing for no visible reason.
    const left = j === 0 ? pad.l : (x(j - 1) + x(j)) / 2;
    const right = j === labels.length - 1 ? w - pad.r : (x(j) + x(j + 1)) / 2;

    const lines = [{ text: label, key: true }, ...rows.map((r) => ({ text: `${r.label} ${r.text}`, muted: r.muted }))];
    const tw = Math.max(...lines.map((l) => textWidth(l.text, size))) + 12;
    const th = lines.length * lineH + 8;
    // Clamped a pixel inside the viewBox rather than flush to it: the plate has a 1px stroke, and half of it
    // sits outside the box at exactly `w - tw`.
    const bx = Math.max(1, Math.min(x(j) > mid ? x(j) - 9 - tw : x(j) + 9, w - tw - 1));
    // The tip takes the half the data is not in. `top` is the highest mark at this position, so a large
    // `top` means the marks are low on the plot and the space above them is free.
    const top = rows.length ? Math.min(...rows.map((r) => (Number.isFinite(r.cy) ? r.cy : h))) : h;
    const by = top > plotMid ? pad.t + 2 : h - pad.b - th - 2;

    const dots = rows.filter((r) => Number.isFinite(r.cy) && r.slot != null).map((r) =>
      `<circle class="c-dot" cx="${x(j).toFixed(1)}" cy="${r.cy.toFixed(1)}" r="3.6" fill="var(--cat-${r.slot})"/>`).join('');
    const text = lines.map((l, i) =>
      `<text class="c-tip${l.key ? ' c-tip-k' : ''}${l.muted ? ' c-tip-m' : ''}" x="${(bx + 6).toFixed(1)}"
         y="${(by + 14 + i * lineH).toFixed(1)}">${escapeHtml(l.text)}</text>`).join('');

    const spoken = `${label}: ${rows.map((r) => `${r.label} ${r.text}`).join(', ') || 'no data'}`;
    return `<g class="c-band" tabindex="0" role="img" aria-label="${escapeAttr(spoken)}">
      <rect class="c-hit" x="${left.toFixed(1)}" y="${pad.t}" width="${Math.max(0, right - left).toFixed(1)}" height="${(h - pad.b - pad.t).toFixed(1)}"/>
      <g class="c-read">
        <line class="c-cross" x1="${x(j).toFixed(1)}" x2="${x(j).toFixed(1)}" y1="${pad.t}" y2="${h - pad.b}"/>
        ${dots}
        <rect class="c-tipbg" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="5"/>
        ${text}
      </g>
    </g>`;
  }).join('');
}

/**
 * A sparkline for a stat tile: the tile states the total, this states the shape that produced it.
 *
 * There was no small form here, so a page could carry a headline number and no way to see which way it was
 * moving without scrolling to a full chart a thousand pixels below — which on the Executive view, whose
 * whole promise is a thirty-second read, meant direction was effectively absent.
 *
 * Four choices, each of which is a way this could otherwise mislead:
 *
 *  - **Columns, not a line.** These are counts in discrete buckets. A line drawn between two weekly samples
 *    slopes through days nobody measured, and a young repository has two weeks of history — where a line is
 *    one straight segment that says nothing a pair of bars does not.
 *  - **One hue for every bar.** Shading each bar by its own value would double-encode height as colour and
 *    spend the only free channel on information the bar already carries.
 *  - **Every value is reachable without hovering.** The whole series is in the accessible label and each bar
 *    carries its own title: a figure that exists only in a tooltip does not exist for most readers.
 *  - **A missing value is a gap, not a zero.** `null` leaves the slot empty rather than drawing a floor-high
 *    bar, so "no figure" and "measured none" cannot be confused. The caller decides which one it has.
 *
 * Refuses below two points, for the reason `donut` refuses below two slices: one bar is a rectangle, and a
 * rectangle is not a trend.
 *
 * **The bars are the one thing on this page that is not individually focusable, and that is the accessible
 * choice rather than a shortfall.** A stat strip carries five of these; at a dozen weeks each, focusable bars
 * would put sixty tab stops between the top of the page and its first real control, to spell out a series
 * that the svg's own `aria-label` already reads in one stop — which is why the svg takes the tab stop
 * instead. Pointing at a bar names it and its figure, and dims the rest so it is clear which one was named.
 */
export function sparkbars({ values, labels = [], caption = '', unit = '', fill = 'var(--cat-0)', w = 176, h = 34 }) {
  const known = values.filter((v) => Number.isFinite(v));
  if (known.length < 2) return '';

  const n = values.length;
  const gap = 2;                                   // the surface gap, so adjacent bars never touch
  // Capped, then the drawing is sized to what it actually needs. Two weeks of history spread across the full
  // tile produced a pair of 117px slabs that read as a progress bar rather than a series; past sixteen pixels
  // a bar stops looking like one mark among many.
  const bw = Math.max(1, Math.min(16, (w - gap * (n - 1)) / n));
  const drawn = n * bw + gap * (n - 1);
  const max = Math.max(...known, 1);
  const slot = (i) => i * (bw + gap);
  // A measured zero still occupies its slot and draws nothing; the baseline underneath is what says the slot
  // exists. A 1.5px floor on everything above zero keeps a small non-zero week from vanishing, which would
  // read as the same thing as a week with no work in it.
  const height = (v) => (v === 0 ? 0 : Math.max(1.5, (v / max) * (h - 1)));
  const bars = values.map((v, i) => (Number.isFinite(v)
    ? `<rect class="sb" x="${slot(i).toFixed(2)}" y="${(h - 1 - height(v)).toFixed(2)}" width="${bw.toFixed(2)}"
        height="${height(v).toFixed(2)}" rx="${Math.min(1.5, bw / 2).toFixed(2)}" fill="${escapeAttr(fill)}"/>`
    : '')).join('');

  // **A second pass, after every bar.** A readout emitted inside its own bar's group is painted before every
  // later bar, and a plate eighteen characters wide covers a dozen of them — so the bars for the rest of the
  // series drew straight over the figure meant to be read. The hit areas go last as one layer; they paint
  // nothing, so nothing is covered by them either.
  const bands = values.map((v, i) => {
    const said = `${labels[i] ?? i + 1}: ${Number.isFinite(v) ? `${num(v)}${unit}` : 'no figure'}`;
    // The plate sits over the top of the strip rather than beside the bar: 34px leaves no room for a second
    // row, and a figure printed below the baseline would land on the caption.
    const tw = textWidth(said, 10) + 8;
    const tx = Math.max(0, Math.min(slot(i) + bw / 2 - tw / 2, Math.max(0, drawn - tw)));
    const cx = slot(i) + bw / 2;
    return `<g class="c-band"><title>${escapeAttr(said)}</title>
      <rect class="c-hit" x="${slot(i).toFixed(2)}" y="0" width="${Math.min(bw + gap, drawn - slot(i)).toFixed(2)}" height="${h}"/>
      <g class="c-read">
        <line class="c-cross" x1="${cx.toFixed(2)}" x2="${cx.toFixed(2)}" y1="0" y2="${h - 1}"/>
        <rect class="c-tipbg" x="${tx.toFixed(2)}" y="0" width="${tw.toFixed(2)}" height="15" rx="4"/>
        <text class="c-tip c-tip-s" x="${(tx + 4).toFixed(2)}" y="11">${escapeHtml(said)}</text>
      </g>
    </g>`;
  }).join('');

  const spoken = values.map((v, i) => `${labels[i] ?? i + 1} ${Number.isFinite(v) ? nice(v) : 'unknown'}`).join(', ');
  return `<div class="spark">
  <svg viewBox="0 0 ${drawn.toFixed(2)} ${h}" preserveAspectRatio="xMinYMid meet" role="img" tabindex="0"
       aria-label="${escapeAttr(`${caption || 'Trend'}: ${spoken}`)}">
    ${bars}
    <line class="c-axis" x1="0" x2="${drawn.toFixed(2)}" y1="${h - 0.5}" y2="${h - 0.5}"/>
    ${bands}
  </svg>
  ${caption ? `<p class="spark-cap">${escapeHtml(caption)}</p>` : ''}
</div>`;
}

/**
 * A composition chart: what the whole is made of.
 *
 * A donut rather than a pie, because the hole is where the total goes and a total is the number people
 * actually want. **Refuses to draw below two slices** — a single-slice pie is a circle that says "100%",
 * which every reader already knew — and folds a long tail into `other` rather than inventing hues.
 */
export function donut({ title, slices, unit = '', note = null, size = 168 }) {
  const clean = slices.filter((s) => Number.isFinite(s.value) && s.value > 0)
                      .sort((a, b) => b.value - a.value);
  if (clean.length < 2) {
    return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
      <p class="empty">${clean.length ? `Only one contributor here, so a share chart would say nothing a
      number does not: <strong>${escapeHtml(clean[0].label)}</strong>, ${nice(clean[0].value)}${escapeHtml(unit)}.`
      : 'No data to divide.'}</p></figure>`;
  }

  const shown = clean.slice(0, CAT_MAX - 1);
  const rest = clean.slice(CAT_MAX - 1);
  const parts = rest.length ? [...shown, { label: `${rest.length} other`, value: sum(rest.map((r) => r.value)) }] : shown;
  const total = sum(parts.map((p) => p.value));

  const r = size / 2 - 12, cx = size / 2, cy = size / 2, thick = 22;
  let angle = -Math.PI / 2;
  const arc = (a0, a1, sweep) => {
    const large = sweep > Math.PI ? 1 : 0;
    return `M${(cx + r * Math.cos(a0)).toFixed(2)} ${(cy + r * Math.sin(a0)).toFixed(2)} ` +
           `A${r} ${r} 0 ${large} 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}`;
  };
  const arcs = parts.map((p, i) => {
    const sweep = (p.value / total) * Math.PI * 2;
    // A 2px surface gap between segments, so adjacent fills never touch — the separation is structural
    // rather than dependent on the two colours being distinguishable.
    const gap = parts.length > 1 ? 0.018 : 0;
    const a0 = angle + gap / 2, a1 = angle + sweep - gap / 2;
    angle += sweep;
    const pct = Math.round((p.value / total) * 100);
    const said = `${p.label}: ${num(p.value)}${unit} · ${pct}%`;
    // **A hit arc half again as thick as the ring.** The ring is 22px and its two ends are the two places a
    // reader aims; asking for the pointer to be inside a 22px annulus to learn what a slice is worth is the
    // same barrier as asking it to land on a 3px dot. The wide arc is transparent and painted first, so it
    // takes the pointer without taking any ink.
    return `<g class="c-band cs cs-${i}" tabindex="0" role="img" aria-label="${escapeAttr(said)}">
      <title>${escapeAttr(said)}</title>
      <path class="c-hit" d="${arc(a0, a1, sweep)}" fill="none" stroke="transparent" stroke-width="${thick + 14}"/>
      <path class="c-arc" d="${arc(a0, a1, sweep)}" fill="none" stroke="var(--cat-${i})" stroke-width="${thick}" stroke-linecap="butt"/>
      <g class="c-read">
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="c-lbl c-hub-n">${num(p.value)}${escapeHtml(unit)}</text>
        <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="c-tick">${escapeHtml(p.label)} · ${pct}%</text>
      </g>
    </g>`;
  }).join('');

  // Every slice is named in the legend with its figure, so identity is never colour-alone — the condition
  // the palette validator attached to this palette.
  const legend = parts.map((p, i) =>
    `<span class="lg lg-${i}"><i style="background:var(--cat-${i})"></i>${escapeHtml(p.label)} · ${nice(p.value)}${escapeHtml(unit)}
     (${Math.round((p.value / total) * 100)}%)</span>`).join('');

  // `role="group"`, not `role="img"`. An SVG marked as an image is a single opaque graphic to a screen
  // reader and everything inside it — including a focusable slice with a name — is discarded. Every chart
  // here that became reachable had to stop claiming to be a picture; the label the picture carried moves on
  // to the group, where it is still announced on entry.
  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="group"
       aria-label="${escapeAttr(title)}: ${parts.map((p) => `${p.label} ${nice(p.value)}`).join(', ')}">
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="c-lbl c-hub c-hub-n">${nice(total)}</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="c-tick c-hub">${escapeHtml(unit || 'total')}</text>
    ${arcs}
  </svg>
  <div class="legend">${legend}</div>
  ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
</figure>`;
}

/**
 * Change over time, one or more series.
 *
 * 2px strokes, markers only when the series is short enough for them to mean something, and a single shared
 * y-axis — never two. Points with no value break the line rather than being interpolated: a straight
 * segment across a gap is a claim that nothing happened, which is different from not knowing.
 */
export function lineChart({ title, series, labels, unit = '', note = null, w = 460, h = 170 }) {
  const live = series.filter((s) => s.values.some((v) => Number.isFinite(v)));
  if (!live.length || labels.length < 2) {
    return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
      <p class="empty">Not enough history to plot a trend yet.</p></figure>`;
  }
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const max = Math.max(...live.flatMap((s) => s.values.filter(Number.isFinite))) || 1;
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1);
  const y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);

  const grid = yGrid({ max, y, pad, w });

  const paths = live.map((s, i) => {
    // A gap is a gap. `M` restarts the path where a value is missing rather than drawing through it.
    let d = '', pen = false;
    s.values.forEach((v, j) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(j).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    // The markers no longer carry a `<title>`. The hit bands sit above them, so a native tooltip anchored to
    // a 3px circle could never have been triggered again — and the band states every series at that position
    // rather than the one the pointer happened to touch, on focus as well as on hover.
    const dots = labels.length <= 14 ? s.values.map((v, j) => Number.isFinite(v)
      ? `<circle cx="${x(j).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" fill="var(--cat-${i})"
           stroke="var(--surface)" stroke-width="2"/>` : '').join('') : '';
    return `<g class="cs cs-${i}"><path d="${d.trim()}" fill="none" stroke="var(--cat-${i})" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>${dots}</g>`;
  }).join('');

  const ticks = xTicks({ labels, x, h });

  // Every live series is stated at every position, missing ones included: `num` prints an em dash for a
  // value that is not there, so a gap in the readout says "not known" in the same breath as its neighbours
  // say a figure. Dropping the row would leave the reader to notice an absence.
  const bands = readBands({
    labels, x, y, w, h, pad,
    rowsAt: (j) => live.map((s, i) => ({
      label: s.label, slot: i, muted: !Number.isFinite(s.values[j]),
      text: `${num(s.values[j])}${Number.isFinite(s.values[j]) ? unit : ''}`,
      cy: Number.isFinite(s.values[j]) ? y(s.values[j]) : null,
    })),
  });

  const legend = live.length > 1
    ? `<div class="legend">${live.map((s, i) => `<span class="lg lg-${i}"><i style="background:var(--cat-${i})"></i>${escapeHtml(s.label)}</span>`).join('')}</div>`
    : '';

  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${w} ${h}" role="group" aria-label="${escapeAttr(`${title}. ${live.map((s) => s.label).join(', ')}. ${labels.length} points, each one focusable.`)}">
    ${grid}
    <line class="c-axis" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>
    ${paths}${ticks}${bands}
  </svg>${legend}
  ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
</figure>`;
}

/**
 * Composition over time — how a total divides, and how that division moves.
 *
 * **Stacked, and it matters that it is.** The bands are cumulative: each one starts where the one below it
 * ended, so nothing is ever drawn behind anything else and the top of the last band is the total. It is
 * worth saying plainly because the fill used to be near-solid, which reads exactly like two overlaid shapes
 * with the rear one painted out — and the two cases want opposite fixes. Overlaid, a solid fill hides data
 * and transparency is a correctness fix. Stacked, nothing is hidden by the fill; what a solid fill hid here
 * was the *axis*, and that is what transparency gives back.
 *
 * **A translucent fill and an opaque edge, as two elements.**
 *
 * The old band was one path: `fill-opacity:.82` with a 2px stroke in `var(--surface)` around the whole
 * outline. Three things were wrong with it. At .82 the gridlines under a band kept about a fifth of their
 * contrast, so a reader could see the shape and had nothing to measure it against — the y-axis existed and
 * could not be used. The stroke was `--surface`, the page white, while a chart sits on a `--panel` card, so
 * the "gap" was a pale outline rather than a gap. And a boundary painted in the background colour is a
 * boundary erased: the line where one band stops and the next begins is the single most informative line on
 * a stacked chart, and it was being deleted.
 *
 * Now the fill states extent at `--band-fill` (see `BAND_FILL` for how the two alphas were arrived at, and
 * why light and dark do not share one), and a second path states the top edge only, at full strength and
 * fully opaque. Identity survives the transparency because it never depended on the fill: the edge clears
 * 3.5:1 against its card on the weakest slot of either theme, and every band is direct-labelled.
 */
export function stackedArea({ title, series, labels, unit = '', note = null, w = 460, h = 170 }) {
  if (!series.length || labels.length < 2) {
    return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
      <p class="empty">Not enough history to plot a composition yet.</p></figure>`;
  }
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const totals = labels.map((_, i) => sum(series.map((s) => s.values[i] || 0)));
  const max = Math.max(...totals) || 1;
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, labels.length - 1);
  const y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);

  const shown = series.slice(0, CAT_MAX);
  const tops = [];                                     // the cumulative top of each band, kept for the readout
  let base = labels.map(() => 0);
  const areas = shown.map((s, i) => {
    const top = labels.map((_, j) => base[j] + (s.values[j] || 0));
    const up = top.map((v, j) => `${x(j).toFixed(1)} ${y(v).toFixed(1)}`).join(' L');
    const down = [...base].reverse().map((v, j) => `${x(labels.length - 1 - j).toFixed(1)} ${y(v).toFixed(1)}`).join(' L');
    tops.push(top);
    base = top;
    return `<g class="cs cs-${i}">
      <path class="c-fill" d="M${up} L${down} Z" fill="var(--cat-${i})"/>
      <path class="c-edge" d="M${up}" stroke="var(--cat-${i})"/>
    </g>`;
  }).join('');
  const drawnTotals = labels.map((_, j) => sum(shown.map((s) => s.values[j] || 0)));

  const grid = yGrid({ max, y, pad, w });
  const ticks = xTicks({ labels, x, h });

  // The dot for each band sits on its own top edge — the cumulative height, which is where the boundary the
  // reader is looking at actually is — while the figure beside it is the band's own value, not the running
  // sum. A stacked chart is the one place those two differ, so the total is stated as its own row rather
  // than left to be added up off the axis.
  const bands = readBands({
    labels, x, y, w, h, pad,
    rowsAt: (j) => [
      ...shown.map((s, i) => ({ label: s.label, slot: i, text: `${num(s.values[j] || 0)}${unit}`, cy: y(tops[i][j]) })),
      ...(shown.length > 1 ? [{ label: 'total', slot: null, muted: true, text: `${num(drawnTotals[j])}${unit}`, cy: y(drawnTotals[j]) }] : []),
    ],
  });

  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${w} ${h}" role="group" aria-label="${escapeAttr(`${title}. Stacked: ${shown.map((s) => s.label).join(', ')}. ${labels.length} points, each one focusable.`)}">
    ${grid}${areas}
    <line class="c-axis" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>
    ${ticks}${bands}
  </svg>
  <div class="legend">${shown.map((s, i) =>
    `<span class="lg lg-${i}"><i style="background:var(--cat-${i})"></i>${escapeHtml(s.label)}</span>`).join('')}</div>
  ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
</figure>`;
}
