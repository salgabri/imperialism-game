// Forecast track of the football squad gate (docs/design/football-squad-gate.md, "Forecast track"). Pure functions:
// scripts/football-validate.mjs reads the files and calls forecastTrack().
//
// Season Y scores the martj42 full internationals in (R_Y, R_next], where R_Y is the season's informationDate and
// R_next the informationDate of the next newer season the gate scores; the newest season's window is open and is not
// scored. Both teams must field a side in the season (scripts/lib/results-names.mjs maps the names), and matches with a
// suspended or non-member nation are scored apart from the gate. The model is an ordered logit with symmetric cut
// points:
//   z = β·(Z_home − Z_away) + h·[not neutral]
//   P(home) = σ(z − c), P(away) = σ(−z − c), P(draw) = σ(z + c) − σ(z − c)
// with Z the strength standardised within the season (mean 0, population SD 1 over every nation that fields a side).
// Roster strength T_n is the unrounded mean effective rating of the best 4-4-2; the baseline is World Football Elo
// frozen at R_Y. A match window (a FIFA window or a tournament) is a cluster of matches (matchClusters): every finals
// tournament edition is its own window, and friendlies, qualifiers and Nations Leagues group into date windows split at
// gaps of more than windowGapDays. One completed window cannot be split by year, so β, h and c are fitted by k-fold
// cross-validation grouped by match window (k = min(folds, windows), each window whole in one fold, folds balanced by
// match count: groupFolds), every match scored out of fold. Errors come from the paired per-match log-loss difference,
// clustered by match window and, separately, by team pair; the larger SE is the gate's. Each SE is a seeded block
// bootstrap, or a delete-one-cluster jackknife when it has fewer than jackknifeBelowClusters clusters, where a bootstrap
// of few blocks understates the error; with that few clusters the margin also takes the two-sided 95% Student t
// critical value on G − 1 degrees of freedom (G the fewest clusters) in place of seMultiplier. results.csv covers the
// window when its pinned commit is dated after R_next or it holds a match dated on or after R_next; otherwise the
// verdict stands but is marked partial, to be re-scored once results.csv covers R_next.
// Ported on 2026-11-10 from the squad-years work (claude/football-rating-strategy-ef71dc), without the method gate's
// candidate comparisons.

export const FORECAST = {
  windowGapDays: 10, tournamentGapDays: 60, folds: 5, minMatches: 100, minWindows: 2, seMultiplier: 2,
  jackknifeBelowClusters: 8, criticalLevel: 0.975,
  bootstrap: { resamples: 2000, seed: 20261006 }, ridge: 1e-6,
};
export const OUTCOMES = ['home', 'draw', 'away'];
const round4 = value => value == null || !Number.isFinite(value) ? null : Math.round(value * 1e4) / 1e4;
const dayMs = 86400000;
const daysBetween = (later, earlier) => (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / dayMs;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

// ---- results.csv ----
/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and newlines; CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], quoted = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') { quoted = true; any = true; }
    else if (ch === ',') { row.push(field); field = ''; any = true; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; any = false; }
    else if (ch !== '\r') { field += ch; any = true; }
  }
  if (any || field) { row.push(field); rows.push(row); }
  return rows;
}
const RESULTS_COLUMNS = ['date', 'home_team', 'away_team', 'home_score', 'away_score', 'tournament', 'city', 'country', 'neutral'];
/** martj42 results.csv → [{ date, home, away, homeScore, awayScore, tournament, neutral }]; unplayed fixtures (NA) get null scores. */
export function parseResults(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const col = Object.fromEntries(RESULTS_COLUMNS.map(name => [name, header?.indexOf(name) ?? -1]));
  const missing = RESULTS_COLUMNS.filter(name => col[name] < 0);
  if (missing.length) throw new Error(`results.csv lacks column(s) ${missing.join(', ')}`);
  const score = text => (/^\d+$/.test(String(text).trim()) ? Number(text) : null);
  return rows.filter(cells => cells.length > 1).map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`results.csv row ${index + 2} has ${cells.length} fields, not ${header.length}`);
    const row = { date: cells[col.date], home: cells[col.home_team], away: cells[col.away_team],
      homeScore: score(cells[col.home_score]), awayScore: score(cells[col.away_score]), tournament: cells[col.tournament],
      neutral: String(cells[col.neutral]).trim().toUpperCase() === 'TRUE' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.home || !row.away) throw new Error(`results.csv row ${index + 2} is malformed`);
    return row;
  });
}
/** 0 home win, 1 draw, 2 away win (scores after extra time; shoot-outs count as draws). */
export const outcomeOf = match => (match.homeScore > match.awayScore ? 0 : match.homeScore === match.awayScore ? 1 : 2);

