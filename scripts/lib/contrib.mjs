/**
 * project-atlas · contribution analytics
 *
 * Everything here is derived from `git log`. No telemetry, no service, no new file for anyone to maintain —
 * the repository is the witness, same as the rest of the tool.
 *
 * ## Three honesty rules, enforced in the output rather than left to the reader
 *
 * 1. **Active hours are an ESTIMATE and are labelled one everywhere.** They are computed from the gaps
 *    between consecutive commits, so they measure *commit rhythm*, not time worked. Someone who thinks for
 *    six hours and commits once registers `firstCommitCredit` minutes. It is a floor, useful for trend and
 *    shape, useless for payroll — and the UI says so next to the number.
 *
 * 2. **There is no single contribution score, and there will not be one.** Lines-of-code is a discredited
 *    measure, and collapsing several measures into one number just hides which one is driving it. The tool
 *    reports commits, files, churn and *surviving lines* side by side and lets a person read them together.
 *    A ranked leaderboard of people is the one output this module deliberately does not produce.
 *
 * 3. **Prompt quality is not measured, because a repository cannot see a prompt.** What is reported are
 *    outcomes under their real names: rework rate, revert rate, and commit-message conformance.
 */

import { execFileSync } from 'node:child_process';
import { num } from './format.mjs';

const NUL = '\0';
const US = '\x1f';
const RS = '\x1e';

export const DEFAULT_CONTRIB = {
  sessionGapMinutes: 120,     // a gap longer than this starts a new working session
  firstCommitCredit: 30,      // minutes credited to the first commit of a session
  reworkWindowDays: 3,        // a file re-touched within this window counts as rework
  since: null,                // e.g. "2026-01-01"
  blame: false,               // surviving-lines analysis — accurate but slow on a large repo
  blameMaxFiles: 400,
  aiCoAuthorPattern: '(claude|gpt|copilot|gemini|codex)',
};

/* ------------------------------------------------------------------ collection */

/**
 * A `--numstat` path column, reduced to a path that exists.
 *
 * Rename detection is on by default for `git log`, and when it fires the path column stops being a path.
 * `git` writes the move inline — `ROADMAP.md => docs/ROADMAP.md` for a whole-path change, and the braced
 * form `docs/{a => b}/note.md` when only one segment moved. Kept verbatim, that string reaches `areaOf`,
 * which splits on `/` and takes the first segment, and the arrow and everything around it becomes a
 * directory name. Fourteen records manufactured five directories here that have never existed, and
 * `atlas ownership` reported all five as bus-factor-1 risks — the one output whose entire value is naming
 * a place somebody can go and look at.
 *
 * **Resolved to the new name, not the old.** Every other figure derived from this reader describes the tree
 * as it stands, and a hotspot list that names the file you would open beats one faithful to a path deleted
 * in March. The cost is stated wherever these numbers surface: touches recorded before a rename stay filed
 * under the old path, so a moved file reads as two shorter histories. Closing that means `--follow`, which
 * is per-path and cannot be asked of a whole-repository log in one pass — a separate question, left open in
 * A-30 rather than smuggled in here.
 *
 * Exported because this is the *only* place it may happen. `dashboard.mjs` carried a private copy while the
 * defect was open; the other consumers — `ownership.mjs`, `kb.mjs`, `design.mjs` — never knew they needed
 * one. Normalising at the read is what makes that true for all of them at once.
 */
