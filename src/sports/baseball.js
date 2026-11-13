import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { BASEBALL_SEASON_PREMIUMS } from '../data/baseballSeasonPremiums.js';
import { LATEST_MLB_SEASON, mlbRunsPerGame } from '../data/mlbLeagueAverages.js';
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
// Extra innings start with a runner on second, so a run comes far more often: 61.4% of the time from second with nobody
// out in 2010–15 (Tom Tango's tables, below). Before 2020 an extra inning played as the ninth did (eraRules).
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
// average lineup facing an average staff is an even edge. Each earlier season has its own (`seasonPremium`).
const PITCHING_PREMIUM = 2.3;

const logit = p => Math.log(p / (1 - p));
const logistic = x => 1 / (1 + Math.exp(-x));
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 40);

// ---- Rules by era (docs/design/baseball.md, "Rules by era") ----

/**
 * The rules a match is played under, carried on its prepared match: `score` and `extra` are a regulation and an extra
 * half-inning's chance to score between equals (in logit), `runner` whether extra innings start with a runner on second,
 * `more` the ratio of a scoring half-inning's further runs, `maxExtra` the extra innings before the decisive run and
 * `premium` how far the season's ratings put pitching above hitting. The built-in season plays today's.
 */
const BUILT_IN = Object.freeze({ score: logit(BASE_SCORE), extra: logit(EXTRA_SCORE), runner: true, more: MORE_RUNS, maxExtra: MAX_EXTRA,
  premium: PITCHING_PREMIUM });
// MLB's automatic runner on second in extra innings: its regular seasons from 2020, extended through 2022 and made
// permanent from 2023, never its postseason (https://en.wikipedia.org/w/index.php?oldid=1380896790, read 2026-11-10).
// The game's campaigns play the regular season's rule.
const RUNNER_FROM = 2020;
// Before it, an extra inning plays as the ninth did: between average sides 52–63% of them end level, as 56% of 2019's
// did (43.9% of its extra-inning games ended in the tenth, the same source). Six extra innings, enough with the runner
// (0.06% of extra-inning games reach the decisive run), would leave 2–6% of them to it; twelve, 21 innings (the era's
// longest games went 24 and 25, the same source), leave 0.04–0.4%.
const STANDARD_MAX_EXTRA = 12;
// A season's scoring rate against today's moves how often a half-inning scores by three quarters of the change and how
// many a scoring one brings by the rest: across Tom Tango's four eras of 1950–2015 (run expectancy and the chance of a
// run from the start of an inning, Retrosheet's data, http://www.tangotiger.net/re24.html, read 2026-11-10), the chance
// moves with the runs at a slope of 0.75 (log against log). The Databank's shutouts by season agree best at 0.75.
const FREQUENCY_SHARE = 0.75;

/**
 * The runs a walk-off half-inning counts: WALKOFF[runs][need] is what its `runs`, told as RBI hits of one to four (each
 * size as likely), add before the home side has the `need` it wanted, the hit that gets there included (sampleResult).
 */
const WALKOFF = (() => {
  const table = Array.from({ length: RUN_CAP + 1 }, () => new Array(RUN_CAP + 2).fill(0));
  for (let left = 1; left <= RUN_CAP; left++) {
    for (let need = 1; need <= RUN_CAP + 1; need++) {
      const sizes = Math.min(left, 4);
      let sum = 0;
      for (let hit = 1; hit <= sizes; hit++) sum += hit + (hit < need ? table[left - hit][need - hit] : 0);
      table[left][need] = sum / sizes;
    }
  }
  return table;
})();

/**
 * The runs a game brings, both sides', between equal sides under `rules`, worked out exactly as sampleResult plays it:
 * nine tops, a bottom of the ninth only when the home side does not lead and ended by a walk-off, the extra innings and
 * the decisive run (match-day form left out). A margin beyond MARGIN runs is held there: none of the game's rules can
 * tell it from a larger one in the innings left.
 */
