/**
 * project-atlas · an MCP server, so an agent can ask instead of shelling out
 *
 * An assistant working in a repository can already run `atlas health` and parse the terminal output. That
 * works and is lossy: the CLI formats for a person — colours, alignment, truncation — and anything reading
 * it is reverse-engineering a layout that exists to be read, not parsed. MCP is the channel where the same
 * derived data arrives as structure.
 *
 * **Direction matters here and is the thing most often got wrong.** An MCP server exposes tools a *client*
 * decides to call. It gives an agent a way to ask atlas questions. It does **not** let outside software
 * drive a session — nothing here can start work, steer a run, or read a transcript. That is a different
 * mechanism entirely (M-2), and conflating the two is how you build the wrong thing convincingly.
 *
 * ## Why this is hand-written
 *
 * `@modelcontextprotocol/sdk` is the official implementation and would be this project's **first runtime
 * dependency**. The roadmap asked for that decision to be made deliberately rather than by reflex, so:
 *
 * The protocol surface actually needed here is `initialize`, `tools/list`, `tools/call` and one
 * notification — newline-delimited JSON-RPC 2.0 over stdin and stdout. That is roughly the size of this
 * file. Against it, a dependency would bring a version to track, a supply chain to trust, and an install
 * step for a tool whose whole distribution story is "clone it and run it with Node". A package earns its
 * place by being *harder* to write than to depend on; this one is not.
 *
 * The cost is real and worth naming: when the protocol revises, this file is ours to update, and the SDK
 * would have absorbed that. The version below is pinned and echoed back, so a client negotiating a version
 * we do not implement is told plainly rather than silently mishandled.
 *
 * ## Read-only, by construction
 *
 * Every tool here reads. None publishes, pushes, writes prose, or mutates the plan — the boundary Track 6
 * draws for autonomy, applied to a surface that is exposed to an agent rather than invoked by a person.
 * That is not a promise in a comment: `TOOLS` is the complete set, each entry is a pure function of the
 * repository, and a test asserts no handler reaches a writing module.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveConfig } from './config.mjs';
import { buildIndex } from './scan.mjs';
import { runHealth } from './health.mjs';
import { readPlanning } from './planning.mjs';
import { readContrib } from './contrib.mjs';
import { readChanges } from './changes.mjs';
import { read as readJournal } from './journal.mjs';
import { designRecord } from './design.mjs';

/** The revision of the protocol this file implements. Echoed back so a mismatch is visible, not guessed. */
export const PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = { name: 'project-atlas', title: 'project-atlas', version: '0' };

/**
 * The tools, and what each one answers.
 *
 * Descriptions are written for a model deciding whether to call, which means they say *when* the tool is
 * the right one — a description that only says what a tool does leaves the caller to guess, and a guessing
 * caller either never calls it or calls it for everything.
 */
