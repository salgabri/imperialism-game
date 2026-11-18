// College football by era (docs/design/college-football.md, "Rules by era"): each FBS season from 2009 (data set
// cfb-<year>) plays its day's scoring and the NCAA overtime of its day (src/sports/collegeFootball.js,
// collegeSeasonRules), read through matchSport, and scores as its league did (src/data/collegeLeagueAverages.js); the
// built-in season keeps today's rules, draw for draw, and so does the NFL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.college-football.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { COLLEGE_LEAGUE_AVERAGES, COLLEGE_REFERENCE_SEASONS, COLLEGE_SEASON_MATCHUPS, FIRST_COLLEGE_SEASON, LATEST_COLLEGE_SEASON }
  from '../src/data/collegeLeagueAverages.js';
import { COLLEGE_RULES, collegeFootball, collegeFootballIn, collegeOvertimeRule, collegeSeasonRules } from '../src/sports/collegeFootball.js';
import { collegeOvertimeOf, prepareMatch, sampleResult } from '../src/sports/americanFootball.js';
import { getSport, matchSport, overtimeShort, overtimeText } from '../src/sports/index.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { campaignPreview } from '../src/screens/setup/setupModel.js';
import { isFieldGoalTry, isTouchdown, seasonFigures, touchdownsOf } from './build-college-scoring.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const YEARS = Array.from({ length: LATEST_COLLEGE_SEASON - FIRST_COLLEGE_SEASON + 1 }, (_, i) => FIRST_COLLEGE_SEASON + i);
const settingsOf = year => ({ sport: 'college-football', layer: 'clubs', clubScope: 'domestic:cfb', dataSet: `cfb-${year}`, dataYear: year,
  dataSeason: String(year) });
const sportOf = year => matchSport(settingsOf(year));
const builtIn = CLUBS.map(club => buildClub(club, collegeFootball));
/** A season's schools: its own file's where there is one (public/college-football/cfb-<year>.json), else the built-in season's. */
const schoolsOf = year => {
  const file = new URL(`public/college-football/cfb-${year}.json`, root);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).clubs.map(club => buildClub(club, collegeFootball)) : builtIn;
};
const totals = years => {
  const out = {};
  for (const year of years) for (const [key, value] of Object.entries(COLLEGE_LEAGUE_AVERAGES[year])) out[key] = (out[key] ?? 0) + value;
  return out;
};
const perGame = (s, key) => s[key] / s.games;
/** One school against its twin: equal sides, so overtimes come often. */
const twins = (sport, index = 69) => sport.prepareMatch(builtIn[index], { ...builtIn[index], id: 'twin' });

// ---------- the rules of each season's day ----------

test('the built-in season plays today\'s rules: matchSport hands back the sport itself', () => {
  for (const settings of [{ sport: 'college-football' }, { sport: 'college-football', layer: 'clubs', clubScope: 'domestic:cfb' },
    { sport: 'college-football', dataSet: 'madden-2010', dataYear: 2010 }]) {
    assert.equal(matchSport(settings), collegeFootball);
  }
  assert.equal(collegeFootballIn({}), collegeFootball);
  assert.equal(getSport('college-football'), collegeFootball);
  assert.equal(collegeFootball.simulationVersion, 1);
  assert.equal(collegeFootball.prepareMatch(builtIn[0], builtIn[1]).rules, COLLEGE_RULES);
  assert.ok(!('otTwoFrom' in COLLEGE_RULES) && !('otPlaysFrom' in COLLEGE_RULES), 'today\'s rulebook names no era');
  assert.deepEqual(collegeOvertimeOf(COLLEGE_RULES), { twoFrom: 2, playsFrom: 3 });
  // A season before the table plays today's rules.
  assert.equal(collegeSeasonRules(2008, 'cfb-2008'), null);
  assert.equal(matchSport(settingsOf(2008)), collegeFootball);
});

test('the NCAA\'s overtime by year: the 1997 rules to 2018, two-point plays from the fifth period in 2019 and 2020, today\'s from 2021', () => {
  assert.deepEqual([2009, 2013, 2018].map(collegeOvertimeRule), Array(3).fill({ otTwoFrom: 3, otPlaysFrom: null }));
  assert.deepEqual([2019, 2020].map(collegeOvertimeRule), Array(2).fill({ otTwoFrom: 3, otPlaysFrom: 5 }));
  assert.deepEqual([2021, 2025, 2026].map(collegeOvertimeRule), Array(3).fill({ otTwoFrom: 2, otPlaysFrom: 3 }));
});

