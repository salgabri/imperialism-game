// Section partition for domestic campaigns (docs/design/domestic-campaigns.md,
// "Section partition"): admin units plus club home points become one section per
// club (format 1), or 100 sections in one group per club (format 2: each club's
// section cut into its group), dissolved into a TopoJSON whose neighbouring sections
// share arcs.
// Beyond the spec's steps (partitionCountry runs them in order): multi-part units
// are exploded into single polygons so sections stay contiguous, a unit shared by
// clubs is also cut when seeding would push one of them far from home, and growth
// is bounded so empty land goes to the nearest clubs (see splitUnits, growSections).
// Everything here is deterministic: iteration follows array order and every
// choice has an explicit tie-break.
import { topology } from 'topojson-server';
import { feature, merge, mergeArcs, neighbors, quantize } from 'topojson-client';
import { presimplify } from 'topojson-simplify';
import polygonClipping from 'polygon-clipping';
import { Delaunay } from 'd3-delaunay';

const RAD = Math.PI / 180;
export const EARTH_KM = 6371.0088;
export const OVERSEAS_KM = 2500;
export const SNAP_KM = 50;
export const HOP_KM = 400;
const REACH = 1.5;
const SEA_STEP_KM = 150; // how much farther than the nearest land an island may still join

// ---- Plain lon/lat geometry ----

export const polysOf = geometry => {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.map(poly => poly.map(closeRing).filter(ring => ring.length >= 4)).filter(poly => poly.length);
};

function closeRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = [p[0], p[1]];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice());
  return out;
}

/** Signed ring area on the sphere in km² (Chamberlain & Duquette), fine at admin-unit scale. */
export function ringAreaKm2(ring) {
  const n = ring.length - 1;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
    s += (p3[0] - p1[0]) * RAD * Math.sin(p2[1] * RAD);
  }
  return s * EARTH_KM * EARTH_KM / 2;
}

export const polyAreaKm2 = poly => Math.abs(ringAreaKm2(poly[0])) - poly.slice(1).reduce((s, r) => s + Math.abs(ringAreaKm2(r)), 0);
export const polysAreaKm2 = polys => polys.reduce((s, poly) => s + polyAreaKm2(poly), 0);

function pointInRing([px, py], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export const pointInPoly = (p, poly) => pointInRing(p, poly[0]) && !poly.slice(1).some(h => pointInRing(p, h));
export const pointInPolys = (p, polys) => polys.some(poly => pointInPoly(p, poly));

export function bboxOf(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Area-weighted centroid of the outer rings (planar lon/lat, enough for distances). */
export function centroidOf(polys) {
  let sx = 0, sy = 0, sa = 0;
  for (const poly of polys) {
    const ring = poly[0];
    let x = 0, y = 0, a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const f = x0 * y1 - x1 * y0;
      x += (x0 + x1) * f; y += (y0 + y1) * f; a += f;
    }
    if (Math.abs(a) < 1e-14) continue;
    sx += x / 3; sy += y / 3; sa += a;
  }
  if (!sa) { const b = bboxOf(polys); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  return [sx / sa, sy / sa];
}

export function kmBetween([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance in km from a point to a polygon set (0 inside), on a local equirectangular plane. */
export function kmToPolys(p, polys) {
  if (pointInPolys(p, polys)) return 0;
  const kx = Math.cos(p[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = (ring[i][0] - p[0]) * kx, ay = (ring[i][1] - p[1]) * ky;
      const bx = (ring[i + 1][0] - p[0]) * kx, by = (ring[i + 1][1] - p[1]) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const d = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export const quantileOf = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : null; };

// ---- Antimeridian ----

/** True when moving negative longitudes east by 360° makes the country narrower. */
export function needsShift(units) {
  let min = Infinity, max = -Infinity, minS = Infinity, maxS = -Infinity;
  for (const u of units) for (const poly of u.polys) for (const [x] of poly[0]) {
    const s = x < 0 ? x + 360 : x;
    if (x < min) min = x; if (x > max) max = x; if (s < minS) minS = s; if (s > maxS) maxS = s;
  }
  return maxS - minS < max - min - 1e-9;
}
export const shiftLon = lon => (lon < 0 ? lon + 360 : lon);
export const shiftPolys = polys => polys.map(poly => poly.map(ring => ring.map(([x, y]) => [shiftLon(x), y])));

// ---- Units ----

/** Attach derived measures; units keep their array order as their tie-break id. */
export function prepareUnits(units) {
  return units.map((u, index) => {
    const polys = u.polys;
    return { ...u, index, polys, bbox: bboxOf(polys), area: polysAreaKm2(polys), centroid: centroidOf(polys), samples: samplePoints(polys) };
  });
}

/** Up to ~120 outer-ring vertices per unit, for unit-to-unit distances across water. */
function samplePoints(polys) {
  const all = [];
  for (const poly of polys) for (const p of poly[0]) all.push(p);
  const step = Math.max(1, Math.ceil(all.length / 120));
  return all.filter((_, i) => i % step === 0);
}

/**
 * One unit per polygon. A multi-part unit links whatever its parts touch, however far
 * apart the parts lie (exclaves, slivers), so a section grown across it would not be
 * contiguous. The part holding `anchorOf(unit)` (else the largest) keeps the unit's
 * id; the others become `<id>.<k>` under the same name.
 */
export function explodeUnits(units, anchorOf = () => null) {
  return units.flatMap(u => {
    // A `whole` unit (a state merged from its counties) goes to one club, every part of it.
    if (u.polys.length < 2 || u.whole) return [u];
    const anchor = anchorOf(u);
    let main = anchor ? u.polys.findIndex(poly => pointInPoly(anchor, poly)) : -1;
    if (main < 0) {
      const areas = u.polys.map(polyAreaKm2);
      main = areas.indexOf(Math.max(...areas));
    }
    return u.polys.map((poly, k) => ({ ...u, id: k === main ? u.id : `${u.id}.${k}`, polys: [poly] }));
  });
}

/** The source unit a unit, part or piece came from. */
export const baseId = id => String(id).split(/[.~]/)[0];

const unitCollection = units => ({
  type: 'FeatureCollection',
  features: units.map((u, i) => ({ type: 'Feature', id: i, properties: {}, geometry: { type: 'MultiPolygon', coordinates: u.polys } })),
});

/** Unit topology (exact coordinates) and its shared-arc adjacency. */
export function unitTopology(units) {
  const topo = topology({ units: unitCollection(units) });
  const adjacency = neighbors(topo.objects.units.geometries).map(list => [...new Set(list)].sort((a, b) => a - b));
  return { topo, adjacency };
}

/**
 * Units from two sources (a map of two countries, each from its own layer) meet
 * without shared arcs: their border vertices differ. Units of different `realm`s
 * whose borders come within `km` of each other, with no other unit between, are
 * linked as neighbours too. Returns a new adjacency.
 */
export function joinRealms(units, adjacency, km) {
  return joinFacing(units, adjacency, km, i => units[i].realm != null, (i, j) => units[i].realm !== units[j].realm);
}

// Land across water this narrow is a neighbour (joinWater): a city spans its river or harbour by its bridges.
export const WATER_KM = 0;

/**
 * Units facing each other across water at most `km` wide (borders within `km`, nothing between: the Thames between
 * Fulham and Putney, the creek between Banjul's island and the mainland) linked as neighbours too, so a club's land
 * reaches over its river as its city does. Only shores count: points on arcs no other unit shares (`topo`, the units'
 * topology). Returns a new adjacency.
 */
export function joinWater(units, topo, adjacency, km) {
  if (!(km > 0)) return adjacency;
  const use = new Map();
  topo.objects.units.geometries.forEach((g, i) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const poly of polys) for (const ring of poly) for (const a of ring) {
      const k = a < 0 ? ~a : a;
      if (!use.has(k)) use.set(k, new Set());
      use.get(k).add(i);
    }
  });
  const shore = units.map(() => []);
  for (const [k, owners] of use) {
    if (owners.size !== 1) continue;
    const [i] = owners;
    shore[i].push(topo.arcs[k]);
  }
  const ky = EARTH_KM * RAD;
  const all = shore.flatMap(list => list.flat());
  if (!all.length) return adjacency;
  const kx = ky * Math.cos((all.reduce((sum, p) => sum + p[1], 0) / all.length) * RAD);
  const cx = km / kx, cy = km / ky, key = (x, y) => `${x},${y}`;
  const cells = new Map();
  shore.forEach((arcs, i) => arcs.forEach(arc => {
    for (let k = 0; k + 1 < arc.length; k++) {
      const a = arc[k], b = arc[k + 1];
      for (let x = Math.floor(Math.min(a[0], b[0]) / cx); x <= Math.floor(Math.max(a[0], b[0]) / cx); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / cy); y <= Math.floor(Math.max(a[1], b[1]) / cy); y++) {
          if (!cells.has(key(x, y))) cells.set(key(x, y), []);
          cells.get(key(x, y)).push([i, a, b]);
        }
      }
    }
  }));
  const out = adjacency.map(list => new Set(list));
  const boxes = units.map(u => u.bbox);
  shore.forEach((arcs, i) => arcs.forEach(arc => arc.forEach(p => {
    const x0 = Math.floor(p[0] / cx), y0 = Math.floor(p[1] / cy);
    for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (const [j, a, b] of cells.get(key(x, y)) || []) {
        if (j === i || out[i].has(j)) continue;
        const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * ky, len = ex * ex + ey * ey;
        const t = len ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len)) : 0;
        if (Math.hypot(ax + t * ex, ay + t * ey) > km) continue;
        // Water between: no point of the way across lies on another unit (a third unit between them, with a sliver of a
        // gap at its middle, is no water).
        const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const across = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
        if (across.some(r => units.some((u, k) => k !== i && k !== j && inBox(r, boxes[k]) && pointInPolys(r, u.polys)))) continue;
        out[i].add(j);
        out[j].add(i);
      }
    }
  })));
  return out.map(set => [...set].sort((a, b) => a - b));
}

/** joinRealms' facing test for units `take(i)` and pairs `pair(i, j)`. */
function joinFacing(units, adjacency, km, take, pair) {
  const border = units.map((u, i) => i).filter(i => take(i)
    && units.some((v, j) => take(j) && pair(i, j) && boxKm(units[i].bbox, v.bbox) <= km));
  const across = facingSections(border.map(i => units[i].polys), km);
  const out = adjacency.map(list => new Set(list));
  across.forEach((list, a) => list.forEach(b => {
    const i = border[a], j = border[b];
    if (pair(i, j)) { out[i].add(j); out[j].add(i); }
  }));
  return out.map(set => [...set].sort((a, b) => a - b));
}

export function components(adjacency) {
  const comp = new Array(adjacency.length).fill(-1);
  let count = 0;
  for (let i = 0; i < adjacency.length; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = count;
    while (stack.length) for (const j of adjacency[stack.pop()]) if (comp[j] < 0) { comp[j] = count; stack.push(j); }
    count++;
  }
  return { comp, count };
}

/**
 * Drop far overseas territories: whole land-connected groups of units none of whose
 * centroids lies within OVERSEAS_KM of the clubs' median point. Working per group
 * keeps a continuous country (Russia to the Pacific) whole. A group holding a club
 * home stays, and so does one within HOP_KM of land that stays (Baffin Island,
 * Sakhalin), while Hawaii, Puerto Rico or Alaska go.
 */
export function dropOverseas(units, adjacency, homes) {
  const located = homes.filter(Boolean);
  const anchor = located.length ? [median(located.map(h => h[0])), median(located.map(h => h[1]))]
    : centroidOf(units.flatMap(u => u.polys));
  const { comp, count } = components(adjacency);
  const near = new Array(count).fill(false);
  units.forEach((u, i) => { if (kmBetween(u.centroid, anchor) <= OVERSEAS_KM) near[comp[i]] = true; });
  for (const { unit } of locateHomes(units, homes)) if (unit != null) near[comp[unit]] = true;
  const members = Array.from({ length: count }, () => []);
  units.forEach((u, i) => members[comp[i]].push(u));
  const boxes = members.map(list => bboxOf(list.flatMap(u => u.polys)));
  for (let grown = true; grown;) {
    grown = false;
    const kept = units.filter((_, i) => near[comp[i]]);
    for (let c = 0; c < count; c++) {
      if (near[c]) continue;
      const close = kept.filter(v => boxKm(boxes[c], v.bbox) <= HOP_KM);
      if (members[c].some(u => close.some(v => boxKm(u.bbox, v.bbox) <= HOP_KM && unitDistance(u, v) <= HOP_KM))) { near[c] = true; grown = true; }
    }
  }
  return { anchor, keep: units.filter((_, i) => near[comp[i]]), dropped: units.filter((_, i) => !near[comp[i]]) };
}

/**
 * The unit each home falls in. Points up to SNAP_KM outside the country snap to the
 * nearest unit; farther points are discarded (the club counts as unlocated).
 */
export function locateHomes(units, homes) {
  return homes.map(home => {
    if (!home) return { unit: null, km: null, status: 'none' };
    for (const u of units) if (inBox(home, u.bbox) && pointInPolys(home, u.polys)) return { unit: u.index, km: 0, status: 'inside' };
    let best = null, bestKm = Infinity;
    for (const u of units) {
      // Cheap bound first: a unit whose box is far away cannot be the nearest.
      const dx = Math.max(u.bbox[0] - home[0], 0, home[0] - u.bbox[2]) * Math.cos(home[1] * RAD) * EARTH_KM * RAD;
      const dy = Math.max(u.bbox[1] - home[1], 0, home[1] - u.bbox[3]) * EARTH_KM * RAD;
      if (Math.hypot(dx, dy) > bestKm) continue;
      const km = kmToPolys(home, u.polys);
      if (km < bestKm) { bestKm = km; best = u.index; }
    }
    if (bestKm <= SNAP_KM) return { unit: best, km: bestKm, status: 'snapped' };
    return { unit: null, km: bestKm, status: 'discarded' };
  });
}

/**
 * Clubs without a usable home (none found, or one discarded) start at the most populous
 * places (`places`: { id, lon, lat, pop }, in the units' frame) that host no club yet,
 * where they get an ordinary share of the country: the place's unit holds no home, it
 * lies at least `spacingKm` from every home so far, no farther from the located clubs
 * than they typically are from each other, and the land nearer to it than to any home
 * is at most twice a club's average share. Those conditions are relaxed in turn until a
 * place qualifies. A placed home is an estimate (recorded as one); the alternative, the
 * land farthest from every club, gave obscure clubs whole empty regions (Crimea,
 * Chukotka, the Western Desert). Sets homeOf[club] = { unit, point, placed: true };
 * returns the place per club, or null.
 */
export function placeClubs(units, homeOf, places, { spacingKm }) {
  const placed = new Array(homeOf.length).fill(null);
  if (!places?.length || homeOf.every(Boolean)) return placed;
  const order = [...places].sort((a, b) => b.pop - a.pop || a.id - b.id).slice(0, 3000);
  const unitOf = new Map();
  const unitAt = p => {
    if (!unitOf.has(p.id)) {
      const q = [p.lon, p.lat];
      unitOf.set(p.id, units.find(u => inBox(q, u.bbox) && pointInPolys(q, u.polys))?.index ?? null);
    }
    return unitOf.get(p.id);
  };
  const hosts = new Set(homeOf.filter(Boolean).map(h => h.unit));
  const points = homeOf.filter(Boolean).map(h => h.point);
  const located = [...points];
  const gaps = points.map((p, i) => Math.min(...points.map((q, j) => (i === j ? Infinity : kmBetween(p, q))))).filter(Number.isFinite);
  const reachKm = gaps.length >= 2 ? Math.max(spacingKm, 1.5 * quantileOf(gaps, 0.9)) : Infinity;
  const typical = units.reduce((s, u) => s + u.area, 0) / homeOf.length;
  const nearest = units.map(u => Math.min(Infinity, ...points.map(q => kmBetween(u.centroid, q))));
  let shares = new Map();
  const share = p => {
    if (!shares.has(p.id)) {
      const q = [p.lon, p.lat];
      shares.set(p.id, units.reduce((s, u, i) => (kmBetween(u.centroid, q) < nearest[i] ? s + u.area : s), 0));
    }
    return shares.get(p.id);
  };
  const spacings = [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 0].map(f => f * spacingKm);
  const tiers = [
    ...[2, 4, 8].flatMap(area => [true, false].flatMap(free => spacings.map(d => ({ free, reach: reachKm, d, area })))),
    ...spacings.map(d => ({ free: false, reach: Infinity, d, area: Infinity })),
  ];
  const fits = (p, t) => !used.has(p.id) && points.every(q => kmBetween(q, [p.lon, p.lat]) >= t.d)
    && (!located.length || located.some(q => kmBetween(q, [p.lon, p.lat]) <= t.reach))
    && unitAt(p) != null && !(t.free && hosts.has(unitAt(p))) && (t.area === Infinity || share(p) <= t.area * typical);
  const used = new Set();
  homeOf.forEach((h, club) => {
    if (h) return;
    let found = null;
    for (const t of tiers) if ((found = order.find(p => fits(p, t)))) break;
    if (!found) return;
    used.add(found.id);
    const point = [found.lon, found.lat];
    homeOf[club] = { unit: unitAt(found), point, placed: true };
    hosts.add(homeOf[club].unit);
    points.push(point);
    units.forEach((u, i) => { nearest[i] = Math.min(nearest[i], kmBetween(u.centroid, point)); });
    shares = new Map();
    placed[club] = found;
  });
  return placed;
}

// ---- Format 2: a territory per club, cut into its group of sections ----

// A candidate's weight grows slowly with its population, so a town beats a village only
// where it would hold a comparable share of land: sections stay city-centred where people
// live and region-sized where they do not. Admin-unit centres and land samples come
// last, where no place fits.
const POP_EXPONENT = 0.3;
const VILLAGE_POP = 100; // a place without a population (GeoNames country files)
const UNIT_POP = 4; // an admin unit's centre
const GRID_POP = 1; // a land sample (named after its unit)

/** Even-odd scanline crossings of the polygons' rings with each latitude row (row r at lat0 + (r + 0.5) * dy). */
function rowCrossings(polys, lat0, dy) {
  const rows = new Map();
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      for (let r = Math.ceil((lo - lat0) / dy - 0.5); lat0 + (r + 0.5) * dy < hi; r++) {
        const y = lat0 + (r + 0.5) * dy;
        if (y < lo) continue;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
  }
  for (const xs of rows.values()) xs.sort((a, b) => a - b);
  return rows;
}

/** Even-odd crossings of the polygons' rings with the latitude y, sorted. */
function crossingsAt(polys, y) {
  const xs = [];
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if ((y1 <= y) !== (y2 <= y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
  }
  return xs.sort((a, b) => a - b);
}

/** A point inside the polygons: the centroid when it is inside, else the middle of the widest span through it. */
export function interiorPoint(polys) {
  const c = centroidOf(polys);
  if (pointInPolys(c, polys)) return c;
  const [, s, , n] = bboxOf(polys);
  for (const y of [c[1], (s + n) / 2]) {
    const xs = crossingsAt(polys, y);
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
    if (best && best[1] > best[0]) return [(best[0] + best[1]) / 2, y];
  }
  return polys[0][0][0].slice();
}

/**
 * Land as weighted points: a grid of about `target` points on an equal-area lattice over
 * every unit, each worth its unit's area over its unit's point count; a unit the grid
 * misses (an islet) counts once at its interior point. Returns [{ p, unit, w }].
 */
export function landSamples(units, target) {
  const total = units.reduce((s, u) => s + u.area, 0);
  const stepKm = Math.sqrt(total / target);
  const dy = stepKm / (EARTH_KM * RAD);
  const out = [];
  for (const u of units) {
    const pts = [];
    for (const [r, xs] of rowCrossings(u.polys, -90, dy)) {
      const y = -90 + (r + 0.5) * dy;
      const dx = dy / Math.max(0.02, Math.cos(y * RAD));
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let k = Math.ceil((xs[i] + 180) / dx - 0.5); -180 + (k + 0.5) * dx < xs[i + 1]; k++) pts.push([-180 + (k + 0.5) * dx, y]);
      }
    }
    if (!pts.length) pts.push(interiorPoint(u.polys));
    for (const p of pts) out.push({ p, unit: u.index, w: u.area / pts.length });
  }
  return out;
}

const unitVector = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const chordKm = km => 2 * Math.sin(Math.min(Math.PI, km / EARTH_KM) / 2);
const unitAtPoint = (units, q) => units.find(u => inBox(q, u.bbox) && pointInPolys(q, u.polys))?.index ?? null;

/** Starting group sizes: floor or ceil(count / clubs) sections, the stronger clubs the larger. */
export function groupTargets(count, clubs) {
  const q = Math.floor(count / clubs), r = count - q * clubs;
  return Array.from({ length: clubs }, (_, c) => (c < r ? q + 1 : q));
}

/**
 * Seeds for `count` more sections in one territory (`units`, holding the club's start
 * `seed` in unit `seedUnit`): each step takes the candidate that would take the most of
 * the territory's land from the seeds so far (land on the candidate's own landmass,
 * `part(unit)`: a section grows over land), weighted by population^0.3 — GeoNames places (`places`, inside
 * the territory), then admin-unit centres, then land samples — at least a quarter of a
 * section's side from every seed and outside the units in `avoid` (around a small start,
 * which they would box in) while any candidate is, else the best anywhere (a city
 * territory cut into small sections). Lazy greedy (shares only shrink as seeds are
 * added), deterministic. Returns [{ unit, point, place, kind }]: kind 'place' (named after
 * the place) or 'unit' (named after a place it holds, else its unit).
 */
function territoryExtras(units, seed, seedUnit, places, count, { minKm2 = 0, avoid = new Set(), part = () => 0 } = {}) {
  const area = units.reduce((s, u) => s + u.area, 0);
  const samples = landSamples(units, Math.min(4000, Math.max(400, 200 * (count + 1))));
  const m = samples.length;
  const sx = new Float64Array(m), sy = new Float64Array(m), sz = new Float64Array(m), sw = new Float64Array(m), near = new Float64Array(m).fill(4);
  samples.forEach((s, i) => { [sx[i], sy[i], sz[i]] = unitVector(s.p); sw[i] = s.w; });
  const sp = samples.map(s => part(s.unit));
  const candidates = [];
  for (const p of places) candidates.push({ point: [p.lon, p.lat], unit: p.unit, place: p.source ?? p, kind: 'place', weight: Math.max(VILLAGE_POP, p.pop) ** POP_EXPONENT });
  for (const u of [...units].filter(v => v.area >= minKm2).sort((a, b) => b.area - a.area || a.index - b.index).slice(0, 1000)) {
    candidates.push({ point: interiorPoint(u.polys), unit: u.index, place: null, kind: 'unit', weight: UNIT_POP ** POP_EXPONENT });
  }
  for (const s of samples) candidates.push({ point: s.p, unit: s.unit, place: null, kind: 'unit', weight: GRID_POP ** POP_EXPONENT });
  // A territory smaller than its sample grid: points inside its largest units.
  if (candidates.length < 4 * (count + 1)) {
    for (const u of [...units].sort((a, b) => b.area - a.area || a.index - b.index).slice(0, 8)) {
      for (const p of interiorSamples(u, 60 * (count + 1))) candidates.push({ point: p, unit: u.index, place: null, kind: 'unit', weight: GRID_POP ** POP_EXPONENT });
    }
  }
  const cv = candidates.map(c => unitVector(c.point));
  const cp = candidates.map(c => part(c.unit));
  const candNear = new Float64Array(candidates.length).fill(4);
  const addSeed = (point, unit) => {
    const [x, y, z] = unitVector(point);
    const own = part(unit);
    for (let i = 0; i < m; i++) {
      const d = (sx[i] - x) ** 2 + (sy[i] - y) ** 2 + (sz[i] - z) ** 2;
      if (sp[i] === own && d < near[i]) near[i] = d;
    }
    cv.forEach((v, j) => { const d = (v[0] - x) ** 2 + (v[1] - y) ** 2 + (v[2] - z) ** 2; if (d < candNear[j]) candNear[j] = d; });
  };
  addSeed(seed, seedUnit);
  const minChord2 = chordKm(0.25 * Math.sqrt(area / (count + 1))) ** 2;
  const share = k => {
    const [x, y, z] = cv[k];
    let sum = 0;
    for (let i = 0; i < m; i++) if (sp[i] === cp[k] && (sx[i] - x) ** 2 + (sy[i] - y) ** 2 + (sz[i] - z) ** 2 < near[i]) sum += sw[i];
    return sum;
  };
  // Upper bounds on each candidate's score, made exact when one reaches the top.
  const bound = new Float64Array(candidates.length).fill(Infinity);
  const stale = new Uint8Array(candidates.length).fill(1);
  const used = new Uint8Array(candidates.length);
  const best = spaced => {
    for (;;) {
      let top = -1;
      for (let k = 0; k < candidates.length; k++) {
        if (used[k] || candNear[k] < 1e-18 || (spaced && (candNear[k] < minChord2 || avoid.has(candidates[k].unit))) || !(bound[k] > 0)) continue;
        if (top < 0 || bound[k] > bound[top]) top = k;
      }
      if (top < 0 || !stale[top]) return top;
      bound[top] = share(top) * candidates[top].weight;
      stale[top] = 0;
    }
  };
  const out = [];
  while (out.length < count) {
    let k = best(true);
    if (k < 0) k = best(false);
    if (k < 0) throw new Error(`Only ${out.length} of ${count} extra sections found room in a territory`);
    used[k] = 1;
    const { point, unit, place, kind } = candidates[k];
    out.push({ unit, point, place, kind });
    addSeed(point, unit);
    stale.fill(1);
  }
  return out;
}

/** Maps a unit index of `before` to `after` (cut units go to the piece holding `point`, else the nearest). */
function unitMapper(before, after) {
  const byId = new Map(after.map(u => [u.id, u.index]));
  return (index, point) => {
    const id = before[index].id;
    if (byId.has(id)) return byId.get(id);
    const pieces = after.filter(u => u.id.startsWith(`${id}~`));
    const holding = pieces.find(u => inBox(point, u.bbox) && pointInPolys(point, u.polys));
    return (holding ?? pieces.reduce((a, u) => (!a || kmToPolys(point, u.polys) < kmToPolys(point, a.polys) ? u : a), null))?.index ?? null;
  };
}

/** Sector edges (turned angles, `k` + 1 of them from 0 to 2π) sharing out `turned` ([turned angle, weight], sorted) equally. */
function equalEdges(turned, total, k) {
  const edges = [0];
  let acc = 0, j = 0;
  for (let i = 1; i < k; i++) {
    if (!total) { edges.push(2 * Math.PI * i / k); continue; }
    while (j < turned.length && acc + turned[j][1] <= total * i / k) acc += turned[j++][1];
    edges.push(j < turned.length ? turned[j][0] : 2 * Math.PI * i / k);
  }
  edges.push(2 * Math.PI);
  return edges;
}

/**
 * Where a fan's sectors start: the bearing just past the widest gap in its zone's land (the sea, for a port), or with no
 * such gap, half a sector before its first club's ground.
 */
function gapStart(zone, C, zoneKm, members, at, bearing) {
  const land = landSamples(zone, 2000).filter(sample => kmBetween(sample.p, C) <= zoneKm).map(sample => [bearing(sample.p), sample.w]).sort((a, b) => a[0] - b[0]);
  let start = 0, gap = 0;
  land.forEach(([b], i) => {
    const next = i + 1 < land.length ? land[i + 1][0] : land[0][0] + 2 * Math.PI;
    if (next - b > gap) { gap = next - b; start = next % (2 * Math.PI); }
  });
  if (gap < Math.PI / 9) {
    const first = members.map(at).filter(b => b != null).sort((a, b) => a - b)[0];
    start = first == null ? 0 : (first - Math.PI / members.length + 2 * Math.PI) % (2 * Math.PI);
  }
  return { land, start };
}


// How much more land for its target than the least a fan's club may hold and still grow in a round (growFan).
const ROUND_SLACK = 1.5;
// Added to a unit outside a club's own sector as it grows (growFan): it takes such land only with none of its own left.
const FOREIGN = 1e9;

/**
 * A fan's clubs share out `region` (unit indices) from their starts `seeds`, in rounds of a unit each for the clubs with
 * about the least land for their `target` (within ROUND_SLACK), least first: each takes the free unit next to its land
 * in its own sector (`prefer[unit]`: the index
 * of the club whose sector holds it) nearest its start, or with none, the nearest unit of any. So each club's land
 * hangs together and keeps to its sector while it can, and land a sector's club cannot reach goes to one that can. `next(unit)`: its neighbours; `fits(index, unit)`:
 * land the club may take. Returns per unit the index of the club that took it, -1 for none.
 */
function growFan(units, next, region, prefer, seeds, target, fits, first = new Map(), straits = null) {
  const k = seeds.length;
  const who = new Int32Array(units.length).fill(-1);
  const inRegion = new Uint8Array(units.length);
  for (const u of region) inRegion[u] = 1;
  const land = new Float64Array(k);
  const heaps = seeds.map(() => claimHeap());
  // Each club's ways out: the free units next to its land, and across a strait (`straits`: { links, comp }) the units
  // of a landmass where it holds none yet; the unit it lands on is its `entries`.
  const front = seeds.map(() => new Set());
  const ashore = seeds.map(u => new Set(straits ? [straits.comp[u]] : []));
  const entries = seeds.map(() => []);
  const push = (i, v) => {
    if (!inRegion[v] || who[v] >= 0 || !fits(i, v)) return;
    front[i].add(v);
    heaps[i].push((prefer[v] === i ? 0 : FOREIGN) + kmBetween(units[seeds[i]].centroid, units[v].centroid), i, v);
  };
  const offer = (i, u) => {
    for (const v of next(u)) push(i, v);
    if (straits) for (const v of straits.links.get(u) ?? []) if (!ashore[i].has(straits.comp[v])) push(i, v);
  };
  // Still a way for the club: next to its land, or across a strait onto a landmass it holds none of.
  const reaches = (i, v) => next(v).some(w => who[w] === i)
    || (!!straits && !ashore[i].has(straits.comp[v]) && (straits.links.get(v) ?? []).some(w => who[w] === i));
  seeds.forEach((u, i) => { if (who[u] < 0) { who[u] = i; land[i] += units[u].area; } });
  seeds.forEach((u, i) => offer(i, u));
  // A club takes no other club's last way out while it has another unit to take (growSections' `spare`).
  const last = (i, v) => front.some((ways, j) => j !== i && ways.size === 1 && ways.has(v));
  const live = i => {
    const heap = heaps[i];
    while (heap.size && (who[heap.peek()[2]] >= 0 || !reaches(i, heap.peek()[2]))) heap.pop();
    return heap.size > 0;
  };
  // Clubs going `first` (to land km²) grow before any other until they hold it.
  const ahead = c => first.has(c) && land[c] < first.get(c);
  // The club's nearest unit that is no other club's last way out, or with `force` its nearest of any; false when it has
  // none to take.
  const take = (pick, force = false) => {
    const held = [];
    while (heaps[pick].size) {
      const top = heaps[pick].pop();
      if (who[top[2]] >= 0 || !reaches(pick, top[2])) continue;
      held.push(top);
      if (!last(pick, top[2])) break;
    }
    const chosen = held.find(top => !last(pick, top[2])) ?? (force ? held[0] : null);
    for (const top of held) if (top !== chosen) heaps[pick].push(...top);
    if (!chosen) return false;
    const u = chosen[2];
    for (const ways of front) ways.delete(u);
    who[u] = pick;
    land[pick] += units[u].area;
    if (straits && !ashore[pick].has(straits.comp[u])) { ashore[pick].add(straits.comp[u]); entries[pick].push(u); }
    offer(pick, u);
    return true;
  };
  // In rounds: each club within ROUND_SLACK of the least land for its target takes one unit, least first, so no club
  // takes many units in a row while a neighbour waits and walls it in. A club left only with another's last way out
  // waits, and another grows, the least first; only when none can is a last way out taken (Beşiktaş took Eyüpsultan,
  // Galatasaray's way out of Sarıyer, while Galatasaray, the larger, waited its turn).
  for (;;) {
    const growing = [...Array(k).keys()].filter(live);
    if (!growing.length) break;
    const firsts = growing.filter(ahead);
    const ratio = i => land[i] / target[i];
    const least = Math.min(...growing.map(ratio));
    const byRatio = list => list.sort((a, b) => ratio(a) - ratio(b) || a - b);
    const round = byRatio(firsts.length ? firsts : growing.filter(i => ratio(i) <= ROUND_SLACK * least));
    let took = false;
    for (const i of round) if (live(i) && take(i)) took = true;
    if (took) continue;
    took = byRatio(growing).some(i => live(i) && take(i));
    // A way out that two clubs both need goes to the one whose sector holds it (Eyüpsultan, beyond Galatasaray's Sarıyer).
    if (!took) took = byRatio(growing).some(i => live(i) && prefer[heaps[i].peek()[2]] === i && take(i, true));
    if (!took) took = byRatio(growing).some(i => live(i) && take(i, true));
    if (!took) break;
  }
  return Object.assign(who, { entries });
}

