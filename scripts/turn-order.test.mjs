// Turn order × targeting engine (PLAN §3.7, DEC D1–D4): round-robin queue, "in reach" tiers, fixed-attacker
// and chosen-target draws. Pure engine coverage; no App, no timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldGeometry } from '../src/engine/geo.js';
import { CAPITALS } from '../src/data/capitals.js';
import { NATIONS, SCOPES, buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport, SPORT_LIST } from '../src/sports/index.js';
import { createAttackRouteIndex, routeLandCrossings } from '../src/engine/attackRoutes.js';
import { empireNeighbors, pickTarget, routeCandidate, fallbackRouteTo } from '../src/engine/campaign.js';
import { createDuelDraw, createTargetedDraw as targetedFromDraw } from '../src/engine/duelDraw.js';
import { roundRobinOrder, nextTurn, turnStrip, reachableTargets, routeToTarget, createTargetedDraw,
  launchRules, playerTargeting, rankTargets, TURN_ORDERS, TARGETING_MODES } from '../src/engine/turns.js';
import { campaignSnapshot, parseCampaign } from '../src/engine/storage.js';

// ---------- helpers ----------
const rect = (x, y, w = 2, h = 2) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const shape = (cx, cy, rings) => ({ cx, cy, area: 1, labelRings: rings || [rect(cx - 1, cy - 1)] });
function countingRng(seed = 1) {
  const rng = makeRng(seed);
  let calls = 0;
  const wrapped = () => { calls++; return rng(); };
  wrapped.calls = () => calls;
  wrapped.getState = () => rng.getState();
  return wrapped;
}
function rngOf(...samples) {
  let calls = 0;
  const rng = () => {
    assert.ok(calls < samples.length, 'draw must not consume extra entropy');
    return samples[calls++];
  };
  rng.calls = () => calls;
  return rng;
}
function noEntropy(run) {
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random must not be used'); };
  try { return run(); } finally { Math.random = random; }
}
// A strip of land: a | b share a border; c lies beyond b, so a's straight line to c crosses b first.
function stripBoard({ adjacency = true } = {}) {
  const paths = { a: shape(1, 1, [rect(0, 0)]), b: shape(3, 1, [rect(2, 0)]), c: shape(11, 1, [rect(10, 0)]) };
  const adj = adjacency ? { a: new Set(['b']), b: new Set(['a']) } : {};
  return { geo: { paths, adj }, own: { a: 'A', b: 'B', c: 'C' }, aliveIds: ['A', 'B', 'C'] };
}
// A neutral wall between A and the others: no direct route, only a coastal sea route around it.
function wallBoard({ enclosed = false, third = false } = {}) {
  const paths = {
    a: { cx: 0, cy: 0, labelRings: [rect(-1, -1)] },
    wall: { labelRings: enclosed ? [rect(-3, -3, 6, 6), rect(-2, -2, 4, 4).reverse()] : [rect(8, -30, 1, 60)] },
    b: { cx: 20, cy: 0, labelRings: [rect(19, -1)] },
  };
  const own = { a: 'A', b: 'B' };
  if (third) { paths.c = { cx: 20, cy: 12, labelRings: [rect(19, 11)] }; own.c = 'C'; }
  return { geo: { paths, adj: {} }, own, aliveIds: Object.values(own) };
}
function finiteDraw(draw) {
  assert.ok(draw);
  for (const key of ['requestedAngle', 'bearing', 'rotation', 'x', 'y', 'targetX', 'targetY', 'spinMs', 'holdMs', 'speed'])
    assert.ok(Number.isFinite(draw[key]), `${key} is finite`);
}

