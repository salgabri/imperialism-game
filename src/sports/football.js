import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.js';
import { CLUBS } from '../data/clubs.football.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';
import { HISTORIC_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { rulesMemo, rulesYear } from './eras.js';

const MINUTES = 90;
// Every match is a knockout game: level after ninety minutes, it goes to extra time, two halves of fifteen minutes
// ("Overtime (sports)", https://en.wikipedia.org/w/index.php?oldid=1383118578, read 2026-11-10; IFAB Law 10), then to
// the tie-break of its season's day (KNOCKOUTS below).
const EXTRA_HALF = 15;
const EXTRA_HALVES = 2;
const EXTRA_TIME = EXTRA_HALF * EXTRA_HALVES;
// Extra time's scoring rate a minute, as a share of the match's own over the ninety (its tempo and form included). The
// men's World Cup knockout games played to the plain rule (1986–1994 and 2006–2022, no golden goal) went to extra time
// 45 times in 128, and 29 of the 45 were still level after it, 64.4% (the Fjelstul World Cup Database, CC BY-SA 4.0:
// matches.csv). At this share 63.7% of the extra times between the strongest 32 nations end level, 64.4% between the
// strongest 16 (docs/design/match-simulation.md, "Knockout rules by era"). Those extra times scored 0.51 goals a game, where
// the World Cups' scored 0.76 (34 goals, goals.csv): theirs were more often goalless, and more open when not, than one
// Poisson rate gives.
const EXTRA_RATE = 0.55;
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
// it then wins 44–45% of games in ninety minutes, as home sides do in Europe's top five leagues (41–48%), and 59% in all:
// extra time's goals carry the same edge (52% of the level games go its way), and the shoot-out stays even.
const HOME_EDGE = .3;

/**
 * How a game still level after extra time is settled, by its season's day (the year its season ends: `rulesYear`).
 * `sudden`: 'golden', the first goal of extra time wins it; 'silver', a side ahead at extra time's half-time wins it;
 * null, both halves are played. `decider`: what settles a game level after both, 'penalties' or 'lots' (a coin toss,
 * even: no replays here). Sources, each read 2026-11-10 (docs/design/match-simulation.md, "Knockout rules by era"):
 * - Lots to 1969/70: the World Cups of 1962, 1966 and 1970 drew lots for a knockout game other than the final still level
 *   after extra time, and would have replayed a final ("1962 FIFA World Cup", oldid=1383581364; "1966 FIFA World Cup",
 *   oldid=1381218843; "1970 FIFA World Cup knockout stage", oldid=1377001935: a coin toss by the referee).
 * - Penalties from 1970/71: the IFAB adopted the shoot-out at its annual general meeting on 27 June 1970, too late for
 *   that World Cup; UEFA's cups used it from 1970/71 ("Penalty shoot-out (association football)", oldid=1384920413).
 * - The golden goal from 1995/96 to 2001/02: FIFA brought it in in 1993, but the 1994 World Cup played the whole of extra
 *   time; Euro 96 was the first major tournament to play it, and the World Cups of 1998 and 2002 and Euro 2000 did too
 *   ("Golden goal", oldid=1384247203; "1994 FIFA World Cup knockout stage", oldid=1381250129; "UEFA Euro 1996 knockout
 *   stage", oldid=1346462046).
 * - The silver goal in 2002/03 and 2003/04: UEFA's rule from the 2002–03 season, played at Euro 2004; the IFAB took both
 *   out of the Laws after it ("Golden goal"; "UEFA Euro 2004 knockout stage", oldid=1364793738). FIFA's own 2003
 *   tournaments kept the golden goal.
 * The links are https://en.wikipedia.org/w/index.php?oldid=<revision>.
 */
const KNOCKOUTS = Object.freeze({
  lots: Object.freeze({ id: 'lots', sudden: null, decider: 'lots' }),
  penalties: Object.freeze({ id: 'penalties', sudden: null, decider: 'penalties' }),
  golden: Object.freeze({ id: 'golden', sudden: 'golden', decider: 'penalties' }),
  silver: Object.freeze({ id: 'silver', sudden: 'silver', decider: 'penalties' }),
});

/** The knockout rules of a season ending in `year` (1970 for 1969/70); today's for the built-in season (null). */
export function knockoutIn(year) {
  if (!Number.isInteger(year)) return KNOCKOUTS.penalties;
  if (year <= 1970) return KNOCKOUTS.lots;
  if (year >= 1996 && year <= 2002) return KNOCKOUTS.golden;
  if (year === 2003 || year === 2004) return KNOCKOUTS.silver;
  return KNOCKOUTS.penalties;
}

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
 * (the campaign's home advantage); a neutral venue otherwise. `rules`: the knockout rules of the season's day (today's
 * unless told otherwise), carried on the prepared match so the score sampler and the live win chart read them.
 */
export function prepareFootballMatch(attacker, defender, effA, effD, { home = false } = {}, rules = KNOCKOUTS.penalties) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const a = profile(lineupA, effA), d = profile(lineupD, effD);
  const edge = home ? HOME_EDGE / 2 : 0;
  // About 73% of shoot-out kicks are scored, as at the World Cups and Euros (68.6% and 77.0%).
  const penalties = (side, opposingKeeper) => {
    const ratings = side.takers.length ? side.takers.map(player => player.effectiveRating) : [40];
    return ratings.map(rating => clamp(.74 + (rating - 75) * .003 - (opposingKeeper - 75) * .0035, .55, .9));
  };
  return {
    aId: attacker.id, dId: defender.id, lineupA, lineupD, rules,
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

/**
 * Extra time after a level ninety, at the match's own scoring rates `la` and `ld` (goals in ninety minutes) times
 * EXTRA_RATE: each half's goals (`periods`), and the minute it ended (`end`). Under the golden goal (`sudden`) the first
 * goal ends it, at the minute it falls; under the silver goal a lead at its half-time does. → { periods, a, d, end, by }
 * with `by` the goal that settled it early ('golden-goal', 'silver-goal'), else null.
 */
function extraTime(rng, la, ld, sudden) {
  const share = EXTRA_RATE * EXTRA_HALF / MINUTES;
  const meanA = la * share, meanD = ld * share;
  if (sudden === 'golden') {
    // Sudden death over both halves: whether a goal comes, when (a share of extra time) and whose it is.
    const total = (meanA + meanD) * EXTRA_HALVES, none = Math.exp(-total);
    const roll = clamp(rng(), 0, 1 - Number.EPSILON);
    if (roll < none) return { periods: [[0, 0], [0, 0]], a: 0, d: 0, end: MINUTES + EXTRA_TIME, by: null };
    const at = -Math.log(1 - (roll - none)) / total;
    const goal = rng() < meanA / (meanA + meanD) ? [1, 0] : [0, 1];
    const end = MINUTES + clamp(Math.ceil(at * EXTRA_TIME), 1, EXTRA_TIME);
    return { periods: end <= MINUTES + EXTRA_HALF ? [goal] : [[0, 0], goal], a: goal[0], d: goal[1], end, by: 'golden-goal' };
  }
  const periods = [];
  let a = 0, d = 0;
  for (let half = 0; half < EXTRA_HALVES; half++) {
    const pa = poisson(rng, meanA), pd = poisson(rng, meanD);
    periods.push([pa, pd]);
    a += pa;
    d += pd;
    if (sudden === 'silver' && half === 0 && a !== d) return { periods, a, d, end: MINUTES + EXTRA_HALF, by: 'silver-goal' };
  }
  return { periods, a, d, end: MINUTES + EXTRA_TIME, by: null };
}

/**
 * Score-only path: the venue's edge (in `prepared`), correlated tempo and stochastic finishing; level after ninety, extra
 * time and the tie-break of the season's day (`prepared.rules`). `ga`/`gd` are the final score, extra time's goals
 * included, `regA`/`regD` the score after ninety minutes. `tie` (null when the ninety settled it): `by` ('extra-time',
 * 'golden-goal', 'silver-goal', 'penalties' or 'lots'), extra time's halves (`periods`, each [attacker, defender] goals)
 * and the minute play ended (`end`), the shoot-out's kicks (`A`, `D`, `ga`, `gd` scored, `first`: empty and 0–0 when
 * none was taken) and the side whose lot was drawn (`lots`).
 */
export function sampleFootballResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const tempo = Math.exp(clamp(gauss(rng), -2.5, 2.5) * TEMPO_SD - TEMPO_SD ** 2 / 2);
  // Smooth saturation keeps huge rating gaps plausible without a hard score cap
  // or a zero probability of an underdog scoring. Poisson goals remain random
  // even with the Predictable (zero form variation) setting.
  const rate = log => BASE_GOALS * tempo * Math.exp(MAX_LOG_EDGE * Math.tanh(log / MAX_LOG_EDGE));
  const la = rate(prepared.logA + form), ld = rate(prepared.logD - form);
  const [regA, regD] = lowScoreCorrection(rng, poisson(rng, la), poisson(rng, ld), la, ld);
  if (regA !== regD) return { ga: regA, gd: regD, regA, regD, tie: null, winner: regA > regD ? prepared.aId : prepared.dId };
  const rules = prepared.rules || KNOCKOUTS.penalties;
  const extra = extraTime(rng, la, ld, rules.sudden);
  const ga = regA + extra.a, gd = regD + extra.d;
  const tie = { by: extra.by || 'extra-time', periods: extra.periods, end: extra.end, A: [], D: [], ga: 0, gd: 0 };
  if (ga === gd && rules.decider === 'lots') Object.assign(tie, { by: 'lots', lots: rng() < .5 ? 'A' : 'D' });
  else if (ga === gd) Object.assign(tie, { by: 'penalties' }, shootout(rng, prepared));
  const aWins = ga !== gd ? ga > gd : tie.by === 'lots' ? tie.lots === 'A' : tie.ga > tie.gd;
  return { ga, gd, regA, regD, tie, winner: aWins ? prepared.aId : prepared.dId };
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

/**
 * The ninety minutes' goals, then extra time's, each at a minute of its half: a golden goal at the minute it ended the
 * match (`kind: 'golden'`).
 */
function goalEvents(rng, result, prepared) {
  const ev = [];
  const sides = [[prepared.aId, prepared.lineupA, result.regA ?? result.ga], [prepared.dId, prepared.lineupD, result.regD ?? result.gd]];
  const scorers = sides.map(([, lineup]) => createScorerSampler(lineup, SCORER_WEIGHTS, 55));
  sides.forEach(([id, , goals], s) => {
    for (let i = 0; i < goals; i++) ev.push({ m: goalMinute(rng), tid: id, name: scorers[s](rng), pts: 1 });
  });
  const tie = result.tie;
  const golden = tie?.by === 'golden-goal';
  (tie?.periods || []).forEach((pair, half) => pair.forEach((goals, s) => {
    for (let i = 0; i < goals; i++) {
      const m = golden ? tie.end : MINUTES + half * EXTRA_HALF + 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * EXTRA_HALF);
      ev.push({ m, tid: sides[s][0], name: scorers[s](rng), pts: 1, ...(golden ? { kind: 'golden' } : {}) });
    }
  }));
  return ev.sort((a, b) => a.m - b.m);
}

// How a level game was settled (`tie.by`), after its score (lower case) and beside it (the short form), when no
// shoot-out was taken. A tie saved before extra time came in has no `by`: it went straight to penalties.
const SETTLED_COPY = Object.freeze({
  'extra-time': ['after extra time', 'AET'],
  'golden-goal': ['after a golden goal in extra time', 'GOLDEN GOAL'],
  'silver-goal': ['after a silver goal in extra time', 'SILVER GOAL'],
  lots: ['after extra time, on the drawing of lots', 'LOTS'],
});

/** "after extra time", "after a golden goal in extra time", …, or a shoot-out's kicks, attacker first: "4–3 on penalties". */
const tieText = tie => SETTLED_COPY[tie?.by]?.[0] ?? `${tie.ga}–${tie.gd} on penalties`;

/** "AET", "GOLDEN GOAL", "SILVER GOAL", "LOTS", or a shoot-out's kicks, attacker first: "4–3 PENS". */
const tieShort = tie => SETTLED_COPY[tie?.by]?.[1] ?? `${tie.ga}–${tie.gd} PENS`;

const minutesLeft = n => `${n} minute${n === 1 ? '' : 's'} left`;
const goalWord = e => (e.kind === 'golden' ? 'GOLDEN GOAL' : 'GOAL');

export const football = {
  id: 'football',
  // Version 4: a level game goes to extra time, then the tie-break of its season's day (version 3 went straight to
  // penalties in every season).
  simulationVersion: 4,
  name: 'Football',
  blurb: 'Eleven a side, ninety minutes. Low scores, high drama — level games go to extra time, then penalties.',
  rosters: ROSTERS,
  clubs: CLUBS,
  /**
   * The rules a campaign plays (matchSport): extra time in every season, then the drawing of lots to 1969/70, the golden
   * goal from 1995/96 to 2001/02, the silver goal in 2002/03 and 2003/04, and penalties otherwise (`knockoutIn`).
   */
  rulesFor: settings => footballIn(rulesYear(settings)),

  squadSize: 11,
  formation: { GK: 1, DF: 4, MF: 4, FW: 2 },
  positionPlan: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  positionColors: { GK: C.gold, DF: C.cyan, MF: C.green, FW: C.red },

  // Nothing here is invented: a nation no source rates fields no team, and its land stays neutral, as in women's
  // football. Tonga, Samoa and the Cook Islands are the three: EA FC 27 rates none of their players, and the FM 26
  // snapshot was taken before they were on the map. East Germany (HISTORIC_NATIONS) is not on today's map at all.
  territory: { merged: {}, inactive: Object.keys(NATIONS).filter(id => !HISTORIC_NATIONS.includes(id) && !ROSTERS[id]?.[2]?.length) },
  /** Hand-tuned national strength for the nations with no dataset entry. */
  fallbackStrength: (rec, confMeta) => rec[4] || confMeta[rec[2]].baseStr,
  requiredPositions: ['GK'],

  // `ot`: extra time's halves, which follow a level ninety before the shoot-out (91' to 120' on the clock and the chart).
  clock: { length: MINUTES, msPerUnit: 46, ot: EXTRA_HALF },
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
  words: { kickoff: 'Kick-off', end: 'Full time', lineup: 'Starting XI', lineupShort: 'XI', lineupNoun: 'XI', lineupTitle: 'XI',
    overtime: 'Extra time' },
  /** The live feed's time left: the ninety's minutes, then extra time's. */
  clockLeft: (now, length) => (now < length ? minutesLeft(length - now) : now === length ? 'final minute'
    : now < length + EXTRA_TIME ? `extra time, ${minutesLeft(length + EXTRA_TIME - now)}` : 'extra time, final minute'),

  /** `Q`-free: football events are simply minute-stamped goals, extra time's at 91' to 120'. */
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `${goalWord(e)} — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' ${goalWord(e)} — ${e.name.toUpperCase()}`,
  // How a level game was settled: after its score ("after extra time") and beside it ("AET", "4–3 PENS").
  settled: { text: tieText, short: tieShort },

  prepareMatch: prepareFootballMatch,
  sampleResult: sampleFootballResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareFootballMatch(attacker, defender, effA, effD, venue);
    const result = sampleFootballResult(rng, prepared, drama);
    return { ...result, ev: goalEvents(rng, result, prepared) };
  },
};

/** Football under the knockout rules `id` (a KNOCKOUTS key): today's are `football` itself. */
const footballUnder = rulesMemo(id => {
  if (id === KNOCKOUTS.penalties.id) return football;
  const rules = KNOCKOUTS[id];
  return {
    ...football,
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareFootballMatch(attacker, defender, effA, effD, venue, rules),
    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      const prepared = prepareFootballMatch(attacker, defender, effA, effD, venue, rules);
      const result = sampleFootballResult(rng, prepared, drama);
      return { ...result, ev: goalEvents(rng, result, prepared) };
    },
  };
});

/**
 * Football as a season ending in `year` played it (1970 for 1969/70; null for the built-in season, today's rules):
 * one object per set of knockout rules, so caches keyed by the sport hold across a campaign.
 */
export const footballIn = year => footballUnder(knockoutIn(year).id);

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const FOOTBALL_MODEL = Object.freeze({ MINUTES, EXTRA_HALF, EXTRA_HALVES, EXTRA_RATE });

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
