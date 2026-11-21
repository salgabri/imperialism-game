// Valorant (docs/design/valorant.md): vlr.gg's pages read from the cache, the player Elo built map by map, the national
// teams, the best-of-three series of maps played round by round with Elo's own odds for every map, its events, its live
// win probability and its place among the sports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS } from '../src/data/rosters.valorant.js';
import { buildTeam, makeRng, selectLineup, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, SPORT_LIST } from '../src/sports/index.js';
import {
  BLOCK, BONUS_ROUND, BROKEN_BUY, chanceFrom, HALF, LENGTH, mapAt, mapBeta, mapMeans, mapOdds, mapTable, MAPS, MAP_POOL,
  MOMENTUM, overtimeOdds, PISTOL_FOLLOW, playMap, prepareMatch, roundOdds, sampleResult, simulateSeries, TO_WIN, valorantProfile,
} from '../src/sports/valorant.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
import { buildSetupModel, homeOffered, signingsOffered, SPORT_NOTES } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { countsEvent, readEventList, readEventMatches, readMatch } from './lib/vlr.mjs';
import { circuitOf, gameRating, isNationsEvent, nationalTeams, nationOfPlayer, regionOfCircuit, seriesOf } from './lib/valorant.mjs';
import {
  circuitLevels, expected, favouriteBins, groupOffset, groupOffsets, homeEdge, homesOf, isOffensiveName, kFactor, mostOf, nationsOf, ratedPlayers,
  runElo, scoredGames, scoreRows, START,
} from './lib/esports-elo.mjs';

const sport = getSport('valorant');
const team = (id, ratings) => ({ id, name: id, code: id.slice(0, 3).toUpperCase(), sport: 'valorant',
  squad: ratings.map((rating, i) => ({ name: `${id} Player${i + 1}`, pos: 'PLR', rating })) });
const tally = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };

// ---------- vlr.gg's pages ----------

const EVENTS = `<a class="wf-card mod-flex event-item" href="/event/2283/valorant-champions-2025" style="margin-bottom: 3px;" >
  <div class="event-item-inner"><div class="event-item-title">
    Valorant Champions 2025						</div>
  <div style="display: flex;"><div class="event-item-desc-item"><span class="event-item-desc-item-status mod-completed">completed</span>
  <div class="event-item-desc-item-label">Status</div></div>
  <div class="event-item-desc-item mod-prize">$2,250,000 <div class="event-item-desc-item-label">Prize Pool</div></div>
  <div class="event-item-desc-item mod-dates">Sep 12—Oct 5 <div class="event-item-desc-item-label">Dates</div></div>
  <div class="event-item-desc-item mod-location">
    <i class="flag mod-fr"></i><div class="event-item-desc-item-label">Region</div></div></div></div></a>
  <a href="/events/?tier=60&amp;page=2">2</a><a href="/events/?tier=60&amp;page=6">6</a>`;

const MATCHES = `<a href="/542195/fnatic-vs-nrg-valorant-champions-2025-gf" class="wf-module-item match-item mod-color mod-bg-after-striped_purple ">
  <div class="match-item-eta"><div class="ml mod-completed"><div class="ml-status">Completed</div></div></div></a>
  <a href="/542196/tbd-vs-tbd" class="wf-module-item match-item"><div class="ml-status">Upcoming</div></a>`;

// One map of a series, as vlr.gg lays it out: the score header (each team's rounds by half), the rounds one by one (each
// column's two squares, the winner's marked with its side and how the round ended), then each team's players.
const square = (won, side) => (won ? `<div class="rnd-sq mod-win mod-${side}">\n<img src="/img/vlr/game/round/elim.webp" alt="">\n</div>` : '<div class="rnd-sq ">\n</div>');
const roundsGrid = winners => `<div class="vlr-rounds"><div class="vlr-rounds-row"><div class="vlr-rounds-row-col mod-teams">
  <div class="team"><span class="vlr-rounds-tag">FNC</span></div></div>
  ${winners.map((w, i) => `<div class="vlr-rounds-row-col "  title="x">\n<div class="rnd-num">${i + 1}</div>\n${square(w === 1, 'ct')}\n${square(w === 2, 't')}\n</div>`).join('\n')}
  </div>\n</div>\n</div>\n</div>\n</div>\n</div>`;
const player = (id, name, flag, country) => `<div class="ovw-row"><div class="ovw-cell mod-player"><div class="ovw-player">
  <i class="flag mod-${flag}" title="${country}"></i><a href="/player/${id}/${name.toLowerCase()}">
  <div class="ovw-player-name text-of">${name}</div><div class="ovw-player-tag ge-text-light">X</div></a></div></div></div>`;