// Real atlas (the same fit and routing paths the App uses).
const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
let atlas;
function realAtlas() {
  if (!atlas) {
    const world = new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS));
    const { s, tx, ty } = world.fit;
    const routingPaths = new WorldGeometry(load('countries-50m.json'), CAPITALS).buildPaths(s, tx, ty);
    atlas = { world, routingPaths, routeIndex: createAttackRouteIndex(routingPaths) };
  }
  return atlas;
}
function assertRouteReaches(board, draw) {
  const crossings = draw.routePoints.slice(1).flatMap((point, i) => routeLandCrossings(board.routeIndex,
    { ax: draw.routePoints[i][0], ay: draw.routePoints[i][1], bx: point[0], by: point[1] }));
  const foreign = crossings.filter(({ countryId }) => board.own[countryId] !== draw.attackerId);
  assert.ok(foreign.some(({ countryId }) => board.own[countryId] === draw.targetId), 'route reaches the chosen enemy');
  if (draw.routeKind !== 'neutral-transit') assert.ok(foreign.every(({ countryId }) => board.own[countryId] === draw.targetId),
    'direct and sea routes cross no neutral or third empire');
}

// ---------- round-robin order (DEC D3) ----------
test('round-robin order: starting strength desc, then name, then id; duplicates and unknown ids dropped', () => {
  const teams = {
    a: { name: 'Belgium', baseEff: 80 }, b: { name: 'Albania', baseEff: 80 }, c: { name: 'Croatia', baseEff: 84 },
    d: { name: 'Albania', baseEff: 80 }, e: { name: 'Denmark', baseEff: 70.5 },
  };
  assert.deepEqual(roundRobinOrder(teams, ['e', 'a', 'b', 'c', 'd', 'ghost', 'a']), ['c', 'b', 'd', 'a', 'e']);
  assert.deepEqual(roundRobinOrder(teams, ['d', 'b']), ['b', 'd'], 'equal strength and name fall back to id');
  assert.deepEqual(roundRobinOrder(teams, []), []);
  assert.deepEqual(roundRobinOrder(undefined, undefined), []);
});

test('round-robin order falls back to teamEff for teams without baseEff (older saves)', () => {
  const sport = getSport('football'), rng = makeRng(7);
  const teams = Object.fromEntries(['250', '276', '380', '724'].map(id => [id, buildTeam(id, rng, sport)]));
  for (const team of Object.values(teams)) delete team.baseEff;
  const expected = Object.keys(teams).sort((a, b) => teamEff(teams[b]) - teamEff(teams[a]));
  assert.deepEqual(roundRobinOrder(teams, Object.keys(teams)), expected);
  // baseEff (captured at launch) wins over the current strength, and a non-finite one falls back.
  teams[expected[3]].baseEff = 999;
  teams[expected[0]].baseEff = NaN;
  assert.deepEqual(roundRobinOrder(teams, Object.keys(teams)), [expected[3], expected[0], expected[1], expected[2]]);
});

