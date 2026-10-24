// Country-map routing: anchors with real clearance inside every shipped section,
// foreign land beneath a map as never-owned obstacles, and the bounded loader
// cache. Geometry is checked with independent oracles, never the router itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { topology } from 'topojson-server';
import { quantize } from 'topojson-client';
import { DOMESTIC } from '../src/data/domestic.js';
import {
  decodeDomestic, domesticSurroundings, loadDomestic, clearDomesticCache, getLoadedDomestic,
  retainDomestic, loadedDomesticIds, DOMESTIC_CACHE_LIMIT,
} from '../src/engine/domestic.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { pickTarget, FOREIGN_TRANSIT_LABEL } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { createAttackRouteIndex, firstForeignLand, OBSTACLE_PREFIX } from '../src/engine/attackRoutes.js';
import { FM_CONVERSION } from '../src/data/fmPlayers.js';

const read = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
const load = id => decodeDomestic(read(`domestic/${id}.json`), id);
const atlas = read('countries-50m.json');

/** Independent even-odd oracle over painted rings. */
function inside([px, py], rings) {
  let hit = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function clearance([px, py], rings) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}
// Kickoff ownership: every club on its starting sections (just its home on a 100-club map).
const kickoff = country => ({ ...country.startOwners });
const routeLength = points => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]), 0);

// ---------- anchors ----------

test('every shipped section routes from an anchor well inside its own painted land', () => {
  let anchors = 0, atHome = 0, pulled = 0;
  for (const item of DOMESTIC) {
    const { geo, clubs } = load(item.id);
    const entries = Object.entries(geo.paths);
    const homeOf = new Map(clubs.map(club => [club.homeSection, club]));
    // Home sections anchor at (or toward) the home town; the rest of a group at an interior point.
    for (const [id, p] of entries) {
      const club = homeOf.get(id), anchor = [p.cx, p.cy];
      const label = `${item.name} ${club ? club.name : 'section'} (${id})`;
      anchors++;
      assert.ok(inside(anchor, p.labelRings), `${label}: anchor outside its painted section`);
      for (const [other, q] of entries) {
        const b = q.fullBounds;
        if (other !== id && p.cx >= b.x && p.cx <= b.x + b.w && p.cy >= b.y && p.cy <= b.y + b.h) assert.ok(!inside(anchor, q.labelRings), `${label}: anchor inside ${other}`);
      }
      // Arrows leave from here: they must clear the section's own edge, not
      // start on a border where one neighbour's corner captures every bearing.
      const best = clearance([p.labelX, p.labelY], p.labelRings);
      assert.ok(clearance(anchor, p.labelRings) >= 0.3 * best, `${label}: anchor ${clearance(anchor, p.labelRings).toFixed(3)} from the edge, best ${best.toFixed(3)}`);
      if (!club) continue;
      assert.ok(inside([p.homeX, p.homeY], p.labelRings), `${label}: home marker outside its section`);
      if (p.homeX !== p.cx || p.homeY !== p.cy) pulled++;
      else if (club.homePoint && geo.capitals[id]?.[0] === club.homePoint[0] && geo.capitals[id]?.[1] === club.homePoint[1]) atHome++;
    }
  }
  assert.equal(anchors, DOMESTIC.reduce((n, item) => n + (item.sections ?? item.clubs), 0), 'every indexed section is checked');
  // Many clubs still attack from their home town; the rest moved inward.
  assert.ok(atHome > (atHome + pulled) * 0.4 && pulled > 0, `${atHome} at home, ${pulled} pulled inward`);
});

