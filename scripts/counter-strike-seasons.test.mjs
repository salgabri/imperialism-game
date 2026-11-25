// Counter-Strike's earlier seasons (docs/design/counter-strike.md, "Earlier seasons"): each year from 2001 to 2025 as the
// Elo of Liquipedia's results stood on its last day, 1.6's and Source's to 2012 and then Global Offensive's and
// Counter-Strike 2's, built from committed snapshots; nations only, each player under the nation his record gives him; each
// season in its own year's rounds, fitted to its real maps; the loader, the match model and its live chart, and the running
// App choosing, launching and resuming a season.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_COUNTER_STRIKE_SEASONS } from '../src/data/counterStrikeSeasons.js';
import { COUNTER_STRIKE_RULES } from '../src/data/counterStrikeRules.js';
import { HISTORIC_NATIONS, HOME_NATIONS, NATIONS, buildTeam, makeRng } from '../src/data/teams.js';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf,
} from '../src/engine/footballSets.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { parseCampaign } from '../src/engine/storage.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { isRuntimeCached } from '../src/pwa.js';
import { clockLabel, clockTick, matchSport } from '../src/sports/index.js';
import {
  clockOf, counterStrike, counterStrikeIn, mapChance, mapMeans, mapOdds, mapState, mapTable, roundUnit, RULES_TODAY, strengthFor,
} from '../src/sports/counterStrike.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { ACTIVE_DAYS, FIRST_GO_SEASON, MIN_GAMES, MIN_GAMES_OLDER, MIN_RECENT, gameRating } from './lib/counter-strike.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const seasonFile = year => JSON.parse(read(`public/counter-strike/cs-${year}.json`));
const snapshot = year => JSON.parse(read(`scripts/data/counter-strike-seasons/${year}.json`));
const squadNames = (doc, nation) => doc.nations[nation][2].map(([name]) => name);
const YEARS = Array.from({ length: 2025 - 2001 + 1 }, (_, i) => 2025 - i);
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;
const isOlder = year => year < FIRST_GO_SEASON;
const isRough = year => year < 2005 || year === FIRST_GO_SEASON;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, each a year\'s players as rated on its last day', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-counter-strike-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 25 Counter-Strike seasons, their listing, rounds, attribution and audit byte for byte/);
  for (const year of YEARS) {
    const data = snapshot(year);
    assert.deepEqual([data.season, data.date], [year, `${year}-12-31`]);
    assert.ok(data.to <= data.date && data.from === (isOlder(year) ? '2000-12-08' : '2012-09-21'), `${year}: ${data.from} to ${data.to}`);
    assert.equal(data.rated, data.players.length);
    assert.ok(data.players.every((row, i) => i === 0 || row[5] <= data.players[i - 1][5]), `${year} runs strongest first`);
    // Twenty maps behind him (ten in 1.6 and Source; what he brought from them counted in Global Offensive's first season),
    // and five of them in the year.
    assert.equal(data.minGames, isOlder(year) ? MIN_GAMES_OLDER : MIN_GAMES);
    const least = isOlder(year) ? MIN_GAMES_OLDER : year === FIRST_GO_SEASON ? MIN_RECENT : MIN_GAMES;
    assert.ok(data.players.every(row => row[6] >= least), `${year}: ${least} maps each`);
    assert.ok(data.players.every(row => row[8] <= data.date && days(row[8], data.date) <= ACTIVE_DAYS), `${year}: each played within the year`);
    assert.equal(new Set(data.players.map(row => row[0])).size, data.players.length, `${year}: no player listed twice`);
    assert.equal(data.play.bins.reduce((sum, [n]) => sum + n, 0), data.play.maps, `${year}: each real map in one odds bin`);
    assert.ok(data.play.bins.every(([n, ot, ...loser]) => n === ot + loser.reduce((sum, maps) => sum + maps, 0)), `${year}: an overtime or the loser's rounds`);
    // A player of 1.6's and Source's seasons says which game his rating is of.
    assert.ok(data.players.every(row => (isOlder(year) ? data.games.includes(row[11]) : row.length === 11)), String(year));
    assert.equal(data.carried > 0, year === FIRST_GO_SEASON, `${year}: ratings carried over`);
  }
  // The record begins in December 2000, with two events: five players rated, one nation, no season.
  assert.ok(!existsSync(new URL('./data/counter-strike-seasons/2000.json', import.meta.url)));
});

