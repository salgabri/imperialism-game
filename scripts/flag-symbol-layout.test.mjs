import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { layoutFlagSymbol } from '../src/engine/flagSymbolLayout.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const emblem = (x = 230, y = 120, w = 180, h = 240) => ({ bounds: { x, y, w, h }, sourceWidth: 640, sourceHeight: 480 });
const circle = emblem(176, 96, 288, 288);
function component(...parts) {
  const points = parts.flatMap(p => p.rings.flat());
  const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
  return { key: 'test', bbox: { x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y }, parts };
}
const part = (countryId, ...rings) => ({ countryId, rings });
const approx = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)), `${message || ''} ${a} ~= ${b}`);
function inside(region, x, y) {
  const countries = new Map();
  for (const p of region.parts) {
    if (!countries.has(p.countryId)) countries.set(p.countryId, []);
    countries.get(p.countryId).push(...p.rings);
  }
  for (const rings of countries.values()) {
    let winding = 0;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (Math.abs(cross) < 1e-8 && x >= Math.min(a[0], b[0]) - 1e-8 && x <= Math.max(a[0], b[0]) + 1e-8 && y >= Math.min(a[1], b[1]) - 1e-8 && y <= Math.max(a[1], b[1]) + 1e-8) return true;
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      else if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
    if (winding) return true;
  }
  return false;
}
function validate(region, profile, fit) {
  assert.ok(fit, 'a suitable landmass receives an emblem');
  const { symbol: s, field: f } = fit, b = region.bbox, n = profile.bounds;
  for (const value of [...Object.values(s), ...Object.values(f)]) assert.ok(Number.isFinite(value));
  assert.ok(s.w > 0 && s.h > 0);
  approx(s.w / s.h, n.w / n.h, 'no stretching of symbols');
  assert.ok(f.x <= b.x - .099999 && f.y <= b.y - .099999);
  assert.ok(f.x + f.w >= b.x + b.w + .099999 && f.y + f.h >= b.y + b.h + .099999, 'field covers every coast');
  approx(f.x + f.w * (n.x + n.w / 2) / profile.sourceWidth, s.x + s.w / 2, 'horizontal native registration');
  approx(f.y + f.h * (n.y + n.h / 2) / profile.sourceHeight, s.y + s.h / 2, 'vertical native registration');
  assert.ok(f.w * n.w / profile.sourceWidth >= s.w - 1e-7);
  assert.ok(f.h * n.h / profile.sourceHeight >= s.h - 1e-7);
  for (let y = 0; y <= 36; y++) for (let x = 0; x <= 36; x++) {
    assert.ok(inside(region, s.x + s.w * x / 36, s.y + s.h * y / 36), 'the entire symbol remains on owned land');
  }
}

test('one uniform emblem stays inside a concave L-shaped empire', () => {
  const r = component(part('a', [[0, 0], [100, 0], [100, 25], [30, 25], [30, 100], [0, 100]]));
  const fit = layoutFlagSymbol(r, emblem());
  validate(r, emblem(), fit);
  assert.ok(fit.symbol.x + fit.symbol.w < 30 || fit.symbol.y + fit.symbol.h < 25);
});

test('a long thin Japan-like diagonal keeps its disc circular and clear of both coasts', () => {
  const r = component(part('jp', [[0, 95], [8, 100], [106, 9], [100, 0], [55, 38]]));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  assert.ok(fit.symbol.w > 4 && fit.symbol.w < 20);
});

test('a nearby island chain uses one emblem on the substantial mainland and one field', () => {
  const r = component(part('a', rect(0, 0, 75, 50)), part('b', rect(85, 10, 10, 12)), part('c', rect(100, 15, 8, 8)));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  assert.ok(fit.symbol.x + fit.symbol.w < 75);
  assert.equal(Array.isArray(fit.symbol), false, 'not one symbol per island');
  assert.ok(fit.field.x + fit.field.w > 108);
});

test('foreign enclaves and holes are excluded even when all four emblem corners would fit', () => {
  const r = component(part('host', rect(0, 0, 100, 100), rect(40, 40, 20, 20).reverse()));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  const s = fit.symbol;
  assert.ok(s.x + s.w <= 40 || s.x >= 60 || s.y + s.h <= 40 || s.y >= 60, 'no internal hole within symbol');
});

test('sub-raster holes are caught by the vector certification, not only pixel or corner tests', () => {
  const r = component(part('host', rect(0, 0, 100, 100), rect(49.001, 49.003, .001, .002).reverse()));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  const s = fit.symbol;
  assert.ok(s.x + s.w <= 49.001 || s.x >= 49.002 || s.y + s.h <= 49.003 || s.y >= 49.005);
});

