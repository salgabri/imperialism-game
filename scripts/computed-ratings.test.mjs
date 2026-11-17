// The computed-ratings steps every computed season shares (scripts/lib/computed-ratings.mjs; docs/design/computed-ratings.md):
// each checked on synthetic data whose truth is known: a prior the method of moments must find, ratings and a home edge the
// SRS must recover, a slope the simulation must measure, a club move that reaches its target and keeps every order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOISE, RELIABILITY_BOUNDS, WINDOW, blend, clubMoveOf, clubOfStints, mean, perPointOf, pooled, priorFromNoise, priorFromReliability,
  ranksOf, ratingsOf, referenceOf, replacementRate, resultsTargets, seasonReliability, shrunkRate, spearman, srsOf, stabilityWeight,
  winShareOf, zscores,
} from './lib/computed-ratings.mjs';

/** A seeded generator of [0, 1) (mulberry32), so every synthetic draw is the same on every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = rng => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
function poisson(rng, lambda) {
  const limit = Math.exp(-lambda);
  let k = 0, p = rng();
  while (p > limit) { k++; p *= rng(); }
  return k;
}

test('the statistics: mid-ranks, Spearman and z-scores', () => {
  assert.deepEqual(ranksOf([10, 30, 20, 20]), [0, 3, 1.5, 1.5]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2, 3], [5, 5, 5]), 0);
  const z = zscores([2, 4, 6]);
  assert.ok(Math.abs(mean(z)) < 1e-12);
  assert.ok(Math.abs(z[2] - Math.sqrt(1.5)) < 1e-12);
  assert.deepEqual(zscores([7, 7]), [0, 0]);
});

test('a player counts for the club he played the most minutes for, else games, a tie for the later club', () => {
  assert.equal(clubOfStints([{ club: 'A', minutes: 900, games: 30 }, { club: 'B', minutes: 1100, games: 20 }]), 'B');
  assert.equal(clubOfStints([{ club: 'A', games: 30 }, { club: 'B', games: 20 }]), 'A');
  assert.equal(clubOfStints([{ club: 'A', games: 20 }, { club: 'B', games: 20 }]), 'B');
  assert.equal(clubOfStints([]), null);
});

test('the window pools exposure and events at 3:2:1, a season not played adding nothing', () => {
  assert.deepEqual(WINDOW, [3, 2, 1]);
  assert.deepEqual(pooled([{ exposure: 80, events: 40 }, null, { exposure: 10, events: 1 }]), { n: 250, x: 121 });
  assert.deepEqual(pooled([{ exposure: 5, events: 2 }]), { n: 15, x: 6 });
});

test('replacement level is the pooled rate of the quarter with the least exposure', () => {
  const players = [{ n: 1, x: 0 }, { n: 3, x: 1 }, { n: 50, x: 25 }, { n: 60, x: 30 }, { n: 70, x: 40 }, { n: 0, x: 0 },
    { n: 80, x: 40 }, { n: 90, x: 45 }, { n: 100, x: 60 }];
  // Eight with exposure: the two with the least, 1 and 3 games: 1 event in 4.
  assert.equal(replacementRate(players), 0.25);
  assert.throws(() => replacementRate([{ n: 0, x: 0 }]), /No player/);
});

test('the method of moments finds the prior that the noise and the talent imply', () => {
  const rng = seeded(20261117);
  // 600 players: talent 0.5 ± 0.15 a game, 20–80 games each, Poisson events. The prior is noise ÷ talent variance:
  // about 0.5 / 0.0225 = 22 games.
  const players = Array.from({ length: 600 }, () => {
    const rate = Math.max(0.02, 0.5 + 0.15 * gaussian(rng));
    const n = 20 + Math.floor(rng() * 61);
    return { n, x: poisson(rng, rate * n) };
  });
  const { k, talent } = priorFromNoise(players, { least: 20, unitNoise: NOISE.poisson });
  assert.ok(k > 16 && k < 30, `prior ${k}`);
  assert.ok(talent > 0.015 && talent < 0.03, `talent variance ${talent}`);
  // Pure noise has no talent to measure.
  const noise = Array.from({ length: 300 }, () => ({ n: 50, x: poisson(rng, 25) }));
  assert.throws(() => priorFromNoise(noise.map(p => ({ ...p, x: 25 })), { least: 20, unitNoise: NOISE.poisson }), /no talent/);
  assert.throws(() => priorFromNoise(players.slice(0, 2), { least: 20, unitNoise: NOISE.poisson }), /Too few/);
  assert.equal(NOISE.binomial(0.9).toFixed(4), '0.0900');
});

test('the prior from a reliability is the exposure at which a rate is half signal', () => {
  assert.equal(priorFromReliability(0.5, 600), 600);
  assert.equal(priorFromReliability(0.75, 300), 100);
  assert.throws(() => priorFromReliability(1, 600), /between 0 and 1/);
  // A rate shrunk by a prior of k: halfway to replacement at k exposure.
  assert.equal(shrunkRate({ n: 100, x: 60 }, 100, 0.2), 0.4);
  assert.equal(shrunkRate({ n: 0, x: 0 }, 50, 0.2), 0.2);
});

test('a signal weighs by its stability, inside the bounds; a tuned weight overrides it', () => {
  assert.ok(stabilityWeight(0.8) > stabilityWeight(0.4));
  assert.equal(stabilityWeight(0.999), stabilityWeight(RELIABILITY_BOUNDS[1]));
  assert.equal(stabilityWeight(-0.3), stabilityWeight(RELIABILITY_BOUNDS[0]));
  assert.equal(seasonReliability([1, 2, 3, 4], [1, 2, 3, 4]), RELIABILITY_BOUNDS[1]);
  assert.equal(seasonReliability([1, 2, 3, 4], [4, 3, 2, 1]), RELIABILITY_BOUNDS[0]);
  const rng = seeded(7);
  const talent = Array.from({ length: 400 }, () => gaussian(rng));
  const good = talent.map(t => t + 0.3 * gaussian(rng)), poor = talent.map(t => t + 3 * gaussian(rng));
  const mixed = blend([{ values: good, reliability: 0.9 }, { values: poor, reliability: 0.1 }]);
  assert.ok(mixed.weights[0] > 0.9, `weights ${mixed.weights}`);
  assert.ok(spearman(mixed.values, talent) > spearman(poor, talent));
  const fixed = blend([{ values: good, weight: 1 }, { values: poor, weight: 3 }]);
  assert.deepEqual(fixed.weights, [0.25, 0.75]);
  assert.throws(() => blend([{ values: [1, 2], weight: 1 }, { values: [1], weight: 1 }]), /one value a player/);
});

test('ratings are read off the reference by mid-rank, ties sharing one, no value passing a higher one', () => {
  const reference = [60, 70, 80, 90];
  const ratings = ratingsOf([5, 1, 3, 3, 9], reference);
  // Percentiles .1, .4 (the tied pair), .7 and .9 of five, read off four ratings: places −0.1 (held at 0), 1.1, 2.3, 3.1
  // (held at 3).
  assert.deepEqual([1, 3, 5, 9].map(v => ratings.get(v)), [60, 71, 83, 90]);
  const many = Array.from({ length: 50 }, (_, i) => (i * 37) % 23);
  const out = ratingsOf(many, [41, 55, 72, 86, 99]);
  const sorted = [...new Set(many)].sort((a, b) => a - b).map(v => out.get(v));
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] >= sorted[i - 1]);
  assert.ok(sorted.every(r => r >= 1 && r <= 99));
  assert.throws(() => ratingsOf([1], []), /No reference/);
});

test('the reference takes each club\'s best, a fractional quota the best of the next depth', () => {
  const clubs = [[90, 80, 70], [85, 75, 65], [95, 60, 55]];
  assert.deepEqual(referenceOf(clubs, 1), [85, 90, 95]);
  // 1⅓ a club: every club's best, then the best second player in the league.
  assert.deepEqual(referenceOf(clubs, 4 / 3), [80, 85, 90, 95]);
});

test('the SRS recovers ratings and the home edge, and its reliability grows with games', () => {
  const truth = { A: 6, B: 3, C: 0, D: -2, E: -3, F: -4 };
  const clubs = Object.keys(truth);
  const schedule = rounds => clubs.flatMap(home => clubs.filter(away => away !== home).map(away => ({ home, away }))).flatMap(g => Array(rounds).fill(g));
  const exact = srsOf(schedule(1).map(({ home, away }) => ({ home, away, homeScore: 20 + truth[home] - truth[away] + 3, awayScore: 20 })));
  for (const club of clubs) assert.ok(Math.abs(exact.ratings[club] - truth[club]) < 1e-9);
  assert.ok(Math.abs(exact.homeEdge - 3) < 1e-9);
  assert.ok(exact.sigma < 1e-9);
  assert.equal(exact.reliability, 1);
  const rng = seeded(11);
  // Margins 6 points of noise about the truth: twenty games a club leave the ratings part luck, eighty much less.
  const noisy = rounds => srsOf(schedule(rounds).map(({ home, away }) => ({ home, away,
    homeScore: Math.round(20 + truth[home] - truth[away] + 3 + 6 * gaussian(rng)), awayScore: 20 })));
  const few = noisy(2), many = noisy(8);
  assert.ok(few.reliability > 0 && few.reliability < 1);
  assert.ok(many.reliability > few.reliability, `${few.reliability} → ${many.reliability}`);
  assert.ok(Math.abs(Object.values(many.ratings).reduce((s, r) => s + r, 0)) < 1e-9);
  assert.ok(spearman(clubs.map(c => many.ratings[c]), clubs.map(c => truth[c])) > 0.9);
  // Every game at a neutral venue: no home edge to fit.
  const neutral = srsOf(schedule(1).map(({ home, away }) => ({ home, away, homeScore: 20 + truth[home] - truth[away], awayScore: 20, neutral: true })));
  assert.equal(neutral.homeEdge, 0);
  for (const club of clubs) assert.ok(Math.abs(neutral.ratings[club] - truth[club]) < 1e-9);
  assert.throws(() => srsOf([{ home: 'A', away: 'B', homeScore: 1, awayScore: 0 }, { home: 'C', away: 'D', homeScore: 1, awayScore: 0 }]), /every club/);
});

test('records alone give win share less a half, with what binomial luck leaves of it', () => {
  const { ratings, reliability } = winShareOf({ A: { w: 60, l: 20 }, B: { w: 40, l: 40 }, C: { w: 19, l: 59, t: 2 } });
  assert.equal(ratings.A, 0.25);
  assert.equal(ratings.B, 0);
  assert.equal(ratings.C, -0.25);
  // Shares .75 .5 .25: variance 1/24; luck (.1875 + .25 + .1875) / 3 / 80.
  assert.ok(Math.abs(reliability - (1 - (0.625 / 3 / 80) / (1 / 24))) < 1e-12);
  assert.throws(() => winShareOf({ A: { w: 0, l: 0 } }), /a game/);
});

test('targets spread by the square root of the reliability, in lineup points', () => {
  const { scale, targets } = resultsTargets({ ratings: { A: 4, B: -4 }, reliability: 0.64 }, { mean: 80, perPoint: 2 });
  assert.equal(scale, 0.4);
  assert.deepEqual(targets, { A: 81.6, B: 78.4 });
  assert.throws(() => resultsTargets({ ratings: {}, reliability: 1 }, { mean: 80, perPoint: 0 }), /positive/);
});

test('the engine\'s points a lineup point are measured by simulation', () => {
  const slope = perPointOf({ play: (delta, rng) => 0.7 * delta + 10 * (rng() - 0.5), rng: seeded(3), games: 3000 });
  assert.ok(Math.abs(slope - 0.7) < 0.03, `slope ${slope}`);
  // Wins: half at an even game, so the base is ½.
  const share = perPointOf({ play: (delta, rng) => (rng() < 0.5 + 0.03 * delta ? 1 : 0), rng: seeded(4), games: 6000, base: 0.5 });
  assert.ok(Math.abs(share - 0.03) < 0.005, `share ${share}`);
});

test('a club moves to its target by a whole shift and its best few, and nobody passes anybody', () => {
  const pool = [91, 88, 84, 84, 80, 77, 75, 72, 70, 66].map((rating, i) => ({ id: i, rating }));
  const bestFive = players => mean(players.map(p => p.rating).sort((a, b) => b - a).slice(0, 5));
  const up = clubMoveOf(pool, bestFive(pool) + 2.3, bestFive);
  assert.ok(Math.abs(up.after - up.before - 2.3) <= 0.1 + 1e-9, `${up.before} → ${up.after}`);
  const down = clubMoveOf(pool, bestFive(pool) - 3.65, bestFive);
  assert.ok(Math.abs(down.after - (down.before - 3.65)) <= 0.1 + 1e-9);
  for (const move of [up, down]) {
    assert.deepEqual(move.pool.map(p => p.id), pool.map(p => p.id));
    const before = pool.map(p => p.rating), after = move.pool.map(p => p.rating);
    for (let i = 0; i < before.length; i++) {
      for (let j = 0; j < before.length; j++) if (before[i] > before[j]) assert.ok(after[i] >= after[j]);
    }
  }
  // Held to 1–99.
  const top = clubMoveOf([{ rating: 98 }, { rating: 97 }], 120, players => mean(players.map(p => p.rating)));
  assert.ok(top.pool.every(p => p.rating <= 99));
  assert.throws(() => clubMoveOf([], 80, () => 0), /empty/);
});
