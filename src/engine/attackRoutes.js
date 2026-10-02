// Exact checks against the same nonzero-winding land painted by the map.
// Prepared geography is independent of ownership and shared between draw
// snapshots; only a new fit/paths object needs to rebuild it.
const indexes = new WeakMap();
const oceanGraphs = new WeakMap();
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

/** All land interiors entered by one segment, in travel order. */
export function routeLandCrossings(index, cp) {
  if (!index || !cp) return [];
  const { ax, ay, bx, by } = cp;
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  if (![ax, ay, bx, by, lengthSquared].every(Number.isFinite) || !(lengthSquared > 0)) return [];
  return index.countries.flatMap(country => {
    if (boundsEntry(country.bounds, ax, ay, dx, dy) === null) return [];
    return countryIntervals(country, ax, ay, dx, dy, lengthSquared).map(([t, exitT]) => ({ countryId: country.countryId, t, exitT }));
  }).sort((a, b) => a.t - b.t);
}

const segment = (a, b) => ({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function pointInCountry(country, [x, y]) {
  const { minX, minY, maxX, maxY } = country.bounds;
  return x >= minX && x <= maxX && y >= minY && y <= maxY && windingAt(country, x, y) !== 0;
}

// Ocean nodes are only a search aid. Every connecting segment is checked against
// exact painted edges, so a coarse grid can miss a passage but cannot invent one.
// Geometry alone is cached: ownership and current survivors are never cached.
function oceanGraph(index) {
  if (oceanGraphs.has(index)) return oceanGraphs.get(index);
  const bounds = index.countries.reduce((b, c) => ({
    minX: Math.min(b.minX, c.bounds.minX), minY: Math.min(b.minY, c.bounds.minY),
    maxX: Math.max(b.maxX, c.bounds.maxX), maxY: Math.max(b.maxY, c.bounds.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const step = Math.max((bounds.maxX - bounds.minX) / 32, (bounds.maxY - bounds.minY) / 18, .01);
  const left = bounds.minX - step * 2, top = bounds.minY - step * 2;
  const cols = Math.ceil((bounds.maxX - left) / step) + 3;
  const rows = Math.ceil((bounds.maxY - top) / step) + 3;
  const nodes = [], grid = new Map();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const point = [left + col * step, top + row * step];
    if (index.countries.some(country => pointInCountry(country, point))) continue;
    grid.set(row * cols + col, nodes.length);
    nodes.push({ point, row, col });
  }
  const graph = { nodes, grid, cols, rows, step, left, top, edges: new Map(), coasts: new Map(), access: new Map(), routes: new Map() };
  oceanGraphs.set(index, graph);
  return graph;
}

function coastalAnchors(index, graph, country) {
  if (graph.coasts.has(country.countryId)) return graph.coasts.get(country.countryId);
  const points = [], edges = country.edges;
  // Include long edges and a distributed sample: both small islands and mainland
  // coastlines should get a chance even when most of a country is a land border.
  const sampled = new Set(edges.slice().sort((a, b) =>
    Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1])).slice(0, 24));
  const stride = Math.max(1, Math.floor(edges.length / 64));
  for (let i = 0; i < edges.length; i += stride) sampled.add(edges[i]);
  for (const [ax, ay, bx, by] of sampled) {
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length > 0)) continue;
    const mid = [(ax + bx) / 2, (ay + by) / 2];
    const epsilon = Math.min(length / 20, graph.step / 1000);
    const normal = [-(by - ay) / length * epsilon, (bx - ax) / length * epsilon];
    for (const sign of [1, -1]) {
      const inside = [mid[0] + normal[0] * sign, mid[1] + normal[1] * sign];
      const outside = [mid[0] - normal[0] * sign, mid[1] - normal[1] * sign];
      if (!pointInCountry(country, inside) || index.countries.some(c => pointInCountry(c, outside))) continue;
      points.push(inside);
      break;
    }
  }
  graph.coasts.set(country.countryId, points);
  return points;
}

function oceanConnections(index, graph, own, empireId, anchors, toward = [], limit = Infinity) {
  // Access depends on the set of passable countries, never on opponent names.
  // SnapshotBoard creates fresh ownership objects; a small value-keyed LRU also
  // reuses access for retries, final-series games, and reloaded identical saves.
  const holdings = Object.keys(own).filter(country => own[country] === empireId).sort();
  const cacheKey = `${holdings.join(',')}|${anchors.map(point => point.join(',')).join(';')}|${limit}|${toward.map(point => point.join(',')).join(';')}`;
  if (graph.access.has(cacheKey)) {
    const cached = graph.access.get(cacheKey);
    graph.access.delete(cacheKey); graph.access.set(cacheKey, cached);
    return cached;
  }
  const connected = new Map();
  const connect = point => {
    let reached = false;
    const row = Math.round((point[1] - graph.top) / graph.step);
    const col = Math.round((point[0] - graph.left) / graph.step);
    const local = [];
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      if (row + dr < 0 || col + dc < 0 || row + dr >= graph.rows || col + dc >= graph.cols) continue;
      const id = graph.grid.get((row + dr) * graph.cols + col + dc);
      if (id != null) local.push({ id, cost: distance(point, graph.nodes[id].point) });
    }
    const nearest = local.sort((a, b) => a.cost - b.cost).slice(0, 4);
    for (const { id, cost } of nearest) {
      if (connected.get(id)?.cost <= cost) continue;
      if (firstForeignLand(index, own, empireId, segment(point, graph.nodes[id].point))) continue;
      connected.set(id, { id, cost, point });
      reached = true;
    }
    return reached;
  };
  const proximity = point => toward.length ? Math.min(...toward.map(other =>
    (point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2)) : 0;
  for (const point of anchors.slice().sort((a, b) => proximity(a) - proximity(b)).slice(0, Number.isFinite(limit) ? 8 : Infinity)) connect(point);
  const countries = index.countries.filter(country => own[country.countryId] === empireId)
    .sort((a, b) => proximity([(a.bounds.minX + a.bounds.maxX) / 2, (a.bounds.minY + a.bounds.maxY) / 2]) -
      proximity([(b.bounds.minX + b.bounds.maxX) / 2, (b.bounds.minY + b.bounds.maxY) / 2]));
  let accessedCountries = 0;
  for (const country of countries) {
    const coast = coastalAnchors(index, graph, country);
    const stride = Math.max(1, Math.ceil(coast.length / 8));
    let reached = false;
    for (let i = 0; i < coast.length; i += stride) reached = connect(coast[i]) || reached;
    if (reached && ++accessedCountries >= limit) break;
  }
  // Try nearby coastal holdings first. If they cannot connect, the search below
  // retries every holding, including a distant outpost, before using a treaty.
  const result = [...connected.values()].sort((a, b) => a.cost - b.cost);
  graph.access.set(cacheKey, result);
  if (graph.access.size > 32) graph.access.delete(graph.access.keys().next().value);
  return result;
}

function waterNeighbors(index, graph, id) {
  const node = graph.nodes[id], out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const row = node.row + dr, col = node.col + dc;
    if (row < 0 || col < 0 || row >= graph.rows || col >= graph.cols) continue;
    const next = graph.grid.get(row * graph.cols + col);
    if (next == null) continue;
    const key = id < next ? `${id}:${next}` : `${next}:${id}`;
    if (!graph.edges.has(key)) graph.edges.set(key,
      !firstForeignLand(index, {}, '__open_water__', segment(node.point, graph.nodes[next].point)));
    if (graph.edges.get(key)) out.push({ id: next, cost: distance(node.point, graph.nodes[next].point) });
  }
  return out;
}

