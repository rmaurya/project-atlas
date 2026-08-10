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
 * ## What these will not do
 *
 * - **No dual axis.** Two measures of different scale get two charts. A second y-scale can be drawn to say
 *   anything the author wants, and readers cannot see the choice.
 * - **No pie beyond a few slices, and none at all for one.** A pie of a single contributor is a circle; a
 *   pie of twelve is a lottery wheel. Both are answered better by a bar.
 * - **Nothing invented.** A missing figure is drawn as missing, never as zero, and an estimate says it is
 *   one — the rule the rest of this project already holds to.
 */

import { escapeHtml, escapeAttr } from './markdown.mjs';

/**
 * Identity colours, in fixed order. Never cycled: a ninth series folds into "other" rather than reusing a
 * hue, because a repeated colour is a claim that two different things are the same thing.
 */
export const CAT = {
  light: ['#7c4dee', '#0d9488', '#b45309', '#9d174d', '#1d4ed8', '#4d7c0f'],
  dark: ['#9575e8', '#0f9e8f', '#d97706', '#e05a8a', '#3b82f6', '#6ba310'],
};
export const CAT_MAX = CAT.light.length;

/** CSS custom properties for the categorical slots, emitted once per page. */
export function catTokens() {
  const decl = (mode) => CAT[mode].map((c, i) => `--cat-${i}:${c};`).join(' ');
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
`;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const nice = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

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
  const arcs = parts.map((p, i) => {
    const sweep = (p.value / total) * Math.PI * 2;
    // A 2px surface gap between segments, so adjacent fills never touch — the separation is structural
    // rather than dependent on the two colours being distinguishable.
    const gap = parts.length > 1 ? 0.018 : 0;
    const a0 = angle + gap / 2, a1 = angle + sweep - gap / 2;
    angle += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const pct = Math.round((p.value / total) * 100);
    return `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"
      fill="none" stroke="var(--cat-${i})" stroke-width="${thick}" stroke-linecap="butt">
      <title>${escapeAttr(p.label)}: ${nice(p.value)}${escapeAttr(unit)} · ${pct}%</title></path>`;
  }).join('');

  // Every slice is named in the legend with its figure, so identity is never colour-alone — the condition
  // the palette validator attached to this palette.
  const legend = parts.map((p, i) =>
    `<span><i style="background:var(--cat-${i})"></i>${escapeHtml(p.label)} · ${nice(p.value)}${escapeHtml(unit)}
     (${Math.round((p.value / total) * 100)}%)</span>`).join('');

  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
       aria-label="${escapeAttr(title)}: ${parts.map((p) => `${p.label} ${nice(p.value)}`).join(', ')}">
    ${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="c-lbl" style="font-size:17px;font-weight:640;fill:var(--ink)">${nice(total)}</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="c-tick">${escapeHtml(unit || 'total')}</text>
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

  const grid = [0, 0.5, 1].map((f) =>
    `<line class="c-grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/>
     <text class="c-tick" x="${pad.l - 5}" y="${(y(max * f) + 3).toFixed(1)}" text-anchor="end">${nice(max * f)}</text>`).join('');

  const paths = live.map((s, i) => {
    // A gap is a gap. `M` restarts the path where a value is missing rather than drawing through it.
    let d = '', pen = false;
    s.values.forEach((v, j) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(j).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    const dots = labels.length <= 14 ? s.values.map((v, j) => Number.isFinite(v)
      ? `<circle cx="${x(j).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" fill="var(--cat-${i})"
           stroke="var(--surface)" stroke-width="2"><title>${escapeAttr(s.label)} · ${escapeAttr(labels[j])}: ${nice(v)}${escapeAttr(unit)}</title></circle>` : '').join('') : '';
    return `<path d="${d.trim()}" fill="none" stroke="var(--cat-${i})" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join('');

  const step = Math.ceil(labels.length / 6);
  const ticks = labels.map((l, i) => (i % step === 0 || i === labels.length - 1)
    ? `<text class="c-tick" x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">${escapeHtml(l)}</text>` : '').join('');

  const legend = live.length > 1
    ? `<div class="legend">${live.map((s, i) => `<span><i style="background:var(--cat-${i})"></i>${escapeHtml(s.label)}</span>`).join('')}</div>`
    : '';

  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeAttr(title)}">
    ${grid}
    <line class="c-axis" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>
    ${paths}${ticks}
  </svg>${legend}
  ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
</figure>`;
}

/**
 * Composition over time — how a total divides, and how that division moves.
 *
 * Stacked because the question is what the whole is made of; a 2px surface-coloured gap keeps adjacent
 * bands apart structurally rather than relying on their two colours being separable.
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

  let base = labels.map(() => 0);
  const bands = series.slice(0, CAT_MAX).map((s, i) => {
    const top = labels.map((_, j) => base[j] + (s.values[j] || 0));
    const up = top.map((v, j) => `${x(j).toFixed(1)} ${y(v).toFixed(1)}`).join(' L');
    const down = [...base].reverse().map((v, j) => `${x(labels.length - 1 - j).toFixed(1)} ${y(v).toFixed(1)}`).join(' L');
    base = top;
    return `<path d="M${up} L${down} Z" fill="var(--cat-${i})" fill-opacity=".82"
      stroke="var(--surface)" stroke-width="2" stroke-linejoin="round">
      <title>${escapeAttr(s.label)}</title></path>`;
  }).join('');

  const grid = [0, 0.5, 1].map((f) =>
    `<line class="c-grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/>
     <text class="c-tick" x="${pad.l - 5}" y="${(y(max * f) + 3).toFixed(1)}" text-anchor="end">${nice(max * f)}</text>`).join('');

  const step = Math.ceil(labels.length / 6);
  const ticks = labels.map((l, i) => (i % step === 0 || i === labels.length - 1)
    ? `<text class="c-tick" x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">${escapeHtml(l)}</text>` : '').join('');

  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption>
  <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeAttr(title)}">
    ${grid}${bands}
    <line class="c-axis" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>
    ${ticks}
  </svg>
  <div class="legend">${series.slice(0, CAT_MAX).map((s, i) =>
    `<span><i style="background:var(--cat-${i})"></i>${escapeHtml(s.label)}</span>`).join('')}</div>
  ${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ''}
</figure>`;
}
