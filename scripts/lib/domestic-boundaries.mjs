// Admin-unit sources for the domestic section builder (docs/design/domestic-campaigns.md):
// geoBoundaries gbOpen layers (URLs pinned to a release commit) with Natural Earth
// 10m admin-1 as the fallback. Every download lands in the gitignored
// data-src/boundaries/ cache, so rebuilds and --check run offline.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { strFromU8, unzipSync } from 'fflate';
import polygonClipping from 'polygon-clipping';
import { feature } from 'topojson-client';
import {
  bboxOf, centroidOf, kmBetween, kmToPolys, nodeRings, pointInPolys, polyAreaKm2, polysAreaKm2, polysOf,
} from './domestic-partition.mjs';

export const GB_META_URL = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/';
export const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
export const GN_DUMP = 'https://download.geonames.org/export/dump';
export const GN_CITATION = 'GeoNames (https://www.geonames.org), CC BY 4.0';
export const WORLD_SOURCE = "the game's world map, public/countries-50m.json (world-atlas 2.0.2, Natural Earth 1:50m)";
export const GB_CITATION = 'Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries. PLOS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866';
const USER_AGENT = 'imperialism-game-build/1.0 (offline data build)';
// Layers we may not redistribute without asking the publisher.
const BLOCKED_LICENSES = new Set(['Other - Direct Permission']);

// Game nation id (ISO 3166-1 numeric, plus 'KOS') -> ISO alpha-3 as geoBoundaries uses it.
export const ISO3 = {
  '004': 'AFG', '008': 'ALB', '012': 'DZA', '024': 'AGO', '031': 'AZE', '032': 'ARG', '036': 'AUS', '040': 'AUT',
  '044': 'BHS', '050': 'BGD', '051': 'ARM', '056': 'BEL', '064': 'BTN', '068': 'BOL', '070': 'BIH', '072': 'BWA',
  '076': 'BRA', '084': 'BLZ', '090': 'SLB', '096': 'BRN', '100': 'BGR', '104': 'MMR', '108': 'BDI', '112': 'BLR',
  '116': 'KHM', '120': 'CMR', '124': 'CAN', '140': 'CAF', '144': 'LKA', '148': 'TCD', '152': 'CHL', '156': 'CHN',
  '158': 'TWN', '170': 'COL', '178': 'COG', '180': 'COD', '188': 'CRI', '191': 'HRV', '192': 'CUB', '196': 'CYP',
  '203': 'CZE', '204': 'BEN', '208': 'DNK', '214': 'DOM', '218': 'ECU', '222': 'SLV', '226': 'GNQ', '231': 'ETH',
  '232': 'ERI', '233': 'EST', '242': 'FJI', '246': 'FIN', '250': 'FRA', '262': 'DJI', '266': 'GAB', '268': 'GEO',
  '270': 'GMB', '275': 'PSE', '276': 'DEU', '288': 'GHA', '300': 'GRC', '320': 'GTM', '324': 'GIN', '328': 'GUY',
  '332': 'HTI', '340': 'HND', '348': 'HUN', '352': 'ISL', '356': 'IND', '360': 'IDN', '364': 'IRN', '368': 'IRQ',
  '372': 'IRL', '376': 'ISR', '380': 'ITA', '384': 'CIV', '388': 'JAM', '392': 'JPN', '398': 'KAZ', '400': 'JOR',
  '404': 'KEN', '408': 'PRK', '410': 'KOR', '414': 'KWT', '417': 'KGZ', '418': 'LAO', '422': 'LBN', '426': 'LSO',
  '428': 'LVA', '430': 'LBR', '434': 'LBY', '440': 'LTU', '442': 'LUX', '450': 'MDG', '454': 'MWI', '458': 'MYS',
  '466': 'MLI', '478': 'MRT', '484': 'MEX', '496': 'MNG', '498': 'MDA', '499': 'MNE', '504': 'MAR', '508': 'MOZ',
  '512': 'OMN', '516': 'NAM', '524': 'NPL', '528': 'NLD', '540': 'NCL', '548': 'VUT', '554': 'NZL', '558': 'NIC',
  '562': 'NER', '566': 'NGA', '578': 'NOR', '586': 'PAK', '591': 'PAN', '598': 'PNG', '600': 'PRY', '604': 'PER',
  '608': 'PHL', '616': 'POL', '620': 'PRT', '624': 'GNB', '626': 'TLS', '630': 'PRI', '634': 'QAT', '642': 'ROU',
  '643': 'RUS', '646': 'RWA', '682': 'SAU', '686': 'SEN', '688': 'SRB', '694': 'SLE', '703': 'SVK', '704': 'VNM',
  '705': 'SVN', '706': 'SOM', '710': 'ZAF', '716': 'ZWE', '724': 'ESP', '728': 'SSD', '729': 'SDN', '740': 'SUR',
  '748': 'SWZ', '752': 'SWE', '756': 'CHE', '760': 'SYR', '762': 'TJK', '764': 'THA', '768': 'TGO', '780': 'TTO',
  '784': 'ARE', '788': 'TUN', '792': 'TUR', '795': 'TKM', '800': 'UGA', '804': 'UKR', '807': 'MKD', '818': 'EGY',
  '826': 'GBR', '834': 'TZA', '840': 'USA', '854': 'BFA', '858': 'URY', '860': 'UZB', '862': 'VEN', '887': 'YEM',
  '894': 'ZMB', KOS: 'XKX',
};
// Natural Earth spells a few adm0_a3 codes its own way.
const NE_A3 = { XKX: 'KOS', SSD: 'SDS', PSE: 'PSX' };

// The game's 826 is England, while every source maps the United Kingdom: keep the
// units whose centroid lies in the England polygon of the ADM1 layer.
export const MASKS = {
  '826': { iso3: 'GBR', level: 'ADM1', shapeISO: 'GB-ENG', name: 'GB-ENG', neField: 'gu_a3', neValue: 'ENG' },
};

// Land another football association runs, cut from a nation's units by Natural Earth
// admin-1 adm0_a3: CHN ADM2 carries Taiwan as 23 counties (Chinese Taipei is game
// nation 158 with its own map) and ADM1 adds Macau; Hong Kong for completeness.
export const EXCLUDES = { '156': ['TWN', 'HKG', 'MAC'] };

// The game's world map decides whose land is whose: a domestic map never covers land
// it draws for another country (Pakistan's side of Kashmir, Aksai Chin, Arunachal,
// the Golan, N. Cyprus, Crimea, the world map's W. Sahara). Shapes drawn apart that
// are the host's own football: Åland (IFK Mariehamn plays in the Veikkausliiga).
const WORLD_PARTS = { '246': ['248'] };
const WORLD_KEYS = { Kosovo: 'KOS' };
/** The world-map shapes of a nation's own land. */
export const hostShapes = (world, nationId) => world.filter(s => s.key === nationId || WORLD_PARTS[nationId]?.includes(s.key));
// A sample counts as foreign only beyond this distance from the host's shape (the
// 1:50m borders are coarse), and less than this much foreign land is below the world
// map's resolution: Ceuta, Melilla and Llívia stay although the world map has no
// polygon for them, and islands it leaves out are never foreign at all.
export const FOREIGN_DEPTH_KM = 3;
const FOREIGN_MIN_KM2 = 20;
// Land a layer misses is filled from the parent layer from this share of the country up.
const FILL_MIN_SHARE = 1e-5;

