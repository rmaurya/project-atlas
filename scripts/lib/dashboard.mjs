/**
 * project-atlas · dashboard
 *
 * Charts and a sortable, searchable item table over the planning document and the corpus health.
 *
 * Design notes, so nobody "improves" these into the usual mistakes:
 *  - **Every chart is single-series or ordinal.** There is no categorical palette here, because there is no
 *    chart whose job is identity. Magnitude across categories is a bar chart in one hue.
 *  - **The progress ramp is a validated ordinal ramp** (blue, monotone lightness, light end clearing 2:1 on
 *    both surfaces). Not a rainbow, not a red→green gradient.
 *  - **Status colours are the reserved status palette**, and they never appear without a text label — colour
 *    alone is not an encoding.
 *  - **Unknown is not zero.** An item with no recorded percentage is drawn as unknown and excluded from means.
 *    Charting it as 0% would invent data.
 *  - **Estimated figures are hatched**, because the source distinguishes measured from estimated and a chart
 *    that flattens that distinction is lying quietly.
 */

import { escapeHtml } from './markdown.mjs';
import { SIGNALS } from './health.mjs';
import { taskCoverage } from './contrib.mjs';
import { PANELS } from './views.mjs';

/**
 * Ordinal progress ramps — one per theme, each validated against the surface it actually sits on.
 *
 * Light  #b09af0 → #7c4dee → #3d2280 on #faf8f5 — light end 2.27:1, hue spread 6°
 * Dark   #e2d0ff → #b98cff → #6d3fd1 on #101018 — light end 2.96:1, hue spread 11°
 *
 * Both pass monotone lightness and a ΔL ≥ 0.06 gap between steps. **Re-run the palette validator before
 * touching any of these six values** — the light end sitting just above a 2:1 floor is exactly the thing that
 * looks fine by eye and fails the check.
 */
export const RAMP = {
  light: { none: '#e2ddd2', mid: '#b09af0', high: '#7c4dee', done: '#3d2280', unknown: '#d5cfc2' },
  dark: { none: '#242433', mid: '#e2d0ff', high: '#b98cff', done: '#6d3fd1', unknown: '#1c1c28' },
};

/**
 * State colours. Reserved: never a data series, and never the only signal — every use carries a text label.
 * The light steps are darkened for a light ground; the dark steps are the neon set, which needs the
 * saturation to read at all against near-black.
 */
export const STATUS = {
  light: { good: '#2f7d4f', warning: '#9a5f16', serious: '#b0561f', critical: '#b03530' },
  dark: { good: '#3ef2a0', warning: '#ffc857', serious: '#ff9f5c', critical: '#ff5c7a' },
};

/**
 * Status colours are used inline in a few places (a stat-tile dot, a health bar). Those cannot switch with
 * the theme through a CSS variable unless the variable exists, so they are emitted as `var(--st-*)` and the
 * two sets are declared once in the stylesheet below.
 */
const st = (role) => `var(--st-${role})`;

/**
 * One page per view. The view supplies an ordered list of panel ids; every panel is written once and
 * rendered here. A panel that has nothing to show returns null and is **omitted with a note** rather than
 * rendered as an empty box — an empty box reads as "nothing to report", which is a different claim.
 */
export function viewPage(view, ctx, shell) {
  const { index, health, plan, cfg, contrib, nav } = ctx;

  const built = view.panels.map((id) => ({ id, html: panel(id, ctx) }));
  const rendered = built.filter((b) => b.html);
  const omitted = built.filter((b) => !b.html).map((b) => b.id);

  // The item table is wide; on a view that shows it, it takes the side column and everything else the main.
  const showsItems = rendered.some((b) => b.id === 'items');
  const main = rendered.filter((b) => b.id !== 'items').map((b) => b.html).join('\n');
  const side = rendered.filter((b) => b.id === 'items').map((b) => b.html).join('\n');

  const body = `
<h1>${escapeHtml(view.title)}</h1>
<p class="lede">${escapeHtml(view.blurb || '')}
<span class="stamp" id="stamp"></span></p>
${showsItems ? `<div class="dash"><div class="dash-main">${main}</div><aside class="dash-side">${side}</aside></div>`
             : `<div class="dash-single">${main}</div>`}
${omitted.length ? `<section class="card muted"><h2>Not shown on this page</h2>
  <p class="cap">Omitted because there is no data behind them, not because they were excluded.</p>
  <ul>${omitted.map((id) => `<li><strong>${escapeHtml(id)}</strong> — ${escapeHtml(PANELS[id] || '')}</li>`).join('')}</ul>
</section>` : ''}`;

  return shell({
    title: `${view.title} · ${index.siteTitle}`,
    siteTitle: index.siteTitle,
    nav,
    body,
    extraHead: `<style>${DASH_CSS}</style>`,
    scripts: `<script>${TABLE_JS}</script>`,
  });
}

