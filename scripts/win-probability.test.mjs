// WP-MATCH: live win-probability model (src/engine/winProbability.js, PLAN §3.7, DEC D6) and the sport profile
// exports the squad screen reads (src/sports/football.js footballProfile, basketball.js basketballProfile).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTeam, makeRng, NATIONS, selectLineup } from '../src/data/teams.js';
import { clamp } from '../src/engine/random.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import * as footballModule from '../src/sports/football.js';
import * as basketballModule from '../src/sports/basketball.js';
import {
  basketballWinProbability, chartDomain, chartGeometry, footballRate, footballWinProbability, isLiveModel,
  liveModelFor, liveWinChart, perspectiveSide, winMarkers, winProbabilityAt, winSeries,
} from '../src/engine/winProbability.js';

const { football, prepareFootballMatch, footballProfile } = footballModule;
const { basketball, basketballProfile } = basketballModule;

const nationId = code => Object.keys(NATIONS).find(id => NATIONS[id][1] === code);
const nation = (sport, code) => buildTeam(nationId(code), makeRng(1), sport);
const uniform = (sport, id, ratings) => ({
  id, sport: sport.id, str: 5,
  squad: sport.positionPlan.map((pos, i) => ({ name: `${id}-${i}`, pos, rating: Array.isArray(ratings) ? ratings[i] : ratings })),
});

