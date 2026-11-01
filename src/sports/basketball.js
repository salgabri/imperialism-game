import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.basketball.js';
import { CLUBS } from '../data/clubs.basketball.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';
import { HOME_NATIONS, selectLineup } from '../data/teams.js';
import { LATEST_NBA_SEASON, NBA_LEAGUE_AVERAGES } from '../data/nbaLeagueAverages.js';

// Two rulebooks, one model. Nations play FIBA's four ten-minute quarters at about 73 possessions a game. Clubs are
// NBA franchises and play the NBA's four twelve-minute quarters at their season's league pace and scoring rate:
// 90 possessions and 103 points per 100 in 2003/04, 99 and 116 in 2025/26. `paceRange` bounds a game's sampled
// possessions and `scoring` scales the ratings' points per possession. Both play five-minute overtimes.
const FIBA = Object.freeze({ minutes: 40, quarter: 10, pace: 73, paceRange: [55, 94], scoring: 1 });
// 2K rates players against their own era, so ratings alone give an NBA starting five about 1.14 points a possession
// in any season. Scaling that by the season's league rate (points per 100) over 114 brings its games to the
// league's points a game, overtime included.
const NBA_RATE = 114;
const nbaRules = ({ pace, rating }) => Object.freeze({ minutes: 48, quarter: 12, pace, paceRange: [pace - 18, pace + 21],
  scoring: rating / NBA_RATE });
const PACE_SD = 4.5;
const OVERTIME_PACE_SD = 0.7;
const OVERTIME = 5;
const MAX_OVERTIMES = 4;
const BASE_EFFICIENCY = 1.11;
// A period's shooting luck: its points vary by possessions × (SHOT_BASE + SHOT_PER_EFFICIENCY × efficiency), and the
// two sides share the game's conditions (whistle, flow, garbage time). Between equal NBA sides the margin then varies
// by about 14 points and the total by about 19 under Balanced: a season's games end about 12.6 points apart, one in
// six within three and one in five by twenty or more, close to the league's last four seasons.
const SHOT_BASE = 0.36;
const SHOT_PER_EFFICIENCY = 0.25;
const CONDITIONS_SD = 0.042;
// Match-day form, in points a possession per point of Upsets drama.
const FORM_PER_DRAMA = 0.0095;
// The buzzer: a side trailing by one or by two at the end of regulation draws level 30% or 20% of the time (a
// putback, a free throw, a foul-line two). About one NBA game in twenty goes to overtime, as in the league, twice
// what the margin's spread alone gives, and one-point finishes are the rarest of the close margins.
const BUZZER_LEVEL = [0.3, 0.2];
// The bench is credited 32% of a side's runs; with the buzzer's baskets a starter's, it scores about 31% of the
// points, as NBA benches did in 2023-25 (30.1% and 31.2%). The starting five share the rest.
const BENCH_SHARE = 0.32;
// Home advantage, a campaign option (off: every match is at a neutral venue). The defender, at home, scores
// HOME_EFFICIENCY / 2 points a possession more and the visitors as much less: 2.4 points a game in the NBA, 1.8 under
// FIBA rules. Equal sides then win 56–57% at home, as NBA home sides do (54–58% in 2021/22–2024/25).
const HOME_EFFICIENCY = 0.024;
/** The scorer of a bench run: the dataset names each side's starting five only. */
export const BENCH = 'Bench';
const DECISIVE_SLOPE = 3;

// A possession is shared by the two sides; better offence raises efficiency,
// while the opponent's rim protection and perimeter defence lower it: 0.012 and
// 0.0078 points a possession per rating point, which spreads an NBA season's
// franchises as the league's (from about 67 wins to 19).
const OFFENCE_WEIGHTS = { PG: 0.25, SG: 0.25, SF: 0.2, PF: 0.15, C: 0.15 };
const DEFENCE_WEIGHTS = { PG: 0.15, SG: 0.15, SF: 0.2, PF: 0.22, C: 0.28 };

function weightedRating(lineup, weights) {
  return lineup.slots.reduce((sum, slot) => sum + slot.effectiveRating * weights[slot.position], 0);
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. FIBA rules unless told otherwise.
 * `venue.home`: the defender plays at home (the campaign's home advantage); a neutral venue otherwise.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = FIBA) {
  const lineupA = selectLineup(attacker);
  const lineupD = selectLineup(defender);
  const edge = home ? HOME_EFFICIENCY / 2 : 0;
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
    // Equal 74-rated fives average approximately 81 points in a FIBA regulation, 112 in a 2025/26 NBA one.
    // Quality changes points per possession, not the number of possessions.
    pace: rules.pace,
    efficiencyA: clamp(BASE_EFFICIENCY + (offenceA - 74) * 0.012 - (defenceD - 74) * 0.0078, 0.54, 1.67) * rules.scoring - edge,
    efficiencyD: clamp(BASE_EFFICIENCY + (offenceD - 74) * 0.012 - (defenceA - 74) * 0.0078, 0.54, 1.67) * rules.scoring + edge,
  };
}