const MAP = (gameId, name, pick, [a, b], winners, players) => `<div class="vm-stats-game " data-game-id="${gameId}">
  <div class="vm-stats-game-header"><div class="team"><div class="score mod-win" style="margin-right: 12px;">${a} </div>
  <div ><div class="team-name">Fnatic</div><span class="mod-ct">7</span> / <span class="mod-t">6</span></div></div>
  <div class="map"><div class="map-name"><span style="position: relative;">
  ${name}${pick ? `<span class="picked mod-${pick} ge-text-light">PICK</span>` : ''}</span></div>
  <div class="map-duration ge-text-light">51:02</div></div>
  <div class="team mod-right"><div ><div class="team-name">NRG</div><span class="mod-t">5</span> / <span class="mod-ct">${b - 5}</span></div>
  <div class="score " style="margin-left: 8px;">${b}</div></div></div>
  ${roundsGrid(winners)}
  <div class="ovw-table">${players[0].map(p => player(...p)).join('')}</div>
  <div class="ovw-table">${players[1].map(p => player(...p)).join('')}</div>
  </div>`;
const FNC = [[1, 'Boaster', 'gb', 'United Kingdom'], [2, 'Alfajer', 'tr', 'Turkey'], [3, 'Chronicle', 'ru', 'Russia'],
  [4, 'kaajak', 'pl', 'Poland'], [5, 'crashies', 'us', 'United States']];
const NRG = [[11, 'brawk', 'us', 'United States'], [12, 'mada', 'ca', 'Canada'], [13, 'Ethan', 'us', 'United States'],
  [14, 'skuba', 'us', 'United States'], [15, 's0m', 'un', 'International']];
// Fnatic win the first map 13–11, the last round in the grid's last column.
const FIRST = [1, 1, 2, 1, 1, 2, 2, 1, 1, 1, 2, 2, 1, 2, 1, 2, 2, 2, 1, 2, 1, 1, 2, 1];
const MATCH = `<a href="/event/2283/valorant-champions-2025/playoffs" class="match-header-event">
  <img src="x.png"><div><div style="font-weight: 700;">
  Valorant Champions 2025					</div><div class="match-header-event-series">Playoffs: Grand Final</div></div></a>
  <div class="match-header-date"><div class="moment-tz-convert" data-utc-ts="2025-10-05 13:00:00" data-moment-format="MMMM D, YYYY">
  October 5, 2025</div><div style="font-style: italic;">Patch 11.06</div></div>
  <div class="match-header-vs"><a class="match-header-link wf-link-hover mod-1"  href="/team/2593/fnatic" >
  <div class="match-header-link-name mod-1"><div class="wf-title-med ">Fnatic</div></div></a>
  <div class="match-header-vs-score"><div class="match-header-vs-note">final</div><div class="match-header-vs-score">
  <div class="sp-hide"><span class="match-header-vs-score-winner">1</span><span class="match-header-vs-score-colon">:</span>
  <span class="match-header-vs-score-loser">0</span></div></div><div class="match-header-vs-note">Bo3</div></div>
  <a class="match-header-link wf-link-hover mod-2"  href="/team/1034/nrg" ><div class="match-header-link-name mod-2">
  <div class="wf-title-med ">NRG</div></div></a></div>
  <div class="vm-stats-gamesnav-item" data-game-id="all"></div>
  ${MAP(9001, 'Lotus', 2, [13, 11], FIRST, [FNC, NRG])}
  <div class="vm-stats-game mod-active" data-game-id="all"></div>`;

test('vlr.gg\'s listing: each event with its status, dates and host, and the listing\'s last page', () => {
  const { events, lastPage } = readEventList(EVENTS);
  assert.deepEqual(events, [{ id: 2283, slug: 'valorant-champions-2025', title: 'Valorant Champions 2025', status: 'completed',
    dates: 'Sep 12—Oct 5', prize: '$2,250,000', flag: 'fr' }]);
  assert.equal(lastPage, 6, 'the listing writes its page links with &amp;');
  assert.deepEqual(readEventMatches(MATCHES), [{ id: 542195, slug: 'fnatic-vs-nrg-valorant-champions-2025-gf', completed: true },
    { id: 542196, slug: 'tbd-vs-tbd', completed: false }]);
});

