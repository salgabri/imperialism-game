// Owner: WP-TURN (see PLAN.md §4). Turn-mode view-models (PLAN §3.6): turn strip, reach (WorldMap), the
// "Choose a target" panel and its map card, the spectator panel and the idle copy shared with WP-COL.
// Pure `(state, ctx)` builders: no window/document/timers/campaign RNG. Win chances come from
// `estimateWinProbability` (own seeded RNG + cache) via odds.js (DEC D5). Memo keys carry the `turn:` prefix
// and depend on state identities only (rule 16). Every builder tolerates the loading/setup phases, the tests'
// tiny atlas (`ctx.board` null or without routes) and fixtures with `stats: {}` / teams without `baseEff`.
import { teamEff } from '../data/teams.js';
import { roundRobinOrder, nextTurn, reachableTargets, routeToTarget, createTargetedDraw } from '../engine/turns.js';
import { roman, historyRound, formatOddsPair, formatWinChance, winTone, territoryWord, memo } from './format.js';
import { matchupOdds, winChanceFor } from './odds.js';

/** Rows shown in the target panel (M§1.6); the count copy uses the full option list. */
export const TARGET_ROWS = 6;
/** Recent attackers in the random-draw strip (M§1.7). */
export const RECENT_ATTACKERS = 6;
/** The spectator's "This turn" while the needle spins: the same words as the fixture block. */
export const COMPASS_CHOOSING = 'The compass is choosing the target';

const EMPTY_STRIP = Object.freeze({
  variant: null, label: '', detail: '', detailShort: '', phoneLabel: '', entries: [], recent: [], next: null, note: null,
});
const EMPTY_PANEL = Object.freeze({ count: '', rows: [], selectedId: null, ctaLabel: '' });

// ---------------------------------------------------------------------------------------------------------
// small pure helpers

