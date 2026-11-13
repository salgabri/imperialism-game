// Owner: WP-MATCH (see PLAN.md §4). Live win-probability model (PLAN §3.7, DEC D6).
//
// Pure functions. Nothing here reads or advances any random generator (campaign or display), touches the DOM,
// or mutates its inputs; every value is recomputed from plain numbers, so it is safe to call from render.
//
// Football — README §B "Win probability per minute", exactly:
//   rate(l) = 1.28·exp(1.5·tanh(l/1.5)); rA = rate(logA), rD = rate(logD) where logA/logD come from the repo's
//   prepareFootballMatch(attacker, defender, effA, effD, venue) called with the MATCH's own effA/effD (tactics
//   included) and venue (a home defender's edge is in logA/logD, as every sport's is in its prepared match).
//   With r = (90 − t)/90 the goals still to come are Poisson(rA·r) and Poisson(rD·r);
//   P(A wins) = P(final goal difference > 0) + P(level)·E, where E is A's chance from level after ninety: extra time's
//   thirty minutes at the rates rA·x and rD·x (x = FOOTBALL_MODEL.EXTRA_RATE, the model's own), the same sum over what
//   is left of it, then the tie-break at ½ (penalties or the drawing of lots). Under the golden goal the first goal of
//   extra time wins (a lead in it has won; level, (1 − e^(−(a+d)))·a/(a+d) + e^(−(a+d))·½ over what is left), under the
//   silver goal a lead at its half-time does. A model saved before extra time came in (no `ot`) takes ½ at 90'.
//   The double sum runs over i, j ∈ 0..15, where 15 stands for "15 or more" so the masses sum to 1 and
//   P(A) + P(D) = 1 exactly. Against an untruncated sum the difference is at most ≈ 2e-6 for goal differences
//   up to 3 and ≈ 2e-5 for 6, at the model's largest rate (1.28·e^1.5 ≈ 5.74 goals per 90).
//   Calibration note (measured on repo rosters, see scripts/win-probability.test.mjs): the formula omits match-day
//   form, tempo and real shoot-out skill, so the 0' value differs from the fixture odds (estimateWinProbability):
//   mean |gap| ≈ 1 point and at most ≈ 2.5 points under the default 'balanced' and 'predictable' uncertainty, and
//   ≈ 6 points (at most ≈ 12) under 'wild'. DEC D6 ships the formula as specified.
//
// Basketball — engine-diff §4a.2 normal approximation of the repo's own model (src/sports/basketball.js):
//   each period score is Normal(poss·eff, poss·(0.36 + 0.25·eff)) rounded; possessions ~ pace ± 4.5 (73 over FIBA's
//   40', the season's 90–100 over the NBA's 48'); match-day form N(0, drama·0.0095) per side persists through
//   overtime; shared conditions cancel in the margin; a side one or two behind at the end of regulation draws level
//   at the buzzer with BUZZER_LEVEL; level after regulation goes to 5' overtimes (at most 4, the last ends in a
//   decisive play won with logistic(3·(effA − effD))).
//   The remaining margin is therefore ≈ Normal(R·(effA − effD), R·(0.72 + 0.25·(effA + effD)) + 2·(formSd·R)²
//   + (effA − effD)²·σ_R² + 1/6) for R remaining possessions; P(A wins) = P(margin ≥ 1) + P(margin = 0)·P(A wins
//   from level), with a ±0.5 continuity correction, and in regulation the buzzer moves each one- and two-point
//   finish's share to level. Measured robust: tip-off within ≈ 1 point of the Monte Carlo odds at every uncertainty
//   preset, and calibrated mid-game against full simulations (test file).
//
// American football — a normal approximation of src/sports/americanFootball.js: each side has about 11 possessions
//   (± 1.1), each worth 6, 7 or 8 (a touchdown and its try), 3 (a field goal), −2 (a safety) or 0 with the drive odds
//   of its edge (its offence minus the opposing defence). Over R remaining possessions a side the margin is
//   ≈ Normal(R·(μA − μD), R·(σA² + σD²) + (R·slope·formSd)² + (μA − μD)²·σ_R² + 1/6), where slope is how much both
//   sides' means move per rating point of match-day form; P(A wins) = P(margin ≥ 1) + P(margin = 0)·P(A wins from
//   level). The overtime chain (both sides possess once, the second playing to the first's score, then the next score
//   wins; the last period ends in a decisive field goal) is exact for the model's drive odds, before form. In overtime
//   a lead is charted as the trailing side's one possession to answer it. Late-game play-calling and the two-point
//   chart (each side's last three possessions follow the score) are left out: they shape the final margin far more
//   than they move who wins. An earlier season plays its own day's drive odds, tries and overtime (its prepared match's
//   `rules`): sudden death to 2009, where a lead in overtime has won, and from 2010 to 2021 modified sudden death, where
//   only a first possession's field goal leaves an answer; both chains are exact too.
//
// Baseball — the model's own distributions (src/sports/baseball.js): the clock counts outs (three a half-inning, 54 in
//   nine innings), and each half-inning's runs follow the model's distribution for the batting side's edge
//   (runMasses). The runs still to come are the convolution of the half-innings left, the one in progress with its
//   chance to score scaled by the outs it has left (the one approximation); P(A wins) = P(final margin ≥ 1) +
//   P(level)·P(A wins the extra innings), where the extra innings (from 2020 a runner on second and at most six, before
//   it the ninth's odds and at most twelve, then a decisive run) are an exact chain. An earlier season's model carries
//   its own odds and runs (inningOdds, runMasses). Neither the unplayed bottom of the ninth nor a walk-off changes who
//   wins, so the full nine are counted. Match-day form, which moves both edges, is integrated over its normal spread
//   with seven-point Gauss–Hermite quadrature.
//
// Ice hockey — the model's own slices (src/sports/hockey.js): the remaining three-minute slices are played out backwards
//   from each margin with the sport's own score effects and pulled goalies (sliceMeans, an earlier season's late game
//   where it differs), the slice in progress scaled by
//   the time it has left; level after sixty, sudden death at the overtime's rates (overtimeMeans), then the shoot-out
//   (shootoutOdds). A season before the shoot-out plays the playoffs' twenty-minute periods instead, at one rate and the
//   last always ending in a goal, so from level the side wins with its share of the overtime's goals, at any minute. A
//   lead in overtime has already won. Match-day form, which moves both rates, is integrated over its normal spread with
//   seven-point Gauss–Hermite quadrature.
//
// Tennis — exact, from the model's own odds (src/sports/tennis.js): a Davis Cup tie is five rubbers, first to three, each
//   a best-of-three-sets match the attacker wins with Elo's odds for its gap (matchOdds), its sets independent given the
//   day's form, whose spread the rubber's seven nodes hold (daySetChances). An earlier season's tie may be three rubbers,
//   first to two (the Fed Cup's to 1994), and its rubbers best of five sets (the Davis Cup's to 2018), each set won with
//   the same day-form chances. The clock gives each rubber twenty units and the events are its sets (`pts` 0, or 1 for
//   the set that wins the rubber), so the chart knows the rubbers and the sets of the one in play: P(A wins) is that
//   rubber's chance from its sets (the day's form weighed by the sets already played), then the rubbers left, exactly.
//   Games inside a set do not move it, nor does a set's kind (a tie-break set or an advantage set is won with the same
//   chance). Match-day form, one draw on every rubber's gap, is integrated over its normal spread with seven-point
//   Gauss–Hermite quadrature.
//
// Rugby league — the model's own slices (src/sports/rugbyLeague.js), as hockey's: the remaining five-minute slices are
//   played out backwards from each margin, each side's points in a slice the exact mix of its tries (four, six when
//   converted), penalty goals and late field goals at the means the sport's own score effects give (sliceMeans), the
//   slice in progress scaled by the time it has left. Level after eighty, golden point: the first score wins, and after
//   its last half a field goal decides (goldenRate, deciderOdds). A lead in golden point has already won. Match-day
//   form, which moves both try rates, is integrated over its normal spread with seven-point Gauss–Hermite quadrature.
//
// Constants mirror the private values in src/sports/football.js (BASE_GOALS, MAX_LOG_EDGE; extra time's FOOTBALL_MODEL); basketball's,
// American football's, baseball's, ice hockey's, tennis's and rugby league's come from their own modules (BASKETBALL_MODEL;
// DRIVE_MODEL, driveOdds, lateCall; INNING_MODEL, inningOdds, runMasses; PERIOD_MODEL, sliceMeans, overtimeMeans,
// shootoutOdds; RUBBER_MODEL, matchOdds, daySetChances, bestOfThree, bestOfFive; SLICE_MODEL, sliceMeans, goldenRate, deciderOdds). The tests compare this module against those models,
// so a change there that is not mirrored here fails loudly.

import { getSport } from '../sports/index.js';
import { FOOTBALL_MODEL } from '../sports/football.js';
import { BASKETBALL_MODEL } from '../sports/basketball.js';
import { DRIVE_MODEL, driveMoments, driveOdds, lateCall } from '../sports/americanFootball.js';
import { INNING_MODEL, inningOdds, runMasses } from '../sports/baseball.js';
import { lateOf, overtimeMeans, PERIOD_MODEL, shootoutOdds, sliceMeans } from '../sports/hockey.js';
import { deciderOdds, goldenRate, POINTS, SLICE_MODEL, sliceMeans as rugbySliceMeans } from '../sports/rugbyLeague.js';
import { bestOfFive, bestOfThree, daySetChances, matchOdds, RUBBER_MODEL } from '../sports/tennis.js';

const BASE_GOALS = 1.28;
const MAX_LOG_EDGE = 1.5;
const GOAL_CAP = 15;

