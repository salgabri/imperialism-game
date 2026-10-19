// Country-scale section geometry (custom projection) and the domestic loader.
// Topologies are synthetic and built the way the domestic build ships them:
// topojson-server shared arcs, then topojson-client quantize at 1e5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { topology } from 'topojson-server';
import { quantize } from 'topojson-client';
import { WorldGeometry, projPt, EARTH_RADIUS_KM, PROJECTION_X_SCALE, niceDistance } from '../src/engine/geo.js';
import {
  loadDomestic, decodeDomestic, clearDomesticCache, getLoadedDomestic,
  DOMESTIC_PREFIX, isDomesticScope, domesticScopeId, domesticScope,
} from '../src/engine/domestic.js';
import { buildClub, NATIONS } from '../src/data/teams.js';
import { CAPITALS } from '../src/data/capitals.js';
import { getSport } from '../src/sports/index.js';
import { FM_CONVERSION, fmGameRating } from '../src/data/fmPlayers.js';

const RAD = Math.PI / 180;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const feature = (id, rings, name = id) => ({ type: 'Feature', id, properties: { name }, geometry: { type: 'Polygon', coordinates: rings } });
const build = (features, name = 'sections') => quantize(topology({ [name]: { type: 'FeatureCollection', features } }), 1e5);
const sorted = set => [...(set || [])].sort();

/** Independent even-odd oracle over the painted (fitted, rounded) rings. */
function inside([px, py], rings) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
const fitted = (geo, lon, lat) => { const [x, y] = geo.project(lon, lat); return [x * geo.fit.s + geo.fit.tx, y * geo.fit.s + geo.fit.ty]; };
const graticuleLines = d => (d.match(/M[^M]+/g) || []).map(line => [...line.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]));

// 3x3 grid of 1° cells, lon 10–13, lat 45–48, ids 999-001..009 row-major from the south-west.
const GRID = { lon0: 11.5, lat0: 46.5 };
const gridId = (r, c) => `999-${String(r * 3 + c + 1).padStart(3, '0')}`;
const gridFeatures = () => {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(feature(gridId(r, c), [rect(10 + c, 45 + r, 11 + c, 46 + r)], `Unit ${r * 3 + c + 1}`));
  return out;
};
const gridTopo = () => build(gridFeatures());

test('(a) a quantized 3x3 grid decodes with exact adjacency, names, interior anchors and positive area', () => {
  const geo = new WorldGeometry(gridTopo(), {}, { object: 'sections', projection: GRID });
  const ids = geo.countries.map(c => c.id);
  assert.deepEqual(ids, gridFeatures().map(f => f.id));
  assert.deepEqual(geo.countries.map(c => c.name), gridFeatures().map(f => f.properties.name));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const expected = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([rr, cc]) => rr >= 0 && rr < 3 && cc >= 0 && cc < 3).map(([rr, cc]) => gridId(rr, cc)).sort();
    assert.deepEqual(sorted(geo.adj[gridId(r, c)]), expected, `${gridId(r, c)}: edge neighbours only, never corners`);
  }
  geo.fitTo(ids);
  for (const id of ids) {
    const p = geo.paths[id];
    assert.ok(Number.isFinite(p.cx) && Number.isFinite(p.cy), `${id}: finite anchor`);
    assert.ok(p.area > 0, `${id}: positive area`);
    assert.equal(p.labelRings.length, 1, `${id}: one painted ring`);
    assert.ok(inside([p.cx, p.cy], p.labelRings), `${id}: anchor inside its section`);
    assert.equal(p.hasCapital, false);
  }
  // A 1°x1° cell at 46.5° is cos(lat0) wide relative to its height, in true proportion.
  const centre = geo.paths[gridId(1, 1)];
  const cellArea = (1 * RAD * Math.cos(46.5 * RAD)) * (1 * RAD) * geo.fit.s ** 2;
  assert.ok(Math.abs(centre.area / cellArea - 1) < 1e-3, `centre cell area ${centre.area} ~ ${cellArea}`);
});

