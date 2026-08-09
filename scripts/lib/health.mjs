/**
 * project-atlas · rot signals
 *
 * Nine mechanical checks. Every one of them is a fact about the repository, never a judgment about quality —
 * "this link points at a file that does not exist" is checkable; "this document is badly written" is not, and
 * a tool that mixes the two teaches people to distrust both.
 *
 * The blocking/advisory split is the load-bearing compromise. Blocking signals have no legitimate cause.
 * Advisory ones do: an archived record SHOULD cite code that has since moved. Making everything blocking is
 * the reliable way to get the whole report ignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { matchesAny, suppressionFor, compileRule } from './config.mjs';
import { SIGNALS } from './signals.mjs';

export { SIGNALS };


const DAY = 86400000;

export function runHealth(index, cfg, root) {
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

  const blocking = new Set(cfg.blocking || []);
  for (const f of findings) f.blocking = blocking.has(f.signal) && !f.suppressed;

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
  };
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
  L.push(c.dim(`${index.stats.documents} documents · ${index.stats.lines.toLocaleString()} lines · ${index.stats.clusters} clusters · ${index.stats.links} links · ${index.stats.citations} citations`));
  L.push('');

  const rows = Object.values(SIGNALS).map((s) => {
    const n = health.counts[s.id] || 0;
    const isBlocking = health.findings.some((f) => f.signal === s.id && f.blocking);
    // A signal whose configured pattern was declined has a count of zero and is not clean. Drawing it green
    // here would be exactly the failure the "Not checked" section exists to prevent, one line higher up.
    if ((health.unevaluated || []).includes(s.id)) {
      return `  ${s.id}  ${c.yellow('   —')}  ${s.title}${c.dim('  (not evaluated — see Not checked)')}`;
    }
    const mark = n === 0 ? c.green('  ok') : isBlocking ? c.red(String(n).padStart(4)) : c.yellow(String(n).padStart(4));
    return `  ${s.id}  ${mark}  ${s.title}`;
  });
  L.push(...rows);
  L.push('');

  if (health.suppressed) L.push(c.dim(`  ${health.suppressed} finding(s) suppressed by configuration, each with a stated reason.`));

  if (health.notChecked.length) {
    L.push('');
    L.push(c.bold('  Not checked'));
    for (const n of health.notChecked) L.push(c.dim(`    · ${n}`));
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
