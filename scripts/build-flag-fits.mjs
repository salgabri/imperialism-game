// How each flag in public/flags fits its land on the map (src/engine/flagFit.js, docs/design/flag-fit.md): which way
// its artwork may stretch, and the colours along its four edges, which carry the flag on over land beyond it. Read from
// the flags' own pixels, rendered by sharp, and written to src/data/flagFits.js with a digest of the sources.
//   node scripts/build-flag-fits.mjs           writes src/data/flagFits.js
//   node scripts/build-flag-fits.mjs --check   fails unless it was written from the flags as they are (no render;
//                                              scripts/flag-fit.test.mjs checks the same in npm test)
// A flag is one of:
// - rows: every row one colour (horizontal stripes): stretching it sideways changes nothing.
// - cols: every column one colour (vertical stripes): stretching it up or down changes nothing.
// - grid: straight-edged blocks only (a Nordic cross, Greece): it may stretch a little.
// - free: anything else (an emblem, a star, a diagonal): it keeps its shape.
// - plain: one colour.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const flagsDir = path.join(root, 'public', 'flags');
const destination = path.join(root, 'src', 'data', 'flagFits.js');

// The flags' canvas (flag-icons' 4:3, which the historic flags are redrawn on).
const W = 640, H = 480;
// Kinds are read at half size (anti-aliasing then blurs no straight edge across more than a pixel), edges at twice
// size from the vector flags (half a unit a pixel) and at their own 640 x 480 from the historic flags drawn as pictures.
const KIND_SCALE = 0.5;
// The largest channel difference that is still one colour: vector flags render exactly, pictures (WebP) carry noise.
const TOLERANCE = { vector: 24, picture: 48 };
// A straight edge between two blocks, as it renders: at most this many pixels of blend at KIND_SCALE.
const EDGE_BLEND = 2;
// At most this many straight edges each way still make a grid (Mongolia's or Kiribati's art has more: free).
const GRID_EDGES = 14;
// Colour runs on an edge shorter than this (units) are a blend between two runs, not a colour of the flag.
const MIN_RUN = 1.5;

/** The flags in public/flags, by file name. */
export const flagSources = async () => (await readdir(flagsDir)).filter(name => name.endsWith('.svg')).sort();
const normalised = text => text.replace(/\r\n/g, '\n');

/** The digest the generated file records: every flag's name and contents (LF line endings). */
export async function sourcesDigest(names) {
  const hash = createHash('sha256');
  for (const name of names) hash.update(`${name}\n${normalised(await readFile(path.join(flagsDir, name), 'utf8'))}\n`);
  return hash.digest('hex');
}

/** The digest a generated src/data/flagFits.js records, or undefined. */
export const recordedDigest = text => /^\/\/ sources sha256 ([0-9a-f]{64})$/m.exec(text)?.[1];

async function render(name, scale) {
  const { default: sharp } = await import('sharp');
  const text = await readFile(path.join(flagsDir, name), 'utf8');
  assert.match(text, /viewBox="0 0 640 480"/, `${name}: a 640 x 480 flag`);
  // A historic flag drawn as a picture is one <image> holding a 640 x 480 WebP: read the picture itself.
  const picture = /<image\b[^>]*\bhref="data:image\/[a-z]+;base64,([^"]+)"/.exec(text);
  const source = picture ? sharp(Buffer.from(picture[1], 'base64')) : sharp(Buffer.from(text), { density: 72 * scale });
  const width = Math.round(W * scale), height = Math.round(H * scale);
  const { data, info } = await source.resize(width, height, { fit: 'fill', kernel: 'nearest' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width, name);
  assert.equal(info.height, height, name);
  return { data, width, height, picture: !!picture };
}

const pixelOf = ({ data, width }) => (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
const differ = (a, b, tolerance) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3])) > tolerance;

