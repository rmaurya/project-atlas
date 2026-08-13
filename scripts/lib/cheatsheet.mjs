/**
 * project-atlas · the command cheatsheet, derived from the live command surface (A-52)
 *
 * **Nothing on this card is typed out here.** A cheatsheet of forty-five commands written by hand is the same
 * defect this repository has already filed three times — a count stated in prose beside a list that grows —
 * with a picture wrapped around it, and a picture is the worst place for it because nobody diffs an image.
 * So every string that names a command, every grouping and every gloss is read out of the three places that
 * already are the surface:
 *
 *   1. `scripts/atlas.mjs` · `usage()`, for the command lines, their arguments, their sub-flags, the global
 *      flags, the aliases and the tagline — sliced out of the source rather than out of `atlas help`'s
 *      stdout, so the generator needs no subprocess and cannot be fooled by a stale install on `PATH`.
 *   2. `scripts/atlas.mjs` · the `cmd === '…'` dispatch table, for what the CLI *actually answers to*. This is
 *      the same derivation `tests/run.mjs` has used since A-35, deliberately: two definitions of "a command"
 *      is the drift in miniature.
 *   3. `skills/` and `skills/help/SKILL.md`, for the slash commands and for the grouping. The directory is the
 *      authority on which slash commands exist; the map in `help` is the authority on which *intent* each one
 *      belongs to and what its one-line gloss is, because a grouping by intent is a judgement and this
 *      repository already made it once, in prose, where a person maintains it.
 *
 * A command that lands in any of those three and not on the card fails `tests/run.mjs`, and so does a card
 * whose bytes are not what regenerating would write. That is the whole reason this file exists rather than an
 * `.svg` somebody drew.
 *
 * **Two backends, one layout.** The SVG (screen, embedded in the README) and the PDF (a download, A4) are the
 * same laid-out page rendered twice, so they cannot disagree about content. They differ in two ways only, both
 * deliberate and both parameters: geometry (the SVG is sized for the width GitHub renders a README image at;
 * the PDF is A4 landscape at points) and palette (the SVG is a dark card; the PDF is print ink on white).
 *
 * **Determinism.** No dates, no absolute paths, no version string, no floating-point that is not rounded on
 * the way out. Running the generator twice with no source change writes byte-identical files — the same rule
 * the rest of the build holds to. The version is left off the card on purpose: stamping it would turn every
 * release into a stale asset and make a release bump fail the staleness test for no reason anyone could act
 * on. The card changes when the command surface changes, and at no other time.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_NAME } from './config.mjs';

/* ------------------------------------------------------------------ reading the surface */

/**
 * The body of the `usage()` template literal, with the source's escapes and interpolations resolved.
 *
 * Slicing the template rather than running `atlas help` keeps this hermetic: no subprocess, no dependency on
 * which `atlas` is first on `PATH`, and the test can regenerate from a checkout that was never installed.
 * The cost is that `${…}` interpolations arrive unresolved, so every one of them has to be known here — and
 * an unknown one throws instead of printing `${SOMETHING}` in 8pt on a card nobody will re-read.
 */
export function usageSource(root) {
  const src = fs.readFileSync(path.join(root, 'scripts', 'atlas.mjs'), 'utf8');
  const at = src.indexOf('function usage()');
  if (at === -1) throw new Error('scripts/atlas.mjs has no usage() — the cheatsheet has nothing to derive from');
  const open = src.indexOf('console.log(`', at);
  const close = src.indexOf('`);', open);
  if (open === -1 || close === -1) throw new Error('usage() no longer prints one template literal — the slice in cheatsheet.mjs needs rewriting');
  const body = src.slice(open + 'console.log(`'.length, close)
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\')
    .replace(/\$\{CONFIG_NAME\}/g, CONFIG_NAME);
  const left = body.match(/\$\{[^}]*\}/);
  if (left) throw new Error(`usage() interpolates ${left[0]}, which cheatsheet.mjs does not know how to resolve`);
  return body;
}

/**
 * Every command name the CLI dispatches on, read out of its own source — the A-35 derivation, unchanged.
 * Kept identical to the one in `tests/run.mjs` on purpose: if the two ever disagree about what a command is,
 * the card and the test that guards it are checking different things.
 */
