import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.hockey.js';
import { CLUBS } from '../data/clubs.hockey.js';
import { GREAT_BRITAIN, HOME_NATIONS, selectLineup } from '../data/teams.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';

// Three twenty-minute periods, told in three-minute slices: the score decides how each slice is played. Level after
// sixty, five minutes of sudden-death overtime at three on three, then a shoot-out, whose winner gets one goal more on
// the final score, as the NHL counts it.
const MINUTES = 60;
const PERIOD = 20;
const OVERTIME = 5;
const SLICE = 3;
const SLICES = MINUTES / SLICE;
// The clock's place for a shoot-out, after the overtime's last minute.
const SHOOTOUT_MINUTE = MINUTES + OVERTIME + 1;

// Goals in sixty minutes when a side's attack meets an equal defence, and how far each point of attack over the opposing
// defence moves that rate (log scale): a full 82-game season then spreads the clubs about as the NHL's are spread. A
// defence holds the goalie, usually rated above the skaters, so between average clubs the edge is about −2 points and
// the rate about 2.75, which the late game's chasing and empty nets lift to the NHL's three goals a team.
const BASE_GOALS = 3.06;
const RATING_SCALE = 0.058;
// Smooth saturation, as in football: a huge gap stays plausible, and the underdog can always score.
const MAX_LOG_EDGE = 1.2;
// Match-day form in log scoring rate at Balanced: a hot goalie, a cold power play. Grows with the square of the drama,
// as football's does, so Wild and an all-out Attack swing a game hard and Defend barely does.
const FORM_AT_BALANCED = 0.1;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Home advantage, a campaign option (off: a neutral venue): apart in log scoring rate, so that equal sides win about
// 55% at home, as NHL home sides do.
const HOME_EDGE = 0.1;

// Score effects. A level game late on tightens up (neither side gives away the point the overtime guarantees), and a
// side a goal down pushes while the leader sits back. They are what puts nearly a quarter of NHL games into overtime,
// where two independent scoring rates would send one in six.
const LATE_SLICE = 13; // from the 40th minute
const LEVEL_LATE = 0.72;
const TRAILING_LATE = 1.38;
const LEADING_LATE = 0.82;
// At any time, a side three or more up eases off: the NHL has fewer blowouts than its scoring rates alone would give.
const EASING_LEAD = 3;
const EASED = 0.8;
// The last slice: a side a goal or two down pulls its goalie.
const LAST_SLICE = SLICES - 1;
const PULLED_ATTACK = 1.5;
const EMPTY_NET = 0.55; // goals a slice into the empty net, on top of the leader's own

// Overtime at three on three: about two games in three end in it.
const OVERTIME_BOOST = 2.4;
// A shoot-out is close to a coin flip: each point of the sides' difference moves it a little.
const SHOOTOUT_SLOPE = 0.03;

/** The strength of a nation with no NHL players, and of a lineup place a nation's own players cannot fill. */
export const BASELINE = 45;

// Who plays how much: the top line and the top pair take the most minutes.
const LINE_SHARE = [0.36, 0.3, 0.21, 0.13];
const PAIR_SHARE = [0.42, 0.35, 0.23];
const FORWARDS_IN_ATTACK = 0.85;
const FORWARDS_IN_DEFENCE = 0.3;
const GOALIE_IN_DEFENCE = 0.5;

const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);
const descending = (a, b) => b - a;

function profile(lineup) {
  const of = position => lineup.slots.filter(slot => slot.position === position).map(slot => slot.effectiveRating).sort(descending);
  const c = of('C'), lw = of('LW'), rw = of('RW'), d = of('D'), g = of('G');
  const forwards = LINE_SHARE.reduce((sum, share, i) => sum + share * mean([c[i] ?? 40, lw[i] ?? 40, rw[i] ?? 40]), 0);
  const defenders = PAIR_SHARE.reduce((sum, share, i) => sum + share * mean([d[2 * i] ?? 40, d[2 * i + 1] ?? 40]), 0);
  const goalie = g[0] ?? 40;
  const skaters = FORWARDS_IN_DEFENCE * forwards + (1 - FORWARDS_IN_DEFENCE) * defenders;
  return { forwards, defenders, goalie, attack: FORWARDS_IN_ATTACK * forwards + (1 - FORWARDS_IN_ATTACK) * defenders,
    defence: GOALIE_IN_DEFENCE * goalie + (1 - GOALIE_IN_DEFENCE) * skaters };
}

