// Owner: WP-COL (see PLAN.md §4). Campaign column, map overlays and ticker method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// Every exported body is called from App.render(), so each one is pure: no window/document/timers/setState and no
// `this.rng` (win chances use the estimator's own seeded generator through viewModels/odds.js, DEC D5). Outside a
// running campaign (phase loading/setup) each returns its empty value before building anything (PLAN §0.9).
import React from 'react';
import * as campVM from '../viewModels/campaign.js';
import { idleTurnCopy } from '../viewModels/turns.js';

function campaignRunning(st) {
  return st?.phase === 'playing' || st?.phase === 'victory';
}

/**
 * The idle route line (DEC D10 copy): 'Any of 22 empires can be drawn' | 'Compass decides the target' |
 * 'You choose the target' | the blitz/chaos/queued-batch lines of `idleTurnCopy`. Null while a fixture exists.
 * CampaignColumn only falls back to it when no fixture model is passed (the W1 stub shape).
 */
export function idleText() {
  const st = this.state;
  if (st.phase !== 'playing' || st.match || st.spin) return null;
  if (st.pendingTarget) return 'You choose the target';
  try {
    return idleTurnCopy(st, this.viewContext())?.route || null;
  } catch {
    return null;
  }
}

/**
 * CampaignColumn model (PLAN §3.5, A-1): { role, sheet, fixture, fronts, results }. Fixture states per DEC D10
 * (idle / drawing / locked / tactical / live / done); fronts from the real `reachableTargets` land tier with
 * `estimateWinProbability` win chances (DEC D4, D5; null for spectators and while a target is pending); latest
 * results from `history`. `sheet` mirrors `st.phoneSheet`, which `togglePhoneSheet()` flips (DEC D22).
 */
export function columnModel() {
  const st = this.state;
  const ctx = this.viewContext();
  if (!campaignRunning(st)) {
    return { role: ctx.managedId ? 'manager' : 'spectator', sheet: st.phoneSheet === 'expanded' ? 'expanded' : 'collapsed',
      fixture: null, fronts: null, results: { rows: [] } };
  }
  return campVM.buildColumn(st, ctx);
}

/**
 * Map title card and key (PLAN §3.5 MapOverlays, DEC D21, A-11). Both null outside a running campaign, on the
 * conquest screen (`st.choice`) and while another view hides the map, so hidden overlays cost nothing.
 */
export function mapOverlaysModel() {
  const st = this.state;
  if (!campaignRunning(st) || st.choice || this.currentView(st) !== 'map') return { titleCard: null, mapKey: null };
  return campVM.buildMapOverlays(st, { ...this.viewContext(), scopeName: this.scopeName(st.settings) });
}

/** The live ticker (PLAN §3.5 Ticker): newest results first from `history`, static and clipped (DEC misc). */
export function tickerModel() {
  const st = this.state;
  if (!campaignRunning(st)) return { items: [] };
  return campVM.buildTicker(st, this.viewContext());
}