export function dispatchedCommands(root) {
  const src = fs.readFileSync(path.join(root, 'scripts', 'atlas.mjs'), 'utf8');
  return [...new Set([...src.matchAll(/cmd\s*===\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

/** Every slash command, which is every directory under `skills/` carrying a `SKILL.md`. */
export function slashCommands(root) {
  const dir = path.join(root, 'skills');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/** A help line is `<command and args>`, two or more spaces, `<description>`. Nothing in it has a double space. */
const cells = (line) => line.trim().split(/\s{2,}/);

/**
 * `usage()` as structure: commands with their args, sub-flags and descriptions, plus the aliases, the global
 * flags, the tagline and the closing line.
 *
 * The parse is column-free — it splits on runs of two or more spaces — because the descriptions in `usage()`
 * are aligned to column 29 except for the two lines whose command is too long to fit, and a parser that
 * believes in the column silently loses those two.
 */
export function parseUsage(text) {
  const out = { tagline: '', commands: [], aliases: [], flags: [], footer: '' };
  let section = 'commands';
  let last = null;   // where a continuation line appends
  let cmd = null;    // the command a sub-flag hangs off

  const lines = text.split('\n');
  out.tagline = lines[0].trim();

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      if (line.trim() === 'Aliases') { section = 'aliases'; last = null; continue; }
      if (line.trim() === 'Flags') { section = 'flags'; last = null; continue; }
      out.footer = line.trim();
      section = 'done';
      continue;
    }
    const c = cells(line);
    const desc = c.length > 1 ? c[c.length - 1] : '';
    const head = c.slice(0, -1).join(' ');

    if (section === 'commands' && /^ {2}atlas /.test(line)) {
      const words = head.split(' ');
      cmd = { name: words[1], args: words.slice(2).join(' '), desc, flags: [] };
      out.commands.push(cmd);
      last = cmd;
    } else if (section === 'commands' && /^ {4}--/.test(line)) {
      if (!cmd) throw new Error(`a sub-flag before any command in usage(): ${line}`);
      const f = { flag: head, desc };
      cmd.flags.push(f);
      last = f;
    } else if (section === 'aliases' && /^ {2}atlas /.test(line)) {
      out.aliases.push({ from: head.split(' ')[1], to: desc.replace(/^=\s*/, '') });
      last = null;
    } else if (section === 'flags' && /^ {2}--/.test(line)) {
      out.flags.push({ flag: head, desc });
      last = out.flags[out.flags.length - 1];
    } else if (last && c.length === 1) {
      last.desc = `${last.desc} ${c[0]}`;   // a wrapped description, folded back onto one string
    }
  }
  if (!out.commands.length) throw new Error('parsed no commands out of usage() — the format changed');
  return out;
}

/** Markdown emphasis and code ticks, off. The card has one typeface per role and no inline styling. */
const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();

/**
 * The intent map out of `skills/help/SKILL.md` — the groups, in the order that file puts them in, and the
 * one-line gloss it gives each slash command.
 *
 * A group is a paragraph whose first line is nothing but a bold title; entries inside it are separated by
 * ` · `, and each entry opens with one or more backticked `/atlas:…` references. The two paragraphs in that
 * section that open with bold *followed by prose* — the "not slash commands" note and the "this map is
 * hand-written" note — are not groups and are skipped by exactly that rule.
 */
export function parseMap(root) {
  const text = fs.readFileSync(path.join(root, 'skills', 'help', 'SKILL.md'), 'utf8');
  const at = text.indexOf('## The map');
  if (at === -1) throw new Error('skills/help/SKILL.md has no "## The map" — the grouping has nowhere to come from');
  const end = text.indexOf('\n## ', at + 1);
  const body = text.slice(at + '## The map'.length, end === -1 ? undefined : end);

  const groups = [];
  for (const para of body.split(/\n\s*\n/)) {
    const rows = para.split('\n').filter((l) => l.trim());
    if (rows.length < 2) continue;
    const title = rows[0].trim().match(/^\*\*(.+?)\*\*$/);
    if (!title) continue;
    const entries = [];
    for (const chunk of rows.slice(1).join(' ').split(' · ')) {
      const names = [];
      let rest = chunk.trim();
      let args = '';
      for (;;) {
        const m = rest.match(/^`\/atlas:([a-z-]+)(\s+<[a-z]+>)?`\s*(and\s+)?/);
        if (!m) break;
        names.push(m[1]);
        if (m[2]) args = m[2].trim();
        rest = rest.slice(m[0].length);
      }
      if (!names.length) continue;
      const gloss = plain(rest.replace(/^[—–-]\s*/, ''));
      // `shared` is the two-commands-one-clause case — "`/atlas:sessions` and `/atlas:tokens` — both read
      // local session transcripts…". That sentence is true of each and describes neither, so a row built from
      // it falls back to the command's own line in `usage()` and keeps the shared warning for the group.
      for (const name of names) entries.push({ name, args, gloss, shared: names.length > 1 });
    }
    if (entries.length) groups.push({ title: title[1], entries });
  }
  if (!groups.length) throw new Error('parsed no groups out of the map in skills/help/SKILL.md');
  return groups;
}

/**
 * A gloss stops at its first sentence break. The map is prose, and prose carries sentences that belong to the
 * group rather than to the entry — "All six are strictly read-only" is attached to the last `git-*` entry by
 * the ` · ` split and is not a description of `git-diff`.
 */
const firstSentence = (s) => {
  const m = s.match(/\.\s+(?=[A-Z“])/);
  return m ? s.slice(0, m.index) : s;
};

/**
 * The card's content model: groups of rows, each row a command with the surfaces it exists on.
 *
 * Rows are keyed on the bare name, because the two surfaces are `atlas <name>` and `/atlas:<name>` and
 * printing both in full on every one of forty-five rows spends a third of the page restating a prefix. The
 * masthead states the two forms once and the marker on a row says which of them that name is missing — which
 * is the information, since thirty of the forty-five have both.
 */
export function cheatsheet(root) {
  const usage = parseUsage(usageSource(root));
  const dispatched = new Set(dispatchedCommands(root));
  const skills = new Set(slashCommands(root));
  const map = parseMap(root);
  const aliased = new Set(usage.aliases.map((a) => a.from));
  const byName = new Map(usage.commands.map((c) => [c.name, c]));
  const order = new Map(usage.commands.map((c, i) => [c.name, i]));

  const seen = new Set();
  const groups = [];

  const row = (name, mapEntry) => {
    const cmd = byName.get(name);
    const args = cmd ? cmd.args : (mapEntry ? mapEntry.args : '');
    const fromMap = mapEntry && mapEntry.gloss && !(mapEntry.shared && cmd) ? mapEntry.gloss : '';
    const gloss = firstSentence(fromMap || (cmd ? plain(cmd.desc) : (mapEntry ? mapEntry.gloss : '')));
    seen.add(name);
    return {
      name,
      args,
      gloss,
      cli: dispatched.has(name),
      slash: skills.has(name),
      flags: cmd ? cmd.flags.map((f) => ({ flag: f.flag, desc: firstSentence(plain(f.desc)) })) : [],
    };
  };

  for (const g of map) {
    groups.push({ title: g.title, rows: g.entries.map((e) => row(e.name, e)) });
  }

  // Everything the CLI answers to that the intent map never mentions: `init`, `scan`, `contention`, `serve`,
  // `watch`, `all` and the commit gate. They are real commands and leaving them off would be the same hole
  // A-35 closed in `usage()` itself. Aliases are not rows — they get a line in the footer, for the reason the
  // alias block in `usage()` gives: two rows describing one implementation is where the second copy goes stale.
  const rest = [...dispatched]
    .filter((n) => !seen.has(n) && !aliased.has(n))
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
  if (rest.length) groups.push({ title: 'Command line only', rows: rest.map((n) => row(n, null)) });

  // The mirror case, and normally empty: a slash command the map forgot. `tests/run.mjs` already fails on that
  // gap, but the card is generated from the directory and must show it rather than quietly drop it.
  const orphanSlash = [...skills].filter((n) => !seen.has(n)).sort();
  if (orphanSlash.length) groups.push({ title: 'Claude Code only', rows: orphanSlash.map((n) => row(n, null)) });

  return {
    title: 'project-atlas',
    kicker: 'command cheatsheet',
    tagline: usage.tagline.replace(/^project-atlas\s+[—–-]\s+/, ''),
    groups,
    aliases: usage.aliases,
    flags: usage.flags,
    footer: usage.footer,
  };
}

/* ------------------------------------------------------------------ measuring */

const W_HELV = ('278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,'
  + '556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,'
  + '722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,'
  + '222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584').split(',').map(Number);

const W_BOLD = ('278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,'
  + '556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,'
  + '722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,'
  + '278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584').split(',').map(Number);

/**
 * The characters above ASCII that this repository's own help text uses, with the WinAnsi byte a PDF wants and
 * the advance width the two Helvetica faces give them. Anything outside this table throws on the way into the
 * PDF rather than being dropped, because a silently missing em dash is a sentence that changed meaning.
 */
const EXTRA = {
  '–': { byte: 0o226, helv: 556, bold: 556 },   // en dash
  '—': { byte: 0o227, helv: 1000, bold: 1000 }, // em dash
  '‘': { byte: 0o221, helv: 222, bold: 278 },
  '’': { byte: 0o222, helv: 222, bold: 278 },
  '“': { byte: 0o223, helv: 333, bold: 500 },
  '”': { byte: 0o224, helv: 333, bold: 500 },
  '•': { byte: 0o225, helv: 350, bold: 350 },   // bullet
  '…': { byte: 0o205, helv: 1000, bold: 1000 }, // ellipsis
  '·': { byte: 0o267, helv: 278, bold: 278 },   // middle dot
  ' ': { byte: 0o240, helv: 278, bold: 278 },
};

/** Advance width of one string, in points, for the three faces the card uses. Courier is 600 for everything. */
export function measure(text, size, face = 'sans') {
  if (face === 'mono') return (text.length * 600 * size) / 1000;
  const table = face === 'bold' ? W_BOLD : W_HELV;
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) w += table[code - 32];
    else if (EXTRA[ch]) w += face === 'bold' ? EXTRA[ch].bold : EXTRA[ch].helv;
    else throw new Error(`no width for U+${code.toString(16).toUpperCase().padStart(4, '0')} (${ch}) — add it to EXTRA in cheatsheet.mjs`);
  }
  return (w * size) / 1000;
}

/**
 * The longest honest form of a gloss that fits the column.
 *
 * Candidates are the whole thing and then each of its natural clause breaks, tried longest first, so a gloss
 * loses a subordinate clause before it loses a word and loses a word only when nothing else worked. The
 * ellipsis is the last resort and is visible, so a reader can tell the card cut something rather than
 * believing the short version is the whole description.
 */
export function fit(text, width, size, face = 'sans') {
  if (!text) return '';
  if (measure(text, size, face) <= width) return text;
  const cuts = [];
  for (const sep of [' — ', ' – ', '; ', ': ', ', ']) {
    let i = text.indexOf(sep);
    while (i > 0) { cuts.push(text.slice(0, i)); i = text.indexOf(sep, i + 1); }
  }
  cuts.sort((a, b) => b.length - a.length);
  // A clause is only worth taking if it still fills the column. Without the floor, `atlas serve` — "build,
  // then run the live dashboard detached and open it" — cuts at the first comma and the card says "build",
  // which is a different command's description. Below the floor an honest ellipsis says more.
  for (const c of cuts) {
    const w = measure(c, size, face);
    if (w <= width && w >= width * 0.3) return c;
  }
  const words = text.split(' ');
  let acc = '';
  for (const w of words) {
    const next = acc ? `${acc} ${w}` : w;
    if (measure(`${next}…`, size, face) > width) break;
    acc = next;
  }
  return acc ? `${acc}…` : '…';
}

/* ------------------------------------------------------------------ palettes and geometry */

/**
 * **Why the SVG is one opaque dark card and not a theme-switching one.**
 *
 * GitHub renders a README image through its own proxy in an `<img>`. Inside an `<img>`, a `prefers-color-scheme`
 * query in the SVG is answered by the *browser's* colour scheme, not by the GitHub theme the reader is looking
 * at — so a switching card is wrong for everyone whose OS scheme and GitHub theme disagree, and there is no
 * way for the SVG to find out. GitHub's own answer to this is two images and a `#gh-dark-mode-only` fragment,
 * which needs two files and a README edit for each.
 *
 * A card that paints its own background is right on both themes because it never inherits one. Dark rather
 * than light because the content is a terminal reference and it reads as one: a light card is a white slab in
 * the middle of a dark README, and the same argument in reverse is weaker, because a dark card on a light page
 * reads as a code block, which is what this is. The border and the corner radius are what make it a card
 * rather than a hole.
 */
export const DARK = {
  bg: '#0F1A1C',
  edge: '#26403F',
  rule: '#22383A',
  title: '#EDF4F2',
  kicker: '#8FD3C6',
  accent: '#E5A33C',
  name: '#9FDCCE',
  gloss: '#BCCAC7',
  dim: '#7C918D',
  marker: '#E5A33C',
};

/**
 * The print palette. Ink on white, and chosen so the three text roles keep their order in greyscale — the
 * heading is darkest, the command next, the gloss lightest — so a black-and-white print of the PDF still has
 * the hierarchy that the colour one has.
 */
export const LIGHT = {
  bg: '#FFFFFF',
  edge: '#FFFFFF',
  rule: '#BCC8C6',
  title: '#12292B',
  kicker: '#3F6D66',
  accent: '#1C3A3E',
  name: '#101413',
  gloss: '#454F4E',
  dim: '#6E7B79',
  marker: '#1C3A3E',
};

/** Screen geometry: 900 units wide, which GitHub renders at about the width of a README, so 11.5 reads as 11px. */
export const SCREEN = {
  width: 900, height: null, margin: 28, radius: 10, cols: 2, gutter: 26,
  titleSize: 22, kickerSize: 13, taglineSize: 11, legendSize: 10,
  groupSize: 12, groupLead: 27, rowSize: 11.5, rowLead: 17, subSize: 10, subLead: 15,
  footSize: 10, footLead: 14.5, nameGap: 12, markerBox: 6,
};

/** A4 landscape at points. One page, and the generator refuses rather than overflowing onto a second. */
export const PRINT = {
  width: 842, height: 595, margin: 20, radius: 0, cols: 2, gutter: 22,
  titleSize: 17, kickerSize: 10, taglineSize: 8, legendSize: 7.3,
  groupSize: 8.8, groupLead: 17.6, rowSize: 8.2, rowLead: 11.5, subSize: 7.2, subLead: 10,
  footSize: 7.2, footLead: 9.8, nameGap: 9, markerBox: 4.4,
};

/* ------------------------------------------------------------------ layout */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * Split blocks across columns so the tallest column is as short as possible, keeping their order.
 *
 * Exhaustive rather than greedy, over a dozen blocks and two columns — greedy against a target of
 * `total / cols` puts one oversized block wherever it lands and leaves the other column short, and the visible
 * result is a page with a ragged foot. Ties go to the earliest split, so the answer is one function of the
 * input and the bytes do not move because two packings scored the same.
 */
export function pack(blocks, cols) {
  const n = blocks.length;
  const memo = new Map();
  const best = (i, k) => {
    if (i >= n) return { worst: 0, cuts: [] };
    if (k === 1) return { worst: blocks.slice(i).reduce((a, b) => a + b.h, 0), cuts: [] };
    const key = `${i}:${k}`;
    if (memo.has(key)) return memo.get(key);
    let acc = 0;
    let winner = null;
    for (let j = i; j < n; j += 1) {
      acc += blocks[j].h;
      if (n - (j + 1) < k - 1) break;             // every remaining column needs at least one block
      const tail = best(j + 1, k - 1);
      const worst = Math.max(acc, tail.worst);
      if (!winner || worst < winner.worst - 1e-9) winner = { worst, cuts: [j + 1, ...tail.cuts] };
    }
    if (!winner) winner = { worst: blocks.slice(i).reduce((a, b) => a + b.h, 0), cuts: [] };
    memo.set(key, winner);
    return winner;
  };
  const { cuts } = best(0, Math.max(1, Math.min(cols, n)));
  const bounds = [0, ...cuts, n];
  const out = Array.from({ length: cols }, () => []);
  for (let c = 0; c < cols; c += 1) out[c] = blocks.slice(bounds[c] ?? n, bounds[c + 1] ?? n);
  return out;
}

/**
 * One laid-out page: a flat list of positioned primitives in top-down coordinates, which both renderers walk.
 *
 * Blocks — a group heading with its rows — are kept whole, which is what keeps a heading off the bottom of a
 * column, and handed to `pack()` to be split across the columns. See that function for why the split is
 * exhaustive rather than greedy and how it stays deterministic.
 */
export function layout(model, G, C) {
  const ops = [];
  const text = (x, y, s, face, size, fill, extra) => { if (s) ops.push({ op: 'text', x, y, s, face, size, fill, ...extra }); };
  const rect = (x, y, w, h, fill) => ops.push({ op: 'rect', x, y, w, h, fill });

  const colW = (G.width - 2 * G.margin - (G.cols - 1) * G.gutter) / G.cols;
  const left = G.margin;
  const right = G.width - G.margin;

  /* masthead */
  let y = G.margin + G.titleSize;
  text(left, y, model.title, 'bold', G.titleSize, C.title);
  const tw = measure(model.title, G.titleSize, 'bold');
  text(left + tw + G.titleSize * 0.45, y, model.kicker, 'sans', G.kickerSize, C.kicker);
  y += G.taglineSize * 1.5;
  text(left, y, model.tagline, 'sans', G.taglineSize, C.gloss);

  /* the legend, which is what lets a row print its name once instead of twice */
  y += G.legendSize * 1.6;
  const lg = G.legendSize;
  let lx = left;
  // Every run is emitted without a leading or trailing space and the gap is put in as geometry, because an
  // SVG `<text>` collapses its own edge whitespace by default — the word-spacing came out missing on GitHub
  // and nowhere else, which is exactly the kind of thing you only find by looking at the rendered file.
  const seg = (s, face, fill, gap = 0) => { text(lx, y, s, face, lg, fill); lx += measure(s, lg, face) + gap; };
  seg('Every command below is', 'sans', C.dim, lg * 0.34);
  seg('atlas <name>', 'mono', C.name, lg * 0.34);
  seg('in a shell and', 'sans', C.dim, lg * 0.34);
  seg('/atlas:<name>', 'mono', C.name, lg * 0.34);
  seg('in Claude Code.', 'sans', C.dim, lg * 1.5);
  const box = G.markerBox;
  rect(lx, y - box, box, box, C.marker);
  lx += box + lg * 0.4;
  seg('shell only', 'sans', C.dim, lg * 1.5);
  ops.push({ op: 'frame', x: lx, y: y - box, w: box, h: box, color: C.marker, weight: Math.max(0.6, box / 7) });
  lx += box + lg * 0.4;
  seg('Claude Code only', 'sans', C.dim);

  y += lg * 0.9;
  rect(left, y, right - left, 0.9, C.rule);
  const bodyTop = y + G.rowLead * 0.75;

  /* the footer is measured before the body, because the body's height budget is what is left over */
  const footRows = Math.ceil(model.flags.length / 2);
  const footH = G.footLead * (footRows + 1) + G.footLead * 1.4;
  const bodyBottom = (G.height ?? Infinity) - G.margin - footH;

  /* blocks */
  const blocks = model.groups.map((g) => {
    const lines = [{ kind: 'group', text: g.title }];
    for (const r of g.rows) {
      lines.push({ kind: 'row', row: r });
      for (const f of r.flags) lines.push({ kind: 'sub', flag: f });
    }
    const h = lines.reduce((a, l) => a + (l.kind === 'group' ? G.groupLead : l.kind === 'row' ? G.rowLead : G.subLead), 0);
    return { lines, h };
  });

  const columns = pack(blocks, G.cols);

  /* the name column is as wide as the widest name, not a guess — and the gloss gets everything else */
  const nameSize = G.rowSize * 0.95;
  let nameW = 0;
  for (const g of model.groups) {
    for (const r of g.rows) {
      const label = r.args ? `${r.name} ${r.args}` : r.name;
      nameW = Math.max(nameW, measure(label, nameSize, 'mono'));
    }
  }
  nameW = Math.min(nameW, colW * 0.42);
  const glossX = box + 4 + nameW + G.nameGap;

  let deepest = bodyTop;
  columns.forEach((blocksIn, i) => {
    const x = left + i * (colW + G.gutter);
    let cy = bodyTop;
    for (const b of blocksIn) {
      for (const l of b.lines) {
        if (l.kind === 'group') {
          cy += G.groupLead;
          text(x, cy - G.groupSize * 0.42, l.text, 'bold', G.groupSize, C.accent);
          rect(x, cy - G.groupSize * 0.42 + G.groupSize * 0.36, colW, 0.6, C.rule);
        } else if (l.kind === 'row') {
          cy += G.rowLead;
          const r = l.row;
          if (!r.cli || !r.slash) {
            const by = cy - G.rowSize * 0.72;
            if (r.cli) rect(x, by, box, box, C.marker);
            else ops.push({ op: 'frame', x, y: by, w: box, h: box, color: C.marker, weight: Math.max(0.6, box / 7) });
          }
          const label = r.args ? `${r.name} ${r.args}` : r.name;
          text(x + box + 4, cy, fit(label, nameW, nameSize, 'mono'), 'mono', nameSize, C.name);
          text(x + glossX, cy, fit(r.gloss, colW - glossX, G.rowSize * 0.94, 'sans'), 'sans', G.rowSize * 0.94, C.gloss);
        } else {
          cy += G.subLead;
          const fx = x + box + 4 + G.subSize;
          text(fx, cy, l.flag.flag, 'mono', G.subSize, C.dim);
          const fw = measure(l.flag.flag, G.subSize, 'mono');
          const gx = Math.max(x + glossX, fx + fw + G.nameGap * 0.6);
          text(gx, cy, fit(l.flag.desc, colW - (gx - x), G.subSize, 'sans'), 'sans', G.subSize, C.dim);
        }
      }
    }
    deepest = Math.max(deepest, cy);
  });

  /* footer: the aliases, the global flags, and the line usage() closes with */
  let fy = G.height ? G.height - G.margin - footH : deepest + G.footLead * 2.2;
  rect(left, fy, right - left, 0.9, C.rule);
  fy += G.footLead * 1.4;

  // `atlas ` is stated once in the masthead and dropped from both sides here — spelling it four times in a
  // footer line is what pushed this string into the flags heading beside it.
  const aliasParts = model.aliases.map((a) => `${a.from} = ${a.to.replace(/^atlas\s+/, '')}`).join(' · ');
  const flagCol = (right - left) / 2;
  let ax = left;
  text(ax, fy, 'Aliases', 'bold', G.footSize, C.accent);
  ax += measure('Aliases', G.footSize, 'bold') + G.nameGap;
  text(ax, fy, fit(aliasParts, left + flagCol - ax - G.nameGap, G.footSize, 'mono'), 'mono', G.footSize, C.dim);

  text(left + flagCol, fy, 'Flags, on every command', 'bold', G.footSize, C.accent);

  // Column-major: the flags read down the left column and then down the right one. Row-major put `--root`
  // above `--verbose` above `--no-git` and called that a column, which is every second flag in `usage()`.
  model.flags.forEach((f, i) => {
    const c = Math.floor(i / footRows);
    const rowN = i % footRows;
    const fx = left + c * flagCol;
    const fyy = fy + G.footLead * (rowN + 1);
    text(fx, fyy, f.flag, 'mono', G.footSize, C.name);
    const w = Math.max(measure(f.flag, G.footSize, 'mono'), flagCol * 0.24);
    text(fx + w + G.nameGap, fyy, fit(f.desc, flagCol - w - G.nameGap - 10, G.footSize, 'sans'), 'sans', G.footSize, C.dim);
  });

  const lastY = fy + G.footLead * (footRows + 1.15);
  text(left, lastY, model.footer, 'sans', G.footSize, C.dim);

  const height = G.height ?? Math.ceil(lastY + G.margin);
  if (G.height && deepest > bodyBottom) {
    throw new Error(`the cheatsheet no longer fits on one ${G.width}×${G.height} page: the longest column runs `
      + `${Math.ceil(deepest)} against ${Math.floor(bodyBottom)} available. Drop something from the card or `
      + 'change the geometry in cheatsheet.mjs — do not shrink the type.');
  }
  return { width: G.width, height, ops, background: C.bg, edge: C.edge, radius: G.radius };
}

/* ------------------------------------------------------------------ renderers */

const FAMILY = {
  sans: "Helvetica,Arial,'Liberation Sans','Nimbus Sans',sans-serif",
  bold: "Helvetica,Arial,'Liberation Sans','Nimbus Sans',sans-serif",
  mono: "'Courier New',Courier,'Liberation Mono','Nimbus Mono PS',monospace",
};

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.round(v * 100) / 100).toString();

/**
 * The SVG. Real `<text>`, presentation attributes only — no `<style>` element, no CSS, no external font and no
 * external image — because GitHub's sanitiser is entitled to drop any of those and an image that renders as
 * bare glyph positions on the page it is embedded in has failed at the one job it had.
 */
export function toSVG(page, model) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}" height="${n(page.height)}" `
    + `viewBox="0 0 ${n(page.width)} ${n(page.height)}" role="img" aria-labelledby="cs-title cs-desc">`);
  out.push(`<title id="cs-title">${xml(`${model.title} — ${model.kicker}`)}</title>`);
  out.push(`<desc id="cs-desc">${xml(`Every ${model.groups.reduce((a, g) => a + g.rows.length, 0)} project-atlas commands, grouped by intent. Generated from the command surface by scripts/gen-cheatsheet.mjs.`)}</desc>`);
  out.push(`<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}" rx="${n(page.radius)}" fill="${page.background}"/>`);
  if (page.edge !== page.background) {
    out.push(`<rect x="0.5" y="0.5" width="${n(page.width - 1)}" height="${n(page.height - 1)}" rx="${n(page.radius)}" fill="none" stroke="${page.edge}" stroke-width="1"/>`);
  }
  for (const o of page.ops) {
    if (o.op === 'rect') {
      out.push(`<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill}"/>`);
    } else if (o.op === 'frame') {
      const h = o.weight / 2;
      out.push(`<rect x="${n(o.x + h)}" y="${n(o.y + h)}" width="${n(o.w - o.weight)}" height="${n(o.h - o.weight)}" fill="none" stroke="${o.color}" stroke-width="${n(o.weight)}"/>`);
    } else {
      const weight = o.face === 'bold' ? ' font-weight="700"' : '';
      out.push(`<text x="${n(o.x)}" y="${n(o.y)}" font-family="${FAMILY[o.face]}" font-size="${n(o.size)}"${weight} fill="${o.fill}">${xml(o.s)}</text>`);
    }
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

/** A PDF string literal, in WinAnsi bytes, with everything outside printable ASCII written as an octal escape. */
function pdfString(s) {
  let out = '';
  for (const ch of s) {
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else {
      const code = ch.codePointAt(0);
      if (code >= 32 && code <= 126) out += ch;
      else if (EXTRA[ch]) out += `\\${EXTRA[ch].byte.toString(8).padStart(3, '0')}`;
      else throw new Error(`U+${code.toString(16).toUpperCase()} has no WinAnsi byte — add it to EXTRA in cheatsheet.mjs`);
    }
  }
  return `(${out})`;
}

const PDF_FONT = { sans: '/F1', bold: '/F2', mono: '/F3' };
const rgb = (h) => hex(h).map((v) => v.toFixed(4)).join(' ');

/**
 * The PDF, written out directly rather than printed from a browser.
 *
 * Chrome headless was the obvious route and is what this repository has used before, and it was rejected for
 * one reason: the staleness test has to be able to regenerate this file and compare bytes. A browser-printed
 * PDF carries a `/CreationDate`, and past that, its output is a function of the Chrome build on the machine —
 * so the test would go red on a Chrome upgrade and on any machine without Chrome, which teaches everyone to
 * ignore it. Written here it is a pure function of the source, needs nothing installed, and the three faces
 * are Type 1 base-14, which every reader has and which therefore embed nothing and cannot drift either.
 *
 * There is no `/Info` dictionary at all: no producer, no dates, nothing to normalise afterwards.
 */
export function toPDF(page) {
  const c = [];
  c.push(`${rgb(page.background)} rg 0 0 ${n(page.width)} ${n(page.height)} re f`);
  const flip = (y) => page.height - y;
  for (const o of page.ops) {
    if (o.op === 'rect') {
      c.push(`${rgb(o.fill)} rg ${n(o.x)} ${n(flip(o.y + o.h))} ${n(o.w)} ${n(o.h)} re f`);
    } else if (o.op === 'frame') {
      const h = o.weight / 2;
      c.push(`${rgb(o.color)} RG ${n(o.weight)} w ${n(o.x + h)} ${n(flip(o.y + o.h) + h)} ${n(o.w - o.weight)} ${n(o.h - o.weight)} re S`);
    } else {
      c.push(`BT ${rgb(o.fill)} rg ${PDF_FONT[o.face]} ${n(o.size)} Tf 1 0 0 1 ${n(o.x)} ${n(flip(o.y))} Tm ${pdfString(o.s)} Tj ET`);
    }
  }
  const stream = c.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] `
      + '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ------------------------------------------------------------------ the one command */

export const SVG_PATH = path.join('docs', 'assets', 'cheatsheet.svg');
export const PDF_PATH = path.join('docs', 'assets', 'cheatsheet.pdf');

/** Both assets, as bytes, from the repository at `root`. Writes nothing — the caller decides that. */
export function renderAssets(root) {
  const model = cheatsheet(root);
  const svgPage = layout(model, SCREEN, DARK);
  const pdfPage = layout(model, PRINT, LIGHT);
  return { model, svg: Buffer.from(toSVG(svgPage, model), 'utf8'), pdf: toPDF(pdfPage) };
}

/** Write them. Returns which ones actually changed, so `--check` and the build can both use this. */
export function writeAssets(root) {
  const { svg, pdf, model } = renderAssets(root);
  const changed = [];
  for (const [rel, bytes] of [[SVG_PATH, svg], [PDF_PATH, pdf]]) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!before || !before.equals(bytes)) { fs.writeFileSync(file, bytes); changed.push(rel); }
  }
  return { changed, model, bytes: { [SVG_PATH]: svg.length, [PDF_PATH]: pdf.length } };
}
