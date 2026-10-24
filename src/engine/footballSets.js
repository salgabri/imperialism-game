// Football data sets: one dated database's nations and clubs, played instead of the built-in season. Loads a local
// `public/football/<id>.json` (format 1, see docs/design/football-years.md), validates it strictly and exposes it as a
// football sport bound to that season. The built-in data (src/data/rosters.js, clubs.football.js) never changes.

import { DEPENDENCIES, NATIONS } from '../data/teams.js';
import { CM_CONVERSION, CM_ROLES, CM_SCALE, cmTupleOf, expandCmTuple } from '../data/cmPlayers.js';
import { football } from '../sports/football.js';
import { getSport } from '../sports/index.js';

export const FOOTBALL_SET_FORMAT = 1;
/** The built-in data's season (EA FC 26 + FM 26). Year N is the season ending in N. */
export const BUILT_IN_SEASON = Object.freeze({ year: 2026, season: '2025/26' });

const SET_ID = /^cm0102-\d{4}-\d{2}(-[a-z0-9]+)?$/;
export const isFootballSetId = id => typeof id === 'string' && SET_ID.test(id);
export const isDataYear = year => Number.isInteger(year) && year >= 1872 && year <= 2100;
/** '2025/26' for 2026. */
export const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const versionPattern = id => new RegExp(`^${id}-[0-9a-f]{8}$`);
// The builder's `f-<slug>` ids. The fixed prefix also keeps a club clear of Object.prototype names such as
// `__proto__`, which the campaign's team maps would swallow.
const CLUB_ID = /^f-[a-z0-9-]{0,62}$/;

// What build-rosters writes for a nation with no players.
const EMPTY_STRENGTH = 40;
const NO_TERRITORY = Object.freeze({ merged: Object.freeze({}), inactive: Object.freeze([]) });

// ---------- index ----------

let index = null;

/** Forget the data set index (tests, or after a rebuild). */
export function clearFootballSetIndex() {
  index = null;
}

/**
 * The local data sets present, newest season first: `[{ id, version, year, season, label }]`, read once from
 * `football/index.json`. A missing or unreadable index means no sets; a listing that fails the checks is skipped
 * (each set file is validated in full when it loads).
 */
export function loadFootballSetIndex({ baseUrl = '/', fetch: fetchImpl = globalThis.fetch } = {}) {
  index ||= (async () => {
    try {
      const res = await fetchImpl(`${baseUrl}football/index.json`);
      return res?.ok ? listing(await res.json()) : [];
    } catch {
      return [];
    }
  })();
  return index;
}

function listing(data) {
  // The builder writes `{ format: 1, sets }`; an index of another format lists nothing this build can read.
  if (data?.format != null && data.format !== FOOTBALL_SET_FORMAT) return [];
  const entries = Array.isArray(data) ? data : data?.sets;
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const valid = entries.filter(entry => entry && isFootballSetId(entry.id) && !seen.has(entry.id) && seen.add(entry.id)
    && isDataYear(entry.year) && entry.season === seasonOf(entry.year) && typeof entry.label === 'string' && entry.label.trim()
    && (entry.version == null || (typeof entry.version === 'string' && versionPattern(entry.id).test(entry.version))));
  // Ids carry the release month, so within a season the later release sorts first.
  return Object.freeze(valid.sort((a, b) => b.year - a.year || (a.id < b.id ? 1 : -1))
    .map(({ id, version = null, year, season, label }) => Object.freeze({ id, version, year, season, label: label.trim() })));
}

// ---------- loading ----------

// A decoded set holds every nation's and club's players. Keep the retained ones (the set the setup has chosen) plus
// this many recently used others; in-flight loads are always kept, so repeated calls share one request.
export const FOOTBALL_SET_CACHE_LIMIT = 2;
const cache = new Map();
let retained = new Set();

function touch(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
}

