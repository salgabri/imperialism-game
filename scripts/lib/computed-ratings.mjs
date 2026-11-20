// Computed ratings (docs/design/computed-ratings.md): the steps every computed season shares, whatever its sport. A
// season's builder supplies its own facts (who played, how much, what they produced, its games' scores) and its engine's
// strength; these functions turn them into values, ratings and each club's move toward its real results. No I/O here.
//
// The steps, as the design doc numbers them:
// 3. value: `pooled` (the window), `replacementRate`, `priorFromNoise` / `priorFromReliability`, `shrunkRate`,
//    `seasonReliability`, `stabilityWeight`, `blend`;
// 4. scale: `referenceOf`, `ratingsOf`;
// 5. results: `srsOf`, `winShareOf`, `resultsTargets`, `perPointOf`, `clubMoveOf`.
// Step 1's club rule is `clubOfStints`.

/** The window's weights: the season itself 3, the season before 2, the one before that 1. */
export const WINDOW = Object.freeze([3, 2, 1]);

/** Reliabilities are held inside these bounds before they weigh anything: a perfectly stable signal is no infinite one. */
export const RELIABILITY_BOUNDS = Object.freeze([0.01, 0.95]);

// ---------- statistics ----------

export const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
/** The population variance (n in the denominator). */
export const variance = xs => { const m = mean(xs); return mean(xs.map(x => (x - m) ** 2)); };
/** Each value as standard deviations from the list's mean (0 for every value of a constant list). */
export function zscores(xs) {
  const m = mean(xs), sd = Math.sqrt(variance(xs));
  return xs.map(x => (sd > 0 ? (x - m) / sd : 0));
}

/** Mid-ranks, 0-based: tied values share the mean of the places they hold. */
export function ranksOf(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return ranks;
}

/** Pearson's correlation of two equal-length lists (0 when either is constant). */
export function pearson(a, b) {
  if (a.length !== b.length) throw new Error('Correlation needs two lists of one length');
  const ma = mean(a), mb = mean(b);
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < a.length; i++) { xy += (a[i] - ma) * (b[i] - mb); xx += (a[i] - ma) ** 2; yy += (b[i] - mb) ** 2; }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
}

/** Spearman's rank correlation (ties at their mid-rank). */
export const spearman = (a, b) => pearson(ranksOf(a), ranksOf(b));

// ---------- step 1: the club a player counts for ----------

/**
 * The club a player's season counts for: the one he played the most minutes for, or games where no minutes are kept; a
 * tie goes to the later club, where he finished the season. `stints`: `[{ club, minutes?, games }]` in the order he
 * played them. Null for no stint.
 */
export function clubOfStints(stints) {
  const timed = stints.some(stint => Number.isFinite(stint.minutes));
  let best = null;
  for (const stint of stints) {
    const amount = timed ? (stint.minutes ?? 0) : stint.games;
    if (!best || amount >= best.amount) best = { club: stint.club, amount };
  }
  return best?.club ?? null;
}

// ---------- step 3: each player's value ----------

/**
 * A player's window pooled: Σ weight × exposure and Σ weight × events over his seasons, `seasons` newest first (the
 * season itself, the one before, …; null or undefined for a season he did not play, which adds nothing). Pooling by
 * exposure lets a season with few games count for little. → `{ n, x }`.
 */
export function pooled(seasons, weights = WINDOW) {
  let n = 0, x = 0;
  weights.forEach((weight, k) => {
    const season = seasons[k];
    if (!season) return;
    n += weight * season.exposure;
    x += weight * season.events;
  });
  return { n, x };
}

/**
 * Replacement level, measured each season: the pooled rate (Σ events ÷ Σ exposure) of the quarter of `players`
 * (`{ n, x }`, those with any exposure) with the least exposure. A thin record shrinks toward this, not toward the mean:
 * players who play little are, on the evidence, worse than those who play.
 */
export function replacementRate(players) {
  const played = players.filter(p => p.n > 0).sort((a, b) => a.n - b.n);
  if (!played.length) throw new Error('No player with exposure');
  const fringe = played.slice(0, Math.max(1, Math.floor(played.length / 4)));
  const exposure = fringe.reduce((sum, p) => sum + p.n, 0);
  return fringe.reduce((sum, p) => sum + p.x, 0) / exposure;
}

/** Sampling noise per unit of exposure, by a rate: counts are Poisson, shares (save %, completion %) binomial. */
export const NOISE = Object.freeze({
  poisson: rate => rate,
  binomial: rate => rate * (1 - rate),
});

