// Ice hockey's rules by era (docs/design/hockey.md, "Rules by era"): every built-in season scores like its league
// (src/data/nhlLeagueAverages.js), settles level games by its day's overtime (the playoffs' twenty-minute periods before
// the shoot-out, then four on four and the shoot-out, three on three from 2015/16) at the shares its league or playoffs
// did, plays its day's late game, and shows it on the clock, the feed, the chart and the live win probability. The
// built-in season plays today's rules, untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLUBS } from '../src/data/clubs.hockey.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../src/data/hockeySeasons.js';
import { LATEST_NHL_SEASON, NHL_LEAGUE_AVERAGES } from '../src/data/nhlLeagueAverages.js';
import { buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { hockey, hockeyIn, hockeyWith, lateOf, overtimeOf, PERIOD_MODEL, shootoutOdds } from '../src/sports/hockey.js';
import { clockLabel, clockTick, matchSport, overtimeEnd, overtimePeriodsOf, overtimeShort, overtimeText } from '../src/sports/index.js';
import { buildFeedRows, scorersLine } from '../src/viewModels/match.js';
import {
  LAST_PLAYOFFS, PLAYOFF_ERAS, leagueGoals, leagueScoring, overtimeShares, parseOvertimePage, pinnedReader, seasonClubs,
} from './lib/nhl-league.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SEASONS = BUILT_IN_HOCKEY_SEASONS.slice().sort((a, b) => a.year - b.year);
const settingsOf = id => {
  const { year, season } = BUILT_IN_HOCKEY_SEASONS.find(entry => entry.id === id);
  return { sport: 'hockey', layer: 'clubs', dataSet: id, dataYear: year, dataSeason: season };
};
const OVERTIMES = JSON.parse(read('scripts/data/nhl-playoff-overtimes.json'));

// ---------- the rules of each season ----------

test('each season plays its own day\'s rules; the built-in season plays today\'s, the very same sport', () => {
  assert.equal(matchSport({ sport: 'hockey', layer: 'clubs' }), hockey);
  assert.equal(matchSport({ sport: 'hockey', layer: 'nations' }), hockey);
  assert.equal(hockeyIn({}), hockey);
  assert.equal(hockey.simulationVersion, 1);
  const eighties = matchSport(settingsOf('nhl-1982'));
  assert.notEqual(eighties, hockey);
  assert.equal(eighties, matchSport({ ...settingsOf('nhl-1982'), layer: 'nations' }), 'one rules object a season, clubs or nations');
  assert.deepEqual([eighties.id, eighties.simulationVersion, eighties.tieBreak, eighties.name], ['hockey', 2, 'overtime', 'Ice hockey']);
  // The playoffs' overtime before the shoot-out, four on four before it from 2005/06, three on three from 2015/16.
  const overtimeIn = year => overtimeOf(year, 3);
  for (const year of [1967, 1983, 1989]) assert.deepEqual([overtimeIn(year).minutes, overtimeIn(year).periods, overtimeIn(year).shootout], [20, 5, false], year);
  for (const year of [1990, 1999, 2004]) assert.deepEqual([overtimeIn(year).minutes, overtimeIn(year).shootout], [20, false], year);
  assert.ok(overtimeIn(1989).boost > overtimeIn(1990).boost, 'overtime got longer from the 1990 playoffs');
  for (const year of [2006, 2011, 2015]) assert.deepEqual([overtimeIn(year).minutes, overtimeIn(year).boost, overtimeIn(year).shootout], [5, 1.41, true], year);
  for (const year of [2016, 2026, null]) assert.equal(overtimeIn(year), overtimeOf(null), year);
  assert.equal(overtimeOf(null).boost, PERIOD_MODEL.OVERTIME_BOOST);
  // The playoffs' overtime kept its pace whatever a season scored: a four-goal season's boost is three quarters of a
  // three-goal season's, so its goals come as fast.
  assert.ok(Math.abs(overtimeOf(1982, 4).boost / overtimeOf(1982, 3).boost - 0.75) < 1e-12);
  // The late game: today's from the overtime loser's point (1999/2000), a lighter one before.
  assert.equal(lateOf(2000), lateOf(null));
  assert.equal(lateOf(1999), lateOf(1967));
  assert.notEqual(lateOf(1999), lateOf(null));
  const [before, today] = [lateOf(1999), lateOf(null)];
  assert.ok(before.level > today.level && before.level < 1 && before.trailing < today.trailing && before.emptyNet < today.emptyNet);
  // A season without league figures plays today's level under its day's overtime.
  const unknown = hockeyIn({ dataSet: 'nhl-1900', dataYear: 1900, dataSeason: '1899/00' });
  assert.equal(unknown.prepareMatch(...CLUBS.slice(0, 2).map(club => buildClub(club, hockey))).rules.scoring, 1);
});

test('the league\'s goals a club a game cover every built-in season, sourced to the season', () => {
  assert.deepEqual(Object.keys(NHL_LEAGUE_AVERAGES), SEASONS.map(entry => entry.season));
  assert.equal(LATEST_NHL_SEASON, '2025/26');
  for (const [season, { goals, scoring }] of Object.entries(NHL_LEAGUE_AVERAGES)) {
    assert.ok(goals >= 2.5 && goals <= 4.1, `${season}: ${goals}`);
    assert.ok(scoring > 0.7 && scoring < 1.4, `${season}: ${scoring}`);
  }
  // The landmarks: the 1980s' four goals, the dead puck, the shoot-out's first season, today.
  assert.deepEqual(['1981/82', '1985/86', '2003/04', '2005/06', '2025/26'].map(season => NHL_LEAGUE_AVERAGES[season].goals),
    [4.01, 3.97, 2.57, 3.03, 3.08]);
});

// Every built-in season's clubs over every pairing, under its own rules (a few thousand games a season).
const measured = SEASONS.map(entry => ({ ...entry,
  ...leagueScoring(matchSport(settingsOf(entry.id)), seasonClubs(root, entry.id), { games: 3000, seed: 'hockey-eras' }) }));
const pooled = (from, to, key) => {
  const chosen = measured.filter(entry => entry.year >= from && entry.year <= to);
  return chosen.reduce((sum, entry) => sum + entry[key], 0) / chosen.length;
};

test('every built-in season scores like its league: four goals a club in 1981/82, two and a half in 2003/04', () => {
  for (const entry of measured) {
    const league = NHL_LEAGUE_AVERAGES[entry.season].goals;
    assert.ok(Math.abs(entry.goals - league) < 0.06, `${entry.season}: ${entry.goals.toFixed(3)} against the league's ${league}`);
  }
  // The built-in season plays today's level, the latest full season's within a few hundredths.
  const today = leagueScoring(hockey, CLUBS.map(club => buildClub(club, hockey)), { games: 3000, seed: 'hockey-eras' });
  assert.ok(Math.abs(today.goals - NHL_LEAGUE_AVERAGES[LATEST_NHL_SEASON].goals) < 0.08, `today: ${today.goals}`);
});

test('level games are settled as each era\'s league or playoffs settled them', () => {
  // Before the shoot-out, the share settled in the first twenty minutes is the playoffs' of the day.
  for (const { seasons: [from, to], playoffs } of PLAYOFF_ERAS) {
    const real = overtimeShares(OVERTIMES.games, ...playoffs).share;
    const model = pooled(from, to, 'firstPeriod');
    assert.ok(Math.abs(model - real) < 0.03, `${from}–${to}: ${(model * 100).toFixed(1)}% in the first period, the playoffs' ${(real * 100).toFixed(1)}%`);
    assert.equal(pooled(from, to, 'shootouts'), 0, 'no shoot-out before 2005/06');
  }
  // Until 1982/83 a level game was a tie: 1,817 of 10,826 (16.8%).
  const level = pooled(1967, 1983, 'level');
  assert.ok(Math.abs(level - 0.168) < 0.015, `level after sixty to 1982/83: ${level}`);
  // Four on four: 45.2% settled before the shoot-out, 13.4% of games to one, as in 2005/06–2014/15.
  const fourOnFour = pooled(2006, 2015, 'inOvertime');
  assert.ok(Math.abs(fourOnFour - 0.452) < 0.03, `four on four: ${fourOnFour}`);
  assert.ok(Math.abs(pooled(2006, 2015, 'shootouts') - 0.134) < 0.02);
  // Three on three: the league's 61–72% a season since 2015/16.
  const threeOnThree = pooled(2016, 2026, 'inOvertime');
  assert.ok(threeOnThree > 0.61 && threeOnThree < 0.72, `three on three: ${threeOnThree}`);
  // A level game always ends: the playoffs' periods run four or five deep now and then, never further.
  assert.ok(measured.filter(entry => entry.year <= 2004).some(entry => entry.longest >= 4));
  assert.ok(measured.every(entry => entry.longest <= (entry.year <= 2004 ? 5 : 2)));
});

test('the playoff overtimes are NHL.com\'s lists, read to 2009', () => {
  assert.equal(OVERTIMES.sources.length, 5);
  assert.ok(OVERTIMES.sources.every(source => /^https:\/\/web\.archive\.org\/web\/2012\d+\/http:\/\/www\.nhl\.com\//.test(source.url)
    && /^[0-9a-f]{64}$/.test(source.sha256)));
  assert.equal(OVERTIMES.games.length, OVERTIMES.sources.reduce((sum, source) => sum + source.games, 0));
  assert.ok(OVERTIMES.games.every(([date, length]) => /^(19[6-9]\d|200\d)-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) <= LAST_PLAYOFFS
    && /^\d{1,3}:\d{2}$/.test(length)));
  // The counts src/sports/hockey.js cites.
  assert.deepEqual(PLAYOFF_ERAS.map(({ playoffs }) => { const { games, firstPeriod } = overtimeShares(OVERTIMES.games, ...playoffs); return [games, firstPeriod]; }),
    [[196, 176], [276, 210]]);
  // The longest: Keith Primeau's goal of 4 May 2000, in the fifth overtime.
  assert.deepEqual(OVERTIMES.games.find(([date]) => date === '2000-05-04'), ['2000-05-04', '92:01']);
  // A row the page writes h:mm:ss (2010) is past the last playoffs read.
  const row = date => `<tr><td>${date}</td><td>SJ</td><td>CQF</td><td>Col</td><td>1</td><td>SJ</td><td>0</td><td>Scorer</td><td>0:51:00</td><td>SJ</td></tr>`;
  assert.deepEqual(parseOvertimePage(row('18-Apr-10')), []);
  assert.throws(() => parseOvertimePage(row('18-Apr-09')), /lasts "0:51:00"/);
});

