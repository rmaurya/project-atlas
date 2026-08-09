/**
 * project-atlas · host detection and capability probing
 *
 * **This is the only module in the tool that touches the network, and it does so only when asked.**
 * Everything else — scan, health, build, publish staging — is entirely offline. That separation is
 * deliberate and load-bearing: the promise "no network" is worth nothing if any command might quietly make a
 * request, so network use lives in one file, behind one explicit command, and says so when it runs.
 *
 * ## Why probe at all
 *
 * Wiki, Pages, Issues and Discussions are per-repository features that can each be off. A publish target
 * aimed at a disabled feature fails with an obscure git error — "repository not found" for a wiki that was
 * never enabled — which sends people looking for an authentication problem they do not have. Probing turns
 * that into one sentence naming the setting to flip.
 *
 * ## What happens when the probe cannot run
 *
 * Offline, rate-limited, private repository without a token, unknown host: the probe returns
 * `{ checked: false, reason }` and the caller **proceeds with a stated assumption**. It never guesses
 * silently, and it never blocks work because a network call failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CACHE_TTL_MS = 60 * 60 * 1000;      // unauthenticated GitHub allows 60 requests/hour, so cache an hour

/* ------------------------------------------------------------------ detection (offline) */

/** Parse the git remote into a host, an owner/repo slug, and the derived URLs. No network. */
export function detectHost(root, cfg = {}) {
  let url = cfg.publish?.remote || null;
  if (!url) {
    try {
      url = execFileSync('git', ['config', '--get', 'remote.origin.url'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { url = null; }
  }
  if (!url) return { kind: 'none', slug: null, url: null, reason: 'no git remote named origin' };

  // The wiki must be reached the same way origin is. A repository cloned over SSH usually has no HTTPS
  // credentials configured, and pushing to an https:// wiki URL then fails as "Repository not found" —
  // indistinguishable from the wiki not existing, which sends you debugging the wrong problem.
  const overSsh = /^git@|^ssh:\/\//.test(url);

  const gh = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (gh) {
    const slug = `${gh[1]}/${gh[2]}`;
    return {
      kind: 'github', slug, url, overSsh,
      web: `https://github.com/${slug}`,
      wikiGit: overSsh ? `git@github.com:${slug}.wiki.git` : `https://github.com/${slug}.wiki.git`,
      api: `https://api.github.com/repos/${slug}`,
      pagesUrl: `https://${gh[1]}.github.io/${gh[2]}/`,
      issuesUrl: `https://github.com/${slug}/issues`,
      discussionsUrl: `https://github.com/${slug}/discussions`,
    };
  }

  const gl = /gitlab\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (gl) {
    const slug = gl[1];
    return {
      kind: 'gitlab', slug, url, overSsh,
      web: `https://gitlab.com/${slug}`,
      wikiGit: overSsh ? `git@gitlab.com:${slug}.wiki.git` : `https://gitlab.com/${slug}.wiki.git`,
      api: `https://gitlab.com/api/v4/projects/${encodeURIComponent(slug)}`,
      pagesUrl: null,                      // GitLab Pages is a CI artifact, not a branch — no URL to derive
      issuesUrl: `https://gitlab.com/${slug}/-/issues`,
      discussionsUrl: null,                // GitLab has no Discussions equivalent
    };
  }

  return { kind: 'unknown', slug: null, url, reason: 'remote is neither github.com nor gitlab.com' };
}

/* ------------------------------------------------------------------ probing (network) */

const cachePath = (root) => path.join(root, '.git', 'project-atlas-capabilities.json');

/**
 * Ask the host which features are enabled. Network. Cached for an hour inside `.git/`, which is never
 * committed and survives a build wiping the output directory.
 */
export async function probeCapabilities(root, host, { timeoutMs = 6000, offline = false, fresh = false } = {}) {
  const unknown = (reason) => ({ checked: false, reason, wiki: null, issues: null, discussions: null, pages: null });

  if (offline) return unknown('--offline was passed, so no request was made');
  if (host.kind === 'none' || host.kind === 'unknown') return unknown(host.reason);

  if (!fresh) {
    const cached = readCache(root, host.slug);
    if (cached) return { ...cached, cached: true };
  }

  let json;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(host.api, {
      signal: ctl.signal,
      headers: { accept: 'application/json', 'user-agent': 'project-atlas' },
    });
    clearTimeout(timer);
    if (res.status === 404) return unknown('the host returned 404 — the repository is private, renamed, or does not exist');
    if (res.status === 403) return unknown('the host returned 403 — unauthenticated rate limit reached; try again later');
    if (!res.ok) return unknown(`the host returned HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    return unknown(`the request failed (${err?.name === 'AbortError' ? `no response in ${timeoutMs}ms` : err.message})`);
  }

  const caps = host.kind === 'github'
    ? {
        checked: true, host: 'github', slug: host.slug,
        visibility: json.private ? 'private' : 'public',
        defaultBranch: json.default_branch || null,
        wiki: !!json.has_wiki,
        issues: !!json.has_issues,
        discussions: !!json.has_discussions,
        pages: !!json.has_pages,
      }
    : {
        checked: true, host: 'gitlab', slug: host.slug,
        visibility: json.visibility || null,
        defaultBranch: json.default_branch || null,
        wiki: json.wiki_enabled ?? (json.wiki_access_level && json.wiki_access_level !== 'disabled'),
        issues: json.issues_enabled ?? (json.issues_access_level && json.issues_access_level !== 'disabled'),
        discussions: null,                  // GitLab has no equivalent; null means "not applicable", not "off"
        pages: json.pages_access_level ? json.pages_access_level !== 'disabled' : null,
      };

  writeCache(root, caps);
  return caps;
}

function readCache(root, slug) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(root), 'utf8'));
    if (raw.slug !== slug) return null;
    if (Date.now() - raw.at > CACHE_TTL_MS) return null;
    return raw.caps;
  } catch { return null; }
}

function writeCache(root, caps) {
  try {
    fs.writeFileSync(cachePath(root), JSON.stringify({ slug: caps.slug, at: Date.now(), caps }), 'utf8');
  } catch { /* .git may be absent or read-only; caching is an optimisation, never a requirement */ }
}

/* ------------------------------------------------------------------ gating */

/**
 * Decide whether a publish target can proceed.
 *
 * Returns `{ ok, reason, hint }`. An unprobed capability is **not** treated as absent — refusing to work
 * because a network call failed would be worse than the obscure error this exists to prevent.
 */
export function gateTarget(target, host, caps) {
  if (host.kind === 'none') {
    return { ok: false, reason: 'This directory has no git remote named origin.', hint: 'Add one, or set publish.remote in the config.' };
  }
  if (target === 'export') return { ok: true };

  if (target === 'wiki') {
    if (host.kind === 'unknown') return { ok: true, warn: 'Unrecognised host — the wiki URL is a guess.' };
    if (caps.checked && caps.wiki === false) {
      return {
        ok: false,
        reason: `The wiki is disabled on ${caps.slug}.`,
        hint: host.kind === 'github'
          ? 'Settings → General → Features → tick Wikis, then open the wiki once so its repository is initialised.'
          : 'Settings → General → Visibility → set Wiki to Enabled.',
      };
    }
    if (!caps.checked) return { ok: true, warn: `Capabilities unchecked (${caps.reason}); assuming the wiki exists.` };

    // `has_wiki: true` means the FEATURE is enabled, not that the wiki repository exists. GitHub only creates
    // `<repo>.wiki.git` when the first page is saved in the UI, and pushing before that fails as
    // "Repository not found" — which reads as an auth or naming problem and is neither.
    if (!wikiRepoExists(host)) {
      return {
        ok: false,
        reason: `The wiki is enabled on ${caps.slug}, but its repository does not exist yet.`,
        hint: `GitHub creates it only when the first page is saved by hand: open ${host.web}/wiki → Create the first page → Save. Then re-run this. (Enabling the feature is not enough — the flag says on, the repo is not there.)`,
      };
    }
    return { ok: true };
  }

/** Definitive check that a wiki repository exists and is reachable with the caller's credentials. */
function wikiRepoExists(host) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', host.wikiGit, 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } });
    return true;
  } catch {
    return false;
  }
}

  if (target === 'pages') {
    if (caps.checked && caps.pages === false) {
      return {
        ok: true,                          // pushing the branch is exactly how you enable it, so this is a note
        warn: host.kind === 'github'
          ? 'Pages is not configured yet. Pushing the branch is harmless; enable it at Settings → Pages → Source: Deploy from a branch → gh-pages.'
          : 'GitLab Pages deploys from CI, not a branch. The staged site is still usable as a CI artifact.',
      };
    }
    if (!caps.checked) return { ok: true, warn: `Capabilities unchecked (${caps.reason}).` };
    return { ok: true };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ report */

export function formatCapabilities(host, caps, useColor) {
  const c = useColor
    ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s) => s });

  const L = [];
  L.push(c.bold(host.slug || '(no remote)') + c.dim(`  ${host.kind}`));
  if (host.url) L.push(c.dim(`  ${host.url}`));
  L.push('');

  if (!caps.checked) {
    L.push(c.yellow('  Capabilities not checked.') + ' ' + caps.reason);
    L.push(c.dim('  Publish targets will proceed on the assumption that the feature exists, and say so.'));
    return L.join('\n');
  }

  const mark = (v) => (v === true ? c.green('  on ') : v === false ? c.yellow(' off ') : c.dim('  — '));
  L.push(`  ${mark(caps.wiki)}  Wiki` + c.dim(caps.wiki ? `        ${host.wikiGit}` : '        publish --target wiki is unavailable'));
  L.push(`  ${mark(caps.pages)}  Pages` + c.dim(caps.pages && host.pagesUrl ? `       ${host.pagesUrl}` : '       not configured'));
  L.push(`  ${mark(caps.issues)}  Issues` + c.dim(caps.issues && host.issuesUrl ? `      ${host.issuesUrl}` : ''));
  L.push(`  ${mark(caps.discussions)}  Discussions` + c.dim(
    caps.discussions === null ? ' not applicable on this host'
      : caps.discussions ? ` ${host.discussionsUrl}` : ' off'));
  L.push('');
  L.push(c.dim(`  ${caps.visibility} · default branch ${caps.defaultBranch || 'unknown'}`));
  L.push(c.dim('  A dash means the host has no such feature, which is different from it being switched off.'));
  return L.join('\n');
}
