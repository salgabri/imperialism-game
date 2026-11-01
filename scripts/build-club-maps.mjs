// The maps a sport's clubs play on instead of the world (docs/design/domestic-campaigns.md,
// "The NBA map" and "The NFL map"): the NBA's USA and Canada, and the NFL's United States,
// each split into one territory per franchise, grown from its arena or stadium by the
// domestic partition (format 1: one section per club) over whole states and provinces.
// Only a state with two or more franchises is split, along its counties, between them
// (and a state a league joins to it, such as New York to New Jersey's for the NFL), and
// states and provinces far from every venue stay empty: land, but nobody's.
// The earlier basketball seasons (scripts/data/nba-seasons.json) play on maps of their
// own era, built the same way from that era's teams and arenas: Seattle, Vancouver and
// New Jersey where they played. Today's map is unchanged by them.
//
// Usage:
//   node scripts/build-club-maps.mjs [--league=nba|nfl] [--check | --dry-run]
//     --league   build one league's maps; the index keeps the other league's entries as they are
//     --check    rebuild offline from the caches and compare every output byte for byte
//     --dry-run  build and verify (downloading boundaries as needed) but write nothing
//
// Inputs:  geoBoundaries gbOpen USA and CAN ADM2 (counties, economic regions) grouped by
//          their ADM1 (states, provinces), cached under the gitignored
//          data-src/boundaries/; the game's world map
//          public/countries-50m.json (land it gives to other countries is cut); the
//          arenas in scripts/data/nba-arenas.json and the stadiums in scripts/data/nfl-teams.json;
//          the franchises in src/data/clubs.basketball.js and src/data/clubs.american-football.js;
//          each NBA era's teams and moved arenas in scripts/data/nba-seasons.json.
// Outputs: public/domestic/nba.json, one public/domestic/nba<year>.json per era and
//          public/domestic/nfl.json, an ATTRIBUTION-<id>.txt beside each, and src/data/clubMaps.js
//          (the setup screen's entries).
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import polygonClipping from 'polygon-clipping';
import { topology } from 'topojson-server';
import { feature, mergeArcs, neighbors } from 'topojson-client';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { createBoundarySource, cutForeignLand, GB_CITATION } from './lib/domestic-boundaries.mjs';
import { colourSections, contentHash, serialize } from './lib/domestic-output.mjs';
import { seasonIdOf, teamsOf } from './lib/nba-seasons.mjs';
import {
  arcPoints, bboxOf, centroidOf, components, dissolve, EARTH_KM, facingKm, facingSections, interiorPoint, joinRealms, kmBetween, kmToPolys,
  nodeRings, partitionCountry, pointInPolys, polysAreaKm2, polysOf, prepareUnits, quantize, sectionTopology, simplifyTopology, splitOnLand,
  unitTopology,
} from './lib/domestic-partition.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = id => path.join(root, `public/domestic/${id}.json`);
const attributionFile = id => path.join(root, `public/domestic/ATTRIBUTION-${id}.txt`);
const indexFile = path.join(root, 'src/data/clubMaps.js');
const arenasFile = path.join(root, 'scripts/data/nba-arenas.json');
const seasonsFile = path.join(root, 'scripts/data/nba-seasons.json');
const stadiumsFile = path.join(root, 'scripts/data/nfl-teams.json');
const cacheDir = path.join(root, 'data-src/boundaries');
const worldFile = path.join(root, 'public/countries-50m.json');

const USA = { id: '840', iso3: 'USA' }, CAN = { id: '124', iso3: 'CAN' };
/**
 * Each league's map: its id, sport, name and `countries` (the game's world shapes its units come from, never drawn
 * beneath it); `joins` lets a state's franchises also take the counties of the states listed (MetLife Stadium is in
 * New Jersey, but the Giants and Jets are New York's); `entry` adds fields to its index entry (the setup's words).
 */
