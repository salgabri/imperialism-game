import test from 'node:test';
import assert from 'node:assert/strict';
import { hashStr, makeRng, selectLineup, teamEff } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';
import { basketball } from '../src/sports/basketball.js';
import { estimateWinProbability, UNCERTAINTY_PRESETS } from '../src/engine/odds.js';
import { DESIGN_TARGETS, regulationScore, sampleMatchStatistics, syntheticTeam } from './match-simulation-report.mjs';

const sports = [football, basketball];
const between = (value, lower, upper, message) => assert.ok(value >= lower && value <= upper, `${message}: ${value} outside [${lower}, ${upper}]`);
function probe(sport, attacker, defender, options = {}) {
  return sampleMatchStatistics({ sport, attacker, defender, samples: 30000, seed: hashStr(`validation:${sport.id}`), ...options });
}
function scoreFields(result) { return { ga: result.ga, gd: result.gd, tie: result.tie, winner: result.winner }; }
function boundedConstant(value) {
  let calls = 0;
  return () => { assert.ok(++calls <= 5000, `sampler failed to terminate for constant rng=${value}`); return value; };
}

test('both sports expose a prepared score sampler without creating an event timeline', () => {
  for (const sport of sports) {
    assert.equal(typeof sport.prepareMatch, 'function');
    assert.equal(typeof sport.sampleResult, 'function');
    const attacker = syntheticTeam(sport, 75), defender = syntheticTeam(sport, 75, 'D');
    const prepared = sport.prepareMatch(attacker, defender, teamEff(attacker), teamEff(defender));
    const result = sport.sampleResult(makeRng(73), prepared, 6);
    assert.ok(Number.isInteger(result.ga) && Number.isInteger(result.gd));
    assert.ok(!result.ev?.length, 'score sampling must avoid building the live event timeline');
    assert.ok(result.winner === attacker.id || result.winner === defender.id);
  }
});

test('saved seeds reproduce complete matches and prepared samples produce the same outcome', () => {
  for (const sport of sports) {
    const attacker = syntheticTeam(sport, 79), defender = syntheticTeam(sport, 75, 'D');
    const effA = teamEff(attacker), effD = teamEff(defender);
    const prepared = sport.prepareMatch(attacker, defender, effA, effD);
    for (const seed of [0, 1, 7, 413, 20261002, 0xffffffff]) {
      const first = sport.simulate(makeRng(seed), attacker, defender, 6, effA, effD);
      assert.deepEqual(sport.simulate(makeRng(seed), attacker, defender, 6, effA, effD), first);
      assert.deepEqual(scoreFields(sport.sampleResult(makeRng(seed), prepared, 6)), scoreFields(first));
    }
    const original = makeRng(31337);
    for (let i = 0; i < 37; i++) sport.sampleResult(original, prepared, 6);
    const resumed = makeRng(1).setState(JSON.parse(JSON.stringify(original.getState())));
    for (let i = 0; i < 20; i++) assert.deepEqual(sport.sampleResult(original, prepared, 6), sport.sampleResult(resumed, prepared, 6));
  }
});

test('every uncertainty preset retains scoring randomness and allows underdog wins', () => {
  for (const sport of sports) {
    const attacker = syntheticTeam(sport, 80), defender = syntheticTeam(sport, 75, 'D');
    const prepared = sport.prepareMatch(attacker, defender, teamEff(attacker), teamEff(defender));
    for (const preset of Object.values(UNCERTAINTY_PRESETS)) {
      const rng = makeRng(hashStr(`${sport.id}:${preset.id}:variation`));
      const scores = new Set(), winners = new Set();
      for (let i = 0; i < 2000; i++) {
        const result = sport.sampleResult(rng, prepared, preset.drama);
        scores.add(`${result.ga}-${result.gd}`); winners.add(result.winner);
      }
      assert.ok(scores.size >= (sport.id === 'football' ? 15 : 200), `${sport.id}/${preset.id} score variety ${scores.size}`);
      assert.equal(winners.size, 2, `${sport.id}/${preset.id} must allow both sides to win`);
    }
  }
});

