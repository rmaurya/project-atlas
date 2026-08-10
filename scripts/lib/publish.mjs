/**
 * project-atlas · publishing
 *
 * Three targets, one rule: **the repository's markdown is the source of truth and every target is derived.**
 * Nothing here ever becomes a second place where content lives.
 *
 *   wiki   → a GitHub Wiki repo (`<repo>.wiki.git`). Markdown, flattened and re-linked.
 *   pages  → a `gh-pages` branch carrying the full generated site (dashboard, deck, search all intact).
 *   export → a single self-contained HTML file, for publishing anywhere that takes one file.
 *
 * **Nothing pushes without an explicit `--push`.** Publishing is outward-facing and irreversible-ish; the
 * default is to stage locally and print exactly what would go where.
 *
 * ## Why the wiki needs a manifest
 *
 * GitHub offers no pull-request review on wiki repos — only the default branch is live, so every push is
 * immediately public and there is no gate. The only safe arrangement is that humans never author there. But
 * "never" is a convention, and conventions get broken by a colleague fixing a typo in the web UI. So each
 * publish writes `.atlas-manifest.json` recording, per page, its source path and a hash of exactly what we
 * wrote. On the next publish we re-hash: a mismatch is a human edit, and we stop rather than destroy it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { escapeHtml } from './markdown.mjs';
import { compare as compareVersions } from './version.mjs';

const MANIFEST = '.atlas-manifest.json';
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

/* ------------------------------------------------------------------ page naming */

/**
 * A wiki page is addressed by filename; slashes are not allowed, so paths must flatten. The mapping is
 * deterministic and recorded in the manifest, so a drifted page can be traced back to the file it came from.
 */
/**
 * Names project-atlas generates itself. A source document must never be allowed to claim one: an early version
 * mapped `README.md` to `Home`, and the generated index then overwrote it — the repository's front page
 * vanished from the wiki with no error. Reserved names are suffixed instead.
 */
export const RESERVED = new Set(['Home', '_Sidebar', '_Footer', 'Project-Dashboard', 'Documentation-Health']);

/**
 * A wiki page name that may be joined onto a filesystem path. `wikiPageName` only ever produces these; the
 * manifest, which is read back out of a repository other people can write to, does not.
 */
export function isSafePageName(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' &&
         !/[/\\]/.test(name) && !name.includes('..') && !/^[.]/.test(name.replace(/^_/, ''));
}

export function wikiPageName(relPath, cfg) {
  const stripped = relPath.replace(/\.md$/i, '');
  const roots = (cfg.publish?.wiki?.stripPrefixes) || ['docs/'];
  let p = stripped;
  for (const r of roots) if (p.startsWith(r)) { p = p.slice(r.length); break; }
  const name = p
    .split('/')
    .map((seg) => seg.replace(/[^A-Za-z0-9._ -]/g, '-'))
    .join('-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'Untitled';
  return RESERVED.has(name) ? `${name}-doc` : name;
}

/** Rewrite in-document links so they point at wiki page names instead of file paths. */
function rewriteLinks(body, fromPath, nameOf) {
  return body.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, text, target) => {
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(target)) return whole;
    const [p, anchor] = target.split('#');
    if (!p) return whole;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), p));
    const name = nameOf.get(resolved);
    if (!name) return `${text} (\`${p}\`)`;          // not a published page — degrade to plain text, never a dead link
    return `[${text}](${encodeURIComponent(name)}${anchor ? '#' + anchor : ''})`;
  });
}

/* ------------------------------------------------------------------ wiki */

export function buildWikiPages(index, health, plan, cfg, root = null) {
  const slug = cfg.publish?.wiki?.slug || (root ? slugFromRemote(root) : null);
  const branch = cfg.publish?.wiki?.sourceBranch || 'main';
  const nameOf = new Map(index.documents.map((d) => [d.path, wikiPageName(d.path, cfg)]));

  // Two documents can flatten to one page name; that would silently drop one, so disambiguate and say so.
  const used = new Map();
  const collisions = [];
  for (const [src, name] of nameOf) {
    if (!used.has(name)) { used.set(name, src); continue; }
    const alt = `${name}-${sha(src).slice(0, 4)}`;
    collisions.push({ name, kept: used.get(name), renamed: src, to: alt });
    nameOf.set(src, alt);
    used.set(alt, src);
  }

  const banner = (src) => {
    const link = slug ? `[\`${src}\`](https://github.com/${slug}/blob/${branch}/${src})` : `\`${src}\``;
    return `> **Generated page — do not edit here.** This wiki is written by \`project-atlas\` from the repository.\n` +
      `> Edit ${link} instead. Edits made in this UI are detected on the next publish and reported, not silently discarded.\n`;
  };

  const pages = new Map();

  for (const d of index.documents) {
    const name = nameOf.get(d.path);
    const backlinks = d.backlinks.length
      ? `\n\n---\n\n### Referenced by\n\n` + d.backlinks.map((b) => `- [${nameOf.get(b) || b}](${encodeURIComponent(nameOf.get(b) || b)})`).join('\n') + '\n'
      : '';
    pages.set(name, banner(d.path) + '\n' + rewriteLinks(d.body, d.path, nameOf) + backlinks);
  }

  pages.set('Home', homePage(index, health, plan, nameOf, cfg));
  pages.set('_Sidebar', sidebar(index, nameOf));
  pages.set('_Footer', `_Generated by project-atlas from ${index.stats.documents} source documents. Do not edit here._`);
  pages.set('Documentation-Health', healthMd(health, nameOf, cfg));
  if (plan && !plan.missing) pages.set('Project-Dashboard', dashboardMd(plan, index, health));

  return { pages, nameOf, collisions };
}

