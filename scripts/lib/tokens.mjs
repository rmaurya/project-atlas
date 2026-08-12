/**
 * project-atlas · token accounting
 *
 * **This module reads a different kind of source from everything else in the tool, and the difference is the
 * whole design.**
 *
 * Every other number project-atlas reports is derived from the repository: reproducible from a clone, shared
 * with the team, versioned. These are derived from **local Claude Code session transcripts** — which are
 * none of those things. They are machine-local, unversioned, gone if the user clears them, and they contain
 * **every prompt, every file read, and every secret that passed through a session**.
 *
 * So four rules, enforced here rather than documented elsewhere:
 *
 *  1. **Read only by the two surfaces that show them, and only when they are asked for.** This rule used to
 *     read "nothing reads transcripts unless `atlas tokens` is run", and C-10 made that false: the Economics
 *     view puts the attribution on a page, so a build that renders that view calls `readTokenEconomics`, and
 *     `atlas watch` builds on every save. Leaving the sentence up would have been the worse outcome — a rule
 *     nobody can check is not a rule — so it says what is true. **Nothing else opens the store**: not `scan`,
 *     not `health` (H17 is fed an aggregate by its caller and reads nothing itself), not a hook, not `serve`,
 *     and not a build of a site whose views do not include Economics — `dashboard.mjs` resolves the reader
 *     only when a panel on the page asks for it.
 *
 *     It is still safe, and for reasons that are enforced rather than asserted. The read is **one-way and
 *     counts-only**: `classifyWrite` is the only function that sees a path and it returns one of five words,
 *     so no path, prompt or message text survives it. The panel carries `data-local-only` and `stripLocalOnly`
 *     removes it on both exit doors. Nothing reaches disk unless `atlas tokens --snapshot` is run with
 *     `tokens.snapshot` set — no build writes the snapshot, and a test asserts it.
 *
 *     And it is **cheap when there is nothing to read**, which is the property a per-save build actually needs:
 *     `hasTranscripts()` stats one directory, and the reader returns unavailable-with-a-reason before it lists
 *     a file, opens the task log or shells out to git. With a store present it costs one streaming pass —
 *     88 MB across 26 transcripts in about 1.2s on the machine this was written on — paid once per build, not
 *     once per panel. `surviving.mjs` is opt-in because a slow build is a build nobody runs twice; this is the
 *     same concern answered by making the empty case free rather than by making the feature opt-in.
 *  2. **Never published.** `assertNotPublishable()` refuses to write a report into any directory the tool
 *     publishes from. A token report in a wiki is a prompt log in a wiki.
 *  3. **Aggregate only.** Counts, sums and model names. Never prompt text, never a file path that was read,
 *     never a session title.
 *  4. **No invented cost.** Prices change and are not in the transcript. Cost appears only when rates are
 *     configured, and the report states the rates and the date they were entered.
 *
 * ## What the numbers mean
 *
 * The split matters more than the total. A turn re-reads its whole context, so `cacheRead` dominates every
 * real session and is charged at a fraction of fresh input. Reporting one "tokens" figure would make a
 * cheap session look like an expensive one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { isAtOrInside } from './paths.mjs';
import { matchesAny } from './config.mjs';
import { readContrib } from './contrib.mjs';
import { num } from './format.mjs';

export const DEFAULT_TOKENS = {
  transcriptRoot: null,          // defaults to ~/.claude/projects
  since: null,                   // ISO date; omit for everything
  rates: null,                   // { model: { input, output, cacheWrite, cacheRead } } per million tokens
  ratesAsOf: null,               // the date those rates were correct — printed with any cost figure
  // C-10. Off by default and it stays off by default: the snapshot is the one path by which anything derived
  // from a transcript reaches a commit, so it is opted into once, in writing, by the repository owner.
  snapshot: false,
  snapshotFile: '.atlas/tokens.jsonl',
  // What counts as a test for the per-kind split. The rest of the taxonomy comes from the configured clusters
  // and the plan source; there is no existing "these are the tests" setting in the config, so this is it.
  testGlobs: ['tests/**', 'test/**', 'spec/**', '**/__tests__/**', '**/__test__/**',
              '**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/*-test.*'],
  // How long a silence has to be before the next turn is a different sitting. See DEFAULT_SITTING_GAP_MINUTES.
  sittingGapMinutes: 5,
};

/**
 * **Five minutes, and it is measured rather than chosen.**
 *
 * A turn is attributed to the kind of work of the *run* it belongs to, not to whatever it happened to write
 * by itself, and a run ends at a silence long enough to be a different sitting. That threshold decides how far
 * one write is allowed to speak, so it is picked from the distribution of the gaps themselves, the way H17's
 * 40-edit threshold is picked from the edit counts of the sessions that fanned out.
 *
 * Measured over the **8,319 gaps between consecutive assistant turns** in this repository's own store (26
 * transcripts, 88 MB, four days): the median gap is **6.2 seconds**, 88% are under 30 seconds, **94% are under
 * a minute**, and the 99th percentile is 3.5 minutes. Five minutes is the **99.4th percentile** — it cuts
 * **53 of 8,319 gaps**. What is above it is not a pause: 25 gaps exceed ten minutes, eight exceed half an
 * hour, and the largest six are 2.0, 3.4, 5.3, 8.6 and 12.0 hours — nights and days off, not thinking.
 *
 * The two neighbours were measured too, on the same store, by the share of output left in `other`:
 *
 *  - **2 minutes** cuts 198 gaps and leaves `other` at **23.4%**, because an ordinary long tool call — a test
 *    run, a build, a large read — ends a run that plainly did not end. The threshold would be measuring the
 *    machine's latency, not the operator's attention.
 *  - **5 minutes** leaves `other` at **7.7%**.
 *  - **30 minutes** leaves it at **4.3%**, and buys that last three points by letting a single write account
 *    for work done half an hour on either side of it. That is a claim the data does not support.
 *
 * So the number is the point where the curve has already flattened and the remaining gaps are recognisably
 * breaks. Override it with `tokens.sittingGapMinutes`; the figure in force is printed in the caveats, with the
 * count of runs it produced in *this* store, so a repository whose rhythm differs can see that it does.
 */
export const DEFAULT_SITTING_GAP_MINUTES = 5;

/**
 * ~/.claude/projects/<slug>, where the slug is the absolute path with separators replaced by hyphens.
 *
 * The drive colon has to go too. `C:\Users\me\proj` split on the separator keeps its colon — `C:-Users-me-proj`
 * — and a colon is not legal in a Windows path component, so every read of the store failed at mkdir with
 * ENOENT. That reads as "no transcripts here", which is indistinguishable from the honest empty case and is
 * why it went unnoticed: `atlas tokens` on Windows reported nothing to account for, and nothing is exactly
 * what it would say if the store were genuinely empty. Replacing it yields `C--Users-me-proj`, which is the
 * name the transcripts are actually written under.
 */
export function transcriptDir(root, cfg = {}) {
  const base = cfg.tokens?.transcriptRoot || path.join(os.homedir(), '.claude', 'projects');
  const slug = path.resolve(root).split(path.sep).join('-').replace(/:/g, '-');
  return path.join(base, slug);
}

/**
 * Refuse to write a report anywhere the tool publishes from. The output directory is pushed to wikis and
 * Pages branches; a token report there is a prompt log there.
 *
 * **This is the only mechanism enforcing rule 2 above**, which is why it is no longer a string comparison.
 * `abs.startsWith(out + sep)` was walked past two ways, both verified:
 *
 *  - `DOCS/_WIKI/t.txt` on macOS or Windows. The filesystem resolves it to the published directory; a
 *    case-sensitive `startsWith` says it is somewhere else entirely.
 *  - A symlink whose target is inside the output directory. The lexical path never mentions it.
 *
 * `isAtOrInside` resolves both sides through `realpath` and folds case where the platform does. A refusal that
 * can be sidestepped by holding down shift is not a refusal.
 */
