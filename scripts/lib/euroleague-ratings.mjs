// The EuroLeague's ratings (docs/design/euroleague.md, "The ratings"), by the computed-ratings method
// (docs/design/computed-ratings.md), the same for the built-in season and every earlier one:
// 3. each player's value: his share of his club's minutes and his PIR a minute, over the season and the two before it
//    (weighted 3, 2, 1), the PIR shrunk toward a fringe player's by a prior the seasons measure, the two blended by how
//    stable each is from one season to the next, within his position group (guards, forwards, centres);
// 4. his rating: the season's starters ranked by value within their group and read off NBA 2K27's starters at the same
//    group, `LEVEL` points below them, the level the players both NBA 2K and the EuroLeague rate set; a bench player
//    rates as a starter of his value would;
// 5. for a completed season, each club's five moved toward its results: its Simple Rating System from every game it
//    played, times √reliability, in lineup points by what the engine gives a point at that season's pace.
// No I/O here: scripts/lib/euroleague.mjs (the built-in season) and scripts/lib/euroleague-seasons.mjs (the earlier ones)
// read the snapshots.
import { CLUBS as NBA_CLUBS } from '../../src/data/clubs.basketball.js';
import { basketball } from '../../src/sports/basketball.js';
import { buildClub, hashStr, makeRng, selectLineup } from '../../src/data/teams.js';
import {
  WINDOW, blend, clubMoveOf, mean, pearson, perPointOf, pooled, priorFromReliability, referenceOf, replacementRate,
  resultsTargets, shrunkRate, spearman, srsOf,
} from './computed-ratings.mjs';

