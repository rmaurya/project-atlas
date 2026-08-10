/**
 * project-atlas · the record that survives being killed
 *
 * A handoff written at the end of a session is written exactly when it cannot be. The session that gets
 * killed, compacted or interrupted never reaches its own last step, so everything it learned and did not
 * write down is gone — and the next session rediscovers the same traps by hitting them again.
 *
 * So state accumulates *as work happens*. Every record is one line, appended with one `appendFileSync`, and
 * flushed before the call returns. A process killed mid-write loses at most the record it was writing and
 * cannot corrupt what came before it. A summary held in memory and flushed at exit is the design that fails
 * precisely in the case it exists for.
 *
 * ## Four rules, and each one is load-bearing
 *
 * **1. Append-only. The tool never edits or deletes a record.** Not on read, not on compaction, not to tidy.
 * A log a program can rewrite is a log whose history is a guess.
 *
 * **2. A malformed last line is expected, not an error.** It is the signature of the exact event this file
 * exists for: the process died mid-write. `read()` skips unparseable lines and reports how many it skipped,
 * because silently dropping them would hide the kill, and throwing would make one truncated byte destroy
 * every record before it.
 *
 * **3. Never prompt text.** The same rule as `atlas tokens` and `atlas worklog`, for the same reason: this
 * records what was decided and touched, never what was said. The hooks that write here are given no
 * transcript to read, and `note()` caps `text` so a paste of a conversation cannot become a record.
 *
 * **4. Never published.** `.atlas/` sits outside the corpus by construction — it is not under the docs root,
 * so no scan reaches it and no publish target can carry it. `assertUnpublished()` states that as a check
 * rather than an assumption, in the same shape `tokens.mjs` already uses.
 *
 * ## Why per-contributor files now, when A-12 is a separate item
 *
 * One journal is a contention point the moment two people work in parallel, and an append-only file is the
 * worst possible merge: git resolves it by interleaving two people's records, which is not a conflict it can
 * see and not an ordering either person wrote. Writing to `.atlas/journal/<slug>.jsonl` from the start costs
 * one call to `contributorSlug()` — the identity `atlas contrib` and `atlas worklog` already group by — and
 * avoids migrating a file whose whole value is that it is never rewritten.
 */

import fs from 'node:fs';
import path from 'node:path';
import { contributorSlug } from './worklog.mjs';
import { isAtOrInside } from './paths.mjs';

/** Where the journal lives. Deliberately outside the docs root, so nothing that publishes can reach it. */
export const JOURNAL_DIR = path.join('.atlas', 'journal');

/**
 * The record kinds, and what each one is for.
 *
 * A fixed vocabulary rather than free-form strings: `atlas state` reconstructs a session by grouping these,
 * and a journal where every caller invented its own kind reconstructs into a list — which is what the
 * terminal already gave you. An unknown kind is refused at write time, where the caller can fix it, rather
 * than discovered at read time when the session that would have corrected it is gone.
 */
export const KINDS = {
  decision: 'settled a question — what was chosen, and what it rules out',
  finding: 'learned something true about the repository that was not obvious',
  trap: 'paid for a mistake, so the next session does not pay again',
  progress: 'moved a piece of work to a state worth resuming from',
  blocker: 'stopped, and cannot proceed without something',
};

/**
 * Longest `text` a record may carry.
 *
 * This is rule 3 made mechanical. A cap does not detect prompt text — nothing can — but a record is a
 * sentence about what happened, and a transcript pasted into one is far longer than any sentence. What the
 * cap actually buys is that the failure is loud: an over-long note is refused with the reason, at the moment
 * someone is about to write the wrong thing into a file that is never rewritten.
 */
export const MAX_TEXT = 500;

/** The journal file for one contributor. */
export function journalPath(root, identity) {
  return path.join(root, JOURNAL_DIR, `${contributorSlug(identity)}.jsonl`);
}

/**
 * Refuse a journal path inside anything that publishes.
 *
 * `.atlas/` is already outside the output directory, so under every default this can never fire. It is here
 * because "already outside" is a property of the current defaults, not of the design — someone reconfiguring
 * `output` to the repository root would otherwise silently start publishing an operational log, and the
 * whole point of the journal/handoff split is that one of them is not for readers.
 */
export function assertUnpublished(root, cfg, file) {
  const out = path.resolve(root, cfg?.output || 'docs/_wiki');
  if (isAtOrInside(out, path.resolve(root, file))) {
    throw new Error(
      `Refusing to write the journal to ${path.relative(root, file)} — that path is inside ${cfg?.output}, ` +
      `which is published. The journal is an operational record and is never published; move output/ or the ` +
      `journal so they do not overlap.`);
  }
}

/**
 * Append one record. Returns the record as written.
 *
 * `agent` is who wrote it, and it is why a subagent's work survives the subagent: a subagent's reasoning is
 * discarded by design and only its final message reaches the main session, so a finding it established is
 * lost unless it was written down as it happened. Tagging the writer is what lets the main session tell a
 * subagent's conclusion from its own.
 */
