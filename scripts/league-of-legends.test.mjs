// League of Legends (docs/design/league-of-legends.md): gol.gg's pages read from the cache, the player Elo built game by
// game with each player's role, the national teams one player a role, the best-of-five series with Elo's own odds for
// every game, its events, its live win probability and its place among the sports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROSTERS } from '../src/data/rosters.league-of-legends.js';
import { buildTeam, makeRng, outOfPositionPenalty, selectLineup, teamSportId } from '../src/data/teams.js';
import { clockLabel, clockTick, getSport, SPORT_LIST } from '../src/sports/index.js';
import {
  BLOCK, GAMES, gameAt, gameClock, gameOdds, leagueOfLegendsProfile, LENGTH, LENGTH_MEAN, LOSER_KILLS, playGame, prepareMatch, ROLES,
  sampleResult, simulateSeries, TO_WIN, WINNER_KILLS,
} from '../src/sports/leagueOfLegends.js';
import { chartDomain, isLiveModel, liveModelFor, winProbabilityAt, winSeries } from '../src/engine/winProbability.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { scorersLine } from '../src/viewModels/match.js';
import { buildSetupModel, homeOffered, signingsOffered, SPORT_NOTES } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { readGamePage, readMatchList, readPlayerList, readSummaryPage, seasonCode, yearOfSeason } from './lib/golgg.mjs';
import { circuitOf, nationsOf, playerKey, rolesOf, seriesOf } from './lib/league-of-legends.mjs';

const sport = getSport('league-of-legends');
const team = (id, players) => ({ id, name: id, code: id.slice(0, 3).toUpperCase(), sport: 'league-of-legends',
  squad: players.map(([pos, rating], i) => ({ name: `${id} Player${i + 1}`, pos, rating })) });
const tally = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };

// ---------- gol.gg's pages ----------

const MATCH_LIST = `<table><tbody><tr><td class='text-left'><a href='../game/stats/72980/page-summary/' title='T1 vs KT Rolster summary'>T1 vs KT Rolster</a></td><td class='text-right text_defeat'>KT Rolster</td><td class='text-center'>2 - 3</td><td class='text_victory'>T1</td><td class='text-center'>FINALS</td><td class='text-center'>15.20</td><td class='text-center'>2025-11-09</td></tr><tr><td class='text-left'><a href='../game/stats/72866/page-game/' title='VKS vs TSW stats'>VKS vs TSW</a></td><td class='text-right text_victory'>Team Secret Whales</td><td class='text-center'>1 - 0</td><td class='text_defeat'>Vivo Keyd Stars</td><td class='text-center'>ROUND1</td><td class='text-center'>15.20</td><td class='text-center'>2025-10-15</td></tr></tbody></table>`;

const link = (id, name) => `<a title='${name} stats' href='../players/player-stats/${id}/season-ALL/split-ALL/tournament-Worlds/champion-ALL/'>${name}</a>`;
const SEARCH = `options: [ {class:'player',value: 'p_1',name: 'Faker - KR'},{class:'player',value: 'p_2',name: 'Caps - DK'},{class:'player',value: 'p_3',name: 'D\\'Artagnan'} ]`;
const KT = [[5122, 'PerfecT'], [983, 'Cuzz'], [650, 'Bdd'], [2508, 'deokdam'], [4260, 'Peter']];
const T1 = [[1242, 'Doran'], [1258, 'Oner'], [48, 'Faker'], [3247, 'Gumayusi'], [3741, 'Keria']];
const SUMMARY = `${SEARCH}<a href='../teams/team-stats/2493/split-ALL/tournament-Worlds/' title='KT Rolster stats'><img/></a>
  <h1>BO5</h1><a href='../teams/team-stats/2497/split-ALL/tournament-Worlds/' title='T1 stats'><img/></a>
  ${[[2, '36:10'], [1, '42:32'], [1, '36:52'], [2, '29:40'], [2, '36:47']].map(([winner, length]) =>
    `<h1 class='text_${winner === 1 ? 'victory' : 'defeat'}'>${winner === 1 ? 'WIN' : 'LOSS'}</h1> Bans <h1>${length}</h1>
    <h1 class='text_${winner === 2 ? 'victory' : 'defeat'}'>${winner === 2 ? 'WIN' : 'LOSS'}</h1> Bans`).join('\n')}
  <table class='table_list trhover'><tr><th>Player</th></tr>${KT.map(([id, name]) => `<tr><td>${link(id, name)}</td></tr>`).join('')}</table>
  <table class='table_list trhover'><tr><th>Player</th></tr>${T1.map(([id, name]) => `<tr><td>${link(id, name)}</td></tr>`).join('')}</table>`;
