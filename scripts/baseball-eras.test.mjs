// Baseball's rules by era (docs/design/baseball.md, "Rules by era"): every built-in earlier season plays at its league's
// runs a game (src/data/mlbLeagueAverages.js: the Baseball Databank's totals to 2022, MLB's own Stats API's after), with
// its day's extra innings (a runner on second from 2020, as the ninth before it) and its ratings' own pitching premium;
// the built-in 2026 season plays today's rules, untouched. The live chart follows each season's extra innings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_BASEBALL_SEASONS } from '../src/data/baseballSeasons.js';
import { BASEBALL_SEASON_PREMIUMS } from '../src/data/baseballSeasonPremiums.js';
import { LATEST_MLB_SEASON, MLB_LEAGUE_TOTALS, mlbRunsPerGame, mlbRunsPerNine, mlbShutoutRate } from '../src/data/mlbLeagueAverages.js';
import { buildClub, makeRng } from '../src/data/teams.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { baseball, baseballIn, INNING_MODEL, inningOdds, runMasses, seasonPremium } from '../src/sports/baseball.js';
import { getSport, matchSport } from '../src/sports/index.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const API = JSON.parse(read('scripts/data/mlb-league-runs.json'));
const SEASONS = BUILT_IN_BASEBALL_SEASONS;
const seasonOf = year => SEASONS.find(season => season.year === year);
const settingsOf = (season, layer = 'clubs') => ({ sport: 'baseball', layer, dataSet: season.id, dataYear: season.year, dataSeason: season.season });
const sportIn = year => matchSport(settingsOf(seasonOf(year)));
const clubsOf = season => JSON.parse(read(`public/baseball/${season.id}.json`)).clubs.map(club => buildClub(club, baseball));
const rulesOf = sport => sport.prepareMatch(...EVEN).rules;
const logistic = x => 1 / (1 + Math.exp(-x));
// Two equal sides: every place filled by a 75 at his own position.
const PLAN = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'RP', 'RP'];
const sideOf = id => ({ id, name: id, code: id.toUpperCase(), sport: 'baseball', kind: 'club', squad: PLAN.map((pos, i) => ({ name: `${id}${i}`, pos, rating: 75 })) });
const EVEN = [sideOf('a'), sideOf('d')];

// ---------- the league's runs ----------

test('MLB\'s league totals: the Databank\'s sums to 2022, MLB\'s own after, and the two agree where both have a season', () => {
  const years = Object.keys(MLB_LEAGUE_TOTALS).map(Number);
  assert.deepEqual(years, Array.from({ length: 2026 - 1960 + 1 }, (_, i) => 1960 + i), 'every season from 1960');
  assert.equal(LATEST_MLB_SEASON, 2026, 'the built-in season\'s own, complete since September 2026');
  assert.deepEqual([1968, 1987, 2000, 2019, 2026].map(year => mlbRunsPerGame(year).toFixed(2)), ['3.42', '4.72', '5.14', '4.83', '4.48']);
  assert.deepEqual([1968, 2000, 2020].map(year => mlbRunsPerNine(year).toFixed(2)), ['3.42', '5.20', '4.85']);
  assert.equal(mlbRunsPerGame(1959), null);
  // Seven-inning doubleheaders cut 2020's and 2021's runs a game below their runs a nine innings.
  assert.ok(mlbRunsPerGame(2020) / mlbRunsPerNine(2020) < 0.96 && mlbRunsPerGame(2021) / mlbRunsPerNine(2021) < 0.98);
  assert.ok(mlbRunsPerGame(2019) / mlbRunsPerNine(2019) > 0.99);
  assert.deepEqual([1968, 2000].map(year => mlbShutoutRate(year).toFixed(3)), ['0.104', '0.042']);
  // The API's sums: the module's from 2023, and the Databank's in every earlier season it holds, but for three figures.
  const differ = { '1960': { outs: 13 }, '1968': { outs: 21 }, '2020': { shutouts: 1 } };
  const clubs = { 1960: 16, 1968: 20, 1981: 26, 1987: 26, 1994: 28 };
  assert.equal(API.source.url, 'https://statsapi.mlb.com/api/v1/teams/stats?season=<season>&sportIds=1&group=<group>&stats=season&gameType=R');
  for (const [season, rows] of Object.entries(API.seasons)) {
    assert.equal(rows.length, clubs[season] ?? 30, `${season}: every club`);
    const sum = column => rows.reduce((total, row) => total + row[column], 0);
    const api = { games: sum(2), runs: sum(3), shutouts: sum(4), outs: sum(5) };
    const own = MLB_LEAGUE_TOTALS[season];
    for (const key of ['games', 'runs', 'shutouts', 'outs']) {
      assert.equal(api[key] - own[key], Number(season) >= 2023 ? 0 : differ[season]?.[key] ?? 0, `${season} ${key}`);
    }
  }
  assert.deepEqual(Object.keys(API.seasons).filter(season => Number(season) >= 2023), ['2023', '2024', '2025', '2026']);
});

