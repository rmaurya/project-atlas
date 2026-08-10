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
import { spawn, execFile } from 'node:child_process';

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

/** Thirty minutes of nobody asking for anything. Long enough to read, short enough not to be litter. */
export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

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
export function startServer({ outDir, port = DEFAULT_PORT, idleMs = 0, onIdle = null, onListen = null }) {
  let lastRequest = Date.now();

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
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
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

export function spawnDetached(root, { atlasBin, port = DEFAULT_PORT, idleMs = DEFAULT_IDLE_MS }) {
  const child = spawn(process.execPath,
    [atlasBin, 'watch', '--serve', '--detached', '--port', String(port), '--idle-ms', String(idleMs), '--quiet'],
    { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}
