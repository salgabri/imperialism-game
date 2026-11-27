// League of Legends' earlier seasons, their line-ups (docs/design/league-of-legends.md, "Earlier seasons"): gol.gg's players and
// teams lists read, each tournament's players put in their sides from the two lists alone, the roles, the series and the year's
// games they make, the Elo of a player of part of a side's games, and the countries esportsearnings.com lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readMatchList, readPlayersTable, readTeamsTable } from './lib/golgg.mjs';
import { roleOdds, rolesWithin, solveLineups, solveSeason, teamsOf, trainRoles, usualOf } from './lib/golgg-lineups.mjs';
import { TOP_RATING, baseOf, careerRoles, gamesInTurn, inOrder, lineupsOf, listedSeries, rolesIn, windowOf, yearOfGames } from './lib/league-of-legends-seasons.mjs';
import { circuitLevels, homesOf, runElo, scoredGames } from './lib/esports-elo.mjs';
import { ROLES, circuitOf, gameRating, playerOf } from './lib/league-of-legends.mjs';
import { readCountries, readCountryPlayers } from './lib/esports-earnings.mjs';
import { makeRng } from '../src/data/teams.js';

// ---------- gol.gg's lists ----------

const HEADS = ['Player', 'Country', 'Games', 'Win rate', 'KDA', 'Avg kills', 'Avg deaths', 'Avg assists', 'CSM', 'GPM', 'KP%', 'DMG%', 'Gold%', 'VS%', 'DPM', 'VSPM',
  'Avg WPM', 'Avg WCPM', 'Avg VWPM', 'GD@15', 'CSD@15', 'XPD@15', 'FB %', 'FB Victim', 'Penta Kills', 'Solo Kills'];
const PLAYERS = `<table class='filters'><tr><td>Season: </td><td><a href='./list/season-S9/split-ALL/tournament-ALL/'>S9</a></td></tr></table>
  <table class='table_list playerslist'><thead><tr>${HEADS.map(head => `<th data-tablesaw-sortable-col>${head}</th>`).join('')}</tr></thead><tbody>
  <tr><td><a href='./player-stats/48/season-ALL/split-ALL/tournament-LCK%20Spring%202019/' title='Faker stats'>Faker</a></td><td class='text-center'><span class='d-none'>KR</span>&nbsp;<img alt='KR' src='../_img/pays/KR.png'/></td>${['44', '70.5%', '4', '2.3', '1.8', '4.8', '9', '398', '56.4%', '24.8%', '21.3%', '13.7%', '434', '1.14', '0.51', '0.25', '0.21', '68', '5', '-70', '29.5%', '4.5%', '0', '8'].map(cell => `<td class='text-center'>${cell}</td>`).join('')}</tr>
  <tr><td><a href='./player-stats/1970/season-ALL/split-ALL/tournament-LCK%20Spring%202019/' title='D&#39;Artagnan stats'>D&#39;Artagnan</a></td><td class='text-center'></td>${['9', '0%', '1.2', '1.3', '3.2', '2.7', '8.3', '342', '56.1%', '17.3%', '20.8%', '-', '239', '-', '-', '-', '-', '-', '-', '-', '-', '-', '0', '-'].map(cell => `<td class='text-center'>${cell}</td>`).join('')}</tr></tbody></table>`;

test('a players list: each player\'s games, wins and figures over them, a blank figure and a missing country null', () => {
  const [faker, other] = readPlayersTable(PLAYERS);
  assert.deepEqual(faker, { id: 48, name: 'Faker', country: 'KR', games: 44, wins: 31, kills: 2.3, deaths: 1.8, assists: 4.8, csm: 9, gpm: 398, dpm: 434, vspm: 1.14,
    kp: 0.564, dmg: 0.248, gold: 0.213, vs: 0.137, soloKills: 8, firstBlood: 0.295 });
  assert.deepEqual([other.name, other.country, other.games, other.wins, other.vs, other.vspm, other.soloKills, other.firstBlood],
    ['D\'Artagnan', null, 9, 0, null, null, null, null]);
  assert.deepEqual(readPlayersTable('<p>No player</p>'), []);
});

