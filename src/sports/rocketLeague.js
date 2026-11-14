import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { GREAT_BRITAIN, HISTORIC_NATIONS, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';

// Rocket League as the RLCS plays its playoffs (docs/design/rocket-league.md): two teams of three, a series of games, best
// of seven. A game is five minutes; level at the end, it goes to sudden-death overtime, and the next goal wins it,
// however long that takes. Nations only for now: each fields its three best players by Liquipedia's results.
export const GAMES = 7;
export const TO_WIN = 4;

// A game's five minutes in ten slices of thirty seconds: the score decides how each slice is played. On the clock a game
// has twelve units, its ten slices and two for its overtime, played or not, so the shortest series (four games) fills
// 48 units and each further game extends it as an overtime period does in other sports.
export const SLICE_SECONDS = 30;
export const SLICES = 10;
export const BLOCK = SLICES + 2;
export const LENGTH = TO_WIN * BLOCK;
const MS_PER_UNIT = 85;

// Ratings are Elo built from every game Liquipedia records (scripts/lib/rocket-league.mjs), on the game's scale: rating
// = Elo / 25 − 2, so a rating point is 25 Elo points. A team plays at its three players' mean, as the Elo was built, and
// wins each game with Elo's own odds: a 4-point favourite (100 Elo) wins 64% of games, an 8-point one 76%.
export const ELO_PER_POINT = 25;
/** The favourite's chance in one game, `gap` rating points ahead. */
export const gameOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// Goals in a game's five minutes, both sides together, between equal teams, and the last minute (two slices): a side a goal
// down pushes up (its rate × TRAILING_LATE) and the leader sits back (× LEADING_LATE); level, both go for the winner (×
// LEVEL_LATE). Fitted on the 20,072 games of the three years to 2026-11-13 in Liquipedia's export whose six players had
// each played 20 games before, as a rated player has (docs/design/rocket-league.md, "Calibration"), each played through this
// model at its own pre-game Elo odds: 4.23 goals a game where they scored 4.25, 19.8% of the games to overtime where 19.7%
// went, won by one goal 51.8% (52.1%), by two 22.1% (21.6%), by three or more 26.2% (26.3%). Without the late game the same
// goals give 18.1% overtime and 50.3% by one.
export const GOALS = 3.8;
const LATE_SLICES = 2;
const TRAILING_LATE = 1.4;
const LEADING_LATE = 0.9;
const LEVEL_LATE = 1.1;
// Overtime's pace against regulation's: in those games its goal came after 95 seconds on average (median 64, as sudden
// death's waiting time has it), where the same sides' regulation pace would have taken 79. It times the goal on the clock,
// never who scores it.
const OVERTIME_PACE = 0.83;

// Match-day form: one draw for the series in rating points, on every game's gap. It grows with the square of the drama,
// as in the other sports, so Wild swings series hard and Predictable plays Elo's odds game by game. Real series are less
// predictable than their games: in the same years' 1,092 best-of-sevens with a favourite, its game odds 0.686 on average
// before the first game, the favourite won 79.2%, where independent games at those odds would win 81.6%. The series'
// scorelines are likeliest with a spread of 4.5 rating points (112 Elo) at Balanced: the favourite wins 76.9%, sweeps 27.8%
// (27.9% real), and the underdog sweeps 3.3% (2.9%).
const FORM_AT_BALANCED = 4.5;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// No home advantage: in the 1,853 games of the export's LANs where one side was the host nation's, that side did as Elo
// expected, within the error (+9.9 ± 7.7 Elo), so the campaign's Home advantage rule is not offered (`homeAdvantage`
// false) and a home venue changes nothing.
export const HOME_EDGE = 0;

/** What a nation counts for when none of its players is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

// ---------- one game ----------

const MAX_MARGIN = 12;
const GOAL_CAP = 8;

/** Poisson(λ) masses for 0..GOAL_CAP, the last one holding "GOAL_CAP or more". */
function masses(lambda) {
  const out = new Array(GOAL_CAP + 1).fill(0);
  let mass = Math.exp(-lambda), total = 0;
  for (let k = 0; k < GOAL_CAP; k++) {
    out[k] = mass;
    total += mass;
    mass *= lambda / (k + 1);
  }
  out[GOAL_CAP] = Math.max(0, 1 - total);
  return out;
}

/**
 * The goals each side should expect in slice `s` (0 to 9) of a game whose five-minute rates are `rateA`, `rateD`, the
 * attacker `margin` goals ahead → [attacker, defender]. Exported for the live win probability, which plays the same slices.
 */
export function sliceMeans(rateA, rateD, margin, s) {
  let a = rateA / SLICES, d = rateD / SLICES;
  if (s >= SLICES - LATE_SLICES) {
    if (margin === 0) { a *= LEVEL_LATE; d *= LEVEL_LATE; }
    else if (margin === 1) { a *= LEADING_LATE; d *= TRAILING_LATE; }
    else if (margin === -1) { a *= TRAILING_LATE; d *= LEADING_LATE; }
  }
  return [a, d];
}

/** The attacker's chance to score first in overtime, which wins the game. */
export const overtimeOdds = (rateA, rateD) => (rateA + rateD > 0 ? rateA / (rateA + rateD) : 0.5);

/**
 * The attacker's chance to win a game from each state, played backwards: `table[s][margin + MAX_MARGIN]` is the chance
 * from the start of slice `s` (10: the end of regulation) `margin` goals ahead. Exported for the live win probability.
 */
export function gameTable(rateA, rateD) {
  const width = 2 * MAX_MARGIN + 1;
  const table = Array.from({ length: SLICES + 1 }, () => new Float64Array(width));
  const level = overtimeOdds(rateA, rateD);
  for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) table[SLICES][m + MAX_MARGIN] = m > 0 ? 1 : m < 0 ? 0 : level;
  for (let s = SLICES - 1; s >= 0; s--) {
    for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) {
      const [a, d] = sliceMeans(rateA, rateD, m, s);
      const pa = masses(a), pd = masses(d);
      let chance = 0;
      for (let i = 0; i <= GOAL_CAP; i++) {
        if (pa[i] < 1e-12) continue;
        for (let j = 0; j <= GOAL_CAP; j++) {
          const next = clamp(m + i - j, -MAX_MARGIN, MAX_MARGIN);
          chance += pa[i] * pd[j] * table[s + 1][next + MAX_MARGIN];
        }
      }
      table[s][m + MAX_MARGIN] = chance;
    }
  }
  return table;
}

