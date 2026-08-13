/**
 * project-atlas · the live dashboard, without anyone having to remember to start it
 *
 * `atlas watch --serve` works and holds a terminal. That is a command someone has to remember, in a window
 * they have to keep, and the failure mode is silent: the server dies, the page keeps polling a stamp it can
 * no longer reach, gives up after three misses, and goes on looking exactly like a live dashboard. That
 * happened — a frozen page was read as the dashboard for a whole session.
 *
 * So the server starts itself, opens the page once, and — this is the part that makes auto-start safe —
 * **exits when nothing is watching it**. A server nobody started is otherwise a server nobody knows how to
 * stop: an orphan holding a port, outliving the session that spawned it, still serving a build from
 * yesterday. The idle timer is what turns "starts automatically" from litter into a lifecycle.
 *
 * ## The rules it holds to
 *
 * - **Loopback only.** `127.0.0.1`, never `0.0.0.0`. This serves generated files on a developer's machine;
 *   binding to every interface would put a repository's documentation on the local network by default.
 * - **Static files from the output directory only.** A resolved path that escapes is refused, not read.
 * - **`no-store`.** The build stamp *is* the liveness signal; a cached one defeats the entire mechanism.
 * - **One server per repository**, identified by a pidfile that records the port. Two servers on two ports
 *   serving the same directory is how you end up looking at the wrong one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';

/**
 * The base of the port range, and the size of it.
 *
 * **A fixed port is wrong the moment someone has two projects open**, which is the normal case: several
 * terminals, several agents, several repositories. The first server wins the port and the rest fail — or,
 * far worse, the second project's owner opens the one port they know and reads *another project's*
 * dashboard while believing it is theirs. A page that looks right and is about something else is the exact
 * failure this whole session was spent chasing; shipping a new source of it would be indefensible.
 *
 * So the port is derived from the repository path: stable for a given checkout, different between
 * checkouts, and requiring no configuration or bookkeeping from anyone. `--port` still overrides.
 */
export const PORT_BASE = 4173;
export const PORT_SPAN = 100;

/** Kept as the documented default for the base case, and for anything that wants one number to print. */
export const DEFAULT_PORT = PORT_BASE;

/**
 * A stable port for this repository.
 *
 * FNV-1a over the resolved path — small, dependency-free, and well spread over a 100-port window. Two
 * checkouts can still collide; that is handled by probing upward at start time and recording the port that
 * was actually taken in the pidfile, so nothing has to guess it afterwards.
 */
export function portForRoot(root, base = PORT_BASE, span = PORT_SPAN) {
  const s = path.resolve(root);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return base + (h % span);
}

/** Where the cross-project registry lives. Outside every repository, because it spans them. */
export function registryPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'atlas-servers.json');
}

/**
 * Every atlas dashboard running on this machine, pruned of dead entries as it is read.
 *
 * With several projects open at once the question stops being "is it running" and becomes "which one am I
 * looking at" — so the registry records the project name beside the port. Entries are verified with signal
 * 0 on every read rather than trusted: a registry that lists servers which died is a registry that sends
 * someone to a port serving nothing, or worse, to a port something else has since taken.
 */
