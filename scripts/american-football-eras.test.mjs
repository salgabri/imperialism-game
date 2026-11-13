// American football by era (docs/design/american-football.md, "Rules by era"): each built-in earlier season plays its
// day's scoring, tries and overtime (src/sports/americanFootball.js, seasonRules), read through matchSport, and scores as
// its league did (src/data/nflLeagueAverages.js); the built-in season keeps today's rules exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.american-football.js';
import { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } from '../src/data/americanFootballSeasons.js';
import { LATEST_NFL_SEASON, NFL_LEAGUE_AVERAGES, NFL_SEASON_MATCHUPS } from '../src/data/nflLeagueAverages.js';
import { americanFootball, americanFootballIn, overtimeRule, seasonRules, twoPointTry } from '../src/sports/americanFootball.js';
import { matchSport, overtimeEnd, overtimeText } from '../src/sports/index.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { campaignPreview } from '../src/screens/setup/setupModel.js';
import { clubsOf as clubPagesOf, nflverseSeasons, tiesOf } from './build-nfl-scoring.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const SEASONS = BUILT_IN_AMERICAN_FOOTBALL_SEASONS;
const byId = Object.fromEntries(SEASONS.map(season => [season.id, season]));
const leagueOf = season => (season.id.startsWith('pfa-afl-') ? 'AFL' : 'NFL');
const settingsOf = season => ({ sport: 'american-football', layer: 'clubs', clubScope: `domestic:${season.map}`, dataSet: season.id,
  dataYear: season.year, dataSeason: season.season });
const sportOf = id => matchSport(settingsOf(byId[id]));
const clubsOf = id => JSON.parse(read(`public/american-football/${id}.json`)).clubs.map(club => buildClub(club, americanFootball));
// A season past the table's last (2025: Pro Football Archives had none on 2026-11-13) plays the latest one's figures.
const figuresOf = season => NFL_LEAGUE_AVERAGES[leagueOf(season)][leagueOf(season) === 'NFL' ? Math.min(season.year, LATEST_NFL_SEASON) : season.year];
const perGame = (season, key) => figuresOf(season)[key] / figuresOf(season).games;
const builtIn = CLUBS.map(club => buildClub(club, americanFootball));

/**
 * Mean points a side, overtime included as the league's figures are, over every pairing of `clubs`, enough draws each for
 * about 4,000 games (a small league's eight clubs make only 56 pairings): within about 0.1 of the model's mean.
 */
function clubScoring(sport, clubs, seed = 7) {
  const draws = Math.ceil(4000 / (clubs.length * (clubs.length - 1)));
  const rng = makeRng(seed);
  let points = 0, sides = 0;
  for (const attacker of clubs) {
    for (const defender of clubs) {
      if (attacker === defender) continue;
      const pairing = sport.prepareMatch(attacker, defender);
      for (let k = 0; k < draws; k++) {
        const result = sport.sampleResult(rng, pairing, 6);
        points += result.ga + result.gd;
        sides += 2;
      }
    }
  }
  return points / sides;
}

// ---------- the rules of each season's day ----------