function gameRuns(rules) {
  const MARGIN = 45, size = 2 * MARGIN + 1;
  const regular = runMasses(logistic(rules.score), rules.more), extra = runMasses(logistic(rules.extra), rules.more);
  const meanOf = masses => masses.reduce((sum, p, k) => sum + p * k, 0);
  // The margin (the attacker's runs less the home side's) after a half-inning in which one side bats.
  const bat = (margins, masses, sign) => {
    const next = new Float64Array(size);
    margins.forEach((p, i) => {
      if (p) masses.forEach((q, k) => { next[clamp(i + sign * k, 0, size - 1)] += p * q; });
    });
    return next;
  };
  let margins = new Float64Array(size);
  margins[MARGIN] = 1;
  let runs = 0;
  for (let inning = 1; inning < INNINGS; inning++) {
    margins = bat(bat(margins, regular, 1), regular, -1);
    runs += 2 * meanOf(regular);
  }
  margins = bat(margins, regular, 1);
  runs += meanOf(regular);
  // The bottom of the ninth, and each extra inning's: home behind by `behind` (or level) bats until it leads.
  const bottom = (p, behind, masses) => {
    let level = 0;
    masses.forEach((q, k) => {
      runs += p * q * (k > behind ? WALKOFF[k][behind + 1] : k);
      if (k === behind) level += p * q;
    });
    return level;
  };
  let level = 0;
  for (let i = MARGIN; i < size; i++) if (margins[i]) level += bottom(margins[i], i - MARGIN, regular);
  for (let inning = 1; inning <= rules.maxExtra && level > 0; inning++) {
    let still = 0;
    extra.forEach((q, top) => {
      runs += level * q * top;
      still += bottom(level * q, top, extra);
    });
    level = still;
  }
  return runs + level;
}

/**
 * The rules of MLB's regular season `year`, its ratings' pitching `premium` given. Its extra innings start with a
 * runner on second from 2020; before, they play as the ninth does, twelve of them. Its half-innings score so that a
 * game between equal sides brings the season's runs a game in the proportion the real ones bear to the latest full
 * season's (2026, the built-in season's own, whose odds are BASE_SCORE and MORE_RUNS), its extra innings' runs
 * included (gameRuns); a season without figures plays at the latest's.
 */
function eraRules(year, premium) {
  const runner = year >= RUNNER_FROM;
  // The odds at `level` times today's runs a half-inning: three quarters of it in how often one scores.
  const at = level => {
    const score = logit(BASE_SCORE * level ** FREQUENCY_SHARE);
    return { score, extra: runner ? BUILT_IN.extra + score - BUILT_IN.score : score, runner,
      more: 1 - (1 - MORE_RUNS) / level ** (1 - FREQUENCY_SHARE), maxExtra: runner ? MAX_EXTRA : STANDARD_MAX_EXTRA, premium };
  };
  const latest = mlbRunsPerGame(LATEST_MLB_SEASON);
  const target = gameRuns(BUILT_IN) * (mlbRunsPerGame(year) ?? latest) / latest;
  let low = 0.25, high = 2;
  for (let step = 0; step < 48; step++) {
    const mid = (low + high) / 2;
    if (gameRuns(at(mid)) < target) low = mid; else high = mid;
  }
  return Object.freeze(at((low + high) / 2));
}

function profile(lineup, premium = PITCHING_PREMIUM) {
  const of = positions => lineup.slots.filter(slot => positions.includes(slot.position)).map(slot => slot.effectiveRating);
  const batting = mean(of(HITTERS));
  const fielding = mean(of(FIELDERS));
  const starter = mean(of(['SP'])), bullpen = mean(of(['RP']));
  const pitching = STARTER_SHARE * starter + (1 - STARTER_SHARE) * bullpen;
  return { batting, pitching, fielding,
    defence: PITCHING_SHARE * pitching + (1 - PITCHING_SHARE) * fielding - premium };
}

