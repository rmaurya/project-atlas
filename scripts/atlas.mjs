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
 *   atlas note     append one continuity record — what was decided or touched, never what was said
 *   atlas state    what a resuming session reads first, reconstructed from the journal
 *   atlas contrib  who did what, from git: people, agents, desks, hours, outcomes
 *   atlas health   report rot signals         (--verbose | --verbose=all)  exit 1 on blocking
 *   atlas build    generate the static site (index, dashboard, deck, health)
 *   atlas watch [--serve]      rebuild on change; --serve hosts it live at http://127.0.0.1:4173
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
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_CLUSTERS, CONFIG_NAME , automationAllows } from './lib/config.mjs';
import { buildIndex, discover } from './lib/scan.mjs';
import { readPlanning } from './lib/planning.mjs';
import { runHealth, formatReport } from './lib/health.mjs';
import { renderSite, writeBuildStamp } from './lib/render.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { confine } from './lib/paths.mjs';
import { buildWikiPages, stageWiki, stagePages, exportSingleFile, exportBundle, gitlabPagesJob } from './lib/publish.mjs';
import { readContrib, formatContrib } from './lib/contrib.mjs';
import { detectHost, probeCapabilities, gateTarget, formatCapabilities } from './lib/host.mjs';
import { communityAssets, writeCommunity } from './lib/community.mjs';
import { branchStatus, createBranch, formatBranch, TYPES } from './lib/branch.mjs';
import { readTokens, formatTokens, formatSessions, transcriptDir, assertNotPublishable } from './lib/tokens.mjs';
import { readChanges, formatChanges, fileDiff } from './lib/changes.mjs';
import { formatVersion, updateNotice, isPluginCache } from './lib/version.mjs';
import { specVerdict, idsIn } from './lib/spec.mjs';
import { checkForUpdate, readCache } from './lib/update.mjs';
import { verifySite, formatVerify } from './lib/verify.mjs';
import { route, formatRoute } from './lib/plan.mjs';
import { dayKey, commitsOn, renderDay, writeDay } from './lib/worklog.mjs';
import { ownership, summariseOwnership } from './lib/ownership.mjs';
import { survivingLines, formatSurviving } from './lib/surviving.mjs';
import { note, read as readJournal, formatState, KINDS } from './lib/journal.mjs';
import { setItemPercent, itemFromBranch, contradictsPlan, STARTED_PERCENT } from './lib/progress.mjs';
import { handoffPath, handoffAge, formatHandoffPrompt, DEFAULT_STALE_AFTER } from './lib/handoff.mjs';
import { acquire as acquireBuildLock } from './lib/lock.mjs';
import { startServer, spawnDetached, serverStatus, stopServer, writePid, clearPid, openInBrowser, portInUse, unmanagedServer,
         portForRoot, readRegistry, registerServer, deregisterServer, DEFAULT_PORT, DEFAULT_IDLE_MS } from './lib/serve.mjs';

const argv = process.argv.slice(2);

/**
 * Flags that consume the next argument when written with a space (`--target wiki`). Everything else is a
 * boolean, so a positional after a boolean flag stays positional — `atlas tasks --json safety` keeps `safety`
 * as the filter rather than swallowing it as `--json`'s value.
 */
const VALUE_FLAGS = new Set(['target', 'page', 'out', 'root', 'config', 'interval', 'refs', 'agent', 'since', 'day', 'why', 'port', 'idle-ms', 'item']);

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

/**
 * "This repository has not adopted the tool", or `null` when saying so would be noise.
 *
 * Deliberately narrow. It stays quiet outside a git repository, quiet when a config already exists, and quiet
 * in a repository with almost no markdown — a Swift app with one README does not want a documentation
 * knowledgebase, and a plugin that suggests one in every directory is a plugin people disable.
 */