// ---- match windows ----
/** Clusters of consecutive match dates, a new one after a gap of more than gapDays: [{ index, from, to }] plus date → index. */
export function matchWindows(dates, gapDays = FORECAST.windowGapDays) {
  const unique = [...new Set(dates)].sort();
  const windows = [], windowOf = new Map();
  for (const date of unique) {
    const last = windows.at(-1);
    if (!last || daysBetween(date, last.to) > gapDays) windows.push({ index: windows.length, from: date, to: date });
    else windows.at(-1).to = date;
    windowOf.set(date, windows.length - 1);
  }
  return { windows, windowOf };
}

/** Friendlies, qualifiers and Nations Leagues are played across FIFA windows; every other competition is a finals tournament. */
export const isWindowCompetition = tournament => tournament === 'Friendly' || /qualification|Nations League/i.test(String(tournament));

/** Runs of indices in date order (index order within a day), a new run after a gap of more than gapDays. */
function dateRuns(indices, dates, gapDays) {
  const runs = [];
  for (const i of indices.slice().sort((a, b) => (dates[a] < dates[b] ? -1 : dates[a] > dates[b] ? 1 : a - b))) {
    const last = runs.at(-1);
    if (!last || daysBetween(dates[i], last.to) > gapDays) runs.push({ from: dates[i], to: dates[i], members: [i] });
    else { last.to = dates[i]; last.members.push(i); }
  }
  return runs;
}

/**
 * Match windows for the clustered SEs and the CV folds (design: "a FIFA window or a tournament").
 * matches: [{ date, tournament }]. Each finals tournament edition (isWindowCompetition false) is one window:
 * same-name matches, a new edition after a gap of more than tournamentGapDays (so AFCON 2025, December to
 * January, stays one), labelled by name and the year of its first match. Friendlies, qualifiers and Nations
 * Leagues group into date windows split at gaps of more than gapDays. Windows are indexed by first date, then
 * date windows before tournaments, then label. Returns { clusters: [{ index, kind, label?, from, to, matches }],
 * clusterOf: window index per match }.
 */
export function matchClusters(matches, { gapDays = FORECAST.windowGapDays, tournamentGapDays = FORECAST.tournamentGapDays } = {}) {
  const dates = matches.map(match => match.date), windowed = [], byName = new Map();
  matches.forEach((match, i) => {
    if (isWindowCompetition(match.tournament)) windowed.push(i);
    else byName.set(match.tournament, [...(byName.get(match.tournament) ?? []), i]);
  });
  const groups = dateRuns(windowed, dates, gapDays).map(run => ({ kind: 'window', label: '', ...run }));
  for (const [name, indices] of byName) {
    const runs = dateRuns(indices, dates, tournamentGapDays);
    const years = runs.map(run => run.from.slice(0, 4));
    // Two editions starting in one year are told apart by their first date.
    for (const [k, run] of runs.entries()) groups.push({ kind: 'tournament', label: `${name} ${years.filter(y => y === years[k]).length > 1 ? run.from : years[k]}`, ...run });
  }
  groups.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.kind !== b.kind ? (a.kind === 'window' ? -1 : 1) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const clusterOf = new Array(matches.length);
  const clusters = groups.map((group, index) => {
    for (const i of group.members) clusterOf[i] = index;
    return { index, kind: group.kind, ...(group.label ? { label: group.label } : {}), from: group.from, to: group.to, matches: group.members.length };
  });
  return { clusters, clusterOf };
}

/**
 * Grouped k-fold: k = min(folds, windows), every window whole in one fold. Windows go largest first (then by index)
 * to the fold holding the fewest matches so far (then the lowest fold), so folds stay balanced however unequal the
 * windows are (index mod k would put the March, June and World Cup windows of 2025/26 into one fold of 238 of 485
 * matches). Returns { k, foldOf: fold per window index }.
 */
export function groupFolds(clusters, folds = FORECAST.folds) {
  const k = Math.min(folds, clusters.length), load = new Array(k).fill(0), foldOf = new Array(clusters.length);
  for (const cluster of clusters.slice().sort((a, b) => b.matches - a.matches || a.index - b.index)) {
    let fold = 0;
    for (let f = 1; f < k; f++) if (load[f] < load[fold]) fold = f;
    foldOf[cluster.index] = fold;
    load[fold] += cluster.matches;
  }
  return { k, foldOf };
}