test('the built-in seasons run from 2025 back to 2001, 1.6\'s and Source\'s saying so, the first four and 2013 rough', () => {
  assert.deepEqual(BUILT_IN_COUNTER_STRIKE_SEASONS.map(set => set.id), YEARS.map(year => `cs-${year}`));
  assert.equal(builtInSeasonOf('counter-strike').season, '2026', 'the built-in season stays 2026\'s');
  const label = year => BUILT_IN_COUNTER_STRIKE_SEASONS.find(set => set.year === year).label;
  assert.equal(label(2025), 'Liquipedia Elo, end of 2025');
  assert.equal(label(2014), 'Liquipedia Elo, end of 2014');
  assert.equal(label(2013), 'Liquipedia Elo, end of 2013 (rough)');
  assert.equal(label(2012), 'Liquipedia Elo, end of 2012 (1.6 and Source)');
  assert.equal(label(2005), 'Liquipedia Elo, end of 2005 (1.6)');
  assert.equal(label(2004), 'Liquipedia Elo, end of 2004 (1.6, rough)');
  assert.equal(label(2001), 'Liquipedia Elo, end of 2001 (1.6, rough)');
  for (const listed of BUILT_IN_COUNTER_STRIKE_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'counter-strike');
    assert.ok(setHasNations(set.id) && !setHasClubs(set.id), 'nations only');
    assert.equal(seasonFile(set.year).version, listed.version);
    assert.ok(isRuntimeCached(`https://imperialism-game.vercel.app/counter-strike/${listed.id}.json`), 'kept for offline play once chosen');
  }
});

// ---------- the seasons ----------

test('every season decodes: five to seven players a nation, each his Elo of that day on the game\'s scale', () => {
  for (const year of YEARS) {
    const doc = seasonFile(year);
    const set = decodeFootballSet(doc, doc.id);
    assert.deepEqual([set.meta.year, set.meta.season, doc.clubs.length], [year, String(year), 0]);
    for (const [str, players, squad] of Object.values(doc.nations)) {
      assert.ok(squad.length >= 5 && squad.length <= 7 && players >= squad.length);
      assert.equal(str, Math.round(squad.slice(0, 5).reduce((sum, [, , rating]) => sum + rating, 0) / 5 * 10) / 10, 'its five best play');
      assert.equal(new Set(squad.map(([name]) => name)).size, squad.length, `${year}: a name of his own each`);
      for (const [, pos, rating, source] of squad) {
        assert.equal(pos, 'PLR');
        assert.equal(rating, gameRating(source.rawRating), `${year}: ${source.id} is his Elo on the game's scale`);
        assert.deepEqual([source.source, source.edition, source.snapshotDate, source.rawScale], ['liquipedia', 'Liquipedia Elo', `${year}-12-31`, 'Elo']);
        assert.ok(source.lastPlayed <= `${year}-12-31` && source.url.startsWith('https://liquipedia.net/counterstrike/'));
        assert.equal(isOlder(year), ['1.6', 'Source'].includes(source.game), `${year}: ${source.id}`);
      }
    }
    assert.ok(HOME_NATIONS.every(home => doc.territory.merged[home] === '826'), 'Great Britain plays as one');
    assert.equal(doc.coverage.nations, Object.keys(doc.nations).length);
    assert.deepEqual([doc.source.edition, doc.source.licence, doc.source.computed, !!doc.source.rough], ['Liquipedia Elo', 'CC BY-SA 3.0', true, isRough(year)]);
  }
  // The nations follow the record: nine at the end of 2001, twenty-seven by 2010, fifteen again in Global Offensive's first
  // full year, and about forty since 2017.
  assert.deepEqual(YEARS.map(year => seasonFile(year).coverage.nations),
    [37, 37, 40, 39, 41, 43, 42, 44, 41, 35, 27, 15, 15, 18, 22, 27, 22, 16, 18, 18, 15, 15, 15, 8, 9]);
});

