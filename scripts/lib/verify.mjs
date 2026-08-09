/**
 * project-atlas · the tool audits its own output
 *
 * `atlas health` audits the repository's markdown scrupulously and had never once looked at the HTML it
 * writes. Six defects shipped in one afternoon because of that, and **every one was found by a person
 * looking at the rendered page**:
 *
 *   · the standalone export deleted the theme toggle and kept the script that drove it
 *   · an update row advertised a downgrade, comparing versions with `!==` instead of ordering
 *   · a bundle carried every figure and none of its stylesheets, so the charts vanished
 *   · 69 links pointed at files that do not travel beside a single-file export
 *   · role-view panels reserved the height of their tallest neighbour and left holes
 *   · a paragraph rendered as vertical strips, because `.empty` was `display:flex`
 *
 * Each is now pinned by a test written *after* a screenshot arrived. That is the wrong loop, and this closes
 * it: the checks below are the general form of four of those six, run against the real output on every build.
 *
 * ## The rule these follow
 *
 * Only defects that are **decidable from the file itself**. No rendering, no browser, no heuristics about
 * whether a layout looks right — the two that a static pass cannot catch (the flex paragraph, the grid holes)
 * are honestly out of scope, and saying so is better than a check that pretends. What is decidable is whether
 * a page references something it does not contain, which is exactly what all four of the others were.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Files a generated site is expected to contain, so a missing one is a defect rather than a silent absence. */
const IGNORE_HREF = /^(https?:|mailto:|tel:|#|data:)/i;

/**
 * Every verifiable defect in one generated HTML file.
 *
 * `siblings` is the set of filenames that exist beside it, so a link to a page that was never written is
 * caught here rather than by a reader clicking it.
 */
export function verifyPage(name, html, files) {
  const out = [];
  const add = (rule, detail) => out.push({ page: name, rule, detail });

  // 1 · Duplicate ids. Invalid HTML, and `getElementById` silently returns the first — which is how one
  //     page's script came to drive another page's table in the bundle.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set(), dupes = new Set();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  for (const id of dupes) add('duplicate-id', `#${id} appears ${ids.filter((x) => x === id).length} times`);

  // 2 · A script reaching for an element the page does not render. Not always a defect — an optional element
  //     is legitimately absent and its script guards for that — so this only fires when the reference is
  //     *unguarded*, which is the shape that actually breaks.
  // "Unguarded" means the whole script block runs regardless. The first version looked only 220 characters
  // past the reference and flagged #tq, #tcount and #tfilters — all reached *after* an early
  // `var tbl = getElementById('itbl'); if (!tbl) return;` at the top of the same block. A guard protects
  // everything after it, so the unit has to be the block, not a window.
  for (const block of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const js = block[1];
    const bails = /if\s*\(\s*!\s*[\w.]+\s*\)\s*return|if\s*\(\s*![\w.]+\s*\)\s*\{[^}]*return/.test(js);
    if (bails) continue;
    for (const m of js.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
      if (html.includes(`id="${m[1]}"`)) continue;
      add('unrendered-control', `#${m[1]} is scripted but never rendered, and its block has no early return`);
    }
  }

  // 3 · A local link with no file behind it. Caught 69 of these in the bundle only because a human clicked one.
  //     Scanned outside <script>, because the search index builds hrefs by concatenation and
  //     `href="pages/' + x.d.f + '"` is a template, not a link.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const m of markup.matchAll(/\bhref="([^"]+)"/g)) {
    const href = m[1];
    if (IGNORE_HREF.test(href)) continue;
    const target = href.split('#')[0];
    if (!target) continue;
    // Resolved against the page's own directory, because a document page links back out with `../`. The
    // first version compared against the page's siblings only and reported 358 dead links that all work.
    const dir = path.posix.dirname(name);
    const resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
    // A link that escapes the output root addresses the repository, not the site — every generated page
    // carries one back to the markdown it was derived from, and that is the point of them. Out of scope
    // here rather than reported as 30 dead links that all work.
    if (resolved.startsWith('..')) continue;
    if (!files.has(resolved)) add('dead-link', `${href} — resolves to ${resolved}, which was not written`);
  }

  // 4 · A class used in the markup that no stylesheet in the page defines. The bundle shipped every figure
  //     with none of its chart CSS and rendered as an unstyled outline; nothing objected.
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  if (styles) {
    const defined = new Set([...styles.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    const used = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
    const missing = [...used].filter((c) => !defined.has(c));
    // A handful of unstyled utility classes is normal; a page whose chart classes all vanished is not.
    if (missing.length > used.size * 0.5 && used.size > 10) {
      add('stylesheet-missing', `${missing.length} of ${used.size} classes are styled by nothing — a stylesheet did not travel`);
    }
  }

  return out;
}

/** Verify a built site directory. Returns every finding across every page, most pages first. */
export function verifySite(outDir) {
  if (!fs.existsSync(outDir)) return [{ page: outDir, rule: 'missing-output', detail: 'nothing was built' }];
  // Every file in the tree, addressed the way a link addresses it: relative to the output root.
  const files = new Set();
  const collect = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      files.add(rel);
      if (fs.statSync(abs).isDirectory()) collect(abs, rel);
    }
  };
  collect(outDir);

  const findings = [];
  for (const rel of files) {
    if (!rel.endsWith('.html')) continue;
    findings.push(...verifyPage(rel, fs.readFileSync(path.join(outDir, rel), 'utf8'), files));
  }
  return findings;
}

/** One line per finding, grouped by rule so a systemic fault reads as one problem rather than forty. */
export function formatVerify(findings, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  if (!findings.length) return c.green('The generated site verifies clean.') + c.dim(' No duplicate ids, no unrendered control, no dead link, every stylesheet present.');

  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f]);
  const L = [c.bold(`${findings.length} defect(s) in the generated site`)];
  for (const [rule, list] of byRule) {
    L.push('');
    L.push(`  ${c.red(rule)} ${c.dim(`— ${list.length}`)}`);
    for (const f of list.slice(0, 8)) L.push(`    ${f.page}  ${c.dim(f.detail)}`);
    if (list.length > 8) L.push(c.dim(`    … and ${list.length - 8} more`));
  }
  return L.join('\n');
}
