// Owner: WP-MATCH (see PLAN.md §4). Live match presentation, reveal, match card and live-clock method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// HEAD bodies were moved verbatim from App.jsx in W1 (§4.10); call other App methods through `this.x()`.
// W2 wiring (WP-MATCH; DEC D7, A-12): `presentMatch` = the vs popup + `scheduleMatchEvents` (events, whistle and
// shoot-out through `this.after`, every token kept in `this.matchTasks`) + the single-token live minute chain
// (`this.clock.after` directly; the minute lives in `this.minuteStore`, never in `state.match`). `rescheduleForSpeed`
// re-times exactly the match tasks still pending after a speed change. Render-called builders (`matchCard`,
// `liveMatchModel`) are pure; nothing here touches `this.rng`.
import React from 'react';
import { C, pad3, tint } from '../theme.js';
import { liveModelFor } from '../engine/winProbability.js';
import { roman } from '../viewModels/format.js';
import * as matchVM from '../viewModels/match.js';

/** The vs popup's lead before the first scheduled minute (HEAD contract: event e at 450 + e.m·msPerUnit). */
const LEAD_MS = 450;
/** Below this interval the minute chain advances several minutes per tick (test speeds such as 80× only). */
const MIN_TICK_MS = 10;
/** HEAD shoot-out spacing: kicks 250ms apart, the result 650ms after the last kick. */
const KICK_MS = 250;
const SHOOTOUT_FINISH_MS = 650;

/** What each tracked clock token runs (`{ kind, fn, event? }`), so a speed change re-times only pending work (A-12). */
const TASKS = new WeakMap();

/** The last minute of play: regulation, or the last overtime event. */
function lastTickOf(m, sport) {
  return (m?.allEv || []).reduce((n, e) => Math.max(n, Number(e?.m) || 0), Number(sport?.clock?.length) || 0);
}

function lastShownMinute(m) {
  return (m?.shown || []).reduce((n, e) => Math.max(n, Number(e?.m) || 0), 0);
}

/** Schedule match work through `this.after` (tests override it) and remember the token as this match's task. */
function track(kind, ms, fn, meta) {
  const token = this.after(ms, fn);
  this.matchTasks?.add(token);
  if (token && typeof token === 'object') TASKS.set(token, { kind, fn, ...meta });
  return token;
}

/** Tracked tokens still waiting on the clock (paused ones included), in scheduling order. */
function pendingTasks() {
  const tasks = this.clock?.tasks;
  return [...(this.matchTasks || [])].filter(token => TASKS.has(token) && !!tasks?.has(token));
}

function cancelTask(token) {
  this.clock?.remove(token);
  this.matchTasks?.delete(token);
}

/** Forget tokens that already ran or were cancelled, so `matchTasks` only holds the current match's work. */
function pruneMatchTasks() {
  const tasks = this.clock?.tasks;
  for (const token of [...(this.matchTasks || [])]) if (!tasks?.has(token)) this.matchTasks.delete(token);
}

/** The shoot-out kicks still to reveal, in chronological order (HEAD presentMatch). */
function remainingKicks(tie, shown) {
  const n = Math.max(tie.A.length, tie.D.length);
  const sides = tie.first === 'D' ? ['D', 'A'] : ['A', 'D'];
  const remaining = [];
  for (let i = 0; i < n; i++) {
    for (const side of sides) if (i >= shown[side].length && i < tie[side].length) remaining.push(side);
  }
  return remaining;
}

export function presentMatch() {
  const st = this.state, m = st.match;
  if (!m || m.applied || st.choice || st.tacticalChoice) return;
  const sport = this.sport(), a = st.teams[m.aId], d = st.teams[m.dId];
  const effA = m.effA, effD = m.effD;
  pruneMatchTasks.call(this);
  this.stopMinuteClock();
  const lastTick = lastTickOf(m, sport);
  // Instant and express reveals show the final minute (the store is reset at every kickoff, so no stale minute).
  if (m.express) { this.minuteStore?.set(lastTick); this.after(18, () => this.revealAll()); return; }

  const instant = st.settings.resolution === 'instant' || st.settings.express || m.instant;
  this.showPopup(
    {
      kind: 'vs',
      // v4 notice copy in source case (CSS uppercases it, rule 15): "Round XII — Italy attacks Serbia".
      label: `Round ${roman(st.round) || st.round} — ${a.name} attacks ${d.name}`,
      aId: a.flagId,
      bId: d.flagId,
      aTeamId: a.id,
      bTeamId: d.id,
      aCode: a.code,
      aCol: a.col,
      aName: a.name,
      aEff: effA.toFixed(1),
      bCode: d.code,
      bCol: d.col,
      bName: d.name,
      bEff: effD.toFixed(1),
    },
    instant ? 950 : 1650,
  );

  if (instant) {
    this.minuteStore?.set(lastTick);
    this.after(380, () => this.revealAll());
    return;
  }

  // Ticker: events and the whistle on the HEAD schedule, then the minute chain on the same timeline (DEC D7).
  const resumeMinute = m.shown.length ? m.shown.at(-1).m : 0;
  this.minuteStore?.set(resumeMinute);
  scheduleMatchEvents.call(this, resumeMinute, LEAD_MS);
  this.startMinuteClock(resumeMinute, lastTick, sport.clock.msPerUnit, st.speed || 1, LEAD_MS);
}

