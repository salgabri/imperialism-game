import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.basketball.js';
import { CLUBS } from '../data/clubs.basketball.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';
import { HOME_NATIONS, selectLineup } from '../data/teams.js';

// Two rulebooks, one model. Nations play FIBA's four ten-minute quarters at about 73 possessions a game. Clubs are
// NBA franchises and play the NBA's four twelve-minute quarters at its faster pace, about 100 possessions (99.6 in
// 2024/25). `paceRange` bounds a game's sampled possessions. Both play five-minute overtimes.
const FIBA = Object.freeze({ minutes: 40, quarter: 10, pace: 73, paceRange: [55, 94] });
const NBA = Object.freeze({ minutes: 48, quarter: 12, pace: 100, paceRange: [82, 121] });
const PACE_SD = 4.5;
const OVERTIME = 5;
const MAX_OVERTIMES = 4;
const BASE_EFFICIENCY = 1.11;

// A possession is shared by the two sides; better offence raises efficiency,
// while the opponent's rim protection and perimeter defence lower it.
const OFFENCE_WEIGHTS = { PG: 0.25, SG: 0.25, SF: 0.2, PF: 0.15, C: 0.15 };
const DEFENCE_WEIGHTS = { PG: 0.15, SG: 0.15, SF: 0.2, PF: 0.22, C: 0.28 };

function weightedRating(lineup, weights) {
  return lineup.slots.reduce((sum, slot) => sum + slot.effectiveRating * weights[slot.position], 0);
}

/** Prepare a matchup once, including position assignments, for cheap resampling. FIBA rules unless told otherwise. */
export function prepareMatch(attacker, defender, effA, effD, rules = FIBA) {
  const lineupA = selectLineup(attacker);
  const lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const offenceA = weightedRating(lineupA, OFFENCE_WEIGHTS) + adjustmentA;
  const offenceD = weightedRating(lineupD, OFFENCE_WEIGHTS) + adjustmentD;
  const defenceA = weightedRating(lineupA, DEFENCE_WEIGHTS) + adjustmentA;
  const defenceD = weightedRating(lineupD, DEFENCE_WEIGHTS) + adjustmentD;
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    lineupA,
    lineupD,
    rules,
    // Equal 74-rated fives average approximately 81 points in a FIBA regulation, 111 in an NBA one.
    // Quality changes points per possession, not the number of possessions.
    pace: rules.pace,
    efficiencyA: clamp(BASE_EFFICIENCY + (offenceA - 74) * 0.010 - (defenceD - 74) * 0.0065, 0.54, 1.67),
    efficiencyD: clamp(BASE_EFFICIENCY + (offenceD - 74) * 0.010 - (defenceA - 74) * 0.0065, 0.54, 1.67),
  };
}

function scorePeriod(rng, possessions, efficiency) {
  // Aggregate the variance of misses, free throws, twos and threes. A normal
  // approximation avoids simulating every possession and retains shooting
  // luck even at the lowest uncertainty setting. Rounding gives integer points.
  const variance = possessions * (0.72 + 0.5 * efficiency);
  return Math.max(0, Math.round(possessions * efficiency + gauss(rng) * Math.sqrt(variance)));
}

/** Lightweight outcome draw; no scorers, events or repeated lineup selection. */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const { rules } = prepared;
  const possessions = clamp(prepared.pace + gauss(rng) * PACE_SD, ...rules.paceRange);
  const conditions = gauss(rng) * 0.018;
  // Matchday form persists through overtime. Each side gets its own draw; the
  // uncertainty setting changes this component rather than removing shot luck.
  const formDeviation = variation * 0.0125;
  const efficiencyA = clamp(prepared.efficiencyA + conditions + gauss(rng) * formDeviation, 0.42, 1.9);
  const efficiencyD = clamp(prepared.efficiencyD + conditions + gauss(rng) * formDeviation, 0.42, 1.9);
  const regA = scorePeriod(rng, possessions, efficiencyA);
  const regD = scorePeriod(rng, possessions, efficiencyD);
  let ga = regA;
  let gd = regD;
  let tie = null;
  if (ga === gd) {
    const periods = [];
    for (let period = 0; period < MAX_OVERTIMES && ga === gd; period++) {
      const overtimePossessions = clamp(possessions * OVERTIME / rules.minutes + gauss(rng) * 0.7, 5, 14);
      let a = scorePeriod(rng, overtimePossessions, efficiencyA);
      let d = scorePeriod(rng, overtimePossessions, efficiencyD);
      if (period === MAX_OVERTIMES - 1 && a === d) {
        // A bounded final-period decisive scoring play. Its points belong to
        // that period and appear in the ticker. Swapping sides swaps the odds;
        // an equal matchup is a coin flip, never an automatic attacker win.
        const winChance = 1 / (1 + Math.exp(-3 * (efficiencyA - efficiencyD)));
        const attackerScores = rng() < winChance;
        const shot = rng();
        const points = shot < 0.15 ? 1 : shot < 0.75 ? 2 : 3;
        if (attackerScores) a += points;
        else d += points;
      }
      periods.push([a, d]);
      ga += a;
      gd += d;
    }
    tie = { periods, ga, gd };
  }
  return { ga, gd, regA, regD, tie, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/** Guards and wings carry the scoring load; the floor is lower than football's. */
const SCORER_WEIGHTS = { SG: 2.8, SF: 2.5, PG: 2.3, PF: 2.0, C: 1.8 };

// A basket-by-basket ticker would fire eighty events in a few seconds, so scoring
// is logged as runs — a real basketball unit, and readable at speed.
const MIN_RUN = 2;
const MAX_RUN = 9;

/** Split a final score into plausible scoring runs. */
function toRuns(rng, total) {
  const runs = [];
  let left = total;
  while (left > 0) {
    const size = Math.min(left, MIN_RUN + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * (MAX_RUN - MIN_RUN + 1)));
    // A final single point is a free throw, so every integer score is valid.
    runs.push(size);
    left -= size;
  }
  return runs;
}

