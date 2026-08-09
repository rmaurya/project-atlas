/**
 * project-atlas · a scorecard you can argue with
 *
 * Requested from an organisational perspective: score the practice, score the contribution, and say what to
 * improve. The objection to doing that is not squeamishness — it is that a score the tool invents is
 * unfalsifiable. "Performance: 62" has no answer when someone disputes it.
 *
 * So every number here is built the same way and shows its working:
 *
 *   component  a measured figure from `git log` or the corpus — never estimated, never from a transcript
 *   target     what full marks means, stated on the page
 *   weight     **from the config**, not from this file. The organisation owns the judgement; the tool owns
 *              the arithmetic. Change a weight and the score changes, which is the only way a score can be
 *              disagreed with rather than merely resented.
 *   suggestion what to do, attached to the component that lost the marks
 *
 * ## What is deliberately not scored
 *
 * **Prompt quality.** Not for delicacy — because the data cannot carry the claim. A transcript records what
 * happened after a prompt, not whether the prompt was well judged. In the session that built this file the
 * user interrupted twice and was right both times, and caught six generated-output defects the tool had
 * missed. Every friction-derived scorer marks that as the user's failure.
 *
 * What *can* be scored is the **interaction outcome** — did the work land, how much was redone, how often a
 * result had to be corrected by hand. That measures whether the collaboration worked, which is the question
 * an organisation is actually asking. Those components are computed only by `atlas score --sessions`, never
 * by the build, because transcripts are opt-in and never enter a published page.
 */

