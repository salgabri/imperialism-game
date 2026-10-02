// Probe initial fields and merged finales in every offered theatre. Geographic
// validity is checked independently of the match simulator and the RNG budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldGeometry } from '../src/engine/geo.js';
import { NATIONS, SCOPES, buildTeam, buildClub, makeRng } from '../src/data/teams.js';
import { CAPITALS } from '../src/data/capitals.js';
import { SPORT_LIST } from '../src/sports/index.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { pickTarget, seedClubs, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { createAttackRouteIndex, routeLandCrossings } from '../src/engine/attackRoutes.js';
import { advanceSeries } from '../src/engine/campaignExperience.js';

const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
const world = new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS));
const { s, tx, ty } = world.fit;
const routingPaths = new WorldGeometry(load('countries-50m.json'), CAPITALS).buildPaths(s, tx, ty);
const routeIndex = createAttackRouteIndex(routingPaths);
const baseBoard = { geo: world, routingPaths, routeIndex };

function assertDraw(board, draw) {
  assert.ok(draw, 'a placed field always resolves a duel');
  assert.notEqual(draw.attackerId, draw.targetId);
  assert.ok(board.aliveIds.includes(draw.attackerId) && board.aliveIds.includes(draw.targetId));
  const crossings = draw.routePoints.slice(1).flatMap((point, i) => routeLandCrossings(board.routeIndex,
    { ax: draw.routePoints[i][0], ay: draw.routePoints[i][1], bx: point[0], by: point[1] }));
  const foreign = crossings.filter(({ countryId }) => board.own[countryId] !== draw.attackerId);
  assert.ok(foreign.some(({ countryId }) => board.own[countryId] === draw.targetId), 'route reaches the announced enemy');
  if (draw.routeKind === 'neutral-transit') {
    assert.match(draw.routeLabel, /Neutral transit treaty/);
    assert.ok(draw.transitCountryIds.length);
    assert.ok(foreign.every(({ countryId }) => board.own[countryId] === draw.targetId ||
      !board.aliveIds.includes(board.own[countryId])), 'treaty never crosses a third live empire');
  } else {
    assert.ok(foreign.every(({ countryId }) => board.own[countryId] === draw.targetId), 'sea and straight routes cross no neutral or third empire');
  }
}

for (const sport of SPORT_LIST) {
  const rng = makeRng(1042);
  const nations = Object.keys(NATIONS).map(id => buildTeam(id, rng, sport));
  const fields = [
    ...SCOPES.map(scope => {
      const teams = scope.id === 'elite' ? nations.slice().sort((a, b) => b.str - a.str).slice(0, 32) : nations.filter(scope.filter);
      return { label: `${sport.id} nations ${scope.id}`, own: Object.fromEntries(teams.map(team => [team.id, team.id])) };
    }),
    ...CLUB_SCOPES(sport).map(scope => ({ label: `${sport.id} clubs ${scope.id}`,
      own: seedClubs(world, sport.clubs.filter(scope.filter).map(club => buildClub(club, sport))) })),
  ];
  for (const field of fields) test(`${field.label}: initial draws and merged final pairs remain reachable`, () => {
    const aliveIds = [...new Set(Object.values(field.own))];
    const board = { ...baseBoard, own: { ...field.own }, aliveIds };
    assert.ok(aliveIds.length > 1);
    assert.deepEqual(validateReachability(board).unplacedIds, []);
    // Each empire can initiate a legal draw. Different bearings exercise cone
    // selection without an expensive animation/simulation at every direction.
    aliveIds.forEach((id, i) => {
      const sample = (i + .01) / aliveIds.length;
      let calls = 0;
      const samples = [sample, (i * .61803398875) % 1, .5];
      const draw = createDuelDraw(() => samples[calls++], board);
      assert.equal(calls, 3);
      assert.equal(draw?.attackerId, id);
      assertDraw(board, draw);
    });
    // Sparse fields' isolated islands and landlocked nations are the most
    // important final-two cases; clubs use the corresponding seeded territories.
    const probeCountries = ['392', '524', '756', '554', '360'];
    const probes = [...new Set(probeCountries.map(country => field.own[country]).filter(Boolean))];
    if (!probes.length) probes.push(aliveIds[0]);
    for (const isolated of probes) {
      const own = Object.fromEntries(Object.entries(field.own).map(([country, owner]) => [country, owner === isolated ? isolated : 'merged']));
      const late = { ...baseBoard, own, aliveIds: [isolated, 'merged'] };
      for (const attacker of late.aliveIds) {
        let calls = 0;
        const draw = createDuelDraw(() => [attacker === isolated ? 0 : .75, .17, .25][calls++], late);
        assert.equal(calls, 3);
        assertDraw(late, draw);
      }
    }
  });
}