test('the built-in season plays today\'s rules: matchSport hands back the sport itself', () => {
  for (const settings of [{ sport: 'american-football' }, { sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl' }]) {
    assert.equal(matchSport(settings), americanFootball);
  }
  assert.equal(americanFootballIn({}), americanFootball);
  const { rules } = americanFootball.prepareMatch(builtIn[0], builtIn[1]);
  assert.deepEqual({ overtime: rules.overtime, ot: rules.ot, two: rules.two, early: rules.early, chart: rules.chart, edge: rules.edge, kicker: rules.kicker },
    { overtime: 'both', ot: 10, two: 0.48, early: 0.085, chart: 1, edge: 0, kicker: 80 });
  assert.deepEqual(americanFootball.clock, { length: 60, msPerUnit: 65, ot: 10, sudden: true });
  assert.equal(americanFootball.simulationVersion, 4);
});

test('the record\'s rules: overtime by the playoffs of the day, the two-point try in the AFL and in the NFL from 1994', () => {
  assert.deepEqual([1960, 1969].map(year => overtimeRule('AFL', year)), ['sudden', 'sudden']);
  assert.deepEqual([1960, 1973, 1974, 2009, 2010, 2016, 2017, 2021, 2022, 2025].map(year => overtimeRule('NFL', year)),
    ['sudden', 'sudden', 'sudden', 'sudden', 'modified', 'modified', 'modified', 'modified', 'both', 'both']);
  assert.deepEqual([[1960, 'AFL'], [1969, 'AFL'], [1969, 'NFL'], [1993, 'NFL'], [1994, 'NFL'], [2025, 'NFL']].map(([year, league]) => twoPointTry(league, year)),
    [true, true, false, false, true, true]);
});

test('every earlier season plays its own day\'s rules, one sport object per season', () => {
  assert.equal(SEASONS.length, 76);
  const ruled = new Set(['simulationVersion', 'clock', 'prepareMatch', 'simulate']);
  for (const season of SEASONS) {
    const league = leagueOf(season), year = season.year;
    const sport = matchSport(settingsOf(season));
    assert.notEqual(sport, americanFootball, season.id);
    assert.equal(sport, matchSport(settingsOf(season)), `${season.id}: one object, so caches keyed by it hold`);
    assert.equal(sport.id, 'american-football');
    assert.equal(sport.simulationVersion, 5);
    assert.ok(figuresOf(season), `${season.id}: the table has the ${league}'s ${year}`);
    assert.ok(NFL_SEASON_MATCHUPS[season.id], `${season.id}: its average matchup`);
    const { rules } = sport.prepareMatch(builtIn[0], builtIn[1]);
    assert.deepEqual(rules, seasonRules(league, year, season.id));
    assert.equal(rules.overtime, overtimeRule(league, year), season.id);
    assert.equal(rules.ot, league === 'NFL' && year >= 2017 ? 10 : 15, `${season.id}: fifteen-minute periods before 2017`);
    assert.deepEqual(sport.clock, { length: 60, msPerUnit: 65, ot: rules.ot, sudden: true });
    assert.equal(rules.two > 0, twoPointTry(league, year), `${season.id}: the two-point try`);
    if (!twoPointTry(league, year)) assert.deepEqual([rules.two, rules.early, rules.chart], [0, 0, 0]);
    // The season's own kicking: its league's field goals and extra points made, by its average kicker.
    const figures = figuresOf(season);
    assert.equal(rules.make, figures.fgm / figures.fga);
    assert.equal(rules.xp, figures.xpm / figures.xpa);
    assert.deepEqual([rules.edge, rules.kicker], [NFL_SEASON_MATCHUPS[season.id].edge, NFL_SEASON_MATCHUPS[season.id].kicking]);
    // Only the rulebook's members differ: the squads, labels and score-only sampler are the sport's own.
    assert.deepEqual(Object.keys(sport), Object.keys(americanFootball));
    for (const key of Object.keys(americanFootball)) if (!ruled.has(key)) assert.equal(sport[key], americanFootball[key], `${season.id} ${key}`);
  }
  // A season not yet finished plays the latest finished one's scoring, under its own year's overtime.
  const later = seasonRules('NFL', LATEST_NFL_SEASON + 1, 'madden-2025');
  const latest = seasonRules('NFL', LATEST_NFL_SEASON, 'madden-2025');
  assert.deepEqual({ ...later, year: LATEST_NFL_SEASON }, latest);
  assert.equal(seasonRules('NFL', 1959, 'madden-2025'), null);
});

test('the scoring table\'s readers: club pages without the misspelt draft link, ties, nflverse\'s regular seasons', () => {
  const index = '<a href="2008nfl-boxscores.html">Boxscores</a> <a href="2008nflraft.html">Draft</a> <a href="/2008nflpit.html">Pittsburgh</a>'
    + ' <a href="2008nflmia.html">Miami</a>';
  assert.deepEqual(clubPagesOf(index, 2008, 'nfl'), ['2008nflpit.html', '2008nflmia.html']);
  const row = (kind, pf, pa, result, extra = '') => `<tr${kind ? ` class="${kind}"` : ''}><td>Sun</td><td>9/1/1965</td><td>H</td><td>X</td>`
    + `<td>${pf}</td><td>${pa}</td><td>${result}</td><td>${extra}</td><td>City</td><td>Field</td><td>1000</td></tr>`;
  const scores = `<table><tr><th colspan="11">SCORES</th></tr>${row('exh', 7, 7, 'T')}${row('', 13, 13, 'T')}${row('', 20, 17, 'W', 'OT')}`
    + `${row('', 10, 10, 'T')}${row('playoff', 3, 3, 'T')}</table>`;
  assert.equal(tiesOf(scores), 2, 'the regular season\'s ties, not an exhibition\'s or a playoff\'s');
  const csv = ['game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location,result,total,overtime',
    '1999_01_A_B,1999,REG,1,,,,A,17,B,14,Home,-3,31,0', '1999_02_C_D,1999,REG,2,,,,C,20,D,23,Home,3,43,1',
    '1999_18_A_D,1999,WC,18,,,,A,10,D,13,Home,3,23,0', '2026_10_A_B,2026,REG,10,,,,A,NA,B,NA,Home,NA,NA,NA'].join('\n');
  assert.deepEqual(nflverseSeasons(csv), { 1999: { games: 4, points: 74, overtime: 1 } });
});

test('the scoring table rebuilds, and each season\'s average matchup is its clubs\'', () => {
  const out = execFileSync(process.execPath, ['scripts/build-nfl-scoring.mjs', '--check'], { cwd: fileURLToPath(root), encoding: 'utf8' });
  assert.match(out, /Verified .*src[\\/]data[\\/]nflLeagueAverages\.js byte for byte/);
  const table = JSON.parse(read('scripts/data/nfl-scoring.json'));
  assert.deepEqual(Object.keys(table.matchups).sort(), ['built-in', ...SEASONS.map(season => season.id)].sort());
  for (const [key, season] of Object.entries(table.seasons)) {
    // Every point is a touchdown with its try, a field goal, a safety or the defence's returned try (since 2015), but for
    // a slip in a season's tables, which the table keeps: a point or two, and a touchdown in 2022 (the Steelers' scoring
    // lists 29 of their 30, their points and score table 308).
    const parts = 6 * season.td + season.xpm + 2 * season.twoMade + 3 * season.fgm + 2 * season.safeties + 2 * (season.defensiveTwo ?? 0);
    assert.equal(season.scoredParts ?? season.points, parts, key);
    assert.ok(Math.abs(season.points - parts) <= (key === 'NFL 2022' ? 6 : 2), `${key}: ${season.points} points, ${parts} by their parts`);
    assert.ok(season.xpa + season.twoAtt <= season.td, `${key}: a try a touchdown at most`);
    if (season.nflverse) {
      assert.equal(season.nflverse.games, season.games, `${key}: nflverse's games`);
      assert.ok(Math.abs(season.nflverse.points - season.points) <= 2, `${key}: nflverse's ${season.nflverse.points} points`);
    }
  }
  assert.deepEqual(Object.keys(table.seasons).filter(key => key.startsWith('AFL')).length, 10);
  assert.deepEqual(Object.keys(table.seasons).filter(key => key.startsWith('NFL')).map(key => Number(key.slice(4))),
    Array.from({ length: LATEST_NFL_SEASON - 1959 }, (_, i) => 1960 + i));
});

// ---------- the scores ----------

test('every built-in season scores like its league: 17.2 points a team in 1977, 22.9 in 2024', () => {
  const misses = [];
  for (const season of SEASONS) {
    const real = perGame(season, 'points');
    const points = clubScoring(sportOf(season.id), clubsOf(season.id));
    if (Math.abs(points - real) >= 1) misses.push(`${season.id}: ${points.toFixed(2)} against the league's ${real.toFixed(2)}`);
  }
  assert.deepEqual(misses, []);
  // The built-in season keeps today's tuning, on 2023 and 2024's figures, within half a point of 2024's.
  const latest = SEASONS.find(season => season.year === LATEST_NFL_SEASON);
  assert.ok(Math.abs(clubScoring(americanFootball, builtIn) - perGame(latest, 'points')) < 0.5);
});

/** Every play of `games` score-only games between the season's clubs, the matchups cycling. */
function plays(id, games, seed) {
  const sport = sportOf(id), clubs = clubsOf(id), rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < games; i++) {
    const a = clubs[i % clubs.length], d = clubs[(i * 7 + 3) % clubs.length];
    if (a === d) continue;
    out.push(sport.sampleResult(rng, sport.prepareMatch(a, d, teamEff(a), teamEff(d)), 6));
  }
  return out;
}

test('the NFL kicked every extra point before 1994; the AFL and the NFL since go for two about as often as they did', () => {
  for (const [id, games] of [['pfa-1965', 4000], ['pfa-1977', 4000], ['tecmo-1993', 4000]]) {
    const touchdowns = plays(id, games, 11).flatMap(r => r.plays).filter(p => p.pts >= 6 && p.conversion);
    assert.ok(touchdowns.length > 1000 && touchdowns.every(p => p.conversion === 'kick'), `${id}: every try a kick`);
  }
  for (const id of ['pfa-afl-1965', 'pfa-1999', 'madden-2010', 'madden-2025']) {
    const touchdowns = plays(id, 6000, 12).flatMap(r => r.plays).filter(p => p.pts >= 6 && p.conversion);
    const share = touchdowns.filter(p => p.conversion === 'two').length / touchdowns.length;
    const real = figuresOf(byId[id]).twoAtt / figuresOf(byId[id]).td;
    assert.ok(Math.abs(share - real) < 0.025, `${id}: ${share.toFixed(3)} of the touchdowns go for two, ${real.toFixed(3)} in the league`);
  }
});

test('sudden death to 2009 and in the AFL: the first score of overtime wins, a touchdown without its try', () => {
  let overtimes = 0, walkOffs = 0, longest = 0;
  for (const id of ['pfa-afl-1962', 'pfa-1977', 'madden-2005']) {
    const sport = sportOf(id), clubs = clubsOf(id), rng = makeRng(31);
    for (let i = 0; i < 6000; i++) {
      const a = clubs[i % clubs.length], d = clubs[(i * 5 + 1) % clubs.length];
      if (a === d) continue;
      const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
      assert.notEqual(result.ga, result.gd);
      if (!result.tie) { assert.ok(result.ev.every(e => e.m <= 60)); continue; }
      overtimes++;
      // Level periods have no score but the bounded decisive field goal of the last; the deciding period one score.
      const last = result.tie.periods.at(-1);
      result.tie.periods.slice(0, -1).forEach(period => assert.deepEqual(period, [0, 0], `${id}: a period with a score has ended the game`));
      assert.ok([2, 3, 6].includes(Math.abs(last[0] - last[1])) && Math.min(...last) === 0, `${id}: one score decides it (${last})`);
      const overtimeEvents = result.ev.filter(e => e.m > 60);
      assert.equal(overtimeEvents.length, 1, `${id}: the deciding score is overtime's only one`);
      const [deciding] = overtimeEvents;
      if (deciding.pts === 6) walkOffs++;
      assert.ok(deciding.pts !== 7 && deciding.pts !== 8, 'no try after a winning touchdown');
      // Fifteen-minute periods.
      const period = result.tie.periods.length;
      assert.ok(deciding.m > 60 + (period - 1) * 15 && deciding.m <= 60 + period * 15, `${id}: minute ${deciding.m} in period ${period}`);
      longest = Math.max(longest, deciding.m);
    }
  }
  assert.ok(overtimes > 100 && walkOffs > 0, `${overtimes} overtimes, ${walkOffs} won by a touchdown`);
  assert.ok(longest > 75, 'a second period reached');
});

test('modified sudden death, 2010 to 2021: a first-possession touchdown wins, a field goal is answered, then sudden death', () => {
  let answered = 0, levelled = 0, firstTouchdowns = 0;
  for (const id of ['madden-2012', 'madden-2019']) {
    const sport = sportOf(id), clubs = clubsOf(id), rng = makeRng(41);
    for (let i = 0; i < 12000; i++) {
      const a = clubs[i % clubs.length], d = clubs[(i * 5 + 1) % clubs.length];
      if (a === d) continue;
      const { plays: all, tie } = sport.sampleResult(rng, sport.prepareMatch(a, d, teamEff(a), teamEff(d)), 6);
      if (!tie) continue;
      const first = all.filter(p => p.period === 1);
      assert.ok(first.every(p => !p.conversion), 'no tries in overtime');
      const [opening, reply] = first;
      if (opening.pts === 6) { firstTouchdowns++; assert.equal(first.length, 1, 'a first-possession touchdown ends it'); }
      if (opening.pts === 3) {
        answered++;
        assert.ok(reply, 'a field goal is answered');
        if (reply.pts === 6) assert.equal(first.length, 2, 'the answer\'s touchdown wins');
        if (reply.pts === 3) { levelled++; assert.notEqual(reply.side, opening.side, 'the answer\'s field goal draws level'); }
      }
    }
  }
  assert.ok(firstTouchdowns > 20 && answered > 20 && levelled > 0, `${firstTouchdowns} first-possession touchdowns, ${answered} field goals answered, ${levelled} levelled`);
});

// ---------- the live chart ----------

test('the live chart follows the season\'s overtime: exact chains, fifteen-minute periods, a sudden-death lead won', () => {
  for (const [id, rule] of [['pfa-1977', 'sudden'], ['pfa-afl-1965', 'sudden'], ['madden-2015', 'modified'], ['madden-2019', 'modified'], ['madden-2023', 'both']]) {
    const sport = sportOf(id), clubs = clubsOf(id);
    const [a, d] = [clubs[2], clubs[5]];
    const model = liveModelFor(sport, a, d, teamEff(a), teamEff(d), 0);
    assert.ok(isLiveModel(model), id);
    assert.equal(model.overtime, rule === 'both' ? undefined : rule);
    assert.equal(model.ot, sport.clock.ot);
    // The chain is exact for the simulation's overtime, before form (Predictable).
    const prepared = sport.prepareMatch(a, d, teamEff(a), teamEff(d));
    const rng = makeRng(77);
    let overtimes = 0, attackerWins = 0;
    for (let i = 0; i < 120000; i++) {
      const result = sport.sampleResult(rng, prepared, 0);
      if (!result.tie) continue;
      overtimes++;
      if (result.ga > result.gd) attackerWins++;
    }
    const exact = model.otChain[3], simulated = attackerWins / overtimes;
    assert.ok(Math.abs(simulated - exact) < 3.5 * Math.sqrt(exact * (1 - exact) / overtimes), `${id}: chain ${exact} v ${simulated} over ${overtimes}`);
    const length = 60 + model.ot;
    assert.equal(winProbabilityAt(model, 60, 0), model.otChain[3]);
    assert.deepEqual(chartDomain(model, length).ticks, [0, 15, 30, 45, 60, length], 'quarters, then each overtime period');
    if (rule === 'sudden') {
      assert.deepEqual([3, -3, 6, -2].map(lead => winProbabilityAt(model, 63, lead)), [1, 0, 1, 0], 'a lead in sudden death has won');
    } else if (rule === 'modified') {
      // A first possession's field goal leaves one answer; a touchdown has won.
      assert.ok(winProbabilityAt(model, 63, 3) > 0.5 && winProbabilityAt(model, 63, 3) < 1);
      assert.deepEqual([6, -6, 2].map(lead => winProbabilityAt(model, 63, lead)), [1, 0, 1]);
    }
    assert.equal(isLiveModel({ ...model, overtime: 'golden' }), false);
  }
  // A sudden-death season's series stops at its deciding score, fifteen minutes a period.
  const sport = sportOf('pfa-1977'), clubs = clubsOf('pfa-1977');
  const model = liveModelFor(sport, clubs[0], clubs[1]);
  const series = winSeries({ model, goals: [{ m: 20, tid: 'a', pts: 7 }, { m: 50, tid: 'd', pts: 7 }, { m: 82, tid: 'a', pts: 3 }], aId: 'a', dId: 'd',
    minute: 82, final: { winnerSide: 'A' } });
  assert.deepEqual([series.at(-1).t, series.at(-1).p], [82, 1]);
  assert.deepEqual(chartDomain(model, 82).ticks, [0, 15, 30, 45, 60, 75, 90]);
});

test('the clock, the ticker and the setup read the season\'s rules', () => {
  const sport = sportOf('pfa-1977');
  assert.deepEqual(sport.formatEvent({ m: 74, pts: 3, name: 'Efren Herrera' }, 'DAL'), { when: 'OT', text: 'FG — Efren Herrera (DAL)' });
  assert.equal(sport.formatEvent({ m: 59, pts: 7, name: 'Tony Dorsett' }, 'DAL').when, 'Q4');
  assert.equal(overtimeEnd(sport, 2), 0, 'overtime ends at its deciding score');
  assert.equal(overtimeText(sport, 2), 'after 2 overtime periods');
  // The setup's campaign preview reads the season's clock: sixty minutes in every era.
  const season = { ...americanFootball, dataSet: 'pfa-1977', dataYear: 1977, dataSeason: '1977' };
  const setup = { layer: 'clubs', clubScope: 'domestic:nfl1976', finale: 'single' };
  assert.deepEqual(campaignPreview(28, season, setup), campaignPreview(28, americanFootball, setup));
});