/** Returns the panel's HTML, or null when it has nothing to say. */
function panel(id, { index, health, plan, cfg, contrib }) {
  const hasPlan = plan && !plan.missing;
  const hasContrib = contrib && contrib.available;

  switch (id) {
    case 'tiles': return tiles(index, health, plan);
    case 'progress': return hasPlan ? progressChart(plan) : null;
    case 'status': return hasPlan ? statusChart(plan) : null;
    case 'items': return hasPlan ? itemTable(plan) : null;
    case 'health': return healthChart(health, cfg);
    case 'clusters': return clusterChart(index);
    case 'deliveryTiles': return hasContrib ? deliveryTiles(contrib) : null;
    case 'velocity': return hasContrib ? velocityChart(contrib) : null;
    case 'models': return hasContrib && contrib.agents.length ? modelChart(contrib) : null;
    case 'people': return hasContrib ? peopleTable(contrib) : null;
    case 'desks': return hasContrib ? desksChart(contrib) : null;
    case 'coverage': return hasContrib && hasPlan ? coverageChart(contrib, plan) : null;
    case 'caveats': return caveats(plan, health, contrib);
    default: return null;
  }
}

/* ------------------------------------------------------------------ tiles */

function tiles(index, health, plan) {
  const t = [];
  if (plan && !plan.missing) {
    t.push(tile(String(plan.stats.total), 'open items', plan.stats.unknown ? `${plan.stats.unknown} without a figure` : 'all carry a figure'));
    t.push(tile(plan.stats.mean === null ? '—' : `${plan.stats.mean}%`, 'mean completion',
      `across ${plan.stats.total - plan.stats.unknown} measured`));
  }
  t.push(tile(String(health.blockingCount), 'blocking findings',
    health.blockingCount ? 'defects with no legitimate cause' : 'none — corpus is clean',
    health.blockingCount ? 'critical' : 'good'));
  t.push(tile(String(index.stats.documents), 'documents', `${index.stats.clusters} clusters`));
  return `<section class="tiles">${t.join('')}</section>`;
}

function tile(value, label, sub, tone) {
  const dot = tone ? `<span class="dot" style="background:${st(tone)}"></span>` : '';
  return `<div class="tile"><p class="tv">${dot}${escapeHtml(value)}</p><p class="tl">${escapeHtml(label)}</p><p class="ts">${escapeHtml(sub)}</p></div>`;
}

/* ------------------------------------------------------------------ charts */

function progressChart(plan) {
  const tracks = plan.tracks.filter((t) => t.mean !== null).sort((a, b) => b.mean - a.mean);
  if (!tracks.length) return null;
  return `
<figure class="card">
  <figcaption><h2>Mean completion by track</h2>
    <p class="cap">Percent complete, averaged over the items in each track that carry a figure. Tracks with no measured item are omitted rather than shown as zero.</p></figcaption>
  ${hbar(tracks.map((t) => ({
    label: t.name.replace(/^Track \d+\s*[—–-]\s*/, ''),
    value: t.mean, max: 100, suffix: '%',
    tone: toneFor(t.mean),
    hint: `${t.known} of ${t.count} items measured`,
  })))}
</figure>`;
}

function statusChart(plan) {
  const rows = plan.stats.byStatus.filter((b) => b.count)
    .concat(plan.stats.unknown ? [{ label: 'Unknown', tone: 'unknown', count: plan.stats.unknown }] : []);
  if (!rows.length) return null;
  return `
<figure class="card">
  <figcaption><h2>Items by status</h2>
    <p class="cap">Every tracked item, bucketed by its recorded completion. Colour follows the same ordinal ramp as the bars above; each bucket is labelled, so colour is never the only signal.</p></figcaption>
  ${hbar(rows.map((b) => ({
    label: b.label, value: b.count, max: Math.max(...rows.map((x) => x.count)),
    tone: b.tone, hint: `${b.count} item(s)`,
  })))}
</figure>`;
}