test('every season from 2009 plays its own day\'s rules, one sport object per season', () => {
  const ruled = new Set(['simulationVersion', 'clock', 'prepareMatch', 'simulate']);
  const reference = totals(COLLEGE_REFERENCE_SEASONS);
  for (const year of YEARS) {
    const sport = sportOf(year);
    assert.notEqual(sport, collegeFootball, `${year}`);
    assert.equal(sport, sportOf(year), `${year}: one object, so caches keyed by it hold`);
    assert.equal(sport.id, 'college-football');
    assert.equal(sport.simulationVersion, 2);
    const { rules, drives } = sport.prepareMatch(builtIn[0], builtIn[1]);
    assert.deepEqual(rules, collegeSeasonRules(year, `cfb-${year}`));
    assert.equal(drives, rules.drives);
    assert.equal(rules.year, year);
    assert.equal(rules.overtime, 'college');
    assert.deepEqual({ otTwoFrom: rules.otTwoFrom, otPlaysFrom: rules.otPlaysFrom }, collegeOvertimeRule(year));
    assert.deepEqual(sport.clock, collegeFootball.clock);
    // Its own average matchup: its schools' where it has a file, else the built-in schools'.
    const matchup = COLLEGE_SEASON_MATCHUPS[`cfb-${year}`] ?? COLLEGE_SEASON_MATCHUPS['built-in'];
    assert.deepEqual([rules.edge, rules.kicker], [matchup.edge, matchup.kicking]);
    // Its possessions move with its league's: more than today's in the 2010s, as many a game as ESPN's drives had.
    const figures = COLLEGE_LEAGUE_AVERAGES[year];
    assert.ok(Math.abs(rules.drives / COLLEGE_RULES.drives - perGame(figures, 'possessions') / perGame(reference, 'possessions')) < 1e-12);
    assert.ok(rules.driveRange[0] < rules.drives && rules.drives < rules.driveRange[1]);
    assert.ok(rules.makeRange[0] < rules.make && rules.make < rules.makeRange[1] && rules.xpRange[0] < rules.xp && rules.xp < rules.xpRange[1]);
    // Two-point tries as today: no source names them.
    assert.deepEqual([rules.two, rules.early, rules.chart, rules.scale, rules.homeEdge], [COLLEGE_RULES.two, COLLEGE_RULES.early, COLLEGE_RULES.chart,
      COLLEGE_RULES.scale, COLLEGE_RULES.homeEdge]);
    // Only the rulebook's members differ: the squads, labels and score-only sampler are the sport's own.
    assert.deepEqual(Object.keys(sport), Object.keys(collegeFootball));
    for (const key of Object.keys(collegeFootball)) if (!ruled.has(key)) assert.equal(sport[key], collegeFootball[key], `${year} ${key}`);
  }
  // The 2010s' faster game: 2014 had more possessions than any season, 2025 the fewest.
  const drives = YEARS.map(year => sportOf(year).prepareMatch(builtIn[0], builtIn[1]).drives);
  assert.equal(YEARS[drives.indexOf(Math.max(...drives))], 2014);
  assert.equal(YEARS[drives.indexOf(Math.min(...drives))], 2025);
  // 2011's box scores name no missed extra point: it kicks as 2010 and 2012 did between them.
  const xp = year => collegeSeasonRules(year, `cfb-${year}`).xp;
  assert.equal(COLLEGE_LEAGUE_AVERAGES[2011].xpa, null);
  assert.ok(xp(2011) > Math.min(xp(2010), xp(2012)) && xp(2011) < Math.max(xp(2010), xp(2012)));
  // A season past the table plays the latest's figures, under its own year's overtime.
  const later = collegeSeasonRules(LATEST_COLLEGE_SEASON + 1, 'cfb-2026');
  assert.deepEqual({ ...later, year: LATEST_COLLEGE_SEASON }, collegeSeasonRules(LATEST_COLLEGE_SEASON, 'cfb-2026'));
});

// ---------- the scoring table ----------