test('nextTurn consumes the queue, skips eliminated entries and rebuilds it at the round boundary', () => {
  const teams = { A: { name: 'A', baseEff: 90 }, B: { name: 'B', baseEff: 80 }, C: { name: 'C', baseEff: 70 }, D: { name: 'D', baseEff: 60 } };
  const first = nextTurn({ turnQueue: [], turnIndex: 0, aliveIds: ['D', 'C', 'B', 'A'], teams, round: 4 });
  assert.deepEqual(first, { attackerId: 'A', turnQueue: ['A', 'B', 'C', 'D'], turnIndex: 1, round: 5, newRound: true, position: 1, total: 4 });
  const second = nextTurn({ ...first, aliveIds: ['D', 'C', 'B', 'A'], teams });
  assert.deepEqual(second, { attackerId: 'B', turnQueue: ['A', 'B', 'C', 'D'], turnIndex: 2, round: 5, newRound: false, position: 2, total: 4 });
  // C was eliminated before its slot: skipped, and M stays the queue length at round start.
  const third = nextTurn({ ...second, aliveIds: ['D', 'B', 'A'], teams });
  assert.deepEqual(third, { attackerId: 'D', turnQueue: ['A', 'B', 'C', 'D'], turnIndex: 4, round: 5, newRound: false, position: 4, total: 4 });
  const boundary = nextTurn({ ...third, aliveIds: ['D', 'B', 'A'], teams });
  assert.deepEqual(boundary, { attackerId: 'A', turnQueue: ['A', 'B', 'D'], turnIndex: 1, round: 6, newRound: true, position: 1, total: 3 });
  // Only eliminated entries remain → boundary; the input queue is never mutated.
  const queue = ['A', 'B', 'C'];
  const skipped = nextTurn({ turnQueue: queue, turnIndex: 2, aliveIds: ['A', 'B'], teams, round: 2 });
  assert.equal(skipped.newRound, true); assert.equal(skipped.round, 3); assert.deepEqual(skipped.turnQueue, ['A', 'B']);
  assert.deepEqual(queue, ['A', 'B', 'C']);
  // Malformed indices behave like the start of the queue; an empty field yields no attacker.
  assert.equal(nextTurn({ turnQueue: ['A', 'B'], turnIndex: -3, aliveIds: ['A', 'B'], teams, round: 1 }).attackerId, 'A');
  assert.deepEqual(nextTurn({ aliveIds: [], teams }), { attackerId: null, turnQueue: [], turnIndex: 0, round: 1, newRound: true, position: 0, total: 0 });
});

test('turn strip: played/current/upcoming, eliminated entries kept, next survivor or a new round', () => {
  const teams = { A: { name: 'A', baseEff: 90 }, B: { name: 'B', baseEff: 80 }, C: { name: 'C', baseEff: 70 } };
  const live = turnStrip({ turnQueue: ['A', 'B', 'C'], turnIndex: 2, aliveIds: ['A', 'B', 'C'], teams, round: 3, active: true });
  assert.deepEqual(live, { round: 3, position: 2, total: 3, currentId: 'B', nextId: 'C', entries: [
    { id: 'A', state: 'played', eliminated: false }, { id: 'B', state: 'current', eliminated: false },
    { id: 'C', state: 'upcoming', eliminated: false }] });
  // Idle after B's turn with C eliminated: the strip previews the next round.
  const idle = turnStrip({ turnQueue: ['A', 'B', 'C'], turnIndex: 2, aliveIds: ['A', 'B'], teams, round: 3 });
  assert.deepEqual(idle, { round: 4, position: 1, total: 2, currentId: 'A', nextId: 'B', entries: [
    { id: 'A', state: 'current', eliminated: false }, { id: 'B', state: 'upcoming', eliminated: false }] });
  // Last surviving entry of the round: no next attacker in this round.
  const last = turnStrip({ turnQueue: ['A', 'B', 'C'], turnIndex: 2, aliveIds: ['A', 'B'], teams, round: 3, active: true });
  assert.equal(last.nextId, null);
  assert.deepEqual(last.entries.map(entry => [entry.state, entry.eliminated]), [['played', false], ['current', false], ['upcoming', true]]);
  assert.deepEqual(turnStrip({ aliveIds: [] }), { round: 1, position: 0, total: 0, currentId: null, nextId: null, entries: [] });
});

