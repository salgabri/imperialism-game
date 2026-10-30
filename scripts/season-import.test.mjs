// Add a season… (docs/design/football-years.md): the browser's own store of added seasons (src/engine/localSets.js)
// over IndexedDB and in memory, and the import (src/engine/seasonImport.js) of a chosen CM 01/02 Data folder, built
// with the shipped release list from synthetic folders (scripts/lib/cm0102-fixture.mjs) padded to a real release's
// file sizes. Every player in them is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CM_DATA_FILES, readCm0102 } from '../src/data/cm0102.js';
import { CM0102_RELEASES } from '../src/data/cm0102Releases.js';
import { clearFootballSetCache, clearFootballSetIndex, loadFootballSet, loadFootballSetIndex } from '../src/engine/footballSets.js';
import {
  deleteLocalSet, getLocalSet, indexedDbLocalSets, listLocalSets, localEntryOf, localSetsPersist, memoryLocalSets, putLocalSet, useLocalSets,
} from '../src/engine/localSets.js';
import { dataFolderOf, importSeason, importedMessage } from '../src/engine/seasonImport.js';
import { padToRelease, sampleDatabase, writeCm0102Files, writeMacFiles } from './lib/cm0102-fixture.mjs';

const NOVEMBER_2007 = CM0102_RELEASES.find(release => release.id === 'cm0102-2007-11');
const later = () => new Promise(resolve => setImmediate(resolve));

/** The files of a folder as a folder picker hands them over: File objects with their path inside the choice. */
function chosen(files, folder = 'Championship Manager 01-02/Data') {
  return Object.entries(files).map(([name, bytes]) => {
    const file = new File([bytes], name);
    Object.defineProperty(file, 'webkitRelativePath', { value: folder ? `${folder}/${name}` : '' });
    return file;
  });
}

/** The sample database as a copy of November 2007 (season 2007/08, birth years stored 6 early). */
const november2007 = (options = {}) => padToRelease(writeCm0102Files(sampleDatabase({ birthYearShift: 6, ...options })), NOVEMBER_2007);

const quiet = { afterPaint: async () => {} };

function fresh(store = memoryLocalSets()) {
  useLocalSets(store);
  clearFootballSetCache();
  clearFootballSetIndex();
  return store;
}

/**
 * Just enough IndexedDB for localSets: one database per name, an upgrade on a new version, object stores with an
 * optional keyPath, and transactions that run their requests in order and then complete. Values are cloned in and out.
 */
function fakeIndexedDB({ failOpen = null } = {}) {
  const databases = new Map();
  const factory = { opens: 0 };
  factory.open = (name, version) => {
    factory.opens++;
    const request = {};
    setImmediate(() => {
      if (failOpen) {
        request.error = failOpen;
        request.onerror?.();
        return;
      }
      if (!databases.has(name)) databases.set(name, { version: 0, stores: new Map() });
      const db = databases.get(name);
      const connection = {
        objectStoreNames: { contains: store => db.stores.has(store) },
        createObjectStore(store, { keyPath = null } = {}) { db.stores.set(store, { keyPath, rows: new Map() }); },
        close() {},
        transaction(names, mode) {
          const tx = {}, queue = [];
          tx.objectStore = storeName => {
            assert.ok(names.includes(storeName), `${storeName} is in the transaction's scope`);
            const store = db.stores.get(storeName);
            const ask = (write, work) => {
              if (write && mode !== 'readwrite') throw new Error('ReadOnlyError');
              const req = {};
              queue.push(() => { req.result = work(); });
              return req;
            };
            return {
              getAll: () => ask(false, () => [...store.rows.values()].map(value => structuredClone(value))),
              get: key => ask(false, () => (store.rows.has(key) ? structuredClone(store.rows.get(key)) : undefined)),
              put: (value, key) => ask(true, () => {
                const id = store.keyPath ? value[store.keyPath] : key;
                store.rows.set(id, structuredClone(value));
                return id;
              }),
              delete: key => ask(true, () => { store.rows.delete(key); }),
            };
          };
          setImmediate(() => {
            for (const run of queue) run();
            tx.oncomplete?.();
          });
          return tx;
        },
      };
      request.result = connection;
      if (db.version < version) {
        request.onupgradeneeded?.();
        db.version = version;
      }
      request.onsuccess?.();
    });
    return request;
  };
  factory.databases = databases;
  return factory;
}

// ---------- the store ----------

