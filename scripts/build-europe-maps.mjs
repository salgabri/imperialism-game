// The maps Europe's football clubs play on (docs/design/domestic-campaigns.md, "The Europe maps"): one for the strongest
// TOP_CLUBS and one for the strongest ELITE_CLUBS, for the built-in season and for each earlier season with clubs; and the
// women's game's, one for every European club and one for its ELITE_CLUBS strongest, likewise; and the ones the
// EuroLeague's basketball clubs play on (docs/design/euroleague.md), all of its clubs, by the same rules: the built-in
// season's, and one for each run of earlier seasons with the same clubs, 2000/01 to 2025/26; and the one rugby union's
// European clubs of 2025/26 play on (docs/design/rugby-union.md), the Premiership's, the Top 14's and the URC's European
// sides. A club holds land only in its own country. A country's only club holds all of it; several clubs share it along
// its administrative borders, level by level (scripts/lib/admin-levels.mjs): a region goes whole to one club unless it
// holds two or more, and then its provinces, departments or counties are split between them the same way, and theirs down
// to the communes; a country with no club is not on the map at all, so it stays grey beneath it, like any neighbour of a
// country map.
// Russia's clubs hold European Russia only (`within`), the rest of Russia lying grey beneath the map (`partial`). An
// earlier season whose clubs come from all of Europe has maps of their own ids (eu124e2018); its seven-league maps of
// before (eu124s2018) stay in the index, never rebuilt, for the campaigns saved on them (`replacedBy`).
//
// Usage:
//   node scripts/build-europe-maps.mjs [--only=eu124,eu32] [--check | --dry-run] [--boundaries=<dir>]
//     --only        build these maps (eu124, weu32s2025, euroleague, rugbyeurope…); the index keeps the others' entries as
//                   they are
//     --check       rebuild offline from the caches and compare every output byte for byte
//     --dry-run     build and verify (downloading boundaries as needed) but write nothing
//     --boundaries  the boundary cache (default data-src/boundaries), e.g. another worktree's that holds Europe's layers
//
// Inputs:  the clubs in src/data/clubs.football.js and the earlier seasons' public/football/<id>.json, the women's in
//          src/data/clubs.womens-football.js and public/womens-football/<id>.json (their European clubs), the EuroLeague's in
//          src/data/clubs.euroleague.js and, for its earlier seasons, scripts/lib/euroleague-seasons.mjs (from
//          scripts/data/euroleague-seasons/); where they stand, in
//          scripts/data/europe-clubs.json; rugby union's clubs and their grounds in scripts/data/rugby-union-clubs.json,
//          strongest first by src/data/clubs.rugby-union.js once it rates them; geoBoundaries gbOpen layers, Natural Earth admin-1 (the home nations'
//          counties) and the ONS's districts (England's), cached under the gitignored data-src/boundaries/;
//          the game's world map public/countries-50m.json, whose outlines every country keeps, so territories meet
//          each other and the grey neighbours on the very borders the rest of the game draws.
// Outputs: public/domestic/eu<clubs>[s<season year>].json, the women's weu[32][s<season year>].json, the EuroLeague's
//          euroleague.json and el<season year>.json, rugby union's rugbyeurope.json, public/domestic/ATTRIBUTION-europe.txt
//          and src/data/europeMaps.js.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import polygonClipping from 'polygon-clipping';
import { topology } from 'topojson-server';
import { feature, mergeArcs, neighbors } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as WOMENS_CLUBS } from '../src/data/clubs.womens-football.js';
import { CLUBS as EUROLEAGUE_CLUBS } from '../src/data/clubs.euroleague.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { BIG_LEAGUES } from '../src/data/footballLeagues.js';
import { euroleagueSeasons, gameYearOf } from './lib/euroleague-seasons.mjs';
import { ELITE_CLUBS, TOP_CLUBS, isEuropeanClub, strongestClubs } from '../src/data/scopes.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { checkLevels, COUNTRIES, naturalEarthGroups, nestLevels, ONS_DISTRICTS, WITHIN } from './lib/admin-levels.mjs';
import { createBoundarySource, GB_CITATION, NE_URL, ONS_LAD_LICENSE, ONS_LAD_SOURCE, ONS_LAD_URL } from './lib/domestic-boundaries.mjs';
import { colourSections, contentHash, serialize } from './lib/domestic-output.mjs';
import {
  arcPoints, bboxOf, centroidOf, dissolve, EARTH_KM, facingKm, facingSections, interiorPoint, kmBetween, kmToPolys, nodeRings, OVERSEAS_KM,
  partitionCountry, pointInPolys, polyAreaKm2, polysAreaKm2, polysOf, quantize, sectionTopology, simplifyTopology, splitOnLand,
} from './lib/domestic-partition.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = id => path.join(root, `public/domestic/${id}.json`);
const attributionFile = path.join(root, 'public/domestic/ATTRIBUTION-europe.txt');
const indexFile = path.join(root, 'src/data/europeMaps.js');
const clubsFile = path.join(root, 'scripts/data/europe-clubs.json');
const cacheDir = path.join(root, 'data-src/boundaries');
const worldFile = path.join(root, 'public/countries-50m.json');
const setFile = (id, sport = 'football') => path.join(root, `public/${sport}/${id}.json`);
const rugbyUnionFile = path.join(root, 'scripts/data/rugby-union-clubs.json');
const rugbyUnionRatings = path.join(root, 'src/data/clubs.rugby-union.js');

// Each country's levels, from its regions down to its communes, and Russia's European part: scripts/lib/admin-levels.mjs.
// A region whose clubs would each have under this share of the country's land per club is too small to hold them (a
// city-state: Berlin, Bremen, Madrid), so it is shared with its largest neighbouring region. A top region with no club is
// split where it is larger than FREE_TOP of the country's share per club, and anything below that where it is larger
// than FREE_LOWER of a share of the region it lies in, or the lucky neighbour would take far more than the others. Both
// since 2026-11-15, when the levels went down to the communes: an eighth (from a quarter), so Cheshire's councils are
// shared between Liverpool and Manchester's clubs rather than going whole to the first to reach them, and half (from a
// whole), so the districts around a crowded city are shared out (Lancashire's), while a province of a roomy region stays
// whole (Andalusia's).
const TINY_REGION = 0.25;
const FREE_TOP = 0.125;
const FREE_LOWER = 0.5;
// A club may start this far from its ground before the unit it shares with a stronger club is cut between them.
const MAX_GAP_KM = 3;
// Land near a country's main landmass is framed by the opening camera; the Canaries, the Azores and Svalbard wait for a zoom out.
const FOCUS_KM = 300;
// Islets under this are cuts between two sources' coasts, not land: they go unless they hold a ground.
const MIN_AREA_KM2 = 5;
// A unit's fragments under this are slivers between its source's coast and the world outline's: dropped (loadCountry).
const MIN_PART_KM2 = 0.5;
// A detached piece of a club's land under this, mostly against one other club's land, is that club's (absorbSpecks), in
// at most SPECK_PASSES passes (a pass's moves can shut the next piece in). 400 km², not 100: a club that takes a unit in
// pieces can take its neighbours through the far piece, and shut them in with it (Real Madrid's 111 km² of Argés,
// Cobisa and Layos, inside Rayo Vallecano's land by Toledo). An edge within SPECK_EDGE_KM of a piece lies against it:
// the clubs' land shares its borders exactly here, before the map is simplified, and anything looser would join pieces
// across a river (the Yare at Great Yarmouth).
const SPECK_KM2 = 400;
const SPECK_PASSES = 6;
const SPECK_EDGE_KM = 0.005;
// Land farther than this outside a country's world outline is below its 1:50m detail (Porto Santo): no club can hold it there.
const OUTLINE_KM = 5;
// The land a club needs, per the partition's fair rules: this share of the country's land per club, and about 35 km
// across (6 px at the Europe map's opening fit). A club that cannot find it around its ground starts next door: Galatasaray
// across the Bosphorus, as Thrace is a thirtieth of Turkey. Asking for less leaves such clubs slivers; for more, far from home.
const MIN_SHARE = 0.1;
const MIN_CLUB_KM2 = 1200;
const POINT_TARGET = 16000;
const MAX_BYTES = 250000;
// Country splits remembered for the next maps (the least recently used goes first).
const SPLITS_KEPT = 40;

