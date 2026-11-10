// Regional flags join nearby owned coasts without repeating a flag on every
// island or stretching a single canvas across distant overseas possessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM, flagRegionIndexSteps, makeCoastTree } from '../src/engine/flagRegions.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (id, ...rings) => ({ id, rings });
const ids = region => [...new Set(region.parts.map(p => p.countryId))].sort();
const area = r => r.reduce((sum, p, i) => {
  const q = r[(i + 1) % r.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

function bounds(rings) {
  const points = rings.flat();
  const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
  return { x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y };
}

// Independent SVG nonzero-winding oracle for land/band checks.
function inRings(rings, [x, y]) {
  let count = 0;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (a[1] <= y && b[1] > y && cross > 0) count++;
    if (a[1] > y && b[1] <= y && cross < 0) count--;
  }
  return count !== 0;
}
const inRegion = (region, point) => region.parts.some(p => inRings(p.rings, point));

function assertConserved(shapes, ownership, regions) {
  const expected = shapes.filter(s => ownership[s.id] !== undefined && ownership[s.id] !== null && ownership[s.id] !== '')
    .flatMap(s => s.rings.filter(r => r.length >= 3 && Math.abs(area(r)) > 1e-7)
      .map(r => `${ownership[s.id]}:${s.id}:${JSON.stringify(r)}`)).sort();
  const actual = regions.flatMap(c => c.parts.flatMap(p => p.rings.map(r => `${c.ownerId}:${p.countryId}:${JSON.stringify(r)}`))).sort();
  assert.deepEqual(actual, expected, 'grouping preserves every rendered ring exactly once with its current owner');
  assert.equal(new Set(regions.map(c => c.key)).size, regions.length);
  for (const region of regions) {
    assert.deepEqual(region.bbox, bounds(region.parts.flatMap(p => p.rings)), 'canvas bounds only its regional land');
    for (const part of region.parts) assert.equal(region.ownerId, String(ownership[part.countryId]));
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

test('nearby island chains share one regional canvas, while remote possessions stay separate', () => {
  const shapes = [shape('main', rect(0, 0, 50, 40)), shape('near', rect(65, 0, 50, 40)),
    shape('chain', rect(130, 0, 50, 40)), shape('remote', rect(400, 0, 50, 40))];
  const ownership = Object.fromEntries(shapes.map(s => [s.id, 'A']));
  const regions = createFlagRegionIndex(shapes, { maxGap: 15 }).components(ownership);
  assert.equal(regions.length, 2);
  const local = regions.find(c => ids(c).includes('main'));
  assert.deepEqual(ids(local), ['chain', 'main', 'near']);
  assert.deepEqual(local.bbox, { x: 0, y: 0, w: 180, h: 40 });
  assertConserved(shapes, ownership, regions);
});

test('regional links never transit a rival or unclaimed island', () => {
  const shapes = [shape('left', rect(0, 0, 50, 40)), shape('bridge', rect(65, 0, 50, 40)), shape('right', rect(130, 0, 50, 40))];
  const index = createFlagRegionIndex(shapes, { maxGap: 15 });
  for (const bridge of ['B', undefined]) {
    const ownership = { left: 'A', bridge, right: 'A' }, regions = index.components(ownership);
    assert.equal(regions.filter(r => r.ownerId === 'A').length, 2);
    assertConserved(shapes, ownership, regions);
  }
  const ownership = { left: 'A', bridge: 'A', right: 'A' };
  assert.equal(index.components(ownership).length, 1, 'conquest connects the same geographic chain');
});

test('coast distance, not overlapping bounding boxes, decides maritime proximity', () => {
  const u = [[0, 0], [200, 0], [200, 200], [160, 200], [160, 40], [40, 40], [40, 200], [0, 200]];
  const shapes = [shape('bay', u), shape('island', rect(85, 90, 30, 30))], ownership = { bay: 'A', island: 'A' };
  assert.equal(createFlagRegionIndex(shapes, { maxGap: 20 }).components(ownership).length, 2,
    'nested bounding boxes have zero bbox gap, but real coasts are 45 units apart');
  const linked = createFlagRegionIndex(shapes, { maxGap: 45 }).components(ownership);
  assert.equal(linked.length, 1);
  assertConserved(shapes, ownership, linked);
});

test('the maritime threshold is inclusive and zero gap retains land-border merging', () => {
  const shapes = [shape('a', rect(0, 0, 10, 10)), shape('b', rect(20, 0, 10, 10))], ownership = { a: 'A', b: 'A' };
  assert.equal(createFlagRegionIndex(shapes, { maxGap: 9.999 }).components(ownership).length, 2);
  assert.equal(createFlagRegionIndex(shapes, { maxGap: 10 }).components(ownership).length, 1);
  assert.equal(createFlagRegionIndex(shapes, { maxGap: 10.001 }).components(ownership).length, 1);
  assert.equal(createFlagRegionIndex([shape('a', rect(0, 0, 10, 10)), shape('b', rect(10, 0, 10, 10))], { maxGap: 0 })
    .components(ownership).length, 1);
  assert.equal(FLAG_REGION_GAP_KM, 180, 'the app and regression fixtures share the fixed geographical threshold');
});

test('nearby regional grouping preserves holes and every original country ring', () => {
  const hole = rect(40, 40, 40, 40).reverse();
  const shapes = [shape('host', rect(0, 0, 120, 120), hole), shape('island', rect(130, 30, 30, 30))];
  const ownership = { host: 'A', island: 'A' }, regions = createFlagRegionIndex(shapes, { maxGap: 10 }).components(ownership);
  assert.equal(regions.length, 1);
  assert.equal(inRegion(regions[0], [60, 60]), false, 'the flag must not fill an enclosed lake or foreign enclave');
  assert.equal(inRegion(regions[0], [10, 10]), true);
  assert.equal(inRegion(regions[0], [140, 40]), true);
  assertConserved(shapes, ownership, regions);
});

test('cached results are stable under ownership order, without mutating inputs', () => {
  const shapes = freezeDeep([shape('a', rect(0, 0, 40, 30)), shape('b', rect(50, 0, 40, 30)), shape('c', rect(400, 0, 30, 20))]);
  const ownership = freezeDeep({ a: 'A', b: 'A', c: 'C' }), snapshot = JSON.stringify({ shapes, ownership });
  const index = createFlagRegionIndex(shapes, { maxGap: 10 }), first = index.components(ownership);
  assert.strictEqual(index.components({ c: 'C', b: 'A', a: 'A' }), first);
  assert.strictEqual(index.components(ownership)[0], first[0]);
  assert.deepEqual(createFlagRegionIndex([...shapes].reverse(), { maxGap: 10 }).components(ownership), first);
  const untouched = first.find(c => c.ownerId === 'C');
  const after = index.components({ a: 'B', b: 'B', c: 'C' });
  assert.deepEqual(after.find(c => c.ownerId === 'C'), untouched);
  assert.ok(!after.some(c => c.ownerId === 'A'));
  assert.equal(JSON.stringify({ shapes, ownership }), snapshot);
});

test('a region a regrouping leaves unchanged keeps its object, so per-region caches carry over', () => {
  const shapes = [shape('a', rect(0, 0, 40, 30)), shape('b', rect(50, 0, 40, 30)), shape('c', rect(400, 0, 30, 20)),
    shape('d', rect(435, 0, 30, 20))];
  const index = createFlagRegionIndex(shapes, { maxGap: 10 }), fresh = createFlagRegionIndex(shapes, { maxGap: 10 });
  const first = index.components({ a: 'A', b: 'A', c: 'C', d: 'D' });
  const ownership = { a: 'A', b: 'A', c: 'C', d: 'C' }, next = index.components(ownership);
  assert.deepEqual(next, fresh.components(ownership), 'the same regions as a fresh index');
  assert.strictEqual(next.find(c => c.ownerId === 'A'), first.find(c => c.ownerId === 'A'), 'untouched region: same object');
  assert.notStrictEqual(next.find(c => c.ownerId === 'C'), first.find(c => c.ownerId === 'C'), 'a changed region is new');
  assertConserved(shapes, ownership, next);
});

test('refitting coordinates and scaling the geographic gap preserves regional membership', () => {
  const shapes = [shape('a', rect(0, 0, 40, 30)), shape('b', rect(55, 0, 40, 30)), shape('remote', rect(300, 0, 30, 20))];
  const ownership = { a: 'A', b: 'A', remote: 'A' }, scale = 3.25, dx = -37, dy = 61;
  const transformed = shapes.map(s => ({ ...s, rings: s.rings.map(r => r.map(([x, y]) => [x * scale + dx, y * scale + dy])) }));
  const before = createFlagRegionIndex(shapes, { maxGap: 16 }).components(ownership);
  const after = createFlagRegionIndex(transformed, { maxGap: 16 * scale }).components(ownership);
  assert.deepEqual(after.map(c => c.key), before.map(c => c.key));
  assert.deepEqual(after.map(ids), before.map(ids));
  for (let i = 0; i < before.length; i++) {
    const b = before[i].bbox, a = after[i].bbox;
    const expected = { x: b.x * scale + dx, y: b.y * scale + dy, w: b.w * scale, h: b.h * scale };
    for (const key of Object.keys(expected)) assert.ok(Math.abs(a[key] - expected[key]) < 1e-9);
  }
  assertConserved(transformed, ownership, after);
});

const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
const atlases = new Map();
function atlas(europe = false) {
  if (atlases.has(europe)) return atlases.get(europe);
  const theatre = europe
    ? [...Object.entries(NATIONS).filter(([, n]) => n[2] === 'UEFA').map(([id]) => id), '304']
    : Object.keys(NATIONS);
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(theatre);
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit, paths = display.buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (paths[c.id] || rules.paths[c.id]).labelRings }));
  const project = (lon, lat) => { const [x, y] = projPt(lon, lat); return [x * s + tx, y * s + ty]; };
  const result = { shapes, rules, project, maxGap: FLAG_REGION_GAP_KM / rules.kmPerUnit };
  atlases.set(europe, result);
  return result;
}

test('Swiss-held France, Italy, Corsica, Sardinia and Sicily share one regional flag; Guiana does not', () => {
  for (const europe of [true, false]) {
    const { shapes: allShapes, maxGap, project } = atlas(europe);
    const shapes = allShapes.filter(s => ['250', '756', '380'].includes(s.id));
    const ownership = Object.fromEntries(shapes.map(s => [s.id, '756']));
    const regions = createFlagRegionIndex(shapes, { maxGap }).components(ownership);
    const mainland = regions.find(c => inRegion(c, project(8.2, 46.8)));
    assert.ok(mainland, 'Swiss homeland remains part of the region');
    for (const [place, lon, lat] of [['France', 2, 46], ['Italy', 12.5, 43], ['Corsica', 9.1, 42.2], ['Sardinia', 9, 40], ['Sicily', 14, 37.6]]) {
      const region = regions.find(c => inRegion(c, project(lon, lat)));
      assert.ok(region, `${place} has rendered owned land`);
      assert.equal(region.key, mainland.key, `${place} must share the main Swiss flag, not repeat its cross`);
    }
    const guiana = regions.find(c => inRegion(c, project(-53.5, 4)));
    assert.ok(guiana);
    assert.notEqual(guiana.key, mainland.key, 'the Atlantic must not enlarge the European flag canvas');
    assert.ok(mainland.bbox.w < bounds(shapes.flatMap(s => s.rings)).w / 2);
    assertConserved(shapes, ownership, regions);
  }
});

test('German mainland and nearby Danish islands stay separate from Greenland and Iceland, retaining three bands', () => {
  const { shapes: allShapes, maxGap } = atlas(true);
  const shapes = allShapes.filter(s => ['112', '276', '208', '304', '352', '616'].includes(s.id));
  const ownership = Object.fromEntries(shapes.map(s => [s.id, '276']));
  const regions = createFlagRegionIndex(shapes, { maxGap }).components(ownership);
  assert.equal(regions.length, 3, 'three geographic regions: continental Europe, Greenland, and Iceland');
  const mainland = regions.find(c => ids(c).includes('276'));
  assert.deepEqual(ids(mainland), ['112', '208', '276', '616']);
  assert.ok(regions.some(c => ids(c).length === 1 && ids(c)[0] === '304'));
  assert.ok(regions.some(c => ids(c).length === 1 && ids(c)[0] === '352'));
  const count = [0, 0, 0], b = mainland.bbox, resolution = 100;
  for (let row = 0; row < resolution; row++) for (let col = 0; col < resolution; col++) {
    const p = [b.x + (col + .5) * b.w / resolution, b.y + (row + .5) * b.h / resolution];
    if (inRegion(mainland, p)) count[Math.floor(row / resolution * 3)]++;
  }
  const total = count.reduce((a, b) => a + b, 0);
  assert.ok(count.every(n => n > total * .025), `all flag bands cover substantial mainland: ${count}`);
  assertConserved(shapes, ownership, regions);
});

test('world regional graph construction is bounded and cached frames are inexpensive', t => {
  const { shapes, maxGap } = atlas(), start = performance.now();
  const index = createFlagRegionIndex(shapes, { maxGap });
  const nations = index.components(Object.fromEntries(shapes.map(s => [s.id, s.id])));
  assert.ok(nations.length >= shapes.length);
  const ownership = Object.fromEntries(shapes.map(s => [s.id, 'winner']));
  const champion = index.components(ownership);
  assert.ok(champion.length > 1, 'one world winner still has separate remote flag regions');
  const coldMs = performance.now() - start;
  assert.ok(coldMs < 3500, `building the world coast-link graph and two ownership states took ${coldMs.toFixed(0)} ms`);
  const warmAt = performance.now();
  for (let i = 0; i < 100; i++) assert.strictEqual(index.components(ownership), champion);
  const warmMs = performance.now() - warmAt;
  assert.ok(warmMs < 500, `100 cached frames took ${warmMs.toFixed(0)} ms`);
  t.diagnostic(`cold world region graph ${coldMs.toFixed(0)} ms; 100 cached frames ${warmMs.toFixed(0)} ms`);
});

test('built in steps (the Flags warm-up), the world index gives the regions of one built in one go', t => {
  const { shapes, maxGap } = atlas();
  const steps = flagRegionIndexSteps(shapes, { maxGap });
  const times = [];
  let index;
  for (let at = performance.now(); ;) {
    const { done, value } = steps.next();
    const now = performance.now();
    times.push(now - at);
    at = now;
    if (done) { index = value; break; }
  }
  assert.ok(times.length > 40, `${times.length} steps`);
  const whole = createFlagRegionIndex(shapes, { maxGap });
  const ringIds = new Map(shapes.flatMap(s => s.rings).map((ring, i) => [ring, i]));
  const signature = regions => JSON.stringify(regions, (key, value) => key === 'rings' ? value.map(ring => ringIds.get(ring)) : value);
  const native = Object.fromEntries(shapes.map(s => [s.id, s.id]));
  for (const ownership of [native, { ...native, 250: '276', 208: '276', 380: '276' }, Object.fromEntries(shapes.map(s => [s.id, 'one']))]) {
    assert.ok(signature(index.components(ownership)) === signature(whole.components(ownership)), 'the same regions, keys, bounds and parts');
  }
  t.diagnostic(`${times.length} steps, the largest ${Math.max(...times).toFixed(1)} of ${times.reduce((a, b) => a + b, 0).toFixed(0)} ms`);
});

// ---- The coast tree (makeCoastTree) against other trees of the same coasts ----
// The median-split tree it replaced, frozen here as the reference, and one leaf holding every edge, with which the
// index compares all pairs of edges. Any tree of boxes over the same edges must give the same links, so the same regions.
function edgeBounds(bounds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bounds) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function edgesOf(parts) {
  const edges = [];
  for (const part of parts) for (const ring of part.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      edges.push({ a, b, bbox: { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) } });
    }
  }
  return edges;
}
function makeEdgeTree(edges) {
  if (!edges.length) return null;
  const bbox = edgeBounds(edges.map(edge => edge.bbox));
  if (edges.length <= 8) return { bbox, count: edges.length, edges };
  const axis = bbox.w >= bbox.h ? 'x' : 'y';
  const span = axis === 'x' ? 'w' : 'h';
  edges.sort((a, b) => a.bbox[axis] + a.bbox[span] / 2 - b.bbox[axis] - b.bbox[span] / 2);
  const middle = Math.floor(edges.length / 2);
  return { bbox, count: edges.length, left: makeEdgeTree(edges.slice(0, middle)), right: makeEdgeTree(edges.slice(middle)) };
}
const medianSplitTree = parts => makeEdgeTree(edgesOf(parts));
function allPairsTree(parts) {
  const edges = edgesOf(parts);
  return edges.length ? { bbox: edgeBounds(edges.map(edge => edge.bbox)), count: edges.length, edges } : null;
}

