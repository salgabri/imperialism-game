// Ice hockey's seasons no EA edition rates in full (docs/design/hockey.md, "Computed seasons" and "NHL 08 and NHL 09"):
// the rule that computes a rating from a player's season statistics, and the rule that converts an edition's attributes
// into an overall. No I/O here: scripts/sync-nhl-seasons.mjs writes each season's statistics into its snapshot, and
// scripts/build-nhl-seasons.mjs builds the season from it with these functions.
//
// COMPUTED (since 2026-11-18, docs/design/computed-ratings.md steps 3 and 5; `BLEND`, `seasonValues`). A player's value
// blends how much his coaches played him (selection) with what he produced (production), over the season itself and the
// two before, weighted 3:2:1 (2004/05 was cancelled and is skipped):
// - selection: his share of the club's ice time a game where the source keeps it (MoneyPuck), else of its games; a
//   goalie's, of its minutes; over the seasons of the window he played;
// - production: points a game (skaters), saves above the league's save percentage a shot or, before shots against were
//   kept for the whole window, goals against under the league's an hour (goalies), shrunk toward the season's replacement
//   level by a prior measured from the season's own players;
// - the two as z-scores over the season's regulars, weighted by `BLEND.production`, tuned once on the five EA editions.
// The values are then ranked within each group (forwards, defenders, goalies) and read off NHL 27's squads in that group,
// and each club is moved toward its real results (scripts/lib/nhl-reconcile.mjs).
//
// SUPERSEDED. The rule of 2026-11-09 (`RULE`, `scoreOf`, `skaterValue`, `goalieValue`): a hand-weighted mean of points a
// game, minutes a game and save percentage over the seasons weighted 1:2:1. Kept because scripts/computed-ratings-backtest.mjs
// compares the strategy with it, and the audit's calibration shows it beside the blend.
//
// CONVERTED. An edition that publishes attributes but no overall (NHL 08, NHL 09) scores each player by the plain mean
// of his skill attributes, ranks the scores within each group and reads them off NHL 07's EA overalls in that group.
import { NOISE, WINDOW, mean, priorFromNoise, replacementRate, shrunkRate, srsOf, variance } from './computed-ratings.mjs';

/** The superseded rule's constants (the rule of 2026-11-09, docs/design/hockey.md "Computed seasons" until 2026-11-18). */
export const RULE = Object.freeze({
  // The season itself, the season before and the one before that.
  weights: Object.freeze([1, 2, 1]),
  // A replacement skater's line, added to each: ten games at 0.1 points and 9 minutes a game.
  prior: Object.freeze({ games: 10, points: 0.1, minutes: 9 }),
  // What a point a game is worth: forwards are there to score, defenders much less (the built-in season's estimate rule).
  pointWeight: Object.freeze({ F: 8, D: 5 }),
  // A replacement goalie: 600 shots at 12 points under the league's save percentage; a full season's work is worth 6.
  goalie: Object.freeze({ shots: 600, below: 0.012, workload: 6 }),
  // Before shots against were kept: 20 games at 0.36 goals a game over the league, a goal a game worth 1000/30.
  goals: Object.freeze({ minutes: 1200, above: 0.36, shotsPer60: 30 }),
  // The seasons that were not played, by the year they would have ended.
  cancelled: Object.freeze([2005]),
});

/** The forward, defender or goalie group of a position. */
export const groupOf = pos => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');

/** The season before the one ending in `year` that was played (2003/04 comes before 2005/06). */
export function seasonBefore(year) {
  let before = year - 1;
  while (RULE.cancelled.includes(before)) before--;
  return before;
}

/** The three seasons a season's score looks at, newest first: [year, the one before, the one before that]. */
export const windowOf = year => [year, seasonBefore(year), seasonBefore(seasonBefore(year))];