// A club of a fan whose land comes out under BOXED_SHARE of its target is shut in: the fan grows again with it going
// first until it holds FIRST_SHARE of its target (growFanFair).
const BOXED_SHARE = 0.25;
const FIRST_SHARE = 0.5;

/**
 * growFan, redone while a club comes out shut in (under BOXED_SHARE of its target) with the shut-in clubs going first,
 * the most shut in added each time, until they hold FIRST_SHARE of their targets: a club whose start is small is walled
 * in while its neighbours grow over the large units around it (Fulham in London; Montreal's island clubs behind
 * Blainville's land). The most even outcome is kept, so a club sent first that only walls in the others counts for
 * nothing. Returns { who, held, uneven }.
 */
function growFanFair(units, next, region, prefer, seeds, target, fits, straits = null) {
  const k = seeds.length;
  const grow = first => {
    const who = growFan(units, next, region, prefer, seeds, target, fits, first, straits);
    const held = new Float64Array(k);
    for (const u of region) if (who[u] >= 0) held[who[u]] += units[u].area;
    return { who, held, uneven: Array.from(held).reduce((sum, a, i) => sum + Math.log(Math.max(a, 1) / target[i]) ** 2, 0) };
  };
  let first = new Map();
  let best = null, last = grow(first);
  for (let round = 0; round <= k; round++) {
    const { who, held, uneven } = last;
    if (!best || uneven < best.uneven - 1e-9) best = { who, held, uneven };
    const shut = [...Array(k).keys()].filter(i => !first.has(i) && held[i] < BOXED_SHARE * target[i])
      .sort((a, b) => held[a] / target[a] - held[b] / target[b]);
    if (!shut.length) break;
    // It goes first to half its target, or to an even share of the land it and the others but the largest hold (two
    // clubs of Istanbul's European side share Thrace, whatever Fenerbahçe holds across the Bosphorus); the more even.
    const i = shut[0], others = Array.from(held).filter((_, j) => j !== i);
    const even = (held[i] + others.reduce((a, b) => a + b, 0) - Math.max(...others)) / (k - 1);
    const tries = [FIRST_SHARE * target[i], even].map(goal => {
      const next = new Map(first).set(i, goal);
      return { first: next, ...grow(next) };
    });
    ({ first, ...last } = tries[0].uneven <= tries[1].uneven ? tries[0] : tries[1]);
  }
  if (last.uneven < best.uneven - 1e-9) best = { who: last.who, held: last.held, uneven: last.uneven };
  return best;
}

// More clubs than this around one city would get slivers rather than wedges, and the wedges, all meeting at the centre,
// would need more clearly different colours than the palette holds (16: 19 around Cairo). Balanced maps keep it
// (BALANCE_FAN_MAX; 31 around Asunción made a pinwheel of slivers).
const FAN_MAX = 12;
const BALANCE_FAN_MAX = 12;
// A territory under this share of its sections' room (minSectionKm2 each) is boxed in.
const BOXED = 0.5;
// Clubs whose grounds lie within this of the first one's share that ground (one stadium, as Inter and AC Milan share San
// Siro, or the town point a club was located at): their land meets there, in wedges around it, which share out the land
// within LOCAL_KM of it.
export const SAME_GROUND_KM = 0.25;
const LOCAL_KM = 2;
// A ground stands at least this far inside its fan sector's edges where the grounds beside it leave room, the edges
// turning at most GROUND_TURN either side of it for that.
const GROUND_CLEAR_KM = 0.3;
const GROUND_TURN = Math.PI / 6;
// A fan's first edge moves out of the widest gap of its land where elsewhere it leaves the club with least land for its
// share (fanLayout) more than this many times as much, and FIRST_EDGE_MIN of its share more.
const FIRST_EDGE_GAIN = 1.25;
const FIRST_EDGE_MIN = 0.05;

/** Grounds: points (in club order) within SAME_GROUND_KM of a ground's first point share it. Returns [{ point, members }], members indexing `points`. */
function groundsOf(points) {
  const grounds = [];
  points.forEach((p, j) => {
    const g = grounds.find(o => kmBetween(o.point, p) <= SAME_GROUND_KM);
    if (g) g.members.push(j); else grounds.push({ point: p, members: [j] });
  });
  return grounds;
}

/**
 * Edges for `m` wedges round a ground P, anticlockwise, as angles: the first in the middle of the widest gap in the land
 * within LOCAL_KM of P (the sea, for a ground on the coast; the gap a district layer leaves for a city), the others
 * where each wedge holds about as much of that land. Land is `inside(point)` on a grid round P. Every club's wedge then
 * holds land at the ground itself, not only out beyond the gap. Null when there is too little land to share.
 */
function wedgeEdges(P, m, inside, kx, ky) {
  const angles = [];
  for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
    const x = LOCAL_KM * i / 20, y = LOCAL_KM * j / 20;
    if ((i || j) && x * x + y * y <= LOCAL_KM * LOCAL_KM && inside([P[0] + x / kx, P[1] + y / ky])) angles.push((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI));
  }
  if (angles.length < 4 * m) return null;
  angles.sort((a, b) => a - b);
  let start = 0, gap = -1;
  angles.forEach((a, i) => {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
    if (next - a > gap) { gap = next - a; start = a + gap / 2; }
  });
  const turned = angles.map(a => (a - start + 4 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  const edges = [start];
  for (let k = 1; k < m; k++) {
    const i = Math.floor(turned.length * k / m);
    edges.push(start + (turned[i - 1] + turned[i]) / 2);
  }
  edges.push(start + 2 * Math.PI);
  return edges;
}

/** A ring from `apex` sweeping anticlockwise from angle a0 to a1 (radians, on a plane of kx and ky km a degree) out to `far` km. */
function wedgeRing(apex, a0, a1, far, kx, ky) {
  const ring = [apex];
  for (let k = 0, steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 36))); k <= steps; k++) {
    const a = a0 + (a1 - a0) * k / steps;
    ring.push([apex[0] + far * Math.cos(a) / kx, apex[1] + far * Math.sin(a) / ky]);
  }
  ring.push(apex);
  return ring;
}

// The land a fan's centre sees (landSeen) is measured on a grid of SEEN_GRID cells a side across the zone, in
// SEEN_BINS bearings.
const SEEN_GRID = 240;
const SEEN_BINS = 360;

/**
 * The land of a fan's zone (`units`, within `radius` km of Z; on a grid of N cells a side) as seen from a point: a
 * function of a point giving, per bearing (SEEN_BINS of them, anticlockwise from east), the km² of the first stretch of
 * land out along it. Land beyond water (the North Shore across Auckland's harbour, the islands of its gulf) is cut off
 * from the point that way: a sector there would hold land its club cannot reach from its ground.
 */
function landSeen(Z, radius, units, N = SEEN_GRID) {
  const ky = EARTH_KM * RAD, kx = Math.cos(Z[1] * RAD) * ky;
  const cell = 2 * radius / N;
  const grid = new Uint8Array(N * N);
  const gx = lon => ((lon - Z[0]) * kx + radius) / cell, gy = lat => ((lat - Z[1]) * ky + radius) / cell;
  for (const u of units) for (const poly of u.polys) {
    const rows = new Map();
    for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const x0 = gx(ring[i][0]), y0 = gy(ring[i][1]), x1 = gx(ring[i + 1][0]), y1 = gy(ring[i + 1][1]);
      if (y0 === y1) continue;
      const lo = Math.max(0, Math.ceil(Math.min(y0, y1) - 0.5)), hi = Math.min(N - 1, Math.floor(Math.max(y0, y1) - 0.5));
      for (let r = lo; r <= hi; r++) {
        const y = r + 0.5;
        if (y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c <= Math.min(N - 1, Math.floor(xs[k + 1] - 0.5)); c++) grid[r * N + c] = 1;
      }
    }
  }
  const step = cell / 2, turn = 2 * Math.PI / SEEN_BINS;
  const landAt = (x, y) => {
    const c = Math.floor((x + radius) / cell), row = Math.floor((y + radius) / cell);
    return c >= 0 && c < N && row >= 0 && row < N && grid[row * N + c] === 1;
  };
  return at => {
    const ax = (at[0] - Z[0]) * kx, ay = (at[1] - Z[1]) * ky, far = radius + Math.hypot(ax, ay);
    const bins = new Float64Array(SEEN_BINS);
    for (let b = 0; b < SEEN_BINS; b++) {
      const dx = Math.cos((b + 0.5) * turn), dy = Math.sin((b + 0.5) * turn);
      let onLand = false;
      for (let r = step / 2; r < far; r += step) {
        if (landAt(ax + r * dx, ay + r * dy)) { onLand = true; bins[b] += r * turn * step; } else if (onLand) break;
      }
    }
    return bins;
  };
}

/**
 * The point the sectors of a fan meet at: of the crowd's mean, its grounds, the midpoints between them and a grid
 * across its spread, the one leaving every ground the most land to take its sector from: the land it sees (`seen`,
 * landSeen) between the grounds either side of it in turn, per club of it (`weights`, by point), and for the clubs
 * whose ground the point is (within SAME_GROUND_KM, no bearing), the widest such gap; the least of these, largest (the
 * nearest the mean of equals). Seen from a crowd's mean, grounds on one side of a town lie on one ray (SC Bastia's and
 * Furiani-Agliani's), or face the sea (Maxaquene's at Maputo's southern tip), and their sectors would hold no land.
 */
function fanApex(points, weights, mean, spread, seen) {
  const grounds = groundsOf(points).map(g => ({ point: g.point, weight: g.members.reduce((sum, j) => sum + weights[j], 0) }));
  const ky = EARTH_KM * RAD, kx = Math.cos(mean[1] * RAD) * ky;
  const candidates = [mean, ...grounds.map(g => g.point)];
  grounds.forEach((p, i) => grounds.forEach((q, j) => { if (i < j) candidates.push([(p.point[0] + q.point[0]) / 2, (p.point[1] + q.point[1]) / 2]); }));
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) if (i || j) candidates.push([mean[0] + spread * i / 4 / kx, mean[1] + spread * j / 4 / ky]);
  const angleOf = (p, at) => (Math.atan2((p[1] - at[1]) * ky, (p[0] - at[0]) * kx) + 2 * Math.PI) % (2 * Math.PI);
  let best = null;
  // A point within SAME_GROUND_KM of a ground is that ground: the sectors of the clubs there then meet on it.
  for (const at of candidates.map(q => grounds.find(g => kmBetween(g.point, q) <= SAME_GROUND_KM)?.point ?? q)) {
    const around = grounds.filter(g => kmBetween(g.point, at) > SAME_GROUND_KM).map(g => ({ a: angleOf(g.point, at), weight: g.weight })).sort((x, y) => x.a - y.a);
    const central = grounds.reduce((sum, g) => sum + g.weight, 0) - around.reduce((sum, g) => sum + g.weight, 0);
    // The land seen between two bearings, anticlockwise, from prefix sums over the bearings.
    const bins = seen(at), prefix = [0];
    for (const w of bins) prefix.push(prefix.at(-1) + w);
    const total = prefix.at(-1);
    const upTo = a => prefix[Math.min(SEEN_BINS, Math.max(0, Math.round(a / (2 * Math.PI) * SEEN_BINS)))];
    const between = (a0, a1) => (a1 > a0 ? upTo(a1) - upTo(a0) : total - upTo(a0) + upTo(a1));
    let least = Infinity, widest = 0;
    around.forEach((g, i) => {
      const prev = around[(i - 1 + around.length) % around.length].a, next = around[(i + 1) % around.length].a;
      least = Math.min(least, (around.length < 3 ? total : between(prev, next)) / g.weight);
      widest = Math.max(widest, around.length < 2 ? total : between(g.a, next));
    });
    if (central) least = Math.min(least, (around.length ? widest : total) / central);
    const km = kmBetween(at, mean);
    if (!best || least > best.least * (1 + 1e-9) || (least >= best.least * (1 - 1e-9) && km < best.km)) best = { at, least, km };
  }
  return best.at;
}

/**
 * One fan's sectors meeting at C, out to `far` km: one per club (a team of clubs sharing a ground, partitionCountry, is
 * one club here, its sector `weightOf` clubs' worth), of about equal land in the zone per club (`land`: [bearing, km²]
 * of the land C sees, landSeen), in the order of the grounds round C, and each ground inside its own sector, at
 * least GROUND_CLEAR_KM inside its edges where the grounds beside it leave room; grounds at C itself have no bearing,
 * and their clubs, strongest first, take sectors from C in the gap between two grounds with the most land. The first
 * edge runs through the middle of the widest gap between the zone's land and the grounds (the sea, for a port), unless
 * one between two grounds in turn leaves the club with least land for its share clearly more (FIRST_EDGE_GAIN): the
 * other edges are held clear of the grounds either side, so the first can leave a club next to it nothing (Gokulam
 * Kerala, its ground 0.3 km seaward of Kozhikode's centre, had the strip of land between the sea and Calicut FC's ground;
 * IFK Göteborg and GAIS, at C, 1° between Örgryte's ground and the edge just past it). Returns
 * { order: the clubs in sector order, sectors: club -> its polygons, clubAt(point) }.
 */
function fanLayout(C, members, homeOf, land, far, weightOf) {
  const kx = Math.cos(C[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  const bearing = p => (Math.atan2((p[1] - C[1]) * ky, (p[0] - C[0]) * kx) + 2 * Math.PI) % (2 * Math.PI);
  const grounds = groundsOf(members.map(c => homeOf[c].point)).map(g => ({ point: g.point, members: g.members.map(j => members[j]) }));
  const central = grounds.filter(g => kmBetween(g.point, C) <= SAME_GROUND_KM);
  const around = grounds.filter(g => !central.includes(g));
  for (const g of around) {
    g.bearing = bearing(g.point);
    g.km = kmBetween(g.point, C);
    g.clear = Math.min(GROUND_TURN, Math.asin(Math.min(1, GROUND_CLEAR_KM / g.km)));
  }
  const marks = [...land.map(([b]) => b), ...around.map(g => g.bearing)].sort((a, b) => a - b);
  let widest = 0, gap = -1;
  marks.forEach((b, i) => {
    const next = i + 1 < marks.length ? marks[i + 1] : marks[0] + 2 * Math.PI;
    if (next - b > gap) { gap = next - b; widest = (b + gap / 2) % (2 * Math.PI); }
  });
  const sizeOf = slot => slot.members.reduce((sum, c) => sum + weightOf(c), 0);
  const apex = central.flatMap(g => g.members).sort((a, b) => a - b);
  // The sectors with their first edge at bearing `start`: the slots (grounds, with their bearings turned from `start`,
  // `at`, and the clubs at C), their edges (turned) and `least`, the land of the slot with least for its share, as a share.
  const layoutAt = start => {
    const turn = b => (b - start + 4 * Math.PI) % (2 * Math.PI);
    const slots = around.map(g => ({ ground: g, at: turn(g.bearing), members: g.members })).sort((a, b) => a.at - b.at || a.members[0] - b.members[0]);
    const turned = land.map(([b, w]) => [turn(b), w]).sort((a, b) => a[0] - b[0]);
    const total = turned.reduce((sum, [, w]) => sum + w, 0);
    const landIn = (a0, a1) => turned.reduce((sum, [b, w]) => sum + (b >= a0 && b < a1 ? w : 0), 0);
    // Clubs at C go where two grounds in turn hold the most land between them.
    let after = slots.length - 1, most = -1;
    slots.forEach((slot, i) => {
      const w = landIn(slot.at, i + 1 < slots.length ? slots[i + 1].at : 2 * Math.PI) + (i + 1 < slots.length ? 0 : landIn(0, slots[0].at));
      if (w > most) { most = w; after = i; }
    });
    slots.splice(after + 1, 0, ...apex.map(c => ({ ground: null, members: [c] })));
    const weight = slots.reduce((sum, slot) => sum + sizeOf(slot), 0);
    // The turned angle with `share` of the zone's land behind it (equal angles without land samples).
    const angleAt = share => {
      if (!total) return 2 * Math.PI * share;
      let acc = 0;
      for (const [b, w] of turned) { if (acc + w > share * total) return b; acc += w; }
      return 2 * Math.PI * share;
    };
    // Edges at equal land, kept between the grounds either side; grounds too close in turn for their clearance get the
    // edge halfway between them.
    const before = s => slots.slice(0, s).reverse().find(slot => slot.ground);
    const from = s => slots.slice(s).find(slot => slot.ground);
    const edges = [0];
    let behind = 0;
    for (let s = 1; s < slots.length; s++) {
      behind += sizeOf(slots[s - 1]);
      const prev = before(s), next = from(s);
      const lo = Math.max(edges[s - 1], prev ? prev.at + prev.ground.clear : 0), hi = next ? next.at - next.ground.clear : 2 * Math.PI;
      edges.push(lo <= hi ? Math.min(hi, Math.max(lo, angleAt(behind / weight)))
        : Math.max(edges[s - 1], prev && next ? (prev.at + next.at) / 2 : prev ? (prev.at + 2 * Math.PI) / 2 : edges[s - 1]));
    }
    edges.push(2 * Math.PI);
    const least = total ? Math.min(...slots.map((slot, s) => (landIn(edges[s], edges[s + 1]) * weight) / (total * sizeOf(slot)))) : 1;
    return { start, slots, edges, least };
  };
  // The first edge elsewhere: between each two grounds in turn, at both grounds' clearance and halfway between, or where
  // they share out what clearance there is.
  let layout = layoutAt(widest), best = layout;
  const turnOrder = [...around].sort((a, b) => a.bearing - b.bearing || a.members[0] - b.members[0]);
  turnOrder.forEach((p, i) => {
    const q = turnOrder[(i + 1) % turnOrder.length];
    const a0 = p.bearing, a1 = q.bearing + (i + 1 < turnOrder.length ? 0 : 2 * Math.PI);
    const lo = a0 + p.clear, hi = a1 - q.clear;
    for (const x of lo <= hi ? [lo, (lo + hi) / 2, hi] : [a0 + ((a1 - a0) * p.clear) / (p.clear + q.clear)]) {
      const other = layoutAt(x % (2 * Math.PI));
      if (other.least > best.least + 1e-9) best = other;
    }
  });
  if (best.least > FIRST_EDGE_GAIN * layout.least + FIRST_EDGE_MIN) layout = best;
  const { start, slots, edges } = layout;
  const sectors = new Map();
  slots.forEach((slot, s) => {
    const ring = wedgeRing(C, start + edges[s], start + edges[s + 1], far, kx, ky);
    // Clubs sharing a ground share out their land as one team (partitionCountry), so each ground here is one club's:
    // clubs within SAME_GROUND_KM of one another, should any come here, take the sector by turns, the first all of it.
    slot.members.forEach((c, k) => sectors.set(c, k ? [] : [[ring]]));
  });
  const order = slots.flatMap(slot => slot.members);
  const clubAt = p => order.find(c => pointInPolys(p, sectors.get(c))) ?? order[0];
  // The club whose sector a point lies in, however far from C (clubs sharing a ground, the first).
  const sectorOf = p => {
    const t = (bearing(p) - start + 4 * Math.PI) % (2 * Math.PI);
    let s = 0;
    while (s + 1 < slots.length && t >= edges[s + 1]) s++;
    return slots[s].members[0];
  };
  return { order, sectors, clubAt, sectorOf };
}

// A ground off the land counts from this far inland of the nearest point of it, where its unit is that deep (ontoLand).
const INLAND_KM = 0.3;

/** Distance from a point to the nearest edge of `polys` in km, inside or out. */
function edgeKm(p, polys) {
  const kx = Math.cos(p[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
    const ax = (ring[i][0] - p[0]) * kx, ay = (ring[i][1] - p[1]) * ky, bx = (ring[i + 1][0] - p[0]) * kx, by = (ring[i + 1][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, (ax + t * dx) ** 2 + (ay + t * dy) ** 2);
  }
  return Math.sqrt(best);
}

/**
 * Where a ground off the land (`p`, outside `polys`) meets it: the point of the land nearest it at least INLAND_KM from
 * any edge (else the deepest such point near it), so wedges round it all start on land; at worst a hair inside the
 * nearest edge.
 */
function ontoLand(polys, p) {
  const edge = ontoEdge(polys, p);
  const kx = Math.cos(edge[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  let best = null;
  for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
    const q = [edge[0] + 1.5 * i / 12 / kx, edge[1] + 1.5 * j / 12 / ky];
    if (!pointInPolys(q, polys)) continue;
    const deep = Math.min(INLAND_KM, edgeKm(q, polys)), km = kmBetween(q, p);
    if (!best || deep > best.deep + 1e-9 || (deep > best.deep - 1e-9 && km < best.km)) best = { q, deep, km };
  }
  return best && best.deep > 0.05 ? best.q : edge;
}

/** The point of `polys` nearest `p` (outside them), a hair inside their edge. */
function ontoEdge(polys, p) {
  const kx = Math.cos(p[1] * RAD), at = [];
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
      const dx = (bx - ax) * kx, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] - ax) * kx * dx + (p[1] - ay) * dy) / len)) : 0;
      const q = [ax + t * (bx - ax), ay + t * (by - ay)];
      const d = ((q[0] - p[0]) * kx) ** 2 + (q[1] - p[1]) ** 2;
      if (d < best) { best = d; at[0] = q[0]; at[1] = q[1]; }
    }
  }
  const away = Math.sqrt(best);
  for (const step of [1e-7, 1e-6, 1e-5]) {
    const q = away ? [at[0] + (at[0] - p[0]) * step / away, at[1] + (at[1] - p[1]) * step / away] : at;
    if (pointInPolys(q, polys)) return q;
  }
  return nearestInside(polys, p);
}

/**
 * A point of `polys` at or next to `p`: `p` itself inside them, else, in the part nearest it (a wedge cut round a ground
 * can leave a sliver at the ground and a larger part farther out), that part's interior sample nearest it.
 */
function nearestInside(polys, p) {
  if (pointInPolys(p, polys)) return p;
  let part = null, partKm = Infinity;
  for (const poly of polys) { const km = kmToPolys(p, [poly]); if (km < partKm) { partKm = km; part = poly; } }
  return interiorSamples({ polys: [part], bbox: bboxOf([part]) }, 400).filter(q => pointInPolys(q, [part]))
    .reduce((best, q) => (!best || kmBetween(q, p) < kmBetween(best, p) ? q : best), null) ?? interiorPoint([part]);
}

/**
 * Fans for clubs crowded into one city, when every club starts on two or more sections.
 * Clubs whose homes link within `linkKm` form a cluster (with `pairKm`, two that close count as a crowd too); its crowd is the clubs within
 * `linkKm` of the one with the most others within half that (a chain of towns linked out
 * from a city is no part of its crowd: Chantilly, Chambly and Beauvais beyond Paris), and a
 * crowd of three or more, or two sharing a town point, is fanned: left alone, the inner
 * ones are boxed in by their neighbours' sections and their groups stay in the city. Around
 * the crowd's centre, a zone wide enough for one corridor per club, stopping short of the
 * next town's ground beyond the crowd (that club grows from its own town), and holding every
 * club within it (at most `fanMax`), is cut into one sector per club (fanLayout, meeting at fanApex): of about
 * equal land within the zone, in the order of the grounds round the centre, each club's
 * ground inside its own sector, and clubs sharing a ground meeting there. Zone pieces are
 * tagged with their club (`unit.fans[f]`) and only it may take them (growSections' allowed);
 * beyond the zone the clubs grow freely, so their land follows the country's shape rather
 * than straight rays. Every club starts on its own ground: the piece of its sector holding
 * it (or, for a ground it shares, meeting the others' there). A unit holding the ground of
 * a club from outside the fan stays whole and open to every club. A cluster holding a
 * `force` club (found boxed in after growth) is fanned whatever its size, that club in its
 * crowd. With `wholeUnits`, the sectors keep to the units' own borders: a unit goes whole
 * to the club whose ground it holds, else, its centre within the zone, to the sector its
 * centre lies in, as far as it joins that club's ground (the sector's other parts are open
 * to every club); only a unit holding two or more of the fan's grounds is cut, between
 * those clubs alone (each sector of another club joins the nearest of theirs). Returns
 * { units, fans: [{ centre (where the sectors meet), zoneCentre, members (in sector order),
 * zoneKm }] } and moves
 * homeOf[i].unit (and, for a ground where pieces meet, .point to a point of the club's own
 * piece beside it).
 */