/** README §B formula written out independently: untruncated (to 60 goals) double Poisson sum. */
function readmeFormula(rA, rD, diff, remaining, level = 0.5) {
  const pois = (lambda, n) => { let p = Math.exp(-lambda); for (let i = 1; i <= n; i++) p *= lambda / i; return p; };
  let win = 0, tie = 0;
  for (let i = 0; i <= 60; i++) {
    for (let j = 0; j <= 60; j++) {
      const q = pois(rA * remaining, i) * pois(rD * remaining, j), g = diff + i - j;
      if (g > 0) win += q; else if (g === 0) tie += q;
    }
  }
  return win + tie * level;
}

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected}, got ${actual} (±${tolerance})`);

const FOOTBALL_PAIRS = [['ITA', 'HUN'], ['GER', 'AUT'], ['ESP', 'BUL'], ['ITA', 'GER'], ['BRA', 'ARG'], ['FRA', 'ENG'],
  ['NED', 'POR'], ['SRB', 'ITA'], ['USA', 'MEX'], ['JPN', 'KOR'], ['NGA', 'CMR'], ['LUX', 'QAT']];
const BASKETBALL_PAIRS = [['ESP', 'FRA'], ['SRB', 'ITA'], ['USA', 'NGA'], ['GER', 'GRE'], ['CMR', 'CHN'], ['FIN', 'IRN'],
  ['ANG', 'AUS'], ['LTU', 'SVN']];

test('footballRate is the README rate and the football model\'s mean scoring rate', () => {
  assert.equal(footballRate(0), 1.28);
  close(footballRate(1e9), 1.28 * Math.exp(1.5), 1e-12);
  close(footballRate(-1e9), 1.28 * Math.exp(-1.5), 1e-12);
  for (const log of [-2, -0.7, 0.3, 0.6, 1.9]) close(footballRate(log), 1.28 * Math.exp(1.5 * Math.tanh(log / 1.5)), 1e-15);
  // Predictable (no form): the sampled goals average the README rate (tempo has mean 1).
  for (const [a, d] of [['ESP', 'BUL'], ['ITA', 'GER']]) {
    const prepared = prepareFootballMatch(nation(football, a), nation(football, d));
    const rng = makeRng(90210), count = 30000;
    let goalsA = 0, goalsD = 0;
    for (let i = 0; i < count; i++) { const result = football.sampleResult(rng, prepared, 0); goalsA += result.ga; goalsD += result.gd; }
    close(goalsA / count, footballRate(prepared.logA), footballRate(prepared.logA) * 0.03, `${a} mean goals`);
    close(goalsD / count, footballRate(prepared.logD), footballRate(prepared.logD) * 0.04, `${d} mean goals`);
  }
});

test('the kick-off value is the README formula on the match\'s prepareFootballMatch logA/logD with its effA/effD', () => {
  // engine-diff §4a.1 measured these README values on the repo rosters.
  const pinned = { 'ITA-HUN': 0.762, 'GER-AUT': 0.810, 'ESP-BUL': 0.947, 'ITA-GER': 0.447 };
  for (const [a, d] of FOOTBALL_PAIRS.slice(0, 4)) {
    const attacker = nation(football, a), defender = nation(football, d);
    const plain = liveModelFor(football, attacker, defender);
    const prepared = prepareFootballMatch(attacker, defender);
    assert.equal(plain.rA, footballRate(prepared.logA));
    assert.equal(plain.rD, footballRate(prepared.logD));
    const p0 = footballWinProbability({ rA: plain.rA, rD: plain.rD, diff: 0, remaining: 1 });
    close(p0, readmeFormula(plain.rA, plain.rD, 0, 1), 1e-9, `${a}-${d} README formula`);
    close(p0, pinned[`${a}-${d}`], 0.001, `${a}-${d} engine-diff value`);
    close(winProbabilityAt(plain, 0, 0), p0, 1e-15);

    // Tactics move effA/effD; the model follows the match's own strengths, not the squads' base ratings.
    const effA = selectLineup(attacker).rating + 2.5, effD = selectLineup(defender).rating - 1;
    const tactical = liveModelFor(football, attacker, defender, effA, effD, 6);
    const preparedTactical = prepareFootballMatch(attacker, defender, effA, effD);
    assert.equal(tactical.rA, footballRate(preparedTactical.logA));
    assert.equal(tactical.rD, footballRate(preparedTactical.logD));
    assert.ok(tactical.rA > plain.rA && tactical.rD < plain.rD);
    assert.ok(footballWinProbability({ ...tactical, remaining: 1 }) > p0);
    assert.deepEqual(liveModelFor('football', attacker, defender, effA, effD, 6), tactical, 'a sport id works like the sport object');
  }
});

test('README formula: closed forms, symmetry, cap 15 and bounds', () => {
  for (const lambda of [0.3, 1.28, 2.6, 5.7]) {
    close(footballWinProbability({ rA: lambda, rD: 0, diff: 0, remaining: 1 }), 1 - 0.5 * Math.exp(-lambda), 1e-12, 'level, D cannot score');
    close(footballWinProbability({ rA: lambda, rD: 0, diff: -1, remaining: 1 }),
      1 - Math.exp(-lambda) * (1 + lambda) + 0.5 * lambda * Math.exp(-lambda), 1e-12, 'one down, D cannot score');
    close(footballWinProbability({ rA: 0, rD: lambda, diff: 1, remaining: 1 }), Math.exp(-lambda) * (1 + 0.5 * lambda), 1e-12, 'one up, A cannot score');
    close(footballWinProbability({ rA: lambda, rD: lambda, diff: 0, remaining: 0.6 }), 0.5, 1e-12, 'equal sides, level');
  }
  const rates = [0, 0.2856, 0.9, 1.28, 3, 5.7365, 8, 40];
  for (const rA of rates) {
    for (const rD of rates) {
      for (let diff = -6; diff <= 6; diff++) {
        for (const remaining of [0, 0.1, 0.5, 1]) {
          const p = footballWinProbability({ rA, rD, diff, remaining });
          const swapped = footballWinProbability({ rA: rD, rD: rA, diff: -diff, remaining });
          assert.ok(p >= 0 && p <= 1, `bounds ${rA} ${rD} ${diff} ${remaining}`);
          close(p + swapped, 1, 1e-12, 'complementary sides');
          // Within the model's range (rate ≤ 1.28·e^1.5) the 0..15 sums match the untruncated formula
          // (worst case ≈ 1.8e-5 at both rates maximal and a 6-goal difference; ≈ 2e-6 for |diff| ≤ 3).
          if (rA <= 5.7365 && rD <= 5.7365 && remaining > 0) {
            close(p, readmeFormula(rA, rD, diff, remaining), Math.abs(diff) <= 3 ? 5e-6 : 3e-5, `untruncated ${rA} ${rD} ${diff} ${remaining}`);
          }
        }
      }
    }
  }
});

test('full time is an exact step; a level score counts the shoot-out as ½ unless told otherwise', () => {
  for (const rates of [{ rA: 1.8, rD: 0.6 }, { rA: 0.3, rD: 5.7 }]) {
    assert.equal(footballWinProbability({ ...rates, diff: 1, remaining: 0 }), 1);
    assert.equal(footballWinProbability({ ...rates, diff: -2, remaining: 0 }), 0);
    assert.equal(footballWinProbability({ ...rates, diff: 0, remaining: 0 }), 0.5);
    assert.equal(footballWinProbability({ ...rates, diff: 0, remaining: 0, shootoutA: 0.8 }), 0.8);
    assert.equal(footballWinProbability({ ...rates, diff: 0, remaining: -3 }), 0.5, 'remaining clamps to 0');
    close(footballWinProbability({ ...rates, diff: 0, remaining: 7 }), footballWinProbability({ ...rates, diff: 0, remaining: 1 }), 0, 'remaining clamps to 1');
  }
  assert.equal(footballWinProbability(), 0.5);
  assert.equal(footballWinProbability({ rA: NaN, rD: undefined, diff: 1, remaining: 1 }), 1, 'no rates: the score stands');
});

test('football: the chance moves monotonically as the clock runs down', () => {
  const rates = [0.3, 0.6, 1, 1.28, 2, 3.5, 5.7];
  for (const rA of rates) {
    for (const rD of rates) {
      for (const diff of [-2, -1, 0, 1, 2]) {
        const leader = diff > 0 ? 'A' : 'D';
        const leaderRate = diff > 0 ? rA : rD, trailerRate = diff > 0 ? rD : rA;
        const chances = Array.from({ length: 91 }, (_, t) => footballWinProbability({ rA, rD, diff, remaining: (90 - t) / 90 }));
        for (let t = 1; t <= 90; t++) {
          if (diff === 0) {
            assert.ok(Math.abs(chances[t] - 0.5) <= Math.abs(chances[t - 1] - 0.5) + 1e-12, `level drifts to ½: ${rA} ${rD} t=${t}`);
          } else {
            const now = leader === 'A' ? chances[t] : 1 - chances[t];
            const before = leader === 'A' ? chances[t - 1] : 1 - chances[t - 1];
            // A leader that is not the stronger side only gains from time running out. (A stronger leader can
            // briefly prefer more time, because it is also likely to extend the lead: the formula is right there.)
            if (leaderRate <= trailerRate) assert.ok(now >= before - 1e-12, `leader gains: ${rA} ${rD} ${diff} t=${t}`);
            assert.ok((leader === 'A' ? chances[90] : 1 - chances[90]) >= now - 1e-12, 'full time is the leader\'s best value');
          }
        }
        if (diff !== 0) assert.equal(chances[90], diff > 0 ? 1 : 0);
      }
    }
  }
});

test('the kick-off value stays close to the fixture odds (documented tolerance)', () => {
  // The README formula omits match-day form, tempo and shoot-out skill (src/engine/winProbability.js header):
  // under the default 'balanced' uncertainty it sits within 6.5 points of the Monte Carlo fixture odds (mean ≤ 3),
  // and within 4 points under 'predictable'.
  for (const [drama, maxGap, meanGap] of [[6, 0.065, 0.03], [0, 0.04, 0.025]]) {
    let total = 0;
    for (const [a, d] of FOOTBALL_PAIRS) {
      const attacker = nation(football, a), defender = nation(football, d);
      const model = liveModelFor(football, attacker, defender, undefined, undefined, drama);
      const p0 = winSeries({ model, goals: [], aId: attacker.id, minute: 0 })[0].p;
      const odds = estimateWinProbability({ sport: football, attacker, defender, drama, samples: 20000 }).attacker;
      close(p0, odds, maxGap, `${a}-${d} drama ${drama}`);
      total += Math.abs(p0 - odds);
    }
    assert.ok(total / FOOTBALL_PAIRS.length <= meanGap, `mean gap ${total / FOOTBALL_PAIRS.length} at drama ${drama}`);
  }
});

test('liveModelFor returns small persistable models and null when it cannot model the match', () => {
  const fa = nation(football, 'ITA'), fd = nation(football, 'HUN');
  const ba = nation(basketball, 'SRB'), bd = nation(basketball, 'ITA');
  const before = JSON.stringify([fa, fd, ba, bd]);
  const footballModel = liveModelFor(football, fa, fd, 80.1, 74.2, 6);
  assert.deepEqual(Object.keys(footballModel), ['kind', 'rA', 'rD', 'length']);
  assert.equal(footballModel.kind, 'poisson');
  assert.equal(footballModel.length, 90);

  const basketballModel = liveModelFor(basketball, ba, bd, undefined, undefined, 6);
  assert.deepEqual(Object.keys(basketballModel), ['kind', 'pace', 'effA', 'effD', 'formSd', 'length', 'ot', 'maxOt']);
  const prepared = basketball.prepareMatch(ba, bd);
  assert.deepEqual(basketballModel, { kind: 'normal', pace: prepared.pace, effA: prepared.efficiencyA, effD: prepared.efficiencyD,
    formSd: 6 * 0.0125, length: 40, ot: 5, maxOt: 4 });
  const tactical = liveModelFor('basketball', ba, bd, 82, 77, 6);
  const preparedTactical = basketball.prepareMatch(ba, bd, 82, 77);
  assert.equal(tactical.effA, preparedTactical.efficiencyA);
  assert.equal(tactical.effD, preparedTactical.efficiencyD);
  for (const [drama, formSd] of [[0, 0], [12, 0.15], [20, 0.15], [undefined, 0.075], [NaN, 0.075]]) {
    close(liveModelFor(basketball, ba, bd, undefined, undefined, drama).formSd, formSd, 1e-12, `drama ${drama}`);
  }

  for (const model of [footballModel, basketballModel]) {
    assert.ok(isLiveModel(model));
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model, 'plain JSON numbers only');
    assert.ok(JSON.stringify(model).length < 220);
  }
  assert.equal(JSON.stringify([fa, fd, ba, bd]), before, 'teams are not mutated');

  assert.equal(liveModelFor(football, fa, null), null);
  assert.equal(liveModelFor(null, fa, fd), null);
  assert.equal(liveModelFor({ id: 'chess', tieBreak: 'shootout' }, fa, fd), null);
  assert.equal(liveModelFor({ ...football, prepareMatch() { throw new Error('broken'); } }, fa, fd), null);
  assert.equal(liveModelFor({ ...football, tieBreak: 'replay' }, fa, fd), null, 'an unknown tie-break is not modelled');
  for (const junk of [null, undefined, {}, 'poisson', { kind: 'poisson', rA: NaN, rD: 1, length: 90 }, { kind: 'poisson', rA: 1, rD: -1, length: 90 },
    { ...basketballModel, maxOt: 1.5 }, { ...basketballModel, pace: 0 }, { kind: 'elo' }]) {
    assert.equal(isLiveModel(junk), false, JSON.stringify(junk));
    assert.deepEqual(winSeries({ model: junk, goals: [], aId: 'A', minute: 30 }), []);
    assert.equal(winProbabilityAt(junk, 30, 0), null);
  }
});

test('basketball approximation: exact step at zero possessions, monotone in margin and time, symmetric', () => {
  const effA = 1.1766, effD = 1.048, formSd = 0.075;
  assert.equal(basketballWinProbability({ effA, effD, formSd, margin: 3, remainingPossessions: 0 }), 1);
  assert.equal(basketballWinProbability({ effA, effD, formSd, margin: -1, remainingPossessions: 0 }), 0);
  assert.equal(basketballWinProbability({ effA, effD, formSd, margin: 0, remainingPossessions: 0 }), 0.5);
  assert.equal(basketballWinProbability({ effA, effD, formSd, margin: 0, remainingPossessions: 0, tieA: 0.3 }), 0.3);
  assert.equal(basketballWinProbability(), 0.5);
  for (const R of [2, 9, 30, 73]) {
    let previous = -1;
    for (let margin = -30; margin <= 30; margin++) {
      const p = basketballWinProbability({ effA, effD, formSd, margin, remainingPossessions: R });
      assert.ok(p >= previous - 1e-12 && p >= 0 && p <= 1, `margin ${margin} R ${R}`);
      close(p + basketballWinProbability({ effA: effD, effD: effA, formSd, margin: -margin, remainingPossessions: R }), 1, 1e-9, 'symmetric');
      previous = p;
    }
    assert.ok(basketballWinProbability({ effA, effD, margin: 1, remainingPossessions: R }) > basketballWinProbability({ effA, effD, margin: -1, remainingPossessions: R }));
  }
  // Equal sides: a lead only grows safer as the clock runs; a level game stays a coin flip.
  const even = { kind: 'normal', pace: 73, effA: 1.11, effD: 1.11, formSd: 0.075, length: 40, ot: 5, maxOt: 4 };
  for (const lead of [1, 4, 12]) {
    for (let t = 1; t <= 40; t++) assert.ok(winProbabilityAt(even, t, lead) >= winProbabilityAt(even, t - 1, lead) - 1e-12, `lead ${lead} t=${t}`);
    assert.equal(winProbabilityAt(even, 40, lead), 1);
    assert.equal(winProbabilityAt(even, 40, -lead), 0);
  }
  for (const t of [0, 20, 40, 47]) close(winProbabilityAt(even, t, 0), 0.5, 1e-9, `level t=${t}`);
});

test('basketball tip-off value matches the simulated fixture odds at every uncertainty preset', () => {
  for (const drama of [0, 6, 12]) {
    for (const [a, d] of BASKETBALL_PAIRS) {
      const attacker = nation(basketball, a), defender = nation(basketball, d);
      const model = liveModelFor(basketball, attacker, defender, undefined, undefined, drama);
      const odds = estimateWinProbability({ sport: basketball, attacker, defender, drama, samples: 20000 }).attacker;
      close(winProbabilityAt(model, 0, 0), odds, 0.025, `${a}-${d} drama ${drama}`);
    }
  }
});

test('basketball mid-game values are calibrated against full simulated matches', () => {
  const attacker = { ...nation(basketball, 'SRB'), id: 'SIM-A' }, defender = { ...nation(basketball, 'ITA'), id: 'SIM-D' };
  const model = liveModelFor(basketball, attacker, defender, undefined, undefined, 6);
  const count = 2500;
  for (const minute of [20, 36]) {
    let predicted = 0, wins = 0, brier = 0, baseline = 0;
    const p0 = winProbabilityAt(model, 0, 0);
    const bins = Array.from({ length: 5 }, () => ({ p: 0, wins: 0, n: 0 }));
    for (let seed = 0; seed < count; seed++) {
      const match = basketball.simulate(makeRng(5000 + seed), attacker, defender, 6);
      const shown = match.ev.filter(event => event.m <= minute);
      const p = winSeries({ model, goals: shown, aId: attacker.id, minute }).at(-1).p;
      const won = match.winner === attacker.id ? 1 : 0;
      predicted += p; wins += won;
      brier += (p - won) ** 2; baseline += (p0 - won) ** 2;
      const bin = bins[Math.min(4, Math.floor(p * 5))];
      bin.p += p; bin.wins += won; bin.n++;
    }
    close(predicted / count, wins / count, 0.03, `mean chance at ${minute}'`);
    assert.ok(brier < baseline * 0.9, `the live value carries information at ${minute}'`);
    for (const bin of bins) if (bin.n >= 200) close(bin.p / bin.n, bin.wins / bin.n, 0.07, `calibration bin at ${minute}'`);
  }
});

