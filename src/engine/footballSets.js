// Data sets: one dated database's nations and clubs, played instead of a sport's built-in season. A football set is
// one of the built-in earlier seasons (src/data/footballSeasons.js: an EA FIFA / FC roster, FIFA 05 and FIFA 06 with
// nations only; before them SI's Championship Manager databases, Sensible World of Soccer's, two fans' and, for the
// World Cups of 1962 to 1994, nations computed from their Elo and squads) or a CM 01/02 database built on this
// computer; a basketball set is a built-in earlier NBA season (an NBA 2K edition, or computed from the season's
// statistics), clubs only, on its era's map; a baseball set a built-in earlier MLB season (an MLB The Show edition,
// or computed from WAR), its nations by birthplace and its clubs on its era's map; the other sports' alike. Each is a
// `public/<sport>/<id>.json` (format 1, see docs/design/football-years.md), validated strictly and exposed as that sport
// bound to the season. The built-in data (src/data/rosters.js, clubs.football.js, the basketball and baseball modules)
// never changes.

import { DEPENDENCIES, HOME_NATIONS, NATIONS, PACIFIC_ISLANDS, fieldsRealSide } from '../data/teams.js';
import { CM_CONVERSION, CM_ROLES, CM_SCALE, cmTupleOf, expandCmTuple } from '../data/cmPlayers.js';
import { EA_ROLES, EA_SCALE, eaTupleOf, expandEaTuple } from '../data/eaPlayers.js';
import { SWOS_CONVERSION, SWOS_ROLES, SWOS_SCALE, expandSwosTuple, swosTupleOf } from '../data/swosPlayers.js';
import { BUILT_IN_SEASONS } from '../data/footballSeasons.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../data/basketballSeasons.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../data/baseballSeasons.js';
import { BUILT_IN_WOMENS_SEASONS } from '../data/womensFootballSeasons.js';
import { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } from '../data/americanFootballSeasons.js';
import { BUILT_IN_TENNIS_SEASONS } from '../data/tennisSeasons.js';
import { BUILT_IN_WOMENS_TENNIS_SEASONS } from '../data/womensTennisSeasons.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../data/hockeySeasons.js';
import { BUILT_IN_RUGBY_LEAGUE_SEASONS } from '../data/rugbyLeagueSeasons.js';
import { CLUB_MAPS } from '../data/clubMaps.js';
import { EUROPE_MAPS } from '../data/europeMaps.js';
import { FLAG_CODES } from '../data/flags.js';
import { basketball } from '../sports/basketball.js';
import { americanFootball } from '../sports/americanFootball.js';
import { tennis } from '../sports/tennis.js';
import { womensTennis } from '../sports/womensTennis.js';
import { hockey } from '../sports/hockey.js';
import { rugbyLeague } from '../sports/rugbyLeague.js';
import { baseball } from '../sports/baseball.js';
import { football } from '../sports/football.js';
import { womensFootball } from '../sports/womensFootball.js';
import { getSport } from '../sports/index.js';

export const FOOTBALL_SET_FORMAT = 1;
/** The built-in data's season (EA FC 27 + FM 26). Year N is the season ending in N. */
export const BUILT_IN_SEASON = Object.freeze({ year: 2027, season: '2026/27' });
// Basketball's built-in clubs and national fives' NBA ratings are NBA 2K27's (2026/27), the women's game's EA FC 27's and
// ice hockey's NHL 27's.
// The NFL's season is one calendar year: Madden NFL 27 rates the 2026 season. So is MLB's: MLB The Show 26 rates 2026.
// Tennis's is the ATP's, women's tennis's the WTA's: the Elo ratings of November 2026.
const BUILT_IN_SEASONS_OF = Object.freeze({ football: BUILT_IN_SEASON, 'womens-football': BUILT_IN_SEASON,
  basketball: Object.freeze({ year: 2027, season: '2026/27' }), hockey: Object.freeze({ year: 2027, season: '2026/27' }),
  'american-football': Object.freeze({ year: 2026, season: '2026' }), baseball: Object.freeze({ year: 2026, season: '2026' }),
  tennis: Object.freeze({ year: 2026, season: '2026' }), 'womens-tennis': Object.freeze({ year: 2026, season: '2026' }),
  // Rugby League 26 rates the 2025 NRL season, a calendar year.
  'rugby-league': Object.freeze({ year: 2025, season: '2025' }) });
/** The season a sport's built-in data plays. */
export const builtInSeasonOf = sportId => BUILT_IN_SEASONS_OF[getSport(sportId).id];

// The kinds of data set, told apart by their ids' prefixes: the sport each plays in, the shape of its ids, whether it
// fields national teams (`nations: false`: clubs only), which of its ids have nations only (`nationsOnly`), whether its
// clubs play on a map of their era (`mapped`, src/data/clubMaps.js) rather than on the world, and whether its season is
// a calendar year (`calendar`: '2025') rather than a winter's ('2025/26'). A CM 01/02 database is the kind of any id
// no other prefix claims: `cm0102-<release month>[-variant]`.
const SET_KINDS = Object.freeze({
  // `ea-fifa-<nn>` / `ea-fc-<nn>`: an EA edition. SoFIFA, this game's only source of EA's clubs before FIFA 15, starts
  // with FIFA 07, so the editions before it have nations only.
  ea: { prefix: 'ea-', id: /^ea-(?:fifa|fc)-\d{2}$/, sport: 'football', nationsOnly: /^ea-fifa-0[0-6]$/ },
  // `eaw-fifa-<nn>` / `eaw-fc-<nn>`: an EA edition's women. EA rated national teams alone until FIFA 22, and the women's
  // clubs from FIFA 23 on.
  eaw: { prefix: 'eaw-', id: /^eaw-(?:fifa|fc)-\d{2}$/, sport: 'womens-football', nationsOnly: /^eaw-fifa-(?:1\d|2[0-2])$/ },
  // `nba-2k<nn>`: an NBA 2K edition, the NBA's clubs only.
  // Also, by the season they rate: NBA 2K's MyNBA Eras leagues (`nba-eras-<season end year>`), NBA 2K's classic teams
  // of one season (`nba-classic-<season end year>`), EA's NBA Live editions (`nba-live-<nn>`) and the seasons no game
  // rated, computed from the players' season statistics (`nba-stats-<season end year>`, source.conversion says how).
  nba2k: { prefix: 'nba-', id: /^nba-(?:2k\d{2}|eras-\d{4}|classic-\d{4}|live-\d{2}|stats-\d{4})$/, sport: 'basketball', nations: false, mapped: true },
  // `mlb-the-show-<nn>`: an MLB The Show edition, its nations by birthplace and the MLB's clubs. `mlb-war-<year>`: a
  // season no game rated, computed from the players' WAR (source.computed, source.conversion), the same shape.
  show: { prefix: 'mlb-', id: /^mlb-(?:the-show-\d{2}|war-\d{4})$/, sport: 'baseball', mapped: true, calendar: true },
  // `madden-<season>`: a Madden NFL edition, by the NFL season it rates (Madden NFL 06 rates 2005), the NFL's clubs only.
  // An edition that kept its players' attributes but no overall has its overalls converted (source.overall 'converted',
  // source.conversion).
  madden: { prefix: 'madden-', id: /^madden-\d{4}$/, sport: 'american-football', nations: false, mapped: true, calendar: true },
  // `tecmo-<season>`: a Tecmo Super Bowl edition, by the NFL season it rates (the NES game rates 1990), the NFL's clubs
  // only. Tecmo rates attributes, not players: each overall is converted (source.conversion).
  tecmo: { prefix: 'tecmo-', id: /^tecmo-\d{4}$/, sport: 'american-football', nations: false, mapped: true, calendar: true },
  // `pfa-<season>` / `pfa-afl-<season>`: an NFL (or, before the 1970 merger, AFL) season no game rated, computed from the
  // players' season facts (starts, positions, box scores; source.method 'computed', source.conversion), clubs only.
  pfa: { prefix: 'pfa-', id: /^pfa-(?:afl-)?\d{4}$/, sport: 'american-football', nations: false, mapped: true, calendar: true },
  // `tennis-<year>`: the ATP's men at the end of a year, by Elo, the Davis Cup's nations only.
  elo: { prefix: 'tennis-', id: /^tennis-\d{4}$/, sport: 'tennis', nationsOnly: /^tennis-/, calendar: true },
  // `wta-<year>`: the WTA's women at the end of a year, by Elo, the Fed Cup's nations only.
  wta: { prefix: 'wta-', id: /^wta-\d{4}$/, sport: 'womens-tennis', nationsOnly: /^wta-/, calendar: true },
  // `nhl-<season end year>`: an NHL season's ratings from an EA NHL edition (NHL 94 rates 1993/94 → `nhl-1994`), its
  // nations by nationality and the NHL's clubs. A season no edition rated is computed from the NHL's statistics, or
  // converted from an edition's attributes (source.method, source.conversion). Before 1977/78 fewer than three nations
  // field a real side (Canada; the USA from 1971/72, Sweden from 1977/78), so those seasons have clubs only (`clubsOnly`).
  nhl: { prefix: 'nhl-', id: /^nhl-\d{4}$/, sport: 'hockey', mapped: true, clubsOnly: /^nhl-19(?:6\d|7[0-7])$/ },
  // `nrl-<season>`: an NRL season from a rugby league game's database (Rugby League 2: World Cup Edition rates 2008), the
  // NRL's clubs only. The game rates attributes, not players: each overall is converted (source.conversion). A season
  // no game rated is computed from the players' match statistics (source.method 'computed', source.metric).
  nrl: { prefix: 'nrl-', id: /^nrl-\d{4}$/, sport: 'rugby-league', nations: false, mapped: true, calendar: true },
  // `cm-<season>`: a Championship Manager edition's database before CM 01/02 (CM 97/98 → `cm-9798`, CM 99/00 →
  // `cm-9900`, CM 00/01 → `cm-0001`), its players CM 01/02's tuples.
  cm: { prefix: 'cm-', id: /^cm-\d{4}$/, sport: 'football' },
  // `wc-<season end year>`: a World Cup season no game rated, its finalists' squads computed from the nations' Elo and
  // the players' records (source.conversion), nations only.
  wc: { prefix: 'wc-', id: /^wc-\d{4}$/, sport: 'football', nationsOnly: /^wc-/ },
  // `swos-<season>`: a Sensible World of Soccer edition (SWOS 96/97 → `swos-9697`): its national squads, and its clubs
  // where the edition's own team files give them (SWOS 96/97 is nations only).
  swos: { prefix: 'swos-', id: /^swos-\d{4}$/, sport: 'football', nationsOnly: /^swos-9697$/ },
  // Simon Treanor's fan-made 1989/90 database has nations only: its clubs cannot field 1989/90's top divisions.
  cm0102: { prefix: '', id: /^cm0102-\d{4}-\d{2}(-[a-z0-9]+)?$/, sport: 'football', nationsOnly: /^cm0102-2017-04-cm89$/ },
});
const kindRecord = id => {
  const text = String(id);
  return Object.values(SET_KINDS).find(kind => kind.prefix && text.startsWith(kind.prefix)) || SET_KINDS.cm0102;
};
export const isFootballSetId = id => typeof id === 'string' && kindRecord(id).id.test(id);
/** Whose players a set holds, by its id: 'ea', 'eaw', 'nba2k', 'show', 'cm', 'swos' or 'cm0102' (and the other sports' kinds). */
export const setKindOf = id => Object.keys(SET_KINDS).find(kind => SET_KINDS[kind] === kindRecord(id));
/** The sport a set is played in, by its id. */
export const setSportOf = id => kindRecord(id).sport;
/** Whether a set fields national teams: every one but the clubs-only kinds' (the NBA's, the NFL's, the NRL's) and the
 * early NHL seasons, when fewer than three nations fielded a real side. */