function homePage(index, health, plan, nameOf, cfg) {
  const L = [];
  L.push(`# ${index.siteTitle}`);
  L.push('');
  L.push(`> **This wiki is generated.** ${index.stats.documents} documents · ${index.stats.lines.toLocaleString()} lines · ` +
    `${index.stats.clusters} clusters. Edit the markdown in the repository, not here.`);
  L.push('');
  if (plan && !plan.missing) {
    L.push(`**Project:** ${plan.stats.total} open items, mean completion ${plan.stats.mean ?? '—'}% · ` +
      `[Project Dashboard](Project-Dashboard) · [Documentation Health](Documentation-Health)` +
      `${health.blockingCount ? ` · **${health.blockingCount} blocking findings**` : ''}`);
    L.push('');
  }
  for (const c of index.clusters) {
    L.push(`## ${c.title}`);
    if (c.blurb) L.push(`_${c.blurb}_`);
    L.push('');
    const docs = c.documents.map((p) => index.documents.find((d) => d.path === p)).filter(Boolean)
      .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
    for (const d of docs) {
      const n = nameOf.get(d.path);
      L.push(`- [${d.title || d.path}](${encodeURIComponent(n)})${d.git ? ` — _${d.git.date}_` : ''}`);
    }
    L.push('');
  }
  return L.join('\n');
}

function sidebar(index, nameOf) {
  const L = ['### Contents', '', '- [Home](Home)'];
  L.push('- [Project Dashboard](Project-Dashboard)');
  L.push('- [Documentation Health](Documentation-Health)');
  L.push('');
  for (const c of index.clusters) {
    L.push(`**${c.title}** (${c.documents.length})`);
    const docs = c.documents.slice(0, 12).map((p) => index.documents.find((d) => d.path === p)).filter(Boolean);
    for (const d of docs) L.push(`- [${(d.title || d.path).slice(0, 42)}](${encodeURIComponent(nameOf.get(d.path))})`);
    if (c.documents.length > 12) L.push(`- _…and ${c.documents.length - 12} more on [Home](Home)_`);
    L.push('');
  }
  return L.join('\n');
}

function healthMd(health, nameOf, cfg) {
  const L = ['# Documentation health', ''];
  L.push(health.blockingCount ? `> **${health.blockingCount} blocking finding(s).** Blocking signals have no legitimate cause.`
    : '> No blocking findings.');
  L.push('');
  L.push('| Signal | Count | Kind |');
  L.push('|---|---:|---|');
  for (const [id, n] of Object.entries(health.counts)) {
    L.push(`| ${id} | ${n} | ${(cfg.blocking || []).includes(id) ? '**blocking**' : 'advisory'} |`);
  }
  if (health.notChecked.length) {
    L.push('', '### Not checked', '');
    L.push('_A check that did not run is not a check that passed._', '');
    for (const n of health.notChecked) L.push(`- ${n}`);
  }
  const blocking = health.findings.filter((f) => f.blocking);
  if (blocking.length) {
    L.push('', '### Blocking findings', '');
    for (const f of blocking) L.push(`- **${f.signal}** [${f.doc}](${encodeURIComponent(nameOf.get(f.doc) || f.doc)}) — ${f.detail}`);
  }
  return L.join('\n');
}

