// Football data sets (docs/design/football-years.md): the format-1 loader and its validation, the season-bound sport,
// CM player packing in saves, data set settings, source labels and save sizes. Every data set here is synthetic: fake
// players in a fake database, never a CM file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SAVE_KEY } from '../src/config.js';
import { CAPITALS } from '../src/data/capitals.js';
import { CM_CONVERSION, expandCmTuple } from '../src/data/cmPlayers.js';
import { expandFmTuple } from '../src/data/fmPlayers.js';
import { DEPENDENCIES, NATIONS, buildClub, buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { getSport } from '../src/sports/index.js';
import {
  BUILT_IN_SEASON, FOOTBALL_SET_CACHE_LIMIT, clearFootballSetCache, clearFootballSetIndex, decodeFootballSet, fieldedNations,
  footballSport, getLoadedFootballSet, heldShapes, loadFootballSet, loadFootballSetIndex, loadedFootballSetIds,
  retainFootballSets, sportOf,
} from '../src/engine/footballSets.js';
import { campaignSnapshot, createCampaignId, exportCampaign, loadCampaign, parseCampaign, serializeCampaign, writeSave }
  from '../src/engine/storage.js';
import { deleteLocalSet, memoryLocalSets, putLocalSet, useLocalSets } from '../src/engine/localSets.js';
import { sourceLabel, sourceTitle } from '../src/viewModels/squad.js';
import { bundleApp, bundleComponents } from './lib/app-harness.mjs';

// ---------- a synthetic data set ----------

const ID = 'cm0102-2002-05';
const SOURCE = { provider: 'CM 01/02 Update Team', edition: 'CM 01/02', version: 'Test 2002', snapshotDate: '2002-05',
  url: 'https://example.test/cm0102/test-2002', rawScale: 200, conversion: CM_CONVERSION, dobShift: 0 };
/** A natural 4-4-2, one CM key per shirt (a second key on some centre-backs). */
const XI = ['gk', 'lb', 'cb', 'cb', 'rb', 'lm', 'cm', 'cm', 'rm', 'st', 'st'];
const EMPTY = '442'; // Luxembourg: nobody in this fake database
const CLUBS = [['Premier League', '826', [['Testford United', 'TFU'], ['Mockley Town', 'MCK'], ['Shamwick City', 'SHC']]],
  ['La Liga', '724', [['Real Ficticio', 'RFI'], ['Atletico Simulado', 'ATS']]]];

const hash = doc => {
  const { version: _version, ...rest } = doc;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8);
};
const strengthOf = tuples => Math.round(selectLineup({ sport: 'football', squad: tuples.map(tuple => {
  const [name, pos, rating, info] = expandCmTuple(tuple, SOURCE);
  return { name, pos, rating, positions: info.positions };
}) }).rating);

/** A complete format-1 file: every nation, an empty one, clubs in two leagues, Montenegro with Serbia, no Kosovo. */
function syntheticSet({ id = ID, year = 2002, label = 'CM 01/02 · Test 2002', base = 0 } = {}) {
  let next = base + 1;
  const player = (nation, key, i, club = '') => {
    const cmId = next++;
    return [cmId, `Fake${nation} ${key.toUpperCase()}${i}`, i % 3 ? 0 : `Fakeson Fake${nation} ${i}`, 60 + (cmId * 37) % 140,
      key === 'cb' && i % 2 ? 'cb,rb' : key, NATIONS[nation][0], club, i % 2 ? '' : `19${70 + i}-0${1 + (i % 9)}-1${i % 9}`];
  };
  const nations = Object.fromEntries(Object.keys(NATIONS).map(nation => {
    if ([EMPTY, '499', 'KOS'].includes(nation)) return [nation, [40, 0, []]];
    const squad = XI.map((key, i) => player(nation, key, i));
    return [nation, [strengthOf(squad), squad.length + 5, squad]];
  }));
  const clubs = CLUBS.flatMap(([league, country, rows]) => rows.map(([name, code]) => {
    const squad = XI.map((key, i) => player(country, key, i, name));
    const ratings = squad.map(tuple => expandCmTuple(tuple, SOURCE)[2]);
    return { id: `f-${name.toLowerCase().replaceAll(' ', '-')}`, name, code, league, country, col: '#2255aa',
      str: Math.round(ratings.reduce((sum, r) => sum + r, 0) / ratings.length), squad };
  }));
  const doc = { format: 1, id, version: '', year, season: `${year - 1}/${String(year % 100).padStart(2, '0')}`, label, local: true,
    source: { ...SOURCE }, nations, clubs, territory: { merged: { 499: '688' }, inactive: ['KOS'] },
    coverage: { players: next - base - 1, nations: 167, completeXIs: 167, clubs: clubs.length, leagues: 2 } };
  doc.version = `${id}-${hash(doc)}`;
  return doc;
}

const SET = syntheticSet();
const entryOf = doc => ({ id: doc.id, version: doc.version, year: doc.year, season: doc.season, label: doc.label,
  provider: doc.source.provider, local: true, coverage: doc.coverage });

/** fetch over `files` (url → JSON, or an Error to throw); anything else is a 404. Records every url. */
function fakeFetch(files) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const body = files[url];
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  return { fetch, calls };
}
const plain = value => JSON.parse(JSON.stringify(value));
/** What the loader makes of a tuple: expandCmTuple's record, credited to the set's provider. */
const credited = (tuple, source = SOURCE) => {
  const [name, pos, rating, info] = expandCmTuple(tuple, source);
  return [name, pos, rating, { ...info, provider: source.provider }];
};
const fresh = () => { clearFootballSetCache(); clearFootballSetIndex(); retainFootballSets([]); useLocalSets(memoryLocalSets()); };

