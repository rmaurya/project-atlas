/**
 * project-atlas · planning extraction
 *
 * Reads a planning document (a task list / backlog) into structured items so the dashboard can chart them.
 *
 * Everything here is **read-only and lossless in one direction**: the markdown is the source of truth, and this
 * module never writes back. If a percentage looks wrong on the dashboard, the fix is in the markdown — that is
 * the whole point, and it is why there is no "edit" path.
 *
 * The patterns are configurable because no two projects write a task list the same way. The defaults match the
 * common shape: `**ID · Title** — **P1 · Criticality**` with a completion table of `| ID | 42 |` cells.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compileRule } from './config.mjs';
import { confine } from './paths.mjs';

export const DEFAULT_PLANNING = {
  source: null,                       // e.g. "docs/TASKS.md" — null disables the dashboard's planning half
  backlog: null,                      // e.g. "docs/BACKLOG.md" — counted, not itemised
  itemPattern: '^\\*\\*([A-Za-z]+-\\d+)\\s*[·:]\\s*(.+?)\\*\\*\\s*[—–-]+\\s*\\*\\*(P\\d)\\s*[·:]\\s*([A-Za-z]+)\\*\\*',
  trackPattern: '^##\\s+(.+)$',
  // `| A-1 | 0 |` · `| S-1 | **100** |` (bold = emphasis) · `| B-2 | 30* |` (trailing single * = estimated).
  // The bold wrapper must be non-capturing and matched as a PAIR — a greedy `\*{0,2}` swallows the lone
  // estimate marker, silently reporting every estimated figure as measured.
  percentCellPattern: '\\|\\s*([A-Za-z]+-\\d+)\\s*\\|\\s*(?:\\*\\*)?(\\d{1,3})(?:\\*\\*)?(\\*)?\\s*(?=\\|)',
  statusBands: [                      // ordered; first match wins
    { max: 0, label: 'Not started', tone: 'none' },
    { max: 89, label: 'In progress', tone: 'mid' },
    { max: 99, label: 'Nearly done', tone: 'high' },
    { max: 100, label: 'Done', tone: 'done' },
  ],
};

export function readPlanning(root, cfg) {
  const p = { ...DEFAULT_PLANNING, ...(cfg.planning || {}) };
  if (!p.source) return null;

  // Confined to the repository for the same reason as the deck: whatever this reads is charted, tabled and
  // published. `path.join` would happily have read `../../creds.env` and put its lines in the item table.
  const file = confine(root, p.source, 'planning.source', cfg.__configPath);
  if (!fs.existsSync(file)) return { source: p.source, missing: true, items: [], tracks: [], notes: [`${p.source} not found`] };

  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  // All three patterns are configurable, so all three can arrive unusable. A pattern that is declined is
  // dropped and named in `notes` — which the dashboard prints under "What this dashboard does not show" —
  // rather than allowed to hang the build. See config.mjs::unsafeRegexReason.
  const refused = [];
  const compiled = {};
  for (const key of ['itemPattern', 'trackPattern', 'percentCellPattern']) {
    const { re, error } = compileRule(p[key], key === 'percentCellPattern' ? 'g' : '');
    compiled[key] = re;
    if (!re) refused.push(`planning.${key} was NOT applied — the configured pattern \`${p[key]}\` was declined because ${error}.`);
  }
  const itemRe = compiled.itemPattern;
  const trackRe = compiled.trackPattern;

  const items = [];
  let track = null;
  for (let i = 0; itemRe && i < lines.length; i++) {
    const t = trackRe && trackRe.exec(lines[i]);
    if (t) { track = t[1].trim(); continue; }
    const m = itemRe.exec(lines[i]);
    if (!m) continue;
    items.push({
      id: m[1], title: m[2].trim(), priority: m[3], criticality: m[4],
      track: track || 'Untracked',
      line: i + 1,
      summary: summaryAfter(lines, i),
      percent: null, estimated: false,
    });
  }

  // Completion percentages live in a grid table of `| ID | NN |` pairs, which is how a compact dashboard is
  // written by hand. An asterisk after the number means "estimated from documents, not read from the source" —
  // that distinction is load-bearing and must survive into the chart.
  const pctRe = compiled.percentCellPattern;
  const byId = new Map(items.map((it) => [it.id, it]));
  let pm;
  while (pctRe && (pm = pctRe.exec(raw))) {
    const it = byId.get(pm[1]);
    if (!it) continue;
    it.percent = Number(pm[2]);
    it.estimated = pm[3] === '*';
  }

  for (const it of items) {
    it.status = bandFor(it.percent, p.statusBands);
  }

  const notes = [...refused];
  const missingPct = items.filter((i) => i.percent === null);
  if (missingPct.length) notes.push(`${missingPct.length} item(s) carry no completion figure and are charted as unknown, not as zero.`);
  const est = items.filter((i) => i.estimated);
  if (est.length) notes.push(`${est.length} figure(s) are marked estimated in the source and are drawn hatched.`);

  const tracks = [...new Set(items.map((i) => i.track))].map((name) => {
    const own = items.filter((i) => i.track === name);
    const known = own.filter((i) => i.percent !== null);
    return {
      name,
      count: own.length,
      mean: known.length ? Math.round(known.reduce((n, i) => n + i.percent, 0) / known.length) : null,
      known: known.length,
    };
  });

  return {
    source: p.source,
    missing: false,
    header: lines.slice(0, 6).join('\n'),
    items, tracks, notes,
    bands: p.statusBands,
    stats: {
      total: items.length,
      mean: meanOf(items),
      byStatus: p.statusBands.map((b) => ({ ...b, count: items.filter((i) => i.status?.label === b.label).length })),
      byPriority: [...new Set(items.map((i) => i.priority))].sort()
        .map((pr) => ({ priority: pr, count: items.filter((i) => i.priority === pr).length })),
      unknown: missingPct.length,
      estimated: est.length,
    },
  };
}

function summaryAfter(lines, i) {
  for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
    const t = lines[j].trim();
    if (!t) continue;
    const m = /^\*(.+)\*$/.exec(t);
    if (m) return m[1].replace(/\*/g, '').trim();
    return t.replace(/[*`]/g, '').slice(0, 220);
  }
  return '';
}

function bandFor(pct, bands) {
  if (pct === null || pct === undefined) return { label: 'Unknown', tone: 'unknown' };
  for (const b of bands) if (pct <= b.max) return b;
  return bands[bands.length - 1];
}

function meanOf(items) {
  const known = items.filter((i) => i.percent !== null);
  if (!known.length) return null;
  return Math.round((known.reduce((n, i) => n + i.percent, 0) / known.length) * 10) / 10;
}
