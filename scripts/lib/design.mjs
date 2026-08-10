/**
 * project-atlas · the design record, and where it stops describing the code
 *
 * The Architecture view listed the documents in the engineering cluster and left the reader to open each one
 * and judge. For a solution architect the useful questions are narrower and none of them were answered:
 *
 *   1. **Which design artifacts exist at all?** HLD, LLD, data flow, decision records — a missing one is the
 *      most valuable thing on the page and a list of what is present cannot show an absence.
 *   2. **Does the design still describe the code?** A design document earns its place by citing code. One
 *      that cites nothing is prose; one whose citations no longer resolve is describing a program that no
 *      longer exists.
 *   3. **What is built but undesigned?** The inverse, and the one nobody computes: which parts of the
 *      codebase no design document mentions.
 *
 * ## The inversion is the point
 *
 * Question 3 is the only one that finds something a reader was not already worried about. It is computed by
 * taking the areas that exist in the repository and subtracting the areas any design document cites — so it
 * reports *"nothing in the design record mentions scripts/lib"*, which is a sentence someone can act on.
 *
 * It is a coverage measure, not a quality one. An area with a design document may be described badly, and an
 * area without one may be three files that need no design at all. Both are stated on the page.
 */

/** The artifacts a design record is normally expected to carry, and how to recognise each. */
export const EXPECTED = [
  { id: 'hld', label: 'High-level design', re: /(^|\/)(HLD|high[-_ ]?level[-_ ]?design)[^/]*\.md$/i },
  { id: 'lld', label: 'Low-level design', re: /(^|\/)(LLD|low[-_ ]?level[-_ ]?design)[^/]*\.md$/i },
  { id: 'architecture', label: 'Architecture overview', re: /(^|\/)ARCHITECTURE[^/]*\.md$/i },
  { id: 'dataflow', label: 'Data flow', re: /(^|\/)(DATA[-_ ]?FLOW|dataflow)[^/]*\.md$/i },
  { id: 'decisions', label: 'Decision records', re: /(^|\/)(adr|decisions?)\/|(^|\/)ADR[-_ ]?\d+/i },
  { id: 'specs', label: 'Specifications', re: /(^|\/)(specs?|rfc)\/|[-_](spec|srs)\.md$/i },
];

/** Which expected artifacts the corpus has, and which it does not. An absence is a finding, not a blank. */
export function designRecord(documents) {
  return EXPECTED.map((e) => {
    const found = documents.filter((d) => e.re.test(d.path));
    return { id: e.id, label: e.label, present: found.length > 0, documents: found.map((d) => d.path) };
  });
}

/**
 * Citation health per design document.
 *
 * `resolved` is `null` when the citation was never checked — an unreadable target, or a scan run with
 * `--no-git`. Null is kept distinct from `false` throughout: "not checked" and "does not resolve" are
 * different claims, and collapsing them would report a document as sound because nobody looked.
 */
export function citationHealth(documents) {
  return documents
    .map((d) => {
      const cites = d.citations || [];
      const resolved = cites.filter((c) => c.resolved === true).length;
      const broken = cites.filter((c) => c.resolved === false).length;
      const unchecked = cites.filter((c) => c.resolved === null || c.resolved === undefined).length;
      return {
        path: d.path, title: d.title || d.path,
        total: cites.length, resolved, broken, unchecked,
        date: d.git?.date || null,
        // A design document that cites no code is not wrong — it may be a diagram or a rationale — but it
        // cannot go stale against anything either, and that is worth saying rather than scoring.
        grounded: cites.length > 0,
      };
    })
    .sort((a, b) => b.broken - a.broken || b.total - a.total);
}

/** First `depth` path segments — the same area key ownership uses, so the two panels agree. */
function areaOf(p, depth = 2) {
  const parts = String(p || '').split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

/**
 * Code areas no design document cites.
 *
 * `codeFiles` is the tracked source, `designDocs` the documents whose citations count as design coverage.
 * An area is covered when any design document cites a file inside it — deliberately generous, because the
 * claim being made is only "the design record mentions this at all".
 */
export function undesigned(codeFiles, designDocs, { depth = 2, minFiles = 2 } = {}) {
  const areas = new Map();
  for (const f of codeFiles) {
    const key = areaOf(f, depth);
    if (!areas.has(key)) areas.set(key, { area: key, files: 0, cited: 0, by: new Set() });
    areas.get(key).files++;
  }

  for (const d of designDocs) {
    for (const c of d.citations || []) {
      const key = areaOf(c.path, depth);
      const a = areas.get(key);
      if (!a) continue;                      // a citation to something that is not tracked source
      a.cited++;
      a.by.add(d.path);
    }
  }

  return [...areas.values()]
    // One or two files is not an area worth a design document, and listing them buries the ones that are.
    .filter((a) => a.files >= minFiles)
    .map((a) => ({ area: a.area, files: a.files, citations: a.cited, by: [...a.by] }))
    .sort((x, y) => x.citations - y.citations || y.files - x.files || x.area.localeCompare(y.area));
}

/** One line over the set, stating the limit of the claim. */
export function summariseDesign(record, gaps) {
  const missing = record.filter((r) => !r.present);
  const bare = gaps.filter((g) => g.citations === 0);
  const parts = [];
  parts.push(missing.length
    ? `${missing.length} expected design artifact(s) absent: ${missing.map((m) => m.label).join(', ')}.`
    : 'Every expected design artifact is present.');
  if (bare.length) {
    parts.push(`${bare.length} of ${gaps.length} code area(s) are cited by no design document.`);
  }
  parts.push('Coverage, not quality — a documented area may be described badly, and an undocumented one may need no design.');
  return parts.join(' ');
}
