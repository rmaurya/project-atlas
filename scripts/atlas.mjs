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
 *   atlas git-insights  hotspots, coupling, branch health, cadence, hygiene — read-only, mutates nothing
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
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_CLUSTERS, CONFIG_NAME , automationAllows } from './lib/config.mjs';
import { buildIndex, discover } from './lib/scan.mjs';
import { readPlanning, planCandidates, planSetupNotice } from './lib/planning.mjs';
import { runHealth, formatReport } from './lib/health.mjs';
import { readSessionParallelism } from './lib/parallelism.mjs';
import { renderSite, writeBuildStamp } from './lib/render.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { confine } from './lib/paths.mjs';
import { buildWikiPages, stageWiki, stagePages, exportSingleFile, exportBundle, gitlabPagesJob } from './lib/publish.mjs';
import { readContrib, formatContrib } from './lib/contrib.mjs';
import { detectHost, probeCapabilities, gateTarget, formatCapabilities } from './lib/host.mjs';
import { communityAssets, writeCommunity } from './lib/community.mjs';
import { branchStatus, createBranch, formatBranch, TYPES } from './lib/branch.mjs';
import { readContention, formatContention } from './lib/contention.mjs';
import { readTokens, formatTokens, formatSessions, transcriptDir, assertNotPublishable,
         readTokenEconomics, formatEconomics, writeTokenSnapshot } from './lib/tokens.mjs';
import { pauseSession, readParked, verifyParked, stopSession, WIP_PREFIX } from './lib/session.mjs';
import { readChanges, formatChanges, fileDiff } from './lib/changes.mjs';
import { readGitInsight, formatGitInsight, GITINSIGHT_SECTIONS, branchTree, formatBranchTree } from './lib/gitinsight.mjs';
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
import { serve as serveMcp, connectionStatus, formatConnection } from './lib/mcp.mjs';
import { runTask, formatTask, TASKS } from './lib/task.mjs';
import { designRecord } from './lib/design.mjs';
import { scaffold as scaffoldDesign } from './lib/scaffold.mjs';
import { acquire as acquireBuildLock, foreignBuildWarning } from './lib/lock.mjs';
import { renderLauncher, launcherProjects } from './lib/launcher.mjs';
import { productRootFor, readProduct, renderProduct, productPagePath, writeProductPage } from './lib/product.mjs';
import { num } from './lib/format.mjs';
import { startServer, spawnDetached, serverStatus, stopServer, writePid, clearPid, openInBrowser, portInUse, unmanagedServer,
         adoptableServer, portForRoot, readRegistry, registerServer, deregisterServer, DEFAULT_PORT, DEFAULT_IDLE_MS,
         surveyServers, discoverServers, reapOrphanServers, serverBuild } from './lib/serve.mjs';

const argv = process.argv.slice(2);

/**
 * Flags that consume the next argument when written with a space (`--target wiki`). Everything else is a
 * boolean, so a positional after a boolean flag stays positional — `atlas tasks --json safety` keeps `safety`
 * as the filter rather than swallowing it as `--json`'s value.
 */
const VALUE_FLAGS = new Set(['target', 'page', 'out', 'root', 'config', 'interval', 'refs', 'agent', 'since', 'day', 'why', 'port', 'idle-ms', 'item', 'only', 'query', 'base', 'serve-root', 'plan', 'product']);

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
 * The fourth argument to `runHealth`, and the only thing that makes H17 evaluate.
 *
 * **Every call site that shows a health report to somebody passes this. The commit gate deliberately does
 * not.** H17 was filed as shipped and never ran once: `readParallelism` worked, was tested, and no caller
 * supplied `opts.sessions`, so every report on every machine printed *"H17 — (not evaluated)"*. A signal that
 * cannot be reached from the command line is a signal that does not exist.
 *
 * It lives in one function rather than at eight call sites so the answer to "does this surface evaluate H17?"
 * is a grep for one name, and so the reason below is written once.
 *
 * **Why the gate is excluded.** `atlas health --gate` runs inside the pre-commit hook and reads exactly one
 * field, `blockingCount`. H17 can never block — `blockingFor` refuses it in code — so the gate would spend a
 * streaming pass over the whole local transcript store to compute a number it then discards, on every commit.
 * A guard that costs half a second per commit is a guard people turn off, and turning it off also turns off
 * the five blocking corpus signals that are the point of it. The gate makes no claim about H17 either way: it
 * prints only blocking findings, so nothing there reports it as clean.
 *
 * **It is free when there is nothing to read.** `readSessionParallelism` opens with `hasTranscripts()`, one
 * `statSync`, and returns unavailable-with-a-reason before it lists a file — so a fresh clone, a CI runner or
 * anyone who has never run a session pays a stat, and the reason they pay it with is what the report prints
 * under "Not checked".
 */