const fixed = (v, digits = 1) => Number(v.toFixed(digits));
const round = (v, step = 0.1) => Math.round(v / step) * step;
const multi = polys => ({ type: 'MultiPolygon', coordinates: polys });

function circularMeanLon(points) {
  let x = 0, y = 0;
  for (const [lon, weight] of points) { x += Math.cos(lon * Math.PI / 180) * weight; y += Math.sin(lon * Math.PI / 180) * weight; }
  return Math.atan2(y, x) * 180 / Math.PI;
}

const layerOf = row => {
  const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim() || undefined;
  return { iso3: row.boundaryISO, level: row.boundaryType, license: row.boundaryLicense, source: clean(row.boundarySource),
    year: clean(row.boundaryYearRepresented), url: row.simplifiedGeometryGeoJSON };
};

/**
 * A country's world shape without its far overseas land (French Guiana, the Dutch Caribbean): `{ polys, near }`, `near` the
 * land the camera frames. A country whose clubs hold only part of it (`within`) keeps every polygon here: its land and
 * camera are its clubs' fitted land (`partShape`).
 */
async function worldShape(source, shapeId) {
  const shape = (await source.world()).find(s => s.key === shapeId);
  if (!shape) throw new Error(`No world shape ${shapeId}`);
  if (COUNTRIES[shapeId]?.within) return { name: shape.name, polys: shape.polys, near: [] };
  const areas = shape.polys.map(polyAreaKm2);
  const main = shape.polys[areas.indexOf(Math.max(...areas))];
  const at = centroidOf([main]);
  const polys = shape.polys.filter(poly => kmBetween(centroidOf([poly]), at) <= OVERSEAS_KM);
  const near = polys.filter(poly => poly === main || kmToPolys(centroidOf([poly]), [main]) <= FOCUS_KM);
  return { name: shape.name, polys, near };
}

/**
 * The shape of a country its clubs hold only part of: their fitted land, `near` its pieces by its largest (FOCUS_KM), and
 * `outline` the world shape whose vertices simplification keeps (only where the land follows it: not the regions' line
 * across the country, which simplifies as any border between clubs does).
 */
function partShape(shape, land) {
  const polys = land.flat();
  const areas = polys.map(polyAreaKm2);
  const main = polys[areas.indexOf(Math.max(...areas))];
  return { name: shape.name, polys, outline: shape.polys, partial: true,
    near: polys.filter(poly => poly === main || kmToPolys(centroidOf([poly]), [main]) <= FOCUS_KM) };
}

/** Polygons wound as RFC 7946 has them, and geoBoundaries and polygon-clipping do: outer rings anticlockwise, holes clockwise. */
function rewound(polys) {
  const signed = ring => ring.reduce((sum, [x, y], i) => (i ? sum + ring[i - 1][0] * y - x * ring[i - 1][1] : 0), 0);
  return polys.map(poly => poly.map((ring, k) => ((signed(ring) > 0) === (k === 0) ? ring : [...ring].reverse())));
}

/** The index of the item of `list` (each `{ polys, bbox }`) holding a point, else of the nearest. */
function memberIndex(list, point) {
  const hit = list.findIndex(item => point[0] >= item.bbox[0] && point[0] <= item.bbox[2] && point[1] >= item.bbox[1] && point[1] <= item.bbox[3] && pointInPolys(point, item.polys));
  if (hit >= 0) return hit;
  let best = -1, bestKm = Infinity;
  list.forEach((item, i) => { const km = kmToPolys(point, item.polys); if (km < bestKm) { bestKm = km; best = i; } });
  return best;
}
const memberOf = (list, point) => list[memberIndex(list, point)];

/**
 * A country's admin units on one topology, with the tree of its regions above them: `{ spec, units, geoms, topo,
 * adjacency, tree, pathOf, layers, outside }`. The units are the country's finest level (COUNTRIES: its communes, parishes
 * or cadastral areas where the sources have them), so all geometry comes from one layer and a region's border is its
 * units'; every coarser level only groups them, each unit by its interior point, made to nest (nestLevels). A region
 * node is `{ key, name, members: [unit], children: Map, area }`, a unit a node without children; `pathOf[unit]` lists the
 * nodes from the top region down to the unit's own. Land the world `outline` leaves out is not among them.
 */