export function assertNotPublishable(root, cfg, dest) {
  const out = path.resolve(root, cfg.output || 'docs/_wiki');
  const abs = path.resolve(root, dest);
  if (isAtOrInside(out, abs)) {
    throw new Error(
      `Refusing to write a token report into ${cfg.output} — that directory is published to wikis and Pages ` +
      `branches, and this report is derived from session transcripts. Choose a path outside it.`);
  }
}

/* ------------------------------------------------------------------ reading */

/**
 * Every transcript in the store — **including the subagent ones, which a flat read of the directory misses.**
 *
 * A session writes `<store>/<session-id>.jsonl`. A subagent it spawns writes
 * `<store>/<session-id>/subagents/agent-<id>.jsonl`, one directory down, and the original
 * `readdirSync(dir).filter(f => f.endsWith('.jsonl'))` never descended. Measured on this repository's own
 * store: **20 files, 4,569 records and 1,085,725 output tokens invisible** to every figure this module
 * produced. Worse than a shortfall, it was a shortfall in exactly one direction — every token a subagent
 * spent — so the main-versus-subagent axis C-10 and C-11 are built on read a flat zero, and read it as a
 * fact rather than as a directory that was never opened.
 *
 * The `.meta.json` beside each subagent transcript is **deliberately not read**. It carries the agent's
 * `description`, which is the prompt in miniature, and nothing here needs it: `agentId` is on every record
 * of the transcript itself.
 */
export function transcriptFiles(dir) {
  const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }

  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      const st = stat(p);
      if (st?.size) out.push({ name: e.name, path: p, size: st.size, subagent: false });
      continue;
    }
    if (!e.isDirectory()) continue;
    const sub = path.join(p, 'subagents');
    let kids;
    try { kids = fs.readdirSync(sub); } catch { continue; }
    for (const k of kids) {
      // `.meta.json` is skipped by the extension test, and that is on purpose — see above.
      if (!k.endsWith('.jsonl')) continue;
      const kp = path.join(sub, k);
      const st = stat(kp);
      if (st?.size) out.push({ name: k, path: kp, size: st.size, subagent: true });
    }
  }
  return out;
}

/**
 * Is there anything here to read at all — answered with one `statSync` and nothing else.
 *
 * **This is the cheap door in front of rule 1.** `readTokenEconomics` runs on every build that renders the
 * Economics view, which on `atlas watch` is every save, and the overwhelmingly common case on a fresh clone or
 * a CI runner is a store that does not exist. That case must cost a stat, not a directory walk, not a read of
 * the task log, and above all not a `git log` — `readContrib` shells out, and paying for it to discover there
 * were no transcripts is how a build becomes something nobody runs twice.
 *
 * Separate and exported so the property is testable as a property, rather than inferred from a stopwatch.
 */
export function hasTranscripts(root, cfg = {}) {
  const dir = transcriptDir(root, cfg);
  let st;
  try { st = fs.statSync(dir); } catch { st = null; }
  if (!st?.isDirectory()) {
    return { present: false, dir,
      reason: `No session transcripts for this repository at ${dir}.` };
  }
  return { present: true, dir, reason: null };
}

export async function readTokens(root, cfg = {}, { onProgress } = {}) {
  const t = { ...DEFAULT_TOKENS, ...(cfg.tokens || {}) };
  const probe = hasTranscripts(root, cfg);
  const dir = probe.dir;

  if (!probe.present) return { available: false, reason: probe.reason, dir };
  const files = transcriptFiles(dir).sort((a, b) => b.size - a.size);

  if (!files.length) return { available: false, reason: `No .jsonl transcripts in ${dir}.`, dir };
  const subagentFiles = files.filter((f) => f.subagent).length;

  const sinceMs = t.since ? Date.parse(t.since) : null;
  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
  const byModel = new Map();
  const bySession = [];
  const byDay = new Map();
  const tools = new Map();
  let skippedLines = 0, outOfRange = 0;

  // Outcome signals, collected in the same pass. Named for what they observe, never for what they imply.
  const oc = { typedPrompts: 0, queuedPrompts: 0, assistantTurns: 0, interruptions: 0,
               compactions: 0, toolResults: 0, toolErrors: 0, userModifiedEdits: 0, sessions: 0 };

  for (const [i, f] of files.entries()) {
    onProgress?.(`  reading ${i + 1}/${files.length}  ${(f.size / 1048576).toFixed(0)} MB`);
    const s = { file: f.name.replace(/\.jsonl$/, '').slice(0, 8), subagent: f.subagent,
      bytes: f.size, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0, first: null, last: null };
    // A subagent transcript is not a session, so it must not increment the session count. The old test —
    // `s.messages || oc.assistantTurns` — read a *global* accumulator, so once any file had produced an
    // assistant turn every later file counted as a session whether it held anything or not. That was
    // survivable while the store was four files; it is not now that it is twenty-four.
    let fileTurns = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(f.path), crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { skippedLines++; continue; }

      // Tool names only — never arguments, never results.
      const content = j.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use' && c.name) tools.set(c.name, (tools.get(c.name) || 0) + 1);
          if (c?.type === 'tool_result') { oc.toolResults++; if (c.is_error) oc.toolErrors++; }
        }
      }
      if (j.type === 'assistant') { oc.assistantTurns++; fileTurns++; }
      if (j.promptSource === 'typed') oc.typedPrompts++;
      else if (j.promptSource === 'queued') oc.queuedPrompts++;
      if (j.interruptedMessageId) oc.interruptions++;
      if (j.isCompactSummary) oc.compactions++;
      if (j.toolUseResult && j.toolUseResult.userModified) oc.userModifiedEdits++;

      const u = j.message?.usage || j.usage;
      if (!u) continue;
      const ts = j.timestamp ? Date.parse(j.timestamp) : null;
      if (sinceMs && ts && ts < sinceMs) { outOfRange++; continue; }

      const rec = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
      };
      for (const k of ['input', 'output', 'cacheWrite', 'cacheRead']) { totals[k] += rec[k]; s[k] += rec[k]; }
      totals.messages++; s.messages++;

      const model = j.message?.model || j.model || 'unknown';
      const m = byModel.get(model) || { model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
      for (const k of ['input', 'output', 'cacheWrite', 'cacheRead']) m[k] += rec[k];
      m.messages++;
      byModel.set(model, m);

      if (ts) {
        const day = new Date(ts).toISOString().slice(0, 10);
        const d = byDay.get(day) || { day, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
        for (const k of ['input', 'output', 'cacheWrite', 'cacheRead']) d[k] += rec[k];
        d.messages++;
        byDay.set(day, d);
        if (!s.first || ts < s.first) s.first = ts;
        if (!s.last || ts > s.last) s.last = ts;
      }
    }
    if (!f.subagent && (s.messages || fileTurns)) oc.sessions++;
    if (s.messages) bySession.push({ ...s, first: s.first && new Date(s.first).toISOString().slice(0, 10), last: s.last && new Date(s.last).toISOString().slice(0, 10) });
  }

  const billable = totals.input + totals.output + totals.cacheWrite + totals.cacheRead;
  return {
    available: true, dir,
    files: files.length,
    subagentFiles,
    bytes: files.reduce((n, f) => n + f.size, 0),
    totals,
    billable,
    cacheHitRatio: billable ? Math.round((totals.cacheRead / billable) * 1000) / 10 : 0,
    byModel: [...byModel.values()].sort((a, b) => b.output - a.output),
    bySession: bySession.sort((a, b) => b.output - a.output),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    tools: [...tools.entries()].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
    outcomes: {
      ...oc,
      turnsPerPrompt: oc.typedPrompts ? Math.round((oc.assistantTurns / oc.typedPrompts) * 10) / 10 : null,
      toolErrorRate: oc.toolResults ? Math.round((oc.toolErrors / oc.toolResults) * 1000) / 10 : null,
      interruptionRate: oc.typedPrompts ? Math.round((oc.interruptions / oc.typedPrompts) * 1000) / 10 : null,
    },
    cost: estimateCost(byModel, t),
    notChecked: notChecked(t, skippedLines, outOfRange, subagentFiles),
  };
}

