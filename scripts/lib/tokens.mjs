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
 *  1. **Opt-in.** Nothing reads transcripts unless `atlas tokens` is run. No other command touches them.
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

export const DEFAULT_TOKENS = {
  transcriptRoot: null,          // defaults to ~/.claude/projects
  since: null,                   // ISO date; omit for everything
  rates: null,                   // { model: { input, output, cacheWrite, cacheRead } } per million tokens
  ratesAsOf: null,               // the date those rates were correct — printed with any cost figure
};

/** ~/.claude/projects/<slug>, where the slug is the absolute path with separators replaced by hyphens. */
export function transcriptDir(root, cfg = {}) {
  const base = cfg.tokens?.transcriptRoot || path.join(os.homedir(), '.claude', 'projects');
  const slug = path.resolve(root).split(path.sep).join('-');
  return path.join(base, slug);
}

/**
 * Refuse to write a report anywhere the tool publishes from. The output directory is pushed to wikis and
 * Pages branches; a token report there is a prompt log there.
 */
export function assertNotPublishable(root, cfg, dest) {
  const out = path.resolve(root, cfg.output || 'docs/_wiki');
  const abs = path.resolve(root, dest);
  if (abs === out || abs.startsWith(out + path.sep)) {
    throw new Error(
      `Refusing to write a token report into ${cfg.output} — that directory is published to wikis and Pages ` +
      `branches, and this report is derived from session transcripts. Choose a path outside it.`);
  }
}

/* ------------------------------------------------------------------ reading */

export async function readTokens(root, cfg = {}, { onProgress } = {}) {
  const t = { ...DEFAULT_TOKENS, ...(cfg.tokens || {}) };
  const dir = transcriptDir(root, cfg);

  if (!fs.existsSync(dir)) {
    return { available: false, reason: `No session transcripts for this repository at ${dir}.`, dir };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ name: f, path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
    .filter((f) => f.size > 0)
    .sort((a, b) => b.size - a.size);

  if (!files.length) return { available: false, reason: `No .jsonl transcripts in ${dir}.`, dir };

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
    const s = { file: f.name.slice(0, 8), bytes: f.size, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0, first: null, last: null };
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
      if (j.type === 'assistant') oc.assistantTurns++;
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
    if (s.messages || oc.assistantTurns) oc.sessions++;
    if (s.messages) bySession.push({ ...s, first: s.first && new Date(s.first).toISOString().slice(0, 10), last: s.last && new Date(s.last).toISOString().slice(0, 10) });
  }

  const billable = totals.input + totals.output + totals.cacheWrite + totals.cacheRead;
  return {
    available: true, dir,
    files: files.length,
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
    notChecked: notChecked(t, skippedLines, outOfRange),
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

function notChecked(t, skippedLines, outOfRange) {
  const out = [];
  out.push('Derived from local session transcripts, not from the repository. They are machine-local, unversioned, and gone if cleared — these figures are not reproducible from a clone.');
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

  L.push(c.bold(`${M(k.billable)} tokens across ${t.messages.toLocaleString()} assistant message(s)`));
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

  L.push(c.bold(`${o.typedPrompts.toLocaleString()} typed prompt(s) across ${o.sessions} session(s)`));
  L.push(c.dim(`${o.assistantTurns.toLocaleString()} assistant turns · ${o.toolResults.toLocaleString()} tool results`));
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
