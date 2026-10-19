// Pure regression coverage for the single snapshot behind a duel's presentation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { pickTarget } from '../src/engine/campaign.js';

function rngOf(...samples) {
  let calls = 0;
  const rng = () => {
    assert.ok(calls < samples.length, 'draw must not consume extra entropy');
    return samples[calls++];
  };
  rng.calls = () => calls;
  return rng;
}

function boardOf(points, own, aliveIds = [...new Set(Object.values(own))], adj = {}) {
  const paths = Object.fromEntries(Object.entries(points).map(([id, point]) => [id, { cx: point[0], cy: point[1], area: point[2] || 1 }]));
  return { geo: { paths, adj }, own, aliveIds };
}

function finiteDraw(draw) {
  assert.ok(draw);
  for (const key of ['requestedAngle', 'bearing', 'rotation', 'x', 'y', 'targetX', 'targetY', 'spinMs', 'holdMs', 'speed']) {
    assert.ok(Number.isFinite(draw[key]), `${key} is finite`);
  }
  assert.ok(draw.bearing >= 0 && draw.bearing < 360);
  assert.ok(Math.abs(draw.rotation % 360 - draw.bearing) < 1e-10);
}

test('disjoint holdings put the spinner at the actual attacking territory, not the largest holding', () => {
  const board = boardOf({ main: [200, 0, 100], outpost: [0, 100], enemy: [10, 100] }, { main: 'A', outpost: 'A', enemy: 'B' });
  const rng = rngOf(0, 0, .9);
  const draw = createDuelDraw(rng, board);
  finiteDraw(draw);
  assert.equal(draw.attackerId, 'A');
  assert.equal(draw.targetId, 'B');
  assert.deepEqual([draw.x, draw.y, draw.targetX, draw.targetY], [0, 100, 10, 100]);
  assert.equal(draw.bearing, 0);
  assert.equal(draw.rotation, 1080);
  assert.equal(rng.calls(), 3);
});

test('widening the sea cone may select behind the request, but the final needle locks onto that target', () => {
  const board = boardOf({ a: [0, 0], b: [-100, 0] }, { a: 'A', b: 'B' });
  const draw = createDuelDraw(rngOf(0, 0, 0), board);
  finiteDraw(draw);
  assert.equal(draw.requestedAngle, 0);
  assert.equal(draw.bearing, 180);
  assert.equal(draw.rotation, 900);
  assert.equal(draw.isNeighbor, false);
});

test('land-neighbor priority and nearest enemy in the first usable sea cone are unchanged', () => {
  const board = boardOf({ a: [0, 0], land: [50, 80], sea: [10, 0], farther: [20, 0] },
    { a: 'A', land: 'L', sea: 'S', farther: 'F' }, ['A', 'L', 'S', 'F'], { a: new Set(['land']) });
  const land = createDuelDraw(rngOf(0, 0, .1), board);
  assert.equal(land.targetId, 'L', 'a land neighbor within 70 degrees retains priority');
  assert.equal(land.isNeighbor, true);
  board.geo.adj = {};
  const sea = createDuelDraw(rngOf(0, 0, .1), board);
  assert.equal(sea.targetId, 'S', 'the nearer enemy in the initial 45-degree cone wins');
  assert.equal(sea.isNeighbor, false);
});

test('SVG compass bearings and two/three whole revolutions agree exactly with the route', () => {
  for (const [point, bearing] of [[[10, 0], 0], [[0, 10], 90], [[-10, 0], 180], [[0, -10], 270]]) {
    const board = boardOf({ a: [0, 0], b: point }, { a: 'A', b: 'B' });
    for (const [turnRoll, turns] of [[0, 2], [.499, 2], [.5, 3], [.999, 3]]) {
      const draw = createDuelDraw(rngOf(0, .123, turnRoll), board);
      finiteDraw(draw);
      assert.equal(draw.bearing, bearing);
      assert.equal(draw.rotation, 360 * turns + bearing);
      assert.equal(draw.requestedAngle, .123 * 360, 'decorative turns never change the requested direction');
    }
  }
});

test('empty, single-owner, duplicate-allied, eliminated and unplaced fields do not waste a draw', () => {
  for (const board of [null, {}, boardOf({}, {}, []),
    boardOf({ a: [0, 0], b: [10, 0] }, { a: 'A', b: 'A' }, ['A', 'A']),
    boardOf({ a: [0, 0], b: [10, 0] }, { a: 'A', b: 'B' }, ['A']),
    boardOf({ a: [0, 0] }, { a: 'A', b: 'B' }, ['A', 'B']),
    boardOf({ a: [0, 0], b: [NaN, 10] }, { a: 'A', b: 'B' }, ['A', 'B']),
  ]) {
    const rng = rngOf();
    assert.equal(createDuelDraw(rng, board), null);
    assert.equal(rng.calls(), 0);
  }
});

