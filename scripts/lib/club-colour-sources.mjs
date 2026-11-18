// What scripts/build-club-colours.mjs reads the club colours from, and the digest of it that src/data/clubColours.js
// records. scripts/club-colours.test.mjs and the build's --check compare that digest with the files as they are, so a
// colour table left behind by its crests shows without a pixel read (the crests' pixels, read by sharp, could differ
// in the last bit from one platform to another; their bytes cannot).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clubLogoFile } from '../../src/data/clubLogos.js';
import { CREST_ERAS } from '../../src/data/clubCrestEras.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LOGO_DIR = path.join(root, 'public/club-logos');
const OVERRIDES_FILE = path.join(root, 'scripts/data/club-colours.json');
const EUROLEAGUE_FILE = path.join(root, 'scripts/data/euroleague-teams.json');
const PERIOD_CREST = /\.\d{4}\.webp$/;

/**
 * What the colours are read from:
 * - `crests`: today's crests, by file name without '.webp'. A period crest ('<club id>.<year>.webp') is no club's
 *   colour of today.
 * - `pastIds`: the EuroLeague's clubs of the earlier seasons (scripts/data/euroleague-teams.json `history` and `eras`).
 * - `past`: [club id, crest file] for each of those with no crest today: the crest of its day (src/data/clubCrestEras.js)
 *   it wears in the most seasons, the latest on a tie.
 * - `corrections`: [club id, the crest file or club id it colours, colour as written] from scripts/data/club-colours.json.
 */
export async function colourSources() {
  const crests = (await readdir(LOGO_DIR)).filter(name => name.endsWith('.webp') && !PERIOD_CREST.test(name)).sort()
    .map(name => name.slice(0, -'.webp'.length));
  const euroleague = JSON.parse(await readFile(EUROLEAGUE_FILE, 'utf8'));
  const pastIds = [...new Set([...Object.values(euroleague.history ?? {}), ...Object.values(euroleague.eras ?? {}).flat()]
    .map(club => club.id))].sort();
  const past = [];
  for (const id of pastIds) {
    if (clubLogoFile(id)) continue;
    const worn = (CREST_ERAS[id] ?? []).filter(([, , file]) => file);
    if (!worn.length) continue;
    const [, , file] = worn.reduce((best, era) => (era[1] - era[0] >= best[1] - best[0] ? era : best));
    past.push([id, file]);
  }
  const { colours } = JSON.parse(await readFile(OVERRIDES_FILE, 'utf8'));
  const corrections = Object.entries(colours).map(([id, colour]) => [id, clubLogoFile(id) ?? id, colour]);
  return { crests, pastIds, past, corrections };
}

/**
 * The digest src/data/clubColours.js records: each crest read, by name and bytes (today's, then the past clubs'), and
 * each correction with the key it colours. `sources` defaults to `colourSources()`.
 */
export async function sourcesDigest(sources) {
  const { crests, past, corrections } = sources ?? await colourSources();
  const hash = createHash('sha256');
  const crest = async (label, file) => {
    const bytes = await readFile(path.join(LOGO_DIR, `${file}.webp`));
    hash.update(`${label} ${bytes.length}\n`);
    hash.update(bytes);
  };
  for (const file of crests) await crest(`crest ${file}`, file);
  for (const [id, file] of past) await crest(`past ${id} ${file}`, file);
  for (const [id, target, colour] of corrections) hash.update(`correction ${id} ${target} ${colour}\n`);
  return hash.digest('hex');
}

/** The digest a generated src/data/clubColours.js records, or undefined. */
export const recordedDigest = text => /^\/\/ sources sha256 ([0-9a-f]{64})$/m.exec(text)?.[1];
