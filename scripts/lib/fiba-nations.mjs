// Basketball's national fives against FIBA's results (docs/design/euroleague.md, "The nations' level against FIBA's
// results"): where each nation's results put it, where its five stands, and what moving its curated players would do to
// the engine's predictions of games it has not seen. scripts/build-basketball.mjs writes it all to
// docs/design/basketball-nations-audit.json. No I/O here.
//
// The scale is NBA 2K27's, and the EuroLeague's estimate set on it; a curated rating (a player of neither) is the unknown.
// The method is computed-ratings.md's for nations drawn from many leagues, as rugby union's pool leagues have it: the
// results' strength (an SRS of the tournaments), the relation of five strength to it among the nations whose fives the
// NBA and the EuroLeague rate (the anchors), and each nation's curated players moved by one amount so that its five
// stands where that relation puts its results.
import { NATIONS, hashStr, makeRng } from '../../src/data/teams.js';
import { prepareMatch, sampleResult } from '../../src/sports/basketball.js';
import { perPointOf } from './computed-ratings.mjs';
import { engineStrengthOf } from './nba-seasons.mjs';
import { connectedSides, resultsStrength } from './fiba-results.mjs';

/** The competitions the fit reads: those the nations play with their best (the qualifiers' windows they do not). */
export const TOURNAMENTS = Object.freeze(['wc2023', 'oqt2024', 'og2024', 'eurobasket2025', 'americup2025', 'afrobasket2025', 'asiacup2025']);
const TOURNAMENT = new Set(TOURNAMENTS);
/** A game's weight by its year: the method's window, the latest summer 3, the one before 2, the one before that 1. */
export const YEAR_WEIGHTS = Object.freeze({ 2023: 1, 2024: 2, 2025: 3, 2026: 3 });
/** The names FIBA's pages give the game's nations where the game names them otherwise. */
export const NAME_ALIASES = Object.freeze({ 'Bosnia and Herzegovina': '070', Czechia: '203', 'Dominican Republic': '214', 'Great Britain': '826',
  'Ivory Coast': '384', 'United States': '840' });
const idOfName = new Map(Object.entries(NATIONS).map(([id, row]) => [row[0], id]));
/** A FIBA side's nation id in the game, or null. */
export const nationOfName = name => NAME_ALIASES[name] ?? idOfName.get(name) ?? null;
const CONTINENT = { UEFA: 'Europe', CONMEBOL: 'Americas', CONCACAF: 'Americas', CAF: 'Africa', AFC: 'Asia', OFC: 'Asia' };
/** A nation's FIBA region: its confederation's continent, Australia and New Zealand in Asia (FIBA Asia since 2017). */
export const regionOf = id => CONTINENT[NATIONS[id][2]];
/** A five is an anchor when at most this share of its engine strength is curated: one curated player of five, at most. */
export const ANCHOR_SHARE = 0.25;
/** A five whose curated players hold at least this share is judged by its results alone (`moveOf`). */
export const CURATED_SHARE = 0.75;
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** The facts' rows → the fit's games (`{ date, competition, a, b, scoreA, scoreB, home, weight }`). */
export const gamesOf = rows => rows.map(([date, competition, a, b, scoreA, scoreB, , home]) => ({ date, competition, a, b, scoreA, scoreB, home,
  weight: YEAR_WEIGHTS[date.slice(0, 4)] }));

/** The engine's margin a lineup point under FIBA's rules: two fives of 80s, one `delta` points better on every place. */
export function engineMarginPerPoint() {
  const side = { id: 'even', sport: 'basketball', squad: ['PG', 'SG', 'SF', 'PF', 'C'].map(pos => ({ name: pos, pos, positions: [pos], rating: 80 })) };
  return perPointOf({ rng: makeRng(hashStr('fiba margin per point')), games: 20000,
    play: (delta, rng) => { const result = sampleResult(rng, prepareMatch(side, side, 80 + delta, 80)); return result.ga - result.gd; } });
}

/** The engine's home edge under FIBA's rules, in points: two even fives, the home side's mean margin. */
export function engineHomeEdge() {
  const side = id => ({ id, sport: 'basketball', squad: ['PG', 'SG', 'SF', 'PF', 'C'].map(pos => ({ name: pos, pos, positions: [pos], rating: 80 })) });
  const prepared = prepareMatch(side('away'), side('home'), undefined, undefined, { home: true });
  const rng = makeRng(hashStr('fiba home edge'));
  let margin = 0;
  for (let i = 0; i < 40000; i++) { const r = sampleResult(rng, prepared, 6); margin += r.gd - r.ga; }
  return margin / 40000;
}

