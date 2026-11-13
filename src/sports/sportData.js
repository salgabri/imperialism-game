// Each sport's players: its national rosters and its clubs. The page's first download holds every sport's rules and
// football's players; every other sport's players come in a later chunk (sportData.lazy.js), loaded the first time
// that sport is played (`loadSportData`). Node (the tests and scripts) has every sport's players from the start
// (sportData.eager.js): package.json "imports" resolves `#sport-data` to one or the other, so nothing there waits.
//
// A sport's `rosters`, `clubs` and any `territory` worked out from them read the loaded players (`defineSportData`).
// Reading them before the sport has loaded throws, so no cache keyed by a sport can ever store an empty answer: the app
// lets a sport into a setup or a campaign only once its players are here.
import { EAGER, LOADERS } from '#sport-data';

const loaded = new Map(Object.entries(EAGER));
const loading = new Map();

/** Whether sport `id`'s players are here, so its rosters and clubs can be read at once. */
export const sportDataLoaded = id => loaded.has(id);

/**
 * Load sport `id`'s players: resolves once they are here. Concurrent and repeated calls share one request, and a failed
 * load is not kept, so the next call tries again.
 */
export function loadSportData(id) {
  if (loaded.has(id)) return Promise.resolve();
  let pending = loading.get(id);
  if (!pending) {
    const load = Object.hasOwn(LOADERS, id) ? LOADERS[id] : null;
    if (!load) return Promise.reject(new Error(`Unknown sport "${id}"`));
    pending = new Promise(resolve => resolve(load())).then(
      data => { loaded.set(id, data); loading.delete(id); },
      error => { loading.delete(id); throw error; });
    loading.set(id, pending);
  }
  return pending;
}

/**
 * Run `fn` once every sport in `ids` has its players: at once (in the same call, returning what `fn` returns) when they
 * all have, else after they load (a promise of what `fn` returns). Nothing waits when nothing has to load.
 */
export function withSportData(ids, fn) {
  const missing = [...new Set(ids)].filter(id => id && !loaded.has(id));
  return missing.length ? Promise.all(missing.map(loadSportData)).then(() => fn()) : fn();
}

/** Sport `id`'s players. Reading a sport whose players have not loaded is a bug, so it throws rather than read empty. */
function playersOf(id) {
  const data = loaded.get(id);
  if (!data) throw new Error(`The ${id} players have not loaded yet.`);
  return data;
}

const derived = new Map();

/**
 * Give `sport` its players: `rosters` and `clubs` (each unless `false`) read the loaded players of sport `id`, and
 * `territory`, when `territoryOf` is given, is worked out from the rosters once (the same object every time, like a
 * constant). Each key keeps its place in the object, so the sport lists its keys as before.
 */
export function defineSportData(sport, { id = sport.id, rosters = true, clubs = true, territoryOf = null } = {}) {
  const field = get => ({ get, enumerable: true, configurable: true });
  if (rosters) Object.defineProperty(sport, 'rosters', field(() => playersOf(id).rosters));
  if (clubs) Object.defineProperty(sport, 'clubs', field(() => playersOf(id).clubs));
  if (territoryOf) {
    Object.defineProperty(sport, 'territory', field(() => {
      if (!derived.has(id)) derived.set(id, territoryOf(playersOf(id).rosters));
      return derived.get(id);
    }));
  }
  return sport;
}
