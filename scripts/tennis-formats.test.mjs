// The cups' formats by year (docs/design/tennis.md and womens-tennis.md, "Format by year"): an earlier season plays its
// year's ties. The Davis Cup's to 2018 are three days of best-of-five rubbers (advantage sets to 1988, a tie-break in all
// but the fifth set to 2015, in every set from 2016); the Fed Cup's are three rubbers, first to two, to 1994 and in
// 2000–2001 and 2025, and five with the doubles last otherwise. The built-in season plays today's ties exactly as before.
// Advantage sets and best-of-five rubbers are played game by game with Elo's odds over five sets; the clock, the feed, the
// live chart and the running App follow the year's format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { decodeFootballSet, seasonSport } from '../src/engine/footballSets.js';
import { clockLabel, clockTick, getSport, matchSport, overtimeEnd } from '../src/sports/index.js';
import {
  ATP, bestOfFive, bestOfFiveOdds, bestOfThree, BLOCK, DAVIS_CUP_FORMATS, daySetChances, FED_CUP_FORMATS, fiveSetOdds, formatOf, holdChance,
  matchOdds, MAX_SET_GAMES, playMatch, playMatchWon, sampleResult, serveEdge, setChance, tiebreakSet, TODAY, WTA,
} from '../src/sports/tennis.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { parseCampaign } from '../src/engine/storage.js';
import { campaignPreview } from '../src/screens/setup/setupModel.js';
import { buildFeedRows, buildLiveMatch } from '../src/viewModels/match.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const men = getSport('tennis'), women = getSport('womens-tennis');
/** A built-in earlier season: its sport bound to its players, and the sport of its year's format. */
function season(sportId, year) {
  const [folder, id] = sportId === 'tennis' ? ['tennis', `tennis-${year}`] : ['womens-tennis', `wta-${year}`];
  const players = seasonSport(decodeFootballSet(JSON.parse(read(`public/${folder}/${id}.json`)), id));
  return { players, sport: matchSport({ sport: sportId, layer: 'nations', dataSet: id, dataYear: year, dataSeason: String(year) }),
    team: nation => buildTeam(nation, makeRng(1), players) };
}
const setsWon = (sets, side) => sets.filter(set => (side === 'A' ? set.a > set.d : set.d > set.a)).length;
const minmax = set => [Math.max(set.a, set.d), Math.min(set.a, set.d)];
/** A finished set's games are a real score: a tie-break set's 6–0 to 6–4, 7–5 or 7–6 with its tie-break; an advantage set's two clear. */
function assertSet(set, tiebreak, label) {
  const [w, l] = minmax(set);
  if (tiebreak || set.tb) {
    assert.ok((w === 6 && l <= 4) || (w === 7 && l === 5) || (w === 7 && l === 6 && set.tb), `${label}: ${set.a}–${set.d}`);
    if (set.tb) assert.ok(Math.max(...set.tb) >= 7 && Math.abs(set.tb[0] - set.tb[1]) >= 2 && (set.tb[0] > set.tb[1]) === (set.a > set.d), `${label}: tie-break ${set.tb}`);
    if (!tiebreak) assert.ok(set.a + set.d > MAX_SET_GAMES, `${label}: an advantage set has a tie-break only past ${MAX_SET_GAMES} games`);
  } else {
    assert.ok(w >= 6 && w - l >= 2 && (w === 6 || w - l === 2), `${label}: ${set.a}–${set.d}`);
  }
}

// ---------- the format of each year ----------

