/**
 * project-atlas · views
 *
 * Six audiences want six different first screens over **one body of derived data**. The obvious
 * implementation — six pages — forks the moment somebody edits one, which is the exact failure this project
 * exists to detect. So a view is a **list of panel ids**, panels are written once, and adding a view is a
 * config entry rather than a file.
 *
 * Two rules that keep it honest:
 *
 *  - **A panel with no data is omitted and said, never rendered empty.** An empty box reads as "nothing to
 *    report"; a stated omission reads as "this could not be shown, and here is why".
 *  - **A view never invents a metric its panels do not already produce.** If a role wants something the
 *    derived data cannot support, the answer is that it is unavailable — not a plausible proxy with a
 *    role-flattering name.
 */

export const PANELS = {
  tiles: 'Headline numbers — items, completion, files in flight, blocking findings, corpus size',
  inflight: 'Work that has not landed yet — the branch, what is uncommitted, and which plan items it names',
  progress: 'Mean completion by track',
  status: 'Items by status',
  items: 'The full item table, sortable and filterable per column',
  health: 'Rot signals, blocking and advisory',
  clusters: 'Documents by cluster',
  deliveryTiles: 'Commits, AI-assisted share, rework rate, conventional subjects',
  velocity: 'Commits per week',
  models: 'Model mix from Co-Authored-By trailers',
  people: 'Per-author commits, files, churn, days, estimated hours',
  desks: 'Per-desk attribution from the Desk: trailer',
  coverage: 'Spec-to-build — items named by a commit',
  repoTiles: 'Repository scale — files under change, how few areas hold half the churn, branches, sole-author areas',
  churn: 'Where the change lands — lines changed per area of the tree, and how many people have ever touched each',
  hotspots: 'The files the work keeps returning to, and how far each one moves when it is touched',
  branches: 'Every local branch, how far behind the newest commit it sits, and whether it still holds anything',
  documents: 'The documents this role owns, with dates, status and signals',
  recent: 'Recent commits — what changed, and when',
  changes: 'What changed, and which documents cite the files you touched',
  testcases: 'The test inventory — cases by area, and how many exist because something broke',
  decisions: 'Decision records, and how many decisions have not reached them',
  signals: 'Every rot signal this tool checks for, including the ones that found nothing',
  charts: 'Contribution, effort and plan composition, derived from git and the plan',
  designRecord: 'Which design artifacts exist: HLD, LLD, data flow, decision records, specifications',
  blueprint: 'The design record assembled into one reading, in dependency order, out of the documents themselves',
  undesigned: 'Code areas no design document cites',
  citations: 'Per design document: how many code citations, and how many still resolve',
  backlog: 'Every task in full: description, the documents that specify it, and who worked on it',
  worklog: 'The daily work log, one entry per contributor per day',
  caveats: 'What this page does not show, and why',
};

/**
 * The shipped views. Each is a first screen, not a filter — the order of panels is the argument the page
 * makes to that reader.
 *
 * **`inflight` sits directly under `tiles` on every view that carries a plan figure.** Those five pages are
 * the ones that read as finished: a plan panel can only show what somebody wrote down and marked, so a
 * repository mid-change rendered as "62 items · Done (62) · In progress (0)" on a dirty branch. The panel is
 * placed adjacent to the numbers it qualifies rather than further down, because the failure was never that
 * the figure was unavailable — it was that the figure looked like the whole answer.
 *
 * It is deliberately **not** on `developer`, which already carries `changes`. The two read the same git
 * state and answer different questions — `changes` asks which documents the edit has just put at risk, this
 * asks whether anything is underway and whether the plan knows — and showing both on one page would print
 * the same file counts twice for no answer the page did not already have.
 */
