// Domestic campaigns: one country's top clubs on that country's own map, or a
// sport's own map (the NBA's USA and Canada). Loads a shipped
// `public/domestic/<id>.json` (format 1 or 2, see docs/design/domestic-campaigns.md),
// validates it, and turns it into section geometry plus buildClub source rows.

import { WorldGeometry, arcBorders, topologyArcs } from './geo.js';
import { createLand, touchingLand } from './claims.js';
import { mapLands } from './lands.js';
import { mapFileId, parseSplitId, splitDomestic } from './clubSplit.js';
import { expandSetPlayer } from './footballSets.js';
import { rememberTwins } from '../data/crests.js';
import { expandFmTuple, FM_ROLES } from '../data/fmPlayers.js';
import { NATIONS } from '../data/teams.js';
import { SPORTS } from '../sports/index.js';
import { loadSportData, sportDataLoaded } from '../sports/sportData.js';

export const DOMESTIC_PREFIX = 'domestic:';
// The format the build writes. Format 1 (one section per club) still loads, so
// files from an earlier build keep working.
export const DOMESTIC_FORMAT = 2;
export const DOMESTIC_FORMATS = Object.freeze([1, 2]);
// A format-2 map always has this many sections; each club starts on a group of them.
export const DOMESTIC_SECTIONS = 100;

export const isDomesticScope = scope => typeof scope === 'string' && scope.length > DOMESTIC_PREFIX.length
  && scope.startsWith(DOMESTIC_PREFIX);
export const domesticScopeId = scope => isDomesticScope(scope) ? scope.slice(DOMESTIC_PREFIX.length) : null;
export const domesticScope = id => DOMESTIC_PREFIX + id;

const ID_PATTERN = /^[0-9A-Za-z]+$/;
// A decoded country holds several MB of geometry. Keep the retained ones (the
// map on screen, the campaign being played, a pending restore) plus this many
// recently used others, so browsing theatres cannot pile them up.
export const DOMESTIC_CACHE_LIMIT = 2;
// Map order is recency: least recently used first. In-flight loads are always
// kept, so concurrent and repeated calls still share one request.
const cache = new Map();
let retained = new Set();

function touch(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
}

function trimCache(spare = DOMESTIC_CACHE_LIMIT) {
  for (const [key, entry] of [...cache].reverse()) {
    if (!entry.value || retained.has(key)) continue;
    if (spare > 0) spare--;
    else cache.delete(key);
  }
}

/** Forget loaded countries (tests, or a forced reload after a failed one), and their fetched files. */
export function clearDomesticCache(id) {
  if (id == null) {
    cache.clear();
    files.clear();
  } else {
    cache.delete(String(id));
    files.delete(mapFileId(String(id)));
  }
}

/**
 * Keep exactly these countries loaded however many others are browsed (null
 * and undefined ids are ignored); every other decoded country is evicted
 * least recently used first beyond `spare` of them. Replaces the previous set.
 * `spare` holds for this trim only: later loads keep DOMESTIC_CACHE_LIMIT again,
 * so a load that completes before its caller retains it is never evicted.
 */
export function retainDomestic(ids = [], spare = DOMESTIC_CACHE_LIMIT) {
  retained = new Set([...ids].filter(id => id != null).map(String));
  trimCache(spare);
  trimFiles(spare);
}

/**
 * The fetched files go with the decoded maps: a one-shot trim to none spare (a campaign taking over) keeps none, as its
 * map is decoded already; browsing keeps the retained maps' files and `spare` others, so a country cut to another
 * number of clubs is worked out without fetching its file again.
 */
function trimFiles(spare) {
  if (spare <= 0) {
    files.clear();
    return;
  }
  const keep = new Set([...retained].map(mapFileId));
  for (const key of [...files.keys()].reverse()) {
    if (keep.has(key)) continue;
    if (spare > 0) spare--;
    else files.delete(key);
  }
}

/** Decoded country ids in the cache, least recently used first (diagnostics and tests). */
export function loadedDomesticIds() {
  return [...cache].filter(([, entry]) => entry.value).map(([key]) => key);
}

/** The already-loaded country, or null; for synchronous render paths after loadDomestic resolved. */
export function getLoadedDomestic(id) {
  const key = String(id), entry = cache.get(key);
  if (!entry?.value) return null;
  touch(key, entry);
  return entry.value;
}

// The parsed files of the last few maps fetched, by file id: a country map cut to fewer clubs (engine/clubSplit.js) is
// worked out from its full map's file, so trying several counts fetches and parses that file once.
const FILE_CACHE_LIMIT = 3;
const files = new Map();

