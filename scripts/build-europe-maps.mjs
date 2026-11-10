// The maps Europe's football clubs play on (docs/design/domestic-campaigns.md, "The Europe maps"): one for the strongest
// TOP_CLUBS and one for the strongest ELITE_CLUBS, for the built-in season and for each earlier EA season; and the one
// the EuroLeague's basketball clubs play on (docs/design/euroleague.md), all of its clubs, by the same rules. A club holds
// land only in its own country. A country's only club holds all of it; several clubs share it along its regional
// borders, a region going whole to one club unless it holds two or more (then its next level down is split between
// them); a country with no club is not on the map at all, so it stays grey beneath it, like any neighbour of a country map.
//
// Usage:
//   node scripts/build-europe-maps.mjs [--only=eu124,eu32] [--check | --dry-run]
//     --only     build these maps (eu124, eu32s2018, euroleague…); the index keeps the others' entries as they are
//     --check    rebuild offline from the caches and compare every output byte for byte
//     --dry-run  build and verify (downloading boundaries as needed) but write nothing
//
// Inputs:  the clubs in src/data/clubs.football.js, public/football/ea-*.json and src/data/clubs.euroleague.js; where they stand, in
//          scripts/data/europe-clubs.json; geoBoundaries gbOpen layers, cached under the gitignored data-src/boundaries/;
//          the game's world map public/countries-50m.json, whose outlines every country keeps, so territories meet
//          each other and the grey neighbours on the very borders the rest of the game draws.
// Outputs: public/domestic/eu<clubs>[s<season year>].json, public/domestic/euroleague.json,
//          public/domestic/ATTRIBUTION-europe.txt and src/data/europeMaps.js.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import polygonClipping from 'polygon-clipping';
import { topology } from 'topojson-server';
import { feature, mergeArcs, neighbors } from 'topojson-client';
import { CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as EUROLEAGUE_CLUBS } from '../src/data/clubs.euroleague.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { ELITE_CLUBS, TOP_CLUBS, strongestClubs } from '../src/data/scopes.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { createBoundarySource, GB_CITATION } from './lib/domestic-boundaries.mjs';
import { colourSections, contentHash, serialize } from './lib/domestic-output.mjs';
import {
  arcPoints, bboxOf, centroidOf, dissolve, facingKm, facingSections, interiorPoint, kmBetween, kmToPolys, nodeRings, OVERSEAS_KM,
  partitionCountry, pointInPolys, polyAreaKm2, polysAreaKm2, polysOf, quantize, sectionTopology, simplifyTopology, splitOnLand,
} from './lib/domestic-partition.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = id => path.join(root, `public/domestic/${id}.json`);
const attributionFile = path.join(root, 'public/domestic/ATTRIBUTION-europe.txt');
const indexFile = path.join(root, 'src/data/europeMaps.js');
const clubsFile = path.join(root, 'scripts/data/europe-clubs.json');
const cacheDir = path.join(root, 'data-src/boundaries');
const worldFile = path.join(root, 'public/countries-50m.json');
const setFile = id => path.join(root, `public/football/${id}.json`);

/**
 * Each country a club may share, by its world shape: its geoBoundaries layer (`iso3`, `part` of it for the home nations),
 * the finest level the split may follow (`units`) and the levels that group those units into regions, coarsest first. A
 * country with one club in every field needs none: it holds its whole world shape.
 */