export const TOOLS = {
  atlas_health: {
    title: 'Documentation health',
    description: 'Report documentation rot in this repository: dead links, unresolvable code citations, ' +
      'duplicate titles, orphans, stale documents, SOPs past their review date. Call this when asked what ' +
      'is wrong with the docs, whether they are current, or whether a change broke a reference. Returns ' +
      'every finding with the document it is in and why it fired.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: ({ root, cfg }) => {
      const index = buildIndex(root, cfg);
      const h = runHealth(index, cfg, root);
      return {
        blocking: h.blockingCount,
        findings: h.findings.map((f) => ({
          signal: f.signal, document: f.doc, detail: f.detail,
          blocking: !!f.blocking, suppressed: f.suppressed || null,
        })),
        // A check that could not run is never reported as clean — the rule the whole project holds to, and
        // one an agent reading only the findings array would otherwise miss entirely.
        notChecked: h.unevaluated || [],
      };
    },
  },

  atlas_plan: {
    title: 'The plan',
    description: 'Every item in this repository\'s planning document with its completion figure, status, ' +
      'track and priority. Call this when asked what is in progress, what is left, what a given item ' +
      'covers, or where a piece of work stands. Figures are read from the markdown, so they are exactly as ' +
      'current as that document.',
    schema: {
      type: 'object',
      properties: { open: { type: 'boolean', description: 'Only items below 100%.' } },
      additionalProperties: false,
    },
    run: ({ root, cfg, args }) => {
      const plan = readPlanning(root, cfg);
      if (!plan || plan.missing) return { available: false, reason: 'no planning source configured' };
      const items = plan.items
        .filter((i) => (args?.open ? (i.percent ?? 0) < 100 : true))
        .map((i) => ({
          id: i.id, title: i.title, percent: i.percent, status: i.status?.label || null,
          track: i.track, priority: i.priority, estimated: !!i.estimated,
        }));
      return { available: true, source: plan.source, count: items.length, items };
    },
  },

  atlas_search: {
    title: 'Search the corpus',
    description: 'Find documents in this repository by title, path or body text. Call this before reading ' +
      'files at random: it searches only what the corpus actually contains, and returns the path so the ' +
      'document can then be read directly.',
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to look for in titles, paths and bodies.' } },
      required: ['query'],
      additionalProperties: false,
    },
    run: ({ root, cfg, args }) => {
      const q = String(args?.query || '').toLowerCase().trim();
      if (!q) return { matches: [] };
      const index = buildIndex(root, cfg);
      const matches = index.documents
        .map((d) => {
          const inTitle = (d.title || '').toLowerCase().includes(q);
          const inPath = d.path.toLowerCase().includes(q);
          const at = (d.body || '').toLowerCase().indexOf(q);
          if (!inTitle && !inPath && at === -1) return null;
          return {
            path: d.path, title: d.title || null, cluster: d.cluster || null,
            // A window around the hit rather than the whole document: the caller asked where something is,
            // and returning entire files would spend a context window answering that.
            excerpt: at === -1 ? null : (d.body || '').slice(Math.max(0, at - 90), at + 160).replace(/\s+/g, ' ').trim(),
          };
        })
        .filter(Boolean);
      return { query: args.query, count: matches.length, matches: matches.slice(0, 25),
               capped: matches.length > 25 ? 25 : null };
    },
  },

  atlas_changes: {
    title: 'What changed, and what it puts at risk',
    description: 'Uncommitted and branch-local changes, and which documents cite the files that moved. ' +
      'Call this when asked what is in flight, or which documentation a change has put at risk of going ' +
      'stale.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: ({ root, cfg }) => {
      const index = buildIndex(root, cfg);
      const k = readChanges(root, cfg, index);
      if (!k.available) return { available: false, reason: k.reason };
      return {
        available: true, branch: k.branch,
        working: (k.unstaged || []).map((f) => f.path),
        staged: (k.staged || []).map((f) => f.path),
        documentsAtRisk: (k.risky || []).map((r) => ({ document: r.doc, because: r.reason || null })),
      };
    },
  },

  atlas_contrib: {
    title: 'Who did what',
    description: 'Contribution analysis from git history alone: commits per person, per week, AI-assisted ' +
      'share, and estimated effort. Call this when asked about activity or who worked on something. ' +
      'Estimated hours are inferred from gaps between commits — they measure commit rhythm, not time ' +
      'worked, and are a floor rather than a total.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: ({ root, cfg }) => {
      const c = readContrib(root, cfg);
      if (!c.available) return { available: false, reason: 'no git history' };
      return {
        available: true,
        people: (c.people || []).map((p) => ({ name: p.name, commits: p.commits, aiAssisted: p.aiAssisted || 0 })),
        weeks: (c.weeks || []).map((w) => ({ week: w.week, commits: w.commits, added: w.added, removed: w.removed })),
        // Named rather than omitted: a caller told only the numbers cannot know what they exclude.
        caveats: c.caveats || [],
      };
    },
  },

  atlas_design: {
    title: 'The design record',
    description: 'Which design artifacts exist — HLD, LLD, architecture, data flow, decision records, ' +
      'specifications, PRD, manual of style — and in what state. Call this when asked whether something ' +
      'is documented, or what the design record is missing. A "stub" is a scaffold with no substance in ' +
      'it yet and is deliberately not counted as written.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: ({ root, cfg }) => {
      const index = buildIndex(root, cfg);
      return {
        artifacts: designRecord(index.documents).map((r) => ({
          kind: r.id, label: r.label, state: r.state, documents: r.documents,
        })),
      };
    },
  },

  atlas_state: {
    title: 'What a resuming session needs',
    description: 'The continuity journal: decisions taken, traps paid for, and work in flight, recorded as ' +
      'it happened rather than summarised afterwards. Call this at the start of a session to find out what ' +
      'a previous one established. It records what was decided and touched, never what was said.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: ({ root }) => {
      const j = readJournal(root);
      if (!j.available) return { available: false, reason: 'no journal yet' };
      return {
        available: true, count: j.records.length,
        skipped: j.skipped,
        records: j.records.slice(-40).map((r) => ({
          at: r.at, kind: r.kind, text: r.text, why: r.why || null, refs: r.refs || [], by: r.by,
        })),
      };
    },
  },
};

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * Handle one JSON-RPC message. Returns the response, or `null` for a notification.
 *
 * Pure so it can be tested without a process: the transport is a loop around this, and a protocol
 * implementation that can only be exercised by spawning something is one nobody writes tests for.
 */
