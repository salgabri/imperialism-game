// Campaign geography and match-drawing rules.
//
// A `board` is the minimal read-only view these rules need:
//   { geo: WorldGeometry, own: {countryId -> empireId}, aliveIds: string[] }

import { closestPair } from './geo.js';
import { createAttackRouteIndex, firstForeignLand, findCoastalSeaRoute, routeLandCrossings } from './attackRoutes.js';

/**
 * Seed clubs onto the map.
 *
 * A club has a home country but shares it with every rival in its league, so
 * they cannot all start there. Working down the strength order, each club claims
 * the nearest country to its homeland that nobody has taken yet: the best club
 * in each league gets the homeland itself, and the rest fan outwards. Countries
 * nobody reaches stay neutral, exactly as non-participating nations do.
 */
export function seedClubs(geo, clubs) {
  const own = {};
  const anchorOf = id => {
    const p = geo.paths[id];
    return p ? [p.cx, p.cy] : null;
  };
  const available = Object.keys(geo.paths).filter(id => anchorOf(id));

  for (const club of clubs.slice().sort((a, b) => b.str - a.str)) {
    const from = anchorOf(club.home);
    if (!from) continue;
    let best = null;
    let bestDist = Infinity;
    for (const cid of available) {
      if (own[cid]) continue;
      const to = anchorOf(cid);
      const d = (to[0] - from[0]) ** 2 + (to[1] - from[1]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = cid;
      }
    }
    if (best) own[best] = club.id;
  }
  return own;
}

/** Country ids currently held by an empire. */
export function territories(board, tid) {
  const out = [];
  for (const cid in board.own) if (board.own[cid] === tid) out.push(cid);
  return out;
}

/** Centroid of an empire's largest territory — its anchor for markers and arrows. */
export function empireCenter(board, tid) {
  let best = null;
  let bestArea = -1;
  for (const cid of territories(board, tid)) {
    const p = board.geo.paths[cid];
    if (p && p.area > bestArea) {
      bestArea = p.area;
      best = p;
    }
  }
  return best ? { x: best.cx, y: best.cy } : { x: 480, y: 270 };
}

function territoryPoints(board, tid) {
  const pts = [];
  for (const cid of territories(board, tid)) {
    const p = board.geo.paths[cid];
    if (Number.isFinite(p?.cx) && Number.isFinite(p?.cy)) pts.push([p.cx, p.cy]);
  }
  return pts;
}

/** Empires sharing a land border with `tid`, anywhere across its holdings. */
export function empireNeighbors(board, tid) {
  const out = new Set();
  for (const cid of territories(board, tid)) {
    const adj = board.geo.adj[cid];
    if (!adj) continue;
    for (const n of adj) {
      const owner = board.own[n];
      if (owner && owner !== tid) out.add(owner);
    }
  }
  return out;
}

/**
 * Resolve the spinner into a victim.
 *
 * A nation may only attack a land neighbour, or strike across the sea at the
 * NEAREST reachable enemy in the spun direction. A capital-distance cone is
 * only a shortlist: the drawn route must reach that owner's land before any
 * other owner's or neutral land. Widen the cone rather than jumping a blocker.
 */