test('the box scores\' scoring: touchdowns, two-point tries and unnamed safeties from a school\'s points', () => {
  assert.deepEqual(touchdownsOf({ points: 24, xpm: 3, xpa: 3, fgm: 1, safeties: 0 }), { td: 3, twoAtt: 0, twoMade: 0, safeties: 0 });
  // 8 points with no kick tried: a touchdown and its two-point try made; 6, a walk-off (no try) or a try missed.
  assert.deepEqual(touchdownsOf({ points: 8, xpm: 0, xpa: 0, fgm: 0, safeties: 0 }), { td: 1, twoAtt: 1, twoMade: 1, safeties: 0 });
  assert.deepEqual(touchdownsOf({ points: 13, xpm: 1, xpa: 1, fgm: 0, safeties: 0 }), { td: 2, twoAtt: 1, twoMade: 0, safeties: 0 });
  // Two points no try explains: a safety the drives did not name.
  assert.deepEqual(touchdownsOf({ points: 9, xpm: 1, xpa: 1, fgm: 0, safeties: 0 }), { td: 1, twoAtt: 0, twoMade: 0, safeties: 1 });
  assert.equal(touchdownsOf({ points: 7, xpm: 0, xpa: 0, fgm: 0, safeties: 0 }), null, 'a kicker\'s row missing');
  assert.ok(isTouchdown('TD') && isTouchdown('PASSING TD') && isTouchdown('INT RETURN TOUCH') && isTouchdown('MISSED FG TD') && !isTouchdown('2PT'));
  assert.ok(isFieldGoalTry('FG GOOD') && isFieldGoalTry('MISSED FG') && isFieldGoalTry('FG MISSED TD') && !isFieldGoalTry('PUNT'));
  // A season's figures: a game whose drives cover the four quarters counts, possessions of a play or more only, overtime's
  // touchdowns apart; a game without drives does not.
  const game = (id, home, away, extra = {}) => ({ game_id: id, home_id: 1, away_id: 2, home_division: 'fbs', away_division: 'fbs', completed: true,
    season_type: 'regular', home_points: home, away_points: away, ...extra });
  const drive = (id, team, period, result, plays = 5) => ({ game_id: id, team_id: team, start_period: period, result, offensive_plays: plays });
  const kick = (id, team, fg, xp) => ({ game_id: id, team_id: team, category: 'kicking', 'fieldGoalsMade/fieldGoalAttempts': fg,
    'extraPointsMade/extraPointAttempts': xp });
  // The home side's 31: touchdowns in the first and fourth quarters, a kick-off return (no possession) and one in overtime,
  // all kicked, and a field goal; the visitors' 18: two touchdowns (one kicked), a field goal in overtime and a safety.
  const figures = seasonFigures(2013, {
    schedule: [game(1, 31, 18), game(2, 7, 0), game(3, 14, 14, { completed: false }), game(4, 3, 0, { away_division: 'fcs' })],
    drives: [drive(1, 1, 1, 'TD'), drive(1, 2, 1, 'PUNT'), drive(1, 1, 2, 'FG GOOD'), drive(1, 2, 2, 'TD'), drive(1, 1, 3, 'SF'),
      drive(1, 2, 3, 'FG MISSED'), drive(1, 1, 4, 'PASSING TD'), drive(1, 2, 4, 'TD'), drive(1, 1, 4, 'KICKOFF RETURN TD', 0),
      drive(1, 2, 4, 'END OF HALF', 0), drive(1, 1, 5, 'TD', 3), drive(1, 2, 5, 'FG GOOD', 4), drive(2, 1, 1, 'TD')],
    box: [kick(1, 1, '1/1', '4/4'), kick(1, 2, '1/2', '1/2'), kick(2, 1, '0/0', '1/1')],
  });
  assert.deepEqual(figures, { fbs: 2, games: 2, points: 49, td: 6, otTd: 1, possessions: 8, fga: 3, otFga: 1, fgm: 2, xpa: 6, xpm: 5,
    safeties: 1, twoAtt: 0, twoMade: 0, left: { drives: 1, scoring: 0, shootout: 0 } });
});