/** Point-in-shape and distance-to-border tests over latitude bands of a shape's edges. */
function shapeIndex(polys) {
  const BAND = 0.25;
  const box = bboxOf(polys);
  const bands = new Map();
  for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
    const e = [ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]];
    for (let b = Math.floor(Math.min(e[1], e[3]) / BAND); b <= Math.floor(Math.max(e[1], e[3]) / BAND); b++) {
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(e);
    }
  }
  return {
    box,
    contains([x, y]) {
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false;
      let hit = false;
      for (const [x1, y1, x2, y2] of bands.get(Math.floor(y / BAND)) || []) {
        if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) hit = !hit;
      }
      return hit;
    },
    /** True when the shape's border passes within `km` of p. */
    near([x, y], km) {
      const ky = 111.195, kx = ky * Math.cos(y * Math.PI / 180), dy = km / ky, dx = km / kx;
      if (x < box[0] - dx || x > box[2] + dx || y < box[1] - dy || y > box[3] + dy) return false;
      for (let b = Math.floor((y - dy) / BAND); b <= Math.floor((y + dy) / BAND); b++) {
        for (const [x1, y1, x2, y2] of bands.get(b) || []) {
          if (Math.max(x1, x2) < x - dx || Math.min(x1, x2) > x + dx || Math.max(y1, y2) < y - dy || Math.min(y1, y2) > y + dy) continue;
          const ax = (x1 - x) * kx, ay = (y1 - y) * ky, ex = (x2 - x1) * kx, ey = (y2 - y1) * ky, len = ex * ex + ey * ey;
          const t = len ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len)) : 0;
          if ((ax + t * ex) ** 2 + (ay + t * ey) ** 2 <= km * km) return true;
        }
      }
      return false;
    },
  };
}

/**
 * The game's world map (countries-50m TopoJSON) as indexed shapes keyed by nation id.
 * Rings that cross the antimeridian (Russia, Fiji) are moved to 0-360° so they stay
 * simple polygons, and points west of Greenwich are tested in both frames.
 */
export function loadWorldMap(topology) {
  const byKey = new Map();
  for (const g of topology.objects.countries.geometries) {
    if (!g.type) continue;
    const name = g.properties?.name ?? '';
    const key = g.id != null ? String(g.id) : WORLD_KEYS[name] ?? `name:${name}`;
    const polys = polysOf(feature(topology, g).geometry).map(poly => {
      const [w, , e] = bboxOf([poly]);
      return e - w > 180 ? poly.map(ring => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y])) : poly;
    });
    if (!byKey.has(key)) byKey.set(key, { key, name, polys: [] });
    byKey.get(key).polys.push(...polys);
  }
  return [...byKey.values()].map(s => {
    const index = shapeIndex(s.polys);
    const wraps = index.box[2] > 180;
    const both = test => (p, ...rest) => test(p, ...rest) || (wraps && p[0] < 0 && test([p[0] + 360, p[1]], ...rest));
    return { ...s, box: wraps ? [-180, index.box[1], 180, index.box[3]] : index.box, contains: both(index.contains), near: both(index.near) };
  });
}

/**
 * A strip `km` wide on both sides of the host shapes' border within a lon/lat box: one
 * rectangle per border segment, lengthened by `km` at both ends so the joins are covered.
 */
function borderStrip(host, [w, s, e, n], km) {
  const ky = 111.195, kx = ky * Math.cos(((s + n) / 2) * Math.PI / 180), dx = km / kx, dy = km / ky;
  const strip = [];
  for (const shape of host) for (const poly of shape.polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (Math.max(x1, x2) < w - dx || Math.min(x1, x2) > e + dx || Math.max(y1, y2) < s - dy || Math.min(y1, y2) > n + dy) continue;
      const ux = (x2 - x1) * kx, uy = (y2 - y1) * ky, len = Math.hypot(ux, uy) || 1;
      const tx = ux / len * km, ty = uy / len * km;
      const at = (x, y, a, b) => [x + a / kx, y + b / ky];
      const a = at(x1, y1, -tx - ty, -ty + tx);
      strip.push([[a, at(x2, y2, tx - ty, ty + tx), at(x2, y2, tx + ty, ty - tx), at(x1, y1, -tx + ty, -ty - tx), a]]);
    }
  }
  return strip;
}

/** Interior grid samples of one polygon (about `target`), else its outer ring's vertices. */
function polySamples(poly, target) {
  const [w, s, e, n] = bboxOf([poly]);
  const step = Math.sqrt(((e - w) * (n - s)) / target) || 1e-3;
  const samples = [];
  for (let y = s + step / 2; y < n; y += step) for (let x = w + step / 2; x < e; x += step) if (pointInPolys([x, y], [poly])) samples.push([x, y]);
  return samples.length >= 8 ? samples : poly[0].slice(0, -1);
}

/**
 * Cuts from `units` the land the world map gives to another country. Polygons with
 * samples in another country's shape, deeper than FOREIGN_DEPTH_KM inside it, are
 * grouped per country where they lie within a few km of each other; a group holding
 * at least FOREIGN_MIN_KM2 of such land is cut (each polygon minus the foreign shapes
 * beyond FOREIGN_DEPTH_KM of the host's border, slivers dropped; one almost wholly
 * foreign goes), however finely its units divide it (N. Cyprus is 200 small
 * communities), while a lone exclave stays. Returns the kept
 * units (cut ones re-noded against their neighbours) and per foreign shape the km²
 * removed and the units affected.
 */
