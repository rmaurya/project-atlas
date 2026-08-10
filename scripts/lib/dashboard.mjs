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

import { designRecord, undesigned, citationHealth } from './design.mjs';
import { escapeHtml, escapeAttr } from './markdown.mjs';
import { SIGNALS } from './health.mjs';
import { taskCoverage } from './contrib.mjs';
import { PANELS } from './views.mjs';
import { readChanges } from './changes.mjs';
import { flatName } from './render-shared.mjs';

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
 * A tone names a CSS class, and a tone reaches here from `planning.statusBands[].tone` in the configuration
 * file — which is to say, from outside. It was interpolated straight into a quoted `class` attribute, and
 * `{"tone":"x\" onmouseover=\"alert(1)"}` produced exactly the element you would expect.
 *
 * Allow-listed rather than escaped, because there is a fixed set of tones and anything else is a
 * configuration error, not a value to render. Config validation rejects an unknown tone outright; this is the
 * second lock, for the paths that build a tone rather than read one.
 */
const TONES = new Set(['none', 'mid', 'high', 'done', 'unknown']);
const toneClass = (t) => (TONES.has(t) ? t : 'unknown');

/**
 * One page per view. The view supplies an ordered list of panel ids; every panel is written once and
 * rendered here. A panel that has nothing to show returns null and is **omitted with a note** rather than
 * rendered as an empty box — an empty box reads as "nothing to report", which is a different claim.
 */