const {
  SHOT_BASE: SHOT_VARIANCE_BASE, SHOT_PER_EFFICIENCY: SHOT_VARIANCE_PER_EFFICIENCY, PACE_SD, OVERTIME_PACE_SD,
  FORM_PER_DRAMA, DECISIVE_SLOPE, BUZZER_LEVEL,
} = BASKETBALL_MODEL;
const ROUNDING_VARIANCE = 1 / 6; // two independently rounded period scores, 1/12 each
const DEFAULT_DRAMA = 6;
const DECISIVE_FIELD_GOAL = 0.08;
// American football's overtime rules by season ('both' today's, a model without one's): src/sports/americanFootball.js.
const OVERTIME_RULES = Object.freeze(['both', 'modified', 'sudden']);
// A tennis rubber conceded by an empty place: as good as won (or lost) on the chart's scale.
const WALKOVER_GAP = 999;
// A tennis tie's rubbers: five (first to three), or three (first to two) in an earlier season's Fed Cup.
const TIE_RUBBERS = new Set([5, 3]);

const num = value => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN);
const isNum = value => Number.isFinite(num(value));
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const clamp01 = value => clamp(value, 0, 1);
const positive = value => (isNum(value) && num(value) > 0 ? num(value) : 0);
const step = (lead, level) => (lead > 0 ? 1 : lead < 0 ? 0 : level);
/** One decimal, as a number (so `66` prints "66" and `65.24` prints "65.2"); never "-0". */
const fixed = value => Math.round(value * 10) / 10 + 0;

/** README: rate(l) = 1.28·exp(1.5·tanh(l/1.5)) — the per-90 scoring rate of the repo's football model (tempo 1, no form). */
export function footballRate(log) {
  const l = num(log);
  return BASE_GOALS * Math.exp(MAX_LOG_EDGE * Math.tanh((Number.isNaN(l) ? 0 : l) / MAX_LOG_EDGE));
}

/**
 * The live model a match keeps in `match.live` (PLAN §3.1; small plain JSON, persisted with the match):
 * → { kind:'poisson', rA, rD, length:90, ot:15, maxOt:2, extra, sudden? } (football; `ot`/`maxOt` are extra time's two
 *     halves, `extra` its scoring rate as a share of the ninety's, `sudden` 'golden' or 'silver' in the seasons that
 *     played them; a model saved before extra time came in has only kind, rA, rD and length)
 * | { kind:'normal', pace, effA, effD, formSd, length:40, ot:5, maxOt:4 } (basketball, length 48 under NBA rules;
 *     effA/effD are efficiencies)
 * | { kind:'drives', drives, muA, muD, varA, varD, slope, formSd, driveSd, length:60, ot:10, maxOt:3, otChain,
 *     tdA, fgA, xpA, twoA, tdD, fgD, xpD, twoD, overtime? } (American football; μ/σ² are a possession's points, otChain[k]
 *     A's chance from level with k overtimes left, td/fg a possession's chance of a touchdown / field goal, xp/two a
 *     touchdown's chance of its extra point / two points (0 in a season without the try); a model saved before tries
 *     has no xp/two; an earlier season's overtime periods are 15 minutes before 2017 and its `overtime` 'sudden' to
 *     2009 or 'modified' 2010–2021, today's both-possess rule having none)
 * | { kind:'innings', edgeA, edgeD, formSd, length:54, ot:6, maxOt:6 } (baseball; the clock counts outs, edges are each
 *     side's batting minus the opposing defence, formSd the spread of match-day form in rating points; an earlier
 *     season's adds its half-inning odds between equals in logit, `score` and `extra`, and `more`, the ratio of a scoring
 *     half-inning's further runs, and plays twelve extra innings before 2020)
 * | { kind:'periods', rateA, rateD, shootout, formSd, length:60, ot:5, maxOt:2, otBoost?, playoff?, late? } (ice hockey;
 *     rates are goals in sixty minutes, formSd the spread of match-day form in log rate, and the two "overtime periods"
 *     the five minutes of sudden death and the shoot-out. An earlier season's: `otBoost` its overtime's scoring rate over
 *     the sixty minutes' (today's three on three's when absent); with `playoff` the playoffs' periods, `ot` minutes each and
 *     `maxOt` of them at most, no shoot-out, the last always ending in a goal; `late` its late game's score effects
 *     [level, leading, trailing, pulled, emptyNet], today's when absent)
 * | { kind:'rubbers', gaps, formSd, length:60, ot:20, maxOt:2, bestOf? } (tennis; gaps are the attacker's rating points
 *     ahead in each of the five rubbers, ±999 for a walkover, formSd the spread of match-day form in rating points; the
 *     clock gives each rubber twenty units, the fourth and fifth extending the shortest tie as overtime periods do. An
 *     earlier season's three-rubber tie has three gaps, length 40 and maxOt 1; `bestOf` 5 marks best-of-five rubbers,
 *     best of three without it)
 * | { kind:'tries', triesA, triesD, golden, formSd, length:80, ot:5, maxOt:4 } (rugby league; tries a side in eighty
 *     minutes, `golden` the attacker's edge when a golden point's last field goal decides, formSd the spread of
 *     match-day form in log rate, and the "overtime periods" golden point's five-minute halves)
 * | null (no teams, unknown sport, or a model the approximation does not cover).
 * `sport` is a sport object or id; effA/effD are the match's effective strengths (tactics included); `drama`
 * is the match's uncertainty (football ignores it, as the README formula does); `home`, that the defender plays at
 * home (the campaign's home advantage: its edge is in the prepared rates, efficiencies and edges, so every kind
 * carries it). Calls only the sport's deterministic `prepareMatch`; consumes no RNG.
 */
export function liveModelFor(sport, attacker, defender, effA, effD, drama, home = false) {
  const model = typeof sport === 'string' ? getSport(sport) : sport;
  if (!model || typeof model.prepareMatch !== 'function' || !attacker || !defender) return null;
  let prepared;
  try {
    prepared = model.prepareMatch(attacker, defender, isNum(effA) ? num(effA) : undefined, isNum(effD) ? num(effD) : undefined,
      home ? { home: true } : undefined);
  } catch {
    return null;
  }
  if (!prepared) return null;
  const length = positive(model.clock?.length);
  if (Array.isArray(prepared.rubbers) && TIE_RUBBERS.has(prepared.rubbers.length)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    const toWin = (prepared.rubbers.length + 1) / 2;
    return {
      kind: 'rubbers', formSd: RUBBER_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2,
      gaps: prepared.rubbers.map(rubber => (rubber.walkover ? (rubber.walkover === 'A' ? WALKOVER_GAP : -WALKOVER_GAP) : num(rubber.gap))),
      length: toWin * RUBBER_MODEL.BLOCK, ot: RUBBER_MODEL.BLOCK, maxOt: prepared.rubbers.length - toWin,
      ...(prepared.rules?.bestOf === 5 ? { bestOf: 5 } : {}),
    };
  }
  if (model.tieBreak === 'shootout' && isNum(prepared.logA) && isNum(prepared.logD)) {
    // Extra time after a level ninety, under the knockout rules of the season's day the prepared match carries.
    const sudden = prepared.rules?.sudden;
    return { kind: 'poisson', rA: footballRate(prepared.logA), rD: footballRate(prepared.logD), length: length || 90,
      ot: FOOTBALL_MODEL.EXTRA_HALF, maxOt: FOOTBALL_MODEL.EXTRA_HALVES, extra: FOOTBALL_MODEL.EXTRA_RATE,
      ...(sudden === 'golden' || sudden === 'silver' ? { sudden } : {}) };
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.edgeA) && isNum(prepared.edgeD) && positive(prepared.drives)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return drivesModel(prepared, variation, length || 60);
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.edgeA) && isNum(prepared.edgeD) && positive(prepared.innings)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    // An earlier season's rules: its own half-inning odds and runs, and its extra innings (a runner on second or not, and
    // how many before the decisive run). Today's add nothing, so the built-in season's model is as it always was.
    const rules = prepared.rules && prepared.rules !== INNING_MODEL.RULES ? prepared.rules : null;
    return {
      kind: 'innings', edgeA: num(prepared.edgeA), edgeD: num(prepared.edgeD), formSd: variation * INNING_MODEL.FORM_PER_DRAMA,
      length: INNING_MODEL.LENGTH, ot: INNING_MODEL.INNING, maxOt: rules ? rules.maxExtra : INNING_MODEL.MAX_EXTRA,
      ...(rules ? { score: rules.score, extra: rules.extra, more: rules.more } : {}),
    };
  }
  if (model.tieBreak === 'overtime' && positive(prepared.triesA) && positive(prepared.triesD)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'tries', triesA: num(prepared.triesA), triesD: num(prepared.triesD), golden: num(prepared.golden) || 0,
      formSd: SLICE_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2, length: SLICE_MODEL.MINUTES, ot: SLICE_MODEL.GOLDEN,
      maxOt: SLICE_MODEL.MAX_GOLDEN,
    };
  }
  if (model.tieBreak === 'overtime' && positive(prepared.rateA) && positive(prepared.rateD)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    // A season's late game and overtime, carried on the prepared match (src/sports/hockey.js `rules`): today's leave the
    // model as it was.
    const { late, overtime } = prepared.rules || {};
    const playoff = !!overtime && overtime.shootout === false;
    return {
      kind: 'periods', rateA: num(prepared.rateA), rateD: num(prepared.rateD), shootout: num(prepared.shootout) || 0,
      formSd: PERIOD_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2, length: PERIOD_MODEL.MINUTES,
      ot: positive(overtime?.minutes) || PERIOD_MODEL.OVERTIME, maxOt: playoff ? overtime.periods : 2,
      ...(positive(overtime?.boost) && overtime.boost !== PERIOD_MODEL.OVERTIME_BOOST ? { otBoost: overtime.boost } : {}),
      ...(playoff ? { playoff: true } : {}),
      ...(late && late !== lateOf(null) ? { late: LATE_KEYS.map(key => late[key]) } : {}),
    };
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.efficiencyA) && isNum(prepared.efficiencyD) && positive(prepared.pace)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'normal', pace: num(prepared.pace), effA: num(prepared.efficiencyA), effD: num(prepared.efficiencyD),
      formSd: variation * FORM_PER_DRAMA, length: length || 40, ot: 5, maxOt: 4,
      // A rulebook with its own buzzer (the EuroLeague's levels fewer finishes than the NBA's and FIBA's).
      ...(Array.isArray(prepared.rules?.buzzer) ? { buzzer: prepared.rules.buzzer.slice() } : {}),
    };
  }
  return null;
}

