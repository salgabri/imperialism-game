// One resolved duel owns the roulette needle, attack route and reveal timings.
// Geography/rule choices stay in campaign.js; animation never picks a victim.
import { pickTarget, routeCandidate, fallbackRouteTo, isolatedRouteIndex } from './campaign.js';
import { createAttackRouteIndex } from './attackRoutes.js';

function unitSample(rng) {
  const sample = rng();
  return Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(sample) ? sample : 0));
}

/** The frozen rule view a draw resolves against (placed, distinct survivors only), or null. */
export function snapshotBoard(board) {
  if (!board?.geo?.paths || !board.own || !Array.isArray(board.aliveIds)) return null;
  // The cached index owns frozen copies of ALL visible land, including neutral
  // countries. Capture it before RNG callbacks and retain it in the rule view.
  const routeIndex = board.routeIndex ?? createAttackRouteIndex(board.routingPaths || board.geo.paths, board.obstacles);
  const paths = Object.create(null);
  const ownership = Object.entries(board.own);
  const placedOwners = new Set();
  for (const [cid, owner] of ownership) {
    const p = board.geo.paths[cid];
    if (owner == null || !Number.isFinite(p?.cx) || !Number.isFinite(p?.cy)) continue;
    paths[cid] = { cx: p.cx, cy: p.cy };
    placedOwners.add(owner);
  }
  // Preserve the campaign's survivor order (and therefore its seeded draws),
  // but do not draw an eliminated, duplicated or unplaced empire.
  const aliveIds = [...new Set(board.aliveIds)].filter(id => placedOwners.has(id));
  if (aliveIds.length < 2) return null;
  const alive = new Set(aliveIds);
  const own = Object.create(null);
  const adj = Object.create(null);
  for (const [cid, owner] of ownership) {
    if (!alive.has(owner)) continue;
    own[cid] = owner;
    const neighbors = board.geo.adj?.[cid];
    adj[cid] = neighbors instanceof Set || Array.isArray(neighbors) ? new Set(neighbors) : new Set();
  }
  return { geo: { paths, adj }, own, aliveIds, routeIndex, borderRoutes: Boolean(board.borderRoutes) };
}

/**
 * Resolve one duel before displaying it, without retaining mutable board data.
 *
 * A valid field consumes exactly three RNG samples: attacker, requested compass
 * direction, and decorative whole turns (two/three at 1×, fewer at high speed).
 * Land-neighbor priority and the widening search cone apply only to routes
 * that reach the target before any intervening country. When none exists, a
 * checked coastal sea polyline or explicit neutral (or foreign) transit keeps play
 * moving. The needle indicates the route's departure bearing. No wrap is added.
 *
 * Speed is captured for the whole presentation; callers use spinMs/holdMs for
 * both animation and scheduling rather than scaling those durations a second
 * time. Reduced motion supplies short reveal/hold phases, not a spinning wheel.
 */
