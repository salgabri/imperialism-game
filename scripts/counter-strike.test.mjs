// Counter-Strike (docs/design/counter-strike.md): Liquipedia's export read without fetching anything, the player Elo built
// map by map from its series, the national teams, the best-of-three series with Elo's own odds on every map, its rounds
// and overtimes, its events, its live win probability and its place among the sports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS } from '../src/data/rosters.counter-strike.js';
import { buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, SPORT_LIST } from '../src/sports/index.js';
import {
  BLOCK, counterStrike, counterStrikeProfile, HALF, HOME_EDGE, LENGTH, MAP_START, mapAt, mapChance, mapMeans, mapOdds, MAPS,
  mapState, mapTable, MOMENTUM, playMapWon, prepareMatch, roundOdds, roundsChance, roundUnit, sampleResult, stepMap, strengthFor,
  TO_WIN,
} from '../src/sports/counterStrike.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { buildLiveMatch, scorersLine } from '../src/viewModels/match.js';
import { buildSetupModel, signingsOffered, SPORT_NOTES } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { readExport } from './lib/liquipedia.mjs';
import {
  formatOf, gameRating, halvesOf, homesOf, isNationsEvent, kFactor, LINEUP, mapOf, MIN_PLAYERS, nationalTeams, nationOfTeamName, nationsOf,
  playerOf, readTournaments, regionOfNation, scoreFits, seriesInOrder, startersOf, TEAM_SIZE, tournamentOf,
} from './lib/counter-strike.mjs';
import { teamKeys } from './lib/liquipedia.mjs';

const sport = getSport('counter-strike');
const team = (id, ratings) => ({ id, name: id, code: id.slice(0, 3).toUpperCase(), sport: 'counter-strike',
  squad: ratings.map((rating, i) => ({ name: `${id} Player${i + 1}`, pos: 'PLR', rating })) });

// ---------- the export ----------

const xml = (...pages) => `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">\n${pages.map(([title, text, ns = 0]) =>
  `<page><title>${title.replace(/&/g, '&amp;')}</title><ns>${ns}</ns><id>1</id><revision><id>9</id>`
  + `<timestamp>2026-11-14T08:00:00Z</timestamp><text bytes="1" xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</text></revision></page>`).join('\n')}\n</mediawiki>`;

const card = (name, players, extra = '') => `{{TeamCard|team=${name}|${players.map(([p, flag], i) => `p${i + 1}=${p}|p${i + 1}flag=${flag}`).join('|')}${extra}}}`;
const VITALITY = [['apEX', 'fr'], ['ZywOo', 'fr'], ['flameZ', 'il'], ['mezii', 'uken'], ['ropz', 'ee']];
const SPIRIT = [['chopper', 'ru'], ['donk', 'ru'], ['sh1ro', 'ru'], ['zont1x', 'ua'], ['magixx', 'ru']];
const MAJOR = 'BLAST/Major/2025/Austin';
const MAJOR_TEXT = `{{Infobox league
|name=BLAST.tv Austin Major 2025
|game=cs2
|liquipediatier=1
|type=Offline
|country=United States
|sdate=2025-06-03
|edate=2025-06-22
}}
==Participants==
${card('Team Vitality', VITALITY, '|s6=Spinx|s6flag=il|c=XTQZZZ|cflag=fr')}
${card('Team Spirit', SPIRIT)}
==Playoffs==
{{Match|bestof=3
|opponent1={{TeamOpponent|vitality}}
|opponent2={{TeamOpponent|spirit}}
|date=June 22, 2025 - 20:00 {{Abbr/CDT}}
|map1={{Map|map=Mirage|finished=true|t1firstside=ct|t1ct=7|t1t=5|t2t=5|t2ct=7|o1t1firstside=t|o1t1t=2|o1t1ct=2|o1t2ct=1|o1t2t=1}}
|map2={{Map|map=Nuke|finished=true|score1=9|score2=13}}
|map3={{Map|map=Inferno|finished=true|t1firstside=t|t1t=8|t1ct=5|t2ct=4|t2t=3}}
}}
{{Match|bestof=3
|opponent1={{TeamOpponent|vitality|score=W}}
|opponent2={{TeamOpponent|spirit|score=FF}}
}}
[[${MAJOR}/Stage 2|Stage 2]]`;
const WINGMAN = ['Some Wingman Cup', '{{Infobox league|name=Wingman Cup|liquipediatier=2|mode=2v2|sdate=2025-01-01}}'];
const OLD = ['ESWC/2008', '{{Infobox league|name=ESWC 2008|game=cs16|liquipediatier=1|sdate=2008-08-27}}'];
const SHOW = ['Showmatch/2025', '{{Infobox league|name=All-Stars|liquipediatier=1|liquipediatiertype=Showmatch|sdate=2025-02-01}}'];
const ENC = 'Esports Nations Cup/2026';
const ENC_TEXT = `{{Infobox league|name=Esports Nations Cup 2026|game=cs2|liquipediatier=1|type=Offline|country=Saudi Arabia|sdate=2026-11-10}}
${card('France', VITALITY.slice(0, 2).concat([['Kyojin', 'fr'], ['bodyy', 'fr'], ['Lucky', 'fr']]))}
${card('Team Denmark', [['dev1ce', 'dk'], ['cadiaN', 'dk'], ['jabbi', 'dk'], ['stavn', 'dk'], ['HooXi', 'dk']])}`;

