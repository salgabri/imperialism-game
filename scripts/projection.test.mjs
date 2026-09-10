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