/**
 * A's chance in one overtime period that `first` ('A' | 'D') opens → [A wins, still level], by the simulation's rules:
 * the first side kicks after a touchdown; the second answers with its odds for how far behind it is (`answer`), a
 * touchdown that puts it ahead winning outright and one that levels a 6 or a 7 kicked to win or draw level; still level,
 * the next score wins. A safety wins for the defence.
 */
function overtimePeriodChance(a, d, first) {
  const [x, y] = first === 'A' ? [a, d] : [d, a];
  // y's answer level, a field goal down, and a touchdown down after a missed or a made extra point.
  const [level, fieldGoal, missed, made] = [0, 3, 6, 7].map(behind => y.answer[behind]);
  let xWins = x.td * x.xp * (1 - made.td * y.xp) + x.td * (1 - x.xp) * (1 - missed.td)
    + x.fg * (1 - fieldGoal.td - fieldGoal.fg) + x.none * level.sf;
  let yWins = x.sf + x.td * (1 - x.xp) * missed.td * y.xp + x.fg * fieldGoal.td + x.none * (level.td + level.fg);
  let open = x.td * x.xp * made.td * y.xp + x.td * (1 - x.xp) * missed.td * (1 - y.xp) + x.fg * fieldGoal.fg
    + x.none * level.none;
  for (let k = 0; k < DRIVE_MODEL.SUDDEN_DEATH * 2; k++) {
    const side = k % 2 === 0 ? x : y;
    const scores = open * (side.td + side.fg), safety = open * side.sf;
    if (k % 2 === 0) { xWins += scores; yWins += safety; } else { yWins += scores; xWins += safety; }
    open *= side.none;
  }
  return [first === 'A' ? xWins : yWins, open];
}

/**
 * Sudden death from possession `from` of an overtime period `x` opened (x has the ball at even possessions), `open` the
 * chance it is still level then: the next score wins, a safety for the defence → [x wins, y wins, still level at the
 * period's last possession].
 */
function suddenDeath(x, y, open, from) {
  let xWins = 0, yWins = 0;
  for (let k = from; k < DRIVE_MODEL.OT_POSSESSIONS; k++) {
    const side = k % 2 === 0 ? x : y;
    const scores = open * (side.td + side.fg), safety = open * side.sf;
    if (k % 2 === 0) { xWins += scores; yWins += safety; } else { yWins += scores; xWins += safety; }
    open *= side.none;
  }
  return [xWins, yWins, open];
}

/** A's chance in one sudden-death period that `first` opens → [A wins, still level] (the AFL's, the NFL's to 2009). */
function suddenDeathPeriodChance(a, d, first) {
  const [x, y] = first === 'A' ? [a, d] : [d, a];
  const [xWins, yWins, open] = suddenDeath(x, y, 1, 0);
  return [first === 'A' ? xWins : yWins, open];
}

/**
 * A's chance in one modified sudden-death period that `first` opens → [A wins, still level] (the NFL's 2010–2021): the
 * first possession's touchdown wins and its safety loses; its field goal leaves the other side one answer a field goal
 * down (`answer[3]`), whose touchdown wins and whose field goal draws level; level, sudden death.
 */
function modifiedPeriodChance(a, d, first) {
  const [x, y] = first === 'A' ? [a, d] : [d, a];
  const answer = y.answer[3];
  const [afterNone, afterNoneY, openNone] = suddenDeath(x, y, x.none, 1);
  const [afterKicks, afterKicksY, openKicks] = suddenDeath(x, y, x.fg * answer.fg, 2);
  const xWins = x.td + x.fg * (1 - answer.td - answer.fg) + afterNone + afterKicks;
  const yWins = x.sf + x.fg * answer.td + afterNoneY + afterKicksY;
  return [first === 'A' ? xWins : yWins, openNone + openKicks];
}

/**
 * The live model of an American football match: a possession's mean and variance per side, how fast both move with
 * form, and the overtime chain, under the prepared match's rules (its season's: their safeties, tries, overtime and its
 * periods' length). A season whose overtime is not today's carries it (`overtime`).
 */
function drivesModel(prepared, variation, length) {
  const { DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, FORM_PER_DRAMA, SAFETY } = DRIVE_MODEL;
  const { rules } = prepared;
  const safety = rules?.safety ?? SAFETY, overtime = rules?.overtime ?? 'both';
  const outcomes = odds => {
    const fg = (1 - odds.td) * odds.fgTry * odds.make;
    return { td: odds.td, fg, sf: safety, none: 1 - odds.td - fg - safety, xp: odds.xp, two: odds.two };
  };
  // A side's overtime possession, and its answer to a lead of 0, 3, 6 or 7 under late-game play-calling.
  const side = odds => ({ ...outcomes(odds),
    answer: Object.fromEntries([0, 3, 6, 7].map(behind => [behind, outcomes(lateCall(odds, -behind))])) });
  const meanAt = (edge, kicking) => driveMoments(driveOdds(edge, kicking, rules), rules).mean;
  const oddsA = driveOdds(prepared.edgeA, prepared.kickingA, rules), oddsD = driveOdds(prepared.edgeD, prepared.kickingD, rules);
  const a = driveMoments(oddsA, rules), d = driveMoments(oddsD, rules);
  const slope = (meanAt(prepared.edgeA + 1, prepared.kickingA) - meanAt(prepared.edgeA - 1, prepared.kickingA)) / 2
    + (meanAt(prepared.edgeD + 1, prepared.kickingD) - meanAt(prepared.edgeD - 1, prepared.kickingD)) / 2;
  const sideA = side(oddsA), sideD = side(oddsD);
  const period = overtime === 'sudden' ? suddenDeathPeriodChance : overtime === 'modified' ? modifiedPeriodChance : overtimePeriodChance;
  const [winFirst, openFirst] = period(sideA, sideD, 'A');
  const [winSecond, openSecond] = period(sideA, sideD, 'D');
  const win = (winFirst + winSecond) / 2, open = (openFirst + openSecond) / 2;
  // otChain[0]: the decisive field goal; otChain[k]: k periods still to play.
  const otChain = [1 / (1 + Math.exp(-DECISIVE_FIELD_GOAL * (prepared.edgeA - prepared.edgeD)))];
  for (let k = 1; k <= MAX_OVERTIMES; k++) otChain.push(win + open * otChain[k - 1]);
  return {
    kind: 'drives', drives: num(prepared.drives) || DRIVES, muA: a.mean, muD: d.mean, varA: a.variance, varD: d.variance, slope,
    formSd: variation * FORM_PER_DRAMA, driveSd: DRIVE_SD, length, ot: rules?.ot ?? OVERTIME, maxOt: MAX_OVERTIMES, otChain,
    tdA: sideA.td, fgA: sideA.fg, xpA: sideA.xp, twoA: sideA.two, tdD: sideD.td, fgD: sideD.fg, xpD: sideD.xp, twoD: sideD.two,
    ...(overtime === 'both' ? {} : { overtime }),
  };
}

/** True for a well-formed `liveModelFor` result (e.g. one read back from a save). */
export function isLiveModel(model) {
  if (!model || typeof model !== 'object') return false;
  const finite = key => typeof model[key] === 'number' && Number.isFinite(model[key]);
  if (model.kind === 'poisson') {
    if (!(finite('rA') && finite('rD') && model.rA >= 0 && model.rD >= 0 && finite('length') && model.length > 0)) return false;
    // A model saved before extra time came in has none of its fields.
    if (model.ot === undefined) return model.maxOt === undefined && model.extra === undefined && model.sudden === undefined;
    return finite('ot') && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 1 && finite('extra') && model.extra >= 0
      && (model.sudden === undefined || model.sudden === 'golden' || model.sudden === 'silver');
  }
  if (model.kind === 'normal') {
    return finite('pace') && model.pace > 0 && finite('effA') && finite('effD') && finite('formSd') && model.formSd >= 0
      && finite('length') && model.length > 0 && finite('ot') && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0
      && (model.buzzer === undefined || (Array.isArray(model.buzzer) && model.buzzer.every(p => typeof p === 'number' && p >= 0 && p <= 1)));
  }
  if (model.kind === 'drives') {
    const tries = ['xpA', 'twoA', 'xpD', 'twoD'].filter(key => model[key] !== undefined);
    return ['drives', 'muA', 'muD', 'varA', 'varD', 'slope', 'formSd', 'driveSd', 'length', 'ot', 'tdA', 'fgA', 'tdD', 'fgD', ...tries].every(finite)
      && ['tdA', 'fgA', 'tdD', 'fgD', ...tries].every(key => model[key] >= 0 && model[key] <= 1)
      && model.drives > 0 && model.muA >= 0 && model.muD >= 0 && model.varA >= 0 && model.varD >= 0 && model.formSd >= 0
      && model.driveSd >= 0 && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0
      && Array.isArray(model.otChain) && model.otChain.length === model.maxOt + 1
      && model.otChain.every(p => typeof p === 'number' && p >= 0 && p <= 1)
      && (model.overtime === undefined || OVERTIME_RULES.includes(model.overtime));
  }
  if (model.kind === 'innings') {
    // An earlier season's odds (`score`, `extra`, `more`) come together; a model without them plays today's.
    const era = ['score', 'extra', 'more'].filter(key => model[key] !== undefined);
    return ['edgeA', 'edgeD', 'formSd', 'length', 'ot', ...era].every(finite) && model.formSd >= 0 && model.length > 0 && model.ot > 0
      && Number.isInteger(model.maxOt) && model.maxOt >= 0 && (era.length === 0 || (era.length === 3 && model.more > 0 && model.more < 1));
  }
  if (model.kind === 'periods') {
    return ['rateA', 'rateD', 'shootout', 'formSd', 'length', 'ot'].every(finite) && model.rateA > 0 && model.rateD > 0 && model.formSd >= 0
      && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0
      && (model.otBoost === undefined || (finite('otBoost') && model.otBoost > 0))
      && (model.playoff === undefined || (model.playoff === true && model.maxOt >= 1))
      && (model.late === undefined || (Array.isArray(model.late) && model.late.length === 5
        && model.late.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)));
  }
  if (model.kind === 'tries') {
    return ['triesA', 'triesD', 'golden', 'formSd', 'length', 'ot'].every(finite) && model.triesA > 0 && model.triesD > 0
      && model.formSd >= 0 && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 1;
  }
  if (model.kind === 'rubbers') {
    return ['formSd', 'length', 'ot'].every(finite) && model.formSd >= 0 && model.length > 0 && model.ot > 0
      && Number.isInteger(model.maxOt) && model.maxOt >= 0 && Array.isArray(model.gaps) && TIE_RUBBERS.has(model.gaps.length)
      && model.gaps.every(gap => typeof gap === 'number' && Number.isFinite(gap))
      && (model.bestOf === undefined || model.bestOf === 3 || model.bestOf === 5);
  }
  return false;
}

