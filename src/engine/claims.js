// Claimed land (docs/design/claimed-land.md). A theatre can hold land no team plays on: an American league's
// states without a club, a world theatre's nations that field no team, a Europe map's countries without a club. Such
// land takes a team's colour without ever being its territory:
//
// - crossing: the land a match's line of attack passes over goes to the winner of that match (the loser's land and
//   claims go to the winner too, so whoever survives the match ends up holding the trail);
// - enclosure: a patch of empty land (one shape or a run of neighbouring ones) is landlocked by a team when that team
//   is the only one it borders and most of its edge is land: the sea and land outside the theatre border nobody, but a
//   patch that is mostly coast (an island or peninsula hanging off one team, like Ireland or Denmark) is not
//   landlocked. Such a patch is that team's, as territory is counted in Go, and a patch claimed by one team that only
//   another team landlocks passes to that team.
//
// Claims are display only. The rules (routes, reach, neighbours, the standings) never read them, and they change hands
// only with the team that holds them or when another team landlocks them. Everything here is pure; ids are strings and
// the result is deterministic.
import { createAttackRouteIndex, OBSTACLE_PREFIX, routeLandCrossings } from './attackRoutes.js';

/** Shorter passes over a shape (map units) only graze it: a route must travel this far inside to claim it. */
export const MIN_CROSSING = 0.5;
/** A landlocked patch's open edge (coast, land outside the theatre) is at most this share of its whole edge. */
export const MAX_OPEN_EDGE = 0.5;
// The colour of land nobody has claimed, while a claimed patch looks at its borders.
const UNCLAIMED = Symbol('unclaimed');
const NO_CLAIMS = Object.freeze({});

/**
 * A theatre's empty land: `ids` the land that can be claimed; `neighbours(id)` every land sharing a border with it
 * (territory, other empty land, or land outside the theatre), as a Map(id → border length) or, unmeasured, a list of
 * ids; `edge(id)` the length of its open edge (coast), in the same units, or null; `paths` (optional) its painted
 * outlines `{ [id]: { labelRings, d } }` in map units for crossings and drawing; `names` (optional) id → name.
 * Without every length, enclosure ignores how much of a patch is coast (`measured` false).
 * → frozen `{ ids (sorted), claimable: Set, adj: Map(id → sorted neighbour ids), lengths: Map(id → Map(id → length)),
 *   edge: Map(id → length), measured, index (route index | null), d: Map(id → path), names: Map(id → name) }`.
 */
export function createLand({ ids = [], neighbours = () => [], edge = () => null, paths = null, names = null } = {}) {
  const sorted = [...new Set(ids.map(String))].sort();
  const claimable = new Set(sorted);
  const adj = new Map(), lengths = new Map(), edges = new Map();
  let measured = true;
  for (const id of sorted) {
    const found = neighbours(id), row = new Map();
    if (found instanceof Map) {
      for (const [other, length] of found) if (String(other) !== id) row.set(String(other), Number.isFinite(length) ? length : 0);
    } else {
      measured = false;
      for (const other of found || []) if (String(other) !== id) row.set(String(other), 0);
    }
    adj.set(id, Object.freeze([...row.keys()].sort()));
    lengths.set(id, row);
    const open = edge(id);
    if (!Number.isFinite(open)) measured = false;
    edges.set(id, Number.isFinite(open) ? open : 0);
  }
  const drawn = paths ? Object.fromEntries(sorted.filter(id => paths[id]?.labelRings?.length).map(id => [id, paths[id]])) : {};
  return Object.freeze({
    ids: Object.freeze(sorted), claimable, adj, lengths, edge: edges, measured,
    index: Object.keys(drawn).length ? createAttackRouteIndex(drawn) : null,
    d: new Map(Object.entries(drawn).filter(([, path]) => path.d).map(([id, path]) => [id, path.d])),
    names: new Map(sorted.map(id => [id, names?.(id) ?? null]).filter(([, name]) => name)),
  });
}

/**
 * Whether most of a patch's edge is land: its open edge (coast, and land that is neither territory nor claimable) over
 * its whole edge, borders between its own shapes left out. An unmeasured land, or a patch with no edge, passes.
 */
export function landlocked(land, own, patch) {
  if (!land?.measured) return true;
  const inside = new Set(patch);
  let open = 0, total = 0;
  for (const id of patch) {
    const coast = land.edge.get(id) || 0;
    open += coast;
    total += coast;
    for (const [other, length] of land.lengths.get(id) || []) {
      if (inside.has(other)) continue;
      total += length;
      if (!land.claimable.has(other) && own?.[other] == null) open += length;
    }
  }
  return !(total > 0) || open <= total * MAX_OPEN_EDGE;
}