const LEAGUES = {
  nba: { id: 'nba', sport: 'basketball', league: 'NBA', name: 'USA and Canada', countries: [USA, CAN], joins: {}, entry: {},
    venues: 'Arena locations: scripts/data/nba-arenas.json.' },
  nfl: { id: 'nfl', sport: 'american-football', league: 'NFL', name: 'USA', countries: [USA], joins: { 'US-NJ': ['US-NY'] },
    entry: { venue: 'stadium', lines: 'state' },
    venues: 'Stadium locations: scripts/data/nfl-teams.json (the four franchises that share a stadium grow from their training grounds).' },
};
// Territories take states and provinces (REGION_LEVEL) whole, built from their counties
// and economic regions (UNIT_LEVEL) so that both share every border vertex for vertex.
const UNIT_LEVEL = 'ADM2';
const REGION_LEVEL = 'ADM1';
// A state or province whose centre lies farther than this from every arena stays empty
// (Alaska, the North, the Prairies, Quebec): drawn as land beneath the map, never territory.
const EMPTY_KM = 1000;
// The two layers draw the 49th parallel and the Alaska border a little differently:
// units of the two countries this close count as neighbours, and Canadian edges this
// close to US land are fitted to the US line (fitBorder).
const JOIN_KM = 5;
const BORDER_KM = 3;
const MAX_BYTES = 250000;
const POINT_TARGET = 14000;

const fixed = (v, digits = 1) => Number(v.toFixed(digits));
const round = (v, step = 0.1) => Math.round(v / step) * step;

const geomPolys = (topo, g) => {
  const geometry = feature(topo, g).geometry;
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
};

function circularMeanLon(points) {
  let x = 0, y = 0;
  for (const [lon, weight] of points) { x += Math.cos(lon * Math.PI / 180) * weight; y += Math.sin(lon * Math.PI / 180) * weight; }
  return Math.atan2(y, x) * 180 / Math.PI;
}

const layerOf = (row, extra = {}) => {
  const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim() || undefined;
  return {
    iso3: row.boundaryISO, level: row.boundaryType, license: row.boundaryLicense, source: clean(row.boundarySource),
    year: clean(row.boundaryYearRepresented), boundaryId: row.boundaryID, url: row.simplifiedGeometryGeoJSON, ...extra,
  };
};

/**
 * A country's admin units as { id, name, polys, realm, region, regionName }, minus land
 * the world map gives to others; `region` is the ISO code of the state or province
 * holding the unit's interior point (else the nearest).
 */
async function countryUnits(source, { id, iso3 }, log) {
  const layers = await source.layers(iso3);
  const row = layers.find(r => r.boundaryType === UNIT_LEVEL);
  const regionRow = layers.find(r => r.boundaryType === REGION_LEVEL);
  if (!row || !regionRow) throw new Error(`No geoBoundaries ${iso3} ${row ? REGION_LEVEL : UNIT_LEVEL} layer`);
  const units = (await source.features(row))
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    // The Aleutians beyond the antimeridian would wrap the map round the globe.
    .map((f, i) => ({ id: `${iso3}-${i}`, name: f.properties.shapeName || `${iso3} ${i + 1}`, realm: id,
      polys: polysOf(f.geometry).filter(poly => poly[0].some(([lon]) => lon < 0)) }))
    .filter(u => u.polys.length);
  const { units: kept, cut } = cutForeignLand(id, units, await source.world(), log);
  if (cut.length) log(`  ${iso3}: cut land the world map gives to others: ${cut.map(c => `${c.shape} ${c.km2} km²`).join(', ')}`);
  const regions = (await source.features(regionRow))
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map(f => ({ id: f.properties.shapeISO || `${iso3}-${f.properties.shapeName}`, name: f.properties.shapeName, polys: polysOf(f.geometry) }))
    .map(r => ({ ...r, bbox: bboxOf(r.polys) }));
  const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;
  for (const u of kept) {
    const p = interiorPoint(u.polys);
    const region = regions.find(r => inBox(p, r.bbox) && pointInPolys(p, r.polys))
      ?? regions.reduce((best, r) => (!best || kmToPolys(p, r.polys) < kmToPolys(p, best.polys) ? r : best), null);
    u.region = region.id;
    u.regionName = region.name;
  }
  return {
    units: kept,
    layers: [
      layerOf(row, cut.length ? { foreign: cut.map(({ shape, km2 }) => ({ shape, km2 })) } : {}),
      layerOf(regionRow, { use: 'grouping' }),
    ],
  };
}

