import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/data/teams.js';
import { basketball } from '../src/sports/basketball.js';

const side = (id, ratings = 74) => ({
  id,
  sport: 'basketball',
  squad: basketball.positionPlan.map((pos, i) => ({ name: `${id}-${pos}`, pos, rating: Array.isArray(ratings) ? ratings[i] : ratings })),
});

test('basketball presentation uses exactly the score-only outcome and selected scorers', () => {
  const attacker = side('A', 79);
  const defender = side('D', 74);
  attacker.squad.push({ name: 'Unused reserve', pos: 'PG', rating: 40 });
  const prepared = basketball.prepareMatch(attacker, defender);
  const namesA = new Set(prepared.lineupA.starters.map(player => player.name));
  const namesD = new Set(prepared.lineupD.starters.map(player => player.name));
  let overtimes = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const outcome = basketball.sampleResult(makeRng(seed), prepared, 6);
    const full = basketball.simulate(makeRng(seed), attacker, defender, 6);
    assert.deepEqual({ ga: full.ga, gd: full.gd, tie: full.tie, winner: full.winner }, {
      ga: outcome.ga, gd: outcome.gd, tie: outcome.tie, winner: outcome.winner,
    });
    assert.equal(full.ev.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), full.ga);
    assert.equal(full.ev.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), full.gd);
    assert.ok(full.ev.every((event, i) => Number.isInteger(event.m) && event.m > 0 && event.pts > 0
      && (event.tid === 'A' ? namesA : namesD).has(event.name) && (!i || full.ev[i - 1].m <= event.m)));
    assert.equal(full.ev.filter(event => event.m <= 40 && event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), outcome.regA);
    assert.equal(full.ev.filter(event => event.m <= 40 && event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), outcome.regD);
    if (full.tie) {
      overtimes++;
      assert.equal(outcome.regA, outcome.regD);
      assert.equal(full.tie.ga, full.ga);
      assert.equal(full.tie.gd, full.gd);
      full.tie.periods.forEach(([a, d], period) => {
        const periodEvents = full.ev.filter(event => event.m > 40 + period * 5 && event.m <= 45 + period * 5);
        assert.equal(periodEvents.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), a);
        assert.equal(periodEvents.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), d);
        if (period < full.tie.periods.length - 1) assert.equal(a, d);
      });
    } else assert.ok(full.ev.every(event => event.m <= 40));
    assert.notEqual(full.ga, full.gd);
    assert.equal(full.winner, full.ga > full.gd ? 'A' : 'D');
  }
  assert.ok(overtimes > 0, 'the fixture seeds must exercise overtime accounting');
});

test('four tied overtimes end with recorded points and either side can win the fallback', () => {
  const attacker = side('A');
  const defender = side('D');
  for (const [choice, winner] of [[0.1, 'A'], [0.9, 'D']]) {
    let draws = 0;
    const rng = () => draws++ === 36 ? choice : 0;
    const result = basketball.simulate(rng, attacker, defender, 0);
    assert.equal(result.winner, winner);
    assert.equal(result.tie.periods.length, 4);
    assert.deepEqual(result.tie.periods.slice(0, 3), [[10, 10], [10, 10], [10, 10]]);
    assert.deepEqual(result.tie.periods[3], winner === 'A' ? [11, 10] : [10, 11]);
    assert.equal(result.ga - result.tie.periods.reduce((sum, period) => sum + period[0], 0), 81);
    assert.equal(result.gd - result.tie.periods.reduce((sum, period) => sum + period[1], 0), 81);
    assert.equal(result.ev.filter(event => event.tid === 'A').reduce((sum, event) => sum + event.pts, 0), result.ga);
    assert.equal(result.ev.filter(event => event.tid === 'D').reduce((sum, event) => sum + event.pts, 0), result.gd);
    assert.ok(result.ev.every(event => event.m <= 60));
    assert.ok(draws < 1000, 'an adversarial random stream must still finish promptly');
  }
});

test('basketball ratings reflect positional offence and rim protection', () => {
  const neutral = side('D');
  const guards = basketball.prepareMatch(side('A', [90, 90, 70, 60, 60]), neutral);
  const bigs = basketball.prepareMatch(side('A', [60, 60, 70, 90, 90]), neutral);
  assert.equal(guards.lineupA.rating, bigs.lineupA.rating);
  assert.ok(guards.efficiencyA > bigs.efficiencyA, 'strong guards improve scoring efficiency');
  assert.ok(bigs.efficiencyD < guards.efficiencyD, 'strong bigs reduce opposing scoring efficiency');
});

test('matched basketball teams have varied plausible scores, shared pace and fair winners', () => {
  const prepared = basketball.prepareMatch(side('A'), side('D'));
  const rng = makeRng(20261002);
  const count = 30000;
  let a = 0, d = 0, a2 = 0, d2 = 0, ad = 0, margin2 = 0, wins = 0, overtime = 0;
  const scorelines = new Set();
  for (let i = 0; i < count; i++) {
    const result = basketball.sampleResult(rng, prepared, 6);
    a += result.regA;
    d += result.regD;
    a2 += result.regA ** 2;
    d2 += result.regD ** 2;
    ad += result.regA * result.regD;
    margin2 += (result.regA - result.regD) ** 2;
    wins += result.winner === 'A';
    overtime += !!result.tie;
    scorelines.add(`${result.ga}:${result.gd}`);
  }
  const meanA = a / count;
  const meanD = d / count;
  const correlation = (ad / count - meanA * meanD)
    / Math.sqrt((a2 / count - meanA ** 2) * (d2 / count - meanD ** 2));
  assert.ok(meanA > 78 && meanA < 84 && meanD > 78 && meanD < 84);
  assert.ok(wins / count > 0.48 && wins / count < 0.52);
  assert.ok(Math.sqrt(margin2 / count) > 14 && Math.sqrt(margin2 / count) < 18);
  assert.ok(correlation > 0.08 && correlation < 0.4, 'both teams share pace without sharing shooting luck');
  assert.ok(overtime / count > 0.015 && overtime / count < 0.045);
  assert.ok(scorelines.size > 2000);
});
