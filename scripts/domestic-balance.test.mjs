// Balanced territories (scripts/lib/domestic-partition.mjs balanceSections; docs/design/domestic-campaigns.md,
// "Balanced land") on a synthetic grid of square units near the equator, about 1.1 km a side.
import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceSections, prepareUnits, unitTopology } from './lib/domestic-partition.mjs';

const STEP = 0.01;

/** A w × h grid of squares (outer rings anticlockwise), plus any extra squares at grid cells [x, y]. */
function grid(w, h, extra = []) {
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  cells.push(...extra);
  return prepareUnits(cells.map(([x, y], i) => {
    const [x0, y0, x1, y1] = [x * STEP, y * STEP, (x + 1) * STEP, (y + 1) * STEP];
    return { id: String(i), name: `cell ${x},${y}`, polys: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]] };
  }));
}

const home = (units, w, x, y) => ({ unit: y * w + x, point: [(x + 0.5) * STEP, (y + 0.5) * STEP] });

const landOf = (units, owner, n) => {
  const land = new Array(n).fill(0);
  owner.forEach((c, u) => { land[c] += units[u].area; });
  return land;
};

/** Each club's units form one piece through shared borders. */
function connected(owner, adjacency, seedUnit) {
  return seedUnit.every((start, c) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) for (const v of adjacency[stack.pop()]) if (owner[v] === c && !seen.has(v)) { seen.add(v); stack.push(v); }
    return owner.every((o, u) => o !== c || seen.has(u));
  });
}

test('clubs crowded into one corner gain land from a lone club, and every territory stays whole around its start', () => {
  const w = 24, h = 24;
  const units = grid(w, h);
  const { adjacency, topo } = unitTopology(units);
  // Three clubs within a few km of each other in one corner, one alone in the far corner.
  const homes = [home(units, w, 1, 1), home(units, w, 4, 1), home(units, w, 1, 4), home(units, w, 20, 20)];
  const out = balanceSections(units, adjacency, homes, { beta: 0.3, topo });
  assert.equal(out.owner.length, units.length);
  assert.ok(out.owner.every(c => c >= 0 && c < homes.length), 'every unit has a club');
  homes.forEach((h, c) => assert.equal(out.owner[h.unit], c, `club ${c} holds its start`));
  assert.ok(connected(out.owner, adjacency, out.seedUnit), 'a territory came apart');
  const land = landOf(units, out.owner, homes.length);
  const ratio = list => Math.max(...list) / Math.min(...list);
  assert.ok(out.moves > 0, 'no land passed');
  assert.ok(ratio(land) < ratio(out.natural), `sizes grew less even: ${ratio(out.natural).toFixed(1)} -> ${ratio(land).toFixed(1)}`);
  assert.ok(land[3] < out.natural[3], 'the lone club kept all its natural land');
  assert.ok(out.spread[1] < out.spread[0], 'land did not move towards the targets');
});

test('balanced land is deterministic', () => {
  const w = 16, h = 12;
  const units = grid(w, h);
  const { adjacency, topo } = unitTopology(units);
  const homes = [home(units, w, 2, 2), home(units, w, 3, 2), home(units, w, 13, 9), home(units, w, 8, 6)];
  const a = balanceSections(units, adjacency, homes, { beta: 0.3, topo });
  const b = balanceSections(units, adjacency, homes, { beta: 0.3, topo });
  assert.deepEqual(a.owner, b.owner);
});

test('a landmass without a start joins the club whose start is nearest among those with land near it', () => {
  const w = 12, h = 6;
  // An island two cells off the grid's right edge, level with its upper rows.
  const units = grid(w, h, [[w + 2, 4]]);
  const { adjacency, topo } = unitTopology(units);
  const island = units.length - 1;
  assert.equal(adjacency[island].length, 0, 'the island touches the grid');
  const homes = [home(units, w, 1, 1), home(units, w, 10, 4)];
  const out = balanceSections(units, adjacency, homes, { beta: 0.3, topo });
  assert.equal(out.owner[island], 1);
});

test('with beta 1 the targets are the natural land, so nothing passes', () => {
  const w = 10, h = 10;
  const units = grid(w, h);
  const { adjacency, topo } = unitTopology(units);
  const homes = [home(units, w, 1, 1), home(units, w, 8, 8)];
  const out = balanceSections(units, adjacency, homes, { beta: 1, topo });
  assert.equal(out.moves, 0);
  assert.deepEqual(landOf(units, out.owner, 2), out.natural);
});
