/**
 * project-atlas · who is the only person who has ever touched this
 *
 * "Bus factor 1" as a repository-wide number is nearly useless: it says one person wrote everything, which
 * on a young project is a fact about its age rather than a risk anyone can act on. The actionable version is
 * per-area — *these seven directories have exactly one author, and one of them is the publishing path* —
 * because that names something to do.
 *
 * Read from `git log --name-only`, which is already being walked for the contribution figures, so this costs
 * one more pass over data in memory rather than another traversal of history.
 *
 * ## What a single author does and does not mean
 *
 * It does **not** mean the code is bad, unreviewed by anyone, or unmaintainable. It means that if that person
 * stops, nobody left has ever edited those files. That is a statement about the future, and it is the only
 * claim the data supports — so it is the only one made. An area with two authors where one wrote 99% of the
 * lines is reported as two, because "meaningful contribution" is a judgement this cannot make and should not
 * pretend to.
 */

/** Directory an area is keyed on: the first two path segments, so `scripts/lib` and `skills/ask` stay apart. */
export function areaOf(p, depth = 2) {
  const parts = String(p || '').split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

/**
 * Ownership per area, most concentrated first.
 *
 * `commits` must carry `author` and `files`. Each file is `{ path, added, removed }` — reading it as a bare
 * string put every path into one `(root)` bucket and reported 401 files under a single area, which looked
 * plausible enough to ship and said nothing at all.
 *
 * An area nobody has committed to does not appear — there is no such thing, and inventing a row for an empty
 * directory would be a claim about nothing.
 */
export function ownership(commits, { depth = 2, minCommits = 2 } = {}) {
  const areas = new Map();
  for (const c of commits || []) {
    for (const f of c.files || []) {
      const key = areaOf(f.path ?? f, depth);
      if (!areas.has(key)) areas.set(key, { area: key, authors: new Map(), files: new Set(), commits: 0 });
      const a = areas.get(key);
      a.files.add(f.path ?? f);
      a.authors.set(c.author, (a.authors.get(c.author) || 0) + 1);
    }
    for (const key of new Set((c.files || []).map((f) => areaOf(f.path ?? f, depth)))) areas.get(key).commits++;
  }

  return [...areas.values()]
    // An area with one commit is not concentrated, it is new. Reporting it as a bus-factor risk would bury
    // the real ones under noise the first week of any project.
    .filter((a) => a.commits >= minCommits)
    .map((a) => ({
      area: a.area,
      files: a.files.size,
      commits: a.commits,
      authors: [...a.authors.entries()].sort((x, y) => y[1] - x[1]).map(([name, n]) => ({ name, commits: n })),
      busFactor: a.authors.size,
    }))
    .sort((x, y) => x.busFactor - y.busFactor || y.files - x.files || x.area.localeCompare(y.area));
}

/** The single number, and the honest caveat that goes with it. */
export function summariseOwnership(list, totalAuthors) {
  if (!list.length) return null;
  const sole = list.filter((a) => a.busFactor === 1);
  if (totalAuthors <= 1) {
    return `${list.length} area(s), all written by one author — this repository has a single committer, so ` +
           `per-area ownership says nothing a second contributor would not immediately change.`;
  }
  if (!sole.length) return `Every one of ${list.length} area(s) has been touched by more than one author.`;
  return `${sole.length} of ${list.length} area(s) have exactly one author who has ever touched them.`;
}