test('winSeries: one point per minute from 0\', goals step at their minute, the perspective flips', () => {
  const attacker = nation(football, 'ITA'), defender = nation(football, 'HUN');
  const model = liveModelFor(football, attacker, defender);
  const aId = attacker.id, dId = defender.id;
  const goals = [{ m: 24, tid: dId, name: 'D', pts: 1 }, { m: 29, tid: aId, name: 'A', pts: 1 }];
  const series = winSeries({ model, goals, aId, minute: 38 });
  assert.equal(series.length, 39);
  assert.deepEqual(series.map(point => point.t), Array.from({ length: 39 }, (_, t) => t));
  const at = (diff, t) => footballWinProbability({ rA: model.rA, rD: model.rD, diff, remaining: (90 - t) / 90 });
  assert.equal(series[0].p, at(0, 0));
  assert.equal(series[23].p, at(0, 23));
  assert.equal(series[24].p, at(-1, 24));
  assert.equal(series[28].p, at(-1, 28));
  assert.equal(series[29].p, at(0, 29));
  assert.equal(series[38].p, at(0, 38));
  assert.ok(series[24].p < series[23].p - 0.2, 'conceding drops the line');

  const fromD = winSeries({ model, goals, aId, minute: 38, perspective: 'D' });
  series.forEach((point, i) => assert.equal(fromD[i].p, 1 - point.p));
  assert.deepEqual(winSeries({ model, goals, aId, dId, minute: 38, perspective: dId }), fromD, 'perspective as the defender id');
  assert.deepEqual(winSeries({ model, goals, aId, dId, minute: 38, perspective: aId }), series, 'perspective as the attacker id');

  // The chart never lags the revealed score: a goal shown at 24' while the minute store still reads 23.
  assert.equal(winSeries({ model, goals: goals.slice(0, 1), aId, minute: 23 }).length, 25);
  assert.deepEqual(winSeries({ model, goals: [], aId, minute: -4 }), [{ t: 0, p: at(0, 0) }]);
  assert.equal(winSeries({ model, goals: [], aId, minute: 140 }).length, 91, 'football stops at 90\'');
  assert.equal(winSeries({ model, goals: [{ m: 50, tid: aId }], aId, minute: 60 }).at(-1).p, at(1, 60), 'pts defaults to 1');
});

