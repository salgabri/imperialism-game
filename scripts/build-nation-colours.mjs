// Each nation's colour on the political map: one that fits the nation and stands apart from its neighbours'.
//
// Usage:
//   node scripts/build-nation-colours.mjs [--check]
//     --check  exit 1 when src/data/nationColours.js is not what this script would write
//
// Every nation has a few fitting colours: its own (NATIONS, the colour it plays in) and the colours of its flag
// (public/flags/<code>.svg, read at 120x90; a colour covering under 5% of the flag is left out). Each colour can be
// shifted NUDGE degrees of hue either way (a red becomes a rose or a coral) and drawn in one of three lightness steps
// (theme.js empireFill). A choice costs:
//   - its fit: 0 for the nation's own colour, FLAG for its flag's main colour, up to FLAG + MINOR for a minor one,
//     GREY more for a white or black one (it draws grey, which says little about the nation); NUDGE_COST for a
//     shifted hue; OFF_STEP off the middle lightness step.
//   - each neighbour it is too close to: weight × (CLOSE − distance) / CLOSE. The distance is OKLab with lightness
//     counted at L_WEIGHT (two pastels of one hue read as one colour however light), the smaller of the light and the
//     dark theme's. Neighbours share a land border (weight 1) or face each other across less than SEA_GAP of sea
//     (weight SEA_WEIGHT: the Channel, the Øresund).
// The largest nations choose first; then each nation in turn takes its cheapest choice given its neighbours',
// a nation counting only YIELD of a clash with a smaller neighbour (the smaller one makes room),
// until no nation changes (iterated conditional modes; deterministic).
//
// Writes:
//   src/data/nationColours.js   NATION_COLOURS: nation id → [colour, lightness step]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { NATIONS, DEPENDENCIES } from '../src/data/teams.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { WorldGeometry, closestPair } from '../src/engine/geo.js';
import { empireFill, themedPaint } from '../src/theme.js';
import { colourDistance, oklchHex, rgbToOklab, toOklch } from '../src/engine/colour.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const moduleFile = path.join(root, 'src/data/nationColours.js');
const check = process.argv.includes('--check');

const FLAG = 0.35, MINOR = 0.2, GREY = 0.45, NUDGE = 18, NUDGE_COST = 0.15, OFF_STEP = 0.02;
const L_WEIGHT = 0.4;
const CLOSE = 0.065;    // fills nearer than this read as one colour across a border
const SEA_GAP = 0.03;   // radians of the world chart, about 190 km
const SEA_WEIGHT = 0.3;
const YIELD = 0.25;
const CLASH = 2;        // the cost of two neighbours in one colour
const MIN_SHARE = 0.05; // of the flag's area
const SAME = 0.08;      // flag pixels this close (OKLab) are one colour
const GREY_CHROMA = 0.04;