/** The attacker's chance from the start of slice `s`, `margin` goals ahead, in a game's table. */
export const chanceFrom = (table, s, margin) => table[clamp(s, 0, SLICES)][clamp(margin, -MAX_MARGIN, MAX_MARGIN) + MAX_MARGIN];

/** The two sides' five-minute rates when the attacker's share of the goals is `split` (log scale): GOALS between them. */
const ratesOf = split => [GOALS / 2 * Math.exp(split), GOALS / 2 * Math.exp(-split)];

// A game's win chance by the split of the goals, on a grid of splits (built when first read): the split that gives Elo's
// odds is read from it between its points, so the goals follow the ratings and the winner is Elo's exactly.
const SPLIT_STEP = 1 / 64, SPLIT_RANGE = 4;
let splitTable = null;
function splits() {
  if (!splitTable) {
    splitTable = [];
    for (let i = 0; i <= 2 * SPLIT_RANGE / SPLIT_STEP; i++) {
      const split = -SPLIT_RANGE + i * SPLIT_STEP;
      const [a, d] = ratesOf(split);
      splitTable.push(chanceFrom(gameTable(a, d), 0, 0));
    }
  }
  return splitTable;
}

/**
 * The two sides' five-minute scoring rates in a game the attacker wins with `odds` → [attacker, defender]: the goals
 * split between them so that the game, played slice by slice with its late game and overtime, is the attacker's with
 * exactly that chance. Exported for the live win probability.
 */
export function gameRates(odds) {
  const table = splits();
  const target = clamp(odds, table[0], table.at(-1));
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < target) lo = mid; else hi = mid;
  }
  const t = table[hi] > table[lo] ? (target - table[lo]) / (table[hi] - table[lo]) : 0;
  return ratesOf(-SPLIT_RANGE + (lo + t) * SPLIT_STEP);
}

/**
 * One game, slice by slice, at five-minute rates `rateA`, `rateD` → { goals: [{ side, s, at }], ot, otSeconds }: each
 * goal's side, its slice (10 for overtime's) and its seconds into the game. Level after five minutes, overtime's first
 * goal wins, after an exponential wait at the two sides' rates and overtime's pace.
 */
