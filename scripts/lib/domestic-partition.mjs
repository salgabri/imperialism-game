// Section partition for domestic campaigns (docs/design/domestic-campaigns.md,
// "Section partition"): admin units plus club home points become one section per
// club, dissolved into a TopoJSON whose neighbouring sections share arcs.
// Beyond the spec's steps (partitionCountry runs them in order): multi-part units
// are exploded into single polygons so sections stay contiguous, a unit shared by
// clubs is also cut when seeding would push one of them far from home, and growth
// is bounded so empty land goes to the nearest clubs (see splitUnits, growSections).
// Everything here is deterministic: iteration follows array order and every
// choice has an explicit tie-break.
import { topology } from 'topojson-server';
import { feature, mergeArcs, neighbors, quantize } from 'topojson-client';
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
    if (u.polys.length < 2) return [u];
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
 * by cos(latitude), then mapped back to lon/lat) intersected with the unit.
 */
function cutUnit(unit, sites) {
  const scale = Math.cos(((unit.bbox[1] + unit.bbox[3]) / 2) * RAD);
  const pad = 1;
  const delaunay = Delaunay.from(sites.map(([x, y]) => [x * scale, y]));
  const voronoi = delaunay.voronoi([(unit.bbox[0] - pad) * scale, unit.bbox[1] - pad, (unit.bbox[2] + pad) * scale, unit.bbox[3] + pad]);
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
 * Each club of a cut unit gets the piece of its own site, so clubs sharing one town
 * point still start side by side; a unit cut for its clubs is never cut again.
 * Updates `homeOf[i].unit`; returns the new unit list and a record of each split.
 */
export function splitUnits(units, homeOf, n, { maxGapKm = Infinity, minKm2 = 0, log = () => {} } = {}) {
  let list = units.map(u => ({ ...u })); // nodeRings rewrites rings of the units it touches
  const splits = [];
  const crowdCut = new Set(); // pieces of a unit cut for its clubs: never cut for clubs again
  const failed = new Set(); // units the cutter could not split
  // Units are re-indexed after every cut; clubs follow their unit by id.
  const unitIdOf = homeOf.map(h => (h && h.unit != null ? list[h.unit].id : null));
  for (;;) {
    const clubsIn = clubsByUnit(homeOf);
    let pick = null;
    if (list.filter(u => u.area >= minKm2).length < n) {
      for (const u of list) {
        const k = (clubsIn.get(u.index) || []).length;
        if (k < 2 || crowdCut.has(u.id) || failed.has(u.id)) continue;
        if (!pick || k > pick.k || (k === pick.k && u.area > pick.u.area)) pick = { u, k, crowd: true, why: `${k} clubs` };
      }
      if (!pick) {
        for (const u of list) if (!failed.has(u.id) && (!pick || u.area > pick.u.area)) pick = { u, k: 0, crowd: false, why: 'largest unit' };
        if (!pick) throw new Error('No unit can be split further');
      }
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
    let sites = crowd ? crowdSites(points, u) : kmeans(interiorSamples(u), 2, scale);
    let pieces;
    try {
      pieces = cutUnit(u, sites);
    } catch (error) {
      log(`    split of ${u.name} failed: ${error.message}`);
      failed.add(u.id);
      continue;
    }
    if (pieces.length < 2) { failed.add(u.id); continue; }
    // A club whose own piece starts beyond the gap limit: try the fan, keep it if it is closer.
    const worstGap = list => Math.max(...points.map((p, j) => {
      const own = list.find(piece => piece.site === j);
      return own ? kmToPolys(p, own.polys) : Infinity;
    }));
    let why = pick.why;
    if (crowd && maxGapKm < Infinity && worstGap(pieces) > maxGapKm) {
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
      return explodeUnits([{ id: `${u.id}~${p.i}`, name, baseName: base, qualifier, polys: p.polys }], () => sites[p.site]);
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
    if (crowd) {
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
export function seedSections(units, adjacency, homes, { minKm2 = 0 } = {}) {
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
    const near = adjacency[h.unit].filter(v => owner[v] < 0);
    const all = units.map((_, v) => v).filter(v => owner[v] < 0);
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
 * { owner: unit -> club, seedUnit: club -> unit }.
 */
export function growSections(units, adjacency, homes, { reach = REACH, padKm = grainKm(units), minKm2 = 0 } = {}) {
  const n = homes.length;
  const { owner, seedUnit, seedPoint } = seedSections(units, adjacency, homes, { minKm2 });
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
  const reachOf = club => (homes[club]?.placed ? 1 : reach);
  const area = seedUnit.map(u => units[u].area);
  const frontier = seedUnit.map(u => new Set(adjacency[u]));
  let left = owner.filter(o => o < 0).length;
  const take = (club, u) => {
    owner[u] = club;
    area[club] += units[u].area;
    for (const v of adjacency[u]) if (owner[v] < 0) frontier[club].add(v);
    left--;
  };
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
    order.sort((a, b) => area[a] - area[b] || a - b);
    let grown = false;
    for (const club of order) {
      const u = pickBy([...frontier[club]].filter(v => stretch(club, v) <= reachOf(club)), v => near(v, seedPoint[club]));
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
        const k = stretch(club, u);
        if (!best || k < best.k || (k === best.k && (area[club] < area[best.club] || (area[club] === area[best.club] && (club < best.club || (club === best.club && u < best.u)))))) best = { k, club, u };
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
   * nearest hop, or that plus `seaStep`). As on land the claim must be within reach,
   * the nearest such land winning; with none in reach the least stretched claim wins.
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
    for (const [club, d] of [...hop].sort((a, b) => a[0] - b[0])) {
      const k = stretch(club, u), ok = k <= reachOf(club);
      const better = !best || (ok !== best.ok ? ok
        : ok ? d < best.d || (d === best.d && club < best.club)
          : k < best.k || (k === best.k && (d < best.d || (d === best.d && club < best.club))));
      if (better) best = { club, d, k, ok };
    }
    return best.club;
  }
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
 * (placeClubs; `placed` returns the place per club). Longitudes come back shifted
 * when the country crosses the antimeridian.
 */
export function partitionCountry(rawUnits, rawHomes, { maxGapKm, reach, places = [], log = () => {} } = {}) {
  const n = rawHomes.length;
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
  let { adjacency } = unitTopology(units);
  const overseas = dropOverseas(units, adjacency, homes);
  const dropped = [...new Set(overseas.dropped.map(u => u.name))].sort();
  if (dropped.length) {
    log(`  dropped ${dropped.length} overseas units: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ', ...' : ''}`);
    // What stays decides the frame: the USA without the Aleutians needs no shift.
    const kept = overseas.keep.map(u => rawUnits[u.index]);
    shift = needsShift(kept);
    units = frame(kept, shift);
    homes = homesIn(shift);
    ({ adjacency } = unitTopology(units));
  }
  const sourceUnits = new Set(units.map(u => baseId(u.id))).size;
  const sourceAreaKm2 = units.reduce((s, u) => s + u.area, 0);
  const located = locateHomes(units, homes);
  const homeOf = located.map((l, i) => (l.unit == null ? null : { unit: l.unit, point: homes[i] }));
  const framed = places.map(p => ({ ...p, lon: shift ? shiftLon(p.lon) : p.lon, source: p }));
  const placed = placeClubs(units, homeOf, framed, { spacingKm: 0.5 * Math.sqrt(sourceAreaKm2 / n) }).map(p => p && p.source);
  homes = homes.map((h, i) => (placed[i] ? homeOf[i].point : h));
  if (placed.some(Boolean)) log(`  placed ${placed.filter(Boolean).length} clubs without a home: ${placed.map((p, i) => (p ? `#${i + 1} at ${p.name}` : null)).filter(Boolean).join(', ')}`);
  const limit = maxGapKm ?? gapLimitKm(units);
  const padKm = grainKm(units);
  const minKm2 = 0.01 * padKm ** 2; // a hundredth of a median unit: smaller parts are slivers
  let splits;
  ({ units, splits } = splitUnits(units, homeOf, n, { maxGapKm: limit, minKm2, log }));
  const { topo, adjacency: unitAdjacency } = unitTopology(units);
  const { owner, seedUnit, seedPoint } = growSections(units, unitAdjacency, homeOf, { reach, padKm, minKm2 });
  return {
    shift, units, adjacency: unitAdjacency, topo, homes, homeOf, located, placed, dropped, splits,
    sourceUnits, sourceAreaKm2, maxGapKm: limit, owner, seedUnit, seedPoint,
  };
}

// ---- Dissolve, filter, simplify ----

const ringCoords = (topo, ring) => feature(topo, { type: 'Polygon', arcs: [ring] }).geometry.coordinates[0];

/** One dissolved geometry per section, built on the unit topology so borders stay shared. */
export function dissolve(topo, owner, count) {
  const geoms = topo.objects.units.geometries;
  const bySection = Array.from({ length: count }, () => []);
  owner.forEach((club, u) => bySection[club].push(geoms[u]));
  return bySection.map(list => feature(topo, mergeArcs(topo, list)).geometry);
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
 * least four distinct vertices so small sections cannot collapse.
 */
export function simplifyTopology(topo, target) {
  const weighted = presimplify(topo);
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
