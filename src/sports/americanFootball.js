import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';
import { selectLineup } from '../data/teams.js';
import { LATEST_NFL_SEASON, NFL_LEAGUE_AVERAGES, NFL_SEASON_MATCHUPS } from '../data/nflLeagueAverages.js';
import { rulesMemo, rulesYear } from './eras.js';

const MINUTES = 60; // four fifteen-minute quarters
const QUARTER = 15;
// Overtime periods are ten minutes, the regular season's since 2017; a season before 2017's, and the AFL's, fifteen.
const OVERTIME = 10;
const LONG_OVERTIME = 15;
const MAX_OVERTIMES = 3;
// Possessions per side in regulation. Quality changes what a drive yields, not how many there are.
const DRIVES = 11;
const DRIVE_SD = 1.1;
// Sudden-death possessions each side can still get in an overtime period after its first two: a period holds six
// possessions at most, under every season's overtime rules.
const SUDDEN_DEATH = 2;
const OT_POSSESSIONS = 2 + 2 * SUDDEN_DEATH;

// A drive's outcome against an average defence: a touchdown 22% of the time, else a field-goal try 22.5% of the
// time, made 85% of the time by an 80-rated kicker. That is about two points a drive, 22 a game: 2.5 touchdowns and
// 1.7 field goals a side, as in the NFL's 2023 and 2024 seasons.
const BASE_TD = 0.22;
const BASE_FG_TRY = 0.225;
// A touchdown is 6 and its try: the extra point, made 95% of the time by an 80-rated kicker, or two points, made 48%
// of the time between equals. Early on a side goes for two after one touchdown in 12; late, as the chart says
// (TWO_POINT_LEADS): one touchdown in ten in all, as in 2024. About one drive in 450 ends in its own end zone: a
// safety, 2 points to the defence.
const BASE_XP = 0.95;
const BASE_TWO = 0.48;
// A kicker a rating point above the matchup's average makes 0.6 more field goals in a hundred, and 0.3 more extra points
// where the league makes today's 95% (an earlier season scales that by how many its league missed: `xpSlope`).
const FG_PER_POINT = 0.006;
const XP_PER_POINT = 0.003;
const EARLY_TWO = 0.085;
const SAFETY = 0.0022;
// Each rating point of edge moves a drive's touchdown odds by 0.075 in logit, a field-goal try's by 0.025: a 17-game
// season then spreads the franchises as the NFL's do, and the rating favourite wins two games in three.
const TD_SCALE = 0.075;
const FG_SCALE = 0.025;
// Match-day form in rating points, shifting both sides' edges (the attacker's up, the defender's down).
const FORM_PER_DRAMA = 0.35;
// Home advantage, a campaign option (off: every match is at a neutral venue): the defender's drives gain HOME_EDGE rating
// points of edge at home and the visitors' lose as much. Equal sides then win 54% at home, as NFL home sides do.
const HOME_EDGE = 0.65;
// Late-game play-calling over each side's last three possessions of regulation, by its lead before the drive: three
// scores up or down the game is played out, two scores up a side runs the clock, a score up it plays safe, level or
// two down it settles for the field goal that wins, three down for the one that draws level, needing a touchdown it
// goes for it on fourth down, two scores down it chases. NFL games end closer than independent drives would have them,
// about 11 points apart, more than half within a score and one in seven by exactly 3; who wins hardly moves.
// [lead at least, touchdown ×, field-goal try ×]
const LATE_DRIVES = 3;
const LATE_CALLS = [[17, 1, 1], [9, 0.6, 1], [1, 0.6, 0.8], [0, 0.5, 3], [-2, 0.5, 3], [-3, 0.8, 2], [-8, 1.25, 0.25],
  [-16, 1.5, 0.5], [-Infinity, 1, 0.8]];
// Late on, the leads a touchdown leaves (before its try) at which a side goes for two, as coaches' charts have it:
// up 1, 5 or 12, to lead by 3, 7 or 14; down 2, to draw level; down 5, 10 or 13, to trail by 3, 8 or 11.
const TWO_POINT_LEADS = [1, 5, 12, -2, -5, -10, -13];