/** Only claims on this land's claimable ids, by teams still holding territory (`own`'s owners). */
function cleanClaims(land, own, claims) {
  const holders = new Set(Object.values(own || {}));
  const out = {};
  for (const id of land.ids) {
    const holder = claims?.[id];
    if (holder != null && holders.has(holder)) out[id] = holder;
  }
  return out;
}

/**
 * Fill every landlocked patch of empty land (see the file comment). After each fill the patches are found again from
 * the first id, so a fill that closes another patch in fills that one too, and no patch is judged on colours a fill
 * has since changed. → new claims (only claimable ids, only living holders).
 */
export function encloseClaims(land, own = {}, claims = NO_CLAIMS) {
  if (!land?.ids?.length) return {};
  const next = cleanClaims(land, own, claims);
  const colourOf = id => next[id] ?? UNCLAIMED;
  // Each fill joins a patch to a neighbouring colour, so there are fewer patches every time: at most one per id.
  for (let fills = 0; fills <= land.ids.length; fills++) {
    const filled = fillOne(land, own, next, colourOf);
    if (!filled) break;
  }
  return next;
}

/** Find the first landlocked patch in id order and give it to the team that landlocks it; false when there is none. */
function fillOne(land, own, next, colourOf) {
  const seen = new Set();
  for (const start of land.ids) {
    if (seen.has(start)) continue;
    const colour = colourOf(start), patch = [start], borders = new Set();
    seen.add(start);
    for (let i = 0; i < patch.length; i++) {
      for (const other of land.adj.get(patch[i]) || []) {
        if (land.claimable.has(other)) {
          if (colourOf(other) === colour) {
            if (!seen.has(other)) { seen.add(other); patch.push(other); }
          } else borders.add(colourOf(other));
        } else if (own[other] != null) borders.add(own[other]);
      }
    }
    if (borders.size !== 1) continue;
    const [only] = borders;
    if (only === UNCLAIMED || only === colour || !landlocked(land, own, patch)) continue;
    for (const id of patch) next[id] = only;
    return true;
  }
  return false;
}

/**
 * The empty land a line of attack passes over, in travel order: every leg of `routePoints` (`[[x, y], …]`, map units)
 * that travels at least `minimum` inside a claimable shape. Land outside the index (territory, foreign land) is not
 * empty land and never listed.
 */
export function crossedLand(land, routePoints, minimum = MIN_CROSSING) {
  if (!land?.index || !Array.isArray(routePoints) || routePoints.length < 2) return [];
  const out = new Set();
  for (let i = 1; i < routePoints.length; i++) {
    const a = routePoints[i - 1], b = routePoints[i];
    if (![a?.[0], a?.[1], b?.[0], b?.[1]].every(Number.isFinite)) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const { countryId, t, exitT } of routeLandCrossings(land.index, { ax: a[0], ay: a[1], bx: b[0], by: b[1] })) {
      if (!countryId.startsWith(OBSTACLE_PREFIX) && land.claimable.has(countryId) && (exitT - t) * length >= minimum) out.add(countryId);
    }
  }
  return [...out];
}

/**
 * Claims after a match (applyConquest): the loser's claims pass to the winner, the empty land its line of attack
 * crossed (`crossedIds`, unclaimed only) goes to the winner, then enclosure runs on `own`, the ownership after the
 * conquest. → new claims.
 */
export function settleClaims(land, { own = {}, claims = NO_CLAIMS, winnerId = null, loserId = null, crossedIds = [] } = {}) {
  if (!land?.ids?.length) return {};
  const next = {};
  for (const [id, holder] of Object.entries(claims || {})) next[id] = holder === loserId && winnerId != null ? winnerId : holder;
  if (winnerId != null) {
    for (const id of Array.isArray(crossedIds) ? crossedIds : []) {
      if (land.claimable.has(id) && next[id] == null) next[id] = winnerId;
    }
  }
  return encloseClaims(land, own, next);
}

/** Whether two claim maps hold the same land for the same teams. */
export function sameClaims(a, b) {
  const x = a || NO_CLAIMS, y = b || NO_CLAIMS;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(id => y[id] === x[id]);
}