/** How far the five's engine strength moves when each of its curated players moves a point: their share of it. */
export const curatedShareOf = five => engineStrengthOf(five.map(p => ({ ...p, rating: p.rating + (p.source === 'curated' ? 1 : 0) }))) - engineStrengthOf(five);

/**
 * One move for a five's curated players, from its gap to the anchors' relation (`gap`, in lineup points) and their share
 * of the five (`share`): a five they hold at least CURATED_SHARE of lands on the relation (gap ÷ share); in a mixed five
 * they move by the gap itself, so the five closes their share of it, the rest of its gap left to its NBA and EuroLeague
 * players, whose ratings stand.
 */
export const moveOf = (gap, share) => (share >= CURATED_SHARE ? gap / share : gap);

/**
 * The fit on `games` (gamesOf's), the fives `fives` (`{ id: [{ name, positions, rating, source }] }`, source 'nba',
 * 'euroleague', 'former' or 'curated') under their FIBA names (`names`: id → name), and the engine's margin `m`.
 * - The tournaments' SRS (each side's rating in points a game), its reliability r and home edge (`homeEdge` fixes it).
 * - A fielded nation no tournament rates (the Netherlands', Ukraine's fives) takes its qualifiers' SRS, set on the
 *   tournaments' by the curated fives of its qualifiers rated in both (their players play every window).
 * - T: a nation's results in lineup points from the field's mean, √r × SRS ÷ m.
 * - The anchors' relation of five strength E to T by least squares; each nation's gap to it and its curated players' move.
 */
export function nationsFit(games, fives, names, m, { homeEdge = null, engineHome = 0 } = {}) {
  const tournaments = games.filter(game => TOURNAMENT.has(game.competition));
  const joined = connectedSides(tournaments, 'United States');
  const srs = resultsStrength(tournaments.filter(game => joined.has(game.a)), { homeEdge });
  const share = Object.fromEntries(Object.entries(fives).map(([id, five]) => [id, curatedShareOf(five)]));
  const S = {}, from = {};
  for (const id of Object.keys(fives)) if (srs.ratings[names[id]] != null) { S[id] = srs.ratings[names[id]]; from[id] = 'tournaments'; }
  const qualifiers = games.filter(game => !TOURNAMENT.has(game.competition));
  const aligned = {};
  for (const id of Object.keys(fives).filter(id => S[id] == null)) {
    if (!qualifiers.some(game => game.a === names[id] || game.b === names[id])) continue;
    const near = connectedSides(qualifiers, names[id]);
    const q = resultsStrength(qualifiers.filter(game => near.has(game.a)));
    const both = Object.keys(fives).filter(j => from[j] === 'tournaments' && share[j] >= CURATED_SHARE && q.ratings[names[j]] != null);
    if (!both.length) continue;
    const offset = both.reduce((sum, j) => sum + S[j] - q.ratings[names[j]], 0) / both.length;
    S[id] = q.ratings[names[id]] + offset;
    from[id] = 'qualifiers';
    aligned[id] = { qualifiers: round(q.ratings[names[id]]), offset: round(offset), on: both };
  }
  const k = Math.sqrt(srs.reliability) / m;
  const rows = Object.keys(fives).filter(id => S[id] != null).map(id => ({ id, T: S[id] * k, E: engineStrengthOf(fives[id]), share: share[id] }));
  const anchors = rows.filter(row => row.share <= ANCHOR_SHARE);
  const level = anchors.reduce((sum, row) => sum + row.E, 0) / anchors.length;
  const centre = anchors.reduce((sum, row) => sum + row.T, 0) / anchors.length;
  const slope = anchors.reduce((sum, row) => sum + (row.T - centre) * (row.E - level), 0) / anchors.reduce((sum, row) => sum + (row.T - centre) ** 2, 0);
  const stands = T => level + slope * (T - centre);
  const residuals = anchors.map(row => row.E - stands(row.T));
  // The other estimator, for the record: one offset a region for the curated players, fitted straight on the tournaments'
  // margins between two fielded nations: each margin less the engine's (m a five point, its home edge) against
  // m × (share_A × δ_A's region − share_B × δ_B's region), each game weighed by its year.
  const regions = ['Europe', 'Americas', 'Africa', 'Asia'];
  const idOf = Object.fromEntries(Object.entries(names).map(([id, name]) => [name, id]));
  const E = Object.fromEntries(rows.map(row => [row.id, row.E]));
  const normal = regions.map(() => regions.map(() => 0)), rhs = regions.map(() => 0);
  for (const game of tournaments) {
    const ia = idOf[game.a], ib = idOf[game.b];
    if (E[ia] == null || E[ib] == null) continue;
    const sign = game.home === 'A' ? 1 : game.home === 'B' ? -1 : 0;
    const miss = game.scoreA - game.scoreB - m * (E[ia] - E[ib]) - sign * engineHome;
    const x = regions.map(region => m * ((regionOf(ia) === region ? share[ia] : 0) - (regionOf(ib) === region ? share[ib] : 0)));
    for (let i = 0; i < regions.length; i++) {
      rhs[i] += game.weight * x[i] * miss;
      for (let j = 0; j < regions.length; j++) normal[i][j] += game.weight * x[i] * x[j];
    }
  }
  const solved = solveSmall(normal, rhs);
  const marginOffsets = Object.fromEntries(regions.map((region, i) => [region, solved[i]]));
  const nations = {};
  for (const row of rows) {
    const gap = stands(row.T) - row.E;
    nations[row.id] = { srs: round(S[row.id]), from: from[row.id], T: round(row.T), five: round(row.E), share: round(row.share), stands: round(stands(row.T)),
      gap: round(gap), move: row.share > 0 ? Math.round(moveOf(gap, row.share)) : 0 };
  }
  return {
    srs: { games: tournaments.filter(game => joined.has(game.a)).length, sides: Object.keys(srs.ratings).length, homeEdge: srs.homeEdge, sigma: srs.sigma,
      reliability: srs.reliability },
    perPoint: m, perResultsPoint: k,
    line: { anchors: anchors.map(row => row.id), level, centre, slope,
      residualSd: Math.sqrt(residuals.reduce((sum, x) => sum + x * x, 0) / Math.max(1, residuals.length - 2)) },
    nations, aligned, marginOffsets,
  };
}

