// Each club's own colour, for the political map: read from its crest in public/club-logos/
// (scripts/sync-club-logos.mjs), then corrected by scripts/data/club-colours.json where the
// crest misleads (gold trim, a crown or a city badge outweighing the kit colour).
//
// Usage:
//   node scripts/build-club-colours.mjs
//
// A crest's colour is the dominant hue among its coloured pixels: OKLCH hue in 15° bins,
// each bin counting half of its two neighbours, gold (often trim) counted at 60%. The
// colour is the mean of the winning bin's pixels. A crest with almost no coloured pixels
// is white or black, and its colour is the grey of its mean lightness.
//
// Writes:
//   src/data/clubColours.js   clubColour(id): a club's colour, or null
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as BASKETBALL_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { clubLogoFile } from '../src/data/clubLogos.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const logoDir = path.join(root, 'public/club-logos');
const moduleFile = path.join(root, 'src/data/clubColours.js');
const overridesFile = path.join(root, 'scripts/data/club-colours.json');

const SAMPLE = 64; // crests are read at this size: plenty for a colour census
const OPAQUE = 160; // alpha below this is the crest's transparent surround or its anti-aliased edge
const CHROMA = 0.06; // OKLCH chroma below this is white, black or grey
const MIN_COLOURED = 0.08; // a crest with fewer coloured pixels than this is white or black
const GOLD = [65, 105], GOLD_WEIGHT = 0.6;
const DOMESTIC_ID = /^d([0-9A-Za-z]+)-(\d+)$/;

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab(r, g, b) {
  [r, g, b] = [r, g, b].map(c => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const hex = rgb => rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** A crest's colour, 'rrggbb'. */
async function crestColour(file) {
  const data = await sharp(file).resize(SAMPLE, SAMPLE, { fit: 'inside' }).ensureAlpha().raw().toBuffer();
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, n: 0, rgb: [0, 0, 0] }));
  let opaque = 0, coloured = 0, lightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE) continue;
    opaque++;
    const [L, a, b] = oklab(data[i], data[i + 1], data[i + 2]);
    lightness += L;
    if (Math.hypot(a, b) < CHROMA) continue;
    coloured++;
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    const bin = bins[Math.floor(hue / 15) % 24];
    bin.weight += hue >= GOLD[0] && hue < GOLD[1] ? GOLD_WEIGHT : 1;
    bin.n++;
    for (let k = 0; k < 3; k++) bin.rgb[k] += data[i + k];
  }
  if (!opaque) return null;
  if (coloured / opaque < MIN_COLOURED) {
    // The grey whose OKLab lightness is the crest's mean (an achromatic L is the cube root of linear luminance).
    const grey = (Math.max(0, Math.min(1, lightness / opaque)) ** 3);
    const srgb = grey <= 0.0031308 ? 12.92 * grey : 1.055 * grey ** (1 / 2.4) - 0.055;
    return hex([srgb * 255, srgb * 255, srgb * 255]);
  }
  const score = i => bins[i].weight + 0.5 * (bins[(i + 23) % 24].weight + bins[(i + 1) % 24].weight);
  let best = 0;
  for (let i = 1; i < 24; i++) if (score(i) > score(best)) best = i;
  const bin = bins[best];
  return hex(bin.rgb.map(v => v / bin.n));
}

// ---- Crests ----
const files = (await readdir(logoDir)).filter(name => name.endsWith('.webp')).sort();
const colours = new Map();
for (const name of files) {
  const colour = await crestColour(path.join(logoDir, name));
  if (colour) colours.set(name.slice(0, -'.webp'.length), colour);
}

// ---- Corrections ----
const { colours: overrides } = JSON.parse(await readFile(overridesFile, 'utf8'));
const knownIds = new Set([...FOOTBALL_CLUBS, ...BASKETBALL_CLUBS, ...NFL_CLUBS].map(club => club.id));
for (const [id, colour] of Object.entries(overrides)) {
  if (!knownIds.has(id) && !DOMESTIC_ID.test(id)) throw new Error(`club-colours.json: no club ${id}`);
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error(`club-colours.json: ${id} needs a #rrggbb colour, not ${colour}`);
  colours.set(clubLogoFile(id) ?? id, colour.slice(1).toLowerCase());
}

// ---- Module ----
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const other = {}, perNation = {};
for (const key of [...colours.keys()].sort(byId)) {
  const match = DOMESTIC_ID.exec(key);
  if (match) (perNation[match[1]] ||= []).push(`${match[2]}:${colours.get(key)}`);
  else other[key] = colours.get(key);
}
const nationLines = Object.keys(perNation).sort(byId).map(nation => `  '${nation}': '${perNation[nation].join(' ')}',`);
await writeFile(moduleFile, `// GENERATED by scripts/build-club-colours.mjs; do not edit. Run \`npm run build:club-colours\` to refresh.
//
// Each club's own colour: the dominant colour of its crest (public/club-logos/), corrected by
// scripts/data/club-colours.json. A white or black crest gives a grey. Clubs with neither have none.
import { clubLogoFile } from './clubLogos.js';

// Clubs outside the domestic layers, by crest file or club id: 'rrggbb'.
const OTHER = JSON.parse('${JSON.stringify(other)}');
// Domestic clubs ('d<nation>-<FM club id>') by nation: '<FM club id>:<rrggbb>'.
const DOMESTIC = {
${nationLines.join('\n')}
};
const domestic = new Map();
const DOMESTIC_ID = /^d([0-9A-Za-z]+)-(\\d+)$/;

function colourAt(key) {
  const match = DOMESTIC_ID.exec(key ?? '');
  if (!match) return key && Object.hasOwn(OTHER, key) ? OTHER[key] : null;
  if (!DOMESTIC[match[1]]) return null;
  if (!domestic.has(match[1])) {
    domestic.set(match[1], new Map(DOMESTIC[match[1]].split(' ').map(pair => pair.split(':'))));
  }
  return domestic.get(match[1]).get(match[2]) ?? null;
}

/** A club's colour ('#rrggbb'): its crest's (or a correction's), else null. */
export function clubColour(id) {
  const colour = colourAt(clubLogoFile(id)) ?? colourAt(id);
  return colour ? \`#\${colour}\` : null;
}
`);

const grey = [...colours.values()].filter(colour => colour.slice(0, 2) === colour.slice(2, 4) && colour.slice(2, 4) === colour.slice(4)).length;
console.log(`${colours.size} club colours (${files.length} crests, ${Object.keys(overrides).length} corrections, ${grey} grey) → ${path.relative(root, moduleFile)}`);