function playGame(rng, rateA, rateD) {
  const goals = [];
  let margin = 0;
  for (let s = 0; s < SLICES; s++) {
    const [a, d] = sliceMeans(rateA, rateD, margin, s);
    const scored = [];
    for (let k = poisson(rng, a); k > 0; k--) scored.push('A');
    for (let k = poisson(rng, d); k > 0; k--) scored.push('D');
    const times = scored.map(() => s * SLICE_SECONDS + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE_SECONDS)).sort((x, y) => x - y);
    // Who scored first within the slice is a fair shuffle of its goals.
    for (let i = scored.length - 1; i > 0; i--) {
      const j = Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * (i + 1));
      [scored[i], scored[j]] = [scored[j], scored[i]];
    }
    scored.forEach((side, i) => {
      goals.push({ side, s, at: times[i] });
      margin += side === 'A' ? 1 : -1;
    });
  }
  if (margin !== 0) return { goals, ot: false, otSeconds: 0 };
  const total = rateA + rateD;
  const otSeconds = Math.max(1, Math.round(-Math.log(1 - clamp(rng(), 0, 1 - Number.EPSILON)) / (total * OVERTIME_PACE) * SLICES * SLICE_SECONDS));
  goals.push({ side: rng() < overtimeOdds(rateA, rateD) ? 'A' : 'D', s: SLICES, at: SLICES * SLICE_SECONDS + otSeconds });
  return { goals, ot: true, otSeconds };
}

// Tries before a game drawn for a known winner gives up and mirrors one: a 0.5% underdog's win is found within them all
// but about once in 150,000.
const MAX_TRIES = 2400;

/** A game played for a known winner (`aWins`), exactly: drawn until its winner is that side, else mirrored. */
function playGameWon(rng, rateA, rateD, aWins) {
  let game = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    game = playGame(rng, rateA, rateD);
    const margin = game.goals.reduce((sum, goal) => sum + (goal.side === 'A' ? 1 : -1), 0);
    if ((margin > 0) === aWins) return game;
  }
  return { ...game, goals: game.goals.map(goal => ({ ...goal, side: goal.side === 'A' ? 'D' : 'A' })) };
}

// ---------- the series ----------

