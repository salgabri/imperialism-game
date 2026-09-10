// Geometry-only regressions: a flag belongs to a connected owned landmass,
// never to an individual conquered country or an ocean-spanning owner bbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createTerritoryComponentIndex } from '../src/engine/empireLabels.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (id, ...rings) => ({ id, rings });
const area = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const countryIds = component => [...new Set(component.parts.map(part => part.countryId))].sort();
const ringSignature = ring => JSON.stringify(ring);

function bounds(rings) {
  const points = rings.flat();
  const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
  return { x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y };
}

// Independent nonzero-winding oracle, rather than production containment.
function inRings(rings, [x, y]) {
  let winding = 0;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (a[1] <= y && b[1] > y && cross > 0) winding++;
    if (a[1] > y && b[1] <= y && cross < 0) winding--;
  }
  return winding !== 0;
}
const inComponent = (component, point) => component.parts.some(part => inRings(part.rings, point));

function assertConserved(shapes, ownership, components) {
  const expected = shapes.filter(s => ownership[s.id] !== undefined && ownership[s.id] !== null && ownership[s.id] !== '')
    .flatMap(s => s.rings.filter(r => r.length >= 3 && Math.abs(area(r)) > 1e-7)
      .map(r => `${ownership[s.id]}:${s.id}:${ringSignature(r)}`)).sort();
  const actual = components.flatMap(c => c.parts.flatMap(p => p.rings.map(r => `${c.ownerId}:${p.countryId}:${ringSignature(r)}`))).sort();
  assert.deepEqual(actual, expected, 'every rendered nondegenerate ring occurs once, with its current owner');
  assert.equal(new Set(components.map(c => c.key)).size, components.length, 'component keys are unique');
  for (const component of components) {
    const exact = bounds(component.parts.flatMap(p => p.rings));
    assert.deepEqual(component.bbox, exact, 'component canvas fits its own rings exactly');
    assert.ok(component.bbox.w > 0 && component.bbox.h > 0);
    for (const part of component.parts) assert.equal(String(ownership[part.countryId]), component.ownerId);
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

test('adjacent conquered nations share one flag canvas across the old border', () => {
  const shapes = [shape('a', rect(0, 0, 100, 60)), shape('b', rect(100, 0, 100, 60)), shape('c', rect(200, 0, 100, 60))];
  const index = createTerritoryComponentIndex(shapes);
  assert.equal(index.components({ a: 'A', b: 'B', c: 'C' }).length, 3);
  const ownership = { a: 'A', b: 'A', c: 'C' }, components = index.components(ownership);
  assert.equal(components.length, 2);
  const winner = components.find(c => c.ownerId === 'A');
  assert.deepEqual(countryIds(winner), ['a', 'b']);
  assert.deepEqual(winner.bbox, { x: 0, y: 0, w: 200, h: 60 });
  assertConserved(shapes, ownership, components);
});

test('detached possessions of the same owner have separate local flag canvases', () => {
  const shapes = [shape('mainland', rect(0, 0, 120, 100)), shape('colony', rect(800, 350, 40, 30))];
  const ownership = { mainland: 'A', colony: 'A' };
  const components = createTerritoryComponentIndex(shapes).components(ownership);
  assert.equal(components.length, 2);
  assert.ok(components.every(c => c.ownerId === 'A' && c.bbox.w <= 120));
  assertConserved(shapes, ownership, components);
});

test('holes remain attached to their mainland and preserve nonzero winding', () => {
  const outer = rect(0, 0, 200, 160), hole = rect(60, 40, 80, 80).reverse();
  const shapes = [shape('host', outer, hole), shape('enclave', [...hole].reverse())];
  const index = createTerritoryComponentIndex(shapes);
  const ownership = { host: 'A', enclave: 'B' }, before = index.components(ownership);
  const host = before.find(c => c.ownerId === 'A');
  assert.equal(host.parts.length, 1);
  assert.equal(host.parts[0].rings.length, 2, 'the hole must not become an independent flag');
  assert.equal(inComponent(host, [20, 20]), true);
  assert.equal(inComponent(host, [100, 80]), false);
  assertConserved(shapes, ownership, before);
  const conquered = { host: 'A', enclave: 'A' }, after = index.components(conquered);
  assert.equal(after.length, 1, 'conquering the touching enclave makes a connected union');
  assert.equal(inComponent(after[0], [100, 80]), true);
  assertConserved(shapes, conquered, after);
});

test('same-winding nested rings preserve SVG land instead of manufacturing a hole', () => {
  const shapes = [shape('nested', rect(0, 0, 200, 160), rect(60, 40, 80, 80))];
  const ownership = { nested: 'A' }, components = createTerritoryComponentIndex(shapes).components(ownership);
  assert.equal(components.length, 1);
  assert.equal(components[0].parts[0].rings.length, 2);
  assert.equal(inComponent(components[0], [100, 80]), true);
  assertConserved(shapes, ownership, components);
});

test('unchanged and reordered ownership reuse cached immutable geometry', () => {
  const shapes = freezeDeep([shape('a', rect(0, 0, 100, 100)), shape('b', rect(100, 0, 100, 100))]);
  const ownership = freezeDeep({ a: 'A', b: 'A' }), snapshot = JSON.stringify({ shapes, ownership });
  const index = createTerritoryComponentIndex(shapes), first = index.components(ownership);
  assert.strictEqual(index.components(ownership), first);
  const reordered = index.components({ b: 'A', a: 'A' });
  assert.strictEqual(reordered, first);
  assert.strictEqual(reordered[0], first[0]);
  assert.strictEqual(reordered[0].parts[0].rings, first[0].parts[0].rings);
  assert.equal(JSON.stringify({ shapes, ownership }), snapshot, 'construction and grouping never mutate input');
  assert.deepEqual(createTerritoryComponentIndex([...shapes].reverse()).components(ownership), first,
    'shape ordering does not change stable keys, parts or bounds');
});

test('takeover changes the merged canvas while unrelated possessions keep their keys and geometry', () => {
  const shapes = [shape('a', rect(0, 0, 100, 80)), shape('b', rect(100, 0, 100, 80)), shape('remote', rect(700, 300, 60, 40))];
  const index = createTerritoryComponentIndex(shapes);
  const before = index.components({ a: 'A', b: 'B', remote: 'R' });
  const untouched = before.find(c => c.ownerId === 'R');
  const ownership = { a: 'A', b: 'A', remote: 'R' }, after = index.components(ownership);
  assert.equal(after.filter(c => c.ownerId === 'A').length, 1);
  assert.ok(!after.some(c => c.ownerId === 'B'));
  assert.deepEqual(after.find(c => c.ownerId === 'R'), untouched);
  assert.notEqual(after.find(c => c.ownerId === 'A').key, before.find(c => c.ownerId === 'A').key);
  assertConserved(shapes, ownership, after);
  assert.deepEqual(index.components({}), [], 'clearing campaign ownership removes all flag components');
});

test('geometry refits preserve connectivity while transforming every component canvas', () => {
  const shapes = [shape('a', rect(0, 0, 100, 80)), shape('b', rect(100, 0, 100, 80)), shape('island', rect(400, 50, 20, 30))];
  const ownership = { a: 'A', b: 'A', island: 'A' }, scale = 2.4, dx = 19, dy = -7;
  const transformed = shapes.map(s => ({ ...s, rings: s.rings.map(r => r.map(([x, y]) => [x * scale + dx, y * scale + dy])) }));
  const before = createTerritoryComponentIndex(shapes).components(ownership);
  const after = createTerritoryComponentIndex(transformed).components(ownership);
  assert.deepEqual(after.map(c => c.key), before.map(c => c.key));
  for (let i = 0; i < before.length; i++) {
    const b = before[i].bbox, a = after[i].bbox;
    const expected = { x: b.x * scale + dx, y: b.y * scale + dy, w: b.w * scale, h: b.h * scale };
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[key] - expected[key]) < 1e-9);
  }
  assertConserved(transformed, ownership, after);
});

