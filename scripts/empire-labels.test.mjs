// Independent geometry regressions for strategic-map name placement.
// The oracle below does not call the engine's containment implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createEmpireLabelEngine } from '../src/engine/empireLabels.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';

const EPS = 1e-7;
const WORLD = { x: 0, y: 0, w: 960, h: 540 };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (id, ...rings) => ({ id, rings });
const name = (id = 'A', text = 'EMPIRE', widthEm = 4.5) => ({ id, text, widthEm });
const options = (ownership, labels = [name()], extra = {}) => ({
  ownership, labels, viewBox: WORLD, unitsPerPixel: 1, minFontPx: 11, maxFontPx: 32, ...extra,
});
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= EPS
  && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;

function winding(ring, point) {
  let count = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (onSegment(a, b, point)) return { boundary: true, count: 0 };
    if (a[1] <= point[1] && b[1] > point[1] && cross(a, b, point) > 0) count++;
    if (a[1] > point[1] && b[1] <= point[1] && cross(a, b, point) < 0) count--;
  }
  return { boundary: false, count };
}

function owned(shapes, ownership, owner, point) {
  return shapes.some(s => {
    if (ownership[s.id] !== owner) return false;
    const rings = s.rings.map(r => winding(r, point));
    return rings.some(r => r.boundary) || rings.reduce((sum, r) => sum + r.count, 0) !== 0;
  });
}

function intersectionT(a, b, c, d) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ex = d[0] - c[0], ey = d[1] - c[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < EPS) return null;
  const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
  const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null;
}

function segments(shapes, ownership, owner) {
  return shapes.filter(s => ownership[s.id] === owner).flatMap(s => s.rings.flatMap(r =>
    r.map((a, i) => [a, r[(i + 1) % r.length]])));
}

function assertInside(shapes, ownership, label) {
  const f = label.footprint;
  assert.equal(f.length, 4, 'label has four footprint corners');
  for (const key of ['x', 'y', 'angle', 'fontSize', 'letterSpacing', 'width', 'height', 'componentArea']) {
    assert.ok(Number.isFinite(label[key]), `${label.id}.${key} is finite`);
  }
  assert.ok(label.width > 0 && label.height > 0 && label.fontSize > 0 && label.componentArea > 0);
  const requireOwned = (p, context) => assert.ok(owned(shapes, ownership, label.id, p),
    `${label.text}: ${context} escapes owner at ${p.map(v => v.toFixed(3)).join(', ')}`);
  // Dense interior checks catch the familiar centroid-in-land/text-at-sea bug.
  for (let x = 0; x <= 32; x++) for (let y = 0; y <= 12; y++) {
    requireOwned(lerp(lerp(f[0], f[1], x / 32), lerp(f[3], f[2], x / 32), y / 12), 'text ribbon');
  }
  const boundary = segments(shapes, ownership, label.id);
  // Split the label perimeter at every real boundary intersection, checking
  // each resulting interval. Unlike fixed samples, this catches narrow notches.
  for (let i = 0; i < 4; i++) {
    const a = f[i], b = f[(i + 1) % 4];
    const cuts = [0, 1];
    for (const [c, d] of boundary) {
      const t = intersectionT(a, b, c, d);
      if (t !== null) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) requireOwned(lerp(a, b, (cuts[j - 1] + cuts[j]) / 2), 'perimeter');
  }
  // A tiny lake/enclave can lie wholly inside the ribbon without crossing its
  // perimeter. Test either side of every boundary fragment inside the ribbon.
  for (const [a, b] of boundary) {
    const cuts = [0, 1];
    for (let i = 0; i < 4; i++) {
      const t = intersectionT(a, b, f[i], f[(i + 1) % 4]);
      if (t !== null) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < EPS) continue;
    for (let j = 1; j < cuts.length; j++) {
      const p = lerp(a, b, (cuts[j - 1] + cuts[j]) / 2);
      if (!winding(f, p).count) continue;
      const dx = -(b[1] - a[1]) / length * .001, dy = (b[0] - a[0]) / length * .001;
      for (const side of [-1, 1]) {
        const near = [p[0] + dx * side, p[1] + dy * side];
        if (winding(f, near).count) requireOwned(near, 'enclosed boundary');
      }
    }
  }
}