for (const sport of sports) {
  test(`${sport.id}: equal sides are neutral before and after the tie break`, () => {
    const result = probe(sport, syntheticTeam(sport, 75), syntheticTeam(sport, 75, 'D'));
    between(result.attackerWinRate, .483, .517, 'equal-team attacker wins');
    const marginLimit = sport.id === 'football' ? .055 : .45;
    between(result.regulationMargin.mean, -marginLimit, marginLimit, 'mean regulation margin');
    assert.ok(result.regulationTieRate > .01, 'probe must exercise the tie-break path');
    const tieTolerance = sport.id === 'football' ? .04 : .09;
    between(result.attackerWinRateAfterTie, .5 - tieTolerance, .5 + tieTolerance, 'attacker wins conditional on a tie');
  });

  test(`${sport.id}: rating gaps produce stronger favourites without eliminating modest-gap upsets`, () => {
    const defender = syntheticTeam(sport, 55, 'D');
    const results = [0, 5, 10, 20, 40].map(gap => probe(sport, syntheticTeam(sport, 55 + gap), defender, { samples: 15000, seed: hashStr(`${sport.id}:gap:${gap}`) }));
    for (let i = 1; i < results.length; i++) assert.ok(results[i].attackerWinRate > results[i - 1].attackerWinRate + .01,
      `${sport.id}: gap improvement ${results.map(row => row.attackerWinRate).join(', ')}`);
    between(results[1].attackerWinRate, .56, .87, 'five-rating-point favourite');
    between(results[2].attackerWinRate, .66, .98, 'ten-rating-point favourite');
    assert.ok(results[3].attackerWinRate > .8, 'twenty-rating-point advantage must be substantial');
    assert.ok(results[4].attackerWinRate > .93, 'forty-rating-point mismatch should usually favour the stronger side');
    assert.ok(results[2].defenderWinRate > .02, 'a useful but modest strength gap must leave room for upsets');
  });

  test(`${sport.id}: changing which side attacks does not create a strength advantage`, () => {
    const strongA = syntheticTeam(sport, 85), weakD = syntheticTeam(sport, 75, 'D');
    const weakA = syntheticTeam(sport, 75), strongD = syntheticTeam(sport, 85, 'D');
    const forward = probe(sport, strongA, weakD, { samples: 20000, seed: 417 });
    const reverse = probe(sport, weakA, strongD, { samples: 20000, seed: 941 });
    between(forward.attackerWinRate + reverse.attackerWinRate, .98, 1.02, 'swapped favourite win rates');
    between(forward.regulationMargin.mean + reverse.regulationMargin.mean, sport.id === 'football' ? -.09 : -.65,
      sport.id === 'football' ? .09 : .65, 'swapped score margins');
  });

  test(`${sport.id}: wild increases upset chances while predictable remains stochastic`, () => {
    const attacker = syntheticTeam(sport, 85), defender = syntheticTeam(sport, 75, 'D');
    const predictable = probe(sport, attacker, defender, { samples: 20000, drama: 0, seed: 538 });
    const wild = probe(sport, attacker, defender, { samples: 20000, drama: 12, seed: 853 });
    assert.ok(predictable.defenderWinRate > 0, 'predictable must still allow scoring upsets');
    assert.ok(wild.defenderWinRate > predictable.defenderWinRate + .035,
      `wild upset rate ${wild.defenderWinRate}; predictable ${predictable.defenderWinRate}`);
  });
}

test('football equal-side scores stay in broad international-football design bands', () => {
  const result = probe(football, syntheticTeam(football, 75), syntheticTeam(football, 75, 'D'), { seed: 6284 });
  const target = DESIGN_TARGETS.football;
  between(result.regulationTotal.mean, ...target.regulationTotalMean, 'combined goals');
  between(result.regulationTotal.sd, ...target.regulationTotalSd, 'combined goals standard deviation');
  between(result.regulationTieRate, ...target.regulationTieRate, 'regulation draw rate');
  between(result.zeroZeroRate, .015, .14, 'goalless games');
  between(result.largeTotalRate, .002, .07, 'seven-or-more-goal games');
  between(result.blowoutRate, .015, .13, 'four-or-more-goal margins');
});

test('basketball equal-side scores retain a realistic spread of totals and margins', () => {
  const result = probe(basketball, syntheticTeam(basketball, 75), syntheticTeam(basketball, 75, 'D'), { seed: 6284 });
  const target = DESIGN_TARGETS.basketball;
  between(result.regulationTotal.mean, ...target.regulationTotalMean, 'combined regulation points');
  between(result.regulationTotal.sd, ...target.regulationTotalSd, 'regulation total standard deviation');
  between(result.regulationMargin.sd, ...target.regulationMarginSd, 'regulation margin standard deviation');
  between(result.regulationTieRate, ...target.regulationTieRate, 'overtime rate');
  between(result.blowoutRate, .08, .4, 'twenty-point margins');
  assert.ok(result.regulationTotal.p05 < 155 && result.regulationTotal.p95 > 185, 'both low- and high-scoring games must occur');
  assert.ok(result.finalTotalMean > result.regulationTotal.mean, 'overtime must add points to the final totals');
});

