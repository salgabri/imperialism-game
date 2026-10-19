// Owner: WP-MATCH (see PLAN.md §4). Live match view-models (PLAN §3.6, B§5, DEC D6/D7/D11).
// Pure: no window/document/timers/RNG. The live minute is NOT read here (it lives in the minute store, DEC D7);
// components pass it to buildFeedRows and to the win-probability series.
import { getSport } from '../sports/index.js';
import { selectLineup } from '../data/teams.js';
import { liveModelFor } from '../engine/winProbability.js';
import { roman, historyRound, formatOddsPair, ratingTier, shortName, memo } from './format.js';
import { idleTurnCopy } from './turns.js';

const BASKETBALL_GROUPS = ['PG', 'SG', 'SF', 'PF', 'C'];
const FOOTBALL_GROUPS = ['GK', 'DF', 'MF', 'FW'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const scoreText = (base, a, b) => `${base.aCode} ${a}–${b} ${base.bCode}`;

/** Normalised pre-match odds { a, b } from a number or { a, b? }; null when missing. */
function oddsOf(odds) {
  if (odds == null) return null;
  const a = typeof odds === 'number' ? odds : Number(odds.a);
  if (!Number.isFinite(a)) return null;
  const b = typeof odds === 'number' ? 1 - odds : (Number.isFinite(Number(odds.b)) && odds.b != null ? Number(odds.b) : 1 - a);
  return { a, b };
}

/** "Chiesa 23' · Raspadori 61'" (football) or "Jokić 14 pts · Murray 9 pts" (basketball: top two scorers). */
export function scorersLine(shown, teamId, teams, sportId = 'football') {
  const own = (Array.isArray(shown) ? shown : []).filter(e => e && e.tid === teamId && e.name);
  if (!own.length) return '';
  if (sportId === 'basketball') {
    const totals = new Map();
    for (const e of own) totals.set(e.name, (totals.get(e.name) || 0) + (Number(e.pts) || 0));
    return [...totals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2)
      .map(([name, pts]) => `${shortName(name)} ${pts} pts`).join(' · ');
  }
  return own.map(e => `${shortName(e.name)} ${Number(e.m) || 0}'`).join(' · ');
}

/** Where a claimed player came from (DEC D8), with a history fallback for older saves. */
function claimedTag(player, team, st) {
  const teams = st?.teams || {};
  if (!player || (!player.fromId && !player.from)) return null;
  let fromId = player.fromId && teams[player.fromId] ? player.fromId : null;
  let joined = Number.isFinite(Number(player.joined)) && player.joined != null ? Number(player.joined) : null;
  if (!fromId && player.from) fromId = Object.values(teams).find(t => t.code === player.from)?.id ?? null;
  if (joined == null || !fromId) {
    const entry = (st?.history || []).slice().reverse().find(h => h?.result?.player?.name === player.name
      && (h.result.winnerId ?? h.winnerId) === team.id);
    if (entry) {
      if (joined == null) joined = historyRound(entry) || null;
      if (!fromId && entry.result.loserId && teams[entry.result.loserId]) fromId = entry.result.loserId;
    }
  }
  const from = fromId ? teams[fromId] : null;
  const numeral = joined ? roman(joined) : '';
  return { teamId: fromId, flagId: from?.flagId ?? null, isClub: from?.kind === 'club', code: from?.code || player.from || '',
    color: from?.col || null, roman: numeral ? `R ${numeral}` : '',
    label: `Claimed from ${from?.name || player.from}${numeral ? ` in Round ${numeral}` : ''}` };
}

/** One XI table: starters in position-group order, each group by natural rating (B§1.5.3). */
function xiTable(team, st, sportId) {
  if (!team) return { title: '', teamId: null, rows: [] };
  let lineup;
  try { lineup = selectLineup(team); } catch { lineup = { starters: [] }; }
  const groups = sportId === 'basketball' ? BASKETBALL_GROUPS : FOOTBALL_GROUPS;
  const rank = pos => { const i = groups.indexOf(pos); return i < 0 ? groups.length : i; };
  const rows = (lineup.starters || []).map((p, i) => ({ p, i, pos: p.assignedPos || p.pos || '' }))
    .sort((x, y) => rank(x.pos) - rank(y.pos) || (Number(y.p.rating) || 0) - (Number(x.p.rating) || 0) || x.i - y.i)
    .map(({ p, pos }) => {
      const rating = Math.round(Number(p.effectiveRating ?? p.rating) || 0);
      return { key: `${team.id}-${p.originalIndex ?? p.name}`, pos, name: p.name || '', natural: p.pos || pos,
        rating, tier: ratingTier(rating), outOfPosition: !!p.outOfPosition, claimed: claimedTag(p, team, st) };
    });
  // DECISIONS (Misc): basketball lineups read "Starting five".
  const title = sportId === 'basketball' ? `${team.name} · Starting five` : `${team.name} · XI`;
  return { title, teamId: team.id ?? null, rows };
}

/**
 * The two squads as they kicked off. A settled conquest has already moved the claimed player (applyConquest pushes
 * him, tagged `fromId`/`from`, onto the end of the winner's squad and drops him from the loser's), and squads change
 * nowhere else; so undoing that one move gives back the lineups that played. `moved` = { player, winnerId, loserId }
 * where `player` is the pre-move copy (`match.playerTaken` / `history[i].result.player`). Pure: new team objects only.
 */
export function kickoffTeams(teams, aId, dId, moved) {
  const A = teams?.[aId], D = teams?.[dId];
  const player = moved?.player;
  const { winnerId, loserId } = moved || {};
  if (!A || !D || !player?.name || winnerId === loserId || ![aId, dId].includes(winnerId) || ![aId, dId].includes(loserId)) return { A, D };
  const W = teams[winnerId], L = teams[loserId];
  const wSquad = Array.isArray(W.squad) ? W.squad : [], lSquad = Array.isArray(L.squad) ? L.squad : [];
  let at = -1;
  for (let i = wSquad.length - 1; i >= 0 && at < 0; i--) {
    const p = wSquad[i];
    if (p?.name === player.name && (p.fromId === loserId || (p.fromId == null && p.from && p.from === L.code))) at = i;
  }
  // Not moved (yet), or already back: the current squads are the kickoff squads.
  if (at < 0 || lSquad.some(p => p?.name === player.name && p?.pos === player.pos && p?.rating === player.rating)) return { A, D };
  const before = {
    [winnerId]: { ...W, squad: wSquad.filter((_, i) => i !== at) },
    [loserId]: { ...L, squad: [...lSquad, { ...player }] },
  };
  return { A: before[aId], D: before[dId] };
}

function lineups(st, ctx, aId, dId, sportId, moved = null) {
  const teams = st?.teams || {};
  return memo(ctx?.cache, 'match:lineups', [teams[aId], teams[dId], st?.history, sportId, moved?.player ?? null, moved?.winnerId ?? null],
    () => {
      const { A, D } = kickoffTeams(teams, aId, dId, moved);
      return { a: xiTable(A, st, sportId), b: xiTable(D, st, sportId) };
    });
}

/** Overtime tie-breaks end at the last period played (DEC D6 "the end of the last overtime played"). */
const otOf = sport => Number(sport?.clock?.ot) || (sport?.tieBreak === 'overtime' ? 5 : 0);
function overtimeEnd(sport, length, periods) {
  const n = Number(periods) || 0, ot = otOf(sport);
  return sport?.tieBreak === 'overtime' && n > 0 && ot > 0 ? length + n * ot : 0;
}

/**
 * History keeps each event's formatted copy only ("GOAL — Name (ITA)", "+3 — Name (SRB)"): read the scorer and the
 * side back from it, so an archived full-time header carries the same scorer lines as the live one.
 */
const EVENT_COPY = /^(?:GOAL|\+(\d+))\s+—\s+(.+?)\s+\(([^()]*)\)$/;
function historyShown(entry, aId, dId, aCode, dCode) {
  const shown = [];
  for (const e of Array.isArray(entry?.events) ? entry.events : []) {
    const match = EVENT_COPY.exec(String(e?.text || '').trim());
    if (!match) continue;
    const tid = match[3] === aCode ? aId : match[3] === dCode ? dId : null;
    if (tid == null) continue;
    const minute = parseInt(e?.when, 10);
    shown.push({ tid, name: match[2], m: Number.isFinite(minute) ? minute : 0, pts: match[1] ? Number(match[1]) : 1 });
  }
  return shown;
}

function sideOf(team, side, score, scorers) {
  return { teamId: team?.id ?? null, flagId: team?.flagId ?? null, isClub: team?.kind === 'club', code: team?.code || '',
    color: team?.col || null, name: team?.name || '', side, score, scorers };
}

/** Plot from the managed side, else the followed side, else the attacker (DEC D6). */
function perspectiveOf(ctx, aTeam, dTeam, aId, dId) {
  const id = [ctx?.managedId, ctx?.followedId].find(x => x != null && (x === aId || x === dId));
  const side = id != null && id === dId ? 'D' : 'A';
  const team = side === 'D' ? dTeam : aTeam;
  return { side, teamId: team?.id ?? null, code: team?.code || '', name: team?.name || '' };
}

function preMatchOf(odds, aTeam, dTeam, effA, effD) {
  const o = oddsOf(odds);
  const fmt = v => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : null);
  // Both labels from the attacker's probability with one rounding (formatOddsPair), so the pair reads 100%.
  const pair = o ? formatOddsPair(o.a) : null;
  return {
    odds: o,
    aLabel: o ? `${aTeam?.code || aTeam?.name || ''} ${pair.a}` : null,
    bLabel: o ? `${pair.b} ${dTeam?.code || dTeam?.name || ''}` : null,
    fill: o ? Number((Math.max(0, Math.min(1, o.a)) * 100).toFixed(1)) : null,
    aria: o ? `${aTeam?.name} ${pair.a}, ${dTeam?.name} ${pair.b}` : null,
    effA: fmt(effA), effD: fmt(effD),
  };
}

