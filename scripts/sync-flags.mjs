// Vendors the flag SVGs this campaign needs from the MIT-licensed `flag-icons`
// package into public/flags/, so the built app has no runtime dependency on it.
// The historic flags flag-icons does not have (scripts/data/historic-flags.json)
// are built by `npm run build:historic-flags` and left as they are.
//
// Run after editing src/data/flags.js: `npm run sync-flags`.

import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FLAG_CODES } from '../src/data/flags.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3');
const target = path.join(root, 'public', 'flags');
const historic = new Set(JSON.parse(await readFile(path.join(root, 'scripts', 'data', 'historic-flags.json'), 'utf8')).flags.map(flag => flag.file));

try {
  await stat(source);
} catch {
  console.error('flag-icons is not installed — run `npm install` first.');
  process.exit(1);
}

await mkdir(target, { recursive: true });

const wanted = new Set(Object.values(FLAG_CODES));
let copied = 0;
let bytes = 0;
for (const code of wanted) {
  if (historic.has(code)) continue;
  const from = path.join(source, `${code}.svg`);
  await copyFile(from, path.join(target, `${code}.svg`));
  bytes += (await stat(from)).size;
  copied++;
}

for (const code of historic) {
  if (!wanted.has(code)) continue;
  try {
    await stat(path.join(target, `${code}.svg`));
  } catch {
    console.error(`public/flags/${code}.svg is missing: run npm run build:historic-flags`);
    process.exit(1);
  }
}

// Drop anything left behind by an earlier map (the historic flags' sources list is build-historic-flags.mjs's).
for (const file of await readdir(target)) {
  if (file !== 'SOURCES-historic.tsv' && !wanted.has(path.basename(file, '.svg'))) await rm(path.join(target, file));
}

console.log(`synced ${copied} flags into public/flags (${(bytes / 1024).toFixed(0)} KB)`);
