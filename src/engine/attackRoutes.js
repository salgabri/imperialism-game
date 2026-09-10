// Exact checks against the same nonzero-winding land painted by the map.
// Prepared geography is independent of ownership and shared between draw
// snapshots; only a new fit/paths object needs to rebuild it.
const indexes = new WeakMap();
const ROUNDING = 64 * Number.EPSILON;

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const clampUnit = n => Math.max(0, Math.min(1, n));

/** Deeply immutable, cached snapshot of every painted country, including neutrals. */
export function createAttackRouteIndex(paths) {
  if (!paths || typeof paths !== 'object') return null;
  if (indexes.has(paths)) return indexes.get(paths);
  const countries = [];
  for (const [countryId, path] of Object.entries(paths)) {
    const rings = [];
    const edges = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const source of path?.labelRings || []) {
      if (!Array.isArray(source) || source.length < 3 ||
        source.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
      const ring = source.map(([x, y]) => Object.freeze([x, y]));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        minX = Math.min(minX, a[0]); minY = Math.min(minY, a[1]);
        maxX = Math.max(maxX, a[0]); maxY = Math.max(maxY, a[1]);
        if (a[0] !== b[0] || a[1] !== b[1]) edges.push(Object.freeze([a[0], a[1], b[0], b[1]]));
      }
      rings.push(Object.freeze(ring));
    }
    if (!rings.length) continue;
    countries.push(Object.freeze({ countryId, rings: Object.freeze(rings), edges: Object.freeze(edges),
      bounds: Object.freeze({ minX, minY, maxX, maxY }) }));
  }
  // Point-only rule fixtures have no painted land to inspect. Production maps
  // always have labelRings; callers explicitly retain their point-only fallback.
  const index = countries.length ? Object.freeze({ countries: Object.freeze(countries) }) : null;
  indexes.set(paths, index);
  return index;
}

function windingAt(country, x, y, nx = 0, ny = 0) {
  let winding = 0;
  for (const [ax, ay, bx, by] of country.edges) {
    const ex = bx - ax, ey = by - ay, px = x - ax, py = y - ay;
    let side = cross(ex, ey, px, py);
    const tolerance = ROUNDING * (Math.abs(ex * py) + Math.abs(ey * px));
    // Symbolic infinitesimal offset: unlike a sampled epsilon this cannot jump
    // over a narrow neighboring ring when classifying a collinear boundary.
    if (Math.abs(side) <= tolerance) side = cross(ex, ey, nx, ny);
    const aBelow = ay < y || (ay === y && ny >= 0);
    const bAbove = by > y || (by === y && ny < 0);
    if (aBelow && bAbove && side > 0) winding++;
    if (!aBelow && !bAbove && side < 0) winding--;
  }
  return winding;
}

function interiorAt(country, x, y, dx, dy) {
  for (const [ax, ay, bx, by] of country.edges) {
    const ex = bx - ax, ey = by - ay, px = x - ax, py = y - ay;
    const side = cross(ex, ey, px, py);
    // Contact along a border is not a crossing of land. This machine-scale
    // bound handles midpoint roundoff without a map-scale sampling tolerance.
    const tolerance = ROUNDING * (Math.abs(ex * py) + Math.abs(ey * px));
    if (Math.abs(side) <= tolerance && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) && y <= Math.max(ay, by)) {
      // Both sides must be painted. This excludes actual coastlines, but keeps
      // internal edges of overlapping/same-winding rings inside filled land.
      return windingAt(country, x, y, -dy, dx) !== 0 && windingAt(country, x, y, dy, -dx) !== 0;
    }
  }
  return windingAt(country, x, y) !== 0;
}

