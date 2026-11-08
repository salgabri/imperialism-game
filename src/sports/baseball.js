import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.baseball.js';
import { CLUBS } from '../data/clubs.baseball.js';
import { GREAT_BRITAIN, HOME_NATIONS, selectLineup } from '../data/teams.js';
import { clamp, createScorerSampler, gauss } from '../engine/random.js';

// The clock counts outs: three a half-inning, six an inning, nine innings. The attacker bats first (the top of each
// inning); the defender, holding the territory, is the home side and bats last.
const OUTS = 3;
const INNING = 2 * OUTS;
const INNINGS = 9;
const LENGTH = INNINGS * INNING;
const MAX_EXTRA = 6;

// A half-inning against an average side: a run scores 26.5% of the time, and a scoring half-inning brings 1.85 runs
// (one, plus a geometric run of more with ratio 0.46: 54% one run, a quarter two, one in nine three). That is 0.49
// runs a half-inning, 4.4 a game, a side's runs spread by about 3.1, as in MLB.
const BASE_SCORE = 0.265;
const MORE_RUNS = 0.46;
// Extra innings start with a runner on second, so a run comes far more often.
const EXTRA_SCORE = 0.6;
// Each rating point of edge moves the half-inning's odds by 0.038 in logit: a 162-game season then spreads the clubs
// as MLB's did in 2022-25 (a 0.076 spread of winning percentages, the best about 106 wins), and the rating favourite
// wins 58% of games.
const SCORE_SCALE = 0.038;
// Match-day form in rating points: the day's pitching and the lineup's swing, raising one side's edges and lowering
// the other's, as American football's form does.
const FORM_PER_DRAMA = 0.6;
// The last extra inning, still level, ends on a decisive run: an even coin flip between equals.
const DECISIVE_RUN = 0.08;
// Home advantage, a campaign option (off: every match is at a neutral venue, and batting last alone is worth nothing):
// the home side, which bats last, gains HOME_EDGE rating points of edge in its half-innings and the visitors lose as
// much in theirs. Equal sides then win 53% at home, as MLB home sides do.
const HOME_EDGE = 1.4;
// Runs a half-inning can reach in the live model's distributions (the rest is a vanishing tail).
const RUN_CAP = 15;
/** The strength of a nation with no MLB players, and of a lineup slot a nation's own players cannot fill. */
export const BASELINE = 45;

/** The batting order's nine, the day's starter and a bullpen of three. */
const HITTERS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const FIELDERS = HITTERS.filter(position => position !== 'DH');
const PITCHERS = ['SP', 'RP'];
// The starter pitches about two thirds of a game, the bullpen the rest; pitching prevents runs more than fielding.
const STARTER_SHARE = 0.6;
const PITCHING_SHARE = 0.75;
// MLB The Show rates pitchers above hitters: the 30 clubs' lineups bat 77.0 on average against a defence of 79.3. An
// average lineup facing an average staff is an even edge.
const PITCHING_PREMIUM = 2.3;

const logit = p => Math.log(p / (1 - p));
const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);

function profile(lineup) {
  const of = positions => lineup.slots.filter(slot => positions.includes(slot.position)).map(slot => slot.effectiveRating);
  const batting = mean(of(HITTERS));
  const fielding = mean(of(FIELDERS));
  const starter = mean(of(['SP'])), bullpen = mean(of(['RP']));
  const pitching = STARTER_SHARE * starter + (1 - STARTER_SHARE) * bullpen;
  return { batting, pitching, fielding,
    defence: PITCHING_SHARE * pitching + (1 - PITCHING_SHARE) * fielding - PITCHING_PREMIUM };
}

/** A side's half-inning at `edge` = its batting minus the opposing defence: its chance to score, regulation and extra. */
export function inningOdds(edge) {
  return {
    score: logistic(logit(BASE_SCORE) + SCORE_SCALE * edge),
    extra: logistic(logit(EXTRA_SCORE) + SCORE_SCALE * edge),
  };
}

/** P(a half-inning brings k runs) for k = 0…RUN_CAP, the last holding "RUN_CAP or more", when it scores with `score`. */
export function runMasses(score) {
  const masses = new Array(RUN_CAP + 1).fill(0);
  masses[0] = 1 - score;
  let total = masses[0];
  for (let k = 1; k < RUN_CAP; k++) {
    masses[k] = score * (1 - MORE_RUNS) * MORE_RUNS ** (k - 1);
    total += masses[k];
  }
  masses[RUN_CAP] = Math.max(0, 1 - total);
  return masses;
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling. `venue.home`: the defender, which
 * bats last, plays at home (the campaign's home advantage); a neutral venue otherwise.
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
    innings: INNINGS,
    edgeA: a.batting + adjustmentA - (d.defence + adjustmentD) - edge,
    edgeD: d.batting + adjustmentD - (a.defence + adjustmentA) + edge,
  };
}

