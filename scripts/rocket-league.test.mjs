// Rocket League (docs/design/rocket-league.md): Liquipedia's export read without fetching anything, the player Elo built
// from its series, the national teams, the best-of-seven series with Elo's own odds in every game, its events, its live
// win probability and its place among the sports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS } from '../src/data/rosters.rocket-league.js';
import { buildTeam, makeRng, selectLineup, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, SPORT_LIST } from '../src/sports/index.js';
import {
  BLOCK, chanceFrom, GAMES, gameAt, gameOdds, gameRates, gameTable, HOME_EDGE, overtimeClock, prepareMatch, rocketLeague,
  rocketLeagueProfile, sampleResult, SERIES_MODEL, SLICES, TO_WIN,
} from '../src/sports/rocketLeague.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
import { buildSetupModel, signingsOffered, SPORT_NOTES } from '../src/screens/setup/setupModel.js';
import { automaticAcquisition } from '../src/engine/campaignExperience.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import {
  allTemplates, gameOf, normalTitle, parseTemplates, personOf, plainText, readExport, rostersOf, seriesOf, subpagesOf, teamKeys,
  tournamentOf, wikiDate,
} from './lib/liquipedia.mjs';
import {
  abbreviationScore, baseTeamName, expected, foldPlayers, gameRating, homeEdge, isRegionFlag, kFactor, LINEUP, looseKey, MIN_PLAYERS,
  nationalTeams, nationOfFlag, nationsOf, playerOf, ratedPlayers, readTournaments, regionalStarts, runElo, seriesInOrder, startersOf,
  START, TEAM_SIZE,
} from './lib/rocket-league.mjs';

const sport = getSport('rocket-league');
const team = (id, ratings) => ({ id, name: id, code: id.slice(0, 3).toUpperCase(), sport: 'rocket-league',
  squad: ratings.map((rating, i) => ({ name: `${id} Player${i + 1}`, pos: 'PLR', rating })) });
const tally = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };

// ---------- the export ----------

const xml = (...pages) => `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">\n${pages.map(([title, text, ns = 0]) =>
  `<page><title>${title.replace(/&/g, '&amp;')}</title><ns>${ns}</ns><id>1</id><revision><id>9</id>`
  + `<timestamp>2026-11-12T08:00:00Z</timestamp><text bytes="1" xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</text></revision></page>`).join('\n')}\n</mediawiki>`;

const MAJOR = 'Rocket League Championship Series/2026/Paris Major';
const MAJOR_TEXT = `{{Infobox league
|name=RLCS 2026 - Paris Major
|series=Rocket League Championship Series
|liquipediatier=1
|mode=3v3
|type=Offline
|country=France
|city=Paris
|sdate=2026-05-21
|edate=2026-05-24
}}
<!-- {{TeamCard|team=Ghost|p1=A|p2=B|p3=C}} -->
==Participants==
{{TeamCard columns start}}
{{TeamCard|team=Team Vitality|p1=Zen|p1flag=fr|p2=Alpha54|p2flag=fr|p3=Radosin|p3flag=fr|s4=Sub|s4flag=fr|c=Ferra|cflag=fr}}
{{TeamCard|team=NRG|p1=Daniel|p1flag=us|p1link=Daniel (American player)|p2=Atomic|p2flag=us|p3=BeastMode|p3flag=us}}
{{TeamCard columns end}}
{{Tabs static|name1=Overview|link1=${MAJOR}|name2=Playoffs|link2=${MAJOR}/Playoffs}}
==Swiss Stage==
{{Matchlist|id=AbCdEfGhIj|title=Round 1
|M1={{Match|bestof=5|date=May 21, 2026 - 12:00 {{Abbr/CEST}}
  |opponent1={{TeamOpponent|team vitality}}
  |opponent2={{TeamOpponent|nrg}}
  |map1={{Map|map=DFH Stadium|score1=3|score2=1}}
  |map2={{Map|map=[[Mannfield|Mannfield (Night)]]|score1=2|score2=3|ot=true|otlength=+1:12}}
  |map3={{Map|score1=4|score2=0|winner=1}}
  |map4={{Map|score1=2|score2=1}}
}}
|M2={{Match|bestof=5|opponent1={{TeamOpponent|vitality|score=W}}|opponent2={{TeamOpponent|nrg|score=FF}}}}
|M3={{Match|bestof=5|opponent1={{TeamOpponent|tbd}}|opponent2={{TeamOpponent|nrg}}}}
}}`;
const OPEN = 'Rocket League Championship Series/2026/Europe/Open 1';
const OPEN_TEXT = `{{Infobox league|name=RLCS 2026 - Europe Open 1|liquipediatier=2|type=Online|sdate=2026-01-10|edate=2026-01-12}}
{{TeamCard|team=Karmine Corp|p1=Vatira|p1flag=fr|p2=Atow|p2flag=be|p3=Rise|p3flag=uk}}
{{TeamCard|team=Team Vitality|p1=Zen|p1flag=fr|p2=Alpha54|p2flag=fr|p3=Radosin|p3flag=fr}}
{{Bracket|Bracket/2|id=XyZ|R1M1={{Match|bestof=7|date=2026-01-12 - 18:00
  |opponent1={{TeamOpponent|karmine corp}}|opponent2={{TeamOpponent|team vitality}}
  |map1={{Map|score1=1|score2=0}}|map2={{Map|score1=1|score2=2}}|map3={{Map|score1=3|score2=2|ot=1}}
  |map4={{Map|score1=0|score2=2}}|map5={{Map|score1=4|score2=1}}|map5={{Map|score1=9|score2=9}}|map6={{Map|score1=2|score2=0}}}}}}`;
