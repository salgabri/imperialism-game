// Stage 2 of domestic campaigns (docs/design/domestic-campaigns.md): committed club
// snapshots plus admin boundaries become one section per club on the country's map.
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
// Outputs: public/domestic/<id>.json (format 1), public/domestic/ATTRIBUTION.txt,
//          src/data/domestic.js (index for the setup screen), docs/design/domestic-audit.json.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import path from 'node:path';
import { feature, neighbors } from 'topojson-client';
import { buildClub, selectLineup } from '../src/data/teams.js';
import { expandFmTuple, FM_CONVERSION, FM_ORIGIN } from '../src/data/fmPlayers.js';
import { decodeDomestic, DOMESTIC_FORMAT } from '../src/engine/domestic.js';
import { createBoundarySource, createDownloader, createNamer, GB_CITATION, GN_CITATION, sameName } from './lib/domestic-boundaries.mjs';
import {
  arcPoints, baseId, bboxOf, components, dissolve, facingKm, facingSections, kmBetween, kmToPolys, partitionCountry, polysAreaKm2, quantileOf,
  quantize, sectionTopology, simplifyTopology,
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

// Two lightness levels over a 24-step hue wheel; greedy over the section graph so
// neighbours (and, where possible, neighbours of neighbours) differ clearly.
const PALETTE = [0.74, 0.6].flatMap(l => Array.from({ length: 24 }, (_, i) => ({ l, c: 0.15, h: i * 15 })));
const lab = ({ l, c, h }) => [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const colourText = ({ l, c, h }) => `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h})`;

function colourSections(adjacency) {
  const chosen = new Array(adjacency.length).fill(-1);
  const used = new Array(PALETTE.length).fill(0);
  for (let i = 0; i < adjacency.length; i++) {
    const near = adjacency[i].filter(j => chosen[j] >= 0).map(j => PALETTE[chosen[j]]);
    const second = [...new Set(adjacency[i].flatMap(j => adjacency[j]))]
      .filter(j => j !== i && !adjacency[i].includes(j) && chosen[j] >= 0).map(j => PALETTE[chosen[j]]);
    let best = -1, bestKey = null;
    PALETTE.forEach((colour, k) => {
      const d1 = near.length ? Math.min(...near.map(o => deltaE(colour, o))) : 1;
      const d2 = second.length ? Math.min(...second.map(o => deltaE(colour, o))) : 1;
      // Neighbours dominate (capped: any clear difference is enough), then second
      // neighbours, then the least-used colour; ties keep the lower palette index.
      const key = [Math.min(d1, 0.12), Math.min(d2, 0.08), -used[k], d1];
      const at = bestKey ? key.findIndex((v, idx) => v !== bestKey[idx]) : 0;
      if (!bestKey || (at >= 0 && key[at] > bestKey[at])) { best = k; bestKey = key; }
    });
    chosen[i] = best;
    used[best]++;
  }
  return chosen.map(k => colourText(PALETTE[k]));
}

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
const qualify = (name, q) => (name.endsWith(')') ? `${name.slice(0, -1)}, ${q})` : `${name} (${q})`);

/**
 * Section names, unique within the map: the seed unit's name (its source unit's name
 * made readable, plus a split piece's compass point). A club pushed off its home unit by
 * a stronger club also names its home town ("Sefton (near Liverpool)" for Everton). Repeats
 * take their Natural Earth region, then a compass point from the repeats' middle, then
 * a number.
 */
function sectionNames({ units, seedUnit, homeOf, placed, sourceUnits, namer, regionAt }) {
  const source = new Map(sourceUnits.map(u => [String(u.id), u]));
  const baseOf = u => namer.name(source.get(baseId(units[u].id)) ?? units[u]);
  const townOf = u => namer.town(source.get(baseId(units[u].id)) ?? units[u]);
  const raw = ([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat];
  const names = seedUnit.map((u, i) => {
    const base = baseOf(u);
    let name = units[u].qualifier ? qualify(base, units[u].qualifier) : base;
    const h = homeOf[i];
    const town = h && !placed[i] && h.unit !== u && baseOf(h.unit) !== base ? townOf(h.unit) : null;
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
  const picked = await source.unitsFor(id, n);
  log(`${id} ${snapshot.nation.name}: ${n} clubs, ${picked.provider} ${picked.iso3} ${picked.level} (${picked.units.length} units)`);

  // GeoNames places: names for broken unit names, and homes for clubs without one.
  const { country: a2, admin1 } = snapshot.nation.geonames || {};
  const cities = a2 ? await source.places(a2) : [];
  const regionAt = await source.regions(picked.iso3, a2);
  let namer = createNamer(picked.units, { iso3: picked.iso3, a2, places: cities, regionAt });
  if (namer.garbled && a2) namer = createNamer(picked.units, { iso3: picked.iso3, a2, places: await source.places(a2, { full: true }), regionAt });

  const rawHomes = clubs.map(c => (c.location ? [c.location.lon, c.location.lat] : null));
  const {
    shift, units, adjacency, topo: unitTopo, homes, homeOf, located, placed, dropped, splits, sourceUnits, sourceAreaKm2, maxGapKm, owner, seedUnit,
  } = partitionCountry(picked.units, rawHomes, { places: admin1 ? cities.filter(p => p.admin1 === admin1) : cities, log });
  const isLocated = i => Boolean(homeOf[i] && !placed[i]);
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

  const ids = clubs.map((_, i) => `${id}-${String(i + 1).padStart(3, '0')}`);
  const names = sectionNames({ units, seedUnit, homeOf, placed, sourceUnits: picked.units, namer, regionAt });
  const unitCounts = clubs.map((_, i) => owner.filter(o => o === i).length);
  const sectionGeoms = dissolve(unitTopo, owner, n);

  // Islets below ~4 px² at the opening fit are noise; a club's home islet always stays.
  const extentKm = Math.max(kmBetween([mainBox[0], (mainBox[1] + mainBox[3]) / 2], [mainBox[2], (mainBox[1] + mainBox[3]) / 2]),
    kmBetween([mainBox[0], mainBox[1]], [mainBox[0], mainBox[3]]));
  const minAreaKm2 = fixed(4 * (extentKm / 900) ** 2, 3);
  const filtered = sectionTopology(sectionGeoms, { ids, names, unitCounts, minAreaKm2, keepPoints: homes.filter(Boolean) });

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
      section: ids[i], home, ...(home ? { homeSource } : {}), squad: c.squad,
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
    meta.focus = focusBox(qtopo, units, comp, count, homeOf);
    // Sections facing each other across a strait or a river mouth must differ too.
    const across = facingSections(geoms.map(g => geomPolys(qtopo, g)), facingKm(meta.focus));
    const sectionAdj = neighbors(geoms).map((list, i) => [...new Set([...list, ...across[i]])].sort((a, b) => a - b));
    const colours = colourSections(sectionAdj);
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
    const km = kmToPolys(homes[i], sectionPolys[i]);
    displacement.push(km);
    if (km === 0) inSection.push(i);
    else displaced.push({ club: c.name, section: names[i], km: fixed(km) });
  });
  displaced.sort((a, b) => b.km - a.km || a.club.localeCompare(b.club));
  const audit = {
    id, name: snapshot.nation.name, provider: picked.provider, iso3: picked.iso3, level: picked.level,
    units: sourceUnits, parts: units.length, droppedUnits: dropped, maxGapKm: fixed(maxGapKm),
    splits: splits.map(({ source, ...split }) => ({ ...split, unit: namer.name(picked.units.find(u => String(u.id) === source) ?? { id: source, name: split.unit, polys: [] }) })),
    clubs: n, located: clubs.filter((_, i) => isLocated(i)).length, snapped: located.filter(l => l.status === 'snapped').length,
    unlocated: clubs.filter((_, i) => !homeOf[i]).map(c => c.name), discardedHomes: discarded,
    placed: clubs.map((c, i) => placed[i] && { club: c.name, place: placed[i].name, geonames: placed[i].id, areaPct: fixed(100 * sectionAreas[i] / totalArea) }).filter(Boolean),
    homeInSection: inSection.length,
    displacementKm: { median: fixed(quantileOf(displacement, 0.5) ?? 0), p90: fixed(quantileOf(displacement, 0.9) ?? 0), max: fixed(Math.max(0, ...displacement)) },
    displaced: displaced.slice(0, 12),
    sectionAreaKm2: { min: fixed(Math.min(...sectionAreas)), median: fixed(quantileOf(sectionAreas, 0.5)), max: fixed(Math.max(...sectionAreas)) },
    areaKm2: { source: Math.round(sourceAreaKm2), sections: Math.round(totalArea), diffPct: fixed(areaDiff * 100, 2) },
    islandsDropped: filtered.droppedPolys, holesDropped: filtered.droppedHoles, minIsletKm2: minAreaKm2,
    antimeridianShift: shift, projection, arcPoints: arcPoints(qtopo), pointBudget: target, bytes: Buffer.byteLength(text),
  };
  if (picked.boundaries.foreign) audit.foreignCut = picked.boundaries.foreign.cut;
  if (picked.boundaries.filled) audit.filled = picked.boundaries.filled.units;
  if (namer.garbled) audit.names = 'garbled layer: every name checked against GeoNames places';
  log(`  ${audit.units} units -> ${n} sections; home in section ${audit.homeInSection}/${audit.located}; `
    + `areas ${audit.sectionAreaKm2.min}/${audit.sectionAreaKm2.median}/${audit.sectionAreaKm2.max} km²; `
    + `${audit.arcPoints} arc points; ${(audit.bytes / 1024).toFixed(1)} KB; ${Date.now() - t0} ms`);
  const strongest = rows.map((r, i) => [r.str, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(([, i]) => rows[i].name);
  return {
    text, audit,
    index: { id, name: doc.name, clubs: n, version: doc.version, level: picked.level, top: strongest },
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

/** Version hash: sha256 of the document without its version field, as compact JSON. */
function contentHash(doc) {
  const { version, ...rest } = doc;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8);
}

/** One top-level field per line; arcs, geometries and clubs one per line for readable diffs. */
function serialize(doc) {
  const { topology: t, clubs, ...head } = doc;
  const lines = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const { arcs, objects, ...topoHead } = t;
  const sections = objects.sections;
  const topo = `{${Object.entries(topoHead).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')},`
    + `"objects":{"sections":{"type":${JSON.stringify(sections.type)},"geometries":[\n${sections.geometries.map(g => JSON.stringify(g)).join(',\n')}\n]}},`
    + `"arcs":[\n${arcs.map(a => JSON.stringify(a)).join(',\n')}\n]}`;
  lines.push(`"topology": ${topo}`);
  lines.push(`"clubs": [\n${clubs.map(c => JSON.stringify(c)).join(',\n')}\n]`);
  const text = `{\n${lines.join(',\n')}\n}\n`;
  // The layout must round-trip to the hashed document exactly.
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(doc)) throw new Error('serialize does not round-trip');
  return text;
}

// ---- Index, attribution, audit ----

function indexModule(entries) {
  const rows = entries.map(e => `  ${JSON.stringify(e)},`).join('\n');
  return `// GENERATED by scripts/build-domestic.mjs from public/domestic/*.json; do not edit.
// One entry per shipped domestic map (docs/design/domestic-campaigns.md): the setup
// screen lists these and the loader fetches public/domestic/<id>.json on demand.
// { id, name, clubs: N, version, level: boundary layer, top: three strongest clubs }

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
      id, name: doc.name, clubs: doc.clubs.length, version: doc.version, level: doc.boundaries.level,
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