function kickCounts(tieShown) {
  if (!tieShown) return null;
  const a = (tieShown.A || []).filter(Boolean).length, b = (tieShown.D || []).filter(Boolean).length;
  return { a, b, kicksA: tieShown.A || [], kicksB: tieShown.D || [] };
}

function nextFixtureText(st, ctx) {
  const teams = st?.teams || {};
  const pair = st?.tacticalChoice ? [st.tacticalChoice.aId, st.tacticalChoice.dId]
    : st?.spin?.stage === 'locked' ? [st.spin.attackerId, st.spin.targetId] : null;
  if (pair && teams[pair[0]] && teams[pair[1]]) return `Next fixture: ${teams[pair[0]].name} v ${teams[pair[1]].name}`;
  if (!(st?.aliveIds || []).length) return '';
  const copy = idleTurnCopy(st, ctx) || {};
  return [copy.title, copy.route].filter(Boolean).join(' · ');
}

const EMPTY = Object.freeze({
  empty: null, source: null, state: null, sport: 'football', statusLabel: '', statusDetail: null, live: false,
  a: null, b: null, minuteFallback: 0, minuteFloor: 0, length: 90, ot: 0, perspective: null, model: null,
  goals: [], final: null, chartNote: null, lineups: { a: { title: '', teamId: null, rows: [] }, b: { title: '', teamId: null, rows: [] } },
  feedBase: null, kicks: null, preMatch: null,
});

