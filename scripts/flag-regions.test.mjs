// Regional flags join nearby owned coasts without repeating a flag on every
// island or stretching a single canvas across distant overseas possessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
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