export const DEFAULT_VIEWS = [
  {
    id: 'dashboard', title: 'Overview', nav: true,
    blurb: 'Everything, in the order a maintainer reads it.',
    panels: ['tiles', 'inflight', 'progress', 'charts', 'status', 'health', 'signals', 'clusters', 'deliveryTiles', 'velocity', 'models', 'people', 'desks', 'coverage', 'items', 'caveats'],
  },
  {
    // Its own page, not a panel on someone else's. The item table elsewhere is a scanning tool — an id, a
    // figure, a clamped summary — and it deliberately stays that way. This is the reading view: the whole
    // description, where the work is specified, and who has touched it.
    id: 'backlog', title: 'Backlog', nav: true,
    blurb: 'Every task in full — what it says, what specifies it, and who has worked on it.',
    panels: ['inflight', 'backlog', 'caveats'],
  },
  {
    id: 'qc', title: 'Quality', nav: true,
    blurb: 'Where the corpus is wrong, how often work has to be redone, and what has just landed.',
    clusters: ['procedures', 'planning', 'manuals'],
    panels: ['health', 'signals', 'testcases', 'deliveryTiles', 'recent', 'documents', 'coverage', 'caveats'],
  },
  {
    id: 'product', title: 'Product', nav: true,
    blurb: 'What is in scope, how far along it is, and how much of that figure is measured rather than estimated.',
    clusters: ['product', 'planning'],
    panels: ['tiles', 'inflight', 'progress', 'status', 'documents', 'items', 'caveats'],
  },
  {
    id: 'delivery', title: 'Delivery', nav: true,
    blurb: 'Throughput and where it is concentrated. Rhythm, not value — a commit count measures neither difficulty nor worth.',
    clusters: ['planning', 'operations'],
    panels: ['deliveryTiles', 'inflight', 'charts', 'velocity', 'worklog', 'recent', 'people', 'desks', 'status', 'documents', 'caveats'],
  },
  {
    /*
     * **Delivery and this page read the same `git log` and never ask it the same question.**
     *
     * That distinction was the whole argument for building this rather than renaming Delivery, so it is
     * written down where the next person will find it. Delivery's unit of analysis is *the commit and the
     * person*: how many, by whom, in which week, with which model assisting. Every panel on it — the tiles,
     * velocity, models, people, desks, coverage, recent — aggregates commits over **time and identity**.
     *
     * Not one of them ever names a path. Walk that page end to end and you cannot learn that `scripts/lib`
     * has absorbed 43% of every line this repository has ever changed, that `tests/run.mjs` is a single file
     * carrying more churn than every directory in the tree bar one, or that two of forty areas hold half of
     * everything. Those are facts about **where the work landed**, and where is a different axis from when
     * and who — orthogonal, not a filter. A reader who wants to know what is fragile is asking a spatial
     * question, and this tool had no page that answered one.
     *
     * **What was deliberately not built here, and why, because the omissions carry as much of the argument:**
     *
     *  - **No weekly chart.** Delivery already owns the time axis three times over, and a third rendering of
     *    the same series under a new heading is exactly the duplicated page this view had to justify not
     *    being. The one real defect on that axis — `velocityChart` plotting `contrib.weeks` by index, so a
     *    silent fortnight closed up into one step — was fixed in place on Delivery instead. Fixing the page
     *    that owns the question beats drawing it again on the page that does not.
     *  - **No surviving-lines panel.** `surviving.mjs` is opt-in *because* blaming every line of every file
     *    runs to minutes on a large repository, and a build that hangs is a build nobody runs twice. A figure
     *    good enough for a command someone chose to type is not thereby good enough for every `atlas watch`.
     *  - **No ranking of anybody.** Files and directories are ranked here; people are not, anywhere, and the
     *    authorship figure on the churn panel is a count of who *could* be asked about an area rather than a
     *    measure of who did the most to it.
     */
    id: 'repository', title: 'Repository', nav: true,
    blurb: 'Where the change lands and what it has concentrated on. Not who did it or when — that is Delivery. This is the shape of the tree underneath.',
    panels: ['repoTiles', 'churn', 'hotspots', 'branches', 'inflight', 'caveats'],
  },
  {
    id: 'architecture', title: 'Architecture', nav: true,
    blurb: 'The design record — HLD, LLD, specifications — and where it has drifted from the code it cites.',
    clusters: ['engineering', 'specs'],
    panels: ['designRecord', 'decisions', 'undesigned', 'citations', 'documents', 'health', 'clusters', 'caveats'],
  },
  {
    // Its own page, and one panel on it. The Architecture view is a set of measurements *about* the design
    // record — how many artifacts exist, which citations still resolve, what is undesigned. This is the
    // record itself, read end to end in the order the documents depend on each other. Neither is a filter of
    // the other, and folding this in as a ninth panel over there would put a reading order inside a masonry
    // of peers.
    id: 'blueprint', title: 'Blueprint', nav: true,
    blurb: 'What the system is, how it hangs together, and what was decided — assembled from the design documents, never written here.',
    clusters: ['engineering', 'specs'],
    panels: ['blueprint', 'caveats'],
  },
  {
    id: 'developer', title: 'Developer', nav: true,
    blurb: 'What you changed, what cites it, and where the corpus is about to disagree with the code.',
    clusters: ['engineering', 'references'],
    panels: ['changes', 'health', 'documents', 'recent', 'caveats'],
  },
  {
    id: 'executive', title: 'Executive', nav: true,
    blurb: 'The few numbers that survive summarising. Everything here is a link to the page that explains it.',
    /*
     * **`inflight` was here and had to come off.** The panel is a file-by-file table — twenty rows of paths
     * and line counts — and on a page whose stated promise is "the few numbers that survive summarising" it
     * became the tallest thing on the screen, squeezed into one masonry column with its table clipped. An
     * executive reading for thirty seconds does not want the diff; the headline tile already says how many
     * files are in flight, and it links to the view that lists them.
     *
     * `charts` replaces it, which is what this page was missing: it is the only view with a plan figure, a
     * delivery figure and no picture of either, so the one audience least able to spend time reading was the
     * one being handed the most prose. Composition, contribution and effort in a glance, then the numbers.
     *
     * **`coverage` joins them, and it is the only question here that is not a self-report.** Everything else
     * on this page is the plan describing itself or git describing itself; spec-to-build crosses the two and
     * asks whether the items claiming progress are the items commits actually name. On this repository as
     * this is written that is 61 of 69 named, and 8 reporting progress with no commit against them — a number
     * an executive can act on, phrased as a question rather than an accusation. The panel already existed and
     * already shipped on Overview and Quality; the one page whose whole job is the summary did not have it.
     *
     * **The list stays short on purpose, and the layout depends on it.** `viewPage` gives a view the full
     * width when it has no more masonry cards than masonry has columns, and this page has exactly three:
     * progress, coverage and the caveats. A fourth would put it back into three narrow columns and undo the
     * reason this view was rebuilt — so a panel added here has to earn its place against that.
     */
    panels: ['tiles', 'charts', 'deliveryTiles', 'progress', 'coverage', 'caveats'],
  },
];