export function unrenamePath(p) {
  return String(p)
    .replace(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')  // docs/{a => b}/note.md  ->  docs/b/note.md
    .replace(/^.* => /, '')                        // ROADMAP.md => docs/R.md -> docs/R.md
    .replace(/\/{2,}/g, '/')                       // docs/{ => sub}/a.md leaves an empty segment
    .replace(/^\//, '');
}

export function readContrib(root, cfg) {
  const c = { ...DEFAULT_CONTRIB, ...(cfg.contrib || {}) };
  // Separators are git's own escapes, never literal control bytes — argv cannot carry a NUL.
  const fmt = ['%x00%H', '%an', '%ae', '%aI', '%s',
    '%(trailers:key=Co-Authored-By,valueonly,separator=%x1e)',
    '%(trailers:key=Desk,valueonly)'].join('%x1f');

  // `-c core.quotePath=false`: git quotes any path containing a byte over 0x7F, so `docs/étude.md` arrives
  // from `--numstat` as `"docs/\303\251tude.md"`. Every path here is compared against paths that came from
  // `ls-files -z`, which does not quote — so a non-ASCII file silently belonged to no document, no cluster and
  // no coverage row. See scan.mjs::gitHistory, where the same mismatch cost the staleness signal.
  const args = ['-c', 'core.quotePath=false', 'log', `--format=${fmt}`, '--numstat', '--no-merges'];
  if (c.since) args.push(`--since=${c.since}`);

  let out;
  try {
    out = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not a git repository|does not have any commits/i.test(msg)) {
      return { available: false, reason: 'Not a git repository, or it has no commits.' };
    }
    throw new Error(`git log failed while reading contributions: ${msg.split('\n')[0]}`);
  }

  const aiRe = new RegExp(c.aiCoAuthorPattern, 'i');
  const commits = [];

  for (const rec of out.split(NUL)) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf('\n');
    const head = nl === -1 ? rec : rec.slice(0, nl);
    const [hash, an, ae, aI, subject, coRaw, desk] = head.split(US);
    if (!hash) continue;

    const files = [];
    let added = 0, removed = 0;
    if (nl !== -1) {
      for (const line of rec.slice(nl + 1).split('\n')) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
        if (!m) continue;
        const a = m[1] === '-' ? 0 : Number(m[1]);
        const d = m[2] === '-' ? 0 : Number(m[2]);
        added += a; removed += d;
        // `renamed` is kept because normalising here would otherwise destroy the only evidence that a
        // rename happened. The Repository view states, as a caveat, that a file is followed by path and
        // not by identity — a claim it can only quantify if the reader that flattens the notation also
        // records how often it fired.
        const raw = m[3];
        const p = unrenamePath(raw);
        files.push({ path: p, added: a, removed: d, binary: m[1] === '-', renamed: p !== raw });
      }
    }

    const coAuthors = (coRaw || '').split(RS).map((s) => s.trim()).filter(Boolean);
    const agents = coAuthors.filter((s) => aiRe.test(s)).map(normaliseAgent);

    commits.push({
      hash: hash.slice(0, 8), author: an, email: ae, date: aI, subject: subject || '',
      desk: (desk || '').trim() || null,
      agents, aiAssisted: agents.length > 0,
      files, added, removed,
      taskRefs: [...new Set((subject.match(/\b[A-Z]{1,3}-\d+\b/g) || []))],
      revert: /^revert\b/i.test(subject),
      conventional: /^[a-z]+(\([^)]+\))?!?:\s+\S/.test(subject),
    });
  }

  if (!commits.length) return { available: false, reason: 'No commits found in the selected range.' };
  commits.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  return {
    available: true,
    config: c,
    commits,
    people: aggregatePeople(commits, c),
    agents: aggregateAgents(commits),
    desks: aggregateDesks(commits),
    weeks: aggregateWeeks(commits),
    quality: aggregateQuality(commits, c),
    totals: {
      commits: commits.length,
      added: commits.reduce((n, x) => n + x.added, 0),
      removed: commits.reduce((n, x) => n + x.removed, 0),
      aiAssisted: commits.filter((x) => x.aiAssisted).length,
      first: commits[0].date.slice(0, 10),
      last: commits[commits.length - 1].date.slice(0, 10),
      deskTagged: commits.filter((x) => x.desk).length,
    },
    caveats: caveats(commits, c),
  };
}

/** "Claude Opus 5 (1M context) <noreply@anthropic.com>" → "Claude Opus 5 (1M context)" */
function normaliseAgent(s) {
  return s.replace(/<[^>]*>/g, '').trim();
}

/* ------------------------------------------------------------------ active hours */

/**
 * The standard commit-gap heuristic. Consecutive commits closer than `sessionGapMinutes` are treated as one
 * continuous stretch and the real gap is counted; a commit further out opens a new session credited a flat
 * `firstCommitCredit`. This is a **lower bound on time worked** and is presented as one.
 */