export function pickTarget(board, attackerId, angle, { fallback = true } = {}) {
  const aPts = territoryPoints(board, attackerId);
  const neighbors = empireNeighbors(board, attackerId);
  const routeIndex = board.routeIndex ?? createAttackRouteIndex(board.routingPaths || board.geo.paths);
  const candidateOf = tid => {
    if (tid === attackerId) return null;
    const bPts = territoryPoints(board, tid);
    // An empire may have a blocked closest pair but an open route from another
    // holding. Try pairs by distance, never falling back to an unchecked line.
    const pairs = routeIndex ? aPts.flatMap(a => bPts.map(b => closestPair([a], [b])))
      .filter(Boolean).sort((a, b) => a.dist - b.dist) : [closestPair(aPts, bPts)].filter(Boolean);
    let cp = null, anchorDistance = 0;
    for (const pair of pairs) {
      if (!routeIndex) { cp = pair; anchorDistance = pair.dist; break; }
      const hit = firstForeignLand(routeIndex, board.own, attackerId, pair);
      if (!hit || hit.ownerId !== tid) continue;
      // Stop just inside the first target land, not beyond it at a capital that
      // may lie past another border/enclave. The bearing is unchanged.
      const t = hit.t + Math.min((hit.exitT - hit.t) / 2, .05 / Math.max(pair.dist, .001));
      cp = { ax: pair.ax, ay: pair.ay,
        bx: pair.ax + (pair.bx - pair.ax) * t,
        by: pair.ay + (pair.by - pair.ay) * t, dist: pair.dist * t };
      anchorDistance = pair.dist;
      break;
    }
    if (!cp) return null;
    const bearing = (Math.atan2(cp.by - cp.ay, cp.bx - cp.ax) * 180) / Math.PI;
    const diff = Math.abs(((((bearing - angle) % 360) + 540) % 360) - 180);
    return { tid, diff, cp, anchorDistance, isNeighbor: neighbors.has(tid) };
  };
  // Land candidates have priority, so avoid tracing every far-away coastline
  // when a legal neighbor already wins. Keep survivor order for stable ties.
  const nearby = new Map(board.aliveIds.filter(tid => neighbors.has(tid)).map(tid => [tid, candidateOf(tid)]));
  const landward = [...nearby.values()].filter(x => x && x.diff <= 70).sort((x, y) => x.diff - y.diff);
  if (landward.length) return landward[0];

  const cands = board.aliveIds.map(tid => nearby.has(tid) ? nearby.get(tid) : candidateOf(tid)).filter(Boolean);
  if (!cands.length) return fallback ? pickFallbackTarget(board, attackerId, angle, routeIndex) : null;
  for (const cone of [45, 75, 110, 181]) {
    const seaward = cands.filter(x => x.diff <= cone).sort((x, y) => x.anchorDistance - y.anchorDistance);
    if (seaward.length) return seaward[0];
  }
  return cands[0];
}

function bearingDifference(points, angle) {
  const [a, b] = points;
  const bearing = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  return Math.abs(((((bearing - angle) % 360) + 540) % 360) - 180);
}

function clippedRoute(pair, hit) {
  const t = hit.t + Math.min((hit.exitT - hit.t) / 2, .05 / Math.max(pair.dist, .001));
  return { ax: pair.ax, ay: pair.ay, bx: pair.ax + (pair.bx - pair.ax) * t,
    by: pair.ay + (pair.by - pair.ay) * t, dist: pair.dist * t };
}

/**
 * Curved coastal routes are a fallback, never permission for a straight arrow to
 * jump blockers. Landlocked survivors use a visibly named neutral transit treaty:
 * neutral land can be crossed, but the route still stops at the first live enemy.
 * This explicit exception guarantees that a valid two-owner field can finish.
 */
function pickFallbackTarget(board, attackerId, angle, routeIndex) {
  const aPts = territoryPoints(board, attackerId);
  const candidates = board.aliveIds.filter(tid => tid !== attackerId).map(tid => {
    const cp = closestPair(aPts, territoryPoints(board, tid));
    return cp && { tid, cp, diff: bearingDifference([[cp.ax, cp.ay], [cp.bx, cp.by]], angle) };
  }).filter(Boolean);
  const order = [];
  for (const cone of [45, 75, 110, 181]) {
    for (const candidate of candidates.filter(c => c.diff <= cone).sort((a, b) => a.cp.dist - b.cp.dist)) {
      if (!order.includes(candidate)) order.push(candidate);
    }
  }
  const preparedSeaRoutes = {};
  if (routeIndex) for (const candidate of order) {
    const routePoints = findCoastalSeaRoute(routeIndex, board.own, attackerId, candidate.tid,
      aPts, territoryPoints(board, candidate.tid), preparedSeaRoutes);
    if (!routePoints) continue;
    const a = routePoints[0], b = routePoints[routePoints.length - 1];
    return { tid: candidate.tid, cp: { ax: a[0], ay: a[1], bx: b[0], by: b[1], dist: Math.hypot(b[0] - a[0], b[1] - a[1]) },
      diff: bearingDifference(routePoints, angle), anchorDistance: candidate.cp.dist,
      isNeighbor: false, routeKind: 'sea', routeLabel: 'Coastal sea route', routePoints, transitCountryIds: [] };
  }
  if (!routeIndex) return null;
  const survivors = new Set(board.aliveIds);
  const transitOwnership = Object.fromEntries(routeIndex.countries.map(({ countryId }) => [countryId,
    survivors.has(board.own[countryId]) ? board.own[countryId] : attackerId]));
  for (const candidate of order) {
    const hit = firstForeignLand(routeIndex, transitOwnership, attackerId, candidate.cp);
    if (!hit || !survivors.has(hit.ownerId) || hit.ownerId === attackerId) continue;
    const cp = clippedRoute(candidate.cp, hit);
    const transitCountryIds = [...new Set(routeLandCrossings(routeIndex, cp)
      .filter(({ countryId }) => !survivors.has(board.own[countryId])).map(({ countryId }) => countryId))];
    const routePoints = [[cp.ax, cp.ay], [cp.bx, cp.by]];
    return { tid: hit.ownerId, cp, diff: bearingDifference(routePoints, angle), anchorDistance: candidate.cp.dist,
      isNeighbor: empireNeighbors(board, attackerId).has(hit.ownerId),
      routeKind: transitCountryIds.length ? 'neutral-transit' : 'straight',
      routeLabel: transitCountryIds.length ? 'Neutral transit treaty' : 'Direct challenge', routePoints, transitCountryIds };
  }
  return null;
}