test('added seasons keep their index entry and file, in memory for this visit', async () => {
  const store = fresh();
  assert.equal(store.persistent, false);
  assert.equal(await localSetsPersist(), false);
  assert.deepEqual(await listLocalSets(), []);
  assert.equal(await getLocalSet('cm0102-2007-11'), null);

  const doc = { id: 'cm0102-2007-11', version: 'cm0102-2007-11-0123abcd', year: 2008, season: '2007/08', label: 'CM 01/02 · November 2007',
    local: true, source: { provider: 'CM 01/02 Update Team' }, coverage: { players: 1, nations: 1, completeXIs: 0, clubs: 0, leagues: 0 },
    nations: { 826: [40, 1, []] } };
  const entry = await putLocalSet(doc);
  assert.deepEqual(Object.keys(entry), ['id', 'version', 'year', 'season', 'label', 'provider', 'local', 'coverage', 'addedAt']);
  assert.deepEqual(entry, localEntryOf(doc, entry.addedAt));
  assert.match(entry.addedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await listLocalSets(), [entry]);
  const copy = await getLocalSet('cm0102-2007-11');
  assert.deepEqual(copy, doc);
  copy.nations[826][0] = 99;
  assert.equal((await getLocalSet('cm0102-2007-11')).nations[826][0], 40, 'the store hands out copies');

  await putLocalSet({ ...doc, label: 'CM 01/02 · November 2007 (again)' });
  assert.deepEqual((await listLocalSets()).map(item => item.label), ['CM 01/02 · November 2007 (again)'], 'one per id');
  await deleteLocalSet('cm0102-2007-11');
  assert.deepEqual(await listLocalSets(), []);
  assert.equal(await getLocalSet('cm0102-2007-11'), null);

  // A store that cannot be listed lists nothing; reading a set is left to fail loudly.
  useLocalSets({ ...memoryLocalSets(), list: async () => { throw new Error('gone'); } });
  assert.deepEqual(await listLocalSets(), []);
});

test('over IndexedDB, added seasons outlive the page: listing and files in two stores, written together', async () => {
  const factory = fakeIndexedDB();
  const first = indexedDbLocalSets(factory);
  fresh(first);
  assert.equal(await localSetsPersist(), true);
  const doc = { id: 'cm0102-2008-02', version: 'cm0102-2008-02-89abcdef', year: 2008, season: '2007/08', label: 'CM 01/02 · February 2008',
    local: true, source: { provider: 'CM 01/02 Update Team' }, coverage: { players: 0, nations: 0, completeXIs: 0, clubs: 0, leagues: 0 } };
  const entry = await putLocalSet(doc);
  const db = factory.databases.get('imperialism-football-sets');
  assert.equal(db.version, 1);
  assert.deepEqual([...db.stores.keys()], ['listing', 'sets']);
  assert.deepEqual([...db.stores.get('listing').rows.keys()], ['cm0102-2008-02']);
  assert.deepEqual([...db.stores.get('sets').rows.keys()], ['cm0102-2008-02']);

  // Another visit: a new connection to the same database.
  fresh(indexedDbLocalSets(factory));
  assert.deepEqual(await listLocalSets(), [entry]);
  assert.deepEqual(await getLocalSet('cm0102-2008-02'), doc);
  await deleteLocalSet('cm0102-2008-02');
  assert.deepEqual(await listLocalSets(), []);
  assert.equal(db.stores.get('sets').rows.size, 0, 'the file goes with its listing');
  assert.equal(factory.opens, 2, 'one connection per visit');

  // A failed open is tried again on the next call.
  const flaky = fakeIndexedDB({ failOpen: new Error('busy') });
  const store = indexedDbLocalSets(flaky);
  await assert.rejects(store.list(), /busy/);
  flaky.open = fakeIndexedDB().open;
  assert.deepEqual(await store.list(), []);
});

test('the page\'s own store is IndexedDB when it opens, else memory for this visit', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'indexedDB', prior); else delete globalThis.indexedDB;
    useLocalSets(memoryLocalSets());
  });
  const install = value => Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => value });

  install(fakeIndexedDB());
  useLocalSets(null);
  assert.equal(await localSetsPersist(), true);
  const doc = { id: 'cm0102-2009-03', version: 'cm0102-2009-03-00112233', year: 2009, season: '2008/09', label: 'CM 01/02 · March 2009',
    local: true, source: { provider: 'CM 01/02 Update Team' }, coverage: {} };
  await putLocalSet(doc);
  assert.deepEqual((await listLocalSets()).map(entry => entry.id), ['cm0102-2009-03']);

  for (const refusal of [fakeIndexedDB({ failOpen: new Error('SecurityError') }), { open() { throw new Error('InvalidStateError'); } }, undefined]) {
    install(refusal);
    useLocalSets(null);
    assert.equal(await localSetsPersist(), false, 'kept for this visit only');
    await putLocalSet(doc);
    assert.deepEqual((await listLocalSets()).map(entry => entry.id), ['cm0102-2009-03'], 'and still added');
  }
  // A sandboxed frame throws on the property itself.
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('SecurityError'); } });
  useLocalSets(null);
  assert.equal(await localSetsPersist(), false);
});