function scorePeriod(rng, possessions, efficiency) {
  // Aggregate the variance of misses, free throws, twos and threes. A normal
  // approximation avoids simulating every possession and retains shooting
  // luck even at the lowest uncertainty setting. Rounding gives integer points.
  const variance = possessions * (SHOT_BASE + SHOT_PER_EFFICIENCY * efficiency);
  return Math.max(0, Math.round(possessions * efficiency + gauss(rng) * Math.sqrt(variance)));
}

/**
 * Lightweight outcome draw; no scorers, events or repeated lineup selection. `buzzer` is the basket that levelled
 * regulation at its last second ({ side: 'A' | 'D', pts }), counted in regA or regD; null when none fell.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const { rules } = prepared;
  const possessions = clamp(prepared.pace + gauss(rng) * PACE_SD, ...rules.paceRange);
  const conditions = gauss(rng) * CONDITIONS_SD;
  // Matchday form persists through overtime. Each side gets its own draw; the
  // uncertainty setting changes this component rather than removing shot luck.
  const formDeviation = variation * FORM_PER_DRAMA;
  const efficiencyA = clamp(prepared.efficiencyA + conditions + gauss(rng) * formDeviation, 0.42, 1.9);
  const efficiencyD = clamp(prepared.efficiencyD + conditions + gauss(rng) * formDeviation, 0.42, 1.9);
  let regA = scorePeriod(rng, possessions, efficiencyA);
  let regD = scorePeriod(rng, possessions, efficiencyD);
  const behind = Math.abs(regA - regD);
  let buzzer = null;
  if (behind >= 1 && behind <= BUZZER_LEVEL.length && rng() < BUZZER_LEVEL[behind - 1]) {
    buzzer = { side: regA < regD ? 'A' : 'D', pts: behind };
    if (regA < regD) regA += behind; else regD += behind;
  }
  let ga = regA;
  let gd = regD;
  let tie = null;
  if (ga === gd) {
    const periods = [];
    for (let period = 0; period < MAX_OVERTIMES && ga === gd; period++) {
      const overtimePossessions = clamp(possessions * OVERTIME / rules.minutes + gauss(rng) * OVERTIME_PACE_SD, 5, 14);
      let a = scorePeriod(rng, overtimePossessions, efficiencyA);
      let d = scorePeriod(rng, overtimePossessions, efficiencyD);
      if (period === MAX_OVERTIMES - 1 && a === d) {
        // A bounded final-period decisive scoring play. Its points belong to
        // that period and appear in the ticker. Swapping sides swaps the odds;
        // an equal matchup is a coin flip, never an automatic attacker win.
        const winChance = 1 / (1 + Math.exp(-DECISIVE_SLOPE * (efficiencyA - efficiencyD)));
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
  return { ga, gd, regA, regD, tie, buzzer, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/** Who takes the shot that levels at the buzzer: guards and wings first, by quality above a 45-rating floor. */
const SCORER_WEIGHTS = { SG: 2.8, SF: 2.5, PG: 2.3, PF: 2.0, C: 1.8 };
// A starter's share of the points: the best player's is largest, each rating point below him takes 7.5% off, guards
// and wings shoot a little more. The league's leading scorers then average 28 to 34 a night, as the NBA's do.
const STAR_PULL = 0.075;
const SHOT_SHARE = { PG: 1.1, SG: 1.1, SF: 1.05, PF: 0.95, C: 0.9 };
// The share moves from night to night: a hot hand or a cold one, about a third either way. One side in sixteen has a
// 40-point scorer, one in 140 a 50-point one, as in the NBA.
const HOT_HAND_SD = 0.36;

/**
 * Who is credited with each of a side's runs (`credit(pts)` → a name): the bench and each starter hold a share of the
 * side's points for the match, and each run goes to someone still short of his share, at random in proportion to how
 * far short. So a starter's points follow his share, as a box score's do, rather than lumping several whole runs on
 * one player: crediting each whole run at random among the five gave a side a 50-point scorer one game in eight.
 */