const hex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lab = colour => {
  const [L, C, H] = toOklch(colour);
  return [L * L_WEIGHT, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
};
const isGrey = colour => toOklch(colour)[1] < GREY_CHROMA;

/** A flag's colours, largest first: [{ colour, share }]. */
async function flagColours(code) {
  const data = await sharp(path.join(root, 'public/flags', `${code}.svg`), { density: 96 })
    .resize(120, 90, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const clusters = [];
  for (let i = 0; i < data.length; i += 3) {
    const point = rgbToOklab(data[i], data[i + 1], data[i + 2]);
    let near = null, best = SAME;
    for (const cluster of clusters) {
      const d = Math.hypot(...point.map((v, k) => v - cluster.lab[k] / cluster.n));
      if (d < best) { best = d; near = cluster; }
    }
    if (!near) clusters.push(near = { n: 0, lab: [0, 0, 0], rgb: [0, 0, 0] });
    near.n++;
    for (let k = 0; k < 3; k++) { near.lab[k] += point[k]; near.rgb[k] += data[i + k]; }
  }
  const total = data.length / 3;
  return clusters.filter(cluster => cluster.n / total >= MIN_SHARE).sort((a, b) => b.n - a.n)
    .map(cluster => ({ colour: hex(cluster.rgb.map(v => v / cluster.n)), share: cluster.n / total }));
}

/** A nation's fitting colours with their cost: its own, then its flag's (without repeats). */
async function fittingColours(id) {
  const own = NATIONS[id][5];
  const out = [{ colour: own.toLowerCase(), cost: isGrey(own) ? GREY : 0 }];
  const code = FLAG_CODES[id];
  const flag = code ? await flagColours(code) : [];
  const top = Math.max(0, ...flag.filter(f => !isGrey(f.colour)).map(f => f.share));
  for (const { colour, share } of flag) {
    if (out.some(c => colourDistance(c.colour, colour) < SAME * 2)) continue;
    const grey = isGrey(colour);
    if (grey && out.some(c => isGrey(c.colour))) continue;
    out.push({ colour, cost: FLAG + (grey ? GREY : MINOR * (1 - share / top)) });
  }
  // The same colours a little cooler and warmer.
  for (const { colour, cost } of out.slice()) {
    if (isGrey(colour)) continue;
    const [L, C, H] = toOklch(colour);
    for (const turn of [-NUDGE, NUDGE]) out.push({ colour: oklchHex(L, C, (H + turn + 360) % 360), cost: cost + NUDGE_COST });
  }
  return out;
}

// ---- Who neighbours whom ----
const geo = new WorldGeometry(JSON.parse(await readFile(path.join(root, 'public/world-110m.v1.json'), 'utf8')));
const ids = Object.keys(NATIONS).sort();
const ownerOf = shape => (NATIONS[shape] ? shape : DEPENDENCIES[shape]?.of ?? null);
const neighbours = new Map(ids.map(id => [id, new Map()]));
const link = (a, b, weight) => {
  if (!a || !b || a === b) return;
  if ((neighbours.get(a).get(b) ?? 0) >= weight) return;
  neighbours.get(a).set(b, weight);
  neighbours.get(b).set(a, weight);
};
for (const [shape, adjacent] of Object.entries(geo.adj)) for (const other of adjacent) link(ownerOf(shape), ownerOf(other), 1);
const shapes = geo.countries.map(c => c.id).filter(ownerOf);
const points = Object.fromEntries(shapes.map(id => [id, geo.projected[id].flat(2)]));
const boxes = Object.fromEntries(shapes.map(id => {
  const xs = points[id].map(p => p[0]), ys = points[id].map(p => p[1]);
  return [id, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
}));
for (let i = 0; i < shapes.length; i++) {
  for (let j = i + 1; j < shapes.length; j++) {
    const [a, b] = [boxes[shapes[i]], boxes[shapes[j]]];
    if (a[0] - SEA_GAP > b[2] || b[0] - SEA_GAP > a[2] || a[1] - SEA_GAP > b[3] || b[1] - SEA_GAP > a[3]) continue;
    if (closestPair(points[shapes[i]], points[shapes[j]]).dist < SEA_GAP) link(ownerOf(shapes[i]), ownerOf(shapes[j]), SEA_WEIGHT);
  }
}

// ---- Choices ----
const choices = new Map();
for (const id of ids) {
  const list = [];
  for (const { colour, cost } of await fittingColours(id)) {
    for (const step of [0, 1, 2]) {
      const light = empireFill(id, colour, step);
      const dark = /^light-dark\(#[0-9a-f]{6}, (#[0-9a-f]{6})\)$/.exec(themedPaint(light))?.[1] ?? light;
      if (list.some(c => c.light === light)) continue;
      list.push({ colour, step, light: lab(light), dark: lab(dark), lightHex: light, cost: cost + (step === 1 ? 0 : OFF_STEP) });
    }
  }
  choices.set(id, list);
}
const distance = (p, q) => Math.min(Math.hypot(...p.light.map((v, k) => v - q.light[k])), Math.hypot(...p.dark.map((v, k) => v - q.dark[k])));
const clash = (p, q) => CLASH * Math.max(0, CLOSE - distance(p, q)) / CLOSE;

// ---- Solve ----
// The largest nations choose first, so they keep their own colour and smaller neighbours make room.
const ringArea = ring => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0)) / 2;
const area = id => shapes.filter(shape => ownerOf(shape) === id)
  .reduce((sum, shape) => sum + geo.projected[shape].reduce((s, poly) => s + ringArea(poly[0]), 0), 0);
const areas = new Map(ids.map(id => [id, area(id)]));
const order = [...ids].sort((a, b) => areas.get(b) - areas.get(a) || a.localeCompare(b));
const pick = new Map();
// The smaller of two clashing neighbours bears the clash; the larger only YIELD of it.
const localCost = (id, choice) => choice.cost + [...neighbours.get(id)].reduce((sum, [other, weight]) => {
  if (!pick.has(other)) return sum;
  return sum + weight * (areas.get(id) > areas.get(other) ? YIELD : 1) * clash(choice, pick.get(other));
}, 0);
for (const id of order) pick.set(id, choices.get(id).reduce((a, b) => (localCost(id, b) < localCost(id, a) - 1e-9 ? b : a)));
for (let sweep = 0, changed = true; changed && sweep < 100; sweep++) {
  changed = false;
  for (const id of order) {
    let best = pick.get(id), bestCost = localCost(id, best);
    for (const choice of choices.get(id)) {
      const cost = localCost(id, choice);
      if (cost < bestCost - 1e-9) { best = choice; bestCost = cost; }
    }
    if (best !== pick.get(id)) { pick.set(id, best); changed = true; }
  }
}

// ---- Module ----
const rows = ids.map(id => `  '${id}': ['${pick.get(id).colour}', ${pick.get(id).step}], // ${NATIONS[id][0]}`);
const text = `// GENERATED by scripts/build-nation-colours.mjs; do not edit. Run \`npm run build:nation-colours\` to refresh.
//
// Each nation's colour on the political map and its lightness step (theme.js empireFill): its own colour or one of
// its flag's, chosen so that neighbouring nations stand apart.

/** Nation id → [colour, lightness step 0–2]. */
export const NATION_COLOURS = Object.freeze({
${rows.join('\n')}
});
`;
if (check) {
  const current = await readFile(moduleFile, 'utf8').catch(() => '');
  if (current !== text) {
    console.error(`${path.relative(root, moduleFile)} is stale: run npm run build:nation-colours`);
    process.exit(1);
  }
  console.log(`${path.relative(root, moduleFile)} is current`);
} else {
  await writeFile(moduleFile, text);
  const off = ids.filter(id => pick.get(id).colour !== NATIONS[id][5].toLowerCase());
  const close = [];
  for (const id of ids) {
    for (const [other, weight] of neighbours.get(id)) {
      if (id < other && weight === 1 && distance(pick.get(id), pick.get(other)) < CLOSE / 2) close.push(`${NATIONS[id][0]}–${NATIONS[other][0]}`);
    }
  }
  console.log(`${ids.length} nations; ${off.length} take a flag colour: ${off.map(id => NATIONS[id][0]).join(', ')}`);
  console.log(`${close.length} land neighbours still alike: ${close.join(', ') || 'none'}`);
}
