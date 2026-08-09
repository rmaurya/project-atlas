/**
 * llm-wiki · a small, dependency-free GitHub-flavoured markdown renderer.
 *
 * Supports the subset real engineering documentation uses: ATX headings with anchors, fenced code, GFM tables
 * with alignment, blockquotes (nested), ordered/unordered/task lists (nested), horizontal rules, and the usual
 * inline set. Anything it does not understand is escaped and shown verbatim rather than dropped — a renderer
 * that silently swallows content is worse than one that renders it plainly.
 *
 * Why no dependency: the tool must run in any repository with `node`, with no install step and no network.
 */

import { slugify } from './scan.mjs';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ inline */

export function inline(src, ctx = {}) {
  const codes = [];
  // Protect code spans first, so nothing below rewrites their contents.
  let s = String(src).replace(/(`+)([\s\S]*?)\1/g, (_, ticks, code) => {
    codes.push(`<code>${escapeHtml(code.trim())}</code>`);
    return `\uE000C${codes.length - 1}\uE000`;
  });

  s = escapeHtml(s);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
    (_, alt, src2) => `<img src="${src2}" alt="${alt}" loading="lazy">`);

  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text, href) => {
    const resolved = ctx.resolveLink ? ctx.resolveLink(href) : { href, cls: '' };
    const cls = resolved.cls ? ` class="${resolved.cls}"` : '';
    const ext = /^https?:/i.test(resolved.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${resolved.href}"${cls}${ext}>${text || resolved.href}</a>`;
  });

  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return s.replace(/\uE000C(\d+)\uE000/g, (_, i) => codes[Number(i)]);
}

/* ------------------------------------------------------------------ blocks */

const FENCE_RE = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

export function renderMarkdown(md, ctx = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const slugs = new Map();
  return blocks(lines, { ...ctx, slugs });
}

function blocks(lines, ctx) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || '';
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      const cls = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

    const h = HEADING_RE.exec(line);
    if (h) {
      const depth = h[1].length;
      const text = h[2];
      const base = slugify(text.replace(/[`*_~]/g, ''));
      const n = ctx.slugs.get(base) || 0;
      ctx.slugs.set(base, n + 1);
      const id = n ? `${base}-${n}` : base;
      out.push(`<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inline(text, ctx)}</h${depth}>`);
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && (QUOTE_RE.test(lines[i]) || (body.length && lines[i].trim() && !isBlockStart(lines[i])))) {
        const m = QUOTE_RE.exec(lines[i]);
        body.push(m ? m[1] : lines[i].trim());
        i++;
      }
      out.push(`<blockquote>${blocks(body, ctx)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const [html, next] = table(lines, i, ctx);
      out.push(html); i = next;
      continue;
    }

    if (LIST_RE.test(line)) {
      const [html, next] = list(lines, i, ctx);
      out.push(html); i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(`<p>${inline(para.join('\n'), ctx)}</p>`);
    else i++;                                   // defensive: never loop without consuming
  }

  return out.join('\n');
}

function isBlockStart(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) ||
         QUOTE_RE.test(line) || LIST_RE.test(line) || /^\s*\|/.test(line);
}

/* ------------------------------------------------------------------ tables */

function isTableStart(lines, i) {
  if (!/\|/.test(lines[i] || '')) return false;
  const sep = lines[i + 1] || '';
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep) && sep.includes('-') && sep.includes('|');
}

function table(lines, i, ctx) {
  const cells = (row) => {
    let r = row.trim();
    if (r.startsWith('|')) r = r.slice(1);
    if (r.endsWith('|')) r = r.slice(0, -1);
    const out = [];
    let cur = '';
    let tick = false;
    for (let k = 0; k < r.length; k++) {
      const c = r[k];
      if (c === '`') tick = !tick;
      if (c === '|' && !tick && r[k - 1] !== '\\') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((c) => c.replace(/\\\|/g, '|').trim());
  };

  const head = cells(lines[i]);
  const align = cells(lines[i + 1]).map((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
  let j = i + 2;
  const body = [];
  while (j < lines.length && lines[j].trim() && lines[j].includes('|')) body.push(cells(lines[j++]));

  const th = head.map((c, k) => `<th${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, ctx)}</th>`).join('');
  const rows = body.map((r) =>
    `<tr>${head.map((_, k) => `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(r[k] || '', ctx)}</td>`).join('')}</tr>`
  ).join('\n');

  return [`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`, j];
}

/* ------------------------------------------------------------------ lists */

function list(lines, start, ctx) {
  const baseIndent = LIST_RE.exec(lines[start])[1].length;
  const ordered = /^\d/.test(LIST_RE.exec(lines[start])[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m) {
      // A blank line may be internal to the list; anything else at column 0 ends it.
      if (!lines[i].trim() && LIST_RE.test(lines[i + 1] || '')) { i++; continue; }
      break;
    }
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {                              // nested list belongs to the previous item
      const [html, next] = list(lines, i, ctx);
      if (items.length) items[items.length - 1].children.push(html);
      i = next;
      continue;
    }
    if (/^\d/.test(m[2]) !== ordered) break;                // a different list type starts a new list

    const item = { text: m[3], children: [] };
    i++;
    // Continuation lines: indented, not a new item, not a new block.
    while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) &&
           lines[i].search(/\S/) > baseIndent && !isBlockStart(lines[i])) {
      item.text += '\n' + lines[i].trim();
      i++;
    }
    items.push(item);
  }

  const tag = ordered ? 'ol' : 'ul';
  const rendered = items.map((it) => {
    let text = it.text;
    let cls = '';
    const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);
    let prefix = '';
    if (task) {
      const checked = task[1].toLowerCase() === 'x';
      prefix = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
      text = task[2];
      cls = ' class="task"';
    }
    return `<li${cls}>${prefix}${inline(text, ctx)}${it.children.join('')}</li>`;
  }).join('\n');

  return [`<${tag}>\n${rendered}\n</${tag}>`, i];
}