// ---------- the rules of each season ----------

test('the built-in season plays today\'s rules; each earlier season its own, one object a season', () => {
  for (const layer of ['clubs', 'nations']) assert.equal(matchSport({ sport: 'baseball', layer }), getSport('baseball'));
  assert.equal(baseballIn({}), baseball);
  assert.equal(rulesOf(baseball), INNING_MODEL.RULES);
  assert.equal(baseball.simulationVersion, 2);
  const sport1968 = sportIn(1968);
  assert.notEqual(sport1968, baseball);
  assert.equal(sport1968.simulationVersion, 3);
  assert.equal(matchSport(settingsOf(seasonOf(1968), 'nations')), sport1968, 'its nations play its rules');
  assert.equal(sportIn(1968), sport1968, 'the same object every time, so caches keyed by it hold');
  // An earlier season differs from today's only in its model; its clock, words and labels are baseball's.
  const changed = Object.keys(baseball).filter(key => sport1968[key] !== baseball[key]);
  assert.deepEqual(changed.sort(), ['prepareMatch', 'simulate', 'simulationVersion']);
  assert.deepEqual(Object.keys(sport1968), Object.keys(baseball));
  // Extra innings: the runner on second from 2020, the ninth's odds and twelve extra innings before.
  for (const year of [1960, 1968, 1987, 2000, 2018, 2019]) {
    const rules = rulesOf(sportIn(year));
    assert.deepEqual([rules.runner, rules.maxExtra, rules.extra], [false, 12, rules.score], `${year}`);
    assert.equal(inningOdds(3, rules).extra, inningOdds(3, rules).score);
  }
  for (const year of [2020, 2021, 2022, 2025]) {
    const rules = rulesOf(sportIn(year));
    assert.deepEqual([rules.runner, rules.maxExtra], [true, 6], `${year}`);
    assert.ok(inningOdds(0, rules).extra > 0.55, `${year}: a run comes far more often with a man on second`);
  }
  // Each season scores at its own rate: a half-inning between average sides scores 21.6% of the time in 1968, 29.7% in
  // 2000 (Tom Tango's tables give 26.3% for 1950–68 and 29.4% for 1993–2009, the inning's start to its end).
  assert.deepEqual([1968, 2000].map(year => logistic(rulesOf(sportIn(year)).score).toFixed(3)), ['0.216', '0.297']);
  assert.ok(rulesOf(sportIn(1968)).more < INNING_MODEL.RULES.more && rulesOf(sportIn(2000)).more > INNING_MODEL.RULES.more);
});

test('each season\'s pitching premium is its clubs\' own, so its average lineup facing its average staff is an even edge', () => {
  assert.deepEqual(Object.keys(BASEBALL_SEASON_PREMIUMS), SEASONS.map(season => season.id));
  for (const season of SEASONS) {
    const clubs = clubsOf(season);
    assert.equal(BASEBALL_SEASON_PREMIUMS[season.id], seasonPremium(clubs), season.id);
    const sport = matchSport(settingsOf(season));
    assert.equal(rulesOf(sport).premium, BASEBALL_SEASON_PREMIUMS[season.id]);
    let edges = 0, pairs = 0;
    for (const a of clubs) for (const d of clubs) if (a !== d) { const p = sport.prepareMatch(a, d); edges += p.edgeA + p.edgeD; pairs += 2; }
    assert.ok(Math.abs(edges / pairs) < 0.01, `${season.id}: the average edge is ${edges / pairs}`);
  }
  // MLB The Show rates its hitters against its pitchers differently each year; the built-in season keeps its 2.3.
  assert.deepEqual(['mlb-the-show-25', 'mlb-the-show-19', 'mlb-war-1968'].map(id => BASEBALL_SEASON_PREMIUMS[id]), [0.93, 1.53, 2.46]);
  assert.equal(seasonPremium(baseball.clubs.map(club => buildClub(club, baseball))), 2.32);
});