/**
 * The window an EA edition of the season ending in `year` is compared with: the season before's. An edition comes out
 * before its season is played, so its ratings are what the seasons before it showed (NHL 22, out in October 2021, against
 * 2020/21, 2019/20 and 2018/19).
 */
export const lagWindowOf = year => windowOf(seasonBefore(year));

/**
 * A skater's value for one season's line `[season, games, points, seconds]` (seconds on the ice, or null where the
 * source keeps no time on ice): `pointWeight` × points a game, plus minutes a game when `minutes` is set, both from the
 * line plus a replacement player's ten games.
 */
export function skaterValue([, games, points, seconds], group, minutes) {
  const played = games + RULE.prior.games;
  const perGame = (points + RULE.prior.games * RULE.prior.points) / played;
  const value = RULE.pointWeight[group] * perGame;
  if (!minutes) return value;
  if (seconds == null) throw new Error('A minutes-a-game season needs every line\'s time on ice');
  return (seconds / 60 + RULE.prior.games * RULE.prior.minutes) / played + value;
}

/**
 * A goalie's value for one season's line `[season, games, seconds, goalsAgainst, shotsAgainst]` against that season's
 * league `{ savePct, gaa, maxGames }`: by save percentage (`form` 'saves') or, before shots against were kept, by goals
 * against a game ('goals'); plus his share of the season's games.
 */
export function goalieValue([, games, seconds, goals, shots], league, form) {
  const workload = RULE.goalie.workload * Math.min(1, games / league.maxGames);
  if (form === 'saves') {
    if (shots == null || league.savePct == null) throw new Error('A save-percentage season needs shots against');
    const prior = RULE.goalie.shots;
    const savePct = (shots - goals + prior * (league.savePct - RULE.goalie.below)) / (shots + prior);
    return 1000 * (savePct - league.savePct) + workload;
  }
  const hours = seconds / 3600, priorHours = RULE.goals.minutes / 60;
  const against = (goals + priorHours * (league.gaa + RULE.goals.above)) / (hours + priorHours);
  return 1000 * (league.gaa - against) / RULE.goals.shotsPer60 + workload;
}

/**
 * A player's score in the season ending in `year`: the weighted mean (RULE.weights) of his lines' values over the seasons
 * of its window he played. `lines` are his lines, any order; `leagues` the window's league figures by season; `form`
 * `{ skaters: 'minutes'|'points', goalies: 'saves'|'goals' }`. Null for a player with no line in the window.
 */
export function scoreOf({ pos, lines }, year, leagues, form) {
  const group = groupOf(pos);
  let sum = 0, weight = 0;
  windowOf(year).forEach((season, k) => {
    const line = lines.find(l => l[0] === season);
    if (!line) return;
    const value = group === 'G' ? goalieValue(line, leagues[season], form.goalies) : skaterValue(line, group, form.skaters === 'minutes');
    sum += RULE.weights[k] * value;
    weight += RULE.weights[k];
  });
  return weight ? sum / weight : null;
}

/**
 * The club a player's season counts for: the one he played the most games for, a tie going to the later one. `stints`
 * are `[code, games]` in the order he played for them.
 */
export function clubOfStints(stints) {
  let best = null;
  for (const [code, games] of stints) if (!best || games >= best[1]) best = [code, games];
  return best?.[0] ?? null;
}

/**
 * Each value's rating in `reference` (ratings, any order) by its mid-rank among `values` (the mean of the first and last
 * places it holds in their ascending order, as a share of the whole), as scripts/lib/nhl-seasons.mjs quantileRescale
 * does: ties stay ties and nobody passes anybody. Returns a Map value → rating.
 */
export function midRankRatings(values, reference) {
  const sorted = values.slice().sort((a, b) => a - b);
  const target = reference.slice().sort((a, b) => a - b);
  const rating = new Map();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j++;
    const share = sorted.length > 1 ? (i + j) / 2 / (sorted.length - 1) : 0.5;
    rating.set(sorted[i], target[Math.round(share * (target.length - 1))]);
    i = j + 1;
  }
  return rating;
}