export const setHasNations = id => kindRecord(id).nations !== false && !kindRecord(id).clubsOnly?.test(String(id));
/** Whether a set has clubs: every one but those with nations only (the EA editions before FIFA 07, SWOS 96/97, the computed
 * World Cup seasons, tennis's). */
export const setHasClubs = id => !kindRecord(id).nationsOnly?.test(String(id));
/** Whether a set's clubs play on a map of their era (src/data/clubMaps.js) rather than on the world. */
export const setIsMapped = id => !!kindRecord(id).mapped;
export const isDataYear = year => Number.isInteger(year) && year >= 1872 && year <= 2100;
/** '2025/26' for 2026. */
export const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
/** A set's season as it names it: football's and basketball's '2025/26', baseball's calendar year, '2025'. */
export const seasonLabelOf = (id, year) => (kindRecord(id).calendar ? String(year) : seasonOf(year));
const versionPattern = id => new RegExp(`^${id}-[0-9a-f]{8}$`);
// The builder's `f-<slug>` ids. The fixed prefix also keeps a club clear of Object.prototype names such as
// `__proto__`, which the campaign's team maps would swallow.
const CLUB_ID = /^f-[a-z0-9-]{0,62}$/;
// The women's game's clubs, `w-<slug>` as its built-in clubs' (scripts/build-womens-football.mjs).
const WOMENS_CLUB_ID = /^w-[a-z0-9-]{1,62}$/;
// Kinds whose players are EA's tuples (src/data/eaPlayers.js).
const EA_KINDS = new Set(['ea', 'eaw']);

// What build-rosters writes for a nation with no players.
const EMPTY_STRENGTH = 40;
const NO_TERRITORY = Object.freeze({ merged: Object.freeze({}), inactive: Object.freeze([]) });
// A set built before the map had the home nations lists none of them: England holds their land, as it did on the map
// the set was built for, and their players played for no nation.
const beforeHomeNations = nations => HOME_NATIONS.every(id => !Object.hasOwn(nations, id));
// Nor does a set built before the map had Tonga, Samoa and the Cook Islands list them: they field no team, and their
// land stays neutral, as on the map the set was built for (no source it was built from rated their players).
const beforePacificIslands = nations => PACIFIC_ISLANDS.every(id => !Object.hasOwn(nations, id));

// ---------- index ----------

let index = null;

/** Forget the data set index (tests, or after a rebuild). */
export function clearFootballSetIndex() {
  index = null;
}

// Within a season the later id sorts first: a later CM release, or an EA edition before a CM database.
const newestFirst = (a, b) => b.year - a.year || (a.id < b.id ? 1 : -1);

/**
 * The data sets present, newest season first: `[{ id, version, year, season, label, map?, credit? }]` (`map`: a
 * basketball season's era map; `credit`: the plain text a season's sources ask to be shown with it, which setup shows
 * under the Season choice), every sport's together (`setSportOf` tells them apart). The built-in earlier seasons are always
 * there; CM 01/02 sets built on this computer are read once from `football/index.json`, where a missing or unreadable
 * index means none. A listing that fails the checks is skipped (each set is validated in full when it loads).
 */
