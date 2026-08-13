/**
 * project-atlas · the product view — one page across sibling repositories (A-61)
 *
 * A product is rarely one repository. `~/Working/GitHub/UtilityServer/` on this machine is a plain directory
 * holding thirteen independent checkouts — an Angular client, three Cloudflare workers, a monitoring service,
 * a business repo, an edge rewrite — plus a `docs/` corpus describing how they fit together. There is no
 * repository at that level, and there is deliberately not going to be one.
 *
 * ## Why this is not the launcher
 *
 * `launcher.mjs` (A-19) already writes "one doorway to every dashboard on the machine". That page knows
 * **ports**, because a port is derived from a path and the registry records which servers are up. It knows
 * nothing about repositories: not whether one has adopted the tool, not what its plan says, not whether
 * anything is in flight there. It is a bookmark bar. Twelve of those thirteen repositories have never run
 * `atlas init`, so a launcher rendered against that directory lists **one** project and implies the other
 * twelve do not exist.
 *
 * That is the omitted-panel failure this project has already shipped three times: a surface that shows what
 * it could measure and stays silent about what it could not, so the reader takes the part for the whole. The
 * rule this module is built on is the one that governs the signal catalogue — **a member that cannot be read
 * is a stated row, never a dropped one** — extended one level up: a member that has not adopted is a stated
 * row too, carrying the sentence that says what adopting it would take.
 *
 * ## The constraint that shapes everything else
 *
 * The owner's requirement, verbatim: *"it should work with individual repository while creating a common
 * connection (but this will never commit)"*. Each member keeps its own config, its own dashboard, its own
 * history. The layer that connects them is never committed anywhere, and in particular **nothing is ever
 * written into a member repository**.
 *
 * Three things enforce that rather than one comment promising it:
 *
 *  1. **One write, one place.** This module writes exactly one file, through `writeProductPage`, and that
 *     function refuses any destination at or inside a member — via `isAtOrInside` from `paths.mjs`, which
 *     resolves symlinks on both sides, because a lexical check is walked past by a link.
 *  2. **Nothing else here can write.** Every read is `fs.readFileSync`/`readdirSync`, and every git call goes
 *     through `git()` below, which is a fixed allow-list of five read-only subcommands **and** passes
 *     `--no-optional-locks`. That flag is not decoration: a bare `git status` refreshes and rewrites
 *     `.git/index` as a side effect, which is a write into somebody else's repository, and the test that
 *     snapshots every member byte-for-byte catches exactly that.
 *  3. **The page lives outside every repository by construction** — see `productPagePath`.
 *
 * ## Where the page lives, and why not the parent directory
 *
 * `~/.claude/atlas/products/<name>-<hash>/product.html`, beside the machine-wide server registry that
 * `serve.mjs` already keeps there.
 *
 * The obvious alternative is the product directory itself — it is where the person is standing, and it is not
 * a git repository, so nothing written there *can* be committed. That last clause is why it loses. It is true
 * today and it is true by accident: one `git init` in that directory, which is an entirely reasonable thing
 * for somebody to do to a folder holding thirteen related projects, turns every product page ever written
 * there into a tracked file, and the guarantee then depends on a fact about a directory this tool does not
 * own and is not watching. A guarantee that can be revoked by a command somebody else runs is not a
 * guarantee. `~/.claude/` is outside the product **structurally** — it is not below the product root at all,
 * so no operation performed on the product can bring it inside one.
 *
 * The cost is discoverability, and it is paid in the terminal: the command prints the absolute path every
 * time, and the page prints it too.
 *
 * ## Discovery, and the session that is not in a repository
 *
 * A product is discovered, never declared. There is no member list to maintain, because a member list is a
 * document that goes stale — the failure mode this whole tool exists to detect — and because the owner would
 * be maintaining it in a file that is never committed, so it would not survive a cleanup.
 *
 * The rule: **a product root is a directory that is not itself a git repository and whose immediate children
 * include at least two that are.** Both halves matter. "Not itself a repository" is what distinguishes a
 * product root from a monorepo with vendored checkouts. "At least two" is what stops every parent directory
 * of a single project claiming to be a product.
 *
 * This matters more than it looks. Sessions on this machine are run *from the product directory* while the
 * work happens in a child — which is the normal way to work on something like this, not an edge case. Every
 * atlas hook opens with `root=$(git rev-parse --show-toplevel) || exit 0`, so from there the hooks all exit
 * silently and the tool is, in effect, switched off. The product view is the one surface that is *designed*
 * for standing in a directory that is not a repository, and it is the only thing a person in that position
 * can currently see.
 *
 * **Run from inside a member, this does not go looking upward.** Walking up until a directory smells like a
 * product is a guess about somebody's filesystem layout, and a wrong guess renders a page about a set of
 * repositories the user never asked about. `productRootFor` reports what it found and names the explicit
 * flag; it never silently ascends.
 *
 * ## What it costs
 *
 * Per member, by default: **one `existsSync`, one config parse, one plan file, three git commands.** Nothing
 * is built, nothing is indexed, no corpus is walked except a depth-bounded markdown count on members that
 * have *not* adopted — which is the one number that makes "not adopted" actionable rather than a shrug.
 * Thirteen members is ~39 short git invocations and ~30 file reads; it draws in well under a second.
 *
 * Health is the one thing that cannot be had cheaply: it needs the member's whole corpus indexed, which is
 * the thirteen-full-builds cost the page must not pay. So by default **health is not measured and the page
 * says so in those words** rather than printing a reassuring blank. `--deep` opts into the real measurement,
 * and the page states which of the two produced it. A number that was never computed is never implied.
 *
 * ## The unowned corpus
 *
 * The product directory holds `ARCHITECTURE.md`, `INTERCONNECTIONS.md` and `REPOSITORIES.md`. They describe
 * how the thirteen relate; they belong to none of them and are committed nowhere.
 *
 * This page **names them and does not read them**. Indexing them is a genuinely useful feature and it is the
 * wrong feature here, because this tool's entire contract is that its output is derived from a source that
 * outlives it — delete the site, re-run the build, get the same bytes back. That corpus has no repository to
 * be derived *from*. Rendering it into a page that lives in `~/.claude/`, is never committed, and is safe to
 * delete would make the derived copy the most durable copy of a document with no version control at all,
 * which inverts the relationship the tool depends on.
 *
 * So it is reported as a **finding** instead: *these documents describe the product and are committed to no
 * repository.* That is the product-level orphan, it is true, and it is the thing the owner can act on.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAtOrInside, realpathOrBest } from './paths.mjs';
import { resolveConfig } from './config.mjs';
import { readPlanning } from './planning.mjs';
import { portForRoot } from './serve.mjs';
import { num } from './format.mjs';

/** How deep the markdown count walks an unadopted member, and how many entries it will look at. */
const COUNT_DEPTH = 3;
const COUNT_CAP = 4000;