/** The flag's kind, from its pixels at KIND_SCALE. */
function kindOf(image, tolerance) {
  const { width, height } = image, px = pixelOf(image);
  const uniform = (count, at) => {
    for (let i = 0; i < count; i++) {
      const line = at(i);
      for (let j = 1; j < line.length; j++) if (differ(line[j], line[0], tolerance)) return false;
    }
    return true;
  };
  const rowsOf = y => Array.from({ length: width }, (_, x) => px(x, y));
  const colsOf = x => Array.from({ length: height }, (_, y) => px(x, y));
  const rows = uniform(height, rowsOf), cols = uniform(width, colsOf);
  if (rows && cols) return 'plain';
  if (rows) return 'rows';
  if (cols) return 'cols';
  // A grid: a few straight edges each way, each a thin blend, and one colour in every block between them.
  const xs = new Set(), ys = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x + 1 < width; x++) if (differ(px(x, y), px(x + 1, y), tolerance)) xs.add(x);
  for (let x = 0; x < width; x++) for (let y = 0; y + 1 < height; y++) if (differ(px(x, y), px(x, y + 1), tolerance)) ys.add(y);
  const edges = set => {
    const out = [];
    for (const at of [...set].sort((a, b) => a - b)) {
      if (out.length && at - out[out.length - 1][1] <= EDGE_BLEND) out[out.length - 1][1] = at;
      else out.push([at, at]);
    }
    return out;
  };
  const ex = edges(xs), ey = edges(ys);
  if (ex.length > GRID_EDGES || ey.length > GRID_EDGES || [...ex, ...ey].some(([from, to]) => to - from > EDGE_BLEND)) return 'free';
  const spans = (cuts, size) => {
    const out = [];
    let start = 0;
    for (const [from, to] of cuts) { out.push([start, from]); start = to + 1; }
    out.push([start, size]);
    return out.filter(([from, to]) => to > from);
  };
  for (const [x0, x1] of spans(ex, width)) for (const [y0, y1] of spans(ey, height)) {
    const first = px(x0, y0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (differ(px(x, y), first, tolerance)) return 'free';
  }
  return 'grid';
}