test('a match page: its date, teams, score and format, and each map\'s score, pick, rounds and players with their flags', () => {
  const match = readMatch(MATCH);
  assert.equal(match.date, '2025-10-05 13:00:00');
  assert.equal(match.patch, '11.06');
  assert.deepEqual(match.event, { id: 2283, name: 'Valorant Champions 2025', series: 'Playoffs: Grand Final' });
  assert.deepEqual(match.teams, [{ id: 2593, name: 'Fnatic' }, { id: 1034, name: 'NRG' }]);
  assert.deepEqual([match.score, match.bestOf], [[1, 0], 3]);
  assert.equal(match.maps.length, 1);
  const [map] = match.maps;
  assert.deepEqual([map.id, map.name, map.pick, map.score, map.duration], [9001, 'Lotus', 2, [13, 11], '51:02']);
  // Every round, the grid's last column included (its winner's square closes with the grid itself).
  assert.equal(map.rounds.length, 24);
  assert.deepEqual(map.rounds.map(round => round.winner), FIRST);
  assert.deepEqual(map.rounds.at(-1), { n: 24, winner: 1, side: 'ct', how: 'elim' });
  assert.equal(map.rounds[2].side, 't');
  assert.deepEqual(map.players.map(side => side.map(p => `${p.name}/${p.flag}`)), [FNC.map(p => `${p[1]}/${p[2]}`), NRG.map(p => `${p[1]}/${p[2]}`)]);
  assert.equal(map.players[0][0].country, 'United Kingdom');
});

test('the events the ratings count: VCT, Challengers and the off-season from 2023, open qualifiers left out', () => {
  assert.ok(countsEvent({ id: 2283, title: 'Valorant Champions 2025' }, 34));
  assert.ok(!countsEvent({ id: 1015, title: 'Valorant Champions 2022' }, 34), 'before LOCK//IN São Paulo');
  assert.ok(!countsEvent({ id: 3186, title: 'VCT 2027: America Kickoff - North America Open Qualifier' }, 502));
  assert.ok(!countsEvent({ id: 3175, title: 'VCT 2027: EMEA Kickoff - Europe Qualifier' }, 685), 'an open bracket by its size');
  assert.ok(countsEvent({ id: 3177, title: 'VCT 2027: EMEA Kickoff - Türkiye Qualifier' }, 110));
});

test('each event\'s circuit: a franchised league\'s region, a Challengers league\'s subregion, none for the international stage', () => {
  const circuit = (title, tier) => circuitOf({ title, tier });
  assert.equal(circuit('VCT 2025: EMEA Stage 1', 60), 'VCT EMEA');
  assert.equal(circuit('VCT 2027: EMEA Kickoff - Türkiye Qualifier', 60), 'Challengers Türkiye', 'open to the second tier');
  assert.equal(circuit('VCT 2026: Americas Kickoff', 60), 'VCT Americas');
  assert.equal(circuit('Champions Tour 2024: Pacific Kickoff', 60), 'VCT Pacific');
  assert.equal(circuit('China Evolution Series 2026: Act 1', 60), 'Challengers China');
  assert.equal(circuit('Valorant Masters Toronto 2025', 60), null);
  assert.equal(circuit('Valorant Champions 2025', 60), null);
  assert.equal(circuit('Champions Tour 2023: LOCK//IN São Paulo', 60), null);
  assert.equal(circuit('Challengers 2026: Japan Split 1', 61), 'Challengers Japan');
  assert.equal(circuit('Challengers 2025: Türkiye Birlik Stage 3', 61), 'Challengers Türkiye');
  assert.equal(circuit('Gamers Club Challengers League 2024 Brazil: Split 2', 61), 'Challengers Brazil');
  assert.equal(circuit('Challengers 2025: EMEA Stage 2', 61), 'Challengers EMEA');
  assert.equal(circuit('VCT 2025: Pacific Ascension', 61), null, 'Ascension gathers a region\'s subregions');
  assert.equal(circuit('Red Bull Home Ground 2025', 67), null);
  assert.equal(regionOfCircuit('Challengers France'), 'EMEA');
  assert.equal(regionOfCircuit('VCT Pacific'), 'Pacific');
  assert.ok(isNationsEvent({ title: 'Esports Nations Cup 2026: Europe Qualifier' }));
});

// ---------- the ratings ----------

const entry = (key, name, flag, team) => ({ key, name, flag, team });
const side = (prefix, flag, n = 5) => Array.from({ length: n }, (_, i) => entry(`${prefix}${i}`, `${prefix}${i}`, flag, prefix));