test('winSeries at full time: 1 / 0 for the winner, ½ when level, the shoot-out winner snaps to 1', () => {
  const attacker = nation(football, 'GER'), defender = nation(football, 'AUT');
  const model = liveModelFor(football, attacker, defender);
  const aId = attacker.id, dId = defender.id;
  const level = [{ m: 12, tid: aId, pts: 1 }, { m: 70, tid: dId, pts: 1 }];
  assert.equal(winSeries({ model, goals: [{ m: 12, tid: aId, pts: 1 }], aId, minute: 90 }).at(-1).p, 1);
  assert.equal(winSeries({ model, goals: [{ m: 12, tid: dId, pts: 1 }], aId, minute: 90 }).at(-1).p, 0);
  assert.equal(winSeries({ model, goals: level, aId, minute: 90 }).at(-1).p, 0.5, 'level at 90\': the shoot-out is 50/50');

  // Shoot-out won by the defender: the series ends at 0 from A's side, 1 from the winner's side.
  const shootout = winSeries({ model, goals: level, aId, dId, minute: 90, final: { winnerSide: 'D' } });
  assert.equal(shootout.length, 91);
  assert.equal(shootout.at(-1).p, 0);
  assert.equal(shootout.at(-2).p, winSeries({ model, goals: level, aId, minute: 90 }).at(-2).p, 'only the last point snaps');
  assert.equal(winSeries({ model, goals: level, aId, dId, minute: 90, perspective: 'D', final: { winnerSide: 'D' } }).at(-1).p, 1);
  assert.equal(winSeries({ model, goals: level, aId, dId, minute: 90, final: { winnerId: aId } }).at(-1).p, 1);
  assert.equal(winSeries({ model, goals: level, aId, dId, minute: 90, perspective: dId, final: { winnerId: dId } }).at(-1).p, 1);
  // A finished match (revealAll) is drawn to full time whatever the minute store says.
  const revealed = winSeries({ model, goals: [{ m: 12, tid: dId, pts: 1 }], aId, dId, minute: 40, final: { winnerId: dId } });
  assert.equal(revealed.length, 91);
  assert.equal(revealed.at(-1).p, 0);
  assert.equal(winSeries({ model, goals: [], aId, minute: 30, final: {} }).length, 91, 'final without a winner still runs to full time');
});