/** Directories a markdown count must never descend into. Cost, not secrecy. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'vendor', 'target', '.next', '.venv', 'coverage']);

/** The parent-level documents this view reports as unowned. Any markdown directly under the product root, or
 *  one level into a `docs/` there — the two places a product-level corpus actually lands. */
const UNOWNED_ROOTS = ['.', 'docs'];

/**
 * The read-only git surface, and the whole of it.
 *
 * `--no-optional-locks` is load-bearing. `git status` without it refreshes the stat cache and rewrites
 * `.git/index`, so the "read-only across members" promise would be false on the very first row drawn.
 */
const GIT_READS = new Set(['rev-parse', 'status', 'log', 'symbolic-ref', 'stash']);

function git(dir, args) {
  if (!GIT_READS.has(args[0])) throw new Error(`product view refuses the git subcommand ${args[0]} — it reads members, it never changes them`);
  try {
    return execFileSync('git', ['-C', dir, '--no-optional-locks', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ discovery */

/** Does this directory hold a git checkout? A worktree and a submodule carry `.git` as a *file*, so both count. */
export function isRepository(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; }
}

/**
 * Immediate child directories that are git checkouts, sorted by name.
 *
 * Ordering is `localeCompare` under a pinned locale-free comparison for the same reason `format.mjs` pins the
 * number locale: the page must be byte-identical between two machines that disagree about collation.
 */
export function discoverMembers(productRoot) {
  let entries;
  try {
    entries = fs.readdirSync(productRoot, { withFileTypes: true });
  } catch (err) {
    return { members: [], failed: String(err?.message || err) };
  }
  const members = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
    .map((e) => path.join(productRoot, e.name))
    .filter((p) => isRepository(p))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en'));
  return { members, failed: null };
}

/**
 * Decide whether `dir` is a product root, and say so in words when it is not.
 *
 * Returns `{ ok, root, members, reason, hint }`. It never ascends on its own — see the module note.
 */
export function productRootFor(dir, { minMembers = 2 } = {}) {
  const root = path.resolve(dir);
  const { members, failed } = discoverMembers(root);

  if (failed) {
    return { ok: false, root, members: [], reason: `this directory could not be listed (${failed}).`, hint: null };
  }

  if (isRepository(root)) {
    const parent = path.dirname(root);
    const sibling = discoverMembers(parent).members.filter((m) => path.resolve(m) !== root);
    return {
      ok: false,
      root,
      members: [],
      reason: `${path.basename(root)} is itself a git repository, so it is a member rather than a product.`,
      // Named, never taken. Walking up on a hunch renders a page about repositories nobody asked about.
      hint: sibling.length && !isRepository(parent)
        ? `Its parent holds ${num(sibling.length + 1)} checkouts. If that is the product, say so: atlas product --product ${parent}`
        : 'Point this at the directory that holds the repositories: atlas product --product <dir>',
    };
  }

  if (members.length < minMembers) {
    return {
      ok: false,
      root,
      members,
      reason: members.length
        ? `${path.basename(root)} holds ${num(members.length)} git checkout, and a product view of one repository is that repository's own dashboard.`
        : `${path.basename(root)} holds no git checkouts in its immediate children.`,
      hint: 'A product root is a directory that is not itself a repository and whose children are.',
    };
  }

  return { ok: true, root, members, reason: null, hint: null };
}

/* ------------------------------------------------------------------ members */

/** Markdown files in a member, depth-bounded and capped. The one number that makes "not adopted" actionable. */
function countMarkdown(dir) {
  let seen = 0, found = 0, truncated = false;
  const walk = (d, depth) => {
    if (truncated || depth > COUNT_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > COUNT_CAP) { truncated = true; return; }
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(d, e.name), depth + 1);
        if (truncated) return;
      } else if (/\.mdx?$/i.test(e.name)) {
        found++;
      }
    }
  };
  walk(dir, 0);
  return { markdown: found, truncated };
}