async function loadCountry(source, shapeId, outline, log) {
  const spec = COUNTRIES[shapeId];
  if (!spec) throw new Error(`Clubs share ${shapeId}, which has no levels in COUNTRIES`);
  const rows = await source.layers(spec.iso3);
  checkLevels(shapeId, spec, rows);
  const rowAt = level => {
    const row = rows.find(r => r.boundaryType === level);
    if (!row) throw new Error(`No geoBoundaries ${spec.iso3} ${level} layer`);
    return row;
  };
  const shapes = async (level, label = level) => (await source.features(rowAt(level)))
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f, i) => ({ id: `${label}-${i}`, iso: f.properties.shapeISO, name: f.properties.shapeName || `${label} ${i + 1}`, polys: polysOf(f.geometry) }))
    .filter(u => u.polys.length)
    .map(u => ({ ...u, bbox: bboxOf(u.polys) }));
  const unitLevel = spec.levels.at(-1);
  let units, layers;
  if (unitLevel === ONS_DISTRICTS) {
    // England's districts: the ONS's, those of the home nation's code letter (E…, W…, S…, N…). The ONS's service winds
    // its rings clockwise (Esri's order); every other source and polygon-clipping wind outer rings anticlockwise, and a
    // merge across the two would stitch Cheshire inside out, so they are wound the other way round.
    const letter = { 'GB-ENG': 'E', 'GB-WLS': 'W', 'GB-SCT': 'S', 'GB-NIR': 'N' }[spec.part];
    units = (await source.onsDistricts())
      .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') && f.properties.lad19cd.startsWith(letter))
      .map(f => ({ id: `LAD-${f.properties.lad19cd}`, name: f.properties.lad19nm, polys: rewound(polysOf(f.geometry)) }))
      .filter(u => u.polys.length)
      .map(u => ({ ...u, bbox: bboxOf(u.polys) }));
    layers = [{ iso3: spec.iso3, level: 'ONS LAD 2019', license: ONS_LAD_LICENSE, source: ONS_LAD_SOURCE, year: '2019', url: ONS_LAD_URL, use: 'units' }];
  } else {
    units = await shapes(unitLevel);
    layers = [{ ...layerOf(rowAt(unitLevel)), use: 'units' }];
    // Land the finest layer leaves out comes from the level above it, as on the country maps: Russia's districts have no
    // Moscow and no St Petersburg, federal cities, whose clubs would otherwise stand on the districts around them.
    const parent = spec.levels.at(-2);
    if (parent && /^ADM\d$/.test(parent)) {
      const { units: all, filled } = await source.fillParents(units, rowAt(parent));
      if (filled.length) {
        log(`  ${shapeId} ${spec.iso3}: ${unitLevel} filled from ${parent}: ${filled.join(', ')}`);
        units = all.map(u => (units.includes(u) ? u : { ...u, id: `fill-${u.id}`, bbox: bboxOf(u.polys) }));
      }
    }
  }
  if (spec.part) {
    const parts = await shapes('ADM1');
    if (!parts.some(p => p.iso === spec.part)) throw new Error(`No ${spec.part} in ${spec.iso3} ADM1`);
    units = units.filter(u => memberOf(parts, interiorPoint(u.polys)).iso === spec.part);
    layers.push({ ...layerOf(rowAt('ADM1')), use: 'grouping' });
  }
  // Only the regions `within` names; the others are kept apart, so the land beyond them stays off the map (fitToOutline).
  let outside = null;
  if (spec.within) {
    const parts = await shapes('ADM1'), kept = new Set(WITHIN[spec.within]);
    const unknown = [...kept].filter(iso => !parts.some(p => p.iso === iso));
    if (unknown.length) throw new Error(`No ${unknown.join(', ')} in ${spec.iso3} ADM1`);
    units = units.filter(u => kept.has(memberOf(parts, interiorPoint(u.polys)).iso));
    outside = parts.filter(p => !kept.has(p.iso)).flatMap(p => p.polys);
    layers.push({ ...layerOf(rowAt('ADM1')), use: 'grouping' });
  }
  const onOutline = poly => {
    const point = interiorPoint([poly]);
    return pointInPolys(point, outline) || kmToPolys(point, outline) <= OUTLINE_KM;
  };
  // Fragments under MIN_PART_KM2 of a unit with a larger part go: slivers where a unit's coast or estuary is drawn finer
  // than the world outline (the ONS's Ribble and Thames), which would stand as specks in a neighbour's land. The world
  // outline's own land there is filled in later by the nearest club (fitToOutline).
  const parts = polys => {
    const kept = polys.filter(poly => polyAreaKm2(poly) >= MIN_PART_KM2);
    return kept.length ? kept : polys;
  };
  units = units.map(u => ({ ...u, polys: parts(u.polys.filter(onOutline)) })).filter(u => u.polys.length);
  // A country whose units come in pieces they should not (`pieces` in COUNTRIES: Portugal's parishes) has one unit per
  // piece, grouped by where it lies: as one unit, a parish touching wherever any of its pieces touches would join land
  // that does not join (Mangualde's municipality came out in five pieces). Elsewhere a unit's pieces stay one unit, which
  // keeps a district on both banks of an estuary (Halton, Widnes and Runcorn across the Mersey) one way across it.
  if (spec.pieces) units = units.flatMap(u => (u.polys.length < 2 ? [u] : u.polys.map((poly, k) => ({ ...u, id: k ? `${u.id}.${k}` : u.id, polys: [poly] }))));
  units = units.map(u => ({ ...u, bbox: bboxOf(u.polys) }));
  // The coarser levels, coarsest first: geoBoundaries', or Natural Earth's groups of a home nation's councils.
  const levels = [];
  for (const level of spec.levels.slice(0, -1)) {
    if (level.startsWith('NE:')) {
      const field = level.slice(3);
      levels.push(naturalEarthGroups(await source.naturalEarth(), spec, field, polysOf).map(r => ({ ...r, bbox: bboxOf(r.polys) })));
      layers.push({ iso3: spec.iso3, level: `Natural Earth admin-1 ${field}`, license: 'Public Domain',
        source: 'Natural Earth 1:10m Cultural Vectors, Admin 1 - States, Provinces (v5.1.2)', url: NE_URL, use: 'grouping' });
    } else {
      levels.push(await shapes(level));
      layers.push({ ...layerOf(rowAt(level)), use: 'grouping' });
    }
  }
  const topo = topology({ units: { type: 'FeatureCollection', features: units.map((u, i) => ({ type: 'Feature', id: i, properties: {}, geometry: multi(u.polys) })) } });
  const geoms = topo.objects.units.geometries;
  const adjacency = neighbors(geoms);
  const points = units.map(u => interiorPoint(u.polys)), areas = units.map(u => polysAreaKm2(u.polys));
  const assign = levels.map(list => points.map(point => memberIndex(list, point)));
  const moved = nestLevels(levels, assign, points, areas, adjacency);
  const tree = { key: spec.iso3, name: spec.iso3, members: [], children: new Map(), area: 0 };
  const pathOf = units.map(() => []);
  units.forEach((unit, i) => {
    let node = tree;
    node.members.push(i);
    node.area += areas[i];
    for (const key of [...levels.map((list, k) => list[assign[k][i]]), unit]) {
      if (!node.children.has(key.id)) node.children.set(key.id, { key: key.id, name: key.name, members: [], children: new Map(), area: 0 });
      node = node.children.get(key.id);
      node.members.push(i);
      node.area += areas[i];
      pathOf[i].push(node);
    }
  });
  log(`  ${shapeId} ${spec.iso3}${spec.part ? ` ${spec.part}` : ''}${spec.within ? ` within ${spec.within}` : ''}: ${units.length} ${unitLevel} units`
    + ` under ${levels.map((list, k) => `${new Set(assign[k]).size} ${spec.levels[k]}`).join(', ') || 'no region'}${moved ? ` (${moved} units moved to nest)` : ''}`);
  return { spec, units, geoms, topo, adjacency, tree, pathOf, layers, outside };
}

/**
 * The units a country's clubs grow over, each `{ id, name, members: [base unit], whole, zone }`, `zone` being the clubs (by
 * index) that may take it, or null for any. A region with at most one club stays whole, and one with no club goes whole to
 * whichever neighbour takes it, unless it is larger than a club's share; a region with two or more clubs is split one
 * level down between them, and only they may take its land. The same holds at every level below, down to the communes
 * (COUNTRIES): a province with one club goes whole to it, a commune with two is the one place a club's land is cut
 * between them (the partition's crowd cut). A region with one club is its start, and should that club start next door
 * (boxed in by its city), the region goes to one of its parent's clubs like a region with none. A city-state is too small
 * for its clubs and is first joined to its largest neighbouring region, whose land its clubs then share.
 */