test('an event\'s infobox gives its game, tier, mode and region; a map its halves, overtimes and winner', () => {
  const [major] = readExport(xml([MAJOR, MAJOR_TEXT]));
  const event = tournamentOf(major);
  assert.deepEqual([event.game, event.tier, event.mode, event.individual, event.region, event.start], ['cs2', 1, 'team', false, null, '2025-06-03']);
  assert.equal(tournamentOf({ title: 'ESL/Challenger League/Season 50/Europe', text: '{{Infobox league|liquipediatier=2}}' }).region, 'EU');
  assert.equal(tournamentOf({ title: 'X', text: '{{Infobox league|individual=true|liquipediatier=2}}' }).individual, true);
  const overtime = mapOf('{{Map|map=Mirage|finished=true|t1firstside=ct|t1ct=7|t1t=5|t2t=5|t2ct=7|o1t1firstside=t|o1t1t=2|o1t1ct=2|o1t2ct=1|o1t2t=1}}');
  assert.deepEqual([overtime.map, overtime.rounds, overtime.winner, overtime.ot], ['Mirage', [16, 14], 1, 1]);
  assert.deepEqual(overtime.halves.map(half => [half.ot, ...half.rounds]), [[0, 7, 5], [0, 5, 7], [1, 2, 1], [1, 2, 1]]);
  assert.deepEqual(mapOf('{{Map|map=Nuke|score1=9|score2=13}}').winner, 2, 'the score the wiki gives');
  assert.equal(mapOf('{{Map|map=Inferno|finished=skip}}'), null, 'a map not played');
  assert.equal(mapOf('{{Map|map=Ancient|score1=W|score2=FF}}'), null, 'a forfeit plays no rounds');
  assert.deepEqual(halvesOf({}), []);
});

test('a score fits MR12 or MR15 as overtimes of six allow, and a map\'s format comes from its halves or its game', () => {
  const fits = (score, half) => scoreFits(score, half);
  for (const score of [[13, 0], [13, 11], [16, 12], [16, 14], [19, 15], [19, 17], [22, 20]]) assert.ok(fits(score, 12), `${score} in MR12`);
  for (const score of [[13, 12], [16, 15], [17, 15], [14, 12], [19, 14]]) assert.ok(!fits(score, 12), `${score} not in MR12`);
  assert.ok(fits([16, 10], 15) && !fits([16, 10], 12), '16–10 is CS:GO\'s');
  assert.equal(formatOf({ rounds: [13, 9], halves: [] }), 'mr12', 'only one format fits');
  assert.equal(formatOf({ rounds: [16, 14], halves: [] }), null, 'both fit, nothing says which');
  assert.equal(formatOf({ rounds: [16, 14], halves: [] }, 'cs2'), 'mr12');
  assert.equal(formatOf({ rounds: [16, 14], halves: [{ ot: 0, rounds: [9, 6] }] }), 'mr15', 'a half of fifteen rounds');
  assert.equal(formatOf({ rounds: [13, 12], halves: [] }, 'cs2'), null, 'no score of a finished map');
});

