// Owner: WP-TURN (see PLAN.md §4). Turn-order and targeting engine (PLAN §3.7, DEC D1–D4).
// Pure functions only. Nothing here touches an RNG: under every mode a duel turn's three campaign samples are
// drawn by createDuelDraw (round robin passes `attackerId`; "You choose" still draws, then replaces the target),
// and createTargetedDraw consumes none. Win chances for target rows come from estimateWinProbability (own RNG).
import { teamEff } from '../data/teams.js';
import { empireNeighbors, routeCandidate, fallbackRouteTo, isolatedRouteIndex } from './campaign.js';
import { createTargetedDraw as targetedDraw, chosenRoute, snapshotBoard } from './duelDraw.js';

export const TURN_ORDERS = Object.freeze(['round-robin', 'random']);
export const TARGETING_MODES = Object.freeze(['player', 'compass']);

function startingStrength(team) {
  if (Number.isFinite(team?.baseEff)) return team.baseEff;
  try {
    const eff = teamEff(team);
    return Number.isFinite(eff) ? eff : 0;
  } catch { return 0; }
}
// Code-point order: ids must sort identically in every runtime and locale.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** DEC D3: survivors by starting strength (baseEff ?? teamEff) desc, then name, then id. */
export function roundRobinOrder(teams = {}, aliveIds = []) {
  const seen = new Set();
  return (Array.isArray(aliveIds) ? aliveIds : [])
    .filter(id => teams?.[id] && !seen.has(id) && seen.add(id))
    .map(id => ({ id, eff: startingStrength(teams[id]), name: String(teams[id].name || '') }))
    .sort((a, b) => b.eff - a.eff || a.name.localeCompare(b.name, 'en') || byCode(a.id, b.id))
    .map(entry => entry.id);
}

/**
 * The next round-robin attacker: skips eliminated entries; at a cycle boundary rebuilds the queue and
 * starts round + 1. → { attackerId, turnQueue, turnIndex (after consuming), round, newRound, position (1-based), total }
 * `position`/`total` are the strip's "Turn N of M this round" (M = queue length at round start, DEC D3).
 */
export function nextTurn({ turnQueue = [], turnIndex = 0, aliveIds = [], teams = {}, round = 0 } = {}) {
  const alive = new Set(aliveIds || []);
  const from = Number.isInteger(turnIndex) && turnIndex > 0 ? turnIndex : 0;
  let queue = Array.isArray(turnQueue) ? turnQueue.slice() : [];
  let at = queue.findIndex((id, i) => i >= from && alive.has(id));
  const base = Number.isInteger(round) && round >= 0 ? round : 0;
  let nextRound = base, newRound = false;
  if (at < 0) {
    queue = roundRobinOrder(teams, aliveIds);
    at = queue.length ? 0 : -1;
    nextRound = base + 1;
    newRound = true;
  }
  if (at < 0) return { attackerId: null, turnQueue: queue, turnIndex: 0, round: nextRound, newRound, position: 0, total: 0 };
  return { attackerId: queue[at], turnQueue: queue, turnIndex: at + 1, round: nextRound, newRound, position: at + 1, total: queue.length };
}

/**
 * Round-robin strip bookkeeping (DEC D3). While a turn is `active` (draw, target choice, tactical gate, match
 * or signing not yet applied) the current attacker is the entry just consumed (`turnIndex - 1`); otherwise it is
 * the upcoming attacker from `nextTurn` (which previews the next round's queue at a boundary, with no RNG).
 * → { round, position, total, currentId, nextId (next surviving entry, null = "Next: new round"),
 *     entries: [{ id, state: 'played'|'current'|'upcoming', eliminated }] }
 */
export function turnStrip({ turnQueue = [], turnIndex = 0, aliveIds = [], teams = {}, round = 0, active = false } = {}) {
  const alive = new Set(aliveIds || []);
  const queue = Array.isArray(turnQueue) ? turnQueue : [];
  let order = queue, current = -1, shownRound = Number.isInteger(round) && round >= 0 ? round : 0;
  if (active && Number.isInteger(turnIndex) && turnIndex >= 1 && turnIndex <= queue.length) current = turnIndex - 1;
  else {
    const next = nextTurn({ turnQueue: queue, turnIndex, aliveIds, teams, round: shownRound });
    order = next.turnQueue;
    current = next.position - 1;
    shownRound = next.round;
  }
  const entries = order.map((id, i) => ({ id, state: i < current ? 'played' : i === current ? 'current' : 'upcoming',
    eliminated: !alive.has(id) }));
  const nextId = current < 0 ? null : order.find((id, i) => i > current && alive.has(id)) ?? null;
  return { round: shownRound, position: current + 1, total: order.length, currentId: order[current] ?? null, nextId, entries };
}

/**
 * DEC D2 launch normalisation: turn order and targeting apply to one-by-one (duel) pacing only, and
 * "You choose" to a manager only. → { turnOrder: 'round-robin'|'random', targeting: 'player'|'compass' }
 */