test('basketball series: overtime extends the domain and a level buzzer carries the overtime chain', () => {
  const attacker = nation(basketball, 'SRB'), defender = nation(basketball, 'ITA');
  const model = liveModelFor(basketball, attacker, defender, undefined, undefined, 6);
  const aId = attacker.id, dId = defender.id;
  const regulation = [{ m: 8, tid: aId, pts: 7 }, { m: 22, tid: dId, pts: 9 }, { m: 39, tid: aId, pts: 2 }];
  const series = winSeries({ model, goals: regulation, aId, minute: 40 });
  assert.equal(series.length, 41);
  const buzzer = series.at(-1).p;
  assert.ok(buzzer > 0.5 && buzzer < 0.75, `level at 40': the stronger side's overtime chance (${buzzer})`);
  assert.equal(buzzer, winProbabilityAt(model, 40, 0));
  assert.equal(series[8].p, winProbabilityAt(model, 8, 7));
  assert.equal(series[22].p, winProbabilityAt(model, 22, -2));

  const overtime = regulation.concat([{ m: 42, tid: dId, pts: 2 }, { m: 44, tid: aId, pts: 5 }]);
  const withOt = winSeries({ model, goals: overtime, aId, minute: 45 });
  assert.equal(withOt.length, 46);
  assert.equal(withOt.at(-1).p, 1, 'three points up when the first overtime ends');
  assert.ok(withOt[43].p < withOt[41].p, 'trailing inside overtime');
  assert.equal(winSeries({ model, goals: overtime, aId, minute: 43, final: { winnerSide: 'A' } }).length, 46,
    'a finished match runs to the end of the last overtime played');
  assert.equal(winSeries({ model, goals: overtime, aId, minute: 45, perspective: 'D' }).at(-1).p, 0);
  assert.equal(winSeries({ model, goals: [], aId, minute: 90 }).length, 61, 'four overtimes at most');
  assert.ok(winProbabilityAt(model, 60, 0) > 0.5, 'the last overtime\'s decisive play still favours the stronger side');
});

