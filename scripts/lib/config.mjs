/**
 * project-atlas · configuration
 *
 * Defaults are written to be reasonable in a repository that has never seen this tool. Every one of them is
 * overridable, because a taxonomy that fits one project fits no other.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SIGNALS } from './signals.mjs';

export const CONFIG_NAME = 'project-atlas.config.json';
/**
 * Earlier names, newest first. Each is still read if present, so an existing setup keeps working across a
 * rename. This is the second rename — `llm-wiki` was the working name, `docs-atlas` undersold what the tool
 * had become — and it is intended to be the last. Adding a third would mean three files to look for before
 * concluding a repository is unconfigured, which is where "still supported" turns into a mess.
 */
export const LEGACY_CONFIG_NAMES = ['docs-atlas.config.json', 'llm-wiki.config.json'];

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

/* ------------------------------------------------------------------ configured regexes */

/**
 * Catastrophic backtracking, refused before it can start.
 *
 * The config hands the tool raw regular expressions — `forbiddenTerms[].pattern`, `crossref[].pattern`, and
 * the three `planning.*Pattern` keys. Verified: a `forbiddenTerms` pattern of `(a+)+$` against a single
 * 40-character line never returns; `atlas health` was killed at 8s having produced no output at all.
 *
 * **Why a screen and not a timeout.** A JavaScript regex cannot be interrupted once it is running on the
 * calling thread — there is no budget to enforce without moving every match into a worker, which would mean a
 * worker per rule per document in a tool whose whole premise is that it costs nothing to run. The only way to
 * guarantee the build finishes is to decline to start a pattern whose *shape* can backtrack exponentially.
 *
 * **Why this never quietly weakens a report.** A declined pattern is not skipped: it is returned as an error,
 * the caller drops the rule, and the rule appears by name under "Not checked". That is the project's third
 * non-negotiable — a check that could not run is never reported as passing — and it is why the screen is
 * allowed to be conservative. A false positive costs a named, visible non-check. A false negative costs a
 * build that hangs forever, which is the failure being fixed here.
 */
export function unsafeRegexReason(pattern) {
  const src = String(pattern);
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { i = endOfClass(src, i); continue; }
    if (c === '(') { stack.push(i); continue; }
    if (c !== ')') continue;
    const start = stack.pop();
    if (start === undefined) continue;               // unbalanced — `new RegExp` reports it far better than we can
    const q = quantifierAt(src, i + 1);
    if (!q || q === '{1}' || q === '{0}') continue;   // not repeated, so nothing multiplies
    const body = stripGroupPrefix(src.slice(start + 1, i));
    const why = innerRisk(body);
    if (why) return `the group \`(${body})\` is repeated by \`${q}\`, and ${why}`;
  }
  return null;
}

/**
 * Compile a configured pattern, or explain why it was not compiled. Never throws: an unusable pattern is a
 * fact to report, not a reason to abandon the whole run — one malformed input is reported and skipped, and
 * the run continues.
 */
export function compileRule(pattern, flags = 'g') {
  const unsafe = unsafeRegexReason(pattern);
  if (unsafe) return { re: null, error: `it can backtrack exponentially — ${unsafe}` };
  try {
    return { re: new RegExp(pattern, flags), error: null };
  } catch (err) {
    return { re: null, error: `it is not a valid regular expression (${err.message})` };
  }
}

function endOfClass(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === ']') return j;
  }
  return src.length;
}

function quantifierAt(src, i) {
  const c = src[i];
  if (c === '*' || c === '+' || c === '?') return c;
  if (c === '{') { const m = /^\{\d*(?:,\d*)?\}/.exec(src.slice(i)); return m ? m[0] : null; }
  return null;
}

/** `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>` — a modifier, not part of what the group matches. */
function stripGroupPrefix(body) {
  const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(body);
  return m ? body.slice(m[0].length) : body;
}

/**
 * What makes a repeated group explosive: a second quantifier inside it (so one input can be divided between
 * the two in exponentially many ways), or alternatives that can match the same text.
 *
 * Alternation is judged on a shared first token rather than flagged outright, because `(?:GET|POST)+` is
 * perfectly safe and refusing it would be a false positive with no upside. `(a|ab)+` and `(a|a)+` are not.
 */
