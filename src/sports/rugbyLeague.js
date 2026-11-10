import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { selectLineup } from '../data/teams.js';
import { clamp, gauss, poisson } from '../engine/random.js';

// Two forty-minute halves, told in five-minute slices: the score decides how each slice is played. A try is four points
// and its conversion two more, a penalty goal two and a field goal one. Level after eighty, golden point: five-minute
// halves of extra time, and the first score wins. The NRL calls a game still level after ten minutes a draw; a campaign
// needs a winner, so golden point runs on, as in the finals, and after twenty minutes a field goal decides it.
const MINUTES = 80;
const HALF = 40;
const SLICE = 5;
const SLICES = MINUTES / SLICE;
const GOLDEN = 5;
const MAX_GOLDEN = 4;

/** Points of each kind of score. */
export const POINTS = Object.freeze({ TRY: 4, CONVERSION: 2, PENALTY_GOAL: 2, FIELD_GOAL: 1 });

// Tries a side scores in eighty minutes when its attack meets an equal defence, and how far each point of attack over the
// opposing defence moves that rate (log scale): a 24-round season then spreads the clubs as the NRL's are spread.
const BASE_TRIES = 3.75;
const RATING_SCALE = 0.14;
// Smooth saturation, as in football: a huge gap stays plausible, and the underdog can always score.
const MAX_LOG_EDGE = 1.4;
// Conversions made, the NRL's rate: Rugby League 26's overall says nothing of a goal-kicker's boot.
const CONVERSION_RATE = 0.755;
// Penalty goals a side kicks in eighty minutes between equals.
const BASE_PENALTY_GOALS = 0.39;
// Match-day form in log scoring rate at Balanced; grows with the square of the drama, as football's does.
const FORM_AT_BALANCED = 0.2;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Home advantage, a campaign option (off: a neutral venue): apart in log try rate.
const HOME_EDGE = 0.16;

// Tired defences: a little more than half the points come after half-time.
const HALF_SLICES = 8;
const SECOND_HALF = 1.03;
// Score effects, from the 60th minute: a side a converted try or less behind chases, and the leader protects its lead. Both
// sides take the two points of a penalty in a tight game, and a side behind by more than a converted try runs them.
const LATE_SLICE = 12;
const CHASING = 1.15;
const PROTECTING = 0.92;
const PENALTY_TAKEN = 1.8;
const PENALTY_RUN = 0.5;
// At any time a side twenty or more ahead eases off.
const EASING_LEAD = 20;
const EASED = 0.92;
// Field goals in the last ten minutes, a side's chance a slice by its lead: level, to edge ahead; six up, to lead by more
// than a converted try; twelve up, by more than two. Golden point's are the scores that end most of them.
const FIELD_GOAL_SLICES = 2;
const FIELD_GOAL_CHANCES = Object.freeze({ 0: 0.3, 6: 0.14, 12: 0.06, '-1': 0.1 });
// Golden point: the scores a side makes in five minutes of extra time between equals (most are field goals), and how
// they split.
const GOLDEN_RATE = 0.62;
const GOLDEN_SHARES = Object.freeze({ fieldGoal: 0.62, penaltyGoal: 0.12, try: 0.26 });
// A golden point's last, deciding field goal: close to a coin flip.
const DECIDER_SLOPE = 0.04;

/** The strength of a nation with no NRL players, and of a lineup place a nation's own players cannot fill. */
export const BASELINE = 45;

// The matchday 17: the thirteen and four on the interchange bench, who play about half a game each. Of each position's
// places in the lineup the best-rated players start (two props, a hooker, two second-rowers and a lock); the rest of
// them are the bench.
const BACKS = ['FB', 'WG', 'CE'];
const HALVES = ['FE', 'HB'];
const FORWARDS = ['PR', 'HK', 'SR', 'LK'];
const STARTING = Object.freeze({ FB: 1, WG: 2, CE: 2, FE: 1, HB: 1, PR: 2, HK: 1, SR: 2, LK: 1 });
const BENCH_SHARE = 0.5;

/** A lineup's slots → { starters, bench }: the thirteen on the field and the interchange bench. */
export function onField(lineup) {
  const byPosition = new Map();
  for (const slot of lineup.slots) {
    if (!byPosition.has(slot.position)) byPosition.set(slot.position, []);
    byPosition.get(slot.position).push(slot);
  }
  const starters = [], bench = [];
  for (const [position, slots] of byPosition) {
    slots.slice().sort((a, b) => b.effectiveRating - a.effectiveRating)
      .forEach((slot, i) => (i < (STARTING[position] ?? 0) ? starters : bench).push(slot));
  }
  return { starters, bench };
}
// What carries a side's attack, and its defence: the halves steer the attack, the forwards win the ruck and make most of
// the tackles, the outside backs finish and defend the edges.
const ATTACK = { backs: 0.35, halves: 0.3, forwards: 0.35 };
const DEFENCE = { backs: 0.25, halves: 0.15, forwards: 0.6 };