test('each season is its day\'s: NiP\'s Sweden in 2001, mTw\'s Denmark in 2008, Na\'Vi\'s Ukraine in 2010, Astralis\'s Denmark in 2018', () => {
  const top = year => Object.entries(seasonFile(year).nations).sort((a, b) => b[1][0] - a[1][0]).map(([id]) => id);
  const names = (year, nation) => squadNames(seasonFile(year), nation);
  const has = (year, nation, players) => assert.ok(players.every(name => names(year, nation).includes(name)),
    `${year} ${nation}: ${players.join(', ')} in ${names(year, nation).join(', ')}`);
  has(2001, '752', ['HeatoN', 'Potti', 'Hyb', 'Medion']);
  has(2006, '616', ['NEO', 'TaZ', 'LUq', 'Loord', 'kuben']);
  has(2008, '208', ['ave', 'mJe', 'whimp', 'Sunde', 'zonic']);
  has(2008, '410', ['termi', 'ari', 'bail', 'hee', 'solo']);
  has(2010, '804', ['Zeus', 'Edward', 'starix', 'ceh9', 'markeloff']);
  has(2013, '752', ['f0rest', 'Xizt']);
  has(2014, '752', ['KRiMZ', 'olofmeister', 'JW', 'flusha', 'pronax']);
  has(2014, '616', ['pasha', 'Snax', 'byali', 'NEO', 'TaZ']);
  has(2016, '076', ['FalleN', 'fnx', 'coldzera', 'fer']);
  has(2018, '208', ['Xyp9x', 'gla1ve', 'dupreeh', 'Magisk']);
  has(2021, '643', ['nafany', 'sh1ro']);
  has(2024, '496', ['bLitz', 'Techno4K', '910', 'mzinho']);
  for (let year = 2001; year <= 2014; year++) assert.equal(top(year)[0], '752', `Sweden leads ${year}`);
  assert.deepEqual([2018, 2019].map(year => top(year)[0]), ['208', '208'], 'Denmark leads Astralis\'s two years');
  assert.deepEqual([2021, 2022, 2023, 2024, 2025].map(year => top(year)[0]), ['643', '643', '643', '643', '643'], 'Russia since 2021');
  assert.equal(names(2001, '752').length, 7);
  // 1.6's scene and Source's side by side: Sweden's of 2011 play 1.6, France's best Source (VeryGames).
  const games = (year, nation) => seasonFile(year).nations[nation][2].map(([name, , , source]) => [name, source.game]);
  assert.ok(games(2011, '752').slice(0, 5).every(([, game]) => game === '1.6'));
  assert.deepEqual(games(2011, '250').filter(([name]) => ['RpK', 'SmithZz', 'NBK'].includes(name)).map(([, game]) => game), ['Source', 'Source', 'Source']);
  // The wiki's renamed players are one: the Dane Device/Dev1ce, the Pole Pasha/PashaBiceps.
  for (const year of YEARS.filter(y => !isOlder(y))) {
    for (const nation of ['208', '616', '710'].filter(id => seasonFile(year).nations[id])) {
      const spelt = names(year, nation).map(name => name.toLowerCase().replace(/1/g, 'i').replace(/biceps$/, ''));
      assert.equal(new Set(spelt).size, spelt.length, `${year} ${nation}: ${names(year, nation).join(', ')}`);
    }
  }
  // Women's events count nowhere: their stars, rated on a circuit of their own, were in the squads of 2018 to 2020.
  for (const year of [2018, 2019, 2020]) {
    for (const [nation, player] of [['124', 'GooseBreeder'], ['752', 'zAAz'], ['840', 'refinnej'], ['840', 'Emy']]) {
      assert.ok(!names(year, nation).includes(player), `${year}: ${player}`);
    }
  }
  // Nor do the long retired: Zeus and Skadoodle turned out for a map in 2021.
  assert.ok(!names(2021, '804').includes('Zeus') && !names(2021, '840').includes('Skadoodle'));
});