test('the scoring table rebuilds, every point adds up, and 2024 and 2025 agree with cfbstats.com', () => {
  const out = execFileSync(process.execPath, ['scripts/build-college-scoring.mjs', '--check'], { cwd: fileURLToPath(root), encoding: 'utf8' });
  assert.match(out, /Verified .*src[\\/]data[\\/]collegeLeagueAverages\.js byte for byte/);
  const table = JSON.parse(read('scripts/data/college-scoring.json'));
  // Each season with a file of its own has its schools' matchup; the rest play at the built-in schools'.
  const folder = new URL('public/college-football/', root);
  const files = existsSync(folder) ? readdirSync(folder).filter(name => /^cfb-\d{4}\.json$/.test(name)).sort().map(name => name.slice(0, -5)) : [];
  assert.deepEqual(Object.keys(table.matchups), ['built-in', ...files]);
  assert.deepEqual(Object.keys(COLLEGE_SEASON_MATCHUPS), ['built-in', ...files]);
  assert.deepEqual(Object.keys(table.seasons).map(Number), YEARS);
  for (const [year, s] of Object.entries(table.seasons)) {
    // Every point: six a touchdown, its extra point or two-point try, three a field goal, two a safety.
    assert.equal(s.points, 6 * s.td + s.xpm + 2 * s.twoMade + 3 * s.fgm + 2 * s.safeties, year);
    assert.equal(s.td, s.xpa + s.twoAtt, `${year}: a try or a walk-off for every touchdown`);
    assert.ok(s.games / 2 >= 0.95 * s.fbs, `${year}: ${s.games / 2} of its ${s.fbs} games count`);
    assert.equal(s.games / 2 + s.left.drives + s.left.scoring + s.left.shootout, s.fbs, year);
    assert.ok(s.otTd < 0.02 * s.td && s.otFga < 0.03 * s.fga, `${year}: overtime is a small part`);
    assert.equal(!!s.unrecorded, Number(year) === 2011, `${year}: only 2011's box scores name no missed extra point`);
  }
  // 2024 and 2025 together, as docs/design/college-football.md quotes cfbstats.com's national team tables.
  const sum = totals(COLLEGE_REFERENCE_SEASONS);
  const raw = COLLEGE_REFERENCE_SEASONS.reduce((s, year) => ({ two: s.two + table.seasons[year].twoAtt, made: s.made + table.seasons[year].twoMade }),
    { two: 0, made: 0 });
  assert.ok(Math.abs(perGame(sum, 'points') - 26.5) < 0.1, `${perGame(sum, 'points')} points a team-game`);
  assert.ok(Math.abs(perGame(sum, 'td') - 3.27) < 0.02);
  assert.ok(Math.abs(perGame(sum, 'fga') - 1.59) < 0.01);
  assert.ok(Math.abs(sum.fgm / sum.fga - 0.761) < 0.003);
  assert.ok(Math.abs(perGame(sum, 'safeties') - 0.030) < 0.005);
  // ESPN's box scores name fewer missed extra points (98.6% made, cfbstats 98.3%), and a walk-off touchdown counts as a
  // failed two-point try (8.6% of touchdowns, 42.6% made; cfbstats 8.3%, 46.1%).
  assert.ok(sum.xpm / sum.xpa > 0.983 && sum.xpm / sum.xpa < 0.987);
  assert.ok(Math.abs(raw.two / sum.td - 0.083) < 0.006 && raw.made / raw.two < 0.461);
});

// ---------- the scores ----------

/**
 * Mean points a side and touchdowns, overtime included as the league's figures are, over pairings of `teams` across their
 * whole range (each school against every fourth other, the schools strongest first), four draws each: about 19,000 games.
 */
function scoring(sport, teams, seed = 7) {
  const rng = makeRng(seed);
  let points = 0, touchdowns = 0, sides = 0;
  teams.forEach((attacker, i) => {
    for (let j = (i + 1) % 4; j < teams.length; j += 4) {
      if (j === i) continue;
      const prepared = sport.prepareMatch(attacker, teams[j]);
      for (let k = 0; k < 4; k++) {
        const result = sport.sampleResult(rng, prepared, 6);
        points += result.ga + result.gd;
        touchdowns += result.plays.filter(play => play.pts >= 6).length;
        sides += 2;
      }
    }
  });
  return { points: points / sides, touchdowns: touchdowns / sides };
}

