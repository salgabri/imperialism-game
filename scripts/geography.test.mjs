// Independent shape-preservation checks for geographic antimeridian clipping.
// These compare actual painted land to decoded source polygons, not just bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as geometry from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';
import { CAPITALS } from '../src/data/capitals.js';

const FILES = ['countries-50m.json', 'world-110m.v1.json'];
const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
const cache = new Map();
const topologies = file => { if (!cache.has(file)) cache.set(file, load(file)); return cache.get(file); };
const close = points => [...points.map(p => [...p]), [...points[0]]];
const signedArea = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

// Decode only the requested original geometry, separately from WorldGeometry.
function sourceCountry(topo, id) {
  const country = topo.objects.countries.geometries.find(g => String(g.id) === id);
  assert.ok(country, `source country ${id} exists`);
  const arc = index => {
    let x = 0, y = 0;
    const points = topo.arcs[index < 0 ? ~index : index].map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]];
    });
    return index < 0 ? points.reverse() : points;
  };
  const ring = arcs => arcs.flatMap((index, i) => arc(index).slice(i ? 1 : 0));
  return (country.type === 'Polygon' ? [country.arcs] : country.arcs).map(poly => poly.map(ring));
}

function unwrap(ring) {
  const output = [[...ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    let x = ring[i][0];
    while (x - output[i - 1][0] > 180) x -= 360;
    while (x - output[i - 1][0] < -180) x += 360;
    output.push([x, ring[i][1]]);
  }
  return output;
}

function winding(ring, [x, y]) {
  let count = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (a[1] <= y && b[1] > y && cross > 0) count++;
    if (a[1] > y && b[1] <= y && cross < 0) count--;
  }
  return count;
}
const painted = (rings, p) => rings.reduce((sum, r) => sum + winding(r, p), 0) !== 0;

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function sourceOracle(polys) {
  const prepared = polys.map(poly => poly.map(raw => {
    const ring = unwrap(raw);
    const center = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    return { ring, center };
  }));
  const local = (r, [x, y]) => [x + 360 * Math.round((r.center - x) / 360), y];
  return {
    contains: point => prepared.some(poly => poly.reduce((sum, r) => sum + winding(r.ring, local(r, point)), 0) !== 0),
    coastDistance: point => {
      let min = Infinity;
      for (const poly of prepared) for (const r of poly) {
        const p = local(r, point);
        for (let i = 0; i < r.ring.length; i++) min = Math.min(min, pointSegmentDistance(p, r.ring[i], r.ring[(i + 1) % r.ring.length]));
      }
      return min;
    },
  };
}

function europeFit() {
  const ids = [...Object.entries(NATIONS).filter(([, n]) => n[2] === 'UEFA').map(([id]) => id), '304'];
  return new geometry.WorldGeometry(topologies('world-110m.v1.json')).fitTo(ids).fit;
}
function renderedAt(path, fit, point) {
  const p = geometry.projPt(...point);
  return painted(path.labelRings, [p[0] * fit.s + fit.tx, p[1] * fit.s + fit.ty]);
}

test('real Russia retains Kamchatka, Khabarovsk, Magadan, and both sides of Chukotka', () => {
  const places = [
    ['northern Kamchatka', [160, 59]], ['Khabarovsk hinterland', [136.3, 49.8]],
    ['Magadan hinterland', [153.4, 61.3]], ['western Chukotka', [174, 64]],
    ['eastern Chukotka', [-175, 66.5]], ['Yakutia', [138, 66]],
  ];
  const fit = europeFit();
  for (const file of FILES) {
    const topo = topologies(file), oracle = sourceOracle(sourceCountry(topo, '643'));
    const path = new geometry.WorldGeometry(topo).buildPaths(fit.s, fit.tx, fit.ty)['643'];
    for (const [place, point] of places) {
      assert.equal(oracle.contains(point), true, `${file}: ${place} is land in the original source`);
      assert.equal(renderedAt(path, fit, point), true, `${file}: a closure diagonal must not cut away ${place}`);
    }
  }
});

test('closing Russian seam pieces never paints triangular land over the Sea of Okhotsk', () => {
  const ocean = [[147, 52], [149, 53], [151, 54]];
  const fit = europeFit();
  for (const file of FILES) {
    const topo = topologies(file), oracle = sourceOracle(sourceCountry(topo, '643'));
    const path = new geometry.WorldGeometry(topo).buildPaths(fit.s, fit.tx, fit.ty)['643'];
    for (const point of ocean) {
      assert.equal(oracle.contains(point), false, `${file}: ${point} is water in the source`);
      assert.equal(renderedAt(path, fit, point), false, `${file}: seam closure invented land at ${point}`);
    }
  }
});