function healthOpts(root, cfg) {
  return { sessions: readSessionParallelism(root, cfg) };
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

  /*
   * `atlas product` — one page across sibling repositories. (A-61)
   *
   * **Placed above `resolveConfig` deliberately.** A product root is a directory that is *not* a repository
   * and has no config in it; resolving one there would either fail or silently hand back defaults for a
   * repository that does not exist. Every other command below this line is about one checkout. This one is
   * the only surface designed for standing in a directory that is not a checkout at all — which is exactly
   * where the hooks are inert, since every one of them opens with
   * `root=$(git rev-parse --show-toplevel) || exit 0`.
   */
  if (cmd === 'product') {
    const asked = typeof flag('product') === 'string' ? path.resolve(flag('product')) : root;
    const verdict = productRootFor(asked);
    if (!verdict.ok) {
      console.error(`Not a product root: ${verdict.reason}`);
      if (verdict.hint) console.error(`  ${verdict.hint}`);
      process.exitCode = 1;
      return;
    }

    // Ground truth for "is a dashboard up", the same source `--list` uses: the process table, not the
    // registry, which was once empty while two servers were answering (A-49).
    let runningRoots = [];
    try {
      runningRoots = surveyServers().servers.filter((s) => s.root && !s.orphan).map((s) => s.root);
    } catch { /* a survey is a nicety here; a page that cannot say "running" still says everything else */ }

    // The expensive half, and only when asked for by name. Each adopted member's whole corpus is indexed.
    const deepRunner = flag('deep')
      ? (dir, memberCfg) => {
          // `!flag('no-git')` rather than the `withGit` binding below: that `const` is declared after this
          // block, and this closure runs before it — a TDZ crash, not a fallback.
          const index = buildIndex(dir, memberCfg, { withGit: !flag('no-git') });
          const h = runHealth(index, memberCfg, dir);
          const active = h.findings.filter((f) => !f.suppressed);
          return { blocking: h.blockingCount, advisory: active.length - h.blockingCount, documents: index.documents.length };
        }
      : null;

    const model = readProduct(verdict.root, { deep: !!flag('deep'), running: runningRoots, deepRunner, members: verdict.members });

    if (flag('json')) { console.log(JSON.stringify(model, null, 2)); return; }

    const out = typeof flag('out') === 'string' ? path.resolve(flag('out')) : productPagePath(verdict.root);
    const written = writeProductPage(out, renderProduct(model), model);

    const c = paint(color);
    say(c.bold(`${model.name}`) + c.dim(`  ${model.root}`));
    say('');
    for (const m of model.members) {
      const state = m.state === 'adopted' ? c.green('adopted    ')
        : m.state === 'unadopted' ? c.yellow('not adopted')
        : c.red('unreadable ');
      // Three different sentences, because "no plan" hides three different facts and only one of them is a
      // problem: nothing configured, configured and gone, configured and read.
      const planWord = !m.plan ? 'no planning source configured'
        : m.plan.missing ? `plan ${m.plan.source || '(unnamed)'} — configured but not readable`
        : m.plan.items ? `plan ${num(m.plan.done)}/${num(m.plan.items)} · mean ${num(m.plan.mean)}%`
        : `plan ${m.plan.source} — parsed, no items`;
      const healthWord = m.health?.measured
        ? ` · health ${num(m.health.blocking)} blocking, ${num(m.health.advisory)} advisory over ${num(m.health.documents)} doc(s)`
        : m.health ? ` · health unmeasurable — ${m.health.reason}` : '';
      const tail = m.state === 'adopted' ? planWord + healthWord
        : m.state === 'unadopted' ? `${num(m.markdown)} markdown file(s) · atlas init would index them`
        : m.reason;
      say(`  ${state}  ${m.name.padEnd(28)} ${c.dim(tail)}`);
    }
    say('');
    say(`  ${num(model.counts.members)} member(s) · ${num(model.counts.adopted)} adopted · ${num(model.counts.unadopted)} not adopted · ${num(model.counts.unreadable)} unreadable`);
    if (model.unowned.length) {
      say(c.yellow(`  ${num(model.unowned.length)} product-level document(s) are committed to no repository:`) +
          ` ${model.unowned.map((d) => d.path).join(', ')}`);
    }
    say('');
    say(`  Page: ${written}`);
    say(c.dim('  Outside every repository, on purpose — nothing this command writes can be committed anywhere.'));
    if (!flag('deep')) say(c.dim('  Health was not measured. --deep indexes every adopted member and costs real time.'));
    if (flag('open')) openInBrowser(`file://${written}`);
    return;
  }

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
    if (!plan) {
      // The same advice the build prints, from the same function — a remedy that is right in one place and
      // stale in the other is how the reader learns to stop believing either.
      const advice = planSetupNotice(discover(root, cfg), cfg);
      console.error(['No planning source configured. Set planning.source in project-atlas.config.json.',
                     ...advice.sentences.slice(1).map((s) => `  ${s.replace(/`/g, '')}`)].join('\n'));
      process.exitCode = 1;
      return;
    }
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

  // A-48 · the other side of C-11. Run it before the fan-out, not during the merge.
  if (cmd === 'contention') {
    const named = positionals.filter(Boolean);
    const c = readContention(root, cfg, {
      base: typeof flag('base') === 'string' ? flag('base') : null,
      branches: named.length ? named : null,
    });
    if (flag('json')) { console.log(JSON.stringify(c, null, 2)); return; }
    say(formatContention(c, color));
    // Exit 1 on a duplicate plan-item id and on nothing else. A shared file is frequently correct and is
    // reported, never refused; two branches introducing the same id is a defect with no legitimate cause,
    // which is the same line `blocking` draws in the health report. That makes this usable in CI without
    // making it a tool that decides how somebody splits their work.
    if (c.available && c.ids.duplicates?.length) process.exitCode = 1;
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
    const health = runHealth(index, cfg, root, healthOpts(root, cfg));
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
  /*
   * `atlas design --scaffold` — write the questions, never the answers.
   *
   * The Architecture page reported eight artifacts absent and offered no way to close the gap. Generating
   * the documents is the one thing this tool must not do: a design document is a set of claims about what
   * the code is *for* and what was rejected, and generated claims nobody reviewed would land in the very
   * corpus every other check measures drift against.
   *
   * What is actually hard is knowing which questions each document owes an answer to. That is a template.
   */
  if (cmd === 'design') {
    const index = buildIndex(root, cfg, { withGit });
    const record = designRecord(index.documents);

    if (!flag('scaffold')) {
      say('');
      for (const r of record) {
        const mark = r.state === 'written' ? '✓' : r.state === 'stub' ? '~' : '·';
        say(`  ${mark} ${r.label.padEnd(24)} ${r.state.padEnd(8)} ${r.documents.slice(0, 2).join(', ')}`);
      }
      say('');
      say('  ✓ written   ~ scaffolded, substance still owed   · absent');
      say('  `atlas design --scaffold` writes the questions for whatever is absent. It never writes answers.');
      say('');
      return;
    }

    const kinds = typeof flag('only') === 'string' ? flag('only').split(',').map((k) => k.trim()) : null;
    const r = scaffoldDesign(root, record, { kinds });
    if (!r.written.length) {
      say('Nothing scaffolded — every expected artifact already exists in some form.');
      for (const s of r.skipped) say(`  ${s.id}: ${s.why}`);
      return;
    }
    say('');
    for (const w of r.written) say(`  wrote ${w.file}`);
    say('');
    say('  Each is a **stub**: the questions are written down, the answers are not, and the design record');
    say('  reports them as stubs rather than as documents. Delete the marker line when the substance is');
    say('  there — nothing removes it for you, because nothing else can know that it is.');
    say('');
    return;
  }

  /*
   * `atlas ask <task>` — one structured answer with a meaningful exit code, for a caller that is a program.
   *
   * This is M-2's honest scope: CI, a hook or an editor plugin wants "is the documentation sound, and what
   * is wrong" without a terminal and without parsing output written for a person. It does not drive a
   * session — see task.mjs for why that belongs to the Agent SDK rather than here.
   */
  /*
   * **Two features collided on this one command name, and the older one lost silently.**
   *
   * `/atlas:ask` shipped first: a person types a question, and the skill runs `atlas ask $ARGUMENTS` to get
   * the documents worth reading. Its handler is still further down this file, and its comment explains that
   * it was moved out of a shell block precisely so the skill would run at all. Then M-2 added
   * `atlas ask <task>` — structured JSON for a program — on the same name, and returned unconditionally.
   *
   * From that release, every question a human asked was rejected as an unknown task and the handler written
   * for them became unreachable code. Nothing failed loudly; the skill simply stopped working, and the
   * feature that replaced it looked fine because *its* form still worked.
   *
   * So the argument decides, and the test is exact rather than heuristic: a known task name is the program's
   * call, anything else is a person's question. A task list is a closed set this file already owns, which is
   * what makes that safe — no guessing at intent from shape or word count.
   */
  if (cmd === 'ask' && positionals.length && !TASKS.includes(positionals[0])) {
    // Fall through to the document search below. Written as an early skip rather than by reordering the
    // handlers, so the structured path stays first and stays the one a reader finds when following M-2.
  } else if (cmd === 'ask') {
    const task = positionals[0];
    if (!task) {
      say('');
      say('  atlas ask <task> [--json]        one structured answer, for software rather than a terminal');
      say('  atlas ask <question>             the documents worth reading, for a person');
      say('');
      for (const t of TASKS) say(`    ${t}`);
      say('');
      say('  Exit 0 answered and clean · 1 answered and something blocking · 2 could not answer.');
      say('  The 1/2 split is the point: a build should fail on findings, not on a tool that could not run.');
      say('');
      /*
       * **Exit 2 when something was passed and it was empty; exit 0 when nothing was passed at all (A-65).**
       *
       * The 2 exists for a real failure: a pipeline running `atlas ask "$TASK"` with an unset variable was
       * told the documentation was sound when nothing had been asked — the exact 1-versus-2 confusion the
       * two lines above warn about. That must keep failing.
       *
       * But it also fired for `/atlas:ask` typed with nothing after it, and there the 2 was the whole bug.
       * Claude Code runs a skill's `!` block as a shell command and reports a non-zero exit as an error, so
       * the skill died before the model read one word of it — the reader got a stack of usage text under the
       * word `Error` instead of being asked what they wanted to know. Prose in the skill cannot fix that; the
       * prose is never reached. `|| true` cannot either: a case in this suite forbids operators in those
       * blocks, because Claude Code refuses to auto-approve a compound command and the skill would prompt on
       * every run.
       *
       * The shell already draws the line, and draws it exactly where it is needed. `atlas ask "$TASK"` with
       * an empty variable passes one empty argument — `['']`. `atlas ask` with nothing, which is what
       * `atlas ask $ARGUMENTS` expands to when a person typed no question, passes none — `[]`. One is a
       * caller that meant to ask something and lost it; the other is a person reading the menu.
       */
      if (positionals.length) process.exitCode = 2;
      return;
    }
    const args = {};
    if (flag('open')) args.open = true;
    if (typeof flag('query') === 'string') args.query = flag('query');
    const r = runTask(root, task, args);
    console.log(formatTask(r));
    process.exitCode = r.exitCode;
    return;
  }

  /*
   * `atlas mcp` — the same derived data, as structure rather than terminal output.
   *
   * Read-only by construction: see mcp.mjs. Nothing is printed to stdout but protocol messages, so the
   * usual `say()` is deliberately absent from the serving path below.
   *
   * `--status` is the one thing this command may print, and it exists because the serving path is silent by
   * design: run by hand, `atlas mcp` prints nothing and waits for a client that is never coming, which
   * looks exactly like a hang. It answers the questions the silence leaves open — what is exposed, which
   * protocol revision, whether any client here has been told this server exists, and what is running.
   */
  if (cmd === 'mcp') {
    if (flag('status')) {
      const running = runningBuild();
      const st = connectionStatus({ root, version: running.version, pluginRoot: running.pluginRoot });
      if (flag('json')) { console.log(JSON.stringify(st, null, 2)); return; }
      say(formatConnection(st, color));
      return;
    }
    serveMcp({ root, version: runningBuild().version });
    return;
  }

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
      /*
       * **This is where the empty variable actually lands, and it was exiting 0 (A-65).**
       *
       * The guard written for it sits in the structured branch above, and `atlas ask ""` never reaches that
       * branch: one empty positional is not a known task name, so it falls through to here — the human
       * search path — and returned "answered and clean" for a question nobody asked. The comment describing
       * the danger and the code creating it were forty lines apart in the same file.
       *
       * The distinction is the same one drawn above and it is the shell's, not a guess. Arguments present
       * but empty is a caller that meant to ask something and lost it: exit 2. No arguments at all — which
       * is what `atlas ask $ARGUMENTS` expands to when a person typed no question — is somebody reading the
       * menu: exit 0, because Claude Code renders a non-zero exit from a skill's `!` block as an error and
       * that error is all the reader would see.
       */
      if (positionals.length) process.exitCode = 2;
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
      health: runHealth(index, cfg, root, healthOpts(root, cfg)),
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

    // C-10. The attribution layer is a second pass over the same store, answering the joins the totals above
    // cannot: what a task cost, what kind of work it was, what ran in a subagent. The totals report is
    // unchanged — this is printed after it, never instead of it.
    const econ = readTokenEconomics(root, cfg);

    if (flag('json')) { console.log(JSON.stringify({ ...k, economics: econ }, null, 2)); return; }

    const render = (useColor) => formatTokens(k, useColor) + '\n\n' + formatEconomics(econ, useColor);
    if (out) {
      fs.writeFileSync(path.resolve(root, out), render(false) + '\n', 'utf8');
      say(`Wrote ${out}`);
    } else {
      say(render(color));
    }

    // Never implicit, never on a build: only this flag, and only with `tokens.snapshot` set.
    if (flag('snapshot')) {
      const snap = writeTokenSnapshot(root, cfg, econ);
      say('');
      if (!snap.written) say(`Snapshot not written — ${snap.reason}`);
      else if (!snap.appended) say(`Snapshot up to date — ${snap.file} already records all ${snap.days} day(s).`);
      else say(`Snapshot: appended ${snap.appended} day(s) to ${snap.file}` +
        (snap.unchanged ? `, ${snap.unchanged} already recorded unchanged.` : '.'));
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
    const health = runHealth(index, cfg, root, healthOpts(root, cfg));
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

  /*
   * `atlas git-insights [section]` — the questions about history that `contrib`, `changes` and `branch`
   * between them do not answer.
   *
   * **Read-only, and deliberately safe to run blind.** Nothing under this command fetches, checks out, prunes,
   * deletes or writes a config value, and the branch report does not even print a `git branch -d` for someone
   * to paste — see gitinsight.mjs. These are the commands an agent runs without asking, so the boundary is
   * enforced by what the module can do rather than by a warning nobody reads.
   *
   * One section at a time, as a positional rather than a flag, because that is what the slash commands want:
   * Claude Code refuses to auto-approve a compound command, so every `!` block is a single invocation and each
   * skill needs exactly one section rendered whole rather than a full report it has to filter.
   *
   * The index is built once and passed in, which is what makes the corpus cross-reference — a busy file no
   * document cites — possible at all. `--no-index` skips it for a repository with no config or a caller who
   * wants git and nothing else, and the report says the cross-reference was not run rather than reporting
   * every file as undocumented.
   */
  if (cmd === 'git-insights' || cmd === 'git-insight') {
    const section = positionals[0] || 'all';
    if (section !== 'all' && !GITINSIGHT_SECTIONS.includes(section)) {
      console.error(`Unknown section "${section}". Use one of: ${GITINSIGHT_SECTIONS.join(', ')} — or none for all of them.`);
      process.exitCode = 2;
      return;
    }
    // `hotspots` and `change` are the only sections that read the corpus; the rest are pure git, and building
    // an index for `atlas git-insights cadence` would be seconds of work thrown away.
    const wantsIndex = !flag('no-index') && (section === 'all' || section === 'hotspots' || section === 'change');
    const index = wantsIndex ? buildIndex(root, cfg, { withGit }) : null;
    const k = readGitInsight(root, cfg, {
      contrib: readContrib(root, cfg),
      index,
      plan: readPlanning(root, cfg),
      section,
    });
    if (flag('json')) { console.log(JSON.stringify(k, null, 2)); return; }
    say(formatGitInsight(k, color));
    // Exit 1 only when there was nothing to read. Findings here are observations, not defects — a repository
    // with forty hotspots is not failing a check, and making this gate a build would teach people to skip it.
    if (!k.available) process.exitCode = 1;
    return;
  }

  /*
   * `atlas git-tree` — the same refs as `git-insights branches`, drawn as a shape instead of a table (A-56).
   *
   * A separate command rather than a seventh section, because it answers a different question with the same
   * facts: the table says how far ahead each branch is, one independent row at a time, and the tree says how
   * they relate. It reuses `branchHealth` wholesale — nothing here re-derives a branch figure, which is the
   * defect the tool exists to detect and would be the loudest possible one to ship inside it.
   *
   * **Read-only, like every other `git-*` command**, down to printing no `git branch -d` for anyone to paste.
   * Exit 1 only when the refs could not be read at all: a repository whose topology is one branch is not
   * failing a check.
   */
  if (cmd === 'git-tree') {
    const k = branchTree(root, cfg);
    if (flag('json')) {
      // The tree is cyclic-free but node objects nest, and `ancestry.of` is a Map — flattened here rather than
      // in the builder, so the terminal path never pays for a shape only a program wants.
      console.log(JSON.stringify(k, (key, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
      return;
    }
    say(formatBranchTree(k, color));
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
    // **No `healthOpts` here, and that is the one deliberate omission.** This path reads `blockingCount` and
    // nothing else; H17 can never block, so supplying the aggregate would buy a streaming pass over the local
    // transcript store on every commit in exchange for a number this block never prints. See `healthOpts`.
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
    const health = runHealth(index, cfg, root, healthOpts(root, cfg));
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
    const health = runHealth(index, cfg, root, healthOpts(root, cfg));
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
  /*
   * `atlas pause` / `atlas resume` / `atlas stop` — the state of the *work*, not of the documents. (A-32)
   *
   * Everything else here derives from files that are still on disk when you come back. These three exist for
   * the thing that is not: an agent that was mid-task when the session ended. The first time that happened,
   * three of them were, and 92K of uncommitted work survived only because somebody went and looked.
   */
  if (cmd === 'pause' || cmd === 'resume' || cmd === 'stop') {
    const c = paint(color);
    if (cmd === 'pause') {
      const r = pauseSession(root, {
        storeDir: transcriptDir(root, cfg),
        dryRun: !!flag('dry-run'),
        label: typeof flag('label') === 'string' ? flag('label') : null,
      });
      if (!r.available) { console.error(r.reason); process.exitCode = 1; return; }
      if (flag('json')) { console.log(JSON.stringify(r, null, 2)); return; }
      say(formatPause(r, c));
      return;
    }

    if (cmd === 'resume') {
      const p = readParked(root);
      if (!p.available) {
        say(p.reason);
        // Not an error: "nothing is parked" is the normal state of a repository nobody paused.
        return;
      }
      const agents = verifyParked(root, p);
      if (flag('json')) { console.log(JSON.stringify({ ...p, agents }, null, 2)); return; }
      say(formatResume({ ...p, agents }, c));
      return;
    }

    // `stop`
    const r = stopSession(root, { force: !!flag('force'), dryRun: !!flag('dry-run') });
    /*
     * **A second pass, after the targeted one.** (A-49)
     *
     * `stopSession` stops the server of every worktree *it* removed. That closes the source of the leak but
     * not the backlog: the four orphans on this machine were made by earlier runs of `stop`, from a build
     * that never stopped anything, and no amount of correctness from here forward reaches them.
     *
     * So the teardown command also sweeps. It is the right place for the general reap alongside `serve` —
     * `stop` is the command whose entire purpose is to leave nothing behind, and a dashboard still answering
     * for a directory this command deleted is the most literal possible failure of that promise.
     */
    const reaped = reapOrphanServers({ dryRun: !!flag('dry-run') });
    if (flag('json')) { console.log(JSON.stringify({ ...r, reaped }, null, 2)); return; }
    say(formatStop(r, c));
    const sweptStop = formatReap(reaped, c);
    if (sweptStop) say(sweptStop);
    if (r.kept.length && !r.forced) process.exitCode = 1;
    return;
  }

  if (cmd === 'serve') {
    const c = paint(color);
    const st = serverStatus(root);

    if (flag('stop')) {
      const r = stopServer(root);
      deregisterServer(root);
      say(r.stopped ? `Stopped the server on port ${r.port} (pid ${r.pid}).` : `Nothing to stop — ${r.reason}.`);
      const sweptHere = formatReap(reapOrphanServers(), c);
      if (sweptHere) say(sweptHere);
      return;
    }

    // With several projects open the question stops being "is it running" and becomes "which one am I
    // looking at". This answers that across every repository on the machine, not just this one.
    // A generated launcher, because a hand-written link to one project is wrong the moment you switch —
    // and silently wrong, since it opens a real dashboard belonging to something else.
    if (flag('launcher')) {
      // Built from the reconciled survey rather than the registry: a launcher page is a set of links
      // somebody will click, and a link to a server that is not running — or to a root that has been
      // deleted — is the same wrong-dashboard failure in a nicer typeface.
      const surveyed = surveyServers();
      const usable = surveyed.servers.filter((s) => s.root && !s.orphan && (s.confirmed || !surveyed.scanned));
      const projects = launcherProjects(usable, { root, port: portForRoot(root) });
      const html = renderLauncher(projects, {
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
        pages: cfg.publish?.pages?.url || null,
      });
      const out = typeof flag('out') === 'string' ? path.resolve(flag('out')) : path.join(root, '.atlas', 'dashboards.html');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, html, 'utf8');
      say(`Wrote ${path.relative(root, out)} — ${projects.length} project(s).`);
      return;
    }

    /*
     * **`--list` reports. It never signals.** (A-49)
     *
     * This is the command an operator runs *because* they suspect something is wrong, and a diagnostic that
     * quietly fixes what it finds destroys the evidence of the thing they came to look at. The leak in the
     * incident went unnoticed twice; a listing that had silently reaped it would have made three.
     *
     * So orphans are named here, loudly, with the commands that end them — and `atlas serve` and
     * `atlas stop`, which the operator ran to *change* something, are where the change happens.
     */
    if (flag('list')) {
      const s = surveyServers();
      const here = path.resolve(root);
      if (!s.servers.length) {
        say(s.scanned
          ? 'No atlas dashboards are running on this machine.'
          : 'The registry lists no atlas dashboards — and this machine’s process table could not be read, so '
            + 'that is not the same as none running. `lsof -nP -iTCP -sTCP:LISTEN` is the check that does not depend on it.');
        return;
      }
      say('');
      for (const e of s.servers) {
        const name = e.name || (e.rootUnknown ? '(root unknown)' : path.basename(e.root || ''));
        const note = e.orphan ? c.red('  <- root deleted; orphan')
          : e.stale ? c.yellow('  <- in the registry, but no such process is running')
            : e.rootUnknown ? c.yellow('  <- running, but what it serves could not be established')
              : e.root === here ? '  <- this repository'
                : !e.registered ? c.dim('  <- running, not in the registry') : '';
        say(`  ${String(e.port ?? '?').padEnd(6)} ${String(name).padEnd(24)} ${e.url || ''}${note}`);
      }
      say('');
      if (!s.scanned) {
        say(c.yellow('  Read from the registry alone — `ps` could not be run, so nothing here is confirmed'));
        say(c.yellow('  against the machine, and a server missing from the registry would be missing here too.'));
      } else {
        say(`  ${num(s.servers.length)} found by reading this machine’s process table, not only the registry.`);
      }
      if (s.orphans.length) {
        say('');
        say(c.red(`  ${num(s.orphans.length)} serving a directory that no longer exists.`)
            + ' They can never be useful again.');
        say('  `atlas serve` and `atlas stop` end them; nothing is signalled by a listing.');
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

    /*
     * **Reap before anything else on the start path.** (A-49)
     *
     * `serve` is the command that runs at the top of a session, and it is the one place where a dead-root
     * orphan does active harm rather than merely wasting a port: it may be squatting the port this
     * repository is about to probe upward into, and its dashboard answers with somebody else's branch and
     * somebody else's file count.
     *
     * Reaping on allocation is the same bargain a garbage collector makes — it is frequent, it is bounded,
     * and it happens at the moment the litter starts to cost something. And unlike `--list`, this command
     * was invoked to change the state of the machine, so changing it is not a surprise.
     */
    const swept = formatReap(reapOrphanServers(), c);
    if (swept) say(swept);

    if (st.running) {
      /*
       * **A running process cannot be upgraded, and this branch is the one that pretended otherwise (A-63).**
       *
       * Everything below this point is the idempotent path: something is listening, so open it and return.
       * That is right when the server is *this* build. It is wrong — and was silently wrong for three
       * releases — when the server predates an update. `/atlas:dashboard` reported the URL, the page loaded,
       * and it was served by code that had never heard of the change the reader was looking for. A chart
       * change, a footer change and an entire new view were each concluded "not shipped" on that evidence.
       *
       * So a stale build is replaced rather than adopted. Not reloaded: there is no mechanism to swap the
       * code under a live process, and a `serve` that claims to be current while it is not is precisely the
       * defect. `same === null` means the process could not be read, and an unreadable process is left alone
       * — restarting on "cannot tell" would kill and respawn a healthy server on every single invocation.
       */
      const build = serverBuild(st.pid, { startedAt: st.startedAt });
      if (build.same === false) {
        say(`The server on ${st.url} (pid ${st.pid}) is running ${build.why}:`);
        say(`  it is    ${build.script}`);
        say(`  this is  ${build.mine}`);
        say('A running process cannot be upgraded, so it is being replaced. Restarting…');
        stopServer(root);
        deregisterServer(root);
        await new Promise((r) => setTimeout(r, 300));
        st.running = false;
      }
    }

    if (st.running) {
      /*
       * **Rebuild before opening, because "the dashboard" is the pages and not the process (A-64).**
       *
       * This branch used to open the browser and return. The server it hands you is a `watch --serve` loop,
       * which rebuilds when a *watched source file* changes — and nothing else. So every reason a page can
       * be out of date without the corpus moving left it out of date: a new plugin version, a config edit,
       * a plan document that was only just pointed at, a commit that changed what the git panels read. The
       * command a person runs when the page looks wrong did the one thing that could not fix it.
       *
       * A full `build`, spawned rather than inlined, because a partial rebuild is worse than none: the build
       * writes the site, the worklog, the knowledge graph and the stamp together, and half of that set on
       * disk breaks the byte-identical guarantee the whole design rests on. Spawning the same script this
       * process is running gets exactly the build any other caller would get.
       */
      const rebuilt = spawnSync(process.execPath, [process.argv[1], 'build', '--quiet', '--root', path.resolve(root)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (rebuilt.status === 0) {
        say('Rebuilt the site before opening it — a running server only watches sources, so a change in');
        say('  anything else (a new version, the config, the plan it points at) would not have reached it.');
      } else {
        say('The site could not be rebuilt, so what opens is whatever was last written:');
        for (const line of String(rebuilt.stderr || rebuilt.stdout || '').split('\n').filter(Boolean).slice(0, 3)) {
          say(`  ${line}`);
        }
      }
      say(`Already running on ${st.url} (pid ${st.pid}).`);
      // **Re-assert the record on the idempotent path, or the registry never heals.** Registration used to
      // happen on exactly one branch — the cold start at the bottom of this block. Every "already running"
      // return above it left the registry however it was, so a single lost entry stayed lost for as long as
      // the server lived, and `--list` went on reporting an empty machine to the end of the session.
      registerServer({
        root: path.resolve(root), name: path.basename(path.resolve(root)),
        port: st.port, url: st.url, pid: st.pid,
      });
      if (!flag('no-open')) openInBrowser(st.url);
      return;
    }

    /*
     * **The pidfile is not the only record, and treating it as one produced orphans.**
     *
     * A pidfile can be lost while its server is perfectly alive — overwritten by a second start that raced
     * it, cleared by a stale-pid check that misfired, removed by hand. The old code read "no pidfile" as
     * "nothing is running", started a second server, found the derived port taken, probed one port upward,
     * and bound there. Now two servers answer for one repository, only the newer is named anywhere, and the
     * link printed at the top of the session points at the older one — which keeps answering, so nothing
     * ever looks broken. That is exactly how a session was spent reading a dashboard nobody was updating.
     *
     * The machine-wide registry is the second record, and it is keyed by live pid rather than by a file
     * this repository might have lost. If it names a server for this root and that port answers, the right
     * move is to adopt it and restore the claim — not to stand up a rival.
     */
    const known = readRegistry().find((e) => path.resolve(e.root || '') === path.resolve(root));
    if (known && await portInUse(known.port)) {
      writePid(root, { pid: known.pid, port: known.port });
      say(`Already running on ${known.url} (pid ${known.pid}) — its pidfile had gone missing, and is restored.`);
      if (!flag('no-open')) openInBrowser(known.url);
      return;
    }

    /*
     * **Both records are keyed by pid, so one event destroys both.**
     *
     * The registry above prunes any entry whose pid is dead, exactly as the pidfile clears a dead claim.
     * That is right when a server has genuinely gone, and catastrophic when several raced: the pid written
     * down can be the *loser's*, so reaping it discards the only record of the winner — which is still
     * listening, still answering, and now invisible to every check this tool makes. The next start finds no
     * record, sees its derived port taken, probes one port upward and binds there. Repeat, and a machine
     * accumulates a server per race with the user's open tab pointing at whichever one lost.
     *
     * Measured, not theorised: four repositories on this developer's machine reached that state in one
     * afternoon, one of them running four processes against a single port.
     *
     * So the last question before starting anything is not "who is running" but "what is being served".
     * `adoptableServer` fetches the build stamp off whatever holds the port and compares it to the one on
     * our own disk — identity by content, which survives every way a pid-keyed record can be lost. A
     * stranger fails that comparison and is left alone, because adopting one would hand the user somebody
     * else's web page and call it their dashboard.
     */
    const outDirForAdopt = confine(root, cfg.output, 'output', cfg.__configPath);
    const basePort = typeof flag('port') === 'string' ? Number(flag('port')) : portForRoot(root);
    const adopted = await adoptableServer(root, outDirForAdopt, basePort);
    if (adopted) {
      // **No pid is invented to fill the gap.** The record cannot be restored, because the one thing that
      // was lost is the number every record is keyed by, and there is no way to learn it from an HTTP
      // response. Writing a placeholder would be worse than the hole: `serverStatus` verifies a claim with
      // `process.kill(pid, 0)`, and pid 0 means *the whole process group* to POSIX — so a fabricated claim
      // would answer "alive" forever and `--stop` would aim a signal at everything this shell owns.
      //
      // Refusing to start a rival was the entire point. The record stays missing and is described as
      // missing; the next start runs this same cheap check and reaches the same correct answer.
      say(`Already running on ${adopted.url}, serving the build stamped ${adopted.stamp}.`);
      say(`  Recognised by what it serves, not by a pidfile — that record and its registry entry were both`);
      say(`  lost, which is how a second server used to get started one port higher. Not starting one.`);

      /*
       * **The pid is now recoverable, so the hole above closes.** (A-49)
       *
       * The comment on this branch used to end at "no pid is invented to fill the gap", and it was right to:
       * `serverStatus` verifies a claim with `process.kill(pid, 0)`, and pid 0 means the whole process group
       * to POSIX, so a fabricated claim would answer "alive" forever and `--stop` would aim a signal at
       * everything this shell owns.
       *
       * Nothing is invented here. The pid is *observed* — read out of the machine's own process table, off a
       * command line this tool wrote, naming this root and this port. That is the same evidence the reaper
       * requires before it signals anything, which is exactly the standard a restored record should meet.
       */
      const seen = (discoverServers() || []).find(
        (x) => x.root === path.resolve(root) && (!x.port || x.port === adopted.port));
      if (seen) {
        writePid(root, { pid: seen.pid, port: adopted.port });
        registerServer({
          root: path.resolve(root), name: path.basename(path.resolve(root)),
          port: adopted.port, url: adopted.url, pid: seen.pid,
        });
        say(`  Its pid is ${seen.pid}, read from this machine’s process table; both records are restored.`);
      } else {
        say(`  \`lsof -nP -iTCP:${adopted.port} -sTCP:LISTEN\` names the process if you want to restart it cleanly.`);
      }
      if (!flag('no-open')) openInBrowser(adopted.url);
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

    /*
     * The child writes the pidfile once it is actually listening; wait for that rather than announce a URL
     * that may not answer. A port that is taken makes the child exit, and this reports that instead of
     * printing a link to nothing.
     *
     * **Twenty seconds, not two.** (A-49) The old window was 40 × 50ms, and the child runs a full build
     * before it binds — four and a half seconds on this repository, more on a larger corpus. So the common
     * case was the *timeout*: this printed "started, but it is not listening", returned, and the child bound
     * the port a moment later. The sentence was false, and because the timeout returned before the
     * registration below, every server started this way was invisible to `--list` for its entire life.
     *
     * The child now registers itself the instant it binds, so a timeout here no longer loses the record —
     * but a command that habitually reports failure on success trains people to ignore it, and that is worth
     * fixing on its own.
     */
    const url = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await new Promise((r) => setTimeout(r, 250));
      up = serverStatus(root).running;
    }
    if (!up) {
      say(`Started pid ${pid}, but it is still not listening on ${port} after 20 seconds.`);
      say(`  Either something else holds that port, or the build it runs first has not finished.`);
      say(`  \`atlas serve --status\` says which; \`atlas watch --serve\` surfaces the error itself.`);
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
        outDir, root, port, idleMs,
        // The pidfile is deliberately NOT cleared here: the port is held by someone, and on the common path
        // that someone is this repository's own healthy server. Clearing its claim on the way out would
        // leave a running server nothing can find or stop — a worse state than the one being reported.
        onError: () => process.exit(1),
        onIdle: () => { clearPid(root); deregisterServer(root); process.exit(0); },
        onListen: (p) => {
          if (flag('detached')) {
            writePid(root, { pid: process.pid, port: p });
            /*
             * **The server registers itself, because the process that spawned it could not.** (A-49)
             *
             * Registration used to happen in the parent, after the parent had waited for a pidfile to
             * appear — and the wait was two seconds while this child runs a *full build* before it binds.
             * On this repository that build takes four and a half. So the parent timed out, printed
             * "started, but it is not listening", and returned without registering; a moment later the child
             * bound the port and served happily, unregistered, for the rest of the day. That is precisely
             * how `--list` came to report an empty machine with two dashboards answering on it.
             *
             * Here there is no window to lose: this is the process, this is its pid, and it is listening.
             */
            registerServer({
              root: path.resolve(root), name: path.basename(path.resolve(root)),
              port: p, url: `http://127.0.0.1:${p}/`, pid: process.pid,
            });
          }
          say(`\n  Serving ${path.relative(root, outDir)} at http://127.0.0.1:${p}/  (loopback only)`);
          say('  This page IS live: it polls the build stamp and patches itself when a rebuild lands.');
          if (!flag('no-open') && !flag('detached')) openInBrowser(`http://127.0.0.1:${p}/`);
        },
      });
      // A detached server that is killed must not leave its claim behind: a stale pidfile stops the next
      // start, which is a worse failure than no server at all. The registry entry goes the same way, and
      // this handler is why the reaper sends SIGTERM rather than SIGKILL — a killed server cleans nothing.
      for (const sig of ['SIGTERM', 'SIGINT']) {
        process.on(sig, () => { clearPid(root); deregisterServer(root); process.exit(0); });
      }
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

