/**
 * docs-atlas · contribution analytics
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

export function readContrib(root, cfg) {
  const c = { ...DEFAULT_CONTRIB, ...(cfg.contrib || {}) };
  // Separators are git's own escapes, never literal control bytes — argv cannot carry a NUL.
  const fmt = ['%x00%H', '%an', '%ae', '%aI', '%s',
    '%(trailers:key=Co-Authored-By,valueonly,separator=%x1e)',
    '%(trailers:key=Desk,valueonly)'].join('%x1f');

  const args = ['log', `--format=${fmt}`, '--numstat', '--no-merges'];
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
        files.push({ path: m[3], added: a, removed: d, binary: m[1] === '-' });
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

  for (const cm of commits) {
    const t = Date.parse(cm.date);
    for (const f of cm.files) {
      touches++;
      const prev = lastTouch.get(f.path);
      if (prev !== undefined && t - prev < windowMs) rework++;
      lastTouch.set(f.path, t);
    }
  }

  return {
    reworkRate: touches ? Math.round((rework / touches) * 1000) / 10 : 0,
    reworkWindowDays: c.reworkWindowDays,
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
  const rows = plan.items.map((i) => ({
    id: i.id, title: i.title, percent: i.percent,
    commits: (referenced.get(i.id) || []).length,
    last: (referenced.get(i.id) || []).slice(-1)[0]?.date.slice(0, 10) || null,
  }));
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
  L.push(c.dim(`+${t.added.toLocaleString()} / −${t.removed.toLocaleString()} lines · ` +
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
      L.push(c.dim(`  ${cov.claimedButUnreferenced} item(s) report progress but no commit names them — worth a look, not an accusation.`));
    }
  }

  L.push('');
  L.push(c.bold('Read these with the caveats'));
  for (const cv of k.caveats) L.push(c.dim('  · ' + cv.replace(/\*\*/g, '')));
  return L.join('\n');
}