export function launchRules(setup = {}) {
  const duel = setup?.pacing === 'duel';
  return {
    turnOrder: duel && setup.turnOrder === 'round-robin' ? 'round-robin' : 'random',
    targeting: duel && setup.role === 'manager' && setup.targeting === 'player' ? 'player' : 'compass',
  };
}

/** Effective "You choose" at runtime: player targeting, duel pacing and a managed team still in charge. */
export function playerTargeting(settings, managedId) {
  return settings?.targeting === 'player' && settings?.pacing === 'duel' && !!managedId;
}

const reachEntry = (tid, tier, route) => ({ tid, tier, isNeighbor: !!route.isNeighbor,
  routeKind: route.routeKind || 'straight', routeLabel: route.routeLabel || 'Direct challenge' });

/**
 * DEC D4 "in reach" targets, in survivor order → [{ tid, tier: 'land'|'sea'|'fallback', isNeighbor, routeKind, routeLabel }].
 * 1. land: land neighbours with a legal direct route (the compass rule);
 * 2. if none, every survivor with a legal direct route (direct sea strikes);
 * 3. if none, every survivor reachable by a coastal sea route or a neutral transit treaty.
 * An empty list means that turn falls back to the compass. Pure and RNG-free; fallback routes use the
 * isolated route cache, so calling this from render never changes a seeded compass draw.
 * Cost is about one pickTarget per call: memoise per (own identity, attackerId) on the App side.
 */
export function reachableTargets(board, attackerId) {
  const snapshot = snapshotBoard(board);
  if (!snapshot || !snapshot.aliveIds.includes(attackerId)) return [];
  const neighbors = empireNeighbors(snapshot, attackerId);
  const others = snapshot.aliveIds.filter(tid => tid !== attackerId);
  const direct = new Map();
  const directOf = tid => {
    if (!direct.has(tid)) direct.set(tid, routeCandidate(snapshot, attackerId, tid, snapshot.routeIndex));
    return direct.get(tid);
  };
  const land = others.filter(tid => neighbors.has(tid) && directOf(tid)).map(tid => reachEntry(tid, 'land', directOf(tid)));
  if (land.length) return land;
  const sea = others.filter(tid => directOf(tid)).map(tid => reachEntry(tid, 'sea', directOf(tid)));
  if (sea.length) return sea;
  const index = isolatedRouteIndex(snapshot.routeIndex);
  if (!index) return [];
  return others.map(tid => [tid, fallbackRouteTo(snapshot, attackerId, tid, index)])
    .filter(([, route]) => route).map(([tid, route]) => reachEntry(tid, 'fallback', route));
}

/**
 * The route a chosen target would be attacked along (the same one createTargetedDraw uses), for the dashed
 * preview arrow and the target card. → { cp, routePoints, routeD, routeKind, routeLabel, isNeighbor, transitCountryIds } | null
 */
export function routeToTarget(board, attackerId, targetId) {
  const route = chosenRoute(snapshotBoard(board), attackerId, targetId);
  const cp = route?.cp;
  if (!cp || ![cp.ax, cp.ay, cp.bx, cp.by, cp.dist].every(Number.isFinite)) return null;
  const routePoints = (route.routePoints || [[cp.ax, cp.ay], [cp.bx, cp.by]]).map(point => [...point]);
  return {
    cp: { ax: cp.ax, ay: cp.ay, bx: cp.bx, by: cp.by, dist: cp.dist },
    routePoints,
    routeD: routePoints.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(''),
    routeKind: route.routeKind || 'straight',
    routeLabel: route.routeLabel || 'Direct challenge',
    isNeighbor: !!route.isNeighbor,
    transitCountryIds: [...(route.transitCountryIds || [])],
  };
}

/**
 * A frozen draw with the createDuelDraw shape + chosen: true, spinMs: 0, rotation: bearing; consumes no RNG.
 * Valid for `parseCampaign`'s spin checks once the App adds `key`/`tid`/`stage`/`ang`. → draw | null.
 */
export function createTargetedDraw(board, attackerId, targetId, { speed = 1, reducedMotion = false } = {}) {
  return targetedDraw(board, attackerId, targetId, { speed, reducedMotion });
}

/**
 * Target-panel order (README L171, V1 L2107): expected territories `p × n` desc, then win chance, then
 * territories, then id. `options` = [{ tid, p, n, ... }] → a sorted copy; `[0]` is the preselected target.
 */
export function rankTargets(options = []) {
  const value = x => (Number.isFinite(x) ? x : 0);
  return (Array.isArray(options) ? options : []).slice().sort((a, b) =>
    value(b.p) * value(b.n) - value(a.p) * value(a.n) || value(b.p) - value(a.p)
    || value(b.n) - value(a.n) || byCode(String(a.tid), String(b.tid)));
}