function compareGrid(topo, id, path, fit, longitudes, latitudes, margin = .35) {
  const oracle = sourceOracle(sourceCountry(topo, id));
  let checked = 0, land = 0, water = 0;
  const mismatches = [];
  for (const lon of longitudes) for (const lat of latitudes) {
    const point = [lon, lat];
    // Exclude real coastline generalisation/0.1-unit SVG rounding; closure
    // triangles extend far inland/offshore and must never get this allowance.
    if (oracle.coastDistance(point) < margin) continue;
    const expected = oracle.contains(point), actual = renderedAt(path, fit, point);
    checked++; if (expected) land++; else water++;
    if (actual !== expected) mismatches.push({ point, expected, actual });
  }
  assert.ok(checked > 20 && land > 1 && water > 1, `grid samples both land and sea (${checked}/${land}/${water})`);
  assert.deepEqual(mismatches, [], `source/paint disagreement for ${id}: ${JSON.stringify(mismatches.slice(0, 8))}`);
}
const sequence = (start, end, step) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => start + i * step);

test('dense independent Far East land/ocean coverage matches both source atlases', () => {
  const fit = europeFit();
  for (const file of FILES) {
    const topo = topologies(file), path = new geometry.WorldGeometry(topo).buildPaths(fit.s, fit.tx, fit.ty)['643'];
    compareGrid(topo, '643', path, fit, [...sequence(115, 179, 2), ...sequence(-179, -169, 2)], sequence(43, 75, 2));
  }
});

test('rendered source coverage is invariant to theatre fit and arbitrary projection scaling', () => {
  for (const file of FILES) {
    const topo = topologies(file), geo = new geometry.WorldGeometry(topo);
    const world = geo.fitTo(Object.keys(NATIONS)).fit;
    const base = europeFit();
    const fits = [world, base, { s: base.s * .4, tx: -57, ty: 92 }, { s: base.s * 4, tx: 17, ty: -31 }];
    for (const fit of fits) {
      const path = geo.buildPaths(fit.s, fit.tx, fit.ty)['643'];
      compareGrid(topo, '643', path, fit, [...sequence(130, 178, 4), -178, -174], sequence(46, 74, 4), .5);
    }
  }
});

test('Fiji and Alaska keep their land and surrounding ocean on either side of the date line', () => {
  const fit = europeFit();
  for (const file of FILES) {
    const topo = topologies(file), geo = new geometry.WorldGeometry(topo), paths = geo.buildPaths(fit.s, fit.tx, fit.ty);
    compareGrid(topo, '840', paths['840'], fit, sequence(-178, -130, 2), sequence(52, 72, 2));
    compareGrid(topo, '242', paths['242'], fit, [...sequence(176, 179.6, .4), ...sequence(-179.8, -178.2, .4)], sequence(-19, -15, .4), .14);
  }
});

function split(ring) {
  assert.equal(typeof geometry.splitAtAntimeridian, 'function', 'geographic seam helper is available for isolated regression tests');
  return geometry.splitAtAntimeridian(ring);
}
function assertClosed(rings) {
  assert.ok(rings.length > 0);
  for (const ring of rings) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1), 'every returned piece is explicitly closed');
    for (const [x, y] of ring) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= -180 - 1e-8 && x <= 180 + 1e-8);
      assert.ok(y >= -90 - 1e-8 && y <= 90 + 1e-8);
    }
  }
}

test('cyclic ring-start rotation preserves a seam-crossing polygon, without closure triangles', () => {
  const vertices = [[170, 50], [-175, 52], [-168, 60], [175, 65]];
  const original = close(vertices), oracle = sourceOracle([[original]]);
  const expectedArea = signedArea(unwrap(original));
  for (let start = 0; start < vertices.length; start++) {
    const rotated = close([...vertices.slice(start), ...vertices.slice(0, start)]);
    const snapshot = JSON.stringify(rotated), pieces = split(rotated);
    assert.equal(JSON.stringify(rotated), snapshot, 'clipping never rewrites source vertices');
    assertClosed(pieces);
    assert.ok(Math.abs(pieces.reduce((sum, r) => sum + signedArea(r), 0) - expectedArea) < 1e-6, 'signed area/winding is preserved');
    for (const lon of [...sequence(165, 179, 1), ...sequence(-179, -161, 1)]) for (const lat of sequence(47, 68, 1)) {
      const point = [lon, lat];
      if (oracle.coastDistance(point) < .05) continue;
      assert.equal(painted(pieces, point), oracle.contains(point), `rotation ${start} changed polygon coverage at ${point}`);
    }
  }
});