test('each year plays its own cup\'s format, and the built-in season today\'s', () => {
  const davis = year => formatOf(DAVIS_CUP_FORMATS, year), fed = year => formatOf(FED_CUP_FORMATS, year);
  assert.equal(formatOf(DAVIS_CUP_FORMATS, null), TODAY, 'the built-in season');
  assert.deepEqual([1960, 1988, 1989, 2015, 2016, 2018, 2019, 2025].map(year => davis(year).id), ['davis-cup-advantage', 'davis-cup-advantage',
    'davis-cup-tiebreaks', 'davis-cup-tiebreaks', 'davis-cup-fifth-set-tiebreak', 'davis-cup-fifth-set-tiebreak', 'today', 'today']);
  assert.deepEqual([1968, 1975, 1976, 1977, 1979, 1980, 1994, 1995, 1999, 2000, 2001, 2002, 2017, 2018, 2024, 2025, 2026].map(year => fed(year).id), [
    'fed-cup-three-advantage', 'fed-cup-three-advantage', 'fed-cup-three-tiebreaks', 'fed-cup-three-advantage', 'fed-cup-three-advantage',
    'fed-cup-three', 'fed-cup-three', 'fed-cup-five', 'fed-cup-five', 'fed-cup-three', 'fed-cup-three', 'fed-cup-five', 'fed-cup-five',
    'fed-cup-five-tiebreaks', 'fed-cup-five-tiebreaks', 'fed-cup-three-tiebreaks', 'today']);
  // Rubbers, sets and tie-breaks.
  assert.deepEqual([davis(1985), davis(2005), davis(2017), TODAY].map(f => [f.order.length, f.toWin, f.bestOf, f.advantage, f.days]),
    [[5, 3, 5, 'all', 3], [5, 3, 5, 'final', 3], [5, 3, 5, 'none', 3], [5, 3, 3, 'none', 2]]);
  assert.deepEqual([fed(1972), fed(1985), fed(1997), fed(2021), fed(2025)].map(f => [f.order.length, f.toWin, f.bestOf, f.advantage]),
    [[3, 2, 3, 'all'], [3, 2, 3, 'final'], [5, 3, 3, 'final'], [5, 3, 3, 'none'], [3, 2, 3, 'none']]);
  assert.deepEqual([1, 2, 3, 4, 5].map(k => tiebreakSet(davis(2005), k)), [true, true, true, true, false]);
  assert.deepEqual([1, 2, 3, 4, 5].map(k => tiebreakSet(davis(1985), k)), [false, false, false, false, false]);
  assert.deepEqual([1, 2, 3].map(k => tiebreakSet(fed(1985), k)), [true, true, false]);
  assert.deepEqual([1, 2, 3].map(k => tiebreakSet(TODAY, k)), [true, true, true]);
});

test('matchSport gives an earlier season its year\'s format, one sport a format, and the built-in season the sport itself', () => {
  assert.equal(matchSport({ sport: 'tennis' }), men);
  assert.equal(matchSport({ sport: 'womens-tennis' }), women);
  // The seasons that played today's ties play the sport itself.
  for (const year of [2019, 2022, 2025]) assert.equal(matchSport({ sport: 'tennis', dataSet: `tennis-${year}`, dataYear: year }), men, String(year));
  // A year needs its season: without a data set, today's.
  assert.equal(matchSport({ sport: 'tennis', dataYear: 1985 }), men);
  const of = (sport, year) => matchSport({ sport, dataSet: `${sport === 'tennis' ? 'tennis' : 'wta'}-${year}`, dataYear: year });
  assert.equal(of('tennis', 1985), of('tennis', 1960), 'one object a format');
  assert.notEqual(of('tennis', 1985), of('tennis', 1989));
  assert.equal(of('womens-tennis', 1976), of('womens-tennis', 2025), 'the Fed Cup of 1976 and the cup of 2025: three rubbers of tie-break sets');
  assert.equal(of('womens-tennis', 1972), of('womens-tennis', 1978));
  const old = of('tennis', 1985), three = of('womens-tennis', 1985);
  assert.deepEqual([old.id, old.nationsOnly, old.tour, old.rules.id, old.simulationVersion, old.clock], ['tennis', true, ATP, 'davis-cup-advantage', 2,
    { length: 60, msPerUnit: 113, ot: BLOCK, tick: BLOCK }]);
  assert.deepEqual([three.id, three.tour, three.rules.id, three.clock], ['womens-tennis', WTA, 'fed-cup-three', { length: 40, msPerUnit: 70, ot: BLOCK, tick: BLOCK }]);
  assert.deepEqual([men.rules, men.clock.length, men.clock.msPerUnit], [TODAY, 60, 70]);
  // The same players, territory and words as the sport's own.
  assert.equal(old.rosters, men.rosters);
  assert.equal(old.territory, men.territory);
  assert.deepEqual([old.labels, old.words], [men.labels, men.words]);
  // The setup's estimate reads the season's clock.
  const preview = (sport, id, year) => campaignPreview(30, { id: sport, dataSet: id, dataYear: year, dataSeason: String(year) }, { layer: 'nations' }).duration;
  assert.notEqual(preview('tennis', 'tennis-1985', 1985), preview('tennis', 'tennis-2023', 2023), 'best of five takes longer');
});