/** A complete match from a prepared matchup: the score-only outcome, then each side's points as timed runs. */
function playMatch(rng, prepared, attacker, defender, drama) {
  const { minutes } = prepared.rules;
  const { ga, gd, regA, regD, tie, winner } = sampleResult(rng, prepared, drama);
  const scorerA = createScorerSampler(prepared.lineupA, SCORER_WEIGHTS, 45);
  const scorerD = createScorerSampler(prepared.lineupD, SCORER_WEIGHTS, 45);
  const ev = [];
  const push = (teamId, total, scorer, offset, span) => {
    const runs = toRuns(rng, total);
    runs.forEach((pts, i) => {
      ev.push({
        m: offset + Math.min(span, Math.max(1, Math.round(((i + 1) / (runs.length + 1)) * span + gauss(rng)))),
        tid: teamId,
        name: scorer(rng),
        pts,
      });
    });
  };
  push(attacker.id, regA, scorerA, 0, minutes);
  push(defender.id, regD, scorerD, 0, minutes);
  if (tie) {
    tie.periods.forEach(([a, d], i) => {
      const offset = minutes + i * OVERTIME;
      push(attacker.id, a, scorerA, offset, OVERTIME);
      push(defender.id, d, scorerD, offset, OVERTIME);
    });
  }
  ev.sort((x, y) => x.m - y.m);

  return { ga, gd, ev, tie, winner };
}

/** Ticker lines under `rules`: the quarter a run ends in (OT after regulation) and its points. */
const eventFormat = rules => (e, code) => ({
  when: e.m > rules.minutes ? 'OT' : `Q${Math.min(4, Math.ceil(e.m / rules.quarter))}`,
  text: `+${e.pts} — ${e.name} (${code})`,
});

export const basketball = {
  id: 'basketball',
  simulationVersion: 2,
  name: 'Basketball',
  blurb: 'Starting fives: forty minutes between nations, forty-eight in the NBA. Level games go to overtime.',
  rosters: ROSTERS,
  clubs: CLUBS,
  // Great Britain is one FIBA team: the home nations' shapes start in the United Kingdom's (826) empire.
  territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },

  squadSize: 5,
  formation: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  positionPlan: ['PG', 'SG', 'SF', 'PF', 'C'],
  positionColors: { PG: C.gold, SG: C.cyan, SF: C.green, PF: C.red, C: '#B07CD8' },

  // Nations outside the curated list are basketball minnows, well below the
  // forty federations that field real players.
  fallbackStrength: (rec, confMeta) => Math.max(40, confMeta[rec[2]].baseStr - 8),
  requiredPositions: [],

  clock: { length: FIBA.minutes, msPerUnit: 95 },
  tieBreak: 'overtime',
  labels: {
    score: 'POINTS',
    start: 'TIP-OFF…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'OVERTIME',
    tieShort: 'OT',
  },

  // DEC misc: basketball lineups read "Starting five".
  words: { kickoff: 'Tip-off', end: 'Final', lineup: 'Starting five', lineupShort: 'Five', lineupNoun: 'starting five',
    lineupTitle: 'Starting five' },

  formatEvent: eventFormat(FIBA),
  formatToast: e => `+${e.pts} ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD), attacker, defender, drama);
  },
};

/**
 * Basketball between NBA franchises: the same model under NBA rules. Club campaigns play it (`matchSport` in
 * src/sports/index.js), nations `basketball`. The clock runs faster, so a match lasts about as long on screen.
 * Version 3: club results differ from those of the same seed before NBA rules.
 */
export const nbaBasketball = {
  ...basketball,
  simulationVersion: 3,
  clock: { length: NBA.minutes, msPerUnit: 79 },
  formatEvent: eventFormat(NBA),
  prepareMatch: (attacker, defender, effA, effD) => prepareMatch(attacker, defender, effA, effD, NBA),

  simulate(rng, attacker, defender, drama, effA, effD) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, NBA), attacker, defender, drama);
  },
};

/**
 * Squad-screen strength profile (PLAN §3.7, engine-diff §4c): the offence and defence ratings `prepareMatch`
 * turns into efficiencies, before any effective-strength adjustment → { offence, defence } on the player-rating
 * scale. Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function basketballProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.every(slot => slot.position in OFFENCE_WEIGHTS)) return { offence: 0, defence: 0 };
  return { offence: weightedRating(selected, OFFENCE_WEIGHTS), defence: weightedRating(selected, DEFENCE_WEIGHTS) };
}
