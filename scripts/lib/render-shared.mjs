/**
 * Shared between the site renderer and the dashboard. `flatName` lives here rather than in render.mjs
 * because dashboard.mjs needs it to link to document pages, and importing render.mjs from dashboard.mjs
 * would be circular — render.mjs already imports dashboard.mjs.
 */

import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);

/**
 * A repository path is a filename here, and a filename is interpolated into `href` on five pages. Two things
 * went wrong at once, and both are fixed by restricting the character set rather than by escaping harder.
 *
 * **It was an injection sink.** The link *text* was escaped; the `href` was not, and the old mapping stripped
 * only `/` and `\`. A file committed as `z"><img src=x onerror=alert(document.domain)>".md` terminated the
 * attribute and put a live payload into `wiki.html` and `health.html` — from nothing but a filename, in a
 * repository whose whole purpose is to publish other people's markdown.
 *
 * **It was not injective.** `docs/a/b.md` and `docs/a__b.md` both produced `docs__a__b.html`; the second write
 * won, and the reported page count came from the index, so it could never notice. Restricting a segment to
 * characters that exclude `_` makes the `/` → `__` mapping reversible, and anything outside that set is
 * disambiguated by a hash of the original path. `pageNames` below is the belt to this pair of braces.
 *
 * The surviving set is also the intersection that is legal on Windows, so a document named with a `:` or a `?`
 * no longer produces a site that cannot be checked out there.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9.-]+$/;

export function flatName(p) {
  const stem = String(p).replace(/\.md$/i, '');
  const segments = stem.split(/[/\\]/);
  if (segments.length && segments.every((s) => SAFE_SEGMENT.test(s))) return segments.join('__') + '.html';
  const safe = segments.map((s) => s.replace(/[^A-Za-z0-9.-]/g, '-')).join('__');
  return `${safe}-${sha(stem)}.html`;
}

/**
 * Every document's page filename, with any collision resolved and reported — the same treatment
 * `buildWikiPages` already gives wiki page names, for the same reason: a name that two documents share means
 * one of them is silently overwritten, and a count taken from the index can never see it happen.
 *
 * Deterministic: sorted input, and the disambiguating suffix is a hash of the path, so a rebuild with no
 * source change still produces a byte-identical site.
 */
export function pageNames(paths) {
  const nameOf = new Map();
  const used = new Map();
  const collisions = [];
  for (const p of [...paths].sort()) {
    let name = flatName(p);
    if (used.has(name)) {
      const alt = name.replace(/\.html$/, `-${sha(p)}.html`);
      collisions.push({ name, kept: used.get(name), renamed: p, to: alt });
      name = alt;
    }
    used.set(name, p);
    nameOf.set(p, name);
  }
  return { nameOf, collisions };
}

/**
 * JSON on its way into a `<script>` element. **Use this instead of `JSON.stringify` for anything embedded in
 * a page**, never the bare call.
 *
 * `JSON.stringify` does not escape `<`, so a document whose body contains the literal text `</script>` closes
 * the script element early and everything after it is parsed as markup. That is not theoretical here: the
 * search index carries the first 6,000 characters of every indexed document, and `exportSingleFile` inlines
 * that file into a `<script>` tag. Verified with a fixture containing
 * `</script><script>window.__PWNED=1</script>` — the export came out with a live second script tag, and the
 * standalone export is the artifact that gets published.
 *
 * `<`, `>` and `&` can only occur inside string literals in `JSON.stringify` output, so escaping every one of
 * them to `\uXXXX` is lossless: the result is still valid JSON and still parses with `JSON.parse`. U+2028 and
 * U+2029 are legal inside a JSON string but were illegal line terminators in a JavaScript string literal
 * before ES2019, which is a different way for the same data to break the same script tag.
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