const hex = ([r, g, b, a]) => (a < 128 ? '-' : [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  .replace(/^(.)\1(.)\2(.)\3$/, '$1$2$3'));

/**
 * An edge's colour runs: `[[start, colour]]`, start in source units (halves), colour a hex code or '-' (see-through).
 * `samples` are the pixels along the edge, `unit` pixels a unit. Each run's colour is its commonest pixel; runs too
 * short to be a stripe (a blend between two) join the neighbour nearer their colour.
 */
function runsOf(samples, unit, tolerance) {
  const runs = [];
  for (let i = 0; i < samples.length; i++) {
    const last = runs[runs.length - 1];
    if (last && !differ(samples[i], samples[i - 1], tolerance)) last.end = i + 1;
    else runs.push({ start: i, end: i + 1 });
  }
  const colour = run => {
    const counts = new Map();
    for (let i = run.start; i < run.end; i++) { const key = hex(samples[i]); counts.set(key, (counts.get(key) || 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  };
  const distance = (a, b) => {
    if (a === '-' || b === '-') return a === b ? 0 : 1e9;
    const rgb = code => (code.length === 3 ? code.split('').map(c => c + c) : code.match(/../g)).map(v => parseInt(v, 16));
    const [p, q] = [rgb(a), rgb(b)];
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  };
  for (;;) {
    runs.forEach(run => { run.colour = colour(run); });
    const short = runs.findIndex(run => (run.end - run.start) / unit < MIN_RUN);
    if (short < 0 || runs.length === 1) break;
    const run = runs[short], left = runs[short - 1], right = runs[short + 1];
    const into = !left ? right : !right ? left : distance(left.colour, run.colour) <= distance(right.colour, run.colour) ? left : right;
    into.start = Math.min(into.start, run.start); into.end = Math.max(into.end, run.end);
    runs.splice(short, 1);
  }
  // Neighbours of one colour are one run.
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.colour === run.colour) last.end = run.end;
    else merged.push(run);
  }
  return merged.map(run => [Math.round(run.start / unit * 2) / 2, run.colour]);
}

/** A flag's edges, read one pixel in from its outline (anti-aliasing leaves the outermost pixels part see-through). */
function edgesOf(image, unit, tolerance) {
  const { width, height } = image, px = pixelOf(image);
  const column = x => Array.from({ length: height }, (_, y) => px(x, y));
  const row = y => Array.from({ length: width }, (_, x) => px(x, y));
  return { left: runsOf(column(1), unit, tolerance), right: runsOf(column(width - 2), unit, tolerance),
    top: runsOf(row(1), unit, tolerance), bottom: runsOf(row(height - 2), unit, tolerance) };
}

/**
 * How deep each side of a flag is only its edge drawn out (whole units, rounded down, less one to spare): within
 * `left` units of its left edge every row is one colour, its edge pixel's, and so on. A free flag may grow past its
 * land by that much on that side (src/engine/flagFit.js): what it loses there is stripe, never an emblem or a canton.
 */
function marginsOf(image, unit, tolerance) {
  const { width, height } = image, px = pixelOf(image);
  const depth = (lines, length, at) => {
    let least = length;
    for (let line = 0; line < lines && least > 1; line++) {
      const edge = at(line, 1);
      let run = 1;
      while (run < least && !differ(at(line, run), edge, tolerance)) run++;
      least = Math.min(least, run);
    }
    return Math.max(0, Math.floor(least / unit) - 1);
  };
  return {
    left: depth(height, width, (y, i) => px(i, y)), right: depth(height, width, (y, i) => px(width - 1 - i, y)),
    top: depth(width, height, (x, i) => px(x, i)), bottom: depth(width, height, (x, i) => px(x, height - 1 - i)),
  };
}

const encodeRuns = runs => runs.map(([start, colour], i) => (i ? `${start}:${colour}` : colour)).join(' ');
const KIND_CODES = { plain: 'p', rows: 'r', cols: 'c', grid: 'g', free: 'f' };

async function fitOf(name) {
  const kindImage = await render(name, KIND_SCALE);
  const tolerance = TOLERANCE[kindImage.picture ? 'picture' : 'vector'];
  const kind = kindOf(kindImage, tolerance);
  const scale = kindImage.picture ? 1 : 2;
  const image = await render(name, scale);
  const edges = edgesOf(image, scale, tolerance);
  // A free flag's margins follow its kind: f<left>,<right>,<top>,<bottom>.
  const margins = kind === 'free' ? Object.values(marginsOf(image, scale, tolerance)).join(',') : '';
  // Only the edges the fit can extend: a row flag spans its region's width, a column flag its height, a plain one both.
  const kept = { plain: [], rows: ['top', 'bottom'], cols: ['left', 'right'] }[kind] || ['left', 'right', 'top', 'bottom'];
  return [KIND_CODES[kind] + margins, ...['left', 'right', 'top', 'bottom'].map(side => (kept.includes(side) ? encodeRuns(edges[side]) : ''))]
    .join('|').replace(/\|+$/, '');
}

function moduleText(digest, fits) {
  const lines = Object.entries(fits).map(([code, fit]) => `  ${/^[a-z]+$/.test(code) ? code : `'${code}'`}: '${fit}',`);
  return `// Generated by scripts/build-flag-fits.mjs from public/flags: do not edit (npm run build:flag-fits).
// sources sha256 ${digest}
// How each flag fits its land (src/engine/flagFit.js): its kind, then the colour runs along its left, right, top and
// bottom edges, each "colour start:colour ...", starts in the flag's 640 x 480 units, '-' see-through. Kinds: r rows
// (horizontal stripes), c columns (vertical stripes), g grid (straight-edged blocks), f free (keeps its shape),
// p plain. A free flag's kind is followed by how many units deep its left, right, top and bottom sides are only their
// edge drawn out. A row flag keeps only its top and bottom edges, a column flag its left and right, a plain one none.
export const FLAG_FITS = {
${lines.join('\n')}
};
`;
}

async function main(check) {
  const names = await flagSources();
  const digest = await sourcesDigest(names);
  if (check) {
    const current = await readFile(destination, 'utf8').catch(() => '');
    const codes = [...current.matchAll(/^ {2}'?([a-z0-9-]+)'?: '/gm)].map(match => match[1]);
    const expected = names.map(name => name.replace(/\.svg$/, ''));
    assert.equal(recordedDigest(current), digest, 'public/flags changed since src/data/flagFits.js was written: run npm run build:flag-fits');
    assert.deepEqual(codes, expected, 'src/data/flagFits.js lists other flags than public/flags: run npm run build:flag-fits');
    console.log(`src/data/flagFits.js matches the ${names.length} flags in public/flags`);
    return;
  }
  const fits = {};
  for (const name of names) fits[name.replace(/\.svg$/, '')] = await fitOf(name);
  await writeFile(destination, moduleText(digest, fits));
  const counts = Object.values(fits).reduce((all, fit) => ({ ...all, [fit[0]]: (all[fit[0]] || 0) + 1 }), {});
  console.log(`Wrote src/data/flagFits.js: ${names.length} flags (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')})`);
}

// Run as a script; imported (scripts/flag-fit.test.mjs), it only lends its digest.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv.slice(2).every(argument => argument === '--check'), 'Only --check is supported');
  await main(process.argv.includes('--check'));
}