/** One half-inning's runs: none, or one plus a geometric run of more. */
function halfInning(rng, score) {
  if (rng() >= score) return 0;
  let runs = 1;
  while (runs < 30 && rng() < MORE_RUNS) runs++;
  return runs;
}

/**
 * Score-only path: half-inning by half-inning, the home side batting last. The bottom of the ninth is not played when
 * the home side leads, and the hit that puts it ahead in the ninth or later ends the game at once, with every run it
 * drives in (a walk-off home run with men on wins by more than one). Level after nine, extra innings: each half starts
 * with a runner on second; after the sixth extra inning a decisive run settles it. Also returns every half-inning's
 * runs in order (`halves`: { side, runs, half, hits? }, `half` 0 the top of the first, `hits` a walk-off half's RBI
 * hits) so the full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * variation * FORM_PER_DRAMA;
  const oddsA = inningOdds(prepared.edgeA + form);
  const oddsD = inningOdds(prepared.edgeD - form);
  const halves = [];
  let ga = 0, gd = 0, regA = 0, regD = 0, extras = 0;
  for (let inning = 1; inning <= INNINGS + MAX_EXTRA; inning++) {
    const extra = inning > INNINGS;
    if (extra && ga !== gd) break;
    if (inning === INNINGS + 1) [regA, regD] = [ga, gd];
    if (extra) extras++;
    const top = halfInning(rng, extra ? oddsA.extra : oddsA.score);
    ga += top;
    halves.push({ side: 'A', runs: top, half: 2 * (inning - 1) });
    // Home ahead going into the bottom of the ninth or later: the game is over.
    if (inning >= INNINGS && gd > ga) break;
    let bottom = halfInning(rng, extra ? oddsD.extra : oddsD.score);
    if (inning >= INNINGS && gd + bottom > ga) {
      // A walk-off: the hit that puts the home side ahead ends the game, with the runs it drives in.
      const hits = [];
      let scored = 0;
      for (const hit of rbiChunks(rng, bottom)) {
        hits.push(hit);
        scored += hit;
        if (gd + scored > ga) break;
      }
      gd += scored;
      halves.push({ side: 'D', runs: scored, half: 2 * (inning - 1) + 1, hits });
      break;
    }
    gd += bottom;
    halves.push({ side: 'D', runs: bottom, half: 2 * (inning - 1) + 1 });
  }
  if (!extras) [regA, regD] = [ga, gd];
  if (ga === gd) {
    // A bounded final decisive run, in the last extra inning played and in the ticker. Swapping sides swaps the odds.
    const side = rng() < logistic(DECISIVE_RUN * (prepared.edgeA - prepared.edgeD)) ? 'A' : 'D';
    const last = halves.filter(h => h.side === side).at(-1);
    last.runs++;
    if (side === 'A') ga++; else gd++;
  }
  const tie = extras ? { periods: extraPeriods(halves), ga, gd } : null;
  return { ga, gd, regA, regD, tie, halves, winner: ga > gd ? prepared.attackerId : prepared.defenderId };
}

/** Each extra inning's runs as [attacker, defender]. */
function extraPeriods(halves) {
  const periods = [];
  for (const h of halves) {
    if (h.half < INNINGS * 2) continue;
    const at = Math.floor(h.half / 2) - INNINGS;
    periods[at] ||= [0, 0];
    periods[at][h.side === 'A' ? 0 : 1] += h.runs;
  }
  return periods;
}

/** "T3" for the top of the third, "B9" for the bottom of the ninth, from a clock value in outs (1 is the first out). */
export function inningLabel(m) {
  const half = Math.max(0, Math.ceil(m / OUTS) - 1);
  return `${half % 2 ? 'B' : 'T'}${Math.floor(half / 2) + 1}`;
}

/**
 * Who drives in the runs: the heart of the order above all (designated hitter, corners and outfield), the catcher
 * and middle infield less, the pitchers never.
 */
const RBI_WEIGHTS = { DH: 1.35, '1B': 1.3, LF: 1.15, RF: 1.2, '3B': 1.15, CF: 1, '2B': 0.9, SS: 0.95, C: 0.8, SP: 0.0001, RP: 0.0001 };

/** A half-inning's runs as RBI hits of one to four runs each, never more than the inning brought. */
function rbiChunks(rng, runs) {
  const chunks = [];
  let left = runs;
  while (left > 0) {
    const chunk = 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * Math.min(left, 4));
    chunks.push(chunk);
    left -= chunk;
  }
  return chunks;
}