test('(b) a very wide single section keeps a real area and an interior anchor at country scale', () => {
  const topo = build([feature('998-001', [rect(0, 50, 20, 50.5)])]);
  const geo = new WorldGeometry(topo, {}, { object: 'sections', projection: { lon0: 10, lat0: 50.25 } }).fitTo(['998-001']);
  const p = geo.paths['998-001'];
  const width = p.fullBounds.w;
  assert.ok(width > 900, `section spans the frame (${width} units), wider than the 300-unit world date-line guess`);
  const expected = (20 * RAD * Math.cos(50.25 * RAD)) * (0.5 * RAD) * geo.fit.s ** 2;
  assert.ok(Math.abs(p.area / expected - 1) < 0.01, `area ${p.area} ~ ${expected}`);
  assert.ok(inside([p.cx, p.cy], p.labelRings), 'anchor inside the strip');
  assert.ok(Math.abs(p.cx - 480) < 5, `anchor near the middle, not at the first vertex (${p.cx})`);
});

test('concave and holed sections anchor inside themselves, not at an outside centroid', () => {
  // A "C" opening east: its area centroid (≈21.65, 41.5) falls in the notch.
  const c = [[20, 40], [24, 40], [24, 40.5], [20.5, 40.5], [20.5, 42.5], [24, 42.5], [24, 43], [20, 43], [20, 40]];
  // A ring-shaped section around a city section; the ring's centroid is the city.
  const donut = [rect(30, 40, 33, 43), rect(31, 41, 32, 42).reverse()];
  const topo = build([feature('997-001', [c]), feature('997-002', donut), feature('997-003', [rect(31, 41, 32, 42)])]);
  const options = { object: 'sections', projection: { lon0: 26.5, lat0: 41.5 } };
  const ids = ['997-001', '997-002', '997-003'];
  const plain = new WorldGeometry(topo, {}, options).fitTo(ids);
  for (const id of ids) assert.ok(inside([plain.paths[id].cx, plain.paths[id].cy], plain.paths[id].labelRings), `${id}: anchor inside`);
  const [nx, ny] = fitted(plain, 21.65, 41.5);
  assert.equal(inside([nx, ny], plain.paths['997-001'].labelRings), false, 'fixture: the C centroid really is outside');
  assert.deepEqual(sorted(plain.adj['997-002']), ['997-003'], 'the ring borders the city it surrounds');
  assert.ok(Math.abs(plain.paths['997-002'].area / plain.paths['997-003'].area - 8) < 0.01, 'ring area excludes its hole');

  // Anchors in the notch and in the hole are rejected or nudged, never kept outside.
  const anchors = { '997-001': [22.5, 41.5], '997-002': [31.5, 41.5], '997-003': [31.5, 41.5] };
  const anchored = new WorldGeometry(topo, anchors, options).fitTo(ids);
  for (const id of ids) {
    const p = anchored.paths[id];
    assert.ok(inside([p.cx, p.cy], p.labelRings), `${id}: anchored point stays inside`);
  }
  assert.deepEqual(anchored.capitals['997-003'], [31.5, 41.5], 'a home inside its section is kept exactly');
  const city = anchored.paths['997-003'], [hx, hy] = fitted(anchored, 31.5, 41.5);
  assert.ok(Math.abs(city.cx - hx) < 1e-9 && Math.abs(city.cy - hy) < 1e-9);
  assert.equal(anchored.capitals['997-002'], undefined, 'a home in the hole is not the ring section\'s anchor');
});