/**
 * Ratings by group: every player of `players` (each with `pos` and the numeric `key`) rated by his key's mid-rank among
 * his group's, read off `histograms[group]` ({ rating: count }). Returns a Map player → rating.
 */
export function groupRatings(players, key, histograms) {
  const out = new Map();
  for (const group of ['F', 'D', 'G']) {
    const members = players.filter(p => groupOf(p.pos) === group);
    if (!members.length) continue;
    const ratings = midRankRatings(members.map(p => p[key]), ratingsOfHistogram(histograms[group]));
    for (const p of members) out.set(p, ratings.get(p[key]));
  }
  return out;
}

/** A histogram `{ rating: count }` as its ratings, ascending. */
export const ratingsOfHistogram = histogram => Object.entries(histogram)
  .flatMap(([rating, count]) => Array(count).fill(Number(rating))).sort((a, b) => a - b);

/** A list of ratings as a histogram `{ rating: count }`, keys ascending. */
export function histogramOf(ratings) {
  const counts = {};
  for (const r of ratings.slice().sort((a, b) => a - b)) counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}

/**
 * The rating of a player outside every club's squad (a nation's depth): the rating of the highest squad score in his group
 * not above his, else his group's lowest squad rating. `squad` is the season's squad players `{ pos, score, rating }`.
 */
export function stepRating(player, squad) {
  const group = groupOf(player.pos);
  const mine = squad.filter(p => groupOf(p.pos) === group);
  let best = null;
  for (const p of mine) if (p.score <= player.score && (!best || p.score > best.score || (p.score === best.score && p.rating > best.rating))) best = p;
  return best ? best.rating : Math.min(...mine.map(p => p.rating));
}

// ---------- the computed rule: each player's value (docs/design/computed-ratings.md, step 3) ----------

/**
 * The computed rule's constants; every season's source.conversion states them. `production`: production's share of a
 * player's value, selection's the rest, by group and by the selection or production the source keeps (ice time where
 * MoneyPuck keeps it, else games; save percentage once every season of the window kept shots against, else goals against).
 * Tuned once against the five EA editions, each against the window of the season before its own (the seasons its makers
 * saw: `lagWindowOf`), on a grid of 0.05, and frozen: forwards and defencemen by games and goalies by saves on all five
 * (left out in turn, every edition chose within 0.05 of these; held out, they agree at 0.898, 0.858 and 0.825); goalies by
 * goals against on the four the Hockey Databank covers (one, left out, chose 0.3; held out, 0.831); by ice time on NHL 22,
 * the one edition MoneyPuck covers (0.945 and 0.905), within 0.01 of the best on NHL 27's top 300 against 2025/26 and the
 * two seasons before.
 */
export const BLEND = Object.freeze({
  weights: WINDOW,
  production: Object.freeze({
    F: Object.freeze({ games: 0.85, ice: 0.8 }),
    D: Object.freeze({ games: 0.75, ice: 0.65 }),
    G: Object.freeze({ saves: 0.5, goals: 0.4 }),
  }),
});

/**
 * One line's contribution to a player's window: `{ exposure, events, share }` for a skater's line `[season, games,
 * points, seconds]` or a goalie's `[season, games, seconds, goals against, shots against]` against that season's league
 * `{ savePct, gaa, maxGames }`. `form`: `{ skaters: 'minutes'|'points', goalies: 'saves'|'goals' }`. Skaters: points over
 * games, the share his ice time a game where kept ('minutes'), else his games, of the club's games. Goalies: saves above
 * the league's save percentage over shots ('saves'), or goals against under the league's rate over hours ('goals'), the
 * share his minutes of the club's.
 */