function trimCache() {
  let spare = FOOTBALL_SET_CACHE_LIMIT;
  for (const [key, entry] of [...cache].reverse()) {
    if (!entry.value || retained.has(key)) continue;
    if (spare > 0) spare--;
    else cache.delete(key);
  }
}

/** Forget loaded data sets (tests, or a forced reload after a failed one). */
export function clearFootballSetCache(id) {
  if (id == null) cache.clear();
  else cache.delete(String(id));
}

/** Keep exactly these data sets loaded (null ids are ignored); others are evicted beyond FOOTBALL_SET_CACHE_LIMIT. */
export function retainFootballSets(ids = []) {
  retained = new Set([...ids].filter(id => id != null).map(String));
  trimCache();
}

/** Decoded data set ids in the cache, least recently used first (diagnostics and tests). */
export function loadedFootballSetIds() {
  return [...cache].filter(([, entry]) => entry.value).map(([key]) => key);
}

/** The already-loaded data set, or null; for synchronous paths after loadFootballSet resolved. */
export function getLoadedFootballSet(id) {
  const key = String(id), entry = cache.get(key);
  if (!entry?.value) return null;
  touch(key, entry);
  return entry.value;
}

/**
 * Fetch, validate and decode one data set. Resolves to `{ meta, rosters, clubs, territory }`; concurrent and repeated
 * calls share one request per id, and a failed load is not cached.
 */
export function loadFootballSet(id, { baseUrl = '/', fetch: fetchImpl = globalThis.fetch } = {}) {
  const key = String(id);
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return hit.promise;
  }
  const entry = {};
  entry.promise = (async () => {
    if (!isFootballSetId(key)) throw new Error(`Unknown football data set "${key}"`);
    if (typeof fetchImpl !== 'function') throw new Error('No fetch available to load football data sets');
    let res;
    try {
      res = await fetchImpl(`${baseUrl}football/${key}.json`);
    } catch (e) {
      throw new Error(`Football data set ${key} failed to load: ${(e && e.message) || e}`);
    }
    if (!res || !res.ok) throw new Error(`Football data set ${key} failed to load (HTTP ${res?.status ?? '?'})`);
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`Football data set ${key} is not valid JSON: ${(e && e.message) || e}`);
    }
    entry.value = decodeFootballSet(data, key);
    if (cache.get(key) === entry) {
      touch(key, entry);
      trimCache();
    }
    return entry.value;
  })();
  entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  cache.set(key, entry);
  return entry.promise;
}

// ---------- decoding ----------

/**
 * Validate a parsed format-1 file and expand its players (no caching): `{ meta, rosters, clubs, territory }`, where
 * `rosters` and `clubs` have the built-in shapes buildTeam and buildClub read.
 */
export function decodeFootballSet(data, id = data?.id) {
  validateFootballSet(data, String(id));
  const { nations, clubs, territory, ...meta } = data;
  const expand = tuple => expandSetPlayer(tuple, meta.source);
  return {
    meta,
    rosters: Object.fromEntries(Object.keys(NATIONS).map(nation => {
      const [str, pool, players] = nations[nation];
      return [nation, [str, pool, players.map(expand)]];
    })),
    clubs: clubs.map(club => ({ ...club, squad: club.squad.map(expand) })),
    territory: { merged: { ...territory.merged }, inactive: [...territory.inactive] },
  };
}

/**
 * One player of a data set as buildTeam and buildClub read it: expandCmTuple's record, credited to the database's
 * provider. expandCmTuple leaves the provider out, and not every database is the Update Team's (SI's own releases
 * among them), so the record names it. Saves rebuild players through this too.
 */
export function expandSetPlayer(tuple, source) {
  const player = expandCmTuple(tuple, source);
  if (source.provider != null && player[3].provider === undefined) player[3].provider = source.provider;
  return player;
}

