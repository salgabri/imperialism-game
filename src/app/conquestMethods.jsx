// Owner: WP-CONQ (see PLAN.md §4). Result, signing gate, conquest and map-notice method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// HEAD bodies were moved verbatim from App.jsx in W1 (§4.10); call other App methods through `this.x()`.
// W2 wiring (WP-CONQ): signing gate framing + `choice.selected`, claimed-player provenance (DEC D8), v4 notice copy,
// and the render-time models (conquest article, elimination article, callout anchor). Render-called functions are
// pure: no window/document/timers/setState/RNG, and they return their empty value outside playing/victory.
import React from 'react';
import { CONFIG } from '../config.js';
import { C } from '../theme.js';
import { selectLineup, teamEff } from '../data/teams.js';
import { empireCenter, territories } from '../engine/campaign.js';
import { acquisitionOptions, automaticAcquisition, advanceSeries, recordMatch } from '../engine/campaignExperience.js';
import { MatchupPopup, ResultPopup, StealPopup } from '../components/Popups.jsx';
import ConquestCallout from '../screens/conquest/ConquestCallout.jsx';
import * as conqVM from '../viewModels/conquest.js';
import { memo, roman, territoryWord } from '../viewModels/format.js';
import { BATTLE_SCARS, LOG_CAP } from './shared.js';

/** Render-time builders only run on a campaign (PLAN rule 9). */
function inCampaign(st) {
  return st?.phase === 'playing' || st?.phase === 'victory';
}

