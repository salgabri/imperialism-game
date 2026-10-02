import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';

const side = id => ({ id, sport: 'football', squad: football.positionPlan.map((pos, i) => ({ name: `${id}-${i}`, pos, rating: 75 })) });

test('shootouts stop on an early clinch and sudden death ends after equal kick counts', () => {
  const prepared = football.prepareMatch(side('A'), side('D'));
  const rng = makeRng(20261002);
  let early = 0, sudden = 0, defenderFirst = 0;
  for (let fixture = 0; fixture < 5000; fixture++) {
    const result = football.sampleResult(rng, prepared, 6);
    if (!result.tie) continue;
    const tie = result.tie;
    const first = tie.first === 'D' ? 'D' : 'A', second = first === 'A' ? 'D' : 'A';
    const scores = { A: 0, D: 0 }, taken = { A: 0, D: 0 };
    const kicks = [];
    for (let round = 0; round < Math.max(tie.A.length, tie.D.length); round++) {
      for (const team of [first, second]) if (round < tie[team].length) kicks.push([team, tie[team][round]]);
    }
    const finished = () => {
      if (taken.A <= 5 && taken.D <= 5) return scores.A > scores.D + 5 - taken.D || scores.D > scores.A + 5 - taken.A;
      return taken.A === taken.D && scores.A !== scores.D;
    };
    kicks.forEach(([team, scored], index) => {
      assert.equal(finished(), false, 'a decided shootout must not schedule another kick');
      taken[team]++; scores[team] += scored;
      if (index === kicks.length - 1) assert.equal(finished(), true, 'the last kick must decide the shootout');
    });
    assert.equal(scores.A, tie.ga); assert.equal(scores.D, tie.gd);
    if (tie.A.length < 5 || tie.D.length < 5) early++;
    if (tie.A.length > 5) { sudden++; assert.equal(tie.A.length, tie.D.length); }
    if (first === 'D') defenderFirst++;
  }
  assert.ok(early > 50 && sudden > 50 && defenderFirst > 100, 'exercise early clinches, sudden death and both kick orders');
});

test('the bounded long-shootout fallback can award either side a recorded decisive kick', () => {
  const attacker = side('A'), defender = side('D');
  for (const first of ['A', 'D']) for (const [coin, winner] of [[.1, 'A'], [.9, 'D']]) {
    let draws = 0;
    const rng = () => {
      const index = draws++;
      if (index === 6) return first === 'A' ? 0 : .9;
      if (index === 57) return coin;
      return 0;
    };
    const result = football.simulate(rng, attacker, defender, 0);
    assert.equal(result.ga, 0); assert.equal(result.gd, 0);
    assert.equal(result.winner, winner);
    assert.equal(result.tie.first, first);
    assert.equal(result.tie.A.length, 26); assert.equal(result.tie.D.length, 26);
    assert.equal(result.tie.A.at(-1), winner === 'A' ? 1 : 0);
    assert.equal(result.tie.D.at(-1), winner === 'D' ? 1 : 0);
    assert.equal(result.tie.ga, result.tie.A.reduce((sum, kick) => sum + kick, 0));
    assert.equal(result.tie.gd, result.tie.D.reduce((sum, kick) => sum + kick, 0));
    assert.equal(draws, 58);
  }
});
