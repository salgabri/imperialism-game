import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { GREAT_BRITAIN, HOME_NATIONS, selectLineup } from '../data/teams.js';
import { NHL_LEAGUE_AVERAGES } from '../data/nhlLeagueAverages.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';

// Three twenty-minute periods, told in three-minute slices: the score decides how each slice is played. Level after
// sixty, five minutes of sudden-death overtime at three on three, then a shoot-out, whose winner gets one goal more on
// the final score, as the NHL counts it. An earlier season plays its own day's scoring and overtime (`hockeyIn`, "Rules
// by era" in docs/design/hockey.md).
const MINUTES = 60;
const PERIOD = 20;
const OVERTIME = 5;
const SLICE = 3;
const SLICES = MINUTES / SLICE;
// The clock's place for a shoot-out, after the overtime's last minute.
const SHOOTOUT_MINUTE = MINUTES + OVERTIME + 1;

// Goals in sixty minutes when a side's attack meets an equal defence, and how far each point of attack over the opposing
// defence moves that rate (log scale): a full 82-game season then spreads the clubs about as the NHL's are spread. A
// defence holds the goalie, usually rated above the skaters, so between average clubs the edge is about −2 points and
// the rate about 2.75, which the late game's chasing and empty nets lift to the NHL's three goals a team.
const BASE_GOALS = 3.06;
const RATING_SCALE = 0.058;
// Smooth saturation, as in football: a huge gap stays plausible, and the underdog can always score.
const MAX_LOG_EDGE = 1.2;
// Match-day form in log scoring rate at Balanced: a hot goalie, a cold power play. Grows with the square of the drama,
// as football's does, so Wild and an all-out Attack swing a game hard and Defend barely does.
const FORM_AT_BALANCED = 0.1;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Home advantage, a campaign option (off: a neutral venue): apart in log scoring rate, so that equal sides win about
// 55% at home, as NHL home sides do.
const HOME_EDGE = 0.1;

// Score effects. A level game late on tightens up (neither side gives away the point the overtime guarantees), and a
// side a goal down pushes while the leader sits back. They are what puts nearly a quarter of NHL games into overtime,
// where two independent scoring rates would send one in six.
const LATE_SLICE = 13; // from the 40th minute
const LEVEL_LATE = 0.72;
const TRAILING_LATE = 1.38;
const LEADING_LATE = 0.82;
// At any time, a side three or more up eases off: the NHL has fewer blowouts than its scoring rates alone would give.
const EASING_LEAD = 3;
const EASED = 0.8;
// The last slice: a side a goal or two down pulls its goalie.
const LAST_SLICE = SLICES - 1;
const PULLED_ATTACK = 1.5;
const EMPTY_NET = 0.55; // goals a slice into the empty net, on top of the leader's own

/** Today's late game, from 1999/2000: the score effects above, as `sliceMeans` reads them. */
const LATE_TODAY = Object.freeze({ level: LEVEL_LATE, leading: LEADING_LATE, trailing: TRAILING_LATE, pulled: PULLED_ATTACK,
  emptyNet: EMPTY_NET });
/**
 * Before 1999/2000, when a side losing in overtime got nothing (and before 1983/84 there was no overtime), a level game
 * late was a point each to keep, not one the overtime guaranteed, and the goalie was pulled later: every late effect plays
 * at LATE_BEFORE_1999_SHARE of today's distance from none. That puts the model's games level after sixty over the clubs
 * of 1966/67 to 1982/83, when every one ended a tie, at the league's 16.8% (1,817 ties in 10,826 games, the Hockey
 * Databank's Teams.csv), where today's late game gave 21%; and its empty-net goals at about 0.1 a game, as the databank's
 * goalies conceded 0.05 to 0.17 then (ENG), where today's give 0.25 (2014/15 to 2017/18: 0.24 to 0.30).
 */
const LATE_BEFORE_1999_SHARE = 0.35;
const LATE_BEFORE_1999 = Object.freeze({ level: 1 + (LEVEL_LATE - 1) * LATE_BEFORE_1999_SHARE,
  leading: 1 + (LEADING_LATE - 1) * LATE_BEFORE_1999_SHARE, trailing: 1 + (TRAILING_LATE - 1) * LATE_BEFORE_1999_SHARE,
  pulled: 1 + (PULLED_ATTACK - 1) * LATE_BEFORE_1999_SHARE, emptyNet: EMPTY_NET * LATE_BEFORE_1999_SHARE });