test('conquered internal borders do not split the available emblem canvas', () => {
  const r = component(part('left', rect(0, 0, 50, 100)), part('right', rect(50, 0, 50, 100).reverse()));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  assert.ok(fit.symbol.x < 50 && fit.symbol.x + fit.symbol.w > 50, 'symbol crosses a same-owner border');
});

test('differently subdivided diagonal internal borders remain a union', () => {
  const r = component(part('left', [[0, 0], [100, 0], [0, 100]]), part('right', [[100, 0], [100, 100], [0, 100], [33.333, 66.667], [66.667, 33.333]]));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  assert.ok(fit.symbol.x + fit.symbol.y < 100);
  assert.ok(fit.symbol.x + fit.symbol.w + fit.symbol.y + fit.symbol.h > 100);
});

test('mainland selection does not jump to a tiny island at the region bounding-box center', () => {
  const r = component(part('main', [[0, 0], [100, 0], [100, 12], [12, 12], [12, 100], [0, 100]]), part('speck', rect(44, 44, 12, 12)));
  const fit = layoutFlagSymbol(r, circle);
  validate(r, circle, fit);
  assert.ok(fit.symbol.x + fit.symbol.w < 12 || fit.symbol.y + fit.symbol.h < 12, 'the mainland wins even when the island is a tempting rectangle');
});

test('a conquered enclave is available again; same-winding nested rings remain filled', () => {
  for (const r of [
    component(part('host', rect(0, 0, 100, 100), rect(40, 40, 20, 20).reverse()), part('enclave', rect(40, 40, 20, 20))),
    component(part('host', rect(0, 0, 100, 100), rect(40, 40, 20, 20))),
  ]) {
    const fit = layoutFlagSymbol(r, circle);
    validate(r, circle, fit);
    assert.ok(fit.symbol.x < 50 && fit.symbol.x + fit.symbol.w > 50);
    assert.ok(fit.symbol.y < 50 && fit.symbol.y + fit.symbol.h > 50);
  }
});

test('Portugal seam and Spain stripe are registered to the undistorted emblem', () => {
  const r = component(part('host', [[0, 0], [28, 0], [34, 70], [25, 100], [7, 86]]));
  const portugal = emblem(168, 152, 176, 176);
  const pt = layoutFlagSymbol(r, portugal);
  validate(r, portugal, pt);
  approx(pt.field.x + pt.field.w * .4, pt.symbol.x + pt.symbol.w / 2, 'Portuguese emblem stays centered on the green/red seam');
  const spain = emblem(130, 148, 132, 184);
  const es = layoutFlagSymbol(r, spain);
  validate(r, spain, es);
  assert.ok(es.symbol.y >= es.field.y + es.field.h / 4);
  assert.ok(es.symbol.y + es.symbol.h <= es.field.y + es.field.h * .75);
});

test('structural field caps preserve Slovenia tricolor coverage and its upper-hoist focal point', () => {
  const r = component(part('host', rect(0, 0, 120, 65)));
  const profile = { ...emblem(85, 72, 145, 162), fieldConstraints: { maxWidthRatio: 1.35, maxHeightRatio: 1.15 } };
  const fit = layoutFlagSymbol(r, profile);
  validate(r, profile, fit);
  assert.ok(fit.field.w <= (r.bbox.w + .2) * 1.35 + 1e-7);
  assert.ok(fit.field.h <= (r.bbox.h + .2) * 1.15 + 1e-7);
  const redTop = fit.field.y + fit.field.h * 2 / 3;
  assert.ok(redTop < r.bbox.y + r.bbox.h * .8, 'red retains a substantial part of the land instead of disappearing');
  const fx = (profile.bounds.x + profile.bounds.w / 2) / 640;
  const fy = (profile.bounds.y + profile.bounds.h / 2) / 480;
  approx(fit.symbol.x + fit.symbol.w / 2, r.bbox.x - .1 + (r.bbox.w + .2) * fx, 'unobstructed crest prefers its native hoist fraction');
  approx(fit.symbol.y + fit.symbol.h / 2, r.bbox.y - .1 + (r.bbox.h + .2) * fy, 'unobstructed crest prefers its native upper stripe');
});

