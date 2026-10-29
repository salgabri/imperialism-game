// Stage 2 of domestic campaigns (docs/design/domestic-campaigns.md): committed club
// snapshots plus admin boundaries become a country's map of DOMESTIC_SECTIONS (100)
// sections, each club starting on a group of them (one each when there are 100 clubs).
//
// Usage:
//   node scripts/build-domestic.mjs [--only=826,724] [--jobs=8] [--check | --dry-run]
//     --only     limit to these nation ids (default: every snapshot in scripts/data/domestic/)
//     --jobs     countries built at once in worker threads (default: up to 8); the output
//                does not depend on it, and downloads still go one at a time
//     --check    rebuild offline from the caches and compare every output byte for byte
//     --dry-run  build and verify (downloading boundaries as needed) but write nothing
//
// Inputs:  scripts/data/domestic/<id>.json (stage 1 snapshots), geoBoundaries gbOpen
//          layers, Natural Earth admin-1 and GeoNames places (names, homes for clubs without
//          one), cached under the gitignored data-src/boundaries/, and the game's world map
//          public/countries-50m.json (land it gives to other countries is cut).
// Outputs: public/domestic/<id>.json (format 2), public/domestic/ATTRIBUTION.txt,
//          src/data/domestic.js (index for the setup screen), docs/design/domestic-audit.json.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import path from 'node:path';
import { feature, neighbors } from 'topojson-client';
import { buildClub, selectLineup } from '../src/data/teams.js';
import { expandFmTuple, FM_CONVERSION, FM_ORIGIN } from '../src/data/fmPlayers.js';
import { decodeDomestic, DOMESTIC_FORMAT, DOMESTIC_SECTIONS } from '../src/engine/domestic.js';
import { colourSections, contentHash, serialize } from './lib/domestic-output.mjs';
import { createBoundarySource, createDownloader, createNamer, GB_CITATION, GN_CITATION, sameName } from './lib/domestic-boundaries.mjs';
import {
  arcPoints, baseId, bboxOf, components, dissolve, facingKm, facingSections, kmBetween, kmToPolys, partitionCountry, pointInPolys, polysAreaKm2,
  quantileOf, quantize, sectionTopology, simplifyTopology, splitOnLand,
} from './lib/domestic-partition.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshotDir = path.join(root, 'scripts/data/domestic');
const outDir = path.join(root, 'public/domestic');
const indexFile = path.join(root, 'src/data/domestic.js');
const auditFile = path.join(root, 'docs/design/domestic-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
const cacheDir = path.join(root, 'data-src/boundaries');
const worldFile = path.join(root, 'public/countries-50m.json');
const SNAPSHOT = /^(\d{3}|KOS)\.json$/;
const REGIONAL = 'Regional football';
const MAX_BYTES = 250000;
const POINT_TARGET = 14000; // arc points per country; lowered when the file would exceed MAX_BYTES
// Fewer cities1000 places than this many per extra section count as sparse.
const SPARSE_PLACES = 3;
// GeoNames populated places that are places today (not sections of one, abandoned, historical or destroyed).
const VILLAGE_CODES = /^PPL(A\d?|C|G|L|R|S|F)?$/;

// A worker thread collects a country's lines; the main thread prints them as one block.
let logSink = line => console.log(line);
const log = (...parts) => logSink(format(...parts));

// ---- Club presentation ----

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[Þþ]/g, 'Th').replace(/[Ðð]/g, 'D').replace(/[Ææ]/g, 'Ae').replace(/[Øø]/g, 'O').replace(/ß/g, 'ss')
  .replace(/[Łł]/g, 'L').replace(/[Ğğ]/g, 'G').replace(/ı/g, 'i').replace(/[Œœ]/g, 'Oe');

// Words for a club's kind or legal form (FC, VfB, Clube, Atlético, Calcio...), skipped
// in codes while other words remain.
const GENERIC_WORDS = new Set(('fc cf ac sc as ss us afc fk nk sk bk ik if ff kv krc kaa rsc cd ca ce cr ec se sd ud ad sad rcd sv tsv '
  + 'vfb vfl vfr fsv ssv tus sg ksv bsc spvgg fv jk pfc ofk gd cs csd csm acs acsm scm sa aa ae ao aps ags apo gs gss gfs nps mgs ps '
  + 'pgs mfaof of pae gks mks lks ks mfk tj sfc hnk gnk onk hsk ifk gif kf fsk gfk fcv cfc club clube clubul calcio deportivo '
  + 'deportiva deportes atletico atletica associazione associacao asociacion sportiva sportivo sportverein sportclub sportklub '
  + 'football futbol futebol fussball fussballclub fotbal futball labdarugo klub kulubu fudbalski nogometni de do da das dos del '
  + 'della di la le el los las of the und and y e et').split(' '));

/**
 * Short scoreboard code, in letters: an acronym the club goes by (PSV, ADO, CFR), then
 * the scripts/build-clubs.mjs rules on its distinctive words (generic words, years and
 * club numbers left out: Bayer 04 Leverkusen is BLE, not B0L), then the first letter with
 * two later ones, word starts and consonants first. A club number reads well only as
 * in S04 or H96, so it comes after those, and never as padding.
 */