/**
 * The unit separator, built from its code point rather than written as a literal.
 *
 * The fields of the last commit have to be split on something the subject line cannot contain, and a space is
 * not it — `split(' ')` on `%h %cs %s` keeps only the first word of the subject. 0x1F is emitted by git's own
 * `%x1f` escape, which travels through `argv` as the four plain characters `%x1f`; a literal separator byte in
 * the format string would not, because `argv` strings are NUL-terminated and a raw control byte in source is
 * exactly the sort of thing an editor silently rewrites. This module has already been bitten by that: two of
 * these lines briefly held a real NUL, which `execFileSync` rejects outright, so every commit field came back
 * null while the branch and the dirty count — read by other calls — looked fine.
 */
const SEP = String.fromCharCode(31);

/** The cheap git facts. Three invocations, all read-only, all allowed to fail into `null`. */
function gitFacts(dir) {
  const head = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head === null) return null;
  const porcelain = git(dir, ['status', '--porcelain']);
  const last = git(dir, ['log', '-1', '--format=%h%x1f%cs%x1f%s']);
  const [hash, date, subject] = String(last || '').split(SEP);
  return {
    branch: head || null,
    dirty: porcelain === null ? null : porcelain.split('\n').filter(Boolean).length,
    hash: hash || null,
    date: date || null,
    subject: subject || null,
  };
}

