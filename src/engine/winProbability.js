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
//   mean |gap| ≈ 2 points and at most ≈ 5–6 points under the default 'balanced' uncertainty, up to ≈ 3 points
//   under 'predictable' and ≈ 12 points under 'wild'. DEC D6 ships the formula as specified.
//
// Basketball — engine-diff §4a.2 normal approximation of the repo's own model (src/sports/basketball.js):
//   each period score is Normal(poss·eff, poss·(0.72 + 0.5·eff)) rounded; possessions ~ 73 ± 4.5; match-day form
//   N(0, drama·0.0125) per side persists through overtime; shared conditions cancel in the margin; level after 40'
//   goes to 5' overtimes (at most 4, the last ends in a decisive play won with logistic(3·(effA − effD))).
//   The remaining margin is therefore ≈ Normal(R·(effA − effD), R·(1.44 + 0.5·(effA + effD)) + 2·(formSd·R)²
//   + (effA − effD)²·σ_R² + 1/6) for R remaining possessions; P(A wins) = P(margin ≥ 1) + P(margin = 0)·P(A wins
//   from level), with a ±0.5 continuity correction. Measured robust: tip-off within ≈ 1 point of the Monte Carlo
//   odds at every uncertainty preset, and calibrated mid-game against full simulations (test file).
//
// Constants mirror the private values in src/sports/football.js (BASE_GOALS, MAX_LOG_EDGE) and
// src/sports/basketball.js (scorePeriod variance, pace spread, form deviation, overtime rules). The tests compare
// this module against those models, so a change there that is not mirrored here fails loudly.

import { getSport } from '../sports/index.js';

const BASE_GOALS = 1.28;
const MAX_LOG_EDGE = 1.5;
const GOAL_CAP = 15;

const SHOT_VARIANCE_BASE = 0.72;
const SHOT_VARIANCE_PER_EFFICIENCY = 0.5;
const PACE_SD = 4.5;
const OVERTIME_PACE_SD = 0.7;
const FORM_PER_DRAMA = 0.0125;
const DECISIVE_SLOPE = 3;
const ROUNDING_VARIANCE = 1 / 6; // two independently rounded period scores, 1/12 each
const DEFAULT_DRAMA = 6;

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
 * | { kind:'normal', pace, effA, effD, formSd, length:40, ot:5, maxOt:4 } (basketball; effA/effD are efficiencies)
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
  if (model.tieBreak === 'overtime' && isNum(prepared.efficiencyA) && isNum(prepared.efficiencyD) && positive(prepared.pace)) {
    const variation = isNum(drama) ? clamp(num(drama), 0, 12) : DEFAULT_DRAMA;
    return {
      kind: 'normal', pace: num(prepared.pace), effA: num(prepared.efficiencyA), effD: num(prepared.efficiencyD),
      formSd: variation * FORM_PER_DRAMA, length: length || 40, ot: 5, maxOt: 4,
    };
  }
  return null;
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
 * series passes the overtime chain); `possessionSd` is the spread of the remaining possession count.
 * remainingPossessions = 0 is an exact step: 1 / 0 / tieA.
 */
export function basketballWinProbability({ effA, effD, formSd = 0, margin = 0, remainingPossessions = 0, tieA = 0.5, possessionSd = 0 } = {}) {
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
  const upToZero = normalCdf((0.5 - mean) / sd);
  const belowZero = normalCdf((-0.5 - mean) / sd);
  return clamp01((1 - upToZero) + (upToZero - belowZero) * level);
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

/** The last minute a model can reach: 90 for football, 40 + 5·4 for basketball. */
function lastMinute(model) {
  return model.kind === 'normal' ? model.length + model.ot * model.maxOt : model.length;
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
  if (model.kind !== 'normal' || latest <= model.length) return model.length;
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
 * ticks at the quarters and overtime ends, half-time at 20', quarter guides at 10'/20'/30'.
 */
export function chartDomain(model, minute = 0) {
  if (isLiveModel(model) && model.kind === 'normal') {
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