function regionalUnits(country, homes) {
  const { units, adjacency, tree, pathOf } = country;
  const unitOfHome = homes.map(home => {
    const inside = units.findIndex(u => home[0] >= u.bbox[0] && home[0] <= u.bbox[2] && home[1] >= u.bbox[1] && home[1] <= u.bbox[3] && pointInPolys(home, u.polys));
    if (inside >= 0) return inside;
    let best = 0, bestKm = Infinity;
    units.forEach((u, i) => { const km = kmToPolys(home, u.polys); if (km < bestKm) { bestKm = km; best = i; } });
    return best;
  });
  const clubsIn = new Map();
  unitOfHome.forEach((unit, club) => {
    for (const node of pathOf[unit]) {
      if (!clubsIn.has(node)) clubsIn.set(node, []);
      clubsIn.get(node).push(club);
    }
  });
  const here = node => clubsIn.get(node) || [];
  const fair = tree.area / homes.length;
  const out = [];
  const emit = (node, zone) => out.push({ id: node.key, name: node.name, members: node.members, zone: zone ? new Set(zone) : null, whole: here(node).length < 2 });
  // An empty region next to a crowded one (two or more clubs, at the same level) is split one level down too, so that
  // crowd shares it: whole, it would go to the first club to reach it and shut the others in, to start far away (Moscow
  // Oblast around Moscow's clubs, Kocaeli and Tekirdağ around Istanbul's).
  const nextToCrowd = (node, depth) => node.members.some(u => adjacency[u].some(v => pathOf[v][depth] !== node && here(pathOf[v][depth]).length >= 2));
  // `forced`: a top region joined to another that holds clubs of its own, so its land is shared with the other's clubs too.
  const expand = (node, zone, forced, depth = 0) => {
    const clubs = here(node);
    const inner = forced ? zone : clubs.length ? { clubs, share: node.area / clubs.length } : zone;
    const tooLarge = !clubs.length && node.area > (depth ? FREE_LOWER : FREE_TOP) * (zone ? zone.share : fair);
    const split = clubs.length >= 2 || forced || tooLarge || (!clubs.length && node.children.size && nextToCrowd(node, depth));
    if (!node.children.size || !split) return emit(node, clubs.length >= 2 ? clubs : zone?.clubs);
    for (const child of node.children.values()) expand(child, inner, false, depth + 1);
    return null;
  };
  // Top regions, joined while one is too small for its clubs.
  const tops = [...tree.children.values()];
  // A country of one level (Moldova, Montenegro) has no regions to join. There, a unit with one neighbour goes with it (as
  // Blackpool would with Lancashire): alone, it would be shut in by whichever club took the larger one. England's counties
  // do this for its boroughs and cities (Nottingham goes whole with Nottinghamshire to their one club).
  if (country.spec.levels.length === 1) {
    const hostOf = u => {
      const around = [...new Set(adjacency[u])];
      return around.length === 1 && pathOf[u][0].area < pathOf[around[0]][0].area ? around[0] : u;
    };
    const rootOf = u => { const host = hostOf(u); return host === u ? u : rootOf(host); };
    const groups = new Map();
    units.forEach((_, u) => groups.set(rootOf(u), [...(groups.get(rootOf(u)) || []), u]));
    for (const [root, list] of groups) {
      const node = { key: pathOf[root][0].key, name: pathOf[root][0].name, members: list };
      clubsIn.set(node, list.flatMap(u => here(pathOf[u][0])));
      emit(node, null);
    }
    return out;
  }
  const topOf = new Map();
  tops.forEach((node, i) => node.members.forEach(u => topOf.set(u, i)));
  const groupOf = tops.map((_, i) => i);
  const members = tops.map((node, i) => [i]);
  const areaOf = g => members[g].reduce((sum, i) => sum + tops[i].area, 0);
  const clubsOf = g => members[g].reduce((sum, i) => sum + here(tops[i]).length, 0);
  const touching = g => {
    const seen = new Set();
    for (const i of members[g]) for (const u of tops[i].members) for (const v of adjacency[u]) {
      const other = groupOf[topOf.get(v)];
      if (other !== g) seen.add(other);
    }
    return [...seen];
  };
  for (let again = true; again;) {
    again = false;
    for (let g = 0; g < members.length; g++) {
      if (!members[g].length || !clubsOf(g) || areaOf(g) / clubsOf(g) >= TINY_REGION * fair) continue;
      const next = touching(g).sort((a, b) => areaOf(b) - areaOf(a) || a - b)[0];
      if (next == null) continue;
      for (const i of members[next]) groupOf[i] = g;
      members[g].push(...members[next]);
      members[next] = [];
      again = true;
    }
  }
  for (const group of members) {
    if (!group.length) continue;
    const clubs = group.flatMap(i => here(tops[i]));
    const zone = group.length > 1 && clubs.length ? { clubs, share: group.reduce((sum, i) => sum + tops[i].area, 0) / clubs.length } : null;
    for (const i of group) expand(tops[i], zone, !!zone && here(tops[i]).length > 0 && clubs.length > here(tops[i]).length, 0);
  }
  return out;
}

/** A country's land split between its clubs (strongest first), on its world outline: `{ land: [polys], unitCounts }`, one each per club. */
function splitCountry(country, shape, clubs, log) {
  const homes = clubs.map(club => club.home);
  const list = regionalUnits(country, homes);
  const rawUnits = list.map(unit => ({
    id: unit.id, name: unit.name, whole: unit.whole, zone: unit.zone,
    polys: polysOf(feature(country.topo, mergeArcs(country.topo, unit.members.map(i => country.geoms[i]))).geometry),
  }));
  const total = rawUnits.reduce((sum, unit) => sum + polysAreaKm2(unit.polys), 0);
  // Fans of whole units: a city's clubs each get a way out along the communes around it, and only a commune two of them
  // share is cut. A club boxed in by its city starts next door, on its region's land.
  const { units, topo, owner, shift, dropped, fans, movedStarts } = partitionCountry(rawUnits, homes, {
    sections: clubs.length, maxGapKm: MAX_GAP_KM, allowed: (club, unit) => !unit.zone || unit.zone.has(club),
    fair: { minKm2: Math.max(MIN_CLUB_KM2, MIN_SHARE * total / clubs.length) }, fan: 'units',
  });
  if (fans.length || movedStarts.length) log(`    ${shape.name}: fanned ${fans.map(fan => fan.members.map(c => clubs[c].name).join(' + ')).join('; ') || 'none'}; moved ${movedStarts.map(c => clubs[c].name).join(', ') || 'none'}`);
  if (shift) throw new Error(`${shape.name} crosses the antimeridian`);
  if (dropped.length) log(`    ${shape.name}: dropped overseas ${dropped.join(', ')}`);
  const strays = units.filter((unit, u) => unit.zone && !unit.zone.has(owner[u]));
  if (strays.length) log(`    ${shape.name}: ${strays.length} units went outside their region's clubs (${strays.slice(0, 4).map(u => u.name).join(', ')})`);
  const territories = dissolve(topo, owner, clubs.length).map(polysOf);
  // A territory is its units merged on their shared arcs: a merge that loses land (rings wound against each other, as the
  // ONS's were) stops the build.
  clubs.forEach((club, c) => {
    const want = units.reduce((sum, u, k) => sum + (owner[k] === c ? u.area : 0), 0), got = polysAreaKm2(territories[c]);
    if (Math.abs(got - want) > Math.max(5, 0.002 * want)) throw new Error(`${shape.name}: ${club.name}'s units hold ${Math.round(want)} km², merged ${Math.round(got)} km²`);
  });
  const all = polysOf(feature(topo, mergeArcs(topo, topo.objects.units.geometries)).geometry);
  const land = fitToOutline(territories, all, shape.polys, shape.name, country.outside, country.outside ? homes : null);
  absorbSpecks(land, homes);
  return { land, unitCounts: clubs.map((_, c) => owner.filter(o => o === c).length) };
}

const roundPolys = (polys, digits) => polys.map(poly => poly.map(ring => {
  const out = [];
  for (const [x, y] of ring) {
    const p = [Number(x.toFixed(digits)), Number(y.toFixed(digits))];
    if (!out.length || out.at(-1)[0] !== p[0] || out.at(-1)[1] !== p[1]) out.push(p);
  }
  return out;
})).map(poly => poly.filter(ring => ring.length >= 4)).filter(poly => poly.length);

