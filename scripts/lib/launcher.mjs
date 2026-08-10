/**
 * project-atlas · one doorway to every dashboard on the machine
 *
 * A developer works on several projects at once, in several terminals. Each gets its own dashboard on its
 * own port — that part is already handled, because the port is derived from the repository path — but a
 * hand-written link to one of them is wrong the moment you switch projects, and *silently* wrong: it opens
 * a real dashboard belonging to something else. That is the failure this whole tool spent a session
 * chasing, so a launcher that could produce it is not worth having.
 *
 * So the launcher is generated, and it lists every project atlas knows about rather than the one that
 * happened to be current when somebody wrote the file.
 *
 * ## What it can and cannot know
 *
 * This page is published as an artifact, which runs under a policy that blocks outbound requests — so it
 * **cannot** check whether a server is up. It says so rather than implying freshness it has not verified: a
 * green dot this page could not have earned would be the same lie as a build stamp nobody checked.
 *
 * What it *can* rely on is that a port is a pure function of a repository path. A link recorded here stays
 * correct for that checkout for as long as the checkout exists, whether or not the server is running at any
 * given moment — which is exactly the property that makes a static launcher honest.
 */

import path from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {object[]} projects  `{ name, root, port, url, current }`
 * @param {object}   opts      `{ generatedAt, pages }` — `pages` is an optional deployed URL for the current repo
 */