/**
 * The ANSI palette, in one place.
 *
 * `formatTasks` grew its own copy first; `pause`/`resume`/`stop` would have made three. The `Proxy` is what
 * lets every call site write `c.dim(x)` unconditionally — a `--no-color` run returns the string untouched
 * rather than making each formatter branch.
 */
function paint(useColor) {
  return useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, blue: (s) => `\x1b[34m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });
}

/**
 * What the reaper did, and what it deliberately would not do. Empty string when there was nothing. (A-49)
 *
 * **This output is the point of the feature, not a footnote to it.** Two server leaks happened in one
 * session and neither was noticed until a human ran `lsof` by hand, so a reaper that cleaned up quietly
 * would have fixed the ports and preserved the actual defect: nobody finds out. Every skip is printed with
 * its reason for the same reason — a candidate that was spared is the one case where the operator's judgement
 * beats this code's, and they cannot exercise it if they never hear about it.
 *
 * An unreadable process table prints nothing at all. It is not news on a healthy machine, and a warning
 * emitted on every single command is a warning nobody reads by the end of the first day.
 */
function formatReap(r, c) {
  if (!r || !r.scanned) return '';
  if (!r.reaped.length && !r.skipped.length) return '';
  const L = [''];
  if (r.reaped.length) {
    L.push(c.bold(r.dryRun
      ? `${num(r.reaped.length)} orphaned dashboard server(s) would be stopped:`
      : `Stopped ${num(r.reaped.length)} orphaned dashboard server(s) — each was serving a deleted directory:`));
    for (const s of r.reaped) {
      L.push(`  ${c.red('reaped')}  pid ${String(s.pid).padEnd(7)} port ${String(s.port ?? '?').padEnd(6)} `
             + c.dim(s.root || '(root unknown)'));
    }
  }
  for (const s of r.skipped) {
    L.push(`  ${c.yellow('left')}    pid ${String(s.pid).padEnd(7)} port ${String(s.port ?? '?').padEnd(6)} `
           + c.dim(s.reason || 'not confirmed as an atlas server'));
  }
  L.push('');
  return L.join('\n');
}

/** What `atlas pause` parked, and the one thing it could not park. */
function formatPause(r, c) {
  const L = [];
  const agents = r.agents.filter((a) => !a.isMain);
  const parked = agents.filter((a) => a.wipRef);
  L.push('');
  L.push(r.dryRun
    ? c.bold('Dry run — nothing was written.')
    : `${c.bold('Parked')} at ${r.at}${r.label ? ` — ${r.label}` : ''}`);
  L.push('');
  if (!agents.length) {
    L.push('  No agent worktrees. Nothing was in flight to park.');
    L.push('');
    L.push(c.dim('  Your own uncommitted changes are left alone — pause parks agents, not your edits.'));
    return L.join('\n');
  }
  for (const a of agents) {
    const head = `  ${c.bold(a.id)}  ${a.label ? a.label : c.dim('(no label in the transcript)')}`;
    L.push(head);
    L.push(`     branch   ${a.branch || c.dim('(detached)')}`);
    if (a.wipRef) {
      // In a rehearsal nothing has been committed yet, so the honest figure is what *would* be — the dirty
      // count. Printing `committed` there reads as "0 files", which is the opposite of what is about to happen.
      L.push(r.dryRun
        ? `     would    checkpoint ${a.dirty} file(s) to ${c.green(a.wipRef)}`
        : `     parked   ${c.green(a.wipRef)}  ${a.committed} file(s) checkpointed`);
    } else {
      L.push(`     parked   ${c.dim(a.note || 'nothing to park')}`);
    }
    if (a.commitsAhead) L.push(`     ahead    ${a.commitsAhead} commit(s) not on main`);
    L.push('');
  }
  L.push(`  ${c.bold(String(parked.length))} of ${agents.length} worktree(s) had work to checkpoint.`);
  L.push('');
  L.push(c.dim('  These are checkpoints, not finished changes — squash or amend before they land.'));
  L.push(c.dim('  `atlas resume` reads this back. `atlas stop` clears it and keeps every branch.'));
  return L.join('\n');
}

/**
 * The re-spawn plan.
 *
 * States what cannot be restored **first**, before listing anything, because the whole risk of this command
 * is that it reads like the agents are still alive.
 */
function formatResume(p, c) {
  const L = [];
  const agents = p.agents || [];
  L.push('');
  L.push(`${c.bold(`${agents.filter((a) => !a.isMain).length} agent(s) parked`)} at ${p.at}${p.label ? ` — ${p.label}` : ''}`);
  L.push('');
  L.push(c.yellow('  Their context is gone.') + ' A subagent\'s reasoning lives in the process that ran it.');
  L.push('  What follows is the work, not the agents: branch, worktree, and what each had reached.');
  L.push('  Re-spawn from these briefs — that is a fresh agent picking up a real tree, not a continuation.');
  L.push('');
  let n = 0;
  for (const a of agents) {
    if (a.isMain) continue;
    n += 1;
    L.push(`  ${c.bold(`[${n}]`)} ${a.label || a.id}`);
    L.push(`      branch     ${a.branch || c.dim('(detached)')}`);
    L.push(`      worktree   ${a.worktreePresent ? a.dir : c.red(`${a.dir}  — GONE`)}`);
    if (a.wipRef) {
      L.push(`      checkpoint ${a.wipRefPresent ? c.green(a.wipRef) : c.red(`${a.wipRef} — ref missing`)}` +
        `  ${a.committed} file(s)`);
    }
    if (a.commitsAhead) L.push(`      progress   ${a.commitsAhead} commit(s) ahead of main`);
    if (!a.worktreePresent && a.wipRef) {
      L.push(c.dim(`      the worktree is gone but the checkpoint is not — \`git log ${a.wipRef}\``));
    }
    L.push('');
  }
  if (!n) L.push('  Nothing was parked under an agent worktree.');
  L.push(c.dim('  `atlas stop` clears this state. Branches and checkpoints are never deleted by it.'));
  return L.join('\n');
}

