// Owner: WP-MATCH (see PLAN.md §4). Live win-probability model (PLAN §3.7, DEC D6).
//
// Pure functions. Nothing here reads or advances any random generator (campaign or display), touches the DOM,
// or mutates its inputs; every value is recomputed from plain numbers, so it is safe to call from render.
//
// Football — README §B "Win probability per minute", exactly:
//   rate(l) = 1.28·exp(1.5·tanh(l/1.5)); rA = rate(logA), rD = rate(logD) where logA/logD come from the repo's
//   prepareFootballMatch(attacker, defender, effA, effD) called with the MATCH's own effA/effD (tactics included).
//   With r = (90 − t)/90 the goals still to come are Poisson(rA·r) and Poisson(rD·r);
//   P(A wins) = P(final goal difference > 0) + ½·P(level)   (the shoot-out is a 50/50).
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
//   (± 1.1), each worth 7 (a touchdown), 3 (a field goal) or 0 with the drive odds of its edge (its offence minus the
//   opposing defence). Over R remaining possessions a side the margin is ≈ Normal(R·(μA − μD), R·(σA² + σD²)
//   + (R·slope·formSd)² + (μA − μD)²·σ_R² + 1/6), where slope is how much both sides' means move per rating point of
//   match-day form; P(A wins) = P(margin ≥ 1) + P(margin = 0)·P(A wins from level). The overtime chain (both sides
//   possess once, then the next score wins; the last period ends in a decisive field goal) is exact for the model's
//   drive odds, before form. In overtime a lead is charted as the trailing side's one possession to answer it.
//   Late-game play-calling (each side's last three possessions follow the score) is left out: it narrows the final
//   margin far more than it moves who wins.
//
// Baseball — the model's own distributions (src/sports/baseball.js): the clock counts outs (three a half-inning, 54 in
//   nine innings), and each half-inning's runs follow the model's distribution for the batting side's edge
//   (runMasses). The runs still to come are the convolution of the half-innings left, the one in progress with its
//   chance to score scaled by the outs it has left (the one approximation); P(A wins) = P(final margin ≥ 1) +
//   P(level)·P(A wins the extra innings), where the extra innings (a runner on second, at most six, then a decisive
//   run) are an exact chain. Neither the unplayed bottom of the ninth nor a walk-off changes who wins, so the full nine
//   are counted. Match-day form, which moves both edges, is integrated over its normal spread with seven-point
//   Gauss–Hermite quadrature.
//
// Constants mirror the private values in src/sports/football.js (BASE_GOALS, MAX_LOG_EDGE); basketball's,
// American football's and baseball's come from their own modules (BASKETBALL_MODEL; DRIVE_MODEL, driveOdds;
// INNING_MODEL, inningOdds, runMasses). The tests compare this module against those models, so a change there that is
// not mirrored here fails loudly.