test('the export\'s 5v5 events of CS:GO and CS2 count; wingman, 1.6 and showmatches do not', () => {
  const pages = readExport(xml([MAJOR, MAJOR_TEXT], WINGMAN, OLD, SHOW, [ENC, ENC_TEXT],
    ['ZywOo', '{{Infobox player|id=ZywOo|country=France}}']));
  const { tournaments, skipped, missing, people } = readTournaments(pages);
  assert.deepEqual(tournaments.map(t => t.title), [MAJOR, ENC]);
  assert.deepEqual([skipped.mode, skipped.game, skipped.showmatch], [['Some Wingman Cup'], ['ESWC/2008'], ['Showmatch/2025']]);
  assert.deepEqual(missing, [`${MAJOR}/Stage 2`]);
  assert.equal(people.get('ZywOo'), 'france');
  const [major] = tournaments;
  assert.equal(major.rosters[0].players.filter(player => !player.sub).length, LINEUP, 'five start; the sixth is a substitute');
  const { series } = seriesInOrder(tournaments);
  assert.equal(series.length, 1, 'the forfeit plays no maps');
  const [final] = series;
  assert.deepEqual([final.games.length, final.winner, final.bestOf, final.host], [3, 1, 3, '840']);
  assert.deepEqual(final.games.map(game => game.rounds), [[16, 14], [9, 13], [13, 7]]);
  assert.deepEqual(final.teams[0].map(player => player.name), ['apEX', 'ZywOo', 'flameZ', 'mezii', 'ropz']);
  assert.deepEqual(startersOf(major.rosters[1]).map(player => player.name), SPIRIT.map(([name]) => name));
});

test('national teams play the Nations Cup, named "Denmark" or "Team Denmark", and give a player\'s nation first', () => {
  assert.equal(nationOfTeamName('Team Denmark'), '208');
  assert.equal(nationOfTeamName('Brazil'), '076');
  assert.equal(nationOfTeamName('Team Vitality'), null);
  assert.ok(isNationsEvent('Esports Nations Cup/2026', {}));
  assert.ok(isNationsEvent('IESF/World Esports Championship/2025', {}));
  const roster = team => ({ team, keys: teamKeys(team), players: [] });
  assert.ok(isNationsEvent('Some Cup', {}, ['Denmark', 'Team France', 'Brazil', 'Poland'].map(roster)), 'teams named for countries');
  assert.ok(!isNationsEvent('Some Cup', {}, ['Astralis', 'Team France', 'NAVI', 'G2'].map(roster)));
  const { tournaments } = readTournaments(readExport(xml([MAJOR, MAJOR_TEXT], [ENC, ENC_TEXT])));
  const national = nationalTeams(tournaments);
  assert.deepEqual([national.get('ZywOo').nation, national.get('Dev1ce').nation, national.has('Donk')], ['250', '208', false]);
});

// ---------- the ratings ----------