test('football Elite 32 Japan finale uses an exact sea polyline in both directions', () => {
  const teams = Object.keys(NATIONS).map(id => buildTeam(id, makeRng(28), SPORT_LIST[0]))
    .sort((a, b) => b.str - a.str).slice(0, 32);
  assert.ok(teams.some(team => team.id === '392'));
  const own = Object.fromEntries(teams.map(team => [team.id, team.id === '392' ? 'Japan' : 'Empire']));
  const board = { ...baseBoard, own, aliveIds: ['Japan', 'Empire'] };
  for (const attacker of board.aliveIds) {
    assert.equal(pickTarget(board, attacker, 0, { fallback: false }), null, 'old straight-capital rules strand this finale');
    let calls = 0;
    const draw = createDuelDraw(() => [attacker === 'Japan' ? 0 : .75, 0, .5][calls++], board);
    assert.equal(draw.routeKind, 'sea');
    assert.ok(draw.routePoints.length > 2);
    assertDraw(board, draw);
    assert.equal(calls, 3);
    assert.ok(Object.isFrozen(draw.routePoints) && draw.routePoints.every(Object.isFrozen));
    const fast = createDuelDraw(() => [attacker === 'Japan' ? 0 : .75, 0, .5][calls++ % 3], board, { speed: 4 });
    assert.deepEqual(fast.routePoints, draw.routePoints, 'speed cannot alter the chosen sea route');
  }
});

test('neutral enclosure uses a visibly named treaty and stops at the first live opponent', () => {
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const paths = { a: { cx: 0, cy: 0, labelRings: [rect(-1, -1, 2, 2)] },
    neutral: { cx: 0, cy: 0, labelRings: [rect(-4, -4, 8, 8), rect(-2, -2, 4, 4).reverse()] },
    b: { cx: 10, cy: 0, labelRings: [rect(9, -1, 2, 2)] },
    c: { cx: 20, cy: 0, labelRings: [rect(19, -1, 2, 2)] } };
  const board = { geo: { paths, adj: {} }, own: { a: 'A', b: 'B', c: 'C' }, aliveIds: ['A', 'B', 'C'], routeIndex: createAttackRouteIndex(paths) };
  const draw = createDuelDraw(() => 0, board);
  assert.equal(draw.routeKind, 'neutral-transit');
  assert.equal(draw.targetId, 'B');
  assert.deepEqual(draw.transitCountryIds, ['neutral']);
  assertDraw(board, draw);
  assert.equal(board.own.neutral, undefined, 'transit does not annex neutral land');
});

test('best-of-three tracks a split series immutably until the second win', () => {
  const first = advanceSeries(null, 'A', 'B', 'A');
  assert.equal(first.complete, false);
  assert.deepEqual(first.series.wins, { A: 1, B: 0 });
  const second = advanceSeries(first.series, 'A', 'B', 'B');
  assert.equal(second.complete, false);
  assert.deepEqual(second.series.wins, { A: 1, B: 1 });
  const third = advanceSeries(second.series, 'A', 'B', 'B');
  assert.equal(third.complete, true);
  assert.deepEqual(third.series.wins, { A: 1, B: 2 });
  assert.deepEqual(first.series.wins, { A: 1, B: 0 }, 'recording another game is immutable');
});