export function handle(msg, { root, version = '0' }) {
  if (!msg || msg.jsonrpc !== '2.0') return fail(msg?.id ?? null, -32600, 'Not a JSON-RPC 2.0 message');

  // A notification has no id and takes no response — replying to one is a protocol violation that clients
  // handle by ignoring it, which makes the mistake invisible until something stricter comes along.
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { ...SERVER_INFO, version },
        instructions:
          'Read-only access to a project-atlas corpus: documentation health, the plan, search, changes, ' +
          'contribution history, the design record, and the continuity journal. Nothing here publishes, ' +
          'pushes, or writes.',
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return isNotification ? null : ok(msg.id, {});

    case 'tools/list':
      return ok(msg.id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name, title: t.title, description: t.description, inputSchema: t.schema,
        })),
      });

    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS[name];
      // An unknown tool is a protocol error; a tool that ran and failed is a result with isError. Collapsing
      // the two would tell a caller its request was malformed when the request was fine and the repository
      // was the problem.
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const cfg = resolveConfig(root);
        const data = tool.run({ root, cfg, args: msg.params?.arguments || {} });
        const text = JSON.stringify(data, null, 2);
        return ok(msg.id, { content: [{ type: 'text', text }], structuredContent: data, isError: false });
      } catch (e) {
        return ok(msg.id, {
          content: [{ type: 'text', text: `${name} failed: ${e.message}` }],
          isError: true,
        });
      }
    }

    default:
      return isNotification ? null : fail(msg.id, -32601, `Unknown method: ${msg.method}`);
  }
}

/**
 * The stdio transport: newline-delimited JSON on stdin, the same on stdout.
 *
 * **Nothing may ever be written to stdout except protocol messages.** A stray `console.log` anywhere in a
 * code path this reaches corrupts the stream and the client sees a parse error rather than the log line —
 * which is why diagnostics here go to stderr, and why this is worth stating rather than assuming.
 */
export function serve({ root, version = '0', input = process.stdin, output = process.stdout }) {
  let buf = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(JSON.stringify(fail(null, -32700, 'Parse error')) + '\n');
        continue;
      }
      const res = handle(msg, { root, version });
      if (res) output.write(JSON.stringify(res) + '\n');
    }
  });
  input.on('end', () => process.exit(0));
}

/* ─────────────────────────────────────────────────────── the inspection surface */