/**
 * Units merged into one `whole` unit per region (state, province), at the place of the
 * region's first unit, except in the regions of `split`, whose units stay as they are.
 * The merge runs on the units' shared arcs, so merged borders keep their vertices.
 */
function mergeRegions(units, split) {
  const topo = topology({ units: { type: 'FeatureCollection', features: units.map((u, i) => ({
    type: 'Feature', id: i, properties: {}, geometry: { type: 'MultiPolygon', coordinates: u.polys } })) } });
  const geoms = topo.objects.units.geometries;
  const members = new Map();
  units.forEach((u, i) => {
    if (split.has(u.region)) return;
    if (!members.has(u.region)) members.set(u.region, []);
    members.get(u.region).push(i);
  });
  return units.flatMap((u, i) => {
    if (split.has(u.region)) return [u];
    const list = members.get(u.region);
    if (list[0] !== i) return [];
    const polys = polysOf(feature(topo, mergeArcs(topo, list.map(k => geoms[k]))).geometry);
    return [{ id: u.region, name: u.regionName, realm: u.realm, region: u.region, regionName: u.regionName, whole: true, polys }];
  });
}

/**
 * The units `isEmpty` picks, on the same landmass as the others (adjacent through
 * shared borders or across the national border), and those off it (Hawaii).
 */
function emptyLand(units, isEmpty) {
  const prepared = prepareUnits(units);
  const { comp } = components(joinRealms(prepared, unitTopology(prepared).adjacency, JOIN_KM));
  const played = new Set(prepared.filter(u => !isEmpty(u)).map(u => comp[u.index]));
  const all = prepared.filter(isEmpty);
  return { empty: all.filter(u => played.has(comp[u.index])), off: all.filter(u => !played.has(comp[u.index])) };
}

/**
 * The two layers draw the national border apart, by up to a few km and crossing back
 * and forth, so neighbours across it would share no arcs (and no land border in the
 * game). Every other piece is fitted to the `line` realm's: its edges within BORDER_KM
 * of that land are widened into a band, and then that land and the other fitted pieces
 * are cut away. Overlaps go, the slivers between the lines fill, and both sides share
 * the line vertex for vertex. Pieces are { club, realm, polys }, fitted in place.
 */