/**
 * The prior, in units of exposure, that shrinks a rate toward replacement: noise per unit of exposure ÷ the variance of
 * talent, by the method of moments among `players` (`{ n, x }`) with at least `least` exposure. Talent variance is the
 * rates' variance less their mean sampling variance. `unitNoise(rate)`: one unit of exposure's sampling variance at a
 * rate (NOISE.poisson, NOISE.binomial, or the sport's own). For a share stored as events above an expected rate (a goalie's
 * saves above the league's), pass `unitNoise` of the underlying share. → `{ k, talent, players }`.
 */
export function priorFromNoise(players, { least, unitNoise }) {
  const regulars = players.filter(p => p.n >= least);
  if (regulars.length < 3) throw new Error(`Too few players with ${least} exposure to measure a prior`);
  const rates = regulars.map(p => p.x / p.n);
  const unit = mean(regulars.map(p => unitNoise(p.x / p.n)));
  const noise = mean(regulars.map(p => unitNoise(p.x / p.n) / p.n));
  const talent = variance(rates) - noise;
  if (!(talent > 0)) throw new Error('The rates vary no more than their noise: no talent to measure');
  return { k: unit / talent, talent, players: regulars.length };
}

/**
 * The prior from a statistic's reliability `r` (its correlation between two seasons) at a typical season's exposure
 * `typical`: k = typical × (1 − r) ÷ r, the exposure at which a rate is half signal. For statistics whose noise is
 * neither Poisson nor binomial (WAR, plus-minus, fantasy points).
 */
export function priorFromReliability(r, typical) {
  if (!(r > 0 && r < 1)) throw new Error('A reliability between 0 and 1 is needed');
  return typical * (1 - r) / r;
}

/** A pooled record `{ n, x }` as a rate shrunk toward `replacement` by a prior of `k` units of exposure. */
export const shrunkRate = ({ n, x }, k, replacement) => (x + k * replacement) / (n + k);

/**
 * A signal's reliability: Spearman's correlation of its values in two consecutive seasons, `latest[i]` and
 * `before[i]` one player's (players with enough exposure in both), held inside RELIABILITY_BOUNDS.
 */
export function seasonReliability(latest, before) {
  const [low, high] = RELIABILITY_BOUNDS;
  return Math.min(high, Math.max(low, spearman(latest, before)));
}

/**
 * A signal's weight in the blend from its reliability: √rel ÷ (1 − rel), how much a standardized measure of one talent
 * should count given the share of it that is signal.
 */
export function stabilityWeight(reliability) {
  const [low, high] = RELIABILITY_BOUNDS;
  const rel = Math.min(high, Math.max(low, reliability));
  return Math.sqrt(rel) / (1 - rel);
}

/**
 * Players' values from several signals over one position group: each signal's values as z-scores, weighted by
 * `weight` (a fixed weight tuned once against a game) or else `stabilityWeight(reliability)`, and summed. `signals`:
 * `[{ values: number[], reliability?, weight? }]`, every `values` one player each, in one order. → `{ values, weights }`,
 * the weights normalised to sum to 1.
 */
export function blend(signals) {
  if (!signals.length) throw new Error('No signal to blend');
  const length = signals[0].values.length;
  if (signals.some(signal => signal.values.length !== length)) throw new Error('Every signal needs one value a player');
  const raw = signals.map(signal => (Number.isFinite(signal.weight) ? signal.weight : stabilityWeight(signal.reliability)));
  const total = raw.reduce((sum, w) => sum + w, 0);
  const weights = raw.map(w => w / total);
  const z = signals.map(signal => zscores(signal.values));
  return { values: Array.from({ length }, (_, i) => z.reduce((sum, column, s) => sum + weights[s] * column[i], 0)), weights };
}

// ---------- step 4: from value to rating ----------

/**
 * The ratings a position group's values are read against, lowest first: each club's best `quota` (the season's players
 * at the group per club, possibly fractional: every club's first whole number, then the best of the next depth across the
 * league), so that a backup meets the reference's backups rather than its fringe. `clubs`: each club's ratings at the
 * group, any order. As scripts/lib/nfl-reference.mjs's referenceOf, without its Madden specifics.
 */
export function referenceOf(clubs, quota) {
  const ranked = [];
  for (const ratings of clubs) ratings.slice().sort((a, b) => b - a).forEach((rating, depth) => ranked.push({ rating, depth }));
  ranked.sort((a, b) => a.depth - b.depth || b.rating - a.rating);
  const count = Math.round(quota * clubs.length);
  return ranked.slice(0, count).map(entry => entry.rating).sort((a, b) => a - b);
}