// An island with `n` edges along each side and a lake, so its coast tree has several levels and leaves of two rings.
function island(x, y, w, h, n = 12, round = v => v) {
  const outer = [];
  for (let i = 0; i < n; i++) outer.push([x + w * i / n, y]);
  for (let i = 0; i < n; i++) outer.push([x + w, y + h * i / n]);
  for (let i = 0; i < n; i++) outer.push([x + w - w * i / n, y + h]);
  for (let i = 0; i < n; i++) outer.push([x, y + h - h * i / n]);
  outer.push(outer[0]);
  return [outer, rect(x + w / 4, y + h / 4, w / 2, h / 2).reverse()].map(ring => ring.map(([px, py]) => [round(px), round(py)]));
}

test('the coast tree cuts each ring into leaves of up to eight edges and pairs them up, every box exact', () => {
  assert.equal(makeCoastTree([]), null, 'no edges, no tree');
  assert.equal(makeCoastTree([{ countryId: 'a', rings: [[[1, 1], [1, 1], [1, 1]]] }]), null, 'zero-length edges are skipped');
  const { shapes } = atlas();
  const fixtures = [[{ countryId: 'a', rings: island(0, 0, 40, 30, 16) }], [{ countryId: 'b', rings: [rect(0, 0, 1, 1)] }],
    ...['360', '643'].map(id => [{ countryId: id, rings: shapes.find(s => s.id === id).rings }])];
  for (const parts of fixtures) {
    const ringOf = new Map();
    parts.forEach(part => part.rings.forEach((ring, r) => ring.forEach(point => ringOf.set(point, `${part.countryId}#${r}`))));
    const walk = node => {
      let edges;
      if (node.edges) {
        assert.ok(node.edges.length >= 1 && node.edges.length <= 8 && !node.left && !node.right, 'a leaf holds one to eight edges');
        assert.equal(new Set(node.edges.flatMap(edge => [ringOf.get(edge.a), ringOf.get(edge.b)])).size, 1, 'a leaf never spans two rings');
        edges = node.edges;
      } else {
        assert.ok(node.left && node.right, 'every inner node has two children');
        edges = [...walk(node.left), ...walk(node.right)];
      }
      assert.equal(node.count, edges.length);
      assert.deepEqual(node.bbox, edgeBounds(edges.map(edge => edge.bbox)), 'a box is exactly its own edges’ box, at every level');
      return edges;
    };
    const edges = walk(makeCoastTree(parts)), expected = edgesOf(parts);
    assert.equal(edges.length, expected.length);
    assert.ok(edges.every((edge, i) => edge.a === expected[i].a && edge.b === expected[i].b), 'every coast edge once, in ring order');
  }
});