test('each season\'s regions are placed by its own maps, Global Offensive\'s first starting from the older games', () => {
  for (const year of YEARS) {
    const { starts, games } = snapshot(year);
    assert.deepEqual(Object.keys(starts), games);
    for (const levels of Object.values(starts)) assert.equal(levels.EU, 1500, `${year}: Europe's level anchors it`);
    assert.match(seasonFile(year).source.conversion, new RegExp(`region's level as the maps to ${year}-12-31 measure it`));
    assert.equal(/as he stood above it in 1\.6 or Source/.test(seasonFile(year).source.method), year === FIRST_GO_SEASON);
  }
  assert.deepEqual(snapshot(2005).games, ['1.6']);
  assert.deepEqual(snapshot(2006).games, ['1.6', 'Source']);
  assert.deepEqual(snapshot(2013).games, ['Global Offensive']);
  assert.ok(snapshot(2013).carried > 150, 'most of 2013\'s rated came from 1.6 or Source');
});

// ---------- the rounds of each season ----------

test('each season plays its year\'s rounds: the format most of its maps had, its momentum fitted to them', () => {
  const audit = JSON.parse(read('docs/design/counter-strike-seasons-audit.json'));
  assert.deepEqual(Object.keys(COUNTER_STRIKE_RULES).map(Number).sort(), YEARS.slice().sort());
  for (const row of audit.seasons) {
    const year = Number(row.id.slice(3)), rules = COUNTER_STRIKE_RULES[year];
    // First to 13 in 1.6's early years and since Counter-Strike 2; first to 16 from 2005 to 2023.
    assert.equal(rules.half, year >= 2005 && year <= 2023 ? 15 : 12, `${year}: first to ${rules.half + 1}`);
    assert.deepEqual([rules.half, rules.momentum], [row.half, row.momentum]);
    assert.ok(rules.momentum > 0.5 && rules.momentum < 1, `${year}: a momentum of ${rules.momentum}`);
    const [most] = Object.entries(row.formats).sort((a, b) => b[1] - a[1])[0];
    assert.equal(most, rules.half === 12 ? 'mr12' : 'mr15', `${year}: ${JSON.stringify(row.formats)}`);
    if (row.real.maps < 300) continue;
    // At its real maps' own odds the model plays them as they went: within three quarters of a round (a third from 2013 on)
    // and five points of the overtimes (four).
    assert.ok(Math.abs(row.model.rounds - row.real.rounds) < (isOlder(year) ? 0.75 : 0.35), `${year}: ${row.model.rounds} rounds where ${row.real.rounds} were played`);
    assert.ok(Math.abs(row.model.overtime - row.real.overtime) < (isOlder(year) ? 0.05 : 0.04), `${year}: ${row.model.overtime} to overtime where ${row.real.overtime} went`);
  }
  // 1.6's and Source's years share one; a round's pull on the next was strongest in CS:GO's mid-2010s and fell with the
  // economy of 2019, close to today's by 2022.
  assert.equal(new Set(YEARS.filter(isOlder).map(year => COUNTER_STRIKE_RULES[year].momentum)).size, 1);
  const momentum = year => COUNTER_STRIKE_RULES[year].momentum;
  assert.ok([2014, 2015, 2016, 2017, 2018].every(year => momentum(year) > 0.85) && momentum(2019) < 0.75);
  assert.ok([2022, 2023, 2024, 2025].every(year => Math.abs(momentum(year) - RULES_TODAY.momentum) < 0.04));
});