export function createDuelDraw(rng, board, { speed = 1, reducedMotion = false, attackerId: fixedAttackerId = null } = {}) {
  const snapshot = snapshotBoard(board);
  if (!snapshot || typeof rng !== 'function') return null;
  const attackerRoll = unitSample(rng);
  const requestedAngle = unitSample(rng) * 360;
  const fullTurns = 2 + Math.floor(unitSample(rng) * 2);
  // Round robin names the attacker: the attacker roll above is still drawn (and
  // ignored) so every duel turn consumes exactly three samples, and a blocked
  // attacker is never rerouted to another empire (the caller skips the turn).
  const fixed = fixedAttackerId != null;
  const requestedIndex = fixed ? snapshot.aliveIds.indexOf(fixedAttackerId)
    : Math.floor(attackerRoll * snapshot.aliveIds.length);
  if (fixed && requestedIndex < 0) return null;
  let attackerId = snapshot.aliveIds[requestedIndex];
  let target = pickTarget(snapshot, attackerId, requestedAngle);
  // Retry recoverable malformed/blocked owners in survivor order without extra
  // entropy. Display speed and decorative timing cannot alter campaign outcomes.
  for (let offset = 1; !fixed && !target && offset < snapshot.aliveIds.length; offset++) {
    attackerId = snapshot.aliveIds[(requestedIndex + offset) % snapshot.aliveIds.length];
    target = pickTarget(snapshot, attackerId, requestedAngle);
  }
  const cp = target?.cp;
  if (!cp || ![cp.ax, cp.ay, cp.bx, cp.by, cp.dist].every(Number.isFinite)) return null;
  const routePoints = Object.freeze((target.routePoints || [[cp.ax, cp.ay], [cp.bx, cp.by]])
    .map(point => Object.freeze([...point])));
  const [departure, nextPoint] = routePoints;
  const bearing = ((Math.atan2(nextPoint[1] - departure[1], nextPoint[0] - departure[0]) * 180 / Math.PI) + 360) % 360;
  const safeSpeed = Number.isFinite(speed) && speed > 0 && Number.isFinite(1550 / speed) ? speed : 1;
  // Fast playback should shorten the ceremony, not turn the needle into a
  // strobing blur. Only complete decorative turns change; the draw never does.
  const turns = Math.max(1, Math.ceil(fullTurns / Math.max(1, safeSpeed)));
  const quiet = Boolean(reducedMotion);
  return Object.freeze({
    attackerId,
    targetId: target.tid,
    requestedAngle,
    bearing,
    rotation: turns * 360 + bearing,
    x: cp.ax,
    y: cp.ay,
    targetX: cp.bx,
    targetY: cp.by,
    routeKind: target.routeKind || 'straight',
    routeLabel: target.routeLabel || 'Direct challenge',
    routePoints,
    routeD: routePoints.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(''),
    transitCountryIds: Object.freeze([...(target.transitCountryIds || [])]),
    reroutedAttacker: attackerId !== snapshot.aliveIds[requestedIndex],
    isNeighbor: target.isNeighbor,
    spinMs: (quiet ? 160 : 1550) / safeSpeed,
    holdMs: (quiet ? 320 : 480) / safeSpeed,
    reducedMotion: quiet,
    speed: safeSpeed,
  });
}

/**
 * The route to one chosen target on a draw snapshot: the legal direct route
 * (the compass rule, angle-free), else a coastal sea route or a neutral transit
 * treaty resolved on the isolated route cache (see campaign.js), else null.
 */
export function chosenRoute(snapshot, attackerId, targetId) {
  if (!snapshot || attackerId === targetId || !snapshot.aliveIds.includes(attackerId)
      || !snapshot.aliveIds.includes(targetId)) return null;
  return routeCandidate(snapshot, attackerId, targetId, snapshot.routeIndex)
    || fallbackRouteTo(snapshot, attackerId, targetId, isolatedRouteIndex(snapshot.routeIndex));
}

/**
 * The manager's chosen target as a draw ("You choose", DEC D1/D4). Consumes no
 * RNG: the turn's three samples were already drawn by `createDuelDraw`. Same
 * frozen shape as `createDuelDraw` plus `chosen: true`; the needle starts on the
 * route's bearing (`rotation === bearing`, `spinMs: 0`) and only the usual hold
 * precedes kickoff. Route per `chosenRoute`.
 * → null when either side is not a placed survivor or no route reaches the target.
 */
export function createTargetedDraw(board, attackerId, targetId, { speed = 1, reducedMotion = false } = {}) {
  const target = chosenRoute(snapshotBoard(board), attackerId, targetId);
  const cp = target?.cp;
  if (!cp || ![cp.ax, cp.ay, cp.bx, cp.by, cp.dist].every(Number.isFinite)) return null;
  const routePoints = Object.freeze((target.routePoints || [[cp.ax, cp.ay], [cp.bx, cp.by]])
    .map(point => Object.freeze([...point])));
  const [departure, nextPoint] = routePoints;
  const bearing = ((Math.atan2(nextPoint[1] - departure[1], nextPoint[0] - departure[0]) * 180 / Math.PI) + 360) % 360;
  if (!Number.isFinite(bearing)) return null;
  const safeSpeed = Number.isFinite(speed) && speed > 0 && Number.isFinite(1550 / speed) ? speed : 1;
  const quiet = Boolean(reducedMotion);
  return Object.freeze({
    attackerId,
    targetId,
    requestedAngle: bearing,
    bearing,
    rotation: bearing,
    x: cp.ax,
    y: cp.ay,
    targetX: cp.bx,
    targetY: cp.by,
    routeKind: target.routeKind || 'straight',
    routeLabel: target.routeLabel || 'Direct challenge',
    routePoints,
    routeD: routePoints.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(''),
    transitCountryIds: Object.freeze([...(target.transitCountryIds || [])]),
    reroutedAttacker: false,
    isNeighbor: target.isNeighbor,
    spinMs: 0,
    holdMs: (quiet ? 320 : 480) / safeSpeed,
    reducedMotion: quiet,
    speed: safeSpeed,
    chosen: true,
  });
}
