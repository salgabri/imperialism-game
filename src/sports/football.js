import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.js';
import { CLUBS } from '../data/clubs.football.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';
import { NATIONS, selectLineup } from '../data/teams.js';

const MINUTES = 90;
/**
 * Chances fall to the front line, and to quality above a 55-rating floor: forwards score about half the goals,
 * midfielders a third and defenders one in eight, as in Europe's top leagues.
 */
const SCORER_WEIGHTS = { FW: 5, MF: 1.7, DF: 0.6, GK: 0.06 };

const ATTACK_WEIGHTS = { FW: .56, MF: .36, DF: .08, GK: 0 };
const DEFENCE_WEIGHTS = { FW: .02, MF: .16, DF: .58, GK: .24 };
const BASE_GOALS = 1.28;
const RATING_SCALE = .075;
const MAX_LOG_EDGE = 1.5;
const TEMPO_SD = .18;
// Match-day form's spread, in log scoring rate: 0.28 at Balanced (drama 6). Goals are already Poisson luck; the old
// 0.45 made one game in eleven a four-goal rout and cut draws below a fifth. It grows with the square of the drama, so
// Wild (12) and an all-out Attack (11) still swing a match hard (1.12, 0.94) and Defend (2) barely does (0.03): a
// favourite that defends still steadies its odds.
const FORM_AT_BALANCED = .28;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// Real scores hold more 0-0 and 1-1 draws, and fewer 1-0 wins, than two independent Poisson counts (Dixon and
// Coles, 1997). The correction keeps each side's mean, and so its chance of winning a level game's shoot-out.
const LOW_SCORE_RHO = -.12;
// Home advantage, a campaign option (off: every match is at a neutral venue). The defender, at home, scores at a
// higher rate and concedes at a lower one, HOME_EDGE apart in log scoring rate: 0.39 goals a game. Between equal sides
// it then wins 44–45% of games in ninety minutes, as home sides do in Europe's top five leagues (41–48%), and 58% in all:
// the shoot-out stays even.
const HOME_EDGE = .3;

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

/**
 * Reuse the assigned starters and positional matchups across all odds trials. `venue.home`: the defender plays at home
 * (the campaign's home advantage); a neutral venue otherwise.
 */
export function prepareFootballMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const a = profile(lineupA, effA), d = profile(lineupD, effD);
  const edge = home ? HOME_EDGE / 2 : 0;
  // About 73% of shoot-out kicks are scored, as at the World Cups and Euros (68.6% and 77.0%).
  const penalties = (side, opposingKeeper) => {
    const ratings = side.takers.length ? side.takers.map(player => player.effectiveRating) : [40];
    return ratings.map(rating => clamp(.74 + (rating - 75) * .003 - (opposingKeeper - 75) * .0035, .55, .9));
  };
  return {
    aId: attacker.id, dId: defender.id, lineupA, lineupD,
    logA: (a.attack - d.defence) * RATING_SCALE - edge,
    logD: (d.attack - a.defence) * RATING_SCALE + edge,
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

/**
 * A score inside the 0–1 block redrawn from its Dixon–Coles masses for rates `la` and `ld`: the block's total mass is
 * unchanged, so a score outside it costs no draw.
 */
function lowScoreCorrection(rng, ga, gd, la, ld) {
  if (ga > 1 || gd > 1) return [ga, gd];
  const masses = [1 - la * ld * LOW_SCORE_RHO, la * (1 + ld * LOW_SCORE_RHO), ld * (1 + la * LOW_SCORE_RHO), la * ld * (1 - LOW_SCORE_RHO)];
  let roll = clamp(rng(), 0, 1 - Number.EPSILON) * (1 + la + ld + la * ld);
  for (const [i, mass] of masses.entries()) {
    roll -= mass;
    if (roll < 0 || i === 3) return [i === 1 || i === 3 ? 1 : 0, i >= 2 ? 1 : 0];
  }
}

/** Score-only path: the venue's edge (in `prepared`), correlated tempo and stochastic finishing. */
export function sampleFootballResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const tempo = Math.exp(clamp(gauss(rng), -2.5, 2.5) * TEMPO_SD - TEMPO_SD ** 2 / 2);
  // Smooth saturation keeps huge rating gaps plausible without a hard score cap
  // or a zero probability of an underdog scoring. Poisson goals remain random
  // even with the Predictable (zero form variation) setting.
  const rate = log => BASE_GOALS * tempo * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));
  const la = rate(prepared.logA + form), ld = rate(prepared.logD - form);
  const [ga, gd] = lowScoreCorrection(rng, poisson(rng, la), poisson(rng, ld), la, ld);
  const tie = ga === gd ? shootout(rng, prepared) : null;
  return { ga, gd, tie, winner: (tie ? tie.ga > tie.gd : ga > gd) ? prepared.aId : prepared.dId };
}

function goalMinute(rng) {
  // More opportunities arrive late as legs tire and teams chase the result: 29%, 33% and 38% of goals by thirds,
  // 45.5% before half-time, as in Europe's top leagues. Two goals may share a displayed minute, as they can in a real
  // match.
  const roll = clamp(rng(), 0, 1 - Number.EPSILON);
  if (roll < .29) return 1 + Math.floor(roll / .29 * 30);
  if (roll < .62) return 31 + Math.floor((roll - .29) / .33 * 30);
  return 61 + Math.floor((roll - .62) / .38 * 30);
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
  simulationVersion: 3,
  name: 'Football',
  blurb: 'Eleven a side, ninety minutes. Low scores, high drama — level games go to penalties.',
  rosters: ROSTERS,
  clubs: CLUBS,

  squadSize: 11,
  formation: { GK: 1, DF: 4, MF: 4, FW: 2 },
  positionPlan: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  positionColors: { GK: C.gold, DF: C.cyan, MF: C.green, FW: C.red },

  // Nothing here is invented: a nation no source rates fields no team, and its land stays neutral, as in women's
  // football. Tonga, Samoa and the Cook Islands are the three: EA FC 27 rates none of their players, and the FM 26
  // snapshot was taken before they were on the map.
  territory: { merged: {}, inactive: Object.keys(NATIONS).filter(id => !ROSTERS[id]?.[2]?.length) },
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

  // The feed's and the lineup's words (match, squad, ledger and conquest screens).
  words: { kickoff: 'Kick-off', end: 'Full time', lineup: 'Starting XI', lineupShort: 'XI', lineupNoun: 'XI', lineupTitle: 'XI' },

  /** `Q`-free: football events are simply minute-stamped goals. */
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' GOAL — ${e.name.toUpperCase()}`,

  prepareMatch: prepareFootballMatch,
  sampleResult: sampleFootballResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareFootballMatch(attacker, defender, effA, effD, venue);
    const result = sampleFootballResult(rng, prepared, drama);
    return { ...result, ev: goalEvents(rng, result, prepared) };
  },
};

/**
 * Squad-screen strength profile (PLAN §3.7, engine-diff §4c): the match model's own positional proxy
 * (`profile` above) with no effective-strength offset → { attack, defence, keeper } on the player-rating scale.
 * Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function footballProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected) return { attack: 0, defence: 0, keeper: 0 };
  const { attack, defence, keeper } = profile({ slots: selected.slots, starters: selected.starters || [] });
  return { attack, defence, keeper };
}