test('field caps participate in the cache and impossible structural placements fail closed', () => {
  const r = component(part('host', rect(0, 0, 120, 65)));
  const native = emblem(85, 72, 145, 162);
  const free = layoutFlagSymbol(r, native);
  const cappedProfile = { ...native, fieldConstraints: { maxHeightRatio: 1.15 } };
  const capped = layoutFlagSymbol(r, cappedProfile);
  validate(r, cappedProfile, capped);
  assert.notStrictEqual(capped, free);
  assert.strictEqual(layoutFlagSymbol(r, { ...cappedProfile, fieldConstraints: { maxHeightRatio: 1.15 } }), capped);
  assert.equal(layoutFlagSymbol(r, { ...native, fieldConstraints: { maxHeightRatio: .8 } }), null);
  assert.equal(layoutFlagSymbol(r, { ...native, fieldConstraints: { maxWidthRatio: NaN } }), null);
  const strictRegion = component(part('host', rect(513.27, 162.25, 12.02, 4.27)));
  const strictProfile = { ...native, fieldConstraints: { maxWidthRatio: 1, maxHeightRatio: 1 } };
  const strict = layoutFlagSymbol(strictRegion, strictProfile);
  validate(strictRegion, strictProfile, strict);
  approx(strict.field.w, strictRegion.bbox.w + .2, 'zero overscan permits the exact native anchor despite decimal roundoff');
  approx(strict.field.h, strictRegion.bbox.h + .2);
});

test('camera arguments cannot change layout; cache and inputs stay immutable', () => {
  const r = component(part('a', rect(0, 0, 100, 100)));
  const before = JSON.stringify(r), profile = emblem();
  const first = layoutFlagSymbol(r, profile);
  for (const camera of [{ k: .1 }, { k: 10 }, { zoom: 100, x: 20, y: 40 }]) {
    assert.strictEqual(layoutFlagSymbol(r, { ...profile, ...camera }), first);
  }
  assert.strictEqual(layoutFlagSymbol(r, JSON.parse(JSON.stringify(profile))), first);
  assert.equal(JSON.stringify(r), before);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.symbol) && Object.isFrozen(first.field));
  assert.deepEqual(layoutFlagSymbol(JSON.parse(before), profile), first, 'same geography gives deterministic placement');
});

test('invalid geometry and invalid emblem bounds fail closed', () => {
  const r = component(part('a', rect(0, 0, 100, 100)));
  for (const p of [null, {}, emblem(600, 0, 200, 200), emblem(-1, 10, 20, 20), { ...circle, sourceWidth: 0 }, { ...circle, bounds: { ...circle.bounds, w: NaN } }]) {
    assert.equal(layoutFlagSymbol(r, p), null);
  }
  for (const r of [null, {}, { bbox: { x: 0, y: 0, w: 10, h: 10 }, parts: [] }, { bbox: { x: NaN, y: 0, w: 10, h: 10 }, parts: [] }]) assert.equal(layoutFlagSymbol(r, circle), null);
});

test('world-scale geometry has bounded search work and cached repeat cost', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit, paths = display.buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (paths[c.id] || rules.paths[c.id]).labelRings }));
  const index = createFlagRegionIndex(shapes, { maxGap: FLAG_REGION_GAP_KM / rules.kmPerUnit });
  const regions = index.components(Object.fromEntries(shapes.map(shape => [shape.id, shape.id])));
  const started = performance.now();
  let fitted = 0;
  for (const r of regions) {
    const fit = layoutFlagSymbol(r, circle);
    if (fit) {
      fitted++;
      assert.ok(fit.quality.candidates <= 20);
      assert.ok(fit.quality.rasterCells <= 11000);
      assert.strictEqual(layoutFlagSymbol(r, circle), fit);
      const s = fit.symbol;
      for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) assert.ok(inside(r, s.x + s.w * x / 4, s.y + s.h * y / 4), `land fit for ${r.key}`);
    }
  }
  assert.ok(fitted > 180, `fitted ${fitted} substantial country components`);
  assert.ok(performance.now() - started < 12000, 'all world components fit within a bounded one-time budget');
  for (const [ownerId, code] of [['124', 'ca'], ['705', 'si']]) {
    const r = regions.find(region => region.ownerId === ownerId), profile = FLAG_SYMBOLS[code];
    const fit = layoutFlagSymbol(r, profile);
    validate(r, profile, fit);
    for (const [ratio, size] of [['maxWidthRatio', 'w'], ['maxHeightRatio', 'h']]) {
      if (profile.fieldConstraints?.[ratio]) assert.ok(fit.field[size] <= (r.bbox[size] + .2) * profile.fieldConstraints[ratio] + 1e-7, `${code} structural field remains bounded on actual geography`);
    }
  }
  const conquered = index.components(Object.fromEntries(shapes.map(shape => [shape.id, 'winner'])));
  const conqueredStart = performance.now();
  for (const r of conquered) {
    const fit = layoutFlagSymbol(r, circle);
    if (fit) {
      assert.ok(fit.quality.candidates <= 20 && fit.quality.rasterCells <= 11000);
      assert.strictEqual(layoutFlagSymbol(r, circle), fit);
    }
  }
  assert.ok(performance.now() - conqueredStart < 12000, 'a conquered world retains a bounded search');
});
