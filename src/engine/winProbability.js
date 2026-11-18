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
//   only a first possession's field goal leaves an answer; both chains are exact too. College football
//   (src/sports/collegeFootball.js) plays the same chart under its own rules: its possessions, tries, edge scale and
//   form, and college overtime, whose chain is exact too (one toss, the first possession alternating; possessions from
//   the 25 in the first two periods, two-point plays from the third, a decisive two-point play after the last). An
//   earlier season's overtime is its day's: two-point tries from the third period and possessions in every one to 2018,
//   and two-point plays from the fifth in 2019 and 2020 (the model's `twoFrom` and `playsFrom`).
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
//   its last half a field goal decides (goldenRate, deciderOdds). A lead in golden point has already won. An earlier
//   season plays its own day's points and kicks (a try three points before 1983, a field goal two before 1971, its
//   penalty goals and field goals, `points`, `kicks`) and, before 2003, extra time's twenty-minute periods played in
//   full (`extra`: their slices played out as the game's last twenty minutes, a lead at a period's end has won, the last
//   one's level end left to the deciding field goal). Match-day form, which moves both try rates, is integrated over its
//   normal spread with seven-point Gauss–Hermite quadrature.
//
// Rugby union ("Rugby"; `code: 'union'`) — the same tables from its own model's slices (src/sports/rugbyUnion.js): a try
//   five points, seven converted at its own rate, a penalty goal and a drop goal three, its own score effects
//   (sliceMeans), and level after eighty its sudden-death extra time, whose first score wins and whose last quarter ends
//   with a drop goal (goldenRate, deciderOdds).
//
// Rocket League — exact, from the model's own games (src/sports/rocketLeague.js): a series is best of seven, each game won
//   with Elo's odds for the gap (gameOdds) and played in ten thirty-second slices at the rates that make it so (gameRates,
//   at an earlier season's goal rate where the model names one), with the sport's late game (sliceMeans) and sudden-death
//   overtime, whose first goal wins (overtimeOdds). The clock gives
//   each game twelve units, its ten slices and two for its overtime; the events are its goals (`pts` 0) and its end (`pts`
//   1), so the chart knows the games won and the score of the one in play: P(A wins) is that game's chance from its slice and
//   margin (gameTable), then the games left, exactly. Match-day form, one draw on every game's gap, is integrated over its
//   normal spread with seven-point Gauss–Hermite quadrature, each node weighed by how likely it made the games already won.
//
// Counter-Strike — exact, from the model's own maps (src/sports/counterStrike.js): a series is best of three, each map won
//   with Elo's odds for the gap (mapOdds) and played round by round at the strength that makes it so (strengthFor), each
//   round's odds moved toward the side that won the one before in its half (roundOdds), to 13 with overtimes of six from
//   12–12 (mapTable). The events are its rounds (`pts` 0) and each map's end (`pts` 1), so the chart knows every round
//   played: P(A wins) is the map in play's chance from its state (mapChance), then the maps left, exactly. Match-day form,
//   one draw on every map's gap, is integrated over its normal spread with seven-point Gauss–Hermite quadrature, each node
//   weighed by how likely it made every round played so far (roundsChance; a finished map with no rounds known, by its
//   winner alone).
//
// Valorant — exact at its events, from the model's own maps (src/sports/valorant.js): a series is best of three, each map
//   won with Elo's odds for the gap (its mapOdds) and played round by round at the edge that makes it so (mapBeta), with the
//   economy after each pistol round and the lean towards a round's winner (roundOdds). The events are the pistol rounds,
//   twelve all and each map's end, each with the map's rounds from its side, so the chart knows the maps won and the map in
//   play's score and economy at each event (mapTable), and holds that value until the next. Form as Rocket League's.
//
// League of Legends — from the model's own series (src/sports/leagueOfLegends.js): a series is best of five, each game won
//   with Elo's odds for the gap (gameOdds); its events tell the games won, and a game in play counts at its odds. Form as
//   Rocket League's.
//
// Constants mirror the private values in src/sports/football.js (BASE_GOALS, MAX_LOG_EDGE; extra time's FOOTBALL_MODEL); basketball's,
// American football's, baseball's, ice hockey's, tennis's and rugby league's come from their own modules (BASKETBALL_MODEL;
// DRIVE_MODEL, driveOdds, lateCall; INNING_MODEL, inningOdds, runMasses; PERIOD_MODEL, sliceMeans, overtimeMeans,
// shootoutOdds; RUBBER_MODEL, matchOdds, daySetChances, bestOfThree, bestOfFive; SLICE_MODEL, sliceMeans, goldenRate, deciderOdds). The tests compare this module against those models,
// so a change there that is not mirrored here fails loudly.

import { getSport } from '../sports/index.js';
import { FOOTBALL_MODEL } from '../sports/football.js';
import { BASKETBALL_MODEL } from '../sports/basketball.js';
import { collegeAnswer, collegeOvertimeOdds, collegeOvertimeOf, DRIVE_MODEL, driveMoments, driveOdds, lateCall } from '../sports/americanFootball.js';
import { INNING_MODEL, inningOdds, runMasses } from '../sports/baseball.js';
import { lateOf, overtimeMeans, PERIOD_MODEL, shootoutOdds, sliceMeans } from '../sports/hockey.js';
import { deciderOdds, extraSlice, goldenRate, POINTS, RULES_TODAY as RUGBY_TODAY, SLICE_MODEL, sliceMeans as rugbySliceMeans } from '../sports/rugbyLeague.js';
import { deciderOdds as unionDeciderOdds, goldenRate as unionGoldenRate, POINTS as UNION_POINTS, RULES_TODAY as UNION_TODAY,
  SLICE_MODEL as UNION_SLICE_MODEL, sliceMeans as unionSliceMeans } from '../sports/rugbyUnion.js';