function healthChart(health, cfg) {
  const rows = Object.values(SIGNALS).map((s) => ({
    id: s.id, title: s.title, count: health.counts[s.id] || 0,
    blocking: (cfg.blocking || []).includes(s.id), why: s.why,
  })).filter((r) => r.count > 0);

  if (!rows.length) {
    return `<figure class="card"><figcaption><h2>Documentation health</h2></figcaption>
      <p class="empty"><span class="dot" style="background:${st('good')}"></span> No findings. Every signal reports clean.</p></figure>`;
  }
  const max = Math.max(...rows.map((r) => r.count));
  return `
<figure class="card">
  <figcaption><h2>Documentation health</h2>
    <p class="cap">Findings per rot signal. <strong>Blocking</strong> signals have no legitimate cause; advisory ones do — an archived record <em>should</em> cite code that has since moved. Read the delta, not the absolute.</p></figcaption>
  <div class="bars">
    ${rows.map((r) => `
    <div class="bar" title="${escapeHtml(r.why)}">
      <span class="bl"><span class="sig ${r.blocking ? 'block' : 'adv'}">${r.id}</span> ${escapeHtml(r.title)}</span>
      <span class="bt"><span class="bf" style="width:${Math.max(2, (r.count / max) * 100)}%;background:${r.blocking ? st('critical') : st('warning')}"></span></span>
      <span class="bv">${r.count}<span class="bh">${r.blocking ? 'blocking' : 'advisory'}</span></span>
    </div>`).join('')}
  </div>
</figure>`;
}

function clusterChart(index) {
  const rows = index.clusters.map((c) => ({ label: c.title, value: c.documents.length })).sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `
<figure class="card">
  <figcaption><h2>Documents by cluster</h2>
    <p class="cap">Where the corpus actually lives. A large <em>Uncategorised</em> count is a missing taxonomy rule, not a problem with the documents.</p></figcaption>
  ${hbar(rows.map((r) => ({ label: r.label, value: r.value, max, tone: 'high', hint: `${r.value} document(s)` })))}
</figure>`;
}

function hbar(rows) {
  if (!rows.length) return '<p class="empty">Nothing to chart.</p>';
  return `<div class="bars">${rows.map((r) => `
    <div class="bar">
      <span class="bl">${escapeHtml(r.label)}</span>
      <span class="bt"><span class="bf t-${r.tone}${r.estimated ? ' est' : ''}" style="width:${Math.max(2, (r.value / (r.max || 1)) * 100)}%"></span></span>
      <span class="bv">${r.value}${r.suffix || ''}<span class="bh">${escapeHtml(r.hint || '')}</span></span>
    </div>`).join('')}</div>`;
}

const toneFor = (p) => (p === null ? 'unknown' : p === 0 ? 'none' : p >= 100 ? 'done' : p >= 90 ? 'high' : 'mid');

/* ------------------------------------------------------------------ table */