test('the Elo: a side plays at its players\' mean, every player of it moves by its side\'s amount, K shrinks with his maps', () => {
  assert.equal(expected(0), 0.5);
  assert.ok(Math.abs(expected(100) - 0.64) < 0.001);
  assert.ok(kFactor(0, 240) > kFactor(100, 240));
  assert.equal(kFactor(1e6, 240), 8, 'never below the floor');
  const one = { date: '2026-01-01', circuit: 'VCT EMEA', games: [{ sides: [side('a', 'fr'), side('b', 'de')], winner: 1 }] };
  const { players } = runElo([one], { scale: 240 });
  const moved = kFactor(0, 240) * 0.5;
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(players.get(`a${i}`).elo - (START + moved)) < 1e-9);
    assert.ok(Math.abs(players.get(`b${i}`).elo - (START - moved)) < 1e-9);
  }
  assert.equal(mostOf(players.get('a0').flags), 'fr');
});

test('each circuit\'s level is fitted at once with its players\'; a newcomer starts at his home circuit\'s', () => {
  // Two circuits that play among themselves, and meet now and then: the strong one wins three in four of those meetings.
  const series = [];
  const rng = makeRng(5);
  for (let day = 0; day < 400; day++) {
    const date = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    const pick = prefix => side(`${prefix}${Math.floor(rng() * 4)}-`, 'fr');
    series.push({ date, circuit: 'VCT EMEA', games: [{ sides: [pick('s'), pick('s')], winner: rng() < 0.5 ? 1 : 2 }] });
    series.push({ date, circuit: 'Challengers France', games: [{ sides: [pick('w'), pick('w')], winner: rng() < 0.5 ? 1 : 2 }] });
    if (day % 4 === 0) series.push({ date, circuit: null, games: [{ sides: [pick('s'), pick('w')], winner: rng() < 0.75 ? 1 : 2 }] });
  }
  // Three in four is 191 Elo, a little of it left to the players' own offsets; twenty players each, centred on 1500.
  const levels = circuitLevels(series);
  assert.ok(levels['VCT EMEA'] - levels['Challengers France'] > 100, JSON.stringify(levels));
  assert.ok(Math.abs((levels['VCT EMEA'] + levels['Challengers France']) / 2 - START) <= 1, JSON.stringify(levels));
  assert.deepEqual(circuitLevels(series, { until: '2024-01-01' }), {}, 'no games before the first');
  // A Challengers player whose first map is at a VCT event starts at his own circuit's level, not the event's.
  const homes = homesOf(series);
  assert.equal(homes.get('w0-0'), 'Challengers France');
  assert.equal(homesOf(series, { until: '2024-01-01' }).size, 0);
  const visit = [{ date: '2023-12-31', circuit: 'VCT EMEA', games: [{ sides: [side('w0-', 'fr'), side('s0-', 'fr')], winner: 1 }] }];
  const startOf = options => {
    let start = null;
    runElo(visit, { scale: 160, starts: levels, ...options, onGame: (one, game, e, sides) => { start = sides[0][0].elo; } });
    return start;
  };
  assert.equal(startOf({ homes }), levels['Challengers France']);
  assert.equal(startOf({}), levels['VCT EMEA'], 'with no homes given, his first event\'s circuit');
});

test('the levels\' own prior holds a thinly linked circuit near the mean; a player of no circuit takes his country\'s home', () => {
  // A strong circuit meets a weak one 100 times; a third, whose players are as good as the weak one's, meets them twice.
  const series = [];
  const rng = makeRng(9);
  for (let day = 0; day < 300; day++) {
    const date = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    const pick = (prefix, flag) => side(`${prefix}${Math.floor(rng() * 4)}-`, flag);
    for (const [prefix, circuit, flag] of [['s', 'VCT EMEA', 'de'], ['w', 'Challengers France', 'fr'], ['t', 'Challengers Italy', 'it']]) {
      series.push({ date, circuit, games: [{ sides: [pick(prefix, flag), pick(prefix, flag)], winner: rng() < 0.5 ? 1 : 2 }] });
    }
    if (day % 3 === 0) series.push({ date, circuit: null, games: [{ sides: [pick('s', 'de'), pick('w', 'fr')], winner: rng() < 0.75 ? 1 : 2 }] });
    if (day === 100 || day === 200) series.push({ date, circuit: null, games: [{ sides: [pick('w', 'fr'), pick('t', 'it')], winner: 1 }] });
  }
  const free = circuitLevels(series), held = circuitLevels(series, { levelSpread: 50 });
  assert.ok(Math.abs(held['Challengers Italy'] - START) < Math.abs(free['Challengers Italy'] - START), JSON.stringify({ free, held }));
  assert.ok(held['VCT EMEA'] - held['Challengers France'] > 50, 'a hundred meetings still set the gap');
  // A French amateur who only ever plays an invitational (no circuit) calls home the circuit most French players call home.
  const invitational = [...series, { date: '2024-12-01', circuit: null, games: [{ sides: [side('amateur', 'fr'), side('s0-', 'de')], winner: 2 }] }];
  assert.equal(homesOf(invitational).has('amateur0'), false);
  const byCountry = homesOf(invitational, { byCountry: true });
  assert.equal(byCountry.get('amateur0'), 'Challengers France', 'every French player calls Challengers France home');
  assert.equal(byCountry.get('s0-0'), 'VCT EMEA', 'a player of a circuit keeps his own');
  assert.equal(homesOf([{ date: '2024-01-01', circuit: null, games: [{ sides: [side('x', null), side('y', 'zz')], winner: 1 }] }], { byCountry: true }).size, 0,
    'no flag, or no one of his country with a home: no home');
});