/** A map file's parsed JSON (shared by concurrent calls; a failed fetch is not kept). `key` names the map asked for. */
function mapFile(fileId, key, baseUrl, fetchImpl) {
  const hit = files.get(fileId);
  if (hit) {
    files.delete(fileId);
    files.set(fileId, hit);
    return hit;
  }
  const promise = (async () => {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}domestic/${fileId}.json`);
    } catch (e) {
      throw new Error(`Domestic map ${key} failed to load: ${(e && e.message) || e}`);
    }
    if (!res || !res.ok) throw new Error(`Domestic map ${key} failed to load (HTTP ${res?.status ?? '?'})`);
    try {
      return await res.json();
    } catch (e) {
      throw new Error(`Domestic map ${key} is not valid JSON: ${(e && e.message) || e}`);
    }
  })();
  promise.catch(() => { if (files.get(fileId) === promise) files.delete(fileId); });
  files.set(fileId, promise);
  while (files.size > FILE_CACHE_LIMIT) files.delete(files.keys().next().value);
  return promise;
}

/**
 * Fetch, validate and decode one country. Resolves to `{ meta, geo, clubs,
 * sectionNames, focus, startOwners }` (see decodeDomestic); concurrent and
 * repeated calls share one request per id, and a failed load is not cached. The
 * cache is bounded (see retainDomestic), so an unretained country may load again later.
 * A country map cut to fewer clubs ('724c20', engine/clubSplit.js) loads its full map's file and is cut here.
 */
export function loadDomestic(id, { baseUrl = '/', fetch: fetchImpl = globalThis.fetch } = {}) {
  const key = String(id);
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return hit.promise;
  }
  const entry = {};
  entry.promise = (async () => {
    if (!ID_PATTERN.test(key)) throw new Error(`Unknown domestic country id "${key}"`);
    if (typeof fetchImpl !== 'function') throw new Error('No fetch available to load domestic maps');
    const split = parseSplitId(key);
    const file = await mapFile(split ? split.base : key, key, baseUrl, fetchImpl);
    let data = file;
    if (split) {
      // The full map first, so a broken file says what is wrong with it; only a country's map is cut.
      validateDomestic(file, split.base);
      if (file.format !== 2 || file.sport != null || file.theatre != null || file.countries != null) {
        throw new Error(`Domestic map ${key}: ${split.base} is not a country map, so it cannot be cut to ${split.clubs} clubs`);
      }
      data = splitDomestic(file, split.clubs, key);
    }
    // A sport's own map is checked against that sport's clubs, so their players load first. Only a loaded sport's maps
    // are asked for (src/sports/sportData.js): in play this waits for nothing.
    const sport = data?.sport;
    if (sport != null && Object.hasOwn(SPORTS, sport) && !sportDataLoaded(sport)) {
      try {
        await loadSportData(sport);
      } catch (e) {
        throw new Error(`Domestic map ${key} could not be checked: the ${SPORTS[sport].name} players failed to load (${(e && e.message) || e})`);
      }
    }
    entry.value = decodeDomestic(data, key);
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

/**
 * Validate a parsed format-1 or format-2 file and build its geometry and club
 * rows (no caching). Club rows have the buildClub shape plus `country`,
 * `homeSection` (the section holding or nearest the home town), `startSections`
 * (frozen, home first; format 1: `[homeSection]`), `homePoint`, `fm` and `rep`.
 * `startOwners` is the frozen kickoff ownership, section id -> club id for
 * every section (copy it before mutating).
 */
export function decodeDomestic(data, id = data?.id) {
  validateDomestic(data, String(id));
  const { topology, clubs: rawClubs, ...meta } = data;
  const geometries = topology.objects.sections.geometries;
  const sectionNames = Object.fromEntries(geometries.map(g => [g.id, g.properties.name]));
  const anchors = {};
  for (const club of rawClubs) if (club.home) anchors[club.section] = club.home;
  const geo = new WorldGeometry(topology, anchors, { object: 'sections', projection: meta.projection });
  validateExtent(geo, meta, String(id));
  geo.fitTo(geometries.map(g => g.id));
  for (const g of geometries) {
    const p = geo.paths[g.id];
    if (!p?.labelRings.length || !(geo.surfaceOf(g.id).area > 0) || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) {
      throw new Error(`Domestic map ${id}: section ${g.id} has no drawable land`);
    }
  }
  const builtIn = builtInClubs(data);
  const clubs = rawClubs.map(raw => {
    // A sport's own map gives the game's club its land and colour; name, squad and strength stay the club's.
    const club = builtIn ? { ...builtIn.get(raw.id), ...raw } : raw;
    return {
      id: club.id,
      name: club.name,
      short: club.short || club.name,
      code: club.code,
      league: club.league,
      country: meta.id,
      col: club.col,
      str: club.str,
      rep: club.rep ?? null,
      fm: club.fm,
      // An earlier season's club that today's map of its country also has: its id there (its crest's, when it has none of its own).
      twin: club.twin ?? null,
      homeSection: club.section,
      startSections: Object.freeze(meta.format === 1 ? [club.section] : [...club.sections]),
      homePoint: club.home || null,
      // An era map's squads come from its season when a campaign starts; an earlier season's country map carries the
      // season's own players.
      squad: builtIn ? club.squad : meta.seasons ? [] : seasonCountry(meta)
        ? club.squad.map(tuple => expandSetPlayer(tuple, meta.source, meta.kind)) : club.squad.map(tuple => expandFmTuple(tuple, meta.source, club.name)),
    };
  });
  const startOwners = Object.freeze(Object.fromEntries(clubs.flatMap(club => club.startSections.map(s => [s, club.id]))));
  // An earlier season's club with no crest of its own wears its twin's (src/data/crests.js).
  if (seasonCountry(meta)) rememberTwins(clubs);
  // Land no club starts on (topology.objects.empty), never territory: drawn (see domesticSurroundings) and claimed
  // (domesticLand), with its neighbours among the sections and itself.
  const empty = topology.objects.empty?.geometries.length
    ? new WorldGeometry(topology, {}, { object: 'empty', projection: meta.projection, keepPolys: false }) : null;
  return { meta, geo, clubs, sectionNames, focus: meta.focus, startOwners, empty, emptyBorders: empty ? emptyBorders(topology) : null };
}

const LANDS = new WeakMap(); // decoded map → { paths, lands }
/**
 * What a decoded map draws (engine/lands.js): each club's starting group as one land, named by its home section, and a
 * section no club starts on alone, on the map's fitted paths. The setup card, the campaign map, its borders, Flags mode
 * and the share image all draw these, so no line runs between a club's own sections. Kept per map and paths.
 */
export function domesticLands(domestic) {
  const paths = domestic?.geo?.paths;
  if (!paths || !domestic.sectionNames) return [];
  const hit = LANDS.get(domestic);
  if (hit?.paths === paths) return hit.lands;
  const lands = mapLands(Object.keys(domestic.sectionNames), paths,
    (domestic.clubs || []).map(club => club.startSections || [club.homeSection]));
  LANDS.set(domestic, { paths, lands });
  return lands;
}

/**
 * Each empty-land shape's borders, with sections and other empty land alike, and its open edge: one topology holds
 * both, so a shared border is a shared arc and an arc of its own is coast or the edge of the map's land.
 * → { borders: { emptyId: Map(id → length) }, edges: { emptyId: length } } (geo.js arcBorders).
 */
function emptyBorders(topology) {
  const owners = {};
  for (const name of ['sections', 'empty']) {
    for (const g of topology.objects[name]?.geometries || []) {
      for (const polygon of g.type === 'Polygon' ? [g.arcs] : g.arcs) {
        for (const ring of polygon) {
          for (const i of ring) (owners[i < 0 ? ~i : i] ||= []).push(String(g.id));
        }
      }
    }
  }
  const { borders, edges } = arcBorders(topologyArcs(topology), owners);
  const ids = topology.objects.empty.geometries.map(g => String(g.id));
  return { borders: Object.fromEntries(ids.map(id => [id, borders[id] || new Map()])),
    edges: Object.fromEntries(ids.map(id => [id, edges[id] || 0])) };
}

/**
 * Whether a map is one country's in an earlier football season (`season`: the season file's id, `kind`: its players'):
 * its clubs are that season's, each with the season's own players (src/engine/footballSets.js expandSetPlayer), as
 * scripts/build-season-countries.mjs writes them. Today's country maps carry FM 26's players instead.
 */
export const seasonCountry = data => data?.season != null && data?.sport == null;
// The football kinds whose players a season's country map may carry.
const SEASON_COUNTRY_KINDS = new Set(['ea', 'cm', 'cm0102', 'swos']);
// The season builders' `f-<slug>` club ids (src/engine/footballSets.js).
const SEASON_CLUB_ID = /^f-[a-z0-9-]{1,62}$/;

/**
 * The game's clubs by id for a sport's own map (`sport` set), else null: a country map carries its own clubs, and an
 * era's map (`seasons`) its season's.
 */
function builtInClubs(data) {
  return data.sport == null || data.seasons != null ? null : new Map(SPORTS[data.sport].clubs.map(club => [club.id, club]));
}

function validateDomestic(data, id) {
  const where = `Domestic map ${id}`;
  const fail = message => { throw new Error(`${where}: ${message}`); };
  const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const finite = v => typeof v === 'number' && Number.isFinite(v);

  if (!ID_PATTERN.test(id)) fail('country id must be alphanumeric');
  if (!isObject(data)) fail('file is not a JSON object');
  if (!DOMESTIC_FORMATS.includes(data.format)) {
    fail(`unsupported format ${JSON.stringify(data.format)} (expected ${DOMESTIC_FORMATS.join(' or ')})`);
  }
  // Format 2: exactly DOMESTIC_SECTIONS sections, each club starting on a group of them.
  const grouped = data.format !== 1;
  if (data.id !== id) fail(`file id ${JSON.stringify(data.id)} does not match the requested country`);
  if (!text(data.name)) fail('name is missing');
  if (typeof data.version !== 'string' || !new RegExp(`^${id}-[0-9a-f]{8}$`).test(data.version)) {
    fail(`version ${JSON.stringify(data.version)} must look like "${id}-<8 hex>"`);
  }
  const p = data.projection;
  if (!isObject(p) || !finite(p.lon0) || !finite(p.lat0) || Math.abs(p.lon0) > 360 || Math.abs(p.lat0) > 85) {
    fail('projection must be { lon0, lat0 } with finite degrees (|lat0| <= 85)');
  }
  const f = data.focus;
  if (!Array.isArray(f) || f.length !== 4 || !f.every(finite) || !(f[2] > f[0]) || !(f[3] > f[1])) {
    fail('focus must be [west, south, east, north] with east > west and north > south');
  }
  if (!isObject(data.boundaries)) fail('boundaries attribution is missing');
  if (data.hosts != null && (!Array.isArray(data.hosts) || !data.hosts.length || !data.hosts.every(text))) fail('hosts must list world shape ids');
  // A host the map holds only part of (European Russia on a map of Europe) lies beneath it too: grey where no club holds it.
  if (data.partial != null && (!Array.isArray(data.partial) || !data.partial.length || !data.partial.every(id => data.hosts?.includes(id)))) {
    fail('partial must list some of its hosts');
  }
  if (data.sport != null && !SPORTS[data.sport]?.clubs) fail(`unknown sport ${JSON.stringify(data.sport)}`);
  // A map cut to fewer clubs (engine/clubSplit.js) names the country map it is cut from; its clubs keep their ids there.
  const split = parseSplitId(id);
  if (split ? data.base !== split.base || !Array.isArray(data.clubs) || data.clubs.length !== split.clubs : data.base != null) {
    fail(split ? `must be ${split.base}'s map cut to ${split.clubs} clubs` : 'base is only for a map cut to fewer clubs');
  }
  const clubPrefix = split ? split.base : id;
  // A sport's own map (the NBA's) lists the game's clubs of that sport; a country map carries its FM clubs. An earlier
  // era's map of a sport (`seasons`) names its own clubs, whose squads come from those built-in seasons at kickoff.
  const seasonal = data.seasons != null;
  if (seasonal && (data.sport == null || !Array.isArray(data.seasons) || !data.seasons.length || !data.seasons.every(text))) {
    fail('seasons must list the built-in seasons the map serves');
  }
  const builtIn = builtInClubs(data);
  const src = data.source;
  // An earlier season's country map: its country, the season it belongs to, its players' kind and the season's source.
  const ofSeason = seasonCountry(data);
  if (ofSeason) {
    if (!text(data.season)) fail('season must name the season the map belongs to');
    if (!SEASON_COUNTRY_KINDS.has(data.kind)) fail(`kind ${JSON.stringify(data.kind)} is not a football season's players`);
    if (!text(data.country) || !NATIONS[data.country]) fail(`country ${JSON.stringify(data.country)} is not a game nation`);
    if (!Number.isInteger(data.year)) fail('year must be the season\'s year');
    if (!isObject(src) || !text(src.edition) || !text(src.snapshotDate)) fail('source must name the season\'s edition and snapshotDate');
  } else if (!builtIn && !seasonal && (!isObject(src) || !text(src.version) || !text(src.snapshotDate))) fail('source must name the FM data version and snapshotDate');

  const t = data.topology;
  if (!isObject(t) || t.type !== 'Topology' || !Array.isArray(t.arcs)) fail('topology is not a TopoJSON Topology');
  const tr = t.transform;
  if (!isObject(tr) || !Array.isArray(tr.scale) || !Array.isArray(tr.translate)
    || ![...tr.scale, ...tr.translate].every(finite) || tr.scale.length !== 2 || tr.translate.length !== 2) {
    fail('topology must be quantized (transform.scale and transform.translate)');
  }
  const sections = t.objects?.sections;
  if (!isObject(sections) || sections.type !== 'GeometryCollection' || !Array.isArray(sections.geometries)) {
    fail('topology.objects.sections must be a GeometryCollection');
  }
  // Quantized arcs are integer deltas; anything else decodes to NaN or nothing.
  t.arcs.forEach((arc, i) => {
    if (!Array.isArray(arc) || arc.length < 2 || !arc.every(q => Array.isArray(q) && Number.isInteger(q[0]) && Number.isInteger(q[1]))) {
      fail(`arc ${i} must be two or more integer positions`);
    }
  });
  const ringOk = ring => Array.isArray(ring) && ring.length > 0
    && ring.every(a => Number.isInteger(a) && (a < 0 ? ~a : a) < t.arcs.length);
  const count = sections.geometries.length;
  if (grouped && count !== DOMESTIC_SECTIONS) fail(`format ${data.format} needs exactly ${DOMESTIC_SECTIONS} sections, found ${count}`);
  const sectionPattern = new RegExp(`^${id}-\\d{3}$`);
  const lastId = `${id}-${String(count).padStart(3, '0')}`;
  const sectionIds = new Set();
  sections.geometries.forEach((g, i) => {
    const at = `section ${i} (${JSON.stringify(g?.id)})`;
    if (!isObject(g) || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.arcs) || !g.arcs.length) {
      fail(`${at} must be a non-empty Polygon or MultiPolygon`);
    }
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    if (!polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ringOk))) {
      fail(`${at} has an empty ring or an arc index outside the topology`);
    }
    if (typeof g.id !== 'string' || !sectionPattern.test(g.id)) fail(`${at} id must look like "${id}-001"`);
    // Unique ids numbered 1..count are exactly <id>-001 .. the last.
    const rank = Number(g.id.slice(-3));
    if (rank < 1 || rank > count) fail(`${at} id must be in ${id}-001..${lastId}`);
    if (sectionIds.has(g.id)) fail(`${at} id is duplicated`);
    if (!text(g.properties?.name)) fail(`${at} has no name`);
    sectionIds.add(g.id);
  });
  if (!sectionIds.size) fail('topology has no sections');
  // Optional land nobody starts on (the NBA map's empty states): drawn beneath, never territory.
  const empty = t.objects.empty;
  if (empty != null) {
    if (!isObject(empty) || empty.type !== 'GeometryCollection' || !Array.isArray(empty.geometries)) {
      fail('topology.objects.empty must be a GeometryCollection');
    }
    const emptyIds = new Set();
    empty.geometries.forEach((g, i) => {
      const at = `empty land ${i} (${JSON.stringify(g?.id)})`;
      if (!isObject(g) || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.arcs) || !g.arcs.length) {
        fail(`${at} must be a non-empty Polygon or MultiPolygon`);
      }
      const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs;
      if (!polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ringOk))) {
        fail(`${at} has an empty ring or an arc index outside the topology`);
      }
      if (!text(g.id) || sectionIds.has(g.id) || emptyIds.has(g.id)) fail(`${at} needs an id of its own`);
      if (!text(g.properties?.name)) fail(`${at} has no name`);
      emptyIds.add(g.id);
    });
  }

  const clubs = data.clubs;
  if (!Array.isArray(clubs) || (grouped ? clubs.length > sectionIds.size : clubs.length !== sectionIds.size)) {
    fail(`expected ${grouped ? 'at most ' : ''}one club per section (${sectionIds.size}), found ${Array.isArray(clubs) ? clubs.length : 'none'}`);
  }
  if (clubs.length < 2) fail(`a campaign needs at least two clubs, found ${clubs.length}`);
  // Section id -> index of the club starting on it.
  const clubIds = new Set(), codes = new Set(), claimed = new Map();
  clubs.forEach((club, i) => {
    const at = `clubs[${i}] (${JSON.stringify(club?.name ?? club?.id)})`;
    if (!isObject(club)) fail(`${at} is not an object`);
    if (builtIn) {
      if (!builtIn.has(club.id)) fail(`${at} is not one of the game's ${data.sport} clubs`);
    } else if (seasonal) {
      if (typeof club.id !== 'string' || !/^[a-z]{1,3}-[a-z0-9-]{1,62}$/.test(club.id)) fail(`${at} id must look like "b-<name>" or "mlb-<name>"`);
    } else if (ofSeason) {
      if (typeof club.id !== 'string' || !SEASON_CLUB_ID.test(club.id)) fail(`${at} id must look like "f-<name>"`);
      if (club.twin != null && (typeof club.twin !== 'string' || !/^d[0-9A-Z]{3}-\d{1,15}$/.test(club.twin))) fail(`${at} twin must be a country map's club id`);
    } else {
      if (!Number.isInteger(club.fm) || club.fm < 0) fail(`${at} fm must be the FM club id`);
      if (club.id !== `d${clubPrefix}-${club.fm}`) fail(`${at} id must be "d${clubPrefix}-${club.fm}"`);
    }
    if (clubIds.has(club.id)) fail(`${at} id is duplicated`);
    clubIds.add(club.id);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (!builtIn) {
      if (!text(club.name)) fail(`${at} has no name`);
      if (club.short != null && !text(club.short)) fail(`${at} short name is empty`);
    }
    // A season gives an era map's clubs their codes and strengths.
    if (!builtIn && !seasonal) {
      if (typeof club.code !== 'string' || !/^[A-Z0-9]{3}$/.test(club.code)) fail(`${at} code ${JSON.stringify(club.code)} must be three capitals`);
      if (codes.has(club.code)) fail(`${at} code ${club.code} is duplicated`);
      codes.add(club.code);
      if (!text(club.league)) fail(`${at} has no league`);
      if (!finite(club.str) || club.str < 1 || club.str > 99) fail(`${at} str must be a rating 1-99`);
      if (club.rep != null && !finite(club.rep)) fail(`${at} rep must be a number`);
    }
    if (!sectionIds.has(club.section)) fail(`${at} section ${JSON.stringify(club.section)} is not in the topology`);
    const starts = grouped ? club.sections : [club.section];
    if (!Array.isArray(starts) || !starts.length) fail(`${at} sections must list its starting sections`);
    if (starts[0] !== club.section) fail(`${at} sections must start with its home section ${club.section}`);
    for (const s of starts) {
      if (!sectionIds.has(s)) fail(`${at} starting section ${JSON.stringify(s)} is not in the topology`);
      if (claimed.has(s)) {
        fail(claimed.get(s) === i ? `${at} lists section ${s} twice` : `${at} section ${s} already belongs to clubs[${claimed.get(s)}]`);
      }
      claimed.set(s, i);
    }
    if (club.home != null && (!Array.isArray(club.home) || club.home.length !== 2 || !club.home.every(finite)
      || Math.abs(club.home[1]) > 90)) fail(`${at} home must be [lon, lat] or null`);
    // A sport's own map takes squads from the game's clubs, an era's map from its season.
    if (builtIn || seasonal) return;
    if (!Array.isArray(club.squad) || club.squad.length < 11) fail(`${at} squad needs at least 11 players`);
    // An earlier season's players are its own tuples, each rebuilt as the season file's are.
    if (ofSeason) {
      const players = new Set();
      let keeper = false;
      club.squad.forEach((tuple, j) => {
        if (!Array.isArray(tuple)) fail(`${at} squad[${j}] is not a player tuple`);
        if (players.has(tuple[0])) fail(`${at} squad[${j}] repeats player ${tuple[0]}`);
        players.add(tuple[0]);
        let player;
        try {
          player = expandSetPlayer(tuple, src, data.kind);
        } catch (e) {
          fail(`${at} squad[${j}]: ${e.message}`);
        }
        if (player[3]?.positions?.includes('GK')) keeper = true;
      });
      if (!keeper) fail(`${at} squad has no natural goalkeeper`);
      return;
    }
    const players = new Set();
    let keeper = false;
    club.squad.forEach((tuple, j) => {
      if (!Array.isArray(tuple)) fail(`${at} squad[${j}] is not a player tuple`);
      const [fmId, , currentAbility, positions] = tuple;
      if (players.has(fmId)) fail(`${at} squad[${j}] repeats player ${fmId}`);
      players.add(fmId);
      if (!finite(currentAbility) || currentAbility < 1 || currentAbility > 100) {
        fail(`${at} squad[${j}] current ability ${JSON.stringify(currentAbility)} must be 1-100`);
      }
      const keys = String(positions || '').split(',');
      // Own keys only: 'constructor' or 'toString' must not pass as positions.
      if (!keys.every(k => Object.hasOwn(FM_ROLES, k))) fail(`${at} squad[${j}] has unknown positions ${JSON.stringify(positions)}`);
      if (keys.includes('gk')) keeper = true;
      try {
        expandFmTuple(tuple, src, club.name);
      } catch (e) {
        fail(`${at} squad[${j}]: ${e.message}`);
      }
    });
    if (!keeper) fail(`${at} squad has no natural goalkeeper`);
  });
  // Every section has an owner at kickoff: there is no neutral land.
  const free = [...sectionIds].filter(s => !claimed.has(s));
  if (free.length) fail(`no club starts on section ${free[0]}${free.length > 1 ? ` (and ${free.length - 1} more)` : ''}`);
}

const wrapLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;

/**
 * The central meridian and parallel must sit on the country, its sections must
 * stay clear of the far-side seam (where rings would be cut), and the opening
 * focus must frame the land: a file built for another country fails here.
 */
function validateExtent(geo, meta, id) {
  const { lon0, lat0 } = meta.projection;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const c of geo.countries) for (const poly of c.polys) for (const ring of poly) for (const [lon, lat] of ring) {
    const x = wrapLongitude(lon - lon0);
    west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const fail = message => { throw new Error(`Domestic map ${id}: ${message}`); };
  if (!(east >= west) || west < -179 || east > 179) fail(`sections reach the far side of central meridian ${lon0}`);
  const mx = 1 + (east - west) / 10, my = 1 + (north - south) / 10;
  if (west - mx > 0 || east + mx < 0 || lat0 < south - my || lat0 > north + my) fail('projection centre is not on the sections');
  const [fw, fs, fe, fn] = meta.focus, x0 = wrapLongitude(fw - lon0), x1 = x0 + fe - fw;
  if (x0 < west - mx || x1 > east + mx || fs < south - my || fn > north + my) fail('focus does not frame the sections');
}

// Surroundings of a decoded country per fit: memory goes with the country.
const surroundings = new WeakMap();

/**
 * Neighbouring land beneath a decoded country map, in its projection and fit.
 * `atlas` is the world TopoJSON (countries-50m). Returns `{ shapes, obstacles }`:
 * `shapes` are `[{ id, d, rings }]` to draw (rings in fitted SVG units, rounded
 * like the painted sections, only those reaching within `margin` of the
 * 960×540 frame); the host's own world shape is drawn only for a masked map
 * (England keeps its own shape beneath it) and for a host the map holds only part
 * of (`partial`, European Russia). A map's empty land (the NBA's empty
 * states) comes first, drawn like its neighbours. `obstacles` is the world land minus the
 * host shape, ready for board.obstacles: never territory, it blocks routes as
 * neutral land would; a partial host is one too, beyond its sections. Empty land is no obstacle, like the host shape beneath
 * England: it lies inside the hosts. `partial` is the set of those hosts. Repeated calls for one map and fit return
 * the same objects, so route indexes built from them stay cached.
 */
