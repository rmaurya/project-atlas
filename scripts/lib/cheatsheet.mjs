/**
 * project-atlas · the command cheatsheet, derived from the live command surface (A-52, elaborated by A-58)
 *
 * **Nothing that states a fact about a command is typed out here.** A cheatsheet of forty-five commands
 * written by hand is the same defect this repository has already filed three times — a count stated in prose
 * beside a list that grows — with a picture wrapped around it, and a picture is the worst place for it because
 * nobody diffs an image. So every string that names a command, every grouping and every gloss is read out of
 * the three places that already are the surface:
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
 * **The one thing that is hand-authored, and why it has to be.** `SHAPE`, below: five nouns for the five
 * things this tool turns your markdown into, and the lists that say which commands are lenses, which write and
 * which leave the machine. That is architecture, and this repository holds it in English prose (`README.md`,
 * `docs/CAPABILITIES.md`) and nowhere a program can read. Deriving a diagram by parsing those paragraphs would
 * be more fragile than writing five nouns down, not less. So they are written down — and every *command name*
 * inside `SHAPE` is checked against the live surface at generation time, so the structure can be out of
 * fashion but it cannot be out of date: a renamed command throws instead of printing a lie, and
 * `tests/run.mjs` holds that.
 *
 * **What the card is for.** Not an index — `atlas help` is already an index and you can pipe it. The card
 * answers the question a list cannot: *where am I*. Sheet one is the shape of the tool — markdown in, four
 * derived things out, one command that sends anything outward, and a set of read-only lenses onto what the
 * corpus does not hold. Sheet two is every command, grouped by intent, with its description **whole**.
 *
 * **Why descriptions come from `usage()` and the intent map, and not from the skills' `description`
 * frontmatter.** That frontmatter is written to tell a *model* when to invoke a skill — half of each one is
 * "Use when the user asks …" trigger phrasing that would have to be cut off before it could go on a card, and
 * cutting is editing rather than deriving. `usage()` and the map are both written to tell a *person* what a
 * command does. Between those two the card takes whichever is longer, because both are true and the longer one
 * is the one that answers the question.
 *
 * **Two backends, three parameters.** The SVG (screen, embedded in the README) and the PDF (a download,
 * printed and pinned up) are the same laid-out sheets rendered twice, so they cannot disagree about content.
 * They differ in geometry (the SVG is sized for the width GitHub renders a README image at; the PDF is A4
 * landscape at points), in palette (the SVG is a dark card; the PDF is print ink on white) and in
 * **pagination** — see `SCREEN` and `PRINT` for why the PDF is two pages and the SVG is one scroll.
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
import { num } from './format.mjs';
import { MARK } from './render.mjs';

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

/* ------------------------------------------------------------------ the shape, and the one hand-written part */

/**
 * **The shape of the tool.** The only hand-authored content on the card, and the reason the card exists.
 *
 * Sheet one has to answer, in ten seconds and to somebody who has never run this: *what is this thing, and
 * where am I in it*. That is not a fact about any one command, so no command can supply it. It is architecture,
 * and this repository states its architecture in English — `README.md`'s "the one rule everything else
 * follows", `docs/CAPABILITIES.md`'s six jobs — in paragraphs written for a reader. A generator that tried to
 * parse a diagram out of those paragraphs would be a second, worse copy of them that broke on a rewording.
 * Five nouns written down here are honest about being written down.
 *
 * **What keeps it from rotting.** Every command name below is checked against the live surface by
 * `validateShape()` before anything is laid out. Rename a command and the generator throws with the name that
 * no longer exists; it does not quietly print a command that is gone. The *descriptions* beside those names
 * are never written here — they are looked up from the same derived rows sheet two uses. So what is
 * hand-authored is exactly: five node nouns, five node notes, six lens labels, two effect labels, and one
 * closing sentence. Everything else on both sheets is read out of the source.
 *
 * A command that is not named here is not an error — it simply has no place in the shape and appears only on
 * sheet two, which *is* checked for completeness. Requiring coverage would make adding a command an edit to
 * this file, and this file must never be the reason a command is hard to add.
 */
export const SHAPE = {
  /* The spine: what markdown becomes, and the command that performs each step. */
  spine: {
    title: 'The shape of it',
    nodes: [
      { name: 'your markdown', note: 'every .md already in the repository — the only files you edit' },
      { name: 'the index', note: 'clusters, backlinks, citations, a search index' },
      { name: 'what has rotted', note: 'dead links, forks, stale citations, orphans — exit 1 if blocking' },
      { name: 'the site', note: 'wiki index, dashboard, deck, health — all of it deletable' },
      { name: 'off this machine', note: 'a wiki, a gh-pages branch, or one self-contained file' },
    ],
    /* One command per gap, left to right. There are always one fewer than there are nodes. */
    edges: ['scan', 'health', 'build', 'publish'],
    /**
     * The commands that run the spine rather than sit on it, printed with their own descriptions rather than
     * a sentence written here. This is where `serve` and `watch` stop being confusable: they are two lines
     * apart, whole, in the tool's own words, which is the answer the old card could not give because it cut
     * both of them at the first comma.
     */
    also: ['init', 'all', 'serve', 'watch', 'dashboard'],
  },

  /* Everything that is not on the spine, in two panels of labelled rows. */
  panels: [
    {
      title: 'Lenses — read-only, and nothing they report is written into the site',
      rows: [
        { label: 'git history', names: ['contrib', 'ownership', 'surviving', 'git-insights', 'git-hotspots', 'git-history', 'git-branch', 'git-tree', 'git-status', 'git-diff'] },
        { label: 'this working tree', names: ['status', 'changes', 'diff', 'branch', 'review'] },
        { label: 'the plan', names: ['tasks', 'plan', 'design', 'contention', 'spec'] },
        { label: 'your sessions', names: ['sessions', 'tokens'], note: 'read from outside the repository, aggregate only, never published' },
        { label: 'continuity', names: ['state', 'handoff', 'resume'], note: 'what a cold session reads first' },
        { label: 'agent surfaces', names: ['mcp', 'ask', 'prompt'] },
        { label: 'the tool itself', names: ['help', 'version', 'config', 'caps'] },
      ],
    },
    {
      title: 'What writes, and what leaves this machine',
      rows: [
        { label: 'writes in your repository', names: ['init', 'build', 'note', 'worklog', 'branch', 'pause', 'stop', 'community'], note: 'everything build writes is derived and safe to delete' },
        { label: 'leaves this machine', names: ['publish', 'artifact'], note: 'never without confirmation; nothing is pushed without --push' },
        { label: 'touches the network', names: ['caps'], note: 'one request to the host API, and community makes the same one' },
      ],
    },
  ],

  closing: 'Every other command on this card only reads.',
};