function runCredits(rng, lineup) {
  const starters = lineup.starters;
  const best = Math.max(...starters.map(p => p.effectiveRating));
  const weights = starters.map(p => (SHOT_SHARE[p.assignedPos] || 1) * Math.exp(STAR_PULL * (p.effectiveRating - best)
    + HOT_HAND_SD * gauss(rng)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const names = [BENCH, ...starters.map(p => p.name)];
  const shares = total > 0 ? [BENCH_SHARE, ...weights.map(w => (1 - BENCH_SHARE) * w / total)] : [1];
  const credited = names.map(() => 0);
  let points = 0;
  return pts => {
    points += pts;
    // Everyone's shortfall after this run sums to its points, so someone is always short.
    const short = shares.map((share, i) => Math.max(0, share * points - credited[i]));
    let roll = clamp(rng(), 0, 1 - Number.EPSILON) * short.reduce((sum, s) => sum + s, 0);
    let pick = short.length - 1;
    for (let i = 0; i < short.length; i++) {
      roll -= short[i];
      if (roll < 0) { pick = i; break; }
    }
    credited[pick] += pts;
    return names[pick];
  };
}

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

// A side's points over a period are a random walk, as its possessions are, tied to the period's total: the period is
// cut into stretches of about four minutes, each scoring its share with the shooting luck of its possessions (a
// Gaussian bridge), and a run falls when that path reaches its middle point. Spacing the runs evenly drew every lead as
// a straight line to the final score, and the side ahead at half-time won nine games in ten.
const STRETCH_MINUTES = 4;

/**
 * A side's points at each stretch's end, from 0 to `total`, over `count` stretches whose shooting luck has `variance`
 * in all. A stretch never loses points: a step below nothing is a drought.
 */
function scoringPath(rng, total, count, variance) {
  const steps = Array.from({ length: count }, () => gauss(rng) * Math.sqrt(variance / count));
  const drift = steps.reduce((sum, x) => sum + x, 0) / count;
  const path = [0];
  for (const step of steps) path.push(path.at(-1) + Math.max(0, total / count + step - drift));
  const end = path.at(-1);
  return path.map(points => (end > 0 ? points * total / end : 0));
}

/**
 * A complete match from a prepared matchup: the score-only outcome, then each side's points as timed runs, a third
 * of them the bench's. A basket that levelled regulation at the buzzer is its last event, a starter's.
 */
function playMatch(rng, prepared, attacker, defender, drama) {
  const { minutes } = prepared.rules;
  const { ga, gd, regA, regD, tie, buzzer, winner } = sampleResult(rng, prepared, drama);
  const creditA = runCredits(rng, prepared.lineupA);
  const creditD = runCredits(rng, prepared.lineupD);
  const ev = [];
  const push = (teamId, total, credit, offset, span, efficiency) => {
    const count = Math.max(1, Math.round(span / STRETCH_MINUTES));
    const width = span / count;
    const path = scoringPath(rng, total, count, total * (SHOT_BASE / efficiency + SHOT_PER_EFFICIENCY));
    let scored = 0, k = 0;
    for (const pts of toRuns(rng, total)) {
      const middle = scored + pts / 2;
      scored += pts;
      while (k < count - 1 && path[k + 1] < middle) k++;
      const at = width * (k + (middle - path[k]) / Math.max(1e-9, path[k + 1] - path[k]));
      ev.push({ m: offset + clamp(Math.ceil(at), 1, span), tid: teamId, name: credit(pts), pts });
    }
  };
  const late = side => (buzzer?.side === side ? buzzer.pts : 0);
  push(attacker.id, regA - late('A'), creditA, 0, minutes, prepared.efficiencyA);
  push(defender.id, regD - late('D'), creditD, 0, minutes, prepared.efficiencyD);
  if (buzzer) {
    const own = buzzer.side === 'A';
    const shooter = createScorerSampler(own ? prepared.lineupA : prepared.lineupD, SCORER_WEIGHTS, 45);
    ev.push({ m: minutes, tid: own ? attacker.id : defender.id, name: shooter(rng), pts: buzzer.pts });
  }
  if (tie) {
    tie.periods.forEach(([a, d], i) => {
      const offset = minutes + i * OVERTIME;
      push(attacker.id, a, creditA, offset, OVERTIME, prepared.efficiencyA);
      push(defender.id, d, creditD, offset, OVERTIME, prepared.efficiencyD);
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
  simulationVersion: 3,
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

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

const nbaSeasons = new Map();

/**
 * Basketball between NBA franchises in `season` ('2003/04'): the same model under NBA rules, at that season's pace
 * and scoring rate. A season without league averages, such as the built-in 2026/27, plays the latest full season's.
 * Club campaigns play it (`matchSport` in src/sports/index.js), nations `basketball`. The clock runs faster, so a
 * match lasts about as long on screen. Version 4: version 3 played every season at one pace. Version 5: NBA-sized
 * margins, the buzzer's equalisers and the bench's points.
 */
export function nbaBasketballIn(season) {
  const key = Object.hasOwn(NBA_LEAGUE_AVERAGES, season) ? season : LATEST_NBA_SEASON;
  if (!nbaSeasons.has(key)) {
    const rules = nbaRules(NBA_LEAGUE_AVERAGES[key]);
    nbaSeasons.set(key, {
      ...basketball,
      simulationVersion: 5,
      clock: { length: rules.minutes, msPerUnit: 79 },
      formatEvent: eventFormat(rules),
      prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

      simulate(rng, attacker, defender, drama, effA, effD, venue) {
        return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
      },
    });
  }
  return nbaSeasons.get(key);
}

/** Basketball between NBA franchises in the built-in season. */
export const nbaBasketball = nbaBasketballIn();

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const BASKETBALL_MODEL = Object.freeze({ PACE_SD, OVERTIME_PACE_SD, OVERTIME, MAX_OVERTIMES, SHOT_BASE,
  SHOT_PER_EFFICIENCY, FORM_PER_DRAMA, BUZZER_LEVEL: Object.freeze(BUZZER_LEVEL.slice()), DECISIVE_SLOPE });

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