const DUOS = ['Some 2v2 Cup', '{{Infobox league|name=2v2|liquipediatier=2|mode=2v2|sdate=2026-02-01}}{{Match|opponent1={{TeamOpponent|a}}|opponent2={{TeamOpponent|b}}|winner=1}}'];

test('the export is read as MediaWiki writes it: titles, entities and the current revision', () => {
  const pages = readExport(xml([MAJOR, MAJOR_TEXT], [OPEN, OPEN_TEXT], ['Template:TeamCard', 'x', 10]));
  assert.deepEqual(pages.map(page => [page.title, page.ns]), [[MAJOR, 0], [OPEN, 0], ['Template:TeamCard', 10]]);
  assert.equal(pages[0].text, MAJOR_TEXT, 'entities decoded, every character back');
  assert.equal(pages[0].timestamp, '2026-11-12T08:00:00Z');
  assert.equal(normalTitle('rocket_League  Championship_Series/2026'), 'Rocket League Championship Series/2026');
});

test('templates nest, and a link\'s pipe or an equals sign inside one splits nothing', () => {
  const [map] = parseTemplates('{{Map|map=[[Mannfield|Mannfield (Night)]]|score1={{abbr|3|three}}|score2=1|note=a=b}}');
  assert.equal(map.key, 'map');
  assert.deepEqual(Object.keys(map.params), ['map', 'score1', 'score2', 'note']);
  assert.equal(plainText(map.params.map), 'Mannfield (Night)');
  assert.equal(map.params.note, 'a=b');
  assert.equal(allTemplates('{{A|x={{B|y={{C}}}}}}').map(t => t.key).join(), 'a,b,c');
  assert.equal(parseTemplates('{{Unclosed|a=1').length, 0, 'a template that never closes ends the scan');
  assert.deepEqual(['2026-05-21 - 12:00 {{Abbr/CEST}}', 'May 21, 2026 - 12:00', '21 May 2026', '2026-05-??', 'soon'].map(wikiDate),
    ['2026-05-21', '2026-05-21', '2026-05-21', '2026-05-01', null]);
});

test('an event\'s infobox gives its tier, mode, region, dates and host', () => {
  const [major, open] = readExport(xml([MAJOR, MAJOR_TEXT], [OPEN, OPEN_TEXT]));
  assert.deepEqual(tournamentOf(major), { name: 'RLCS 2026 - Paris Major', tier: 1, tierType: null, mode: '3v3', start: '2026-05-21',
    end: '2026-05-24', region: null, type: 'Offline', country: 'France', city: 'Paris', series: 'Rocket League Championship Series' });
  assert.equal(tournamentOf(open).region, 'EU', 'the region its title names');
  assert.equal(tournamentOf(open).mode, '3v3', 'unnamed, the RLCS\'s own');
  assert.equal(tournamentOf({ title: 'X', text: 'no infobox' }), null);
});

test('a team card gives three starters in order, a substitute, each one\'s flag and link, and no coach', () => {
  const [vitality, nrg] = rostersOf(MAJOR_TEXT);
  assert.equal(rostersOf(MAJOR_TEXT).length, 2, 'a commented-out card is no team');
  assert.equal(vitality.team, 'Team Vitality');
  assert.deepEqual(vitality.keys, ['teamvitality', 'vitality']);
  assert.deepEqual(vitality.players.map(p => [p.name, p.flag, p.sub]), [['Zen', 'fr', false], ['Alpha54', 'fr', false],
    ['Radosin', 'fr', false], ['Sub', 'fr', true]]);
  assert.equal(nrg.players[0].link, 'Daniel (American player)');
  assert.deepEqual(teamKeys('Karmine Corp Esports'), ['karminecorpesports', 'karminecorp']);
});