test('(c) an antimeridian country stays contiguous with a rotated central meridian', () => {
  // Longitudes shifted at build time: 178E..178W is stored as 178..182.
  const cells = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) cells.push(feature(`242-00${r * 2 + c + 1}`, [rect(178 + 2 * c, -18 + r, 180 + 2 * c, -17 + r)]));
  const ids = cells.map(f => f.id);
  const geo = new WorldGeometry(build(cells), {}, { object: 'sections', projection: { lon0: 180, lat0: -17 } }).fitTo(ids);
  assert.deepEqual(sorted(geo.adj['242-001']), ['242-002', '242-003'], 'adjacent across the 180° seam');
  assert.deepEqual(sorted(geo.adj['242-004']), ['242-002', '242-003']);
  let minX = Infinity, maxX = -Infinity;
  for (const id of ids) {
    const p = geo.paths[id];
    assert.equal(p.labelRings.length, 1, `${id}: not cut at the date line`);
    assert.ok(p.area > 0 && inside([p.cx, p.cy], p.labelRings), `${id}: area and interior anchor`);
    minX = Math.min(minX, p.fullBounds.x);
    maxX = Math.max(maxX, p.fullBounds.x + p.fullBounds.w);
  }
  assert.ok(minX > 0 && maxX < 960 && maxX - minX > 400, `fit frames the country (${minX}..${maxX}), not the world`);
  const worldWidth = 2 * Math.PI * geo.xScale * geo.fit.s;
  assert.ok(worldWidth > 50 * 960, 'the fit is local');
  // A home town given as -179° anchors a section stored at 180°..182°.
  const homed = new WorldGeometry(build(cells), { '242-002': [-179, -17.5], '242-001': [178.5, -17.5] },
    { object: 'sections', projection: { lon0: 180, lat0: -17 } }).fitTo(ids);
  for (const id of ['242-001', '242-002']) {
    assert.equal(homed.paths[id].hasCapital, true, `${id}: home accepted`);
    assert.ok(inside([homed.paths[id].cx, homed.paths[id].cy], homed.paths[id].labelRings));
  }

  // The same country stored with wrapped longitudes renders the same way.
  const wrapped = cells.map(f => feature(f.id, f.geometry.coordinates.map(ring => ring.map(([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat]))));
  const geo2 = new WorldGeometry(build(wrapped), {}, { object: 'sections', projection: { lon0: 180, lat0: -17 } }).fitTo(ids);
  for (const id of ids) assert.equal(geo2.paths[id].labelRings.length, 1, `${id}: wrapped input is not cut either`);
  assert.ok(Math.abs(geo2.fit.s / geo.fit.s - 1) < 1e-3, 'same local fit');
});

test('(d)(e) high latitude keeps true proportions and true scale', () => {
  const dLat = 1 / (EARTH_RADIUS_KM * RAD); // 1 km north
  const dLon = dLat / Math.cos(65 * RAD); // 1 km east at 65°N
  const topo = build([
    feature('578-001', [rect(20, 60, 24, 70)]),
    feature('578-002', [rect(25, 65, 25 + dLon, 65 + dLat)]),
  ]);
  const geo = new WorldGeometry(topo, {}, { object: 'sections', projection: { lon0: 22, lat0: 65 } }).fitTo(['578-002']);
  const box = geo.paths['578-002'].fullBounds;
  const ratio = (box.w - 0.2) / (box.h - 0.2);
  assert.ok(Math.abs(ratio - 1) < 0.05, `1 km square stays square (w/h ${ratio})`);
  // 1e5 quantization over 10° of latitude is ~11 m, so the painted side is ~1% short.
  assert.ok(Math.abs((box.h - 0.2) * geo.kmPerUnit - 1) < 0.03, 'its painted side measures 1 km');
  const [x0, y0] = fitted(geo, 25, 65), [x1, y1] = fitted(geo, 25 + dLon, 65 + dLat);
  assert.ok(Math.abs((x1 - x0) * geo.kmPerUnit - 1) < 1e-9 && Math.abs((y0 - y1) * geo.kmPerUnit - 1) < 1e-9, 'exact km both ways');
  const world = new WorldGeometry(topo, {}, { object: 'sections' }).fitTo(['578-002']);
  const worldBox = world.paths['578-002'].fullBounds;
  assert.ok((worldBox.w - 0.2) / (worldBox.h - 0.2) > 1.9, 'fixture: the 30° world parallel would stretch it');

  geo.fitTo(['578-001', '578-002']);
  assert.equal(geo.kmPerUnit, EARTH_RADIUS_KM / geo.fit.s, 'country charts are true scale: R / s');
  const north = fitted(geo, 22, 70), south = fitted(geo, 22, 60);
  const meridianKm = (south[1] - north[1]) * geo.kmPerUnit;
  assert.ok(Math.abs(meridianKm - EARTH_RADIUS_KM * 10 * RAD) < 1e-6, `60°N–70°N along a meridian: ${meridianKm} km`);
  const west = fitted(geo, 20, 65), east = fitted(geo, 24, 65);
  const parallelKm = (east[0] - west[0]) * geo.kmPerUnit;
  assert.ok(Math.abs(parallelKm - EARTH_RADIUS_KM * Math.cos(65 * RAD) * 4 * RAD) < 1e-6, 'true along the standard parallel');
  assert.equal(niceDistance(3), 2);
  assert.equal(niceDistance(0.4), 1);
});