test('launch rules: duel only, You choose for a manager only; runtime falls back to compass without a managed team', () => {
  assert.deepEqual(TURN_ORDERS, ['round-robin', 'random']);
  assert.deepEqual(TARGETING_MODES, ['player', 'compass']);
  const duel = { pacing: 'duel', role: 'manager', turnOrder: 'round-robin', targeting: 'player' };
  assert.deepEqual(launchRules(duel), { turnOrder: 'round-robin', targeting: 'player' });
  assert.deepEqual(launchRules({ ...duel, role: 'spectator' }), { turnOrder: 'round-robin', targeting: 'compass' });
  for (const pacing of ['blitz', 'chaos']) assert.deepEqual(launchRules({ ...duel, pacing }), { turnOrder: 'random', targeting: 'compass' });
  assert.deepEqual(launchRules({ pacing: 'duel', role: 'manager' }), { turnOrder: 'random', targeting: 'compass' }, 'defaults reproduce today');
  assert.deepEqual(launchRules({ ...duel, turnOrder: 'swiss', targeting: 'auto' }), { turnOrder: 'random', targeting: 'compass' });
  assert.deepEqual(launchRules(undefined), { turnOrder: 'random', targeting: 'compass' });
  assert.equal(playerTargeting({ pacing: 'duel', targeting: 'player' }, '250'), true);
  assert.equal(playerTargeting({ pacing: 'duel', targeting: 'player' }, null), false, 'continueAsSpectator → compass');
  assert.equal(playerTargeting({ pacing: 'blitz', targeting: 'player' }, '250'), false);
  assert.equal(playerTargeting({ pacing: 'duel', targeting: 'compass' }, '250'), false);
});

test('target ranking: win chance × territories, then win chance, territories and id', () => {
  const ranked = rankTargets([{ tid: 'x', p: .5, n: 2 }, { tid: 'y', p: .9, n: 1 }, { tid: 'z', p: .25, n: 4 },
    { tid: 'w', p: .4, n: 3 }, { tid: 'v', p: NaN, n: 9 }]);
  // w 1.2 · x 1.0 (p .5) · z 1.0 (p .25) · y .9 · v (non-finite p counts as 0)
  assert.deepEqual(ranked.map(row => row.tid), ['w', 'x', 'z', 'y', 'v']);
  assert.deepEqual(rankTargets([{ tid: 'b', p: .5, n: 2 }, { tid: 'a', p: .5, n: 2 }]).map(row => row.tid), ['a', 'b']);
  assert.deepEqual(rankTargets(null), []);
});

// ---------- draws ----------
test('fixed attacker: three samples, the named attacker, its compass target, never rerouted', () => {
  const board = stripBoard();
  for (const attackerId of ['A', 'B', 'C']) for (const roll of [0, .5, .99]) for (const angle of [0, .25, .5, .75]) {
    const rng = rngOf(roll, angle, .4);
    const draw = createDuelDraw(rng, board, { attackerId });
    assert.equal(rng.calls(), 3);
    finiteDraw(draw);
    assert.equal(draw.attackerId, attackerId, 'the attacker roll is drawn and ignored');
    assert.equal(draw.targetId, pickTarget(board, attackerId, angle * 360).tid);
    assert.equal(draw.reroutedAttacker, false);
  }
  // A blocked or absent attacker: the three samples are still consumed, and the caller skips the turn.
  const unreachable = { geo: { paths: { far: { cx: 1e10, cy: 0 }, b: { cx: 0, cy: 0 }, c: { cx: 10, cy: 0 } }, adj: {} },
    own: { far: 'A', b: 'B', c: 'C' }, aliveIds: ['A', 'B', 'C'] };
  for (const attackerId of ['A', 'ghost']) {
    const rng = rngOf(0, 0, .5);
    assert.equal(createDuelDraw(rng, unreachable, { attackerId }), null);
    assert.equal(rng.calls(), 3);
  }
  // Without attackerId (undefined or null) the call is the original random draw, byte for byte.
  const reference = createDuelDraw(rngOf(0, 0, .5), unreachable);
  assert.equal(reference.reroutedAttacker, true);
  assert.deepEqual(createDuelDraw(rngOf(0, 0, .5), unreachable, { attackerId: undefined }), reference);
  assert.deepEqual(createDuelDraw(rngOf(0, 0, .5), unreachable, { attackerId: null }), reference);
  assert.equal(JSON.stringify(createDuelDraw(rngOf(0, 0, .5), unreachable, {})), JSON.stringify(reference));
});