/**
 * Prepare a series once for cheap resampling: the attacker's edge in rating points on every game (`gap`), tactics,
 * upsets and the venue included. `venue.home`: the defender is at home.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const gap = lineupA.rating + adjustmentA - (lineupD.rating + adjustmentD) - (home ? HOME_EDGE : 0);
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, gap, series: { games: GAMES, toWin: TO_WIN } };
}

/**
 * Score-only path: one form draw for the series, then each game won with Elo's odds for the gap until a side has four.
 * Also returns the form and who won each game (`games`, 'A' or 'D'), which the full simulation plays out.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const odds = gameOdds(prepared.gap + form);
  const games = [];
  let ga = 0, gd = 0;
  while (ga < TO_WIN && gd < TO_WIN) {
    if (rng() < odds) { ga++; games.push('A'); } else { gd++; games.push('D'); }
  }
  return { ga, gd, regA: ga, regD: gd, tie: null, winner: ga > gd ? prepared.attackerId : prepared.defenderId, form, games };
}

/** A game's score from one side: "3–1". */
const scoreline = (own, other) => `${own}–${other}`;
/** Overtime's length as Rocket League shows it: "+0:42", "+3:05". */
export const overtimeClock = seconds => `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Who scores: any of the three, the better player more often, each in proportion to his rating above the floor. The
 * floor sits well below the ratings, so the goals spread across all three: France's 94, 88 and 86 score 36%, 32% and
 * 31% of theirs. Liquipedia records no scorers, so this is the model's choice, not a fit.
 */
const SCORER_WEIGHTS = { PLR: 1 };
const SCORER_FLOOR = 40;

/**
 * The whole series: sampleResult's own draws decide every game (so a seed gives the same score on both paths), then each
 * game's goals are played out given its winner. Events: each goal (`pts` 0: the score counts games) at its slice on the
 * clock, with the game's score after it from the scorer's side; then the game's end (`pts` 1, the winner's), at the
 * end of its regulation or of its overtime, named for the goal that won it.
 */
export function simulateSeries(rng, prepared, drama = 6) {
  const result = sampleResult(rng, prepared, drama);
  const [rateA, rateD] = gameRates(gameOdds(prepared.gap + result.form));
  const scorer = { A: createScorerSampler(prepared.lineupA, SCORER_WEIGHTS, SCORER_FLOOR),
    D: createScorerSampler(prepared.lineupD, SCORER_WEIGHTS, SCORER_FLOOR) };
  const ev = [];
  result.games.forEach((winner, k) => {
    const start = k * BLOCK;
    const game = playGameWon(rng, rateA, rateD, winner === 'A');
    const goals = { A: 0, D: 0 };
    const loserFinal = game.goals.filter(goal => goal.side !== winner).length;
    let decider = null;
    for (const goal of game.goals) {
      goals[goal.side]++;
      const other = goal.side === 'A' ? 'D' : 'A';
      const name = scorer[goal.side](rng);
      if (goal.side === winner && goals[winner] === loserFinal + 1) decider = name;
      ev.push({ m: start + (game.ot && goal.s === SLICES ? (game.otSeconds <= SLICE_SECONDS ? SLICES + 1 : SLICES + 2) : goal.s + 1),
        side: goal.side, name, pts: 0, game: k + 1, score: scoreline(goals[goal.side], goals[other]),
        ...(goal.s === SLICES ? { ot: true, clock: overtimeClock(game.otSeconds) } : {}) });
    }
    const loser = winner === 'A' ? 'D' : 'A';
    ev.push({ m: start + (game.ot ? (game.otSeconds <= SLICE_SECONDS ? SLICES + 1 : SLICES + 2) : SLICES), side: winner,
      name: decider, pts: 1, game: k + 1, score: scoreline(goals[winner], goals[loser]), ...(game.ot ? { ot: true } : {}) });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The game an event or clock unit falls in: G1 for units 1–12, G2 for 13–24… (the start counts as the first). */
export const gameAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, GAMES);

/** Rocket League's nations-only rulebook: no clubs, Great Britain as one. Its players come from sportData.js. */
const territoryOf = rosters => ({
  merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
  // East Germany and South Vietnam (HISTORIC_NATIONS) are not on today's map.
  inactive: Object.keys(NATIONS).filter(nation => !HOME_NATIONS.includes(nation) && !HISTORIC_NATIONS.includes(nation)
    && !Object.hasOwn(rosters, nation)),
});

const rocketLeagueRules = {
  id: 'rocket-league',
  simulationVersion: 1,
  name: 'Rocket League',
  blurb: 'Three-a-side car football, best of seven. Five-minute games; a level game goes to sudden-death overtime.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: [],
  // Nations only, for now: the orgs (clubs) have no map yet.
  nationsOnly: true,
  // No home advantage to offer: the LANs' host nations did as Elo expected (HOME_EDGE).
  homeAdvantage: false,
  // Nor Computer signings: any player plays any place, so the best-rated player is always the best fit.
  signings: false,
  // Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire. A nation with fewer
  // than three rated players fields no team, and its land stays neutral.
  territory: undefined,
  // That empire plays as Great Britain, under the Union Jack.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 5,
  formation: { PLR: 3 },
  positionPlan: ['PLR', 'PLR', 'PLR', 'PLR', 'PLR'],
  positionColors: { PLR: C.cyan },

  fallbackStrength: () => EMPTY_STRENGTH,
  requiredPositions: [],

  // Twelve clock units a game; the chart ticks at the end of each. A series ends with its deciding game, the last event.
  clock: { length: LENGTH, msPerUnit: MS_PER_UNIT, ot: BLOCK, tick: BLOCK },
  tieBreak: 'none',
  labels: {
    score: 'GAMES',
    start: 'KICKOFF…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'FINAL',
    tieShort: '',
  },

  words: { kickoff: 'Kickoff', end: 'Final', lineup: 'Team', lineupShort: 'Team', lineupNoun: 'team', lineupTitle: 'Team',
    overtime: null, half: null },

  // The clock shows the game in play: "G3".
  formatClock: m => `G${gameAt(m)}`,
  // The chart's axis: the end of each game.
  formatTick: t => (t > 0 ? `G${Math.round(t / BLOCK)}` : ''),
  // The feed's live row: "game 3 of 7 at most".
  clockLeft: now => `game ${gameAt(now)}, best of ${GAMES}`,
  formatEvent: (e, code) => ({ when: `G${e.game || gameAt(e.m)}`, text: e.pts > 0
    ? `GAME ${e.game} — ${code} ${e.score}${e.ot ? ' OT' : ''}`
    : `${e.ot ? 'OVERTIME GOAL' : 'GOAL'} — ${e.name} (${code}) ${e.score}${e.ot && e.clock ? ` ${e.clock}` : ''}` }),
  formatToast: e => (e.pts > 0 ? `GAME ${e.game} — ${e.score}${e.ot ? ' OT' : ''}`
    : `${e.ot ? 'OVERTIME GOAL' : 'GOAL'} — ${String(e.name).toUpperCase()}`),

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, ev, winner } = simulateSeries(rng, prepared, drama);
    return { ga, gd, regA: ga, regD: gd, tie: null, winner,
      ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
  },
};

export const rocketLeague = defineSportData({ ...rocketLeagueRules }, { clubs: false, territoryOf });

/**
 * Squad-screen strength profile: the three who play and the best of them → { team, best } on the player-rating scale.
 * Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function rocketLeagueProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected?.slots?.length) return { team: 0, best: 0 };
  const ratings = selected.slots.map(slot => slot.effectiveRating);
  return { team: ratings.reduce((sum, r) => sum + r, 0) / ratings.length, best: Math.max(...ratings) };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const SERIES_MODEL = Object.freeze({ GAMES, TO_WIN, BLOCK, SLICES, LENGTH, FORM_AT_BALANCED, GOALS });
