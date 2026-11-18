import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { selectLineup } from '../data/teams.js';
import { clamp, gauss, poisson } from '../engine/random.js';

// Rugby union ("Rugby" in the game; docs/design/rugby-union.md). Two forty-minute halves, told in five-minute slices as
// rugby league's are (src/sports/rugbyLeague.js), so the score can decide how each is played. A try is five points and
// its conversion two more, a penalty goal three and a drop goal three. Level after eighty, extra time in sudden death:
// two ten-minute halves, told in five-minute quarters, and the first score wins; after twenty minutes with no score, a
// last drop goal decides it, close to a coin flip. A campaign needs a winner, so every game is played as a knockout tie.
const MINUTES = 80;
const HALF = 40;
const SLICE = 5;
const SLICES = MINUTES / SLICE;
const GOLDEN = 5;
const MAX_GOLDEN = 4;

/** Points of each kind of score. `FIELD_GOAL` is the drop goal: the slice engine shares rugby league's names. */
export const POINTS = Object.freeze({ TRY: 5, CONVERSION: 2, PENALTY_GOAL: 3, FIELD_GOAL: 3 });

// Every rate below is fitted to the 2025/26 Premiership, Top 14 and URC, the built-in season (RugbyPass's games, pooled;
// scripts/simulation-realism.mjs REAL.union and docs/design/rugby-union.md "The match model").
// Tries a side scores in eighty minutes when its attack meets an equal defence (3.74 a team in the leagues), and how far
// each point of attack over the opposing defence moves that rate (log scale). The scale only sets what a rating point is
// worth: the clubs' results set how far apart they play (the club move measures the engine's margin a point).
const BASE_TRIES = 3.53;
const RATING_SCALE = 0.1;
// Smooth saturation, as in football and rugby league: a huge gap stays plausible, and the underdog can always score. Union's
// is tighter than league's: fewer teams are held scoreless or run up forty than an uncapped gap would give.
const MAX_LOG_EDGE = 0.9;
// Conversions made (75.6%, a penalty try counted as converted, as RugbyPass counts it among the tries at seven points).
const CONVERSION_RATE = 0.756;
// Penalty goals a side kicks in eighty minutes between equals (1.02 a team in 2025/26, from 1.49 two seasons before).
const BASE_PENALTY_GOALS = 1.03;
// Drop goals a side kicks in open play in eighty minutes, away from the late game's (0.035 a game in all).
const OPEN_DROP_GOALS = 0.01;
// Match-day form in log scoring rate at Balanced; grows with the square of the drama, as football's does. Small: the
// game-to-game noise of a margin between equal sides is then 16 points, the leagues' 16.8 about their results' fit.
const FORM_AT_BALANCED = 0.05;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Home advantage, a campaign option (off: a neutral venue): apart in log try rate. Home sides win 68–70% of the leagues'
// games, more than in any other sport the game plays.
const HOME_EDGE = 0.48;

// Tired defences: a little more than half the points come after half-time.
const HALF_SLICES = 8;
const SECOND_HALF = 1.03;
// Score effects, through the second half: a side two converted tries or less behind chases (the losing bonus point within
// seven, a draw or a win within fourteen) and the leader protects its lead; a side fifteen or more ahead eases off at any
// time. Together they leave the leagues' margins: 17 points a game, half of them by fifteen or more. A side level, ahead
// or a penalty goal behind takes the three points of a penalty late; one further behind kicks for the corner.
const LATE_SLICE = 8;
const CHASE_REACH = 14;
const CHASING = 1.35;
const PROTECTING = 0.8;
const PENALTY_TAKEN = 1.3;
const PENALTY_RUN = 0.5;
const EASING_LEAD = 15;
const EASED = 0.75;
// Drop goals in the last ten minutes, a side's chance a slice by what one would do: level, to edge ahead; a drop goal or
// less behind, to level or lead.
const FIELD_GOAL_SLICES = 2;
const FIELD_GOAL_CHANCES = Object.freeze({ level: 0.07, behind: 0.04 });
// Sudden death: the scores a side makes in five minutes of extra time between equals, and how they split (estimates: so
// few real games go so far that no season measures them).
const GOLDEN_RATE = 0.45;
const GOLDEN_SHARES = Object.freeze({ fieldGoal: 0.35, penaltyGoal: 0.45, try: 0.2 });
// The last drop goal after twenty minutes of sudden death: close to a coin flip.
const DECIDER_SLOPE = 0.03;