/**
 * Schedule the unrevealed events and the final whistle (no popup): event e at leadMs + max(0, e.m − from)·msPerUnit
 * and the whistle one minute after the last tick, all through `this.after` (scaled by the current speed) and kept in
 * `this.matchTasks`. `events` defaults to the match's unrevealed events (a speed change passes the pending ones).
 */
export function scheduleMatchEvents(fromMinute = 0, leadMs = LEAD_MS, events) {
  const m = this.state.match;
  if (!m || m.applied) return;
  const sport = this.sport();
  const { msPerUnit } = sport.clock;
  const from = Number(fromMinute) || 0, lead = Math.max(0, Number(leadMs) || 0);
  for (const e of events || m.allEv.slice(m.shown.length)) {
    track.call(this, 'event', lead + Math.max(0, e.m - from) * msPerUnit, () => this.pushEvent(e), { event: e });
  }
  // Overtime events run past the end of regulation, so wrap up after the last
  // one rather than at a fixed whistle.
  const lastTick = lastTickOf(m, sport);
  track.call(this, 'whistle', lead + Math.max(0, lastTick + 1 - from) * msPerUnit, () => finalWhistle.call(this, sport, lastTick));
}

/** HEAD whistle body: full time, overtime result, or the shoot-out kicks; the minute chain ends here. */
function finalWhistle(sport, lastTick) {
  const m = this.state.match;
  if (!m || m.applied) return;
  this.stopMinuteClock();
  this.minuteStore?.set(lastTick);
  if (!m.tie) {
    this.patchMatch({ status: sport.labels.end });
    track.call(this, 'finish', 420, () => this.finishMatch());
    return;
  }
  if (sport.tieBreak !== 'shootout') {
    // Overtime has already been played out through the event feed.
    this.patchMatch({ status: sport.labels.tie });
    track.call(this, 'finish', 700, () => this.finishMatch());
    return;
  }
  const shown = m.tieShown || { A: [], D: [] };
  this.patchMatch({ status: sport.labels.tie, tieShown: shown });
  const remaining = remainingKicks(m.tie, shown);
  // Resume the remaining chronological sequence, including the opponent's
  // pending reply when a save was captured between alternating kicks.
  remaining.forEach((side, index) => track.call(this, 'kick', 350 + index * KICK_MS, () => this.pushKick(side)));
  track.call(this, 'shootout-finish', 350 + remaining.length * KICK_MS + SHOOTOUT_FINISH_MS, () => this.finishMatch());
}

/** Jump straight to the final score — used by INSTANT resolution and by STEP. */
export function revealAll() {
  const m = this.state.match;
  if (!m || m.applied) return;
  const sport = this.sport();
  // The reveal replaces whatever ticker work is still pending (none after fastForward's clearTimers): no event can
  // be pushed twice, and the clock shows the final minute.
  for (const token of pendingTasks.call(this)) cancelTask.call(this, token);
  this.stopMinuteClock();
  this.minuteStore?.set(lastTickOf(m, sport));
  this.patchMatch({
    shown: m.allEv,
    ga: m.finalGa,
    gd: m.finalGd,
    tieShown: m.tie && sport.tieBreak === 'shootout' ? { A: m.tie.A, D: m.tie.D } : null,
    status: m.tie ? sport.labels.tie : sport.labels.end,
  });
  this.after(m.express ? 18 : 500, () => this.finishMatch());
}

/**
 * The FROZEN match-card model (PLAN §3.5; additive only): spread into history entries, read by smoke, the PlaybackBar
 * summary, viewConquest, the column, the ticker and the Chronicle. Pure. Called by render for the current match, so it
 * returns null outside a campaign (rule 9) and for a match whose teams are missing.
 */
