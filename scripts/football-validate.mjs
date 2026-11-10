// The football squad gate (docs/design/football-squad-gate.md): checks the national XIs of the seasons
// scripts/data/football-gate.json lists against real results. Writes docs/design/football-gate/validation.json.
//
//   npm run validate:football                       scores every season and writes the report
//   npm run validate:football -- --check            recomputes and exits 1 when the committed report differs
//   npm run validate:football -- --offline          never fetches; uses the cached Elo files only
//   npm run validate:football -- --output=<file>    writes elsewhere (the committed report stays)
//   npm run validate:football -- --allow-incomplete writes a report although inputs are missing
//
// Seasons: the built-in one (src/data/rosters.js, EA FC 27 + FM 26) and the 2025/26 season file (EA FC 26). For each
// season, over the nations that field a side in it (footballSets.js fieldedNations):
// - Provisional gate: build checks from the shipped data (every fielded nation listed, ratings 1–99, the built-in's XIs
//   all 11 strong), Spearman of XI strength against World Football Elo at the season's ratingsDate (D_Y) on the gate
//   set, at least GATE.spearmanMin, and the EA−FM linking mean from the built-in's audit, at most GATE.linkingMaxAbsMean
//   (a season without FM records has nothing to link: not applicable).
// - Full ship gate: the provisional gate, the linking check rerun on Reep-linked pairs, the forecast gate
//   (scripts/lib/forecast.mjs: martj42 results in (R_Y, R_next] between nations fielding a side, roster strength against
//   Elo frozen at R_Y, log loss no worse than Elo's by more than 2 clustered SE; the newest season's window is open, so
//   it is 'not scored'), the engine-scale gate (docs/design/football-gate/engine-scale.json, npm run
//   engine-scale:football, the built-in only) and the incomplete XIs listed in the audit.
// On main every season ships by choice, so the verdicts are a report, not a gate on shipping: a built-in that fails the
// provisional gate is the signal to look before a rollover ships it (the run exits 1).
//
// Elo is eloratings.net's static TSVs, cached once in the ignored data-src/validation/elo/ (a handful of GETs, only for
// missing files, through scripts/lib/polite-fetch.mjs: robots.txt first, the generic User-Agent) and never shipped:
// the report carries aggregates and ranks, no Elo values. Elo at D_Y replays {Y}_results.tsv (post-match ratings) over
// year-end {Y-1}.tsv through matches dated on or before D_Y; replaying the whole file must reproduce {Y}.tsv exactly,
// and a replay without that check (table not cached, a mismatch, or a table from another snapshot) is incomplete. One
// rule decides whether a snapshot stands for D_Y: it was taken on D_Y or later, never before. A results file meets it
// with a match dated on or after D_Y, or with a trusted fetch date on or after D_Y. World.tsv stands in only when no
// replay covers D_Y, and needs a trusted fetch date from D_Y to D_Y + 7 days. Elo frozen at R_Y, the forecast baseline,
// follows the same rules except that World.tsv must be fetched on R_Y itself: a later World.tsv has absorbed results of
// matches the forecast gate scores (leakage). sources.json records each cached file's sha256, fetch date and dateFrom;
// only an actual fetch gives a trusted date, or --trust-seed-dates vouches for a seeded file's mtime. In an open year
// {Y}.tsv is the live table, so {Y}_results.tsv and {Y}.tsv are one snapshot only when both were fetched after year Y
// closed or within 10 minutes of each other.
// results.csv is martj42's (CC0), the file scripts/data/football-gate.json pins by SHA-256, read from the ignored
// data-src/martj42-results/ (as npm run sync:world-cup-seasons reads it); nothing downloads it here. A closed window is
// covered when the pinned commit is dated after R_next or a match is dated on or after it; otherwise the forecast verdict
// stands but is partial and is re-scored once a later results.csv is pinned. Output depends only on the repo, the cached
// files with their sources.json records and --generated-at, so reruns are byte-identical.
//
// Ported on 2026-11-10 from the squad-years work (claude/football-rating-strategy-ef71dc, scripts/football-validate.mjs),
// which gated a squad-year picker main never took: main's Season choice ships every season.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ELO_CODES } from './lib/elo-codes.mjs';
import { FORECAST, forecastTrack, parseResults } from './lib/forecast.mjs';
import { createPoliteFetch } from './lib/polite-fetch.mjs';
import { nationForResultsName } from './lib/results-names.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// worldMaxDays bounds World.tsv at D_Y (the cross-sectional truth, which scores no matches); worldMaxDaysAtR at R_Y
// (the forecast baseline, whose later matches are scored, so a later snapshot would leak them).
export const GATE = { spearmanMin: 0.9, linkingMaxAbsMean: 1, worldMaxDays: 7, worldMaxDaysAtR: 0, excludedStatuses: ['suspended', 'non-member'] };
export const SHIP_GATE = { reepLinkingMaxAbsMean: 1 };
export const MANIFEST_FILE = 'scripts/data/football-gate.json';
export const VALIDATION_FILE = 'docs/design/football-gate/validation.json';
export const ENGINE_SCALE_FILE = 'docs/design/football-gate/engine-scale.json';
export const BUILT_IN_AUDIT = 'docs/design/football-roster-audit.json';
export const BUILT_IN_ROSTERS = 'src/data/rosters.js';
export const ELO_BASE = 'https://www.eloratings.net/';
export const CONFEDERATIONS = ['UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'OFC'];
export const NOT_APPLICABLE = 'not applicable';
const BOOTSTRAP = { resamples: 2000, seed: 20250919 };
const FETCH_DELAY_MS = 1500;
// {Y}_results.tsv and a live {Y}.tsv fetched further apart are not one snapshot.
const PAIR_MAX_MS = 10 * 60000;
const TRUST_FLAG = '--trust-seed-dates';
const VOUCHED = `, vouched by ${TRUST_FLAG}`;
/** A fetch date counts for D_Y only when this script fetched the file, or --trust-seed-dates vouched for its mtime. */
const trustedDate = file => file?.dateFrom === 'fetch' || String(file?.dateFrom ?? '').endsWith(VOUCHED);
const round4 = value => value == null || !Number.isFinite(value) ? null : Math.round(value * 1e4) / 1e4;
const dateOf = iso => String(iso || '').slice(0, 10);
const daysBetween = (a, b) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- statistics ----
/** 1-based ranks, ascending; tied values share the average of their ranks. */
export function ranks(values) {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) result[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return result;
}
/** Pearson r, or null when fewer than two pairs or either side is constant. */
export function pearson(x, y) {
  if (x.length !== y.length) throw new Error('pearson: vectors differ in length');
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((sum, v) => sum + v, 0) / n, my = y.reduce((sum, v) => sum + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
export const spearman = (x, y) => pearson(ranks(x), ranks(y));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
/** Seeded nation-resample bootstrap of Spearman: [2.5%, 97.5%]. */
export function bootstrapSpearman(x, y, { resamples = BOOTSTRAP.resamples, seed = BOOTSTRAP.seed } = {}) {
  const rng = mulberry32(seed), draws = [];
  for (let b = 0; b < resamples; b++) {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) { const k = Math.floor(rng() * x.length); xs.push(x[k]); ys.push(y[k]); }
    const rho = spearman(xs, ys);
    if (rho != null) draws.push(rho);
  }
  if (!draws.length) return null;
  draws.sort((a, b) => a - b);
  return [round4(quantile(draws, 0.025)), round4(quantile(draws, 0.975))];
}

// ---- eloratings.net TSVs ----
// Ratings use U+2212 for minus and a leading + on changes.
const eloNumber = text => Number(String(text ?? '').trim().replace(/^−/, '-').replace(/^\+/, ''));
/** World.tsv / YYYY.tsv: column 3 is the team code, column 4 the rating. */
export function parseEloTable(text) {
  const table = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const cells = line.split('\t'), code = cells[2], rating = eloNumber(cells[3]);
    if (!code || !Number.isFinite(rating)) throw new Error(`Elo table line ${index + 1} is malformed`);
    table.set(code, rating);
  }
  return table;
}
/** YYYY_results.tsv: y, m, d, home, away, goals ×2, tournament, venue, exchange, home and away rating after the match, … */
export function parseEloResults(text) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const row = { date: `${cells[0]}-${cells[1]}-${cells[2]}`, home: cells[3], away: cells[4],
      homeAfter: eloNumber(cells[10]), awayAfter: eloNumber(cells[11]) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.home || !row.away || !Number.isFinite(row.homeAfter) || !Number.isFinite(row.awayAfter))
      throw new Error(`Elo results line ${index + 1} is malformed`);
    rows.push(row);
  }
  return rows;
}
/** Ratings after every match dated on or before `date` (all matches when omitted), in date order, file order within a day. */
export function replayElo(base, results, date = null) {
  const ratings = new Map(base);
  let matches = 0, lastMatchDate = null;
  for (const row of results.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (date && row.date > date) break;
    ratings.set(row.home, row.homeAfter);
    ratings.set(row.away, row.awayAfter);
    matches++;
    lastMatchDate = row.date;
  }
  return { ratings, matches, lastMatchDate };
}
/** Files that rebuild Elo at `ratingsDate`: year-end Y−1, year-Y results, and Y (year-end, or current table in an open year) as the check. */
export function replayFiles(ratingsDate) {
  const year = Number(String(ratingsDate).slice(0, 4));
  return { base: `${year - 1}.tsv`, results: `${year}_results.tsv`, check: `${year}.tsv` };
}
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
/** {Y}_results.tsv and {Y}.tsv agree as one snapshot: both fetched after year Y closed (year-end files are static), or within PAIR_MAX_MS. */
export function sameSnapshot(year, a, b) {
  if (!a || !b) return false;
  const closed = file => dateOf(file.fetchedAt) > `${year}-12-31`;
  const gap = Math.abs(Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
  return (closed(a) && closed(b)) || gap <= PAIR_MAX_MS;
}
/** Whether a results file stands for D_Y: { completeBy } from a match dated on or after D_Y or a trusted fetch on or after it, else { reason }. */
function resultsCover(ratingsDate, name, file) {
  const last = parseEloResults(file.text).reduce((max, row) => (row.date > max ? row.date : max), '');
  if (last >= ratingsDate) return { completeBy: `match dated ${last}` };
  const fetched = dateOf(file.fetchedAt);
  if (trustedDate(file) && fetched >= ratingsDate) return { completeBy: `fetched ${fetched} (${file.dateFrom})` };
  return { reason: trustedDate(file) ? `${name} was fetched on ${fetched}, before ${ratingsDate}, and has no match dated on or after it`
    : `${name} has no match dated on or after ${ratingsDate} (last ${last || 'none'}) and its date ${fetched} is a ${file.dateFrom ?? 'date of unknown origin'}, which counts only with ${TRUST_FLAG}` };
}
const canReplay = (ratingsDate, files) => {
  const names = replayFiles(ratingsDate), results = files.get(names.results);
  return validDate(ratingsDate) && files.has(names.base) && !!results && !resultsCover(ratingsDate, names.results, results).reason;
};

/**
 * Elo at a season's ratingsDate from cached files (Map name → { text, url, fetchedAt, dateFrom, sha256 }).
 * Returns { method: 'replay' | 'world' | null, date, ratings, files, …, reasons }; a replay with reasons is unverified.
 * worldMaxDays bounds how long after the date World.tsv may be fetched; scoredAfter names what is scored after the
 * date (the forecast window at R_Y), so a later World.tsv would leak those results and is refused by that name.
 */
export function eloAtRatingsDate(ratingsDate, files, { worldMaxDays = GATE.worldMaxDays, scoredAfter = null } = {}) {
  const reasons = [];
  if (!validDate(ratingsDate)) return { method: null, date: null, ratings: null, files: [], reasons: [`ratingsDate ${ratingsDate} is not YYYY-MM-DD`] };
  const names = replayFiles(ratingsDate), year = Number(ratingsDate.slice(0, 4)), results = files.get(names.results);
  const cover = results ? resultsCover(ratingsDate, names.results, results) : null;
  const refetchPair = `delete ${names.results} and ${names.check} to refetch them together`;
  if (files.has(names.base) && cover && !cover.reason) {
    const base = parseEloTable(files.get(names.base).text), rows = parseEloResults(results.text), table = files.get(names.check);
    const atDate = replayElo(base, rows, ratingsDate);
    const used = [names.base, names.results];
    let check = null;
    if (!table) reasons.push(`${names.check} is not cached, so the replay is unverified; fetch or seed it together with ${names.results}`);
    else if (!sameSnapshot(year, results, table)) {
      used.push(names.check);
      check = { file: names.check, skipped: `${names.results} and ${names.check} are not one snapshot` };
      reasons.push(`${names.results} (${dateOf(results.fetchedAt)}) and ${names.check} (${dateOf(table.fetchedAt)}) were not fetched together while ${year} was open, so ${names.check} cannot check the replay; ${refetchPair}`);
    } else {
      const expected = parseEloTable(table.text), full = replayElo(base, rows).ratings;
      const mismatched = [...expected].filter(([code, rating]) => full.get(code) !== rating).map(([code]) => code).sort();
      check = { file: names.check, teams: expected.size, exact: expected.size - mismatched.length, mismatched: mismatched.slice(0, 10) };
      used.push(names.check);
      if (mismatched.length) reasons.push(`Replaying ${names.results} over ${names.base} does not reproduce ${names.check} (${check.exact}/${check.teams} exact)`);
    }
    return { method: 'replay', date: ratingsDate, ratings: atDate.ratings, files: used, completeBy: cover.completeBy,
      matchesReplayed: atDate.matches, lastMatchOnOrBefore: atDate.lastMatchDate, check, reasons };
  }
  if (!files.has(names.base) || !results) reasons.push(`Replay needs ${names.base} and ${names.results}`);
  else reasons.push(`${cover.reason}; ${refetchPair}`);
  const world = files.get('World.tsv');
  if (world) {
    const fetched = dateOf(world.fetchedAt), days = daysBetween(fetched, ratingsDate);
    if (!trustedDate(world)) reasons.push(`World.tsv's date ${fetched} is a ${world.dateFrom ?? 'date of unknown origin'}, which counts only with ${TRUST_FLAG}; or delete it to refetch`);
    else if (days >= 0 && days <= worldMaxDays) return { method: 'world', date: fetched, ratings: parseEloTable(world.text),
      files: ['World.tsv'], daysFromRatingsDate: days, replayUnavailable: reasons, reasons: [] };
    else reasons.push(days < 0 ? `World.tsv was fetched on ${fetched}, ${-days} days before ${ratingsDate}, so it misses the matches up to it`
      : scoredAfter ? `World.tsv was fetched on ${fetched}, ${days} days after ${ratingsDate}, so it has seen results of ${scoredAfter} (leakage); `
        + `only a replay cut at ${ratingsDate} or a World.tsv fetched on ${ratingsDate} (limit ${worldMaxDays} days) can stand for it`
        : `World.tsv was fetched on ${fetched}, ${days} days after ${ratingsDate} (limit ${worldMaxDays})`);
  } else reasons.push('World.tsv is not cached');
  return { method: null, date: null, ratings: null, files: [], reasons };
}
/**
 * Elo frozen at R_Y, the forecast baseline: a replay cut at R_Y, or a World.tsv fetched on R_Y itself
 * (GATE.worldMaxDaysAtR). A World.tsv fetched later has already absorbed matches in (R_Y, R_next], the matches the
 * forecast gate scores, so it is refused and the forecast stays incomplete.
 */
export const eloAtInformationDate = (informationDate, files) => eloAtRatingsDate(informationDate, files,
  { worldMaxDays: GATE.worldMaxDaysAtR, scoredAfter: `matches the forecast gate scores after R_Y ${informationDate}` });

// ---- checks ----
/** Nations scored by the gate: everything except suspended and non-member nations. */
export function gateSet(ids, nationStatus = {}) {
  return ids.filter(id => !GATE.excludedStatuses.includes(nationStatus[id]));
}

/**
 * Build gates verifiable from the shipped data alone, over the nations fielding a side (`fielded`). The built-in's XIs
 * are all 11 strong (FM fills what EA lacks); a season file keeps thin XIs as they are, so its short XIs are listed,
 * not failed. `nations` is NATIONS.
 */
export function buildChecks({ season, rosters, nations, fielded, builtIn, contentHash = null }) {
  const ids = fielded.slice().sort(), failures = [];
  const missing = rosters ? ids.filter(id => !rosters[id]) : ids;
  const unknownIds = rosters ? Object.keys(rosters).filter(id => !nations[id]).sort() : [];
  const wrongShirtCount = [], shortXIs = [], badRatings = [], badStrength = [];
  for (const id of ids) {
    const entry = rosters?.[id];
    if (!entry) continue;
    const [strength, , players] = entry;
    const shirts = Array.isArray(players) ? players.length : 0;
    if (!Number.isFinite(strength)) badStrength.push(id);
    if (shirts > 11 || shirts < 1 || (builtIn && shirts !== 11)) wrongShirtCount.push({ id, shirts });
    else if (shirts < 11) shortXIs.push({ id, shirts });
    for (const player of Array.isArray(players) ? players : []) {
      const rating = player?.[2];
      if (!Number.isInteger(rating) || rating < 1 || rating > 99) badRatings.push({ id, player: player?.[0] ?? null, rating: rating ?? null });
    }
  }
  const badNationStatus = Object.entries(season.nationStatus || {})
    .filter(([id, status]) => !nations[id] || !GATE.excludedStatuses.includes(status)).map(([id, status]) => ({ id, status }));
  if (missing.length) failures.push(`${missing.length} fielded nations missing from the rosters`);
  if (unknownIds.length) failures.push(`${unknownIds.length} roster ids are not NATIONS ids`);
  if (wrongShirtCount.length) failures.push(`${wrongShirtCount.length} nations with ${builtIn ? 'other than 11' : 'no or more than 11'} shirts`);
  if (badRatings.length) failures.push(`${badRatings.length} ratings are not integers 1–99`);
  if (badStrength.length) failures.push(`${badStrength.length} strengths are not numbers`);
  if (badNationStatus.length) failures.push(`${badNationStatus.length} nationStatus entries are unknown ids or statuses`);
  if (!contentHash) failures.push('The squads have no content hash');
  return { verdict: failures.length ? 'fail' : 'pass', nations: ids.length - missing.length, fielded: ids.length,
    noTeam: Object.keys(nations).filter(id => !ids.includes(id)).sort(),
    missing, unknownIds, wrongShirtCount, shortXIs: shortXIs.length, badRatings: badRatings.slice(0, 20), badStrength, badNationStatus,
    contentHash, failures };
}

const correlation = (ids, x, y) => ({ n: ids.length, spearman: round4(spearman(ids.map(id => x[id]), ids.map(id => y[id]))),
  pearson: round4(pearson(ids.map(id => x[id]), ids.map(id => y[id]))) });
/** Rank 1 = strongest; ties share the average rank. */
const descendingRanks = (ids, values) => Object.fromEntries(ranks(ids.map(id => -values[id])).map((rank, i) => [ids[i], rank]));

/** Strength (rosters[id][0]) against Elo at D_Y over the fielded nations; the gate is Spearman on the gate set. */
export function crossSectional({ season, rosters, nations, fielded, elo, codes = ELO_CODES }) {
  const ids = fielded.slice().sort();
  if (!elo?.ratings) return { verdict: 'incomplete', reasons: ['No Elo at the ratings date', ...(elo?.reasons || [])] };
  const strength = {}, rating = {};
  for (const id of ids) {
    if (Number.isFinite(rosters?.[id]?.[0])) strength[id] = rosters[id][0];
    const value = elo.ratings.get(codes[id]);
    if (Number.isFinite(value)) rating[id] = value;
  }
  const missingStrength = ids.filter(id => !(id in strength)), missingElo = ids.filter(id => !(id in rating));
  const scored = ids.filter(id => id in strength && id in rating);
  const gate = gateSet(scored, season.nationStatus);
  const conf = id => nations[id][2];
  const byConfederation = Object.fromEntries(CONFEDERATIONS.map(c => [c, correlation(gate.filter(id => conf(id) === c), strength, rating)]));
  const weighted = Object.values(byConfederation).filter(row => row.spearman != null);
  const top50 = gate.slice().sort((a, b) => rating[b] - rating[a] || (a < b ? -1 : 1)).slice(0, 50);
  const eaOnly = gate.filter(id => Array.isArray(rosters[id][2]) && rosters[id][2].length === 11 && rosters[id][2].every(player => player?.[3]?.source === 'ea-fc'));
  // The gate compares the unrounded Spearman; the report rounds it to 4 decimals.
  const gateRho = spearman(gate.map(id => strength[id]), gate.map(id => rating[id]));
  const gateStats = { ...correlation(gate, strength, rating),
    spearmanCi95: bootstrapSpearman(gate.map(id => strength[id]), gate.map(id => rating[id])) };
  const strengthRank = descendingRanks(scored, strength), eloRank = descendingRanks(scored, rating);
  const row = id => ({ id, name: nations[id][0], confederation: conf(id), strength: strength[id],
    strengthRank: strengthRank[id], eloRank: eloRank[id], rankGap: eloRank[id] - strengthRank[id] });
  const gaps = gate.map(row).sort((a, b) => b.rankGap - a.rankGap || (a.id < b.id ? -1 : 1));
  const reasons = [];
  // A gate nation without a strength or an Elo rating leaves the gate unevaluated.
  const unscoredGate = gateSet(ids, season.nationStatus).filter(id => !scored.includes(id));
  if (unscoredGate.length) reasons.push(`${unscoredGate.length} gate nations lack a strength or an Elo rating`);
  // An unverified replay (no table, a mismatch, or a table from another snapshot) leaves the gate unevaluated.
  reasons.push(...(elo.reasons ?? []));
  if (gateRho == null) reasons.push('Gate-set Spearman is undefined');
  const verdict = reasons.length ? 'incomplete' : gateRho >= GATE.spearmanMin ? 'pass' : 'fail';
  if (verdict === 'fail') reasons.push(`Gate-set Spearman ${round4(gateRho) < GATE.spearmanMin ? round4(gateRho) : gateRho} is below ${GATE.spearmanMin}`);
  return {
    verdict, gateSet: gateStats,
    gateSetWithoutOfc: correlation(gate.filter(id => conf(id) !== 'OFC'), strength, rating),
    ofc: byConfederation.OFC,
    allNations: correlation(scored, strength, rating),
    withinConfederation: { weightedSpearman: round4(weighted.reduce((sum, r) => sum + r.spearman * r.n, 0) / weighted.reduce((sum, r) => sum + r.n, 0)),
      weighting: 'n-weighted mean of the per-confederation Spearman values over the gate set', byConfederation },
    top50ByElo: correlation(top50, strength, rating),
    eaOnlyXIs: { ...correlation(eaOnly, strength, rating), note: 'Gate nations whose 11 shirts are all EA FC players' },
    excludedNations: scored.filter(id => !gate.includes(id)).map(id => ({ ...row(id), status: season.nationStatus[id] })),
    missingStrength, missingElo,
    rankGaps: { note: 'Ranks among all scored nations (1 = strongest); rankGap = eloRank − strengthRank, so positive means the XI ranks above its Elo.',
      squadAboveElo: gaps.slice(0, 5), squadBelowElo: gaps.slice(-5).reverse() },
    reasons,
  };
}

/** Linking check from the built-in's audit: |mean(EA − FM)| ≤ 1 on same-person pairs; a season without FM has none. */
export function linkingCheck(audit, auditPath, { hasFm = true } = {}) {
  if (!hasFm) return { verdict: NOT_APPLICABLE, reasons: [], note: 'One source only: no EA and FM records of one person to compare' };
  const linking = audit?.linking, mean = linking?.meanEaMinusFm;
  if (!Number.isFinite(mean)) return { verdict: 'not available', source: auditPath,
    reasons: [audit ? `${auditPath} has no linking.meanEaMinusFm` : `${auditPath} is not present`] };
  const pass = Math.abs(mean) <= GATE.linkingMaxAbsMean;
  return { verdict: pass ? 'pass' : 'fail', source: auditPath, pairs: linking.pairs ?? null, meanEaMinusFm: mean, ci95: linking.ci95 ?? null,
    reasons: pass ? [] : [`|mean(EA − FM)| = ${Math.abs(mean)} exceeds ${GATE.linkingMaxAbsMean}`] };
}

/** Verdicts other than 'not applicable', which neither passes nor holds a gate. */
const applicable = verdicts => verdicts.filter(verdict => verdict !== NOT_APPLICABLE);
const overall = verdicts => (applicable(verdicts).includes('fail') ? 'fail' : applicable(verdicts).every(v => v === 'pass') ? 'pass' : 'incomplete');

/** Linking check rerun on Reep-linked pairs: the audit's linking.reep.meanEaMinusFm (npm run build-rosters). */
export function reepLinkingCheck(audit, auditPath, { hasFm = true } = {}) {
  if (!hasFm) return { verdict: NOT_APPLICABLE, reasons: [], note: 'One source only: no EA and FM records of one person to compare' };
  const reep = audit?.linking?.reep, mean = reep?.meanEaMinusFm;
  if (!Number.isFinite(mean)) return { verdict: 'not available', source: auditPath,
    reasons: [audit ? `${auditPath} has no linking.reep.meanEaMinusFm` : `${auditPath} is not present`] };
  const pass = Math.abs(mean) <= SHIP_GATE.reepLinkingMaxAbsMean;
  return { verdict: pass ? 'pass' : 'fail', source: auditPath, pairs: reep.pairs ?? null, meanEaMinusFm: mean, ci95: reep.ci95 ?? null,
    reasons: pass ? [] : [`Reep-linked |mean(EA − FM)| = ${Math.abs(mean)} exceeds ${SHIP_GATE.reepLinkingMaxAbsMean}`] };
}

/**
 * Incomplete XIs are listed in the audit. The built-in: one coverage row per NATIONS id in its audit, each with the
 * shipped XI's player count. A season file: its own coverage (nations with players, complete natural XIs) agrees with
 * its squads (`setCoverage`: { listed: the file's coverage, withPlayers, naturalXIs }).
 */
export function auditXIsCheck({ audit, auditPath, rosters, nations, fielded, setCoverage = null }) {
  const ids = Object.keys(nations).sort();
  if (setCoverage) {
    const { listed, withPlayers, naturalXIs } = setCoverage, reasons = [];
    if (listed?.nations !== withPlayers) reasons.push(`${auditPath} counts ${listed?.nations} nations with players, its squads ${withPlayers}`);
    if (listed?.completeXIs !== naturalXIs) reasons.push(`${auditPath} counts ${listed?.completeXIs} complete natural XIs, its squads ${naturalXIs}`);
    return { verdict: reasons.length ? 'fail' : 'pass', source: auditPath, nationsWithPlayers: withPlayers, completeNaturalXIs: naturalXIs,
      incompleteFieldedXIs: fielded.filter(id => (rosters?.[id]?.[2]?.length ?? 0) < 11).sort(), reasons };
  }
  const rows = Array.isArray(audit?.coverage) ? audit.coverage : null;
  if (!rows) return { verdict: 'not available', source: auditPath, reasons: [`${auditPath} has no coverage list`] };
  const byId = new Map(rows.map(row => [row.id, row]));
  const unlisted = ids.filter(id => !byId.has(id));
  const mismatched = rosters ? ids.filter(id => byId.has(id) && byId.get(id).players !== (Array.isArray(rosters[id]?.[2]) ? rosters[id][2].length : 0)) : [];
  const incompleteXIs = rows.filter(row => row.players < 11 || row.naturalLineup === false || row.goalkeeper === false).map(row => row.id).sort();
  const reasons = [];
  if (unlisted.length) reasons.push(`${unlisted.length} nations are missing from ${auditPath} coverage`);
  if (mismatched.length) reasons.push(`${mismatched.length} coverage rows disagree with the shipped XI's player count`);
  return { verdict: reasons.length ? 'fail' : 'pass', source: auditPath, nations: rows.length, incompleteXIs, unlisted, mismatched, reasons };
}

/**
 * Engine-scale gate from engine-scale.json (the built-in only): valid while its built-in entry is the shipped squads,
 * by content hash; its verdict compares them with the reference, the built-in it replaced.
 */
export function engineScaleCheck({ engineScale, season, builtIn, file = ENGINE_SCALE_FILE }) {
  if (!builtIn) return { verdict: NOT_APPLICABLE, reasons: [], note: 'The engine-scale gate compares built-in squads; a season file is checked when it is built' };
  const rerun = 'run npm run engine-scale:football';
  if (!engineScale) return { verdict: 'incomplete', source: file, reasons: [`${file} is not present; ${rerun}`] };
  const entry = engineScale.builtIn;
  if (!entry || entry.contentHash !== season.contentHash) {
    return { verdict: 'incomplete', source: file, reasons: [`${file} scores the built-in at ${entry?.contentHash ?? 'nothing'}, but the shipped squads are ${season.contentHash}; ${rerun}`] };
  }
  const ok = entry.verdict === 'pass';
  return { verdict: ok ? 'pass' : 'fail', source: file, reference: engineScale.reference ? { contentHash: engineScale.reference.contentHash, label: engineScale.reference.label } : null,
    starters: { sd: entry.starters.sd, quantiles: entry.starters.quantiles }, strengthSd: entry.strength.sd,
    probe: { favouriteWinRate: entry.probe.favouriteWinRate, upsetRate: entry.probe.upsetRate, pairs: entry.probe.pairs },
    production: entry.production.pooled, failed: entry.failed, reasons: ok ? [] : entry.failed.map(check => `Engine scale fails ${check}`) };
}

/** fail if any check fails; 'not scored' while the forecast window is open; pass if all apply and pass; otherwise incomplete. */
export function shipVerdictOf(verdicts) {
  const values = applicable(Object.values(verdicts));
  if (values.includes('fail')) return 'fail';
  if (verdicts.forecast === 'not scored') return 'not scored';
  return values.every(value => value === 'pass') ? 'pass' : 'incomplete';
}

/**
 * What the verdicts mean on main, where every season ships by choice. partial: the forecast window's coverage
 * ({ window: { from, to }, covered: { from, to } }) when results.csv does not reach R_next.
 */
export function implicationOf({ builtIn, provisionalVerdict, shipVerdict, shipVerdicts, partial = null }) {
  const open = Object.entries(shipVerdicts).filter(([, v]) => v !== 'pass' && v !== NOT_APPLICABLE).map(([k, v]) => `${k} ${v}`).join(', ');
  const verdict = builtIn
    ? (provisionalVerdict === 'fail' ? `The built-in squads fail the provisional gate (${open}): look before shipping them.`
      : provisionalVerdict !== 'pass' ? `The provisional gate is ${provisionalVerdict} (${open}).`
        : shipVerdict === 'not scored' ? 'The built-in squads pass the provisional gate; the full gate waits for the season\'s forecast window, scored once a newer built-in season replaces this one.'
          : shipVerdict === 'pass' ? 'Passes the full gate.' : `The full gate is ${shipVerdict} (${open}).`)
    : shipVerdict === 'pass' ? 'Passes the full gate.'
      : shipVerdict === 'fail' ? `Fails the full gate (${open}). The season ships regardless, as every season does: the verdict is a report.`
        : `The full gate is ${shipVerdict} (${open}).`;
  if (!partial) return verdict;
  return `${verdict} The forecast rests on a partial window: results.csv covers (${partial.covered.from}, ${partial.covered.to}] of (${partial.window.from}, ${partial.window.to}], `
    + `so it is re-scored when a results.csv that covers ${partial.window.to} is pinned.`;
}

/** The next newer season (by id) of the manifest, which closes this season's forecast window. */
export const nextNewerSeason = (season, seasons) => seasons.filter(row => row.id > season.id).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null;

/**
 * Pure report over loaded inputs. inputs: [{ season, builtIn, hasFm, rosters, fielded, strength, contentHash, audit,
 * auditPath, setCoverage }]; strength (nation id → unrounded T_n) over the fielded nations. seasons: every manifest
 * season (closes windows). results: loadResults() or null; engineScale: parsed engine-scale.json or null.
 */
export function buildReport({ inputs, nations, files, generatedAt = null, codes = ELO_CODES, seasons = inputs.map(input => input.season),
  results = null, engineScale = null, resolveName = nationForResultsName }) {
  const usedFiles = new Set();
  const report = inputs.map(({ season, builtIn, hasFm, rosters, fielded, strength, contentHash, audit, auditPath, setCoverage }) => {
    const scoredSeason = { ...season, contentHash };
    const build = buildChecks({ season, rosters, nations, fielded, builtIn, contentHash });
    const elo = eloAtRatingsDate(season.ratingsDate, files);
    elo.files.forEach(name => usedFiles.add(name));
    const cross = rosters ? crossSectional({ season, rosters, nations, fielded, elo, codes })
      : { verdict: 'incomplete', reasons: ['No rosters to score'] };
    const linking = linkingCheck(audit, auditPath, { hasFm });
    const verdict = overall([build.verdict, cross.verdict, linking.verdict]);
    const { ratings, ...eloRecord } = elo;
    // Full ship gate.
    const next = nextNewerSeason(season, seasons), ids = fielded.slice().sort();
    const eloAtR = next ? eloAtInformationDate(season.informationDate, files) : null;
    eloAtR?.files.forEach(name => usedFiles.add(name));
    // A nation fielding no side this season plays no scored match: its results name counts as off the map.
    const fieldedSet = new Set(ids);
    const seasonName = name => { const id = resolveName(name); return id && !fieldedSet.has(id) ? null : id; };
    // Unrounded T_n when the caller measured it (seasonInputs does), else the rosters' own rounded strengths.
    const values = strength ?? (rosters ? Object.fromEntries(ids.map(id => [id, rosters[id]?.[0]])) : null);
    let forecast;
    if (!values || ids.some(id => !Number.isFinite(values[id]))) forecast = { verdict: 'incomplete', reasons: ['No strength for every fielded nation'] };
    else {
      forecast = forecastTrack({ season, nextSeason: next, results, strength: values, elo: eloAtR, codes, nationIds: ids, resolveName: seasonName,
        excludedStatuses: GATE.excludedStatuses });
      if (eloAtR) { const { ratings: dropped, ...record } = eloAtR; forecast = { ...forecast, elo: record }; }
    }
    const reepLinking = reepLinkingCheck(audit, auditPath, { hasFm });
    const engine = engineScaleCheck({ engineScale, season: scoredSeason, builtIn });
    const auditXIs = auditXIsCheck({ audit, auditPath, rosters, nations, fielded, setCoverage });
    const shipVerdicts = { provisional: verdict, reepLinking: reepLinking.verdict, forecast: forecast.verdict, engineScale: engine.verdict, auditXIs: auditXIs.verdict };
    const shipVerdict = shipVerdictOf(shipVerdicts);
    // A verdict on a window results.csv does not cover yet stands, marked partial until it is re-scored.
    const shipPartial = forecast.partial === true;
    return {
      id: season.id, label: season.label, squads: season.squads, sources: season.sources,
      ratingsDate: season.ratingsDate, informationDate: season.informationDate, contentHash,
      gate: 'provisional', verdict,
      verdicts: { build: build.verdict, crossSectional: cross.verdict, linking: linking.verdict },
      provisionalVerdict: verdict, shipVerdict, shipPartial, shipVerdicts,
      implication: implicationOf({ builtIn, provisionalVerdict: verdict, shipVerdict, shipVerdicts,
        partial: shipPartial ? { window: forecast.window, covered: forecast.coverage.covered } : null }),
      elo: eloRecord, build, crossSectional: cross, linking,
      reepLinking, forecast, engineScale: engine, auditXIs,
    };
  });
  const out = {
    note: 'Football squad gate (docs/design/football-squad-gate.md). Provisional gate (verdict, verdicts): build checks from the shipped data, Spearman of XI strength against World Football Elo at the season\'s ratingsDate on the gate set, and the EA−FM linking mean from the built-in\'s audit. Full ship gate (shipVerdict, shipVerdicts): the provisional gate plus the linking check on Reep-linked pairs, the forecast gate on martj42 results in (R_Y, R_next] against Elo frozen at R_Y, the engine-scale gate from engine-scale.json (the built-in) and the audit listing incomplete XIs. Every season ships by choice, so the verdicts are a report. Elo values stay offline; only aggregates, ranks and model scores are recorded. Regenerate with npm run validate:football.',
  };
  if (generatedAt) out.generatedAt = generatedAt;
  Object.assign(out, {
    gate: { spearmanMin: GATE.spearmanMin, linkingMaxAbsMean: GATE.linkingMaxAbsMean,
      nations: 'The nations that field a side in the season (footballSets.js fieldedNations): a nation with no squad of its own plays no part.',
      gateSet: 'Every fielded nation except nations whose nationStatus is suspended or non-member; OFC stays in and is also reported alone.',
      truth: 'World Football Elo at ratingsDate (after matches dated on or before it), from a snapshot taken on ratingsDate or later',
      eloDates: `Replay of {Y}_results.tsv over {Y-1}.tsv when the results file has a match dated on or after ratingsDate or a trusted fetch date on or after it, checked against {Y}.tsv from the same snapshot; otherwise World.tsv with a trusted fetch date 0 to ${GATE.worldMaxDays} days after ratingsDate. A date is trusted when dateFrom is fetch or ends "vouched by ${TRUST_FLAG}". `
        + `Elo frozen at R_Y (the forecast baseline) takes the same replay, but World.tsv only when fetched ${GATE.worldMaxDaysAtR} days after R_Y, on R_Y itself: a later World.tsv has seen results of the matches the forecast scores (leakage), so the forecast is incomplete instead.`,
      verdicts: `fail if any check fails; pass if build, cross-sectional and linking all pass (${NOT_APPLICABLE} counts for neither); otherwise incomplete`,
      bootstrap: { resamples: BOOTSTRAP.resamples, seed: BOOTSTRAP.seed },
      ship: {
        checks: ['provisional gate', `linking on Reep-linked pairs: |audit linking.reep.meanEaMinusFm| ≤ ${SHIP_GATE.reepLinkingMaxAbsMean}`,
          'forecast gate', `engine-scale gate (${ENGINE_SCALE_FILE}, the built-in at its content hash)`, 'incomplete XIs listed in the audit'],
        forecast: {
          window: '(R_Y, R_next]: martj42 full internationals after the season\'s informationDate, up to the next newer season\'s; the newest season\'s window is open and not scored',
          matches: `Both teams field a side in the season (scripts/lib/results-names.mjs maps the names); matches with a ${GATE.excludedStatuses.join(' or ')} nation are scored apart; friendlies stay in the gate and are also reported apart`,
          model: 'Ordered logit z = β·(Z_home − Z_away) + h·[not neutral], P(home) = σ(z − c), P(away) = σ(−z − c), draw the remainder; Z standardised within the season over every fielded nation; roster T_n is the unrounded best-4-4-2 mean, the baseline Elo frozen at R_Y',
          matchWindows: `A match window is a FIFA window or a tournament: each finals tournament (every competition but friendlies, qualifiers and Nations Leagues) is one window, named by tournament and the year of its first match (same-name matches over ${FORECAST.tournamentGapDays} days apart are separate tournaments); friendlies, qualifiers and Nations Leagues group into date windows split at gaps over ${FORECAST.windowGapDays} days`,
          fitting: `k-fold cross-validation grouped by match window, k = min(${FORECAST.folds}, windows): each window whole in one fold, largest first to the fold with the fewest matches, so unequal windows still give balanced folds.`,
          errors: `Paired per-match log-loss difference clustered by match window and, separately, by team pair; the larger SE is used. Each SE is a block bootstrap, ${FORECAST.bootstrap.resamples} resamples (seed ${FORECAST.bootstrap.seed}), or a delete-one-cluster jackknife with fewer than ${FORECAST.jackknifeBelowClusters} clusters`,
          gate: `roster log loss ≤ Elo-at-R_Y log loss + ${FORECAST.seMultiplier}·SE, or + t(G − 1)·SE (two-sided 95% Student t, G the fewer of windows and team pairs) when G < ${FORECAST.jackknifeBelowClusters}; at least ${FORECAST.minMatches} matches in ${FORECAST.minWindows} or more windows; roster β > 0`,
          coverage: 'The window is covered when the pinned results.csv commit is dated after R_next or a match is dated on or after R_next; otherwise forecast.partial and shipPartial are true: the verdict stands on the covered part and is re-scored when a later results.csv is pinned',
        },
        verdicts: `shipVerdict: fail if any check fails; not scored while the forecast window is open; pass if all that apply pass (${NOT_APPLICABLE} counts for neither); otherwise incomplete`,
      } },
    elo: { source: 'World Football Elo Ratings (eloratings.net)', url: ELO_BASE,
      files: [...usedFiles].sort().map(name => { const file = files.get(name);
        return { file: name, url: file.url, fetchedAt: dateOf(file.fetchedAt), dateFrom: file.dateFrom ?? null, sha256: file.sha256 }; }) },
    results: results ? { source: results.source, url: results.url, license: results.license, file: results.file, commit: results.commit,
      sha256: results.sha256, rows: results.matches.length, lastMatchDate: results.lastMatchDate }
      : { cached: false },
    engineScale: { file: ENGINE_SCALE_FILE, reference: engineScale?.reference ? { contentHash: engineScale.reference.contentHash, label: engineScale.reference.label } : null },
    seasons: report,
  });
  return out;
}

// ---- inputs ----
/**
 * Cached Elo TSVs (Map name → { text, url, fetchedAt, dateFrom, sha256 }). Seeds or fetches only what is missing,
 * except that a requested {Y}_results.tsv and {Y}.tsv pair is acquired together (from one seed directory that holds
 * both, else by fetching both) whenever either is missing or they are not one snapshot. Fetches go through
 * scripts/lib/polite-fetch.mjs (robots.txt first, the generic User-Agent; `fetchImpl` stands in for the network in
 * tests), a FETCH_DELAY_MS apart. sources.json keeps each file's sha256, fetchedAt and dateFrom; trustSeedDates
 * vouches for the mtime dates of the files loaded.
 */
export async function loadEloFiles(names, { eloDir, offline = false, seedDirs = [], trustSeedDates = false, log = () => {},
  fetchDelayMs = FETCH_DELAY_MS, fetchImpl = null } = {}) {
  const sidecarPath = path.join(eloDir, 'sources.json');
  const get = createPoliteFetch(fetchImpl ? { fetchImpl } : undefined);
  let sidecar = {}, dirty = false, fetched = 0;
  try { sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')); } catch {}
  const wanted = [...new Set(names)].sort(), bytesOf = new Map();
  const urlOf = name => new URL(name, ELO_BASE).href;
  const install = async (name, bytes, entry) => {
    await mkdir(eloDir, { recursive: true });
    await writeFile(path.join(eloDir, name), bytes);
    sidecar[name] = { url: urlOf(name), ...entry, sha256: sha256(bytes) };
    bytesOf.set(name, bytes);
    dirty = true;
  };
  for (const name of wanted) {
    const file = path.join(eloDir, name);
    let bytes = null;
    try { bytes = await readFile(file); } catch { continue; }
    // No entry, or a file replaced by hand: the recorded date does not belong to these bytes, so the file mtime stands
    // in, untrusted.
    if (sidecar[name]?.sha256 !== sha256(bytes)) {
      sidecar[name] = { url: urlOf(name), fetchedAt: (await stat(file)).mtime.toISOString(), origin: 'unrecorded', dateFrom: 'file mtime', sha256: sha256(bytes) };
      dirty = true;
    }
    bytesOf.set(name, bytes);
  }
  // Groups to acquire: each missing file alone, or both halves of a pair that is not one snapshot.
  const groups = [], grouped = new Set();
  for (const results of wanted.filter(name => /^\d{4}_results\.tsv$/.test(name))) {
    const table = results.replace('_results', ''), year = Number(results.slice(0, 4));
    if (!wanted.includes(table)) continue;
    grouped.add(results).add(table);
    if (!sameSnapshot(year, bytesOf.has(results) && sidecar[results], bytesOf.has(table) && sidecar[table])) groups.push([results, table]);
  }
  for (const name of wanted) if (!grouped.has(name) && !bytesOf.has(name)) groups.push([name]);
  const findSeed = async (dir, name) => {
    for (const candidate of [name, `elo_${name}`]) {
      try { return { candidate, path: path.join(dir, candidate), bytes: await readFile(path.join(dir, candidate)) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return null;
  };
  const seed = async (name, found) => {
    validateEloText(name, found.bytes.toString('utf8'));
    await install(name, found.bytes, { fetchedAt: (await stat(found.path)).mtime.toISOString(), origin: `seed ${found.candidate}`, dateFrom: 'seed mtime' });
    log(`Elo: seeded ${name} from ${found.path}`);
  };
  for (const group of groups) {
    const missing = () => group.filter(name => !bytesOf.has(name));
    // 1. One seed directory that holds the whole group.
    let seeded = false;
    for (const dir of seedDirs) {
      const found = await Promise.all(group.map(name => findSeed(dir, name)));
      if (found.every(Boolean)) { for (const [i, name] of group.entries()) await seed(name, found[i]); seeded = true; break; }
    }
    if (seeded) continue;
    // 2. Fetch the whole group; a cached half is replaced only when its fetch succeeds. politeFetch refuses a path
    // robots.txt disallows, or any path when robots.txt cannot be read.
    if (!offline) for (const name of group) {
      const url = urlOf(name);
      if (fetched++) await sleep(fetchDelayMs);
      try {
        const response = await get(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = Buffer.from(await response.arrayBuffer());
        validateEloText(name, body.toString('utf8'));
        await install(name, body, { fetchedAt: new Date().toISOString(), lastModified: response.headers.get('last-modified'), origin: 'fetch', dateFrom: 'fetch' });
        log(`Elo: fetched ${url}`);
      } catch (error) { log(`Elo: ${url} not ${bytesOf.has(name) ? 'refreshed' : 'cached'} (${error.message})`); }
    }
    // 3. Still missing: any seed directory, file by file (a pair may then not be one snapshot, which the check reports).
    for (const name of missing()) for (const dir of seedDirs) {
      const found = await findSeed(dir, name);
      if (found) { await seed(name, found); break; }
    }
  }
  const files = new Map();
  for (const name of wanted.filter(name => bytesOf.has(name))) {
    const entry = sidecar[name];
    if (trustSeedDates && !trustedDate(entry)) { entry.dateFrom = `${entry.dateFrom}${VOUCHED}`; dirty = true; }
    files.set(name, { text: bytesOf.get(name).toString('utf8'), url: entry.url, fetchedAt: entry.fetchedAt, dateFrom: entry.dateFrom, sha256: entry.sha256 });
  }
  if (dirty) await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  return files;
}
function validateEloText(name, text) {
  if (/_results\.tsv$/.test(name)) { if (!parseEloResults(text).length) throw new Error(`${name} has no matches`); }
  else if (parseEloTable(text).size < 100) throw new Error(`${name} has fewer than 100 teams`);
}

/**
 * martj42 results.csv, the file the manifest pins by SHA-256 and size (`pin`), from dataDir/<folder>/<file>. Nothing
 * is downloaded: a missing or different file returns null with the reason logged. Returns { matches, lastMatchDate,
 * sha256, commit: { sha, date } (date: the commit's day), source, url, license, file } or null.
 */
export async function loadResults({ dataDir, pin, log = () => {} }) {
  const file = path.join(dataDir, pin.folder, pin.file);
  let bytes;
  try { bytes = await readFile(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    log(`Results: ${file} is missing; save ${pin.file} of ${pin.url} at commit ${pin.commit} there (scripts/data/football-gate.json)`);
    return null;
  }
  const hash = sha256(bytes);
  if (hash !== pin.sha256 || bytes.length !== pin.bytes) {
    log(`Results: ${file} is not the pinned file (SHA-256 ${hash}, ${bytes.length} bytes; pinned ${pin.sha256}, ${pin.bytes})`);
    return null;
  }
  const matches = parseResults(bytes.toString('utf8'));
  const lastMatchDate = matches.filter(match => match.homeScore != null && match.awayScore != null).reduce((max, match) => (match.date > max ? match.date : max), '');
  if (lastMatchDate > pin.committed) throw new Error(`results.csv has a match dated ${lastMatchDate}, after its commit's day ${pin.committed}`);
  return { matches, lastMatchDate, sha256: hash, commit: { sha: pin.commit, date: pin.committed },
    source: pin.source, url: pin.url, license: pin.license, file: pin.file };
}

/** Unrounded T_n per nation id: the mean effective rating of the best 4-4-2 (selectLineup), the value rosters[id][0] rounds. */
export function lineupStrengths(teams, sport, ids) {
  return Object.fromEntries(ids.slice().sort().map(id => {
    const lineup = teams.selectLineup(teams.buildTeam(id, null, sport));
    return [id, lineup.slots.reduce((sum, slot) => sum + slot.effectiveRating, 0) / lineup.slots.length];
  }));
}

/** The manifest is hand-maintained; reject anything the report cannot state. */
export function validateManifest(manifest, nations) {
  const fail = message => { throw new Error(`${MANIFEST_FILE}: ${message}`); };
  if (!Array.isArray(manifest?.seasons) || !manifest.seasons.length) fail('no seasons');
  manifest.seasons.forEach((season, index) => {
    const where = `season ${season.id ?? index}`;
    const match = /^(\d{4})-(\d{2})$/.exec(season.id || '');
    if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) fail(`${where}: id must be a season such as 2025-26`);
    if (season.label !== `${match[1]}/${match[2]}`) fail(`${where}: label must be ${match[1]}/${match[2]}`);
    if (index && season.id >= manifest.seasons[index - 1].id) fail(`${where}: seasons must be unique and newest first`);
    if (season.squads === 'built-in' ? index !== 0 : !/^ea-(?:fifa|fc)-\d{2}$/.test(season.squads || '')) fail(`${where}: squads must be built-in (the newest season) or an EA season file id`);
    if (typeof season.sources !== 'string' || !season.sources.trim()) fail(`${where}: missing sources label`);
    if (!validDate(season.ratingsDate) || !validDate(season.informationDate) || season.informationDate < season.ratingsDate) fail(`${where}: ratingsDate and informationDate must be dates, informationDate not before ratingsDate`);
    for (const [id, status] of Object.entries(season.nationStatus || fail(`${where}: missing nationStatus`))) {
      if (!nations[id] || !GATE.excludedStatuses.includes(status)) fail(`${where}: invalid nation status ${id}: ${status}`);
    }
  });
  if (manifest.seasons[0].squads !== 'built-in') fail('the newest season must be the built-in one');
  const pin = manifest.results;
  if (!/^[0-9a-f]{40}$/.test(pin?.commit || '') || !validDate(pin.committed) || !/^[0-9a-f]{64}$/.test(pin.sha256 || '') || !Number.isInteger(pin.bytes)
    || !pin.folder || !pin.file || !pin.url || !pin.license || !pin.source) fail('results needs source, url, license, commit, committed, folder, file, sha256 and bytes');
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * One season's inputs: its sport and rosters, the nations fielding a side, their unrounded strengths, the content hash
 * that identifies the squads, and its audit. The manifest's dates must be the data's: the built-in's EA snapshot and FM
 * database (from its audit), a season file's EA snapshot.
 */
export async function seasonInputs({ root, season }) {
  const teams = await import(pathToFileURL(path.join(root, 'src/data/teams.js')).href);
  const sets = await import(pathToFileURL(path.join(root, 'src/engine/footballSets.js')).href);
  if (season.squads === 'built-in') {
    const { football } = await import(pathToFileURL(path.join(root, 'src/sports/football.js')).href);
    const audit = await readJson(path.join(root, BUILT_IN_AUDIT));
    const eaDates = [...new Set((audit?.ea?.snapshots ?? []).map(row => row.snapshotDate))], fmDate = audit?.fm?.databaseDate;
    if (eaDates.length !== 1 || !validDate(fmDate)) throw new Error(`${BUILT_IN_AUDIT} names no single EA snapshot date and FM database date`);
    if (season.ratingsDate !== eaDates[0]) throw new Error(`${MANIFEST_FILE}: ${season.id} ratingsDate ${season.ratingsDate} is not the built-in's EA snapshot ${eaDates[0]}`);
    const newest = [eaDates[0], fmDate].sort().at(-1);
    if (season.informationDate !== newest) throw new Error(`${MANIFEST_FILE}: ${season.id} informationDate ${season.informationDate} is not the newest input ${newest}`);
    const fielded = [...sets.fieldedNations(football)];
    return { season, builtIn: true, hasFm: true, rosters: football.rosters, fielded, strength: lineupStrengths(teams, football, fielded),
      contentHash: sha256(await readFile(path.join(root, BUILT_IN_ROSTERS))).slice(0, 12), audit, auditPath: BUILT_IN_AUDIT, setCoverage: null };
  }
  const file = `public/football/${season.squads}.json`;
  const data = JSON.parse(await readFile(path.join(root, file), 'utf8'));
  const snapshot = data.source?.snapshotDate;
  if (season.ratingsDate !== snapshot || season.informationDate !== snapshot) throw new Error(`${MANIFEST_FILE}: ${season.id} dates must both be ${file}'s EA snapshot ${snapshot}`);
  const set = sets.decodeFootballSet(data), sport = sets.seasonSport(set);
  const fielded = [...sets.fieldedNations(sport)];
  // The file's coverage as scripts/lib/ea-seasons.mjs counts it: nations listed with a player, and complete natural XIs.
  const listedIds = Object.keys(data.nations).filter(id => data.nations[id][2].length);
  const naturalXIs = listedIds.filter(id => {
    const lineup = teams.selectLineup(teams.buildTeam(id, null, sport));
    return set.rosters[id][2].length === 11 && lineup.slots.every(slot => slot.player && !slot.outOfPosition);
  }).length;
  return { season, builtIn: false, hasFm: false, rosters: set.rosters, fielded, strength: lineupStrengths(teams, sport, fielded),
    contentHash: data.version, audit: null, auditPath: file, setCoverage: { listed: data.coverage, withPlayers: listedIds.length, naturalXIs } };
}

export async function runValidation({ root = ROOT, eloDir = path.join(root, 'data-src/validation/elo'), dataDir = path.join(root, 'data-src'),
  offline = false, seedDirs = [], trustSeedDates = false, generatedAt = null, log = () => {}, engineScalePath = path.join(root, ENGINE_SCALE_FILE), fetchImpl } = {}) {
  const { NATIONS } = await import(pathToFileURL(path.join(root, 'src/data/teams.js')).href);
  const manifest = JSON.parse(await readFile(path.join(root, MANIFEST_FILE), 'utf8'));
  validateManifest(manifest, NATIONS);
  const inputs = [];
  for (const season of manifest.seasons) inputs.push(await seasonInputs({ root, season }));
  // Elo at D_Y for every season, and at R_Y for every season whose forecast window a newer season closes.
  const { seasons } = manifest;
  const eloDates = [...seasons.map(s => s.ratingsDate), ...seasons.filter(s => nextNewerSeason(s, seasons)).map(s => s.informationDate)].filter(validDate);
  const options = { eloDir, offline, seedDirs, trustSeedDates, log, ...(fetchImpl ? { fetchImpl } : {}) };
  const files = await loadEloFiles(eloDates.flatMap(date => Object.values(replayFiles(date))), options);
  if (eloDates.some(date => !canReplay(date, files)))
    for (const [name, file] of await loadEloFiles(['World.tsv'], options)) files.set(name, file);
  const results = await loadResults({ dataDir, pin: manifest.results, log });
  const engineScale = await readJson(engineScalePath);
  return buildReport({ inputs, nations: NATIONS, files, generatedAt, seasons, results, engineScale });
}

export const serializeReport = report => `${JSON.stringify(report, null, 2)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).filter(argument => argument.startsWith('--')).map(argument => {
    const [key, ...parts] = argument.slice(2).split('='); return [key, parts.length ? parts.join('=') : true];
  }));
  const known = ['check', 'offline', 'output', 'generated-at', 'elo-dir', 'elo-seed', TRUST_FLAG.slice(2), 'data', 'engine-scale', 'allow-incomplete', 'root'];
  const unknown = Object.keys(args).filter(key => !known.includes(key));
  if (unknown.length) throw new Error(`Unknown option(s) ${unknown.map(key => `--${key}`).join(', ')}`);
  const root = args.root ? path.resolve(args.root) : ROOT;
  const output = path.resolve(args.output || path.join(root, VALIDATION_FILE));
  const eloDir = typeof args['elo-dir'] === 'string' ? path.resolve(args['elo-dir']) : path.join(root, 'data-src/validation/elo');
  let generatedAt = typeof args['generated-at'] === 'string' ? args['generated-at'] : null;
  if (generatedAt && !validDate(generatedAt)) throw new Error('--generated-at takes YYYY-MM-DD');
  const committed = args.check ? await readFile(output, 'utf8').catch(() => null) : null;
  // --check keeps the committed generatedAt so only real changes differ.
  if (committed && !generatedAt) generatedAt = JSON.parse(committed).generatedAt ?? null;
  const report = await runValidation({ root, generatedAt, offline: !!args.offline || !!args.check, eloDir, trustSeedDates: !!args[TRUST_FLAG.slice(2)],
    seedDirs: typeof args['elo-seed'] === 'string' ? args['elo-seed'].split(',').map(dir => path.resolve(dir)) : [],
    dataDir: typeof args.data === 'string' ? path.resolve(args.data) : path.join(root, 'data-src'),
    ...(typeof args['engine-scale'] === 'string' ? { engineScalePath: path.resolve(args['engine-scale']) } : {}),
    log: message => console.error(message) });
  const text = serializeReport(report);
  for (const season of report.seasons) {
    const cs = season.crossSectional, gate = cs.gateSet, fc = season.forecast, rve = fc.rosterVsElo, es = season.engineScale;
    console.log(`${season.id} (${season.sources}): provisional ${season.provisionalVerdict}. Build ${season.verdicts.build} (${season.build.fielded} nations field a side); `
      + (gate ? `Spearman ${gate.spearman} [${gate.spearmanCi95?.join(', ')}] on ${gate.n} gate nations vs Elo ${season.elo.method} at ${season.elo.date} (Pearson ${gate.pearson}; all ${cs.allNations.n}: ${cs.allNations.spearman}; within-confederation ${cs.withinConfederation.weightedSpearman}; top 50 ${cs.top50ByElo.spearman}) ${cs.verdict}; `
        : `cross-sectional ${cs.verdict}; `)
      + `linking ${season.linking.verdict}${season.linking.meanEaMinusFm != null ? ` (mean ${season.linking.meanEaMinusFm})` : ''}.`);
    for (const reason of [...season.build.failures, ...cs.reasons, ...season.linking.reasons]) console.log(`  - ${reason}`);
    console.log(`  Full gate ${season.shipVerdict}. Reep linking ${season.reepLinking.verdict}; forecast ${fc.verdict}`
      + (rve ? ` (${fc.models.roster.n} matches in (${fc.window.from}, ${fc.window.to}], ${fc.partial ? 'PARTIAL: ' : ''}data to ${fc.coverage.lastMatchDate}`
        + `${fc.coverage.commit ? ` at commit ${fc.coverage.commit.sha.slice(0, 7)} of ${dateOf(fc.coverage.commit.date)}` : ''}, ${rve.matchWindows} match windows, ${rve.teamPairs} team pairs: `
        + `log loss roster ${fc.models.roster.logLoss}, Elo at R_Y ${fc.models.eloAtR.logLoss}, Elo + roster ${fc.models.eloPlusRoster.logLoss}, base rates ${fc.models.baseRates.logLoss}; `
        + `difference ${rve.meanDifference}, SE ${rve.se} by ${rve.seUsed} (window ${rve.seByMatchWindow} by ${rve.seMethodByMatchWindow}, pair ${rve.seByTeamPair} by ${rve.seMethodByTeamPair}), margin ${rve.critical}·SE = ${rve.margin})` : '')
      + `; engine scale ${es.verdict}${es.starters ? ` (starter SD ${es.starters.sd}, favourite ${es.probe.favouriteWinRate}, upsets ${es.probe.upsetRate})` : ''}; audit XIs ${season.auditXIs.verdict}.`);
    for (const reason of [...season.reepLinking.reasons, ...fc.reasons, ...es.reasons, ...season.auditXIs.reasons]) console.log(`  - ${reason}`);
    console.log(`  ${season.implication}`);
  }
  const shown = path.relative(root, output).split(path.sep).join('/');
  // Exit 1 when the built-in fails the provisional gate. Missing or untrusted inputs (a provisional gate incomplete, or
  // no results.csv / Elo at R_Y for a closed forecast window) are not verdicts, so they never replace the committed
  // report unless --allow-incomplete.
  const builtIn = report.seasons.find(season => season.squads === 'built-in');
  const failed = builtIn?.provisionalVerdict === 'fail';
  const incomplete = report.seasons.filter(season => season.provisionalVerdict === 'incomplete');
  const noForecastInputs = report.seasons.filter(season => season.forecast.missingInputs);
  const blocked = [...new Set([...incomplete, ...noForecastInputs])];
  const allowIncomplete = !!args['allow-incomplete'];
  if (failed) console.error(`The built-in squads (${builtIn.id}) fail the provisional gate.`);
  if (incomplete.length) {
    const wanted = [...new Set(incomplete.flatMap(season => validDate(season.ratingsDate) ? [...Object.values(replayFiles(season.ratingsDate)), 'World.tsv'] : []))].sort();
    const absent = wanted.filter(name => !existsSync(path.join(eloDir, name)));
    console.error(`Season${incomplete.length > 1 ? 's' : ''} ${incomplete.map(season => season.id).join(', ')} incomplete (reasons above).`
      + (absent.length ? ` Not cached in ${path.relative(root, eloDir).split(path.sep).join('/') || '.'}: ${absent.join(', ')}.` : '')
      + ` Run npm run validate:football online to fetch Elo, pass --elo-seed=dir with earlier downloads, or ${TRUST_FLAG} to accept seeded files' mtimes as fetch dates.`);
  }
  if (noForecastInputs.length) console.error(`Forecast inputs missing for ${noForecastInputs.map(season => season.id).join(', ')} (reasons above): `
    + `results.csv belongs in data-src/martj42-results/ (scripts/data/football-gate.json pins it); Elo at R_Y comes from the same cache as Elo at D_Y.`);
  for (const season of report.seasons.filter(row => row.shipPartial)) {
    const { window, coverage } = season.forecast;
    console.error(`Note: ${season.id}'s forecast window (${window.from}, ${window.to}] is only partly covered: results.csv at commit ${coverage.commit?.sha?.slice(0, 7)} `
      + `ends ${coverage.lastMatchDate || 'before the window'}. Its verdict rests on (${coverage.covered.from}, ${coverage.covered.to}]; re-score it once a later results.csv is pinned.`);
  }
  if (args.check) {
    if (committed !== text) { console.error(`${shown} is stale; run npm run validate:football`); process.exitCode = 1; }
    else console.log(`${shown} is current.`);
  } else if (blocked.length && !allowIncomplete) {
    console.error(`Not writing ${shown}, so its verdicts stay; pass --allow-incomplete to write an incomplete report.`);
  } else {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, text);
    console.log(`Wrote ${shown}`);
  }
  if (failed || (blocked.length && !allowIncomplete)) process.exitCode = 1;
}