test('football role upgrades improve the corresponding end of the pitch', () => {
  const attacker = syntheticTeam(football, 75), defender = syntheticTeam(football, 75, 'D');
  const baseline = probe(football, attacker, defender, { seed: 919 });
  const upgrade = positions => ({ ...attacker, squad: attacker.squad.map(player => positions.includes(player.pos) ? { ...player, rating: 95 } : player) });
  const keeper = probe(football, upgrade(['GK']), defender, { seed: 919 });
  const defence = probe(football, upgrade(['DF']), defender, { seed: 919 });
  const attack = probe(football, upgrade(['FW']), defender, { seed: 919 });
  assert.ok(keeper.defenderScore.mean < baseline.defenderScore.mean - .035, 'better keeper should concede fewer goals');
  assert.ok(defence.defenderScore.mean < baseline.defenderScore.mean - .12, 'better defensive line should concede fewer goals');
  assert.ok(attack.attackerScore.mean > baseline.attackerScore.mean + .12, 'better forwards should score more goals');
  assert.ok([keeper, defence, attack].every(row => row.attackerWinRate > baseline.attackerWinRate + .012));
});

test('basketball guards and frontcourt upgrades make useful contributions', () => {
  const attacker = syntheticTeam(basketball, 75), defender = syntheticTeam(basketball, 75, 'D');
  const baseline = probe(basketball, attacker, defender, { seed: 191 });
  const upgrade = positions => ({ ...attacker, squad: attacker.squad.map(player => positions.includes(player.pos) ? { ...player, rating: 95 } : player) });
  const guards = probe(basketball, upgrade(['PG', 'SG']), defender, { seed: 191 });
  const frontcourt = probe(basketball, upgrade(['PF', 'C']), defender, { seed: 191 });
  assert.ok(guards.attackerScore.mean > baseline.attackerScore.mean + 1, 'better guards should generate more points');
  assert.ok(frontcourt.defenderScore.mean < baseline.defenderScore.mean - 1, 'better frontcourt should suppress opponent points');
  assert.ok(guards.attackerWinRate > baseline.attackerWinRate + .03);
  assert.ok(frontcourt.attackerWinRate > baseline.attackerWinRate + .03);
});

test('complete-match events reconcile to scores, eligible scorers and legal clocks', () => {
  for (const sport of sports) {
    const attacker = syntheticTeam(sport, 75), defender = syntheticTeam(sport, 75, 'D');
    attacker.squad.push({ name: 'Unused reserve', pos: sport.positionPlan[1], rating: 40 });
    const names = new Map([attacker, defender].map(side => [side.id, new Set(selectLineup(side).starters.map(player => player.name))]));
    const rng = makeRng(271828);
    let tieCount = 0;
    for (let i = 0; i < 600; i++) {
      const result = sport.simulate(rng, attacker, defender, 6, teamEff(attacker), teamEff(defender));
      const sums = { [attacker.id]: 0, [defender.id]: 0 };
      let previousMinute = 0;
      const lastMinute = sport.clock.length + (sport.id === 'basketball' && result.tie ? 5 * result.tie.periods.length : 0);
      for (const event of result.ev) {
        assert.ok(Number.isInteger(event.m) && event.m >= 1 && event.m <= lastMinute, `invalid clock ${event.m}/${lastMinute}`);
        assert.ok(event.m >= previousMinute, 'events must be ordered by clock'); previousMinute = event.m;
        assert.ok(names.has(event.tid), 'every event must belong to a match participant');
        assert.ok(names.get(event.tid).has(event.name), 'only selected starters may score');
        assert.ok(Number.isInteger(event.pts) && event.pts > 0, 'points must be positive integers');
        if (sport.id === 'football') assert.equal(event.pts, 1);
        sums[event.tid] += event.pts;
      }
      assert.equal(sums[attacker.id], result.ga); assert.equal(sums[defender.id], result.gd);
      if (!result.tie) {
        assert.notEqual(result.ga, result.gd, 'level regulation games require a tie break');
        assert.equal(result.winner, result.ga > result.gd ? attacker.id : defender.id);
        continue;
      }
      tieCount++;
      if (sport.id === 'football') {
        assert.equal(result.ga, result.gd);
        assert.equal(result.tie.ga, result.tie.A.reduce((sum, kick) => sum + kick, 0));
        assert.equal(result.tie.gd, result.tie.D.reduce((sum, kick) => sum + kick, 0));
        assert.ok([...result.tie.A, ...result.tie.D].every(kick => kick === 0 || kick === 1));
        assert.ok(Math.abs(result.tie.A.length - result.tie.D.length) <= 1);
        assert.notEqual(result.tie.ga, result.tie.gd);
        assert.equal(result.winner, result.tie.ga > result.tie.gd ? attacker.id : defender.id);
      } else {
        assert.ok(result.tie.periods.length >= 1 && result.tie.periods.length <= 8);
        assert.ok(result.tie.periods.every(pair => pair.length === 2 && pair.every(points => Number.isInteger(points) && points >= 0)));
        const [regA, regD] = regulationScore(sport, result);
        assert.equal(regA, regD, 'overtime may only begin after tied regulation');
        assert.equal(result.ev.filter(event => event.m <= 40 && event.tid === attacker.id).reduce((sum, event) => sum + event.pts, 0), regA);
        assert.equal(result.ev.filter(event => event.m <= 40 && event.tid === defender.id).reduce((sum, event) => sum + event.pts, 0), regD);
        for (let period = 0; period < result.tie.periods.length; period++) {
          const events = result.ev.filter(event => event.m > 40 + period * 5 && event.m <= 45 + period * 5);
          assert.equal(events.filter(event => event.tid === attacker.id).reduce((sum, event) => sum + event.pts, 0), result.tie.periods[period][0]);
          assert.equal(events.filter(event => event.tid === defender.id).reduce((sum, event) => sum + event.pts, 0), result.tie.periods[period][1]);
        }
        assert.notEqual(result.ga, result.gd); assert.equal(result.tie.ga, result.ga); assert.equal(result.tie.gd, result.gd);
        assert.equal(result.winner, result.ga > result.gd ? attacker.id : defender.id);
      }
    }
    assert.ok(tieCount >= 3, `${sport.id} event checks must include tie breaks`);
  }
});