test('(f) invert undoes rotation and scale, wrapping longitudes', () => {
  const grid = new WorldGeometry(gridTopo(), {}, { object: 'sections', projection: GRID }).fitTo(gridFeatures().map(f => f.id));
  for (let lon = 9; lon <= 14; lon += 0.25) for (let lat = 44.5; lat <= 48.5; lat += 0.25) {
    const [lo, la] = grid.invert(...fitted(grid, lon, lat));
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `${lon},${lat} -> ${lo},${la}`);
  }
  const cells = [feature('242-001', [rect(178, -18, 180, -16)]), feature('242-002', [rect(180, -18, 182, -16)])];
  const fiji = new WorldGeometry(build(cells), {}, { object: 'sections', projection: { lon0: 180, lat0: -17 } }).fitTo(['242-001', '242-002']);
  for (const [lon, expected] of [[178.5, 178.5], [179.99, 179.99], [181, -179], [-179.5, -179.5], [181.5, -178.5]]) {
    const [lo, la] = fiji.invert(...fitted(fiji, lon, -17.25));
    assert.ok(Math.abs(lo - expected) < 1e-9 && Math.abs(la + 17.25) < 1e-9, `${lon} -> ${lo}`);
  }
  // Beyond the rotated plane (the far side of the globe) there is no point.
  const s = fiji.fit.s * fiji.xScale * Math.PI;
  assert.equal(fiji.invert(fiji.fit.tx + s * 1.001, 0), null);
  assert.equal(fiji.invert(NaN, 0), null);
});

test('(g) the country graticule has a few finite lines on round degrees', () => {
  const cases = [
    [gridTopo(), GRID, gridFeatures().map(f => f.id)],
    [build([feature('076-001', [rect(-74, -34, -35, 5)])]), { lon0: -54.5, lat0: -14.5 }, ['076-001']],
    [build([feature('442-001', [rect(5.7, 49.4, 6.5, 50.2)])]), { lon0: 6.1, lat0: 49.8 }, ['442-001']],
  ];
  for (const [topo, projection, ids] of cases) {
    const geo = new WorldGeometry(topo, {}, { object: 'sections', projection }).fitTo(ids);
    const lines = graticuleLines(geo.graticule.d);
    assert.ok(lines.length >= 3 && lines.length <= 18, `${ids[0]}: ${lines.length} lines`);
    assert.ok(geo.graticule.d.length < 2000, 'a few hundred bytes, not the world grid');
    for (const line of lines) {
      assert.equal(line.length, 2, 'straight lines need two points');
      for (const [x, y] of line) assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= -1 && x <= 961 && y >= -1 && y <= 541, `in frame: ${x},${y}`);
      const [a, b] = line;
      assert.ok(a[0] === b[0] || a[1] === b[1], 'meridians vertical, parallels horizontal');
      if (a[0] === b[0]) {
        const lon = geo.invert(a[0], 270)[0];
        assert.ok(Math.abs(lon * 2 - Math.round(lon * 2)) < 0.03, `meridian on a round longitude (${lon})`);
      }
    }
    for (const label of geo.graticule.labels) assert.match(label.text, /^(0°|\d+(\.\d)?°[NS])$/);
  }
});

test('(h) world defaults are unchanged by explicit default options', () => {
  const atlas = JSON.parse(readFileSync(new URL('../public/world-110m.v1.json', import.meta.url), 'utf8'));
  const ids = Object.keys(NATIONS);
  const implicit = new WorldGeometry(atlas, CAPITALS).fitTo(ids);
  const explicit = new WorldGeometry(atlas, CAPITALS, { object: 'countries', projection: { lon0: 0, lat0: 30 } }).fitTo(ids);
  assert.equal(implicit.legacy, true);
  assert.equal(explicit.legacy, true);
  assert.deepEqual(explicit.paths, implicit.paths);
  assert.deepEqual(explicit.capitals, implicit.capitals);
  assert.deepEqual(explicit.graticule, implicit.graticule);
  assert.deepEqual(explicit.fit, implicit.fit);
  assert.equal(explicit.kmPerUnit, EARTH_RADIUS_KM / (implicit.fit.s * PROJECTION_X_SCALE), 'world keeps its equatorial reference');
  assert.deepEqual(Object.keys(explicit.adj).sort(), Object.keys(implicit.adj).sort());
  for (const id in implicit.adj) assert.deepEqual(sorted(explicit.adj[id]), sorted(implicit.adj[id]));
  for (const [lon, lat] of [[-180, -90], [0, 0], [179.9, 66.5], [-73.9, 40.7]]) assert.deepEqual(implicit.project(lon, lat), projPt(lon, lat));
  for (const [x, y] of [[0, 0], [480, 270], [959, 539]]) assert.deepEqual(explicit.invert(x, y), implicit.invert(x, y));
});