test('a rating is Elo / 25 − 2; a nation names its best seven and plays its best five', () => {
  assert.deepEqual([gameRating(1500), gameRating(1900), gameRating(2400)], [58, 74, 94]);
  assert.ok(kFactor(0) > kFactor(300) && kFactor(100000) === 8);
  const row = (name, nation, elo) => [name, name, nation === '250' ? 'fr' : 'dk', nation, null, elo, 200, 120, '2026-10-01', 'X', 'EU'];
  const french = [1, 2, 3, 4, 5, 6, 7, 8].map(i => playerOf(row(`F${i}`, '250', 2100 - i * 10), '2026-11-14', i));
  const danes = [1, 2, 3, 4].map(i => playerOf(row(`D${i}`, '208', 2000), '2026-11-14', 10 + i));
  const nations = nationsOf([...french, ...danes]);
  assert.deepEqual(nations.map(n => [n.id, n.squad.length, n.players]), [['250', TEAM_SIZE, 8]], `Denmark's four are not ${MIN_PLAYERS}`);
  const five = french.slice(0, LINEUP).reduce((sum, player) => sum + player.rating, 0) / LINEUP;
  assert.equal(nations[0].str, Math.round(five * 10) / 10, 'the mean of the five who play');
  assert.equal(french[0].source.url, 'https://liquipedia.net/counterstrike/F1');
});

test('a player\'s home is his nation\'s region, else the region of his events: a newcomer starts at its level', () => {
  assert.deepEqual(['643', '804', '398', '860', '496', '156', '036', '554', '710', '682', '504', '076', '840', '792', '376', '250', '826', null]
    .map(regionOfNation), ['CIS', 'CIS', 'CIS', 'CIS', 'ASIA', 'ASIA', 'OCE', 'OCE', 'AF', 'MENA', 'MENA', 'SA', 'NA', 'EU', 'EU', 'EU', 'EU', null]);
  // South Africans at a European event are South Africa's scene's; the side whose nation is unknown, the event's region's.
  const side = prefix => [1, 2, 3, 4, 5].map(i => ({ name: `${prefix}${i}` }));
  const series = [{ date: '2026-01-10', event: 'Some Cup/Europe', region: 'EU', international: false, host: null, page: 'p', index: 0,
    names: ['A', 'B'], teams: [side('Za'), side('Xb')], rosters: [], games: [{ winner: 2 }], winner: 2 }];
  const nationOf = key => (key.startsWith('Za') ? '710' : null);
  const homes = homesOf(series, { nationOf });
  assert.deepEqual([homes.get('Za1'), homes.get('Xb1')], ['AF', 'EU']);
  const before = homesOf(series, { nationOf, until: '2026-01-01' });
  assert.deepEqual([before.get('Za1'), before.has('Xb1')], ['AF', false], 'a nation is a player\'s whenever he plays');
});