// ---- ordered logit ----
const sigmoid = x => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const FLOOR = 1e-12;
/** [P(home), P(draw), P(away)] for linear predictor z and cut point c > 0; sums to 1. */
export function outcomeProbabilities(z, c) {
  const home = sigmoid(z - c), away = sigmoid(-z - c);
  const draw = Math.max(FLOOR, sigmoid(z + c) - sigmoid(z - c));
  const total = home + draw + away;
  return [home / total, draw / total, away / total];
}
/** z for params { beta: [...], h } and a row { x: [...], home: 0|1 }. */
export const linearPredictor = (params, row) => params.beta.reduce((sum, b, k) => sum + b * row.x[k], 0) + params.h * row.home;
export const predict = (params, row) => outcomeProbabilities(linearPredictor(params, row), params.c);

function solve(matrix, vector) {
  const n = vector.length, a = matrix.map((line, i) => [...line, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-300) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let k = col; k <= n; k++) a[r][k] -= f * a[col][k];
    }
  }
  return a.map((line, i) => line[n] / line[i]);
}

/**
 * Maximum likelihood (with a ridge of FORECAST.ridge on β and h, which only
 * keeps a training set without home games identifiable) by Newton's method on
 * the analytic gradient and Hessian; the symmetric-cut ordered logit is concave
 * in (β, h, c). rows: [{ x: number[k], home: 0|1, outcome: 0|1|2 }].
 */
export function fitOrderedLogit(rows, k, { ridge = FORECAST.ridge, maxIterations = 100 } = {}) {
  if (!rows.length) throw new Error('fitOrderedLogit needs rows');
  const dim = k + 2, H = k, C = k + 1;
  const draws = rows.filter(row => row.outcome === 1).length / rows.length;
  let theta = [...new Array(k).fill(0), 0, Math.log((1 + Math.max(0.05, draws)) / (1 - Math.max(0.05, draws)))];
  const unpack = t => ({ beta: t.slice(0, k), h: t[H], c: t[C] });
  const evaluate = t => {
    const { beta, h, c } = unpack(t);
    if (!(c > 0)) return { ll: -Infinity };
    let ll = 0;
    const grad = new Array(dim).fill(0), hess = Array.from({ length: dim }, () => new Array(dim).fill(0));
    for (const row of rows) {
      const z = beta.reduce((sum, b, j) => sum + b * row.x[j], 0) + h * row.home;
      const a = z - c, b = z + c, sa = sigmoid(a), sb = sigmoid(b);
      const da = sa * (1 - sa), db = sb * (1 - sb);
      let gz, gc, hzz, hzc, hcc;
      if (row.outcome === 0) { ll += Math.log(Math.max(FLOOR, sa)); gz = 1 - sa; gc = -(1 - sa); hzz = -da; hzc = da; hcc = -da; }
      else if (row.outcome === 2) { ll += Math.log(Math.max(FLOOR, 1 - sb)); gz = -sb; gc = -sb; hzz = -db; hzc = -db; hcc = -db; }
      else {
        const p = Math.max(FLOOR, sb - sa), ta = da * (1 - 2 * sa), tb = db * (1 - 2 * sb);
        const pz = db - da, pc = db + da;
        ll += Math.log(p);
        gz = pz / p; gc = pc / p;
        hzz = (tb - ta) / p - gz * gz; hzc = (tb + ta) / p - gz * gc; hcc = (tb - ta) / p - gc * gc;
      }
      // Chain rule: ∂z/∂β_j = x_j, ∂z/∂h = home, ∂c/∂c = 1.
      const dz = [...row.x, row.home, 0], dc = [...new Array(k + 1).fill(0), 1];
      for (let i = 0; i < dim; i++) {
        grad[i] += gz * dz[i] + gc * dc[i];
        for (let j = 0; j < dim; j++) hess[i][j] += hzz * dz[i] * dz[j] + hzc * (dz[i] * dc[j] + dc[i] * dz[j]) + hcc * dc[i] * dc[j];
      }
    }
    for (let i = 0; i < C; i++) { ll -= ridge * t[i] ** 2 / 2; grad[i] -= ridge * t[i]; hess[i][i] -= ridge; }
    return { ll, grad, hess };
  };
  let current = evaluate(theta), iterations = 0, converged = false;
  while (iterations++ < maxIterations) {
    const step = solve(current.hess.map(line => line.map(v => -v)), current.grad);
    if (!step) break;
    let scale = 1, next = null, candidate;
    for (let halvings = 0; halvings < 40; halvings++, scale /= 2) {
      candidate = theta.map((v, i) => v + scale * step[i]);
      const trial = evaluate(candidate);
      if (trial.ll >= current.ll - 1e-12) { next = trial; break; }
    }
    if (!next) break;
    const moved = Math.max(...step.map(v => Math.abs(v * scale)));
    theta = candidate; current = next;
    if (moved < 1e-10) { converged = true; break; }
  }
  const { beta, h, c } = unpack(theta);
  return { beta, h, c, nll: -current.ll / rows.length, iterations, converged };
}