const GAME = `${SEARCH}<div>Game Time</div><h1>36:20</h1>
  <div class="col-12 blue-line-header">
  <a href='../teams/team-stats/2849/split-ALL/tournament-Worlds/' title='Bilibili Gaming stats'>Bilibili Gaming</a> - WIN</div></div>
  <span class="score-box blue_line"><img alt='Kills'/> 14</span><span class="score-box blue_line"><img/> 9</span>
  <span class="score-box blue_line"><img/>3 </span><span class="score-box blue_line"><img/> 1</span><span class="score-box blue_line"><img/> 75k</span>
  <div class="col-12 red-line-header">
  <a href='../teams/team-stats/2899/split-ALL/tournament-Worlds/' title='Karmine Corp stats'>Karmine Corp</a> - LOSS</div></div>
  <span class="score-box red_line"><img/> 11</span><span class="score-box red_line"><img/> 4</span>
  <span class="score-box red_line"><img/>3 </span><span class="score-box red_line"><img/> 0</span><span class="score-box red_line"><img/> 66.3k</span>
  <table class='playersInfosLine footable'><thead><tr class="blue-line-header"></tr></thead>
  ${[[2606, 'Bin'], [3330, 'XUN'], [1270, 'Knight'], [1228, 'Viper'], [3353, 'ON']].map(([id, name]) =>
    `<tr><td><a class='link-blanc' href='../players/player-stats/${id}/season-ALL/split-ALL/tournament-Worlds/champion-ALL/' title='${name} stats'>${name}</a>
    <span><table class='perkztab'><tr><td>Runes</td></tr></table></span></td></tr>`).join('')}
  <table class='playersInfosLine footable'><thead><tr class="red-line-header"></tr></thead>
  ${[[2671, 'Canna'], [4001, 'Yike'], [4002, 'Kyeahoo'], [4003, 'Caliste'], [4004, 'Busio']].map(([id, name]) =>
    `<tr><td><a class='link-blanc' href='../players/player-stats/${id}/season-ALL/split-ALL/tournament-Worlds/champion-ALL/' title='${name} stats'>${name}</a>
    <span><table class='perkztab'><tr><td>Runes</td></tr></table></span></td></tr>`).join('')}
  </table><table class="table_list" style="height:140px"></table>`;

test('gol.gg\'s match list: each series with its page, teams, score, stage and date', () => {
  assert.deepEqual(readMatchList(MATCH_LIST), [
    { id: 72980, page: 'summary', title: 'T1 vs KT Rolster summary', left: 'KT Rolster', right: 'T1', leftWon: false, score: [2, 3],
      stage: 'FINALS', patch: '15.20', date: '2025-11-09' },
    { id: 72866, page: 'game', title: 'VKS vs TSW stats', left: 'Team Secret Whales', right: 'Vivo Keyd Stars', leftWon: true, score: [1, 0],
      stage: 'ROUND1', patch: '15.20', date: '2025-10-15' },
  ]);
  assert.deepEqual([seasonCode(2026), yearOfSeason('S14')], ['S16', 2024]);
});

test('a series\' summary: its format, each game\'s winner and length in order, and both sides\' players', () => {
  const read = readSummaryPage(SUMMARY);
  assert.deepEqual(read.teams, [{ id: 2493, name: 'KT Rolster' }, { id: 2497, name: 'T1' }]);
  assert.equal(read.bestOf, 5);
  assert.deepEqual(read.games, [{ winner: 2, duration: 2170 }, { winner: 1, duration: 2552 }, { winner: 1, duration: 2212 },
    { winner: 2, duration: 1780 }, { winner: 2, duration: 2207 }]);
  assert.deepEqual(read.players.map(side => side.map(p => p.name)), [KT.map(p => p[1]), T1.map(p => p[1])]);
});

