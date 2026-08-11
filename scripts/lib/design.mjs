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

/**
 * The marker a scaffolded document carries until somebody writes it.
 *
 * A scaffold is genuinely useful — it names the questions an artifact has to answer, which is most of the
 * difficulty — but the moment an empty file exists, a record that only knows *present* and *absent* starts
 * reporting a design record this repository does not have. That is worse than the gap it closed: an absence
 * is honest, and a false presence is measured against by every other check.
 *
 * So a scaffold declares itself, and the record carries a third state. The marker is removed by the person
 * who writes the substance, and nothing removes it automatically — a tool that cleared it on their behalf
 * would be asserting that the document had been written.
 */
export const STUB_MARKER = '<!-- atlas:stub — scaffolded, not yet written. Delete this line when the substance is here. -->';

/** Has this document been written, or only scaffolded? */
export function isStub(body) {
  return String(body || '').includes('atlas:stub');
}

/** The artifacts a design record is normally expected to carry, and how to recognise each. */
export const EXPECTED = [
  { id: 'hld', label: 'High-level design', re: /(^|\/)(HLD|high[-_ ]?level[-_ ]?design)[^/]*\.md$/i },
  { id: 'lld', label: 'Low-level design', re: /(^|\/)(LLD|low[-_ ]?level[-_ ]?design)[^/]*\.md$/i },
  { id: 'architecture', label: 'Architecture overview', re: /(^|\/)ARCHITECTURE[^/]*\.md$/i },
  { id: 'dataflow', label: 'Data flow', re: /(^|\/)(DATA[-_ ]?FLOW|dataflow)[^/]*\.md$/i },
  { id: 'decisions', label: 'Decision records', re: /(^|\/)(adr|decisions?)\/|(^|\/)ADR[-_ ]?\d+/i },
  // Matched on a separator rather than on \b, because \b does not break on an underscore: `\bSRS\b` never
  // matches inside PROJECT_SRS_v1.md. The old pattern required a dash or underscore immediately before the
  // word and `.md` immediately after, so it found payments-srs.md and missed SRS.md, SRS_v2.md and
  // PROJECT_SRS_v1.md — a repository could carry a specification this tool reported as absent.
  { id: 'specs', label: 'Specifications', re: /(^|\/)(specs?|rfc)\/|(^|\/|[-_ ])(srs|spec)s?([-_ .]|\.md$)/i },
  // Neither of these was recognised at all. A PRD is what the product is supposed to do; a manual of style is
  // the document that makes every other document consistent, which is the one most likely to exist as prose
  // nobody indexed.
  { id: 'prd', label: 'Product requirements', re: /(^|\/|[-_ ])(prd)([-_ .]|\.md$)|(^|\/)product[-_ ]?requirements?[^/]*\.md$/i },
  { id: 'style', label: 'Manual of style', re: /(^|\/|[-_ ])(mos)([-_ .]|\.md$)|(^|\/)(manual[-_ ]of[-_ ]style|style[-_ ]?guide|styleguide|STYLE)[^/]*\.md$/i },
];

/** True when a document is any kind of design artifact — the predicate the health signals filter by. */
export function isDesignDoc(pathname) {
  return EXPECTED.some((e) => e.re.test(pathname));
}

/** Which expected artifacts the corpus has, and which it does not. An absence is a finding, not a blank. */
export function designRecord(documents) {
  return EXPECTED.map((e) => {
    const found = documents.filter((d) => e.re.test(d.path));
    // Three states, not two. `present` stays a boolean for every existing caller, and `state` carries the
    // distinction that matters: a scaffold is not a design record, and must never be counted as one.
    const written = found.filter((d) => !isStub(d.body));
    const state = !found.length ? 'absent' : (written.length ? 'written' : 'stub');
    return {
      id: e.id, label: e.label,
      present: written.length > 0,
      state,
      documents: found.map((d) => d.path),
      stubs: found.filter((d) => isStub(d.body)).map((d) => d.path),
    };
  });
}