export function domesticSurroundings(atlas, domestic, margin = { x: 480, y: 800 }) {
  const { meta, geo, empty } = domestic || {};
  if (!atlas || !meta || !geo?.fit) return { shapes: [], obstacles: [] };
  const { s, tx, ty } = geo.fit;
  const key = [s, tx, ty, margin.x, margin.y].join('|');
  const hit = surroundings.get(domestic);
  if (hit?.atlas === atlas && hit.key === key) return hit.value;
  // Only its rings and its land borders (adj) are read here: no border lengths.
  const world = new WorldGeometry(atlas, {}, { projection: meta.projection, borderLengths: false });
  const X0 = -margin.x, X1 = 960 + margin.x, Y0 = -margin.y, Y1 = 540 + margin.y;
  // Ring by ring: a shape split at the far-side seam (Russia, the US) spans the
  // whole plane, but only its nearby rings can ever be on screen or on a route.
  const near = ring => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x0 < X1 && x1 > X0 && y0 < Y1 && y1 > Y0;
  };
  // A shape's rings fitted and rounded exactly as buildPaths rounds its painted
  // labelRings (only these are drawn, so the rest of buildPaths is not needed).
  // A ring whose unrounded box is clearly outside is skipped before rounding:
  // rounding moves a point by at most 0.05. displayProjected is id-keyed like
  // paths, so an id the atlas repeats keeps its last shape.
  const nearRings = id => {
    const rings = [];
    for (const poly of world.displayProjected[id]) for (const parts of poly) for (const part of parts) {
      if (part.length < 3) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of part) {
        const x = q[0] * s + tx, y = q[1] * s + ty;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (!(x0 < X1 + 0.1 && x1 > X0 - 0.1 && y0 < Y1 + 0.1 && y1 > Y0 - 0.1)) continue;
      const ring = part.map(q => [Number((q[0] * s + tx).toFixed(1)), Number((q[1] * s + ty).toFixed(1))]);
      if (near(ring)) rings.push(ring);
    }
    return rings;
  };
  // A sport's own map names the world shapes it covers (the NBA's: the USA and Canada).
  const hosts = new Set(meta.hosts || [meta.id]);
  const shapesOf = (list, ringsOf) => list.flatMap(country => {
    const rings = ringsOf(country.id);
    return rings.length ? [{ id: country.id, d: rings.map(ring => 'M' + ring.map(point => point.join(',')).join('L') + 'Z').join(''), rings }] : [];
  });
  // The empty land is a few shapes: its full paths are cheap.
  const emptyPaths = empty ? empty.buildPaths(s, tx, ty) : null;
  const emptyShapes = empty ? shapesOf(empty.countries, id => (emptyPaths[id]?.labelRings || []).filter(near)) : [];
  // A host the map holds only part of (`partial`: European Russia's clubs on a map of Europe) is drawn beneath like a
  // neighbour, and the rest of it blocks routes as a neighbour does.
  const partial = new Set(meta.partial || []);
  const worldShapes = shapesOf(world.countries.filter(country => !hosts.has(country.id) || meta.boundaries?.mask || partial.has(country.id)), nearRings);
  // The masked host shape covers its own sections; overlaps elsewhere are
  // harmless (sections take precedence over obstacles in routing). `empty` and the
  // atlas's land borders (`atlasNeighbours`) are what domesticLand claims from.
  const value = Object.freeze({ shapes: [...emptyShapes, ...worldShapes], obstacles: worldShapes.filter(shape => !hosts.has(shape.id) || partial.has(shape.id)),
    empty: emptyShapes, atlasNeighbours: world.adj, partial });
  surroundings.set(domestic, { atlas, key, value });
  return value;
}