const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
let worldAtlas;
function atlas() {
  if (worldAtlas) return worldAtlas;
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit;
  const paths = display.buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (paths[c.id] || rules.paths[c.id]).labelRings }));
  return (worldAtlas = { rules, display, paths, shapes });
}

test('real multipart France separates Europe and French Guiana instead of spanning the Atlantic', () => {
  const { rules, shapes } = atlas(), france = shapes.find(s => s.id === '250');
  const ownership = { '250': '250' }, components = createTerritoryComponentIndex([france]).components(ownership);
  const project = (lon, lat) => {
    const [x, y] = projPt(lon, lat), { s, tx, ty } = rules.fit;
    return [x * s + tx, y * s + ty];
  };
  const europe = components.find(c => inComponent(c, project(2, 46)));
  const guiana = components.find(c => inComponent(c, project(-53.5, 4)));
  assert.ok(europe && guiana, 'both continental France and French Guiana have owned land');
  assert.notEqual(europe.key, guiana.key);
  const combined = bounds(france.rings);
  assert.ok(europe.bbox.w < combined.w / 2 && guiana.bbox.w < combined.w / 2,
    'neither local flag includes the intervening Atlantic');
  assertConserved([france], ownership, components);
});

function sampledBands(component, canvas, resolution = 120) {
  const count = [0, 0, 0], b = component.bbox;
  for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
    const point = [b.x + (column + .5) / resolution * b.w, b.y + (row + .5) / resolution * b.h];
    if (!inComponent(component, point)) continue;
    const band = Math.min(2, Math.max(0, Math.floor((point[1] - canvas.y) / canvas.h * 3)));
    count[band]++;
  }
  return count;
}

