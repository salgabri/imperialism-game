// College football (docs/design/college-football.md): the 138 FBS schools of EA SPORTS College Football 27, on their
// own map of the USA, playing American football's drive model (src/sports/americanFootball.js) under college rules:
// more possessions, the college game's kicking and tries, its home edge, a steeper edge for its wider spread of schools,
// and college overtime (possessions from the 25, two-point plays from the third period). An earlier season (a data set
// cfb-<year>) plays its own day's scoring and overtime (collegeSeasonRules).
import { defineSportData } from './sportData.js';
import { americanFootballRules, DRIVE_MODEL, playMatch, prepareMatch, sampleResult, scoreName, spreadAllowance } from './americanFootball.js';
import { COLLEGE_LEAGUE_AVERAGES, COLLEGE_REFERENCE_SEASONS, COLLEGE_SEASON_MATCHUPS, FIRST_COLLEGE_SEASON, LATEST_COLLEGE_SEASON }
  from '../data/collegeLeagueAverages.js';
import { rulesMemo, rulesYear } from './eras.js';

const MINUTES = 60;
const QUARTER = 15;

/**
 * The FBS's rules and rates (2024 and 2025, games between FBS schools: cfbstats.com's national team tables, see
 * docs/design/college-football.md, "The match model"), at the 138 schools' average matchup (`edge`: their mean offence
 * less their mean defence) and their average starting kicker (`kicker`):
 * - `drives`: possessions a side, about 10.35 a game ending in a touchdown, a field-goal try, a punt or a giveaway, and
 *   about two more on downs or at a half's end (`driveRange` the fewest and most);
 * - `td`, `fgTry`: a drive's touchdown, and a field-goal try on one that ended in none, at the average matchup, fitted so
 *   whole conference seasons score 3.27 touchdowns and 1.59 field-goal tries a team a game, as the FBS did;
 * - `make`: 76.1% of field goals, `xp`: 98.3% of extra points (the college kick is from the 3), `two`: 46.1% of two-point
 *   tries, gone for after about 8% of touchdowns (`early`, with the late-game chart); `safety`: 0.030 a team a game;
 * - `scale`: each rating point of edge moves a drive's odds this many times as far as in the NFL, fitted so conference
 *   seasons spread the schools' average margins as the FBS's did (an SD of 10.3 in 2024 and 10.7 in 2025, about 8.5
 *   conference games a school): EA rates the schools far closer together than they play;
 * - `homeEdge`: rating points a home side gains (the campaign's Home advantage, off by default), set so equal sides' home
 *   side wins by about 2.5 points (56% of the time), the home edge usually quoted for college football (not fitted here);
 * - college overtime (`overtime` 'college'): possessions from the opponent's 25 in the first two periods (`otTd`, `otFgTry`,
 *   `otMake`: a touchdown half the time between equals, else a field-goal try three times in four, made seven times in
 *   ten from about 42 yards; estimates, not fitted), two-point plays from the third, `maxOvertimes` periods at most, each
 *   `ot` minutes on the match clock (overtime has no clock: these only space its plays). An earlier season's rules name
 *   their overtime's periods (`otTwoFrom`, `otPlaysFrom`: collegeOvertimeRule); this rulebook names none, so it plays
 *   today's (collegeOvertimeOf in src/sports/americanFootball.js).
 */
export const COLLEGE_RULES = Object.freeze({
  league: 'FBS', year: null, overtime: 'college', ot: 4, maxOvertimes: 8,
  drives: 12.3, driveRange: Object.freeze([9, 16]),
  td: 0.2616, fgTry: 0.1748, edge: 0.51, kicker: 76, scale: 1.57,
  make: 0.761, makeRange: Object.freeze([0.55, 0.95]), xp: 0.983, xpRange: Object.freeze([0.92, 0.998]),
  two: 0.461, early: 0.076, chart: 1, safety: 0.00246, homeEdge: 0.7,
  otTd: 0.5, otFgTry: 0.75, otMake: 0.7, otMakeRange: Object.freeze([0.45, 0.9]),
});

/** The overtime period an event's minute falls in (1, 2, …), 0 in regulation. */
const periodOf = minute => (minute > MINUTES ? Math.ceil((minute - MINUTES) / COLLEGE_RULES.ot) : 0);

// ---------- the rules of a season's day ----------

const logit = p => Math.log(p / (1 - p));
const logistic = x => 1 / (1 + Math.exp(-x));
const { TD_SCALE, FG_SCALE, XP_PER_POINT } = DRIVE_MODEL;

/**
 * The NCAA's overtime in `year` (docs/design/college-football.md, "Rules by era"): the first period whose touchdowns must
 * go for two (`otTwoFrom`) and the first period of two-point plays, one a side from the 3 (`otPlaysFrom`, null for none).
 * Every period a possession each from the 25 and two from the third period to 2018 (the 1997 rules); from the fifth
 * period two-point plays in 2019 and 2020; from 2021 two from the second period and two-point plays from the third, today's.
 */