const cachedGoals = existsSync(new URL('../data-src/nhl-seasons/hockey-databank/Teams.csv', import.meta.url));
test('the league\'s goals recompute from the pinned downloads', { skip: !cachedGoals && 'the downloads (data-src/nhl-seasons/) are not on this computer' }, () => {
  const recomputed = leagueGoals(pinnedReader(root), SEASONS.map(({ year, season }) => ({ year, season })));
  assert.ok(recomputed, 'every download is there');
  for (const [season, { goals }] of Object.entries(NHL_LEAGUE_AVERAGES)) assert.equal(recomputed[season].goals, goals, season);
  assert.equal(recomputed['1981/82'].source, 'hockey-databank');
  assert.equal(recomputed['2021/22'].source, 'moneypuck-summary');
  assert.equal(recomputed['2025/26'].source, 'moneypuck-games');
});

const cachedPages = existsSync(new URL('../data-src/nhl-overtimes/1990-99.html', import.meta.url));
test('the playoff overtimes recompute from NHL.com\'s pages', { skip: !cachedPages && 'the pages (data-src/nhl-overtimes/) are not on this computer' }, () => {
  const games = OVERTIMES.sources.flatMap(source => parseOvertimePage(read(`data-src/nhl-overtimes/${source.decade}.html`)));
  assert.deepEqual(games, OVERTIMES.games);
});