function makeCode(rawName, taken) {
  const name = fold(rawName).replace(/\b([A-Z])\.(?=[A-Z]\b)/g, '$1'); // N.E.C. -> NEC.
  const tokens = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const all = tokens.filter(w => /^[A-Za-z]{2,}$/.test(w));
  const words = all.filter(w => !GENERIC_WORDS.has(w.toLowerCase()));
  const use = words.length ? words : all.length ? all : [name.replace(/[^A-Za-z]/g, '') || 'Club'];
  const candidates = [];
  if (/^[A-Z]{3,5}$/.test(use[0]) && words.length) candidates.push(use[0].slice(0, 3));
  if (use.length >= 3) candidates.push(use.slice(0, 3).map(w => w[0]).join(''));
  if (use.length >= 2) candidates.push(use[0][0] + use[1].slice(0, 2), use[0].slice(0, 2) + use[1][0]);
  candidates.push(use[0].slice(0, 3));
  // First letter plus two later ones; letters that start a word, then consonants, first.
  const patterns = list => {
    const letters = list.join('');
    const starts = new Set(list.map((_, k) => list.slice(0, k).join('').length));
    const rank = [...letters].map((ch, i) => (starts.has(i) ? 0 : /[aeiouy]/i.test(ch) ? 2 : 1));
    const out = [];
    for (let i = 1; i < letters.length; i++) for (let j = i + 1; j < letters.length; j++) out.push([rank[i] + rank[j], i, j]);
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(([, i, j]) => letters[0] + letters[i] + letters[j]);
  };
  const numbers = tokens.filter(w => /^\d{2}$/.test(w));
  candidates.push(...patterns(use), ...numbers.map(d => use[0][0] + d), ...patterns(all.length ? all : use));
  for (const c of candidates) {
    const code = c.toUpperCase();
    if (/^[A-Z]{3}$|^[A-Z]\d\d$/.test(code) && !taken.has(code)) { taken.add(code); return code; }
  }
  // Every code from the first letter on: A-Z only, so it still reads as letters.
  const first = (use[0][0] || 'C').toUpperCase();
  for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = first + a + b;
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  throw new Error(`No free code for ${rawName}`);
}