test('the games between circuits, each scored before it is played, and a group\'s offset in them', () => {
  // Two circuits meet; the first wins 70% of the meetings where Elo, every newcomer at 1500, starts them level.
  const series = [];
  const rng = makeRng(3);
  for (let day = 0; day < 600; day++) {
    const date = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    for (const [prefix, circuit] of [['a', 'VCT Pacific'], ['b', 'Challengers Japan']]) {
      series.push({ id: series.length, date, circuit, games: [{ sides: [side(`${prefix}${day % 3}-`, 'jp'), side(`${prefix}${(day + 1) % 3}-`, 'jp')], winner: rng() < 0.5 ? 1 : 2 }] });
    }
    if (day % 2 === 0) series.push({ id: series.length, date, circuit: null, games: [{ sides: [side(`a${day % 3}-`, 'jp'), side(`b${day % 3}-`, 'jp')], winner: rng() < 0.7 ? 1 : 2 }] });
  }
  const rows = scoredGames(series, { scale: 240 }, { from: '2024-03-01' });
  const between = rows.filter(row => row.circuits[0] && row.circuits[1] && row.circuits[0] !== row.circuits[1]);
  assert.ok(between.length > 200 && between.every(row => row.circuits[0] === 'VCT Pacific' && row.circuits[1] === 'Challengers Japan'));
  assert.ok(rows.filter(row => row.circuits[0] === row.circuits[1]).length > 2 * between.length, 'the rest within one circuit');
  const offsets = groupOffsets(rows);
  assert.equal(offsets['VCT Pacific'].elo, -offsets['Challengers Japan'].elo, 'one offset, two sides');
  assert.ok(offsets['VCT Pacific'].se > 0 && offsets['VCT Pacific'].n === between.length);
  // Elo follows the 70%, so the residual left is small, and a known miss is recovered: every game won by the side Elo gives 0.3.
  assert.ok(Math.abs(offsets['VCT Pacific'].elo) < 3 * offsets['VCT Pacific'].se, JSON.stringify(offsets['VCT Pacific']));
  const missed = groupOffset(Array.from({ length: 400 }, (_, i) => ({ gap: -147.2, won: i % 2, cluster: i })));
  assert.ok(Math.abs(missed.elo - 147) <= 1, JSON.stringify(missed));
  assert.equal(scoreRows([{ e: 0.5, won: 1 }, { e: 0.5, won: 0 }]).logLoss, Math.LN2);
});


test('the rated players: twenty maps behind them, one within the year; a player\'s nation is his national team\'s, else his flag\'s', () => {
  const games = Array.from({ length: 25 }, () => ({ sides: [side('a', 'fr'), side('b', 'de')], winner: 1 }));
  const series = [{ date: '2026-03-01', circuit: 'VCT EMEA', event: { title: 'VCT 2026: EMEA Stage 1' }, teams: ['A', 'B'], games },
    { date: '2026-11-01', circuit: null, event: { title: 'Esports Nations Cup 2026: Europe Qualifier' }, teams: ['Spain', 'Germany'],
      games: [{ sides: [side('a', 'fr'), side('b', 'de')], winner: 2 }] }];
  const national = nationalTeams(series);
  assert.equal(national.get('a0').nation, '724', 'a0 played for Spain at the Nations Cup');
  const { players } = runElo(series, { scale: 240 });
  const rated = ratedPlayers(players, '2026-11-15', { minGames: 20, activeDays: 365, nationOf: p => nationOfPlayer(p, national) });
  assert.equal(rated.length, 10);
  assert.equal(rated.find(p => p.key === 'a0').nation, '724');
  assert.equal(rated.find(p => p.key === 'b0').nation, '276');
  assert.ok(ratedPlayers(players, '2028-01-01', { minGames: 20, activeDays: 365, nationOf: () => null }).length === 0, 'none within the year');
  assert.equal(gameRating(2400), 94);
});