// ---------- advantage sets ----------

test('an advantage set plays on until a side is two games clear, and its odds are exact', () => {
  assert.ok(Math.abs(setChance(0.64, 0.64, false) - 0.5) < 1e-12);
  for (const pA of [0.55, 0.62, 0.7]) for (const pD of [0.5, 0.6, 0.68]) {
    assert.ok(Math.abs(setChance(pA, pD, false) - (1 - setChance(pD, pA, false))) < 1e-12, `${pA} v ${pD}: the same whoever serves first`);
  }
  // Game by game, A serving first half the time: as often as the formula says.
  const rng = makeRng(20261110);
  const [pA, pD] = [0.68, 0.6], hA = holdChance(pA), hD = holdChance(pD);
  let won = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    let a = 0, d = 0, aServes = i % 2 === 0;
    while (!((a >= 6 || d >= 6) && Math.abs(a - d) >= 2)) { if (aServes ? rng() < hA : rng() >= hD) a++; else d++; aServes = !aServes; }
    if (a > d) won++;
  }
  assert.ok(Math.abs(won / N - setChance(pA, pD, false)) < 0.008, `${won / N} v ${setChance(pA, pD, false)}`);
  // The servers split the difference so that an advantage set too is won exactly as often as the day's form says.
  for (const s of [0.3, 0.5, 0.75]) {
    const edge = serveEdge(s, ATP.serve, false);
    assert.ok(Math.abs(setChance(ATP.serve + edge / 2, ATP.serve - edge / 2, false) - s) < 1e-9, `advantage serve edge for ${s}`);
  }
  // Every set of a 1985 rubber is an advantage set: no tie-breaks, and about a fifth reach 6–6 and play on.
  const rules = formatOf(DAVIS_CUP_FORMATS, 1985);
  const sets = Array.from({ length: 3000 }, () => playMatch(rng, 0.5, ATP, rules)).flat();
  sets.forEach((set, i) => assertSet(set, false, `set ${i}`));
  const past = sets.filter(set => minmax(set)[0] >= 8).length / sets.length;
  assert.ok(past > 0.17 && past < 0.24, `sets past 7–5: ${past}`);
  assert.equal(MAX_SET_GAMES, 140, 'the bound: past Isner and Mahut\'s 70–68');
});

// ---------- best of five ----------