/**
 * A season's pitching premium, from its clubs (teams as buildClub makes them): how far their defence rates above their
 * batting on average, to the hundredth, so that its average lineup facing its average staff is an even edge whatever its
 * ratings' balance (MLB The Show 19's clubs 1.53, the 1972 season computed from WAR 2.61). npm run build:mlb-seasons
 * lists each season's (src/data/baseballSeasonPremiums.js).
 */
export function seasonPremium(clubs) {
  const gaps = clubs.map(club => {
    const { batting, pitching, fielding } = profile(selectLineup(club));
    return PITCHING_SHARE * pitching + (1 - PITCHING_SHARE) * fielding - batting;
  });
  return Math.round(mean(gaps) * 100) / 100;
}

/** A side's half-inning at `edge` = its batting minus the opposing defence: its chance to score, regulation and extra. */
export function inningOdds(edge, rules = BUILT_IN) {
  return {
    score: logistic(rules.score + SCORE_SCALE * edge),
    extra: logistic(rules.extra + SCORE_SCALE * edge),
  };
}

/**
 * P(a half-inning brings k runs) for k = 0…RUN_CAP, the last holding "RUN_CAP or more", when it scores with `score` and
 * each further run comes with `more`.
 */
export function runMasses(score, more = MORE_RUNS) {
  const masses = new Array(RUN_CAP + 1).fill(0);
  masses[0] = 1 - score;
  let total = masses[0];
  for (let k = 1; k < RUN_CAP; k++) {
    masses[k] = score * (1 - more) * more ** (k - 1);
    total += masses[k];
  }
  masses[RUN_CAP] = Math.max(0, 1 - total);
  return masses;
}

/**
 * Prepare a matchup once, including position assignments, for cheap resampling, under `rules` (today's unless a season
 * gives its own; carried as `rules`). `venue.home`: the defender, which bats last, plays at home (the campaign's home
 * advantage); a neutral venue otherwise.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}, rules = BUILT_IN) {
  const lineupA = selectLineup(attacker);
  const lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const a = profile(lineupA, rules.premium), d = profile(lineupD, rules.premium);
  const edge = home ? HOME_EDGE : 0;
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    lineupA,
    lineupD,
    innings: INNINGS,
    rules,
    edgeA: a.batting + adjustmentA - (d.defence + adjustmentD) - edge,
    edgeD: d.batting + adjustmentD - (a.defence + adjustmentA) + edge,
  };
}

/** One half-inning's runs: none, or one plus a geometric run of more. */
function halfInning(rng, score, more) {
  if (rng() >= score) return 0;
  let runs = 1;
  while (runs < 30 && rng() < more) runs++;
  return runs;
}

/**
 * Score-only path: half-inning by half-inning, the home side batting last. The bottom of the ninth is not played when
 * the home side leads, and the hit that puts it ahead in the ninth or later ends the game at once, with every run it
 * drives in (a walk-off home run with men on wins by more than one). Level after nine, extra innings under the match's
 * rules: each half starts with a runner on second from 2020, as the ninth did before; after the last extra inning
 * (the sixth with the runner, the twelfth without) a decisive run settles it. Also returns every half-inning's runs in
 * order (`halves`: { side, runs, half, hits? }, `half` 0 the top of the first, `hits` a walk-off half's RBI hits) so the
 * full simulation can time its events.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const rules = prepared.rules ?? BUILT_IN;
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * variation * FORM_PER_DRAMA;
  const oddsA = inningOdds(prepared.edgeA + form, rules);
  const oddsD = inningOdds(prepared.edgeD - form, rules);
  const halves = [];
  let ga = 0, gd = 0, regA = 0, regD = 0, extras = 0;
  for (let inning = 1; inning <= INNINGS + rules.maxExtra; inning++) {
    const extra = inning > INNINGS;
    if (extra && ga !== gd) break;
    if (inning === INNINGS + 1) [regA, regD] = [ga, gd];
    if (extra) extras++;
    const top = halfInning(rng, extra ? oddsA.extra : oddsA.score, rules.more);
    ga += top;
    halves.push({ side: 'A', runs: top, half: 2 * (inning - 1) });
    // Home ahead going into the bottom of the ninth or later: the game is over.
    if (inning >= INNINGS && gd > ga) break;
    let bottom = halfInning(rng, extra ? oddsD.extra : oddsD.score, rules.more);
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

/** A complete match from a prepared matchup: the score-only outcome, then each run told as RBI hits on its outs. */
function playMatch(rng, prepared, attacker, defender, drama) {
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
}