export function lineFacts(line, group, league, form) {
  if (group === 'G') {
    const [, , seconds, goals, shots] = line;
    const hours = seconds / 3600;
    const share = hours / league.maxGames;
    if (form.goalies === 'saves') {
      if (shots == null || league.savePct == null) throw new Error('A save-percentage season needs shots against');
      return { exposure: shots, events: shots - goals - shots * league.savePct, share };
    }
    return { exposure: hours, events: league.gaa * hours - goals, share };
  }
  const [, games, points, seconds] = line;
  if (form.skaters === 'minutes' && seconds == null) throw new Error('A minutes-a-game season needs every line\'s time on ice');
  return { exposure: games, events: points, share: (form.skaters === 'minutes' ? seconds / 60 : games) / league.maxGames };
}

/**
 * Every player's value in the season ending in `year` (docs/design/computed-ratings.md, step 3), by group. `players`:
 * `[{ pos, lines }]` (lines outside the window are ignored; a player needs one inside it); `leagues`: the window's league
 * figures by season; `form` as lineFacts. For each group:
 * - the window, weighted 3:2:1 (BLEND.weights), pooled: Σ w·events over Σ w·exposure;
 * - the regulars: players with a quarter of the window's games (Σ w·games ≥ Σ w·most games ÷ 4);
 * - replacement level r₀: the pooled rate of the quarter of the group with the least exposure (replacementRate);
 * - the prior k: noise per unit of exposure over the talent variance among the regulars (priorFromNoise), on each record's
 *   effective exposure (Σ w·e)² ÷ Σ w²·e, the exposure whose plain rate is as noisy as the weighted one;
 * - production: the rate shrunk toward r₀ by k on that effective exposure (shrunkRate);
 * - selection: the share (lineFacts) over the seasons of the window he played, weighted;
 * - value: (1 − p)·z(selection) + p·z(production), p = BLEND.production, each z-score by the regulars' mean and spread.
 * Noise per unit of exposure: Poisson at the rate for points, binomial at the window's league save percentage for saves,
 * Poisson at its goals against an hour for goals. `production` stands in for BLEND.production (the tuning measures other
 * weights with it). → `{ values: Map player → value, groups: { F, D, G: { players, regulars, prior, replacement,
 * production } } }`.
 */
export function seasonValues(players, year, leagues, form, production = BLEND.production) {
  const window = windowOf(year);
  const weights = BLEND.weights;
  const values = new Map(), groups = {};
  for (const group of ['F', 'D', 'G']) {
    const members = players.filter(p => groupOf(p.pos) === group);
    if (!members.length) continue;
    const quarter = window.reduce((sum, season, k) => sum + weights[k] * leagues[season].maxGames, 0) / 4;
    const rows = members.map(p => {
      let n = 0, x = 0, squares = 0, games = 0, share = 0, played = 0;
      window.forEach((season, k) => {
        const line = p.lines.find(l => l[0] === season);
        if (!line) return;
        const w = weights[k];
        const facts = lineFacts(line, group, leagues[season], form);
        n += w * facts.exposure;
        x += w * facts.events;
        squares += w * w * facts.exposure;
        games += w * line[1];
        share += w * facts.share;
        played += w;
      });
      if (!played) throw new Error(`A ${group} without a line in ${window.join(', ')}`);
      const effective = squares > 0 ? n * n / squares : 0;
      return { player: p, n, x, effective, regular: games >= quarter, selection: share / played };
    });
    const unit = group !== 'G' ? NOISE.poisson
      : form.goalies === 'saves' ? (sv => () => sv * (1 - sv))(mean(window.map(season => leagues[season].savePct)))
        : (gaa => () => gaa)(mean(window.map(season => leagues[season].gaa)));
    // A record on its effective exposure: the same rate, its noise counted as the weighted seasons' is.
    const record = r => ({ n: r.effective, x: r.n > 0 ? r.x / r.n * r.effective : 0 });
    const regulars = rows.filter(r => r.regular && r.effective > 0);
    const { k } = priorFromNoise(regulars.map(record), { least: 0, unitNoise: unit });
    const replacement = replacementRate(rows.map(r => ({ n: r.n, x: r.x })));
    for (const r of rows) r.production = shrunkRate(record(r), k, replacement);
    const scale = key => {
      const list = regulars.map(r => r[key]), m = mean(list), sd = Math.sqrt(variance(list));
      if (!(sd > 0)) throw new Error(`The ${group} regulars of ${year} do not differ in ${key}`);
      return value => (value - m) / sd;
    };
    const zSelection = scale('selection'), zProduction = scale('production');
    const p = production[group][group === 'G' ? form.goalies : form.skaters === 'minutes' ? 'ice' : 'games'];
    for (const r of rows) values.set(r.player, (1 - p) * zSelection(r.selection) + p * zProduction(r.production));
    groups[group] = { players: rows.length, regulars: regulars.length, prior: k, replacement, production: p };
  }
  return { values, groups };
}