/**
 * One row. Everything here is derived from files already on disk; nothing is built, fetched or written.
 *
 * A member that throws anywhere in this function becomes an `unreadable` row carrying the reason. It is never
 * dropped, because a dropped row is indistinguishable from a member that does not exist — and the reader
 * would be counting twelve where there are thirteen.
 */
export function readMember(dir, { deep = false, running = new Set(), deepRunner = null } = {}) {
  const name = path.basename(dir);
  const base = { name, path: dir, port: null, url: null, running: false };
  try {
    base.port = portForRoot(dir);
    base.url = `http://127.0.0.1:${base.port}/`;
    base.running = running.has(path.resolve(dir));

    const cfgPath = path.join(dir, 'project-atlas.config.json');
    const adopted = fs.existsSync(cfgPath);
    const gitInfo = gitFacts(dir);

    if (!adopted) {
      const { markdown, truncated } = countMarkdown(dir);
      return { ...base, state: 'unadopted', git: gitInfo, markdown, truncated, plan: null, health: null };
    }

    const cfg = resolveConfig(dir);
    let plan = null;
    try {
      const p = readPlanning(dir, cfg);
      if (p && !p.missing && p.items?.length) {
        const pcts = p.items.map((i) => (Number.isFinite(i.percent) ? i.percent : 0));
        const done = pcts.filter((v) => v >= 100).length;
        plan = {
          source: p.source,
          items: p.items.length,
          done,
          mean: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
          missing: false,
        };
      } else if (p) {
        plan = { source: p.source, items: 0, done: 0, mean: null, missing: !!p.missing };
      }
    } catch (err) {
      plan = { source: cfg.planning?.source || null, items: 0, done: 0, mean: null, missing: true, error: String(err?.message || err) };
    }

    let health = null;
    if (deep && deepRunner) {
      try {
        health = { measured: true, ...deepRunner(dir, cfg) };
      } catch (err) {
        health = { measured: false, reason: String(err?.message || err) };
      }
    }

    return {
      ...base,
      state: 'adopted',
      siteTitle: cfg.siteTitle || name,
      output: cfg.output || null,
      git: gitInfo,
      plan,
      health,
    };
  } catch (err) {
    return { ...base, state: 'unreadable', reason: String(err?.message || err), git: null, plan: null, health: null };
  }
}

/* ------------------------------------------------------------------ the unowned corpus */

/**
 * Product-level markdown: named, counted, and deliberately not read into the page. See the module note — the
 * point is the finding, not the content.
 */