// Claimable land per surroundings (one map and fit), built once.
const lands = new WeakMap();

/**
 * The land a map's teams can claim without holding it (engine/claims.js), for `around`, its surroundings in the
 * current fit: a sport's own map's empty land (the NBA's states without a club), or on a Europe map (`meta.theatre`)
 * the European countries no club plays in, which lie beneath it as foreign land. A country map has none: every section
 * is held and its neighbours are other countries. → createLand(...) or null.
 */
export function domesticLand(domestic, around) {
  if (!domestic?.geo || !around) return null;
  if (lands.has(around)) return lands.get(around);
  let land = null;
  const pathsOf = shapes => Object.fromEntries(shapes.map(shape => [shape.id, { labelRings: shape.rings, d: shape.d }]));
  if (domestic.empty && domestic.emptyBorders) {
    const names = Object.fromEntries(domestic.empty.countries.map(country => [country.id, country.name]));
    const { borders, edges } = domestic.emptyBorders;
    land = createLand({ ids: Object.keys(borders), neighbours: id => borders[id], edge: id => edges[id],
      paths: pathsOf(around.empty || []), names: id => names[id] ?? null });
  } else if (domestic.meta?.theatre) {
    // A host the map holds only part of is never claimed: its clubs' land is on the map, and the rest of it is not Europe's.
    const shapes = (around.obstacles || []).filter(shape => NATIONS[shape.id]?.[2] === 'UEFA' && !around.partial?.has(shape.id));
    // The sections come from other boundaries than the atlas's countries, so each country's neighbours are found by
    // looking just outside its edges: sections first, then the atlas (the two overlap along every border). The atlas's
    // own land borders are exact: a short one the probes miss still joins its countries.
    const sections = domestic.geo.countries.map(section => ({ id: section.id, rings: domestic.geo.paths[section.id]?.labelRings || [] }));
    const touching = touchingLand(shapes, [...sections, ...around.obstacles]);
    const neighbours = id => {
      const found = new Map(touching.get(id)?.borders || []);
      for (const other of around.atlasNeighbours?.[id] || []) if (!found.has(other)) found.set(other, 0);
      return found;
    };
    land = createLand({ ids: shapes.map(shape => shape.id), neighbours, edge: id => touching.get(id)?.edge ?? 0,
      paths: pathsOf(shapes), names: id => NATIONS[id]?.[0] ?? null });
  }
  lands.set(around, land);
  return land;
}
