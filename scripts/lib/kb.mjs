/**
 * project-atlas · the agent knowledge base, in markdown
 *
 * ## The gap this closes
 *
 * Every build writes HTML. On the corpus this was measured against — 403 source documents, 417 generated
 * files — an agent holding nothing but `Read` and `Grep` could open all 403 sources and reach **none** of the
 * analysis: the taxonomy, the link graph, backlinks, citation resolution, the health findings, the plan
 * cross-reference, the design record, the operational memory. All of it existed only as rendered HTML or
 * behind `atlas mcp`, and that repository has no `.mcp.json`, so the second channel was not available
 * either. The tool's entire output was addressed to a browser, in a workflow where nobody opens one.
 *
 * So this writes the derived layer a second time, as markdown, for the reader that has no browser and no
 * server. It is two things stacked:
 *
 *  - **A relationship graph.** One node page per document, carrying what the index computed about it —
 *    cluster, structure, links out, backlinks, code citations and whether they resolve, findings, the plan
 *    items that name it — with working relative links in every direction.
 *  - **An orientation layer over that graph.** An agent that arrives knowing nothing should be able to
 *    answer *what is this*, *how is it built*, *what rules apply here*, *where do I read about X*, *what is
 *    broken*, and *where did the last session get to* — by reading files, in order, from one entry point.
 *
 * ## The rule that makes this safe, and the one way it could go wrong
 *
 * **No document prose is written here. Not one sentence.**
 *
 * The founding rule (`skills/build/SKILL.md`) is that the markdown files are the source of truth and
 * the derived layer owns no prose that is not itself a committed `.md` file. HTML got away with carrying
 * rendered copies because nobody mistakes a generated page for the source. **A second set of markdown files
 * holding the same sentences is precisely the fork this project exists to detect** — an agent would grep,
 * find two copies of a paragraph, and have no way to tell which is authoritative. That is not a regression
 * in a feature; it is the tool defeating its own premise.
 *
 * The orientation layer makes that rule *harder to keep and more important to keep*, because the obvious way
 * to write "what is this project" is to write it. So the division is absolute and it is what makes the
 * orientation tractable at all:
 *
 *   **Navigation, classification, provenance and derived facts are generated. Every explanation is a link.**
 *
 * A page here may say *"style is governed by `docs/design/MANUAL-OF-STYLE.md`; it is currently a scaffold
 * with no substance in it; 0 documents cite it; last touched 2026-08-09"* — four derived facts and a route.
 * It may not say what the style *is*. Copying that document's rules here creates the fork; pointing at it
 * does not.
 *
 * The line, stated so it can be checked rather than trusted: a field may be emitted only if it is a path, an
 * identifier, a count, a date, a git subject, a configured label, **a heading, or a title**. Headings and
 * titles are the document's own structure and are what makes a node page navigable. Everything below the
 * structure line is refused — `excerpt` above all, which is a paragraph of the body and is the single field
 * most likely to be added here by someone doing the obvious thing. It is read nowhere in this file, not even
 * from `blueprint()`, which offers it. A test asserts that no document's body text appears anywhere in the
 * tree.
 *
 * ## What this deliberately does not carry
 *
 * **Journal record text.** `.atlas/journal/*.jsonl` is an operational log that is never published, enforced
 * by `journal.mjs::assertUnpublished`. This tree *is* written into the publishable output directory, so it
 * carries counts, kinds, timespans, contributors, agents and refs — and no record's `text` or `why`. The
 * decisions panel in dashboard.mjs already drew that line ("the journal is read for arithmetic only");
 * this follows it. If you are about to write a record's text onto a KB page, stop.
 *
 * **A handoff.** `HANDOFF.md` is written by a person, or proposed by an agent into a diff somebody reads.
 * `atlas handoff` prints a *prompt* and deliberately does not write the file, because a machine can see that
 * a commit happened and cannot see that a decision was argued and settled. This routes to handoffs and
 * reports how stale each one is; it never authors one.
 *
 * **Working-tree state.** No uncommitted-file count, no in-flight list. The same argument render.mjs makes
 * about the clock: a number baked into a file is wrong within a second of being written and stays wrong for
 * as long as the file is read, and a frozen measurement presented as current is the failure this whole
 * surface exists to remove. The resume page names `atlas state` and `atlas branch` as the live reading.
 *
 * ## Its relationship to `atlas prompt`
 *
 * `prompt.mjs` already solves the neighbouring problem — orienting an assistant from derived material — and
 * it is not duplicated here, it is **reused**. `kb/rules.md` embeds `buildPrompt()` verbatim. Writing a
 * second generator of the same rules would be the fork one layer up, in the module whose header complains
 * about forks.
 *
 * Where the KB differs is the half `buildPrompt` deliberately refuses: it emits the machine-checkable rules
 * and no routing, because a system prompt is injected into a session that can already read the repository.
 * A reader of the KB may not know the repository exists. So `rules.md` wraps the generated prompt in routes
 * to the *hand-written* rule documents — the manual of style, the decision records, the procedures — with
 * their state, their owner, and whether health has anything to say about them.
 *
 * ## Determinism
 *
 * Byte-identical on rebuild with no source change, same as the site. Every list is sorted on a stable key,
 * `new Date()` is never called, and the only timestamps are ones git or an existing record reported. The
 * tree is regenerable or it is a second store, and a second store is the thing being refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNALS } from './signals.mjs';
import { blueprint, designRecord, undesigned, summariseDesign, isDesignDoc } from './design.mjs';
import { areaOf } from './ownership.mjs';
import { buildPrompt } from './prompt.mjs';
import { read as readJournal, KINDS } from './journal.mjs';
import { handoffsIn, handoffAge, sharedPath, DEFAULT_STALE_AFTER } from './handoff.mjs';
import { readObligations, DEFAULT_SOP_MATCH } from './sop.mjs';
import { matchesAny } from './config.mjs';
import { detectHost } from './host.mjs';

/** The subdirectory of the build output this tree owns. Cleared with everything else by `prepareOutputDir`. */
export const KB_DIR = 'kb';

/**
 * The banner every generated file carries, in an HTML comment so it survives rendering anywhere and is
 * greppable everywhere. It exists for the reader who arrived by `grep` and has no idea which of the two
 * markdown trees they landed in — which, on a repository with 400 documents, is most readers.
 */
const STAMP = '<!-- project-atlas: derived, regenerated by `atlas build`. Do not edit. The source .md files are authoritative. -->';

/* ------------------------------------------------------------------ text helpers */

/**
 * A path inside a code span. Not decoration — a path is the one thing on these pages an agent will copy
 * verbatim into a `Read`, so it must survive intact even when it contains markdown syntax. The fence widens
 * rather than escaping, because a backtick inside a path is a legal byte and mangling it would hand back a
 * path that does not exist.
 */
function code(value) {
  const s = String(value);
  if (!s.includes('`')) return '`' + s + '`';
  let fence = '``';
  while (s.includes(fence)) fence += '`';
  return `${fence} ${s} ${fence}`;
}

/**
 * A link destination.
 *
 * **A repository path is untrusted data here, exactly as it was in `render-shared.mjs`.** That module learned
 * it the expensive way: a filename was interpolated into an `href`, the filename contained a quote, and a
 * committed document could put live markup into five generated pages. The markdown equivalent is cheaper but
 * the same shape — a `)` in a filename terminates the destination early and the rest of the path becomes
 * body text, so the link silently points somewhere else.
 *
 * Angle-bracket destinations are the CommonMark answer and cover spaces, parentheses and quotes. The two
 * bytes they cannot carry are `<` and `>` themselves, so those are percent-encoded; every caller also prints
 * the raw path in a code span beside the link, so the true path stays readable even when the destination had
 * to be spelled differently.
 *
 * They are used only where they are needed. Wrapping every ordinary path — which is nearly all of them —
 * would put two characters of noise in front of the one string on the page an agent is going to act on, to
 * defend against a filename that almost never occurs. Escaping is a cost, so it is paid where the risk is.
 */
const PLAIN_DEST = /^[A-Za-z0-9._~/#?&=:@+,;$!*'-]+$/;

function dest(target) {
  const s = String(target);
  if (PLAIN_DEST.test(s)) return s;
  return '<' + s.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '%0A') + '>';
}

/** Link text. `[` and `]` end the label early; a title carrying either would swallow the destination. */
function label(text) {
  return String(text == null ? '' : text).replace(/([[\]])/g, '\\$1').replace(/\s*\n\s*/g, ' ').trim();
}

function link(text, target) {
  return `[${label(text)}](${dest(target)})`;
}