test('best of five: Elo\'s best-of-three odds over five sets of the same day-form chances', () => {
  for (const s of [0.2, 0.5, 0.64, 0.9]) {
    // Three sets, the loser taking none, one or two of the ones before the last.
    assert.ok(Math.abs(bestOfFive(s) - s ** 3 * (1 + 3 * (1 - s) + 6 * (1 - s) ** 2)) < 1e-12);
    assert.ok(Math.abs(bestOfFive(1 - s) - (1 - bestOfFive(s))) < 1e-12);
  }
  assert.ok(Math.abs(bestOfFiveOdds(0.5) - 0.5) < 1e-9);
  for (const odds of [0.55, 0.64, 0.76, 0.91]) {
    assert.ok(bestOfFiveOdds(odds) > odds, `the favourite gains at ${odds}`);
    assert.ok(Math.abs(bestOfFiveOdds(1 - odds) - (1 - bestOfFiveOdds(odds))) < 1e-9);
  }
  // Tennis Abstract's example: independent sets make 81.4% over three 86.7% over five; day form, 84.1%.
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (bestOfThree(mid) < 0.814) lo = mid; else hi = mid; }
  assert.ok(Math.abs(bestOfFive(lo) - 0.867) < 0.001, `independent sets: ${bestOfFive(lo)}`);
  assert.equal(Math.round(bestOfFiveOdds(0.814) * 1000) / 10, 84.1);
  // The score-only path reads them from a table.
  for (let i = 1; i < 2000; i++) assert.ok(Math.abs(fiveSetOdds(i / 2000) - bestOfFiveOdds(i / 2000)) < 2e-5, `table at ${i / 2000}`);
  assert.deepEqual([fiveSetOdds(0), fiveSetOdds(1)], [0, 1]);

  const rng = makeRng(1985);
  const rules = formatOf(DAVIS_CUP_FORMATS, 2005);
  const N = 3000;
  const matches = Array.from({ length: N }, () => playMatch(rng, matchOdds(8), ATP, rules));
  const won = matches.filter(sets => setsWon(sets, 'A') === 3).length / N;
  assert.ok(Math.abs(won - bestOfFiveOdds(matchOdds(8))) < 0.025, `won ${won} v ${bestOfFiveOdds(matchOdds(8))}`);
  // To a fifth set as often as the day's form expects: 6s²(1 − s)² at each node.
  const days = daySetChances(matchOdds(8));
  const fifth = days.reduce((sum, { weight, s }) => sum + weight * 6 * s * s * (1 - s) * (1 - s), 0);
  const straight = days.reduce((sum, { weight, s }) => sum + weight * (s ** 3 + (1 - s) ** 3), 0);
  assert.ok(Math.abs(matches.filter(sets => sets.length === 5).length / N - fifth) < 0.025, `fifth sets v ${fifth}`);
  assert.ok(Math.abs(matches.filter(sets => sets.length === 3).length / N - straight) < 0.03, `straight sets v ${straight}`);
  for (const sets of matches) {
    assert.ok(sets.length >= 3 && sets.length <= 5 && Math.max(setsWon(sets, 'A'), setsWon(sets, 'D')) === 3);
    sets.forEach((set, k) => assertSet(set, tiebreakSet(rules, k + 1), `set ${k + 1}`));
  }
  assert.ok(matches.some(sets => sets.length === 5 && minmax(sets[4])[0] >= 8), 'a fifth set played on past 7–5');
  // Played out given the result: always that result, the last set the winner's.
  for (let i = 0; i < 1200; i++) {
    const aWins = i % 3 !== 0;
    const sets = playMatchWon(rng, matchOdds(i % 2 ? 8 : -12), aWins, i % 2 ? ATP : WTA, i % 4 ? rules : formatOf(DAVIS_CUP_FORMATS, 2017));
    assert.equal(setsWon(sets, aWins ? 'A' : 'D'), 3);
    assert.ok(setsWon(sets, aWins ? 'D' : 'A') <= 2 && (sets.at(-1).a > sets.at(-1).d) === aWins);
  }
  assert.equal(setsWon(playMatchWon(makeRng(3), matchOdds(-40), true, ATP, rules), 'A'), 3, 'an underdog\'s win is found too');
});

test('the pace: a best-of-five rubber\'s units last as much longer as its games', () => {
  const games = (rules, tour) => {
    const rng = makeRng(7);
    let total = 0;
    for (let i = 0; i < 1200; i++) total += playMatch(rng, 0.5, tour, rules).reduce((sum, set) => sum + set.a + set.d, 0);
    return total / 1200;
  };
  const today = games(TODAY, ATP);
  const pace = matchSport({ sport: 'tennis', dataSet: 'tennis-2005', dataYear: 2005 }).clock.msPerUnit / men.clock.msPerUnit;
  for (const year of [2005, 2017]) {
    const ratio = games(formatOf(DAVIS_CUP_FORMATS, year), ATP) / today;
    assert.ok(Math.abs(ratio - pace) < 0.06, `${year}: ${ratio} the games, ${pace} the pace`);
  }
  // A best-of-three rubber's advantage sets add a few games, too few to slow the clock.
  for (const year of [1972, 1985]) {
    const ratio = games(formatOf(FED_CUP_FORMATS, year), WTA) / games(TODAY, WTA);
    assert.ok(ratio > 1 && ratio < 1.06, `${year}: ${ratio}`);
    assert.equal(matchSport({ sport: 'womens-tennis', dataSet: `wta-${year}`, dataYear: year }).clock.msPerUnit, women.clock.msPerUnit);
  }
});

// ---------- the ties ----------