test('every season scores like its league, against today\'s: 26.1 points a team-game in 2009, 29.0 in 2016', () => {
  const today = scoring(collegeFootball, builtIn);
  const reference = totals(COLLEGE_REFERENCE_SEASONS);
  const misses = [];
  for (const year of YEARS) {
    const figures = COLLEGE_LEAGUE_AVERAGES[year];
    const want = today.points * perGame(figures, 'points') / perGame(reference, 'points');
    const got = scoring(sportOf(year), schoolsOf(year));
    // A season's schools score as far from today's as its league did from 2024 and 2025's, across their pairings (its
    // own schools where it has a file: their spread allowed for), within about a third of a point
    // (docs/design/college-football.md, "Rules by era").
    if (Math.abs(got.points - want) >= 0.6) misses.push(`${year}: ${got.points.toFixed(2)} points against ${want.toFixed(2)}`);
    const wantTd = today.touchdowns * perGame(figures, 'td') / perGame(reference, 'td');
    if (Math.abs(got.touchdowns / wantTd - 1) >= 0.03) misses.push(`${year}: ${got.touchdowns.toFixed(3)} touchdowns against ${wantTd.toFixed(3)}`);
  }
  assert.deepEqual(misses, []);
});

/** Every overtime of `games` score-only games between twins under `sport`: each period's plays. */
function overtimes(sport, games, seed) {
  const prepared = twins(sport), rng = makeRng(seed), out = [];
  for (let i = 0; i < games; i++) {
    const { plays, tie } = sport.sampleResult(rng, prepared, 6);
    if (tie) out.push(tie.periods.map((_, k) => plays.filter(play => play.period === k + 1)));
  }
  return out;
}

test('college overtime by era: possessions and two-point tries from the third period to 2020, two-point plays from the fifth in 2019 and 2020', () => {
  for (const [year, twoFrom, playsFrom] of [[2013, 3, null], [2019, 3, 5], [2024, 2, 3]]) {
    const sport = sportOf(year), maxOt = COLLEGE_RULES.maxOvertimes;
    const seen = { forced: 0, kicked: 0, plays: 0, longest: 0 };
    for (const periods of overtimes(sport, 120000, year)) {
      seen.longest = Math.max(seen.longest, periods.length);
      periods.forEach((plays, k) => {
        const period = k + 1, decisive = period === maxOt && plays.length === 3;
        if (playsFrom !== null && period >= playsFrom) {
          assert.ok(plays.every(play => play.kind === 'two' && (play.pts === 0 || play.pts === 2)), `${year}: period ${period}'s two-point plays`);
          assert.ok(plays.length === 2 || decisive);
          seen.plays++;
          return;
        }
        // A period of possessions, a possession each, its touchdowns kicked or, from the rules' period, gone for two.
        const possessions = decisive ? plays.slice(0, 2) : plays;
        assert.equal(possessions.length, 2, `${year}: a possession each in period ${period}`);
        assert.ok(possessions.every(play => !play.kind), `${year}: no two-point plays in period ${period}`);
        const [opening] = possessions;
        if (opening.pts >= 6) {
          assert.equal(opening.conversion, period >= twoFrom ? 'two' : 'kick', `${year}: period ${period}'s try`);
          if (period >= twoFrom) seen.forced++; else seen.kicked++;
        }
        if (decisive) assert.equal(plays[2].kind, 'two', 'the decisive play after the last period');
      });
    }
    assert.ok(seen.forced > 50 && seen.kicked > 100, `${year}: ${seen.kicked} kicked, ${seen.forced} gone for two`);
    if (playsFrom === null) assert.equal(seen.plays, 0, `${year}: no two-point plays before 2019`);
    else assert.ok(seen.plays > 20, `${year}: ${seen.plays} rounds of two-point plays`);
    assert.ok(seen.longest >= 5, `${year}: some overtimes reach the fifth period`);
  }
});

test('the clock, the ticker and the setup read the season\'s rules', () => {
  const sport = sportOf(2013);
  assert.deepEqual(sport.formatEvent({ m: 79, pts: 8, name: 'Jameis Winston' }, 'FSU'), { when: '5OT', text: 'TD — Jameis Winston (FSU)' });
  assert.equal(overtimeShort(sport, 3), '3OT');
  assert.equal(overtimeText(sport, 2), 'after 2 overtime periods');
  const setup = { layer: 'clubs', clubScope: 'domestic:cfb', finale: 'single' };
  assert.deepEqual(campaignPreview(28, { ...collegeFootball, dataSet: 'cfb-2013', dataYear: 2013, dataSeason: '2013' }, setup),
    campaignPreview(28, collegeFootball, setup));
});