/** Poisson(λ) masses for 0..GOAL_CAP, the last one holding "GOAL_CAP or more". */
function cappedPoisson(lambda) {
  const masses = new Array(GOAL_CAP + 1).fill(0);
  if (!(lambda > 0)) { masses[0] = 1; return masses; }
  let mass = Math.exp(-lambda), total = 0;
  for (let k = 0; k < GOAL_CAP; k++) {
    masses[k] = mass;
    total += mass;
    mass *= lambda / (k + 1);
  }
  masses[GOAL_CAP] = Math.max(0, 1 - total);
  return masses;
}

/**
 * README formula: P(side A eventually wins) from the current goal difference (A − D) and the remaining fraction
 * of the 90 minutes, Poisson sums over i, j ∈ 0..15; a level final score counts `shootoutA` (½ by default).
 * remaining = 0 is an exact step: 1 / 0 / shootoutA.
 */
export function footballWinProbability({ rA, rD, diff = 0, remaining = 0, shootoutA = 0.5 } = {}) {
  const lead = isNum(diff) ? Math.round(num(diff)) : 0;
  const level = isNum(shootoutA) ? clamp01(num(shootoutA)) : 0.5;
  const r = isNum(remaining) ? clamp01(num(remaining)) : 0;
  const la = positive(rA) * r, ld = positive(rD) * r;
  if (!(la > 0) && !(ld > 0)) return step(lead, level);
  const pa = cappedPoisson(la), pd = cappedPoisson(ld);
  let win = 0, tie = 0;
  for (let i = 0; i <= GOAL_CAP; i++) {
    if (!pa[i]) continue;
    for (let j = 0; j <= GOAL_CAP; j++) {
      const q = pa[i] * pd[j];
      if (!q) continue;
      const final = lead + i - j;
      if (final > 0) win += q;
      else if (final === 0) tie += q;
    }
  }
  return clamp01(win + tie * level);
}

/**
 * Football's extra time: P(side A wins) from goal difference `diff` (A − D) with `left` of its minutes to go, its goals
 * at the rates rA·extra and rD·extra a ninety minutes, then the tie-break at ½ (penalties, or the drawing of lots).
 * Under the golden goal (`sudden`) a lead in extra time has already won it; under the silver goal a lead at its half-time
 * wins, and the second half starts level.
 */
function extraTimeChance(model, left, diff) {
  const { rA, rD, extra, ot, maxOt, sudden } = model;
  const a = positive(rA) * positive(extra), d = positive(rD) * positive(extra);
  const total = ot * maxOt;
  const minutes = clamp(left, 0, total);
  const over = (lead, span, level) => footballWinProbability({ rA: a, rD: d, diff: lead, remaining: span / FOOTBALL_MODEL.MINUTES,
    shootoutA: level });
  if (sudden === 'golden') {
    if (diff !== 0) return step(diff, 0.5);
    const rate = (a + d) * minutes / FOOTBALL_MODEL.MINUTES;
    return rate > 0 ? (1 - Math.exp(-rate)) * a / (a + d) + Math.exp(-rate) * 0.5 : 0.5;
  }
  // The silver goal's first half in play: a lead at its end wins; level, the second half's fifteen minutes.
  if (sudden === 'silver' && minutes > total - ot) return over(diff, minutes - (total - ot), over(0, total - ot, 0.5));
  return over(diff, minutes, 0.5);
}

/**
 * Football: P(side A wins) at minute `t` with goal difference `diff`. In the ninety the README formula, a level score
 * at 90' worth A's chance through extra time (½ for a model saved before extra time came in); then extra time's own.
 * `halfDiff` is the difference at extra time's half-time, which the silver goal decides on (by default: the one at
 * 105', and level after it).
 */
function footballAt(model, t, diff, halfDiff = null) {
  const { rA, rD, length } = model;
  if (!(model.ot > 0)) return footballWinProbability({ rA, rD, diff, remaining: (length - clamp(t, 0, length)) / length });
  const total = model.ot * model.maxOt;
  if (t <= length) {
    return footballWinProbability({ rA, rD, diff, remaining: (length - Math.max(0, t)) / length, shootoutA: extraTimeChance(model, total, 0) });
  }
  const minute = Math.min(t, length + total);
  if (model.sudden === 'silver' && minute >= length + model.ot) {
    const atHalf = halfDiff ?? (minute === length + model.ot ? diff : 0);
    if (atHalf !== 0) return step(atHalf, 0.5);
  }
  return extraTimeChance(model, length + total - minute, diff);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7); Φ(−z) = 1 − Φ(z) by construction. */
function normalCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Basketball normal approximation: P(side A wins) from the current margin (A − D points) and the possessions
 * still to play. `tieA` is A's chance from a level score once those possessions are gone (½ by default; the
 * series passes the overtime chain); `possessionSd` is the spread of the remaining possession count; `buzzer[k − 1]`
 * is the chance a side k points behind once they are played draws level (regulation's buzzer; none by default).
 * remainingPossessions = 0 is an exact step: 1 / 0 / tieA.
 */
export function basketballWinProbability({ effA, effD, formSd = 0, margin = 0, remainingPossessions = 0, tieA = 0.5, possessionSd = 0,
  buzzer = [] } = {}) {
  const lead = isNum(margin) ? num(margin) : 0;
  const level = isNum(tieA) ? clamp01(num(tieA)) : 0.5;
  const R = positive(remainingPossessions);
  if (!(R > 0)) return step(lead, level);
  const a = isNum(effA) ? num(effA) : isNum(effD) ? num(effD) : 1;
  const d = isNum(effD) ? num(effD) : a;
  const form = positive(formSd), spread = positive(possessionSd);
  const edge = a - d;
  const mean = lead + R * edge;
  const variance = R * (2 * SHOT_VARIANCE_BASE + SHOT_VARIANCE_PER_EFFICIENCY * (a + d))
    + 2 * (form * R) ** 2 + (edge * spread) ** 2 + ROUNDING_VARIANCE;
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  const below = points => normalCdf((points - 0.5 - mean) / sd);
  const finish = points => below(points + 1) - below(points);
  let chance = (1 - below(1)) + finish(0) * level;
  // A finish k points up is level with buzzer[k − 1], as is one k points down.
  (Array.isArray(buzzer) ? buzzer : []).forEach((p, i) => {
    chance += clamp01(num(p) || 0) * (finish(-(i + 1)) * level - finish(i + 1) * (1 - level));
  });
  return clamp01(chance);
}

/** A's chance from a level score with `periodsLeft` overtime periods still to play (the last ends in a decisive play). */
function overtimeChance(model, periodsLeft) {
  const { effA, effD, formSd, pace, length, ot } = model;
  let chance = 1 / (1 + Math.exp(-DECISIVE_SLOPE * (effA - effD)));
  const possessions = pace * ot / length;
  for (let k = 0; k < periodsLeft; k++) {
    chance = basketballWinProbability({ effA, effD, formSd, margin: 0, remainingPossessions: possessions, tieA: chance, possessionSd: OVERTIME_PACE_SD });
  }
  return chance;
}

/**
 * American football's normal approximation: P(side A wins) from the current margin (A − D points) and the
 * possessions each side still has. `tieA` is A's chance from a level score once they are played (½ by default).
 * remainingDrives = 0 is an exact step: 1 / 0 / tieA.
 */
export function drivesWinProbability({ muA, muD, varA = 0, varD = 0, slope = 0, formSd = 0, margin = 0, remainingDrives = 0, tieA = 0.5, driveSd = 0 } = {}) {
  const lead = isNum(margin) ? num(margin) : 0;
  const level = isNum(tieA) ? clamp01(num(tieA)) : 0.5;
  const R = positive(remainingDrives);
  if (!(R > 0)) return step(lead, level);
  const a = isNum(muA) ? num(muA) : 2, d = isNum(muD) ? num(muD) : a;
  const edge = a - d;
  const mean = lead + R * edge;
  const variance = R * (positive(varA) + positive(varD)) + (R * positive(slope) * positive(formSd)) ** 2
    + (edge * positive(driveSd)) ** 2 + ROUNDING_VARIANCE;
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  const upToZero = normalCdf((0.5 - mean) / sd);
  const belowZero = normalCdf((-0.5 - mean) / sd);
  return clamp01((1 - upToZero) + (upToZero - belowZero) * level);
}

function drivesAt(model, t, margin) {
  const { drives, length, ot, maxOt, otChain } = model;
  const minute = clamp(t, 0, lastMinute(model));
  if (minute <= length) {
    return drivesWinProbability({ muA: model.muA, muD: model.muD, varA: model.varA, varD: model.varD, slope: model.slope,
      formSd: model.formSd, margin, remainingDrives: drives * (length - minute) / length, tieA: otChain[maxOt],
      driveSd: model.driveSd * (length - minute) / length });
  }
  // Overtime is a possession or two, too few for a normal curve. Level, the period's own chain; a lead, the trailing
  // side's one answer: a touchdown wins against up to 5 and, with its extra point, against 6, and levels 7 with the
  // extra point and 8 with two points; a field goal wins against 1 or 2 and levels 3. A model saved before tries
  // kicks every extra point. In sudden death (to 2009) a lead has won; in modified sudden death (2010–2021) only a
  // first possession's field goal leaves an answer, a touchdown winning and a field goal drawing level.
  const period = Math.min(maxOt - 1, Math.ceil((minute - length) / ot) - 1);
  const level = otChain[maxOt - period];
  if (minute >= length + ot * maxOt) return step(margin, otChain[0]);
  if (margin === 0) return level;
  if (model.overtime === 'sudden' || (model.overtime === 'modified' && Math.abs(margin) !== 3)) return step(margin, level);
  const [td, fg, xp = 1, two = 0] = margin > 0 ? [model.tdD, model.fgD, model.xpD, model.twoD] : [model.tdA, model.fgA, model.xpA, model.twoA];
  const lead = Math.abs(margin);
  const levelled = margin > 0 ? 1 - level : level;
  const trailer = lead > 8 ? 0 : lead === 8 ? td * two * levelled : lead === 7 ? td * xp * levelled
    : lead === 6 ? td * (xp + (1 - xp) * levelled) : lead > 3 ? td : lead === 3 ? td + fg * levelled : td + fg;
  return margin > 0 ? clamp01(1 - trailer) : clamp01(trailer);
}

// Seven-point Gauss–Hermite quadrature for E[f(X)], X ~ N(0, σ²): nodes x = √2·σ·t, weights w/√π.
const HERMITE = [[0, 0.8102646175568073], [0.8162878828589647, 0.4256072526101278], [-0.8162878828589647, 0.4256072526101278],
  [1.6735516287674714, 0.05451558281912703], [-1.6735516287674714, 0.05451558281912703],
  [2.651961356835233, 0.0009717812450995192], [-2.651961356835233, 0.0009717812450995192]].map(([t, w]) => [t * Math.SQRT2, w / Math.sqrt(Math.PI)]);
// A side's runs still to come, the last bucket holding "this many or more".
const RUNS_MAX = 40;
const innings = new WeakMap();

function convolve(a, b) {
  const out = new Array(Math.min(a.length + b.length - 1, RUNS_MAX + 1)).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) out[Math.min(i + j, RUNS_MAX)] += a[i] * b[j];
  }
  return out;
}

