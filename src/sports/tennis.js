import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.tennis.js';
import { GREAT_BRITAIN, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { clamp, gauss } from '../engine/random.js';

// Tennis by the rules of the Davis Cup's home-and-away ties (docs/design/tennis.md). Two nations' teams play five
// rubbers over two days, first to three. Day one: each side's No. 1 plays the other's No. 2. Day two: the doubles, then
// No. 1 against No. 1 and No. 2 against No. 2. Every rubber is a best-of-three-sets match of tie-break sets. Once a side
// has three, the rest are dead rubbers and are not played, so a tie ends 3–0, 3–1 or 3–2.
export const RUBBERS = 5;
export const TO_WIN = 3;
// Who plays each rubber, as lineup places [the attacker's, the defender's]: 0 the No. 1, 1 the No. 2; null, the doubles.
const ORDER = [[0, 1], [1, 0], null, [0, 0], [1, 1]];

// Ratings are Tennis Abstract's Elo on the game's scale (scripts/lib/tennis.mjs): rating = Elo / 25 + 4, so a rating
// point is 25 Elo points and Elo's own odds hold. A 4-point favourite (100 Elo) wins a best-of-three match 64% of the
// time, an 8-point one 76%, a 16-point one 91% (Elo's logistic, base 10, 400 points).
export const ELO_PER_POINT = 25;
/** The favourite's chance in a best-of-three-sets match, `gap` rating points ahead. */
export const matchOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// The share of his service points an ATP player wins against an equal: about 64%. A rubber splits the difference
// between the two servers so that the better player wins exactly as often as Elo says (serveEdge), and the sets are
// then played game by game (holds and breaks) and the tie-breaks point by point.
const SERVE = 0.64;

// Match-day form: one draw for the tie in rating points, on every rubber's gap, a hot team or a cold one. At Balanced
// it barely moves Elo's odds; it grows with the square of the drama, as in the other sports, so Wild swings ties hard and
// Predictable keeps Elo's.
const FORM_AT_BALANCED = 1.5;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;

// Home advantage, a campaign option (off: a neutral venue). A Davis Cup host picks the surface and fills the stands:
// from 2003 to 2016 hosts won 60.9% of 322 World Group ties where Elo expected 53.1%, 7.8 points more (Jeff Sackmann,
// Tennis Abstract), and the edge was larger in the singles than in the doubles. In rating points: 45 Elo in a singles
// rubber and about 18 in the doubles. Among the sixteen strongest nations that lifts the host's share of ties by 7.7
// points; between equals the host wins 60.5%.
export const HOME_EDGE = Object.freeze({ singles: 1.8, doubles: 0.7 });

// The clock: every rubber has twenty units, its sets ending at their share of its games. Three rubbers make the
// shortest tie; a fourth and a fifth extend it as overtime periods do in other sports.
export const BLOCK = 20;
const LENGTH = TO_WIN * BLOCK;

/** What a nation counts for when none of its players is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

// ---------- the chance to win a set, game by game ----------

/** The server's chance to hold a game, winning each point with `p`. */
export function holdChance(p) {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * (p * p / (1 - 2 * p * q));
}

/**
 * A's chance to win a tie-break that A serves first: A wins a point on his own serve with `pA`, D on his with `pD`. The
 * first point is the first server's, then two each. Level at six all and beyond, the next two points are one each's
 * serve: A needs both before D gets both.
 */
export function tiebreakChance(pA, pD) {
  const memo = new Map();
  const at = (a, d) => {
    if (a >= 7 && a - d >= 2) return 1;
    if (d >= 7 && d - a >= 2) return 0;
    if (a === d && a >= 6) {
      const both = pA * (1 - pD), lost = (1 - pA) * pD;
      return both / (both + lost);
    }
    const key = a * 32 + d;
    if (memo.has(key)) return memo.get(key);
    const k = a + d;
    const aServes = k === 0 || ((k - 1) >> 1) % 2 === 1;
    const q = aServes ? pA : 1 - pD;
    const chance = q * at(a + 1, d) + (1 - q) * at(a, d + 1);
    memo.set(key, chance);
    return chance;
  };
  return at(0, 0);
}

/** A's chance to win a tie-break set that A serves first (the chance is the same whoever serves first). */
export function setChance(pA, pD) {
  const hA = holdChance(pA), hD = holdChance(pD);
  // The thirteenth game is the tie-break, and A serves the odd games: he serves its first point too.
  const tiebreak = tiebreakChance(pA, pD);
  const memo = new Map();
  const at = (a, d) => {
    if (a >= 6 && a - d >= 2) return 1;
    if (d >= 6 && d - a >= 2) return 0;
    if (a === 6 && d === 6) return tiebreak;
    const key = a * 8 + d;
    if (memo.has(key)) return memo.get(key);
    const q = (a + d) % 2 === 0 ? hA : 1 - hD;
    const chance = q * at(a + 1, d) + (1 - q) * at(a, d + 1);
    memo.set(key, chance);
    return chance;
  };
  return at(0, 0);
}

/** A's chance to win a best-of-three match whose sets he wins with `s` each: s²(3 − 2s). */
export const bestOfThree = s => s * s * (3 - 2 * s);

// Day form inside a rubber: one draw for the match, in the log-odds of winning a set, so that a player who wins the first
// set is more likely to win the second than independent sets would make him. Independent sets would send about 44% of
// the ATP's best-of-three matches to a third set; about 35% go there (Jeff Sackmann, Tennis Abstract, 2014 and 2023). A
// spread of 1 does that: between players 8 points apart (independent sets: 43%) it gives 35%, between equals 41%. The
// mean is set so that the match odds stay Elo's (setLogitFor).
export const DAY_FORM = 1;
const logistic = x => 1 / (1 + Math.exp(-x));
// Seven-point Gauss–Hermite nodes for a standard normal: [value, weight].
export const NORMAL_NODES = Object.freeze([[0, 0.8102646175568073], [0.8162878828589647, 0.4256072526101278],
  [-0.8162878828589647, 0.4256072526101278], [1.6735516287674714, 0.05451558281912703], [-1.6735516287674714, 0.05451558281912703],
  [2.651961356835233, 0.0009717812450995192], [-2.651961356835233, 0.0009717812450995192]]
  .map(([t, w]) => Object.freeze([t * Math.SQRT2, w / Math.sqrt(Math.PI)])));

/** The mean set log-odds that, spread by day form, make a best-of-three match `odds`. */
export function setLogitFor(odds) {
  const target = clamp(odds, 1e-9, 1 - 1e-9);
  const chance = mean => NORMAL_NODES.reduce((sum, [t, w]) => sum + w * bestOfThree(logistic(mean + DAY_FORM * t)), 0);
  let lo = -20, hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (chance(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A's set chance at each day-form node of a match he wins with `odds` → [{ weight, s }]; they average to `odds`. */
export function daySetChances(odds) {
  const mean = setLogitFor(odds);
  return NORMAL_NODES.map(([t, weight]) => ({ weight, s: logistic(mean + DAY_FORM * t) }));
}

/** How far apart the two servers' point chances are (A's minus D's) for A to win a set with `s`. */
export function serveEdge(s, serve = SERVE) {
  const room = Math.min(serve - 0.3, 0.97 - serve) * 2;
  let lo = -room, hi = room;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (setChance(serve + mid / 2, serve - mid / 2) < s) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- playing a rubber ----------

/** A tie-break, point by point: A serves first when `aFirst` → [A's points, D's points]. */
function playTiebreak(rng, pA, pD, aFirst) {
  let a = 0, d = 0;
  for (let k = 0; ; k++) {
    const firstServes = k === 0 || ((k - 1) >> 1) % 2 === 1;
    const aServes = firstServes === aFirst;
    if (aServes ? rng() < pA : rng() >= pD) a++; else d++;
    if ((a >= 7 || d >= 7) && Math.abs(a - d) >= 2) return [a, d];
  }
}

/** The two servers' point and hold chances when A wins a set with `s`. */
function servesFor(s) {
  const edge = serveEdge(s);
  const pA = SERVE + edge / 2, pD = SERVE - edge / 2;
  return { pA, pD, hA: holdChance(pA), hD: holdChance(pD) };
}

/**
 * One set, game by game, a tie-break point by point → { a, d, tb, next }: the games, the tie-break's points [A's, D's]
 * (null without one) and whether A serves the next game. Servers alternate every game; a tie-break counts as one.
 */
function playSet(rng, { pA, pD, hA, hD }, aServes) {
  let a = 0, d = 0, tb = null;
  while (!((a >= 6 || d >= 6) && Math.abs(a - d) >= 2)) {
    if (a === 6 && d === 6) {
      tb = playTiebreak(rng, pA, pD, aServes);
      if (tb[0] > tb[1]) a++; else d++;
      aServes = !aServes;
      break;
    }
    if (aServes ? rng() < hA : rng() >= hD) a++; else d++;
    aServes = !aServes;
  }
  return { a, d, tb, next: aServes };
}

/**
 * A best-of-three-sets match that A wins with `odds` → [{ a, d, tb }], each set's games and, for a set decided in a
 * tie-break, its points [A's, D's]: the day's form, then the sets game by game, after a toss for the first server.
 */
export function playMatch(rng, odds) {
  const serves = servesFor(logistic(setLogitFor(odds) + DAY_FORM * gauss(rng)));
  let aServes = rng() < 0.5;
  const sets = [];
  while (sets.filter(set => set.a > set.d).length < 2 && sets.filter(set => set.d > set.a).length < 2) {
    const { next, ...set } = playSet(rng, serves, aServes);
    sets.push(set);
    aServes = next;
  }
  return sets;
}

// Tries before a draw that should almost never miss gives up: a day-form draw for a 0.075% underdog's win (a 50-point
// gap) is found within them all but about once in 1,800, a set for its winner far more surely.
const MAX_TRIES = 10000;
const mirrored = set => ({ ...set, a: set.d, d: set.a, tb: set.tb && [set.tb[1], set.tb[0]] });

/**
 * A best-of-three match that A wins with `odds`, played out given that A wins it (`aWins`) or loses it, exactly: the day's
 * form given the result (drawn from its prior, kept with the chance it gives that result), then which sets the winner
 * takes given that form (two straight, or one dropped first or second), then each set game by game given its winner.
 */
export function playMatchWon(rng, odds, aWins) {
  const mean = setLogitFor(odds);
  let s = null;
  for (let i = 0; i < MAX_TRIES && s === null; i++) {
    const drawn = logistic(mean + DAY_FORM * gauss(rng));
    const won = bestOfThree(drawn);
    if (rng() < (aWins ? won : 1 - won)) s = drawn;
  }
  s ??= logistic(mean);
  // The winner's set chance w: straight sets 1/(3 − 2w), a set dropped first or second (1 − w)/(3 − 2w) each.
  const w = aWins ? s : 1 - s;
  const roll = rng() * (3 - 2 * w);
  const winnerTakes = roll < 1 ? [true, true] : roll < 2 - w ? [true, false, true] : [false, true, true];
  const serves = servesFor(s);
  let aServes = rng() < 0.5;
  return winnerTakes.map(winnerWins => {
    const aTakes = winnerWins === aWins;
    let set = null;
    for (let i = 0; i < MAX_TRIES && (!set || (set.a > set.d) !== aTakes); i++) set = playSet(rng, serves, aServes);
    if ((set.a > set.d) !== aTakes) set = mirrored(set);
    aServes = set.next;
    const { next, ...played } = set;
    return played;
  });
}

/** A set's games from the winner's side: "6–4", or "7–6(5)" with the loser's tie-break points. */
const setText = (set, aWon) => {
  const [w, l] = aWon ? [set.a, set.d] : [set.d, set.a];
  return `${w}–${l}${set.tb ? `(${Math.min(...set.tb)})` : ''}`;
};
/** Every set of a rubber from its winner's side: "6–4 3–6 7–6(5)". */
const scoreText = (sets, aWon) => sets.map(set => setText(set, aWon)).join(' ');

// ---------- the tie ----------

const PARTICLES = new Set(['de', 'del', 'della', 'di', 'da', 'van', 'von', 'der', 'den', 'du', 'la', 'le', 'dos', 'das']);
/** A player's surname ("Alex de Minaur" → "de Minaur"), for a doubles pair's name. */
export function surname(name) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  let start = tokens.length - 1;
  while (start > 1 && PARTICLES.has(tokens[start - 1].toLowerCase())) start--;
  return tokens.slice(Math.max(0, start)).join(' ');
}

/**
 * A lineup's No. 1, No. 2 and doubles pair, each { name, rating } (null for an empty place). The pair is named as the
 * lineup lists it, the stronger first: "Cobolli/Berrettini".
 */
function sideOf(lineup) {
  const place = slot => (slot?.player ? { name: slot.player.name, rating: slot.effectiveRating } : null);
  const [first, second, ...doubles] = lineup.slots.map(place);
  const [left, right] = doubles.filter(Boolean).sort((x, y) => y.rating - x.rating);
  const pair = left && right ? { name: `${surname(left.name)}/${surname(right.name)}`, rating: (left.rating + right.rating) / 2 } : null;
  return { singles: [first, second], pair };
}

/**
 * Prepare a tie once for cheap resampling: who plays each rubber and by how many rating points the attacker's player
 * (or pair) is ahead (`gap`), tactics, upsets and the venue included. `venue.home`: the defender is at home.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const sideA = sideOf(lineupA), sideD = sideOf(lineupD);
  const rubbers = ORDER.map(places => {
    const doubles = places === null;
    const a = doubles ? sideA.pair : sideA.singles[places[0]];
    const d = doubles ? sideD.pair : sideD.singles[places[1]];
    const edge = home ? (doubles ? HOME_EDGE.doubles : HOME_EDGE.singles) : 0;
    // An empty place concedes its rubber (a walkover); when both are empty, the defender keeps it.
    const walkover = !a || !d ? (a ? 'A' : 'D') : null;
    return { doubles, a: a?.name ?? null, d: d?.name ?? null, walkover,
      gap: walkover ? 0 : a.rating + adjustmentA - (d.rating + adjustmentD) - edge };
  });
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, rubbers };
}

/** The attacker's chance in each rubber after match-day `form` (rating points): 0 or 1 for a walkover. */
export const rubberOdds = (rubber, form = 0) => (rubber.walkover ? (rubber.walkover === 'A' ? 1 : 0) : matchOdds(rubber.gap + form));

/**
 * Score-only path: one form draw for the tie, then each rubber won with its Elo odds until a side has three. Also returns
 * the form and who won each rubber played (`rubbers`, 'A' or 'D'), which the full simulation plays out.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const won = [];
  let ga = 0, gd = 0;
  for (const rubber of prepared.rubbers) {
    if (rng() < rubberOdds(rubber, form)) { ga++; won.push('A'); } else { gd++; won.push('D'); }
    if (ga === TO_WIN || gd === TO_WIN) break;
  }
  return { ga, gd, regA: ga, regD: gd, tie: null, winner: ga > gd ? prepared.attackerId : prepared.defenderId, form, rubbers: won };
}

/**
 * The whole tie: sampleResult's own draws decide every rubber (so a seed gives the same score on both paths), then each
 * rubber's sets are played out given its winner. One event per set won, at its share of the rubber's games on the clock,
 * `pts` 1 for the set that wins the rubber (the score counts rubbers) and 0 for the others; a walkover is one event with
 * no sets.
 */
export function simulateTie(rng, prepared, drama = 6) {
  const result = sampleResult(rng, prepared, drama);
  const ev = [];
  result.rubbers.forEach((side, i) => {
    const rubber = prepared.rubbers[i];
    const aWon = side === 'A';
    const start = i * BLOCK;
    const common = { rubber: i + 1, doubles: rubber.doubles };
    if (rubber.walkover) {
      ev.push({ ...common, m: start + BLOCK, side, name: aWon ? rubber.a : rubber.d, pts: 1, set: 0, score: 'w/o' });
      return;
    }
    const sets = playMatchWon(rng, rubberOdds(rubber, result.form), aWon);
    const games = sets.reduce((sum, set) => sum + set.a + set.d, 0);
    let played = 0;
    sets.forEach((set, k) => {
      played += set.a + set.d;
      const last = k === sets.length - 1;
      const by = set.a > set.d ? 'A' : 'D';
      ev.push({ ...common, m: start + (last ? BLOCK : clamp(Math.round(BLOCK * played / games), 1, BLOCK - 1)), side: by,
        name: by === 'A' ? rubber.a : rubber.d, pts: last ? 1 : 0, set: k + 1, score: last ? scoreText(sets, aWon) : setText(set, by === 'A') });
    });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The rubber an event or clock unit falls in: R1 for 1–20, R2 for 21–40… (the start counts as the first). */
const rubberAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, RUBBERS);
const kindOf = e => (e.doubles ? 'DOUBLES' : 'SINGLES');

export const tennis = {
  id: 'tennis',
  simulationVersion: 1,
  name: 'Tennis',
  blurb: 'Davis Cup ties: four singles and a doubles over two days, first to three rubbers. Every match is best of three sets.',
  rosters: ROSTERS,
  clubs: [],
  // Nations only: tennis has no clubs to play.
  nationsOnly: true,
  // Great Britain plays the Davis Cup as one: the home nations' shapes start in the United Kingdom's (826) empire. A
  // nation with fewer than two rated players fields no team, and its land stays neutral.
  territory: {
    merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])),
    inactive: Object.keys(NATIONS).filter(id => !HOME_NATIONS.includes(id) && !Object.hasOwn(ROSTERS, id)),
  },
  // That empire plays as Great Britain, under the Union Jack.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 4,
  formation: { SGL: 2, DBL: 2 },
  positionPlan: ['SGL', 'SGL', 'DBL', 'DBL'],
  positionColors: { SGL: C.cyan, DBL: C.gold },

  fallbackStrength: () => EMPTY_STRENGTH,
  requiredPositions: [],

  // Twenty clock units a rubber; the chart ticks at the end of each. A tie ends with its deciding set, the last event.
  clock: { length: LENGTH, msPerUnit: 70, ot: BLOCK, tick: BLOCK },
  tieBreak: 'none',
  labels: {
    score: 'RUBBERS',
    start: 'FIRST SERVE…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'FINAL',
    tieShort: '',
  },

  words: { kickoff: 'First serve', end: 'Final', lineup: 'Team', lineupShort: 'Team', lineupNoun: 'team', lineupTitle: 'Team',
    overtime: null, half: null },

  // The clock shows the rubber in play: "R2".
  formatClock: m => `R${rubberAt(m)}`,
  // The chart's axis: the end of each rubber.
  formatTick: t => (t > 0 ? `R${Math.round(t / BLOCK)}` : ''),
  clockLeft: now => `rubber ${rubberAt(now)} of ${RUBBERS}`,
  formatEvent: (e, code) => ({ when: `R${e.rubber || rubberAt(e.m)}`, text: e.pts > 0
    ? `${kindOf(e)} — ${e.name} (${code}) ${e.score}`
    : `SET ${e.set} — ${e.name} (${code}) ${e.score}` }),
  formatToast: e => (e.pts > 0 ? `${kindOf(e)} — ${String(e.name).toUpperCase()} ${e.score}` : `SET ${e.set} — ${String(e.name).toUpperCase()} ${e.score}`),

  prepareMatch,
  sampleResult,

  simulate(rng, attacker, defender, drama, effA, effD, venue) {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue);
    const { ga, gd, ev, winner } = simulateTie(rng, prepared, drama);
    return { ga, gd, regA: ga, regD: gd, tie: null, winner,
      ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
  },
};

/**
 * Squad-screen strength profile: the mean of the No. 1 and No. 2, and the doubles pair's → { singles, doubles } on the
 * player-rating scale. Takes a `selectLineup` result, or a team whose lineup is selected
 * first. Read-only; no RNG.
 */
export function tennisProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected || selected.slots.length !== 4) return { singles: 0, doubles: 0 };
  const [first, second, left, right] = selected.slots.map(slot => slot.effectiveRating);
  return { singles: (first + second) / 2, doubles: (left + right) / 2 };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const RUBBER_MODEL = Object.freeze({ RUBBERS, TO_WIN, BLOCK, LENGTH, FORM_AT_BALANCED });