export function viewPage(view, ctx, shell) {
  const { index, health, plan, cfg, contrib, nav } = ctx;

  const built = view.panels.map((id) => ({ id, html: panel(id, { ...ctx, view }) }));
  const rendered = built.filter((b) => b.html);
  const omitted = built.filter((b) => !b.html).map((b) => b.id);

  // The item table is wide; on a view that shows it, it takes the side column and everything else the main.
  const showsItems = rendered.some((b) => b.id === 'items');
  // **Full-width panels lead.**
  //
  // `column-span:all` splits a multi-column flow into fragments: everything before the spanning element is
  // balanced on its own, everything after starts a new run. On the Quality view a single card came before
  // the tile strip, so that fragment had one item to balance across three columns — it took column one and
  // left two-thirds of the row blank, which is the hole that masonry was meant to remove.
  //
  // Hoisting every spanning panel to the top leaves one contiguous run of cards to pack. It also reads
  // better: a summary strip belongs above the detail, which is the order the Overview page already used.
  const spans = (b) => /class="(tiles|sect)/.test(b.html) || /^<p class="cap sect/.test(b.html.trim());
  const body0 = rendered.filter((b) => b.id !== 'items');
  const main = [...body0.filter(spans), ...body0.filter((b) => !spans(b))].map((b) => b.html).join('\n');
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
function panel(id, { index, health, plan, cfg, contrib, view, nameFor, repo }) {
  const hasPlan = plan && !plan.missing;
  const hasContrib = contrib && contrib.available;
  // Falls back to the plain mapping when a caller has not supplied the collision-resolved map — the two agree
  // for every path that does not collide, which is all of them in the common case.
  const pageOf = nameFor || flatName;

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
    case 'changes': return changesPanel(cfg, index, pageOf);
    case 'documents': return documentsPanel(index, health, view, pageOf);
    case 'recent': return hasContrib ? recentPanel(contrib, plan) : null;
    case 'testcases': return testcasesPanel(repo);
    case 'designRecord': return designRecordPanel(index);
    case 'undesigned': return undesignedPanel(repo, index);
    case 'citations': return citationsPanel(index, pageOf);
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

  // "Every signal reports clean" is a claim about signals that RAN. A signal whose configured pattern was
  // declined has a count of zero and has not reported anything at all — see health.mjs::runHealth.
  const skipped = health.unevaluated || [];
  if (!rows.length) {
    return `<figure class="card"><figcaption><h2>Documentation health</h2></figcaption>
      <p class="empty">${skipped.length
        ? `<span class="dot" style="background:${st('warning')}"></span> No findings from the signals that ran — but ${escapeHtml(skipped.join(', '))} could not be evaluated. See what this dashboard does not show.`
        : `<span class="dot" style="background:${st('good')}"></span> No findings. Every signal reports clean.`}</p></figure>`;
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
      <span class="bt"><span class="bf t-${toneClass(r.tone)}${r.estimated ? ' est' : ''}" style="width:${Math.max(2, (r.value / (r.max || 1)) * 100)}%"></span></span>
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
  <div class="tbar">
    <input id="tq" type="search" placeholder="Filter every column…" autocomplete="off">
    <label class="tdone"><input type="checkbox" id="tdone" checked> Show completed
      <span class="count">${plan.items.filter((i) => (i.percent ?? 0) >= 100).length}</span></label>
  </div>
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
            <span class="mini"><span class="mf t-${toneClass(i.status.tone)}${i.estimated ? ' est' : ''}" style="width:${i.percent === null ? 0 : i.percent}%"></span></span>
            <span class="pct">${i.percent === null ? '—' : i.percent + '%'}${i.estimated ? '<abbr title="estimated in the source, not measured against the code">*</abbr>' : ''}</span>
          </td>
          <td><span class="pill t-${toneClass(i.status.tone)}">${escapeHtml(i.status.label)}</span></td>
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

/**
 * The documents this role owns. A metrics page tells a reader something is wrong; this tells them which file
 * to open. Which clusters a view claims is declared on the view, so an architect gets HLD, LLD and the
 * specifications while QC gets the procedures and the manuals — from the same taxonomy, not a second list.
 */
/**
 * The developer panel. A changed file is uninteresting alone; a changed file that an old document cites is
 * the finding, and the corpus index already knows which documents those are.
 */
function changesPanel(cfg, index, nameFor) {
  let k;
  try {
    k = readChanges(cfg.__root || process.cwd(), cfg, index);
  } catch (err) {
    // `changes.mjs` re-raises deliberately: its docblock says a git command that silently returns nothing
    // looks exactly like a repository with no changes, which is the failure this project cares about most.
    // Catching it and returning null threw that away — the panel then appeared under "Not shown on this page",
    // whose stated meaning is "omitted because there is no data behind them". The error became "nothing
    // changed", one level of indirection later. It is rendered instead: the build still finishes, and the page
    // says which check did not run.
    return `<figure class="card muted"><figcaption><h2>Changes</h2></figcaption>
      <p class="empty"><span class="dot" style="background:${st('warning')}"></span>
      This panel could not be built — <code>${escapeHtml(String(err.message || err))}</code>.
      That is not the same as "nothing changed": no comparison was made, so no document is listed here as safe.</p></figure>`;
  }
  if (!k.available) return null;
  const total = k.staged.length + k.unstaged.length + k.committed.length;
  if (!total) return `<figure class="card muted"><figcaption><h2>Changes</h2></figcaption>
    <p class="empty">Nothing changed on <code>${escapeHtml(k.branch)}</code>.</p></figure>`;

  return `
<section class="card">
  <h2>Changes on ${escapeHtml(k.branch)} <span class="count">${total}</span></h2>
  <p class="cap">${k.unstaged.length} uncommitted · ${k.staged.length} staged · ${k.committed.length} committed
  across ${k.commits.length} commit(s), compared against ${k.scope === 'branch' ? `the merge-base with ${escapeHtml(k.main)}` : 'the last two commits'}.</p>
  ${k.docsAtRisk.length ? `
  <h3>Documents citing what changed</h3>
  <p class="cap">Oldest first. These are not necessarily wrong — they are the ones whose ground just moved.</p>
  <ul class="doclist">
    ${k.docsAtRisk.slice(0, 10).map((d) => `<li>
      <a href="pages/${escapeAttr(nameFor(d.doc))}">${escapeHtml(d.title || d.doc)}</a>
      <span class="dm">${d.date || 'undated'} · cites ${escapeHtml(d.cites.slice(0, 3).join(', '))}${d.cites.length > 3 ? ` and ${d.cites.length - 3} more` : ''}</span>
    </li>`).join('')}
  </ul>` : '<p class="cap">No document cites any of the changed files.</p>'}
</section>`;
}

function documentsPanel(index, health, view, nameFor) {
  const want = view.clusters || [];
  if (!want.length) return null;
  const clusters = index.clusters.filter((c) => want.includes(c.id));
  if (!clusters.length) {
    return `<figure class="card muted"><figcaption><h2>Documents</h2></figcaption>
      <p class="empty">This view claims the cluster(s) <code>${escapeHtml(want.join(', '))}</code>, and none of
      them exists in this repository's taxonomy. Either the documents are classified elsewhere or the rules
      need one more entry — see <code>atlas config</code>.</p></figure>`;
  }

  const flagsFor = (p) => health.findings.filter((f) => f.doc === p && !f.suppressed);

  return clusters.map((c) => {
    const docs = c.documents.map((p) => index.documents.find((d) => d.path === p)).filter(Boolean)
      .sort((a, b) => (b.git?.date || '').localeCompare(a.git?.date || ''));
    return `
<section class="card">
  <h2>${escapeHtml(c.title)} <span class="count">${docs.length}</span></h2>
  ${c.blurb ? `<p class="cap">${escapeHtml(c.blurb)}</p>` : ''}
  <ul class="doclist">
    ${docs.map((d) => {
      const flags = flagsFor(d.path);
      return `<li>
        <a href="pages/${escapeAttr(nameFor(d.path))}">${escapeHtml(d.title || d.path)}</a>
        <span class="dm">${d.git ? d.git.date : 'undated'} · ${d.lines.toLocaleString()} lines${d.status ? ` · ${escapeHtml(d.status)}` : ''}</span>
        ${flags.length ? `<span class="dflags">${flags.map((f) =>
          `<span class="sig ${f.blocking ? 'block' : 'adv'}" title="${escapeHtml(f.detail || '')}">${f.signal}</span>`).join('')}</span>` : ''}
        <code class="dp">${escapeHtml(d.path)}</code>
      </li>`;
    }).join('')}
  </ul>
</section>`;
  }).join('\n');
}

/** What has just landed. Newest first, because "what changed" is almost always the question. */
function recentPanel(contrib, plan) {
  const recent = contrib.commits.slice(-15).reverse();
  if (!recent.length) return null;
  // An id with no title is a reference the reader has to go look up. Resolve it where the plan knows it.
  const titles = new Map((plan && !plan.missing ? plan.items : []).map((i) => [i.id, i.title]));
  return `
<section class="card">
  <h2>Recently pushed <span class="count">${recent.length}</span></h2>
  <p class="cap">The last ${recent.length} of ${contrib.totals.commits} commits. Subjects are shown as written —
  where a subject names an item id, that item is the one to check.</p>
  <ul class="doclist">
    ${recent.map((c) => `<li>
      <span class="rsub">${escapeHtml(c.subject)}</span>
      <span class="dm">${c.date.slice(0, 10)} · <code>${escapeHtml(c.hash)}</code> · +${c.added} / −${c.removed}${c.agents.length ? ` · ${escapeHtml(c.agents[0])}` : ''}</span>
      ${c.taskRefs.length ? `<span class="reftags">${c.taskRefs.map((r) => {
        const t = titles.get(r);
        return `<span class="ref" title="${escapeHtml(t || 'not found in the planning document')}">${escapeHtml(r)}${t ? ` · ${escapeHtml(t)}` : ''}</span>`;
      }).join('')}</span>` : ''}
    </li>`).join('')}
  </ul>
</section>`;
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
/* Prose, not a flex row.
 *
 * display:flex here made every inline fragment a flex item, so a sentence containing an inline code span was
 * split into three boxes laid side by side, and the paragraph rendered as narrow vertical strips of shredded
 * text. Six of the seven .empty messages are ordinary sentences with inline code; only one opens with a
 * status dot, and an inline-block dot aligns on its own without turning the sentence into a layout. */
.tbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:0 0 10px; }
.tbar #tq { flex:1 1 220px; margin:0; }
.tdone { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); white-space:nowrap; cursor:pointer; }
.empty { color:var(--muted); font-size:14px; margin:0; }
.empty > .dot { margin-right:8px; }
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
/* Masonry, not a grid.
 *
 * Grid lays out uniform row tracks, so one tall card — "What this dashboard does not show" runs to a dozen
 * lines — reserves that height for every short card beside it. The architecture view had a 600px hole under
 * three panels because one neighbour was long. align-items:start stops the cards stretching; it cannot stop
 * the row itself from being tall.
 *
 * CSS columns pack each card directly under the previous one in its column, which is the Pinterest
 * arrangement. The cost is reading order: content flows down a column before moving right, so this is only
 * applied where the panels are peers with no narrative order between them. column-span:all keeps the tile
 * strip and the section blurb full width. */
.dash-single { display:grid; gap:16px; }
@media (min-width:1180px) {
  .dash-single { display:block; columns:360px 3; column-gap:16px; }
  .dash-single > * { break-inside:avoid; page-break-inside:avoid; margin:0 0 16px; width:100%; }
  .dash-single > .tiles, .dash-single > .sect { column-span:all; }
}
.mini-table { border-collapse:collapse; width:100%; font-size:13.5px; min-width:520px; }
/* Belt and braces: every min-width table is inside a .table-wrap that scrolls, and the page body must never
 * scroll sideways regardless. A wide table that escapes its wrapper takes the whole layout with it. */
.card, .tile, figure { min-width:0; max-width:100%; }
.table-wrap { max-width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
.mini-table th,.mini-table td { border-bottom:1px solid var(--line); padding:7px 10px; text-align:left; }
.mini-table th.num,.mini-table td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.mini-table tbody tr:hover { background:var(--code-bg); }
.doclist { list-style:none; margin:10px 0 0; padding:0; display:grid; gap:8px; }
.doclist li { padding:9px 12px; background:var(--bg); border:1px solid var(--line); border-radius:8px; font-size:14px; }
.doclist a { font-weight:600; }
.doclist .dm { display:block; color:var(--muted); font-size:12.5px; margin-top:2px; }
.doclist .dflags { display:inline-flex; gap:4px; margin-top:5px; }
.doclist .dp { display:block; color:var(--muted); font-size:11.5px; margin-top:4px; opacity:.8; }
.rsub { font-weight:600; }
.reftags { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
.ref { font-size:11.5px; padding:2px 8px; border-radius:999px; background:var(--code-bg); color:var(--muted); }
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

  // Completed work is in the table and always was, mixed in and indistinguishable from a filter that had
  // hidden it. A control says which: on by default, because "what landed" is the first thing anyone asks of
  // a plan, and hiding it silently would answer that question wrongly.
  var doneBox = document.getElementById('tdone');
  var isDone = function (r) {
    var cell = r.querySelector('td:nth-child(3)');
    return !!cell && /done/i.test(cell.textContent) && !/nearly/i.test(cell.textContent);
  };

  function filter() {
    var shown = 0, active = (q.value || '').trim() !== '';
    var hideDone = doneBox && !doneBox.checked;
    if (hideDone) active = true;
    controls.forEach(function (c) { if ((c.value || '').trim()) active = true; });
    rows.forEach(function (r) {
      var hit = matches(r) && !(hideDone && isDone(r));
      r.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    cnt.textContent = active ? shown + ' of ' + rows.length + ' items shown' : rows.length + ' items';
  }
  q.addEventListener('input', filter);
  if (doneBox) doneBox.addEventListener('change', filter);
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


/* ------------------------------------------------------------------ quality: the test inventory */

/**
 * What is covered, not how often it broke.
 *
 * The Quality view reported a rework rate and never said what the suite actually tests. A rate is a symptom;
 * this is the thing a QC reader came for. Grouped by the suite's own section headings where it has them,
 * because that grouping is the author's and is better than any this could invent.
 */
function testcasesPanel(repo) {
  const k = repo?.tests;
  if (!k) return null;
  if (!k.cases.length) {
    return `<section class="card"><h2>Test cases</h2>
      <p class="empty">No test cases were found in ${k.candidates} candidate file(s). That is a finding, not a
      blank — a panel that disappears when the answer is "none" hides the answer worth seeing most.</p></section>`;
  }
  const pct = Math.round((k.regressions / k.cases.length) * 100);
  return `<section class="card">
  <h2>Test cases <span class="count">${k.cases.length}</span></h2>
  <p class="cap">Read from source, never from a run — this is what is written, not what passed.
  <strong>${k.regressions}</strong> of them (${pct}%) are named for a defect rather than a capability, which
  is the share that exists because something broke. That is inferred from wording, not recorded anywhere.</p>
  <div class="bars">
    ${k.sections.slice(0, 12).map((sec) => `
    <div class="bar">
      <span class="bl">${escapeHtml(sec.title)}</span>
      <span class="bt"><span class="bf t-high" style="width:${Math.max(2, Math.round((sec.count / k.sections[0].count) * 100))}%"></span></span>
      <span class="bv">${sec.count}<span class="bh">${sec.regressions} regression(s)</span></span>
    </div>`).join('')}
  </div>
  ${k.sections.length > 12 ? `<p class="hint">${k.sections.length - 12} more group(s) not shown.</p>` : ''}
</section>`;
}

/* ------------------------------------------------------------------ architecture: the design record */

/** An absence is the most valuable thing on this panel, and a list of what exists cannot show one. */
function designRecordPanel(index) {
  const record = designRecord(index.documents);
  return `<section class="card">
  <h2>Design record</h2>
  <p class="cap">What a design record is normally expected to carry. <strong>A missing row is the finding</strong> —
  a list of the documents that exist cannot show you the one that does not.</p>
  <div class="table-wrap"><table class="mini-table">
    <thead><tr><th>Artifact</th><th>Present</th><th>Document(s)</th></tr></thead>
    <tbody>${record.map((r) => `
      <tr><td>${escapeHtml(r.label)}</td>
        <td class="${r.present ? 'ok' : 'bad'}">${r.present ? 'yes' : 'absent'}</td>
        <td class="cap">${r.documents.length ? escapeHtml(r.documents.slice(0, 3).join(', ')) : '—'}</td></tr>`).join('')}
    </tbody>
  </table></div>
</section>`;
}

/** The inversion: what is built and undescribed. The only panel here that finds an unknown unknown. */
function undesignedPanel(repo, index) {
  if (!repo?.code?.length) return null;
  const design = index.documents.filter((d) => d.cluster === 'engineering' || d.cluster === 'specs' ||
    /HLD|LLD|ARCHITECTURE|DATA[-_]?FLOW/i.test(d.path));
  const gaps = undesigned(repo.code, design);
  if (!gaps.length) return null;
  const bare = gaps.filter((g) => g.citations === 0);
  return `<section class="card">
  <h2>Undesigned areas <span class="count">${bare.length}</span></h2>
  <p class="cap">Code areas no design document cites. This is the inverse of the list above and the only one
  that finds something you were not already looking for. <strong>Coverage, not quality</strong> — a documented
  area may be described badly, and an area of three utility files may need no design at all.</p>
  <div class="bars">
    ${gaps.slice(0, 10).map((g) => `
    <div class="bar">
      <span class="bl">${escapeHtml(g.area)}</span>
      <span class="bt"><span class="bf ${g.citations ? 't-mid' : 't-none'}" style="width:${g.citations ? Math.min(100, g.citations * 10) : 100}%"></span></span>
      <span class="bv">${g.citations}<span class="bh">${g.files} file(s)${g.by.length ? ` · cited by ${escapeHtml(g.by.slice(0, 2).join(', '))}` : ' · cited by nothing'}</span></span>
    </div>`).join('')}
  </div>
</section>`;
}

/** A design document earns its place by citing code. One whose citations no longer resolve describes a program that is gone. */
function citationsPanel(index, pageOf) {
  const design = index.documents.filter((d) => d.cluster === 'engineering' || d.cluster === 'specs' ||
    /HLD|LLD|ARCHITECTURE|DATA[-_]?FLOW/i.test(d.path));
  if (!design.length) return null;
  const rows = citationHealth(design);
  return `<section class="card">
  <h2>Design documents against the code <span class="count">${rows.length}</span></h2>
  <p class="cap">A design document earns its place by citing code. One that cites nothing cannot go stale
  against anything; one whose citations no longer resolve is describing a program that has moved on.
  <strong>Not checked</strong> is kept apart from <strong>broken</strong> — they are different claims.</p>
  <div class="table-wrap"><table class="mini-table">
    <thead><tr><th>Document</th><th class="num">Citations</th><th class="num">Resolve</th><th class="num">Broken</th><th class="num">Not checked</th><th>Last touched</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr><td><a href="pages/${escapeAttr(pageOf(r.path))}">${escapeHtml(r.title)}</a></td>
        <td class="num">${r.total || '<span class="cap">none</span>'}</td>
        <td class="num ok">${r.resolved || ''}</td>
        <td class="num ${r.broken ? 'bad' : ''}">${r.broken || ''}</td>
        <td class="num cap">${r.unchecked || ''}</td>
        <td class="cap">${r.date || 'unknown'}</td></tr>`).join('')}
    </tbody>
  </table></div>
</section>`;
}