test('the built-in season plays its ties exactly as before the formats came in', () => {
  // The SHA-256 of 60 ties a tour (seeds 1–60, every second at home), as the module of d6081c4 played them.
  const fingerprint = (sport, a, d) => {
    const A = buildTeam(a, makeRng(1), sport), D = buildTeam(d, makeRng(1), sport);
    const ties = Array.from({ length: 60 }, (_, i) => sport.simulate(makeRng(i + 1), A, D, 6, teamEff(A), teamEff(D), (i + 1) % 2 ? undefined : { home: true }));
    return createHash('sha256').update(JSON.stringify(ties)).digest('hex');
  };
  assert.equal(fingerprint(men, '380', '724'), 'e9ca2478c451ba0b95aad889bcbf98118c9412e076313c7143d7377a0bddfafa');
  assert.equal(fingerprint(women, '840', '643'), '1995d0a38abc0b4108d254705c03409e1deb414d47e262e07b2bfd9b47f38133');
});

test('a Davis Cup tie of 1985: five rubbers over three days, every one best of five advantage sets', () => {
  const { sport, team } = season('tennis', 1985);
  const usa = team('840'), sweden = team('752');
  const prepared = sport.prepareMatch(usa, sweden);
  assert.equal(prepared.rules.id, 'davis-cup-advantage');
  assert.deepEqual(prepared.rubbers.map(rubber => [rubber.a, rubber.d, rubber.doubles]).filter(([, , doubles]) => !doubles).map(([a, d]) => `${a} v ${d}`),
    ['John McEnroe v Mats Wilander', 'Jimmy Connors v Stefan Edberg', 'John McEnroe v Stefan Edberg', 'Jimmy Connors v Mats Wilander']);
  assert.ok(prepared.rubbers[2].doubles, 'the doubles third, on the second day');
  const scores = new Set();
  let fifthSets = 0, rubbers = 0, played = 0, long = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const result = sport.simulate(makeRng(seed), usa, sweden, 6, teamEff(usa), teamEff(sweden));
    const fast = sampleResult(makeRng(seed), prepared, 6);
    assert.deepEqual([fast.ga, fast.gd, fast.winner], [result.ga, result.gd, result.winner], `seed ${seed}: the fast path agrees`);
    assert.equal(Math.max(result.ga, result.gd), 3);
    scores.add(`${Math.max(result.ga, result.gd)}–${Math.min(result.ga, result.gd)}`);
    result.ev.forEach((e, k) => {
      assert.ok(k === 0 || e.m > result.ev[k - 1].m, 'in order on the clock');
      assert.ok(e.m > (e.rubber - 1) * BLOCK && e.m <= e.rubber * BLOCK, `rubber ${e.rubber} at ${e.m}`);
    });
    for (const e of result.ev.filter(e => e.pts === 1)) {
      const sets = e.score.split(' ').map(text => text.match(/^(\d+)–(\d+)/).slice(1).map(Number));
      rubbers++;
      assert.ok(sets.length >= 3 && sets.length <= 5, e.score);
      assert.ok(!e.score.includes('('), `no tie-break before 1989: ${e.score}`);
      for (const [w, l] of sets.map(([x, y]) => [Math.max(x, y), Math.min(x, y)])) {
        assert.ok(w >= 6 && w - l >= 2 && (w === 6 || w - l === 2), e.score);
        played++;
        if (w >= 8) long++;
      }
      if (sets.length === 5) fifthSets++;
    }
  }
  assert.deepEqual([...scores].sort(), ['3–0', '3–1', '3–2']);
  assert.ok(fifthSets / rubbers > 0.1 && fifthSets / rubbers < 0.3, `rubbers to a fifth set ${fifthSets / rubbers}`);
  assert.ok(long / played > 0.1 && long / played < 0.25, `sets past 7–5 ${long / played}`);
  // 2005: a tie-break in all but the fifth set.
  const later = season('tennis', 2005);
  const [spain, czechs] = [later.team('724'), later.team('203')];
  for (let seed = 1; seed <= 150; seed++) {
    for (const e of later.sport.simulate(makeRng(seed), spain, czechs, 6).ev.filter(e => e.pts === 1)) {
      e.score.split(' ').forEach((text, k) => {
        const [x, y] = text.match(/^(\d+)–(\d+)/).slice(1).map(Number);
        if (k < 4) assert.ok(Math.max(x, y) <= 7, `set ${k + 1} has a tie-break: ${e.score}`);
        else assert.ok(!text.includes('('), `the fifth is an advantage set: ${e.score}`);
      });
    }
  }
});