/**
 * polygon-clipping can fail on near-coincident edges: such a subject (a territory's unit borders, the same on both its
 * sides) is retried rounded, to a centimetre and then a decimetre. The world outline always keeps its exact vertices.
 */
function clipAgainst(operation, subject, outline, first) {
  for (const digits of [null, 7, 6]) {
    const polys = digits == null ? subject : roundPolys(subject, digits);
    try {
      return first === 'outline' ? operation(outline, polys) : operation(polys, outline);
    } catch (error) {
      if (digits === 6) throw error;
    }
  }
  throw new Error('unreachable');
}

/**
 * Specks: a club's pieces of land that share a border go together, as the map merges them, and a group of them under
 * SPECK_KM2, apart from the club's largest and the one nearest its ground, whose outer edge lies against one other
 * club's land for at least half its length goes to that club. A unit in pieces (408 of Spain's municipalities, England's Great
 * Yarmouth on both banks of the Yare; Portugal's parishes are split into theirs, `pieces` in COUNTRIES) goes whole to
 * its region's club, its detached pieces with it, which would otherwise stand as specks in the next club's land; so
 * does an island off another club's shore whose channel the world outline's coarser coast fills, with that fill. A
 * piece off the coast touches no one and stays. Each pass judges every group against the land as it was, and the
 * passes go on while groups move, as one move can shut the next group in. Changes `land` in place.
 */
function absorbSpecks(land, homes) {
  for (let pass = 0; pass < SPECK_PASSES; pass++) {
    const moves = speckMoves(land, homes);
    if (!moves.length) return;
    const gone = land.map(() => new Set()), gained = land.map(() => []);
    for (const { from, pieces, to } of moves) {
      for (const k of pieces) {
        gone[from].add(k);
        gained[to].push(land[from][k]);
      }
    }
    land.forEach((polys, c) => { land[c] = [...polys.filter((_, k) => !gone[c].has(k)), ...gained[c]]; });
  }
}

/** One pass of absorbSpecks: the groups that go, `{ from: club, pieces: [index], to: club }`. */
function speckMoves(land, homes) {
  const against = edgeFinder(land, SPECK_EDGE_KM);
  const moves = [];
  land.forEach((polys, c) => {
    if (polys.length < 2) return;
    const areas = polys.map(polyAreaKm2);
    // The small pieces' outer edges, each with the pieces it lies against; a club's pieces that touch join one group.
    const root = polys.map((_, k) => k);
    const find = k => (root[k] === k ? k : (root[k] = find(root[k])));
    const edges = polys.map((poly, k) => {
      if (areas[k] >= SPECK_KM2) return [];
      const ring = poly[0], list = [];
      for (let i = 1; i < ring.length; i++) {
        const others = against([(ring[i - 1][0] + ring[i][0]) / 2, (ring[i - 1][1] + ring[i][1]) / 2], c, k);
        for (const [d, j] of others) if (d === c && find(j) !== find(k)) root[find(j)] = find(k);
        list.push({ km: kmBetween(ring[i - 1], ring[i]), clubs: new Set(others.map(([d]) => d)) });
      }
      return list;
    });
    const groups = new Map();
    polys.forEach((_, k) => {
      const r = find(k);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(k);
    });
    const list = [...groups.values()];
    const sizes = list.map(group => group.reduce((sum, k) => sum + areas[k], 0));
    const largest = sizes.indexOf(Math.max(...sizes));
    // The group nearest the club's ground stays, holding it or not: a ground can stand just outside its parish where the
    // outline moved the shore (Belenenses' Restelo), and a club boxed in by its city starts next door.
    let home = -1, homeKm = Infinity;
    if (homes[c]) {
      list.forEach((group, g) => {
        const km = kmToPolys(homes[c], group.map(k => polys[k]));
        if (km < homeKm) { homeKm = km; home = g; }
      });
    }
    list.forEach((group, g) => {
      if (g === largest || g === home || sizes[g] >= SPECK_KM2) return;
      let total = 0, best = -1, bestKm = 0;
      const along = new Map();
      for (const k of group) {
        for (const { km, clubs } of edges[k]) {
          if (clubs.has(c)) continue; // against another piece of the group: inside it
          total += km;
          for (const d of clubs) along.set(d, (along.get(d) || 0) + km);
        }
      }
      for (const [d, km] of along) if (km > bestKm) { bestKm = km; best = d; }
      if (total && bestKm >= 0.5 * total) moves.push({ from: c, pieces: group, to: best });
    });
  });
  return moves;
}

/**
 * The pieces of land whose edges pass within `km` of a point, by a grid of every ring's edges: `(point, club, piece)`
 * gives `[club, piece]` pairs, that piece itself left out.
 */
function edgeFinder(land, km) {
  const CELL = 0.02, PAD_X = 0.005, PAD_Y = 0.001; // degrees; PAD_X is 50 m of longitude up to 84°N
  const RAD = Math.PI / 180;
  const cellOf = (x, y) => Math.floor(x / CELL) * 100000 + Math.floor(y / CELL);
  const cells = new Map();
  land.forEach((polys, c) => polys.forEach((poly, k) => poly.forEach(ring => {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1], [x1, y1] = ring[i];
      const edge = { c, k, x0, y0, x1, y1 };
      for (let gx = Math.floor((Math.min(x0, x1) - PAD_X) / CELL); gx <= Math.floor((Math.max(x0, x1) + PAD_X) / CELL); gx++) {
        for (let gy = Math.floor((Math.min(y0, y1) - PAD_Y) / CELL); gy <= Math.floor((Math.max(y0, y1) + PAD_Y) / CELL); gy++) {
          const key = gx * 100000 + gy;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(edge);
        }
      }
    }
  })));
  return ([x, y], club, piece) => {
    const kx = Math.cos(y * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
    const found = new Map();
    for (const e of cells.get(cellOf(x, y)) ?? []) {
      if ((e.c === club && e.k === piece) || found.has(`${e.c}:${e.k}`)) continue;
      const ax = (e.x0 - x) * kx, ay = (e.y0 - y) * ky, dx = (e.x1 - e.x0) * kx, dy = (e.y1 - e.y0) * ky, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      if ((ax + t * dx) ** 2 + (ay + t * dy) ** 2 < km * km) found.set(`${e.c}:${e.k}`, [e.c, e.k]);
    }
    return [...found.values()];
  };
}

/**
 * Territories on a country's world outline: land outside it goes (the sources' coasts and borders differ), and each piece
 * of the outline they miss joins the nearest territory. So a country keeps the very borders the rest of the game draws.
 * One list of polygons per club: its land, then the pieces it joins, merged on their shared arcs with the whole map. A
 * country its clubs hold only part of (`outside`: the regions they may not hold) leaves out each missed piece that lies
 * nearer those regions than its clubs' land: Asian Russia, and the slivers along its borders, stay beneath the map.
 * There a missed piece holding clubs' grounds (`homes`, by club) goes to the nearest of those clubs, never beneath the
 * map: Moscow was one, a gap in Russia's districts, before loadCountry filled the federal cities from Russia's regions.
 */