export function readRegistry() {
  let raw = [];
  try { raw = JSON.parse(fs.readFileSync(registryPath(), 'utf8')); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const live = raw.filter((e) => {
    if (!e?.pid) return false;
    try { process.kill(e.pid, 0); return true; } catch { return false; }
  });
  if (live.length !== raw.length) {
    try { fs.writeFileSync(registryPath(), JSON.stringify(live, null, 2), 'utf8'); } catch {}
  }
  return live;
}

export function registerServer(entry) {
  const live = readRegistry().filter((e) => e.root !== entry.root);
  live.push(entry);
  try {
    fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
    fs.writeFileSync(registryPath(), JSON.stringify(live, null, 2), 'utf8');
  } catch { /* a registry is a convenience; failing to write one must never fail a working server */ }
}

export function deregisterServer(root) {
  const live = readRegistry().filter((e) => e.root !== path.resolve(root));
  try { fs.writeFileSync(registryPath(), JSON.stringify(live, null, 2), 'utf8'); } catch {}
}

/**
 * ============================================================================
 * Ground truth: the process table, not the registry (A-49)
 * ============================================================================
 *
 * The comment above `readRegistry` states one half of the rule — *"a registry that lists servers which died
 * is a registry that sends someone to a dead port"*. The inverse turned out to be the more expensive half,
 * and it went unhandled for two sessions:
 *
 *   $ atlas serve --list
 *   No atlas dashboards are running on this machine.
 *   $ lsof -nP -iTCP -sTCP:LISTEN | grep 4238
 *   node  48511 ... TCP 127.0.0.1:4238 (LISTEN)
 *
 * **A registry that omits servers which are alive is a registry that reports an empty machine while five
 * dashboards answer on it.** Four of those five belonged to agent worktrees that had already been deleted, so
 * the owner opened a port, read a branch they were not on and six files they did not have, and concluded the
 * dashboard was stale. It was not stale. It was another repository's server, serving a directory that no
 * longer existed. They were found and killed by hand with `lsof` and `ps`.
 *
 * The escape is the same one `adoptableServer` already took for a single port: **stop asking the records and
 * ask the machine.** A detached server is a `node` process whose argv this module wrote itself, so the
 * process table is a register nothing can forget to update, nothing can prune by mistake, and no crash can
 * desynchronise — it is destroyed by exactly one event, which is the server actually exiting.
 *
 * The registry stays, demoted to a cache: it carries the friendly project name, and it is what the launcher
 * reads. It is never again the sole basis for the sentence "nothing is running".
 */

/**
 * The tokens a detached atlas server always has, in the argv this module spawns.
 *
 * Matched as a set rather than a substring. `--serve` alone appears in half the shell lines on a developer's
 * machine, including the `grep` somebody just ran looking for these processes.
 */
const SERVER_ARGV_TOKENS = ['watch', '--serve', '--detached'];

/**
 * Read one command line out of a process-table row and decide whether it is one of ours.
 *
 * **Positional, not a substring search, and that distinction is load-bearing.** A `ps` listing contains the
 * shell command that produced it: `/bin/zsh -c ... ps -axo pid=,args= | grep 'atlas.mjs watch --serve
 * --detached'` carries every token this function looks for, and a naive `includes()` would nominate the
 * operator's own diagnostic shell for termination. Requiring argv[0] to be a `node` binary and argv[1] to be
 * a path ending `atlas.mjs` excludes every wrapper, because a wrapper's second token is `-c` or a flag.
 *
 * Returns the facts, or `null` for "this is not an atlas server" — never a maybe. Everything downstream that
 * can send a signal is gated on a non-null return from this one function.
 */
export function serverArgvFacts(argv) {
  const tok = String(argv || '').trim().split(/\s+/).filter(Boolean);
  if (tok.length < 2) return null;
  const exe = path.basename(tok[0]).replace(/\.exe$/i, '');
  if (exe !== 'node' && exe !== 'nodejs') return null;
  if (!/(^|[/\\])atlas\.mjs$/.test(tok[1])) return null;
  for (const t of SERVER_ARGV_TOKENS) if (!tok.includes(t)) return null;

  const val = (name) => {
    const i = tok.indexOf(`--${name}`);
    if (i !== -1 && tok[i + 1] && !tok[i + 1].startsWith('--')) return tok[i + 1];
    const eq = tok.find((t) => t.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : null;
  };
  const port = Number(val('port'));
  const root = val('serve-root');
  return {
    script: tok[1],
    port: Number.isFinite(port) && port > 0 ? port : null,
    // Absolute or nothing. A relative root is meaningless to a reader in another directory, and it is about
    // to be tested with `existsSync` — resolving it against *our* cwd would answer a question about the
    // wrong path entirely.
    root: root && path.isAbsolute(root) ? path.resolve(root) : null,
  };
}

/**
 * Every process on this machine, as `{ pid, args }`.
 *
 * **Returns `null`, never `[]`, when it could not ask.** The two are opposite answers and collapsing them is
 * the precise mistake being fixed here: `[]` licenses the sentence "nothing is running", and a `ps` that is
 * missing, refused or unparsed knows nothing of the sort. Callers branch on `null` and say so out loud.
 */
export function readProcessTable() {
  // BSD form first (macOS), then the SysV form (GNU procps). Both accept `args=`, which suppresses the
  // header — a header row would otherwise parse as a process every time.
  for (const args of [['-axo', 'pid=,args='], ['-eo', 'pid=,args=']]) {
    let out;
    try {
      out = execFileSync('ps', args, { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { continue; }
    const rows = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
      if (m) rows.push({ pid: Number(m[1]), args: m[2] });
    }
    if (rows.length) return rows;
  }
  return null;
}

/**
 * A server's root, recovered from its working directory.
 *
 * Only for servers started by a build that predates `--serve-root`: `spawnDetached` has always set
 * `cwd: root`, so the kernel has been recording the answer all along. Best effort — `lsof` is absent on
 * Windows and may be absent anywhere — and a `null` here means the root is *unknown*, which downstream is
 * treated as "do not touch", never as "gone".
 */
export function cwdOfPid(pid) {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      { encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /^n(.+)$/m.exec(out);
    return m && path.isAbsolute(m[1]) ? m[1] : null;
  } catch { return null; }
}

/**
 * Every atlas dashboard actually running on this machine. `null` if the process table could not be read.
 *
 * `rootUnknown` is carried rather than smoothed over. A server we cannot place is a real server that must be
 * listed and must never be reaped, and a record that quietly dropped it would recreate the invisible orphan.
 */
export function discoverServers({ table = readProcessTable, cwd = cwdOfPid } = {}) {
  const rows = table();
  if (rows === null) return null;
  const found = [];
  for (const { pid, args } of rows) {
    const f = serverArgvFacts(args);
    if (!f) continue;
    const root = f.root || cwd(pid);
    found.push({
      pid,
      port: f.port,
      root: root ? path.resolve(root) : null,
      rootUnknown: !root,
      url: f.port ? `http://127.0.0.1:${f.port}/` : null,
      argv: args,
    });
  }
  return found;
}

/**
 * Is this root **deleted**, as distinct from merely not here?
 *
 * The difference decides whether a process lives, so it is drawn deliberately narrowly.
 *
 * An unmounted volume, a disconnected network share and a laptop that woke up without its external disk all
 * make `existsSync` false for a directory whose contents are perfectly intact. Killing a server over that
 * would be destroying state to tidy up an absence that ends when somebody plugs the drive back in.
 *
 * **The parent directory is the discriminator.** `git worktree remove` deletes
 * `…/.claude/worktrees/agent-abc` and leaves `…/.claude/worktrees` standing: the container is present,
 * readable, and the thing is simply not in it. That is a deletion, and it is the exact shape of all four
 * orphans in the incident. An unmounted volume takes the parent with it, so the test fails and the server is
 * left alone — as is a parent we cannot read, because "permission denied" is not evidence of anything.
 *
 * The bias is deliberate and one-directional: this returns false whenever it is unsure. Being too cautious
 * leaves a process running, which is the bug being fixed. Being too eager kills somebody's work.
 *
 * **`existsSync` alone was not enough, and the orphan is what proved it (A-62).** A detached server is a
 * `watch --serve` loop: it rebuilds on a timer and a rebuild *creates its own output directories*. So an
 * orphan whose repository is deleted out from under it puts `.atlas/`, `docs/_wiki/` and `worklog/` straight
 * back, and the directory exists again within seconds — recreated by the very process this function is
 * deciding the fate of. Measured, not reasoned: nine leaked servers survived a reap, and a tenth was started
 * deliberately, its checkout `rm -rf`'d, and found to have restored three directories and nothing else.
 * `.git`, the config and every source file stayed gone. A test the subject can falsify is not a test, and
 * this one had been passing its own suite for a whole release while leaking processes on this machine.
 *
 * So the question is no longer "does a directory of that name exist" but "is the *project* still there".
 * `project-atlas.config.json` and `.git` are the two things that made it one, neither is ever written by a
 * build, and a root that has lost both is not a repository any more whatever else is sitting in it. Both are
 * checked, because a repository can be adopted without git and a git checkout can be mid-`init`; losing
 * *both* is what cannot happen to a project somebody is still working in.
 */
export function rootIsGone(root) {
  if (!root || typeof root !== 'string' || !path.isAbsolute(root)) return false;
  const parent = path.dirname(root);
  if (!parent || parent === root) return false;            // a filesystem root; never reachable, never trusted
  try { if (!fs.statSync(parent).isDirectory()) return false; } catch { return false; }
  try { fs.readdirSync(parent); } catch { return false; }  // an unreadable parent is "cannot tell"

  let here;
  try { here = fs.existsSync(root); } catch { return false; }
  if (!here) return true;

  // The directory is back. Whether the *project* is back is a different question, and the only one that
  // matters — see the note above on what a rebuilding orphan restores and what it cannot.
  for (const mark of ['project-atlas.config.json', '.git']) {
    try { if (fs.existsSync(path.join(root, mark))) return false; } catch { return false; }
  }
  return true;
}

/**
 * The gate. **Nothing in this codebase sends a signal to a pid that has not come through here.**
 *
 * Re-reads the command line for this one pid at the moment of asking, rather than trusting the scan that
 * nominated it. Pids are reused, and the window between "we listed the processes" and "we signalled one" is
 * long enough on a busy machine for the process to exit and the number to be handed to something else. The
 * scan finds candidates; this decides.
 *
 * Requires, all of them:
 *   1. the pid is alive and ours to signal — `kill(pid, 0)` without throwing;
 *   2. it is not this process, nor this process's parent;
 *   3. its **current** argv parses as a detached atlas server (`serverArgvFacts`);
 *   4. if a port was expected, the argv still names that port — the port alone was never evidence, but a
 *      port that has changed under us means the pid is not the process we looked at.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because every refusal here is something the operator
 * should be told rather than something that should stop a command.
 */
export function confirmAtlasServer(pid, { port = null, self = process.pid } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, reason: `pid ${pid} is not a signallable process id` };
  if (pid === self) return { ok: false, reason: 'that pid is this process' };
  if (pid === process.ppid) return { ok: false, reason: 'that pid is this process’s parent' };
  try { process.kill(pid, 0); } catch { return { ok: false, reason: `pid ${pid} is not running` }; }

  let line = null;
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='],
      { encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop() || null;
  } catch { /* handled below as "no evidence" */ }
  // No command line means no evidence, and no evidence means no signal. This is the branch Windows takes,
  // and leaving a server running there is the correct outcome of not being able to prove anything about it.
  if (!line) return { ok: false, reason: `could not read the command line of pid ${pid}` };

  const facts = serverArgvFacts(line);
  if (!facts) return { ok: false, reason: `pid ${pid} is not an atlas dashboard server` };
  if (port && facts.port && facts.port !== port) {
    return { ok: false, reason: `pid ${pid} serves port ${facts.port}, not ${port} — the pid has been reused` };
  }
  return { ok: true, reason: null, pid, port: facts.port || port, root: facts.root, argv: line };
}

/**
 * SIGTERM one confirmed server, and report honestly whether it went.
 *
 * SIGTERM, never SIGKILL. The server has a shutdown handler that removes its own registry entry and pidfile;
 * SIGKILL would leave both behind and re-manufacture the stale record this whole change exists to remove.
 *
 * The liveness re-check afterwards is a single non-blocking probe, so a server still running its exit handler
 * is reported as `signalled` rather than as `exited`. Claiming a kill that has not landed yet is how a leak
 * gets closed on paper.
 */
export function terminateServer(pid, { port = null, self = process.pid } = {}) {
  const gate = confirmAtlasServer(pid, { port, self });
  if (!gate.ok) return { signalled: false, pid, ...gate };
  try { process.kill(pid, 'SIGTERM'); } catch (err) {
    return { signalled: false, pid, ok: false, reason: err.message };
  }
  let gone = false;
  try { process.kill(pid, 0); } catch { gone = true; }
  return { signalled: true, exited: gone, pid, port: gate.port, root: gate.root, reason: null };
}

/**
 * Reconcile what is running against what is written down, and label every row with what we actually know.
 *
 * This is what `--list` prints and what the reaper reads, so the two can never disagree about the machine.
 * `scanned: false` propagates the `null` from `readProcessTable` all the way to the sentence the user reads.
 */
export function surveyServers({ discover = discoverServers, registry = readRegistry } = {}) {
  const reg = registry();
  const live = discover();
  const byRoot = new Map(reg.filter((e) => e.root).map((e) => [path.resolve(e.root), e]));

  if (live === null) {
    // Everything we have is hearsay. Say that, and pass the registry through unverified rather than
    // pretending it was confirmed.
    return {
      scanned: false,
      servers: reg.map((e) => ({
        pid: e.pid, port: e.port, root: e.root ? path.resolve(e.root) : null, rootUnknown: !e.root,
        name: e.name || (e.root ? path.basename(e.root) : null),
        url: e.url || (e.port ? `http://127.0.0.1:${e.port}/` : null),
        registered: true, confirmed: false, orphan: false,
      })),
      orphans: [],
    };
  }

  const servers = live.map((s) => {
    const known = s.root ? byRoot.get(s.root) : null;
    return {
      ...s,
      name: known?.name || (s.root ? path.basename(s.root) : null),
      url: s.url || known?.url || null,
      registered: !!known,
      confirmed: true,
      // An unplaceable server is never an orphan. We do not know what it serves, and "unknown" is not "gone".
      orphan: !s.rootUnknown && rootIsGone(s.root),
    };
  });

  // A registry entry with no matching process is a lie in the other direction — kept visible rather than
  // silently dropped, because it is the shape `readRegistry` used to prune without telling anyone.
  const livePids = new Set(live.map((s) => s.pid));
  for (const e of reg) {
    if (livePids.has(e.pid)) continue;
    servers.push({
      pid: e.pid, port: e.port, root: e.root ? path.resolve(e.root) : null, rootUnknown: !e.root,
      name: e.name || (e.root ? path.basename(e.root) : null),
      url: e.url || (e.port ? `http://127.0.0.1:${e.port}/` : null),
      registered: true, confirmed: false, orphan: false, stale: true,
    });
  }

  return { scanned: true, servers, orphans: servers.filter((s) => s.orphan) };
}

/**
 * Stop every server whose root has been deleted, and say what happened.
 *
 * **Silence is how this leak survived two sessions**, so the report is the deliverable and not a courtesy.
 * Every candidate appears in the result: reaped, or skipped with the reason it was spared.
 *
 * `dryRun` nominates without signalling, which is what `stop --dry-run` uses.
 */
export function reapOrphanServers({ dryRun = false, self = process.pid, survey = surveyServers } = {}) {
  const s = survey();
  if (!s.scanned) return { scanned: false, reaped: [], skipped: [], dryRun };

  const reaped = [];
  const skipped = [];
  for (const o of s.orphans) {
    if (dryRun) {
      const gate = confirmAtlasServer(o.pid, { port: o.port, self });
      (gate.ok ? reaped : skipped).push({ ...o, wouldReap: gate.ok, reason: gate.reason });
      continue;
    }
    const r = terminateServer(o.pid, { port: o.port, self });
    if (!r.signalled) { skipped.push({ ...o, reason: r.reason }); continue; }
    // The record goes with the process. Leaving the entry behind would put us back at a registry naming a
    // port nothing answers on, which is the failure this module's oldest comment already warned about.
    if (o.root) deregisterServer(o.root);
    reaped.push({ ...o, exited: r.exited });
  }
  return { scanned: true, reaped, skipped, dryRun };
}

/**
 * How long the server tolerates having no reader.
 *
 * **The timer measures the right thing only because an open page polls.** A dashboard tab fetches its build
 * stamp every few seconds, so requests keep arriving as long as somebody has it open — "no requests" really
 * does mean "no reader", not "the developer is thinking".
 *
 * It was thirty minutes, which was wrong for the case that actually happens: a session where nobody opens
 * the dashboard for half an hour, the server exits, and the link that was printed at session start is dead
 * for the rest of the session with nothing saying so. That is the *silent* failure this whole feature
 * exists to remove, reintroduced by its own safety valve.
 *
 * Four hours instead. Long enough to outlast a working session; short enough that a machine left overnight
 * is not still serving in the morning. The value is a compromise rather than a discovery, so it is
 * configurable — and the more important half of the fix is that the server is now revived on any session
 * activity rather than only on a markdown write.
 */
export const DEFAULT_IDLE_MS = 4 * 60 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

export const pidFile = (root) => path.join(root, '.atlas', 'serve.pid');

/**
 * Is a server already up for this repository?
 *
 * A pidfile is a claim, not a fact — a killed process leaves one behind, and a stale claim is worse than
 * none because it stops the real server from ever starting. So the pid is checked with signal 0 and a dead
 * entry is cleared rather than believed.
 */
/**
 * Is something serving on this repository's port that we have no record of?
 *
 * `serverStatus` reports "not running" whenever the pidfile is missing — and a process can outlive its own
 * record, which is exactly what happened: a detached server stayed alive and rebuilding while status said
 * nothing was there. The idle timer bounds that to thirty minutes, but a bound is not an answer, and a tool
 * that says "not running" about a running process teaches people to stop believing it.
 */
export async function unmanagedServer(root, port) {
  const p = port || portForRoot(root);
  return (await portInUse(p)) ? { port: p, url: `http://127.0.0.1:${p}/` } : null;
}

/**
 * Is the thing already answering on our port **our own server**, serving **our own output directory**?
 *
 * Every record this tool keeps of its servers is keyed by pid — the pidfile, and the machine-wide registry
 * behind `--list`. Both are therefore destroyed by the same event: a pid that dies. When several servers
 * race for one repository, the loser's pid can be the one written down, and clearing that dead claim throws
 * away the only record of the *winner*, which is still listening and still answering. The next start then
 * finds no record, concludes nothing is running, discovers its derived port is taken, probes one port
 * upward, and binds there. Now two servers answer for one repository, only the newer is named anywhere, and
 * the link printed at the top of the session points at whichever one lost the last race.
 *
 * That happened four times across four repositories on one machine in a single afternoon.
 *
 * The escape from the cycle is to stop asking *who* is serving and ask *what is being served*. A build
 * writes `build-stamp.txt` into its output directory; a server for this repository serves that exact file
 * off that exact disk. So fetching it and comparing it to what we can read locally identifies the server by
 * its content rather than by a pid nobody has a live record of — and it stays true across a restart, a lost
 * pidfile, a pruned registry, and a server started by a different build of this tool.
 *
 * A mismatch, a missing stamp, or anything that is not a plain 200 all mean **not ours**, and the caller
 * must treat that as a stranger holding the port rather than as something to adopt. Adopting a stranger
 * would point the user at some other program's web page and call it their dashboard.
 */
export async function adoptableServer(root, outDir, port) {
  const p = port || portForRoot(root);
  let mine;
  try { mine = fs.readFileSync(path.join(outDir, 'build-stamp.txt'), 'utf8').trim(); }
  catch { return null; }              // nothing built here yet — there is no stamp to recognise ourselves by
  if (!mine) return null;
  const theirs = await fetchText(`http://127.0.0.1:${p}/build-stamp.txt`);
  if (theirs === null || theirs.trim() !== mine) return null;
  return { port: p, url: `http://127.0.0.1:${p}/`, stamp: mine };
}

/** One short GET, or null. Deliberately not an error: "could not ask" and "answered wrong" are both "not ours". */
function fetchText(url, timeoutMs = 700) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 4096) { req.destroy(); resolve(null); } });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