const COUNTRIES = {
  826: { iso3: 'GBR', part: 'GB-ENG', units: 'ADM2', regions: [] },
  SCO: { iso3: 'GBR', part: 'GB-SCT', units: 'ADM2', regions: [] },
  WAL: { iso3: 'GBR', part: 'GB-WLS', units: 'ADM2', regions: [] },
  724: { iso3: 'ESP', units: 'ADM3', regions: ['ADM1', 'ADM2'] },
  380: { iso3: 'ITA', units: 'ADM4', regions: ['ADM2', 'ADM3'] },
  276: { iso3: 'DEU', units: 'ADM3', regions: ['ADM1', 'ADM2'] },
  250: { iso3: 'FRA', units: 'ADM3', regions: ['ADM1', 'ADM2'] },
  528: { iso3: 'NLD', units: 'ADM2', regions: ['ADM1'] },
  620: { iso3: 'PRT', units: 'ADM2', regions: ['ADM1'] },
  792: { iso3: 'TUR', units: 'ADM2', regions: ['ADM1'] },
  '056': { iso3: 'BEL', units: 'ADM4', regions: ['ADM1', 'ADM2', 'ADM3'] },
  300: { iso3: 'GRC', units: 'ADM3', regions: ['ADM1', 'ADM2'] },
  203: { iso3: 'CZE', units: 'ADM2', regions: ['ADM1'] },
  208: { iso3: 'DNK', units: 'ADM2', regions: ['ADM1'] },
  804: { iso3: 'UKR', units: 'ADM2', regions: ['ADM1'] },
  // The EuroLeague's: Belgrade's two clubs and Tel Aviv's two. Each city is one unit, so it joins a neighbouring region.
  688: { iso3: 'SRB', units: 'ADM2', regions: ['ADM1'] },
  376: { iso3: 'ISR', units: 'ADM2', regions: ['ADM1'] },
};
// A region whose clubs would each have under this share of the country's land per club is too small to hold them (a
// city-state: Berlin, Bremen, Madrid), so it is shared with its largest neighbouring region. A top region with no club is
// split where it is larger than FREE_TOP clubs' share, and anything below that where it is larger than FREE_LOWER, or
// the lucky neighbour would take far more than the others.
const TINY_REGION = 0.25;
const FREE_TOP = 0.25;
const FREE_LOWER = 1;
// A club may start this far from its ground before the unit it shares with a stronger club is cut between them.
const MAX_GAP_KM = 3;
// Land near a country's main landmass is framed by the opening camera; the Canaries, the Azores and Svalbard wait for a zoom out.
const FOCUS_KM = 300;
// Islets under this are cuts between two sources' coasts, not land: they go unless they hold a ground.
const MIN_AREA_KM2 = 5;
// Land farther than this outside a country's world outline is below its 1:50m detail (Porto Santo): no club can hold it there.
const OUTLINE_KM = 5;
// The land a club needs, per the partition's fair rules: this share of the country's land per club, and about 35 km
// across (6 px at the Europe map's opening fit). A club that cannot find it around its ground starts next door: Galatasaray
// across the Bosphorus, as Thrace is a thirtieth of Turkey. Asking for less leaves such clubs slivers; for more, far from home.
const MIN_SHARE = 0.1;
const MIN_CLUB_KM2 = 1200;
const POINT_TARGET = 16000;
const MAX_BYTES = 250000;

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

/** A country's world shape without its far overseas land (French Guiana, the Dutch Caribbean): `{ polys, near }`, `near` the land the camera frames. */
async function worldShape(source, shapeId) {
  const shape = (await source.world()).find(s => s.key === shapeId);
  if (!shape) throw new Error(`No world shape ${shapeId}`);
  const areas = shape.polys.map(polyAreaKm2);
  const main = shape.polys[areas.indexOf(Math.max(...areas))];
  const at = centroidOf([main]);
  const polys = shape.polys.filter(poly => kmBetween(centroidOf([poly]), at) <= OVERSEAS_KM);
  const near = polys.filter(poly => poly === main || kmToPolys(centroidOf([poly]), [main]) <= FOCUS_KM);
  return { name: shape.name, polys, near };
}

const memberOf = (list, point) => {
  const hit = list.find(item => point[0] >= item.bbox[0] && point[0] <= item.bbox[2] && point[1] >= item.bbox[1] && point[1] <= item.bbox[3] && pointInPolys(point, item.polys));
  return hit ?? list.reduce((best, item) => (!best || kmToPolys(point, item.polys) < kmToPolys(point, best.polys) ? item : best), null);
};

