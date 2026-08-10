/**
 * project-atlas · the questions an artifact has to answer, and nothing else
 *
 * The Architecture page reports eight design artifacts absent and offers no way to close the gap, which is
 * accurate and unsatisfying in equal measure. The obvious fix — generate the documents — is the one thing
 * this project must not do: a machine can describe what the code *is*, but a design document is a set of
 * claims about what it is *for* and what was rejected, and generated claims nobody reviewed are exactly the
 * failure this tool exists to detect. Worse, they would land in the documents other checks measure drift
 * against, so the corpus would start lying to its own health report.
 *
 * What is genuinely hard about writing an HLD is not the headings. It is knowing which questions the
 * document owes an answer to. That part is a template, and a template is honest.
 *
 * ## The rule that makes this safe
 *
 * Every scaffold carries a marker, and the design record reads it as a **third state** — `absent`, `stub`,
 * `written`. A scaffold never counts as a design record. Without that, creating the files would convert an
 * honest absence into a false presence, which is worse than the gap: an absence is visible, and a false
 * presence is trusted.
 *
 * Nothing removes the marker automatically. The person who writes the substance deletes it, because a tool
 * that cleared it would be asserting the document had been written.
 */

import fs from 'node:fs';
import path from 'node:path';
import { STUB_MARKER } from './design.mjs';

/**
 * What each artifact owes an answer to.
 *
 * Written as questions rather than headings on purpose: a heading called "Overview" tells you nothing about
 * what belongs under it, and the blank page under it is where these documents die.
 */
export const TEMPLATES = {
  hld: {
    file: 'docs/design/HLD.md',
    title: 'High-level design',
    questions: [
      'What problem does this system solve, and for whom? Name the reader.',
      'What are its major parts, and what does each one own?',
      'How do those parts talk to each other, and what crosses a boundary?',
      'What was considered and rejected, and why? This is the part nobody can reconstruct later.',
      'What does this design make hard? Every structure forecloses something.',
    ],
  },
  lld: {
    file: 'docs/design/LLD.md',
    title: 'Low-level design',
    questions: [
      'Which modules exist, and what is each one responsible for?',
      'What are the important data structures, and what invariants must hold?',
      'Which failure modes are handled, and which are deliberately not?',
      'Where is the complexity concentrated, and why is it there rather than elsewhere?',
    ],
  },
  architecture: {
    file: 'docs/design/ARCHITECTURE.md',
    title: 'Architecture overview',
    questions: [
      'What does a reader need to know before reading any other document here?',
      'What are the load-bearing decisions someone would break by accident?',
      'Where does the code disagree with this document today?',
    ],
  },
  dataflow: {
    file: 'docs/design/DATA-FLOW.md',
    title: 'Data flow',
    questions: [
      'What enters the system, from where, and in what shape?',
      'What transforms it, in what order, and what is derived rather than stored?',
      'What leaves the system, and what is the boundary it crosses?',
      'What is persisted, and what is safe to delete?',
    ],
  },
  decisions: {
    file: 'docs/decisions/0001-example.md',
    title: 'Decision record',
    questions: [
      'What was decided?',
      'What forced the decision — what were the constraints?',
      'What else was considered, and what specifically ruled it out?',
      'What does this decision now make difficult, and what would have to change to revisit it?',
    ],
  },
  specs: {
    file: 'docs/design/SRS.md',
    title: 'Specification',
    questions: [
      'What must the system do, stated so that a disagreement about whether it does is settleable?',
      'What must it never do?',
      'What is explicitly out of scope, so nobody has to guess?',
    ],
  },
  prd: {
    file: 'docs/design/PRD.md',
    title: 'Product requirements',
    questions: [
      'Who is this for, and what are they trying to get done?',
      'What does success look like, in terms someone could measure?',
      'What are we deliberately not building, and why?',
    ],
  },
  style: {
    file: 'docs/design/MANUAL-OF-STYLE.md',
    title: 'Manual of style',
    questions: [
      'What tone and person do documents here use?',
      'What is always stated — units, dates, estimates, caveats?',
      'What is never written — and what should be linked or derived instead?',
    ],
  },
};

/** The body of one scaffold. */
export function render(kind) {
  const t = TEMPLATES[kind];
  if (!t) return null;
  const L = [];
  L.push(`# ${t.title}`);
  L.push('');
  L.push(STUB_MARKER);
  L.push('');
  L.push('**Owner:** _unassigned_');
  L.push('**Last verified:** _never_');
  L.push('');
  L.push('> **This is a scaffold, not a design document.** It exists so the questions are written down; the');
  L.push('> answers are not, and this file is reported as a stub until somebody writes them. Delete the');
  L.push('> marker above when it holds real content — nothing removes it for you, because nothing else can');
  L.push('> know that the substance is here.');
  L.push('');
  for (const q of t.questions) {
    L.push(`## ${q}`);
    L.push('');
    L.push('_Unanswered._');
    L.push('');
  }
  return L.join('\n');
}

/**
 * Write scaffolds for the artifacts that are absent.
 *
 * **Never overwrites.** An existing file is left exactly as it is, whether it is a finished document or
 * somebody's half-written draft — losing a paragraph of real design thinking to a template would be the
 * worst possible trade, and it is the trade a `--force` here would eventually make by accident.
 */
export function scaffold(root, record, { kinds = null } = {}) {
  const written = [], skipped = [];
  for (const r of record) {
    if (kinds && !kinds.includes(r.id)) continue;
    if (r.state !== 'absent') { skipped.push({ id: r.id, why: `already ${r.state}` }); continue; }
    const t = TEMPLATES[r.id];
    if (!t) { skipped.push({ id: r.id, why: 'no template' }); continue; }
    const file = path.join(root, t.file);
    if (fs.existsSync(file)) { skipped.push({ id: r.id, why: 'file already exists' }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, render(r.id), 'utf8');
    written.push({ id: r.id, file: t.file });
  }
  return { written, skipped };
}