// ---- scoring rules ----
/** Log loss (natural log), ranked probability score over home < draw < away, and the three-outcome Brier score. */
export function scoreForecast(p, outcome) {
  const y = [0, 1, 2].map(k => (k === outcome ? 1 : 0));
  const c1 = p[0] - y[0], c2 = p[0] + p[1] - y[0] - y[1];
  return { logLoss: -Math.log(Math.max(FLOOR, p[outcome])) + 0, rps: (c1 * c1 + c2 * c2) / 2,
    brier: p.reduce((sum, v, k) => sum + (v - y[k]) ** 2, 0) };
}
export function meanScores(predictions, outcomes, index = predictions.map((_, i) => i)) {
  if (!index.length) return { n: 0, logLoss: null, rps: null, brier: null };
  const sum = { logLoss: 0, rps: 0, brier: 0 };
  for (const i of index) { const s = scoreForecast(predictions[i], outcomes[i]); sum.logLoss += s.logLoss; sum.rps += s.rps; sum.brier += s.brier; }
  return { n: index.length, logLoss: sum.logLoss / index.length, rps: sum.rps / index.length, brier: sum.brier / index.length };
}

// ---- resampling ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Per-cluster { sum, n } of `values` (keys parallel to values), in sorted key order. */
function clusterSums(values, keys) {
  const groups = new Map();
  values.forEach((value, i) => { const g = groups.get(keys[i]) || { sum: 0, n: 0 }; g.sum += value; g.n++; groups.set(keys[i], g); });
  return [...groups.entries()].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0)).map(([, g]) => g);
}
/**
 * Delete-one-cluster jackknife SE of the pooled mean of `values`: √((G − 1)/G · Σ_g (θ₋g − θ̄)²), where θ₋g is
 * the mean without cluster g and θ̄ the mean of the θ₋g. Needs two clusters.
 */
export function clusterJackknifeSe(values, keys) {
  const list = clusterSums(values, keys), G = list.length;
  if (G < 2) return { se: null, clusters: G };
  const sum = list.reduce((s, g) => s + g.sum, 0), n = list.reduce((s, g) => s + g.n, 0);
  const without = list.map(g => (sum - g.sum) / (n - g.n)), mean = without.reduce((s, v) => s + v, 0) / G;
  return { se: Math.sqrt((G - 1) / G * without.reduce((s, v) => s + (v - mean) ** 2, 0)), clusters: G };
}
/** Clustered SE with its method: the seeded block bootstrap, or the jackknife below FORECAST.jackknifeBelowClusters clusters. */
export function clusteredSe(values, keys, options = {}) {
  const clusters = new Set(keys).size;
  return clusters < FORECAST.jackknifeBelowClusters ? { ...clusterJackknifeSe(values, keys), method: 'cluster jackknife' }
    : { ...clusterBootstrapSe(values, keys, options), method: 'cluster bootstrap' };
}
/** P(|T| ≤ t) for Student's t on a whole number of degrees of freedom (Abramowitz & Stegun 26.7.3 and 26.7.4). */
export function studentTCentral(t, df) {
  if (!Number.isInteger(df) || df < 1) throw new Error('studentTCentral needs whole degrees of freedom ≥ 1');
  const theta = Math.atan(Math.abs(t) / Math.sqrt(df)), s = Math.sin(theta), c2 = Math.cos(theta) ** 2;
  // Odd: (2/π)(θ + sin θ·(cos θ + (2/3)cos³θ + …)); even: sin θ·(1 + (1/2)cos²θ + (1·3)/(2·4)cos⁴θ + …), to cos^(df−2)θ.
  let term = df % 2 ? Math.cos(theta) : 1, sum = df === 1 ? 0 : term;
  for (let k = df % 2 ? 2 : 1; k <= df - 3; k += 2) { term *= c2 * k / (k + 1); sum += term; }
  return df % 2 ? (2 / Math.PI) * (theta + s * sum) : s * sum;
}
/** Two-sided critical value: the `level` quantile of Student's t on df degrees of freedom (12.706 at 0.975 and 1 df). */
export function studentTQuantile(level, df) {
  if (!(level > 0.5 && level < 1)) throw new Error('studentTQuantile takes a level in (0.5, 1)');
  let lo = 0, hi = 1;
  while (studentTCentral(hi, df) < 2 * level - 1) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) { const mid = (lo + hi) / 2; if (studentTCentral(mid, df) < 2 * level - 1) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** SE of the mean of `values` from a seeded bootstrap that resamples whole clusters (keys parallel to values). */
export function clusterBootstrapSe(values, keys, { resamples = FORECAST.bootstrap.resamples, seed = FORECAST.bootstrap.seed } = {}) {
  const list = clusterSums(values, keys);
  if (list.length < 2) return { se: null, clusters: list.length };
  const rng = mulberry32(seed), means = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0, n = 0;
    for (let i = 0; i < list.length; i++) { const g = list[Math.floor(rng() * list.length)]; sum += g.sum; n += g.n; }
    means.push(sum / n);
  }
  const mean = means.reduce((s, v) => s + v, 0) / means.length;
  return { se: Math.sqrt(means.reduce((s, v) => s + (v - mean) ** 2, 0) / (means.length - 1)), clusters: list.length };
}
const naiveSe = values => {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) / values.length);
};