// ---------- decoding and validation ----------

test('a format-1 file decodes into the built-in roster and club shapes, every player rebuilt from its tuple', () => {
  const set = decodeFootballSet(structuredClone(SET), ID);
  assert.deepEqual(Object.keys(set).sort(), ['clubs', 'meta', 'rosters', 'territory']);
  assert.equal(set.meta.version, SET.version);
  assert.equal(set.meta.season, '2001/02');
  assert.equal(set.meta.nations, undefined, 'meta leaves out the bulk');
  assert.deepEqual(Object.keys(set.rosters).sort(), Object.keys(NATIONS).sort(), 'every nation has an entry');
  const [str, pool, players] = set.rosters['250'];
  assert.equal(str, SET.nations['250'][0]);
  assert.equal(pool, 16);
  assert.deepEqual(players, SET.nations['250'][2].map(tuple => credited(tuple)));
  assert.deepEqual(set.rosters[EMPTY], [40, 0, []], 'an empty nation stays empty');
  assert.equal(set.clubs.length, 5);
  assert.deepEqual(set.clubs[0].squad[0], credited(SET.clubs[0].squad[0]));
  assert.deepEqual(Object.keys(set.clubs[0]), ['id', 'name', 'code', 'league', 'country', 'col', 'str', 'squad']);
  assert.deepEqual(set.territory, { merged: { 499: '688' }, inactive: ['KOS'] });
  const [, , rating, info] = players[2];
  assert.equal(rating, Math.max(1, Math.round(info.rawRating * 99 / 200)));
  assert.equal(info.source, 'cm0102');
  assert.equal(info.url, SOURCE.url);
});

test('anything the builder would not write is refused with a reason', () => {
  const cases = [
    [doc => { doc.format = 2; }, /unsupported format 2/],
    [doc => { doc.id = 'cm0102-2003-05'; }, /does not match/],
    [doc => { doc.version = `${ID}-XYZ`; }, /version/],
    [doc => { doc.version = 'cm0102-2003-05-0123abcd'; }, /version/],
    [doc => { doc.year = 2002.5; }, /year/],
    [doc => { doc.year = 1871; doc.season = '1870/71'; }, /year/],
    [doc => { doc.season = '2002/03'; }, /season/],
    [doc => { doc.label = ' '; }, /label/],
    [doc => { delete doc.source.snapshotDate; }, /source/],
    [doc => { doc.source.url = 'ftp://example.test/db'; }, /url/],
    [doc => { doc.source.rawScale = 100; }, /rawScale/],
    [doc => { doc.source.conversion = 'ca'; }, /conversion/],
    [doc => { delete doc.nations['250']; }, /missing 250/],
    [doc => { doc.nations.XYZ = [40, 0, []]; }, /unknown ids XYZ/],
    [doc => { doc.nations['250'][0] = 0; }, /strength/],
    [doc => { doc.nations['250'][0] = Number.NaN; }, /strength/],
    [doc => { doc.nations['250'][1] = 3; }, /poolSize/],
    [doc => { doc.nations['250'][1] = -1; }, /poolSize/],
    [doc => { doc.nations['250'][2][0].pop(); }, /not a CM player tuple/],
    [doc => { doc.nations['250'][2][0][4] = 'constructor'; }, /positions/],
    [doc => { doc.nations['250'][2][0][4] = 'cb,cb'; }, /positions/],
    [doc => { doc.nations['250'][2][1][2] = doc.nations['250'][2][1][1]; }, /rebuild exactly/],
    [doc => { doc.nations['250'][2][0][7] = '12/04/1975'; }, /date of birth/],
    [doc => { doc.nations['250'][2][0][3] = 201; }, /Invalid CM current ability/],
    [doc => { doc.nations['250'][2][0][1] = ''; }, /Invalid CM tuple/],
    [doc => { doc.nations['250'][2][1][0] = doc.nations['250'][2][0][0]; }, /repeats player/],
    [doc => { doc.clubs[0].league = 'Serie B'; }, /not a built-in league/],
    [doc => { doc.clubs[0].country = 'ENG'; }, /not a nation id/],
    [doc => { doc.clubs[0].code = 'tfu'; }, /three capitals/],
    [doc => { doc.clubs[1].id = doc.clubs[0].id; }, /duplicated/],
    // Ids are the builder's: anything else could be an Object.prototype name, which a team map would swallow.
    [doc => { doc.clubs[0].id = '__proto__'; }, /id "__proto__" must look like "f-<name>"/],
    [doc => { doc.clubs[0].id = 'constructor'; }, /must look like "f-<name>"/],
    [doc => { doc.clubs[0].id = 'f-Testford'; }, /must look like "f-<name>"/],
    [doc => { doc.clubs[0].id = `f-${'x'.repeat(63)}`; }, /must look like "f-<name>"/],
    [doc => { doc.clubs[0].id = 7; }, /must look like "f-<name>"/],
    [doc => { doc.source.provider = ' '; }, /provider is empty/],
    [doc => { doc.clubs[0].squad = 'Testford'; }, /list of players/],
    [doc => { doc.territory.merged = { 499: '999' }; }, /holder/],
    [doc => { doc.territory.merged = { 499: '499' }; }, /holder/],
    [doc => { doc.territory.merged = { 499: 'KOS' }; }, /fields no team/],
    [doc => { doc.territory.merged = { 499: '688', 688: '191' }; }, /fields no team/],
    [doc => { doc.territory.inactive.push('499'); }, /both merged and inactive/],
    [doc => { doc.territory.inactive.push('KOS'); }, /repeats KOS/],
    [doc => { doc.territory.inactive.push('XYZ'); }, /not a nation id/],
    [doc => { delete doc.territory; }, /territory must be/],
  ];
  for (const [mutate, reason] of cases) {
    const doc = structuredClone(SET);
    mutate(doc);
    assert.throws(() => decodeFootballSet(doc, ID), reason, `${mutate}`);
  }
  assert.throws(() => decodeFootballSet(structuredClone(SET), '../cm0102-2002-05'), /id must look like/);
  assert.throws(() => decodeFootballSet(null, ID), /not a JSON object/);
  // Release variants take a suffix.
  const variant = syntheticSet({ id: 'cm0102-2012-03-odb', year: 2012 });
  assert.equal(decodeFootballSet(variant, variant.id).meta.season, '2011/12');
});

