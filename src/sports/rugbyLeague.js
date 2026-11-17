import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { selectLineup } from '../data/teams.js';
import { NRL_LEAGUE_AVERAGES } from '../data/nrlLeagueAverages.js';
import { clamp, gauss, poisson } from '../engine/random.js';

// Two forty-minute halves, told in five-minute slices: the score decides how each slice is played. A try is four points
// and its conversion two more, a penalty goal two and a field goal one. Level after eighty, golden point: five-minute
// halves of extra time, and the first score wins. The NRL calls a game still level after ten minutes a draw; a campaign
// needs a winner, so golden point runs on, as in the finals, and after twenty minutes a field goal decides it. An
// earlier season plays its own day's points, scoring and extra time (`rugbyLeagueIn`; docs/design/rugby-league.md,
// "Rules by era").
const MINUTES = 80;
const HALF = 40;
const SLICE = 5;
const SLICES = MINUTES / SLICE;
const GOLDEN = 5;
const MAX_GOLDEN = 4;

/** Points of each kind of score: today's, from 1983 for the try and 1971 for the field goal (`rulesOf`). */
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
// Field goals in the last ten minutes, a side's chance a slice by what one would do: level, to edge ahead; a converted
// try up, to lead by more than one (six up today); two up, by more than two (twelve); a field goal or less behind, to
// level or lead. Golden point's are the scores that end most of them.
const FIELD_GOAL_SLICES = 2;
const FIELD_GOAL_CHANCES = Object.freeze({ level: 0.3, oneScore: 0.14, twoScores: 0.06, behind: 0.1 });
// Golden point: the scores a side makes in five minutes of extra time between equals (most are field goals), and how
// they split.
const GOLDEN_RATE = 0.62;
const GOLDEN_SHARES = Object.freeze({ fieldGoal: 0.62, penaltyGoal: 0.12, try: 0.26 });
// A golden point's last, deciding field goal: close to a coin flip.
const DECIDER_SLOPE = 0.04;
// Extra time before golden point (from 2003): twenty minutes in two halves of ten, played in full, as the finals of the
// day played it; still level, the finals replayed the game, which a campaign cannot wait for, so it plays extra time
// again, and after the third a field goal decides it.
const EXTRA = 20;
const EXTRA_SLICES = EXTRA / SLICE;
const MAX_EXTRA = 3;

// ---------- the rules of a season's day ----------

/**
 * Today's rules, the built-in season's (Rugby League 26): the four-point try, the one-point field goal, golden point,
 * and the scoring the model is tuned to (the NRL's 2021–2025). `tries` scales both sides' try rates, `penalties` is the
 * penalty goals a side kicks in eighty minutes between equals, `fieldGoals` scales the late field-goal chances and
 * `openFieldGoals` is the field goals a side kicks in eighty minutes of open play. An earlier season's rules (`rulesIn`)
 * restate each.
 */
export const RULES_TODAY = Object.freeze({ season: null, tryPoints: POINTS.TRY, fieldGoalPoints: POINTS.FIELD_GOAL, golden: true,
  tries: 1, penalties: BASE_PENALTY_GOALS, fieldGoals: 1, openFieldGoals: 0 });

/**
 * The points and extra time of the season ending in `year` (null: the built-in season): a try three points before 1983,
 * a field goal two before 1971, and golden point from 2003, extra time before it. The Rugby League Project's season lists
 * add up so: each player's points are three a try to 1982 and four from 1983, two a field goal to 1970 and one from 1971.
 */
export function rulesOf(year) {
  return { tryPoints: year != null && year < 1983 ? 3 : POINTS.TRY, fieldGoalPoints: year != null && year < 1971 ? 2 : POINTS.FIELD_GOAL,
    golden: year == null || year >= 2003 };
}

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
 * A lineup's strength as the match model plays it, on the player-rating scale: the mean of its attack and its defence.
 * Two sides' margin follows the gap between theirs (`marginPerStrength`); the lineup's rating, the mean of its seventeen,
 * weighs every place alike instead. Read-only, for the earlier seasons' club shift (scripts/lib/rugby-league-seasons.mjs).
 */
export function rugbyLeagueStrength(lineup) {
  const { attack, defence } = profile(lineup);
  return (attack + defence) / 2;
}

/**
 * The points of margin a point of strength (`rugbyLeagueStrength`) is worth between two sides, to first order, at `tries`
 * tries a team game and a try worth `tryPoints`: the point moves the two sides' try rates apart by RATING_SCALE each in
 * log, and each try brings its points and a conversion at the NRL's rate.
 */