test('a map of MR15 runs to 16, level at 15–15 to overtime; its winner is Elo\'s at any rounds', () => {
  const play = sides => mapState([...sides], 15);
  assert.equal(play('A'.repeat(16)).over, 'A');
  assert.equal(play('A'.repeat(15)).over, null, '15 is not enough');
  assert.equal(play('A'.repeat(14) + 'D').last, null, 'half-time after fifteen: the next round is a pistol round');
  const level = 'AD'.repeat(15);
  assert.deepEqual(play(level), { a: 15, d: 15, overtime: true, x: 0, y: 0, last: null, over: null });
  assert.equal(play(`${level}AAAA`).over, 'A', '19–15');
  for (const odds of [0.35, 0.5, 0.62, 0.8]) {
    assert.ok(Math.abs(mapTable(strengthFor(odds, 0.95, 15), 0.95, 15).start - odds) < 1e-8, `odds ${odds}`);
  }
  const means = mapMeans(0.6, 0.95, 15);
  assert.equal(means.loser.length, 15);
  assert.ok(Math.abs(means.loser.reduce((sum, x) => sum + x, 0) + means.overtime - 1) < 1e-9, 'every map ends');
  assert.ok(means.rounds > 25 && means.rounds < 27);
  assert.deepEqual([clockOf(), clockOf(15)], [{ regulation: 24, block: 26, length: 52 }, { regulation: 30, block: 32, length: 64 }]);
  assert.deepEqual([1, 30, 31, 33, 34, 50].map(n => roundUnit(n, 15)), [1, 30, 31, 31, 32, 32]);
});

test('a season plays its rounds; the same draws win the same maps as today, so its odds are Elo\'s', () => {
  const settings = { sport: 'counter-strike', layer: 'nations', dataSet: 'cs-2015', dataYear: 2015 };
  const then = matchSport(settings);
  assert.equal(then, counterStrikeIn(settings));
  assert.deepEqual(then.rules, { year: 2015, ...COUNTER_STRIKE_RULES[2015] });
  assert.equal(matchSport({ sport: 'counter-strike', layer: 'nations' }), counterStrike, 'the built-in season plays today\'s');
  assert.equal(matchSport({ ...settings, dataYear: 1999 }), counterStrike, 'a year the table lacks plays today\'s');
  assert.deepEqual(then.clock, { length: 64, msPerUnit: counterStrike.clock.msPerUnit, ot: 32, tick: 32 });
  assert.match(then.blurb, /First to 16 rounds takes a map; 15–15 goes to overtime/);
  assert.match(counterStrike.blurb, /First to 13 rounds takes a map; 12–12 goes to overtime/);
  assert.deepEqual([clockLabel(then, 32), clockLabel(then, 33), clockLabel(then, 96), clockTick(then, 64)], ['M1', 'M2', 'M3', 'M2']);
  const set = decodeFootballSet(seasonFile(2015), 'cs-2015');
  const bound = seasonSport(set);
  const sweden = buildTeam('752', makeRng(1), bound), brazil = buildTeam('076', makeRng(2), bound);
  let overtimes = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const played = then.simulate(makeRng(seed), sweden, brazil, 6), today = counterStrike.simulate(makeRng(seed), sweden, brazil, 6);
    assert.deepEqual([played.ga, played.gd, played.winner], [today.ga, today.gd, today.winner], 'the same draws decide the same maps');
    for (const end of played.ev.filter(e => e.pts > 0)) {
      const rounds = played.ev.filter(e => e.pts === 0 && e.map === end.map);
      const [w, l] = end.score.split('–').map(Number);
      assert.ok(rounds.length <= 30 ? w === 16 && l <= 14 : w >= 19 && w - l >= 2 && w - l <= 4, `${end.score} in ${rounds.length}`);
      assert.equal(!!end.ot, rounds.length > 30);
      if (end.ot) overtimes++;
      const start = (end.map - 1) * 32;
      rounds.forEach((e, i) => assert.equal(e.m, start + roundUnit(i + 1, 15)));
      assert.ok(rounds.every(e => e.m > start && e.m <= start + 32), 'inside its map\'s block');
    }
  }
  assert.ok(overtimes > 5, 'some go to overtime');
  const odds = sport => estimateWinProbability({ sport, attacker: sweden, defender: brazil, samples: 20000 }).attacker;
  assert.ok(Math.abs(odds(then) - odds(counterStrike)) < 0.012, 'the series odds are today\'s');
});

