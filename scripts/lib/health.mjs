/**
 * project-atlas · rot signals
 *
 * Sixteen mechanical checks over the corpus, and one that is not about the corpus at all.
 *
 * H1–H16 are facts about the repository, never judgments about quality — "this link points at a file that
 * does not exist" is checkable; "this document is badly written" is not, and a tool that mixes the two
 * teaches people to distrust both.
 *
 * **H17 is a different kind of claim and is labelled as one everywhere it appears.** It measures the
 * operator, not the corpus: whether a session that did a lot of editing ever delegated any of it. That is a
 * useful thing to notice and a dishonest thing to smuggle in next to sixteen statements about files, so it
 * lives in `OPERATOR_SIGNALS` here rather than in the catalogue `signals.mjs` holds, and it cannot block.
 *
 * The blocking/advisory split is the load-bearing compromise. Blocking signals have no legitimate cause.
 * Advisory ones do: an archived record SHOULD cite code that has since moved. Making everything blocking is
 * the reliable way to get the whole report ignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { matchesAny, suppressionFor, compileRule } from './config.mjs';
import { SIGNALS as CORPUS_SIGNALS } from './signals.mjs';
import { designRecord, undesigned, isDesignDoc } from './design.mjs';
import { handoffAge, handoffsIn, DEFAULT_STALE_AFTER } from './handoff.mjs';
import { evaluate as evaluateSop, DEFAULT_SOP_MATCH, DEFAULT_REVIEW_DAYS } from './sop.mjs';
import { num } from './format.mjs';

/**
 * Everyone who has ever committed here, for H11.
 *
 * Read directly rather than through `readContrib`, which builds a full analysis this needs one field of.
 * Failure returns an empty list, and an empty list means H11 checks only that an owner is *named* — never
 * that a named owner is wrong, because "git could not answer" and "this person does not exist" are
 * different facts and only one of them is worth reporting.
 */
function gitAuthors(root) {
  if (!root) return [];
  try {
    return [...new Set(execFileSync('git', ['-C', root, 'log', '--format=%an'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean))];
  } catch { return []; }
}

/* ------------------------------------------------------------------ H17 · the one signal that is not about the corpus */

/**
 * **H17 measures the operator, not the corpus, and that is a different kind of claim.**
 *
 * H1–H16 are all statements about the repository: this link is dead, this citation names a line that does not
 * exist, this SOP is past the review date it set itself. Every one of them can be settled by reading the
 * files, and every one of them is a defect in the thing under version control.
 *
 * H17 is a statement about **how a session was run**. It reads local session transcripts, not the repository,
 * and what it observes is a working method: a lot of editing done in one thread with nothing delegated. That
 * is a legitimate way to work and often the right one, so H17 is **advisory and can never block** — it is not
 * in `signals.mjs` at all, so a config that names it in `blocking` is told the id is not one this build
 * knows. The blocking set is reserved for claims that the *repository* is wrong; "you should have
 * parallelised" is an opinion about somebody's afternoon.
 *
 * **That warning is not the enforcement, and it was checked rather than assumed.** An unknown-but-well-formed
 * signal id in `blocking` is a warning by design — so a config written for a newer project-atlas still loads
 * — which means `"blocking": ["H17"]` survives validation and arrives here intact. `blockingFor` is what
 * makes it harmless.
 *
 * Keeping it in the report anyway is deliberate. The alternative — a number nobody sees — is how the
 * repository ran three subagents against one shared working tree and found out afterwards.
 */
/**
 * **An arbitrary round number, and it says so.** The value did not change; the justification printed beside it
 * did, because the old one could not be true.
 *
 * It claimed 40 was *"the 25th percentile of the edit counts of the sessions that DID fan out"* over a listed
 * sample of eleven — `12, 39, 58, 89, 116, 136, 164, 235, 694, 1114, 1650`. The 25th percentile of those
 * eleven is 58 by nearest-rank and 73.5 interpolated. It is not 40 under any convention. The same paragraph
 * then said *"20 of the 29 made fewer than 40 edits"* — which puts nine sessions at or above 40, and since
 * nine of the eleven fanned-out sessions are already at or above 40, it leaves no solo session above the line
 * at all. The rule was described as firing "twice" on a sample where the stated numbers make it fire zero
 * times. Two fabricated figures, both printing on `health.html`, in the paragraph whose entire job was to
 * justify the threshold to a sceptical reader.
 *
 * **Re-measured** on 2026-08-13 over the same machine's whole transcript store — 8 stores, 587 transcript
 * files, 29 sessions. See `OPERATOR_SIGNALS.H17.why` below for the distributions; the finding that decided
 * this constant is that **edit count does not separate the two populations**. Three of the twelve sessions
 * that fanned out made fewer than 40 edits, and two of the seventeen that did not made more. There is no cut
 * point with sessions of one kind on one side and the other kind on the other, so no percentile of this
 * sample earns the word "because" — and the 25th percentile of the twelve is 39 by nearest-rank and 53.25
 * interpolated, a 37% spread that depends only on which textbook you open.
 *
 * So the number is chosen, not derived, and the text says *chosen*. What the sample can honestly support is
 * the calibration: at 40 the rule fires on 2 of the 29 sessions, which is a note rather than a nag. A stated
 * arbitrary default a reader can argue with and `tokens.parallelismEdits` can change is defensible. A
 * percentile that was never computed is not.
 */
export const DEFAULT_PARALLELISM_EDITS = 40;

/**
 * The sample the threshold was calibrated against, measured rather than remembered.
 *
 * Exported so the paragraph that prints on `health.html` is generated from the figures instead of restating
 * them, and so a test can assert the arithmetic rather than the spelling. Restating a distribution in prose is
 * exactly how the old text came to contain two numbers that contradicted each other.
 */
export const PARALLELISM_SAMPLE = {
  measured: '2026-08-13',
  stores: 8,
  transcriptFiles: 587,
  /** Main-thread edit counts of the sessions that DID delegate at least one turn. */
  fannedOut: [0, 12, 39, 58, 89, 136, 152, 164, 235, 694, 1114, 1650],
  /** Main-thread edit counts of the sessions that delegated nothing. */
  solo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 6, 16, 26, 32, 51, 139],
};