/** Semver order, for sorting and comparing. Unparseable sorts first, so it never wins a `.pop()`. */
function cmpSemver(a, b) {
  const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
  const [x, y] = [p(a), p(b)];
  if (x.length !== 3) return -1;
  if (y.length !== 3) return 1;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Lines from a git command, or `[]`. Never throws — every caller is a gate that must decide, not crash. */
function gitLines(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch { return []; }
}

/**
 * The whole of stdin, or `null` when there is none.
 *
 * `null` is not "empty" — it means the message was never handed over, and the caller refuses on it rather
 * than treating an unreadable message as an acceptable one.
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data.trim() === '' ? null : data));
    process.stdin.on('error', () => resolve(null));
  });
}

function adoptionNotice() {
  const MIN_DOCS = 3;
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }                                   // not a repository; nothing to adopt
  if (!root) return null;

  for (const name of [CONFIG_NAME, 'docs-atlas.config.json', 'llm-wiki.config.json']) {
    if (fs.existsSync(path.join(root, name))) return null;   // already adopted
  }

  let count = 0;
  try {
    count = execFileSync('git', ['-C', root, 'ls-files', '*.md', '**/*.md'],
                         { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean).length;
  } catch { return null; }
  if (count < MIN_DOCS) return null;

  return `project-atlas is installed but this repository has not adopted it — no ${CONFIG_NAME}, so its hooks ` +
         `do nothing here. ${count} markdown file(s) are indexable: run \`atlas init\` then \`atlas all\`.`;
}

/**
 * One line on stderr when the installed plugin is behind, printed by **any** command.
 *
 * The session-start notice only speaks at session start, and a session that has been open for hours is
 * precisely the one running stale skills. The failure was reported as "/atlas:ask is broken" — it was not;
 * it was thirteen releases old, and nothing said so at the moment it failed.
 *
 * **Reads the cache, never the network.** A command that made an HTTP request would be a command that hangs
 * offline, and this runs on every invocation. The fetch stays in the session hook; this is free.
 */
function staleBanner() {
  if (process.env.ATLAS_UPDATE_CHECK === '0' || flag('json') || quiet || cmd === 'version') return;

  // **The session, not the disk.** `atlas version` reports what is *installed*; nothing reported what this
  // session actually loaded, and that difference caused nearly every failure in the day this was written —
  // a dashboard that would not rebuild, a branch guard that never fired, an update notice that stayed
  // silent, and a skill failing with syntax that had been replaced fifteen releases earlier.
  //
  // It is detectable without asking anyone: this binary lives in a version-keyed plugin directory, so it
  // knows which build is running. If that is older than what is registered as installed, the session is
  // holding a stale copy and no amount of updating the disk will reach it.
  const running = runningBuild();
  const regs = readRegistrations();
  const newest = regs.map((r) => r.version).sort(cmpSemver).pop();
  if (running.fromCache && newest && cmpSemver(running.version, newest) < 0) {
    console.error(`This session loaded project-atlas ${running.version}; ${newest} is installed. ` +
      `Restart Claude Code — hooks, skills and permission rules are read once at session start, so updating ` +
      `the plugin does not reach a session already running.`);
    return;                       // one line, not two: the newer problem is the one to act on
  }

  let latest = null;
  try { latest = readCache()?.latest || null; } catch { return; }
  if (!latest) return;
  const behind = readRegistrations().filter((r) => {
    const p = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
    const [x, y] = [p(r.version), p(latest)];
    if (x.length !== 3 || y.length !== 3) return false;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  });
  if (!behind.length) return;
  const worst = behind.map((r) => r.version).sort()[0];
  console.error(`project-atlas ${worst} is installed; ${latest} is published. Run /plugin, then /reload-plugins — ` +
                `hooks and skills are read once at session start, so an updated plugin does not reach a running session.`);
}

