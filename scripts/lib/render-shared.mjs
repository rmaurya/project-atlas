/**
 * Shared between the site renderer and the dashboard. `flatName` lives here rather than in render.mjs
 * because dashboard.mjs needs it to link to document pages, and importing render.mjs from dashboard.mjs
 * would be circular — render.mjs already imports dashboard.mjs.
 */
export const flatName = (p) => p.replace(/\.md$/i, '').replace(/[/\\]/g, '__') + '.html';
