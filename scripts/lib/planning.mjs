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
 *
 * **Two dialects, detected rather than declared.** A great many real backlogs carry no identifier at all: they
 * are bullet lists whose status and priority live in the title — `- **[open] P0 — the thing is broken.**` —
 * under `## P1`-style priority headings. Against such a document the id-and-percentage reader above matches
 * nothing and reports zero items, which is *correct* and useless: the owner reads an empty page as a broken
 * tool. So the reader looks for the second shape when the first finds nothing, and says which one it used.
 * Nobody has to declare their dialect, because a reader who knew to configure a pattern would not have been
 * confused by the empty page in the first place. See `readTaggedItems`, and `NO_ID` for the identity problem
 * the second dialect creates and does not solve.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compileRule, globToRegExp, CONFIG_NAME, PLAN_DOCUMENT_GLOBS } from './config.mjs';
import { confine } from './paths.mjs';
import { maskInlineCode } from './markdown.mjs';
import { num } from './format.mjs';

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

/* ------------------------------------------------------------------ finding the plan */

/**
 * The documents in a corpus that look like a plan — pure, so it can be asked of any file list.
 *
 * The globs come from `PLAN_DOCUMENT_GLOBS`, which is a selection over the taxonomy rather than a second
 * opinion about what a plan looks like. See config.mjs.
 *
 * **The order is display order and nothing more.** It follows the glob list, then the path, so two runs
 * over the same repository print the same list in the same sequence — a list that reshuffles between runs
 * reads as a ranking that changed its mind. It is not a ranking, and nothing downstream treats it as one:
 * where there is more than one candidate, nothing is chosen. See `planSetupNotice`.
 */