/** The late game of the season ending in `year` (null: the built-in season). */
export const lateOf = year => (year != null && year < 2000 ? LATE_BEFORE_1999 : LATE_TODAY);

// Overtime at three on three: about two games in three end in it.
const OVERTIME_BOOST = 2.4;
// A shoot-out is close to a coin flip: each point of the sides' difference moves it a little.
const SHOOTOUT_SLOPE = 0.03;

// Overtime by era: `minutes` a period, at most `periods` of them, the scoring rates × `boost` in them, then a shoot-out
// or (`shootout` false) none, the last period always ending in a goal. A conquest needs a winner, so a season before the
// NHL's shoot-out decides a level game by its playoffs' rule, as many twenty-minute periods at five on five as it takes.
// The NHL's regular season (Wikipedia's Overtime (ice hockey), https://en.wikipedia.org/w/index.php?oldid=1380480724,
// and its 1983–84, 1999–2000, 2005–06 and 2015–16 season articles, oldid 1377826696, 1374052089, 1374051010 and
// 1382868437, read 2026-11-10): no overtime from November 1942 to 1982/83, five minutes of sudden death at five on five
// from 1983/84 and at four on four from 1999/2000, a tie if goalless; the shoot-out after it from 2005/06; three on
// three from 2015/16. The playoffs have always played on in twenty-minute periods.
/** 2015/16 on, and the built-in season: five minutes at three on three, then a shoot-out. */
const THREE_ON_THREE = Object.freeze({ minutes: OVERTIME, periods: 1, boost: OVERTIME_BOOST, shootout: true });
/**
 * 2005/06 to 2014/15: five minutes at four on four, then a shoot-out. 1,306 of the 2,889 level games of those ten seasons
 * ended in the overtime, 45.2% (the Hockey Databank's Teams.csv: overtime losses less shoot-out losses, of overtime
 * losses), each season 38.9–49.8%; the boost puts the model's at 45% over those seasons' clubs.
 */
const FOUR_ON_FOUR = Object.freeze({ minutes: OVERTIME, periods: 1, boost: 1.41, shootout: true });
/**
 * Before 2005/06: the playoffs' overtime, twenty-minute periods at five on five; the fifth, as long as any NHL game since
 * 1967 has run, always ends in a goal. It kept its own pace whatever a season scored, so it plays the clubs' rates as a
 * season of PLAYOFF_LEVEL goals a club a game would (`boost` × PLAYOFF_LEVEL / the season's goals, `overtimeOf`). By
 * NHL.com's lists of every playoff overtime game (scripts/data/nhl-playoff-overtimes.json), 176 of the 196 of 1967–1989
 * (89.8%) were settled in the first period, in seasons of 2.8 to 4.0 goals a club, and 210 of the 276 of 1990–2004 (76.1%:
 * 76.2% to 1996, 76.0% after, as scoring fell from 3.7 to 2.6). Each boost puts the share over its seasons' clubs at its
 * playoffs'.
 */
const PLAYOFF_LEVEL = 3;
const playoffOvertime = boost => Object.freeze({ minutes: PERIOD, periods: 5, boost, shootout: false });
const PLAYOFFS_TO_1989 = playoffOvertime(1.17);
const PLAYOFFS_FROM_1990 = playoffOvertime(0.75);

/**
 * The overtime that decides a level game in the season ending in `year` (null: the built-in season), whose league scored
 * `goals` a club a game: the playoffs' at its era's pace.
 */
export function overtimeOf(year, goals = PLAYOFF_LEVEL) {
  if (year == null || year >= 2016) return THREE_ON_THREE;
  if (year >= 2006) return FOUR_ON_FOUR;
  const era = year >= 1990 ? PLAYOFFS_FROM_1990 : PLAYOFFS_TO_1989;
  return Object.freeze({ ...era, boost: era.boost * PLAYOFF_LEVEL / goals });
}

/** The built-in season's rules: today's scoring, late game and overtime. */
const TODAY = Object.freeze({ season: null, scoring: 1, late: LATE_TODAY, overtime: THREE_ON_THREE });

