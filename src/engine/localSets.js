// Football seasons added in this browser (docs/design/football-years.md): data sets that setup's "Add a season…"
// built from the player's own CM 01/02 Data folder (src/engine/seasonImport.js). They are kept in IndexedDB, so they
// stay on this computer and outlive the page. Where the browser refuses IndexedDB (some private windows, a sandboxed
// frame, Node tests) they are kept in memory for this visit only, and `localSetsPersist()` says so.

const DB_NAME = 'imperialism-football-sets';
const DB_VERSION = 1;
// The listing apart from the sets, so the Season list never reads a set's players.
const LISTING = 'listing';
const SETS = 'sets';

/** A data set's index entry, in the shape buildFootballIndex writes to index.json, plus when it was added. */
export function localEntryOf(doc, addedAt = new Date().toISOString()) {
  return { id: doc.id, version: doc.version, year: doc.year, season: doc.season, label: doc.label,
    provider: doc.source?.provider, local: doc.local, coverage: doc.coverage, addedAt };
}

/** Seasons kept for as long as the page is open: tests, and the fallback without IndexedDB. */
export function memoryLocalSets() {
  const listing = new Map(), sets = new Map();
  return {
    persistent: false,
    list: async () => [...listing.values()].map(entry => structuredClone(entry)),
    get: async id => (sets.has(id) ? structuredClone(sets.get(id)) : null),
    put: async (entry, doc) => {
      listing.set(entry.id, structuredClone(entry));
      sets.set(entry.id, structuredClone(doc));
    },
    remove: async id => {
      listing.delete(id);
      sets.delete(id);
    },
  };
}

/** The same store over IndexedDB (`factory` is the page's indexedDB). A failed open is tried again on the next call. */
export function indexedDbLocalSets(factory) {
  let opening = null;
  const open = () => (opening ||= new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LISTING)) db.createObjectStore(LISTING, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SETS)) db.createObjectStore(SETS);
    };
    request.onsuccess = () => {
      const db = request.result;
      // A later version opened in another tab closes this connection; the next call opens again.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB would not open'));
    request.onblocked = () => reject(new Error('IndexedDB is held by another tab'));
  }).catch(error => {
    opening = null;
    throw error;
  }));
  // Every request is made up front and read on `complete`, so nothing awaits inside the transaction.
  const run = async (names, mode, issue) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const request = issue(tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error || new Error('IndexedDB failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB stopped the transaction'));
    });
  };
  return {
    persistent: true,
    open,
    list: () => run([LISTING], 'readonly', tx => tx.objectStore(LISTING).getAll()),
    get: id => run([SETS], 'readonly', tx => tx.objectStore(SETS).get(id)).then(doc => doc ?? null),
    put: (entry, doc) => run([LISTING, SETS], 'readwrite', tx => {
      tx.objectStore(SETS).put(doc, entry.id);
      return tx.objectStore(LISTING).put(entry);
    }),
    remove: id => run([LISTING, SETS], 'readwrite', tx => {
      tx.objectStore(SETS).delete(id);
      return tx.objectStore(LISTING).delete(id);
    }),
  };
}

/** IndexedDB when this page may open it, else memory; decided on first use. */
function browserLocalSets() {
  let chosen = null;
  const store = () => (chosen ||= (async () => {
    let factory = null;
    try {
      factory = globalThis.indexedDB;
    } catch {
      // A sandboxed frame throws on the property itself.
    }
    if (typeof factory?.open !== 'function') return memoryLocalSets();
    const idb = indexedDbLocalSets(factory);
    try {
      await idb.open();
      return idb;
    } catch {
      return memoryLocalSets();
    }
  })());
  return {
    store,
    list: async () => (await store()).list(),
    get: async id => (await store()).get(id),
    put: async (entry, doc) => (await store()).put(entry, doc),
    remove: async id => (await store()).remove(id),
  };
}

let active = null;
const current = () => (active ||= browserLocalSets());

/** Keep the seasons added in this browser in `store` (tests; `memoryLocalSets()`); null goes back to the page's own. */
export function useLocalSets(store) {
  active = store;
}

/** Whether added seasons outlive this page: false where the browser refused IndexedDB. */
export async function localSetsPersist() {
  const store = current();
  return !!(store.store ? await store.store() : store).persistent;
}

/** The seasons added in this browser, as index entries with `addedAt`; none when the store cannot be read. */
export async function listLocalSets() {
  try {
    const entries = await current().list();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** A season added in this browser (its data set file), or null. Throws when the store cannot be read. */
export async function getLocalSet(id) {
  return (await current().get(String(id))) ?? null;
}

/** Keep a built data set in this browser, in place of any with its id. Resolves to its index entry. */
export async function putLocalSet(doc) {
  const entry = localEntryOf(doc);
  await current().put(entry, doc);
  return entry;
}

/** Forget a season added in this browser. */
export async function deleteLocalSet(id) {
  await current().remove(String(id));
}
