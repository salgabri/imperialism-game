// Attack selection must obey the land actually crossed by the displayed arrow.
// These tests use an independent SVG-winding/segment oracle, never the routing
// implementation, so a matching bug in selection and presentation cannot pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickTarget } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { CAPITALS } from '../src/data/capitals.js';
import { NATIONS } from '../src/data/teams.js';

const rect = (x, y, w = 2, h = 2) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (cx, cy, rings = [rect(cx - 1, cy - 1)]) => ({ cx, cy, area: 1, labelRings: rings });
const boardOf = (paths, own, aliveIds = [...new Set(Object.values(own))], adj = {}) => ({ geo: { paths, adj }, own, aliveIds });
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);

function inLand(rings, [x, y]) {
  let winding = 0;
  for (const ring of rings || []) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (a[1] <= y && b[1] > y && cross > 0) winding++;
    if (a[1] > y && b[1] <= y && cross < 0) winding--;
  }
  return winding !== 0;
}

// Split the route at every coast/border edge and inspect each open interval.
// Checking only equally spaced points would miss a narrow intervening country.
const crossingCache = new WeakMap();
function crossedCountries(paths, cp) {
  let cached = crossingCache.get(paths);
  if (!cached) { cached = new Map(); crossingCache.set(paths, cached); }
  const key = [cp.ax, cp.ay, cp.bx, cp.by].join(',');
  if (cached.has(key)) return cached.get(key);
  const dx = cp.bx - cp.ax, dy = cp.by - cp.ay;
  const intervals = [];
  for (const [cid, path] of Object.entries(paths)) {
    const cuts = [0, 1];
    for (const ring of path.labelRings || []) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < 1e-12) continue;
      const qx = a[0] - cp.ax, qy = a[1] - cp.ay;
      const t = (qx * ey - qy * ex) / determinant;
      const u = (qx * dy - qy * dx) / determinant;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-11) continue;
      const mid = (cuts[i] + cuts[i - 1]) / 2;
      if (inLand(path.labelRings, [cp.ax + dx * mid, cp.ay + dy * mid])) intervals.push({ cid, start: cuts[i - 1], end: cuts[i] });
    }
  }
  const result = intervals.sort((a, b) => a.start - b.start);
  cached.set(key, result);
  return result;
}

function assertLegal(board, attacker, target) {
  assert.ok(target, 'there is a legal opponent');
  const paths = board.routingPaths || board.geo.paths;
  const crossings = crossedCountries(paths, target.cp);
  const foreign = crossings.filter(part => board.own[part.cid] !== attacker);
  assert.ok(foreign.length, 'arrow lands in an opponent territory');
  assert.equal(board.own[foreign[0].cid], target.tid, `first foreign land is ${foreign[0].cid}, not the announced opponent`);
  assert.ok(foreign.every(part => board.own[part.cid] === target.tid), 'visible arrow crosses no other foreign or neutral country');
  assert.ok(Object.entries(paths).some(([cid, path]) => board.own[cid] === target.tid && inLand(path.labelRings, [target.cp.bx, target.cp.by])),
    'route endpoint is just inside target-owned land, not in the sea');
  near(target.cp.dist, Math.hypot(target.cp.bx - target.cp.ax, target.cp.by - target.cp.ay), 'displayed route distance matches its endpoints');
}

test('a nearer capital does not make a country behind an intervening enemy reachable', () => {
  // B's capital is far north; its long territory nevertheless blocks C.
  const board = boardOf({ a: shape(0, 0), b: shape(8.5, 90, [rect(8, -100, 1, 200)]), c: shape(20, 0) },
    { a: 'A', b: 'B', c: 'C' });
  for (let angle = 0; angle < 360; angle++) {
    const target = pickTarget(board, 'A', angle);
    assert.equal(target?.tid, 'B', `spin ${angle} cannot skip B to attack C`);
    assertLegal(board, 'A', target);
  }
});