function dashboardMd(plan, index, health) {
  const bar = (p) => (p === null ? '`?`' : '`' + '█'.repeat(Math.round(p / 10)) + '░'.repeat(10 - Math.round(p / 10)) + '`');
  const L = ['# Project dashboard', ''];
  L.push(`> Generated from \`${plan.source}\`. ${plan.stats.total} open items · mean completion ${plan.stats.mean ?? '—'}% · ` +
    `${health.blockingCount} blocking documentation findings.`);
  L.push('');
  L.push('| Status | Items |', '|---|---:|');
  for (const b of plan.stats.byStatus) L.push(`| ${b.label} | ${b.count} |`);
  if (plan.stats.unknown) L.push(`| Unknown | ${plan.stats.unknown} |`);
  L.push('');
  L.push('## By track', '', '| Track | Items | Mean |', '|---|---:|---:|');
  for (const t of plan.tracks) L.push(`| ${t.name} | ${t.count} | ${t.mean === null ? '—' : t.mean + '%'} |`);
  L.push('');
  L.push('## All items', '', '| ID | Item | Track | Pri | Progress | Status |', '|---|---|---|---|---|---|');
  for (const i of plan.items) {
    L.push(`| \`${i.id}\` | ${i.title} | ${i.track.replace(/^Track \d+\s*[—–-]\s*/, '')} | ${i.priority} | ` +
      `${bar(i.percent)} ${i.percent === null ? '—' : i.percent + '%'}${i.estimated ? '\\*' : ''} | ${i.status.label} |`);
  }
  if (plan.stats.estimated) L.push('', `_\\* ${plan.stats.estimated} figure(s) are estimated in the source, not measured against the code._`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ wiki staging + drift */

export function stageWiki(root, cfg, built, { push = false, force = false, importDrift = false, host = null } = {}) {
  host = host || { kind: 'github' };
  const slug = cfg.publish?.wiki?.slug || slugFromRemote(root);
  if (!slug) throw new Error('Cannot determine the GitHub repository. Set publish.wiki.slug ("owner/repo") in the config.');
  const url = host.wikiGit || `https://github.com/${slug}.wiki.git`;

  const work = path.join(os.tmpdir(), `atlas-wiki-${sha(root + slug)}`);
  fs.rmSync(work, { recursive: true, force: true });

  // A clone that fails because the wiki does not exist yet is the normal first publish. A clone that fails for
  // any other reason — no network, bad credentials, a proxy in the way — is NOT that, and reading it as that
  // was the whole bug: `cloned` stayed false, both drift branches were skipped, and the user was told
  // "Staged N pages" with nothing to say that the human-edit protection had not run. The protection is the
  // only thing standing between a colleague's typo fix in the web UI and a force-overwrite.
  let cloned = false;
  try {
    execFileSync('git', ['clone', '--depth', '1', url, work], { stdio: ['ignore', 'ignore', 'pipe'] });
    cloned = true;
  } catch (err) {
    // Every stream, not the first truthy one. `err.stderr` is a Buffer, and an *empty* Buffer is truthy — so
    // on Windows, where git left stderr empty and put the reason elsewhere, `String(err.stderr)` produced ''
    // and the `|| err.message` fallback never ran. An empty string matches none of the patterns below, so a
    // first publish to a wiki that simply did not exist yet was refused as unreachable, with the reason blank.
    const msg = [err?.stderr, err?.stdout, err?.message]
      .map((v) => (v == null ? '' : String(v)))
      .filter(Boolean).join('\n').trim() || String(err);
    // GitHub answers a wiki that was never created with "remote: Repository not found." and a matching fatal.
    // GitLab answers with "not found". Anything else is a failure to *reach* the wiki, not evidence about it.
    if (!/repository not found|not found|does not exist/i.test(msg)) {
      throw new Error(
        `Could not reach the wiki at ${url}: ${msg.split('\n').filter(Boolean).slice(-1)[0] || msg}\n` +
        `  This is not the same as "the wiki does not exist yet". Publishing would skip the drift check that ` +
        `protects pages edited by hand, so it is refused instead.`);
    }
    fs.mkdirSync(work, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: work, stdio: 'ignore' });
  }

  // --- drift: compare what is there against what we last wrote ---
  const drift = [];
  const manifestPath = path.join(work, MANIFEST);
  const prior = cloned && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  if (prior) {
    for (const [name, rec] of Object.entries(prior.pages || {})) {
      // The manifest lives in the wiki, which anyone with write access can edit. A page name is joined onto a
      // path, so a name is not a label — it is an instruction. Verified: an entry of `"../victim-notes"` made
      // this loop read a file outside the staging directory and surface its contents as "drift", which is
      // published back into the report. Refused and reported rather than skipped: a manifest this tool did not
      // write is exactly the condition the drift check exists to catch.
      if (!isSafePageName(name)) {
        drift.push({ page: String(name), source: rec?.source ?? null, kind: 'unsafe-name',
          detail: 'The manifest names a page that is not a plain page name. It was not read, and nothing here was overwritten.' });
        continue;
      }
      const f = path.join(work, `${name}.md`);
      if (!fs.existsSync(f)) { drift.push({ page: name, source: rec.source, kind: 'deleted' }); continue; }
      const now = fs.readFileSync(f, 'utf8');
      if (sha(now) !== rec.hash) drift.push({ page: name, source: rec.source, kind: 'edited', content: now });
    }
    const knownFiles = new Set(Object.keys(prior.pages || {}).map((n) => `${n}.md`));
    for (const f of fs.readdirSync(work)) {
      if (!f.endsWith('.md') || knownFiles.has(f)) continue;
      drift.push({ page: f.replace(/\.md$/, ''), source: null, kind: 'added', content: fs.readFileSync(path.join(work, f), 'utf8') });
    }
  } else if (cloned && fs.readdirSync(work).some((f) => f.endsWith('.md'))) {
    drift.push({ page: '(entire wiki)', source: null, kind: 'unmanaged',
      detail: 'The wiki has pages but no manifest — it was not written by project-atlas.' });
  }

  if (drift.length && !force) {
    let importDir = null;
    if (importDrift) {
      importDir = path.join(os.tmpdir(), `atlas-wiki-import-${sha(String(Date.now()))}`);
      fs.mkdirSync(importDir, { recursive: true });
      for (const d of drift) {
        if (!d.content) continue;
        // Second gate on the same untrusted name: this one is a write, and `--import` is the path a user takes
        // precisely when the wiki contains something unexpected.
        if (!isSafePageName(d.page)) continue;
        fs.writeFileSync(path.join(importDir, `${d.page}.md`), d.content, 'utf8');
      }
      fs.writeFileSync(path.join(importDir, 'MAPPING.json'), JSON.stringify(drift.map(({ content, ...r }) => r), null, 2), 'utf8');
    }
    return { staged: false, drift, importDir, work, url, slug, driftChecked: cloned };
  }

  // --- write ---
  for (const f of fs.readdirSync(work)) {
    if (f === '.git') continue;
    fs.rmSync(path.join(work, f), { recursive: true, force: true });
  }
  const manifest = { generatedBy: 'project-atlas', source: slug, pages: {} };
  for (const [name, body] of built.pages) {
    fs.writeFileSync(path.join(work, `${name}.md`), body, 'utf8');
    manifest.pages[name] = { source: sourceFor(name, built), hash: sha(body) };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  let pushed = false;
  if (push) {
    execFileSync('git', ['add', '-A'], { cwd: work, stdio: 'ignore' });
    try {
      execFileSync('git', ['-c', 'user.email=atlas@local', '-c', 'user.name=project-atlas',
        'commit', '-qm', `project-atlas: publish ${built.pages.size} page(s)`], { cwd: work, stdio: 'ignore' });
    } catch { /* nothing changed */ }
    if (!cloned) execFileSync('git', ['remote', 'add', 'origin', url], { cwd: work, stdio: 'ignore' });
    // GitHub wikis default to `master`; GitLab wikis to `main`. Pushing to the wrong one silently creates a
    // second branch that the wiki UI never shows, which looks exactly like a push that did nothing.
    const branch = host.kind === 'gitlab' ? 'main' : 'master';
    execFileSync('git', ['push', 'origin', `HEAD:${branch}`], { cwd: work, stdio: 'inherit' });
    pushed = true;
  }

  // `driftChecked` is reported, not inferred by the caller. A publish where it is false is a publish where the
  // human-edit protection did not run, and the only honest reason for that is that there is no wiki yet.
  return { staged: true, pushed, drift: [], work, url, slug, count: built.pages.size,
    collisions: built.collisions, driftChecked: cloned };
}

function sourceFor(name, built) {
  for (const [src, n] of built.nameOf) if (n === name) return src;
  return null;
}

function slugFromRemote(root) {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim();
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ pages */

export function stagePages(root, cfg, { push = false } = {}) {
  const outDir = path.resolve(root, cfg.output);
  if (!fs.existsSync(path.join(outDir, 'index.html'))) throw new Error(`No built site at ${cfg.output}. Run \`atlas build\` first.`);

  const branch = cfg.publish?.pages?.branch || 'gh-pages';
  const slug = cfg.publish?.pages?.slug || slugFromRemote(root);
  const work = path.join(os.tmpdir(), `atlas-pages-${sha(root)}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  copyDir(outDir, work);
  fs.writeFileSync(path.join(work, '.nojekyll'), '');   // without this, Jekyll drops files beginning with _

  let pushed = false;
  if (push) {
    if (!slug) throw new Error('Cannot determine the GitHub repository. Set publish.pages.slug in the config.');
    execFileSync('git', ['init', '-q'], { cwd: work, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: work, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=atlas@local', '-c', 'user.name=project-atlas',
      'commit', '-qm', 'project-atlas: publish site'], { cwd: work, stdio: 'ignore' });
    execFileSync('git', ['push', '--force', `https://github.com/${slug}.git`, `HEAD:${branch}`], { cwd: work, stdio: 'inherit' });
    pushed = true;
  }

  return { work, branch, slug, pushed, url: slug ? `https://${slug.split('/')[0]}.github.io/${slug.split('/')[1]}/` : null };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * GitLab Pages is a CI artifact, not a branch: a job named `pages` must leave the site in `public/`. There is
 * no push to make, so the useful output is the job itself.
 */
export function gitlabPagesJob(cfg) {
  return `# Added by project-atlas. GitLab Pages publishes the \`public/\` artifact of a job named \`pages\`;
# there is no branch to push, which is why \`atlas publish --target pages --push\` refuses on GitLab.
pages:
  image: node:20
  script:
    - node scripts/atlas.mjs build
    - mv ${cfg.output || 'docs/_wiki'} public
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

/* ------------------------------------------------------------------ single-file export */

/**
 * The last gate before a separate file becomes the body of a `<script>` element.
 *
 * `render-shared.mjs::jsonForScript` already escapes `<` out of the search index, so for correct input this
 * is a no-op. It exists because inlining is the sink: the escape lives in the writer and this is the reader,
 * and a future writer that forgets — or a hand-edited `search-index.js` — would otherwise put a live
 * `</script>` into the one artifact this project publishes as an Artifact. `<\/` is valid JavaScript inside a
 * string literal and inside a regex literal, and `</script` cannot legitimately appear anywhere else in JS.
 */
function inlineScript(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Every generated page in one self-contained file, with the navigation working.
 *
 * `exportSingleFile` strips the nav because its links point at sibling files that do not travel with it. That
 * is right for one page and wrong as a destination: the site is nine pages and a menu, and exporting the
 * dashboard alone ships the least useful nine-hundredths of it. Published as an Artifact — which is what this
 * project tells people to do with the export — the reader gets one view and no way to reach the others.
 *
 * So: each page's `<main>` becomes a `<section>`, the nav switches between them in the document, and nothing
 * is fetched.
 *
 * **The reason this is not a concatenation.** Ten pages carry `id="themeToggle"`, seven carry `id="stamp"`,
 * and `dashboard` and `view-product` both carry the items table — `itbl`, `items`, `tq`, `tcount`,
 * `tfilters`. Duplicate ids are invalid HTML and `getElementById` returns the first match, so the second
 * page's script would silently drive the first page's table. Chrome ids are rendered once; colliding content
 * ids are prefixed per page, and that page's own script and CSS are rewritten to match. Anything appearing on
 * exactly one page keeps its name.
 */
export function exportBundle(root, cfg, pages = null, about = {}) {
  const outDir = path.resolve(root, cfg.output);
  const nav = pages || BUNDLE_PAGES.filter((p) => fs.existsSync(path.join(outDir, `${p.file}.html`)));
  if (!nav.length) throw new Error(`No generated pages found in ${cfg.output}. Run \`atlas build\` first.`);

  // The document pages too, though not in the menu. The Wiki page is a list of 27 documents and every entry
  // pointed at `pages/<name>.html` — a path that does not exist once the file travels alone, so every one of
  // them was a dead link. A bundle that carries the index of a corpus and not the corpus is a table of
  // contents for a book you did not bring.
  const docsDir = path.join(outDir, 'pages');
  const docs = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir).filter((f) => f.endsWith('.html')).sort()
        // A posix separator, deliberately, and not `path.join`. `from` is an identity that gets *compared*
        // (`from.startsWith('pages/')` decides how a link inside a document page resolves), not only a path
        // that gets read. On Windows `path.join` made it `pages\A.html`, that comparison went false for every
        // document, and each one's links to its siblings were left pointing at files no bundle carries.
        // Reading still works: path.join(outDir, 'pages/A.html') is valid on every platform.
        .map((f) => ({ file: `doc--${f.slice(0, -5)}`, label: null, from: `pages/${f}` }))
    : [];
  const all = [...nav.map((p) => ({ ...p, from: `${p.file}.html` })), ...docs];

  // Ids carried by more than one page. Chrome is deduplicated; the rest are prefixed.
  const seen = new Map();
  for (const p of all) {
    const html = fs.readFileSync(path.join(outDir, p.from), 'utf8');
    for (const id of new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))) {
      seen.set(id, (seen.get(id) || 0) + 1);
    }
  }
  const collides = new Set([...seen].filter(([id, n]) => n > 1 && !CHROME_IDS.has(id)).map(([id]) => id));

  const known = new Set(all.map((p) => p.file));

  const sections = all.map((p, i) => {
    let html = fs.readFileSync(path.join(outDir, p.from), 'utf8');
    const body = /<main>([\s\S]*?)<\/main>/.exec(html);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    let inner = body ? body[1] : '';
    let js = scripts.join('\n');
    // **A page's own <style> is not optional decoration.** `atlas.css` is the base; the dashboard and every
    // role view add ~130 lines on top of it — the cards, the tiles, the bar charts. Collecting only <main>
    // and <script> shipped the markup and the behaviour with none of the presentation, and the result read as
    // an unstyled outline: every number present, every chart gone.
    let pageCss = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

    for (const id of collides) {
      const to = `${p.file}--${id}`;
      inner = inner.split(`id="${id}"`).join(`id="${to}"`);
      // The page's own script and any selector it uses. Both quote styles, and `#id` inside CSS or a query.
      js = js.split(`'${id}'`).join(`'${to}'`).split(`"${id}"`).join(`"${to}"`)
             .split(`#${id}`).join(`#${to}`);
      inner = inner.split(`#${id}`).join(`#${to}`);
      pageCss = pageCss.split(`#${id}`).join(`#${to}`);      // `#itbl thead tr:first-child th { … }`
    }
    // **Links inside the pages, not just the menu.** Rewriting the nav and stopping there left every
    // in-body cross-page link pointing at a file that does not exist beside a single document — "Open the
    // wiki →" on the home page, and all 61 document links on the Wiki page. They resolved to nothing.
    // A sub-anchor is dropped rather than faked: the router addresses pages, and inventing `#page#heading`
    // would produce a link that looks precise and lands nowhere.
    // **The target depends on which page the link sits in.** A document page lives in `pages/`, so its link
    // to a sibling document is a bare `README.html` while the same link from the Wiki index is
    // `pages/README.html`, and `../wiki.html` climbs back out. Resolving all three the same way left a third
    // of the links dead — the ones that only appear once you click into a document.
    const fromDoc = p.from.startsWith('pages/');
    inner = inner.replace(/href="(\.\.\/)?(?:\.\/)?(pages\/)?([\w.-]+)\.html(?:#[\w-]*)?"/g,
      (whole, up, inPages, name) => {
        const target = inPages ? `doc--${name}` : (up ? name : (fromDoc ? `doc--${name}` : name));
        return known.has(target) ? `href="#${target}" data-go="${target}"` : whole;
      });

    // The build-stamp poll has nothing to poll against, and only one stamp is rendered.
    js = js.replace(/poll\(\); setInterval\(poll, \d+\);/, '/* live reload disabled in bundle */');
    return { ...p, inner, js, pageCss, first: i === 0 };
  });

  const css = fs.readFileSync(path.join(outDir, 'atlas.css'), 'utf8');
  const searchPath = path.join(outDir, 'search-index.js');
  const search = fs.existsSync(searchPath) ? inlineScript(fs.readFileSync(searchPath, 'utf8')) : '';
  const title = escapeHtml(cfg.siteTitle || 'project-atlas');
  sections.push({ file: 'about', label: 'About', inner: aboutSection(about, title), js: '', first: false });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css}
