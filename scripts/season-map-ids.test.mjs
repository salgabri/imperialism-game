// A club of an earlier season's country map keeps its id across rebuilds, as saves name it, two clubs of one name on one
// map each their own (scripts/lib/season-map-ids.mjs, the ids of scripts/build-season-countries.mjs). No boundaries and no
// downloaded sources: invented maps in a temporary folder, then the shipped ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SEASON_COUNTRY_MAPS } from '../src/data/domesticScope.js';
import { setKindOf } from '../src/engine/footballSets.js';
import { clubIdLines, giveClubIds, seasonMapIdLists, seasonMapIds } from './lib/season-map-ids.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = async (...at) => JSON.parse(await readFile(path.join(...at), 'utf8'));

/** Runs `fn` on a project folder of its own whose public/domestic holds `maps`: { '<map id>': { kind, country, clubs } }. */
async function withMaps(maps, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'season-map-ids-'));
  try {
    await mkdir(path.join(dir, 'public/domestic'), { recursive: true });
    for (const [id, doc] of Object.entries(maps)) await writeFile(path.join(dir, `public/domestic/${id}.json`), JSON.stringify(doc));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const map = (country, clubs, kind = 'cm0102') => ({ kind, country, clubs: clubs.map(([id, name]) => ({ id, name })) });
const club = (country, name, str) => ({ country, name, str });
const ids = fields => [...fields.values()].flat().map(entry => entry.id);

// Ukraine's clubs as the 2002/03 database rates them: two CSKA Kievs, strongest first.
const ukraine = () => new Map([['804', [club('804', 'Dynamo Kiev', 70), club('804', 'CSKA Kiev', 55.2), club('804', 'Obolon Kiev', 48), club('804', 'CSKA Kiev', 41.6)]]]);

test('a season map\'s ids by name: both of two clubs of one name in the map\'s order, the last alone for the season builders', () => withMaps({
  '804y2003': map('804', [['f-dynamo-kiev', 'Dynamo Kiev'], ['f-cska-kiev-2', 'CSKA Kiev'], ['f-obolon-kiev', 'Obolon Kiev'], ['f-cska-kiev', 'CSKA Kiev']]),
  // The same club in another country, another season and today's map: none of them this name's.
  '826y2003': map('826', [['f-cska-kiev-3', 'CSKA Kiev'], ['f-arsenal', 'Arsenal']], 'ea'),
  '804y2004': map('804', [['f-cska-kiev-9', 'CSKA Kiev']]),
  '804': map('804', [['d804-1', 'CSKA Kiev']]),
}, async dir => {
  const lists = await seasonMapIdLists(dir, 2003);
  assert.deepEqual([...lists].sort(), [['804:CSKA Kiev', ['f-cska-kiev-2', 'f-cska-kiev']], ['804:Dynamo Kiev', ['f-dynamo-kiev']],
    ['804:Obolon Kiev', ['f-obolon-kiev']], ['826:Arsenal', ['f-arsenal']], ['826:CSKA Kiev', ['f-cska-kiev-3']]]);
  assert.deepEqual((await seasonMapIdLists(dir, 2004)).get('804:CSKA Kiev'), ['f-cska-kiev-9']);
  assert.equal((await seasonMapIdLists(dir, 1999)).size, 0);
  const single = await seasonMapIds(dir, 2003);
  assert.deepEqual([single.get('804:CSKA Kiev'), single.get('826:CSKA Kiev'), single.size], ['f-cska-kiev', 'f-cska-kiev-3', 5]);
  assert.deepEqual([...await seasonMapIds(dir, 2003, { kind: 'ea' })], [['826:CSKA Kiev', 'f-cska-kiev-3'], ['826:Arsenal', 'f-arsenal']]);
  assert.equal((await seasonMapIds(path.join(dir, 'nowhere'), 2003)).size, 0);
  assert.equal((await seasonMapIdLists(path.join(dir, 'nowhere'), 2003)).size, 0);
}));

test('two clubs of one name keep their ids over every rebuild, whichever of them has the plain one', async () => {
  for (const [first, second] of [['f-cska-kiev', 'f-cska-kiev-2'], ['f-cska-kiev-2', 'f-cska-kiev']]) {
    const kept = ['f-dynamo-kiev', first, 'f-obolon-kiev', second];
    const names = ukraine().get('804').map(entry => entry.name);
    await withMaps({ '804y2003': map('804', kept.map((id, i) => [id, names[i]])) }, async dir => {
      for (let build = 1; build <= 3; build++) {
        const fields = ukraine();
        giveClubIds(fields, { file: [], committed: await seasonMapIdLists(dir, 2003) });
        assert.deepEqual(ids(fields), kept, `rebuild ${build} of ${first}, ${second}`);
        // As the builder writes it: the field's clubs, strongest first.
        await writeFile(path.join(dir, 'public/domestic/804y2003.json'), JSON.stringify(map('804', fields.get('804').map(entry => [entry.id, entry.name]))));
      }
    });
  }
});

test('clubs new to their map take an id each, the strongest the plain one, and keep it', async () => {
  const fields = ukraine();
  // Another country's club of the name, stronger than both: ids are the season's, not the map's.
  fields.set('826', [club('826', 'CSKA Kiev', 60)]);
  const every = giveClubIds(fields, { file: [], committed: new Map() });
  assert.deepEqual(ids(fields), ['f-dynamo-kiev', 'f-cska-kiev-2', 'f-obolon-kiev', 'f-cska-kiev-3', 'f-cska-kiev']);
  assert.deepEqual(every.slice().sort(), ids(fields).sort(), 'every id the season has');
  await withMaps({ '804y2003': map('804', fields.get('804').map(entry => [entry.id, entry.name])), '826y2003': map('826', fields.get('826').map(entry => [entry.id, entry.name])) }, async dir => {
    const again = ukraine();
    again.set('826', [club('826', 'CSKA Kiev', 30)]);
    giveClubIds(again, { file: [], committed: await seasonMapIdLists(dir, 2003) });
    assert.deepEqual(ids(again), ids(fields));
  });
});

test('a third club of the name takes a new id and moves neither of the two', () => {
  const fields = ukraine();
  fields.get('804').push(club('804', 'CSKA Kiev', 30));
  giveClubIds(fields, { file: [], committed: new Map([['804:CSKA Kiev', ['f-cska-kiev-2', 'f-cska-kiev']]]) });
  assert.deepEqual(ids(fields), ['f-dynamo-kiev', 'f-cska-kiev-2', 'f-obolon-kiev', 'f-cska-kiev', 'f-cska-kiev-3']);
});

test('a season file\'s club of a shared name is one club of the map, the one the map gives its id', () => {
  const committed = new Map([['804:CSKA Kiev', ['f-cska-kiev-2', 'f-cska-kiev']], ['804:Dynamo Kiev', ['f-dynamo-kiev']]]);
  for (const [known, expected] of [
    ['f-cska-kiev-2', ['f-cska-kiev-2', 'f-cska-kiev']],
    ['f-cska-kiev', ['f-cska-kiev-2', 'f-cska-kiev']],
    // An id the map does not give: the strongest's; the other keeps its own.
    ['f-cska-kiev-7', ['f-cska-kiev-7', 'f-cska-kiev']],
  ]) {
    const fields = ukraine();
    giveClubIds(fields, { file: [{ id: known, country: '804', name: 'CSKA Kiev' }, { id: 'f-dynamo-kiev', country: '804', name: 'Dynamo Kiev' }], committed });
    assert.deepEqual(ids(fields), ['f-dynamo-kiev', expected[0], 'f-obolon-kiev', expected[1]], known);
  }
  // Only one club of the name left on the map: it is the season file's.
  const fields = new Map([['804', [club('804', 'CSKA Kiev', 41.6)]]]);
  giveClubIds(fields, { file: [{ id: 'f-cska-kiev', country: '804', name: 'CSKA Kiev' }], committed });
  assert.deepEqual(ids(fields), ['f-cska-kiev']);
});

test('no club takes an id the season file gives another, and its namesake keeps its own', () => {
  const fields = ukraine();
  const file = [{ id: 'f-cska-kiev-2', country: '643', name: 'Other club' }];
  giveClubIds(fields, { file, committed: new Map([['804:CSKA Kiev', ['f-cska-kiev-2', 'f-cska-kiev']]]) });
  assert.deepEqual(ids(fields), ['f-dynamo-kiev', 'f-cska-kiev-3', 'f-obolon-kiev', 'f-cska-kiev']);
});

test('a fill\'s clubs number after its EA season\'s, and take only the season file\'s fill clubs\' ids', () => {
  const file = [{ id: 'f-arsenal', country: '826', name: 'Arsenal' }, { id: 'f-aek-athens', country: '300', name: 'AEK Athens' },
    { id: 'f-zenit', country: '643', name: 'Zenit', fill: true }];
  const own = new Map([['826', [club('826', 'Arsenal', 80), club('826', 'Rangers', 60)]]]);
  const primary = giveClubIds(own, { file, committed: new Map() });
  assert.deepEqual(ids(own), ['f-arsenal', 'f-rangers']);
  const fill = new Map([['300', [club('300', 'AEK Athens', 70), club('300', 'Rangers', 40), club('300', 'Rangers', 30)]], ['643', [club('643', 'Zenit', 75)]], ['372', [club('372', 'Rangers', 20)]]]);
  giveClubIds(fill, { file, primary, committed: new Map([['300:Rangers', ['f-rangers-3', 'f-rangers-2']]]) });
  assert.deepEqual(ids(fill), ['f-aek-athens-2', 'f-rangers-3', 'f-rangers-2', 'f-zenit', 'f-rangers-4']);
});

test('--ids sees two clubs of one name swap their ids', () => {
  const before = clubIdLines([{ id: 'f-a-2', name: 'A' }, { id: 'f-b', name: 'B' }, { id: 'f-a', name: 'A' }]);
  assert.deepEqual(before, ['f-a A (2)', 'f-a-2 A', 'f-b B']);
  assert.notDeepEqual(clubIdLines([{ id: 'f-a', name: 'A' }, { id: 'f-b', name: 'B' }, { id: 'f-a-2', name: 'A' }]), before);
  // The order of clubs of different names is not an id's: strengths may change.
  assert.deepEqual(clubIdLines([{ id: 'f-b', name: 'B' }, { id: 'f-a-2', name: 'A' }, { id: 'f-a', name: 'A' }]), before);
});

// Three of the shipped maps hold two clubs of one name (Ukraine's of 2002/03, China's and South Africa's of 2007/08).
test('a rebuild of the shipped season maps gives every club the id it has', async () => {
  const shipped = path.join(root, 'public/domestic'), seasons = new Map();
  for (const file of (await readdir(shipped)).filter(name => /^(\d{3}|[A-Z]{3})y\d{4}\.json$/.test(name)).sort()) {
    const { id, season, year, kind, country, clubs } = await readJson(shipped, file);
    if (!seasons.has(season)) seasons.set(season, { year, own: [], fill: [] });
    // An EA season's maps from the CM 01/02 Update Team's database are its fill's (scripts/build-season-countries.mjs).
    seasons.get(season)[kind === setKindOf(season) ? 'own' : 'fill'].push({ id, country, clubs: clubs.map(entry => [entry.id, entry.name, entry.str]) });
  }
  const fieldsOf = maps => new Map(maps.map(({ country, clubs }) => [country, clubs.map(([, name, str]) => club(country, name, str))]));
  let checked = 0;
  for (const [season, { year, own, fill }] of seasons) {
    const { clubs: file } = await readJson(root, `public/football/${season}.json`);
    const committed = await seasonMapIdLists(root, year);
    const fields = fieldsOf(own), filled = fieldsOf(fill);
    const primary = giveClubIds(fields, { file, committed });
    if (fill.length) giveClubIds(filled, { file, committed, primary });
    for (const [maps, given] of [[own, fields], [fill, filled]]) {
      for (const { id, country, clubs } of maps) {
        assert.deepEqual(given.get(country).map(entry => entry.id), clubs.map(([clubId]) => clubId), id);
        checked++;
      }
    }
  }
  assert.equal(checked, SEASON_COUNTRY_MAPS.length);
});