export const marginPerStrength = (tries, tryPoints) => 2 * RATING_SCALE * tries * (tryPoints + POINTS.CONVERSION * CONVERSION_RATE);

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at home
 * (the campaign's home advantage); a neutral venue otherwise. `rules`: a season's points, scoring and extra time
 * (`rugbyLeagueIn`), today's unless told; carried on the match for `sampleResult` and the live win probability.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = RULES_TODAY) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  const edgeA = a.attack + adjustmentA - (d.defence + adjustmentD), edgeD = d.attack + adjustmentD - (a.defence + adjustmentA);
  const venue = home ? HOME_EDGE / 2 : 0;
  return {
    attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, rules,
    // A season's scoring level scales both try rates (1 today).
    triesA: tryRate(edgeA * RATING_SCALE) * rules.tries * Math.exp(-venue), triesD: tryRate(edgeD * RATING_SCALE) * rules.tries * Math.exp(venue),
    // How far ahead the attacker is when a last field goal decides it, in rating points.
    golden: edgeA - edgeD,
  };
}

/**
 * A side's field-goal chance in a slice of the last ten minutes, `lead` points up, under `rules`: what the field goal
 * would do, by the converted try and the field goal of the day, scaled by the season's field goals (`rules.fieldGoals`).
 */
function fieldGoalChance(lead, rules) {
  const kick = rules.fieldGoalPoints, converted = rules.tryPoints + POINTS.CONVERSION;
  const chance = lead === 0 ? FIELD_GOAL_CHANCES.level
    : lead < 0 ? (lead >= -kick ? FIELD_GOAL_CHANCES.behind : 0)
      : lead > converted - kick && lead <= converted ? FIELD_GOAL_CHANCES.oneScore
        : lead > 2 * converted - kick && lead <= 2 * converted ? FIELD_GOAL_CHANCES.twoScores : 0;
  return chance * rules.fieldGoals;
}

/**
 * What one side should expect in slice `s`, `lead` points up (negative when behind), at an eighty-minute try rate
 * `tries`, under `rules` (today's unless told): { tries, penalties, fieldGoals, open }, the tries, penalty goals and
 * open-play field goals Poisson means, `fieldGoals` the chance of one late field goal. A score effect's reach is the
 * converted try of the day. Exported for the live win probability, which plays the same slices.
 */
export function sliceMeans(tries, lead, s, rules = RULES_TODAY) {
  const converted = rules.tryPoints + POINTS.CONVERSION;
  let t = tries * SLICE / MINUTES * (s < HALF_SLICES ? 2 - SECOND_HALF : SECOND_HALF), p = rules.penalties * SLICE / MINUTES, f = 0;
  if (lead >= EASING_LEAD) t *= EASED;
  if (s >= LATE_SLICE) {
    if (lead < 0 && lead >= -converted) t *= CHASING;
    else if (lead > 0 && lead <= converted) t *= PROTECTING;
    if (lead >= -2 && lead <= converted - 2) p *= PENALTY_TAKEN;
    else if (lead < -2) p *= PENALTY_RUN;
  }
  if (s >= SLICES - FIELD_GOAL_SLICES) f = fieldGoalChance(lead, rules);
  return { tries: t, penalties: p, fieldGoals: f, open: rules.openFieldGoals * SLICE / MINUTES };
}

/** A side's scoring rate in five minutes of golden point between equals, scaled by its try rate. */
export const goldenRate = tries => GOLDEN_RATE * Math.sqrt(tries / BASE_TRIES);

/** The attacker's chance when a last field goal decides it, golden point's or extra time's. */
export const deciderOdds = edge => logistic(DECIDER_SLOPE * edge);

/**
 * The slice whose score effects extra time's slice `e` (0–3 of each period) plays: the last twenty minutes', so its
 * last ten minutes bring the field goals. Exported for the live win probability.
 */
export const extraSlice = e => SLICES - EXTRA_SLICES + e;

