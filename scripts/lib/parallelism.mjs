/**
 * project-atlas · the aggregate H17 is judged against
 *
 * **This module exists so that `health.mjs` does not have to.** `readParallelism` in `health.mjs` decides
 * *whether a session should have delegated*; it is handed the numbers and never opens a file. Rule 1 of
 * `tokens.mjs` is why: transcripts hold every prompt and every path that passed through a session, so the read
 * is kept where it can be audited rather than sprinkled through the tool. `health.mjs` states the contract and
 * this module meets it. Nothing in `health.mjs` changed to make that true.
 *
 * ## Where this code belongs, and why it is not there yet
 *
 * **It belongs in `tokens.mjs`, which owns the transcript read.** It is here because `tokens.mjs` exports no
 * per-session `{ edits, subagentTurns }` shape and was not this change's to edit. Precisely what it would need
 * to export, so this file can be deleted rather than maintained:
 *
 *   export function readSessionActivity(root, cfg)
 *     → { available: boolean, reason: string|null,
 *         sessions: [{ id: string, edits: number, subagentTurns: number }] }
 *
 *   `edits`         — Edit / Write / MultiEdit / NotebookEdit tool_use blocks in the session's MAIN thread.
 *   `subagentTurns` — assistant records belonging to the session with `isSidechain === true`, or living in
 *                     its `subagents/` directory. Zero means it never fanned out.
 *
 * `readTokenEconomics` already walks every one of these records for a different purpose and could emit this
 * from the same pass at no extra cost. Until it does, the honest choice is a second pass that says so, rather
 * than an H17 that is filed as shipped and never runs.
 *
 * **What is NOT duplicated here, deliberately.** Where the store lives (`transcriptDir`), whether there is one
 * (`hasTranscripts`), and which files it contains including the `subagents/` subdirectory that a flat
 * `readdir` misses — all three are imported from `tokens.mjs`. That last one was wrong for months and hid
 * every token a subagent spent; a second copy of it here would be the same defect wearing a new filename, and
 * it is exactly the duplicated derivation C-7 exists to delete. The only thing this file adds is the counting
 * loop.
 *
 * ## Cheap when there is nothing to read
 *
 * `atlas health` runs on every commit through the guard, so the empty case has to be free. `hasTranscripts()`
 * is one `statSync`, and on a machine with no store for this path this function returns
 * unavailable-with-a-reason before it lists a file. That reason travels into the report's "Not checked"
 * section: **H17 is unevaluated, never "ok"** — the A-29 rule.
 *
 * The commit gate does not call this at all. It reads `blockingCount`, H17 can never block, and a per-commit
 * pass over a hundred megabytes to compute a number nobody will look at is how a guard becomes something
 * people disable. See `scripts/atlas.mjs`.
 *
 * ## Counts only
 *
 * Four tool names, one boolean and a session id. No prompt text, no message content, no file path — not even
 * transiently: unlike `classifyWrite`, nothing here ever looks at `filePath`.
 */

import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { hasTranscripts, transcriptFiles } from './tokens.mjs';

/**
 * The tool calls that count as an edit.
 *
 * A `Read` is not one, and neither is a `Bash` that happens to write a file: H17's claim is about work the
 * operator did in its own thread with the editing tools, and widening it to "anything that changed the disk"
 * would make the number unarguable-with in the bad sense.
 */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** The spawn tools, counted only so a store with intent but no transcript can be reported as such. */
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

/**
 * A reason as a mid-sentence clause.
 *
 * `readParallelism` splices whatever arrives here into *"H17 was NOT evaluated — … . No session was checked"*,
 * and `hasTranscripts` returns a finished sentence, so the report read *"…-worktrees-agent-ae7d.. No session
 * was checked"*. Two full stops in the one line a reader has to trust for the honesty claim is a small thing
 * that makes the whole block look unproofread. The wording is left exactly as the token layer wrote it.
 */
function clause(reason) {
  return String(reason ?? '').trim().replace(/\.+$/, '');
}

