import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { buildClub, buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';
import { basketball } from '../src/sports/basketball.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';
import { loadEaPlayers, fmGameRating, parseCsv } from './lib/football-data.mjs';

const evidence = {
  id: 'ea:123', fullName: 'Verified Player', positions: ['MF', 'FW'],
  source: 'ea-fc', edition: 'FC 26', snapshotDate: '2025-09-19',
  url: 'https://sofifa.com/player/123/verified-player/260004/', rawRating: 81, rawScale: '1–99',
};
const fixture = ['V. Player', 'MF', 81, evidence];

test('nation and club construction preserve rating evidence and distinct database identities', () => {
  const sport = { ...football, rosters: { '250': [81, 1, [fixture]] } };
  const nation = buildTeam('250', makeRng(1), sport);
  const club = buildClub({ id: 'fixture-club', name: 'Fixture', code: 'FIX', country: '250', str: 81, squad: [fixture] }, sport);
  for (const team of [nation, club]) {
    const player = team.squad[0];
    assert.equal(player.id, evidence.id);
    assert.equal(player.rating, evidence.rawRating);
    assert.equal(player.gen, false);
    assert.deepEqual(player.sourceInfo, evidence);
    assert.deepEqual(player.positions, ['MF', 'FW']);
    assert.notEqual(player.sourceInfo, evidence, 'campaign metadata cannot mutate the export');
    assert.notEqual(player.positions, evidence.positions);
    assert.notEqual(player.sourceInfo.positions, evidence.positions);
  }
  nation.squad[0].positions.push('DF');
  assert.deepEqual(club.squad[0].positions, ['MF', 'FW']);
  assert.deepEqual(evidence.positions, ['MF', 'FW']);
});

test('thin and missing football source data never invent player names or ratings', () => {
  let calls = 0;
  const rng = () => { calls++; return .5; };
  const thin = buildTeam('250', rng, { ...football, rosters: { '250': [81, 1, [fixture]] } });
  const empty = buildTeam('250', rng, { ...football, rosters: {} });
  assert.equal(calls, 0);
  assert.equal(thin.squad.length, 1);
  assert.equal(thin.real, 1);
  assert.deepEqual(empty.squad, []);
  assert.equal(empty.real, 0);
  const lineup = selectLineup(thin);
  assert.equal(lineup.starters.length, 1);
  assert.equal(lineup.slots.filter(slot => !slot.player).length, 10);
  assert.equal(lineup.starters[0].id, evidence.id);
  assert.equal(selectLineup(empty).starters.length, 0);
});

test('database secondary positions fill their natural shirts without changing base ratings', () => {
  const squad = football.positionPlan.map((pos, index) => ({ name: `Player ${index}`, pos, rating: 75 }));
  squad[5] = { name: 'Flexible attacker', pos: 'FW', positions: ['FW', 'MF'], rating: 75, sourceInfo: evidence };
  const lineup = selectLineup({ sport: 'football', squad });
  const flexible = lineup.starters.find(player => player.name === 'Flexible attacker');
  assert.equal(lineup.rating, 75);
  assert.equal(flexible.assignedPos, 'MF');
  assert.equal(flexible.outOfPosition, false);
  assert.equal(flexible.effectiveRating, flexible.rating);
  assert.ok(lineup.slots.every(slot => slot.penalty === 0));
  assert.equal(new Set(lineup.starters.map(player => player.originalIndex)).size, 11);
  delete squad[5].positions;
  assert.ok(selectLineup({ sport: 'football', squad }).rating < 75, 'legacy single-position players still receive the positional penalty');
  assert.equal(squad[5].rating, 75);
});

test('legacy triples and basketball generated coverage stay compatible', () => {
  const legacy = buildTeam('250', makeRng(2), { ...football, rosters: { '250': [70, 1, [['Legacy player', 'GK', 70]]] } });
  assert.deepEqual(legacy.squad[0], { name: 'Legacy player', pos: 'GK', rating: 70, gen: false });
  const team = buildTeam('250', makeRng(2), { ...basketball, rosters: {} });
  assert.equal(team.squad.length, basketball.squadSize);
  assert.equal(team.real, 0);
  assert.ok(team.squad.every(player => player.gen));
  assert.equal(selectLineup(team).starters.length, basketball.squadSize);
});

test('player rows expose database evidence and distinguish secondary roles from penalties', async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/PlayerRow.jsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const PlayerRow = module.exports.default;
  const render = player => new JSDOM(renderToStaticMarkup(React.createElement(PlayerRow, { player })));
  const ea = render({ name: fixture[0], pos: 'MF', positions: ['MF', 'FW'], assignedPos: 'FW',
    rating: 81, effectiveRating: 81, outOfPosition: false, sourceInfo: evidence });
  try {
    const document = ea.window.document;
    assert.equal(document.querySelector('.fi-player-source a').href, evidence.url);
    assert.match(document.querySelector('.fi-player-source').textContent, /FC 26/);
    assert.match(document.querySelector('.fi-player-rating').title, /2025-09-19/);
    assert.match(document.querySelector('.fi-player-rating').title, /Source rating 81/);
    assert.equal(document.querySelector('.fi-player-identity > span').title, evidence.fullName);
    assert.equal(document.querySelector('.fi-out-of-position'), null);
  } finally { ea.window.close(); }
  const fm = render({ name: 'FM player', pos: 'DF', assignedPos: 'MF', rating: 74, effectiveRating: 62,
    outOfPosition: true, sourceInfo: { ...evidence, source: 'football-manager', edition: 'FM 26',
      url: 'javascript:alert(1)', rawRating: 150, rawScale: '1–200', conversion: 'CA × 99 / 200' } });
  try {
    const document = fm.window.document;
    assert.match(document.querySelector('.fi-player-source').textContent, /FM 26/);
    assert.equal(document.querySelector('.fi-player-source a'), null);
    assert.match(document.querySelector('.fi-player-rating').title, /Source rating 150/);
    assert.match(document.querySelector('.fi-player-rating').title, /Base rating 74; lineup rating 62\.0/);
    assert.match(document.querySelector('.fi-player-rating').title, /converted from Football Manager current ability/);
    assert.match(document.querySelector('.fi-out-of-position').textContent, /out of position/);
  } finally { fm.window.close(); }
});