function attempt(compute, fallback) {
  try {
    const value = compute();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function playingPhase(st) {
  return st?.phase === 'playing' || st?.phase === 'victory';
}

/** Current XI strength, falling back to the stored starting strength for malformed fixtures. */
function strengthOf(team) {
  if (!team) return null;
  const value = attempt(() => teamEff(team), null);
  if (Number.isFinite(value)) return value;
  return Number.isFinite(team.baseEff) ? team.baseEff : Number.isFinite(team.str) ? team.str : null;
}

function strengthText(team) {
  const value = strengthOf(team);
  return Number.isFinite(value) ? value.toFixed(1) : '';
}

/** Territories held per empire, from `st.own` only (no board needed). */
function territoryCounts(st, ctx) {
  return memo(ctx?.cache, 'turn:territories', [st?.own], () => {
    const counts = Object.create(null);
    for (const owner of Object.values(st?.own || {})) if (owner != null) counts[owner] = (counts[owner] || 0) + 1;
    return counts;
  });
}

function mark(team, teamId = team?.id) {
  return {
    teamId: teamId ?? null, flagId: team?.flagId ?? null, isClub: team?.kind === 'club', code: team?.code || '',
    color: team?.col || null, name: team?.name || '',
  };
}

/** A turn is in progress: live match, spin, target choice, tactical gate or signing (displayRound's rule). */
function turnBusy(st) {
  return !!((st.match && !st.match.applied) || st.spin || st.pendingTarget || st.tacticalChoice || st.choice);
}

/** The attacker of the turn in progress, or null when idle. */
function turnAttackerId(st) {
  if (st.pendingTarget?.attackerId) return st.pendingTarget.attackerId;
  if (st.spin?.attackerId) return st.spin.attackerId;
  if (st.tacticalChoice?.aId) return st.tacticalChoice.aId;
  if (st.match && !st.match.applied) return st.match.aId ?? null;
  return null;
}

/**
 * A best-of-three final under way: App.nextAction plays every remaining game as teamIds[0] v teamIds[1], each in a
 * round of its own, outside the round-robin queue → that pair, or null.
 */
function finaleSeries(st) {
  const ids = st?.series?.teamIds;
  return (st?.aliveIds || []).length === 2 && Array.isArray(ids) && ids.length === 2 ? ids : null;
}

/** DEC D3 round-robin order of the survivors, memoised (teamEff walks every lineup). */
function previewOrder(st, ctx) {
  return memo(ctx?.cache, 'turn:rr-order', [st.teams, st.aliveIds],
    () => attempt(() => roundRobinOrder(st.teams || {}, st.aliveIds || []), []));
}

/**
 * The round-robin attacker who plays next when idle (skips eliminated entries; at a boundary the memoised
 * preview of the next cycle starts with its first attacker). Memoised: three builders call idleTurnCopy per render
 * (WP-COL buildFixture, WP-MATCH nextFixtureText, buildSpectatorPanel), and a boundary would otherwise re-run
 * roundRobinOrder (teamEff for every survivor) each time.
 */
function nextRoundRobinAttacker(st, ctx) {
  const series = finaleSeries(st);
  if (series) return series[0];
  return memo(ctx?.cache, 'turn:rr-next', [st.turnQueue, st.turnIndex, st.aliveIds, st.teams, st.round], () => {
    const queue = Array.isArray(st.turnQueue) ? st.turnQueue : [];
    const from = Number.isInteger(st.turnIndex) && st.turnIndex > 0 ? st.turnIndex : 0;
    const alive = new Set(st.aliveIds || []);
    // Mid-cycle: the engine's own rule; at a boundary nextTurn would rebuild the order, so use the memoised preview.
    if (queue.some((id, i) => i >= from && alive.has(id))) {
      const turn = attempt(() => nextTurn({ turnQueue: queue, turnIndex: from, aliveIds: st.aliveIds || [],
        teams: st.teams || {}, round: st.round || 0 }), null);
      if (turn?.attackerId) return turn.attackerId;
    }
    return previewOrder(st, ctx)[0] ?? null;
  });
}

/** DEC D2: "You choose" is effective only for the manager in one-by-one pacing. */
function playerTargeting(st, ctx) {
  return st?.settings?.targeting === 'player' && (st.settings.pacing || 'duel') === 'duel' && !!ctx?.managedId;
}

// ---------------------------------------------------------------------------------------------------------
// idle copy (FROZEN: WP-COL's buildFixture imports it)

/**
 * Idle (before the draw) copy for the Next fixture block and the spectator's "This turn" (DEC D10).
 * → { title: 'Next draw' | 'Italy to attack', route: 'Any of 22 empires can be drawn' | 'Compass decides the target' | 'You choose the target' }
 * Round robin names the next attacker (the next surviving queue entry, or the strongest survivor at a round
 * boundary). Blitz/chaos (which DEC D2 normalises to random/compass) get pacing-specific lines instead of the
 * random-draw one, which would be wrong for them.
 */
export function idleTurnCopy(st, ctx) {
  const alive = st?.aliveIds || [];
  const n = alive.length;
  if (playingPhase(st) && n === 1) return { title: 'Campaign complete', route: 'No rivals remain' };
  const pacing = st?.settings?.pacing || 'duel';
  const queued = Array.isArray(st?.queue) ? st.queue.length : 0;
  if (queued > 0) return { title: 'Next match', route: `${queued} ${queued === 1 ? 'match' : 'matches'} left this round` };
  if (pacing === 'blitz') return { title: 'Next round', route: 'Neighbouring rivals are paired · each match sends one team home' };
  if (pacing === 'chaos') return { title: 'Next draw', route: 'Matches are drawn until a name repeats' };
  if (st?.settings?.turnOrder === 'round-robin') {
    const attackerId = nextRoundRobinAttacker(st, ctx);
    const team = st?.teams?.[attackerId];
    if (team) {
      const chooses = playerTargeting(st, ctx) && attackerId === ctx.managedId;
      return { title: `${team.name} to attack`, route: chooses ? 'You choose the target' : 'Compass decides the target' };
    }
  }
  return { title: 'Next draw', route: `Any of ${n} ${n === 1 ? 'empire' : 'empires'} can be drawn` };
}

// ---------------------------------------------------------------------------------------------------------
// turn strip (M§4, DEC D3, A-15)

function roundRobinStrip(st, ctx) {
  const teams = st.teams || {};
  const alive = new Set(st.aliveIds || []);
  const stored = (Array.isArray(st.turnQueue) ? st.turnQueue : []).filter(id => teams[id]);
  const index = Math.min(Math.max(0, Math.floor(Number(st.turnIndex) || 0)), stored.length);
  let queue = stored;
  let current = -1;
  if (turnBusy(st)) {
    const attackerId = turnAttackerId(st);
    if (index >= 1 && stored[index - 1] === attackerId) current = index - 1;
    else if (attackerId && stored.includes(attackerId)) current = stored.lastIndexOf(attackerId);
    else {
      // e.g. the final's series games run outside the queue: show this cycle's order around the attacker.
      queue = previewOrder(st, ctx);
      current = attackerId ? queue.indexOf(attackerId) : -1;
    }
  } else if (finaleSeries(st)) {
    // Between finale games the series attacker plays next, whatever the stale queue says (as while a game runs).
    queue = previewOrder(st, ctx);
    current = queue.indexOf(finaleSeries(st)[0]);
  } else {
    current = stored.findIndex((id, i) => i >= index && alive.has(id));
    if (current < 0) {
      // Round boundary (or the first turn): the next cycle's order, starting with its first attacker.
      queue = previewOrder(st, ctx);
      current = queue.length ? 0 : -1;
    }
  }
  const nextIndex = queue.findIndex((id, i) => i > current && alive.has(id));
  const entries = queue.map((id, i) => ({
    ...mark(teams[id], id),
    state: i === current ? 'current' : !alive.has(id) ? 'out' : i < current ? 'done' : 'next',
    nextUp: i === nextIndex,
    you: !!ctx?.managedId && id === ctx.managedId,
  }));
  const position = current >= 0 ? current + 1 : Math.max(1, index);
  const detailShort = `Turn ${position} of ${queue.length}`;
  return {
    variant: 'round-robin', label: 'Round robin', detail: `${detailShort} this round`, detailShort,
    phoneLabel: detailShort, entries, recent: [],
    next: nextIndex >= 0 ? `Next: ${teams[queue[nextIndex]]?.name || ''}` : 'Next: new round',
    note: null,
  };
}

function randomStrip(st) {
  const teams = st.teams || {};
  const n = (st.aliveIds || []).length;
  const recent = (Array.isArray(st.history) ? st.history : []).slice(-RECENT_ATTACKERS).reverse().map((entry, i) => {
    const teamId = entry?.aId ?? entry?.a?.teamId ?? entry?.a?.tid ?? null;
    const team = teams[teamId];
    const round = historyRound(entry);
    return {
      key: entry?.id ?? `recent-${i}`, teamId,
      flagId: entry?.a?.id ?? team?.flagId ?? null, isClub: entry?.a?.isClub ?? team?.kind === 'club',
      code: entry?.a?.code || team?.code || '', color: entry?.a?.color ?? team?.col ?? null,
      name: entry?.a?.name || team?.name || '', roman: roman(round),
    };
  }).filter(item => item.teamId || item.code);
  const detail = `Drawn from ${n} ${n === 1 ? 'empire' : 'empires'}`;
  return {
    variant: 'random', label: 'Random draw', detail, detailShort: detail,
    phoneLabel: `Random draw · ${n} ${n === 1 ? 'empire' : 'empires'}`, entries: [], recent,
    next: null, note: 'The same empire can be drawn twice in a row',
  };
}

/**
 * Turn strip model (PLAN §3.5 TurnStrip): `variant: null` renders nothing. Visible while playing a duel
 * campaign under round robin (everyone) or random draw (spectators only). App draws it on the Map view only
 * (turnMethods.turnStripModel gates on `currentView() === 'map'`, modes-13/14); this builder is view-agnostic.
 * → { variant, label, detail: 'Turn 3 of 22 this round', detailShort: 'Turn 3 of 22', phoneLabel,
 *     entries: [{ teamId, flagId, isClub, code, color, name, state: 'done'|'current'|'next'|'out', nextUp, you }],
 *     recent: [{ key, teamId, flagId, isClub, code, color, name, roman }], next: 'Next: Belgium'|'Next: new round'|null, note }
 */
export function buildTurnStrip(st, ctx) {
  if (!st || !playingPhase(st)) return EMPTY_STRIP;
  const settings = st.settings || {};
  if ((settings.pacing || 'duel') !== 'duel' || (st.aliveIds || []).length <= 1) return EMPTY_STRIP;
  if (settings.turnOrder === 'round-robin') return attempt(() => roundRobinStrip(st, ctx), EMPTY_STRIP);
  if (ctx?.managedId) return EMPTY_STRIP;
  return attempt(() => randomStrip(st), EMPTY_STRIP);
}

// ---------------------------------------------------------------------------------------------------------
// "Choose a target" (M§5, RF§2.5, DEC D4)

/** DEC D4 reach of an attacker (land → sea → fallback tiers), memoised per ownership. */
function reachOf(st, ctx, attackerId) {
  if (!ctx?.board || !attackerId) return [];
  return memo(ctx.cache, `turn:reach:${attackerId}`, [st.own, st.aliveIds],
    () => attempt(() => reachableTargets(ctx.board, attackerId) || [], []));
}

/**
 * Target options for `attackerId` → [{ teamId, p, n, eff }] sorted by p·n (expected territories) desc, then p,
 * then n, then id. While the attacker's target choice is pending the stored `optionIds` are authoritative; otherwise
 * the DEC D4 reach is used. p = the attacker's win chance (null when it cannot be estimated).
 */
export function targetOptions(st, ctx, attackerId) {
  if (!st?.teams?.[attackerId]) return [];
  const pending = st.pendingTarget?.attackerId === attackerId && Array.isArray(st.pendingTarget.optionIds)
    && st.pendingTarget.optionIds.length ? st.pendingTarget.optionIds : null;
  const reach = pending ? null : reachOf(st, ctx, attackerId);
  return memo(ctx?.cache, `turn:options:${attackerId}`,
    [st.teams, st.own, st.aliveIds, pending, reach, ctx?.sport, ctx?.drama, ctx?.managedId], () => {
      const alive = new Set(st.aliveIds || []);
      const ids = [...new Set(pending || reach.map(item => item.tid))]
        .filter(id => id !== attackerId && st.teams[id] && alive.has(id));
      const counts = territoryCounts(st, ctx);
      const rows = ids.map(teamId => {
        const p = attempt(() => winChanceFor(st, ctx, attackerId, teamId), null);
        return { teamId, p: Number.isFinite(p) ? p : null, n: counts[teamId] || 0, eff: strengthOf(st.teams[teamId]) };
      });
      // Same order as the engine's target ranking: p·n desc, then p, then n, then id (code-point order).
      return rows.sort((a, b) => (b.p ?? 0) * b.n - (a.p ?? 0) * a.n || (b.p ?? 0) - (a.p ?? 0) || b.n - a.n
        || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
    });
}

/**
 * The checked option. CONTRACT (wiring pass): `pendingTarget.selectedId` is authoritative and must always be one of
 * the options — `openTargetChoice` stores `targetChoiceSeed()` (selectedId = the top-ranked row), `selectTarget` only
 * ever stores an in-reach id. App's masthead primary labels itself from `teams[pendingTarget.selectedId]` (PLAN §3.3),
 * so the fallback to the top row below exists only to keep a malformed save renderable; it must never be relied on.
 */
function pendingSelection(st, options) {
  const pt = st.pendingTarget;
  if (!pt) return null;
  if (options.some(option => option.teamId === pt.selectedId)) return pt.selectedId;
  return options[0]?.teamId ?? null;
}

/**
 * What `openTargetChoice(attackerId)` must store in `pendingTarget` (README L171: the top row is preselected):
 * → { optionIds: ids in targetOptions() rank order (p·n desc, p, n, id — the engine's rankTargets order),
 *     selectedId: optionIds[0] | null }. Empty optionIds → the turn falls back to the compass (DEC D4).
 * Afterwards `buildTargetPanel(st).selectedId === st.pendingTarget.selectedId === rows[0].teamId`.
 */
export function targetChoiceSeed(st, ctx, attackerId) {
  const options = targetOptions(st, ctx, attackerId);
  const optionIds = options.map(option => option.teamId);
  return { optionIds, selectedId: optionIds[0] ?? null };
}

/** "neighbours" while every option borders the attacker (land tier), otherwise "targets" (sea/fallback, DEC D4). */
function reachNoun(st, ctx, attackerId, total) {
  const reach = reachOf(st, ctx, attackerId);
  const byId = new Map(reach.map(item => [item.tid, item]));
  const ids = st.pendingTarget?.optionIds || reach.map(item => item.tid);
  const overseas = ids.some(id => byId.get(id) && byId.get(id).tier && byId.get(id).tier !== 'land');
  const noun = overseas ? 'target' : 'neighbour';
  return `${noun}${total === 1 ? '' : 's'}`;
}

/**
 * "Choose a target" panel model (PLAN §3.5 TargetPanel).
 * → { count: '6 neighbours in reach', rows: [{ teamId, flagId, isClub, code, color, name, eff: '80.5', spoils: '+10',
 *     win: '66%', tone, selected }], selectedId, ctaLabel: 'Attack Hungary' }
 * At most TARGET_ROWS rows; a selection outside them (picked on the map) replaces the last row so it stays visible.
 */
export function buildTargetPanel(st, ctx) {
  const pt = st?.pendingTarget;
  if (!pt || !st.teams?.[pt.attackerId]) return EMPTY_PANEL;
  const options = targetOptions(st, ctx, pt.attackerId);
  const selectedId = pendingSelection(st, options);
  let shown = options.slice(0, TARGET_ROWS);
  const chosen = options.find(option => option.teamId === selectedId);
  if (chosen && !shown.includes(chosen)) shown = [...shown.slice(0, TARGET_ROWS - 1), chosen];
  const rows = shown.map(option => {
    const team = st.teams[option.teamId];
    return {
      ...mark(team, option.teamId),
      eff: Number.isFinite(option.eff) ? option.eff.toFixed(1) : '',
      spoils: `+${option.n}`,
      win: formatWinChance(option.p) || '—',
      tone: winTone(option.p),
      selected: option.teamId === selectedId,
    };
  });
  const total = options.length;
  return {
    count: `${total} ${reachNoun(st, ctx, pt.attackerId, total)} in reach`,
    rows, selectedId,
    ctaLabel: selectedId ? `Attack ${st.teams[selectedId].name}` : '',
  };
}

/** The empire the map card describes: the hovered option (targetHoverId), else the selection. */
function cardTeamId(st, ctx) {
  const pt = st.pendingTarget;
  const ids = pt.optionIds || [];
  if (st.targetHoverId && ids.includes(st.targetHoverId)) return st.targetHoverId;
  return pendingSelection(st, targetOptions(st, ctx, pt.attackerId));
}

/**
 * What the attack on `target` puts at stake. Outside a best-of-three final the winner takes the loser's land and one
 * player, and the manager's attacker is eliminated by a loss. In that final a game that does not complete the series
 * transfers nothing (finishMatch sets `noConquest`), so it keeps the series copy of the match preview (ledger.js
 * stakesCopy); only a game that can decide the series (that side already has one win) uses the decisive copy.
 */
function targetStakes(st, attackerId, targetId, n) {
  const attacker = st.teams[attackerId], target = st.teams[targetId];
  const series = (st.aliveIds || []).length === 2 && st.settings?.finale === 'best-of-three';
  const pair = Array.isArray(st.series?.teamIds) && st.series.teamIds.includes(attackerId) && st.series.teamIds.includes(targetId);
  const wins = id => (pair ? Number(st.series.wins?.[id]) || 0 : 0);
  const winDecides = !series || wins(attackerId) >= 1;
  const loseDecides = !series || wins(targetId) >= 1;
  return {
    stakeWin: winDecides ? `Win: +${n} ${territoryWord(n)} and one player` : `Win: ${attacker.name} moves one game closer to total conquest`,
    stakeLose: loseDecides ? `Lose: ${attacker.name} falls — campaign over` : `Lose: ${target.name} moves one game closer to total conquest`,
  };
}

/**
 * Map-anchored target card (M§5.5; PLAN §3.5 TargetCard). Defaults to the hovered option, else the selection.
 * → { teamId, flagId, isClub, code, color, name: 'Hungary', line1: '10 territories · strength 80.5',
 *     winLine: 'Win chance 66%', tone, stakeWin: 'Win: +10 territories and one player',
 *     stakeLose: 'Lose: Italy falls — campaign over' } | null
 * Best-of-three final, before the deciding game: 'Win: Italy moves one game closer to total conquest' /
 * 'Lose: Hungary moves one game closer to total conquest' (targetStakes).
 */
export function buildTargetCard(st, ctx, teamId) {
  const pt = st?.pendingTarget;
  if (!pt || !st.teams?.[pt.attackerId]) return null;
  const id = teamId ?? cardTeamId(st, ctx);
  const team = st.teams[id];
  if (!team || id === pt.attackerId) return null;
  const option = targetOptions(st, ctx, pt.attackerId).find(item => item.teamId === id);
  const n = option ? option.n : territoryCounts(st, ctx)[id] || 0;
  const p = option ? option.p : attempt(() => winChanceFor(st, ctx, pt.attackerId, id), null);
  const eff = strengthText(team);
  const win = formatWinChance(p);
  return {
    ...mark(team, id),
    line1: `${n} ${territoryWord(n)}${eff ? ` · strength ${eff}` : ''}`,
    winLine: win ? `Win chance ${win}` : '',
    tone: winTone(p),
    ...targetStakes(st, pt.attackerId, id, n),
  };
}

function atkFromDraw(draw, color) {
  if (!draw || ![draw.x, draw.y, draw.targetX, draw.targetY].every(Number.isFinite)) return null;
  const routePoints = Array.isArray(draw.routePoints) && draw.routePoints.length >= 2
    ? draw.routePoints : [[draw.x, draw.y], [draw.targetX, draw.targetY]];
  return {
    x1: draw.x, y1: draw.y, x2: draw.targetX, y2: draw.targetY, col: color, reducedMotion: !!draw.reducedMotion,
    routePoints, routeD: draw.routeD || routePoints.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(''),
    routeKind: draw.routeKind || 'straight', routeLabel: draw.routeLabel || '', dashed: true,
  };
}

function routeAsDraw(route) {
  const cp = route?.cp;
  if (!cp || ![cp.ax, cp.ay, cp.bx, cp.by].every(Number.isFinite)) return null;
  return { x: cp.ax, y: cp.ay, targetX: cp.bx, targetY: cp.by, routePoints: route.routePoints,
    routeKind: route.routeKind, routeLabel: route.routeLabel };
}

/** Dashed preview route (atk-shaped) from the attacker to `targetId`, consuming no RNG. */
function previewRoute(st, ctx, attackerId, targetId) {
  if (!ctx?.board || !attackerId || !targetId) return null;
  const color = st.teams?.[attackerId]?.col ?? null;
  const draw = attempt(() => createTargetedDraw(ctx.board, attackerId, targetId), null)
    || attempt(() => routeAsDraw(routeToTarget(ctx.board, attackerId, targetId)), null);
  return atkFromDraw(draw, color);
}

/**
 * WorldMap `reach` (FROZEN shape): { attackerId, ids: in-reach option ids, keepIds: [attacker, ...ids] (land kept
 * above the veil), selectedId, hoverId, preview: atk-shaped dashed route to the selection | null } | null.
 */
export function buildReach(st, ctx) {
  const pt = st?.pendingTarget;
  if (!pt || !playingPhase(st) || !st.teams?.[pt.attackerId]) return null;
  const options = targetOptions(st, ctx, pt.attackerId);
  const alive = new Set(st.aliveIds || []);
  const ids = (Array.isArray(pt.optionIds) && pt.optionIds.length ? pt.optionIds : options.map(option => option.teamId))
    .filter(id => id !== pt.attackerId && alive.has(id));
  const selectedId = pendingSelection(st, options);
  const preview = memo(ctx?.cache, 'turn:preview', [st.pendingTarget, st.own, selectedId],
    () => previewRoute(st, ctx, pt.attackerId, selectedId));
  return {
    attackerId: pt.attackerId, ids, keepIds: [pt.attackerId, ...ids], selectedId,
    hoverId: st.targetHoverId && ids.includes(st.targetHoverId) ? st.targetHoverId : null,
    preview,
  };
}

/** Target-side point of the route to `teamId` in map units, else the centre of its largest territory. */
function anchorPoint(st, ctx, attackerId, teamId, preview) {
  if (preview && teamId === st.pendingTarget?.selectedId && Number.isFinite(preview.x2)) return { x: preview.x2, y: preview.y2 };
  return memo(ctx?.cache, `turn:anchor:${teamId}`, [st.own, attackerId], () => {
    const route = ctx?.board ? attempt(() => routeAsDraw(routeToTarget(ctx.board, attackerId, teamId)), null) : null;
    if (route) return { x: route.targetX, y: route.targetY };
    const paths = ctx?.geo?.paths || ctx?.board?.geo?.paths;
    if (!paths) return null;
    let best = null;
    for (const [cid, owner] of Object.entries(st.own || {})) {
      const p = owner === teamId ? paths[cid] : null;
      if (p && Number.isFinite(p.cx) && Number.isFinite(p.cy) && (!best || (p.area || 0) > (best.area || 0))) best = p;
    }
    return best ? { x: best.cx, y: best.cy } : null;
  });
}

/**
 * Anchor for the map-anchored TargetCard (WorldMap `anchors`): { key: 'target-card', x, y, align: 'beside',
 * teamId, card } | null. turnMethods.targetAnchors() wraps it as `{ key, x, y, align, node: <TargetCard {...card}/> }`.
 */
export function targetCardAnchor(st, ctx) {
  const pt = st?.pendingTarget;
  if (!pt || !playingPhase(st) || !st.teams?.[pt.attackerId]) return null;
  const card = buildTargetCard(st, ctx);
  if (!card) return null;
  const reach = buildReach(st, ctx);
  const point = anchorPoint(st, ctx, pt.attackerId, card.teamId, reach?.preview);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { key: 'target-card', x: point.x, y: point.y, align: 'beside', teamId: card.teamId, card };
}

// ---------------------------------------------------------------------------------------------------------
// spectator panel (M§6.5 docked per A-1, A-14)

function sideOf(st, id) {
  const team = st.teams?.[id];
  return team ? { ...mark(team, id), eff: strengthText(team) } : null;
}

function oddsModel(a, b, attackerP, defenderP) {
  if (!a || !b || !Number.isFinite(attackerP)) return null;
  // One rounding for both sides (formatOddsPair), so the row always reads 100% like the fixture block's bar.
  const { a: aPct, b: bPct } = formatOddsPair(attackerP);
  return {
    aLabel: `${a.code} ${aPct}`, bLabel: `${b.code} ${bPct}`,
    fill: Math.round(Math.min(1, Math.max(0, attackerP)) * 1000) / 10,
    aria: `${a.name} ${aPct}, ${b.name} ${bPct}`,
  };
}

/**
 * "This turn" (A-14). While the needle is still spinning (stage 'ready'/'spinning') only the attacker is known on
 * screen: the defender and the odds stay hidden until the lock, like the fixture block, the map caption and the
 * opponent fill (DEC D19), so the panel never names the target before the compass has stopped.
 */
function thisTurnModel(st, ctx) {
  const pacing = st.settings?.pacing || 'duel';
  const kickerRight = pacing === 'blitz' ? 'Blitz round' : pacing === 'chaos' ? 'Chaos draw' : 'Compass draw';
  const spin = st.spin;
  if (spin && st.teams?.[spin.attackerId] && st.teams?.[spin.targetId]) {
    const a = sideOf(st, spin.attackerId);
    if (spin.stage !== 'locked') return { state: 'drawing', kickerRight, idle: null, a, b: null, odds: null, pending: COMPASS_CHOOSING };
    const b = sideOf(st, spin.targetId);
    const odds = attempt(() => matchupOdds(st, ctx, spin.attackerId, spin.targetId), null);
    return { state: 'locked', kickerRight, idle: null, a, b, odds: oddsModel(a, b, odds?.attacker, odds?.defender) };
  }
  const match = st.match;
  if (match && st.teams?.[match.aId] && st.teams?.[match.dId]) {
    const a = sideOf(st, match.aId), b = sideOf(st, match.dId);
    return { state: match.done || match.applied ? 'done' : 'live', kickerRight, idle: null, a, b,
      odds: oddsModel(a, b, match.odds?.a, match.odds?.b) };
  }
  return { state: 'idle', kickerRight, idle: idleTurnCopy(st, ctx), a: null, b: null, odds: null };
}

function eliminatedRound(st, teamId) {
  const history = Array.isArray(st.history) ? st.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.result?.loserId === teamId) return historyRound(history[i]);
  }
  return 0;
}

/**
 * Spectator panel model (PLAN §3.5 SpectatorPanel): This turn / Following / Autoplay.
 * → { sheet, thisTurn: { state, kickerRight, idle, a, b, odds, pending? }, managed: { id, name, alive, ended } | null,
 *     (state 'drawing': `a` only, b/odds null, pending: COMPASS_CHOOSING)
 *     followed: { id, name, alive, pauseOnEvents, detail, flagId, isClub, code, color } | null,
 *     teams: [{ id, name, alive }], autoplay, speed, pauseFollow, completed }
 */
export function buildSpectatorPanel(st, ctx) {
  const teams = st?.teams || {};
  const alive = new Set(st?.aliveIds || []);
  const followedId = ctx?.followedId ?? (teams[st?.followedId] ? st.followedId : null);
  const followedTeam = teams[followedId];
  let followed = null;
  if (followedTeam) {
    const isAlive = alive.has(followedId);
    const n = territoryCounts(st, ctx)[followedId] || 0;
    const eff = strengthText(followedTeam);
    const outRound = isAlive ? 0 : eliminatedRound(st, followedId);
    followed = {
      ...mark(followedTeam, followedId), id: followedId, alive: isAlive, pauseOnEvents: !!st.pauseFollow,
      detail: isAlive ? `${n} ${territoryWord(n)}${eff ? ` · strength ${eff}` : ''}`
        : `Eliminated${outRound ? ` in Round ${roman(outRound)}` : ''}`,
    };
  }
  const managedTeam = st?.managementEnded ? teams[st.managedTeamId] : null;
  const list = memo(ctx?.cache, 'turn:follow-teams', [st?.teams, st?.aliveIds], () => Object.values(teams)
    .filter(team => team?.id)
    .map(team => ({ id: team.id, name: team.name || team.id, alive: alive.has(team.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id)));
  return {
    sheet: st?.phoneSheet === 'expanded' ? 'expanded' : 'collapsed',
    thisTurn: st ? attempt(() => thisTurnModel(st, ctx), { state: 'idle', kickerRight: 'Compass draw', idle: null, a: null, b: null, odds: null })
      : { state: 'idle', kickerRight: 'Compass draw', idle: null, a: null, b: null, odds: null },
    managed: managedTeam ? { id: managedTeam.id, name: managedTeam.name, alive: alive.has(managedTeam.id), ended: true } : null,
    followed,
    teams: list,
    autoplay: !!st?.autoplay,
    speed: [1, 2, 4].includes(st?.speed) ? st.speed : 1,
    pauseFollow: !!st?.pauseFollow,
    completed: playingPhase(st) && (st.aliveIds || []).length <= 1,
  };
}
