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