export function serverStatus(root) {
  const file = pidFile(root);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { running: false }; }
  if (!raw?.pid) return { running: false };
  try {
    process.kill(raw.pid, 0);
    return { running: true, pid: raw.pid, port: raw.port, url: `http://127.0.0.1:${raw.port}/`, startedAt: raw.startedAt };
  } catch {
    try { fs.unlinkSync(file); } catch {}
    return { running: false, stale: raw.pid };
  }
}

/**
 * Which build is answering on this pid, and is it the one asking? (A-63)
 *
 * A running process cannot be upgraded. `atlas serve` is idempotent — it opens the page and returns when
 * something is already listening — so a dashboard started before an update keeps serving the *old* code for
 * as long as it lives, and every `/atlas:dashboard` after that reports success while showing a page the new
 * build would never have written. That happened here across three releases: a chart change, a footer change
 * and a whole new view were all invisible on a port whose server predated them, and the conclusion drawn
 * each time was that the feature had not shipped.
 *
 * The comparison is the **script path**, not a version string. Two builds are the same build when the same
 * file is executing; a version number would call a local checkout and an installed plugin of equal version
 * identical, which is the case this is most often needed for. Returns `null` for `same` when the running
 * process cannot be read, because "cannot tell" must not be reported as "stale" — that would restart a
 * healthy server on every invocation on any platform where `ps` says nothing.
 */
