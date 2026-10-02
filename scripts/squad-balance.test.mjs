import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, selectLineup, teamEff, OUT_OF_POSITION_PENALTY } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';
import { basketball } from '../src/sports/basketball.js';
import { pickScorer } from '../src/engine/random.js';
import { estimateWinProbability, UNCERTAINTY_PRESETS } from '../src/engine/odds.js';

function team(sport, rating = 75, id = 'A') {
  return { id, sport: sport.id, str: 5, squad: sport.positionPlan.map((pos, index) => ({ name: `${id}-${index}`, pos, rating })) };
}

test('lineups field the declared positions and never duplicate a player', () => {
  for (const sport of [football, basketball]) {
    const side = team(sport);
    const lineup = selectLineup(side);
    assert.deepEqual(lineup.slots.map(slot => slot.position), sport.positionPlan);
    assert.equal(lineup.starters.length, sport.squadSize);
    assert.equal(new Set(lineup.starters.map(player => player.originalIndex)).size, sport.squadSize);
    assert.ok(lineup.slots.every(slot => slot.player.pos === slot.position && slot.penalty === 0));
    assert.equal(teamEff(side), 75, 'starting-strength metadata cannot override the selected players');
  }
});

test('uncovered positions expose their assigned player and effective penalty', () => {
  const side = team(football);
  side.squad[0].pos = 'FW';
  const goalkeeper = selectLineup(side).slots[0];
  assert.equal(goalkeeper.position, 'GK');
  assert.equal(goalkeeper.player.pos, 'FW');
  assert.equal(goalkeeper.player.assignedPos, 'GK');
  assert.equal(goalkeeper.outOfPosition, true);
  assert.equal(goalkeeper.penalty, OUT_OF_POSITION_PENALTY);
  assert.equal(goalkeeper.effectiveRating, 75 - OUT_OF_POSITION_PENALTY);
});

test('lineup selection finds the best whole assignment, including a stronger emergency starter', () => {
  const side = team(basketball);
  side.squad = [
    { name: 'A', pos: 'PG', rating: 99 }, { name: 'B', pos: 'PG', rating: 94 },
    { name: 'C', pos: 'SG', rating: 85 }, { name: 'D', pos: 'SF', rating: 83 },
    { name: 'E', pos: 'PF', rating: 42 }, { name: 'F', pos: 'C', rating: 80 },
  ];
  // Exhaustive independent oracle over the six players/five shirts.
  let best = -Infinity;
  function visit(slot, used, total) {
    if (slot === basketball.squadSize) { best = Math.max(best, total); return; }
    side.squad.forEach((player, index) => {
      if (used.has(index)) return;
      const rating = player.rating - (player.pos === basketball.positionPlan[slot] ? 0 : OUT_OF_POSITION_PENALTY);
      visit(slot + 1, new Set([...used, index]), total + rating);
    });
  }
  visit(0, new Set(), 0);
  const lineup = selectLineup(side);
  assert.equal(lineup.rating, Math.round(best / basketball.squadSize * 10) / 10);
  assert.equal(lineup.slots.find(slot => slot.position === 'PF').player.name, 'B');
  assert.equal(lineup.slots.find(slot => slot.position === 'PF').penalty, OUT_OF_POSITION_PENALTY);
  assert.deepEqual(lineup.bench.map(player => player.name), ['E']);
});

test('legacy saves infer the correct sport and unfilled shirts remain visible', () => {
  const side = team(basketball);
  delete side.sport;
  assert.deepEqual(selectLineup(side).slots.map(slot => slot.position), basketball.positionPlan);
  side.squad.pop();
  const lineup = selectLineup(side);
  assert.equal(lineup.slots.filter(slot => !slot.player).length, 1);
  assert.equal(lineup.bench.length, 0);
});

test('a useful acquisition upgrades the appropriate shirt, a bench player cannot score', () => {
  for (const sport of [football, basketball]) {
    const side = team(sport);
    side.squad[1].rating = 50;
    const oldRating = teamEff(side);
    side.squad.push({ name: 'Useful acquisition', pos: sport.positionPlan[1], rating: 85 });
    const lineup = selectLineup(side);
    assert.ok(lineup.rating > oldRating);
    assert.ok(lineup.starters.some(player => player.name === 'Useful acquisition'));
    side.squad.push({ name: 'Bench only', pos: sport.positionPlan[1], rating: 40 });
    assert.equal(teamEff(side), lineup.rating);
    const rng = makeRng(992);
    const weights = Object.fromEntries(sport.positionPlan.map(pos => [pos, 1]));
    const starters = new Set(selectLineup(side).starters.map(player => player.name));
    for (let i = 0; i < 1000; i++) assert.ok(starters.has(pickScorer(rng, side, weights, 45)));
    const opponent = team(sport, 75, 'B');
    for (let i = 0; i < 40; i++) {
      const result = sport.simulate(rng, side, opponent, 6, teamEff(side), teamEff(opponent));
      assert.ok(result.ev.filter(event => event.tid === side.id).every(event => starters.has(event.name)));
    }
  }
});