test('decodeTopo picks the named object or the first collection, skipping null geometries', () => {
  const topo = gridTopo();
  topo.objects.sections.geometries.push({ type: null, id: '999-010' });
  const fallback = new WorldGeometry(topo, {}, { projection: GRID }); // default name 'countries' is absent
  assert.equal(fallback.countries.length, 9);
  assert.ok(!fallback.countries.some(c => c.id === '999-010'));
  assert.throws(() => new WorldGeometry({ type: 'Topology', arcs: [], objects: {} }), /GeometryCollection/);
  // An unquantized topology (absolute arcs, no transform) decodes the same way.
  const raw = new WorldGeometry(topology({ sections: { type: 'FeatureCollection', features: gridFeatures() } }), {}, { object: 'sections', projection: GRID });
  for (const c of fallback.countries) assert.deepEqual(sorted(raw.adj[c.id]), sorted(fallback.adj[c.id]));
  assert.throws(() => new WorldGeometry(topo, {}, { projection: { lon0: 0, lat0: 90 } }), /projection/);
});

// ---------- loader ----------

const POSITIONS = ['gk', 'cb', 'cb,lb', 'rb', 'lb', 'cm', 'dm,cm', 'rm,rw', 'lm', 'st', 'st,lw', 'am'];
const SOURCE = { provider: 'EFEM.club', game: 'Football Manager 26', edition: 'FM 26', version: '26.3.0',
  snapshotDate: '2026-10-18', rawScale: 100, conversion: FM_CONVERSION, origin: 'https://efem.club' };
function fixture() {
  const clubs = gridFeatures().map((f, i) => ({
    id: `d999-${100 + i}`, fm: 100 + i, name: `Club ${i + 1}`, short: `C${i + 1}`, code: `C${String.fromCharCode(65 + i)}A`,
    col: `oklch(0.70 0.15 ${i * 40})`, rep: 90 - i, league: 'Test League', str: 60 + i, section: f.id,
    home: i === 8 ? null : [10.5 + (i % 3), 45.5 + Math.floor(i / 3)], homeSource: i === 8 ? null : `wikidata:Q${i + 1}`,
    squad: POSITIONS.map((pos, j) => [1000 * (i + 1) + j, `Player ${i + 1}-${j + 1}`, 70 - j, pos, 'ENG']),
  }));
  return {
    format: 1, id: '999', name: 'Testland', version: '999-0123abcd', projection: { ...GRID }, focus: [10, 45, 13, 48],
    boundaries: { provider: 'synthetic', iso3: 'TST', level: 'ADM1', units: 9, license: 'test', source: 'test', url: 'about:blank' },
    source: { ...SOURCE }, topology: gridTopo(), clubs,
  };
}
function fakeFetch(body = fixture()) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url !== '/base/domestic/999.json') return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  return { fetch, calls };
}