// ---------- the index and the loader ----------

test('the index lists the local sets newest first; a missing, failing or foreign index means none', async () => {
  fresh();
  const none = fakeFetch({});
  assert.deepEqual(await loadFootballSetIndex({ baseUrl: '/base/', fetch: none.fetch }), []);
  assert.deepEqual(none.calls, ['/base/football/index.json']);
  assert.deepEqual(await loadFootballSetIndex({ fetch: none.fetch }), [], 'the answer is kept');
  assert.equal(none.calls.length, 1, 'read once');

  const sets = [syntheticSet({ id: 'cm0102-2001-12', year: 2002, label: 'CM 01/02 · December 2001' }), SET,
    syntheticSet({ id: 'cm0102-2026-05', year: 2026, label: 'CM 01/02 · May 2026' })];
  const listed = { format: 1, sets: [...sets.map(entryOf), { id: '../evil', year: 2002, season: '2001/02', label: 'x' },
    { ...entryOf(SET), id: 'cm0102-2003-05' }, { ...entryOf(SET), season: '2002/03', id: 'cm0102-2002-06' }] };
  clearFootballSetIndex();
  const index = await loadFootballSetIndex({ fetch: fakeFetch({ '/football/index.json': listed }).fetch });
  assert.deepEqual(index.map(set => set.id), ['cm0102-2026-05', ID, 'cm0102-2001-12'], 'newest season, then latest release');
  assert.deepEqual(index[1], { id: ID, version: SET.version, year: 2002, season: '2001/02', label: 'CM 01/02 · Test 2002' });

  for (const fetch of [async () => { throw new Error('offline'); }, fakeFetch({ '/football/index.json': { format: 2, sets: listed.sets } }).fetch,
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } })]) {
    clearFootballSetIndex();
    assert.deepEqual(await loadFootballSetIndex({ fetch }), []);
  }
});

test('one shared request per data set; a failed load is not cached and can be retried', async () => {
  fresh();
  const files = { '/base/football/cm0102-2002-05.json': SET };
  const { fetch, calls } = fakeFetch(files);
  assert.equal(getLoadedFootballSet(ID), null);
  const [a, b] = await Promise.all([loadFootballSet(ID, { baseUrl: '/base/', fetch }), loadFootballSet(ID, { baseUrl: '/base/', fetch })]);
  assert.equal(a, b);
  assert.deepEqual(calls, ['/base/football/cm0102-2002-05.json']);
  assert.equal(getLoadedFootballSet(ID), a);
  assert.equal(await loadFootballSet(ID, { baseUrl: '/base/', fetch }), a, 'a loaded set is reused');
  assert.equal(calls.length, 1);

  await assert.rejects(loadFootballSet('cm0102-2003-05', { baseUrl: '/base/', fetch }),
    /cm0102-2003-05 is not in this browser or among the sets built on this computer \(HTTP 404\)/);
  files['/base/football/cm0102-2003-05.json'] = syntheticSet({ id: 'cm0102-2003-05', year: 2003 });
  assert.equal((await loadFootballSet('cm0102-2003-05', { baseUrl: '/base/', fetch })).meta.year, 2003, 'retried after a failure');
  await assert.rejects(loadFootballSet('../rosters', { fetch }), /Unknown football data set/);
  assert.ok(!calls.some(url => url.includes('rosters')), 'an unknown id is never fetched');
  await assert.rejects(loadFootballSet('cm0102-2004-05', { fetch: async () => { throw new Error('offline'); } }), /failed to load: offline/);
  await assert.rejects(loadFootballSet('cm0102-2005-05', { fetch: async () => ({ ok: true, json: async () => { throw new Error('bad'); } }) }), /not valid JSON/);
  const broken = structuredClone(SET);
  broken.id = 'cm0102-2006-05';
  await assert.rejects(loadFootballSet('cm0102-2006-05', { fetch: fakeFetch({ '/football/cm0102-2006-05.json': broken }).fetch }), /version/);
  assert.deepEqual(loadedFootballSetIds().sort(), [ID, 'cm0102-2003-05'].sort(), 'failed loads leave nothing behind');

  clearFootballSetCache(ID);
  assert.equal(getLoadedFootballSet(ID), null);
  assert.notEqual(await loadFootballSet(ID, { baseUrl: '/base/', fetch }), a, 'a cleared set loads again');
});