test('seam-crossing holes preserve nonzero winding on both sides of the map', () => {
  const outer = close([[170, 10], [-170, 10], [-170, 30], [170, 30]]);
  const hole = close([[174, 15], [-174, 15], [-174, 25], [174, 25]]).reverse();
  const rings = [...split(outer), ...split(hole)];
  assertClosed(rings);
  for (const [point, expected] of [
    [[172, 20], true], [[-172, 20], true], [[179, 20], false], [[-179, 20], false],
    [[179, 12], true], [[-179, 28], true], [[160, 20], false], [[179, 35], false],
  ]) assert.equal(painted(rings, point), expected, `hole coverage at ${point}`);
  const areaBefore = signedArea(unwrap(outer)) + signedArea(unwrap(hole));
  assert.ok(Math.abs(rings.reduce((sum, r) => sum + signedArea(r), 0) - areaBefore) < 1e-6);
});

test('northern and southern polar loops preserve cap coverage under rotation and reversed winding', () => {
  const longitudes = [-179, -120, -60, 0, 60, 120, 179];
  for (const hemisphere of [-1, 1]) for (const seamVertex of [false, true]) {
    const vertices = (seamVertex ? [-180, -90, 0, 90] : [-170, -80, 10, 100]).map(lon => [lon, hemisphere * 70]);
    for (const direction of [-1, 1]) for (let start = 0; start < vertices.length; start++) {
      const ordered = direction === 1 ? vertices : [...vertices].reverse();
      const ring = close([...ordered.slice(start), ...ordered.slice(0, start)]);
      const snapshot = JSON.stringify(ring), pieces = split(ring);
      assertClosed(pieces);
      assert.equal(JSON.stringify(ring), snapshot);
      const signed = pieces.reduce((sum, piece) => sum + signedArea(piece), 0);
      assert.ok(Math.abs(signed - hemisphere * direction * 360 * 20) < 1e-6,
        'the polar cap has the expected area and retains its winding sign');
      for (const lon of longitudes) {
        assert.equal(painted(pieces, [lon, hemisphere * 80]), true, 'the cap covers every longitude toward its pole');
        assert.equal(painted(pieces, [lon, hemisphere * 89]), true, 'no interior-meridian triangular notch reaches the pole');
        assert.equal(painted(pieces, [lon, hemisphere * 60]), false, 'the cap does not leak equatorward');
        assert.equal(painted(pieces, [lon, -hemisphere * 80]), false, 'the opposite pole is never filled');
      }
    }
  }
});

test('oppositely wound polar rings retain an annular hole instead of painting the whole cap', () => {
  for (const hemisphere of [-1, 1]) {
    const outer = close([-170, -80, 10, 100].map(lon => [lon, hemisphere * 60]));
    const hole = close([-170, -80, 10, 100].map(lon => [lon, hemisphere * 75])).reverse();
    const pieces = [...split(outer), ...split(hole)];
    assertClosed(pieces);
    const signed = pieces.reduce((sum, piece) => sum + signedArea(piece), 0);
    assert.ok(Math.abs(signed - hemisphere * 360 * 15) < 1e-6);
    for (const lon of [-179, -90, 0, 90, 179]) {
      assert.equal(painted(pieces, [lon, hemisphere * 68]), true, 'the annular land remains filled');
      assert.equal(painted(pieces, [lon, hemisphere * 85]), false, 'opposite winding cancels the polar hole');
      assert.equal(painted(pieces, [lon, hemisphere * 50]), false);
    }
  }
});

test('real Antarctica retains its polar interior and coastline coverage when source ring starts rotate', () => {
  const fit = europeFit();
  for (const file of FILES) {
    const topo = topologies(file), source = sourceCountry(topo, '010');
    const baseline = new geometry.WorldGeometry(topo).buildPaths(fit.s, fit.tx, fit.ty)['010'];
    for (const lon of [-179, -120, -60, 0, 60, 120, 179]) {
      assert.equal(renderedAt(baseline, fit, [lon, -89]), true, `${file}: polar interior remains land at ${lon}`);
      assert.equal(renderedAt(baseline, fit, [lon, -50]), false, `${file}: Southern Ocean is not filled`);
      assert.equal(renderedAt(baseline, fit, [lon, 80]), false, `${file}: no northern-hemisphere fill`);
    }
    const rotatedRings = source.flatMap(poly => poly.flatMap(raw => {
      const sameEnds = raw[0][0] === raw.at(-1)[0] && raw[0][1] === raw.at(-1)[1];
      const vertices = sameEnds ? raw.slice(0, -1) : raw;
      const start = Math.floor(vertices.length / 3);
      return split(close([...vertices.slice(start), ...vertices.slice(0, start)]));
    })).map(ring => ring.map(p => {
      const q = geometry.projPt(...p);
      return [Number((q[0] * fit.s + fit.tx).toFixed(1)), Number((q[1] * fit.s + fit.ty).toFixed(1))];
    }));
    for (const lon of sequence(-175, 175, 35)) for (const lat of [-89, -85, -80, -75, -70, -60, -50]) {
      const q = geometry.projPt(lon, lat);
      assert.equal(painted(rotatedRings, [q[0] * fit.s + fit.tx, q[1] * fit.s + fit.ty]), renderedAt(baseline, fit, [lon, lat]),
        `${file}: rotating an Antarctic source ring changes its coast or polar fill at ${lon},${lat}`);
    }
  }
});