export function fanSectors(units, homeOf, { linkKm, grain, force = new Set(), wholeUnits = false, fanMax = FAN_MAX, weight = () => 1, pairKm = 0 }) {
  const n = homeOf.length;
  const clubs = [...Array(n).keys()].filter(c => homeOf[c]);
  const root = [...Array(n).keys()];
  const find = c => (root[c] === c ? c : (root[c] = find(root[c])));
  for (const a of clubs) for (const b of clubs) if (a < b && kmBetween(homeOf[a].point, homeOf[b].point) <= linkKm) root[find(a)] = find(b);
  const centreOf = list => [list.reduce((s, c) => s + homeOf[c].point[0], 0) / list.length, list.reduce((s, c) => s + homeOf[c].point[1], 0) / list.length];
  const fans = [];
  for (const head of clubs.filter(c => find(c) === c)) {
    const linked = clubs.filter(c => find(c) === head);
    if (linked.length < 2) continue;
    const around = c => linked.filter(d => d !== c && kmBetween(homeOf[c].point, homeOf[d].point) <= linkKm / 2).length;
    const core = linked.reduce((best, c) => (around(c) > around(best) ? c : best));
    const crowd = linked.filter(c => force.has(c) || kmBetween(homeOf[c].point, homeOf[core].point) <= linkKm);
    const shared = crowd.some(a => crowd.some(b => a < b && kmBetween(homeOf[a].point, homeOf[b].point) < 0.5));
    // Two clubs of one city (within `pairKm`) too: split along the line between their grounds, a port's two clubs got
    // the sea and the hinterland (Benfica 6,000 km² of Portugal with the Azores and Madeira, Sporting 37,000).
    const pair = crowd.length === 2 && kmBetween(homeOf[crowd[0]].point, homeOf[crowd[1]].point) <= pairKm;
    if (crowd.length < 3 && !(crowd.length === 2 && (shared || pair)) && !(crowd.length === 2 && crowd.some(c => force.has(c)))) continue;
    const centre = centreOf(crowd);
    const spread = Math.max(...crowd.map(c => kmBetween(homeOf[c].point, centre)));
    // Room for a corridor per club, within a few links of the city, up to halfway to the nearest ground beyond the crowd.
    let zoneKm = Math.min(Math.max(2 * spread, linkKm, 1.5 * crowd.length * grain / (2 * Math.PI)), 4 * Math.max(linkKm, spread));
    for (const c of clubs) {
      const km = kmBetween(homeOf[c].point, centre);
      if (!crowd.includes(c) && km > spread) zoneKm = Math.min(zoneKm, (spread + km) / 2);
    }
    // Every club within the zone joins: another club's start there would block the corridors.
    const members = clubs.filter(c => kmBetween(homeOf[c].point, centre) <= zoneKm);
    if (members.length > fanMax || fans.some(f => f.members.some(c => members.includes(c)))) continue;
    fans.push({ zoneCentre: centre, spread: Math.max(spread, SAME_GROUND_KM), members, zoneKm });
  }
  let list = units;
  fans.forEach((fan, f) => {
    const { zoneCentre: Z, zoneKm } = fan;
    const zone = list.filter(u => kmToPolys(Z, u.polys) <= zoneKm);
    // The sectors meet where each ground has the most land to take its sector from (fanApex); the zone stays round the
    // crowd's centre. Land is the land seen from there (landSeen).
    const seen = landSeen(Z, zoneKm, zone);
    const C = fan.centre = fanApex(fan.members.map(c => homeOf[c].point), fan.members.map(weight), Z, fan.spread, seen);
    const kx = Math.cos(C[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
    const land = [...seen(C)].map((w, b) => [(b + 0.5) * 2 * Math.PI / SEEN_BINS, w]).filter(([, w]) => w > 0);
    // The sectors reach past every unit they cut.
    let reach = 0;
    for (const u of zone) for (const poly of u.polys) for (const p of poly[0]) reach = Math.max(reach, Math.hypot((p[0] - C[0]) * kx, (p[1] - C[1]) * ky));
    const layout = fanLayout(C, fan.members, homeOf, land, 1.2 * reach + 1, weight);
    const members = fan.members = layout.order;
    fan.sectorOf = layout.sectorOf;
    const next = [];
    const cut = [];
    for (const u of list) {
      const tags = u.fans ? [...u.fans] : [];
      tags[f] = null;
      if (!zone.includes(u)) { next.push({ ...u, fans: tags }); continue; }
      const homesIn = clubs.filter(c => homeOf[c].unit === u.index);
      const own = homesIn.filter(c => members.includes(c));
      // A unit holding the ground of a club from outside the fan stays whole and open to every club: that club starts there.
      if (homesIn.length > own.length) { next.push({ ...u, fans: tags }); continue; }
      // Whole units: only one holding two or more of the fan's grounds is cut, and one that only reaches into the zone
      // (its centre beyond it: a county beside the city) stays open to every club.
      if (wholeUnits && own.length < 2) {
        const centre = interiorPoint(u.polys);
        tags[f] = own.length ? own[0] : kmBetween(centre, Z) <= zoneKm ? layout.clubAt(centre) : null;
        next.push({ ...u, fans: tags });
        continue;
      }
      const pieces = [];
      let failed = false;
      members.forEach((club, i) => {
        if (failed || !layout.sectors.get(club).length) return;
        try {
          const polys = polygonClipping.intersection(u.polys, layout.sectors.get(club)).map(poly => poly.map(closeRing).filter(r => r.length >= 4)).filter(q => q.length);
          if (polys.length) pieces.push({ club, i, polys });
        } catch { failed = true; }
      });
      if (failed || pieces.length < 2) {
        // A unit in one sector, or one that will not cut, goes whole to the club whose ground it holds, else to the sector
        // its centre lies in (open with whole units); one holding several grounds stays open for the crowd cut.
        tags[f] = own.length === 1 ? own[0] : own.length || wholeUnits ? null : pieces.length === 1 && !failed ? pieces[0].club : layout.clubAt(u.centroid);
        next.push({ ...u, fans: tags });
        continue;
      }
      if (wholeUnits) {
        // A unit holding grounds goes to their clubs only: another club's sector joins the nearest of theirs around the fan.
        const k = members.length, ownAt = members.map((c, i) => (own.includes(c) ? i : -1)).filter(i => i >= 0);
        for (const p of pieces) {
          if (own.includes(p.club)) continue;
          const step = i => Math.min((i - p.i + k) % k, (p.i - i + k) % k);
          p.club = members[ownAt.reduce((best, i) => (step(i) < step(best) ? i : best))];
        }
      }
      const dirOf = pc => COMPASS[((Math.round(Math.atan2((pc[1] - C[1]) * ky, (pc[0] - C[0]) * kx) / (Math.PI / 4)) % 8) + 8) % 8];
      const base = u.baseName ?? u.name;
      for (const p of pieces) {
        const dir = dirOf(centroidOf(p.polys));
        for (const m of explodeUnits([{ id: `${u.id}~f${f}.${p.i}`, name: `${base} (${dir})`, baseName: base, qualifier: dir, polys: p.polys }],
          () => (own.includes(p.club) ? nearestInside(p.polys, homeOf[p.club].point) : null))) {
          const v = { ...m, fans: Object.assign([...tags], { [f]: p.club }) };
          next.push(v);
          cut.push(v);
        }
      }
    }
    if (cut.length) {
      const boxes = cut.map(v => bboxOf(v.polys));
      const hits = (a, b) => !(a[0] > b[2] + 1e-6 || a[2] < b[0] - 1e-6 || a[1] > b[3] + 1e-6 || a[3] < b[1] - 1e-6);
      nodeRings(next.filter(v => cut.includes(v) || boxes.some(b => hits(bboxOf(v.polys), b))));
    }
    const before = list;
    list = prepareUnits(next);
    const map = unitMapper(before, list);
    homeOf.forEach((h, c) => { if (h) homeOf[c] = { ...h, unit: map(h.unit, h.point) }; });
    // Each club starts on its own ground: the unit holding it (or, for a ground snapped from just outside, nearest it),
    // when that is its own piece or one left open; else, for a ground at a meeting point, its own piece there.
    for (const c of members) {
      const home = homeOf[c].point, at = list[homeOf[c].unit];
      if ((at.fans[f] ?? c) === c) continue;
      const own = list.filter(u => u.fans[f] === c);
      if (!own.length) continue;
      const first = own.find(u => inBox(home, u.bbox) && pointInPolys(home, u.polys))
        ?? own.reduce((best, u) => (kmToPolys(home, u.polys) < kmToPolys(home, best.polys) ? u : best));
      homeOf[c] = { ...homeOf[c], unit: first.index, point: nearestInside(first.polys, home) };
    }
  });
  // With whole units, a sector's parts cut off from its club's ground are no corridor of its: open to every club.
  if (wholeUnits && fans.length) {
    const { adjacency } = unitTopology(list);
    fans.forEach((fan, f) => {
      for (const c of fan.members) {
        const own = new Set(list.filter(u => u.fans[f] === c).map(u => u.index));
        const first = homeOf[c].unit;
        if (!own.has(first)) continue;
        const seen = new Set([first]);
        const stack = [first];
        while (stack.length) for (const v of adjacency[stack.pop()]) if (own.has(v) && !seen.has(v)) { seen.add(v); stack.push(v); }
        for (const v of own) if (!seen.has(v)) list[v].fans[f] = null;
      }
    });
  }
  return { units: list, fans };
}

/**
 * Format 2 with fewer clubs than sections: each club's territory (its format-1 section,
 * `owner` from growSections over `units` and their `adjacency`, started at
 * `seedUnit`/`seedPoint`) is cut into
 * its group of sections, so every group is one territory, contiguous as format-1
 * sections are. Group sizes are floor or ceil(sections / clubs), the stronger clubs the
 * larger, except that a territory too small for its larger size (under `minSectionKm2`
 * a section: a club hemmed in by others in its city) gives that size to the strongest
 * club with room. Each territory gets its extra seeds (territoryExtras, at `places`),
 * units holding several starts are cut (splitUnits with crowdAll), and each territory
 * grows its own sections (growSections on its units alone). Returns { units, topo,
 * adjacency, owner: unit -> start (clubs, then extras), seedUnit, seedPoint, extras:
 * [{ unit, point, place, kind, group }], targets, moved, splits, unitOf(old unit index,
 * point) for indices into the new units }.
 */
export function subdivideTerritories(units, { owner, seedUnit, seedPoint, adjacency: unitAdjacency }, homeOf, places, sections, { reach, padKm, minKm2 = 0, minSectionKm2 = 0, log = () => {} } = {}) {
  const n = seedUnit.length;
  const targets = groupTargets(sections, n);
  const q = Math.min(...targets);
  const area = new Array(n).fill(0);
  owner.forEach((c, u) => { area[c] += units[u].area; });
  const moved = new Set();
  for (let c = 0; c < n; c++) {
    if (targets[c] !== q + 1 || area[c] / (q + 1) >= minSectionKm2) continue;
    const taker = [...Array(n).keys()].find(d => targets[d] === q && area[d] / (q + 1) >= minSectionKm2);
    if (taker == null) break;
    targets[c] = q;
    targets[taker] = q + 1;
    moved.add(c).add(taker);
  }
  const tagged = units.map((u, i) => ({ ...u, territory: owner[i] }));
  // Places by territory, most populous first.
  const placesIn = Array.from({ length: n }, () => []);
  for (const p of [...places].sort((a, b) => b.pop - a.pop || a.id - b.id)) {
    const q2 = [p.lon, p.lat];
    const unit = units.find(u => inBox(q2, u.bbox) && pointInPolys(q2, u.polys))?.index;
    if (unit != null && placesIn[owner[unit]].length < 500) placesIn[owner[unit]].push({ ...p, unit });
  }
  // A club's start stays its format-1 start; for the cut, its point there, or the point of that unit nearest it (a
  // ground where pieces meet).
  const starts = Array.from({ length: n }, (_, c) => {
    const u = units[seedUnit[c]];
    const point = nearestInside(u.polys, seedPoint[c]);
    return { unit: seedUnit[c], point, ...(homeOf[c]?.placed ? { placed: true } : {}) };
  });
  const extras = [];
  for (let c = 0; c < n; c++) {
    if (targets[c] < 2) continue;
    const mine = tagged.filter(u => u.territory === c);
    // A start smaller than a quarter of its sections' share keeps its neighbours for itself.
    const small = units[seedUnit[c]].area < 0.25 * area[c] / targets[c];
    const avoid = new Set(small ? [seedUnit[c], ...unitAdjacency[seedUnit[c]]] : []);
    // The territory's landmasses.
    const inside = new Set(mine.map(u => u.index));
    const partOf = new Map();
    for (const u of mine) {
      if (partOf.has(u.index)) continue;
      const stack = [u.index];
      partOf.set(u.index, u.index);
      while (stack.length) for (const v of unitAdjacency[stack.pop()]) if (inside.has(v) && !partOf.has(v)) { partOf.set(v, u.index); stack.push(v); }
    }
    for (const e of territoryExtras(mine, starts[c].point, seedUnit[c], placesIn[c], targets[c] - 1, { minKm2, avoid, part: u => partOf.get(u) })) extras.push({ ...e, group: c });
  }
  const seeds = [...starts, ...extras.map(e => ({ unit: e.unit, point: e.point }))];
  const groupOf = k => (k < n ? k : extras[k - n].group);
  const { units: cut, splits } = splitUnits(tagged, seeds, sections, { crowdAll: true, ownHomes: true, minKm2, sliverKm: Math.max(SLIVER_WIDTH_KM, contactKmOf(tagged) / 2), log });
  extras.forEach((e, i) => { e.unit = seeds[n + i].unit; });
  const { topo, adjacency } = unitTopology(cut);
  const out = new Array(cut.length).fill(-1);
  const startUnit = new Array(seeds.length), startPoint = new Array(seeds.length);
  for (let c = 0; c < n; c++) {
    const mine = cut.filter(u => u.territory === c);
    const local = new Map(mine.map((u, i) => [u.index, i]));
    const sub = mine.map((u, i) => ({ ...u, index: i }));
    const subAdjacency = mine.map(u => adjacency[u.index].filter(v => local.has(v)).map(v => local.get(v)));
    const own = seeds.map((_, k) => k).filter(k => groupOf(k) === c);
    const homes = own.map(k => {
      if (!local.has(seeds[k].unit)) throw new Error(`A start of club ${c + 1} lies outside its territory`);
      return { ...seeds[k], unit: local.get(seeds[k].unit) };
    });
    const grown = growSections(sub, subAdjacency, homes, { reach, padKm, minKm2 });
    grown.owner.forEach((o, i) => { out[mine[i].index] = own[o]; });
    own.forEach((k, j) => { startUnit[k] = mine[grown.seedUnit[j]].index; startPoint[k] = grown.seedPoint[j]; });
  }
  const contactKm = contactKmOf(cut);
  const homePoints = homeOf.map(h => h?.point ?? null);
  const sharing = homePoints.map((h, c) => !!h && homePoints.some((o, d) => d !== c && o && kmBetween(o, h) <= SAME_GROUND_KM));
  widenThinSections(cut, adjacency, out, startUnit, k => groupOf(k), Math.max(SLIVER_WIDTH_KM, contactKm / 2), crumbKm2Of(contactKm), homePoints, sharing);
  keepSectionsWhole(cut, topo, adjacency, out, startUnit, k => groupOf(k));
  if (extras.length) log(`  ${extras.length} extra sections: ${extras.filter(e => e.kind === 'place').length} at places, ${extras.filter(e => e.kind !== 'place').length} at unit centres or land samples${moved.size ? `; sizes moved: ${[...moved].sort((a, b) => a - b).map(c => `#${c + 1}`).join(', ')}` : ''}`);
  const unitOf = unitMapper(units, cut);
  return {
    units: cut, topo, adjacency, owner: out, seedUnit: startUnit, seedPoint: startPoint, extras, targets,
    moved: [...moved].sort((a, b) => a - b), splits, unitOf,
  };
}

/**
 * A section on nothing but slivers (units narrower than `sliverKm`, which the map draws as lines: IFK Gothenburg's home
 * section on a strip beside Ullevi, Sweden's map of 1994/95), or a crumb (under `crumbKm2` in all, which the map may not
 * draw at all), takes the largest unit beside it of another section of its club holding more than one, never that
 * section's start, until it is neither or none is left. A crumb no section of its club can widen (OC Renaissance du
 * Congo's, six sections in its 8 km² of Kinshasa, among three clubs on the city's one point) takes one of another club's
 * so, of a unit neither parting that club's land nor leaving its ground (`homes` by club, `sharing` by club: a home
 * another's shares) out of reach. `owner`: unit -> section, rewritten; `clubOf` section -> club.
 */
function widenThinSections(units, adjacency, owner, startUnit, clubOf, sliverKm, crumbKm2 = 0, homes = [], sharing = []) {
  const own = Array.from({ length: startUnit.length }, () => []);
  owner.forEach((k, u) => { if (k >= 0) own[k].push(u); });
  const wide = u => units[u].polys.some(poly => widthKm(poly) >= sliverKm);
  const crumb = k => own[k].reduce((sum, u) => sum + units[u].area, 0) < crumbKm2;
  const small = k => !own[k].some(wide) || crumb(k);
  // The pieces a club's land falls in, leaving out unit `skip`.
  const pieces = (club, skip = -1) => {
    const mine = new Set();
    owner.forEach((k, u) => { if (k >= 0 && u !== skip && clubOf(k) === club) mine.add(u); });
    const seen = new Set();
    let count = 0;
    for (const u of mine) {
      if (seen.has(u)) continue;
      count++;
      const stack = [u];
      seen.add(u);
      while (stack.length) for (const v of adjacency[stack.pop()]) if (mine.has(v) && !seen.has(v)) { seen.add(v); stack.push(v); }
    }
    return count;
  };
  // Whether a club keeps land within its slack of its home without unit `v`.
  const near = (u, h, km) => boxKm(units[u].bbox, [h[0], h[1], h[0], h[1]]) <= km && kmToPolys(h, units[u].polys) <= km;
  const keepsGround = (club, v) => {
    const h = homes[club];
    const km = sharing[club] ? SHARED_SLACK_KM : GROUND_SLACK_KM;
    return !h || !near(v, h, km) || owner.some((k, u) => u !== v && k >= 0 && clubOf(k) === club && near(u, h, km));
  };
  for (let k = 0; k < own.length; k++) {
    while (own[k].length && small(k)) {
      let best = -1;
      const larger = v => best < 0 || units[v].area > units[best].area || (units[v].area === units[best].area && v < best);
      for (const u of own[k]) for (const v of adjacency[u]) {
        const j = owner[v];
        if (j < 0 || j === k || clubOf(j) !== clubOf(k) || v === startUnit[j] || own[j].length < 2 || !wide(v)) continue;
        if (larger(v)) best = v;
      }
      if (best < 0 && crumb(k)) {
        for (const u of own[k]) for (const v of adjacency[u]) {
          const j = owner[v];
          if (j < 0 || clubOf(j) === clubOf(k) || v === startUnit[j] || own[j].length < 2 || !wide(v) || !larger(v)) continue;
          if (keepsGround(clubOf(j), v) && pieces(clubOf(j), v) <= pieces(clubOf(j))) best = v;
        }
      }
      if (best < 0) break;
      const j = owner[best];
      own[j].splice(own[j].indexOf(best), 1);
      own[k].push(best);
      owner[best] = k;
    }
  }
}

/**
 * A section is its start's land and islands off it, never parted by other land (`owner`: unit -> section, rewritten;
 * `topo` and `adjacency` the units'; `startUnit` per section; `clubOf` section -> club). Growth hands an island to any
 * section in reach, so a section starting inland could be given islands larger than its land (Tauro's, in Panama City,
 * those off Darién) and part across its neighbours' land. So a stretch of a section not joined to its start and off the
 * sea goes to the section of its club it borders most; and a section whose start's stretch lies off the sea while
 * another of its stretches is larger gives those to the nearest section of its club whose start's stretch reaches the
 * sea or is larger than each.
 */
function keepSectionsWhole(units, topo, adjacency, owner, startUnit, clubOf) {
  const uses = new Map();
  const arcsOf = g => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).flat(2);
  for (const g of topo.objects.units.geometries) for (const a of arcsOf(g)) { const k = a < 0 ? ~a : a; uses.set(k, (uses.get(k) || 0) + 1); }
  const coastal = topo.objects.units.geometries.map(g => arcsOf(g).some(a => uses.get(a < 0 ? ~a : a) === 1));
  const stretchesOf = k => {
    const own = [];
    owner.forEach((o, u) => { if (o === k) own.push(u); });
    const seen = new Set(), out = [];
    for (const u of own) {
      if (seen.has(u)) continue;
      const s = { units: [u], area: 0, coast: false };
      seen.add(u);
      for (let q = 0; q < s.units.length; q++) {
        const v = s.units[q];
        s.area += units[v].area;
        s.coast ||= coastal[v];
        for (const w of adjacency[v]) if (owner[w] === k && !seen.has(w)) { seen.add(w); s.units.push(w); }
      }
      out.push(s);
    }
    return out;
  };
  for (let k = 0; k < startUnit.length; k++) {
    const stretches = stretchesOf(k);
    if (stretches.length < 2) continue;
    const home = stretches.find(s => s.units.includes(startUnit[k]));
    if (!home) continue;
    const rest = stretches.filter(s => s !== home);
    // Enclaves: to the section of the club they border most.
    for (const s of rest) {
      if (s.coast) continue;
      const along = new Map();
      for (const v of s.units) for (const w of adjacency[v]) if (owner[w] !== k && owner[w] >= 0 && clubOf(owner[w]) === clubOf(k)) along.set(owner[w], (along.get(owner[w]) || 0) + 1);
      const to = [...along].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (to != null) for (const v of s.units) owner[v] = to;
    }
    // An inland start with larger land elsewhere: that land to the nearest section of the club with a coast at its start,
    // or a start's stretch larger than it.
    const islands = rest.filter(s => s.coast);
    if (home.coast || !islands.some(s => s.area > home.area)) continue;
    const starts = [];
    for (let j = 0; j < startUnit.length; j++) {
      if (j === k || clubOf(j) !== clubOf(k)) continue;
      const theirs = stretchesOf(j).find(s => s.units.includes(startUnit[j]));
      if (theirs) starts.push({ j, stretch: theirs, shore: theirs.coast ? theirs.units.filter(v => coastal[v]) : theirs.units });
    }
    for (const s of islands) {
      const c = centroidOf(s.units.flatMap(v => units[v].polys));
      const near = starts.filter(({ stretch }) => stretch.coast || stretch.area > s.area)
        .map(({ j, shore }) => [Math.min(...shore.map(v => kmBetween(c, units[v].centroid))), j]).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]?.[1];
      if (near != null) for (const v of s.units) owner[v] = near;
    }
  }
}

// ---- Splitting crowded units ----

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];

/** Deterministic k-means with farthest-point initialisation. */
function kmeans(points, k, scale) {
  const d2 = (a, b) => ((a[0] - b[0]) * scale) ** 2 + (a[1] - b[1]) ** 2;
  const mean = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  let first = 0;
  points.forEach((p, i) => { if (d2(p, mean) > d2(points[first], mean)) first = i; });
  const centres = [points[first].slice()];
  while (centres.length < k) {
    let best = 0, bestD = -1;
    points.forEach((p, i) => { const d = Math.min(...centres.map(c => d2(p, c))); if (d > bestD) { bestD = d; best = i; } });
    centres.push(points[best].slice());
  }
  for (let iter = 0; iter < 40; iter++) {
    const sums = centres.map(() => [0, 0, 0]);
    for (const p of points) {
      let best = 0;
      centres.forEach((c, j) => { if (d2(p, c) < d2(p, centres[best])) best = j; });
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2]++;
    }
    let moved = false;
    sums.forEach((s, j) => {
      if (!s[2]) return;
      const next = [s[0] / s[2], s[1] / s[2]];
      if (next[0] !== centres[j][0] || next[1] !== centres[j][1]) moved = true;
      centres[j] = next;
    });
    if (!moved) break;
  }
  return centres;
}

function interiorSamples(unit, target = 900) {
  const [w, s, e, n] = unit.bbox;
  const scale = Math.cos(((s + n) / 2) * RAD);
  const step = Math.sqrt(((e - w) * scale * (n - s)) / target) || 1e-3;
  const pts = [];
  for (let y = s + step / 2; y < n; y += step) for (let x = w + step / scale / 2; x < e; x += step / scale) {
    if (pointInPolys([x, y], unit.polys)) pts.push([x, y]);
  }
  return pts.length >= 8 ? pts : unit.polys.flatMap(poly => poly[0]);
}

/**
 * Cut one unit into pieces: Voronoi cells of `sites` (computed on a plane scaled
 * by cos(latitude), then mapped back to lon/lat) intersected with the unit. Sites on
 * one line (places on a GeoNames grid) can break the diagram, a site losing its cell
 * while another's covers the whole box: then they are nudged apart by a few centimetres,
 * a little more on each try, until every site lies in its own cell.
 */
function cutUnit(unit, sites) {
  const scale = Math.cos(((unit.bbox[1] + unit.bbox[3]) / 2) * RAD);
  const pad = 1;
  const bounds = [(unit.bbox[0] - pad) * scale, unit.bbox[1] - pad, (unit.bbox[2] + pad) * scale, unit.bbox[3] + pad];
  let voronoi;
  for (let k = 0, at = sites.map(([x, y]) => [x * scale, y]); ; k++) {
    voronoi = Delaunay.from(at).voronoi(bounds);
    if (k === 4 || at.every((p, i) => { const cell = voronoi.cellPolygon(i); return cell && at.every((q, j) => pointInRing(q, cell) === (i === j)); })) break;
    const eps = 1e-7 * 10 ** k;
    at = sites.map(([x, y], i) => [x * scale + eps * Math.cos(2.4 * i), y + eps * Math.sin(2.4 * i)]);
  }
  const pieces = [];
  sites.forEach((site, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return;
    const ring = cell.map(([x, y]) => [x / scale, y]);
    const polys = polygonClipping.intersection(unit.polys, [ring]).map(poly => poly.map(closeRing).filter(r => r.length >= 4)).filter(p => p.length);
    if (polys.length) pieces.push({ site: i, polys });
  });
  return pieces;
}

/**
 * Make shared borders vertex-identical again after cutting: snap near-equal
 * vertices (polygon-clipping computes each cell's boundary crossings separately)
 * and insert every vertex that lies on another ring's segment, so topojson-server
 * finds the same arcs on both sides of a border.
 */
export function nodeRings(units, eps = 1e-9) {
  const cell = 1e-3;
  const grid = new Map();
  const key = (ix, iy) => `${ix},${iy}`;
  const canonical = p => {
    const ix = Math.floor(p[0] / cell), iy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const q of grid.get(key(ix + dx, iy + dy)) || []) {
        if (Math.abs(q[0] - p[0]) <= eps && Math.abs(q[1] - p[1]) <= eps) return q;
      }
    }
    const k = key(ix, iy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
    return p;
  };
  for (const u of units) u.polys = u.polys.map(poly => poly.map(ring => ring.map(p => canonical([p[0], p[1]]))));
  for (const u of units) {
    u.polys = u.polys.map(poly => poly.map(ring => {
      const out = [ring[0]];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
        const hits = [];
        if (len2 > 0) {
          const x0 = Math.floor((Math.min(a[0], b[0]) - eps) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + eps) / cell);
          const y0 = Math.floor((Math.min(a[1], b[1]) - eps) / cell), y1 = Math.floor((Math.max(a[1], b[1]) + eps) / cell);
          // Long Voronoi edges cross many cells; walking every cell would be slow.
          if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 4096) {
            for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
              for (const q of grid.get(key(ix, iy)) || []) {
                if (q === a || q === b) continue;
                const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
                if (t <= 0 || t >= 1) continue;
                const cross = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / Math.sqrt(len2);
                if (cross <= eps) hits.push([t, q]);
              }
            }
          } else {
            for (const list of grid.values()) for (const q of list) {
              if (q === a || q === b) continue;
              const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
              if (t <= 0 || t >= 1) continue;
              const cross = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / Math.sqrt(len2);
              if (cross <= eps) hits.push([t, q]);
            }
          }
        }
        hits.sort((h, k) => h[0] - k[0]);
        for (const [, q] of hits) if (out[out.length - 1] !== q) out.push(q);
        if (out[out.length - 1] !== b) out.push(b);
      }
      // Snapping can fold near-coincident vertices into a spike (A, B, A): drop it, or
      // topojson keeps a zero-width slit as an arc used twice.
      const clean = [];
      for (const p of out) {
        if (clean.length >= 2 && clean[clean.length - 2] === p) clean.pop();
        else if (clean[clean.length - 1] !== p) clean.push(p);
      }
      return clean.length >= 4 ? clean : out;
    }));
  }
}

/**
 * Sites for cutting a crowded unit into one piece per club, one per point and in the
 * same order. Homes closer than a tenth of a typical cell (often one town point
 * shared by several clubs) form a group; a group of m shares the land around its
 * town through the m k-means centres of the interior samples within half the
 * radius of m cells, so its clubs start side by side, near home, in pieces of
 * similar size. A site off the unit moves to the nearest free interior sample.
 * With `fanKm`, a group's sites sit instead on a ring of about that radius around
 * its town, at the same bearings: the pieces become a fan of wedges meeting near
 * home, for a town at the edge of a huge unit (Hofuf in Al-Ahsa), where the k-means
 * cells meet far out in the desert.
 */