/** A drive's odds under late-game play-calling, for a side leading by `lead` (negative when behind). */
export function lateCall(odds, lead) {
  const call = LATE_CALLS.find(row => lead >= row[0]);
  return { ...odds, td: Math.min(0.9, odds.td * call[1]), fgTry: Math.min(0.95, odds.fgTry * call[2]) };
}

/** Group weights: the quarterback and his line carry an offence; the pass rush and the secondary a defence. */
const OFFENCE_WEIGHTS = { QB: 0.3, RB: 0.08, WR: 0.24, TE: 0.08, OL: 0.3 };
const DEFENCE_WEIGHTS = { DL: 0.32, LB: 0.18, CB: 0.3, S: 0.2 };

const logit = p => Math.log(p / (1 - p));
const logistic = x => 1 / (1 + Math.exp(-x));

function profile(lineup) {
  const means = {};
  for (const slot of lineup.slots) (means[slot.position] ||= []).push(slot.effectiveRating);
  const mean = position => (means[position] ? means[position].reduce((s, v) => s + v, 0) / means[position].length : 40);
  const weighted = weights => Object.entries(weights).reduce((sum, [position, weight]) => sum + mean(position) * weight, 0);
  return { offence: weighted(OFFENCE_WEIGHTS), defence: weighted(DEFENCE_WEIGHTS), kicking: mean('K') };
}

// ---------- the rules of a season's day ----------

/**
 * Today's rules, the built-in season's (Madden NFL 27): the drive odds above, tuned on the NFL's 2023 and 2024 seasons,
 * between equals (`edge` 0) and for an 80-rated kicker (`kicker`); the extra point from the 15-yard line, held to
 * `xpRange`; two-point tries, after EARLY_TWO of the early touchdowns and late as the chart says (`chart`: the share of
 * its calls followed); both sides possess in overtime (`overtime` 'both'), in ten-minute periods (`ot`). An earlier
 * season's rules (seasonRules) restate each of these for its day.
 */
const TODAY = Object.freeze({ league: 'NFL', year: null, td: BASE_TD, fgTry: BASE_FG_TRY, edge: 0, make: 0.85,
  makeRange: Object.freeze([0.6, 0.97]), xp: BASE_XP, xpRange: Object.freeze([0.85, 0.99]), kicker: 80, two: BASE_TWO,
  early: EARLY_TWO, chart: 1, safety: SAFETY, overtime: 'both', ot: OVERTIME });

// The seasons today's drive odds were tuned on: an earlier season's move from them by how far its league's figures stand
// from theirs.
const REFERENCE_SEASONS = Object.freeze([2023, 2024]);

/**
 * The overtime a level game goes to in `league`'s `year`: its playoffs', as a conquest needs a winner. The AFL's
 * (1960–69) and the NFL's to 2009 were sudden death, the first score of any kind winning; from the 2010 playoffs a
 * touchdown on the first possession wins, a field goal gives the other side a possession, then sudden death ('modified');
 * from the 2022 playoffs both sides possess ('both'). docs/design/american-football.md, "Rules by era", has the sources.
 */
export function overtimeRule(league, year) {
  if (league === 'AFL' || year <= 2009) return 'sudden';
  return year <= 2021 ? 'modified' : 'both';
}

/** Whether a touchdown's try can be for two points: in the AFL (1960–69) and in the NFL from 1994. */
export const twoPointTry = (league, year) => league === 'AFL' || year >= 1994;

/** A league season's totals summed over `years` (src/data/nflLeagueAverages.js). */
function totalsOf(league, years) {
  const out = {};
  for (const year of years) for (const [key, value] of Object.entries(NFL_LEAGUE_AVERAGES[league][year])) out[key] = (out[key] ?? 0) + value;
  return out;
}

// Per possession of the model's eleven a side: a touchdown, and a field-goal try on one that ended in none.
const touchdownsPerDrive = s => s.td / s.games / DRIVES;
const tryPerDrive = s => s.fga / s.games / (DRIVES - s.td / s.games);