/** Z scores over the given ids: (v − mean) / population SD. */
export function standardise(values, ids) {
  const xs = ids.map(id => values[id]);
  if (xs.some(v => !Number.isFinite(v))) throw new Error('standardise: every id needs a finite value');
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
  if (!(sd > 0)) throw new Error('standardise: the values are constant');
  return { z: Object.fromEntries(ids.map(id => [id, (values[id] - mean) / sd])), mean, sd };
}

/** Out-of-fold probabilities for every row; foldOfRow holds each row's fold (match window index mod folds). */
export function crossValidate(rows, k, foldOfRow, folds) {
  const predictions = new Array(rows.length), params = [];
  for (let f = 0; f < folds; f++) {
    const train = rows.filter((_, i) => foldOfRow[i] !== f), test = rows.map((_, i) => i).filter(i => foldOfRow[i] === f);
    if (!test.length) continue;
    const fit = fitOrderedLogit(train, k);
    params.push({ fold: f, trainMatches: train.length, testMatches: test.length, beta: fit.beta.map(round4), h: round4(fit.h), c: round4(fit.c), converged: fit.converged });
    for (const i of test) predictions[i] = predict(fit, rows[i]);
  }
  return { predictions, params };
}

const MODELS = [
  { id: 'baseRates', label: 'Home advantage and draw rate only (β = 0)', features: [] },
  { id: 'roster', label: 'Roster strength T_n of this season', features: ['roster'] },
  { id: 'eloAtR', label: 'World Football Elo frozen at R_Y', features: ['elo'] },
  { id: 'eloPlusRoster', label: 'Elo at R_Y plus roster strength', features: ['elo', 'roster'] },
];
const summary = scores => ({ n: scores.n, logLoss: round4(scores.logLoss), rps: round4(scores.rps), brier: round4(scores.brier) });

/**
 * The margin's multiplier on the larger clustered SE: FORECAST.seMultiplier, or with fewer than
 * FORECAST.jackknifeBelowClusters clusters (G, the fewer of match windows and team pairs) the two-sided 95% Student
 * t critical value on G − 1 degrees of freedom, which widens the margin for an SE estimated from few clusters.
 */
export function criticalValue(clusters) {
  if (clusters >= FORECAST.jackknifeBelowClusters || clusters < 2) return { critical: FORECAST.seMultiplier,
    criticalRule: `${FORECAST.seMultiplier}·SE: ${clusters} clusters, at least ${FORECAST.jackknifeBelowClusters}` };
  const critical = studentTQuantile(FORECAST.criticalLevel, clusters - 1);
  return { critical, criticalRule: `t(${clusters - 1}) = ${round4(critical)} in place of ${FORECAST.seMultiplier}: ${clusters} clusters, fewer than ${FORECAST.jackknifeBelowClusters}, so the SE is a cluster jackknife` };
}

/**
 * Whether results.csv covers the window (from, to]: its pinned commit ({ sha, date }) is dated after `to`, or it
 * holds a match dated on or after `to`. Otherwise the window is partial: a verdict on it stands but rests on
 * (from, lastMatchDate] and is re-scored once results.csv covers `to`.
 */