/** A table cell. Pipes and newlines are the two bytes that end a cell, and both occur in real git subjects. */
function cell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Signal ids in the order a reader expects. Plain `.sort()` puts H15 between H1 and H2, which reads as a
 * mis-sorted list rather than as a deliberate order and makes a row of ids hard to scan against the
 * catalogue. Numeric collation is the one place in this file where the sort key is not the raw string.
 */
const sigList = (ids) => [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })).join(', ');

/* ------------------------------------------------------------------ the prose guard */

/**
 * `status`, `version`, `dateField` and an SOP's declared `owner` are the fields that are **scraped out of a
 * document body**, and they are the one hole in the no-prose rule.
 *
 * `scan.mjs::fieldValue` matches `^**Label:**? (.+)$` case-insensitively and keeps up to 160 characters. It
 * is deliberately loose because specification documents write their headers a dozen ways — and on the first
 * build of this tree it did exactly what a loose pattern does. `docs/references/authoring.md` contains the
 * sentence *"**Date every page, and re-stamp when you revise.** An undated page is a page that will be
 * trusted after it…"*, the `Date` label matched it, and a hundred and ten characters of that document's
 * advice was copied verbatim onto its node page as its date. **One line of body text in the derived markdown
 * is the fork this whole tree is built to avoid**, arriving through the one field nobody would suspect.
 *
 * So a value is quoted only when it has the *shape of the thing it claims to be*, and a value that fails is
 * reported as unquotable rather than dropped: the field is present in the document, this could not read it,
 * and the reader is sent to the source. Nothing is silently discarded, and nothing unverified is printed.
 */
const SHAPES = {
  // A year is the one token every real date carries, in every format anyone writes. "never", "unknown" and
  // "TBD" are the honest non-answers a scaffold gives and are worth keeping.
  date: (s) => s.length <= 40 && (/\b(19|20)\d{2}\b/.test(s) || /^_?(never|unknown|tbd|n\/a)_?$/i.test(s)),
  version: (s) => /^v?\d[\w.+-]*$/i.test(s),
  // A status or an owner is a label. A full stop followed by a capital is a second sentence, which means the
  // pattern ran past the end of the field and into the document.
  status: (s) => s.length <= 60 && !/[.!?]\s+[A-Z]/.test(s),
  owner: (s) => s.length <= 60 && !/[.!?]\s+[A-Z]/.test(s),
};

/** The guarded value, or the honest refusal. Never a blank, which would read as "no such field". */
function quoted(value, kind) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim();
  if (SHAPES[kind](s)) return cell(s);
  return `**present but not quoted** — what was scraped for this field is not ${kind === 'date' ? 'a date' : 'a ' + kind}, `
    + 'so the pattern ran into the document\'s text. Read the source.';
}

function fieldRow(name, value, kind) {
  const v = quoted(value, kind);
  return v === null ? null : `| ${name} | ${v} |`;
}

/* ------------------------------------------------------------------ layout */

/**
 * Where each generated file sits, relative to the output directory, and how to link between them.
 *
 * Every link is computed with `path.posix.relative` from one file's directory to the target, because **the
 * reader is an agent running `Read` from the repository root, not a browser resolving an `href` against a
 * base URL.** A root-relative path would be correct in a served site and wrong in the only workflow this
 * tree exists for. The output directory is configurable, so its depth below the root is not a constant and
 * cannot be hardcoded — `docs/_wiki` gives four levels up from `kb/nodes/`, a configured `site` gives three.
 */
function layout(root, outDir) {
  const outRel = path.relative(root, outDir).split(path.sep).join('/');
  return (fileRel) => {
    const dir = path.posix.dirname(path.posix.join(outRel, fileRel));
    return {
      /** …to a file in the repository, addressed from the repository root. */
      repo: (p) => path.posix.relative(dir, String(p).split(path.sep).join('/')) || '.',
      /** …to another page in this tree, addressed by its path under the output directory. */
      kb: (p) => path.posix.relative(dir, path.posix.join(outRel, KB_DIR, p)) || '.',
    };
  };
}

/**
 * One filename per document, derived from the name the HTML page already uses.
 *
 * Reusing `nameFor` rather than inventing a second scheme buys two things. The collision handling is already
 * correct — `render-shared.mjs` records that `docs/a/b.md` and `docs/a__b.md` both flattened to one name and
 * the second write won silently — and a document's node page is now its HTML page with one extension
 * changed, so anything holding one name can find the other without a lookup table.
 */
const nodeFile = (nameFor, p) => `nodes/${nameFor(p).replace(/\.html$/i, '.md')}`;

/**
 * One filename per cluster.
 *
 * A cluster id is a configured string, not a validated identifier, so it is reduced to the character set a
 * page name uses — and reduction is lossy, which is the whole reason for the `used` set. Ids of `a/b` and
 * `a-b` both reduce to `a-b`, and the second write would take the first cluster's page with it. `pageNames`
 * exists in render-shared.mjs because that had already happened once for documents; this is the same defect
 * one layer up, resolved the same way rather than left to the assumption that config authors are careful.
 */
function clusterFiles(clusters) {
  const out = new Map();
  const used = new Set();
  for (const c of clusters) {
    const base = String(c.id).replace(/[^A-Za-z0-9.-]/g, '-') || 'cluster';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    out.set(c.id, `clusters/${name}.md`);
  }
  return out;
}

/**
 * The version of the tool that wrote this, read the same way `atlas.mjs::runningBuild` reads it.
 *
 * Read here rather than passed in from the CLI because `renderSite` is called by the test suite and by
 * `atlas watch` as well as by `atlas build`, and a parameter that three of four callers forget is a field
 * that says "unknown" for no reason the reader can see. Importing `atlas.mjs` to borrow the function would
 * pull the entire command-line surface into every build.
 */
function toolVersion() {
  try {
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    return JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version || 'unknown';
  } catch { return 'unknown'; }
}

/* ------------------------------------------------------------------ the tree */

/**
 * Write the knowledge base. Returns what was written, so the caller can report a count it *observed* rather
 * than one it predicted from the index — the same rule `renderSite` follows for its page count, and for the
 * same reason: a count taken from the input cannot notice two documents landing on one file.
 */
export function writeKnowledgeGraph({ outDir, root, index, health, cfg, plan, coverage, codeFiles, nameFor }) {
  const dir = path.join(outDir, KB_DIR);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'clusters'), { recursive: true });

  const at = layout(root, outDir);
  const written = new Set();
  const write = (rel, body) => {
    fs.writeFileSync(path.join(dir, rel), body, 'utf8');
    written.add(rel);
  };

  const byPath = new Map(index.documents.map((d) => [d.path, d]));

  // Findings per document, indexed once. `health.findings` is read by every page below, and a filter per
  // document turns a 400-document corpus into 400 passes over a list that is often longer than the corpus.
  const findingsFor = new Map();
  for (const f of health.findings) {
    if (f.suppressed) continue;
    if (!findingsFor.has(f.doc)) findingsFor.set(f.doc, []);
    findingsFor.get(f.doc).push(f);
  }

  // Which plan items name a document as their specification. `readPlanning` already resolved these out of
  // each item's own prose — the edge existed in the data and was only ever rendered one way round, so a
  // document could never answer "what work claims to be specified by me".
  const planFor = new Map();
  for (const it of plan?.items || []) {
    for (const s of it.sources || []) {
      if (!planFor.has(s.path)) planFor.set(s.path, []);
      planFor.get(s.path).push(it);
    }
  }

  // The reverse citation index: code file → the documents that cite it. Every other surface in this tool
  // reads citations forwards, from the document. Backwards is the direction an agent about to change a file
  // actually needs, and nothing computed it.
  const citedBy = new Map();
  for (const d of index.documents) {
    for (const c of d.citations || []) {
      if (typeof c.resolved !== 'string') continue;      // unresolved and ambiguous are not evidence of coverage
      if (!citedBy.has(c.resolved)) citedBy.set(c.resolved, new Set());
      citedBy.get(c.resolved).add(d.path);
    }
  }

  const covById = new Map((coverage?.rows || []).map((r) => [r.id, r]));
  const clusterOf = clusterFiles(index.clusters);
  const ctx = { root, cfg, index, health, plan, byPath, findingsFor, planFor, citedBy, covById, clusterOf, nameFor, codeFiles };

  for (const d of index.documents) {
    const rel = nodeFile(nameFor, d.path);
    write(rel, nodePage(d, { ...ctx, at: at(path.posix.join(KB_DIR, rel)) }));
  }
  for (const c of index.clusters) {
    const rel = clusterOf.get(c.id);
    write(rel, clusterPage(c, { ...ctx, at: at(path.posix.join(KB_DIR, rel)) }));
  }

  const page = (rel, fn) => write(rel, fn({ ...ctx, at: at(path.posix.join(KB_DIR, rel)) }));
  page('health.md', healthPage);
  page('plan.md', planPage);
  page('architecture.md', architecturePage);
  page('rules.md', rulesPage);
  page('routes.md', routesPage);
  page('vocabulary.md', vocabularyPage);
  page('resume.md', resumePage);
  page('README.md', entryPage);

  return { dir, files: written.size };
}