test('(i) loadDomestic builds section geometry and buildClub-shaped club rows', async () => {
  clearDomesticCache();
  const { fetch, calls } = fakeFetch();
  const data = await loadDomestic('999', { baseUrl: '/base/', fetch });
  assert.deepEqual(calls, ['/base/domestic/999.json']);
  assert.equal(data.meta.name, 'Testland');
  assert.equal(data.meta.version, '999-0123abcd');
  assert.ok(!('topology' in data.meta) && !('clubs' in data.meta));
  assert.deepEqual(data.focus, [10, 45, 13, 48]);
  assert.equal(data.sectionNames['999-005'], 'Unit 5');
  assert.equal(Object.keys(data.sectionNames).length, 9);
  assert.deepEqual(data.geo.projection, GRID);
  assert.ok(data.geo.fit, 'geometry comes pre-fitted to every section');
  assert.equal(Object.keys(data.geo.paths).length, 9);
  assert.equal(data.clubs.length, 9);
  const sport = getSport('football');
  data.clubs.forEach((club, i) => {
    assert.equal(club.country, '999');
    assert.equal(club.homeSection, `999-00${i + 1}`);
    assert.equal(club.code, `C${String.fromCharCode(65 + i)}A`);
    assert.equal(club.league, 'Test League');
    assert.equal(club.squad.length, POSITIONS.length);
    const [name, pos, rating, info] = club.squad[0];
    assert.equal(name, `Player ${i + 1}-1`);
    assert.equal(pos, 'GK');
    assert.equal(rating, fmGameRating(70));
    assert.equal(info.id, `fm:${1000 * (i + 1)}`);
    assert.equal(info.club, club.name);
    assert.equal(info.version, '26.3.0');
    const team = buildClub(club, sport);
    assert.equal(team.home, club.homeSection, 'the team starts on its own section');
    assert.equal(team.kind, 'club');
    assert.equal(team.conf, 'Test League');
    assert.equal(team.squad.length, POSITIONS.length);
    assert.equal(team.squad[0].id, `fm:${1000 * (i + 1)}`);
    const path = data.geo.paths[club.homeSection];
    if (club.homePoint) {
      assert.equal(path.hasCapital, true, `${club.id}: anchored at its home town`);
      const [x, y] = fitted(data.geo, ...club.homePoint);
      assert.ok(Math.abs(path.cx - x) < 1e-9 && Math.abs(path.cy - y) < 1e-9);
      assert.deepEqual([path.homeX, path.homeY], [path.cx, path.cy], 'the home marker is the anchor when the town is central');
    } else assert.equal(path.hasCapital, false);
    assert.ok(inside([path.cx, path.cy], path.labelRings));
    assert.ok(inside([path.homeX, path.homeY], path.labelRings));
  });
  // World clubs keep their country as home.
  assert.equal(buildClub({ id: 'f-x', name: 'X', code: 'XXX', league: 'L', country: '826', col: 'red', str: 70, squad: [] }, sport).home, '826');
});

test('(i) loadDomestic caches per id, shares concurrent loads and never caches failures', async () => {
  clearDomesticCache();
  const { fetch, calls } = fakeFetch();
  const [a, b] = await Promise.all([loadDomestic('999', { baseUrl: '/base/', fetch }), loadDomestic('999', { baseUrl: '/base/', fetch })]);
  assert.equal(a, b);
  assert.equal(await loadDomestic('999', { baseUrl: '/base/', fetch }), a);
  assert.equal(calls.length, 1);
  assert.equal(getLoadedDomestic('999'), a);
  clearDomesticCache('999');
  assert.equal(getLoadedDomestic('999'), null);
  const c = await loadDomestic('999', { baseUrl: '/base/', fetch });
  assert.notEqual(c, a);
  assert.equal(calls.length, 2);

  clearDomesticCache();
  await assert.rejects(loadDomestic('999', { baseUrl: '/missing/', fetch }), /HTTP 404/);
  assert.equal(getLoadedDomestic('999'), null);
  assert.ok(await loadDomestic('999', { baseUrl: '/base/', fetch }), 'a failed load can be retried');
  await assert.rejects(loadDomestic('../x', { fetch }), /Unknown domestic country/);
  const broken = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  await assert.rejects(loadDomestic('998', { fetch: async () => broken }), /not valid JSON/);
  const bad = fixture();
  bad.format = 2;
  clearDomesticCache();
  await assert.rejects(loadDomestic('999', { baseUrl: '/base/', fetch: fakeFetch(bad).fetch }), /unsupported format 2/);
  assert.equal(getLoadedDomestic('999'), null, 'an invalid file is not cached');
  clearDomesticCache();
});