import { getSport } from '../sports/index.js';
import { BASKETBALL_MODEL } from '../sports/basketball.js';
import { DRIVE_MODEL, driveMoments, driveOdds } from '../sports/americanFootball.js';
import { INNING_MODEL, inningOdds, runMasses } from '../sports/baseball.js';

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
 * → { kind:'poisson', rA, rD, length:90 } (football)
 * | { kind:'normal', pace, effA, effD, formSd, length:40, ot:5, maxOt:4 } (basketball, length 48 under NBA rules;
 *     effA/effD are efficiencies)
 * | { kind:'drives', drives, muA, muD, varA, varD, slope, formSd, driveSd, length:60, ot:10, maxOt:3, otChain,
 *     tdA, fgA, tdD, fgD } (American football; μ/σ² are a possession's points, otChain[k] A's chance from level with
 *     k overtimes left, td/fg a possession's chance of a touchdown / field goal)
 * | { kind:'innings', edgeA, edgeD, formSd, length:54, ot:6, maxOt:6 } (baseball; the clock counts outs, edges are each
 *     side's batting minus the opposing defence, formSd the spread of match-day form in rating points)
 * | null (no teams, unknown sport, or a model the approximation does not cover).
 * `sport` is a sport object or id; effA/effD are the match's effective strengths (tactics included); `drama`
 * is the match's uncertainty (football ignores it, as the README formula does). Calls only the sport's
 * deterministic `prepareMatch`; consumes no RNG.
 */
export function liveModelFor(sport, attacker, defender, effA, effD, drama) {
  const model = typeof sport === 'string' ? getSport(sport) : sport;
  if (!model || typeof model.prepareMatch !== 'function' || !attacker || !defender) return null;
  let prepared;
  try {
    prepared = model.prepareMatch(attacker, defender, isNum(effA) ? num(effA) : undefined, isNum(effD) ? num(effD) : undefined);
  } catch {
    return null;
  }
  if (!prepared) return null;
  const length = positive(model.clock?.length);
  if (model.tieBreak === 'shootout' && isNum(prepared.logA) && isNum(prepared.logD)) {
    return { kind: 'poisson', rA: footballRate(prepared.logA), rD: footballRate(prepared.logD), length: length || 90 };
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.edgeA) && isNum(prepared.edgeD) && positive(prepared.drives)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return drivesModel(prepared, variation, length || 60);
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.edgeA) && isNum(prepared.edgeD) && positive(prepared.innings)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'innings', edgeA: num(prepared.edgeA), edgeD: num(prepared.edgeD), formSd: variation * INNING_MODEL.FORM_PER_DRAMA,
      length: INNING_MODEL.LENGTH, ot: INNING_MODEL.INNING, maxOt: INNING_MODEL.MAX_EXTRA,
    };
  }
  if (model.tieBreak === 'overtime' && isNum(prepared.efficiencyA) && isNum(prepared.efficiencyD) && positive(prepared.pace)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'normal', pace: num(prepared.pace), effA: num(prepared.efficiencyA), effD: num(prepared.efficiencyD),
      formSd: variation * FORM_PER_DRAMA, length: length || 40, ot: 5, maxOt: 4,
    };
  }
  return null;
}

/** A's chance in one overtime period that `first` ('A' | 'D') opens → [A wins, still level]. */
function overtimePeriodChance(a, d, first) {
  const [x, y] = first === 'A' ? [a, d] : [d, a];
  // Both possess once: a touchdown beats a field goal beats nothing; level, the next score wins.
  const xWins = x.td * (y.fg + y.none) + x.fg * y.none;
  const yWins = y.td * (x.fg + x.none) + y.fg * x.none;
  let open = x.td * y.td + x.fg * y.fg + x.none * y.none;
  let xTotal = xWins, yTotal = yWins;
  for (let k = 0; k < DRIVE_MODEL.SUDDEN_DEATH * 2; k++) {
    const side = k % 2 === 0 ? x : y;
    if (k % 2 === 0) xTotal += open * (1 - side.none); else yTotal += open * (1 - side.none);
    open *= side.none;
  }
  return [first === 'A' ? xTotal : yTotal, open];
}

/**
 * The live model of an American football match: a possession's mean and variance per side, how fast both move with
 * form, and the overtime chain.
 */
function drivesModel(prepared, variation, length) {
  const { DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, FORM_PER_DRAMA } = DRIVE_MODEL;
  const outcomes = odds => {
    const fg = (1 - odds.td) * odds.fgTry * odds.make;
    return { td: odds.td, fg, none: 1 - odds.td - fg };
  };
  const meanAt = (edge, kicking) => driveMoments(driveOdds(edge, kicking)).mean;
  const oddsA = driveOdds(prepared.edgeA, prepared.kickingA), oddsD = driveOdds(prepared.edgeD, prepared.kickingD);
  const a = driveMoments(oddsA), d = driveMoments(oddsD);
  const slope = (meanAt(prepared.edgeA + 1, prepared.kickingA) - meanAt(prepared.edgeA - 1, prepared.kickingA)) / 2
    + (meanAt(prepared.edgeD + 1, prepared.kickingD) - meanAt(prepared.edgeD - 1, prepared.kickingD)) / 2;
  const sideA = outcomes(oddsA), sideD = outcomes(oddsD);
  const [winFirst, openFirst] = overtimePeriodChance(sideA, sideD, 'A');
  const [winSecond, openSecond] = overtimePeriodChance(sideA, sideD, 'D');
  const win = (winFirst + winSecond) / 2, open = (openFirst + openSecond) / 2;
  // otChain[0]: the decisive field goal; otChain[k]: k periods still to play.
  const otChain = [1 / (1 + Math.exp(-DECISIVE_FIELD_GOAL * (prepared.edgeA - prepared.edgeD)))];
  for (let k = 1; k <= MAX_OVERTIMES; k++) otChain.push(win + open * otChain[k - 1]);
  return {
    kind: 'drives', drives: num(prepared.drives) || DRIVES, muA: a.mean, muD: d.mean, varA: a.variance, varD: d.variance, slope,
    formSd: variation * FORM_PER_DRAMA, driveSd: DRIVE_SD, length, ot: OVERTIME, maxOt: MAX_OVERTIMES, otChain,
    tdA: sideA.td, fgA: sideA.fg, tdD: sideD.td, fgD: sideD.fg,
  };
}