export function serverBuild(pid, { self = null } = {}) {
  const mine = path.resolve(self || process.argv[1] || '');
  let line = null;
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='],
      { encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop() || null;
  } catch { /* no evidence — handled below */ }
  const facts = line ? serverArgvFacts(line) : null;
  if (!facts?.script) return { script: null, mine, same: null };
  const script = path.resolve(facts.script);
  return { script, mine, same: script === mine };
}

export function writePid(root, { pid, port }) {
  const file = pidFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid, port, startedAt: new Date().toISOString() }), 'utf8');
}

export function clearPid(root) {
  try { fs.unlinkSync(pidFile(root)); } catch {}
}

/** Stop the running server. Returns what happened, so the caller can say it rather than guess. */
export function stopServer(root) {
  const st = serverStatus(root);
  if (!st.running) return { stopped: false, reason: st.stale ? `no server running (cleared a stale pidfile for ${st.stale})` : 'no server running' };
  try { process.kill(st.pid, 'SIGTERM'); } catch (e) { return { stopped: false, reason: e.message }; }
  clearPid(root);
  return { stopped: true, pid: st.pid, port: st.port };
}

/**
 * Open a URL in the machine's default browser.
 *
 * Best effort and deliberately silent on failure: a headless machine, a container, or a locked-down desktop
 * all legitimately have nothing to open with, and none of those is a reason to fail the command that
 * started a working server.
 */