const COMPASS =['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
const qualify = (name, q) => (name.endsWith(')') ? `${name.slice(0, -1)}, ${q})` : `${name} (${q})`);
// A name that reads as one (Latin script, words of letters, not a code), for GeoNames
// places a section may be named after.
const readable = s => /\p{L}{3}/u.test(s) && !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(s)
  && !/^[A-Z]{1,3}$/.test(s) && !/\p{L}\d|\d\p{L}/u.test(s) && !/[:?*\\|[\]{}<>=#@$%^~_`]/.test(s);

/**
 * Section names, unique within the map: the seed unit's name (its source unit's name
 * made readable, plus a split piece's compass point). A club pushed off its home unit by
 * a stronger club also names its home town ("Sefton (near Liverpool)" for Everton). A
 * section no club starts on (`extras[i - clubs]`) built around a GeoNames place takes the
 * place's name; one built around an admin unit takes the first of the places it holds
 * (`towns[i]`, most populous first) whose name is still free, if any. Repeats take their
 * Natural Earth region, then a compass point from the repeats' middle, then a number. A
 * unit name without letters, or not in Latin script, takes the nearest town (`nearestTown(point)`).
 */
function sectionNames({ units, seedUnit, homeOf, placed, extras = [], towns = [], nearestTown = () => null, sourceUnits, namer, regionAt }) {
  const source = new Map(sourceUnits.map(u => [String(u.id), u]));
  const baseOf = u => namer.name(source.get(baseId(units[u].id)) ?? units[u]);
  const townOf = u => namer.town(source.get(baseId(units[u].id)) ?? units[u]);
  const raw = ([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat];
  const clubs = seedUnit.length - extras.length;
  const taken = new Set(extras.filter(e => e.place).map(e => namer.place(e.place).toLowerCase()));
  const names = seedUnit.map((u, i) => {
    if (i >= clubs && extras[i - clubs].place) return namer.place(extras[i - clubs].place);
    if (i >= clubs && towns[i]?.length) {
      const name = towns[i].map(p => namer.place(p)).find(t => !taken.has(t.toLowerCase())) ?? namer.place(towns[i][0]);
      taken.add(name.toLowerCase());
      return name;
    }
    let base = baseOf(u);
    if (!/\p{L}{2}/u.test(base) || /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(base)) base = nearestTown(units[u].centroid) ?? base;
    let name = units[u].qualifier ? qualify(base, units[u].qualifier) : base;
    const h = homeOf[i];
    const town = i < clubs && h && !placed[i] && h.unit !== u && baseOf(h.unit) !== base ? townOf(h.unit) : null;
    if (town && !sameName(town, base)) name = qualify(name, `near ${town}`);
    return name;
  });
  const repeats = () => {
    const groups = new Map();
    names.forEach((name, i) => {
      const k = name.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    return [...groups.values()].filter(list => list.length > 1);
  };
  for (const list of repeats()) {
    const regions = list.map(i => regionAt(raw(units[seedUnit[i]].centroid)));
    if (new Set(regions).size === 1) continue;
    list.forEach((i, k) => { if (regions[k] && !names[i].includes(regions[k])) names[i] = qualify(names[i], regions[k]); });
  }
  for (const list of repeats()) {
    const pts = list.map(i => units[seedUnit[i]].centroid);
    const mid = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const scale = Math.cos(mid[1] * Math.PI / 180);
    list.forEach((i, k) => {
      const angle = Math.atan2(pts[k][1] - mid[1], (pts[k][0] - mid[0]) * scale);
      names[i] = qualify(names[i], COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]);
    });
  }
  const seen = new Set();
  return names.map(name => {
    let out = name;
    for (let k = 2; seen.has(out.toLowerCase()); k++) out = qualify(name, String(k));
    seen.add(out.toLowerCase());
    return out;
  });
}

/** Club strength exactly as the game computes it from the expanded squad. */
function clubStrength(row, source) {
  const squad = row.squad.map(tuple => expandFmTuple(tuple, source, row.name));
  return selectLineup(buildClub({ ...row, squad }, { id: 'football' })).rating;
}

// ---- Geometry helpers on the shipped topology ----

const geomPolys = (topo, g) => {
  const geometry = feature(topo, g).geometry;
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
};

function circularMeanLon(points) {
  let x = 0, y = 0;
  for (const [lon, weight] of points) { x += Math.cos(lon * Math.PI / 180) * weight; y += Math.sin(lon * Math.PI / 180) * weight; }
  return Math.atan2(y, x) * 180 / Math.PI;
}

const round = (v, step = 0.1) => Math.round(v / step) * step;
const fixed = (v, digits = 1) => Number(v.toFixed(digits));

// ---- One country ----

async function buildCountry(id, snapshot, source) {
  const t0 = Date.now();
  const clubs = snapshot.clubs;
  const n = clubs.length;
  const S = DOMESTIC_SECTIONS;
  if (n < 2 || n > S) throw new Error(`${id}: ${n} clubs; a map needs 2 to ${S}`);
  const picked = await source.unitsFor(id, S);
  log(`${id} ${snapshot.nation.name}: ${n} clubs, ${picked.provider} ${picked.iso3} ${picked.level} (${picked.units.length} units)`);

  // GeoNames places: names for broken unit names, and homes for clubs without one.
  const { country: a2, admin1 } = snapshot.nation.geonames || {};
  const cities = a2 ? await source.places(a2) : [];
  const regionAt = await source.regions(picked.iso3, a2);
  let namer = createNamer(picked.units, { iso3: picked.iso3, a2, places: cities, regionAt });
  if (namer.garbled && a2) namer = createNamer(picked.units, { iso3: picked.iso3, a2, places: await source.places(a2, { full: true }), regionAt });

  // Places for the sections no club starts on: cities1000, or where it is sparse the
  // country file's populated places too (villages, mostly without a population).
  const inScope = list => (admin1 ? list.filter(p => p.admin1 === admin1) : list);
  let extraPlaces = inScope(cities);
  if (n < S && a2 && extraPlaces.length < SPARSE_PLACES * (S - n)) {
    const known = new Set(extraPlaces.map(p => p.id));
    extraPlaces = [...extraPlaces, ...inScope(await source.places(a2, { full: true })).filter(p => VILLAGE_CODES.test(p.code) && !known.has(p.id))];
  }
  extraPlaces = extraPlaces.filter(p => readable(namer.place(p)));
  const rawHomes = clubs.map(c => (c.location ? [c.location.lon, c.location.lat] : null));
  const {
    shift, units, adjacency, topo: unitTopo, homes, homeOf, located, placed, extras, moved, fans, movedStarts, dropped, splits, sourceUnits, sourceAreaKm2,
    maxGapKm, owner: seedOf, seedUnit, seedPoint,
  } = partitionCountry(picked.units, rawHomes, { places: inScope(cities), extraPlaces, sections: S, log });
  const isLocated = i => Boolean(homeOf[i] && !placed[i]);

  // Club groups: seed k < n is club k's home section, an extra seed's section joins the
  // club whose territory it was made in.
  const seedArea = new Array(S).fill(0), seedSum = Array.from({ length: S }, () => [0, 0]);
  seedOf.forEach((k, u) => {
    seedArea[k] += units[u].area;
    seedSum[k][0] += units[u].centroid[0] * units[u].area;
    seedSum[k][1] += units[u].centroid[1] * units[u].area;
  });
  const seedCentroid = seedSum.map(([x, y], k) => [x / seedArea[k], y / seedArea[k]]);
  const fromHome = (c, k) => kmBetween(seedPoint[c], seedCentroid[k]);
  const groupOfSeed = seedArea.map((_, k) => (k < n ? k : extras[k - n].group));
  // Output order: by club rank, home first, then by distance from home.
  const order = clubs.flatMap((_, c) => [c, ...groupOfSeed.map((o, k) => k).filter(k => k !== c && groupOfSeed[k] === c)
    .sort((a, b) => fromHome(c, a) - fromHome(c, b) || a - b)]);
  const position = new Array(S);
  order.forEach((k, p) => { position[k] = p; });
  const clubAt = order.map(k => groupOfSeed[k]);
  const owner = seedOf.map(k => position[k]);
  const discarded = located.map((l, i) => (l.status === 'discarded' ? `${clubs[i].name} (${fixed(l.km)} km)` : null)).filter(Boolean);
  if (discarded.length) log(`  discarded homes more than 50 km outside: ${discarded.join(', ')}`);

  // Projection: circular-mean meridian, standard parallel through the main landmass.
  const { comp, count } = components(adjacency);
  const compArea = new Array(count).fill(0);
  units.forEach((u, i) => { compArea[comp[i]] += u.area; });
  const main = compArea.indexOf(Math.max(...compArea));
  const mainBox = bboxOf(units.filter((_, i) => comp[i] === main).flatMap(u => u.polys));
  const lon0 = fixed(round(circularMeanLon(units.map(u => [u.centroid[0], u.area]))));
  const lat0 = fixed(round((mainBox[1] + mainBox[3]) / 2));
  const projection = { lon0: Object.is(lon0, -0) ? 0 : lon0, lat0: Object.is(lat0, -0) ? 0 : lat0 };

  const ids = order.map((_, p) => `${id}-${String(p + 1).padStart(3, '0')}`);
  // The places in each section built around an admin unit (most populous, then nearest its
  // start first), to name it after one.
  const towns = [];
  if (extras.length) {
    const grid = new Map();
    units.forEach((u, i) => {
      for (let x = Math.floor(u.bbox[0]); x <= Math.floor(u.bbox[2]); x++) for (let y = Math.floor(u.bbox[1]); y <= Math.floor(u.bbox[3]); y++) {
        if (!grid.has(`${x},${y}`)) grid.set(`${x},${y}`, []);
        grid.get(`${x},${y}`).push(i);
      }
    });
    for (const p of extraPlaces) {
      const q = [shift && p.lon < 0 ? p.lon + 360 : p.lon, p.lat];
      const u = (grid.get(`${Math.floor(q[0])},${Math.floor(q[1])}`) || []).find(i => pointInPolys(q, units[i].polys));
      const k = u == null ? -1 : seedOf[u];
      if (k >= n && !extras[k - n].place) (towns[k] ??= []).push({ p, km: kmBetween(q, seedPoint[k]) });
    }
    towns.forEach((list, k) => { towns[k] = list.sort((a, b) => b.p.pop - a.p.pop || a.km - b.km || a.p.id - b.p.id).slice(0, 8).map(t => t.p); });
  }
  const named = inScope(cities).filter(p => p.pop > 0 && readable(namer.place(p)));
  const nearestTown = ([lon, lat]) => {
    const q = [lon > 180 ? lon - 360 : lon, lat];
    const best = named.reduce((a, p) => (!a || kmBetween(q, [p.lon, p.lat]) < kmBetween(q, [a.lon, a.lat]) ? p : a), null);
    return best && namer.place(best);
  };
  const seedNames = sectionNames({ units, seedUnit, homeOf, placed, extras, towns, nearestTown, sourceUnits: picked.units, namer, regionAt });
  const names = order.map(k => seedNames[k]);
  const unitCounts = order.map((_, p) => owner.filter(o => o === p).length);
  const sectionGeoms = dissolve(unitTopo, owner, S);
  const groupOf = clubs.map((_, c) => order.map((k, p) => p).filter(p => clubAt[p] === c));

  // Islets below ~4 px² at the opening fit are noise; a club's home islet (or the place
  // a section was built around) always stays.
  const extentKm = Math.max(kmBetween([mainBox[0], (mainBox[1] + mainBox[3]) / 2], [mainBox[2], (mainBox[1] + mainBox[3]) / 2]),
    kmBetween([mainBox[0], mainBox[1]], [mainBox[0], mainBox[3]]));
  const minAreaKm2 = fixed(4 * (extentKm / 900) ** 2, 3);
  const filtered = sectionTopology(sectionGeoms, { ids, names, unitCounts, minAreaKm2, keepPoints: [...homes.filter(Boolean), ...extras.map(e => e.point)] });

  // Simplify to the point budget, then quantize; shrink the budget if the file is too big.
  const meta = {
    format: DOMESTIC_FORMAT,
    id,
    name: snapshot.nation.name,
    version: '',
    projection,
    focus: null,
    boundaries: { ...picked.boundaries, units: sourceUnits, areaKm2: Math.round(sourceAreaKm2) },
    source: {
      provider: 'EFEM.club', game: 'Football Manager 26', edition: 'FM 26', version: snapshot.source.version,
      snapshotDate: snapshot.source.fetchedAt.slice(0, 10), rawScale: 100, conversion: FM_CONVERSION, origin: FM_ORIGIN,
    },
  };
  const taken = new Set();
  const rows = clubs.map((c, i) => {
    // A placed home is an estimate, marked as one: the GeoNames place the club starts at.
    const home = placed[i] ? [placed[i].lon, placed[i].lat] : located[i].unit == null ? null : rawHomes[i];
    const homeSource = placed[i] ? `placed:${placed[i].id}` : home ? c.location.source : null;
    const row = {
      id: `d${id}-${c.fm}`, fm: c.fm, name: c.name, ...(c.short && c.short.trim() ? { short: c.short } : {}),
      code: makeCode(c.name, taken), col: '', rep: c.rep, league: c.competition || REGIONAL, str: 0,
      section: ids[position[i]], sections: groupOf[i].map(p => ids[p]), home, ...(home ? { homeSource } : {}), squad: c.squad,
    };
    row.str = clubStrength(row, meta.source);
    return row;
  });

  let target = POINT_TARGET;
  let doc, text, qtopo;
  for (;;) {
    qtopo = quantize(simplifyTopology(filtered.topo, target), 1e5);
    delete qtopo.bbox;
    const geoms = qtopo.objects.sections.geometries;
    meta.focus = focusBox(qtopo, units, comp, count, homeOf.slice(0, n));
    // Neighbouring clubs' groups differ in colour, also where sections face each other
    // across a strait or a river mouth.
    const across = facingSections(geoms.map(g => geomPolys(qtopo, g)), facingKm(meta.focus));
    const clubAdj = clubs.map(() => new Set());
    neighbors(geoms).forEach((list, p) => { for (const j of [...list, ...across[p]]) if (clubAt[j] !== clubAt[p]) clubAdj[clubAt[p]].add(clubAt[j]); });
    const colours = colourSections(clubAdj.map(s => [...s].sort((a, b) => a - b)));
    rows.forEach((row, i) => { row.col = colours[i]; });
    doc = { ...meta, topology: qtopo, clubs: rows };
    doc.version = `${id}-${contentHash(doc)}`;
    text = serialize(doc);
    if (Buffer.byteLength(text) <= MAX_BYTES || target < 4000) break;
    target = Math.floor(target * 0.85);
  }

  // Verify with the game's own loader and gather the audit numbers.
  const decoded = decodeDomestic(JSON.parse(text), id);
  const sectionPolys = qtopo.objects.sections.geometries.map(g => geomPolys(qtopo, g));
  const sectionAreas = sectionPolys.map(polysAreaKm2);
  const totalArea = sectionAreas.reduce((s, a) => s + a, 0);
  for (const g of qtopo.objects.sections.geometries) {
    const p = decoded.geo.paths[g.id];
    if (!p || !Number.isFinite(p.cx) || !Number.isFinite(p.cy) || !(p.area > 0)) throw new Error(`${id}: section ${g.id} does not decode to a finite, non-empty shape`);
  }
  const areaDiff = (totalArea - sourceAreaKm2) / sourceAreaKm2;
  if (Math.abs(areaDiff) > 0.02) throw new Error(`${id}: section area ${Math.round(totalArea)} km² differs from the source ${Math.round(sourceAreaKm2)} km² by ${(areaDiff * 100).toFixed(2)}%`);
  const inSection = [], displacement = [], displaced = [];
  clubs.forEach((c, i) => {
    if (!isLocated(i)) return;
    const km = kmToPolys(homes[i], sectionPolys[position[i]]);
    displacement.push(km);
    if (km === 0) inSection.push(i);
    else displaced.push({ club: c.name, section: names[position[i]], km: fixed(km) });
  });
  displaced.sort((a, b) => b.km - a.km || a.club.localeCompare(b.club));
  const groupAreas = groupOf.map(list => list.reduce((s, p) => s + sectionAreas[p], 0));
  const landSplit = splitOnLand(qtopo.objects.sections.geometries, clubAt).map(c => clubs[c].name);
  const audit = {
    id, name: snapshot.nation.name, provider: picked.provider, iso3: picked.iso3, level: picked.level,
    units: sourceUnits, parts: units.length, droppedUnits: dropped, maxGapKm: fixed(maxGapKm),
    splits: splits.map(({ source, ...split }) => ({ ...split, unit: namer.name(picked.units.find(u => String(u.id) === source) ?? { id: source, name: split.unit, polys: [] }) })),
    clubs: n, located: clubs.filter((_, i) => isLocated(i)).length, snapped: located.filter(l => l.status === 'snapped').length,
    unlocated: clubs.filter((_, i) => !homeOf[i]).map(c => c.name), discardedHomes: discarded,
    placed: clubs.map((c, i) => placed[i] && { club: c.name, place: placed[i].name, geonames: placed[i].id, areaPct: fixed(100 * groupAreas[i] / totalArea) }).filter(Boolean),
    sections: S,
    ...(extras.length ? {
      extras: { places: extras.filter(e => e.kind === 'place').length, units: extras.filter(e => e.kind !== 'place').length },
      groups: {
        sizes: [...new Set(groupOf.map(list => list.length))].sort((a, b) => a - b),
        // Clubs whose size moved from the rank rule (a club hemmed in by others in its city
        // passes its larger size on), clubs fanned out around a city, clubs starting just
        // outside their boxed-in city, and groups split on one landmass (none expected).
        sizeMoved: moved.map(c => clubs[c].name), fanned: fans.map(f => f.members.map(c => clubs[c].name)),
        movedStarts: movedStarts.map(c => clubs[c].name), splitOnLand: landSplit,
        areaKm2: { min: fixed(Math.min(...groupAreas)), median: fixed(quantileOf(groupAreas, 0.5)), max: fixed(Math.max(...groupAreas)) },
      },
    } : {}),
    homeInSection: inSection.length,
    displacementKm: { median: fixed(quantileOf(displacement, 0.5) ?? 0), p90: fixed(quantileOf(displacement, 0.9) ?? 0), max: fixed(Math.max(0, ...displacement)) },
    displaced: displaced.slice(0, 12),
    sectionAreaKm2: { min: fixed(Math.min(...sectionAreas)), p10: fixed(quantileOf(sectionAreas, 0.1)), median: fixed(quantileOf(sectionAreas, 0.5)), p90: fixed(quantileOf(sectionAreas, 0.9)), max: fixed(Math.max(...sectionAreas)) },
    areaKm2: { source: Math.round(sourceAreaKm2), sections: Math.round(totalArea), diffPct: fixed(areaDiff * 100, 2) },
    islandsDropped: filtered.droppedPolys, holesDropped: filtered.droppedHoles, minIsletKm2: minAreaKm2,
    antimeridianShift: shift, projection, arcPoints: arcPoints(qtopo), pointBudget: target, bytes: Buffer.byteLength(text),
  };
  if (picked.boundaries.foreign) audit.foreignCut = picked.boundaries.foreign.cut;
  if (picked.boundaries.filled) audit.filled = picked.boundaries.filled.units;
  if (namer.garbled) audit.names = 'garbled layer: every name checked against GeoNames places';
  log(`  ${audit.units} units -> ${S} sections for ${n} clubs; home in section ${audit.homeInSection}/${audit.located}; `
    + `areas ${audit.sectionAreaKm2.min}/${audit.sectionAreaKm2.median}/${audit.sectionAreaKm2.max} km²; `
    + `${audit.arcPoints} arc points; ${(audit.bytes / 1024).toFixed(1)} KB; ${Date.now() - t0} ms`);
  if (audit.groups) {
    const g = audit.groups;
    log(`  groups of ${g.sizes.join('/')} sections; sizes moved ${g.sizeMoved.length}, fanned ${g.fanned.flat().length}, starts moved ${g.movedStarts.length}, split on land ${g.splitOnLand.length}${g.splitOnLand.length ? ` (${g.splitOnLand.join(', ')})` : ''}`);
  }
  const strongest = rows.map((r, i) => [r.str, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(([, i]) => rows[i].name);
  return {
    text, audit,
    index: { id, name: doc.name, clubs: n, sections: S, version: doc.version, level: picked.level, top: strongest },
  };
}

/** Shortest distance between two lon/lat boxes (0 when they overlap). */
function boxGapKm(a, b) {
  const span = (lo1, hi1, lo2, hi2) => (hi1 < lo2 ? [hi1, lo2] : hi2 < lo1 ? [lo1, hi2] : [Math.max(lo1, lo2), Math.max(lo1, lo2)]);
  const [xa, xb] = span(a[0], a[2], b[0], b[2]);
  const [ya, yb] = span(a[1], a[3], b[1], b[3]);
  return kmBetween([xa, ya], [xb, yb]);
}

/**
 * Initial camera, by where the clubs are: the landmass holding the most located club
 * homes, any other holding a tenth of them or of the land (Borneo for Malaysia, the
 * South Island, Hokkaido), then every polygon within reach of that core (the
 * Balearics, Bornholm). Far outliers such as the Canaries or the Azores stay out.
 */
function focusBox(qtopo, units, comp, count, homeOf) {
  const clubs = new Array(count).fill(0);
  const area = new Array(count).fill(0);
  units.forEach((u, i) => { area[comp[i]] += u.area; });
  for (const h of homeOf) if (h) clubs[comp[h.unit]]++;
  const totalClubs = clubs.reduce((s, c) => s + c, 0);
  const totalArea = area.reduce((s, a) => s + a, 0);
  let main = 0;
  for (let c = 1; c < count; c++) if (clubs[c] > clubs[main] || (clubs[c] === clubs[main] && area[c] > area[main])) main = c;
  const core = new Set([main]);
  for (let c = 0; c < count; c++) if ((clubs[c] && clubs[c] >= 0.1 * totalClubs) || area[c] >= 0.1 * totalArea) core.add(c);
  const coreBox = bboxOf(units.filter((_, i) => core.has(comp[i])).flatMap(u => u.polys));
  const reach = Math.max(200, 0.15 * kmBetween([coreBox[0], coreBox[1]], [coreBox[2], coreBox[3]]));
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of qtopo.objects.sections.geometries) {
    for (const poly of geomPolys(qtopo, g)) {
      const b = bboxOf([poly]);
      if (boxGapKm(b, coreBox) > reach) continue;
      box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    }
  }
  const padX = (box[2] - box[0]) * 0.02, padY = (box[3] - box[1]) * 0.02;
  return [Math.floor((box[0] - padX) * 10) / 10, Math.floor((box[1] - padY) * 10) / 10,
    Math.ceil((box[2] + padX) * 10) / 10, Math.ceil((box[3] + padY) * 10) / 10].map(v => fixed(v));
}

// ---- Index, attribution, audit ----

function indexModule(entries) {
  const rows = entries.map(e => `  ${JSON.stringify(e)},`).join('\n');
  return `// GENERATED by scripts/build-domestic.mjs from public/domestic/*.json; do not edit.
// One entry per shipped domestic map (docs/design/domestic-campaigns.md): the setup
// screen lists these and the loader fetches public/domestic/<id>.json on demand.
// { id, name, clubs: N, sections: 100, version, level: boundary layer, top: three strongest clubs }

export const DOMESTIC_FORMAT = ${DOMESTIC_FORMAT};

export const DOMESTIC = [
${rows}
];
`;
}

function attributionText(docs) {
  const lines = [
    'Domestic campaign maps (public/domestic/<id>.json)',
    'Generated by scripts/build-domestic.mjs; do not edit.',
    '',
    'Section shapes are derived (dissolved, simplified, quantized) from the administrative',
    'boundary layers listed below. Each layer keeps its own licence; share-alike and ODbL',
    'layers apply to the derived section shapes of that country.',
    '',
    'geoBoundaries (https://www.geoboundaries.org), gbOpen release, files pinned to commit 9469f09:',
    `  ${GB_CITATION}`,
    'Natural Earth (https://www.naturalearthdata.com): public domain, no attribution required.',
    'Club home towns: Wikidata (CC0 1.0), GeoNames cities1000 (https://www.geonames.org, CC BY 4.0),',
    '  and manual overrides in scripts/data/domestic-locations.json. A club with no known home starts',
    '  at a populous GeoNames place hosting no other club (homeSource "placed:<geonameid>", an estimate).',
    "A country with fewer than 100 clubs cuts each club's land into its share of the 100 sections, built",
    "  around GeoNames places (cities1000, plus the country file's populated places where cities1000 has",
    '  few) or admin units, and named after them or their most populous place.',
    `Section names: the boundary layers' unit names; broken or cut-off ones are replaced from ${GN_CITATION}`,
    '  (cities1000, or the country file for a garbled layer) or by the Natural Earth admin-1 region.',
    "Land the game's world map (public/countries-50m.json: world-atlas 2.0.2, ISC; Natural Earth 1:50m,",
    '  public domain) draws for another country is cut from a domestic map; see "Cut" lines below.',
    'Clubs, squads and player abilities: Football Manager 26 data as published by EFEM.club',
    '  (https://efem.club), version 26.3.0, retrieved at build time. Football Manager is a trademark',
    '  of Sports Interactive; this game is not affiliated with or endorsed by them or EFEM.club.',
    '',
    'Per country:',
  ];
  for (const d of docs) {
    const b = d.boundaries;
    lines.push('', `${d.name} (${d.id}), ${d.version}: ${b.provider} ${b.iso3} ${b.level}, ${b.units} units`);
    lines.push(`  Source: ${b.source}${b.year ? ` (${b.year})` : ''}`);
    lines.push(`  Licence: ${b.license}${b.licenseDetail ? ` - ${b.licenseDetail}` : ''}`);
    lines.push(`  File: ${b.url}`);
    if (b.filled) lines.push(`  Filled from ${b.filled.level} (${b.filled.units.join(', ')}): ${b.filled.source || b.provider}, ${b.filled.license}, ${b.filled.url}`);
    if (b.mask) lines.push(`  Mask ${b.mask}: ${b.maskSource || b.provider} (${b.maskLicense || b.license})${b.maskUrl ? `, ${b.maskUrl}` : ''}`);
    if (b.excluded) lines.push(`  Excluded ${b.excluded.join(', ')} (own football associations): ${b.excludedSource}, ${b.excludedUrl}`);
    if (b.foreign) lines.push(`  Cut (the world map's ${b.foreign.cut.map(c => `${c.shape} ${c.km2.toLocaleString('en')} km²`).join(', ')})`);
  }
  return `${lines.join('\n')}\n`;
}

// ---- Building, inline or in worker threads ----

async function buildOne(id, source) {
  try {
    const snapshot = JSON.parse(await readFile(path.join(snapshotDir, `${id}.json`), 'utf8'));
    return { result: await buildCountry(id, snapshot, source) };
  } catch (error) {
    log(`${id} FAILED: ${error.stack || error.message}`);
    return { error: error.message };
  }
}

/** Worker thread: builds the countries it is sent one at a time; cache misses go to the main thread. */
function runWorker() {
  const waiting = new Map();
  let nextKey = 0;
  const download = (url, file, opts) => (existsSync(file) ? readFile(file, 'utf8') : new Promise((resolve, reject) => {
    waiting.set(nextKey, { resolve, reject, file });
    parentPort.postMessage({ type: 'download', key: nextKey++, url, file, opts });
  }));
  const { offline } = workerData;
  const source = createBoundarySource({ cacheDir, worldFile, offline, log, ...(offline ? {} : { download }) });
  parentPort.on('message', async msg => {
    if (msg.type === 'downloaded') {
      const { resolve, reject, file } = waiting.get(msg.key);
      waiting.delete(msg.key);
      if (msg.error) reject(new Error(msg.error));
      else resolve(readFile(file, 'utf8'));
      return;
    }
    const lines = [];
    logSink = line => lines.push(line);
    const outcome = await buildOne(msg.id, source);
    parentPort.postMessage({ type: 'built', id: msg.id, lines, ...outcome });
  });
}

/** Builds ids on `jobs` worker threads, the costliest first; returns { built, failures }. */
async function buildParallel(ids, jobs, { offline, download, cost }) {
  const built = new Map();
  const failures = [];
  const queue = [...ids].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
  await new Promise(resolve => {
    let running = 0;
    const start = () => {
      running++;
      let current = null;
      const worker = new Worker(new URL(import.meta.url), { workerData: { offline } });
      const next = () => {
        current = queue.shift() ?? null;
        if (current) worker.postMessage({ type: 'build', id: current });
        else worker.terminate();
      };
      const lost = reason => {
        if (!current) return;
        failures.push(`${current}: ${reason}`);
        console.error(`${current} FAILED: ${reason}`);
        current = null;
      };
      worker.on('message', msg => {
        if (msg.type === 'download') {
          download(msg.url, msg.file, msg.opts).then(() => worker.postMessage({ type: 'downloaded', key: msg.key }),
            error => worker.postMessage({ type: 'downloaded', key: msg.key, error: error.message }));
          return;
        }
        for (const line of msg.lines) (msg.error ? console.error : console.log)(line);
        if (msg.error) failures.push(`${msg.id}: ${msg.error}`);
        else built.set(msg.id, msg.result);
        next();
      });
      worker.on('error', error => lost(error.stack || error.message));
      worker.on('exit', code => {
        lost(`worker exited with code ${code}`);
        running--;
        if (queue.length) start();
        else if (!running) resolve();
      });
      next();
    };
    for (let i = 0; i < Math.min(jobs, queue.length); i++) start();
  });
  return { built, failures };
}

// ---- Main ----

if (isMainThread) await main();
else runWorker();

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }));
  for (const key of Object.keys(args)) if (!['only', 'jobs', 'check', 'dry-run'].includes(key)) throw new Error(`Unknown option --${key}`);
  const check = args.check === 'true';
  const dryRun = args['dry-run'] === 'true';

  const snapshotIds = (await readdir(snapshotDir)).filter(f => SNAPSHOT.test(f)).map(f => f.replace('.json', '')).sort();
  const pad = s => (/^\d+$/.test(s) ? s.padStart(3, '0') : s);
  const ids = args.only ? args.only.split(',').map(s => pad(s.trim())).filter(Boolean) : snapshotIds;
  for (const id of ids) if (!snapshotIds.includes(id)) throw new Error(`No snapshot scripts/data/domestic/${id}.json`);
  const jobs = Math.min(ids.length, Math.max(1, Number(args.jobs) || Math.min(8, availableParallelism() - 1)));
  const previousAudit = existsSync(auditFile) ? JSON.parse(await readFile(auditFile, 'utf8')) : { countries: [] };

  const download = createDownloader({ offline: check, log });
  const started = Date.now();
  let built = new Map();
  let failures = [];
  if (jobs > 1) {
    // The last build's exploded-unit count stands in for a country's cost (Canada, Russia first).
    const parts = new Map(previousAudit.countries.map(a => [a.id, a.parts || 0]));
    ({ built, failures } = await buildParallel(ids, jobs, { offline: check, download, cost: id => parts.get(id) || 0 }));
    failures.sort();
  } else {
    const source = createBoundarySource({ cacheDir, worldFile, offline: check, log, download });
    for (const id of ids) {
      const { result, error } = await buildOne(id, source);
      if (error) failures.push(`${id}: ${error}`);
      else built.set(id, result);
    }
  }

  // The index, attribution and audit cover every shipped file, rebuilt or not. A full
  // run retires shipped maps whose nation no longer has a snapshot.
  const present = existsSync(outDir) ? (await readdir(outDir)).filter(f => SNAPSHOT.test(f)).map(f => f.replace('.json', '')) : [];
  const stale = args.only ? [] : present.filter(id => !snapshotIds.includes(id));
  const shipped = present.filter(id => !stale.includes(id));
  const allIds = [...new Set([...shipped, ...built.keys()])].sort();
  const docs = [];
  const indexEntries = [];
  for (const id of allIds) {
    const text = built.get(id)?.text ?? await readFile(path.join(outDir, `${id}.json`), 'utf8');
    const doc = JSON.parse(text);
    docs.push(doc);
    indexEntries.push(built.get(id)?.index ?? {
      id, name: doc.name, clubs: doc.clubs.length, sections: doc.topology.objects.sections.geometries.length, version: doc.version, level: doc.boundaries.level,
      top: doc.clubs.map((c, i) => [c.str, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(([, i]) => doc.clubs[i].name),
    });
  }
  indexEntries.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  docs.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  const auditById = new Map(previousAudit.countries.filter(a => allIds.includes(a.id)).map(a => [a.id, a]));
  for (const [id, b] of built) auditById.set(id, b.audit);
  const audit = {
    generatedBy: 'scripts/build-domestic.mjs',
    note: 'Per-country section build report: boundary layer, units, dropped overseas units, splits, home placement, section sizes and file size.',
    countries: [...auditById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  const outputs = new Map();
  for (const [id, b] of built) outputs.set(path.join(outDir, `${id}.json`), b.text);
  outputs.set(indexFile, indexModule(indexEntries));
  outputs.set(attributionFile, attributionText(docs));
  outputs.set(auditFile, `${JSON.stringify(audit, null, 1)}\n`);

  if (dryRun) {
    for (const id of stale) log(`would remove public/domestic/${id}.json (no snapshot)`);
    log(`Dry run: built ${built.size} domestic maps in ${((Date.now() - started) / 1000).toFixed(1)} s, wrote nothing.`);
    if (failures.length) {
      for (const f of failures) console.error(`failed: ${f}`);
      process.exit(1);
    }
  } else if (check) {
    const differs = stale.map(id => `public/domestic/${id}.json (no snapshot)`);
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length || failures.length) {
      for (const f of differs) console.error(`differs: ${f}`);
      for (const f of failures) console.error(`failed: ${f}`);
      process.exit(1);
    }
    log(`Verified ${built.size} domestic maps and ${outputs.size - built.size} generated files byte for byte.`);
  } else {
    await mkdir(outDir, { recursive: true });
    for (const [file, text] of outputs) await writeFile(file, text);
    for (const id of stale) {
      await rm(path.join(outDir, `${id}.json`));
      log(`Removed public/domestic/${id}.json (no snapshot).`);
    }
    log(`Wrote ${built.size} domestic maps, the index (${indexEntries.length} countries), attribution and audit in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    if (failures.length) {
      for (const f of failures) console.error(`failed: ${f}`);
      process.exit(1);
    }
  }
}