test('chartGeometry draws the README chart in the 800×132 viewBox', () => {
  const geometry = chartGeometry([{ t: 0, p: 0.5 }, { t: 45, p: 0.75 }, { t: 90, p: 1 }], { markers: [{ t: 45, p: 0.75 }] });
  assert.deepEqual(geometry, {
    line: 'M0,66L400,33L800,0',
    area: 'M0,66L400,33L800,0L800,132L0,132Z',
    now: { x: 800, y: 0 },
    markers: [{ x: 400, y: 33 }],
    half: { x: 400 },
  });

  const model = liveModelFor(football, nation(football, 'ITA'), nation(football, 'HUN'));
  const series = winSeries({ model, goals: [], aId: 'x', minute: 38 });
  const drawn = chartGeometry(series);
  const vertices = drawn.line.split(/[ML]/).filter(Boolean).map(pair => pair.split(',').map(Number));
  assert.equal(vertices.length, series.length);
  series.forEach(({ t, p }, i) => {
    close(vertices[i][0], (t / 90) * 800, 0.05, `x at ${t}`);
    close(vertices[i][1], 132 - p * 132, 0.05, `y at ${t}`);
  });
  assert.deepEqual(drawn.now, { x: vertices.at(-1)[0], y: vertices.at(-1)[1] });
  assert.ok(drawn.area.startsWith(drawn.line) && drawn.area.endsWith(`L${drawn.now.x},132L0,132Z`));
  assert.ok(!/\d\.\d\d/.test(drawn.line), 'one decimal at most');

  assert.deepEqual(chartGeometry([{ t: 20, p: 0.25 }], { length: 40, half: 20 }), {
    line: 'M400,99', area: 'M400,99L400,132L400,132Z', now: { x: 400, y: 99 }, markers: [], half: { x: 400 },
  });
  assert.deepEqual(chartGeometry([], {}), { line: '', area: '', now: { x: 0, y: 66 }, markers: [], half: { x: 400 } });
  assert.deepEqual(chartGeometry(null), { line: '', area: '', now: { x: 0, y: 66 }, markers: [], half: { x: 400 } });
  assert.deepEqual(chartGeometry([{ t: -5, p: 2 }, { t: 120, p: -1 }]).line, 'M0,0L800,132', 'clamped to the viewBox');
});