test('at kickoff no club with land neighbours is left with only sea routes, and arrows clear the attacker\'s land', () => {
  for (const item of DOMESTIC) {
    const country = load(item.id), { geo } = country;
    const own = kickoff(country);
    const routeIndex = createAttackRouteIndex(geo.paths);
    // As the app plays country maps: border routes on (obstacles are covered below).
    const board = { geo, routeIndex, own, aliveIds: country.clubs.map(club => club.id), borderRoutes: true };
    country.clubs.forEach((club, i) => {
      const label = `${item.name} ${club.name}`;
      // Land neighbours of the club's whole starting group, held by other clubs.
      const borders = club.startSections.flatMap(id => [...(geo.adj[id] || [])].filter(n => own[n] !== club.id).map(n => [id, n]));
      if (borders.length) {
        // pickTarget only falls back to sea routes when no straight route reaches anyone.
        const direct = borders.some(([id, n]) => firstForeignLand(routeIndex, own, club.id,
          { ax: geo.paths[id].cx, ay: geo.paths[id].cy, bx: geo.paths[n].cx, by: geo.paths[n].cy })?.ownerId === own[n]);
        assert.ok(direct || pickTarget(board, club.id, 0, { fallback: false }), `${label}: land neighbours but only sea routes`);
      }
      if (i % 4) return;
      const angle = (i * 137.5) % 360, draw = pickTarget(board, club.id, angle);
      const points = draw.routePoints || [[draw.cp.ax, draw.cp.ay], [draw.cp.bx, draw.cp.by]];
      // An arrow must at least leave the section it starts from, which the anchor keeps clear.
      const from = club.startSections.find(id => geo.paths[id].cx === points[0][0] && geo.paths[id].cy === points[0][1]);
      assert.ok(from, `${label}: the arrow starts at one of its own sections' anchors`);
      const p = geo.paths[from];
      assert.ok(routeLength(points) >= clearance([p.cx, p.cy], p.labelRings) - 1e-9, `${label}: arrow shorter than its own land`);
    });
  }
});

test('a home near the edge or outside its painted section is pulled inward; a central home is kept', () => {
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const features = [['900-001', rect(10, 45, 11, 46)], ['900-002', rect(11, 45, 12, 46)], ['900-003', rect(12, 45, 13, 46)]]
    .map(([id, ring]) => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Polygon', coordinates: [ring] } }));
  const topo = quantize(topology({ sections: { type: 'FeatureCollection', features } }), 1e5);
  // 001: 100 m inside its east border; 002: on its own west border; 003: central.
  const homes = { '900-001': [10.9987, 45.5], '900-002': [11.0, 45.5], '900-003': [12.5, 45.5] };
  const geo = new WorldGeometry(topo, homes, { object: 'sections', projection: { lon0: 11.5, lat0: 45.5 } }).fitTo(Object.keys(homes));
  const at = ([lon, lat]) => { const [x, y] = geo.project(lon, lat); return [x * geo.fit.s + geo.fit.tx, y * geo.fit.s + geo.fit.ty]; };
  for (const id of Object.keys(homes)) {
    const p = geo.paths[id], best = clearance([p.labelX, p.labelY], p.labelRings);
    assert.ok(inside([p.cx, p.cy], p.labelRings) && clearance([p.cx, p.cy], p.labelRings) >= 0.3 * best, `${id}: anchor clears the edge`);
  }
  const edge = geo.paths['900-001'], [hx, hy] = at(homes['900-001']);
  assert.ok(edge.cx < hx - 1, 'the border home moves west, toward its section\'s middle');
  const along = (edge.labelX - hx) * (edge.cy - hy) - (edge.labelY - hy) * (edge.cx - hx);
  assert.ok(Math.abs(along) < 1e-6 * Math.hypot(edge.labelX - hx, edge.labelY - hy) ** 2, 'along the line to the interior point');
  assert.ok(Math.hypot(edge.cx - hx, edge.cy - hy) < Math.hypot(edge.labelX - hx, edge.labelY - hy), 'only as far as it must');
  assert.deepEqual([edge.homeX, edge.homeY], at(homes['900-001']), 'its marker stays at the home town, which is inside');
  const central = geo.paths['900-003'];
  assert.deepEqual([central.cx, central.cy], at(homes['900-003']), 'a central home is kept exactly');
  assert.deepEqual([central.homeX, central.homeY], [central.cx, central.cy]);
  // Neighbours' arrows now leave from real interior points, so 001 reaches 002 directly.
  const board = { geo, own: { '900-001': 'A', '900-002': 'B', '900-003': 'C' }, aliveIds: ['A', 'B', 'C'] };
  const draw = pickTarget(board, 'A', 0);
  assert.equal(draw.tid, 'B');
  assert.ok(draw.cp.dist > 1, `visible arrow (${draw.cp.dist.toFixed(2)} units)`);
});

// ---------- obstacles ----------

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (cx, cy, rings) => ({ cx, cy, area: 1, labelRings: rings });
const boxed = rings => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { rings, has: ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside([x, y], rings) };
};
const lands = new WeakMap();
/** Units of a route over obstacle land that no section covers (sampled oracle). */
function foreignUnits(points, paths, obstacles, samples = 400) {
  if (!lands.has(obstacles)) lands.set(obstacles, { foreign: obstacles.map(o => boxed(o.rings)), own: Object.values(paths).map(p => boxed(p.labelRings)) });
  const { foreign, own } = lands.get(obstacles);
  let units = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], step = Math.hypot(bx - ax, by - ay) / samples;
    for (let k = 0; k < samples; k++) {
      const q = [ax + (bx - ax) * (k + .5) / samples, ay + (by - ay) * (k + .5) / samples];
      if (foreign.some(land => land.has(q)) && !own.some(land => land.has(q))) units += step;
    }
  }
  return units;
}