export function matchCard(m = this.state.match, teams = this.state.teams) {
  const { round, settings, phase } = this.state;
  if (!m) return null;
  if (m === this.state.match && phase !== 'playing' && phase !== 'victory') return null;
  const sport = this.sport();
  const A = teams?.[m.aId];
  const B = teams?.[m.dId];
  if (!A || !B) return null;
  return {
    round: pad3(round),
    mode: settings.pacing.toUpperCase(),
    status: m.status,
    statusColor: m.done ? C.textMute : m.status === sport.labels.tie ? C.gold : C.green,
    statusLive: !m.done,
    startLabel: sport.labels.start,
    a: { teamId: A.id, id: A.flagId, isClub: A.kind === 'club', code: A.code, color: A.col, name: A.name, eff: m.effA.toFixed(1), score: m.ga },
    b: { teamId: B.id, id: B.flagId, isClub: B.kind === 'club', code: B.code, color: B.col, name: B.name, eff: m.effD.toFixed(1), score: m.gd },
    // Only a shootout reveals kick by kick; overtime plays out through the feed.
    kicks: m.tieShown ? { a: m.tieShown.A, b: m.tieShown.D } : null,
    events: m.shown.map(e => {
      const team = teams[e.tid];
      const { when, text } = sport.formatEvent(e, team ? team.code : '');
      return { when, text, color: team ? team.col : '#fff' };
    }),
    noEvents: m.shown.length === 0 && !m.done,
    odds: m.odds, series: m.series, routeLabel: m.routeLabel,
    // The live minute's floor: the last revealed event (small number, persisted in history; the store does the rest).
    minuteFallback: lastShownMinute(m),
    result: m.done
      ? { title: m.resTitle || '', text: m.resText || '', upset: !!m.isUpset, background: tint(m.wCol || C.gold, 0.1),
        winnerId: m.winner, loserId: m.winner === m.aId ? m.dId : m.aId,
        winnerName: m.winnerName, loserName: m.loserName, territories: m.territoriesGained, player: m.playerTaken,
        strengthBefore: m.strengthBefore, strengthAfter: m.strengthAfter, strengthGain: m.strengthGained,
        territoryNames: m.territoryNames || [], territoryIds: m.territoryIds || [], replacedPlayer: m.replacedPlayer,
        tieText: m.tie ? (sport.tieBreak === 'shootout' ? `${m.tie.ga}–${m.tie.gd} on penalties` : `After ${m.tie.periods.length} overtime period${m.tie.periods.length === 1 ? '' : 's'}`) : null }
      : null,
  };
}

// ---------- v4 live match (PLAN §3.3 match notes, DEC D6/D7, A-12) ----------

/**
 * Live win-probability model numbers stored on the match at kickoff (§3.7, DEC D6): small plain JSON from the
 * sport's deterministic `prepareMatch` (no RNG), or null when the approximation does not cover the match.
 */
export function matchLiveModel(sport, a, d, effA, effD, drama) {
  try {
    return liveModelFor(sport, a, d, effA, effD, drama) ?? null;
  } catch {
    return null;
  }
}

/**
 * A-12: after a speed change, re-time the live ticker match at the new rate. Before the whistle the pending events,
 * the whistle and the minute chain restart from the current minute; in a shoot-out the pending kicks follow 250ms
 * apart and the result 650ms after them (all through `this.after`, so divided by the new speed); between the whistle
 * and the result nothing moves. Only tokens still pending are re-timed, so no event or kick runs twice. Works while
 * paused (new tokens wait for resume). Never touches `state.match` or `this.rng`.
 */
export function rescheduleForSpeed(previousSpeed) {
  const st = this.state, m = st.match;
  if (!m || m.applied || m.express || m.instant || st.settings?.resolution !== 'ticker') return;
  const speed = Number(st.speed) || 1;
  if (Number(previousSpeed) === speed) return;
  const pending = pendingTasks.call(this).map(token => ({ token, ...TASKS.get(token) }));
  if (!pending.length) return; // an instant reveal or a settled match: the match clock times nothing
  const sport = this.sport();
  if (pending.some(task => task.kind === 'whistle')) {
    const lastTick = lastTickOf(m, sport);
    const minute = Math.min(lastTick, Math.max(Number(this.minuteStore?.get()) || 0, lastShownMinute(m)));
    const events = pending.filter(task => task.kind === 'event').map(task => task.event);
    for (const task of pending) cancelTask.call(this, task.token);
    scheduleMatchEvents.call(this, minute, 0, events);
    this.startMinuteClock(minute, lastTick, sport.clock.msPerUnit, speed, 0);
    return;
  }
  const kicks = pending.filter(task => task.kind === 'kick');
  const finish = pending.find(task => task.kind === 'shootout-finish');
  if (!kicks.length && !finish) return; // between the whistle and finishMatch the result keeps its time
  for (const task of finish ? [...kicks, finish] : kicks) cancelTask.call(this, task.token);
  kicks.forEach((task, index) => track.call(this, 'kick', (index + 1) * KICK_MS, task.fn));
  if (finish) track.call(this, 'shootout-finish', kicks.length * KICK_MS + SHOOTOUT_FINISH_MS, finish.fn);
}