function fromMatch(st, ctx, sport, m) {
  const teams = st.teams;
  const A = teams[m.aId], D = teams[m.dId];
  const labels = sport.labels || {};
  const length = Number(sport.clock?.length) || 90;
  const shown = Array.isArray(m.shown) ? m.shown : [];
  const allEv = Array.isArray(m.allEv) ? m.allEv : shown;
  const lastTick = allEv.reduce((n, e) => Math.max(n, Number(e?.m) || 0), length);
  // The full-time minute: the last event, or the end of the last overtime period (same as the history fallback).
  const finalMinute = Math.max(lastTick, overtimeEnd(sport, length, (m.tie?.periods || []).length));
  const shootout = sport.tieBreak === 'shootout';
  const kicks = kickCounts(m.tieShown);
  const kicksPending = !!(kicks && m.tie && (kicks.kicksA.length < (m.tie.A || []).length || kicks.kicksB.length < (m.tie.D || []).length));
  const settled = m.applied || m.done;
  const state = !settled && m.status === labels.live ? 'live'
    : !settled && shootout && m.status === labels.tie && kicksPending ? 'penalties' : 'full-time';
  const scoreA = Number(m.ga) || 0, scoreB = Number(m.gd) || 0;
  const minuteFloor = shown.reduce((n, e) => Math.max(n, Number(e?.m) || 0), 0);
  let tieDetail = null;
  if (state === 'full-time' && m.tie) {
    tieDetail = shootout
      ? `${m.tie.ga ?? kicks?.a ?? 0}–${m.tie.gd ?? kicks?.b ?? 0} on penalties`
      : `after ${plural((m.tie.periods || []).length || 1, 'overtime period')}`;
  }
  const statusLabel = state === 'live' ? labels.live : state === 'penalties' ? labels.tie : labels.end;
  const statusDetail = state === 'penalties' ? `${kicks?.a ?? 0}–${kicks?.b ?? 0}` : tieDetail;
  let model = m.live ?? null;
  if (!model && !m.applied) {
    model = memo(ctx?.cache, 'match:live', [A, D, m.effA, m.effD, sport.id], () => {
      try { return liveModelFor(sport, A, D, m.effA, m.effD, m.matchDrama ?? ctx?.drama) ?? null; } catch { return null; }
    });
  }
  const winnerSide = m.winner === m.aId ? 'A' : m.winner === m.dId ? 'D' : scoreA > scoreB ? 'A' : scoreB > scoreA ? 'D' : null;
  const codeOf = id => teams[id]?.code || '';
  return {
    ...EMPTY,
    source: 'live', state, sport: sport.id, statusLabel, statusDetail, live: state === 'live',
    a: sideOf(A, 'Attack', scoreA, scorersLine(shown, A.id, teams, sport.id)),
    b: sideOf(D, 'Defend', scoreB, scorersLine(shown, D.id, teams, sport.id)),
    minuteFallback: state === 'live' ? minuteFloor : finalMinute, minuteFloor, length,
    ot: otOf(sport),
    perspective: perspectiveOf(ctx, A, D, m.aId, m.dId),
    model,
    goals: shown.map(e => ({ m: Number(e.m) || 0, tid: e.tid, pts: Number(e.pts) || 1 })),
    final: state === 'full-time' && winnerSide ? { winnerSide } : null,
    chartNote: model ? null : 'Live win probability is not available for this match.',
    // A settled conquest already moved the claimed player: the XIs show the kickoff squads, not today's.
    lineups: lineups(st, ctx, m.aId, m.dId, sport.id, m.applied && m.playerTaken
      ? { player: m.playerTaken, winnerId: m.winner, loserId: m.winner === m.aId ? m.dId : m.aId } : null),
    feedBase: {
      sport: sport.id, state, aCode: A.code || A.name, bCode: D.code || D.name, aName: A.name, bName: D.name,
      aId: m.aId, dId: m.dId, length, half: length / 2, finalMinute, scoreA, scoreB,
      kickoff: sport.id === 'basketball' ? 'Tip-off' : 'Kick-off', endLabel: sport.id === 'basketball' ? 'Final' : 'Full time',
      kicks: kicks ? { a: kicks.a, b: kicks.b } : null, tieDetail,
      events: shown.map((e, i) => ({ key: `e${i}`, m: Number(e.m) || 0, label: `${Number(e.m) || 0}'`, tid: e.tid,
        pts: Number(e.pts) || 1, text: sport.formatEvent(e, codeOf(e.tid)).text })),
    },
    kicks: kicks ? { a: kicks.kicksA, b: kicks.kicksB } : null,
    preMatch: preMatchOf(m.odds, A, D, m.effA, m.effD),
  };
}