// ---------- the playoffs' periods ----------

const eighties = matchSport(settingsOf('nhl-1982'));
const eightiesClubs = seasonClubs(root, 'nhl-1982');

test('the playoffs\' overtime: a winner every game, the deciding goal in its period, nothing after it', () => {
  const rng = makeRng(19820401);
  const periods = new Map();
  for (let i = 0; i < 4000; i++) {
    const a = eightiesClubs[i % 21], d = eightiesClubs[(i * 5 + 2) % 21];
    if (a === d) continue;
    const result = eighties.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.notEqual(result.ga, result.gd);
    const sum = id => result.ev.filter(e => e.tid === id).length;
    assert.deepEqual([sum(a.id), sum(d.id)], [result.ga, result.gd], 'the feed adds up');
    if (!result.tie) { assert.ok(result.ev.every(e => e.m <= 60)); continue; }
    const k = result.tie.periods.length;
    periods.set(k, (periods.get(k) || 0) + 1);
    assert.deepEqual(result.tie.periods.slice(0, -1), Array(k - 1).fill([0, 0]), 'goalless periods before it');
    assert.equal(result.tie.periods.at(-1)[0] + result.tie.periods.at(-1)[1], 1);
    const late = result.ev.filter(e => e.m > 60);
    assert.equal(late.length, 1, 'the deciding goal only');
    assert.ok(late[0].m > 60 + 20 * (k - 1) && late[0].m <= 60 + 20 * k, `in overtime period ${k}: ${late[0].m}'`);
    assert.equal(late[0].tid, result.winner);
    assert.equal(Math.abs(result.ga - result.gd), 1);
  }
  assert.ok(periods.get(1) > 5 * (periods.get(2) || 0) && periods.get(2) > 0, JSON.stringify([...periods]));
});