test('rectangle: readable, finite name fully inside its borders', () => {
  const shapes = [shape('a', rect(20, 20, 300, 150))], ownership = { a: 'A' };
  const engine = createEmpireLabelEngine(shapes);
  const labels = engine.layout(options(ownership));
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, 'EMPIRE');
  assert.ok(labels[0].fontSize >= 11 && labels[0].fontSize <= 32);
  assertInside(shapes, ownership, labels[0]);
  assert.equal(engine.contains(ownership, 'A', 50, 50), true);
  assert.equal(engine.contains(ownership, 'A', 0, 0), false);
  assert.equal(engine.validateFootprint(ownership, 'A', labels[0].footprint), true);
});

test('conquest merges countries into one larger name spanning the old border', () => {
  const shapes = [shape('left', rect(0, 0, 100, 85)), shape('right', rect(100, 0, 100, 85))];
  const engine = createEmpireLabelEngine(shapes), labels = [name('A', 'EXPANDING EMPIRE', 7)];
  const before = engine.layout(options({ left: 'A', right: 'B' }, labels));
  const ownership = { left: 'A', right: 'A' };
  const after = engine.layout(options(ownership, labels));
  assert.equal(before.length, 1);
  assert.equal(after.length, 1);
  assert.ok(after[0].fontSize > before[0].fontSize * 1.15, 'conquest increases fitted type size');
  assert.ok(after[0].componentArea > before[0].componentArea * 1.8, 'shared border no longer divides empire');
  assert.ok(Math.min(...after[0].footprint.map(p => p[0])) < 100 && Math.max(...after[0].footprint.map(p => p[0])) > 100);
  assertInside(shapes, ownership, after[0]);
});

test('concave U-shaped territory never bridges its empty bay', () => {
  const shapes = [shape('u', [[0, 0], [220, 0], [220, 180], [150, 180], [150, 65], [70, 65], [70, 180], [0, 180]])];
  const ownership = { u: 'A' }, engine = createEmpireLabelEngine(shapes);
  const labels = engine.layout(options(ownership, [name('A', 'KINGDOM', 5)]));
  assert.equal(labels.length, 1);
  assertInside(shapes, ownership, labels[0]);
  assert.equal(engine.contains(ownership, 'A', 110, 120), false);
  assert.equal(engine.validateFootprint(ownership, 'A', rect(40, 90, 140, 30).slice(0, 4)), false);
});

test('nonzero-winding enclave is avoided, but a conquered enclave fills the hole', () => {
  const hole = rect(80, 45, 80, 90);
  const shapes = [shape('host', rect(0, 0, 240, 180), [...hole].reverse()), shape('enclave', hole)];
  const engine = createEmpireLabelEngine(shapes), ownership = { host: 'A', enclave: 'B' };
  const labels = engine.layout(options(ownership));
  assert.equal(labels.length, 1);
  assertInside(shapes, ownership, labels[0]);
  assert.equal(engine.contains(ownership, 'A', 120, 90), false);
  assert.equal(engine.validateFootprint(ownership, 'A', rect(55, 30, 130, 120).slice(0, 4)), false,
    'all four corners can be owned while a foreign enclave lies inside');
  const conquered = { host: 'A', enclave: 'A' };
  assert.equal(engine.contains(conquered, 'A', 120, 90), true);
  for (const label of engine.layout(options(conquered))) assertInside(shapes, conquered, label);
});

test('overseas possessions do not pull the name into the ocean', () => {
  const shapes = [shape('mainland', rect(10, 10, 240, 140)), shape('island', rect(800, 350, 20, 20))];
  const ownership = { mainland: 'A', island: 'A' }, engine = createEmpireLabelEngine(shapes);
  const labels = engine.layout(options(ownership));
  assert.equal(labels.length, 1);
  assert.ok(labels[0].x >= 10 && labels[0].x <= 250 && labels[0].y <= 150);
  assertInside(shapes, ownership, labels[0]);
});