// ---------- the live chart ----------

test('the live chart follows each season\'s overtime: exact chains, two-point tries and plays by era', () => {
  for (const [year, twoFrom, playsFrom] of [[2013, 3, null], [2019, 3, 5], [2023, 2, 3]]) {
    const sport = sportOf(year);
    const [x, y] = [builtIn[40], builtIn[47]];
    const model = liveModelFor(sport, x, y, undefined, undefined, 0);
    assert.ok(isLiveModel(model), `${year}`);
    assert.deepEqual([model.kind, model.overtime, model.maxOt, model.ot, model.drives], ['drives', 'college', 8, 4, sport.prepareMatch(x, y).drives]);
    // Today's overtime adds nothing to the model; an earlier one names its periods.
    assert.deepEqual([model.twoFrom, model.playsFrom], playsFrom === 3 ? [undefined, undefined] : [twoFrom, playsFrom]);
    // The chain is exact for the simulation's overtime, before form (Predictable).
    const prepared = sport.prepareMatch(x, y), rng = makeRng(78);
    let overtimeGames = 0, attackerWins = 0;
    for (let i = 0; i < 120000; i++) {
      const result = sport.sampleResult(rng, prepared, 0);
      if (!result.tie) continue;
      overtimeGames++;
      if (result.ga > result.gd) attackerWins++;
    }
    const exact = model.otChain[8], simulated = attackerWins / overtimeGames;
    assert.ok(overtimeGames > 5000);
    assert.ok(Math.abs(simulated - exact) < 3.5 * Math.sqrt(exact * (1 - exact) / overtimeGames), `${year}: chain ${exact} v ${simulated} over ${overtimeGames}`);
    assert.equal(winProbabilityAt(model, 60, 0), model.otChain[8]);
    // At kickoff the chart is the fixture's odds, under the season's rules.
    for (const [i, j] of [[0, 137], [60, 61], [100, 30]]) {
      const live = liveModelFor(sport, builtIn[i], builtIn[j], undefined, undefined, 6);
      const odds = estimateWinProbability({ sport, attacker: builtIn[i], defender: builtIn[j], preset: 'balanced', samples: 8000 }).attacker;
      assert.ok(Math.abs(winProbabilityAt(live, 0, 0) - odds) < 0.03, `${year} kickoff ${winProbabilityAt(live, 0, 0)} v odds ${odds}`);
    }
    // The third period (minutes 68–72): a possession each, the touchdown gone for two, before 2021; two-point plays since.
    const next = model.otChain[8 - 2 - 1];
    if (playsFrom === 3) {
      assert.ok(Math.abs(winProbabilityAt(model, 70, 2) - (1 - model.twoD * (1 - next))) < 1e-12, 'a two-point play levels 2');
    } else {
      assert.ok(Math.abs(winProbabilityAt(model, 70, 2) - (1 - model.tdD - model.fgD)) < 1e-12, 'a possession answers 2');
      assert.ok(Math.abs(winProbabilityAt(model, 70, 8) - (1 - model.tdLateD * model.twoD * (1 - next))) < 1e-12, 'a touchdown and two level 8');
      assert.ok(Math.abs(winProbabilityAt(model, 70, 6) - (1 - model.tdLateD * (model.twoD + (1 - model.twoD) * (1 - next)))) < 1e-12);
    }
    // The second period: kicked before 2021 (a 7 levelled with the kick), gone for two since.
    const second = model.otChain[8 - 1 - 1];
    const tried = twoFrom <= 2 ? model.twoD : model.xpD;
    assert.ok(Math.abs(winProbabilityAt(model, 66, 6) - (1 - model.tdLateD * (tried + (1 - tried) * (1 - second)))) < 1e-12);
    // The fifth period (minutes 76–80): two-point plays in 2019 and 2020 (and since 2021), possessions before.
    const fifth = model.otChain[8 - 4 - 1];
    const answer = playsFrom !== null && playsFrom <= 5 ? 1 - model.twoD * (1 - fifth) : 1 - model.tdD - model.fgD;
    assert.ok(Math.abs(winProbabilityAt(model, 78, 2) - answer) < 1e-12, `${year}: a lead of 2 in the fifth period`);
    assert.deepEqual(chartDomain(model, 69).ticks, [0, 15, 30, 45, 60, 64, 68, 72], 'quarters, then each overtime');
    // A model read back from a save keeps its era's periods whole, or none.
    if (model.twoFrom !== undefined) {
      const { twoFrom: _two, ...withoutTwo } = model;
      for (const bad of [withoutTwo, { ...model, twoFrom: 0 }, { ...model, playsFrom: model.twoFrom }, { ...model, playsFrom: 'none' },
        { ...model, overtime: 'both' }]) assert.equal(isLiveModel(bad), false);
      assert.ok(isLiveModel(JSON.parse(JSON.stringify(model))), 'a saved model reads back');
    }
  }
});