/**
 * Cost only when rates are configured. Prices are not in the transcript, they change, and a plausible-looking
 * number nobody can source is worse than no number — the same rule the rest of the tool follows.
 */
function estimateCost(byModel, t) {
  if (!t.rates) return { available: false, reason: 'No rates configured (tokens.rates), so no cost is shown. Prices are not in the transcript and change over time.' };
  let total = 0;
  const rows = [];
  const unpriced = [];
  for (const m of byModel.values()) {
    const r = t.rates[m.model];
    if (!r) { unpriced.push(m.model); continue; }
    const usd = (m.input * (r.input || 0) + m.output * (r.output || 0) +
                 m.cacheWrite * (r.cacheWrite || 0) + m.cacheRead * (r.cacheRead || 0)) / 1e6;
    total += usd;
    rows.push({ model: m.model, usd: Math.round(usd * 100) / 100 });
  }
  return {
    available: true, total: Math.round(total * 100) / 100, rows, unpriced,
    asOf: t.ratesAsOf || null,
  };
}

function notChecked(t, skippedLines, outOfRange, subagentFiles = 0) {
  const out = [];
  out.push('Derived from local session transcripts, not from the repository. They are machine-local, unversioned, and gone if cleared — these figures are not reproducible from a clone.');
  out.push(subagentFiles
    ? `${subagentFiles} subagent transcript(s) are included. They live one directory down, under <session>/subagents/, and were read by nothing here until C-10 — every token they spent used to be missing from these totals.`
    : 'No subagent transcript is present in this store. A subagent given its own git worktree runs under a different working directory and writes to a different store entirely, so absence here is not evidence that nothing was fanned out.');
  if (skippedLines) out.push(`${skippedLines} unparseable line(s) were skipped.`);
  if (outOfRange) out.push(`${outOfRange} message(s) fall before tokens.since and are excluded.`);
  if (!t.rates) out.push('No cost is shown because no rates are configured.');
  out.push('Tool figures are CALL COUNTS, not token attribution — a transcript records which tool ran, not how many tokens its result occupied.');
  return out;
}

/* ------------------------------------------------------------------ report */

const M = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

export function formatTokens(k, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  if (!k.available) return `No token data: ${k.reason}`;

  const t = k.totals;
  const pct = (n) => `${((n / k.billable) * 100).toFixed(1)}%`.padStart(6);
  const L = [];

  L.push(c.bold(`${M(k.billable)} tokens across ${num(t.messages)} assistant message(s)`));
  L.push(c.dim(`${k.files} transcript(s), ${(k.bytes / 1048576).toFixed(0)} MB — local session history, not the repository`));
  L.push('');
  L.push(c.bold('Where they went'));
  L.push(`  cache read    ${M(t.cacheRead).padStart(7)}  ${pct(t.cacheRead)}  ` + c.dim('context re-read each turn — the cheap rung'));
  L.push(`  cache write   ${M(t.cacheWrite).padStart(7)}  ${pct(t.cacheWrite)}  ` + c.dim('context written to cache — the expensive rung'));
  L.push(`  fresh input   ${M(t.input).padStart(7)}  ${pct(t.input)}  ` + c.dim('never cached'));
  L.push(`  output        ${M(t.output).padStart(7)}  ${pct(t.output)}  ` + c.dim('what was actually generated'));
  L.push('');
  L.push(c.dim(`  Cache read is ${k.cacheHitRatio}% of all tokens. A single "tokens used" figure would treat that`));
  L.push(c.dim('  as equal to fresh input, which is what makes a cheap session look expensive.'));

  if (k.byModel.length) {
    L.push('');
    L.push(c.bold('By model'));
    for (const m of k.byModel) {
      L.push(`  ${M(m.output).padStart(7)} out  ${M(m.cacheRead).padStart(7)} cached  ${String(m.messages).padStart(5)} msg   ${m.model}`);
    }
  }

  if (k.byDay.length) {
    L.push('');
    L.push(c.bold('By day') + c.dim(`  (${k.byDay.length})`));
    for (const d of k.byDay.slice(-10)) {
      L.push(`  ${d.day}  ${M(d.output).padStart(7)} out  ${M(d.cacheRead).padStart(7)} cached  ${String(d.messages).padStart(5)} msg`);
    }
  }

  if (k.tools.length) {
    L.push('');
    L.push(c.bold('Tool calls') + c.dim('  counts, not token attribution'));
    for (const t2 of k.tools.slice(0, 12)) L.push(`  ${String(t2.calls).padStart(6)}  ${t2.name}`);
  }

  L.push('');
  if (k.cost.available) {
    L.push(c.bold(`Estimated cost  $${k.cost.total}`) + c.dim(k.cost.asOf ? `  at rates entered ${k.cost.asOf}` : '  (rates undated)'));
    for (const r of k.cost.rows) L.push(`  $${String(r.usd).padStart(8)}  ${r.model}`);
    if (k.cost.unpriced.length) L.push(c.yellow(`  ${k.cost.unpriced.length} model(s) have no rate and are excluded: ${k.cost.unpriced.join(', ')}`));
  } else {
    L.push(c.dim(`Cost: ${k.cost.reason}`));
  }

  L.push('');
  L.push(c.bold('Read these with the caveats'));
  for (const n of k.notChecked) L.push(c.dim('  · ' + n));
  return L.join('\n');
}

/* ------------------------------------------------------------------ session outcomes */

/**
 * What the transcripts say about how sessions went — **not** how good the prompts were.
 *
 * The distinction is the whole point and it survives the richer source. A transcript records what happened
 * after a prompt; it does not record whether the prompt was well judged. Every figure below is named for the
 * thing it observes, and none is combined into a score.
 *
 * Read them as questions. A high tool-error rate might be a flaky environment. A high turns-per-prompt might
 * be one large well-scoped request rather than a misunderstood small one. The numbers narrow where to look;
 * they do not conclude.
 */