test('a mostly offscreen giant island cannot outrank a useful visible mainland', () => {
  const shapes = [
    // Greenland-like island: globally huge, but only a coastal sliver is
    // visible. It can still fit a small label, so merely checking visibility
    // or whether any name fits would pick the wrong component.
    shape('island', rect(-700, -100, 860, 300)),
    shape('mainland', rect(220, 40, 330, 220)),
  ];
  const ownership = { island: 'A', mainland: 'A' }, engine = createEmpireLabelEngine(shapes);
  const labels = [name('A', 'GERMANY', 7)];
  const viewBox = { x: 0, y: 0, w: 600, h: 300 };
  const sliverOnly = createEmpireLabelEngine([shapes[0]]).layout(options({ island: 'A' }, labels, { viewBox }));
  assert.equal(sliverOnly.length, 1, 'the offscreen island really does offer a readable competing candidate');
  const first = engine.layout(options(ownership, labels, { viewBox }));
  assert.equal(first.length, 1);
  assert.ok(first[0].x >= 220 && first[0].x <= 550 && first[0].y >= 40 && first[0].y <= 260,
    'the mainland has much more visible owned land and must receive the name');
  assert.ok(first[0].fontSize > sliverOnly[0].fontSize * 1.4, 'mainland offers a substantially larger readable name');
  assertInside(shapes, ownership, first[0]);
  // A <5% pan in either direction leaves the same usable mainland fully in
  // view. This must not send its label back to the island or change its anchor.
  for (const [x, y] of [[20, 8], [-20, -8], [0, 0]]) {
    const moved = engine.layout(options(ownership, labels, { viewBox: { ...viewBox, x, y } }));
    assert.equal(moved.length, 1);
    assert.equal(moved[0].x, first[0].x, 'small pan preserves the geographic anchor');
    assert.equal(moved[0].y, first[0].y, 'small pan preserves the geographic anchor');
    assert.equal(moved[0].angle, first[0].angle, 'small pan preserves label orientation');
    assertInside(shapes, ownership, moved[0]);
  }
});

test('long names either fit readably or are omitted rather than escaping borders', () => {
  const shapes = [shape('tiny', rect(10, 10, 30, 20)), shape('large', rect(100, 10, 600, 180))];
  const ownership = { tiny: 'A', large: 'B' }, engine = createEmpireLabelEngine(shapes);
  const text = 'DEMOCRATIC REPUBLIC OF THE CONGO';
  const labels = engine.layout(options(ownership, [name('A', text, 22), name('B', text, 22)]));
  assert.ok(!labels.some(l => l.id === 'A'));
  assert.ok(labels.some(l => l.id === 'B'));
  for (const label of labels) {
    assert.ok(label.fontSize >= 11 && label.fontSize <= 32);
    assertInside(shapes, ownership, label);
  }
});

test('deterministic ownership order, stable camera movement, and eliminated-owner removal', () => {
  const shapes = [shape('left', rect(100, 100, 200, 140)), shape('right', rect(300, 100, 200, 140))];
  const engine = createEmpireLabelEngine(shapes), ownership = { left: 'A', right: 'A' };
  const input = options(ownership), snapshot = JSON.stringify({ shapes, input });
  const first = engine.layout(input);
  assert.equal(first.length, 1);
  assert.deepEqual(engine.layout(options({ right: 'A', left: 'A' })), first);
  assert.deepEqual(engine.layout(input), first);
  const panned = engine.layout(options(ownership, [name()], { viewBox: { x: 20, y: 20, w: 900, h: 500 } }));
  assert.equal(panned.length, 1);
  assert.equal(panned[0].x, first[0].x);
  assert.equal(panned[0].y, first[0].y);
  assert.equal(panned[0].angle, first[0].angle);
  const zoomed = engine.layout(options(ownership, [name()], { unitsPerPixel: .95 }));
  assert.equal(zoomed.length, 1);
  assert.ok(Math.hypot(zoomed[0].x - first[0].x, zoomed[0].y - first[0].y) < 30, 'small zoom does not teleport name');
  assert.equal(JSON.stringify({ shapes, input }), snapshot, 'inputs remain immutable');
  const conquered = { left: 'B', right: 'B' };
  const after = engine.layout(options(conquered, [name('A'), name('B', 'WINNER')]));
  assert.deepEqual(after.map(l => l.id), ['B']);
  assertInside(shapes, conquered, after[0]);
  assert.deepEqual(engine.layout(options({}, [name()])), []);
});

let atlasCache;
function atlas() {
  if (atlasCache) return atlasCache;
  const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit;
  display.paths = display.buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (display.paths[c.id] || rules.paths[c.id]).labelRings }));
  assert.ok(shapes.every(s => Array.isArray(s.rings)), 'geometry exposes exact rendered label rings');
  return (atlasCache = { shapes, display, rules });
}