function itemTable(plan) {
  return `
<section class="card" id="items">
  <h2>All items <span class="count">${plan.items.length}</span></h2>
  <p class="cap">Click a column heading to sort. Type to filter across id, title, track, priority and status.
  A hatched bar means the figure is <strong>estimated in the source</strong>, not measured against the code.</p>
  <input id="tq" type="search" placeholder="Filter every column…" autocomplete="off">
  <div class="table-wrap">
    <table id="itbl">
      <!-- Progress and status lead, before the descriptive columns. In a side-by-side layout the table
           scrolls horizontally, and whatever sits last is what gets scrolled out of sight — so the two
           columns the list exists to show must not be last. -->
      <thead><tr>
        <th data-k="id" class="sortable">ID</th>
        <th data-k="percent" class="sortable num" data-default="desc">Progress</th>
        <th data-k="status" class="sortable">Status</th>
        <th data-k="title" class="sortable">Item</th>
        <th data-k="priority" class="sortable">Pri</th>
        <th data-k="criticality" class="sortable">Crit</th>
        <th data-k="track" class="sortable">Track</th>
      </tr>
      <!-- Per-column filters. Populated by script: a column with few distinct values becomes a dropdown,
           one with many becomes a text box, and the numeric column gets a minimum. Built from the rendered
           rows rather than declared here, so it stays correct if the columns change. -->
      <tr class="filters" id="tfilters"></tr>
      </thead>
      <tbody>
        ${plan.items.map((i) => `<tr data-percent="${i.percent === null ? -1 : i.percent}">
          <td class="mono">${escapeHtml(i.id)}</td>
          <td class="num">
            <span class="mini"><span class="mf t-${i.status.tone}${i.estimated ? ' est' : ''}" style="width:${i.percent === null ? 0 : i.percent}%"></span></span>
            <span class="pct">${i.percent === null ? '—' : i.percent + '%'}${i.estimated ? '<abbr title="estimated in the source, not measured against the code">*</abbr>' : ''}</span>
          </td>
          <td><span class="pill t-${i.status.tone}">${escapeHtml(i.status.label)}</span></td>
          <td><strong>${escapeHtml(i.title)}</strong><span class="sum">${escapeHtml(i.summary || '')}</span></td>
          <td class="mono">${escapeHtml(i.priority)}</td>
          <td>${escapeHtml(i.criticality)}</td>
          <td>${escapeHtml(i.track.replace(/^Track \d+\s*[—–-]\s*/, ''))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <p class="hint" id="tcount"></p>
</section>`;
}

function noPlanning(cfg) {
  return `<figure class="card"><figcaption><h2>Planning</h2></figcaption>
  <p class="empty">No planning source configured, so no item charts are drawn — rather than charting nothing and calling it zero.
  Set <code>planning.source</code> in <code>project-atlas.config.json</code> to a task list such as <code>docs/TASKS.md</code>.</p></figure>`;
}

function caveats(plan, health, contrib) {
  const notes = [...(plan && !plan.missing ? plan.notes : []), ...health.notChecked,
                 ...(contrib?.available ? contrib.caveats.map((c) => c.replace(/\*\*/g, '')) : [])];
  if (!notes.length) return '';
  return `<section class="card muted">
    <h2>What this dashboard does not show</h2>
    <p class="cap">Stated explicitly, because a dashboard that silently omits reads as one that found nothing.</p>
    <ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
  </section>`;
}


/* ------------------------------------------------------------------ delivery */

/**
 * What git history says about how the work happened. Every number here is derived from `git log` — no
 * telemetry, no service.
 *
 * Three rules this section exists to hold, because a delivery panel is where they get broken first:
 *  - **No combined score, and no ranking of people.** Commits, files and churn sit side by side; collapsing
 *    them into one number hides which one is driving it.
 *  - **Active hours are an estimate**, computed from commit rhythm rather than time worked, and the label
 *    says so on the page rather than in a footnote nobody reaches.
 *  - **Nothing is silently capped.** Where a chart shows a window, the window is stated.
 */
function deliveryTiles(contrib) {
  const t = contrib.totals, q = contrib.quality;
  return `
<section class="tiles">
  ${tile(String(t.commits), 'commits', `${t.first} → ${t.last}`)}
  ${tile(`${Math.round((t.aiAssisted / t.commits) * 100)}%`, 'AI-assisted', `${t.aiAssisted} of ${t.commits}`)}
  ${tile(`${q.reworkRate}%`, 'rework rate', `a file re-touched within ${q.reworkWindowDays} days`)}
  ${tile(`${q.conventionalRate}%`, 'conventional subjects', `${q.reverts} revert(s)`)}
</section>
<p class="cap sect">Derived entirely from <code>git log</code>. <strong>Not a measure of prompt quality</strong>:
a repository cannot see a prompt. These are outcomes under their real names.</p>`;
}

function velocityChart(contrib) {
  const weeks = contrib.weeks.slice(-12);
  if (!weeks.length) return null;
  const trimmed = contrib.weeks.length - weeks.length;
  const max = Math.max(...weeks.map((w) => w.commits), 1);
  return `
<figure class="card">
  <figcaption><h2>Commits per week</h2>
    <p class="cap">${weeks.length} week(s) shown${trimmed ? `, the most recent of ${contrib.weeks.length} — the earlier ${trimmed} are omitted for width, not because they were empty` : ''}.
    Commit count measures rhythm, not value.</p></figcaption>
  ${hbar(weeks.map((w) => ({
    label: w.week, value: w.commits, max, tone: 'high',
    hint: `${w.ai} AI-assisted · +${w.added.toLocaleString()} / −${w.removed.toLocaleString()}`,
  })))}
</figure>`;
}

function modelChart(contrib) {
  const max = Math.max(...contrib.agents.map((a) => a.commits));
  return `
<figure class="card">
  <figcaption><h2>Model mix</h2>
    <p class="cap">Read from the <code>Co-Authored-By</code> trailer on each commit. It records which model
    assisted, not how much of the result it produced.</p></figcaption>
  ${hbar(contrib.agents.map((a) => ({
    label: a.agent, value: a.commits, max, tone: 'mid', hint: `${a.first} → ${a.last}`,
  })))}
</figure>`;
}

function peopleTable(contrib) {
  return `
<section class="card">
  <h2>People <span class="count">${contrib.people.length}</span></h2>
  <p class="cap">Side by side, deliberately. There is no combined contribution score and no ranking —
  collapsing these into one number would hide which one is moving.</p>
  <div class="table-wrap">
    <table class="mini-table">
      <thead><tr><th>Author</th><th class="num">Commits</th><th class="num">Files</th>
        <th class="num">+ / −</th><th class="num">Days</th><th class="num">Est. hours</th></tr></thead>
      <tbody>${contrib.people.map((p) => `<tr>
        <td>${escapeHtml(p.name)}<span class="sum">${p.aiAssisted} AI-assisted · ${p.first} → ${p.last}</span></td>
        <td class="num">${p.commits}</td>
        <td class="num">${p.files}</td>
        <td class="num">+${p.added.toLocaleString()} / −${p.removed.toLocaleString()}</td>
        <td class="num">${p.days}</td>
        <td class="num">${p.estimatedHours}<abbr title="Estimated from gaps between commits, not time worked. A floor, not a timesheet.">*</abbr></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  <p class="hint">* estimated from commit rhythm over ${contrib.people.reduce((n, p) => n + p.sessions, 0)} session(s) — not time worked</p>
</section>`;
}

function desksChart(contrib) {
  if (!contrib.desks.configured) {
    return `<figure class="card muted"><figcaption><h2>Desks</h2></figcaption>
      <p class="empty">No commit carries a <code>Desk:</code> trailer, so per-desk attribution is unavailable.
      Adopting the trailer works going forward only — history cannot be tagged retroactively.</p></figure>`;
  }
  const max = Math.max(...contrib.desks.desks.map((d) => d.commits));
  return `
<figure class="card">
  <figcaption><h2>Desks</h2>
    <p class="cap">From the <code>Desk:</code> commit trailer.${contrib.desks.untagged ? ` ${contrib.desks.untagged} commit(s) carry no trailer and are not counted here; history cannot be tagged retroactively.` : ''}</p></figcaption>
  ${hbar(contrib.desks.desks.map((d) => ({
    label: d.desk, value: d.commits, max, tone: 'high', hint: `${d.estimatedHours} est. hours`,
  })))}
</figure>`;
}

function coverageChart(contrib, plan) {
  const cov = taskCoverage(contrib, plan);
  if (!cov) return null;
  return `
<figure class="card">
  <figcaption><h2>Spec to build</h2>
    <p class="cap">Items named by at least one commit subject. A low number is often a commit convention —
    subjects that describe the defect rather than the ticket — not abandoned work. Read it as a question.</p></figcaption>
  ${hbar([
    { label: 'Named by a commit', value: cov.withCommits, max: cov.rows.length, tone: 'high', hint: `of ${cov.rows.length} items` },
    { label: 'Never named', value: cov.withoutCommits, max: cov.rows.length, tone: 'none',
      hint: cov.claimedButUnreferenced ? `${cov.claimedButUnreferenced} of these report progress` : '' },
  ])}
</figure>`;
}

/* ------------------------------------------------------------------ assets */

const DASH_CSS = `
/* Layout ladder.
 * Below 1180px everything stacks — a 10" tablet has no room for a side column, and a squeezed table is
 * worse than a scrolled one.
 * At 1180px and up (a 13" laptop and above) the charts and the item list sit side by side, because the
 * charts summarise and the list is the detail you scan against them; putting the list a full screen-height
 * below the charts is what left all that empty space in the first place.
 * The list column never goes below 430px, and its table keeps its own horizontal scroll, so no column of
 * data is ever hidden to make the layout fit. */
.dash { display:grid; gap:16px; align-items:start; }
@media (min-width:1180px) {
  .dash { grid-template-columns:minmax(0,1.05fr) minmax(430px,0.95fr); }
  .dash-side { position:sticky; top:58px; max-height:calc(100vh - 74px); display:flex; flex-direction:column; }
  .dash-side > .card { display:flex; flex-direction:column; min-height:0; margin:0; }
  .dash-side .table-wrap { overflow:auto; min-height:0; }
  #itbl thead tr:first-child th { position:sticky; top:0; z-index:2; background:var(--panel); }
}
@media (min-width:1500px) { .dash { grid-template-columns:minmax(0,1.15fr) minmax(520px,0.85fr); } }
.dash-main { min-width:0; }
.dash-side { min-width:0; }

.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; margin:20px 0 28px; }
.tile { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.tv { font-size:30px; font-weight:660; margin:0; letter-spacing:-.02em; display:flex; align-items:center; gap:8px; }
.tl { margin:2px 0 0; font-size:13px; color:var(--ink); }
.ts { margin:2px 0 0; font-size:12px; color:var(--muted); }
.dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
.grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
@media (max-width:640px) { .grid2 { grid-template-columns:1fr; } }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 20px; margin:0 0 16px; }
.card h2 { margin:0 0 4px; font-size:16px; }
.cap { color:var(--muted); font-size:13px; margin:0 0 14px; }
figcaption { display:block; }
.bars { display:grid; gap:9px; }
.bar { display:grid; grid-template-columns:minmax(84px,30%) 1fr auto; align-items:center; gap:12px; font-size:13.5px; }
@media (max-width:520px) { .bar { grid-template-columns:1fr auto; } .bar .bt { grid-column:1 / -1; order:3; } }
.bl { color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bt { background:var(--code-bg); border-radius:4px; height:16px; overflow:hidden; }
.bf { display:block; height:100%; border-radius:0 4px 4px 0; }
.bv { color:var(--ink); font-variant-numeric:tabular-nums; font-size:13px; text-align:right; min-width:52px; }
.bh { display:block; color:var(--muted); font-size:11px; }
.t-none { background:var(--r-none); } .t-mid { background:var(--r-mid); }
.t-high { background:var(--r-high); } .t-done { background:var(--r-done); }
.t-unknown { background:var(--r-unknown); }
.est { background-image:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.45) 3px,rgba(255,255,255,.45) 6px); }
.empty { color:var(--muted); font-size:14px; margin:0; display:flex; align-items:center; gap:8px; }
#tq { width:100%; padding:9px 12px; margin:0 0 12px; font-size:14px; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:8px; }
/* A minimum width, so a narrow column scrolls the table rather than crushing it — squeezing wraps the id
 * onto two lines and clips the status pill, which is how you end up hiding data to make a layout fit. */
#itbl { border-collapse:collapse; width:100%; min-width:660px; font-size:13.5px; }
#itbl th,#itbl td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
/* Column widths, sized to the content each holds. Without these the progress column takes space it does not
 * need and the item title wraps one word per line — which is what the layout did before this block existed. */
#itbl th:nth-child(1),#itbl td:nth-child(1) { white-space:nowrap; width:1%; }              /* id       */
#itbl th:nth-child(2),#itbl td:nth-child(2) { white-space:nowrap; width:120px; }           /* progress */
#itbl th:nth-child(3),#itbl td:nth-child(3) { white-space:nowrap; width:1%; }              /* status   */
#itbl th:nth-child(4),#itbl td:nth-child(4) { min-width:230px; }                           /* item     */
#itbl th:nth-child(5),#itbl td:nth-child(5),
#itbl th:nth-child(6),#itbl td:nth-child(6) { white-space:nowrap; width:1%; }              /* pri/crit */
#itbl td:nth-child(7) { white-space:nowrap; max-width:140px; overflow:hidden; text-overflow:ellipsis; }

/* Row hover. The whole row lifts, so the eye can follow a value across seven columns without losing the line. */
#itbl tbody tr { transition:background-color .09s ease; }
#itbl tbody tr:hover { background:var(--code-bg); }
#itbl tbody tr:hover .mini { outline:1px solid var(--line); }
@media (prefers-reduced-motion: reduce) { #itbl tbody tr { transition:none; } }

/* Per-column filter row */
#itbl tr.filters th { padding:5px 8px 8px; border-bottom:1px solid var(--line); }
.ftxt,.fsel,.fnum {
  width:100%; min-width:0; font:inherit; font-size:12px; color:var(--ink);
  background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:3px 6px;
}
.fnum { width:100%; min-width:58px; }
#itbl tr.filters th { min-width:74px; }
#itbl tr.filters th:nth-child(4) { min-width:150px; }
.ftxt:focus,.fsel:focus,.fnum:focus { outline:2px solid var(--link); outline-offset:1px; }
.fsel { cursor:pointer; }
/* Sticky leading columns were tried and removed: combined with a sticky filter row they hid the first three
 * filter controls behind the frozen cells, and pinned the header over the first data row. The columns are
 * width-constrained now, so the table rarely needs horizontal scroll in the first place. */
#itbl th.sortable { cursor:pointer; user-select:none; white-space:nowrap; }
#itbl th.sortable:hover { color:var(--link); }
#itbl th[aria-sort]:after { content:" ▾"; }
#itbl th[aria-sort="ascending"]:after { content:" ▴"; }
#itbl td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
/* Clamp the summary to two lines: full text stays in the DOM (so the filter still matches on it) but a
 * long one cannot make a row four times the height of its neighbours. */
.sum { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  color:var(--muted); font-size:12.5px; margin-top:2px; }

.mini { display:inline-block; width:64px; height:8px; background:var(--code-bg); border-radius:3px; overflow:hidden; vertical-align:middle; margin-right:7px; }
.mf { display:block; height:100%; }
.pct { font-size:12.5px; }
.pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px; color:#fff; white-space:nowrap; }
.pill.t-none,.pill.t-unknown { color:var(--ink); }
.sect { margin:0 0 16px; font-size:13.5px; }
.dash-single { display:grid; gap:16px; }
@media (min-width:1180px) { .dash-single { grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); align-items:start; }
  .dash-single > .tiles, .dash-single > .sect { grid-column:1 / -1; } }
.mini-table { border-collapse:collapse; width:100%; font-size:13.5px; min-width:520px; }
.mini-table th,.mini-table td { border-bottom:1px solid var(--line); padding:7px 10px; text-align:left; }
.mini-table th.num,.mini-table td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.mini-table tbody tr:hover { background:var(--code-bg); }
.stamp { color:var(--muted); font-size:12px; }
abbr { text-decoration:none; cursor:help; color:var(--muted); }
:root { --st-good:${STATUS.light.good}; --st-warning:${STATUS.light.warning};
        --st-serious:${STATUS.light.serious}; --st-critical:${STATUS.light.critical};
        --r-none:${RAMP.light.none}; --r-mid:${RAMP.light.mid}; --r-high:${RAMP.light.high}; --r-done:${RAMP.light.done}; --r-unknown:${RAMP.light.unknown}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --st-good:${STATUS.dark.good}; --st-warning:${STATUS.dark.warning};
  --st-serious:${STATUS.dark.serious}; --st-critical:${STATUS.dark.critical};
  --r-none:${RAMP.dark.none}; --r-mid:${RAMP.dark.mid}; --r-high:${RAMP.dark.high}; --r-done:${RAMP.dark.done}; --r-unknown:${RAMP.dark.unknown}; } }
:root[data-theme="dark"] { --st-good:${STATUS.dark.good}; --st-warning:${STATUS.dark.warning};
  --st-serious:${STATUS.dark.serious}; --st-critical:${STATUS.dark.critical};
  --r-none:${RAMP.dark.none}; --r-mid:${RAMP.dark.mid}; --r-high:${RAMP.dark.high}; --r-done:${RAMP.dark.done}; --r-unknown:${RAMP.dark.unknown}; }
`;

const TABLE_JS = `
(function () {
  var tbl = document.getElementById('itbl'); if (!tbl) return;
  var tb = tbl.tBodies[0], rows = Array.prototype.slice.call(tb.rows);
  var q = document.getElementById('tq'), cnt = document.getElementById('tcount');
  var dir = {}, cols = {};
  Array.prototype.forEach.call(tbl.tHead.rows[0].cells, function (th, i) { cols[th.dataset.k] = i; });

  function val(row, k) {
    if (k === 'percent') return Number(row.dataset.percent);
    return (row.cells[cols[k]].textContent || '').trim().toLowerCase();
  }
  function sortBy(k, th) {
    var d = dir[k] = dir[k] === 'asc' ? 'desc' : 'asc';
    Array.prototype.forEach.call(tbl.tHead.rows[0].cells, function (c) { c.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', d === 'asc' ? 'ascending' : 'descending');
    rows.sort(function (a, b) {
      var x = val(a, k), y = val(b, k);
      var r = typeof x === 'number' ? x - y : x < y ? -1 : x > y ? 1 : 0;
      return d === 'asc' ? r : -r;
    });
    rows.forEach(function (r) { tb.appendChild(r); });
  }
  Array.prototype.forEach.call(tbl.tHead.rows[0].cells, function (th) {
    if (!th.classList.contains('sortable')) return;
    th.addEventListener('click', function () { sortBy(th.dataset.k, th); });
  });

  // ---- per-column filters -------------------------------------------------
  // A column whose values repeat (status, priority, track) is a dropdown; a column of mostly-unique values
  // (an id, a title) is a text box. The threshold is measured from the data, not guessed per column, so the
  // same code produces sensible controls for any table.
  var head = tbl.tHead.rows[0].cells;
  var frow = document.getElementById('tfilters');
  var controls = [];

  function cellText(row, i) { return (row.cells[i].textContent || '').trim(); }

  Array.prototype.forEach.call(head, function (th, i) {
    var cell = document.createElement('th');
    var k = th.dataset.k;
    var ctl;
    if (k === 'percent') {
      ctl = document.createElement('input');
      ctl.type = 'number'; ctl.min = 0; ctl.max = 100; ctl.placeholder = '≥ %';
      ctl.className = 'fnum';
      ctl.setAttribute('aria-label', 'Minimum progress');
    } else {
      var vals = {}, n = 0;
      rows.forEach(function (r) { var t = cellText(r, i); if (t && !vals[t]) { vals[t] = 1; n++; } });
      // A dropdown only where the values actually repeat. Distinct-count alone is not enough: a title column
      // in a 12-row table has 12 distinct values and would become a useless 12-option select. Requiring the
      // distinct count to be at most half the rows keeps categories as dropdowns and free text as text.
      if (n > 1 && n <= 12 && n * 2 <= rows.length) {
        ctl = document.createElement('select');
        ctl.className = 'fsel';
        ctl.appendChild(new Option('All', ''));
        Object.keys(vals).sort().forEach(function (v) { ctl.appendChild(new Option(v, v)); });
      } else {
        ctl = document.createElement('input');
        ctl.type = 'search'; ctl.placeholder = 'filter…'; ctl.className = 'ftxt';
      }
      ctl.setAttribute('aria-label', 'Filter by ' + th.textContent.trim());
    }
    ctl.dataset.col = i; ctl.dataset.kind = k;
    ctl.addEventListener('input', filter);
    ctl.addEventListener('change', filter);
    controls.push(ctl);
    cell.appendChild(ctl);
    frow.appendChild(cell);
  });

  function matches(row) {
    var v = (q.value || '').trim().toLowerCase();
    if (v && row.textContent.toLowerCase().indexOf(v) === -1) return false;
    for (var j = 0; j < controls.length; j++) {
      var c = controls[j], want = (c.value || '').trim();
      if (!want) continue;
      var i = Number(c.dataset.col);
      if (c.dataset.kind === 'percent') {
        var p = Number(row.dataset.percent);
        if (p < 0 || p < Number(want)) return false;      // unknown (-1) never satisfies a minimum
      } else if (c.tagName === 'SELECT') {
        if (cellText(row, i) !== want) return false;      // exact, because the option came from the data
      } else if (cellText(row, i).toLowerCase().indexOf(want.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function filter() {
    var shown = 0, active = (q.value || '').trim() !== '';
    controls.forEach(function (c) { if ((c.value || '').trim()) active = true; });
    rows.forEach(function (r) {
      var hit = matches(r);
      r.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    cnt.textContent = active ? shown + ' of ' + rows.length + ' items shown' : rows.length + ' items';
  }
  q.addEventListener('input', filter);
  filter();

  var stamp = document.getElementById('stamp');
  // Near-live refresh: the build writes a stamp file; when it changes, the page reloads itself.
  var seen = null;
  function poll() {
    fetch('build-stamp.txt', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) {
        if (t === null) return;
        t = t.trim();
        if (seen === null) { seen = t; if (stamp) stamp.textContent = '· built ' + t; return; }
        if (t !== seen) location.reload();
      }).catch(function () {});
  }
  poll(); setInterval(poll, 3000);
})();
`;