const rate = log => BASE_GOALS * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at home
 * (the campaign's home advantage); a neutral venue otherwise.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  const edgeA = a.attack + adjustmentA - (d.defence + adjustmentD), edgeD = d.attack + adjustmentD - (a.defence + adjustmentA);
  const venue = home ? HOME_EDGE / 2 : 0;
  return {
    attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD,
    rateA: rate(edgeA * RATING_SCALE) * Math.exp(-venue), rateD: rate(edgeD * RATING_SCALE) * Math.exp(venue),
    // How far ahead the attacker is in a shoot-out, in rating points.
    shootout: edgeA - edgeD,
  };
}

/**
 * The goals each side should expect in slice `s` at sixty-minute rates `rateA`, `rateD`, the attacker `margin` goals
 * ahead → [attacker, defender]. Exported for the live win probability, which plays the same slices.
 */
export function sliceMeans(rateA, rateD, margin, s) {
  let a = rateA * SLICE / MINUTES, d = rateD * SLICE / MINUTES;
  if (margin >= EASING_LEAD) a *= EASED;
  else if (margin <= -EASING_LEAD) d *= EASED;
  if (s >= LATE_SLICE) {
    if (margin === 0) { a *= LEVEL_LATE; d *= LEVEL_LATE; }
    else if (margin === 1) { a *= LEADING_LATE; d *= TRAILING_LATE; }
    else if (margin === -1) { a *= TRAILING_LATE; d *= LEADING_LATE; }
  }
  if (s === LAST_SLICE) {
    if (margin === 1 || margin === 2) { d *= PULLED_ATTACK; a += EMPTY_NET; }
    else if (margin === -1 || margin === -2) { a *= PULLED_ATTACK; d += EMPTY_NET; }
  }
  return [a, d];
}

/** The goals each side should expect in the five minutes of overtime → [attacker, defender]. */
export function overtimeMeans(rateA, rateD) {
  const scale = OVERTIME_BOOST * OVERTIME / MINUTES;
  return [rateA * scale, rateD * scale];
}

/** The attacker's chance in a shoot-out. */
export const shootoutOdds = edge => logistic(SHOOTOUT_SLOPE * edge);

/**
 * Score-only path: match-day form, then the regulation slices one by one, then sudden death and the shoot-out. Also
 * returns the goals in order (`goals`: { side, slice }, overtime's slice SLICES, the shoot-out's SLICES + 1) and the
 * overtime goal's share of the five minutes (`overtimeAt`), so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = Math.exp(gauss(rng) * formSpread(variation));
  const rateA = prepared.rateA * form, rateD = prepared.rateD / form;
  const goals = [];
  let regA = 0, regD = 0;
  for (let s = 0; s < SLICES; s++) {
    const [meanA, meanD] = sliceMeans(rateA, rateD, regA - regD, s);
    const a = poisson(rng, meanA), d = poisson(rng, meanD);
    for (let k = 0; k < a; k++) goals.push({ side: 'A', slice: s });
    for (let k = 0; k < d; k++) goals.push({ side: 'D', slice: s });
    regA += a;
    regD += d;
  }
  let ga = regA, gd = regD, tie = null, overtimeAt = 0;
  if (ga === gd) {
    const [meanA, meanD] = overtimeMeans(rateA, rateD);
    const total = meanA + meanD, none = Math.exp(-total);
    const roll = clamp(rng(), 0, 1 - Number.EPSILON);
    if (roll >= none) {
      // Sudden death: when the deciding goal falls within the five minutes, and whose it is.
      overtimeAt = -Math.log(1 - (roll - none)) / total;
      const side = rng() < meanA / total ? 'A' : 'D';
      goals.push({ side, slice: SLICES });
      if (side === 'A') ga++; else gd++;
      tie = { periods: [side === 'A' ? [1, 0] : [0, 1]], ga, gd };
    } else {
      const side = rng() < shootoutOdds(prepared.shootout) ? 'A' : 'D';
      goals.push({ side, slice: SLICES + 1 });
      if (side === 'A') ga++; else gd++;
      tie = { periods: [[0, 0], side === 'A' ? [1, 0] : [0, 1]], ga, gd };
    }
  }
  return { ga, gd, regA, regD, tie, goals, overtimeAt, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/**
 * Who scores: forwards about four goals in five, defenders the rest, the goalies never. The floor is high because a
 * first-liner scores many times what a fourth-liner does, and nearly every NHL rating sits within twenty points.
 */