/** Cheap setup validation; fallback routes guarantee progress for placed owners. */
export function validateReachability(board) {
  if (!board?.geo?.paths || !board.own || !Array.isArray(board.aliveIds)) return { valid: false, unplacedIds: [] };
  const unplacedIds = [...new Set(board.aliveIds)].filter(id => !territoryPoints(board, id).length);
  return { valid: unplacedIds.length === 0, unplacedIds, rules: ['direct', 'coastal-sea', 'neutral-transit-treaty'] };
}

/**
 * Blitz: every empire is paired off, preferring a land neighbour and otherwise
 * the geographically nearest opponent. An odd field leaves one `bye`.
 */
export function drawBlitzPairs(rng, board) {
  const alive = board.aliveIds.slice();
  for (let i = alive.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = alive[i];
    alive[i] = alive[j];
    alive[j] = t;
  }
  const pointsOf = {};
  for (const t of alive) pointsOf[t] = territoryPoints(board, t);

  const unpaired = new Set(alive);
  const pairs = [];
  let bye = null;
  for (const tid of alive) {
    if (!unpaired.has(tid)) continue;
    unpaired.delete(tid);
    const neighbors = empireNeighbors(board, tid);
    let pool = [...unpaired].filter(o => neighbors.has(o));
    if (!pool.length) pool = [...unpaired];
    let best = null;
    let bestDist = 1e18;
    for (const o of pool) {
      const cp = closestPair(pointsOf[tid], pointsOf[o]);
      if (cp && cp.dist < bestDist) {
        bestDist = cp.dist;
        best = o;
      }
    }
    if (best) {
      unpaired.delete(best);
      pairs.push([tid, best]);
    } else {
      bye = tid;
    }
  }
  return { pairs, bye };
}

/**
 * Chaos: keep drawing random matchups until a name would repeat, then resolve the
 * whole batch. Round size is therefore unpredictable, which is the point.
 */
export function drawChaosPairs(rng, board) {
  const alive = board.aliveIds;
  const used = new Set();
  const pairs = [];
  for (let guard = 0; guard < 500; guard++) {
    const x = alive[Math.floor(rng() * alive.length)];
    if (used.has(x)) break;
    used.add(x);

    const neighbors = [...empireNeighbors(board, x)].filter(o => !used.has(o));
    let y = null;
    if (neighbors.length) {
      y = neighbors[Math.floor(rng() * neighbors.length)];
    } else {
      const xPts = territoryPoints(board, x);
      let bestDist = 1e18;
      for (const o of alive) {
        if (used.has(o)) continue;
        const cp = closestPair(xPts, territoryPoints(board, o));
        if (cp && cp.dist < bestDist) {
          bestDist = cp.dist;
          y = o;
        }
      }
    }
    if (!y) break;
    used.add(y);
    pairs.push([x, y]);
    if (used.size >= alive.length - 1) break;
  }
  if (!pairs.length) {
    // Degenerate field (e.g. two survivors that already drew each other).
    const a = alive[Math.floor(rng() * alive.length)];
    const others = alive.filter(t => t !== a);
    pairs.push([a, others[Math.floor(rng() * others.length)]]);
  }
  return pairs;
}
