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
import { ageOn, clubsAgree, eaNameForms, fmAgeDate, fmGameRating, linkingCheck, loadEaPlayers, loadFootballData, nameTokens, normalName,
  parseCsv, pickNationSquads, readIdentityOverrides, readReepBridge, resolvePersons } from './lib/football-data.mjs';
import { foldTokens, namesAgree } from './lib/reep-bridge.mjs';
import { decodeFootballSet, fieldedNations } from '../src/engine/footballSets.js';
import { TOP_CLUBS, strongestClubs } from '../src/data/scopes.js';

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

test('every nation football fields has a complete natural XI of source-backed players', () => {
  assert.equal(Object.keys(NATIONS).length, 176);
  // No source rates a Tongan, Samoan or Cook Islands player: those three field no team, and nobody else is left out.
  assert.deepEqual(football.territory, { merged: {}, inactive: ['184', '776', '882'] });
  for (const id of football.territory.inactive) assert.deepEqual(football.rosters[id], [40, 0, []], NATIONS[id][0]);
  assert.equal(fieldedNations(football).length, 173);
  const ids = new Set();
  for (const id of fieldedNations(football)) {
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
  const ea = await loadEaPlayers(new URL('./data/ea-fc27.csv', import.meta.url));
  const eaById = new Map(ea.players.map(player => [player.sourceInfo.id, player]));
  const fm = JSON.parse(await readFile(new URL('./data/fm26-players.json', import.meta.url), 'utf8'));
  const fmById = new Map(fm.players.map(player => [`fm:${player.id}`, player]));
  // EA's ratings site lists no generated squads, so the 29-February rule finds none in EA FC 27.
  assert.equal(ea.fictional, 0);
  assert.equal(ea.fictionalFilter.keptRealClubLeapDayBirths, 18);
  const teams = [...fieldedNations(football).map(id => buildTeam(id, makeRng(1), football)),
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
  assert.equal(ea.fictional, 316);
  assert.ok(!records.has('ea:230481'), 'Ronaldo Cabrais is a fictional Brazilian squad member');
  // EA FC 26 plays as the 2025/26 season (public/football/ea-fc-26.json), built from these records.
  const season = decodeFootballSet(JSON.parse(await readFile(new URL('../public/football/ea-fc-26.json', import.meta.url), 'utf8')));
  const seasonSport = { ...football, rosters: season.rosters, clubs: season.clubs, fallbackStrength: () => 40 };
  // Regression: India's XI shipped this generated Mohammedan SC defender.
  assert.ok(!records.has('ea:279319'), 'M. Radhakrishnann (born 1996-02-29) is a generated player');
  assert.ok(!buildTeam('356', makeRng(1), seasonSport).squad.some(player => player.id === 'ea:279319'));
  assert.ok(generated.has(111633) && generated.has(114023), 'Mohammedan SC and Western United are generated in FC 26');
  const leagueRows = id => rows.filter(row => Number(row[header.indexOf('league_id')]) === id).length;
  assert.equal(ea.fictionalFilter.clubs.filter(club => club.league === 'Série A').length, 14);
  assert.equal(ea.players.filter(player => player.leagueId === 7).length, 0, 'every generated Brazilian Série A club stays excluded');
  assert.equal(ea.players.filter(player => player.leagueId === 31).length, leagueRows(31), "Italy's Serie A is untouched");
  assert.equal(ea.fictionalFilter.clubPlayers + ea.fictionalFilter.clubless.length, ea.fictional);
  assert.equal(ea.fictionalFilter.keptRealClubLeapDayBirths, 16);
  for (const id of ['ea:241461', 'ea:277031', 'ea:245741', 'ea:241775']) assert.ok(records.has(id), `${id} is a real 29-February birth`);
  const teams = [...Object.keys(NATIONS).map(id => buildTeam(id, makeRng(1), seasonSport)),
    ...seasonSport.clubs.map(club => buildClub(club, seasonSport))];
  const players = teams.flatMap(team => team.squad);
  assert.ok(players.length > 2000, 'the season fields its EA players');
  for (const player of players) assert.ok(records.has(player.id), `${player.id} plays for a generated club`);
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
  const ea = await loadEaPlayers(new URL('./data/ea-fc27.csv', import.meta.url));
  const records = new Map(ea.players.map(player => [player.sourceInfo.id, player]));
  const expected = { 'Premier League': 13, 'La Liga': 53, 'Serie A': 31, Bundesliga: 19, 'Ligue 1': 16, Eredivisie: 10, 'Liga Portugal': 308,
    'Süper Lig': 68, 'Belgian Pro League': 4, 'Greek Super League': 63, 'Czech First League': 319, 'Scottish Premiership': 50, 'Danish Superliga': 1,
    Eliteserien: 41, 'Ukrainian Premier League': 332, 'Croatian HNL': 317, 'Bulgarian First League': 0 };
  assert.equal(football.clubs.length, TOP_CLUBS, 'the strongest clubs in Europe, and no others');
  assert.deepEqual(football.clubs, strongestClubs(football.clubs, TOP_CLUBS), 'strongest first, as the theatres take them');
  for (const club of football.clubs) {
    assert.ok(Object.hasOwn(expected, club.league), `${club.name} plays in ${club.league}`);
    // Ludogorets is the one first-division club EA lists under no competition.
    for (const player of club.squad) assert.equal(records.get(player[3].id).leagueId, expected[club.league], club.name);
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

// ---- one record per real player, one nation per person (docs/design/football-squad-identity.md) ----
const readJson = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const bridgeJson = await readJson('scripts/data/reep-bridge.json');
const overridesJson = await readJson('scripts/data/football-identity-overrides.json');
const builtInAudit = await readJson('docs/design/football-roster-audit.json');
const EA_FILE = new URL('./data/ea-fc27.csv', import.meta.url), FM_FILE = new URL('./data/fm26-players.json', import.meta.url);
// The built-in's records resolved to persons, as build-rosters resolves them.
let identityPromise = null;
const builtInIdentity = () => (identityPromise ||= loadFootballData(EA_FILE, FM_FILE,
  { bridge: readReepBridge(bridgeJson), overrides: readIdentityOverrides(overridesJson) }));
/** Shirt source id -> nation id, for the built-in national XIs. */
const fieldedIds = () => new Map(Object.entries(football.rosters).flatMap(([nation, [, , players]]) => players.map(tuple => [tuple[3].id, nation])));
/** Every national XI shirt with an age on the FM snapshot's age date: EA from the birth date, FM from the snapshot's age
 * (the tuple does not carry it). */
async function nationalShirts() {
  const fm = JSON.parse(await readFile(FM_FILE, 'utf8'));
  const fmAge = new Map(fm.players.map(player => [`fm:${player.id}`, player.age]));
  const ageDate = fmAgeDate(fm.source.databaseDate);
  return Object.entries(football.rosters).flatMap(([nation, [, , players]]) => players.map(([name, , , info]) => ({ nation, name, info,
    age: info.source === 'ea-fc' ? ageOn(info.dateOfBirth, ageDate) : fmAge.get(info.id) })));
}
const shirtLabel = shirt => `${NATIONS[shirt.nation][0]} ${shirt.name} (${shirt.info.id}, ${shirt.age})`;
// EA and FM shirts of one XI that share a surname and an age within a year, yet are two people: "<ea id> <fm id>":
// reason. None so far.
const DISTINCT_NAMESAKES = {};
/** Whether a `distinct` override lists both records: hand-checked as two people. */
const listedApart = (overrides, a, b) => a !== b && overrides.distinct.some(({ ids }) => ids.includes(a) && ids.includes(b));

/** Persons whose keys disagree with the bridge (`keys`: record id -> Reep id). A person holding a Reep id is keyed by
 * one of its records' Reep ids, and a bridged record keeps its own, unless a `same` override joined it to another Reep
 * person, or a `distinct` entry lists it beside another record of its Reep person: resolvePersons then keeps the Reep
 * id on one of them and detaches the others, which are keyed like records without one. */
function personKeyProblems(persons, keys, overrides) {
  const joined = new Set(overrides.same.flatMap(entry => entry.ids));
  const detachable = new Set(overrides.distinct.flatMap(({ ids }) => ids.filter(a => keys.has(a) && ids.some(b => b !== a && keys.get(b) === keys.get(a)))));
  const personKeys = new Set(persons.map(person => person.key)), problems = [];
  for (const person of persons) {
    const records = [...person.ea, ...person.fm].map(record => record.sourceInfo.id);
    const reepIds = records.filter(id => !detachable.has(id) || keys.get(id) === person.key).map(id => keys.get(id)).filter(Boolean);
    if (reepIds.length ? !reepIds.includes(person.key) : !records.includes(person.key)) problems.push(`${person.key} is not a key of ${records.join(' ')}`);
    for (const id of records) {
      if (!keys.has(id) || joined.has(id) || person.key === keys.get(id)) continue;
      // Detached: another record of its Reep person keeps the Reep id.
      if (!detachable.has(id) || !personKeys.has(keys.get(id))) problems.push(`${id} is ${keys.get(id)} in the bridge but keyed ${person.key}`);
    }
  }
  return problems;
}

/** Reep persons (kept or rejected links) with two fielded records that no `distinct` override lists together.
 * `fielded` maps a record id to its nation. */
function reepPersonsFieldedTwice(fielded, bridge, overrides) {
  const found = [];
  for (const { reep, ea, fm } of [...bridge.persons.map(([reep, ea, fm]) => ({ reep, ea, fm })), ...bridge.rejected]) {
    const ids = [...ea.map(id => `ea:${id}`), ...fm.map(id => `fm:${id}`)].filter(id => fielded.has(id));
    // A Reep link a distinct entry overrules, or one the reducer rejected and two hand-checked records prove wrong,
    // may field both.
    if (ids.some((a, i) => ids.slice(i + 1).some(b => !listedApart(overrides, a, b)))) found.push(`${reep}: ${ids.map(id => `${id} (${fielded.get(id)})`).join(', ')}`);
  }
  return found;
}

/** Shirts of two nations that share a name and an age within a year: every EA name form resolvePersons compares
 * across nations (long, legal, and an unabbreviated short name), and FM's name. `eaRecords` maps an EA id to its loaded
 * record (the shipped tuple does not carry the legal name). */
function namesakesAcrossNations(shirts, eaRecords) {
  const byName = new Map(), found = new Set();
  for (const shirt of shirts) {
    const forms = shirt.info.source === 'ea-fc' ? eaNameForms(eaRecords.get(shirt.info.id)) : [normalName(shirt.info.fullName)];
    for (const name of forms) {
      for (const other of byName.get(name) || []) {
        if (other.nation !== shirt.nation && Math.abs(other.age - shirt.age) <= 1) found.add(`${shirtLabel(other)} = ${shirtLabel(shirt)}`);
      }
    }
    for (const name of forms) byName.set(name, [...(byName.get(name) || []), shirt]);
  }
  return [...found];
}

test('the shipped XIs are the build\'s: one record per person, in the pool of its nation', async () => {
  const data = await builtInIdentity();
  const nameToId = Object.fromEntries(Object.entries(NATIONS).map(([id, rec]) => [rec[0], id]));
  const pools = Object.fromEntries(Object.keys(NATIONS).map(id => [id, []]));
  for (const { nation, player } of data.persons) if (nameToId[nation]) pools[nameToId[nation]].push(player);
  const picked = pickNationSquads(pools);
  const stale = 'src/data/rosters.js is stale against its sources, the Reep bridge or the identity overrides; run npm run build-rosters';
  for (const id of Object.keys(NATIONS)) {
    const [, pool, players] = football.rosters[id];
    assert.equal(pool, picked[id].pool.length, `${stale} (${NATIONS[id][0]}'s pool)`);
    assert.deepEqual(players.map(tuple => tuple[3].id), picked[id].squad.map(player => player.sourceInfo.id), `${stale} (${NATIONS[id][0]}'s XI)`);
  }
  assert.deepEqual(builtInAudit.coverage.map(row => row.personKeys), Object.keys(NATIONS).map(id => picked[id].squad.map(player => player.personKey)), stale);
  assert.deepEqual(builtInAudit.linking, data.linking, stale);
  assert.equal(builtInAudit.fresherSource, 'ea', 'EA FC 27 (2026-11-01) postdates FM 26 26.3.0 (2026-03-30)');
});

// Regressions: EA's ratings API gives first + last name only ("Rahim Alhassane"), so FM's "Abdel Rahim Alhassane" once
// passed the duplicate check and one left back filled two shirts; EA "A. Fayzullaev" and FM "Abbosbek Fayzullayev", one
// Reep person, both started for Uzbekistan, and FM "Gytis Paulauskas" beside EA "G. Paulauskaas" for Lithuania.
// Romanised surnames count too (the Reep reducer's rule, for FM names of two or more words: a lone "Basilio" is not
// Saúl Basilio Coco).
test('no XI fields one person from both EA and FM (surname and age within a year)', async () => {
  const surname = name => nameTokens(name).at(-1);
  const shirts = await nationalShirts(), found = [];
  for (const ea of shirts.filter(shirt => shirt.info.source === 'ea-fc')) {
    for (const fm of shirts.filter(shirt => shirt.nation === ea.nation && shirt.info.source === 'football-manager')) {
      const same = [ea.name, ea.info.fullName].map(surname).includes(surname(fm.name))
        || (foldTokens(fm.name).length >= 2 && namesAgree([ea.name, ea.info.fullName], fm.name));
      if (!same || Math.abs(ea.age - fm.age) > 1) continue;
      if (!DISTINCT_NAMESAKES[`${ea.info.id} ${fm.info.id}`]?.trim()) found.push(`${shirtLabel(ea)} = ${shirtLabel(fm)}`);
    }
  }
  assert.deepEqual(found, []);
  const ids = id => football.rosters[id][2].map(tuple => tuple[3].id);
  assert.equal(ids('860').filter(id => ['ea:80304', 'fm:2000022271'].includes(id)).length, 1, 'Abbosbek Fayzullaev starts once');
  assert.equal(ids('440').filter(id => ['ea:83267', 'fm:47075014'].includes(id)).length, 1, 'Gytis Paulauskas starts once');
  assert.ok(ids('562').includes('ea:73502') && !ids('562').includes('fm:2000131530'), 'R. Alhassane is Abdel Rahim Alhassane');
});

// Regression: EA files Nair Tiknizyan under Russia and FM under Armenia, and both XIs fielded him. By name: every EA
// name form the resolver compares (long, legal, unabbreviated short) or FM's name, plus a birth year within one (ages on
// the FM age date), from any source. By key: each shirt's person key, from the audit, checked against the bridge.
test('no person starts for two nations, by name or by person key', async () => {
  const data = await builtInIdentity();
  const eaRecords = new Map(data.ea.players.map(player => [player.sourceInfo.id, player]));
  assert.deepEqual(namesakesAcrossNations(await nationalShirts(), eaRecords), []);
  const { keys } = readReepBridge(bridgeJson);
  assert.deepEqual(personKeyProblems(data.persons, keys, overridesJson), []);
  const keyOf = new Map(data.persons.flatMap(person => [...person.ea, ...person.fm].map(record => [record.sourceInfo.id, person.key])));
  const owner = new Map();
  for (const row of builtInAudit.coverage) {
    const players = football.rosters[row.id][2];
    assert.equal(row.personKeys.length, players.length, `${row.name}: one key per shirt`);
    players.forEach((tuple, index) => {
      const key = row.personKeys[index], id = tuple[3].id;
      assert.equal(key, keyOf.get(id), `${id}'s audited person key`);
      assert.ok(!owner.has(key), `${key} (${id}) starts for ${owner.get(key)} and ${row.id}`);
      owner.set(key, row.id);
    });
  }
});

test('no two records of one Reep person start, including links the reducer rejected', () => {
  assert.deepEqual(reepPersonsFieldedTwice(fieldedIds(), bridgeJson, overridesJson), []);
});

// The name matcher's near misses are name matches it kept apart (ages differ, a one-word FM name, or across nations a
// missing shared club, a second Reep person or ambiguity). Should both records start, they are either one person (a
// `same` override joins them, and the near miss goes) or two, which a `distinct` override records after a hand check.
test('no near miss fields both its records unless a distinct override lists them', async () => {
  const fielded = fieldedIds();
  const { nearMisses } = builtInAudit.identity.fallback;
  assert.ok(nearMisses.length > 0 && nearMisses.every(miss => miss.ea.id.startsWith('ea:') && miss.fm.id.startsWith('fm:') && miss.reason), 'near misses are logged');
  const found = nearMisses.filter(miss => fielded.has(miss.ea.id) && fielded.has(miss.fm.id) && !listedApart(overridesJson, miss.ea.id, miss.fm.id));
  assert.deepEqual(found.map(miss => `${miss.ea.id} ${miss.ea.name} (${miss.ea.nation}) = ${miss.fm.id} ${miss.fm.name} (${miss.fm.nation}): ${miss.reason}`), []);
  // The audit logs the resolver's near misses, in its order.
  const data = await builtInIdentity();
  assert.deepEqual(nearMisses.map(miss => [miss.ea.id, miss.fm.id, miss.reason]),
    data.identity.nearMisses.map(miss => [miss.ea.sourceInfo.id, miss.fm.sourceInfo.id, miss.reason]));
});

test('identity overrides are honoured', async () => {
  const data = await builtInIdentity(), fielded = fieldedIds();
  const byId = new Map([...data.ea.players, ...data.persons.flatMap(person => person.fm)].map(player => [player.sourceInfo.id, player]));
  let same = 0;
  for (const { ids } of overridesJson.same) {
    const present = ids.filter(id => byId.has(id));
    if (present.length < 2) continue;
    same++;
    assert.equal(new Set(present.map(id => byId.get(id).personKey)).size, 1, `${present.join(' ')} are one person`);
    assert.ok(present.filter(id => fielded.has(id)).length <= 1, `${present.join(' ')} start once`);
  }
  for (const { ids } of overridesJson.distinct) {
    const present = ids.filter(id => byId.has(id));
    assert.equal(new Set(present.map(id => byId.get(id).personKey)).size, present.length, `${present.join(' ')} are different people`);
  }
  assert.equal(builtInAudit.identity.overrides.same, same);
  // Pote is FM's nickname for Pedro Gonçalves; the reducer rejected Reep's link on the name, and the override restores
  // it under his Reep id.
  const pote = byId.get('fm:29192705');
  assert.ok(pote && pote.personKey === 'rpd878e203323a97' && byId.get('ea:240950').personKey === pote.personKey);
  // A nations entry decides its person's nation, whatever the fresher source says, and its records start only there.
  const persons = new Map(data.persons.map(person => [person.key, person]));
  for (const entry of overridesJson.nations) {
    const person = persons.get(byId.get(entry.ids[0]).personKey);
    assert.deepEqual([...person.ea, ...person.fm].map(record => record.sourceInfo.id).sort(), entry.ids.slice().sort(), `${entry.name}: the entry lists every record`);
    assert.equal(person.nation, entry.nation, entry.name);
    for (const id of entry.ids) if (fielded.has(id)) assert.equal(NATIONS[fielded.get(id)][0], entry.nation, `${entry.name} starts for ${entry.nation} only`);
  }
  assert.equal(builtInAudit.identity.overrides.nations, overridesJson.nations.length);
  // Nair Tiknizyan: EA FC 27 says Russia, but his 35 senior caps are Armenia's; EA's record represents him there.
  const ids = id => football.rosters[id][2].map(tuple => tuple[3].id);
  assert.ok(ids('051').includes('ea:244881') && !ids('643').includes('ea:244881') && !ids('051').includes('fm:58133443'));
  assert.deepEqual(builtInAudit.nationArbitration.find(entry => entry.personKey === 'rp9c98e6c31b0b45'), { personKey: 'rp9c98e6c31b0b45',
    ea: { id: 'ea:244881', nation: '643 Russia' }, fm: { id: 'fm:58133443', nation: '051 Armenia' }, chosen: '051 Armenia', rule: 'override' });
  assert.throws(() => readIdentityOverrides({ ...overridesJson, nations: [{ ids: ['ea:1'], evidence: 'x' }] }), /names no nation/);
  assert.throws(() => readIdentityOverrides({ ...overridesJson, nations: [{ ids: ['ea:1'], nation: 'Spain' }] }), /no evidence/);
});

test('every nation conflict is logged and follows an override, then the fresher-source rule', async () => {
  const data = await builtInIdentity(), audit = builtInAudit, fielded = fieldedIds();
  const nationId = Object.fromEntries(Object.entries(NATIONS).map(([id, rec]) => [rec[0], id]));
  const label = nation => (nationId[nation] ? `${nationId[nation]} ${nation}` : nation);
  const persons = new Map(data.persons.map(person => [person.key, person]));
  assert.match(audit.nationArbitrationRule, /\(a\) override.*\(b\) fresher-ea \/ fresher-fm.*\(c\) ea-nationality/);
  for (const entry of audit.nationArbitration) {
    const person = persons.get(entry.personKey);
    assert.ok(person, `${entry.personKey} is a person`);
    assert.ok(['fresher-ea', 'ea-nationality', 'override'].includes(entry.rule), `${entry.personKey}: rule ${entry.rule}`);
    if (entry.rule === 'fresher-ea') {
      assert.ok(entry.ea && entry.fm && entry.ea.nation !== entry.fm.nation, entry.personKey);
      assert.equal(entry.chosen, entry.ea.nation, entry.personKey);
    }
    for (const side of ['ea', 'fm']) {
      if (entry[side]) assert.ok(person[side].some(record => record.sourceInfo.id === entry[side].id && label(record.nation) === entry[side].nation), `${entry.personKey} ${side}`);
    }
    assert.equal(label(person.nation), entry.chosen, entry.personKey);
    // Whichever record represents the person starts, if at all, for the chosen nation.
    for (const record of [...person.ea, ...person.fm]) {
      if (fielded.has(record.sourceInfo.id)) assert.equal(fielded.get(record.sourceInfo.id), entry.chosen.split(' ')[0], `${record.sourceInfo.id} plays for ${entry.chosen}`);
    }
  }
  // Complete: every person whose records name two nations has one entry, and every Reep pair across two nations is a
  // person.
  const logged = new Set(audit.nationArbitration.map(entry => entry.personKey));
  const conflicted = data.persons.filter(person => new Set([...person.ea, ...person.fm].map(record => record.nation)).size > 1).map(person => person.key);
  assert.deepEqual(conflicted.sort(), [...logged].sort());
  assert.equal(logged.size, audit.nationArbitration.length);
  const { keys } = readReepBridge(bridgeJson);
  const records = new Map([...data.ea.players, ...data.persons.flatMap(person => person.fm)].map(player => [player.sourceInfo.id, player]));
  for (const [reep, ea, fm] of bridgeJson.persons) {
    const [e, f] = [records.get(`ea:${ea[0]}`), records.get(`fm:${fm[0]}`)];
    if (e && f && e.nation !== f.nation) assert.ok(logged.has(reep) && keys.get(e.sourceInfo.id) === reep, `${reep}: ${e.nation} / ${f.nation}`);
  }
});

test('the FM duplicate check matches API first + last names, carried legal names and ages', async () => {
  const columns = ['player_id', 'player_url', 'fifa_version', 'fifa_update', 'fifa_update_date', 'short_name', 'long_name',
    'player_positions', 'overall', 'nationality_id', 'nationality_name', 'club_name', 'club_team_id', 'league_id', 'league_name',
    'league_level', 'dob', 'reference_long_name'];
  const row = (id, short, long, nation, dob, legal = '') => [id, `https://www.ea.com/games/ea-sports-fc/ratings/player-ratings/p/${id}`, '27', '',
    '2026-11-01', short, long, 'CM', '70', '1', nation, 'Club', '9', '', '', '', dob, legal].map(value => `"${value}"`).join(',');
  const fmRecord = (id, name, age, nationId) => ({ id, name, age, gender: 'Male', nationId, primaryNationality: { name: nationId },
    clubName: 'Club', currentAbility: 70, positionProficiency: { cm: 100 }, url: `https://efem.club/players/${id}` });
  const dir = await mkdtemp(path.join(tmpdir(), 'fm-duplicates-'));
  try {
    await writeFile(path.join(dir, 'ea.csv'), [columns.join(','),
      row(73502, 'R. Alhassane', 'Rahim Alhassane', 'Niger', '2002-01-01'),
      row(254909, 'O. Dorley', 'Oscar Dorley', 'Liberia', '1998-07-19', 'Murphy Oscar Dorley'),
      row(200741, 'Jiang Guangtai', 'Guangtai Jiang', 'China PR', '1994-05-27', 'Jiang GuangtaiTyias Charles Browning 蒋光太'),
      row(204699, 'L. Melgarejo', 'Lorenzo Melgarejo', 'Paraguay', '1990-08-10', 'Lorenzo Antonio Melgarejo Sanabria')].join('\n') + '\n');
    await writeFile(path.join(dir, 'fm.json'), JSON.stringify({
      source: { edition: 'FM 26', version: '26.3.0', databaseDate: '2026-03-30' },
      nations: ['Niger', 'Liberia', 'China', 'Paraguay'].map(name => ({ nationId: name, nationName: name })),
      players: [fmRecord(1, 'Abdel Rahim Alhassane', 23, 'Niger'), fmRecord(2, 'Abdel Rahim Alhassane', 31, 'Niger'),
        fmRecord(3, 'Oscar', 26, 'Liberia'), fmRecord(4, 'Tyias Browning', 31, 'China'), fmRecord(5, 'Antonio Sanabria', 29, 'Paraguay')],
    }));
    const data = await loadFootballData(path.join(dir, 'ea.csv'), path.join(dir, 'fm.json'));
    assert.equal(data.ageDate, '2025-07-01', 'EFEM ages count from the FM season start');
    assert.equal(data.fresher, 'ea', 'the EA snapshot postdates the FM database');
    // fm:1 is EA's Alhassane (every EA token; 23 on 1 July 2025 from 2002-01-01); fm:2 shares the name but is eight
    // years older, so another person. fm:3 matches the API name only, by one word, so it is left out rather than
    // joined; fm:4 the carried FC 26 legal name only (same age); fm:5's tokens are in a legal name too, of a man six
    // years older.
    assert.deepEqual(data.players.filter(player => player.sourceInfo.source === 'football-manager').map(player => player.sourceInfo.id), ['fm:2', 'fm:5']);
    const dorley = data.ea.players.find(player => player.sourceInfo.id === 'ea:254909');
    assert.equal(dorley.sourceInfo.fullName, 'Oscar Dorley', 'the API name stays the shipped full name');
    assert.equal(dorley.referenceFullName, 'Murphy Oscar Dorley');
    assert.equal('referenceFullName' in dorley.sourceInfo, false, 'the legal name stays out of the tuple');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// resolvePersons fixtures: EA records carry a birth date, FM records an age.
const eaRecord = (id, name, fullName, nation, dateOfBirth, club = 'Club', rating = 70) => ({ name, pos: 'MF', positions: ['MF'], rating, nation, club,
  referenceFullName: null, sourceInfo: { id: `ea:${id}`, fullName, source: 'ea-fc', dateOfBirth } });
const fmRecord = (id, name, nation, age, club = 'Club', rating = 70) => ({ name, pos: 'MF', positions: ['MF'], rating, nation, club, age,
  sourceInfo: { id: `fm:${id}`, fullName: name, source: 'football-manager' } });
const NO_OVERRIDES = { same: [], distinct: [], nations: [] };

test('person keys: Reep first, then overrides, then the name matcher; one nation per person by the fresher source', () => {
  const ea = eaRecord, fm = fmRecord;
  const records = () => ({
    ea: [ea(1, 'N. Tiknizyan', 'Nair Tiknizyan', 'Russia', '1999-05-12'), ea(2, 'A. Dieng', 'Amadou Bamba Dieng', 'Senegal', '2005-05-13'),
      ea(3, 'J. Doe', 'John Doe', 'Spain', '1999-01-01'), ea(4, 'I. Karamoko', 'Ibrahim Karamoko', 'France', '2001-06-23', 'Standard de Liège'),
      ea(5, 'P. Díaz', 'Pedro Díaz', 'Spain', '1998-06-05', 'Rayo Vallecano'), ea(6, 'Pedro Gonçalves', 'Pedro António Pereira Gonçalves', 'Portugal', '1998-06-28'),
      ea(7, 'K. Twin', 'Kim Twin', 'Iceland', '2002-01-18')],
    fm: [fm(11, 'Nair Tiknizyan', 'Armenia', 26), fm(12, 'Bamba Dieng', 'Senegal', 25), fm(13, 'John Doe', 'Spain', 26),
      fm(14, 'Ibrahim Karamoko', 'Guinea', 23, 'Standard'), fm(15, 'Pedro Díaz', 'Peru', 27, 'Cusco FC'), fm(16, 'Pote', 'Portugal', 27),
      fm(17, 'Kim Twin', 'Iceland', 23)],
  });
  const bridge = { keys: new Map([['ea:1', 'rp000000000000a1'], ['fm:11', 'rp000000000000a1'], ['ea:2', 'rp000000000000b2'],
    ['fm:12', 'rp000000000000c3'], ['ea:6', 'rp000000000000d4'], ['fm:17', 'rp000000000000f6'], ['fm:15', 'rp00000000000010']]) };
  const overrides = { same: [{ ids: ['ea:6', 'fm:16'], evidence: 'nickname' }], distinct: [{ ids: ['ea:7', 'fm:17'], evidence: 'test' }], nations: [] };
  // The name matcher's within-nation matches (mayBeSamePlayer's output).
  const matches = new Map([['fm:12', [2]], ['fm:13', [3]], ['fm:17', [7]]]);
  const run = (fresher, nations = []) => {
    const data = records(), byId = new Map([...data.ea, ...data.fm].map(player => [player.sourceInfo.id, player]));
    const found = new Map([...matches].map(([id, eaIds]) => [id, eaIds.map(n => byId.get(`ea:${n}`))]));
    return { ...resolvePersons({ ...data, matches: found, bridge, overrides: { ...overrides, nations }, fresher, ageDate: '2025-07-01' }), byId };
  };
  for (const fresher of ['fm', 'ea']) {
    const { persons, arbitration, nearMisses, byId } = run(fresher);
    const key = id => byId.get(id).personKey, person = id => persons.find(entry => entry.key === key(id));
    // Reep: Tiknizyan is one person; FM's Armenia wins when FM is the fresher source, EA's Russia when EA is; EA's
    // record represents him.
    assert.equal(key('fm:11'), 'rp000000000000a1');
    assert.equal(person('ea:1').nation, fresher === 'fm' ? 'Armenia' : 'Russia');
    assert.equal(person('ea:1').player.sourceInfo.id, 'ea:1');
    // Two Reep persons are never joined by name (Dieng 20 vs Bamba Dieng 25).
    assert.notEqual(key('ea:2'), key('fm:12'));
    // No Reep id on either side: the name matcher joins them, keyed by the EA id.
    assert.equal(key('fm:13'), 'ea:3');
    // Across nations: a shared club joins Karamoko (no Reep id on the EA side); Pedro Díaz of Rayo and of Cusco stay
    // apart as a near miss.
    assert.equal(key('fm:14'), 'ea:4');
    assert.equal(person('ea:4').nation, fresher === 'fm' ? 'Guinea' : 'France');
    assert.deepEqual(nearMisses.map(miss => [miss.ea.sourceInfo.id, miss.fm.sourceInfo.id, miss.reason]), [['ea:5', 'fm:15', 'clubs differ']]);
    // Overrides: Pote joins Pedro Gonçalves under his Reep id; a distinct entry keeps a name match apart.
    assert.equal(key('fm:16'), 'rp000000000000d4');
    assert.notEqual(key('ea:7'), key('fm:17'));
    const rule = fresher === 'fm' ? 'fresher-fm' : 'fresher-ea';
    assert.deepEqual(arbitration.map(entry => [entry.personKey, entry.ea.nation, entry.fm.nation, entry.chosen, entry.rule]), [
      ['rp000000000000a1', 'Russia', 'Armenia', fresher === 'fm' ? 'Armenia' : 'Russia', rule],
      ['ea:4', 'France', 'Guinea', fresher === 'fm' ? 'Guinea' : 'France', rule]]);
    assert.equal(new Set(persons.map(entry => entry.key)).size, persons.length);
  }
  // A nations override decides over the fresher source; it must list every record of the person, name one of their
  // nations, and decide a conflict.
  const decided = run('ea', [{ ids: ['ea:1', 'fm:11'], nation: 'Armenia', evidence: 'caps' }]);
  assert.deepEqual(decided.arbitration[0], { personKey: 'rp000000000000a1', ea: { id: 'ea:1', nation: 'Russia' }, fm: { id: 'fm:11', nation: 'Armenia' }, chosen: 'Armenia', rule: 'override' });
  assert.equal(decided.stats.overrides.nations, 1);
  assert.throws(() => run('ea', [{ ids: ['ea:1'], nation: 'Armenia', evidence: 'caps' }]), /must list every record of person rp000000000000a1/);
  assert.throws(() => run('ea', [{ ids: ['ea:1', 'fm:11'], nation: 'Spain', evidence: 'caps' }]), /gives Spain, which none of the person's records names/);
  assert.throws(() => run('ea', [{ ids: ['ea:3', 'fm:13'], nation: 'Spain', evidence: 'caps' }]), /nations entries that decide no conflict: ea:3 fm:13/);
  assert.ok(clubsAgree('Standard de Liège', 'Standard') && clubsAgree('Al Ain', 'Al-Ain') && !clubsAgree('Real Madrid', 'Real Betis'));
  assert.throws(() => resolvePersons({ ...records(), fresher: 'both' }), /fresher must be/);
  assert.throws(() => readIdentityOverrides({ same: [{ ids: ['ea:1', 'fm:2'], evidence: 'x' }], distinct: [{ ids: ['fm:2', 'ea:1'], evidence: 'y' }] }), /both one person and two/);
  assert.throws(() => readIdentityOverrides({ same: [{ ids: ['ea:1', 'fm:2'] }] }), /no evidence/);
  assert.deepEqual(linkingCheck([]), { pairs: 0, meanEaMinusFm: 0, ci95: [0, 0] });
});

// Regression: a fallback that joined any one-to-one name match within a nation, whatever the ages, made different
// people one person (EA FC 26's Danilo of Rangers, 26, and FM 26's Danilo of Botafogo, 24, whom Reep links to EA 273106
// of FC 27).
test('the name matcher joins only on agreeing ages, never a one-word FM name, never a record whose Reep person names another', () => {
  const data = {
    ea: [eaRecord(21, 'A. Traore', 'Abdoul Karim Traoré', 'Mali', '2005-01-11'), eaRecord(22, 'Gavi', 'Pablo Martín Páez Gavira', 'Spain', '2004-08-05'),
      eaRecord(23, 'J. Silva', 'João Silva', 'Brazil', '2000-01-01'), eaRecord(24, 'K. Lee', 'Kim Lee', 'South Korea', '2000-01-01'),
      eaRecord(25, 'M. Sangaré', 'Mamadou Sangaré', 'Mali', '2002-06-26'), eaRecord(27, 'P. Díaz', 'Pedro Díaz', 'Spain', '1998-06-05', 'Rayo Vallecano')],
    fm: [fmRecord(31, 'Adama Traoré', 'Mali', 26), fmRecord(32, 'Gavi', 'Spain', 20), fmRecord(33, 'João Silva', 'Brazil', 25),
      fmRecord(34, 'Kim Lee', 'South Korea', 25), fmRecord(35, 'Mamadou Sangaré', 'Mali', 23), fmRecord(36, 'Mustapha Sangaré', 'Mali', 26),
      fmRecord(37, 'Pedro Díaz', 'Peru', 27, 'Rayo Vallecano')],
  };
  const byId = new Map([...data.ea, ...data.fm].map(player => [player.sourceInfo.id, player]));
  const matches = new Map([['fm:31', ['ea:21']], ['fm:32', ['ea:22']], ['fm:33', ['ea:23']], ['fm:34', ['ea:24']],
    ['fm:35', ['ea:25']], ['fm:36', ['ea:25']]].map(([id, eaIds]) => [id, eaIds.map(other => byId.get(other))]));
  // The whole bridge: FM 33's Reep person is EA 98, EA 24's is FM 97 and FM 37's is EA 99, records of another snapshot.
  const bridge = {
    keys: new Map([['ea:22', 'rp000000000000a2'], ['fm:33', 'rp000000000000b3'], ['ea:24', 'rp000000000000c4'], ['fm:37', 'rp000000000000d7']]),
    persons: new Map([['rp000000000000a2', { ea: ['ea:22'], fm: [] }], ['rp000000000000b3', { ea: ['ea:98'], fm: ['fm:33'] }],
      ['rp000000000000c4', { ea: ['ea:24'], fm: ['fm:97'] }], ['rp000000000000d7', { ea: ['ea:99'], fm: ['fm:37'] }]]),
  };
  const identity = resolvePersons({ ...data, matches, bridge, fresher: 'fm', ageDate: '2025-07-01' });
  const key = id => byId.get(id).personKey;
  // Ages differ: EA's Abdoul Karim Traoré (20) is not FM's Adama Traoré (26); both stay, logged.
  assert.deepEqual([key('ea:21'), key('fm:31')], ['ea:21', 'fm:31']);
  // One word: FM's Gavi has no birth date to confirm EA's Gavi, so it never joins; with a same-name, same-age EA record
  // it is left out, logged.
  assert.equal(key('ea:22'), 'rp000000000000a2');
  assert.ok(identity.omitted.includes('fm:32') && !identity.persons.some(person => person.fm.includes(byId.get('fm:32'))));
  // Reep names another record: both pairs have equal names and ages, but Reep puts FM 33 with EA 98 and EA 24 with FM 97.
  assert.deepEqual([key('ea:23'), key('fm:33'), key('ea:24'), key('fm:34')], ['ea:23', 'rp000000000000b3', 'rp000000000000c4', 'fm:34']);
  // Ages decide ambiguity too: only Mamadou Sangaré (23) claims EA's M. Sangaré (born 2002); Mustapha (26) is another
  // person, no longer a rival claim.
  assert.deepEqual([key('fm:35'), key('fm:36')], ['ea:25', 'fm:36']);
  // Across nations too: a shared club and one Reep id would join the Pedro Díaz twins, but Reep puts FM 37 with EA 99.
  assert.deepEqual([key('ea:27'), key('fm:37')], ['ea:27', 'rp000000000000d7']);
  assert.deepEqual(identity.nearMisses.map(miss => [miss.ea.sourceInfo.id, miss.fm.sourceInfo.id, miss.reason]),
    [['ea:21', 'fm:31', 'ages differ'], ['ea:25', 'fm:36', 'ages differ'], ['ea:22', 'fm:32', 'one-word FM name'],
      ['ea:27', 'fm:37', 'Reep names another record']]);
  assert.deepEqual(identity.stats.fallback, { withinNation: 1, crossNation: 0, omittedAmbiguous: 0, omittedOneWord: 1 });
  // readReepBridge lists each person's records of every snapshot.
  const read = readReepBridge({ source: { provider: 'Reep', release: '2026-10-18.1' }, persons: [['rp000000000000b3', [98], [33]]] });
  assert.deepEqual([read.keys.get('fm:33'), read.persons.get('rp000000000000b3')], ['rp000000000000b3', { ea: ['ea:98'], fm: ['fm:33'] }]);
  assert.throws(() => readReepBridge({ source: { provider: 'Reep', release: 'x' }, persons: [] }), /Not a reduced Reep bridge/);
  assert.throws(() => readReepBridge({ source: { provider: 'Reep', release: '2026-10-18.1' }, persons: [['rp000000000000b3', [98], []], ['rp000000000000b4', [98], []]] }),
    /links ea:98 to rp000000000000b3 and rp000000000000b4/);
});

test('a distinct override splits a Reep person: one record keeps the Reep id, the other is detached and may start beside it', () => {
  const data = { ea: [eaRecord(41, 'P. Namesake', 'Paul Namesake', 'Ghana', '2000-01-01')], fm: [fmRecord(51, 'Paul Namesake', 'Ghana', 25)] };
  const keys = new Map([['ea:41', 'rp00000000000041'], ['fm:51', 'rp00000000000041']]);
  const bridge = { keys, persons: new Map([['rp00000000000041', { ea: ['ea:41'], fm: ['fm:51'] }]]) };
  const overrides = { same: [], distinct: [{ ids: ['ea:41', 'fm:51'], evidence: 'hypothetical: two people Reep links' }], nations: [] };
  const run = entries => resolvePersons({ ...data, matches: new Map([['fm:51', [data.ea[0]]]]), bridge, overrides: entries, fresher: 'fm', ageDate: '2025-07-01' });
  const split = run(overrides);
  assert.deepEqual([data.ea[0].personKey, data.fm[0].personKey], ['rp00000000000041', 'fm:51']);
  assert.deepEqual(split.stats.overrides, { same: 0, distinct: 1, nations: 0 });
  assert.deepEqual(personKeyProblems(split.persons, keys, overrides), []);
  // Without the entry, the detached key is a bridge mismatch.
  assert.ok(personKeyProblems(split.persons, keys, NO_OVERRIDES).length > 0);
  assert.deepEqual(personKeyProblems(run(NO_OVERRIDES).persons, keys, NO_OVERRIDES), []);
  // Both records may start once a distinct entry lists them, whether Reep kept the link or its reducer rejected it.
  const fielded = new Map([['ea:41', '288'], ['fm:51', '288']]);
  for (const bridge of [{ persons: [['rp00000000000041', [41], [51]]], rejected: [] },
    { persons: [['rp00000000000041', [41], []]], rejected: [{ reep: 'rp00000000000041', ea: [41], fm: [51], reason: 'names share no surname' }] }]) {
    assert.deepEqual(reepPersonsFieldedTwice(fielded, bridge, overrides), []);
    assert.deepEqual(reepPersonsFieldedTwice(fielded, bridge, NO_OVERRIDES), ['rp00000000000041: ea:41 (288), fm:51 (288)']);
  }
});

// The by-name check once compared only EA long names, while resolvePersons compares every EA name form across nations:
// EA's Capita is Osvaldo Pedro Capemba.
test('namesakes across nations are found by every EA name form, not only the long name', () => {
  const capita = eaRecord(61, 'Capita', 'Osvaldo Pedro Capemba', 'Angola', '2002-01-10');
  const alhassane = { ...eaRecord(62, 'R. Alhassane', 'Rahim Alhassane', 'Niger', '2002-01-01'), referenceFullName: 'Abdel Rahim Alhassane Bonkano' };
  const eaRecords = new Map([capita, alhassane].map(player => [player.sourceInfo.id, player]));
  const fmShirt = (id, name, nation, age) => ({ nation, name, age, info: { id: `fm:${id}`, fullName: name, source: 'football-manager' } });
  const shirts = [{ nation: '024', name: 'Capita', age: 23, info: capita.sourceInfo }, fmShirt(71, 'Capita', '620', 23),
    { nation: '562', name: 'R. Alhassane', age: 23, info: alhassane.sourceInfo }, fmShirt(72, 'Abdel Rahim Alhassane Bonkano', '288', 24),
    fmShirt(73, 'R. Alhassane', '384', 23)];
  assert.deepEqual(namesakesAcrossNations(shirts, eaRecords), [
    'Angola Capita (ea:61, 23) = Portugal Capita (fm:71, 23)',
    'Niger R. Alhassane (ea:62, 23) = Ghana Abdel Rahim Alhassane Bonkano (fm:72, 24)']);
  // Ages more than a year apart are two people.
  assert.deepEqual(namesakesAcrossNations([shirts[0], fmShirt(71, 'Capita', '620', 25)], eaRecords), []);
});

test('a person enters one pool once: twice in a pool or in two pools is a builder error', () => {
  const player = (id, key, source, rating, pos = 'MF') => ({ name: id, pos, positions: [pos], rating, personKey: key, sourceInfo: { id, source } });
  assert.throws(() => pickNationSquads({ A: [player('ea:1', 'p1', 'ea-fc', 60)], B: [player('fm:1', 'p1', 'football-manager', 80)] }), /Person p1 is twice in the pools: A and B/);
  assert.throws(() => pickNationSquads({ A: [player('ea:1', 'p1', 'ea-fc', 60), player('fm:1', 'p1', 'football-manager', 80)] }), /Person p1 is twice in the pools: A and A/);
  const picked = pickNationSquads({ A: [player('ea:1', 'p1', 'ea-fc', 60), player('fm:2', 'p2', 'football-manager', 70)] });
  assert.deepEqual(picked.A.squad.map(entry => entry.sourceInfo.id), ['fm:2', 'ea:1']);
});