/** A polyline whose interior sea legs cross no country, including neutral land. */
export function findCoastalSeaRoute(index, own, attackerId, targetId, attackerAnchors, targetAnchors, prepared = {}) {
  if (!index) return null;
  const graph = oceanGraph(index);
  const keyOf = (id, anchors) => `${Object.keys(own).filter(country => own[country] === id).sort().join(',')}|${anchors.map(p => p.join(',')).sort().join(';')}`;
  const sourceKey = keyOf(attackerId, attackerAnchors), targetKey = keyOf(targetId, targetAnchors);
  const routeKey = `${sourceKey}>${targetKey}`;
  if (graph.routes.has(routeKey)) return graph.routes.get(routeKey);
  // Canonical orientation keeps cache warmth/query order from changing a seeded
  // draw's polyline. Opposite directions reuse its independently clipped reverse.
  if (sourceKey > targetKey && !prepared.canonical) {
    findCoastalSeaRoute(index, own, targetId, attackerId, targetAnchors, attackerAnchors, { canonical: true });
    return graph.routes.get(routeKey) || null;
  }
  const retry = () => prepared.exhaustive ? null : findCoastalSeaRoute(index, own, attackerId, targetId,
    attackerAnchors, targetAnchors, { exhaustive: true, canonical: true });
  const limit = prepared.exhaustive ? Infinity : 4;
  const from = prepared.from ?? (prepared.from = oceanConnections(index, graph, own, attackerId, attackerAnchors, targetAnchors, limit));
  if (!from.length) return retry();
  const to = oceanConnections(index, graph, own, targetId, targetAnchors, attackerAnchors, limit);
  if (!to.length) return retry();
  const goals = new Map(to.map(connection => [connection.id, connection]));
  const landingPoints = [...new Set(to.map(connection => connection.point))];
  const landingX = Float64Array.from(landingPoints, point => point[0]);
  const landingY = Float64Array.from(landingPoints, point => point[1]);
  const estimates = new Float64Array(graph.nodes.length);
  for (let id = 0; id < graph.nodes.length; id++) {
    const [x, y] = graph.nodes[id].point;
    let squared = Infinity;
    for (let n = 0; n < landingX.length; n++) {
      const dx = landingX[n] - x, dy = landingY[n] - y, d2 = dx * dx + dy * dy;
      if (d2 < squared) squared = d2;
    }
    estimates[id] = Math.sqrt(squared);
  }
  const costs = new Float64Array(graph.nodes.length).fill(Infinity);
  const previous = new Int32Array(graph.nodes.length).fill(-1);
  const visited = new Uint8Array(graph.nodes.length);
  const origins = new Map();
  for (const connection of from) { costs[connection.id] = connection.cost; origins.set(connection.id, connection.point); }
  let finish = -1, best = Infinity;
  for (let count = 0; count < graph.nodes.length; count++) {
    let id = -1;
    // Straight distance to the closest actual landing is an admissible A*
    // estimate. It avoids scanning half the ocean for a late isolated island.
    for (let n = 0; n < costs.length; n++) if (!visited[n] &&
      (id < 0 || costs[n] + estimates[n] < costs[id] + estimates[id])) id = n;
    if (id < 0 || !Number.isFinite(costs[id]) || costs[id] + estimates[id] >= best) break;
    visited[id] = 1;
    const goal = goals.get(id);
    if (goal && costs[id] + goal.cost < best) { finish = id; best = costs[id] + goal.cost; }
    for (const next of waterNeighbors(index, graph, id)) {
      const cost = costs[id] + next.cost;
      if (cost >= costs[next.id]) continue;
      costs[next.id] = cost; previous[next.id] = id;
    }
  }
  if (finish < 0) return retry();
  const path = [];
  let first = finish;
  for (let id = finish; id >= 0; id = previous[id]) { path.push(graph.nodes[id].point); first = id; }
  path.reverse();
  path.unshift(origins.get(first));
  path.push(goals.get(finish).point);
  // Remove grid stair steps only when the replacement is itself exact and clear.
  const simplified = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let next = i + 1;
    for (let j = path.length - 2; j > i + 1; j--) {
      const owner = i === 0 ? attackerId : '__open_water__';
      if (!firstForeignLand(index, i === 0 ? own : {}, owner, segment(path[i], path[j]))) { next = j; break; }
    }
    simplified.push(path[next]); i = next;
  }
  const last = simplified.length - 1;
  const cp = segment(simplified[last - 1], simplified[last]);
  const hit = firstForeignLand(index, own, attackerId, cp);
  if (!hit || hit.ownerId !== targetId) return null;
  const length = distance(simplified[last - 1], simplified[last]);
  const t = hit.t + Math.min((hit.exitT - hit.t) / 2, .05 / Math.max(length, .001));
  simplified[last] = [cp.ax + (cp.bx - cp.ax) * t, cp.ay + (cp.by - cp.ay) * t];
  const route = Object.freeze(simplified.map(point => Object.freeze([...point])));
  graph.routes.set(routeKey, route);
  // A checked sea path works in reverse too. Clip the final leg at that owner's
  // first shoreline, since a departure may originally cross several own islands.
  const reverse = route.slice().reverse().map(point => [...point]);
  const end = reverse.length - 1;
  const reverseCp = segment(reverse[end - 1], reverse[end]);
  const reverseHit = firstForeignLand(index, own, targetId, reverseCp);
  if (reverseHit?.ownerId === attackerId) {
    const reverseLength = distance(reverse[end - 1], reverse[end]);
    const rt = reverseHit.t + Math.min((reverseHit.exitT - reverseHit.t) / 2, .05 / Math.max(reverseLength, .001));
    reverse[end] = [reverseCp.ax + (reverseCp.bx - reverseCp.ax) * rt, reverseCp.ay + (reverseCp.by - reverseCp.ay) * rt];
    graph.routes.set(`${targetKey}>${sourceKey}`, Object.freeze(reverse.map(point => Object.freeze(point))));
  }
  while (graph.routes.size > 32) graph.routes.delete(graph.routes.keys().next().value);
  return route;
}
