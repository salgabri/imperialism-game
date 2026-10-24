// Owner: WP-COL (see PLAN.md §4). Campaign column, ticker and map-overlay view-models (PLAN §3.5, §3.6).
// Pure: (state, ctx) in, plain data out. No window/document/timers/RNG (win chances use the estimator's own
// seeded generator through odds.js, DEC D5). Tolerates loading/setup state (teams {}, aliveIds [], board null),
// `stats: {}`, teams without baseEff, and matches/history entries without odds, routeKind, live or tactic
// (smoke injects such matches). Memo keys carry the `col:` prefix (PLAN rule 16).
import { SCOPES, teamEff } from '../data/teams.js';
import { CLUB_SCOPES } from '../data/scopes.js';
import { domesticLabel } from '../data/domesticScope.js';
import { getSport } from '../sports/index.js';
import { domesticIdOf } from '../app/shared.js';
import { empireNeighbors, territories } from '../engine/campaign.js';
import { reachableTargets } from '../engine/turns.js';
import { empireFill, MAP } from '../theme.js';
import { idleTurnCopy } from './turns.js';
import { strengthSteps } from './map.js';
import { matchupOdds, winChanceFor } from './odds.js';
import {
  campaignTitle, displayRound, formatOddsPair, formatWinChance, historyRound, memo, plainScopeName, roman, routeCopy, winTone,
} from './format.js';

const NO_ACTIONS = Object.freeze({ preview: false, simulate: false });
/** Route line while the compass spins (fixture block and the spectator's draw card). */
const COMPASS_CHOOSING = 'The compass is choosing the target';

// ---------- small helpers ----------