/**
 * A baseball model's tables, built once per model: for each form node, each side's runs over k whole half-innings
 * (k = 0…9), the half-inning masses (regulation and extra) and the extra-inning chain (chain[k]: A's chance from level
 * with k extra innings still to play; chain[0] the decisive run). An earlier season's model plays its own odds and runs
 * (`score`, `extra`, `more`: without a runner on second its extra innings score as the ninth does), today's otherwise.
 * Also a cache of computed values by minute and margin.
 */
function inningTables(model) {
  if (innings.has(model)) return innings.get(model);
  const { INNINGS, DECISIVE_RUN, RULES } = INNING_MODEL;
  const rules = model.score === undefined ? RULES : { score: model.score, extra: model.extra };
  const more = model.more ?? RULES.more;
  const decisive = 1 / (1 + Math.exp(-DECISIVE_RUN * (model.edgeA - model.edgeD)));
  const nodes = HERMITE.map(([t, weight]) => {
    const form = t * model.formSd;
    const oddsA = inningOdds(model.edgeA + form, rules), oddsD = inningOdds(model.edgeD - form, rules);
    const side = odds => {
      const masses = runMasses(odds.score, more), powers = [[1]];
      for (let k = 1; k <= INNINGS; k++) powers.push(convolve(powers[k - 1], masses));
      return { score: odds.score, extraScore: odds.extra, powers, extra: runMasses(odds.extra, more) };
    };
    const A = side(oddsA), D = side(oddsD);
    let win = 0, level = 0;
    A.extra.forEach((a, i) => D.extra.forEach((d, j) => { if (i > j) win += a * d; else if (i === j) level += a * d; }));
    const chain = [decisive];
    for (let k = 1; k <= model.maxOt; k++) chain.push(win + level * chain[k - 1]);
    return { weight, A, D, chain };
  });
  const tables = { nodes, more, cache: new Map() };
  innings.set(model, tables);
  return tables;
}

/** P(A wins) from `margin` (A − D) with `remA` and `remD` the runs each side still has to come, level → `tieA`. */
function marginChance(remA, remD, margin, tieA) {
  let chance = 0;
  for (let i = 0; i < remA.length; i++) {
    if (!remA[i]) continue;
    for (let j = 0; j < remD.length; j++) {
      const final = margin + i - j;
      chance += remA[i] * remD[j] * (final > 0 ? 1 : final === 0 ? tieA : 0);
    }
  }
  return chance;
}

/**
 * Baseball: P(side A wins) at clock `t` (outs) with run margin `margin`, averaged over the form nodes. Regulation counts
 * the half-innings left, the one in progress by the outs it has left; in the extra innings, the rest of the inning, then
 * the chain.
 */
function inningsAt(model, t, margin) {
  const { OUTS, INNINGS } = INNING_MODEL;
  const minute = clamp(t, 0, lastMinute(model));
  const { nodes, more, cache } = inningTables(model);
  const key = `${minute}|${margin}`;
  if (cache.has(key)) return cache.get(key);
  let chance;
  if (minute >= lastMinute(model)) chance = step(margin, nodes.reduce((s, n) => s + n.weight * n.chain[0], 0));
  else if (minute <= model.length) {
    // Half-inning h is in progress (h = 18: regulation is over); even halves are the attacker's.
    const h = Math.floor(minute / OUTS), left = (OUTS - (minute - h * OUTS)) / OUTS;
    const halves = 2 * INNINGS;
    const after = side => { let n = 0; for (let k = h + 1; k < halves; k++) if ((k % 2 === 0) === (side === 'A')) n++; return n; };
    chance = nodes.reduce((sum, node) => {
      const rest = side => {
        const own = side === 'A' ? node.A : node.D;
        const whole = own.powers[after(side)];
        const batting = h < halves && (h % 2 === 0) === (side === 'A');
        return batting && left > 0 ? convolve(runMasses(own.score * left, more), whole) : whole;
      };
      return sum + node.weight * marginChance(rest('A'), rest('D'), margin, node.chain[model.maxOt]);
    }, 0);
  } else {
    // Extra inning k (1-based), u outs into it: the attacker's top, then the defender's bottom.
    const k = Math.min(model.maxOt, Math.ceil((minute - model.length) / model.ot));
    const u = minute - model.length - (k - 1) * model.ot;
    chance = nodes.reduce((sum, node) => {
      const top = u < OUTS ? runMasses(node.A.extraScore * (OUTS - u) / OUTS, more) : [1];
      const bottom = u < OUTS ? node.D.extra : u < 2 * OUTS ? runMasses(node.D.extraScore * (2 * OUTS - u) / OUTS, more) : [1];
      return sum + node.weight * marginChance(top, bottom, margin, node.chain[model.maxOt - k]);
    }, 0);
  }
  chance = clamp01(chance);
  cache.set(key, chance);
  return chance;
}

// A margin past this many goals is as good as won, for the hockey tables.
const MARGIN_CAP = 12;
// An earlier season's late game, in a live model's `late` (src/sports/hockey.js `lateOf`), in this order.
const LATE_KEYS = Object.freeze(['level', 'leading', 'trailing', 'pulled', 'emptyNet']);
// Goals in one slice, the last bucket holding "this many or more".
const SLICE_GOALS = 8;
const periods = new WeakMap();

/** Poisson(λ) masses for 0…SLICE_GOALS, the last one holding the rest. */
function sliceMasses(lambda) {
  const masses = new Array(SLICE_GOALS + 1).fill(0);
  let mass = Math.exp(-lambda), total = 0;
  for (let k = 0; k < SLICE_GOALS; k++) {
    masses[k] = mass;
    total += mass;
    mass *= lambda / (k + 1);
  }
  masses[SLICE_GOALS] = Math.max(0, 1 - total);
  return masses;
}

/**
 * A hockey model's tables, built once per model: for each form node its two rates, its overtime's means a period and
 * `from[s][margin]`, A's chance at the start of slice s (`from[SLICES]` at the end of regulation, level meaning the
 * overtime and shoot-out, or the playoffs' periods). Also a cache of computed values by minute and margin.
 */
function periodTables(model) {
  if (periods.has(model)) return periods.get(model);
  const { SLICES } = PERIOD_MODEL;
  const shootout = shootoutOdds(model.shootout);
  const overtime = { boost: model.otBoost ?? PERIOD_MODEL.OVERTIME_BOOST, minutes: model.ot };
  // An earlier season's late game; today's when the model names none.
  const late = model.late ? Object.fromEntries(LATE_KEYS.map((key, i) => [key, model.late[i]])) : undefined;
  const nodes = HERMITE.map(([t, weight]) => {
    const form = Math.exp(t * model.formSd);
    const rateA = model.rateA * form, rateD = model.rateD / form;
    const [overtimeA, overtimeD] = overtimeMeans(rateA, rateD, overtime);
    const node = { weight, rateA, rateD, late, overtimeA, overtimeD, shootout, from: new Array(SLICES + 1) };
    node.from[SLICES] = Array.from({ length: 2 * MARGIN_CAP + 1 }, (_, i) => step(i - MARGIN_CAP, levelChance(model, node, 1)));
    for (let s = SLICES - 1; s >= 0; s--) node.from[s] = Array.from({ length: 2 * MARGIN_CAP + 1 }, (_, i) => sliceChance(node, s, i - MARGIN_CAP, 1));
    return node;
  });
  const tables = { nodes, cache: new Map() };
  periods.set(model, tables);
  return tables;
}

