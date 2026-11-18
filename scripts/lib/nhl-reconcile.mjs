// Ice hockey's computed seasons reconciled with their real results (docs/design/computed-ratings.md, step 5;
// docs/design/hockey.md, "Computed seasons"): each club's results strength S (scripts/lib/nhl-computed.mjs
// resultsStrengthOf), the margin the match model (src/sports/hockey.js) gives a game per point of lineup strength under the
// season's rules (m), each club's target T = μ + √r × S ÷ m, and the move that brings its players there. No I/O here.
import { clubMoveOf, mean, perPointOf, resultsTargets } from './computed-ratings.mjs';
import { resultsStrengthOf } from './nhl-computed.mjs';
import { hashStr, makeRng, selectLineup, teamEff } from '../../src/data/teams.js';
import { hockeyProfile, hockeyWith, lateOf, overtimeOf, PERIOD_MODEL } from '../../src/sports/hockey.js';

/**
 * The engine's measuring runs: the scoring level's rounds and games (each club against itself), and perPointOf's gaps and
 * games at each gap.
 */
export const MEASURE = Object.freeze({ scoringRounds: 3, scoringGames: 8000, deltas: Object.freeze([-4, -2, 2, 4]), games: 10000 });

/** The last season whose league played no overtime (1982/83): its level games were ties, its goals all regulation's. */
export const LAST_WITHOUT_OVERTIME = 1983;

/**
 * The strength a lineup plays at: the mean of its attack and its defence as the match model weighs them (hockeyProfile:
 * the defence half the goalie, half the skaters). Two sides' goal rates part by the gap between their played strengths, as
 * a margin a game of about m a point.
 */
export function playedStrength(lineup) {
  const { attack, defence, goaltending } = hockeyProfile(lineup);
  return (attack + (goaltending + defence) / 2) / 2;
}

const seasonLabel = year => `${year - 1}/${String(year).slice(-2)}`;

/**
 * m, the margin a game the match model gives per point of played strength in the season ending in `year`, whose league
 * scored `goals` a club a game (docs/design/computed-ratings.md, step 5.2): perPointOf over games between each of `clubs`
 * (team objects, `{ id, sport: 'hockey', squad }`) and itself moved δ/2 up and δ/2 down, the clubs in turn, under the
 * season's late game and overtime, at the scoring level that brings the clubs, each against itself, to the league's goals
 * (a shoot-out's goal left out, as the league counts them; `MEASURE.scoringRounds` rounds, each scaling the level by how far
 * the last fell short). The margin is the final score's, a shoot-out's goal left out, as the results count it; to 1982/83,
 * when the league played no overtime, the regulation score's. → `{ perPoint, scoring }`.
 */
export function marginPerPoint({ clubs, year, goals, seed }) {
  const rules = { season: seasonLabel(year), scoring: 1, late: lateOf(year), overtime: overtimeOf(year, goals) };
  const sport = hockeyWith(rules);
  // Each club's matches prepared once at scoring 1: a level only scales both rates.
  const prepared = new Map();
  const match = (index, delta, scoring) => {
    const key = `${index}|${delta}`;
    if (!prepared.has(key)) {
      const club = clubs[index], eff = teamEff(club);
      prepared.set(key, sport.prepareMatch(club, club, eff + delta / 2, eff - delta / 2));
    }
    const p = prepared.get(key);
    return { ...p, rateA: p.rateA * scoring, rateD: p.rateD * scoring, rules: { ...p.rules, scoring } };
  };
  const shootout = result => result.goals.some(goal => goal.slice > PERIOD_MODEL.SLICES);
  let scoring = 1;
  for (let round = 0; round < MEASURE.scoringRounds; round++) {
    const rng = makeRng(hashStr(`${seed}|scoring|${round}`));
    const level = clubs.map((club, index) => match(index, 0, scoring));
    let scored = 0;
    for (let g = 0; g < MEASURE.scoringGames; g++) {
      const result = sport.sampleResult(rng, level[g % clubs.length], 6);
      scored += result.ga + result.gd - (shootout(result) ? 1 : 0);
    }
    scoring *= goals / (scored / (2 * MEASURE.scoringGames));
  }
  const at = new Map();
  let next = 0;
  const play = (delta, rng) => {
    const index = next++ % clubs.length;
    const key = `${index}|${delta}`;
    if (!at.has(key)) at.set(key, match(index, delta, scoring));
    const result = sport.sampleResult(rng, at.get(key), 6);
    if (year <= LAST_WITHOUT_OVERTIME) return result.regA - result.regD;
    return result.ga - result.gd - (shootout(result) ? Math.sign(result.ga - result.gd) : 0);
  };
  const perPoint = perPointOf({ play, rng: makeRng(hashStr(`${seed}|margin`)), deltas: MEASURE.deltas, games: MEASURE.games });
  return { perPoint, scoring: Number(scoring.toFixed(4)) };
}

/**
 * Step 5 for one computed season: every club moved toward its real results. `clubs`: `[{ id, code, squad, others }]`, a
 * club's squad the players its file lists, in the file's order, and `others` the rest of its players that season (each
 * `{ name, rating, value, … }`, his rating before the move and his value, step 3's). `results`: the snapshot's; `goals`: the league's goals a club a game.
 * The strength moved is the squad's lineup's played strength; each club's target is T = μ + √r × S ÷ m (resultsTargets),
 * μ the clubs' mean before the move; the move is clubMoveOf's over the squad, a whole number for every player plus one
 * more for the squad's best few, no player passing one rated above him in his club; the club's other players move by the
 * whole number. → `{ strength (S, its kind and reliability), perPoint, scoring, mean, clubs: [{ id, code, results, target,
 * before, after, shift, plus, squad, others }] }`, the players moved, in their own order.
 */
export function reconcileClubs({ clubs, results, year, goals, seed }) {
  const strengthOf = squad => playedStrength(selectLineup({ sport: 'hockey', squad }));
  const strength = resultsStrengthOf(results);
  const missing = clubs.filter(club => !Number.isFinite(strength.ratings[club.code])).map(club => club.code);
  if (missing.length) throw new Error(`No results for ${missing.join(', ')}`);
  const teams = clubs.map(club => ({ id: club.id, sport: 'hockey', squad: club.squad }));
  const { perPoint, scoring } = marginPerPoint({ clubs: teams, year, goals, seed });
  const level = mean(clubs.map(club => strengthOf(club.squad)));
  const { targets } = resultsTargets(strength, { mean: level, perPoint });
  // The best first: by rating, then by value (so that within a group the better of two equals gets the point more and
  // nobody passes anybody), then by name, so that a tie is broken the same way every build.
  const bestFirst = (a, b) => b.rating - a.rating || (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name);
  const moved = clubs.map(club => {
    const target = targets[club.code];
    const { shift, plus, before, after, pool } = clubMoveOf(club.squad, target, strengthOf, { bestFirst });
    const others = club.others.map(player => ({ ...player, rating: Math.min(99, Math.max(1, player.rating + shift)) }));
    return { id: club.id, code: club.code, results: strength.ratings[club.code], target, before, after, shift, plus, squad: pool, others };
  });
  return { strength, perPoint, scoring, mean: level, clubs: moved };
}
