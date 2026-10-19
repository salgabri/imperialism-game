// Owner: WP-TURN (see PLAN.md §4). Turn, draw and target-selection method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// HEAD bodies were moved verbatim from App.jsx in W1 (§4.10); call other App methods through `this.x()`.
//
// Determinism (DEC D1): every duel turn consumes exactly three campaign RNG samples, all inside `beginDuel`'s
// `createDuelDraw` call (round robin passes `attackerId` and the attacker roll is ignored; "You choose" still draws,
// then the manager replaces the target). `createTargetedDraw` and every model below consume none; win chances come
// from `estimateWinProbability`'s own generator (DEC D5). With the defaults (random × compass) `beginDuel()` is
// byte-for-byte the HEAD path: no new state keys, no log entries, no extra work.
//
// The model delegates (`turnStripModel`, `reachModel`, `targetPanelModel`, `spectatorPanelModel`, `targetAnchors`) are
// called from App.render(): they are pure (no window/document/timers/setState/this.rng) and return their empty value
// outside a running campaign or without a pending target (PLAN §0.9).
import React from 'react';
import { C } from '../theme.js';
import { createDuelDraw } from '../engine/duelDraw.js';
import { nextTurn, createTargetedDraw, launchRules as normaliseRules, playerTargeting } from '../engine/turns.js';
import * as turnVM from '../viewModels/turns.js';
import TargetCard from '../screens/turns/TargetCard.jsx';
import { LOG_CAP } from './shared.js';

/** Pause before an autoplay campaign moves past a skipped round-robin turn (gameplay scheduling, scaled by speed). */
const SKIP_TURN_MS = 600;