export function windowCoverage({ from, to, lastMatchDate, commit = null }) {
  const commitDate = commit?.date ? String(commit.date).slice(0, 10) : null, short = commit?.sha ? commit.sha.slice(0, 7) : null;
  const byMatch = !!lastMatchDate && lastMatchDate >= to, byCommit = !!commitDate && commitDate > to;
  const at = commit ? `commit ${short} of ${commitDate}` : 'no recorded commit';
  const base = { lastMatchDate, commit, rule: 'covered when the results commit is dated after R_next or a match is dated on or after R_next' };
  if (byMatch || byCommit) return { ...base, complete: true, partial: false, covered: { from, to },
    note: byMatch ? `results.csv (${at}) has a match dated ${lastMatchDate}, on or after ${to}, so it covers the whole window`
      : `results.csv is at ${at}, after ${to}, so it covers the whole window (last match ${lastMatchDate})` };
  const coveredTo = lastMatchDate && lastMatchDate > from ? lastMatchDate : from;
  return { ...base, complete: false, partial: true, covered: { from, to: coveredTo },
    note: `results.csv (${at}) ends ${lastMatchDate || 'before the window'}, so matches from ${addDays(coveredTo, 1)} to ${to} are not scored yet: the verdict rests on the partial window (${from}, ${coveredTo}] and must be re-scored when results.csv covers ${to}` };
}

/**
 * The matches of the window (from, to] (played: matches with scores): both teams resolved to map nations, split into
 * the gate and the matches with an excluded-status nation. Returns { lastMatchDate, inWindow, gate, excluded, offMap,
 * unknownNames: Map name -> rows }.
 */
function windowMatches({ from, to, played, lastMatchDate = null, season, resolveName, excludedStatuses }) {
  const last = lastMatchDate ?? played.reduce((max, match) => (match.date > max ? match.date : max), '');
  const inWindow = played.filter(match => match.date > from && match.date <= to);
  const unknownNames = new Map(), excluded = [], gate = [];
  let offMap = 0;
  for (const match of inWindow) {
    const home = resolveName(match.home), away = resolveName(match.away);
    const unknown = [home === undefined && match.home, away === undefined && match.away].filter(Boolean);
    for (const name of unknown) unknownNames.set(name, (unknownNames.get(name) || 0) + 1);
    if (!home || !away) { if (!unknown.length) offMap++; continue; }
    const status = [season.nationStatus?.[home], season.nationStatus?.[away]].filter(s => excludedStatuses.includes(s));
    (status.length ? excluded : gate).push({ ...match, homeId: home, awayId: away });
  }
  return { lastMatchDate: last, inWindow, gate, excluded, offMap, unknownNames };
}

/**
 * Paired per-match log-loss difference a − b with the gate's errors: clustered by match window and, separately, by
 * team pair, the larger SE used, and the margin's multiplier from criticalValue on the fewer clusters.
 */
function pairedDifference(la, lb, windowKeys, pairKeys, seedOffset) {
  const d = la.map((v, i) => v - lb[i]);
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const byWindow = clusteredSe(d, windowKeys, { seed: FORECAST.bootstrap.seed + seedOffset });
  const byPair = clusteredSe(d, pairKeys, { seed: FORECAST.bootstrap.seed + seedOffset + 1 });
  const se = Math.max(byWindow.se ?? 0, byPair.se ?? 0);
  const { critical, criticalRule } = criticalValue(Math.min(byWindow.clusters, byPair.clusters));
  return { raw: { mean, se, critical }, summary: { meanDifference: round4(mean),
    seByMatchWindow: round4(byWindow.se), seMethodByMatchWindow: byWindow.method, matchWindows: byWindow.clusters,
    seByTeamPair: round4(byPair.se), seMethodByTeamPair: byPair.method, teamPairs: byPair.clusters, sePerMatch: round4(naiveSe(d)), se: round4(se),
    seUsed: (byWindow.se ?? 0) >= (byPair.se ?? 0) ? 'match window' : 'team pair', critical: round4(critical), criticalRule } };
}

/**
 * The forecast record of one season.
 * season: { id, ratingsDate, informationDate, nationStatus }; nextSeason: the next newer season or null (open window).
 * results: { matches (parseResults), lastMatchDate, commit: { sha, date } | null } or null. strength: NATIONS id → T_n.
 * A record with missingInputs: true lacks results.csv or Elo at R_Y (a cache problem, not a verdict). A closed
 * window's record carries partial: true when results.csv does not cover R_next (windowCoverage); its verdict stands.
 * elo: eloAtRatingsDate() at R_Y (ratings Map by Elo code, reasons) or null; codes: NATIONS id → Elo code.
 * resolveName: results name → NATIONS id, null (off-map) or undefined (unknown).
 */