/* ------------------------------------------------------------------ shared furniture */

/** The footer every page carries, so no page is a dead end. */
function footer(at, extra = []) {
  return ['', '---', '', ['Entry point: ' + link('kb/README.md', at.kb('README.md')), ...extra].join(' · ')];
}

/** A route row: a document, with the derived facts that make choosing between two of them possible. */
function routeRow(d, { at, findingsFor, citedBy, nameFor }) {
  const f = findingsFor.get(d.path) || [];
  const cites = (d.citations || []).length;
  return `| ${cell(link(d.title || d.path, at.repo(d.path)))} | ${cell(code(d.path))} | `
    + `${cell(d.git ? d.git.date : 'unknown')} | ${d.backlinks.length} | ${cites} | `
    + `${f.length}${f.some((x) => x.blocking) ? ' (blocking)' : ''} | `
    + `${cell(link('node', at.kb(nodeFile(nameFor, d.path))))} |`;
}

const ROUTE_HEAD = ['| Document | Path | Last touched | Linked from | Cites code | Findings | Node |',
  '|---|---|---|---|---|---|---|'];

/* ------------------------------------------------------------------ entry point */

/**
 * The file an agent reads first, and the only one whose location has to be known in advance.
 *
 * It leads with what this tree is *not*, because the expensive mistake is not failing to find it — it is
 * finding it, believing it, and editing it. Then a routing table by intent, because an agent arrives with a
 * task rather than with a curiosity about the documentation system, and an index sorted by directory answers
 * a question nobody asked.
 */