export function formatSessions(k, contrib, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  if (!k.available) return `No session data: ${k.reason}`;
  const o = k.outcomes;
  const L = [];

  L.push(c.bold(`${num(o.typedPrompts)} typed prompt(s) across ${o.sessions} session(s)`));
  L.push(c.dim(`${num(o.assistantTurns)} assistant turns · ${num(o.toolResults)} tool results`));
  L.push('');

  L.push(c.bold('Interaction'));
  L.push(`  turns per typed prompt   ${String(o.turnsPerPrompt ?? '—').padStart(7)}  ` + c.dim('work done per instruction — high can mean a big request, not a misread one'));
  L.push(`  queued prompts           ${String(o.queuedPrompts).padStart(7)}  ` + c.dim('sent while a turn was already running'));
  L.push(`  interruptions            ${String(o.interruptions).padStart(7)}  ` + c.dim(`${o.interruptionRate ?? '—'}% of typed prompts — a turn stopped mid-flight`));
  L.push(`  compactions              ${String(o.compactions).padStart(7)}  ` + c.dim('sessions that outgrew their window — a proxy for scope not being split'));
  L.push('');

  L.push(c.bold('Friction'));
  L.push(`  tool error rate          ${String(o.toolErrorRate ?? '—').padStart(6)}%  ` + c.dim(`${o.toolErrors} of ${o.toolResults} tool results failed`));
  L.push(`  human-edited results     ${String(o.userModifiedEdits).padStart(7)}  ` + c.dim('a file was changed by hand after being written — a direct correction'));

  if (contrib?.available) {
    const q = contrib.quality;
    const fixes = contrib.commits.filter((x) => /^fix(\(|:)/i.test(x.subject)).length;
    const feats = contrib.commits.filter((x) => /^feat(\(|:)/i.test(x.subject)).length;
    L.push('');
    L.push(c.bold('Outcomes in the repository') + c.dim('  from git, not from transcripts'));
    L.push(`  rework rate              ${String(q.reworkRate).padStart(6)}%  ` + c.dim(`a file re-touched within ${q.reworkWindowDays} days`));
    L.push(`  revert rate              ${String(q.revertRate).padStart(6)}%  ` + c.dim(`${q.reverts} revert commit(s)`));
    L.push(`  fix / feat               ${String(fixes).padStart(3)} / ${String(feats).padEnd(3)}  ` + c.dim('subjects typed fix: against feat:'));
  }

  L.push('');
  L.push(c.bold('What this does not measure'));
  L.push(c.dim('  · Prompt quality. A transcript records what happened after a prompt, not whether the prompt was'));
  L.push(c.dim('    well judged. Nothing here is a proxy for that, and none of it is combined into a score.'));
  const authors = contrib?.available ? contrib.people.length : 0;
  if (authors === 1) {
    L.push(c.dim('  · Per-contributor comparison. This repository has one git author, so a per-person breakdown'));
    L.push(c.dim('    would be a table of one. It becomes meaningful with a Desk: trailer or more committers.'));
  }
  L.push(c.dim('  · Difficulty. A turn on a hard problem and a turn on a typo count the same.'));
  for (const n of k.notChecked) L.push(c.dim('  · ' + n));
  return L.join('\n');
}

/* ================================================================== economics (C-10)
 *
 * `readTokens` above answers *how much*. Everything left is a **join** — what a task cost, what a day of
 * rework cost against a day of new work, what planning cost against coding, how much ran in a subagent — and
 * `docs/specs/token-economics.md` fixes the shape those joins return so that three workstreams building on
 * them agree on one.
 *
 * ## Three properties this code exists to hold
 *
 * **1. It never double-counts.** Task windows overlap: at any moment several items are open, and a turn that
 * happened while three were open belongs a third to each. The naive join gives each open task the whole turn
 * and produces a per-task table summing to three times the real total — a number that looks authoritative,
 * reconciles against nothing, and is wrong in the direction that flatters. So a turn attributed to *n* open
 * windows contributes `1/n` to each, and any task whose window overlapped another carries `partial: true` so
 * a reader knows the figure is a share and not a measurement.
 *
 * **2. It retains no path and no text.** A written path is read, turned into one of five words, and dropped
 * on the same line. Nothing downstream of `classifyWrite` has ever seen a path. The snapshot — the only thing
 * here that reaches a commit — carries integers and a date, nothing else.
 *
 * **3. It does not invent a second definition of rework.** `contrib.mjs` already says what rework is (a file
 * re-touched inside its window) and now publishes that verdict per day; this joins to it. Two answers to one
 * question is precisely the drift this tool exists to detect, and shipping one inside the tool would be
 * embarrassing.
 *
 * ## Why this one is synchronous when `readTokens` is not
 *
 * `readTokens` streams because it only ever had one caller, and that caller is a command. This has three: a
 * command, a dashboard panel and a health signal — and `renderSite`, `buildIndex` and `runHealth` are all
 * synchronous. An async reader would have forced the whole render path to grow an `await`, or forced the
 * panel to be fed from outside, which is how a view ends up with a data source nothing else can check. It
 * still reads in 1 MB chunks rather than slurping the file: these transcripts run to tens of megabytes each.
 */

/** The five kinds, in a fixed order so every consumer renders them the same way. */
export const WORK_KINDS = ['planning', 'coding', 'testing', 'documentation', 'other'];

/**
 * Read a JSONL file line by line, synchronously, without holding the whole file in memory.
 *
 * `StringDecoder` rather than `buf.toString()` per chunk: a multi-byte character straddling a 1 MB boundary
 * decodes to two replacement characters otherwise, which corrupts the JSON on that line and turns a real
 * record into a skipped one. The count of skipped lines is reported, so the failure would have been visible —
 * as an unexplained number, which is worse than either a crash or a correct read.
 */
function* jsonlLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    const dec = new StringDecoder('utf8');
    let carry = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      carry += dec.write(buf.subarray(0, n));
      let i;
      while ((i = carry.indexOf('\n')) !== -1) {
        const line = carry.slice(0, i);
        carry = carry.slice(i + 1);
        if (line.trim()) yield line;
      }
    }
    carry += dec.end();
    if (carry.trim()) yield carry;
  } finally {
    fs.closeSync(fd);
  }
}

/** The `usage` block, wherever the record carries it. One reader, so this and `readTokens` cannot disagree. */
export function usageOf(rec) {
  const u = rec?.message?.usage || rec?.usage;
  if (!u) return null;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

/**
 * The path a turn **wrote**, or null.
 *
 * Verified against this repository's own transcripts: a top-level `toolUseResult.filePath` is produced by
 * `Edit` and `Write` and by nothing else — a `Read` puts its path at `toolUseResult.file.filePath`, one level
 * down, and is deliberately not matched here. Counting reads as writes would classify a turn that read a test
 * and changed a source file as testing.
 *
 * The return value is consumed by `classifyWrite` and discarded on the same line. It is never stored.
 */
function writtenPathOf(rec) {
  const r = rec?.toolUseResult;
  if (r && typeof r === 'object' && typeof r.filePath === 'string' && r.filePath) return r.filePath;
  if (typeof rec?.trackingPath === 'string' && rec.trackingPath) return rec.trackingPath;
  return null;
}

/**
 * One written path → one of five words. **This is the only function in the module that sees a path**, and it
 * returns a word.
 *
 * Precedence is testing → planning → documentation → coding, and the order is not the order the contract
 * lists them in. Taken literally — documentation before planning — the plan file is markdown inside a cluster,
 * so it resolves as documentation and the "planning is the plan file" clause never fires for any repository
 * that keeps its plan in markdown, which is all of them. Naming a specific file and then having a general
 * rule swallow it is the same defect the cluster taxonomy fixed by putting filename rules before directory
 * rules. Recorded in the report as an amendment rather than applied silently.
 *
 * Returns `null` for a write outside the repository — a scratch file in a temp directory is a real write and
 * is not this repository's coding.
 */
export function classifyWrite(p, root, cfg = {}) {
  const t = { ...DEFAULT_TOKENS, ...(cfg.tokens || {}) };
  let rel = p;
  if (path.isAbsolute(p)) {
    rel = path.relative(path.resolve(root), p);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  }
  rel = rel.split(path.sep).join('/').replace(/^\.\//, '');

  if (matchesAny(rel, t.testGlobs)) return 'testing';

  const planSource = (cfg.planning?.source || '').split(path.sep).join('/');
  if (planSource && rel === planSource) return 'planning';
  if (rel.startsWith('.atlas/journal/') || rel === '.atlas/tasks-live.jsonl') return 'planning';

  // "Resolves to a document cluster" in the contract; in practice the question a cluster answers is *which*
  // document this is, and the question here is *whether* it is one — so this is the corpus test the rest of
  // the tool uses, which is what decides whether a cluster is ever consulted at all.
  if (matchesAny(rel, cfg.include || ['**/*.md']) && !matchesAny(rel, cfg.exclude || [])) return 'documentation';

  return 'coding';
}

/**
 * Task windows, replayed from `.atlas/tasks-live.jsonl` — the same append-only log the in-flight panel folds,
 * read the same way: later records win field by field, and a torn last line is skipped rather than fatal.
 *
 * A window opens at the `create` record and closes at the **first** update carrying `status: "completed"`.
 * First, not last: a task reopened and completed again would otherwise absorb every turn in the gap, which is
 * the period it was explicitly not being worked on.
 */
export function taskWindows(root) {
  const file = path.join(root, '.atlas', 'tasks-live.jsonl');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch {
    return { available: false, items: [], dropped: 0, undated: 0,
      reason: 'No `.atlas/tasks-live.jsonl` in this repository, so no turn can be attributed to a task. ' +
              'That file is written by hooks/on-task.sh as a session\'s task list changes.' };
  }

  const by = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r?.id) continue;
    const id = String(r.id);
    const prev = by.get(id) || { id, subject: null, status: 'pending', opened: null, closed: null };
    if (!prev.opened && r.at) prev.opened = r.at;
    if (r.subject != null) prev.subject = r.subject;
    if (r.status != null) prev.status = r.status;
    if (r.status === 'completed' && !prev.closed && r.at) prev.closed = r.at;
    by.set(id, prev);
  }

  const all = [...by.values()];
  // A task the harness deleted is dropped, the same call inflight.mjs makes — but counted, because dropping
  // it changes the denominator of every 1/n split in its window.
  const items = all.filter((x) => x.status !== 'deleted');
  const dated = items.filter((x) => x.opened && Number.isFinite(Date.parse(x.opened)));
  return {
    available: true, reason: null,
    items: dated,
    dropped: all.length - items.length,
    undated: items.length - dated.length,
  };
}