export function estimateHours(dates, c) {
  if (!dates.length) return { hours: 0, sessions: 0 };
  const ts = dates.map((d) => Date.parse(d)).sort((a, b) => a - b);
  const gapMs = c.sessionGapMinutes * 60000;
  let minutes = 0, sessions = 1;
  minutes += c.firstCommitCredit;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap < gapMs) minutes += gap / 60000;
    else { sessions++; minutes += c.firstCommitCredit; }
  }
  return { hours: Math.round((minutes / 60) * 10) / 10, sessions };
}

/* ------------------------------------------------------------------ aggregation */

function aggregatePeople(commits, c) {
  const by = new Map();
  for (const cm of commits) {
    const key = cm.email || cm.author;
    if (!by.has(key)) by.set(key, { name: cm.author, email: cm.email, commits: [], files: new Set() });
    const p = by.get(key);
    p.commits.push(cm);
    for (const f of cm.files) p.files.add(f.path);
  }
  return [...by.values()].map((p) => {
    const est = estimateHours(p.commits.map((x) => x.date), c);
    const added = p.commits.reduce((n, x) => n + x.added, 0);
    const removed = p.commits.reduce((n, x) => n + x.removed, 0);
    return {
      name: p.name, email: p.email,
      commits: p.commits.length,
      files: p.files.size,
      added, removed, churn: added + removed,
      aiAssisted: p.commits.filter((x) => x.aiAssisted).length,
      estimatedHours: est.hours,
      sessions: est.sessions,
      commitsPerSession: Math.round((p.commits.length / est.sessions) * 10) / 10,
      first: p.commits[0].date.slice(0, 10),
      last: p.commits[p.commits.length - 1].date.slice(0, 10),
      days: new Set(p.commits.map((x) => x.date.slice(0, 10))).size,
    };
  }).sort((a, b) => b.commits - a.commits);
}

function aggregateAgents(commits) {
  const by = new Map();
  for (const cm of commits) {
    for (const a of cm.agents) {
      if (!by.has(a)) by.set(a, { agent: a, commits: 0, added: 0, removed: 0, first: cm.date, last: cm.date });
      const g = by.get(a);
      g.commits++; g.added += cm.added; g.removed += cm.removed;
      if (cm.date < g.first) g.first = cm.date;
      if (cm.date > g.last) g.last = cm.date;
    }
  }
  return [...by.values()]
    .map((g) => ({ ...g, first: g.first.slice(0, 10), last: g.last.slice(0, 10) }))
    .sort((a, b) => b.commits - a.commits);
}

function aggregateDesks(commits, c = DEFAULT_CONTRIB) {
  const tagged = commits.filter((x) => x.desk);
  if (!tagged.length) return { configured: false, desks: [] };
  const by = new Map();
  for (const cm of tagged) {
    if (!by.has(cm.desk)) by.set(cm.desk, []);
    by.get(cm.desk).push(cm);
  }
  return {
    configured: true,
    untagged: commits.length - tagged.length,
    desks: [...by.entries()].map(([desk, list]) => {
      const est = estimateHours(list.map((x) => x.date), c);
      return {
        desk, commits: list.length,
        added: list.reduce((n, x) => n + x.added, 0),
        removed: list.reduce((n, x) => n + x.removed, 0),
        estimatedHours: est.hours, sessions: est.sessions,
        agents: [...new Set(list.flatMap((x) => x.agents))],
      };
    }).sort((a, b) => b.commits - a.commits),
  };
}

function aggregateWeeks(commits) {
  const by = new Map();
  for (const cm of commits) {
    const k = isoWeekStart(cm.date);
    if (!by.has(k)) by.set(k, { week: k, commits: 0, added: 0, removed: 0, ai: 0, authors: new Set() });
    const w = by.get(k);
    w.commits++; w.added += cm.added; w.removed += cm.removed;
    if (cm.aiAssisted) w.ai++;
    w.authors.add(cm.email || cm.author);
  }
  return [...by.values()].map((w) => ({ ...w, authors: w.authors.size })).sort((a, b) => a.week.localeCompare(b.week));
}