test('Rocket League\'s card conventions: an override flag, substitutes flagged by place, nobody who left, no coach', () => {
  // As the wiki's Module:TeamCard/Legacy/Custom reads a card: sub4's flag and link are p4flag and p4link, ex's p6flag.
  const card = '{{TeamCard|team=Gentle Mates|p1=Vatira|p1flag=fr|p1flag_o=be|p2=Seikoo|p2dnp=true|p3=Juicy|p3flag=fr'
    + '|sub4=Extra|p4flag=es|p4link=Extra (Spanish player)|ex=Old|p6flag=fr|c=Coachy|cflag=fr}}';
  const [mates] = rostersOf(card);
  assert.deepEqual(mates.players.map(p => [p.name, p.flag, p.sub, !!p.dnp]),
    [['Vatira', 'be', false, false], ['Seikoo', null, false, true], ['Juicy', 'fr', false, false], ['Extra', 'es', true, false]]);
  assert.equal(mates.players[3].link, 'Extra (Spanish player)');
  assert.deepEqual(startersOf(mates).map(p => p.name), ['Vatira', 'Juicy', 'Extra'], 'a starter who sat out gives way to the substitute');
  // A stand-in for an empty place plays there.
  assert.deepEqual(rostersOf('{{TeamCard|team=X|p1=A|p2=B|sub3=C|p3flag=us}}')[0].players.map(p => [p.name, p.flag, p.sub]),
    [['A', null, false], ['B', null, false], ['C', 'us', false]]);
  assert.deepEqual(rostersOf('{{TeamCard|team=X|p1=A|p2=B|p2leave=true|p3=C}}')[0].players.map(p => p.name), ['A', 'C']);
  // The newer form: TeamParticipants' opponents and persons.
  const participants = '{{TeamParticipants|{{Opponent|falcons|players={{Persons|{{Person|Rw9|flag=sa}}|{{Person|Kiileerrz|flag=fr}}'
    + '|{{Person|Trk511|flag=sa}}|{{Person|Ferra|flag=fr|role=coach}}}}}}}}';
  const [falcons] = rostersOf(participants);
  assert.equal(falcons.team, 'falcons');
  assert.deepEqual(falcons.players.map(p => [p.name, p.flag]), [['Rw9', 'sa'], ['Kiileerrz', 'fr'], ['Trk511', 'sa']]);
});

test('a card without a flag leaves it to the player\'s own page, as the wiki does', () => {
  assert.deepEqual(personOf({ title: 'Zen_(French player)', text: '{{Infobox player|id=Zen|country=France|team=Team Vitality}}' }),
    { title: 'Zen (French player)', name: 'Zen', country: 'france' });
  assert.equal(personOf({ title: 'Team Vitality', text: '{{Infobox team|name=Team Vitality}}' }), null);
  const zen = { key: 'Zen (French player)', name: 'Zen', elo: 1900, games: 50, wins: 30, last: '2026-09-01', flags: new Map(),
    regions: new Map([['EU', 50]]), team: 'Team Vitality' };
  const [rated] = ratedPlayers(new Map([[zen.key, zen]]), '2026-11-01', new Map([[zen.key, 'france']]));
  assert.deepEqual([rated.flag, rated.nation], ['france', '250']);
  assert.equal(ratedPlayers(new Map([[zen.key, zen]]), '2026-11-01')[0].flag, null, 'no page, no flag');
  // A page and a card: the card's flag stands.
  const carded = { ...zen, flags: new Map([['be', 3]]) };
  assert.equal(ratedPlayers(new Map([[zen.key, carded]]), '2026-11-01', new Map([[zen.key, 'france']]))[0].flag, 'be');
  // Only a recent, seasoned player is rated.
  assert.equal(ratedPlayers(new Map([[zen.key, { ...zen, games: 5 }]]), '2026-11-01').length, 0);
  assert.equal(ratedPlayers(new Map([[zen.key, zen]]), '2028-01-01').length, 0);
});