export function renderLauncher(projects, { generatedAt = null, pages = null } = {}) {
  const rows = projects.map((p) => `
    <li class="proj${p.current ? ' is-current' : ''}">
      <a href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="pname">${esc(p.name)}${p.current ? '<span class="here">this repository</span>' : ''}</span>
        <span class="purl">${esc(p.url)}</span>
        <span class="proot">${esc(p.root)}</span>
      </a>
    </li>`).join('');

  return `<title>atlas dashboards</title>
<style>
  /* Contour palette from the project's own mark. Every colour is defined on bare :root first, so the
     un-stamped "system" state — where most viewers are — has a complete palette before any query runs. */
  :root {
    --ground:#f6f4ef; --panel:#fffdf9; --rule:#e4dfd4; --raise:#f0ece3;
    --ink:#1c1b18; --ink-soft:#6b665c; --ink-faint:#96907f;
    --contour:#2f3b3a; --benchmark:#c1622d;
    --shadow:0 1px 2px rgba(28,27,24,.05), 0 10px 30px -14px rgba(28,27,24,.22);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#14171a; --panel:#1b1f23; --rule:#2c3239; --raise:#232930;
      --ink:#eef1f3; --ink-soft:#9aa4ad; --ink-faint:#6e767e;
      --contour:#8fb3ad; --benchmark:#e8834a;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 34px -16px rgba(0,0,0,.75);
    }
  }
  :root[data-theme="dark"] {
    --ground:#14171a; --panel:#1b1f23; --rule:#2c3239; --raise:#232930;
    --ink:#eef1f3; --ink-soft:#9aa4ad; --ink-faint:#6e767e;
    --contour:#8fb3ad; --benchmark:#e8834a;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 34px -16px rgba(0,0,0,.75);
  }

  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; padding:34px 20px; display:flex; justify-content:center;
    background:var(--ground); color:var(--ink);
    font:16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased;
  }
  .wrap { width:100%; max-width:560px; }
  .head { position:relative; overflow:hidden; background:var(--panel); border:1px solid var(--rule);
          border-radius:14px 14px 0 0; border-bottom:0; padding:26px 28px 20px; box-shadow:var(--shadow); }
  .ridge { position:absolute; inset:0 0 auto 0; height:64px; opacity:.5; pointer-events:none; }
  .eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); margin:0 0 5px; }
  h1 { margin:0 0 7px; font-size:25px; line-height:1.2; letter-spacing:-.015em; text-wrap:balance;
       font-family:ui-monospace,"SF Mono",Menlo,monospace; font-weight:620; }
  h1 .dot { color:var(--benchmark); }
  .lede { margin:0; color:var(--ink-soft); font-size:14px; }

  ul { list-style:none; margin:0; padding:0; background:var(--panel);
       border:1px solid var(--rule); border-radius:0 0 14px 14px; box-shadow:var(--shadow); overflow:hidden; }
  .proj + .proj { border-top:1px solid var(--rule); }
  .proj a { display:grid; grid-template-columns:1fr auto; gap:2px 14px; align-items:baseline;
            padding:14px 28px; text-decoration:none; color:inherit; transition:background .12s ease; }
  .proj a:hover { background:var(--raise); }
  .proj a:focus-visible { outline:2px solid var(--benchmark); outline-offset:-2px; }
  .pname { font-weight:620; font-size:15px; }
  .here { margin-left:8px; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
          color:var(--benchmark); border:1px solid currentColor; border-radius:4px; padding:1px 5px; vertical-align:middle; }
  .purl { font:12.5px/1.5 ui-monospace,Menlo,monospace; color:var(--benchmark); text-align:right; }
  .proot { grid-column:1 / -1; font:11.5px/1.5 ui-monospace,Menlo,monospace; color:var(--ink-faint);
           word-break:break-all; }
  .empty { padding:22px 28px; color:var(--ink-soft); font-size:14px; }
  .note { margin:18px 2px 0; font-size:12.5px; line-height:1.65; color:var(--ink-soft); }
  code { font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  a.pages { color:var(--benchmark); }
</style>

<div class="wrap">
  <div class="head">
    <svg class="ridge" viewBox="0 0 560 64" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 50 C 80 26, 130 56, 200 38 S 340 14, 430 34 S 520 52, 560 30" fill="none"
            stroke="var(--contour)" stroke-width="1.1" opacity=".45"/>
      <path d="M0 60 C 90 40, 150 64, 220 48 S 350 26, 440 46 S 530 60, 560 44" fill="none"
            stroke="var(--contour)" stroke-width="1.1" opacity=".26"/>
    </svg>
    <p class="eyebrow">project-atlas</p>
    <h1>Dashboards<span class="dot">.</span></h1>
    <p class="lede">One per project, each on a port derived from its own path — so several can run at once
      and none of them can be mistaken for another.</p>
  </div>
  ${projects.length ? `<ul>${rows}</ul>` : `<ul><li class="empty">No project has started a dashboard yet.
    Run <code>atlas serve</code> in a repository that has adopted the tool.</li></ul>`}

  <p class="note"><strong>These links are recorded, not checked.</strong> This page is published as an
    artifact and cannot reach your machine to ask whether a server is up — so it does not pretend to know.
    A port is a pure function of the repository path, so a link stays correct for that checkout whether or
    not the server is running right now. A dashboard that has gone idle comes back on the next markdown
    edit, or with <code>atlas serve</code>.${pages ? `<br>Deployed copy of this repository:
    <a class="pages" href="${esc(pages)}" target="_blank" rel="noopener">${esc(pages)}</a>.` : ''}</p>
  ${generatedAt ? `<p class="note">Recorded ${esc(generatedAt)}. Re-run <code>atlas serve --launcher</code>
    after adding a project.</p>` : ''}
</div>`;
}

/** The registry, plus the current repository whether or not it is running. */
export function launcherProjects(registry, { root = null, port = null } = {}) {
  const here = root ? path.resolve(root) : null;
  const seen = new Map();
  for (const e of registry) {
    seen.set(path.resolve(e.root), { name: e.name || path.basename(e.root), root: e.root, port: e.port, url: e.url });
  }
  if (here && port && !seen.has(here)) {
    seen.set(here, { name: path.basename(here), root: here, port, url: `http://127.0.0.1:${port}/` });
  }
  return [...seen.values()]
    .map((p) => ({ ...p, current: here && path.resolve(p.root) === here }))
    .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || a.name.localeCompare(b.name));
}