/**
 * Score-only path: match-day form, then the slices one by one, then golden point, or before 2003 extra time
 * (`prepared.rules`). Also returns the scores in order (`scores`: { side, kind, pts, slice } with kind 'try', 'penalty'
 * or 'field', slice SLICES + k for golden point's k-th half and SLICES + 4k + e for extra time's, `decider` on a last
 * field goal of extra time) and the golden-point score's share of its half (`goldenAt`), so the full simulation can time
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
  // Slice `s` of the game's score effects, at the clock's slice `slice`.
  const play = (s, slice) => {
    const lead = a - d;
    const meansA = sliceMeans(triesA, lead, s, rules), meansD = sliceMeans(triesD, -lead, s, rules);
    for (const [side, means] of [['A', meansA], ['D', meansD]]) {
      const tries = poisson(rng, means.tries);
      for (let k = 0; k < tries; k++) score(side, 'try', rng() < CONVERSION_RATE ? rules.tryPoints + POINTS.CONVERSION : rules.tryPoints, slice);
      const penalties = poisson(rng, means.penalties);
      for (let k = 0; k < penalties; k++) score(side, 'penalty', POINTS.PENALTY_GOAL, slice);
      // Open play's field goals: none today, so no draw.
      const open = poisson(rng, means.open);
      for (let k = 0; k < open; k++) score(side, 'field', rules.fieldGoalPoints, slice);
    }
    // Late field goals: at most one a side a slice, by a side whose situation calls for one.
    if (meansA.fieldGoals > 0 && rng() < meansA.fieldGoals) score('A', 'field', rules.fieldGoalPoints, slice);
    if (meansD.fieldGoals > 0 && rng() < meansD.fieldGoals) score('D', 'field', rules.fieldGoalPoints, slice);
  };
  for (let s = 0; s < SLICES; s++) play(s, s);
  const regA = a, regD = d;
  let tie = null, goldenAt = 0;
  if (a === d && rules.golden) {
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
        goldenAt = 1;
        decided = { side: rng() < deciderOdds(prepared.golden) ? 'A' : 'D', kind: 'field', pts: rules.fieldGoalPoints, slice: SLICES + k };
      }
      periods.push(decided ? (decided.side === 'A' ? [decided.pts, 0] : [0, decided.pts]) : [0, 0]);
    }
    scores.push(decided);
    if (decided.side === 'A') a += decided.pts; else d += decided.pts;
    tie = { periods, ga: a, gd: d };
  } else if (a === d) {
    // Extra time: each period played in full, the score effects of a game's last twenty minutes; the last, still level,
    // ends with a field goal.
    const periods = [];
    for (let k = 0; k < MAX_EXTRA && a === d; k++) {
      const fromA = a, fromD = d;
      for (let e = 0; e < EXTRA_SLICES; e++) play(extraSlice(e), SLICES + k * EXTRA_SLICES + e);
      if (a === d && k === MAX_EXTRA - 1) {
        score(rng() < deciderOdds(prepared.golden) ? 'A' : 'D', 'field', rules.fieldGoalPoints, SLICES + (k + 1) * EXTRA_SLICES - 1);
        scores[scores.length - 1].decider = true;
      }
      periods.push([a - fromA, d - fromD]);
    }
    tie = { periods, ga: a, gd: d };
  }
  return { ga: a, gd: d, regA, regD, tie, scores, goldenAt, winner: a > d ? prepared.attackerId : prepared.defenderId };
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

/**
 * The clock's place for each score of slice `slice`: a minute within it, golden point's within its half (`golden`: the
 * rules have golden point; extra time's slices run on from the eightieth minute as regulation's do).
 */
function scoreMinute(rng, slice, goldenAt, golden = true) {
  if (golden && slice >= SLICES) return MINUTES + (slice - SLICES) * GOLDEN + clamp(Math.ceil(goldenAt * GOLDEN), 1, GOLDEN);
  return slice * SLICE + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE);
}

/**
 * A complete match from a prepared matchup, under its rules: the score-only outcome, then each score's minute and
 * scorer. Extra time's last field goal falls on its last minute.
 */