test('a series gives each game\'s goals and overtime, its winner from the games, and leaves out forfeits and the undecided', () => {
  const [first, forfeit, ...rest] = seriesOf(MAJOR_TEXT);
  assert.equal(rest.length, 0, 'an opponent still to be decided plays nothing');
  assert.deepEqual(first.opponents.map(o => o.team), ['team vitality', 'nrg']);
  assert.deepEqual(first.games.map(g => [g.goals, g.winner, g.ot]), [[[3, 1], 1, false], [[2, 3], 2, true], [[4, 0], 1, false], [[2, 1], 1, false]]);
  assert.deepEqual([first.winner, first.bestOf, first.date], [1, 5, '2026-05-21']);
  assert.deepEqual([forfeit.walkover, forfeit.winner], [true, 1], 'Vitality went through on a forfeit');
  assert.deepEqual(forfeit.games, []);
  assert.equal(gameOf('{{Map|score1=2|score2=2}}'), null, 'a level game with no winner is none');
  assert.deepEqual(subpagesOf({ title: MAJOR, text: MAJOR_TEXT }), new Set([`${MAJOR}/Playoffs`]));
});

test('only 3v3 events of the counted tiers play, their stages and teams found, in date order', () => {
  const { tournaments, missing, skipped } = readTournaments(readExport(xml([MAJOR, MAJOR_TEXT], [OPEN, OPEN_TEXT], DUOS)));
  assert.deepEqual(tournaments.map(t => t.title), [OPEN, MAJOR], 'by their first day');
  assert.deepEqual(skipped.mode, ['Some 2v2 Cup']);
  assert.deepEqual(missing, [`${MAJOR}/Playoffs`], 'a stage linked but not exported');
  const { series, unplayable } = seriesInOrder(tournaments);
  assert.deepEqual(unplayable, []);
  assert.deepEqual(series.map(s => [s.date, s.names.join(' v '), s.games.length, s.host]), [
    ['2026-01-12', 'karmine corp v team vitality', 5, null],
    ['2026-05-21', 'team vitality v nrg', 4, '250'],
  ]);
  assert.deepEqual(series[1].teams[0].map(p => p.name), ['Zen', 'Alpha54', 'Radosin'], 'the three starters, not the substitute');
});

// ---------- the ratings ----------

test('the Elo is a team\'s: each game moves its three by the same amount, the winner\'s gain the loser\'s loss', () => {
  const { tournaments } = readTournaments(readExport(xml([MAJOR, MAJOR_TEXT], [OPEN, OPEN_TEXT])));
  const { series } = seriesInOrder(tournaments);
  const { players, games } = runElo(series);
  assert.equal(games, 9);
  const elo = name => [...players.values()].find(p => p.name === name).elo;
  assert.equal(elo('Zen'), elo('Alpha54'));
  assert.equal(elo('Daniel'), elo('Atomic'));
  assert.ok(elo('Zen') > START && elo('Daniel') < START, 'Vitality won both series');
  // One game between newcomers: what the winners gain the losers lose, K for K.
  const one = runElo([{ ...series[1], games: [series[1].games[0]] }]).players;
  const moves = [...one.values()].map(p => p.elo - START);
  assert.ok(Math.abs(moves.reduce((sum, x) => sum + x, 0)) < 1e-9, `zero-sum: ${moves}`);
  assert.equal(expected(0), 0.5);
  assert.ok(Math.abs(expected(400) - 10 / 11) < 1e-12);
  assert.ok(kFactor(0) > kFactor(100) && kFactor(100) > kFactor(10000) && kFactor(1e9) === 8);
});

test('a region whose teams beat Elo\'s odds at the internationals starts its newcomers higher', () => {
  // Two regions of four teams each, every team the same inside its region; region B's teams win every international game.
  const roster = name => ({ team: name, players: [1, 2, 3].map(i => ({ name: `${name}${i}`, flag: 'fr' })) });
  const teams = [...'abcd'].map(t => roster(`A${t}`)).concat([...'abcd'].map(t => roster(`B${t}`)));
  const series = [];
  let day = 1;
  const date = () => `2026-01-${String(day++).padStart(2, '0')}`;
  for (let round = 0; round < 3; round++) {
    for (const [x, y, region] of [[0, 1, 'EU'], [2, 3, 'EU'], [4, 5, 'NA'], [6, 7, 'NA']]) {
      series.push({ date: date(), event: `r${round}`, region, international: false, host: null, page: 'p', index: 0,
        names: [teams[x].team, teams[y].team], teams: [teams[x].players, teams[y].players], rosters: [teams[x], teams[y]],
        games: [{ winner: 1 }, { winner: 2 }], winner: 1 });
    }
    for (const [x, y] of [[0, 4], [1, 5], [2, 6], [3, 7]]) {
      series.push({ date: date(), event: `world${round}`, region: null, international: true, host: null, page: 'p', index: 0,
        names: [teams[x].team, teams[y].team], teams: [teams[x].players, teams[y].players], rosters: [teams[x], teams[y]],
        games: [{ winner: 2 }, { winner: 2 }, { winner: 2 }], winner: 2 });
    }
  }
  const starts = regionalStarts(series, { least: 1 });
  assert.ok(starts.NA > starts.EU, `NA ${starts.NA} over EU ${starts.EU}`);
});