const inBox = (box, [x, y]) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
const boxesMeet = (a, b, margin = 0) => a.minX - margin <= b.maxX && b.minX - margin <= a.maxX
  && a.minY - margin <= b.maxY && b.minY - margin <= a.maxY;

// Edges per chunk of a prepared outline: a ray test skips whole runs that lie above, below or left of the point.
const CHUNK = 32;

/** A shape's outline for fast point-in-polygon tests: its box and its edges in chunks, each with its own extent. */
function prepareOutline(id, rings) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, chunks = [];
  for (const ring of rings) {
    const count = ring.length;
    for (let start = 0; start < count; start += CHUNK) {
      const end = Math.min(count, start + CHUNK), edges = new Float64Array((end - start) * 4);
      let minY = Infinity, maxY = -Infinity, maxX = -Infinity;
      for (let i = start, o = 0; i < end; i++, o += 4) {
        const a = ring[i], b = ring[(i + 1) % count];
        edges[o] = a[0]; edges[o + 1] = a[1]; edges[o + 2] = b[0]; edges[o + 3] = b[1];
        minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]); maxX = Math.max(maxX, a[0], b[0]);
        box.minX = Math.min(box.minX, a[0]); box.maxX = Math.max(box.maxX, a[0]);
        box.minY = Math.min(box.minY, a[1]); box.maxY = Math.max(box.maxY, a[1]);
      }
      chunks.push({ minY, maxY, maxX, edges });
    }
  }
  return { id: String(id), box, chunks };
}

/** Even-odd point-in-polygon over every ring of a prepared outline (outer rings and holes alike). */
function inside(outline, [x, y]) {
  if (!inBox(outline.box, [x, y])) return false;
  let crossings = false;
  for (const { minY, maxY, maxX, edges } of outline.chunks) {
    if (y < minY || y > maxY || x > maxX) continue;
    for (let o = 0; o < edges.length; o += 4) {
      const xi = edges[o], yi = edges[o + 1], xj = edges[o + 2], yj = edges[o + 3];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) crossings = !crossings;
    }
  }
  return crossings;
}

/**
 * The land along each shape's edge when the two come from different sources and share no exact border (a world atlas's
 * countries around a map's sections): points just outside its edges, at each distance of `probe` (map units) in turn,
 * are looked up in `lands`, first match first (list sections before the atlas's outlines, which overlap them). An edge
 * with nothing beyond it is open (coast). A long ring is probed at `samples` of its edges, each standing for the run
 * it starts. `shapes` and `lands` are `[{ id, rings }]` in the same map units, `shapes` may be among `lands`.
 * → Map(shape id → { borders: Map(land id → length), edge: open length }).
 */
export function touchingLand(shapes, lands, { probe = [0.4, 1.2, 2.4], samples = 400 } = {}) {
  const prepared = lands.filter(land => land?.rings?.length).map(land => prepareOutline(land.id, land.rings));
  const reach = Math.max(...probe);
  const out = new Map();
  for (const shape of shapes) {
    const rings = shape?.rings || [], own = prepareOutline(shape?.id, rings), id = own.id;
    // Only land within a probe's reach of this shape's box can lie beyond its edges.
    const others = prepared.filter(land => land.id !== id && boxesMeet(land.box, own.box, reach));
    const beyond = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (!(length > 0)) return null;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = -dy / length, ny = dx / length;
      for (const sign of [1, -1]) {
        for (const distance of probe) {
          const point = [mx + nx * distance * sign, my + ny * distance * sign];
          // Boxes first: most of a long coast is nowhere near any land, and its shape is the costliest to test.
          const near = others.filter(land => inBox(land.box, point));
          if (!near.length) continue;
          // The shape's own side of this edge: the other side is the one that can touch a neighbour.
          if (inside(own, point)) break;
          const hit = near.find(land => inside(land, point));
          if (hit) return hit.id;
        }
      }
      return null;
    };
    const borders = new Map();
    let edge = 0;
    for (const ring of rings) {
      const count = ring.length, stride = Math.max(1, Math.ceil(count / samples));
      for (let i = 0; i < count; i += stride) {
        let run = 0;
        for (let k = i; k < Math.min(count, i + stride); k++) {
          const a = ring[k], b = ring[(k + 1) % count];
          run += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        const hit = beyond(ring[i], ring[(i + 1) % count]);
        if (hit == null) edge += run;
        else borders.set(hit, (borders.get(hit) || 0) + run);
      }
    }
    out.set(id, { borders, edge });
  }
  return out;
}