/**
 * `atlas mcp --status` — what a client would connect to, and what actually has.
 *
 * `atlas mcp` with no flags is a server speaking JSON-RPC to whatever spawned it. Run by hand it prints
 * nothing and waits, which is indistinguishable from a hang, and there was no way to ask this build what it
 * exposes, which protocol revision it speaks, or whether anything on this machine has been told it exists.
 *
 * **Direction — the point the header of this file makes — decides the shape of the answer to "who is
 * connected".** A stdio server has no listening socket and no connection pool. The *client* spawns a
 * process and owns both ends of its stdin and stdout, so one process is one client for its whole life, and
 * a server nobody spawned does not exist to be counted. The honest report is therefore two different
 * things, kept apart on purpose:
 *
 *   - **Registered** — a client's config names this server, so it *can* spawn one. Read from files.
 *   - **Running** — an `atlas mcp` process is alive right now, and its parent process is, by construction,
 *     the client on the other end of it. Read from `ps`.
 *
 * Neither is a connection count and this must never present itself as one. Reporting "0 clients connected"
 * from a stdio server is the failure that matters here: it is what you get by assuming the server is a
 * daemon clients dial into, and it reads as "nothing is using this" when the truth is "nothing is using it
 * *at this instant*, and a configured client would spawn one the moment it needed to".
 */

/** What a config file turned out to be. `absent`, `read`, and `unreadable` are three states, never two. */
function readJson(file) {
  try {
    return { state: 'read', data: JSON.parse(fs.readFileSync(file, 'utf8')), detail: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', data: null, detail: null };
    // The rule the whole project holds to: a check that could not run is never reported as passing. A config
    // that exists but will not parse is precisely where a registration would hide, so collapsing it into
    // "not registered" would answer the user's question with the one thing nobody checked.
    return { state: 'unreadable', data: null, detail: e.message };
  }
}

/**
 * The places on *this* machine that can register an MCP server, and the places this build cannot see.
 *
 * Every entry here was confirmed to be the file the client actually reads before it was written down; a
 * plausible-looking path that nothing reads would make "not registered anywhere" a claim about fiction.
 * Where the location is unknown for the running platform it goes to `unchecked` rather than being guessed —
 * the report then says it did not look, which is a different sentence from "there is nothing there".
 */
export function clientConfigLocations({ root, home = os.homedir(), platform = process.platform, configDir = null }) {
  const here = path.resolve(root);
  const locations = [];
  const unchecked = [];

  locations.push({
    file: path.join(here, '.mcp.json'),
    client: 'Claude Code',
    scope: 'project — committed, so every checkout of this repository gets it',
    servers: (j) => j?.mcpServers,
  });

  // Claude Code keeps user-scope and per-project-scope servers in one file. `CLAUDE_CONFIG_DIR` relocates
  // it, and is honoured here for the same reason `readRegistrations` in atlas.mjs honours it: a machine that
  // moved its config would otherwise be told, confidently, that it has registered nothing.
  const codeConfig = path.join(configDir || home, '.claude.json');
  locations.push({
    file: codeConfig, client: 'Claude Code',
    scope: 'user — every project on this machine',
    servers: (j) => j?.mcpServers,
  });
  locations.push({
    file: codeConfig, client: 'Claude Code',
    scope: 'local — this repository only, not shared',
    servers: (j) => j?.projects?.[here]?.mcpServers,
  });

  if (platform === 'darwin') {
    locations.push({
      file: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      client: 'Claude Desktop', scope: 'the desktop app, wherever it is launched from',
      servers: (j) => j?.mcpServers,
    });
  } else {
    unchecked.push({
      what: 'Claude Desktop',
      why: `this build has only verified where that config lives on macOS, and this is ${platform}`,
    });
  }

  // Said out loud rather than left as an absence. Every client that speaks MCP keeps its own config, and the
  // list above is three files — "not registered" here means "not in these files", never "not anywhere".
  unchecked.push({
    what: 'any other MCP client',
    why: 'each keeps its own config in its own place, and this build reads only the files listed above',
  });

  return { locations, unchecked };
}

/** `--root /x` and `--root=/x` are the same flag, and a snippet in the wild may be written either way. */
function argValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return null;
}