test('the home crowd\'s edge reads only LAN games with one side of the host nation', () => {
  const nation = key => ('abc'.includes(key) ? '250' : '840');
  const lan = [{ keys: [['a', 'b', 'c'], ['d', 'e', 'f']], host: '250', surprise: 0.2 },
    { keys: [['d', 'e', 'f'], ['a', 'b', 'c']], host: '250', surprise: -0.1 },
    { keys: [['d', 'e', 'f'], ['a', 'b', 'c']], host: '840', surprise: 0.3 },
    { keys: [['a', 'b', 'c'], ['a', 'b', 'c']], host: '250', surprise: 0.5 }];
  const edge = homeEdge(lan, nation);
  assert.equal(edge.games, 3, 'both sides French at a French LAN: nobody is at home');
  assert.ok(Math.abs(edge.surprise - 0.2) < 1e-9, 'the French at home +0.2 and +0.1, the Americans at home +0.3');
  assert.equal(homeEdge([], nation), null);
});

test('Liquipedia\'s flags land on the game\'s nations: its own codes, territories, and no nation for a region', () => {
  assert.deepEqual(['fr', 'us', 'uk', 'en', 'sco', 'wales', 'nir', 'ksa', 'sa', 'br', 'France', 'Saudi Arabia', 'hk', '', null].map(nationOfFlag),
    ['250', '840', '826', '826', '826', '826', '826', '682', '682', '076', '250', '682', null, null, null]);
  // The export's own: England, Scotland, Wales and Northern Ireland's codes, Réunion and Curaçao, and region flags.
  assert.deepEqual(['uken', 'uksc', 'ukwa', 'ukni', 're', 'Réunion', 'curacao', 'Türkiye'].map(nationOfFlag),
    ['826', '826', '826', '826', '250', '250', '528', '792']);
  for (const region of ['usca', 'north america', 'eu', 'mena', 'oce', 'sam']) {
    assert.equal(nationOfFlag(region), null, region);
    assert.equal(isRegionFlag(region), true, region);
  }
  assert.deepEqual([gameRating(1500), gameRating(1900), gameRating(2100), gameRating(2433)], [58, 74, 82, 95]);
  const row = ['Zen', 'Zen', 'fr', '250', 'France', 1950.4, 400, 280, '2026-09-14', 'Team Vitality', 'EU'];
  const zen = playerOf(row, '2026-11-12', 1);
  assert.deepEqual([zen.rating, zen.nation, zen.source.source, zen.source.rawRating, zen.source.nationalTeam, zen.source.url],
    [76, '250', 'liquipedia', 1950.4, 'France', 'https://liquipedia.net/rocketleague/Zen']);
  const french = [1, 2, 3, 4, 5].map(i => playerOf([`F${i}`, `F${i}`, 'fr', '250', null, 1800 - i * 10, 100, 50, '2026-09-01', 'X', 'EU'], 'd', i));
  const two = [1, 2].map(i => playerOf([`D${i}`, `D${i}`, 'de', '276', null, 1700, 100, 50, '2026-09-01', 'X', 'EU'], 'd', i));
  const nations = nationsOf([zen, ...french, ...two]);
  assert.deepEqual(nations.map(n => [n.id, n.squad.length, n.players]), [['250', TEAM_SIZE, 6]], `Germany's two are not ${MIN_PLAYERS}`);
  // Zen's 76 and the next two Frenchmen's 1790 and 1780: 70 and 69.
  assert.equal(nations[0].str, Math.round((76 + 70 + 69) / LINEUP * 10) / 10, 'the mean of the three who play');
});