function crowdSites(points, unit, { fanKm = 0 } = {}) {
  const k = points.length;
  const cellKm = Math.sqrt(unit.area / k);
  const groups = [];
  points.forEach((p, i) => {
    const g = groups.find(o => o.some(j => kmBetween(p, points[j]) < cellKm / 10));
    if (g) g.push(i); else groups.push([i]);
  });
  const lat = (unit.bbox[1] + unit.bbox[3]) / 2;
  const kx = Math.cos(lat * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  const samples = interiorSamples(unit, 1600);
  const sites = new Array(k);
  for (const members of groups) {
    const m = members.length;
    const c = [members.reduce((t, j) => t + points[j][0], 0) / m, members.reduce((t, j) => t + points[j][1], 0) / m];
    if (m === 1) { sites[members[0]] = c; continue; }
    const km = p => Math.hypot((p[0] - c[0]) * kx, (p[1] - c[1]) * ky);
    const bearing = p => (km(p) ? (Math.atan2((p[1] - c[1]) * ky, (p[0] - c[0]) * kx) + 2 * Math.PI) % (2 * Math.PI) : 0);
    const byKm = samples.map(p => [km(p), p]).sort((x, y) => x[0] - y[0] || x[1][0] - y[1][0] || x[1][1] - y[1][1]);
    let local = byKm.filter(([d]) => d <= cellKm * Math.sqrt(m) / 2).map(([, p]) => p);
    if (local.length < 4 * m) local = byKm.slice(0, 4 * m).map(([, p]) => p);
    const centres = kmeans(local, m, kx / ky).map((q, i) => [bearing(q), i, q]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    // Fan radii differ slightly: exactly cocircular sites make a degenerate Voronoi diagram.
    const fan = (b, slot) => {
      const r = fanKm * (1 + 0.1 * slot / m);
      return [c[0] + r * Math.cos(b) / kx, c[1] + r * Math.sin(b) / ky];
    };
    // Clubs take the centres in bearing order (index order when their homes coincide).
    [...members].sort((x, y) => bearing(points[x]) - bearing(points[y]) || x - y).forEach((j, slot) => {
      sites[j] = fanKm ? fan(centres[slot][0], slot) : centres[slot][2];
    });
  }
  const used = new Set(sites.filter(q => pointInPolys(q, unit.polys)).map(q => `${q[0]},${q[1]}`));
  return sites.map(q => {
    if (pointInPolys(q, unit.polys)) return q;
    let best = q, bestD = Infinity;
    for (const p of samples) {
      const d = ((p[0] - q[0]) * kx) ** 2 + ((p[1] - q[1]) * ky) ** 2;
      if (d < bestD && !used.has(`${p[0]},${p[1]}`)) { bestD = d; best = p; }
    }
    used.add(`${best[0]},${best[1]}`);
    return best;
  });
}

/**
 * `polys` cut into `m` wedges around P, anticlockwise, of about equal land (interior samples), the first starting in the
 * middle of the widest gap between them (the sea, for a port); every wedge's edges pass between two samples, so each
 * holds land. Returns m polygon lists.
 */
function wedgesAround(P, polys, m, minWidthKm = 0) {
  const kx = Math.cos(P[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  const bbox = bboxOf(polys);
  let edges = wedgeEdges(P, m, q => inBox(q, bbox) && pointInPolys(q, polys), kx, ky);
  if (!edges) {
    // Too little land round the ground for a grid of it: the whole cell's.
    const bearing = q => (Math.atan2((q[1] - P[1]) * ky, (q[0] - P[0]) * kx) + 2 * Math.PI) % (2 * Math.PI);
    const angles = interiorSamples({ polys, bbox }, 1600).map(bearing).sort((a, b) => a - b);
    let start = 0, gap = -1;
    angles.forEach((a, i) => {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
      if (next - a > gap) { gap = next - a; start = a + gap / 2; }
    });
    const turned = angles.map(a => (a - start + 4 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    edges = [start];
    for (let k = 1; k < m; k++) {
      const i = Math.floor(turned.length * k / m);
      edges.push(start + (turned.length > m ? (turned[i - 1] + turned[i]) / 2 : 2 * Math.PI * k / m));
    }
    edges.push(start + 2 * Math.PI);
  }
  let far = 0;
  for (const poly of polys) for (const q of poly[0]) far = Math.max(far, Math.hypot((q[0] - P[0]) * kx, (q[1] - P[1]) * ky));
  const parts = edges.slice(0, m).map((e, k) => ({ k, polys: polygonClipping.intersection(polys, [wedgeRing(P, e, edges[k + 1], 1.2 * far + 1, kx, ky)])
    .map(poly => poly.map(closeRing).filter(r => r.length >= 4)).filter(q => q.length) }));
  const kept = minWidthKm > 0 ? absorbSlivers(parts, minWidthKm, { keepLargest: true }) : parts;
  return parts.map(({ k }) => kept.find(p => p.k === k)?.polys ?? []);
}

/**
 * A unit cut for the clubs whose grounds it holds (`points`, in club order), each club's piece holding its own ground:
 * the Voronoi cells of the grounds (groundsOf; a ground snapped from beyond the unit stands at the unit's point nearest
 * it), and a ground two or more clubs share cut into one wedge each around it, of about equal land, all meeting there
 * (wedgesAround). Returns [{ site: index into points, polys, anchor: a point of the piece at or beside its ground }], one
 * per club, or null when a club would get no piece or the cut fails.
 */
function groundPieces(unit, points, minWidthKm = 0) {
  const grounds = groundsOf(points);
  try {
    const cells = grounds.length > 1 ? cutUnit(unit, grounds.map(g => nearestInside(unit.polys, g.point))) : [{ site: 0, polys: unit.polys }];
    const pieces = [];
    for (const { site, polys } of cells) {
      const { point, members } = grounds[site];
      const parts = members.length > 1 ? wedgesAround(point, polys, members.length, minWidthKm) : [polys];
      parts.forEach((part, k) => { if (part.length) pieces.push({ site: members[k], polys: part, anchor: nearestInside(part, points[members[k]]) }); });
    }
    return pieces.length === points.length ? pieces : null;
  } catch {
    return null;
  }
}

/** Club indices per unit index, in club order. */
const clubsByUnit = homeOf => {
  const byUnit = new Map();
  homeOf.forEach((h, club) => {
    if (!h || h.unit == null) return;
    if (!byUnit.has(h.unit)) byUnit.set(h.unit, []);
    byUnit.get(h.unit).push(club);
  });
  return byUnit;
};

/**
 * Split units so clubs can start at home. Two rules, in this order:
 * 1. While there are fewer units than clubs (the spec's rule; slivers below `minKm2`
 *    do not count): cut the unit holding
 *    the most club homes into one piece per club (Voronoi of sites at the homes, see
 *    crowdSites; ties: the larger unit), else halve the largest unit (Voronoi of two
 *    k-means centres of interior points).
 * 2. Then, while seeding would leave a club more than `maxGapKm` from home because
 *    stronger clubs share its unit (Lancashire holds five English clubs), cut that
 *    unit into one piece per club, worst gap first. Close neighbours (Chelsea, Fulham
 *    and QPR in one London borough) are not worth slivers and stay displaced.
 *    With `ownHomes` (the maps whose clubs all keep their own grounds) every unit
 *    holding two or more grounds is cut instead, most first, whatever the gap, and each
 *    club's piece holds its own ground (groundPieces): Chelsea, Fulham and QPR each hold
 *    their part of Hammersmith and Fulham, and clubs sharing a ground meet there.
 * Each club of a cut unit gets the piece of its own site, so clubs sharing one town
 * point still start side by side; a unit cut for its clubs is never cut again.
 * Updates `homeOf[i].unit` (with `ownHomes`, a club whose ground lies where pieces meet
 * also `.point`, to a point of its own piece there); returns the new unit list and a
 * record of each split.
 */
export function splitUnits(units, homeOf, n, { maxGapKm = Infinity, minKm2 = 0, crowdAll = false, maxUnitKm2 = Infinity, ownHomes = false, sliverKm = 0, log = () => {} } = {}) {
  let list = units.map(u => ({ ...u })); // nodeRings rewrites rings of the units it touches
  const splits = [];
  const crowdCut = new Set(); // pieces of a unit cut for its clubs: never cut for clubs again
  const failed = new Set(); // units the cutter could not split
  // Units are re-indexed after every cut; clubs follow their unit by id.
  const unitIdOf = homeOf.map(h => (h && h.unit != null ? list[h.unit].id : null));
  for (;;) {
    const clubsIn = clubsByUnit(homeOf);
    let pick = null;
    // The unit holding the most starts (then the largest) not yet cut for its clubs.
    const crowded = word => {
      for (const u of list) {
        const k = (clubsIn.get(u.index) || []).length;
        if (k < 2 || crowdCut.has(u.id) || failed.has(u.id)) continue;
        if (!pick || k > pick.k || (k === pick.k && u.area > pick.u.area)) pick = { u, k, crowd: true, why: `${k} ${word}` };
      }
    };
    // With crowdAll (a territory's sections, subdivideTerritories), every unit holding
    // several starts is cut, most first.
    if (crowdAll) {
      crowded('starts');
      if (!pick) {
        // A territory left with more starts than units (a cut short of pieces): halve its largest unit.
        const count = new Map(), starts = new Map();
        for (const u of list) count.set(u.territory, (count.get(u.territory) || 0) + 1);
        homeOf.forEach(h => { if (h && h.unit != null) starts.set(list[h.unit].territory, (starts.get(list[h.unit].territory) || 0) + 1); });
        const short = [...starts].find(([t, k]) => (count.get(t) || 0) < k)?.[0];
        if (short !== undefined) {
          for (const u of list) if (u.territory === short && !failed.has(u.id) && (!pick || u.area > pick.u.area)) pick = { u, k: 0, crowd: false, why: 'a territory short of units' };
        }
      }
      if (!pick) break;
    } else if (list.filter(u => u.area >= minKm2).length < n || list.some(u => u.area > maxUnitKm2 && !failed.has(u.id))) {
      for (const u of list) {
        const k = (clubsIn.get(u.index) || []).length;
        if (k < 2 || crowdCut.has(u.id) || failed.has(u.id)) continue;
        if (!pick || k > pick.k || (k === pick.k && u.area > pick.u.area)) pick = { u, k, crowd: true, why: `${k} clubs` };
      }
      if (!pick) {
        // A unit larger than a section could be (format 2: maxUnitKm2) is halved too.
        for (const u of list) if (!failed.has(u.id) && (!pick || u.area > pick.u.area)) pick = { u, k: 0, crowd: false, why: 'largest unit' };
        if (!pick) throw new Error('No unit can be split further');
      }
    } else if (ownHomes) {
      crowded('grounds');
      if (!pick) break;
    } else if (maxGapKm < Infinity) {
      const { seedUnit } = seedSections(list, unitTopology(list).adjacency, homeOf, { minKm2 });
      let worst = null;
      homeOf.forEach((h, club) => {
        if (!h || seedUnit[club] === h.unit || crowdCut.has(list[h.unit].id) || failed.has(list[h.unit].id)) return;
        const gap = kmToPolys(h.point, list[seedUnit[club]].polys);
        if (gap > maxGapKm && (!worst || gap > worst.gap || (gap === worst.gap && h.unit < worst.u.index))) worst = { u: list[h.unit], gap };
      });
      if (!worst) break;
      const k = clubsIn.get(worst.u.index).length;
      pick = { u: worst.u, k, crowd: true, why: `${k} clubs, one ${worst.gap.toFixed(1)} km from home` };
    } else break;

    const { u, k, crowd } = pick;
    const members = clubsIn.get(u.index) || [];
    const points = members.map(club => homeOf[club].point);
    const scale = Math.cos(((u.bbox[1] + u.bbox[3]) / 2) * RAD);
    // Each club's piece holds its own ground (ownHomes), else the crowd's sites share the land around its town.
    const grounds = crowd && ownHomes ? groundPieces(u, points, sliverKm) : null;
    let sites = grounds ? null : crowd ? crowdSites(points, u) : kmeans(interiorSamples(u), 2, scale);
    let pieces = grounds;
    if (!grounds) {
      try {
        pieces = cutUnit(u, sites);
        if (sliverKm > 0) pieces = absorbSlivers(pieces.map(p => ({ ...p, k: p.site })), sliverKm, { keepLargest: true }).map(({ k, ...p }) => p);
      } catch (error) {
        log(`    split of ${u.name} failed: ${error.message}`);
        failed.add(u.id);
        continue;
      }
    }
    if (pieces.length < 2) { failed.add(u.id); continue; }
    // A club whose own piece starts beyond the gap limit: try the fan, keep it if it is closer.
    const worstGap = list => Math.max(...points.map((p, j) => {
      const own = list.find(piece => piece.site === j);
      return own ? kmToPolys(p, own.polys) : Infinity;
    }));
    let why = pick.why;
    if (crowd && !grounds && maxGapKm < Infinity && worstGap(pieces) > maxGapKm) {
      const fanSites = crowdSites(points, u, { fanKm: maxGapKm / 4 });
      let fanPieces = [];
      try { fanPieces = cutUnit(u, fanSites); } catch { /* keep the k-means cut */ }
      if (fanPieces.length >= 2 && worstGap(fanPieces) < worstGap(pieces)) {
        why += `, fanned (${worstGap(pieces).toFixed(1)} -> ${worstGap(fanPieces).toFixed(1)} km)`;
        sites = fanSites;
        pieces = fanPieces;
      }
    }
    // Pieces are named after the source unit with one compass suffix, taken from the
    // cut's centre (the clubs' homes for a crowd cut), never stacked on an earlier
    // piece's suffix; a repeated direction is numbered.
    const base = u.baseName ?? u.name;
    const c = crowd && points.length ? [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length] : u.centroid;
    const named = pieces.map((piece, i) => {
      const pc = centroidOf(piece.polys);
      const angle = Math.atan2(pc[1] - c[1], (pc[0] - c[0]) * scale);
      const dir = COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
      return { ...piece, dir, i };
    });
    const names = new Set(list.filter(v => v !== u).map(v => v.name));
    const newUnits = named.flatMap(p => {
      let qualifier = p.dir;
      for (let k = 2; names.has(`${base} (${qualifier})`); k++) qualifier = `${p.dir} ${k}`;
      const name = `${base} (${qualifier})`;
      names.add(name);
      // A cell can cut a ragged unit into several parts; the site's part keeps the piece id.
      return explodeUnits([{ id: `${u.id}~${p.i}`, name, baseName: base, qualifier, ...(u.territory != null ? { territory: u.territory } : {}), ...(u.fans ? { fans: u.fans } : {}),
        ...(u.realm != null ? { realm: u.realm } : {}), ...(u.region != null ? { region: u.region } : {}), polys: p.polys }], () => (grounds ? p.anchor : sites[p.site]));
    });
    if (crowd) for (const v of newUnits) crowdCut.add(v.id);
    splits.push({ unit: u.name, source: baseId(u.id), pieces: named.length, clubs: members.length, reason: why });
    log(`    split ${u.name} into ${named.length} (${why})`);
    const box = u.bbox;
    list.splice(list.indexOf(u), 1, ...newUnits);
    // Re-node the neighbourhood so the pieces share arcs with their neighbours.
    const touched = list.filter(v => newUnits.includes(v)
      || !(v.bbox[0] > box[2] + 1e-6 || v.bbox[2] < box[0] - 1e-6 || v.bbox[1] > box[3] + 1e-6 || v.bbox[3] < box[1] - 1e-6));
    nodeRings(touched);
    list = prepareUnits(list);
    // The cut unit's clubs take the piece of their own site (crowd cuts), else the
    // piece holding or nearest to their home. In a crowd cut the piece holding a home
    // goes to the strongest club whose home it holds: clubs on one town point take the
    // centres in bearing order, and a weaker neighbour's site can sit nearer the point.
    const fresh = list.filter(v => newUnits.some(w => w.id === v.id));
    const pieceOf = members.map((_, j) => (crowd && named.find(p => p.site === j)) || null);
    if (crowd && !grounds) {
      const settled = new Set();
      members.map((club, j) => [club, j]).sort((a, b) => a[0] - b[0]).forEach(([club, j]) => {
        // A home snapped from just outside the unit counts as in the nearest piece.
        const home = homeOf[club].point;
        const holder = named.find(p => pointInPolys(home, p.polys))
          ?? (pointInPolys(home, u.polys) ? null : named.reduce((a, p) => (kmToPolys(home, p.polys) < kmToPolys(home, a.polys) ? p : a)));
        const k = holder ? pieceOf.indexOf(holder) : -1;
        if (holder && pieceOf[j] && k !== j && !settled.has(k)) {
          if (k >= 0) pieceOf[k] = pieceOf[j];
          pieceOf[j] = holder;
        }
        settled.add(j);
      });
    }
    members.forEach((club, j) => {
      const own = pieceOf[j];
      const home = homeOf[club].point;
      unitIdOf[club] = own ? `${u.id}~${own.i}`
        : (fresh.find(v => pointInPolys(home, v.polys)) || nearestUnit(fresh, home)).id;
      // A ground where the pieces meet: the club grows from its own piece beside it.
      if (grounds) homeOf[club].point = own.anchor;
    });
    const indexOf = new Map(list.map(v => [v.id, v.index]));
    homeOf.forEach((h, club) => { if (h && h.unit != null) h.unit = indexOf.get(unitIdOf[club]); });
  }
  return { units: list, splits };
}

function nearestUnit(units, p) {
  let best = units[0], bestKm = Infinity;
  for (const u of units) { const km = kmToPolys(p, u.polys); if (km < bestKm) { bestKm = km; best = u; } }
  return best;
}

// ---- Seed and grow ----

function unitDistance(a, b) {
  let best = Infinity;
  for (const p of a.samples) for (const q of b.samples) {
    const d = kmBetween(p, q);
    if (d < best) best = d;
  }
  return best;
}

const boxKm = (a, b) => {
  const lat = (Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2;
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * Math.cos(Math.min(85, Math.abs(lat)) * RAD) * EARTH_KM * RAD;
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]) * EARTH_KM * RAD;
  return Math.hypot(dx, dy) * 0.98; // a lower bound up to the local scale approximation
};

const pickBy = (list, cost) => list.reduce((best, u) => (best < 0 || cost(u) < cost(best) || (cost(u) === cost(best) && u < best) ? u : best), -1);

/**
 * Starting units. `homes[i]` is { unit, point } or null for club i (rank order).
 * Located clubs, strongest first, claim their home units. Clubs whose home unit
 * went to a stronger club then take the free unit nearest their home (the home
 * unit's neighbours first); they go second so they never take another club's home.
 * Unlocated clubs last take the free unit farthest from every seed so far (land
 * units first). Slivers below `minKm2` (cut and exploded parts) never start a
 * section while a larger unit qualifies. Returns { owner: unit -> club or -1,
 * seedUnit, seedPoint }.
 */
export function seedSections(units, adjacency, homes, { minKm2 = 0, allowed = null } = {}) {
  const n = homes.length;
  const big = list => list.filter(v => units[v].area >= minKm2);
  const sized = list => (big(list).length ? big(list) : list);
  const owner = new Array(units.length).fill(-1);
  const seedUnit = new Array(n).fill(-1);
  const seedPoint = new Array(n).fill(null);
  const claim = (club, u, point) => { owner[u] = club; seedUnit[club] = u; seedPoint[club] = point; };
  // A club given its own piece of a shared town (splitUnits) grows from that piece.
  const inside = (h, u) => (pointInPolys(h.point, units[u].polys) ? h.point : units[u].centroid);
  homes.forEach((h, club) => { if (h && owner[h.unit] < 0) claim(club, h.unit, inside(h, h.unit)); });
  homes.forEach((h, club) => {
    if (!h || seedUnit[club] >= 0) return;
    const free = v => owner[v] < 0 && (!allowed || allowed(club, v));
    const near = adjacency[h.unit].filter(free);
    const all = units.map((_, v) => v).filter(free);
    const pool = [big(near), big(all), near, all].find(list => list.length) || [];
    const gap = new Map(pool.map(v => [v, kmToPolys(h.point, units[v].polys)]));
    const u = pickBy(pool, v => gap.get(v));
    if (u < 0) throw new Error('More clubs than units');
    claim(club, u, h.point);
  });
  homes.forEach((h, club) => {
    if (h) return;
    const free = sized(units.map((_, v) => v).filter(v => owner[v] < 0));
    const land = free.filter(v => adjacency[v].length);
    const pool = land.length ? land : free;
    const seeds = seedPoint.filter(Boolean);
    const score = v => (seeds.length ? -Math.min(...seeds.map(p => kmBetween(units[v].centroid, p))) : v);
    const u = pickBy(pool, score);
    if (u < 0) throw new Error('More clubs than units');
    claim(club, u, units[u].centroid);
  });
  return { owner, seedUnit, seedPoint };
}

/**
 * Assign every unit to a club section: seedSections, then growth. Returns
 * { owner: unit -> club, seedUnit: club -> unit }. Format 2 territories may pass
 * `share` (sizes compare as area / share), `cap` (km² past which a club takes land only
 * when no club under its cap can) and `allowed(club, unit)` (land a club may take while
 * any club allowed there can reach it). With `spare`, a club passes over a free unit
 * that is another club's last way out when that unit is nearer the other club's seed
 * (Brooklyn, whose one land neighbour is Queens, against the Knicks in Manhattan).
 */
export function growSections(units, adjacency, homes, { reach = REACH, padKm = grainKm(units), minKm2 = 0, share = null, cap = null, allowed = null, spare = false } = {}) {
  const n = homes.length;
  const { owner, seedUnit, seedPoint } = seedSections(units, adjacency, homes, { minKm2, allowed });
  const fits = (club, u) => !allowed || allowed(club, u);
  const size = club => (share ? area[club] / share[club] : area[club]);
  // Claims rank by tier: allowed and under its cap, allowed, then anything.
  const tier = (club, u) => (!fits(club, u) ? 2 : cap && area[club] >= cap[club] ? 1 : 0);
  const near = (u, p) => kmBetween(units[u].centroid, p);

  // Smallest section first takes its adjacent free unit nearest to its seed, but only
  // within reach: its seed at most `reach` times as far as the nearest seed of any
  // club (both padded by a median unit side). Unbounded, a small section boxed in by
  // bigger ones squeezes through any gap and fans out across empty land in long
  // fingers; with the bound, empty land goes to the clubs nearest to it.
  const pad = padKm;
  const nearest = units.map((_, u) => Math.min(...seedPoint.map(p => near(u, p))));
  const stretch = (club, u) => (near(u, seedPoint[club]) + pad) / (nearest[u] + pad);
  // A club at an estimated home (placeClubs) takes only land nearer to it than to any other
  // start: smallest first, it would otherwise outgrow its neighbours into contested land.
  // `reach` may be per club (format 2: a fanned club's sector is its own, at any distance).
  const reachOf = club => (homes[club]?.placed ? 1 : Array.isArray(reach) ? reach[club] : reach);
  const area = seedUnit.map(u => units[u].area);
  const frontier = seedUnit.map(u => new Set(adjacency[u]));
  let left = owner.filter(o => o < 0).length;
  const take = (club, u) => {
    owner[u] = club;
    area[club] += units[u].area;
    for (const v of adjacency[u]) if (owner[v] < 0) frontier[club].add(v);
    left--;
  };
  const lastWayOut = (club, u) => frontier.some((f, c) => c !== club && f.size === 1 && f.has(u) && near(u, seedPoint[c]) < near(u, seedPoint[club]));
  // Island attachment bookkeeping: nearest assigned unit per free unit, updated incrementally.
  const bestLink = new Map();
  const listed = new Uint8Array(units.length);
  const grid = new Map();
  const GRID = 1;
  const seaStep = Math.max(SEA_STEP_KM, 3 * pad);
  while (left > 0) {
    const order = [];
    for (let c = 0; c < n; c++) {
      for (const v of frontier[c]) if (owner[v] >= 0) frontier[c].delete(v);
      if (frontier[c].size) order.push(c);
    }
    order.sort((a, b) => size(a) - size(b) || a - b);
    let grown = false;
    for (const club of order) {
      const u = pickBy([...frontier[club]].filter(v => stretch(club, v) <= reachOf(club) && tier(club, v) === 0 && !(spare && lastWayOut(club, v))),
        v => near(v, seedPoint[club]));
      if (u < 0) continue;
      frontier[club].delete(u);
      take(club, u);
      grown = true;
      break;
    }
    if (grown) continue;
    if (order.length) {
      // Every bordering section is out of reach (the nearest club is walled off):
      // the least stretched claim wins.
      let best = null;
      for (const club of order) for (const u of frontier[club]) {
        // Past every cap, land goes to the club least over its cap, so the clubs bordering
        // a desert share it rather than the nearest taking it all.
        const g = tier(club, u), k = g === 1 ? area[club] / cap[club] : stretch(club, u);
        if (!best || g < best.g || (g === best.g && (k < best.k || (k === best.k && (area[club] < area[best.club] || (area[club] === area[best.club] && (club < best.club || (club === best.club && u < best.u)))))))) best = { k, g, club, u };
      }
      frontier[best.club].delete(best.u);
      take(best.club, best.u);
      continue;
    }
    // No land path left: the free unit closest to any assigned unit is an island to attach.
    const fresh = [];
    owner.forEach((o, u) => {
      if (o < 0 || listed[u]) return;
      listed[u] = 1;
      fresh.push(u);
      // Assigned units on a grid of GRID degrees, for islandClub's search around an island.
      const [w, s, e, n] = units[u].bbox;
      for (let x = Math.floor(w / GRID); x <= Math.floor(e / GRID); x++) {
        for (let y = Math.floor(s / GRID); y <= Math.floor(n / GRID); y++) {
          if (!grid.has(`${x},${y}`)) grid.set(`${x},${y}`, []);
          grid.get(`${x},${y}`).push(u);
        }
      }
    });
    let pick = null;
    owner.forEach((o, u) => {
      if (o >= 0) return;
      let link = bestLink.get(u) || { km: Infinity, to: -1 };
      const byBox = fresh.map(v => [boxKm(units[u].bbox, units[v].bbox), v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [box, v] of byBox) {
        if (box > link.km) break;
        const km = unitDistance(units[u], units[v]);
        if (km < link.km || (km === link.km && v < link.to)) link = { km, to: v };
      }
      bestLink.set(u, link);
      if (!pick || link.km < pick.km || (link.km === pick.km && u < pick.u)) pick = { u, km: link.km, to: link.to };
    });
    take(islandClub(pick), pick.u);
  }
  return { owner, seedUnit, seedPoint };

  /**
   * The club an island joins: one holding land within a short hop of it (twice the
   * nearest hop, or that plus `seaStep`); one under its cap and at most twice as far as
   * the nearest first. As on land the claim must be within reach, the nearest such land
   * winning; with none in reach the least stretched claim wins.
   * Joining whoever holds the nearest land would chain an archipelago to one club,
   * island by island (Rhodes to Lesbos), whatever its distance from home.
   */
  function islandClub({ u, km: nearestKm, to }) {
    const window = Math.max(2 * nearestKm, nearestKm + seaStep);
    const hop = new Map([[owner[to], nearestKm]]);
    const [w, s, e, n] = units[u].bbox;
    const dy = window / (EARTH_KM * RAD), dx = dy / Math.max(0.05, Math.cos(Math.min(85, Math.max(Math.abs(s), Math.abs(n))) * RAD));
    const near = new Set();
    for (let x = Math.floor((w - dx) / GRID); x <= Math.floor((e + dx) / GRID); x++) {
      for (let y = Math.floor((s - dy) / GRID); y <= Math.floor((n + dy) / GRID); y++) for (const v of grid.get(`${x},${y}`) || []) near.add(v);
    }
    const byBox = [...near].map(v => [boxKm(units[u].bbox, units[v].bbox), v]).filter(([box]) => box <= window)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [box, v] of byBox) {
      const club = owner[v];
      if (box >= (hop.get(club) ?? Infinity)) continue;
      const d = unitDistance(units[u], units[v]);
      if (d <= window && d < (hop.get(club) ?? Infinity)) hop.set(club, d);
    }
    let best = null;
    // Allowed clubs under their cap first (format 2), among those about as near as the
    // nearest: an archipelago off a city whose clubs are all fanned would otherwise go to
    // the one sector facing it, while a sliver touching land stays with that land.
    const fitting = [...hop].filter(([club]) => fits(club, u));
    const under = fitting.filter(([club, d]) => cap && area[club] < cap[club] && d <= 2 * nearestKm);
    for (const [club, d] of (under.length ? under : fitting.length ? fitting : [...hop]).sort((a, b) => a[0] - b[0])) {
      const k = stretch(club, u), ok = k <= reachOf(club);
      const better = !best || (ok !== best.ok ? ok
        : ok ? d < best.d || (d === best.d && club < best.club)
          : k < best.k || (k === best.k && (d < best.d || (d === best.d && club < best.club))));
      if (better) best = { club, d, k, ok };
    }
    return best.club;
  }
}

// ---- Balanced growth ----

// Most rounds of balancing passes; how much farther from the receiving club's start than from the giver's a unit may
// lie (both padded by the grain), and how far from the receiver's start, in radii of a disk of its target land.
const BALANCE_ROUNDS = 3000;
const PASS_REACH = 2;
const PASS_RADIUS = 2.5;
// A unit passes only when this share of its land border already lies against the receiving club.
const PASS_TOUCH = 0.3;
// On the Europe maps, a unit passes only when half its own land border lies against the receiving club: it fills a
// hollow in that club's land, never carries it on along a border (a unit at a time, Atlético's land ran on from Madrid
// down Rayo's side, Villarreal's round Levante's).
const PASS_TOUCH_WHOLE = 0.5;
// The units each pair of neighbouring clubs may try in a round, nearest first.
const PASS_TRIES = 8;
// No club keeps more than this many fair shares of land while a neighbour under it can take the rest (step 9's caps take
// 1.5; past 2 the land given up is mostly a ring around the club, which its neighbours would wrap).
const LAND_CAP = 2;
// Every club on the Europe maps keeps at least this land around its own start (km²; balanceSections, below).
const GROUND_MARGIN = 300;
// A club whose land comes out under this share of its goal after the passes takes its neighbours' land around its start.
const RESCUE_SHARE = 0.5;
// Added to a claim on land the club is not allowed on: such claims wait until no allowed claim is left.
const LATE = 1e15;

/** Binary min-heap of claims (cost, club, unit); ties go to the lower club, then the lower unit. */
function claimHeap() {
  let cost = new Float64Array(1024), club = new Int32Array(1024), unit = new Int32Array(1024), size = 0;
  const less = (i, j) => cost[i] < cost[j] || (cost[i] === cost[j] && (club[i] < club[j] || (club[i] === club[j] && unit[i] < unit[j])));
  const swap = (i, j) => {
    const k = cost[i]; cost[i] = cost[j]; cost[j] = k;
    const c = club[i]; club[i] = club[j]; club[j] = c;
    const u = unit[i]; unit[i] = unit[j]; unit[j] = u;
  };
  return {
    get size() { return size; },
    push(k, c, u) {
      if (size === cost.length) {
        const grow = (a, T) => { const b = new T(2 * a.length); b.set(a); return b; };
        cost = grow(cost, Float64Array); club = grow(club, Int32Array); unit = grow(unit, Int32Array);
      }
      cost[size] = k; club[size] = c; unit[size] = u;
      for (let i = size++; i > 0;) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
    },
    peek() { return [cost[0], club[0], unit[0]]; },
    pop() {
      const top = [cost[0], club[0], unit[0]];
      size--;
      if (size > 0) { cost[0] = cost[size]; club[0] = club[size]; unit[0] = unit[size]; }
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < size && less(l, m)) m = l;
        if (r < size && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
      return top;
    },
  };
}

/**
 * Joins the landmasses no club starts on (units still unowned once the land is shared out) to clubs across the sea,
 * in growSections' order: the free unit nearest any owned unit goes first, and its whole landmass with it. `choose(unit,
 * nearestKm, hop)` names the club, `hop` holding for each club with land within the hop window (the larger of twice
 * the nearest hop and that plus `seaStep`, as islandClub) the km to its nearest land. Each free unit's nearest owned
 * unit is kept and only checked against land joined since, so an archipelago costs about islands × free units.
 */
function joinIslands(units, adjacency, owner, seaStep, choose) {
  const { comp, count } = components(adjacency);
  const members = Array.from({ length: count }, () => []);
  units.forEach((_, u) => members[comp[u]].push(u));
  let free = units.map((_, u) => u).filter(u => owner[u] < 0);
  if (!free.length) return;
  const GRID = 1;
  const grid = new Map();
  const index = u => {
    const [w, s, e, n] = units[u].bbox;
    for (let x = Math.floor(w / GRID); x <= Math.floor(e / GRID); x++) {
      for (let y = Math.floor(s / GRID); y <= Math.floor(n / GRID); y++) {
        if (!grid.has(`${x},${y}`)) grid.set(`${x},${y}`, []);
        grid.get(`${x},${y}`).push(u);
      }
    }
  };
  const linkKm = new Float64Array(units.length).fill(Infinity), linkTo = new Int32Array(units.length).fill(-1);
  let fresh = units.map((_, u) => u).filter(u => owner[u] >= 0);
  while (free.length) {
    for (const v of fresh) index(v);
    let pick = null;
    for (const u of free) {
      const box0 = units[u].bbox;
      // A big batch (the land shared out first) is scanned nearest box first, so the scan stops early.
      const list = fresh.length > 16
        ? fresh.map(v => [boxKm(box0, units[v].bbox), v]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
        : null;
      for (let i = 0; i < (list ? list.length : fresh.length); i++) {
        const v = list ? list[i][1] : fresh[i];
        const box = list ? list[i][0] : boxKm(box0, units[v].bbox);
        if (box > linkKm[u]) { if (list) break; continue; }
        const km = unitDistance(units[u], units[v]);
        if (km < linkKm[u] || (km === linkKm[u] && v < linkTo[u])) { linkKm[u] = km; linkTo[u] = v; }
      }
      if (!pick || linkKm[u] < pick.km || (linkKm[u] === pick.km && u < pick.u)) pick = { u, km: linkKm[u] };
    }
    const window = Math.max(2 * pick.km, pick.km + seaStep);
    const [w, s, e, n] = units[pick.u].bbox;
    const dy = window / (EARTH_KM * RAD), dx = dy / Math.max(0.05, Math.cos(Math.min(85, Math.max(Math.abs(s), Math.abs(n))) * RAD));
    const seen = new Set();
    for (let x = Math.floor((w - dx) / GRID); x <= Math.floor((e + dx) / GRID); x++) {
      for (let y = Math.floor((s - dy) / GRID); y <= Math.floor((n + dy) / GRID); y++) for (const v of grid.get(`${x},${y}`) || []) seen.add(v);
    }
    const hop = new Map();
    const byBox = [...seen].map(v => [boxKm(units[pick.u].bbox, units[v].bbox), v]).filter(([box]) => box <= window).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [box, v] of byBox) {
      const club = owner[v];
      if (box >= (hop.get(club) ?? Infinity)) continue;
      const d = unitDistance(units[pick.u], units[v]);
      if (d <= window && d < (hop.get(club) ?? Infinity)) hop.set(club, d);
    }
    const club = choose(pick.u, pick.km, hop);
    const joined = members[comp[pick.u]];
    for (const u of joined) owner[u] = club;
    fresh = joined;
    free = free.filter(u => owner[u] < 0);
  }
}

/** Km of border shared by each pair of neighbouring units of a topology, per unit: Array(unit) of Map(neighbour, km). */
function borderKm(topo) {
  const geoms = topo.objects.units.geometries;
  const users = new Map();
  geoms.forEach((g, i) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const poly of polys) for (const ring of poly) for (const a of ring) {
      const k = a < 0 ? ~a : a;
      if (!users.has(k)) users.set(k, new Set());
      users.get(k).add(i);
    }
  });
  const out = geoms.map(() => new Map());
  for (const [k, set] of users) {
    if (set.size !== 2) continue;
    const [u, v] = [...set];
    const arc = topo.arcs[k];
    let km = 0;
    for (let i = 1; i < arc.length; i++) km += kmBetween(arc[i - 1], arc[i]);
    out[u].set(v, (out[u].get(v) || 0) + km);
    out[v].set(u, (out[v].get(u) || 0) + km);
  }
  return out;
}

// How much water joins a region's two shores while the Europe maps' levels are made to nest (build-europe-maps): the
// Bosphorus is 0.7 to 3.3 km wide.
export const CITY_LINK_KM = 3.5;

/**
 * The straits within each fan's city: units of its zone on two landmasses (`comp`) facing each other across at most
 * CITY_LINK_KM of water with no land between (every unit around the zone looked at). Returns { links: Map(unit ->
 * [unit]), group: comp -> the least comp it is joined to by straits }.
 */
function cityStraits(units, fans, comp) {
  const links = new Map();
  const root = new Map();
  const find = m => (root.get(m) ?? m) === m ? m : find(root.get(m));
  for (const fan of fans) {
    const Z = fan.zoneCentre ?? fan.centre;
    const near = units.filter(u => kmToPolys(Z, u.polys) <= fan.zoneKm + 2 * CITY_LINK_KM).map(u => u.index);
    const inZone = new Set(near.filter(i => kmToPolys(Z, units[i].polys) <= fan.zoneKm));
    facingSections(near.map(i => units[i].polys), CITY_LINK_KM).forEach((list, a) => list.forEach(b => {
      const i = near[a], j = near[b];
      if (i === j || comp[i] === comp[j] || !inZone.has(i) || !inZone.has(j)) return;
      if (!links.has(i)) links.set(i, []);
      if (!links.get(i).includes(j)) links.get(i).push(j);
      const [x, y] = [find(comp[i]), find(comp[j])].sort((p, q) => p - q);
      if (x !== y) root.set(y, x);
    }));
  }
  const group = new Map();
  for (const m of new Set(comp)) group.set(m, find(m));
  return { links, group: Object.fromEntries(group) };
}

// Turns of a fan's sectors tried around its city (shareFan), and how uneven its clubs' land may come out (Σ log² of land to
// target; 0.5 is one club at half its target) before two neighbours are tried in each other's places.
const FAN_TURNS = 36;
const SWAP_UNEVEN = 0.5;
// Each turn's outcome is scored by how uneven its clubs' land comes out plus FOREIGN_COST times the share of the fan's
// land they took outside their own sectors: a club that fills a small sector and goes on into its neighbour's grows
// round it (Atlético's sector held 19,632 km² and Real Madrid's 42,199; Atlético went on along the north of Real
// Madrid's, Getafe up its west, and Real Madrid kept the middle, wrapped by both). Sizes alone are evened out by
// that very growth, so every turn looked about as good.
const FOREIGN_COST = 1;

/**
 * A city's fanned clubs (`fan`: { members, centre }, `homes` their grounds) share out the land nearest any of them (the
 * units `owner` gives them): in sectors around the city of equal land, each the club's own (its ground's unit too),
 * which the clubs grow over from their starts (growFanFair). The sectors keep the clubs' order around the city by their
 * grounds, every edge between the two grounds it parts; of FAN_TURNS turns of them, and while the land comes out
 * uneven (over SWAP_UNEVEN) of the orders with two neighbours swapped too (a club's way out of the city can lie beyond
 * its neighbour's ground: Arsenal's, from Islington, by Camden and Barnet past Spurs'), the outcome kept is the most
 * even with the least land taken outside the clubs' own sectors (FOREIGN_COST), ties going to the grounds nearest their
 * own sectors. Shared out by the zone's land alone, the sectors facing the sea
 * kept only their city (AEK and Panathinaikos 900 km² each, Olympiacos 64,000); taken straight, a sector's land beyond
 * a river or a bay was cut off from it (Lisbon's south bank). `fits(club, unit)`: land the club may take.
 */
// A unit of a city's land is handed over when at least this share of its border with the city's clubs is with another
// of them (smoothFan), and how much less even the clubs' shares (the sum of log² of land to target) it may make.
const SMOOTH_TOUCH = 0.65, SMOOTH_SLACK = 0.05;
const SMOOTH_SWEEPS = 8;

/**
 * Smooths a city's clubs' borders (`best`: { who, held }, see growFanFair), as each grows over the land nearest its own
 * ground in its own sector and the sectors' edges are the units', so a neighbour's arm can reach between two others'. A
 * unit mostly surrounded by another club's (by SMOOTH_TOUCH of its land border with the city's clubs, `borders` of each
 * unit with each neighbour, km) goes to it, the most surrounded first, as long as the clubs' shares stay about as even
 * (SMOOTH_SLACK) and its own club's land holds together; starts and landings (`kept`) stay. Changes `best`.
 */
function smoothFan(best, units, region, adjacency, borders, seeds, kept, target, fits) {
  const { who, held } = best;
  const isSeed = new Set(seeds);
  const inRegion = new Set(region);
  const uneven = (i, km2) => Math.log(Math.max(km2, 1) / target[i]) ** 2;
  const holds = (i, without) => {
    const seen = new Set([seeds[i]]), stack = [seeds[i]];
    while (stack.length) for (const v of adjacency[stack.pop()]) if (v !== without && who[v] === i && !seen.has(v)) { seen.add(v); stack.push(v); }
    return region.every(u => who[u] !== i || u === without || seen.has(u));
  };
  for (let sweep = 0; sweep < SMOOTH_SWEEPS; sweep++) {
    const list = [];
    for (const u of region) {
      const a = who[u];
      if (a < 0 || isSeed.has(u) || kept.has(u)) continue;
      const share = new Map();
      let total = 0;
      for (const [v, km] of borders[u]) if (inRegion.has(v) && who[v] >= 0) { total += km; if (who[v] !== a) share.set(who[v], (share.get(who[v]) ?? 0) + km); }
      for (const [b, km] of share) if (total && km / total >= SMOOTH_TOUCH) list.push({ u, a, b, touch: km / total });
    }
    list.sort((p, q) => q.touch - p.touch || p.u - q.u);
    let moved = 0;
    for (const { u, a, b } of list) {
      if (who[u] !== a || !fits(b, u)) continue;
      const area = units[u].area;
      const change = uneven(a, held[a] - area) + uneven(b, held[b] + area) - uneven(a, held[a]) - uneven(b, held[b]);
      if (change > SMOOTH_SLACK) continue;
      if (!adjacency[u].some(v => who[v] === b)) continue;
      if (!holds(a, u)) continue;
      who[u] = b;
      held[a] -= area;
      held[b] += area;
      moved++;
    }
    if (!moved) break;
  }
}

function shareFan(units, adjacency, owner, fan, homes, seedUnit, share, fits, comp, straits = null, borders = null) {
  const { members } = fan;
  // Sectors round the middle of the clubs' grounds (fanSectors' zoneCentre): its meeting point, where the grounds' sectors
  // meet, can stand at the city's edge (north-west London: all seven clubs lie to its south and east).
  const C = fan.zoneCentre ?? fan.centre;
  const k = members.length;
  const index = new Map(members.map((c, i) => [c, i]));
  const region = [];
  owner.forEach((c, u) => { if (index.has(c)) region.push(u); });
  if (k < 2 || !region.length) return;
  const kx = Math.cos(C[1] * RAD);
  const bearing = p => (Math.atan2(p[1] - C[1], (p[0] - C[0]) * kx) + 2 * Math.PI) % (2 * Math.PI);
  const at = c => (homes[c] && kmBetween(homes[c].point, C) >= 0.05 ? bearing(homes[c].point) : null);
  const total = region.reduce((sum, u) => sum + units[u].area, 0);
  // Each club's target: its share of the fan's land on its own landmass (Istanbul's European clubs share Thrace,
  // whatever Fenerbahçe holds across the Bosphorus).
  const weight = members.map(c => (share ? share[c] : 1));
  // (Landmasses a strait joins count as one.)
  const shore = u => straits?.group[comp[u]] ?? comp[u];
  const landOn = new Map(), weightOn = new Map();
  for (const u of region) landOn.set(shore(u), (landOn.get(shore(u)) || 0) + units[u].area);
  members.forEach((c, i) => { const m = shore(seedUnit[c]); weightOn.set(m, (weightOn.get(m) || 0) + weight[i]); });
  const target = members.map((c, i) => Math.max(1, (landOn.get(shore(seedUnit[c])) || 0) * weight[i] / weightOn.get(shore(seedUnit[c]))));
  const unitBearing = new Float64Array(units.length);
  for (const u of region) unitBearing[u] = bearing(units[u].centroid);
  const land = region.map(u => [unitBearing[u], units[u].area]);
  const homeUnit = new Map(members.map(c => [homes[c]?.unit, c]).filter(([u]) => u != null));
  const circ = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const prefer = new Int32Array(units.length).fill(-1);
  const seeds = members.map(c => seedUnit[c]);
  // A trial of the clubs' growth over their land with `prefer` as it stands: how even it comes out, and the land taken
  // outside the clubs' own sectors.
  const trial = miss => {
    const grown = growFanFair(units, u => adjacency[u], region, prefer, seeds, target, (i, v) => fits(members[i], v), straits && { links: straits.links, comp });
    let foreign = 0;
    for (const u of region) if (grown.who[u] >= 0 && grown.who[u] !== prefer[u]) foreign += units[u].area;
    return { ...grown, miss, score: grown.uneven + FOREIGN_COST * foreign / total };
  };
  const tryOne = (start, swap) => {
    const turn = b => (b - start + 4 * Math.PI) % (2 * Math.PI);
    const order = [...members].sort((a, b) => (at(a) == null ? Infinity : turn(at(a))) - (at(b) == null ? Infinity : turn(at(b))) || a - b);
    if (swap >= 0) [order[swap], order[swap + 1]] = [order[swap + 1], order[swap]];
    const edges = equalEdges(land.map(([b, w]) => [turn(b), w]).sort((a, b) => a[0] - b[0]), total, k);
    if (swap < 0) for (let i = 1; i < k; i++) {
      const a = at(order[i - 1]), b = at(order[i]);
      if (a == null || b == null) continue;
      const lo = turn(a), hi = turn(b), room = Math.min(RAD, (hi - lo) / 2);
      edges[i] = Math.min(Math.max(edges[i], lo + room, edges[i - 1]), hi - room);
    }
    let miss = 0;
    order.forEach((c, i) => {
      const b = at(c);
      if (b == null) return;
      const t = turn(b);
      if (t < edges[i] || t >= edges[i + 1]) miss += Math.min(circ(edges[i] - t), circ(t - edges[i + 1]));
    });
    for (const u of region) {
      if (homeUnit.has(u)) { prefer[u] = index.get(homeUnit.get(u)); continue; }
      const t = turn(unitBearing[u]);
      let i = 0;
      while (i + 1 < k && t >= edges[i + 1]) i++;
      prefer[u] = index.get(order[i]);
    }
    return trial(miss);
  };
  const first = gapStart(region.filter(u => kmToPolys(fan.zoneCentre ?? C, units[u].polys) <= fan.zoneKm).map(u => units[u]), C, fan.zoneKm, members, at, p => bearing(p)).start;
  // First the sectors the fan was laid out with (fanSectors: each holding its ground, of about equal land round the fan's
  // meeting point), carried on past the zone; then turns of sectors of equal land round the clubs' middle.
  let best = null;
  if (fan.sectorOf) {
    for (const u of region) prefer[u] = homeUnit.has(u) ? index.get(homeUnit.get(u)) : index.get(fan.sectorOf(units[u].centroid));
    best = trial(0);
  }
  for (let swap = -1; swap + 1 < k && (swap < 0 || best.uneven > SWAP_UNEVEN); swap++) {
    for (let t = 0; t < FAN_TURNS; t++) {
      const next = tryOne((first + t * 2 * Math.PI / FAN_TURNS) % (2 * Math.PI), swap);
      if (!best || next.score < best.score - 1e-6 || (Math.abs(next.score - best.score) <= 1e-6 && next.miss < best.miss - 1e-9)) best = next;
    }
  }
  if (borders) smoothFan(best, units, region, adjacency, borders, seeds, new Set((best.who.entries ?? []).flat()), target, (i, v) => fits(members[i], v));
  for (const u of region) if (best.who[u] >= 0) owner[u] = members[best.who[u]];
  return members.map((c, i) => [c, best.who.entries?.[i] ?? []]);
}

/**
 * Balanced territories, an alternative to growSections (partitionCountry's `balance`).
 *
 * First every unit goes to the club whose start is nearest its centre (measured from a point of the unit the club
 * starts on: its home, or when a stronger club holds the home's unit, a point inside its own; a team of `weight` clubs
 * sharing a ground, partitionCountry, reaches √weight times as far, for weight times the land), each club keeping only
 * the land that hangs together with its start; cut-off pieces are flooded, nearest claim first, from the land around
 * them. That is each club's natural land V: compact, with no fingers. (Smallest-first growth instead hands the
 * smallest territory its nearest free unit whatever its distance, so the clubs around empty land race into it in
 * parallel fingers, and a club boxed in by bigger ones squeezes through gaps; its reach bound keeps empty land near
 * the nearest clubs, so sizes follow how crowded the clubs are.) A city's fanned clubs (`fans`, from fanSectors) split
 * the land nearest them: on the country maps by `fanned`, each fanned club's direction from its city, the land beyond
 * the city's zone going to the club whose sector points its way; with `wholeUnits` (the Europe maps) by shareFan, the
 * clubs crossing the city's straits (cityStraits) onto land where they hold none, the unit each lands on then counting
 * as a start of its land there (`entries`).
 *
 * Each club's target blends its natural land with its fair share F (the country's land per section times its group
 * size, `share`): T = F^(1-β) · V^β, so β = 0 asks equal land and β = 1 the natural split; targets are scaled to the
 * land of each landmass. Then units pass, one at a time across a border, from a club holding more land for its target
 * than its neighbour to that neighbour, while that brings land nearer the targets (Σ A²/T falls, so it ends). Each pass
 * takes the border unit whose square distance from the receiver's start least exceeds its square distance from the
 * giver's (as a power diagram's border moves), and only one
 *   - lying against the receiver along at least PASS_TOUCH of its land border, so land fills a club's hollows and moves
 *     along a broad front, never out from a tip (one unit at a time, a club would grow a snake along any long border),
 *   - within PASS_RADIUS radii of a disk of its target land from the receiver's start,
 *   - at most PASS_REACH times as far from the receiver's start as from the giver's (both padded by the grain),
 *   - that is not a start, does not cut the giver's land in two, and lies on land the receiver is `allowed` on.
 * Rounds pass one unit per pair of neighbours, the most unequal pairs first, until a round passes none. With
 * `wholeUnits`, a unit passes only along PASS_TOUCH_WHOLE of its own border, a city's fanned clubs pass none to each
 * other, a pair tries its PASS_TRIES nearest units in turn (with one, a unit that would cut the giver's land in
 * two stopped the pair for good: Benfica's Lisbon behind Santa Clara), no club passes land on its start's landmass
 * below its want (half its goal, or of its `room`), and a club still under its want then takes its neighbours' land
 * nearest its start (the rescue). Landmasses
 * without a start join a club across the sea in growSections' order (joinIslands): among the clubs with land within
 * the hop window, those about as near as the nearest and allowed there first, the one whose start is nearest. Returns
 * { owner, seedUnit, seedPoint, natural, target, moves, spread: [before, after] } (spread: of log land/target).
 */
export function balanceSections(units, adjacency, homes, { beta = 0.5, padKm = grainKm(units), minKm2 = 0, share = null, allowed = null, topo = null, fans = null, fanned = null, room = null, weight = null, wholeUnits = false } = {}) {
  const shared = borderKm(topo ?? unitTopology(units).topo);
  const landBorder = shared.map(m => [...m.values()].reduce((a, b) => a + b, 0));
  const n = homes.length;
  const U = units.length;
  const { seedUnit, seedPoint } = seedSections(units, adjacency, homes, { minKm2, allowed });
  const fits = (club, u) => !allowed || allowed(club, u);
  const anchor = seedPoint.map((p, c) => (pointInPolys(p, units[seedUnit[c]].polys) ? p : interiorPoint(units[seedUnit[c]].polys)));
  const { comp } = components(adjacency);
  const reach2 = Array.from({ length: n }, (_, c) => Float64Array.from(units, u => kmBetween(anchor[c], u.centroid) ** 2));
  const startsOn = new Map();
  seedUnit.forEach((u, c) => { if (!startsOn.has(comp[u])) startsOn.set(comp[u], []); startsOn.get(comp[u]).push(c); });
  // A team of clubs claims as far as `weight` (its clubs) clubs do on the country maps; on the Europe maps by distance alone,
  // since the weights' boundary round a weaker club's start is a circle about it, so its stronger neighbour's land would wrap
  // it (Inter and Milan's round Atalanta's); their targets count their clubs' shares, and the passes even the land out.
  const claimOf = (c, u) => reach2[c][u] / (wholeUnits ? 1 : weight?.[c] ?? 1) + (fits(c, u) ? 0 : LATE);

  // Natural land: nearest start, pieces cut off from their start flooded from the land around them.
  const owner = new Array(U).fill(-1);
  for (let u = 0; u < U; u++) {
    const list = startsOn.get(comp[u]);
    if (!list) continue;
    let best = -1, bestK = Infinity;
    for (const c of list) { const k = claimOf(c, u); if (k < bestK) { bestK = k; best = c; } }
    // On the country maps, land nearest a fanned club beyond its city's zone goes to the club of the fan whose sector
    // points its way, so each sector carries on outward (`fanned`: each fanned club's direction from its city).
    const fz = fanned?.[best];
    if (fz && units[u].fans?.[fz.fan] == null) {
      const [cx, cy] = fz.centre;
      const bearing = Math.atan2(units[u].centroid[1] - cy, (units[u].centroid[0] - cx) * Math.cos(cy * RAD));
      let turn = Infinity;
      fanned.forEach((g, c) => {
        if (!g || g.fan !== fz.fan || !fits(c, u)) return;
        const t = Math.abs(((bearing - g.dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (t < turn) { turn = t; best = c; }
      });
    }
    owner[u] = best;
  }
  seedUnit.forEach((u, c) => { owner[u] = c; });
  // Each city's fanned clubs share out the land nearest any of them, each keeping to its sector while it can, and
  // crossing the city's straits (Istanbul's Bosphorus) onto land where it holds none: the unit it lands on keeps the
  // land it reaches from there its own (`entries`).
  const entries = new Map();
  if (fans?.length && wholeUnits) {
    const straits = cityStraits(units, fans, comp);
    for (const fan of fans) for (const [c, list] of shareFan(units, adjacency, owner, fan, homes, seedUnit, share, fits, comp, straits.links.size ? straits : null, shared) ?? []) {
      if (list.length) entries.set(c, list);
    }
  }
  const startsOf = c => [seedUnit[c], ...(entries.get(c) ?? []).filter(u => owner[u] === c)];
  const kept = new Uint8Array(U);
  seedUnit.forEach((_, c) => {
    const stack = startsOf(c).filter(u => !kept[u]);
    for (const u of stack) kept[u] = 1;
    while (stack.length) for (const v of adjacency[stack.pop()]) if (!kept[v] && owner[v] === c) { kept[v] = 1; stack.push(v); }
  });
  for (let u = 0; u < U; u++) if (owner[u] >= 0 && !kept[u]) owner[u] = -1;
  const heap = claimHeap();
  for (let u = 0; u < U; u++) if (owner[u] >= 0) for (const v of adjacency[u]) if (owner[v] < 0 && startsOn.has(comp[v])) heap.push(claimOf(owner[u], v), owner[u], v);
  while (heap.size) {
    const [, c, u] = heap.pop();
    if (owner[u] >= 0) continue;
    owner[u] = c;
    for (const v of adjacency[u]) if (owner[v] < 0) heap.push(claimOf(c, v), c, v);
  }
  // Landmasses without a start: clubs with land about as near as the nearest, and allowed there, first; the club
  // whose start is nearest wins.
  joinIslands(units, adjacency, owner, Math.max(SEA_STEP_KM, 3 * padKm), (u, nearestKm, hop) => {
    const all = [...hop].sort((p, q) => p[0] - q[0]);
    const close = all.filter(([, km]) => km <= 2 * nearestKm);
    const pool = [close.filter(([c]) => fits(c, u)), close, all.filter(([c]) => fits(c, u)), all].find(list => list.length);
    let best = null;
    for (const [c, km] of pool) {
      const k = reach2[c][u];
      if (!best || k < best.k || (k === best.k && (km < best.km || (km === best.km && c < best.c)))) best = { c, k, km };
    }
    return best.c;
  });

  const sections = share ? share.reduce((a, b) => a + b, 0) : n;
  const total = units.reduce((sum, u) => sum + u.area, 0);
  const land = new Array(n).fill(0);
  owner.forEach((c, u) => { land[c] += units[u].area; });
  // A club past LAND_CAP fair shares gives up its farthest land (never its start, never cutting its land in two) to the
  // clubs around it, nearest claim first, those under the cap before any past it: an empty quarter beside a club is
  // shared by every club bordering it rather than all going to the nearest.
  const capOf = c => LAND_CAP * (total / sections) * (share ? share[c] : 1);
  const isStart = new Uint8Array(U);
  seedUnit.forEach(u => { isStart[u] = 1; });
  const freed = [];
  for (let c = 0; c < n; c++) {
    if (land[c] <= capOf(c)) continue;
    const mine = [];
    owner.forEach((o, u) => { if (o === c && !isStart[u]) mine.push(u); });
    mine.sort((a, b) => reach2[c][b] - reach2[c][a] || a - b);
    for (const u of mine) {
      if (land[c] - units[u].area < capOf(c)) continue;
      // Its other neighbours in c must still reach one another without it.
      const near = adjacency[u].filter(v => owner[v] === c);
      if (near.length > 1) {
        const seen = new Set([near[0]]);
        const stack = [near[0]];
        while (stack.length) for (const v of adjacency[stack.pop()]) if (v !== u && owner[v] === c && !seen.has(v)) { seen.add(v); stack.push(v); }
        if (!near.every(v => seen.has(v))) continue;
      }
      owner[u] = -1;
      land[c] -= units[u].area;
      freed.push([u, c]);
    }
  }
  if (freed.length) {
    const claim = (c, v) => reach2[c][v] + (fits(c, v) ? 0 : LATE) + (land[c] >= capOf(c) ? LATE : 0);
    const flood = claimHeap();
    for (const [u] of freed) for (const v of adjacency[u]) if (owner[v] >= 0) flood.push(claim(owner[v], u), owner[v], u);
    while (flood.size) {
      const [, c, u] = flood.pop();
      if (owner[u] >= 0) continue;
      owner[u] = c;
      land[c] += units[u].area;
      for (const v of adjacency[u]) if (owner[v] < 0) flood.push(claim(c, v), c, v);
    }
    // Land no other club reaches (an island the club was given across the sea) stays its own.
    for (const [u, c] of freed) if (owner[u] < 0) { owner[u] = c; land[c] += units[u].area; }
  }
  const natural = land.slice();
  const target = natural.map((v, c) => ((total / sections) * (share ? share[c] : 1)) ** (1 - beta) * v ** beta);
  // Targets scaled to the land the clubs of each landmass hold between them.
  const landmass = seedUnit.map(u => comp[u]);
  const want = new Map(), have = new Map();
  landmass.forEach((m, c) => { want.set(m, (want.get(m) || 0) + target[c]); have.set(m, (have.get(m) || 0) + land[c]); });
  const goal = target.map((t, c) => t * have.get(landmass[c]) / want.get(landmass[c]));
  const spreadOf = list => {
    const logs = list.map((a, c) => Math.log(a / goal[c]));
    const mean = logs.reduce((x, y) => x + y, 0) / n;
    return Math.sqrt(logs.reduce((sum, l) => sum + (l - mean) ** 2, 0) / n);
  };
  const before = spreadOf(land);
  const isSeed = new Uint8Array(U);
  seedUnit.forEach(u => { isSeed[u] = 1; });
  const pad2 = padKm;
  const radius = goal.map(t => PASS_RADIUS * Math.sqrt(t / Math.PI));
  // Whether c's land still hangs together without u: u's neighbours in c all reach one another.
  const mark = new Int32Array(U);
  let stamp = 0;
  const holdsWithout = (c, u) => {
    const mine = adjacency[u].filter(v => owner[v] === c);
    if (mine.length <= 1) return true;
    stamp++;
    const stack = [mine[0]];
    mark[mine[0]] = stamp;
    let found = 1;
    while (stack.length && found < mine.length) {
      for (const v of adjacency[stack.pop()]) {
        if (v === u || owner[v] !== c || mark[v] === stamp) continue;
        mark[v] = stamp;
        if (mine.includes(v)) found++;
        stack.push(v);
      }
    }
    return found === mine.length;
  };
  // Σ A²/T falls when area a passes from A to B.
  const gains = (A, B, a) => (a * a - 2 * land[A] * a) / goal[A] + (a * a + 2 * land[B] * a) / goal[B] < -1e-9;
  // A club's want: half its goal, or of the room it needs (`room`), since a club's goal follows its natural land and a
  // shut-in club's is small too. No club passes land on its start's landmass below its want (counting its islands,
  // Ilioupoli gave up its Athens for Kea).
  const wantOf = c => RESCUE_SHARE * Math.max(goal[c], room?.[c] ?? 0);
  const ashore = new Array(n).fill(0);
  owner.forEach((o, u) => { if (o >= 0 && comp[u] === comp[seedUnit[o]]) ashore[o] += units[u].area; });
  const keeps = (A, u, area = units[u].area) => comp[u] !== comp[seedUnit[A]] || ashore[A] - area >= wantOf(A);
  const move = (u, A, B) => {
    owner[u] = B;
    land[A] -= units[u].area;
    land[B] += units[u].area;
    if (comp[u] === comp[seedUnit[A]]) ashore[A] -= units[u].area;
    if (comp[u] === comp[seedUnit[B]]) ashore[B] += units[u].area;
  };
  // The Europe maps' pairs try PASS_TRIES units each round (the country maps one, as built before them).
  const tries = wholeUnits ? PASS_TRIES : 1;
  // On the Europe maps the clubs of one city pass no land to each other: shareFan has shared it out, and between starts
  // a few kilometres apart the border a pass moves (as a power diagram's) runs through the city, so the land passed is
  // the land beside it (Rayo's by Madrid went to Atlético, whose land then ran south down Rayo's side).
  const fanOf = new Int32Array(n).fill(-1);
  if (wholeUnits) (fans ?? []).forEach((fan, f) => { for (const c of fan.members) fanOf[c] = f; });
  let moves = 0;
  for (let round = 0; round < BALANCE_ROUNDS; round++) {
    // Each club's border with the others this round: a unit passes to a club it lies against along PASS_TOUCH of the
    // shorter of its own land border and that club's, so a small club takes a neighbouring unit along a broad front of
    // its own border, and no club grows out from a tip (on the Europe maps, PASS_TOUCH_WHOLE of the unit's own).
    const clubBorder = new Array(n).fill(0);
    if (!wholeUnits) for (let u = 0; u < U; u++) for (const [v, km] of shared[u]) if (owner[v] !== owner[u] && owner[u] >= 0) clubBorder[owner[u]] += km;
    // The best unit for each pair of neighbouring clubs, giver first.
    const best = new Map();
    for (let u = 0; u < U; u++) {
      const A = owner[u];
      if (A < 0 || isSeed[u]) continue;
      for (const v of adjacency[u]) {
        const B = owner[v];
        if (B < 0 || B === A || landmass[B] !== landmass[A] || !fits(B, u)) continue;
        if (fanOf[A] >= 0 && fanOf[A] === fanOf[B]) continue;
        if (land[A] / goal[A] <= land[B] / goal[B]) continue;
        const dB = Math.sqrt(reach2[B][u]);
        if (dB > radius[B]) continue;
        let touch = 0;
        for (const [w, km] of shared[u]) if (owner[w] === B) touch += km;
        const front = wholeUnits ? PASS_TOUCH_WHOLE * landBorder[u] : PASS_TOUCH * Math.min(landBorder[u], clubBorder[B]);
        if (front > 0 && touch < front) continue;
        if ((dB + pad2) / (Math.sqrt(reach2[A][u]) + pad2) > PASS_REACH) continue;
        const gap = reach2[B][u] - reach2[A][u];
        const key = A * n + B;
        if (!best.has(key)) best.set(key, { A, B, list: [] });
        const list = best.get(key).list;
        if (list.some(item => item.u === u)) continue;
        const at = list.findIndex(item => gap < item.gap || (gap === item.gap && u < item.u));
        if (at < 0) { if (list.length < tries) list.push({ u, gap }); } else { list.splice(at, 0, { u, gap }); if (list.length > tries) list.pop(); }
      }
    }
    const order = [...best.values()].sort((p, q) => (land[q.A] / goal[q.A] - land[q.B] / goal[q.B]) - (land[p.A] / goal[p.A] - land[p.B] / goal[p.B]) || p.A - q.A || p.B - q.B);
    let passed = 0;
    for (const { A, B, list } of order) {
      // The pair's nearest unit first; one it cannot pass (the giver's land would come apart, or the sizes would grow
      // apart) gives way to the next, so a pair is never stuck on it (Benfica's Lisbon behind Santa Clara).
      const pick = list.find(({ u }) => owner[u] === A && adjacency[u].some(v => owner[v] === B) && gains(A, B, units[u].area) && (!wholeUnits || keeps(A, u)) && holdsWithout(A, u));
      if (!pick) continue;
      move(pick.u, A, B);
      passed++;
    }
    moves += passed;
    if (!passed) break;
  }
  // A club still shut in, under RESCUE_SHARE of its goal, takes the land of its neighbours nearest its start, one unit
  // at a time, from any neighbour holding more for its goal (a city's clubs on the land around their grounds: Galatasaray
  // behind Beşiktaş's Thrace, Panathinaikos between AEK and Olympiacos). Nearest its start first, its land grows as a
  // disk, never out along a border. A start is never taken; a unit whose loss would cut the giver's land in two goes with
  // the part cut off from the giver's start, when that part is no more than the club still lacks (Beşiktaş's land ran
  // round Galatasaray's Sarıyer through Eyüpsultan).
  // The giver's land that hangs from u alone: reached from u's neighbours in A, not from A's start without u (A's land
  // across the sea is no part of it).
  const cutOff = (A, u) => {
    stamp++;
    const stack = startsOf(A).filter(v => v !== u);
    for (const v of stack) mark[v] = stamp;
    while (stack.length) for (const v of adjacency[stack.pop()]) if (v !== u && owner[v] === A && mark[v] !== stamp) { mark[v] = stamp; stack.push(v); }
    const part = [];
    const queue = adjacency[u].filter(v => owner[v] === A && mark[v] !== stamp);
    for (const v of queue) mark[v] = stamp;
    while (queue.length) {
      const v = queue.pop();
      part.push(v);
      for (const w of adjacency[v]) if (w !== u && owner[w] === A && mark[w] !== stamp) { mark[w] = stamp; queue.push(w); }
    }
    return part;
  };
  let rescued = 0;
  for (let c = 0; c < n; c++) {
    const want = wholeUnits ? wantOf(c) : 0;
    if (land[c] >= want) continue;
    const heap = claimHeap();
    const offer = u => { for (const v of adjacency[u]) if (owner[v] >= 0 && owner[v] !== c && !isSeed[v] && fits(c, v) && landmass[owner[v]] === landmass[c]) heap.push(reach2[c][v], c, v); };
    owner.forEach((o, u) => { if (o === c) offer(u); });
    while (heap.size && land[c] < want) {
      const [, , u] = heap.pop();
      const A = owner[u];
      if (A === c || A < 0 || land[A] / goal[A] <= land[c] / goal[c]) continue;
      const part = holdsWithout(A, u) ? [] : cutOff(A, u);
      const taken = [u, ...part];
      const area = taken.reduce((sum, v) => sum + units[v].area, 0);
      // The giver keeps at least as much of its own landmass for its goal as the club has after (the clubs of a crowded
      // city never take more than evens from each other).
      if ((ashore[A] - area) / goal[A] < (land[c] + area) / goal[c] || (part.length && (area > want - land[c] || part.some(v => isSeed[v] || !fits(c, v))))) continue;
      if (!part.length && land[c] + area > 2 * want) continue;
      for (const v of taken) { move(v, A, c); rescued++; }
      for (const v of taken) offer(v);
    }
  }
  moves += rescued;
  // On the Europe maps every club holds land around its own start: at least GROUND_MARGIN km² of its own shore, in one piece
  // with it, its neighbours giving it theirs, nearest its start first (who keep as much around theirs; no start changes
  // hands). The rescue counts a club's land on both shores of a strait, so Beşiktaş could keep only its district around its
  // ground on the Bosphorus and the rest of its land in Anatolia, and the outline's coast swallowed the strip.
  if (wholeUnits) {
    const pieceOf = c => {
      const seen = new Set([seedUnit[c]]), stack = [seedUnit[c]];
      while (stack.length) for (const v of adjacency[stack.pop()]) if (owner[v] === c && comp[v] === comp[seedUnit[c]] && !seen.has(v)) { seen.add(v); stack.push(v); }
      return { seen, km2: [...seen].reduce((sum, v) => sum + units[v].area, 0) };
    };
    for (let c = 0; c < n; c++) {
      for (let piece = pieceOf(c); piece.km2 < GROUND_MARGIN; ) {
        let pick = null;
        for (const u of piece.seen) for (const v of adjacency[u]) {
          const A = owner[v];
          if (A < 0 || A === c || isSeed[v] || comp[v] !== comp[seedUnit[c]] || !fits(c, v) || !holdsWithout(A, v)) continue;
          const theirs = pieceOf(A);
          if (theirs.seen.has(v) && theirs.km2 - units[v].area < Math.min(GROUND_MARGIN, 0.5 * theirs.km2)) continue;
          const km = reach2[c][v];
          if (!pick || km < pick.km) pick = { v, A, km };
        }
        if (!pick) break;
        move(pick.v, pick.A, c);
        moves++;
        piece = pieceOf(c);
      }
    }
  }
  return { owner, seedUnit, seedPoint, natural, target, moves, spread: [before, spreadOf(land)] };
}

// ---- Club groups (format 2) ----

/**
 * Clubs (indices) whose starting group is split on one landmass: two of its parts, each
 * connected through shared borders, lie in one land-connected set of sections. Parts on
 * different islands are fine.
 */
export function splitOnLand(geoms, clubAt) {
  const adj = neighbors(geoms);
  const { comp } = components(adj);
  const out = [];
  for (let c = 0; c <= Math.max(...clubAt); c++) {
    const own = clubAt.map((o, p) => p).filter(p => clubAt[p] === c);
    const part = new Map();
    for (const p of own) {
      if (part.has(p)) continue;
      const stack = [p];
      part.set(p, p);
      while (stack.length) for (const v of adj[stack.pop()]) if (clubAt[v] === c && !part.has(v)) { part.set(v, p); stack.push(v); }
    }
    const lands = new Map();
    for (const p of own) {
      const seen = lands.get(comp[p]);
      if (seen != null && seen !== part.get(p)) { out.push(c); break; }
      lands.set(comp[p], part.get(p));
    }
  }
  return out;
}

/** Side of the median source unit in km: the grain of the boundary layer. */
export function grainKm(units) {
  const areas = new Map();
  for (const u of units) areas.set(baseId(u.id), (areas.get(baseId(u.id)) || 0) + u.area);
  return Math.sqrt(median([...areas.values()]) ?? 0);
}

/**
 * Displacement a club may suffer before its shared home unit is cut (splitUnits rule
 * 2): half the grain, so about 6 km for English counties and boroughs and 3 km (the
 * floor) for Spanish municipalities.
 */
export const gapLimitKm = units => Math.max(3, grainKm(units) / 2);

/**
 * The whole partition for one country (spec steps 1-4). `rawUnits` are
 * { id, name, polys } in source order, `rawHomes` [lon, lat] or null per club in
 * rank order, `places` GeoNames places { id, lon, lat, pop } for clubs without a home
 * (placeClubs; `placed` returns the place per club). With `sections` (format 2: 100)
 * above the club count, each club's territory, grown as a format-1 section, is cut into
 * its group (subdivideTerritories), at `extraPlaces` where it can. When every club gets
 * two or more sections, territories also stop near their fair share of land (growth
 * caps; units larger than a section are halved), clubs crowded into a city are fanned
 * out (fanSectors), and a club whose territory still comes out too small is fanned with
 * its city and the partition redone. There every club starts on its own ground and holds
 * it: a unit holding several grounds is cut so each club's piece holds its own
 * (splitUnits' ownHomes), a fan's sectors hold their clubs' grounds, and no club is ever
 * started anywhere else, however crowded its city. Then `seedUnit`, `seedPoint` and
 * `owner` cover the clubs and, after them, the extra starts `extras` ({ unit, point,
 * place, kind, group }); `targets` are the group sizes, `moved` the clubs whose size
 * moved, `fans` the cities' fans. Longitudes come back shifted when the country crosses
 * the antimeridian.
 * With `joinKm`, units of different `realm`s that come that close are neighbours
 * (joinRealms), so territories grow across a border two sources draw differently.
 * Format 1 may pass `allowed(club, unit)`: land a club may take while any club allowed
 * there can reach it (growSections; `unit` is the unit itself, crowd-cut pieces included),
 * and `spare`: no club takes another's last way out to land nearer that club (growSections).
 * Format 1 may also pass `fair: { minKm2 }`: every club one section, but with the land rules of format 2 where they keep
 * a club from being shut in (growth caps, fans, the boxed-in retry), each club needing `minKm2`, and no unit halved for
 * its size, so regions the caller keeps whole stay whole. `fan: 'units'` keeps the fans to the units' borders
 * (fanSectors' wholeUnits), so a unit is only ever cut where it holds several clubs (the Europe maps, whose borders are
 * all administrative).
 * The country maps pass `balance: { room, beta }`: the land rules of format 2 for every map, each club needing `room`
 * of its fair share per section (or more, to be seen), units larger than a section's share halved once up front, and
 * territories shared out by balanceSections (nearest start, then land passed towards targets `beta` of the way from
 * equal land to that) instead of growSections. No club starts away from its city: one crowded into it is fanned, and
 * starts as near its home as its sector goes. The Europe maps pass `balance` with `fair` and `fan: 'units'`: the
 * same, with `fair`'s room and no unit halved, so their borders stay administrative; their clubs start at home, two
 * clubs of one city are fanned too, and balanceSections shares each fan's land out (shareFan), crosses a city's straits
 * and rescues a club left shut in.
 */
export function partitionCountry(rawUnits, rawHomes, { maxGapKm, reach, places = [], extraPlaces = places, sections = rawHomes.length, joinKm = 0, allowed = null, spare = false, fair = null, fan: fanMode = 'cut', balance = null, log = () => {} } = {}) {
  const n = rawHomes.length;
  // Grouped maps (country and Europe maps) link land across narrow water (joinWater); club maps keep shared borders.
  const topologyOf = list => {
    const unitTopo = unitTopology(list);
    let { adjacency } = unitTopo;
    if (joinKm) adjacency = joinRealms(list, adjacency, joinKm);
    if (fair || balance) adjacency = joinWater(list, unitTopo.topo, adjacency, WATER_KM);
    return { ...unitTopo, adjacency };
  };
  const frame = (list, shift) => {
    const units = prepareUnits(list.map(u => ({ ...u, polys: shift ? shiftPolys(u.polys) : u.polys })));
    if (!shift) return units;
    // Parts cut at the antimeridian meet again at 180°: node them so they share arcs.
    const seam = units.filter(u => u.bbox[0] <= 180 + 1e-6 && u.bbox[2] >= 180 - 1e-6);
    nodeRings(seam);
    return prepareUnits(units);
  };
  const homesIn = shift => rawHomes.map(h => (h && shift ? [shiftLon(h[0]), h[1]] : h));
  rawUnits = explodeUnits(rawUnits);
  let shift = needsShift(rawUnits);
  let units = frame(rawUnits, shift);
  let homes = homesIn(shift);
  let { adjacency } = topologyOf(units);
  const overseas = dropOverseas(units, adjacency, homes);
  const dropped = [...new Set(overseas.dropped.map(u => u.name))].sort();
  if (dropped.length) {
    log(`  dropped ${dropped.length} overseas units: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ', ...' : ''}`);
    // What stays decides the frame: the USA without the Aleutians needs no shift.
    const kept = overseas.keep.map(u => rawUnits[u.index]);
    shift = needsShift(kept);
    units = frame(kept, shift);
    homes = homesIn(shift);
    ({ adjacency } = topologyOf(units));
  }
  const sourceUnits = new Set(units.map(u => baseId(u.id))).size;
  const sourceAreaKm2 = units.reduce((s, u) => s + u.area, 0);
  const located = locateHomes(units, homes);
  // On the country and Europe maps a ground off the land (a town point out in the bay, a ground across a border the map
  // cuts) counts from the nearest point of land a little inland: clubs sharing it meet there.
  const homeOf = located.map((l, i) => (l.unit == null ? null : { unit: l.unit, point: l.status === 'snapped' && (fair || balance) ? ontoLand(units[l.unit].polys, homes[i]) : homes[i] }));
  const framed = places.map(p => ({ ...p, lon: shift ? shiftLon(p.lon) : p.lon, source: p }));
  const placed = placeClubs(units, homeOf, framed, { spacingKm: 0.5 * Math.sqrt(sourceAreaKm2 / n) }).map(p => p && p.source);
  homes = homes.map((h, i) => (placed[i] ? homeOf[i].point : h));
  if (placed.some(Boolean)) log(`  placed ${placed.filter(Boolean).length} clubs without a home: ${placed.map((p, i) => (p ? `#${i + 1} at ${p.name}` : null)).filter(Boolean).join(', ')}`);
  const limit = maxGapKm ?? gapLimitKm(units);
  const padKm = grainKm(units);
  const minKm2 = 0.01 * padKm ** 2; // a hundredth of a median unit: smaller parts are slivers
  // Format 2 where every club starts on two or more sections: territories of about
  // their fair share of land (capped growth), clubs crowded into a city fanned out.
  const grouped = !!fair || !!balance || (sections > n && Math.floor(sections / n) >= 2);
  const clubShare = groupTargets(sections, n);
  // Clubs sharing a ground (one stadium, or one town point) take their land as one team, with all their shares, and
  // split it between them at the end (splitShared), each a wedge of it meeting at the ground. Elsewhere a team is a club.
  const { teams, teamOf } = grouped ? groundTeams(homeOf) : { teams: homeOf.map((_, c) => ({ lead: c, members: [c] })), teamOf: homeOf.map((_, c) => c) };
  const T = teams.length;
  const lead = teams.map(team => team.lead);
  const share = teams.map(team => team.members.reduce((sum, c) => sum + clubShare[c], 0));
  // The room each team needs, in sections: its group's size, but on balanced maps the same for every club (the stronger
  // clubs' larger groups would otherwise make them the first to count as boxed in).
  const roomShare = balance ? teams.map(team => team.members.length * sections / n) : share;
  const teamAllowed = allowed && ((t, unit) => allowed(lead[t], unit));
  // Sections under about 6 px across at the country's opening fit are too small to see.
  const [bw, bs, be, bn] = bboxOf(units.flatMap(u => u.polys));
  const extentKm = Math.max(kmBetween([bw, (bs + bn) / 2], [be, (bs + bn) / 2]), kmBetween([bw, bs], [bw, bn]));
  // Balanced maps: a club needs `room` of a typical club's land, the smaller of its fair share and the median land
  // nearest a club's home (land samples; a team's shared out between its clubs), so a country's empty quarter (Siberia,
  // the Sahara) does not make every club in its settled part count as boxed in.
  let typicalKm2 = sourceAreaKm2 / n;
  if (balance) {
    const at = lead.map(c => homeOf[c] && unitVector(homeOf[c].point));
    const land = new Array(T).fill(0);
    for (const sample of landSamples(units, 12000)) {
      const v = unitVector(sample.p);
      let best = -1, bestD = Infinity;
      at.forEach((p, t) => { if (!p) return; const d = (p[0] - v[0]) ** 2 + (p[1] - v[1]) ** 2 + (p[2] - v[2]) ** 2; if (d < bestD) { bestD = d; best = t; } });
      if (best >= 0) land[best] += sample.w;
    }
    const each = land.flatMap((km2, t) => (at[t] ? teams[t].members.map(() => km2 / teams[t].members.length) : []));
    if (each.length) typicalKm2 = Math.min(typicalKm2, median(each));
  }
  const minSectionKm2 = fair?.minKm2 ?? Math.max((6 * extentKm / 900) ** 2, (balance?.room ?? 0) * typicalKm2 * n / sections);
  // Balanced maps link a city's clubs farther apart (four tenths of a typical club's width, at most 30 km), so its crowd
  // fans out from it rather than staying shut in.
  const linkKm = balance ? Math.min(30, Math.max(3, 0.4 * Math.sqrt(typicalKm2))) : Math.min(15, Math.max(3, 0.1 * Math.sqrt(sourceAreaKm2 / n)));
  // The land-share estimates miss a club shut in by its neighbours' land as they grow
  // (Port Vila's clubs): one whose territory still ends up under
  // BOXED of its sections' room is fanned with the clubs of its city; the partition is then redone from the same units.
  // The attempt whose boxed-in clubs fall least short (squared shortfalls, the earliest of equals) is kept, and only its
  // lines are logged.
  // Balanced maps cut every unit larger than a section's share of the land once, before the starts are settled
  // (halving does not depend on them), so each partition redone below cuts units only for its clubs. With `fair` (the
  // Europe maps) units stay whole: the caller keeps them to administrative borders.
  let halved = [];
  if (balance && !fair) {
    const before = units;
    ({ units, splits: halved } = splitUnits(units, homeOf.map(() => null), sections, { minKm2, maxUnitKm2: sourceAreaKm2 / sections, log }));
    const map = unitMapper(before, units);
    homeOf.forEach((h, c) => { if (h) homeOf[c] = { ...h, unit: map(h.unit, h.point) }; });
  }
  const baseUnits = units, baseHomes = lead.map(c => homeOf[c] && { ...homeOf[c] });
  const teamHome = new Array(T);
  const forceFan = new Set();
  let fans, splits, topo, unitAdjacency, owner, seedUnit, seedPoint, lines, best = null;
  for (;;) {
    lines = [];
    const note = line => lines.push(line);
    units = baseUnits;
    baseHomes.forEach((h, t) => { teamHome[t] = h && { ...h }; });
    fans = [];
    if (grouped) {
      // Every club keeps its own ground (the user, 2026-11-19: "keep cities in their cities"; 2026-11-21: "a territory
      // needs to own the part of the map where their city and stadium is in"): a club crowded into a city is fanned out
      // from it, never started at a town nearby.
      ({ units, fans } = fanSectors(units, teamHome, { linkKm, grain: padKm, force: forceFan, wholeUnits: fanMode === 'units', fanMax: balance ? BALANCE_FAN_MAX : FAN_MAX, weight: t => teams[t].members.length,
        ...(balance && fanMode === 'units' ? { pairKm: linkKm / 3 } : {}) }));
      if (fans.length) note(`  fanned ${fans.map(f => f.members.reduce((sum, t) => sum + teams[t].members.length, 0)).join(' + ')} clubs around ${fans.length} cities`);
    }
    const fanOf = Array.from({ length: T }, (_, t) => fans.map((f, i) => (f.members.includes(t) ? i : -1)).filter(i => i >= 0));
    ({ units, splits } = splitUnits(units, teamHome, sections, { maxGapKm: limit, minKm2, log: note, ownHomes: grouped, sliverKm: Math.max(SLIVER_WIDTH_KM, contactKmOf(units) / 2), ...(grouped && !fair && !balance ? { maxUnitKm2: sourceAreaKm2 / sections } : {}) }));
    ({ topo, adjacency: unitAdjacency } = topologyOf(units));
    const grownUnits = units;
    if (balance) {
      // A city's zone is its fan's: on the country maps each piece is its sector's club's alone; on the Europe maps any
      // of the fan's clubs may take it (shareFan shares the fan's land out), no other club.
      const whole = fanMode === 'units';
      const fanAllowed = (t, u) => !grownUnits[u].fans || grownUnits[u].fans.every((m, f) => m == null || m === t || (whole && fans[f].members.includes(t)));
      // Each fanned team's direction from its city's centre, the middle of its sector (the country maps).
      const fanned = whole ? null : new Array(T).fill(null);
      if (fanned) fans.forEach((fan, f) => {
        const [cx, cy] = fan.centre;
        const kx = Math.cos(cy * RAD), sum = new Map(fan.members.map(t => [t, [0, 0]]));
        for (const u of units) {
          const t = u.fans?.[f];
          if (t == null || !sum.has(t)) continue;
          sum.get(t)[0] += (u.centroid[0] - cx) * kx * u.area;
          sum.get(t)[1] += (u.centroid[1] - cy) * u.area;
        }
        for (const [t, [sx, sy]] of sum) if (sx || sy) fanned[t] = { fan: f, centre: fan.centre, dir: Math.atan2(sy, sx) };
      });
      const grown = balanceSections(units, unitAdjacency, teamHome, {
        beta: balance.beta, padKm, minKm2, topo, fans, fanned, weight: teams.map(team => team.members.length), room: roomShare.map(r => r * minSectionKm2), wholeUnits: whole,
        ...(grouped ? { share, allowed: (t, u) => fanAllowed(t, u) && (!teamAllowed || teamAllowed(t, grownUnits[u])) }
          : teamAllowed ? { allowed: (t, u) => teamAllowed(t, grownUnits[u]) } : {}),
      });
      ({ owner, seedUnit, seedPoint } = grown);
      note(`  balanced land: ${grown.moves} units passed; spread of land to target ${grown.spread[0].toFixed(2)} -> ${grown.spread[1].toFixed(2)}`);
    } else ({ owner, seedUnit, seedPoint } = growSections(units, unitAdjacency, teamHome, {
      reach, padKm, minKm2,
      ...(grouped ? {
        reach: fanOf.map(list => (list.length ? Infinity : reach ?? REACH)),
        share, cap: share.map(s => 1.5 * sourceAreaKm2 * s / sections),
        allowed: (t, u) => (!grownUnits[u].fans || grownUnits[u].fans.every(m => m == null || m === t)) && (!teamAllowed || teamAllowed(t, grownUnits[u])),
      } : {
        spare,
        ...(teamAllowed ? { allowed: (t, u) => teamAllowed(t, grownUnits[u]) } : {}),
      }),
    }));
    if (!grouped) break;
    const land = new Array(T).fill(0);
    owner.forEach((t, u) => { land[t] += units[u].area; });
    const ratio = t => land[t] / (BOXED * minSectionKm2 * roomShare[t]);
    const boxed = [...Array(T).keys()].filter(t => baseHomes[t] && ratio(t) < 1);
    const shortfall = boxed.reduce((sum, t) => sum + (1 - ratio(t)) ** 2, 0);
    if (boxed.length) note(`  boxed in: ${boxed.flatMap(t => teams[t].members).map(c => `#${c + 1}`).join(', ')}`);
    if (!best || shortfall < best.shortfall) {
      best = { shortfall, units, homes: teamHome.slice(), fans, splits, topo, unitAdjacency, owner, seedUnit, seedPoint, lines };
    }
    // A club still boxed in after growth is fanned with its city, never moved out of it.
    const escalated = [];
    for (const t of boxed) {
      if (fanOf[t].length || forceFan.has(t)) continue;
      if (baseHomes.some((h, d) => d !== t && h && kmBetween(h.point, baseHomes[t].point) <= linkKm)) { forceFan.add(t); escalated.push(`#${lead[t] + 1} fanned`); }
    }
    if (!escalated.length) break;
    log(`  boxed in after growth, redone: ${escalated.join(', ')}`);
  }
  if (best) {
    ({ units, fans, splits, topo, unitAdjacency, owner, seedUnit, seedPoint, lines } = best);
    best.homes.forEach((h, t) => { teamHome[t] = h; });
  }
  lines.forEach(line => log(line));
  splits = [...halved, ...splits];
  // Each team's land split between its clubs; everywhere else a club's land is its team's.
  if (teams.some(team => team.members.length > 1)) {
    const shared = splitShared(units, owner, seedUnit, seedPoint, teams, lead.map(c => homeOf[c]?.point ?? null), n, c => clubShare[c]);
    ({ units, owner, seedUnit, seedPoint } = shared);
    splits = [...splits, ...shared.splits];
    shared.splits.forEach(split => log(`    split ${split.unit} into ${split.pieces} (${split.reason})`));
    ({ topo, adjacency: unitAdjacency } = topologyOf(units));
  }
  homeOf.forEach((h, c) => { if (h) homeOf[c] = { ...h, unit: seedUnit[c] }; });
  fans = fans.map(fan => ({ ...fan, members: fan.members.flatMap(t => teams[t].members) }));
  // Format 2 with fewer clubs than sections: each club's section is cut into its group.
  let extras = [], targets = groupTargets(n, n), moved = [];
  if (sections > n) {
    const extraFramed = extraPlaces === places ? framed : extraPlaces.map(p => ({ ...p, lon: shift ? shiftLon(p.lon) : p.lon, source: p }));
    const sub = subdivideTerritories(units, { owner, seedUnit, seedPoint, adjacency: unitAdjacency }, homeOf, extraFramed, sections, {
      reach, padKm, minKm2, minSectionKm2, log,
    });
    homeOf.forEach((h, i) => { if (h) homeOf[i] = { ...h, unit: sub.unitOf(h.unit, h.point) }; });
    ({ units, topo, adjacency: unitAdjacency, owner, seedUnit, seedPoint, extras, targets, moved } = sub);
    splits = [...splits, ...sub.splits];
  }
  // Where clubs' land meets at their grounds (a shared ground, a fan's centre): the map's simplification keeps these.
  const junctions = [...baseHomes.filter(Boolean).map(h => h.point), ...fans.map(f => f.centre)];
  return {
    shift, units, adjacency: unitAdjacency, topo, homes, homeOf, located, placed, extras, targets, moved, fans, dropped, splits,
    sourceUnits, sourceAreaKm2, maxGapKm: limit, padKm, owner, seedUnit, seedPoint, junctions,
  };
}

/**
 * Clubs sharing a ground: each club joins the team of the first club (the strongest) whose ground lies within
 * SAME_GROUND_KM of its own; a club without a home is a team of its own. Returns { teams: [{ lead, members }], teamOf }.
 */
function groundTeams(homeOf) {
  const teams = [], teamOf = new Array(homeOf.length);
  homeOf.forEach((h, c) => {
    const t = h ? teams.findIndex(team => homeOf[team.lead] && kmBetween(homeOf[team.lead].point, h.point) <= SAME_GROUND_KM) : -1;
    if (t >= 0) { teams[t].members.push(c); teamOf[c] = t; } else { teamOf[c] = teams.length; teams.push({ lead: c, members: [c] }); }
  });
  return { teams, teamOf };
}

// A cut piece of less land than this is a sliver of the cut (a wedge edge run along a border, or out of a town point
// that is the ground itself: Kara's for Kozah and ASC Kara), not land: no section can be drawn on it.
const SLIVER_KM2 = 1e-3;
// Nor a cut piece narrower than this (km), which simplification draws as a line.
const SLIVER_WIDTH_KM = 0.05;

/** A polygon's mean width in km: twice its area over its perimeter, about a strip's width. */
function widthKm(poly) {
  let perimeter = 0;
  for (const ring of poly) for (let i = 1; i < ring.length; i++) perimeter += kmBetween(ring[i - 1], ring[i]);
  return perimeter > 0 ? (2 * polyAreaKm2(poly)) / perimeter : 0;
}

/**
 * The pieces of one unit's cut (`parts`: [{ k, polys }]) with their slivers (under SLIVER_KM2, or narrower than
 * `minWidthKm`, which the map's quantization draws as a line: a cut run along a border, or out of a ground on one,
 * as IFK Gothenburg's home section along a wedge from Ullevi on Sweden's map of 1994/95) joined to the piece of the cut
 * they lie against along most of their outline, else dropped. With `keepLargest` (a cut giving each club or section a
 * piece) every part keeps its largest polygon.
 */
function absorbSlivers(parts, minWidthKm, { keepLargest = false } = {}) {
  const slivers = [];
  const kept = parts.map(p => {
    const largest = keepLargest && p.polys.length ? p.polys.reduce((x, poly) => (polyAreaKm2(poly) > polyAreaKm2(x) ? poly : x)) : null;
    return { ...p, polys: p.polys.filter(poly => {
      if (poly === largest || (polyAreaKm2(poly) >= SLIVER_KM2 && widthKm(poly) >= minWidthKm)) return true;
      slivers.push(poly);
      return false;
    }) };
  });
  for (const sliver of slivers) {
    let best = null;
    for (const p of kept) p.polys.forEach((poly, j) => {
      const box = bboxOf([poly]);
      const touching = sliver[0].filter(q => inBox(q, [box[0] - 1e-6, box[1] - 1e-6, box[2] + 1e-6, box[3] + 1e-6]) && kmToPolys(q, [poly]) < 1e-6).length;
      if (touching && (!best || touching > best.touching)) best = { p, j, touching };
    });
    if (!best) continue;
    try {
      const joined = polygonClipping.union([best.p.polys[best.j]], [sliver]).map(poly => poly.map(closeRing).filter(ring => ring.length >= 4)).filter(q => q.length);
      if (joined.length === 1) best.p.polys[best.j] = joined[0];
    } catch { /* dropped */ }
  }
  return kept.filter(p => p.polys.length);
}
// Pieces of a club's land joined by a border shorter than this many steps of the map's quantization (a corner, a few
// metres where two cuts cross) are not joined on the map: its quantization (1e5 steps across) draws them apart.
const CONTACT_STEPS = 4;
/** The shortest border that joins land on a map of these units (km): CONTACT_STEPS of its quantization. */
const contactKmOf = units => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const u of units) { w = Math.min(w, u.bbox[0]); s = Math.min(s, u.bbox[1]); e = Math.max(e, u.bbox[2]); n = Math.max(n, u.bbox[3]); }
  const spanKm = Math.max((e - w) * Math.cos(((s + n) / 2) * RAD), n - s) * EARTH_KM * RAD;
  return Math.max(0.002, (CONTACT_STEPS * spanKm) / 1e5);
};
// A piece of land under this share of a pixel at the map's opening fit (its span over 900 px, the span from the joining
// threshold: contactKmOf) is a crumb the map may not draw.
const CRUMB_PX2 = 0.25;
const crumbKm2Of = contactKm => CRUMB_PX2 * ((contactKm * 1e5) / CONTACT_STEPS / 900) ** 2;
// A split of a shared ground's land leaving a club under this share of its land ranks below any that does not (judgeSplit).
const FAIR_FLOOR = 0.1;

// A team's land about a shared ground is laid on a grid (wayOut) of WAY_CELLS cells a side, or of cells of WAY_KM where
// that is coarser, up to WAY_CELLS_MAX a side: the clubs' land meets within a cell or so of the ground.
const WAY_CELLS = 600;
const WAY_KM = 0.5;
const WAY_CELLS_MAX = 1200;

/**
 * The team's land (`units`) about its shared ground P (kx, ky: km a degree there) in the order a line out of P sweeps
 * it anticlockwise from bearing `start`, bending round corners. On a grid over the land, each cell's shortest way to P
 * over it, straight wherever it can be (lazy Theta*: a cell hangs from the farthest cell of its way it sees, or from P
 * where P sees it, the land starting within `leadKm` of P), makes a tree, and the order is the tree's, each cell's
 * children taken anticlockwise from the way back. So the land P sees is swept by its bearing, and the land past a
 * corner (its ways bending there) as the sweep reaches the corner, by its bearing from it. Returns { cell (km), nx, ny,
 * x0, y0 (km east and north of P: the grid's corner), unitAt (Int32Array: the unit holding each cell's centre, else
 * -1), g (Float64Array: each cell's way's length, in cells; Infinity where no way reaches), order (Int32Array: the
 * cells reached, in sweep order), root (Float64Array: per place in the order, the bearing from `start` of the cell
 * hanging from P it lies behind), km and bearing (cell -> km from P; its bearing from `start`) }.
 */
function wayOut(P, units, kx, ky, leadKm, start) {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for (const u of units) {
    x0 = Math.min(x0, (u.bbox[0] - P[0]) * kx);
    x1 = Math.max(x1, (u.bbox[2] - P[0]) * kx);
    y0 = Math.min(y0, (u.bbox[1] - P[1]) * ky);
    y1 = Math.max(y1, (u.bbox[3] - P[1]) * ky);
  }
  const across = Math.max(x1 - x0, y1 - y0, 0.01);
  const cell = Math.max(across / WAY_CELLS_MAX, Math.min(across / WAY_CELLS, WAY_KM));
  x0 -= cell;
  y0 -= cell;
  const nx = Math.ceil((x1 - x0) / cell) + 2, ny = Math.ceil((y1 - y0) / cell) + 2, N = nx * ny;
  const unitAt = new Int32Array(N).fill(-1);
  units.forEach((u, index) => {
    for (const poly of u.polys) {
      const rows = new Map();
      for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
        const ax = ((ring[i][0] - P[0]) * kx - x0) / cell, ay = ((ring[i][1] - P[1]) * ky - y0) / cell;
        const bx = ((ring[i + 1][0] - P[0]) * kx - x0) / cell, by = ((ring[i + 1][1] - P[1]) * ky - y0) / cell;
        if (ay === by) continue;
        for (let r = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)); r <= Math.min(ny - 1, Math.floor(Math.max(ay, by) - 0.5)); r++) {
          const y = r + 0.5;
          if (y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
          if (!rows.has(r)) rows.set(r, []);
          rows.get(r).push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      for (const [r, xs] of rows) {
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c <= Math.min(nx - 1, Math.floor(xs[k + 1] - 0.5)); c++) unitAt[r * nx + c] = index;
        }
      }
    }
  });
  const px = -x0 / cell, py = -y0 / cell, lead = Math.max(leadKm / cell, 1);
  const landAt = (x, y) => {
    const c = Math.floor(x), r = Math.floor(y);
    return c >= 0 && c < nx && r >= 0 && r < ny && unitAt[r * nx + c] >= 0;
  };
  const cx = i => (i % nx) + 0.5, cy = i => Math.floor(i / nx) + 0.5;
  // How far out along each bearing P sees its land.
  const reach = Math.hypot(Math.max(px, nx - px), Math.max(py, ny - py));
  const bins = Math.max(360, Math.ceil(2 * Math.PI * reach));
  const seen = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    const a = ((b + 0.5) * 2 * Math.PI) / bins, dx = Math.cos(a), dy = Math.sin(a);
    let onLand = false, r = 0.25;
    for (; r < reach; r += 0.5) {
      if (landAt(px + r * dx, py + r * dy)) onLand = true;
      else if (onLand || r > lead) break;
    }
    seen[b] = onLand ? r : 0;
  }
  const ROOT = -2;
  const sight = (a, i) => {
    if (a === ROOT) {
      const ang = Math.atan2(cy(i) - py, cx(i) - px), b = Math.floor((((ang + 2 * Math.PI) % (2 * Math.PI)) * bins) / (2 * Math.PI)) % bins;
      return Math.hypot(cx(i) - px, cy(i) - py) < seen[b];
    }
    const ax = cx(a), ay = cy(a), bx = cx(i), by = cy(i), steps = Math.ceil(2 * Math.hypot(bx - ax, by - ay));
    for (let s = 1; s < steps; s++) if (!landAt(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)) return false;
    return true;
  };
  const g = new Float64Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const gOf = a => (a === ROOT ? 0 : g[a]);
  const span = (a, i) => (a === ROOT ? Math.hypot(cx(i) - px, cy(i) - py) : Math.hypot(cx(i) - cx(a), cy(i) - cy(a)));
  const heap = claimHeap();
  const around = Math.ceil(lead) + 1;
  for (let r = Math.max(0, Math.floor(py) - around); r <= Math.min(ny - 1, Math.floor(py) + around); r++) {
    for (let c = Math.max(0, Math.floor(px) - around); c <= Math.min(nx - 1, Math.floor(px) + around); c++) {
      const i = r * nx + c, d = Math.hypot(c + 0.5 - px, r + 0.5 - py);
      if (unitAt[i] >= 0 && d <= lead) {
        g[i] = d;
        parent[i] = ROOT;
        heap.push(d, 0, i);
      }
    }
  }
  // A ground farther than that from its land (on a coast drawn coarser): the way starts at the land's cell nearest it.
  if (!heap.size) {
    let nearest = -1, best = Infinity;
    for (let i = 0; i < N; i++) {
      if (unitAt[i] < 0) continue;
      const d = Math.hypot(cx(i) - px, cy(i) - py);
      if (d < best) { best = d; nearest = i; }
    }
    if (nearest >= 0) { g[nearest] = best; parent[nearest] = ROOT; heap.push(best, 0, nearest); }
  }
  const neighbours = i => {
    const c = i % nx, r = (i - c) / nx, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr;
      if ((dc || dr) && cc >= 0 && rr >= 0 && cc < nx && rr < ny && unitAt[rr * nx + cc] >= 0) out.push(rr * nx + cc);
    }
    return out;
  };
  while (heap.size) {
    const [d, , s] = heap.pop();
    if (closed[s] || d > g[s]) continue;
    if (!sight(parent[s], s)) {
      // Its way's last cell is out of sight: it hangs from its best neighbour reached.
      let best = -1, bestG = Infinity;
      for (const n of neighbours(s)) if (closed[n] && g[n] + span(n, s) < bestG) { bestG = g[n] + span(n, s); best = n; }
      if (best >= 0) { parent[s] = best; g[s] = bestG; }
    }
    closed[s] = 1;
    const a = parent[s];
    for (const t of neighbours(s)) {
      if (closed[t]) continue;
      const v = gOf(a) + span(a, t);
      if (v < g[t]) { g[t] = v; parent[t] = a; heap.push(v, 0, t); }
    }
  }
  // The tree, each cell's children anticlockwise from its way back (P's by bearing from `start`).
  const turn = b => (b - start + 4 * Math.PI) % (2 * Math.PI);
  const kids = new Map(), top = [];
  for (let i = 0; i < N; i++) {
    if (!closed[i]) continue;
    if (parent[i] === ROOT) top.push(i);
    else { if (!kids.has(parent[i])) kids.set(parent[i], []); kids.get(parent[i]).push(i); }
  }
  const bearingOf = i => Math.atan2(cy(i) - py, cx(i) - px);
  top.sort((a, b) => turn(bearingOf(a)) - turn(bearingOf(b)) || a - b);
  for (const [v, list] of kids) {
    const p = parent[v], back = p === ROOT ? Math.atan2(py - cy(v), px - cx(v)) : Math.atan2(cy(p) - cy(v), cx(p) - cx(v));
    const key = c => (Math.atan2(cy(c) - cy(v), cx(c) - cx(v)) - back + 4 * Math.PI) % (2 * Math.PI);
    list.sort((a, b) => key(a) - key(b) || a - b);
  }
  const order = new Int32Array(top.length + [...kids.values()].reduce((sum, list) => sum + list.length, 0));
  const root = new Float64Array(order.length);
  let q = 0;
  for (const r of top) {
    const rb = turn(bearingOf(r)), stack = [r];
    while (stack.length) {
      const v = stack.pop();
      order[q] = v;
      root[q++] = rb;
      const list = kids.get(v);
      if (list) for (let k = list.length - 1; k >= 0; k--) stack.push(list[k]);
    }
  }
  for (let i = 0; i < N; i++) if (!closed[i]) g[i] = Infinity;
  return { cell, nx, ny, x0, y0, unitAt, g, order: order.subarray(0, q), root: root.subarray(0, q), km: i => Math.hypot(cx(i) - px, cy(i) - py) * cell, bearing: i => turn(bearingOf(i)) };
}

/**
 * The outline of the cells labelled `k` on a grid (`label`, nx by ny, row by row from the south-west), as closed rings
 * of [x, y] in cells: anticlockwise round the region, clockwise round its holes; cells touching at a corner only are
 * apart. Each corner is cut back half a cell along both its sides, so a staircase of cells is drawn as the straight line
 * it stands for.
 */
function regionRings(label, nx, ny, k) {
  const W = nx + 1, edges = [], out = new Map();
  const is = (c, r) => c >= 0 && r >= 0 && c < nx && r < ny && label[r * nx + c] === k;
  const add = (c0, r0, c1, r1) => {
    const v = r0 * W + c0;
    if (!out.has(v)) out.set(v, []);
    out.get(v).push(edges.length);
    edges.push([c0, r0, c1, r1]);
  };
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    if (label[r * nx + c] !== k) continue;
    if (!is(c, r - 1)) add(c, r, c + 1, r);
    if (!is(c + 1, r)) add(c + 1, r, c + 1, r + 1);
    if (!is(c, r + 1)) add(c + 1, r + 1, c, r + 1);
    if (!is(c - 1, r)) add(c, r + 1, c, r);
  }
  const used = new Uint8Array(edges.length), rings = [];
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (used[e0]) continue;
    const corners = [];
    let e = e0;
    for (;;) {
      used[e] = 1;
      const [c0, r0, c1, r1] = edges[e];
      corners.push([c0, r0, c1 - c0, r1 - r0]);
      const options = (out.get(r1 * W + c1) || []).filter(f => !used[f]);
      if (!options.length) break;
      // Where two of its cells touch at a corner only, turn left: round the cell, keeping them apart.
      const dx = c1 - c0, dy = r1 - r0;
      e = options.find(f => edges[f][2] - edges[f][0] === -dy && edges[f][3] - edges[f][1] === dx) ?? options[0];
    }
    // Corners only (where the way turns), each cut back half a cell along both sides.
    const turns = corners.filter((p, i) => {
      const q = corners[(i + corners.length - 1) % corners.length];
      return p[2] !== q[2] || p[3] !== q[3];
    });
    const ring = [];
    turns.forEach((p, i) => {
      const q = turns[(i + turns.length - 1) % turns.length];
      ring.push([p[0] - 0.5 * q[2], p[1] - 0.5 * q[3]], [p[0] + 0.5 * p[2], p[1] + 0.5 * p[3]]);
    });
    // A step one cell long cuts back to one point from both its corners; then points on a straight line between their
    // neighbours (a staircase's) are dropped.
    const once = ring.filter((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length];
      return p[0] !== a[0] || p[1] !== a[1];
    });
    const kept = once.filter((p, i) => {
      const a = once[(i + once.length - 1) % once.length], b = once[(i + 1) % once.length];
      return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-9;
    });
    if (kept.length >= 3) rings.push([...kept, kept[0]]);
  }
  return rings;
}