/** Default weights. Every one is meant to be overridden; they are a starting position, not a claim. */
export const DEFAULT_WEIGHTS = {
  // Practice — does the work follow the process this repository wrote down?
  conventionalSubjects: 1,
  deskAttribution: 1,
  specNaming: 2,
  releaseMarked: 2,
  // Outcome — did the work land?
  rework: 3,
  reverts: 2,
  docHealth: 2,
  busFactor: 1,
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/** Higher is better; `value` is already a percentage. */
const direct = (v) => (v === null ? null : clamp(v));
/** Lower is better: 0% scores 100, `worst`% scores 0. */
const inverse = (v, worst) => (v === null ? null : clamp(100 - (v / worst) * 100));

/**
 * Components computed from the repository alone. No transcripts, so this is safe to render into a page.
 *
 * A component whose input is unavailable is **omitted**, and its weight leaves the denominator with it — a
 * missing measurement must not quietly count as zero and drag a score down.
 */
export function repoComponents({ contrib, health, plan, index, tags = null, versions = null }) {
  const out = [];
  const q = contrib?.available ? contrib.quality : null;
  const add = (c) => { if (c.score !== null && c.score !== undefined) out.push(c); };

  if (q) {
    add({
      id: 'conventionalSubjects', group: 'Practice', label: 'Conventional commit subjects',
      figure: `${q.conventionalRate}%`, target: '100% — the convention is in CONTRIBUTING',
      score: direct(q.conventionalRate),
      suggestion: 'Subjects that do not parse are invisible to every report that groups by type.',
    });
  }

  if (contrib?.available && contrib.commits?.length) {
    const share = pct(contrib.commits.filter((c) => c.desk).length, contrib.commits.length);
    add({
      id: 'deskAttribution', group: 'Practice', label: 'Commits carrying a Desk: trailer',
      figure: `${Math.round(share)}%`, target: '100% going forward — history cannot be re-tagged',
      score: direct(share),
      suggestion: 'Per-desk figures cover only the tagged remainder, so any breakdown by working context is a sample.',
    });
  }

  if (q && plan && !plan.missing && plan.items?.length) {
    const share = pct(q.withTaskRef ?? 0, plan.items.length);
    add({
      id: 'specNaming', group: 'Practice', label: 'Plan items named by a commit',
      figure: `${Math.round(share)}%`, target: 'every item that has been worked on',
      score: direct(share),
      suggestion: 'The plan and the work are describing different projects. Name the item in the subject — the commit gate now requires it.',
    });
  }

  if (Number.isInteger(tags) && Number.isInteger(versions) && versions > 0) {
    const share = pct(Math.min(tags, versions), versions);
    add({
      id: 'releaseMarked', group: 'Practice', label: 'Released versions carrying a tag',
      figure: `${Math.round(share)}%`, target: 'one tag per released version',
      score: direct(share),
      suggestion: 'An untagged release cannot be checked out by the version anyone reports a bug against.',
    });
  }

  if (q && typeof q.reworkRate === 'number') {
    add({
      id: 'rework', group: 'Outcome', label: `Files not re-touched within ${q.reworkWindowDays} days`,
      figure: `${q.reworkRate}% rework`, target: 'under 30% — the usual band',
      score: inverse(q.reworkRate, 80),
      suggestion: 'Work is not landing finished. Either it ships before being verified, or it is split too finely to stand alone.',
    });
  }

  if (q && typeof q.revertRate === 'number') {
    add({
      id: 'reverts', group: 'Outcome', label: 'Changes that survived',
      figure: `${q.revertRate}% reverted`, target: 'under 3%',
      score: inverse(q.revertRate, 20),
      suggestion: 'A revert is the clearest possible signal that something shipped unverified.',
    });
  }

  if (health && index?.stats?.documents) {
    const advisory = Object.values(health.counts || {}).reduce((a, b) => a + b, 0);
    const perDoc = advisory / index.stats.documents;
    add({
      id: 'docHealth', group: 'Outcome', label: 'Documentation free of rot signals',
      figure: health.blockingCount ? `${health.blockingCount} blocking` : `${advisory} advisory`,
      target: 'zero blocking; advisory ones have legitimate causes',
      score: health.blockingCount ? 0 : inverse(perDoc * 100, 200),
      suggestion: health.blockingCount
        ? 'Blocking signals have no legitimate cause. These are defects in the corpus now.'
        : 'Advisory signals are worth reading as a delta, not an absolute.',
    });
  }

  if (contrib?.available && Array.isArray(contrib.people)) {
    const n = contrib.people.length;
    add({
      id: 'busFactor', group: 'Outcome', label: 'Authors who have ever committed',
      figure: String(n), target: 'more than one',
      score: n >= 3 ? 100 : n === 2 ? 60 : 0,
      suggestion: 'One author means nothing here has been read by a second pair of eyes.',
    });
  }

  return out;
}

/**
 * Interaction components, from local session transcripts. Never called by the build.
 *
 * These measure the **outcome** of a collaboration, not the quality of anyone's prompts, and each says so.
 */
export function sessionComponents(k) {
  if (!k || !k.available) return [];
  const o = k.overall || k;
  const out = [];
  const add = (c) => { if (c.score !== null && c.score !== undefined) out.push(c); };

  if (typeof o.toolErrorRate === 'number') {
    add({
      id: 'toolErrors', group: 'Interaction', label: 'Tool calls that succeeded first time',
      figure: `${o.toolErrorRate}% failed`, target: 'under 5%',
      score: inverse(o.toolErrorRate, 30),
      suggestion: 'A high rate usually means the environment was not understood before it was acted on.',
    });
  }
  if (typeof o.userModifiedEdits === 'number' && o.assistantTurns) {
    const share = pct(o.userModifiedEdits, o.assistantTurns);
    add({
      id: 'handCorrections', group: 'Interaction', label: 'Results not corrected by hand afterwards',
      figure: `${o.userModifiedEdits} corrected`, target: 'as few as possible',
      score: inverse(share, 25),
      suggestion: 'A file edited by hand after being written is a direct correction — the clearest interaction signal there is.',
    });
  }
  if (typeof o.compactions === 'number' && o.sessions) {
    add({
      id: 'scopeSplit', group: 'Interaction', label: 'Sessions that fitted their context window',
      figure: `${o.compactions} compaction(s)`, target: 'zero',
      score: inverse(pct(o.compactions, o.sessions), 100),
      suggestion: 'A session that outgrew its window is a proxy for scope that was not split.',
    });
  }
  return out;
}

/**
 * The weighted total, plus what to do about it.
 *
 * Returns `null` for the total when nothing could be measured — never `0`, which would read as a verdict
 * rather than an absence.
 */
export function scorecard(components, weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const scored = components.map((c) => ({ ...c, weight: w[c.id] ?? 1 }));
  const denom = scored.reduce((a, c) => a + c.weight, 0);
  const total = denom > 0 ? Math.round(scored.reduce((a, c) => a + c.score * c.weight, 0) / denom) : null;

  // Worst first, weighted — a 40 carrying weight 3 costs more than a 10 carrying weight 1.
  const actions = scored
    .filter((c) => c.score < 80)
    .sort((a, b) => (a.score * (1 / a.weight)) - (b.score * (1 / b.weight)))
    .slice(0, 5)
    .map((c) => ({ id: c.id, label: c.label, figure: c.figure, score: c.score, weight: c.weight, suggestion: c.suggestion }));

  return { total, components: scored, actions, denom };
}