test('best-lineup strength cannot fall after any full-squad acquisition', () => {
  for (const sport of [football, basketball]) {
    const side = team(sport, 62);
    const rng = makeRng(198);
    let previous = teamEff(side);
    for (let i = 0; i < 80; i++) {
      side.squad.push({ name: `Transfer ${i}`, pos: sport.positionPlan[Math.floor(rng() * sport.squadSize)], rating: 42 + Math.floor(rng() * 58) });
      const current = teamEff(side);
      assert.ok(current >= previous, `${sport.id} ${previous} -> ${current}`);
      previous = current;
    }
  }
});

test('serialised RNG state resumes the original stream exactly', () => {
  for (const seed of [0, 1, 20261002, 0xffffffff]) {
    const uninterrupted = makeRng(seed);
    for (let i = 0; i < 37; i++) uninterrupted();
    const state = JSON.parse(JSON.stringify(uninterrupted.getState()));
    const resumed = makeRng(99).setState(state);
    assert.deepEqual(Array.from({ length: 100 }, uninterrupted), Array.from({ length: 100 }, resumed));
    assert.throws(() => resumed.setState(-1), RangeError);
  }
});

test('odds are cached model estimates and leave the campaign random stream untouched', () => {
  const rng = makeRng(73);
  const state = rng.getState();
  const attacker = team(football, 80);
  const defender = team(football, 75, 'B');
  const args = { sport: football, attacker, defender };
  const first = estimateWinProbability(args);
  const second = estimateWinProbability(args);
  assert.strictEqual(first, second);
  assert.equal(rng.getState(), state);
  assert.equal(first.attacker + first.defender, 1);
  assert.equal(first.samples, 1024);
  assert.ok(first.attacker > .6 && first.attacker < .9);
  assert.equal(UNCERTAINTY_PRESETS.predictable.drama, 0);
});

test('rating gaps improve favourite odds while higher uncertainty raises upset chances', () => {
  const samples = 5000;
  for (const sport of [football, basketball]) {
    const defender = team(sport, 65, 'B');
    const odds = [0, 5, 10, 20].map(gap => estimateWinProbability({
      sport, attacker: team(sport, 65 + gap), defender, preset: 'balanced', samples,
    }).attacker);
    assert.ok(odds[0] > .46 && odds[0] < .54, `${sport.id} equal-team fairness ${odds[0]}`);
    assert.ok(odds[1] > .61 && odds[1] < .83, `${sport.id} five-point gap ${odds[1]}`);
    assert.ok(odds[2] > .77 && odds[2] < .96, `${sport.id} ten-point gap ${odds[2]}`);
    assert.ok(odds.every((value, index) => !index || value > odds[index - 1]));
    const predictable = estimateWinProbability({ sport, attacker: team(sport, 75), defender, preset: 'predictable', samples }).attacker;
    const wild = estimateWinProbability({ sport, attacker: team(sport, 75), defender, preset: 'wild', samples }).attacker;
    assert.ok(predictable > wild + .08, `${sport.id} predictable=${predictable}, wild=${wild}`);
    assert.ok(predictable < 1, 'predictable still allows stochastic scoring upsets');
  }
});

test('balance probes apply the series only to the final two survivors', async () => {
  const { probeCampaign } = await import('./balance.mjs');
  const deterministicSport = { ...football, simulate: (_rng, attacker) => ({ winner: attacker.id }) };
  const result = probeCampaign({ sport: deterministicSport, scope: 'CONMEBOL', pacing: 'blitz', finalSeries: 3, seed: 42 });
  assert.equal(result.completed, true);
  assert.equal(result.fixtures, 9);
  assert.equal(result.games, 10, 'eight single games followed by exactly two deciding-series games');
  assert.equal(result.usefulAcquisitions + result.unchangedAcquisitions, 9);
});