/**
 * Everything the justification paragraph states, computed from `PARALLELISM_SAMPLE` rather than remembered.
 *
 * **The old text was wrong precisely because it was written by hand.** Two figures in it disagreed with each
 * other and with the list printed between them, and nothing could notice, because prose about a distribution
 * is not the distribution. Deriving them means the paragraph cannot say the rule fires twice on a sample where
 * it fires never — the count comes from the same array the reader is shown.
 *
 * Both percentile conventions are reported. They disagree by 37% on this sample, which is the argument for not
 * resting a default on either of them.
 */
export function parallelismEvidence(threshold = DEFAULT_PARALLELISM_EDITS, sample = PARALLELISM_SAMPLE) {
  const fanned = [...sample.fannedOut].sort((a, b) => a - b);
  const solo = [...sample.solo].sort((a, b) => a - b);
  const all = [...fanned, ...solo];
  const p = (a, q) => {
    // Nearest-rank and the interpolated (type-7) definition, the two a reader is likely to reach for.
    const idx = (q / 100) * (a.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return {
      nearest: a[Math.max(0, Math.ceil((q / 100) * a.length) - 1)],
      interpolated: Math.round((a[lo] + (a[hi] - a[lo]) * (idx - lo)) * 100) / 100,
    };
  };
  return {
    sessions: all.length,
    fanned: fanned.length,
    solo: solo.length,
    fannedOut: fanned,
    soloCounts: solo,
    /** Sessions the rule fires on: no subagent turn, and at or above the threshold. */
    fires: solo.filter((e) => e >= threshold).length,
    /** The overlap, in both directions. This pair is why no threshold is derivable from this sample. */
    fannedBelow: fanned.filter((e) => e < threshold).length,
    soloAtOrAbove: solo.filter((e) => e >= threshold).length,
    below: all.filter((e) => e < threshold).length,
    zeroEdits: all.filter((e) => e === 0).length,
    p25: p(fanned, 25),
  };
}

const EV = parallelismEvidence();

/**
 * The signals that judge the operator. Held apart from `CORPUS_SIGNALS` so the distinction is enforceable
 * rather than merely documented: `blockingFor` reads this set, and so does the catalogue split.
 */
export const OPERATOR_SIGNALS = {
  H17: {
    id: 'H17',
    title: 'Large session, no subagent',
    operator: true,
    why:
      'H17 MEASURES THE OPERATOR, NOT THE CORPUS. Every other signal here is a claim about the repository, ' +
      'settled by reading the files. This one is a claim about how a session was run: it made ' +
      `${DEFAULT_PARALLELISM_EDITS} or more file edits in its main thread and never delegated a single turn to ` +
      'a subagent, so independent work that could have run at the same time ran one item after another. ' +
      `THE THRESHOLD OF ${DEFAULT_PARALLELISM_EDITS} IS AN ARBITRARY ROUND NUMBER, AND SAYING SO IS THE HONEST ` +
      'OPTION. It was measured for, and the measurement refused to justify it. Over the whole transcript store ' +
      `on the machine this was calibrated against on ${PARALLELISM_SAMPLE.measured} — ` +
      `${num(PARALLELISM_SAMPLE.stores)} stores, ${num(PARALLELISM_SAMPLE.transcriptFiles)} transcript files, ` +
      `${num(EV.sessions)} sessions — the ${num(EV.fanned)} sessions that DID fan out made ` +
      `${EV.fannedOut.map(num).join(', ')} edits, and the ${num(EV.solo)} that did not made ` +
      `${EV.soloCounts.map(num).join(', ')}. Those two lists overlap: ${num(EV.fannedBelow)} of the sessions ` +
      `that delegated were below ${DEFAULT_PARALLELISM_EDITS} edits and ${num(EV.soloAtOrAbove)} that delegated ` +
      'nothing were above it, so there is no cut point with one kind of session on each side. HOW BIG A ' +
      'SESSION WAS DOES NOT PREDICT WHETHER ITS OPERATOR DELEGATED, on this sample. The previous text here ' +
      `claimed ${DEFAULT_PARALLELISM_EDITS} was the 25th percentile of the fanned-out counts; it was not, and ` +
      `it is not now — that percentile is ${num(EV.p25.nearest)} by nearest rank and ${EV.p25.interpolated} ` +
      'interpolated, a spread of more than a third that turns on nothing but which definition is used. A ' +
      'number invented and then dressed as a measurement is worse than an admitted guess, because a reader ' +
      'who checks it stops trusting the sixteen signals that are exact. What the sample DOES support is the ' +
      `calibration: at ${DEFAULT_PARALLELISM_EDITS} the rule fires on ${num(EV.fires)} of the ${num(EV.sessions)} ` +
      `sessions, ${num(EV.below)} of which made fewer than ${DEFAULT_PARALLELISM_EDITS} edits and ` +
      `${num(EV.zeroEdits)} of which made none at all — read-and-answer work, which is exactly what should not ` +
      'be fanned out. So it is a note rather than a nag. Argue with it and change it with ' +
      'tokens.parallelismEdits; that it is arguable is the point. ADVISORY, AND NEVER BLOCKING — enforced in ' +
      'code, not by configuration: a dependency chain has to be worked in order, and a task small enough ' +
      'that coordination costs more than the parallelism is correctly done alone. This signal cannot tell ' +
      'those apart from a missed opportunity, which is precisely why it only ever advises.',
  },
};

/**
 * Everything the report enumerates: the corpus catalogue, then the operator signals.
 *
 * Exported from here rather than added to `signals.mjs` on purpose — see `OPERATOR_SIGNALS` above. Consumers
 * that want only corpus claims import `signals.mjs`; consumers that render the whole report import this.
 *
 * **`CORPUS_SIGNALS` is re-exported beside it so a renderer never has to choose between the two by accident.**
 * `render.mjs` and `dashboard.mjs` import their catalogue from this module and nothing else, so before this
 * line the only catalogue they could see was the combined one — and a card headed "Rot signals" counting
 * `Object.keys(SIGNALS).length` silently began describing H17 as a rot signal, which is the precise claim this
 * whole design exists to avoid making. Both sets are available here now: enumerate `SIGNALS` to render every
 * row, count `CORPUS_SIGNALS` to say how many things about the repository are checked.
 */
export { CORPUS_SIGNALS };
export const SIGNALS = { ...CORPUS_SIGNALS, ...OPERATOR_SIGNALS };

/**
 * Whether a finding blocks a commit.
 *
 * The `!OPERATOR_SIGNALS[...]` term is the **only** thing keeping an operator signal out of the blocking set,
 * which is not what the first draft of this assumed. Config validation warns about an id it does not know and
 * then keeps it — the right call, because a config written for a newer version must still load — so
 * `"blocking": ["H17"]` reaches this function unaltered. The refusal has to live where the decision is made.
 */
function blockingFor(signal, suppressed, blocking) {
  return blocking.has(signal) && !suppressed && !OPERATOR_SIGNALS[signal];
}

/**
 * Which sessions edited a lot and delegated nothing — and, when that cannot be answered, why not.
 *
 * **The data is supplied, never fetched.** `tokens.mjs` states as its first rule that nothing reads session
 * transcripts unless `atlas tokens` is run, because those files hold every prompt and every path that passed
 * through a session. A health run that quietly opened them to score the operator would break that rule for
 * the sake of an advisory note. So the caller reads them and passes the aggregate in, and when the caller
 * passes nothing the answer is **unevaluated** — never "ok". A signal that could not run and printed ok is
 * defect A-29, and the Not-checked section exists because of it.
 *
 * The contract for `sessions`, which the token layer owns:
 *
 *   { available: boolean, reason?: string,
 *     sessions: [{ id: string, edits: number, subagentTurns: number }] }
 *
 * A bare array is accepted as shorthand for `{ available: true, sessions }`.
 *
 *  - `edits` counts `Edit` / `Write` / `MultiEdit` / `NotebookEdit` tool calls made in the session's MAIN
 *    thread — the turns where `isSidechain` is not true. Work a subagent did is not charged to the operator.
 *  - `subagentTurns` counts the turns where `isSidechain === true` that belong to the session. Zero means the
 *    session never fanned out; anything above zero means it did, and H17 stays quiet regardless of size.
 *
 * A session missing either number is not guessed at. It is dropped and counted, and the count is reported.
 */
export function readParallelism(sessions, cfg = {}) {
  const threshold = cfg.tokens?.parallelismEdits ?? DEFAULT_PARALLELISM_EDITS;
  const no = (reason) => ({ available: false, reason, threshold });

  if (sessions === undefined || sessions === null) {
    // The old wording here said transcripts are read *only* by `atlas tokens`. C-10 made that false — a build
    // that renders the Economics view reads them too — and this sentence prints verbatim in the Not-checked
    // block, so `atlas health` was stating a boundary the tool no longer holds. The claim that matters to a
    // reader of this line is unchanged and is the one now made: **health does not open them itself.**
    return no('no session data was supplied. `atlas health` never reads session transcripts itself — ' +
      'rule 1 in tokens.mjs keeps that read in one place — so it sees them only when its caller passes ' +
      'the aggregate in');
  }
  const data = Array.isArray(sessions) ? { available: true, sessions } : sessions;
  if (data.available === false) {
    return no(`the transcript store could not be read${data.reason ? `: ${data.reason}` : ''}`);
  }
  if (!Array.isArray(data.sessions)) {
    return no('the session data supplied carries no `sessions` array, so no session was judged');
  }
  if (!data.sessions.length) {
    return no('there is no transcript for this repository to read, so no session was judged');
  }

  const usable = data.sessions.filter((s) => Number.isFinite(s?.edits) && Number.isFinite(s?.subagentTurns));
  if (!usable.length) {
    return no(`${data.sessions.length} session(s) were supplied and none carried both an \`edits\` and a ` +
      '`subagentTurns` count, so none could be judged');
  }
  const flagged = usable
    .filter((s) => s.edits >= threshold && s.subagentTurns === 0)
    .map((s) => ({ id: String(s.id ?? 'unnamed session'), edits: s.edits }))
    .sort((a, b) => b.edits - a.edits);

  return { available: true, threshold, considered: usable.length, incomplete: data.sessions.length - usable.length, flagged };
}


const DAY = 86400000;

export function runHealth(index, cfg, root, opts = {}) {
  const findings = [];
  const known = new Set(index.documents.map((d) => d.path));
  const add = (signal, doc, detail, extra = {}) => {
    const suppressed = suppressionFor(signal, doc, cfg);
    findings.push({ signal, doc, detail, suppressed: suppressed || null, ...extra });
  };

  /* H1 · dead internal links, and H2 · unresolvable citations */
  const lineCache = new Map();
  // A file whose length could not be read. H2's second half — "a line past its end" — is skipped for these,
  // and skipping it silently is the same defect as every other one in this file: the citation then looks
  // verified. The reasons are collected and stated rather than swallowed by the bare catch that was here.
  const unreadable = new Map();
  const lineCount = (p) => {
    if (lineCache.has(p)) return lineCache.get(p);
    let n = null;
    try {
      n = fs.readFileSync(path.join(root, p), 'utf8').split('\n').length;
    } catch (err) {
      n = null;
      unreadable.set(p, err?.code || String(err?.message || err).split('\n')[0]);
    }
    lineCache.set(p, n);
    return n;
  };

  for (const d of index.documents) {
    for (const l of d.links) {
      if (known.has(l.target)) continue;
      if (fs.existsSync(path.join(root, l.target))) continue;   // a real non-markdown file, e.g. an image
      add('H1', d.path, `${l.raw} → ${l.target}`, { target: l.target, text: l.text });
    }
    for (const c of d.citations) {
      if (c.ambiguous) continue;                    // counted separately; guessing would verify the wrong file
      if (!c.resolved) { add('H2', d.path, `${c.path}:${c.line} — no such file in the repository`, { cite: c }); continue; }
      const n = lineCount(c.resolved);
      if (n !== null && c.line > n) {
        add('H2', d.path, `${c.path}:${c.line} — ${c.resolved} has ${n} lines`, { cite: c, resolved: c.resolved });
      }
    }
  }

  /* H3 · duplicate titles */
  const byTitle = new Map();
  for (const d of index.documents) {
    if (!d.title) continue;
    const key = d.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(d.path);
  }
  for (const [title, paths] of byTitle) {
    if (paths.length < 2) continue;
    for (const p of paths) add('H3', p, `"${title}" also claimed by ${paths.filter((x) => x !== p).join(', ')}`, { siblings: paths });
  }

  /* H4 · orphans */
  for (const d of index.documents) {
    if (d.backlinks.length) continue;
    if (matchesAny(d.path, ['README.md', 'docs/README.md', 'docs/INDEX.md', 'docs/index.md'])) continue;
    add('H4', d.path, 'nothing links here');
  }

  /* H5 · unclassified */
  if (cfg.fallbackCluster) {
    for (const d of index.documents) {
      if (d.cluster === cfg.fallbackCluster) add('H5', d.path, `fell through to "${cfg.fallbackCluster}"`);
    }
  } else {
    for (const d of index.documents) if (!d.cluster) add('H5', d.path, 'matched no cluster rule');
  }

  /* H6 · stale against citations */
  if (index.stats.withGit) {
    for (const d of index.documents) {
      if (!d.git || !d.citations.length) continue;
      const docTime = Date.parse(d.git.iso || d.git.date);
      if (Number.isNaN(docTime)) continue;
      // `??`, not `||`: a configured staleDays of 0 means "no grace period", and `||` would silently
      // reinterpret that as the default — the config would be read, accepted, and ignored.
      const graceDays = cfg.staleDays ?? 90;
      if (Date.now() - docTime < graceDays * DAY) continue;   // recent docs are never "stale"
      const moved = [];
      for (const c of d.citations) {
        // codeGit is keyed by the RESOLVED path; a bare-filename citation would never match its own entry.
        const g = index.codeGit[c.resolved || c.path];
        if (!g) continue;
        const codeTime = Date.parse(g.iso || g.date);
        if (!Number.isNaN(codeTime) && codeTime > docTime) moved.push(`${c.path} (${g.date})`);
      }
      if (moved.length) {
        add('H6', d.path, `last touched ${d.git.date}; ${moved.length} cited file(s) moved since`,
          { docDate: d.git.date, moved: moved.slice(0, 10), movedTotal: moved.length });
      }
    }
  }

  // A configured pattern the tool declined to run. Collected here and stated in "Not checked" — the rule is
  // dropped, never quietly downgraded to "found nothing". See config.mjs::unsafeRegexReason for why a screen
  // and not a timeout.
  const refusedPatterns = [];
  const unevaluated = new Set();

  /* H7 · forbidden terms */
  for (const rule of cfg.forbiddenTerms || []) {
    const src = rule.pattern || `\\b${escapeRe(rule.term)}\\b`;
    const { re, error } = compileRule(src, rule.flags || 'g');
    if (!re) {
      unevaluated.add('H7');
      refusedPatterns.push(`H7 was NOT evaluated for "${rule.term || src}" — the configured pattern \`${src}\` was declined because ${error}. No document was checked for that term.`);
      continue;
    }
    for (const d of index.documents) {
      if (rule.ignore && matchesAny(d.path, rule.ignore)) continue;
      const hits = d.body.match(re);
      if (hits && hits.length) {
        add('H7', d.path, `"${rule.term || rule.pattern}" × ${hits.length}${rule.reason ? ` — ${rule.reason}` : ''}`,
          { term: rule.term || rule.pattern, count: hits.length });
      }
    }
  }

  /* H9 · cross-reference asymmetry */
  for (const rule of cfg.crossref || []) {
    const a = index.documents.find((d) => d.path === rule.a);
    const b = index.documents.find((d) => d.path === rule.b);
    if (!a || !b) continue;
    const { re, error } = compileRule(rule.pattern, 'g');
    if (!re) {
      unevaluated.add('H9');
      refusedPatterns.push(`H9 was NOT evaluated for the pair ${rule.a} ↔ ${rule.b} — the configured pattern \`${rule.pattern}\` was declined because ${error}.`);
      continue;
    }
    const idsA = new Set((a.body.match(re) || []).map((s) => s.trim()));
    const idsB = new Set((b.body.match(re) || []).map((s) => s.trim()));
    const onlyA = [...idsA].filter((x) => !idsB.has(x));
    const onlyB = [...idsB].filter((x) => !idsA.has(x));
    if (onlyA.length) add('H9', rule.a, `${onlyA.length} id(s) absent from ${rule.b}: ${onlyA.slice(0, 12).join(', ')}${onlyA.length > 12 ? ' …' : ''}`, { pair: rule.id, ids: onlyA });
    if (onlyB.length) add('H9', rule.b, `${onlyB.length} id(s) absent from ${rule.a}: ${onlyB.slice(0, 12).join(', ')}${onlyB.length > 12 ? ' …' : ''}`, { pair: rule.id, ids: onlyB });
  }

  /* H8 · missing title */
  for (const d of index.documents) if (!d.title) add('H8', d.path, 'no H1 heading');

  /* H14, H15, H16 · the design record
   *
   * design.mjs has recognised HLD, LLD, architecture, data flow, decision records and specifications since
   * it was written, and nothing here referenced any of it: a repository could ship for a year with every
   * design artifact missing and the corpus reported clean. The record was detected, charted, and never
   * enforced.
   */
  const designDocs = index.documents.filter((d) => isDesignDoc(d.path));

  // H14 — stricter than H6 on purpose. H6 asks whether a document is older than the code it cites, which for
  // most prose is a prompt to re-read. A design document is a *claim about how the code works*, so a
  // citation that no longer resolves means the claim is wrong rather than merely aging, and there is no
  // grace period for wrong.
  for (const d of designDocs) {
    // `null`, not `false`: an unresolved citation carries null, and `=== false` matched nothing at all —
    // H14 reported clean on a design document whose citations were all broken. Same shape of mistake as the
    // one in citationHealth, found because this test was written before the signal was believed.
    const broken = (d.citations || []).filter((c) => c.resolved === null);
    if (broken.length) {
      add('H14', d.path, `${broken.length} citation(s) no longer resolve: ${broken.slice(0, 6).map((c) => c.path).join(', ')}${broken.length > 6 ? ' …' : ''}`,
        { broken: broken.slice(0, 10).map((c) => c.path), brokenTotal: broken.length });
    }
  }

  // H15 — an absence, reported once per missing kind rather than once per document, because there is no
  // document to attach it to. Advisory: a small repository legitimately has no LLD, and a tool that demands
  // one is asking for a file rather than for design.
  for (const kind of designRecord(index.documents)) {
    // The subject is the kind, not a path: this finding is about a document that does not exist, so there is
    // nothing to attach it to. `null` printed literally as "null" in the report, which reads like a bug.
    // `corpus: true` marks a finding whose subject is not a document. The report links `doc` to a generated
    // page, so a label put there produced links to pages/-no-hld--82adea20.html and friends — dead links the
    // site verifier caught. The subject stays readable; the renderer is told not to treat it as a path.
    // A stub is not an absence. The file exists and names the questions it owes an answer to, which is a
    // different state from nothing at all — and reporting it as absent would make the scaffold pointless
    // while also making the count wrong in both directions.
    if (kind.state === 'absent') {
      add('H15', `(no ${kind.id})`, `no ${kind.label.toLowerCase()} in the corpus`, { kind: kind.id, label: kind.label, corpus: true });
    } else if (kind.state === 'stub') {
      add('H15', kind.stubs[0] || `(${kind.id})`, `${kind.label.toLowerCase()} is a scaffold with no substance in it yet`, { kind: kind.id, label: kind.label, corpus: true });
    }
  }

  // H10/H11/H12 — SOP obligations. An SOP that has drifted is not out of date, it is incorrect instructions
  // being followed, and the cost lands on whoever trusted it — the person least able to notice.
  //
  // `today` is taken once and passed down rather than read per document, so every finding in one run is
  // measured against the same day. Two documents judged against different clocks in the same report is the
  // kind of quiet inconsistency that makes a report untrustworthy for reasons nobody can find.
  {
    const sopRules = cfg.sop?.match || DEFAULT_SOP_MATCH;
    const sops = index.documents.filter((d) => matchesAny(d.path, sopRules));
    if (sops.length) {
      const today = new Date().toISOString().slice(0, 10);
      const owners = (cfg.sop?.owners || []).length ? cfg.sop.owners : gitAuthors(root);
      for (const d of sops) {
        const v = evaluateSop(d, { today, owners, reviewDaysDefault: cfg.sop?.reviewDays ?? DEFAULT_REVIEW_DAYS });
        for (const f of v.findings) add(f.id, d.path, f.detail);
        // H12 — the same citations H2 already resolved, judged by a stricter rule because this is a
        // procedure. Reusing H2's work rather than re-resolving keeps one answer to "does this path exist".
        for (const c of d.citations || []) {
          if (typeof c.resolved === 'string') continue;
          add('H12', d.path, `step cites ${c.raw || c.path}, which cannot be resolved`);
        }
      }
    }
  }

  // H13 — a handoff that names a commit far behind HEAD. Advisory by design: a stale handoff is a cost, not
  // a hazard, and a blocking signal on a document this subjective would train people to suppress it.
  //
  // Reported per contributor, because the handoffs are per contributor: a shared count would say "one
  // handoff is stale" about a team of six and name nobody. When git cannot resolve the named commit the
  // distance is unknown, and an unknown distance is never reported as current — the same rule the Not
  // checked section exists for.
  if (root) {
    for (const h of handoffsIn(root, cfg)) {
      const age = handoffAge(root, h.file);
      if (!age.exists) continue;
      const limit = cfg.handoff?.staleAfter ?? DEFAULT_STALE_AFTER;
      if (age.distance !== null && age.distance > limit) {
        add('H13', h.rel, `written ${age.distance} commits ago (${age.commit}); the limit is ${limit}`, { corpus: true });
      } else if (age.distance === null) {
        add('H13', h.rel, `${age.reason}, so how far behind it is cannot be measured`, { corpus: true });
      }
    }
  }

  // H16 — `undesigned` already computed this for the architecture page and nothing acted on it. Advisory,
  // and phrased as a question: not every area needs a design document, and the useful reading is which
  // *important* area has none.
  //
  // The code file list is not on the index — the build takes it from `git ls-files` and hands it to the
  // panels — so health asks for it too. When it cannot (no repository, or --no-git), the signal is declared
  // **unevaluated**, never reported as clean. The first version of this checked `index.codeFiles`, which
  // does not exist: H16 silently never ran and printed "ok", which is precisely the lie the Not-checked
  // section exists to prevent.
  let codeFiles = null;
  try {
    // Deduplicated: an unmerged path is printed once per index stage, so a conflicted code file would be
    // counted three times in coverage. Same reason as `scan.mjs::gitLsFiles`.
    codeFiles = [...new Set(execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean))]
      .filter((f) => /\.(m?[jt]sx?|py|go|rs|java|rb|swift|kt|c|h|cpp|cs|php|sh)$/i.test(f));
  } catch { /* handled below, as an absence of evidence rather than evidence of absence */ }

  if (!codeFiles) {
    unevaluated.add('H16');
    refusedPatterns.push('H16 was NOT evaluated — the tracked file list could not be read (no git repository, or --no-git). No area was checked for design coverage.');
  } else {
    for (const a of undesigned(codeFiles, designDocs)) {
      if (a.citations === 0) add('H16', a.area, `${a.files} file(s), cited by no design document`, { area: a.area, files: a.files, corpus: true });
    }
  }

  /* H17 · the operator signal — see OPERATOR_SIGNALS at the top of this file for why it is kept apart.
   *
   * The subject is a session, not a document, so it carries `corpus: true`: that flag means "this finding has
   * no page to link to", and H15 and H16 already use it for the same reason. The renderer prints it as text
   * instead of minting a link to a document that was never written. */
  const parallelism = readParallelism(opts.sessions, cfg);
  if (!parallelism.available) {
    unevaluated.add('H17');
    refusedPatterns.push(`H17 was NOT evaluated — ${parallelism.reason}. No session was checked for fan-out, ` +
      'and "not measured" is not the same claim as "nothing to report".');
  } else {
    if (parallelism.incomplete) {
      refusedPatterns.push(`${parallelism.incomplete} session(s) carried no edit or subagent count and were ` +
        `excluded from H17; ${parallelism.considered} were judged.`);
    }
    for (const s of parallelism.flagged) {
      add('H17', `(session ${s.id})`,
        `${s.edits} edit(s) in one main thread and no subagent turn — the advisory threshold is ${parallelism.threshold}`,
        { session: s.id, edits: s.edits, threshold: parallelism.threshold, corpus: true, operator: true });
    }
  }

  const blocking = new Set(cfg.blocking || []);
  for (const f of findings) f.blocking = blockingFor(f.signal, f.suppressed, blocking);

  const active = findings.filter((f) => !f.suppressed);
  const counts = {};
  for (const s of Object.keys(SIGNALS)) counts[s] = active.filter((f) => f.signal === s).length;

  return {
    findings,
    counts,
    suppressed: findings.filter((f) => f.suppressed).length,
    blockingCount: findings.filter((f) => f.blocking).length,
    unevaluated: [...unevaluated],
    notChecked: notChecked(index, cfg, refusedPatterns, unreadable),
    setup: setupNotes(cfg, { trackedOutput: trackedOutputFiles(root, cfg) }),
  };
}