const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);

function profile(lineup) {
  const { starters, bench: interchange } = onField(lineup);
  const of = group => starters.filter(slot => group.includes(slot.position)).map(slot => slot.effectiveRating);
  const bench = interchange.map(slot => slot.effectiveRating);
  const backs = mean(of(BACKS)), halves = mean(of(HALVES));
  const pack = of(FORWARDS);
  const forwards = (pack.reduce((s, v) => s + v, 0) + BENCH_SHARE * bench.reduce((s, v) => s + v, 0))
    / Math.max(1, pack.length + BENCH_SHARE * bench.length) || 40;
  const weigh = weights => weights.backs * backs + weights.halves * halves + weights.forwards * forwards;
  return { backs, halves, forwards, attack: weigh(ATTACK), defence: weigh(DEFENCE) };
}

const tryRate = log => BASE_TRIES * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));

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
    triesA: tryRate(edgeA * RATING_SCALE) * Math.exp(-venue), triesD: tryRate(edgeD * RATING_SCALE) * Math.exp(venue),
    // How far ahead the attacker is when a golden point's last field goal decides it, in rating points.
    golden: edgeA - edgeD,
  };
}

/** A side's field-goal chance in a slice of the last ten minutes, `lead` points up. */
const fieldGoalChance = lead => FIELD_GOAL_CHANCES[lead] ?? 0;

/**
 * What one side should expect in slice `s`, `lead` points up (negative when behind), at an eighty-minute try rate
 * `tries`: { tries, penalties, fieldGoals }, the first two Poisson means, the last the chance of one field goal.
 * Exported for the live win probability, which plays the same slices.
 */
export function sliceMeans(tries, lead, s) {
  let t = tries * SLICE / MINUTES * (s < HALF_SLICES ? 2 - SECOND_HALF : SECOND_HALF), p = BASE_PENALTY_GOALS * SLICE / MINUTES, f = 0;
  if (lead >= EASING_LEAD) t *= EASED;
  if (s >= LATE_SLICE) {
    if (lead < 0 && lead >= -6) t *= CHASING;
    else if (lead > 0 && lead <= 6) t *= PROTECTING;
    if (lead >= -2 && lead <= 4) p *= PENALTY_TAKEN;
    else if (lead < -2) p *= PENALTY_RUN;
  }
  if (s >= SLICES - FIELD_GOAL_SLICES) f = fieldGoalChance(lead);
  return { tries: t, penalties: p, fieldGoals: f };
}

/** A side's scoring rate in five minutes of golden point between equals, scaled by its try rate. */
export const goldenRate = tries => GOLDEN_RATE * Math.sqrt(tries / BASE_TRIES);

/** The attacker's chance when a golden point's last field goal decides it. */
export const deciderOdds = edge => logistic(DECIDER_SLOPE * edge);