test('obstacles block a straight route like neutral land; the draw sails around them', () => {
  // Two coastal sections with a foreign peninsula between them, open sea to the south.
  const paths = { w: shape(1, 5, [rect(0, 0, 2, 10)]), e: shape(19, 5, [rect(18, 0, 2, 10)]) };
  const obstacles = [{ id: 'X', rings: [rect(2, 0, 16, 7)] }];
  const own = { w: 'W', e: 'E' };
  const geo = { paths, adj: {} };
  const plain = pickTarget({ geo, own, aliveIds: ['W', 'E'] }, 'W', 0);
  assert.equal(plain.routeKind, undefined, 'without obstacles the straight line is open');
  const board = { geo, own, aliveIds: ['W', 'E'], obstacles };
  assert.equal(pickTarget(board, 'W', 0, { fallback: false }), null, 'the foreign peninsula blocks the straight line');
  const index = createAttackRouteIndex(paths, obstacles);
  const hit = firstForeignLand(index, own, 'W', { ax: 1, ay: 5, bx: 19, by: 5 });
  assert.equal(hit.countryId, OBSTACLE_PREFIX + 'X');
  assert.equal(hit.ownerId, null);
  assert.equal(hit.obstacle, true);
  let calls = 0;
  const draw = createDuelDraw(() => [0, .25, .5][calls++], board);
  assert.equal(draw.targetId, 'E');
  assert.equal(draw.routeKind, 'sea');
  assert.ok(draw.routePoints.length > 2);
  assert.equal(foreignUnits(draw.routePoints, paths, obstacles), 0, 'the sea route stays off foreign land');
});

test('an exclave enclosed by foreign land crosses it under an honest label', () => {
  const paths = { ex: shape(5, 5, [rect(4, 4, 2, 2)]), main: shape(25, 5, [rect(20, 0, 10, 10)]), far: shape(45, 5, [rect(40, 0, 10, 10)]) };
  const obstacles = [{ id: 'F', rings: [rect(0, 0, 20, 10), rect(4, 4, 2, 2).reverse()] }];
  const board = { geo: { paths, adj: {} }, own: { ex: 'X', main: 'M', far: 'Q' }, aliveIds: ['X', 'M', 'Q'], obstacles };
  let calls = 0;
  const draw = createDuelDraw(() => [0, .25, .5][calls++], board);
  assert.equal(draw.attackerId, 'X');
  assert.equal(draw.targetId, 'M', 'the transit still stops at the first live enemy');
  assert.equal(draw.routeKind, 'foreign-transit');
  assert.equal(draw.routeLabel, FOREIGN_TRANSIT_LABEL);
  assert.deepEqual([...draw.transitCountryIds], [], 'foreign land is not listed as neutral territory');
  assert.ok(foreignUnits(draw.routePoints, paths, obstacles) > 10, 'it really crosses the foreign land');
  // The main section's arrow never needs the treaty.
  calls = 0;
  const back = createDuelDraw(() => [.5, .25, .5][calls++], board);
  assert.equal(back.attackerId, 'M');
  assert.notEqual(back.routeKind, 'foreign-transit');
});

