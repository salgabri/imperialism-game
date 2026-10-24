// Owner: WP-LEDGER (see PLAN.md §4). Ledger, Chronicle and Match-preview view-models (PLAN §3.6).
// Pure: (state, ctx) in, plain data out. No window/document/timers/RNG. Tolerates loading/setup state
// (teams {}, aliveIds [], board null), `stats: {}`, teams without baseEff and history entries without odds.
import { DEPENDENCIES, NATIONS, selectLineup, SCOPES } from '../data/teams.js';
import { CLUB_SCOPES } from '../data/scopes.js';
import { domesticLabel } from '../data/domesticScope.js';
import { getSport } from '../sports/index.js';
import { footballProfile } from '../sports/football.js';
import { basketballProfile } from '../sports/basketball.js';
import { campaignRecap, estimateSession } from '../engine/campaignExperience.js';
import { empireNeighbors } from '../engine/campaign.js';
import { FEED_CAP, domesticIdOf } from '../app/shared.js';
import { empireFill, V4 } from '../theme.js';
import {
  campaignTitle, displayRound, formatOddsPair, historyRound, plainScopeName, memo, ratingTier, roman, routeCopy, teamChip,
  territoryWord,
} from './format.js';
import { matchupOdds } from './odds.js';

/** Activity feed length: the frozen src/app/shared.js constant (PLAN §3.8), re-exported for the tests. */
export { FEED_CAP };

const RECAP_LABELS = { biggestUpset: 'Biggest upset', decisiveMatch: 'Decisive match', transferImpact: 'Transfer impact' };

function scopeNameOf(settings) {
  if (!settings) return '';
  try {
    // A country theatre ("England · top 100 clubs"), as App.scopeName names it.
    if (domesticIdOf(settings)) return domesticLabel(settings.clubScope) || '';
    if (settings.layer === 'clubs') {
      const scopes = CLUB_SCOPES(getSport(settings.sport));
      return plainScopeName((scopes.find(x => x.id === settings.clubScope) || scopes[0])?.name || '');
    }
    return plainScopeName(SCOPES.find(x => x.id === settings.scope)?.name || 'World War');
  } catch {
    return '';
  }
}

/**
 * 'The European Campaign' etc. (DEC misc); `ctx.scopeName` wins when the caller passes it. A campaign on a football
 * data set names its season ('The European Campaign · 2001/02').
 */
export function ledgerCampaignTitle(st, ctx) {
  const season = st?.settings?.dataSeason ? ` · ${st.settings.dataSeason}` : '';
  return `${campaignTitle(st?.settings, ctx?.scopeName || scopeNameOf(st?.settings))}${season}`;
}

function countBy(own) {
  const counts = new Map();
  for (const cid in own || {}) counts.set(own[cid], (counts.get(own[cid]) || 0) + 1);
  return counts;
}

function toneOfText(text) {
  const value = String(text ?? '');
  if (value.startsWith('+')) return 'gain';
  if (/^[−-]/.test(value)) return 'loss';
  return 'muted';
}

function lineupRating(team) {
  try { return selectLineup(team).rating; } catch { return 0; }
}

/** HEAD Sidebar `paused`: playback paused, a signing pending or a tactical choice pending. */
export function sessionPaused(st) {
  return !!(st?.paused || st?.choice || st?.tacticalChoice);
}

/**
 * 'Up to 20 games remaining · ~6 min' (+ ' · Paused', HEAD Sidebar L233) | 'Campaign complete' | null.
 */
export function sessionLine(st) {
  const alive = Array.isArray(st?.aliveIds) ? st.aliveIds.length : 0;
  if (!st?.settings || !alive) return null;
  let estimate;
  try { estimate = estimateSession(alive, st.settings, st.speed || 1, st.series || null); } catch { return null; }
  if (!estimate.games) return 'Campaign complete';
  const upTo = st.settings.finale === 'best-of-three';
  const minutes = Math.max(1, Math.ceil((estimate.seconds || 0) / 60));
  return `${upTo ? 'Up to ' : ''}${estimate.games} ${estimate.games === 1 ? 'game' : 'games'} remaining · ~${minutes} min`
    + (sessionPaused(st) ? ' · Paused' : '');
}

/** loserId → the history entry that eliminated it (newest wins). */
function eliminations(st, ctx) {
  return memo(ctx?.cache, 'ledger:eliminations', [st?.history], () => {
    const out = new Map();
    // A fallen team's last recorded loss is the one that eliminated it (series games come before it).
    for (const entry of st?.history || []) {
      const loserId = entry?.result?.loserId;
      if (loserId != null) out.set(String(loserId), entry);
    }
    return out;
  });
}