/**
 * How many files of the build's own output directory git is tracking. `null` when git could not answer —
 * which is not zero, and the caller says nothing rather than reporting a property it did not establish.
 */
function trackedOutputFiles(root, cfg) {
  if (!root || !cfg?.output) return null;
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '--', String(cfg.output)],
                             { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.split('\n').filter(Boolean)).size;
  } catch { return null; }
}

/**
 * **Properties of the setup, not of the corpus.** (A-68)
 *
 * Kept apart from "Not checked" on purpose: that section lists work this run could not do, and these are
 * things it did establish. Neither is a finding — nothing here has a document to point at, and none of it is
 * wrong. It is the class of fact each user otherwise rediscovers by watching something behave oddly.
 *
 * The first one is the loop. `output` is committed and `trackedOnly` is on, so the build's own output is
 * inside the set that *defines* the corpus: a rebuild rewrites those tracked files, committing them changes
 * the tracked set, and the tracked set is what the watcher watches. Excluding `**\/_wiki/**` from the index
 * keeps the output's *content* out of the corpus and does nothing about this — the git index is the input
 * here, and a commit necessarily modifies it. Measured on a 411-document corpus: 851 tracked files rewritten
 * per build, and a session that was committing could not get the directory to hold still, because its own
 * commits kept re-triggering the rebuild it was waiting on.
 *
 * **It is named, not forbidden.** Committing a generated wiki is a deliberate and common choice — it is how
 * the site gets published from the repository — and the tool has no business overruling it. What it owes the
 * user is that the property be stated once, in the report they already read, rather than learned by waiting.
 */