test('sections take precedence where a coarse foreign outline overlaps them', () => {
  // The foreign outline bites 1 unit into both sections, as a 50m border does.
  const paths = { a: shape(5, 5, [rect(0, 0, 10, 10)]), b: shape(15, 5, [rect(10, 0, 10, 10)]) };
  const obstacles = [{ id: 'N', rings: [rect(0, 9, 20, 6)] }];
  const index = createAttackRouteIndex(paths, obstacles);
  const own = { a: 'A', b: 'B' };
  const along = firstForeignLand(index, own, 'A', { ax: 5, ay: 9.5, bx: 15, by: 9.5 });
  assert.equal(along.countryId, 'b', 'a route inside the overlap reaches the neighbour, not the obstacle');
  const out = firstForeignLand(index, own, 'A', { ax: 5, ay: 5, bx: 5, by: 14 });
  assert.equal(out.countryId, OBSTACLE_PREFIX + 'N', 'beyond the sections the outline is foreign land');
  assert.ok(Math.abs(out.t - 5 / 9) < 1e-9, `blocked where the section ends (t ${out.t})`);
});

test('border routes reach a land neighbour whose anchor hides behind another section', () => {
  // A's east side borders B (y 0-3) and C (y 3-10); B's anchor lies beyond C.
  const paths = {
    a: shape(5, 5, [[[0, 0], [10, 0], [10, 3], [10, 10], [0, 10], [0, 0]]]),
    b: shape(25, 1, [[[10, 0], [30, 0], [30, 2], [12, 2], [12, 3], [10, 3], [10, 0]]]),
    c: shape(20, 6.5, [[[10, 3], [12, 3], [12, 2], [30, 2], [30, 10], [10, 10], [10, 3]]]),
  };
  const adj = { a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] };
  const own = { a: 'A', b: 'B', c: 'C' };
  const index = createAttackRouteIndex(paths);
  assert.equal(firstForeignLand(index, own, 'A', { ax: 5, ay: 5, bx: 25, by: 1 }).countryId, 'c', 'fixture: C hides B\'s anchor');
  const angle = 320; // toward B's shared border
  const plain = pickTarget({ geo: { paths, adj }, own, aliveIds: ['A', 'B', 'C'] }, 'A', angle);
  assert.equal(plain.tid, 'C', 'anchor lines alone never reach B');
  const board = { geo: { paths, adj }, own, aliveIds: ['A', 'B', 'C'], borderRoutes: true };
  const draw = pickTarget(board, 'A', angle);
  assert.equal(draw.tid, 'B');
  assert.equal(draw.routeKind, undefined, 'a direct challenge, not a fallback');
  assert.equal(draw.isNeighbor, true);
  assert.deepEqual([draw.cp.ax, draw.cp.ay], [5, 5], 'it still leaves from A\'s anchor');
  assert.ok(Math.abs(draw.cp.bx - 10) < .06 && draw.cp.by > 0 && draw.cp.by < 3, 'and ends just across the A-B border');
  assert.equal(firstForeignLand(index, own, 'A', draw.cp).countryId, 'b', 'crossing no third section');
  let calls = 0;
  const duel = createDuelDraw(() => [0, angle / 360, .5][calls++], board);
  assert.equal(duel.targetId, 'B', 'duel draws carry the option through their snapshot');
});