test('a single game\'s page: its sides, winner, length, kills and objectives, and the ten players in role order', () => {
  const read = readGamePage(GAME);
  assert.deepEqual(read.teams, [{ id: 2849, name: 'Bilibili Gaming' }, { id: 2899, name: 'Karmine Corp' }]);
  assert.deepEqual(read.games, [{ winner: 1, duration: 2180, stats: [{ kills: 14, towers: 9, dragons: 3, barons: 1, gold: 75000 },
    { kills: 11, towers: 4, dragons: 3, barons: 0, gold: 66300 }] }]);
  assert.deepEqual(read.players.map(side => side.map(p => p.name)), [['Bin', 'XUN', 'Knight', 'Viper', 'ON'], ['Canna', 'Yike', 'Kyeahoo', 'Caliste', 'Busio']],
    'each row\'s own tables do not end the red side\'s');
  const people = readPlayerList(GAME);
  assert.deepEqual([...people], [[1, { name: 'Faker', country: 'KR' }], [2, { name: 'Caps', country: 'DK' }], [3, { name: 'D\'Artagnan', country: null }]]);
});

test('each tournament\'s circuit: gol.gg\'s region, its second tier apart, the multinational leagues, none for the world stage', () => {
  const circuit = (trname, region) => circuitOf({ trname, region });
  assert.equal(circuit('LCK 2025 Rounds 1-2', 'KR'), 'KR');
  assert.equal(circuit('LCK CL 2025 Rounds 1-2', 'KR'), 'KR-2');
  assert.equal(circuit('LFL Div2 2025 Spring Split', 'FR'), 'FR-2');
  assert.equal(circuit('Prime League 2nd Div Summer 2024', 'DE'), 'DE-2');
  assert.equal(circuit('LFL Promotion 2025', 'FR'), null, 'two divisions meet');
  assert.equal(circuit('Worlds 2025 Main Event', 'WR'), null);
  assert.equal(circuit('EMEA Masters 2025 Summer Main Event', 'WR'), null);
  assert.equal(circuit('LCP 2025 Split 2', 'WR'), 'PCS');
  assert.equal(circuit('KeSPA Cup 2025', 'WR'), 'KR');
  assert.equal(circuit('LTA South 2025 Split 2', 'LAT'), 'LTA South');
  assert.equal(circuit('CD 2025 Split 1', 'BR'), 'BR-2');
});

test('the series the Elo plays: every game between the sides\' players, each player\'s role from his place in a five', () => {
  const people = new Map([[48, { name: 'Faker', country: 'KR' }]]);
  const one = { id: 1, date: '2025-11-09', circuit: null, tournament: 'Worlds', ...readSummaryPage(SUMMARY) };
  const [series] = seriesOf([one], people);
  assert.equal(series.games.length, 5);
  assert.deepEqual(series.games.map(game => game.winner), [2, 1, 1, 2, 2]);
  const faker = series.games[0].sides[1][2];
  assert.deepEqual(faker, { key: playerKey({ id: 48 }), name: 'Faker', flag: 'kr', team: 'T1', role: 'MID' });
  assert.equal(rolesOf([series]).get('gg:48').get('MID'), 5);
});

test('a nation names its best player in each role, then its best others; one short of a role plays a player out of his', () => {
  const p = (key, role, elo) => ({ key, name: key, role, elo, rating: Math.round((elo - 50) / 25), nation: '410' });
  const players = [p('mid1', 'MID', 2500), p('mid2', 'MID', 2450), p('mid3', 'MID', 2400), p('jgl', 'JGL', 2300), p('bot', 'BOT', 2300),
    p('sup', 'SUP', 2200), p('top', 'TOP', 2000), p('jgl2', 'JGL', 2250)];
  const [korea] = nationsOf(players, sport);
  assert.equal(korea.squad.length, 7);
  for (const role of ROLES) assert.ok(korea.squad.some(player => player.role === role), role);
  assert.deepEqual(korea.squad.map(player => player.key), ['mid1', 'mid2', 'mid3', 'bot', 'jgl', 'sup', 'top'],
    'the reserves are the best of the rest (the second jungler is the eighth man), the squad by Elo, a tie by name');
  // Without a top laner, the best of the rest takes the lane, out of his role.
  const [short] = nationsOf(players.filter(player => player.role !== 'TOP'), sport);
  const lineup = selectLineup({ sport: 'league-of-legends', squad: short.squad.map(x => ({ name: x.name, pos: x.role, rating: x.rating })) });
  const top = lineup.slots.find(slot => slot.position === 'TOP');
  assert.ok(top.outOfPosition);
  assert.equal(top.penalty, outOfPositionPenalty('league-of-legends'));
});