test('islands at, just inside and just beyond the gap link exactly as an all-pairs search and the old tree say', () => {
  const tenth = v => Number(v.toFixed(1)); // the label rings' rounding
  const scenarios = [];
  // Whole map units, gap 5: the big island's east coast is at x = 40, its north coast at y = 30.
  const big = island(0, 0, 40, 30, 16);
  for (const [dx, dy, linked] of [[4, null, true], [5, null, true], [6, null, false],
    [3, 4, true], [4, 3, true], [3, 3, true], [4, 4, false], [0, 5, true], [0, 6, false]]) {
    // A side by side island across a strait of dx, or one off the north-east corner, dx east and dy north of it.
    const small = dy === null ? island(40 + dx, 5, 20, 20, 8) : island(40 + dx, 30 + dy, 20, 20, 8);
    scenarios.push([`whole units, ${dy === null ? `strait ${dx}` : `corner ${dx},${dy}`}`, big, small, 5, linked]);
  }
  // A cape whose point faces the middle of an edge of the big island's east coast (its vertices are 1.875 apart).
  for (const [x, linked] of [[44, true], [45, true], [46, false]]) {
    scenarios.push([`whole units, cape at ${x}`, big, [[[x, 16], [x + 15, 6], [x + 15, 26], [x, 16]]], 5, linked]);
  }
  // Tenths, as the map's label rings are rounded, gap 0.5: the east coast is at x = 14.4, the north coast at y = 24.
  const tenths = island(10.3, 20.7, 4.1, 3.3, 16, tenth);
  for (const [dx, dy, linked] of [[0.4, null, true], [0.5, null, true], [0.6, null, false],
    [0.3, 0.4, true], [0.3, 0.3, true], [0.4, 0.4, false]]) {
    const small = dy === null ? island(tenth(14.4 + dx), 21.2, 2.3, 1.9, 8, tenth) : island(tenth(14.4 + dx), tenth(24 + dy), 2.3, 1.9, 8, tenth);
    scenarios.push([`tenths, ${dy === null ? `strait ${dx}` : `corner ${dx},${dy}`}`, tenths, small, 0.5, linked]);
  }
  // An islet inside a bay: their boxes overlap, so only the coasts deep in each tree can tell 45 units from 44.
  const subdivided = (ring, n, round) => ring.slice(1).flatMap((b, i) => Array.from({ length: n }, (_, k) => {
    const a = ring[i];
    return [round(a[0] + (b[0] - a[0]) * k / n), round(a[1] + (b[1] - a[1]) * k / n)];
  })).concat([ring[0].map(round)]);
  for (const [scale, shift, round] of [[1, 0, v => v], [0.1, 0.3, tenth]]) {
    const at = ([x, y]) => [x * scale + shift, y * scale + shift];
    const bay = subdivided([[0, 0], [200, 0], [200, 200], [160, 200], [160, 40], [40, 40], [40, 200], [0, 200], [0, 0]].map(at), 6, round);
    const islet = subdivided(rect(85, 90, 30, 30).map(at), 4, round);
    for (const [gap, linked] of [[44, false], [45, true], [46, true]]) {
      scenarios.push([`${scale === 1 ? 'whole units' : 'tenths'}, islet in a bay, gap ${gap * scale}`, [bay], [islet], gap * scale, linked]);
    }
  }
  for (const [label, first, second, gap, linked] of scenarios) {
    const shapes = [shape('a', ...first), shape('b', ...second)], ownership = { a: 'A', b: 'A' };
    const links = coastTree => createFlagRegionIndex(shapes, { maxGap: gap, coastTree }).components(ownership).length === 1;
    assert.equal(links(allPairsTree), linked, `${label}: all pairs of edges`);
    assert.equal(links(undefined), linked, `${label}: the coast tree`);
    assert.equal(links(medianSplitTree), linked, `${label}: the median-split tree`);
  }
});