function fitBorder(pieces, line, log) {
  const kmPerDeg = EARTH_KM * Math.PI / 180;
  const fixedPieces = pieces.filter(p => p.realm === line);
  // The line's edges in a grid of about BORDER_KM cells, for distances from the other side.
  const cell = BORDER_KM / kmPerDeg, grid = new Map();
  for (const p of fixedPieces) for (const poly of p.polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
        const k = `${x},${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([a, b]);
      }
    }
  }
  const nearLine = p => {
    const kx = Math.cos(p[1] * Math.PI / 180) * kmPerDeg, x0 = Math.floor(p[0] / cell), y0 = Math.floor(p[1] / cell);
    // A cell is narrower in longitude than BORDER_KM: look as many cells either way as it takes.
    const dx = Math.ceil(kmPerDeg / kx);
    for (let x = x0 - dx; x <= x0 + dx; x++) for (let y = y0 - 1; y <= y0 + 1; y++) for (const [a, b] of grid.get(`${x},${y}`) || []) {
      const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * kmPerDeg, ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * kmPerDeg, len = ex * ex + ey * ey;
      const t = len ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len)) : 0;
      if (Math.hypot(ax + t * ex, ay + t * ey) <= BORDER_KM) return true;
    }
    return false;
  };
  // A rectangle BORDER_KM either side of a-b, reaching BORDER_KM past each end.
  const band = (a, b) => {
    const kx = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) * kmPerDeg;
    const ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * kmPerDeg, len = Math.hypot(ex, ey) || 1;
    const ux = ex / len * BORDER_KM, uy = ey / len * BORDER_KM;
    const at = (p, s, t) => [p[0] + (s * ux - t * uy) / kx, p[1] + (s * uy + t * ux) / kmPerDeg];
    const ring = [at(a, -1, -1), at(b, 1, -1), at(b, 1, 1), at(a, -1, 1)];
    return [[...ring, ring[0]]];
  };
  const touches = (b1, b2) => b1[0] <= b2[2] && b2[0] <= b1[2] && b1[1] <= b2[3] && b2[1] <= b1[3];
  let fitted = 0;
  for (const p of pieces) {
    if (p.realm === line) continue;
    const bands = [];
    for (const poly of p.polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
      if (nearLine(ring[i]) && nearLine(ring[i + 1])) bands.push(band(ring[i], ring[i + 1]));
    }
    if (!bands.length) continue;
    const box = bboxOf(bands);
    const cut = pieces.filter(q => q !== p && (q.realm === line || q.realm === p.realm) && touches(bboxOf(q.polys), box)).map(q => q.polys);
    p.polys = polygonClipping.difference(polygonClipping.union(p.polys, ...bands), ...cut);
    fitted += bands.length;
  }
  // The cuts add crossing points to the fitted side only: give the line's rings the same vertices.
  nodeRings(pieces);
  log(`  fitted ${fitted} border edges to the ${line} line`);
}

// Each era's team that has moved or been renamed since, by its 2K code, and the code of the franchise it is today: an
// era map ranks its teams as their franchises rank today.
const LINEAGE = { VAN: 'MEM', SEA: 'OKC', NJN: 'BKN', CHH: 'CHA', NOH: 'NOP' };

/** A league's clubs strongest first, as the partition ranks them (section ids follow this order), each with its venue. */
function rankedClubs(clubs, venues, noun) {
  const ranked = clubs.slice().sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const missing = ranked.filter(c => !venues[c.id]);
  if (missing.length) throw new Error(`No ${noun} for ${missing.map(c => c.name).join(', ')}`);
  const stale = Object.keys(venues).filter(id => !ranked.some(c => c.id === id));
  if (stale.length) throw new Error(`${noun[0].toUpperCase()}${noun.slice(1)}s for clubs the game does not have: ${stale.join(', ')}`);
  return ranked;
}

/** The NFL's one map, from the game's clubs and their stadiums: `{ id, seasons: null, clubs: [{ id, name, city, arena, home }] }`. */
async function nflSpecs() {
  const stadiums = JSON.parse(await readFile(stadiumsFile, 'utf8')).teams;
  const clubs = rankedClubs(NFL_CLUBS, stadiums, 'stadium')
    .map(c => ({ id: c.id, name: c.name, city: stadiums[c.id].city, arena: stadiums[c.id].stadium, home: stadiums[c.id].home }));
  return [{ id: LEAGUES.nfl.id, seasons: null, clubs }];
}

/**
 * The NBA maps to build, each `{ id, seasons, clubs: [{ id, name, city, arena, home }] }` in rank order: today's from
 * the game's clubs (`seasons` null), then one per earlier era of scripts/data/nba-seasons.json, whose seasons must all
 * have the same teams in the same arenas.
 */
async function nbaSpecs() {
  const ID = LEAGUES.nba.id;
  const arenas = JSON.parse(await readFile(arenasFile, 'utf8')).clubs;
  const manifest = JSON.parse(await readFile(seasonsFile, 'utf8'));
  const today = rankedClubs(NBA_CLUBS, arenas, 'arena');
  const specs = [{ id: ID, seasons: null, clubs: today.map(c => ({ id: c.id, name: c.name, ...arenas[c.id] })) }];

  const rank = new Map(today.map((c, i) => [c.id, i]));
  const teamsAt = year => teamsOf(manifest, year, arenas);
  const places = teams => JSON.stringify(teams.map(t => [t.id, t.city, t.home]).sort());
  const latest = Math.max(...manifest.maps.find(map => map.id === ID).seasons);
  const todayOf = new Map(teamsAt(latest).map(t => [t.code, t.id]));
  for (const map of manifest.maps) {
    const [first, ...rest] = map.seasons;
    const teams = teamsAt(first);
    const differs = rest.find(year => places(teamsAt(year)) !== places(teams));
    if (differs) throw new Error(`${map.id}: the teams or arenas of the season ending ${differs} are not those of ${first}`);
    if (map.id === ID) {
      if (places(teams) !== places(specs[0].clubs)) throw new Error(`${ID}: the seasons ${map.seasons.join(', ')} are not today's teams and arenas`);
      continue;
    }
    const rankOf = team => rank.get(todayOf.get(LINEAGE[team.code] || team.code));
    specs.push({ id: map.id, seasons: map.seasons.map(seasonIdOf), clubs: teams.slice().sort((a, b) => rankOf(a) - rankOf(b)) });
  }
  return specs;
}

