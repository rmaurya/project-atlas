/**
 * llm-wiki · configuration
 *
 * Defaults are written to be reasonable in a repository that has never seen this tool. Every one of them is
 * overridable, because a taxonomy that fits one project fits no other.
 */

import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_NAME = 'llm-wiki.config.json';

/** Convert a glob to a RegExp. Supports `**`, `*`, `?`, and `{a,b}`. Paths are posix, repo-relative. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches any number of directories, including none.
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) { re += '\\{'; continue; }
      re += '(?:' + glob.slice(i + 1, close).split(',').map(escapeRe).join('|') + ')';
      i = close;
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function matchesAny(p, globs) {
  return (globs || []).some((g) => globToRegExp(g).test(p));
}

/**
 * The default taxonomy. **Ordered — first match wins.**
 *
 * The ordering rule, learned the hard way: filename patterns come before directory patterns. A repository that
 * keeps its SOPs in `docs/architecture/` will otherwise have every one of them swallowed by the
 * `docs/architecture/**` rule, and the Procedures cluster reads as empty when it is in fact full. Specific
 * beats general, and a name is more specific than a location.
 *
 * Deliberately generic: these are patterns open-source repositories actually use.
 */
export const DEFAULT_CLUSTERS = [
  { id: 'start', title: 'Start here', blurb: 'The entry path for someone who has never seen this repository.',
    match: ['README.md', 'docs/README.md', 'docs/INDEX.md', 'CONTRIBUTING.md', 'docs/index.md'] },

  // --- filename-driven: these win wherever the file happens to live ---
  { id: 'procedures', title: 'Procedures', blurb: 'How work is done here — SOPs, playbooks, runbooks.',
    match: ['**/*sop*.md', '**/*SOP*.md', '**/*runbook*.md', '**/*RUNBOOK*.md', 'docs/playbooks/**',
            'docs/procedures/**', 'docs/sop/**'] },
  { id: 'specs', title: 'Specifications', blurb: 'Specified behaviour, with its build status.',
    match: ['docs/specs/**', 'docs/rfc/**', '**/*SRS*.md', '**/*_srs_*.md', '**/*RFC*.md', '**/*-spec.md',
            '**/*_spec.md'] },
  { id: 'planning', title: 'Planning', blurb: 'What is open, and what is next.',
    match: ['**/BACKLOG.md', '**/TASKS.md', '**/TODO.md', '**/HANDOFF.md', 'docs/planning/**'] },
  { id: 'manuals', title: 'Manuals', blurb: 'For the user, and for the developer.',
    match: ['**/*MANUAL*.md', '**/*manual*.md', '**/*GUIDE*.md', 'docs/guides/**', '**/USAGE.md',
            '**/GETTING_STARTED.md'] },
  { id: 'operations', title: 'Operations', blurb: 'Build, ship, run, secure.',
    match: ['docs/ops/**', 'docs/operations/**', '**/DEPLOYMENT.md', '**/DEPLOY*.md', '**/INSTALL*.md',
            '**/SECURITY.md', '**/OPERATIONS.md', '**/RELEASE*.md', '**/PACKAGING.md', '**/NOTARIZATION.md'] },

  // --- directory-driven: the broad catches, last ---
  { id: 'product', title: 'Product & direction', blurb: 'What is being built, and why.',
    match: ['docs/product/**', 'docs/vision/**', 'docs/direction/**', 'docs/roadmap/**', 'docs/ideas/**',
            '**/FEATURES.md', '**/ROADMAP.md', '**/VISION.md'] },
  { id: 'research', title: 'Research & record', blurb: 'Findings, session records, prior art. Historical by nature.',
    match: ['docs/research/**', 'docs/qa-log/**', 'docs/logs/**', 'docs/patents/**', 'docs/notes/**',
            '**/*RESEARCH*.md', '**/*_Research_*.md', '**/*worklog*.md', '**/*-log.md'] },
  { id: 'engineering', title: 'Engineering', blurb: 'How it is built — architecture, design, data flow.',
    match: ['docs/architecture/**', 'docs/design/**', 'docs/engineering/**', '**/HLD.md', '**/LLD.md',
            '**/ARCHITECTURE.md', '**/DESIGN*.md', '**/DATA_FLOW.md', '**/*-design.md'] },
];