/** Baseball without its players: every season's rules (`baseballIn`) share these, read at import. */
const baseballRules = {
  id: 'baseball',
  simulationVersion: 2,
  name: 'Baseball',
  blurb: 'Nine innings, nine in the order and a pitching staff. The home side bats last — level games go to extra innings.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  // The World Baseball Classic fields Great Britain and the Kingdom of the Netherlands: the home nations' shapes start
  // in the United Kingdom's (826) empire.
  territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
  // That empire plays as Great Britain, under the Union Jack. A season's sport keeps this with the rest of baseball's.
  playsAs: { '826': GREAT_BRITAIN },
  /**
   * The rules a campaign plays (matchSport): an earlier season's own, at its league's scoring rate and with its day's
   * extra innings (`baseballIn`); the built-in season today's.
   */
  rulesFor: settings => baseballIn(settings),

  squadSize: 13,
  formation: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, LF: 1, CF: 1, RF: 1, DH: 1, SP: 1, RP: 3 },
  positionPlan: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'RP', 'RP'],
  positionColors: { C: C.gold, '1B': C.cyan, '2B': C.cyan, '3B': C.cyan, SS: C.cyan, LF: C.green, CF: C.green, RF: C.green,
    DH: C.red, SP: '#B07CD8', RP: '#7FA7E8' },

  // A nation whose MLB players hold less than half the lineup fields no team (fieldedNations). Built anyway, one with
  // none would be all generated at this strength.
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
    return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue), attacker, defender, drama);
  },
};

export const baseball = defineSportData({ ...baseballRules });

/**
 * Baseball in an earlier season, one object per season and premium (so caches keyed by the sport hold): the same model
 * under its year's rules (eraRules). Version 3: version 2 played every season at today's scoring and extra innings.
 */
const eraSport = rulesMemo(key => {
  const [year, premium] = key.split('|').map(Number);
  const rules = eraRules(year, premium);
  return defineSportData({
    ...baseballRules,
    simulationVersion: 3,
    prepareMatch: (attacker, defender, effA, effD, venue) => prepareMatch(attacker, defender, effA, effD, venue, rules),

    simulate(rng, attacker, defender, drama, effA, effD, venue) {
      return playMatch(rng, prepareMatch(attacker, defender, effA, effD, venue, rules), attacker, defender, drama);
    },
  }, { id: 'baseball' });
});

/**
 * The rules a setup's or campaign's settings play baseball under: a built-in earlier season's (its `dataSet` and
 * `dataYear`) at its league's scoring rate, with its day's extra innings and its ratings' own pitching premium; the
 * built-in current season, which has no data set, `baseball` itself, today's rules exactly.
 */
export function baseballIn(settings) {
  const year = rulesYear(settings);
  if (year == null) return baseball;
  const premium = Object.hasOwn(BASEBALL_SEASON_PREMIUMS, settings.dataSet) ? BASEBALL_SEASON_PREMIUMS[settings.dataSet] : PITCHING_PREMIUM;
  return eraSport(`${year}|${premium}`);
}

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

/**
 * The constants the live win-probability model mirrors (src/engine/winProbability.js); `RULES` today's, which a live
 * model of an earlier season replaces with its own odds.
 */
export const INNING_MODEL = Object.freeze({ OUTS, INNING, INNINGS, LENGTH, MAX_EXTRA, FORM_PER_DRAMA, DECISIVE_RUN, RUN_CAP,
  RULES: BUILT_IN });