/** A's chance from level with `left` (a share) of the five minutes of sudden death to go, then the shoot-out. */
function suddenDeathChance(overtimeA, overtimeD, left, shootout) {
  const total = overtimeA + overtimeD;
  const none = Math.exp(-total * left);
  return (1 - none) * overtimeA / total + none * shootout;
}

/**
 * A's chance in `node` from level with `left` (a share) of the overtime to go: today's sudden death then the shoot-out.
 * The playoffs' periods all play at the same rates, and the last ends in a goal at the same odds, so from level A wins
 * with its share of the overtime's goals at any minute of them.
 */
function levelChance(model, node, left) {
  if (model.playoff) return node.overtimeA / (node.overtimeA + node.overtimeD);
  return suddenDeathChance(node.overtimeA, node.overtimeD, left, node.shootout);
}

/** A's chance in `node` from `margin` with `left` (a share) of slice s to play, then the slices after it. */
function sliceChance(node, s, margin, left) {
  const [meanA, meanD] = sliceMeans(node.rateA, node.rateD, margin, s, node.late);
  const a = sliceMasses(meanA * left), d = sliceMasses(meanD * left), next = node.from[s + 1];
  let chance = 0;
  for (let i = 0; i <= SLICE_GOALS; i++) {
    for (let j = 0; j <= SLICE_GOALS; j++) chance += a[i] * d[j] * next[clamp(margin + i - j, -MARGIN_CAP, MARGIN_CAP) + MARGIN_CAP];
  }
  return chance;
}

/** Ice hockey: P(side A wins) at minute `t` with goal margin `margin`, averaged over the form nodes. */
function periodsAt(model, t, margin) {
  const { SLICE, SLICES } = PERIOD_MODEL;
  const minute = clamp(t, 0, lastMinute(model));
  const lead = clamp(Math.round(margin), -MARGIN_CAP, MARGIN_CAP);
  const { nodes, cache } = periodTables(model);
  const key = `${minute}|${lead}`;
  if (cache.has(key)) return cache.get(key);
  let chance;
  if (minute >= model.length && model.playoff) {
    // The playoffs' periods: a lead has won; level, the next goal wins, whenever it comes.
    chance = lead ? step(lead, 0.5) : nodes.reduce((sum, node) => sum + node.weight * levelChance(model, node, 1), 0);
  } else if (minute >= model.length) {
    // Regulation is over: a lead has won, in overtime as at the end of the third. Level, what is left of the five minutes.
    const left = clamp((model.length + model.ot - minute) / model.ot, 0, 1);
    chance = lead ? step(lead, 0.5) : nodes.reduce((sum, node) => sum + node.weight * suddenDeathChance(node.overtimeA, node.overtimeD, left, node.shootout), 0);
  } else {
    const s = Math.min(SLICES - 1, Math.floor(minute / SLICE));
    const left = (SLICE * (s + 1) - minute) / SLICE;
    chance = nodes.reduce((sum, node) => sum + node.weight * sliceChance(node, s, lead, left), 0);
  }
  chance = clamp01(chance);
  cache.set(key, chance);
  return chance;
}

// A rugby league margin past this many points is as good as won.
const POINTS_CAP = 72;
// A side's points in one slice, the last bucket holding "this many or more".
const SLICE_POINTS = 40;
const tryTables = new WeakMap();

/** Poisson(λ) masses for 0…cap, the last one holding the rest. */
function poissonMasses(lambda, cap) {
  const masses = new Array(cap + 1).fill(0);
  let mass = Math.exp(-lambda), total = 0;
  for (let k = 0; k < cap; k++) {
    masses[k] = mass;
    total += mass;
    mass *= lambda / (k + 1);
  }
  masses[cap] = Math.max(0, 1 - total);
  return masses;
}

/**
 * One side's points in a slice → masses for 0…SLICE_POINTS: its tries (each four, or six converted), its penalty goals
 * (two) and its field goal (one, with its chance), the means scaled by `left`, the share of the slice still to play.
 */
function slicePoints({ tries, penalties, fieldGoals }, left) {
  const points = new Array(SLICE_POINTS + 1).fill(0);
  const tryMasses = poissonMasses(tries * left, 8), penaltyMasses = poissonMasses(penalties * left, 6);
  const convert = SLICE_MODEL.CONVERSION_RATE, field = clamp01(fieldGoals * left);
  for (let k = 0; k < tryMasses.length; k++) {
    if (!tryMasses[k]) continue;
    // k tries, c of them converted: Binomial(k, convert).
    let binomial = (1 - convert) ** k;
    for (let c = 0; c <= k; c++) {
      const fromTries = POINTS.TRY * k + POINTS.CONVERSION * c;
      for (let j = 0; j < penaltyMasses.length; j++) {
        const base = tryMasses[k] * binomial * penaltyMasses[j];
        const at = fromTries + POINTS.PENALTY_GOAL * j;
        points[Math.min(SLICE_POINTS, at)] += base * (1 - field);
        points[Math.min(SLICE_POINTS, at + POINTS.FIELD_GOAL)] += base * field;
      }
      binomial *= convert > 0 && convert < 1 ? ((k - c) / (c + 1)) * (convert / (1 - convert)) : 0;
    }
  }
  return points;
}

/** The distribution of A's points minus D's in a slice → { offset, masses } with masses[i] the chance of i − offset. */
function marginMasses(a, d) {
  const masses = new Array(2 * SLICE_POINTS + 1).fill(0);
  for (let i = 0; i <= SLICE_POINTS; i++) {
    if (!a[i]) continue;
    for (let j = 0; j <= SLICE_POINTS; j++) masses[i - j + SLICE_POINTS] += a[i] * d[j];
  }
  return { offset: SLICE_POINTS, masses };
}

/** A's chance in golden point from level with `left` (a share) of its first half to go, then its other halves. */
function goldenChance(node, halves, left) {
  const total = node.goldenA + node.goldenD;
  // No score in what is left of this half and in the halves after it: the last field goal decides.
  const none = Math.exp(-total * (left + Math.max(0, halves - 1)));
  return (1 - none) * node.goldenA / total + none * node.decider;
}

/**
 * A rugby league model's tables, built once per model: for each form node its two try rates and `from[s][margin]`, A's
 * chance at the start of slice s (`from[SLICES]` at the end of regulation, level meaning golden point). Margin
 * distributions are cached by the slice's means, which the score effects change only near level and late on.
 */
function rugbyTables(model) {
  if (tryTables.has(model)) return tryTables.get(model);
  const { SLICES } = SLICE_MODEL;
  const decider = deciderOdds(model.golden);
  const nodes = HERMITE.map(([t, weight]) => {
    const form = Math.exp(t * model.formSd);
    const triesA = model.triesA * form, triesD = model.triesD / form;
    const node = { weight, triesA, triesD, goldenA: goldenRate(triesA), goldenD: goldenRate(triesD), decider, from: new Array(SLICES + 1), deltas: new Map() };
    node.from[SLICES] = Array.from({ length: 2 * POINTS_CAP + 1 }, (_, i) => step(i - POINTS_CAP, goldenChance(node, model.maxOt, 1)));
    for (let s = SLICES - 1; s >= 0; s--) node.from[s] = Array.from({ length: 2 * POINTS_CAP + 1 }, (_, i) => tryChance(node, s, i - POINTS_CAP, 1));
    return node;
  });
  const tables = { nodes, cache: new Map() };
  tryTables.set(model, tables);
  return tables;
}

/** A's chance in `node` from `margin` with `left` (a share) of slice s to play, then the slices after it. */
function tryChance(node, s, margin, left) {
  const a = rugbySliceMeans(node.triesA, margin, s), d = rugbySliceMeans(node.triesD, -margin, s);
  const key = `${s}|${left}|${a.tries}|${a.penalties}|${a.fieldGoals}|${d.tries}|${d.penalties}|${d.fieldGoals}`;
  let delta = node.deltas.get(key);
  if (!delta) {
    delta = marginMasses(slicePoints(a, left), slicePoints(d, left));
    node.deltas.set(key, delta);
  }
  const next = node.from[s + 1];
  let chance = 0;
  for (let k = 0; k < delta.masses.length; k++) {
    if (delta.masses[k]) chance += delta.masses[k] * next[clamp(margin + k - delta.offset, -POINTS_CAP, POINTS_CAP) + POINTS_CAP];
  }
  return chance;
}

/** Rugby league: P(side A wins) at minute `t` with points margin `margin`, averaged over the form nodes. */
function triesAt(model, t, margin) {
  const { SLICE, SLICES } = SLICE_MODEL;
  const minute = clamp(t, 0, lastMinute(model));
  const lead = clamp(Math.round(margin), -POINTS_CAP, POINTS_CAP);
  const { nodes, cache } = rugbyTables(model);
  const key = `${minute}|${lead}`;
  if (cache.has(key)) return cache.get(key);
  let chance;
  if (minute >= model.length) {
    // Regulation is over: a lead has won, in golden point as at full time. Level, what is left of golden point.
    const played = (minute - model.length) / model.ot;
    const halves = model.maxOt - Math.floor(played), left = 1 - (played - Math.floor(played));
    chance = lead ? step(lead, 0.5) : nodes.reduce((sum, node) => sum + node.weight * goldenChance(node, Math.max(1, halves), halves >= 1 ? left : 0), 0);
  } else {
    const s = Math.min(SLICES - 1, Math.floor(minute / SLICE));
    const left = (SLICE * (s + 1) - minute) / SLICE;
    chance = nodes.reduce((sum, node) => sum + node.weight * tryChance(node, s, lead, left), 0);
  }
  chance = clamp01(chance);
  cache.set(key, chance);
  return chance;
}

const rubbers = new WeakMap();

/** A tennis model's tie: the rubbers that win it (three of five, two of three) and the sets that win a rubber. */
const tieOf = model => ({ toWin: (model.gaps.length + 1) / 2, need: model.bestOf === 5 ? 3 : 2 });

