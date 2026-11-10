// Ice hockey's seasons no EA edition rates in full (docs/design/hockey.md, "Computed seasons" and "NHL 08 and NHL 09"):
// the rule that computes a rating from a player's season statistics, and the rule that converts an edition's attributes
// into an overall. No I/O here: scripts/sync-nhl-seasons.mjs writes each season's statistics into its snapshot, and
// scripts/build-nhl-seasons.mjs builds the season from it with these functions.
//
// COMPUTED. A player's score is the weighted mean of the values of his last three regular seasons (the season itself 1,
// the one before 2, the one before that 1; 2004/05 was cancelled and is skipped), over the seasons he played:
// - a forward's value is 8 × his points a game, a defender's 5 × (plus his minutes a game where the source keeps time on
//   ice), each line starting from a replacement player's ten games at 0.1 points and 9 minutes a game;
// - a goalie's value is 1000 × his save percentage above the league's, his line starting from a replacement goalie's
//   600 shots at 12 points under the league, plus 6 × his share of the season's games (at most 1). Before goalies' shots
//   against were kept (1982/83) the same comparison is made on goals against a game: 1000 × (the league's goals against
//   per 60 minutes − his) / 30 shots, his line starting from 20 games (1,200 minutes) at 0.36 goals over the league.
// The scores are then ranked within each group (forwards, defenders, goalies) and read off NHL 27's squads in that group.
//
// CONVERTED. An edition that publishes attributes but no overall (NHL 08, NHL 09) scores each player by the plain mean
// of his skill attributes, ranks the scores within each group and reads them off NHL 07's EA overalls in that group.

/** The computed rule's constants (docs/design/hockey.md, "Computed seasons"); every season's source.conversion states them. */
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