export function loadFootballSetIndex({ baseUrl = '/', fetch: fetchImpl = globalThis.fetch } = {}) {
  index ||= (async () => {
    let files = [];
    try {
      const res = await fetchImpl(`${baseUrl}football/index.json`);
      if (res?.ok) files = listing(await res.json());
    } catch {
      files = [];
    }
    // Only CM 01/02 builds are local: every basketball season is built in.
    const local = files.filter(set => setSportOf(set.id) === 'football' && !BUILT_IN_SETS.some(builtIn => builtIn.id === set.id));
    return local.length ? Object.freeze([...BUILT_IN_SETS, ...local].sort(newestFirst)) : BUILT_IN_SETS;
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
    && isDataYear(entry.year) && entry.season === seasonLabelOf(entry.id, entry.year) && typeof entry.label === 'string' && entry.label.trim()
    && (entry.version == null || (typeof entry.version === 'string' && versionPattern(entry.id).test(entry.version)))
    && (entry.credit == null || (typeof entry.credit === 'string' && entry.credit.trim()))
    && (!setIsMapped(entry.id) || eraMapOf(entry.id, entry.map) != null));
  // A credit stays exactly as written: a source's terms can ask for its statement word for word.
  return Object.freeze(valid.sort(newestFirst).map(({ id, version = null, year, season, label, map, credit }) => Object.freeze({
    id, version, year, season, label: label.trim(), ...(setIsMapped(id) ? { map } : {}), ...(credit != null ? { credit } : {}) })));
}

// A basketball or baseball season's map (src/data/clubMaps.js), or null: an earlier era's that lists the season, or
// today's for a season with today's teams in today's arenas.
const eraMapOf = (id, map) => CLUB_MAPS.find(entry => entry.id === map && entry.sport === setSportOf(id)
  && (entry.seasons == null || entry.seasons.includes(id))) || null;

/** Whether a club map is an earlier era's, played only with its seasons' clubs. */
export const isEraMap = id => [...CLUB_MAPS, ...EUROPE_MAPS].some(entry => entry.id === id && entry.seasons != null);

/**
 * Whether a map its clubs choose between is one of data set `id`'s: a football season's Europe map, or a women's
 * football season's Europe or NWSL map (src/data/europeMaps.js, clubMaps.js).
 */
export const isSeasonTheatreMap = (mapId, id) => [...EUROPE_MAPS, ...CLUB_MAPS]
  .some(entry => entry.id === mapId && entry.sport === setSportOf(id) && !setIsMapped(id) && !!entry.seasons?.includes(id));

/** The built-in earlier seasons of every sport, newest first, as the index lists them. */
export const BUILT_IN_SETS = listing([...BUILT_IN_SEASONS, ...BUILT_IN_WOMENS_SEASONS, ...BUILT_IN_BASKETBALL_SEASONS,
  ...BUILT_IN_AMERICAN_FOOTBALL_SEASONS, ...BUILT_IN_BASEBALL_SEASONS, ...BUILT_IN_HOCKEY_SEASONS, ...BUILT_IN_TENNIS_SEASONS,
  ...BUILT_IN_WOMENS_TENNIS_SEASONS, ...BUILT_IN_RUGBY_LEAGUE_SEASONS]);

/** The era map a basketball or baseball season's clubs play on (null for any other set). */
export const seasonMapOf = id => BUILT_IN_SETS.find(set => set.id === id)?.map ?? null;

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
      res = await fetchImpl(`${baseUrl}${setSportOf(key)}/${key}.json`);
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
 * `rosters` and `clubs` have the built-in shapes buildTeam and buildClub read. A basketball season has clubs only
 * (`rosters` null), whose `[name, positions, rating]` players are already the built-in shape.
 */
export function decodeFootballSet(data, id = data?.id) {
  validateFootballSet(data, String(id));
  // The federations of the day it plays (`meta.identities`, men's football only): seasonSport plays them as playsAs.
  if (data.identities !== undefined) data = { ...data, identities: frozenIdentities(data.identities) };
  if (['nba2k', 'madden', 'tecmo', 'pfa', 'nrl'].includes(setKindOf(data.id))) {
    const { clubs, ...meta } = data;
    return { meta, rosters: null, clubs: clubs.map(club => ({ ...club, squad: club.squad.map(player => [...player]) })), territory: NO_TERRITORY };
  }
  if (setKindOf(data.id) === 'elo' || setKindOf(data.id) === 'wta') {
    const { nations, clubs, territory, ...meta } = data;
    return {
      meta,
      rosters: Object.fromEntries(Object.entries(nations).map(([nation, [str, real, players]]) => [nation, [str, real, players.map(player => [player[0], player[1], player[2], { ...player[3] }])]])),
      clubs: [],
      territory: { merged: { ...territory.merged }, inactive: [...territory.inactive] },
    };
  }
  // A computed World Cup season lists only its finalists, each with its XI as the built-in rosters hold players: every
  // other nation fields no team, and its land stays neutral. Its identities stay in `meta`.
  if (setKindOf(data.id) === 'wc') {
    const { nations, clubs, territory, ...meta } = data;
    const record = source => ({ ...source, ...(source.awards ? { awards: [...source.awards] } : {}),
      ...(source.ballonDor ? { ballonDor: { ...source.ballonDor } } : {}) });
    return {
      meta,
      rosters: Object.fromEntries(Object.entries(nations).map(([nation, [str, size, players]]) => [nation, [str, size,
        players.map(([name, pos, rating, source]) => [name, pos, rating, record(source)])]])),
      clubs: [],
      territory: { merged: { ...territory.merged }, inactive: [...territory.inactive] },
    };
  }
  if (setKindOf(data.id) === 'show' || setKindOf(data.id) === 'nhl') {
    const { nations, clubs, territory, ...meta } = data;
    return {
      meta,
      rosters: Object.fromEntries(Object.entries(nations).map(([nation, [str, real, players]]) => [nation, [str, real, players.map(player => [...player])]])),
      clubs: clubs.map(club => ({ ...club, squad: club.squad.map(player => [...player]) })),
      territory: { merged: { ...territory.merged }, inactive: [...territory.inactive] },
    };
  }
  const { nations, clubs, territory, ...meta } = data;
  const expand = tuple => expandSetPlayer(tuple, meta.source, setKindOf(meta.id));
  // A women's season lists only the nations with a rated player; every other one fields no team (`territory.inactive`).
  if (setKindOf(meta.id) === 'eaw') {
    return {
      meta,
      rosters: Object.fromEntries(Object.entries(nations).map(([nation, [str, pool, players]]) => [nation, [str, pool, players.map(expand)]])),
      clubs: clubs.map(club => ({ ...club, squad: club.squad.map(expand) })),
      territory: { merged: { ...territory.merged }, inactive: [...territory.inactive] },
    };
  }
  const englandHolds = beforeHomeNations(nations);
  return {
    meta,
    rosters: Object.fromEntries(Object.keys(NATIONS).map(nation => {
      const [str, pool, players] = nations[nation] || [EMPTY_STRENGTH, 0, []];
      return [nation, [str, pool, players.map(expand)]];
    })),
    clubs: clubs.map(club => ({ ...club, squad: club.squad.map(expand) })),
    territory: { merged: { ...territory.merged, ...(englandHolds ? Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])) : {}) },
      inactive: [...territory.inactive, ...(beforePacificIslands(nations) ? PACIFIC_ISLANDS : [])] },
  };
}

/**
 * One player of a data set as buildTeam and buildClub read it. A CM player is expandCmTuple's record, credited to the
 * database's provider: expandCmTuple leaves the provider out, and not every database is the Update Team's (SI's own
 * releases among them), so the record names it. An EA player is expandEaTuple's record. Saves rebuild players through
 * this too.
 */
export function expandSetPlayer(tuple, source, kind = 'cm0102') {
  if (EA_KINDS.has(kind)) return expandEaTuple(tuple, source);
  if (kind === 'swos') {
    const player = expandSwosTuple(tuple, source);
    if (source.provider != null) player[3].provider = source.provider;
    return player;
  }
  const player = expandCmTuple(tuple, source);
  if (source.provider != null && player[3].provider === undefined) player[3].provider = source.provider;
  return player;
}

