#!/usr/bin/env node
/**
 * project-atlas — a derived, auditable knowledgebase over a repository's own documentation.
 *
 *   atlas init     write a config, detecting the repository's layout
 *   atlas scan     build the index            (--json)
 *   atlas tasks    the planning document, with progress bars   (--json, or a filter word)
 *   atlas branch   where you are, and whether it is safe to commit there
 *   atlas caps     which host features are on: wiki, pages, issues, discussions (the one network call)
 *   atlas community  generate issue/PR/discussion scaffolding for whatever the host supports
 *   atlas changes  what changed — working tree, this branch, and the docs it puts at risk
 *   atlas diff     one file's diff, local or across the branch
 *   atlas tokens   where the tokens went, from LOCAL session transcripts (opt-in, never published)
 *   atlas sessions how sessions went — turns, interruptions, friction (NOT prompt quality)
 *   atlas contrib  who did what, from git: people, agents, desks, hours, outcomes
 *   atlas health   report rot signals         (--verbose | --verbose=all)  exit 1 on blocking
 *   atlas build    generate the static site (index, dashboard, deck, health)
 *   atlas watch    build, then rebuild on change; the open page reloads itself
 *   atlas all      scan + health + build
 *
 * Zero dependencies. Node >= 18. No network. Reads the repository; writes only the output directory
 * and, for `init`, the config file.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_CLUSTERS, CONFIG_NAME } from './lib/config.mjs';
import { buildIndex, discover } from './lib/scan.mjs';
import { readPlanning } from './lib/planning.mjs';
import { runHealth, formatReport } from './lib/health.mjs';
import { renderSite, writeBuildStamp } from './lib/render.mjs';
import { buildWikiPages, stageWiki, stagePages, exportSingleFile, exportBundle, gitlabPagesJob } from './lib/publish.mjs';
import { readContrib, formatContrib } from './lib/contrib.mjs';
import { detectHost, probeCapabilities, gateTarget, formatCapabilities } from './lib/host.mjs';
import { communityAssets, writeCommunity } from './lib/community.mjs';
import { branchStatus, createBranch, formatBranch, TYPES } from './lib/branch.mjs';
import { readTokens, formatTokens, formatSessions, transcriptDir, assertNotPublishable } from './lib/tokens.mjs';
import { readChanges, formatChanges, fileDiff } from './lib/changes.mjs';
import { formatVersion, updateNotice, isPluginCache } from './lib/version.mjs';
import { checkForUpdate } from './lib/update.mjs';

const argv = process.argv.slice(2);

/**
 * Flags that consume the next argument when written with a space (`--target wiki`). Everything else is a
 * boolean, so a positional after a boolean flag stays positional — `atlas tasks --json safety` keeps `safety`
 * as the filter rather than swallowing it as `--json`'s value.
 */
const VALUE_FLAGS = new Set(['target', 'page', 'out', 'root', 'config', 'interval']);

const { cmd, positionals, flags } = parseArgs(argv);

function parseArgs(args) {
  const flags = new Map();
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { flags.set(a.slice(2, eq), a.slice(eq + 1)); continue; }
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name) && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags.set(name, args[++i]);
    } else {
      flags.set(name, true);
    }
  }
  return { cmd: positionals[0] || 'help', positionals: positionals.slice(1), flags };
}

const flag = (name, fallback = undefined) => (flags.has(name) ? flags.get(name) : fallback);

const quiet = !!flag('quiet');
const say = (...a) => { if (!quiet) console.log(...a); };
const color = process.stdout.isTTY && !flag('no-color');