test('a tag that is an insult or an obscenity plays for nobody; a name that only looks like one plays', () => {
  for (const name of ['婊子你最好做好准备', 'xXfuckXx', 'Nazi', 'Hitlerboy', 'pidorok']) assert.ok(isOffensiveName(name), name);
  for (const name of ['Scunthorpe', 'Nazim', 'Shifty', 'Dickson', 'Raptor', 'aspas', 'Cocky']) assert.ok(!isOffensiveName(name), name);
  const players = new Map([['p', { key: 'p', name: 'xXfuckXx', names: new Map([['xXfuckXx', 30]]), elo: 1900, games: 30, wins: 20,
    last: '2026-11-01', flags: new Map([['fr', 30]]), circuits: new Map(), team: 'T' }]]);
  const [rated] = ratedPlayers(players, '2026-11-15', { minGames: 20, activeDays: 365, nationOf: () => '250' });
  assert.equal(rated.nation, null, 'rated, but for no nation');
});

test('the host\'s edge at a LAN, and the favourite\'s series record by its odds', () => {
  const games = Array.from({ length: 40 }, (_, i) => ({ host: '410', keys: [['k1', 'k2', 'k3', 'x4', 'x5'], ['j1', 'j2', 'j3', 'j4', 'j5']],
    surprise: i % 2 ? 0.2 : -0.1 }));
  const nationOf = key => (key.startsWith('k') ? '410' : key.startsWith('j') ? '392' : null);
  const edge = homeEdge(games, nationOf, 3);
  assert.equal(edge.games, 40);
  assert.ok(Math.abs(edge.surprise - 0.05) < 1e-9);
  assert.ok(edge.elo > 30 && edge.se > 0);
  assert.equal(homeEdge(games, () => null, 3), null, 'no side of the host');
  // Odds 0.712 and 0.715 for the first side, 0.288 for the second's: one bin, the favourite's 0.71–0.72.
  const bins = favouriteBins([{ bestOf: 3, odds: 0.712, won: [2, 0] }, { bestOf: 3, odds: 0.715, won: [1, 2] }, { bestOf: 3, odds: 0.288, won: [0, 2] },
    { bestOf: 5, odds: 0.605, won: [2, 3] }, { bestOf: 3, odds: 0.712, won: [1, 1] }]);
  assert.deepEqual(bins.bo3, [[21, 3, 2, 2, 0]], 'two favourites swept, one lost 1–2; an unfinished series is left out');
  assert.deepEqual(bins.bo5, [[10, 1, 0, 0, 0]]);
});

test('a nation fields its five best, the strength their mean; one with fewer than five fields none', () => {
  const players = [...Array.from({ length: 7 }, (_, i) => ({ key: `f${i}`, name: `F${i}`, nation: '250', elo: 2400 - 25 * i, rating: 94 - i })),
    ...Array.from({ length: 4 }, (_, i) => ({ key: `g${i}`, name: `G${i}`, nation: '276', elo: 2300, rating: 90 }))];
  const nations = nationsOf(players, { teamSize: 7, lineup: 5, sport });
  assert.deepEqual(nations.map(n => [n.id, n.str, n.squad.length, n.players]), [['250', 92, 7, 7]]);
});