function innerRisk(body) {
  const branches = [''];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { branches[branches.length - 1] += body.slice(i, i + 2); i++; continue; }
    if (c === '[') { const end = endOfClass(body, i); branches[branches.length - 1] += body.slice(i, end + 1); i = end; continue; }
    if (c === '(') {
      depth++;
      const pre = /^\(\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(body.slice(i));
      if (pre) { branches[branches.length - 1] += pre[0]; i += pre[0].length - 1; continue; }
      branches[branches.length - 1] += c;
      continue;
    }
    if (c === ')') { depth--; branches[branches.length - 1] += c; continue; }
    if (c === '|' && depth === 0) { branches.push(''); continue; }
    const q = i > 0 ? quantifierAt(body, i) : null;
    if (q && q !== '{1}' && q !== '{0}') return `it already contains a quantifier (\`${q}\`) — the two multiply`;
    branches[branches.length - 1] += c;
  }
  if (branches.length > 1) {
    const heads = branches.map(firstToken).filter(Boolean);
    const seen = new Set();
    for (const h of heads) {
      if (seen.has(h)) return `two of its alternatives can match the same text (both start with \`${h}\`)`;
      seen.add(h);
    }
  }
  return null;
}

function firstToken(branch) {
  if (!branch) return null;
  if (branch[0] === '\\') return branch.slice(0, 2);
  if (branch[0] === '[') return branch.slice(0, endOfClass(branch, 0) + 1);
  return branch[0];
}

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

  // Tool and plugin repositories were the blind spot. Running `init` on this one matched 4 of 39 documents
  // and dropped 35 into the fallback: every SKILL.md, every reference guide, AGENTS.md and the whole of
  // .github. The taxonomy was tuned for product repositories and quietly said "uncategorised" about the
  // shape of repository this tool is most often installed into.
  { id: 'agent', title: 'Agent instructions', blurb: 'What an assistant loads: skills, and the instructions that frame them.',
    match: ['**/SKILL.md', '**/skills/**', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '**/AGENT*.md',
            '.cursorrules', '**/prompts/**'] },
  { id: 'reference', title: 'Reference guides', blurb: 'Loaded on demand, one topic each.',
    match: ['references/**', 'docs/references/**', 'docs/reference/**', '**/*-reference.md'] },
  { id: 'community', title: 'Community', blurb: 'How to take part: templates, conduct, support.',
    match: ['.github/**', '**/CODE_OF_CONDUCT.md', '**/GOVERNANCE.md', '**/SUPPORT.md', '**/CONTRIBUTORS.md'] },
  { id: 'procedures', title: 'Procedures', blurb: 'How work is done here — SOPs, playbooks, runbooks.',
    match: ['**/*sop*.md', '**/*SOP*.md', '**/*runbook*.md', '**/*RUNBOOK*.md', 'docs/playbooks/**',
            'docs/procedures/**', 'docs/sop/**'] },
  { id: 'specs', title: 'Specifications', blurb: 'Specified behaviour, with its build status.',
    match: ['docs/specs/**', 'docs/rfc/**', '**/*SRS*.md', '**/*_srs_*.md', '**/*RFC*.md', '**/*-spec.md',
            '**/*_spec.md'] },
  // The stems are wrapped in `*` because real repositories qualify them. `docs/DEVELOPMENT-BACKLOG.md`,
  // `docs/12-ROADMAP.md`, `srs/TODO-Deferred-DeveloperID.md` and `docs/HANDOFF-TRIAL-ENDED-OPTIONS.md` are
  // four plan documents on this machine, and the bare `**/BACKLOG.md` shape matched none of them — a
  // taxonomy that only recognises a plan when it is named exactly `BACKLOG.md` recognises almost no plans.
  // `PLAN` is anchored on a hyphen rather than wrapped, because `*PLAN*` also matches `EXPLANATION.md`.
  { id: 'planning', title: 'Planning', blurb: 'What is open, and what is next.',
    match: ['**/*BACKLOG*.md', '**/*TASKS*.md', '**/*TODO*.md', '**/*HANDOFF*.md', '**/PLAN-*.md',
            '**/*-PLAN.md', 'docs/planning/**'] },
  { id: 'manuals', title: 'Manuals', blurb: 'For the user, and for the developer.',
    match: ['**/*MANUAL*.md', '**/*manual*.md', '**/*GUIDE*.md', 'docs/guides/**', '**/USAGE.md',
            '**/GETTING_STARTED.md'] },
  { id: 'operations', title: 'Operations', blurb: 'Build, ship, run, secure.',
    match: ['docs/ops/**', 'docs/operations/**', '**/DEPLOYMENT.md', '**/DEPLOY*.md', '**/INSTALL*.md',
            '**/SECURITY.md', '**/OPERATIONS.md', '**/RELEASE*.md', '**/PACKAGING.md', '**/NOTARIZATION.md',
            'hooks/**', '**/*hook*.md', '**/CI.md'] },

  // --- directory-driven: the broad catches, last ---
  { id: 'product', title: 'Product & direction', blurb: 'What is being built, and why.',
    match: ['docs/product/**', 'docs/vision/**', 'docs/direction/**', 'docs/roadmap/**', 'docs/ideas/**',
            '**/FEATURES.md', '**/*ROADMAP*.md', '**/VISION.md'] },
  { id: 'research', title: 'Research & record', blurb: 'Findings, session records, prior art. Historical by nature.',
    match: ['docs/research/**', 'docs/qa-log/**', 'docs/logs/**', 'docs/patents/**', 'docs/notes/**',
            '**/*RESEARCH*.md', '**/*_Research_*.md', '**/*worklog*.md', '**/*-log.md', '**/ANALYSIS.md'] },
  { id: 'engineering', title: 'Engineering', blurb: 'How it is built — architecture, design, data flow.',
    match: ['docs/architecture/**', 'docs/design/**', 'docs/engineering/**', '**/HLD.md', '**/LLD.md',
            '**/ARCHITECTURE.md', '**/DESIGN*.md', '**/DATA_FLOW.md', '**/*-design.md'] },
];