function countryIntervals(country, ax, ay, dx, dy, lengthSquared) {
  const cuts = [0, 1];
  for (const [ex, ey, fx, fy] of country.edges) {
    const sx = fx - ex, sy = fy - ey, qx = ex - ax, qy = ey - ay;
    const denominator = cross(dx, dy, sx, sy);
    const parallelTolerance = ROUNDING * (Math.abs(dx * sy) + Math.abs(dy * sx));
    if (Math.abs(denominator) <= parallelTolerance) {
      const offset = cross(qx, qy, dx, dy);
      const collinearTolerance = ROUNDING * (Math.abs(qx * dy) + Math.abs(qy * dx));
      if (Math.abs(offset) <= collinearTolerance) {
        // Split at both ends of an overlapping edge. Midpoint winding below
        // distinguishes true interior from merely travelling along a coastline.
        for (const [x, y] of [[ex, ey], [fx, fy]]) {
          const t = ((x - ax) * dx + (y - ay) * dy) / lengthSquared;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
      continue;
    }
    const t = cross(qx, qy, sx, sy) / denominator;
    const u = cross(qx, qy, dx, dy) / denominator;
    if (t >= -ROUNDING && t <= 1 + ROUNDING && u >= -ROUNDING && u <= 1 + ROUNDING) cuts.push(clampUnit(t));
  }
  cuts.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1], end = cuts[i];
    if (!(end > start)) continue;
    const midpoint = start + (end - start) / 2;
    if (!(midpoint > start && midpoint < end) || !interiorAt(country, ax + dx * midpoint, ay + dy * midpoint, dx, dy)) continue;
    const previous = intervals[intervals.length - 1];
    if (previous && previous[1] === start) previous[1] = end;
    else intervals.push([start, end]);
  }
  return intervals;
}

function boundsEntry(bounds, ax, ay, dx, dy) {
  let entry = 0, exit = 1;
  for (const [origin, delta, min, max] of [[ax, dx, bounds.minX, bounds.maxX], [ay, dy, bounds.minY, bounds.maxY]]) {
    if (!delta) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let start = (min - origin) / delta, end = (max - origin) / delta;
    if (start > end) [start, end] = [end, start];
    entry = Math.max(entry, start); exit = Math.min(exit, end);
    if (entry > exit) return null;
  }
  return entry;
}

/**
 * First non-attacker country whose actual interior the route enters.
 *
 * Neutral land blocks too. Owned islands/expanded holdings are passable. Holes,
 * disconnected rings and repaired date-line parts follow SVG nonzero semantics.
 * Exact edge cuts, not point stepping, preserve even very narrow land barriers.
 * `t` is the boundary entry; `exitT` bounds its first contiguous interior span.
 */
export function firstForeignLand(index, own, attackerId, cp) {
  if (!index || !cp || ![cp.ax, cp.ay, cp.bx, cp.by].every(Number.isFinite)) return null;
  const { ax, ay, bx, by } = cp;
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0) || !Number.isFinite(lengthSquared)) return null;
  const candidates = [];
  for (let order = 0; order < index.countries.length; order++) {
    const country = index.countries[order];
    const ownerId = own?.[country.countryId] ?? null;
    if (ownerId === attackerId) continue;
    const entry = boundsEntry(country.bounds, ax, ay, dx, dy);
    if (entry !== null) candidates.push({ country, ownerId, entry, order });
  }
  // A bounding-box entry is only a lower bound, never a land hit. Inspect near
  // bounds first, then avoid all geometry proven farther away than a real hit.
  // Preserve original source order for exactly coincident real intersections.
  candidates.sort((a, b) => a.entry - b.entry || a.order - b.order);
  let first = null, firstOrder = Infinity;
  for (const { country, ownerId, entry, order } of candidates) {
    if (first && entry > first.t + ROUNDING) break;
    const interval = countryIntervals(country, ax, ay, dx, dy, lengthSquared)[0];
    if (!interval) continue;
    const [t, exitT] = interval;
    if (first && (t > first.t || (t === first.t && order >= firstOrder))) continue;
    first = Object.freeze({ countryId: country.countryId, ownerId, t, x: ax + t * dx, y: ay + t * dy, exitT });
    firstOrder = order;
  }
  return first;
}
