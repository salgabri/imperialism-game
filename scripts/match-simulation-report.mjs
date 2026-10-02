// Headless statistical probes of the game's model, not real-world match forecasts.
// Run: node scripts/match-simulation-report.mjs --samples=30000 --full=1000
// JSON goes to stdout; optionally save it with --out=<path>.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildTeam, hashStr, makeRng, teamEff } from '../src/data/teams.js';
import { SPORT_LIST } from '../src/sports/index.js';
import { estimateWinProbability, UNCERTAINTY_PRESETS } from '../src/engine/odds.js';

// Deliberately broad design bands: synthetic equal-rated sides do not reproduce
// the mix of opponents, tactics, extra time and tournament formats in these data.
export const DESIGN_TARGETS = Object.freeze({
  football: Object.freeze({ regulationTotalMean: [2.2, 3.6], regulationTieRate: [.17, .36], regulationTotalSd: [1.35, 2.3] }),
  basketball: Object.freeze({ regulationTotalMean: [155, 181], regulationTieRate: [.012, .065], regulationTotalSd: [10, 27], regulationMarginSd: [10, 24] }),
});

export const EMPIRICAL_REFERENCES = Object.freeze([
  { sport: 'football', competition: 'FIFA World Cup Qatar 2022', combinedGoalsPerMatch: 172 / 64,
    note: '172 goals in 64 games. Includes knockout extra time; not a regulation-only or equal-team calibration dataset.',
    source: 'https://publications.fifa.com/en/annual-report-2022/2022-at-a-glance/fifa-world-cup-qatar-2022-summary/' },
  { sport: 'basketball', competition: 'FIBA Basketball World Cup 2023', combinedPointsPerMatch: 169,
    note: 'Official FIBA scouting report, page 3. Tournament aggregate includes overtime and mixed opponent strengths.',
    source: 'https://assets.fiba.basketball/image/upload/documents-corporate-studies-and-facts-fiba-scouting-report-fiba-basketball-world-cup-2023.pdf' },
]);

export function syntheticTeam(sport, rating = 75, id = 'A') {
  return { id, name: `${sport.name} rating ${rating}`, sport: sport.id, str: rating,
    squad: sport.positionPlan.map((pos, i) => ({ name: `${id}-${pos}-${i}`, pos, rating })) };
}

export function regulationScore(sport, result) {
  if (sport.id !== 'basketball' || !result.tie) return [result.ga, result.gd];
  return [result.ga - result.tie.periods.reduce((sum, pair) => sum + pair[0], 0),
    result.gd - result.tie.periods.reduce((sum, pair) => sum + pair[1], 0)];
}

const rounded = value => Math.round(value * 100000) / 100000;
function distribution(histogram, count) {
  let sum = 0, sumSquares = 0;
  const sorted = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
  for (const [value, frequency] of sorted) { sum += value * frequency; sumSquares += value * value * frequency; }
  const mean = sum / count;
  function quantile(fraction) {
    let cumulative = 0;
    for (const [value, frequency] of sorted) { cumulative += frequency; if (cumulative >= count * fraction) return value; }
    return sorted.at(-1)?.[0] ?? 0;
  }
  return { mean: rounded(mean), sd: rounded(Math.sqrt(Math.max(0, sumSquares / count - mean * mean))),
    p05: quantile(.05), median: quantile(.5), p95: quantile(.95), min: sorted[0]?.[0] ?? 0, max: sorted.at(-1)?.[0] ?? 0 };
}

function increment(histogram, value) { histogram.set(value, (histogram.get(value) || 0) + 1); }

