/**
 * project-atlas · risk, from measured numbers only
 *
 * The dashboard reported figures and drew no conclusion from any of them. A reader saw "rework rate 68.8%"
 * and had to already know that 30% is the usual band, that rework counts a file re-touched inside three days,
 * and that on a two-day-old repository it means something different than on a two-year-old one. Every figure
 * needed a maintainer standing next to it.
 *
 * So each signal here carries four things and refuses to exist without them:
 *
 *   1. a **measured number**, taken from the corpus or from `git log` — never estimated here
 *   2. the **threshold** it is being judged against, stated in the output rather than hidden in this file
 *   3. what it **implies**, in one sentence
 *   4. what it **cannot** mean, wherever the number is commonly over-read
 *
 * ## Why this is not generated prose
 *
 * The build never calls a model. This is a lookup from a number to a sentence with a stated threshold, so it
 * is deterministic, regenerable, and arguable: if you disagree with the 30% band you can change it and the
 * page changes with it. A narrative that needs judgement belongs in `docs/ANALYSIS.md`, written in a session
 * and landing in a diff a human reviewed — which is the same rule that keeps unreviewed prose off every other
 * page this tool generates.
 *
 * ## The thresholds are defaults, not truths
 *
 * Every band below is a starting point, overridable per repository. A team that ships hourly will re-touch
 * files inside three days as a matter of course; a team shipping quarterly will not. The point of stating the
 * threshold on the page is that the reader can see the judgement being applied and reject it.
 */