export function note(root, cfg, { kind, text, refs = [], agent = 'main', identity = null, at = null }) {
  if (!KINDS[kind]) {
    throw new Error(`Unknown record kind "${kind}". One of: ${Object.keys(KINDS).join(', ')}.`);
  }
  const body = String(text ?? '').trim();
  if (!body) throw new Error('A record with no text records nothing. Say what happened.');
  if (body.length > MAX_TEXT) {
    throw new Error(
      `That note is ${body.length} characters; the limit is ${MAX_TEXT}. A record is a sentence about what ` +
      `happened, not a transcript — the journal never carries conversation text.`);
  }

  const file = journalPath(root, identity);
  assertUnpublished(root, cfg, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const rec = {
    at: at || new Date().toISOString(),
    agent: String(agent || 'main'),
    kind,
    text: body,
    refs: (Array.isArray(refs) ? refs : [refs]).filter(Boolean).map(String),
  };
  // One line, one call. `appendFileSync` opens with O_APPEND, so concurrent writers — a subagent and the
  // main session running at once — cannot overwrite each other's offset.
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
}

/**
 * Every record, oldest first, across every contributor.
 *
 * `skipped` is reported rather than swallowed. A truncated final line means a process was killed mid-write,
 * which is worth knowing about — it is the event the journal exists for, and a reader who is told "3 records,
 * clean" when one was lost has been given a subtly false account of the session they are resuming.
 */
export function read(root, { since = null } = {}) {
  const dir = path.join(root, JOURNAL_DIR);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { available: false, records: [], skipped: 0, contributors: [] };
  }

  const records = [];
  let skipped = 0;
  for (const f of files) {
    const who = f.replace(/\.jsonl$/, '');
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        skipped++;
        continue;
      }
      if (!rec || typeof rec !== 'object' || !rec.at || !rec.kind) { skipped++; continue; }
      records.push({ ...rec, by: who });
    }
  }

  records.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const kept = since ? records.filter((r) => String(r.at) > String(since)) : records;
  return {
    available: true,
    records: kept,
    skipped,
    contributors: [...new Set(records.map((r) => r.by))].sort(),
  };
}

/**
 * What a resuming session needs to know, in the order it needs it.
 *
 * Deliberately not a summary. Summarising records would be the tool writing prose about work it did not do,
 * which is the thing this project refuses everywhere else — so this groups and orders, and every line is a
 * record somebody wrote verbatim.
 */
export function formatState({ journal, branch, version, handoffAt }) {
  const L = [];
  L.push('');

  // `branchStatus` reports `current` and a `dirty` count taken from `git status --porcelain`, which counts
  // untracked files too. An earlier version of this read `branch.branch` and a changes-derived file list:
  // both were wrong in the same silent direction — an unknown branch and a clean tree, printed with the
  // confidence of a measurement, on the one screen a resuming session trusts to tell it where it is.
  L.push(`  ${version || 'unknown version'} · ${branch?.ok ? branch.current : 'not a git repository'}`);
  if (branch?.ok) {
    L.push(`  ${branch.dirty ? `${branch.dirty} uncommitted change(s)` : 'working tree clean'}` +
           (branch.ahead ? `, ${branch.ahead} unpushed commit(s)` : ''));
  }
  L.push('');

  if (!journal.available) {
    L.push('  No journal yet. `atlas note <kind> "<text>"` starts one; nothing reads it until then.');
    L.push('');
    return L.join('\n');
  }

  if (journal.skipped) {
    L.push(`  ${journal.skipped} unparseable line(s) skipped — the signature of a process killed mid-write.`);
    L.push('  Nothing before them was affected; the journal is append-only.');
    L.push('');
  }

  const recent = journal.records.slice(-40);
  if (!recent.length) {
    L.push(handoffAt
      ? `  Nothing recorded since the handoff at ${handoffAt}.`
      : '  The journal exists but holds no records.');
    L.push('');
    return L.join('\n');
  }

  L.push(`  ${journal.records.length} record(s)` +
         (journal.contributors.length > 1 ? ` from ${journal.contributors.length} contributors` : '') +
         (recent.length < journal.records.length ? `, last ${recent.length} shown` : '') + ':');
  L.push('');

  for (const kind of Object.keys(KINDS)) {
    const of = recent.filter((r) => r.kind === kind);
    if (!of.length) continue;
    L.push(`  ${kind.toUpperCase()}`);
    for (const r of of) {
      const when = String(r.at).slice(5, 16).replace('T', ' ');
      const who = r.agent && r.agent !== 'main' ? ` [${r.agent}]` : '';
      L.push(`    ${when}${who}  ${r.text}`);
      if (r.refs?.length) L.push(`${' '.repeat(18)}${r.refs.join(', ')}`);
    }
    L.push('');
  }

  L.push('  Written as work happened, so it survives a session that never reached its own last step.');
  L.push('  It records what was decided and touched — never what was said.');
  L.push('');
  return L.join('\n');
}
