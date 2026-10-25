// Owner: WP-LEDGER (see PLAN.md §4). Standings, victory, ledger and chronicle method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// HEAD bodies were moved verbatim from App.jsx in W1 (§4.10); call other App methods through `this.x()`.
// Every model built here is render-safe (PLAN §0.9): no window/document/timers/setState/this.rng while building.
import React from 'react';
import { pad3 } from '../theme.js';
import { selectLineup, teamEff } from '../data/teams.js';
import { territories } from '../engine/campaign.js';
import { campaignRecap } from '../engine/campaignExperience.js';
import { getLoadedDomestic } from '../engine/domestic.js';
import { domesticEntry } from '../data/domesticScope.js';
import * as ledgerVM from '../viewModels/ledger.js';
import { domesticIdOf, signed } from './shared.js';

function isPlaying(st) {
  return st?.phase === 'playing' || st?.phase === 'victory';
}

/**
 * viewContext() plus the theatre name, so the Ledger/Chronicle kickers read "The European Campaign" exactly as the
 * masthead does. `scopeName` is optional for the builders (they derive it from settings), so a failure here is ignored.
 */
function ledgerContext() {
  const ctx = this.viewContext();
  let scopeName;
  try { scopeName = this.scopeName(); } catch { scopeName = undefined; }
  return scopeName ? { ...ctx, scopeName } : ctx;
}

/**
 * Standings rows, strongest first (smoke `standingsSnapshot` reads `tid`, `rank`, `eff`, `territories`). The HEAD keys
 * `tid, rank, eff, territories, effGain, name, code, flagId, isClub, color` are kept unchanged; v4 adds `teamId` and the
 * Ledger's `conq` / `claimed` counts (`stats: {}` tolerated).
 */
export function powerTable(playing) {
  const { aliveIds, teams, stats } = this.state;
  if (!playing || !this.geo) return [];
  const board = this.board();
  return aliveIds
    .map(tid => ({ tid, eff: teamEff(teams[tid]), terr: territories(board, tid).length }))
    .sort((a, b) => b.eff - a.eff || teams[a.tid].name.localeCompare(teams[b.tid].name) || a.tid.localeCompare(b.tid))
    .map((r, i) => ({
      tid: r.tid,
      flagId: teams[r.tid].flagId,
      isClub: teams[r.tid].kind === 'club',
      rank: i + 1,
      code: teams[r.tid].code,
      color: teams[r.tid].col,
      name: teams[r.tid].name,
      territories: String(r.terr),
      eff: r.eff.toFixed(1),
      // How much of that rating was bought with conquest rather than born with.
      effGain: signed(r.eff - (teams[r.tid].baseEff ?? r.eff)),
      teamId: r.tid,
      conq: String(stats?.[r.tid]?.conq ?? 0),
      claimed: String(stats?.[r.tid]?.steals?.length ?? 0),
    }));
}

/**
 * VictoryOverlay props (spread by render). Every HEAD key and every `recap` key is kept (campaign-experience reads
 * `recap['Elapsed time']`). v4 adds `onChronicle` (board 11 "Read the chronicle"): close the results and open the
 * Chronicle. It travels in this model because render spreads it into VictoryOverlay (PLAN §1.2 note).
 */
export function victoryPanel() {
  const { aliveIds, teams, stats, settings, round, matches } = this.state;
  const champ = aliveIds.length ? teams[aliveIds[0]] : null;
  if (!champ) return null;
  const s = stats[champ.id] || { conq: 0, steals: [] };
  // "has conquered England", not the country theatre's "England · top 100 clubs" label.
  const domesticId = domesticIdOf(settings);
  const scope = domesticId
    ? getLoadedDomestic(domesticId)?.meta.name || domesticEntry(settings.clubScope)?.name || this.scopeName(settings)
    : this.scopeName(settings);
  return {
    id: champ.flagId,
    teamId: champ.id,
    code: champ.code,
    isClub: champ.kind === 'club',
    round: pad3(round),
    name: champ.name.toUpperCase(),
    color: champ.col,
    subtitle:
      'has conquered ' + (settings.layer !== 'clubs' && settings.scope === 'world' ? 'the world' : scope) +
      ' in ' + matches + (matches === 1 ? ' battle' : ' battles'),
    conquests: String(s.conq || 0),
    steals: String((s.steals || []).length),
    territories: String(territories(this.board(), champ.id).length),
    effNow: teamEff(champ).toFixed(1),
    effBase: (champ.baseEff ?? teamEff(champ)).toFixed(1),
    effGain: signed(teamEff(champ) - (champ.baseEff ?? teamEff(champ))),
    squad: selectLineup(champ).starters,
    // "Biggest upset" uses the app's one upset definition (result.upset), as the Chronicle's turning points do.
    recap: { ...campaignRecap(this.state.history),
      biggestUpset: ledgerVM.biggestUpsetLine(this.state.history) || 'No upsets recorded',
      'Leader changes': this.state.metrics?.leaderChanges || 0,
      'Acquisitions improving the lineup': (this.state.metrics?.acquisitions || []).filter(g => g > 0).length,
      'Elapsed time': `${Math.max(1, Math.round(((this.state.completedAt || Date.now()) - (this.state.startedAt || Date.now())) / 60000))} min`,
      'Active viewing': `${Math.round(this.engagement.snapshot().viewingMs / 1000)} sec`,
      'Time choosing': `${Math.round(this.engagement.snapshot().decisionMs / 1000)} sec`,
      'Skipped presentations': this.engagement.totals.skips },
    seed: this.state.seed,
    onChronicle: () => this.setState({ phase: 'playing' }, () => this.setView('chronicle')),
  };
}

/**
 * LedgerScreen model (PLAN §3.5, W2-UI-LOG WP-LEDGER): standings (powerTable rows + conq/claimed/delta/you), fallen
 * empires, map share, session line and header. Empty rows outside playing/victory.
 */
export function ledgerModel() {
  const st = this.state;
  return ledgerVM.buildLedger(st, ledgerContext.call(this), this.powerTable(isPlaying(st)));
}

/** ChronicleScreen model (PLAN §3.5): history, team filter list, activity feed, turning points and header. */
export function chronicleModel() {
  return ledgerVM.buildChronicle(this.state, ledgerContext.call(this));
}

/**
 * Match preview model for TacticalChoice (board 07: fixture header, stakes, both XIs, tale of the tape) → null without
 * a pending tactical gate. Needs an App delegate + the `preview` render prop (queued in APP-CHANGES.md, WP-LEDGER).
 */
export function matchPreviewModel() {
  const st = this.state;
  if (!isPlaying(st) || !st.tacticalChoice) return null;
  return ledgerVM.buildMatchPreview(st, this.viewContext());
}