export const baseball = {
  id: 'baseball',
  simulationVersion: 2,
  name: 'Baseball',
  blurb: 'Nine innings, nine in the order and a pitching staff. The home side bats last — level games go to extra innings.',
  rosters: ROSTERS,
  clubs: CLUBS,
  // The World Baseball Classic fields Great Britain and the Kingdom of the Netherlands: the home nations' shapes start
  // in the United Kingdom's (826) empire.
  territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
  // That empire plays as Great Britain, under the Union Jack. A season's sport keeps this with the rest of baseball's.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 13,
  formation: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1, SP: 1, RP: 3 },
  positionPlan: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'RP', 'RP'],
  positionColors: { C: C.gold, '1B': C.cyan, '2B': C.cyan, '3B': C.cyan, SS: C.cyan, LF: C.green, CF: C.green, RF: C.green,
    DH: C.red, SP: '#B07CD8', RP: '#7FA7E8' },

  // Nations with no MLB players are baseball's minnows, all alike: the game is a few nations' sport.
  fallbackStrength: () => BASELINE,
  requiredPositions: ['SP'],

  // The win chart ticks at the end of every inning.
  clock: { length: LENGTH, msPerUnit: 75, ot: INNING, tick: INNING },
  tieBreak: 'overtime',
  labels: {
    score: 'RUNS',
    start: 'FIRST PITCH…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'EXTRA INNINGS',
    tieShort: 'EXTRAS',
  },

  words: { kickoff: 'First pitch', end: 'Final', lineup: 'Starting lineup', lineupShort: 'Lineup', lineupNoun: 'starting lineup',
    lineupTitle: 'Lineup', overtime: 'Extra innings', half: null },
  /**
   * The live feed's status line after the score: the innings still to play, the ninth's last out (as other sports'
   * "final minute"; every game's clock passes it), then the extra innings.
   */
  clockLeft: (now, length) => {
    const left = Math.ceil((length - now) / INNING);
    return left > 0 ? `${left} inning${left === 1 ? '' : 's'} left` : now > length ? 'extra innings' : 'final out';
  },

  /** The clock as the match shows it: the half-inning, never a minute; the win chart's axis counts innings played. */
  formatClock: inningLabel,
  formatTick: t => (t > 0 ? String(Math.round(t / INNING)) : ''),
  // A game level after nine is decided in extra innings: "after 11 innings", "F/11".
  overtime: {
    text: periods => `after ${INNINGS + periods} innings`,
    short: periods => `F/${INNINGS + periods}`,
    periodsOf: text => {
      const played = /after\s+(\d+)\s+innings/i.exec(text)?.[1];
      return played ? Math.max(1, Number(played) - INNINGS) : null;
    },
  },
  formatEvent: (e, code) => ({ when: inningLabel(e.m), text: `${e.pts} RBI — ${e.name} (${code})` }),
  formatToast: e => `${e.pts} RBI — ${e.name.toUpperCase()}`,

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, regA, regD, tie, halves, winner } = sampleResult(rng, prepared, drama);
    const batterA = createScorerSampler(prepared.lineupA, RBI_WEIGHTS, 50);
    const batterD = createScorerSampler(prepared.lineupD, RBI_WEIGHTS, 50);
    const ev = [];
    for (const { side, runs, half, hits } of halves) {
      if (!runs) continue;
      const own = side === 'A';
      // Each RBI hit comes on one of the half-inning's three outs, in order; the last one may end the game.
      let out = 1;
      for (const pts of hits ?? rbiChunks(rng, runs)) {
        out = Math.min(OUTS, out + (rng() < 0.4 ? 1 : 0));
        ev.push({ m: half * OUTS + out, tid: own ? attacker.id : defender.id, name: (own ? batterA : batterD)(rng), pts });
      }
    }
    ev.sort((x, y) => x.m - y.m);
    return { ga, gd, regA, regD, ev, tie, winner };
  },
};

/**
 * Squad-screen strength profile: the batting, pitching and fielding the match model weighs → { batting, pitching,
 * fielding } on the player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected first.
 * Read-only; no RNG.
 */
export function baseballProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || !selected.slots.some(slot => PITCHERS.includes(slot.position))) return { batting: 0, pitching: 0, fielding: 0 };
  const { batting, pitching, fielding } = profile(selected);
  return { batting, pitching, fielding };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const INNING_MODEL = Object.freeze({ OUTS, INNING, INNINGS, LENGTH, MAX_EXTRA, FORM_PER_DRAMA, DECISIVE_RUN, RUN_CAP });