/** True for a well-formed `liveModelFor` result (e.g. one read back from a save). */
export function isLiveModel(model) {
  if (!model || typeof model !== 'object') return false;
  const finite = key => typeof model[key] === 'number' && Number.isFinite(model[key]);
  if (model.kind === 'poisson') return finite('rA') && finite('rD') && model.rA >= 0 && model.rD >= 0 && finite('length') && model.length > 0;
  if (model.kind === 'normal') {
    return finite('pace') && model.pace > 0 && finite('effA') && finite('effD') && finite('formSd') && model.formSd >= 0
      && finite('length') && model.length > 0 && finite('ot') && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0;
  }
  if (model.kind === 'drives') {
    return ['drives', 'muA', 'muD', 'varA', 'varD', 'slope', 'formSd', 'driveSd', 'length', 'ot', 'tdA', 'fgA', 'tdD', 'fgD'].every(finite)
      && ['tdA', 'fgA', 'tdD', 'fgD'].every(key => model[key] >= 0 && model[key] <= 1)
      && model.drives > 0 && model.muA >= 0 && model.muD >= 0 && model.varA >= 0 && model.varD >= 0 && model.formSd >= 0
      && model.driveSd >= 0 && model.length > 0 && model.ot > 0 && Number.isInteger(model.maxOt) && model.maxOt >= 0
      && Array.isArray(model.otChain) && model.otChain.length === model.maxOt + 1
      && model.otChain.every(p => typeof p === 'number' && p >= 0 && p <= 1);
  }
  if (model.kind === 'innings') {
    return ['edgeA', 'edgeD', 'formSd', 'length', 'ot'].every(finite) && model.formSd >= 0 && model.length > 0 && model.ot > 0
      && Number.isInteger(model.maxOt) && model.maxOt >= 0;
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
  // side's one answer: a touchdown answers anything, a field goal only levels a field goal's lead.
  const period = Math.min(maxOt - 1, Math.ceil((minute - length) / ot) - 1);
  const level = otChain[maxOt - period];
  if (minute >= length + ot * maxOt) return step(margin, otChain[0]);
  if (margin === 0) return level;
  const [td, fg] = margin > 0 ? [model.tdD, model.fgD] : [model.tdA, model.fgA];
  const lead = Math.abs(margin);
  const trailer = lead > 7 ? 0 : lead > 3 ? td * (lead === 7 ? (margin > 0 ? 1 - level : level) : 1)
    : td + fg * (margin > 0 ? 1 - level : level);
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
 * with k extra innings still to play; chain[0] the decisive run). Also a cache of computed values by minute and margin.
 */
function inningTables(model) {
  if (innings.has(model)) return innings.get(model);
  const { INNINGS, DECISIVE_RUN } = INNING_MODEL;
  const decisive = 1 / (1 + Math.exp(-DECISIVE_RUN * (model.edgeA - model.edgeD)));
  const nodes = HERMITE.map(([t, weight]) => {
    const form = t * model.formSd;
    const oddsA = inningOdds(model.edgeA + form), oddsD = inningOdds(model.edgeD - form);
    const side = odds => {
      const masses = runMasses(odds.score), powers = [[1]];
      for (let k = 1; k <= INNINGS; k++) powers.push(convolve(powers[k - 1], masses));
      return { score: odds.score, extraScore: odds.extra, powers, extra: runMasses(odds.extra) };
    };
    const A = side(oddsA), D = side(oddsD);
    let win = 0, level = 0;
    A.extra.forEach((a, i) => D.extra.forEach((d, j) => { if (i > j) win += a * d; else if (i === j) level += a * d; }));
    const chain = [decisive];
    for (let k = 1; k <= model.maxOt; k++) chain.push(win + level * chain[k - 1]);
    return { weight, A, D, chain };
  });
  const tables = { nodes, cache: new Map() };
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
  const { nodes, cache } = inningTables(model);
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
        return batting && left > 0 ? convolve(runMasses(own.score * left), whole) : whole;
      };
      return sum + node.weight * marginChance(rest('A'), rest('D'), margin, node.chain[model.maxOt]);
    }, 0);
  } else {
    // Extra inning k (1-based), u outs into it: the attacker's top, then the defender's bottom.
    const k = Math.min(model.maxOt, Math.ceil((minute - model.length) / model.ot));
    const u = minute - model.length - (k - 1) * model.ot;
    chance = nodes.reduce((sum, node) => {
      const top = u < OUTS ? runMasses(node.A.extraScore * (OUTS - u) / OUTS) : [1];
      const bottom = u < OUTS ? node.D.extra : u < 2 * OUTS ? runMasses(node.D.extraScore * (2 * OUTS - u) / OUTS) : [1];
      return sum + node.weight * marginChance(top, bottom, margin, node.chain[model.maxOt - k]);
    }, 0);
  }
  chance = clamp01(chance);
  cache.set(key, chance);
  return chance;
}