/**
 * A tennis model's tables, built once per model: for each form node, the attacker's chance in each rubber (`p`: Elo's
 * own over best of three, over five sets of the same set chances in a best-of-five rubber) and his set chances at the
 * day-form nodes of each (`days`). Also a cache of computed values by state.
 */
function rubberTables(model) {
  if (rubbers.has(model)) return rubbers.get(model);
  const five = model.bestOf === 5;
  const nodes = HERMITE.map(([t, weight]) => {
    const odds = model.gaps.map(gap => matchOdds(gap + t * model.formSd));
    const days = odds.map(daySetChances);
    const p = five ? days.map(day => day.reduce((sum, { weight: w, s }) => sum + w * bestOfFive(s), 0)) : odds;
    return { weight, p, days };
  });
  const tables = { nodes, cache: new Map() };
  rubbers.set(model, tables);
  return tables;
}

/** A's chance to win a match of `need` sets (2: best of three) from sets `a`–`d` when he wins each set with `s`. */
function fromSets(s, a, d, need = 2) {
  if (a >= need) return 1;
  if (d >= need) return 0;
  if (need === 2) {
    if (a === 1 && d === 1) return s;
    if (a === 1) return s * (2 - s);
    if (d === 1) return s * s;
    return bestOfThree(s);
  }
  // A takes the x sets he needs before D takes y: the last of them his, j of D's among the ones before it.
  const x = need - a, y = need - d;
  let chance = 0, ways = 1;
  for (let j = 0; j < y; j++) {
    chance += ways * s ** x * (1 - s) ** j;
    ways = ways * (x + j) / (j + 1);
  }
  return chance;
}

/**
 * A's chance to win a rubber of `need` sets from sets `a`–`d`: each day-form node's, weighed by its prior and by how
 * likely it made the sets already played (the match's own odds `p` at 0–0).
 */
function rubberFrom(days, p, a, d, need = 2) {
  if (a >= need) return 1;
  if (d >= need) return 0;
  if (a === 0 && d === 0) return p;
  let chance = 0, total = 0;
  for (const { weight, s } of days) {
    const likely = weight * s ** a * (1 - s) ** d;
    chance += likely * fromSets(s, a, d, need);
    total += likely;
  }
  return total > 0 ? chance / total : p;
}

/** A's chance in `node` from rubbers `a`–`d`, the one in play at sets `sa`–`sd`, then the rubbers left (`tie`: tieOf). */
function tieFrom(node, tie, a, d, sa = 0, sd = 0) {
  if (a >= tie.toWin) return 1;
  if (d >= tie.toWin) return 0;
  const j = a + d;
  const q = rubberFrom(node.days[j], node.p[j], sa, sd, tie.need);
  return q * tieFrom(node, tie, a + 1, d) + (1 - q) * tieFrom(node, tie, a, d + 1);
}

/** Tennis: P(side A wins) with rubbers `a`–`d` won and the one in play at sets `sa`–`sd`, averaged over the form nodes. */
function rubbersAt(model, a, d, sa = 0, sd = 0) {
  const tie = tieOf(model);
  if (a >= tie.toWin) return 1;
  if (d >= tie.toWin) return 0;
  const { nodes, cache } = rubberTables(model);
  const key = `${a}|${d}|${sa}|${sd}`;
  if (cache.has(key)) return cache.get(key);
  const chance = clamp01(nodes.reduce((sum, node) => sum + node.weight * tieFrom(node, tie, a, d, sa, sd), 0));
  cache.set(key, chance);
  return chance;
}

/**
 * The tie's state after the revealed events up to minute `t` → { a, d, sa, sd }: every event is a set won by its side,
 * `pts` 1 the set that also wins the rubber.
 */
function rubberState(events, aId, t) {
  let a = 0, d = 0, sa = 0, sd = 0;
  for (const event of events) {
    if (Math.ceil(num(event.m)) > t) continue;
    const own = event.tid === aId;
    if ((isNum(event.pts) ? num(event.pts) : 1) > 0) {
      if (own) a++; else d++;
      sa = 0; sd = 0;
    } else if (own) sa++; else sd++;
  }
  return { a, d, sa, sd };
}

/**
 * Models with overtime periods after regulation: basketball's and American football's, baseball's extra innings, ice hockey's,
 * tennis's fourth and fifth rubbers, rugby league's golden point and football's extra time (not a model saved before it).
 */
const hasOvertime = model => model.kind === 'normal' || model.kind === 'drives' || model.kind === 'innings' || model.kind === 'periods'
  || model.kind === 'rubbers' || model.kind === 'tries' || (model.kind === 'poisson' && model.ot > 0);

/**
 * The last minute a model can reach: 90 + 15·2 for football (90 for a model saved before extra time), 40 + 5·4 for
 * basketball (48 + 5·4 in the NBA), 60 + 10·3 for American football, 54 + 6·6 outs for baseball and 60 + 5 + 5 for ice
 * hockey (its shoot-out the second five).
 */
function lastMinute(model) {
  return hasOvertime(model) ? model.length + model.ot * model.maxOt : model.length;
}

function basketballAt(model, t, margin, chains) {
  const { pace, length, ot, maxOt } = model;
  const minute = clamp(t, 0, lastMinute(model));
  let remainingMinutes, periodsAfter, possessionSd;
  if (minute <= length) {
    remainingMinutes = length - minute;
    periodsAfter = maxOt;
    possessionSd = PACE_SD * remainingMinutes / length;
  } else {
    const period = Math.min(maxOt - 1, Math.ceil((minute - length) / ot) - 1);
    remainingMinutes = length + ot * (period + 1) - minute;
    periodsAfter = maxOt - period - 1;
    possessionSd = OVERTIME_PACE_SD * remainingMinutes / ot;
  }
  let chain = chains ? chains[periodsAfter] : undefined;
  if (chain === undefined) {
    chain = overtimeChance(model, periodsAfter);
    if (chains) chains[periodsAfter] = chain;
  }
  return basketballWinProbability({
    effA: model.effA, effD: model.effD, formSd: model.formSd, margin,
    remainingPossessions: pace * remainingMinutes / length, tieA: chain, possessionSd,
    buzzer: minute < length ? model.buzzer ?? BUZZER_LEVEL : [],
  });
}

/**
 * P(side A wins) at match minute `minute` with score difference `diff` (A − D goals or points), or null without a
 * valid model. Football: README formula with remaining (90 − t)/90, then extra time (footballAt). Basketball:
 * regulation, then each overtime period with its own remaining possessions; a level score at a period's end carries the
 * overtime chain.
 */
export function winProbabilityAt(model, minute, diff = 0) {
  if (!isLiveModel(model)) return null;
  const t = isNum(minute) ? num(minute) : 0;
  const lead = isNum(diff) ? num(diff) : 0;
  if (model.kind === 'normal') return basketballAt(model, t, lead);
  if (model.kind === 'drives') return drivesAt(model, t, lead);
  if (model.kind === 'innings') return inningsAt(model, t, lead);
  if (model.kind === 'periods') return periodsAt(model, t, lead);
  if (model.kind === 'tries') return triesAt(model, t, lead);
  if (model.kind === 'rubbers') {
    // Only the score is known here: the rubbers finished by minute t, none of the sets of the one in play.
    const played = Math.min(model.gaps.length, Math.floor(clamp(t, 0, lastMinute(model)) / model.ot));
    const a = clamp(Math.round((played + lead) / 2), 0, played), d = played - a;
    return rubbersAt(model, a, d);
  }
  return footballAt(model, t, lead);
}

/** 'A' | 'D' for a perspective given as a side or a team id (aId → 'A', dId → 'D'; anything else → 'A'). */
function sideOf(perspective, aId, dId) {
  if (perspective === 'A' || perspective === 'D') return perspective;
  if (perspective != null && perspective === dId && dId !== aId) return 'D';
  return 'A';
}

/**
 * DEC D6 chart perspective: the managed team's side if it plays this match, else the followed team's side if it
 * plays, else the attacker ('A'). → 'A' | 'D'.
 */
export function perspectiveSide({ aId, dId, managedId = null, followedId = null } = {}) {
  for (const id of [managedId, followedId]) {
    if (id == null) continue;
    if (id === aId) return 'A';
    if (id === dId) return 'D';
  }
  return 'A';
}

function winnerSideOf(final, aId, dId) {
  if (!final || typeof final !== 'object') return null;
  if (final.winnerSide === 'A' || final.winnerSide === 'D') return final.winnerSide;
  if (final.winnerId != null) {
    if (final.winnerId === aId) return 'A';
    if (dId == null || final.winnerId === dId) return 'D';
  }
  return null;
}

function revealedEvents(goals) {
  return (Array.isArray(goals) ? goals : []).filter(event => event && isNum(event.m));
}

/**
 * Last minute the revealed events reach, rounded up to the end of its period (basketball overtime, baseball's extra
 * innings), else the regulation length. American football's and ice hockey's overtime ends at its deciding score, the
 * last event.
 */
function endMinute(model, events) {
  const latest = events.reduce((max, event) => Math.max(max, num(event.m)), 0);
  if (!hasOvertime(model) || latest <= model.length) return model.length;
  if (model.kind === 'drives' || model.kind === 'periods' || model.kind === 'rubbers' || model.kind === 'tries') return Math.min(lastMinute(model), Math.ceil(latest));
  // Football's extra time ends at a golden goal, plays its whole thirty minutes without one (the silver goal's ends at a
  // half-time; the match's own end is in the minute the chart is given).
  if (model.kind === 'poisson' && model.sudden === 'golden') return Math.min(lastMinute(model), Math.ceil(latest));
  if (model.kind === 'poisson' && !model.sudden) return lastMinute(model);
  return Math.min(lastMinute(model), model.length + model.ot * Math.ceil((latest - model.length) / model.ot));
}