/**
 * The clubs' land on a team's grid (`label`: per cell of `way`, wayOut's, the run of the sweep it lies in; rewritten in
 * place) made to hang together: a line of sight through a gap (a bridge over Lomé's lagoon) gives one run a thin beam
 * through another's, and land past a corner whose sight line the runs share (Kara's, west and north) reaches the ground
 * only along that line. So three passes of a vote of each cell's land neighbours (beyond `rd` km of the ground) first
 * take in thin beams; then the clubs grow out over the grid, cell to side-by-side cell, from the team's land at the
 * ground: the club furthest short of its share of the land (`shares`, summing to 1) takes next, its own run's cell
 * nearest the ground by its shortest way first, else the cell nearest its run (heading for it, not round the ground).
 * Land none reaches (an island) keeps its run.
 */
function growRuns(way, label, m, rd, shares) {
  const { nx, ny, unitAt } = way, N = unitAt.length;
  const land = i => unitAt[i] >= 0;
  const around = (i, diagonal, out = []) => {
    out.length = 0;
    const c = i % nx, r = (i - c) / nx;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((!dc && !dr) || (!diagonal && dc && dr)) continue;
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < nx && rr < ny && land(rr * nx + cc)) out.push(rr * nx + cc);
    }
    return out;
  };
  const list = [], votes = new Int32Array(m);
  for (let pass = 0; pass < 3; pass++) {
    const next = label.slice();
    for (let i = 0; i < N; i++) {
      if (!land(i) || way.km(i) <= rd) continue;
      votes.fill(0);
      around(i, true, list);
      for (const j of list) votes[label[j]]++;
      let best = label[i];
      for (let k = 0; k < m; k++) if (votes[k] > votes[best]) best = k;
      if (best !== label[i] && 2 * votes[best] > list.length) next[i] = best;
    }
    label.set(next);
  }
  const owner = new Int8Array(N).fill(-1), held = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < N; i++) if (land(i) && Number.isFinite(way.g[i])) total++;
  // The clubs start side by side on the team's main stretch of land at the ground (its largest stretch of cells side by
  // side within rd of it, else its stretch nearest it: not an islet in the Nile at Cairo), each on its run's cell among
  // the stretch's 4m nearest the ground, else on the free cell nearest it.
  const part = new Int32Array(N).fill(-1), stretches = [];
  for (let i = 0; i < N; i++) {
    if (!land(i) || part[i] >= 0 || !Number.isFinite(way.g[i])) continue;
    const s = { cells: [i], km: Infinity };
    part[i] = stretches.length;
    for (let q = 0; q < s.cells.length; q++) {
      const v = s.cells[q];
      s.km = Math.min(s.km, way.km(v));
      for (const j of around(v, false, list)) if (part[j] < 0 && Number.isFinite(way.g[j])) { part[j] = stretches.length; s.cells.push(j); }
    }
    stretches.push(s);
  }
  if (!stretches.length) return;
  const close = stretches.filter(s => s.km <= rd);
  const main = close.length ? close.reduce((x, s) => (s.cells.length > x.cells.length ? s : x)) : stretches.reduce((x, s) => (s.km < x.km ? s : x));
  const nearest = [...main.cells].sort((a, b) => way.km(a) - way.km(b) || a - b);
  const handy = nearest.slice(0, 4 * m);
  for (let k = 0; k < m; k++) {
    const i = handy.find(j => owner[j] < 0 && label[j] === k) ?? nearest.find(j => owner[j] < 0);
    if (i == null) continue;
    owner[i] = k;
    held[k]++;
  }
  // How far each cell lies from each run, over the land (in cells).
  const toward = Array.from({ length: m }, (_, k) => {
    const d = new Float64Array(N).fill(Infinity), heap = claimHeap();
    for (let i = 0; i < N; i++) if (land(i) && label[i] === k) { d[i] = 0; heap.push(0, 0, i); }
    while (heap.size) {
      const [di, , i] = heap.pop();
      if (di > d[i]) continue;
      for (const j of around(i, true, list)) {
        const dj = di + (j % nx !== i % nx && Math.floor(j / nx) !== Math.floor(i / nx) ? Math.SQRT2 : 1);
        if (dj < d[j]) { d[j] = dj; heap.push(dj, 0, j); }
      }
    }
    return d;
  });
  const heaps = Array.from({ length: m }, () => claimHeap());
  const far = 4 * (nx + ny); // more than any way's length, in cells: a club's own run first
  const offer = (k, i) => heaps[k].push(label[i] === k ? way.g[i] : far + (Number.isFinite(toward[k][i]) ? toward[k][i] : far), 0, i);
  for (let i = 0; i < N; i++) {
    if (owner[i] < 0) continue;
    for (const j of around(i, false, list)) if (owner[j] < 0 && Number.isFinite(way.g[j])) offer(owner[i], j);
  }
  const pending = new Int32Array(m).fill(-1);
  for (;;) {
    let k = -1;
    for (let c = 0; c < m; c++) {
      while (pending[c] < 0 && heaps[c].size) { const [, , i] = heaps[c].pop(); if (owner[i] < 0) pending[c] = i; }
      if (pending[c] >= 0 && (k < 0 || held[c] / (shares[c] * total) < held[k] / (shares[k] * total))) k = c;
    }
    if (k < 0) break;
    const i = pending[k];
    pending[k] = -1;
    if (owner[i] >= 0) continue;
    owner[i] = k;
    held[k]++;
    for (const j of around(i, false, list)) if (owner[j] < 0 && Number.isFinite(way.g[j])) offer(k, j);
  }
  for (let i = 0; i < N; i++) if (owner[i] >= 0) label[i] = owner[i];
}