function fitToOutline(territories, all, outline, name, outside = null, homes = null) {
  const land = territories.map(polys => clipAgainst(polygonClipping.intersection, polys, outline));
  const missed = clipAgainst(polygonClipping.difference, all, outline, 'outline');
  const extra = land.map(() => []);
  for (const piece of missed) {
    const at = interiorPoint([piece]);
    const grounds = homes ? homes.flatMap((home, i) => (pointInPolys(home, [piece]) ? [i] : [])) : [];
    if (!grounds.length && outside && kmToPolys(at, outside) < Math.min(...land.filter(polys => polys.length).map(polys => kmToPolys(at, polys)))) continue;
    let best = -1, bestKm = Infinity;
    land.forEach((polys, i) => {
      if (!polys.length || (grounds.length && !grounds.includes(i))) return;
      const km = kmToPolys(at, polys);
      if (km < bestKm) { bestKm = km; best = i; }
    });
    if (best < 0) throw new Error(`${name}: nothing to join a missed piece to`);
    extra[best].push(piece);
  }
  land.forEach((polys, i) => { if (!polys.length) throw new Error(`${name}: club ${i + 1} has no land on the outline`); });
  return land.map((polys, i) => [...polys, ...extra[i]]);
}

/** "Rome (Lazio)" where clubs share a town; a club named after its town keeps the plain name. */
function landNames(clubs) {
  const count = new Map();
  for (const club of clubs) count.set(club.city, (count.get(club.city) || 0) + 1);
  const label = club => club.name.replace(/\b(FC|CF|SK|JK|FK|AC|SC|CD|SD|UD|RC|RCD|CFC|SSC|SAD)\b\.?/g, '').replace(/\s+/g, ' ').trim() || club.name;
  const names = clubs.map(club => (count.get(club.city) === 1 || label(club) === club.city ? club.city : `${club.city} (${label(club)})`));
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  if (repeated) throw new Error(`Two clubs' land would be called ${repeated}`);
  return names;
}

async function buildMap({ source, spec, countries, splits, log }) {
  const { id: mapId, sport, league, theatre = null, seasons, clubs, ranked = true } = spec;
  const n = clubs.length;
  const byCountry = new Map();
  clubs.forEach((club, i) => {
    if (!byCountry.has(club.shape)) byCountry.set(club.shape, []);
    byCountry.get(club.shape).push(i);
  });
  const hosts = [...byCountry.keys()];
  const land = new Array(n), unitCount = new Array(n), shapes = new Map(), layers = [];
  for (const [shapeId, members] of byCountry) {
    const shape = await worldShape(source, shapeId);
    const within = !!COUNTRIES[shapeId]?.within;
    shapes.set(shapeId, shape);
    // A country's only club holds all of it, unless its clubs may hold only part of it (European Russia).
    if (members.length === 1 && !within) {
      land[members[0]] = shape.polys;
      unitCount[members[0]] = 1;
      continue;
    }
    const here = members.map(i => clubs[i]);
    const key = JSON.stringify([shapeId, here.map(club => [club.home])]);
    if (!splits.has(key)) {
      if (!countries.has(shapeId)) countries.set(shapeId, await loadCountry(source, shapeId, shape.polys, log));
      splits.set(key, splitCountry(countries.get(shapeId), shape, here, log));
      // Only the latest splits are kept, each at its units' full detail (France's communes): the same clubs recur in
      // seasons next to each other, and every one of the run's 98 maps would not fit in memory.
      while (splits.size > SPLITS_KEPT) splits.delete(splits.keys().next().value);
    }
    const split = splits.get(key);
    splits.delete(key);
    splits.set(key, split);
    members.forEach((i, k) => { land[i] = split.land[k]; unitCount[i] = split.unitCounts[k]; });
    layers.push(...countries.get(shapeId).layers);
    if (within) shapes.set(shapeId, partShape(shape, split.land));
  }
  // The world shapes of the countries the map holds only part of: the game draws them beneath it, grey where no club holds them.
  const partial = [...shapes].filter(([, shape]) => shape.partial).map(([shapeId]) => shapeId);

  // The world outlines' own vertices stay, so territories never part from the grey land beside them.
  const outlineVertices = new Set();
  for (const shape of shapes.values()) for (const poly of shape.outline ?? shape.polys) for (const ring of poly) for (const [x, y] of ring) outlineVertices.add(`${x},${y}`);
  // One polygon a piece: nodeRings gives every ring the vertices its neighbours cut it at, and a club's pieces then merge on shared arcs.
  const pieces = land.flatMap((polys, club) => polys.map(poly => ({ club, polys: [poly] })));
  nodeRings(pieces);
  const fitted = topology({ pieces: { type: 'FeatureCollection', features: pieces.map((piece, k) => ({ type: 'Feature', id: k, properties: {}, geometry: multi(piece.polys) })) } });
  const pieceGeoms = fitted.objects.pieces.geometries;
  const sectionGeoms = clubs.map((_, c) => feature(fitted, mergeArcs(fitted, pieceGeoms.filter((_, k) => pieces[k].club === c))).geometry);

  const ids = clubs.map((_, i) => `${mapId}-${String(i + 1).padStart(3, '0')}`);
  const names = landNames(clubs);
  const filtered = sectionTopology(sectionGeoms, { ids, names, unitCounts: unitCount, minAreaKm2: MIN_AREA_KM2, keepPoints: clubs.map(club => club.home) });

  const nearPolys = [...shapes.values()].flatMap(shape => shape.near);
  const nearBox = bboxOf(nearPolys);
  const pad = [(nearBox[2] - nearBox[0]) * 0.02, (nearBox[3] - nearBox[1]) * 0.02];
  const focus = [Math.floor((nearBox[0] - pad[0]) * 10) / 10, Math.floor((nearBox[1] - pad[1]) * 10) / 10,
    Math.ceil((nearBox[2] + pad[0]) * 10) / 10, Math.ceil((nearBox[3] + pad[1]) * 10) / 10].map(v => fixed(v));
  const projection = { lon0: fixed(round(circularMeanLon(nearPolys.map(poly => [centroidOf([poly])[0], polyAreaKm2(poly)])))), lat0: fixed(round((nearBox[1] + nearBox[3]) / 2)) };
  const sourceAreaKm2 = [...shapes.values()].reduce((sum, shape) => sum + polysAreaKm2(shape.polys), 0);
  const meta = {
    format: 1, id: mapId, name: 'Europe', sport, league, ...(theatre ? { theatre } : {}),
    ...(seasons ? { seasons } : {}),
    hosts, ...(partial.length ? { partial } : {}), version: '', projection, focus,
    boundaries: { provider: 'geoBoundaries', layers: dedupeLayers(layers), units: n, areaKm2: Math.round(sourceAreaKm2) },
  };
  const rows = clubs.map((club, i) => ({ id: club.id, ...(seasons ? { name: club.name } : {}), col: '', section: ids[i], home: club.home, shape: club.shape }));

  let target = POINT_TARGET, doc, text, qtopo;
  for (;;) {
    qtopo = quantize(simplifyTopology(filtered.topo, target, p => outlineVertices.has(`${p[0]},${p[1]}`)), 1e5);
    delete qtopo.bbox;
    const geoms = qtopo.objects.sections.geometries;
    const sectionPolys = geoms.map(g => polysOf(feature(qtopo, g).geometry));
    // Neighbouring clubs differ in colour, across a border or across water.
    const across = facingSections(sectionPolys, facingKm(focus));
    const clubAdj = clubs.map(() => new Set());
    neighbors(geoms).forEach((list, p) => { for (const j of [...list, ...across[p]]) if (j !== p) clubAdj[p].add(j); });
    const colours = colourSections(clubAdj.map(s => [...s].sort((a, b) => a - b)));
    rows.forEach((row, i) => { row.col = colours[i]; });
    doc = { ...meta, topology: qtopo, clubs: rows };
    doc.version = `${mapId}-${contentHash(doc)}`;
    text = serialize(doc);
    if (Buffer.byteLength(text) <= MAX_BYTES || target < 6000) break;
    target = Math.floor(target * 0.85);
  }

  // Verify with the game's own loader.
  const decoded = decodeDomestic(JSON.parse(text), mapId);
  const geoms = qtopo.objects.sections.geometries;
  const sectionPolys = geoms.map(g => polysOf(feature(qtopo, g).geometry));
  const areas = sectionPolys.map(polysAreaKm2);
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const areaDiff = (totalArea - sourceAreaKm2) / sourceAreaKm2;
  if (Math.abs(areaDiff) > 0.02) throw new Error(`${mapId}: section area ${Math.round(totalArea)} km² differs from the outlines' ${Math.round(sourceAreaKm2)} km² by ${(areaDiff * 100).toFixed(2)}%`);
  const landSplit = splitOnLand(geoms, ids.map((_, i) => i)).map(c => clubs[c].name);
  if (landSplit.length) log(`  split on land: ${landSplit.join(', ')}`);
  const km = clubs.map((club, i) => kmToPolys(club.home, sectionPolys[i]));
  const far = clubs.filter((_, i) => km[i] > 5).map(club => `${club.name} ${fixed(km[clubs.indexOf(club)])} km`);
  if (far.length) log(`  grounds outside their land: ${far.join(', ')}`);
  log(`  ${n} clubs in ${hosts.length} countries, ${arcPoints(qtopo)} arc points, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, ${Object.keys(decoded.sectionNames).length} sections decode`);
  for (const [shapeId, members] of byCountry) {
    const list = members.map(i => `${names[i]} ${Math.round(areas[i] / 1000)}k`).join(', ');
    log(`    ${shapes.get(shapeId).name}: ${list}`);
  }
  // A women's season's map serves that season alone, so it names its strongest clubs as the built-in maps do. An earlier
  // EuroLeague's may serve two seasons, so setup names the loaded season's own strongest, as an NBA era's map does. A
  // field not yet rated (`ranked` false: rugby union's before src/data/clubs.rugby-union.js) names none.
  const named = ranked && !(seasons && sport !== 'womens-football');
  const entry = { id: mapId, sport, league, name: 'Europe', ...(theatre ? { theatre } : {}), ...(seasons ? { seasons } : {}), clubs: n, sections: n, countries: hosts.length,
    version: doc.version, ...(named ? { top: clubs.slice(0, 3).map(club => club.name) } : {}) };
  return { entry, doc, file: outFile(mapId), text };
}