/**
 * Chart series: one point per integer minute t = 0…minute → [{ t, p }], p from the `perspective` side
 * ('A' | 'D', or a team id with `dId`). `goals` are the REVEALED events (`match.shown`: { m, tid, pts }); an event
 * counts from its own minute, `pts` (default 1) towards `aId` or the other side, so the difference always equals
 * the shown score. The series also reaches the latest revealed event, so the chart never lags the score.
 * `final` ({ winnerSide: 'A'|'D' } or { winnerId }) marks a finished match: the series runs to full time
 * (basketball: the end of the last overtime played) and its last point is 1 / 0 for the winner
 * (a football shoot-out winner included). Without a model → [].
 */
export function winSeries({ model, goals = [], aId, dId, minute = 0, perspective = 'A', final = null } = {}) {
  if (!isLiveModel(model)) return [];
  const events = revealedEvents(goals);
  const end = endMinute(model, events);
  const latest = events.reduce((max, event) => Math.max(max, Math.ceil(num(event.m))), 0);
  let upTo = Math.max(isNum(minute) ? num(minute) : 0, latest);
  if (final) upTo = Math.max(upTo, end);
  upTo = Math.floor(clamp(upTo, 0, lastMinute(model)));

  if (model.kind === 'rubbers') {
    const ordered = events.slice().sort((x, y) => num(x.m) - num(y.m));
    const series = [];
    for (let t = 0; t <= upTo; t++) {
      const { a, d, sa, sd } = rubberState(ordered, aId, t);
      series.push({ t, p: rubbersAt(model, a, d, sa, sd) });
    }
    const winner = winnerSideOf(final, aId, dId);
    if (winner && series.length) series[series.length - 1].p = winner === 'A' ? 1 : 0;
    if (sideOf(perspective, aId, dId) === 'D') for (const point of series) point.p = 1 - point.p;
    return series;
  }

  const delta = new Array(upTo + 1).fill(0);
  for (const event of events) {
    const at = Math.max(0, Math.ceil(num(event.m)));
    if (at > upTo) continue;
    const points = isNum(event.pts) ? num(event.pts) : 1;
    delta[at] += event.tid === aId ? points : -points;
  }

  const chains = [];
  const series = [];
  // Football's silver goal settles on the score at extra time's half-time.
  const extraHalf = model.kind === 'poisson' && model.ot > 0 ? model.length + model.ot : -1;
  let diff = 0, halfDiff = null;
  for (let t = 0; t <= upTo; t++) {
    diff += delta[t];
    if (t === extraHalf) halfDiff = diff;
    const p = model.kind === 'normal'
      ? basketballAt(model, t, diff, chains)
      : model.kind === 'drives' ? drivesAt(model, t, diff)
      : model.kind === 'innings' ? inningsAt(model, t, diff)
      : model.kind === 'periods' ? periodsAt(model, t, diff)
      : model.kind === 'tries' ? triesAt(model, t, diff)
      : footballAt(model, t, diff, halfDiff);
    series.push({ t, p });
  }
  const winner = winnerSideOf(final, aId, dId);
  if (winner && series.length) series[series.length - 1].p = winner === 'A' ? 1 : 0;
  if (sideOf(perspective, aId, dId) === 'D') for (const point of series) point.p = 1 - point.p;
  return series;
}

/**
 * Goal markers for the chart: one per revealed event up to the series' last minute, at the post-event value
 * (B§1.5.2) → [{ t, p, side: 'A'|'D' }]. Basketball scoring runs are omitted unless `includeRuns`.
 */
export function winMarkers(series, goals = [], { aId, model = null, includeRuns = false } = {}) {
  if (!Array.isArray(series) || !series.length) return [];
  if (model?.kind === 'normal' && !includeRuns) return [];
  const last = series[series.length - 1].t;
  return revealedEvents(goals)
    .map(event => ({ t: Math.max(0, Math.ceil(num(event.m))), side: event.tid === aId ? 'A' : 'D' }))
    .filter(marker => marker.t <= last)
    .map(marker => ({ ...marker, p: (series[marker.t] || series[series.length - 1]).p }));
}

/**
 * The chart's x-domain for a model at the current minute → { length, half, ticks, guides }.
 * Football: 0'…90', ticks every 15', half-time at 45', then extra time's halves once reached (105', 120'), with a guide at
 * 90'. Basketball: 0'…40' plus each overtime period reached,
 * ticks at the quarters and overtime ends, half-time at 20', quarter guides at 10'/20'/30' (NBA rules: 0'…48', the
 * quarters every 12'). American football the same over 0'…60' and its ten-minute overtimes. Baseball: 54 outs, a tick
 * at the end of every inning, extra innings included, and a guide after the third and the sixth. Ice hockey: 0'…60', a
 * tick and a guide at the end of each period, then the overtime and the shoot-out once reached. Tennis: the three
 * rubbers of the shortest tie, then the fourth and the fifth once reached, a tick and a guide at the end of each. Rugby
 * league: 0'…80', ticks every 20', half-time at 40', then each half of golden point reached.
 */
export function chartDomain(model, minute = 0) {
  if (isLiveModel(model) && model.kind === 'poisson') {
    const t = isNum(minute) ? num(minute) : 0;
    const extra = model.ot > 0 && t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const ticks = [0, 1, 2, 3, 4, 5, 6].map(i => (model.length * i) / 6);
    for (let k = 1; k <= extra; k++) ticks.push(model.length + k * model.ot);
    return { length: model.length + extra * model.ot, half: model.length / 2, ticks,
      guides: extra ? [model.length / 2, model.length] : [model.length / 2] };
  }
  if (isLiveModel(model) && model.kind === 'rubbers') {
    const t = isNum(minute) ? num(minute) : 0;
    const extra = t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const length = model.length + extra * model.ot;
    const ticks = [];
    for (let k = 0; k <= length; k += model.ot) ticks.push(k);
    return { length, half: model.length / 2, ticks, guides: ticks.slice(1, -1) };
  }
  if (isLiveModel(model) && model.kind === 'tries') {
    const t = isNum(minute) ? num(minute) : 0;
    const extra = t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const quarter = model.length / 4;
    const ticks = [0, quarter, 2 * quarter, 3 * quarter, model.length];
    for (let k = 1; k <= extra; k++) ticks.push(model.length + k * model.ot);
    return { length: model.length + extra * model.ot, half: model.length / 2, ticks, guides: [model.length / 2] };
  }
  if (isLiveModel(model) && model.kind === 'periods') {
    const t = isNum(minute) ? num(minute) : 0;
    const extra = t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const period = model.length / 3;
    const ticks = [0, period, 2 * period, model.length];
    for (let k = 1; k <= extra; k++) ticks.push(model.length + k * model.ot);
    return { length: model.length + extra * model.ot, half: model.length / 2, ticks, guides: [period, 2 * period] };
  }
  if (isLiveModel(model) && model.kind === 'innings') {
    const t = isNum(minute) ? num(minute) : 0;
    const extras = t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const length = model.length + extras * model.ot;
    const ticks = [];
    for (let k = 0; k <= length; k += model.ot) ticks.push(k);
    return { length, half: model.length / 2, ticks, guides: [model.length / 3, 2 * model.length / 3] };
  }
  if (isLiveModel(model) && hasOvertime(model)) {
    const t = isNum(minute) ? num(minute) : 0;
    const periods = t > model.length ? Math.min(model.maxOt, Math.ceil((t - model.length) / model.ot)) : 0;
    const quarter = model.length / 4;
    const ticks = [0, quarter, 2 * quarter, 3 * quarter, model.length];
    for (let k = 1; k <= periods; k++) ticks.push(model.length + k * model.ot);
    return { length: model.length + periods * model.ot, half: model.length / 2, ticks, guides: [quarter, 2 * quarter, 3 * quarter] };
  }
  const length = isLiveModel(model) ? model.length : 90;
  return { length, half: length / 2, ticks: [0, 1, 2, 3, 4, 5, 6].map(i => (length * i) / 6), guides: [length / 2] };
}

/**
 * SVG geometry for the chart's 800×132 viewBox (B§1.5.2): x = t/length·width, y = height − p·height, one decimal.
 * → { line: 'M…L…', area: line + 'L{nowX},{height}L{x0},{height}Z', now: { x, y }, markers: [{ x, y }], half: { x } }.
 * `markers` are [{ t, p }] (e.g. from winMarkers); `half` is the half-time minute (default length/2).
 */
export function chartGeometry(series, { width = 800, height = 132, length = 90, half = null, markers = [] } = {}) {
  const span = positive(length) || 90;
  const x = t => fixed((clamp(isNum(t) ? num(t) : 0, 0, span) / span) * width);
  const y = p => fixed(height - clamp01(isNum(p) ? num(p) : 0.5) * height);
  const points = (Array.isArray(series) ? series : []).filter(point => point && isNum(point.t)).map(({ t, p }) => ({ x: x(t), y: y(p) }));
  const line = points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join('');
  const area = points.length ? `${line}L${points[points.length - 1].x},${height}L${points[0].x},${height}Z` : '';
  return {
    line,
    area,
    now: points.length ? points[points.length - 1] : { x: 0, y: height / 2 },
    markers: (Array.isArray(markers) ? markers : []).filter(Boolean).map(({ t, p }) => ({ x: x(t), y: y(p) })),
    half: { x: x(isNum(half) ? num(half) : span / 2) },
  };
}

/**
 * Everything the live chart needs in one call → { series, p, domain, markers, geometry } (p = the current value,
 * null without a model). Same arguments as winSeries plus the geometry's width/height.
 */
export function liveWinChart({ model, goals = [], aId, dId, minute = 0, perspective = 'A', final = null, width = 800, height = 132, includeRuns = false } = {}) {
  const series = winSeries({ model, goals, aId, dId, minute, perspective, final });
  const last = series.length ? series[series.length - 1] : null;
  const domain = chartDomain(model, last ? last.t : minute);
  const markers = winMarkers(series, goals, { aId, model, includeRuns });
  return {
    series,
    p: last ? last.p : null,
    domain,
    markers,
    geometry: chartGeometry(series, { width, height, length: domain.length, half: domain.half, markers }),
  };
}
