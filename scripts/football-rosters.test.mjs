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
import { readFile } from 'node:fs/promises';
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

test('all 170 football nations field a complete natural XI of source-backed players', () => {
  assert.equal(Object.keys(NATIONS).length, 170);
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
  assert.equal(ea.fictional, 280);
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
        assert.equal(record.nationId, team.id);
      }
    }
  }
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