/**
 * Each value's rating: its mid-rank percentile among `values` (ties sharing one), read off `reference` (ascending) by
 * linear interpolation, rounded and held to 1–99. A higher value never gets a lower rating. → Map value → rating.
 * As scripts/lib/nfl-reference.mjs's overallsOf. `population` (at least the values' count) reads them as the best of
 * that many, the others ranking below every one of them (a rebuilt college season's players the records cannot name).
 */
export function ratingsOf(values, reference, { population = values.length } = {}) {
  if (!reference.length) throw new Error('No reference ratings');
  if (!(population >= values.length)) throw new Error(`A population of ${population} for ${values.length} values`);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length, m = reference.length, below = population - n;
  const out = new Map();
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const p = (below + (i + j) / 2 + 0.5) / population;
    const h = Math.min(Math.max(p * m - 0.5, 0), m - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    out.set(sorted[i], Math.min(99, Math.max(1, Math.round(reference[lo] + (reference[hi] - reference[lo]) * (h - lo)))));
    i = j + 1;
  }
  return out;
}

// ---------- step 5: each club's move toward its results ----------

/**
 * The Simple Rating System of a season's games (`[{ home, away, homeScore, awayScore, neutral? }]`): each club's rating
 * and one home edge that fit every margin as the home club's rating less the away club's, plus the edge where the game
 * was not at a neutral venue, by least squares, the ratings summing to zero. Also `sigma`, the margins' spread about the
 * fit, and `reliability`, the share of the ratings' variance that is not their error's (σ² × the mean diagonal of the
 * constrained fit's inverse, against the ratings' mean square; at least 0). As the rugby league seasons' srsOf on branch
 * claude/eager-williamson-546179, with neutral venues. → `{ ratings: { club: rating }, homeEdge, sigma, reliability }`, in
 * points (goals, runs) a game.
 */
export function srsOf(games) {
  const clubs = [...new Set(games.flatMap(game => [game.home, game.away]))].sort();
  const n = clubs.length, at = new Map(clubs.map((club, i) => [club, i]));
  const hasHome = games.some(game => !game.neutral);
  // Unknowns: the n ratings, the home edge (fixed at 0 when every game was neutral) and the constraint's multiplier.
  const size = n + 2;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);
  for (const game of games) {
    const row = new Array(n + 1).fill(0);
    row[at.get(game.home)] += 1;
    row[at.get(game.away)] -= 1;
    row[n] = game.neutral ? 0 : 1;
    const margin = game.homeScore - game.awayScore;
    for (let i = 0; i <= n; i++) {
      if (!row[i]) continue;
      for (let j = 0; j <= n; j++) m[i][j] += row[i] * row[j];
      rhs[i] += row[i] * margin;
    }
  }
  if (!hasHome) m[n][n] = 1;
  for (let i = 0; i < n; i++) { m[i][n + 1] = 1; m[n + 1][i] = 1; }
  // Gauss–Jordan on [m | I]: the right half becomes m's inverse.
  const a = m.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('The games do not rate every club');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const lead = a[col][col];
    for (let c = 0; c < 2 * size; c++) a[col][c] /= lead;
    for (let r = 0; r < size; r++) {
      if (r === col || !a[r][col]) continue;
      const factor = a[r][col];
      for (let c = 0; c < 2 * size; c++) a[r][c] -= factor * a[col][c];
    }
  }
  const inverse = a.map(row => row.slice(size));
  const solution = inverse.map(row => row.reduce((sum, x, j) => sum + x * rhs[j], 0));
  const rating = clubs.map((club, i) => solution[i]), edge = hasHome ? solution[n] : 0;
  const residuals = games.map(game => game.homeScore - game.awayScore
    - (rating[at.get(game.home)] - rating[at.get(game.away)] + (game.neutral ? 0 : edge)));
  const fitted = n + (hasHome ? 1 : 0) - 1;
  const sigma2 = residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, games.length - fitted);
  const error = sigma2 * clubs.reduce((sum, club, i) => sum + inverse[i][i], 0) / n;
  const spread = rating.reduce((sum, r) => sum + r * r, 0) / n;
  return {
    ratings: Object.fromEntries(clubs.map((club, i) => [club, rating[i]])),
    homeEdge: edge, sigma: Math.sqrt(sigma2), reliability: spread > 0 ? Math.max(0, 1 - error / spread) : 0,
  };
}

/**
 * Strength from records alone, where a season's scores are lost: each club's win share less one half (a tie half a
 * win), and the reliability that binomial luck leaves it (1 − the mean of p(1 − p) ÷ games against the shares'
 * variance; at least 0). `records`: `{ club: { w, l, t? } }`. → `{ ratings: { club: share − 0.5 }, reliability }`, in wins a
 * game: give `resultsTargets` a `perPoint` in win share too.
 */