export function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]]
            : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
            : ['xdg-open', [url]];
  try {
    execFile(cmd[0], cmd[1], () => {});
    return true;
  } catch { return false; }
}

/**
 * Serve `outDir` on loopback. Returns the server so a caller can close it.
 *
 * `onIdle` fires when nothing has requested anything for `idleMs`. The caller decides what that means —
 * the detached server exits, a foreground `watch --serve` ignores it, because a terminal someone is
 * sitting in front of is evidence enough that they still want it.
 */
export function startServer({ outDir, root = null, sources = null, port = DEFAULT_PORT, idleMs = 0, onIdle = null, onListen = null, onError = null }) {
  let lastRequest = Date.now();

  /*
   * **The one link on every derived page that the server could not answer.**
   *
   * Each generated page opens with "Source: `docs/references/authoring.md` — edit that file, not this one",
   * and links it. The href is relative to the repository root, which is correct when the HTML is opened off
   * the filesystem and dead the moment the same file is served: the server hosts the output directory, the
   * source lives above it, and the browser got `not found`. The banner exists for exactly one purpose — send
   * the reader to the file they should edit — so a link that dies under the server is the banner failing at
   * its only job, on every page, silently.
   *
   * **The allowlist is the corpus, not a path rule.** Widening the server to "anything under the repository
   * root" would trade one broken link for a loopback file browser over `.env`, `.git` and every key on the
   * machine's checkout. What is served instead is the exact set of documents this build indexed — a list the
   * build already has and hands over. A request for anything outside it is a 404, and a build that supplied
   * no list serves nothing, so the failure mode of the plumbing is "the old broken link", never "more is
   * readable than intended".
   *
   * Served as plain text deliberately: it is markdown source, and rendering it would hand back something that
   * looks like the derived page the reader is being sent away from.
   */
  // Read per miss rather than captured at startup: the corpus changes under a running server every time the
  // watcher rebuilds, and a list snapshotted at boot would 404 exactly the document somebody just added.
  // This only runs on the path that was already about to return 404, so it costs nothing on a normal request.
  const allowNow = () => {
    if (sources) return sources instanceof Set ? sources : new Set(sources);
    try { return new Set(JSON.parse(fs.readFileSync(path.join(outDir, 'sources.json'), 'utf8'))); }
    catch { return new Set(); }
  };
  const serveSource = (rel, res) => {
    const miss = () => res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    const allow = allowNow();
    if (!root || !allow.size || !allow.has(rel)) { miss(); return; }
    // Re-checked against the root even though the path came off the allowlist: the list is data, and a
    // containment check that only runs on paths already believed safe is a check that never runs.
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) { miss(); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { miss(); return; }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(buf);
    });
  };

  const server = http.createServer((req, res) => {
    lastRequest = Date.now();
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'dashboard.html' : url.replace(/^\/+/, '');
    const file = path.resolve(outDir, rel);
    if (file !== outDir && !file.startsWith(outDir + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('outside the output directory');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) { serveSource(rel, res); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(buf);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Named rather than retried on another port. A second server on a different port serving the same
      // directory is precisely how someone ends up reading a stale page while a fresh one runs elsewhere.
      console.error(`project-atlas: port ${port} is already in use. Another server is there — ` +
                    `\`atlas serve --status\` says whether it is ours, and \`--port\` picks a different one.`);
      process.exitCode = 1;
      // **Setting an exit code is not exiting**, and the difference leaked ten processes onto a machine.
      //
      // `watch --serve` continues past this point into its polling loop, so a child that lost the race for
      // the port stayed alive forever — not serving anything, invisible to `--status` because it never
      // wrote a pidfile, and *still rebuilding the output directory on every change*. Four of them
      // accumulated against one repository, each racing the others to write the same files, which is what
      // the build-owner warning had been reporting all along.
      //
      // A server that cannot bind has no remaining job. The caller says how to end it, because a caller
      // sitting in a terminal and a caller running detached deserve different exits.
      if (onError) onError(err, { port });
      return;
    }
    throw err;
  });

  server.listen(port, '127.0.0.1', () => { if (onListen) onListen(port); });

  if (idleMs > 0 && onIdle) {
    const timer = setInterval(() => {
      if (Date.now() - lastRequest >= idleMs) { clearInterval(timer); onIdle(); }
    }, Math.min(idleMs, 60_000));
    timer.unref();
  }
  return server;
}