// A team's land about a shared ground is judged on a grid of TURN_CELLS cells a side (teamGrid), at TURN_STEPS turns of
// its clubs' wedges and then finer about the best (bestTurn).
const TURN_CELLS = 300;
const TURN_STEPS = 72;

/**
 * A team's land (`units`) on a grid about its shared ground P (kx, ky: km a degree there), TURN_CELLS cells a side:
 * its land cells (those whose centre the land holds), each one's bearing from P (radians anticlockwise from east), its
 * km from P and its land neighbours side by side. Returns { size, cell (km), bearing, km (Float64Array per land
 * cell), next (Int32Array, four per land cell, -1 for none) }.
 */
function teamGrid(P, units, kx, ky) {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for (const u of units) {
    x0 = Math.min(x0, (u.bbox[0] - P[0]) * kx);
    x1 = Math.max(x1, (u.bbox[2] - P[0]) * kx);
    y0 = Math.min(y0, (u.bbox[1] - P[1]) * ky);
    y1 = Math.max(y1, (u.bbox[3] - P[1]) * ky);
  }
  const cell = Math.max(x1 - x0, y1 - y0, 0.01) / TURN_CELLS;
  x0 -= cell;
  y0 -= cell;
  const nx = Math.ceil((x1 - x0) / cell) + 2, ny = Math.ceil((y1 - y0) / cell) + 2;
  const at = new Int32Array(nx * ny).fill(-1);
  for (const u of units) for (const poly of u.polys) {
    const rows = new Map();
    for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const ax = ((ring[i][0] - P[0]) * kx - x0) / cell, ay = ((ring[i][1] - P[1]) * ky - y0) / cell;
      const bx = ((ring[i + 1][0] - P[0]) * kx - x0) / cell, by = ((ring[i + 1][1] - P[1]) * ky - y0) / cell;
      if (ay === by) continue;
      for (let r = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)); r <= Math.min(ny - 1, Math.floor(Math.max(ay, by) - 0.5)); r++) {
        const y = r + 0.5;
        if (y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c <= Math.min(nx - 1, Math.floor(xs[k + 1] - 0.5)); c++) at[r * nx + c] = 0;
      }
    }
  }
  let size = 0;
  for (let i = 0; i < at.length; i++) if (at[i] === 0) at[i] = size++;
  const bearing = new Float64Array(size), km = new Float64Array(size), next = new Int32Array(4 * size).fill(-1);
  for (let i = 0; i < at.length; i++) {
    const j = at[i];
    if (j < 0) continue;
    const c = i % nx, r = (i - c) / nx, x = x0 + (c + 0.5) * cell, y = y0 + (r + 0.5) * cell;
    bearing[j] = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
    km[j] = Math.hypot(x, y);
    if (c > 0) next[4 * j] = at[i - 1];
    if (c + 1 < nx) next[4 * j + 1] = at[i + 1];
    if (r > 0) next[4 * j + 2] = at[i - nx];
    if (r + 1 < ny) next[4 * j + 3] = at[i + nx];
  }
  return { size, cell, bearing, km, next };
}