test('real 50m atlas: dateline Russia, narrow Chile, Japan, and Indonesia stay on owned land', () => {
  const { shapes, display } = atlas();
  for (const [id, text] of [['643', 'RUSSIA'], ['152', 'CHILE'], ['392', 'JAPAN'], ['360', 'INDONESIA'], ['242', 'FIJI']]) {
    const country = shapes.find(s => s.id === id);
    assert.ok(country && country.rings.length, `${text} has rendered rings`);
    const fromPath = [...display.paths[id].d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    assert.deepEqual(country.rings.flat(), fromPath, `${text} uses SVG's rounded, dateline-split geometry`);
    const ownership = { [id]: id }, engine = createEmpireLabelEngine([country]);
    const labels = engine.layout(options(ownership, [name(id, text, text.length * .75)], { unitsPerPixel: .12 }));
    if (id !== '242') assert.equal(labels.length, 1, `${text} can be labelled when zoomed in`);
    for (const label of labels) assertInside([country], ownership, label);
  }
});

test('real European campaign prefers Germany’s readable mainland name over the Greenland sliver', () => {
  const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
  const theatre = [...Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id), '304'];
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(theatre);
  const display = new WorldGeometry(load('countries-50m.json'));
  const { s, tx, ty } = rules.fit;
  const paths = display.buildPaths(s, tx, ty);
  const held = ['112', '276', '208', '304', '352', '616'];
  const shapes = held.map(id => ({ id, rings: (paths[id] || rules.paths[id]).labelRings }));
  const ownership = Object.fromEntries(held.map(id => [id, '276']));
  const labels = [name('276', 'GERMANY', 5.3)];
  const geographicBox = (west, north, east, south) => {
    const points = [[west, north], [east, north], [west, south], [east, south]].map(([lon, lat]) => {
      const [x, y] = projPt(lon, lat);
      return [x * s + tx, y * s + ty];
    });
    const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
    return { x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y };
  };
  const mainland = shapes.filter(country => !['304', '352'].includes(country.id));
  const greenland = shapes.find(country => country.id === '304');
  const engine = createEmpireLabelEngine(shapes);
  const mainlandLabel = (viewBox, unitsPerPixel) => {
    const placed = engine.layout(options(ownership, labels, { viewBox, unitsPerPixel }));
    assert.equal(placed.length, 1);
    const label = placed[0];
    assert.ok(owned(mainland, ownership, '276', [label.x, label.y]),
      `the readable mainland candidate must win, not a Greenland or Iceland possession; got ${label.x},${label.y}`);
    assert.ok(label.fontSize / unitsPerPixel > 17, 'choose the larger mainland text, not a cramped overseas label');
    assertInside(shapes, ownership, label);
    return label;
  };
  // Reconstruct the real App Europe focus and useMapViewport reset framing at
  // the original desktop canvas size. Projection changes must not silently
  // turn old map-unit coordinates into an unrelated camera or zoom level.
  const focus = geographicBox(-15, 71, 44, 34);
  const openingCanvas = { width: 926, height: 848 };
  const aspect = openingCanvas.height / openingCanvas.width;
  const openingWidth = Math.max(focus.w, focus.h / aspect) * 1.08;
  const openingView = { x: focus.x + (focus.w - openingWidth) / 2,
    y: focus.y + (focus.h - openingWidth * aspect) / 2, w: openingWidth, h: openingWidth * aspect };
  mainlandLabel(openingView, openingWidth / openingCanvas.width);

  // A flat projection no longer brings a readable Greenland sliver into that
  // exact opening camera. Keep the original competition regression explicit:
  // a desktop Europe/North Atlantic view includes only its southeast coast,
  // yet that coast genuinely offers a small, readable competing name.
  const viewBox = geographicBox(-38, 75, 55, 30);
  const unitsPerPixel = viewBox.w / 1100;
  const islandCandidate = createEmpireLabelEngine([greenland]).layout(options({ 304: '276' }, labels, { viewBox, unitsPerPixel }));
  assert.equal(islandCandidate.length, 1, 'the visible Greenland sliver offers a real readable competing candidate');
  const bounds = geographicBox(-75, 85, -8, 58);
  let islandSamples = 0, visibleSamples = 0;
  for (let row = 0; row < 64; row++) for (let col = 0; col < 64; col++) {
    const point = [bounds.x + (col + .5) * bounds.w / 64, bounds.y + (row + .5) * bounds.h / 64];
    if (!owned([greenland], ownership, '276', point)) continue;
    islandSamples++;
    if (point[0] >= viewBox.x && point[0] <= viewBox.x + viewBox.w && point[1] >= viewBox.y && point[1] <= viewBox.y + viewBox.h) visibleSamples++;
  }
  assert.ok(visibleSamples > 0 && visibleSamples < islandSamples * .25, 'the competing island remains mostly offscreen');
  const first = mainlandLabel(viewBox, unitsPerPixel);
  assert.ok(first.fontSize > islandCandidate[0].fontSize * 1.4, 'mainland offers substantially more readable type than the coastal sliver');
  // Continuity should not trap the name on Greenland when returning to Europe.
  const islandView = bounds;
  const overseas = engine.layout(options(ownership, labels, { viewBox: islandView, unitsPerPixel }));
  assert.equal(overseas.length, 1, 'Greenland itself can be labelled when it is the subject of the view');
  assert.ok(owned([greenland], ownership, '276', [overseas[0].x, overseas[0].y]), 'the overseas view places the name on actual Greenland land');
  const returned = mainlandLabel(viewBox, unitsPerPixel);
  assert.equal(returned.x, first.x);
  assert.equal(returned.y, first.y);
  assert.equal(returned.angle, first.angle);
});