function repoRoot() {
  const explicit = flag('root');
  if (typeof explicit === 'string') return path.resolve(explicit);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

/** Where this executing copy lives, and what it is. Reads only its own installation, never the repository. */
function runningBuild() {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch { /* running from a tree without a manifest; the path below still tells the user where they are */ }
  let commit = null;
  try {
    commit = execFileSync('git', ['-C', pluginRoot, 'rev-parse', '--short', 'HEAD'],
                          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* an installed plugin is not a git checkout — expected, and reported as unknown rather than faked */ }
  return { version, commit, path: pluginRoot, fromCache: isPluginCache(pluginRoot), pluginRoot };
}

/** Every scope this plugin is registered under. Two registrations that disagree is the case worth surfacing. */
function readRegistrations() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), 'utf8'));
    const entries = Object.entries(db.plugins || {}).filter(([k]) => k.startsWith('atlas@'));
    return entries.flatMap(([, list]) => (Array.isArray(list) ? list : [list]))
      .map((e) => ({ scope: e.scope || 'unknown', version: e.version || 'unknown', sha: (e.gitCommitSha || '').slice(0, 7) }));
  } catch {
    return [];                       // not installed as a plugin, which is a normal way to run this
  }
}

/**
 * What the About page and the update row state. Every field is read, never assumed: an unknown stays unknown
 * rather than becoming a plausible default, because this page is the one a reader trusts about provenance.
 *
 * The update figure comes from the **cached** check — a generated file cannot poll, and an Artifact runs under
 * a policy that blocks outbound requests anyway. So the row says what was true at build time and dates it.
 */
