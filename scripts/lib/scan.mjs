/**
 * llm-wiki · discovery and parsing
 *
 * Produces the index every other stage reads. Nothing here interprets or judges; it records what is in the
 * files and what git says about them. Judgment lives in health.mjs, and prose lives in the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { matchesAny, clusterFor } from './config.mjs';
import { maskInlineCode } from './markdown.mjs';

const NUL = '\0';
const US = '\x1f';

/* ------------------------------------------------------------------ discovery */

/**
 * `git ls-files`, or `null` when this genuinely is not a repository.
 *
 * The distinction is the whole function. The previous bare `catch` treated **every** git failure as "no
 * repository" and fell through to a filesystem walk — which publishes untracked files. Verified: a corrupt
 * `.git/index` turned a corpus of one tracked document into three, one of them an untracked `secret-notes.md`,
 * and nothing in the report mentioned that discovery had changed mode. `trackedOnly` is described in the
 * configuration reference as "the quiet safety feature… a file has to be committed before it can be
 * published", and a bare catch is exactly how a safety feature turns off without telling anyone.
 *
 * Same shape as `gitHistory` below, for the same reason: a missing repository is a legitimate state, and
 * anything else is our bug — a bug that returns "no data" looks exactly like "no findings".
 */
function gitLsFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.split(NUL).filter(Boolean);
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not a git repository|does not have any commits|ENOENT/i.test(msg)) return null;
    throw new Error(`git ls-files failed while discovering documents: ${msg.split('\n')[0]}`);
  }
}

/** Every tracked file, not just markdown — needed to resolve code citations. */
export function allFiles(root) {
  const tracked = gitLsFiles(root);
  return (tracked || walk(root, root)).map(posix);
}

/**
 * `notes` collects anything the caller must state in "Not checked". Discovery can degrade — that is allowed —
 * but it may never degrade quietly.
 */
export function discover(root, cfg, notes = []) {
  let files = [];
  if (cfg.trackedOnly) {
    const tracked = gitLsFiles(root);
    if (tracked) files = tracked;
    else {
      files = walk(root, root);          // not a git repository, or git unavailable
      notes.push('trackedOnly is on, but this is not a git repository — documents were discovered by walking the ' +
        'filesystem instead, so the corpus may include untracked files that are not in the repository.');
    }
  } else {
    files = walk(root, root);
  }
  const rootGlobs = (cfg.roots || ['.']).filter((r) => r !== '.').map((r) => `${posix(r)}/**`);
  return files
    .map(posix)
    .filter((p) => matchesAny(p, cfg.include))
    .filter((p) => !matchesAny(p, cfg.exclude))
    .filter((p) => !rootGlobs.length || matchesAny(p, rootGlobs) || !p.includes('/'))
    .filter((p) => fs.existsSync(path.join(root, p)))
    .sort();
}

function walk(dir, root, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, acc);
    else acc.push(path.relative(root, full));
  }
  return acc;
}

const posix = (p) => p.split(path.sep).join('/');

/* ------------------------------------------------------------------ parsing */