function fallenRows(st, ctx) {
  return memo(ctx?.cache, 'ledger:fallen', [st?.fallen, st?.teams, st?.history], () => {
    const teams = st?.teams || {};
    const byLoser = eliminations(st, ctx);
    return (st?.fallen || []).slice().reverse().map((entry, i) => {
      const id = entry?.id;
      const team = teams[id];
      const chip = teamChip(team) || { teamId: id ?? null, flagId: null, isClub: false, code: '', name: String(id ?? '') };
      const elimination = byLoser.get(String(id));
      const byName = elimination?.result?.winnerName || elimination?.winnerName || '';
      const round = Number(entry?.r) || historyRound(elimination);
      const numeral = roman(round);
      return {
        key: `${id}-${round}-${i}`, teamId: chip.teamId, flagId: chip.flagId, isClub: chip.isClub, code: chip.code,
        name: chip.name || String(id ?? ''), roman: numeral, byName,
        line: [numeral ? `Round ${numeral}` : '', byName ? `to ${byName}` : ''].filter(Boolean).join(' · '),
      };
    });
  });
}

/**
 * Top-`limit` share of the map. `fill` follows the map (A-7): only the managed empire is painted you-fill; a
 * spectator's followed empire keeps its pastel and is marked by the ink ring (`you`) alone.
 */
function shareRows(rows, youId, managedId, limit = 5) {
  const total = rows.reduce((sum, row) => sum + (Number(row.territories) || 0), 0);
  if (!total) return { rows: [], others: null, total: 0 };
  const sorted = rows.slice().sort((a, b) => (Number(b.territories) || 0) - (Number(a.territories) || 0) || a.rank - b.rank);
  const top = sorted.slice(0, limit);
  const pct = n => (n / total) * 100;
  const label = n => `${Math.round(pct(n))}%`;
  const shown = top.map(row => {
    const n = Number(row.territories) || 0;
    return { key: row.tid, teamId: row.tid, flagId: row.flagId, isClub: !!row.isClub, code: row.code, name: row.name,
      territories: n, pct: label(n), width: Math.round(pct(n) * 10) / 10, you: row.tid === youId,
      fill: managedId != null && row.tid === managedId ? V4.youFill : empireFill(row.tid) };
  });
  const rest = total - shown.reduce((sum, row) => sum + row.territories, 0);
  const others = sorted.length > limit && rest > 0
    ? { count: sorted.length - limit, territories: rest, pct: label(rest), width: Math.round(pct(rest) * 10) / 10 } : null;
  return { rows: shown, others, total };
}

/**
 * Ledger screen model (PLAN §3.5): standings rows = powerTable rows + { conq, claimed, delta, you },
 * fallen empires (newest first), map share, the session estimate and the screen header.
 */
export function buildLedger(st, ctx, powerRows) {
  const source = Array.isArray(powerRows) ? powerRows : [];
  const stats = st?.stats || {};
  const teams = st?.teams || {};
  const youId = ctx?.perspectiveId ?? ctx?.managedId ?? null;
  const rows = source.map(row => {
    const gainText = row?.effGain?.text ?? '±0.0';
    return {
      ...row,
      conq: String(stats[row.tid]?.conq ?? 0),
      claimed: String(stats[row.tid]?.steals?.length ?? 0),
      delta: { text: gainText, tone: toneOfText(gainText) },
      you: youId != null && row.tid === youId,
    };
  });
  const fallen = fallenRows(st, ctx);
  const total = Object.keys(teams).length;
  const alive = (st?.aliveIds || []).length;
  const round = displayRound(st);
  const title = ledgerCampaignTitle(st, ctx);
  return {
    rows,
    fallen,
    session: sessionLine(st),
    paused: sessionPaused(st),
    share: shareRows(rows, youId, ctx?.managedId ?? null),
    youId,
    youLabel: ctx?.managedId ? 'You' : youId != null ? 'Following' : '',
    header: {
      kicker: round ? `${title} · Round ${roman(round)}` : `${title} · Before the first match`,
      title: 'Ledger',
      stats: [
        { key: 'remain', label: 'Remaining', value: String(alive), sub: total ? `of ${total}` : '' },
        { key: 'fallen', label: 'Fallen', value: String(fallen.length), sub: '' },
        { key: 'matches', label: 'Matches', value: String(st?.matches ?? 0), sub: '' },
      ],
    },
    standingsAside: `${alive} ${alive === 1 ? 'empire' : 'empires'}`,
    fallenAside: fallen.length ? `${fallen.length} of ${total}` : 'None yet',
  };
}