/** What `atlas stop` removed, what it refused to, and why the refusal is the useful part. */
function formatStop(r, c) {
  const L = [];
  L.push('');
  L.push(r.dryRun ? c.bold('Dry run — nothing was removed.') : c.bold('Stopped.'));
  L.push('');
  for (const x of r.removed) {
    // The server is named on the worktree's own line rather than in a separate section: "this directory went
    // and so did the thing serving it" is one fact, and splitting it is how the second half went unread.
    const srv = x.server
      ? c.dim(`  · dashboard on port ${x.server.port ?? '?'} (pid ${x.server.pid}) `
              + `${r.dryRun ? 'would be stopped' : (x.server.outcome || 'stopped')}`)
      : '';
    L.push(`  ${c.green('removed')}  ${x.id}  ${c.dim(x.dir)}${srv}`);
  }
  for (const x of r.kept) L.push(`  ${c.yellow('kept')}     ${x.id}  ${x.why}${x.dirty ? ` (${x.dirty} file(s))` : ''}`);
  if (!r.removed.length && !r.kept.length) L.push('  No agent worktrees to clear.');
  for (const x of r.servers?.failed || []) {
    L.push(`  ${c.yellow('server')}   ${x.id}  pid ${x.pid} could not be stopped — ${x.reason}`);
    L.push(c.dim('           it may still be serving a directory that is now gone; `atlas serve --list` shows it.'));
  }
  L.push('');
  // A rehearsal that reports "cleared" is worse than no rehearsal: the whole point of `--dry-run` is to be
  // believed about what has not happened yet.
  L.push(`  Session state: ${
    !r.hadManifest ? c.dim('none was recorded')
      : r.dryRun ? 'would be cleared'
        : 'cleared'}.`);
  if (r.wipRefs.length) {
    L.push(`  ${c.bold(String(r.wipRefs.length))} checkpoint branch(es) kept: ${r.wipRefs.join(', ')}`);
    L.push(c.dim('  Nothing that reached git is deleted here. Remove them yourself when you are sure.'));
  }
  if (r.kept.length && !r.forced) {
    L.push('');
    L.push(c.yellow('  Some worktrees were kept because they still hold uncommitted work.'));
    L.push('  `atlas pause` checkpoints it to a branch first, which is what makes stopping safe.');
    L.push('  `atlas stop --force` discards it instead. That is not recoverable.');
  }
  return L.join('\n');
}