/** Prepare once; aggregate score samples without allocating commentary/events. */
export function sampleMatchStatistics({ sport, attacker, defender, drama = 6, samples = 30000, seed = 20261002 }) {
  const prepared = sport.prepareMatch(attacker, defender, teamEff(attacker), teamEff(defender));
  const rng = makeRng(seed);
  const scorelines = new Map(), totals = new Map(), margins = new Map(), aScores = new Map(), dScores = new Map();
  let wins = 0, ties = 0, tiedWins = 0, zeroZero = 0, largeTotals = 0, blowouts = 0;
  let finalTotal = 0, absoluteMargin = 0;
  const started = performance.now();
  for (let i = 0; i < samples; i++) {
    const result = sport.sampleResult(rng, prepared, drama);
    const [a, d] = regulationScore(sport, result);
    const win = result.winner === attacker.id;
    wins += Number(win);
    if (a === d) { ties++; tiedWins += Number(win); }
    zeroZero += Number(a === 0 && d === 0);
    largeTotals += Number(a + d >= (sport.id === 'football' ? 7 : 220));
    blowouts += Number(Math.abs(a - d) >= (sport.id === 'football' ? 4 : 20));
    finalTotal += result.ga + result.gd;
    absoluteMargin += Math.abs(a - d);
    increment(scorelines, `${a}-${d}`);
    increment(totals, a + d);
    increment(margins, a - d);
    increment(aScores, a);
    increment(dScores, d);
  }
  const elapsedMs = performance.now() - started;
  const winRate = wins / samples;
  const groupedTotals = new Map();
  for (const [value, frequency] of totals) incrementBy(groupedTotals, sport.id === 'football' ? value : Math.floor(value / 10) * 10, frequency);
  return {
    samples, seed, drama, attackerWinRate: rounded(winRate), defenderWinRate: rounded(1 - winRate),
    winRateMargin95: rounded(1.96 * Math.sqrt(winRate * (1 - winRate) / samples)),
    regulationTieRate: rounded(ties / samples), attackerWinRateAfterTie: ties ? rounded(tiedWins / ties) : null,
    zeroZeroRate: rounded(zeroZero / samples), largeTotalRate: rounded(largeTotals / samples), blowoutRate: rounded(blowouts / samples),
    regulationTotal: distribution(totals, samples), regulationMargin: distribution(margins, samples),
    attackerScore: distribution(aScores, samples), defenderScore: distribution(dScores, samples),
    finalTotalMean: rounded(finalTotal / samples), regulationAbsoluteMarginMean: rounded(absoluteMargin / samples),
    mostCommonRegulationScores: [...scorelines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([score, count]) => ({ score, count, rate: rounded(count / samples) })),
    totalHistogram: [...groupedTotals.entries()].sort((a, b) => a[0] - b[0]).map(([from, count]) =>
      ({ from, to: sport.id === 'football' ? from : from + 9, count, rate: rounded(count / samples) })),
    timing: { elapsedMs: rounded(elapsedMs), samplesPerSecond: Math.round(samples * 1000 / Math.max(.001, elapsedMs)) },
  };
}

function incrementBy(histogram, value, count) { histogram.set(value, (histogram.get(value) || 0) + count); }
function measure(task) { const started = performance.now(); const result = task(); return { result, elapsedMs: rounded(performance.now() - started) }; }

function benchmark(sport, attacker, defender, fullSamples) {
  const effA = teamEff(attacker), effD = teamEff(defender);
  const prepared = sport.prepareMatch(attacker, defender, effA, effD);
  // Warm code paths before measuring. Durations are observations, not test gates.
  const warmRng = makeRng(4321);
  for (let i = 0; i < 100; i++) sport.sampleResult(warmRng, prepared, 6);
  for (let i = 0; i < 25; i++) sport.simulate(warmRng, attacker, defender, 6, effA, effD);
  const rng = makeRng(5678);
  let checksum = 0;
  const preparation = measure(() => { for (let i = 0; i < 250; i++) sport.prepareMatch(attacker, defender, effA, effD); });
  const scores = measure(() => { for (let i = 0; i < 100000; i++) checksum += sport.sampleResult(rng, prepared, 6).ga; });
  const complete = measure(() => { for (let i = 0; i < fullSamples; i++) checksum += sport.simulate(rng, attacker, defender, 6, effA, effD).ev.length; });
  const args = { sport, attacker: syntheticTeam(sport, 76.123, 'timing-A'), defender: syntheticTeam(sport, 74.789, 'timing-D'), drama: 5.123, samples: 1024 };
  const firstOdds = measure(() => estimateWinProbability(args));
  const cachedOdds = measure(() => estimateWinProbability(args));
  return {
    prepare: { samples: 250, elapsedMs: preparation.elapsedMs, meanMs: rounded(preparation.elapsedMs / 250) },
    scores: { samples: 100000, elapsedMs: scores.elapsedMs, perSecond: Math.round(100000000 / Math.max(.001, scores.elapsedMs)) },
    completeMatches: { samples: fullSamples, elapsedMs: complete.elapsedMs, perSecond: Math.round(fullSamples * 1000 / Math.max(.001, complete.elapsedMs)) },
    odds: { samples: firstOdds.result.samples, firstMs: firstOdds.elapsedMs, cachedMs: cachedOdds.elapsedMs, cacheIdentityPreserved: firstOdds.result === cachedOdds.result },
    checksum,
  };
}