// ---------- today's draws ----------

test('the built-in season and the NFL keep their draws: a rulebook naming today\'s overtime plays as one naming none', () => {
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  const named = { ...COLLEGE_RULES, otTwoFrom: 2, otPlaysFrom: 3 };
  const [a, d] = [builtIn[69], { ...builtIn[69], id: 'twin' }];
  const plain = prepareMatch(a, d, undefined, undefined, undefined, COLLEGE_RULES), explicit = prepareMatch(a, d, undefined, undefined, undefined, named);
  const draw = (prepared, seed) => { const rng = makeRng(seed); return Array.from({ length: 3000 }, () => sampleResult(rng, prepared, 6)); };
  assert.deepEqual(draw(explicit, 5), draw(plain, 5));
  // Digests taken before the seasons' rules came in: the built-in season's games, live charts and the NFL's games.
  const college = getSport('college-football');
  let rng = makeRng(20261118);
  const samples = [];
  for (let i = 0; i < 4000; i++) {
    const x = builtIn[i % 138], y = i % 3 === 0 ? { ...x, id: 'twin' } : builtIn[(i * 37 + 11) % 138];
    if (x === y) continue;
    samples.push(college.sampleResult(rng, college.prepareMatch(x, y, teamEff(x), teamEff(y), { home: i % 5 === 0 }), i % 13));
  }
  assert.equal(digest(samples), '87e39c3ed5cdfb95');
  rng = makeRng(77);
  const games = [];
  for (let i = 0; i < 1500; i++) {
    const x = builtIn[(i * 7) % 138], y = i % 2 ? { ...x, id: 'twin' } : builtIn[(i * 11 + 3) % 138];
    if (x === y) continue;
    games.push(college.simulate(rng, x, y, 6, teamEff(x), teamEff(y)));
  }
  assert.equal(digest(games), 'f08676613d24b47c');
  assert.equal(digest([[0, 137], [10, 20], [60, 61], [100, 30], [40, 47]].map(([i, j]) => liveModelFor(college, builtIn[i], builtIn[j], undefined, undefined, 6))),
    'e08dcf237eb06840');
  const nfl = getSport('american-football'), clubs = NFL_CLUBS.map(club => buildClub(club, nfl));
  rng = makeRng(5);
  const nflGames = [];
  for (let i = 0; i < 3000; i++) {
    const x = clubs[i % 32], y = i % 3 === 0 ? { ...x, id: 'twin' } : clubs[(i * 7 + 3) % 32];
    if (x === y) continue;
    nflGames.push(nfl.sampleResult(rng, nfl.prepareMatch(x, y, teamEff(x), teamEff(y)), 6));
  }
  assert.equal(digest(nflGames), 'dd971f2ca7d8d602');
  const season = matchSport({ sport: 'american-football', layer: 'clubs', dataSet: 'madden-2015', dataYear: 2015 });
  rng = makeRng(9);
  const seasonGames = [];
  for (let i = 0; i < 1500; i++) {
    const x = clubs[i % 32], y = i % 2 ? { ...x, id: 'twin' } : clubs[(i * 5 + 1) % 32];
    if (x === y) continue;
    seasonGames.push(season.simulate(rng, x, y, 6, teamEff(x), teamEff(y)));
  }
  assert.equal(digest(seasonGames), 'f29443a6700c284d');
  assert.equal(digest(liveModelFor(season, clubs[2], clubs[5], undefined, undefined, 6)), '1fe25fc0d56ecfab');
});