/**
 * Runs a side and shutouts a side over every pairing of `clubs`, overtime included as in the league's: about 3,000 games
 * a season, so each pairing is drawn more often in a league of 16 clubs than in one of 30.
 */
function clubScoring(sport, clubs) {
  const rng = makeRng(7);
  const draws = Math.ceil(3000 / (clubs.length * (clubs.length - 1)));
  let runs = 0, sides = 0, shutouts = 0;
  for (const attacker of clubs) {
    for (const defender of clubs) {
      if (attacker === defender) continue;
      const pairing = sport.prepareMatch(attacker, defender);
      for (let k = 0; k < draws; k++) {
        const result = sport.sampleResult(rng, pairing, 6);
        runs += result.ga + result.gd;
        shutouts += (result.ga === 0) + (result.gd === 0);
        sides += 2;
      }
    }
  }
  return { runs: runs / sides, shutouts: shutouts / sides };
}

test('every season scores like its league: 3.42 runs a game in 1968, 5.14 in 2000, 4.48 in the built-in 2026', () => {
  const errors = [], shutoutGaps = [];
  for (const season of [{ id: null, year: 2026 }, ...SEASONS]) {
    const sport = season.id ? matchSport(settingsOf(season)) : baseball;
    const clubs = season.id ? clubsOf(season) : baseball.clubs.map(club => buildClub(club, baseball));
    const { runs, shutouts } = clubScoring(sport, clubs);
    const league = mlbRunsPerGame(season.year);
    errors.push(runs / league - 1);
    assert.ok(Math.abs(runs / league - 1) < 0.035, `${season.year}: ${runs.toFixed(2)} runs a side against the league's ${league.toFixed(2)}`);
    // Shut out about as often as the league's sides were: 10.4% of the time in 1968, 4.2% in 2000.
    shutoutGaps.push(shutouts - mlbShutoutRate(season.year));
    assert.ok(Math.abs(shutoutGaps.at(-1)) < 0.022,
      `${season.year}: ${(100 * shutouts).toFixed(1)}% shut out against the league's ${(100 * mlbShutoutRate(season.year)).toFixed(1)}%`);
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(mean(errors)) < 0.01, `on average ${(100 * mean(errors)).toFixed(2)}% from the league's runs`);
  // The model's sides are shut out a shade more often than the league's, half a point on average.
  assert.ok(mean(shutoutGaps) > -0.005 && mean(shutoutGaps) < 0.01, `shutouts ${(100 * mean(shutoutGaps)).toFixed(2)} points from the league's`);
});

// ---------- extra innings ----------

/**
 * Games between two average sides (an even edge) under `sport`: the share going to extra innings, of those ending in the
 * tenth, and the longest.
 */
function extraInnings(sport, games, seed) {
  const prepared = { ...sport.prepareMatch(...EVEN), edgeA: 0, edgeD: 0 };
  const rng = makeRng(seed);
  let extras = 0, tenth = 0, longest = 0;
  for (let i = 0; i < games; i++) {
    const { tie } = sport.sampleResult(rng, prepared, 6);
    if (!tie) continue;
    extras++;
    tenth += tie.periods.length === 1;
    longest = Math.max(longest, tie.periods.length);
  }
  return { extras: extras / games, tenth: tenth / extras, longest };
}