function sourceNeighbors(topo, id) {
  const geometries = topo.objects.countries.geometries;
  const arcs = g => new Set(g.arcs.flat(Infinity).map(i => i < 0 ? ~i : i));
  const wanted = arcs(geometries.find(g => String(g.id) === id));
  return geometries.filter(g => String(g.id) !== id && [...arcs(g)].some(a => wanted.has(a))).map(g => String(g.id)).sort();
}
const adjacency = geo => Object.fromEntries(Object.entries(geo.adj).map(([id, set]) => [id, [...set].sort()]));

test('display clipping leaves original topology, decoded source, rule adjacency and capitals unchanged', () => {
  for (const file of FILES) {
    const topo = load(file), snapshot = JSON.stringify(topo), suppliedCapitals = { '643': [37.62, 55.75] };
    const geo = new geometry.WorldGeometry(topo, suppliedCapitals);
    const raw = JSON.stringify(geo.countries), projected = JSON.stringify(geo.projected);
    const adj = adjacency(geo), capitals = JSON.stringify(geo.capitals);
    assert.deepEqual([...geo.adj['643']].sort(), sourceNeighbors(topo, '643'), 'rule neighbours come from original shared arcs');
    geo.fitTo(Object.keys(NATIONS));
    const base = europeFit();
    geo.buildPaths(base.s * 4, base.tx, base.ty);
    assert.equal(JSON.stringify(topo), snapshot);
    assert.equal(JSON.stringify(geo.countries), raw);
    assert.equal(JSON.stringify(geo.projected), projected);
    assert.deepEqual(adjacency(geo), adj);
    assert.equal(JSON.stringify(geo.capitals), capitals);
    assert.deepEqual(suppliedCapitals, { '643': [37.62, 55.75] });
  }
});

test('flattening the map preserves geographic capital anchors and projects them consistently at every fit', () => {
  // Captured before the deliberate Robinson -> flat projection change. Pin
  // lon/lat anchors rather than obsolete Robinson-specific pixel/area hashes:
  // projection changes coordinates, never which geographic capital was chosen.
  const expected = {
    'countries-50m.json': '0d0afa02b9e98502bbce7e94306a3039848b3e162c8bf6d72752da9731873e56',
    'world-110m.v1.json': '39657f15e99193d2aa1dc8df40e7124b7816d5a9a4b7dcedade66a4159590113',
  };
  const fits = {
    world: new geometry.WorldGeometry(topologies('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS)).fit,
    europe: europeFit(),
  };
  for (const file of FILES) {
    const geo = new geometry.WorldGeometry(topologies(file), CAPITALS);
    const capitals = Object.entries(geo.capitals).sort(([a], [b]) => a.localeCompare(b));
    assert.equal(createHash('sha256').update(JSON.stringify(capitals)).digest('hex'), expected[file],
      `${file}: projection must not move the underlying geographic anchor or change the chosen capital`);
    const before = JSON.stringify({ capitals: geo.capitals, projected: geo.projected, countries: geo.countries });
    for (const [name, fit] of Object.entries(fits)) {
      const paths = geo.buildPaths(fit.s, fit.tx, fit.ty);
      for (const [id, path] of Object.entries(paths)) {
        assert.ok([path.area, path.cx, path.cy, path.labelX, path.labelY].every(Number.isFinite), `${file}/${name}/${id}: finite metadata`);
        assert.ok(path.area > 0, `${file}/${name}/${id}: nonempty country has positive anchor area`);
        assert.equal(path.hasCapital, !!geo.capitals[id]);
        const capital = geo.capitals[id];
        if (!capital) continue;
        const projected = geometry.projPt(...capital);
        assert.ok(Math.abs(path.cx - (projected[0] * fit.s + fit.tx)) < 1e-8, `${file}/${name}/${id}: capital x`);
        assert.ok(Math.abs(path.cy - (projected[1] * fit.s + fit.ty)) < 1e-8, `${file}/${name}/${id}: capital y`);
      }
      assert.equal(JSON.stringify({ capitals: geo.capitals, projected: geo.projected, countries: geo.countries }), before,
        'building a theatre cannot mutate geographic anchors or source geometry');
    }
  }
});