// ---------- the computed rule: each club's real results (docs/design/computed-ratings.md, step 5) ----------

/**
 * Results strength from records alone, where a season's scores are lost: each club's goal differential a game, a
 * shoot-out's goal left out, times (n − 1) ÷ n, since a club meets the other n − 1 and never itself (with ratings
 * summing to zero, a club's expected differential against the rest is n ÷ (n − 1) times its rating). Its reliability:
 * 1 − the mean Poisson noise of a differential a game ((goals for + against) ÷ games²) over the differentials' variance,
 * at least 0. `records`: `[{ club, games, goalsFor, goalsAgainst }]`; `opponents`: n − 1, the clubs a club meets (default:
 * all the others). → `{ ratings: { club: goals a game }, reliability }`, as srsOf's.
 */
export function goalDifferentialOf(records, opponents = records.length - 1) {
  if (records.some(r => !(r.games > 0))) throw new Error('Every club needs a game');
  const differential = records.map(r => (r.goalsFor - r.goalsAgainst) / r.games);
  const centre = mean(differential);
  const factor = opponents / (opponents + 1);
  const noise = mean(records.map(r => (r.goalsFor + r.goalsAgainst) / r.games ** 2));
  const spread = variance(differential);
  return {
    ratings: Object.fromEntries(records.map((r, i) => [r.club, (differential[i] - centre) * factor])),
    reliability: spread > 0 ? Math.max(0, 1 - noise / spread) : 0,
  };
}

/** Whether `games` (`{ home, away }`) join every club into one schedule, so that srsOf can rate them on one scale. */
function connected(games) {
  const links = new Map();
  for (const { home, away } of games) {
    for (const [a, b] of [[home, away], [away, home]]) links.set(a, [...(links.get(a) ?? []), b]);
  }
  const start = links.keys().next().value, seen = new Set([start]), queue = [start];
  while (queue.length) for (const next of links.get(queue.shift())) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen.size === links.size;
}

/**
 * A computed season's results strength S (docs/design/computed-ratings.md, step 5.1) from its snapshot's `results`: the
 * Simple Rating System of every game's score where MoneyPuck keeps them (srsOf, with a home edge), else each club's goal
 * differential a game (goalDifferentialOf): the Hockey Databank's records, a shoot-out's goal taken off both sides, or the
 * games' totals where they do not join every club (2020/21's four divisions met only within themselves: each club met its
 * division's others). → `{ kind: 'srs'|'goals', ratings, reliability, homeEdge?, sigma?, games }`.
 */