export function winShareOf(records) {
  const clubs = Object.keys(records).sort();
  const games = clubs.map(club => records[club].w + records[club].l + (records[club].t ?? 0));
  if (games.some(g => !(g > 0))) throw new Error('Every club needs a game');
  const shares = clubs.map((club, i) => (records[club].w + (records[club].t ?? 0) / 2) / games[i]);
  const luck = mean(shares.map((p, i) => p * (1 - p) / games[i]));
  const spread = variance(shares);
  return {
    ratings: Object.fromEntries(clubs.map((club, i) => [club, shares[i] - 0.5])),
    reliability: spread > 0 ? Math.max(0, 1 - luck / spread) : 0,
  };
}

/**
 * Each club's target, the strength it should play at: `mean` plus its results strength (srsOf or winShareOf) times
 * √reliability, turned into lineup points by `perPoint`, what the sport's engine gives for a point of lineup strength in
 * the same units (perPointOf). √reliability rather than reliability: the engine adds its own luck back, so the targets
 * must spread as talent does, not as its best single guess (r itself left rugby league's standings 6% too narrow).
 * → `{ scale, targets: { club: strength } }`, scale = √reliability ÷ perPoint.
 */
export function resultsTargets({ ratings, reliability }, { mean: level, perPoint }) {
  if (!(perPoint > 0)) throw new Error('perPoint must be positive');
  const scale = Math.sqrt(Math.max(0, reliability)) / perPoint;
  return { scale, targets: Object.fromEntries(Object.entries(ratings).map(([club, strength]) => [club, level + scale * strength])) };
}

/**
 * What the engine gives for a point of lineup strength: the least-squares slope through (0, `base`) of the mean
 * outcome against the gap in points. `play(delta, rng)` plays one game between sides `delta` points apart (the first
 * the stronger) and returns its outcome in the results' units: the margin for srsOf, 1 / ½ / 0 for winShareOf (then
 * `base` is ½). Each gap in `deltas` is played `games` times with `rng` (a function returning [0, 1)).
 */
export function perPointOf({ play, rng, deltas = [-4, -2, 2, 4], games = 4000, base = 0 }) {
  let sxy = 0, sxx = 0;
  for (const delta of deltas) {
    let total = 0;
    for (let g = 0; g < games; g++) total += play(delta, rng);
    sxy += delta * (total / games - base);
    sxx += delta * delta;
  }
  return sxy / sxx;
}

/**
 * A club's move toward its `target`: every player by the whole number `shift` and the `plus` best of them by one point
 * more, each held to 1–99, whichever brings `strengthOf(movedPool)` nearest the target; of two as near, the smaller move,
 * then the lower. A player never passes one rated above him, and the club moves in steps of about one player's point
 * where a whole number for all would move it only by whole points. `pool`: `[{ rating, … }]`, its order by `bestFirst`
 * (default: rating, then the pool's own order). `strengthOf` gets the moved pool (each player's other fields kept) and
 * returns the strength the engine plays. As the rugby league seasons' clubMoveOf on branch claude/eager-williamson-546179.
 * → `{ shift, plus, before, after, pool }`: strength unmoved and moved, and the moved pool in its original order.
 */
export function clubMoveOf(pool, target, strengthOf, { bestFirst = (a, b) => b.rating - a.rating, range = 40 } = {}) {
  const order = pool.map((player, index) => ({ player, index })).sort((a, b) => bestFirst(a.player, b.player) || a.index - b.index);
  const n = order.length;
  if (!n) throw new Error('An empty club cannot move');
  const moved = t => {
    const shift = Math.floor(t / n), plus = t - shift * n;
    const out = new Array(n);
    order.forEach(({ player, index }, rank) => {
      out[index] = { ...player, rating: Math.min(99, Math.max(1, player.rating + shift + (rank < plus ? 1 : 0))) };
    });
    return out;
  };
  const before = strengthOf(moved(0));
  // A whole number for all moves the strength by about as many points, so the nearest move lies near the nearest whole
  // one: search a point either side of it, step by step.
  const whole = Math.max(-range, Math.min(range, Math.round(target - before)));
  let best = null;
  for (let t = (whole - 1) * n; t <= (whole + 1) * n; t++) {
    const after = strengthOf(moved(t)), miss = Math.abs(after - target);
    if (!best || miss < best.miss - 1e-9 || (Math.abs(miss - best.miss) <= 1e-9
      && (Math.abs(t) < Math.abs(best.t) || (Math.abs(t) === Math.abs(best.t) && t < best.t)))) best = { t, after, miss };
  }
  const shift = Math.floor(best.t / n), plus = best.t - shift * n;
  return { shift, plus, before, after: best.after, pool: moved(best.t) };
}
