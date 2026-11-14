import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { GREAT_BRITAIN, HISTORIC_NATIONS, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { clamp, gauss } from '../engine/random.js';

// Tennis by the rules of the Davis Cup's home-and-away ties (docs/design/tennis.md), and the women's game by the
// Billie Jean King Cup's, whose qualifiers and play-offs have played them in the same order since 2026
// (docs/design/womens-tennis.md). An earlier season plays its own year's format ("Format by year" in both notes).
// Today: two nations' teams play five rubbers over two days, first to three. Day one: each side's No. 1 plays the
// other's No. 2. Day two: the doubles, then No. 1 against No. 1 and No. 2 against No. 2. Every rubber is a
// best-of-three-sets match of tie-break sets. Once a side has three, the rest are dead rubbers and are not played, so a
// tie ends 3–0, 3–1 or 3–2.
export const RUBBERS = 5;
export const TO_WIN = 3;
// Who plays each rubber, as lineup places [the attacker's, the defender's]: 0 the No. 1, 1 the No. 2; null, the doubles.
// The Davis Cup's order in every year the game plays, and the Billie Jean King Cup's from 2026: Jeff Sackmann's match
// files number the singles 1, 2, 4 and 5 (the doubles third) in all but 2 of the 3,987 Davis Cup ties of 1968–2025, and
// the first reverse singles is the stronger pair's in 505 of the 640 World Group ties of 1985–2018 whose players have a
// ranking (scripts/tennis-formats-real.mjs counts them).
const ORDER = [[0, 1], [1, 0], null, [0, 0], [1, 1]];
// The Fed Cup's five-rubber ties: the two days' four singles, then the doubles ("The final match is a doubles":
// Wikipedia, "Billie Jean King Cup", https://en.wikipedia.org/w/index.php?oldid=1380349265, read 2026-11-10; the match
// files number the singles 1 to 4 in all 357 World Group and play-off ties of 1995–2022).
const DOUBLES_LAST = [[0, 1], [1, 0], [0, 0], [1, 1], null];
// A three-rubber tie, first to two: the No. 2s' singles, the No. 1s', then the doubles. The match files' first singles is
// the weaker pair's in 560 of the 571 Fed Cup ties of 1975–1994 whose four players have a ranking. Wikipedia's pages of
// the Federation Cup's first years list the No. 1s' singles first in most ties of 1963–1965 and the No. 2s' in 1967
// (scripts/tennis-formats-real.mjs): an order that changes no tie's odds, both singles being played in every tie.
const THREE_RUBBERS = [[1, 1], [0, 0], null];

/**
 * A cup's format: `order` the rubbers (ORDER and its kin), `toWin` the rubbers that win the tie, `bestOf` a rubber's sets,
 * `advantage` which sets have no tie-break at 6–6 and go on until a side is two games clear ('none'; 'final', the
 * deciding set; 'all'), `days` the days its ties were played over and `text` the format in words.
 */
const format = (id, order, bestOf, advantage, days, text) =>
  Object.freeze({ id, order, toWin: (order.length + 1) / 2, bestOf, advantage, days, text });

/** Today's ties: the built-in season's, and every earlier one's that played them. */
export const TODAY = format('today', ORDER, 3, 'none', 2, 'five rubbers over two days, first to three; best of three tie-break sets');

/**
 * The Davis Cup by year: `[first year, format]`, each until the next. Five rubbers over three days (the two singles, the
 * doubles, the reverse singles), every rubber best of five sets ("Davis Cup",
 * https://en.wikipedia.org/w/index.php?oldid=1384175798, read 2026-11-10), with no tie-break before 1989; a tie-break at
 * 6–6 in every set but the fifth from 1989 ("1989 Davis Cup", https://en.wikipedia.org/w/index.php?oldid=1367121733) and
 * in the fifth too from 2016 ("2016 Davis Cup", https://en.wikipedia.org/w/index.php?oldid=1373159027). 2018's zone groups
 * played best of three, its World Group still best of five ("2018 Davis Cup",
 * https://en.wikipedia.org/w/index.php?oldid=1374169870). From 2019 best of three sets ("2019 Davis Cup",
 * https://en.wikipedia.org/w/index.php?oldid=1375952558), the home-and-away ties over two days: today's. Jeff Sackmann's
 * match files bear every date out (scripts/tennis-formats-real.mjs): none of the 17,940 sets of the best-of-five rubbers
 * of 1960–1988 ended 7–6 and 1,647 went past 7–5; from 1989 to 2015 sets one to four ended 7–6 and never went past it,
 * while 157 of 1,052 fifth sets went past 7–5 and none ended 7–6; from 2016 fifth sets ended 7–6 and none went past it;
 * all 1,350 rubbers of 2019–2025 are best of three.
 */
export const DAVIS_CUP_FORMATS = Object.freeze([
  [-Infinity, format('davis-cup-advantage', ORDER, 5, 'all', 3,
    'five rubbers over three days, first to three; best of five advantage sets')],
  [1989, format('davis-cup-tiebreaks', ORDER, 5, 'final', 3,
    'five rubbers over three days, first to three; best of five sets, a tie-break in all but the fifth')],
  [2016, format('davis-cup-fifth-set-tiebreak', ORDER, 5, 'none', 3,
    'five rubbers over three days, first to three; best of five tie-break sets')],
  [2019, TODAY],
]);

// The women's cup's formats, some of them played in more than one stretch of years (one sport object each).
const FED_CUP_THREE_ADVANTAGE = format('fed-cup-three-advantage', THREE_RUBBERS, 3, 'all', 1,
  'three rubbers, first to two; best of three advantage sets');
const FED_CUP_THREE_TIEBREAKS = format('fed-cup-three-tiebreaks', THREE_RUBBERS, 3, 'none', 1,
  'three rubbers, first to two; best of three tie-break sets');
const FED_CUP_THREE = format('fed-cup-three', THREE_RUBBERS, 3, 'final', 1,
  'three rubbers, first to two; best of three sets, a tie-break in all but the third');
const FED_CUP_FIVE = format('fed-cup-five', DOUBLES_LAST, 3, 'final', 2,
  'five rubbers over two days, the doubles last, first to three; best of three sets, a tie-break in all but the third');

/**
 * The Federation Cup, the Fed Cup and the Billie Jean King Cup by year, every rubber best of three sets. To 1994 a
 * one-week event at one venue ("Billie Jean King Cup", https://en.wikipedia.org/w/index.php?oldid=1380349265, read
 * 2026-11-10) whose ties were two singles and a doubles ("Two singles rubbers were added to the ties" in 1995: "1995 Fed
 * Cup", https://en.wikipedia.org/w/index.php?oldid=1369040089). The tie-break was first used in 1976 ("1976 Federation
 * Cup", https://en.wikipedia.org/w/index.php?oldid=1368553932); the cup's first years, 1963–1967, played the same ties
 * (Wikipedia's pages of each year, pinned in scripts/data/womens-tennis-seasons.json: two singles and the doubles third in
 * all 77 ties, none of their 520 sets ended 7–6 and 42 went past 7–5), and Jeff Sackmann's match files show the rest
 * (scripts/tennis-formats-real.mjs): none of the 1,124 sets of 1968–1975 ended 7–6 and 68 went past 7–5; 12 of 1976's
 * 158 ended 7–6 and none went past it; in 1977–1979, 31 of 547 went past 7–5 and two ended 7–6; from 1980 to 2017 the
 * World Group's first two sets ended 7–6 and never went past it, while 70 of its 761 deciding sets went past 7–5 and the
 * six that ended 7–6 were dead rubbers; from 2018 none of 1,715 sets went past 7–5. So: advantage sets to 1975 and in
 * 1977–1979, then a tie-break in all but the deciding set to 2017, in every set from 2018. From 1995 home-and-away ties of
 * four singles and the doubles last ("1995 Fed Cup"; "Billie Jean King Cup"), but in 2000 and 2001 the World Group played
 * round-robin pools at one venue ("2000 Fed Cup", https://en.wikipedia.org/w/index.php?oldid=1369039908; "2001 Fed Cup",
 * https://en.wikipedia.org/w/index.php?oldid=1369040095) of two singles and a doubles (the match files). From 2020 the
 * Finals played three-rubber ties and the qualifiers and play-offs home-and-away ones of five, the doubles last ("2024
 * Billie Jean King Cup qualifying round", https://en.wikipedia.org/w/index.php?oldid=1370525899); in 2025 the qualifiers
 * and play-offs were round-robin groups of three-rubber ties too ("2025 Billie Jean King Cup qualifying round",
 * https://en.wikipedia.org/w/index.php?oldid=1322355180), and from 2026 they are home-and-away again with the doubles
 * third, as in the Davis Cup ("2026 Billie Jean King Cup", https://en.wikipedia.org/w/index.php?oldid=1382241565).
 */
export const FED_CUP_FORMATS = Object.freeze([
  [-Infinity, FED_CUP_THREE_ADVANTAGE],
  [1976, FED_CUP_THREE_TIEBREAKS],
  [1977, FED_CUP_THREE_ADVANTAGE],
  [1980, FED_CUP_THREE],
  [1995, FED_CUP_FIVE],
  [2000, FED_CUP_THREE],
  [2002, FED_CUP_FIVE],
  [2018, format('fed-cup-five-tiebreaks', DOUBLES_LAST, 3, 'none', 2,
    'five rubbers over two days, the doubles last, first to three; best of three tie-break sets')],
  [2025, FED_CUP_THREE_TIEBREAKS],
  [2026, TODAY],
]);

/** The format a cup played in `year` (`formats` a year table above), or today's for the built-in season (null). */
export function formatOf(formats, year) {
  if (year == null) return TODAY;
  let found = TODAY;
  for (const [first, rules] of formats) if (year >= first) found = rules;
  return found;
}

/** Whether set `k` (the first is 1) of a rubber played under `rules` has a tie-break at 6–6, or is an advantage set. */
export const tiebreakSet = (rules, k) => rules.advantage === 'none' || (rules.advantage === 'final' && k < rules.bestOf);

// Ratings are Tennis Abstract's Elo on the game's scale (scripts/lib/tennis.mjs): rating = Elo / 25 + 4, so a rating
// point is 25 Elo points and Elo's own odds hold. A 4-point favourite (100 Elo) wins a best-of-three match 64% of the
// time, an 8-point one 76%, a 16-point one 91% (Elo's logistic, base 10, 400 points).
export const ELO_PER_POINT = 25;
/** The favourite's chance in a best-of-three-sets match, `gap` rating points ahead. */
export const matchOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// The share of their service points a tour's players win against an equal: 64% on the ATP, 56.7% on the WTA (tour-level
// best-of-three matches 2022–2025 in Jeff Sackmann's match files: 64.0% and 56.7%, holds 79.9% and 65.7%). A rubber
// splits the difference between the two servers so that the better player wins exactly as often as Elo says (serveEdge),
// and the sets are then played game by game (holds and breaks) and the tie-breaks point by point. The serve shapes only
// the games inside a set: women break more often, so fewer of their sets reach a tie-break and more end 6–0. Who wins a
// set, a rubber or a tie is Elo's either way.
export const ATP = Object.freeze({ id: 'atp', serve: 0.64 });
export const WTA = Object.freeze({ id: 'wta', serve: 0.567 });
const SERVE = ATP.serve;

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

// The clock: every rubber has twenty units, its sets ending at their share of its games. The rubbers that can win a tie
// make the shortest one (three of five, two of three); the others extend it as overtime periods do in other sports.
export const BLOCK = 20;
const LENGTH = TO_WIN * BLOCK;
// A unit's pace on screen, by a rubber's sets: today's best-of-three rubber lasts 20 units of 70 ms. A best-of-five rubber
// has 1.6 times its games between equal men (the model's own: 39.2 with a tie-break in every set and 39.6 without one in
// the fifth, against today's 24.4; 43.6 with no tie-break at all), so its units last 1.6 times as long. A best-of-three
// rubber's advantage sets add 1–5% (scripts/tennis-formats.test.mjs holds both), too little to slow the clock.
const MS_PER_UNIT = Object.freeze({ 3: 70, 5: 113 });

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

/**
 * A's chance to win a set that A serves first (the chance is the same whoever serves first): a tie-break set, or with
 * `tiebreak` false an advantage set, which goes on past 6–6 until a side is two games clear. Level at five all or later,
 * A serves the next game (he serves the odd ones) and takes the set by winning the next two games between them, a hold
 * and a break, before D does.
 */
export function setChance(pA, pD, tiebreak = true) {
  const hA = holdChance(pA), hD = holdChance(pD);
  // The thirteenth game is the tie-break, and A serves the odd games: he serves its first point too.
  const tiebreakOdds = tiebreak ? tiebreakChance(pA, pD) : null;
  const level = hA * (1 - hD) / (hA * (1 - hD) + (1 - hA) * hD);
  const memo = new Map();
  const at = (a, d) => {
    if (a >= 6 && a - d >= 2) return 1;
    if (d >= 6 && d - a >= 2) return 0;
    if (tiebreak && a === 6 && d === 6) return tiebreakOdds;
    if (!tiebreak && a === d && a >= 5) return level;
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
/** A's chance to win a best-of-five match whose sets he wins with `s` each: s³(10 − 15s + 6s²). */
export const bestOfFive = s => s ** 3 * (10 - 15 * s + 6 * s * s);

// Day form inside a rubber: one draw for the match, in the log-odds of winning a set, so that a player who wins the first
// set is more likely to win the second than independent sets would make him. Independent sets would send about 44% of
// the ATP's best-of-three matches to a third set; about 35% go there (Jeff Sackmann, Tennis Abstract, 2014 and 2023). A
// spread of 1 does that: between players 8 points apart (independent sets: 43%) it gives 35%, between equals 41%. The
// mean is set so that the match odds stay Elo's (setLogitFor). It holds for best of five too: over the 25,005 completed
// best-of-five matches at the majors of 1968–2025 and the 4,928 in the Davis Cup of 1968–2018 between men with twenty
// rated matches behind them (Elo before each match by Tennis Abstract's method, scripts/lib/tennis-elo.mjs), it expects
// 20.8% and 20.7% to go to a fifth set where 19.2% and 20.7% did (independent sets: 28.5% and 28.3%), and 48.0% and 48.2%
// to end in straight sets where 48.2% and 48.9% did (scripts/tennis-formats-real.mjs).
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

/**
 * A's chance in a best-of-five match that Elo makes `odds` over best of three: Elo's ratings are best-of-three ones
 * ("My version of tennis Elo is based on the most common match format, best-of-three matches. In a best-of-five match,
 * the favorite has a better chance of winning": Jeff Sackmann, "An Introduction to Tennis Elo", Tennis Abstract,
 * 3 December 2019, https://www.tennisabstract.com/blog/2019/12/03/an-introduction-to-tennis-elo/). So the set chance comes
 * from Elo's odds as in best of three (setLogitFor, under day form) and the match is five sets of it. Sackmann's own
 * conversion takes the sets as independent (his example: 81.4% becomes 86.7%); under day form the sets are not, so the
 * favourite gains less (81.4% becomes 84.1%). Against the real matches above the favourite won 72.0% at the majors and
 * 71.4% in the Davis Cup, where day form expects 73.6% and 73.9%, independent sets 75.3% and 75.7%, and Elo's own
 * best-of-three odds 71.7% and 72.1% (Elo overrates the favourite by 2–3 points in best of three too).
 */
export function bestOfFiveOdds(odds) {
  return daySetChances(odds).reduce((sum, { weight, s }) => sum + weight * bestOfFive(s), 0);
}

// bestOfFiveOdds by Elo's odds, read from a table on their log-odds scale (1/32 apart over ±16) between its points: within
// 2e-5 of the exact value, at a fraction of the cost, for the score-only path's thousands of rubbers. Built when first read.
const FIVE_STEP = 1 / 32, FIVE_RANGE = 16;
let fiveTable = null;

/** bestOfFiveOdds from its table, for the score-only path. */
export function fiveSetOdds(odds) {
  if (!(odds > 0)) return 0;
  if (!(odds < 1)) return 1;
  const x = Math.log(odds / (1 - odds));
  if (Math.abs(x) >= FIVE_RANGE) return bestOfFiveOdds(odds);
  fiveTable ??= Array.from({ length: 2 * FIVE_RANGE / FIVE_STEP + 1 }, (_, i) => bestOfFiveOdds(logistic(-FIVE_RANGE + i * FIVE_STEP)));
  const at = (x + FIVE_RANGE) / FIVE_STEP, i = Math.min(fiveTable.length - 2, Math.floor(at));
  return fiveTable[i] + (fiveTable[i + 1] - fiveTable[i]) * (at - i);
}

/** How far apart the two servers' point chances are (A's minus D's) for A to win a set with `s` (`tiebreak`: setChance). */
export function serveEdge(s, serve = SERVE, tiebreak = true) {
  const room = Math.min(serve - 0.3, 0.97 - serve) * 2;
  let lo = -room, hi = room;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (setChance(serve + mid / 2, serve - mid / 2, tiebreak) < s) lo = mid; else hi = mid;
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

/**
 * The two servers' point and hold chances when A wins a set with `s`, on a tour whose servers win `serve` of points, in
 * a tie-break set or (`tiebreak` false) an advantage set.
 */
function servesFor(s, serve = SERVE, tiebreak = true) {
  const edge = serveEdge(s, serve, tiebreak);
  const pA = serve + edge / 2, pD = serve - edge / 2;
  return { pA, pD, hA: holdChance(pA), hD: holdChance(pD) };
}

// An advantage set's bound, for safety: one that reaches 70 games all, longer than any set ever played (John Isner beat
// Nicolas Mahut 70–68 in the fifth set at Wimbledon in 2010), ends in a tie-break. Between equal men it never comes:
// from five all a set goes on two more games about seven times in ten.
export const MAX_SET_GAMES = 140;

/**
 * One set, game by game, a tie-break point by point → { a, d, tb, next }: the games, the tie-break's points [A's, D's]
 * (null without one) and whether A serves the next game. Servers alternate every game; a tie-break counts as one. A
 * tie-break set (`tiebreak`) has one at 6–6; an advantage set goes on until a side is two games clear.
 */
function playSet(rng, { pA, pD, hA, hD }, aServes, tiebreak = true) {
  let a = 0, d = 0, tb = null;
  while (!((a >= 6 || d >= 6) && Math.abs(a - d) >= 2)) {
    if ((tiebreak && a === 6 && d === 6) || a + d >= MAX_SET_GAMES) {
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

/** The serves of a match, by set kind: built when a set of that kind is first played (serveEdge is a search). */
function servesOfMatch(s, serve) {
  const serves = new Map();
  return tiebreak => {
    if (!serves.has(tiebreak)) serves.set(tiebreak, servesFor(s, serve, tiebreak));
    return serves.get(tiebreak);
  };
}

/** The sets a match of `bestOf` takes to win. */
const setsNeeded = bestOf => (bestOf + 1) / 2;

/**
 * A match that A wins with Elo's (best-of-three) `odds`, played under `rules` (TODAY: best of three tie-break sets) →
 * [{ a, d, tb }], each set's games and, for a set decided in a tie-break, its points [A's, D's]: the day's form, then the
 * sets game by game, after a toss for the first server. `tour`: ATP (the men's serve) or WTA (the women's).
 */
export function playMatch(rng, odds, tour = ATP, rules = TODAY) {
  const serves = servesOfMatch(logistic(setLogitFor(odds) + DAY_FORM * gauss(rng)), tour.serve);
  const need = setsNeeded(rules.bestOf);
  let aServes = rng() < 0.5;
  const sets = [];
  while (sets.filter(set => set.a > set.d).length < need && sets.filter(set => set.d > set.a).length < need) {
    const tiebreak = tiebreakSet(rules, sets.length + 1);
    const { next, ...set } = playSet(rng, serves(tiebreak), aServes, tiebreak);
    sets.push(set);
    aServes = next;
  }
  return sets;
}

// Tries before a draw that should almost never miss gives up: a day-form draw for a 0.075% underdog's win (a 50-point
// gap) is found within them all but about once in 1,800, a set for its winner far more surely.
const MAX_TRIES = 10000;
const mirrored = set => ({ ...set, a: set.d, d: set.a, tb: set.tb && [set.tb[1], set.tb[0]] });

// The orders a best-of-five match's sets can fall in for its winner, [true, false…] true for a set he takes: the last
// set his, the loser's sets (none, one or two) among the ones before it. Each with how many the loser takes.
const FIVE_SET_ORDERS = Object.freeze([0, 1, 2].flatMap(lost => {
  const orders = [];
  const place = (prefix, left, taken) => {
    if (prefix.length === 2 + lost) { if (left === 0) orders.push(Object.freeze([...prefix, true])); return; }
    if (taken < 2) place([...prefix, true], left, taken + 1);
    if (left > 0) place([...prefix, false], left - 1, taken);
  };
  place([], lost, 0);
  return orders.map(order => ({ order, lost }));
}));

/**
 * Which sets the winner of a match of `bestOf` takes, given he wins it, his set chance `w` → [true, false…]: each order as
 * likely as w^n(1 − w)^k makes it, k the loser's sets. Best of three: straight sets 1/(3 − 2w), a set dropped second or
 * first (1 − w)/(3 − 2w) each.
 */
function setsTaken(rng, w, bestOf) {
  if (bestOf === 3) {
    const roll = rng() * (3 - 2 * w);
    return roll < 1 ? [true, true] : roll < 2 - w ? [true, false, true] : [false, true, true];
  }
  const weights = FIVE_SET_ORDERS.map(({ lost }) => (1 - w) ** lost);
  let roll = rng() * weights.reduce((sum, x) => sum + x, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return FIVE_SET_ORDERS[i].order;
  }
  return FIVE_SET_ORDERS.at(-1).order;
}

/**
 * A match that A wins with Elo's (best-of-three) `odds`, played under `rules` (TODAY: best of three tie-break sets),
 * played out given that A wins it (`aWins`) or loses it, exactly: the day's form given the result (drawn from its prior,
 * kept with the chance it gives that result), then which sets the winner takes given that form, then each set game by
 * game given its winner. `tour`: ATP (the men's serve) or WTA (the women's).
 */
export function playMatchWon(rng, odds, aWins, tour = ATP, rules = TODAY) {
  const matchChance = rules.bestOf === 5 ? bestOfFive : bestOfThree;
  const mean = setLogitFor(odds);
  let s = null;
  for (let i = 0; i < MAX_TRIES && s === null; i++) {
    const drawn = logistic(mean + DAY_FORM * gauss(rng));
    const won = matchChance(drawn);
    if (rng() < (aWins ? won : 1 - won)) s = drawn;
  }
  s ??= logistic(mean);
  const winnerTakes = setsTaken(rng, aWins ? s : 1 - s, rules.bestOf);
  const serves = servesOfMatch(s, tour.serve);
  let aServes = rng() < 0.5;
  return winnerTakes.map((winnerWins, k) => {
    const aTakes = winnerWins === aWins;
    const tiebreak = tiebreakSet(rules, k + 1);
    let set = null;
    for (let i = 0; i < MAX_TRIES && (!set || (set.a > set.d) !== aTakes); i++) set = playSet(rng, serves(tiebreak), aServes, tiebreak);
    if ((set.a > set.d) !== aTakes) set = mirrored(set);
    aServes = set.next;
    const { next, ...played } = set;
    return played;
  });
}

/** A set's games from the winner's side: "6–4", "7–6(5)" with the loser's tie-break points, or an advantage set's "9–7". */
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
 * (or pair) is ahead (`gap`), tactics, upsets and the venue included, and the format it is played under (`rules`,
 * TODAY unless told). `venue.home`: the defender is at home.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = TODAY) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const sideA = sideOf(lineupA), sideD = sideOf(lineupD);
  const rubbers = rules.order.map(places => {
    const doubles = places === null;
    const a = doubles ? sideA.pair : sideA.singles[places[0]];
    const d = doubles ? sideD.pair : sideD.singles[places[1]];
    const edge = home ? (doubles ? HOME_EDGE.doubles : HOME_EDGE.singles) : 0;
    // An empty place concedes its rubber (a walkover); when both are empty, the defender keeps it.
    const walkover = !a || !d ? (a ? 'A' : 'D') : null;
    return { doubles, a: a?.name ?? null, d: d?.name ?? null, walkover,
      gap: walkover ? 0 : a.rating + adjustmentA - (d.rating + adjustmentD) - edge };
  });
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, rubbers, rules };
}

/**
 * The attacker's chance in each rubber after match-day `form` (rating points): 0 or 1 for a walkover. Best of three
 * (`bestOf`, unless 5), Elo's own odds; best of five, Elo's odds over five sets (fiveSetOdds).
 */
export const rubberOdds = (rubber, form = 0, bestOf = 3) => (rubber.walkover ? (rubber.walkover === 'A' ? 1 : 0)
  : bestOf === 5 ? fiveSetOdds(matchOdds(rubber.gap + form)) : matchOdds(rubber.gap + form));

/**
 * Score-only path: one form draw for the tie, then each rubber won with its odds until a side has the rubbers that win
 * it (three of five, or two of three). Also returns the form and who won each rubber played (`rubbers`, 'A' or 'D'),
 * which the full simulation plays out.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const { toWin, bestOf } = prepared.rules ?? TODAY;
  const form = gauss(rng) * formSpread(variation);
  const won = [];
  let ga = 0, gd = 0;
  for (const rubber of prepared.rubbers) {
    if (rng() < rubberOdds(rubber, form, bestOf)) { ga++; won.push('A'); } else { gd++; won.push('D'); }
    if (ga === toWin || gd === toWin) break;
  }
  return { ga, gd, regA: ga, regD: gd, tie: null, winner: ga > gd ? prepared.attackerId : prepared.defenderId, form, rubbers: won };
}

/**
 * The whole tie: sampleResult's own draws decide every rubber (so a seed gives the same score on both paths), then each
 * rubber's sets are played out given its winner, under the tie's format. One event per set won, at its share of the
 * rubber's games on the clock, `pts` 1 for the set that wins the rubber (the score counts rubbers) and 0 for the others;
 * a walkover is one event with no sets. `tour`: ATP (the men's serve) or WTA (the women's).
 */
export function simulateTie(rng, prepared, drama = 6, tour = ATP) {
  const rules = prepared.rules ?? TODAY;
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
    const sets = playMatchWon(rng, rubberOdds(rubber, result.form), aWon, tour, rules);
    const games = sets.reduce((sum, set) => sum + set.a + set.d, 0);
    let played = 0;
    const at = sets.map((set, k) => {
      played += set.a + set.d;
      return k === sets.length - 1 ? BLOCK : clamp(Math.round(BLOCK * played / games), 1, BLOCK - 1);
    });
    // One unit apart at least, inside the rubber's block: a long advantage set can crowd the sets before it into one unit.
    for (let k = 1; k < at.length; k++) at[k] = Math.max(at[k], at[k - 1] + 1);
    for (let k = at.length - 2; k >= 0; k--) at[k] = Math.min(at[k], at[k + 1] - 1);
    sets.forEach((set, k) => {
      const last = k === sets.length - 1;
      const by = set.a > set.d ? 'A' : 'D';
      ev.push({ ...common, m: start + at[k], side: by, name: by === 'A' ? rubber.a : rubber.d, pts: last ? 1 : 0, set: k + 1,
        score: last ? scoreText(sets, aWon) : setText(set, by === 'A') });
    });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The rubber an event or clock unit falls in: R1 for 1–20, R2 for 21–40… (the start counts as the first). */
const rubberAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, RUBBERS);
/** A tie's rubbers from its clock's length, the rubbers that win it: five for 60 units, three for 40. */
const rubbersOf = length => (Number(length) > 0 ? 2 * Math.round(Number(length) / BLOCK) - 1 : RUBBERS);
const kindOf = e => (e.doubles ? 'DOUBLES' : 'SINGLES');

/**
 * A sport played by these rules with one tour's players (sport `id`'s, sportData.js): `tour` its serve (ATP, the men's
 * Davis Cup; WTA, the women's Billie Jean King Cup), `formats` its cup's year table (DAVIS_CUP_FORMATS, FED_CUP_FORMATS).
 * The built-in season plays today's ties; an earlier season its own year's (`rulesFor`, read by matchSport), the same
 * sport but for the format.
 */
export const tennisSport = ({ id, name, blurb, tour = ATP, formats = DAVIS_CUP_FORMATS }) => {
  const territoryOf = rosters => ({
    merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
    // East Germany and South Vietnam (HISTORIC_NATIONS) are not on today's map: no tie of the built-in season is played there.
    inactive: Object.keys(NATIONS).filter(nation => !HOME_NATIONS.includes(nation) && !HISTORIC_NATIONS.includes(nation)
      && !Object.hasOwn(rosters, nation)),
  });
  /** A whole tie under `rules`, its events each side's team's. */
  const simulateUnder = rules => (rng, attacker, defender, drama, effA, effD, venue) => {
    const prepared = prepareMatch(attacker, defender, effA, effD, venue, rules);
    const { ga, gd, ev, winner } = simulateTie(rng, prepared, drama, tour);
    return { ga, gd, regA: ga, regD: gd, tie: null, winner,
      ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
  };
  const base = {
    id,
    simulationVersion: 1,
    name,
    blurb,
    // Read from the sport's players (sportData.js), once they have loaded.
    rosters: undefined,
    clubs: [],
    // Nations only: tennis has no clubs to play.
    nationsOnly: true,
    tour,
    // Great Britain plays either cup as one: the home nations' shapes start in the United Kingdom's (826) empire. A
    // nation with fewer than two rated players fields no team, and its land stays neutral.
    territory: undefined,
    // That empire plays as Great Britain, under the Union Jack.
    playsAs: { '826': GREAT_BRITAIN },
    // The format its ties are played under (TODAY, or a year's: formatOf).
    rules: TODAY,

    squadSize: 4,
    formation: { SGL: 2, DBL: 2 },
    positionPlan: ['SGL', 'SGL', 'DBL', 'DBL'],
    positionColors: { SGL: C.cyan, DBL: C.gold },

    fallbackStrength: () => EMPTY_STRENGTH,
    requiredPositions: [],

    // Twenty clock units a rubber; the chart ticks at the end of each. A tie ends with its deciding set, the last event.
    clock: { length: LENGTH, msPerUnit: MS_PER_UNIT[3], ot: BLOCK, tick: BLOCK },
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
    // The feed's live row, from the clock's length: "rubber 2 of 5", or "of 3" in a three-rubber tie.
    clockLeft: (now, length) => `rubber ${rubberAt(now)} of ${rubbersOf(length)}`,
    formatEvent: (e, code) => ({ when: `R${e.rubber || rubberAt(e.m)}`, text: e.pts > 0
      ? `${kindOf(e)} — ${e.name} (${code}) ${e.score}`
      : `SET ${e.set} — ${e.name} (${code}) ${e.score}` }),
    formatToast: e => (e.pts > 0 ? `${kindOf(e)} — ${String(e.name).toUpperCase()} ${e.score}` : `SET ${e.set} — ${String(e.name).toUpperCase()} ${e.score}`),

    prepareMatch,
    sampleResult,
    simulate: simulateUnder(TODAY),
  };
  const options = { clubs: false, territoryOf };
  const sport = defineSportData({
    ...base,
    /**
     * The sport a campaign plays (matchSport): the built-in season, and every earlier one whose year played today's
     * ties, this one; another year's format the same sport with its rubbers, sets and clock (one object a format).
     */
    rulesFor: settings => {
      const rules = formatOf(formats, rulesYear(settings));
      return rules === TODAY ? sport : ofFormat(rules);
    },
  }, options);
  const ofFormat = rulesMemo(rules => defineSportData({
    ...base,
    // Version 2: best of five, advantage sets and three-rubber ties.
    simulationVersion: 2,
    rules,
    clock: { length: rules.toWin * BLOCK, msPerUnit: MS_PER_UNIT[rules.bestOf], ot: BLOCK, tick: BLOCK },
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),
    simulate: simulateUnder(rules),
  }, options));
  return sport;
};

/** The men's game: the ATP's players in the Davis Cup. */
export const tennis = tennisSport({
  id: 'tennis',
  name: 'Tennis',
  blurb: 'Davis Cup ties: four singles and a doubles over two days, first to three rubbers. Every match is best of three sets.',
  tour: ATP,
  formats: DAVIS_CUP_FORMATS,
});

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