test('chosen target: no entropy, createDuelDraw shape + chosen, needle on the bearing, valid saved spin', () => {
  const board = stripBoard();
  const compass = createDuelDraw(rngOf(0, 0, .4), board);
  const draw = noEntropy(() => createTargetedDraw(board, 'A', 'B', { speed: 2 }));
  finiteDraw(draw);
  assert.ok(Object.isFrozen(draw) && Object.isFrozen(draw.routePoints) && Object.isFrozen(draw.transitCountryIds));
  assert.deepEqual(Object.keys(draw), [...Object.keys(compass), 'chosen']);
  assert.equal(draw.chosen, true); assert.equal(draw.spinMs, 0); assert.equal(draw.holdMs, 240); assert.equal(draw.speed, 2);
  assert.equal(draw.rotation, draw.bearing); assert.equal(draw.requestedAngle, draw.bearing);
  assert.equal(draw.reroutedAttacker, false); assert.equal(draw.isNeighbor, true);
  assert.deepEqual([draw.attackerId, draw.targetId, draw.routeKind, draw.routeLabel], ['A', 'B', 'straight', 'Direct challenge']);
  assert.deepEqual(draw, targetedFromDraw(board, 'A', 'B', { speed: 2 }), 'turns.js and duelDraw.js agree');
  const quiet = createTargetedDraw(board, 'A', 'B', { reducedMotion: true, speed: NaN });
  assert.equal(quiet.holdMs, 320); assert.equal(quiet.speed, 1); assert.equal(quiet.reducedMotion, true);
  // The same route the preview arrow shows.
  const route = routeToTarget(board, 'A', 'B');
  assert.deepEqual([route.cp.ax, route.cp.ay, route.cp.bx, route.cp.by], [draw.x, draw.y, draw.targetX, draw.targetY]);
  assert.equal(route.routeD, draw.routeD);
  // Not a placed survivor, the attacker itself, or no route at all → null.
  for (const [a, t] of [['A', 'A'], ['A', 'ghost'], ['ghost', 'B'], [undefined, 'B']]) assert.equal(createTargetedDraw(board, a, t), null);
  assert.equal(createTargetedDraw(null, 'A', 'B'), null);
  assert.equal(routeToTarget({ geo: null }, 'A', 'B'), null);
  assert.equal(createTargetedDraw({ ...board, aliveIds: ['A', 'C'] }, 'A', 'B'), null, 'an eliminated empire cannot be chosen');

  // Saved mid-hold as a locked spin, it passes the storage spin validation.
  const sport = getSport('football'), rng = makeRng(3);
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, rng, sport)]));
  const own = { a: '250', b: '276' };
  const saved = createTargetedDraw({ geo: { paths: board.geo.paths, adj: board.geo.adj }, own, aliveIds: ['250', '276'] }, '250', '276');
  const state = { phase: 'playing', settings: { sport: 'football', pacing: 'duel', role: 'manager', turnOrder: 'round-robin', targeting: 'player' },
    teams, own, aliveIds: ['250', '276'], round: 1, matches: 0, queue: [], seed: 3, rngState: rng.getState(),
    turnQueue: ['250', '276'], turnIndex: 1,
    spin: { ...saved, key: 1, tid: saved.attackerId, stage: 'locked', ang: saved.rotation } };
  const parsed = parseCampaign(JSON.stringify(campaignSnapshot(state)));
  assert.equal(parsed.spin.chosen, true); assert.equal(parsed.spin.targetId, '276'); assert.equal(parsed.turnIndex, 1);
});

