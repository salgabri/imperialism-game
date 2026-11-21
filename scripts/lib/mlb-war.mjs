// The seasons no game rated, 1960 to 2017, computed from the players' WAR (docs/design/baseball.md, "Seasons before
// 2018: computed from WAR"). npm run import:mlb-war (scripts/import-mlb-war.mjs) turns the pinned sources into one
// committed snapshot a season (scripts/data/mlb-war-seasons/<year>.json) and the reference of MLB The Show 18 to 24's
// overalls (scripts/data/mlb-war-reference.json); npm run build:mlb-seasons rates each season's players by these rules
// and teams them as every baseball season is teamed (scripts/lib/mlb.mjs); npm run build:mlb-map draws each era's map
// from the same franchise eras (scripts/data/mlb-war-seasons.json). No I/O here.
//
// A player's score is his WAR per playing time over the season and the two before it, weighted toward the latest and
// regressed toward a level below replacement, so that playing time counts. Each role's scores are then put on MLB The
// Show's scale rank for rank: the k-th best score of a season of T clubs takes the overall a player at the same depth
// per club held in MLB The Show 18 to 24. Each club then moves toward its real record (`resultsMove`,
// docs/design/computed-ratings.md, step 5), every player of it by the same whole number and its best few by one more;
// from 1997 the interleague games put both leagues' clubs on one scale (`jointShareOf`).
import { makeRng } from '../../src/data/teams.js';
import { clubMoveOf, mean, perPointOf, resultsTargets, winShareOf } from './computed-ratings.mjs';

/** The data set id of the computed season of `year`: 'mlb-war-1961'. */
export const warSeasonIdOf = year => `mlb-war-${year}`;
/** The season's listing label. */
export const warLabelOf = year => `Computed from WAR, end of ${year}`;
/** The three roles rated apart: hitters, starting pitchers and relievers. */
export const WAR_ROLES = Object.freeze(['H', 'SP', 'RP']);
/** The fielding positions a hitter's games are counted at (the designated hitter is any hitter's). */
export const FIELD_POSITIONS = Object.freeze(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);

/** `value` rounded to `digits` decimals, the one rounding every snapshot number goes through. */
export const roundTo = (value, digits) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * A player-season's score from its snapshot row's inputs: `war` and `use` are the season's and the two before it
 * (latest first; null where he did not play), WAR and plate appearances for a hitter, pitching WAR and innings for a
 * pitcher; `li` a reliever's average leverage. `method` is the manifest's (scripts/data/mlb-war-seasons.json `method`):
 *   score = per × (Σ weight·WAR + prior·rate) / (Σ weight·use + prior) [+ leverage × li for a reliever]
 */
export function warScoreOf({ role, war, use, li }, method) {
  const rule = method.roles[role];
  if (!rule) throw new Error(`No scoring rule for role ${role}`);
  let num = rule.prior * rule.rate, den = rule.prior;
  for (let k = 0; k < rule.weights.length; k++) {
    if (war[k] == null) continue;
    num += rule.weights[k] * war[k];
    den += rule.weights[k] * use[k];
  }
  const score = rule.per * num / den + (rule.leverage ? rule.leverage * (li ?? 1) : 0);
  return roundTo(score, 4);
}

/**
 * Each player's rating, rank for rank within his role: `players` are `{ id, role, score }` of one season of
 * `clubCount` clubs; `reference` holds, by role, the overalls of the calibration seasons' players, strongest first,
 * over `teamSeasons` club-seasons. The k-th best score (0-based) takes the reference value at index
 * (k + 0.5) / clubCount × teamSeasons − 0.5, linearly interpolated and rounded; deeper ranks take the floor. Equal
 * scores share their mean rank, so ties stay ties and nobody passes anybody. → Map id → rating.
 */
export function rateByRank(players, reference, clubCount, teamSeasons) {
  const ratings = new Map();
  for (const role of WAR_ROLES) {
    const ref = reference[role];
    if (!ref?.length) throw new Error(`No reference overalls for role ${role}`);
    const list = players.filter(p => p.role === role).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].score === list[i].score) j++;
      const at = ((i + j) / 2 + 0.5) / clubCount * teamSeasons - 0.5;
      const lo = Math.max(0, Math.min(ref.length - 1, Math.floor(at))), hi = Math.min(ref.length - 1, lo + 1);
      const t = Math.min(1, Math.max(0, at - lo));
      const rating = Math.round(ref[lo] * (1 - t) + ref[hi] * t);
      for (let m = i; m <= j; m++) ratings.set(list[m].id, rating);
      i = j + 1;
    }
  }
  return ratings;
}

/**
 * The clubs of season `year`, `{ franchise, war, id, name, code, city, ballpark, base?, home, park }` in today's
 * franchise order (scripts/data/mlb-teams.json): each franchise with an era of scripts/data/mlb-war-seasons.json
 * (`eras`) covering the year, under its own id, name, code and territory (`city`) where the era names them and today's
 * otherwise. `war` is the Baseball-Reference code the WAR file and the Baseball Databank file the club under, `park` the
 * Databank's key (Retrosheet's park code) of the ballpark it played most of its home games in, `base` the ballpark it
 * grows from when that ballpark was another club's (`home` is then the base's), and `databankName` the name the Databank
 * gives the club where it is not the era's.
 */