test('seasons added in this browser are listed with the built ones, marked added, and stand in for a file of their id', async () => {
  fresh();
  const may = syntheticSet({ id: 'cm0102-2026-05', year: 2026, label: 'CM 01/02 · May 2026' });
  const file = { ...entryOf(SET), label: 'CM 01/02 · Test 2002 (file)' };
  const { fetch, calls } = fakeFetch({ '/football/index.json': { format: 1, sets: [file] } });
  await putLocalSet(may);
  await putLocalSet(SET);
  const index = await loadFootballSetIndex({ fetch });
  assert.deepEqual(index.map(set => [set.id, set.label, set.added ?? false]),
    [['cm0102-2026-05', 'CM 01/02 · May 2026', true], [ID, 'CM 01/02 · Test 2002', true]], 'the browser\'s copy, not the file\'s');
  assert.ok(Object.isFrozen(index) && index.every(Object.isFrozen));

  // Each call reads the browser's seasons again; the file index is still read once.
  await deleteLocalSet(ID);
  assert.deepEqual((await loadFootballSetIndex({ fetch })).map(set => [set.id, set.label, set.added ?? false]),
    [['cm0102-2026-05', 'CM 01/02 · May 2026', true], [ID, 'CM 01/02 · Test 2002 (file)', false]]);
  await deleteLocalSet('cm0102-2026-05');
  const files = await loadFootballSetIndex({ fetch });
  assert.deepEqual(files, [{ id: ID, version: SET.version, year: 2002, season: '2001/02', label: 'CM 01/02 · Test 2002 (file)' }]);
  assert.equal(await loadFootballSetIndex({ fetch }), files, 'with none added, the file listing keeps its identity');
  assert.deepEqual(calls, ['/football/index.json']);

  // A listing the browser holds is checked like a file's.
  await putLocalSet({ ...may, id: '../evil' });
  assert.deepEqual((await loadFootballSetIndex({ fetch })).map(set => set.id), [ID]);
});

test('a season added in this browser loads with no request; once removed, the file of that id loads', async () => {
  fresh();
  const { fetch, calls } = fakeFetch({ '/football/cm0102-2002-05.json': SET });
  const added = { ...structuredClone(SET), label: 'CM 01/02 · Test 2002 (added)' };
  added.version = `${ID}-${hash(added)}`;
  await putLocalSet(added);
  const set = await loadFootballSet(ID, { fetch });
  assert.equal(set.meta.label, 'CM 01/02 · Test 2002 (added)');
  assert.deepEqual(calls, [], 'read from this browser');
  assert.equal(await loadFootballSet(ID, { fetch: undefined }), set, 'a loaded set needs no fetch');

  await deleteLocalSet(ID);
  clearFootballSetCache(ID);
  assert.equal((await loadFootballSet(ID, { fetch })).meta.label, 'CM 01/02 · Test 2002');
  assert.deepEqual(calls, ['/football/cm0102-2002-05.json']);

  // An added copy the loader would refuse is refused, never half read; a store that cannot be read says so.
  clearFootballSetCache(ID);
  await putLocalSet({ ...structuredClone(SET), version: ID });
  await assert.rejects(loadFootballSet(ID, { fetch }), /Football data set cm0102-2002-05: version "cm0102-2002-05" must look like/);
  clearFootballSetCache(ID);
  useLocalSets({ ...memoryLocalSets(), get: async () => { throw new Error('quota'); } });
  await assert.rejects(loadFootballSet(ID, { fetch }), /cm0102-2002-05 could not be read from this browser: quota/);
  assert.equal(calls.length, 1);
});

test('a small LRU keeps the retained set and the most recently used others', async () => {
  fresh();
  const ids = ['cm0102-2002-05', 'cm0102-2003-05', 'cm0102-2012-03-odb', 'cm0102-2012-03-sim'];
  const files = Object.fromEntries(ids.map(id => [`/football/${id}.json`, syntheticSet({ id, year: Number(id.slice(7, 11)) })]));
  const { fetch } = fakeFetch(files);
  assert.equal(FOOTBALL_SET_CACHE_LIMIT, 2);
  retainFootballSets([ids[0]]);
  for (const id of ids) await loadFootballSet(id, { fetch });
  assert.deepEqual(loadedFootballSetIds(), [ids[0], ids[2], ids[3]], 'the retained one plus the two most recent');
  getLoadedFootballSet(ids[2]);
  retainFootballSets([null]);
  assert.deepEqual(loadedFootballSetIds(), [ids[3], ids[2]], 'released, the least recently used goes');
});

// ---------- the season-bound sport ----------

test('footballSport binds the set to the football sport; sportOf picks it only once loaded', async () => {
  fresh();
  const football = getSport('football');
  assert.deepEqual(BUILT_IN_SEASON, { year: 2026, season: '2025/26' });
  assert.equal(sportOf({ sport: 'football' }), football);
  assert.equal(sportOf({ sport: 'football', dataSet: null }), football);
  assert.equal(sportOf({ sport: 'basketball', dataSet: ID }), getSport('basketball'), 'data sets are football only');
  assert.equal(sportOf({ sport: 'football', dataSet: ID }), null, 'a chosen set that has not loaded plays nothing');

  const set = await loadFootballSet(ID, { fetch: fakeFetch({ [`/football/${ID}.json`]: SET }).fetch });
  const sport = sportOf({ sport: 'football', dataSet: ID });
  assert.equal(sport, footballSport(set), 'memoised while the set is loaded');
  assert.equal(sportOf({ sport: 'football', dataSet: ID }), sport);
  assert.equal(sport.id, 'football');
  assert.equal(sport.simulate, football.simulate, 'the same match model');
  assert.equal(sport.rosters, set.rosters);
  assert.equal(sport.clubs, set.clubs);
  assert.deepEqual([sport.dataSet, sport.dataVersion, sport.dataYear, sport.dataSeason, sport.dataLabel],
    [ID, SET.version, 2002, '2001/02', 'CM 01/02 · Test 2002']);
  assert.equal(football.dataSet, undefined, 'the built-in sport is untouched');

  const france = buildTeam('250', makeRng(1), sport);
  assert.deepEqual(france.squad.map(player => player.name), SET.nations['250'][2].map(tuple => tuple[1]));
  assert.equal(france.str, SET.nations['250'][0]);
  assert.ok(france.squad.every(player => player.gen === false && player.sourceInfo.source === 'cm0102'));
  const empty = buildTeam(EMPTY, makeRng(1), sport);
  assert.deepEqual([empty.squad.length, empty.real, empty.str], [0, 0, 40], 'nobody is invented for an empty nation');
  assert.equal(buildClub(sport.clubs[0], sport).home, '826', 'a set club seeds from its country');

  assert.equal(fieldedNations(football).length, Object.keys(NATIONS).length);
  assert.deepEqual(Object.keys(NATIONS).filter(id => !fieldedNations(sport).includes(id)).sort(), ['499', 'KOS']);
  assert.deepEqual(heldShapes(football), Object.entries(DEPENDENCIES).map(([shape, dep]) => [shape, dep.of]));
  assert.deepEqual(heldShapes(sport).at(-1), ['499', '688'], 'Montenegro starts with Serbia, after the dependencies');
});