test('world setup, world conquest, and cached repeated frames stay within practical work limits', t => {
  const { shapes } = atlas();
  const start = performance.now(), engine = createEmpireLabelEngine(shapes);
  const ownership = Object.fromEntries(shapes.map(s => [s.id, s.id]));
  const labels = shapes.map(s => name(s.id, NATIONS[s.id]?.[0]?.toUpperCase() || s.id, 6));
  const kickoff = engine.layout(options(ownership, labels));
  const conquered = Object.fromEntries(shapes.map(s => [s.id, 'winner']));
  const champion = engine.layout(options(conquered, [name('winner', 'WORLD EMPIRE', 9)]));
  const coldMs = performance.now() - start;
  assert.ok(kickoff.length > 5, 'world setup has readable major nations');
  assert.equal(champion.length, 1);
  assert.ok(coldMs < 5000, `two cold world layouts took ${coldMs.toFixed(0)} ms`);
  const warmStart = performance.now();
  for (let i = 0; i < 30; i++) engine.layout(options(conquered, [name('winner', 'WORLD EMPIRE', 9)]));
  const warmMs = performance.now() - warmStart;
  assert.ok(warmMs < 1500, `30 unchanged frames took ${warmMs.toFixed(0)} ms`);
  t.diagnostic(`cold world layouts ${coldMs.toFixed(0)} ms; 30 cached frames ${warmMs.toFixed(0)} ms`);
});

// Curved/coastal options are opt-in. All strict regressions above intentionally
// keep their original inputs and complete-land containment requirements.
const CURVED_COAST = { curveRatio: .055, coastalAllowancePx: 10, maxSeaFraction: .22 };
const polygonArea = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);
const shapeContains = (s, point) => {
  const counts = s.rings.map(r => winding(r, point));
  return counts.some(c => c.boundary) || counts.reduce((sum, c) => sum + c.count, 0) !== 0;
};
const polygonBounds = rings => {
  const points = rings.flat();
  return { left: Math.min(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])),
    right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])) };
};

function curvePoint(label, t, normalOffset = 0) {
  const rise = label.curveRise, width = label.width;
  const x = width * (t - .5), y = rise / 2 - 4 * rise * t * (1 - t);
  const tangentY = 4 * rise * (2 * t - 1), length = Math.hypot(width, tangentY);
  const u = x - tangentY / length * normalOffset, v = y + width / length * normalOffset;
  const angle = label.angle * Math.PI / 180;
  return [label.x + u * Math.cos(angle) - v * Math.sin(angle), label.y + u * Math.sin(angle) + v * Math.cos(angle)];
}

function assertCurveEnvelope(label) {
  assert.ok(Number.isFinite(label.curveRise) && label.curveRise > 0, 'requested gentle arch is actually present');
  assert.ok(label.curveRise / label.width <= .06, 'arch remains gentle rather than bending text sharply');
  for (let i = 0; i <= 100; i++) for (const normal of [-.75, 0, .75]) {
    const p = curvePoint(label, i / 100, normal * label.fontSize);
    const hit = winding(label.footprint, p);
    assert.ok(hit.count || hit.boundary, 'complete curved glyph/halo ribbon stays in the validated footprint');
  }
  assert.ok(label.height >= label.fontSize * 1.5 + label.curveRise - 1e-6, 'height includes the arch and glyph envelope');
}

