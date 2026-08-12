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
// The bundle re-implements the site shell, so anything the shell gains must be added here too — which is
// exactly how the brand mark reached every generated page and missed the artifact.
import { MARK, FAVICON } from './render.mjs';
import { compare as compareVersions } from './version.mjs';
import { num } from './format.mjs';

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
    .replace(/^-|-$/g, '')
    // A leading dot, stripped, because `isSafePageName` refuses one and this function must never produce a
    // name its own reader rejects. `.github/DISCUSSIONS-WELCOME.md` became `.github-DISCUSSIONS-WELCOME`,
    // which published fine and then failed to read back: every later publish reported atlas's own page as a
    // manifest it did not write, refused, and skipped the drift check for it — the protection reading as
    // tampering because the writer and the reader disagreed about one character.
    .replace(/^\.+/, '') || 'Untitled';
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
  L.push(`> **This wiki is generated.** ${index.stats.documents} documents · ${num(index.stats.lines)} lines · ` +
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
    //
    // "does not appear to be a git repository" is the same finding in git's other voice, and which voice you
    // get depends on the platform: for a target that is not there, POSIX git says "does not exist" while
    // Windows git reports it through the remote-helper path instead. The classification must not depend on
    // which wording the platform chose — it says the target is not a repository, which is the first-publish
    // case. It stays distinct from the failures this branch exists to catch: no credentials, a proxy, or a
    // refused connection say "Permission denied", "Authentication failed" or "could not read Username", and
    // none of them claim anything about whether a repository is there.
    if (!/repository not found|not found|does not exist|does not appear to be a git repository/i.test(msg)) {
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

  /*
   * **This is the target where getting it wrong is public and permanent-ish.**
   *
   * `copyDir` copies the built site verbatim, which is right for everything the corpus produced and wrong for
   * the panels that describe the machine that ran the build. The dashboard grew a work-in-flight panel and a
   * session task list, and a copy of those went straight into a directory whose whole purpose is to be served
   * on the open internet: the subject lines of a private task list, and the path of every uncommitted file.
   *
   * The export path strips them too, and the export is the *safer* of the two — someone chooses to hand that
   * file to somebody. This one force-pushes to a branch a search engine indexes. So the strip runs here on
   * every HTML file in the staged tree, before `--push` is even considered, and it runs on **staging** rather
   * than at push time: staging is what a person inspects to decide whether to push, so a staged tree that
   * still contained the private panels would be reviewed as safe and then pushed.
   *
   * **This is the third exit door, and for a long time it was the untested one.** `stripLocalOnly` is reached
   * from `exportSingleFile`, from `exportBundle`, and from here — and the coverage claim that justified
   * narrowing the marker to an attribute named the first two and called them "both". The one it left out is
   * the one that force-pushes. It throws rather than returning on anything it cannot strip, so a refusal here
   * ends the publish with the staged tree half-written and nothing pushed, which is the outcome to want.
   */
  stripLocalOnlyTree(work);

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

/**
 * Apply `stripLocalOnly` to every HTML file in a staged tree, in place — and then check every file of every
 * kind, because "HTML file" is this function's guess about where a marker can be, not a fact about the tree.
 *
 * The staged tree for this repository is 197 files, 93 of them HTML. The other 104 were copied to a branch
 * that is force-pushed to the open internet without being read at all. Nothing marked is expected in them —
 * markdown has no attributes to carry a marker — but "nothing is expected there" is exactly the reasoning that
 * left `exportBundle` unstripped for a release, so the sweep is over everything and its cost is one pass.
 *
 * `root` is passed down only so the error can name the file by its path within the tree rather than by a
 * temp-directory absolute nobody recognises.
 */
export function stripLocalOnlyTree(dir, root = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { stripLocalOnlyTree(p, root); continue; }
    const rel = path.relative(root, p).split(path.sep).join('/');

    let before;
    try { before = fs.readFileSync(p, 'utf8'); } catch { continue; }   // unreadable or not text; nothing to scan

    if (/\.html?$/i.test(e.name)) {
      const after = stripLocalOnly(before, `${rel} in the staged site`);
      if (after !== before) fs.writeFileSync(p, after, 'utf8');
      continue;
    }
    assertNoLocalOnly(before, `${rel} in the staged site`);
  }
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
/**
 * Remove panels that describe *this machine* before anything leaves it.
 *
 * **Found by trying to publish.** The dashboard gained a work-in-flight panel and a session task list on the
 * same day someone asked for a public link to it, and the standalone export came out carrying the literal
 * subject lines of a private task list — "Build the TUHI orchestrator in MCP-Server" — plus the paths of every
 * uncommitted file in the working tree. Nobody had done anything wrong: each panel is correct, derived, and
 * exactly right on a dashboard served to loopback. The mistake was assuming one built page suits both
 * audiences.
 *
 * The distinction the rest of this project already draws is *corpus* versus *local state*. The journal never
 * publishes and `assertUnpublished()` enforces it rather than trusting it; personal handoffs default to
 * unpublished because a half-formed working note does not belong on a public wiki because somebody ran a
 * publish. Work in flight is the same category — it is true, it is useful, and it is nobody else's business.
 *
 * Keyed on `data-local-only`, an explicit marker a panel opts into, rather than on an id or a class. Ids and
 * classes change for layout reasons by people who are not thinking about publishing, and a stripper that
 * silently stops matching is worse than no stripper: it fails open, quietly, on the one path where the cost
 * of failing is that private state is already public.
 *
 * ## The marker is an attribute, and only an attribute
 *
 * This scanned for the bare substring, so **any page that merely named `data-local-only` in prose lost the
 * element containing it — from the published copy only.** The roadmap says *"The view carries
 * `data-local-only`, the same guarantee as…"*; published, that sentence read *"The view carries , the same
 * guarantee as…"*, because the `<code>` span around the marker's own name was cut out. The dashboard has a
 * comment recording the same thing happening to a card that documented the mechanism, and the caption on the
 * economics view was reworded around it rather than fixed.
 *
 * It is the worst-shaped failure in this file: it deletes content **silently**, from the artefact handed to
 * other people and not from the copy the author is looking at, and it fails in the direction nobody checks —
 * everybody tests that the private panel is gone, nobody tests that the public paragraph is still there. The
 * documents most likely to trip it are the ones explaining the boundary, which is to say the documents whose
 * whole subject is what does and does not get published.
 *
 * So a match now requires the attribute form: the marker preceded by whitespace inside a start tag, with
 * quoted attribute values consumed whole so a marker named inside one (`title="uses data-local-only"`) is a
 * value and not a marker, and `>` never crossed so text between tags can never be read as an attribute.
 * `(?![\w-])` rather than `\b`, because `\b` matches before a hyphen and would let a future
 * `data-local-only-reason` trigger a strip of the element carrying it.
 *
 * **This narrows what matches, so it is exactly the kind of change that can fail open.** It cannot fail open
 * here for the reason that matters: every marker this project emits is written as `data-local-only="1"` in a
 * start tag, which is the form that still matches, and both exit doors — `exportSingleFile` and
 * `exportBundle` — are tested against a real marked element on disk, not only against the matcher.
 */
const LOCAL_ONLY = /<([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^>"'])*?\sdata-local-only(?![\w-])/i;

/**
 * Elements HTML gives no closing tag. **This list is the whole of defect one**, and it is worth being precise
 * about why: the walker below looked for `</img>`, never found one, and *returned the entire document
 * unmodified* — every marked panel on it, silently, with no error and no changed byte to notice in review. One
 * `<img data-local-only="1">` in a header therefore published the work-in-flight panel, the session task list,
 * 61 local branch names and the operator's home directory through all four exit doors at once. The renderers
 * already emit void elements seven times over; the marker landing on one was a matter of time.
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Thrown rather than returned. See `stripLocalOnly`: this stripper has no way to fail quietly. */
class LocalOnlyStripError extends Error {}

/**
 * The index just past the `>` that ends the start tag beginning at `from`, or -1 if the tag never ends.
 *
 * Quoted attribute values are consumed whole, so a `>` inside `title="a > b"` does not end the tag. That is
 * the same rule `LOCAL_ONLY` uses to find the marker, and the two must agree or the walker would start
 * counting depth from the middle of an attribute value.
 */
function endOfStartTag(html, from) {
  for (let i = from + 1; i < html.length; i++) {
    const ch = html[i];
    if (ch === '"' || ch === "'") {
      const close = html.indexOf(ch, i + 1);
      if (close === -1) return -1;
      i = close;
      continue;
    }
    if (ch === '>') return i + 1;
  }
  return -1;
}

/**
 * The index just past the `</tag>` that closes the element opened at `open`, or -1 if it is not there.
 *
 * Depth is counted over a real scan rather than `indexOf`, which is what the four remaining triggers were:
 * `<!-- <section -->` inside a panel counted as a nested open, a `>` inside an attribute value ended a tag
 * early, `<section-detail>` matched `<section\b` because `\b` matches before a hyphen, and a self-closing
 * `<section/>` incremented a depth nothing would ever decrement. Each one drove the count off by one, the
 * closing tag ran out, and the function above returned the document whole.
 */
function endOfElement(html, tag, open, afterOpenTag) {
  const re = new RegExp(`<!--|<${tag}(?![\\w-])|</${tag}(?![\\w-])`, 'gi');
  re.lastIndex = afterOpenTag;
  let depth = 1;
  for (;;) {
    const t = re.exec(html);
    if (!t) return -1;
    if (t[0] === '<!--') {
      const end = html.indexOf('-->', t.index + 4);
      if (end === -1) return -1;                     // an unterminated comment swallows the rest of the file
      re.lastIndex = end + 3;
      continue;
    }
    if (t[0][1] === '/') {
      const end = html.indexOf('>', t.index);
      if (end === -1) return -1;
      if (--depth === 0) return end + 1;
      re.lastIndex = end + 1;
      continue;
    }
    const end = endOfStartTag(html, t.index);
    if (end === -1) return -1;
    if (html[end - 2] !== '/') depth++;              // `<section/>` opens nothing
    re.lastIndex = end;
  }
}

/**
 * Every element carrying the marker, removed — or an exception. There is no third outcome.
 *
 * **The failure this replaces.** The walker returned `out` from the *function* the moment it could not find a
 * closing tag, not from the loop over that one element. So the first marker it could not walk abandoned
 * stripping for the whole document and handed back the input byte-for-byte, with no error, no warning and
 * nothing in the output to compare against. Every caller treated that as a successful strip, because a
 * successful strip and a total abdication are the same value.
 *
 * That shape — a guard whose failure is indistinguishable from its success — is the thing being fixed here,
 * more than any one of the five inputs that triggered it. So:
 *
 *  - **The loop cannot end early.** It ends when `LOCAL_ONLY` no longer matches, which is the definition of
 *    the job being done. Nothing else returns.
 *  - **Anything it cannot walk throws.** A marked element whose start tag never ends, or whose closing tag is
 *    not there, means the document is not shaped the way this function must understand it to be safe. Refusing
 *    to publish is recoverable; publishing the panel is not.
 *  - **Every exit door re-checks its own output** with `assertNoLocalOnly`, against the bytes it is about to
 *    hand over rather than against this function's promise. Before this, `LOCAL_ONLY` appeared nowhere but
 *    inside this function and not one caller verified anything.
 */
export function stripLocalOnly(html, where = 'this document') {
  let out = html;
  for (;;) {
    const m = LOCAL_ONLY.exec(out);
    if (!m) break;
    const open = m.index;
    const tag = m[1].toLowerCase();

    const afterOpenTag = endOfStartTag(out, open);
    if (afterOpenTag === -1) throw refuseToStrip(where, tag, out, open, 'its start tag is never closed by a `>`');

    // A void element and a self-closing one have no closing tag to walk to, and looking for one is what
    // abandoned the document. Cut the tag itself; there is nothing else to cut.
    if (VOID_ELEMENTS.has(tag) || out[afterOpenTag - 2] === '/') {
      out = out.slice(0, open) + out.slice(afterOpenTag);
      continue;
    }

    const end = endOfElement(out, tag, open, afterOpenTag);
    if (end === -1) throw refuseToStrip(where, tag, out, open, `no matching \`</${tag}>\` follows it`);
    out = out.slice(0, open) + out.slice(end);
  }
  assertNoLocalOnly(out, where);
  return out;
}

function refuseToStrip(where, tag, html, open, why) {
  return new LocalOnlyStripError(
    `Refusing to publish ${where}: it carries a \`data-local-only\` <${tag}> that cannot be removed — ${why}.\n` +
    `  ${JSON.stringify(html.slice(open, open + 120))}\n` +
    `  This marker is the only thing keeping work-in-flight, session tasks, local branch names and working-tree\n` +
    `  paths out of a published copy. A partial strip is not a safe fallback, so nothing is published from here\n` +
    `  until the markup is balanced.`);
}

/**
 * The last look, taken by the caller at the bytes it is about to hand over.
 *
 * Deliberately not a claim that `stripLocalOnly` ran — it is a claim about the output. Both exports assemble
 * their result out of several stripped pages plus a shell, a search index and per-page scripts, and the
 * staged tree is a verbatim copy of a directory; each of those is a chance for a marked element to arrive
 * after the strip, by a route no future reader of `stripLocalOnly` would think to check.
 */
export function assertNoLocalOnly(html, where) {
  const m = LOCAL_ONLY.exec(html);
  if (!m) return html;
  throw new LocalOnlyStripError(
    `Refusing to publish ${where}: a \`data-local-only\` element survived the strip.\n` +
    `  ${JSON.stringify(html.slice(m.index, m.index + 120))}\n` +
    `  This is a bug in the publisher, not in the page. Nothing is written or pushed.`);
}

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

  /**
   * **Every page is read through the stripper, and this is the only place any page is read.**
   *
   * `exportSingleFile` has stripped `data-local-only` since the incident that created the marker — a
   * standalone export handed to someone with a private task list and every uncommitted path in it. This
   * function is the *other* export, the one `--target export` reaches with `which === 'all'`, and it never
   * stripped anything: it read each page straight off disk, so the in-flight panel travelled in the bundle
   * on all five views that carry it. Same command, same promise on the tin, opposite behaviour.
   *
   * Read twice — once to count colliding ids, once to build the section — and the strip has to happen on
   * both or the id census counts ids belonging to markup that will not be in the output, and prefixes
   * survivors against collisions that no longer exist. One helper, so the two passes cannot drift.
   */
  const readPage = (p) => stripLocalOnly(fs.readFileSync(path.join(outDir, p.from), 'utf8'), `${p.from} in the bundle`);

  // Ids carried by more than one page. Chrome is deduplicated; the rest are prefixed.
  const seen = new Map();
  for (const p of all) {
    for (const id of new Set([...readPage(p).matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))) {
      seen.set(id, (seen.get(id) || 0) + 1);
    }
  }
  const collides = new Set([...seen].filter(([id, n]) => n > 1 && !CHROME_IDS.has(id)).map(([id]) => id));

  const known = new Set(all.map((p) => p.file));

  const sections = all.map((p, i) => {
    let html = readPage(p);
    const body = /<main>([\s\S]*?)<\/main>/.exec(html);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    let inner = body ? body[1] : '';
    let js = scripts.join('\n');

    // **A snapshot must not carry the code that makes a page live.**
    //
    // The export bundles each page's own script, and one of those scripts polls `build-stamp.txt` and
    // patches the page in place. In a single file served from anywhere but the build directory that fetch
    // can never succeed — so the export shipped a live-update mechanism that was guaranteed dead, and said
    // nothing about it. Someone reading `all.standalone.html` on a local server had a frozen copy of the
    // corpus, a "live" mechanism that had silently given up after three failed polls, and no build time
    // anywhere on the page to reveal how old it was. They reported the dashboard as never updating, and
    // they were right: it never could. The generated site was fine the whole time, which is what made it
    // take three rounds to find.
    //
    // So the poller is switched off and the banner below states what the file is. A snapshot is a legitimate
    // thing to want — it travels, it needs no server, it is what an artifact is for. What is not legitimate
    // is a snapshot that looks like a live page.
    //
    // Switched off by a flag the poller checks, not by cutting the code out with a regex. A first attempt
    // did the latter and silently matched nothing, because it encoded the exact punctuation of a function
    // it does not own — the bundle reported success and shipped the dead poller anyway. A flag cannot
    // half-work: either the poller reads it or the test that asserts it fails.
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
  sections.push({ file: 'about', label: 'About',
    inner: aboutSection(about, title, legalPages(all, outDir)), js: '', first: false });

  // Ten stripped pages, plus a shell, a search index and every page's own script — assembled here, so the
  // assembly is what gets checked. `assertNoLocalOnly` returns the string it was given.
  return assertNoLocalOnly(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="${FAVICON}">
<style>
${css}
${[...new Set(sections.map((s) => (s.pageCss || '').trim()).filter(Boolean))].join('\n')}
[data-page] { display:none; }
[data-page].on { display:block; }
.topbar nav a.on { color:var(--ink); font-weight:620; }
/* Stated at the top of the page rather than in a footer nobody scrolls to. It is the one fact a reader of
   a detached file cannot recover any other way, and not knowing it cost three rounds of "it is there" /
   "I cannot see it". Muted, not alarming: a snapshot is a legitimate thing to be. */
.snapshot-bar { margin:0; padding:8px 20px; font-size:13px; line-height:1.5;
  background:var(--surface-2, #f2efe9); color:var(--ink-soft, #57534e);
  border-bottom:1px solid var(--rule, #e0dcd3); }
.snapshot-bar code { font-size:12px; }
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
<script>window.__ATLAS_SNAPSHOT__ = true;</script>
<p class="snapshot-bar">Snapshot${about.generatedAt ? ` of ${escapeHtml(about.generatedAt)}` : ''} — this file is frozen and cannot update itself. For the current state, open the generated site or run <code>atlas watch --serve</code>.</p>
<header class="topbar">
  <span class="brand">${title}</span>
  <span class="built-by">${escapeHtml(about.tool || 'project-atlas')} ${escapeHtml(about.version || '')}${
    about.model ? ` <span class="sep">·</span> ${escapeHtml(about.model)}` : ''}</span>
  <nav>
${sections.filter((s) => s.label).map((s) => `    <a href="#${s.file}" data-go="${s.file}"${s.first ? ' class="on" aria-current="page"' : ''}>${escapeHtml(s.label)}</a>`).join('\n')}
  </nav>
  <time class="clock" id="clock" aria-live="off"></time>
  <button type="button" class="theme-toggle" id="themeToggle" aria-label="Theme: system"></button>
</header>
${sections.map((s) => `<main data-page="${s.file}"${s.first ? ' class="on"' : ''}>\n${s.inner}\n</main>`).join('\n')}
<footer><p class="genby">${MARK}<span>Generated by <strong class="wordmark"><span>project-</span>atlas</strong>. This page is derived — edit the markdown, not this file.</span></p></footer>
${search ? `<script>${search}</script>` : ''}
${sections.map((s) => `<script>${inlineScript(s.js)}</script>`).join('\n')}
<script>(function(){
  var links = document.querySelectorAll('[data-go]');
  function show(name){
    // Find the page BEFORE touching anything. The previous version toggled every page off while looking,
    // so a hash that is not a page id — a cluster chip, a table-of-contents entry, any heading anchor —
    // hid the entire bundle and left a blank document. In a single file every in-page anchor arrives here,
    // so this is the common case rather than an edge one.
    var panes = document.querySelectorAll('[data-page]');
    var match = null;
    panes.forEach(function(m){ if (m.getAttribute('data-page') === name) match = m; });
    if (!match) {
      // Not a page: an ordinary anchor. Leave the visible page alone and scroll to it, which is what the
      // same link does on the generated site.
      var el = name && document.getElementById(name);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      return false;
    }
    panes.forEach(function(m){ m.classList.toggle('on', m === match); });
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
`, 'the standalone bundle');
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

/**
 * The corpus's own legal documents, found among the pages the bundle is already carrying.
 *
 * **Discovered, never assumed.** The obvious implementation names `docs/legal/TERMS.md` and friends and links
 * them — which produces four dead entries in every repository that is not this one, on a page whose whole
 * purpose is to say what a reader can and cannot rely on. So the list is built from `all`, the pages that
 * actually travel with the file: a link appears only when the section it points at is in the same document.
 * A corpus with no legal documents gets a sentence saying so, which is the honest answer and is also true.
 *
 * The label comes from the page's `<title>` rather than its `<h1>`, because the `<h1>` carries an anchor link
 * whose glyph is a literal `#` — stripping tags out of it yields "#Security". The title is already escaped by
 * the renderer that wrote it, so it is interpolated as-is; escaping it again would render `&amp;` verbatim.
 */
function legalPages(all, outDir) {
  const found = [];
  for (const p of all) {
    const stem = /^doc--(.+)$/.exec(p.file)?.[1];
    // `__` is the flattener's separator for `/` (see render-shared.mjs::flatName), and it is reversible
    // because a safe path segment may not contain an underscore. So this matches a `legal/` directory at any
    // depth — and not a file merely named `legal-notes.md`, which is a document, not a policy.
    if (!stem || !/(^|__)legal__/i.test(stem)) continue;
    let label = stem.split('__').pop().replace(/[-_]+/g, ' ');
    try {
      const head = fs.readFileSync(path.join(outDir, p.from), 'utf8').slice(0, 4096);
      const t = /<title>([\s\S]*?)<\/title>/.exec(head)?.[1];
      // `Terms and conditions · project-atlas` — the site title is the suffix, and repeating it on every row
      // of a four-row list is noise.
      if (t) label = t.split(' · ')[0].replace(/<[^>]*>/g, '').trim() || label;
    } catch { /* the page is listed in `all` because it was read once already; a failure here is not fatal */ }
    found.push({ target: p.file, label });
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

/** The About page. Everything a reader needs to know about what made this, and what it refuses to claim. */
function aboutSection(about, title, legal = []) {
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
  // In-document targets, never file paths: nothing exists beside this file. `legalPages` only returns sections
  // the bundle carries, so every one of these resolves — which is why there is no fallback branch producing a
  // link to a page that is not here.
  const legalItems = legal.map((l) =>
    `<li><a href="#${escapeHtml(l.target)}" data-go="${escapeHtml(l.target)}">${l.label}</a></li>`).join('\n      ');

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

  <section class="card">
    <h2>Legal</h2>
    <p class="cap">${legal.length
      ? 'This corpus’s own legal documents, carried in this file. They state a position; they are not legal advice.'
      : 'This corpus carries no documents under a <code>legal/</code> directory, so there is nothing to link here.'}</p>
    <ul class="linklist">
      ${legalItems || '<li><span class="cap">Nothing to show.</span></li>'}
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
  <p class="cap">Generated by ${title}. Licensed MIT${legal.length
    ? ' — the documents under <strong>Legal</strong> above state the owner’s position alongside that licence, never over it'
    : ''}.</p>
</section>
`;
}

/** The pages a bundle carries, in the order the nav shows them. Absent ones are skipped, never faked. */
export const BUNDLE_PAGES = [
  { file: 'index', label: 'Home' },
  { file: 'dashboard', label: 'Overview' },
  // Adding a view means adding it here too, or the bundle carries a nav link to a file that does not travel
  // with it. The bundle test caught exactly that when the backlog view was added — which is why the test
  // asserts "no link points at a file" rather than checking a list someone has to remember to update.
  { file: 'view-backlog', label: 'Backlog' },
  { file: 'view-qc', label: 'Quality' },
  { file: 'view-product', label: 'Product' },
  { file: 'view-delivery', label: 'Delivery' },
  { file: 'view-repository', label: 'Repository' },
  // **Every panel on this one is stripped before it gets here, and it is still listed.** The bundle's nav is
  // built from this array, but every *page* in the bundle carries its own site nav — so leaving Economics out
  // would not remove the link, it would leave `href="view-economics.html"` unrewritten on ten pages, pointing
  // at a file no bundle carries. What travels is the page's provenance card, which holds no figure and states
  // why the rest of it is absent. A stated boundary beats ten dead links.
  { file: 'view-economics', label: 'Economics' },
  { file: 'view-architecture', label: 'Architecture' },
  { file: 'view-blueprint', label: 'Blueprint' },
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
// The clock joins the toggle for the same reason and by the same test: it lives in the topbar, and this
// bundler rebuilds the topbar rather than copying any page's. A per-page `clock--dashboard` would rename an
// element that no longer exists while the one that does keeps the plain id.
const CHROME_IDS = new Set(['themeToggle', 'clock']);

/** Inline the stylesheet and search index into one HTML file, for anywhere that takes a single document. */
export function exportSingleFile(root, cfg, which = 'dashboard') {
  const outDir = path.resolve(root, cfg.output);
  const src = path.join(outDir, `${which}.html`);
  if (!fs.existsSync(src)) throw new Error(`${which}.html not found in ${cfg.output}. Run \`atlas build\` first.`);

  // Before anything else: this file is made to be handed to someone. See `stripLocalOnly`.
  let html = stripLocalOnly(fs.readFileSync(src, 'utf8'), `the ${which} export`);
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

  // The stripped page has had a stylesheet, a search index and its own inline scripts folded into it since the
  // strip ran. Checked against the bytes that leave, not against the fact that a strip happened.
  return assertNoLocalOnly(html, `the ${which} export`);
}