test('a player\'s spellings fold into one key, never across a clash of nations or a disambiguated page', () => {
  const card = (team, players, nations = false) => ({ title: team, start: '2026-01-01', nations, series: [],
    rosters: [{ team, keys: teamKeys(team), players: players.map(([name, flag, link]) => ({ name, flag, link: link ?? null, sub: false })) }] });
  const events = [
    card('Karmine Corp', [['Atow.', null], ['Vatira', 'fr'], ['Atow.', null]]),
    card('Karmine Corp', [['Atow.', null], ['Vatira', 'fr']]),
    card('Belgium', [['Atow', null], ['Alpha54', 'be']], true),
    card('Italy', [['dead', 'it']]),
    card('Israel', [['Dead', 'il', 'Dead (Israeli Player)']], true),
    card('Team A', [['Fade', 'us']]),
    card('Team B', [['fade.', 'pr']]),
  ];
  const folded = foldPlayers(events, new Map([['Old name', 'Vatira']]));
  assert.equal(folded.get('Atow'), 'Atow.', 'the spelling the rosters use most');
  assert.equal(events[2].rosters[0].players[0].link, 'Atow.');
  assert.equal(folded.has('Dead (Israeli Player)'), false, 'a disambiguated page meets no namesake');
  assert.equal(folded.has('Dead'), false);
  assert.ok(!folded.has('Fade') && !folded.has('Fade.'), 'an American and a Puerto Rican stay two players');
  assert.equal(looseKey('Ry4n.µ'), looseKey('ry4n'));
});

test('national teams give a player\'s nation, the latest before any flag; templates match their event\'s rosters', () => {
  const event = (title, start, team, players, nations = true) => ({ title, start, nations, series: [],
    rosters: [{ team, keys: teamKeys(team), players: players.map(name => ({ name, flag: 'fr', sub: false })) }] });
  const national = nationalTeams([
    event('FIFAe World Cup/2025', '2025-08-01', 'France', ['Kiileerrz', 'Vatira']),
    event('Esports Nations Cup/2026', '2026-08-01', 'Saudi Arabia', ['Kiileerrz']),
    event('Some Cup', '2026-09-01', 'Spain', ['Vatira'], false),
  ]);
  assert.deepEqual([national.get('Kiileerrz').nation, national.get('Vatira').nation], ['682', '250']);
  assert.equal(national.get('Kiileerrz').team, 'Saudi Arabia');
  // Team templates: the event's roster by abbreviation, its name without a region tag.
  assert.deepEqual([['nip', 'Ninjas in Pyjamas'], ['kc', 'Karmine Corp'], ['vit', 'Team Vitality'], ['flcn', 'Team Falcons'],
    ['ssg', 'Spacestation Gaming'], ['zz', 'Team Vitality']].map(([short, name]) => abbreviationScore(short, name) > 0),
  [true, true, true, true, true, false]);
  assert.equal(baseTeamName('Genesis (South American Team)'), 'Genesis');
  assert.equal(baseTeamName('synergy eu'), 'synergy');
});

// ---------- the national teams ----------