/**
 * Score-only path: match-day form, then the slices one by one, then golden point. Also returns the scores in order
 * (`scores`: { side, kind, pts, slice } with kind 'try', 'penalty' or 'field', slice SLICES + k for golden point's
 * k-th half) and the golden-point score's share of its half (`goldenAt`), so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = Math.exp(gauss(rng) * formSpread(variation));
  const triesA = prepared.triesA * form, triesD = prepared.triesD / form;
  const scores = [];
  let regA = 0, regD = 0;
  const score = (side, kind, pts, slice) => {
    scores.push({ side, kind, pts, slice });
    if (side === 'A') regA += pts; else regD += pts;
  };
  for (let s = 0; s < SLICES; s++) {
    const lead = regA - regD;
    const a = sliceMeans(triesA, lead, s), d = sliceMeans(triesD, -lead, s);
    for (const [side, means] of [['A', a], ['D', d]]) {
      const tries = poisson(rng, means.tries);
      for (let k = 0; k < tries; k++) score(side, 'try', rng() < CONVERSION_RATE ? POINTS.TRY + POINTS.CONVERSION : POINTS.TRY, s);
      const penalties = poisson(rng, means.penalties);
      for (let k = 0; k < penalties; k++) score(side, 'penalty', POINTS.PENALTY_GOAL, s);
    }
    // Field goals: at most one a side a slice, by a side whose situation calls for one.
    if (a.fieldGoals > 0 && rng() < a.fieldGoals) score('A', 'field', POINTS.FIELD_GOAL, s);
    if (d.fieldGoals > 0 && rng() < d.fieldGoals) score('D', 'field', POINTS.FIELD_GOAL, s);
  }
  let ga = regA, gd = regD, tie = null, goldenAt = 0;
  if (ga === gd) {
    const rateA = goldenRate(triesA), rateD = goldenRate(triesD), total = rateA + rateD;
    const periods = [];
    let decided = null;
    for (let k = 0; k < MAX_GOLDEN && !decided; k++) {
      const none = Math.exp(-total);
      const roll = clamp(rng(), 0, 1 - Number.EPSILON);
      if (roll >= none) {
        goldenAt = -Math.log(1 - (roll - none)) / total;
        const side = rng() < rateA / total ? 'A' : 'D';
        const pick = rng();
        const kind = pick < GOLDEN_SHARES.fieldGoal ? 'field' : pick < GOLDEN_SHARES.fieldGoal + GOLDEN_SHARES.penaltyGoal ? 'penalty' : 'try';
        decided = { side, kind, pts: kind === 'field' ? POINTS.FIELD_GOAL : kind === 'penalty' ? POINTS.PENALTY_GOAL : POINTS.TRY, slice: SLICES + k };
      } else if (k === MAX_GOLDEN - 1) {
        goldenAt = 1;
        decided = { side: rng() < deciderOdds(prepared.golden) ? 'A' : 'D', kind: 'field', pts: POINTS.FIELD_GOAL, slice: SLICES + k };
      }
      periods.push(decided ? (decided.side === 'A' ? [decided.pts, 0] : [0, decided.pts]) : [0, 0]);
    }
    scores.push(decided);
    if (decided.side === 'A') ga += decided.pts; else gd += decided.pts;
    tie = { periods, ga, gd };
  }
  return { ga, gd, regA, regD, tie, scores, goldenAt, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/**
 * Who scores a try, each a player's share in percent: of the NRL's tries in 2023–2025 by the scorer's place in the team
 * list (NRL.com's match centre), the wingers scored 30%, the centres 16 to 18%, the fullback 9 to 11%, the second-rowers
 * 10 to 11%, the five-eighth 6%, the halfback 5%, the props 4%, the hooker 3%, the lock 2% and the bench 11 to 13%.
 * Within a position, the better players score more (the rating above the floor).
 */
const TRY_WEIGHTS = { WG: 15.3, CE: 8.3, FB: 10, SR: 5, FE: 6.7, HB: 4.8, PR: 1.85, HK: 3.1, LK: 2 };
const BENCH_TRY_WEIGHT = 3.7;
const TRY_FLOOR = 60;

/** Who scores a try, by position and rating above the floor, the bench at its own share. */
function tryScorerSampler(lineup) {
  const { starters, bench } = onField(lineup);
  const entries = [...starters.map(slot => [slot, TRY_WEIGHTS[slot.position] || 1]), ...bench.map(slot => [slot, BENCH_TRY_WEIGHT])]
    .filter(([slot]) => slot.player);
  if (!entries.length) return () => 'Unfilled shirt';
  let total = 0;
  const cumulative = entries.map(([slot, weight]) => (total += weight * Math.max(1, slot.effectiveRating - TRY_FLOOR)));
  return rng => {
    const r = rng() * total;
    const i = cumulative.findIndex(edge => r <= edge);
    return entries[i < 0 ? entries.length - 1 : i][0].player.name;
  };
}

/** The side's goal-kicker: the starter who kicked most goals in 2025, else the halfback, five-eighth or fullback. */
function kickerOf(lineup) {
  const starters = onField(lineup).starters.map(slot => slot.player).filter(Boolean);
  const kicker = starters.reduce((best, p) => ((p.sourceInfo?.goals || 0) > (best?.sourceInfo?.goals || 0) ? p : best), null);
  if (kicker?.sourceInfo?.goals) return kicker.name;
  for (const position of ['HB', 'FE', 'FB']) {
    const player = lineup.slots.find(slot => slot.position === position)?.player;
    if (player) return player.name;
  }
  return starters[0]?.name || 'Goal-kicker';
}

/** Who kicks a field goal: the halfback, else the five-eighth, else the goal-kicker. */
function fieldGoalKickerOf(lineup, kicker) {
  for (const position of ['HB', 'FE']) {
    const player = lineup.slots.find(slot => slot.position === position)?.player;
    if (player) return player.name;
  }
  return kicker;
}

const KIND_NAMES = { try: ['TRY', 'TRY'], penalty: ['PENALTY GOAL', 'PEN'], field: ['FIELD GOAL', 'FG'] };
/** A score's kind from its event: a field goal is the one-pointer, a penalty goal the two, a try four or six. */
export const scoreKind = e => (e.kind && KIND_NAMES[e.kind] ? e.kind : e.pts === 1 ? 'field' : e.pts === 2 ? 'penalty' : 'try');

