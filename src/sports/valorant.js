import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { GREAT_BRITAIN, HISTORIC_NATIONS, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { VALORANT_MAP_POOLS } from '../data/valorantMapPools.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';

// Valorant as the VCT plays its playoffs (docs/design/valorant.md): two teams of five, a series of maps, best of three. A
// map is won by the first to thirteen rounds; at twelve all it goes to overtime, won by two clear rounds. Nations only for
// now: each fields its five best players by an Elo of vlr.gg's results.
export const MAPS = 3;
export const TO_WIN = 2;
export const ROUNDS_TO_WIN = 13;
/** The rounds of a half: the sides swap after twelve, and the thirteenth is the second half's pistol round. */
export const HALF = 12;

// On the clock a map has twenty-six units: its twenty-four rounds of regulation (round n at unit n) and two for its
// overtime, played or not (the first pair of overtime rounds at the twenty-fifth, any later at the twenty-sixth), so the
// shortest series (two maps) fills 52 units and a third map extends it as an overtime period does in other sports.
export const BLOCK = 2 * HALF + 2;
export const LENGTH = TO_WIN * BLOCK;
const MS_PER_UNIT = 80;

// Ratings are Elo built from every map vlr.gg records (scripts/lib/valorant.mjs), on the game's scale: a rating point is
// 25 Elo points. A team plays at its five players' mean, as the Elo was built, and wins each map with Elo's own odds: a
// 4-point favourite (100 Elo) wins 64% of maps, an 8-point one 76%.
export const ELO_PER_POINT = 25;
/** The favourite's chance to win one map, `gap` rating points ahead. */
export const mapOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// A round's odds on the logit scale: the team's edge (`beta`, solved so the map is won with Elo's odds) and the economy,
// fitted on the rounds of vlr.gg's 10,287 maps between seasoned players from November 2024 to November 2026, each map
// played at its own odds (docs/design/valorant.md, "Calibration"):
// - the round after a pistol round goes to the pistol's winner (PISTOL_FOLLOW: 87.1% of them; the model 87.3%);
// - the third round, when one team won the first two, is the bonus round: the winner plays on saved weapons against a full
//   buy (BONUS_ROUND: it wins 43.1%; the model 44.0%); when the pistol's loser took the second, its rival's economy is
//   broken (BROKEN_BUY: the second round's winner takes the third 84.4% of the time; the model 84.4%);
// - every later round leans towards its predecessor's winner (MOMENTUM: 59.0% of rounds; the model 62.0%), the economy and
//   the form of the day together;
// - overtime's rounds start each team on the same money: no economy.
// So fitted, 12.0% of maps go to overtime (11.3% real) and a map runs 21.4 rounds (21.2).
export const PISTOL_FOLLOW = 1.92;
export const BONUS_ROUND = 0.26;
export const BROKEN_BUY = 1.69;
export const MOMENTUM = 0.48;

// Match-day form: one draw for the series in rating points, on every map's gap. It grows with the square of the drama, as
// in the other sports, so Wild swings series hard and Predictable plays Elo's odds map by map. In vlr.gg's 3,388
// best-of-three series between seasoned players of those two years, the favourite's odds a map 63.9% on average, the
// favourite won 63.5%, no more often than a single map; their scorelines are likeliest with a spread of 6.5 rating points
// (162 Elo) at Balanced, the favourite then winning 65.4%.
export const FORM_AT_BALANCED = 6.5;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Home advantage: in the 1,607 maps of the LANs where one side was the host nation's, that side did 22.8 ± 8.6 Elo better
// than Elo expected, a rating point (25 Elo), offered as the campaign's Home advantage rule (`homeAdvantage`).
export const HOME_EDGE = 1;

/** What a nation counts for when none of its players is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

// The maps a series is played on, three of the competitive pool in a random order: the seven played at vlr.gg's events
// from mid-October to mid-November 2026, after the pool's last rotation (Corrode and Bind in, Split and Ascent out). An
// earlier season plays on its own December's pool (VALORANT_MAP_POOLS, `valorantIn`).
export const MAP_POOL = Object.freeze(['Lotus', 'Haven', 'Sunset', 'Summit', 'Corrode', 'Abyss', 'Bind']);

const sigmoid = x => 1 / (1 + Math.exp(-x));

// ---------- one map ----------

/**
 * The attacker's chance to win round `r` (1 to 24) given the two rounds before it in the half (`prev1` the winner of the
 * one before, `prev2` of the one before that: 'A', 'D' or null). The thirteenth is the second half's pistol round.
 */
export function roundOdds(beta, r, prev1, prev2) {
  const inHalf = ((r - 1) % HALF) + 1;
  if (inHalf === 1 || r > 2 * HALF) return sigmoid(beta);
  const sign = side => (side === 'A' ? 1 : -1);
  if (inHalf === 2) return sigmoid(beta + PISTOL_FOLLOW * sign(prev1));
  if (inHalf === 3) {
    // The pistol's winner took the second too: the bonus round. Else the second's winner has the guns.
    return prev1 === prev2 ? sigmoid(beta - BONUS_ROUND * sign(prev1)) : sigmoid(beta + BROKEN_BUY * sign(prev1));
  }
  return sigmoid(beta + MOMENTUM * sign(prev1));
}

/** The attacker's chance to win overtime from twelve all: two clear rounds, each a coin of the teams' plain odds. */
export const overtimeOdds = beta => {
  const p = sigmoid(beta);
  return p * p / (p * p + (1 - p) * (1 - p));
};

const PREV = [null, 'A', 'D'];
const prevIndex = side => (side === 'A' ? 1 : side === 'D' ? 2 : 0);
const stateKey = (a, d, prev1, prev2) => ((a * 13 + d) * 3 + prevIndex(prev1)) * 3 + prevIndex(prev2);

/**
 * The attacker's chance to win a map from each state at edge `beta`: `table[stateKey(a, d, prev1, prev2)]` the chance
 * with `a`–`d` rounds won and the half's last two winners `prev1`, `prev2`. Played backwards from twelve all. Exported
 * for the live win probability.
 */
export function mapTable(beta) {
  const table = new Float64Array(13 * 13 * 9);
  const ot = overtimeOdds(beta);
  for (let total = 2 * HALF; total >= 0; total--) {
    for (let a = Math.min(12, total); a >= 0; a--) {
      const d = total - a;
      if (d > 12) continue;
      const r = total + 1;
      for (const prev1 of PREV) {
        for (const prev2 of PREV) {
          let value;
          if (total === 2 * HALF) value = ot;
          else {
            const p = roundOdds(beta, r, prev1, prev2);
            const halfStart = (r % HALF) === 0; // the round after this one starts a half: no economy carries over
            const nextPrev = side => (halfStart ? [null, null] : [side, prev1]);
            const [winA1, winA2] = nextPrev('A');
            const [winD1, winD2] = nextPrev('D');
            const ifA = a + 1 >= ROUNDS_TO_WIN ? 1 : table[stateKey(a + 1, d, winA1, winA2)];
            const ifD = d + 1 >= ROUNDS_TO_WIN ? 0 : table[stateKey(a, d + 1, winD1, winD2)];
            value = p * ifA + (1 - p) * ifD;
          }
          table[stateKey(a, d, prev1, prev2)] = value;
        }
      }
    }
  }
  return table;
}

/** The attacker's chance from a state of a map's table (its score and the half's last two winners). */
export const chanceFrom = (table, a, d, prev1 = null, prev2 = null) => {
  if (a >= ROUNDS_TO_WIN) return 1;
  if (d >= ROUNDS_TO_WIN) return 0;
  return table[stateKey(clamp(a, 0, 12), clamp(d, 0, 12), prev1, prev2)];
};

// A map's win chance by the attacker's edge, on a grid of edges (built when first read): the edge that gives Elo's odds is
// read from it between its points, so the rounds follow the ratings and the winner is Elo's exactly.
const BETA_STEP = 1 / 64, BETA_RANGE = 3;
let betaGrid = null;
function betas() {
  if (!betaGrid) {
    betaGrid = [];
    for (let i = 0; i <= 2 * BETA_RANGE / BETA_STEP; i++) betaGrid.push(chanceFrom(mapTable(-BETA_RANGE + i * BETA_STEP), 0, 0));
  }
  return betaGrid;
}

/** The attacker's round edge (logit) in a map he wins with `odds`. Exported for the live win probability. */
export function mapBeta(odds) {
  const grid = betas();
  const target = clamp(odds, grid[0], grid.at(-1));
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] < target) lo = mid; else hi = mid;
  }
  const t = grid[hi] > grid[lo] ? (target - grid[lo]) / (grid[hi] - grid[lo]) : 0;
  return -BETA_RANGE + (lo + t) * BETA_STEP;
}

