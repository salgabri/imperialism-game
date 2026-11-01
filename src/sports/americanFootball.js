import { C } from '../theme.js';
import { CLUBS } from '../data/clubs.american-football.js';
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

// A drive's outcome against an average defence: a touchdown 22% of the time, else a field-goal try 21% of the
// time, made 85% of the time by an 80-rated kicker. That is about two points a drive, 22 a game.
const BASE_TD = 0.22;
const BASE_FG_TRY = 0.21;
// Each rating point of edge moves a drive's touchdown odds by 0.075 in logit, a field-goal try's by 0.025: a 17-game
// season then spreads the franchises as the NFL's do, and the rating favourite wins two games in three.
const TD_SCALE = 0.075;
const FG_SCALE = 0.025;
// Match-day form in rating points, shifting both sides' edges (the attacker's up, the defender's down).
const FORM_PER_DRAMA = 0.35;
// Late-game play-calling over each side's last three possessions of regulation, by its lead before the drive: two
// scores up it runs the clock, a score up it plays safe, level or within a field goal it plays for three, needing a
// touchdown it goes for it on fourth down, far behind it chases. NFL games end closer than independent drives would
// have them, about 11 points apart on average; who wins hardly moves. [lead at least, touchdown ×, field-goal try ×]
const LATE_DRIVES = 3;
const LATE_CALLS = [[9, 0.5, 1], [1, 0.8, 1], [0, 1, 1.6], [-3, 1, 1.6], [-8, 1.25, 0.25], [-Infinity, 1.2, 0.7]];

/** A drive's odds under late-game play-calling, for a side leading by `lead` (negative when behind). */
function lateCall(odds, lead) {
  const [, td, fgTry] = LATE_CALLS.find(([least]) => lead >= least);
  return { ...odds, td: Math.min(0.9, odds.td * td), fgTry: Math.min(0.95, odds.fgTry * fgTry) };
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

/** A side's chances on one drive with `edge` = its offence minus the opposing defence, and its kicker's rating. */
export function driveOdds(edge, kicking) {
  return {
    td: logistic(logit(BASE_TD) + TD_SCALE * edge),
    fgTry: logistic(logit(BASE_FG_TRY) + FG_SCALE * edge),
    make: clamp(0.85 + (kicking - 80) * 0.006, 0.6, 0.97),
  };
}

/** Mean and variance of one drive's points under `odds`. */
export function driveMoments({ td, fgTry, make }) {
  const fg = (1 - td) * fgTry * make;
  const mean = 7 * td + 3 * fg;
  return { mean, variance: 49 * td + 9 * fg - mean * mean, score: td + fg };
}

/** Prepare a matchup once, including position assignments, for cheap resampling. */
export function prepareMatch(attacker, defender, effA, effD) {
  const lineupA = selectLineup(attacker);
  const lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA), d = profile(lineupD);
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    lineupA,
    lineupD,
    drives: DRIVES,
    edgeA: a.offence + adjustmentA - (d.defence + adjustmentD),
    edgeD: d.offence + adjustmentD - (a.defence + adjustmentA),
    kickingA: a.kicking + adjustmentA,
    kickingD: d.kicking + adjustmentD,
  };
}

/** One possession: 7 for a touchdown (the extra point is taken as made), 3 for a field goal, else 0. */
function drive(rng, odds) {
  const roll = rng();
  if (roll < odds.td) return 7;
  if (roll < odds.td + (1 - odds.td) * odds.fgTry) return rng() < odds.make ? 3 : 0;
  return 0;
}

/**
 * An overtime period, playoff rules: both sides get a possession, the side that won the toss first; still level,
 * possessions alternate and the next score wins. `first` is 'A' or 'D'. → { a, d, drives: [{ side, pts }] }
 */
function overtimePeriod(rng, oddsA, oddsD, first) {
  const order = first === 'A' ? ['A', 'D'] : ['D', 'A'];
  const drives = [];
  let a = 0, d = 0;
  const play = side => {
    const pts = drive(rng, side === 'A' ? oddsA : oddsD);
    drives.push({ side, pts });
    if (side === 'A') a += pts; else d += pts;
  };
  play(order[0]);
  play(order[1]);
  for (let k = 0; k < SUDDEN_DEATH * 2 && a === d; k++) play(order[k % 2]);
  return { a, d, drives };
}

/**
 * Score-only path: possessions, form, drive luck and late-game play-calling. Also returns the scoring sequence
 * (`plays`: each possession in order, `{ side, pts, period }`, period 0 being regulation) so the full simulation can
 * time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const drives = Math.round(clamp(prepared.drives + gauss(rng) * DRIVE_SD, 8, 15));
  const form = gauss(rng) * variation * FORM_PER_DRAMA;
  const oddsA = driveOdds(prepared.edgeA + form, prepared.kickingA);
  const oddsD = driveOdds(prepared.edgeD - form, prepared.kickingD);
  const first = rng() < 0.5 ? 'A' : 'D';
  const plays = [];
  let regA = 0, regD = 0;
  for (let k = 0; k < drives * 2; k++) {
    const side = (k % 2 === 0) === (first === 'A') ? 'A' : 'D';
    const odds = side === 'A' ? oddsA : oddsD;
    const pts = drive(rng, k >= 2 * (drives - LATE_DRIVES) ? lateCall(odds, side === 'A' ? regA - regD : regD - regA) : odds);
    plays.push({ side, pts, period: 0 });
    if (side === 'A') regA += pts; else regD += pts;
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
      for (const { side, pts } of result.drives) plays.push({ side, pts, period: period + 1 });
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

/** The minute a possession ends: possessions share their period evenly, with a little jitter, never past its end. */
function playMinute(rng, index, count, offset, span) {
  const at = ((index + 1) / (count + 1)) * span + gauss(rng) * 0.6;
  return offset + clamp(Math.round(at), 1, span);
}

export const americanFootball = {
  id: 'american-football',
  simulationVersion: 2,
  name: 'American football',
  blurb: 'Eleven on offence, eleven on defence, sixty minutes. Touchdowns and field goals — level games go to overtime.',
  // No source rates national teams: American football is played by NFL clubs, on their own map of the USA.
  rosters: {},
  clubs: CLUBS,
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

  clock: { length: MINUTES, msPerUnit: 65, ot: OVERTIME },
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
    text: `${e.pts === 3 ? 'FG' : 'TD'} — ${e.name} (${code})`,
  }),
  formatToast: e => `${e.pts === 3 ? 'FIELD GOAL' : 'TOUCHDOWN'} — ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD) {
    const prepared = prepareMatch(attacker, defender, effA, effD);
    const { ga, gd, regA, regD, tie, plays, winner } = sampleResult(rng, prepared, drama);
    const scorerA = createScorerSampler(prepared.lineupA, TD_WEIGHTS, 50);
    const scorerD = createScorerSampler(prepared.lineupD, TD_WEIGHTS, 50);
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
        ev.push({
          m: playMinute(rng, index, count, offset, span),
          tid: own ? attacker.id : defender.id,
          name: play.pts === 3 ? (own ? kickerA : kickerD) : (own ? scorerA : scorerD)(rng),
          pts: play.pts,
        });
      });
    });
    ev.sort((x, y) => x.m - y.m);
    return { ga, gd, regA, regD, ev, tie, winner };
  },
};

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
export const DRIVE_MODEL = Object.freeze({ DRIVES, DRIVE_SD, OVERTIME, MAX_OVERTIMES, SUDDEN_DEATH, FORM_PER_DRAMA });