function isoWeekStart(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;               // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Outcome measures. Named for what they are: none of these observes a prompt, and calling any of them
 * "quality of the AI" would be a claim the data does not support.
 */
function aggregateQuality(commits, c) {
  const windowMs = c.reworkWindowDays * 86400000;
  const lastTouch = new Map();
  let rework = 0, touches = 0;
  // The per-day breakdown comes out of **this** loop rather than a second one somewhere else. Token
  // economics (C-10) needs a day-by-day rework verdict to split spend into new work and rework, and the one
  // thing it must not do is invent a second definition of the word — two answers to one question is the fork
  // this whole tool exists to detect. So the definition stays here, single, and the day series is a
  // by-product of it.
  const byDay = new Map();

  for (const cm of commits) {
    const t = Date.parse(cm.date);
    const day = cm.date.slice(0, 10);
    for (const f of cm.files) {
      touches++;
      const prev = lastTouch.get(f.path);
      const isRework = prev !== undefined && t - prev < windowMs;
      if (isRework) rework++;
      lastTouch.set(f.path, t);
      const d = byDay.get(day) || { day, touches: 0, rework: 0 };
      d.touches++;
      if (isRework) d.rework++;
      byDay.set(day, d);
    }
  }

  return {
    reworkRate: touches ? Math.round((rework / touches) * 1000) / 10 : 0,
    reworkWindowDays: c.reworkWindowDays,
    reworkTouches: touches,
    // Ascending, so a caller joining it to a time series does not have to sort it again.
    reworkByDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    reverts: commits.filter((x) => x.revert).length,
    revertRate: Math.round((commits.filter((x) => x.revert).length / commits.length) * 1000) / 10,
    conventional: commits.filter((x) => x.conventional).length,
    conventionalRate: Math.round((commits.filter((x) => x.conventional).length / commits.length) * 1000) / 10,
    withTaskRef: commits.filter((x) => x.taskRefs.length).length,
  };
}

/** Spec→build coverage: which planning items have a commit that names them. */
export function taskCoverage(contrib, plan) {
  if (!contrib?.available || !plan || plan.missing) return null;
  const referenced = new Map();
  for (const cm of contrib.commits) {
    for (const r of cm.taskRefs) {
      if (!referenced.has(r)) referenced.set(r, []);
      referenced.get(r).push(cm);
    }
  }
  const rows = plan.items.map((i) => {
    const cms = referenced.get(i.id) || [];
    // Who worked on it was always in this data and was thrown away — only the count survived. Grouped by the
    // same key the rest of the contribution analysis uses (email, falling back to name), so one person with
    // two spellings of their name is one person here too.
    const by = new Map();
    for (const cm of cms) {
      const key = cm.email || cm.author;
      if (!by.has(key)) by.set(key, { name: cm.author, email: cm.email, commits: 0 });
      by.get(key).commits++;
    }
    return {
      id: i.id, title: i.title, percent: i.percent,
      commits: cms.length,
      last: cms.slice(-1)[0]?.date.slice(0, 10) || null,
      authors: [...by.values()].sort((a, b) => b.commits - a.commits),
      // Newest first, and capped — an item with sixty commits should not push the page over. The cap is
      // reported wherever this renders, because a truncated list shown as a whole list is the quiet lie.
      recent: cms.slice(-8).reverse()
        .map((cm) => ({ hash: cm.hash, subject: cm.subject, date: cm.date.slice(0, 10), author: cm.author })),
    };
  });
  return {
    rows,
    withCommits: rows.filter((r) => r.commits > 0).length,
    withoutCommits: rows.filter((r) => r.commits === 0).length,
    // An item reported as partly built with no commit naming it is not necessarily wrong — commit subjects
    // here describe the defect, not the ticket — so this is surfaced as a question, never as an accusation.
    claimedButUnreferenced: rows.filter((r) => r.commits === 0 && (r.percent || 0) > 0).length,
  };
}

function caveats(commits, c) {
  const out = [];
  out.push(`Active hours are **estimated** from gaps between commits (session gap ${c.sessionGapMinutes} min, ` +
    `${c.firstCommitCredit} min credited per session start). They measure commit rhythm, not time worked, and are a floor: ` +
    `thinking that produces one commit registers ${c.firstCommitCredit} minutes.`);
  const untagged = commits.filter((x) => !x.desk).length;
  if (untagged) out.push(`${untagged} of ${commits.length} commit(s) carry no \`Desk:\` trailer, so per-desk figures cover only the tagged remainder. History cannot be re-tagged retroactively.`);
  const authors = new Set(commits.map((x) => x.email)).size;
  if (authors === 1) out.push(`All commits share a single git author, so per-person comparison is not meaningful in this repository yet.`);
  out.push(`Lines added and removed are shown because they are cheap to compute, not because they measure value. There is deliberately no combined "contribution score".`);
  return out;
}

/* ------------------------------------------------------------------ terminal report */

export function formatContrib(k, plan, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });
  if (!k.available) return `No contribution data: ${k.reason}`;

  const L = [];
  const t = k.totals;
  L.push(c.bold(`${t.commits} commits · ${t.first} → ${t.last}`));
  L.push(c.dim(`+${num(t.added)} / −${num(t.removed)} lines · ` +
    `${t.aiAssisted} AI-assisted (${Math.round((t.aiAssisted / t.commits) * 100)}%)`));
  L.push('');

  L.push(c.bold('People'));
  L.push(c.dim('  commits  files   +lines   −lines   days  est.hrs  sessions'));
  for (const p of k.people) {
    L.push(`  ${String(p.commits).padStart(7)}  ${String(p.files).padStart(5)}  ` +
      `${String(p.added).padStart(7)}  ${String(p.removed).padStart(7)}  ` +
      `${String(p.days).padStart(4)}  ${String(p.estimatedHours).padStart(7)}  ${String(p.sessions).padStart(8)}   ${p.name}`);
  }
  L.push('');

  if (k.agents.length) {
    L.push(c.bold('Agents'));
    for (const a of k.agents) {
      L.push(`  ${String(a.commits).padStart(5)} commits  ${a.first} → ${a.last}  ${a.agent}`);
    }
    L.push('');
  }

  if (k.desks.configured) {
    L.push(c.bold('Desks'));
    for (const d of k.desks.desks) {
      L.push(`  ${String(d.commits).padStart(5)} commits  ${String(d.estimatedHours).padStart(6)} est.hrs  ${d.desk}`);
    }
    if (k.desks.untagged) L.push(c.dim(`  ${k.desks.untagged} commit(s) untagged`));
  } else {
    L.push(c.bold('Desks') + c.dim('  not configured — no commit carries a `Desk:` trailer.'));
  }
  L.push('');

  L.push(c.bold('Outcomes') + c.dim('  (not prompt quality — a repository cannot see a prompt)'));
  L.push(`  rework rate      ${k.quality.reworkRate}%  ` + c.dim(`(a file re-touched within ${k.quality.reworkWindowDays} days)`));
  L.push(`  revert rate      ${k.quality.revertRate}%  ` + c.dim(`(${k.quality.reverts} revert commits)`));
  L.push(`  conventional     ${k.quality.conventionalRate}%  ` + c.dim('(subjects matching type(scope): …)'));

  const cov = taskCoverage(k, plan);
  if (cov) {
    L.push('');
    L.push(c.bold('Spec → build coverage'));
    L.push(`  ${cov.withCommits} of ${cov.rows.length} tracked item(s) are named by at least one commit.`);
    if (cov.claimedButUnreferenced) {
      const named = cov.rows.filter((r) => r.commits === 0 && (r.percent || 0) > 0).slice(0, 6);
      L.push(c.dim(`  ${cov.claimedButUnreferenced} item(s) report progress but no commit names them — worth a look, not an accusation:`));
      // An id alone is a reference the reader has to look up; the title is what lets them recognise it.
      for (const r of named) L.push(c.dim(`    ${r.id} · ${r.title} (${r.percent}%)`));
      if (cov.claimedButUnreferenced > named.length) L.push(c.dim(`    … and ${cov.claimedButUnreferenced - named.length} more`));
    }
  }

  L.push('');
  L.push(c.bold('Read these with the caveats'));
  for (const cv of k.caveats) L.push(c.dim('  · ' + cv.replace(/\*\*/g, '')));
  return L.join('\n');
}