/** Every command name `SHAPE` mentions, in the order it mentions them. */
export function shapeNames(shape = SHAPE) {
  const out = [...shape.spine.edges, ...shape.spine.also];
  for (const p of shape.panels) for (const r of p.rows) out.push(...r.names);
  return out;
}

/**
 * The check that makes a hand-written structure safe: every name in `SHAPE` must be a command that exists.
 *
 * It throws rather than dropping the unknown name, because a silently shortened list is a card that is subtly
 * wrong and looks finished — the exact failure mode this whole file was written to avoid.
 */
export function validateShape(known, shape = SHAPE) {
  const missing = [...new Set(shapeNames(shape))].filter((n) => !known.has(n));
  if (missing.length) {
    throw new Error(`SHAPE in cheatsheet.mjs names ${missing.join(', ')}, which the command surface does not have. `
      + 'Rename them there or drop them — the shape panel must not print a command that does not exist.');
  }
  if (shape.spine.edges.length !== shape.spine.nodes.length - 1) {
    throw new Error('the spine needs exactly one command between each pair of nodes');
  }
}

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
    const fromMap = mapEntry && mapEntry.gloss && !(mapEntry.shared && cmd) ? firstSentence(mapEntry.gloss) : '';
    const fromUsage = cmd ? firstSentence(plain(cmd.desc)) : '';
    // Both are true, both were written for a person, and neither is reliably the fuller one — `health`'s
    // best line is in `usage()`, `build`'s is in the map. Longest wins: the card has room for the whole
    // sentence now, so the only question left is which sentence says more.
    const gloss = fromUsage.length > fromMap.length ? fromUsage : fromMap;
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

  validateShape(new Set([...dispatched, ...skills].filter((c) => !aliased.has(c))));

  // Sheet one prints descriptions too, and they must be the *same* descriptions sheet two prints — one row
  // per command, looked up, rather than a second derivation that could disagree with the first.
  const byName2 = new Map(groups.flatMap((g) => g.rows).map((r) => [r.name, r]));

  return {
    title: 'project-atlas',
    kicker: 'command cheatsheet',
    tagline: usage.tagline.replace(/^project-atlas\s+[—–-]\s+/, ''),
    groups,
    rowFor: (name) => byName2.get(name),
    aliases: usage.aliases,
    flags: usage.flags,
    footer: usage.footer,
    shape: SHAPE,
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
 *
 * There is no arrow in here and there cannot be: `→` U+2192 has no WinAnsi byte at all, so the spine's arrows
 * are drawn as geometry rather than set as type. That is why there is a `poly` op.
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
  ' ': { byte: 0o240, helv: 278, bold: 278 },
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
 * The longest honest form of a string that fits a column, on one line.
 *
 * **Nothing on the card calls this directly any more, and that is the point.** It was the last thing that
 * happened to every command description, and then — after those started wrapping — to the global flags, the
 * alias run and the command labels, which is how `--no-git` came to read "…reported as unchecked rather…" in
 * the same face and colour as the wrapped sentences beside it. A card where *some* strings are cut is worse
 * than one where all of them are, because a reader cannot tell which sentences they are seeing all of.
 *
 * Its one remaining caller is `wrap()`, for the last line of a wrap that has been given a line cap — a valve
 * only the sub-flags use, and `tests/run.mjs` asserts it is not currently firing anywhere.
 *
 * Candidates are the whole thing and then each of its natural clause breaks, tried longest first, so a string
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

/**
 * A description broken across as many lines as it needs, and never shortened.
 *
 * This is the change that made the card worth regenerating. The old card fitted every description onto one
 * line and truncated what did not fit, which is how `atlas contention` came to read "what a fan-out will
 * collide on" — true, and not an answer to what the command is for. A word that will not fit on a line goes
 * on the next line; nothing is dropped unless `max` is given and the text runs past it, and then the last
 * line ends in a visible ellipsis.
 */
export function wrap(text, width, size, face = 'sans', max = Infinity) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let acc = '';
  for (let i = 0; i < words.length; i += 1) {
    const next = acc ? `${acc} ${words[i]}` : words[i];
    if (acc && measure(next, size, face) > width) {
      // The last line a caller will allow gets whatever is left of the sentence, shortened by `fit()` — so
      // the ellipsis lands where the text actually stopped rather than where the line happened to break.
      if (lines.length + 1 === max) return [...lines, fit([acc, ...words.slice(i)].join(' '), width, size, face)];
      lines.push(acc);
      acc = words[i];
    } else acc = next;
  }
  if (acc) lines.push(acc);
  return lines;
}

/* ------------------------------------------------------------------ the mark */

/**
 * The atlas mark, taken from `render.mjs` rather than drawn again.
 *
 * `MARK` is the same string the site header and footer use, so there is exactly one copy of this geometry in
 * the repository and the card cannot drift from the logo. What has to be undone here is that `MARK` is written
 * for a document with a stylesheet: its three colours are `var(--atlas-*)` references, and this card has no
 * stylesheet — GitHub may strip one, and a PDF has never had one. So the elements are parsed, the variables
 * are resolved against whichever palette is in play, and the *path data is passed through untouched*.
 */
const MARK_VIEWBOX = (() => {
  const m = MARK.match(/viewBox="([^"]+)"/);
  if (!m) throw new Error('MARK in render.mjs has no viewBox — the cheatsheet cannot place it');
  return m[1].trim().split(/\s+/).map(Number);
})();