/** DEC D11: no current match → the last finished match from history, in its full-time state. */
function fromHistory(st, ctx, sport, entry) {
  const teams = st.teams;
  const aId = entry.a?.teamId ?? entry.a?.tid ?? entry.aId, dId = entry.b?.teamId ?? entry.b?.tid ?? entry.dId ?? entry.bId;
  const A = teams[aId], D = teams[dId];
  if (!A || !D) return null;
  const length = Number(sport.clock?.length) || 90;
  const scoreA = Number(entry.a?.score) || 0, scoreB = Number(entry.b?.score) || 0;
  const events = (entry.events || []).map((e, i) => {
    const minute = parseInt(e?.when, 10);
    return { key: `h${i}`, m: Number.isFinite(minute) ? minute : null, label: e?.when || '', tid: null, pts: 0, text: e?.text || '' };
  });
  const winnerId = entry.result?.winnerId ?? entry.winnerId;
  const tieDetail = entry.result?.tieText || null;
  // The minute the match ended: the last timed event, or the end of the overtime the tie text records.
  const periods = /after\s+(\d+)\s+overtime\s+period/i.exec(tieDetail || '')?.[1];
  const lastEvent = events.reduce((n, e) => Math.max(n, Number(e.m) || 0), 0);
  const finalMinute = Math.max(length, lastEvent, overtimeEnd(sport, length, periods));
  const aCode = entry.a?.code || A.code, dCode = entry.b?.code || D.code;
  const scorers = historyShown(entry, aId, dId, aCode, dCode);
  // The last finished match is the latest conquest: undo its player move so the XIs show who played (DEC D11).
  const player = entry.result?.player;
  const moved = player?.name && winnerId != null
    ? { player, winnerId, loserId: entry.result?.loserId ?? (winnerId === aId ? dId : aId) } : null;
  return {
    ...EMPTY,
    source: 'history', state: 'full-time', sport: sport.id, statusLabel: sport.labels?.end || 'FULL TIME', statusDetail: tieDetail,
    live: false,
    a: sideOf(A, 'Attack', scoreA, scorersLine(scorers, aId, teams, sport.id)),
    b: sideOf(D, 'Defend', scoreB, scorersLine(scorers, dId, teams, sport.id)),
    minuteFallback: finalMinute, minuteFloor: finalMinute, length, ot: otOf(sport),
    perspective: perspectiveOf(ctx, A, D, aId, dId), model: null, goals: [],
    final: winnerId === aId ? { winnerSide: 'A' } : winnerId === dId ? { winnerSide: 'D' } : null,
    chartNote: 'The win-probability chart is drawn while a match is live.',
    lineups: lineups(st, ctx, aId, dId, sport.id, moved),
    feedBase: {
      sport: sport.id, state: 'full-time', aCode: A.code || A.name, bCode: D.code || D.name, aName: A.name, bName: D.name,
      aId, dId, length, half: length / 2, finalMinute, scoreA, scoreB,
      kickoff: sport.id === 'basketball' ? 'Tip-off' : 'Kick-off', endLabel: sport.id === 'basketball' ? 'Final' : 'Full time',
      kicks: null, tieDetail, events, roundLabel: historyRound(entry) ? `Round ${roman(historyRound(entry))}` : null,
    },
    kicks: null,
    preMatch: preMatchOf(entry.odds, A, D, entry.a?.eff, entry.b?.eff),
  };
}

