/**
 * project-atlas · the test cases, as a list a QC reader can act on
 *
 * The Quality view reported *how often work has to be redone* and never once said **what is actually
 * covered**. A rework rate is a symptom; a test inventory is the thing a QC reader came for — 220 cases,
 * what they are named, which area each belongs to, and how many of them exist because something broke.
 *
 * ## Read from the source, not from a run
 *
 * No test framework is executed and no reporter output is parsed. That would make the panel depend on a
 * passing suite, a runner being installed, and a JSON format staying stable — three ways for a documentation
 * tool to stop working for reasons that have nothing to do with documentation. The names are in the files.
 *
 * ## What a name can and cannot tell you
 *
 * A case named `a git failure that is not "no repository" is raised, never degraded` says what it protects.
 * `test 12` says nothing, and this cannot fix that — it reports what is there. The one inference it makes is
 * **regression**: a case whose name describes a defect rather than a capability is a case that exists because
 * something broke, and that ratio is worth knowing. It is a heuristic over wording, labelled as one.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Each entry: the pattern that finds a case, and the group its file belongs to. */
const MATCHERS = [
  // JS/TS: test('…'), it('…'), Deno.test('…')
  { lang: 'js', file: /\.(m?[jt]s|[jt]sx)$/, re: /^\s*(?:Deno\.)?(?:test|it)\s*\(\s*(['"`])([\s\S]*?)\1/gm },
  { lang: 'python', file: /\.py$/, re: /^\s*def\s+(test_[A-Za-z0-9_]+)\s*\(/gm, name: 1 },
  { lang: 'go', file: /_test\.go$/, re: /^func\s+(Test[A-Za-z0-9_]+)\s*\(/gm, name: 1 },
  { lang: 'rust', file: /\.rs$/, re: /#\[test\][\s\S]{0,80}?fn\s+([A-Za-z0-9_]+)/gm, name: 1 },
  { lang: 'java', file: /\.java$/, re: /@Test[\s\S]{0,200}?\b(?:void|public)\s+([A-Za-z0-9_]+)\s*\(/gm, name: 1 },
];

/** Words that describe a defect rather than a capability. A heuristic, and reported as one. */
const REGRESSION = /\b(never|not|cannot|must not|refus|reject|fail|silent|degrad|escape|overwrit|swallow|blank|dead|stale|duplicate|wrong|broke|bug|regress|leak|hang|crash)\w*/i;

/** Section headings inside a test file — the suite's own grouping, where it has one. */
function sectionsOf(text) {
  const marks = [...text.matchAll(/^\/\*\s*=+\s*(.+?)\s*\*\/$/gm)].map((m) => ({ at: m.index, title: m[1].trim() }));
  return marks.length ? marks : null;
}

/** Every test case in one file. */
export function casesInFile(rel, text) {
  const m = MATCHERS.find((x) => x.file.test(rel));
  if (!m) return [];
  const sections = sectionsOf(text);
  const sectionAt = (i) => {
    if (!sections) return null;
    let cur = null;
    for (const s of sections) { if (s.at <= i) cur = s.title; else break; }
    return cur;
  };
  const out = [];
  for (const hit of text.matchAll(m.re)) {
    const name = (m.name ? hit[m.name] : hit[2] || '').trim();
    if (!name) continue;
    out.push({ file: rel, lang: m.lang, name, section: sectionAt(hit.index), regression: REGRESSION.test(name) });
  }
  return out;
}

/**
 * The whole inventory, from tracked files that look like tests.
 *
 * A repository with no tests returns `available: true` and an empty list — that is a finding, not an error,
 * and a panel that vanishes when the answer is "none" hides the answer worth seeing most.
 */
export function testInventory(root, files) {
  const candidates = files.filter((f) =>
    /(^|\/)(tests?|spec|__tests__)\//i.test(f) || /[._-](test|spec)\.[a-z]+$/i.test(f) || /_test\.go$/.test(f));

  const cases = [];
  const read = [];
  for (const f of candidates) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const found = casesInFile(f, text);
    if (found.length) read.push(f);
    cases.push(...found);
  }

  const bySection = new Map();
  for (const c of cases) {
    const key = c.section || c.file;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(c);
  }

  return {
    available: true,
    cases,
    files: read,
    candidates: candidates.length,
    regressions: cases.filter((c) => c.regression).length,
    sections: [...bySection.entries()]
      .map(([title, list]) => ({ title, count: list.length, regressions: list.filter((c) => c.regression).length }))
      .sort((a, b) => b.count - a.count),
    notChecked: [
      candidates.length > read.length
        ? `${candidates.length - read.length} test file(s) matched no known case pattern and contributed nothing.`
        : null,
      'Read from source, never from a run: this is what is written, not what passed.',
      'Regression is inferred from wording — a case named for a defect rather than a capability.',
    ].filter(Boolean),
  };
}