/** The solution x of `a` x = `b`, a small square system, by Gaussian elimination with partial pivoting. */
function solveSmall(a, b) {
  const k = b.length, m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("A region's curated offset has no game to fit it");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= k; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

/**
 * Why the qualifiers stay out of the fit: each side's mean margin above the tournaments' SRS in the qualifier games
 * between two sides it rates, for the fives mostly NBA- and EuroLeague-rated (curated share under 0.45) and the curated
 * fives (at least CURATED_SHARE). → `{ rated: { nations, games, mean }, curated: { nations, games, mean }, nations }`.
 */
export function windowEffect(games, fives, names) {
  const tournaments = games.filter(game => TOURNAMENT.has(game.competition));
  const srs = resultsStrength(tournaments);
  const share = Object.fromEntries(Object.entries(fives).map(([id, five]) => [id, curatedShareOf(five)]));
  const per = {};
  for (const game of games.filter(g => !TOURNAMENT.has(g.competition) && srs.ratings[g.a] != null && srs.ratings[g.b] != null)) {
    const sign = game.home === 'A' ? 1 : game.home === 'B' ? -1 : 0;
    const miss = game.scoreA - game.scoreB - (srs.ratings[game.a] - srs.ratings[game.b] + sign * srs.homeEdge);
    (per[game.a] ??= []).push(miss);
    (per[game.b] ??= []).push(-miss);
  }
  const group = test => {
    const ids = Object.keys(fives).filter(id => test(share[id]) && per[names[id]]?.length);
    const all = ids.flatMap(id => per[names[id]]);
    return { nations: ids.length, games: all.length, mean: round(all.reduce((a, b) => a + b, 0) / all.length) };
  };
  return {
    rated: group(x => x < 0.45), curated: group(x => x >= CURATED_SHARE),
    nations: Object.fromEntries(Object.keys(fives).filter(id => per[names[id]]?.length).map(id => [id,
      { games: per[names[id]].length, mean: round(per[names[id]].reduce((a, b) => a + b, 0) / per[names[id]].length), share: round(share[id]) }])),
  };
}

/** A five as the engine fields it. */
const sideOf = (id, five) => ({ id, sport: 'basketball', squad: five.map(p => ({ name: p.name, pos: p.positions[0], positions: p.positions, rating: p.rating })) });
const SAMPLES = 2000;
/** P(A wins) and A's mean margin from the engine at Balanced, FIBA's rules: at A's home, B's or a neutral venue. */
function odds(fiveA, fiveB, home, key) {
  const a = sideOf('A', fiveA), b = sideOf('B', fiveB);
  const [attacker, defender, flip] = home === 'A' ? [b, a, true] : [a, b, false];
  const prepared = prepareMatch(attacker, defender, undefined, undefined, { home: home !== 'N' });
  const rng = makeRng(hashStr(key));
  let wins = 0, margin = 0;
  for (let i = 0; i < SAMPLES; i++) { const r = sampleResult(rng, prepared, 6); wins += r.winner === attacker.id ? 1 : 0; margin += r.ga - r.gd; }
  return flip ? { p: 1 - wins / SAMPLES, margin: -margin / SAMPLES } : { p: wins / SAMPLES, margin: margin / SAMPLES };
}
/** The fives with each nation's curated players moved by `moves` (id → points). */
export const movedFives = (fives, moves) => Object.fromEntries(Object.entries(fives).map(([id, five]) => [id,
  five.map(p => (p.source === 'curated' && moves[id] ? { ...p, rating: Math.max(1, Math.min(99, p.rating + moves[id])) } : p))]));

/**
 * The moves a rule gives from a fit: 'nation', the method's (each nation's moveOf); 'half' of it; 'quarter-relative', a
 * quarter of each nation's move less the curated fives' mean (their order by results, their level kept); 'region', the
 * mean move of a region's curated fives for all its curated players; 'margins', a region's offset fitted straight on the
 * margins (nationsFit's `marginOffsets`).
 */
export function movesOf(fit, rule) {
  const curated = Object.entries(fit.nations).filter(([, n]) => n.share >= CURATED_SHARE);
  const mean = curated.reduce((sum, [, n]) => sum + moveOf(n.gap, n.share), 0) / curated.length;
  const byRegion = {};
  for (const [id, n] of curated) (byRegion[regionOf(id)] ??= []).push(moveOf(n.gap, n.share));
  const moves = {};
  for (const [id, n] of Object.entries(fit.nations)) {
    if (!(n.share > 0)) continue;
    const own = moveOf(n.gap, n.share);
    const region = byRegion[regionOf(id)];
    const move = rule === 'nation' ? own : rule === 'half' ? own / 2 : rule === 'quarter-relative' ? (own - mean) / 4
      : rule === 'region' ? (region ? region.reduce((a, b) => a + b, 0) / region.length : 0)
        : rule === 'margins' ? fit.marginOffsets[regionOf(id)] : NaN;
    if (!Number.isFinite(move)) throw new Error(`Unknown rule ${rule}`);
    moves[id] = Math.round(move);
  }
  return moves;
}
export const RULES = Object.freeze(['nation', 'half', 'quarter-relative', 'region', 'margins']);

/**
 * Out of sample: each split fits on its training games and scores its test games (those between two fielded nations)
 * through the engine with the fives as they are and as each rule moves them: log loss and Brier score of the winner,
 * across continents and within one, and each region's mean margin above the engine's (across continents: the region's;
 * within one: its curated fives' and the others'). Splits: three by date, and each tournament left out in turn.
 */
export function validation(games, fives, names, m, { fullHomeEdge, engineHome = 0 }) {
  const idOf = Object.fromEntries(Object.entries(names).map(([id, name]) => [name, id]));
  const share = Object.fromEntries(Object.entries(fives).map(([id, five]) => [id, curatedShareOf(five)]));
  const beforeCache = new Map();
  const score = (test, after) => {
    const sum = { all: [0, 0, 0, 0, 0], cross: [0, 0, 0, 0, 0], same: [0, 0, 0, 0, 0] };
    const resid = {};
    for (const game of test) {
      const ia = idOf[game.a], ib = idOf[game.b];
      if (!ia || !ib) continue;
      const key = `${game.date}|${game.a}|${game.b}`;
      if (!beforeCache.has(key)) beforeCache.set(key, odds(fives[ia], fives[ib], game.home, key));
      const before = beforeCache.get(key), moved = odds(after[ia], after[ib], game.home, key);
      const y = game.scoreA > game.scoreB ? 1 : 0;
      const clip = p => Math.min(1 - 0.5 / SAMPLES, Math.max(0.5 / SAMPLES, p));
      const loss = p => -(y * Math.log(clip(p)) + (1 - y) * Math.log(1 - clip(p)));
      const cross = regionOf(ia) !== regionOf(ib);
      for (const bucket of ['all', cross ? 'cross' : 'same']) {
        const s = sum[bucket];
        s[0] += 1; s[1] += loss(before.p); s[2] += loss(moved.p); s[3] += (before.p - y) ** 2; s[4] += (moved.p - y) ** 2;
      }
      for (const [id, sign] of [[ia, 1], [ib, -1]]) {
        const group = cross ? regionOf(id) : `${regionOf(id)} ${share[id] >= CURATED_SHARE ? 'curated' : 'others'}`;
        const r = (resid[group] ??= [0, 0, 0]);
        r[0] += 1; r[1] += sign * (game.scoreA - game.scoreB - before.margin); r[2] += sign * (game.scoreA - game.scoreB - moved.margin);
      }
    }
    const out = {};
    for (const [bucket, s] of Object.entries(sum)) {
      if (s[0]) out[bucket] = { games: s[0], logLoss: [round(s[1] / s[0], 4), round(s[2] / s[0], 4)], brier: [round(s[3] / s[0], 4), round(s[4] / s[0], 4)] };
    }
    out.residual = Object.fromEntries(Object.entries(resid).sort().map(([group, r]) => [group, { teamGames: r[0], before: round(r[1] / r[0]), after: round(r[2] / r[0]) }]));
    return out;
  };
  const splits = [
    { id: 'wc2023→2024', about: 'fit on the 2023 World Cup (its hosts never played away: the home edge is the full fit\'s), test on the 2024 Olympic qualifiers and Olympics',
      train: g => g.date < '2024-07-01', test: g => g.date >= '2024-07-01' && ['oqt2024', 'og2024'].includes(g.competition),
      options: { homeEdge: fullHomeEdge, engineHome } },
    { id: 'to-og2024', about: 'fit on the 2023 World Cup and the 2024 Olympic qualifiers, test on the Olympics',
      train: g => g.date < '2024-07-20', test: g => g.competition === 'og2024', options: { engineHome } },
    { id: 'to-2025', about: 'fit before the 2025 continental championships, test on them',
      train: g => g.date < '2025-08-01', test: g => g.date >= '2025-08-01' && TOURNAMENT.has(g.competition), options: { engineHome } },
  ];
  const result = { samples: SAMPLES, rules: {} };
  for (const rule of RULES) {
    const byRule = { splits: {}, leaveOneOut: {} };
    for (const split of splits) {
      const fit = nationsFit(games.filter(split.train), fives, names, m, split.options ?? {});
      byRule.splits[split.id] = { about: split.about, ...score(games.filter(split.test), movedFives(fives, movesOf(fit, rule))) };
    }
    const total = [0, 0, 0, 0, 0];
    for (const left of TOURNAMENTS) {
      const fit = nationsFit(games.filter(g => g.competition !== left), fives, names, m, { engineHome });
      const s = score(games.filter(g => g.competition === left), movedFives(fives, movesOf(fit, rule)));
      byRule.leaveOneOut[left] = { games: s.all.games, logLoss: s.all.logLoss, brier: s.all.brier };
      total[0] += s.all.games; total[1] += s.all.logLoss[0] * s.all.games; total[2] += s.all.logLoss[1] * s.all.games;
      total[3] += s.all.brier[0] * s.all.games; total[4] += s.all.brier[1] * s.all.games;
    }
    byRule.leaveOneOut.all = { games: total[0], logLoss: [round(total[1] / total[0], 4), round(total[2] / total[0], 4)],
      brier: [round(total[3] / total[0], 4), round(total[4] / total[0], 4)] };
    result.rules[rule] = byRule;
  }
  return result;
}

/**
 * The anchors' relation's uncertainty where the curated fives stand: its value at their mean T, the anchors resampled
 * (`draws` times, seeded) → p5, p50 and p95.
 */
export function lineBand(fit, draws = 4000) {
  const anchors = fit.line.anchors.map(id => fit.nations[id]);
  const curated = Object.values(fit.nations).filter(n => n.share >= CURATED_SHARE);
  const at = curated.reduce((sum, n) => sum + n.T, 0) / curated.length;
  const rng = makeRng(hashStr('fiba anchors bootstrap'));
  const values = [];
  for (let i = 0; i < draws; i++) {
    const sample = anchors.map(() => anchors[Math.floor(rng() * anchors.length)]);
    const mx = sample.reduce((s, n) => s + n.T, 0) / sample.length, my = sample.reduce((s, n) => s + n.five, 0) / sample.length;
    const sxx = sample.reduce((s, n) => s + (n.T - mx) ** 2, 0);
    if (sxx < 1e-9) continue;
    const b = sample.reduce((s, n) => s + (n.T - mx) * (n.five - my), 0) / sxx;
    values.push(my + b * (at - mx));
  }
  values.sort((x, y) => x - y);
  const q = p => round(values[Math.floor(p * (values.length - 1))]);
  return { at: round(at), value: round(fit.line.level + fit.line.slope * (at - fit.line.centre)), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
}