test('the built-in nations are the committed snapshot\'s, byte for byte, one player a role where the nation has one', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = execFileSync(process.execPath, ['scripts/build-league-of-legends.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /Verified the League of Legends nations byte for byte/);
  for (const [id, [str, count, squad]] of Object.entries(ROSTERS)) {
    assert.ok(count >= 5 && count <= 7 && squad.length === count, id);
    assert.ok(squad.every(([, pos, rating]) => ROLES.includes(pos) && rating > 20 && rating < 110), id);
    const lineup = selectLineup({ sport: 'league-of-legends', squad: squad.map(([name, pos, rating]) => ({ name, pos, rating })) });
    assert.equal(lineup.rating, str, `${id}: the lineup the game picks`);
  }
});

// ---------- the sport ----------

test('League of Legends is an esport after Valorant, nations only, Great Britain as one, a tile of its own', () => {
  // Its place after Valorant, not a fixed index: another esport may come in between.
  assert.ok(SPORT_LIST.includes(sport) && SPORT_LIST.indexOf(sport) > SPORT_LIST.indexOf(getSport('valorant')));
  assert.equal(sport.nationsOnly, true);
  assert.deepEqual(sport.clubs, []);
  assert.equal(sport.playsAs['826'].code, 'GBR');
  assert.equal(SPORT_NOTES['league-of-legends'], 'Nations');
  assert.equal(teamSportId({ squad: [{ pos: 'SUP' }] }), 'league-of-legends', 'a squad of its roles reads as one');
  assert.deepEqual([GAMES, TO_WIN, BLOCK, LENGTH], [5, 3, 12, 36]);
  assert.deepEqual([clockLabel(sport, 1), clockLabel(sport, 13), clockLabel(sport, 60), clockTick(sport, 24)], ['G1', 'G2', 'G5', 'G2']);
  assert.equal(gameAt(36), 3);
  assert.equal(gameClock(31.7), '31:42');
  const setup = buildSetupModel({ sport: 'league-of-legends', layer: 'clubs' }, {});
  assert.equal(setup.layer, 'nations', 'no clubs to play');
  assert.deepEqual(readChallenge('?sport=league-of-legends&teams=clubs').setup.layer, 'nations');
  assert.equal(homeOffered('league-of-legends'), false);
  assert.equal(signingsOffered('league-of-legends'), true, 'roles make the best fit another player than the best rated');
});

test('a game as the real ones go: the winner\'s kills at their mean, the loser\'s growing with its length, Barons mostly the winner\'s', () => {
  const rng = makeRng(11);
  const games = Array.from({ length: 20000 }, () => playGame(rng, 'A'));
  const mean = f => games.reduce((sum, game) => sum + f(game), 0) / games.length;
  assert.ok(Math.abs(mean(game => game.kills.A) - WINNER_KILLS) < 0.4, `${mean(game => game.kills.A)}`);
  assert.ok(Math.abs(mean(game => game.kills.D) - LOSER_KILLS) < 1, `${mean(game => game.kills.D)}`);
  assert.ok(Math.abs(mean(game => game.minutes) - LENGTH_MEAN) < 0.3);
  const baron = side => tally(games.length, i => games[i].barons.some(b => b.side === side));
  assert.ok(baron('A') > 0.8 && baron('D') < 0.25, `${baron('A')} ${baron('D')}`);
  assert.ok(games.every(game => game.barons.every(b => b.minute >= 20 && b.minute <= game.minutes)));
  assert.equal(gameOdds(4).toFixed(2), '0.64');
});

test('the full series agrees with the score-only path, and its events are first blood, the Barons and each game\'s end', () => {
  const a = team('kor', [['TOP', 92], ['JGL', 90], ['MID', 95], ['BOT', 91], ['SUP', 90]]);
  const d = team('chn', [['TOP', 90], ['JGL', 91], ['MID', 90], ['BOT', 92], ['SUP', 88]]);
  const prepared = prepareMatch(a, d);
  assert.equal(prepared.series.toWin, 3);
  for (let seed = 1; seed < 60; seed++) {
    const quick = sampleResult(makeRng(seed), prepared, 6);
    const full = simulateSeries(makeRng(seed), prepared, 6);
    assert.deepEqual([full.ga, full.gd, full.winner], [quick.ga, quick.gd, quick.winner], `seed ${seed}`);
    const ends = full.ev.filter(e => e.pts === 1);
    assert.equal(ends.length, full.ga + full.gd);
    for (const e of full.ev) {
      assert.ok(e.m > (e.game - 1) * BLOCK && e.m <= e.game * BLOCK, 'within its game\'s block');
      assert.ok(['first-blood', 'baron', 'nexus'].includes(e.kind));
    }
    for (const end of ends) {
      const [w, l] = end.score.split('–').map(Number);
      assert.ok(w >= 1 && l >= 0);
    }
  }
});

test('the feed names first blood\'s killer, the side that takes Baron, and each game with its kills and best player', () => {
  assert.equal(sport.formatEvent({ m: 2, pts: 0, game: 1, kind: 'first-blood', name: 'Faker', clock: '4:12' }, 'KOR').text, 'FIRST BLOOD — Faker (KOR)');
  assert.equal(sport.formatEvent({ m: 2, pts: 0, game: 1, kind: 'first-blood', name: 'Faker', clock: '4:12' }, 'KOR').when, 'G1 4:12');
  assert.equal(sport.formatEvent({ m: 7, pts: 0, game: 1, kind: 'baron', clock: '26:03' }, 'KOR').text, 'BARON — KOR');
  assert.equal(sport.formatEvent({ m: 8, pts: 1, game: 2, kind: 'nexus', name: 'Keria', score: '22–9', clock: '31:42' }, 'KOR').text,
    'GAME 2 — KOR · 22–9 kills · Keria');
  const shown = [{ tid: 'kor', name: 'Faker', pts: 0 }, { tid: 'kor', name: 'Lee Sang-hyeok', pts: 1 }, { tid: 'kor', name: 'Keria', pts: 1 }];
  assert.equal(scorersLine(shown, 'kor', {}, 'league-of-legends'), 'Sang-hyeok · Keria');
});

test('the live chart: the series\' odds at the start, the games won at each game\'s end, the winner\'s at the end', () => {
  const a = team('kor', [['TOP', 92], ['JGL', 90], ['MID', 95], ['BOT', 91], ['SUP', 90]]);
  const d = team('chn', [['TOP', 88], ['JGL', 89], ['MID', 88], ['BOT', 90], ['SUP', 86]]);
  const model = liveModelFor(sport, a, d, undefined, undefined, 6);
  assert.equal(model.kind, 'games');
  assert.ok(isLiveModel(model));
  const start = winProbabilityAt(model, 0, 0);
  const rng = makeRng(4);
  const quick = tally(20000, () => sampleResult(rng, prepareMatch(a, d), 6).ga === 3);
  assert.ok(Math.abs(start - quick) < 0.015, `chart ${start}, played ${quick}`);
  const full = simulateSeries(makeRng(8), prepareMatch(a, d), 6);
  const events = full.ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? 'kor' : 'chn' }));
  const series = winSeries({ model, goals: events, aId: 'kor', dId: 'chn', minute: 99, final: { winnerId: full.winner === 'kor' ? 'kor' : 'chn' } });
  assert.equal(series[0].p.toFixed(6), start.toFixed(6));
  assert.equal(series.at(-1).p, full.ga === 3 ? 1 : 0);
  assert.deepEqual(chartDomain(model, 70).ticks.slice(0, 4), [0, 12, 24, 36]);
});

test('the squad screen draws the map with a player in each role, and the team\'s and best player\'s strength', () => {
  const kor = team('kor', [['TOP', 92], ['JGL', 90], ['MID', 95], ['BOT', 91], ['SUP', 90], ['MID', 85]]);
  const view = buildSquad({ teams: { kor }, aliveIds: ['kor'], history: [] }, { sport }, 'kor');
  assert.equal(view.layout, 'rift');
  assert.deepEqual(leagueOfLegendsProfile(selectLineup(kor)), { team: 91.6, best: 95 });
  assert.deepEqual(selectLineup(kor).slots.map(slot => slot.position), ROLES);
  const nation = buildTeam(Object.keys(ROSTERS)[0], makeRng(1), sport);
  assert.ok(nation.squad.every(player => ROLES.includes(player.pos) && !player.gen), 'nobody invented');
});