/**
 * A country's admin units on one topology, with the tree of regions above them: `{ units, geoms, topo, adjacency, tree,
 * pathOf, layers }`. A region node is `{ key, name, members: [unit], children: Map, area }`, a unit a node without children;
 * `pathOf[unit]` lists the nodes from the top region down to the unit's own. Land the world `outline` leaves out is not among them.
 */
async function loadCountry(source, shapeId, outline, log) {
  const spec = COUNTRIES[shapeId];
  if (!spec) throw new Error(`Clubs share ${shapeId}, which has no layers in COUNTRIES`);
  const rows = await source.layers(spec.iso3);
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
  let units = await shapes(spec.units);
  const layers = [{ ...layerOf(rowAt(spec.units)), use: 'units' }];
  if (spec.part) {
    const parts = await shapes('ADM1');
    if (!parts.some(p => p.iso === spec.part)) throw new Error(`No ${spec.part} in ${spec.iso3} ADM1`);
    units = units.filter(u => memberOf(parts, interiorPoint(u.polys)).iso === spec.part);
    layers.push({ ...layerOf(rowAt('ADM1')), use: 'grouping' });
  }
  const onOutline = poly => {
    const point = interiorPoint([poly]);
    return pointInPolys(point, outline) || kmToPolys(point, outline) <= OUTLINE_KM;
  };
  units = units.map(u => ({ ...u, polys: u.polys.filter(onOutline) })).filter(u => u.polys.length).map(u => ({ ...u, bbox: bboxOf(u.polys) }));
  const levels = [];
  for (const level of spec.regions) {
    levels.push(await shapes(level));
    layers.push({ ...layerOf(rowAt(level)), use: 'grouping' });
  }
  const topo = topology({ units: { type: 'FeatureCollection', features: units.map((u, i) => ({ type: 'Feature', id: i, properties: {}, geometry: multi(u.polys) })) } });
  const geoms = topo.objects.units.geometries;
  const adjacency = neighbors(geoms);
  const tree = { key: spec.iso3, name: spec.iso3, members: [], children: new Map(), area: 0 };
  const pathOf = units.map(() => []);
  units.forEach((unit, i) => {
    const point = interiorPoint(unit.polys), area = polysAreaKm2(unit.polys);
    let node = tree;
    node.members.push(i);
    node.area += area;
    for (const key of [...levels.map(list => memberOf(list, point)), unit]) {
      if (!node.children.has(key.id)) node.children.set(key.id, { key: key.id, name: key.name, members: [], children: new Map(), area: 0 });
      node = node.children.get(key.id);
      node.members.push(i);
      node.area += area;
      pathOf[i].push(node);
    }
  });
  log(`  ${shapeId} ${spec.iso3}${spec.part ? ` ${spec.part}` : ''}: ${units.length} ${spec.units} units in ${tree.children.size} top regions`);
  return { spec, units, geoms, topo, adjacency, tree, pathOf, layers };
}