function validateFootballSet(data, id) {
  const fail = message => { throw new Error(`Football data set ${id}: ${message}`); };
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const rating = v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 99;
  const nation = v => typeof v === 'string' && Object.hasOwn(NATIONS, v);

  if (!isFootballSetId(id)) fail('id must look like "cm0102-<yyyy>-<mm>"');
  if (!isObject(data)) fail('file is not a JSON object');
  if (data.format !== FOOTBALL_SET_FORMAT) fail(`unsupported format ${JSON.stringify(data.format)} (expected ${FOOTBALL_SET_FORMAT})`);
  if (data.id !== id) fail(`file id ${JSON.stringify(data.id)} does not match the requested data set`);
  if (typeof data.version !== 'string' || !versionPattern(id).test(data.version)) {
    fail(`version ${JSON.stringify(data.version)} must look like "${id}-<8 hex>"`);
  }
  if (!isDataYear(data.year)) fail(`year ${JSON.stringify(data.year)} must be an integer from 1872 to 2100`);
  if (data.season !== seasonOf(data.year)) fail(`season ${JSON.stringify(data.season)} must be "${seasonOf(data.year)}", the season ending in ${data.year}`);
  if (!text(data.label)) fail('label is missing');
  if (data.local != null && typeof data.local !== 'boolean') fail('local must be true or false');
  const src = data.source;
  if (!isObject(src) || !['edition', 'version', 'snapshotDate'].every(key => text(src[key]))) {
    fail('source must name the edition, database version and snapshotDate');
  }
  if (src.provider != null && !text(src.provider)) fail('source provider is empty');
  if (typeof src.url !== 'string' || !/^https?:\/\/\S+$/i.test(src.url)) fail('source url must be an http(s) link');
  if (src.rawScale !== CM_SCALE) fail(`source rawScale must be ${CM_SCALE}`);
  if (src.conversion !== CM_CONVERSION) fail(`source conversion must be "${CM_CONVERSION}"`);
  if (data.coverage != null && (!isObject(data.coverage)
    || Object.values(data.coverage).some(n => !Number.isInteger(n) || n < 0))) fail('coverage must hold counts');

  // The builder writes only tuples that rebuild exactly, so anything else (an unknown or repeated position key, a
  // full name equal to the name, a malformed date) is a file it did not write.
  const players = (at, tuples) => {
    if (!Array.isArray(tuples)) fail(`${at} must be a list of players`);
    const ids = new Set();
    tuples.forEach((tuple, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(tuple) || tuple.length !== 8) fail(`${where} is not a CM player tuple`);
      const [cmId, , , , positions, , , dateOfBirth] = tuple;
      if (ids.has(cmId)) fail(`${where} repeats player ${cmId}`);
      ids.add(cmId);
      const keys = String(positions).split(',');
      // Own keys only: 'constructor' must not pass as a position.
      if (!keys.every(key => Object.hasOwn(CM_ROLES, key)) || new Set(keys).size !== keys.length) {
        fail(`${where} has unknown or repeated positions ${JSON.stringify(positions)}`);
      }
      if (dateOfBirth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) fail(`${where} date of birth ${JSON.stringify(dateOfBirth)} is not YYYY-MM-DD`);
      let rebuilt;
      try {
        const [name, , , sourceInfo] = expandCmTuple(tuple, src);
        rebuilt = cmTupleOf(name, sourceInfo);
      } catch (e) {
        fail(`${where}: ${e.message}`);
      }
      if (JSON.stringify(rebuilt) !== JSON.stringify(tuple)) fail(`${where} does not rebuild exactly`);
    });
  };

  // Every nation has an entry, even an empty one, so no season falls back to the built-in hand-tuned strength.
  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  const unknown = Object.keys(nations).filter(key => !nation(key));
  if (unknown.length) fail(`nations has unknown ids ${unknown.slice(0, 5).join(', ')}`);
  const missing = Object.keys(NATIONS).filter(key => !Object.hasOwn(nations, key));
  if (missing.length) fail(`nations must list all ${Object.keys(NATIONS).length} nations; missing ${missing.slice(0, 5).join(', ')}`);
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, poolSize, players]`);
    const [str, pool, list] = entry;
    if (!rating(str)) fail(`${at} strength must be a rating 1-99`);
    players(at, list);
    if (!Number.isInteger(pool) || pool < list.length) fail(`${at} poolSize must be an integer of at least its ${list.length} players`);
  }

  // League ids are the built-in ones, so a club theatre means the same in every data set and saved names resolve.
  const leagues = new Set(football.clubs.map(club => club.league));
  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  const clubIds = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !CLUB_ID.test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like "f-<name>"`);
    if (clubIds.has(club.id)) fail(`${at} id is duplicated`);
    clubIds.add(club.id);
    if (!text(club.name)) fail(`${at} has no name`);
    if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
    if (!leagues.has(club.league)) fail(`${at} league ${JSON.stringify(club.league)} is not a built-in league`);
    if (!nation(club.country)) fail(`${at} country ${JSON.stringify(club.country)} is not a nation id`);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (!rating(club.str)) fail(`${at} str must be a rating 1-99`);
    players(`${at} squad`, club.squad);
  });

  const territory = data.territory;
  if (!isObject(territory) || !isObject(territory.merged) || !Array.isArray(territory.inactive)) {
    fail('territory must be { merged: { shape: holder }, inactive: [shape] }');
  }
  const inactive = new Set();
  for (const shape of territory.inactive) {
    if (!nation(shape)) fail(`territory.inactive ${JSON.stringify(shape)} is not a nation id`);
    if (inactive.has(shape)) fail(`territory.inactive repeats ${shape}`);
    inactive.add(shape);
  }
  for (const [shape, holder] of Object.entries(territory.merged)) {
    if (!nation(shape)) fail(`territory.merged ${JSON.stringify(shape)} is not a nation id`);
    if (!nation(holder) || holder === shape) fail(`territory.merged ${shape} names no other nation as its holder`);
    if (inactive.has(shape)) fail(`territory ${shape} is both merged and inactive`);
    if (inactive.has(holder) || Object.hasOwn(territory.merged, holder)) fail(`territory.merged ${shape}: holder ${holder} fields no team that year`);
  }
}