const FENCE = /^(```|~~~)/;

export function parseDocument(root, rel, cfg) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = raw.split('\n');

  const { frontmatter, bodyStart } = parseFrontmatter(lines);

  const headings = [];
  const slugs = new Map();
  let title = null;
  let inFence = false;
  const proseLines = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    proseLines.push(line);
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const depth = m[1].length;
      const text = stripInline(m[2]);
      const slug = uniqueSlug(slugify(text), slugs);
      headings.push({ depth, text, slug, line: i + 1 });
      if (depth === 1 && !title) title = text;
    }
  }

  const prose = proseLines.join('\n');
  if (!title && frontmatter.title) title = String(frontmatter.title);

  return {
    path: rel,
    title,
    cluster: clusterFor(rel, cfg),
    lines: lines.length,
    bytes: Buffer.byteLength(raw, 'utf8'),
    frontmatter,
    headings,
    links: extractLinks(prose, rel),
    citations: extractCitations(prose, cfg),
    status: fieldValue(prose, 'Status'),
    version: fieldValue(prose, 'Version') || versionFromName(rel),
    dateField: fieldValue(prose, 'Date') || fieldValue(prose, 'Last updated'),
    excerpt: firstParagraph(prose),
    body: prose,
  };
}

function parseFrontmatter(lines) {
  if (lines[0] !== '---') return { frontmatter: {}, bodyStart: 0 };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { frontmatter: {}, bodyStart: 0 };
  const fm = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { frontmatter: fm, bodyStart: end + 1 };
}

/** `**Status:** foo` or `Status: foo` on its own line — the convention specification documents already use. */
function fieldValue(text, label) {
  const re = new RegExp(`^\\*{0,2}${label}:?\\*{0,2}\\s*[:·]?\\s*(.+)$`, 'im');
  const m = re.exec(text);
  if (!m) return null;
  return stripInline(m[1]).split('·')[0].trim().slice(0, 160) || null;
}

function versionFromName(rel) {
  const m = /_v(\d+\.\d+(?:\.\d+)?)\.md$/i.exec(rel);
  return m ? m[1] : null;
}

/**
 * The first paragraph that actually describes something. Headings, rules and tables are skipped, and so is a
 * block that is only a link or a badge row — a README commonly opens with its own URL, and quoting that as
 * the project's description produces a landing page whose one line is a link the reader is already on.
 */
function firstParagraph(text) {
  for (const block of text.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('---') || t.startsWith('|')) continue;
    const plain = stripInline(t.replace(/^>\s?/gm, ''));
    if (!plain) continue;
    if (/^(https?:\/\/|www\.)/i.test(plain)) continue;              // a bare URL
    if (/^[\w.-]+\.(com|org|net|io|dev|ai)\b\S*$/i.test(plain)) continue;  // a bare domain, e.g. github.com/x/y
    if (plain.split(/\s+/).length < 6) continue;                    // a badge row or a one-word line
    return plain.slice(0, 300);
  }
  return '';
}

function extractLinks(text, from) {
  const out = [];
  const seen = new Set();
  const masked = maskInlineCode(text);
  const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(masked))) {
    const rawTarget = m[2];
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(rawTarget)) continue;
    const [targetPath, anchor] = rawTarget.split('#');
    if (!targetPath) continue;
    const resolved = posix(path.posix.normalize(path.posix.join(path.posix.dirname(from), targetPath)));
    const key = resolved + '#' + (anchor || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: stripInline(m[1]), raw: rawTarget, target: resolved, anchor: anchor || null });
  }
  return out;
}

/**
 * `src/thing.ts:42` — the citation convention. Deliberately narrow: it must carry a known code extension and a
 * line number, so ordinary prose containing a colon and a digit does not become a false positive.
 */
function extractCitations(text, cfg) {
  // Every metacharacter, not just the first dot. `String.prototype.replace` with a string pattern replaces one
  // occurrence, so `.tar.gz` kept its second dot live and `citationExtensions: ["("]` crashed the whole scan
  // with an unterminated group. A configured extension is data, and data is escaped before it becomes syntax.
  const exts = (cfg.citationExtensions || []).map((e) => String(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!exts) return [];
  const re = new RegExp(`([A-Za-z0-9_./@-]+(?:${exts})):(\\d+)(?:[-–](\\d+))?`, 'g');
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].replace(/^\.\//, '');
    if (p.startsWith('http')) continue;
    const key = `${p}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: p, line: Number(m[2]), endLine: m[3] ? Number(m[3]) : null });
  }
  return out;
}

export function slugify(text) {
  return text.toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-') || 'section';
}