/** The built-in season's rules: today's points, sudden death, the scoring the model is tuned to. */
export const RULES_TODAY = Object.freeze({ season: null, tryPoints: POINTS.TRY, fieldGoalPoints: POINTS.FIELD_GOAL, golden: true,
  tries: 1, penalties: BASE_PENALTY_GOALS, fieldGoals: 1, openFieldGoals: OPEN_DROP_GOALS });

/** The strength of a nation with no players in the data, and of a lineup place a nation's own players cannot fill. */
export const BASELINE = 45;

// The matchday 23: the fifteen and eight replacements, who play about a third of a game each. Of each position's places
// in the lineup the best-rated players start (two props, a hooker, two locks, two flankers and a number eight, the
// halves, two centres, two wings and the fullback); the rest of them are the bench.
const FORWARDS = ['PR', 'HK', 'LK', 'FL', 'N8'];
const HALVES = ['SH', 'FH'];
const BACKS = ['CE', 'WG', 'FB'];
const STARTING = Object.freeze({ PR: 2, HK: 1, LK: 2, FL: 2, N8: 1, SH: 1, FH: 1, CE: 2, WG: 2, FB: 1 });
const BENCH_SHARE = 0.35;

/** A lineup's slots → { starters, bench }: the fifteen on the field and the replacements. */
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
// What carries a side's attack, and its defence: the pack wins the set piece and the breakdown, which both turn on, the
// halves steer the attack and the backs finish it and defend the edges.
const ATTACK = { backs: 0.3, halves: 0.25, forwards: 0.45 };
const DEFENCE = { backs: 0.25, halves: 0.1, forwards: 0.65 };

const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);

function profile(lineup) {
  const { starters, bench } = onField(lineup);
  // A unit's starters, with its replacements at their share of the game.
  const unit = group => {
    const on = starters.filter(slot => group.includes(slot.position)).map(slot => slot.effectiveRating);
    const off = bench.filter(slot => group.includes(slot.position)).map(slot => slot.effectiveRating);
    const weight = on.length + BENCH_SHARE * off.length;
    return weight ? (on.reduce((s, v) => s + v, 0) + BENCH_SHARE * off.reduce((s, v) => s + v, 0)) / weight : 40;
  };
  const backs = unit(BACKS), halves = unit(HALVES), forwards = unit(FORWARDS);
  const weigh = weights => weights.backs * backs + weights.halves * halves + weights.forwards * forwards;
  return { backs, halves, forwards, attack: weigh(ATTACK), defence: weigh(DEFENCE) };
}

const tryRate = log => BASE_TRIES * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));

/**
 * A lineup's strength as the match model plays it, on the player-rating scale: the mean of its attack and its defence.
 * Read-only, for the club shift toward results (scripts/lib/rugby-union.mjs).
 */
export function rugbyUnionStrength(lineup) {
  const { attack, defence } = profile(lineup);
  return (attack + defence) / 2;
}

/**
 * The points of margin a point of strength (`rugbyUnionStrength`) is worth between two sides, to first order: the point
 * moves the two sides' try rates apart by RATING_SCALE each in log, and each try brings its five points and a conversion
 * at the leagues' rate.
 */
export const marginPerStrength = (tries = BASE_TRIES) => 2 * RATING_SCALE * tries * (POINTS.TRY + POINTS.CONVERSION * CONVERSION_RATE);

/**
 * One game's margin after eighty minutes between two sides `gap` points of strength apart (`rugbyUnionStrength`, each
 * side's attack and defence alike), the first the stronger, at a neutral venue and Balanced drama: what the club shift
 * toward results measures the engine by (scripts/lib/computed-ratings.mjs `perPointOf`).
 */
