// The computed NFL and AFL seasons' clubs moved toward their real results (docs/design/computed-ratings.md, step 5;
// docs/design/american-football.md, "Computed seasons"): each club's Simple Rating System from the season's games, the
// margin the match model gives a point of the strength it plays, and each club's whole-number move toward its target.
// scripts/sync-pfa.mjs runs it on each season after its players are rated. No I/O here.
import { clubMoveOf, mean, perPointOf, resultsTargets, srsOf } from './computed-ratings.mjs';
import { squadOf } from './nfl.mjs';
import { hashStr, makeRng, selectLineup } from '../../src/data/teams.js';
import { americanFootballProfile, DRIVE_MODEL, sampleResult } from '../../src/sports/americanFootball.js';

const SPORT = 'american-football';
/** The form the margin is measured under: the Balanced Upsets setting, a campaign's default (and the realism harness's). */
const DRAMA = 6;
/** Games played at each gap when m is measured: 160,000 a season, which holds m to about ±0.01 points. */
export const PER_POINT_GAMES = 40000;

/**
 * The strength the match model plays a squad at: the mean of its lineup's offence and defence, the weighted means of its
 * starters by group that src/sports/americanFootball.js rates a side's drives by (`profile`). A whole point for every
 * player moves it a point. The kicker's part, about 2% of a point of offence and defence, is not counted.
 */
export function playedStrength(squad) {
  const { offence, defence } = americanFootballProfile(selectLineup({ sport: SPORT, squad }));
  return (offence + defence) / 2;
}

/**
 * m: the margin, in points a game, the match model gives a point of played strength under a season's `rules`
 * (seasonRules): perPointOf over sides 2 and 4 points apart either way, each side's edge that far from the season's
 * average matchup, kickers alike, Balanced form, a neutral venue, a level game decided by the season's overtime.
 * `seed` names the RNG's stream. Rounded to three decimals.
 */
export function marginPerPoint(rules, seed, games = PER_POINT_GAMES) {
  const play = (delta, rng) => {
    const { ga, gd } = sampleResult(rng, { attackerId: 'A', defenderId: 'D', rules, drives: rules.drives ?? DRIVE_MODEL.DRIVES,
      edgeA: rules.edge + delta, edgeD: rules.edge - delta, kickingA: rules.kicker, kickingD: rules.kicker }, DRAMA);
    return ga - gd;
  };
  return Math.round(perPointOf({ play, rng: makeRng(hashStr(seed)), games }) * 1000) / 1000;
}

/** A figure as the snapshots record it: rounded half up to `places` decimals (Math.round, so the sync and its test agree). */
export const rounded = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * A league-season's clubs moved toward their results. `pools`: each club's players, `{ franchise: [{ name, pos, rating,
 * … }] }`, in the snapshot's order; `gaps`: the places each club's lineup documents as short (squadOf); `games`: the
 * season's (seasonGames); `perPoint`: m (marginPerPoint). S is each club's SRS (srsOf, points a game), its target
 * T = μ + √r × S ÷ m (resultsTargets) with μ the clubs' mean played strength before the move, and each club moves by
 * clubMoveOf on the played strength of the squad it fields: every player by one whole number and its best few by one
 * more, never reordered. → `{ srs, mean, scale, clubs: { franchise: { srs, target, before, after, shift, plus } },
 * pools }`: the SRS (ratings, home edge, sigma, reliability), μ, √r ÷ m, each club's move (rounded for the record), and
 * the moved pools, each player's other fields kept.
 */
export function moveSeason({ pools, gaps = {}, games, perPoint, label = '' }) {
  const franchises = Object.keys(pools);
  const srs = srsOf(games);
  const rated = Object.keys(srs.ratings);
  if (rated.length !== franchises.length || franchises.some(f => !(f in srs.ratings))) {
    throw new Error(`${label}: the games rate ${rated.length} clubs, the season has ${franchises.length}`);
  }
  const strengthOf = franchise => pool => playedStrength(squadOf(pool, `${label} ${franchise}`, { gaps: gaps[franchise] ?? {} }).squad);
  const before = Object.fromEntries(franchises.map(f => [f, strengthOf(f)(pools[f])]));
  const level = mean(franchises.map(f => before[f]));
  const { scale, targets } = resultsTargets(srs, { mean: level, perPoint });
  const clubs = {}, moved = {};
  for (const f of franchises) {
    const move = clubMoveOf(pools[f], targets[f], strengthOf(f));
    moved[f] = move.pool;
    clubs[f] = { srs: rounded(srs.ratings[f], 2), target: rounded(targets[f], 2), before: rounded(move.before, 2), after: rounded(move.after, 2),
      shift: move.shift, plus: move.plus };
  }
  return { srs, mean: level, scale, clubs, pools: moved };
}