// Each kind's player tuples (the position keys are their fifth field, the date of birth their eighth) and source block.
const KINDS = {
  cm0102: { size: 8, roles: CM_ROLES, tupleOf: cmTupleOf,
    source: src => (!['edition', 'version', 'snapshotDate'].every(key => typeof src[key] === 'string' && src[key].trim())
      ? 'source must name the edition, database version and snapshotDate'
      : src.rawScale !== CM_SCALE ? `source rawScale must be ${CM_SCALE}`
        : src.conversion !== CM_CONVERSION ? `source conversion must be "${CM_CONVERSION}"` : '') },
  ea: { size: 9, roles: EA_ROLES, tupleOf: eaTupleOf,
    source: src => (!['edition', 'snapshotDate'].every(key => typeof src[key] === 'string' && src[key].trim())
      || !Number.isInteger(src.update) || src.update < 0 || !/^\d{6}$/.test(String(src.roster))
      ? 'source must name the edition, roster update, SoFIFA roster and snapshotDate'
      : src.rawScale !== EA_SCALE ? `source rawScale must be ${EA_SCALE}`
        : src.conversion !== undefined ? 'EA ratings are not converted' : '') },
  // Clubs only, each player `[name, positions, rating]` as the built-in basketball clubs hold them.
  // NBA 2K's overalls are used as they are; NBA Live's are put on NBA 2K's scale by a line its source states, and a
  // computed season's are derived from the players' statistics by a rule its source states.
  nba2k: { size: 3,
    source: (src, id) => (!['edition', 'compiler'].every(key => typeof src[key] === 'string' && src[key].trim())
      ? 'source must name the edition and who compiled its ratings'
      : src.rawScale !== NBA_SCALE ? `source rawScale must be ${NBA_SCALE}`
        : /^nba-live-/.test(id) ? (typeof src.conversion === 'string' && src.conversion.trim() ? ''
          : 'source conversion must say how NBA Live\'s overalls were put on NBA 2K\'s scale')
          : /^nba-stats-/.test(id) ? (typeof src.conversion === 'string' && src.conversion.trim() ? ''
            : 'source conversion must say how the overalls were computed from the statistics')
            : src.conversion !== undefined ? 'NBA 2K ratings are not converted' : '') },
  // Nations and clubs, each player `[name, positions, rating]` as the built-in baseball teams hold them. A season no
  // game rated is computed from the players' WAR: its source says so (computed, method) and how (conversion).
  show: { size: 3,
    source: (src, id) => (/^mlb-war-/.test(id)
      ? (!['edition', 'retrieved', 'method', 'conversion'].every(key => typeof src[key] === 'string' && src[key].trim())
        ? 'source must name the edition, when it was read, the method and how the ratings were derived'
        : src.computed !== true ? 'source must say the ratings are computed'
          : src.rawScale !== 'WAR' ? 'source rawScale must be "WAR"' : '')
      : !['edition', 'update', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
        ? 'source must name the edition, its roster update and when it was read'
        : src.rawScale !== SHOW_SCALE ? `source rawScale must be ${SHOW_SCALE}`
          : src.conversion !== undefined ? 'MLB The Show ratings are not converted' : '') },
};
// The women's EA seasons hold the same tuples and source block as the men's.
KINDS.eaw = KINDS.ea;
// A Championship Manager database before CM 01/02 (CM 97/98) holds CM 01/02's tuples and source block.
KINDS.cm = KINDS.cm0102;
// SWOS's national squads: CM's tuple layout plus the seven skill digits (src/data/swosPlayers.js), its price step converted.
KINDS.swos = { size: 9, roles: SWOS_ROLES, tupleOf: swosTupleOf,
  source: src => (!['edition', 'version', 'snapshotDate'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, database version and snapshotDate'
    : src.rawScale !== SWOS_SCALE ? `source rawScale must be ${SWOS_SCALE}`
      : src.conversion !== SWOS_CONVERSION ? `source conversion must be "${SWOS_CONVERSION}"` : '') };
// Each football kind's player tuple, as an error names it.
const TUPLE_NAMES = { ea: 'an EA', eaw: 'an EA', swos: 'a SWOS' };
// Nations only, each player `[name, 'SGL', rating, source]` as the built-in tennis rosters hold them; the women's the same.
KINDS.elo = { size: 4,
  source: src => (!['edition', 'name', 'snapshotDate', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, its publisher, the date the ratings are of and when they were read'
    : src.rawScale !== 'Elo' ? 'source rawScale must be "Elo"' : '') };
KINDS.wta = KINDS.elo;
// A computed World Cup season: nations only, each its XI as `[name, position, rating, source]`, the built-in rosters'
// shape. Its source says the ratings are computed (method 'computed'), from Elo of which day, by what rule
// (conversion), and under which licence.
KINDS.wc = { size: 4,
  source: src => (!['edition', 'snapshotDate', 'retrieved', 'conversion', 'licence'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, the day its Elo is of, when it was read, how the ratings were computed and their licence'
    : src.method !== 'computed' || src.computed !== true ? 'source must say the ratings are computed (method "computed")'
      : src.rawScale !== 'Elo' ? 'source rawScale must be "Elo"' : '') };
// Nations and clubs, each player `[name, position, rating]`. A season no edition rated says how its ratings were made
// (source.method 'computed' from the NHL's statistics, or 'converted' from an edition's attributes) and the rule
// (source.conversion).
KINDS.nhl = { size: 3,
  source: src => (!['edition', 'compiler', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, who compiled its ratings and when they were read'
    : src.method !== undefined ? (!['computed', 'converted'].includes(src.method) ? 'source method must be "computed" or "converted"'
      : !(typeof src.conversion === 'string' && src.conversion.trim()) ? 'source conversion must say how the ratings were derived'
        : !(Number.isInteger(src.rawScale) || (typeof src.rawScale === 'string' && src.rawScale.trim())) ? 'source rawScale must be a number or name the measure' : '')
      : !Number.isInteger(src.rawScale) ? 'source rawScale must be a number' : '') };
// Clubs only, each player `[name, position, rating]` as the built-in NFL clubs hold them. An edition that kept its
// players' attributes but no overall says so (source.overall 'converted') and how its overalls were derived.
KINDS.madden = { size: 3,
  source: src => (!['edition', 'compiler', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, who compiled its ratings and when they were read'
    : src.overall === 'converted' ? (!Number.isInteger(src.rawScale) || src.rawScale < 1 ? 'source rawScale must be the attributes\' scale'
      : !(typeof src.conversion === 'string' && src.conversion.trim()) ? 'source conversion must say how the overalls were derived' : '')
      : src.overall !== undefined ? 'source overall must be "converted" or absent'
        : src.rawScale !== 99 ? 'source rawScale must be 99'
          : src.conversion !== undefined ? 'Madden ratings are not converted' : '') };
// The same clubs in a season no game rated: their overalls computed from the season's facts by a documented rule.
KINDS.pfa = { size: 3,
  source: src => (!['edition', 'compiler', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, who compiled its facts and when they were read'
    : src.method !== 'computed' ? 'source method must be "computed"'
      : src.rawScale !== 'value' ? 'source rawScale must be "value"'
        : !(typeof src.conversion === 'string' && src.conversion.trim()) ? 'source conversion must say how the overalls were derived' : '') };
// The same clubs, their overalls converted from Tecmo's attributes by a documented rule.
KINDS.tecmo = { size: 3,
  source: src => (!['edition', 'compiler', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, who compiled its ratings and when they were read'
    : !(typeof src.conversion === 'string' && src.conversion.trim()) ? 'source conversion must say how the overalls were derived' : '') };
// Clubs only, each player `[name, position, rating]` as the built-in rugby league clubs hold them, their overalls
// converted from the game's 1–10 attributes by a documented rule (source.conversion), as Tecmo's are. A season no game
// rated is computed from the players' match statistics (source.method 'computed', the measure in source.metric).
KINDS.nrl = { size: 3,
  source: src => (!['edition', 'compiler', 'retrieved'].every(key => typeof src[key] === 'string' && src[key].trim())
    ? 'source must name the edition, who compiled its ratings and when they were read'
    : !(typeof src.conversion === 'string' && src.conversion.trim()) ? 'source conversion must say how the overalls were derived'
      : src.method === 'computed' ? (!(typeof src.metric === 'string' && src.metric.trim()) ? 'source metric must name the measure the ratings rank' : '')
        : src.method !== undefined ? 'source method must be "computed" or absent'
          : !Number.isInteger(src.rawScale) ? 'source rawScale must be a number' : '') };
const NBA_SCALE = 99;
const SHOW_SCALE = 99;
const BASKETBALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
// The built-in basketball clubs' `b-<slug>` ids, with the same guard against Object.prototype names.
const BASKETBALL_CLUB_ID = /^b-[a-z0-9-]{1,62}$/;

function validateFootballSet(data, id) {
  const fail = message => { throw new Error(`Football data set ${id}: ${message}`); };
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const rating = v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 99;
  const nation = v => typeof v === 'string' && Object.hasOwn(NATIONS, v);

  if (!isFootballSetId(id)) fail('id must look like "cm0102-<yyyy>-<mm>", "cm-<yyyy>", "swos-<yyyy>", "wc-<yyyy>", "ea-fifa-<nn>", "eaw-fifa-<nn>", "nba-2k<nn>", "nba-stats-<yyyy>", "mlb-the-show-<nn>", "mlb-war-<yyyy>", "madden-<yyyy>", "pfa-<yyyy>", "nhl-<yyyy>", "nrl-<yyyy>", "tennis-<yyyy>" or "wta-<yyyy>"');
  if (!isObject(data)) fail('file is not a JSON object');
  if (data.format !== FOOTBALL_SET_FORMAT) fail(`unsupported format ${JSON.stringify(data.format)} (expected ${FOOTBALL_SET_FORMAT})`);
  if (data.id !== id) fail(`file id ${JSON.stringify(data.id)} does not match the requested data set`);
  // A set without `kind` is a CM 01/02 one, as every set was before the EA seasons.
  const kind = KINDS[setKindOf(id)];
  if (!kind) fail(`this build cannot read ${setKindOf(id)} sets`);
  if ((data.kind ?? 'cm0102') !== setKindOf(id)) fail(`kind ${JSON.stringify(data.kind)} is not the kind its id names`);
  if (typeof data.version !== 'string' || !versionPattern(id).test(data.version)) {
    fail(`version ${JSON.stringify(data.version)} must look like "${id}-<8 hex>"`);
  }
  if (!isDataYear(data.year)) fail(`year ${JSON.stringify(data.year)} must be an integer from 1872 to 2100`);
  if (data.season !== seasonLabelOf(id, data.year)) fail(`season ${JSON.stringify(data.season)} must be "${seasonLabelOf(id, data.year)}", the season ending in ${data.year}`);
  if (!text(data.label)) fail('label is missing');
  if (data.local != null && typeof data.local !== 'boolean') fail('local must be true or false');
  const src = data.source;
  if (!isObject(src)) fail('source is missing');
  const sourceProblem = kind.source(src, id);
  if (sourceProblem) fail(sourceProblem);
  if (src.provider != null && !text(src.provider)) fail('source provider is empty');
  if (typeof src.url !== 'string' || !/^https?:\/\/\S+$/i.test(src.url)) fail('source url must be an http(s) link');
  if (data.coverage != null && (!isObject(data.coverage)
    || Object.values(data.coverage).some(n => !Number.isInteger(n) || n < 0))) fail('coverage must hold counts');
  if (data.identities !== undefined) validateIdentities(data, id, fail);
  if (setKindOf(id) === 'nba2k') return validateBasketballClubs(data, id, fail);
  if (setKindOf(id) === 'show') return validateBaseballSeason(data, id, fail);
  if (setKindOf(id) === 'elo' || setKindOf(id) === 'wta') return validateTennisSeason(data, id, fail);
  if (setKindOf(id) === 'wc') return validateWorldCupSeason(data, id, fail);
  if (setKindOf(id) === 'nhl') return validateNationsAndClubsOnMap(data, id, fail, { sport: hockey, clubId: NHL_CLUB_ID,
    positions: new Set(Object.keys(hockey.formation)), clubLeast: 12, noun: 'an NHL season' });
  if (setKindOf(id) === 'nrl') return validateClubsOnMap(data, id, fail, { sport: rugbyLeague, clubId: NRL_CLUB_ID,
    positions: new Set(Object.keys(rugbyLeague.formation)), least: rugbyLeague.squadSize, noun: 'an NRL season' });
  if (['madden', 'tecmo', 'pfa'].includes(setKindOf(id))) return validateClubsOnMap(data, id, fail, { sport: americanFootball, clubId: NFL_CLUB_ID,
    positions: new Set(Object.keys(americanFootball.formation)), least: americanFootball.squadSize, noun: 'an NFL season' });

  // The builder writes only tuples that rebuild exactly, so anything else (an unknown or repeated position key, a
  // full name equal to the name, a malformed date) is a file it did not write.
  const players = (at, tuples) => {
    if (!Array.isArray(tuples)) fail(`${at} must be a list of players`);
    const ids = new Set();
    tuples.forEach((tuple, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(tuple) || tuple.length !== kind.size) fail(`${where} is not ${TUPLE_NAMES[setKindOf(id)] ?? 'a CM'} player tuple`);
      const [playerId, , , , positions, , , dateOfBirth] = tuple;
      if (ids.has(playerId)) fail(`${where} repeats player ${playerId}`);
      ids.add(playerId);
      const keys = String(positions).split(',');
      // Own keys only: 'constructor' must not pass as a position.
      if (!keys.every(key => Object.hasOwn(kind.roles, key)) || new Set(keys).size !== keys.length) {
        fail(`${where} has unknown or repeated positions ${JSON.stringify(positions)}`);
      }
      if (dateOfBirth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) fail(`${where} date of birth ${JSON.stringify(dateOfBirth)} is not YYYY-MM-DD`);
      let rebuilt;
      try {
        const [name, , , sourceInfo] = expandSetPlayer(tuple, src, setKindOf(id));
        rebuilt = kind.tupleOf(name, sourceInfo);
      } catch (e) {
        fail(`${where}: ${e.message}`);
      }
      if (JSON.stringify(rebuilt) !== JSON.stringify(tuple)) fail(`${where} does not rebuild exactly`);
    });
  };

  // Every nation has an entry, even an empty one, so no season falls back to the built-in hand-tuned strength. A women's
  // season lists only the nations with a rated player instead: every other one fields no team and is inactive.
  const women = setKindOf(id) === 'eaw';
  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  const unknown = Object.keys(nations).filter(key => !nation(key));
  if (unknown.length) fail(`nations has unknown ids ${unknown.slice(0, 5).join(', ')}`);
  const older = beforeHomeNations(nations), islandless = beforePacificIslands(nations);
  const missing = women ? [] : Object.keys(NATIONS).filter(key => !Object.hasOwn(nations, key) && !(older && HOME_NATIONS.includes(key))
    && !(islandless && PACIFIC_ISLANDS.includes(key)));
  if (missing.length) fail(`nations must list all ${Object.keys(NATIONS).length} nations; missing ${missing.slice(0, 5).join(', ')}`);
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, poolSize, players]`);
    const [str, pool, list] = entry;
    if (!rating(str)) fail(`${at} strength must be a rating 1-99`);
    players(at, list);
    if (!Number.isInteger(pool) || pool < list.length) fail(`${at} poolSize must be an integer of at least its ${list.length} players`);
    if (women && !list.length) fail(`${at} has no players: a nation with none is inactive, not listed`);
  }

  // League names are the built-in ones, so a club reads the same in every data set.
  const leagues = new Set((women ? womensFootball : football).clubs.map(club => club.league));
  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  if (!setHasClubs(id) && data.clubs.length) fail('this season has nations only');
  const clubIds = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !(women ? WOMENS_CLUB_ID : CLUB_ID).test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like "${women ? 'w' : 'f'}-<name>"`);
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
  // In a women's season a nation fields a team exactly when it is listed: the others' land stays neutral.
  if (women) {
    const fielded = Object.keys(NATIONS).filter(key => !inactive.has(key) && !Object.hasOwn(territory.merged, key));
    const unlisted = fielded.filter(key => !Object.hasOwn(nations, key)), idle = Object.keys(nations).filter(key => !fielded.includes(key));
    if (unlisted.length) fail(`territory leaves ${unlisted.slice(0, 5).join(', ')} active with no players`);
    if (idle.length) fail(`territory makes listed nations ${idle.slice(0, 5).join(', ')} inactive or merged`);
  }
}

const foldName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A men's football season of another era names the federations of its day it plays (`identities`, from
 * src/data/footballSetBuild.js identitiesFor: `{ '643': { name: 'Soviet Union', code: 'URS', flagId: 'URS' } }`), any
 * football kind. Each names a nation the season fields (listed with players, neither merged nor inactive), a name and a
 * three-capital code no other nation of the season plays under, and a flag the game has (src/data/flags.js). Checked
 * before the kind's own rules, so it reads nations and territory warily.
 */
function validateIdentities(data, id, fail) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  if (setSportOf(id) !== 'football') fail('only a men\'s football season plays nations under identities of their day');
  const identities = data.identities;
  if (!isObject(identities) || !Object.keys(identities).length) fail('identities must name at least one nation');
  const nations = isObject(data.nations) ? data.nations : {};
  const merged = isObject(data.territory?.merged) ? data.territory.merged : {};
  const inactive = Array.isArray(data.territory?.inactive) ? data.territory.inactive : [];
  const fielded = shape => Object.hasOwn(NATIONS, shape) && Object.hasOwn(nations, shape) && Array.isArray(nations[shape]?.[2])
    && nations[shape][2].length > 0 && !Object.hasOwn(merged, shape) && !inactive.includes(shape);
  // The names and codes the season's other nations play under.
  const codes = new Map(), names = new Map();
  for (const shape of Object.keys(nations)) {
    if (!fielded(shape) || Object.hasOwn(identities, shape)) continue;
    codes.set(NATIONS[shape][1], shape);
    names.set(foldName(NATIONS[shape][0]), shape);
  }
  for (const [shape, identity] of Object.entries(identities)) {
    const at = `identities[${shape}]`;
    if (!fielded(shape)) fail(`${at} names no nation the season fields`);
    if (!isObject(identity) || Object.keys(identity).sort().join() !== 'code,flagId,name') fail(`${at} must be { name, code, flagId }`);
    const { name, code, flagId } = identity;
    if (typeof name !== 'string' || !name.trim() || name !== name.trim()) fail(`${at} has no name`);
    if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) fail(`${at} code ${JSON.stringify(code)} must be three capitals`);
    if (typeof flagId !== 'string' || !Object.hasOwn(FLAG_CODES, flagId)) fail(`${at} flag ${JSON.stringify(flagId)} is not one the game has`);
    if (codes.has(code)) fail(`${at} code ${code} is ${codes.get(code)}'s too`);
    if (names.has(foldName(name))) fail(`${at} name ${JSON.stringify(name)} is ${names.get(foldName(name))}'s too`);
    codes.set(code, shape);
    names.set(foldName(name), shape);
  }
}

/** A set's identities, copied and frozen, so a decoded set's sport cannot change the file it came from. */
const frozenIdentities = identities => Object.freeze(Object.fromEntries(Object.entries(identities)
  .map(([shape, { name, code, flagId }]) => [shape, Object.freeze({ name, code, flagId })])));

/**
 * A basketball season's clubs: the NBA's of that season, one per section of its era's map (`map`), each with its best
 * five as `[name, 'PG' or 'PG/SG', rating]`. Saved names resolve against them, so ids, codes and leagues follow the
 * built-in clubs' rules.
 */
function validateBasketballClubs(data, id, fail) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const rating = v => Number.isInteger(v) && v >= 1 && v <= 99;
  if (data.nations !== undefined || data.territory !== undefined) fail('an NBA season has clubs only');
  const map = eraMapOf(id, data.map);
  if (!map) fail(`map ${JSON.stringify(data.map)} is not a basketball map listing this season`);
  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  if (data.clubs.length !== map.clubs) fail(`clubs must be the ${map.clubs} of map ${map.id}, found ${data.clubs.length}`);
  const leagues = new Set(basketball.clubs.map(club => club.league));
  const ids = new Set(), codes = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !BASKETBALL_CLUB_ID.test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like "b-<name>"`);
    if (ids.has(club.id)) fail(`${at} id is duplicated`);
    ids.add(club.id);
    if (!text(club.name)) fail(`${at} has no name`);
    if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
    if (codes.has(club.code)) fail(`${at} code ${club.code} is duplicated`);
    codes.add(club.code);
    if (!leagues.has(club.league)) fail(`${at} league ${JSON.stringify(club.league)} is not a built-in league`);
    if (typeof club.country !== 'string' || !Object.hasOwn(NATIONS, club.country)) fail(`${at} country ${JSON.stringify(club.country)} is not a nation id`);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (!rating(club.str)) fail(`${at} str must be a rating 1-99`);
    if (!Array.isArray(club.squad) || club.squad.length < BASKETBALL_POSITIONS.length) fail(`${at} squad needs at least five players`);
    const names = new Set();
    club.squad.forEach((player, j) => {
      const where = `${at} squad[${j}]`;
      if (!Array.isArray(player) || player.length !== KINDS.nba2k.size) fail(`${where} is not [name, positions, rating]`);
      const [name, positions, value] = player;
      if (!text(name) || name !== name.trim()) fail(`${where} has no name`);
      if (names.has(name)) fail(`${where} repeats ${name}`);
      names.add(name);
      // One position, or two neighbouring ones (primary first), as the built-in clubs list them.
      const [first, second, ...rest] = String(positions).split('/');
      const at1 = BASKETBALL_POSITIONS.indexOf(first), at2 = BASKETBALL_POSITIONS.indexOf(second);
      if (typeof positions !== 'string' || at1 < 0 || rest.length || (second !== undefined && (at2 < 0 || Math.abs(at1 - at2) !== 1))) {
        fail(`${where} positions ${JSON.stringify(positions)} must be one position or two neighbouring ones`);
      }
      if (!rating(value)) fail(`${where} rating must be a whole number 1-99`);
    });
  });
}

/**
 * A tennis season, the men's or the women's: the nations that field a cup team (two to five rated players each, strongest first, as
 * `[name, 'SGL', rating, source]`), no clubs, and its territory: the home nations held by the United Kingdom, every
 * nation it does not list inactive. Ratings are the season's Elo on the game's scale.
 */
function validateTennisSeason(data, id, fail) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  if (!Array.isArray(data.clubs) || data.clubs.length) fail('a tennis season has nations only');
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Object.hasOwn(NATIONS, key)) fail(`${at} is not a nation id`);
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, players, squad]`);
    const [str, real, squad] = entry;
    if (typeof str !== 'number' || !(str >= 1 && str <= 99)) fail(`${at} strength must be a rating 1-99`);
    if (!Array.isArray(squad) || squad.length < 2 || squad.length > 5) fail(`${at} must name two to five players`);
    if (!Number.isInteger(real) || real < squad.length) fail(`${at} counts ${real} players but names ${squad.length}`);
    const names = new Set();
    squad.forEach((player, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(player) || player.length !== 4) fail(`${where} is not [name, 'SGL', rating, source]`);
      const [name, pos, rating, source] = player;
      if (!text(name) || name !== name.trim() || names.has(name)) fail(`${where} has no name, or repeats one`);
      names.add(name);
      if (pos !== 'SGL') fail(`${where} position must be SGL`);
      if (!Number.isInteger(rating) || rating < 1 || rating > 99) fail(`${where} rating must be a whole number 1-99`);
      if (!isObject(source) || !text(source.id) || !text(source.source) || typeof source.rawRating !== 'number') {
        fail(`${where} source must name the player and his Elo`);
      }
    });
    if (squad.some((player, j) => j && player[3].rawRating > squad[j - 1][3].rawRating)) fail(`${at} squad must run strongest first`);
  }
  const territory = data.territory;
  if (!isObject(territory) || !isObject(territory.merged) || !Array.isArray(territory.inactive)) {
    fail('territory must be { merged: { shape: holder }, inactive: [shape] }');
  }
  // The home nations play as Great Britain, as in the Davis Cup; a season of another era may also merge the shapes of a
  // federation of its day into the nation that played for it (the Soviet Union's republics into Russia's).
  if (HOME_NATIONS.some(home => territory.merged[home] !== '826')) fail('territory.merged must put the home nations in the United Kingdom, as the Davis Cup does');
  for (const [shape, holder] of Object.entries(territory.merged)) {
    if (!Object.hasOwn(NATIONS, shape) || shape === holder || !Object.hasOwn(nations, holder) && holder !== '826') {
      fail(`territory.merged ${shape} names no nation of this season as its holder`);
    }
    if (Object.hasOwn(nations, shape)) fail(`territory.merged ${shape} fields a team of its own`);
  }
  const inactive = Object.keys(NATIONS).filter(key => !Object.hasOwn(territory.merged, key) && !Object.hasOwn(nations, key));
  if (JSON.stringify(territory.inactive) !== JSON.stringify(inactive)) fail('territory.inactive must be every nation the season neither lists nor merges');
}