export function setupNotes(cfg, { trackedOutput = null } = {}) {
  const out = [];
  if (trackedOutput && cfg?.trackedOnly !== false) {
    out.push(`${cfg.output} is committed (${num(trackedOutput)} tracked file(s)) and trackedOnly is on, so this ` +
      `tool's own output is part of what defines its corpus. Every build rewrites those files, and committing ` +
      `them changes the tracked set a watcher rebuilds on — excluding the path from the index does not take it ` +
      `out of git. Deliberate for a published wiki; worth knowing before you wait for the directory to settle.`);
  }
  return out;
}

/**
 * What this run could NOT check, and why. Stated explicitly: a report that silently skips work reads as
 * "everything is fine" when it is not.
 */
function notChecked(index, cfg, refusedPatterns = [], unreadable = new Map()) {
  // Everything discovery already knows it could not do — degraded git discovery, documents with no history.
  const out = [...refusedPatterns, ...(index.notes || [])];
  if (unreadable.size) {
    const shown = [...unreadable.entries()].slice(0, 5).map(([p, why]) => `${p} (${why})`).join(', ');
    out.push(`${unreadable.size} cited file(s) could not be read, so their line numbers were not verified: ${shown}` +
      `${unreadable.size > 5 ? `, and ${unreadable.size - 5} more` : ''}.`);
  }
  if (!index.stats.withGit) out.push('Git metadata unavailable — H6 (staleness) was not evaluated, and no document carries a last-modified date.');
  if (!(cfg.forbiddenTerms || []).length) out.push('No forbiddenTerms configured — H7 checked nothing. Add retired product or persona names to enable it.');
  if (!(cfg.crossref || []).length) out.push('No crossref pairs configured — H9 checked nothing. Pair your backlog and task list to enable it.');
  if (!cfg.trackedOnly) out.push('trackedOnly is off — untracked files are included, so the report may cover files that are not in the repository.');
  const ambiguous = index.documents.reduce((n, d) => n + d.citations.filter((c) => c.ambiguous).length, 0);
  if (ambiguous) out.push(`${ambiguous} citation(s) name a filename that exists at more than one path — resolved to none, so their line numbers were not verified. Write these as full paths to have them checked.`);
  return out;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ------------------------------------------------------------------ reporting */

export function formatReport(health, index, { verbose = false, color = true } = {}) {
  const c = color
    ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
    : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

  const L = [];
  L.push(c.bold(`project-atlas · ${index.siteTitle}`));
  L.push(c.dim(`${index.stats.documents} documents · ${num(index.stats.lines)} lines · ${index.stats.clusters} clusters · ${index.stats.links} links · ${index.stats.citations} citations`));
  L.push('');

  const rows = Object.values(SIGNALS).map((s) => {
    const n = health.counts[s.id] || 0;
    const isBlocking = health.findings.some((f) => f.signal === s.id && f.blocking);
    // A signal whose configured pattern was declined has a count of zero and is not clean. Drawing it green
    // here would be exactly the failure the "Not checked" section exists to prevent, one line higher up.
    if ((health.unevaluated || []).includes(s.id)) {
      return `  ${s.id}  ${c.yellow('   —')}  ${s.title}${c.dim('  (not evaluated — see Not checked)')}` +
        (s.operator ? c.dim('  (measures the operator, not the corpus — advisory only)') : '');
    }
    const mark = n === 0 ? c.green('  ok') : isBlocking ? c.red(String(n).padStart(4)) : c.yellow(String(n).padStart(4));
    // An operator signal sits in the same table as sixteen statements about the repository, so the row says
    // which kind it is. Reading "H17 · 1" off a list headed by dead links invites exactly the wrong
    // conclusion — that something in the corpus is broken.
    return `  ${s.id}  ${mark}  ${s.title}${s.operator ? c.dim('  (measures the operator, not the corpus — advisory only)') : ''}`;
  });
  L.push(...rows);
  L.push('');

  if (health.suppressed) L.push(c.dim(`  ${health.suppressed} finding(s) suppressed by configuration, each with a stated reason.`));

  if (health.notChecked.length) {
    L.push('');
    L.push(c.bold('  Not checked'));
    for (const n of health.notChecked) L.push(c.dim(`    · ${n}`));
  }

  // Below "Not checked", because these are not findings and not gaps: they are properties of how this
  // repository is set up that change what the reader should expect. (A-68)
  if (health.setup?.length) {
    L.push('');
    L.push(c.bold('  Setup'));
    for (const n of health.setup) L.push(c.dim(`    · ${n}`));
  }

  if (verbose) {
    for (const s of Object.values(SIGNALS)) {
      const items = health.findings.filter((f) => f.signal === s.id && !f.suppressed);
      if (!items.length) continue;
      L.push('');
      L.push(c.bold(`  ${s.id} · ${s.title}`) + c.dim(` — ${s.why}`));
      for (const f of items.slice(0, verbose === 'all' ? Infinity : 25)) {
        L.push(`    ${f.doc}${f.detail ? c.dim('  ' + f.detail) : ''}`);
      }
      if (items.length > 25 && verbose !== 'all') L.push(c.dim(`    … and ${items.length - 25} more (use --verbose=all)`));
    }
  }

  L.push('');
  L.push(health.blockingCount
    ? c.red(`  ${health.blockingCount} blocking finding(s).`) + c.dim(' Blocking signals have no legitimate cause — fix them.')
    : c.green('  No blocking findings.'));

  return L.join('\n');
}