/** The Match view model (PLAN §3.5 MatchScreen, B§5). Tolerates loading/setup phases and partial fixtures. */
export function buildLiveMatch(st, ctx) {
  const sport = ctx?.sport || getSport(st?.settings?.sport);
  const teams = st?.teams || {};
  const m = st?.match;
  if (m && teams[m.aId] && teams[m.dId]) return fromMatch({ ...st, teams }, ctx, sport, m);
  const last = Array.isArray(st?.history) ? st.history.at(-1) : null;
  const archived = last ? fromHistory({ ...st, teams }, ctx, sport, last) : null;
  if (archived) return archived;
  return { ...EMPTY, sport: sport?.id || 'football', empty: { title: 'No match yet', text: nextFixtureText(st, ctx) } };
}

/**
 * Dark match-feed rows at `minute` (B§1.7): status row first (Live / Penalties / Full time), then goals, half-time
 * and kick-off newest first. Copy in sentence case; the feed uppercases it with CSS.
 * → [{ key, minute: "38'", text, weight: 500|600|700, status: bool, live: bool }]
 */
export function buildFeedRows(model, minute) {
  const base = model?.feedBase;
  if (!base) return [];
  const now = Math.max(0, Math.floor(Number(minute) || 0));
  const state = base.state || 'live';
  const events = Array.isArray(base.events) ? base.events : [];
  const rows = events.map((e, i) => ({ key: e.key || `e${i}`, n: e.m ?? i, i, minute: e.label || `${e.m ?? 0}'`, text: e.text, weight: 700 }));
  const scored = (tid, limit) => events.reduce((n, e) => n + (e.tid === tid && e.m != null && e.m <= limit ? (e.pts || 1) : 0), 0);
  const known = events.every(e => e.tid != null && e.m != null);
  const reached = state !== 'live' || now >= base.half;
  if (known && reached && base.half > 0) {
    rows.push({ key: 'half', n: base.half + .5, i: -1, minute: `${base.half}'`, weight: 500,
      text: `Half-time — ${scoreText(base, scored(base.aId, base.half), scored(base.dId, base.half))}` });
  }
  if (known && base.sport === 'basketball' && (state !== 'live' ? base.finalMinute > base.length : now > base.length)) {
    const ra = scored(base.aId, base.length), rb = scored(base.dId, base.length);
    rows.push({ key: 'overtime', n: base.length + .5, i: -1, minute: `${base.length}'`, weight: 500,
      text: `Overtime — ${scoreText(base, ra, rb)}` });
  }
  rows.push({ key: 'kickoff', n: -1, i: -1, minute: "0'", weight: 500, text: `${base.kickoff} — ${base.aName} attack ${base.bName}` });
  rows.sort((x, y) => y.n - x.n || y.i - x.i);
  let top;
  if (state === 'live') {
    const left = base.length - now;
    const tail = left > 0 ? `${plural(left, 'minute')} left` : base.sport === 'basketball' && now > base.length ? 'overtime' : 'final minute';
    top = { key: 'status', minute: `${now}'`, weight: 600, live: true, text: `Live — ${scoreText(base, base.scoreA, base.scoreB)} · ${tail}` };
  } else if (state === 'penalties') {
    top = { key: 'status', minute: `${base.finalMinute}'`, weight: 600, live: false,
      text: `Penalties — ${scoreText(base, base.scoreA, base.scoreB)} · ${base.kicks?.a ?? 0}–${base.kicks?.b ?? 0}` };
  } else {
    top = { key: 'status', minute: `${base.finalMinute}'`, weight: 600, live: false,
      text: `${base.endLabel} — ${scoreText(base, base.scoreA, base.scoreB)}${base.tieDetail ? ` · ${base.tieDetail}` : ''}` };
  }
  return [{ ...top, status: true }, ...rows.map(({ key, minute: label, text, weight }) => ({ key, minute: label, text, weight, status: false, live: false }))];
}