/**
 * Which of the taxonomy's own globs describe a **plan** — the document `planning.source` would name.
 *
 * **This is a selection, never a second list.** The tool already answers "what does a plan document look
 * like" once, in `DEFAULT_CLUSTERS`, and it answered it well enough to file `docs/DEVELOPMENT-BACKLOG.md`
 * under Planning while the dashboard beside it said no planning document was configured. Writing the
 * patterns out again here would give one question two answers, which is the failure this tool exists to
 * detect — so these entries name a cluster (and optionally which of its globs), and the globs themselves
 * stay where the taxonomy keeps them.
 *
 * The `product` cluster contributes exactly one glob. A roadmap *is* a plan and is the most common thing
 * `planning.source` points at — this repository's own points at `docs/ROADMAP.md` — but a vision statement
 * and a feature list are not plans, and pulling in the whole cluster would offer them as candidates.
 *
 * A selector that resolves to nothing is drift, not a shrug: rename a glob in `DEFAULT_CLUSTERS` and
 * detection would quietly stop finding roadmaps. `tests/run.mjs` asserts every selector still resolves.
 */
export const PLAN_GLOB_SELECTORS = [
  { cluster: 'planning' },                             // the whole cluster — that is what the cluster is for
  { cluster: 'product', only: ['**/*ROADMAP*.md'] },   // a roadmap is a plan; a vision statement is not
];

/** The selectors above, resolved against the taxonomy. Ordered as the selectors are. */
export const PLAN_DOCUMENT_GLOBS = Object.freeze(PLAN_GLOB_SELECTORS.flatMap((sel) => {
  const cluster = DEFAULT_CLUSTERS.find((c) => c.id === sel.cluster);
  if (!cluster) return [];
  return cluster.match.filter((g) => !sel.only || sel.only.includes(g));
}));