test('the national teams rebuild byte for byte from the committed snapshot, and nothing is estimated', t => {
  if (!existsSync(new URL('./data/rocket-league-elo.json', import.meta.url))) {
    t.skip('no snapshot yet: npm run sync:rocket-league needs the Liquipedia export');
    return;
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-rocket-league.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
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

// ---------- the series ----------

test('each game is won with Elo\'s own odds, the goals split to make it so', () => {
  for (const gap of [-12, -4, 0, 1, 4, 8, 20]) {
    const odds = gameOdds(gap);
    const [a, d] = gameRates(odds);
    assert.ok(Math.abs(chanceFrom(gameTable(a, d), 0, 0) - odds) < 2e-4, `gap ${gap}`);
    assert.ok(gap > 0 ? a > d : gap < 0 ? a < d : Math.abs(a - d) < 1e-9, `gap ${gap}: the favourite scores more`);
  }
  assert.ok(Math.abs(gameOdds(4) - 1 / (1 + 10 ** (-0.25))) < 1e-12, 'a rating point is 25 Elo points');
});

test('a series is best of seven: the winner takes four, and both paths give the same score for a seed', () => {
  const A = team('fra', [84, 82, 80]), D = team('usa', [82, 80, 78]);
  const prepared = prepareMatch(A, D);
  for (let seed = 1; seed <= 200; seed++) {
    const fast = sampleResult(makeRng(seed), prepared, 6);
    const full = rocketLeague.simulate(makeRng(seed), A, D, 6);
    assert.deepEqual([full.ga, full.gd, full.winner], [fast.ga, fast.gd, fast.winner], `seed ${seed}`);
    assert.equal(Math.max(full.ga, full.gd), TO_WIN);
    assert.ok(Math.min(full.ga, full.gd) < TO_WIN);
    assert.equal(fast.games.length, full.ga + full.gd);
  }
  const odds = estimateWinProbability({ sport, attacker: A, defender: D, samples: 20000 }).attacker;
  const game = gameOdds(2);
  // Best of seven at a 57% game: about 65% (form widens the spread a little).
  assert.ok(odds > game + 0.04 && odds < game + 0.12, `series ${odds} over the game's ${game}`);
});

test('every game\'s goals add up to its score: regulation in its ten slices, overtime\'s single goal after a level five minutes', () => {
  const A = team('fra', [84, 82, 80]), D = team('usa', [80, 79, 78]);
  let overtime = 0, played = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const result = rocketLeague.simulate(makeRng(seed), A, D, 6);
    const ends = result.ev.filter(e => e.pts > 0);
    assert.equal(ends.length, result.ga + result.gd);
    assert.deepEqual([ends.filter(e => e.tid === 'fra').length, ends.filter(e => e.tid === 'usa').length], [result.ga, result.gd]);
    for (const end of ends) {
      played++;
      const start = (end.game - 1) * BLOCK;
      const goals = result.ev.filter(e => e.pts === 0 && e.game === end.game);
      const by = id => goals.filter(e => e.tid === id).length;
      const [w, l] = end.score.split('–').map(Number);
      assert.deepEqual([by(end.tid), goals.length - by(end.tid)], [w, l], `seed ${seed} game ${end.game}`);
      assert.ok(w > l);
      for (const goal of goals) assert.ok(goal.m > start && goal.m <= start + BLOCK, 'inside its game\'s block');
      const late = goals.filter(goal => goal.ot);
      if (end.ot) {
        overtime++;
        assert.equal(late.length, 1, 'one overtime goal');
        assert.equal(late[0].tid, end.tid, 'the overtime goal wins it');
        assert.equal(w - l, 1);
        assert.ok(late[0].m > start + SLICES && end.m === late[0].m);
        assert.match(late[0].clock, /^\+\d+:\d\d$/);
      } else {
        assert.equal(late.length, 0);
        assert.equal(end.m, start + SLICES, 'a game decided in regulation ends at five minutes');
        assert.ok(goals.every(goal => goal.m <= start + SLICES));
      }
      assert.ok(goals.some(goal => goal.tid === end.tid && goal.name === end.name), 'the game is named for one of its winner\'s goals');
    }
  }
  assert.ok(overtime / played > 0.1 && overtime / played < 0.3, `overtime ${overtime / played}`);
  assert.equal(overtimeClock(72), '+1:12');
});

test('no home crowd moves a game: the LANs\' host nations did as Elo expected', () => {
  const A = team('fra', [82, 80, 80]), D = team('usa', [80, 80, 80]);
  assert.equal(HOME_EDGE, 0);
  assert.deepEqual(prepareMatch(A, D, undefined, undefined, { home: true }), prepareMatch(A, D));
  assert.equal(sport.homeAdvantage, false, 'the campaign\'s Home advantage is not offered');
});

test('the live chart starts from the series odds, follows each goal and game, and ends on the winner', () => {
  const A = team('fra', [84, 82, 80]), D = team('usa', [80, 79, 78]);
  const model = liveModelFor(sport, A, D, undefined, undefined, 6);
  assert.ok(isLiveModel(model));
  assert.deepEqual([model.kind, model.length, model.ot, model.maxOt, model.toWin, model.regulation], ['series', 48, 12, 3, 4, 10]);
  const odds = estimateWinProbability({ sport, attacker: A, defender: D, samples: 20000 }).attacker;
  assert.ok(Math.abs(winProbabilityAt(model, 0, 0) - odds) < 0.015, `kick-off ${winProbabilityAt(model, 0, 0)} v odds ${odds}`);
  for (let seed = 1; seed <= 40; seed++) {
    const result = rocketLeague.simulate(makeRng(seed), A, D, 6);
    const end = Math.max(...result.ev.map(e => e.m));
    const series = winSeries({ model, goals: result.ev, aId: 'fra', dId: 'usa', minute: end, final: { winnerId: result.winner } });
    assert.equal(series.at(-1).p, result.winner === 'fra' ? 1 : 0);
    // A game won moves the chart its winner's way.
    for (const e of result.ev.filter(event => event.pts > 0 && event.m < end)) {
      const before = series[e.m - 1].p, after = series[e.m].p;
      assert.ok(e.tid === 'fra' ? after >= before - 1e-9 : after <= before + 1e-9, `seed ${seed} at ${e.m}`);
    }
  }
  const domain = chartDomain(model, 60);
  assert.deepEqual(domain.ticks, [0, 12, 24, 36, 48, 60]);
});

test('the live chart\'s game chances are the model\'s: a series of games played from each state wins as often', () => {
  const A = team('fra', [82, 80, 80]), D = team('usa', [80, 80, 79]);
  const model = liveModelFor(sport, A, D, undefined, undefined, 0);
  // At 2–1 in games, 1–0 up halfway through the fourth.
  const goals = [
    { m: 10, tid: 'fra', pts: 1 }, { m: 22, tid: 'usa', pts: 1 }, { m: 34, tid: 'fra', pts: 1 }, { m: 38, tid: 'fra', pts: 0 },
  ];
  const chart = winSeries({ model, goals, aId: 'fra', dId: 'usa', minute: 41 }).at(-1).p;
  const fresh = winSeries({ model, goals: goals.slice(0, 3), aId: 'fra', dId: 'usa', minute: 41 }).at(-1).p;
  assert.ok(chart > fresh, 'a goal up in the game in play is better than level');
  assert.ok(chart > 0.7 && chart < 0.95, `${chart}`);
});

// ---------- the sport among the others ----------

test('Rocket League is the tenth sport, nations only, Great Britain as one, a tile of its own', () => {
  assert.equal(SPORT_LIST.at(-1), sport);
  assert.equal(sport.id, 'rocket-league');
  assert.equal(sport.nationsOnly, true);
  assert.deepEqual(sport.clubs, []);
  assert.equal(sport.playsAs['826'].code, 'GBR');
  assert.equal(SPORT_NOTES['rocket-league'], 'Nations');
  assert.equal(teamSportId({ squad: [{ pos: 'PLR' }] }), 'rocket-league', 'a save without its sport still reads as one');
  assert.deepEqual([GAMES, TO_WIN, BLOCK, SERIES_MODEL.LENGTH], [7, 4, 12, 48]);
  assert.deepEqual([clockLabel(sport, 0), clockLabel(sport, 13), clockLabel(sport, 84), clockTick(sport, 24)], ['G1', 'G2', 'G7', 'G2']);
  assert.equal(gameAt(48), 4);
  const setup = buildSetupModel({ sport: 'rocket-league', layer: 'clubs' }, {});
  assert.equal(setup.nationsOnly, true);
  assert.equal(setup.layer, 'nations', 'no clubs to play');
  assert.deepEqual(readChallenge('?sport=rocket-league&teams=clubs').setup.layer, 'nations');
});

test('the feed names each goal, overtime\'s with its clock, and each game\'s score; the scorers count goals', () => {
  assert.equal(sport.formatEvent({ m: 3, pts: 0, game: 1, name: 'Zen', score: '1–0' }, 'FRA').text, 'GOAL — Zen (FRA) 1–0');
  assert.equal(sport.formatEvent({ m: 23, pts: 0, game: 2, name: 'Zen', score: '3–2', ot: true, clock: '+0:42' }, 'FRA').text,
    'OVERTIME GOAL — Zen (FRA) 3–2 +0:42');
  assert.equal(sport.formatEvent({ m: 23, pts: 1, game: 2, name: 'Zen', score: '3–2', ot: true }, 'FRA').text, 'GAME 2 — FRA 3–2 OT');
  assert.equal(sport.formatEvent({ m: 23, pts: 1, game: 2, name: 'Zen', score: '3–2' }, 'FRA').when, 'G2');
  const shown = [{ tid: 'fra', name: 'Zen Doe', pts: 0 }, { tid: 'fra', name: 'Zen Doe', pts: 0 }, { tid: 'fra', name: 'Al Pha', pts: 0 },
    { tid: 'fra', name: 'Zen Doe', pts: 1 }];
  assert.match(scorersLine(shown, 'fra', {}, 'rocket-league'), /Doe 2 G · .*Pha 1 G/);
});

test('Computer signings is no choice: the best-rated player is always the best fit', () => {
  const teams = Object.keys(ROSTERS).map(id => buildTeam(id, makeRng(1), sport));
  for (const winner of teams) {
    for (const loser of teams) {
      if (winner === loser) continue;
      assert.equal(automaticAcquisition(winner, loser, 'best-fit')?.index, automaticAcquisition(winner, loser, 'highest-rated')?.index,
        `${winner.name} signing from ${loser.name}`);
    }
  }
  assert.equal(signingsOffered('rocket-league'), false);
  assert.ok(signingsOffered('football'));
});

test('the squad screen draws the arena and profiles the team and its best player', () => {
  const nation = team('fra', [84, 82, 80, 70]);
  const view = buildSquad({ teams: { fra: nation }, aliveIds: ['fra'], history: [] }, { sport }, 'fra');
  assert.equal(view.layout, 'arena');
  assert.deepEqual(rocketLeagueProfile(selectLineup(nation)), { team: 82, best: 84 });
  assert.equal(selectLineup(nation).starters.length, 3);
});