test('the live chart plays the season\'s rounds: it names them, follows them and ends on the winner', () => {
  const then = matchSport({ sport: 'counter-strike', layer: 'nations', dataSet: 'cs-2015', dataYear: 2015 });
  const set = decodeFootballSet(seasonFile(2015), 'cs-2015');
  const bound = seasonSport(set);
  const A = buildTeam('752', makeRng(1), bound), D = buildTeam('250', makeRng(2), bound);
  const live = liveModelFor(then, A, D, undefined, undefined, 6), today = liveModelFor(counterStrike, A, D, undefined, undefined, 6);
  assert.deepEqual([live.kind, live.length, live.ot, live.half, live.momentum], ['maps', 64, 32, 15, COUNTER_STRIKE_RULES[2015].momentum]);
  assert.deepEqual([today.length, today.ot, today.half, today.momentum], [52, 26, undefined, undefined], 'today\'s names none');
  assert.ok(isLiveModel(live) && isLiveModel(today));
  assert.ok(!isLiveModel({ ...live, half: 0 }) && !isLiveModel({ ...live, momentum: -1 }) && !isLiveModel({ ...live, kind: 'rounds' }));
  assert.ok(Math.abs(winProbabilityAt(live, 0, 0) - winProbabilityAt(today, 0, 0)) < 1e-6, 'before a round, the odds are Elo\'s at any rounds');
  assert.deepEqual(chartDomain(live, 70).ticks, [0, 32, 64, 96]);
  for (let seed = 1; seed <= 20; seed++) {
    const result = then.simulate(makeRng(seed), A, D, 6);
    const end = Math.max(...result.ev.map(e => e.m));
    const series = winSeries({ model: live, goals: result.ev, aId: A.id, dId: D.id, minute: end, final: { winnerId: result.winner } });
    assert.equal(series.at(-1).p, result.winner === A.id ? 1 : 0);
  }
  // With no match-day form the chart is the model's own chance: 14–13 up in the first map, the last round won.
  const flat = liveModelFor(then, A, D, undefined, undefined, 0);
  const odds = mapOdds(flat.gap), table = mapTable(strengthFor(odds, flat.momentum, 15), flat.momentum, 15);
  const rounds = [...'ADADADADADADADA', ...'DADADADADADA'];
  const state = mapState(rounds, 15);
  assert.deepEqual([state.a, state.d, state.over], [14, 13, null]);
  const goals = rounds.map((side, i) => ({ m: roundUnit(i + 1, 15), tid: side === 'A' ? A.id : D.id, pts: 0 }));
  const chart = winSeries({ model: flat, goals, aId: A.id, dId: D.id, minute: rounds.length }).at(-1).p;
  const q = mapChance(table, state), win2 = 1 - (1 - odds) ** 2, lose1 = odds * odds;
  assert.ok(Math.abs(chart - (q * win2 + (1 - q) * lose1)) < 1e-9, `${chart}`);
});

// ---------- the loader ----------

test('the loader refuses a Counter-Strike season that is not the builder\'s', () => {
  const doc = seasonFile(2015);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.season = '2014/15'; }), /season "2014\/15" must be "2015"/);
  assert.throws(broken(d => { d.nations['752'][2] = d.nations['752'][2].slice(0, 4); }), /five to seven players/);
  assert.throws(broken(d => { d.nations['752'][2][1][1] = 'SGL'; }), /position must be PLR/);
  assert.throws(broken(d => { d.nations['752'][2].reverse(); }), /strongest first/);
  assert.throws(broken(d => { d.clubs = [{}]; }), /a Counter-Strike season has nations only/);
  assert.throws(broken(d => { delete d.territory.merged.SCO; }), /home nations in the United Kingdom, as Great Britain plays as one/);
  assert.throws(broken(d => { d.territory.inactive.pop(); }), /every nation the season neither lists nor merges/);
  assert.throws(broken(d => { d.kind = 'val'; }), /kind "val" is not the kind its id names/);
});

