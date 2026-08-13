#!/usr/bin/env node
/**
 * project-atlas · regenerate the command cheatsheet (A-52)
 *
 *   node scripts/gen-cheatsheet.mjs            write docs/assets/cheatsheet.svg and .pdf
 *   node scripts/gen-cheatsheet.mjs --check    exit 1 if either is not what regenerating would write
 *
 * One command, and running it twice with no source change writes byte-identical files. Everything it prints
 * is derived — see `scripts/lib/cheatsheet.mjs` for where each part of the card is read from.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderAssets, writeAssets, SVG_PATH, PDF_PATH } from './lib/cheatsheet.mjs';
import fs from 'node:fs';

function repoRoot() {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const top = execFileSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    return top || here;
  } catch { return here; }
}

const root = repoRoot();
const check = process.argv.includes('--check');

if (check) {
  const { svg, pdf } = renderAssets(root);
  const stale = [];
  for (const [rel, bytes] of [[SVG_PATH, svg], [PDF_PATH, pdf]]) {
    const file = path.join(root, rel);
    const on = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!on) stale.push(`${rel} — missing`);
    else if (!on.equals(bytes)) stale.push(`${rel} — ${on.length} bytes on disk, ${bytes.length} regenerated`);
  }
  if (stale.length) {
    console.error('cheatsheet assets are stale:');
    for (const s of stale) console.error(`  ${s}`);
    console.error('\nrun: node scripts/gen-cheatsheet.mjs');
    process.exit(1);
  }
  console.log('cheatsheet · both assets match the command surface');
} else {
  const { changed, model, bytes } = writeAssets(root);
  const rows = model.groups.reduce((a, g) => a + g.rows.length, 0);
  console.log(`cheatsheet · ${rows} commands in ${model.groups.length} groups`);
  for (const rel of [SVG_PATH, PDF_PATH]) {
    console.log(`  ${changed.includes(rel) ? 'wrote    ' : 'unchanged'} ${rel}  ${bytes[rel]} bytes`);
  }
}
