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
  tiles: 'Headline numbers — items, completion, blocking findings, corpus size',
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
  caveats: 'What this page does not show, and why',
};

/**
 * The shipped views. Each is a first screen, not a filter — the order of panels is the argument the page
 * makes to that reader.
 */
export const DEFAULT_VIEWS = [
  {
    id: 'dashboard', title: 'Overview', nav: true,
    blurb: 'Everything, in the order a maintainer reads it.',
    panels: ['tiles', 'progress', 'status', 'health', 'clusters', 'deliveryTiles', 'velocity', 'models', 'people', 'desks', 'coverage', 'items', 'caveats'],
  },
  {
    id: 'qc', title: 'Quality', nav: true,
    blurb: 'Where the corpus is wrong, and how often work has to be redone. Leads with defects that have no legitimate cause.',
    panels: ['health', 'deliveryTiles', 'coverage', 'clusters', 'caveats'],
  },
  {
    id: 'product', title: 'Product', nav: true,
    blurb: 'What is in scope, how far along it is, and how much of that figure is measured rather than estimated.',
    panels: ['tiles', 'progress', 'status', 'items', 'caveats'],
  },
  {
    id: 'delivery', title: 'Delivery', nav: true,
    blurb: 'Throughput and where it is concentrated. Rhythm, not value — a commit count measures neither difficulty nor worth.',
    panels: ['deliveryTiles', 'velocity', 'people', 'desks', 'status', 'caveats'],
  },
  {
    id: 'architecture', title: 'Architecture', nav: true,
    blurb: 'Where the documentation and the code have drifted apart, and which specifications were never started.',
    panels: ['health', 'clusters', 'coverage', 'progress', 'caveats'],
  },
  {
    id: 'executive', title: 'Executive', nav: true,
    blurb: 'The few numbers that survive summarising. Everything here is a link to the page that explains it.',
    panels: ['tiles', 'deliveryTiles', 'progress', 'caveats'],
  },
];

export function resolveViews(cfg) {
  const configured = cfg.views;
  const views = Array.isArray(configured) && configured.length ? configured : DEFAULT_VIEWS;
  const seen = new Set();
  const problems = [];
  for (const v of views) {
    if (!v.id) problems.push('a view has no id');
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
  if (hasDeck) items.push({ href: 'deck.html', label: 'Deck' });
  items.push({ href: 'health.html', label: 'Health' });
  return items;
}