async function build({ source, log, spec, league }) {
  const { id: mapId, seasons, clubs } = spec;
  const names = clubs.map(c => c.city);
  if (new Set(names).size !== names.length) throw new Error(`${mapId}: two franchises share a city name`);
  const n = clubs.length;

  const layers = [];
  const countryList = [];
  for (const country of league.countries) {
    const { units, layers: used } = await countryUnits(source, country, log);
    countryList.push(units);
    layers.push(...used);
    log(`${country.iso3} ${UNIT_LEVEL}: ${units.length} units in ${new Set(units.map(u => u.region)).size} ${REGION_LEVEL} regions`);
  }
  const rawHomes = clubs.map(c => c.home);
  // Each arena's state or province: that of the unit it stands in, else the nearest unit.
  const allUnits = countryList.flat();
  const regionOf = clubs.map((c, i) => allUnits.reduce((best, u) => {
    const km = kmToPolys(rawHomes[i], u.polys);
    return !best || km < best.km ? { km, region: u.region } : best;
  }, null).region);
  const regionName = new Map(allUnits.map(u => [u.region, u.regionName]));
  // A state's own franchises, and those of a state the league joins to it, may take its counties.
  const joinedTo = region => Object.entries(league.joins).filter(([, to]) => to.includes(region)).map(([from]) => from);
  const shared = new Set([...regionOf.filter((r, i) => regionOf.indexOf(r) !== i),
    ...Object.entries(league.joins).filter(([from]) => regionOf.includes(from)).flatMap(([, to]) => to)]);
  log(`  split between their franchises: ${[...shared].map(r => `${regionName.get(r)} (${regionOf.filter(x => x === r || joinedTo(r).includes(x)).length})`).join(', ')}`);
  const merged = countryList.flatMap(list => mergeRegions(list, shared));
  const isEmpty = u => u.whole && !regionOf.includes(u.region)
    && Math.min(...rawHomes.map(h => kmBetween(centroidOf(u.polys), h))) > EMPTY_KM;
  const { empty, off } = emptyLand(merged, isEmpty);
  log(`  empty: ${empty.map(u => `${u.regionName} ${Math.round(u.area / 1000)}k km²`).join(', ')}`);
  if (off.length) log(`  dropped off the landmass: ${off.map(u => u.regionName).join(', ')}`);
  const rawUnits = merged.filter(u => !isEmpty(u));
  // A shared state's counties go only to its own (and joined) franchises; whole states to anyone.
  const allowed = (club, unit) => !shared.has(unit.region) || unit.region === regionOf[club] || joinedTo(unit.region).includes(regionOf[club]);
  const { shift, units, adjacency, topo: unitTopo, homes, homeOf, located, dropped, splits, sourceUnits, sourceAreaKm2, owner } = partitionCountry(
    rawUnits, rawHomes, { sections: n, joinKm: JOIN_KM, allowed, spare: true, log });
  if (shift) throw new Error('The map crosses the antimeridian');
  const unlocated = clubs.filter((_, i) => !homeOf[i] || located[i].status === 'discarded').map(c => c.name);
  if (unlocated.length) throw new Error(`Arenas off the map: ${unlocated.join(', ')}`);

  // Projection: circular-mean meridian, standard parallel through the main landmass.
  const { comp, count } = components(adjacency);
  const compArea = new Array(count).fill(0);
  units.forEach((u, i) => { compArea[comp[i]] += u.area; });
  const main = compArea.indexOf(Math.max(...compArea));
  const mainBox = bboxOf(units.filter((_, i) => comp[i] === main).flatMap(u => u.polys));
  const projection = { lon0: fixed(round(circularMeanLon(units.map(u => [u.centroid[0], u.area])))), lat0: fixed(round((mainBox[1] + mainBox[3]) / 2)) };

  const ids = clubs.map((_, i) => `${mapId}-${String(i + 1).padStart(3, '0')}`);
  const unitCounts = clubs.map((_, i) => owner.filter(o => o === i).length);
  // Islets below ~4 px² at the opening fit are noise; an arena's islet always stays.
  const extentKm = Math.max(kmBetween([mainBox[0], (mainBox[1] + mainBox[3]) / 2], [mainBox[2], (mainBox[1] + mainBox[3]) / 2]),
    kmBetween([mainBox[0], mainBox[1]], [mainBox[0], mainBox[3]]));
  const minAreaKm2 = fixed(4 * (extentKm / 900) ** 2, 3);
  // Each franchise's land per country and each empty region (club -1), the Canadian pieces
  // fitted to the US line, then joined again.
  const realms = league.countries.map(c => c.id);
  const pieceOf = units.map((u, i) => owner[i] * realms.length + realms.indexOf(u.realm));
  const pieces = dissolve(unitTopo, pieceOf, n * realms.length)
    .map((geometry, k) => ({ club: Math.floor(k / realms.length), realm: realms[k % realms.length], polys: polysOf(geometry) }))
    .concat(empty.map(u => ({ club: -1, realm: u.realm, region: u.region, name: u.regionName, polys: u.polys })))
    .filter(piece => piece.polys.length);
  if (realms.length > 1) fitBorder(pieces, '840', log);
  const fitted = topology({ pieces: { type: 'FeatureCollection', features: pieces.map((piece, k) => ({
    type: 'Feature', id: k, properties: {}, geometry: { type: 'MultiPolygon', coordinates: piece.polys } })) } });
  const sectionGeoms = clubs.map((_, c) => feature(fitted, mergeArcs(fitted,
    fitted.objects.pieces.geometries.filter((_, k) => pieces[k].club === c))).geometry);
  // Empty land is simplified with the sections, so the two keep one border.
  const emptyPieces = pieces.filter(piece => piece.club < 0);
  const emptyGeoms = emptyPieces.map(piece => feature(fitted, fitted.objects.pieces.geometries[pieces.indexOf(piece)]).geometry);
  const filtered = sectionTopology([...sectionGeoms, ...emptyGeoms], {
    ids: [...ids, ...emptyPieces.map(piece => piece.region)], names: [...names, ...emptyPieces.map(piece => piece.name)],
    unitCounts: [...unitCounts, ...emptyPieces.map(() => 1)], minAreaKm2, keepPoints: homes,
  });

  const meta = {
    format: 1,
    id: mapId,
    name: league.name,
    sport: league.sport,
    league: league.league,
    // An era's map serves its seasons, whose own clubs take its sections; today's map serves the game's clubs.
    ...(seasons ? { seasons } : {}),
    hosts: league.countries.map(c => c.id),
    version: '',
    projection,
    focus: null,
    boundaries: { provider: 'geoBoundaries', layers, units: sourceUnits, areaKm2: Math.round(sourceAreaKm2) },
  };
  const rows = clubs.map((c, i) => ({ id: c.id, ...(seasons ? { name: c.name } : {}), col: '', section: ids[i], home: c.home, arena: c.arena }));

  let target = POINT_TARGET;
  let doc, text, qtopo;
  for (;;) {
    qtopo = quantize(simplifyTopology(filtered.topo, target), 1e5);
    delete qtopo.bbox;
    const all = qtopo.objects.sections.geometries;
    qtopo.objects = {
      sections: { type: 'GeometryCollection', geometries: all.slice(0, n) },
      empty: { type: 'GeometryCollection', geometries: all.slice(n).map(({ properties, ...g }) => ({ ...g, properties: { name: properties.name } })) },
    };
    const geoms = qtopo.objects.sections.geometries;
    const sectionPolys = geoms.map(g => geomPolys(qtopo, g));
    const box = bboxOf(sectionPolys.flat());
    const padX = (box[2] - box[0]) * 0.02, padY = (box[3] - box[1]) * 0.02;
    meta.focus = [Math.floor((box[0] - padX) * 10) / 10, Math.floor((box[1] - padY) * 10) / 10,
      Math.ceil((box[2] + padX) * 10) / 10, Math.ceil((box[3] + padY) * 10) / 10].map(v => fixed(v));
    // Neighbouring franchises differ in colour, across the border and across water too.
    const across = facingSections(sectionPolys, facingKm(meta.focus));
    const clubAdj = clubs.map(() => new Set());
    neighbors(geoms).forEach((list, p) => { for (const j of [...list, ...across[p]]) if (j !== p) clubAdj[p].add(j); });
    const colours = colourSections(clubAdj.map(s => [...s].sort((a, b) => a - b)));
    rows.forEach((row, i) => { row.col = colours[i]; });
    doc = { ...meta, topology: qtopo, clubs: rows };
    doc.version = `${mapId}-${contentHash(doc)}`;
    text = serialize(doc);
    if (Buffer.byteLength(text) <= MAX_BYTES || target < 4000) break;
    target = Math.floor(target * 0.85);
  }

  // Verify with the game's own loader.
  const decoded = decodeDomestic(JSON.parse(text), mapId);
  const sectionPolys = qtopo.objects.sections.geometries.map(g => geomPolys(qtopo, g));
  const areas = sectionPolys.map(polysAreaKm2);
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const areaDiff = (totalArea - sourceAreaKm2) / sourceAreaKm2;
  if (Math.abs(areaDiff) > 0.02) throw new Error(`Section area ${Math.round(totalArea)} km² differs from the source ${Math.round(sourceAreaKm2)} km² by ${(areaDiff * 100).toFixed(2)}%`);
  const landSplit = splitOnLand(qtopo.objects.sections.geometries, ids.map((_, i) => i)).map(c => clubs[c].name);
  if (landSplit.length) log(`  split on land: ${landSplit.join(', ')}`);
  log(`  ${sourceUnits} units -> ${n} territories; dropped ${dropped.length} overseas units; ${splits.length} units split for shared cities`);
  const strays = units.filter((u, k) => !allowed(owner[k], u));
  if (strays.length) throw new Error(`Counties of a shared state went to another state's franchise: ${strays.map(u => u.name).join(', ')}`);
  clubs.forEach((c, i) => {
    const km = kmToPolys(homes[i], sectionPolys[i]);
    const held = units.filter((_, k) => owner[k] === i);
    const regions = [...new Set(held.map(u => (u.whole ? '' : 'part of ') + regionName.get(u.region)))];
    log(`  ${ids[i]} ${names[i].padEnd(15)} ${c.name.padEnd(24)} ${String(Math.round(areas[i] / 1000)).padStart(5)}k km² ${regions.join(', ')}${km ? `, arena ${fixed(km)} km outside` : ''}`);
  });
  log(`  ${arcPoints(qtopo)} arc points, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, ${Object.keys(decoded.sectionNames).length} sections decode`);

  // An era's strongest clubs are each of its seasons' own, which the setup reads from the season.
  const top = rows.slice(0, 3).map(row => clubs.find(c => c.id === row.id).name);
  const entry = { id: mapId, sport: league.sport, league: league.league, name: league.name, ...(seasons ? { seasons } : {}), clubs: n,
    sections: n, ...league.entry, version: doc.version, ...(seasons ? {} : { top }) };
  return { entry, outputs: [[outFile(mapId), text], [attributionFile(mapId), attributionText(doc, league)]] };
}