${[...new Set(sections.map((s) => (s.pageCss || '').trim()).filter(Boolean))].join('\n')}
[data-page] { display:none; }
[data-page].on { display:block; }
.topbar nav a.on { color:var(--ink); font-weight:620; }
.built-by { font-size:12.5px; color:var(--mut); white-space:nowrap; }
.built-by .sep { opacity:.5; }
.updbar {
  display:flex; gap:12px; align-items:baseline; flex-wrap:wrap;
  padding:9px max(3%, calc((100% - var(--maxw)) / 2));
  background:var(--surface-3); border-bottom:1px solid var(--bd); font-size:13.5px; color:var(--fg-soft);
}
.updbar strong { color:var(--fg); }
.about-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin:18px 0; }
@media (max-width:700px) { .built-by { display:none; } }
</style>
</head>
<body>
${updateBar(about)}
<header class="topbar">
  <span class="brand">${title}</span>
  <span class="built-by">${escapeHtml(about.tool || 'project-atlas')} ${escapeHtml(about.version || '')}${
    about.model ? ` <span class="sep">·</span> ${escapeHtml(about.model)}` : ''}</span>
  <nav>
${sections.filter((s) => s.label).map((s) => `    <a href="#${s.file}" data-go="${s.file}"${s.first ? ' class="on" aria-current="page"' : ''}>${escapeHtml(s.label)}</a>`).join('\n')}
  </nav>
  <button type="button" class="theme-toggle" id="themeToggle" aria-label="Theme: system"></button>