async function main() {
  staleBanner();
  if (cmd === 'help' || flag('help')) return usage();

  // Answers from its own installation, so it works in any directory, repository or not.
  if (cmd === 'version') {
    const running = runningBuild();
    const registrations = readRegistrations();
    let repository = null;
    try { repository = JSON.parse(fs.readFileSync(path.join(running.pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).repository; } catch {}

    let latest = null, checkedAt = null;
    if (!flag('offline')) {
      const r = await checkForUpdate({ repository, force: !!flag('check'), installed: running.version });
      latest = r.latest; checkedAt = r.checkedAt;
    }

    // `--notice` is the session hook's entry point: one line if something is behind, silence otherwise.
    // stdout, not stderr: a SessionStart hook's stdout is what becomes context for the session. Silence when
    // everything is current, so the line only ever appears when it has something to say.
    if (flag('notice')) {
      const line = updateNotice({ registrations, latest });
      if (line) console.log(line);
      // **An installed plugin that does nothing must say why.** Both hooks are inert in a repository with no
      // config — deliberately, so installing this does not start writing docs/_wiki into every repository you
      // open. But inert *and silent* is indistinguishable from broken, and it read as broken: enabled in the
      // plugin list, no dashboard, no explanation. One line, only where there is something to index.
      const adopt = adoptionNotice();
      if (adopt) console.log(adopt);
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

    // Creating a branch is the moment work demonstrably starts, and the only moment the tool can observe it
    // without asking anyone to remember anything. So the plan is marked here rather than left to an
    // instruction in a document — an agent that forgets is the normal case, not an unusual one.
    if (automationAllows(cfg, 'planOnBranch')) {
      const plan = readPlanning(root, cfg);
      if (plan && !plan.missing) {
        const id = typeof flag('item') === 'string' ? flag('item').toUpperCase() : itemFromBranch(r.name, plan.items);
        if (id) {
          const upd = setItemPercent(root, cfg, id, STARTED_PERCENT);
          if (upd.changed) {
            say(`  ${id} marked in progress (${upd.from}% → ${upd.to}%) in ${upd.source}.`);
            // Identity must be passed explicitly. Omitting it defaults to null, which slugs to `unknown` —
            // so every record the tool wrote itself landed in unknown.jsonl instead of the contributor's
            // file, quietly defeating the per-contributor scheme it was written to support.
            try {
              note(root, cfg, { kind: 'progress', text: `started ${id} on ${r.name}`, refs: [r.name],
                identity: gitLines(root, ['config', 'user.name'])[0] || null });
            } catch {}
            // Rebuild so the dashboard shows it now. Detached from the caller's success: a branch that was
            // created must not report failure because a rebuild did.
            try { doBuild(root, cfg, withGit, false, { stamp: true }); } catch {}
          } else if (upd.from !== undefined) {
            say(`  ${id} is already at ${upd.from}% — left alone. A figure only ever moves up on its own.`);
          }
        } else {
          say(`  No plan item named in the branch. \`--item <ID>\` records which one this advances.`);
        }
      }
    }
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

  /*
   * `atlas note` — append one record to the journal.
   *
   * Deliberately the smallest possible command. It is called by hooks at moments when a session is being
   * torn down, so anything it depends on is something that can fail exactly when the record matters most:
   * no index, no health run, no git log. It resolves an identity, appends a line, and returns.
   */
  if (cmd === 'note') {
    const kind = positionals[0];
    const text = positionals.slice(1).join(' ');
    if (!kind || !text) {
      say('');
      say('  atlas note <kind> "<what happened>" [--refs a,b] [--agent name]');
      say('');
      for (const [k, why] of Object.entries(KINDS)) say(`    ${k.padEnd(9)} ${why}`);
      say('');
      say('  Records what was decided and touched — never what was said. Never published.');
      say('');
      return;
    }
    const refs = typeof flag('refs') === 'string' ? String(flag('refs')).split(',').map((s) => s.trim()) : [];
    const rec = note(root, cfg, {
      kind, text, refs,
      why: typeof flag('why') === 'string' ? flag('why') : null,
      agent: typeof flag('agent') === 'string' ? flag('agent') : 'main',
      identity: gitLines(root, ['config', 'user.name'])[0] || null,
    });
    if (!flag('quiet')) say(`Recorded ${rec.kind}: ${rec.text}`);
    return;
  }

  /*
   * `atlas state` — what a resuming session reads first.
   *
   * Ordered by what a person needs before they can act: where they are, what is uncommitted, and then what
   * the journal recorded. It groups and orders; it does not summarise. Summarising would be the tool writing
   * prose about work it did not do.
   */
  if (cmd === 'state') {
    const journal = readJournal(root, { since: typeof flag('since') === 'string' ? flag('since') : null });
    if (flag('json')) { console.log(JSON.stringify(journal, null, 2)); return; }
    say(formatState({
      journal,
      branch: branchStatus(root, cfg),
      version: runningBuild().version,
      handoffAt: null,
    }));
    return;
  }

  /*
   * `atlas handoff` — the derived half, as a prompt.
   *
   * It never writes the file. A machine can see that a commit happened; it cannot see that a decision was
   * argued and settled. A generated handoff would be confident prose nobody reviewed, going stale from the
   * moment it was written — which is the thing this tool exists to detect.
   */
  if (cmd === 'handoff') {
    const identity = gitLines(root, ['config', 'user.name'])[0] || null;
    const file = handoffPath(root, cfg, identity);
    const age = handoffAge(root, file);
    if (flag('json')) { console.log(JSON.stringify({ file, age }, null, 2)); return; }
    say(formatHandoffPrompt({
      branch: branchStatus(root, cfg),
      version: runningBuild().version,
      journal: readJournal(root),
      plan: readPlanning(root, cfg),
      changes: readChanges(root, cfg, null),
      age, identity, file: path.relative(root, file),
    }));
    return;
  }

  if (cmd === 'changes') {
    const index = flag('no-index') ? null : buildIndex(root, cfg, { withGit });
    const k = readChanges(root, cfg, index);
    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    say(formatChanges(k, color));
    return;
  }

  // The resolved configuration — defaults merged with the file, which is what the tool actually acts on. The
  // skill used to `cat` the file through three fallback filenames, which the permission checker could not
  // analyse; and the raw file was the wrong thing to show anyway, since every unset key is a default the
  // reader could not see.
  if (cmd === 'config') {
    const { __configPath, ...shown } = cfg;
    if (flag('json')) { console.log(JSON.stringify(shown, null, 2)); return; }
    say(__configPath ? `${path.relative(root, __configPath)} — merged with the defaults below`
                     : `No config file. These are the defaults; \`atlas init\` writes them out so you can tune them.`);
    say('');
    say(JSON.stringify(shown, null, 2));
    return;
  }

  // Candidate documents for a question. Lives here rather than in a shell block because `grep -ril -- "$Q"`
  // inside a skill cannot be statically analysed by the permission checker, so /atlas:ask refused to run at
  // all. A literal search is also all this ever was — the answering is the model's job, not grep's.
  if (cmd === 'ask') {
    const q = positionals.join(' ').trim();
    const index = buildIndex(root, cfg, { withGit: false });
    if (!q) {
      say(`No question given. ${index.stats.documents} document(s) are indexed; ask about any of them.`);
      return;
    }
    const needle = q.toLowerCase();
    const hits = index.documents
      .map((d) => {
        const inTitle = (d.title || '').toLowerCase().includes(needle);
        const inHeading = d.headings.some((h) => h.text.toLowerCase().includes(needle));
        const inBody = d.body.toLowerCase().includes(needle);
        return { d, score: (inTitle ? 4 : 0) + (inHeading ? 2 : 0) + (inBody ? 1 : 0) };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || a.d.path.localeCompare(b.d.path));

    if (!hits.length) {
      say(`No document contains "${q}" literally. The corpus may still answer it in other words — ` +
          `${index.stats.documents} document(s) across ${index.stats.clusters} clusters.`);
      return;
    }
    say(`${hits.length} document(s) mention "${q}", most relevant first:\n`);
    for (const h of hits.slice(0, 20)) {
      say(`  ${h.d.path}${h.d.title ? `  — ${h.d.title}` : ''}`);
    }
    if (hits.length > 20) say(`  … and ${hits.length - 20} more`);
    return;
  }

  // Propose the route and wait. Every other guard here refuses at `git commit`, which is after the decision.
  if (cmd === 'plan') {
    const st = branchStatus(root, cfg);
    const k = readChanges(root, cfg);
    const changed = [...(k.unstaged || []), ...(k.staged || [])].map((f) => f.path);
    const plan0 = readPlanning(root, cfg);
    const slug = positionals[0] || null;
    const manifest = path.join(root, '.claude-plugin', 'plugin.json');
    let version = null;
    try { version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version; } catch {}
    const hasRemote = gitLines(root, ['remote']).length > 0;

    const r = route({
      changed, slug,
      branch: st.ok ? st.current : null,
      main: cfg.branching?.main || 'main',
      protectedBranch: st.ok && st.problems.some((p) => p.level === 'block'),
      version, hasRemote,
      items: plan0.missing ? [] : plan0.items,
      namedItems: [],
    });

    say(formatRoute(r, color));

    if (!flag('apply')) return;
    if (r.blockers.length) { console.error('\nRefusing to apply: the route is not decided.'); process.exitCode = 1; return; }
    const step = r.steps.find((s) => s.id === 'branch' && !s.done);
    if (!step) { say('\nNothing to apply — already on the branch this change belongs on.'); return; }
    const made = createBranch(root, r.type, r.slug);
    if (!made.ok) { console.error(made.reason); process.exitCode = 1; return; }
    // The branch, and only the branch. Committing and pushing stay explicit: this proposes a route, it does
    // not drive one, and pushing is outward-facing besides.
    say(`\nSwitched to ${made.name}. Nothing else was run.`);
    return;
  }

  if (cmd === 'surviving') {
    const k = survivingLines(root, { limit: Number(flag('limit', 400)) || 400 });
    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    say(formatSurviving(k, color));
    return;
  }

  if (cmd === 'ownership') {
    const contrib = readContrib(root, cfg);
    if (!contrib.available) { console.error('No git history to read.'); process.exitCode = 1; return; }
    const list = ownership(contrib.commits, { depth: Number(flag('depth', 2)) || 2 });
    if (flag('json')) { console.log(JSON.stringify(list, null, 2)); return; }
    say(summariseOwnership(list, contrib.people.length) || 'Nothing to report.');
    say('');
    for (const a of list.slice(0, 25)) {
      const who = a.authors.map((x) => `${x.name} (${x.commits})`).join(', ');
      say(`  ${String(a.busFactor).padStart(2)}  ${a.area.padEnd(26)} ${String(a.files).padStart(3)} file(s)  ${who}`);
    }
    say('');
    say('  The number is authors who have ever committed to that area — not a judgement of the code, and');
    say('  not weighted by how much each wrote. It says what happens if one of them stops.');
    return;
  }

  if (cmd === 'worklog') {
    const contrib = readContrib(root, cfg);
    const index = buildIndex(root, cfg, { withGit });
    const day = typeof flag('day') === 'string' ? flag('day') : dayKey(new Date().getTime());
    const identity = gitLines(root, ['config', 'user.name'])[0] || null;
    const entry = renderDay({
      day, identity, contrib,
      health: runHealth(index, cfg, root),
      plan: readPlanning(root, cfg),
      commits: commitsOn(contrib, day),
    });
    if (flag('stdout')) { console.log(entry); return; }
    const file = writeDay(root, cfg, entry, day, identity);
    if (!file) { say('worklog.enabled is false — nothing was written.'); return; }
    say(`Wrote ${path.relative(root, file)}`);
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

  if (cmd === 'prompt') {
    const index = buildIndex(root, cfg, { withGit });
    const health = runHealth(index, cfg, root);
    const out = buildPrompt({
      cfg, index, health,
      plan: readPlanning(root, cfg),
      version: runningBuild().version,
      slug: detectHost(root, cfg).slug || path.basename(root),
    });
    const dest = typeof flag('out') === 'string' ? flag('out') : null;
    if (!dest) { console.log(out); return; }
    // Confined for the same reason the deck source is: this writes a file at a path the caller names, and
    // `path.join` would have accepted `../../.ssh/config` without comment.
    const file = confine(root, dest, '--out', null);
    fs.writeFileSync(file, out, 'utf8');
    say(`Wrote ${path.relative(root, file) || file}`);
    say('  Regenerate rather than edit — every statement in it is read from this repository.');
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
  // The plan gate. Reads the commit message from stdin so the hook never has to quote it back into a shell.
  if (cmd === 'spec' && flag('gate')) {
    if (!cfg.__configPath || !automationAllows(cfg, 'specOnCommit')) return;
    const plan = readPlanning(root, cfg);
    if (plan.missing || !plan.items.length) return;      // no plan to hold anyone to
    const staged = gitLines(root, ['diff', '--cached', '--name-only']);
    if (!staged.length) return;                          // nothing staged; git will refuse this commit anyway
    const message = await readStdin();
    // `--why` carries the reason the message is missing, which only the caller knows: the hook can see
    // whether it was stdin, an unresolvable -F path, or no message flag at all, and the gate cannot.
    const v = specVerdict({ changed: staged, message, items: plan.items, roadmapPath: plan.source,
      whyUnreadable: typeof flag('why') === 'string' ? flag('why') : 'absent' });

    // The opposite contradiction to the one the gate was built for. It refuses a commit that names no item;
    // this catches a commit that names an item the plan still records as never started — which means the
    // dashboard reported "nothing in progress" for the whole time the work was being done. Repaired rather
    // than refused: the fact is not in dispute, and a refusal here would only ask a person to type what the
    // tool already knows.
    if (v.ok && message && automationAllows(cfg, 'planOnBranch')) {
      const behind = contradictsPlan(idsIn(message).filter((id) => plan.items.some((i) => i.id === id)), plan.items);
      for (const id of behind) {
        const upd = setItemPercent(root, cfg, id, STARTED_PERCENT);
        if (upd.changed) console.error(`project-atlas: ${id} was still recorded as not started; set to ${upd.to}% in ${upd.source}.`);
      }
    }
    if (v.ok) return;
    console.error(`project-atlas: ${v.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'health' && flag('gate')) {
    // Same opt-in rule as `build --auto`: no config, no gate. Refusing commits in a repository that never
    // adopted the tool would be a plugin deciding someone else's policy for them.
    if (!cfg.__configPath || !automationAllows(cfg, 'healthOnCommit')) return;
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
    if (flag('auto') && (!cfg.__configPath || !automationAllows(cfg, 'buildOnWrite'))) return;
    const r = doBuild(root, cfg, withGit, cmd === 'all', { stamp: flag('stamp') });
    // `--verify` audits what was just written. The tool checked other people's markdown and never its own
    // HTML; six defects shipped in one afternoon and a person found every one of them.
    if (flag('verify')) {
      const findings = verifySite(path.resolve(root, cfg.output));
      say('');
      say(formatVerify(findings, color));
      if (findings.length) process.exitCode = 1;
    }
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

  /*
   * `atlas serve` — the live dashboard as a thing that is simply running, rather than a command someone has
   * to remember in a terminal they have to keep.
   *
   * Start, stop, status. Starting is idempotent: a second `atlas serve` when one is already up opens the
   * page rather than fighting for the port, because "make the dashboard appear" is what the person meant
   * both times.
   */
  if (cmd === 'serve') {
    const st = serverStatus(root);

    if (flag('stop')) {
      const r = stopServer(root);
      deregisterServer(root);
      say(r.stopped ? `Stopped the server on port ${r.port} (pid ${r.pid}).` : `Nothing to stop — ${r.reason}.`);
      return;
    }

    // With several projects open the question stops being "is it running" and becomes "which one am I
    // looking at". This answers that across every repository on the machine, not just this one.
    if (flag('list')) {
      const all = readRegistry();
      if (!all.length) { say('No atlas dashboards are running on this machine.'); return; }
      say('');
      for (const e of all) {
        const here = path.resolve(e.root) === path.resolve(root) ? '  <- this repository' : '';
        say(`  ${String(e.port).padEnd(6)} ${(e.name || path.basename(e.root)).padEnd(24)} ${e.url}${here}`);
      }
      say('');
      say('  Each project gets its own port, derived from its path — they do not contend.');
      return;
    }

    if (flag('status')) {
      if (!st.running) {
        // Ask the port, not only the record. A process that outlived its pidfile is invisible to a
        // pidfile-only check, and reporting "not running" about something that is answering is the kind of
        // wrong answer that costs more than no answer.
        const loose = await unmanagedServer(root, typeof flag('port') === 'string' ? Number(flag('port')) : null);
        if (loose) {
          say(`Not running as far as this repository's record goes — but something is answering on ${loose.url}.`);
          say(`  Either a server outlived its pidfile, or another program holds the port.`);
          say(`  \`lsof -nP -iTCP:${loose.port} -sTCP:LISTEN\` names it.`);
          return;
        }
        say(`Not running.${st.stale ? ` Cleared a stale pidfile for pid ${st.stale}.` : ''}`);
        return;
      }
      const stamp = (() => {
        try { return fs.readFileSync(path.join(confine(root, cfg.output, 'output', cfg.__configPath), 'build-stamp.txt'), 'utf8').trim(); }
        catch { return 'no build stamp — the page it serves cannot tell whether it is current'; }
      })();
      say(`Running on ${st.url} (pid ${st.pid}, since ${st.startedAt}).`);
      say(`Serving a build stamped ${stamp}.`);
      return;
    }

    if (st.running) {
      say(`Already running on ${st.url} (pid ${st.pid}).`);
      if (!flag('no-open')) openInBrowser(st.url);
      return;
    }

    // Build before serving. Starting a server over a stale or absent output directory is how a live
    // dashboard shows yesterday's numbers on its first paint and looks broken from the first second.
    // Derived from the repository path, so several projects can be live at once without anyone assigning
    // ports. An explicit --port still wins; a collision probes upward rather than failing, because two
    // checkouts hashing together is a coincidence, not a decision anyone should have to resolve by hand.
    let port = typeof flag('port') === 'string' ? Number(flag('port')) : portForRoot(root);
    if (typeof flag('port') !== 'string') {
      let probes = 0;
      while (await portInUse(port) && probes < 12) { port++; probes++; }
    }
    if (await portInUse(port)) {
      say(`Port ${port} is already in use, and it is not a server this repository started.`);
      say(`  Something else holds it — \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` names it.`);
      say(`  Use \`atlas serve --port <other>\` to run beside it.`);
      process.exitCode = 1;
      return;
    }

    doBuild(root, cfg, withGit, false, { stamp: true });
    const pid = spawnDetached(root, {
      atlasBin: path.join(runningBuild().pluginRoot, 'scripts', 'atlas.mjs'),
      port,
      idleMs: Number(flag('idle-ms', DEFAULT_IDLE_MS)) || DEFAULT_IDLE_MS,
    });

    // The child writes the pidfile once it is actually listening; wait for that rather than announce a URL
    // that may not answer. A port that is taken makes the child exit, and this reports that instead of
    // printing a link to nothing.
    const url = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 50));
      up = serverStatus(root).running;
    }
    if (!up) {
      say(`Started pid ${pid}, but it is not listening on ${port}. Something else may hold that port —`);
      say(`try \`atlas serve --port <other>\`, or \`atlas watch --serve\` to see the error.`);
      return;
    }
    registerServer({ root: path.resolve(root), name: path.basename(path.resolve(root)), port, url, pid });
    say(`\n  Live dashboard: ${url}`);
    say(`  Rebuilds on every markdown change and patches the open page in place. No reload.`);
    say(`  Exits after ${Math.round((Number(flag('idle-ms', DEFAULT_IDLE_MS)) || DEFAULT_IDLE_MS) / 60000)} minutes with nobody watching. \`atlas serve --stop\` ends it now.`);
    if (!flag('no-open')) openInBrowser(url);
    return;
  }

  if (cmd === 'watch') {
    doBuild(root, cfg, withGit, false, { stamp: true });
    const interval = Number(flag('interval', 1500)) || 1500;

    /*
     * `--serve` exists because "the open page reloads itself" was only true if someone else served the
     * files. Watch rebuilt into a directory and stopped there, so a live local dashboard meant standing up
     * a server by hand — and a hand-rolled server dies quietly, leaving a page that looks live, polls a
     * stamp it can no longer reach, and gives up after three misses without saying so. That is exactly how
     * a stale snapshot got mistaken for the dashboard for an entire session.
     *
     * Static files only, from the output directory only, bound to loopback. It is a preview server for
     * files this tool just generated, not a web server, and confining it is what keeps it honest about that.
     */
    if (flag('serve')) {
      const outDir = confine(root, cfg.output, 'output', cfg.__configPath);
      const port = typeof flag('port') === 'string' ? Number(flag('port')) : portForRoot(root);
      // A detached server has no terminal to be watched from, so it exits when nothing has asked it for
      // anything — that idle timer is what makes auto-start safe rather than a source of orphans holding
      // ports. A foreground `watch --serve` gets no timer: someone sitting at the terminal is evidence.
      const idleMs = flag('detached') ? (Number(flag('idle-ms', DEFAULT_IDLE_MS)) || DEFAULT_IDLE_MS) : 0;

      startServer({
        outDir, port, idleMs,
        onIdle: () => { clearPid(root); process.exit(0); },
        onListen: (p) => {
          if (flag('detached')) writePid(root, { pid: process.pid, port: p });
          say(`\n  Serving ${path.relative(root, outDir)} at http://127.0.0.1:${p}/  (loopback only)`);
          say('  This page IS live: it polls the build stamp and patches itself when a rebuild lands.');
          if (!flag('no-open') && !flag('detached')) openInBrowser(`http://127.0.0.1:${p}/`);
        },
      });
      // A detached server that is killed must not leave its claim behind: a stale pidfile stops the next
      // start, which is a worse failure than no server at all.
      for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { clearPid(root); process.exit(0); });
    }

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

function doBuild(root, cfg, withGit, withReport, { stamp = false, autoDerived = true } = {}) {
  // One build at a time. A watcher now always runs, so an overlapping build is the normal case — and the
  // overlap is not benign: the output directory is cleared and repopulated, and whichever build reads it
  // mid-clear sees content with none of its markers and refuses. See lock.mjs.
  const lock = acquireBuildLock(root);
  if (!lock.ok) {
    say(`  Another build is running (pid ${lock.heldBy}); skipped after waiting ${Math.round(lock.waited / 1000)}s.`);
    return { pages: 0, outDir: path.resolve(root, cfg.output), health: { blockingCount: 0 }, skipped: true };
  }
  if (lock.stole) say('  Took over a stale build lock — a previous build did not finish.');
  try {
  const index = buildIndex(root, cfg, { withGit });
  const health = runHealth(index, cfg, root);
  if (withReport) say(formatReport(health, index, { verbose: !!flag('verbose'), color }), '\n');

  // The stamp is computed *before* the pages are rendered so each page can carry the value it was built
  // with. It used to be written afterwards, and the page had no idea when it was built — which is what made
  // a stale page indistinguishable from a current one. See the `data-built` note in dashboard.mjs.
  //
  // Watch shows a time of day, which is all you need when the rebuild happened seconds ago. A deployed site
  // is read hours or days after it was built, so `--stamp` writes the date too — a bare "14:03:22" on a
  // published page is a number with no year attached to it.
  const stamping = stamp || flag('watch');
  const now = new Date().toISOString();
  const stampValue = flag('watch') ? now.slice(11, 19) : now.replace('T', ' ').slice(0, 19) + ' UTC';
  if (stamping) cfg = { ...cfg, __stamp: stampValue };

  const { outDir, pages, truncated, plan, deck, collisions } = renderSite(index, health, cfg, root);
  if (stamping) writeBuildStamp(root, cfg, stampValue);

  /*
   * A-2 · derived output maintains itself. A-6 · the artifact is generated, never shared.
   *
   * The worklog and the standalone page are derived, and everything derived here is safe to delete — which
   * is exactly what makes it safe to regenerate without asking. They were produced only when someone
   * remembered to ask, so they were usually absent or stale; a derived file that is usually stale is worse
   * than one that does not exist, because it gets read.
   *
   * **Generating the artifact is not sharing it.** The file is written beside the site and goes nowhere: a
   * shared artifact is outward-facing, and outward-facing stays a thing a person asks for, every time.
   *
   * Failures are reported and swallowed. This runs after the build has already succeeded, and turning a
   * successful build into a failure because a secondary artefact could not be written would punish the
   * caller for the wrong thing.
   */
  if (autoDerived && automationAllows(cfg, 'buildOnWrite')) {
    try {
      const contrib = readContrib(root, cfg);
      const day = dayKey(Date.now());
      const identity = gitLines(root, ['config', 'user.name'])[0] || null;
      writeDay(root, cfg, renderDay({
        day, identity, contrib, health, plan: readPlanning(root, cfg), commits: commitsOn(contrib, day),
      }), day, identity);
    } catch (e) { say(`  worklog not refreshed: ${e.message}`); }

    try {
      const out = path.join(outDir, 'all.standalone.html');
      fs.writeFileSync(out, exportBundle(root, cfg, null, { generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }), 'utf8');
    } catch (e) { say(`  standalone page not refreshed: ${e.message}`); }
  }

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
  } finally {
    lock.release();
  }
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
  atlas prompt [--out FILE]  a system prompt assembled from this repository's own rules and state
  atlas handoff              the derived half of a handoff, as a prompt — writes nothing
  atlas note <kind> "<text>"  append one record to the journal — survives a killed session
  atlas state [--json]       what a resuming session reads first: where you are, what was recorded
  atlas contrib [--json]     who did what, from git history alone
  atlas health [--verbose]   report rot signals; exit 1 if any blocking signal fires
  atlas build                generate the static site (index, dashboard, deck, health)
  atlas watch [--serve]      rebuild on change; --serve hosts it live at http://127.0.0.1:4173
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