export function collegeOvertimeRule(year) {
  if (year <= 2018) return { otTwoFrom: 3, otPlaysFrom: null };
  if (year <= 2020) return { otTwoFrom: 3, otPlaysFrom: 5 };
  return { otTwoFrom: 2, otPlaysFrom: 3 };
}

/** Seasons' figures summed (src/data/collegeLeagueAverages.js). */
function totalsOf(years) {
  const out = {};
  for (const year of years) for (const [key, value] of Object.entries(COLLEGE_LEAGUE_AVERAGES[year])) out[key] = (out[key] ?? 0) + value;
  return out;
}

// A season's possessions a team-game and its rates a regulation possession: a touchdown (overtime's left out), and a
// field-goal try on one that ended in none.
const possessionsOf = s => s.possessions / s.games;
const touchdownsPerPossession = s => (s.td - s.otTd) / s.possessions;
const triesPerPossession = s => (s.fga - s.otFga) / (s.possessions - (s.td - s.otTd));
const safetiesPerPossession = s => s.safeties / s.possessions;

/**
 * A season's extra points made, or where its box scores name no miss (2011's) the mean of the seasons either side of it.
 */
function extraPointsOf(year) {
  const rate = s => (s && s.xpa ? s.xpm / s.xpa : null);
  const own = rate(COLLEGE_LEAGUE_AVERAGES[year]);
  if (own !== null) return own;
  const near = [year - 1, year + 1].map(y => rate(COLLEGE_LEAGUE_AVERAGES[y])).filter(r => r !== null);
  return near.reduce((sum, r) => sum + r, 0) / near.length;
}

/**
 * The rules of the FBS's `year` (a season from 2009, the latest's figures standing in for any later) for the data set
 * `dataSet` (cfb-<year>), or null before the table's first season. Every rate is measured from ESPN's tables the same way
 * in every season (src/data/collegeLeagueAverages.js), so only its move from 2024 and 2025's, the seasons College
 * Football 27's rules were fitted on, is taken:
 * - possessions a side (`drives`, `driveRange` as wide about them as today's): today's 12.3 times the season's
 *   possessions a team-game over 2024 and 2025's;
 * - the drive odds at its own average matchup (`edge`, COLLEGE_SEASON_MATCHUPS; the built-in schools' for a season
 *   without its own file), which sit from today's at the built-in schools' average matchup as far, in log odds, as its
 *   touchdowns a regulation possession (and its field-goal tries on one that ended in none) sit from 2024 and 2025's,
 *   less the allowance for its schools' spread beyond today's (spreadAllowance, at the college edge's slopes);
 * - field goals and extra points made by its average kicker (`kicker`), moved as far in log odds as its league's sit
 *   from 2024 and 2025's (2011's extra points those of 2010 and 2012), within today's ranges about them, a kicker's rating
 *   point moving extra points by as much more than today's as its league missed more (`xpSlope`);
 * - its safeties a possession, as many more or fewer than today's as its league's;
 * - its overtime (collegeOvertimeRule), its possessions from the 25 moved as its drives' and its kicks are (estimates, as
 *   today's are);
 * - two-point tries made and gone for as today: no source names them (the box scores' scoring leaves only a check:
 *   docs/design/college-football.md, "Rules by era").
 */