/** The clock's place for each score of slice `slice`: a minute within it, golden point's within its half. */
function scoreMinute(rng, slice, goldenAt) {
  if (slice >= SLICES) return MINUTES + (slice - SLICES) * GOLDEN + clamp(Math.ceil(goldenAt * GOLDEN), 1, GOLDEN);
  return slice * SLICE + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE);
}

export const rugbyLeague = defineSportData({
  id: 'rugby-league',
  simulationVersion: 1,
  name: 'Rugby league',
  blurb: 'Thirteen a side and four on the bench, eighty minutes. Tries, goals and field goals — level games go to golden point.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  // England, Scotland and Wales play as themselves, as in football; Ireland is the whole island, so Northern Ireland's
  // shape starts in Ireland's (372) empire.
  territory: { merged: { NIR: '372' }, inactive: [] },

  squadSize: 17,
  formation: { FB: 1, WG: 2, CE: 2, FE: 1, HB: 1, PR: 2, HK: 1, SR: 2, LK: 1 },
  positionPlan: ['FB', 'WG', 'WG', 'CE', 'CE', 'FE', 'HB', 'PR', 'HK', 'PR', 'SR', 'SR', 'LK', 'HK', 'PR', 'PR', 'LK'],
  positionColors: { FB: C.gold, WG: C.red, CE: '#E0904A', FE: C.green, HB: C.green, HK: '#7FA7E8', PR: C.cyan, SR: '#B07CD8',
    LK: '#8FCFA0' },

  // A nation whose NRL players hold less than half the matchday 17 fields no team (fieldedNations). Built anyway, one
  // with none would be all generated at this strength.
  fallbackStrength: () => BASELINE,
  requiredPositions: ['HB'],

  // `sudden`: golden point ends with the score that decides it.
  clock: { length: MINUTES, msPerUnit: 52, ot: GOLDEN, sudden: true, tick: 20 },
  tieBreak: 'overtime',
  labels: {
    score: 'POINTS',
    start: 'KICK-OFF…',
    live: 'LIVE',
    end: 'FULL TIME',
    tie: 'GOLDEN POINT',
    tieShort: 'GP',
  },

  words: { kickoff: 'Kick-off', end: 'Full time', lineup: 'Matchday 17', lineupShort: '17', lineupNoun: 'matchday 17',
    lineupTitle: 'Matchday 17', overtime: 'Golden point' },

  formatClock: m => `${m}'`,
  formatTick: t => (t > MINUTES ? 'GP' : `${t}'`),
  // A game level after eighty is decided in golden point, however many of its halves it takes.
  overtime: {
    text: () => 'in golden point',
    short: () => 'GP',
    periodsOf: text => (/golden point/i.test(text) ? 1 : null),
  },
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `${KIND_NAMES[scoreKind(e)][0]} — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' ${KIND_NAMES[scoreKind(e)][0]} — ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, regA, regD, tie, scores, goldenAt, winner } = sampleResult(rng, prepared, drama);
    const scorerA = tryScorerSampler(prepared.lineupA), scorerD = tryScorerSampler(prepared.lineupD);
    const kickerA = kickerOf(prepared.lineupA), kickerD = kickerOf(prepared.lineupD);
    const droppersA = fieldGoalKickerOf(prepared.lineupA, kickerA), droppersD = fieldGoalKickerOf(prepared.lineupD, kickerD);
    const ev = scores.map(({ side, kind, pts, slice }) => {
      const own = side === 'A';
      const name = kind === 'try' ? (own ? scorerA : scorerD)(rng) : kind === 'penalty' ? (own ? kickerA : kickerD) : own ? droppersA : droppersD;
      return { m: scoreMinute(rng, slice, goldenAt), tid: own ? attacker.id : defender.id, name, pts, kind };
    });
    ev.sort((x, y) => x.m - y.m);
    return { ga, gd, regA, regD, ev, tie, winner };
  },
});

/**
 * Squad-screen strength profile: the backs, halves and forwards the match model weighs → { backs, halves, forwards } on
 * the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function rugbyLeagueProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => HALVES.includes(slot.position))) return { backs: 0, halves: 0, forwards: 0 };
  const { backs, halves, forwards } = profile(selected);
  return { backs, halves, forwards };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const SLICE_MODEL = Object.freeze({ MINUTES, HALF, SLICE, SLICES, GOLDEN, MAX_GOLDEN, FORM_AT_BALANCED, CONVERSION_RATE });