/**
 * The units a country's clubs grow over, each `{ id, name, members: [base unit], whole, zone }`, `zone` being the clubs (by
 * index) that may take it, or null for any. A region with at most one club stays whole, and one with no club goes whole to
 * whichever neighbour takes it, unless it is larger than a club's share; a region with two or more clubs is split one
 * level down between them, and only they may take its land. A city-state is too small for its clubs and is first joined to
 * its largest neighbouring region, whose land its clubs then share.
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
  // `forced`: a top region joined to another that holds clubs of its own, so its land is shared with the other's clubs too.
  const expand = (node, zone, forced, top = false) => {
    const clubs = here(node);
    const inner = forced ? zone : clubs.length ? { clubs, share: node.area / clubs.length } : zone;
    const tooLarge = !clubs.length && node.area > (top ? FREE_TOP : FREE_LOWER) * (zone ? zone.share : fair);
    if (!node.children.size || !(clubs.length >= 2 || forced || tooLarge)) return emit(node, clubs.length ? clubs : zone?.clubs);
    for (const child of node.children.values()) expand(child, inner, false);
    return null;
  };
  // Top regions, joined while one is too small for its clubs.
  const tops = [...tree.children.values()];
  // Flat countries (England) have no regions to join. There, a unit with one neighbour goes with it (Blackpool with
  // Lancashire, Nottingham with its county): alone, it would be shut in by whichever club took the larger one.
  if (!country.spec.regions.length) {
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
    for (const i of group) expand(tops[i], zone, !!zone && here(tops[i]).length > 0 && clubs.length > here(tops[i]).length, true);
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
  const { units, topo, owner, shift, dropped, fans, movedStarts } = partitionCountry(rawUnits, homes, {
    sections: clubs.length, maxGapKm: MAX_GAP_KM, allowed: (club, unit) => !unit.zone || unit.zone.has(club),
    fair: { minKm2: Math.max(MIN_CLUB_KM2, MIN_SHARE * total / clubs.length) },
  });
  if (fans.length || movedStarts.length) log(`    ${shape.name}: fanned ${fans.map(fan => fan.members.map(c => clubs[c].name).join(' + ')).join('; ') || 'none'}; moved ${movedStarts.map(c => clubs[c].name).join(', ') || 'none'}`);
  if (shift) throw new Error(`${shape.name} crosses the antimeridian`);
  if (dropped.length) log(`    ${shape.name}: dropped overseas ${dropped.join(', ')}`);
  const strays = units.filter((unit, u) => unit.zone && !unit.zone.has(owner[u]));
  if (strays.length) log(`    ${shape.name}: ${strays.length} units went outside their region's clubs (${strays.slice(0, 4).map(u => u.name).join(', ')})`);
  const territories = dissolve(topo, owner, clubs.length).map(polysOf);
  const all = polysOf(feature(topo, mergeArcs(topo, topo.objects.units.geometries)).geometry);
  return { land: fitToOutline(territories, all, shape.polys, shape.name), unitCounts: clubs.map((_, c) => owner.filter(o => o === c).length) };
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
 * Territories on a country's world outline: land outside it goes (the sources' coasts and borders differ), and each piece
 * of the outline they miss joins the nearest territory. So a country keeps the very borders the rest of the game draws.
 * One list of polygons per club: its land, then the pieces it joins, merged on their shared arcs with the whole map.
 */
function fitToOutline(territories, all, outline, name) {
  const land = territories.map(polys => clipAgainst(polygonClipping.intersection, polys, outline));
  const missed = clipAgainst(polygonClipping.difference, all, outline, 'outline');
  const extra = land.map(() => []);
  for (const piece of missed) {
    const at = interiorPoint([piece]);
    let best = -1, bestKm = Infinity;
    land.forEach((polys, i) => { if (polys.length) { const km = kmToPolys(at, polys); if (km < bestKm) { bestKm = km; best = i; } } });
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
  const { id: mapId, sport = 'football', league, theatre = null, seasons, clubs } = spec;
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
    shapes.set(shapeId, shape);
    if (members.length === 1) {
      land[members[0]] = shape.polys;
      unitCount[members[0]] = 1;
      continue;
    }
    const here = members.map(i => clubs[i]);
    const key = JSON.stringify([shapeId, here.map(club => [club.home])]);
    if (!splits.has(key)) {
      if (!countries.has(shapeId)) countries.set(shapeId, await loadCountry(source, shapeId, shape.polys, log));
      splits.set(key, splitCountry(countries.get(shapeId), shape, here, log));
    }
    const split = splits.get(key);
    members.forEach((i, k) => { land[i] = split.land[k]; unitCount[i] = split.unitCounts[k]; });
    layers.push(...countries.get(shapeId).layers);
  }

  // The world outlines' own vertices stay, so territories never part from the grey land beside them.
  const outlineVertices = new Set();
  for (const shape of shapes.values()) for (const poly of shape.polys) for (const ring of poly) for (const [x, y] of ring) outlineVertices.add(`${x},${y}`);
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
    hosts, version: '', projection, focus,
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
  const entry = { id: mapId, sport, league, name: 'Europe', ...(theatre ? { theatre } : {}), ...(seasons ? { seasons } : {}), clubs: n, sections: n, countries: hosts.length,
    version: doc.version, ...(seasons ? {} : { top: clubs.slice(0, 3).map(club => club.name) }) };
  return { entry, doc, file: outFile(mapId), text };
}