/**
 * One map at edge `beta` → { rounds: ['A' | 'D', …], ot }: each round's winner in order, regulation's and overtime's,
 * until a side has thirteen, or two clear in overtime.
 */
export function playMap(rng, beta) {
  const rounds = [];
  let a = 0, d = 0, prev1 = null, prev2 = null;
  while (a < ROUNDS_TO_WIN && d < ROUNDS_TO_WIN && a + d < 2 * HALF) {
    const r = a + d + 1;
    const winner = rng() < roundOdds(beta, r, prev1, prev2) ? 'A' : 'D';
    rounds.push(winner);
    if (winner === 'A') a++; else d++;
    [prev1, prev2] = r % HALF === 0 ? [null, null] : [winner, prev1];
  }
  if (a === HALF && d === HALF) {
    const p = sigmoid(beta);
    while (Math.abs(a - d) < 2) {
      const winner = rng() < p ? 'A' : 'D';
      rounds.push(winner);
      if (winner === 'A') a++; else d++;
    }
    return { rounds, ot: true };
  }
  return { rounds, ot: false };
}

// Tries before a map drawn for a known winner gives up and mirrors one: a 1% underdog's win is found within them all but
// about once in 10^8.
const MAX_TRIES = 2000;

/** A map played for a known winner (`aWins`), exactly: drawn until its winner is that side, else mirrored. */
function playMapWon(rng, beta, aWins) {
  let map = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    map = playMap(rng, beta);
    const won = map.rounds.filter(side => side === 'A').length > map.rounds.length / 2;
    if (won === aWins) return map;
  }
  return { ...map, rounds: map.rounds.map(side => (side === 'A' ? 'D' : 'A')) };
}