function campaignRunning(st) {
  return st?.phase === 'playing' || st?.phase === 'victory';
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** A round-robin turn from `nextTurn` (anything else, e.g. an event object, means "no turn"). */
function turnOf(value) {
  return value && typeof value === 'object' && typeof value.attackerId === 'string' && Array.isArray(value.turnQueue)
    && Number.isInteger(value.turnIndex) && Number.isInteger(value.round) ? value : null;
}

/** The turn bookkeeping written in the same setState as the turn's spin / match / pending target (RF§2.4). */
function turnFields(turn) {
  return turn ? { turnQueue: turn.turnQueue, turnIndex: turn.turnIndex } : {};
}

function logEntry(round, txt) {
  return { t: 'sys', r: round, txt, chip: C.textMute };
}

function upper(team, fallback) {
  return String(team?.name || fallback || '').toUpperCase();
}

/** The attack line for a resolved draw (same shape `lockDuel` writes). */
function attackOf(draw, teams) {
  return { x1: draw.x, y1: draw.y, x2: draw.targetX, y2: draw.targetY,
    col: teams[draw.attackerId]?.col, reducedMotion: draw.reducedMotion,
    routePoints: draw.routePoints, routeD: draw.routeD, routeKind: draw.routeKind, routeLabel: draw.routeLabel };
}

/**
 * One duel turn. `turn` (round robin, from `beginTurn`) names the attacker and carries the advanced queue; without it
 * this is the HEAD random draw. Order after the draw (W2-ENGINE-LOG notesForWiring):
 * 1. the managed attacker under "You choose" opens the target choice (before the express shortcut; also when the
 *    round-robin draw is null: the three samples are spent either way); no target in reach → the compass decides;
 * 2. a null round-robin draw logs "<TEAM> HAS NO ROUTE THIS TURN", saves the advanced turn and moves on under autoplay;
 * 3. otherwise the HEAD express / spin paths, with `round` and the turn state in the same setState.
 */
export function beginDuel(turnArg) {
  const st = this.state;
  if (st.phase !== 'playing' || st.spin || st.pendingTarget || this.activeDrawKey != null || (st.match && !st.match.applied)) return;
  const turn = turnOf(turnArg);
  const reducedMotion = prefersReducedMotion();
  const draw = turn
    ? createDuelDraw(this.rng, this.board(), { speed: st.speed, reducedMotion, attackerId: turn.attackerId })
    : createDuelDraw(this.rng, this.board(), { speed: st.speed, reducedMotion });
  const round = turn ? turn.round : st.round + 1;
  const notes = [];
  const attackerId = turn ? turn.attackerId : draw?.attackerId ?? null;
  if (attackerId && this.playerTargets() && attackerId === this.managedId()) {
    if (this.openTargetChoice(attackerId, turn)) return;
    // DEC D4: nothing in reach (not even by sea or treaty) — this turn uses the compass, with the draw already made.
    if (draw) notes.push(logEntry(round, `${upper(st.teams[attackerId], attackerId)} HAS NO TARGET IN REACH — THE COMPASS DECIDES`));
  }
  if (!draw) {
    if (turn) {
      // Round robin never rerolls or reroutes a blocked attacker: log the turn as skipped and move on (no deadlock).
      notes.push(logEntry(round, `${upper(st.teams[turn.attackerId], turn.attackerId)} HAS NO ROUTE THIS TURN`));
      this.setState({ round, ...turnFields(turn), log: st.log.concat(notes).slice(-LOG_CAP), pu: null, toast: null }, () => {
        this.persist();
        if (this.state.autoplay) this.after(SKIP_TURN_MS, () => { if (this.state.autoplay) this.nextAction(); });
      });
      return;
    }
    this.setState({ autoplay: false });
    this.showToast({ code: 'DRAW', txt: 'No clear route for this draw. Choose Next match to try again.', col: C.gold },
      6000 * (st.speed || 1));
    return;
  }
  const extra = notes.length ? { log: st.log.concat(notes).slice(-LOG_CAP) } : {};
  if (st.settings.express && ![draw.attackerId, draw.targetId].includes(st.followedId) && st.aliveIds.length > 2) {
    this.setState({ round, ...turnFields(turn), ...extra, match: null, pu: null, toast: null },
      () => this.startMatch(draw.attackerId, draw.targetId, draw));
    return;
  }
  const spinKey = (this.spinKey = (this.spinKey || 0) + 1);
  this.activeDrawKey = spinKey;

  this.setState({
    round,
    ...turnFields(turn),
    ...extra,
    spin: { ...draw, key: spinKey, tid: draw.attackerId, stage: 'ready', ang: reducedMotion ? draw.rotation : 0 },
    atk: null,
    match: null,
    pu: null,
    toast: null,
  }, () => {
    if (reducedMotion) this.drawAfter(draw.spinMs, spinKey, () => this.lockDuel(spinKey));
    else {
      // Give the initial needle one paint before changing its angle. The
      // fallback also advances background tabs where rAF may be suspended.
      this.drawFrame(spinKey, () => this.drawFrame(spinKey, () => this.animateDuel(spinKey)));
      this.drawAfter(160, spinKey, () => this.animateDuel(spinKey));
    }
  });
}

export function animateDuel(key) {
  if (this.activeDrawKey !== key || this.startedDrawKey === key) return;
  this.startedDrawKey = key;
  this.setState(state => this.activeDrawKey === key && state.spin?.key === key && state.spin.stage === 'ready'
    ? { spin: { ...state.spin, stage: 'spinning', ang: state.spin.rotation } } : null, () => {
    const draw = this.state.spin;
    if (this.activeDrawKey === key && draw?.key === key && draw.stage === 'spinning') {
      // A single timing snapshot drives CSS and kickoff. One paint of slack
      // avoids cutting the last animation frame short at 4× playback.
      this.drawAfter(draw.spinMs + 34, key, () => this.lockDuel(key));
    }
  });
}

export function lockDuel(key) {
  if (this.activeDrawKey !== key || this.state.spin?.key !== key || this.lockedDrawKey === key) return;
  this.lockedDrawKey = key;
  this.setState(state => {
    const draw = state.spin;
    if (this.activeDrawKey !== key || draw?.key !== key || draw.stage === 'locked') return null;
    return {
      spin: { ...draw, stage: 'locked', ang: draw.rotation },
      atk: { x1: draw.x, y1: draw.y, x2: draw.targetX, y2: draw.targetY,
        col: state.teams[draw.attackerId].col, reducedMotion: draw.reducedMotion,
        routePoints: draw.routePoints, routeD: draw.routeD, routeKind: draw.routeKind, routeLabel: draw.routeLabel },
    };
  }, () => {
    const draw = this.state.spin;
    if (this.activeDrawKey === key && draw?.key === key && draw.stage === 'locked') {
      this.drawAfter(draw.holdMs, key, () => this.startMatch(draw.attackerId, draw.targetId, draw));
    }
  });
}

/**
 * Land click. While a target choice is pending (C-18) an in-reach owner becomes the selection and every other
 * country (out of reach, the attacker's own land, neutral land) is inert; otherwise it opens that team's squad.
 */
export function selectCountry(cid) {
  const st = this.state;
  const tid = st.own[cid];
  const pending = st.pendingTarget;
  if (pending) {
    if (tid && tid !== pending.attackerId && Array.isArray(pending.optionIds) && pending.optionIds.includes(tid)) this.selectTarget(tid);
    return;
  }
  if (tid) this.selectTeam(tid);
}

// ---------- turn modes (DEC D1–D4, RF§2.4–2.7) ----------

/** Launch-time turn rules (DEC D2): round robin needs duel pacing; "You choose" needs duel pacing and a manager. */
export function launchRules(su) {
  return normaliseRules(su || {});
}

/** Whether the manager picks the target this turn (player targeting, duel pacing, a managed team still in charge). */
export function playerTargets(st = this.state) {
  return playerTargeting(st?.settings, st?.settings ? this.managedId(st) : null);
}

/**
 * The next duel turn. Random draw: the HEAD `beginDuel()`. Round robin (DEC D3): the next surviving queue entry
 * attacks; at a cycle boundary the queue is rebuilt by starting strength and `round` counts the new cycle. The turn
 * is only committed by `beginDuel` (same setState as the spin / match / pending target / skipped-turn log).
 */
export function beginTurn() {
  const st = this.state;
  if (st.settings?.turnOrder !== 'round-robin') return this.beginDuel();
  if (st.phase !== 'playing' || st.spin || st.pendingTarget || this.activeDrawKey != null || (st.match && !st.match.applied)) return;
  const turn = nextTurn({ turnQueue: st.turnQueue || [], turnIndex: st.turnIndex || 0, aliveIds: st.aliveIds,
    teams: st.teams, round: st.round || 0 });
  if (!turn.attackerId) return;
  return this.beginDuel(turn);
}

/**
 * "You choose" (RF§2.5): hold the turn on the Choose-a-target panel. Options and the preselection come from
 * `targetChoiceSeed` (rank order p·n desc, top row preselected — the panel, masthead primary and map agree). The draw
 * that preceded this call already consumed the turn's three samples. Returns true when the choice opened; false when
 * nothing is in reach (DEC D4), so the caller lets the compass decide this turn.
 */
export function openTargetChoice(attackerId, turnArg = null) {
  const st = this.state;
  if (st.phase !== 'playing' || !st.teams?.[attackerId] || !st.aliveIds.includes(attackerId)) return false;
  // Never on top of another pending decision or a running draw/match (parseCampaign would reject the save).
  if (st.pendingTarget || st.spin || (st.match && !st.match.applied) || st.choice || st.tacticalChoice || st.managerElimination) return false;
  const turn = turnOf(turnArg);
  let seed;
  try {
    seed = turnVM.targetChoiceSeed(st, this.viewContext(st), attackerId);
  } catch {
    seed = null;
  }
  const optionIds = (seed?.optionIds || []).filter(id => id !== attackerId && st.teams[id] && st.aliveIds.includes(id));
  const selectedId = optionIds.includes(seed?.selectedId) ? seed.selectedId : optionIds[0];
  if (!optionIds.length || !selectedId) return false;
  // clearTimers also cancels applyConquest's pending `flash: {}`; end the last conquest's hatch flash here in the same
  // commit (DEC D15: the hatch lasts the flash duration, never through the target choice), as pu/toast are.
  this.clearTimers();
  const round = turn ? turn.round : st.round + 1;
  this.setState({
    pendingTarget: { attackerId, optionIds, selectedId, round, openedAt: Date.now(), resumeAutoplay: !!st.autoplay,
      turn: turn ? { turnQueue: turn.turnQueue, turnIndex: turn.turnIndex, round: turn.round, newRound: !!turn.newRound } : null },
    round, ...turnFields(turn),
    spin: null, atk: null, match: null, pu: null, toast: null, flash: {}, autoplay: false, paused: false, targetHoverId: null,
  }, () => this.persist());
  return true;
}

/** Choose one of the in-reach options (panel row, map land). Keeps the `optionIds` identity so the view memos hit. */
export function selectTarget(teamId) {
  const pending = this.state.pendingTarget;
  if (!pending || !Array.isArray(pending.optionIds) || !pending.optionIds.includes(teamId) || pending.selectedId === teamId) return;
  this.setState({ pendingTarget: { ...pending, selectedId: teamId } }, () => this.persist());
}

/**
 * Attack the selection (RF§2.5): a decision-ledger entry, then a pre-locked targeted draw (0 RNG; needle on the
 * route's bearing, the usual hold) that kicks off through `startMatch` — the tactical gate, follow-pause, series and
 * express all keep working. The saved locked spin passes `parseCampaign`, and resume's spin path kicks it off.
 */
export function confirmTarget() {
  const st = this.state;
  const pending = st.pendingTarget;
  if (st.phase !== 'playing' || !pending || st.storageDialog || st.storageConflict || st.exportText || st.managerElimination) return;
  const optionIds = Array.isArray(pending.optionIds) ? pending.optionIds : [];
  if (!optionIds.includes(pending.selectedId) || !st.teams[pending.selectedId]) return;
  const reducedMotion = prefersReducedMotion();
  const board = this.board();
  const options = { speed: st.speed, reducedMotion };
  // An in-reach option always has a route; should the selection lose it, the next option in rank order attacks.
  let draw = createTargetedDraw(board, pending.attackerId, pending.selectedId, options);
  for (let i = 0; !draw && i < optionIds.length; i++) {
    if (optionIds[i] !== pending.selectedId) draw = createTargetedDraw(board, pending.attackerId, optionIds[i], options);
  }
  this.engagement.count('decisions');
  const entry = { type: 'target', match: st.matches + 1, round: pending.round, teamId: pending.attackerId,
    choice: draw ? draw.targetId : pending.selectedId, preselected: optionIds[0] ?? null, options: optionIds.slice(),
    decisionMs: Math.max(0, Date.now() - (pending.openedAt || Date.now())) };
  const decisionLedger = [...(st.decisionLedger || []), entry];
  if (!draw) {
    // No route at all any more (should not happen): the turn is spent, exactly like a blocked round-robin attacker.
    this.setState({ pendingTarget: null, targetHoverId: null, decisionLedger, autoplay: !!pending.resumeAutoplay,
      log: st.log.concat([logEntry(pending.round, `${upper(st.teams[pending.attackerId], pending.attackerId)} HAS NO ROUTE THIS TURN`)]).slice(-LOG_CAP),
    }, () => {
      this.persist();
      if (this.state.autoplay) this.after(SKIP_TURN_MS, () => { if (this.state.autoplay) this.nextAction(); });
    });
    return;
  }
  this.clearDraw();
  const spinKey = (this.spinKey = (this.spinKey || 0) + 1);
  this.activeDrawKey = spinKey;
  // The needle is already on its bearing: no spin, no second lock (lockDuel / animateDuel stay inert for this key).
  this.startedDrawKey = spinKey;
  this.lockedDrawKey = spinKey;
  this.setState({
    pendingTarget: null, targetHoverId: null, decisionLedger, autoplay: !!pending.resumeAutoplay, paused: false,
    // The choice held the Map (DEC D11); stay there for the attack line, as chooseAcquisition does after a signing.
    view: 'map', viewSource: 'user',
    spin: { ...draw, key: spinKey, tid: draw.attackerId, stage: 'locked', ang: draw.rotation },
    atk: attackOf(draw, st.teams),
    match: null, pu: null, toast: null,
  }, () => {
    // componentDidUpdate already saved the new spin (it persists on every spin change).
    const spin = this.state.spin;
    if (this.activeDrawKey === spinKey && spin?.key === spinKey) {
      this.drawAfter(draw.holdMs, spinKey, () => this.startMatch(draw.attackerId, draw.targetId, draw));
    }
  });
}

/** Hovered in-reach option (map land or panel row): the map card follows it. Only options count; no-op if unchanged. */
export function hoverTarget(teamId) {
  const pending = this.state.pendingTarget;
  const id = teamId && pending && Array.isArray(pending.optionIds) && pending.optionIds.includes(teamId) ? teamId : null;
  if ((this.state.targetHoverId ?? null) === id) return;
  this.setState({ targetHoverId: id });
}

// ---------- render models (pure) ----------

/**
 * TurnStrip model (§3.5): `variant: null` outside a duel campaign (or for a manager under random draw), and on every
 * view but the Map (incl. its your-turn and spectator states): modes-13/14 draw the strip on the map screen only, so
 * Squad / Match / Ledger / Chronicle / Conquest render no strip row at all (the shell is a flex column: no gap).
 */
export function turnStripModel() {
  const st = this.state;
  if (!campaignRunning(st) || this.currentView(st) !== 'map') return { variant: null };
  return turnVM.buildTurnStrip(st, this.viewContext());
}

/** WorldMap `reach` (§3.5, FROZEN shape) while a target choice is pending, else null. */
export function reachModel() {
  const st = this.state;
  if (!campaignRunning(st) || !st.pendingTarget) return null;
  return turnVM.buildReach(st, this.viewContext());
}

/** TargetPanel model (§3.5). */
export function targetPanelModel() {
  const st = this.state;
  if (!campaignRunning(st) || !st.pendingTarget) return { rows: [], count: '', selectedId: null, ctaLabel: '' };
  return turnVM.buildTargetPanel(st, this.viewContext());
}

/** SpectatorPanel model (§3.5): This turn / Following / Autoplay. */
export function spectatorPanelModel() {
  return turnVM.buildSpectatorPanel(this.state, this.viewContext());
}

/** Map anchors for the target card (follows the hovered option, else the selection). */
export function targetAnchors() {
  const st = this.state;
  if (!campaignRunning(st) || !st.pendingTarget) return [];
  const anchor = turnVM.targetCardAnchor(st, this.viewContext());
  return anchor ? [{ key: anchor.key, x: anchor.x, y: anchor.y, align: anchor.align, node: <TargetCard {...anchor.card} /> }] : [];
}