/** An interval per task, with `partial` set on any window that overlaps another. Exported for the test. */
export function overlapWindows(items) {
  const w = items.map((t) => ({
    ...t,
    openMs: Date.parse(t.opened),
    closeMs: t.closed ? Date.parse(t.closed) : Infinity,
    partial: false,
    output: 0, cacheRead: 0, messages: 0,
  }));
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length; j++) {
      if (w[i].openMs <= w[j].closeMs && w[j].openMs <= w[i].closeMs) { w[i].partial = true; w[j].partial = true; }
    }
  }
  return w;
}

/**
 * **The contiguous-run rule, as one function, used on both axes.**
 *
 * The contract's first attempt classified each turn by what *that turn* wrote, and measured on this
 * repository's own store it put **83.4% of all output in `other`** — not because the work was unclassifiable
 * but because the overwhelming majority of turns read, search, reason or run a command and write no file. A
 * chart of that is one bar and four slivers, and `other` had come to mean "did not happen to write a file this
 * turn", which is a fact about the shape of a transcript rather than about the work.
 *
 * So a turn is attributed to the run it belongs to. Given an ordered list of turns and a predicate saying
 * which of them carry an attribution of their own, this returns, for each turn, the index of the turn whose
 * attribution it takes — or `-1` when the whole run carries none, which is the only honest `other`.
 *
 *  - **A run ends at a silence longer than `gapMs`.** Nothing inherits across a break; see
 *    `DEFAULT_SITTING_GAP_MINUTES` for where the number comes from.
 *  - **Inside a run, a turn takes the *nearest* attribution in time**, forwards or backwards, and a tie goes
 *    to the earlier one so the answer does not depend on iteration order. Nearest rather than previous
 *    because the reading and reasoning that *precede* a write are that write's work as much as the checking
 *    that follows it; forward-fill alone would leave the head of every run in `other` for no better reason
 *    than that it came first. Nearest is also what makes "a run ends when the kind changes" fall out rather
 *    than needing a second rule: between two writes of different kinds the boundary lands midway, and each
 *    write speaks for the turns on its own side of it.
 *
 * Both axes use it — the kind of work, and which task window a turn falls in — because they are the same
 * question asked of two attributions, and two implementations of one rule is the drift this tool exists to
 * detect.
 */
export function runAnchors(turns, gapMs, hasAnchor) {
  const n = turns.length;
  const anchor = new Array(n).fill(-1);
  if (!n) return anchor;

  // How far apart two turns are. Time when both are dated; otherwise the answer is "unknown", and an anchor
  // that can be measured is preferred to one that cannot rather than the two being compared in mixed units.
  const apart = (a, b) => (a.ts !== null && a.ts !== undefined && b.ts !== null && b.ts !== undefined
    ? Math.abs(b.ts - a.ts) : null);

  const segment = (from, to) => {
    // Forward: the nearest anchor at or before each index.
    let p = -1;
    for (let i = from; i < to; i++) { if (hasAnchor(turns[i])) p = i; anchor[i] = p; }
    // Backward: the nearest anchor at or after it, resolved against the forward answer as we go.
    let q = -1;
    for (let i = to - 1; i >= from; i--) {
      if (hasAnchor(turns[i])) { q = i; anchor[i] = i; continue; }
      const a = anchor[i], b = q;
      if (a < 0 && b < 0) { anchor[i] = -1; continue; }
      if (a < 0) { anchor[i] = b; continue; }
      if (b < 0) { anchor[i] = a; continue; }
      const da = apart(turns[i], turns[a]), db = apart(turns[i], turns[b]);
      if (da === null && db === null) anchor[i] = (i - a <= b - i) ? a : b;
      else if (da === null) anchor[i] = b;
      else if (db === null) anchor[i] = a;
      else anchor[i] = db < da ? b : a;
    }
  };

  let from = 0, cuts = 0;
  for (let i = 1; i <= n; i++) {
    const broke = i === n
      || (turns[i].ts != null && turns[i - 1].ts != null && turns[i].ts - turns[i - 1].ts > gapMs);
    if (!broke) continue;
    if (i < n) cuts++;
    segment(from, i);
    from = i;
  }
  anchor.cuts = cuts;                     // how many silences ended a run, reported in the caveats
  anchor.runs = cuts + 1;
  return anchor;
}

const emptyEconomics = (reason) => ({
  available: false, reason,
  // Not zeros. A zero here is a claim that nothing was spent, and the claim being made is that nothing is
  // known — so every figure is absent and the reason is carried in the caveats where a view will render it.
  totals: null, days: [], tasks: [], kinds: [], agents: null, branches: [], rework: [],
  caveats: [reason],
});

/**
 * The C-10 data layer. Returns the shape in `docs/specs/token-economics.md`.
 */