const MARK_SHAPES = (() => {
  const out = [];
  for (const [, tag, raw] of MARK.matchAll(/<(path|circle)\s([^>]*?)\/>/g)) {
    const attrs = {};
    for (const [, k, v] of raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[k] = v;
    out.push({ tag, attrs });
  }
  if (!out.length) throw new Error('MARK in render.mjs has no <path> or <circle> — the cheatsheet cannot draw it');
  return out;
})();

/** `var(--atlas-summit)` against `{ summit: '#…' }`. A token the palette has no colour for throws. */
function markColour(value, colours) {
  const m = value.match(/^var\(--atlas-([a-z]+)\)$/);
  if (!m) return value;
  const c = colours[m[1]];
  if (!c) throw new Error(`MARK uses --atlas-${m[1]} and the cheatsheet palette has no colour for it`);
  return c;
}

/** Where to put the mark: the transform that maps its viewBox onto a `size`-wide box at `x, y`. */
function markPlacement(x, y, size) {
  const [vx, vy, vw] = MARK_VIEWBOX;
  const s = size / vw;
  return { s, tx: x - vx * s, ty: y - vy * s };
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
  panel: '#132325',
  title: '#EDF4F2',
  kicker: '#8FD3C6',
  accent: '#E5A33C',
  name: '#9FDCCE',
  gloss: '#BCCAC7',
  dim: '#7C918D',
  marker: '#E5A33C',
  // The dark-theme values of the site's own mark tokens, so the logo on the card is the logo on the site.
  mark: { contour: '#5FA396', summit: '#EAF2EF', benchmark: '#E5A33C' },
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
  panel: '#F3F7F6',
  title: '#12292B',
  kicker: '#3F6D66',
  accent: '#1C3A3E',
  name: '#101413',
  gloss: '#454F4E',
  dim: '#6E7B79',
  marker: '#1C3A3E',
  mark: { contour: '#4E8F84', summit: '#1C3A3E', benchmark: '#E5A33C' },
};

/**
 * Screen geometry: 900 units wide, which GitHub renders at about the width of a README, so 11.5 reads as 11px.
 *
 * **Height is unbounded, and that is the answer to "the card is full".** The old card was A4-shaped in both
 * backends and had run out of room twice; the margin and then the leading had been spent, and the note left
 * behind said the next reduction would be the third and there was not one. It was right. The way out is not a
 * smaller face, it is that a README image was never a page: nobody prints it, GitHub gives it whatever width
 * the reader's window has, and the reader scrolls. So the SVG stops pretending to be paper. Both sheets are
 * stacked into one card at full type size, and adding a command makes it taller by one line.
 */
export const SCREEN = {
  width: 900, height: null, margin: 28, radius: 10, cols: 2, gutter: 26, sheetGap: 34,
  titleSize: 22, kickerSize: 13, taglineSize: 11, legendSize: 10, ruleSize: 12.5,
  groupSize: 12, groupLead: 27, rowSize: 11.5, rowLead: 17, contLead: 14.5, subSize: 10, subLead: 15,
  footSize: 10, footLead: 14.5, nameGap: 12, markerBox: 6,
  markSize: 32, boxPad: 8, nodeSize: 10, nodeLead: 12.8, arrowGap: 48, panelSize: 10, panelLead: 13.6,
};

/**
 * A4 landscape at points, **two pages, designed as two** — and the generator still refuses to spill.
 *
 * The card ran out of A4 twice. The margin was spent on `artifact`, the leading was spent on `git-tree`, and
 * the measured headroom after that was about four commands. Three ways out were on the table and two were
 * rejected:
 *
 *   · **A3.** One sheet, twice the area, no type change — and unprintable on every printer the people who
 *     would pin this up actually own. A cheatsheet you cannot print is a PDF nobody downloads.
 *   · **A4 portrait.** The same area rotated. It buys nothing at all.
 *   · **Smaller type.** Taken twice already; the note in the old file said there was nothing left in it, and
 *     the brief for this change says the same. Not taken.
 *
 * So: two pages, and *designed* as two rather than overflowed into two. They are not halves of one list.
 * **Page one is the shape** — the mark, the rule the whole tool follows, what markdown becomes and which
 * command performs each step, the read-only lenses, what writes, what leaves the machine, the two surfaces
 * and the global flags. It names about a third of the commands and it is the page you read once. **Page two
 * is every command**, grouped by intent, with its description whole. It is the page you pin up.
 *
 * Each page is budgeted separately and each throws on its own overflow, so "it fits" is still checked and
 * still fails loudly. Page two now has the whole sheet — no masthead, no legend block, no flags table, all of
 * which moved to page one — which is where the room for wrapped descriptions came from.
 */
export const PRINT = {
  /* No `sheetGap`: it is what separates the two sheets when they share one canvas, and here they do not. */
  width: 842, height: 595, margin: 22, radius: 0, cols: 2, gutter: 22,
  titleSize: 17, kickerSize: 10, taglineSize: 8.4, legendSize: 7.6, ruleSize: 10,
  groupSize: 8.8, groupLead: 16.4, rowSize: 8.2, rowLead: 11.2, contLead: 9.4, subSize: 7.2, subLead: 9.8,
  footSize: 7.4, footLead: 10.2, nameGap: 9, markerBox: 4.4,
  markSize: 26, boxPad: 6, nodeSize: 7.6, nodeLead: 9.6, arrowGap: 42, panelSize: 7.6, panelLead: 10.4,
};

/* ------------------------------------------------------------------ layout */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * Split blocks across columns so the tallest column is as short as possible, keeping their order.
 *
 * Exhaustive rather than greedy, over a hundred blocks and two columns — greedy against a target of
 * `total / cols` puts one oversized block wherever it lands and leaves the other column short, and the visible
 * result is a page with a ragged foot. Ties go to the earliest split, so the answer is one function of the
 * input and the bytes do not move because two packings scored the same.
 *
 * **`extra` is what a block costs only if it is the one that starts a column.** Sheet two packs one block per
 * *row*, not one per group, so a group can be split down the page fold — and a group that starts a column
 * part-way through has to reprint its heading. That heading is real height, and charging it only at the cut
 * is what stops the packer choosing a split whose cost it did not count. Blocks with no `extra` behave exactly
 * as they did when this packed whole groups.
 */
export function pack(blocks, cols) {
  const n = blocks.length;
  const memo = new Map();
  const run = (i, j) => blocks.slice(i, j).reduce((a, b) => a + b.h, 0) + (i < n ? (blocks[i].extra ?? 0) : 0);
  const best = (i, k) => {
    if (i >= n) return { worst: 0, cuts: [] };
    if (k === 1) return { worst: run(i, n), cuts: [] };
    const key = `${i}:${k}`;
    if (memo.has(key)) return memo.get(key);
    let winner = null;
    for (let j = i; j < n; j += 1) {
      if (n - (j + 1) < k - 1) break;             // every remaining column needs at least one block
      const tail = best(j + 1, k - 1);
      const worst = Math.max(run(i, j + 1), tail.worst);
      if (!winner || worst < winner.worst - 1e-9) winner = { worst, cuts: [j + 1, ...tail.cuts] };
    }
    if (!winner) winner = { worst: run(i, n), cuts: [] };
    memo.set(key, winner);
    return winner;
  };
  const { cuts } = best(0, Math.max(1, Math.min(cols, n)));
  const bounds = [0, ...cuts, n];
  const out = Array.from({ length: cols }, () => []);
  for (let c = 0; c < cols; c += 1) out[c] = blocks.slice(bounds[c] ?? n, bounds[c + 1] ?? n);
  return out;
}

/** A sheet under construction: a flat list of positioned primitives in top-down coordinates. */
function sheet() {
  const ops = [];
  return {
    ops,
    text(x, y, s, face, size, fill) { if (s) ops.push({ op: 'text', x, y, s, face, size, fill }); },
    rect(x, y, w, h, fill) { ops.push({ op: 'rect', x, y, w, h, fill }); },
    frame(x, y, w, h, color, weight) { ops.push({ op: 'frame', x, y, w, h, color, weight }); },
    poly(pts, fill) { ops.push({ op: 'poly', pts, fill }); },
    mark(x, y, size, colours) { ops.push({ op: 'mark', x, y, size, colours }); },
  };
}

/** The two-surfaces legend, which is what lets every row print its name once instead of twice. */
function legend(d, x, y, G, C) {
  const lg = G.legendSize;
  let lx = x;
  // Every run is emitted without a leading or trailing space and the gap is put in as geometry, because an
  // SVG `<text>` collapses its own edge whitespace by default — the word-spacing came out missing on GitHub
  // and nowhere else, which is exactly the kind of thing you only find by looking at the rendered file.
  const seg = (s, face, fill, gap = 0) => { d.text(lx, y, s, face, lg, fill); lx += measure(s, lg, face) + gap; };
  seg('Every command is', 'sans', C.dim, lg * 0.34);
  seg('atlas <name>', 'mono', C.name, lg * 0.34);
  seg('in a shell and', 'sans', C.dim, lg * 0.34);
  seg('/atlas:<name>', 'mono', C.name, lg * 0.34);
  seg('in Claude Code.', 'sans', C.dim, lg * 1.5);
  const box = G.markerBox;
  d.rect(lx, y - box, box, box, C.marker);
  lx += box + lg * 0.4;
  seg('shell only', 'sans', C.dim, lg * 1.5);
  d.frame(lx, y - box, box, box, C.marker, Math.max(0.6, box / 7));
  lx += box + lg * 0.4;
  seg('Claude Code only', 'sans', C.dim);
  return lx;
}

/** A heading with a hairline under it, the one rhythm both sheets use to start a section. */
function heading(d, x, y, w, s, G, C) {
  d.text(x, y, s, 'bold', G.groupSize, C.accent);
  d.rect(x, y + G.groupSize * 0.36, w, 0.6, C.rule);
  return y;
}

/**
 * **Sheet one — the shape.** The page that answers "where am I", and the reason the card is not a `--help`
 * you cannot pipe.
 *
 * Reading order is deliberate and vertical: the rule the tool follows, then what your markdown becomes and
 * which command performs each step, then everything that is a lens rather than a step, then the three lines
 * that say what writes and what leaves. A reader who stops after the spine has still learned the thing that
 * matters most, which is that the markdown is the input and everything else is deletable output.
 */
export function sheetShape(model, G, C) {
  const d = sheet();
  const left = G.margin;
  const right = G.width - G.margin;
  const W = right - left;
  let y = G.margin;

  /* masthead: the mark, the wordmark, the tagline, and how much card there is */
  const ms = G.markSize;
  d.mark(left, y, ms, C.mark);
  const tx = left + ms + G.titleSize * 0.5;
  const base = y + G.titleSize * 0.82;
  d.text(tx, base, model.title, 'bold', G.titleSize, C.title);
  const tw = measure(model.title, G.titleSize, 'bold');
  d.text(tx + tw + G.titleSize * 0.4, base, model.kicker, 'sans', G.kickerSize, C.kicker);
  const rows = model.groups.reduce((a, g) => a + g.rows.length, 0);
  // A sheet number is a fact about a paginated artefact. The screen card has no sheets — it is one image the
  // reader scrolls — so saying "sheet 1 of 2" there would be describing the PDF on the SVG's masthead.
  const count = `${num(rows)} commands · ${num(model.groups.length)} groups${G.height ? ' · sheet 1 of 2' : ''}`;
  d.text(right - measure(count, G.legendSize, 'sans'), base, count, 'sans', G.legendSize, C.dim);
  d.text(tx, base + G.taglineSize * 1.5, model.tagline, 'sans', G.taglineSize, C.gloss);
  y = Math.max(y + ms, base + G.taglineSize * 1.5) + G.taglineSize * 1.1;

  /* the rule the whole tool follows, in the tool's own words — the last line of usage() */
  d.rect(left, y, W, 0.9, C.rule);
  y += G.ruleSize * 1.7;
  d.text(left, y, model.footer, 'bold', G.ruleSize, C.kicker);
  y += G.ruleSize * 1.3;

  /* the spine */
  y += G.panelLead * 0.9;
  heading(d, left, y, W, model.shape.spine.title, G, C);
  y += G.panelLead * 1.5;

  const S = model.shape.spine;
  const gap = G.arrowGap;
  const boxW = (W - gap * S.edges.length) / S.nodes.length;
  const inner = boxW - G.boxPad * 2;
  const noteLines = S.nodes.map((nd) => wrap(nd.note, inner, G.nodeSize, 'sans'));
  const boxH = G.boxPad * 2 + G.nodeLead + Math.max(...noteLines.map((l) => l.length)) * G.nodeLead;

  S.nodes.forEach((nd, i) => {
    const bx = left + i * (boxW + gap);
    d.rect(bx, y, boxW, boxH, C.panel);
    d.frame(bx, y, boxW, boxH, C.rule, 0.8);
    let by = y + G.boxPad + G.nodeLead * 0.78;
    d.text(bx + G.boxPad, by, nd.name, 'bold', G.nodeSize + 0.6, C.title);
    for (const line of noteLines[i]) {
      by += G.nodeLead;
      d.text(bx + G.boxPad, by, line, 'sans', G.nodeSize, C.gloss);
    }
    if (i < S.edges.length) {
      // The arrow, drawn rather than set: there is no arrow glyph in WinAnsi, so a PDF cannot print one.
      const ax = bx + boxW;
      const ay = y + boxH / 2;
      const head = Math.max(4, G.nodeSize * 0.62);
      d.rect(ax + 6, ay - 0.6, gap - 12 - head, 1.2, C.marker);
      d.poly([[ax + gap - 6, ay], [ax + gap - 6 - head, ay - head * 0.55], [ax + gap - 6 - head, ay + head * 0.55]], C.marker);
      const label = S.edges[i];
      d.text(ax + gap / 2 - measure(label, G.nodeSize, 'mono') / 2, ay - head * 0.9, label, 'mono', G.nodeSize, C.name);
    }
  });
  y += boxH + G.panelLead * 1.5;

  /*
   * The commands that drive the spine without being a step on it, each with its own description in full.
   * `serve` and `watch` differ by one clause each and the old card cut both of those clauses off; here they
   * are two lines apart and whole, which is the entire point of having room.
   */
  const alsoW = Math.max(...S.also.map((c) => measure(c, G.panelSize, 'mono'))) + G.nameGap * 1.4;
  for (const name of S.also) {
    const r = model.rowFor(name);
    d.text(left, y, name, 'mono', G.panelSize, C.name);
    const lines = wrap(r ? r.gloss : '', W - alsoW, G.panelSize, 'sans');
    lines.forEach((line, i) => d.text(left + alsoW, y + i * G.panelLead, line, 'sans', G.panelSize, C.gloss));
    // `Math.max(1, …)`, so a command with no description still takes a line rather than being overprinted
    // by the next one — a row that silently vanished under another is worse than a row with a blank second
    // column, because only one of the two is visible as a defect.
    y += G.panelLead * Math.max(1, lines.length);
  }

  /* the panels: everything that is not a step on the spine */
  for (const panel of model.shape.panels) {
    y += G.panelLead * 1.1;
    heading(d, left, y, W, panel.title, G, C);
    y += G.panelLead * 1.35;
    // The label column is measured, not guessed — a label longer than a constant used to run into the names.
    const labelW = Math.max(...panel.rows.map((r) => measure(r.label, G.panelSize, 'bold'))) + G.nameGap * 1.6;
    for (const r of panel.rows) {
      d.text(left, y, r.label, 'bold', G.panelSize, C.title);
      const nx = left + labelW;
      const noteW = r.note ? measure(r.note, G.panelSize, 'sans') + G.nameGap * 1.6 : 0;
      const lines = wrap(r.names.join(' · '), right - nx - noteW, G.panelSize, 'mono');
      lines.forEach((line, i) => d.text(nx, y + i * G.panelLead, line, 'mono', G.panelSize, C.name));
      if (r.note) d.text(right - measure(r.note, G.panelSize, 'sans'), y, r.note, 'sans', G.panelSize, C.dim);
      y += G.panelLead * Math.max(1, lines.length) + G.panelLead * 0.18;
    }
    y += G.panelLead * 0.2;
  }
  d.text(left, y, model.shape.closing, 'sans', G.panelSize, C.gloss);
  y += G.panelLead * 1.3;

  /* the two surfaces, the aliases and the flags that work on everything */
  y += G.panelLead * 0.5;
  d.rect(left, y, W, 0.9, C.rule);
  y += G.footLead * 1.5;
  legend(d, left, y, G, C);
  y += G.footLead * 1.35;

  // `atlas ` is stated once in the legend above and dropped from both sides here — spelling it four times in
  // one line is what pushed this string into the heading beside it.
  const aliasParts = model.aliases.map((a) => `${a.from} = ${a.to.replace(/^atlas\s+/, '')}`).join(' · ');
  d.text(left, y, 'Aliases', 'bold', G.footSize, C.accent);
  const ax = left + measure('Aliases', G.footSize, 'bold') + G.nameGap;
  const aliasLines = wrap(aliasParts, right - ax, G.footSize, 'mono');
  aliasLines.forEach((line, i) => d.text(ax, y + i * G.footLead, line, 'mono', G.footSize, C.dim));
  y += G.footLead * (1.7 + Math.max(0, aliasLines.length - 1));

  /*
   * The global flags, and they wrap for the same reason the command descriptions do.
   *
   * This block used to end in `fit()`, so `--no-git` printed as "skip git metadata; staleness is reported as
   * unchecked rather…" — a cut sentence, in the same face and colour as the rows above it that had just
   * stopped being cut. A reader cannot tell those two apart, which makes it worse than the truncation this
   * change was filed to remove, not better.
   *
   * Wrapping means a flag is as tall as its description, so the two columns are packed rather than split down
   * the middle by count — the same exhaustive packer sheet two uses, over one block per flag.
   */
  d.text(left, y, 'Flags, on every command', 'bold', G.footSize, C.accent);
  y += G.footLead * 0.5;
  const flagCols = 2;
  const flagColW = W / flagCols;
  const flagNameW = Math.max(...model.flags.map((f) => measure(f.flag, G.footSize, 'mono'))) + G.nameGap * 1.4;
  const flagBlocks = model.flags.map((f) => {
    const lines = wrap(f.desc, flagColW - flagNameW - G.nameGap, G.footSize, 'sans');
    return { flag: f, lines, h: G.footLead * lines.length };
  });
  // Column-major: the flags read down the left column and then down the right one. Row-major put `--root`
  // above `--verbose` above `--no-git` and called that a column, which is every second flag in `usage()`.
  let flagFoot = y;
  pack(flagBlocks, flagCols).forEach((column, c) => {
    const fx = left + c * flagColW;
    let fy = y;
    for (const b of column) {
      fy += G.footLead;
      d.text(fx, fy, b.flag.flag, 'mono', G.footSize, C.name);
      b.lines.forEach((line, i) => d.text(fx + flagNameW, fy + i * G.footLead, line, 'sans', G.footSize, C.dim));
      fy += G.footLead * (b.lines.length - 1);
    }
    flagFoot = Math.max(flagFoot, fy);
  });

  return { ops: d.ops, height: flagFoot + G.footLead * 0.6 + G.margin };
}

/**
 * **Sheet two — every command.** The reference, and the page that gets pinned up.
 *
 * The change here is that a description is no longer cut to one line. `fit()` used to be the last thing that
 * happened to every gloss and it is why `atlas contention` read as a fragment. Descriptions wrap now; a row is
 * as tall as its sentence. That costs about fifteen lines across the whole card and it is what the masthead,
 * the legend block and the flags table moving to sheet one paid for.
 */
export function sheetReference(model, G, C) {
  const d = sheet();
  const left = G.margin;
  const right = G.width - G.margin;
  const W = right - left;
  const box = G.markerBox;
  let y = G.margin;

  /* a strip rather than a masthead: the mark, what this is, and the two markers a row can carry */
  const ms = G.markSize * 0.72;
  d.mark(left, y, ms, C.mark);
  const tx = left + ms + G.groupSize * 0.6;
  const base = y + ms * 0.74;
  d.text(tx, base, 'every command, grouped by what you are trying to do', 'bold', G.groupSize + 1, C.title);
  const tail = G.height ? 'sheet 2 of 2' : '';   // see the masthead on sheet one: pages are a PDF fact
  if (tail) d.text(right - measure(tail, G.legendSize, 'sans'), base, tail, 'sans', G.legendSize, C.dim);
  y = Math.max(y + ms, base) + G.legendSize * 1.5;
  // The legend is reprinted here only when this sheet is a page of its own. On the scrolling card the two
  // sheets are one image and the copy on sheet one is thirty units up the page; printing it twice there is
  // not redundancy for the reader's benefit, it is just twice.
  if (G.height) {
    legend(d, left, y, G, C);
    y += G.legendSize * 0.9;
  }
  d.rect(left, y, W, 0.9, C.rule);
  const bodyTop = y + G.rowLead * 0.8;

  /*
   * The name column is as wide as the widest name, and **a name is never shortened**.
   *
   * It used to be capped at 42% of the column and passed through `fit()`, which would have ellipsised the
   * label the first time an argument spec grew. That is the worst thing on the card to cut: a description cut
   * short is a description you go and look up, but a *name* cut short is one a reader types, and what they
   * type does not exist. So the cap is gone, and if a label ever leaves too little room for the description
   * beside it the layout throws — the same answer an overflowing sheet gets, for the same reason.
   */
  const colW = (W - (G.cols - 1) * G.gutter) / G.cols;
  const nameSize = G.rowSize * 0.95;
  let nameW = 0;
  let widest = '';
  for (const g of model.groups) {
    for (const r of g.rows) {
      const label = r.args ? `${r.name} ${r.args}` : r.name;
      const w = measure(label, nameSize, 'mono');
      if (w > nameW) { nameW = w; widest = label; }
    }
  }
  const glossX = box + 4 + nameW + G.nameGap;
  const glossW = colW - glossX;
  // Under 45% of the column and the description has stopped being readable prose and started being one word
  // per line, which is the point at which the card should say so rather than carry on.
  if (glossW < colW * 0.45) {
    throw new Error(`the command label "${widest}" is ${Math.ceil(nameW)} units wide and leaves only `
      + `${Math.floor(glossW)} of ${Math.floor(colW)} for the description beside it. A name on this card is `
      + 'never shortened — a reader types what they see. Shorten the argument spec in usage(), or give sheet '
      + 'two a wider geometry in cheatsheet.mjs.');
  }

  // The sub-flags get their own measured column for the same reason the names do, and it is shared across
  // every group so `--target wiki` under `publish` and `--snapshot` under `tokens` line up on one edge.
  let subNameW = 0;
  for (const g of model.groups) for (const r of g.rows) for (const f of r.flags) subNameW = Math.max(subNameW, measure(f.flag, G.subSize, 'mono'));
  const subGlossX = Math.max(glossX, box + 4 + G.subSize + subNameW + G.nameGap * 0.6);

  /*
   * One block per row, not one per group.
   *
   * Whole-group blocks were what the old card packed, and with ten groups of very different sizes the best
   * ordered split still left the two columns 89 points apart on A4 — nearly a tenth of the sheet, thrown away
   * as a ragged foot while the sheet was simultaneously running out of room. A row is the unit that can
   * actually level them. The heading travels with the first row of its group, so a heading can never be the
   * last line of a column; a row that starts a column part-way through a group carries the cost of reprinting
   * that heading, which is what `extra` is for.
   */
  const rowFace = G.rowSize * 0.94;
  const blocks = model.groups.flatMap((g) => g.rows.map((r, idx) => {
    const lines = [];
    if (idx === 0) lines.push({ kind: 'group', text: g.title });
    const wrapped = wrap(r.gloss, glossW, rowFace, 'sans');
    lines.push({ kind: 'row', row: r, gloss: wrapped[0] || '' });
    for (const cont of wrapped.slice(1)) lines.push({ kind: 'cont', text: cont });
    // A sub-flag's description wraps too, but to two lines at most: it is the detail under a detail, and the
    // one place on the card where a fourth line of prose would cost more room than it is worth.
    for (const f of r.flags) {
      const fw = wrap(f.desc, colW - subGlossX, G.subSize, 'sans', 2);
      lines.push({ kind: 'sub', flag: f, desc: fw[0] || '' });
      for (const cont of fw.slice(1)) lines.push({ kind: 'subcont', text: cont });
    }
    /* `subcont` shares its leading with `sub` — the last branch of the reduce below covers both. */
    const h = lines.reduce((a, l) => a + (l.kind === 'group' ? G.groupLead
      : l.kind === 'row' ? G.rowLead : l.kind === 'cont' ? G.contLead : G.subLead), 0);
    return { lines, h, extra: idx === 0 ? 0 : G.groupLead, group: g.title };
  }));

  const columns = pack(blocks, G.cols);
  let deepest = bodyTop;
  columns.forEach((blocksIn, i) => {
    const x = left + i * (colW + G.gutter);
    let cy = bodyTop;
    // A column that opens in the middle of a group reprints the heading, marked as the continuation it is —
    // otherwise the second column looks like a second group that happens to share a name.
    if (blocksIn.length && blocksIn[0].extra) {
      cy += G.groupLead;
      heading(d, x, cy - G.groupSize * 0.42, colW, `${blocksIn[0].group} (cont.)`, G, C);
    }
    for (const b of blocksIn) {
      for (const l of b.lines) {
        if (l.kind === 'group') {
          cy += G.groupLead;
          heading(d, x, cy - G.groupSize * 0.42, colW, l.text, G, C);
        } else if (l.kind === 'row') {
          cy += G.rowLead;
          const r = l.row;
          if (!r.cli || !r.slash) {
            const by = cy - G.rowSize * 0.72;
            if (r.cli) d.rect(x, by, box, box, C.marker);
            else d.frame(x, by, box, box, C.marker, Math.max(0.6, box / 7));
          }
          const label = r.args ? `${r.name} ${r.args}` : r.name;
          d.text(x + box + 4, cy, label, 'mono', nameSize, C.name);
          d.text(x + glossX, cy, l.gloss, 'sans', rowFace, C.gloss);
        } else if (l.kind === 'cont') {
          cy += G.contLead;
          d.text(x + glossX, cy, l.text, 'sans', rowFace, C.gloss);
        } else if (l.kind === 'sub') {
          cy += G.subLead;
          d.text(x + box + 4 + G.subSize, cy, l.flag.flag, 'mono', G.subSize, C.dim);
          d.text(x + subGlossX, cy, l.desc, 'sans', G.subSize, C.dim);
        } else {
          cy += G.subLead;
          d.text(x + subGlossX, cy, l.text, 'sans', G.subSize, C.dim);
        }
      }
    }
    deepest = Math.max(deepest, cy);
  });

  return { ops: d.ops, height: deepest + G.margin };
}

/** Every op on a sheet, moved down the page by `dy`. */
const shift = (ops, dy) => ops.map((o) => (o.op === 'poly'
  ? { ...o, pts: o.pts.map(([px, py]) => [px, py + dy]) }
  : { ...o, y: o.y + dy }));

/**
 * The sheets, laid out, as pages ready for a renderer.
 *
 * With `G.height` set — the PDF — each sheet is its own page and each is checked against that height on its
 * own, so an overflow still throws with the sheet that caused it rather than becoming a silent third page.
 * With `G.height` null — the SVG — the sheets are stacked into one card with a rule between them and the card
 * is as tall as they are.
 */
export function layout(model, G, C) {
  const sheets = [sheetShape(model, G, C), sheetReference(model, G, C)];
  const page = (ops, height) => ({ width: G.width, height, ops, background: C.bg, edge: C.edge, radius: G.radius });

  if (G.height) {
    return sheets.map((s, i) => {
      if (s.height > G.height) {
        throw new Error(`cheatsheet sheet ${i + 1} no longer fits a ${G.width}×${G.height} page: it runs `
          + `${Math.ceil(s.height)} against ${G.height} available. Move something to the other sheet or change `
          + 'the geometry in cheatsheet.mjs — do not shrink the type.');
      }
      return page(s.ops, G.height);
    });
  }

  const ops = [...sheets[0].ops];
  const divider = sheets[0].height + G.sheetGap / 2;
  ops.push({ op: 'rect', x: G.margin, y: divider, w: G.width - 2 * G.margin, h: 0.9, fill: C.rule });
  ops.push(...shift(sheets[1].ops, sheets[0].height + G.sheetGap));
  return [page(ops, Math.ceil(sheets[0].height + G.sheetGap + sheets[1].height))];
}

/* ------------------------------------------------------------------ renderers */

const FAMILY = {
  sans: "Helvetica,Arial,'Liberation Sans','Nimbus Sans',sans-serif",
  bold: "Helvetica,Arial,'Liberation Sans','Nimbus Sans',sans-serif",
  mono: "'Courier New',Courier,'Liberation Mono','Nimbus Mono PS',monospace",
};

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.round(v * 100) / 100).toString();
const n4 = (v) => (Math.round(v * 10000) / 10000).toString();