test('the fifth overtime always ends in a goal, and either side can score it', () => {
  const [a, d] = eightiesClubs;
  const prepared = eighties.prepareMatch(a, d, teamEff(a), teamEff(d));
  for (const [side, value] of [['A', 0], ['D', 1 - 1e-12]]) {
    // Regulation's draws all 0 (no goal), every overtime period goalless until the fifth, whose side draw is `value`.
    let draws = 0;
    const rng = () => (draws++ < 42 + 5 ? 0 : value);
    const result = eighties.sampleResult(rng, prepared, 0);
    assert.deepEqual(result.tie.periods, [[0, 0], [0, 0], [0, 0], [0, 0], side === 'A' ? [1, 0] : [0, 1]]);
    assert.equal(result.winner, side === 'A' ? a.id : d.id);
    assert.ok(draws < 100, 'a stream that never scores still ends');
  }
});

test('the clock, the feed and the tie-break texts follow the playoffs\' periods; four on four reads like today', () => {
  assert.deepEqual([38, 60, 66, 87, 145].map(m => clockLabel(eighties, m)), ["38'", "60'", "66'", "87'", "145'"]);
  assert.deepEqual([20, 60, 80, 100, 120].map(t => clockTick(eighties, t)), ["20'", "60'", 'OT', '2OT', '3OT']);
  assert.deepEqual([1, 2, 3, 4, 5].map(n => overtimeText(eighties, n)),
    ['in overtime', 'in double overtime', 'in triple overtime', 'in quadruple overtime', 'in quintuple overtime']);
  assert.deepEqual([1, 2, 5].map(n => overtimeShort(eighties, n)), ['OT', '2OT', '5OT']);
  assert.deepEqual(['In overtime', 'In double overtime', 'in quintuple overtime', 'In a shoot-out', 'Final'].map(text => overtimePeriodsOf(eighties, text)),
    [1, 2, 5, 2, null]);
  assert.equal(overtimeEnd(eighties, 3), 0, 'the overtime ends at its goal');
  assert.deepEqual(eighties.clock, { length: 60, msPerUnit: hockey.clock.msPerUnit, ot: 20, sudden: true, tick: 20 });
  assert.deepEqual(eighties.formatEvent({ m: 87, pts: 1, name: 'Mike Bossy' }, 'NYI'), { when: "87'", text: 'GOAL — Mike Bossy (NYI)' });
  assert.equal(eighties.formatToast({ m: 87, name: 'Mike Bossy' }), "87' GOAL — MIKE BOSSY");
  // A goal in the second overtime is its scorer's, where today's 66th minute is a shoot-out's.
  const shown = [{ tid: 'i', m: 12, name: 'Mike Bossy', pts: 1 }, { tid: 'i', m: 87, name: 'Mike Bossy', pts: 1 }];
  assert.equal(scorersLine(shown, 'i', {}, eighties), 'Bossy 2 G');
  assert.equal(scorersLine([{ tid: 'i', m: 12, name: 'Mike Bossy', pts: 1 }, { tid: 'i', m: 66, name: 'Mike Bossy', pts: 1 }], 'i', {}, 'hockey'), 'Bossy 1 G');
  // The feed's status and overtime rows read the season's clock.
  const base = { sport: 'hockey', state: 'live', aCode: 'NYI', bCode: 'EDM', aName: 'New York Islanders', bName: 'Edmonton Oilers', aId: 'i', dId: 'e',
    length: 60, half: 0, finalMinute: 87, scoreA: 1, scoreB: 1, kickoff: 'Puck drop', endLabel: 'Final', overtime: true,
    events: [{ key: 'e0', m: 12, label: "12'", tid: 'i', pts: 1, text: 'GOAL — Mike Bossy (NYI)' }, { key: 'e1', m: 50, label: "50'", tid: 'e', pts: 1, text: 'GOAL — Wayne Gretzky (EDM)' }] };
  const rows = buildFeedRows({ feedBase: base, clockSport: eighties }, 87);
  assert.equal(rows[0].minute, "87'", 'the live minute in the second overtime');
  assert.match(rows[0].text, /^Live — NYI 1–1 EDM · overtime$/);
  assert.equal(buildFeedRows({ feedBase: base }, 87)[0].minute, 'SO', 'without the season, today\'s clock would read a shoot-out');
  // Four on four keeps today's clock, texts and shoot-out minute.
  const fourOnFour = matchSport(settingsOf('nhl-2011'));
  assert.deepEqual([clockLabel(fourOnFour, 66), clockTick(fourOnFour, 65), clockTick(fourOnFour, 70), overtimeText(fourOnFour, 2)], ['SO', 'OT', 'SO', 'in a shoot-out']);
  assert.deepEqual(fourOnFour.clock, hockey.clock);
  assert.equal(fourOnFour.overtime, hockey.overtime);
});