export function readTokenEconomics(root, cfg = {}) {
  const t = { ...DEFAULT_TOKENS, ...(cfg.tokens || {}) };
  // The cheap door, first: one stat, and nothing below this line runs on a machine with no store — no
  // directory walk, no read of the task log, and no `git log` out of `readContrib`. This function is called
  // by every build that renders the Economics view, which under `atlas watch` is every save.
  const probe = hasTranscripts(root, cfg);
  const dir = probe.dir;
  if (!probe.present) {
    return emptyEconomics(`${probe.reason} Token economics is derived ` +
      `from local session history, which this machine does not have for this path — that is an absent source, not a spend of zero.`);
  }
  // Sorted by path so the pass is deterministic, which is half of what makes the snapshot byte-stable.
  const files = transcriptFiles(dir).sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length) return emptyEconomics(`No .jsonl transcripts in ${dir}, so there is nothing to attribute.`);
  const subagentFiles = files.filter((f) => f.subagent).length;

  const sinceMs = t.since ? Date.parse(t.since) : null;
  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0 };
  const days = new Map();
  const branches = new Map();
  const kinds = new Map(WORK_KINDS.map((k) => [k, { kind: k, output: 0, cacheRead: 0, writes: 0 }]));

  const tw = taskWindows(root);
  const windows = overlapWindows(tw.items);

  // Keyed on `agentId`, not `sessionId`. **Every record in a subagent transcript carries the *parent's*
  // sessionId** — verified across all twenty here — so counting distinct sessionIds would report a peak of
  // one for a session that fanned six agents out at once, which is the precise claim C-11 exists to check.
  // `agentId` is per subagent and is on every record of its transcript.
  const sideMinutes = new Map();          // minute → Set(agentId)
  const agentIds = new Set();
  let mainOutput = 0, agentOutput = 0, sidechainTurns = 0, spawns = 0;
  let skippedLines = 0, outOfRange = 0;
  let unattributedTurns = 0, unattributedOutput = 0;
  let outsideWrites = 0;

  // The run rule, and what it did — every one of these is reported, because a rule that moves 76% of the
  // output out of `other` has to show its working.
  const gapMinutes = Math.max(0, Number(t.sittingGapMinutes ?? DEFAULT_SITTING_GAP_MINUTES) || 0);
  const gapMs = gapMinutes * 60000;
  let runs = 0, gapCuts = 0;
  let otherTurns = 0, inheritedKindOutput = 0;
  let inheritedTaskTurns = 0, inheritedTaskOutput = 0;
  // Where the task-log gap actually is. A single "63% is unattributed" figure does not say whether the hook
  // misses sessions at random or simply was not installed yet, and those are different problems.
  const logStartMs = windows.length ? Math.min(...windows.map((w) => w.openMs)) : null;
  let unattributedBeforeLog = 0;

  for (const file of files) {
    // Written paths arrive on records that follow the assistant turn that produced them, so a turn's kind set
    // is only complete once the file is read — and under the run rule a turn's *attribution* is only complete
    // once its neighbours are known too. So the turns of one file are held in order and folded at the end of
    // it. Per file, never per store: the list is bounded by the number of usage-bearing records in a single
    // transcript, and a run does not cross from one thread of work into another.
    const turns = [];
    const byUuid = new Map();
    let lastTurn = null;

    for (const line of jsonlLines(file.path)) {
      let j;
      try { j = JSON.parse(line); } catch { skippedLines++; continue; }

      // A spawn is an *intent* to fan out; a subagent transcript is evidence it ran and cost something.
      // Counted separately and never merged — see the `agents` block below.
      const content = j.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) spawns++;
      }

      const written = writtenPathOf(j);
      if (written) {
        const kind = classifyWrite(written, root, cfg);
        if (kind === null) outsideWrites++;
        else {
          const owner = (j.sourceToolAssistantUUID && byUuid.get(j.sourceToolAssistantUUID)) || lastTurn;
          if (owner) owner.kinds.add(kind);
          kinds.get(kind).writes++;
        }
      }

      const u = usageOf(j);
      if (!u) continue;
      const ts = j.timestamp ? Date.parse(j.timestamp) : null;
      if (sinceMs && ts && ts < sinceMs) { outOfRange++; continue; }

      totals.input += u.input; totals.cacheWrite += u.cacheWrite;
      totals.cacheRead += u.cacheRead; totals.output += u.output;
      totals.messages++;

      // A record in a subagent transcript is a subagent turn whether or not it says so, and one marked
      // `isSidechain` is one wherever it lives. Either witness is enough.
      const sidechain = j.isSidechain === true || file.subagent;
      if (sidechain) {
        agentOutput += u.output; sidechainTurns++;
        // `agentId` first, and `sessionId` only as a fallback: a sidechain turn written inline in a session
        // file — the older shape — has no agent id, and there the session is the only discriminator there is.
        const who = j.agentId || j.sessionId || file.name;
        agentIds.add(who);
        if (ts) {
          const minute = Math.floor(ts / 60000);
          if (!sideMinutes.has(minute)) sideMinutes.set(minute, new Set());
          sideMinutes.get(minute).add(who);
        }
      } else mainOutput += u.output;

      if (ts) {
        const key = new Date(ts).toISOString().slice(0, 10);
        const d = days.get(key) || { day: key, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0, agentOutput: 0, mainOutput: 0 };
        d.input += u.input; d.cacheWrite += u.cacheWrite; d.cacheRead += u.cacheRead; d.output += u.output;
        d.messages++;
        if (sidechain) d.agentOutput += u.output; else d.mainOutput += u.output;
        days.set(key, d);
      }

      const br = j.gitBranch || null;
      const b = branches.get(br) || { branch: br, output: 0, cacheRead: 0, messages: 0 };
      b.output += u.output; b.cacheRead += u.cacheRead; b.messages++;
      branches.set(br, b);

      // Which windows were open at this instant. The 1/n split happens in the fold below, once it is known
      // whether this turn stands on its own or takes its neighbour's attribution.
      const open = (ts !== null && windows.length)
        ? windows.filter((w) => ts >= w.openMs && ts <= w.closeMs) : [];

      const turn = { ts, output: u.output, cacheRead: u.cacheRead, kinds: new Set(),
                     open: open.length ? open : null };
      turns.push(turn);
      if (j.uuid) byUuid.set(j.uuid, turn);
      lastTurn = turn;
    }

    /* ---- the fold: attribute each turn to the run it belongs to, on both axes ---- */

    const kindAnchor = runAnchors(turns, gapMs, (x) => x.kinds.size > 0);
    if (turns.length) { runs += kindAnchor.runs; gapCuts += kindAnchor.cuts; }
    // The task axis is cut into the same runs by the same silences, so the two answers are consistent with
    // each other; only the predicate changes.
    const taskAnchor = windows.length ? runAnchors(turns, gapMs, (x) => x.open !== null) : null;

    for (let i = 0; i < turns.length; i++) {
      const x = turns[i];

      const ka = kindAnchor[i];
      if (ka < 0) {
        // Nothing anywhere in this run wrote a file inside the repository. That is the only `other`: not
        // "this turn wrote nothing", but "this stretch of work left no trace to classify it by".
        otherTurns++;
        kinds.get('other').output += x.output;
        kinds.get('other').cacheRead += x.cacheRead;
      } else {
        const list = [...turns[ka].kinds];
        if (ka !== i) inheritedKindOutput += x.output;
        for (const k of list) {
          kinds.get(k).output += x.output / list.length;
          kinds.get(k).cacheRead += x.cacheRead / list.length;
        }
      }

      if (!taskAnchor) continue;
      const ta = taskAnchor[i];
      if (ta < 0) {
        unattributedTurns++;
        unattributedOutput += x.output;
        if (logStartMs !== null && x.ts !== null && x.ts < logStartMs) unattributedBeforeLog += x.output;
      } else {
        const open2 = turns[ta].open;
        const n = open2.length;
        if (ta !== i) { inheritedTaskTurns++; inheritedTaskOutput += x.output; }
        for (const w of open2) { w.output += x.output / n; w.cacheRead += x.cacheRead / n; w.messages += 1 / n; }
      }
    }
  }

  const daySeries = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  /* ---- rework: joined to contrib's verdict, never recomputed ---- */
  // A failure to read git is a missing rework verdict, not a failed token report. `readContrib` degrades for
  // the ordinary cases itself and throws for the rest; the rest must not take this whole surface down.
  let contrib;
  try { contrib = readContrib(root, cfg); }
  catch (err) { contrib = { available: false, reason: String(err?.message || err).split('\n')[0] }; }
  const reworkByDay = new Map((contrib?.available ? contrib.quality.reworkByDay : []).map((d) => [d.day, d]));
  const rework = daySeries.map((d) => {
    const v = reworkByDay.get(d.day);
    if (!v || !v.touches) return { day: d.day, newWorkOutput: null, reworkOutput: null };
    const reworkOutput = Math.round(d.output * (v.rework / v.touches));
    return { day: d.day, newWorkOutput: d.output - reworkOutput, reworkOutput };
  });
  const daysWithoutVerdict = rework.filter((r) => r.reworkOutput === null).length;

  const pctOfOutput = (n) => (totals.output ? Math.round((n / totals.output) * 1000) / 10 : 0);

  const caveats = [];
  caveats.push('Derived from local session transcripts, not from the repository. They are machine-local, ' +
    'unversioned, and gone if cleared — these figures are not reproducible from a clone.');
  caveats.push('There is no git author in a transcript, so there is no per-contributor axis here and there ' +
    'will not be one. The honest axes are branch and agent.');
  caveats.push('Counts only. No prompt text, no message content, and no file path reaches this output: a ' +
    'written path is read to choose one of five words and is discarded on the same line.');

  if (!tw.available) caveats.push(tw.reason);
  else if (!windows.length) caveats.push('`.atlas/tasks-live.jsonl` holds no dated task, so no turn is attributed to a task.');
  else {
    const partial = windows.filter((w) => w.partial).length;
    if (partial) caveats.push(`${partial} of ${windows.length} task window(s) overlapped another, so a turn ` +
      `inside n open windows contributes 1/n to each and those tasks are marked \`partial\`. Per-task figures ` +
      `are rounded from fractional shares and will not sum exactly to the total — that is the rounding, not a gap.`);
    if (inheritedTaskOutput) {
      caveats.push(`${pctOfOutput(inheritedTaskOutput)}% of the output attributed to a task (${num(inheritedTaskTurns)} ` +
        `turn(s)) fell in no window itself and took the attribution of the nearest turn in the same run — the ` +
        `same ${gapMinutes}-minute rule used for the kind of work. No window was widened to achieve it: a turn ` +
        `more than ${gapMinutes} minute(s) from any attributed turn stays unattributed and is counted below.`);
    }
    if (unattributedTurns) {
      caveats.push(`${num(unattributedTurns)} assistant turn(s) — ${pctOfOutput(unattributedOutput)}% of all ` +
        `output — fall inside no task window, near no turn that does, and are attributed to no task. The task ` +
        `log only covers sessions that ran with the hook installed.`);
      // Where the hole is, not just how big it is. A gap that is entirely before the log's first record is a
      // start date; a gap scattered through the covered period would be a hook that misses sessions. They
      // need different fixes, and the single percentage above cannot tell them apart.
      if (unattributedBeforeLog) {
        const before = Math.round((unattributedBeforeLog / unattributedOutput) * 1000) / 10;
        const all = before >= 99.95;
        const stamp = `${new Date(logStartMs).toISOString().slice(0, 16).replace('T', ' ')}Z`;
        caveats.push(`${all ? 'All of that unattributed output' : `${before}% of it`} predates the first record ` +
          `in \`.atlas/tasks-live.jsonl\` (${stamp}) and is not recoverable from this source: those sessions ran ` +
          `before the task hook existed.` +
          `${all ? ' Nothing inside the covered period is unattributed.' : ' The rest falls between windows inside the covered period.'}`);
      }
    }
    // The hook writes the whole task list the first time it sees one, so a list that already existed arrives
    // as a burst of create-and-complete records sharing one instant. Those windows are narrower than a turn
    // and can hold nothing; their zero is a coverage gap and must not read as a task that cost nothing.
    const instant = windows.filter((w) => w.closeMs !== Infinity && w.closeMs - w.openMs <= 1000).length;
    if (instant) caveats.push(`${instant} of ${windows.length} task window(s) opened and closed inside one ` +
      `second and can contain no turn, so they report zero. That is a window too narrow to hold work, not a ` +
      `task that cost nothing — it is what the hook writes the first time it sees a task list that already existed.`);
    const openEnded = windows.filter((w) => w.closeMs === Infinity).length;
    if (openEnded) caveats.push(`${openEnded} of ${windows.length} task window(s) have no closing record and ` +
      `are still open, so each takes its share of every later turn. An unfinished task is genuinely still ` +
      `open; its figure is a running total, not a final cost.`);
    if (tw.dropped) caveats.push(`${tw.dropped} task(s) were deleted in the harness and are excluded, which changes the 1/n denominator inside their windows.`);
    if (tw.undated) caveats.push(`${tw.undated} task record(s) carry no usable timestamp and cannot be given a window.`);
  }

  caveats.push(subagentFiles
    ? `${subagentFiles} subagent transcript(s) were read from <session>/subagents/. Concurrency is counted by ` +
      `\`agentId\`, not by session: every record in a subagent transcript carries the parent session's id, so ` +
      `counting sessions would report a peak of one however many agents ran at once.`
    : 'No subagent transcript is present in this store. A subagent given its own git worktree runs under a ' +
      'different working directory and writes to a different store entirely — absence here is not evidence ' +
      'that nothing was fanned out.');
  if (!sidechainTurns) caveats.push('No subagent turn was found at all, so the split below reports the main agent only.');
  // A spawn with no transcript is the interesting case, and reporting only one of the two numbers hides it.
  const orphanSpawns = Math.max(0, spawns - agentIds.size);
  if (orphanSpawns) caveats.push(`${spawns} subagent spawn(s) were requested and ${agentIds.size} left a ` +
    `transcript here, so ${orphanSpawns} ran somewhere this store cannot see — a worktree of its own, or a ` +
    `transcript since cleared. A spawn is counted as an intent to fan out and never as spend: it contributes ` +
    `no tokens and no concurrency, because none was observed.`);

  if (!contrib?.available) caveats.push(`New work against rework is unavailable: ${contrib?.reason || 'git history could not be read'}.`);
  else {
    caveats.push(`New work against rework uses \`contrib.mjs\`'s definition — a file re-touched within ` +
      `${contrib.quality.reworkWindowDays} days — joined by day. It is not recomputed here, so the two surfaces cannot drift.`);
    if (daysWithoutVerdict) caveats.push(`${daysWithoutVerdict} day(s) had token spend but no commit, so they ` +
      `carry no rework verdict. They are reported as unknown rather than as a day of pure new work.`);
  }

  caveats.push('Per kind, a turn is attributed to the kind of work of the contiguous run it belongs to, ' +
    'not to what that one turn happened to write. Most turns read, search, reason or run a command and write ' +
    'no file at all; classifying each turn alone put 83.4% of this repository\'s output in `other`, which ' +
    'measured the shape of a transcript rather than the work. A run ends at a silence longer than ' +
    `${gapMinutes} minute(s) or where the kind being written changes, and inside a run a turn that wrote ` +
    'nothing takes the kind of the nearest write in either direction. A turn that wrote two kinds still ' +
    'splits evenly between them.');
  caveats.push(`The ${gapMinutes}-minute run break is measured, not chosen: it is the 99.4th percentile of the ` +
    `8,319 gaps between consecutive assistant turns in the store this rule was calibrated against, where the ` +
    `median gap is 6.2 seconds and 94% are under a minute. Only 53 gaps exceed it, and the largest are 2 to 12 ` +
    `hours — nights, not pauses. At 2 minutes an ordinary long tool call ends a run and \`other\` stays at ` +
    `23.4%; at 30 minutes \`other\` reaches 4.3% only by letting one write speak for work done half an hour ` +
    `away. Here it cut ${num(gapCuts)} silence(s) into ${num(runs)} run(s). Change it with tokens.sittingGapMinutes.`);
  caveats.push(`\`other\` is ${pctOfOutput(kinds.get('other').output)}% of output across ${num(otherTurns)} ` +
    `turn(s): runs in which no file inside this repository was written at all, so there is nothing to ` +
    `attribute them to. It does not mean "wrote no file this turn".`);
  if (inheritedKindOutput) caveats.push(`${pctOfOutput(inheritedKindOutput)}% of the output under a named kind ` +
    `was inherited from another turn in the same run rather than written in that turn. The \`writes\` column ` +
    `counts actual writes only, so it is the figure to read for how much was written, and the output column ` +
    `for what the writing cost.`);
  if (outsideWrites) caveats.push(`${outsideWrites} write(s) landed outside this repository. They give their ` +
    `turn no kind of its own — a scratch file in a temp directory is not this repository's coding — so that ` +
    `turn takes the kind of its run like any other, and falls in \`other\` only if the run wrote nothing here.`);
  if (skippedLines) caveats.push(`${skippedLines} unparseable line(s) were skipped.`);
  if (outOfRange) caveats.push(`${outOfRange} message(s) fall before tokens.since and are excluded.`);
  caveats.push(t.rates
    ? `This report is counts only; currency appears in the cost section of \`atlas tokens\`, at the rates ` +
      `configured in tokens.rates${t.ratesAsOf ? ` and entered ${t.ratesAsOf}` : ' (undated)'}. The snapshot never carries currency.`
    : 'No figure here is in currency, because tokens.rates is not configured. Prices are not in the transcript and change over time.');

  return {
    available: true,
    reason: null,
    totals,
    days: daySeries,
    tasks: windows.map((w) => ({
      id: w.id, subject: w.subject, status: w.status,
      opened: w.opened, closed: w.closed,
      output: Math.round(w.output), cacheRead: Math.round(w.cacheRead), messages: Math.round(w.messages),
      partial: w.partial,
    })).sort((a, b) => b.output - a.output || a.id.localeCompare(b.id)),
    kinds: WORK_KINDS.map((k) => {
      const v = kinds.get(k);
      return { kind: k, output: Math.round(v.output), cacheRead: Math.round(v.cacheRead), writes: v.writes };
    }),
    agents: {
      mainOutput, agentOutput,
      runs: agentIds.size,
      peakConcurrent: [...sideMinutes.values()].reduce((n, s) => Math.max(n, s.size), 0),
      spawns,
      spawnsWithoutTranscript: Math.max(0, spawns - agentIds.size),
    },
    branches: [...branches.values()].sort((a, b) => b.output - a.output),
    rework,
    caveats,
  };
}

