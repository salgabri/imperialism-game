import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.js';
import { CLUBS } from '../data/clubs.football.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';
import { selectLineup } from '../data/teams.js';

const MINUTES = 90;
/** Chances fall to the front line, and to quality above a 55-rating floor. */
const SCORER_WEIGHTS = { FW: 5, MF: 2.4, DF: 0.7, GK: 0.06 };

const ATTACK_WEIGHTS = { FW: .56, MF: .36, DF: .08, GK: 0 };
const DEFENCE_WEIGHTS = { FW: .02, MF: .16, DF: .58, GK: .24 };
const BASE_GOALS = 1.28;
const RATING_SCALE = .075;
const MAX_LOG_EDGE = 1.5;
const TEMPO_SD = .18;

function profile(lineup, effective) {
  const means = {};
  for (const position of ['GK', 'DF', 'MF', 'FW']) {
    const slots = lineup.slots.filter(slot => slot.position === position);
    means[position] = slots.reduce((sum, slot) => sum + slot.effectiveRating, 0) / Math.max(1, slots.length);
  }
  const offset = Number.isFinite(effective) ? effective - lineup.rating : 0;
  const weighted = weights => Object.entries(weights).reduce((sum, [pos, weight]) => sum + means[pos] * weight, 0) + offset;
  // Overall ratings are the available data; this is a positional proxy, not
  // invented finishing, passing or penalty attributes for individual players.
  const takers = lineup.starters.slice().sort((a, b) =>
    (b.effectiveRating + ({ FW: 5, MF: 3, DF: 0, GK: -5 }[b.assignedPos] || 0))
    - (a.effectiveRating + ({ FW: 5, MF: 3, DF: 0, GK: -5 }[a.assignedPos] || 0)));
  return { attack: weighted(ATTACK_WEIGHTS), defence: weighted(DEFENCE_WEIGHTS), keeper: means.GK, takers };
}

/** Reuse the assigned starters and positional matchups across all odds trials. */
export function prepareFootballMatch(attacker, defender, effA, effD) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const a = profile(lineupA, effA), d = profile(lineupD, effD);
  const penalties = (side, opposingKeeper) => {
    const ratings = side.takers.length ? side.takers.map(player => player.effectiveRating) : [40];
    return ratings.map(rating => clamp(.76 + (rating - 75) * .003 - (opposingKeeper - 75) * .0035, .55, .9));
  };
  return {
    aId: attacker.id, dId: defender.id, lineupA, lineupD,
    logA: (a.attack - d.defence) * RATING_SCALE,
    logD: (d.attack - a.defence) * RATING_SCALE,
    penaltyA: penalties(a, d.keeper), penaltyD: penalties(d, a.keeper),
  };
}

/** Alternating kicks, early clinches, then sudden death at equal kick counts. */
function shootout(rng, prepared) {
  const A = [];
  const D = [];
  let ga = 0;
  let gd = 0;
  const aFirst = rng() < .5;
  const result = () => ({ A, D, ga, gd, first: aFirst ? 'A' : 'D' });
  const kick = side => {
    const kicks = side === 'A' ? A : D;
    const probabilities = side === 'A' ? prepared.penaltyA : prepared.penaltyD;
    const scored = rng() < probabilities[kicks.length % probabilities.length] ? 1 : 0;
    kicks.push(scored);
    if (side === 'A') ga += scored; else gd += scored;
  };
  const clinched = () => ga > gd + (5 - D.length) || gd > ga + (5 - A.length);
  for (let round = 0; round < 5; round++) {
    kick(aFirst ? 'A' : 'D');
    if (clinched()) return result();
    kick(aFirst ? 'D' : 'A');
    if (clinched()) return result();
  }
  for (let round = 5; round < 25 && ga === gd; round++) {
    kick(aFirst ? 'A' : 'D');
    kick(aFirst ? 'D' : 'A');
  }
  if (ga === gd) {
    // Collapse an exceptionally long tied sequence to a decisive pair. Both
    // sides retain their conditional scoring chance; the attacker gets no gift.
    const pa = prepared.penaltyA[A.length % prepared.penaltyA.length];
    const pd = prepared.penaltyD[D.length % prepared.penaltyD.length];
    const aWins = rng() < pa * (1 - pd) / (pa * (1 - pd) + pd * (1 - pa));
    A.push(aWins ? 1 : 0);
    D.push(aWins ? 0 : 1);
    if (aWins) ga++; else gd++;
  }
  return result();
}