// ---------- choosing the Data folder ----------

test('the Data folder is found in what was chosen, by base name in any case, and only its needed files are taken', () => {
  const files = writeCm0102Files(sampleDatabase());
  const game = [...chosen(files, 'CM0102/Data'), ...chosen({ 'cm0102.exe': new Uint8Array(4), 'readme.txt': new Uint8Array(2) }, 'CM0102'),
    ...chosen({ 'INDEX.DAT': files['index.dat'], 'Club.dat': files['club.dat'] }, 'CM0102/Data/backup')];
  const found = dataFolderOf(game);
  assert.equal(found.folder, 'CM0102/Data');
  assert.deepEqual([...found.files.keys()].sort(), [...CM_DATA_FILES].sort(), 'histories, stadiums and the rest stay unread');

  const upper = chosen(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name.toUpperCase(), bytes])), '');
  assert.equal(dataFolderOf(upper).folder, '', 'loose files picked one by one');
  assert.equal(dataFolderOf(upper).files.get('staff.dat').name, 'STAFF.DAT');

  assert.throws(() => dataFolderOf([]), /There is no index\.dat in what you chose\. Choose the Data folder of a Championship Manager 01\/02 database/);
  assert.throws(() => dataFolderOf(chosen({ 'readme.txt': new Uint8Array(1) })), /There is no index\.dat/);
  assert.throws(() => dataFolderOf(chosen({ 'November 2007.zip': new Uint8Array(1) }, 'Downloads')),
    /November 2007\.zip is still packed: extract it first, then choose its Data folder\./);
  const partial = Object.fromEntries(Object.entries(files).filter(([name]) => !['staff.dat', 'common_names.dat'].includes(name)));
  assert.throws(() => dataFolderOf(chosen(partial, 'CM0102/Data')), /^Error: CM0102\/Data has index\.dat but not common_names\.dat and staff\.dat\./);
  assert.throws(() => dataFolderOf([...chosen(files, 'CM/2007-11/Data'), ...chosen(files, 'CM/2024-10/Data')]),
    /That folder holds 2 Data folders \(CM\/2007-11\/Data, CM\/2024-10\/Data\): choose just one of them\./);
});

test('the files the reader needs are all it reads', () => {
  const files = writeCm0102Files(sampleDatabase({ birthYearShift: 6 }));
  const needed = Object.fromEntries(CM_DATA_FILES.map(name => [name, files[name]]));
  assert.deepEqual(readCm0102(needed), readCm0102(files));
  for (const name of CM_DATA_FILES) {
    const { [name]: _gone, ...without } = needed;
    assert.throws(() => readCm0102(without), new RegExp(name.replace('.', '\\.')), `${name} is needed`);
  }
});

// ---------- importing ----------