function strengthOf(team) {
  if (!team) return null;
  try {
    const value = teamEff(team);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const oneDecimal = value => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—');

function roundLabel(n) {
  const numeral = roman(n);
  return numeral ? `Round ${numeral}` : '';
}

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

function aliveSet(st) {
  return new Set(Array.isArray(st?.aliveIds) ? st.aliveIds : []);
}

/**
 * The route line for a fixture. A draw carries `isNeighbor`; a match only keeps `routeKind`, so the land
 * border is read from the board (ownership has not changed while the fixture is pending or live).
 */
function routeLine(ctx, aId, dId, route) {
  const source = route || {};
  let isNeighbor = typeof source.isNeighbor === 'boolean' ? source.isNeighbor : undefined;
  if (isNeighbor === undefined && ctx?.board?.geo?.adj && ctx.board.own) {
    try { isNeighbor = empireNeighbors(ctx.board, aId).has(dId); } catch { isNeighbor = undefined; }
  }
  return routeCopy({ routeKind: source.routeKind, isNeighbor }) || null;
}

/** Both sides of a fixture's win chance from the attacker's probability (shared: format.js formatOddsPair). */
const oddsPair = formatOddsPair;

/** DEC D5 tone of a displayed integer percentage (oddsPair's aShown/bShown). */
const shownTone = shown => winTone(shown / 100);

/** Odds row: "SRB 37%" [bar filled to the attacker's %] "63% ITA" (A§5, README §A). */
function oddsRow(A, B, pA) {
  const p = Number(pA);
  if (pA == null || !Number.isFinite(p) || !A || !B) return null;
  const clamped = Math.max(0, Math.min(1, p));
  const { a, b } = oddsPair(clamped);
  return {
    aLabel: `${A.code || A.name} ${a}`,
    bLabel: `${b} ${B.code || B.name}`,
    fill: Math.round(clamped * 1000) / 10,
    aria: `${A.name} ${a}, ${B.name} ${b}`,
  };
}

function strengthMeta(effA, effD, samples) {
  if (!Number.isFinite(Number(effA)) || !Number.isFinite(Number(effD))) return null;
  const tail = Number.isFinite(Number(samples)) && Number(samples) > 0 ? ` · from ${Number(samples)} simulated matches` : '';
  return `Strength ${oneDecimal(effA)} v ${oneDecimal(effD)}${tail}`;
}

/** The pending fixture (before its result): live match, tactical gate, or the draw on the compass. */
function pendingFixture(st) {
  const teams = st?.teams || {};
  const m = st?.match;
  if (m && !m.applied && !m.done && teams[m.aId] && teams[m.dId]) return { kind: 'live', aId: m.aId, dId: m.dId, match: m };
  const tc = st?.tacticalChoice;
  if (tc && teams[tc.aId] && teams[tc.dId]) return { kind: 'tactical', aId: tc.aId, dId: tc.dId, route: tc.route || null };
  const spin = st?.spin;
  if (spin && teams[spin.attackerId] && teams[spin.targetId]) {
    return { kind: spin.stage === 'locked' ? 'locked' : 'drawing', aId: spin.attackerId, dId: spin.targetId, route: spin };
  }
  return null;
}

/**
 * Pre-match estimate for a drawn pair with the default ('balanced') approach — the odds the tactical gate's
 * "Continue" kicks off with, and the same call shape as App.startMatch, so the estimator cache is shared.
 */
function fixtureOdds(st, ctx, aId, dId) {
  return memo(ctx?.cache, 'col:fixture-odds', [st?.teams, aId, dId, ctx?.managedId ?? null, ctx?.drama, ctx?.sport],
    () => matchupOdds(st, ctx, aId, dId));
}

/**
 * The managed side's win chance in the pending fixture, so the fronts row agrees with the fixture block: the same
 * attacker probability the odds row is built from, and the label of the managed side of that row (oddsPair), so a
 * defending manager reads exactly the bar's right-hand percentage → { opponentId, p, win, tone } | null.
 * Not while the compass is still spinning: the fixture is known only once the needle locks (DEC D19).
 */
function fixtureOverride(st, ctx) {
  const managedId = ctx?.managedId;
  const pending = managedId ? pendingFixture(st) : null;
  if (!pending || pending.kind === 'drawing' || (pending.aId !== managedId && pending.dId !== managedId)) return null;
  const attacking = pending.aId === managedId;
  const opponentId = attacking ? pending.dId : pending.aId;
  let pA = null;
  if (pending.kind === 'live') {
    const odds = pending.match.odds;
    pA = odds?.a != null ? Number(odds.a) : odds?.b != null ? 1 - Number(odds.b) : null;
  } else {
    const odds = fixtureOdds(st, ctx, pending.aId, pending.dId);
    pA = odds ? odds.attacker : null;
  }
  if (pA == null || !Number.isFinite(pA)) return null;
  const clamped = Math.max(0, Math.min(1, pA));
  const pair = oddsPair(clamped);
  return {
    opponentId,
    p: attacking ? clamped : 1 - clamped,
    win: attacking ? pair.a : pair.b,
    tone: shownTone(attacking ? pair.aShown : pair.bShown),
  };
}

/** Idle copy (DEC D10) comes from turnVM.idleTurnCopy (FROZEN), which covers every turn order and pacing. */
function idleCopy(st, ctx) {
  try {
    const copy = idleTurnCopy(st, ctx);
    return { title: copy?.title || 'Next draw', route: copy?.route || '' };
  } catch {
    return { title: 'Next draw', route: '' };
  }
}

/** "Up next" line under a finished match: the queued match, the next finale game, or the next turn's copy. */
function nextUp(st, ctx) {
  const teams = st?.teams || {};
  const alive = Array.isArray(st?.aliveIds) ? st.aliveIds : [];
  if (alive.length <= 1) return null;
  const pair = (a, d) => (teams[a] && teams[d] ? `${teams[a].name} v ${teams[d].name}` : null);
  if (Array.isArray(st.queue) && st.queue.length) {
    const [a, d] = st.queue[0] || [];
    const route = pair(a, d);
    if (route) return { title: 'Next match', route };
  }
  if (st.series && alive.length === 2) {
    const [a, d] = st.series.teamIds || [];
    const route = pair(a, d);
    if (route) return { title: `Finale game ${(Number(st.series.games) || 0) + 1}`, route };
  }
  const copy = idleCopy(st, ctx);
  return copy.title ? copy : null;
}

// ---------- column ----------

/** → { role, sheet, fixture, fronts, results } (PLAN §3.5 CampaignColumn, owned shape). */
export function buildColumn(st, ctx = {}) {
  const role = ctx?.managedId && st?.teams?.[ctx.managedId] ? 'manager' : 'spectator';
  return {
    role,
    sheet: st?.phoneSheet === 'expanded' ? 'expanded' : 'collapsed',
    fixture: buildFixture(st, ctx),
    fronts: role === 'manager' && !st?.pendingTarget ? buildFronts(st, ctx) : null,
    results: buildLatestResults(st, ctx),
  };
}

/**
 * Next fixture block (DEC D10) → FixtureModel:
 * { state: 'idle'|'drawing'|'locked'|'tactical'|'live'|'done', kicker, kickerRight, idleTitle, headline: {a, b}|null,
 *   route, odds: {aLabel, bLabel, fill, aria}|null, meta, actions: {preview, simulate}, next: {title, route}|null }
 * drawing (spin 'ready'/'spinning') keeps the placeholder form ('Serbia to attack' / 'The compass is choosing the
 * target'); the matchup, odds and meta appear from the locked spin on (DEC D19).
 * live/done carry the compact MatchCard (the `matchCard` slot, DEC D17); headline/odds stay as a fallback.
 */
export function buildFixture(st, ctx = {}) {
  const teams = st?.teams || {};
  const current = roundLabel(displayRound(st));
  const base = {
    state: 'idle', kicker: 'Next fixture', kickerRight: current, idleTitle: null, headline: null, route: null,
    odds: null, meta: null, actions: NO_ACTIONS, next: null,
  };
  if (!st) return base;

  const m = st.match;
  if (m && teams[m.aId] && teams[m.dId]) {
    const A = teams[m.aId], B = teams[m.dId];
    const live = !m.applied && !m.done;
    return {
      ...base,
      state: live ? 'live' : 'done',
      kicker: live ? 'Live match' : 'Result',
      kickerRight: roundLabel(Number(st.round) || 0) || current,
      headline: { a: A.name, b: B.name },
      route: live ? routeLine(ctx, m.aId, m.dId, { routeKind: m.routeKind }) : null,
      odds: oddsRow(A, B, m.odds?.a),
      meta: strengthMeta(m.effA, m.effD, null),
      next: live ? null : nextUp(st, ctx),
    };
  }

  const pending = pendingFixture(st);
  if (pending && pending.kind === 'drawing') {
    // The spin's result stays hidden until the needle locks (DEC D19: the fixture is known at the locked spin; the
    // map paints the opponent only then): the attacker as a placeholder title, no defender, odds or meta yet.
    return { ...base, state: 'drawing', idleTitle: `${teams[pending.aId].name} to attack`, route: COMPASS_CHOOSING };
  }
  if (pending) {
    const A = teams[pending.aId], B = teams[pending.dId];
    const odds = fixtureOdds(st, ctx, pending.aId, pending.dId);
    const effA = odds?.effA ?? strengthOf(A), effD = odds?.effD ?? strengthOf(B);
    return {
      ...base,
      state: pending.kind,
      headline: { a: A.name, b: B.name },
      route: routeLine(ctx, pending.aId, pending.dId, pending.route),
      odds: oddsRow(A, B, odds?.attacker),
      meta: strengthMeta(effA, effD, odds?.samples),
      actions: pending.kind === 'tactical' ? { preview: true, simulate: true } : NO_ACTIONS,
    };
  }

  if (st.pendingTarget && teams[st.pendingTarget.attackerId]) {
    return { ...base, idleTitle: `${teams[st.pendingTarget.attackerId].name} to attack`, route: 'You choose the target' };
  }
  const idle = idleCopy(st, ctx);
  return { ...base, idleTitle: idle.title, route: idle.route || null };
}

/**
 * Your fronts (A§6, ED§4b, DEC D4/D5) → { nameHeading: 'Nation'|'Club', rows: [{ teamId, flagId, isClub, code, color,
 * name, eff, terr, win, tone }], note, empty } | null. Rows = the managed empire's reachable land tier (fallback: every
 * reachable rival), strongest first, ≤ limit (CSS shows 4 below 1600px). Win = managed side as attacker via
 * winChanceFor, except the pending fixture's opponent, which reuses the fixture block's label so both blocks agree.
 * nameHeading names the first column by layer: every row of a clubs campaign is a club (setup's 'club' noun).
 * `reach` (optional) overrides reachableTargets — a seam for tests.
 */
export function buildFronts(st, ctx = {}, { limit = 5, reach = null } = {}) {
  const managedId = ctx?.managedId;
  const teams = st?.teams || {};
  const board = ctx?.board;
  if (!managedId || !teams[managedId] || !board || !aliveSet(st).has(managedId) || st?.pendingTarget) return null;
  const override = fixtureOverride(st, ctx);
  return memo(ctx.cache, 'col:fronts',
    [st.own, st.teams, st.aliveIds, managedId, limit, reach, ctx.sport, ctx.drama, st.settings?.layer ?? null,
      override?.opponentId ?? null, override?.win ?? null, override?.tone ?? null],
    () => {
      let targets = reach;
      if (!Array.isArray(targets)) {
        try { targets = reachableTargets(board, managedId) || []; } catch { targets = []; }
      }
      const alive = aliveSet(st);
      const valid = targets.filter(entry => entry && entry.tid !== managedId && alive.has(entry.tid) && teams[entry.tid]);
      const land = valid.filter(entry => entry.tier === 'land');
      const pool = land.length ? land : valid;
      const ids = [...new Set(pool.map(entry => entry.tid))];
      const rows = ids.map(id => ({ id, team: teams[id], eff: strengthOf(teams[id]) }))
        .sort((x, y) => (y.eff ?? -Infinity) - (x.eff ?? -Infinity)
          || String(x.team.name).localeCompare(String(y.team.name)) || String(x.id).localeCompare(String(y.id)))
        .slice(0, Math.max(0, Number(limit) || 0))
        .map(({ id, team, eff }) => {
          let win = '—', tone = 'muted';
          if (override && override.opponentId === id) {
            ({ win, tone } = override);
          } else {
            const p = winChanceFor(st, ctx, managedId, id);
            if (p != null && Number.isFinite(Number(p))) { win = formatWinChance(Number(p)); tone = winTone(Number(p)); }
          }
          let terr = 0;
          try { terr = territories(board, id).length; } catch { terr = 0; }
          return {
            teamId: id, flagId: team.flagId ?? null, isClub: team.kind === 'club', code: team.code || '',
            color: team.col || null, name: team.name || '', eff: oneDecimal(eff), terr: String(terr), win, tone,
          };
        });
      const clubs = st.settings?.layer === 'clubs' || teams[managedId].kind === 'club' || rows.some(row => row.isClub);
      return {
        nameHeading: clubs ? 'Club' : 'Nation',
        rows,
        note: !land.length && rows.length ? reachNote(pool.filter(entry => rows.some(row => row.teamId === entry.tid))) : null,
        empty: rows.length ? null : 'No rival is within reach.',
      };
    });
}

/**
 * The note under a fronts table without a land tier (DEC D4): direct sea strikes, or the fallback tier's coastal
 * sea routes, neutral transit treaties and (an exclave on a country map) crossings of foreign land that is never
 * claimed — the copy names the route kinds actually present.
 */
function reachNote(entries) {
  const kinds = new Set(entries.map(entry => (['neutral-transit', 'foreign-transit'].includes(entry.routeKind) ? entry.routeKind : 'sea')));
  const by = [kinds.has('sea') || !kinds.size ? 'sea' : null, kinds.has('neutral-transit') ? 'transit treaty' : null].filter(Boolean);
  const ways = [...by.map((way, i) => (i ? way : `by ${way}`)), ...(kinds.has('foreign-transit') ? ['across foreign land'] : [])];
  const list = ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}` : ways[0];
  return `No land border · these rivals are reached ${list}`;
}

// ---------- history: latest results and ticker ----------

function historySides(entry) {
  const a = entry?.a || {}, b = entry?.b || {};
  const aId = entry?.aId ?? a.teamId ?? a.tid ?? null;
  const winnerId = entry?.winnerId ?? entry?.result?.winnerId ?? null;
  const winnerIsA = winnerId != null && aId != null ? winnerId === aId : Number(a.score) >= Number(b.score);
  const W = winnerIsA ? a : b, L = winnerIsA ? b : a;
  return {
    a, b,
    winnerName: entry?.winnerName || entry?.result?.winnerName || W.name || '',
    loserName: entry?.result?.loserName || L.name || '',
    // A conquest records the loser (who is out); finale series games without a conquest do not.
    conquest: !!entry?.result?.loserName,
  };
}

function tieSuffix(entry, ctx) {
  const text = entry?.result?.tieText;
  if (!text) return '';
  if (/penalt/i.test(text)) return ' (pens)';
  if (/overtime/i.test(text)) return ' (OT)';
  return ctx?.sport?.tieBreak === 'overtime' ? ' (OT)' : ' (pens)';
}

const scoreOf = value => (value == null || value === '' ? '0' : String(value));

function resultRow(entry, index, ctx) {
  if (!entry || typeof entry !== 'object') return null;
  const { a, b, winnerName, loserName, conquest } = historySides(entry);
  let meta = `${a.code || a.name || ''} ${scoreOf(a.score)}–${scoreOf(b.score)} ${b.code || b.name || ''}${tieSuffix(entry, ctx)}`;
  const player = entry.result?.player?.name;
  if (conquest && player) meta += ` · claims ${player}`;
  if (!conquest && entry.series && Number.isFinite(Number(entry.series.aWins)) && Number.isFinite(Number(entry.series.bWins))) {
    meta += ` · series ${Number(entry.series.aWins)}–${Number(entry.series.bWins)}`;
  }
  return {
    key: String(entry.id ?? `${historyRound(entry)}-${index}`),
    roman: roman(historyRound(entry)),
    title: `${winnerName} beat ${loserName}`,
    meta,
  };
}

/** Latest results (A§7) → { rows: [{ key, roman: 'XXVI', title: 'Germany beat Czechia', meta: 'CZE 0–1 GER · claims P. Schick' }] }, newest first. */
export function buildLatestResults(st, ctx = {}, { limit = 4 } = {}) {
  const history = Array.isArray(st?.history) ? st.history : [];
  const count = Math.max(0, Number(limit) || 0);
  return memo(ctx?.cache, 'col:results', [history, count, ctx?.sport], () => ({
    rows: count ? history.slice(-count).reverse().map((entry, i) => resultRow(entry, i, ctx)).filter(Boolean) : [],
  }));
}

function tickerItem(entry, index, ctx) {
  if (!entry || typeof entry !== 'object') return null;
  const { a, b, loserName, conquest } = historySides(entry);
  const numeral = roman(historyRound(entry));
  const head = numeral ? `R ${numeral}  ` : '';
  const out = conquest && loserName ? ` · ${loserName} out` : '';
  return {
    key: String(entry.id ?? `${historyRound(entry)}-${index}`),
    text: `${head}${a.name || a.code || ''} ${scoreOf(a.score)}  ${b.name || b.code || ''} ${scoreOf(b.score)}${tieSuffix(entry, ctx)}${out}`,
  };
}

/** Live ticker (A§8, A§12.6) → { items: [{ key, text: 'R XVIII  Germany 2  Austria 0 · Austria out' }] }, newest first; CSS uppercases. */
export function buildTicker(st, ctx = {}, { limit = 7 } = {}) {
  const history = Array.isArray(st?.history) ? st.history : [];
  const count = Math.max(0, Number(limit) || 0);
  return memo(ctx?.cache, 'col:ticker', [history, count, ctx?.sport], () => ({
    items: count ? history.slice(-count).reverse().map((entry, i) => tickerItem(entry, i, ctx)).filter(Boolean) : [],
  }));
}

// ---------- map overlays: title card and key ----------

function followedTeam(st, ctx) {
  const id = ctx?.followedId ?? st?.followedId ?? null;
  return id && st?.teams?.[id] ? st.teams[id] : null;
}

/**
 * The your-turn card's noun (DEC D4), by the same rule as the target panel's count (viewModels/turns.js reachNoun):
 * 'neighbour' while every pending option is in the attacker's land tier, 'target' once any is a sea or fallback
 * reach (an empire without a land border). No board or reach → 'neighbour'.
 */
function pendingReachNoun(st, ctx) {
  const pt = st.pendingTarget;
  const board = ctx?.board;
  if (!pt?.attackerId || !board) return 'neighbour';
  return memo(ctx.cache, 'col:reach-noun', [st.own, st.aliveIds, pt.attackerId, pt.optionIds], () => {
    let reach = [];
    try { reach = reachableTargets(board, pt.attackerId) || []; } catch { reach = []; }
    const byId = new Map(reach.filter(Boolean).map(item => [item.tid, item]));
    const ids = Array.isArray(pt.optionIds) ? pt.optionIds : reach.map(item => item?.tid);
    return ids.some(id => byId.get(id)?.tier && byId.get(id).tier !== 'land') ? 'target' : 'neighbour';
  });
}

function titleCardModel(st, ctx) {
  const teams = st.teams || {};
  const managedId = ctx?.managedId && teams[ctx.managedId] ? ctx.managedId : null;
  const current = displayRound(st);
  const kicker = roundLabel(current);
  const wholeMap = !!st.wholeMap;

  if (managedId && st.pendingTarget) {
    return { variant: 'your-turn', kicker, title: 'Your turn', phoneTitle: null, meta: null, wholeMap,
      sub: `Pick a ${pendingReachNoun(st, ctx)} to attack. Everyone else’s targets come from the compass.` };
  }

  // Spectators watch the duel draw (M§6.4): the drawn attacker and the compass target, until the result.
  const pending = !managedId && st.settings?.pacing === 'duel' ? pendingFixture(st) : null;
  if (pending) {
    const A = teams[pending.aId], B = teams[pending.dId];
    const roundRobin = st.settings?.turnOrder === 'round-robin';
    const route = routeLine(ctx, pending.aId, pending.dId, pending.kind === 'live'
      ? { routeKind: pending.match.routeKind } : pending.route);
    return {
      variant: 'draw', kicker: roundRobin ? kicker : 'The draw',
      title: roundRobin ? `${A.name} to attack` : `${A.name} is drawn to attack`,
      phoneTitle: null, meta: null, wholeMap,
      // Same rule as the fixture block: the target is named once the needle locks (DEC D19).
      sub: pending.kind === 'drawing' ? COMPASS_CHOOSING
        : `The compass points to ${B.name}${route ? ` · ${route.toLowerCase()}` : ''}`,
    };
  }

  const followed = managedId ? null : followedTeam(st, ctx);
  const seed = st.seed != null && st.seed !== '' ? ` · seed ${st.seed}` : '';
  return {
    variant: 'campaign', kicker,
    // A campaign on a football data set names its season ('The European Campaign · 2001/02').
    title: `${campaignTitle(st.settings, ctx?.scopeName || scopeNameOf(st.settings))}${st.settings?.dataSeason ? ` · ${st.settings.dataSeason}` : ''}`,
    // Phone frames your empire and its opponent (DEC D22, A-7); "Whole map" restores the full title.
    phoneTitle: managedId ? 'Your fronts' : followed ? followed.name : null,
    meta: `${mapStateCopy(st, current)}${seed}`,
    sub: null, wholeMap,
  };
}

/**
 * What the board currently shows. Random-draw duels play one match per round, so the map is the state after the
 * previous round. Round robin counts cycles (DEC D3) and a blitz/chaos batch shares one round, so once a match of
 * the displayed round has been recorded the map is mid-round: 'Map after turn 5 of Round III' (round robin, the
 * strip's turn numbering: `turnIndex` is the last consumed position, minus the turn still in progress) or
 * 'Map after match 2 of Round III' (batches, finale series).
 */
function mapStateCopy(st, current) {
  const history = Array.isArray(st.history) ? st.history : [];
  const R = roman(current);
  // The champion's last match closed the campaign's last round, however few of its matches were played.
  if (R && Array.isArray(st.aliveIds) && st.aliveIds.length === 1) return `Map after Round ${R}`;
  if (R && history.length && historyRound(history[history.length - 1]) === current) {
    const queued = Array.isArray(st.queue) && st.queue.length > 0;
    if (st.settings?.turnOrder === 'round-robin' && !queued && !st.series) {
      const inProgress = (st.match && !st.match.applied) || !!st.spin || !!st.pendingTarget || !!st.tacticalChoice;
      const turn = Math.floor(Number(st.turnIndex) || 0) - (inProgress ? 1 : 0);
      const total = Array.isArray(st.turnQueue) ? st.turnQueue.length : 0;
      if (turn >= 1 && (!total || turn <= total)) return `Map after turn ${turn} of Round ${R}`;
    }
    let played = 0;
    for (let i = history.length - 1; i >= 0 && historyRound(history[i]) === current; i--) played++;
    return `Map after match ${played} of Round ${R}`;
  }
  const last = current - 1;
  return last > 0 ? `Map after Round ${roman(last)}` : 'Before the first match';
}

const RING_INK = Object.freeze({ color: 'var(--ink)', width: 1.4 });
const RING_OPPONENT = Object.freeze({ color: 'var(--opponent)', width: 2 });
const RING_RULE = Object.freeze({ color: 'var(--rule)', width: 1 });

const KEY_MODES = new Set(['political', 'strength', 'fronts', 'flags']);

/**
 * The "you" swatch, filled the way the map paints that empire in `mode` (st.mapMode; viewModels/map.js countryFill
 * and identityFill), always with the ink outline both carry. A managed empire is you-fill in every mode but Flags.
 * A followed one keeps its base fill (A-7: never you-fill): its own pastel only in Political — the Strength ramp and
 * the Fronts land-neutral are not its colour — so outside Political, as in Flags, the swatch is the outline alone.
 */
function meItem(st, ctx, mode) {
  const managedId = ctx?.managedId && st.teams?.[ctx.managedId] ? ctx.managedId : null;
  if (managedId) {
    return { key: 'you', kind: 'swatch', label: 'Your empire', color: mode === 'flags' ? null : 'var(--you-fill)', ring: RING_INK };
  }
  const followed = followedTeam(st, ctx);
  if (!followed) return null;
  return { key: 'you', kind: 'swatch', label: 'Followed empire', color: mode === 'political' ? empireFill(followed.id) : null,
    ring: RING_INK };
}

function mapKeyModel(st, ctx) {
  // countryFill paints anything but the four switch modes as Political.
  const mode = KEY_MODES.has(st.mapMode) ? st.mapMode : 'political';
  const me = meItem(st, ctx, mode);
  const hasMe = !!me;
  // A country map marks each club's home town, not a national capital.
  const capital = ctx?.sectionNames ? 'Home town' : 'Capital';
  if (st.pendingTarget) {
    return { variant: 'reach', heading: null, items: [
      me,
      { key: 'reach', kind: 'dash', label: 'In reach this turn', color: 'var(--opponent)' },
      { key: 'veil', kind: 'veil', label: 'Out of reach' },
    ].filter(Boolean) };
  }
  if (mode === 'strength') {
    let steps = [];
    try { steps = strengthSteps(st, ctx) || []; } catch { steps = []; }
    // With few empires several steps share a floor, and the map paints only the first of them: list each floor once.
    const shown = steps.filter((step, i) => steps.findIndex(other => other.min === step.min) === i);
    return { variant: 'strength', heading: 'Strength', items: [
      ...shown.map((step, i) => ({ key: `step-${i}`, kind: 'swatch', label: `${oneDecimal(step.min)}+`, color: step.color, ring: RING_RULE })),
      me,
    ].filter(Boolean) };
  }
  if (mode === 'fronts') {
    return { variant: 'fronts', heading: 'Key', items: [
      me,
      { key: 'gain', kind: 'swatch', label: 'Win ≥60%', color: MAP.frontsTint.gain, ring: RING_RULE },
      { key: 'even', kind: 'swatch', label: '45–59%', color: MAP.frontsTint.even, ring: RING_RULE },
      { key: 'loss', kind: 'swatch', label: '<45%', color: MAP.frontsTint.loss, ring: RING_RULE },
    ].filter(Boolean) };
  }
  if (mode === 'flags') {
    return { variant: 'flags', heading: 'Key', items: [
      me,
      hasMe ? { key: 'opponent', kind: 'swatch', label: 'Next opponent', color: null, ring: RING_OPPONENT } : null,
      { key: 'capital', kind: 'capital', label: capital },
    ].filter(Boolean) };
  }
  return { variant: 'political', heading: 'Key', items: [
    me,
    hasMe ? { key: 'opponent', kind: 'swatch', label: 'Next opponent', color: 'var(--opponent-fill)', ring: RING_OPPONENT } : null,
    { key: 'attack', kind: 'arrow', label: 'Line of attack' },
    { key: 'capital', kind: 'capital', label: capital },
  ].filter(Boolean) };
}

/**
 * Map title card (top-left) and key (bottom-left) → { titleCard, mapKey } (PLAN §3.5 MapOverlays, DEC D21, A-11).
 * titleCard: { variant: 'campaign'|'your-turn'|'draw', kicker, title, phoneTitle, meta, sub, wholeMap }
 * mapKey: { variant: 'political'|'strength'|'fronts'|'flags'|'reach', heading, items: [{ key, kind, label, color?, ring? }] }
 * Both null outside a running campaign and in the conquest view (st.choice).
 */
export function buildMapOverlays(st, ctx = {}) {
  if (!st || !(st.phase === 'playing' || st.phase === 'victory') || st.choice || !st.teams) {
    return { titleCard: null, mapKey: null };
  }
  return { titleCard: titleCardModel(st, ctx), mapKey: mapKeyModel(st, ctx) };
}