/**
 * The order the blueprint reads the record in.
 *
 * Dependency order, not the order `EXPECTED` happens to list. Each artifact below is written against the one
 * above it: intent, then the requirements drawn from it, then the orientation a newcomer needs, then the
 * shape, then what moves through the shape, then the detail inside the parts. Reasoning and house style come
 * last because both are read against everything already stated.
 *
 * `EXPECTED` order — HLD, LLD, architecture, data flow — hands a reader the low-level detail before the thing
 * it is detail *of*, which is exactly why nobody assembles these documents by hand and why five separate
 * documents never became one view.
 */
export const BLUEPRINT_ORDER = ['prd', 'specs', 'architecture', 'hld', 'dataflow', 'lld', 'decisions', 'style'];

/**
 * The design record assembled into one ordered reading, entirely out of the documents themselves.
 *
 * Nothing here is composed. Every string this returns is a path, a title, a heading, a date or a count read
 * off a document in the corpus; the only thing the function contributes is the order. A version that
 * summarised, joined or paraphrased would be authoring design claims nobody reviewed, into the one corpus
 * every other check on this site measures drift against — the failure this project exists to detect,
 * committed by the page that reports it.
 *
 * The three states reach the renderer intact, because they are the whole point. A section backed by a
 * scaffold carries `stub` and no excerpt, so the page can say the substance is owed rather than laying out a
 * scaffold's empty headings in the same shape it uses for a written document. A repository where every
 * artifact is a scaffold must produce a blueprint that reads as a list of what is owed.
 */
export function blueprint(documents) {
  const record = new Map(designRecord(documents).map((r) => [r.id, r]));
  const health = new Map(citationHealth(documents).map((h) => [h.path, h]));
  const byPath = new Map(documents.map((d) => [d.path, d]));

  return BLUEPRINT_ORDER.map((id) => {
    const r = record.get(id);
    const stubs = new Set(r.stubs);
    return {
      id, label: r.label, state: r.state,
      documents: r.documents.map((p) => {
        const d = byPath.get(p) || {};
        const c = health.get(p) || { total: 0, resolved: 0, broken: 0, unchecked: 0 };
        const stub = stubs.has(p);
        return {
          path: p, stub,
          title: d.title || p,
          // The document's own second-level headings, and no gloss on them. In a written document these are
          // what it covers; in a scaffold they are literally the questions it has not answered, because
          // `scaffold.mjs` writes one heading per question. The same field carries both, which is honest —
          // the difference is the state beside it, not a different kind of data.
          sections: (d.headings || []).filter((h) => h.depth === 2).map((h) => ({ text: h.text, slug: h.slug })),
          // Quoted verbatim, and only from a written document. A scaffold's opening paragraph is the
          // template's warning about itself; reprinting it under a heading would put boilerplate where a
          // reader expects the document's own account of the system.
          excerpt: stub ? null : (d.excerpt || null),
          date: d.git?.date || null,
          citations: { total: c.total, resolved: c.resolved, broken: c.broken, unchecked: c.unchecked },
        };
      }),
    };
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
      // `resolved` is the resolved PATH when a citation was matched, and `null` when it was not. It is never
      // a boolean — so `=== true` counted nothing and `=== false` counted nothing, and this panel reported
      // "0 resolved" for every document in the corpus while the totals disagreed with the parts. `undefined`
      // is kept as the genuinely-unchecked case: a citation list that was never populated at all.
      const resolved = cites.filter((c) => typeof c.resolved === 'string' && c.resolved).length;
      const broken = cites.filter((c) => c.resolved === null).length;
      const unchecked = cites.filter((c) => c.resolved === undefined).length;
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
  const missing = record.filter((r) => r.state === 'absent');
  const stubbed = record.filter((r) => r.state === 'stub');
  const bare = gaps.filter((g) => g.citations === 0);
  const parts = [];
  parts.push(missing.length
    ? `${missing.length} expected design artifact(s) absent: ${missing.map((m) => m.label).join(', ')}.`
    : stubbed.length
      ? `Every expected artifact exists, but ${stubbed.length} ${stubbed.length === 1 ? 'is' : 'are'} still a scaffold with no substance in it.`
      : 'Every expected design artifact is present.');
  if (bare.length) {
    parts.push(`${bare.length} of ${gaps.length} code area(s) are cited by no design document.`);
  }
  parts.push('Coverage, not quality — a documented area may be described badly, and an undocumented one may need no design.');
  return parts.join(' ');
}