test('without obstacles nothing changes: same index, same draws', () => {
  const paths = { w: shape(1, 5, [rect(0, 0, 2, 10)]), e: shape(19, 5, [rect(18, 0, 2, 10)]), n: shape(10, 20, [rect(5, 18, 10, 4)]) };
  const plain = createAttackRouteIndex(paths);
  assert.equal(createAttackRouteIndex(paths, undefined), plain);
  assert.equal(createAttackRouteIndex(paths, []), plain);
  const obstacles = [{ id: 'X', rings: [rect(2, 0, 16, 7)] }];
  assert.equal(createAttackRouteIndex(paths, obstacles), createAttackRouteIndex(paths, obstacles), 'cached per obstacle list');
  assert.equal(plain.obstacles, undefined);
  assert.ok(plain.countries.every(country => !country.obstacle));
  const own = { w: 'W', e: 'E', n: 'N' };
  for (let angle = 0; angle < 360; angle += 45) for (const attacker of ['W', 'E', 'N']) {
    const base = pickTarget({ geo: { paths, adj: {} }, own, aliveIds: ['W', 'E', 'N'] }, attacker, angle);
    assert.deepEqual(pickTarget({ geo: { paths, adj: {} }, own, aliveIds: ['W', 'E', 'N'], obstacles: [] }, attacker, angle), base);
  }
});

test('shipped maps with their foreign neighbours: kickoff routes stay off foreign land unless labelled', () => {
  // Netherlands (The Hague, Belgian/German border), Croatia (Neum), Russia
  // (Kaliningrad, Kazakhstan, China), Canada (the US border) and India.
  for (const id of ['528', '191', '643', '124', '356']) {
    const country = load(id), { geo } = country;
    const { shapes, obstacles } = domesticSurroundings(atlas, country);
    assert.equal(domesticSurroundings(atlas, country), domesticSurroundings(atlas, country), `${id}: stable objects keep the route index cached`);
    assert.ok(obstacles.length > 0 && obstacles.every(o => o.id !== country.meta.id), `${id}: the host is never an obstacle`);
    assert.ok(shapes.every(s => typeof s.d === 'string' && s.d.startsWith('M') && s.rings.length));
    const own = kickoff(country);
    const board = { geo, own, aliveIds: country.clubs.map(club => club.id), obstacles, borderRoutes: true };
    const kinds = {};
    country.clubs.forEach((club, i) => {
      for (const angle of [i * 37 % 360, (i * 37 + 180) % 360]) {
        const draw = pickTarget(board, club.id, angle);
        const kind = draw.routeKind || 'straight';
        kinds[kind] = (kinds[kind] || 0) + 1;
        const points = draw.routePoints || [[draw.cp.ax, draw.cp.ay], [draw.cp.bx, draw.cp.by]];
        const km = foreignUnits(points, geo.paths, obstacles, 200) * geo.kmPerUnit;
        if (kind === 'foreign-transit') assert.equal(draw.routeLabel, FOREIGN_TRANSIT_LABEL);
        else assert.ok(km < 1, `${country.meta.name} ${club.name} → ${draw.tid}: ${kind} route crosses ${km.toFixed(1)} km of foreign land`);
        if (club.name === 'ADO Den Haag') assert.notEqual(kind, 'sea', 'The Hague attacks over land');
      }
    });
    assert.ok((kinds.straight || 0) > (kinds.sea || 0) + (kinds['foreign-transit'] || 0), `${id}: ${JSON.stringify(kinds)}`);
    if (id === '643') {
      const kaliningrad = country.clubs.find(club => club.name === 'Baltika Kaliningrad');
      assert.equal(pickTarget(board, kaliningrad.id, 0).routeKind, 'foreign-transit', 'the exclave crosses foreign land to reach Russia');
    }
  }
});

// ---------- bounded loader cache ----------