const WORLD_CUP_POSITIONS = new Set(['GK', 'DF', 'MF', 'FW']);
// A computed player's id: the Fjelstul World Cup Database's player id.
const WORLD_CUP_PLAYER_ID = /^wc:P-\d{5}$/;

/**
 * A computed World Cup season: the finalists that field a team, each with the eleven of its World Cup squad strongest
 * first, as `[name, 'GK' | 'DF' | 'MF' | 'FW', rating, source]`, `source` naming the player (`wc:<database id>`), the
 * team's Elo, his place in the XI and his record; no clubs; and its territory, whose holders are its finalists. Every
 * nation it does not list fields no team.
 */
function validateWorldCupSeason(data, id, fail) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const count = v => Number.isInteger(v) && v >= 0;
  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  if (!Array.isArray(data.clubs) || data.clubs.length) fail('a World Cup season has nations only');
  if (Object.keys(nations).length < 2) fail('a World Cup season needs at least two nations');
  const ids = new Set();
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Object.hasOwn(NATIONS, key)) fail(`${at} is not a nation id`);
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, squad size, eleven]`);
    const [str, size, eleven] = entry;
    if (typeof str !== 'number' || !(str >= 1 && str <= 99)) fail(`${at} strength must be a rating 1-99`);
    if (!Array.isArray(eleven) || eleven.length !== 11) fail(`${at} must name its eleven`);
    if (!Number.isInteger(size) || size < eleven.length) fail(`${at} squad of ${size} cannot hold its ${eleven.length}`);
    const names = new Set();
    eleven.forEach((player, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(player) || player.length !== KINDS.wc.size) fail(`${where} is not [name, position, rating, source]`);
      const [name, position, rating, source] = player;
      if (!text(name) || name !== name.trim() || names.has(name)) fail(`${where} has no name, or repeats one`);
      names.add(name);
      if (!WORLD_CUP_POSITIONS.has(position)) fail(`${where} position ${JSON.stringify(position)} must be GK, DF, MF or FW`);
      if (!Number.isInteger(rating) || rating < 1 || rating > 99) fail(`${where} rating must be a whole number 1-99`);
      if (j && rating > eleven[j - 1][2]) fail(`${at} must run strongest first`);
      if (!isObject(source) || source.source !== 'world-cup' || typeof source.id !== 'string' || !WORLD_CUP_PLAYER_ID.test(source.id)
        || !text(source.edition) || source.snapshotDate !== data.source.snapshotDate || typeof source.teamElo !== 'number'
        || source.xiRank !== j + 1 || ![source.shirt, source.minutes, source.starts, source.goals].every(count)) {
        fail(`${where} source must name the player, his team's Elo, his place in the XI and his record`);
      }
      if (source.url !== undefined && !/^https:\/\/en\.wikipedia\.org\/wiki\/\S+$/.test(source.url)) fail(`${where} source url must be his Wikipedia article`);
      if (source.dateOfBirth !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(source.dateOfBirth)) fail(`${where} date of birth ${JSON.stringify(source.dateOfBirth)} is not YYYY-MM-DD`);
      if (ids.has(source.id)) fail(`${where} repeats player ${source.id}`);
      ids.add(source.id);
    });
  }
  const territory = data.territory;
  if (!isObject(territory) || !isObject(territory.merged) || !Array.isArray(territory.inactive)) {
    fail('territory must be { merged: { shape: holder }, inactive: [shape] }');
  }
  const inactive = new Set();
  for (const shape of territory.inactive) {
    if (!Object.hasOwn(NATIONS, shape)) fail(`territory.inactive ${JSON.stringify(shape)} is not a nation id`);
    if (inactive.has(shape)) fail(`territory.inactive repeats ${shape}`);
    if (Object.hasOwn(nations, shape)) fail(`territory.inactive ${shape} fields a team of its own`);
    inactive.add(shape);
  }
  // A federation of the day holds its members' shapes only where it fields a team (the Soviet Union in 1969/70).
  for (const [shape, holder] of Object.entries(territory.merged)) {
    if (!Object.hasOwn(NATIONS, shape) || shape === holder || !Object.hasOwn(nations, holder)) fail(`territory.merged ${shape} names no nation of this season as its holder`);
    if (Object.hasOwn(nations, shape)) fail(`territory.merged ${shape} fields a team of its own`);
    if (inactive.has(shape)) fail(`territory ${shape} is both merged and inactive`);
  }
}