function assertNoForeignOverlap(shapes, ownership, label) {
  const f = label.footprint, b = polygonBounds([f]);
  const foreign = shapes.filter(s => {
    if (ownership[s.id] === label.id) return false;
    const sb = polygonBounds(s.rings);
    return sb.left < b.right && sb.right > b.left && sb.top < b.bottom && sb.bottom > b.top;
  });
  for (const s of foreign) {
    for (let x = 0; x <= 20; x++) for (let y = 0; y <= 10; y++) {
      const p = lerp(lerp(f[0], f[1], x / 20), lerp(f[3], f[2], x / 20), y / 10);
      assert.equal(shapeContains(s, p), false, `label overlaps foreign/neutral ${s.id}`);
    }
    // Tiny enclaves may fall between every grid sample. Split each real
    // boundary at footprint intersections and inspect the enclosed fragments.
    for (const ring of s.rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], z = ring[(i + 1) % ring.length], cuts = [0, 1];
      for (let j = 0; j < 4; j++) {
        const t = intersectionT(a, z, f[j], f[(j + 1) % 4]);
        if (t !== null) cuts.push(t);
      }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        if (cuts[j] - cuts[j - 1] < EPS) continue;
        assert.equal(winding(f, lerp(a, z, (cuts[j] + cuts[j - 1]) / 2)).count, 0,
          `footprint encloses a boundary of foreign/neutral ${s.id}`);
      }
    }
  }
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function assertBoundedCoast(shapes, ownership, label, settings = CURVED_COAST, unitsPerPixel = 1) {
  assertCurveEnvelope(label);
  assert.equal(owned(shapes, ownership, label.id, [label.x, label.y]), true, 'label center remains on owned land');
  assertNoForeignOverlap(shapes, ownership, label);
  const boundary = segments(shapes, ownership, label.id), f = label.footprint;
  let sea = 0, total = 0;
  const checkDistance = p => {
    if (owned(shapes, ownership, label.id, p)) return false;
    const distance = Math.min(...boundary.map(([a, b]) => pointSegmentDistance(p, a, b)));
    assert.ok(distance <= settings.coastalAllowancePx * unitsPerPixel + .0001,
      `sea overhang ${distance.toFixed(4)} exceeds the coastal allowance`);
    return true;
  };
  for (let x = 0; x < 128; x++) for (let y = 0; y < 40; y++) {
    const p = lerp(lerp(f[0], f[1], (x + .5) / 128), lerp(f[3], f[2], (x + .5) / 128), (y + .5) / 40);
    if (checkDistance(p)) sea++;
    total++;
  }
  for (let i = 0; i < 4; i++) for (let n = 0; n <= 80; n++) checkDistance(lerp(f[i], f[(i + 1) % 4], n / 80));
  assert.ok(sea / total <= settings.maxSeaFraction + .01, 'independent sampled sea fraction stays bounded');
  assert.ok(Number.isFinite(label.seaFraction) && label.seaFraction <= settings.maxSeaFraction + 1e-7);
  assert.ok(Math.abs(label.seaFraction - sea / total) < .015, 'reported fraction agrees with independent sampling');
  return sea / total;
}

function areaInsideRectangle(polygon, rectangle) {
  let clipped = polygon;
  for (const [axis, boundary, greater] of [[0, rectangle.x, true], [0, rectangle.x + rectangle.w, false],
    [1, rectangle.y, true], [1, rectangle.y + rectangle.h, false]]) {
    const output = [], inside = p => greater ? p[axis] >= boundary : p[axis] <= boundary;
    for (let i = 0; i < clipped.length; i++) {
      const a = clipped[i], z = clipped[(i + 1) % clipped.length];
      if (inside(a)) output.push(a);
      if (inside(a) !== inside(z)) output.push(lerp(a, z, (boundary - a[axis]) / (z[axis] - a[axis])));
    }
    clipped = output;
  }
  return polygonArea(clipped);
}