export function collegeSeasonRules(year, dataSet) {
  if (!Number.isInteger(year) || year < FIRST_COLLEGE_SEASON) return null;
  const season = Math.min(year, LATEST_COLLEGE_SEASON);
  const figures = COLLEGE_LEAGUE_AVERAGES[season];
  const reference = totalsOf(COLLEGE_REFERENCE_SEASONS);
  const referenceXp = reference.xpm / reference.xpa;
  const today = COLLEGE_SEASON_MATCHUPS['built-in'], matchup = COLLEGE_SEASON_MATCHUPS[dataSet] ?? today;
  const shift = rate => logit(rate(figures)) - logit(rate(reference));
  const tdShift = shift(touchdownsPerPossession), fgShift = shift(triesPerPossession);
  const makeShift = shift(s => s.fgm / s.fga), xpShift = logit(extraPointsOf(season)) - logit(referenceXp);
  // The edge's slopes in log odds, steepened by the college scale (driveOdds), and today's odds moved from the rulebook's
  // own matchup to the built-in schools' as measured, from which every season's move is taken.
  const tdSlope = TD_SCALE * COLLEGE_RULES.scale, fgSlope = FG_SCALE * COLLEGE_RULES.scale;
  const td = logit(COLLEGE_RULES.td) + tdSlope * (today.edge - COLLEGE_RULES.edge) + tdShift;
  const fgTry = logit(COLLEGE_RULES.fgTry) + fgSlope * (today.edge - COLLEGE_RULES.edge) + fgShift;
  const extraSpread = matchup.spread - today.spread;
  const drives = COLLEGE_RULES.drives * possessionsOf(figures) / possessionsOf(reference);
  const moved = (p, by) => logistic(logit(p) + by);
  const make = moved(COLLEGE_RULES.make, makeShift), xp = moved(COLLEGE_RULES.xp, xpShift), otMake = moved(COLLEGE_RULES.otMake, makeShift);
  // Today's ranges about each rate, as wide below and above it.
  const about = (value, [low, high], centre, ceiling) => Object.freeze([value - (centre - low), Math.min(ceiling, value + (high - centre))]);
  return Object.freeze({
    ...COLLEGE_RULES, year,
    drives, driveRange: Object.freeze([Math.round(drives - (COLLEGE_RULES.drives - COLLEGE_RULES.driveRange[0])),
      Math.round(drives + (COLLEGE_RULES.driveRange[1] - COLLEGE_RULES.drives))]),
    td: logistic(td + spreadAllowance(td, tdSlope, extraSpread)),
    fgTry: logistic(fgTry + spreadAllowance(fgTry, fgSlope, extraSpread)),
    edge: matchup.edge, kicker: matchup.kicking,
    make, makeRange: about(make, COLLEGE_RULES.makeRange, COLLEGE_RULES.make, 0.97),
    xp, xpRange: about(xp, COLLEGE_RULES.xpRange, COLLEGE_RULES.xp, 0.999), xpSlope: XP_PER_POINT * (1 - xp) / (1 - COLLEGE_RULES.xp),
    safety: COLLEGE_RULES.safety * safetiesPerPossession(figures) / safetiesPerPossession(reference),
    otTd: moved(COLLEGE_RULES.otTd, tdShift), otFgTry: moved(COLLEGE_RULES.otFgTry, fgShift),
    otMake, otMakeRange: about(otMake, COLLEGE_RULES.otMakeRange, COLLEGE_RULES.otMake, 0.95),
    ...collegeOvertimeRule(year),
  });
}

/** College football without its players. */
const collegeFootballRules = {
  ...americanFootballRules,
  id: 'college-football',
  simulationVersion: 1,
  name: 'College football',
  blurb: 'Eleven on offence, eleven on defence, sixty minutes. Level games go to college overtime: a possession each from the 25, then two-point plays.',
  /**
   * The rules a campaign plays (matchSport): an earlier season's day's (collegeFootballIn), today's for the built-in
   * season. Every rulebook below shares this.
   */
  rulesFor: settings => collegeFootballIn(settings),
  // Its clubs are the Football Bowl Subdivision's schools: the setup card's "138 FBS schools".
  clubLeague: 'FBS',
  clubNoun: 'schools',

  // `sudden`: overtime ends with the period that decides it, at its last score.
  clock: { length: MINUTES, msPerUnit: 65, ot: COLLEGE_RULES.ot, sudden: true },

  formatEvent: (e, code) => {
    const period = periodOf(e.m);
    return {
      when: period ? `${period > 1 ? period : ''}OT` : `Q${Math.min(4, Math.max(1, Math.ceil(e.m / QUARTER)))}`,
      text: `${scoreName(e.pts, true, e.kind)} — ${e.name} (${code})`,
    };
  },
  formatToast: e => `${scoreName(e.pts, false, e.kind)} — ${e.name.toUpperCase()}`,

  prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, COLLEGE_RULES),
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, COLLEGE_RULES), attacker, defender, drama);
  },
};

/** College football: the built-in season's FBS schools, under college rules. */
export const collegeFootball = defineSportData({ ...collegeFootballRules }, { rosters: false });

/**
 * One sport object per earlier season ('cfb-2013@2013', its data set and year), under that season's rules
 * (collegeSeasonRules); a year before the table plays today's. Version 2: each season plays its own day's scoring and
 * overtime.
 */
const seasonSports = rulesMemo(key => {
  const [dataSet, year] = key.split('@');
  const rules = collegeSeasonRules(Number(year), dataSet);
  if (!rules) return collegeFootball;
  return defineSportData({
    ...collegeFootballRules,
    simulationVersion: 2,
    clock: { ...collegeFootballRules.clock, ot: rules.ot },
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
    },
  }, { id: 'college-football', rosters: false });
});

/** An earlier college season's data set: cfb-<year>. */
const SEASON_SET = /^cfb-\d{4}$/;

/**
 * College football under the rules of a setup's or campaign's season (`dataSet`, `dataYear`): an earlier season
 * (cfb-<year>) plays its day's (collegeSeasonRules); the built-in season plays today's, `collegeFootball` itself. Read
 * through matchSport (src/sports/index.js).
 */
export function collegeFootballIn(settings) {
  const year = rulesYear(settings);
  return year == null || !SEASON_SET.test(settings.dataSet) ? collegeFootball : seasonSports(`${settings.dataSet}@${year}`);
}