function dedupeLayers(layers) {
  const seen = new Map();
  for (const layer of layers) seen.set(`${layer.iso3}|${layer.level}`, layer);
  return [...seen.values()].sort((a, b) => (a.iso3 + a.level).localeCompare(b.iso3 + b.level));
}

function indexModule(entries) {
  return `// GENERATED by scripts/build-europe-maps.mjs from public/domestic/eu*.json and euroleague.json; do not edit.
// The maps football clubs play on (docs/design/domestic-campaigns.md, "The Europe maps"): Europe's strongest clubs, each on
// land in its own country. The setup offers a season's two as its club theatres ('domestic:<id>'), and the loader fetches
// public/domestic/<id>.json on demand. A map with \`seasons\` is an earlier season's, played only with that season's clubs.
// Basketball's EuroLeague plays on one by the same rules, with no \`theatre\` (docs/design/euroleague.md).
// { id, sport, league, name, theatre? ('all' or 'elite'), seasons?, clubs, sections, countries, version, top?: three strongest clubs }

export const EUROPE_MAPS = [
${entries.map(entry => `  ${JSON.stringify(entry)},`).join('\n')}
];
`;
}

function attributionText(entries, docs) {
  const lines = [
    'Europe maps (public/domestic/eu*.json)',
    'Generated by scripts/build-europe-maps.mjs; do not edit.',
    '',
    `Maps: ${entries.map(entry => entry.version).join(', ')}`,
    '',
    "Each country's outline is the game's world map (public/countries-50m.json: world-atlas 2.0.2, ISC; Natural Earth 1:50m,",
    'public domain). Borders between clubs inside a country are derived (dissolved, simplified, quantized) from the',
    'administrative boundary layers below; each layer keeps its own licence.',
    '',
    'geoBoundaries (https://www.geoboundaries.org), gbOpen release, each file pinned to the commit in its URL:',
    `  ${GB_CITATION}`,
    'Club grounds: scripts/data/europe-clubs.json (from the country maps, public/domestic/ATTRIBUTION.txt, and by hand).',
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
 * The maps to build: for the built-in season and each earlier EA season with clubs, its strongest TOP_CLUBS and
 * ELITE_CLUBS clubs (FIFA 05 and FIFA 06 have nations only, so no maps); then the EuroLeague's.
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
    if (set.clubs.length) seasons.push({ tag: `s${season.year}`, set: season.id, clubs: set.clubs });
  }
  return [
    ...seasons.flatMap(({ tag, set, clubs }) => [
      { id: `eu${TOP_CLUBS}${tag}`, league: `Top ${TOP_CLUBS}`, theatre: 'all', seasons: set ? [set] : null, clubs: field(clubs, TOP_CLUBS) },
      { id: `eu${ELITE_CLUBS}${tag}`, league: `Elite ${ELITE_CLUBS}`, theatre: 'elite', seasons: set ? [set] : null, clubs: field(clubs, ELITE_CLUBS) },
    ]),
    // The EuroLeague's whole league, strongest first, in the built-in season only.
    { id: 'euroleague', sport: 'basketball', league: 'EuroLeague', seasons: null, clubs: field(EUROLEAGUE_CLUBS, EUROLEAGUE_CLUBS.length) },
  ];
}

async function main() {
  const argv = process.argv.slice(2), args = new Set(argv);
  const check = args.has('--check'), dryRun = args.has('--dry-run');
  const only = argv.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',') ?? null;
  const log = line => console.log(line);
  const started = Date.now();
  const source = createBoundarySource({ cacheDir, worldFile, offline: check, log });
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
  const entries = specs.map(spec => built.get(spec.id)?.entry ?? previous.find(entry => entry.id === spec.id)).filter(Boolean);
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