/** Models with overtime periods after regulation: basketball's and American football's, and baseball's extra innings. */
const hasOvertime = model => model.kind === 'normal' || model.kind === 'drives' || model.kind === 'innings';

/**
 * The last minute a model can reach: 90 for football, 40 + 5·4 for basketball (48 + 5·4 in the NBA), 60 + 10·3 for
 * American football and 54 + 6·6 outs for baseball.
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
    buzzer: minute < length ? BUZZER_LEVEL : [],
  });
}

/**
 * P(side A wins) at match minute `minute` with score difference `diff` (A − D goals or points), or null without a
 * valid model. Football: README formula with remaining (90 − t)/90. Basketball: regulation, then each overtime
 * period with its own remaining possessions; a level score at a period's end carries the overtime chain.
 */
export function winProbabilityAt(model, minute, diff = 0) {
  if (!isLiveModel(model)) return null;
  const t = isNum(minute) ? num(minute) : 0;
  const lead = isNum(diff) ? num(diff) : 0;
  if (model.kind === 'normal') return basketballAt(model, t, lead);
  if (model.kind === 'drives') return drivesAt(model, t, lead);
  if (model.kind === 'innings') return inningsAt(model, t, lead);
  return footballWinProbability({ rA: model.rA, rD: model.rD, diff: lead, remaining: (model.length - clamp(t, 0, model.length)) / model.length });
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

/** Last minute the revealed events reach, rounded up to the end of its period (basketball overtime), else the regulation length. */
function endMinute(model, events) {
  const latest = events.reduce((max, event) => Math.max(max, num(event.m)), 0);
  if (!hasOvertime(model) || latest <= model.length) return model.length;
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

  const delta = new Array(upTo + 1).fill(0);
  for (const event of events) {
    const at = Math.max(0, Math.ceil(num(event.m)));
    if (at > upTo) continue;
    const points = isNum(event.pts) ? num(event.pts) : 1;
    delta[at] += event.tid === aId ? points : -points;
  }

  const chains = [];
  const series = [];
  let diff = 0;
  for (let t = 0; t <= upTo; t++) {
    diff += delta[t];
    const p = model.kind === 'normal'
      ? basketballAt(model, t, diff, chains)
      : model.kind === 'drives' ? drivesAt(model, t, diff)
      : model.kind === 'innings' ? inningsAt(model, t, diff)
      : footballWinProbability({ rA: model.rA, rD: model.rD, diff, remaining: (model.length - Math.min(t, model.length)) / model.length });
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
 * Football: 0'…90', ticks every 15', half-time at 45'. Basketball: 0'…40' plus each overtime period reached,
 * ticks at the quarters and overtime ends, half-time at 20', quarter guides at 10'/20'/30' (NBA rules: 0'…48', the
 * quarters every 12'). American football the same over 0'…60' and its ten-minute overtimes. Baseball: 54 outs, a tick
 * at the end of every inning, extra innings included, and a guide after the third and the sixth.
 */
export function chartDomain(model, minute = 0) {
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