/* ------------------------------------------------------------------ snapshot */

/**
 * One day of the rollup, as the exact bytes that go on the line.
 *
 * Fixed key order and integers only, so the same input produces the same byte sequence on every machine and
 * every run — which is what makes the file diffable, and what lets a re-run tell "this day changed" apart from
 * "this day was written again".
 */
export function snapshotLine(d) {
  return JSON.stringify({
    v: 1, day: d.day,
    input: d.input, cacheWrite: d.cacheWrite, cacheRead: d.cacheRead, output: d.output,
    messages: d.messages, mainOutput: d.mainOutput, agentOutput: d.agentOutput,
  });
}

/**
 * Append the counts-only rollup to `.atlas/tokens.jsonl`.
 *
 * **Nothing calls this except `atlas tokens --snapshot`.** No build writes it, no hook writes it, and it does
 * nothing at all unless `tokens.snapshot` is true in the config — the snapshot is the single path by which a
 * figure derived from a session transcript reaches a commit and travels to a clone, so it is opted into once,
 * in writing, by whoever owns the repository.
 *
 * Append-only, one object per line, the same discipline as the journal and the task log: a killed run loses at
 * most the line it was writing. A day already recorded with identical counts is not written again, so running
 * it twice over an unchanged store appends nothing.
 */