/** One history list row (Chronicle): roman round, both sides, the result title and tags. */
export function historyRow(entry, { managedId = null, followedId = null } = {}) {
  const a = entry?.a || {};
  const b = entry?.b || {};
  const result = entry?.result || null;
  const aId = entry?.aId ?? a.teamId ?? a.tid ?? null;
  const bId = entry?.bId ?? entry?.dId ?? b.teamId ?? b.tid ?? null;
  const winnerName = result?.winnerName || entry?.winnerName || '';
  const loserName = result?.loserName || (winnerName && winnerName === a.name ? b.name : winnerName ? a.name : '') || '';
  const involved = id => id != null && (String(aId) === String(id) || String(bId) === String(id));
  const title = winnerName && loserName ? `${winnerName} beat ${loserName}` : (result?.title || '');
  return {
    id: entry?.id ?? null,
    roman: roman(historyRound(entry)),
    a: { name: a.name || '', code: a.code || '', flagId: a.id ?? null, isClub: !!a.isClub, score: a.score ?? '' },
    b: { name: b.name || '', code: b.code || '', flagId: b.id ?? null, isClub: !!b.isClub, score: b.score ?? '' },
    title,
    tie: result?.tieText || '',
    upset: !!result?.upset,
    claim: result?.player?.name ? `claims ${result.player.name}` : '',
    mine: managedId != null ? involved(managedId) : false,
    followed: managedId == null && followedId != null ? involved(followedId) : false,
  };
}

/** The strength gap a winner overturned: `upsetGap` (recordMatch), else read back from the two sides' `eff`. */
function upsetGapOf(entry) {
  if (Number.isFinite(entry?.upsetGap)) return entry.upsetGap;
  const effA = Number(entry?.a?.eff);
  const effB = Number(entry?.b?.eff);
  if (entry?.a?.eff == null || entry?.b?.eff == null || !Number.isFinite(effA) || !Number.isFinite(effB)) return NaN;
  const winnerId = entry?.result?.winnerId ?? entry?.winnerId;
  const aId = entry?.aId ?? entry?.a?.tid ?? entry?.a?.teamId;
  return winnerId != null && String(winnerId) === String(aId) ? effB - effA : effA - effB;
}

/**
 * "Biggest upset" with the app's one upset definition: the match flagged `result.upset` (the winner was at least
 * CONFIG.upsetThreshold weaker — the same flag the Upset tags, the Upsets chip and every Upsets count read) that
 * overturned the widest gap → null when no match is flagged. campaignRecap counts any underdog win instead.
 */
export function biggestUpsetLine(history) {
  let best = null;
  let bestGap = NaN;
  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry?.result?.upset) continue;
    const gap = upsetGapOf(entry);
    if (!best || (Number.isFinite(gap) && !(gap <= bestGap))) { best = entry; bestGap = gap; }
  }
  if (!best) return null;
  const name = best.result.winnerName || best.winnerName || 'The underdog';
  return Number.isFinite(bestGap) && bestGap > 0
    ? `${name} overturned a ${bestGap.toFixed(1)}-point strength gap`
    : `${name} won as the underdog`;
}

/** Matches the history filter (HEAD Sidebar belongsToHistoryFilter). */
export function inHistoryFilter(entry, filter) {
  return !filter || String(entry?.aId ?? entry?.a?.teamId ?? entry?.a?.id) === String(filter)
    || String(entry?.dId ?? entry?.bId ?? entry?.b?.teamId ?? entry?.b?.id) === String(filter);
}

/**
 * Board 06 chips (component-local, on top of the team filter): 'all' | 'mine' (your or your followed team's matches)
 * | 'upsets' | 'signings'.
 */
export function inHistoryKind(entry, kind, { managedId = null, followedId = null } = {}) {
  if (!kind || kind === 'all') return true;
  if (kind === 'upsets') return !!entry?.result?.upset;
  if (kind === 'signings') return !!entry?.result?.player;
  if (kind === 'mine') {
    const id = managedId ?? followedId;
    if (id == null) return false;
    const aId = entry?.aId ?? entry?.a?.teamId ?? entry?.a?.tid ?? null;
    const bId = entry?.bId ?? entry?.dId ?? entry?.b?.teamId ?? entry?.b?.tid ?? null;
    return String(aId) === String(id) || String(bId) === String(id);
  }
  return true;
}