/**
 * Every registration that looks like this tool, across the locations above.
 *
 * Two things are reported per entry that a bare "yes, registered" would hide, and both have a wrong answer
 * that looks right: a registration may point at **a different copy of atlas** than the one answering here,
 * and a registration made in user scope may serve **a different repository** — it is `--root` that decides
 * which corpus the spawned server indexes, and without it the answer is the client's working directory,
 * which is not knowable from a config file. So that field is `null`, not `false`.
 */
export function clientRegistrations({ root, pluginRoot, home = os.homedir(),
                                      platform = process.platform, configDir = null } = {}) {
  const { locations, unchecked } = clientConfigLocations({ root, home, platform, configDir });
  const here = path.resolve(root);
  const build = pluginRoot ? path.resolve(pluginRoot) : null;

  const seen = new Map();
  const looked = [];
  const found = [];

  for (const loc of locations) {
    if (!seen.has(loc.file)) {
      const r = readJson(loc.file);
      seen.set(loc.file, r);
      looked.push({ file: loc.file, client: loc.client, state: r.state, detail: r.detail });
    }
    const r = seen.get(loc.file);
    if (r.state !== 'read') continue;

    for (const [name, entry] of Object.entries(loc.servers(r.data) || {})) {
      const args = Array.isArray(entry?.args) ? entry.args.map(String) : [];
      const command = String(entry?.command || entry?.url || '');
      const line = [command, ...args].join(' ');
      if (!/atlas/i.test(name) && !/atlas/i.test(line)) continue;

      const rootArg = argValue(args, '--root');
      found.push({
        file: loc.file, client: loc.client, scope: loc.scope, name, command, args,
        servesThisRepo: rootArg ? path.resolve(rootArg) === here
          : loc.file.startsWith(here + path.sep) ? true
          : null,                        // no --root: whatever directory the client happens to launch it in
        usesThisBuild: build && line.includes(build) ? true
          : /[\\/]/.test(command) ? false
          : null,                        // a bare `atlas` comes off the client's PATH, which this cannot see
      });
    }
  }

  return { registered: found.length > 0, found, looked, unchecked };
}