test('invalid geometry cannot emit a nonfinite route, while duplicate survivor entries are ignored', () => {
  const board = boardOf({ a: [0, 0], invalid: [Infinity, 0], b: [5, 5] },
    { a: 'A', invalid: 'A', b: 'B' }, ['ghost', 'A', 'A', 'B']);
  const draw = createDuelDraw(rngOf(.5, 0, 0), board);
  finiteDraw(draw);
  assert.equal(draw.attackerId, 'B', 'attacker selection uses the two placed distinct survivors');
  assert.equal(draw.targetId, 'A');
  const impossible = boardOf({ a: [1e300, 0], b: [-1e300, 0] }, { a: 'A', b: 'B' });
  const rng = rngOf(0, 0, 0);
  assert.equal(createDuelDraw(rng, impossible), null, 'overflow/no finite closest pair is rejected');
  assert.equal(rng.calls(), 3);
});

test('resolution is deterministic, uses current policy, and leaves every board field untouched', () => {
  const board = boardOf({ a: [0, 0], b: [10, 10], c: [10, -10] },
    { a: 'A', b: 'B', c: 'C' }, ['A', 'B', 'C'], { a: new Set(['b', 'c']) });
  const before = structuredClone(board);
  for (let angle = 0; angle < 360; angle += 7.5) {
    const first = createDuelDraw(rngOf(0, angle / 360, .8), board);
    const second = createDuelDraw(rngOf(0, angle / 360, .8), board);
    assert.deepEqual(first, second);
    const expected = pickTarget(board, 'A', angle);
    assert.equal(first.targetId, expected.tid);
    assert.equal(first.isNeighbor, expected.isNeighbor);
    assert.deepEqual([first.x, first.y, first.targetX, first.targetY], [expected.cp.ax, expected.cp.ay, expected.cp.bx, expected.cp.by]);
  }
  assert.deepEqual(board, before);
  const draw = createDuelDraw(rngOf(0, 0, 0), board);
  assert.ok(Object.isFrozen(draw));
  board.own.b = 'A';
  board.geo.paths.a.cx = -999;
  board.aliveIds.reverse();
  assert.deepEqual([draw.attackerId, draw.targetId, draw.x, draw.targetX], ['A', 'B', 0, 10], 'the reveal cannot retarget itself when later state changes');
});

test('RNG callbacks cannot change the board snapshot being resolved', () => {
  const board = boardOf({ a: [0, 0], b: [10, 0] }, { a: 'A', b: 'B' });
  let calls = 0;
  const draw = createDuelDraw(() => {
    calls++;
    board.own.b = 'A';
    board.geo.paths.b.cx = 500;
    return 0;
  }, board);
  assert.equal(calls, 3);
  assert.equal(draw.targetId, 'B');
  assert.equal(draw.targetX, 10);
});

test('1x/2x/4x/test speeds and reduced motion capture one consistent animation clock', () => {
  const board = boardOf({ a: [0, 0], b: [10, 0] }, { a: 'A', b: 'B' });
  for (const speed of [1, 2, 4, 80]) {
    for (const reducedMotion of [false, true]) {
      const draw = createDuelDraw(rngOf(0, 0, 0), board, { speed, reducedMotion });
      assert.equal(draw.speed, speed);
      assert.equal(draw.reducedMotion, reducedMotion);
      assert.equal(draw.spinMs, (reducedMotion ? 160 : 1550) / speed);
      assert.equal(draw.holdMs, (reducedMotion ? 320 : 480) / speed);
    }
  }
});

test('invalid speed and out-of-range entropy have finite deterministic fallbacks', () => {
  const board = boardOf({ a: [0, 0], b: [10, 0] }, { a: 'A', b: 'B' });
  for (const speed of [0, -1, NaN, Infinity, Number.MIN_VALUE, '4', null]) {
    const draw = createDuelDraw(rngOf(-1, NaN, Infinity), board, { speed });
    finiteDraw(draw);
    assert.equal(draw.speed, 1);
    assert.equal(draw.spinMs, 1550);
    assert.equal(draw.rotation, 720);
  }
  const last = createDuelDraw(rngOf(1, 1, 1), board);
  finiteDraw(last);
  assert.equal(last.attackerId, 'B');
  assert.ok(last.requestedAngle < 360);
  assert.equal(last.rotation, 1260);
});

test('fast playback reduces decorative revolutions without changing either team or the bearing', () => {
  const board = boardOf({ a: [0, 0], b: [10, 10], c: [-5, 0] }, { a: 'A', b: 'B', c: 'C' });
  const draws = [1, 2, 4].map(speed => createDuelDraw(rngOf(0, .1, .9), board, { speed }));
  assert.deepEqual(draws.map(draw => Math.round((draw.rotation - draw.bearing) / 360)), [3, 2, 1]);
  for (const draw of draws) assert.deepEqual([draw.attackerId, draw.targetId, draw.bearing],
    [draws[0].attackerId, draws[0].targetId, draws[0].bearing]);
});

