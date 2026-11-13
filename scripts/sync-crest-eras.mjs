// Period crests (docs/design/period-marks.md): the crest a club wore in the seasons whose crest was not today's.
//
// Usage: node scripts/sync-crest-eras.mjs [--check]
//
// Reads scripts/data/crest-eras.json: `crests`, each period crest by its file key ('<club id>.<first year>') with its
// source (a Wikipedia or Commons file, or an archived copy of one on the Wayback Machine), licence and the SHA-256 of
// the original, cached under the gitignored data-src/crest-eras/files/; and `clubs`, each club id's eras
// [first year, last year, file key | today's file of another id | null], in the season years the game uses.
// No network: the originals come from the cache, where the research put them (data-src/crest-eras/BRIEF.md).
//
// Writes:
//   public/club-logos/<key>.webp         each period crest, trimmed and fitting 128x128, as scripts/sync-club-logos.mjs
//                                         draws today's crests
//   public/club-logos/SOURCES-eras.tsv   each period crest's club, years, source file, licence and page
//   src/data/clubCrestEras.js            CREST_ERAS for src/data/crests.js
// --check rebuilds all three in memory and fails on any difference (and on a cached original whose hash moved).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(argument => argument === '--check'), 'Only --check is supported');
const outDir = path.join(root, 'public/club-logos');
const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/crest-eras.json'), 'utf8'));
const BOX = 128; // as scripts/sync-club-logos.mjs: twice the largest mark the game draws
const KEY = /^[a-z0-9-]+\.\d{4}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** A crest as the game draws them: trimmed, fitting 128x128, WebP (an SVG drawn large enough first). */
async function crestWebp(bytes, isSvg) {
  let input = bytes;
  if (isSvg) {
    const { width = 100, height = 100 } = await sharp(bytes).metadata();
    const density = Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.max(1, Math.min(width, height)))));
    input = await sharp(bytes, { density }).png().toBuffer();
  }
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 8 }).toBuffer().catch(() => input);
  return sharp(trimmed).resize(BOX, BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toBuffer();
}

// ---- validate ----
const crests = manifest.crests || {};
const clubs = manifest.clubs || {};
for (const [key, crest] of Object.entries(crests)) {
  assert.match(key, KEY, `${key}: a period crest is '<club id>.<first year>'`);
  for (const field of ['club', 'years', 'kind', 'title', 'page', 'licence', 'sha256', 'cache']) assert(crest[field], `${key}: no ${field}`);
  assert(['wikipedia', 'commons', 'wayback'].includes(crest.kind), `${key}: kind ${crest.kind}`);
  // A capture's timestamp, or the start of one (the Wayback Machine answers with the capture nearest it), and the flag
  // that serves the archived bytes as they were (`id_`, or `im_` for an image).
  if (crest.kind === 'wayback') assert.match(crest.wayback || '', /^https:\/\/web\.archive\.org\/web\/\d{4,14}(id|im)_\//, `${key}: a Wayback crest names its capture`);
  else assert.match(crest.download || '', /^https:\/\/upload\.wikimedia\.org\//, `${key}: a Wikimedia crest names its original file`);
}
const todays = new Set((await readdir(outDir)).filter(name => name.endsWith('.webp') && !/\.\d{4}\.webp$/.test(name)).map(name => name.slice(0, -5)));
const used = new Set();
for (const [id, eras] of Object.entries(clubs)) {
  assert(Array.isArray(eras) && eras.length, `${id}: no eras`);
  let last = -Infinity;
  for (const era of eras) {
    assert(Array.isArray(era) && era.length === 3, `${id}: an era is [first, last, file]`);
    const [from, through, file] = era;
    assert(Number.isInteger(from) && Number.isInteger(through) && from <= through && from > last, `${id}: eras ${JSON.stringify(eras)} are not in order`);
    last = through;
    if (file === null) continue;
    assert(Object.hasOwn(crests, file) || todays.has(file), `${id}: ${file} is neither a period crest nor a crest of today`);
    if (Object.hasOwn(crests, file)) used.add(file);
  }
}
for (const key of Object.keys(crests)) assert(used.has(key), `${key}: no club wears it`);

// ---- build ----
const outputs = new Map();
for (const key of Object.keys(crests).sort(byId)) {
  const crest = crests[key];
  const cache = path.join(root, crest.cache);
  assert(existsSync(cache), `${key}: the cached original ${crest.cache} is missing (data-src/crest-eras is the research cache)`);
  const bytes = await readFile(cache);
  assert.equal(sha256(bytes), crest.sha256, `${key}: ${crest.cache} is not the pinned original`);
  const isSvg = /\.svg$/i.test(crest.cache) || bytes.subarray(0, 512).toString('utf8').includes('<svg');
  outputs.set(path.join(outDir, `${key}.webp`), await crestWebp(bytes, isSvg));
}

const tsv = [
  '# Period crests in this folder (<club id>.<first year>.webp): GENERATED by scripts/sync-crest-eras.mjs from',
  '# scripts/data/crest-eras.json. Each is the crest a club wore in seasons before today\'s, from English or another',
  '# Wikipedia, Wikimedia Commons, or the Wayback Machine\'s copy of a Wikipedia file. Crests are the clubs\' trademarks;',
  '# each row names the file, its licence as its file page records it, and that page.',
  ['image', 'club', 'years', 'file', 'licence', 'source'].join('\t'),
  ...Object.keys(crests).sort(byId).map(key => {
    const crest = crests[key];
    return [`${key}.webp`, crest.club, crest.years, crest.title.replace(/^File:/, ''), crest.licence.replace(/\s+/g, ' '),
      crest.kind === 'wayback' ? crest.wayback : crest.page].join('\t');
  }),
];
outputs.set(path.join(outDir, 'SOURCES-eras.tsv'), Buffer.from(tsv.join('\n') + '\n'));

const lines = Object.keys(clubs).sort(byId).map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(clubs[id])},`);
const module = `// GENERATED by scripts/sync-crest-eras.mjs from scripts/data/crest-eras.json; do not edit. Run \`npm run sync:crest-eras\`.
//
// Club id → the seasons whose crest is not today's: [first year, last year, crest file or null] (src/data/crests.js).
export const CREST_ERAS = Object.freeze({${lines.length ? `\n${lines.join('\n')}\n` : ''}});
`;
outputs.set(path.join(root, 'src/data/clubCrestEras.js'), Buffer.from(module));

let changed = 0;
for (const [file, bytes] of outputs) {
  // Text compares with LF line endings (git may check it out with CRLF); a crest byte for byte.
  const current = existsSync(file) ? await readFile(file) : null;
  const equal = current && (file.endsWith('.webp') ? current.equals(bytes) : current.toString('utf8').replace(/\r\n/g, '\n') === bytes.toString('utf8'));
  if (equal) continue;
  if (check) assert.fail(`${path.relative(root, file)}: generated output differs`);
  await writeFile(file, bytes);
  changed++;
}
// Period crests no club wears any more go.
const keep = new Set(Object.keys(crests).map(key => `${key}.webp`));
for (const name of await readdir(outDir)) {
  if (/\.\d{4}\.webp$/.test(name) && !keep.has(name)) {
    if (check) assert.fail(`public/club-logos/${name}: no club wears it`);
    await rm(path.join(outDir, name));
  }
}
console.log(`${check ? 'Verified' : 'Wrote'} ${Object.keys(crests).length} period crests for ${Object.keys(clubs).length} clubs${check ? '' : ` (${changed} files changed)`}.`);