test('winMarkers, chartDomain and liveWinChart give the chart its markers, axis and current value', () => {
  const attacker = nation(football, 'SRB'), defender = nation(football, 'ITA');
  const model = liveModelFor(football, attacker, defender);
  const aId = attacker.id, dId = defender.id;
  const goals = [{ m: 24, tid: aId, pts: 1 }, { m: 29, tid: dId, pts: 1 }];
  const series = winSeries({ model, goals, aId, dId, minute: 38, perspective: dId });
  assert.deepEqual(winMarkers(series, goals, { aId, model }), [
    { t: 24, side: 'A', p: series[24].p }, { t: 29, side: 'D', p: series[29].p },
  ], 'markers sit on the post-goal value');
  assert.deepEqual(winMarkers(series.slice(0, 26), goals, { aId, model }).map(marker => marker.t), [24]);
  assert.deepEqual(winMarkers([], goals, { aId }), []);

  assert.deepEqual(chartDomain(model, 38), { length: 90, half: 45, ticks: [0, 15, 30, 45, 60, 75, 90], guides: [45] });
  assert.deepEqual(chartDomain(null), chartDomain(model), 'no model: the football axis');
  const bModel = liveModelFor(basketball, nation(basketball, 'ESP'), nation(basketball, 'FRA'), undefined, undefined, 6);
  assert.deepEqual(chartDomain(bModel, 30), { length: 40, half: 20, ticks: [0, 10, 20, 30, 40], guides: [10, 20, 30] });
  assert.deepEqual(chartDomain(bModel, 47), { length: 50, half: 20, ticks: [0, 10, 20, 30, 40, 45, 50], guides: [10, 20, 30] });
  assert.equal(chartDomain(bModel, 99).length, 60);
  assert.deepEqual(winMarkers(winSeries({ model: bModel, goals: [{ m: 4, tid: 'x', pts: 6 }], aId: 'x', minute: 10 }),
    [{ m: 4, tid: 'x', pts: 6 }], { aId: 'x', model: bModel }), [], 'basketball scoring runs carry no markers by default');

  const chart = liveWinChart({ model, goals, aId, dId, minute: 38, perspective: dId });
  assert.deepEqual(chart.series, series);
  assert.equal(chart.p, series.at(-1).p);
  assert.deepEqual(chart.domain, chartDomain(model, 38));
  assert.deepEqual(chart.geometry, chartGeometry(series, { length: 90, half: 45, markers: chart.markers }));
  assert.equal(chart.geometry.markers.length, 2);
  const none = liveWinChart({ model: null, goals, aId, minute: 38 });
  assert.equal(none.p, null);
  assert.deepEqual(none.series, []);
});

test('perspectiveSide plots the managed side, else the followed side, else the attacker', () => {
  const match = { aId: 'ITA', dId: 'SRB' };
  assert.equal(perspectiveSide({ ...match, managedId: 'SRB', followedId: 'ITA' }), 'D');
  assert.equal(perspectiveSide({ ...match, managedId: 'ITA' }), 'A');
  assert.equal(perspectiveSide({ ...match, managedId: 'GER', followedId: 'SRB' }), 'D', 'managed team not playing');
  assert.equal(perspectiveSide({ ...match, managedId: null, followedId: 'ITA' }), 'A');
  assert.equal(perspectiveSide({ ...match, managedId: 'GER', followedId: 'FRA' }), 'A', 'neither plays: the attacker');
  assert.equal(perspectiveSide(), 'A');
});