export function forecastTrack({ season, nextSeason, results, strength, elo, codes, nationIds, resolveName, excludedStatuses = ['suspended', 'non-member'] }) {
  const from = season.informationDate, to = nextSeason?.informationDate ?? null;
  const base = { window: { from, to, rule: '(R_Y, R_next]: after this season\'s informationDate, up to and including the next newer season\'s' } };
  const played = results?.matches?.filter(match => match.homeScore != null && match.awayScore != null) ?? null;
  const classify = match => {
    const home = resolveName(match.home), away = resolveName(match.away);
    return { home, away, unknown: [home === undefined && match.home, away === undefined && match.away].filter(Boolean) };
  };
  if (!to) {
    const sofar = played?.filter(match => match.date > from).filter(match => { const c = classify(match); return c.home && c.away; }).length ?? null;
    return { verdict: 'not scored', ...base, mappedMatchesSoFar: sofar, lastMatchDate: results?.lastMatchDate ?? null,
      reasons: [`The window after ${from} is open until a newer season records its informationDate, so this season is not scored yet`] };
  }
  const reasons = [];
  if (!(to > from)) reasons.push(`The next season's informationDate ${to} is not after ${from}`);
  if (!played) return { verdict: 'incomplete', ...base, missingInputs: true, reasons: [...reasons, 'results.csv is not cached'] };
  if (!elo?.ratings || elo.reasons?.length) return { verdict: 'incomplete', ...base, missingInputs: true,
    reasons: [...reasons, `No verified Elo at R_Y ${from}`, ...(elo?.reasons ?? [])] };

  const { lastMatchDate, inWindow, gate, excluded, offMap, unknownNames } = windowMatches({ from, to, played,
    lastMatchDate: results.lastMatchDate, season, resolveName, excludedStatuses });
  if (unknownNames.size) reasons.push(`${unknownNames.size} team name(s) in the window are in neither RESULTS_NAMES nor OFF_MAP_RESULTS_NAMES: ${[...unknownNames.keys()].sort().join(', ')}`);

  const roster = standardise(strength, nationIds);
  const eloValues = Object.fromEntries(nationIds.map(id => [id, elo.ratings.get(codes[id])]));
  const withoutElo = nationIds.filter(id => !Number.isFinite(eloValues[id]));
  if (withoutElo.length) reasons.push(`${withoutElo.length} nations lack Elo at R_Y: ${withoutElo.join(', ')}`);
  const eloZ = withoutElo.length ? null : standardise(eloValues, nationIds);
  const { clusters: windows, clusterOf } = matchClusters(gate);
  if (gate.length < FORECAST.minMatches) reasons.push(`${gate.length} gate matches; the gate needs at least ${FORECAST.minMatches}`);
  if (windows.length < FORECAST.minWindows) reasons.push(`${windows.length} match window(s); cross-validation needs at least ${FORECAST.minWindows}`);
  const coverage = windowCoverage({ from, to, lastMatchDate, commit: results.commit ?? null });
  const counts = { inWindow: inWindow.length, offMap, unknownNames: [...unknownNames.values()].reduce((s, v) => s + v, 0), excludedStatus: excluded.length, gate: gate.length };
  const partial = { partial: coverage.partial };
  if (reasons.length) return { verdict: 'incomplete', ...base, ...partial, coverage, counts, reasons };

  const feature = { roster: id => roster.z[id], elo: id => eloZ.z[id] };
  const rowsFor = (matches, model) => matches.map(match => ({ x: model.features.map(f => feature[f](match.homeId) - feature[f](match.awayId)),
    home: match.neutral ? 0 : 1, outcome: outcomeOf(match) }));
  const { k: folds, foldOf } = groupFolds(windows);
  const foldOfRow = clusterOf.map(index => foldOf[index]);
  const outcomes = gate.map(outcomeOf);
  const friendly = gate.map((match, i) => (match.tournament === 'Friendly' ? i : -1)).filter(i => i >= 0);
  const competitive = gate.map((match, i) => (match.tournament !== 'Friendly' ? i : -1)).filter(i => i >= 0);
  const models = {}, oof = {};
  for (const model of MODELS) {
    const rows = rowsFor(gate, model), cv = crossValidate(rows, model.features.length, foldOfRow, folds);
    oof[model.id] = cv.predictions;
    const full = fitOrderedLogit(rows, model.features.length);
    const scores = meanScores(cv.predictions, outcomes);
    models[model.id] = { label: model.label, features: model.features, ...summary(scores),
      competitive: summary(meanScores(cv.predictions, outcomes, competitive)), friendlies: summary(meanScores(cv.predictions, outcomes, friendly)),
      fitAllMatches: { beta: full.beta.map(round4), h: round4(full.h), c: round4(full.c), converged: full.converged }, folds: cv.params,
      ...(excluded.length && model.features.length ? { excludedStatusMatches: summary(meanScores(rowsFor(excluded, model).map(row => predict(full, row)), excluded.map(outcomeOf))) } : {}) };
  }
  const lossOf = id => gate.map((_, i) => scoreForecast(oof[id][i], outcomes[i]).logLoss);
  const windowKeys = clusterOf;
  const pairKeys = gate.map(match => [match.homeId, match.awayId].sort().join('-'));
  const paired = (a, b, seedOffset) => pairedDifference(lossOf(a), lossOf(b), windowKeys, pairKeys, seedOffset);
  const rosterVsElo = paired('roster', 'eloAtR', 0), combinedVsElo = paired('eloPlusRoster', 'eloAtR', 10);
  const margin = rosterVsElo.raw.critical * rosterVsElo.raw.se;
  // The model is symmetric in the sign of β: a reversed ranking fits a negative
  // β and can still score well, so the roster must also point the right way.
  const rosterBeta = models.roster.fitAllMatches.beta[0];
  const lossOk = rosterVsElo.raw.mean <= margin, signOk = rosterBeta > 0;
  const pass = lossOk && signOk;
  const share = predicate => round4(gate.filter(predicate).length / gate.length);
  const yearEnd = addDays(season.ratingsDate, 365);
  const ratingsYear = new Set(played.filter(match => match.date > season.ratingsDate && match.date <= yearEnd)
    .filter(match => { const c = classify(match); return c.home && c.away; }).map(match => `${match.date}|${match.home}|${match.away}`));
  const scored = new Set(inWindow.filter(match => { const c = classify(match); return c.home && c.away; }).map(match => `${match.date}|${match.home}|${match.away}`));
  return {
    verdict: pass ? 'pass' : 'fail', ...base, ...partial, coverage, counts,
    matchWindows: windows.map(w => ({ ...w, fold: foldOf[w.index] })),
    method: `${folds}-fold cross-validation grouped by match window (k = min(${FORECAST.folds}, ${windows.length} windows); each finals tournament is a window, friendlies, qualifiers and Nations Leagues split at date gaps over ${FORECAST.windowGapDays} days; windows go whole, largest first, to the fold with the fewest matches), every match scored out of fold.`,
    outcomeShares: { home: share(m => outcomeOf(m) === 0), draw: share(m => outcomeOf(m) === 1), away: share(m => outcomeOf(m) === 2),
      neutral: share(m => m.neutral), friendlies: share(m => m.tournament === 'Friendly') },
    strengthScale: { roster: { mean: round4(roster.mean), sd: round4(roster.sd) }, note: 'Z = (value − mean) / population SD over every nation fielding a side; Elo scale stays offline' },
    models,
    rosterVsElo: { ...rosterVsElo.summary, gate: `roster log loss ≤ Elo-at-R_Y log loss + ${round4(rosterVsElo.raw.critical)}·SE, and roster β > 0`, margin: round4(margin), rosterBeta, pass },
    eloPlusRosterVsElo: combinedVsElo.summary,
    excludedStatusMatches: { n: excluded.length, nations: [...new Set(excluded.flatMap(m => [m.homeId, m.awayId]).filter(id => excludedStatuses.includes(season.nationStatus?.[id])))].sort(),
      note: 'Matches with a suspended or non-member nation: out of the gate, scored with the all-matches fit' },
    matchesLost: { comparedWith: [season.ratingsDate, yearEnd], ratingsYearMatches: ratingsYear.size,
      lost: [...ratingsYear].filter(key => !scored.has(key)).length, gained: [...scored].filter(key => !ratingsYear.has(key)).length,
      note: 'Matches between nations fielding a side (excluded-status nations included) in (D_Y, D_Y + 365] against those in (R_Y, R_next], as far as results.csv reaches' },
    reasons: [
      ...(lossOk ? [] : [`Roster log loss ${models.roster.logLoss} exceeds Elo-at-R_Y log loss ${models.eloAtR.logLoss} by ${round4(rosterVsElo.raw.mean)}, more than ${round4(rosterVsElo.raw.critical)}·SE = ${round4(margin)}`]),
      ...(signOk ? [] : [`Roster β is ${rosterBeta}: stronger rosters are not predicted to win`]),
    ],
  };
}