test('a Fed Cup tie: three rubbers, the No. 2s first, first to two, to 1994; five with the doubles last from 1995', () => {
  const { sport, team } = season('womens-tennis', 1990);
  const usa = team('840'), czechs = team('203');
  const prepared = sport.prepareMatch(usa, czechs);
  assert.equal(prepared.rubbers.length, 3);
  const lineupA = prepared.lineupA.slots.map(slot => slot.player?.name), lineupD = prepared.lineupD.slots.map(slot => slot.player?.name);
  assert.deepEqual(prepared.rubbers.map(rubber => [rubber.a, rubber.d]).slice(0, 2), [[lineupA[1], lineupD[1]], [lineupA[0], lineupD[0]]],
    'the No. 2s, then the No. 1s');
  assert.ok(prepared.rubbers[2].doubles);
  const scores = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const result = sport.simulate(makeRng(seed), usa, czechs, 6, teamEff(usa), teamEff(czechs));
    assert.equal(Math.max(result.ga, result.gd), 2);
    scores.add(`${Math.max(result.ga, result.gd)}–${Math.min(result.ga, result.gd)}`);
    assert.equal(Math.max(...result.ev.map(e => e.m)), (result.ga + result.gd) * BLOCK);
    const fast = sampleResult(makeRng(seed), prepared, 6);
    assert.deepEqual([fast.ga, fast.gd, fast.winner], [result.ga, result.gd, result.winner]);
    // Best of three, the third set an advantage set.
    for (const e of result.ev.filter(e => e.pts === 1)) {
      const sets = e.score.split(' ');
      assert.ok(sets.length >= 2 && sets.length <= 3);
      if (sets.length === 3) assert.ok(!sets[2].includes('('), e.score);
    }
  }
  assert.deepEqual([...scores].sort(), ['2–0', '2–1']);
  // 1997: the four singles, then the doubles.
  const fives = season('womens-tennis', 1997);
  const five = fives.sport.prepareMatch(fives.team('840'), fives.team('250'));
  assert.deepEqual(five.rubbers.map(rubber => rubber.doubles), [false, false, false, false, true]);
  const [a1, a2] = five.lineupA.slots.map(slot => slot.player?.name), [d1, d2] = five.lineupD.slots.map(slot => slot.player?.name);
  assert.deepEqual(five.rubbers.slice(0, 4).map(rubber => [rubber.a, rubber.d]), [[a1, d2], [a2, d1], [a1, d1], [a2, d2]]);
  // 2026, the built-in season: the doubles third, as in the Davis Cup.
  assert.deepEqual(women.prepareMatch(fives.team('840'), fives.team('250')).rubbers.map(rubber => rubber.doubles), [false, false, true, false, false]);
});

// ---------- the clock, the feed and the live chart ----------