test('the built-in nations are the committed snapshot\'s, byte for byte', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = execFileSync(process.execPath, ['scripts/build-valorant.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /Verified the Valorant nations byte for byte/);
  for (const [id, [str, count, squad]] of Object.entries(ROSTERS)) {
    assert.ok(count >= 5 && count <= 7 && squad.length === count, id);
    assert.ok(squad.every(([, pos, rating]) => pos === 'PLR' && rating > 20 && rating < 110), id);
    const best = squad.map(p => p[2]).sort((a, b) => b - a).slice(0, 5);
    assert.ok(Math.abs(str - best.reduce((sum, r) => sum + r, 0) / 5) < 0.06, `${id}: the five best's mean`);
  }
});

// ---------- the sport ----------

test('Valorant is an esport after Rocket League, nations only, Great Britain as one, a tile of its own', () => {
  // Its place after Rocket League, not a fixed index: another esport may come in between.
  assert.ok(SPORT_LIST.includes(sport) && SPORT_LIST.indexOf(sport) > SPORT_LIST.indexOf(getSport('rocket-league')));
  assert.equal(sport.nationsOnly, true);
  assert.deepEqual(sport.clubs, []);
  assert.equal(sport.playsAs['826'].code, 'GBR');
  assert.equal(SPORT_NOTES.valorant, 'Nations');
  assert.equal(teamSportId({ sport: 'valorant', squad: [{ pos: 'PLR' }] }), 'valorant');
  assert.deepEqual([MAPS, TO_WIN, BLOCK, LENGTH], [3, 2, 26, 52]);
  assert.deepEqual([clockLabel(sport, 1), clockLabel(sport, 14), clockLabel(sport, 26), clockLabel(sport, 27), clockTick(sport, 26)],
    ['M1 R1', 'M1 R14', 'M1 OT', 'M2 R1', 'M1']);
  assert.equal(mapAt(78), 3);
  const setup = buildSetupModel({ sport: 'valorant', layer: 'clubs' }, {});
  assert.equal(setup.nationsOnly, true);
  assert.equal(setup.layer, 'nations', 'no clubs to play');
  assert.deepEqual(readChallenge('?sport=valorant&teams=clubs').setup.layer, 'nations');
  assert.equal(homeOffered('valorant'), true, 'the real LANs show a host nation\'s edge (HOME_EDGE)');
  assert.equal(signingsOffered('valorant'), false, 'any player plays any place: the best-rated is the best fit');
});

test('a round\'s odds: the pistol even, the next round the pistol winner\'s, the bonus round and the broken buy, then a lean', () => {
  assert.equal(roundOdds(0, 1, null, null), 0.5);
  assert.ok(Math.abs(roundOdds(0, 2, 'A', null) - 1 / (1 + Math.exp(-PISTOL_FOLLOW))) < 1e-12);
  assert.ok(Math.abs(roundOdds(0, 3, 'A', 'A') - 1 / (1 + Math.exp(BONUS_ROUND))) < 1e-12, 'the bonus round');
  assert.ok(Math.abs(roundOdds(0, 3, 'D', 'A') - 1 / (1 + Math.exp(BROKEN_BUY))) < 1e-12, 'the pistol winner lost the second');
  assert.ok(Math.abs(roundOdds(0, 7, 'A', 'D') - 1 / (1 + Math.exp(-MOMENTUM))) < 1e-12);
  assert.equal(roundOdds(0, 13, 'A', 'A'), 0.5, 'the second half\'s pistol');
  assert.equal(roundOdds(0.4, 25, 'A', 'A'), 1 / (1 + Math.exp(-0.4)), 'overtime: no economy');
  assert.ok(Math.abs(overtimeOdds(0) - 0.5) < 1e-12);
});

test('every map is the favourite\'s with exactly Elo\'s odds, and its rounds follow them', () => {
  for (const odds of [0.5, 0.62, 0.78, 0.93]) {
    const beta = mapBeta(odds);
    assert.ok(Math.abs(chanceFrom(mapTable(beta), 0, 0) - odds) < 1e-4, `${odds}`);
    const rng = makeRng(Math.round(odds * 1000));
    const won = tally(20000, () => { const { rounds } = playMap(rng, beta); return rounds.filter(r => r === 'A').length > rounds.length / 2; });
    assert.ok(Math.abs(won - odds) < 0.015, `${odds}: played ${won}`);
  }
  // Between equals: a map runs about twenty-two rounds, and goes to overtime about one in eight.
  const { rounds, overtime } = mapMeans(0);
  assert.ok(rounds > 21 && rounds < 22.5, `${rounds}`);
  assert.ok(overtime > 0.1 && overtime < 0.16, `${overtime}`);
  assert.equal(mapOdds(4).toFixed(2), '0.64');
});

test('the full series agrees with the score-only path, and its events are the pistols, twelve all and each map\'s end', () => {
  const a = team('fra', [92, 90, 88, 86, 85, 80, 79]), d = team('esp', [88, 87, 86, 85, 83, 80, 78]);
  const prepared = prepareMatch(a, d, 88.2, 85.8);
  assert.equal(prepared.series.toWin, 2);
  for (let seed = 1; seed < 60; seed++) {
    const quick = sampleResult(makeRng(seed), prepared, 6);
    const full = simulateSeries(makeRng(seed), prepared, 6);
    assert.deepEqual([full.ga, full.gd, full.winner], [quick.ga, quick.gd, quick.winner], `seed ${seed}`);
    const ends = full.ev.filter(e => e.pts === 1);
    assert.equal(ends.length, full.ga + full.gd);
    assert.deepEqual(ends.map(e => e.game), ends.map((e, i) => i + 1));
    for (const e of full.ev) {
      assert.ok(e.m > (e.game - 1) * BLOCK && e.m <= e.game * BLOCK, 'within its map\'s block');
      assert.ok(MAP_POOL.includes(e.map));
      if (e.kind === 'pistol') assert.ok(e.round === 1 || e.round === HALF + 1);
      if (e.kind === 'map') assert.ok(e.own === 13 || (e.own > 13 && e.own - e.opp === 2), `${e.own}–${e.opp}`);
    }
    assert.equal(new Set(ends.map(e => e.map)).size, ends.length, 'three different maps');
  }
});

test('the feed names the pistols\' winners, the side that levels at twelve all, and each map with its best player', () => {
  assert.equal(sport.formatEvent({ m: 1, pts: 0, game: 1, kind: 'pistol', name: 'aspas', score: '1–0' }, 'BRA').text, 'PISTOL — aspas (BRA) 1–0');
  assert.equal(sport.formatEvent({ m: 24, pts: 0, game: 1, kind: 'overtime', score: '12–12' }, 'BRA').text, 'OVERTIME — BRA level it 12–12');
  assert.equal(sport.formatEvent({ m: 26, pts: 1, game: 1, kind: 'map', map: 'Lotus', name: 'aspas', score: '14–12', ot: true }, 'BRA').text,
    'LOTUS — BRA 14–12 OT · aspas');
  assert.equal(sport.formatEvent({ m: 30, pts: 1, game: 2, kind: 'map', map: 'Haven', name: 'Less', score: '13–9' }, 'BRA').when, 'M2');
  const shown = [{ tid: 'bra', name: 'aspas', pts: 0 }, { tid: 'bra', name: 'Erick Santos', pts: 1 }, { tid: 'bra', name: 'Less', pts: 1 }];
  assert.equal(scorersLine(shown, 'bra', {}, 'valorant'), 'Santos · Less');
});

test('the live chart: the series\' odds at the start, each map\'s state at its events, the winner\'s at the end', () => {
  const a = team('fra', [92, 90, 88, 86, 85]), d = team('esp', [86, 85, 84, 83, 82]);
  const model = liveModelFor(sport, a, d, 88.2, 84, 6);
  assert.equal(model.kind, 'rounds');
  assert.ok(isLiveModel(model));
  const start = winProbabilityAt(model, 0, 0);
  const rng = makeRng(3);
  const quick = tally(20000, () => sampleResult(rng, prepareMatch(a, d, 88.2, 84), 6).ga === 2);
  assert.ok(Math.abs(start - quick) < 0.015, `chart ${start}, played ${quick}`);
  const full = simulateSeries(makeRng(9), prepareMatch(a, d, 88.2, 84), 6);
  const events = full.ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? 'fra' : 'esp' }));
  const series = winSeries({ model, goals: events, aId: 'fra', dId: 'esp', minute: 99, final: { winnerId: full.winner === 'fra' ? 'fra' : 'esp' } });
  assert.equal(series[0].p.toFixed(6), start.toFixed(6));
  assert.equal(series.at(-1).p, full.ga === 2 ? 1 : 0);
  const domain = chartDomain(model, 80);
  assert.deepEqual(domain.ticks.slice(0, 3), [0, 26, 52]);
});

test('the squad screen draws the map, the five who play on it, and the team\'s and best player\'s strength', () => {
  const nation = buildTeam(Object.keys(ROSTERS)[0], makeRng(1), sport);
  assert.ok(nation.squad.every(player => player.pos === 'PLR' && !player.gen), 'nobody invented');
  const lineup = selectLineup(nation);
  assert.equal(lineup.slots.length, 5);
  const profile = valorantProfile(lineup);
  assert.ok(profile.best >= profile.team);
  const fra = team('fra', [92, 90, 88, 86, 85, 70]);
  const view = buildSquad({ teams: { fra }, aliveIds: ['fra'], history: [] }, { sport }, 'fra');
  assert.equal(view.layout, 'spike');
  assert.deepEqual(valorantProfile(selectLineup(fra)), { team: 88.2, best: 92 });
  assert.equal(selectLineup(fra).starters.length, 5);
});