// ---------- saves ----------

/** A UEFA set campaign one match in: France took a German player; Luxembourg's empty squad is kept as it is. */
function setCheckpoint(sport) {
  const rng = makeRng(42);
  const teams = Object.fromEntries(['250', '276', EMPTY].map(id => [id, buildTeam(id, rng, sport)]));
  const [fr, de] = [teams['250'], teams['276']];
  const taken = { ...de.squad[3], from: de.code, fromId: de.id, joined: 1, claimGain: 0.4 };
  fr.squad.push(taken);
  de.squad.splice(3, 1);
  const replaced = { ...fr.squad[2], originalIndex: 2, assignedPos: 'DF', effectiveRating: 61, outOfPosition: false };
  const settings = { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', dataSet: sport.dataSet,
    dataVersion: sport.dataVersion, dataYear: sport.dataYear, dataSeason: sport.dataSeason, pacing: 'duel', resolution: 'instant',
    role: 'spectator' };
  const mark = team => ({ id: team.id, tid: team.id, code: team.code, name: team.name, color: team.col, score: '1', eff: '70.0' });
  const result = { title: 'FRANCE ANNEXES GERMANY', winnerId: fr.id, loserId: de.id, player: { ...taken }, replacedPlayer: replaced,
    strengthBefore: 70, strengthAfter: 70.4, strengthGain: 0.4, territoryNames: ['Germany'], territoryIds: ['276'] };
  return { phase: 'playing', settings, initialSettings: { ...settings }, teams,
    own: { 250: fr.id, 276: fr.id, [EMPTY]: EMPTY }, aliveIds: [fr.id, EMPTY], fallen: [{ id: de.id, r: 1 }],
    stats: {}, round: 1, matches: 1, queue: [], log: [], seed: 7, rngState: 7, conquestIds: ['276'],
    history: [{ id: 'match-1', aId: fr.id, dId: de.id, winnerId: fr.id, a: mark(fr), b: mark(de), events: [], result }],
    match: { aId: fr.id, dId: de.id, winner: fr.id, finalGa: 1, finalGd: 0, effA: 70, effD: 69, ga: 1, gd: 0, allEv: [], shown: [],
      applied: true, done: true, playerTaken: { ...taken }, replacedPlayer: replaced, territoryIds: ['276'] },
    campaignId: createCampaignId(), revision: 0, campaignName: 'Football 2001/02 · Europe', metrics: { acquisitions: [], leaderChanges: 0 },
    spin: null, choice: null, series: null, tacticalChoice: null };
}
function withStorage(run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return run({ storage, items }); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
const setSport = () => footballSport(decodeFootballSet(structuredClone(SET), ID));

test('a set campaign packs its CM players as tuples and rebuilds them exactly, without the data set', () => withStorage(() => {
  fresh();
  const snapshot = campaignSnapshot(setCheckpoint(setSport()));
  const full = JSON.stringify(snapshot), text = serializeCampaign(snapshot), stored = JSON.parse(text);
  assert.deepEqual(stored.playerPack, { kind: 'cm0102', source: { provider: 'CM 01/02 Update Team', edition: 'CM 01/02',
    version: 'Test 2002', snapshotDate: '2002-05', url: SOURCE.url } });
  assert.ok(Object.values(stored.teams).every(team => team.squad.every(player => Array.isArray(player) && player.length === 8
    || (player.length === 9 && player[8].from))), 'every squad player is a tuple; only the transfer carries extras');
  const transfer = stored.teams['250'].squad.at(-1);
  assert.deepEqual(transfer.slice(8), [{ from: 'GER', fromId: '276', joined: 1, claimGain: 0.4 }]);
  assert.deepEqual(transfer.slice(0, 8), SET.nations['276'][2][3], 'the tuple is the data set\'s own');
  assert.ok(Array.isArray(stored.history[0].result.player) && Array.isArray(stored.history[0].result.replacedPlayer));
  assert.ok(Array.isArray(stored.match.playerTaken));
  assert.deepEqual(stored.teams[EMPTY].squad, []);
  assert.ok(text.length * 3 < full.length, `${text.length} packed vs ${full.length} full`);

  assert.equal(getLoadedFootballSet(ID), null, 'nothing is loaded');
  const restored = parseCampaign(text);
  assert.equal(restored.playerPack, undefined);
  for (const key of ['teams', 'history', 'match']) assert.equal(JSON.stringify(restored[key]), JSON.stringify(snapshot[key]), `${key}, key order included`);
  assert.equal(restored.settings.dataVersion, SET.version);

  // Records that would not rebuild exactly are stored in full.
  const odd = setCheckpoint(setSport());
  odd.teams['250'].squad[0] = { ...odd.teams['250'].squad[0], rating: 99 };
  odd.teams['250'].squad[1] = { ...odd.teams['250'].squad[1], sourceInfo: { ...odd.teams['250'].squad[1].sourceInfo, url: 'https://example.org/p' } };
  const oddText = serializeCampaign(campaignSnapshot(odd)), oddStored = JSON.parse(oddText);
  assert.equal(Array.isArray(oddStored.teams['250'].squad[0]), false);
  assert.equal(Array.isArray(oddStored.teams['250'].squad[1]), false);
  assert.ok(Array.isArray(oddStored.teams['250'].squad[2]));
  assert.equal(JSON.stringify(parseCampaign(oddText).teams), JSON.stringify(campaignSnapshot(odd).teams));

  // Checkpoints and exports go through the same pack.
  const state = setCheckpoint(setSport());
  assert.equal(writeSave(state).ok, true);
  assert.equal(JSON.parse(localStorage.getItem(SAVE_KEY)).playerPack.kind, 'cm0102');
  assert.equal(JSON.stringify(loadCampaign(state.campaignId).teams), JSON.stringify(campaignSnapshot(state).teams));
  assert.equal(JSON.stringify(parseCampaign(exportCampaign(state)).teams), JSON.stringify(campaignSnapshot(state).teams));
}));

test('a damaged CM pack is rejected, and a pack of another kind is never read as FM', () => {
  const stored = JSON.parse(serializeCampaign(campaignSnapshot(setCheckpoint(setSport()))));
  for (const mutate of [
    s => { s.teams['250'].squad[0][4] = 'constructor'; },
    s => { s.teams['250'].squad[0][4] = 'gk,constructor'; },
    s => { s.teams['250'].squad[0][3] = 0; },
    s => { s.teams['250'].squad[0][0] = -1; },
    s => { s.teams['250'].squad[0].length = 7; },
    s => { s.teams['250'].squad[0].push('extras'); },
    s => { s.teams['250'].squad.at(-1).push({}); },
    s => { delete s.playerPack.source.url; },
    s => { s.playerPack.source.provider = ''; },
    s => { s.playerPack.source.provider = 7; },
    s => { s.playerPack.kind = 'cm9900'; },
  ]) {
    const copy = structuredClone(stored);
    mutate(copy);
    assert.throws(() => parseCampaign(JSON.stringify(copy)), /squads are incomplete/, `${mutate}`);
  }
});

test('country campaigns keep the FM pack exactly: no kind, the same header and tuples', () => {
  const sport = getSport('football'), FM = { edition: 'FM 26', version: '26.3.0', snapshotDate: '2026-10-02' };
  const clubs = ['Alpha Football Club', 'Beta United'].map((name, c) => buildClub({
    id: `d826-${100 + c}`, name, code: ['ALP', 'BET'][c], league: 'Premier League', col: '#336699', str: 70, homeSection: `826-00${c + 1}`,
    squad: Array.from({ length: 11 }, (_, i) => expandFmTuple([1000 * (c + 1) + i, `Player ${c}-${i}`, 55 + i * 3, i ? 'cm,am' : 'gk',
      i % 2 ? 'ENG' : undefined], FM, name)),
  }, sport));
  const settings = { sport: 'football', layer: 'clubs', clubScope: 'domestic:826', domesticVersion: '826-0a1b2c3d', dataSet: null,
    pacing: 'duel', resolution: 'instant', role: 'spectator' };
  const snapshot = campaignSnapshot({ phase: 'playing', settings, teams: Object.fromEntries(clubs.map(team => [team.id, team])),
    own: { '826-001': 'd826-100', '826-002': 'd826-101' }, aliveIds: ['d826-100', 'd826-101'], fallen: [], stats: {}, round: 1,
    matches: 0, queue: [], history: [], log: [], seed: 7, rngState: 7, campaignId: 'fm-pack', revision: 0, campaignName: 'England' });
  const text = serializeCampaign(snapshot), stored = JSON.parse(text);
  assert.deepEqual(Object.keys(stored.playerPack), ['source', 'clubs'], 'an FM pack never names a kind');
  assert.deepEqual(stored.playerPack, { source: FM, clubs: ['Alpha Football Club', 'Beta United'] });
  assert.deepEqual(stored.teams['d826-100'].squad[1], [1001, 'Player 0-1', 58, 'cm,am', 'ENG', 0]);
  assert.deepEqual(stored.teams['d826-101'].squad[2], [2002, 'Player 1-2', 61, 'cm,am', 0, 1]);
  assert.equal(JSON.stringify(parseCampaign(text).teams), JSON.stringify(snapshot.teams));
  stored.playerPack.kind = 'fm';
  assert.throws(() => parseCampaign(JSON.stringify(stored)), /squads are incomplete/);
});

test('settings name a data set, its build and season together, or none of them', () => {
  const base = campaignSnapshot(setCheckpoint(setSport()));
  const parse = (settings, initialSettings = settings) => parseCampaign(serializeCampaign({ ...base, settings, initialSettings }));
  const ok = base.settings;
  assert.equal(parse(ok).settings.dataSet, ID);
  const { dataSet: _set, dataVersion: _version, dataYear: _year, dataSeason: _season, ...builtIn } = ok;
  assert.equal(parse({ ...builtIn, dataSet: null }).settings.dataSet, null);
  assert.equal(parse(builtIn).settings.dataSet, undefined, 'saves from before data sets load as they are');
  const variant = { ...ok, dataSet: 'cm0102-2012-03-odb', dataVersion: 'cm0102-2012-03-odb-0123abcd', dataYear: 2012, dataSeason: '2011/12' };
  assert.equal(parse(variant).settings.dataYear, 2012);
  for (const settings of [
    { ...ok, dataSet: 'cm0102-2002' }, { ...ok, dataSet: 'fm26-2026-05' }, { ...ok, dataSet: 2002 },
    { ...ok, dataVersion: undefined }, { ...ok, dataVersion: 'cm0102-2003-05-0123abcd' }, { ...ok, dataVersion: `${ID}-0123ABCD` },
    { ...ok, dataYear: 2002.5 }, { ...ok, dataYear: 1871, dataSeason: '1870/71' }, { ...ok, dataYear: '2002' },
    { ...ok, dataSeason: '2002/03' }, { ...ok, dataSeason: undefined },
    { ...builtIn, dataVersion: SET.version }, { ...builtIn, dataSeason: '2001/02' }, { ...builtIn, dataYear: 2002 },
    { ...ok, sport: 'basketball' }, { ...ok, layer: 'clubs', clubScope: 'domestic:826', domesticVersion: '826-0a1b2c3d' },
  ]) assert.throws(() => parse(settings), /Campaign data set is invalid/, JSON.stringify(settings));
  assert.throws(() => parse(ok, { ...ok, dataVersion: 'cm0102-2003-05-0123abcd' }), /Campaign data set is invalid/, 'initialSettings too');
});

// ---------- source labels ----------

test('CM players are labelled "CM 01/02" and credit the Update Team; FM and EA labels are unchanged', async () => {
  const [name, pos, rating, sourceInfo] = setSport().rosters['250'][2][0];
  const cm = { name, pos, rating, sourceInfo };
  assert.equal(sourceLabel(cm), 'CM 01/02');
  assert.equal(sourceTitle(cm), `CM 01/02 · CM 01/02 Update Team · Database Test 2002 · Database snapshot 2002-05 · Source rating ${sourceInfo.rawRating}/200`
    + ' · Game rating converted from CM current ability: round(ca * 99 / 200)');
  assert.equal(sourceLabel({ sourceInfo: { ...sourceInfo, edition: '' } }), 'CM 01/02');
  const { provider: _provider, ...unnamed } = sourceInfo;
  assert.match(sourceTitle({ sourceInfo: unnamed }), /^CM 01\/02 · CM 01\/02 Update Team · /, 'a set naming nobody keeps the default credit');

  const [, , , fmInfo] = expandFmTuple([42, 'Some Player', 80, 'cm', 'ENG'], { edition: 'FM 26', version: '26.3.0', snapshotDate: '2026-10-02' }, 'Club');
  assert.equal(sourceLabel({ sourceInfo: fmInfo }), 'FM 26');
  assert.equal(sourceTitle({ sourceInfo: fmInfo }), 'FM 26 · Database 26.3.0 · Database snapshot 2026-10-02 · Source rating 80/100'
    + ' · Game rating converted from Football Manager current ability: round(currentAbility * 99 / 100)');
  assert.equal(sourceLabel({ sourceInfo: { source: 'ea-fc', edition: '26' } }), 'EA FC 26');

  const { PlayerRow } = await bundleComponents({ PlayerRow: 'src/components/PlayerRow.jsx' });
  const html = renderToStaticMarkup(React.createElement(PlayerRow, { player: { ...cm, positions: sourceInfo.positions } }));
  assert.match(html, />CM 01\/02<\/a>/);
  assert.match(html, /aria-label="View Fakeson Fake250 0 in CM 01\/02"/);
  assert.match(html, /title="CM 01\/02 · CM 01\/02 Update Team · Database Test 2002 · [^"]*Game rating converted from CM current ability: round\(ca \* 99 \/ 200\)"/);
  const fmHtml = renderToStaticMarkup(React.createElement(PlayerRow, { player: { name: 'Some Player', pos: 'MF', rating: 79, sourceInfo: fmInfo } }));
  assert.match(fmHtml, /title="FM 26 · Database 26\.3\.0 · Database snapshot 2026-10-02 · Source rating 80\/100 · Game rating converted from Football Manager current ability: round\(currentAbility \* 99 \/ 100\)"/);
});

test('a player credits the database that rated him, through the loader and saves alike', async () => {
  // Five known databases are not the Update Team's: SI's own 3.9.x releases among them.
  const si = structuredClone(SET);
  si.source.provider = 'Sports Interactive';
  const sport = footballSport(decodeFootballSet(si, ID));
  const [name, pos, rating, sourceInfo] = sport.rosters['250'][2][0];
  assert.equal(sourceInfo.provider, 'Sports Interactive');
  const title = sourceTitle({ sourceInfo });
  assert.match(title, /^CM 01\/02 · Sports Interactive · Database Test 2002 · /);
  assert.doesNotMatch(title, /Update Team/);

  const unnamed = structuredClone(SET);
  delete unnamed.source.provider;
  const [, , , plainInfo] = decodeFootballSet(unnamed, ID).rosters['250'][2][0];
  assert.equal(Object.hasOwn(plainInfo, 'provider'), false, 'a set naming nobody adds no provider');
  assert.deepEqual(plainInfo, expandCmTuple(unnamed.nations['250'][2][0], unnamed.source)[3]);

  // The pack keeps the provider, so a resumed campaign still credits SI.
  const snapshot = campaignSnapshot(setCheckpoint(sport));
  const text = serializeCampaign(snapshot), stored = JSON.parse(text);
  assert.equal(stored.playerPack.source.provider, 'Sports Interactive');
  assert.ok(stored.teams['250'].squad.every(player => Array.isArray(player)), 'every player still packs');
  const restored = parseCampaign(text);
  assert.equal(JSON.stringify(restored.teams), JSON.stringify(snapshot.teams), 'rebuilt exactly, key order included');
  assert.equal(restored.teams['250'].squad[0].sourceInfo.provider, 'Sports Interactive');
  const unnamedSnapshot = campaignSnapshot(setCheckpoint(footballSport(decodeFootballSet(unnamed, ID))));
  const unnamedText = serializeCampaign(unnamedSnapshot);
  assert.equal(Object.hasOwn(JSON.parse(unnamedText).playerPack.source, 'provider'), false);
  assert.equal(JSON.stringify(parseCampaign(unnamedText).teams), JSON.stringify(unnamedSnapshot.teams));

  const { PlayerRow } = await bundleComponents({ PlayerRow: 'src/components/PlayerRow.jsx' });
  const html = renderToStaticMarkup(React.createElement(PlayerRow, { player: { name, pos, rating, sourceInfo, positions: sourceInfo.positions } }));
  assert.match(html, /title="CM 01\/02 · Sports Interactive · Database Test 2002 · /);
});

// ---------- save sizes ----------

const QUOTA = 5_000_000;
// scripts/save-size.test.mjs: a checkpoint is stored up to four times, so each stays within 700k code units.
const CHECKPOINT_BUDGET = 700_000;

/** A Map-backed localStorage with the jsdom quota rule, as scripts/save-size.test.mjs uses. */
function quotaStorage(quota = QUOTA) {
  const items = new Map();
  return {
    items,
    getItem: key => items.get(key) ?? null,
    removeItem: key => { items.delete(key); },
    setItem(key, value) {
      const text = String(value);
      let total = key.length + text.length;
      for (const [k, v] of items) if (k !== key) total += k.length + v.length;
      if (total > quota) throw new DOMException('The storage quota has been exceeded.', 'QuotaExceededError');
      items.set(key, text);
    },
    used() { let total = 0; for (const [k, v] of items) total += k.length + v.length; return total; },
  };
}
const publicJson = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));