test('chosen target off the direct rules uses a sea route, or a treaty when enclosed', () => {
  const sea = noEntropy(() => createTargetedDraw(wallBoard(), 'A', 'B'));
  assert.equal(sea.routeKind, 'sea'); assert.equal(sea.routeLabel, 'Coastal sea route');
  assert.ok(sea.routePoints.length > 2); assert.equal(sea.isNeighbor, false);
  const treaty = createTargetedDraw(wallBoard({ enclosed: true }), 'A', 'B');
  assert.equal(treaty.routeKind, 'neutral-transit'); assert.deepEqual(treaty.transitCountryIds, ['wall']);
  const board = wallBoard();
  assert.equal(routeCandidate(board, 'A', 'B'), null, 'the wall blocks the direct line');
  assert.equal(fallbackRouteTo(board, 'A', 'B').routeKind, 'sea');
  assert.equal(fallbackRouteTo(board, 'A', 'A'), null);
  for (const empty of [null, undefined, {}, { geo: null, own: {} }]) {
    assert.equal(routeCandidate(empty, 'A', 'B'), null, 'no board → no route, and no throw');
    assert.equal(fallbackRouteTo(empty, 'A', 'B'), null);
  }
});

// ---------- in reach (DEC D4) ----------
test('reach tiers: route-legal land neighbours, else direct sea strikes, else fallback routes', () => {
  const board = stripBoard();
  const before = JSON.stringify({ ...board, geo: { paths: board.geo.paths } });
  assert.deepEqual(noEntropy(() => reachableTargets(board, 'A')),
    [{ tid: 'B', tier: 'land', isNeighbor: true, routeKind: 'straight', routeLabel: 'Direct challenge' }],
    'C lies behind B, so only the land neighbour is in reach');
  assert.deepEqual(reachableTargets(board, 'C'),
    [{ tid: 'B', tier: 'sea', isNeighbor: false, routeKind: 'straight', routeLabel: 'Direct challenge' }],
    'no land neighbour: direct sea strikes only, and the line to A is blocked by B');
  assert.deepEqual(reachableTargets(stripBoard({ adjacency: false }), 'A').map(entry => [entry.tid, entry.tier]), [['B', 'sea']]);
  assert.equal(JSON.stringify({ ...board, geo: { paths: board.geo.paths } }), before, 'the board is never mutated');
  assert.deepEqual(reachableTargets(wallBoard(), 'A'),
    [{ tid: 'B', tier: 'fallback', isNeighbor: false, routeKind: 'sea', routeLabel: 'Coastal sea route' }]);
  assert.deepEqual(reachableTargets(wallBoard({ enclosed: true }), 'A').map(entry => [entry.tid, entry.tier, entry.routeKind]),
    [['B', 'fallback', 'neutral-transit']]);
  // Point-only fixtures (no painted land) keep the unchecked closest-pair rule: everyone is a direct strike.
  const points = { geo: { paths: { a: { cx: 0, cy: 0 }, b: { cx: 5, cy: 0 }, c: { cx: 0, cy: 5 } }, adj: { a: new Set(['b']) } },
    own: { a: 'A', b: 'B', c: 'C' }, aliveIds: ['A', 'B', 'C'] };
  assert.deepEqual(reachableTargets(points, 'A').map(entry => [entry.tid, entry.tier]), [['B', 'land']]);
  assert.deepEqual(reachableTargets(points, 'C').map(entry => [entry.tid, entry.tier]), [['A', 'sea'], ['B', 'sea']]);
  // Render-purity inputs: no board, tiny atlas, eliminated or unknown attacker.
  for (const [value, attacker] of [[null, 'A'], [{}, 'A'], [{ geo: { paths: {}, adj: {} }, own: {}, aliveIds: [] }, 'A'],
    [{ ...board, aliveIds: ['B', 'C'] }, 'A'], [board, 'ghost']]) assert.deepEqual(reachableTargets(value, attacker), []);
});

test('reach and chosen routes never change a seeded compass draw (isolated route cache)', () => {
  const draws = board => [0, .1, .2, .35, .5, .65, .8, .95].map(angle => createDuelDraw(rngOf(0, angle, .5), board));
  const cold = draws(wallBoard({ third: true }));
  const warmBoard = wallBoard({ third: true });
  const reach = reachableTargets(warmBoard, 'A');
  assert.deepEqual(reach.map(entry => [entry.tid, entry.tier]), [['B', 'fallback'], ['C', 'fallback']]);
  for (const entry of reach) assert.ok(createTargetedDraw(warmBoard, 'A', entry.tid));
  assert.deepEqual(draws(warmBoard), cold);
  assert.deepEqual(reachableTargets(warmBoard, 'A'), reach, 'reach is stable after draws warmed the compass cache');
});