/**
 * Read one JSONL file without holding it in memory. These run to tens of megabytes each.
 *
 * `StringDecoder` rather than `toString()` per chunk, for the reason `tokens.mjs` gives about the same loop: a
 * multi-byte character straddling the chunk boundary otherwise decodes to two replacement characters, which
 * corrupts that line's JSON and turns a real record into a skipped one.
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

/**
 * The per-session aggregate `readParallelism` documents, read from the local transcript store.
 *
 * The return value is `health.mjs`'s contract verbatim, so a caller passes it straight through as
 * `runHealth(index, cfg, root, { sessions })`.
 *
 * **A session is keyed on `sessionId`, not on the filename.** A subagent writes to
 * `<store>/<session>/subagents/agent-<id>.jsonl` and every record in it carries the *parent's* `sessionId` —
 * the same property `readTokenEconomics` relies on, and the reason it counts concurrency by `agentId`. Keying
 * on the file would file a session's subagent turns under a session that does not exist, and the session that
 * spawned them would read as having fanned out zero times: H17 would then fire on precisely the sessions that
 * did the thing it is asking for.
 */
export function readSessionParallelism(root, cfg = {}) {
  // The cheap door, first. One statSync, and nothing below this line runs on a machine with no store.
  const probe = hasTranscripts(root, cfg);
  if (!probe.present) return { available: false, reason: clause(probe.reason), sessions: [] };

  const files = transcriptFiles(probe.dir);
  if (!files.length) {
    return { available: false, reason: `there are no .jsonl transcripts in ${probe.dir}`, sessions: [] };
  }

  const sessions = new Map();
  const of = (id) => {
    if (!sessions.has(id)) sessions.set(id, { id, edits: 0, subagentTurns: 0, spawns: 0 });
    return sessions.get(id);
  };

  let skippedLines = 0;
  for (const file of files) {
    // The filename stem is the fallback only. A record's own `sessionId` is the answer wherever it is present,
    // which is everywhere in both shapes of transcript this store holds.
    const fallbackId = file.name.replace(/\.jsonl$/, '');
    for (const line of jsonlLines(file.path)) {
      // Everything this function counts — an edit tool call and an assistant turn — lives on an assistant
      // record, and an assistant record contains the string `assistant`. So a line without it can be skipped
      // before `JSON.parse`, which is most of them and much the largest cost in the pass. The test is a
      // substring rather than a key match on purpose: it can only over-include, never under-include, so it
      // cannot silently undercount if the record shape changes.
      if (!line.includes('assistant')) continue;
      let j;
      try { j = JSON.parse(line); } catch { skippedLines++; continue; }
      if (j?.type !== 'assistant') continue;

      // Either witness is enough, the same rule `readTokenEconomics` uses: a record marked `isSidechain` is a
      // subagent turn wherever it lives, and a record in a subagent transcript is one whether it says so or not.
      const sidechain = j.isSidechain === true || file.subagent;
      const s = of(j.sessionId || fallbackId);

      if (sidechain) { s.subagentTurns++; continue; }   // work a subagent did is never charged to the operator

      const content = j.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== 'tool_use' || !b.name) continue;
        if (EDIT_TOOLS.has(b.name)) s.edits++;
        else if (SPAWN_TOOLS.has(b.name)) s.spawns++;
      }
    }
  }

  if (!sessions.size) {
    return { available: false, reason: `no transcript at ${probe.dir} holds an assistant turn`, sessions: [] };
  }

  return {
    available: true,
    reason: null,
    dir: probe.dir,
    skippedLines,
    // A spawn with no sidechain turn anywhere is a subagent that ran in a worktree of its own, under a
    // different store. Reported so the reader can tell "never delegated" from "delegated somewhere this
    // machine cannot see" — H17 cannot, and would flag the second as though it were the first.
    spawnsWithoutTurns: [...sessions.values()].filter((s) => s.spawns > 0 && s.subagentTurns === 0).length,
    sessions: [...sessions.values()].map((s) => ({
      // Eight characters, as `readTokens` reports them. A session id is not prompt content, but it is also
      // not needed in full to tell two rows apart.
      id: s.id.slice(0, 8),
      edits: s.edits,
      subagentTurns: s.subagentTurns,
    })),
  };
}