test('Germany’s expanding European mainland keeps all three flag bands despite owning Greenland and Iceland', () => {
  const theatre = [...Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id), '304'];
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(theatre);
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit, paths = display.buildPaths(s, tx, ty);
  const held = ['112', '276', '208', '304', '352', '616'];
  const shapes = held.map(id => ({ id, rings: (paths[id] || rules.paths[id]).labelRings }));
  const ownership = Object.fromEntries(held.map(id => [id, '276']));
  const components = createTerritoryComponentIndex(shapes).components(ownership);
  const mainland = components.find(c => countryIds(c).includes('276'));
  for (const id of ['112', '208', '276', '616']) assert.ok(countryIds(mainland).includes(id), `${id} shares the mainland flag`);
  for (const id of ['304', '352']) assert.ok(!countryIds(mainland).includes(id), `${id} has its own detached flag canvas`);
  const localBands = sampledBands(mainland, mainland.bbox), total = localBands.reduce((a, b) => a + b, 0);
  assert.ok(total > 1000, 'sampled mainland has meaningful area');
  assert.ok(localBands.every(n => n > total * .025), `black/red/gold each cover substantial land: ${localBands}`);
  const globalBounds = bounds(shapes.flatMap(s => s.rings));
  const oldBands = sampledBands(mainland, globalBounds);
  assert.ok(oldBands[0] < total * .01, `old owner-wide canvas strands the black band away from Europe: ${oldBands}`);
  assertConserved(shapes, ownership, components);
});

test('real 50m and fallback 110m dateline pieces stay separate and conserve all rendered rings', () => {
  const { rules, paths } = atlas();
  for (const [quality, mapPaths] of [['50m', paths], ['110m fallback', rules.paths]]) {
    const shapes = ['643', '242', '840'].map(id => ({ id, rings: mapPaths[id].labelRings }));
    const ownership = Object.fromEntries(shapes.map(s => [s.id, s.id]));
    const components = createTerritoryComponentIndex(shapes).components(ownership);
    assertConserved(shapes, ownership, components);
    const fiji = components.filter(c => c.ownerId === '242');
    assert.ok(fiji.length > 1, `${quality}: Fiji has disconnected dateline pieces`);
    assert.ok(fiji.every(c => c.bbox.w < 100), `${quality}: no flag stretches across the world`);
    const russia = components.filter(c => c.ownerId === '643');
    assert.ok(russia.length > 1, `${quality}: Russia’s islands/dateline parts remain detached`);
    assert.ok(russia.every(c => c.bbox.w < 600), `${quality}: no artificial antimeridian bridge`);
  }
});

test('world conquest grouping is bounded and unchanged map frames reuse the result', t => {
  const { shapes } = atlas(), start = performance.now();
  const index = createTerritoryComponentIndex(shapes);
  const kickoff = index.components(Object.fromEntries(shapes.map(s => [s.id, s.id])));
  assert.ok(kickoff.length >= shapes.length);
  const ownership = Object.fromEntries(shapes.map(s => [s.id, 'winner']));
  const champion = index.components(ownership);
  assert.ok(champion.length > 1, 'winning the world does not connect continents through oceans');
  const coldMs = performance.now() - start;
  assert.ok(coldMs < 2500, `world construction and conquest grouping took ${coldMs.toFixed(0)} ms`);
  const cachedAt = performance.now();
  for (let i = 0; i < 100; i++) assert.strictEqual(index.components(ownership), champion);
  const cachedMs = performance.now() - cachedAt;
  assert.ok(cachedMs < 500, `100 cached frames took ${cachedMs.toFixed(0)} ms`);
  t.diagnostic(`world component grouping ${coldMs.toFixed(0)} ms; 100 cached frames ${cachedMs.toFixed(0)} ms`);
});