function indexModule(entries) {
  return `// GENERATED by scripts/build-club-maps.mjs from public/domestic/nba*.json and nfl.json; do not edit.
// Maps a sport's clubs play on instead of the world (docs/design/domestic-campaigns.md,
// "The NBA map", "The NFL map"): the setup offers each as its sport's club theatre ('domestic:<id>')
// and the loader fetches public/domestic/<id>.json on demand. A map with \`seasons\` is an
// earlier era's, played only with those built-in seasons' clubs, whose strongest each
// season names itself.
// { id, sport, league, name, seasons?, clubs, sections, venue? ('arena' unless named), lines? ('state and province'
//   unless named), version, top?: three strongest clubs }

export const CLUB_MAPS = [
${entries.map(entry => `  ${JSON.stringify(entry)},`).join('\n')}
];
`;
}

function attributionText(doc, league) {
  const lines = [
    doc.seasons ? `${league.league} map of the seasons ${doc.seasons.join(', ')} (public/domestic/${doc.id}.json), ${doc.version}`
      : `${league.league} map (public/domestic/${doc.id}.json), ${doc.version}`,
    'Generated by scripts/build-club-maps.mjs; do not edit.',
    '',
    'Territory shapes are derived (dissolved, simplified, quantized) from the administrative',
    'boundary layers below; each layer keeps its own licence.',
    '',
    'geoBoundaries (https://www.geoboundaries.org), gbOpen release, each file pinned to the commit in its URL:',
    `  ${GB_CITATION}`,
    "Land the game's world map (public/countries-50m.json: world-atlas 2.0.2, ISC; Natural Earth 1:50m,",
    '  public domain) draws for another country is cut; see "Cut" lines below.',
    doc.seasons ? 'Arena locations: scripts/data/nba-arenas.json, and scripts/data/nba-seasons.json for teams that have moved since.'
      : league.venues,
  ];
  for (const b of doc.boundaries.layers) {
    lines.push('', `${b.iso3} ${b.level}${b.use === 'grouping' ? ` (only groups the units above by ${league.countries.length > 1 ? 'state or province' : 'state'})` : ''}`);
    lines.push(`  Source: ${b.source}${b.year ? ` (${b.year})` : ''}`);
    lines.push(`  Licence: ${b.license}`);
    lines.push(`  File: ${b.url}`);
    if (b.foreign) lines.push(`  Cut (the world map's ${b.foreign.map(c => `${c.shape} ${c.km2.toLocaleString('en')} km²`).join(', ')})`);
  }
  return `${lines.join('\n')}\n`;
}