test('a teams list: each team\'s record and figures', () => {
  const heads = ['Name', 'Season', 'Region', 'Games', 'Win rate', 'K:D', 'GPM', 'GDM', 'Game duration', 'Kills / game', 'Deaths / game', 'NASHPG', 'DPM'];
  const html = `<table><thead><tr>${heads.map(head => `<th>${head}</th>`).join('')}</tr></thead><tr><td class='footable-visible'><a href='./team-stats/585/split-ALL/tournament-ALL/' title='SK Telecom T1 stats'>SK Telecom T1</a></td>`
    + `${['S9', 'KR', '141', '67.4%', '1.41', '1,873', '133', '33:48', '12.7', '8.9', '0.77', '1772'].map(cell => `<td>${cell}</td>`).join('')}</tr></table>`;
  assert.deepEqual(readTeamsTable(html), [{ id: 585, name: 'SK Telecom T1', region: 'KR', games: 141, wins: 95, gpm: 1873, dpm: 1772, kills: 12.7, deaths: 8.9,
    nashors: 0.77, minutes: 33.8 }]);
});

test('a match list: a series of two games won one each, and one of which gol.gg keeps only the score', () => {
  const html = `<tr><td class='text-left'><a href='../game/stats/77502/page-summary/' title='ALMO vs IN5 summary'>ALMO vs IN5</a></td><td class='text-right'>ALMO Players</td><td class='text-center'>1 - 1</td><td>Team Insidious</td><td class='text-center'>WEEK6</td><td class='text-center'>16.9</td><td class='text-center'>2026-05-06</td></tr>`
    + `<tr><td class='text-left'>UP2 vs Forsaken</td><td class='text-right text_victory'>Forsaken</td><td class='text-center'>2 - 1</td><td class='text_defeat'>UP2UMEDIA Cebulaki</td><td class='text-center'>ROUND.ROBIN.1</td><td class='text-center'></td><td class='text-center'>2026-08-05</td></tr>`
    + `<tr><td class='text-left'>UCAM vs BAR</td><td class='text-right'>UCAM Tokiers</td><td class='text-center'> - </td><td>Barça eSports</td><td class='text-center'>WEEK6</td><td class='text-center'></td><td class='text-center'>2024-02-21</td></tr>`;
  assert.deepEqual(readMatchList(html), [{ id: 77502, page: 'summary', title: 'ALMO vs IN5 summary', left: 'ALMO Players', right: 'Team Insidious', leftWon: null,
    score: [1, 1], stage: 'WEEK6', patch: '16.9', date: '2026-05-06' }]);
  const all = readMatchList(html, { unlinked: true });
  assert.deepEqual(all.map(one => [one.id, one.page, one.left, one.right, one.leftWon, one.score]), [[77502, 'summary', 'ALMO Players', 'Team Insidious', null, [1, 1]],
    [null, null, 'Forsaken', 'UP2UMEDIA Cebulaki', true, [2, 1]]], 'the one that was never played has no score');
  assert.deepEqual(teamsOf(all).find(team => team.name === 'Forsaken'), { name: 'Forsaken', games: 0, wins: 0, also: [3, 2] });
  assert.deepEqual(teamsOf(all).find(team => team.name === 'ALMO Players'), { name: 'ALMO Players', games: 2, wins: 1 });
});

// ---------- the line-ups ----------

// A tournament as gol.gg's two lists would show it: every team's own gold, vision, damage and kills, and each player's share of
// them by his role, rounded as the list rounds.
const SHAPE = { TOP: { csm: 8.3, gold: 0.215, dmg: 0.24, kp: 0.57, vs: 0.13, killShare: 0.4, solo: 0.2 }, JGL: { csm: 5.2, gold: 0.18, dmg: 0.14, kp: 0.71, vs: 0.24, killShare: 0.3, solo: 0.05 },
  MID: { csm: 8.8, gold: 0.22, dmg: 0.26, kp: 0.64, vs: 0.14, killShare: 0.42, solo: 0.2 }, BOT: { csm: 9.8, gold: 0.24, dmg: 0.29, kp: 0.66, vs: 0.17, killShare: 0.48, solo: 0.05 },
  SUP: { csm: 1.6, gold: 0.145, dmg: 0.07, kp: 0.67, vs: 0.32, killShare: 0.1, solo: 0 } };