test('opt-in gentle arches validate their full curved ribbon while preserving strict defaults', () => {
  const shapes = [shape('land', rect(40, 40, 350, 170))], ownership = { land: 'A' };
  const engine = createEmpireLabelEngine(shapes);
  const strict = engine.layout(options(ownership))[0];
  assert.ok(!strict.curveRise, 'default remains straight for existing callers');
  const curved = engine.layout(options(ownership, [name()], { curveRatio: .055 }));
  assert.equal(curved.length, 1);
  assertCurveEnvelope(curved[0]);
  assertInside(shapes, ownership, curved[0]);
  assert.equal(curved[0].coastal, false);
  assert.equal(curved[0].seaFraction, 0);
});

test('a readable narrow-island name can use a bounded sliver of sea only when strict fitting fails', () => {
  const island = { x: 80, y: 80, w: 68, h: 30 }, shapes = [shape('island', rect(island.x, island.y, island.w, island.h))];
  const ownership = { island: 'A' }, labels = [name('A', 'COASTLAND', 6.5)], engine = createEmpireLabelEngine(shapes);
  assert.deepEqual(engine.layout(options(ownership, labels, { curveRatio: .055 })), []);
  const coast = engine.layout(options(ownership, labels, CURVED_COAST));
  assert.equal(coast.length, 1, 'a small controlled overhang reveals the previously hidden name');
  const label = coast[0];
  assert.equal(label.coastal, true);
  assert.ok(label.fontSize >= 11 && label.fontSize <= 32);
  assert.ok(assertBoundedCoast(shapes, ownership, label) > 0);
  const exactFraction = 1 - areaInsideRectangle(label.footprint, island) / polygonArea(label.footprint);
  assert.ok(exactFraction > 0 && exactFraction <= .22 + 1e-7);
  assert.ok(Math.abs(exactFraction - label.seaFraction) < 1e-6, 'sea fraction matches independent exact polygon clipping');
  assert.equal(engine.validateFootprint(ownership, 'A', label.footprint), false, 'strict containment remains strict');
  for (const limits of [{ coastalAllowancePx: 0 }, { coastalAllowancePx: 5 }, { maxSeaFraction: .1 }]) {
    assert.deepEqual(engine.layout(options(ownership, labels, { ...CURVED_COAST, ...limits })), [], 'tightening either coast bound removes this fallback');
  }
});

test('a cramped inland name keeps a gentler nonzero arch instead of disappearing', () => {
  const shapes = [shape('strip', rect(40, 40, 150, 18.5))], ownership = { strip: 'A' };
  const engine = createEmpireLabelEngine(shapes);
  const placed = engine.layout(options(ownership, [name()], { curveRatio: .055 }));
  assert.equal(placed.length, 1);
  const label = placed[0];
  assert.ok(label.fontSize >= 11);
  assert.ok(Math.abs(label.curveRise / label.width - .025) < 1e-7, 'only the final inland fallback softens the arch');
  assert.equal(label.coastal, false);
  assert.equal(label.seaFraction, 0);
  assertCurveEnvelope(label);
  assertInside(shapes, ownership, label);
});

test('coastal options prefer an available wholly-owned placement over a larger offshore label', () => {
  const shapes = [shape('land', rect(80, 80, 145, 60))], ownership = { land: 'A' }, labels = [name('A', 'KINGDOM', 6)];
  const engine = createEmpireLabelEngine(shapes);
  const strict = engine.layout(options(ownership, labels, { curveRatio: .055 }));
  const allowed = engine.layout(options(ownership, labels, CURVED_COAST));
  assert.equal(strict.length, 1);
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].coastal, false);
  assert.equal(allowed[0].seaFraction, 0);
  assertInside(shapes, ownership, allowed[0]);
  assertCurveEnvelope(allowed[0]);
  assert.ok(allowed[0].fontSize <= strict[0].fontSize * 1.05, 'coast allowance is not a size boost when land fitting works');
});

test('sea allowances never grant permission to paint names across rival or neutral land', () => {
  const shapes = [shape('island', rect(80, 80, 68, 30)),
    shape('west', rect(40, 60, 39.5, 70)), shape('east', rect(148.5, 60, 40, 70))];
  const engine = createEmpireLabelEngine(shapes), labels = [name('A', 'COASTLAND', 6.5)];
  for (const neighbors of [{ west: 'B', east: 'B' }, {}]) {
    const ownership = { island: 'A', ...neighbors };
    const placed = engine.layout(options(ownership, labels, CURVED_COAST));
    for (const label of placed) assertNoForeignOverlap(shapes, ownership, label);
    assert.deepEqual(placed, [], 'only foreign-land overlap could make this blocked island label fit');
  }
});

