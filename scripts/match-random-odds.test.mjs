import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, selectLineup } from '../src/data/teams.js';
import { gauss, minuteSampler, poisson } from '../src/engine/random.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { football } from '../src/sports/football.js';

const team = (id, rating = 75) => ({ id, sport: 'football', squad: football.positionPlan.map((pos, i) => ({ pos, name: `${id}${i}`, rating })) });

test('Poisson sampling preserves its mean, variance and zero-goal probability', () => {
  for (const lambda of [.25, 1.28, 5.5]) {
    const rng = makeRng(74621), count = 60000;
    let sum = 0, squares = 0, zeros = 0;
    for (let i = 0; i < count; i++) {
      const value = poisson(rng, lambda);
      sum += value; squares += value ** 2; zeros += value === 0;
    }
    const mean = sum / count;
    assert.ok(Math.abs(mean - lambda) < .035, `${lambda}: mean ${mean}`);
    assert.ok(Math.abs(squares / count - mean ** 2 - lambda) < .09, `${lambda}: variance`);
    assert.ok(Math.abs(zeros / count - Math.exp(-lambda)) < .009, `${lambda}: P(0)`);
  }
});

test('normal form samples are centred with unit variance and finite at endpoints', () => {
  const rng = makeRng(896413), count = 60000;
  let sum = 0, squares = 0;
  for (let i = 0; i < count; i++) { const value = gauss(rng); sum += value; squares += value ** 2; }
  assert.ok(Math.abs(sum / count) < .02);
  assert.ok(Math.abs(squares / count - (sum / count) ** 2 - 1) < .035);
  for (const value of [0, .5, 1]) assert.ok(Number.isFinite(gauss(() => value)));
});

test('endpoint goal draws and exhausted distinct minutes finish without rejection loops', () => {
  for (const lambda of [.1, 1.28, 3.2, 4.7, 8.7]) {
    let draws = 0;
    const score = poisson(() => { draws++; return 1; }, lambda);
    assert.equal(draws, 1);
    assert.ok(score >= 0 && score < 60);
  }
  assert.equal(poisson(() => { throw new Error('zero rate needs no entropy'); }, 0), 0);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => poisson(() => .5, invalid), RangeError);
  for (const value of [0, .5, 1]) {
    let draws = 0;
    const sample = minuteSampler(() => { draws++; return value; }, 90);
    const minutes = Array.from({ length: 90 }, sample);
    assert.equal(new Set(minutes).size, 90);
    assert.ok(minutes.every(minute => minute >= 1 && minute <= 90));
    assert.equal(draws, 90);
    assert.throws(sample, RangeError);
  }
});

test('odds prepare once and sample scores without building any event timelines', () => {
  let prepares = 0, samples = 0, timelines = 0;
  const model = {
    ...football, id: 'fast-path-probe',
    prepareMatch(a, d) { prepares++; return { lineupA: selectLineup(a), lineupD: selectLineup(d), a, d }; },
    sampleResult(_rng, prepared) { samples++; return { winner: samples % 2 ? prepared.a.id : prepared.d.id }; },
    simulate() { timelines++; throw new Error('odds must not produce an event timeline'); },
  };
  const result = estimateWinProbability({ sport: model, attacker: team('same'), defender: team('same'), samples: 128 });
  assert.equal(prepares, 1);
  assert.equal(samples, 128);
  assert.equal(timelines, 0);
  assert.equal(result.attacker, .5, 'normalised IDs keep same-ID probes unambiguous');
});

test('custom models sharing a sport ID do not inherit one another’s cached odds', () => {
  const a = team('A'), d = team('D');
  const first = { ...football, id: 'custom-cache', sampleResult(_rng, prepared) { return { winner: prepared.aId }; } };
  const second = { ...first, sampleResult(_rng, prepared) { return { winner: prepared.dId }; } };
  assert.equal(estimateWinProbability({ sport: first, attacker: a, defender: d, samples: 128 }).attacker, 1);
  assert.equal(estimateWinProbability({ sport: second, attacker: a, defender: d, samples: 128 }).attacker, 0);
});

test('sports without a score-only API retain working odds and never mutate the campaign RNG', () => {
  const rng = makeRng(3178), state = rng.getState();
  let calls = 0;
  const model = { id: 'fallback-probe', simulate(_rng, a, d, drama, effA, effD) {
    calls++; assert.equal(drama, 6); assert.equal(effA, 75); assert.equal(effD, 75);
    return { winner: calls % 2 ? a.id : d.id };
  } };
  assert.equal(estimateWinProbability({ sport: model, attacker: team('A'), defender: team('D'), samples: 128 }).attacker, .5);
  assert.equal(calls, 128);
  assert.equal(rng.getState(), state);
});

test('positional lineup changes invalidate odds even at unchanged overall strength', () => {
  const attacker = team('role-change', 70), defender = team('opponent', 70);
  attacker.squad[0].rating = 90;
  const before = estimateWinProbability({ sport: football, attacker, defender, samples: 10000 });
  [attacker.squad[0].rating, attacker.squad[9].rating] = [attacker.squad[9].rating, attacker.squad[0].rating];
  const after = estimateWinProbability({ sport: football, attacker, defender, samples: 10000 });
  assert.notStrictEqual(before, after);
  assert.notEqual(before.attacker, after.attacker);
  const rename = { ...attacker, squad: attacker.squad.map(player => ({ ...player, name: `Renamed ${player.name}` })) };
  assert.strictEqual(after, estimateWinProbability({ sport: football, attacker: rename, defender, samples: 10000 }));
});

test('unfilled legacy shirts cannot reuse a full lineup’s penalty estimate', () => {
  const full = team('full', 40), defender = team('opponent', 40);
  const missing = { ...full, squad: full.squad.filter(player => player.pos !== 'GK') };
  assert.equal(selectLineup(full).rating, selectLineup(missing).rating);
  const args = { sport: football, defender, samples: 128 };
  const before = estimateWinProbability({ ...args, attacker: full });
  const after = estimateWinProbability({ ...args, attacker: missing });
  assert.notStrictEqual(before, after, 'real takers and absent shirts differ even at the same lineup rating');
});