// ---------- the season-bound sport ----------

const sports = new WeakMap();

/**
 * The football sport bound to a decoded data set: its nations, clubs and territory in place of the built-in ones,
 * plus the set's identity for setup caches and settings. Memoised per decoded set, so a version keeps one sport
 * while it stays loaded.
 */
export function footballSport(set) {
  let sport = sports.get(set);
  if (!sport) {
    const { meta, rosters, clubs, territory } = set;
    sport = { ...football, rosters, clubs, territory,
      // Every nation has an entry (validated), so this only guards the rule that no other season borrows it.
      fallbackStrength: () => EMPTY_STRENGTH,
      dataSet: meta.id, dataVersion: meta.version, dataYear: meta.year, dataSeason: meta.season, dataLabel: meta.label };
    sports.set(set, sport);
  }
  return sport;
}

/**
 * The sport a setup or saved campaign's settings play with: the data set's once it has loaded (null until then),
 * else the built-in sport. Data sets are football only.
 */
export function sportOf(config) {
  const sport = getSport(config?.sport);
  if (sport.id !== 'football' || config?.dataSet == null) return sport;
  const loaded = getLoadedFootballSet(config.dataSet);
  return loaded ? footballSport(loaded) : null;
}

/** Nations fielding a team in the sport's season: a data set leaves out shapes merged into another federation or with none. */
export function fieldedNations(sport) {
  const { merged, inactive } = sport?.territory || NO_TERRITORY;
  return Object.keys(NATIONS).filter(id => !Object.hasOwn(merged, id) && !inactive.includes(id));
}

/** Shapes that start in another nation's empire, as [shape, holder]: overseas dependencies, then a set's merged federations. */
export function heldShapes(sport) {
  return [...Object.entries(DEPENDENCIES).map(([shape, dep]) => [shape, dep.of]),
    ...Object.entries((sport?.territory || NO_TERRITORY).merged)];
}