export const DEFAULT_CONFIG = {
  $schema: 'https://github.com/rmaurya/project-atlas/schema/v1',
  siteTitle: null,              // defaults to the repository directory name
  roots: ['.'],
  include: ['**/*.md'],
  exclude: [
    'node_modules/**', '.git/**', 'dist/**', 'build/**', 'out/**', 'vendor/**', 'target/**',
    '.claude/worktrees/**', '**/_wiki/**', '**/CHANGELOG.md', '**/LICENSE.md', '**/node_modules/**',
    'worklog/**',
  ],
  output: 'docs/_wiki',
  trackedOnly: true,            // discover via `git ls-files`; untracked scratch never enters the wiki
  clusters: DEFAULT_CLUSTERS,
  fallbackCluster: 'uncategorised',   // set to null to make H5 a hard failure
  // H10 and H12 join the blocking set because an SOP that has drifted is not out of date — it is incorrect
  // instructions somebody is following, and the cost lands on whoever trusted it. H10 fires only when a
  // document has exceeded an interval *it declared for itself*, and H12 only when a step cites something
  // that cannot be resolved: neither has an innocent reading. H11 stays advisory — people leave and names
  // are spelled inconsistently, and refusing a commit over a spelling teaches people to suppress it.
  blocking: ['H1', 'H3', 'H8', 'H10', 'H12'],
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
  // Weights for the homepage scorecard. Declared here so the organisation owns the judgement and the tool
  // owns only the arithmetic — a score whose weighting is hidden can be resented but not disagreed with.
  score: {},
  // The daily record. Excluded from the corpus below, because a log of what happened is not documentation
  // of how the thing works, and indexing it would drown the taxonomy in one file per day.
  worklog: {},
  analysis: {},          // { source: "docs/ANALYSIS.md" } — rendered on the homepage, never generated
  // Both on by default. A derived surface that only refreshes when someone remembers is a stale surface, and
  // the reason hand-maintained documentation rots is that keeping it current was always a separate decision.
  // Set either to false to go back to running `atlas build` and `atlas health` yourself.
  automation: {
    // The master switch. Every automatic action is off when this is false, whatever the individual keys say
    // — because a feature that can only be disabled key by key is a feature nobody disables: you turn off the
    // one that annoyed you, the rest keep running, and the next person cannot tell what is on.
    //
    // Default true. Automation that has to be remembered is the failure this whole tool exists to detect,
    // so the useful default is on and the useful escape is a single line.
    enabled: true,
    buildOnWrite: true,      // rebuild the site when a session writes markdown
    healthOnCommit: true,    // refuse a commit that introduces a blocking signal
    specOnCommit: true,      // refuse a shipped change that names no roadmap item
    planOnBranch: true,      // mark an item in progress when a branch is created for it
  },
};

export function resolveConfig(root, explicitPath) {
  let file = explicitPath ? path.resolve(explicitPath) : path.join(root, CONFIG_NAME);
  if (!explicitPath && !fs.existsSync(file)) {
    for (const legacy of LEGACY_CONFIG_NAMES) {
      const p = path.join(root, legacy);
      if (fs.existsSync(p)) { file = p; break; }   // an existing setup keeps working under an old name
    }
  }
  let user = {};
  let found = false;
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
      found = true;
    } catch (err) {
      throw new Error(`${path.basename(file)} is not valid JSON (${err.message}). Fix or delete it — the tool will not guess.`);
    }
  }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  cfg.clusters = user.clusters || DEFAULT_CLUSTERS;
  // Merged one level deep, unlike every other object key. `automation` carries two independent switches with
  // real defaults, so a shallow spread would make `{"automation":{"buildOnWrite":false}}` silently turn the
  // commit gate off as well — disabling a safety check the user never mentioned.
  cfg.automation = { ...DEFAULT_CONFIG.automation, ...(user.automation || {}) };
  cfg.siteTitle = cfg.siteTitle || path.basename(root);
  cfg.__configPath = found ? file : null;
  validate(cfg, found ? file : null);
  return cfg;
}

/* ------------------------------------------------------------------ validation */

/**
 * The type of every key the tool reads. **A configuration file is untyped JSON written by hand, and until this
 * existed the tool trusted it.** Four verified consequences, all of them silent:
 *
 *  - `{"blocking":"H1"}` — a string, not an array. `new Set("H1")` is `{'H','1'}`, no signal id ever matches,
 *    and `atlas health` exited 0 with a dead link present. The CI gate inverted without a word.
 *  - `{"include":null}` — zero documents discovered, and the build wrote an empty site over the previous one.
 *  - `{"searchBodyLimit":"lots"}` — `slice(0, "lots")` is zero characters, while the page it generates says
 *    "Full text of every document is indexed."
 *  - `{"staleDays":"ninety"}` — every comparison against it is NaN, so the H6 grace period became zero and
 *    nothing said so.
 *
 * None of these threw. Each produced a confident, wrong report, which is the failure class this project ranks
 * above all others. So: every known key is type-checked, unknown keys are refused rather than ignored (a
 * typo'd key is a setting that silently did nothing), and every message names the file the reader has to open.
 */
