// Domestic campaigns: one country's top clubs on that country's own map, or a
// sport's own map (the NBA's USA and Canada). Loads a shipped
// `public/domestic/<id>.json` (format 1 or 2, see docs/design/domestic-campaigns.md),
// validates it, and turns it into section geometry plus buildClub source rows.

import { WorldGeometry } from './geo.js';
import { expandFmTuple, FM_ROLES } from '../data/fmPlayers.js';
import { SPORTS } from '../sports/index.js';

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

function trimCache() {
  let spare = DOMESTIC_CACHE_LIMIT;
  for (const [key, entry] of [...cache].reverse()) {
    if (!entry.value || retained.has(key)) continue;
    if (spare > 0) spare--;
    else cache.delete(key);
  }
}

/** Forget loaded countries (tests, or a forced reload after a failed one). */
export function clearDomesticCache(id) {
  if (id == null) cache.clear();
  else cache.delete(String(id));
}

/**
 * Keep exactly these countries loaded however many others are browsed (null
 * and undefined ids are ignored); every other decoded country is evicted
 * least recently used first beyond DOMESTIC_CACHE_LIMIT. Replaces the previous set.
 */
export function retainDomestic(ids = []) {
  retained = new Set([...ids].filter(id => id != null).map(String));
  trimCache();
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

/**
 * Fetch, validate and decode one country. Resolves to `{ meta, geo, clubs,
 * sectionNames, focus, startOwners }` (see decodeDomestic); concurrent and
 * repeated calls share one request per id, and a failed load is not cached. The
 * cache is bounded (see retainDomestic), so an unretained country may load again later.
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
    const url = `${baseUrl}domestic/${key}.json`;
    let res;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      throw new Error(`Domestic map ${key} failed to load: ${(e && e.message) || e}`);
    }
    if (!res || !res.ok) throw new Error(`Domestic map ${key} failed to load (HTTP ${res?.status ?? '?'})`);
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`Domestic map ${key} is not valid JSON: ${(e && e.message) || e}`);
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
      homeSection: club.section,
      startSections: Object.freeze(meta.format === 1 ? [club.section] : [...club.sections]),
      homePoint: club.home || null,
      squad: builtIn ? club.squad : club.squad.map(tuple => expandFmTuple(tuple, meta.source, club.name)),
    };
  });
  const startOwners = Object.freeze(Object.fromEntries(clubs.flatMap(club => club.startSections.map(s => [s, club.id]))));
  return { meta, geo, clubs, sectionNames, focus: meta.focus, startOwners };
}

/** The game's clubs by id for a sport's own map (`sport` set), else null: a country map carries its own clubs. */
function builtInClubs(data) {
  return data.sport == null ? null : new Map(SPORTS[data.sport].clubs.map(club => [club.id, club]));
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
  if (data.sport != null && !SPORTS[data.sport]?.clubs) fail(`unknown sport ${JSON.stringify(data.sport)}`);
  // A sport's own map (the NBA's) lists the game's clubs of that sport; a country map carries its FM clubs.
  const builtIn = builtInClubs(data);
  const src = data.source;
  if (!builtIn && (!isObject(src) || !text(src.version) || !text(src.snapshotDate))) fail('source must name the FM data version and snapshotDate');

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
    } else {
      if (!Number.isInteger(club.fm) || club.fm < 0) fail(`${at} fm must be the FM club id`);
      if (club.id !== `d${id}-${club.fm}`) fail(`${at} id must be "d${id}-${club.fm}"`);
    }
    if (clubIds.has(club.id)) fail(`${at} id is duplicated`);
    clubIds.add(club.id);
    if (!text(club.col)) fail(`${at} has no colour`);
    if (!builtIn) {
      if (!text(club.name)) fail(`${at} has no name`);
      if (club.short != null && !text(club.short)) fail(`${at} short name is empty`);
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
    // A sport's own map takes squads from the game's clubs.
    if (builtIn) return;
    if (!Array.isArray(club.squad) || club.squad.length < 11) fail(`${at} squad needs at least 11 players`);
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
 * (England keeps its own shape beneath it). `obstacles` is the same land minus the
 * host shape, ready for board.obstacles: never territory, it blocks routes as
 * neutral land would. Repeated calls for one map and fit return the same
 * objects, so route indexes built from them stay cached.
 */
export function domesticSurroundings(atlas, domestic, margin = { x: 480, y: 800 }) {
  const { meta, geo } = domestic || {};
  if (!atlas || !meta || !geo?.fit) return { shapes: [], obstacles: [] };
  const { s, tx, ty } = geo.fit;
  const key = [s, tx, ty, margin.x, margin.y].join('|');
  const hit = surroundings.get(domestic);
  if (hit?.atlas === atlas && hit.key === key) return hit.value;
  const world = new WorldGeometry(atlas, {}, { projection: meta.projection });
  const paths = world.buildPaths(s, tx, ty);
  // Ring by ring: a shape split at the far-side seam (Russia, the US) spans the
  // whole plane, but only its nearby rings can ever be on screen or on a route.
  const near = ring => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x0 < 960 + margin.x && x1 > -margin.x && y0 < 540 + margin.y && y1 > -margin.y;
  };
  // A sport's own map names the world shapes it covers (the NBA's: the USA and Canada).
  const hosts = new Set(meta.hosts || [meta.id]);
  const shapes = world.countries.flatMap(country => {
    if (hosts.has(country.id) && !meta.boundaries?.mask) return [];
    const rings = (paths[country.id]?.labelRings || []).filter(near);
    return rings.length ? [{ id: country.id, d: rings.map(ring => 'M' + ring.map(point => point.join(',')).join('L') + 'Z').join(''), rings }] : [];
  });
  // The masked host shape covers its own sections; overlaps elsewhere are
  // harmless (sections take precedence over obstacles in routing).
  const value = Object.freeze({ shapes, obstacles: shapes.filter(shape => !hosts.has(shape.id)) });
  surroundings.set(domestic, { atlas, key, value });
  return value;
}