const SPECS = { nba: nbaSpecs, nfl: nflSpecs };

async function main() {
  const argv = process.argv.slice(2), args = new Set(argv);
  const check = args.has('--check'), dryRun = args.has('--dry-run');
  const only = argv.find(a => a.startsWith('--league='))?.slice('--league='.length);
  if (only && !LEAGUES[only]) throw new Error(`Unknown league ${only}: one of ${Object.keys(LEAGUES).join(', ')}`);
  const log = line => console.log(line);
  const started = Date.now();
  const source = createBoundarySource({ cacheDir, worldFile, offline: check, log });
  const outputs = new Map(), built = new Map();
  for (const key of only ? [only] : Object.keys(LEAGUES)) {
    const league = LEAGUES[key], entries = [];
    for (const spec of await SPECS[key]()) {
      log(`${spec.id}: ${spec.clubs.length} franchises${spec.seasons ? ` for ${spec.seasons.join(', ')}` : ''}`);
      const { entry, outputs: files } = await build({ source, log, spec, league });
      entries.push(entry);
      for (const [file, text] of files) outputs.set(file, text);
    }
    built.set(key, entries);
  }
  // A league not built keeps its entries as the index lists them; the leagues stay in LEAGUES order.
  const entries = Object.entries(LEAGUES).flatMap(([key, league]) => built.get(key)
    ?? CLUB_MAPS.filter(entry => entry.league === league.league));
  outputs.set(indexFile, indexModule(entries));
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) {
      for (const f of differs) console.error(`differs: ${f}`);
      process.exit(1);
    }
    log(`Verified the ${only ? LEAGUES[only].league : 'NBA and NFL'} maps, their index and attributions byte for byte.`);
  } else if (!dryRun) {
    for (const [file, text] of outputs) await writeFile(file, text);
    log(`Wrote the ${only ? LEAGUES[only].league : 'NBA and NFL'} maps, their index and attributions in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  }
}

await main();