/** Default bands. `risk` fires above (or below, for coverage-style signals) the first number; `watch` the second. */
export const BANDS = {
  reworkRate: { risk: 50, watch: 30 },
  revertRate: { risk: 10, watch: 3 },
  orphanShare: { risk: 40, watch: 20 },      // percent of the corpus nothing links to
  specCoverage: { risk: 10, watch: 40 },     // percent of items named by at least one commit — low is bad
  busFactor: { risk: 1, watch: 2 },          // authors who have ever committed
  deskCoverage: { risk: 40, watch: 75 },     // percent of commits carrying a Desk: trailer
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Every risk signal worth showing, most severe first.
 *
 * Returns `{ level, id, headline, figure, threshold, means, notMeans }`. A signal whose input is unavailable
 * is **omitted, not shown as zero** — the same rule the health report follows, because a green line for a
 * check that never ran is the worst output this tool could produce.
 */
export function risks({ index, health, plan, contrib }) {
  const out = [];
  const add = (s) => out.push(s);

  const band = (value, { risk, watch }, invert = false) => {
    if (value === null || value === undefined) return null;
    const over = invert ? value <= risk : value >= risk;
    const near = invert ? value <= watch : value >= watch;
    return over ? 'risk' : near ? 'watch' : 'ok';
  };

  /* ---- blocking findings: the only signal with no legitimate cause ---- */
  if (health) {
    add({
      level: health.blockingCount ? 'risk' : 'ok',
      id: 'blocking',
      headline: health.blockingCount
        ? `${health.blockingCount} blocking documentation finding(s)`
        : 'No blocking documentation findings',
      figure: String(health.blockingCount ?? 0),
      threshold: 'any is too many — blocking signals have no legitimate cause',
      means: health.blockingCount
        ? 'A dead internal link, a duplicate title or a missing heading is in the corpus now.'
        : 'Every mechanical check the corpus can fail, it passes.',
    });
  }

  /* ---- rework: the strongest available signal that work is not landing first time ---- */
  const q = contrib?.available ? contrib.quality : null;
  if (q && typeof q.reworkRate === 'number') {
    const level = band(q.reworkRate, BANDS.reworkRate);
    add({
      level, id: 'rework',
      headline: `${q.reworkRate}% of files are re-touched within ${q.reworkWindowDays} days`,
      figure: `${q.reworkRate}%`,
      threshold: `watch above ${BANDS.reworkRate.watch}%, risk above ${BANDS.reworkRate.risk}%`,
      means: 'Changes are not landing finished. Either they ship before being verified, or they are being split too finely to stand alone.',
      notMeans: 'It is not a measure of care. A repository under active design re-touches files constantly and should.',
    });
  }

  /* ---- bus factor ---- */
  if (contrib?.available && Array.isArray(contrib.people)) {
    const n = contrib.people.length;
    add({
      level: band(n, BANDS.busFactor, true), id: 'bus',
      headline: n === 1 ? 'One author has written everything' : `${n} authors in the history`,
      figure: String(n),
      threshold: `risk at ${BANDS.busFactor.risk}, watch at ${BANDS.busFactor.watch}`,
      means: n === 1
        ? 'Every file has exactly one person who has ever touched it. Nothing here has been read by a second pair of eyes.'
        : 'More than one person has committed, so no single area is structurally unreviewed.',
      notMeans: n === 1 ? 'It is not a comment on the work — it is a statement about what happens if that person stops.' : null,
    });
  }

  /* ---- spec coverage: does the plan know what the work did? ---- */
  if (plan && !plan.missing && plan.items?.length && q) {
    const named = q.withTaskRef ?? 0;
    const share = pct(named, plan.items.length);
    add({
      level: band(share, BANDS.specCoverage, true), id: 'spec',
      headline: `${named} of ${plan.items.length} plan items are named by a commit`,
      figure: `${share ?? 0}%`,
      threshold: `risk below ${BANDS.specCoverage.risk}%, watch below ${BANDS.specCoverage.watch}%`,
      means: 'The plan and the work are describing different projects. Nothing in the history says which item it advanced, so no figure on the plan can be trusted to be current.',
      notMeans: 'A low number can be a commit convention — subjects that name the defect rather than the ticket — rather than abandoned work.',
    });
  }

  /* ---- orphans: how much of the corpus is unreachable ---- */
  if (health?.counts && index?.stats?.documents) {
    const orphans = health.counts.H4 ?? 0;
    const share = pct(orphans, index.stats.documents);
    add({
      level: band(share, BANDS.orphanShare), id: 'orphans',
      headline: `${orphans} of ${index.stats.documents} documents have no inbound link`,
      figure: `${share ?? 0}%`,
      threshold: `watch above ${BANDS.orphanShare.watch}%, risk above ${BANDS.orphanShare.risk}%`,
      means: 'That share of the corpus is reachable only by already knowing it exists — search finds it, browsing does not.',
      notMeans: 'Entry points are orphans by nature. A README nothing links to is not a defect.',
    });
  }

  /* ---- attribution coverage ---- */
  if (contrib?.available && contrib.commits?.length) {
    const total = contrib.commits.length;
    const tagged = contrib.commits.filter((c) => c.desk).length;
    const share = pct(tagged, total);
    if (share !== null) {
      add({
        level: band(share, BANDS.deskCoverage, true), id: 'desk',
        headline: `${tagged} of ${total} commits carry a Desk: trailer`,
        figure: `${share}%`,
        threshold: `risk below ${BANDS.deskCoverage.risk}%, watch below ${BANDS.deskCoverage.watch}%`,
        means: 'Per-desk figures cover only the tagged remainder, so any breakdown by working context is a sample rather than the whole.',
        notMeans: 'History cannot be re-tagged, so early commits will never carry one. The number only improves going forward.',
      });
    }
  }

  const order = { risk: 0, watch: 1, ok: 2 };
  return out.filter((s) => s.level).sort((a, b) => order[a.level] - order[b.level]);
}

/** One line summarising the set, for a page that wants a verdict before the detail. */
export function summarise(list) {
  const risk = list.filter((s) => s.level === 'risk').length;
  const watch = list.filter((s) => s.level === 'watch').length;
  if (!list.length) return 'Nothing measurable yet — this repository has no history to read.';
  if (!risk && !watch) return `${list.length} signal(s) checked, all inside their bands.`;
  return `${risk} signal(s) outside their band, ${watch} approaching it, ${list.length - risk - watch} clear. ` +
         `Every threshold below is a default you can change.`;
}
