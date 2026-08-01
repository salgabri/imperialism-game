// Vendors the flag SVGs this campaign needs from the MIT-licensed `flag-icons`
// package into public/flags/, so the built app has no runtime dependency on it.
//
// Run after editing src/data/flags.js: `npm run sync-flags`.

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FLAG_CODES } from '../src/data/flags.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3');
const target = path.join(root, 'public', 'flags');

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
  const from = path.join(source, `${code}.svg`);
  await copyFile(from, path.join(target, `${code}.svg`));
  bytes += (await stat(from)).size;
  copied++;
}

// Drop anything left behind by an earlier map.
for (const file of await readdir(target)) {
  if (!wanted.has(path.basename(file, '.svg'))) await rm(path.join(target, file));
}

console.log(`synced ${copied} flags into public/flags (${(bytes / 1024).toFixed(0)} KB)`);