export function createSimulationReport({ samples = 30000, fullSamples = 1000, seed = 20261002 } = {}) {
  const sports = {};
  for (const sport of SPORT_LIST) {
    const defender = syntheticTeam(sport, 55, 'D');
    const gaps = [];
    for (const [preset, setting] of Object.entries(UNCERTAINTY_PRESETS)) {
      for (const gap of [0, 5, 10, 20, 40]) {
        const attacker = syntheticTeam(sport, 55 + gap, 'A');
        gaps.push({ preset, ratingGap: gap, ...sampleMatchStatistics({ sport, attacker, defender, drama: setting.drama, samples, seed: hashStr(`${seed}:${sport.id}:${preset}:${gap}`) }) });
      }
    }
    const equalA = syntheticTeam(sport, 75, 'A'), equalD = syntheticTeam(sport, 75, 'D');
    const equalTeams = sampleMatchStatistics({ sport, attacker: equalA, defender: equalD, samples, seed: hashStr(`${seed}:${sport.id}:equal`) });
    const pairIds = sport.id === 'football' ? [['250', '076'], ['032', '276'], ['724', '756'], ['076', '356']]
      : [['840', '124'], ['276', '688'], ['250', '724'], ['840', '356']];
    const realTeamPairings = pairIds.map(([aId, dId]) => {
      const rosterRng = makeRng(hashStr(`${seed}:${sport.id}:${aId}:${dId}:rosters`));
      const attacker = buildTeam(aId, rosterRng, sport), opponent = buildTeam(dId, rosterRng, sport);
      return { attacker: { id: aId, name: attacker.name, rating: teamEff(attacker) }, defender: { id: dId, name: opponent.name, rating: teamEff(opponent) },
        ...sampleMatchStatistics({ sport, attacker, defender: opponent, samples, seed: hashStr(`${seed}:${sport.id}:${aId}:${dId}`) }) };
    });
    sports[sport.id] = { equalTeams, ratingGaps: gaps, realTeamPairings, benchmark: benchmark(sport, equalA, equalD, fullSamples) };
  }
  return { purpose: 'Reproducible model diagnostics. These are simulation design checks, not empirically validated match forecasts.',
    generatedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
    configuration: { samplesPerPairing: samples, completeMatchBenchmarkSamples: fullSamples, seed },
    empiricalReferenceAnchors: EMPIRICAL_REFERENCES, syntheticEqualTeamDesignTargets: DESIGN_TARGETS, sports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
    const separator = arg.indexOf('='); return [arg.slice(2, separator < 0 ? undefined : separator), separator < 0 ? true : arg.slice(separator + 1)];
  }));
  const positive = (value, fallback, max) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(max, Math.round(number)) : fallback; };
  const report = createSimulationReport({ samples: positive(options.samples, 30000, 1000000), fullSamples: positive(options.full, 1000, 100000), seed: positive(options.seed, 20261002, 0xffffffff) });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (typeof options.out === 'string') writeFileSync(options.out, json);
  process.stdout.write(json);
}