import { bestOfFive, bestOfThree, daySetChances, matchOdds, RUBBER_MODEL } from '../sports/tennis.js';
import { chanceFrom, gameOdds, gameRates, gameTable, overtimeOdds, SERIES_MODEL } from '../sports/rocketLeague.js';
import { mapChance, mapOdds, mapState, mapTable, MAPS_MODEL, roundsChance, strengthFor } from '../sports/counterStrike.js';
import { chanceFrom as valorantChanceFrom, mapBeta as valorantBeta, mapOdds as valorantOdds, mapTable as valorantTable, ROUNDS_MODEL }
  from '../sports/valorant.js';
import { gameOdds as nexusOdds, GAMES_MODEL } from '../sports/leagueOfLegends.js';

const BASE_GOALS = 1.28;
const MAX_LOG_EDGE = 1.5;
const GOAL_CAP = 15;

const {
  SHOT_BASE: SHOT_VARIANCE_BASE, SHOT_PER_EFFICIENCY: SHOT_VARIANCE_PER_EFFICIENCY, PACE_SD, OVERTIME_PACE_SD,
  FORM_PER_DRAMA, DECISIVE_SLOPE, BUZZER_LEVEL,
} = BASKETBALL_MODEL;
const ROUNDING_VARIANCE = 1 / 6; // two independently rounded period scores, 1/12 each
const DEFAULT_DRAMA = 6;
// American football's overtime rules by season ('both' today's, a model without one's) and college football's:
// src/sports/americanFootball.js.
const OVERTIME_RULES = Object.freeze(['both', 'modified', 'sudden', 'college']);
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
 *     2009 or 'modified' 2010–2021, today's both-possess rule having none; college football's `overtime` 'college', and
 *     an earlier college season's `twoFrom` and `playsFrom`, the periods from which touchdowns go for two and two-point
 *     plays begin, playsFrom null for none)
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
 * | { kind:'tries', triesA, triesD, golden, formSd, length:80, ot:5, maxOt:4, points?, kicks?, extra? } (rugby league;
 *     tries a side in eighty minutes, `golden` the attacker's edge when a last field goal decides, formSd the spread of
 *     match-day form in log rate, and the "overtime periods" golden point's five-minute halves. An earlier season adds
 *     `points` [try, field goal] and `kicks` [penalty goals a side in eighty minutes, the late field goals' scale, open
 *     play's field goals]; before golden point `extra`: true, ot 20 and maxOt 3, extra time's periods)
 * | { kind:'series', gap, formSd, length:48, ot:12, maxOt:3, toWin:4, regulation:10, goals? } (Rocket League; gap is the
 *     attacker's rating points ahead in every game, formSd the spread of match-day form in rating points; the clock gives
 *     each game twelve units, ten of regulation, the fifth to seventh games extending the shortest series as overtime
 *     periods do; `goals` an earlier season's goal rate between equals, today's when absent)
 * | { kind:'maps', gap, formSd, length:52, ot:26, maxOt:1, toWin:2 } (Counter-Strike; gap is the attacker's rating points
 *     ahead in every map, formSd the spread of match-day form in rating points; the clock gives each map twenty-six units,
 *     a round each in regulation and two for its overtime, the third map extending the shortest series as an overtime
 *     period does)
 * | { kind:'rounds', gap, formSd, length:52, ot:26, maxOt:1, toWin:2 } (Valorant: its maps played round by round; gap and
 *     formSd as Rocket League's; the clock gives each map twenty-six units, its rounds and overtime, the third map extending
 *     the shortest series)
 * | { kind:'games', gap, formSd, length:36, ot:12, maxOt:2, toWin:3 } (League of Legends; the clock gives each game twelve
 *     units of four minutes, the fourth and fifth games extending the shortest series)
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
  // Valorant's maps and League of Legends' games: a series as Rocket League's, of their own games (before Rocket League's
  // branch: their prepared matches carry a `series` too).
  if ((prepared.rounds || prepared.nexus) && isNum(prepared.gap)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    const spec = prepared.rounds ? ROUNDS_MODEL : GAMES_MODEL;
    return { kind: prepared.rounds ? 'rounds' : 'games', gap: num(prepared.gap), formSd: spec.FORM_AT_BALANCED * (variation / 6) ** 2,
      length: spec.LENGTH, ot: spec.BLOCK, maxOt: (prepared.rounds ? spec.MAPS : spec.GAMES) - spec.TO_WIN, toWin: spec.TO_WIN };
  }
  if (prepared.series && isNum(prepared.gap)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'series', gap: num(prepared.gap), formSd: SERIES_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2,
      length: SERIES_MODEL.LENGTH, ot: SERIES_MODEL.BLOCK, maxOt: SERIES_MODEL.GAMES - SERIES_MODEL.TO_WIN,
      toWin: SERIES_MODEL.TO_WIN, regulation: SERIES_MODEL.SLICES,
      // An earlier season's goal rate; today's model names none.
      ...(isNum(prepared.goals) && num(prepared.goals) !== SERIES_MODEL.GOALS ? { goals: num(prepared.goals) } : {}),
    };
  }
  if (prepared.maps && isNum(prepared.gap)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'maps', gap: num(prepared.gap), formSd: MAPS_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2,
      length: MAPS_MODEL.LENGTH, ot: MAPS_MODEL.BLOCK, maxOt: MAPS_MODEL.MAPS - MAPS_MODEL.TO_WIN, toWin: MAPS_MODEL.TO_WIN,
    };
  }
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
  if (model.tieBreak === 'overtime' && positive(prepared.triesA) && positive(prepared.triesD) && prepared.code === 'union') {
    // Rugby union (src/sports/rugbyUnion.js): its own points, kicks and sudden-death extra time, one season's.
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'tries', code: 'union', triesA: num(prepared.triesA), triesD: num(prepared.triesD), golden: num(prepared.golden) || 0,
      formSd: UNION_SLICE_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2, length: UNION_SLICE_MODEL.MINUTES,
      ot: UNION_SLICE_MODEL.GOLDEN, maxOt: UNION_SLICE_MODEL.MAX_GOLDEN,
    };
  }
  if (model.tieBreak === 'overtime' && positive(prepared.triesA) && positive(prepared.triesD)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    // An earlier season's rules, carried on the prepared match (src/sports/rugbyLeague.js `rules`): its points, its kicks
    // and, before golden point, extra time. Today's add nothing, so the built-in season's model is as it always was.
    const rules = prepared.rules && prepared.rules !== RUGBY_TODAY ? prepared.rules : null;
    const extra = !!rules && !rules.golden;
    return {
      kind: 'tries', triesA: num(prepared.triesA), triesD: num(prepared.triesD), golden: num(prepared.golden) || 0,
      formSd: SLICE_MODEL.FORM_AT_BALANCED * (variation / 6) ** 2, length: SLICE_MODEL.MINUTES,
      ot: extra ? SLICE_MODEL.EXTRA : SLICE_MODEL.GOLDEN, maxOt: extra ? SLICE_MODEL.MAX_EXTRA : SLICE_MODEL.MAX_GOLDEN,
      ...(rules ? { points: [rules.tryPoints, rules.fieldGoalPoints], kicks: [rules.penalties, rules.fieldGoals, rules.openFieldGoals] } : {}),
      ...(extra ? { extra: true } : {}),
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
 * College overtime's chain, exact for its rules before form (src/sports/americanFootball.js collegeOvertime) → otChain:
 * [0] the decisive two-point play, [k] A's chance from level with k periods still to play. Each side's possession from the
 * 25 (`td`, `fg`, `none`, its tries `xp` and `two`) and its answers `behind` points down (`answer`: collegeAnswer's
 * odds). A period's first possession is the toss loser's in the first period, then alternates, so from level at a
 * period's start the chain takes either side first, each half the time: exactly so at full time, where the toss decides.
 * The overtime of the rules' day (collegeOvertimeOf): touchdowns go for two from period `twoFrom`, two-point plays from
 * period `playsFrom` (null: never); today's 2 and 3.
 */
function collegeChain(sideA, sideD, maxOt, decisive, twoFrom = 2, playsFrom = 3) {
  const chance = (period, first) => {
    const [x, y] = first === 'A' ? [sideA, sideD] : [sideD, sideA];
    let xWins, yWins, open;
    if (playsFrom !== null && period >= playsFrom) {
      xWins = x.two * (1 - y.two);
      yWins = (1 - x.two) * y.two;
      open = 1 - xWins - yWins;
    } else {
      const [level, fieldGoal, touchdown] = [0, 3, 6].map(behind => y.answer[behind]);
      // The first side's field goal (a touchdown wins the answer, a field goal draws level), or nothing (any score wins).
      xWins = x.fg * fieldGoal.none;
      yWins = x.fg * fieldGoal.td + x.none * (level.td + level.fg);
      open = x.fg * fieldGoal.fg + x.none * level.none;
      // Its touchdown: kicked (7, or 6 when missed), or two-point where the rules require it (8, or 6). The answer's
      // touchdown is kicked, or goes for two, to win against a 6 and to draw level against a 7 or an 8.
      const conversion = period >= twoFrom ? 'two' : 'xp';
      const made = x.td * x[conversion], missed = x.td * (1 - x[conversion]), answered = y[conversion];
      xWins += made * (1 - touchdown.td * answered) + missed * (1 - touchdown.td);
      yWins += missed * touchdown.td * answered;
      open += made * touchdown.td * answered + missed * touchdown.td * (1 - answered);
    }
    return [first === 'A' ? xWins : yWins, open];
  };
  const chain = [decisive];
  let after = { A: decisive, D: decisive };
  for (let period = maxOt; period >= 1; period--) {
    const here = {};
    for (const first of ['A', 'D']) {
      const [win, open] = chance(period, first);
      here[first] = win + open * after[first === 'A' ? 'D' : 'A'];
    }
    after = here;
    chain.push((here.A + here.D) / 2);
  }
  return chain;
}

/**
 * The live model of an American football match: a possession's mean and variance per side, how fast both move with
 * form, and the overtime chain, under the prepared match's rules (its season's: their safeties, tries, overtime and its
 * periods' length). A season whose overtime is not today's carries it (`overtime`). College football's rules (`overtime`
 * 'college') chart its own possessions, tries and edge scale, and college overtime (collegeChain): the model then carries
 * each side's overtime possession from the 25 (`tdA`, `fgA`) and its touchdown going for it a touchdown down (`tdLateA`).
 */
function drivesModel(prepared, variation, length) {
  const { DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, FORM_PER_DRAMA, SAFETY, DECISIVE_SLOPE } = DRIVE_MODEL;
  const { rules } = prepared;
  const safety = rules?.safety ?? SAFETY, overtime = rules?.overtime ?? 'both';
  if (overtime === 'college') return collegeDrivesModel(prepared, variation, length);
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
  const otChain = [1 / (1 + Math.exp(-DECISIVE_SLOPE * (prepared.edgeA - prepared.edgeD)))];
  for (let k = 1; k <= MAX_OVERTIMES; k++) otChain.push(win + open * otChain[k - 1]);
  return {
    kind: 'drives', drives: num(prepared.drives) || DRIVES, muA: a.mean, muD: d.mean, varA: a.variance, varD: d.variance, slope,
    formSd: variation * (rules?.form ?? FORM_PER_DRAMA), driveSd: DRIVE_SD, length, ot: rules?.ot ?? OVERTIME, maxOt: MAX_OVERTIMES,
    otChain,
    tdA: sideA.td, fgA: sideA.fg, xpA: sideA.xp, twoA: sideA.two, tdD: sideD.td, fgD: sideD.fg, xpD: sideD.xp, twoD: sideD.two,
    ...(overtime === 'both' ? {} : { overtime }),
  };
}

/**
 * The live model of a college football match (drivesModel under `rules.overtime` 'college'): regulation as American
 * football's, under the college rules' possessions, tries, safeties, edge scale and form; overtime by collegeChain, before
 * form, with `maxOvertimes` periods of `ot` minutes and the decisive two-point play's odds (logistic of the edge gap
 * times DECISIVE_SLOPE and the rules' scale). An earlier season whose overtime is not today's carries its periods
 * (`twoFrom`, `playsFrom`: collegeOvertimeOf; null `playsFrom` for none).
 */
function collegeDrivesModel(prepared, variation, length) {
  const { DRIVE_SD, FORM_PER_DRAMA, DECISIVE_SLOPE } = DRIVE_MODEL;
  const { rules } = prepared;
  const { twoFrom, playsFrom } = collegeOvertimeOf(rules);
  const today = twoFrom === 2 && playsFrom === 3;
  const outcomes = odds => {
    const fg = (1 - odds.td) * odds.fgTry * odds.make;
    return { td: odds.td, fg, none: 1 - odds.td - fg, xp: odds.xp, two: odds.two };
  };
  const side = odds => ({ ...outcomes(odds), answer: Object.fromEntries([0, 3, 6].map(behind => [behind, outcomes(collegeAnswer(odds, behind))])) });
  const meanAt = (edge, kicking) => driveMoments(driveOdds(edge, kicking, rules), rules).mean;
  const a = driveMoments(driveOdds(prepared.edgeA, prepared.kickingA, rules), rules);
  const d = driveMoments(driveOdds(prepared.edgeD, prepared.kickingD, rules), rules);
  const slope = (meanAt(prepared.edgeA + 1, prepared.kickingA) - meanAt(prepared.edgeA - 1, prepared.kickingA)) / 2
    + (meanAt(prepared.edgeD + 1, prepared.kickingD) - meanAt(prepared.edgeD - 1, prepared.kickingD)) / 2;
  const sideA = side(collegeOvertimeOdds(prepared.edgeA, prepared.kickingA, rules));
  const sideD = side(collegeOvertimeOdds(prepared.edgeD, prepared.kickingD, rules));
  const decisive = 1 / (1 + Math.exp(-DECISIVE_SLOPE * (rules.scale ?? 1) * (prepared.edgeA - prepared.edgeD)));
  return {
    kind: 'drives', drives: num(prepared.drives), muA: a.mean, muD: d.mean, varA: a.variance, varD: d.variance, slope,
    formSd: variation * (rules.form ?? FORM_PER_DRAMA), driveSd: DRIVE_SD, length, ot: rules.ot, maxOt: rules.maxOvertimes,
    otChain: collegeChain(sideA, sideD, rules.maxOvertimes, decisive, twoFrom, playsFrom),
    tdA: sideA.td, fgA: sideA.fg, xpA: sideA.xp, twoA: sideA.two, tdD: sideD.td, fgD: sideD.fg, xpD: sideD.xp, twoD: sideD.two,
    tdLateA: sideA.answer[6].td, tdLateD: sideD.answer[6].td, overtime: 'college',
    ...(today ? {} : { twoFrom, playsFrom }),
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
    const tries = ['xpA', 'twoA', 'xpD', 'twoD', 'tdLateA', 'tdLateD'].filter(key => model[key] !== undefined);
    // An earlier college season's overtime periods come together (two from `twoFrom`, two-point plays from `playsFrom`,
    // null for none); a model without them plays today's.
    const era = ['twoFrom', 'playsFrom'].filter(key => model[key] !== undefined);
    return ['drives', 'muA', 'muD', 'varA', 'varD', 'slope', 'formSd', 'driveSd', 'length', 'ot', 'tdA', 'fgA', 'tdD', 'fgD', ...tries].every(finite)
      && ['tdA', 'fgA', 'tdD', 'fgD', ...tries].every(key => model[key] >= 0 && model[key] <= 1)
      && model.drives > 0 && model.muA >= 0 && model.muD >= 0 && model.varA >= 0 && model.varD >= 0 && model.formSd >= 0
      && model.driveSd >= 0 && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0
      && Array.isArray(model.otChain) && model.otChain.length === model.maxOt + 1
      && model.otChain.every(p => typeof p === 'number' && p >= 0 && p <= 1)
      && (model.overtime === undefined || OVERTIME_RULES.includes(model.overtime))
      && (era.length === 0 || (era.length === 2 && model.overtime === 'college' && Number.isInteger(model.twoFrom) && model.twoFrom >= 1
        && (model.playsFrom === null || (Number.isInteger(model.playsFrom) && model.playsFrom > model.twoFrom))));
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
    // An earlier season's points and kicks come together; extra time only with them. A model without them plays today's.
    const era = ['points', 'kicks'].filter(key => model[key] !== undefined);
    return ['triesA', 'triesD', 'golden', 'formSd', 'length', 'ot'].every(finite) && model.triesA > 0 && model.triesD > 0
      && model.formSd >= 0 && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 1
      && (era.length === 0 || (era.length === 2 && Array.isArray(model.points) && model.points.length === 2
        && model.points.every(value => Number.isInteger(value) && value >= 1 && value <= 4)
        && Array.isArray(model.kicks) && model.kicks.length === 3
        && model.kicks.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) && model.kicks[1] <= 1))
      && (model.extra === undefined || (model.extra === true && era.length === 2))
      // Rugby union's model is one season's: no era of its own.
      && (model.code === undefined || (model.code === 'union' && era.length === 0 && model.extra === undefined));
  }
  if (model.kind === 'series') {
    return ['gap', 'formSd', 'length', 'ot'].every(finite) && model.formSd >= 0 && model.length > 0 && model.ot > 0
      && Number.isInteger(model.maxOt) && model.maxOt >= 0 && Number.isInteger(model.toWin) && model.toWin >= 1
      && Number.isInteger(model.regulation) && model.regulation >= 1 && model.regulation < model.ot
      && (model.goals === undefined || (finite('goals') && model.goals > 0));
  }
  if (model.kind === 'maps' || model.kind === 'rounds' || model.kind === 'games') {
    return ['gap', 'formSd', 'length', 'ot'].every(finite) && model.formSd >= 0 && model.length > 0 && model.ot > 0
      && Number.isInteger(model.maxOt) && model.maxOt >= 0 && Number.isInteger(model.toWin) && model.toWin >= 1;
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
  if (model.overtime === 'college') return collegeLeadAt(model, period, margin);
  if (model.overtime === 'sudden' || (model.overtime === 'modified' && Math.abs(margin) !== 3)) return step(margin, level);
  const [td, fg, xp = 1, two = 0] = margin > 0 ? [model.tdD, model.fgD, model.xpD, model.twoD] : [model.tdA, model.fgA, model.xpA, model.twoA];
  const lead = Math.abs(margin);
  const levelled = margin > 0 ? 1 - level : level;
  const trailer = lead > 8 ? 0 : lead === 8 ? td * two * levelled : lead === 7 ? td * xp * levelled
    : lead === 6 ? td * (xp + (1 - xp) * levelled) : lead > 3 ? td : lead === 3 ? td + fg * levelled : td + fg;
  return margin > 0 ? clamp01(1 - trailer) : clamp01(trailer);
}

/**
 * A lead in college overtime's period `period` (0 the first), charted as the trailing side's one answer in it, which
 * levelled leaves the next period's chain (the decisive play after the last). In a period of possessions: a touchdown
 * wins against up to 5 and, kicked or with two points where the rules require them (today's from the second period),
 * against 6; kicked, it levels 7, with two points 8 (going for it a touchdown down, `tdLate`); a field goal wins against
 * 1 or 2 and levels 3. In a period of two-point plays (today's from the third; an earlier season's `playsFrom`, none to
 * 2018), a two-point play levels 2.
 */
function collegeLeadAt(model, period, margin) {
  const lead = Math.abs(margin);
  const [td, fg, xp, two, tdLate] = margin > 0 ? [model.tdD, model.fgD, model.xpD, model.twoD, model.tdLateD]
    : [model.tdA, model.fgA, model.xpA, model.twoA, model.tdLateA];
  const next = model.otChain[model.maxOt - period - 1];
  const levelled = margin > 0 ? 1 - next : next;
  const { twoFrom = 2, playsFrom = 3 } = model;
  const conversion = period + 1 >= twoFrom ? two : xp;
  const trailer = playsFrom !== null && period + 1 >= playsFrom ? (lead === 2 ? two * levelled : 0)
    : lead > 8 ? 0 : lead === 8 ? tdLate * two * levelled : lead === 7 ? tdLate * xp * levelled
      : lead === 6 ? tdLate * (conversion + (1 - conversion) * levelled) : lead > 3 ? tdLate : lead === 3 ? td + fg * levelled : td + fg;
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

/**
 * The two rugby codes' slice models: rugby league's (a model with no `code`) and rugby union's (`code: 'union'`), each its
 * own score effects, points, conversion rate, sudden-death rate and last kick.
 */
const RUGBY_CODES = Object.freeze({
  league: Object.freeze({ sliceMeans: rugbySliceMeans, goldenRate, deciderOdds, points: POINTS, conversion: SLICE_MODEL.CONVERSION_RATE, today: RUGBY_TODAY }),
  union: Object.freeze({ sliceMeans: unionSliceMeans, goldenRate: unionGoldenRate, deciderOdds: unionDeciderOdds, points: UNION_POINTS,
    conversion: UNION_SLICE_MODEL.CONVERSION_RATE, today: UNION_TODAY }),
});
const rugbyCode = model => (model.code === 'union' ? RUGBY_CODES.union : RUGBY_CODES.league);

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
 * (two), its open play's field goals (none today) and its late field goal (one, with its chance), the means scaled by
 * `left`, the share of the slice still to play. A try and a field goal count at `rules`' points: a try three before 1983,
 * a field goal two before 1971.
 */
function slicePoints({ tries, penalties, fieldGoals, open = 0 }, left, rules = RUGBY_TODAY, code = RUGBY_CODES.league) {
  const points = new Array(SLICE_POINTS + 1).fill(0);
  const tryMasses = poissonMasses(tries * left, 8), penaltyMasses = poissonMasses(penalties * left, 6);
  const openMasses = open > 0 ? poissonMasses(open * left, 4) : [1];
  const convert = code.conversion, field = clamp01(fieldGoals * left), kick = rules.fieldGoalPoints;
  for (let k = 0; k < tryMasses.length; k++) {
    if (!tryMasses[k]) continue;
    // k tries, c of them converted: Binomial(k, convert).
    let binomial = (1 - convert) ** k;
    for (let c = 0; c <= k; c++) {
      const fromTries = rules.tryPoints * k + code.points.CONVERSION * c;
      for (let j = 0; j < penaltyMasses.length; j++) {
        for (let o = 0; o < openMasses.length; o++) {
          const base = tryMasses[k] * binomial * penaltyMasses[j] * openMasses[o];
          const at = fromTries + code.points.PENALTY_GOAL * j + kick * o;
          points[Math.min(SLICE_POINTS, at)] += base * (1 - field);
          points[Math.min(SLICE_POINTS, at + kick)] += base * field;
        }
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

/** A rugby league model's rules: an earlier season's points and kicks (`points`, `kicks`, `extra`), else today's. */
function rugbyRules(model) {
  if (!model.points) return rugbyCode(model).today;
  const [tryPoints, fieldGoalPoints] = model.points, [penalties, fieldGoals, openFieldGoals] = model.kicks;
  return { ...RUGBY_TODAY, tryPoints, fieldGoalPoints, penalties, fieldGoals, openFieldGoals, golden: !model.extra };
}

/**
 * A rugby league model's tables, built once per model: for each form node its two try rates and `from[s][margin]`, A's
 * chance at the start of slice s (`from[SLICES]` at the end of regulation, level meaning golden point). Before golden
 * point, extra time's slices follow (`model.extra`): each period's from[SLICES + 4k], at its start, holds a lead as won,
 * and the last one's end leaves a level game to the deciding field goal. Margin distributions are cached by the slice's
 * means, which the score effects change only near level and late on.
 */
function rugbyTables(model) {
  if (tryTables.has(model)) return tryTables.get(model);
  const { SLICES, EXTRA_SLICES } = SLICE_MODEL;
  const rules = rugbyRules(model), code = rugbyCode(model);
  const decider = code.deciderOdds(model.golden);
  const end = SLICES + (model.extra ? EXTRA_SLICES * model.maxOt : 0);
  const margins = fill => Array.from({ length: 2 * POINTS_CAP + 1 }, (_, i) => fill(i - POINTS_CAP));
  const nodes = HERMITE.map(([t, weight]) => {
    const form = Math.exp(t * model.formSd);
    const triesA = model.triesA * form, triesD = model.triesD / form;
    const node = { weight, triesA, triesD, goldenA: code.goldenRate(triesA), goldenD: code.goldenRate(triesD), decider, rules, code, from: new Array(end + 1),
      deltas: new Map() };
    node.from[end] = margins(margin => step(margin, model.extra ? decider : goldenChance(node, model.maxOt, 1)));
    for (let s = end - 1; s >= SLICES; s--) {
      // A period of extra time starts only from level: a lead at its start has won.
      const start = (s - SLICES) % EXTRA_SLICES === 0;
      node.from[s] = margins(margin => (start && margin ? step(margin, 0.5) : tryChance(node, s, margin, 1)));
    }
    for (let s = SLICES - 1; s >= 0; s--) node.from[s] = margins(margin => tryChance(node, s, margin, 1));
    return node;
  });
  const tables = { nodes, cache: new Map() };
  tryTables.set(model, tables);
  return tables;
}

/**
 * A's chance in `node` from `margin` with `left` (a share) of slice s to play, then the slices after it; extra time's
 * slices (s ≥ SLICES) play a game's last twenty minutes' score effects (`extraSlice`).
 */
function tryChance(node, s, margin, left) {
  const { SLICES, EXTRA_SLICES } = SLICE_MODEL;
  const at = s < SLICES ? s : extraSlice((s - SLICES) % EXTRA_SLICES);
  const a = node.code.sliceMeans(node.triesA, margin, at, node.rules), d = node.code.sliceMeans(node.triesD, -margin, at, node.rules);
  const key = `${at}|${left}|${a.tries}|${a.penalties}|${a.fieldGoals}|${a.open}|${d.tries}|${d.penalties}|${d.fieldGoals}|${d.open}`;
  let delta = node.deltas.get(key);
  if (!delta) {
    delta = marginMasses(slicePoints(a, left, node.rules, node.code), slicePoints(d, left, node.rules, node.code));
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
  const { SLICE, SLICES, EXTRA } = SLICE_MODEL;
  const minute = clamp(t, 0, lastMinute(model));
  const lead = clamp(Math.round(margin), -POINTS_CAP, POINTS_CAP);
  const { nodes, cache } = rugbyTables(model);
  const key = `${minute}|${lead}`;
  if (cache.has(key)) return cache.get(key);
  let chance;
  if (minute >= model.length && model.extra) {
    // Extra time, played in full: a lead at full time, or at the end of a period, has won; within one, play it out.
    const played = minute - model.length;
    if (lead && played % EXTRA === 0) chance = step(lead, 0.5);
    else if (minute >= lastMinute(model)) chance = step(lead, nodes[0].decider);
    else {
      const k = Math.floor(played / SLICE), left = (SLICE * (k + 1) - played) / SLICE;
      chance = nodes.reduce((sum, node) => sum + node.weight * tryChance(node, SLICES + k, lead, left), 0);
    }
  } else if (minute >= model.length) {
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

const seriesCache = new WeakMap();

/**
 * A Rocket League model's tables, built once per model: for each form node, the attacker's odds in every game (`p`), the
 * game's table of chances by slice and margin and its overtime's odds. Also a cache of computed values by state.
 */
function seriesTables(model) {
  if (seriesCache.has(model)) return seriesCache.get(model);
  const nodes = HERMITE.map(([t, weight]) => {
    const p = gameOdds(model.gap + t * model.formSd);
    const [rateA, rateD] = gameRates(p, model.goals ?? SERIES_MODEL.GOALS);
    return { weight, p, table: gameTable(rateA, rateD), level: overtimeOdds(rateA, rateD) };
  });
  const tables = { nodes, cache: new Map() };
  seriesCache.set(model, tables);
  return tables;
}

/** A's chance to take the series from games `a`–`d`, winning each with `p`: the x games he needs before D takes y. */
function seriesFrom(p, a, d, toWin) {
  if (a >= toWin) return 1;
  if (d >= toWin) return 0;
  const x = toWin - a, y = toWin - d;
  let chance = 0, ways = 1;
  for (let j = 0; j < y; j++) {
    chance += ways * p ** x * (1 - p) ** j;
    ways = ways * (x + j) / (j + 1);
  }
  return chance;
}

/**
 * Rocket League: P(side A wins) with games `a`–`d` won and the game in play `margin` goals apart, `unit` clock units
 * into it (its slices played; from `regulation` on, overtime), averaged over the form nodes, each weighed by its prior and
 * by how likely it made the games already won.
 */
function seriesAt(model, a, d, margin = 0, unit = 0) {
  if (a >= model.toWin) return 1;
  if (d >= model.toWin) return 0;
  const { nodes, cache } = seriesTables(model);
  const at = clamp(Math.floor(unit), 0, model.regulation);
  const key = `${a}|${d}|${margin}|${at}`;
  if (cache.has(key)) return cache.get(key);
  let chance = 0, total = 0;
  for (const node of nodes) {
    const likely = node.weight * node.p ** a * (1 - node.p) ** d;
    const q = at >= model.regulation ? step(margin, node.level) : chanceFrom(node.table, at, margin);
    chance += likely * (q * seriesFrom(node.p, a + 1, d, model.toWin) + (1 - q) * seriesFrom(node.p, a, d + 1, model.toWin));
    total += likely;
  }
  const value = clamp01(total > 0 ? chance / total : 0.5);
  cache.set(key, value);
  return value;
}

/**
 * The series' state after the revealed events up to minute `t` → { a, d, margin, unit }: a `pts` 1 event ends a game for
 * its side, a goal (`pts` 0) moves the margin of the game in play, and `unit` is how far into that game's block `t` is.
 */
function seriesState(events, aId, t, block) {
  let a = 0, d = 0, margin = 0;
  for (const event of events) {
    if (Math.ceil(num(event.m)) > t) continue;
    const own = event.tid === aId;
    if ((isNum(event.pts) ? num(event.pts) : 1) > 0) {
      if (own) a++; else d++;
      margin = 0;
    } else margin += own ? 1 : -1;
  }
  return { a, d, margin, unit: Math.max(0, t - (a + d) * block) };
}

const mapsCache = new WeakMap();

/**
 * A Counter-Strike model's tables, built once per model: for each form node, the attacker's odds in every map (`p`) and the
 * map's table of chances by state at the round strength that gives them. Also a cache of computed values by state.
 */
function mapsTables(model) {
  if (mapsCache.has(model)) return mapsCache.get(model);
  const nodes = HERMITE.map(([t, weight]) => {
    const p = mapOdds(model.gap + t * model.formSd);
    return { weight, p, table: mapTable(strengthFor(p)) };
  });
  const tables = { nodes, cache: new Map() };
  mapsCache.set(model, tables);
  return tables;
}

/**
 * Counter-Strike: P(side A wins) with maps `a`–`d` won (`done`: each finished map's { rounds, winner }, its rounds 'A' or
 * 'D' in order, none when only its winner is known) and the map in play at `current` (its rounds so far), averaged over
 * the form nodes, each weighed by its prior and by how likely it made everything played so far.
 */
function mapsAt(model, a, d, done = [], current = []) {
  if (a >= model.toWin) return 1;
  if (d >= model.toWin) return 0;
  const { nodes, cache } = mapsTables(model);
  const key = `${a}|${d}|${done.map(map => map.rounds.length ? map.rounds.join('') : map.winner.toLowerCase()).join('/')}|${current.join('')}`;
  if (cache.has(key)) return cache.get(key);
  const state = mapState(current);
  let chance = 0, total = 0;
  for (const node of nodes) {
    let likely = node.weight * roundsChance(node.table, current);
    for (const map of done) likely *= map.rounds.length ? roundsChance(node.table, map.rounds) : map.winner === 'A' ? node.p : 1 - node.p;
    const q = mapChance(node.table, state);
    chance += likely * (q * seriesFrom(node.p, a + 1, d, model.toWin) + (1 - q) * seriesFrom(node.p, a, d + 1, model.toWin));
    total += likely;
  }
  const value = clamp01(total > 0 ? chance / total : 0.5);
  cache.set(key, value);
  return value;
}

/**
 * The series' state after the revealed events up to minute `t` → { a, d, done, current }: a `pts` 1 event ends a map for
 * its side, and a round (`pts` 0) is its side's, in the map in play.
 */
function mapsProgress(events, aId, t) {
  let a = 0, d = 0, current = [];
  const done = [];
  for (const event of events) {
    if (Math.ceil(num(event.m)) > t) continue;
    const side = event.tid === aId ? 'A' : 'D';
    if ((isNum(event.pts) ? num(event.pts) : 1) > 0) {
      if (side === 'A') a++; else d++;
      done.push({ rounds: current, winner: side });
      current = [];
    } else current.push(side);
  }
  return { a, d, done, current };
}

const esportsCache = new WeakMap();

/**
 * A Valorant or League of Legends model's tables, built once per model: for each form node, the attacker's odds in every
 * map or game (`p`) and, for Valorant, the map's table of chances by score and economy. Also a cache by state.
 */
function esportsTables(model) {
  if (esportsCache.has(model)) return esportsCache.get(model);
  const nodes = HERMITE.map(([t, weight]) => {
    const gap = model.gap + t * model.formSd;
    if (model.kind === 'games') return { weight, p: nexusOdds(gap), table: null };
    const p = valorantOdds(gap);
    return { weight, p, table: valorantTable(valorantBeta(p)) };
  });
  const tables = { nodes, cache: new Map() };
  esportsCache.set(model, tables);
  return tables;
}

/**
 * Valorant or League of Legends: P(side A wins) with maps or games `a`–`d` won and, for Valorant, the map in play at
 * `state` ({ ra, rd, prev1 }: its rounds from A's side and the last round's winner, 'A' or 'D', when that round was a pistol
 * round), averaged over the form nodes, each weighed by its prior and by how likely it made the maps or games already won.
 */
function esportsAt(model, a, d, state = null) {
  if (a >= model.toWin) return 1;
  if (d >= model.toWin) return 0;
  const { nodes, cache } = esportsTables(model);
  const key = state ? `${a}|${d}|${state.ra}|${state.rd}|${state.prev1 ?? ''}` : `${a}|${d}`;
  if (cache.has(key)) return cache.get(key);
  let chance = 0, total = 0;
  for (const node of nodes) {
    const likely = node.weight * node.p ** a * (1 - node.p) ** d;
    const q = state && node.table ? valorantChanceFrom(node.table, state.ra, state.rd, state.prev1 ?? null, null) : node.p;
    chance += likely * (q * seriesFrom(node.p, a + 1, d, model.toWin) + (1 - q) * seriesFrom(node.p, a, d + 1, model.toWin));
    total += likely;
  }
  const value = clamp01(total > 0 ? chance / total : 0.5);
  cache.set(key, value);
  return value;
}

/**
 * A Valorant or League of Legends series' state after the revealed events up to minute `t` → { a, d, state }: a `pts` 1
 * event ends a map or game for its side; within Valorant's map in play, the latest event gives its rounds from its own side
 * (`own`, `opp`) and, after a pistol round, that round's winner (the next round's economy). Null `state` for a map not yet
 * reported on, or for League of Legends.
 */
function esportsState(events, aId, t) {
  let a = 0, d = 0, state = null;
  for (const event of events) {
    if (Math.ceil(num(event.m)) > t) continue;
    const own = event.tid === aId;
    if ((isNum(event.pts) ? num(event.pts) : 1) > 0) {
      if (own) a++; else d++;
      state = null;
    } else if (isNum(event.own) && isNum(event.opp)) {
      state = { ra: own ? num(event.own) : num(event.opp), rd: own ? num(event.opp) : num(event.own),
        prev1: event.kind === 'pistol' ? (own ? 'A' : 'D') : null };
    }
  }
  return { a, d, state };
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
  || model.kind === 'rubbers' || model.kind === 'series' || model.kind === 'maps' || model.kind === 'rounds' || model.kind === 'games' || model.kind === 'tries'
  || (model.kind === 'poisson' && model.ot > 0);

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
  if (model.kind === 'series') {
    // Only the score is known here: the games finished by minute t, none of the goals of the one in play.
    const played = Math.min(model.toWin + model.maxOt, Math.floor(clamp(t, 0, lastMinute(model)) / model.ot));
    const a = clamp(Math.round((played + lead) / 2), 0, played), d = played - a;
    return seriesAt(model, a, d);
  }
  if (model.kind === 'maps') {
    // Only the score is known here: the maps finished by minute t, none of the rounds of the one in play.
    const played = Math.min(model.toWin + model.maxOt, Math.floor(clamp(t, 0, lastMinute(model)) / model.ot));
    const a = clamp(Math.round((played + lead) / 2), 0, played), d = played - a;
    const done = [...Array(a).fill({ rounds: [], winner: 'A' }), ...Array(d).fill({ rounds: [], winner: 'D' })];
    return mapsAt(model, a, d, done);
  }
  if (model.kind === 'rounds' || model.kind === 'games') {
    // Only the score is known here: the maps or games finished by minute t, nothing of the one in play.
    const played = Math.min(model.toWin + model.maxOt, Math.floor(clamp(t, 0, lastMinute(model)) / model.ot));
    const a = clamp(Math.round((played + lead) / 2), 0, played), d = played - a;
    return esportsAt(model, a, d);
  }
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
  // Rugby league's extra time before golden point is played in full, as basketball's overtime is (below).
  if (model.kind === 'drives' || model.kind === 'periods' || model.kind === 'rubbers' || model.kind === 'series'
    || model.kind === 'maps' || model.kind === 'rounds' || model.kind === 'games'
    || (model.kind === 'tries' && !model.extra)) {
    return Math.min(lastMinute(model), Math.ceil(latest));
  }
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

  if (model.kind === 'series') {
    const ordered = events.slice().sort((x, y) => num(x.m) - num(y.m));
    const series = [];
    for (let t = 0; t <= upTo; t++) {
      const { a, d, margin, unit } = seriesState(ordered, aId, t, model.ot);
      series.push({ t, p: seriesAt(model, a, d, margin, unit) });
    }
    const winner = winnerSideOf(final, aId, dId);
    if (winner && series.length) series[series.length - 1].p = winner === 'A' ? 1 : 0;
    if (sideOf(perspective, aId, dId) === 'D') for (const point of series) point.p = 1 - point.p;
    return series;
  }

  if (model.kind === 'maps') {
    const ordered = events.slice().sort((x, y) => num(x.m) - num(y.m));
    const series = [];
    for (let t = 0; t <= upTo; t++) {
      const { a, d, done, current } = mapsProgress(ordered, aId, t);
      series.push({ t, p: mapsAt(model, a, d, done, current) });
    }
    const winner = winnerSideOf(final, aId, dId);
    if (winner && series.length) series[series.length - 1].p = winner === 'A' ? 1 : 0;
    if (sideOf(perspective, aId, dId) === 'D') for (const point of series) point.p = 1 - point.p;
    return series;
  }

  if (model.kind === 'rounds' || model.kind === 'games') {
    const ordered = events.slice().sort((x, y) => num(x.m) - num(y.m));
    const series = [];
    for (let t = 0; t <= upTo; t++) {
      const { a, d, state } = esportsState(ordered, aId, t);
      series.push({ t, p: esportsAt(model, a, d, model.kind === 'rounds' ? state : null) });
    }
    const winner = winnerSideOf(final, aId, dId);
    if (winner && series.length) series[series.length - 1].p = winner === 'A' ? 1 : 0;
    if (sideOf(perspective, aId, dId) === 'D') for (const point of series) point.p = 1 - point.p;
    return series;
  }

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
 * rubbers of the shortest tie, then the fourth and the fifth once reached, a tick and a guide at the end of each; Rocket
 * League the same with the four games of the shortest series, then the fifth to seventh. Rugby league: 0'…80', ticks
 * every 20', half-time at 40', then each half of golden point reached, or each period of extra time (an earlier season's
 * before 2003).
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
  if (isLiveModel(model) && (model.kind === 'rubbers' || model.kind === 'series' || model.kind === 'maps' || model.kind === 'rounds'
    || model.kind === 'games')) {
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