</header>
${sections.map((s) => `<main data-page="${s.file}"${s.first ? ' class="on"' : ''}>\n${s.inner}\n</main>`).join('\n')}
<footer>Generated by <strong>${title}</strong>. This page is derived — edit the markdown, not this file.</footer>
${search ? `<script>${search}</script>` : ''}
${sections.map((s) => `<script>${inlineScript(s.js)}</script>`).join('\n')}
<script>(function(){
  var links = document.querySelectorAll('[data-go]');
  function show(name){
    var found = false;
    document.querySelectorAll('[data-page]').forEach(function(m){
      var on = m.getAttribute('data-page') === name; m.classList.toggle('on', on); if (on) found = true;
    });
    if (!found) return false;
    links.forEach(function(a){
      var on = a.getAttribute('data-go') === name;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
    return true;
  }
  links.forEach(function(a){
    a.addEventListener('click', function(e){ e.preventDefault(); var n = a.getAttribute('data-go');
      if (show(n)) { try { history.replaceState(null,'','#'+n); } catch(err){} } });
  });
  // An unknown or absent fragment leaves the first page showing rather than a blank document.
  if (location.hash) show(location.hash.slice(1));
  window.addEventListener('hashchange', function(){ show(location.hash.slice(1)); });
})();</script>
<script>(function(){
  var KEY='atlas-theme', root=document.documentElement, btn=document.getElementById('themeToggle');
  if(!btn) return;
  var order=['auto','light','dark'], glyph={auto:'\\u25D0',light:'\\u2600',dark:'\\u263E'};
  var name={auto:'system',light:'light',dark:'dark'}, cur='auto';
  try{ var v=localStorage.getItem(KEY); if(v==='light'||v==='dark') cur=v; }catch(e){}
  function paint(){
    if(cur==='auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme',cur);
    btn.textContent=glyph[cur];
    btn.setAttribute('aria-label','Theme: '+name[cur]+'. Click to change.');
  }
  paint();
  btn.addEventListener('click',function(){
    cur=order[(order.indexOf(cur)+1)%order.length];
    try{ localStorage.setItem(KEY,cur); }catch(e){}
    paint();
  });
})();</script>
</body>
</html>
`;
}

/**
 * The update row, rendered only when the build already knew an update existed.
 *
 * **A static file cannot check anything.** It is generated once and then read, possibly weeks later, and an
 * Artifact runs under a policy that blocks every outbound request anyway. So this states what was true at
 * build time and dates it, rather than implying it is live. When the build had no answer — offline, never
 * checked — there is no row at all: a page that cannot know must not reassure.
 */
function updateBar(about) {
  // Ordering, not inequality. `latest !== version` also fires when the build is *ahead* of the last published
  // release — which is the normal state on a machine that just cut one — and told the reader to upgrade 0.1.5
  // to 0.1.3. Only an actually-newer published version earns a row.
  if (!about.latest || !about.version || compareVersions(about.version, about.latest) !== -1) return '';
  const help = about.help || 'https://github.com/rmaurya/project-atlas#updating';
  return `<div class="updbar" role="status">
  <span><strong>${escapeHtml(about.tool || 'project-atlas')} ${escapeHtml(about.latest)}</strong> was available when this page was generated — it was built with ${escapeHtml(about.version)}.</span>
  <a href="${escapeHtml(help)}" rel="noopener">How to update</a>
  ${about.checkedAt ? `<span class="cap">checked ${escapeHtml(about.checkedAt)}</span>` : ''}
</div>
`;
}

/** The About page. Everything a reader needs to know about what made this, and what it refuses to claim. */
function aboutSection(about, title) {
  const rows = [
    ['Tool', `${escapeHtml(about.tool || 'project-atlas')} ${escapeHtml(about.version || 'unknown')}`],
    ['Generated', escapeHtml(about.generatedAt || 'unknown')],
    ['Commit', about.commit ? `<code>${escapeHtml(about.commit)}</code>` : '<span class="cap">not a git checkout</span>'],
    ['Assisted by', about.model ? escapeHtml(about.model) : '<span class="cap">no model trailer found in history</span>'],
    ['Latest known', about.latest
      ? escapeHtml(about.latest)
        + (about.checkedAt ? ` <span class="cap">(checked ${escapeHtml(about.checkedAt)})</span>` : '')
        // Saying "latest 0.1.3" beside "tool 0.1.5" reads as a contradiction unless the page explains it.
        + (compareVersions(about.version, about.latest) === 1
            ? ' <span class="cap">— this build is ahead of the published release</span>' : '')
      : '<span class="cap">not checked — this file makes no network request</span>'],
  ];
  const links = (about.links || []).map((l) =>
    `<li><a href="${escapeHtml(l.href)}" rel="noopener">${escapeHtml(l.label)}</a>${l.note ? ` <span class="cap">— ${escapeHtml(l.note)}</span>` : ''}</li>`).join('\n      ');
  const people = (about.people || []).map((p) =>
    `<li>${escapeHtml(p.name)} <span class="cap">${p.commits} commit(s)${p.ai ? ` · ${p.ai} AI-assisted` : ''}</span></li>`).join('\n      ');

  return `
<h1>About</h1>
<p class="lede">What generated this page, what it is derived from, and what it deliberately does not claim.</p>

<section class="card">
  <h2>Version</h2>
  <div class="table-wrap"><table class="mini-table"><tbody>
    ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('\n    ')}
  </tbody></table></div>
</section>

<div class="about-grid">
  <section class="card">
    <h2>Links</h2>
    <ul class="linklist">
      ${links || '<li><span class="cap">No repository remote was configured.</span></li>'}
    </ul>
  </section>

  <section class="card">
    <h2>Contributors</h2>
    <p class="cap">From <code>git log</code>. Listed, not ranked — there is deliberately no contribution score.</p>
    <ul class="linklist">
      ${people || '<li><span class="cap">No commit history available.</span></li>'}
    </ul>
  </section>
</div>

<section class="card muted">
  <h2>What this is</h2>
  <p>Every page here is <strong>derived</strong> from the markdown committed in this repository. Delete the
  output directory, rebuild, and you get the same bytes back. Nothing on this site is the only copy of
  anything — to change a page, change the document behind it.</p>
  <p>The figures come from the files and from <code>git log</code>. None of them is a measure of prompt
  quality or of difficulty: a repository cannot see a prompt, and a turn on a hard problem and a turn on a
  typo count the same.</p>
  <p class="cap">Generated by ${title}. Licensed MIT.</p>
</section>
`;
}

/** The pages a bundle carries, in the order the nav shows them. Absent ones are skipped, never faked. */
export const BUNDLE_PAGES = [
  { file: 'index', label: 'Home' },
  { file: 'dashboard', label: 'Overview' },
  { file: 'view-qc', label: 'Quality' },
  { file: 'view-product', label: 'Product' },
  { file: 'view-delivery', label: 'Delivery' },
  { file: 'view-architecture', label: 'Architecture' },
  { file: 'view-developer', label: 'Developer' },
  { file: 'view-executive', label: 'Executive' },
  { file: 'wiki', label: 'Wiki' },
  { file: 'health', label: 'Health' },
];

/**
 * Rendered once for the whole bundle, so ten copies do not fight over one name.
 *
 * Only the toggle qualifies, and only because it lives in the topbar, which is rebuilt here rather than
 * carried over from any page. `stamp` looked like chrome and is not: it sits inside each page's `<main>`, so
 * exempting it left seven elements sharing an id and six of them unreachable. Chrome means *outside the body
 * this bundle copies* — not *looks like furniture*.
 */
const CHROME_IDS = new Set(['themeToggle']);

/** Inline the stylesheet and search index into one HTML file, for anywhere that takes a single document. */
export function exportSingleFile(root, cfg, which = 'dashboard') {
  const outDir = path.resolve(root, cfg.output);
  const src = path.join(outDir, `${which}.html`);
  if (!fs.existsSync(src)) throw new Error(`${which}.html not found in ${cfg.output}. Run \`atlas build\` first.`);

  let html = fs.readFileSync(src, 'utf8');
  const css = fs.readFileSync(path.join(outDir, 'atlas.css'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="[^"]*atlas\.css">/, `<style>\n${css}\n</style>`);
  html = html.replace(/<script src="[^"]*search-index\.js"><\/script>/, () => {
    const p = path.join(outDir, 'search-index.js');
    return fs.existsSync(p) ? `<script>${inlineScript(fs.readFileSync(p, 'utf8'))}</script>` : '';
  });
  // Sibling pages do not exist beside a standalone file, so every cross-page link would be dead. Strip the
  // navigation and demote the brand to plain text rather than shipping links that go nowhere.
  //
  // **Keep the controls that are not links.** The theme toggle lives inside <nav> but acts on this page alone,
  // and removing it while still shipping its script left the export with `if (!btn) return;` — no toggle, and
  // a saved light preference silently ignored because `paint()` sits after that return. The export always
  // rendered in whatever the OS asked for, with no way to change it. Anything in there that is not an <a> is
  // a same-page control and survives.
  html = html.replace(/<nav>([\s\S]*?)<\/nav>/, (_, inner) => {
    const kept = inner.replace(/<a\b[\s\S]*?<\/a>/g, '').trim();
    return kept ? `<nav>${kept}</nav>` : '';
  });
  html = html.replace(/<a class="brand" href="[^"]*">([\s\S]*?)<\/a>/, '<span class="brand">$1</span>');
  // The build stamp poll has nothing to poll against outside the site directory.
  html = html.replace(/poll\(\); setInterval\(poll, \d+\);/, '/* live reload disabled in standalone export */');
  return html;
}