/**
 * The rules of `league`'s `year` (an NFL season from 1960, the latest finished one's figures standing in for any later,
 * or the AFL's 1960–69) for the built-in season data set `dataSet`, or null when the table has no such season:
 * - the drive odds at its own average matchup (`edge`: its clubs' mean offence less their mean defence, src/data/
 *   nflLeagueAverages.js), which sit from today's at the built-in clubs' average matchup as far, in log odds, as the
 *   season's touchdowns and field-goal tries a possession sit from 2023 and 2024's;
 * - its league's field goals and extra points made (`make`, `xp`) by its average kicker (`kicker`), each kicker a rating
 *   point better making 0.6 more field goals in a hundred, as today, and more extra points by as much less than today's
 *   0.3 as its league missed fewer than today's 5% (`xpSlope`: none in the AFL of 1965, which made all 267), so the
 *   season's kickers make its league's share between them;
 * - its two-point tries, where the league had them: made as often as its were between equals, gone for as much more or
 *   less often than in 2023 and 2024 as its were (`early`, and `chart`, the chart's calls followed), else none;
 * - its safeties a possession, its playoffs' overtime (overtimeRule), and fifteen-minute periods (ten from 2017, the
 *   regular season's since).
 */
export function seasonRules(league, year, dataSet) {
  const figures = NFL_LEAGUE_AVERAGES[league]?.[league === 'NFL' ? Math.min(year, LATEST_NFL_SEASON) : year];
  if (!figures) return null;
  const reference = totalsOf('NFL', REFERENCE_SEASONS);
  const today = NFL_SEASON_MATCHUPS['built-in'], matchup = NFL_SEASON_MATCHUPS[dataSet] ?? today;
  const make = figures.fgm / figures.fga, xp = figures.xpm / figures.xpa;
  const share = twoPointTry(league, year) && figures.twoMade > 0 ? figures.twoAtt / figures.td : 0;
  const ratio = share / (reference.twoAtt / reference.td);
  return Object.freeze({ league, year,
    td: logistic(logit(BASE_TD) + TD_SCALE * today.edge + logit(touchdownsPerDrive(figures)) - logit(touchdownsPerDrive(reference))),
    fgTry: logistic(logit(BASE_FG_TRY) + FG_SCALE * today.edge + logit(tryPerDrive(figures)) - logit(tryPerDrive(reference))),
    edge: matchup.edge, make, makeRange: Object.freeze([make - 0.25, Math.min(0.97, make + 0.12)]), xp,
    xpRange: Object.freeze([xp - 0.1, Math.min(0.999, xp + 0.04)]), xpSlope: XP_PER_POINT * (1 - xp) / (1 - BASE_XP), kicker: matchup.kicking,
    two: share ? figures.twoMade / figures.twoAtt : 0, early: share ? EARLY_TWO * ratio : 0, chart: share ? Math.min(1, ratio) : 0,
    safety: figures.safeties / figures.games / DRIVES, overtime: overtimeRule(league, year),
    ot: league === 'NFL' && year >= 2017 ? OVERTIME : LONG_OVERTIME });
}

/**
 * A side's chances on one drive with `edge` = its offence minus the opposing defence, and its kicker's rating: a
 * touchdown, a field-goal try and its make, and a touchdown's extra point and two-point try (0 where there is none),
 * under `rules` (today's by default).
 */
export function driveOdds(edge, kicking, rules = TODAY) {
  const e = edge - rules.edge, k = kicking - rules.kicker;
  return {
    td: logistic(logit(rules.td) + TD_SCALE * e),
    fgTry: logistic(logit(rules.fgTry) + FG_SCALE * e),
    make: clamp(rules.make + k * FG_PER_POINT, ...rules.makeRange),
    xp: clamp(rules.xp + k * (rules.xpSlope ?? XP_PER_POINT), ...rules.xpRange),
    two: rules.two > 0 ? logistic(logit(rules.two) + FG_SCALE * e) : 0,
  };
}

