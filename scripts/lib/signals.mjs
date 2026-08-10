/**
 * project-atlas · the rot-signal catalogue
 *
 * Its own module for one reason: both `config.mjs` (to validate the `blocking` list against real ids) and
 * `health.mjs` (to evaluate them) need it. Importing it from `health.mjs` into `config.mjs` created a cycle
 * that happened to resolve — health only touches config inside `runHealth`, config only touches SIGNALS
 * inside `validate()` — but "happens to resolve" is a property of current call order, not of the design. One
 * top-level `Object.keys(SIGNALS)` in either file would have turned it into a TDZ crash at import time.
 *
 * A leaf module with no imports of its own cannot participate in a cycle at all.
 */

export const SIGNALS = {
  H1: { id: 'H1', title: 'Dead internal link', why: 'A relative link points at a file that does not exist.' },
  H2: { id: 'H2', title: 'Unresolvable code citation', why: 'A path:line citation names a file that is gone, or a line past its end.' },
  H3: { id: 'H3', title: 'Duplicate title', why: 'Two documents claim the same H1 — the classic signature of a forked document.' },
  H4: { id: 'H4', title: 'Orphan', why: 'No other document links to it, so it is reachable only by knowing it exists.' },
  H5: { id: 'H5', title: 'Unclassified', why: 'Matched no cluster rule and fell through to the fallback.' },
  H6: { id: 'H6', title: 'Stale against its citations', why: 'Code it cites was committed after the document was last touched.' },
  H7: { id: 'H7', title: 'Forbidden term', why: 'Contains a term the project has retired (an old name, old branding).' },
  H8: { id: 'H8', title: 'Missing title', why: 'No H1 heading, so it has no name in any index.' },
  H9: { id: 'H9', title: 'Cross-reference asymmetry', why: 'An identifier appears in one of a paired set of documents but not the other.' },

  /*
   * The design record — HLD, LLD, architecture, data flow, decision records, specifications.
   *
   * `design.mjs` has recognised these since it was written and `health.mjs` never referenced any of it, so a
   * repository could ship for a year with every design artifact missing and the corpus reported clean. These
   * three make it a finding, and the blocking/advisory split is the same judgement the rest of the catalogue
   * makes: enforce only what has no legitimate exception.
   */
  H14: { id: 'H14', title: 'Design document cites code that moved',
    why: 'A design document is a claim about how the code works. When the code it cites has moved, the claim is wrong rather than merely old — which is why this is stricter than H6.' },
  H15: { id: 'H15', title: 'Expected design artifact absent',
    why: 'A kind of design document the record normally carries is missing entirely. Advisory: a small repository legitimately has no LLD, and demanding one would be cargo cult.' },
  H16: { id: 'H16', title: 'Undesigned area',
    why: 'A code area no design document cites. Advisory: not everything needs a design document, and this is a question rather than an accusation.' },
};