test('the coast tree gives the regions of the median-split tree it replaced, on the world and a country map', async () => {
  const { decodeDomestic } = await import('../src/engine/domestic.js');
  const indonesia = decodeDomestic(load('domestic/360.json'), '360');
  const { shapes: world, maxGap } = atlas();
  const fits = [['world', world, maxGap, Object.fromEntries(world.filter(s => NATIONS[s.id]).map(s => [s.id, s.id]))],
    ['Indonesia', indonesia.geo.countries.map(c => ({ id: c.id, rings: indonesia.geo.paths[c.id].labelRings })),
      FLAG_REGION_GAP_KM / indonesia.geo.kmPerUnit, indonesia.startOwners]];
  for (const [name, shapes, gap, start] of fits) {
    // Native, kick-off, one owner, then a seeded run of whole empires falling to each other.
    const boards = [['native', Object.fromEntries(shapes.map(s => [s.id, s.id]))], ['kick-off', start],
      ['one owner', Object.fromEntries(shapes.map(s => [s.id, 'winner']))]];
    const board = { ...start };
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let match = 1; match <= 60; match++) {
      const owners = [...new Set(Object.values(board))];
      const winner = owners[Math.floor(random() * owners.length)], loser = owners[Math.floor(random() * owners.length)];
      for (const [id, owner] of Object.entries(board)) if (owner === loser) board[id] = winner;
      if (match % 12 === 0) boards.push([`after ${match} matches`, { ...board }]);
    }
    // Rings by their index: both indexes hand back the input rings themselves, so equal regions name the same rings.
    const ringIds = new Map(shapes.flatMap(s => s.rings).map((ring, i) => [ring, i]));
    const signature = regions => JSON.stringify(regions, (key, value) => key === 'rings' ? value.map(ring => ringIds.get(ring) ?? ring) : value);
    const current = createFlagRegionIndex(shapes, { maxGap: gap });
    const legacy = createFlagRegionIndex(shapes, { maxGap: gap, coastTree: medianSplitTree });
    for (const [label, ownership] of boards) {
      const regions = current.components(ownership);
      assert.ok(regions.length > 0);
      assert.ok(signature(regions) === signature(legacy.components(ownership)), `${name}, ${label}: the same regions, keys, bounds and parts`);
    }
  }
});