test('real atlas: UEFA land tier agrees with the compass rules and every chosen route reaches its target', () => {
  const { world, routingPaths, routeIndex } = realAtlas();
  const sport = SPORT_LIST[0], rng = makeRng(1042);
  const uefa = SCOPES.find(scope => scope.id === 'UEFA');
  const ids = Object.keys(NATIONS).map(id => buildTeam(id, rng, sport)).filter(uefa.filter).map(team => team.id);
  const board = { geo: world, routingPaths, own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids };
  for (const attackerId of ['250', '276', '380']) {
    const reach = noEntropy(() => reachableTargets(board, attackerId));
    assert.ok(reach.length > 0, `${attackerId} has a front`);
    const neighbors = empireNeighbors(board, attackerId);
    assert.ok(reach.every(entry => entry.tier === 'land' && entry.isNeighbor && neighbors.has(entry.tid)));
    for (const tid of neighbors) assert.equal(reach.some(entry => entry.tid === tid), !!routeCandidate(board, attackerId, tid),
      `${attackerId}→${tid}: in reach exactly when the compass could legally hit it`);
    for (const entry of reach) {
      const draw = createTargetedDraw(board, attackerId, entry.tid);
      assert.equal(draw.routeKind, 'straight');
      assertRouteReaches({ ...board, routeIndex }, draw);
    }
  }
});

test('real atlas: an island finale falls back to the coastal sea route the compass would use', () => {
  const { world, routingPaths, routeIndex } = realAtlas();
  const teams = Object.keys(NATIONS).map(id => buildTeam(id, makeRng(28), SPORT_LIST[0])).sort((a, b) => b.str - a.str).slice(0, 32);
  const own = Object.fromEntries(teams.map(team => [team.id, team.id === '392' ? 'Japan' : 'Empire']));
  const board = { geo: world, routingPaths, own, aliveIds: ['Japan', 'Empire'] };
  for (const [attackerId, targetId] of [['Japan', 'Empire'], ['Empire', 'Japan']]) {
    const reach = reachableTargets(board, attackerId);
    assert.deepEqual(reach.map(entry => [entry.tid, entry.tier, entry.routeKind]), [[targetId, 'fallback', 'sea']]);
    const chosen = createTargetedDraw(board, attackerId, targetId);
    assertRouteReaches({ ...board, routeIndex }, chosen);
    const samples = [attackerId === 'Japan' ? 0 : .75, 0, .5];
    const compass = createDuelDraw(() => samples.shift(), board);
    assert.equal(compass.attackerId, attackerId);
    assert.equal(compass.routeKind, 'sea');
    assert.deepEqual(chosen.routePoints, compass.routePoints, 'the chosen sea route is the one the compass draws');
  }
});

// ---------- determinism ----------
function playRoundRobin(seed, { eliminateAfter = 6, turns = 12 } = {}) {
  const board = stripBoard();
  board.own = { ...board.own };
  board.aliveIds = [...board.aliveIds];
  const teams = { A: { name: 'Alpha', baseEff: 70 }, B: { name: 'Bravo', baseEff: 90 }, C: { name: 'Charlie', baseEff: 80 } };
  const rng = countingRng(seed), reference = makeRng(seed);
  let state = { turnQueue: [], turnIndex: 0, round: 0 };
  const log = [];
  for (let i = 0; i < turns; i++) {
    const turn = nextTurn({ ...state, aliveIds: board.aliveIds, teams });
    const before = rng.calls();
    const draw = createDuelDraw(rng, board, { attackerId: turn.attackerId });
    assert.equal(rng.calls() - before, 3, 'exactly three samples per duel turn');
    for (let k = 0; k < 3; k++) reference();
    assert.equal(rng.getState(), reference.getState());
    log.push([turn.round, turn.position, turn.total, turn.attackerId, draw?.targetId ?? null]);
    state = { turnQueue: turn.turnQueue, turnIndex: turn.turnIndex, round: turn.round };
    if (i === eliminateAfter) { // C falls mid-round: its land goes to B, and its remaining slot is skipped.
      board.own.c = 'B';
      board.aliveIds = board.aliveIds.filter(id => id !== 'C');
    }
  }
  return { log, rngState: rng.getState() };
}