/** Position groups: the EuroLeague's own guards, forwards and centres. */
export const GROUPS = Object.freeze(['G', 'F', 'C']);
/** NBA 2K's positions by group, a player's first position deciding. */
const NBA_GROUP = Object.freeze({ PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' });
/** The minutes a club has to give each game: five players for FIBA's forty. */
export const CLUB_MINUTES = 200;

/**
 * The level: EuroLeague ratings sit this many points below NBA 2K27's starters of the same rank. Set by the players on
 * the built-in season's rosters with a EuroLeague game whom NBA 2K24–2K27 also rated (scripts/data/euroleague-anchors.json,
 * from 2K Archive's pinned copy): at this level their EuroLeague ratings average their NBA 2K ratings (`anchorLevel`).
 */
export const LEVEL = 6.1;

/** NBA 2K27's starters (the built-in basketball season's fives, src/data/clubs.basketball.js): each club's ratings at a group. */
export const NBA_FIVES = Object.freeze(Object.fromEntries(GROUPS.map(group => [group,
  NBA_CLUBS.map(club => club.squad.filter(([, listed]) => NBA_GROUP[listed.split('/')[0]] === group).map(([, , rating]) => rating))])));

// ---------- step 1: a player-season ----------

/**
 * A player's season as the ratings read it: `{ club, group, games, minutes, pir, clubGames }`, minutes and PIR his
 * season's totals (PIR on the reference season's level, × `pirScale`), `clubGames` the games his club played. `line` is
 * the snapshot's per-game line, [games, minutes, points, rebounds, assists, three-point attempts, PIR].
 */
export function recordOf({ club, group, line, clubGames, pirScale = 1 }) {
  if (!line?.[0]) return null;
  const [games, minutes, , , , , pir] = line;
  return { club, group, games, minutes: games * minutes, pir: games * pir * pirScale, clubGames };
}

/** Whether a record is at least a quarter of its club's season: the regulars that priors and reliabilities are read on. */
const regular = record => record && record.minutes > 0 && record.games * 4 >= record.clubGames;
const selectionOf = record => record.minutes / (record.clubGames * CLUB_MINUTES);
const productionOf = record => record.pir / record.minutes;

// ---------- step 3: each player's value ----------

/**
 * What every season shares, measured on every pair of consecutive complete seasons (`seasons`: one `Map code → record`
 * each, oldest first), group by group, among the players with a quarter of their club's games in both (grouped by the
 * later season's position):
 * - `selection` and `production`: the year-to-year stability (Spearman) of the minutes share and of PIR a minute, the
 *   mean of each pair of seasons' figure weighted by its players; each signal's weight in the blend (`stabilityWeight`);
 * - `k`: the prior, in minutes, that shrinks PIR a minute toward the fringe's, n̄(1 − r)/r from its reliability r (the
 *   pairs' Pearson correlation, likewise averaged) at the typical regular's minutes a season n̄.
 * Measured once over the league's history rather than season by season: one season's thirty centres put a weight
 * anywhere from 0.14 to 0.87. A group no season has is left out. → `{ G: { selection, production, k, typical,
 * reliability, pairs }, … }`.
 */
export function leagueConstants(seasons) {
  const out = {};
  for (const group of GROUPS) {
    if (!seasons.some(season => [...season.values()].some(record => record?.group === group))) continue;
    let pairs = 0, selection = 0, production = 0, reliability = 0, minutes = 0, seasonsOf = 0;
    for (let s = 1; s < seasons.length; s++) {
      const before = seasons[s - 1], latest = seasons[s];
      const both = [...latest].filter(([code, record]) => record.group === group && regular(record) && regular(before.get(code)))
        .map(([code, record]) => [before.get(code), record]);
      if (both.length < 3) continue;
      const n = both.length;
      pairs += n;
      selection += n * spearman(both.map(([a]) => selectionOf(a)), both.map(([, b]) => selectionOf(b)));
      production += n * spearman(both.map(([a]) => productionOf(a)), both.map(([, b]) => productionOf(b)));
      reliability += n * pearson(both.map(([a]) => productionOf(a)), both.map(([, b]) => productionOf(b)));
      minutes += both.reduce((sum, [a, b]) => sum + a.minutes + b.minutes, 0);
      seasonsOf += 2 * n;
    }
    if (!pairs) throw new Error(`No ${group} played a quarter of two seasons running`);
    const typical = minutes / seasonsOf;
    out[group] = { selection: selection / pairs, production: production / pairs, reliability: reliability / pairs, typical,
      k: priorFromReliability(reliability / pairs, typical), pairs };
  }
  return out;
}

/**
 * Each player's value in a season, group by group: `players` are `{ code, group, window }`, `window` his records of the
 * season, the one before and the one before that (null where he played no EuroLeague game). Within the group:
 * - selection, his minutes over his clubs' over the window, each season weighted 3, 2, 1 (a season he did not play adds
 *   nothing, so a newcomer is not marked down for the years he was elsewhere; 0 with no game at all);
 * - production, his PIR over his minutes likewise pooled, shrunk toward the fringe's (the pooled rate of the quarter of
 *   the group with the fewest minutes this season) by the prior `constants[group].k`;
 * - value, the two as z-scores weighted by their stability (`blend`).
 * → `{ values: Map code → { selection, production, value }, groups: { G: { replacement, weights }, … } }`.
 */
export function valuesOf(players, constants) {
  const values = new Map(), groups = {};
  for (const group of GROUPS) {
    const members = players.filter(player => player.group === group);
    if (!members.length) continue;
    const exposure = members.map(player => pooled(player.window.map(r => r && { exposure: r.minutes, events: r.pir }), WINDOW));
    const share = members.map(player => pooled(player.window.map(r => r && { exposure: r.clubGames * CLUB_MINUTES, events: r.minutes }), WINDOW));
    const replacement = replacementRate(exposure);
    const { k, selection: selectionStability, production: productionStability } = constants[group];
    const selection = share.map(({ n, x }) => (n > 0 ? x / n : 0));
    const production = exposure.map(record => shrunkRate(record, k, replacement));
    const { values: blended, weights } = blend([{ values: selection, reliability: selectionStability }, { values: production, reliability: productionStability }]);
    members.forEach((player, i) => values.set(player.code, { selection: selection[i], production: production[i], value: blended[i] }));
    groups[group] = { replacement, weights };
  }
  return { values, groups };
}

// ---------- step 4: from value to rating ----------

/** Where a value at quantile `p` (0–1) reads off `reference` (ascending): ratingsOf's interpolation, unrounded. */
function readOff(reference, p) {
  const h = Math.min(Math.max(p * reference.length - 0.5, 0), reference.length - 1);
  const lo = Math.floor(h), hi = Math.ceil(h);
  return reference[lo] + (reference[hi] - reference[lo]) * (h - lo);
}

/**
 * A group's ratings as a function of value: the starters' `values`, ranked (mid-rank, ties sharing one), read off
 * `reference` (ascending, unrounded, as computed-ratings.mjs's ratingsOf); a value between two starters' interpolated
 * between their ratings; one beyond the starters' range continued along the least-squares line of rating on value
 * through them. Unrounded: → value => rating.
 */
export function curveOf(values, reference) {
  if (!values.length || !reference.length) throw new Error('A curve needs starters and a reference');
  const sorted = [...values].sort((a, b) => a - b);
  const points = [], at = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j++;
    const rating = readOff(reference, ((i + j) / 2 + 0.5) / sorted.length);
    points.push([sorted[i], rating]);
    for (let k = i; k <= j; k++) at.push(rating);
    i = j + 1;
  }
  const mx = mean(sorted), my = mean(at);
  let sxy = 0, sxx = 0;
  sorted.forEach((v, i) => { sxy += (v - mx) * (at[i] - my); sxx += (v - mx) ** 2; });
  const slope = sxx > 0 ? Math.max(0, sxy / sxx) : 0;
  const [first, last] = [points[0], points.at(-1)];
  return value => {
    if (value <= first[0]) return first[1] - slope * (first[0] - value);
    if (value >= last[0]) return last[1] + slope * (value - last[0]);
    let hi = 1;
    while (points[hi][0] < value) hi++;
    const [x0, y0] = points[hi - 1], [x1, y1] = points[hi];
    return y0 + (y1 - y0) * (value - x0) / (x1 - x0);
  };
}

/** A rating as the game holds it: rounded, 1 to 99. */
export const wholeRating = value => Math.min(99, Math.max(1, Math.round(value)));

/** A pool's best five: the strongest lineup its players' positions allow, strongest first (as the NBA clubs'). */
export function startingFive(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return selectLineup({ sport: 'basketball', squad: byRating }).starters
    .map(starter => byRating[starter.originalIndex])
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

/** The provisional ratings the first fives are picked by: values on a rating-like scale (a z-score as 5 points). */
const provisional = value => 76 + 5 * value;
/** Rounds of picking the fives at most: they settle, or start to cycle, within a handful. */
const ROUNDS = 50;

/**
 * A season's ratings and fives: `players` are `{ code, club, group, positions, name, value }`, `clubs` the season's club
 * codes. Each club's five is picked by rating (`startingFive`); each group's starters, ranked by value, read their
 * ratings off NBA 2K27's starters at the group (each NBA club's best `quota`, the season's starters a club at the group),
 * `level` points lower; everyone else rates on the same curve. The fives are picked again by those ratings until they
 * settle, or until a set of fives comes round again: two teammates a point apart can take the last place in turn, as
 * each one's starting moves the curve under them both. Then the fives are the set that came round again, and the
 * ratings its own. → `{ ratings: Map code → whole rating, exact: Map code → unrounded, fives: Map club → [player +
 * rating], strongest first }`.
 */
export function rateSeason(players, clubs, { level = LEVEL } = {}) {
  const pick = ratings => new Map(clubs.map(club => [club, startingFive(players.filter(player => player.club === club)
    .map(player => ({ ...player, rating: ratings.get(player.code), pos: player.positions[0] })))]));
  const rate = fives => {
    const exact = new Map();
    for (const group of GROUPS) {
      const starters = [...fives.values()].flat().filter(player => player.group === group);
      const members = players.filter(player => player.group === group);
      if (!members.length) continue;
      if (!starters.length) throw new Error(`No ${group} starts for any club`);
      const reference = referenceOf(NBA_FIVES[group], starters.length / clubs.length).map(rating => rating - level);
      const curve = curveOf(starters.map(player => player.value), reference);
      for (const player of members) exact.set(player.code, curve(player.value));
    }
    return exact;
  };
  let ratings = new Map(players.map(player => [player.code, provisional(player.value)]));
  let fives, exact;
  const seen = new Set();
  for (let round = 0; ; round++) {
    fives = pick(ratings);
    const key = clubs.map(club => fives.get(club).map(player => player.code).sort().join()).join('|');
    exact = rate(fives);
    if (seen.has(key) || round === ROUNDS) break;
    seen.add(key);
    ratings = new Map([...exact].map(([code, value]) => [code, wholeRating(value)]));
  }
  ratings = new Map([...exact].map(([code, value]) => [code, wholeRating(value)]));
  // Each five carries its players' ratings, strongest first.
  fives = new Map([...fives].map(([club, five]) => [club, five.map(player => ({ ...player, rating: ratings.get(player.code) }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))]));
  return { ratings, exact, fives };
}

/** The NBA 2K editions whose ratings set the level: NBA 2K24 to NBA 2K27, by 2K Archive's year. */
export const ANCHOR_EDITIONS = Object.freeze([2024, 2025, 2026, 2027]);
/** Names a EuroLeague player shares with another player NBA 2K rates: no anchor. */
export const NAMESAKES = Object.freeze({
  'Devin Booker': "NBA 2K's is the Phoenix Suns' guard (90 to 94 in NBA 2K24–2K27); Olimpia Milano's is a centre",
});
/** A name with no accents, case, punctuation or suffix (Jr., II…): two spellings of one player's name compare equal. */
export const foldName = name => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();

/**
 * The anchors: the built-in season's players with a EuroLeague game in the window (`played`) whose name an NBA 2K edition
 * of ANCHOR_EDITIONS also rates, each at the latest such edition's rating, a namesake (`namesakes`) left out. `players`:
 * `[{ code, name, played }]`; `editions`: 2K Archive's ratings by year, `{ 2027: [{ n: name, o: overall }], … }`
 * (scripts/lib/nba-seasons.mjs readArchive's `years`). → `[{ code, name, edition, nba2k }]`, in the players' order.
 */
export function anchorsOf(players, editions, namesakes = NAMESAKES) {
  const latest = new Map();
  for (const year of ANCHOR_EDITIONS) {
    for (const row of editions[year] ?? []) latest.set(foldName(row.n), { edition: year, nba2k: row.o });
  }
  return players.filter(player => player.played && !Object.hasOwn(namesakes, player.name) && latest.has(foldName(player.name)))
    .map(player => ({ code: player.code, name: player.name, ...latest.get(foldName(player.name)) }));
}

/**
 * The level the anchors set: the shift that brings the mean of their ratings, as rated `exact` (unshifted: rated with
 * level 0), to the mean of their NBA 2K ratings. `anchors`: `[{ code, nba2k }]`. → `{ level, players, nba2k, euroleague }`.
 */
export function anchorLevel(anchors, exact) {
  const rated = anchors.filter(anchor => exact.has(anchor.code));
  if (rated.length !== anchors.length) throw new Error(`${anchors.length - rated.length} anchors are not rated this season`);
  const nba2k = mean(rated.map(anchor => anchor.nba2k)), euroleague = mean(rated.map(anchor => exact.get(anchor.code)));
  return { level: euroleague - nba2k, players: rated.length, nba2k, euroleague };
}

// ---------- step 5: each club's move toward its results ----------

/**
 * A season's games as srsOf reads them, from the snapshot's `games` ([phase, local club, road club, local score, road
 * score, venue, neutral?]): a club's arena is the venue of most of its regular-season home games. A game at the road
 * club's arena is its home game (Virtus Bologna's 2002 Final Four at home, as the road side); a Final Four game at
 * neither club's arena, or one the API marks neutral, is at a neutral venue; any other is the local club's home game.
 */
export function seasonGames(rows) {
  const venues = new Map();
  for (const [phase, local, , , , venue] of rows) {
    if (phase !== 'RS' || !venue) continue;
    if (!venues.has(local)) venues.set(local, new Map());
    venues.get(local).set(venue, (venues.get(local).get(venue) ?? 0) + 1);
  }
  const arena = new Map([...venues].map(([club, counts]) => [club, [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]));
  return rows.map(([phase, local, road, localScore, roadScore, venue, neutral]) => {
    if (venue && arena.get(road) === venue && arena.get(local) !== venue) return { home: road, away: local, homeScore: roadScore, awayScore: localScore, phase, neutral: false };
    return { home: local, away: road, homeScore: localScore, awayScore: roadScore, phase,
      neutral: neutral === 1 || (phase === 'FF' && arena.get(local) !== venue) };
  });
}

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const teamOf = (pool, id = 'side') => buildClub({ id, squad: pool.map(player => [player.name ?? player.code, player.positions.join('/'), player.rating]) }, basketball);
const evenFive = rating => POSITIONS.map(position => ({ name: position, positions: [position], rating }));
// The margin a possession a five gives against an even five of 75 under FIBA's rules, and what one point of every
// player's rating adds to it: the strength the match model plays, in lineup points.
const BASE = teamOf(evenFive(75), 'base');
const edgeOf = team => { const prepared = basketball.prepareMatch(team, BASE); return prepared.efficiencyA - prepared.efficiencyD; };
const EDGE_PER_POINT = edgeOf(teamOf(evenFive(76))) - edgeOf(BASE);

/**
 * The strength the engine plays a five at, in lineup points: its edge a possession over an even five of 75 (offence
 * weighted to the guards, defence to the bigs, as src/sports/basketball.js prepareMatch weighs them), over what a point of
 * every player's rating adds. A five of 80s is 80; a point more for its point guard adds 0.21, for its centre 0.20.
 */
export const engineStrength = five => 75 + edgeOf(teamOf(five)) / EDGE_PER_POINT;

/**
 * What the engine gives for a point of lineup strength in `sport` (a season's EuroLeague rules): the mean margin, in
 * points a game, of a five whose players are each `delta` points better than an even five's, by perPointOf over 4,000
 * games a gap at a neutral venue. Each game is played twice on the same random draws, at the gap and between even fives,
 * and counts the difference: the shooting luck the two share cancels, so the slope is measured to about 0.3% where
 * games played once leave it ±2.4%. Seeded by `seed`, so it is the same at every build.
 */
export function perPointIn(sport, seed) {
  const prepared = new Map();
  const matchup = delta => {
    if (!prepared.has(delta)) prepared.set(delta, sport.prepareMatch(teamOf(evenFive(75 + delta), 'a'), teamOf(evenFive(75), 'd')));
    return prepared.get(delta);
  };
  const margin = (delta, draws) => { const result = sport.sampleResult(makeRng(draws), matchup(delta)); return result.ga - result.gd; };
  const play = (delta, rng) => {
    const draws = Math.floor(rng() * 2 ** 32);
    return margin(delta, draws) - margin(0, draws);
  };
  return perPointOf({ play, rng: makeRng(hashStr(seed)), games: 4000 });
}

/**
 * Each club moved toward its results (docs/design/computed-ratings.md, step 5): its target T = μ + √r × S ÷ m, S its
 * SRS from the season's games, r their reliability, m what `sport` gives for a lineup point (perPointIn) and μ the
 * clubs' mean engine strength before the move; its five moved by a whole number, plus one more for its best few, to the
 * strength nearest the target (clubMoveOf), no player passing one rated above him. `clubs`: `[{ code, five }]`, each five
 * `[{ name, positions, rating, … }]`. → `{ srs, perPoint, mean, scale, clubs: [{ code, results, target, shift, plus,
 * before, after, five }] }`.
 */
export function moveToResults(clubs, games, sport, seed) {
  const srs = srsOf(games);
  const perPoint = perPointIn(sport, seed);
  const level = mean(clubs.map(club => engineStrength(club.five)));
  const { scale, targets } = resultsTargets(srs, { mean: level, perPoint });
  return {
    srs, perPoint, mean: level, scale,
    clubs: clubs.map(club => {
      if (!(club.code in targets)) throw new Error(`${club.code} played no game`);
      const move = clubMoveOf(club.five, targets[club.code], engineStrength);
      return { code: club.code, results: srs.ratings[club.code], target: targets[club.code], shift: move.shift, plus: move.plus,
        before: move.before, after: move.after, five: move.pool };
    }),
  };
}

/** The window's weights, as the doc numbers them: the season itself 3, the one before 2, the one before that 1. */
export { WINDOW };