/**
 * The SVG. Real `<text>`, presentation attributes only — no `<style>` element, no CSS, no external font and no
 * external image — because GitHub's sanitiser is entitled to drop any of those and an image that renders as
 * bare glyph positions on the page it is embedded in has failed at the one job it had.
 *
 * The only `<path>` elements in the file are the mark's own, passed through from `render.mjs` with their
 * colour variables resolved. Every glyph is still a glyph.
 */
export function toSVG(page, model) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.width)}" height="${n(page.height)}" `
    + `viewBox="0 0 ${n(page.width)} ${n(page.height)}" role="img" aria-labelledby="cs-title cs-desc">`);
  out.push(`<title id="cs-title">${xml(`${model.title} — ${model.kicker}`)}</title>`);
  out.push(`<desc id="cs-desc">${xml(`The shape of project-atlas — what your markdown becomes and which command does it — and all ${model.groups.reduce((a, g) => a + g.rows.length, 0)} commands, grouped by intent. Generated from the command surface by scripts/gen-cheatsheet.mjs.`)}</desc>`);
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
    } else if (o.op === 'poly') {
      out.push(`<polygon points="${o.pts.map(([px, py]) => `${n(px)},${n(py)}`).join(' ')}" fill="${o.fill}"/>`);
    } else if (o.op === 'mark') {
      const { s, tx, ty } = markPlacement(o.x, o.y, o.size);
      const parts = MARK_SHAPES.map(({ tag, attrs }) => {
        const a = Object.entries(attrs)
          .map(([k, v]) => `${k}="${xml(markColour(v, o.colours))}"`)
          .join(' ');
        return `<${tag} ${a}/>`;
      });
      out.push(`<g transform="translate(${n(tx)} ${n(ty)}) scale(${n4(s)})">${parts.join('')}</g>`);
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
 * One SVG path `d` attribute as PDF path operators, in the path's own coordinate system.
 *
 * Only the four commands the mark actually uses, all absolute, and anything else throws. A partial path
 * silently drawn is a logo with a side missing, and nobody would notice until it was printed.
 */
function pdfPath(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let cmd = null;
  const next = () => {
    const v = Number(tokens[i]);
    if (!Number.isFinite(v)) throw new Error(`the mark's path data has a non-number where a coordinate belongs: ${tokens[i]}`);
    i += 1;
    return v;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    if (cmd === 'Z' || cmd === 'z') { out.push('h'); cmd = null; continue; }
    if (cmd === 'M') { out.push(`${n4(next())} ${n4(next())} m`); cmd = 'L'; }
    else if (cmd === 'L') out.push(`${n4(next())} ${n4(next())} l`);
    else if (cmd === 'C') out.push(`${n4(next())} ${n4(next())} ${n4(next())} ${n4(next())} ${n4(next())} ${n4(next())} c`);
    else throw new Error(`the mark uses SVG path command "${cmd}", which cheatsheet.mjs cannot write as PDF — add it to pdfPath()`);
  }
  return out;
}

/** A circle as four cubic segments, because PDF has no circle operator. */
function pdfCircle(cx, cy, r) {
  const k = r * 0.5522847498307936;
  return [
    `${n4(cx + r)} ${n4(cy)} m`,
    `${n4(cx + r)} ${n4(cy + k)} ${n4(cx + k)} ${n4(cy + r)} ${n4(cx)} ${n4(cy + r)} c`,
    `${n4(cx - k)} ${n4(cy + r)} ${n4(cx - r)} ${n4(cy + k)} ${n4(cx - r)} ${n4(cy)} c`,
    `${n4(cx - r)} ${n4(cy - k)} ${n4(cx - k)} ${n4(cy - r)} ${n4(cx)} ${n4(cy - r)} c`,
    `${n4(cx + k)} ${n4(cy - r)} ${n4(cx + r)} ${n4(cy - k)} ${n4(cx + r)} ${n4(cy)} c`,
    'h',
  ];
}

/**
 * The mark, in PDF operators.
 *
 * The `cm` matrix carries both the placement and the y-flip, so the path data goes in exactly as `render.mjs`
 * wrote it — a coordinate transcribed by hand is a coordinate that can be transcribed wrong. Line width is
 * scaled by the same matrix, which is what keeps the contour the right weight at any size.
 */
function pdfMark(o, pageHeight) {
  // `markPlacement` gives the SVG transform `translate(tx ty) scale(s)`, under which a mark-space point
  // (px, py) lands at (tx + s·px, ty + s·py) measured down from the top. PDF measures up, so the same
  // placement is the matrix [s 0 0 −s tx (H − ty)] — one `cm`, and the path data goes in untouched.
  const { s, tx, ty } = markPlacement(o.x, o.y, o.size);
  const out = ['q', `${n4(s)} 0 0 ${n4(-s)} ${n4(tx)} ${n4(pageHeight - ty)} cm`, '1 J 1 j'];
  for (const { tag, attrs } of MARK_SHAPES) {
    const stroke = attrs.stroke && attrs.stroke !== 'none' ? markColour(attrs.stroke, o.colours) : null;
    const fill = attrs.fill && attrs.fill !== 'none' ? markColour(attrs.fill, o.colours) : null;
    if (stroke) out.push(`${rgb(stroke)} RG`, `${n4(Number(attrs['stroke-width'] || 1))} w`);
    if (fill) out.push(`${rgb(fill)} rg`);
    out.push(...(tag === 'circle'
      ? pdfCircle(Number(attrs.cx), Number(attrs.cy), Number(attrs.r))
      : pdfPath(attrs.d)));
    out.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  }
  out.push('Q');
  return out;
}

/** One page's content stream. */
function pdfContent(page) {
  const c = [];
  c.push(`${rgb(page.background)} rg 0 0 ${n(page.width)} ${n(page.height)} re f`);
  const flip = (y) => page.height - y;
  for (const o of page.ops) {
    if (o.op === 'rect') {
      c.push(`${rgb(o.fill)} rg ${n(o.x)} ${n(flip(o.y + o.h))} ${n(o.w)} ${n(o.h)} re f`);
    } else if (o.op === 'frame') {
      const h = o.weight / 2;
      c.push(`${rgb(o.color)} RG ${n(o.weight)} w ${n(o.x + h)} ${n(flip(o.y + o.h) + h)} ${n(o.w - o.weight)} ${n(o.h - o.weight)} re S`);
    } else if (o.op === 'poly') {
      const [[x0, y0], ...rest] = o.pts;
      c.push(`${rgb(o.fill)} rg ${n(x0)} ${n(flip(y0))} m ${rest.map(([px, py]) => `${n(px)} ${n(flip(py))} l`).join(' ')} f`);
    } else if (o.op === 'mark') {
      c.push(...pdfMark(o, page.height));
    } else {
      c.push(`BT ${rgb(o.fill)} rg ${PDF_FONT[o.face]} ${n(o.size)} Tf 1 0 0 1 ${n(o.x)} ${n(flip(o.y))} Tm ${pdfString(o.s)} Tj ET`);
    }
  }
  return c.join('\n');
}

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
 *
 * **The object numbering is computed, not written down.** It used to be seven fixed objects; it is now two
 * per page plus five, and the xref that indexes them is walked entry by entry in `tests/run.mjs`. A
 * hand-written PDF fails silently or not at all, so the arithmetic is done once, here, in terms of
 * `pages.length`.
 */
export function toPDF(pages) {
  const P = pages.length;
  const first = 3;                 // 1 catalog, 2 page tree, then one /Page each
  const contents = first + P;      // then one content stream each
  const fonts = contents + P;      // then Helvetica, Helvetica-Bold, Courier

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${first + i} 0 R`).join(' ')}] /Count ${P} >>`,
    ...pages.map((p, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] `
      + `/Resources << /Font << /F1 ${fonts} 0 R /F2 ${fonts + 1} 0 R /F3 ${fonts + 2} 0 R >> >> `
      + `/Contents ${contents + i} 0 R >>`),
    ...pages.map((p) => {
      const stream = pdfContent(p);
      return `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    }),
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
  const [svgPage] = layout(model, SCREEN, DARK);
  const pdfPages = layout(model, PRINT, LIGHT);
  return { model, svg: Buffer.from(toSVG(svgPage, model), 'utf8'), pdf: toPDF(pdfPages), pages: pdfPages.length };
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