const T = {
  string: (v) => typeof v === 'string',
  nonEmptyString: (v) => typeof v === 'string' && v.trim() !== '',
  boolean: (v) => typeof v === 'boolean',
  object: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  stringArray: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  objectArray: (v) => Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && !Array.isArray(x)),
  // `Number.isFinite` and not `typeof v === 'number'`: NaN is a number, and NaN is exactly the value that made
  // the staleness grace period vanish silently.
  finiteNumber: (v) => Number.isFinite(v),
  nonNegativeNumber: (v) => Number.isFinite(v) && v >= 0,
  positiveNumber: (v) => Number.isFinite(v) && v > 0,
};

/** key → [predicate, description, nullable]. Anything not listed here is refused as unknown. */
const SCHEMA = {
  $schema: [T.string, 'a string'],
  siteTitle: [T.string, 'a string', true],
  roots: [T.stringArray, 'an array of strings'],
  include: [T.stringArray, 'an array of glob strings'],
  exclude: [T.stringArray, 'an array of glob strings'],
  output: [T.nonEmptyString, 'a non-empty string — the directory the site is written to'],
  trackedOnly: [T.boolean, 'true or false'],
  clusters: [T.objectArray, 'an array of cluster objects'],
  fallbackCluster: [T.string, 'a string, or null to make H5 a hard failure', true],
  blocking: [T.stringArray, 'an array of signal ids'],
  staleDays: [T.nonNegativeNumber, 'a number of days, zero or more'],
  citationExtensions: [T.stringArray, 'an array of file-extension strings'],
  forbiddenTerms: [T.objectArray, 'an array of rule objects'],
  crossref: [T.objectArray, 'an array of pair objects'],
  suppress: [T.objectArray, 'an array of suppression objects'],
  planning: [T.object, 'an object'],
  deck: [T.object, 'an object'],
  searchBodyLimit: [T.positiveNumber, 'a positive number of characters'],
  views: [T.objectArray, 'an array of view objects'],
  publish: [T.object, 'an object'],
  contrib: [T.object, 'an object'],
  tokens: [T.object, 'an object'],
  branching: [T.object, 'an object'],
  automation: [T.object, 'an object'],
  score: [T.object, 'an object'],
  worklog: [T.object, 'an object'],
  analysis: [T.object, 'an object'],
};

/**
 * Is one automatic action allowed?
 *
 * The single place that answers it. Three call sites each read `cfg.automation.<key> === false` directly,
 * which is how a master switch gets added and then quietly ignored by the fourth caller — and an
 * `enabled: false` that some code respects and other code does not is worse than no switch at all, because
 * it is believed.
 */
export function automationAllows(cfg, key) {
  const a = cfg?.automation || {};
  if (a.enabled === false) return false;
  return a[key] !== false;
}

/** Every switch under `automation`, and what it turns off. Anything else there is refused as a typo. */
export const AUTOMATION_KEYS = {
  enabled: 'the master switch — false turns off every automatic action below',
  buildOnWrite: 'rebuild the site when a session writes markdown',
  healthOnCommit: 'refuse a commit that introduces a blocking signal',
  specOnCommit: 'refuse a shipped change that names no roadmap item',
  planOnBranch: 'mark a plan item in progress when a branch names it',
};

const KNOWN_TONES = new Set(['none', 'mid', 'high', 'done', 'unknown']);