export function planCandidates(paths) {
  const sorted = [...new Set(paths || [])].sort();
  const seen = new Set();
  const out = [];
  for (const glob of PLAN_DOCUMENT_GLOBS) {
    const re = globToRegExp(glob);
    for (const p of sorted) {
      if (seen.has(p) || !re.test(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * What to tell a repository that has a plan and has not configured one.
 *
 * Returns `null` when `planning.source` is set — including when it is set to a document this detection
 * would never have offered, which is a deliberate choice by whoever set it and none of this function's
 * business.
 *
 * **It refuses to choose between candidates, and says that it is refusing.** The plan is the spine of the
 * dashboard: the item table, the progress and status charts, spec-to-build coverage, the timeline and the
 * commit gate all read it. Picking the wrong document does not produce a smaller dashboard, it produces a
 * confident and wrong one — so a lone candidate is named as a setting to apply, several are named as a
 * question to answer, and neither is applied to anything by this function. Writing config is `atlas init`'s
 * job and no other command's.
 *
 * The sentences carry backticked code spans so a terminal can print them unchanged and a page can render
 * them as `<code>`. One wording, two surfaces — the alternative is the message the owner read three times
 * being right on one surface and stale on the other.
 */
export function planSetupNotice(paths, cfg = {}) {
  if (cfg?.planning?.source) return null;
  const candidates = planCandidates(paths);
  const absence = `No planning document is configured, so no item charts are drawn — rather than charting ` +
    `nothing and calling it zero.`;
  const where = `\`planning.source\` in \`${CONFIG_NAME}\``;

  if (!candidates.length) {
    return {
      candidates,
      sentences: [
        absence,
        `No document here is named like a plan either (\`BACKLOG\`, \`TASKS\`, \`TODO\`, \`HANDOFF\`, \`ROADMAP\`, ` +
        `\`PLAN-*\`, or anything under \`docs/planning/\`). Set ${where} to a task list once one exists.`,
      ],
    };
  }
  if (candidates.length === 1) {
    return {
      candidates,
      sentences: [
        absence,
        `One document here is named like a plan: \`${candidates[0]}\`. Set ${where} to it to chart it. It has ` +
        `not been set for you: writing configuration is \`atlas init\`'s job and no other command's.`,
      ],
    };
  }
  return {
    candidates,
    sentences: [
      absence,
      `${candidates.length} documents here are named like a plan: ${candidates.map((c) => `\`${c}\``).join(', ')}.`,
      `None was chosen. The plan is the spine of this dashboard, so guessing which of them it is would be worse ` +
      `than asking — set ${where} to whichever one it is, and the rest stay ordinary documents.`,
    ],
  };
}

/**
 * The second dialect's item line: a top-level bullet opening with a bolded `[status]` tag.
 *
 * Deliberately narrow. It is not enough to be a bold bullet — `- **Priority:** P1 = do next …` is a line of
 * the convention *about* the list, and every real backlog has a few. The bracketed tag immediately inside the
 * bold run is what distinguishes an item from prose, and it is the same token the author already uses to
 * carry status, so nothing new has to be written for this to work.
 */
const TAGGED_ITEM_RE = /^[-*+][ \t]+\*\*\[([^\]\n]{1,80})\][ \t]*/;
const HEADING_RE = /^#{1,6}\s/;

/**
 * The states this dialect records, and the band each one shows as.
 *
 * These replace the percentage bands entirely when the dialect is in use, because they measure a different
 * thing: `[open]`/`[done]` is a state the author asserted, not a figure. `Blocked` and `Deferred` take the
 * `unknown` tone rather than a point on the none→done ramp — both mean "not progressing", and colouring
 * *blocked* as nearly-done would be the chart telling a story the document does not.
 */
const TAGGED_BANDS = [
  { state: 'open', label: 'Not started', tone: 'none' },
  { state: 'in-progress', label: 'In progress', tone: 'mid' },
  { state: 'blocked', label: 'Blocked', tone: 'unknown' },
  { state: 'deferred', label: 'Deferred', tone: 'unknown' },
  { state: 'done', label: 'Done', tone: 'done' },
];
const UNKNOWN_BAND = { state: null, label: 'Unknown', tone: 'unknown' };

/**
 * Where an item's id comes from when the document declares none — and what that costs.
 *
 * Three candidates were considered and two rejected:
 *
 * - **The spec ids in the body.** These documents genuinely cite them (`MET-F-1`, `P0-1`), and it is tempting.
 *   But an item may cite three or none, and a citation is a pointer to a *specification*, not the item's own
 *   name — two items refining one spec would collide, and the id would change when the prose changed.
 * - **A hash of the title, or an ordinal.** Stable exactly until somebody edits the document, and a plan whose
 *   entire purpose is to be edited ("re-rank freely", "delete it here when done") edits constantly. Worse,
 *   `P1-3` *looks* like a declared identifier, so every consumer downstream would treat a number this module
 *   made up as a name the author chose. That is the fabrication to avoid, not a convenience to reach for.
 * - **The line the item starts on** — chosen. It is unique by construction, deterministic, orders the items
 *   as the document does, and unlike the other two it is *useful while it is true*: `L27` tells the reader
 *   where to look. It is prefixed and short so it does not read as a ticket number.
 *
 * The cost is stated rather than hidden, and it is not small: **an item with no stable id cannot be named by
 * a commit.** `taskCoverage`, the spec gate, the Gantt and `definedIds` in contention.mjs all bind on the id,
 * and against this dialect they bind to nothing — permanently, not until some later release. Every reader of
 * the plan is told so in `notes`, which the dashboard prints under "What this dashboard does not show".
 */
const NO_ID = (line) => `L${line}`;

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

  // Which dialect is this? Counted before anything is built, because the answer decides what "an item" even
  // is. The declared pattern wins whenever it matches anything at all: a repository that already writes
  // `**A-38 · …**` must keep parsing exactly as it did, and an id the author chose beats one this module
  // derives every time. The second dialect is reached only when the first found nothing to read.
  //
  // A pattern that was *refused* is not a pattern that found nothing — it never ran. Falling through to the
  // second dialect there would answer a question nobody asked and would contradict the note already saying
  // the configured pattern was not applied, so refusal short-circuits the whole detection.
  const classicHits = itemRe ? lines.filter((l) => { itemRe.lastIndex = 0; return itemRe.test(l); }).length : 0;
  const taggedHits = itemRe ? lines.filter((l) => TAGGED_ITEM_RE.test(l)).length : 0;
  const dialect = classicHits > 0 || taggedHits === 0 ? 'ids-and-percentages' : 'status-tags';

  const items = [];
  let track = null;
  for (let i = 0; itemRe && dialect === 'ids-and-percentages' && i < lines.length; i++) {
    const t = trackRe && trackRe.exec(lines[i]);
    if (t) { track = t[1].trim(); continue; }
    const m = itemRe.exec(lines[i]);
    if (!m) continue;
    const body = bodyAfter(lines, i, itemRe, trackRe);
    items.push({
      id: m[1], idKind: 'declared', state: null, stateNote: null,
      title: m[2].trim(), priority: m[3], criticality: m[4],
      track: track || 'Untracked',
      line: i + 1,
      summary: summaryAfter(lines, i),
      // The whole of what the plan says about this item, not the first line clamped to 220 characters. The
      // summary stays exactly as it was — the table renders it and a wider field there would break the
      // layout — so this is additive: a caller that wants the detail asks for the detail.
      description: body,
      // The documents that specify this item, read out of its own prose rather than kept in a second list.
      // A hand-maintained mapping of item to document is a mapping that goes stale, which is the failure
      // this tool exists to detect; the links an author already wrote are the answer they already gave.
      sources: sourcesIn(body, p.source),
      percent: null, estimated: false,
    });
  }
  if (dialect === 'status-tags') items.push(...readTaggedItems(lines, trackRe, p.source));

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

  // Which set of bands an item is scored against follows the dialect, because the two dialects measure
  // different things. A percentage document gets the configured completion ramp; a status document gets the
  // states it actually wrote. Mapping `[done]` to 100 and `[open]` to 0 was rejected outright: this module's
  // oldest rule is that unknown is not zero, and `[open]` says "not started", not "0% measured". Every item
  // in the second dialect keeps `percent: null`, and the chart says so instead of guessing.
  const bands = dialect === 'status-tags' ? tagBandsFor(items) : p.statusBands;
  for (const it of items) {
    it.status = dialect === 'status-tags'
      ? bandOfState(it.state, bands)
      : bandFor(it.percent, p.statusBands);
  }

  const notes = [...refused];
  const missingPct = items.filter((i) => i.percent === null);
  const est = items.filter((i) => i.estimated);
  if (dialect === 'status-tags') {
    notes.push(...taggedNotes(items, p.source));
  } else {
    if (missingPct.length) notes.push(`${missingPct.length} item(s) carry no completion figure and are charted as unknown, not as zero.`);
    if (est.length) notes.push(`${est.length} figure(s) are marked estimated in the source and are drawn hatched.`);
    // Both dialects in one document. The declared ids win — they are what a commit can name — but the choice
    // is stated rather than made quietly, because the reading that lost is a reading of real content.
    if (classicHits && taggedHits) {
      notes.push(`This document is written in **both** plan dialects: ${num(classicHits)} item heading(s) with `
        + `declared ids, and ${num(taggedHits)} bullet(s) opening with a bracketed status like \`[open]\`. `
        + `That is ambiguous, so nothing was guessed — the declared ids were read and the tagged bullets were `
        + `left unread. Split them into two documents, or give the tagged bullets ids, to have both counted.`);
    }
    // The empty page that reads as a broken tool. Zero items is a real answer and it stays a real answer —
    // but a page that shows nothing and explains nothing was read twice as the tool being broken, so the
    // read now says what it looked for and did not find.
    if (!items.length && itemRe) {
      notes.push(`No item was found in \`${p.source}\`. Neither dialect matched: no line carries an id heading `
        + `like \`**A-1 · Title** — **P1 · High**\`, and no bullet opens with a bracketed status like `
        + `\`- **[open] Title**\`. The plan is read as empty because nothing in it parsed, not because it has no work in it.`);
    }
  }

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
    dialect,
    header: lines.slice(0, 6).join('\n'),
    items, tracks, notes,
    bands,
    stats: {
      total: items.length,
      mean: meanOf(items),
      byStatus: bands.map((b) => ({ ...b, count: items.filter((i) => i.status?.label === b.label).length })),
      byPriority: [...new Set(items.map((i) => i.priority))].sort()
        .map((pr) => ({ priority: pr, count: items.filter((i) => i.priority === pr).length })),
      // `unknown` counts items that were *supposed* to carry a figure and do not — it is the "somebody has
      // not filled this in" signal, and the status chart draws it as an extra bucket beside the bands. A
      // status-tag plan has no figures at all by design, so every item would land in it: a chart totalling
      // twice the item count, with `Unknown` the tallest bar, asserting that 156 items of known state are of
      // unknown state. Nothing is hidden by the zero — every percentage renders as `—` and a note says why.
      unknown: dialect === 'status-tags' ? 0 : missingPct.length,
      estimated: est.length,
    },
  };
}

/**
 * The second dialect, read: `- **[open] P0 — Title.**` bullets under `## P1 — do next` headings.
 *
 * Two shapes of real document forced most of what is here. **Titles wrap**: 88 of the 156 items in the
 * backlog this was built against close their bold run on a later line, so reading only `lines[i]` would take
 * half of every long title and drop the rest into the body. And **the body often starts mid-line**, right
 * after the closing `**`, so the classic "everything from the next line" boundary would silently discard the
 * first sentence of the description — the sentence naming the file to change.
 */
function readTaggedItems(lines, trackRe, planSource) {
  const items = [];
  let track = null;
  for (let i = 0; i < lines.length; i++) {
    if (trackRe) {
      trackRe.lastIndex = 0;
      const t = trackRe.exec(lines[i]);
      if (t) { track = t[1].trim(); continue; }
    }
    const m = TAGGED_ITEM_RE.exec(lines[i]);
    if (!m) continue;
    const head = boldHead(lines, i, m[0].length);
    // An unterminated bold run is a malformed bullet, and it is skipped rather than guessed at: taking "the
    // rest of the paragraph" as a title would put a screenful of prose in the item table.
    if (!head) continue;

    const body = taggedBody(lines, head.endLine, head.endCol, trackRe);
    const tag = /^([A-Za-z][A-Za-z-]*)/.exec(m[1].trim());
    const trackName = track || 'Untracked';
    // Priority comes from the title when the author put it there, from the track heading when the heading is
    // one (`## P2 — soon / investigate`), and otherwise stays null. There is no default: an item nobody
    // ranked is an item nobody ranked, and inventing a `P3` for it would put a number on the page that no
    // human ever wrote — the same lie as inventing a completion figure, in a different column.
    const pri = /^(P\d)\b[ \t]*(?:[—–-]+[ \t]*)?/.exec(head.title);
    items.push({
      // Not an identifier. See NO_ID.
      id: NO_ID(i + 1), idKind: 'locator',
      state: tag ? tag[1].toLowerCase() : null,
      stateNote: m[1].trim().slice(tag ? tag[1].length : 0).replace(/^[\s,;:—–-]+/, '').trim() || null,
      title: (pri ? head.title.slice(pri[0].length) : head.title).trim(),
      priority: pri ? pri[1] : (/^(P\d)\b/.exec(trackName)?.[1] ?? null),
      // This dialect has no criticality field at all — not an empty one, none. Null, so a consumer can tell
      // "the document does not record this" from "the document records it as blank".
      criticality: null,
      track: trackName,
      line: i + 1,
      summary: summaryOf(body),
      description: body,
      sources: sourcesIn(body, planSource),
      percent: null, estimated: false,
    });
  }
  return items;
}

/**
 * The bolded head of a tagged bullet, from just after `**[tag]` to its closing `**`, across wrapped lines.
 *
 * Returns where the run ended as well as what it said, because the caller needs the tail of that same line:
 * `…and the single-instance guard.** \`Common/AppTeardown.swift\` and …` is a title and the first words of a
 * description sharing one line.
 */
function boldHead(lines, i, startCol) {
  const parts = [];
  for (let j = i; j < Math.min(i + 8, lines.length); j++) {
    const seg = j === i ? lines[j].slice(startCol) : lines[j];
    // A blank line, a heading or the next bullet all mean the run never closed. Scanning past any of them
    // would let one malformed bullet swallow the item after it.
    if (j > i && (!seg.trim() || HEADING_RE.test(seg) || TAGGED_ITEM_RE.test(seg))) return null;
    const at = seg.indexOf('**');
    if (at >= 0) {
      parts.push(seg.slice(0, at));
      return {
        title: parts.join(' ').replace(/\s+/g, ' ').trim(),
        endLine: j,
        endCol: (j === i ? startCol : 0) + at + 2,
      };
    }
    parts.push(seg);
  }
  return null;
}

/** Everything after the title, bounded by the next item or track heading, dedented to the left margin. */
function taggedBody(lines, endLine, endCol, trackRe) {
  const rest = [lines[endLine].slice(endCol)];
  const wrapped = [];
  for (let j = endLine + 1; j < lines.length; j++) {
    if (TAGGED_ITEM_RE.test(lines[j])) break;
    if (trackRe) { trackRe.lastIndex = 0; if (trackRe.test(lines[j])) break; }
    wrapped.push(lines[j]);
  }
  // Continuation lines are indented under the bullet. Left as-is, four-space-indented prose renders as a code
  // block and a two-space sub-list nests one level too deep. The *common* indent is removed, not a fixed two,
  // so relative structure inside the item — nested bullets, fenced code — survives intact.
  const indents = wrapped.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const strip = indents.length ? Math.min(...indents) : 0;
  return [...rest, ...wrapped.map((l) => (l.trim() ? l.slice(strip) : l))].join('\n').trim();
}

/** The bands actually present, in a fixed order, plus `Unknown` only if some tag was not one of them. */
function tagBandsFor(items) {
  const known = new Set(TAGGED_BANDS.map((b) => b.state));
  const stray = items.some((i) => !known.has(i.state));
  return stray ? [...TAGGED_BANDS, UNKNOWN_BAND] : [...TAGGED_BANDS];
}

function bandOfState(state, bands) {
  return bands.find((b) => b.state === state) || UNKNOWN_BAND;
}

/**
 * What the second dialect cannot do, stated on the page rather than discovered later.
 *
 * These land in `notes`, which the dashboard prints under "What this dashboard does not show". The id note is
 * the important one and it is deliberately blunt: a reader who takes `L27` for a ticket number will wonder
 * for a while why no commit ever seems to touch any item.
 *
 * **`atlas tasks` does not print `notes` at all** — `formatTasks` in `scripts/atlas.mjs` never has. On the
 * first dialect that costs a caveat; on this one it withholds the whole of what the reading cannot do, so
 * the terminal shows locator ids with nothing saying they are locators. Fixing that is one line in a file
 * this change does not own, and it is reported rather than reached for.
 */
function taggedNotes(items, source) {
  const out = [];
  const noPriority = items.filter((i) => i.priority === null).length;
  out.push(`\`${source}\` was read in the **status-tag dialect**: ${num(items.length)} bullet(s) carrying a `
    + `bracketed status such as \`[open]\` or \`[done]\`, under priority headings. It declares no item ids, `
    + `so the id-and-percentage reader found nothing in it — this is the same document, read the way it is written.`);
  out.push(`**These items cannot be named by a commit.** The document gives them no identifier, and none was `
    + `invented: the id shown is \`L\` plus the line the item starts on, which locates it in `
    + `\`${source}\` today and changes the moment anything above it is edited. Spec-to-build coverage, the `
    + `Gantt and the branch-contention check all bind on an item id, so against this plan they have nothing `
    + `to bind to and report nothing — that is a property of the document, not a failure of the read.`);
  out.push(`This plan records **status, not completion**. No item carries a percentage, so every completion `
    + `figure, the mean and every progress bar are empty by construction rather than missing — \`[open]\` `
    + `means not started, not 0% measured, and the two are not the same claim.`);
  if (noPriority) {
    out.push(`${num(noPriority)} item(s) sit under a heading that names no \`P0\`–\`P4\` priority and are left `
      + `without one. No default was applied — a priority nobody wrote is not a priority.`);
  }
  return out;
}

/** The first paragraph of a body, flattened and clamped — the same field, and the same 220, as the classic read. */
function summaryOf(body) {
  const first = String(body || '').split(/\n\s*\n/)[0] || '';
  const flat = first.replace(/\s+/g, ' ').replace(/[*`]/g, '').trim();
  return flat.slice(0, 220);
}

/**
 * Everything the plan says about one item: from the line after its heading to whatever comes next.
 *
 * The boundary is the next item *or* the next track heading, because the last item in a track is otherwise
 * unbounded and would swallow the whole of the following section — including other items' text, which then
 * appears in its source list.
 */
function bodyAfter(lines, i, itemRe, trackRe) {
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    // `exec` on a /g regex advances lastIndex between calls, so a shared instance silently skips matches.
    // These two are compiled without /g, but resetting is free and the assumption is not worth inheriting.
    if (itemRe) { itemRe.lastIndex = 0; if (itemRe.test(lines[j])) break; }
    if (trackRe) { trackRe.lastIndex = 0; if (trackRe.test(lines[j])) break; }
    out.push(lines[j]);
  }
  return out.join('\n').trim();
}

/**
 * The documents an item's own prose links to, resolved relative to the plan.
 *
 * Only repository-relative links count. An external URL is a reference, not a specification, and an anchor
 * is a link to somewhere in this same document. Code citations are deliberately excluded — an item that
 * mentions `scripts/lib/planning.mjs:69` is naming an implementation, not a document that specifies it.
 */
function sourcesIn(body, planSource) {
  if (!body) return [];
  const dir = path.posix.dirname(String(planSource || '').split(path.sep).join('/')) || '.';
  const seen = new Set();
  const out = [];
  const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  // Masked first, for the same reason the corpus scanner masks: a link pattern inside backticks is prose
  // about links. Without this, an item documenting a glob acquires a source document that does not exist.
  const masked = maskInlineCode(body);
  while ((m = re.exec(masked))) {
    const raw = m[2];
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(raw)) continue;
    const [target] = raw.split('#');
    if (!target) continue;
    const resolved = path.posix.normalize(path.posix.join(dir, target));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ path: resolved, text: m[1].replace(/[*`]/g, '').trim() });
  }
  return out;
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