function entryPage(c) {
  const { index, health, plan, cfg, at, findingsFor, clusterOf, nameFor, byPath } = c;
  const L = [];
  L.push(`# ${label(index.siteTitle)} — agent knowledge base`, '', STAMP, '');

  L.push('**Derived, and deleted and rewritten by every `atlas build`.** This is not documentation. It carries',
    'the *relationships and derived facts* the tool computed — taxonomy, link graph, backlinks, code',
    'citations and whether they resolve, health, the design record, the plan, the operational trail — and it',
    'routes to the markdown that is the source of truth.', '');
  L.push('**Every explanation here is a link.** Titles and headings appear because they are structure; no',
    'paragraph, list item, table cell or code block from any document does. To learn what something *is*,',
    'follow the route and read the document. Two markdown files holding the same sentences is the',
    'forked-document failure this tool exists to detect, and it would not be excused by one of them being',
    'generated.', '');

  L.push('## Where to go, by what you are doing', '');
  L.push('| You need to… | Read |', '|---|---|');
  // No link on this row, deliberately: the answer is the **Start here** table two sections down, and a
  // self-link to this same file reads as a routing loop — the one thing an entry point must not do.
  L.push('| Know what this project is | the **Start here** table below, then the documents in it. Nothing here summarises them |');
  L.push(`| Understand how it is built | ${cell(link('architecture.md', at.kb('architecture.md')))} — the design record in dependency order, and what it does not cover |`);
  L.push(`| Know the rules you must follow | ${cell(link('rules.md', at.kb('rules.md')))} — what blocks a commit, the branch convention, and the documents that govern style and procedure |`);
  L.push(`| Find what documents a piece of code | ${cell(link('routes.md', at.kb('routes.md')))} — the reverse citation index, by area and by file |`);
  L.push(`| Find what this repository calls something | ${cell(link('vocabulary.md', at.kb('vocabulary.md')))} — every document title and section heading, alphabetised |`);
  L.push(`| Know what is broken | ${cell(link('health.md', at.kb('health.md')))} — every finding, grouped by signal |`);
  L.push(`| Know what is planned, and what is claimed done | ${cell(link('plan.md', at.kb('plan.md')))} |`);
  L.push(`| Resume with no context | ${cell(link('resume.md', at.kb('resume.md')))} — the memory trail, handoffs, and how stale each is |`);
  L.push(`| Know everything about one document | its node page, linked from every cluster and every finding |`);
  L.push('');

  // "What is this project" is answered by a document, never by this page. The entry cluster is the taxonomy's
  // own answer to which document that is; `render.mjs::lede` quotes its excerpt onto the homepage, and this
  // deliberately does not — a paragraph copied here is the fork, and the route costs the reader one Read.
  const entry = index.clusters.find((cl) => cl.id === 'start') || index.clusters[0];
  L.push('## Start here', '');
  if (entry && entry.documents.length) {
    L.push(`The taxonomy puts ${entry.documents.length} document(s) in **${label(entry.title)}**. Read them in this`,
      'order — nothing here summarises them, because a summary of a document that sits next to the document is',
      'the second copy this tree refuses to hold.', '');
    L.push(...ROUTE_HEAD);
    for (const p of entry.documents) {
      const d = byPath.get(p);
      if (d) L.push(routeRow(d, c));
    }
    L.push('');
  } else {
    L.push('**No entry document.** No cluster is configured as `start` and the taxonomy is empty, so this',
      'repository has no document that introduces itself. A hand-written `docs/README.md` is worth more than',
      'the whole of the rest of this tree.', '');
  }

  L.push('## Counts', '');
  L.push('| Measure | Value |', '|---|---|');
  L.push(`| Documents indexed | ${index.stats.documents} |`);
  L.push(`| Clusters | ${index.stats.clusters} |`);
  L.push(`| Internal links | ${index.stats.links} |`);
  L.push(`| Code citations | ${index.stats.citations} |`);
  L.push(`| Blocking findings | ${health.blockingCount} |`);
  L.push(`| Findings, all signals | ${health.findings.filter((f) => !f.suppressed).length} |`);
  if (health.suppressed) L.push(`| Suppressed by configuration | ${health.suppressed} |`);
  if (plan && !plan.missing) L.push(`| Plan items | ${plan.stats.total} |`);
  L.push('');

  L.push('## The taxonomy', '');
  L.push('| Cluster | Documents | Findings |', '|---|---|---|');
  for (const cl of index.clusters) {
    const n = cl.documents.reduce((sum, p) => sum + (findingsFor.get(p) || []).length, 0);
    L.push(`| ${cell(link(cl.title, at.kb(clusterOf.get(cl.id))))} | ${cl.documents.length} | ${n} |`);
  }
  L.push('');

  // A document the taxonomy placed nowhere is a document no cluster page lists, and therefore a node page
  // nothing links to — an orphan created by the graph itself rather than by the corpus. It only happens with
  // `fallbackCluster: null`, which the configuration reference offers deliberately, so the case is listed
  // rather than assumed away.
  const clustered = new Set(index.clusters.flatMap((cl) => cl.documents));
  const stray = index.documents.filter((d) => !clustered.has(d.path));
  if (stray.length) {
    L.push('## In no cluster', '');
    L.push(`${stray.length} document(s) matched no cluster rule, and \`fallbackCluster\` is off. Listed here so`,
      'that every node page is reachable from this file.', '');
    for (const d of stray) L.push(`- ${link(d.title || d.path, at.kb(nodeFile(nameFor, d.path)))} — ${code(d.path)}`);
    L.push('');
  }

  L.push('## What is deliberately not here', '');
  L.push('- **Document prose.** Every explanation is a link, for the reason at the top of this page.',
    '- **Journal record text.** The operational log is never published; this tree is written into a',
    `  publishable directory, so ${link('resume.md', at.kb('resume.md'))} carries counts, kinds, timespans and`,
    '  refs, and no record\'s words.',
    '- **Working-tree state.** No uncommitted count, no in-flight list. A measurement baked into a file is',
    '  wrong within a second of being written and stays wrong for as long as the file is read. Run `atlas',
    '  state` or `atlas branch` for the live reading.',
    '- **Anything the tool did not compute.** Where the corpus has a hole, the page names the hole. An',
    '  orientation page that implies coverage the repository does not have is worse than one that states the',
    '  gap, because it will be believed.', '');

  L.push('## Layout', '');
  L.push(`- \`${KB_DIR}/README.md\` — this file.`,
    `- \`${KB_DIR}/architecture.md\`, \`rules.md\`, \`routes.md\`, \`vocabulary.md\`, \`health.md\`, \`plan.md\`, \`resume.md\` — the orientation layer.`,
    `- \`${KB_DIR}/clusters/<id>.md\` — one per cluster.`,
    `- \`${KB_DIR}/nodes/<flattened-path>.md\` — one per indexed document. The filename is the document's path`,
    "  with `/` replaced by `__`, so it is the HTML page's name with a different extension.", '');
  L.push('No link in this tree carries a `#fragment`. An agent reads whole files, and heading anchors are',
    'slugged differently by every renderer — a fragment would be a promise this tree cannot keep. Where a',
    'position inside a file matters it is given as a line number instead.', '');
  L.push(`Output directory: ${code(cfg.output)}. Regenerate with \`atlas build\`. Written by project-atlas ${toolVersion()}.`);
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ architecture */

/**
 * How the project is built, assembled from the design record rather than described.
 *
 * `design.mjs::blueprint` already orders the expected artifacts by dependency — intent, requirements,
 * orientation, shape, flow, detail, reasoning, house style — and already distinguishes *written* from
 * *scaffolded* from *absent*. That third state is the reason this page is worth generating: a section
 * quietly missing from a blueprint reads as a section that does not need to exist, and a scaffold counted as
 * a design document is a false presence that every other check then measures drift against.
 *
 * `blueprint()` offers an `excerpt` per document. It is not read here. On the HTML page it is the document's
 * own account of the system and is quoted deliberately; in markdown it is the fork.
 */
function architecturePage(c) {
  const { index, at, findingsFor, citedBy, nameFor, byPath, codeFiles } = c;
  const L = [];
  L.push('# How this project is built', '', STAMP, '');
  L.push('The design record, in dependency order — intent, then requirements, then orientation, then shape,',
    'then what moves through it, then detail, then reasoning and house style. Assembled from the documents',
    'themselves; the only thing generated here is the order, the state and the counts.', '');

  const sections = blueprint(index.documents);
  const record = designRecord(index.documents);
  // The design record's own claim is about *design* documents, so that is what the coverage is measured
  // against here — the same set H16 uses. routes.md asks the weaker and more useful question, "does any
  // document at all cite this area", and says so under its own heading. Mixing the two would put a sentence
  // about design coverage above a table measuring something else.
  const designDocs = index.documents.filter((d) => isDesignDoc(d.path));
  const gaps = codeFiles ? undesigned(codeFiles, designDocs) : null;
  L.push(`> ${label(summariseDesign(record, gaps || []))}`, '');
  L.push('**Three states, and the third is why this page is generated.** *Written* is a design document.',
    '*Scaffold* is a file that names the questions it owes an answer to and has not answered them — reported',
    'as owed, never counted as present, because a false presence is what every other check then measures',
    'drift against. *Absent* is named rather than skipped: a section quietly missing from a blueprint reads',
    'as a section nobody needs.', '');

  for (const s of sections) {
    L.push(`## ${label(s.label)}`, '');
    if (s.state === 'absent') {
      // An absence is the most valuable line on this page and the easiest one to omit. Named, with the
      // command that closes it — `atlas design --scaffold` writes the questions the artifact owes an answer
      // to and never the answers, which is the only version of "generate a design document" that is safe.
      L.push('**Absent.** Nothing in the corpus is this artifact.',
        'Run `atlas design --scaffold` to write the questions it owes an answer to — it never writes the answers.', '');
      continue;
    }
    for (const doc of s.documents) {
      const d = byPath.get(doc.path);
      const f = findingsFor.get(doc.path) || [];
      // A heading per document only when there is more than one, because with a single document it repeats
      // the section heading word for word — `## Product requirements` followed by `### Product requirements`.
      if (s.documents.length > 1) L.push(`### ${label(doc.title)}`, '');
      L.push(`- State: ${doc.stub ? '**scaffold — the substance is owed**' : 'written'}`);
      L.push(`- Source: ${link(doc.path, at.repo(doc.path))} — ${code(doc.path)}`);
      L.push(`- Node page: ${link('all derived facts about it', at.kb(nodeFile(nameFor, doc.path)))}`);
      L.push(`- Last touched: ${doc.date || 'unknown — no git history for this path'}`);
      // Citation health is the measure of whether a design document still describes the code. A design
      // document that cites nothing cannot go stale against anything, which is worth saying rather than
      // scoring — it is not a fault, it is a different kind of document.
      L.push(doc.citations.total
        ? `- Grounding: cites ${doc.citations.total} code location(s) — ${doc.citations.resolved} resolve, `
          + `${doc.citations.broken} do not, ${doc.citations.unchecked} were not checked`
        : '- Grounding: **cites no code.** It cannot go stale against anything, and it cannot be verified against anything either.');
      if (f.length) L.push(`- Health: ${sigList(f.map((x) => x.signal))} — see ${link('health.md', at.kb('health.md'))}`);
      if (d?.backlinks?.length) L.push(`- Linked from ${d.backlinks.length} document(s)`);
      if (doc.sections.length) {
        L.push('', 'What it covers, from its own second-level headings'
          + (doc.stub ? ' — in a scaffold these are literally the questions it has not answered' : '') + ':', '');
        for (const sec of doc.sections) L.push(`  - ${label(sec.text)}`);
      }
      L.push('');
    }
  }

  // The inversion, and the only part of this page that finds something a reader was not already worried
  // about: which parts of the codebase the design record does not mention.
  L.push('## Code areas the design record does not cite', '');
  if (!gaps) {
    L.push('**Not evaluated.** The tracked file list could not be read (no git repository, or `--no-git`), so',
      'no area was checked for coverage. This is not a clean result.', '');
  } else {
    const bare = gaps.filter((g) => g.citations === 0);
    L.push('Coverage, not quality: an area with a design document may be described badly, and an area without',
      'one may be three files that need no design at all.', '');
    if (!bare.length) {
      L.push('Every area of two files or more is cited by at least one design document.', '');
    } else {
      L.push('| Area | Files | Design documents citing it |', '|---|---|---|');
      for (const g of bare) L.push(`| ${cell(code(g.area))} | ${g.files} | none |`);
      L.push('');
    }
    L.push(`Which documents cite which area, in full: ${link('routes.md', at.kb('routes.md'))}.`, '');
  }

  L.push(...footer(at, [`What is broken: ${link('health.md', at.kb('health.md'))}`,
    `Where to read about a file: ${link('routes.md', at.kb('routes.md'))}`]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ rules */

/**
 * The rules that apply here: the machine-checkable half generated, the judgement half routed to.
 *
 * The generated half is `buildPrompt()` verbatim — see the module header for why it is reused rather than
 * reimplemented. The routed half is what `buildPrompt` deliberately refuses to carry, and it is derived from
 * the artifacts that already recognise governance: the design record's manual of style, decision records and
 * specifications, and the SOP match, which is the tool's existing definition of "a document somebody
 * follows".
 */
function rulesPage(c) {
  const { root, cfg, index, health, plan, at, findingsFor, nameFor, byPath } = c;
  const L = [];
  L.push('# The rules that apply here', '', STAMP, '');
  L.push('Two halves, in this order. **First**, routes to the documents that carry the judgement — house',
    'style, decisions, specifications, procedures — none of which is quoted here, because judgement is what',
    'no tool can generate and a copy of it is the fork this tree refuses to hold. **Second**, the rules the',
    'tool itself checks, generated from this repository\'s configuration, plan and corpus: change a rule and',
    'that section changes with it.', '');

  L.push('## The documents that govern', '');
  const record = new Map(designRecord(index.documents).map((r) => [r.id, r]));
  const GOVERNING = [
    ['style', 'House style', 'How everything here is written. Read it before writing documentation.'],
    ['decisions', 'Decision records', 'What was settled, and what it rules out. Read before re-litigating a boundary.'],
    ['specs', 'Specifications', 'What the system is required to do.'],
    ['prd', 'Product requirements', 'What the product is for.'],
  ];
  for (const [id, heading, why] of GOVERNING) {
    const r = record.get(id);
    L.push(`### ${heading}`, '');
    // Stating the absence is the point. A rules page that lists only what exists tells an agent the rules are
    // complete, and a missing manual of style is exactly the gap that produces inconsistent documentation
    // nobody can name the cause of.
    if (!r || r.state === 'absent') {
      L.push(`${why}`, '', '**Absent from this corpus.** Nothing governs this in writing. `atlas design --scaffold`',
        'writes the questions such a document owes an answer to.', '');
      continue;
    }
    L.push(`${why}`, '');
    if (r.state === 'stub') {
      L.push('**A scaffold.** The questions are written down; the answers are not. Treat it as a gap, not as a rule.', '');
    }
    L.push(...ROUTE_HEAD);
    for (const p of r.documents) {
      const d = byPath.get(p);
      if (d) L.push(routeRow(d, c));
    }
    L.push('');
  }

  // Procedures. An SOP degrades into incorrect instructions somebody follows, which is why it carries
  // obligations no other document does — and why two of its three signals block. The declared owner and
  // review date are read off the document and pass through the same shape guard as every other scraped
  // field: `readObligations` is as loose as `fieldValue` and can run into the body the same way.
  const sopRules = cfg.sop?.match || DEFAULT_SOP_MATCH;
  const sops = index.documents.filter((d) => matchesAny(d.path, sopRules));
  L.push('### Procedures', '');
  if (!sops.length) {
    L.push('No document matches the SOP patterns (' + sopRules.map((r) => code(r)).join(', ') + '), so nothing',
      'here declares itself a procedure with an owner and a review interval.', '');
  } else {
    L.push('A procedure is followed rather than read, so it carries obligations no other document does.', '');
    L.push('| Procedure | Owner | Last verified | Findings | Node |', '|---|---|---|---|---|');
    for (const d of sops.sort((a, b) => a.path.localeCompare(b.path))) {
      const ob = readObligations(d.body);
      const f = findingsFor.get(d.path) || [];
      L.push(`| ${cell(link(d.title || d.path, at.repo(d.path)))} | ${quoted(ob.owner, 'owner') || '**none declared**'} | `
        + `${quoted(ob.lastVerified, 'date') || '**never**'} | ${f.length ? cell(sigList(f.map((x) => x.signal))) : '—'} | `
        + `${cell(link('node', at.kb(nodeFile(nameFor, d.path))))} |`);
    }
    L.push('');
  }

  L.push('## The rules the tool enforces', '');
  L.push('Generated by `atlas prompt` from this repository\'s configuration, plan and corpus. It is reproduced',
    'here rather than restated, because a second generator of the same rules is the fork this tree exists to',
    'avoid. Run `atlas prompt --out <file>` to write it somewhere a runtime loads it automatically.', '');
  L.push('');
  // The prompt owns its own heading levels, starting at H1. Nested under this page's H2 it would produce two
  // H1s in one file — harmless to an agent reading text, wrong for anything that builds a table of contents.
  // Demoted by one level rather than reformatted, so the generated text stays byte-identical to what
  // `atlas prompt` writes and the two can be diffed.
  const prompt = buildPrompt({
    cfg, index, health, plan,
    version: toolVersion(),
    slug: hostSlug(root, cfg),
  });
  L.push(prompt.replace(/^(#{1,5} )/gm, '#$1').trimEnd(), '');

  L.push(...footer(at, [`Design record: ${link('architecture.md', at.kb('architecture.md'))}`,
    `Current findings: ${link('health.md', at.kb('health.md'))}`]));
  return L.join('\n') + '\n';
}

/** owner/repo, or the directory name. Wrapped because a git failure must not take the build down. */
function hostSlug(root, cfg) {
  try { return detectHost(root, cfg).slug || path.basename(root); } catch { return path.basename(root); }
}

/* ------------------------------------------------------------------ routes */

/**
 * "I am about to change X — what documents describe it?"
 *
 * The reverse citation index. Every other surface reads citations forwards, from the document outwards; this
 * is the only one that reads them from the code back, which is the direction of the question an agent
 * actually has. It is derived entirely from citations that **resolved** — an unresolved or ambiguous
 * citation is not evidence that a document describes a file, and counting it would report coverage that does
 * not exist.
 */
function routesPage(c) {
  const { index, at, citedBy, nameFor, byPath, codeFiles } = c;
  const L = [];
  L.push('# Where to read about a part of this code', '', STAMP, '');
  L.push('Built by inverting the code citations in the corpus: a document that writes `path/to/file.ts:42` is',
    'a document that claims to describe that file. **Only citations that resolved are counted** — an',
    'unresolved or ambiguous citation is not evidence of coverage, and treating it as such would report',
    `documentation that does not exist. Broken ones are findings; see ${link('health.md', at.kb('health.md'))}.`, '');

  const areas = new Map();
  for (const [file, docs] of citedBy) {
    const key = areaOf(file, 2);
    if (!areas.has(key)) areas.set(key, { files: new Set(), docs: new Set() });
    areas.get(key).files.add(file);
    for (const d of docs) areas.get(key).docs.add(d);
  }

  L.push('## By area', '');
  if (!areas.size) {
    L.push('No citation in this corpus resolves to a file in the repository, so nothing can be routed by area.',
      'Documentation here does not cite code — which is a fact about the corpus, not about the code.', '');
  } else {
    L.push('| Area | Files cited | Documents that cite it |', '|---|---|---|');
    for (const [area, v] of [...areas.entries()].sort((a, b) => b[1].docs.size - a[1].docs.size || a[0].localeCompare(b[0]))) {
      const docs = [...v.docs].sort().map((p) => link(byPath.get(p)?.title || p, at.kb(nodeFile(nameFor, p)))).join(', ');
      L.push(`| ${cell(code(area))} | ${v.files.size} | ${cell(docs)} |`);
    }
    L.push('');
  }

  L.push('## By file', '');
  if (!citedBy.size) {
    L.push('Nothing to list.', '');
  } else {
    L.push('| Code file | Documented by | Citations |', '|---|---|---|');
    for (const file of [...citedBy.keys()].sort()) {
      const docs = [...citedBy.get(file)].sort();
      const n = index.documents.reduce((sum, d) => sum + (d.citations || []).filter((x) => x.resolved === file).length, 0);
      L.push(`| ${cell(code(file))} | ${cell(docs.map((p) => link(byPath.get(p)?.title || p, at.kb(nodeFile(nameFor, p)))).join(', '))} | ${n} |`);
    }
    L.push('');
  }

  L.push('## Code areas nothing documents', '');
  if (!codeFiles) {
    L.push('**Not evaluated.** The tracked file list could not be read (no git repository, or `--no-git`), so',
      'no area was checked. This is not a clean result.', '');
  } else {
    const bare = undesigned(codeFiles, index.documents.filter((d) => (d.citations || []).length)).filter((g) => g.citations === 0);
    if (!bare.length) L.push('None. Every area of two files or more is cited by at least one document.', '');
    else {
      L.push('Areas of two files or more that no document cites. Changing something here means changing',
        'something nothing describes.', '');
      L.push('| Area | Files |', '|---|---|');
      for (const g of bare) L.push(`| ${cell(code(g.area))} | ${g.files} |`);
      L.push('');
    }
  }

  L.push(...footer(at, [`Design record: ${link('architecture.md', at.kb('architecture.md'))}`,
    `Vocabulary: ${link('vocabulary.md', at.kb('vocabulary.md'))}`]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ vocabulary */

/**
 * What this repository calls things.
 *
 * Every document title and every second-level heading, alphabetised. These are the words the corpus actually
 * uses, which is the thing an agent cannot guess and the reason a `grep` for the obvious term comes back
 * empty. It is structure — a heading is the document's own name for a section — and it is the largest thing
 * in this tree, so the scope limit is stated rather than silently applied: H3 and below live on node pages.
 */
function vocabularyPage(c) {
  const { index, cfg, at, nameFor } = c;
  const terms = [];
  for (const d of index.documents) {
    if (d.title) terms.push({ term: d.title, kind: 'title', path: d.path, line: d.headings.find((h) => h.depth === 1)?.line || 1 });
    for (const h of d.headings) if (h.depth === 2) terms.push({ term: h.text, kind: 'section', path: d.path, line: h.line });
  }
  terms.sort((a, b) => a.term.localeCompare(b.term) || a.path.localeCompare(b.path) || a.line - b.line);

  const L = [];
  L.push('# What this repository calls things', '', STAMP, '');
  // **The term index is the last section on purpose.** It grows with the corpus — a 400-document repository
  // produces something north of 4,000 rows — and an agent that opens this file to learn the taxonomy would
  // otherwise spend its context on the index instead. The two small navigational sections come first, so a
  // partial read still lands on something useful, and the index is stated as a grep target rather than a
  // read target. Capping it instead would be worse: a term index that silently omits terms is an index that
  // answers "no such thing" about something that exists.
  L.push(`**The term index at the end of this file has ${terms.length} row(s). Grep it; do not read it.**`,
    'The two sections above it are the ones worth reading — how documents are classified, and the signal',
    'vocabulary that appears throughout this tree.', '');

  L.push('## How documents are classified', '');
  L.push('Cluster rules are matched in order and the first match wins, so a filename rule ahead of a directory',
    'rule beats it. These are the globs in this repository\'s config, not a convention this tool assumes.', '');
  L.push('| Cluster | Matches |', '|---|---|');
  for (const cl of cfg.clusters || []) {
    L.push(`| ${cell(cl.title)} (${cell(code(cl.id))}) | ${cell((cl.match || []).map((m) => code(m)).join(', ') || 'no rule')} |`);
  }
  if (cfg.fallbackCluster) L.push(`| Uncategorised (${cell(code(cfg.fallbackCluster))}) | anything matching none of the above — itself a finding, H5 |`);
  L.push('');

  L.push('## The signal vocabulary', '');
  L.push('The ids that appear throughout this tree and in every health report.', '');
  L.push('| Signal | Title | Enforcement |', '|---|---|---|');
  for (const s of Object.values(SIGNALS)) {
    L.push(`| ${s.id} | ${cell(s.title)} | ${(cfg.blocking || []).includes(s.id) ? 'blocking' : 'advisory'} |`);
  }
  L.push('');

  L.push('## Term index', '');
  L.push(`${terms.length} term(s) — every document title and every second-level heading in the corpus,`,
    'alphabetised, each with the file and line to read. **Third-level headings and below are not here**; they',
    'are on each document\'s node page, and including them would make this file longer than the corpus.', '');
  L.push('| Term | Kind | Where |', '|---|---|---|');
  for (const t of terms) {
    L.push(`| ${cell(label(t.term))} | ${t.kind} | ${cell(link(`${t.path}:${t.line}`, at.repo(t.path)))} · ${cell(link('node', at.kb(nodeFile(nameFor, t.path))))} |`);
  }
  L.push('');

  L.push(...footer(at, [`Where to read about a file: ${link('routes.md', at.kb('routes.md'))}`]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ resume */

/**
 * "I am resuming with no context — what was happening, and where do I pick up?"
 *
 * A derived **index into memory that lives elsewhere**, which is the only honest shape for it. The memory
 * itself is three things and none of them belong here: the journal, which is operational and never
 * published; `SHARED.md`, which is the team's standing constraints and is corpus; and per-contributor
 * handoffs, which are somebody's own working notes. What this adds is the part that makes them usable cold —
 * how stale each one is, what has happened since, and which documents the trail implicates.
 *
 * **Counts, kinds, timespans and refs. Never a record's text.** `journal.mjs` refuses to let the journal be
 * written anywhere publishable, and this tree is written into the publishable output directory; a page here
 * that quoted a record would route around that guard rather than break it, which is worse. Refs are paths
 * and branch names — what a session touched, never what it said — and they are the routing value, because a
 * document that appears in the trail is a document the last session was working against.
 */
function resumePage(c) {
  const { root, cfg, at, byPath, nameFor, findingsFor } = c;
  const L = [];
  L.push('# Resuming here with no context', '', STAMP, '');
  L.push('**Read this first, then the documents it routes to.** Nothing on this page is a summary — it is an',
    'index into memory that lives elsewhere, with the derived facts that say how far you can trust each part',
    'of it.', '');
  L.push('**For the live reading — current branch, uncommitted files, unpushed commits — run `atlas state`.**',
    'It is deliberately not baked in here: a working-tree measurement written into a file is wrong within a',
    'second and stays wrong for as long as the file is read.', '');

  /* --- the collective half --- */
  L.push('## What the project has decided', '');
  const shared = sharedPath(root, cfg);
  const sharedRel = path.relative(root, shared).split(path.sep).join('/');
  if (fs.existsSync(shared)) {
    const d = byPath.get(sharedRel);
    L.push(`${link(sharedRel, at.repo(sharedRel))} — ${code(sharedRel)}. The team's standing constraints: what was`,
      'decided, and what will bite anyone. Read it before re-litigating a boundary.', '');
    if (d) {
      L.push(`- Last touched: ${d.git ? d.git.date : 'unknown'}`);
      L.push(`- Node page: ${link('derived facts about it', at.kb(nodeFile(nameFor, sharedRel)))}`);
      const f = findingsFor.get(sharedRel) || [];
      if (f.length) L.push(`- Health: ${sigList(f.map((x) => x.signal))}`);
      L.push('');
    } else {
      L.push('- Not in the indexed corpus, so no derived facts are available for it. It is excluded by an',
        '  `exclude` rule, or outside the configured roots.', '');
    }
  } else {
    L.push(`**None.** There is no ${code(sharedRel)}, so nothing records what this project has settled — every`,
      'boundary is re-litigated from scratch by whoever arrives next. Writing it is a person\'s job: the tool',
      'refuses to generate one, because a machine can see that a commit happened and cannot see that a',
      'decision was argued.', '');
  }

  /* --- the personal half --- */
  L.push('## Where each contributor got to', '');
  const handoffs = handoffsIn(root, cfg);
  if (!handoffs.length) {
    L.push('**No handoffs.** No `HANDOFF.md` exists under', code(cfg.handoff?.dir || 'docs/handoff') + ',',
      'so no session has recorded where it stopped. `atlas handoff` prints the derived half as a prompt for a',
      'person to write the rest — it does not write the file, deliberately.', '');
  } else {
    const limit = cfg.handoff?.staleAfter ?? DEFAULT_STALE_AFTER;
    L.push(`${handoffs.length} handoff(s). **Distance is how far HEAD has moved since the commit the handoff names**,`,
      `which is the only mechanical measure of whether it is still current; the limit before H13 fires is ${limit}.`, '');
    L.push('| Contributor | Handoff | Written against | Commits since | State |', '|---|---|---|---|---|');
    for (const h of [...handoffs].sort((a, b) => a.slug.localeCompare(b.slug))) {
      const age = handoffAge(root, h.file);
      // An unknown distance is never reported as current. `handoffAge` returns null rather than 0 for
      // exactly that reason, and collapsing the two here would undo it.
      const state = age.distance === null ? `**unknown** — ${label(age.reason || 'not measurable')}`
        : age.distance > limit ? `**stale** — past the limit of ${limit}` : 'current';
      L.push(`| ${cell(h.slug)} | ${cell(link(h.rel, at.repo(h.rel)))} | ${cell(age.commit ? code(age.commit) : '— names no commit')} | `
        + `${age.distance === null ? '—' : age.distance} | ${state} |`);
    }
    L.push('');
  }

  /* --- the operational trail --- */
  L.push('## The operational trail', '');
  const j = safeJournal(root);
  if (!j.available) {
    L.push('**No journal.** Nothing has been recorded as work happened, so a session killed or compacted here',
      'leaves nothing behind. `atlas note <kind> "<text>"` starts one, and the continuity hooks write to it on',
      'Stop, SubagentStop and PreCompact.', '');
  } else if (!j.records.length) {
    L.push('The journal exists and holds no records.', '');
  } else {
    L.push('Written as work happened, one line per record, appended and flushed — so it survives a session that',
      'never reached its own last step. **It is never published, and no record\'s words appear on this page:**',
      'what follows is counts, kinds, timespans and the paths each record named.', '');
    const first = j.records[0].at, last = j.records[j.records.length - 1].at;
    L.push('', `${j.records.length} record(s) from ${j.contributors.length} contributor(s), `
      + `${String(first).slice(0, 10)} to ${String(last).slice(0, 10)}.`, '');
    if (j.skipped) {
      L.push(`**${j.skipped} unparseable line(s) were skipped** — the signature of a process killed mid-write.`,
        'Nothing before them was affected; the journal is append-only and is never rewritten.', '');
    }

    L.push('| Kind | Records | What it means |', '|---|---|---|');
    for (const [kind, why] of Object.entries(KINDS)) {
      const n = j.records.filter((r) => r.kind === kind).length;
      if (n) L.push(`| ${kind} | ${n} | ${cell(why)} |`);
    }
    L.push('');

    const days = new Map();
    for (const r of j.records) {
      const day = String(r.at).slice(0, 10);
      days.set(day, (days.get(day) || 0) + 1);
    }
    L.push('| Day | Records |', '|---|---|');
    for (const [day, n] of [...days.entries()].sort()) L.push(`| ${day} | ${n} |`);
    L.push('');

    const agents = [...new Set(j.records.map((r) => r.agent))].sort();
    if (agents.length > 1) {
      L.push(`Written by ${agents.map((a) => code(a)).join(', ')}. A subagent's reasoning is discarded when it`,
        'finishes, so a record tagged to one is a finding that would otherwise have been lost.', '');
    }

    // Refs are the routing value: a document that appears in the trail is one the last session was working
    // against. Split by whether the corpus knows the path, because a branch name and a document are both
    // legitimate refs and only one of them has a node page.
    const refs = new Map();
    for (const r of j.records) for (const ref of r.refs || []) refs.set(ref, (refs.get(ref) || 0) + 1);
    if (refs.size) {
      const known = [...refs.keys()].filter((r) => byPath.has(r)).sort();
      const other = [...refs.keys()].filter((r) => !byPath.has(r)).sort();
      L.push('### What the trail touched', '');
      if (known.length) {
        L.push('Indexed documents named by a record — these are what the last sessions were working against.', '');
        L.push('| Document | Path | Records naming it | Node |', '|---|---|---|---|');
        for (const p of known) {
          L.push(`| ${cell(link(byPath.get(p).title || p, at.repo(p)))} | ${cell(code(p))} | ${refs.get(p)} | ${cell(link('node', at.kb(nodeFile(nameFor, p))))} |`);
        }
        L.push('');
      }
      if (other.length) {
        L.push('Other refs — source files, branches and commits. Not documents, so they have no node page.', '');
        for (const p of other) L.push(`- ${code(p)} × ${refs.get(p)}`);
        L.push('');
      }
    }

    L.push('**To read what any of it actually said, run `atlas state`.** The records are in',
      code('.atlas/journal/<contributor>.jsonl') + ', which is outside the corpus by construction and is never',
      'published — that is why their text is not on this page.', '');
  }

  L.push('## Pick up here', '');
  L.push(`1. \`atlas state\` — the live branch, the uncommitted count, and the journal records in full.`,
    `2. ${link('health.md', at.kb('health.md'))} — anything blocking is a defect with no legitimate cause, and`,
    '   is the first thing to fix.',
    `3. ${link('plan.md', at.kb('plan.md'))} — what is open, and which items report progress that no commit`,
    '   corroborates.',
    `4. ${link('rules.md', at.kb('rules.md'))} — before writing anything, including the branch convention and`,
    '   what will refuse a commit.', '');

  L.push(...footer(at, [`What is broken: ${link('health.md', at.kb('health.md'))}`,
    `The plan: ${link('plan.md', at.kb('plan.md'))}`]));
  return L.join('\n') + '\n';
}

/**
 * The journal, or an honest absence.
 *
 * `read()` already returns `{available:false}` for a missing directory, so this catch is for what it does not
 * anticipate — an unreadable directory, a permissions failure. A build must not die because an operational
 * log could not be counted, and it must not report "no journal" when the truth is "could not look".
 */
function safeJournal(root) {
  try { return readJournal(root); } catch { return { available: false, records: [], skipped: 0, contributors: [] }; }
}

/* ------------------------------------------------------------------ cluster pages */

function clusterPage(cl, c) {
  const { byPath, findingsFor, at } = c;
  const L = [];
  L.push(`# Cluster · ${label(cl.title)}`, '', STAMP, '');
  // The blurb is configuration, written by whoever set up the taxonomy — not document prose. It is the one
  // composed sentence on this page and it came from the config file, not from a corpus document.
  if (cl.blurb) L.push(`> ${label(cl.blurb)}`, '>', '> — from the `clusters` entry in this repository\'s config.', '');
  L.push(`${cl.documents.length} document(s).`, '');

  L.push(...ROUTE_HEAD);
  const docs = cl.documents.map((p) => byPath.get(p)).filter(Boolean)
    .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path) || a.path.localeCompare(b.path));
  for (const d of docs) L.push(routeRow(d, c));
  L.push('');

  const withFindings = docs.filter((d) => (findingsFor.get(d.path) || []).length);
  if (withFindings.length) {
    L.push(`${withFindings.length} of ${docs.length} document(s) here have at least one finding — `
      + link('health.md', at.kb('health.md')) + ' has them grouped by signal.', '');
  }

  L.push(...footer(at, [`The taxonomy: ${link('vocabulary.md', at.kb('vocabulary.md'))}`,
    `What is broken: ${link('health.md', at.kb('health.md'))}`]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ node pages */

function nodePage(d, c) {
  const { byPath, findingsFor, planFor, citedBy, clusterOf, nameFor, at } = c;
  const findings = findingsFor.get(d.path) || [];
  const planItems = planFor.get(d.path) || [];
  const toNode = (p) => at.kb(nodeFile(nameFor, p));

  const L = [];
  L.push(`# ${label(d.title || d.path)}`, '', STAMP, '');
  L.push(`> Derived node. **Source of truth:** ${link(d.path, at.repo(d.path))} — ${code(d.path)}.`,
    '> This page states facts *about* that document and reproduces none of its text. Read the source for what',
    '> it says.', '');

  L.push('## Facts', '');
  L.push('| Field | Value |', '|---|---|');
  L.push(`| Path | ${cell(code(d.path))} |`);
  L.push(`| Title | ${cell(d.title || '— no H1; see signal H8')} |`);
  L.push(`| Cluster | ${cell(d.cluster ? code(d.cluster) : '— matched no rule')} |`);
  for (const row of [fieldRow('Status', d.status, 'status'), fieldRow('Version', d.version, 'version'),
    fieldRow('Date stated in the document', d.dateField, 'date')]) if (row) L.push(row);
  L.push(`| Lines | ${d.lines} |`);
  // Two different claims, and only one of them is "current". A document with no git history is tracked but
  // uncommitted, or its history could not be read — and H6 was not evaluated for it. A blank here would read
  // as "never changed", which is the opposite of what it means.
  L.push(d.git
    ? `| Last commit | ${cell(d.git.date)} ${cell(code(d.git.hash))} — ${cell(d.git.subject)} |`
    : '| Last commit | **unknown** — no git history for this path, so staleness (H6) was not evaluated for it |');
  L.push(`| Findings against it | ${findings.length}${findings.some((f) => f.blocking) ? ' — some blocking' : ''} |`);
  L.push('');

  L.push('## Structure', '');
  if (d.headings.length) {
    L.push('Headings only — the shape of the document, not its content. The line number is where to `Read`.', '');
    for (const h of d.headings) {
      L.push(`${'  '.repeat(Math.max(0, h.depth - 1))}- \`H${h.depth}\` ${label(h.text)} — ${code(`${d.path}:${h.line}`)}`);
    }
  } else {
    L.push('No headings.');
  }
  L.push('');

  L.push('## Links out', '');
  if (d.links.length) {
    L.push('| Target | Kind | Node page |', '|---|---|---|');
    for (const l of [...d.links].sort((a, b) => a.target.localeCompare(b.target))) {
      const known = byPath.has(l.target);
      // Three states, never two. A link into the corpus, a link at a real file that is not indexed (an image,
      // a script), and a link at nothing — and only the third is signal H1. Collapsing the middle into "dead"
      // is the false-positive class that made the citation resolver untrustworthy before it was fixed.
      const kind = known ? 'indexed document' : 'not indexed — a non-document file, or dead (H1)';
      L.push(`| ${cell(code(l.target))} | ${cell(kind)} | ${cell(known ? link(byPath.get(l.target).title || l.target, toNode(l.target)) : '—')} |`);
    }
  } else {
    L.push('None.');
  }
  L.push('');

  L.push('## Referenced by', '');
  if (d.backlinks.length) {
    for (const b of d.backlinks) L.push(`- ${link(byPath.get(b)?.title || b, toNode(b))} — ${code(b)}`);
  } else {
    L.push('Nothing links here. This document is reachable only by knowing it exists (signal H4).');
  }
  L.push('');

  L.push('## Code it cites', '');
  if (d.citations.length) {
    L.push('| Citation | Resolves to | State | Other documents citing that file |', '|---|---|---|---|');
    for (const cit of [...d.citations].sort((a, b) => (a.path + a.line).localeCompare(b.path + b.line))) {
      const ref = `${cit.path}:${cit.line}${cit.endLine ? `-${cit.endLine}` : ''}`;
      // "Ambiguous" is its own state and is never resolved to a best guess. A bare filename that exists at two
      // paths was measured at 454 unverifiable citations on one real corpus, and a resolver that guessed would
      // then be checking a line number against the wrong file — worse than not checking at all.
      const state = cit.ambiguous ? `ambiguous — ${(cit.candidates || []).length} candidate paths, so not verified`
        : cit.resolved ? 'resolved' : 'unresolved — no such file (H2)';
      const others = cit.resolved
        ? [...(citedBy.get(cit.resolved) || [])].filter((p) => p !== d.path).sort()
          .map((p) => link(byPath.get(p)?.title || p, toNode(p))).join(', ')
        : '';
      L.push(`| ${cell(code(ref))} | ${cell(cit.resolved ? link(cit.resolved, at.repo(cit.resolved)) : '—')} | ${cell(state)} | ${cell(others || '—')} |`);
    }
  } else {
    L.push('None.');
  }
  L.push('');

  L.push('## Health findings', '');
  if (findings.length) {
    L.push(`Every other document carrying the same signal: ${link('health.md', at.kb('health.md'))}.`, '');
    L.push('| Signal | Blocking | Detail |', '|---|---|---|');
    for (const f of [...findings].sort((a, b) => a.signal.localeCompare(b.signal) || String(a.detail).localeCompare(String(b.detail)))) {
      L.push(`| ${cell(f.signal)} · ${cell(SIGNALS[f.signal]?.title || '')} | ${f.blocking ? 'yes' : 'no'} | ${cell(f.detail || '')} |`);
    }
  } else {
    L.push('None. Every mechanical check that ran against this document is clean —',
      `see ${link('health.md', at.kb('health.md'))} for what was *not* checked.`);
  }
  L.push('');

  if (planItems.length) {
    L.push('## Plan items that name this document', '');
    L.push(`Read out of each item's own prose in the plan, not from a hand-maintained mapping. Full detail: ${link('plan.md', at.kb('plan.md'))}.`, '');
    for (const it of [...planItems].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
      L.push(`- **${cell(it.id)}** · ${label(it.title)} — ${it.percent === null ? 'no figure recorded' : `${it.percent}%${it.estimated ? ' (estimated)' : ''}`}`);
    }
    L.push('');
  }

  const clusterRel = d.cluster ? clusterOf.get(d.cluster) : null;
  L.push(...footer(at, [
    `Cluster: ${clusterRel ? link(d.cluster, at.kb(clusterRel)) : '— none'}`,
    `Source: ${link(d.path, at.repo(d.path))}`,
  ]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ health */

/**
 * "What is broken", answerable without the CLI.
 *
 * Ordered blocking-first, because the report's own rule is that blocking signals have no legitimate cause
 * and advisory ones do — an agent reading top to bottom should meet the defects before it meets the survey.
 * `Not checked` sits above the findings for the reason the CLI reads it aloud: a check that could not run is
 * never reported as passing, and a reader who does not scroll would otherwise take an empty section for a
 * clean one.
 */
function healthPage(c) {
  const { health, cfg, at, nameFor } = c;
  const L = [];
  const toNode = (p) => at.kb(nodeFile(nameFor, p));
  const active = health.findings.filter((f) => !f.suppressed);

  L.push('# What is broken', '', STAMP, '');
  L.push(health.blockingCount
    ? `**${health.blockingCount} blocking finding(s).** Blocking signals have no legitimate cause — fix them.`
    : '**No blocking findings.** Every mechanical check that ran is clean.', '');
  L.push(`${active.length} finding(s) in total across ${Object.keys(SIGNALS).length} signals.`
    + (health.suppressed ? ` ${health.suppressed} further finding(s) are suppressed by configuration, each with a stated reason there.` : ''), '');
  L.push(`Each finding links to the document's node page, which states what links to it, what it links to and`,
    'what it cites — that is the blast radius of the finding.', '');

  if (health.notChecked.length) {
    L.push('## Not checked', '');
    L.push('**Read this before believing a zero below.** These are the checks this run could not make.', '');
    for (const n of health.notChecked) L.push(`- ${label(n)}`);
    L.push('');
  }

  const blockingIds = new Set(cfg.blocking || []);
  const ordered = [...Object.values(SIGNALS)].sort((a, b) => {
    const ab = blockingIds.has(a.id) ? 0 : 1, bb = blockingIds.has(b.id) ? 0 : 1;
    return ab - bb || a.id.localeCompare(b.id, 'en', { numeric: true });
  });

  for (const s of ordered) {
    const items = active.filter((f) => f.signal === s.id)
      .sort((a, b) => String(a.doc).localeCompare(String(b.doc)) || String(a.detail).localeCompare(String(b.detail)));
    // A signal whose configured pattern was declined has a count of zero and is not clean. Printing "0" here
    // would be the same lie the "Not checked" section exists to prevent, two screens further up.
    const skipped = (health.unevaluated || []).includes(s.id);
    L.push(`## ${s.id} · ${label(s.title)}`, '');
    L.push(`${blockingIds.has(s.id) ? '**Blocking** — no legitimate cause.' : 'Advisory — legitimate exceptions exist.'}`
      + ` ${label(s.why)}`, '');
    if (skipped) { L.push('**Not evaluated.** See *Not checked* above. This is not a clean result.', ''); continue; }
    if (!items.length) { L.push('No findings.', ''); continue; }
    L.push(`${items.length} finding(s).`, '');
    for (const f of items) {
      // H13, H15 and H16 name a missing artifact kind, a handoff or a code area rather than an indexed
      // document, so there is no node page to point at. Rendered as text: the site verifier caught the first
      // version of this linking to `pages/-no-hld--82adea20.html`, a page that was never written.
      const subject = f.corpus ? code(f.doc) : `${link(f.doc, toNode(f.doc))} ${code(f.doc)}`;
      L.push(`- ${subject}${f.detail ? ` — ${label(f.detail)}` : ''}`);
    }
    L.push('');
  }

  L.push(...footer(at, [`Design coverage: ${link('architecture.md', at.kb('architecture.md'))}`,
    `The plan: ${link('plan.md', at.kb('plan.md'))}`]));
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ plan */

function planPage(c) {
  const { plan, covById, byPath, nameFor, at } = c;
  const L = [];
  L.push('# The plan', '', STAMP, '');

  if (!plan || plan.missing) {
    L.push(plan
      ? `\`planning.source\` names ${code(plan.source)}, and that file does not exist. Nothing was read.`
      : 'No planning source is configured. Set `planning.source` in the config to a task list or backlog and '
        + 'this page will carry its items, with the commits that name each one.', '');
    L.push(...footer(at));
    return L.join('\n') + '\n';
  }

  L.push(`Source of truth: ${link(plan.source, at.repo(plan.source))} — ${code(plan.source)}. Every figure below`,
    'was read out of that file; nothing here is judged or recomputed. Item titles are its own headings, and',
    'its prose is not reproduced.', '');
  L.push(`${plan.stats.total} item(s), mean completion ${plan.stats.mean ?? 'unknown'}%.`, '');

  if (plan.notes.length) {
    L.push('## What these figures do not say', '');
    for (const n of plan.notes) L.push(`- ${label(n)}`);
    L.push('');
  }

  // Tracks in the order they appear in the plan, which is the order the author chose. Sorting them
  // alphabetically would be deterministic too, and would scramble a sequence that means something.
  for (const t of [...new Set(plan.items.map((i) => i.track))]) {
    const items = plan.items.filter((i) => i.track === t);
    L.push(`## ${label(t)}`, '');
    L.push('| Item | Title | % | Status | Commits naming it | Last | Line | Specified by |',
      '|---|---|---|---|---|---|---|---|');
    for (const it of items) {
      const cov = covById.get(it.id);
      const sources = (it.sources || [])
        .map((s) => byPath.has(s.path) ? link(s.path, at.kb(nodeFile(nameFor, s.path))) : link(s.path, at.repo(s.path)))
        .join(', ');
      L.push(`| ${cell(it.id)} | ${cell(label(it.title))} | ${it.percent === null ? 'unknown' : it.percent + (it.estimated ? '*' : '')} `
        + `| ${cell(it.status?.label || '')} | ${cov ? cov.commits : '—'} | ${cell(cov?.last || '—')} `
        + `| ${cell(code(`${plan.source}:${it.line}`))} | ${sources || '—'} |`);
    }
    L.push('');
  }
  L.push('`*` after a figure means the plan marked it estimated rather than measured.', '');

  // The question this cross-reference exists to raise. Phrased as a question and never as an accusation:
  // commit subjects describe a change, not necessarily a ticket, so an unreferenced item is a prompt to look.
  const claimed = [...covById.values()].filter((r) => r.commits === 0 && (r.percent || 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (claimed.length) {
    L.push('## Items that report progress with no commit naming them', '');
    L.push('Worth a look, not an accusation — a commit subject describes a change, not necessarily a plan id.', '');
    for (const r of claimed) L.push(`- **${cell(r.id)}** · ${label(r.title)} — recorded at ${r.percent}%, named by no commit.`);
    L.push('');
  }

  L.push(...footer(at, [`Plan source: ${link(plan.source, at.repo(plan.source))}`,
    `What is broken: ${link('health.md', at.kb('health.md'))}`]));
  return L.join('\n') + '\n';
}