export const DEFAULT_CONFIG = {
  $schema: 'https://github.com/llm-wiki/schema/v1',
  siteTitle: null,              // defaults to the repository directory name
  roots: ['.'],
  include: ['**/*.md'],
  exclude: [
    'node_modules/**', '.git/**', 'dist/**', 'build/**', 'out/**', 'vendor/**', 'target/**',
    '.claude/worktrees/**', '**/_wiki/**', '**/CHANGELOG.md', '**/LICENSE.md', '**/node_modules/**',
  ],
  output: 'docs/_wiki',
  trackedOnly: true,            // discover via `git ls-files`; untracked scratch never enters the wiki
  clusters: DEFAULT_CLUSTERS,
  fallbackCluster: 'uncategorised',   // set to null to make H5 a hard failure
  blocking: ['H1', 'H3', 'H8'],
  staleDays: 90,               // H6 only fires past this age, so a doc edited last week is never "stale"
  citationExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb',
                       '.swift', '.kt', '.c', '.h', '.cpp', '.cs', '.php', '.sh', '.sql', '.json', '.yml',
                       '.yaml', '.toml'],
  forbiddenTerms: [],           // e.g. [{ term: "OldProductName", reason: "renamed 2026-01", ignore: ["docs/archive/**"] }]
  crossref: [],                 // e.g. [{ id: "backlog-tasks", a: "docs/BACKLOG.md", b: "docs/TASKS.md", pattern: "\\b([A-Z]-\\d+)\\b" }]
  suppress: [],                 // [{ signal: "H6", path: "docs/qa-log/**", reason: "historical by nature" }]
  planning: {},                 // { source: "docs/TASKS.md" } — drives the dashboard's item charts and table
  deck: {},                     // { source: "docs/atlas/DECK.md" } — the project deck; absent means no deck page
  // Per-document characters entering the client-side search index. The whole index is one file the browser
  // loads up front, so this is a real budget, not a formality: at 20k a 400-document corpus produced 3.3 MB.
  // Documents past the limit are counted and reported — never silently truncated.
  searchBodyLimit: 6000,
};

export function resolveConfig(root, explicitPath) {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(root, CONFIG_NAME);
  let user = {};
  let found = false;
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
      found = true;
    } catch (err) {
      throw new Error(`${CONFIG_NAME} is not valid JSON (${err.message}). Fix or delete it — the tool will not guess.`);
    }
  }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  cfg.clusters = user.clusters || DEFAULT_CLUSTERS;
  cfg.siteTitle = cfg.siteTitle || path.basename(root);
  cfg.__configPath = found ? file : null;
  validate(cfg);
  return cfg;
}

function validate(cfg) {
  const problems = [];
  if (!Array.isArray(cfg.clusters) || !cfg.clusters.length) problems.push('clusters must be a non-empty array');
  const ids = new Set();
  for (const c of cfg.clusters || []) {
    if (!c.id) problems.push('every cluster needs an id');
    if (ids.has(c.id)) problems.push(`duplicate cluster id: ${c.id}`);
    ids.add(c.id);
  }
  for (const s of cfg.suppress || []) {
    if (!s.reason) problems.push(`suppress entry for ${s.signal || '?'} ${s.path || ''} has no reason — a reason is mandatory`);
  }
  if (problems.length) throw new Error('Invalid configuration:\n  - ' + problems.join('\n  - '));
}

/** Classify a repo-relative posix path into a cluster id. */
export function clusterFor(p, cfg) {
  for (const c of cfg.clusters) if (matchesAny(p, c.match)) return c.id;
  return cfg.fallbackCluster;
}

/** Is this signal suppressed for this path? Returns the reason, or null. */
export function suppressionFor(signal, p, cfg) {
  for (const s of cfg.suppress || []) {
    if (s.signal && s.signal !== signal) continue;
    if (s.path && !matchesAny(p, [s.path])) continue;
    return s.reason;
  }
  return null;
}
