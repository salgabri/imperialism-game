import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { GREAT_BRITAIN, HISTORIC_NATIONS, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';

// Counter-Strike 2 as its tier-one events play their playoffs (docs/design/counter-strike.md): two teams of five, a series
// of maps, best of three. A map is first to 13 rounds (MR12: twelve rounds a half, the sides switching at half-time);
// level at 12–12, it goes to overtime: six rounds, three a half, first to four, and at 3–3 another. Nations only for now:
// each fields its five best players by Liquipedia's results.
export const MAPS = 3;
export const TO_WIN = 2;
export const HALF = 12;
export const MAP_POINT = HALF + 1;
export const OT_HALF = 3;
export const OT_TO_WIN = OT_HALF + 1;

// On the clock a map has 26 units: one for each of regulation's 24 rounds (a map won 13–4 is over at its 17th), then two
// for its overtime, its first half in the first and the rest in the second. The shortest series (two maps) fills 52
// units, and a third extends it as an overtime period does in other sports.
export const REGULATION_UNITS = 2 * HALF;
export const BLOCK = REGULATION_UNITS + 2;
export const LENGTH = TO_WIN * BLOCK;
const MS_PER_UNIT = 85;

// Ratings are Elo built from every map Liquipedia records (scripts/lib/counter-strike.mjs), on the game's scale: a
// rating point is 25 Elo points. A team plays at its five players' mean, as the Elo was built, and wins each map with
// Elo's own odds: a 4-point favourite (100 Elo) wins 64% of maps, an 8-point one 76%.
export const ELO_PER_POINT = 25;
/** The favourite's chance in one map, `gap` rating points ahead. */
export const mapOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// A round's odds: the two sides' strength in a logit (`c`, solved for each map so that the map is the favourite's with
// exactly Elo's odds, `strengthFor`), moved toward the side that won the round before (MOMENTUM: the winners' money
// and weapons carry over, the losers buy less) except in a half's first round, the pistol round, when both start again.
// Fitted by maximum likelihood on the 27,271 CS2 maps (MR12) of Liquipedia's exports of 2026-11-15 whose ten players had
// each played 20 maps before, each played at its own pre-map Elo odds (docs/design/counter-strike.md, "Calibration"):
// 21.59 rounds a map where they played 21.77, 11.5% to overtime where 12.4% went, and the loser's 0 to 11 rounds within
// a point of the real maps' at every score. Without it the same maps run long and close: 22.85 rounds, 15.1% overtime.
export const MOMENTUM = 0.57;

// Match-day form: one draw for the series in rating points, on every map's gap. It grows with the square of the drama,
// as in the other sports, so Wild swings series hard and Predictable plays Elo's odds map by map. Real series are far
// less predictable than their maps: in the same events' 10,394 best-of-threes, the favourite's odds 0.624 a map before the
// first, the favourite won 63.9%, about as often as a single map. Their scorelines are likeliest with a spread of 5 rating
// points (125 Elo) at Balanced: the favourite wins 65.0%, sweeps 40.6% (39.0% real) and is swept 17.9% (17.9%).
const FORM_AT_BALANCED = 5;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// No home advantage: in the 3,319 maps between seasoned players at the exports' LANs where one side was the host nation's
// (three of its five), that side did as Elo expected, within the error (−3.0 ± 5.7 Elo), so the campaign's Home advantage
// rule is not offered (`homeAdvantage` false) and a home venue changes nothing.
export const HOME_EDGE = 0;

/** What a nation counts for when none of its players is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

// ---------- one round, one map ----------

const sigmoid = x => 1 / (1 + Math.exp(-x));
const NONE = 0, WON_A = 1, WON_D = 2;
const lastOf = side => (side === 'A' ? WON_A : side === 'D' ? WON_D : NONE);

/**
 * The attacker's chance to win a round at strength `c` (logit), `last` the side that won the round before it in the same
 * half: 'A', 'D' or null (a half's first round, its pistol round).
 */
export const roundOdds = (c, last = null, momentum = MOMENTUM) => sigmoid(c + (last === 'A' || last === WON_A ? momentum
  : last === 'D' || last === WON_D ? -momentum : 0));

/** Whether a round is a half's first, the pistol round (`played`: the rounds before it in regulation, or in its overtime). */
const regulationStart = played => played === 0 || played === HALF;
const overtimeStart = played => played === 0 || played === OT_HALF;

// The state of a map: in regulation `a`–`b` (0 to 12 each, not both 12) and the last round's winner; in overtime `x`–`y`
// within the overtime under way (0 to 3 each, not both 3) and the same. Index (a·13 + b)·3 + last, (x·4 + y)·3 + last.
const regIndex = (a, b, last) => (a * MAP_POINT + b) * 3 + last;
const otIndex = (x, y, last) => (x * OT_TO_WIN + y) * 3 + last;

/**
 * A map's chances by state at round strength `c` → { reg, ot, level }: `reg[regIndex(a, b, last)]` the attacker's chance to
 * win the map from `a`–`b` in regulation, `ot[otIndex(x, y, last)]` from `x`–`y` within an overtime, `level` from a level
 * overtime's start (12–12, or 3–3 in one). An overtime is six rounds, first to four; at 3–3 another starts, level again,
 * so `level` is the chance to win an overtime outright over the chance it is won outright by either.
 */
export function mapTable(c, momentum = MOMENTUM) {
  // One overtime: the chance to win it outright (`win`) and the chance it ends 3–3 (`draw`), by state.
  const win = new Float64Array(OT_TO_WIN * OT_TO_WIN * 3), draw = new Float64Array(OT_TO_WIN * OT_TO_WIN * 3);
  const otAt = (table, x, y, last) => {
    if (x === OT_TO_WIN) return table === win ? 1 : 0;
    if (y === OT_TO_WIN) return 0;
    if (x === OT_HALF && y === OT_HALF) return table === draw ? 1 : 0;
    return table[otIndex(x, y, last)];
  };
  for (let x = OT_HALF; x >= 0; x--) {
    for (let y = OT_HALF; y >= 0; y--) {
      if (x === OT_HALF && y === OT_HALF) continue;
      for (let last = 0; last < 3; last++) {
        const p = roundOdds(c, overtimeStart(x + y) ? NONE : last, momentum);
        win[otIndex(x, y, last)] = p * otAt(win, x + 1, y, WON_A) + (1 - p) * otAt(win, x, y + 1, WON_D);
        draw[otIndex(x, y, last)] = p * otAt(draw, x + 1, y, WON_A) + (1 - p) * otAt(draw, x, y + 1, WON_D);
      }
    }
  }
  const outright = win[otIndex(0, 0, NONE)], tied = draw[otIndex(0, 0, NONE)];
  const level = outright / Math.max(1e-15, 1 - tied);
  const ot = new Float64Array(win.length);
  for (let i = 0; i < ot.length; i++) ot[i] = win[i] + draw[i] * level;
  const reg = new Float64Array(MAP_POINT * MAP_POINT * 3);
  const regAt = (a, b, last) => (a === MAP_POINT ? 1 : b === MAP_POINT ? 0 : a === HALF && b === HALF ? level : reg[regIndex(a, b, last)]);
  for (let a = HALF; a >= 0; a--) {
    for (let b = HALF; b >= 0; b--) {
      if (a === HALF && b === HALF) continue;
      for (let last = 0; last < 3; last++) {
        const p = roundOdds(c, regulationStart(a + b) ? NONE : last, momentum);
        reg[regIndex(a, b, last)] = p * regAt(a + 1, b, WON_A) + (1 - p) * regAt(a, b + 1, WON_D);
      }
    }
  }
  return { c, momentum, reg, ot, level, start: reg[regIndex(0, 0, NONE)] };
}

/** A map before its first round. */
export const MAP_START = Object.freeze({ a: 0, d: 0, overtime: false, x: 0, y: 0, last: null, over: null });

/**
 * A map's state after one more round, won by `side` ('A' or 'D'): the score, whether it is in overtime and the score within
 * the overtime under way, the last round's winner in its half (null at a half's start, before its pistol round), and the
 * winner once the map is over ('A' or 'D', else null). A finished map stays as it is.
 */
export function stepMap(state, side) {
  if (state.over) return state;
  let { a, d, x, y, overtime } = state;
  let last = side, over = null;
  if (side === 'A') a++; else d++;
  if (!overtime) {
    if (a === MAP_POINT || d === MAP_POINT) over = side;
    // 12–12: overtime, from level.
    else if (a === HALF && d === HALF) { overtime = true; last = null; }
    // Half-time: the sides switch, and the next round is a pistol round.
    else if (a + d === HALF) last = null;
  } else {
    if (side === 'A') x++; else y++;
    if (x === OT_TO_WIN || y === OT_TO_WIN) over = side;
    // 3–3: another overtime, from level again.
    else if (x === OT_HALF && y === OT_HALF) { x = 0; y = 0; last = null; }
    else if (x + y === OT_HALF) last = null;
  }
  return { a, d, overtime, x, y, last: over ? null : last, over };
}

/** Where a map stands after its rounds so far (`rounds`, each 'A' or 'D' in order): stepMap's state. */
export const mapState = rounds => rounds.reduce(stepMap, MAP_START);

/**
 * The chance of a map's rounds so far (`rounds`, in order) at a map's table (mapTable's): each round's odds from the state
 * it was played in, multiplied. The live chart weighs match-day form by it.
 */
export function roundsChance(table, rounds) {
  let state = MAP_START, chance = 1;
  for (const side of rounds) {
    if (state.over) break;
    const p = roundOdds(table.c, state.last, table.momentum);
    chance *= side === 'A' ? p : 1 - p;
    state = stepMap(state, side);
  }
  return chance;
}

/** The attacker's chance to win a map from where it stands (`state`, stepMap's), in a map's table (mapTable's). */
export function mapChance(table, state) {
  if (state.over) return state.over === 'A' ? 1 : 0;
  const last = lastOf(state.last);
  return state.overtime ? table.ot[otIndex(state.x, state.y, last)] : table.reg[regIndex(state.a, state.d, last)];
}

// A map's chance by round strength, on a grid of strengths (built when first read, one for each momentum: today's, and
// any the calibration tries): the strength that gives Elo's odds is bracketed from it, so the rounds follow the ratings
// and the map's winner is Elo's exactly.
const C_STEP = 1 / 32, C_RANGE = 6;
const strengthGrids = new Map();
function grid(momentum) {
  let table = strengthGrids.get(momentum);
  if (!table) {
    table = [];
    for (let i = 0; i <= 2 * C_RANGE / C_STEP; i++) table.push(mapTable(-C_RANGE + i * C_STEP, momentum).start);
    strengthGrids.set(momentum, table);
  }
  return table;
}

/**
 * The round strength (logit) at which the attacker wins a map with `odds` → c: the grid's bracket, then the map's own
 * chance halved between its ends until it is Elo's odds to within a billionth.
 */
export function strengthFor(odds, momentum = MOMENTUM) {
  const table = grid(momentum);
  const target = clamp(odds, table[0], table.at(-1));
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < target) lo = mid; else hi = mid;
  }
  let low = -C_RANGE + lo * C_STEP, high = -C_RANGE + hi * C_STEP;
  for (let i = 0; i < 40 && high - low > 1e-12; i++) {
    const mid = (low + high) / 2;
    const chance = mapTable(mid, momentum).start;
    if (Math.abs(chance - target) < 1e-9) return mid;
    if (chance < target) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

/**
 * One map's rounds for a known winner (`aWins`), drawn exactly: each round from the chance that it goes to the attacker
 * given the map's winner (its odds times the chance to win the map from the state it leads to, over the chance from the
 * state before), so the rounds of maps drawn for their winner at Elo's odds are the round model's own. → ['A' | 'D', …]
 */
export function playMapWon(rng, table, aWins) {
  const rounds = [];
  for (let state = MAP_START; !state.over;) {
    const now = mapChance(table, state);
    const p = roundOdds(table.c, state.last, table.momentum);
    const after = mapChance(table, stepMap(state, 'A'));
    const toA = aWins ? p * after / Math.max(1e-15, now) : p * (1 - after) / Math.max(1e-15, 1 - now);
    const side = rng() < clamp(toA, 0, 1) ? 'A' : 'D';
    rounds.push(side);
    state = stepMap(state, side);
  }
  return rounds;
}

/**
 * What a map at `odds` should bring → { rounds, overtime, loser: [chance the loser takes 0…11 in regulation] }: its rounds
 * in all, its chance to go to overtime and the loser's rounds when it does not, played forward over the states. How the
 * round model is held against the real maps (scripts/simulation-realism.mjs, docs/design/counter-strike.md).
 */
export function mapMeans(odds, momentum = MOMENTUM) {
  const table = mapTable(strengthFor(odds, momentum), momentum);
  const loser = new Array(HALF).fill(0);
  let rounds = 0, overtime = 0;
  // Regulation, forward over (a, b, last).
  let states = new Map([[regIndex(0, 0, NONE), 1]]);
  for (let played = 0; played < REGULATION_UNITS; played++) {
    const next = new Map();
    for (const [index, chance] of states) {
      const last = index % 3, ab = (index - last) / 3, a = Math.floor(ab / MAP_POINT), b = ab % MAP_POINT;
      const p = roundOdds(table.c, regulationStart(a + b) ? NONE : last, momentum);
      rounds += chance;
      for (const [na, nb, won, q] of [[a + 1, b, WON_A, p], [a, b + 1, WON_D, 1 - p]]) {
        const mass = chance * q;
        if (na === MAP_POINT || nb === MAP_POINT) loser[Math.min(na, nb)] += mass;
        else if (na === HALF && nb === HALF) overtime += mass;
        else next.set(regIndex(na, nb, won), (next.get(regIndex(na, nb, won)) ?? 0) + mass);
      }
    }
    states = next;
  }
  // Overtime's rounds: each overtime of six is played to its end or to 3–3, the latter again from level.
  if (overtime > 0) {
    let inOt = new Map([[otIndex(0, 0, NONE), 1]]), length = 0, tie = 0;
    while (inOt.size) {
      const next = new Map();
      for (const [index, chance] of inOt) {
        const last = index % 3, xy = (index - last) / 3, x = Math.floor(xy / OT_TO_WIN), y = xy % OT_TO_WIN;
        const p = roundOdds(table.c, overtimeStart(x + y) ? NONE : last, momentum);
        length += chance;
        for (const [nx, ny, won, q] of [[x + 1, y, WON_A, p], [x, y + 1, WON_D, 1 - p]]) {
          const mass = chance * q;
          if (nx === OT_TO_WIN || ny === OT_TO_WIN) continue;
          if (nx === OT_HALF && ny === OT_HALF) { tie += mass; continue; }
          next.set(otIndex(nx, ny, won), (next.get(otIndex(nx, ny, won)) ?? 0) + mass);
        }
      }
      inOt = next;
    }
    // Overtimes are played until one is won outright: 1 / (1 − tie) of them, each `length` rounds on average.
    rounds += overtime * length / (1 - tie);
  }
  return { rounds, overtime, loser };
}

// ---------- the series ----------

/**
 * Prepare a series once for cheap resampling: the attacker's edge in rating points on every map (`gap`), tactics, upsets
 * and the venue included. `venue.home`: the defender is at home.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const gap = lineupA.rating + adjustmentA - (lineupD.rating + adjustmentD) - (home ? HOME_EDGE : 0);
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, gap, maps: { maps: MAPS, toWin: TO_WIN } };
}

/**
 * Score-only path: one form draw for the series, then each map won with Elo's odds for the gap until a side has two.
 * Also returns the form and who won each map (`games`, 'A' or 'D'), which the full simulation plays out.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const odds = mapOdds(prepared.gap + form);
  const games = [];
  let ga = 0, gd = 0;
  while (ga < TO_WIN && gd < TO_WIN) {
    if (rng() < odds) { ga++; games.push('A'); } else { gd++; games.push('D'); }
  }
  return { ga, gd, regA: ga, regD: gd, tie: null, winner: ga > gd ? prepared.attackerId : prepared.defenderId, form, games };
}

/** A score from one side: "8–6". */
const scoreline = (own, other) => `${own}–${other}`;

/** The clock unit of a map's round `n` (1 from its first): its own in regulation, overtime's first half then the rest. */
export const roundUnit = n => (n <= REGULATION_UNITS ? n : n <= REGULATION_UNITS + OT_HALF ? REGULATION_UNITS + 1 : REGULATION_UNITS + 2);

/**
 * Who is a round's MVP: any of the five, the better player more often, each in proportion to his rating above the floor,
 * as Rocket League's scorers. Liquipedia records no rounds' MVPs, so this is the model's choice, not a fit.
 */
const MVP_WEIGHTS = { PLR: 1 };
const MVP_FLOOR = 40;

/**
 * The whole series: sampleResult's own draws decide every map (so a seed gives the same score on both paths), then each
 * map's rounds are played out given its winner (playMapWon). Events: each round (`pts` 0: the score counts maps) at its
 * unit on the clock, its MVP named and the map's score after it from the winner's side; then the map's end (`pts` 1, the
 * winner's) at its last round's unit, named for the side's MVP of the map (the most rounds' MVP).
 */
export function simulateSeries(rng, prepared, drama = 6) {
  const result = sampleResult(rng, prepared, drama);
  const table = mapTable(strengthFor(mapOdds(prepared.gap + result.form)));
  const mvp = { A: createScorerSampler(prepared.lineupA, MVP_WEIGHTS, MVP_FLOOR),
    D: createScorerSampler(prepared.lineupD, MVP_WEIGHTS, MVP_FLOOR) };
  const ev = [];
  result.games.forEach((winner, k) => {
    const start = k * BLOCK;
    const rounds = playMapWon(rng, table, winner === 'A');
    const won = { A: 0, D: 0 }, mvps = new Map();
    rounds.forEach((side, i) => {
      won[side]++;
      const other = side === 'A' ? 'D' : 'A';
      const name = mvp[side](rng);
      if (side === winner) mvps.set(name, (mvps.get(name) ?? 0) + 1);
      ev.push({ m: start + roundUnit(i + 1), side, name, pts: 0, map: k + 1, round: i + 1, score: scoreline(won[side], won[other]),
        ...(i + 1 > REGULATION_UNITS ? { ot: true } : {}) });
    });
    const loser = winner === 'A' ? 'D' : 'A';
    const best = [...mvps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    ev.push({ m: start + roundUnit(rounds.length), side: winner, name: best, pts: 1, map: k + 1, round: rounds.length,
      score: scoreline(won[winner], won[loser]), ...(rounds.length > REGULATION_UNITS ? { ot: true } : {}) });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The map an event or clock unit falls in: M1 for units 1–26, M2 for 27–52… (the start counts as the first). */
export const mapAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, MAPS);

/** Counter-Strike's nations-only rulebook: no clubs, Great Britain as one. Its players come from sportData.js. */
const territoryOf = rosters => ({
  merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
  // East Germany and South Vietnam (HISTORIC_NATIONS) are not on today's map.
  inactive: Object.keys(NATIONS).filter(nation => !HOME_NATIONS.includes(nation) && !HISTORIC_NATIONS.includes(nation)
    && !Object.hasOwn(rosters, nation)),
});

const counterStrikeRules = {
  id: 'counter-strike',
  simulationVersion: 1,
  name: 'Counter-Strike',
  blurb: 'Five-a-side tactical shooter, best of three maps. First to 13 rounds takes a map; 12–12 goes to overtime.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: [],
  // Nations only, for now: the orgs (clubs) have no map yet.
  nationsOnly: true,
  // The home crowd's edge at a LAN (HOME_EDGE): offered only where the real LANs show one.
  homeAdvantage: HOME_EDGE !== 0,
  // No Computer signings: any player plays any role, so the best-rated player is always the best fit.
  signings: false,
  // Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire. A nation with fewer
  // than five rated players fields no team, and its land stays neutral.
  territory: undefined,
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 7,
  formation: { PLR: 5 },
  positionPlan: ['PLR', 'PLR', 'PLR', 'PLR', 'PLR', 'PLR', 'PLR'],
  positionColors: { PLR: C.gold },

  fallbackStrength: () => EMPTY_STRENGTH,
  requiredPositions: [],

  // Twenty-six clock units a map; the chart ticks at the end of each. A series ends with its deciding map, the last event.
  clock: { length: LENGTH, msPerUnit: MS_PER_UNIT, ot: BLOCK, tick: BLOCK },
  tieBreak: 'none',
  labels: {
    score: 'MAPS',
    start: 'MAP VETO…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'FINAL',
    tieShort: '',
  },

  words: { kickoff: 'Start', end: 'Final', lineup: 'Team', lineupShort: 'Team', lineupNoun: 'team', lineupTitle: 'Team',
    overtime: null, half: null },

  // The clock shows the map in play: "M2".
  formatClock: m => `M${mapAt(m)}`,
  // The chart's axis: the end of each map.
  formatTick: t => (t > 0 ? `M${Math.round(t / BLOCK)}` : ''),
  // The feed's live row: "map 2, best of 3".
  clockLeft: now => `map ${mapAt(now)}, best of ${MAPS}`,
  formatEvent: (e, code) => ({ when: `M${e.map || mapAt(e.m)}`, text: e.pts > 0
    ? `MAP ${e.map} — ${code} ${e.score}${e.ot ? ' OT' : ''}`
    : `R${e.round}${e.ot ? ' OT' : ''} — ${e.name} (${code}) ${e.score}` }),
  formatToast: e => (e.pts > 0 ? `MAP ${e.map} — ${e.score}${e.ot ? ' OT' : ''}` : `ROUND ${e.round} — ${e.score}`),

  prepareMatch,
  sampleResult,
  simulate: (rng, attacker, defender, drama, effA, effD, venue) => {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, ev, winner } = simulateSeries(rng, prepared, drama);
    return { ga, gd, regA: ga, regD: gd, tie: null, winner,
      ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
  },
};

export const counterStrike = defineSportData({ ...counterStrikeRules }, { clubs: false, territoryOf });

/**
 * Squad-screen strength profile: the five who play and the best of them → { team, best } on the player-rating scale.
 * Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function counterStrikeProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected?.slots?.length) return { team: 0, best: 0 };
  const ratings = selected.slots.map(slot => slot.effectiveRating);
  return { team: ratings.reduce((sum, r) => sum + r, 0) / ratings.length, best: Math.max(...ratings) };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const MAPS_MODEL = Object.freeze({ MAPS, TO_WIN, BLOCK, LENGTH, HALF, REGULATION_UNITS, FORM_AT_BALANCED, MOMENTUM });