export function marginOfGap(gap, rng) {
  const prepared = { attackerId: 'A', defenderId: 'D', rules: RULES_TODAY, golden: 2 * gap,
    triesA: tryRate(gap * RATING_SCALE), triesD: tryRate(-gap * RATING_SCALE) };
  const { regA, regD } = sampleResult(rng, prepared, 6);
  return regA - regD;
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at home
 * (the campaign's home advantage); a neutral venue otherwise.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = RULES_TODAY) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  const edgeA = a.attack + adjustmentA - (d.defence + adjustmentD), edgeD = d.attack + adjustmentD - (a.defence + adjustmentA);
  const venue = home ? HOME_EDGE / 2 : 0;
  return {
    attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, rules, code: 'union',
    triesA: tryRate(edgeA * RATING_SCALE) * rules.tries * Math.exp(-venue), triesD: tryRate(edgeD * RATING_SCALE) * rules.tries * Math.exp(venue),
    // How far ahead the attacker is when the place-kicking competition decides it, in rating points.
    golden: edgeA - edgeD,
  };
}

/** A side's drop-goal chance in a slice of the last ten minutes, `lead` points up: level, or a drop goal or less behind. */
function fieldGoalChance(lead, rules) {
  const chance = lead === 0 ? FIELD_GOAL_CHANCES.level : lead < 0 && lead >= -rules.fieldGoalPoints ? FIELD_GOAL_CHANCES.behind : 0;
  return chance * rules.fieldGoals;
}

/**
 * What one side should expect in slice `s`, `lead` points up (negative when behind), at an eighty-minute try rate
 * `tries`: { tries, penalties, fieldGoals, open }, the tries, penalty goals and open-play drop goals Poisson means,
 * `fieldGoals` the chance of one late drop goal. A score effect's reach is the converted try. Exported for the live win
 * probability, which plays the same slices.
 */
export function sliceMeans(tries, lead, s, rules = RULES_TODAY) {
  const converted = rules.tryPoints + POINTS.CONVERSION;
  const half = s < HALF_SLICES ? 2 - SECOND_HALF : SECOND_HALF;
  let t = tries * SLICE / MINUTES * half, p = rules.penalties * SLICE / MINUTES * half, f = 0;
  if (lead >= EASING_LEAD) t *= EASED;
  if (s >= LATE_SLICE) {
    if (lead < 0 && lead >= -CHASE_REACH) t *= CHASING;
    else if (lead > 0 && lead <= CHASE_REACH) t *= PROTECTING;
    if (lead >= -POINTS.PENALTY_GOAL) p *= PENALTY_TAKEN;
    else p *= PENALTY_RUN;
  }
  if (s >= SLICES - FIELD_GOAL_SLICES) f = fieldGoalChance(lead, rules);
  return { tries: t, penalties: p, fieldGoals: f, open: rules.openFieldGoals * SLICE / MINUTES };
}

/** A side's scoring rate in five minutes of sudden death between equals, scaled by its try rate. */
export const goldenRate = tries => GOLDEN_RATE * Math.sqrt(tries / BASE_TRIES);

/** The attacker's chance when a last drop goal decides it. */
export const deciderOdds = edge => logistic(DECIDER_SLOPE * edge);

/**
 * Score-only path: match-day form, then the slices one by one, then sudden death. Also returns the scores in order
 * (`scores`: { side, kind, pts, slice } with kind 'try', 'penalty' or 'field' (a drop goal), slice SLICES + k for sudden
 * death's k-th quarter) and the sudden-death score's share of its quarter (`goldenAt`), so the full simulation can time
 * its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const rules = prepared.rules ?? RULES_TODAY;
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = Math.exp(gauss(rng) * formSpread(variation));
  const triesA = prepared.triesA * form, triesD = prepared.triesD / form;
  const scores = [];
  let a = 0, d = 0;
  const score = (side, kind, pts, slice) => {
    scores.push({ side, kind, pts, slice });
    if (side === 'A') a += pts; else d += pts;
  };
  for (let s = 0; s < SLICES; s++) {
    const lead = a - d;
    const meansA = sliceMeans(triesA, lead, s, rules), meansD = sliceMeans(triesD, -lead, s, rules);
    for (const [side, means] of [['A', meansA], ['D', meansD]]) {
      const tries = poisson(rng, means.tries);
      for (let k = 0; k < tries; k++) score(side, 'try', rng() < CONVERSION_RATE ? rules.tryPoints + POINTS.CONVERSION : rules.tryPoints, s);
      const penalties = poisson(rng, means.penalties);
      for (let k = 0; k < penalties; k++) score(side, 'penalty', POINTS.PENALTY_GOAL, s);
      const open = poisson(rng, means.open);
      for (let k = 0; k < open; k++) score(side, 'field', rules.fieldGoalPoints, s);
    }
    // Late drop goals: at most one a side a slice, by a side whose situation calls for one.
    if (meansA.fieldGoals > 0 && rng() < meansA.fieldGoals) score('A', 'field', rules.fieldGoalPoints, s);
    if (meansD.fieldGoals > 0 && rng() < meansD.fieldGoals) score('D', 'field', rules.fieldGoalPoints, s);
  }
  const regA = a, regD = d;
  let tie = null, goldenAt = 0;
  if (a === d) {
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
        decided = { side, kind, pts: kind === 'field' ? rules.fieldGoalPoints : kind === 'penalty' ? POINTS.PENALTY_GOAL : rules.tryPoints, slice: SLICES + k };
      } else if (k === MAX_GOLDEN - 1) {
        // Twenty minutes and nobody has scored: a last drop goal decides it, close to a coin flip.
        goldenAt = 1;
        decided = { side: rng() < deciderOdds(prepared.golden) ? 'A' : 'D', kind: 'field', pts: rules.fieldGoalPoints, slice: SLICES + k };
      }
      periods.push(decided ? (decided.side === 'A' ? [decided.pts, 0] : [0, decided.pts]) : [0, 0]);
    }
    scores.push(decided);
    if (decided.side === 'A') a += decided.pts; else d += decided.pts;
    tie = { periods, ga: a, gd: d };
  }
  return { ga: a, gd: d, regA, regD, tie, scores, goldenAt, winner: a > d ? prepared.attackerId : prepared.defenderId };
}

/**
 * Who scores a try, each place's share in percent of the real tries by the scorer's number in the team sheet (RugbyPass's
 * match centre, 2023/24–2025/26; docs/design/rugby-union.md "Who scores"). Within a position, the better players score
 * more (the rating above the floor).
 */
const TRY_WEIGHTS = { WG: 12.6, FB: 7.4, CE: 5.9, FL: 4.65, N8: 6, HK: 7.2, PR: 1.75, LK: 2.25, SH: 6.7, FH: 3.2 };
const BENCH_TRY_WEIGHT = 2.6;
const TRY_FLOOR = 55;

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

/** The side's goal-kicker: the starter who kicked the most goals in his season, else the fly-half, fullback or scrum-half. */
function kickerOf(lineup) {
  const starters = onField(lineup).starters.map(slot => slot.player).filter(Boolean);
  const kicker = starters.reduce((best, p) => ((p.sourceInfo?.goals || 0) > (best?.sourceInfo?.goals || 0) ? p : best), null);
  if (kicker?.sourceInfo?.goals) return kicker.name;
  for (const position of ['FH', 'FB', 'SH']) {
    const player = lineup.slots.find(slot => slot.position === position)?.player;
    if (player) return player.name;
  }
  return starters[0]?.name || 'Goal-kicker';
}

/** Who drops a goal: the fly-half, else the goal-kicker. */
function dropKickerOf(lineup, kicker) {
  const player = lineup.slots.find(slot => slot.position === 'FH')?.player;
  return player ? player.name : kicker;
}

const KIND_NAMES = { try: ['TRY', 'TRY'], penalty: ['PENALTY GOAL', 'PEN'], field: ['DROP GOAL', 'DG'] };
/** A score's kind from its event: every union event carries its own (a penalty goal and a drop goal are both three). */
export const scoreKind = e => (e.kind && KIND_NAMES[e.kind] ? e.kind : e.pts === 3 ? 'penalty' : 'try');

/** The clock's place for each score of slice `slice`: a minute within it, sudden death's within its quarter. */
function scoreMinute(rng, slice, goldenAt) {
  if (slice >= SLICES) return MINUTES + (slice - SLICES) * GOLDEN + clamp(Math.ceil(goldenAt * GOLDEN), 1, GOLDEN);
  return slice * SLICE + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE);
}