/** The client on the other end of a stdio server is its parent process. That is the whole of what is knowable. */
function parentOf(ppid) {
  if (ppid <= 1) return { pid: ppid, name: null, note: 'reparented to init — whatever spawned it has exited' };
  try {
    const comm = execFileSync('ps', ['-o', 'comm=', '-p', String(ppid)],
                              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { pid: ppid, name: comm || null, note: comm ? null : 'ps named no command for it' };
  } catch {
    return { pid: ppid, name: null, note: 'gone between the two ps calls, or not visible to this user' };
  }
}

/**
 * Every `atlas mcp` process alive on this machine, whoever started it.
 *
 * Machine-wide rather than repository-scoped, deliberately: a server spawned against another checkout is
 * still a process holding this tool's name, and the confusing case worth surfacing is a client attached to
 * the *wrong* corpus. `--root` in the command line is what tells them apart, so the whole command line is
 * carried through rather than a summary of it.
 */
export function runningServers({ platform = process.platform, self = process.pid } = {}) {
  if (platform === 'win32') {
    return { checked: false, why: 'this build reads the process table with `ps`, which Windows does not have',
             processes: [] };
  }
  let table;
  try {
    table = execFileSync('ps', ['-Ao', 'pid=,ppid=,etime=,command='],
                         { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // Not "none running". A process table that could not be read is unknown, and unknown is not zero.
    return { checked: false, why: `\`ps\` would not run: ${e.message}`, processes: [] };
  }

  const processes = [];
  for (const line of table.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    if (Number(pid) === self) continue;
    if (!/(?:^|[\\/])atlas(?:\.mjs)?\s+mcp(?:\s|$)/.test(command)) continue;
    // `atlas mcp --status` matches the same pattern and is an inspector, not a server. Counting one as a
    // running server would mean this command reports itself the moment two people run it at once.
    if (/--status\b/.test(command)) continue;
    processes.push({
      pid: Number(pid), uptime: etime, command,
      client: parentOf(Number(ppid)),
    });
  }
  return { checked: true, why: null, processes };
}

/**
 * The whole status, as data. Nothing here is composed: the tool list is `TOOLS`, the version is
 * `PROTOCOL_VERSION`, the registrations are files on disk and the processes are the process table.
 */
export function connectionStatus({ root, version = '0', pluginRoot, home = os.homedir(),
                                   platform = process.platform, configDir = process.env.CLAUDE_CONFIG_DIR || null,
                                   self = process.pid }) {
  const build = pluginRoot ? path.resolve(pluginRoot) : null;
  const shim = build ? path.join(build, 'bin', 'atlas') : null;
  const usable = !!shim && fs.existsSync(shim);

  /*
   * `--root` is not decoration in this snippet.
   *
   * With no `--root`, `atlas` derives the repository from its own working directory (`repoRoot()` in
   * atlas.mjs). A client chooses that directory, and a desktop app launched from the dock does not choose
   * this repository — it inherits whatever it was started in. The server then indexes some other tree, or
   * none, and answers every question confidently about the wrong corpus. The absolute path removes the
   * question entirely, and costs a line.
   */
  const command = usable ? shim : process.execPath;
  const args = usable
    ? ['mcp', '--root', path.resolve(root)]
    : [build ? path.join(build, 'scripts', 'atlas.mjs') : 'scripts/atlas.mjs', 'mcp', '--root', path.resolve(root)];

  const registration = clientRegistrations({ root, pluginRoot, home, platform, configDir });

  return {
    server: { ...SERVER_INFO, version },
    protocolVersion: PROTOCOL_VERSION,
    transport: 'stdio',
    methods: ['initialize', 'tools/list', 'tools/call', 'ping'],
    tools: Object.entries(TOOLS).map(([name, t]) => ({ name, purpose: t.title })),
    connect: {
      command, args,
      snippet: JSON.stringify({ mcpServers: { atlas: { command, args } } }, null, 2),
      // Only files the discovery above actually reads. Naming a location this build cannot check would
      // invite the user to write a registration into a file nothing here would ever report back.
      files: registration.looked.map((l) => ({ file: l.file, client: l.client })),
    },
    registration,
    running: runningServers({ platform, self }),
  };
}

const PLAIN = new Proxy({}, { get: () => (s) => s });

/** The same status, for a person. */
export function formatConnection(st, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : PLAIN;

  const L = [];
  L.push('');
  L.push(`  ${c.bold(st.server.name)} ${st.server.version}` +
         c.dim(`  ·  MCP over ${st.transport}  ·  protocol ${st.protocolVersion}`));
  L.push(c.dim(`  ${st.methods.join(', ')} — the whole surface; read-only by construction.`));
  L.push('');

  L.push(`  ${c.bold('Tools')} ${c.dim(`(${st.tools.length})`)}`);
  for (const t of st.tools) L.push(`    ${t.name.padEnd(16)}${c.dim(t.purpose)}`);
  L.push('');

  const reg = st.registration;
  // "No" is a claim about the files that were read, and it is a weaker claim when one of them would not
  // open. Saying only "no" there is how a report ends up confidently wrong about the one file it skipped.
  const unread = reg.looked.filter((l) => l.state === 'unreadable').length;
  L.push(`  ${c.bold('Registered with a client on this machine')}   ` +
         (reg.registered ? c.green('yes')
          : unread ? c.yellow(`not in the files that could be read — ${unread} could not be`)
          : c.yellow('no — in the files below')));
  L.push('');
  for (const f of reg.found) {
    L.push(`    ${c.green('✓')} ${f.name}  ${c.dim(`${f.client} · ${f.scope}`)}`);
    L.push(c.dim(`        ${[f.command, ...f.args].join(' ')}`));
    L.push(c.dim(`        ${f.file}`));
    if (f.servesThisRepo === false) L.push(`        ${c.yellow('serves a different repository')} ${c.dim('— its --root is not this checkout')}`);
    if (f.servesThisRepo === null) L.push(c.dim('        no --root, so it indexes whichever directory the client launches it in'));
    if (f.usesThisBuild === false) L.push(`        ${c.yellow('a different copy of atlas')} ${c.dim('— not the build printing this')}`);
    if (f.usesThisBuild === null) L.push(c.dim('        resolved from the client\'s PATH, so which copy runs is not knowable here'));
  }
  if (reg.found.length) L.push('');

  L.push(c.dim('    Looked in'));
  for (const l of reg.looked) {
    // One column width across every state, including the ones below that were never opened — a report whose
    // "not checked" rows sit out of line with its "absent" rows invites the eye to skip them.
    const mark = l.state === 'unreadable' ? c.yellow('unreadable ') : c.dim(l.state.padEnd(11));
    L.push(`      ${mark} ${c.dim(l.file)}`);
    // An unreadable config is the one case where the "no" above is not an answer, so it says so here too.
    if (l.state === 'unreadable') {
      L.push(`                   ${c.yellow(`${l.detail} — a registration in this file would not have been seen`)}`);
    }
  }
  for (const u of reg.unchecked) L.push(`      ${c.yellow('not checked')} ${c.dim(`${u.what} — ${u.why}`)}`);
  L.push('');

  L.push(`  ${c.bold('To connect it')}${c.dim(`, put this in ${st.connect.files[0].file}:`)}`);
  L.push('');
  for (const line of st.connect.snippet.split('\n')) L.push(`    ${line}`);
  L.push('');
  L.push(c.dim('    The absolute --root is what stops the server indexing whatever directory the client'));
  L.push(c.dim('    happened to launch it in, which for a desktop app is not this repository.'));
  L.push('');

  const run = st.running;
  L.push(`  ${c.bold('Connected clients')}`);
  L.push('');
  if (!run.checked) {
    L.push(`    ${c.yellow('Not checked')} ${c.dim(`— ${run.why}. Not checked is not "none running".`)}`);
  } else if (!run.processes.length) {
    L.push(c.dim('    No `atlas mcp` process is running on this machine right now.'));
  } else {
    for (const p of run.processes) {
      L.push(`    pid ${String(p.pid).padEnd(7)}${c.dim(`up ${p.uptime}`)}`);
      L.push(`      client  ${p.client.name || c.yellow(p.client.note)}${c.dim(p.client.name ? `  (pid ${p.client.pid})` : '')}`);
      L.push(c.dim(`      ${p.command}`));
    }
  }
  L.push('');
  // The distinction this whole section exists to hold. A stdio server that printed "0 clients connected"
  // would be describing a connection pool it does not have, and the number would mean nothing it implies.
  L.push(c.dim('    A stdio server has no connection pool, so this is not a count of connections. The client'));
  L.push(c.dim('    spawns one process per connection and owns both ends of its stdin and stdout — so a live'));
  L.push(c.dim('    process IS one client, and its parent above IS that client.'));
  L.push('');
  L.push(c.dim('    Knowable: which processes exist, how long each has run, what spawned it, which repository'));
  L.push(c.dim('    it was pointed at. Not knowable from here: whether a live process has finished a handshake'));
  L.push(c.dim('    or is merely idle, which of its tools a client has ever called, and anything at all about a'));
  L.push(c.dim('    client on another machine. Those are unknown, not zero.'));
  L.push('');
  return L.join('\n');
}