test('tiny foreign and neutral enclaves cannot hide between coastal-validation samples', () => {
  const outer = rect(40, 40, 300, 130), ownership = { host: 'A' };
  const baseline = createEmpireLabelEngine([shape('host', outer)]).layout(options(ownership, [name()], CURVED_COAST))[0];
  const p = curvePoint(baseline, .68, .12 * baseline.fontSize);
  const hole = rect(p[0], p[1], .08, .08);
  const shapes = [shape('host', outer, [...hole].reverse()), shape('enclave', hole)];
  for (const enclaveOwner of ['B', undefined]) {
    const held = { host: 'A', enclave: enclaveOwner };
    const placed = createEmpireLabelEngine(shapes).layout(options(held, [name()], CURVED_COAST));
    assert.equal(placed.length, 1, 'a broad mainland still has another valid location');
    assertNoForeignOverlap(shapes, held, placed[0]);
    assertInside(shapes, held, placed[0]);
  }
});

test('arched/coastal placement is stable through small pans, caches options, and rejects almost-all-sea labels', () => {
  const shapes = [shape('island', rect(80, 80, 68, 30))], ownership = { island: 'A' }, labels = [name('A', 'COASTLAND', 6.5)];
  const engine = createEmpireLabelEngine(shapes), input = options(ownership, labels, CURVED_COAST);
  const first = engine.layout(input);
  assert.equal(first.length, 1);
  assert.strictEqual(engine.layout(input), first);
  const panned = engine.layout(options(ownership, labels, { ...CURVED_COAST, viewBox: { x: 12, y: 8, w: 940, h: 530 } }));
  assert.equal(panned.length, 1);
  for (const key of ['x', 'y', 'angle', 'curveRise']) assert.equal(panned[0][key], first[0][key], `small pan keeps ${key}`);
  const straight = engine.layout(options(ownership, labels, { ...CURVED_COAST, curveRatio: 0 }));
  assert.ok(straight.every(label => !label.curveRise), 'curve settings participate in the layout cache key');
  const tiny = createEmpireLabelEngine([shape('tiny', rect(80, 80, 20, 2))]);
  assert.deepEqual(tiny.layout(options({ tiny: 'A' }, labels, CURVED_COAST)), [], 'a token patch of land cannot anchor mostly-offshore text');
});

test('real British and Portuguese coastal labels remain safe around neighboring countries', () => {
  const { shapes } = atlas(), engine = createEmpireLabelEngine(shapes);
  const ownership = { '826': '826', '620': '620' };
  const labels = [name('826', 'ENGLAND', 5.1), name('620', 'PORTUGAL', 5.7)];
  // Portugal needs a closer view: its inland edge borders neutral Spain, so
  // readable placement cannot borrow that land as if it were open sea.
  const settings = options(ownership, labels, { ...CURVED_COAST, unitsPerPixel: .13 });
  const placed = engine.layout(settings);
  assert.equal(placed.length, 2, 'both countries can be named at a close inspection scale');
  for (const label of placed) {
    assert.ok(label.fontSize / settings.unitsPerPixel >= 11 - 1e-8);
    assertBoundedCoast(shapes, ownership, label, CURVED_COAST, settings.unitsPerPixel);
  }
});

test('arched coastal world layouts and repeated cached frames have bounded cost', t => {
  const { shapes } = atlas(), start = performance.now(), engine = createEmpireLabelEngine(shapes);
  const ownership = Object.fromEntries(shapes.map(s => [s.id, s.id]));
  const labels = shapes.map(s => name(s.id, NATIONS[s.id]?.[0]?.toUpperCase() || s.id, 6));
  const input = options(ownership, labels, CURVED_COAST), first = engine.layout(input);
  const cold = performance.now() - start;
  assert.ok(first.length > 5);
  assert.ok(cold < 5000, `curved/coastal world layout took ${cold.toFixed(0)} ms`);
  const warmAt = performance.now();
  for (let i = 0; i < 30; i++) assert.strictEqual(engine.layout(input), first);
  const warm = performance.now() - warmAt;
  assert.ok(warm < 1500, `30 cached curved/coastal frames took ${warm.toFixed(0)} ms`);
  t.diagnostic(`curved/coastal world layout ${cold.toFixed(0)} ms; 30 cached frames ${warm.toFixed(0)} ms`);
});