/** A terminal view of the planning document: progress bars, grouped by track. */
function formatTasks(plan, filter, useColor) {
  const c = paint(useColor);

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
  const running = runningBuild();
  const lock = acquireBuildLock(root, { build: { version: running.version, path: running.pluginRoot } });
  if (!lock.ok) {
    say(`  Another build is running (pid ${lock.heldBy}); skipped after waiting ${Math.round(lock.waited / 1000)}s.`);
    return { pages: 0, outDir: path.resolve(root, cfg.output), health: { blockingCount: 0 }, skipped: true };
  }
  if (lock.stole) say('  Took over a stale build lock — a previous build did not finish.');
  // Two different builds taking turns over one output directory is silent and it lies about the code: the
  // fix you just made appears not to work because the other build rebuilt over it. It goes to stderr and
  // ignores --quiet, because a quiet build is still a build whose output is about to be overwritten.
  if (lock.foreign) {
    console.error(foreignBuildWarning(lock.foreign, { version: running.version, path: running.pluginRoot },
                                      path.resolve(root, cfg.output)));
  }
  try {
  const index = buildIndex(root, cfg, { withGit });
  const health = runHealth(index, cfg, root, healthOpts(root, cfg));
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

  const { outDir, pages, truncated, plan, deck, collisions, kb } = renderSite(index, health, cfg, root);
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
  if (truncated) say(`  ${truncated} long document(s) indexed to the first ${num(cfg.searchBodyLimit || 6000)} characters for search.`);
  /*
   * **How an already-adopted repository hears about its own plan.**
   *
   * Detection in `init` reaches repositories adopted from now on and no others; the three that provoked
   * this were adopted long ago and would never have run `init` again. The build runs in all of them, every
   * time a session writes markdown, so this line is where they find out.
   *
   * **Advice, not a failure.** It is one line in the ordinary build summary, beside the deck line that says
   * there is no deck. It changes no exit code, gates nothing, and writes nothing — a build that silently
   * edited `project-atlas.config.json` would be a worse defect than the one being fixed.
   */
  if (plan && !plan.missing) {
    say(`  Dashboard: ${plan.stats.total} item(s) from ${plan.source}${plan.stats.unknown ? `, ${plan.stats.unknown} without a figure` : ''}.`);
  } else if (plan?.missing) {
    // Configured and absent is a different fact from unconfigured, and it always was — the two shared a
    // line that named only one of them, so a typo'd path read as "you never set this".
    say(`  Dashboard: planning.source is ${plan.source}, which does not exist — no item charts.`);
  } else {
    const advice = planSetupNotice(index.documents.map((d) => d.path), cfg);
    say(`  Dashboard: no planning source configured — set planning.source to chart a task list.`);
    for (const s of advice?.sentences.slice(1) || []) say(`    ${s.replace(/`/g, '')}`);
  }
  say(deck ? `  Deck: ${deck.slides.length} slide(s) from ${deck.source}.` : `  Deck: none — create docs/atlas/DECK.md to add one.`);
  // **Say that the agent-readable half exists.** The HTML is announced by the `Open:` line below and the
  // markdown knowledge graph was announced nowhere — which is the same defect this release spent the day
  // fixing for the dashboard URL: a surface that is generated, correct, and unmentioned is a surface nobody
  // uses. It is the half of the output meant for something that will never look at a browser.
  if (kb?.files) say(`  Knowledge graph: ${kb.files} markdown file(s) for agents → ${path.relative(root, kb.dir)}/README.md`);
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
  L.push(`${index.siteTitle} — ${index.stats.documents} documents, ${num(index.stats.lines)} lines, ${(index.stats.bytes / 1024 / 1024).toFixed(1)} MB`);
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

  /*
   * **The plan, found rather than left blank.**
   *
   * `planning: {}` was the default and nothing ever filled it, so three adopted repositories with real,
   * actively maintained plan documents each rendered a dashboard saying no planning document was
   * configured — read three times as the tool being broken. The taxonomy above already knows what a plan
   * looks like; the same globs answer this question, via `PLAN_DOCUMENT_GLOBS`.
   *
   * **One candidate is a setting. Several is a question, and it is asked.** Several is the normal case, not
   * the edge: one repository here offers six. A plan drives the item table, both charts, spec coverage, the
   * timeline and the commit gate, so choosing the wrong document does not make the dashboard smaller — it
   * makes it confidently wrong. `--plan` exists so the answer can be given in one command instead of an
   * editor.
   */
  const candidates = planCandidates(files);
  const asked = typeof flag('plan') === 'string' ? flag('plan').replace(/^\.\//, '') : null;
  if (asked !== null && !files.includes(asked)) {
    console.error(`--plan ${asked} is not an indexable markdown file in this repository. ` +
      (candidates.length ? `Documents named like a plan here: ${candidates.join(', ')}.`
                         : `No document here is named like a plan.`));
    process.exitCode = 1;
    return;
  }
  const source = asked ?? (candidates.length === 1 ? candidates[0] : null);

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
    // Written even when empty, because a key that is absent from the file is a key nobody knows to set —
    // which is how three repositories with a plan ended up with no `planning.source`.
    planning: source ? { source } : {},
  };
  if (!cfg.clusters.length) cfg.clusters = DEFAULT_CLUSTERS;

  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  say(`Wrote ${path.relative(root, target)}`);
  say(`  ${files.length} markdown file(s) across ${dirs.size} directories.`);
  say(`  ${cfg.clusters.length} cluster(s) kept of ${DEFAULT_CLUSTERS.length} defaults — the rest matched nothing here.`);
  say('');
  if (source) {
    say(asked
      ? `  planning.source = ${source}, as asked for.`
      : `  planning.source = ${source} — the only document here named like a plan, so nothing was chosen between.`);
  } else if (candidates.length) {
    say(`  planning.source is NOT set. ${candidates.length} documents here are named like a plan:`);
    for (const c of candidates) say(`    ${c}`);
    say(`    Nothing was picked — the plan drives the item table, both charts and the commit gate, so guessing`);
    say(`    which one it is would be worse than asking. Set planning.source, or re-run:`);
    say(`      atlas init --force --plan ${candidates[0]}`);
  } else {
    say(`  planning.source is NOT set — no document here is named like a plan (BACKLOG, TASKS, TODO, HANDOFF,`);
    say(`    ROADMAP, PLAN-*, or anything under docs/planning/). The dashboard's item charts stay off until it is.`);
  }
  say('');
  say('  Next: review the clusters, then add the two checks that are off until configured —');
  say('    forbiddenTerms  retired product or persona names   (enables H7)');
  say('    crossref        paired documents, e.g. backlog + task list  (enables H9)');
  say('');
  const top = [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  say('  Largest documentation directories:');
  for (const [d, n] of top) say(`    ${String(n).padStart(4)}  ${d}`);
}

/**
 * The command surface, as a person navigates it.
 *
 * **Every dispatched command appears here, and a test fails when one does not.** (A-35) This list had drifted
 * to 27 of 38 — `tasks`, `serve`, `config`, `plan`, `worklog`, `ownership` and `surviving` were all real,
 * dispatched, documented elsewhere, and invisible to anyone who typed `atlas help`. A short list is honest
 * about being short; a list that silently lags the code is worse, because it reads as complete and people
 * stop looking. `tests/run.mjs` derives the dispatch table from this file's own source and compares.
 *
 * Aliases get a mention in the alias block rather than a line of their own: two entries describing one
 * implementation is the same drift in miniature, and the second copy is the one that goes stale.
 */
function usage() {
  console.log(`project-atlas — a derived, auditable knowledgebase over your repository's documentation.

  atlas help                 this list (also what a bare \`atlas\` prints)
  atlas version              which build is answering, where it lives, and whether it is behind
  atlas init [--plan PATH]   write ${CONFIG_NAME}, detecting the layout and the plan document
  atlas config [--json]      the resolved configuration — the file merged over the defaults, which is what runs
  atlas scan  [--json]       build and summarise the index
  atlas tasks [word]         the planning document with progress bars; a word filters it
  atlas plan [slug]          the route for the change in your tree — branch, item, version; --apply cuts the branch
  atlas branch [type slug]   branch state, or create type/short-slug carrying your changes
  atlas contention [branch…]  what a fan-out will collide on: files more than one branch touches, plan ids
                             defined twice, and the next free id. --base REF; exit 1 on a duplicate id only
  atlas caps                 which host features are on (wiki/pages/issues/discussions)
  atlas community [--write]  scaffolding for the features this host actually supports
  atlas changes [--json]     what changed, and which documents cite it
  atlas diff <file>          that file's diff — uncommitted, else across the branch
  atlas tokens [--out FILE]  token accounting from local session transcripts — opt-in, never published
    --snapshot               append the counts-only day rollup to .atlas/tokens.jsonl (needs tokens.snapshot)
  atlas sessions [--out F]   how sessions went — turns, interruptions, friction, rework
  atlas prompt [--out FILE]  a system prompt assembled from this repository's own rules and state
  atlas mcp                  serve the corpus over MCP on stdio — read-only, no dependency
    --status                 what a client would connect to, where it is registered, what is running
  atlas ask <task>           one structured answer for a program; exit 1 on findings, 2 if it could not run
  atlas design [--scaffold]  the design record's state; --scaffold writes questions, never answers
  atlas handoff              the derived half of a handoff, as a prompt — writes nothing
  atlas note <kind> "<text>"  append one record to the journal — survives a killed session
  atlas state [--json]       what a resuming session reads first: where you are, what was recorded
  atlas worklog [--day D]    write today's entry from git and the plan; --stdout to see it without writing
  atlas contrib [--json]     who did what, from git history alone
  atlas ownership [--json]   bus factor per area — how many people have ever touched it
  atlas surviving [--json]   whose written lines are still in the tree, by \`git blame\` rather than by commit
  atlas git-insights [sect]  what git history says that nothing else here reads — strictly read-only
                             sections: hotspots, coupling, branches, cadence, hygiene, change
  atlas git-tree             branch topology — what was cut from what, and where. Origins are inferred
  atlas health [--verbose]   report rot signals; exit 1 if any blocking signal fires
  atlas spec --gate          the commit gate: refuse a staged change whose message names no plan item.
                             Reads the message on stdin and prints nothing when it passes. Bare \`atlas spec\`
                             is not a command — \`--gate\` is the whole of it.
  atlas build                generate the static site (index, dashboard, deck, health)
  atlas serve                build, then run the live dashboard detached and open it
    --status | --stop        what is running here | end it now
    --list | --launcher      every atlas dashboard on this machine | write a page linking them all
  atlas product              one page across sibling repositories under a directory that is not a repository.
                             Members are discovered, never declared; an unadopted one is a stated row with
                             what adopting it would take. Writes outside every repository, so it is never
                             committable. --product DIR to name the root explicitly (it never ascends on its
                             own), --deep to index each adopted member and measure health, --json, --out FILE
  atlas watch [--serve]      rebuild on change; --serve hosts it live at http://127.0.0.1:4173
  atlas all                  scan + health + build
  atlas pause [--dry-run]    checkpoint every agent worktree to a wip/agent-* ref, and record the session
  atlas resume               print the re-spawn plan for a paused session — branch, worktree, checkpoint
  atlas stop [--force]       clear session state and agent worktrees; every branch and checkpoint survives
  atlas publish              stage a target; NOTHING is pushed without --push
    --target wiki            GitHub Wiki — flattened markdown, links rewritten, drift-guarded
    --target pages           the full site to a gh-pages branch (dashboard + deck survive)
    --target export          one self-contained HTML file (--page dashboard|index|health)
    --ci                     (GitLab, pages) write the .gitlab-ci.yml job instead — Pages is an artifact there

Aliases
  atlas capabilities         = atlas caps
  atlas git-insight          = atlas git-insights

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