/**
 * Start a server in a detached process and return once it is answering.
 *
 * Detached because the caller is a session-start hook or a one-line command, neither of which can hold a
 * process open. `unref()` so this process can exit without waiting on it, and `stdio: 'ignore'` because a
 * detached child writing to a closed pipe is a crash nobody sees.
 */
/**
 * Is something already listening there?
 *
 * Asked before spawning, because a detached child's stdio is discarded: when it hits `EADDRINUSE` its
 * explanation goes nowhere and the parent can only report the symptom — "started, but not listening" —
 * which describes what happened and not one useful thing about why. Checking first turns that into the
 * actual sentence: the port is taken.
 */
export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', (e) => resolve(e.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
}

/**
 * `--serve-root` carries the served directory in the argv, where `ps` can read it. (A-49)
 *
 * The child does not need it — it derives the same path from `cwd`, which is set on the line below. It is
 * there so that **the process is self-describing to anyone holding a process table and nothing else.** Every
 * other record of what a server serves is a file that can be pruned, lost or raced; argv is written once by
 * the parent and freed only when the process ends. That is what makes `discoverServers` able to answer "what
 * does this thing serve" for a server whose registry entry and pidfile have both vanished — the state the
 * incident actually occurred in.
 *
 * Passed in `--flag=value` form deliberately. An older plugin binary may still be the one on disk here
 * (`spawnDetached` runs `runningBuild()`'s copy, not this one), and its `parseArgs` splits on `=` before it
 * consults its list of value-taking flags — so the whole thing lands in the flag map and is ignored, instead
 * of the path falling through as a stray positional argument to `watch`.
 */
export function spawnDetached(root, { atlasBin, port = DEFAULT_PORT, idleMs = DEFAULT_IDLE_MS }) {
  const child = spawn(process.execPath,
    [atlasBin, 'watch', '--serve', '--detached', `--serve-root=${path.resolve(root)}`,
     '--port', String(port), '--idle-ms', String(idleMs), '--quiet'],
    { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}