async function aboutFacts(root, cfg) {
  const running = runningBuild();
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(running.pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')); } catch {}

  let latest = null, checkedAt = null;
  if (!flag('offline')) {
    try { ({ latest, checkedAt } = await checkForUpdate({ repository: manifest.repository })); } catch {}
  }

  // The assisting model is read from the Co-Authored-By trailers already in history, not guessed from the
  // process generating the file — the page describes the repository, not whoever happened to run the build.
  const contrib = readContrib(root, cfg);
  const model = contrib?.available
    ? (contrib.agents || []).slice().sort((a, b) => b.commits - a.commits)[0]?.agent || null
    : null;

  const repo = String(manifest.repository || '').replace(/\.git$/, '');
  const links = [];
  if (repo) {
    links.push({ label: 'Repository', href: repo });
    links.push({ label: 'Changelog', href: `${repo}/blob/main/CHANGELOG.md`, note: 'every release, and why' });
    links.push({ label: 'Issues', href: `${repo}/issues` });
    links.push({ label: 'Releases', href: `${repo}/releases` });
  }

  return {
    tool: manifest.name === 'atlas' ? 'project-atlas' : (manifest.name || 'project-atlas'),
    version: running.version,
    commit: running.commit,
    model,
    latest,
    checkedAt,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    help: repo ? `${repo}#install` : null,
    links,
    people: contrib?.available
      ? contrib.people.map((p) => ({ name: p.name, commits: p.commits, ai: p.aiAssisted || 0 }))
      : [],
  };
}

async function main() {
  if (cmd === 'help' || flag('help')) return usage();

  // Answers from its own installation, so it works in any directory, repository or not.
  if (cmd === 'version') {
    const running = runningBuild();
    const registrations = readRegistrations();
    let repository = null;
    try { repository = JSON.parse(fs.readFileSync(path.join(running.pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).repository; } catch {}

    let latest = null, checkedAt = null;
    if (!flag('offline')) {
      const r = await checkForUpdate({ repository, force: !!flag('check') });
      latest = r.latest; checkedAt = r.checkedAt;
    }

    // `--notice` is the session hook's entry point: one line if something is behind, silence otherwise.
    // stdout, not stderr: a SessionStart hook's stdout is what becomes context for the session. Silence when
    // everything is current, so the line only ever appears when it has something to say.
    if (flag('notice')) {
      const line = updateNotice({ registrations, latest });
      if (line) console.log(line);
      return;
    }
    say(formatVersion({ running, registrations, latest, checkedAt }, color));
    return;
  }

  const root = repoRoot();
  const configPath = typeof flag('config') === 'string' ? flag('config') : undefined;

  if (cmd === 'init') return init(root, configPath);

  const cfg = resolveConfig(root, configPath);
  const withGit = !flag('no-git');

  if (cmd === 'scan') {
    const index = buildIndex(root, cfg, { withGit });
    if (flag('json')) {
      const { documents, ...rest } = index;
      console.log(JSON.stringify({
        ...rest,
        documents: documents.map(({ body, ...d }) => d),   // body is large and rarely wanted as JSON
      }, null, 2));
    } else {
      say(summarise(index, cfg));
    }
    return;
  }

  if (cmd === 'tasks') {
    const plan = readPlanning(root, cfg);
    if (!plan) { console.error('No planning source configured. Set planning.source in project-atlas.config.json.'); process.exitCode = 1; return; }
    if (plan.missing) { console.error(`${plan.source} not found.`); process.exitCode = 1; return; }
    if (flag('json')) { console.log(JSON.stringify(plan, null, 2)); return; }
    say(formatTasks(plan, positionals[0], color));
    return;
  }

  if (cmd === 'branch') {
    const [type, ...rest] = positionals;
    if (!type) {
      const st = branchStatus(root, cfg);
      if (flag('json')) { console.log(JSON.stringify(st, null, 2)); return; }
      say(formatBranch(st, color));
      // Exit non-zero when it is not safe to commit, so a hook or a script can gate on it.
      if (st.ok && st.problems.some((p) => p.level === 'block')) process.exitCode = 1;
      return;
    }
    const r = createBranch(root, type, rest.join('-'));
    if (!r.ok) { console.error(r.reason); process.exitCode = 1; return; }
    say(`Switched to ${r.name}`);
    say(`  Uncommitted work came with you. One logical change per branch — if it needs an "and", split it.`);
    return;
  }

  if (cmd === 'capabilities' || cmd === 'caps') {
    const host = detectHost(root, cfg);
    const caps = await probeCapabilities(root, host, { offline: !!flag('offline'), fresh: !!flag('fresh') });
    if (flag('json')) { console.log(JSON.stringify({ host, caps }, null, 2)); return; }
    say(formatCapabilities(host, caps, color));
    return;
  }

  if (cmd === 'community') {
    const host = detectHost(root, cfg);
    const caps = await probeCapabilities(root, host, { offline: !!flag('offline') });
    const index = buildIndex(root, cfg, { withGit });
    const health = runHealth(index, cfg, root);
    const assets = communityAssets(index, health, readPlanning(root, cfg), host, caps, cfg);

    if (!flag('write')) {
      say(`Would generate ${assets.files.size} file(s) for ${host.slug || 'this repository'}:`);
      for (const f of assets.files.keys()) say(`  ${fs.existsSync(path.join(root, f)) ? 'skip (exists)' : 'create      '}  ${f}`);
      if (assets.skipped.length) {
        say('\nNot generated, and why:');
        for (const s2 of assets.skipped) say(`  · ${s2}`);
      }
      say('\nRe-run with --write to create them, --force to overwrite existing ones.');
      return;
    }
    const r = writeCommunity(root, assets, { force: !!flag('force') });
    for (const f of r.written) say(`  wrote  ${f}`);
    for (const f of r.kept) say(`  kept   ${f}  (already exists; --force to overwrite)`);
    if (assets.skipped.length) {
      say('\nNot generated, and why:');
      for (const s2 of assets.skipped) say(`  · ${s2}`);
    }
    return;
  }

  if (cmd === 'changes') {
    const index = flag('no-index') ? null : buildIndex(root, cfg, { withGit });
    const k = readChanges(root, cfg, index);
    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    say(formatChanges(k, color));
    return;
  }

  if (cmd === 'diff') {
    const file = positionals[0];
    // No path? List what there is to ask about, rather than printing usage and making the caller run a
    // second command. This is also what lets `/atlas:diff` be a single `atlas diff "$ARGUMENTS"` with no
    // shell operators: Claude Code's permission checker splits a compound command and asks about each part,
    // so `test -n "" && atlas diff ""` prompted for approval of a call that was never going to run.
    if (!file) {
      const k = readChanges(root, cfg);
      if (!k.available) { console.error(`Cannot list changes: ${k.reason}`); process.exitCode = 1; return; }
      // Uncommitted work first — it is what someone asking "what changed?" almost always means. The branch's
      // committed files are listed after, and labelled, so the two are never silently merged into one list.
      const local = [...(k.unstaged || []), ...(k.staged || [])].map((f) => f.path);
      const onBranch = (k.committed || []).map((f) => f.path).filter((p) => !local.includes(p));
      if (!local.length && !onBranch.length) { say('Nothing has changed — the working tree matches HEAD.'); return; }
      if (local.length) {
        say(`${local.length} uncommitted file(s):\n`);
        for (const f of local.slice(0, 30)) say(`  atlas diff ${f}`);
      }
      if (onBranch.length) {
        // `readChanges` falls back to the last two commits when the branch has not diverged, so on `main`
        // there is no "since main" to speak of. Say which it is rather than printing "on main since main".
        const where = k.scope === 'branch' ? `on ${k.branch} since ${k.main}` : 'in the last commit(s)';
        say(`${local.length ? '\n' : ''}${onBranch.length} more changed ${where}:\n`);
        for (const f of onBranch.slice(0, 30)) say(`  atlas diff ${f}`);
      }
      return;
    }
    const d = fileDiff(root, file, { scope: String(flag('scope', 'auto')), cfg });
    if (!d.diff) { say(`No changes to ${file} in ${d.from}.`); return; }
    // Printed whole only when asked for; the skill summarises rather than pasting it back.
    say(`${file} — ${d.from}\n`);
    say(d.diff);
    return;
  }

  if (cmd === 'tokens') {
    // Opt-in by construction: this is the only command that reads session transcripts, and nothing else
    // in the tool touches them.
    const out = typeof flag('out') === 'string' ? flag('out') : null;
    if (out) assertNotPublishable(root, cfg, out);

    say(`Reading local session transcripts from ${transcriptDir(root, cfg)}`);
    say('  These are not part of the repository. They hold every prompt and file read of every session,');
    say('  so this report aggregates only — no prompt text, no paths, and it is never published.\n');

    // Carriage-return progress only makes sense on a terminal; piped, it smears into the output.
    const live = !quiet && process.stderr.isTTY;
    const k = await readTokens(root, cfg, { onProgress: (m) => live && process.stderr.write(m + '\r') });
    if (live) process.stderr.write(' '.repeat(48) + '\r');

    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    const report = formatTokens(k, color);
    if (out) {
      fs.writeFileSync(path.resolve(root, out), formatTokens(k, false) + '\n', 'utf8');
      say(`Wrote ${out}`);
    } else {
      say(report);
    }
    if (!k.available) process.exitCode = 1;
    return;
  }

  if (cmd === 'sessions') {
    const out = typeof flag('out') === 'string' ? flag('out') : null;
    if (out) assertNotPublishable(root, cfg, out);
    say(`Reading local session transcripts from ${transcriptDir(root, cfg)}\n`);
    const live = !quiet && process.stderr.isTTY;
    const k = await readTokens(root, cfg, { onProgress: (m) => live && process.stderr.write(m + '\r') });
    if (live) process.stderr.write(' '.repeat(48) + '\r');
    const contribForOutcomes = readContrib(root, cfg);
    if (flag('json')) { console.log(JSON.stringify({ outcomes: k.outcomes, quality: contribForOutcomes.quality }, null, 2)); return; }
    const report = formatSessions(k, contribForOutcomes, color);
    if (out) { fs.writeFileSync(path.resolve(root, out), formatSessions(k, contribForOutcomes, false) + '\n', 'utf8'); say(`Wrote ${out}`); }
    else say(report);
    if (!k.available) process.exitCode = 1;
    return;
  }

  if (cmd === 'contrib') {
    const k = readContrib(root, cfg);
    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    say(formatContrib(k, readPlanning(root, cfg), color));
    if (!k.available) process.exitCode = 1;
    return;
  }

  // `--gate` is the commit hook's entry point. It reports only when it has something to refuse, because a hook
  // that prints on every commit is a hook people disable. Exit 1 means blocking findings; the hook maps that
  // to its own exit 2, which is the only code that stops a tool call.
  if (cmd === 'health' && flag('gate')) {
    // Same opt-in rule as `build --auto`: no config, no gate. Refusing commits in a repository that never
    // adopted the tool would be a plugin deciding someone else's policy for them.
    if (!cfg.__configPath || cfg.automation.healthOnCommit === false) return;
    const index = buildIndex(root, cfg, { withGit });
    const health = runHealth(index, cfg, root);
    if (!health.blockingCount) return;
    const blocking = health.findings.filter((f) => f.blocking);
    console.error(`project-atlas: ${health.blockingCount} blocking documentation signal(s) — this commit would land known rot.\n`);
    for (const f of blocking.slice(0, 10)) console.error(`  ${f.signal}  ${f.doc}${f.detail ? `  ${f.detail}` : ''}`);
    if (blocking.length > 10) console.error(`  … and ${blocking.length - 10} more`);
    console.error(`\n  atlas health --verbose        see all of them`);
    console.error(`  automation.healthOnCommit     set false in project-atlas.config.json to stop gating commits`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'health') {
    const index = buildIndex(root, cfg, { withGit });
    const health = runHealth(index, cfg, root);
    const verbose = flag('verbose');
    say(formatReport(health, index, { verbose: verbose === 'all' ? 'all' : !!verbose, color }));
    if (flag('json')) console.log(JSON.stringify({ counts: health.counts, blockingCount: health.blockingCount, findings: health.findings.map(({ ...f }) => f) }, null, 2));
    process.exitCode = health.blockingCount ? 1 : 0;
    return;
  }

  if (cmd === 'build' || cmd === 'all') {
    // `--auto` is the write hook's entry point: build only if the user has left the switch on, and exit 0
    // either way. A hook that fails because a feature is disabled would block the edit that triggered it.
    // No config file means this repository never opted in. The plugin is installed user-wide, so without this
    // every markdown edit in every unrelated repository would generate a docs/_wiki nobody asked for.
    if (flag('auto') && (!cfg.__configPath || cfg.automation.buildOnWrite === false)) return;
    const r = doBuild(root, cfg, withGit, cmd === 'all');
    if (cmd === 'all' && r.health.blockingCount) process.exitCode = 1;
    return;
  }

  if (cmd === 'publish') {
    const target = String(flag('target', 'wiki'));
    const push = !!flag('push');
    const index = buildIndex(root, cfg, { withGit });
    const health = runHealth(index, cfg, root);
    const plan = readPlanning(root, cfg);

    const host = detectHost(root, cfg);
    const caps = await probeCapabilities(root, host, { offline: !!flag('offline') });
    const gate = gateTarget(target, host, caps);
    if (gate.warn) say(`  note: ${gate.warn}`);
    if (!gate.ok) {
      console.error(`\nRefusing to publish to ${target}. ${gate.reason}`);
      if (gate.hint) console.error(`  ${gate.hint}`);
      process.exitCode = 1;
      return;
    }

    if (target === 'wiki') {
      const built = buildWikiPages(index, health, plan, cfg, root);
      const r = stageWiki(root, cfg, built, { push, force: !!flag('force'), importDrift: !!flag('import'), host });

      if (!r.staged) {
        console.error(`\nRefusing to publish — the wiki at ${r.url} has ${r.drift.length} change(s) not written by project-atlas.\n`);
        for (const d of r.drift.slice(0, 20)) {
          console.error(`  ${d.kind.padEnd(9)} ${d.page}${d.source ? `   (from ${d.source})` : ''}${d.detail ? `\n    ${d.detail}` : ''}`);
        }
        if (r.drift.length > 20) console.error(`  … and ${r.drift.length - 20} more`);
        console.error(r.importDir
          ? `\nThe edited pages were copied to:\n  ${r.importDir}\n  MAPPING.json gives each page's source file. Fold the changes into the source markdown, then publish again.`
          : `\nRe-run with --import to copy the edited pages out for review, or --force to overwrite them.`);
        process.exitCode = 1;
        return;
      }

      say(`Staged ${r.count} wiki page(s) → ${r.work}`);
      say(r.driftChecked
        ? `  Drift check ran against the live wiki — no page there was edited by hand since the last publish.`
        : `  Drift check did NOT run: there is no wiki at ${r.url} yet, so there was nothing to compare against.`);
      if (r.collisions?.length) {
        say(`  ${r.collisions.length} page-name collision(s) resolved by suffixing; both documents are published:`);
        for (const c of r.collisions.slice(0, 5)) say(`    ${c.renamed} → ${c.to}`);
      }
      say(r.pushed ? `  Pushed to ${r.url}` : `  Not pushed. Review the staged files, then re-run with --push.`);
      return;
    }

    if (target === 'pages') {
      if (host.kind === 'gitlab' && flag('ci')) {
        const dest = path.resolve(root, '.gitlab-ci.yml');
        say(fs.existsSync(dest)
          ? `.gitlab-ci.yml already exists — add this job to it:\n\n${gitlabPagesJob(cfg)}`
          : (fs.writeFileSync(dest, gitlabPagesJob(cfg), 'utf8'), 'Wrote .gitlab-ci.yml with a pages job.'));
        return;
      }
      const r = stagePages(root, cfg, { push });
      say(`Staged the site → ${r.work}`);
      say(r.pushed
        ? `  Pushed to branch ${r.branch}${r.url ? `\n  Will serve at ${r.url} once Pages is enabled for that branch.` : ''}`
        : `  Not pushed. Review it, then re-run with --push to force-push branch ${r.branch}.`);
      return;
    }

    if (target === 'export') {
      const which = String(flag('page', 'dashboard'));
      // `--page all` carries every generated page with the navigation working in-document. It is the right
      // default for anywhere the file travels alone — publishing one page of a nine-page site as an Artifact
      // gives the reader a view and no way out of it.
      const html = which === 'all' ? exportBundle(root, cfg, null, await aboutFacts(root, cfg))
                                   : exportSingleFile(root, cfg, which);
      const dest = path.resolve(root, String(flag('out', `${cfg.output}/${which}.standalone.html`)));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, html, 'utf8');
      say(`Wrote a self-contained ${which} → ${path.relative(root, dest)} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
      return;
    }

    console.error(`Unknown publish target: ${target}. Use wiki, pages or export.`);
    process.exitCode = 2;
    return;
  }

  if (cmd === 'watch') {
    doBuild(root, cfg, withGit, false);
    const interval = Number(flag('interval', 1500)) || 1500;
    say(`\nWatching for changes (poll every ${interval}ms). The open page reloads itself. Ctrl-C to stop.`);
    let last = fingerprint(root, cfg);
    setInterval(() => {
      const now = fingerprint(root, cfg);
      if (now === last) return;
      last = now;
      try {
        const r = doBuild(root, cfg, withGit, false, { stamp: true });
        say(`  rebuilt — ${r.pages} page(s), ${r.health.blockingCount} blocking`);
      } catch (err) {
        console.error(`  build failed, watching continues: ${err.message}`);
      }
    }, interval);
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  usage();
  process.exitCode = 2;
}

/** A terminal view of the planning document: progress bars, grouped by track. */
function formatTasks(plan, filter, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, blue: (s) => `\x1b[34m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  let items = plan.items;
  if (filter) {
    const f = filter.toLowerCase();
    items = items.filter((i) => [i.id, i.title, i.track, i.priority, i.criticality, i.status.label]
      .join(' ').toLowerCase().includes(f));
  }

  const bar = (pct) => {
    if (pct === null) return c.dim('░'.repeat(12)) + '   ? ';
    const filled = Math.round((pct / 100) * 12);
    const glyph = '█'.repeat(filled) + c.dim('░'.repeat(12 - filled));
    const paint = pct === 0 ? c.dim : pct >= 90 ? c.green : pct >= 40 ? c.blue : c.yellow;
    return paint(glyph) + String(pct).padStart(4) + '%';
  };

  const L = [];
  L.push(c.bold(`${plan.source} — ${plan.stats.total} open item(s), mean completion ${plan.stats.mean ?? '—'}%`));
  if (filter) L.push(c.dim(`filtered by "${filter}" — ${items.length} match(es)`));
  L.push('');

  for (const t of plan.tracks) {
    const own = items.filter((i) => i.track === t.name);
    if (!own.length) continue;
    L.push(c.bold(t.name) + c.dim(`  ${own.length} item(s)` + (t.mean === null ? '' : ` · mean ${t.mean}%`)));
    for (const i of own.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))) {
      const est = i.estimated ? c.dim('*') : ' ';
      L.push(`  ${i.id.padEnd(5)} ${bar(i.percent)}${est} ${c.dim(i.priority)} ${i.title}`);
    }
    L.push('');
  }

  const s = plan.stats;
  L.push(c.dim('  ' + s.byStatus.map((b) => `${b.label} ${b.count}`).join(' · ') +
    (s.unknown ? ` · Unknown ${s.unknown}` : '')));
  if (s.estimated) L.push(c.dim(`  ${s.estimated} figure(s) marked * are estimated in the source, not measured against the code.`));
  return L.join('\n');
}

function doBuild(root, cfg, withGit, withReport, { stamp = false } = {}) {
  const index = buildIndex(root, cfg, { withGit });
  const health = runHealth(index, cfg, root);
  if (withReport) say(formatReport(health, index, { verbose: !!flag('verbose'), color }), '\n');
  const { outDir, pages, truncated, plan, deck, collisions } = renderSite(index, health, cfg, root);
  if (stamp || flag('watch')) writeBuildStamp(root, cfg, new Date().toISOString().slice(11, 19));

  // `pages` is counted from the files actually written, not from the index — see render.mjs. A collision that
  // had to be renamed is stated rather than left to look like an ordinary build.
  say(`Built ${pages} page(s) → ${path.relative(root, outDir) || outDir}`);
  if (collisions?.length) {
    say(`  ${collisions.length} page-name collision(s) resolved by suffixing; both documents are written:`);
    for (const c of collisions.slice(0, 5)) say(`    ${c.renamed} → ${c.to}`);
  }
  if (truncated) say(`  ${truncated} long document(s) indexed to the first ${(cfg.searchBodyLimit || 6000).toLocaleString()} characters for search.`);
  say(plan && !plan.missing
    ? `  Dashboard: ${plan.stats.total} item(s) from ${plan.source}${plan.stats.unknown ? `, ${plan.stats.unknown} without a figure` : ''}.`
    : `  Dashboard: no planning source configured — set planning.source to chart a task list.`);
  say(deck ? `  Deck: ${deck.slides.length} slide(s) from ${deck.source}.` : `  Deck: none — create docs/atlas/DECK.md to add one.`);
  say(`  Open: file://${path.join(outDir, 'index.html')}`);
  return { index, health, pages, outDir };
}

/** Cheap change detector for watch mode: names, sizes and mtimes of every input the build reads. */
function fingerprint(root, cfg) {
  const parts = [];
  for (const f of discover(root, cfg)) {
    try { const s = fs.statSync(path.join(root, f)); parts.push(`${f}:${s.size}:${s.mtimeMs}`); } catch { /* removed mid-scan */ }
  }
  for (const extra of [cfg.planning?.source, cfg.deck?.source, 'docs/atlas/DECK.md'].filter(Boolean)) {
    try { const s = fs.statSync(path.join(root, extra)); parts.push(`${extra}:${s.size}:${s.mtimeMs}`); } catch { /* absent */ }
  }
  return parts.join('|');
}

function summarise(index, cfg) {
  const L = [];
  L.push(`${index.siteTitle} — ${index.stats.documents} documents, ${index.stats.lines.toLocaleString()} lines, ${(index.stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  L.push(`${index.stats.links} internal links · ${index.stats.citations} code citations · git metadata ${index.stats.withGit ? 'on' : 'OFF'}`);
  L.push('');
  const width = Math.max(...index.clusters.map((c) => c.title.length));
  for (const c of index.clusters) {
    L.push(`  ${c.title.padEnd(width)}  ${String(c.documents.length).padStart(4)}`);
  }
  const orphans = index.documents.filter((d) => !d.backlinks.length).length;
  L.push('');
  L.push(`  ${orphans} document(s) have no inbound link.`);
  if (!index.documents.some((d) => /(^|\/)README\.md$/i.test(d.path) && d.path.includes('/')))
    L.push(`  No docs/README.md — there is no written entry point to this corpus.`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ init */

function init(root, configPath) {
  const target = configPath ? path.resolve(configPath) : path.join(root, CONFIG_NAME);
  if (fs.existsSync(target) && !flag('force')) {
    console.error(`${path.relative(root, target)} already exists. Pass --force to overwrite (your customisations will be lost).`);
    process.exitCode = 1;
    return;
  }

  // Probe with defaults so the generated config reflects what is actually here.
  const probe = { ...DEFAULT_CONFIG, siteTitle: path.basename(root) };
  const files = discover(root, probe);
  const dirs = new Map();
  for (const f of files) {
    const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    dirs.set(d, (dirs.get(d) || 0) + 1);
  }

  const used = new Set();
  for (const f of files) {
    for (const c of DEFAULT_CLUSTERS) {
      if (c.match.some((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*') + '$').test(f))) { used.add(c.id); break; }
    }
  }

  const cfg = {
    $schema: DEFAULT_CONFIG.$schema,
    siteTitle: path.basename(root),
    output: DEFAULT_CONFIG.output,
    trackedOnly: true,
    exclude: DEFAULT_CONFIG.exclude,
    clusters: DEFAULT_CLUSTERS.filter((c) => used.has(c.id)),
    fallbackCluster: 'uncategorised',
    blocking: DEFAULT_CONFIG.blocking,
    staleDays: DEFAULT_CONFIG.staleDays,
    forbiddenTerms: [],
    crossref: [],
    suppress: [],
  };
  if (!cfg.clusters.length) cfg.clusters = DEFAULT_CLUSTERS;

  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  say(`Wrote ${path.relative(root, target)}`);
  say(`  ${files.length} markdown file(s) across ${dirs.size} directories.`);
  say(`  ${cfg.clusters.length} cluster(s) kept of ${DEFAULT_CLUSTERS.length} defaults — the rest matched nothing here.`);
  say('');
  say('  Next: review the clusters, then add the two checks that are off until configured —');
  say('    forbiddenTerms  retired product or persona names   (enables H7)');
  say('    crossref        paired documents, e.g. backlog + task list  (enables H9)');
  say('');
  const top = [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  say('  Largest documentation directories:');
  for (const [d, n] of top) say(`    ${String(n).padStart(4)}  ${d}`);
}

function usage() {
  console.log(`project-atlas — a derived, auditable knowledgebase over your repository's documentation.

  atlas version              which build is answering, where it lives, and whether it is behind
  atlas init                 write ${CONFIG_NAME}, detecting this repository's layout
  atlas scan  [--json]       build and summarise the index
  atlas branch [type slug]   branch state, or create type/short-slug carrying your changes
  atlas caps                 which host features are on (wiki/pages/issues/discussions)
  atlas community [--write]  scaffolding for the features this host actually supports
  atlas changes [--json]     what changed, and which documents cite it
  atlas diff <file>          that file's diff — uncommitted, else across the branch
  atlas tokens [--out FILE]  token accounting from local session transcripts — opt-in, never published
  atlas sessions [--out F]   how sessions went — turns, interruptions, friction, rework
  atlas contrib [--json]     who did what, from git history alone
  atlas health [--verbose]   report rot signals; exit 1 if any blocking signal fires
  atlas build                generate the static site (index, dashboard, deck, health)
  atlas watch                build, then rebuild on change; the open page reloads itself
  atlas all                  scan + health + build
  atlas publish              stage a target; NOTHING is pushed without --push
    --target wiki            GitHub Wiki — flattened markdown, links rewritten, drift-guarded
    --target pages           the full site to a gh-pages branch (dashboard + deck survive)
    --target export          one self-contained HTML file (--page dashboard|index|health)
    --ci                     (GitLab, pages) write the .gitlab-ci.yml job instead — Pages is an artifact there

Flags
  --root <dir>       repository root (default: git toplevel, else cwd)
  --config <path>    config file (default: <root>/${CONFIG_NAME})
  --verbose[=all]    list findings, not just counts
  --json             machine-readable output
  --no-git           skip git metadata; staleness is reported as unchecked rather than guessed
  --offline          skip the capability probe; assume features exist and say so
  --quiet            suppress progress output
  --force            (init) overwrite an existing config

The markdown is the source of truth. Everything this tool writes is derived and safe to delete.`);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exitCode = 1;
});