test('a season binds Counter-Strike to its nations; every other nation\'s land stays neutral', () => {
  const set = decodeFootballSet(seasonFile(2008), 'cs-2008');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.nationsOnly], ['counter-strike', 'cs-2008', '2008', true]);
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(set.rosters).sort());
  const team = buildTeam('208', makeRng(2008), sport);
  assert.deepEqual(team.squad.map(player => player.name), squadNames(seasonFile(2008), '208'));
  assert.equal(buildTeam('826', makeRng(1), sport).name, 'Great Britain');
  // Every season of the day plays the names of its day: Macedonia to 2018 (src/data/namesOfTheDay.js).
  assert.equal(buildTeam('807', makeRng(1), seasonSport(decodeFootballSet(seasonFile(2011), 'cs-2011'))).name, 'Macedonia');
  assert.equal(sportOf({ sport: 'counter-strike', layer: 'nations', dataSet: 'cs-2008' }), null, 'until it has loaded');
  assert.equal(Object.keys(NATIONS).length - HISTORIC_NATIONS.length, set.territory.inactive.length + Object.keys(set.territory.merged).length + fielded.length);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// Sweden, France, Denmark, Poland, Brazil and the United States.
async function withApp(fn, ids = ['752', '250', '208', '616', '076', '840']) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, id] = String(url).match(/^\/counter-strike\/(cs-\d{4})\.json$/) || [];
    let text = null;
    try { text = id && read(`public/counter-strike/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'counter-strike', layer: 'nations', scope: 'world', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('Counter-Strike\'s Season choice lists 2026 and the twenty-five earlier seasons, newest first', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'counter-strike');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...YEARS.map(String)]);
    assert.equal(model.season.options[1].label, '2025 · Liquipedia Elo, end of 2025');
    assert.equal(model.season.options.at(-1).label, '2001 · Liquipedia Elo, end of 2001 (1.6, rough)');
    assert.match(model.season.note, /at the end of each year from 2001/);
    app.pickSetup('dataSet', 'cs-2008');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'cs-2008']);
    time.advance(200);
    await app.loadSet('cs-2008');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const chosen = modelOf(app);
    assert.equal(chosen.canLaunch, true);
    // Only where that year's nations play: sixteen of them, Europe's eleven among them, and no Elite 32.
    assert.deepEqual(chosen.scopes.map(scope => scope.id), ['world', 'UEFA']);
    app.pickSetup('sport', 'tennis');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season launches with that year\'s nations, plays its rounds and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'counter-strike');
    app.pickSetup('scope', 'world');
    app.pickSetup('dataSet', 'cs-2015');
    time.advance(200);
    await app.loadSet('cs-2015');
    await settle();
    const doc = seasonFile(2015);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'cs-2015', doc.version, 2015, '2015']);
    assert.ok(calls.includes('/counter-strike/cs-2015.json'));
    assert.deepEqual(st.teams['752'].squad.map(player => player.name), squadNames(doc, '752'), 'olofmeister\'s Sweden');
    assert.ok(st.teams['752'].squad.every(player => player.sourceInfo.edition === 'Liquipedia Elo' && !player.gen));
    assert.equal(matchSport(st.settings).rules.half, 15);
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'the squads come back exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(items.get(SAVE_KEY)); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '2014/15'; })), /Campaign data set is invalid/);
  });
});

test('a challenge link to a Counter-Strike season loads it', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=counter-strike&theatre=world&season=cs-2003&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('cs-2003');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.dataSet, 'cs-2003');
  });
});