/**
 * What a map should bring at edge `beta` → { rounds, overtime }: its expected rounds and its chance to reach twelve all,
 * played forward. How the model is held against the real maps (scripts/simulation-realism.mjs).
 */
export function mapMeans(beta) {
  let states = new Map([[stateKey(0, 0, null, null), { a: 0, d: 0, prev1: null, prev2: null, p: 1 }]]);
  let rounds = 0, overtime = 0;
  for (let total = 0; total < 2 * HALF; total++) {
    const next = new Map();
    for (const { a, d, prev1, prev2, p } of states.values()) {
      const r = total + 1;
      const q = roundOdds(beta, r, prev1, prev2);
      rounds += p;
      for (const [winner, chance] of [['A', q], ['D', 1 - q]]) {
        const na = a + (winner === 'A' ? 1 : 0), nd = d + (winner === 'D' ? 1 : 0);
        if (na >= ROUNDS_TO_WIN || nd >= ROUNDS_TO_WIN) continue;
        const [p1, p2] = r % HALF === 0 ? [null, null] : [winner, prev1];
        const key = stateKey(na, nd, p1, p2);
        const into = next.get(key) ?? { a: na, d: nd, prev1: p1, prev2: p2, p: 0 };
        into.p += p * chance;
        next.set(key, into);
      }
    }
    states = next;
  }
  for (const { p } of states.values()) overtime += p;
  // Overtime's rounds: pairs until one side wins both, each pair decided with p² + (1 − p)².
  const s = sigmoid(beta), decided = s * s + (1 - s) * (1 - s);
  return { rounds: rounds + overtime * 2 / decided, overtime };
}

// ---------- the series ----------

/**
 * Prepare a series once for cheap resampling: the attacker's edge in rating points on every map (`gap`), tactics, upsets
 * and the venue included. `venue.home`: the defender is at home. `rounds` marks a series of maps played round by round,
 * for the live win probability (its kind 'rounds').
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const gap = lineupA.rating + adjustmentA - (lineupD.rating + adjustmentD) - (home ? HOME_EDGE : 0);
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, gap, series: { games: MAPS, toWin: TO_WIN }, rounds: true };
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

/** A map's score from one side: "13–9". */
const scoreline = (own, other) => `${own}–${other}`;

// Who stands out: the pistol round's winner and the map's best player are any of the five, the better player more often,
// each in proportion to his rating above the floor. vlr.gg records each player's rating map by map, but the model draws
// them from the ratings alone.
const STANDOUT_WEIGHTS = { PLR: 1 };
const STANDOUT_FLOOR = 40;