export function unownedCorpus(productRoot) {
  const out = [];
  for (const rel of UNOWNED_ROOTS) {
    const dir = path.join(productRoot, rel);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !/\.mdx?$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      let lines = null, bytes = null;
      try {
        const st = fs.statSync(full);
        bytes = st.size;
        // Counting newlines is a read of the file, not an index of it: no title, no links, no citations, and
        // nothing from inside it reaches the page.
        lines = fs.readFileSync(full, 'utf8').split('\n').length;
      } catch { /* stated below as an unread row rather than dropped */ }
      out.push({ path: rel === '.' ? e.name : `${rel}/${e.name}`, lines, bytes });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/* ------------------------------------------------------------------ the model */

/**
 * The whole product, as data. Pure derivation: give it the same directory in the same state and it returns
 * the same object, with no clock anywhere in it.
 */
export function readProduct(productRoot, { deep = false, running = [], deepRunner = null, members = null } = {}) {
  const root = path.resolve(productRoot);
  const list = members || discoverMembers(root).members;
  const runningSet = new Set(running.map((r) => path.resolve(r)));

  const rows = list.map((m) => readMember(m, { deep, running: runningSet, deepRunner }));
  const unowned = unownedCorpus(root);

  const notes = [];
  const unadopted = rows.filter((r) => r.state === 'unadopted');
  const unreadable = rows.filter((r) => r.state === 'unreadable');
  if (unadopted.length) {
    notes.push(`${num(unadopted.length)} of ${num(rows.length)} member repositories have not adopted atlas. They are listed with what adoption would index, not hidden.`);
  }
  if (unreadable.length) {
    notes.push(`${num(unreadable.length)} member repositories could not be read. Each is a row with its reason — never a gap in the count.`);
  }
  if (unowned.length) {
    notes.push(`${num(unowned.length)} product-level documents are committed to no repository. They are named here and deliberately not indexed: this page is derived output, and there is nothing under version control to derive them from.`);
  }
  if (!deep) {
    notes.push('Health was not measured. Measuring it indexes every member\'s whole corpus, which is the cost this page exists to avoid; run atlas product --deep when you want the numbers.');
  }

  return {
    root,
    name: path.basename(root),
    isRepo: isRepository(root),
    members: rows,
    unowned,
    notes,
    deep: !!deep,
    counts: {
      members: rows.length,
      adopted: rows.filter((r) => r.state === 'adopted').length,
      unadopted: unadopted.length,
      unreadable: unreadable.length,
    },
  };
}

/* ------------------------------------------------------------------ where it goes */

/** FNV-1a, so two products with the same basename in different places never share a directory. */
function slugHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * `~/.claude/atlas/products/<name>-<hash>/product.html` — outside every repository by construction, not by
 * the good fortune that nobody has run `git init` in the product directory. See the module note.
 */
export function productPagePath(productRoot, { home = null } = {}) {
  const root = realpathOrBest(productRoot);
  const dir = home || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const safe = path.basename(root).replace(/[^A-Za-z0-9._-]/g, '-') || 'product';
  return path.join(dir, 'atlas', 'products', `${safe}-${slugHash(root)}`, 'product.html');
}

/**
 * The single write in this module, and the guarantee that it never lands in a member.
 *
 * `isAtOrInside` resolves symlinks on both sides, so `--out members/edge-link/x.html` pointing into a member
 * is refused for what it resolves to rather than for how it is spelled. The refusal is a throw, not a warning:
 * this is the one constraint the owner stated in their own words, and a warning is something a script ignores.
 */
export function writeProductPage(outPath, html, model) {
  const abs = path.resolve(outPath);
  for (const m of model.members) {
    if (isAtOrInside(m.path, abs)) {
      throw new Error(
        `Refusing to write the product page to ${abs}: that is inside the member repository ${m.name} (${m.path}).\n` +
        '  The product view never writes into a member. Nothing it produces is committable, and a page staged\n' +
        '  inside a checkout is one `git add -A` away from being committed there.');
    }
  }
  if (isAtOrInside(model.root, abs)) {
    throw new Error(
      `Refusing to write the product page to ${abs}: that is inside the product root ${model.root}.\n` +
      '  The product root is not a repository today, which is exactly the sort of fact that changes when\n' +
      `  somebody runs git init. The page belongs outside it: ${productPagePath(model.root)}`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, html, 'utf8');
  return abs;
}

/* ------------------------------------------------------------------ the page */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function memberRow(m) {
  const chip = m.state === 'adopted'
    ? '<span class="chip on">adopted</span>'
    : m.state === 'unadopted'
      ? '<span class="chip off">not adopted</span>'
      : '<span class="chip bad">unreadable</span>';

  const facts = [];
  if (m.git) {
    facts.push(`<span class="f"><b>branch</b> ${esc(m.git.branch || 'detached')}</span>`);
    if (m.git.dirty !== null) {
      facts.push(`<span class="f"><b>in flight</b> ${m.git.dirty ? `${num(m.git.dirty)} uncommitted file(s)` : 'clean tree'}</span>`);
    }
    if (m.git.hash) facts.push(`<span class="f"><b>last commit</b> ${esc(m.git.date || '')} · ${esc(m.git.hash)}</span>`);
  } else if (m.state !== 'unreadable') {
    facts.push('<span class="f"><b>git</b> could not be read here</span>');
  }

  if (m.state === 'adopted') {
    if (m.plan && !m.plan.missing && m.plan.items) {
      facts.push(`<span class="f"><b>plan</b> ${num(m.plan.done)} of ${num(m.plan.items)} items complete · mean ${num(m.plan.mean)}%</span>`);
    } else if (m.plan) {
      facts.push(`<span class="f"><b>plan</b> ${esc(m.plan.source || 'no planning source configured')} — not readable</span>`);
    } else {
      facts.push('<span class="f"><b>plan</b> no planning source configured</span>');
    }
    if (m.health?.measured) {
      facts.push(`<span class="f"><b>health</b> ${num(m.health.blocking)} blocking · ${num(m.health.advisory)} advisory</span>`);
    } else if (m.health) {
      facts.push(`<span class="f"><b>health</b> could not be measured — ${esc(m.health.reason)}</span>`);
    } else {
      facts.push('<span class="f"><b>health</b> not measured on this page</span>');
    }
  }

  const body = m.state === 'unadopted'
    ? `<p class="todo"><b>What adoption would take.</b> One command, run in this checkout:
         <code>cd ${esc(m.path)} &amp;&amp; atlas init</code>. It writes one config file and nothing else;
         the build after it is what produces a dashboard. There ${m.markdown === 1 ? 'is' : 'are'}
         ${num(m.markdown)} markdown file${m.markdown === 1 ? '' : 's'} here${m.truncated ? ' (counted to a bounded depth, so that is a floor)' : ''}
         that it would index. Until then this repository has no health, no plan and no dashboard — which is a
         statement about the tool, not about the repository.</p>`
    : m.state === 'unreadable'
      ? `<p class="todo bad"><b>This member could not be read.</b> ${esc(m.reason)} — stated rather than
           dropped, because a dropped row is indistinguishable from a repository that is not there.</p>`
      : `<p class="todo"><b>Its own dashboard</b> is at <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>
           — the port is derived from this path, so that link is right for this checkout whether or not a
           server is up right now. ${m.running ? 'One was running when this page was written.' : 'None was running when this page was written.'}</p>`;

  return `
    <li class="member ${esc(m.state)}">
      <div class="mhead">
        <span class="mname">${esc(m.name)}</span>
        ${chip}
      </div>
      <code class="mpath">${esc(m.path)}</code>
      <div class="facts">${facts.join('')}</div>
      ${body}
    </li>`;
}

/**
 * The page. Self-contained: no script, no external stylesheet, no font, no image — so it renders identically
 * under the strictest CSP, and there is nothing in it that could phone home about thirteen private
 * repositories.
 *
 * **No clock anywhere.** The launcher stamps a generation time; this one must not, because "byte-identical
 * output" is the property that makes a diff of this page mean *the product changed*. A timestamp would make
 * every rebuild look like news.
 */
export function renderProduct(model) {
  const c = model.counts;
  const rows = model.members.map(memberRow).join('');

  const unowned = model.unowned.length ? `
  <section class="panel">
    <h2>Documents that belong to no repository</h2>
    <p class="lede">${num(model.unowned.length)} markdown file${model.unowned.length === 1 ? '' : 's'} at the
      product level ${model.unowned.length === 1 ? 'describes' : 'describe'} how these repositories relate. They are in no checkout, so they are <strong>committed to no repository</strong> and
      have no history: nothing has ever reviewed a diff of them, nothing can restore a previous version, and
      deleting one loses it.</p>
    <ul class="corpus">
      ${model.unowned.map((d) => `<li><code>${esc(d.path)}</code><span>${d.lines === null ? 'unreadable' : `${num(d.lines)} lines`}</span></li>`).join('')}
    </ul>
    <p class="note"><strong>This page names them and does not read them.</strong> Indexing them would be a real
      feature, and it is the wrong one here: everything this tool renders is derived from a source under
      version control, and re-derivable from it. That corpus has no repository to be derived from — so an
      indexed copy living in a generated, never-committed page would be the most durable copy of a document
      with no history at all. The remedy is to give them a home: a repository at the product level, or the
      member each one actually describes.</p>
  </section>` : '';

  return `<title>${esc(model.name)} · product view</title>
<style>
  /* The project's own contour palette. Every colour is defined on bare :root first, so the un-stamped
     "system" state — where most viewers are — has a complete palette before any query runs. */
  :root {
    --ground:#f6f4ef; --panel:#fffdf9; --rule:#e4dfd4; --raise:#f0ece3;
    --ink:#1c1b18; --ink-soft:#6b665c; --ink-faint:#96907f;
    --contour:#2f3b3a; --benchmark:#c1622d; --warn:#8a6d1f; --bad:#a33a20;
    --shadow:0 1px 2px rgba(28,27,24,.05), 0 10px 30px -14px rgba(28,27,24,.22);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#14171a; --panel:#1b1f23; --rule:#2c3239; --raise:#232930;
      --ink:#eef1f3; --ink-soft:#9aa4ad; --ink-faint:#6e767e;
      --contour:#8fb3ad; --benchmark:#e8834a; --warn:#d8b25a; --bad:#e0755a;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 34px -16px rgba(0,0,0,.75);
    }
  }
  :root[data-theme="dark"] {
    --ground:#14171a; --panel:#1b1f23; --rule:#2c3239; --raise:#232930;
    --ink:#eef1f3; --ink-soft:#9aa4ad; --ink-faint:#6e767e;
    --contour:#8fb3ad; --benchmark:#e8834a; --warn:#d8b25a; --bad:#e0755a;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 34px -16px rgba(0,0,0,.75);
  }

  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; padding:34px 20px; display:flex; justify-content:center;
    background:var(--ground); color:var(--ink);
    font:16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased;
  }
  .wrap { width:100%; max-width:760px; }
  .head { position:relative; overflow:hidden; background:var(--panel); border:1px solid var(--rule);
          border-radius:14px; padding:26px 28px 22px; box-shadow:var(--shadow); margin-bottom:18px; }
  .ridge { position:absolute; inset:0 0 auto 0; height:64px; opacity:.5; pointer-events:none; }
  .eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); margin:0 0 5px; }
  h1 { margin:0 0 7px; font-size:26px; line-height:1.2; letter-spacing:-.015em;
       font-family:ui-monospace,"SF Mono",Menlo,monospace; font-weight:620; }
  h1 .dot { color:var(--benchmark); }
  h2 { margin:0 0 8px; font-size:15px; letter-spacing:.01em; }
  .lede { margin:0 0 10px; color:var(--ink-soft); font-size:14px; }
  .tally { display:flex; flex-wrap:wrap; gap:8px 18px; margin:14px 0 0; padding:0; list-style:none; }
  .tally li { font:12.5px/1.5 ui-monospace,Menlo,monospace; color:var(--ink-soft); }
  .tally b { color:var(--ink); font-weight:620; }

  .panel { background:var(--panel); border:1px solid var(--rule); border-radius:14px;
           padding:20px 28px 22px; box-shadow:var(--shadow); margin-bottom:18px; }
  ul.members { list-style:none; margin:0; padding:0; }
  .member { border:1px solid var(--rule); border-radius:12px; padding:15px 18px; background:var(--panel); }
  .member + .member { margin-top:12px; }
  .member.unadopted { background:var(--raise); }
  .mhead { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .mname { font-weight:620; font-size:15.5px; font-family:ui-monospace,Menlo,monospace; }
  .chip { font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
          border:1px solid currentColor; border-radius:4px; padding:1px 5px; }
  .chip.on { color:var(--benchmark); }
  .chip.off { color:var(--warn); }
  .chip.bad { color:var(--bad); }
  .mpath { display:block; margin:3px 0 8px; font:11.5px/1.5 ui-monospace,Menlo,monospace;
           color:var(--ink-faint); word-break:break-all; }
  .facts { display:flex; flex-wrap:wrap; gap:4px 16px; }
  .f { font:12.5px/1.6 ui-monospace,Menlo,monospace; color:var(--ink-soft); }
  .f b { color:var(--ink-faint); font-weight:500; }
  .todo { margin:9px 0 0; font-size:13px; line-height:1.6; color:var(--ink-soft); }
  .todo.bad { color:var(--bad); }
  .todo code { background:var(--raise); border:1px solid var(--rule); border-radius:4px; padding:1px 5px;
               font-family:ui-monospace,Menlo,monospace; font-size:12px; word-break:break-all; }
  ul.corpus { list-style:none; margin:0 0 12px; padding:0; }
  ul.corpus li { display:flex; justify-content:space-between; gap:16px; padding:6px 0;
                 border-bottom:1px solid var(--rule); font:12.5px/1.6 ui-monospace,Menlo,monospace; }
  ul.corpus li span { color:var(--ink-faint); white-space:nowrap; }
  .note { margin:12px 0 0; font-size:12.5px; line-height:1.65; color:var(--ink-soft); }
  .note + .note { margin-top:9px; }
  code { font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  a { color:var(--benchmark); }
  ul.knows { margin:8px 0 0; padding-left:20px; font-size:12.5px; line-height:1.7; color:var(--ink-soft); }
</style>

<div class="wrap">
  <div class="head">
    <svg class="ridge" viewBox="0 0 760 64" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 50 C 110 26, 180 56, 270 38 S 460 14, 580 34 S 700 52, 760 30" fill="none"
            stroke="var(--contour)" stroke-width="1.1" opacity=".45"/>
      <path d="M0 60 C 120 40, 200 64, 300 48 S 470 26, 600 46 S 720 60, 760 44" fill="none"
            stroke="var(--contour)" stroke-width="1.1" opacity=".26"/>
    </svg>
    <p class="eyebrow">project-atlas · product view</p>
    <h1>${esc(model.name)}<span class="dot">.</span></h1>
    <p class="lede">${num(c.members)} sibling repositories under one directory that is not itself a repository.
      Each keeps its own config, its own dashboard and its own history; this page connects them and is
      committed nowhere.</p>
    <code class="mpath">${esc(model.root)}</code>
    <ul class="tally">
      <li><b>${num(c.members)}</b> members</li>
      <li><b>${num(c.adopted)}</b> adopted</li>
      <li><b>${num(c.unadopted)}</b> not adopted</li>
      <li><b>${num(c.unreadable)}</b> unreadable</li>
      <li><b>${num(model.unowned.length)}</b> unowned documents</li>
    </ul>
  </div>

  <section class="panel">
    <h2>Members</h2>
    <p class="lede">Discovered, not declared: every immediate child of the product root that holds a git
      checkout. There is no list to maintain, so a repository cloned tomorrow appears without anyone
      remembering to add it.</p>
    <ul class="members">${rows || '<li class="member"><p class="todo">No member repositories were found.</p></li>'}</ul>
  </section>

  ${unowned}

  <section class="panel">
    <h2>What this page knows, and what it does not</h2>
    <ul class="knows">
      <li><strong>It never wrote anything into a member.</strong> Every read is a file read or one of five
        read-only git commands, each passed <code>--no-optional-locks</code> so that not even git's stat cache
        is rewritten. The page itself is refused any destination inside a member or inside the product root.</li>
      <li><strong>It ran no build.</strong> Per member it read one config file, one plan file and three git
        commands — which is why ${num(c.members)} repositories draw in under a second instead of
        ${num(c.members)} full indexes.</li>
      <li><strong>${model.deep ? 'Health was measured for every adopted member' : 'Health was not measured'}.</strong>
        ${model.deep
          ? 'Each adopted member\'s corpus was indexed and its signals evaluated, which is why this run cost real time.'
          : 'Measuring it means indexing each member\'s whole corpus. Run <code>atlas product --deep</code> when you want the numbers; a blank is not a clean bill.'}</li>
      <li><strong>It cannot check whether a dashboard is up.</strong> A port is a pure function of a
        repository path, so the links stay correct for these checkouts; whether a server is answering right
        now is a different question and this page does not pretend to answer it.</li>
      <li><strong>There is no timestamp on this page, deliberately.</strong> The output is byte-identical for
        an unchanged product, so a diff of it means the product changed rather than that it was regenerated.</li>
    </ul>
  </section>
</div>`;
}