/** Score-only path: neutral venue, correlated tempo and stochastic finishing. */
export function sampleFootballResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * variation * RATING_SCALE;
  const tempo = Math.exp(clamp(gauss(rng), -2.5, 2.5) * TEMPO_SD - TEMPO_SD ** 2 / 2);
  // Smooth saturation keeps huge rating gaps plausible without a hard score cap
  // or a zero probability of an underdog scoring. Poisson goals remain random
  // even with the Predictable (zero form variation) setting.
  const rate = log => BASE_GOALS * tempo * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));
  const ga = poisson(rng, rate(prepared.logA + form));
  const gd = poisson(rng, rate(prepared.logD - form));
  const tie = ga === gd ? shootout(rng, prepared) : null;
  return { ga, gd, tie, winner: (tie ? tie.ga > tie.gd : ga > gd) ? prepared.aId : prepared.dId };
}

function goalMinute(rng) {
  // More opportunities arrive late as legs tire and teams chase the result.
  // Two goals may share a displayed minute, as they can in a real match.
  const roll = clamp(rng(), 0, 1 - Number.EPSILON);
  if (roll < .28) return 1 + Math.floor(roll / .28 * 30);
  if (roll < .60) return 31 + Math.floor((roll - .28) / .32 * 30);
  return 61 + Math.floor((roll - .60) / .40 * 30);
}

function goalEvents(rng, result, prepared) {
  const ev = [];
  for (const [id, lineup, goals] of [[prepared.aId, prepared.lineupA, result.ga], [prepared.dId, prepared.lineupD, result.gd]]) {
    const scorer = createScorerSampler(lineup, SCORER_WEIGHTS, 55);
    for (let i = 0; i < goals; i++) {
      ev.push({ m: goalMinute(rng), tid: id, name: scorer(rng), pts: 1 });
    }
  }
  return ev.sort((a, b) => a.m - b.m);
}

export const football = {
  id: 'football',
  simulationVersion: 2,
  name: 'Football',
  blurb: 'Eleven a side, ninety minutes. Low scores, high drama — level games go to penalties.',
  rosters: ROSTERS,
  clubs: CLUBS,

  squadSize: 11,
  formation: { GK: 1, DF: 4, MF: 4, FW: 2 },
  positionPlan: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  positionColors: { GK: C.gold, DF: C.cyan, MF: C.green, FW: C.red },

  /** Hand-tuned national strength for the nations with no dataset entry. */
  fallbackStrength: (rec, confMeta) => rec[4] || confMeta[rec[2]].baseStr,
  requiredPositions: ['GK'],

  clock: { length: MINUTES, msPerUnit: 46 },
  tieBreak: 'shootout',
  labels: {
    score: 'GOALS',
    start: 'KICK-OFF…',
    live: 'LIVE',
    end: 'FULL TIME',
    tie: 'PENALTIES',
    tieShort: 'PENS',
  },

  /** `Q`-free: football events are simply minute-stamped goals. */
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' GOAL — ${e.name.toUpperCase()}`,

  prepareMatch: prepareFootballMatch,
  sampleResult: sampleFootballResult,

  simulate(rng, attacker, defender, drama, effA, effD) {
    const prepared = prepareFootballMatch(attacker, defender, effA, effD);
    const result = sampleFootballResult(rng, prepared, drama);
    return { ...result, ev: goalEvents(rng, result, prepared) };
  },
};