const POSITIONS = ['gk', 'cb', 'cb', 'rb', 'lb', 'cm', 'cm', 'rm', 'lm', 'st', 'st'];
function countryFile(id) {
  const features = [0, 1].map(i => ({ type: 'Feature', id: `${id}-00${i + 1}`, properties: { name: `${id} ${i}` },
    geometry: { type: 'Polygon', coordinates: [[[10 + i, 45], [11 + i, 45], [11 + i, 46], [10 + i, 46], [10 + i, 45]]] } }));
  const extra = Array.from({ length: 8 }, (_, i) => ({ type: 'Feature', id: `${id}-${String(i + 3).padStart(3, '0')}`,
    properties: { name: `${id} ${i + 2}` }, geometry: { type: 'Polygon', coordinates: [[[10 + i * .25, 46], [10.25 + i * .25, 46], [10.25 + i * .25, 46.5], [10 + i * .25, 46.5], [10 + i * .25, 46]]] } }));
  const all = [...features, ...extra];
  return {
    format: 1, id, name: `Country ${id}`, version: `${id}-0123abcd`, projection: { lon0: 11, lat0: 45.7 }, focus: [10, 45, 12, 46.5],
    boundaries: { provider: 'synthetic' }, source: { version: '26.3.0', snapshotDate: '2026-10-18', edition: 'FM 26', conversion: FM_CONVERSION },
    topology: quantize(topology({ sections: { type: 'FeatureCollection', features: all } }), 1e5),
    clubs: all.map((f, i) => ({ id: `d${id}-${i + 1}`, fm: i + 1, name: `Club ${id}-${i}`, code: `${String.fromCharCode(65 + i)}${id.slice(-2)}`,
      col: 'oklch(0.7 0.1 30)', league: 'L', str: 60, section: f.id, home: null,
      squad: POSITIONS.map((pos, j) => [i * 100 + j + 1, `P${j}`, 60, pos]) })),
  };
}
const files = Object.fromEntries(['901', '902', '903', '904', '905'].map(id => [id, countryFile(id)]));
const fetch = async url => {
  const id = url.match(/(\d+)\.json$/)?.[1];
  return files[id] ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(files[id])) } : { ok: false, status: 404 };
};

test('the decoded-map cache keeps retained countries plus a few recent ones', async () => {
  clearDomesticCache();
  retainDomestic([]);
  for (const id of ['901', '902', '903', '904']) await loadDomestic(id, { fetch });
  assert.deepEqual(loadedDomesticIds(), ['903', '904'], `only ${DOMESTIC_CACHE_LIMIT} unretained countries stay decoded`);
  assert.equal(getLoadedDomestic('901'), null, 'browsing evicted the first one');

  // The map on screen and the campaign in play survive any amount of browsing.
  const shown = await loadDomestic('901', { fetch });
  retainDomestic(['901', null, undefined]);
  for (const id of ['902', '903', '904', '905']) await loadDomestic(id, { fetch });
  assert.equal(getLoadedDomestic('901'), shown, 'a retained country is never evicted');
  assert.equal(loadedDomesticIds().length, DOMESTIC_CACHE_LIMIT + 1);
  // getLoadedDomestic counts as use: 904 outlives 905 once read.
  getLoadedDomestic('904');
  retainDomestic([]);
  await loadDomestic('902', { fetch });
  assert.deepEqual(loadedDomesticIds(), ['904', '902'], 'least recently used go first once released');

  // Concurrent loads still share one request, even while others are evicted.
  let requests = 0;
  const counting = async url => { requests++; return fetch(url); };
  clearDomesticCache();
  const [a, b] = await Promise.all([loadDomestic('903', { fetch: counting }), loadDomestic('903', { fetch: counting }),
    loadDomestic('901', { fetch: counting }), loadDomestic('902', { fetch: counting }), loadDomestic('904', { fetch: counting })]);
  assert.equal(a, b);
  assert.equal(requests, 4);
  assert.ok(loadedDomesticIds().length <= DOMESTIC_CACHE_LIMIT);
  clearDomesticCache();
});