function playMatch(rng, prepared, attacker, defender, drama) {
  const rules = prepared.rules ?? RULES_TODAY;
  const { ga, gd, regA, regD, tie, scores, goldenAt, winner } = sampleResult(rng, prepared, drama);
  const scorerA = tryScorerSampler(prepared.lineupA), scorerD = tryScorerSampler(prepared.lineupD);
  const kickerA = kickerOf(prepared.lineupA), kickerD = kickerOf(prepared.lineupD);
  const droppersA = fieldGoalKickerOf(prepared.lineupA, kickerA), droppersD = fieldGoalKickerOf(prepared.lineupD, kickerD);
  const ev = scores.map(({ side, kind, pts, slice, decider }) => {
    const own = side === 'A';
    const name = kind === 'try' ? (own ? scorerA : scorerD)(rng) : kind === 'penalty' ? (own ? kickerA : kickerD) : own ? droppersA : droppersD;
    const m = decider ? MINUTES + EXTRA * tie.periods.length : scoreMinute(rng, slice, goldenAt, rules.golden);
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
  tie: 'GOLDEN POINT',
  tieShort: 'GP',
});
const WORDS = Object.freeze({ kickoff: 'Kick-off', end: 'Full time', lineup: 'Matchday 17', lineupShort: '17', lineupNoun: 'matchday 17',
  lineupTitle: 'Matchday 17', overtime: 'Golden point' });

/** Rugby league without its players: every season's rules share it (`rugbyLeagueIn`), read at import. */
const rugbyLeagueRules = {
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
  /**
   * The rules a campaign plays (matchSport): an earlier season's points, scoring and extra time (`rugbyLeagueIn`),
   * today's for the built-in season. Every rulebook below shares this.
   */
  rulesFor: settings => rugbyLeagueIn(settings),
  // The rules this sport object plays: today's (RULES_TODAY), or a season's (`rugbyLeagueWith`).
  rules: RULES_TODAY,

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
  labels: { ...LABELS },

  words: { ...WORDS },
  // What each kind of score is worth, for the scorers' line: today's.
  scoreValues: Object.freeze({ try: POINTS.TRY, penalty: POINTS.PENALTY_GOAL, field: POINTS.FIELD_GOAL }),

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
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

export const rugbyLeague = defineSportData({ ...rugbyLeagueRules });

// Extra time on the clock and in the words: twenty-minute periods played in full ("ET" at 100', then "2ET"), "after extra
// time", short "ET".
const EXTRA_ORDINALS = ['', 'a second', 'a third'];
const extraShort = periods => (periods > 1 ? `${periods}ET` : 'ET');
const EXTRA_TIME = Object.freeze({
  blurb: 'Thirteen a side and four on the bench, eighty minutes. Tries, goals and field goals — level games go to extra time.',
  // Not `sudden`: each period of extra time is played to its end.
  clock: Object.freeze({ length: MINUTES, msPerUnit: rugbyLeagueRules.clock.msPerUnit, ot: EXTRA, sudden: false, tick: 20 }),
  labels: Object.freeze({ ...LABELS, tie: 'EXTRA TIME', tieShort: 'ET' }),
  words: Object.freeze({ ...WORDS, overtime: 'Extra time' }),
  formatTick: t => (t > MINUTES ? extraShort(Math.ceil((t - MINUTES) / EXTRA)) : `${t}'`),
  overtime: Object.freeze({
    text: periods => (periods > 1 ? `after ${EXTRA_ORDINALS[periods - 1] ?? `${periods} periods of`} extra time` : 'after extra time'),
    short: extraShort,
    // A save from before these rules may hold golden point, one period.
    periodsOf: text => (/third extra time/i.test(text) ? 3 : /second extra time/i.test(text) ? 2
      : /extra time|golden point/i.test(text) ? 1 : null),
  }),
});

/**
 * Rugby league under `rules` ({ season, tryPoints, fieldGoalPoints, golden, tries, penalties, fieldGoals,
 * openFieldGoals }): the points of the day, its scoring level and, before golden point, extra time with its own clock and
 * words. Version 2: version 1 played every season as today's NRL.
 */
export function rugbyLeagueWith(rules) {
  return defineSportData({
    ...rugbyLeagueRules,
    simulationVersion: 2,
    rules,
    ...(rules.golden ? {} : EXTRA_TIME),
    scoreValues: Object.freeze({ try: rules.tryPoints, penalty: POINTS.PENALTY_GOAL, field: rules.fieldGoalPoints }),
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
    },
  }, { id: 'rugby-league' });
}

/**
 * The rules of season `id` ending in `year`: its day's points and extra time (`rulesOf`) at its league's scoring level
 * (NRL_LEAGUE_AVERAGES' `scoring`, solved so its clubs score as the league did); a season the table does not list plays
 * today's level.
 */
export function rulesIn(id, year) {
  const level = Object.hasOwn(NRL_LEAGUE_AVERAGES, id) ? NRL_LEAGUE_AVERAGES[id].scoring : null;
  return Object.freeze({ ...RULES_TODAY, ...rulesOf(year), season: id || String(year), ...(level ?? {}) });
}

/** One sport object per season ('nrl-1965@1965', its data set and year), under that season's rules (`rulesIn`). */
const seasonRugbyLeague = rulesMemo(key => {
  const at = key.lastIndexOf('@');
  return rugbyLeagueWith(rulesIn(key.slice(0, at), Number(key.slice(at + 1))));
});

/**
 * Rugby league as a setup's or campaign's season played it (`settings`: `dataSet`, `dataYear`; matchSport): 1965 with
 * its three-point tries, two-point field goals, its own scoring and extra time, 2015 with golden point at its own
 * scoring. The built-in season, which has no data set, plays today's rules exactly (`rugbyLeague` itself).
 */
export function rugbyLeagueIn(settings) {
  const year = rulesYear(settings);
  return year == null ? rugbyLeague : seasonRugbyLeague(`${settings.dataSet}@${year}`);
}

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
export const SLICE_MODEL = Object.freeze({ MINUTES, HALF, SLICE, SLICES, GOLDEN, MAX_GOLDEN, FORM_AT_BALANCED, CONVERSION_RATE,
  EXTRA, EXTRA_SLICES, MAX_EXTRA });