/** The strength of a nation with no NHL players, and of a lineup place a nation's own players cannot fill. */
export const BASELINE = 45;

// Who plays how much: the top line and the top pair take the most minutes.
const LINE_SHARE = [0.36, 0.3, 0.21, 0.13];
const PAIR_SHARE = [0.42, 0.35, 0.23];
const FORWARDS_IN_ATTACK = 0.85;
const FORWARDS_IN_DEFENCE = 0.3;
const GOALIE_IN_DEFENCE = 0.5;

const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);
const descending = (a, b) => b - a;

function profile(lineup) {
  const of = position => lineup.slots.filter(slot => slot.position === position).map(slot => slot.effectiveRating).sort(descending);
  const c = of('C'), lw = of('LW'), rw = of('RW'), d = of('D'), g = of('G');
  const forwards = LINE_SHARE.reduce((sum, share, i) => sum + share * mean([c[i] ?? 40, lw[i] ?? 40, rw[i] ?? 40]), 0);
  const defenders = PAIR_SHARE.reduce((sum, share, i) => sum + share * mean([d[2 * i] ?? 40, d[2 * i + 1] ?? 40]), 0);
  const goalie = g[0] ?? 40;
  const skaters = FORWARDS_IN_DEFENCE * forwards + (1 - FORWARDS_IN_DEFENCE) * defenders;
  return { forwards, defenders, goalie, attack: FORWARDS_IN_ATTACK * forwards + (1 - FORWARDS_IN_ATTACK) * defenders,
    defence: GOALIE_IN_DEFENCE * goalie + (1 - GOALIE_IN_DEFENCE) * skaters };
}

const rate = log => BASE_GOALS * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at home
 * (the campaign's home advantage); a neutral venue otherwise. `rules`: a season's scoring and overtime (`hockeyIn`),
 * today's unless told; carried on the match for `sampleResult` and the live win probability.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = TODAY) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  const edgeA = a.attack + adjustmentA - (d.defence + adjustmentD), edgeD = d.attack + adjustmentD - (a.defence + adjustmentA);
  const venue = home ? HOME_EDGE / 2 : 0;
  return {
    attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, rules,
    // A season's scoring level scales both rates (1 today).
    rateA: rate(edgeA * RATING_SCALE) * rules.scoring * Math.exp(-venue), rateD: rate(edgeD * RATING_SCALE) * rules.scoring * Math.exp(venue),
    // How far ahead the attacker is in a shoot-out, in rating points.
    shootout: edgeA - edgeD,
  };
}

/**
 * The goals each side should expect in slice `s` at sixty-minute rates `rateA`, `rateD`, the attacker `margin` goals
 * ahead → [attacker, defender], in today's late game or an era's (`late`, `lateOf`). Exported for the live win
 * probability, which plays the same slices.
 */
export function sliceMeans(rateA, rateD, margin, s, late = LATE_TODAY) {
  let a = rateA * SLICE / MINUTES, d = rateD * SLICE / MINUTES;
  if (margin >= EASING_LEAD) a *= EASED;
  else if (margin <= -EASING_LEAD) d *= EASED;
  if (s >= LATE_SLICE) {
    if (margin === 0) { a *= late.level; d *= late.level; }
    else if (margin === 1) { a *= late.leading; d *= late.trailing; }
    else if (margin === -1) { a *= late.trailing; d *= late.leading; }
  }
  if (s === LAST_SLICE) {
    if (margin === 1 || margin === 2) { d *= late.pulled; a += late.emptyNet; }
    else if (margin === -1 || margin === -2) { a *= late.pulled; d += late.emptyNet; }
  }
  return [a, d];
}

/**
 * The goals each side should expect in one period of overtime → [attacker, defender]: today's five minutes at three on
 * three, or an era's (`overtime`, `overtimeOf`).
 */
export function overtimeMeans(rateA, rateD, overtime = THREE_ON_THREE) {
  const scale = overtime.boost * overtime.minutes / MINUTES;
  return [rateA * scale, rateD * scale];
}

/** The attacker's chance in a shoot-out. */
export const shootoutOdds = edge => logistic(SHOOTOUT_SLOPE * edge);