/**
 * The turn of a team's clubs' wedges about their shared ground that leaves them the fairest land (`grid`: teamGrid's;
 * `shares`, summing to 1, in club order): wedges of their shares of the land, or for two clubs a side each of a line
 * through the ground (both hold land along it, at the ground). At each turn tried, a club keeps its land
 * on the grid that hangs together with its land within `rd` km of the ground (its largest stretch there; none, and the
 * turn is out), its other land going to the club it lies against most, as the land of the split will; the turn whose
 * least club holds most of its share wins. Returns { turn, edges (radians from the turn, club k's wedge [edges[k],
 * edges[k + 1])) }.
 */
function bestTurn(grid, m, shares, rd) {
  const { size, bearing, km, next } = grid;
  const label = new Int8Array(size), part = new Int32Array(size), cells = new Int32Array(size);
  const sorted = Float64Array.from(bearing).sort();
  const edgesAt = (turn, half) => {
    if (half) return [0, Math.PI, 2 * Math.PI];
    // Wedges of the clubs' shares of the land, anticlockwise from the turn.
    let lo = 0, hi = size;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < turn % (2 * Math.PI)) lo = mid + 1; else hi = mid; }
    const edges = [0];
    let before = 0;
    for (let k = 1; k < m; k++) {
      before += shares[k - 1];
      const b = sorted[(lo + Math.min(size - 1, Math.floor(before * size))) % size];
      edges.push(Math.max(edges[k - 1], (b - turn + 4 * Math.PI) % (2 * Math.PI)));
    }
    edges.push(2 * Math.PI);
    return edges;
  };
  const score = (turn, half) => {
    const edges = edgesAt(turn, half);
    for (let i = 0; i < size; i++) {
      const b = (bearing[i] - turn + 4 * Math.PI) % (2 * Math.PI);
      let k = 0;
      while (k + 1 < m && b >= edges[k + 1]) k++;
      label[i] = k;
    }
    for (let round = 0; round < 4; round++) {
      part.fill(-1);
      const parts = [];
      let filled = 0;
      for (let i = 0; i < size; i++) {
        if (part[i] >= 0) continue;
        const p = { k: label[i], from: filled, size: 0, home: false };
        part[i] = parts.length;
        cells[filled++] = i;
        for (let q = p.from; q < filled; q++) {
          const v = cells[q];
          if (km[v] <= rd) p.home = true;
          for (let d = 0; d < 4; d++) {
            const j = next[4 * v + d];
            if (j >= 0 && part[j] < 0 && label[j] === p.k) { part[j] = parts.length; cells[filled++] = j; }
          }
        }
        p.size = filled - p.from;
        parts.push(p);
      }
      const kept = new Array(m).fill(-1);
      parts.forEach((p, x) => { if (p.home && (kept[p.k] < 0 || p.size > parts[kept[p.k]].size)) kept[p.k] = x; });
      if (kept.some(x => x < 0)) return -1;
      let moved = 0;
      const votes = new Int32Array(m);
      parts.forEach((p, x) => {
        if (kept[p.k] === x) return;
        votes.fill(0);
        for (let q = p.from; q < p.from + p.size; q++) for (let d = 0; d < 4; d++) {
          const j = next[4 * cells[q] + d];
          if (j >= 0 && part[j] !== x) votes[label[j]]++;
        }
        let best = -1;
        for (let k = 0; k < m; k++) if (k !== p.k && votes[k] > 0 && (best < 0 || votes[k] > votes[best])) best = k;
        if (best < 0) return;
        for (let q = p.from; q < p.from + p.size; q++) label[cells[q]] = best;
        moved++;
      });
      if (!moved) break;
    }
    const held = new Float64Array(m);
    for (let i = 0; i < size; i++) held[label[i]]++;
    let least = Infinity;
    for (let k = 0; k < m; k++) least = Math.min(least, held[k] / (shares[k] * size));
    return least;
  };
  let best = { turn: 0, half: false, score: -Infinity };
  const step = (2 * Math.PI) / TURN_STEPS;
  for (const half of m === 2 ? [true, false] : [false]) {
    for (let j = 0; j < TURN_STEPS; j++) {
      const s = score(j * step, half);
      if (s > best.score + 1e-9) best = { turn: j * step, half, score: s };
    }
  }
  for (let j = -4; j <= 4; j++) {
    const turn = (best.turn + (j * step) / 8 + 2 * Math.PI) % (2 * Math.PI), s = score(turn, best.half);
    if (s > best.score + 1e-9) best = { ...best, turn, score: s };
  }
  return { turn: best.turn, edges: edgesAt(best.turn, best.half), score: best.score };
}

/**
 * The land of clubs sharing a ground joined up (`list`: prepared pieces, `clubOf`: piece -> club, rewritten; `teams`
 * with their `grounds`). Each sharing club starts on its largest stretch of land of some size at the ground (within a
 * quarter, then half of GROUND_SLACK_KM, then SHARED_SLACK_KM: not a scrap at the ground with its land past another
 * club's), else its stretch nearest it; there on its largest piece of some size at the ground (a cut on the coast can
 * leave a sliver at the ground itself), else its piece nearest it. And it keeps the land hanging together with that
 * (through borders of at least `contactKm`: `borders`, borderKm's): a piece cut off from it goes to the club whose
 * land joined to its own the piece shares the most border with, its team's first; passes until nothing moves, as a
 * piece handed on can join a club's stray pieces to it. A stretch of a team's land no start reaches (an island) goes
 * whole to the club holding most of it. Returns a Map club -> { piece, point, km (its stretch's from the ground) }, or null for
 * a club with no land.
 */
function joinShared(list, clubOf, borders, teams, grounds, contactKm) {
  const sliverKm = Math.max(SLIVER_WIDTH_KM, contactKm / 2), crumbKm2 = crumbKm2Of(contactKm);
  const adjacency = borders.map(map => [...map].filter(([, km]) => km >= contactKm).map(([v]) => v).sort((a, b) => a - b));
  const sharing = new Map(), starts = new Map(); // club -> its first piece; club -> its start
  const largest = pieces => (pieces.length ? pieces.reduce((x, u) => (u.area > x.area ? u : x)) : null);
  teams.forEach((team, t) => {
    if (team.members.length === 1 || !grounds[t]) return;
    const P = grounds[t];
    for (const c of team.members) {
      const own = list.filter((_, i) => clubOf[i] === c);
      if (!own.length) { starts.set(c, null); continue; }
      const km = new Map(own.map(u => [u.index, kmToPolys(P, u.polys)]));
      const stretches = [], seen = new Set();
      for (const u of own) {
        if (seen.has(u.index)) continue;
        const s = { pieces: [], area: 0, km: Infinity }, stack = [u.index];
        seen.add(u.index);
        while (stack.length) {
          const i = stack.pop();
          s.pieces.push(list[i]);
          s.area += list[i].area;
          s.km = Math.min(s.km, km.get(i));
          for (const v of adjacency[i]) if (clubOf[v] === c && !seen.has(v)) { seen.add(v); stack.push(v); }
        }
        stretches.push(s);
      }
      const total = stretches.reduce((sum, s) => sum + s.area, 0);
      const reaching = limit => largest(stretches.filter(s => s.area >= 0.01 * total && s.km <= limit));
      const land = reaching(GROUND_SLACK_KM / 4) ?? reaching(GROUND_SLACK_KM / 2) ?? reaching(SHARED_SLACK_KM) ?? stretches.reduce((x, s) => (s.km < x.km ? s : x));
      // A piece narrower than a sliver (a wedge's edge along a border) is no start: a section grown from it is a line; nor,
      // while its land has larger, is a crumb the map cannot draw (Olympic El Qanah's 0.016 km² at Ismailia, its land over
      // the canal: its home section was that alone, and the game found no point inside it to route from).
      const wide = land.pieces.filter(u => widthKm(u.polys[0]) >= sliverKm);
      const drawable = wide.filter(u => u.area >= crumbKm2);
      const pool = drawable.length ? drawable : wide.length ? wide : land.pieces;
      const within = limit => largest(pool.filter(u => u.area >= 0.01 * land.area && km.get(u.index) <= limit));
      const first = within(GROUND_SLACK_KM / 4) ?? within(GROUND_SLACK_KM / 2) ?? within(SHARED_SLACK_KM) ?? pool.reduce((x, u) => (km.get(u.index) < km.get(x.index) ? u : x));
      starts.set(c, { piece: first.index, point: nearestInside(first.polys, P), km: land.km, crumb: land.area < crumbKm2 });
      sharing.set(c, first.index);
    }
  });
  const teamOf = new Map();
  teams.forEach(team => team.members.forEach(c => teamOf.set(c, team)));
  for (let pass = 0; pass < 12; pass++) {
    const joined = new Uint8Array(list.length);
    clubOf.forEach((c, u) => { if (!sharing.has(c)) joined[u] = 1; });
    for (const [c, first] of sharing) {
      if (clubOf[first] !== c) continue;
      const stack = [first];
      joined[first] = 1;
      while (stack.length) for (const v of adjacency[stack.pop()]) if (clubOf[v] === c && !joined[v]) { joined[v] = 1; stack.push(v); }
    }
    let moved = 0;
    clubOf.forEach((c, u) => {
      if (joined[u]) return;
      const mates = teamOf.get(c)?.members ?? [];
      const along = new Map(), round = new Map();
      for (const [v, km] of borders[u]) {
        const d = clubOf[v];
        if (d === c || !joined[v]) continue;
        const map = mates.includes(d) ? along : round;
        map.set(d, (map.get(d) || 0) + km);
      }
      const to = [...(along.size ? along : round)].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (to != null) { clubOf[u] = to; moved++; }
    });
    if (!moved) break;
  }
  // Land of a team no club's start reaches (an island it was given: Ecuador's Galápagos for Manta's two clubs) goes, each
  // stretch of it whole, to the club holding most of it, so no club's land there lies in two.
  const joined = new Uint8Array(list.length);
  clubOf.forEach((c, u) => { if (!sharing.has(c)) joined[u] = 1; });
  for (const [c, first] of sharing) {
    if (clubOf[first] !== c) continue;
    const stack = [first];
    joined[first] = 1;
    while (stack.length) for (const v of adjacency[stack.pop()]) if (clubOf[v] === c && !joined[v]) { joined[v] = 1; stack.push(v); }
  }
  const done = new Uint8Array(list.length);
  clubOf.forEach((c, u) => {
    if (joined[u] || done[u]) return;
    const team = teamOf.get(c), stretch = [u], held = new Map();
    done[u] = 1;
    for (let q = 0; q < stretch.length; q++) {
      const v = stretch[q];
      held.set(clubOf[v], (held.get(clubOf[v]) || 0) + list[v].area);
      for (const w of borders[v].keys()) if (!joined[w] && !done[w] && team?.members.includes(clubOf[w])) { done[w] = 1; stretch.push(w); }
    }
    const to = [...held].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (const v of stretch) clubOf[v] = to;
  });
  return starts;
}

/**
 * How a split of a team's land (`pieces`: [{ unit, club, cut }]) about its ground P fares, joined up as the split's
 * will be (joinShared): { pieces (joined up), tier (0 when every club holds land within GROUND_SLACK_KM of P, 1 within
 * SHARED_SLACK_KM, 2 when a club's land there is a crumb the map cannot draw, joinShared's, or a club holds under
 * FAIR_FLOOR of its share, else 3), fair (the least club's land per its share, `shares` in `members` order) }. OC
 * Renaissance du Congo, one of three clubs on Kinshasa's one point, had held 9 km² to Les Aigles' 70,000 in a split
 * keeping all three within 0.5 km of it, its six sections crumbs.
 */
function judgeSplit(P, members, shares, pieces, contactKm) {
  const copies = pieces.map(p => ({ ...p.unit }));
  if (pieces.some(p => p.cut)) nodeRings(copies);
  const trial = prepareUnits(copies), borders = borderKm(unitTopology(trial).topo);
  const owners = pieces.map(p => p.club);
  const starts = joinShared(trial, owners, borders, [{ lead: members[0], members }], [P], contactKm);
  const area = trial.reduce((sum, u) => sum + u.area, 0);
  const held = members.map(c => trial.reduce((sum, u, i) => sum + (owners[i] === c ? u.area : 0), 0));
  const reach = Math.max(...members.map(c => starts.get(c)?.km ?? Infinity));
  const crumb = members.some(c => starts.get(c)?.crumb);
  const fair = Math.min(...held.map((h, k) => h / (shares[k] * area)));
  return {
    pieces: pieces.map((p, i) => ({ ...p, club: owners[i] })),
    tier: reach > SHARED_SLACK_KM ? 3 : crumb || fair < FAIR_FLOOR ? 2 : reach <= GROUND_SLACK_KM ? 0 : 1,
    fair,
  };
}

/** The better of two judged splits: every club nearest its ground first, then the fairer. */
const fairer = (a, b) => !b || a.tier < b.tier || (a.tier === b.tier && a.fair > b.fair + 1e-9);

/**
 * A team's land (`units`, prepared) about its shared ground P split between its clubs (`members`, with their
 * `weights`), the fairest of these ways once judged (judgeSplit):
 * - grown: the land swept anticlockwise out of the ground, bending round corners (wayOut), from the widest gap in the
 *   land about it, cut into the clubs' runs by their shares; the clubs grown out from the ground over the grid towards
 *   their runs (growRuns) and the units cut along the cells' borders (regionRings). A strip of the team's land leading
 *   away from the ground (south-west of Kara, to all its land past another club's) is split along its length.
 * - wedges about the ground: at the sweep's cuts, of the clubs' shares of the land by bearing, of their shares of the
 *   land at the ground, and turned to the fairest split on a grid (bestTurn). Clubs that box each other in as they grow
 *   (on a strip of land: Cairo's valley, Alexandria's shore) fare better so.
 * - for three clubs or more, by halves too: the clubs in two sides split the land as two, then each side's land split
 *   again about the same ground (a side can be left only a sliver at the ground to split: Ouagadougou's three).
 * Returns [{ unit, club, cut (a piece of a unit) }].
 */