test('the live chart plays the season\'s overtime: the next goal wins, whenever it comes', () => {
  for (const [i, j] of [[0, 20], [4, 5], [12, 3]]) {
    const model = liveModelFor(eighties, eightiesClubs[i], eightiesClubs[j], undefined, undefined, 6);
    assert.ok(isLiveModel(model));
    assert.deepEqual([model.kind, model.length, model.ot, model.maxOt, model.playoff], ['periods', 60, 20, 5, true]);
    assert.equal(model.otBoost, overtimeOf(1982, NHL_LEAGUE_AVERAGES['1981/82'].goals).boost);
    assert.deepEqual(model.late, ['level', 'leading', 'trailing', 'pulled', 'emptyNet'].map(key => lateOf(1982)[key]));
    const odds = estimateWinProbability({ sport: eighties, attacker: eightiesClubs[i], defender: eightiesClubs[j], preset: 'balanced', samples: 12000 }).attacker;
    assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.02, `puck drop ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
    const level = winProbabilityAt(model, 60, 0);
    assert.ok(level > 0.2 && level < 0.8);
    for (const minute of [70, 80, 99, 140, 160]) assert.ok(Math.abs(winProbabilityAt(model, minute, 0) - level) < 1e-12, `${minute}'`);
    assert.deepEqual([winProbabilityAt(model, 87, 1), winProbabilityAt(model, 87, -1)], [1, 0]);
    assert.deepEqual(chartDomain(model, 30).ticks, [0, 20, 40, 60]);
    assert.deepEqual(chartDomain(model, 87).ticks, [0, 20, 40, 60, 80, 100], 'the second overtime');
    const series = winSeries({ model, goals: [{ m: 5, tid: 'a', pts: 1 }, { m: 40, tid: 'd', pts: 1 }, { m: 87, tid: 'a', pts: 1 }], aId: 'a', dId: 'd', minute: 87, final: { winnerSide: 'A' } });
    assert.deepEqual(series.at(-1), { t: 87, p: 1 }, 'the series ends at the deciding goal');
  }
  // Four on four: today's shape with its own overtime rate, the shoot-out after five minutes.
  const tens = seasonClubs(root, 'nhl-2011');
  const fourOnFour = liveModelFor(matchSport(settingsOf('nhl-2011')), tens[0], tens[1]);
  assert.deepEqual([fourOnFour.ot, fourOnFour.maxOt, fourOnFour.otBoost, fourOnFour.playoff, fourOnFour.late], [5, 2, 1.41, undefined, undefined]);
  assert.ok(Math.abs(winProbabilityAt(fourOnFour, 65, 0) - shootoutOdds(fourOnFour.shootout)) < 1e-9);
  // Today's model names none of an era's fields, so every model saved before reads as it did.
  const today = liveModelFor(hockey, buildClub(CLUBS[0], hockey), buildClub(CLUBS[1], hockey));
  assert.deepEqual(Object.keys(today), ['kind', 'rateA', 'rateD', 'shootout', 'formSd', 'length', 'ot', 'maxOt']);
  assert.equal(isLiveModel({ ...today, late: [1, 1, 1] }), false);
  assert.equal(isLiveModel({ ...today, playoff: 'yes' }), false);
});