/**
 * Score-only path: match-day form, then the regulation slices one by one, then sudden death and the shoot-out, or the
 * playoffs' twenty-minute periods (`prepared.rules.overtime`) until a goal. Also returns the goals in order (`goals`:
 * { side, slice }, overtime's slice SLICES, the shoot-out's SLICES + 1) and the overtime goal's share of its period
 * (`overtimeAt`; the period is the last of `tie.periods`), so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const { late, overtime } = prepared.rules ?? TODAY;
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = Math.exp(gauss(rng) * formSpread(variation));
  const rateA = prepared.rateA * form, rateD = prepared.rateD / form;
  const goals = [];
  let regA = 0, regD = 0;
  for (let s = 0; s < SLICES; s++) {
    const [meanA, meanD] = sliceMeans(rateA, rateD, regA - regD, s, late);
    const a = poisson(rng, meanA), d = poisson(rng, meanD);
    for (let k = 0; k < a; k++) goals.push({ side: 'A', slice: s });
    for (let k = 0; k < d; k++) goals.push({ side: 'D', slice: s });
    regA += a;
    regD += d;
  }
  let ga = regA, gd = regD, tie = null, overtimeAt = 0;
  if (ga === gd) {
    const [meanA, meanD] = overtimeMeans(rateA, rateD, overtime);
    const total = meanA + meanD, none = Math.exp(-total);
    if (!overtime.shootout) {
      // The playoffs' periods: each goalless one is [0, 0], and the last always ends in a goal, whenever in it.
      const periods = [];
      for (let period = 1; !tie; period++) {
        const roll = clamp(rng(), 0, 1 - Number.EPSILON);
        const last = period >= overtime.periods;
        if (!last && roll < none) {
          periods.push([0, 0]);
          continue;
        }
        overtimeAt = -Math.log(1 - (last ? roll * (1 - none) : roll - none)) / total;
        const side = rng() < meanA / total ? 'A' : 'D';
        goals.push({ side, slice: SLICES });
        if (side === 'A') ga++; else gd++;
        periods.push(side === 'A' ? [1, 0] : [0, 1]);
        tie = { periods, ga, gd };
      }
    } else {
      const roll = clamp(rng(), 0, 1 - Number.EPSILON);
      if (roll >= none) {
        // Sudden death: when the deciding goal falls within the five minutes, and whose it is.
        overtimeAt = -Math.log(1 - (roll - none)) / total;
        const side = rng() < meanA / total ? 'A' : 'D';
        goals.push({ side, slice: SLICES });
        if (side === 'A') ga++; else gd++;
        tie = { periods: [side === 'A' ? [1, 0] : [0, 1]], ga, gd };
      } else {
        const side = rng() < shootoutOdds(prepared.shootout) ? 'A' : 'D';
        goals.push({ side, slice: SLICES + 1 });
        if (side === 'A') ga++; else gd++;
        tie = { periods: [[0, 0], side === 'A' ? [1, 0] : [0, 1]], ga, gd };
      }
    }
  }
  return { ga, gd, regA, regD, tie, goals, overtimeAt, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/**
 * Who scores: forwards about four goals in five, defenders the rest, the goalies never. The floor is high because a
 * first-liner scores many times what a fourth-liner does, and nearly every NHL rating sits within twenty points.
 */
const SCORER_WEIGHTS = { C: 1, LW: 1, RW: 1, D: 0.3, G: 0.0001 };
const SCORER_FLOOR = 74;

/**
 * A complete match under `rules` from a prepared matchup: the score-only outcome, then each goal's minute and scorer. An
 * overtime goal falls in its period (the last of `tie.periods`), a shoot-out's on the minute after the overtime.
 */