test('the live model never touches an RNG and stays pure', () => {
  const source = readFileSync(new URL('../src/engine/winProbability.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of [/\brng\b/, /Math\.random/, /makeRng/, /estimateWinProbability/, /sampleResult/, /\.simulate\(/,
    /\bwindow\b/, /\bdocument\b/, /localStorage/, /setTimeout|setInterval|requestAnimationFrame/]) {
    assert.ok(!forbidden.test(code), `winProbability.js must not use ${forbidden}`);
  }
  const attacker = nation(football, 'ITA'), defender = nation(football, 'HUN');
  const bA = nation(basketball, 'SRB'), bD = nation(basketball, 'ITA');
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random must not be used'); };
  try {
    const model = liveModelFor(football, attacker, defender, 80, 75, 6);
    const bModel = liveModelFor(basketball, bA, bD, 80, 75, 6);
    const goals = [{ m: 24, tid: attacker.id, pts: 1 }];
    const input = JSON.stringify({ model, bModel, goals });
    liveWinChart({ model, goals, aId: attacker.id, minute: 90, final: { winnerId: attacker.id } });
    liveWinChart({ model: bModel, goals: [{ m: 41, tid: bA.id, pts: 3 }], aId: bA.id, minute: 45 });
    footballWinProbability({ rA: 2, rD: 1, diff: 0, remaining: 0.5 });
    basketballWinProbability({ effA: 1.1, effD: 1, margin: 3, remainingPossessions: 20 });
    winProbabilityAt(bModel, 52, 0);
    assert.equal(JSON.stringify({ model, bModel, goals }), input, 'inputs are not mutated');
  } finally {
    Math.random = random;
  }
});

test('sport profile exports: the match model\'s positional ratings, without the effective offset', () => {
  // Append-only exports: every existing export is still there and the sport objects are unchanged.
  assert.deepEqual(Object.keys(footballModule).sort(), ['football', 'footballProfile', 'prepareFootballMatch', 'sampleFootballResult']);
  assert.deepEqual(Object.keys(basketballModule).sort(), ['basketball', 'basketballProfile', 'prepareMatch', 'sampleResult']);
  assert.equal(football.prepareMatch, prepareFootballMatch);
  assert.equal(basketball.prepareMatch, basketballModule.prepareMatch);

  for (const [a, d] of FOOTBALL_PAIRS.slice(0, 6)) {
    const attacker = nation(football, a), defender = nation(football, d);
    const prepared = prepareFootballMatch(attacker, defender);
    const pa = footballProfile(selectLineup(attacker)), pd = footballProfile(selectLineup(defender));
    assert.deepEqual(Object.keys(pa), ['attack', 'defence', 'keeper']);
    assert.equal((pa.attack - pd.defence) * 0.075, prepared.logA, `${a} attack v ${d} defence is the model's logA`);
    assert.equal((pd.attack - pa.defence) * 0.075, prepared.logD);
    assert.deepEqual(footballProfile(attacker), pa, 'a team is accepted and its lineup selected');
    const goalkeeper = selectLineup(attacker).slots.find(slot => slot.position === 'GK');
    assert.equal(pa.keeper, goalkeeper.effectiveRating);
  }
  const side = uniform(football, 'U', 75);
  for (const value of Object.values(footballProfile(side))) close(value, 75, 1e-9, 'weights sum to 1');
  side.squad[0].rating = 89; // goalkeeper
  const profiled = footballProfile(side);
  close(profiled.keeper, 89, 1e-12);
  close(profiled.defence, 75 + 14 * 0.24, 1e-9, 'the keeper weighs .24 of defence');
  close(profiled.attack, 75, 1e-9, 'and nothing of attack');
  assert.deepEqual(footballProfile(null), { attack: 0, defence: 0, keeper: 0 });
  assert.deepEqual(footballProfile(uniform(basketball, 'B', 80)), { attack: 0, defence: 0, keeper: 0 }, 'no football positions');

  for (const [a, d] of BASKETBALL_PAIRS.slice(0, 5)) {
    const attacker = nation(basketball, a), defender = nation(basketball, d);
    const prepared = basketball.prepareMatch(attacker, defender);
    const pa = basketballProfile(selectLineup(attacker)), pd = basketballProfile(selectLineup(defender));
    assert.deepEqual(Object.keys(pa), ['offence', 'defence']);
    assert.equal(clamp(1.11 + (pa.offence - 74) * 0.010 - (pd.defence - 74) * 0.0065, 0.54, 1.67), prepared.efficiencyA);
    assert.equal(clamp(1.11 + (pd.offence - 74) * 0.010 - (pa.defence - 74) * 0.0065, 0.54, 1.67), prepared.efficiencyD);
    assert.deepEqual(basketballProfile(attacker), pa);
  }
  const five = uniform(basketball, 'F', [80, 70, 75, 75, 90]); // PG SG SF PF C
  const profile = basketballProfile(five);
  close(profile.offence, 80 * 0.25 + 70 * 0.25 + 75 * 0.2 + 75 * 0.15 + 90 * 0.15, 1e-9);
  close(profile.defence, 80 * 0.15 + 70 * 0.15 + 75 * 0.2 + 75 * 0.22 + 90 * 0.28, 1e-9);
  assert.deepEqual(basketballProfile(null), { offence: 0, defence: 0 });
  assert.deepEqual(basketballProfile(selectLineup(uniform(football, 'G', 80))), { offence: 0, defence: 0 }, 'no basketball positions');
});