const SCORER_WEIGHTS = { C: 1, LW: 1, RW: 1, D: 0.3, G: 0.0001 };
const SCORER_FLOOR = 74;

export const hockey = {
  id: 'hockey',
  simulationVersion: 1,
  name: 'Ice hockey',
  blurb: 'Four lines, three pairs and a goalie, three periods. Fast and low-scoring — level games go to overtime, then a shoot-out.',
  rosters: ROSTERS,
  clubs: CLUBS,
  // Ice hockey's Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire.
  territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
  // That empire plays as Great Britain, under the Union Jack.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 19,
  formation: { C: 4, LW: 4, RW: 4, D: 6, G: 1 },
  positionPlan: ['C', 'C', 'C', 'C', 'LW', 'LW', 'LW', 'LW', 'RW', 'RW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'D', 'D', 'G'],
  positionColors: { C: C.red, LW: C.green, RW: C.green, D: C.cyan, G: C.gold },

  // Nations with no NHL players are hockey's minnows, all alike: the game is a few nations' sport.
  fallbackStrength: () => BASELINE,
  requiredPositions: ['G'],

  // `sudden`: overtime ends with the goal that decides it. The chart ticks at the end of every period.
  clock: { length: MINUTES, msPerUnit: 68, ot: OVERTIME, sudden: true, tick: PERIOD },
  tieBreak: 'overtime',
  labels: {
    score: 'GOALS',
    start: 'PUCK DROP…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'OVERTIME',
    tieShort: 'OT',
  },

  words: { kickoff: 'Puck drop', end: 'Final', lineup: 'Starting lineup', lineupShort: 'Lineup', lineupNoun: 'starting lineup',
    lineupTitle: 'Lineup', overtime: 'Overtime', half: null },

  formatClock: m => (m >= SHOOTOUT_MINUTE ? 'SO' : `${m}'`),
  // The chart's axis: each period's end, then overtime and the shoot-out.
  formatTick: t => (t >= SHOOTOUT_MINUTE ? 'SO' : t > MINUTES ? 'OT' : `${t}'`),
  // A game level after sixty is decided in overtime or, a second period here, in a shoot-out.
  overtime: {
    text: periods => (periods > 1 ? 'in a shoot-out' : 'in overtime'),
    short: periods => (periods > 1 ? 'SO' : 'OT'),
    periodsOf: text => (/shoot-?out/i.test(text) ? 2 : /overtime/i.test(text) ? 1 : null),
  },
  formatEvent: (e, code) => (e.m >= SHOOTOUT_MINUTE
    ? { when: 'SO', text: `SHOOT-OUT — ${e.name} (${code})` }
    : { when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => (e.m >= SHOOTOUT_MINUTE ? `SHOOT-OUT — ${e.name.toUpperCase()}` : `${e.m}' GOAL — ${e.name.toUpperCase()}`),

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, regA, regD, tie, goals, overtimeAt, winner } = sampleResult(rng, prepared, drama);
    const scorerA = createScorerSampler(prepared.lineupA, SCORER_WEIGHTS, SCORER_FLOOR);
    const scorerD = createScorerSampler(prepared.lineupD, SCORER_WEIGHTS, SCORER_FLOOR);
    const ev = [];
    for (const { side, slice } of goals) {
      const own = side === 'A';
      const m = slice === SLICES + 1 ? SHOOTOUT_MINUTE
        : slice === SLICES ? MINUTES + clamp(Math.ceil(overtimeAt * OVERTIME), 1, OVERTIME)
          : slice * SLICE + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE);
      ev.push({ m, tid: own ? attacker.id : defender.id, name: (own ? scorerA : scorerD)(rng), pts: 1 });
    }
    ev.sort((x, y) => x.m - y.m);
    return { ga, gd, regA, regD, ev, tie, winner };
  },
};

/**
 * Squad-screen strength profile: the attack, the defence and the goalie the match model weighs → { attack, defence,
 * goaltending } on the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first.
 * Read-only; no RNG.
 */
export function hockeyProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => slot.position === 'G')) return { attack: 0, defence: 0, goaltending: 0 };
  const { attack, defenders, forwards, goalie } = profile(selected);
  return { attack, defence: FORWARDS_IN_DEFENCE * forwards + (1 - FORWARDS_IN_DEFENCE) * defenders, goaltending: goalie };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const PERIOD_MODEL = Object.freeze({ MINUTES, OVERTIME, SLICE, SLICES, SHOOTOUT_MINUTE, FORM_AT_BALANCED });