function playMatch(rng, prepared, attacker, defender, drama) {
  const { overtime } = prepared.rules;
  const { ga, gd, regA, regD, tie, goals, overtimeAt, winner } = sampleResult(rng, prepared, drama);
  const scorerA = createScorerSampler(prepared.lineupA, SCORER_WEIGHTS, SCORER_FLOOR);
  const scorerD = createScorerSampler(prepared.lineupD, SCORER_WEIGHTS, SCORER_FLOOR);
  const ev = [];
  for (const { side, slice } of goals) {
    const own = side === 'A';
    const m = slice === SLICES + 1 ? SHOOTOUT_MINUTE
      : slice === SLICES ? MINUTES + (tie.periods.length - 1) * overtime.minutes + clamp(Math.ceil(overtimeAt * overtime.minutes), 1, overtime.minutes)
        : slice * SLICE + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * SLICE);
    ev.push({ m, tid: own ? attacker.id : defender.id, name: (own ? scorerA : scorerD)(rng), pts: 1 });
  }
  ev.sort((x, y) => x.m - y.m);
  return { ga, gd, regA, regD, ev, tie, winner };
}

/** Ice hockey without its players: every season's rules share it (`hockeyIn`), read at import. */
const hockeyRules = {
  id: 'hockey',
  simulationVersion: 1,
  name: 'Ice hockey',
  blurb: 'Four lines, three pairs and a goalie, three periods. Fast and low-scoring — level games go to overtime, then a shoot-out.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  // Ice hockey's Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire.
  territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
  // That empire plays as Great Britain, under the Union Jack.
  playsAs: { '826': GREAT_BRITAIN },
  /**
   * The rules a campaign plays (matchSport): an earlier season's scoring and overtime (`hockeyIn`), today's for the
   * built-in season. Every rulebook below shares this.
   */
  rulesFor: settings => hockeyIn(settings),

  squadSize: 19,
  formation: { C: 4, LW: 4, RW: 4, D: 6, G: 1 },
  positionPlan: ['C', 'C', 'C', 'C', 'LW', 'LW', 'LW', 'LW', 'RW', 'RW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'D', 'D', 'G'],
  positionColors: { C: C.red, LW: C.green, RW: C.green, D: C.cyan, G: C.gold },

  // A nation whose NHL players hold less than half the lineup fields no team (fieldedNations). Built anyway, one with
  // none would be all generated at this strength.
  fallbackStrength: () => BASELINE,
  requiredPositions: ['G'],

  // `sudden`: overtime ends with the goal that decides it. The chart ticks at the end of every period.
  clock: { length: MINUTES, msPerUnit: 68, ot: OVERTIME, sudden: true, tick: PERIOD },
  tieBreak: 'overtime',
  labels: {
    score: 'GOALS',
    start: 'PUCK DROP…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'OVERTIME',
    tieShort: 'OT',
  },

  words: { kickoff: 'Puck drop', end: 'Final', lineup: 'Starting lineup', lineupShort: 'Lineup', lineupNoun: 'starting lineup',
    lineupTitle: 'Lineup', overtime: 'Overtime', half: null },

  formatClock: m => (m >= SHOOTOUT_MINUTE ? 'SO' : `${m}'`),
  // The chart's axis: each period's end, then overtime and the shoot-out.
  formatTick: t => (t >= SHOOTOUT_MINUTE ? 'SO' : t > MINUTES ? 'OT' : `${t}'`),
  // A game level after sixty is decided in overtime or, a second period here, in a shoot-out, whose goal sits on the
  // clock at `shootoutAt` (the scorer lines leave it out).
  overtime: {
    text: periods => (periods > 1 ? 'in a shoot-out' : 'in overtime'),
    short: periods => (periods > 1 ? 'SO' : 'OT'),
    periodsOf: text => (/shoot-?out/i.test(text) ? 2 : /overtime/i.test(text) ? 1 : null),
    shootoutAt: SHOOTOUT_MINUTE,
  },
  formatEvent: (e, code) => (e.m >= SHOOTOUT_MINUTE
    ? { when: 'SO', text: `SHOOT-OUT — ${e.name} (${code})` }
    : { when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => (e.m >= SHOOTOUT_MINUTE ? `SHOOT-OUT — ${e.name.toUpperCase()}` : `${e.m}' GOAL — ${e.name.toUpperCase()}`),

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

export const hockey = defineSportData({ ...hockeyRules });

// The playoffs' overtime on the clock: each period's goals in minutes past sixty (the second's from 81'), no shoot-out.
const OVERTIME_NAMES = ['', 'double', 'triple', 'quadruple', 'quintuple'];
const overtimeName = periods => (periods > 1 ? `${OVERTIME_NAMES[periods - 1] ?? `${periods}-period`} overtime` : 'overtime');
const playoffShort = periods => (periods > 1 ? `${periods}OT` : 'OT');
const playoffClock = overtime => ({
  // `ot`: the chart extends by a whole period once the clock passes it, a tick at each period's end.
  clock: { length: MINUTES, msPerUnit: hockeyRules.clock.msPerUnit, ot: overtime.minutes, sudden: true, tick: PERIOD },
  formatClock: m => `${m}'`,
  // The chart's axis: each period's end, then each overtime period's ("OT", "2OT").
  formatTick: t => (t > MINUTES ? playoffShort(Math.ceil((t - MINUTES) / overtime.minutes)) : `${t}'`),
  overtime: {
    text: periods => `in ${overtimeName(periods)}`,
    short: playoffShort,
    // A save from before these rules may hold a shoot-out, which hockey counted as a second period.
    periodsOf: text => {
      const named = /(double|triple|quadruple|quintuple) overtime/i.exec(text)?.[1];
      return named ? OVERTIME_NAMES.indexOf(named.toLowerCase()) + 1 : /shoot-?out/i.test(text) ? 2 : /overtime/i.test(text) ? 1 : null;
    },
    // No shoot-out: every goal is its scorer's.
    shootoutAt: null,
  },
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' GOAL — ${e.name.toUpperCase()}`,
});

/**
 * Hockey under `rules` ({ season, scoring, late, overtime }): `scoring` scales both sides' scoring rates, `late` is the
 * late game's score effects (`lateOf`) and `overtime` decides a level game (`overtimeOf`). The playoffs' overtime brings
 * its own clock and labels; the four-on-four era keeps today's, its shoot-out on the same minute. Version 2: version 1
 * played every season as today's NHL.
 */
export function hockeyWith(rules) {
  return defineSportData({
    ...hockeyRules,
    simulationVersion: 2,
    ...(rules.overtime.shootout ? {} : playoffClock(rules.overtime)),
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
    },
  }, { id: 'hockey' });
}

/** The season label of the season ending in `year`: 1982 → '1981/82', 2000 → '1999/00'. */
const seasonLabel = year => `${year - 1}/${String(year).slice(-2)}`;

/**
 * The rules of the season ending in `year`: its league's scoring level (NHL_LEAGUE_AVERAGES' `scoring`, solved so its
 * clubs score as the league did; a season it does not list plays today's level) and its day's overtime.
 */
const seasonHockey = rulesMemo(year => {
  const season = seasonLabel(year);
  const league = Object.hasOwn(NHL_LEAGUE_AVERAGES, season) ? NHL_LEAGUE_AVERAGES[season] : null;
  return hockeyWith(Object.freeze({ season, scoring: league?.scoring ?? 1, late: lateOf(year), overtime: overtimeOf(year, league?.goals) }));
});

/**
 * Ice hockey as a setup's or campaign's season played it (`settings`: `dataSet`, `dataYear`; matchSport): 1981/82 at
 * its four goals a team and with the playoffs' overtime, 2010/11 at four on four before the shoot-out. The built-in
 * season, which has no data set, plays today's rules exactly (`hockey` itself).
 */
export function hockeyIn(settings) {
  const year = rulesYear(settings);
  return year == null ? hockey : seasonHockey(year);
}

/**
 * Squad-screen strength profile: the attack, the defence and the goalie the match model weighs → { attack, defence,
 * goaltending } on the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first.
 * Read-only; no RNG.
 */
export function hockeyProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => slot.position === 'G')) return { attack: 0, defence: 0, goaltending: 0 };
  const { attack, defenders, forwards, goalie } = profile(selected);
  return { attack, defence: FORWARDS_IN_DEFENCE * forwards + (1 - FORWARDS_IN_DEFENCE) * defenders, goaltending: goalie };
}

/**
 * The constants the live win-probability model mirrors (src/engine/winProbability.js). OVERTIME_BOOST: today's
 * overtime's, for a live model that names none (every one saved before the rules by era).
 */
export const PERIOD_MODEL = Object.freeze({ MINUTES, OVERTIME, SLICE, SLICES, SHOOTOUT_MINUTE, FORM_AT_BALANCED, OVERTIME_BOOST });