test('all 173 football nations field a complete natural XI of source-backed players', () => {
  assert.equal(Object.keys(NATIONS).length, 173);
  const ids = new Set();
  for (const id of Object.keys(NATIONS)) {
    const team = buildTeam(id, makeRng(1), football);
    assert.equal(team.squad.length, 11, team.name);
    assert.equal(team.real, 11, team.name);
    const lineup = selectLineup(team);
    assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), team.name);
    for (const player of team.squad) {
      assert.equal(player.gen, false);
      assert.match(player.id, /^(ea|fm):\d+$/);
      assert.ok(!ids.has(player.id), `Repeated national identity ${player.id}`);
      ids.add(player.id);
      assert.ok(Number.isInteger(player.rating) && player.rating >= 1 && player.rating <= 99);
      assert.ok(player.sourceInfo.url.startsWith('https://'));
      assert.ok(player.positions.includes(player.pos));
      assert.ok(player.sourceInfo.fullName && player.sourceInfo.snapshotDate);
    }
  }
});

test('every shipped rating and identity resolves to its exact committed database record', async () => {
  const ea = await loadEaPlayers(new URL('./data/ea-fc26.csv', import.meta.url));
  const eaById = new Map(ea.players.map(player => [player.sourceInfo.id, player]));
  const fm = JSON.parse(await readFile(new URL('./data/fm26-players.json', import.meta.url), 'utf8'));
  const fmById = new Map(fm.players.map(player => [`fm:${player.id}`, player]));
  assert.equal(ea.fictional, 316);
  assert.ok(!eaById.has('ea:230481'), 'Ronaldo Cabrais is a fictional Brazilian squad member');
  const teams = [...Object.keys(NATIONS).map(id => buildTeam(id, makeRng(1), football)),
    ...football.clubs.map(club => buildClub(club, football))];
  for (const team of teams) {
    assert.equal(new Set(team.squad.map(player => player.id)).size, 11, team.name);
    for (const player of team.squad) {
      const evidence = player.sourceInfo;
      if (evidence.source === 'ea-fc') {
        const record = eaById.get(player.id);
        assert.ok(record, player.id);
        assert.equal(player.name, record.name);
        assert.equal(player.rating, record.rating);
        assert.deepEqual(evidence, record.sourceInfo);
        if (team.kind === 'club') assert.equal(evidence.club, team.name);
      } else {
        const record = fmById.get(player.id);
        assert.ok(record, player.id);
        assert.equal(player.name, record.name);
        assert.equal(evidence.rawRating, record.currentAbility);
        assert.equal(evidence.rawScale, 100);
        assert.equal(player.rating, fmGameRating(record.currentAbility));
        assert.equal(evidence.version, fm.source.version);
        assert.equal(evidence.edition, fm.source.edition);
        assert.equal(evidence.snapshotDate, fm.source.databaseDate, 'FM ratings are dated by the database release, not the fetch');
        assert.equal(record.nationId, team.id);
      }
    }
  }
});