test('a known release is built in the browser with the shipped release list, kept, listed and loaded', async () => {
  fresh();
  const progress = [];
  const read = [];
  const files = chosen(november2007());
  for (const file of files) {
    const arrayBuffer = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => { read.push(file.name); return arrayBuffer(); };
  }
  const result = await importSeason([...files, ...chosen({ 'staff_history.dat': new Uint8Array(9) })],
    { ...quiet, onProgress: step => progress.push(step) });
  assert.deepEqual(read.sort(), [...CM_DATA_FILES].sort(), 'only the files the reader needs');
  assert.deepEqual(progress, [
    { state: 'reading', message: 'Reading Championship Manager 01-02/Data (42 MB)…' },
    { state: 'building', message: 'Building 2007/08 from CM 01/02 · November 2007…' },
  ]);
  const { doc, entry, previous, folder, persistent } = result;
  assert.deepEqual([doc.id, doc.year, doc.season, doc.label, doc.source.version, doc.source.dobShift],
    ['cm0102-2007-11', 2008, '2007/08', 'CM 01/02 · November 2007', 'November 2007', 6]);
  assert.match(doc.version, /^cm0102-2007-11-[0-9a-f]{8}$/);
  assert.deepEqual([previous, folder, persistent], [null, 'Championship Manager 01-02/Data', false]);
  assert.deepEqual(result.audit.database.digests, { club: 'mismatch', staff: 'mismatch' }, 'the padded copy is not the published one');
  assert.deepEqual(await listLocalSets(), [entry]);
  assert.deepEqual(await getLocalSet(doc.id), doc);
  assert.equal(importedMessage(result), 'Added 2007/08 · CM 01/02 · November 2007. 7 of 170 nations field a full XI; '
    + '7 clubs from 7 leagues. Its files differ from the published November 2007, so it may have been edited. '
    + 'This browser cannot keep it, so it lasts until the page closes.');

  const index = await loadFootballSetIndex({ fetch: async () => ({ ok: false, status: 404 }) });
  assert.deepEqual(index, [{ id: doc.id, version: doc.version, year: 2008, season: '2007/08', label: 'CM 01/02 · November 2007', added: true }]);
  const set = await loadFootballSet(doc.id, { fetch: async () => { throw new Error('nothing is fetched'); } });
  assert.equal(set.meta.version, doc.version);
  assert.deepEqual(set.clubs.map(club => club.league).sort(), ['Bundesliga', 'Eredivisie', 'La Liga', 'Liga Portugal', 'Ligue 1', 'Premier League', 'Serie A']);
  assert.ok(set.rosters['826'][2].every(player => player[3].source === 'cm0102' && player[3].provider === 'CM 01/02 Update Team'));

  // The same folder again replaces it with the same build; a persistent store drops the visit-only note.
  const again = await importSeason(chosen(november2007()), quiet);
  assert.equal(again.doc.version, doc.version);
  assert.equal(again.previous.version, doc.version);
  assert.match(importedMessage({ ...again, persistent: true }), /^Already added: 2007\/08 · CM 01\/02 · November 2007\. .* may have been edited\.$/);
  assert.match(importedMessage({ ...again, previous: { ...again.previous, version: 'cm0102-2007-11-00000000' } }), /^Updated 2007\/08 /);
  assert.equal((await listLocalSets()).length, 1);
});

test('the build waits for a paint after saying so, and players of nations the game lacks are left out and counted', async () => {
  fresh();
  const steps = [];
  let painted = null;
  const importing = importSeason(chosen(november2007({ unmapped: true })), {
    onProgress: step => steps.push(step.state),
    afterPaint: () => new Promise(resolve => { painted = resolve; }),
  });
  while (!painted) await later();
  assert.deepEqual(steps, ['reading', 'building']);
  assert.deepEqual(await listLocalSets(), [], 'nothing is built before the paint');
  painted();
  const result = await importing;
  assert.deepEqual(result.audit.unmapped, { Fictionland: 2 });
  assert.match(importedMessage(result), / 2 players from nations the game does not have were left out\./);
  assert.ok(result.warnings.some(warning => /Left out the players of unmapped nations: Fictionland \(2\)/.test(warning)));
});

test('a folder the browser cannot add is refused with what to do instead, and nothing is kept', async () => {
  fresh();
  // Not one of the known releases: the command-line builder can be told its season.
  const unknown = writeCm0102Files(sampleDatabase({ birthYearShift: 6 }));
  const size = name => unknown[name].length.toLocaleString('en');
  await assert.rejects(importSeason(chosen(unknown), quiet), {
    message: `This database is not one of the 48 known CM 01/02 releases (club.dat ${size('club.dat')} bytes, staff.dat ${size('staff.dat')} bytes), `
      + 'so its season is unknown. npm run build:football-set can add it if you name the season yourself (see "Football seasons" in the README).',
  });
  // Mac data and a broken index stop in the reader.
  const mac = writeMacFiles(sampleDatabase());
  const macFolder = Object.fromEntries(CM_DATA_FILES.map(name => [name, mac[name] || new Uint8Array(0)]));
  await assert.rejects(importSeason(chosen(macFolder), quiet), /Mac CM 01\/02 \(3\.9\.62\) data.*use a PC Data folder/);
  const broken = november2007();
  broken['index.dat'] = broken['index.dat'].slice();
  broken['index.dat'][8] = 0x7f;
  await assert.rejects(importSeason(chosen(broken), quiet), /not a PC CM 01\/02 index/);
  // A store that will not take it.
  useLocalSets({ ...memoryLocalSets(), put: async () => { throw new Error('QuotaExceededError'); } });
  await assert.rejects(importSeason(chosen(november2007()), quiet), /^Error: This browser would not store the season: QuotaExceededError$/);
  useLocalSets(memoryLocalSets());
  assert.deepEqual(await listLocalSets(), []);
});
