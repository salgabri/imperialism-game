import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';
import { selectLineup } from '../data/teams.js';

const MINUTES = 60; // four fifteen-minute quarters
const QUARTER = 15;
const OVERTIME = 10;
const MAX_OVERTIMES = 3;
// Possessions per side in regulation. Quality changes what a drive yields, not how many there are.
const DRIVES = 11;
const DRIVE_SD = 1.1;
// Sudden-death possessions each side can still get in an overtime period after its first two.
const SUDDEN_DEATH = 2;

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

/**
 * A side's chances on one drive with `edge` = its offence minus the opposing defence, and its kicker's rating: a
 * touchdown, a field-goal try and its make, and a touchdown's extra point and two-point try.
 */
export function driveOdds(edge, kicking) {
  return {
    td: logistic(logit(BASE_TD) + TD_SCALE * edge),
    fgTry: logistic(logit(BASE_FG_TRY) + FG_SCALE * edge),
    make: clamp(0.85 + (kicking - 80) * 0.006, 0.6, 0.97),
    xp: clamp(BASE_XP + (kicking - 80) * 0.003, 0.85, 0.99),
    two: logistic(logit(BASE_TWO) + FG_SCALE * edge),
  };
}

/**
 * Mean and variance of one drive's points under `odds`, for the side with the ball (a safety counts −2), with the
 * early-game tries: two points after EARLY_TWO of the touchdowns, else the extra point.
 */
export function driveMoments({ td, fgTry, make, xp, two }) {
  const fg = (1 - td) * fgTry * make;
  const touchdown = 6 + (1 - EARLY_TWO) * xp + EARLY_TWO * 2 * two;
  const touchdownSquare = 36 + (1 - EARLY_TWO) * 13 * xp + EARLY_TWO * 28 * two;
  const mean = td * touchdown + 3 * fg - 2 * SAFETY;
  return { mean, variance: td * touchdownSquare + 9 * fg + 4 * SAFETY - mean * mean, score: td + fg };
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender plays at
 * home (the campaign's home advantage); a neutral venue otherwise.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
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
    drives: DRIVES,
    edgeA: a.offence + adjustmentA - (d.defence + adjustmentD) - edge,
    edgeD: d.offence + adjustmentD - (a.defence + adjustmentA) + edge,
    kickingA: a.kicking + adjustmentA,
    kickingD: d.kicking + adjustmentD,
  };
}

/**
 * One possession by `side`, `lead` points up before it → { side, pts } for the side that scores: a touchdown's 6 and
 * its try (`conversion` 'kick' or 'two'), a field goal's 3, or the defence's 2 for a safety; else 0 for the side with
 * the ball. `goForTwo(lead)`, given the lead the touchdown leaves, picks the try, or returns null when the touchdown
 * has won the game and there is none.
 */
function drive(rng, side, odds, goForTwo, lead = 0) {
  const roll = rng();
  if (roll >= 1 - SAFETY) return { side: side === 'A' ? 'D' : 'A', pts: 2 };
  if (roll < odds.td) {
    const two = goForTwo(lead + 6);
    if (two === null) return { side, pts: 6 };
    if (two) return { side, pts: rng() < odds.two ? 8 : 6, conversion: 'two' };
    return { side, pts: rng() < odds.xp ? 7 : 6, conversion: 'kick' };
  }
  return { side, pts: roll < odds.td + (1 - odds.td) * odds.fgTry && rng() < odds.make ? 3 : 0 };
}

/**
 * An overtime period, playoff rules: both sides get a possession, the side that won the toss first, which kicks
 * after a touchdown. The second plays to that score: level or a field goal down it plays for three, a touchdown down
 * it needs one, and its touchdown wins outright or is kicked to win or draw level. Still level, possessions alternate
 * and the next score wins. A score that wins ends the game, a touchdown without its try, and a safety wins it for the
 * defence. `first` is 'A' or 'D'. → { a, d, drives: [{ side, pts }] }
 */
function overtimePeriod(rng, oddsA, oddsD, first) {
  const order = first === 'A' ? ['A', 'D'] : ['D', 'A'];
  const drives = [];
  let a = 0, d = 0;
  const play = (side, odds, goForTwo) => {
    const result = drive(rng, side, odds, goForTwo);
    drives.push(result);
    if (result.side === 'A') a += result.pts; else d += result.pts;
  };
  const oddsOf = side => (side === 'A' ? oddsA : oddsD);
  play(order[0], oddsOf(order[0]), () => false);
  const behind = order[1] === 'A' ? d - a : a - d;
  // A touchdown down, a field goal cannot help: the second side goes for it on fourth down instead.
  const second = lateCall(oddsOf(order[1]), -behind);
  if (behind >= 0) play(order[1], behind > 3 ? { ...second, fgTry: 0 } : second, () => (behind < 6 ? null : false));
  for (let k = 0; k < SUDDEN_DEATH * 2 && a === d; k++) play(order[k % 2], oddsOf(order[k % 2]), () => null);
  return { a, d, drives };
}

/**
 * Score-only path: possessions, form, drive luck, tries and late-game play-calling. Also returns the scoring sequence
 * (`plays`: each possession in order, `{ side, pts, period, conversion? }` with `side` the side that scored, period 0
 * being regulation) so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const drives = Math.round(clamp(prepared.drives + gauss(rng) * DRIVE_SD, 8, 15));
  const form = gauss(rng) * variation * FORM_PER_DRAMA;
  const oddsA = driveOdds(prepared.edgeA + form, prepared.kickingA);
  const oddsD = driveOdds(prepared.edgeD - form, prepared.kickingD);
  const first = rng() < 0.5 ? 'A' : 'D';
  const plays = [];
  const earlyTwo = () => rng() < EARLY_TWO, lateTwo = lead => TWO_POINT_LEADS.includes(lead);
  let regA = 0, regD = 0;
  for (let k = 0; k < drives * 2; k++) {
    const side = (k % 2 === 0) === (first === 'A') ? 'A' : 'D';
    const odds = side === 'A' ? oddsA : oddsD;
    const lead = side === 'A' ? regA - regD : regD - regA;
    const late = k >= 2 * (drives - LATE_DRIVES);
    const play = drive(rng, side, late ? lateCall(odds, lead) : odds, late ? lateTwo : earlyTwo, lead);
    play.period = 0;
    plays.push(play);
    if (play.side === 'A') regA += play.pts; else regD += play.pts;
  }
  let ga = regA, gd = regD, tie = null;
  if (ga === gd) {
    const periods = [];
    for (let period = 0; period < MAX_OVERTIMES && ga === gd; period++) {
      const result = overtimePeriod(rng, oddsA, oddsD, rng() < 0.5 ? 'A' : 'D');
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

export const americanFootball = defineSportData({
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
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
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
      const offset = period ? MINUTES + (period - 1) * OVERTIME : 0;
      const span = period ? OVERTIME : MINUTES;
      // Overtime possessions are few: each takes about three minutes of its period.
      const count = period ? Math.max(list.length, 3) : list.length;
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
  },
}, { rosters: false });

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

/** The overtime and drive constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const DRIVE_MODEL = Object.freeze({ DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, SUDDEN_DEATH, FORM_PER_DRAMA, SAFETY });