test('(i) format 1 validation names the offending field', () => {
  const cases = [
    ['not an object', () => null, /not a JSON object/],
    ['format', d => { d.format = '1'; }, /unsupported format/],
    ['id', d => { d.id = '826'; }, /does not match/],
    ['version', d => { d.version = '999-xyz'; }, /version/],
    ['projection', d => { delete d.projection; }, /projection/],
    ['projection range', d => { d.projection.lat0 = 89; }, /projection/],
    ['focus', d => { d.focus = [13, 45, 10, 48]; }, /focus/],
    ['boundaries', d => { delete d.boundaries; }, /boundaries/],
    ['source', d => { delete d.source.version; }, /source/],
    ['unquantized', d => { delete d.topology.transform; }, /quantized/],
    ['object', d => { d.topology.objects = { countries: d.topology.objects.sections }; }, /objects\.sections/],
    ['section id', d => { d.topology.objects.sections.geometries[0].id = '999-1'; }, /id must look like "999-001"/],
    ['section duplicate', d => { d.topology.objects.sections.geometries[1].id = '999-001'; }, /duplicated/],
    ['section name', d => { delete d.topology.objects.sections.geometries[2].properties.name; }, /has no name/],
    ['null section', d => { d.topology.objects.sections.geometries[2] = { type: null, id: '999-003' }; }, /Polygon or MultiPolygon/],
    ['club count', d => { d.clubs.pop(); }, /one club per section \(9\), found 8/],
    ['club id', d => { d.clubs[0].id = 'f-club'; }, /clubs\[0\].*id must be "d999-100"/],
    ['club section', d => { d.clubs[3].section = '999-042'; }, /clubs\[3\].*not in the topology/],
    ['shared section', d => { d.clubs[3].section = d.clubs[2].section; }, /already belongs/],
    ['code', d => { d.clubs[1].code = 'ca'; }, /three capitals/],
    ['code clash', d => { d.clubs[1].code = d.clubs[0].code; }, /code CAA is duplicated/],
    ['str', d => { d.clubs[0].str = 120; }, /str must be a rating/],
    ['league', d => { d.clubs[0].league = null; }, /no league/],
    ['home', d => { d.clubs[0].home = [10.5]; }, /home must be/],
    ['short squad', d => { d.clubs[4].squad.length = 10; }, /at least 11 players/],
    ['no keeper', d => { d.clubs[4].squad[0][3] = 'cb'; }, /no natural goalkeeper/],
    ['positions', d => { d.clubs[4].squad[2][3] = 'cb,sweeper'; }, /unknown positions/],
    // Inherited keys of the role table are not positions.
    ['position constructor', d => { d.clubs[4].squad[2][3] = 'constructor'; }, /unknown positions/],
    ['position toString', d => { d.clubs[4].squad[2][3] = 'toString,st'; }, /unknown positions/],
    ['position __proto__', d => { d.clubs[4].squad[2][3] = '__proto__'; }, /unknown positions/],
    ['empty ring', d => { d.topology.objects.sections.geometries[2].arcs = [[]]; }, /section 2 .*empty ring/],
    ['arc index', d => { d.topology.objects.sections.geometries[2].arcs = [[d.topology.arcs.length]]; }, /arc index outside/],
    ['arc coordinates', d => { d.topology.arcs[0] = [['a', 'b'], [1, 2]]; }, /arc 0 must be/],
    ['no drawable land', d => {
      d.topology.arcs.push([[0, 0], [500, 0]]);
      d.topology.objects.sections.geometries[2].arcs = [[d.topology.arcs.length - 1]];
    }, /section 999-003 has no drawable land/],
    ['projection elsewhere', d => { d.projection.lon0 = 160; }, /projection centre/],
    ['projection parallel', d => { d.projection.lat0 = 10; }, /projection centre/],
    ['projection seam', d => { d.projection.lon0 = -168; }, /far side/],
    ['focus elsewhere', d => { d.focus = [100, 10, 101, 11]; }, /focus does not frame/],
    ['ability', d => { d.clubs[4].squad[2][2] = 0; }, /current ability/],
    ['player id', d => { d.clubs[4].squad[2][0] = 'x'; }, /squad\[2\]: Invalid FM tuple/],
    ['repeat player', d => { d.clubs[4].squad[3][0] = d.clubs[4].squad[2][0]; }, /repeats player/],
  ];
  assert.ok(decodeDomestic(fixture(), '999').clubs.length === 9, 'the fixture itself is valid');
  for (const [name, mutate, expected] of cases) {
    let data = fixture();
    const replaced = mutate(data);
    if (replaced !== undefined) data = replaced;
    assert.throws(() => decodeDomestic(data, '999'), error => {
      assert.match(error.message, /^Domestic map 999: /, name);
      assert.match(error.message, expected, name);
      return true;
    }, name);
  }
});

test('domestic scope helpers', () => {
  assert.equal(DOMESTIC_PREFIX, 'domestic:');
  assert.equal(domesticScope('826'), 'domestic:826');
  assert.equal(isDomesticScope('domestic:826'), true);
  for (const scope of ['domestic:', 'UEFA', 'all', null, undefined, 826]) assert.equal(isDomesticScope(scope), false, String(scope));
  assert.equal(domesticScopeId('domestic:724'), '724');
  assert.equal(domesticScopeId('elite'), null);
  assert.equal(domesticScopeId(undefined), null);
});