/**
 * Mean and variance of one drive's points under `odds`, for the side with the ball (a safety counts −2), with the
 * early-game tries: two points after `rules.early` of the touchdowns (EARLY_TWO today), else the extra point.
 */
export function driveMoments({ td, fgTry, make, xp, two }, rules = TODAY) {
  const { early, safety } = rules;
  const fg = (1 - td) * fgTry * make;
  const touchdown = 6 + (1 - early) * xp + early * 2 * two;
  const touchdownSquare = 36 + (1 - early) * 13 * xp + early * 28 * two;
  const mean = td * touchdown + 3 * fg - 2 * safety;
  return { mean, variance: td * touchdownSquare + 9 * fg + 4 * safety - mean * mean, score: td + fg };
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at
 * home (the campaign's home advantage); a neutral venue otherwise. `rules`: the season's (today's by default), carried
 * on the prepared match so the score-only sampler and the live chart play them.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = TODAY) {
  const lineupA = selectLineup(attacker);
  const lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  const edge = home ? HOME_EDGE : 0;
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    lineupA,
    lineupD,
    rules,
    drives: DRIVES,
    edgeA: a.offence + adjustmentA - (d.defence + adjustmentD) - edge,
    edgeD: d.offence + adjustmentD - (a.defence + adjustmentA) + edge,
    kickingA: a.kicking + adjustmentA,
    kickingD: d.kicking + adjustmentD,
  };
}

/**
 * One possession by `side`, `lead` points up before it → { side, pts } for the side that scores: a touchdown's 6 and
 * its try (`conversion` 'kick' or 'two'), a field goal's 3, or the defence's 2 for a safety, which ends `safety` of the
 * possessions; else 0 for the side with the ball. `goForTwo(lead)`, given the lead the touchdown leaves, picks the try,
 * or returns null when the touchdown has won the game and there is none.
 */
function drive(rng, side, odds, goForTwo, lead = 0, safety = SAFETY) {
  const roll = rng();
  if (roll >= 1 - safety) return { side: side === 'A' ? 'D' : 'A', pts: 2 };
  if (roll < odds.td) {
    const two = goForTwo(lead + 6);
    if (two === null) return { side, pts: 6 };
    if (two) return { side, pts: rng() < odds.two ? 8 : 6, conversion: 'two' };
    return { side, pts: rng() < odds.xp ? 7 : 6, conversion: 'kick' };
  }
  return { side, pts: roll < odds.td + (1 - odds.td) * odds.fgTry && rng() < odds.make ? 3 : 0 };
}

/**
 * An overtime period under `rules.overtime`, `first` ('A' or 'D') the side that won the toss and has the ball first.
 * A score that wins ends the game, a touchdown without its try, and a safety wins it for the defence; a period holds
 * OT_POSSESSIONS possessions at most. → { a, d, drives: [{ side, pts }] }
 * - 'both' (the playoffs' since 2022): both sides get a possession, the first kicking after a touchdown. The second
 *   plays to that score: level or a field goal down it plays for three, a touchdown down it needs one, and its touchdown
 *   wins outright or is kicked to win or draw level. Still level, possessions alternate and the next score wins.
 * - 'modified' (2010–2021): a touchdown on the first possession wins; a field goal gives the other side a possession, a
 *   field goal down (its touchdown wins, its field goal draws level); then, or after a first possession without a score,
 *   sudden death.
 * - 'sudden' (to 2009, and the AFL's): possessions alternate and the next score wins.
 */
function overtimePeriod(rng, oddsA, oddsD, first, rules = TODAY) {
  const order = first === 'A' ? ['A', 'D'] : ['D', 'A'];
  const drives = [];
  let a = 0, d = 0;
  const play = (side, odds, goForTwo) => {
    const result = drive(rng, side, odds, goForTwo, 0, rules.safety);
    drives.push(result);
    if (result.side === 'A') a += result.pts; else d += result.pts;
  };
  const oddsOf = side => (side === 'A' ? oddsA : oddsD);
  if (rules.overtime === 'both') {
    play(order[0], oddsOf(order[0]), () => false);
    const behind = order[1] === 'A' ? d - a : a - d;
    // A touchdown down, a field goal cannot help: the second side goes for it on fourth down instead.
    const second = lateCall(oddsOf(order[1]), -behind);
    if (behind >= 0) play(order[1], behind > 3 ? { ...second, fgTry: 0 } : second, () => (behind < 6 ? null : false));
    for (let k = 0; k < SUDDEN_DEATH * 2 && a === d; k++) play(order[k % 2], oddsOf(order[k % 2]), () => null);
    return { a, d, drives };
  }
  let k = 0;
  if (rules.overtime === 'modified') {
    play(order[0], oddsOf(order[0]), () => null);
    k = 1;
    // A field goal down, the second side plays for the one that draws level, as late in a game.
    if ((order[0] === 'A' ? a - d : d - a) === 3) {
      play(order[1], lateCall(oddsOf(order[1]), -3), () => null);
      k = 2;
    }
  }
  for (; k < OT_POSSESSIONS && a === d; k++) play(order[k % 2], oddsOf(order[k % 2]), () => null);
  return { a, d, drives };
}

/**
 * Score-only path: possessions, form, drive luck, tries and late-game play-calling, under the prepared match's rules
 * (its season's). Also returns the scoring sequence (`plays`: each possession in order, `{ side, pts, period,
 * conversion? }` with `side` the side that scored, period 0 being regulation) so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const rules = prepared.rules ?? TODAY;
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const drives = Math.round(clamp(prepared.drives + gauss(rng) * DRIVE_SD, 8, 15));
  const form = gauss(rng) * variation * FORM_PER_DRAMA;
  const oddsA = driveOdds(prepared.edgeA + form, prepared.kickingA, rules);
  const oddsD = driveOdds(prepared.edgeD - form, prepared.kickingD, rules);
  const first = rng() < 0.5 ? 'A' : 'D';
  const plays = [];
  // Without a two-point try every touchdown is kicked; a season that went for two less often than today follows the
  // chart's calls only that often.
  const none = () => false;
  const earlyTwo = rules.two > 0 && rules.early > 0 ? () => rng() < rules.early : none;
  const lateTwo = !(rules.two > 0 && rules.chart > 0) ? none : rules.chart >= 1 ? lead => TWO_POINT_LEADS.includes(lead)
    : lead => TWO_POINT_LEADS.includes(lead) && rng() < rules.chart;
  let regA = 0, regD = 0;
  for (let k = 0; k < drives * 2; k++) {
    const side = (k % 2 === 0) === (first === 'A') ? 'A' : 'D';
    const odds = side === 'A' ? oddsA : oddsD;
    const lead = side === 'A' ? regA - regD : regD - regA;
    const late = k >= 2 * (drives - LATE_DRIVES);
    const play = drive(rng, side, late ? lateCall(odds, lead) : odds, late ? lateTwo : earlyTwo, lead, rules.safety);
    play.period = 0;
    plays.push(play);
    if (play.side === 'A') regA += play.pts; else regD += play.pts;
  }
  let ga = regA, gd = regD, tie = null;
  if (ga === gd) {
    const periods = [];
    for (let period = 0; period < MAX_OVERTIMES && ga === gd; period++) {
      const result = overtimePeriod(rng, oddsA, oddsD, rng() < 0.5 ? 'A' : 'D', rules);
      if (period === MAX_OVERTIMES - 1 && result.a === result.d) {
        // A bounded final decisive field goal, in that period and in the ticker. Swapping sides swaps the odds;
        // an equal matchup is a coin flip, never an automatic attacker win.
        const side = rng() < logistic(0.08 * (prepared.edgeA - prepared.edgeD)) ? 'A' : 'D';
        result.drives.push({ side, pts: 3 });
        if (side === 'A') result.a += 3; else result.d += 3;
      }
      for (const play of result.drives) plays.push({ ...play, period: period + 1 });
      periods.push([result.a, result.d]);
      ga += result.a;
      gd += result.d;
    }
    tie = { periods, ga, gd };
  }
  return { ga, gd, regA, regD, tie, plays, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/**
 * Who finishes a touchdown drive: receivers and backs above all, a quarterback's own run now and then, and the
 * defence's return touchdowns. Field goals go to the kicker.
 */
const TD_WEIGHTS = { WR: 1.9, RB: 4.25, TE: 2.1, QB: 1.1, CB: 0.13, S: 0.09, LB: 0.07, DL: 0.035, OL: 0.0001, K: 0.0001 };
/** Who is credited with a safety: the pass rush above all. */
const SAFETY_WEIGHTS = { DL: 3, LB: 1.5, S: 0.3, CB: 0.2, QB: 0.0001, RB: 0.0001, WR: 0.0001, TE: 0.0001, OL: 0.0001, K: 0.0001 };
/** A score's name by its points: a touchdown is 6 to 8 with its try, a field goal 3, a safety 2. */
const scoreName = (pts, short) => (pts === 3 ? (short ? 'FG' : 'FIELD GOAL') : pts === 2 ? 'SAFETY' : short ? 'TD' : 'TOUCHDOWN');

/** The minute a possession ends: possessions share their period evenly, with a little jitter, never past its end. */
function playMinute(rng, index, count, offset, span) {
  const at = ((index + 1) / (count + 1)) * span + gauss(rng) * 0.6;
  return offset + clamp(Math.round(at), 1, span);
}

/**
 * A complete match from a prepared matchup: the score-only outcome under its rules, then each score at the end of its
 * possession, the possessions sharing the sixty minutes or their overtime period (ten or fifteen minutes, the season's).
 */
function playMatch(rng, prepared, attacker, defender, drama) {
  const { ot } = prepared.rules ?? TODAY;
  const { ga, gd, regA, regD, tie, plays, winner } = sampleResult(rng, prepared, drama);
  const scorerA = createScorerSampler(prepared.lineupA, TD_WEIGHTS, 50);
  const scorerD = createScorerSampler(prepared.lineupD, TD_WEIGHTS, 50);
  const rusherA = createScorerSampler(prepared.lineupA, SAFETY_WEIGHTS, 50);
  const rusherD = createScorerSampler(prepared.lineupD, SAFETY_WEIGHTS, 50);
  const kickerOf = lineup => lineup.slots.find(slot => slot.position === 'K')?.player?.name || 'Kicker';
  const kickerA = kickerOf(prepared.lineupA), kickerD = kickerOf(prepared.lineupD);
  const ev = [];
  const periods = [];
  plays.forEach((play, i) => (periods[play.period] ||= []).push({ ...play, i }));
  periods.forEach((list, period) => {
    const offset = period ? MINUTES + (period - 1) * ot : 0;
    const span = period ? ot : MINUTES;
    // Overtime possessions are few: each takes about three minutes of its period.
    const count = period ? Math.max(list.length, Math.round(ot / 3)) : list.length;
    list.forEach((play, index) => {
      if (!play.pts) return;
      const own = play.side === 'A';
      const scorer = play.pts === 2 ? (own ? rusherA : rusherD) : (own ? scorerA : scorerD);
      ev.push({
        m: playMinute(rng, index, count, offset, span),
        tid: own ? attacker.id : defender.id,
        name: play.pts === 3 ? (own ? kickerA : kickerD) : scorer(rng),
        pts: play.pts,
      });
    });
  });
  ev.sort((x, y) => x.m - y.m);
  return { ga, gd, regA, regD, ev, tie, winner };
}

/** American football without its players: today's rules, which every season's (americanFootballIn) restates. */
const americanFootballRules = {
  id: 'american-football',
  // 4: an overtime side a touchdown down no longer settles for a field goal.
  simulationVersion: 4,
  name: 'American football',
  blurb: 'Eleven on offence, eleven on defence, sixty minutes. Touchdowns and field goals — level games go to overtime.',
  // No source rates national teams: American football is played by NFL clubs, on their own map of the USA.
  rosters: {},
  // Read from the sport's players (sportData.js), once they have loaded.
  clubs: undefined,
  clubsOnly: true,
  territory: { merged: {}, inactive: [] },
  /**
   * The rules a campaign plays (matchSport): an earlier season's day's (americanFootballIn), today's for the built-in
   * season. Every rulebook below shares this.
   */
  rulesFor: settings => americanFootballIn(settings),

  squadSize: 23,
  formation: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 2, CB: 3, S: 2, K: 1 },
  positionPlan: ['QB', 'RB', 'WR', 'WR', 'WR', 'TE', 'OL', 'OL', 'OL', 'OL', 'OL', 'DL', 'DL', 'DL', 'DL', 'LB', 'LB',
    'CB', 'CB', 'CB', 'S', 'S', 'K'],
  positionColors: { QB: C.gold, RB: C.green, WR: C.red, TE: '#E0904A', OL: C.cyan, DL: '#B07CD8', LB: '#7FA7E8', CB: '#E07FB0',
    S: '#8FCFA0', K: C.textSoft },

  fallbackStrength: (rec, confMeta) => Math.max(40, confMeta[rec[2]].baseStr - 15),
  requiredPositions: ['QB'],

  // `sudden`: an overtime period ends with the score that decides it, not at its tenth minute.
  clock: { length: MINUTES, msPerUnit: 65, ot: OVERTIME, sudden: true },
  tieBreak: 'overtime',
  labels: {
    score: 'POINTS',
    start: 'KICKOFF…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'OVERTIME',
    tieShort: 'OT',
  },

  words: { kickoff: 'Kickoff', end: 'Final', lineup: 'Starting lineup', lineupShort: 'Starters', lineupNoun: 'starting lineup',
    lineupTitle: 'Starters' },

  formatEvent: (e, code) => ({
    when: e.m > MINUTES ? 'OT' : `Q${Math.min(4, Math.max(1, Math.ceil(e.m / QUARTER)))}`,
    text: `${scoreName(e.pts, true)} — ${e.name} (${code})`,
  }),
  formatToast: e => `${scoreName(e.pts, false)} — ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

/** American football under today's rules: the built-in season's. */
export const americanFootball = defineSportData({ ...americanFootballRules }, { rosters: false });

/**
 * One sport object per earlier season ('madden-2010@2010', its data set and year), under that season's rules
 * (seasonRules); a season the table lacks plays today's. Version 5: each season plays its own day's scoring, tries and
 * overtime.
 */
const seasonSports = rulesMemo(key => {
  const [dataSet, year] = key.split('@');
  const rules = seasonRules(dataSet.startsWith('pfa-afl-') ? 'AFL' : 'NFL', Number(year), dataSet);
  if (!rules) return americanFootball;
  return defineSportData({
    ...americanFootballRules,
    simulationVersion: 5,
    clock: { ...americanFootballRules.clock, ot: rules.ot },
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
    },
  }, { id: 'american-football', rosters: false });
});

/**
 * American football under the rules of a setup's or campaign's season (`dataSet`, `dataYear`): an earlier season plays
 * its day's (seasonRules), an AFL season (pfa-afl-*) the AFL's; the built-in season plays today's, `americanFootball`
 * itself. Read through matchSport (src/sports/index.js).
 */
export function americanFootballIn(settings) {
  const year = rulesYear(settings);
  return year == null ? americanFootball : seasonSports(`${settings.dataSet}@${year}`);
}

/**
 * Squad-screen strength profile: the offence and defence the match model weighs, and the kicker → { offence, defence,
 * kicking } on the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first.
 * Read-only; no RNG.
 */
export function americanFootballProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => slot.position in OFFENCE_WEIGHTS)) return { offence: 0, defence: 0, kicking: 0 };
  return profile(selected);
}

/**
 * The overtime and drive constants the live win-probability model mirrors (src/engine/winProbability.js); a season's
 * own (its safeties, overtime rule and period) ride on its prepared match's `rules`.
 */
export const DRIVE_MODEL = Object.freeze({ DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, SUDDEN_DEATH, OT_POSSESSIONS, FORM_PER_DRAMA,
  SAFETY });