function splitTeam(P, units, members, weights, contactKm) {
  if (members.length === 1) return units.map(unit => ({ unit, club: members[0], cut: false }));
  const weightSum = weights.reduce((sum, w) => sum + w, 0), shares = weights.map(w => w / weightSum);
  let best = splitWays(P, units, members, shares, contactKm);
  if (members.length > 2) {
    const half = Math.ceil(members.length / 2), sides = [members.slice(0, half), members.slice(half)];
    const weightOf = c => weights[members.indexOf(c)];
    const two = splitTeam(P, units, sides.map(side => side[0]), sides.map(side => side.reduce((sum, c) => sum + weightOf(c), 0)), contactKm);
    const halves = sides.flatMap(side => {
      const own = two.filter(p => p.club === side[0]);
      const cutIds = own.filter(p => p.cut).map(p => p.unit.id);
      return splitTeam(P, prepareUnits(own.map(p => p.unit)), side, side.map(weightOf), contactKm)
        .map(p => ({ ...p, cut: p.cut || cutIds.some(id => p.unit.id === id || p.unit.id.startsWith(`${id}~`)) }));
    });
    const judged = judgeSplit(P, members, shares, halves, contactKm);
    if (fairer(judged, best)) best = judged;
  }
  return best.pieces;
}

/** The fairest of splitTeam's ways for all of a team's clubs at once (`shares` in `members` order), judged. */
function splitWays(P, units, members, shares, contactKm) {
  const m = members.length;
  const kx = Math.cos(P[1] * RAD) * EARTH_KM * RAD, ky = EARTH_KM * RAD;
  const bearing = q => (Math.atan2((q[1] - P[1]) * ky, (q[0] - P[0]) * kx) + 2 * Math.PI) % (2 * Math.PI);
  // The land at the ground: a grid of its points within GROUND_SLACK_KM, by bearing; the sweep starts in its widest gap.
  const near = units.filter(u => boxKm(u.bbox, [P[0], P[1], P[0], P[1]]) <= GROUND_SLACK_KM);
  const local = [];
  for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
    const x = (GROUND_SLACK_KM * i) / 20, y = (GROUND_SLACK_KM * j) / 20, q = [P[0] + x / kx, P[1] + y / ky];
    if ((i || j) && x * x + y * y <= GROUND_SLACK_KM ** 2 && near.some(u => inBox(q, u.bbox) && pointInPolys(q, u.polys))) local.push(bearing(q));
  }
  local.sort((a, b) => a - b);
  let start = 0, gap = -1;
  local.forEach((a, i) => {
    const after = i + 1 < local.length ? local[i + 1] : local[0] + 2 * Math.PI;
    if (after - a > gap) { gap = after - a; start = a + gap / 2; }
  });
  const way = wayOut(P, units, kx, ky, GROUND_SLACK_KM, start);
  const N = way.unitAt.length, M = way.order.length;
  const rd = Math.max(4 * way.cell, GROUND_SLACK_KM);
  // Each club's run of the sweep: its share of the land; the runs' bearings at the ground (from each run's first cell's,
  // as P sees it), for land no way reaches.
  const cuts = [0];
  let before = 0;
  for (let k = 1; k < m; k++) {
    before += shares[k - 1];
    cuts.push(Math.min(M, Math.max(cuts[k - 1], Math.round(M * before))));
  }
  cuts.push(M);
  const edges = [0];
  for (let k = 1; k < m; k++) edges.push(Math.min(2 * Math.PI, Math.max(edges[k - 1] + 1e-6, cuts[k] < M ? way.root[cuts[k]] : 2 * Math.PI)));
  edges.push(2 * Math.PI);
  const runIn = (wedgeEdges, b) => { let k = 0; while (k + 1 < m && b >= wedgeEdges[k + 1]) k++; return k; };
  const label = new Int8Array(N).fill(-1), queue = [];
  for (let k = 0; k < m; k++) for (let q = cuts[k]; q < cuts[k + 1]; q++) label[way.order[q]] = k;
  for (let i = 0; i < N; i++) {
    if (way.unitAt[i] < 0) continue;
    if (label[i] < 0) label[i] = runIn(edges, way.bearing(i));
    queue.push(i);
  }
  growRuns(way, label, m, rd, shares);
  // The land's runs spread to the cells off it (the nearest land's), so the runs' regions tile the grid.
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], c = i % way.nx, r = (i - c) / way.nx;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= way.nx || rr >= way.ny) continue;
      const j = rr * way.nx + cc;
      if (label[j] < 0) { label[j] = label[i]; queue.push(j); }
    }
  }
  // Each club's region but the last's (the rest).
  const toLonLat = ([gx, gy]) => [P[0] + (way.x0 + gx * way.cell) / kx, P[1] + (way.y0 + gy * way.cell) / ky];
  const regions = [];
  for (let k = 0; k < m - 1; k++) {
    const rings = regionRings(label, way.nx, way.ny, k).map(ring => ring.map(toLonLat));
    regions.push(rings.length ? polygonClipping.xor(...rings.map(ring => [ring])) : []);
  }
  // The runs each unit's cells lie in.
  const counts = units.map(() => new Map());
  for (let i = 0; i < N; i++) if (way.unitAt[i] >= 0) { const tally = counts[way.unitAt[i]]; tally.set(label[i], (tally.get(label[i]) || 0) + 1); }
  const clean = list => list.map(poly => poly.map(closeRing).filter(ring => ring.length >= 4)).filter(q => q.length);
  const sliverKm = Math.max(SLIVER_WIDTH_KM, contactKm / 2);
  const grown = (u, index) => {
    const tally = counts[index];
    if (!tally.size) {
      // A unit smaller than a cell: the run of the cell it lies in.
      const [x, y] = interiorPoint(u.polys);
      const c = Math.min(way.nx - 1, Math.max(0, Math.floor(((x - P[0]) * kx - way.x0) / way.cell))), r = Math.min(way.ny - 1, Math.max(0, Math.floor(((y - P[1]) * ky - way.y0) / way.cell)));
      tally.set(label[r * way.nx + c], 1);
    }
    const whole = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    if (tally.size < 2 && boxKm(u.bbox, [P[0], P[1], P[0], P[1]]) > rd) return { parts: [], whole };
    try {
      const parts = [];
      let rest = u.polys;
      for (let k = 0; k < m - 1 && rest.length; k++) {
        if (!regions[k].length) continue;
        parts.push({ k, polys: polygonClipping.intersection(rest, regions[k]) });
        rest = polygonClipping.difference(rest, regions[k]);
      }
      parts.push({ k: m - 1, polys: rest });
      return { parts: absorbSlivers(parts.map(p => ({ ...p, polys: clean(p.polys) })), sliverKm), whole };
    } catch {
      return { parts: [], whole };
    }
  };
  let far = 0;
  for (const u of units) for (const poly of u.polys) for (const q of poly[0]) far = Math.max(far, Math.hypot((q[0] - P[0]) * kx, (q[1] - P[1]) * ky));
  const wedged = (from, wedgeEdges) => {
    const wedges = members.map((_, k) => [wedgeRing(P, from + wedgeEdges[k], from + wedgeEdges[k + 1], 1.2 * far + 1, kx, ky)]);
    return u => {
      const parts = [];
      members.forEach((_, k) => {
        try {
          const polys = clean(polygonClipping.intersection(u.polys, wedges[k]));
          if (polys.length) parts.push({ k, polys });
        } catch { /* left whole below */ }
      });
      return { parts: absorbSlivers(parts, sliverKm), whole: runIn(wedgeEdges, (bearing(interiorPoint(u.polys)) - from + 4 * Math.PI) % (2 * Math.PI)) };
    };
  };
  const byBearing = [];
  for (let i = 0; i < N; i++) if (way.unitAt[i] >= 0) byBearing.push(way.bearing(i));
  byBearing.sort((a, b) => a - b);
  const shareEdges = [0];
  before = 0;
  for (let k = 1; k < m; k++) {
    before += shares[k - 1];
    const at = byBearing[Math.min(byBearing.length - 1, Math.floor(before * byBearing.length))] ?? 2 * Math.PI * before;
    shareEdges.push(Math.min(2 * Math.PI, Math.max(shareEdges[k - 1] + 1e-6, at)));
  }
  shareEdges.push(2 * Math.PI);
  // And wedges of the clubs' shares of the land at the ground (within SHARED_SLACK_KM), so each holds some of it however
  // little there is (a fan's narrow sector at Charléty, Paris FC's and Red Star's, its land 50 km out round Dreux).
  const atGround = [];
  for (let i = 0; i < N; i++) if (way.unitAt[i] >= 0 && way.km(i) <= SHARED_SLACK_KM) atGround.push(way.bearing(i));
  const nearBearings = (atGround.length >= 2 * m ? atGround : local.map(b => (b - start + 4 * Math.PI) % (2 * Math.PI))).sort((a, b) => a - b);
  const localEdges = [0];
  before = 0;
  for (let k = 1; k < m; k++) {
    before += shares[k - 1];
    const j = Math.min(nearBearings.length - 1, Math.max(1, Math.round(before * nearBearings.length)));
    const at = nearBearings.length >= m ? (nearBearings[j - 1] + nearBearings[j]) / 2 : 2 * Math.PI * before;
    localEdges.push(Math.min(2 * Math.PI, Math.max(localEdges[k - 1] + 1e-6, at)));
  }
  localEdges.push(2 * Math.PI);
  const ways = [grown, wedged(start, edges), wedged(start, shareEdges), wedged(start, localEdges)];
  const grid = teamGrid(P, units, kx, ky);
  const turned = bestTurn(grid, m, shares, Math.max(2 * grid.cell, GROUND_SLACK_KM));
  if (turned.score >= 0) ways.push(wedged(turned.turn, turned.edges));
  let best = null;
  for (const cutOf of ways) {
    const pieces = [];
    units.forEach((u, index) => {
      const { parts, whole } = cutOf(u, index);
      if (parts.length < 2) {
        pieces.push({ unit: u, club: members[parts.length ? parts[0].k : whole], cut: false });
        return;
      }
      const base = u.baseName ?? u.name;
      for (const p of parts) {
        const pc = centroidOf(p.polys);
        const dir = COMPASS[((Math.round(Math.atan2((pc[1] - P[1]) * ky, (pc[0] - P[0]) * kx) / (Math.PI / 4)) % 8) + 8) % 8];
        for (const v of explodeUnits([{ ...u, id: `${u.id}~s${p.k}`, name: `${base} (${dir})`, baseName: base, qualifier: dir, polys: p.polys }], () => nearestInside(p.polys, P))) {
          pieces.push({ unit: v, club: members[p.k], cut: true });
        }
      }
    });
    const judged = judgeSplit(P, members, shares, pieces, contactKm);
    if (fairer(judged, best)) best = judged;
  }
  return best;
}

/**
 * A team's land (`owner`: unit -> team) split between its clubs about their shared ground (splitTeam); elsewhere a
 * club's land is its team's. The pieces cut are noded with their neighbours, and the sharing clubs' land joined up
 * (joinShared). Returns { units, owner: unit -> club, seedUnit, seedPoint (per club), splits }.
 */
function splitShared(units, owner, seedUnit, seedPoint, teams, grounds, n, weightOf = () => 1) {
  const contactKm = contactKmOf(units);
  const next = [], clubOf = [], cut = [], splits = [];
  const startId = new Array(n), startPoint = new Array(n);
  const mine = teams.map(() => []);
  owner.forEach((t, u) => mine[t].push(units[u]));
  teams.forEach((team, t) => {
    if (team.members.length === 1 || !grounds[t]) {
      for (const u of mine[t]) { next.push(u); clubOf.push(team.lead); }
      for (const c of team.members) { startId[c] = units[seedUnit[t]].id; startPoint[c] = seedPoint[t]; }
      return;
    }
    let pieces = 0;
    for (const p of splitTeam(grounds[t], mine[t], team.members, team.members.map(c => weightOf(c)), contactKm)) {
      next.push(p.unit);
      clubOf.push(p.club);
      if (p.cut) { cut.push(p.unit); pieces++; }
    }
    if (pieces) splits.push({ unit: units[seedUnit[t]].baseName ?? units[seedUnit[t]].name, source: baseId(units[seedUnit[t]].id), pieces, clubs: team.members.length, reason: `${team.members.length} clubs' shared ground` });
  });
  if (cut.length) {
    const boxes = cut.map(v => bboxOf(v.polys));
    const hits = (a, b) => !(a[0] > b[2] + 1e-6 || a[2] < b[0] - 1e-6 || a[1] > b[3] + 1e-6 || a[3] < b[1] - 1e-6);
    nodeRings(next.filter(v => cut.includes(v) || boxes.some(b => hits(bboxOf(v.polys), b))));
  }
  const list = prepareUnits(next);
  const { topo } = unitTopology(list);
  // Land across narrow water joins as the partition's does (joinWater; none while WATER_KM is 0).
  const borders = borderKm(topo);
  joinWater(list, topo, borders.map(map => [...map.keys()]), WATER_KM).forEach((near, u) => {
    for (const v of near) if (!borders[u].has(v)) borders[u].set(v, contactKm);
  });
  const starts = joinShared(list, clubOf, borders, teams, grounds, contactKm);
  for (const [c, s] of starts) {
    if (!s) throw new Error(`No land for club #${c + 1} at its shared ground`);
    startId[c] = list[s.piece].id;
    startPoint[c] = s.point;
  }
  const indexOf = new Map(list.map(u => [u.id, u.index]));
  return { units: list, owner: clubOf, seedUnit: startId.map(id => indexOf.get(id)), seedPoint: startPoint, splits };
}

// ---- Grounds in their clubs' land ----

// A hole a boundary layer leaves inside the country this size, its towns this many people a km², is a city it lost
// (holeUnits); a lake's holds one shore town at most a few hundred a km².
const HOLE_MIN_KM2 = 5;
const HOLE_MAX_KM2 = 5000;
const HOLE_DENSITY = 1000;

/**
 * Land a boundary layer leaves out inside the country, a hole its units ring round (Bishkek, a region of its own, is
 * missing from Kyrgyzstan's districts, though Chüy Region around it has it): each hole of HOLE_MIN_KM2 to HOLE_MAX_KM2
 * whose places no unit holds (`places`: { lon, lat, pop }) count at least HOLE_DENSITY people a km² of it joins as a
 * unit, its `town` the most populous of them, wound as the units are, so the clubs of that city play on it: Bishkek
 * 5,300 a km², Moscow's Zelenograd 5,900. A lake stays out: a shore town's point can lie in it, but Lake Tana holds 113
 * people a km² of Bahir Dar, Lake Manzala 208 of Al Matariyah. Returns the new units, { id, town, polys }.
 */
export function holeUnits(units, places) {
  if (!units.length) return [];
  const topo = topology({ units: unitCollection(units) });
  const whole = merge(topo, topo.objects.units.geometries);
  const boxes = units.map(u => bboxOf(u.polys));
  const sign = Math.sign(ringAreaKm2(units[0].polys[0][0])) || 1;
  const out = [];
  for (const poly of whole.coordinates) for (const ring of poly.slice(1)) {
    const km2 = Math.abs(ringAreaKm2(ring));
    if (km2 < HOLE_MIN_KM2 || km2 > HOLE_MAX_KM2) continue;
    const box = bboxOf([[ring]]);
    const towns = places.filter(p => inBox([p.lon, p.lat], box) && pointInRing([p.lon, p.lat], ring)
      && !units.some((u, i) => inBox([p.lon, p.lat], boxes[i]) && pointInPolys([p.lon, p.lat], u.polys)));
    if (!towns.length || towns.reduce((t, p) => t + p.pop, 0) < HOLE_DENSITY * km2) continue;
    const town = towns.reduce((a, b) => (b.pop > a.pop || (b.pop === a.pop && b.id < a.id) ? b : a));
    out.push({ id: `hole-${out.length}`, town, polys: [[Math.sign(ringAreaKm2(ring)) === sign ? ring : [...ring].reverse()]] });
  }
  return out;
}

/**
 * Whether a point lies within `km` of any of `points` ([lon, lat]): for a map's simplification to keep the borders about
 * its grounds where they are (a border near a ground moved across it by simplification would leave the ground in its
 * neighbour's land: Galatasaray's, by Beşiktaş's, in the Top 124 of 2022/23).
 */
export function withinKmOf(points, km) {
  const cell = km / (EARTH_KM * RAD), grid = new Map();
  const key = (ix, iy) => `${ix},${iy}`;
  for (const p of points) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return q => {
    // A degree of longitude is shorter than one of latitude: look as many cells east and west as that takes.
    const span = Math.ceil(1 / Math.max(0.05, Math.cos(q[1] * RAD)));
    const ix = Math.floor(q[0] / cell), iy = Math.floor(q[1] / cell);
    for (let dx = -span; dx <= span; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of grid.get(key(ix + dx, iy + dy)) || []) if (kmBetween(p, q) <= km) return true;
    }
    return false;
  };
}

/** A test for points within `eps` degrees of one of `points` (simplifyTopology's `keep`: grounds stay where they are). */
export function nearPoints(points, eps = 1e-7) {
  const cell = 1e-3, grid = new Map();
  for (const p of points) {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  return ([x, y]) => {
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of grid.get(`${ix + dx},${iy + dy}`) || []) if (Math.abs(p[0] - x) <= eps && Math.abs(p[1] - y) <= eps) return true;
    }
    return false;
  };
}

// A club's ground may stand this far outside its land as drawn: simplified borders move by a few dozen metres (the
// Estádio da Luz). Clubs sharing a ground (SAME_GROUND_KM: mostly a town point the sources give several clubs, not a
// stadium) each hold land within SHARED_SLACK_KM of it, as they split the land about it (splitShared).
export const GROUND_SLACK_KM = 0.5;
export const SHARED_SLACK_KM = 2;

/** Shortest distance from a point to a lon/lat box (0 inside), a lower bound for kmToPolys. */
function kmToBox(p, b) {
  const dx = Math.max(b[0] - p[0], 0, p[0] - b[2]) * Math.cos(Math.min(85, Math.abs(p[1])) * RAD) * EARTH_KM * RAD;
  const dy = Math.max(b[1] - p[1], 0, p[1] - b[3]) * EARTH_KM * RAD;
  return Math.hypot(dx, dy) * 0.98;
}

/**
 * Whether club `c`'s land holds its ground `home` (the user, 2026-11-21: "a territory needs to own the part of the map
 * where their city and stadium is in"): the ground lies in its land or within `slack` of it (GROUND_SLACK_KM, or for a
 * ground the club shares SHARED_SLACK_KM), or, standing on no club's land (a coast drawn coarser than the ground stands, a
 * ground across a border), no other club's land lies nearer it by more than that (clubs sharing a ground off the land
 * share the land about the nearest point of land, partitionCountry).
 * `lands` are every club's { polys, box } (box: bboxOf(polys)). Returns null when it holds, else { km: from the ground to
 * the club's land, holder: the club whose land holds the ground or lies nearer it }.
 */
export function groundProblem(home, c, lands, slack = GROUND_SLACK_KM) {
  const own = lands[c];
  const km = inBox(home, own.box) && pointInPolys(home, own.polys) ? 0 : kmToPolys(home, own.polys);
  if (km <= slack) return null;
  const holder = lands.findIndex((land, d) => d !== c && inBox(home, land.box) && pointInPolys(home, land.polys));
  if (holder >= 0) return { km, holder };
  let nearest = -1, nearestKm = km - slack;
  lands.forEach((land, d) => {
    if (d === c || kmToBox(home, land.box) >= nearestKm) return;
    const k = kmToPolys(home, land.polys);
    if (k < nearestKm) { nearestKm = k; nearest = d; }
  });
  return nearest >= 0 ? { km, holder: nearest } : null;
}

// ---- Dissolve, filter, simplify ----

const ringCoords = (topo, ring) => feature(topo, { type: 'Polygon', arcs: [ring] }).geometry.coordinates[0];

/** One dissolved geometry per section, built on the unit topology so borders stay shared. */
export function dissolve(topo, owner, count, units = null) {
  const geoms = topo.objects.units.geometries;
  const bySection = Array.from({ length: count }, () => []), members = Array.from({ length: count }, () => []);
  owner.forEach((club, u) => { bySection[club].push(geoms[u]); members[club].push(u); });
  return bySection.map((list, k) => {
    const merged = feature(topo, mergeArcs(topo, list)).geometry;
    const fixed = untangle(merged);
    if (fixed === merged || !units || members[k].every(u => pointInPolys(interiorPoint(units[u].polys), polysOf(fixed)))) return fixed;
    // Units that overlap (two walk one border the same way: Livornio over Beekhuizen in Suriname's resorts) leave the
    // merge no outline to stitch; their union instead.
    return { type: 'MultiPolygon', coordinates: polygonClipping.union(...members[k].map(u => units[u].polys)) };
  });
}

/**
 * A merged section's rings set right where its land touches itself at a point: mergeArcs stitches the rings that meet
 * there into one and keeps one outline per piece, every other ring a hole, so a pocket of land touching the edge of a
 * hole at a corner was drawn as part of the hole (SV Leo Victor's Beekhuizen, Livornio and Pontibuiten, beside
 * Paramaribo's other clubs, on Suriname's maps of 1995/96 and 1996/97). Rings are split where a vertex repeats into
 * simple loops, those wound as the section's largest ring are land and the others holes, each hole in the smallest
 * land holding it. A geometry with no such ring is returned as it is (the same object).
 */
function untangle(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const area = ring => {
    let sum = 0;
    for (let i = 0; i + 1 < ring.length; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return sum / 2;
  };
  const repeats = ring => {
    const seen = new Set();
    for (let i = 0; i + 1 < ring.length; i++) {
      const k = `${ring[i][0]},${ring[i][1]}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };
  const odd = polys.some(poly => poly.some((ring, r) => repeats(ring) || (r > 0 && Math.sign(area(ring)) === Math.sign(area(poly[0])))));
  if (!odd) return geometry;
  const loops = [];
  for (const poly of polys) for (const ring of poly) {
    // The walk so far; a vertex met again closes the loop walked since it.
    const walk = [], at = new Map();
    for (let i = 0; i + 1 < ring.length; i++) {
      const p = ring[i], k = `${p[0]},${p[1]}`;
      if (at.has(k)) {
        const loop = walk.splice(at.get(k));
        for (const q of loop) at.delete(`${q[0]},${q[1]}`);
        if (loop.length >= 3) loops.push([...loop, loop[0]]);
      }
      at.set(k, walk.length);
      walk.push(p);
    }
    if (walk.length >= 3) loops.push([...walk, walk[0]]);
  }
  const largest = loops.reduce((x, loop) => (Math.abs(area(loop)) > Math.abs(area(x)) ? loop : x), loops[0]);
  const sign = Math.sign(area(largest));
  const lands = loops.filter(loop => area(loop) * sign > 0).map(ring => ({ ring, a: Math.abs(area(ring)), holes: [] }));
  for (const hole of loops.filter(loop => area(loop) * sign < 0)) {
    const p = interiorPoint([[hole]]);
    const home = lands.filter(land => pointInRing(p, land.ring)).sort((x, y) => x.a - y.a)[0];
    if (home) home.holes.push(hole);
  }
  return { type: 'MultiPolygon', coordinates: lands.map(land => [land.ring, ...land.holes]) };
}

function arcUse(topo) {
  const use = new Map();
  for (const g of topo.objects.sections.geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    for (const poly of polys) for (const ring of poly) for (const a of ring) {
      const k = a < 0 ? ~a : a;
      use.set(k, (use.get(k) || 0) + 1);
    }
  }
  return use;
}

/** Keep only referenced arcs, renumbered in first-use order. */
function pruneArcs(topo) {
  const map = new Map();
  const arcs = [];
  const remap = a => {
    const k = a < 0 ? ~a : a;
    if (!map.has(k)) { map.set(k, arcs.length); arcs.push(topo.arcs[k]); }
    const j = map.get(k);
    return a < 0 ? ~j : j;
  };
  for (const g of topo.objects.sections.geometries) {
    g.arcs = g.type === 'Polygon' ? g.arcs.map(r => r.map(remap)) : g.arcs.map(p => p.map(r => r.map(remap)));
  }
  topo.arcs = arcs;
  return topo;
}

/**
 * Section topology from dissolved geometries. Drops islets and holes smaller than
 * `minAreaKm2` when no other section touches them, unless they hold a club home;
 * a section always keeps its largest polygon.
 */
export function sectionTopology(sectionGeoms, { ids, names, unitCounts, minAreaKm2, keepPoints }) {
  const fc = {
    type: 'FeatureCollection',
    features: sectionGeoms.map((geometry, i) => ({ type: 'Feature', id: ids[i], properties: { name: names[i], units: unitCounts[i] }, geometry })),
  };
  const topo = topology({ sections: fc });
  const use = arcUse(topo);
  const exclusive = ring => ring.every(a => use.get(a < 0 ? ~a : a) === 1);
  let droppedPolys = 0, droppedHoles = 0, droppedKm2 = 0;
  for (const g of topo.objects.sections.geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    const areas = polys.map(poly => Math.abs(ringAreaKm2(ringCoords(topo, poly[0]))));
    const largest = areas.indexOf(Math.max(...areas));
    const kept = [];
    polys.forEach((poly, i) => {
      const outer = ringCoords(topo, poly[0]);
      const holdsHome = keepPoints.some(p => pointInRing(p, outer));
      if (i !== largest && areas[i] < minAreaKm2 && !holdsHome && poly.every(exclusive)) {
        droppedPolys++; droppedKm2 += areas[i];
        return;
      }
      kept.push([poly[0], ...poly.slice(1).filter(hole => {
        const coords = ringCoords(topo, hole);
        const a = Math.abs(ringAreaKm2(coords));
        if (a < minAreaKm2 && exclusive(hole) && !keepPoints.some(p => pointInRing(p, coords))) { droppedHoles++; droppedKm2 -= a; return false; }
        return true;
      })]);
    });
    if (kept.length === 1) { g.type = 'Polygon'; g.arcs = kept[0]; } else { g.type = 'MultiPolygon'; g.arcs = kept; }
  }
  return { topo: pruneArcs(topo), droppedPolys, droppedHoles, droppedKm2 };
}

const arcPoints = topo => topo.arcs.reduce((s, a) => s + a.length, 0);

/** Distance across water that still reads as touching: three pixels at the opening fit (960 × 540). */
export function facingKm([w, s, e, n]) {
  const mid = (s + n) / 2;
  return Math.max(1, 3 * Math.max(kmBetween([w, mid], [e, mid]) / 960, kmBetween([w, s], [w, n]) / 540));
}

/**
 * Sections whose borders come within `km` of each other with no other section between
 * them (the midpoint of the closest points lies on none of the others): the shores of a
 * strait or a river mouth, or corners that touch without a shared arc. They look like
 * neighbours on the map, so they must differ in colour too. Returns per section the
 * indices of such sections (shared-arc neighbours may be among them).
 */
export function facingSections(sectionPolys, km) {
  const ky = EARTH_KM * RAD;
  const all = sectionPolys.flatMap(polys => polys.flatMap(poly => poly[0]));
  const kx = ky * Math.cos((all.reduce((s, p) => s + p[1], 0) / Math.max(1, all.length)) * RAD);
  const cx = km / kx, cy = km / ky;
  const cells = new Map();
  const key = (x, y) => `${x},${y}`;
  sectionPolys.forEach((polys, i) => polys.forEach(poly => poly.forEach(ring => {
    for (let k = 0; k < ring.length - 1; k++) {
      const a = ring[k], b = ring[k + 1];
      for (let x = Math.floor(Math.min(a[0], b[0]) / cx); x <= Math.floor(Math.max(a[0], b[0]) / cx); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / cy); y <= Math.floor(Math.max(a[1], b[1]) / cy); y++) {
          if (!cells.has(key(x, y))) cells.set(key(x, y), []);
          cells.get(key(x, y)).push([i, a, b]);
        }
      }
    }
  })));
  const best = new Map();
  sectionPolys.forEach((polys, i) => polys.forEach(poly => poly.forEach(ring => ring.forEach(p => {
    const x0 = Math.floor(p[0] / cx), y0 = Math.floor(p[1] / cy);
    for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (const [j, a, b] of cells.get(key(x, y)) || []) {
        if (j === i) continue;
        const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * ky, len = ex * ex + ey * ey;
        const t = len ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len)) : 0;
        const d = Math.hypot(ax + t * ex, ay + t * ey);
        const pair = i < j ? `${i},${j}` : `${j},${i}`;
        if (d <= km && (!best.has(pair) || d < best.get(pair).d)) best.set(pair, { d, p, q: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] });
      }
    }
  }))));
  const boxes = sectionPolys.map(bboxOf);
  const out = sectionPolys.map(() => []);
  for (const [pair, { p, q }] of [...best].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [i, j] = pair.split(',').map(Number);
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (sectionPolys.some((polys, k) => k !== i && k !== j && inBox(mid, boxes[k]) && pointInPolys(mid, polys))) continue;
    out[i].push(j);
    out[j].push(i);
  }
  return out.map(list => list.sort((a, b) => a - b));
}

/**
 * Visvalingam simplification to about `target` arc points. Shared arcs are
 * simplified once, so borders stay identical on both sides; every ring keeps at
 * least four distinct vertices so small sections cannot collapse. Points `keep([x, y])` picks always stay.
 */
export function simplifyTopology(topo, target, keep = null) {
  const weighted = presimplify(topo);
  if (keep) for (const arc of weighted.arcs) for (const p of arc) if (keep(p)) p[2] = Infinity;
  const interior = [];
  for (const arc of weighted.arcs) for (let i = 1; i < arc.length - 1; i++) interior.push(arc[i][2]);
  const fixed = weighted.arcs.reduce((s, a) => s + Math.min(2, a.length), 0);
  interior.sort((a, b) => b - a);
  const room = Math.max(0, target - fixed);
  const minWeight = room >= interior.length ? -Infinity : interior[room];
  const keepOf = p => p[2] > minWeight || p[2] === Infinity;
  // Protect rings that would fall below four distinct points.
  const polysOfGeom = g => (g.type === 'Polygon' ? [g.arcs] : g.arcs);
  for (const g of weighted.objects.sections.geometries) {
    for (const poly of polysOfGeom(g)) for (const ring of poly) {
      const pts = ring.flatMap(a => { const arc = weighted.arcs[a < 0 ? ~a : a]; return arc.slice(0, -1); });
      const distinct = new Set(pts.filter(keepOf).map(p => `${p[0]},${p[1]}`));
      if (distinct.size >= 4) continue;
      const candidates = pts.filter(p => !keepOf(p)).sort((a, b) => b[2] - a[2]);
      for (const p of candidates) {
        if (distinct.size >= 4) break;
        const k = `${p[0]},${p[1]}`;
        if (distinct.has(k)) continue;
        p[2] = Infinity;
        distinct.add(k);
      }
    }
  }
  const arcs = weighted.arcs.map(arc => arc.filter(keepOf).map(p => [p[0], p[1]]));
  return { type: 'Topology', objects: topo.objects, arcs };
}

export { arcPoints, quantize };