test('neutral and non-candidate foreign territory both block a route', () => {
  for (const own of [{ a: 'A', c: 'C' }, { a: 'A', blocker: 'eliminated', c: 'C' }]) {
    const board = boardOf({ a: shape(0, 0), blocker: shape(8.5, 90, [rect(8, -100, 1, 200)]), c: shape(20, 0) }, own, ['A', 'C']);
    for (let angle = 0; angle < 360; angle += 15) assert.equal(pickTarget(board, 'A', angle), null,
      'widening the cone never licenses skipping unclaimable land');
    assert.equal(createDuelDraw(() => 0, board), null, 'an isolated attacker gets no illegal draw');
  }
});

test('a very narrow intervening country cannot fall between route samples', () => {
  const board = boardOf({ a: shape(0, 0), blocker: shape(8.001, 90, [rect(8.0001, -100, .0002, 200)]), c: shape(20, 0) },
    { a: 'A', c: 'C' });
  assert.equal(pickTarget(board, 'A', 0), null);
});

test('conquered territory is passable, and the opponent marker stops at its first border', () => {
  const board = boardOf({ a: shape(0, 0), conquered: shape(8.5, 90, [rect(8, -100, 1, 200)]), c: shape(20, 0) },
    { a: 'A', conquered: 'A', c: 'C' });
  const target = pickTarget(board, 'A', 0);
  assert.equal(target.tid, 'C');
  assert.equal(target.cp.ax, 0, 'the nearest owned capital still supplies the origin');
  assert.ok(target.cp.bx > 19 && target.cp.bx < 20, 'marker enters C without travelling to its capital');
  near(target.cp.by, 0, 'clipping preserves the intended bearing');
  assertLegal(board, 'A', target);
});

test('a blocked nearest origin does not hide a legal route from another owned territory', () => {
  const board = boardOf({ main: shape(0, 0), outpost: shape(0, 20), blocker: shape(8, 0, [rect(7, -3, 2, 6)]), enemy: shape(20, 0) },
    { main: 'A', outpost: 'A', enemy: 'B' });
  const target = pickTarget(board, 'A', 0);
  assert.equal(target.tid, 'B');
  assert.deepEqual([target.cp.ax, target.cp.ay], [0, 20]);
  assertLegal(board, 'A', target);
});

test('a blocked nearest destination does not hide another reachable holding of the same opponent', () => {
  const board = boardOf({ a: shape(0, 0), blocker: shape(8, 0, [rect(7, -3, 2, 6)]), main: shape(20, 0), outpost: shape(20, 20) },
    { a: 'A', main: 'B', outpost: 'B' });
  const target = pickTarget(board, 'A', 0);
  assert.equal(target.tid, 'B');
  assert.ok(target.cp.by > 19);
  assertLegal(board, 'A', target);
});

test('an obstructed land-neighbor candidate cannot bypass a blocker through neighbor priority', () => {
  const board = boardOf({ a: shape(0, 0), blocker: shape(8, 0, [rect(7, -3, 2, 6)]), land: shape(20, 0), sea: shape(0, 20) },
    { a: 'A', land: 'L', sea: 'S' }, ['A', 'L', 'S'], { a: new Set(['land']) });
  const target = pickTarget(board, 'A', 0);
  assert.equal(target.tid, 'S', 'the search widens to the legal route instead');
  assert.equal(target.isNeighbor, false);
  assertLegal(board, 'A', target);
});

test('legal neighbors retain priority, otherwise the nearest legal route in the cone wins', () => {
  const board = boardOf({ a: shape(0, 0), land: shape(8, 9), sea: shape(6, 0), farther: shape(14, -4) },
    { a: 'A', land: 'L', sea: 'S', farther: 'F' }, ['A', 'L', 'S', 'F'], { a: new Set(['land']) });
  const land = pickTarget(board, 'A', 0);
  assert.equal(land.tid, 'L');
  assertLegal(board, 'A', land);
  board.geo.adj = {};
  const sea = pickTarget(board, 'A', 0);
  assert.equal(sea.tid, 'S');
  assertLegal(board, 'A', sea);
});