/** A complete match from a prepared matchup: the score-only outcome, then each score's minute and scorer. */
function playMatch(rng, prepared, attacker, defender, drama) {
  const { ga, gd, regA, regD, tie, scores, goldenAt, winner } = sampleResult(rng, prepared, drama);
  const scorerA = tryScorerSampler(prepared.lineupA), scorerD = tryScorerSampler(prepared.lineupD);
  const kickerA = kickerOf(prepared.lineupA), kickerD = kickerOf(prepared.lineupD);
  const dropA = dropKickerOf(prepared.lineupA, kickerA), dropD = dropKickerOf(prepared.lineupD, kickerD);
  const ev = scores.map(({ side, kind, pts, slice }) => {
    const own = side === 'A';
    const name = kind === 'try' ? (own ? scorerA : scorerD)(rng) : kind === 'field' ? (own ? dropA : dropD) : own ? kickerA : kickerD;
    const m = scoreMinute(rng, slice, goldenAt);
    return { m, tid: own ? attacker.id : defender.id, name, pts, kind };
  });
  ev.sort((x, y) => x.m - y.m);
  return { ga, gd, regA, regD, ev, tie, winner };
}

const LABELS = Object.freeze({
  score: 'POINTS',
  start: 'KICK-OFF…',
  live: 'LIVE',
  end: 'FULL TIME',
  tie: 'EXTRA TIME',
  tieShort: 'AET',
});
const WORDS = Object.freeze({ kickoff: 'Kick-off', end: 'Full time', lineup: 'Matchday 23', lineupShort: '23', lineupNoun: 'matchday 23',
  lineupTitle: 'Matchday 23', overtime: 'Extra time' });