test('a 170-nation data set world campaign stays inside the save budgets from kickoff to its champion', async t => {
  const App = await bundleApp();
  const storage = quotaStorage(), saves = [];
  const geo = new WorldGeometry(publicJson('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS));
  const displayGeo = new WorldGeometry(publicJson('countries-50m.json'), CAPITALS);
  displayGeo.paths = displayGeo.buildPaths(geo.fit.s, geo.fit.tx, geo.fit.ty);
  class SavingCampaign extends App {
    constructor() {
      super({});
      Object.assign(this, { geo, displayGeo, labelGeometry: [] });
      this.state = { ...this.state, phase: 'setup', setup: { ...this.state.setup, sport: 'football', layer: 'nations', scope: 'world',
        pacing: 'blitz', resolution: 'instant', role: 'spectator', seed: '20261002', dataSet: ID } };
      this.ready = true;
    }
    setState(update, callback) {
      const previous = this.state, next = typeof update === 'function' ? update(this.state, this.props) : update;
      if (next) this.state = { ...this.state, ...next };
      if (this.ready) this.componentDidUpdate(this.props, previous);
      callback?.call(this);
    }
    persist() {
      super.persist();
      const status = this.state.saveStatus || {};
      saves.push({ matches: this.state.matches, ok: status.ok, message: status.message, size: storage.items.get(SAVE_KEY)?.length ?? 0,
        used: storage.used() });
    }
    fitMap() {}
    after() { return null; }
    drawFrame() {}
    presentMatch() {}
    showPopup() {}
    showToast() {}
  }
  const saved = { localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch') };
  const { fetch, calls } = fakeFetch({ [`/football/${ID}.json`]: SET });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  try {
    const app = new SavingCampaign();
    await app.startCampaign();
    assert.equal(app.state.phase, 'playing', app.state.saveStatus?.message);
    assert.deepEqual(calls, [`/football/${ID}.json`], 'launch loads the chosen set once');
    assert.equal(app.state.aliveIds.length, Object.keys(NATIONS).length - 2, 'Montenegro and Kosovo field no team');
    for (let steps = 0; app.state.aliveIds.length > 1 && steps < 5000; steps++) {
      const st = app.state;
      if (st.match && !st.match.applied) app.finishMatch();
      else if (st.spin) { app.lockDuel(st.spin.key); app.startMatch(st.spin.attackerId, st.spin.targetId, st.spin); }
      else app.nextAction();
    }
    app.clearTimers();
    assert.equal(app.state.aliveIds.length, 1, 'the campaign reaches a champion');
    assert.ok(saves.length > app.state.matches, `${saves.length} autosaves over ${app.state.matches} matches`);
    saves.forEach((save, i) => {
      const at = `autosave ${i + 1} (match ${save.matches}, ${save.size} code units)`;
      assert.equal(save.ok, true, `${at}: ${save.message}`);
      assert.equal(save.message, 'Progress saved', at);
      assert.ok(save.size <= CHECKPOINT_BUDGET, `${at} is over the ${CHECKPOINT_BUDGET} budget`);
      assert.ok(save.used <= 4 * CHECKPOINT_BUDGET + 20_000, `${at}: ${save.used} code units in storage`);
    });
    // The built-in world kickoff is held under 300k code units; the CM tuples keep a set's under it too.
    assert.ok(saves[0].size < 300_000, `kickoff checkpoint is ${saves[0].size} code units`);
    t.diagnostic(`kickoff ${saves[0].size}, peak ${Math.max(...saves.map(save => save.size))} code units over ${app.state.matches} matches`);
    const text = storage.items.get(SAVE_KEY);
    assert.equal((text.match(/"sourceInfo":\{/g) || []).length, 0, 'no CM player is stored in full');
    assert.equal(JSON.stringify(parseCampaign(text).teams), JSON.stringify(app.state.teams), 'squads rebuild exactly');
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