/**
 * Chronicle screen model (PLAN §3.5): history, alphabetical team filter list, the activity feed (newest
 * first, FEED_CAP), turning points (campaignRecap) and the header.
 */
export function buildChronicle(st, ctx) {
  const history = Array.isArray(st?.history) ? st.history : [];
  const historyTeams = memo(ctx?.cache, 'ledger:historyTeams', [st?.teams, st?.aliveIds], () => {
    const alive = new Set(st?.aliveIds || []);
    return Object.values(st?.teams || {})
      .map(team => ({ id: team.id, name: team.name, alive: alive.has(team.id) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  });
  const feed = memo(ctx?.cache, 'ledger:feed', [st?.log], () => {
    const log = Array.isArray(st?.log) ? st.log : [];
    return log.slice().reverse().slice(0, FEED_CAP).map((entry, i) => ({
      key: `log-${log.length - 1 - i}`,
      round: `R${entry?.r ?? ''}`,
      roman: roman(entry?.r),
      kind: entry?.t || 'sys',
      chip: entry?.chip || null,
      color: entry?.col || null,
      text: entry?.txt || '',
    }));
  });
  const turning = memo(ctx?.cache, 'ledger:turning', [st?.history], () => {
    if (!history.length) return [];
    // campaignRecap formats numbers with toFixed; old or partial entries may lack them.
    const safe = history.map(entry => {
      const result = entry?.result;
      const fixGap = entry && !Number.isFinite(entry.upsetGap) ? { upsetGap: 0 } : null;
      const fixGain = result?.player && !Number.isFinite(result.strengthGain) ? { result: { ...result, strengthGain: 0 } } : null;
      return fixGap || fixGain ? { ...entry, ...fixGap, ...fixGain } : entry;
    });
    let recap;
    try { recap = { ...campaignRecap(safe), biggestUpset: biggestUpsetLine(history) }; } catch { return []; }
    return Object.keys(RECAP_LABELS)
      .filter(key => typeof recap?.[key] === 'string' && recap[key] && !/^No .* recorded$/.test(recap[key]))
      .map(key => ({ key, label: RECAP_LABELS[key], text: recap[key] }));
  });
  const upsets = history.filter(entry => entry?.result?.upset).length;
  const signings = history.filter(entry => entry?.result?.player).length;
  const seed = st?.seed ?? st?.settings?.seed;
  const title = ledgerCampaignTitle(st, ctx);
  return {
    history,
    historyTeams,
    feed,
    turning,
    managedId: ctx?.managedId ?? null,
    followedId: ctx?.managedId ? null : (ctx?.followedId ?? null),
    header: {
      kicker: seed != null && seed !== '' ? `${title} · seed ${seed}` : title,
      title: 'Chronicle',
      stats: [
        { key: 'matches', label: 'Matches', value: String(history.length) },
        { key: 'upsets', label: 'Upsets', value: String(upsets) },
        { key: 'signings', label: 'Signings', value: String(signings) },
      ],
    },
  };
}

function oddsRow(a, b, attacker, defender) {
  if (!Number.isFinite(attacker) || !Number.isFinite(defender)) return null;
  const { a: aText, b: bText } = formatOddsPair(attacker);
  return {
    aLabel: `${a.code} ${aText}`, bLabel: `${bText} ${b.code}`,
    fill: Math.round(Math.max(0, Math.min(1, attacker)) * 1000) / 10,
    aria: `${a.name} ${aText}, ${b.name} ${bText}`,
  };
}

/** The lineup's sport: ctx.sport (getSport object or id) → settings → the team's own sport. */
function sportIdOf(st, ctx, team) {
  const fromCtx = typeof ctx?.sport === 'string' ? ctx.sport : ctx?.sport?.id;
  return fromCtx || st?.settings?.sport || team?.sport || 'football';
}

/** DEC misc: basketball lineups read "Starting five"; `short` labels the lineup rating ("XI 84.6" / "Five 84.6"). */
export function lineupCopy(sportId) {
  return sportId === 'basketball' ? { label: 'Starting five', short: 'Five' } : { label: 'Starting XI', short: 'XI' };
}

/** Former team of a claimed player: `fromId` (DEC D8) → the team with that code. A flag only for nations. */
function claimedFrom(player, teams) {
  if (player?.from == null && player?.fromId == null) return null;
  const byId = player.fromId != null ? teams[player.fromId] : null;
  const from = byId || Object.values(teams).find(team => team?.code === player.from) || null;
  const joined = Number(player.joined) || 0;
  const code = player.from ?? from?.code ?? '';
  const numeral = joined ? `R ${roman(joined)}` : '';
  return {
    code, roman: numeral, label: [code, numeral].filter(Boolean).join(' · '),
    flagId: from && from.kind !== 'club' ? from.flagId ?? from.id ?? null : null,
    isClub: from ? from.kind === 'club' : false,
    color: from?.col ?? null,
  };
}

function lineupRows(team, teams) {
  let lineup;
  try { lineup = selectLineup(team); } catch { return { lineup: null, xi: '', rows: [] }; }
  return {
    lineup,
    xi: Number.isFinite(lineup.rating) ? lineup.rating.toFixed(1) : '',
    rows: lineup.starters.map((player, i) => {
      const rating = Math.round(Number(player.effectiveRating ?? player.rating) || 0);
      return {
        key: `${player.originalIndex ?? i}-${player.name}`,
        pos: player.assignedPos || player.pos || '',
        name: player.name || '',
        rating,
        tier: ratingTier(rating),
        outOfPosition: !!player.outOfPosition,
        claimed: claimedFrom(player, teams),
      };
    }),
  };
}

/** Board 07 tape scale: (v − 55) / 40, clamped to 4–100 % (fixed, so the leader is not always a full bar). */
export function tapeWidth(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(Math.max(4, Math.min(100, ((v - 55) / 40) * 100)) * 10) / 10;
}

function tapeRow(key, label, a, b) {
  const av = Number(a) || 0;
  const bv = Number(b) || 0;
  return { key, label, a: av.toFixed(1), b: bv.toFixed(1), aPct: tapeWidth(av), bPct: tapeWidth(bv),
    lead: av > bv ? 'a' : bv > av ? 'b' : null };
}

/**
 * Board 07 tale of the tape: the positional profile (football Attack / Defence / Goalkeeping, basketball Offence /
 * Defence) from the sports engines' frozen profile exports, then the lineup rating.
 */
function tapeRows(sportId, lineupA, lineupD, copy) {
  if (!lineupA || !lineupD) return [];
  let rows;
  try {
    if (sportId === 'basketball') {
      const pA = basketballProfile(lineupA), pD = basketballProfile(lineupD);
      rows = [['offence', 'Offence', pA.offence, pD.offence], ['defence', 'Defence', pA.defence, pD.defence]];
    } else {
      const pA = footballProfile(lineupA), pD = footballProfile(lineupD);
      rows = [['attack', 'Attack', pA.attack, pD.attack], ['defence', 'Defence', pA.defence, pD.defence],
        ['goalkeeping', 'Goalkeeping', pA.keeper, pD.keeper]];
    }
  } catch { rows = []; }
  rows.push(['lineup', copy.label, lineupA.rating, lineupD.rating]);
  return rows.map(([key, label, a, b]) => tapeRow(key, label, a, b));
}

/**
 * The fixture's route line, as the Next fixture block reads it (campaign.js routeLine): a draw carries `isNeighbor`;
 * a blitz/chaos gate starts with no route at all, so the land border is read from the board (ownership does not
 * change while the gate is pending).
 */
function previewRoute(ctx, aId, dId, route) {
  const source = route || {};
  let isNeighbor = typeof source.isNeighbor === 'boolean' ? source.isNeighbor : undefined;
  if (isNeighbor === undefined && ctx?.board?.geo?.adj && ctx.board.own) {
    try { isNeighbor = empireNeighbors(ctx.board, aId).has(dId); } catch { isNeighbor = undefined; }
  }
  return routeCopy({ routeKind: source.routeKind, isNeighbor }) || '';
}

/** A country map's section name (ctx.sectionNames), else the nation or dependency name. */
function territoryName(cid, ctx) {
  return ctx?.sectionNames?.[cid] || NATIONS[cid]?.[0] || DEPENDENCIES[cid]?.name || String(cid);
}

/** The territories `team` holds: its homeland first, then in `own` order. */
function heldTerritories(own, team) {
  const held = Object.keys(own || {}).filter(cid => own[cid] === team.id);
  const home = String(team.kind === 'club' ? team.home : team.id);
  const at = held.indexOf(home);
  if (at > 0) held.unshift(...held.splice(at, 1));
  return held;
}

/**
 * Board 07 stakes: "Annex 3 territories — Serbia, Kosovo, Montenegro — and claim one player" (first three names,
 * an ellipsis when there are more) / "Italy falls. Your campaign ends."; the best-of-three finale keeps its own copy.
 */
function stakesCopy(st, youTeam, themTeam, ctx) {
  // Best-of-three final: a game only decides the series for a side that already has a win (as turns.js targetStakes
  // does for the target card), so the preview and the card agree on the deciding game.
  const series = (st?.aliveIds || []).length === 2 && st?.settings?.finale === 'best-of-three';
  const ids = st?.series?.teamIds;
  const pair = Array.isArray(ids) && ids.includes(youTeam.id) && ids.includes(themTeam.id);
  const wins = id => (pair ? Number(st.series.wins?.[id]) || 0 : 0);
  const winDecides = !series || wins(youTeam.id) >= 1;
  const loseDecides = !series || wins(themTeam.id) >= 1;
  const held = heldTerritories(st?.own, themTeam);
  const names = held.slice(0, 3).map(cid => territoryName(cid, ctx)).join(', ') + (held.length > 3 ? '…' : '');
  return {
    win: !winDecides ? `${youTeam.name} moves one game closer to total conquest`
      : held.length
        ? `Annex ${held.length} ${territoryWord(held.length)} — ${names} — and claim one player`
        : `Claim one player from ${themTeam.name}`,
    lose: loseDecides ? `${youTeam.name} falls. Your campaign ends.` : `${themTeam.name} moves one game closer to total conquest`,
  };
}

/**
 * Match preview (TacticalChoice, v1 board 07 in v4) for the pending tactical gate → null without one.
 * { roman, kicker, lineupLabel, lineupShort, a, b (teamChip + role, eff, xi, you, territories, lineup), odds, samples,
 *   route, stakes: { win, lose } | null, tape[] }.
 */
export function buildMatchPreview(st, ctx) {
  const choice = st?.tacticalChoice;
  if (!choice) return null;
  // ctx.board is rebuilt per call: its `own` is st.own and its geo is the stable atlas, so those identities stand in.
  return memo(ctx?.cache, 'ledger:preview', [choice, st?.teams, st?.own, st?.settings, st?.series ?? null, ctx?.board?.geo ?? null], () => {
    const teams = st?.teams || {};
    const A = teams[choice.aId];
    const D = teams[choice.dId];
    if (!A || !D) return null;
    const managedId = ctx?.managedId ?? st?.managedTeamId ?? null;
    const sportId = sportIdOf(st, ctx, A);
    const copy = lineupCopy(sportId);
    const counts = countBy(st?.own);
    const lineups = new Map();
    const side = (team, role) => {
      const lineup = lineupRows(team, teams);
      lineups.set(team.id, lineup.lineup);
      return { ...teamChip(team), role, eff: lineup.xi || lineupRating(team).toFixed(1), xi: lineup.xi, you: team.id === managedId,
        territories: counts.get(team.id) || 0, lineup: lineup.rows };
    };
    const a = side(A, 'Attack');
    const b = side(D, 'Defend');
    const odds = matchupOdds(st, ctx, A.id, D.id);
    const balanced = (choice.options || []).find(option => option.id === 'balanced');
    const youAttack = managedId === A.id;
    const youDefend = managedId === D.id;
    const fallbackA = Number.isFinite(balanced?.winProbability) ? (youAttack ? balanced.winProbability : 1 - balanced.winProbability) : NaN;
    const pA = odds ? odds.attacker : fallbackA;
    const pD = odds ? odds.defender : 1 - fallbackA;
    const stakes = youAttack ? stakesCopy(st, A, D, ctx) : youDefend ? stakesCopy(st, D, A, ctx) : null;
    const round = displayRound(st);
    return {
      roman: roman(round),
      kicker: round ? `Round ${roman(round)} · Fixture` : 'Fixture',
      lineupLabel: copy.label,
      lineupShort: copy.short,
      a, b,
      odds: oddsRow(a, b, pA, pD),
      samples: odds?.samples ?? null,
      route: previewRoute(ctx, A.id, D.id, choice.route),
      stakes,
      tape: tapeRows(sportId, lineups.get(A.id), lineups.get(D.id), copy),
    };
  });
}