test('the national teams rebuild byte for byte from the committed snapshot, and nothing is estimated', t => {
  if (!existsSync(new URL('./data/counter-strike-elo.json', import.meta.url))) {
    t.skip('no snapshot yet: npm run sync:counter-strike needs the Liquipedia export');
    return;
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-counter-strike.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  for (const [id, [str, count, squad]] of Object.entries(ROSTERS)) {
    assert.ok(count >= MIN_PLAYERS && squad.length === Math.min(TEAM_SIZE, count), id);
    for (const [, pos, rating, info] of squad) {
      assert.equal(pos, 'PLR');
      assert.equal(rating, gameRating(info.rawRating));
      assert.equal(info.source, 'liquipedia');
    }
    assert.equal(str, selectLineup(buildTeam(id, makeRng(1), sport)).rating, `${id}: its strength is its lineup's`);
  }
});

// ---------- a map ----------

test('a map is won with Elo\'s own odds: the round strength is solved for it, an even map is a coin toss', () => {
  const even = mapTable(0);
  assert.ok(Math.abs(even.start - 0.5) < 1e-12 && Math.abs(even.level - 0.5) < 1e-12);
  for (const gap of [-12, -4, 0, 1, 4, 8, 20]) {
    const odds = mapOdds(gap);
    const c = strengthFor(odds);
    assert.ok(Math.abs(mapTable(c).start - odds) < 1e-8, `gap ${gap}`);
    assert.ok(gap > 0 ? c > 0 : gap < 0 ? c < 0 : Math.abs(c) < 1e-9, `gap ${gap}: the favourite wins more rounds`);
  }
  assert.ok(Math.abs(mapOdds(4) - 1 / (1 + 10 ** (-0.25))) < 1e-12, 'a rating point is 25 Elo points');
  // Momentum: a round won makes the next likelier, but not a half's first.
  assert.ok(roundOdds(0, 'A') > 0.5 && roundOdds(0, 'D') < 0.5 && roundOdds(0, null) === 0.5);
  assert.ok(Math.abs(roundOdds(0, 'A') - 1 / (1 + Math.exp(-MOMENTUM))) < 1e-12);
});

test('a map runs to 13, with half-time after twelve rounds and overtimes of six from 12–12, first to four', () => {
  const play = sides => mapState([...sides]);
  assert.deepEqual(play('A'.repeat(13)), { a: 13, d: 0, overtime: false, x: 0, y: 0, last: null, over: 'A' });
  assert.equal(play('A'.repeat(11) + 'D').last, null, 'half-time: the next round is a pistol round');
  assert.equal(play('AD').last, 'D');
  const level = 'AD'.repeat(12);
  assert.deepEqual(play(level), { a: 12, d: 12, overtime: true, x: 0, y: 0, last: null, over: null });
  assert.equal(play(`${level}AAA`).last, null, 'the overtime\'s second half');
  assert.equal(play(`${level}AAAA`).over, 'A', '16–12');
  assert.deepEqual(play(`${level}ADADAD`), { a: 15, d: 15, overtime: true, x: 0, y: 0, last: null, over: null }, '3–3: another overtime');
  assert.equal(play(`${level}ADADADDDDD`).over, 'D', '15–19');
  assert.deepEqual(stepMap(play('A'.repeat(13)), 'D'), play('A'.repeat(13)), 'a finished map stays as it is');
  assert.deepEqual(mapState([]), MAP_START);
  assert.deepEqual([1, 12, 24, 25, 27, 28, 40].map(roundUnit), [1, 12, 24, 25, 25, 26, 26]);
});

test('rounds drawn for a known winner are the round chain\'s own: drawn at Elo\'s odds, they score as the chain does', () => {
  const rng = makeRng(11);
  for (const odds of [0.55, 0.8]) {
    const table = mapTable(strengthFor(odds));
    const means = mapMeans(odds);
    // A map's rounds scatter by about 3.2: 120,000 maps put the mean within 0.01 of the chain's, a sixth of the tolerance.
    const n = 120000;
    let rounds = 0, overtime = 0, won = 0;
    for (let i = 0; i < n; i++) {
      const aWins = rng() < odds;
      const map = playMapWon(rng, table, aWins);
      const state = mapState(map);
      assert.equal(state.over, aWins ? 'A' : 'D');
      rounds += map.length;
      if (map.length > 24) overtime++;
      if (state.over === 'A') won++;
    }
    assert.ok(Math.abs(rounds / n - means.rounds) < 0.06, `${odds}: ${rounds / n} rounds v ${means.rounds}`);
    assert.ok(Math.abs(overtime / n - means.overtime) < 0.007, `${odds}: ${overtime / n} to overtime v ${means.overtime}`);
    assert.ok(Math.abs(won / n - odds) < 0.008);
    assert.ok(Math.abs(means.loser.reduce((sum, x) => sum + x, 0) + means.overtime - 1) < 1e-9, 'every map ends');
  }
});

// ---------- the series ----------

test('a series is best of three: the winner takes two maps, and both paths give the same score for a seed', () => {
  const A = team('fra', [92, 90, 88, 87, 85]), D = team('den', [90, 88, 86, 85, 84]);
  const prepared = prepareMatch(A, D);
  for (let seed = 1; seed <= 200; seed++) {
    const fast = sampleResult(makeRng(seed), prepared, 6);
    const full = counterStrike.simulate(makeRng(seed), A, D, 6);
    assert.deepEqual([full.ga, full.gd, full.winner], [fast.ga, fast.gd, fast.winner], `seed ${seed}`);
    assert.equal(Math.max(full.ga, full.gd), TO_WIN);
    assert.ok(Math.min(full.ga, full.gd) < TO_WIN);
  }
  const odds = estimateWinProbability({ sport, attacker: A, defender: D, samples: 40000 }).attacker;
  const map = mapOdds(2);
  // Best of three at a 57% map: about 61% with every map at those odds; with the series' form (fitted to the real
  // best-of-threes, whose favourites won about as often as their maps' odds) a little over the map's own.
  assert.ok(odds > map - 0.005 && odds < map * map * (3 - 2 * map) - 0.01, `series ${odds} over the map's ${map}`);
});

test('every map\'s rounds add up to its score, each in its unit on the clock, and the map is named for its MVP', () => {
  const A = team('fra', [92, 90, 88, 87, 85]), D = team('den', [88, 87, 86, 85, 84]);
  let overtime = 0, played = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const result = counterStrike.simulate(makeRng(seed), A, D, 6);
    const ends = result.ev.filter(e => e.pts > 0);
    assert.deepEqual([ends.filter(e => e.tid === 'fra').length, ends.filter(e => e.tid === 'den').length], [result.ga, result.gd]);
    for (const end of ends) {
      played++;
      const start = (end.map - 1) * BLOCK;
      const rounds = result.ev.filter(e => e.pts === 0 && e.map === end.map);
      const state = mapState(rounds.map(e => (e.tid === 'fra' ? 'A' : 'D')));
      assert.equal(state.over, end.tid === 'fra' ? 'A' : 'D', `seed ${seed} map ${end.map}: the rounds give the map to its winner`);
      const [w, l] = end.score.split('–').map(Number);
      assert.deepEqual([Math.max(state.a, state.d), Math.min(state.a, state.d)], [w, l]);
      assert.deepEqual(rounds.map(e => e.round), rounds.map((e, i) => i + 1));
      rounds.forEach((e, i) => assert.equal(e.m, start + roundUnit(i + 1)));
      assert.equal(end.m, rounds.at(-1).m, 'the map ends with its last round');
      assert.equal(!!end.ot, rounds.length > 24);
      if (end.ot) overtime++;
      assert.ok(rounds.some(e => e.tid === end.tid && e.name === end.name), 'the map is named for one of its winner\'s MVPs');
      assert.ok(rounds.every(e => e.m > start && e.m <= start + BLOCK), 'inside its map\'s block');
    }
  }
  assert.ok(overtime / played > 0.03 && overtime / played < 0.25, `overtime ${overtime / played}`);
});