export function cutForeignLand(nationId, units, world, log = () => {}) {
  const host = hostShapes(world, nationId);
  if (!host.length) return { units, cut: [] };
  const others = world.filter(s => !host.includes(s));
  // Pass 1: classify every polygon's samples.
  const parts = [];
  units.forEach((unit, ui) => unit.polys.forEach((poly, pi) => {
    const box = bboxOf([poly]);
    const nearby = others.filter(s => !(s.box[0] > box[2] || s.box[2] < box[0] || s.box[1] > box[3] || s.box[3] < box[1]));
    if (!nearby.length) return;
    // About one sample per 40 km² (120 to 1500): a border strip of a big district must show.
    const samples = polySamples(poly, Math.min(1500, Math.max(120, polyAreaKm2(poly) / 40)));
    let own = 0;
    const foreign = new Map();
    for (const p of samples) {
      if (host.some(h => h.contains(p))) { own++; continue; }
      const shape = nearby.find(s => s.contains(p));
      if (!shape) continue;
      const f = foreign.get(shape) || { all: 0, deep: 0 };
      f.all++;
      if (!host.some(h => h.near(p, FOREIGN_DEPTH_KM))) f.deep++;
      foreign.set(shape, f);
    }
    if (![...foreign.values()].some(f => f.deep)) return;
    const area = polyAreaKm2(poly);
    parts.push({ ui, pi, poly, box, own, foreign, area, deepKm2: shape => (foreign.get(shape)?.deep ?? 0) / samples.length * area });
  }));
  // Pass 2: per foreign shape, group nearby polygons and keep the groups big enough.
  const PAD = 0.03;
  const cutBy = new Map(); // part -> shapes to cut
  for (const shape of new Set(parts.flatMap(p => [...p.foreign].filter(([, f]) => f.deep).map(([s]) => s)))) {
    const list = parts.filter(p => p.foreign.get(shape)?.deep);
    const group = list.map((_, i) => i);
    const root = i => (group[i] === i ? i : (group[i] = root(group[i])));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].box, b = list[j].box;
      if (!(a[0] > b[2] + PAD || a[2] < b[0] - PAD || a[1] > b[3] + PAD || a[3] < b[1] - PAD)) group[root(i)] = root(j);
    }
    const total = new Map();
    list.forEach((p, i) => total.set(root(i), (total.get(root(i)) || 0) + p.deepKm2(shape)));
    list.forEach((p, i) => {
      if (total.get(root(i)) < FOREIGN_MIN_KM2) return;
      if (!cutBy.has(p)) cutBy.set(p, []);
      cutBy.get(p).push(shape);
    });
  }
  // Pass 3: cut.
  const removed = new Map();
  const note = (shape, km2, unit) => {
    if (!removed.has(shape.name)) removed.set(shape.name, { shape: shape.name, km2: 0, units: new Set() });
    const r = removed.get(shape.name);
    r.km2 += km2;
    r.units.add(unit);
  };
  const next = units.map(u => ({ ...u, polys: [...u.polys] }));
  for (const [p, shapes] of cutBy) {
    const unit = next[p.ui];
    const all = [...p.foreign.values()].reduce((s, f) => s + f.all, 0);
    const share = shape => (p.foreign.get(shape)?.all ?? 0) / shapes.reduce((s, x) => s + (p.foreign.get(x)?.all ?? 0), 0);
    if (p.own < 0.05 * (p.own + all)) {
      for (const shape of shapes) note(shape, p.area * share(shape), unit.name);
      unit.polys[p.pi] = null;
      continue;
    }
    try {
      const [w, s, e, n] = p.box.map((v, i) => v + (i < 2 ? -0.05 : 0.05));
      const frame = [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
      const cutters = shapes.flatMap(shape => shape.polys.filter(q => {
        const b = bboxOf([q]);
        return !(b[0] > e || b[2] < w || b[1] > n || b[3] < s);
      })).flatMap(q => polygonClipping.intersection([q], frame));
      // Only the foreign land beyond FOREIGN_DEPTH_KM of the host's border goes: the 1:50m
      // border cuts through towns (Jerusalem, Metković, Narva) that are the host's own.
      const eroded = cutters.length ? polygonClipping.difference(polygonClipping.union(...cutters), ...borderStrip(host, [w, s, e, n], FOREIGN_DEPTH_KM)) : [];
      const pieces = polygonClipping.difference([p.poly], ...eroded).filter(q => polyAreaKm2(q) >= Math.max(1, 0.002 * p.area));
      const left = pieces.reduce((t, q) => t + polyAreaKm2(q), 0);
      for (const shape of shapes) note(shape, (p.area - left) * share(shape), unit.name);
      unit.polys[p.pi] = pieces;
    } catch (error) {
      log(`    cutting foreign land from ${unit.name} failed: ${error.message}`);
    }
  }
  const changed = new Set(next.filter((u, i) => u.polys.some((q, k) => q !== units[i].polys[k])));
  for (const u of next) u.polys = u.polys.flatMap(q => (q === null || !q.length ? [] : Array.isArray(q[0]?.[0]?.[0]) ? q : [q]));
  const kept = next.filter(u => u.polys.length);
  // The cuts' new border vertices must also sit on the neighbours' rings to share arcs.
  if (changed.size) {
    const boxes = [...changed].filter(u => u.polys.length).map(u => bboxOf(u.polys));
    const overlaps = (a, b) => !(a[0] > b[2] + 1e-6 || a[2] < b[0] - 1e-6 || a[1] > b[3] + 1e-6 || a[3] < b[1] - 1e-6);
    nodeRings(kept.filter(u => changed.has(u) || boxes.some(b => overlaps(bboxOf(u.polys), b))));
  }
  const cut = [...removed.values()].filter(r => r.km2 >= 1).sort((a, b) => b.km2 - a.km2 || a.shape.localeCompare(b.shape))
    .map(r => ({ shape: r.shape, km2: Math.round(r.km2), units: [...r.units].sort() }));
  return { units: changed.size ? kept : units, cut };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
// The metadata spells missing values as 'nan' (pandas) or leaves them empty.
const clean = v => (v == null || /^(nan|none|null|)$/i.test(String(v).trim()) ? undefined : String(v).trim());

/**
 * Cached download of url into file: one request at a time however many callers
 * (the builder's worker threads all go through the main thread's downloader),
 * 0.5 s apart, four tries. `offline` turns a cache miss into an error (--check).
 * JSON bodies are checked before caching; with `member` the body is a zip and that
 * member's text is cached instead (GeoNames dumps).
 */
export function createDownloader({ offline = false, log = () => {} } = {}) {
  let lastRequest = 0;
  let queue = Promise.resolve();

  async function fetchToCache(url, file, member) {
    if (existsSync(file)) return readFile(file, 'utf8'); // fetched while this call waited
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(2000 * 2 ** (attempt - 1));
      const wait = lastRequest + 500 - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequest = Date.now();
      try {
        log(`  download ${url}`);
        const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(300000) });
        if (response.status === 404) throw Object.assign(new Error(`HTTP 404 for ${url}`), { fatal: true });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        let text;
        if (member) {
          const files = unzipSync(new Uint8Array(await response.arrayBuffer()), { filter: f => f.name === member });
          if (!files[member]) throw new Error(`${url} has no ${member}`);
          text = strFromU8(files[member]);
        } else {
          text = await response.text();
          JSON.parse(text); // never cache a truncated or HTML error body
        }
        if (!text.trim()) throw new Error(`Empty body for ${url}`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.part`, text);
        await rename(`${file}.part`, file);
        return text;
      } catch (error) {
        lastError = error;
        if (error.fatal) break;
      }
    }
    throw lastError;
  }

  return (url, file, { member } = {}) => {
    if (existsSync(file)) return readFile(file, 'utf8');
    if (offline) return Promise.reject(new Error(`Boundary cache miss (offline): ${path.relative(process.cwd(), file)} for ${url}`));
    const run = queue.then(() => fetchToCache(url, file, member));
    queue = run.catch(() => {});
    return run;
  };
}

// ---- Unit names ----

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const OTHER_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
const LATIN = /\p{Script=Latin}/u;
const HOMOGLYPHS = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I' };
const SMALL_WORDS = new Set(['de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'la', 'le', 'les', 'el', 'y', 'e', 'and', 'of', 'on', 'upon', 'in', 'am', 'an', 'der', 'nad', 'pod', 'na', 'sur', 'sous', 'en', 'au', 'aux', 'lui']);
const ORDINAL = /\b\d+(st|nd|rd|th|ro|ra|er|re|e|o|a|º|ª)\b\.?/gi;

const titleCase = s => s.toLowerCase().replace(/\p{L}+/gu, (w, at) => (at > 0 && SMALL_WORDS.has(w) ? w
  : /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

/** A source name with encoding damage, layout junk and per-layer quirks removed. */
export function tidyName(raw, iso3) {
  let s = String(raw ?? '');
  // UTF-8 read as Latin-1 (Côte d'Ivoire, Peru: Bouaké spelt with two odd letters).
  if (/[ÃÂ][\u0080-\u00bf]/.test(s) && [...s].every(ch => ch.charCodeAt(0) <= 0xff)) {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (!fixed.includes('\ufffd')) s = fixed;
  }
  s = s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  // Cyrillic look-alike letters inside Latin words (Uzbekistan's "Zaаmin").
  s = s.replace(/\p{L}+/gu, w => (LATIN.test(w) && /\p{Script=Cyrillic}/u.test(w) ? [...w].map(ch => HOMOGLYPHS[ch] ?? ch).join('') : w));
  // A Latin name followed by the same in another script (Morocco).
  if (LATIN.test(s) && OTHER_SCRIPT.test(s)) s = s.split(' ').filter(w => !OTHER_SCRIPT.test(w)).join(' ');
  if (iso3 === 'NOR') s = s.replace(/(\s+(nor|sme|sma|smj|fkv))+$/, '').replace(/"/g, '');
  if (iso3 === 'IRL') s = s.replace(/[\s-]*LEA-\d+$/i, '');
  if (iso3 === 'MAR') {
    s = s.replace(/^(Province|Préfecture|Prefecture)( d'arrondissements)? (de |d'|du |des |of )/i, '').replace(/ (Province|Prefecture)$/i, '')
      .replace(/\s+-\s+/g, '-').replace(/[\s–,/-]+$/, '');
  }
  if (iso3 === 'RUS') s = s.replace(/\s+\(municipal formation\)$/i, '').replace(/\s+(Urban Okrug|Municipality|City District)$/i, '');
  if (iso3 === 'CAN') s = s.split(' / ')[0]; // bilingual names, the French half cut off
  // Administrative words every name of the layer starts with.
  if (iso3 === 'SVK') s = s.replace(/^District of /, '');
  if (iso3 === 'XKX') s = s.replace(/^Municipality of /, '');
  if (iso3 === 'HRV') s = s.replace(/^(Grad|Općina|Otok) /, '');
  if (iso3 === 'CHN') s = s.replace(/(?<=\p{L}{3})(shi|xian|qu)$/u, ''); // Beijingshi: Beijing city
  s = s.replace(/^"(.*)"$/, '$1')
    .replace(/\s*\[[^\]]*\]$/, '') // "Nam-gu [South District]"
    .replace(/\s*\/?\|\s*/g, ' / ') // Brussels: "Ixelles | Elsene"
    .replace(/_?OtherIs$/, ' (other islands)')
    .replace(/_/g, ' ')
    .replace(/`/g, "'") // a soft sign, "Maktaaral`skiy"
    .replace(/\s*\(R\d+\)$/, '') // Ethiopia's region codes
    .replace(/\s*\((municipio|municipality|city|town|cor\. departamental|corregimiento departamental)\)/gi, '')
    .replace(/--/g, '–')
    .replace(/^(powiat|gmina) /, w => w[0].toUpperCase() + w.slice(1))
    .replace(/^(.+), (City|County|Borough|Town) of$/, '$1') // "Bristol, City of"
    .replace(/\s+/g, ' ').trim();
  return s;
}

/** What is wrong with a tidied name (soft flags only count in a garbled layer). */
export function nameFlags(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  const hard = /\p{L}\d|\d\p{L}/u.test(s.replace(ORDINAL, ' ')) || /[:?\\|[\]{}<>=#@$%^~\u00a9\u00b9]/.test(s) || !letters.length
    || OTHER_SCRIPT.test(s) || /^(Unit|Region|Zone) \d+$/i.test(s) || /^(data not available|unknown|n\/?a|none|null)$/i.test(s) || /\ufffd/.test(s);
  const soft = letters.length <= 2 || (/^\p{Ll}/u.test(s) && !/^(\p{Ll}\p{Lu}|l'|d'|la |le |les |el |de |du |des |di |da |do |dos |das |os |as )/u.test(s));
  // Corruption, as opposed to another script or a placeholder: what makes a layer garbled.
  const corrupt = !OTHER_SCRIPT.test(s) && (soft || /\p{L}\d|\d\p{L}/u.test(s.replace(ORDINAL, ' ')) || /[:?\u00a9\u00b9]|[ÃÂ][\u0080-\u00bf]/.test(s));
  return { hard, soft, corrupt, truncated: /\*$/.test(s) };
}

// Administrative words around a name, for matching it against place names.
const GENERIC = /^(district of|municipality of|city of|town of|county of|province of|comune di|gmina|powiat|okres|rayon|raion|municipio|distrito|departamento|delegation|городской округ|муниципальный округ|муниципальный район|город|сельское поселение)\s+|\s+-?\s*okolie$|\s+(district|municipality|municipal|county|city|town|township|province|region|urban okrug|okrug|rayon|raion|municipio|kommune|kommun|kunta|község|város|járás|район|городской округ|муниципальный округ|городской ок\S*|городской о\S*|округ)$/i;
const FOLD = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' };

/** Comparison key: lowercase, accents and separators gone; in a garbled name other symbols are wildcards. */
const matchKey = (s, wild = false) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[ßøæœłđðþıħ]/g, c => FOLD[c])
  .replace(/[\s\-'’.,()/–]/g, '').replace(/[^\p{L}]/gu, wild ? '?' : '');

/** Edit distance; '?' in g matches any letter (or nothing, at half cost); `prefix` lets c run on. */
function editDistance(g, c, prefix) {
  let prev = Array.from({ length: c.length + 1 }, (_, j) => j);
  for (let i = 1; i <= g.length; i++) {
    const cur = [i];
    const wild = g[i - 1] === '?';
    for (let j = 1; j <= c.length; j++) {
      cur.push(Math.min(prev[j - 1] + (wild || g[i - 1] === c[j - 1] ? 0 : 1), prev[j] + (wild ? 0.5 : 1), cur[j - 1] + 1));
    }
    prev = cur;
  }
  return prefix ? Math.min(...prev) : prev[c.length];
}

/** Two spellings of one name (accents, transliteration): Al Mahallah al Kubra and El Mahalla El Kobra. */
export function sameName(a, b) {
  const x = matchKey(a), y = matchKey(b);
  return x === y || editDistance(x, y, false) <= 0.3 * Math.max(x.length, y.length);
}

const CYRILLIC = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g' };
/** Russian names in the style of the layer's Latin ones ("Sverdlovsky District"). */
function transliterate(s) {
  const t = s.replace(/^(городской округ|муниципальный округ|город|ЗАТО)\s+/i, '').replace(/\s+(городской округ|городской о\S*|муниципальный округ)$/i, '')
    .replace(/\s+(муниципальный район|район)$/i, ' District').replace(/\s+округ$/i, ' Okrug')
    .replace(/(с|ц)кий\b/gi, (m, c) => `${c}ky`).replace(/ый\b/gi, 'y').replace(/ий\b/gi, 'iy').replace(/ой\b/gi, 'oy');
  return t.replace(/\p{Script=Cyrillic}+/gu, w => {
    const out = [...w].map(ch => { const l = ch.toLowerCase(); const r = CYRILLIC[l] ?? l; return ch !== l ? r.charAt(0).toUpperCase() + r.slice(1) : r; }).join('');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }).replace(/\s+/g, ' ').trim();
}

// GeoNames spells places of these countries in romanisations full of marks (Ar Rayyān,
// Al Julay‘ah); their ASCII forms read better, as do names elsewhere carrying such marks.
const ROMANISED = new Set('AE BH DZ EG IQ JO KW LB LY MA OM PS QA SA SY TN YE IR AF PK RU BY UA BG MK KZ KG TJ TM UZ MN CN TW HK MO JP KR KP GR CY IL TH LA KH MM GE AM IN BD NP LK ET ER'.split(' '));
const TRANSLIT_MARKS = /[\u02b0-\u02ff\u2018\u2019\u1e00-\u1eff]|z\u0327/;

/**
 * Names for a layer's units, made readable. `units` is the whole layer (for its
 * statistics), `places` GeoNames places of the country (the full country file for a
 * garbled layer), `regionAt(point)` the Natural Earth admin-1 name there. A name
 * that is broken (digits inside words, '?', mojibake, only digits, another script,
 * a placeholder) or cut off ('*') becomes the GeoNames place inside the unit whose
 * name matches it best, else (Cyrillic) a transliteration, else the most populous
 * place inside, else the region. A layer is garbled when many names are broken or
 * one or two letters long (HUN and CZE ADM3 turn accents into digits, colons or
 * nothing): there every name is checked against the places inside its unit. In any
 * layer a name that differs from such a place only where the place has accents takes
 * the place's spelling (SVK: "District of Pilina" for Žilina; EST: "Parnu").
 * Returns { garbled, name(unit), town(unit), place(place) }, memoised by unit id.
 */
export function createNamer(units, { iso3, a2, places = [], regionAt = () => null }) {
  const romanised = ROMANISED.has(a2);
  const tidy = new Map(units.map(u => [u.id, tidyName(u.name, iso3)]));
  const flags = [...tidy.values()].map(nameFlags);
  const garbled = flags.filter(f => f.corrupt).length > 0.05 * flags.length;
  const caps = [...tidy.values()].filter(s => /\p{L}{3}/u.test(s) && s === s.toUpperCase()).length > 0.5 * tidy.size;
  // The country's accented letters: in two of the layer's names, or in 0.1 % of the places' names.
  const accents = (names, min) => {
    const seen = new Map();
    for (const s of names) for (const ch of new Set(s.toLowerCase())) if (ch > '\u007f' && /\p{Script=Latin}/u.test(ch)) seen.set(ch, (seen.get(ch) || 0) + 1);
    return [...seen].filter(([, k]) => k >= min).map(([ch]) => ch);
  };
  const alphabet = new Set([...accents(tidy.values(), 2), ...accents(places.map(p => p.name), Math.max(3, places.length / 1000))]);
  const foreign = t => [...t].filter(ch => /\p{Script=Latin}/u.test(ch) && ch > '\u007f' && !alphabet.has(ch.toLowerCase())).length;
  // A spelling's worth: the country's accents, no foreign ones, no transliteration apostrophes.
  const score = t => [...t].filter(ch => alphabet.has(ch.toLowerCase())).length - 5 * foreign(t) - 10 * (t.match(/['`’ʹ]/g) || []).length;
  // Places on a 1° grid, most populous first.
  const grid = new Map();
  for (const p of [...places].sort((a, b) => b.pop - a.pop || a.id - b.id)) {
    const k = `${Math.floor(p.lon)},${Math.floor(p.lat)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const inside = unit => {
    const [w, s, e, n] = bboxOf(unit.polys);
    const found = [];
    for (let x = Math.floor(w); x <= Math.floor(e); x++) for (let y = Math.floor(s); y <= Math.floor(n); y++) {
      for (const p of grid.get(`${x},${y}`) || []) if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n && pointInPolys([p.lon, p.lat], unit.polys)) found.push(p);
    }
    return found.sort((a, b) => b.pop - a.pop || a.id - b.id);
  };
  // The best-matching place and the spelling that matched: exact on any of its names,
  // else the smallest edit distance (equal ones: the better spelling). A garbled one- or
  // two-letter name is the start of a name whose next letter was lost (HUN: "S" for
  // Sényő), preferred to a plain prefix.
  const bestMatch = (core, candidates, { truncated }) => {
    const g = matchKey(core, true);
    const head = g.replace(/\?/g, '');
    let best = null;
    for (const p of candidates) {
      for (const text of [p.name, p.ascii, ...p.alt]) {
        const c = matchKey(text);
        if (!c) continue;
        let d;
        if (head.length <= 2) d = garbled && c.startsWith(head) ? (/[^a-z]/i.test(text.charAt(head.length)) ? 0.25 : 0.5) : Infinity;
        else d = Math.min(editDistance(g, c, false), editDistance(g, c, true) + (truncated ? 0 : 0.5));
        if (!best || d < best.d || (d === best.d && best.p === p && score(text) > score(best.text))) best = { p, d, text };
        if (d === 0) {
          // Of the place's exact spellings: its own name when that is written in the layer's
          // alphabet (Satu Mare, Győr), else the best one (Plzeň for GeoNames' "Pilsen").
          if (matchKey(p.name) === c && !foreign(p.name)) return { p, d, text: p.name };
          const exact = [p.ascii, ...p.alt].filter(t => matchKey(t) === c);
          return { p, d, text: exact.reduce((a, t) => (score(t) > score(a) ? t : a), exact[0] ?? p.name) };
        }
      }
    }
    return best && best.d <= (head.length <= 2 ? 0.5 : Math.max(1, 0.3 * head.length)) ? best : null;
  };
  // A match is shown in the spelling that matched when that is Latin and close, else as
  // the place's own name (its ASCII form where the country's script is not Latin).
  const placeName = p => (romanised || TRANSLIT_MARKS.test(p.name) ? (p.ascii || p.name).replace(/`/g, "'") : p.name);
  const shown = m => (!romanised && !OTHER_SCRIPT.test(m.text) && m.d < 1 ? m.text : placeName(m.p));
  // The name inside administrative words and a district numeral (Košice IV).
  const coreOf = s => s.replace(GENERIC, '').replace(/\s+[IVX]+$/, '').trim() || s;
  // A source name that lost the place's accents: equal but for them (Parnu), up to three
  // of them turned into other letters or dropped (Trencon, Trebi ov), or cut off just
  // before one (Liptovsk). Any other difference, such as an inflected ending (powiat
  // mielecki, Mielec), is not damage.
  const restorable = (core, p) => {
    const text = p.name;
    if (romanised || OTHER_SCRIPT.test(text) || foreign(text)) return false;
    const a = matchKey(core);
    let b = '';
    const accented = [];
    for (const ch of text) for (const x of matchKey(ch)) { b += x; accented.push(ch > '\u007f'); }
    if (a === b) return score(text) > score(core) || (caps && text !== core);
    // Align, editing only where the place has an accented letter: one replaced or dropped
    // (Trebi ov for Trebišov), or the name cut off just before one.
    const edit = j => (accented[j] ? 1 : Infinity);
    let prev = [0];
    for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + edit(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cur = [Infinity];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : edit(j - 1)), cur[j - 1] + edit(j - 1));
      prev = cur;
    }
    let cut = Infinity;
    for (let j = Math.max(4, a.length); j < b.length; j++) if (accented[j]) cut = Math.min(cut, prev[j]);
    return (prev[b.length] >= 1 && prev[b.length] <= 3) || cut <= 3;
  };
  const done = new Map();
  function name(unit) {
    if (done.has(unit.id)) return done.get(unit.id);
    let s = tidy.get(unit.id) ?? tidyName(unit.name, iso3);
    const { hard, soft, truncated } = nameFlags(s);
    if (truncated) s = s.replace(/\s*\*$/, '');
    // An abbreviation for a name ("KT" in Ethiopia) is broken too, unless the layer shouts.
    const broken = hard || (garbled && soft) || (!caps && /^[A-Z]{1,3}$/.test(s));
    const script = OTHER_SCRIPT.test(s);
    const core = coreOf(s);
    const wrap = place => (core === s || script ? place : s.replace(core, place));
    let out = s;
    const candidates = inside(unit);
    const match = candidates.length && !(script && / (район|муниципальный район)$/i.test(s)) ? bestMatch(core, candidates, { truncated }) : null;
    if (match && (broken || truncated || garbled)) out = wrap(shown(match));
    else if (match && restorable(core, match.p)) out = wrap(match.p.name);
    else if (broken || (garbled && candidates.length)) {
      if (script && /\p{Script=Cyrillic}/u.test(s)) out = transliterate(s);
      else if (candidates.length) out = wrap(placeName(candidates[0]));
      else out = regionAt(centroidOf(unit.polys)) || s;
    } else if (truncated && candidates[0]?.pop >= 50000) {
      out = placeName(candidates[0]); // a city's long official name, cut off (Barranquilla's district)
    } else if (truncated) {
      // Cut mid-word: drop the partial word and any connector left dangling.
      out = s.replace(/\s*\S+$/, '').replace(/[\s–,/-]+(and|y|et|e|de|of|la|le|du|des|del|di|da|do|bei|an|am|im|in|nad|pod)?$/i, '').trim() || s;
    }
    if (caps && out === out.toUpperCase()) out = titleCase(out);
    done.set(unit.id, out);
    return out;
  }
  /** The unit's main town: its most populous place, else its own name without administrative words. */
  const town = unit => {
    const p = inside(unit).find(q => q.pop > 0);
    const own = coreOf(name(unit));
    if (!p) return own;
    // The unit's own spelling when it names the same place (Torino, not GeoNames' Turin).
    const key = matchKey(own);
    return [p.name, p.ascii, ...p.alt].some(t => matchKey(t) === key) ? own : placeName(p);
  };
  /** A GeoNames place as a section name (a section built around it), in Latin script. */
  const place = p => { const s = placeName(p); return OTHER_SCRIPT.test(s) ? (p.ascii || s).replace(/`/g, "'") : s; };
  return { garbled, name, town, place };
}

/** Boundary loader bound to one cache directory; `download` as from createDownloader. */
export function createBoundarySource({ cacheDir, worldFile, offline = false, log = () => {}, download = createDownloader({ offline, log }) }) {
  let metaRows = null;
  let worldShapes = null;
  const world = async () => (worldShapes ??= loadWorldMap(JSON.parse(await readFile(worldFile, 'utf8'))));

  // GeoNames populated places: cities1000 (seeded from the club sync's copy when there
  // is one), or a country's full file where a layer's names need villages too.
  let cityLines = null;
  const parsePlace = f => ({ id: +f[0], name: f[1], ascii: f[2], alt: f[3] ? f[3].split(',') : [], lat: +f[4], lon: +f[5], code: f[7], admin1: f[10], pop: +f[14] || 0 });
  async function places(a2, { admin1 = null, full = false } = {}) {
    let lines;
    if (full) {
      lines = (await download(`${GN_DUMP}/${a2}.zip`, path.join(cacheDir, 'geonames', `${a2}.txt`), { member: `${a2}.txt` })).split('\n');
    } else {
      if (!cityLines) {
        const file = path.join(cacheDir, 'geonames', 'cities1000.txt');
        const synced = path.join(path.dirname(cacheDir), 'domestic', 'geonames', 'cities1000.txt');
        if (!existsSync(file) && existsSync(synced)) {
          await mkdir(path.dirname(file), { recursive: true });
          await copyFile(synced, `${file}.${process.pid}.${threadId}.part`);
          await rename(`${file}.${process.pid}.${threadId}.part`, file);
        }
        cityLines = (await download(`${GN_DUMP}/cities1000.zip`, file, { member: 'cities1000.txt' })).split('\n');
      }
      lines = cityLines;
    }
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      const f = line.split('\t');
      if (f[8] === a2 && f[6] === 'P' && (!admin1 || f[10] === admin1)) out.push(parsePlace(f));
    }
    return out.sort((a, b) => a.id - b.id);
  }

  /** Natural Earth admin-1 region name at a point (lon/lat), for names and their disambiguation. */
  async function regions(iso3, a2) {
    const a3 = NE_A3[iso3] || iso3;
    const pick = p => (ROMANISED.has(a2) ? p.name_en || p.name : p.name || p.name_en);
    const list = (await naturalEarth()).filter(f => f.properties.adm0_a3 === a3)
      .map(f => ({ name: pick(f.properties), polys: polysOf(f.geometry) })).filter(r => r.name && r.polys.length);
    for (const r of list) r.box = bboxOf(r.polys);
    return p => list.find(r => p[0] >= r.box[0] && p[0] <= r.box[2] && p[1] >= r.box[1] && p[1] <= r.box[3] && pointInPolys(p, r.polys))?.name ?? null;
  }
  async function meta() {
    if (!metaRows) metaRows = JSON.parse(await download(GB_META_URL, path.join(cacheDir, 'gbOpen-ALL-ALL.json')));
    return metaRows;
  }

  async function gbFeatures(row) {
    const file = path.join(cacheDir, 'gb', `${row.boundaryISO}-${row.boundaryType}.geojson`);
    return JSON.parse(await download(row.simplifiedGeometryGeoJSON, file)).features;
  }

  let neFeatures = null;
  async function naturalEarth() {
    if (!neFeatures) neFeatures = JSON.parse(await download(NE_URL, path.join(cacheDir, 'ne', 'ne_10m_admin_1.geojson'))).features;
    return neFeatures;
  }

  /** Usable gbOpen layers of a country, coarsest first (ADM0 only as a last resort). */
  async function layers(iso3) {
    const byType = new Map();
    // A few countries list one level twice (India ADM1: 1 and 36 units); keep the richer row.
    for (const row of await meta()) {
      if (row.boundaryISO !== iso3 || BLOCKED_LICENSES.has(row.boundaryLicense)) continue;
      const seen = byType.get(row.boundaryType);
      if (!seen || Number(row.admUnitCount) > Number(seen.admUnitCount)) byType.set(row.boundaryType, row);
    }
    return [...byType.values()].sort((a, b) => a.boundaryType.localeCompare(b.boundaryType));
  }

  /** England-style mask: keep units whose centroid is in the mask polygon (nearest vertex decides misses). */
  async function applyMask(units, mask) {
    const parents = (await gbFeatures((await layers(mask.iso3)).find(row => row.boundaryType === mask.level)))
      .map(f => ({ key: f.properties.shapeISO, polys: polysOf(f.geometry) }));
    return units.filter(unit => {
      const c = centroidOf(unit.polys);
      let hit = parents.find(p => pointInPolys(c, p.polys));
      if (!hit) {
        let best = Infinity;
        for (const p of parents) {
          for (const poly of p.polys) for (const [x, y] of poly[0]) {
            const d = ((x - c[0]) * Math.cos(c[1] * Math.PI / 180)) ** 2 + (y - c[1]) ** 2;
            if (d < best) { best = d; hit = p; }
          }
        }
      }
      return hit?.key === mask.shapeISO;
    });
  }

  const toUnits = (features, nameOf, idOf) => features
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f, i) => ({ id: idOf(f, i), name: nameOf(f) || `Unit ${i + 1}`, polys: polysOf(f.geometry) }))
    .filter(unit => unit.polys.length);

  /**
   * Drops every polygon mostly in an EXCLUDES territory: over half its interior samples
   * in it or within 3 km (the sources' coastlines differ: geoBoundaries' Macau takes in
   * the water whose middle Natural Earth leaves out). Returns the kept units and what went.
   */
  async function excludeTerritories(nationId, units) {
    const a3s = EXCLUDES[nationId];
    if (!a3s) return { units, dropped: [] };
    const regions = (await naturalEarth()).filter(f => a3s.includes(f.properties.adm0_a3)).map(f => polysOf(f.geometry)).flat();
    const [rw, rs, re, rn] = bboxOf(regions);
    const near = p => pointInPolys(p, regions) || kmToPolys(p, regions) <= 3;
    const excluded = poly => {
      const [w, s, e, n] = bboxOf([poly]);
      if (w > re + 0.1 || e < rw - 0.1 || s > rn + 0.1 || n < rs - 0.1) return false;
      const step = Math.sqrt(((e - w) * (n - s)) / 60) || 1e-3;
      const samples = [];
      for (let y = s + step / 2; y < n; y += step) for (let x = w + step / 2; x < e; x += step) if (pointInPolys([x, y], [poly])) samples.push([x, y]);
      const points = samples.length >= 5 ? samples : poly[0];
      return points.filter(near).length > points.length / 2;
    };
    const dropped = [];
    const kept = units.map(unit => {
      const polys = unit.polys.filter(poly => !excluded(poly));
      if (polys.length < unit.polys.length) dropped.push(unit.name);
      return polys.length === unit.polys.length ? unit : { ...unit, polys };
    }).filter(unit => unit.polys.length);
    return { units: kept, dropped };
  }

  /**
   * Admin units for a game nation and club count n, following the spec's level
   * rule: the coarsest layer with >= 2n units, else the finest with >= n, else the
   * finest available (equal counts prefer the coarser layer). Natural Earth admin-1
   * stands in when no gbOpen layer is usable, then ADM0. The listed unit counts can
   * be wrong (XKX ADM1 lists 48 units, its file holds 7), so a layer's real count
   * replaces the listed one once loaded and the rule runs again. A layer must cover
   * the country: within 10% of the median area of its layers (Uruguay's municipios
   * cover a third of it, Malaysia's ADM3 lacks Sabah, Venezuela's ADM2 adds the
   * Essequibo claim). EXCLUDES territories are cut from the picked units.
   */
  async function unitsFor(nationId, n) {
    const picked = await pickUnits(nationId, n);
    const excluded = await excludeTerritories(nationId, picked.units);
    if (excluded.dropped.length) log(`  excluded ${EXCLUDES[nationId].join(', ')}: parts of ${excluded.dropped.length} units (${excluded.dropped.join(', ')})`);
    const { units, cut } = cutForeignLand(nationId, excluded.units, await world(), log);
    if (cut.length) log(`  cut land the world map gives to others: ${cut.map(c => `${c.shape} ${c.km2} km² (${c.units.length} units)`).join(', ')}`);
    if (!excluded.dropped.length && !cut.length) return picked;
    const { filled, ...boundaries } = picked.boundaries;
    const stillFilled = filled?.units.filter(name => units.some(u => u.name === name)) ?? [];
    return {
      ...picked, units,
      boundaries: {
        ...boundaries, ...(stillFilled.length ? { filled: { ...filled, units: stillFilled } } : {}),
        ...(excluded.dropped.length ? { excluded: EXCLUDES[nationId], excludedSource: 'Natural Earth 1:10m Admin 1 (v5.1.2), Public Domain', excludedUrl: NE_URL } : {}),
        ...(cut.length ? { foreign: { source: WORLD_SOURCE, cut: cut.map(({ shape, km2 }) => ({ shape, km2 })) } } : {}),
      },
    };
  }

  async function pickUnits(nationId, n) {
    const iso3 = ISO3[nationId];
    if (!iso3) throw new Error(`No ISO alpha-3 code for nation ${nationId}`);
    const mask = MASKS[nationId];
    const all = await layers(iso3);
    const areaOf = row => Number(row.meanAreaSqKM) * Number(row.admUnitCount) || 0;
    const reference = median(all.map(areaOf).filter(a => a > 0));
    const covers = (row, area) => {
      if (mask || !reference || (area >= 0.9 * reference && area <= 1.1 * reference)) return true;
      log(`  skip ${iso3} ${row.boundaryType}: covers ${Math.round(area / reference * 100)}% of the country`);
      return false;
    };
    let rows = all.filter(row => row.boundaryType !== 'ADM0' && covers(row, areaOf(row)));
    const loaded = new Map();
    const load = async row => {
      if (!loaded.has(row.boundaryType)) {
        const units = toUnits(await gbFeatures(row), f => f.properties.shapeName, (f, i) => String(i));
        loaded.set(row.boundaryType, mask ? await applyMask(units, mask) : units);
        if (!covers(row, units.reduce((t, u) => t + polysAreaKm2(u.polys), 0))) rows = rows.filter(r => r !== row);
      }
      return loaded.get(row.boundaryType);
    };
    if (mask) for (const row of rows) await load(row); // masked counts need the files
    const finest = list => list.reduce((best, c) => (!best || c.count > best.count ? c : best), null);
    for (;;) {
      const candidates = rows.map(row => ({ row, count: loaded.get(row.boundaryType)?.length ?? (Number(row.admUnitCount) || 0) }));
      const pick = candidates.find(c => c.count >= 2 * n) || finest(candidates.filter(c => c.count >= n)) || finest(candidates);
      if (!pick || !pick.count) break;
      if (loaded.has(pick.row.boundaryType)) {
        const parent = mask ? null : rows.filter(r => r.boundaryType < pick.row.boundaryType).pop();
        const { units, filled } = parent ? await fillParents(loaded.get(pick.row.boundaryType), parent) : { units: loaded.get(pick.row.boundaryType), filled: [] };
        const result = await gbResult(iso3, pick.row, units, mask);
        if (filled.length) {
          log(`  filled from ${parent.boundaryType}: ${filled.join(', ')}`);
          result.boundaries.filled = { level: parent.boundaryType, units: filled, license: parent.boundaryLicense, source: clean(parent.boundarySource), url: parent.simplifiedGeometryGeoJSON };
        }
        return result;
      }
      await load(pick.row);
    }
    const ne = await naturalEarthUnits(iso3, mask);
    if (ne) return ne;
    const adm0 = all.find(row => row.boundaryType === 'ADM0');
    if (adm0) return gbResult(iso3, adm0, toUnits(await gbFeatures(adm0), f => f.properties.shapeName, (f, i) => String(i)), mask);
    throw new Error(`No boundaries for ${nationId} (${iso3})`);
  }

  /**
   * Some layers leave out land the next coarser layer has: whole parents (RUS ADM2 has
   * no Moscow or Saint Petersburg) or parts of one (KWT ADM2 lacks Bubiyan, which KWT
   * ADM1 has in Jahra). Each polygon of a parent whose interior samples mostly fall
   * outside the chosen units joins, minus those units, as a unit of its own when the
   * missing land is at least FILL_MIN_SHARE of the layer (and 5 km²).
   */
  async function fillParents(units, parentRow) {
    const parents = toUnits(await gbFeatures(parentRow), f => f.properties.shapeName, (f, i) => `${parentRow.boundaryType}-${i}`);
    const boxes = units.map(u => bboxOf(u.polys));
    const hits = (b, q) => !(b[0] > q[2] || b[2] < q[0] || b[1] > q[3] || b[3] < q[1]);
    const indexes = new Map(); // a unit's edge index, built when a sample first falls in its box
    const indexOf = i => indexes.get(i) ?? indexes.set(i, shapeIndex(units[i].polys)).get(i);
    const covered = p => boxes.some((b, i) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && indexOf(i).contains(p));
    const minKm2 = Math.max(5, FILL_MIN_SHARE * units.reduce((t, u) => t + polysAreaKm2(u.polys), 0));
    const filled = [];
    for (const parent of parents) {
      const polys = [];
      parent.polys.forEach(poly => {
        const area = polyAreaKm2(poly);
        if (area < minKm2) return;
        const samples = polySamples(poly, 60);
        const missing = samples.filter(p => !covered(p)).length;
        if (missing <= samples.length / 2 || missing / samples.length * area < minKm2) return;
        const box = bboxOf([poly]);
        const near = units.filter((u, i) => hits(boxes[i], box)).map(u => u.polys);
        try {
          polys.push(...polygonClipping.difference([poly], ...near).filter(q => polyAreaKm2(q) >= minKm2 / 4));
        } catch (error) {
          log(`    filling ${parent.name} failed: ${error.message}`);
        }
      });
      if (polys.length) filled.push({ ...parent, polys });
    }
    if (filled.length) {
      const fresh = filled.map(u => bboxOf(u.polys));
      nodeRings([...filled, ...units.filter((u, i) => fresh.some(b => hits(boxes[i], b)))]);
    }
    return { units: [...units, ...filled], filled: filled.map(p => p.name) };
  }

  async function gbResult(iso3, row, units, mask) {
    const maskRow = mask && (await layers(mask.iso3)).find(r => r.boundaryType === mask.level);
    return {
      provider: 'geoBoundaries', iso3, level: row.boundaryType, units,
      boundaries: {
        provider: 'geoBoundaries', iso3, level: row.boundaryType, ...(mask ? { mask: mask.name } : {}),
        license: row.boundaryLicense, licenseDetail: clean(row.licenseDetail),
        source: clean(row.boundarySource), year: clean(row.boundaryYearRepresented), canonical: clean(row.boundaryCanonical),
        boundaryId: row.boundaryID, url: row.simplifiedGeometryGeoJSON,
        ...(maskRow ? { maskSource: clean(maskRow.boundarySource), maskLicense: maskRow.boundaryLicense, maskUrl: maskRow.simplifiedGeometryGeoJSON } : {}),
      },
    };
  }

  async function naturalEarthUnits(iso3, mask) {
    const a3 = NE_A3[iso3] || iso3;
    const features = (await naturalEarth()).filter(f => f.properties.adm0_a3 === a3
      && (!mask || f.properties[mask.neField] === mask.neValue));
    if (!features.length) return null;
    const units = toUnits(features, f => f.properties.name || f.properties.name_en, (f, i) => String(i));
    return {
      provider: 'Natural Earth', iso3, level: 'admin-1', units,
      boundaries: {
        provider: 'Natural Earth', iso3, level: 'admin-1', ...(mask ? { mask: mask.neValue } : {}),
        license: 'Public Domain', source: 'Natural Earth 1:10m Cultural Vectors, Admin 1 – States, Provinces (v5.1.2)', url: NE_URL,
      },
    };
  }

  return { meta, layers, unitsFor, places, regions, world };
}