test('display routing geometry takes precedence over coarse simulation shapes', () => {
  const board = boardOf({ a: shape(0, 0), c: shape(20, 0) }, { a: 'A', c: 'C' });
  assert.equal(pickTarget(board, 'A', 0)?.tid, 'C');
  board.routingPaths = { ...board.geo.paths, visibleNeutral: shape(8, 0, [rect(7, -3, 2, 6)]) };
  assert.equal(pickTarget(board, 'A', 0), null, 'land visible only in the detailed atlas still blocks');
});

test('drawing snapshots routing polygons and neutral blockers before invoking external RNG', () => {
  const makeBoard = () => {
    const board = boardOf({ a: shape(0, 0), c: shape(20, 0) }, { a: 'A', c: 'C' });
    board.routingPaths = { ...board.geo.paths, neutral: shape(8, 0, [rect(7, -3, 2, 6)]) };
    return board;
  };
  const board = makeBoard();
  let calls = 0;
  const result = createDuelDraw(() => {
    calls++;
    board.routingPaths.neutral?.labelRings[0].forEach(point => { point[1] += 100; });
    board.own.neutral = 'A';
    delete board.routingPaths.neutral;
    return 0;
  }, board);
  assert.equal(calls, 3, 'one complete draw still consumes exactly three random samples');
  assert.equal(result, null, 'RNG cannot delete an intervening neutral country from the draw snapshot');
  const plain = boardOf({ a: { cx: 0, cy: 0 }, b: { cx: 20, cy: 0 } }, { a: 'A', b: 'B' });
  const fallback = pickTarget(plain, 'A', 0);
  assert.deepEqual(fallback.cp, { ax: 0, ay: 0, bx: 20, by: 0, dist: 20 }, 'point-only diagnostic fixtures preserve their old fallback');
});

let atlasBoard;
function europeBoard() {
  if (!atlasBoard) {
    const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
    const ids = Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id);
    const geo = new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo([...ids, '304']);
    const { s, tx, ty } = geo.fit;
    const routingPaths = new WorldGeometry(load('countries-50m.json'), CAPITALS).buildPaths(s, tx, ty);
    const own = Object.fromEntries(ids.filter(id => geo.paths[id]).map(id => [id, id]));
    atlasBoard = { geo, routingPaths, own, aliveIds: Object.keys(own) };
  }
  return { ...atlasBoard, own: { ...atlasBoard.own }, aliveIds: [...atlasBoard.aliveIds] };
}

test('real Netherlands never challenges home-territory Czechia through Germany or Belgium in any direction', () => {
  const board = europeBoard();
  assert.ok(board.own['528'] && board.own['203'] && board.own['276'] && board.own['056']);
  // Exhaust every direction with the reported parties, retaining every other
  // world's polygon as a blocker. Then check a full UEFA candidate field below.
  board.aliveIds = ['528', '203', '276', '056'];
  for (let angle = 0; angle < 360; angle++) {
    const target = pickTarget(board, '528', angle);
    assert.notEqual(target?.tid, '203', `spin ${angle} must not skip another nation to reach Czechia`);
    assertLegal(board, '528', target);
  }
});

test('full European candidate field never emits a route through a third owner', () => {
  const board = europeBoard();
  for (let angle = 0; angle < 360; angle += 30) assertLegal(board, '528', pickTarget(board, '528', angle));
});

test('real conquered borders use current owners rather than original country names', () => {
  const board = europeBoard();
  board.own['276'] = '203'; // Czechia now owns Germany; that is a legal Czech challenge.
  board.aliveIds = ['528', '203', '056'];
  let czechChallenges = 0;
  for (let angle = 0; angle < 360; angle += 3) {
    const target = pickTarget(board, '528', angle);
    assertLegal(board, '528', target);
    if (target.tid === '203') {
      czechChallenges++;
      const firstForeign = crossedCountries(board.routingPaths, target.cp).find(part => board.own[part.cid] !== '528');
      assert.equal(firstForeign.cid, '276', 'the arrow stops in Czech-held Germany, not across it in Czechia');
    }
  }
  assert.ok(czechChallenges > 0, 'Czech-held Germany remains attackable after conquest');
});