// The built-in NHL clubs' `nhl-<slug>` ids, with the same guard against Object.prototype names.
const NHL_CLUB_ID = /^nhl-[a-z0-9-]{1,62}$/;

/**
 * A season of nations and clubs, its clubs on its era's map (`map`), each player `[name, position, rating]`: an NHL
 * season. Its nations are those with players (a nation it does not list fields its generated minnows, as the built-in
 * season's would); its clubs one per section of the map, at least `clubLeast` players each (a place a club cannot fill
 * is the sport's baseline, as in the built-in season). Ids, codes and leagues follow the built-in clubs' rules.
 */
function validateNationsAndClubsOnMap(data, id, fail, { sport, clubId, positions, clubLeast, noun }) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const squad = (at, list, least) => {
    if (!Array.isArray(list) || list.length < least) fail(`${at} needs at least ${least} players`);
    const names = new Set();
    list.forEach((player, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(player) || player.length !== 3) fail(`${where} is not [name, position, rating]`);
      const [name, position, value] = player;
      if (!text(name) || name !== name.trim()) fail(`${where} has no name`);
      if (names.has(name)) fail(`${where} repeats ${name}`);
      names.add(name);
      if (!positions.has(position)) fail(`${where} position ${JSON.stringify(position)} is not one of the sport's`);
      if (!Number.isInteger(value) || value < 1 || value > 99) fail(`${where} rating must be a whole number 1-99`);
    });
  };
  const map = eraMapOf(id, data.map);
  if (!map) fail(`map ${JSON.stringify(data.map)} is not one of ${sport.name}'s maps listing this season`);
  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Object.hasOwn(NATIONS, key)) fail(`${at} is not a nation id`);
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, players, squad]`);
    const [str, real, list] = entry;
    if (typeof str !== 'number' || !(str >= 1 && str <= 99)) fail(`${at} strength must be a rating 1-99`);
    squad(`${at} squad`, list, 1);
    if (!Number.isInteger(real) || real < list.length) fail(`${at} counts ${real} players but lists ${list.length}`);
  }
  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  if (data.clubs.length !== map.clubs) fail(`clubs must be the ${map.clubs} of map ${map.id}, found ${data.clubs.length}`);
  const leagues = new Set(sport.clubs.map(club => club.league));
  const ids = new Set(), codes = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !clubId.test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like the built-in clubs'`);
    if (ids.has(club.id)) fail(`${at} id is duplicated`);
    ids.add(club.id);
    if (!text(club.name)) fail(`${at} has no name`);
    if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
    if (codes.has(club.code)) fail(`${at} code ${club.code} is duplicated`);
    codes.add(club.code);
    if (!leagues.has(club.league)) fail(`${at} league ${JSON.stringify(club.league)} is not a built-in league`);
    if (typeof club.country !== 'string' || !Object.hasOwn(NATIONS, club.country)) fail(`${at} country ${JSON.stringify(club.country)} is not a nation id`);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (typeof club.str !== 'number' || !(club.str >= 1 && club.str <= 99)) fail(`${at} str must be a rating 1-99`);
    squad(`${at} squad`, club.squad, clubLeast);
  });
  const territory = data.territory;
  if (!isObject(territory) || !isObject(territory.merged) || !Array.isArray(territory.inactive)) {
    fail('territory must be { merged: { shape: holder }, inactive: [shape] }');
  }
  for (const [shape, holder] of Object.entries(territory.merged)) {
    if (!Object.hasOwn(NATIONS, shape) || !Object.hasOwn(NATIONS, holder) || holder === shape) fail(`territory.merged ${shape} names no other nation as its holder`);
  }
  if (!territory.inactive.every(shape => Object.hasOwn(NATIONS, shape))) fail('territory.inactive lists a shape that is not a nation');
}