function validate(cfg, configPath = null) {
  const problems = [];
  const at = configPath ? ` (in ${configPath})` : '';
  const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v)?.slice(0, 80) ?? String(v));

  for (const [key, value] of Object.entries(cfg)) {
    if (key.startsWith('__')) continue;                 // internal, set by resolveConfig after the merge
    const rule = SCHEMA[key];
    if (!rule) {
      problems.push(`unknown key ${JSON.stringify(key)}${at} — it is read by nothing, so whatever it was meant ` +
        `to configure is still at its default. Known keys: ${Object.keys(SCHEMA).sort().join(', ')}`);
      continue;
    }
    const [ok, described, nullable] = rule;
    if (value === null && nullable) continue;
    if (!ok(value)) problems.push(`${key} must be ${described}${at} — got ${show(value)}`);
  }

  if (!Array.isArray(cfg.clusters) || !cfg.clusters.length) problems.push(`clusters must be a non-empty array${at}`);
  const ids = new Set();
  for (const c of Array.isArray(cfg.clusters) ? cfg.clusters : []) {
    if (!c || typeof c !== 'object') continue;          // already reported by the type check above
    if (!c.id) problems.push(`every cluster needs an id${at}`);
    if (ids.has(c.id)) problems.push(`duplicate cluster id: ${c.id}${at}`);
    ids.add(c.id);
    if (c.match !== undefined && !T.stringArray(c.match)) {
      problems.push(`cluster "${c.id}" has a match that is not an array of globs${at} — got ${show(c.match)}`);
    }
  }

  // A blocking id that names no signal is not a stricter gate, it is a gate that never fires. Naming the
  // offending value matters more than the type here: "H10" and "h1" both look right in a diff.
  if (T.stringArray(cfg.blocking)) {
    const known = Object.keys(SIGNALS);
    for (const id of cfg.blocking) {
      if (known.includes(id)) continue;
      // **A config written for a newer atlas must degrade, not refuse.** An id shaped like a signal that
      // this build has never heard of is almost always exactly that: the repository upgraded its config and
      // an older installed copy is still running somewhere — a hook, a colleague's machine, CI. Hard-failing
      // there takes every other check down with it, which is a far worse outcome than one gate not firing.
      // It is still said out loud, because a blocking signal that silently does not fire is not a gate.
      if (/^H\d+$/.test(id)) {
        problems.push({ level: 'warn',
          text: `blocking names ${JSON.stringify(id)}, which this build does not know${at}. The config was ` +
                `probably written for a newer project-atlas; that gate will not fire here. Known: ${known.join(', ')}` });
        continue;
      }
      problems.push(`blocking names ${JSON.stringify(id)}, which is not a signal${at} — known signals: ${known.join(', ')}`);
    }
  }

  for (const s of Array.isArray(cfg.suppress) ? cfg.suppress : []) {
    if (!s || typeof s !== 'object') continue;
    if (!s.reason) problems.push(`suppress entry for ${s.signal || '?'} ${s.path || ''} has no reason${at} — a reason is mandatory`);
  }

  // A tone is interpolated into a class attribute on the dashboard. It is allow-listed at the point of use as
  // well, but a tone that silently renders as "unknown" is a chart that quietly lies about its own scale.
  const bands = cfg.planning?.statusBands;
  if (bands !== undefined) {
    if (!T.objectArray(bands)) problems.push(`planning.statusBands must be an array of band objects${at} — got ${show(bands)}`);
    else for (const b of bands) {
      if (!T.finiteNumber(b.max)) problems.push(`a planning.statusBands entry has a max that is not a number${at} — got ${show(b.max)}`);
      if (!T.nonEmptyString(b.label)) problems.push(`a planning.statusBands entry has no label${at} — colour is never the only signal, so every band needs one`);
      if (!KNOWN_TONES.has(b.tone)) {
        problems.push(`planning.statusBands entry ${JSON.stringify(b.label)} has tone ${show(b.tone)}${at} — known tones: ${[...KNOWN_TONES].join(', ')}`);
      }
    }
  }

  // A misspelled switch here fails open — the automation stays on and the user believes they turned it off.
  // So an unknown key is refused, and a non-boolean is refused rather than coerced: `"false"` is truthy.
  if (T.object(cfg.automation)) {
    for (const [k, v] of Object.entries(cfg.automation)) {
      if (!(k in AUTOMATION_KEYS)) {
        problems.push(`unknown key ${JSON.stringify(`automation.${k}`)}${at} — known switches: ${Object.keys(AUTOMATION_KEYS).join(', ')}`);
      } else if (typeof v !== 'boolean') {
        problems.push(`automation.${k} is ${show(v)}${at} — it must be true or false. A string is always truthy, so "false" would leave it on.`);
      }
    }
  }

  // Warnings are said and survived; errors are fatal. The split exists so that a config written for a newer
  // build degrades to "that gate will not fire here" rather than taking every other check down with it.
  const warnings = problems.filter((p) => p && typeof p === 'object' && p.level === 'warn');
  const errors = problems.filter((p) => !(p && typeof p === 'object' && p.level === 'warn'));
  for (const w of warnings) console.error(`project-atlas: ${w.text}`);
  if (errors.length) throw new Error('Invalid configuration:\n  - ' + errors.join('\n  - '));
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