/** Sport labels are stored upper case ('FULL TIME'); notices take source case and CSS uppercases them (rule 15). */
function sentenceCase(text) {
  const value = String(text || '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : '';
}

/**
 * Camera fields for the signing screen (A-2, DEC D15) computed on the would-be state `st` (with its `choice` and
 * decided `match`): fit the taken land (overseas dependencies excluded) beside the article. Returned for a setState;
 * `focusBounds`/`focusKey` only when there is geometry to frame. Pure (no setState, no RNG).
 */
export function conquestFocus(st = this.state) {
  const preview = conqVM.buildConquestPreview(st, this.viewContext(st));
  return { focusLayout: 'conquest',
    ...(preview?.bounds ? { focusBounds: preview.bounds, focusKey: (Number(st.focusKey) || 0) + 1 } : {}) };
}

// ---------- one settlement per match ----------

/**
 * Settlements by match. React commits a timer's setState in a later task, so a primary action in between still reads
 * the unapplied match: step() → fastForward() → revealAll() then queues that stale copy over the settled match
 * (`patchMatch` spreads `this.state.match`) and schedules another finishMatch, which would annex, claim, archive or
 * count the series game a second time on the already-settled campaign. So every settlement is recorded against the
 * match's event list (`allEv`: one array per simulated match, kept by every `{ ...match, ...patch }` copy, new on a
 * load) with the App, the pairing, the state it was computed from and a test for the state it produces. Recording and
 * lookup touch no state, timers or RNG; a repeated finish only puts the settled match back (restoreSettled).
 */
const SETTLED = new WeakMap();

function recordSettlement(app, from, record) {
  const m = from.match;
  if (m?.allEv && typeof m.allEv === 'object') {
    SETTLED.set(m.allEv, { app, from, aId: m.aId, dId: m.dId, winner: m.winner, ...record });
  }
}

/**
 * The settlement already made for this match while it still stands: pending (`this.state` is still the state it was
 * computed from, nothing committed since) or committed (`holds`). Null for a match nobody settled.
 */
function settlementOf(app, m) {
  const record = m?.allEv && typeof m.allEv === 'object' ? SETTLED.get(m.allEv) : null;
  if (!record || record.app !== app || record.aId !== m.aId || record.dId !== m.dId || record.winner !== m.winner) return null;
  return app.state === record.from || record.holds(app.state) ? record : null;
}

/** A repeated finish changes nothing but the match: put the settled one back over a stale unapplied copy. */
function restoreSettled(app, match) {
  app.setState(state => (state.match && state.match.allEv === match.allEv && !state.match.applied ? { match } : null));
}

/**
 * Apply the result: the loser is eliminated, every territory it held passes to
 * the winner, and its best player switches allegiance. Runs once per match (settlementOf).
 */
export function finishMatch() {
  const st = this.state;
  let m = st.match;
  if (!m || m.applied || st.choice) return;
  const settled = settlementOf(this, m);
  if (settled?.match) { restoreSettled(this, settled.match); return; }
  // The series already counted this game (only a stale copy lost the flag): go on to the conquest.
  if (settled?.series && !m.seriesResolved) m = { ...m, seriesResolved: true, series: settled.view };
  if (st.series && !m.seriesResolved) {
    const next = advanceSeries(st.series, m.aId, m.dId, m.winner);
    const seriesView = { aWins: next.series.wins[m.aId], bWins: next.series.wins[m.dId], bestOf: 3 };
    if (!next.complete) {
      const completed = { ...m, ga: m.finalGa, gd: m.finalGd, applied: true, done: true, seriesResolved: true,
        noConquest: true, series: seriesView, status: this.sport().labels.end,
        winnerName: st.teams[m.winner].name, resTitle: `${st.teams[m.winner].name} wins the series game`,
        resText: 'First to two wins claims the opposing empire. No territory or player changes yet.' };
      const view = this.matchCard(completed);
      const entry = recordMatch({ ...st, sport: this.sport() }, completed, view);
      recordSettlement(this, st, { match: completed, holds: state => !!state.history?.includes(entry) });
      this.setState({ series: next.series, match: completed, matches: st.matches + 1,
        history: [...st.history, entry], queue: [],
        log: [...st.log, { t: 'match', r: st.round, txt: `${completed.winnerName} wins finale game ${next.series.games}; series continues.`, chip: C.gold }] },
        () => { this.persist(); if (this.state.autoplay) this.after(st.settings.express ? 120 : 1000, () => this.nextAction()); });
      return;
    }
    recordSettlement(this, st, { series: next.series, view: seriesView, holds: state => state.series === next.series });
    this.setState({ series: next.series, match: { ...m, seriesResolved: true, series: seriesView } }, () => this.finishMatch());
    return;
  }
  const loserId = m.winner === m.aId ? m.dId : m.aId;
  if (this.managedId(st) === m.winner && st.teams[loserId].squad.length) {
    this.clearTimers();
    const candidates = acquisitionOptions(st.teams[m.winner], st.teams[loserId]);
    // DEC D15: the highlighted signing starts on the repo's best lineup fit; selectAcquisition moves it.
    const choice = { winnerName: st.teams[m.winner].name, loserName: st.teams[loserId].name,
      candidates, selected: candidates[0]?.index, resumeAutoplay: st.autoplay, openedAt: Date.now() };
    const match = { ...m, ga: m.finalGa, gd: m.finalGd, shown: m.allEv, status: 'Choose a signing' };
    // clearTimers() cancelled any pending toast/notice clear, so drop them with the timers (the decision holds the map).
    this.setState({ choice, autoplay: false, paused: false, match, toast: null, pu: null,
      ...conquestFocus.call(this, { ...st, choice, match }) }, () => this.persist());
    return;
  }
  this.applyConquest();
}

export function applyConquest(playerIndex) {
  const st = this.state;
  let m = st.match;
  if (!m || m.applied) return;
  // Once per match: a repeated finish (stale read, see SETTLED) only restores the settled match.
  const settled = settlementOf(this, m);
  if (settled?.match) { restoreSettled(this, settled.match); return; }
  if (settled?.series && !m.seriesResolved) m = { ...m, seriesResolved: true, series: settled.view };

  const winnerId = m.winner;
  const loserId = winnerId === m.aId ? m.dId : m.aId;
  const battleAt = empireCenter(this.board(), loserId);

  const teams = { ...st.teams };
  const W = { ...teams[winnerId], squad: teams[winnerId].squad.slice() };
  const L = { ...teams[loserId], squad: teams[loserId].squad.slice() };
  const strengthBefore = teamEff(W);
  const beforeLineup = selectLineup(W);
  const selectedCandidate = Number.isInteger(playerIndex) ? null : automaticAcquisition(W, L, st.settings.acquisitionPolicy);
  const stolen = L.squad[Number.isInteger(playerIndex) ? playerIndex : selectedCandidate?.index];
  if (stolen) {
    // Claimed provenance (DEC D8): former team id + code, the round it joined; `from` keeps its HEAD meaning.
    W.squad.push({ ...stolen, from: L.code, fromId: loserId, joined: st.round });
    L.squad = L.squad.filter(p => p !== stolen);
  }
  const strengthAfter = teamEff(W);
  const afterLineup = selectLineup(W);
  const replacedPlayer = beforeLineup.starters.find(p => !afterLineup.starters.some(q => q.originalIndex === p.originalIndex)) || null;
  const strengthGained = Math.round((strengthAfter - strengthBefore) * 10) / 10;
  // ... and the XI strength delta the signing made (DEC D8), stored on the moved player itself.
  if (stolen) W.squad[W.squad.length - 1] = { ...W.squad[W.squad.length - 1], claimGain: strengthGained };
  teams[winnerId] = W;
  teams[loserId] = L;

  const own = { ...st.own };
  const taken = [];
  for (const cid in own) {
    if (own[cid] === loserId) {
      own[cid] = winnerId;
      taken.push(cid);
    }
  }
  const aliveIds = st.aliveIds.filter(t => t !== loserId);

  const stats = { ...st.stats };
  const ws = { ...(stats[winnerId] || { conq: 0, steals: [] }) };
  ws.conq += 1;
  if (stolen) ws.steals = ws.steals.concat([stolen.name]);
  stats[winnerId] = ws;

  const effW = winnerId === m.aId ? m.effA : m.effD;
  const effL = winnerId === m.aId ? m.effD : m.effA;
  const isUpset = effW + Number(CONFIG.upsetThreshold) <= effL;
  const sport = this.sport();
  const tieTxt = m.tie ? ' (' + m.tie.ga + '–' + m.tie.gd + ' ' + sport.labels.tieShort + ')' : '';
  const A = teams[m.aId];
  const B = teams[m.dId];
  const terrWord = 'TERRITOR' + (taken.length === 1 ? 'Y' : 'IES');

  const entries = [
    { t: 'match', r: st.round, txt: A.code + ' ' + m.finalGa + '–' + m.finalGd + ' ' + B.code + tieTxt, chip: W.col, col: C.textSoft },
  ];
  if (isUpset) {
    entries.push({
      t: 'upset',
      r: st.round,
      txt: 'GIANT-KILLING — ' + W.name.toUpperCase() + ' (' + effW.toFixed(0) + ') TOPPLES ' + L.name.toUpperCase() + ' (' + effL.toFixed(0) + ')',
      chip: C.gold,
      col: C.gold,
    });
  }
  entries.push({
    t: 'elim',
    r: st.round,
    txt: L.name.toUpperCase() + ' FALLS — ' + taken.length + ' ' + terrWord + ' ANNEXED BY ' + W.name.toUpperCase(),
    chip: C.red,
    col: C.text,
  });
  if (stolen) {
    entries.push({
      t: 'steal',
      r: st.round,
      txt: W.code + ' CLAIMS ' + stolen.name.toUpperCase() + ' (' + stolen.rating + ' ' + stolen.pos + ') FROM ' + L.code,
      chip: C.cyan,
      col: C.cyan,
    });
  }
  if (aliveIds.length === 1) {
    entries.push({ t: 'champ', r: st.round, txt: W.name.toUpperCase() + ' RULES THE MAP — TOTAL CONQUEST', chip: W.col, col: C.gold });
  }

  const managerLost = this.managedId(st) === loserId;
  // The hatch clears on a 1.5s clock token; the defeat pauses the clock with no such token (the elimination article
  // waits on the manager), so a defeat leaves no hatch behind for the spectator's campaign.
  const flash = {};
  if (!managerLost) for (const cid of taken) flash[cid] = true;
  const stealTxt = stolen ? ' · steals ' + stolen.name + ' (' + stolen.rating + ' ' + stolen.pos + ')' : '';
  const completed = {
    ...m, ga: m.finalGa, gd: m.finalGd, shown: m.allEv, applied: true, done: true,
    status: sport.labels.end, isUpset,
    resText: '+' + taken.length + ' territories' + stealTxt,
    resTitle: W.name.toUpperCase() + ' ANNEXES ' + L.name.toUpperCase(),
    wCol: W.col, winnerName: W.name, loserName: L.name, territoriesGained: taken.length,
    // Section names on a country map ("Burnley"), nation or dependency names on the world map.
    territoryIds: taken, territoryNames: taken.map(cid => this.territoryName(cid)),
    playerTaken: stolen ? { ...stolen } : null,
    replacedPlayer, strengthBefore, strengthAfter, strengthGained,
    acquisitionPolicy: Number.isInteger(playerIndex) ? 'manager-choice' : st.settings.acquisitionPolicy,
  };
  const archived = recordMatch({ ...st, sport }, completed, this.matchCard(completed, teams));
  const leader = aliveIds.slice().sort((a, b) => territories({ own }, b).length - territories({ own }, a).length)[0];
  const metrics = { ...st.metrics, previousLeader: leader,
    leaderChanges: (st.metrics?.leaderChanges || 0) + (st.metrics?.previousLeader && st.metrics.previousLeader !== leader ? 1 : 0),
    acquisitions: [...(st.metrics?.acquisitions || []), strengthGained] };
  const stopForFollow = st.pauseFollow && [m.aId, m.dId].includes(st.followedId);
  if (m.express) this.engagement.count('compressedMatches');
  const managerElimination = managerLost ? { teamId: loserId, opponentId: winnerId, matchId: archived.id,
    teamName: L.name, opponentName: W.name, score: `${m.finalGa}–${m.finalGd}${tieTxt}`,
    placement: aliveIds.length + 1, conquests: st.stats[loserId]?.conq || 0, signings: st.stats[loserId]?.steals?.length || 0 } : null;

  recordSettlement(this, st, { match: completed, holds: state => !!state.history?.includes(archived) });
  this.setState(
    {
      teams,
      own,
      aliveIds,
      stats,
      fallen: st.fallen.concat([{ id: loserId, r: st.round }]),
      flash,
      atk: null,
      battles: (st.battles || []).concat([{ x: battleAt.x, y: battleAt.y }]).slice(-BATTLE_SCARS),
      matches: st.matches + 1,
      log: st.log.concat(entries).slice(-LOG_CAP),
      match: completed, history: [...st.history, archived], metrics, conquestIds: taken,
      choice: null, autoplay: stopForFollow || managerLost ? false : st.autoplay,
      managerElimination, paused: managerLost,
      // The defeat cancels every clock token below (clearTimers + pause), including the kick-off notice's and a goal
      // toast's clear: drop them with it, or they stay over the map beside the elimination article.
      ...(managerLost ? { pu: null, toast: null } : {}),
      completedAt: aliveIds.length === 1 ? Date.now() : st.completedAt,
      // The signing screen's framing ends with the decision; WorldMap restores the camera it had before (A-2).
      focusLayout: null,
    },
    () => {
      this.persist();
      if (managerLost) { this.clearTimers(); this.clock.pause(); return; }
      this.after(1500, () => this.setState({ flash: {} }));

      if (st.settings.express) {
        if (aliveIds.length === 1) this.after(200, () => this.setState({ phase: 'victory', autoplay: false }, () => this.persist()));
        else if (this.state.autoplay) this.after(m.express ? 12 : 650, () => this.nextAction());
        return;
      }

      // v4 white map notices (DEC D15): copy in source case, the notice CSS uppercases the label/title/sub lines.
      const resultLabel = sentenceCase(m.tie ? sport.labels.tie : sport.labels.end);
      const roundNumeral = roman(st.round);
      this.showPopup(
        {
          kind: 'result',
          label: roundNumeral ? `${resultLabel} — Round ${roundNumeral}` : resultLabel,
          score: `${A.code} ${m.finalGa}–${m.finalGd} ${B.code}${m.tie ? ` · ${m.tie.ga}–${m.tie.gd} ${sport.labels.tieShort}` : ''}`,
          title: `${W.name} annexes ${L.name}`,
          sub: `+${taken.length} ${territoryWord(taken.length)}`,
          upset: isUpset,
          col: W.col,
        },
        1750,
      );
      if (stolen) {
        this.after(1820, () =>
          this.showPopup(
            {
              kind: 'steal',
              sName: stolen.name,
              sMeta: `Rating ${stolen.rating} · ${stolen.pos}`,
              sFrom: L.code,
              sFromId: L.flagId,
              sFromCol: L.col,
              sTo: W.code,
              sToId: W.flagId,
              sToCol: W.col,
              sSub: `Joins ${W.name}`,
            },
            1900,
          ),
        );
      }

      const doneAt = stolen ? 3900 : 1950;
      if (aliveIds.length === 1) {
        this.after(doneAt + 250, () => this.setState({ phase: 'victory', autoplay: false }, () => this.persist()));
      } else if (this.state.autoplay) {
        // Mid-batch runs back-to-back; a fresh round gets a beat of breathing room.
        this.after(this.state.queue.length ? doneAt : doneAt + 120, () => { if (this.state.autoplay) this.nextAction(); });
      }
      // Paused mid-batch: the next match waits for STEP.
    },
  );
}

/**
 * The transient map notice (v4 white panels, DEC D15): match-up, result or claimed player. Called from render outside
 * the `playing` guard, so it is pure and empty outside a campaign; hidden on the conquest view by popups.css.
 */
export function renderPopup() {
  const st = this.state;
  const pu = st?.pu;
  if (!pu || !inCampaign(st)) return null;
  if (pu.kind === 'vs') {
    return (
      <MatchupPopup
        label={pu.label}
        a={{ id: pu.aId, code: pu.aCode, color: pu.aCol, name: pu.aName, eff: pu.aEff }}
        b={{ id: pu.bId, code: pu.bCode, color: pu.bCol, name: pu.bName, eff: pu.bEff }}
      />
    );
  }
  if (pu.kind === 'result') {
    return <ResultPopup label={pu.label} score={pu.score} title={pu.title} sub={pu.sub} upset={pu.upset} color={pu.col} />;
  }
  return (
    <StealPopup
      name={pu.sName}
      meta={pu.sMeta}
      from={pu.sFrom}
      fromId={pu.sFromId}
      fromColor={pu.sFromCol}
      to={pu.sTo}
      toId={pu.sToId}
      toColor={pu.sToCol}
      sub={pu.sSub}
    />
  );
}

// ---------- render-time models (PLAN §3.3, §3.6; pure, memo keys `conq:`) ----------

/**
 * The signing screen's projected map (§3.6, FROZEN shape) — post-conquest ownership, taken ids, figures, frame.
 * Memoised on the state identities it reads plus the path maps the bounds come from (fitMap replaces them).
 * Null without a pending signing or outside a campaign. WP-MAP reads it for the projected fills and the hatch.
 */
export function conquestPreview() {
  const st = this.state;
  if (!st?.choice || !inCampaign(st)) return null;
  const ctx = this.viewContext();
  return memo(ctx.cache, 'conq:preview',
    [st.choice, st.match, st.own, st.teams, st.aliveIds, ctx.geo?.paths ?? null, ctx.displayGeo?.paths ?? null],
    () => conqVM.buildConquestPreview(st, ctx));
}

/**
 * ConquestScreen model (§3.5, D§5–§8): kicker, headline, winner-first standfirst, effects, the option rows with
 * `choice.selected` (else the best lineup fit), the "Sign <player>" footer and the lineup comparison.
 * Without a pending signing it keeps the W1 stub shape, which ConquestScreen still understands.
 */
export function conquestModel() {
  const st = this.state;
  const stub = { choice: st?.choice || null, selectedIndex: this.selectedCandidate()?.index ?? null };
  if (!st?.choice || !inCampaign(st)) return stub;
  return conqVM.buildConquest(st, this.viewContext(), this.conquestPreview()) || stub;
}

/**
 * ManagerElimination article model (§3.5, DEC D15): "<Team> is out" + winner-first standfirst; null when none. While
 * Retry this setup loads a data set campaign's set, or after it failed to, the note says so in place of the save line.
 */
export function eliminationModel() {
  const st = this.state;
  if (!st?.managerElimination || !inCampaign(st)) return null;
  const model = conqVM.buildElimination(st, this.viewContext());
  const retry = st.retrySetup?.elimination === st.managerElimination ? st.retrySetup : null;
  return retry && model ? { ...model, note: retry.message, noteTone: retry.state === 'error' ? 'unsaved' : null } : model;
}

/**
 * Map anchor for the "+N Territories taken" callout at the centre of the taken land (D§2.4, A-2): WorldMap converts the
 * map-unit point to px and clamps it; conquest.css nudges the card a quarter of its width left and up of that point
 * (on the phone, up until its bottom edge is just above it) so the hatch stays visible, and fades it in after the
 * hatch. [] without geometry.
 */
export function conquestAnchors() {
  const st = this.state;
  if (!st?.choice || !inCampaign(st)) return [];
  const callout = conqVM.buildConquestCallout(st, this.viewContext(), this.conquestPreview());
  if (!callout) return [];
  return [{ key: callout.key, x: callout.x, y: callout.y, align: callout.align,
    node: <ConquestCallout figure={callout.figure} label={callout.label} sub={callout.sub} /> }];
}
