// The flat campaign chart uses one affine equirectangular projection everywhere:
// 30° standard parallel, straight meridians, and an exact bounded inverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as geometry from '../src/engine/geo.js';
import { CAPITALS } from '../src/data/capitals.js';
import { NATIONS } from '../src/data/teams.js';

const radians = Math.PI / 180;
const xScale = Math.cos(Math.PI / 6);
const earthRadius = 6371.0088;
const expectedProjection = (lon, lat) => [lon * radians * xScale, -lat * radians];
const approximate = (actual, expected, message = '', tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual), `${message}: ${actual} must be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
};
const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
const atlas = load('world-110m.v1.json');
const worldIds = Object.keys(NATIONS);
const europeIds = [...Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id), '304'];
const fitted = ids => new geometry.WorldGeometry(atlas, CAPITALS).fitTo(ids);
const mapPoint = (fit, point) => [point[0] * fit.s + fit.tx, point[1] * fit.s + fit.ty];

test('forward projection is exactly equirectangular with the declared 30-degree standard parallel', () => {
  assert.equal(geometry.PROJECTION_X_SCALE, xScale);
  assert.equal(geometry.EARTH_RADIUS_KM, earthRadius);
  for (let lon = -180; lon <= 180; lon += 15) for (let lat = -90; lat <= 90; lat += 15) {
    const actual = geometry.projPt(lon, lat), expected = expectedProjection(lon, lat);
    approximate(actual[0], expected[0], `${lon},${lat}: x`, 1e-12);
    approximate(actual[1], expected[1], `${lon},${lat}: y`, 1e-12);
  }
});

test('meridians stay vertical and parallels stay horizontal over the entire world', () => {
  for (const lon of [-180, -130, -60, 0, 45, 90, 160, 180]) {
    const expectedX = expectedProjection(lon, 0)[0];
    for (let lat = -90; lat <= 90; lat += 5) approximate(geometry.projPt(lon, lat)[0], expectedX, `straight meridian ${lon}`, 1e-12);
  }
  for (const lat of [-90, -75, -30, 0, 45, 70, 90]) {
    const expectedY = expectedProjection(0, lat)[1];
    for (let lon = -180; lon <= 180; lon += 5) approximate(geometry.projPt(lon, lat)[1], expectedY, `straight parallel ${lat}`, 1e-12);
  }
  for (const lat of [-90, -45, 0, 45, 90]) {
    const left = geometry.projPt(-180, lat), right = geometry.projPt(180, lat);
    approximate(right[0] - left[0], 2 * Math.PI * xScale, 'chart width never tapers towards a pole');
  }
});

test('date-line and polar limits form finite rectangular corners without folding', () => {
  const corners = [[-180, 90], [180, 90], [180, -90], [-180, -90]].map(point => geometry.projPt(...point));
  assert.ok(corners.flat().every(Number.isFinite));
  approximate(corners[0][0], corners[3][0]);
  approximate(corners[1][0], corners[2][0]);
  approximate(corners[0][1], corners[1][1]);
  approximate(corners[2][1], corners[3][1]);
  assert.ok(corners[0][0] < 0 && corners[1][0] > 0, 'west and east remain distinct seam edges');
  assert.ok(corners[0][1] < 0 && corners[2][1] > 0, 'SVG north remains up');
  approximate(geometry.projPt(0, 0)[0], 0);
  approximate(geometry.projPt(0, 0)[1], 0);
});

test('inverse round trips world coordinates at world, continental and arbitrary affine fits', () => {
  const world = fitted(worldIds), europe = fitted(europeIds);
  const custom = new geometry.WorldGeometry(atlas, CAPITALS);
  custom.fit = { s: 17.25, tx: -1000.75, ty: 2000.125 };
  const samples = [[-180, -90], [-180, 90], [180, -90], [180, 90], [0, 0],
    [-179.999999, 66.5], [179.999999, -16.4], [-.12, 51.5], [139.69, 35.69], [37.62, 55.75]];
  for (let lon = -180; lon <= 180; lon += 20) for (let lat = -90; lat <= 90; lat += 10) samples.push([lon, lat]);
  for (const geo of [world, europe, custom]) for (const [lon, lat] of samples) {
    const actual = geo.invert(...mapPoint(geo.fit, expectedProjection(lon, lat)));
    assert.ok(actual, `${lon},${lat}: geographic point is inside the rectangular chart`);
    approximate(actual[0], lon, 'longitude survives inverse');
    approximate(actual[1], lat, 'latitude survives inverse');
  }
});

test('inverse rejects impossible hover coordinates but tolerates floating-point seam roundoff', () => {
  const unfit = new geometry.WorldGeometry(atlas, CAPITALS);
  assert.equal(unfit.invert(0, 0), null);
  for (const geo of [fitted(worldIds), fitted(europeIds)]) {
    for (const point of [[180.00001, 0], [-180.00001, 0], [0, 90.00001], [0, -90.00001], [300, 180]]) {
      assert.equal(geo.invert(...mapPoint(geo.fit, expectedProjection(...point))), null,
        `map margin at ${point} must not claim an impossible geographic location`);
    }
    for (const point of [[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity]]) assert.equal(geo.invert(...point), null);
    for (const [point, expected] of [[[180 + 1e-10, 0], [180, 0]], [[-180 - 1e-10, 0], [-180, 0]],
      [[0, 90 + 1e-10], [0, 90]], [[0, -90 - 1e-10], [0, -90]]]) {
      const actual = geo.invert(...mapPoint(geo.fit, expectedProjection(...point)));
      assert.ok(actual, 'machine-scale boundary overrun is clamped, not discarded');
      approximate(actual[0], expected[0]);
      approximate(actual[1], expected[1]);
    }
  }
});

test('SVG graticule uses the same straight projection and theatre fit as the countries', () => {
  for (const geo of [fitted(worldIds), fitted(europeIds)]) {
    const lines = geo.graticule.d.match(/M[^M]+/g).map(line => [...line.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map(([, x, y]) => [Number(x), Number(y)]));
    assert.equal(lines.length, 28, '19 meridians plus 9 parallels');
    for (let i = 0; i < 19; i++) {
      assert.equal(lines[i].length, 35);
      assert.equal(new Set(lines[i].map(point => point[0])).size, 1, 'meridian never bows sideways');
      lines[i].forEach((actual, j) => {
        const expected = mapPoint(geo.fit, expectedProjection(-180 + 20 * i, -85 + 5 * j));
        approximate(actual[0], expected[0], 'meridian x rounding', .0500001);
        approximate(actual[1], expected[1], 'meridian y rounding', .0500001);
      });
    }
    for (let i = 0; i < 9; i++) {
      const line = lines[i + 19];
      assert.equal(line.length, 73);
      assert.equal(new Set(line.map(point => point[1])).size, 1, 'parallel never bows vertically');
      line.forEach((actual, j) => {
        const expected = mapPoint(geo.fit, expectedProjection(-180 + 5 * j, -80 + 20 * i));
        approximate(actual[0], expected[0], 'parallel x rounding', .0500001);
        approximate(actual[1], expected[1], 'parallel y rounding', .0500001);
      });
    }
    for (const label of geo.graticule.labels) {
      const magnitude = Number(label.text.match(/^\d+/)[0]);
      const latitude = label.text.endsWith('S') ? -magnitude : magnitude;
      const [, y] = mapPoint(geo.fit, expectedProjection(0, latitude));
      approximate(Number(label.y), y, 'latitude label aligns to its graticule', .500001);
    }
  }
});

test('all capital markers and original geometry caches share the flat chart coordinates', () => {
  const geo = fitted(worldIds);
  for (const [id, capital] of Object.entries(geo.capitals)) {
    const expected = mapPoint(geo.fit, expectedProjection(...capital)), path = geo.paths[id];
    assert.equal(path.hasCapital, true);
    approximate(path.cx, expected[0], `${id}: capital x`);
    approximate(path.cy, expected[1], `${id}: capital y`);
    const actual = geo.invert(path.cx, path.cy);
    approximate(actual[0], capital[0]);
    approximate(actual[1], capital[1]);
  }
  for (const country of geo.countries) country.polys.forEach((polygon, pi) => polygon.forEach((ring, ri) => {
    // Include both source endpoints as well as interior vertices; no seam
    // normalization should leak backwards into the original geometry cache.
    for (const index of new Set([0, Math.floor(ring.length / 2), ring.length - 1])) {
      const expected = expectedProjection(...ring[index]);
      approximate(geo.projected[country.id][pi][ri][index][0], expected[0]);
      approximate(geo.projected[country.id][pi][ri][index][1], expected[1]);
    }
  }));
});

test('kilometres-per-unit is the exact equatorial horizontal reference for this projection', () => {
  for (const geo of [fitted(worldIds), fitted(europeIds)]) {
    approximate(geo.kmPerUnit, earthRadius / (geo.fit.s * xScale), 'reference scale', 1e-10);
    for (const degrees of [.1, 1, 20, 180]) {
      const start = mapPoint(geo.fit, expectedProjection(0, 0));
      const end = mapPoint(geo.fit, expectedProjection(degrees, 0));
      approximate((end[0] - start[0]) * geo.kmPerUnit, earthRadius * degrees * radians,
        'equatorial arc distance', 1e-8);
    }
  }
});

test('display rings share the projected points they repeat, and an atlas built only to draw can drop its polygons', () => {
  const detailed = load('countries-50m.json');
  const full = new geometry.WorldGeometry(detailed, CAPITALS);
  let shared = 0, total = 0, sameRing = 0, rings = 0;
  for (const country of full.countries) {
    const projected = new Set(full.projected[country.id].flat(2));
    for (const point of full.displayProjected[country.id].flat(3)) { total++; if (projected.has(point)) shared++; }
    const projectedRings = new Set(full.projected[country.id].flat());
    for (const parts of full.displayProjected[country.id].flat()) { rings++; if (parts.length === 1 && projectedRings.has(parts[0])) sameRing++; }
  }
  // A ring clear of the date line is its own display part, the very array projected (about 99.95% of the points).
  assert.ok(shared / total > .99, `${shared} of ${total} display points reuse their projected arrays`);
  assert.ok(sameRing / rings > .99, `${sameRing} of ${rings} display rings are their projected ring`);
  // A seam-split ring (Russia, Fiji) still gets its own points where the cut adds them.
  assert.ok(shared < total);
  const lean = new geometry.WorldGeometry(detailed, CAPITALS, { keepPolys: false });
  assert.ok(lean.countries.every(country => country.polys === null), 'the lon/lat polygons are released');
  assert.ok(full.countries.every(country => Array.isArray(country.polys)), 'by default they stay');
  assert.deepEqual(lean.capitals, full.capitals);
  assert.equal(JSON.stringify(lean.buildPaths(1.3, 10, 5)), JSON.stringify(full.buildPaths(1.3, 10, 5)), 'drawn paths are unchanged');
  // Without border lengths (the display atlas and a country map's surroundings) nothing is measured, and the land
  // borders stay: a Europe map's claimable land is joined across them (domestic.js atlasNeighbours).
  const drawn = new geometry.WorldGeometry(detailed, CAPITALS, { keepPolys: false, borderLengths: false });
  const adjacency = geo => JSON.stringify(Object.entries(geo.adj).map(([id, set]) => [id, [...set]]));
  assert.equal(adjacency(drawn), adjacency(full));
  assert.ok(drawn.adj['040'].has('276'), 'Austria borders Germany');
  assert.equal(JSON.stringify([drawn.borders, drawn.edges]), '[{},{}]');
  assert.ok(full.borders['040'].get('276') > 0, 'the default still measures them');
  assert.equal(JSON.stringify(drawn.buildPaths(1.3, 10, 5)), JSON.stringify(full.buildPaths(1.3, 10, 5)), 'and draws the same');
});

test('fitTo on the frame it already holds keeps its paths; another frame builds them again, the same as a first fit', () => {
  const geo = fitted(europeIds);
  const { paths, graticule, fit, kmPerUnit } = geo;
  assert.equal(geo.fitTo([...europeIds].reverse()), geo);
  assert.ok(geo.paths === paths && geo.graticule === graticule && geo.fit === fit, 'the same frame keeps every object');
  assert.equal(geo.kmPerUnit, kmPerUnit);
  geo.fitTo(worldIds);
  assert.notEqual(geo.paths, paths);
  const fresh = fitted(worldIds);
  assert.equal(JSON.stringify([geo.paths, geo.graticule, geo.fit]), JSON.stringify([fresh.paths, fresh.graticule, fresh.fit]),
    'the same as a first fit');
  geo.fitTo(europeIds);
  assert.notEqual(geo.paths, paths, 'only the frame last built is kept');
  assert.equal(JSON.stringify([geo.paths, geo.graticule, geo.fit, geo.kmPerUnit]), JSON.stringify([paths, graticule, fit, kmPerUnit]));
});


// Lon/lat rings, each a one-arc polygon of its own in an unquantized topology.
const ringTopology = rings => ({ type: 'Topology', arcs: Object.values(rings), objects: { countries: { type: 'GeometryCollection',
  geometries: Object.keys(rings).map((id, index) => ({ type: 'Polygon', id, arcs: [[index]] })) } } });

test('a ring the date-line cut would change still takes the cut; any other ring is its own display part', () => {
  // The shipped atlases have no ring on these edges, so the display rings (geo.js seamFreeRing) are pinned here against
  // splitAtAntimeridian itself: on the seam or within its epsilon (1e-8), a repeated point, no area, a latitude past the
  // pole, a closing -0 for a first 0, an edge over 180° of longitude, an open, empty or one-point ring.
  const near = 180 - 5e-9;
  const rings = {
    plain: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    clearOfSeam: [[179.99, 0], [179.99, 10], [170, 10], [170, 0], [179.99, 0]],
    farSide: [[-80, 0], [-70, 0], [-70, 10], [-80, 10], [-80, 0]],
    crossing: [[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]],
    onSeam: [[180, 0], [170, 0], [170, 10], [180, 10], [180, 0]],
    withinEpsilon: [[near, 0], [170, 0], [170, 10], [near, 10], [near, 0]],
    westWithinEpsilon: [[-near, 0], [-near, 10], [-170, 10], [-170, 0], [-near, 0]],
    repeated: [[0, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    nearlyRepeated: [[0, 0], [10, 0], [10 + 5e-9, 5e-9], [10, 10], [0, 10], [0, 0]],
    flat: [[0, 0], [5, 0], [10, 0], [0, 0]],
    speck: [[0, 0], [1e-7, 0], [1e-7, 1e-7], [0, 0]],
    pastPole: [[0, 80], [10, 80], [10, 91], [0, 91], [0, 80]],
    negativeZero: [[-0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    longEdge: [[-90, 0], [90.000001, 0], [90.000001, 10], [-90, 10], [-90, 0]],
    open: [[0, 0], [10, 0], [10, 10], [0, 10]],
    point: [[5, 5]],
    empty: [],
  };
  const wrap = lon => (lon < -180 || lon > 180 ? ((lon + 180) % 360 + 360) % 360 - 180 : lon);
  // The world chart, and a chart whose seam runs through -80° (farSide is on it there).
  for (const projection of [undefined, { lon0: 100, lat0: 45 }]) {
    const geo = new geometry.WorldGeometry(ringTopology(rings), {}, { projection });
    const rotate = projection ? ([lon, lat]) => [wrap(lon - projection.lon0), lat] : point => point;
    const plane = projection ? ([lon, lat]) => [(lon * Math.PI / 180) * geo.xScale, -lat * Math.PI / 180]
      : ([lon, lat]) => geometry.projPt(lon, lat);
    for (const [id, ring] of Object.entries(rings)) {
      // deepEqual is strict: Object.is on every number, so -0 and 0 differ.
      assert.deepEqual(geo.displayProjected[id][0][0], geometry.splitAtAntimeridian(ring.map(rotate)).map(part => part.map(plane)),
        `${id}${projection ? ' at 100°E' : ''}`);
    }
    assert.equal(geo.displayProjected.plain[0][0][0], geo.projected.plain[0][0], 'a plain ring is its own display part');
  }
});

test('buildPaths writes each fitted coordinate as toFixed(1) does, and its label rings read that text back', () => {
  const square = new geometry.WorldGeometry(ringTopology({ square: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] }));
  const world = new geometry.WorldGeometry(atlas, CAPITALS);
  // With s = 0 every point is (tx, ty): halves, small negatives ("-0.0"), -0, decimals just above a half whose product
  // with 10 is one (0.45, 2.45), and values toFixed must format itself (from 1e5 up, and exponent text from 1e21).
  const frames = [0, -0, 0.04, -0.04, 0.05, -0.05, 0.15, 0.25, -0.25, 0.45, -0.45, 2.45, -2.45, 99999.95, -99999.95,
    123456.75, 1e15 + 0.25, 1e21, -1e21].map(t => [0, t, -t]);
  frames.push([153.7, 480.05, 270.15], [2.5, -2e5, 3e5], [1e-3, 0.05, -0.05]);
  for (const geo of [square, world]) {
    for (const [s, tx, ty] of frames) {
      const paths = geo.buildPaths(s, tx, ty);
      for (const { id } of geo.countries) {
        let d = '';
        const rings = [];
        for (const poly of geo.displayProjected[id]) for (const parts of poly) for (const part of parts) {
          if (part.length < 3) continue;
          const text = part.map(q => [(q[0] * s + tx).toFixed(1), (q[1] * s + ty).toFixed(1)]);
          d += 'M' + text.map(point => point.join(',')).join('L') + 'Z';
          rings.push(text.map(([x, y]) => [Number(x), Number(y)]));
        }
        assert.equal(paths[id].d, d, `${id} at ${[s, tx, ty]}`);
        assert.deepEqual(paths[id].labelRings, rings, `${id} at ${[s, tx, ty]}`);
      }
    }
  }
});