/**
 * The single-token live minute chain (DEC D7): minute k is reached at leadMs + (k − from)·msPerUnit (the event
 * schedule), scaled by `speed`. Uses `this.clock.after` directly (not `this.after`), so pause/resume freeze it with
 * the match and `clearTimers` drops it; the minute only goes to `this.minuteStore` (no React state, nothing in
 * `state.match`). It never shows a minute past the next unrevealed event and stops at `toMinute`, at the whistle,
 * or when the match is settled or replaced. `leadMs` (optional, default 0) is the kickoff popup's lead.
 *
 * One anchor, no drift: every tick is armed against the kickoff schedule (not relative to the previous tick), and
 * the minute it shows is derived from the clock time it actually ran at. A late timer (a slow render, a busy main
 * thread) therefore never accumulates: the clock stays on the events' and the whistle's timeline, which are armed
 * from the same kickoff. The anchor is each token's own `due` time, which PlaybackClock shifts by the length of a
 * pause on resume, so pausing re-anchors for free; a speed change or a resume restarts the chain from the current
 * minute (`rescheduleForSpeed`, `presentMatch`).
 */
export function startMinuteClock(fromMinute, toMinute, msPerUnit, speed, leadMs = 0) {
  this.stopMinuteClock();
  const from = Math.max(0, Math.floor(Number(fromMinute) || 0));
  const to = Math.floor(Number(toMinute) || 0);
  const unit = Number(msPerUnit) || 0;
  const rate = Number(speed) > 0 ? Number(speed) : 1;
  const lead = Math.max(0, Number(leadMs) || 0);
  this.minuteStore?.set(from);
  const allEv = this.state.match?.allEv;
  if (!this.clock || !this.minuteStore || !allEv || !(unit > 0) || to <= from) return null;
  const step = unit / rate;
  const stride = step < MIN_TICK_MS ? Math.ceil(MIN_TICK_MS / step) : 1;
  const clock = this.clock;
  const now = () => { const t = Number(clock.now?.()); return Number.isFinite(t) ? t : NaN; };
  /** Arm the tick that shows minute `target`, `delay` ms from now (never negative). */
  const arm = (target, delay) => {
    const token = clock.after(Math.max(0, delay), () => tick(token, target));
    this.minuteToken = token;
    return token;
  };
  const tick = (token, target) => {
    this.minuteToken = null;
    const m = this.state.match;
    if (!m || m.applied || m.done || m.allEv !== allEv) return;
    // Kickoff (+ lead) in clock time, shifted by any pause: this token was due exactly at base + (target − from)·step.
    const t = now(), due = Number(token?.due);
    const anchored = Number.isFinite(t) && Number.isFinite(due);
    const base = anchored ? due - (target - from) * step : NaN;
    const elapsed = anchored ? from + Math.floor((t - base) / step + 1e-9) : target;
    const minute = Math.min(to, Math.max(target, elapsed));
    const next = Number(m.allEv[m.shown?.length ?? 0]?.m);
    this.minuteStore.set(Number.isFinite(next) ? Math.max(from, Math.min(minute, next)) : minute);
    if (minute >= to) return;
    const nextTarget = Math.min(to, minute + stride);
    arm(nextTarget, anchored ? base + (nextTarget - from) * step - t : (nextTarget - minute) * step);
  };
  const first = Math.min(to, from + stride);
  return arm(first, lead / rate + (first - from) * step);
}

export function stopMinuteClock() {
  if (this.minuteToken != null) this.clock?.remove(this.minuteToken);
  this.minuteToken = null;
}

/** MatchScreen model (§3.5, B§5): pure; the live match, else the last finished one, else the empty state. */
export function liveMatchModel() {
  return matchVM.buildLiveMatch(this.state, this.viewContext());
}