test('round robin is deterministic: queue order, skipped eliminations, round per cycle, 3 samples per turn', () => {
  const first = playRoundRobin(73119), replay = playRoundRobin(73119);
  assert.deepEqual(replay, first);
  assert.deepEqual(first.log.slice(0, 7).map(([round, position, total, attacker]) => [round, position, total, attacker]), [
    [1, 1, 3, 'B'], [1, 2, 3, 'C'], [1, 3, 3, 'A'],
    [2, 1, 3, 'B'], [2, 2, 3, 'C'], [2, 3, 3, 'A'],
    [3, 1, 3, 'B'],
  ]);
  // C falls right after B opens round 3: its slot is skipped (Turn 3 of 3 is A), and round 4 is rebuilt without C.
  assert.deepEqual(first.log.slice(7, 9).map(([round, position, total, attacker]) => [round, position, total, attacker]),
    [[3, 3, 3, 'A'], [4, 1, 2, 'B']]);
  assert.ok(first.log.every(([, , , attacker, target]) => target && target !== attacker));
  // The order itself uses no entropy: another seed plays the same attackers (targets may differ).
  assert.deepEqual(playRoundRobin(20261002).log.map(entry => entry.slice(0, 4)), first.log.map(entry => entry.slice(0, 4)));
});

test('parseCampaign rejects a malformed pendingTarget.turn', () => {
  const sport = getSport('football'), rng = makeRng(5);
  const teams = Object.fromEntries(['250', '276', '380'].map(id => [id, buildTeam(id, rng, sport)]));
  const base = { phase: 'playing', settings: { sport: 'football', pacing: 'duel', role: 'manager', turnOrder: 'round-robin', targeting: 'player' },
    teams, own: { 250: '250', 276: '276', 380: '380' }, aliveIds: ['250', '276', '380'], round: 2, matches: 3, queue: [],
    seed: 5, rngState: rng.getState(), turnQueue: ['380', '250', '276'], turnIndex: 2,
    pendingTarget: { attackerId: '250', optionIds: ['276', '380'], selectedId: '380', round: 2, openedAt: 1, resumeAutoplay: true,
      turn: { attackerId: '250', turnQueue: ['380', '250', '276'], turnIndex: 2, round: 2, newRound: false } } };
  const text = state => JSON.stringify(campaignSnapshot(state));
  assert.deepEqual(parseCampaign(text(base)).pendingTarget, base.pendingTarget);
  for (const turn of [[], 'turn', { ...base.pendingTarget.turn, turnIndex: 4 }, { ...base.pendingTarget.turn, turnIndex: 1.5 },
    { ...base.pendingTarget.turn, turnQueue: ['ghost'] }, { ...base.pendingTarget.turn, turnQueue: null },
    { ...base.pendingTarget.turn, round: -1 }, { ...base.pendingTarget.turn, newRound: 'no' },
    { ...base.pendingTarget.turn, attackerId: '276' }]) {
    assert.throws(() => parseCampaign(text({ ...base, pendingTarget: { ...base.pendingTarget, turn } })), /target choice is incomplete/);
  }
  assert.equal(parseCampaign(text({ ...base, pendingTarget: { ...base.pendingTarget, turn: null } })).pendingTarget.turn, null);
});