test('constant and boundary random streams terminate with finite consistent scores', () => {
  for (const sport of sports) {
    const attacker = syntheticTeam(sport, 75), defender = syntheticTeam(sport, 75, 'D');
    const prepared = sport.prepareMatch(attacker, defender, 75, 75);
    for (const value of [0, .25, .5, .75, 1 - Number.EPSILON, 1]) {
      const sample = sport.sampleResult(boundedConstant(value), prepared, 12);
      assert.ok(Number.isInteger(sample.ga) && sample.ga >= 0 && Number.isInteger(sample.gd) && sample.gd >= 0);
      const full = sport.simulate(boundedConstant(value), attacker, defender, 12, 75, 75);
      assert.deepEqual(scoreFields(sample), scoreFields(full));
      assert.equal(full.ev.filter(event => event.tid === attacker.id).reduce((sum, event) => sum + event.pts, 0), full.ga);
      assert.equal(full.ev.filter(event => event.tid === defender.id).reduce((sum, event) => sum + event.pts, 0), full.gd);
      if (sport.id === 'basketball' && full.tie) assert.equal(...regulationScore(sport, full));
    }
  }
});

test('odds use prepared score sampling and leave the campaign RNG stream unchanged', () => {
  for (const sport of sports) {
    let preparations = 0, samples = 0;
    const instrumented = { ...sport, id: `${sport.id}-prepared-validation`,
      prepareMatch(...args) { preparations++; return sport.prepareMatch(...args); },
      sampleResult(...args) { samples++; return sport.sampleResult(...args); },
      simulate() { throw new Error('odds must not allocate a complete event simulation'); },
    };
    const attacker = syntheticTeam(sport, 77.321), defender = syntheticTeam(sport, 75.123, 'D');
    const campaignRng = makeRng(789), state = campaignRng.getState();
    const args = { sport: instrumented, attacker, defender, samples: 2048, drama: 5.789 };
    const first = estimateWinProbability(args);
    assert.equal(preparations, 1, 'lineups must be prepared once per uncached estimate');
    assert.equal(samples, first.samples);
    const cached = estimateWinProbability(args);
    assert.equal(samples, first.samples, 'cached odds must not draw more results');
    assert.ok(preparations <= 2, 'cache-key preparation may occur, but must never repeat per sample');
    assert.strictEqual(first, cached); assert.equal(campaignRng.getState(), state);
    assert.equal(first.attacker + first.defender, 1); assert.ok(first.margin95 > 0);
  }
});