test('coastal fallback cache order does not change a seeded draw or ownership validity', () => {
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const makeBoard = () => ({ geo: { paths: {
    a: { cx: 0, cy: 0, labelRings: [rect(-1, -1, 2, 2)] },
    wall: { labelRings: [rect(8, -30, 1, 60)] },
    b: { cx: 20, cy: 0, labelRings: [rect(19, -1, 2, 2)] },
  }, adj: {} }, own: { a: 'A', b: 'B' }, aliveIds: ['A', 'B'] });
  const first = makeBoard(), reverseFirst = makeBoard();
  const expected = createDuelDraw(rngOf(0, .25, .5), first);
  createDuelDraw(rngOf(.75, .25, .5), reverseFirst);
  const actual = createDuelDraw(rngOf(0, .25, .5), reverseFirst);
  assert.equal(actual.routeKind, 'sea');
  assert.deepEqual(actual, expected, 'cold/warm and opposite draws resolve exactly the same departure and route');
  // A new blocker changes the prepared geometry identity and cannot inherit an
  // obsolete sea route from the previous atlas.
  const enclosed = makeBoard();
  enclosed.geo.paths.wall.labelRings = [rect(-3, -3, 6, 6), rect(-2, -2, 4, 4).reverse()];
  const treaty = createDuelDraw(rngOf(0, .25, .5), enclosed);
  assert.equal(treaty.routeKind, 'neutral-transit');
});

test('an unreachable malformed owner retries the next attacker without consuming extra entropy', () => {
  const board = boardOf({ far: [1e10, 0], b: [0, 0], c: [10, 0] },
    { far: 'A', b: 'B', c: 'C' });
  const rng = rngOf(0, 0, .5);
  const draw = createDuelDraw(rng, board);
  assert.equal(draw.attackerId, 'B');
  assert.equal(draw.targetId, 'C');
  assert.equal(draw.reroutedAttacker, true);
  assert.equal(rng.calls(), 3);
});

// Round robin (DEC D1/D3): the queue names the attacker; the three samples are still drawn.
test('a named attacker still consumes three samples and ignores the attacker roll', () => {
  const board = boardOf({ a: [0, 0], b: [10, 10], c: [10, -10] },
    { a: 'A', b: 'B', c: 'C' }, ['A', 'B', 'C'], { a: new Set(['b', 'c']) });
  for (const attackerId of ['A', 'B', 'C']) {
    for (const roll of [0, .34, .67, .999]) {
      const rng = rngOf(roll, .125, .8);
      const draw = createDuelDraw(rng, board, { attackerId });
      finiteDraw(draw);
      assert.equal(rng.calls(), 3);
      assert.equal(draw.attackerId, attackerId);
      assert.equal(draw.targetId, pickTarget(board, attackerId, 45).tid);
      assert.equal(draw.reroutedAttacker, false);
      assert.equal(draw.rotation, 360 * 3 + draw.bearing, 'decorative turns still come from the third sample');
    }
  }
  const named = createDuelDraw(rngOf(0, .125, .8), board, { attackerId: 'A' });
  assert.deepEqual(named, createDuelDraw(rngOf(0, .125, .8), board), 'same attacker → identical draw to the random path');
});

test('a named attacker is never rerouted: no route or no placement returns null after three samples', () => {
  const board = boardOf({ far: [1e10, 0], b: [0, 0], c: [10, 0] }, { far: 'A', b: 'B', c: 'C' });
  for (const attackerId of ['A', 'ghost']) {
    const rng = rngOf(0, 0, .5);
    assert.equal(createDuelDraw(rng, board, { attackerId }), null);
    assert.equal(rng.calls(), 3);
  }
  const eliminated = boardOf({ a: [0, 0], b: [10, 0], c: [20, 0] }, { a: 'A', b: 'B', c: 'C' }, ['A', 'B']);
  const rng = rngOf(0, 0, .5);
  assert.equal(createDuelDraw(rng, eliminated, { attackerId: 'C' }), null, 'an eliminated queue entry gets no draw');
  assert.equal(rng.calls(), 3);
  for (const invalid of [null, boardOf({ a: [0, 0] }, { a: 'A', b: 'B' }, ['A', 'B'])]) {
    const none = rngOf();
    assert.equal(createDuelDraw(none, invalid, { attackerId: 'A' }), null);
    assert.equal(none.calls(), 0, 'an unplayable field still draws nothing');
  }
});

test('omitting attackerId (undefined or null) keeps the random draw byte for byte', () => {
  const board = boardOf({ far: [1e10, 0], b: [0, 0], c: [10, 0] }, { far: 'A', b: 'B', c: 'C' });
  const reference = JSON.stringify(createDuelDraw(rngOf(0, 0, .5), board));
  for (const options of [{}, { attackerId: undefined }, { attackerId: null }, { speed: 1, reducedMotion: false }])
    assert.equal(JSON.stringify(createDuelDraw(rngOf(0, 0, .5), board, options)), reference);
});