test('the live chart follows the year\'s rubbers and sets, and starts at the tie\'s odds', () => {
  const old = season('tennis', 1985), three = season('womens-tennis', 1985);
  const cases = [[old, '840', '752'], [three, '840', '203']];
  for (const [{ sport, team }, a, d] of cases) {
    const A = team(a), D = team(d);
    const model = liveModelFor(sport, A, D, teamEff(A), teamEff(D), 6);
    assert.ok(isLiveModel(model) && isLiveModel(JSON.parse(JSON.stringify(model))), 'a saved model still reads');
    const odds = estimateWinProbability({ sport, attacker: A, defender: D, samples: 20000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.015, `${sport.rules.id}: ${winProbabilityAt(model, 0, 0)} v ${odds}`);
    const { ev, winner } = sport.simulate(makeRng(31), A, D, 6, teamEff(A), teamEff(D));
    const series = winSeries({ model, goals: ev.map(e => ({ m: e.m, tid: e.tid, pts: e.pts })), aId: A.id, dId: D.id,
      minute: Math.max(...ev.map(e => e.m)), final: { winnerId: winner } });
    assert.equal(series.at(-1).p, winner === A.id ? 1 : 0);
    for (const e of ev.filter(e => e.m < series.length - 1)) {
      assert.ok(e.tid === A.id ? series[e.m].p > series[e.m - 1].p : series[e.m].p < series[e.m - 1].p, `the set at ${e.m} moves it its way`);
    }
  }
  const five = liveModelFor(old.sport, old.team('840'), old.team('752'));
  assert.deepEqual([five.bestOf, five.gaps.length, five.length, five.maxOt], [5, 5, 60, 2]);
  const short = liveModelFor(three.sport, three.team('840'), three.team('203'));
  assert.deepEqual([short.bestOf, short.gaps.length, short.length, short.ot, short.maxOt], [undefined, 3, 40, BLOCK, 1]);
  assert.deepEqual(chartDomain(short, 30).ticks, [0, 20, 40]);
  assert.deepEqual(chartDomain(short, 45).ticks, [0, 20, 40, 60], 'the third rubber once it is played');
  assert.equal(isLiveModel({ ...five, bestOf: 4 }), false);
  assert.equal(isLiveModel({ ...five, gaps: five.gaps.slice(0, 4) }), false);
  // Today's model is the one a save already holds: no best-of field.
  assert.equal('bestOf' in liveModelFor(men, old.team('840'), old.team('752')), false);
});

test('a best-of-five rubber\'s chance after each set is its exact posterior, set by set', () => {
  // Between sets the chart is a fair price: its value is the next set's chance times the value if A takes it, plus the
  // rest times the value if D does. With no match-day form (Predictable) the next set's chance is the day-form nodes',
  // weighed by how likely each made the sets so far.
  const { sport, team } = season('tennis', 1985);
  const A = team('840'), D = team('752');
  const model = liveModelFor(sport, A, D, undefined, undefined, 0);
  assert.equal(model.formSd, 0);
  const days = daySetChances(matchOdds(model.gaps[0]));
  const at = sets => winSeries({ model, goals: sets.map((side, k) => ({ m: k + 1, tid: side, pts: 0 })), aId: A.id, dId: D.id, minute: sets.length }).at(-1).p;
  const rubberWon = (sets, side) => winSeries({ model, goals: [...sets.map((s, k) => ({ m: k + 1, tid: s, pts: 0 })), { m: BLOCK, tid: side, pts: 1 }],
    aId: A.id, dId: D.id, minute: BLOCK }).at(-1).p;
  for (const sets of [[], [A.id], [D.id], [A.id, D.id], [A.id, A.id], [D.id, A.id, D.id], [A.id, D.id, A.id, D.id]]) {
    const a = sets.filter(id => id === A.id).length, d = sets.length - a;
    const weights = days.map(({ weight, s }) => weight * s ** a * (1 - s) ** d);
    const next = days.reduce((sum, { s }, i) => sum + weights[i] * s, 0) / weights.reduce((sum, w) => sum + w, 0);
    const ifA = a === 2 ? rubberWon(sets, A.id) : at([...sets, A.id]);
    const ifD = d === 2 ? rubberWon(sets, D.id) : at([...sets, D.id]);
    assert.ok(Math.abs(at(sets) - (next * ifA + (1 - next) * ifD)) < 1e-9, `after ${a}–${d}: ${at(sets)} v ${next * ifA + (1 - next) * ifD}`);
  }
});

test('the clock and the feed of a three-rubber tie: R1 to R3, "rubber 2 of 3", the final in rubbers', () => {
  const { sport, team } = season('womens-tennis', 1985);
  const usa = team('840'), czechs = team('203');
  assert.deepEqual([1, 20, 21, 40, 41, 60].map(m => clockLabel(sport, m)), ['R1', 'R1', 'R2', 'R2', 'R3', 'R3']);
  assert.deepEqual([20, 40].map(t => clockTick(sport, t)), ['R1', 'R2']);
  assert.equal(overtimeEnd(sport, 1), 0, 'a tie ends with its last set');
  const sim = sport.simulate(makeRng(9), usa, czechs, 6, teamEff(usa), teamEff(czechs));
  const st = { phase: 'playing', settings: { sport: 'womens-tennis', dataSet: 'wta-1985', dataYear: 1985, dataSeason: '1985' },
    teams: { 840: usa, 203: czechs }, history: [],
    match: { aId: '840', dId: '203', effA: teamEff(usa), effD: teamEff(czechs), ga: sim.ga, gd: sim.gd, shown: sim.ev, allEv: sim.ev, tie: null,
      winner: sim.winner, finalGa: sim.ga, finalGd: sim.gd, status: sport.labels.end, applied: false, done: true } };
  const live = buildLiveMatch(st, { sport });
  assert.deepEqual([live.length, live.model?.gaps.length, live.feedBase.length], [40, 3, 40]);
  assert.equal(buildLiveMatch(st, {}).length, 40, 'the settings\' season by matchSport');
  const rows = buildFeedRows(live, 60);
  assert.match(rows[0].text, new RegExp(`^Final — ${usa.code} ${sim.ga}–${sim.gd} ${czechs.code}$`));
  assert.match(buildFeedRows({ ...live, feedBase: { ...live.feedBase, state: 'live' } }, 25)[0].text, /· rubber 2 of 3$/);
  // Today's five rubbers still say so.
  assert.equal(men.clockLeft(25, men.clock.length), 'rubber 2 of 5');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  WinChart: 'src/screens/match/WinChart.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

/** The App at setup with `sportId`'s season files served from public/. */
async function withApp(sportId, ids, fn) {
  const folder = sportId === 'tennis' ? 'tennis' : 'womens-tennis';
  const fetch = async url => {
    const [, id] = String(url).match(new RegExp(`^/${folder}/((?:tennis|wta)-\\d{4})\\.json$`)) || [];
    let text = null;
    try { text = id && read(`public/${folder}/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids, settings: { sport: sportId, layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

async function launch(app, time, sportId, id) {
  app.pickSetup('sport', sportId);
  app.pickSetup('scope', 'world');
  app.pickSetup('dataSet', id);
  time.advance(200);
  await app.loadSet(id);
  await settle();
  app.startCampaign();
  app.showPopup = () => {};
  app.showToast = () => {};
}

test('the running App plays a 1985 season\'s ties best of five, and saves and resumes it', async () => {
  await withApp('tennis', ['840', '752', '203', '276'], async ({ app, time, items }) => {
    await launch(app, time, 'tennis', 'tennis-1985');
    assert.equal(app.state.phase, 'playing');
    assert.deepEqual([app.sport().rules.id, app.sport().clock.msPerUnit], ['davis-cup-advantage', 113]);
    app.startMatch('840', '752');
    const m = app.state.match;
    assert.equal(Math.max(m.finalGa, m.finalGd), 3);
    assert.deepEqual([m.live?.kind, m.live?.bestOf, m.live?.gaps.length], ['rubbers', 5, 5]);
    const rubbers = m.allEv.filter(e => e.pts === 1);
    assert.ok(rubbers.every(e => e.score.split(' ').length >= 3 && !e.score.includes('(')), rubbers.map(e => e.score).join(' / '));
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.deepEqual([saved.settings.dataSet, saved.settings.dataYear], ['tennis-1985', 1985]);
    app.continueSaved(saved);
    assert.equal(app.sport().rules.id, 'davis-cup-advantage', 'the season\'s format comes back with the save');
  });
});

test('the running App plays a 1985 women\'s season\'s ties of three rubbers', async () => {
  await withApp('womens-tennis', ['840', '203', '276', '036'], async ({ app, time }) => {
    await launch(app, time, 'womens-tennis', 'wta-1985');
    assert.deepEqual([app.sport().rules.id, app.sport().clock.length], ['fed-cup-three', 40]);
    app.startMatch('840', '203');
    const m = app.state.match;
    assert.equal(Math.max(m.finalGa, m.finalGd), 2);
    assert.deepEqual([m.live?.gaps.length, m.live?.length, m.live?.maxOt], [3, 40, 1]);
    assert.ok(Math.max(...m.allEv.map(e => e.m)) <= 60);
  });
});

test('the win chart of a three-rubber tie ticks R1 and R2, and R3 once it is played', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const { sport, team } = season('womens-tennis', 1985);
  const model = liveModelFor(sport, team('840'), team('203'));
  const html = renderToStaticMarkup(React.createElement(B.WinChart, { sport: 'womens-tennis', model, minuteFallback: 30 }));
  for (const tick of ['R1', 'R2']) assert.ok(html.includes(`>${tick}<`), tick);
  assert.ok(!html.includes('>R3<'), 'the third rubber shows once it is played');
  const later = renderToStaticMarkup(React.createElement(B.WinChart, { sport: 'womens-tennis', model, minuteFallback: 50,
    goals: [{ m: 10, tid: '840', pts: 1 }, { m: 30, tid: '203', pts: 1 }, { m: 50, tid: '840', pts: 0 }], aId: '840', dId: '203' }));
  assert.ok(later.includes('>R3<'));
});