test('the home crowd moves a map only by the edge the real LANs show', () => {
  const A = team('fra', [90, 88, 88, 86, 85]), D = team('den', [88, 88, 87, 86, 85]);
  assert.equal(prepareMatch(A, D, undefined, undefined, { home: true }).gap, prepareMatch(A, D).gap - HOME_EDGE);
  assert.equal(sport.homeAdvantage, HOME_EDGE !== 0, 'Home advantage is offered only with an edge to give');
});

test('the live chart starts from the series odds, follows each round and map, and ends on the winner', () => {
  const A = team('fra', [92, 90, 88, 87, 85]), D = team('den', [88, 87, 86, 85, 84]);
  const model = liveModelFor(sport, A, D, undefined, undefined, 6);
  assert.ok(isLiveModel(model));
  assert.deepEqual([model.kind, model.length, model.ot, model.maxOt, model.toWin], ['maps', LENGTH, BLOCK, 1, 2]);
  const odds = estimateWinProbability({ sport, attacker: A, defender: D, samples: 20000 }).attacker;
  assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.015, `start ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
  for (let seed = 1; seed <= 30; seed++) {
    const result = counterStrike.simulate(makeRng(seed), A, D, 6);
    const end = Math.max(...result.ev.map(e => e.m));
    const series = winSeries({ model, goals: result.ev, aId: 'fra', dId: 'den', minute: end, final: { winnerId: result.winner } });
    assert.equal(series.at(-1).p, result.winner === 'fra' ? 1 : 0);
    // A map won moves the chart its winner's way.
    for (const e of result.ev.filter(event => event.pts > 0 && event.m < end)) {
      const before = series[e.m - 1].p, after = series[e.m].p;
      assert.ok(e.tid === 'fra' ? after >= before - 1e-9 : after <= before + 1e-9, `seed ${seed} at ${e.m}`);
    }
  }
  assert.deepEqual(chartDomain(model, 60).ticks, [0, 26, 52, 78]);
});

test('the live chart\'s chances are the model\'s: from a map in play, the rounds left win the series as often', () => {
  const A = team('fra', [90, 88, 88, 86, 85]), D = team('den', [88, 88, 87, 86, 85]);
  // No match-day form (drama 0): every map at the same odds, so a series played on from the state is the chart's own.
  const model = liveModelFor(sport, A, D, undefined, undefined, 0);
  const odds = mapOdds(model.gap), table = mapTable(strengthFor(odds));
  // Down a map (6–13), 9–7 up in the second, the last round won.
  const first = [...'ADADADADADAD', ...'DDDDDDD'];
  assert.equal(mapState(first).over, 'D');
  const second = [...'ADADADADADADADAA'];
  const state = mapState(second);
  assert.deepEqual([state.a, state.d, state.over], [9, 7, null]);
  const goals = [...first.map((side, i) => ({ m: roundUnit(i + 1), tid: side === 'A' ? 'fra' : 'den', pts: 0 })),
    { m: roundUnit(first.length), tid: 'den', pts: 1 },
    ...second.map((side, i) => ({ m: BLOCK + roundUnit(i + 1), tid: side === 'A' ? 'fra' : 'den', pts: 0 }))];
  const chart = winSeries({ model, goals, aId: 'fra', dId: 'den', minute: BLOCK + 16 }).at(-1).p;
  const exact = mapChance(table, state) * odds;
  assert.ok(Math.abs(chart - exact) < 1e-9, `${chart} v ${exact}`);
  // The same by playing the rounds on.
  const rng = makeRng(5);
  let won = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    let at = state;
    while (!at.over) at = stepMap(at, rng() < roundOdds(table.c, at.last) ? 'A' : 'D');
    if (at.over === 'A' && rng() < odds) won++;
  }
  assert.ok(Math.abs(won / n - chart) < 0.01, `played on ${won / n} v chart ${chart}`);
  assert.ok(roundsChance(table, second) > 0 && roundsChance(table, []) === 1);
});

// ---------- the sport among the others ----------

test('Counter-Strike is the eleventh sport, nations only, Great Britain as one, a tile of its own', () => {
  // Among the esports, after Rocket League (more may follow it).
  assert.ok(SPORT_LIST.indexOf(sport) > SPORT_LIST.indexOf(getSport('rocket-league')), 'after Rocket League');
  assert.equal(sport.id, 'counter-strike');
  assert.equal(sport.nationsOnly, true);
  assert.deepEqual(sport.clubs, []);
  assert.equal(sport.playsAs['826'].code, 'GBR');
  assert.equal(SPORT_NOTES['counter-strike'], 'Nations');
  assert.deepEqual([MAPS, TO_WIN, BLOCK, LENGTH, HALF], [3, 2, 26, 52, 12]);
  assert.deepEqual([clockLabel(sport, 0), clockLabel(sport, 27), clockLabel(sport, 78), clockTick(sport, 52)], ['M1', 'M2', 'M3', 'M2']);
  assert.equal(mapAt(26), 1);
  const setup = buildSetupModel({ sport: 'counter-strike', layer: 'clubs' }, {});
  assert.equal(setup.nationsOnly, true);
  assert.equal(setup.layer, 'nations', 'no clubs to play');
  assert.deepEqual(readChallenge('?sport=counter-strike&teams=clubs').setup.layer, 'nations');
});

test('the feed names each round\'s MVP and the map\'s score, overtime\'s marked; the scorers count MVPs', () => {
  assert.equal(sport.formatEvent({ m: 3, pts: 0, map: 1, round: 3, name: 'ZywOo', score: '2–1' }, 'FRA').text, 'R3 — ZywOo (FRA) 2–1');
  assert.equal(sport.formatEvent({ m: 25, pts: 0, map: 1, round: 26, name: 'ZywOo', score: '14–12', ot: true }, 'FRA').text,
    'R26 OT — ZywOo (FRA) 14–12');
  assert.equal(sport.formatEvent({ m: 26, pts: 1, map: 1, round: 28, name: 'ZywOo', score: '16–12', ot: true }, 'FRA').text, 'MAP 1 — FRA 16–12 OT');
  assert.equal(sport.formatEvent({ m: 40, pts: 1, map: 2, round: 21, name: 'ZywOo', score: '13–8' }, 'FRA').when, 'M2');
  assert.equal(sport.formatToast({ pts: 0, round: 7, score: '5–2' }), 'ROUND 7 — 5–2');
  const shown = [{ tid: 'fra', name: 'Mathieu ZywOo', pts: 0 }, { tid: 'fra', name: 'Mathieu ZywOo', pts: 0 },
    { tid: 'fra', name: 'Dan apEX', pts: 0 }, { tid: 'fra', name: 'Mathieu ZywOo', pts: 1 }];
  assert.match(scorersLine(shown, 'fra', {}, 'counter-strike'), /ZywOo 2 MVP · .*apEX 1 MVP/);
});

test('a finished match keeps its MVPs, and Rocket League\'s its scorers, when read back from the history', () => {
  const teams = { fra: team('fra', [90, 88, 87, 86, 85]), den: team('den', [88, 87, 86, 85, 84]) };
  const entry = (sportId, events) => ({ id: 'match-1', aId: 'fra', dId: 'den', winnerId: 'fra', a: { teamId: 'fra', code: 'FRA', score: '2' },
    b: { teamId: 'den', code: 'DEN', score: '0' }, events });
  const cs = buildLiveMatch({ teams, history: [entry('counter-strike', [
    { when: 'M1', text: 'R1 — fra Player1 (FRA) 1–0' }, { when: 'M1', text: 'R2 — fra Player1 (FRA) 2–0' },
    { when: 'M1', text: 'R3 OT — den Player2 (DEN) 1–2' }, { when: 'M1', text: 'MAP 1 — FRA 13–1' }])] }, { sport: counterStrike });
  assert.match(cs.a.scorers, /Player1 2 MVP/);
  assert.match(cs.b.scorers, /Player2 1 MVP/);
  const rl = buildLiveMatch({ teams, history: [entry('rocket-league', [
    { when: 'G1', text: 'GOAL — fra Player1 (FRA) 1–0' }, { when: 'G1', text: 'OVERTIME GOAL — den Player2 (DEN) 1–1 +0:42' }])] },
    { sport: getSport('rocket-league') });
  assert.match(rl.a.scorers, /Player1 1 G/, 'Rocket League\'s goal lines read back too');
  assert.match(rl.b.scorers, /Player2 1 G/);
});

test('Computer signings is no choice, and the squad screen draws a map and profiles the team and its best player', () => {
  assert.equal(signingsOffered('counter-strike'), false);
  const nation = team('fra', [92, 90, 88, 87, 85, 80, 70]);
  const view = buildSquad({ teams: { fra: nation }, aliveIds: ['fra'], history: [] }, { sport }, 'fra');
  assert.equal(view.layout, 'site');
  assert.equal(view.viewLabel, 'Sites', 'not "Map", the campaign\'s own tab beside it');
  assert.equal(selectLineup(nation).starters.length, LINEUP);
  assert.deepEqual(counterStrikeProfile(selectLineup(nation)), { team: (92 + 90 + 88 + 87 + 85) / 5, best: 92 });
});