/**
 * A view id becomes a filename: `path.join(outDir, 'view-' + id + '.html')`. That makes it a path, and a path
 * from a config file is untrusted input — verified with `{"id":"x/../../../ESCAPED"}`, which wrote a file
 * above the repository root. Constrained rather than sanitised: an id is also a URL fragment and a nav key, so
 * anything outside this set is a mistake worth reporting by name, not something to quietly rewrite.
 */
const VIEW_ID = /^[A-Za-z0-9-]+$/;

export function resolveViews(cfg) {
  const configured = cfg.views;
  const views = Array.isArray(configured) && configured.length ? configured : DEFAULT_VIEWS;
  const seen = new Set();
  const problems = [];
  for (const v of views) {
    if (!v.id) problems.push('a view has no id');
    else if (!VIEW_ID.test(v.id)) problems.push(`view id ${JSON.stringify(v.id)} is not allowed — an id becomes a filename, so it must match ${VIEW_ID}`);
    if (seen.has(v.id)) problems.push(`duplicate view id: ${v.id}`);
    seen.add(v.id);
    for (const p of v.panels || []) {
      if (!PANELS[p]) problems.push(`view "${v.id}" names an unknown panel "${p}" — known: ${Object.keys(PANELS).join(', ')}`);
    }
  }
  if (problems.length) throw new Error('Invalid views configuration:\n  - ' + problems.join('\n  - '));
  return views;
}

/** `dashboard` keeps the historic filename so existing links and the artifact export do not break. */
export const viewFile = (id) => (id === 'dashboard' ? 'dashboard.html' : `view-${id}.html`);

/**
 * The site's navigation, generated from whatever exists. Adding a view adds a menu entry with no second
 * edit; a deck that was never authored never appears.
 */
export function navItems(views, { hasDeck }) {
  const items = [{ href: 'index.html', label: 'Home' }];
  for (const v of views) if (v.nav !== false) items.push({ href: viewFile(v.id), label: v.title });
  items.push({ href: 'wiki.html', label: 'Wiki' });
  if (hasDeck) items.push({ href: 'deck.html', label: 'Deck' });
  items.push({ href: 'health.html', label: 'Health' });
  return items;
}