export function teamsOfWar(franchises, manifest, year) {
  return Object.entries(franchises).flatMap(([franchise, team]) => {
    const era = (manifest.eras[franchise] || []).find(e => e.from <= year && year <= e.to);
    if (!era) return [];
    return [{ franchise, war: era.war, id: era.id ?? franchise, name: era.name ?? team.name, code: era.code ?? team.code,
      city: era.city ?? team.city, ballpark: era.ballpark, ...(era.base ? { base: era.base } : {}), home: era.home, park: era.park,
      ...(era.databankName ? { databankName: era.databankName } : {}) }];
  });
}

/** The era map the computed season of `year` plays on (scripts/data/mlb-war-seasons.json `maps`). */
export function warMapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No map for the ${year} season`);
  return map.id;
}

/**
 * The game's nation of a birth country of the snapshots (the Baseball Databank's, or a correction's; scripts/data/
 * mlb-war-seasons.json `nations`): a nation id, or null for a
 * country the game has no nation for (and for a player with no birthplace). Throws for a country the manifest does not
 * list, so a new one is never placed silently.
 */
export function nationOfBirthCountry(country, nations) {
  if (country === '') return null;
  if (!Object.hasOwn(nations, country)) throw new Error(`No nation for the birth country ${JSON.stringify(country)}`);
  return nations[country];
}

/** A player's name as the seasons show it: the Databank's first name and surname, then the WAR file's generational suffix. */
export const displayNameOf = ({ first, last, suffix }) => `${first} ${last}${suffix ? ` ${suffix}` : ''}`;

/**
 * Names that tell apart players who share one (`group`: `{ id, first, last, suffix, given, born }`, `given` the Databank's
 * given names, `born` the birth year): the middle initial of each one's given names ("Bob L. Miller") when every one
 * has a second given name and their initials differ, else the birth year ("Pedro Martinez (1971)") when those differ;
 * nothing when neither tells them apart. → Map id → alias.
 */
export function aliasesOf(group) {
  const initials = group.map(p => p.given.split(/\s+/).filter(Boolean)[1]?.[0] ?? null);
  if (initials.every(Boolean) && new Set(initials).size === group.length) {
    return new Map(group.map((p, i) => [p.id, displayNameOf({ ...p, first: `${p.first} ${initials[i]}.` })]));
  }
  const years = group.map(p => p.born);
  if (years.every(Boolean) && new Set(years).size === group.length) return new Map(group.map(p => [p.id, `${displayNameOf(p)} (${p.born})`]));
  return new Map();
}

// ---------- each club's move toward its real record ----------

/** The match variation the engine's per-point measure plays at: the game's balanced setting, as the realism harness plays. */
export const MEASURE_DRAMA = 6;
/** Games played at each of perPointOf's gaps (±2 and ±4 points): the slope comes to within about 1.6%. */
export const MEASURE_GAMES = 40000;

/**
 * What the engine gives a club for a point of strength (src/sports/baseball.js baseballStrength), in win share: the
 * slope perPointOf measures over games between two copies of one of the season's clubs (`clubs`, as buildClub makes
 * them, drawn at random), every player of the first raised and of the second lowered by half the gap, at a neutral
 * venue, the first batting first half the time. `sport` plays the season's rules (baseballOfSeason); `seed` fixes the
 * draw, so the season rebuilds byte for byte.
 */
export function perPointOfSeason(clubs, sport, seed, games = MEASURE_GAMES) {
  const moved = (club, by) => ({ ...club, squad: club.squad.map(player => ({ ...player, rating: player.rating + by })) });
  const prepared = new Map();
  const matchOf = (index, delta, firstBats) => {
    const key = `${index}|${delta}|${firstBats}`;
    if (!prepared.has(key)) {
      const first = moved(clubs[index], delta / 2), second = moved(clubs[index], -delta / 2);
      prepared.set(key, firstBats ? sport.prepareMatch(first, second, undefined, undefined, { home: false })
        : sport.prepareMatch(second, first, undefined, undefined, { home: false }));
    }
    return prepared.get(key);
  };
  const play = (delta, rng) => {
    const index = Math.floor(rng() * clubs.length), firstBats = rng() < 0.5;
    const { ga, gd } = sport.sampleResult(rng, matchOf(index, delta, firstBats), MEASURE_DRAMA);
    return (firstBats ? ga > gd : gd > ga) ? 1 : 0;
  };
  return perPointOf({ play, rng: makeRng(seed), games, base: 0.5 });
}

/**
 * Each club's strength above the season's mean, in win share, when the season's two leagues met in interleague games
 * (docs/design/baseball.md, "One scale for both leagues"). `clubs`: `[{ id, league, w, l }]` of exactly two leagues;
 * `shares`: each club's win share less a half (winShareOf's ratings); `interleague`: `{ league, w, l }`, that league's
 * record against the other in the season's interleague games. Its edge Δ = w ÷ (w + l) − ½ is what the average club of
 * that league won above a half against the average club of the other. A club's own record holds its interleague games
 * too, a share f of its league's games (the interleague games over its league's clubs' games): its share less a half is
 * d × ((1 − f) × n/(n − 1) + f) + f × Δ, d its strength above its league's mean (against the n − 1 others of its league a
 * record measures n/(n − 1) of d, against the other league d + Δ, its league's edge or the other's). Above the season's
 * mean of N clubs a league's mean stands its edge × the other league's clubs ÷ N away, so the clubs still average nought.
 * With no interleague games (f = 0, Δ = 0) this is a league's share × (n − 1)/n. Throws unless the clubs of `league`
 * won as many more games than they lost as its interleague record says: its games inside the league cancel out.
 * → `{ strengths: { club: strength }, edge: Δ, shares: { league: f } }`.
 */
export function jointShareOf(clubs, shares, interleague) {
  const leagues = [...new Set(clubs.map(club => club.league))].sort();
  if (leagues.length !== 2 || !leagues.includes(interleague.league)) throw new Error(`Interleague games need two leagues, ${interleague.league} one of them: ${leagues.join(', ')}`);
  const games = interleague.w + interleague.l;
  if (!(games > 0)) throw new Error('No interleague games');
  const net = clubs.filter(club => club.league === interleague.league).reduce((sum, club) => sum + club.w - club.l, 0);
  if (net !== interleague.w - interleague.l) {
    throw new Error(`The ${interleague.league}'s clubs won ${net} more than they lost, its interleague record ${interleague.w}–${interleague.l} says ${interleague.w - interleague.l}`);
  }
  const edge = interleague.w / games - 0.5;
  const of = Object.fromEntries(leagues.map(league => {
    const own = clubs.filter(club => club.league === league);
    return [league, { n: own.length, f: games / own.reduce((sum, club) => sum + club.w + club.l, 0), edge: league === interleague.league ? edge : -edge }];
  }));
  const total = clubs.length;
  const strengths = Object.fromEntries(clubs.map(club => {
    const { n, f, edge: own } = of[club.league];
    const other = total - n;
    const d = (shares[club.id] - f * own) / ((1 - f) * n / (n - 1) + f);
    return [club.id, d + own * other / total];
  }));
  return { strengths, edge, shares: Object.fromEntries(leagues.map(league => [league, of[league].f])) };
}