test('extra innings follow the season: 44% of extra-inning games end in the tenth before 2020, 69% with the runner', () => {
  // 43.9% of 2019's extra-inning games ended in the tenth, 69.1% of 2020's (Wikipedia's "Extra innings").
  const before = extraInnings(sportIn(2019), 60000, 2019), runner = extraInnings(sportIn(2020), 60000, 2020);
  assert.ok(before.tenth > 0.41 && before.tenth < 0.48, `2019: ${before.tenth}`);
  assert.ok(runner.tenth > 0.65 && runner.tenth < 0.74, `2020: ${runner.tenth}`);
  assert.ok(before.extras > 0.07 && before.extras < 0.13 && runner.extras > 0.07 && runner.extras < 0.13);
  assert.ok(before.longest > 6 && before.longest <= 12, `before the runner up to twelve extra innings (${before.longest})`);
  assert.ok(runner.longest <= 6);
  // A full game of 1968 tells every run in order, as far as the twenty-first inning.
  const sport = sportIn(1968);
  const rng = makeRng(68);
  let deep = 0;
  for (let i = 0; i < 20000; i++) {
    const result = sport.simulate(rng, EVEN[0], EVEN[1], 6);
    const sum = id => result.ev.filter(e => e.tid === id).reduce((total, e) => total + e.pts, 0);
    assert.deepEqual([sum('a'), sum('d')], [result.ga, result.gd]);
    assert.ok(result.ev.every((e, k) => e.m >= 1 && e.m <= 54 + 12 * 6 && (k === 0 || result.ev[k - 1].m <= e.m)));
    if (result.tie?.periods.length > 6) deep++;
  }
  // About one game in a hundred and fifty went past fifteen innings, as no game can with the runner on second.
  assert.ok(deep > 40 && deep < 400, `${deep} of 20,000 games of 1968 went past fifteen innings`);
});

// ---------- the live chart ----------

test('the live chart starts at the fixture odds and plays out each season\'s extra innings', () => {
  for (const year of [1968, 2000, 2019, 2021]) {
    const season = seasonOf(year), sport = matchSport(settingsOf(season)), clubs = clubsOf(season);
    for (const [i, j] of [[0, clubs.length - 1], [3, 4]]) {
      const model = liveModelFor(sport, clubs[i], clubs[j], undefined, undefined, 6);
      assert.ok(isLiveModel(model));
      const rules = rulesOf(sport);
      assert.deepEqual([model.score, model.extra, model.more, model.maxOt], [rules.score, rules.extra, rules.more, rules.maxExtra]);
      const odds = estimateWinProbability({ sport, attacker: clubs[i], defender: clubs[j], preset: 'balanced', samples: 12000 }).attacker;
      assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `${year}: first pitch ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    }
  }
  // Equal sides and no form, the attacker a run up after the top of the tenth: the home side must score exactly one to
  // stay level, none to lose. With the runner on second it scores 60% of the time, without it as often as in the ninth.
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  for (const year of [1968, 2019, 2021]) {
    const sport = sportIn(year), rules = rulesOf(sport);
    const model = liveModelFor(sport, ...EVEN, undefined, undefined, 0);
    const extra = runMasses(inningOdds(model.edgeD, rules).extra, rules.more);
    const fromLevel = winProbabilityAt(model, 60, 0);
    assert.ok(near(fromLevel, 0.5), `${year}: equal sides level after ten, ${fromLevel}`);
    const expected = extra[0] + extra[1] * fromLevel;
    assert.ok(near(winProbabilityAt(model, 57, 1), expected), `${year}: ${winProbabilityAt(model, 57, 1)} v ${expected}`);
  }
  const standard = liveModelFor(sportIn(1968), ...EVEN, undefined, undefined, 0), runner = liveModelFor(sportIn(2021), ...EVEN, undefined, undefined, 0);
  assert.ok(winProbabilityAt(standard, 57, 1) > winProbabilityAt(runner, 57, 1) + 0.2, 'a run in the top of the tenth is worth far more without the runner');
  // Before 2020 the chart can run to the twenty-first inning; level after it, the decisive run is a coin flip.
  assert.equal(chartDomain(standard, 54 + 12 * 6).length, 54 + 12 * 6);
  assert.ok(near(winProbabilityAt(standard, 54 + 12 * 6, 0), 0.5));
  // The built-in season's live model is as it always was, and an earlier season's must carry all of its odds.
  const today = liveModelFor(baseball, ...EVEN, undefined, undefined, 6);
  assert.deepEqual(Object.keys(today), ['kind', 'edgeA', 'edgeD', 'formSd', 'length', 'ot', 'maxOt']);
  assert.equal(today.maxOt, 6);
  assert.ok(isLiveModel(JSON.parse(JSON.stringify(standard))));
  assert.ok(!isLiveModel({ ...standard, more: undefined }) && !isLiveModel({ ...standard, more: 1 }) && !isLiveModel({ ...standard, score: 'x' }));
});