function dedupeLayers(layers) {
  const seen = new Map();
  for (const layer of layers) seen.set(`${layer.iso3}|${layer.level}`, layer);
  return [...seen.values()].sort((a, b) => (a.iso3 + a.level).localeCompare(b.iso3 + b.level));
}

function indexModule(entries) {
  return `// GENERATED by scripts/build-europe-maps.mjs from public/domestic/eu*.json, weu*.json, euroleague.json, el*.json and
// rugbyeurope.json; do not edit.
// The maps football clubs play on (docs/design/domestic-campaigns.md, "The Europe maps"): Europe's strongest clubs, each on
// land in its own country; women's football's (sport 'womens-football') every European club and its elite; and, with no
// \`theatre\`, basketball's EuroLeague clubs' and rugby union's European clubs' (sport 'rugby-union'). The setup
// offers a season's maps as its club theatres ('domestic:<id>'), and the loader fetches public/domestic/<id>.json on
// demand. A map with \`seasons\` is an earlier season's, played only with that season's clubs; one with \`replacedBy\` is an
// earlier season's map of before its clubs came from all of Europe, kept only for the campaigns saved on it.
// { id, sport, league, name, theatre? ('all' or 'elite'), seasons?, clubs, sections, countries, version, top?: three strongest clubs, replacedBy? }

export const EUROPE_MAPS = [
${entries.map(entry => `  ${JSON.stringify(entry)},`).join('\n')}
];
`;
}