function uniqueSlug(base, seen) {
  const n = seen.get(base) || 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

export function stripInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

/* ------------------------------------------------------------------ git metadata */

/**
 * One `git log` pass over the given paths, newest first. The first time a path appears is its last commit.
 * A per-file `git log -1` would be hundreds of subprocesses; this is one.
 */
export function gitHistory(root, paths) {
  const meta = new Map();
  if (!paths.length) return meta;
  // The separators must be written as git's own `%x00`/`%x1f` escapes, NOT as literal control characters:
  // argv strings are NUL-terminated, so Node rejects a raw NUL outright ("must be a string without null
  // bytes"). That failure used to be swallowed by a bare catch below, which meant git metadata silently never
  // loaded — every document showed no date and the staleness signal evaluated nothing while reporting clean.
  // `%ad --date=short` is what gets displayed; `%aI` is what gets compared. Comparing on the short form
  // cannot order two changes made on the same day, so a document edited this morning would never register as
  // stale against code changed this afternoon.
  // `-c core.quotePath=false` is load-bearing, not tidiness. git quotes any path with a byte over 0x7F by
  // default, so `docs/étude.md` comes back from `--name-only` as `"docs/\303\251tude.md"` — while `ls-files -z`
  // hands `discover()` the same path unquoted. The two keys never matched, so every non-ASCII document got NO
  // git metadata: no date on its page, and H6 skipped it entirely while the report claimed every check ran.
  // That is the exact bug the comment above describes, in a second disguise.
  const args = ['-c', 'core.quotePath=false',
    'log', '--format=%x00%H%x1f%ad%x1f%aI%x1f%s', '--name-only', '--date=short', '--', ...paths];
  let out;
  try {
    out = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    // A missing repository is a legitimate state and degrades quietly. Anything else is our bug, and a bug
    // that returns "no data" looks exactly like "no findings" — so it is raised, not absorbed.
    if (/not a git repository|does not have any commits|unknown revision|ambiguous argument/i.test(msg)) return meta;
    throw new Error(`git log failed while reading history: ${msg.split('\n')[0]}`);
  }
  for (const record of out.split(NUL)) {
    if (!record.trim()) continue;
    const nl = record.indexOf('\n');
    const header = nl === -1 ? record : record.slice(0, nl);
    const [hash, date, iso, subject] = header.split(US);
    if (!hash) continue;
    const files = nl === -1 ? [] : record.slice(nl + 1).split('\n').map((s) => s.trim()).filter(Boolean);
    for (const f of files) {
      if (!meta.has(f)) meta.set(f, { hash: hash.slice(0, 8), date, iso, subject: subject || '' });
    }
  }
  return meta;
}

/* ------------------------------------------------------------------ index */

export function buildIndex(root, cfg, { withGit = true } = {}) {
  const notes = [];
  const files = discover(root, cfg, notes);
  const documents = files.map((f) => parseDocument(root, f, cfg));

  const docGit = withGit ? gitHistory(root, files) : new Map();
  for (const d of documents) d.git = docGit.get(d.path) || null;

  // Metadata that is missing for *some* documents is the dangerous shape: the run looks successful, H6
  // evaluates the documents it can see, and the ones it could not are indistinguishable from the ones it
  // cleared. Counted here, stated in "Not checked".
  const withoutGit = withGit ? documents.filter((d) => !d.git).length : 0;
  if (withoutGit) {
    notes.push(`${withoutGit} of ${documents.length} document(s) have no git history — they are tracked but not ` +
      `yet committed, or their history could not be read. H6 (staleness) was not evaluated for them, and they carry no date.`);
  }

  resolveCitations(root, documents);

  // Git metadata for cited code, so staleness can compare a document against what it cites.
  const citedPaths = [...new Set(documents.flatMap((d) => d.citations.map((c) => c.resolved).filter(Boolean)))];
  const codeGit = withGit ? gitHistory(root, citedPaths) : new Map();

  const known = new Set(files);
  const backlinks = new Map();
  for (const d of documents) {
    for (const l of d.links) {
      if (!known.has(l.target)) continue;
      if (!backlinks.has(l.target)) backlinks.set(l.target, new Set());
      backlinks.get(l.target).add(d.path);
    }
  }
  for (const d of documents) {
    d.backlinks = [...(backlinks.get(d.path) || [])].sort();
  }

  const clusters = cfg.clusters.map((c) => ({
    ...c, documents: documents.filter((d) => d.cluster === c.id).map((d) => d.path),
  }));
  if (cfg.fallbackCluster) {
    const fb = documents.filter((d) => d.cluster === cfg.fallbackCluster);
    if (fb.length) {
      clusters.push({
        id: cfg.fallbackCluster, title: 'Uncategorised',
        blurb: 'Not matched by any cluster rule. Classify these, or add a rule.',
        documents: fb.map((d) => d.path),
      });
    }
  }

  return {
    root,
    generated: { tool: 'llm-wiki', head: gitHead(root) },
    siteTitle: cfg.siteTitle,
    notes,
    documents,
    clusters: clusters.filter((c) => c.documents.length),
    codeGit: Object.fromEntries(codeGit),
    stats: {
      documents: documents.length,
      lines: documents.reduce((n, d) => n + d.lines, 0),
      bytes: documents.reduce((n, d) => n + d.bytes, 0),
      links: documents.reduce((n, d) => n + d.links.length, 0),
      citations: documents.reduce((n, d) => n + d.citations.length, 0),
      clusters: clusters.filter((c) => c.documents.length).length,
      withGit,
    },
  };
}

/**
 * Documentation cites code as `brain.ts:301` far more often than as `src/ai/brain.ts:301`. Treating a bare
 * filename as a repo-root path would mark almost every citation broken — measured at 77% false positives on a
 * real corpus before this existed. So: try the literal path, then a unique basename match, and when a basename
 * is ambiguous say so rather than guessing. A citation resolver that guesses is worse than none, because its
 * line-number check would then be verifying the wrong file.
 */
function resolveCitations(root, documents) {
  const tracked = allFiles(root);
  const byBase = new Map();
  const bySuffix = new Map();
  for (const f of tracked) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
    bySuffix.set(f, f);
  }

  for (const d of documents) {
    for (const c of d.citations) {
      c.resolved = null;
      c.ambiguous = false;

      if (bySuffix.has(c.path)) { c.resolved = c.path; continue; }

      // A partial path such as `ai/brain.ts` — accept a unique suffix match.
      if (c.path.includes('/')) {
        const hits = tracked.filter((f) => f === c.path || f.endsWith('/' + c.path));
        if (hits.length === 1) { c.resolved = hits[0]; continue; }
        if (hits.length > 1) { c.ambiguous = true; c.candidates = hits.slice(0, 5); continue; }
        continue;                                   // genuinely absent
      }

      const hits = byBase.get(c.path) || [];
      if (hits.length === 1) c.resolved = hits[0];
      else if (hits.length > 1) { c.ambiguous = true; c.candidates = hits.slice(0, 5); }
    }
  }
}

function gitHead(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}