/**
 * Each club's move toward its real record (docs/design/computed-ratings.md, step 5). `clubs`: `[{ id, league, w, l,
 * pool }]`, `pool` the club's players best first by `order`. Its results strength is its win share less a half
 * (winShareOf), as strength above its league's mean: a club never plays itself, so among the n clubs of a league that
 * play each other its share measures (n − 1)/n of its gap to them all, as a balanced schedule's Simple Rating System
 * reads its margins. A season whose leagues met (`interleague`, `{ league, w, l }`: that league's record against the
 * other, from 1997) puts both on one scale instead (jointShareOf): each club's strength above the season's mean, its
 * league's edge in those games included. Its target is the season's mean strength before the move plus √reliability ×
 * that ÷ `perPoint` (resultsTargets), and every player of the club moves by one whole number, its best few by one more
 * (clubMoveOf), so that `strengthOf(pool)`, the strength the engine plays, comes nearest it. The best few are those of
 * the lineup the club plays (`lineupOf(pool)`, their ids), best first by `order`, then the rest: a point more for a
 * player on the bench would only move him into that lineup out of his position, a starting pitcher into the bullpen.
 * Nobody passes a teammate. → `{ level, reliability, scale, edge, strengths, moves: [{ id, target, before, after, shift, plus,
 * pool }] }`, `edge` the interleague edge Δ (null without interleague games), `strengths` each club's results strength above
 * the season's mean, in win share.
 */
export function resultsMove(clubs, { perPoint, strengthOf, order, lineupOf, interleague = null }) {
  const level = mean(clubs.map(club => strengthOf(club.pool)));
  const { ratings, reliability } = winShareOf(Object.fromEntries(clubs.map(club => [club.id, { w: club.w, l: club.l }])));
  let above, edge = null;
  if (interleague) {
    ({ strengths: above, edge } = jointShareOf(clubs, ratings, interleague));
  } else {
    const size = new Map();
    for (const club of clubs) size.set(club.league, (size.get(club.league) ?? 0) + 1);
    above = Object.fromEntries(clubs.map(club => [club.id, ratings[club.id] * (size.get(club.league) - 1) / size.get(club.league)]));
  }
  const { scale, targets } = resultsTargets({ ratings: above, reliability }, { mean: level, perPoint });
  const moves = clubs.map(club => {
    const lineup = lineupOf(club.pool);
    const bestFirst = (a, b) => (lineup.has(b.id) ? 1 : 0) - (lineup.has(a.id) ? 1 : 0) || order(a, b);
    return { id: club.id, target: targets[club.id], ...clubMoveOf(club.pool, targets[club.id], strengthOf, { bestFirst }) };
  });
  return { level, reliability, scale, edge, strengths: above, moves };
}