export function writeTokenSnapshot(root, cfg = {}, econ = null) {
  const t = { ...DEFAULT_TOKENS, ...(cfg.tokens || {}) };
  if (!t.snapshot) {
    return { written: false, appended: 0, file: t.snapshotFile,
      reason: 'tokens.snapshot is not enabled in project-atlas.config.json, so nothing was written. The ' +
              'snapshot is the only path by which transcript-derived figures reach a commit, and it is opt-in.' };
  }
  const k = econ || readTokenEconomics(root, cfg);
  if (!k.available) return { written: false, appended: 0, file: t.snapshotFile, reason: k.reason };

  assertNotPublishable(root, cfg, t.snapshotFile);
  const abs = path.resolve(root, t.snapshotFile);

  const known = new Map();
  try {
    for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r?.day) known.set(r.day, line);
    }
  } catch { /* no snapshot yet — the first run writes every day it has */ }

  const add = [];
  for (const d of k.days) {
    const line = snapshotLine(d);
    if (known.get(d.day) !== line) add.push(line);
  }
  if (add.length) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, add.join('\n') + '\n', 'utf8');
  }
  return { written: true, file: t.snapshotFile, appended: add.length, days: k.days.length,
    unchanged: k.days.length - add.length, reason: null };
}

/* ------------------------------------------------------------------ economics report */

export function formatEconomics(k, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  const L = [];
  L.push(c.bold('Attribution') + c.dim('  what the work went on, not just how much there was'));
  if (!k.available) {
    L.push(c.dim(`  Unavailable — ${k.reason}`));
    return L.join('\n');
  }

  L.push('');
  L.push(c.bold('By kind of work') + c.dim('  by the run a turn belongs to, not by what that turn wrote'));
  for (const kind of k.kinds) {
    L.push(`  ${kind.kind.padEnd(14)}${M(kind.output).padStart(7)} out  ${M(kind.cacheRead).padStart(7)} cached  ${String(kind.writes).padStart(5)} write(s)`);
  }
  L.push(c.dim('  writes are actual writes; output is what the run around them cost. `other` is a run that'));
  L.push(c.dim('  wrote nothing here at all — see the caveats for the run break and where it came from.'));

  if (k.tasks.length) {
    L.push('');
    L.push(c.bold('By task') + c.dim(`  (${k.tasks.length}) · ‡ marks a window that overlapped another, so its figure is a 1/n share`));
    for (const task of k.tasks.slice(0, 12)) {
      const flag = task.partial ? c.yellow('‡') : ' ';
      const subject = (task.subject || '(no subject recorded)').slice(0, 46);
      L.push(`  ${flag} ${M(task.output).padStart(7)} out  ${String(task.messages).padStart(5)} msg  ${task.status.padEnd(11)} ${subject}`);
    }
    if (k.tasks.length > 12) L.push(c.dim(`    … and ${k.tasks.length - 12} more`));
  } else {
    L.push('');
    L.push(c.bold('By task') + c.dim('  none — see the caveats for why'));
  }

  L.push('');
  L.push(c.bold('Main agent against subagents'));
  L.push(`  main output    ${M(k.agents.mainOutput).padStart(7)}`);
  L.push(`  agent output   ${M(k.agents.agentOutput).padStart(7)}  ` + c.dim(`${k.agents.runs} subagent(s) left a transcript`));
  L.push(`  peak parallel  ${String(k.agents.peakConcurrent).padStart(7)}  ` + c.dim('most subagents active inside one minute, by agent id'));
  L.push(`  spawns asked   ${String(k.agents.spawns).padStart(7)}  ` +
    c.dim(k.agents.spawnsWithoutTranscript
      ? `${k.agents.spawnsWithoutTranscript} left no transcript here — an intent, never counted as spend`
      : 'fan-out requested — counted separately from what was observed to run'));

  const verdicts = k.rework.filter((r) => r.reworkOutput !== null);
  L.push('');
  if (verdicts.length) {
    const rw = verdicts.reduce((n, r) => n + r.reworkOutput, 0);
    const nw = verdicts.reduce((n, r) => n + r.newWorkOutput, 0);
    L.push(c.bold('New work against rework') + c.dim(`  over ${verdicts.length} day(s) with a commit`));
    L.push(`  new work       ${M(nw).padStart(7)} out`);
    L.push(`  rework         ${M(rw).padStart(7)} out  ` + c.dim("contrib.mjs's definition, joined by day — not recomputed"));
  } else {
    L.push(c.bold('New work against rework') + c.dim('  unavailable — see the caveats'));
  }

  if (k.branches.length) {
    L.push('');
    L.push(c.bold('By branch'));
    for (const b of k.branches.slice(0, 10)) {
      L.push(`  ${M(b.output).padStart(7)} out  ${M(b.cacheRead).padStart(7)} cached  ${String(b.messages).padStart(5)} msg   ${b.branch || c.dim('(no branch recorded)')}`);
    }
  }

  L.push('');
  L.push(c.bold('Read these with the caveats'));
  for (const n of k.caveats) L.push(c.dim('  · ' + n.replace(/`/g, '')));
  return L.join('\n');
}