// The built-in NFL clubs' `nfl-<slug>` ids, with the same guard against Object.prototype names.
const NFL_CLUB_ID = /^nfl-[a-z0-9-]{1,62}$/;
// The built-in rugby league clubs' `nrl-<slug>` ids, likewise.
const NRL_CLUB_ID = /^nrl-[a-z0-9-]{1,62}$/;

/**
 * A season of clubs only on its era's map (`map`), each player `[name, position, rating]` as the sport's built-in clubs
 * hold them: an NFL season. One club per section of the map; ids, codes and leagues follow the built-in clubs' rules,
 * so saved names resolve against them, except that a map of another league of its day (the AFL's, before the 1970
 * merger) names its clubs' league. `least` is the lineup a club must be able to name.
 */
function validateClubsOnMap(data, id, fail, { sport, clubId, positions, least, noun }) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const rating = v => Number.isInteger(v) && v >= 1 && v <= 99;
  if (data.nations !== undefined || data.territory !== undefined) fail(`${noun} has clubs only`);
  const map = eraMapOf(id, data.map);
  if (!map) fail(`map ${JSON.stringify(data.map)} is not one of ${sport.name}'s maps listing this season`);
  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  if (data.clubs.length !== map.clubs) fail(`clubs must be the ${map.clubs} of map ${map.id}, found ${data.clubs.length}`);
  const builtInLeagues = new Set(sport.clubs.map(club => club.league));
  const leagues = map.seasons != null && typeof map.league === 'string' && !builtInLeagues.has(map.league)
    ? new Set([map.league]) : builtInLeagues;
  const ids = new Set(), codes = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !clubId.test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like the built-in clubs'`);
    if (ids.has(club.id)) fail(`${at} id is duplicated`);
    ids.add(club.id);
    if (!text(club.name)) fail(`${at} has no name`);
    if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
    if (codes.has(club.code)) fail(`${at} code ${club.code} is duplicated`);
    codes.add(club.code);
    if (!leagues.has(club.league)) fail(`${at} league ${JSON.stringify(club.league)} is not a built-in league`);
    if (typeof club.country !== 'string' || !Object.hasOwn(NATIONS, club.country)) fail(`${at} country ${JSON.stringify(club.country)} is not a nation id`);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (typeof club.str !== 'number' || !(club.str >= 1 && club.str <= 99)) fail(`${at} str must be a rating 1-99`);
    if (!Array.isArray(club.squad) || club.squad.length < least) fail(`${at} squad needs at least ${least} players`);
    club.squad.forEach((player, j) => {
      const where = `${at} squad[${j}]`;
      if (!Array.isArray(player) || player.length !== 3) fail(`${where} is not [name, position, rating]`);
      const [name, position, value] = player;
      if (!text(name) || name !== name.trim()) fail(`${where} has no name`);
      if (!positions.has(position)) fail(`${where} position ${JSON.stringify(position)} is not one of the sport's`);
      if (!rating(value)) fail(`${where} rating must be a whole number 1-99`);
    });
  });
}

const BASEBALL_POSITIONS = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP']);
// The built-in baseball clubs' `mlb-<slug>` ids, with the same guard against Object.prototype names.
const BASEBALL_CLUB_ID = /^mlb-[a-z0-9-]{1,62}$/;