/** A round's clock unit within its map's block: its number in regulation, 25 for overtime's first pair, 26 after. */
const unitOf = n => (n <= 2 * HALF ? n : n <= 2 * HALF + 2 ? 2 * HALF + 1 : 2 * HALF + 2);

/**
 * The whole series: sampleResult's own draws decide every map (so a seed gives the same score on both paths), then each
 * map's rounds are played out given its winner. Events: each pistol round's winner (`pts` 0: the score counts maps) with
 * the round score after it from his side, the side that levels at twelve all, and the map's end (`pts` 1, the winner's),
 * named for its best player. Each event carries the map's rounds from its side (`own`, `opp`) and, for the live chart,
 * the half's last two winners (`prev`).
 */
export function simulateSeries(rng, prepared, drama = 6, mapPool = MAP_POOL) {
  const result = sampleResult(rng, prepared, drama);
  const beta = mapBeta(mapOdds(prepared.gap + result.form));
  const standout = { A: createScorerSampler(prepared.lineupA, STANDOUT_WEIGHTS, STANDOUT_FLOOR),
    D: createScorerSampler(prepared.lineupD, STANDOUT_WEIGHTS, STANDOUT_FLOOR) };
  const pool = mapPool.slice();
  const ev = [];
  result.games.forEach((winner, k) => {
    const start = k * BLOCK;
    const map = pool.splice(Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * pool.length), 1)[0];
    const played = playMapWon(rng, beta, winner === 'A');
    const won = { A: 0, D: 0 };
    played.rounds.forEach((side, i) => {
      won[side]++;
      const n = i + 1;
      const other = side === 'A' ? 'D' : 'A';
      const rounds = { own: won[side], opp: won[other] };
      if (n === 1 || n === HALF + 1) {
        ev.push({ m: start + unitOf(n), side, name: standout[side](rng), pts: 0, game: k + 1, map, round: n, kind: 'pistol',
          score: scoreline(won[side], won[other]), ...rounds });
      }
      if (n === 2 * HALF && won.A === HALF && won.D === HALF) {
        ev.push({ m: start + unitOf(n), side, name: null, pts: 0, game: k + 1, map, round: n, kind: 'overtime',
          score: scoreline(HALF, HALF), ...rounds });
      }
    });
    const loser = winner === 'A' ? 'D' : 'A';
    ev.push({ m: start + unitOf(played.rounds.length), side: winner, name: standout[winner](rng), pts: 1, game: k + 1, map,
      round: played.rounds.length, kind: 'map', score: scoreline(won[winner], won[loser]), own: won[winner], opp: won[loser],
      ...(played.ot ? { ot: true } : {}) });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The map an event or clock unit falls in: M1 for units 1–26, M2 for 27–52… (the start counts as the first). */
export const mapAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, MAPS);
/** The round a clock unit stands for within its map: 1 to 24, "OT" beyond. */
const roundAt = m => {
  const unit = (Number(m) || 0) - (mapAt(m) - 1) * BLOCK;
  return unit > 2 * HALF ? 'OT' : `R${clamp(Math.round(unit), 1, 2 * HALF)}`;
};

/** Valorant's nations-only rulebook: no clubs, Great Britain as one. Its players come from sportData.js. */
const territoryOf = rosters => ({
  merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
  // East Germany and South Vietnam (HISTORIC_NATIONS) are not on today's map.
  inactive: Object.keys(NATIONS).filter(nation => !HOME_NATIONS.includes(nation) && !HISTORIC_NATIONS.includes(nation)
    && !Object.hasOwn(rosters, nation)),
});

/** A campaign's match on `mapPool`: the series and its events, each side's events under its team's id. */
const simulateOn = mapPool => (rng, attacker, defender, drama, effA, effD, venue) => {
  const prepared = prepareMatch(attacker, defender, effA, effD, venue);
  const { ga, gd, ev, winner } = simulateSeries(rng, prepared, drama, mapPool);
  return { ga, gd, regA: ga, regD: gd, tie: null, winner,
    ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
};

const valorantRules = {
  id: 'valorant',
  simulationVersion: 1,
  name: 'Valorant',
  blurb: 'Five-a-side tactical shooter, best of three maps. First to thirteen rounds; at twelve all, two clear in overtime.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: [],
  // Nations only, for now: the orgs (clubs) have no map yet.
  nationsOnly: true,
  // The host nation's edge at a LAN (HOME_EDGE): offered, as the real LANs show one.
  homeAdvantage: HOME_EDGE !== 0,
  // Nor Computer signings: any player plays any place, so the best-rated player is always the best fit.
  signings: false,
  territory: undefined,
  // Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 7,
  formation: { PLR: 5 },
  positionPlan: ['PLR', 'PLR', 'PLR', 'PLR', 'PLR', 'PLR', 'PLR'],
  positionColors: { PLR: C.red },

  fallbackStrength: () => EMPTY_STRENGTH,
  requiredPositions: [],

  // Twenty-six clock units a map; the chart ticks at the end of each. A series ends with its deciding map, the last event:
  // its clock stops there (`endsWithLastEvent`), so a sweep never reads the rounds after its last map ("M2 OT").
  clock: { length: LENGTH, msPerUnit: MS_PER_UNIT, ot: BLOCK, tick: BLOCK, endsWithLastEvent: true },
  tieBreak: 'none',
  labels: { score: 'MAPS', start: 'AGENT SELECT…', live: 'LIVE', end: 'FINAL', tie: 'FINAL', tieShort: '' },

  words: { kickoff: 'First round', end: 'Final', lineup: 'Team', lineupShort: 'Team', lineupNoun: 'team', lineupTitle: 'Team',
    overtime: null, half: null },

  // The clock shows the map and the round: "M2 R14".
  formatClock: m => `M${mapAt(m)} ${roundAt(m)}`,
  // The chart's axis: the end of each map.
  formatTick: t => (t > 0 ? `M${Math.round(t / BLOCK)}` : ''),
  // The feed's live row: "map 2, best of 3".
  clockLeft: now => `map ${mapAt(now)}, best of ${MAPS}`,
  // A map's end names the map and its best player: "ASCENT — BRA 13–9 · aspas" (match.js reads it back from history).
  formatEvent: (e, code) => ({ when: `M${e.game || mapAt(e.m)}`, text: e.pts > 0
    ? `${String(e.map ?? 'MAP').toUpperCase()} — ${code} ${e.score}${e.ot ? ' OT' : ''}${e.name ? ` · ${e.name}` : ''}`
    : e.kind === 'overtime' ? `OVERTIME — ${code} level it ${e.score}`
      : `PISTOL — ${e.name} (${code}) ${e.score}` }),
  formatToast: e => (e.pts > 0 ? `MAP ${e.game} — ${e.score}${e.ot ? ' OT' : ''}`
    : e.kind === 'overtime' ? `OVERTIME — ${e.score}` : `PISTOL — ${String(e.name).toUpperCase()}`),

  /** The rules a campaign plays (matchSport): an earlier season's map pool (`valorantIn`), today's for the built-in one. */
  rulesFor: settings => valorantIn(settings),

  prepareMatch,
  sampleResult,
  simulate: simulateOn(MAP_POOL),
};

export const valorant = defineSportData({ ...valorantRules }, { clubs: false, territoryOf });

/**
 * Valorant on an earlier season's map pool (`rules`: { year, mapPool }): the same series, its maps drawn from that year's
 * pool. Who wins is Elo's whatever the maps, so a season's odds are today's and its simulation version too.
 */
export function valorantWith(rules) {
  return defineSportData({ ...valorantRules, rules, simulate: simulateOn(rules.mapPool) }, { clubs: false, territoryOf });
}

const seasonValorant = rulesMemo(year => valorantWith(Object.freeze({ year, mapPool: VALORANT_MAP_POOLS[year] })));

/**
 * Valorant as a setup's or campaign's season played it (`settings`: `dataSet`, `dataYear`; matchSport): each earlier
 * season on its own December's map pool (VALORANT_MAP_POOLS). The built-in season, which has no data set, and a year the
 * table lacks play today's (`valorant` itself).
 */
export function valorantIn(settings) {
  const year = rulesYear(settings);
  return year != null && Object.hasOwn(VALORANT_MAP_POOLS, year) ? seasonValorant(year) : valorant;
}

/**
 * Squad-screen strength profile: the five who play and the best of them → { team, best } on the player-rating scale.
 * Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function valorantProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected?.slots?.length) return { team: 0, best: 0 };
  const ratings = selected.slots.map(slot => slot.effectiveRating);
  return { team: ratings.reduce((sum, r) => sum + r, 0) / ratings.length, best: Math.max(...ratings) };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const ROUNDS_MODEL = Object.freeze({ MAPS, TO_WIN, BLOCK, HALF, LENGTH, FORM_AT_BALANCED });
