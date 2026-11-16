// College football (docs/design/college-football.md): the 138 FBS schools of EA SPORTS College Football 27, on their
// own map of the USA, playing American football's drive model (src/sports/americanFootball.js) under college rules:
// more possessions, the college game's kicking and tries, its home edge, a steeper edge for its wider spread of schools,
// and college overtime (possessions from the 25, two-point plays from the third period).
import { defineSportData } from './sportData.js';
import { americanFootballRules, playMatch, prepareMatch, sampleResult, scoreName } from './americanFootball.js';

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
 *   `ot` minutes on the match clock (overtime has no clock: these only space its plays).
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

/** College football without its players. */
const collegeFootballRules = {
  ...americanFootballRules,
  id: 'college-football',
  simulationVersion: 1,
  name: 'College football',
  blurb: 'Eleven on offence, eleven on defence, sixty minutes. Level games go to college overtime: a possession each from the 25, then two-point plays.',
  // One season, the built-in one: no earlier day's rules to look up.
  rulesFor: undefined,
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