test('generated EA clubs are excluded by 29-February births without touching real clubs', async () => {
  const csv = await readFile(new URL('./data/ea-fc26.csv', import.meta.url), 'utf8');
  const [header, ...rows] = parseCsv(csv);
  const ea = await loadEaPlayers(new URL('./data/ea-fc26.csv', import.meta.url));
  const records = new Map(ea.players.map(player => [player.sourceInfo.id, player]));
  const generated = new Set(ea.fictionalFilter.clubs.map(club => club.clubId));
  // Regression: India's XI shipped this generated Mohammedan SC defender.
  assert.ok(!records.has('ea:279319'), 'M. Radhakrishnann (born 1996-02-29) is a generated player');
  assert.ok(!buildTeam('356', makeRng(1), football).squad.some(player => player.id === 'ea:279319'));
  assert.ok(generated.has(111633) && generated.has(114023), 'Mohammedan SC and Western United are generated in FC 26');
  const leagueRows = id => rows.filter(row => Number(row[header.indexOf('league_id')]) === id).length;
  assert.equal(ea.fictionalFilter.clubs.filter(club => club.league === 'Série A').length, 14);
  assert.equal(ea.players.filter(player => player.leagueId === 7).length, 0, 'every generated Brazilian Série A club stays excluded');
  assert.equal(ea.players.filter(player => player.leagueId === 31).length, leagueRows(31), "Italy's Serie A is untouched");
  assert.equal(ea.fictionalFilter.clubPlayers + ea.fictionalFilter.clubless.length, ea.fictional);
  assert.equal(ea.fictionalFilter.keptRealClubLeapDayBirths, 16);
  for (const id of ['ea:241461', 'ea:277031', 'ea:245741', 'ea:241775']) assert.ok(records.has(id), `${id} is a real 29-February birth`);
  const teams = [...Object.keys(NATIONS).map(id => buildTeam(id, makeRng(1), football)),
    ...football.clubs.map(club => buildClub(club, football))];
  for (const player of teams.flatMap(team => team.squad)) assert.ok(!generated.has(player.sourceInfo.clubId), `${player.id} plays for a generated club`);
});

test('the 29-February filter drops half-generated clubs and clubless players only', async () => {
  const columns = ['player_id', 'player_url', 'fifa_version', 'fifa_update', 'fifa_update_date', 'short_name', 'long_name',
    'player_positions', 'overall', 'nationality_name', 'club_name', 'club_team_id', 'league_id', 'league_name', 'league_level', 'dob'];
  const row = (id, club, clubId, dob) => [id, `/player/${id}/p/260004/`, '26', '4', '2025-09-19', `P. ${id}`, `Player ${id}`,
    'CM', '70', 'Spain', club, clubId, clubId ? '53' : '', clubId ? 'La Liga' : '', clubId ? '1' : '', dob].join(',');
  const dir = await mkdtemp(path.join(tmpdir(), 'ea-fictional-'));
  const file = path.join(dir, 'ea.csv');
  try {
    await writeFile(file, [columns.join(','),
      row(1, 'Half Generated', '900.0', '1990-02-29'), row(2, 'Half Generated', '900.0', '1991-02-29'),
      row(3, 'Half Generated', '900.0', '1992-03-01'), row(4, 'Half Generated', '900.0', '1993-05-05'),
      row(5, 'Real Club', '901.0', '2000-02-29'), row(6, 'Real Club', '901.0', '1995-06-01'), row(7, 'Real Club', '901.0', '1996-07-02'),
      row(8, '', '', '1996-02-29'), row(9, '', '', '1996-02-28')].join('\n') + '\n');
    const ea = await loadEaPlayers(file);
    assert.deepEqual(ea.players.map(player => player.sourceInfo.id), ['ea:5', 'ea:6', 'ea:7', 'ea:9']);
    assert.equal(ea.fictional, 5);
    assert.deepEqual(ea.fictionalFilter.clubs, [{ clubId: 900, club: 'Half Generated', league: 'La Liga', players: 4 }]);
    assert.deepEqual(ea.fictionalFilter.clubless, ['ea:8']);
    assert.equal(ea.fictionalFilter.keptRealClubLeapDayBirths, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('competition IDs keep foreign namesakes out of the European club leagues', async () => {
  const ea = await loadEaPlayers(new URL('./data/ea-fc26.csv', import.meta.url));
  const records = new Map(ea.players.map(player => [player.sourceInfo.id, player]));
  const expected = { 'Premier League': [13, 20], 'La Liga': [53, 20], 'Serie A': [31, 20],
    Bundesliga: [19, 18], 'Ligue 1': [16, 18], Eredivisie: [10, 18], 'Liga Portugal': [308, 18] };
  for (const [league, [competitionId, count]] of Object.entries(expected)) {
    const clubs = football.clubs.filter(club => club.league === league);
    assert.equal(clubs.length, count, league);
    for (const club of clubs) for (const player of club.squad) assert.equal(records.get(player[3].id).leagueId, competitionId, club.name);
  }
  const brazil = buildTeam('076', makeRng(1), football);
  assert.equal(brazil.squad.filter(player => /vin[ií]cius|vini jr/i.test(player.name)).length, 1, 'legal and familiar names must not duplicate Vinícius Júnior');
});

test('source parsing and FM conversion reject missing or invalid ratings instead of guessing', () => {
  assert.deepEqual(parseCsv('id,name\r\n1,"A, B"\r\n2,"C ""D"""\n'), [['id', 'name'], ['1', 'A, B'], ['2', 'C "D"']]);
  assert.throws(() => parseCsv('id,"unfinished'), /Unterminated/);
  for (const rating of [0, -1, NaN, Infinity, 101]) assert.throws(() => fmGameRating(rating), /Invalid/);
  assert.equal(fmGameRating(68), 67, 'source CA is already normalised; do not divide it by two again');
  assert.equal(fmGameRating(100), 99);
});