function attributionText(entries, docs) {
  const lines = [
    'Europe maps (public/domestic/eu*.json, weu*.json, euroleague.json, el*.json and rugbyeurope.json)',
    'Generated by scripts/build-europe-maps.mjs; do not edit.',
    '',
    `Maps: ${entries.map(entry => entry.version).join(', ')}`,
    '',
    "Each country's outline is the game's world map (public/countries-50m.json: world-atlas 2.0.2, ISC; Natural Earth 1:50m,",
    'public domain). Borders between clubs inside a country are derived (dissolved, simplified, quantized) from the',
    'administrative boundary layers below, level by level down to the communes (scripts/lib/admin-levels.mjs): geoBoundaries\',',
    'Natural Earth\'s admin-1 groups for the home nations\' counties, and the ONS\'s districts for England. Each',
    'layer keeps its own licence.',
    '',
    'geoBoundaries (https://www.geoboundaries.org), gbOpen release, each file pinned to the commit in its URL:',
    `  ${GB_CITATION}`,
    'Club grounds: scripts/data/europe-clubs.json (from the country maps, public/domestic/ATTRIBUTION.txt, and by hand);',
    "rugby union's: scripts/data/rugby-union-clubs.json (each club's ground of 2025/26 by RugbyPass's fixtures, placed by",
    'hand and checked against Wikidata, CC0).',
  ];
  for (const layer of dedupeLayers(docs.flatMap(doc => doc.boundaries.layers))) {
    lines.push('', `${layer.iso3} ${layer.level}${layer.use === 'grouping' ? ' (only groups the units into regions)' : ''}`);
    lines.push(`  Source: ${layer.source}${layer.year ? ` (${layer.year})` : ''}`);
    lines.push(`  Licence: ${layer.license}`);
    lines.push(`  File: ${layer.url}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The maps to build: for the built-in season and each earlier season with clubs (src/data/footballSeasons.js), its
 * strongest TOP_CLUBS and ELITE_CLUBS clubs. FIFA 05, FIFA 06, 1989/90 and the computed seasons have nations only, so no maps. Then the
 * women's game's (src/data/womensFootballSeasons.js), from FIFA 23 on: every European club ('Europe', the NWSL's play on
 * a map of their own, scripts/build-club-maps.mjs) and the ELITE_CLUBS strongest of them, where there are more. Then the
 * EuroLeague's: the built-in season's, then one for each run of earlier seasons with the same clubs (el<year>, named after
 * the run's first season), serving the NBA seasons of those years. Last rugby union's European clubs (rugbyUnionField).
 */
async function mapSpecs() {
  const { clubs: places } = JSON.parse(await readFile(clubsFile, 'utf8'));
  const field = (list, count) => strongestClubs(list, count).map(club => {
    const place = places[club.id];
    if (!place) throw new Error(`No place for ${club.id} (${club.name}) in ${path.relative(root, clubsFile)}`);
    return { id: club.id, name: club.name, city: place.city, home: place.home, shape: place.shape ?? club.country };
  });
  const seasons = [{ tag: '', set: null, clubs: CLUBS }];
  for (const season of BUILT_IN_SEASONS) {
    const set = JSON.parse(await readFile(setFile(season.id), 'utf8'));
    if (!set.clubs.length) continue;
    // A season whose clubs come from all of Europe has maps of their own ids (eu124e2018), since 14 November 2026 (SWOS's
    // since 17 November 2026, once its other league files were read); one whose file held the seven big leagues alone
    // would keep its seven-league maps (eu124s1995, now replaced too).
    const allEurope = set.clubs.some(club => !BIG_LEAGUES.includes(club.league));
    seasons.push({ tag: `${allEurope ? 'e' : 's'}${season.year}`, set: season.id, clubs: set.clubs });
  }
  const women = [{ tag: '', set: null, clubs: WOMENS_CLUBS.filter(isEuropeanClub) }];
  for (const season of BUILT_IN_WOMENS_SEASONS) {
    const set = JSON.parse(await readFile(setFile(season.id, 'womens-football'), 'utf8'));
    const clubs = set.clubs.filter(isEuropeanClub);
    if (clubs.length) women.push({ tag: `s${season.year}`, set: season.id, clubs });
  }
  const rugbyUnion = await rugbyUnionField();
  return [
    ...seasons.flatMap(({ tag, set, clubs }) => [
      { id: `eu${TOP_CLUBS}${tag}`, sport: 'football', league: `Top ${TOP_CLUBS}`, theatre: 'all', seasons: set ? [set] : null, clubs: field(clubs, TOP_CLUBS) },
      { id: `eu${ELITE_CLUBS}${tag}`, sport: 'football', league: `Elite ${ELITE_CLUBS}`, theatre: 'elite', seasons: set ? [set] : null, clubs: field(clubs, ELITE_CLUBS) },
    ]),
    ...women.flatMap(({ tag, set, clubs }) => [
      { id: `weu${tag}`, sport: 'womens-football', league: 'Europe', theatre: 'all', seasons: set ? [set] : null, clubs: field(clubs, clubs.length) },
      ...(clubs.length > ELITE_CLUBS ? [{ id: `weu${ELITE_CLUBS}${tag}`, sport: 'womens-football', league: `Elite ${ELITE_CLUBS}`, theatre: 'elite',
        seasons: set ? [set] : null, clubs: field(clubs, ELITE_CLUBS) }] : []),
    ]),
    // The EuroLeague's whole league, strongest first, in the built-in season, then in each run of earlier seasons with
    // the same clubs (scripts/lib/euroleague-seasons.mjs), served with the NBA seasons of those years.
    { id: 'euroleague', sport: 'basketball', league: 'EuroLeague', seasons: null, clubs: field(EUROLEAGUE_CLUBS, EUROLEAGUE_CLUBS.length) },
    ...euroleagueSeasons(root).maps.map(map => ({ id: map.id, sport: 'basketball', league: 'EuroLeague', seasons: map.years.map(nbaSeasonOf),
      clubs: field(map.clubs, map.clubs.length) })),
    // Rugby union's European clubs of 2025/26, the built-in season's only.
    { id: 'rugbyeurope', sport: 'rugby-union', league: 'European clubs', seasons: null, ranked: rugbyUnion.ranked, clubs: rugbyUnion.clubs },
  ];
}

/**
 * Rugby union's European clubs (docs/design/rugby-union.md): every club of scripts/data/rugby-union-clubs.json but the
 * URC's South African sides (`europe: false`), at its ground (`at`, [latitude, longitude]), its land named after its
 * `home`. Strongest first once src/data/clubs.rugby-union.js rates them (`ranked`); until then by name, and the map names
 * no strongest three.
 */
async function rugbyUnionField() {
  const { clubs } = JSON.parse(await readFile(rugbyUnionFile, 'utf8'));
  const places = new Map(Object.values(clubs).filter(club => club.europe !== false).map(club => [club.id, club]));
  const rated = existsSync(rugbyUnionRatings) ? (await import(pathToFileURL(rugbyUnionRatings).href)).CLUBS : null;
  const unrated = rated ? [...places.keys()].filter(id => !rated.some(club => club.id === id)) : [];
  if (unrated.length) throw new Error(`${path.relative(root, rugbyUnionRatings)} rates no ${unrated.join(', ')}`);
  const list = rated ? strongestClubs(rated.filter(club => places.has(club.id)), places.size)
    : [...places.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return {
    ranked: !!rated,
    clubs: list.map(club => {
      const { home, at, country } = places.get(club.id);
      return { id: club.id, name: club.name, city: home, home: [at[1], at[0]], shape: country };
    }),
  };
}

/** The built-in NBA season a EuroLeague season is played beside (2009/10's: NBA 2K10). */
function nbaSeasonOf(year) {
  const season = BUILT_IN_BASKETBALL_SEASONS.find(entry => entry.year === gameYearOf(year));
  if (!season) throw new Error(`No basketball season of ${gameYearOf(year)} for the EuroLeague of ${year}/${String(year + 1).slice(2)}`);
  return season.id;
}

async function main() {
  const argv = process.argv.slice(2), args = new Set(argv);
  const check = args.has('--check'), dryRun = args.has('--dry-run');
  const only = argv.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',') ?? null;
  const boundaries = argv.find(a => a.startsWith('--boundaries='))?.slice('--boundaries='.length);
  const log = line => console.log(line);
  const started = Date.now();
  const source = createBoundarySource({ cacheDir: boundaries ? path.resolve(boundaries) : cacheDir, worldFile, offline: check, log });
  const specs = await mapSpecs();
  const unknown = only?.filter(id => !specs.some(spec => spec.id === id));
  if (unknown?.length) throw new Error(`Unknown maps: ${unknown.join(', ')}`);
  const previous = existsSync(indexFile) ? (await import(pathToFileURL(indexFile).href)).EUROPE_MAPS : [];
  const countries = new Map(), splits = new Map(), outputs = new Map(), built = new Map();
  for (const spec of specs) {
    if (only && !only.includes(spec.id)) continue;
    log(`${spec.id}: ${spec.clubs.length} clubs${spec.seasons ? ` of ${spec.seasons.join(', ')}` : ''}`);
    const { entry, doc, file, text } = await buildMap({ source, spec, countries, splits, log });
    built.set(spec.id, { entry, doc });
    outputs.set(file, text);
  }
  // A season's map the specs no longer make (its seven-league map of before, eu124s2018) stays, never rebuilt, for the
  // campaigns saved on it: its entry names the map of the same season and theatre that replaced it (`replacedBy`).
  const sameField = (spec, entry) => spec.sport === entry.sport && spec.theatre === entry.theatre && !!entry.seasons
    && JSON.stringify(spec.seasons) === JSON.stringify(entry.seasons);
  const retired = previous.filter(entry => !specs.some(spec => spec.id === entry.id)).map(entry => {
    const next = specs.find(spec => sameField(spec, entry));
    if (!next) throw new Error(`${entry.id} is in the index, but no map of the specs makes it or replaces it`);
    return { ...entry, replacedBy: next.id };
  });
  const entries = [...specs.map(spec => built.get(spec.id)?.entry ?? previous.find(entry => entry.id === spec.id)).filter(Boolean), ...retired];
  outputs.set(indexFile, indexModule(entries));
  const docs = [];
  for (const entry of entries) {
    const made = built.get(entry.id)?.doc;
    if (made) docs.push(made);
    else docs.push(JSON.parse(await readFile(outFile(entry.id), 'utf8')));
  }
  outputs.set(attributionFile, attributionText(entries, docs));
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) {
      for (const file of differs) console.error(`differs: ${file}`);
      process.exit(1);
    }
    log(`Verified ${built.size} Europe maps, their index and attribution byte for byte in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } else if (!dryRun) {
    for (const [file, text] of outputs) await writeFile(file, text);
    log(`Wrote ${built.size} Europe maps, their index and attribution in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  }
}

await main();