export function resultsStrengthOf(results) {
  if (results.games) {
    const games = results.games.map(([, home, away, homeScore, awayScore]) => ({ home, away, homeScore, awayScore }));
    if (connected(games)) {
      const { ratings, reliability, homeEdge, sigma } = srsOf(games);
      return { kind: 'srs', ratings, reliability, homeEdge, sigma, games: games.length };
    }
    const totals = new Map(), opponents = new Map();
    for (const { home, away, homeScore, awayScore } of games) {
      for (const [club, other, scored, conceded] of [[home, away, homeScore, awayScore], [away, home, awayScore, homeScore]]) {
        const t = totals.get(club) ?? { club, games: 0, goalsFor: 0, goalsAgainst: 0 };
        t.games++; t.goalsFor += scored; t.goalsAgainst += conceded;
        totals.set(club, t);
        opponents.set(club, (opponents.get(club) ?? new Set()).add(other));
      }
    }
    const met = mean([...opponents.values()].map(set => set.size));
    return { kind: 'goals', ...goalDifferentialOf([...totals.values()], met), games: games.length };
  }
  const records = results.clubs.map(([club, games, , , , , shootoutWins, shootoutLosses, goalsFor, goalsAgainst]) =>
    ({ club, games, goalsFor: goalsFor - shootoutWins, goalsAgainst: goalsAgainst - shootoutLosses }));
  return { kind: 'goals', ...goalDifferentialOf(records), games: records.reduce((sum, r) => sum + r.games, 0) / 2 };
}

// ---------- the converted editions ----------

/** The plain mean of a player's skill attributes (values), or null when one is outside 0–99 (EA's unset value 255). */
export function attributeMean(values) {
  if (!values.length || values.some(v => !Number.isInteger(v) || v < 0 || v > 99)) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------- calibration ----------

const ranksOf = xs => {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const ranks = Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return ranks;
};
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < n; i++) { xy += (a[i] - ma) * (b[i] - mb); xx += (a[i] - ma) ** 2; yy += (b[i] - mb) ** 2; }
  return xy / Math.sqrt(xx * yy);
};
/** Spearman's rank correlation of two equal-length lists (ties at their mean rank). */
export const spearman = (a, b) => pearson(ranksOf(a), ranksOf(b));

/**
 * How the computed rule agrees with an edition: `players` `{ team, pos, overall, score }` (score null where the player
 * has no line). Both the edition's overalls and the scores are mapped group by group onto `histograms` (NHL 27's
 * squads), then compared: rank correlation per group, the mean gap per player, and clubs as their best 12 forwards,
 * 6 defenders and 1 goalie (rank correlation and mean gap).
 */
export function calibrationOf(players, histograms) {
  const rows = players.filter(p => p.score != null);
  const byGroup = {};
  let gap = 0;
  const mapped = rows.map(p => ({ ...p }));
  for (const group of ['F', 'D', 'G']) {
    const members = mapped.filter(p => groupOf(p.pos) === group);
    const computed = groupRatings(members, 'score', histograms), game = groupRatings(members, 'overall', histograms);
    for (const p of members) { p.computed = computed.get(p); p.game = game.get(p); gap += Math.abs(p.computed - p.game); }
    byGroup[group] = { rho: round(spearman(members.map(p => p.score), members.map(p => p.overall))), players: members.length };
  }
  const clubs = [...new Set(mapped.map(p => p.team))].sort();
  const strength = (team, key) => {
    const pool = mapped.filter(p => p.team === team);
    const best = (group, n) => pool.filter(p => groupOf(p.pos) === group).map(p => p[key]).sort((a, b) => b - a).slice(0, n);
    const list = [...best('F', 12), ...best('D', 6), ...best('G', 1)];
    return list.reduce((s, v) => s + v, 0) / list.length;
  };
  const game = clubs.map(t => strength(t, 'game')), computed = clubs.map(t => strength(t, 'computed'));
  return {
    players: rows.length, left: players.length - rows.length, ...byGroup,
    playerGap: round(gap / mapped.length),
    clubs: { rho: round(spearman(game, computed)), gap: round(game.reduce((s, v, i) => s + Math.abs(v - computed[i]), 0) / clubs.length), count: clubs.length },
  };
}

const round = v => Math.round(v * 1000) / 1000;