/** Rugby union without its players, read at import. */
const rugbyUnionRules = {
  id: 'rugby-union',
  simulationVersion: 1,
  name: 'Rugby',
  blurb: 'Fifteen a side and eight replacements, eighty minutes. Tries, conversions, penalties and drop goals — level games go to sudden-death extra time.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  // England, Scotland and Wales play as themselves, as in the Six Nations; Ireland is the whole island, so Northern
  // Ireland's shape starts in Ireland's (372) empire.
  territory: { merged: { NIR: '372' }, inactive: [] },
  rules: RULES_TODAY,

  squadSize: 23,
  formation: { PR: 2, HK: 1, LK: 2, FL: 2, N8: 1, SH: 1, FH: 1, CE: 2, WG: 2, FB: 1 },
  positionPlan: ['PR', 'HK', 'PR', 'LK', 'LK', 'FL', 'FL', 'N8', 'SH', 'FH', 'WG', 'CE', 'CE', 'WG', 'FB', 'HK', 'PR', 'PR', 'LK', 'FL',
    'SH', 'FH', 'CE'],
  positionColors: { PR: C.cyan, HK: '#7FA7E8', LK: '#B07CD8', FL: '#8FCFA0', N8: '#5FB37A', SH: C.green, FH: '#C8D86A', CE: '#E0904A',
    WG: C.red, FB: C.gold },

  // A nation whose players hold less than half the matchday 23 fields no team (fieldedNations). Built anyway, one with
  // none would be all generated at this strength.
  fallbackStrength: () => BASELINE,
  requiredPositions: ['SH'],

  // `sudden`: extra time ends with the score that decides it.
  clock: { length: MINUTES, msPerUnit: 52, ot: GOLDEN, sudden: true, tick: 20 },
  tieBreak: 'overtime',
  labels: { ...LABELS },

  words: { ...WORDS },
  // What each kind of score is worth, for the scorers' line: a try with its conversion is the try's.
  scoreValues: Object.freeze({ try: POINTS.TRY, penalty: POINTS.PENALTY_GOAL, field: POINTS.FIELD_GOAL }),

  formatClock: m => `${m}'`,
  formatTick: t => (t > MINUTES ? 'ET' : `${t}'`),
  // A game level after eighty is decided in extra time, however many of its quarters it takes.
  overtime: {
    text: () => 'in extra time',
    short: () => 'AET',
    periodsOf: text => (/extra time/i.test(text) ? 1 : null),
  },
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `${KIND_NAMES[scoreKind(e)][0]} — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' ${KIND_NAMES[scoreKind(e)][0]} — ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

export const rugbyUnion = defineSportData({ ...rugbyUnionRules });

/**
 * Squad-screen strength profile: the backs, halves and forwards the match model weighs → { backs, halves, forwards } on
 * the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function rugbyUnionProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => HALVES.includes(slot.position))) return { backs: 0, halves: 0, forwards: 0 };
  const { backs, halves, forwards } = profile(selected);
  return { backs, halves, forwards };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const SLICE_MODEL = Object.freeze({ MINUTES, HALF, SLICE, SLICES, GOLDEN, MAX_GOLDEN, FORM_AT_BALANCED, CONVERSION_RATE });
