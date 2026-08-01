// Campaign geography and match-drawing rules.
//
// A `board` is the minimal read-only view these rules need:
//   { geo: WorldGeometry, own: {countryId -> empireId}, aliveIds: string[] }

import { closestPair } from './geo.js';

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
    if (p) pts.push([p.cx, p.cy]);
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
 * NEAREST enemy in the spun direction — never skipping over a closer one. The
 * search cone widens until something is in range so a spin is never wasted.
 */
export function pickTarget(board, attackerId, angle) {
  const aPts = territoryPoints(board, attackerId);
  const neighbors = empireNeighbors(board, attackerId);
  const cands = [];
  for (const tid of board.aliveIds) {
    if (tid === attackerId) continue;
    const cp = closestPair(aPts, territoryPoints(board, tid));
    if (!cp) continue;
    const bearing = (Math.atan2(cp.by - cp.ay, cp.bx - cp.ax) * 180) / Math.PI;
    const diff = Math.abs(((((bearing - angle) % 360) + 540) % 360) - 180);
    cands.push({ tid, diff, cp, isNeighbor: neighbors.has(tid) });
  }
  if (!cands.length) return null;

  const landward = cands.filter(x => x.isNeighbor && x.diff <= 70).sort((x, y) => x.diff - y.diff);
  if (landward.length) return landward[0];

  for (const cone of [45, 75, 110, 181]) {
    const seaward = cands.filter(x => x.diff <= cone).sort((x, y) => x.cp.dist - y.cp.dist);
    if (seaward.length) return seaward[0];
  }
  return cands[0];
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