const to = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
let nextId = 1;
function playerOfTeam(team, role, { games = team.games, wins = team.wins, name = `${team.name} ${role}`, rng } = {}) {
  const shape = SHAPE[role];
  const wobble = scale => 1 + (rng() - 0.5) * scale;
  const gold = shape.gold * wobble(0.06), dmg = shape.dmg * wobble(0.12), vs = shape.vs * wobble(0.06), kp = shape.kp * wobble(0.06);
  const involved = kp * team.kills;
  return { id: nextId++, name, country: null, games, wins, kills: to(involved * shape.killShare, 1), deaths: 2.5, assists: to(involved * (1 - shape.killShare), 1),
    csm: to(shape.csm * wobble(0.06), 1), gpm: Math.round(team.gpm * gold), dpm: Math.round(team.dpm * dmg), vspm: to(team.vspm * vs, 2), kp: to(kp, 3), dmg: to(dmg, 3),
    gold: to(gold, 3), vs: to(vs, 3), soloKills: Math.round(games * shape.solo), firstBlood: 0.25, role };
}
/** Eight teams of 18 games: two pairs with one record each, one team with two junglers in turn. */
function league(rng) {
  const wins = [15, 12, 12, 9, 9, 7, 5, 3];
  const teams = wins.map((won, i) => ({ name: `Team ${'ABCDEFGH'[i]}`, games: 18, wins: won, gpm: 1700 + 22 * won + 8 * i, vspm: 7 + 0.21 * i, dpm: 1650 + 30 * won + 25 * i, kills: 9 + 0.5 * won }));
  const players = [];
  const real = new Map();
  for (const team of teams) {
    for (const role of ROLES) {
      const halves = team.name === 'Team D' && role === 'JGL' ? [[11, 6], [7, 3]] : [[18, team.wins]];
      halves.forEach(([games, won], n) => {
        const player = playerOfTeam(team, role, { games, wins: won, name: `${team.name} ${role}${n ? ' II' : ''}`, rng });
        players.push(player);
        real.set(player.id, team.name);
      });
    }
  }
  return { teams: teams.map(({ name, games, wins: won }) => ({ name, games, wins: won })), players, real };
}

const rng = makeRng(7);
const model = trainRoles(Array.from({ length: 40 }, (_, i) => ROLES.map(role => ({ role, player: playerOfTeam({ name: `T${i}`, games: 30, wins: 15, gpm: 1750 + 5 * i, vspm: 7.5, dpm: 2000, kills: 13 }, role, { rng }) }))).flat(),
  { steps: 300 });

