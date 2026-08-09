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

export function stageWiki(root, cfg, built, { push = false, force = false, importDrift = false } = {}) {
  const slug = cfg.publish?.wiki?.slug || slugFromRemote(root);
  if (!slug) throw new Error('Cannot determine the GitHub repository. Set publish.wiki.slug ("owner/repo") in the config.');
  const url = `https://github.com/${slug}.wiki.git`;

  const work = path.join(os.tmpdir(), `atlas-wiki-${sha(root + slug)}`);
  fs.rmSync(work, { recursive: true, force: true });

  let cloned = false;
  try {
    execFileSync('git', ['clone', '--depth', '1', url, work], { stdio: 'ignore' });
    cloned = true;
  } catch {
    fs.mkdirSync(work, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: work, stdio: 'ignore' });
  }

  // --- drift: compare what is there against what we last wrote ---
  const drift = [];
  const manifestPath = path.join(work, MANIFEST);
  const prior = cloned && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  if (prior) {
    for (const [name, rec] of Object.entries(prior.pages || {})) {
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
        fs.writeFileSync(path.join(importDir, `${d.page}.md`), d.content, 'utf8');
      }
      fs.writeFileSync(path.join(importDir, 'MAPPING.json'), JSON.stringify(drift.map(({ content, ...r }) => r), null, 2), 'utf8');
    }
    return { staged: false, drift, importDir, work, url, slug };
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
    execFileSync('git', ['push', 'origin', 'HEAD:master'], { cwd: work, stdio: 'inherit' });
    pushed = true;
  }

  return { staged: true, pushed, drift: [], work, url, slug, count: built.pages.size, collisions: built.collisions };
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

/* ------------------------------------------------------------------ single-file export */

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
    return fs.existsSync(p) ? `<script>${fs.readFileSync(p, 'utf8')}</script>` : '';
  });
  // Sibling pages do not exist beside a standalone file, so every cross-page link would be dead. Strip the
  // navigation and demote the brand to plain text rather than shipping links that go nowhere.
  html = html.replace(/<nav>[\s\S]*?<\/nav>/, '');
  html = html.replace(/<a class="brand" href="[^"]*">([\s\S]*?)<\/a>/, '<span class="brand">$1</span>');
  // The build stamp poll has nothing to poll against outside the site directory.
  html = html.replace(/poll\(\); setInterval\(poll, \d+\);/, '/* live reload disabled in standalone export */');
  return html;
}