/**
 * A baseball season: its nations (only those with players; the rest are the sport's minnows) and the MLB's clubs of
 * that season, one per section of its era's map (`map`), each player `[name, 'SS/2B', rating]`, and the home nations
 * merged into the United Kingdom. Saved names resolve against them, so ids, codes and leagues follow the built-in
 * clubs' rules.
 */
function validateBaseballSeason(data, id, fail) {
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const rating = v => Number.isInteger(v) && v >= 1 && v <= 99;
  const squad = (at, list, least) => {
    if (!Array.isArray(list) || list.length < least) fail(`${at} needs at least ${least} players`);
    const names = new Set();
    list.forEach((player, j) => {
      const where = `${at}[${j}]`;
      if (!Array.isArray(player) || player.length !== KINDS.show.size) fail(`${where} is not [name, positions, rating]`);
      const [name, positions, value] = player;
      if (!text(name) || name !== name.trim()) fail(`${where} has no name`);
      if (names.has(name)) fail(`${where} repeats ${name}`);
      names.add(name);
      const listed = typeof positions === 'string' ? positions.split('/') : [];
      if (!listed.length || !listed.every(pos => BASEBALL_POSITIONS.has(pos)) || new Set(listed).size !== listed.length) {
        fail(`${where} positions ${JSON.stringify(positions)} must be baseball positions, primary first`);
      }
      if (!rating(value)) fail(`${where} rating must be a whole number 1-99`);
    });
  };
  const map = eraMapOf(id, data.map);
  if (!map) fail(`map ${JSON.stringify(data.map)} is not a baseball map listing this season`);

  const nations = data.nations;
  if (!isObject(nations)) fail('nations is missing');
  for (const [key, entry] of Object.entries(nations)) {
    const at = `nations[${key}]`;
    if (!Object.hasOwn(NATIONS, key)) fail(`${at} is not a nation id`);
    if (!Array.isArray(entry) || entry.length !== 3) fail(`${at} must be [strength, players, squad]`);
    const [str, real, list] = entry;
    if (!rating(str)) fail(`${at} strength must be a whole number 1-99`);
    squad(`${at} squad`, list, 1);
    if (real !== list.length) fail(`${at} counts ${real} players but lists ${list.length}`);
  }

  if (!Array.isArray(data.clubs)) fail('clubs must be a list');
  if (data.clubs.length !== map.clubs) fail(`clubs must be the ${map.clubs} of map ${map.id}, found ${data.clubs.length}`);
  const leagues = new Set(baseball.clubs.map(club => club.league));
  const ids = new Set(), codes = new Set();
  data.clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (typeof club.id !== 'string' || !BASEBALL_CLUB_ID.test(club.id)) fail(`${at} id ${JSON.stringify(club.id)} must look like "mlb-<name>"`);
    if (ids.has(club.id)) fail(`${at} id is duplicated`);
    ids.add(club.id);
    if (!text(club.name)) fail(`${at} has no name`);
    if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
    if (codes.has(club.code)) fail(`${at} code ${club.code} is duplicated`);
    codes.add(club.code);
    if (!leagues.has(club.league)) fail(`${at} league ${JSON.stringify(club.league)} is not a built-in league`);
    if (typeof club.country !== 'string' || !Object.hasOwn(NATIONS, club.country)) fail(`${at} country ${JSON.stringify(club.country)} is not a nation id`);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (typeof club.str !== 'number' || !(club.str >= 1 && club.str <= 99)) fail(`${at} str must be a rating 1-99`);
    squad(`${at} squad`, club.squad, 13);
  });

  const territory = data.territory;
  if (!isObject(territory) || !isObject(territory.merged) || !Array.isArray(territory.inactive)) {
    fail('territory must be { merged: { shape: holder }, inactive: [shape] }');
  }
  for (const [shape, holder] of Object.entries(territory.merged)) {
    if (!Object.hasOwn(NATIONS, shape) || !Object.hasOwn(NATIONS, holder) || holder === shape) fail(`territory.merged ${shape} names no other nation as its holder`);
  }
  if (!territory.inactive.every(shape => Object.hasOwn(NATIONS, shape))) fail('territory.inactive lists a shape that is not a nation');
}

// ---------- the season-bound sport ----------

const sports = new WeakMap();

/**
 * The sport bound to a decoded data set, plus the set's identity for setup caches and settings. A football set's
 * nations, clubs and territory replace the built-in ones; a basketball season's clubs replace the built-in clubs and
 * play on its era's map (`clubMap`), its national teams never playing with it; a baseball season's nations and clubs
 * replace the built-in ones, its clubs on its era's map, and a nation it does not list is the sport's minnow. Memoised per decoded set, so a version
 * keeps one sport while it stays loaded.
 */
export function seasonSport(set) {
  let sport = sports.get(set);
  if (!sport) {
    const { meta, rosters, clubs, territory } = set;
    const identity = { dataSet: meta.id, dataVersion: meta.version, dataYear: meta.year, dataSeason: meta.season, dataLabel: meta.label };
    sport = setKindOf(meta.id) === 'nba2k' ? { ...basketball, clubs, clubMap: meta.map, ...identity }
      : setKindOf(meta.id) === 'show' ? { ...baseball, rosters, clubs, territory, clubMap: meta.map, ...identity }
      : ['madden', 'tecmo', 'pfa'].includes(setKindOf(meta.id)) ? { ...americanFootball, clubs, clubMap: meta.map, ...identity }
      : setKindOf(meta.id) === 'elo' ? { ...tennis, rosters, territory, ...identity }
      : setKindOf(meta.id) === 'wta' ? { ...womensTennis, rosters, territory, ...identity }
      : setKindOf(meta.id) === 'nhl' ? { ...hockey, rosters, clubs, territory, clubMap: meta.map, ...identity }
      : setKindOf(meta.id) === 'nrl' ? { ...rugbyLeague, clubs, clubMap: meta.map, ...identity }
      // A women's season's unlisted nations are inactive, so nothing reads their strength in play.
      : setKindOf(meta.id) === 'eaw' ? { ...womensFootball, rosters, clubs, territory, fallbackStrength: () => EMPTY_STRENGTH, ...identity }
      // Every other football season, a computed World Cup one ('wc') too, whose unlisted nations field no team.
      : { ...football, rosters, clubs, territory,
        // Every nation has an entry (validated), so this only guards the rule that no other season borrows it.
        fallbackStrength: () => EMPTY_STRENGTH, ...identity };
    // A season of another era plays the federations of its day under their own names, codes and flags (the Soviet
    // Union on Russia's shape), as Great Britain plays on England's: teams.js nationIdentity reads `playsAs`.
    if (meta.identities && sport.id === 'football') sport = { ...sport, playsAs: { ...sport.playsAs, ...meta.identities } };
    sports.set(set, sport);
  }
  return sport;
}

/**
 * The sport a setup or saved campaign's settings play with: the data set's once it has loaded (null until then),
 * else the built-in sport. A set plays only in its own sport, a basketball season only with clubs, and a season with
 * nations only never with clubs.
 */
export function sportOf(config) {
  const sport = getSport(config?.sport);
  const id = config?.dataSet;
  if (id == null || setSportOf(id) !== sport.id || (!setHasNations(id) && config.layer !== 'clubs')
    || (config.layer === 'clubs' && !setHasClubs(id))) return sport;
  const loaded = getLoadedFootballSet(id);
  return loaded ? seasonSport(loaded) : null;
}

const fieldedCache = new WeakMap();
/**
 * Nations fielding a team in the sport's season (a sport object): a data set leaves out shapes merged into another
 * federation or with none, and only a nation with a real side plays (teams.js `fieldsRealSide`: its own rated players
 * hold at least half its lineup), so no team is made up or nearly empty. Every other nation's land stays neutral.
 * Frozen and cached per sport object.
 */
export function fieldedNations(sport) {
  const cacheable = !!sport && typeof sport === 'object';
  if (cacheable && fieldedCache.has(sport)) return fieldedCache.get(sport);
  const { merged, inactive } = sport?.territory || NO_TERRITORY;
  const fielded = Object.freeze(Object.keys(NATIONS)
    .filter(id => !Object.hasOwn(merged, id) && !inactive.includes(id) && fieldsRealSide(id, sport)));
  if (cacheable) fieldedCache.set(sport, fielded);
  return fielded;
}

/** Shapes that start in another nation's empire, as [shape, holder]: overseas dependencies, then a set's merged federations. */
export function heldShapes(sport) {
  return [...Object.entries(DEPENDENCIES).map(([shape, dep]) => [shape, dep.of]),
    ...Object.entries((sport?.territory || NO_TERRITORY).merged)];
}