test('a season\'s scoring scales its rates and nothing else; its overtime and late game ride on the match', () => {
  const [a, d] = eightiesClubs;
  const plain = hockeyWith({ season: '1981/82', scoring: 1, late: lateOf(null), overtime: overtimeOf(null) }).prepareMatch(a, d);
  const season = eighties.prepareMatch(a, d);
  const { scoring } = NHL_LEAGUE_AVERAGES['1981/82'];
  assert.ok(Math.abs(season.rateA / plain.rateA - scoring) < 1e-12 && Math.abs(season.rateD / plain.rateD - scoring) < 1e-12);
  assert.equal(season.shootout, plain.shootout);
  assert.deepEqual([season.rules.season, season.rules.late, season.rules.overtime.shootout], ['1981/82', lateOf(1982), false]);
  assert.equal(hockey.prepareMatch(a, d).rules.scoring, 1);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  WinChart: 'src/screens/match/WinChart.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the win chart ticks the playoffs\' overtimes', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = (await import('react')).default;
  const model = liveModelFor(eighties, eightiesClubs[0], eightiesClubs[1]);
  const html = renderToStaticMarkup(React.createElement(B.WinChart, { sport: 'hockey', clockSport: eighties, model, minuteFallback: 87, minuteFloor: 87 }));
  for (const tick of ["60&#x27;", 'OT', '2OT']) assert.ok(html.includes(`>${tick}<`), tick);
  assert.ok(!html.includes('>SO<'), 'no shoot-out');
});

test('a 1981/82 clubs campaign plays the playoffs\' overtime and shows it', async () => {
  const fetch = async url => {
    const [, folder, id] = String(url).match(/^\/(domestic|hockey)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder && read(`public/${folder}/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) } : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'hockey', layer: 'nations', scope: 'UEFA', clubScope: 'domestic:nhl', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, time } = f;
    app.pickSetup('sport', 'hockey');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nhl-1982');
    time.advance(200);
    await Promise.all([app.loadCountry(app.state.setup.clubScope.replace('domestic:', '')), app.loadSet('nhl-1982')]);
    await settle();
    app.startCampaign();
    assert.equal(app.state.phase, 'playing');
    // The App is its own bundle, with its own copy of the rules: the same rules, another object.
    const rules = app.sport();
    assert.deepEqual([rules.id, rules.simulationVersion, rules.clock, rules.overtime.text(2)], ['hockey', 2, eighties.clock, 'in double overtime'],
      'the campaign plays 1981/82\'s rules');
    assert.equal(rules, app.sport(), 'one rules object a season');
    let overtime = null;
    for (let steps = 0; !overtime?.entry && app.state.aliveIds.length > 1 && steps < 3000; steps++) {
      const st = app.state;
      if (st.match && !st.match.applied) {
        const level = !!st.match.tie;
        if (level) overtime = { match: st.match, live: app.liveMatchModel(), matches: st.history.length };
        app.finishMatch();
        if (level) overtime.entry = app.state.history[overtime.matches];
      } else if (st.spin) { app.lockDuel(st.spin.key); app.startMatch(st.spin.attackerId, st.spin.targetId, st.spin); }
      else app.nextAction();
    }
    app.clearTimers();
    assert.ok(overtime?.entry, 'a game went to overtime');
    const { match, live, entry } = overtime;
    const k = match.tie.periods.length;
    const goal = match.allEv.at(-1);
    assert.ok(goal.m > 60 + 20 * (k - 1) && goal.m <= 60 + 20 * k, `the deciding goal in overtime period ${k}: ${goal.m}'`);
    assert.deepEqual([match.live.kind, match.live.ot, match.live.maxOt, match.live.playoff], ['periods', 20, 5, true], 'the stored live model');
    assert.equal(live.clockSport, rules, 'the Match view reads the season\'s clock');
    assert.equal(live.ot, 20);
    assert.equal(entry.result.tieText, `In ${overtimeText(eighties, k).slice(3)}`, 'the result names the overtime');
    assert.ok(entry.events.length === match.allEv.length && entry.events.every(event => event.when !== 'SO'), 'no shoot-out in the ticker');
    assert.equal(entry.events.at(-1).when, `${goal.m}'`);
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