test('a player\'s role shows in his figures: his creeps, his shares of gold, damage and vision', () => {
  const team = { name: 'New', games: 20, wins: 10, gpm: 1790, vspm: 7.2, dpm: 1900, kills: 12 };
  for (const role of ROLES) {
    const odds = roleOdds(model, playerOfTeam(team, role, { rng }));
    assert.equal(ROLES[odds.indexOf(Math.max(...odds))], role);
    assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
  assert.deepEqual(roleOdds(model, { csm: null, gold: null }), ROLES.map(() => 0.2), 'no figures, no guess');
  // A list without vision (before 2018), or without gold and damage too (the LPL of 2016 and 2017): the role still shows in
  // the creeps and the kills, read by a model fitted without them, not by one that takes the missing figures for average.
  for (const keys of [['vspm', 'vs'], ['gpm', 'gold', 'dpm', 'dmg', 'vspm', 'vs']]) {
    for (const role of ['JGL', 'SUP']) {
      const lacking = { ...playerOfTeam(team, role, { rng }), ...Object.fromEntries(keys.map(key => [key, null])) };
      const odds = roleOdds(model, lacking);
      assert.equal(ROLES[odds.indexOf(Math.max(...odds))], role, `${role} without ${keys.join(', ')}`);
    }
  }
  assert.deepEqual(roleOdds({ ...model, lacking: undefined }, { csm: 8, gold: null }), ROLES.map(() => 0.2), 'no model fitted without gold');
  const five = ROLES.map((role, i) => ({ id: i + 1, games: 18, odds: ROLES.map((_, r) => (r === i ? 0.9 : 0.025)) }));
  // Two who both look like mid laners: the likeliest arrangement of the five gives each role to one.
  five[0].odds = [0.4, 0.05, 0.5, 0.025, 0.025];
  assert.deepEqual([...rolesWithin(five)].sort((a, b) => a[0] - b[0]).map(([, role]) => role), ROLES);
});

test('each player goes to the side his record, role and team figures fit; two junglers in turn make up their team\'s record', () => {
  const { teams, players, real } = league(makeRng(11));
  const withOdds = players.map(p => ({ ...p, odds: roleOdds(model, p) }));
  // With no word on which is which, teams of one record may trade names, but their players stay together.
  const alone = solveLineups(teams, withOdds);
  for (const team of teams) {
    const mates = players.filter(p => alone.teamOf.get(p.id) === team.name).map(p => real.get(p.id));
    assert.equal(new Set(mates).size, 1, `${team.name}: one team's players`);
    assert.ok(mates.length >= 5);
  }
  for (const name of ['Team A', 'Team F', 'Team G', 'Team H']) {
    assert.deepEqual(players.filter(p => alone.teamOf.get(p.id) === name).map(p => real.get(p.id)), Array(5).fill(name), 'a record of its own names its team');
  }
  // What another tournament says of one player settles the pair.
  const told = solveLineups(teams, withOdds, { prior: p => (p.role === 'TOP' ? new Map([[real.get(p.id), 1]]) : null) });
  for (const p of players) assert.equal(told.teamOf.get(p.id), real.get(p.id), p.name);
  assert.deepEqual(solveLineups(teams, withOdds), alone, 'the same draws each time');
});

test('a team takes one role a player: a bot laner the role model takes for a mid laner costs his odds, not a role\'s games', () => {
  // 2016's bot laners read as mid laners by a model of 2025-26's figures (Ruler 91% MID, beside Crown's 100%). Counting each
  // at his likeliest role cost his team a whole role's games twice over, which broke LCK Summer 2016's teams apart.
  const rng = makeRng(17);
  const team = { name: 'Team A', games: 18, wins: 15, gpm: 1760, vspm: 7.2, dpm: 1900, kills: 15 };
  const five = ROLES.map(role => playerOfTeam(team, role, { rng }));
  const clear = r => ROLES.map((_, k) => (k === r ? 0.96 : 0.01));
  const misread = [0.01, 0.01, 0.9, 0.07, 0.01], mid = [0.004, 0.004, 0.98, 0.008, 0.004];
  const costOf = bot => {
    const players = five.map(p => ({ ...p, odds: p.role === 'BOT' ? bot : p.role === 'MID' ? mid : clear(ROLES.indexOf(p.role)) }));
    const solved = solveLineups([{ name: team.name, games: team.games, wins: team.wins }], players);
    assert.ok(players.every(p => solved.teamOf.get(p.id) === team.name), 'the five together');
    assert.ok(players.every(p => rolesWithin(players).get(p.id) === p.role), 'each at his role');
    return solved.costs.get(team.name);
  };
  const extra = costOf(misread) - costOf(clear(ROLES.indexOf('BOT')));
  assert.ok(Math.abs(extra - Math.log(0.9 / 0.07)) < 0.5, `the misread costs his log-odds, ${extra.toFixed(2)}`);
});

test('a season: a second tournament names the pair the first leaves open, and each lineup says what part of the games each played', () => {
  const { teams, players, real } = league(makeRng(13));
  const list = games => {
    // A round robin whose records are the teams': each series a single game, the stronger first.
    const rows = [];
    const left = new Map(teams.map(team => [team.name, { games: team.games, wins: team.wins }]));
    const order = teams.map(team => team.name);
    while ([...left.values()].some(team => team.games > 0)) {
      const open = order.filter(name => left.get(name).games > 0).sort((a, b) => left.get(b).games - left.get(a).games || left.get(b).wins - left.get(a).wins);
      const a = open[0];
      const b = open.slice(1).sort((x, y) => left.get(x).wins / left.get(x).games - left.get(y).wins / left.get(y).games)[0];
      const aWins = left.get(a).wins > 0 && (left.get(b).wins === 0 || left.get(a).wins / left.get(a).games >= left.get(b).wins / left.get(b).games);
      for (const name of [a, b]) left.get(name).games--;
      left.get(aWins ? a : b).wins--;
      rows.push({ id: rows.length + games, page: 'game', left: a, right: b, score: aWins ? [1, 0] : [0, 1], date: '2019-02-01' });
    }
    return rows;
  };
  const season = { name: 'Spring', from: '2019-01-10', to: '2019-03-30', circuit: 'XX', list: list(1000), players: players.map(p => ({ ...p, odds: roleOdds(model, p) })) };
  assert.deepEqual(teamsOf(season.list).sort((a, b) => a.name.localeCompare(b.name)).map(team => team.games), teams.map(() => 18));
  // The playoffs: each of the pair's records apart.
  const cup = teams.map((team, i) => ({ name: team.name, games: 6, wins: [6, 5, 4, 3, 2, 1, 0, 3][i] === 3 && i === 7 ? 0 : [6, 5, 4, 3, 2, 1, 0, 0][i] }));
  const cupRows = [];
  cup.forEach((team, i) => { for (let n = 0; n < team.games; n++) cupRows.push({ id: 5000 + i * 10 + n, page: 'game', left: team.name, right: `Guest ${i}${n}`, score: n < team.wins ? [1, 0] : [0, 1], date: '2019-04-05' }); });
  const cupPlayers = players.filter(p => !p.name.endsWith(' II')).map(p => { const team = cup.find(x => x.name === real.get(p.id)); return { ...p, games: 6, wins: team.wins }; });
  const playoffs = { name: 'Playoffs', from: '2019-04-01', to: '2019-04-10', circuit: 'XX', list: cupRows, players: cupPlayers.map(p => ({ ...p, odds: roleOdds(model, p) })) };
  const solved = solveSeason([season, playoffs], { usual: new Map() });
  const lineups = lineupsOf(season, solved.get(season));
  for (const [team, lineup] of lineups) for (const p of lineup) assert.equal(real.get(p.id), team, p.name);
  const junglers = lineups.get('Team D').filter(p => p.role === 'JGL');
  assert.deepEqual(junglers.map(p => [p.games, to(p.share, 3)]), [[11, 0.611], [7, 0.389]]);
  const { series, short } = listedSeries(season, lineups, { flagOf: p => (p.id % 2 ? 'kr' : null) });
  assert.deepEqual([series.length, short], [72, 0]);
  const one = series.find(x => x.teams.includes('Team D'));
  const side = one.games[0].sides[one.teams.indexOf('Team D')];
  assert.equal(side.length, 6);
  assert.ok(Math.abs(side.reduce((sum, entry) => sum + entry.share, 0) - 5) < 1e-9, 'five places between six');
  assert.ok(side.every(entry => entry.key.startsWith('gg:') && entry.team === 'Team D' && ROLES.includes(entry.role)));
  // A series whose page is read stands as the page has it; one whose sides are not known is left out.
  const page = { id: season.list[0].id, date: '2019-02-01', games: [{ winner: 2, sides: [[], []] }], teams: ['Team A', 'Team B'] };
  assert.equal(listedSeries(season, lineups, { exact: new Map([[page.id, page]]) }).series.find(x => x.id === page.id).games[0].winner, 2);
  assert.equal(listedSeries(season, new Map()).short, 72);
  assert.deepEqual(usualOf({ gpm: 1800, dpm: 0, kills: null }), [Math.log(1800), null, null, null]);
});

// ---------- the series, the scale, the year ----------

test('a series\' games in turn, the winner\'s last; the series of a season\'s window in order', () => {
  assert.deepEqual([[1, 0], [0, 2], [2, 1], [1, 1], [3, 2], [1, 3]].map(([a, b]) => gamesInTurn(a, b).join('')), ['1', '22', '121', '12', '12121', '2122']);
  const at = (date, id) => ({ date, id, order: id, games: [] });
  const series = inOrder([at('2019-02-02', 9), at('2017-12-31', 3), at('2019-02-02', 8), at('2018-01-01', 5), at('2020-01-01', 12)]);
  assert.deepEqual(windowOf(series, 2019).map(one => one.id), [5, 8, 9], 'its own year and the one before');
});

test('a player\'s role is the one he plays most, the year before counting half', () => {
  const series = (date, role, games) => ({ date, games: Array.from({ length: games }, () => ({ winner: 1, sides: [[{ key: 'gg:1', role }], []] })) });
  assert.equal(rolesIn([series('2018-06-01', 'TOP', 30), series('2019-06-01', 'MID', 16)], 2019).get('gg:1'), 'MID');
  assert.equal(rolesIn([series('2018-06-01', 'TOP', 40), series('2019-06-01', 'MID', 16)], 2019).get('gg:1'), 'TOP');
  // His career has its word as well: it settles a season split between two roles, but not one of a single role.
  const career = careerRoles([series('2017-06-01', 'TOP', 60), series('2018-06-01', 'TOP', 60), series('2020-06-01', 'TOP', 60), series('2019-06-01', 'MID', 18),
    series('2019-07-01', 'TOP', 12)]);
  assert.equal(rolesIn([series('2019-06-01', 'MID', 18), series('2019-07-01', 'TOP', 12)], 2019, career).get('gg:1'), 'TOP', 'a split season goes the career\'s way');
  assert.equal(rolesIn([series('2019-06-01', 'MID', 18), series('2019-07-01', 'TOP', 12)], 2019).get('gg:1'), 'MID', 'without it, the season\'s most');
  const moved = careerRoles([series('2017-06-01', 'BOT', 60), series('2018-06-01', 'BOT', 60), series('2019-06-01', 'SUP', 40)]);
  assert.equal(rolesIn([series('2019-06-01', 'SUP', 40)], 2019, moved).get('gg:1'), 'SUP', 'a move of role stands');
});

test('a season\'s scale: its strongest players average what today\'s do, 25 Elo a point', () => {
  const todays = Array.from({ length: 60 }, (_, i) => 2500 - 5 * i);
  const then = todays.map(elo => elo - 600);
  const base = baseOf(then, todays, 100);
  assert.equal(base, -500);
  assert.equal(gameRating(then[0], base), gameRating(todays[0]));
  const row = ['gg:48', 'Faker', 'kr', '410', 'MID', 1900, 100, 70, '2016-10-29', 'SK Telecom T1', 'KR'];
  assert.equal(playerOf(row, '2016-12-31', 1, base).rating, 96);
  assert.equal(playerOf(row, '2016-12-31', 1).rating, 72, 'the built-in season\'s base unless another is given');
  // A season one team ran away with: its best would read over the scale's end, so the base rises to keep him at TOP_RATING.
  const runaway = [3000, 2990, ...todays.slice(2).map(elo => elo - 100)];
  const raised = baseOf(runaway, todays, 100);
  assert.equal(gameRating(3000, raised), TOP_RATING);
  assert.ok(raised > baseOf(runaway.slice(2), todays, 100));
});

test('a year\'s games: their mean length, and the winner\'s and the loser\'s kills off the line of the teams\' figures', () => {
  const teams = [0, 0.25, 0.5, 0.75, 1].map((share, i) => ({ name: `T${i}`, games: 40, wins: 40 * share, kills: 8 + 10 * share, nashors: 0.2 + 0.9 * share }));
  const play = yearOfGames([{ games: 100, minutes: 36 }, { games: 300, minutes: 32 }], [...teams, { name: 'few', games: 3, wins: 3, kills: 40, nashors: 3 }]);
  assert.deepEqual(play, { games: 400, minutes: 33, kills: { winner: 18, loser: 8 }, nashors: { winner: 1.1, loser: 0.2 }, teams: 5 });
});

test('the earlier seasons\' circuits: promotions and the European Masters between circuits, the challengers\' leagues second tiers', () => {
  const circuit = (trname, region) => circuitOf({ trname, region });
  assert.equal(circuit('LCK Spring Promo 2017', 'KR'), null);
  assert.equal(circuit('EU LCS 2017 Spring Promo', 'EUW'), null);
  assert.equal(circuit('EU Masters Spring 2018', 'EUW'), null);
  assert.equal(circuit('EU Master Summer Play-In 2019', 'EUW'), null);
  assert.equal(circuit('Iberian Cup 2020', 'ES'), null);
  assert.equal(circuit('LCK Spring 2019', 'KR'), 'KR');
  assert.deepEqual([circuit('EU CS Spring 2017', 'EUW'), circuit('NA CS Summer 2017', 'NA'), circuit('CK Summer 2020', 'KR'), circuit('BRCC Split 1 2020', 'BR'),
    circuit('LVP2 Summer 2022', 'ES'), circuit('LCS Proving Grounds Spring 2021', 'NA'), circuit('Hitpoint Challengers 2021 Summer', 'CZ')],
  ['EUW-2', 'NA-2', 'KR-2', 'BR-2', 'ES-2', 'NA-2', 'CZ-2']);
  assert.equal(circuit('Challenge France 2017', 'EUW'), 'FR');
  assert.equal(circuit('LMS Summer 2018', 'TW'), 'TW');
});

// ---------- a part of a side's games ----------

test('a player of part of his side\'s games counts, moves and is counted by that part; a side of whole players as before', () => {
  const entry = (key, share) => ({ key, name: key, ...(share === undefined ? {} : { share }) });
  const five = prefix => ['a', 'b', 'c', 'd', 'e'].map(x => entry(`${prefix}${x}`));
  const game = (left, right, winner) => ({ winner, sides: [left, right] });
  const one = (games, date = '2019-01-01', circuit = 'X') => ({ id: 1, date, circuit, games });
  const whole = runElo([one([game(five('p'), five('q'), 1)])], { scale: 160 });
  const marked = runElo([one([game(five('p').map(e => ({ ...e, share: 1 })), five('q').map(e => ({ ...e, share: 1 })), 1)])], { scale: 160 });
  assert.deepEqual([...marked.players.values()].map(p => [p.key, p.elo, p.games, p.wins]), [...whole.players.values()].map(p => [p.key, p.elo, p.games, p.wins]));
  // The fifth place shared: three quarters and a quarter of the games.
  const shared = [...five('p').slice(0, 4), entry('pe', 0.75), entry('pf', 0.25)];
  const { players } = runElo([one([game(shared, five('q'), 1)])], { scale: 160 });
  const gain = key => players.get(key).elo - 1500;
  assert.ok(Math.abs(gain('pe') - 0.75 * gain('pa')) < 1e-9 && Math.abs(gain('pf') - 0.25 * gain('pa')) < 1e-9);
  assert.deepEqual([players.get('pe').games, players.get('pf').games, players.get('pf').wins], [0.75, 0.25, 0.25]);
  // A side plays at the mean its places give: a strong sixth man of a quarter of the games lifts it a quarter of his part.
  const lift = (extra, seen = []) => {
    runElo([one([game(five('s'), five('t'), 1)]), one([game([...five('u').slice(0, 4), entry('ue', 0.75), entry(extra, 0.25)], five('v'), 1)], '2019-01-02')],
      { scale: 160, onGame: (_, g, e) => seen.push(e) });
    return seen[1];
  };
  assert.ok(lift('sa') > lift('new') && lift('new') === 0.5);
  // Homes and levels count by the part played too.
  const home = homesOf([one([game([entry('x', 0.2)], five('q'), 1)], '2019-01-01', 'A'), one([game([entry('x', 0.9)], five('q'), 1)], '2019-01-02', 'B')]);
  assert.equal(home.get('x'), 'B');
  const series = Array.from({ length: 40 }, (_, i) => one([game(five('p'), five('q'), i % 4 ? 1 : 2)], `2019-01-${String(1 + (i % 28)).padStart(2, '0')}`, null));
  assert.deepEqual(circuitLevels(series), circuitLevels(series.map(x => ({ ...x, games: x.games.map(g => ({ ...g, sides: g.sides.map(side => side.map(e => ({ ...e, share: 1 }))) })) }))));
  const rows = scoredGames(series.map(x => ({ ...x, games: x.games.map(g => ({ ...g, sides: [[...g.sides[0].slice(0, 4), entry('pe', 0.9), entry('sub', 0.1)], g.sides[1]] })) })),
    { scale: 160 }, { from: '2019-01-25', minGames: 5 });
  assert.ok(rows.length && rows.every(row => row.seasoned), 'a substitute of a tenth of the games does not make a game unseasoned');
});

// ---------- the countries ----------

test('esportsearnings.com\'s lists: a game\'s countries and a country\'s players', () => {
  const index = `<tr><td><a href="/games/164-league-of-legends/countries/kr">Korea, Republic of</a></td><td>$48,278,317.74</td><td>1039 Players</td></tr>
    <tr><td><a href="/games/164-league-of-legends/countries/cn">China</a></td><td>$26,839,775.69</td><td>627 Players</td></tr>`;
  assert.deepEqual(readCountries(index), [{ country: 'kr', players: 1039 }, { country: 'cn', players: 627 }]);
  const page = `<tr><td class="order">1.</td><td><a href="/countries/cn"><img src="/images/flags/16/cn.png" alt="China"/></a> <a href="/players/34362-jackeylove-yu-wenbo">JackeyLove</a></td><td><a href="/players/34362-jackeylove-yu-wenbo">Yu, Wenbo</a></td><td>$1,088,556.68</td></tr>`;
  assert.deepEqual(readCountryPlayers(page), [{ id: 34362, slug: 'jackeylove-yu-wenbo', handle: 'JackeyLove', name: 'Yu, Wenbo', country: 'cn' }]);
});
