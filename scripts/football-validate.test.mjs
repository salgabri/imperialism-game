// The football squad gate (scripts/football-validate.mjs, scripts/lib/forecast.mjs; docs/design/football-squad-gate.md):
// its statistics, the Elo snapshot rules, the forecast track and the report, on fixtures; and the committed report
// against the repo, which needs no cache. Tests that rescore from the ignored caches (data-src/validation/elo,
// data-src/martj42-results) skip without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HISTORIC_NATIONS, NATIONS } from '../src/data/teams.js';

// The nations of today's map: East Germany and South Vietnam (HISTORIC_NATIONS) are on the maps of their years only, and
// the squad gate measures the built-in season.
const TODAY_NATIONS = Object.keys(NATIONS).filter(id => !HISTORIC_NATIONS.includes(id));
import { ELO_CODES } from './lib/elo-codes.mjs';
import { OFF_MAP_RESULTS_NAMES, RESULTS_NAMES, nationForResultsName } from './lib/results-names.mjs';
import { FORECAST, clusterBootstrapSe, clusterJackknifeSe, clusteredSe, criticalValue, fitOrderedLogit, forecastTrack, groupFolds,
  isWindowCompetition, matchClusters, matchWindows, mulberry32, outcomeProbabilities, parseCsv, parseResults, scoreForecast, standardise,
  studentTCentral, studentTQuantile, windowCoverage } from './lib/forecast.mjs';
import { ENGINE_SCALE_FILE, GATE, MANIFEST_FILE, NOT_APPLICABLE, SHIP_GATE, VALIDATION_FILE, auditXIsCheck, bootstrapSpearman,
  buildReport, crossSectional, eloAtInformationDate, eloAtRatingsDate, engineScaleCheck, gateSet, implicationOf, loadEloFiles, loadResults,
  nextNewerSeason, parseEloResults, parseEloTable, pearson, ranks, replayElo, replayFiles, runValidation, sameSnapshot,
  serializeReport, shipVerdictOf, spearman, validateManifest } from './football-validate.mjs';
import { USER_AGENT } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const eloCache = path.join(root, 'data-src/validation/elo');
const dataDir = path.join(root, 'data-src');
const manifest = JSON.parse(await readFile(path.join(root, MANIFEST_FILE), 'utf8'));
const resultsFile = path.join(dataDir, manifest.results.folder, manifest.results.file);
const committedPath = path.join(root, VALIDATION_FILE);
const engineScalePath = path.join(root, ENGINE_SCALE_FILE);
const cachesAbsent = !existsSync(eloCache) ? 'data-src/validation/elo is absent; run npm run validate:football once to cache the Elo TSVs'
  : !existsSync(resultsFile) ? `${path.relative(root, resultsFile)} is absent; save martj42's results.csv at the commit ${MANIFEST_FILE} pins there`
    : false;
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} ≠ ${expected}`);
const sha = text => createHash('sha256').update(text).digest('hex');
const cached = (text, fetchedAt, dateFrom = 'fetch') => ({ text, url: 'https://www.eloratings.net/fixture', fetchedAt, dateFrom, sha256: sha(text) });
const table = ratings => Object.entries(ratings).map(([code, rating], i) => `−\t${i + 1}\t${code}\t${rating}`).join('\n');
const runCli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/football-validate.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const withTemp = async body => {
  const dir = await mkdtemp(path.join(tmpdir(), 'football-validate-'));
  try { return await body(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('Pearson and Spearman reproduce hand-computed values', () => {
  close(pearson([1, 2, 3, 4], [1, 3, 2, 5]), 5.5 / Math.sqrt(43.75));
  close(spearman([1, 2, 3, 4], [1, 3, 2, 5]), 0.8, '1 − 6·Σd²/(n(n²−1)), Σd² = 2:');
  close(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8, 'Σd² = 4, n = 5:');
  close(spearman([10, 20, 30], [1, 8, 27]), 1, 'monotone but not linear:');
  assert.ok(pearson([10, 20, 30], [1, 8, 27]) < 1);
  close(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null, 'a constant side has no correlation');
  assert.equal(pearson([1], [2]), null);
  assert.throws(() => pearson([1, 2], [1]));
});

test('tied values take the average of their ranks', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(ranks([5, 5, 5]), [2, 2, 2]);
  assert.deepEqual(ranks([3, 1, 2, 1]), [4, 1.5, 3, 1.5]);
  // Pearson on average ranks gives √0.9; the no-ties shortcut would give 0.95.
  close(spearman([1, 2, 2, 3], [1, 2, 3, 4]), Math.sqrt(0.9));
});

test('the bootstrap interval is seeded and brackets the estimate', () => {
  const x = Array.from({ length: 40 }, (_, i) => i), y = x.map(v => v + (v * 7) % 11);
  const ci = bootstrapSpearman(x, y);
  assert.deepEqual(bootstrapSpearman(x, y), ci);
  assert.ok(ci[0] <= spearman(x, y) && spearman(x, y) <= ci[1]);
});

test('every map nation has a distinct Elo code', () => {
  const ids = [...TODAY_NATIONS];
  assert.deepEqual(Object.keys(ELO_CODES).sort(), ids.sort());
  assert.equal(new Set(Object.values(ELO_CODES)).size, ids.length);
  assert.ok(Object.values(ELO_CODES).every(code => /^[A-Z]{2}$/.test(code)));
  assert.equal(ELO_CODES.KOS, 'KO');
  assert.equal(ELO_CODES['626'], 'TL', 'Timor-Leste is East Timor in Elo');
  assert.deepEqual([ELO_CODES['826'], ELO_CODES.SCO, ELO_CODES.WAL, ELO_CODES.NIR], ['EN', 'SQ', 'WA', 'EI']);
});

test('the gate set drops only suspended and non-member nations', () => {
  assert.deepEqual(gateSet(['032', '643', 'KOS', '242', '250'], { '643': 'suspended', KOS: 'non-member', '250': 'member' }), ['032', '242', '250']);
  assert.deepEqual(gateSet(['032', '242']), ['032', '242'], 'OFC stays in the gate set');
});

// eloratings.net layout: tables carry the code in column 3 and the rating in column 4; results carry post-match
// ratings in columns 11 and 12. U+2212 is minus.
const BASE_2024 = ['−\t1\tAA\t1800\t1', '−\t2\tBB\t1600\t1', '−\t3\tCC\t1500\t1'].join('\n');
const RESULTS_2025 = [
  '2025\t03\t20\tAA\tBB\t1\t0\tF\t\t10\t1810\t1590\t+10\t−10\t1\t2',
  '2025\t06\t05\tBB\tDD\t2\t2\tWCQ\tUS\t0\t1592\t1400\t+2\t0\t2\t9',
  '2025\t09\t19\tCC\tAA\t2\t1\tF\t\t25\t1530\t1780\t+30\t−30\t3\t1',
  '2025\t10\t10\tAA\tCC\t3\t0\tF\t\t15\t1795\t1515\t+15\t−15\t1\t3',
].join('\n');
const END_2025 = ['−\t1\tAA\t1795', '−\t2\tBB\t1592', '−\t3\tCC\t1515', '−\t4\tDD\t1400'].join('\n');
// The first two matches only, and the live table after them.
const RESULTS_TO_JUNE = RESULTS_2025.split('\n').slice(0, 2).join('\n');
const TABLE_AFTER_JUNE = table({ AA: 1810, BB: 1592, CC: 1500, DD: 1400 });

test('Elo replay applies post-match ratings through the cut-off date', () => {
  const base = parseEloTable(BASE_2024), results = parseEloResults(RESULTS_2025);
  assert.deepEqual([...base], [['AA', 1800], ['BB', 1600], ['CC', 1500]]);
  assert.deepEqual(results[1], { date: '2025-06-05', home: 'BB', away: 'DD', homeAfter: 1592, awayAfter: 1400 });
  assert.deepEqual([...replayElo(base, results, '2025-03-19').ratings], [...base], 'nothing played yet');
  const atDate = replayElo(base, results, '2025-09-19');
  assert.deepEqual(Object.fromEntries(atDate.ratings), { AA: 1780, BB: 1592, CC: 1530, DD: 1400 }, 'matches on the date count; new teams join');
  assert.equal(atDate.matches, 3);
  assert.equal(atDate.lastMatchDate, '2025-09-19');
  const shuffled = parseEloResults(RESULTS_2025.split('\n').reverse().join('\n'));
  assert.deepEqual([...replayElo(base, shuffled, '2025-09-19').ratings].sort(), [...atDate.ratings].sort(), 'replay follows dates, not file order');
  assert.deepEqual(Object.fromEntries(replayElo(base, results).ratings), Object.fromEntries(parseEloTable(END_2025)));
  assert.equal(base.get('AA'), 1800, 'the base table is not mutated');
  assert.throws(() => parseEloResults('2025\t1\t2\tAA'), /malformed/);
  assert.throws(() => parseEloTable('<html>'), /malformed/);
});

test('Elo source: replay first, verified against the year table; an unverified replay has reasons', () => {
  assert.deepEqual(replayFiles('2025-09-19'), { base: '2024.tsv', results: '2025_results.tsv', check: '2025.tsv' });
  const files = new Map([['2024.tsv', cached(BASE_2024, '2026-10-18T13:56:28Z')], ['2025_results.tsv', cached(RESULTS_2025, '2026-10-18T13:56:10Z')],
    ['2025.tsv', cached(END_2025, '2026-10-18T13:56:08Z')]]);
  const replay = eloAtRatingsDate('2025-09-19', files);
  assert.equal(replay.method, 'replay');
  assert.equal(replay.date, '2025-09-19');
  assert.equal(replay.ratings.get('CC'), 1530);
  assert.equal(replay.completeBy, 'match dated 2025-10-10', 'a later match proves the file covers the date, whatever its fetch date');
  assert.deepEqual(replay.check, { file: '2025.tsv', teams: 4, exact: 4, mismatched: [] });
  assert.deepEqual(replay.files, ['2024.tsv', '2025_results.tsv', '2025.tsv']);
  assert.deepEqual(replay.reasons, []);
  const wrongCheck = eloAtRatingsDate('2025-09-19', new Map([...files, ['2025.tsv', cached(END_2025.replace('1515', '1516'), '2026-10-18')]]));
  assert.deepEqual(wrongCheck.check.mismatched, ['CC']);
  assert.match(wrongCheck.reasons[0], /does not reproduce 2025\.tsv/);
  // Without its year table the replay is unverified, so the gate cannot pass on it.
  const noTable = new Map(files);
  noTable.delete('2025.tsv');
  const unverified = eloAtRatingsDate('2025-09-19', noTable);
  assert.equal(unverified.method, 'replay');
  assert.equal(unverified.check, null);
  assert.match(unverified.reasons[0], /2025\.tsv is not cached, so the replay is unverified/);
  assert.equal(eloAtRatingsDate('19/09/2025', files).method, null);
});

test('one rule for both paths: a snapshot taken on D_Y or later stands for it, one taken before never does', () => {
  // Results and table through June, fetched together, so no match proves the date: the fetch date decides.
  const at = fetchedAt => new Map([['2024.tsv', cached(BASE_2024, fetchedAt)], ['2025_results.tsv', cached(RESULTS_TO_JUNE, fetchedAt)],
    ['2025.tsv', cached(TABLE_AFTER_JUNE, fetchedAt)]]);
  const sameDay = eloAtRatingsDate('2025-09-19', at('2025-09-19T20:00:00Z'));
  assert.equal(sameDay.method, 'replay', 'a results file fetched on D_Y counts, as a World.tsv fetched on D_Y does');
  assert.equal(sameDay.completeBy, 'fetched 2025-09-19 (fetch)');
  assert.deepEqual(sameDay.reasons, []);
  const before = at('2025-09-18T20:00:00Z');
  const early = eloAtRatingsDate('2025-09-19', before);
  assert.equal(early.method, null);
  assert.match(early.reasons[0], /fetched on 2025-09-18, before 2025-09-19/);
  assert.match(early.reasons[0], /delete 2025_results\.tsv and 2025\.tsv to refetch them together/, 'the hint names both halves of the pair');
  const world = fetchedAt => eloAtRatingsDate('2025-09-19', new Map([...before, ['World.tsv', cached(END_2025, fetchedAt)]]));
  const weekBefore = world('2025-09-12T08:00:00Z');
  assert.equal(weekBefore.method, null, 'World.tsv from before D_Y misses the matches up to it');
  assert.match(weekBefore.reasons.join(' '), /World\.tsv was fetched on 2025-09-12, 7 days before 2025-09-19/);
  assert.equal(world('2025-09-18T23:00:00Z').method, null);
  assert.deepEqual([world('2025-09-19T08:00:00Z').method, world('2025-09-19T08:00:00Z').daysFromRatingsDate], ['world', 0]);
  const weekAfter = world('2025-09-26T08:00:00Z');
  assert.equal(weekAfter.method, 'world');
  assert.equal(weekAfter.date, '2025-09-26');
  assert.equal(weekAfter.daysFromRatingsDate, 7);
  assert.match(weekAfter.replayUnavailable[0], /before 2025-09-19/);
  const stale = eloAtRatingsDate('2025-09-19', new Map([['World.tsv', cached(END_2025, '2025-09-27')]]));
  assert.equal(stale.method, null);
  assert.match(stale.reasons.join(' '), /8 days after 2025-09-19 \(limit 7\)/);
});

test('Elo frozen at R_Y comes from a replay or a World.tsv fetched on R_Y, never a later one that has seen the scored matches', () => {
  // Results and table through June, fetched the day before: no replay covers 19 September, so World.tsv is the candidate.
  const before = new Map([['2024.tsv', cached(BASE_2024, '2025-09-18T20:00:00Z')], ['2025_results.tsv', cached(RESULTS_TO_JUNE, '2025-09-18T20:00:00Z')],
    ['2025.tsv', cached(TABLE_AFTER_JUNE, '2025-09-18T20:00:00Z')]]);
  const world = fetchedAt => new Map([...before, ['World.tsv', cached(END_2025, fetchedAt)]]);
  assert.equal(GATE.worldMaxDaysAtR, 0);
  // Three days after R_Y, World.tsv already holds the results of matches the forecast scores in (R_Y, R_next].
  const later = eloAtInformationDate('2025-09-19', world('2025-09-22T08:00:00Z'));
  assert.deepEqual([later.method, later.ratings], [null, null]);
  assert.match(later.reasons.join(' '), /World\.tsv was fetched on 2025-09-22, 3 days after 2025-09-19, so it has seen results of matches the forecast gate scores after R_Y 2025-09-19 \(leakage\); only a replay cut at 2025-09-19 or a World\.tsv fetched on 2025-09-19/);
  assert.equal(eloAtRatingsDate('2025-09-19', world('2025-09-22T08:00:00Z')).method, 'world', 'at D_Y, which scores no matches, the same file still stands in');
  const sameDay = eloAtInformationDate('2025-09-19', world('2025-09-19T08:00:00Z'));
  assert.deepEqual([sameDay.method, sameDay.daysFromRatingsDate, sameDay.reasons], ['world', 0, []]);
  assert.equal(eloAtInformationDate('2025-09-19', world('2025-09-18T23:00:00Z')).method, null, 'one taken before R_Y misses matches up to it');
  // A replay cuts at R_Y, so a results file fetched long after it is fine.
  const replay = eloAtInformationDate('2025-09-19', new Map([['2024.tsv', cached(BASE_2024, '2026-10-18')], ['2025_results.tsv', cached(RESULTS_2025, '2026-10-18')],
    ['2025.tsv', cached(END_2025, '2026-10-18')], ['World.tsv', cached(END_2025, '2025-09-22')]]));
  assert.deepEqual([replay.method, replay.ratings.get('CC'), replay.reasons], ['replay', 1530, []]);
});

test('an open-year results file and table from different fetches skip the check instead of mismatching', () => {
  assert.ok(sameSnapshot(2025, { fetchedAt: '2025-11-20T10:00:00Z' }, { fetchedAt: '2025-11-20T10:09:00Z' }));
  assert.ok(!sameSnapshot(2025, { fetchedAt: '2025-11-20T10:00:00Z' }, { fetchedAt: '2025-11-20T10:11:00Z' }));
  assert.ok(sameSnapshot(2025, { fetchedAt: '2026-01-02' }, { fetchedAt: '2026-03-01' }), 'year-end files are static once the year closes');
  assert.ok(!sameSnapshot(2025, { fetchedAt: '2026-01-02' }, { fetchedAt: '2025-12-30' }));
  assert.ok(!sameSnapshot(2025, null, { fetchedAt: '2026-01-02' }));
  // 2025 still open: the live table is from 1 October, the results file from 20 November has the 10 October match too.
  const live = table({ AA: 1780, BB: 1592, CC: 1530, DD: 1400 });
  const files = new Map([['2024.tsv', cached(BASE_2024, '2025-11-20T10:00:00Z')], ['2025_results.tsv', cached(RESULTS_2025, '2025-11-20T10:00:00Z')],
    ['2025.tsv', cached(live, '2025-10-01T10:00:00Z')]]);
  const elo = eloAtRatingsDate('2025-09-19', files);
  assert.equal(elo.method, 'replay');
  assert.equal(elo.ratings.get('AA'), 1780, 'Elo at D_Y itself is right');
  assert.deepEqual(elo.check, { file: '2025.tsv', skipped: '2025_results.tsv and 2025.tsv are not one snapshot' });
  assert.equal(elo.reasons.length, 1);
  assert.doesNotMatch(elo.reasons[0], /does not reproduce/);
  assert.match(elo.reasons[0], /not fetched together.*delete 2025_results\.tsv and 2025\.tsv to refetch them together/);
  // Fetched together, the same table is a real mismatch.
  const together = eloAtRatingsDate('2025-09-19', new Map([...files, ['2025.tsv', cached(live, '2025-11-20T10:05:00Z')]]));
  assert.deepEqual(together.check.mismatched, ['AA', 'CC']);
});

// Tables of 120 teams pass the cache's sanity check; one match moves T0 and T1.
const bigTable = (overrides = {}) => Array.from({ length: 120 }, (_, i) => `${i + 1}\t${i + 1}\tT${i}\t${overrides[`T${i}`] ?? 2000 - i}`).join('\n');
const oneMatch = date => `${date.replaceAll('-', '\t')}\tT0\tT1\t1\t0\tF\t\t10\t2010\t1989\t+10\t−10\t1\t2`;
const AFTER_MATCH = bigTable({ T0: 2010, T1: 1989 });

test('cached Elo files are seeded once, validated and recorded by sha256 without network', async () => withTemp(async dir => {
  const seed = path.join(dir, 'seed'), cache = path.join(dir, 'elo');
  await mkdir(seed);
  const big = bigTable();
  await writeFile(path.join(seed, 'elo_2024.tsv'), big);
  await writeFile(path.join(seed, '2025_results.tsv'), '<html>blocked</html>');
  await assert.rejects(loadEloFiles(['2025_results.tsv'], { eloDir: cache, offline: true, seedDirs: [seed] }), /malformed/);
  const first = await loadEloFiles(['2024.tsv', '2023.tsv'], { eloDir: cache, offline: true, seedDirs: [seed] });
  assert.deepEqual([...first.keys()], ['2024.tsv'], 'offline: a missing file stays missing');
  const sidecar = JSON.parse(await readFile(path.join(cache, 'sources.json'), 'utf8'));
  assert.equal(sidecar['2024.tsv'].origin, 'seed elo_2024.tsv');
  assert.equal(sidecar['2024.tsv'].url, 'https://www.eloratings.net/2024.tsv');
  assert.equal(sidecar['2024.tsv'].dateFrom, 'seed mtime');
  assert.equal(sidecar['2024.tsv'].sha256, sha(big));
  const again = await loadEloFiles(['2024.tsv'], { eloDir: cache, offline: true });
  assert.deepEqual(again.get('2024.tsv'), first.get('2024.tsv'), 'the cache, not the seed, answers later runs');
  assert.equal(again.get('2024.tsv').sha256, sha(big));
}));

test('fetch dates come from sources.json by sha256, and a seed or file mtime counts only with --trust-seed-dates', async () => withTemp(async dir => {
  const seed = path.join(dir, 'seed'), cache = path.join(dir, 'elo'), names = ['2024.tsv', '2025_results.tsv', '2025.tsv'];
  await mkdir(seed);
  // A results file that stops on 30 August, copied so that its mtime reads 1 October.
  await writeFile(path.join(seed, '2024.tsv'), bigTable());
  await writeFile(path.join(seed, '2025_results.tsv'), oneMatch('2025-08-30'));
  await writeFile(path.join(seed, '2025.tsv'), AFTER_MATCH);
  const october = new Date('2025-10-01T12:00:00Z');
  for (const name of names) await utimes(path.join(seed, name), october, october);
  const seeded = await loadEloFiles(names, { eloDir: cache, offline: true, seedDirs: [seed] });
  assert.deepEqual([...seeded.values()].map(file => [file.fetchedAt, file.dateFrom]), names.map(() => ['2025-10-01T12:00:00.000Z', 'seed mtime']));
  const untrusted = eloAtRatingsDate('2025-09-19', seeded);
  assert.equal(untrusted.method, null, 'the mtime alone does not prove the file covers 19 September');
  assert.match(untrusted.reasons[0], /no match dated on or after 2025-09-19 \(last 2025-08-30\).*seed mtime, which counts only with --trust-seed-dates/);

  const vouched = await loadEloFiles(names, { eloDir: cache, offline: true, trustSeedDates: true });
  assert.equal(vouched.get('2025_results.tsv').dateFrom, 'seed mtime, vouched by --trust-seed-dates');
  const sidecar = JSON.parse(await readFile(path.join(cache, 'sources.json'), 'utf8'));
  assert.equal(sidecar['2025_results.tsv'].dateFrom, 'seed mtime, vouched by --trust-seed-dates', 'the decision is recorded with the file');
  const replay = eloAtRatingsDate('2025-09-19', vouched);
  assert.equal(replay.method, 'replay');
  assert.equal(replay.completeBy, 'fetched 2025-10-01 (seed mtime, vouched by --trust-seed-dates)');
  assert.deepEqual(replay.reasons, []);
  const later = await loadEloFiles(names, { eloDir: cache, offline: true });
  assert.deepEqual(later, vouched, 'later runs read the recorded decision without the flag');

  // Replaced by hand: the recorded date belongs to other bytes, so the file is re-recorded from its mtime, untrusted.
  const replaced = bigTable({ T0: 2010, T1: 1989, T5: 1 }), january = new Date('2026-01-02T00:00:00Z');
  await writeFile(path.join(cache, '2025.tsv'), replaced);
  await utimes(path.join(cache, '2025.tsv'), january, january);
  const rerecorded = (await loadEloFiles(['2025.tsv'], { eloDir: cache, offline: true })).get('2025.tsv');
  assert.deepEqual([rerecorded.fetchedAt, rerecorded.dateFrom, rerecorded.sha256], ['2026-01-02T00:00:00.000Z', 'file mtime', sha(replaced)]);
}));

/** A fetch stand-in serving `pages` by path, with robots.txt as given (absent: 404); it records each URL and its User-Agent. */
const fakeFetch = (pages, robots = null) => {
  const requested = [];
  const fetchImpl = async (target, init) => {
    requested.push([String(target), new Headers(init?.headers).get('user-agent')]);
    const name = path.basename(new URL(target).pathname);
    if (name === 'robots.txt') return robots == null ? new Response('not found', { status: 404 }) : new Response(robots);
    return name in pages ? new Response(pages[name], { headers: { 'last-modified': 'Fri, 20 Nov 2026 09:00:00 GMT' } }) : new Response('missing', { status: 404 });
  };
  return { fetchImpl, requested };
};

test('an open-year results file and its table are seeded or fetched together, through politeFetch', async () => withTemp(async dir => {
  const names = ['2026_results.tsv', '2026.tsv'], url = name => `https://www.eloratings.net/${name}`;
  const fresh = { '2026_results.tsv': oneMatch('2026-10-30'), '2026.tsv': AFTER_MATCH };
  const cacheWith = async (name, entries) => {
    const cache = path.join(dir, name);
    await mkdir(cache);
    const sidecar = {};
    for (const [file, text, fetchedAt] of entries) {
      await writeFile(path.join(cache, file), text);
      sidecar[file] = { url: url(file), fetchedAt, origin: 'fetch', dateFrom: 'fetch', sha256: sha(text) };
    }
    await writeFile(path.join(cache, 'sources.json'), JSON.stringify(sidecar));
    return cache;
  };
  // 2026_results.tsv was deleted to refetch it; the old live table is still cached.
  const oldTable = ['2026.tsv', bigTable(), '2026-10-18T13:55:48.282Z'];
  const seed = path.join(dir, 'seed');
  await mkdir(seed);
  for (const name of names) await writeFile(path.join(seed, name), fresh[name]);
  const seeded = await loadEloFiles(names, { eloDir: await cacheWith('seeded', [oldTable]), offline: true, seedDirs: [seed] });
  assert.equal(seeded.get('2026.tsv').sha256, sha(AFTER_MATCH), 'the table comes from the same seed directory as the results');
  assert.equal(seeded.get('2026.tsv').dateFrom, 'seed mtime');

  const tsvs = requested => requested.map(([target]) => target).filter(target => !target.endsWith('/robots.txt')).sort();
  const first = fakeFetch(fresh);
  const fetched = await loadEloFiles(names, { eloDir: await cacheWith('fetched', [oldTable]), fetchDelayMs: 0, fetchImpl: first.fetchImpl });
  assert.equal(first.requested[0][0], 'https://www.eloratings.net/robots.txt', 'robots.txt is read before anything else');
  assert.ok(first.requested.every(([, agent]) => agent === USER_AGENT), 'every request names the project, never a person');
  assert.equal(USER_AGENT, 'imperialism-game-data/1.0');
  assert.deepEqual(tsvs(first.requested), names.map(url).sort(), 'a missing half refetches both');
  assert.deepEqual([...fetched.values()].map(file => [file.dateFrom, file.sha256]), [['fetch', sha(AFTER_MATCH)], ['fetch', sha(fresh['2026_results.tsv'])]]);
  const apart = fakeFetch(fresh);
  await loadEloFiles(names, { eloDir: await cacheWith('apart', [oldTable, ['2026_results.tsv', fresh['2026_results.tsv'], '2026-11-20T10:00:00.000Z']]), fetchDelayMs: 0, fetchImpl: apart.fetchImpl });
  assert.deepEqual(tsvs(apart.requested), names.map(url).sort(), 'a pair fetched a month apart in an open year is refetched');
  const together = fakeFetch(fresh);
  await loadEloFiles(names, { eloDir: await cacheWith('together', [['2026.tsv', AFTER_MATCH, '2026-11-20T10:00:02.000Z'],
    ['2026_results.tsv', fresh['2026_results.tsv'], '2026-11-20T10:00:00.000Z']]), fetchDelayMs: 0, fetchImpl: together.fetchImpl });
  assert.deepEqual(together.requested, [], 'one snapshot stays cached, and nothing is requested at all');
  // A robots.txt that disallows the files stops the fetch, and the refusal is logged.
  const denied = fakeFetch(fresh, 'User-agent: *\nDisallow: /2026\n'), logs = [];
  const none = await loadEloFiles(names, { eloDir: path.join(dir, 'denied'), fetchDelayMs: 0, fetchImpl: denied.fetchImpl, log: line => logs.push(line) });
  assert.deepEqual([tsvs(denied.requested), none.size], [[], 0]);
  assert.match(logs.join('\n'), /robots\.txt disallows \/2026_results\.tsv/);
}));

// Synthetic season: 3 UEFA, 2 CAF, 2 OFC and one suspended nation whose Elo contradicts its squad, so it would break the
// ordering if it were scored.
const FIXTURE_NATIONS = {
  U1: ['Uno', 'UNO', 'UEFA'], U2: ['Dos', 'DOS', 'UEFA'], U3: ['Tres', 'TRE', 'UEFA'], S1: ['Suspended', 'SUS', 'UEFA'],
  C1: ['Cuatro', 'CUA', 'CAF'], C2: ['Cinco', 'CIN', 'CAF'], O1: ['Seis', 'SEI', 'OFC'], O2: ['Siete', 'SIE', 'OFC'],
};
const FIXTURE_CODES = { U1: 'UA', U2: 'UB', U3: 'UC', S1: 'SA', C1: 'CA', C2: 'CB', O1: 'OA', O2: 'OB' };
const STRENGTH = { U1: 88, U2: 82, U3: 76, S1: 60, C1: 79, C2: 70, O1: 64, O2: 58 };
const ELO = { UA: 2000, UB: 1850, UC: 1700, SA: 1990, CA: 1800, CB: 1600, OA: 1500, OB: 1400 };
const shirt = (rating, source = 'ea-fc') => ['Player', 'MF', rating, { source }];
const fixtureRosters = () => Object.fromEntries(Object.entries(STRENGTH).map(([id, strength]) => [id, [strength, 30, Array.from({ length: 11 }, () => shirt(strength))]]));
const fixtureSeason = { id: '2030-31', label: '2030/31', squads: 'built-in', sources: 'Fixture', ratingsDate: '2030-09-18',
  informationDate: '2030-09-18', nationStatus: { S1: 'suspended' } };
// Base, a January match that leaves the ratings as they are, and the live table: one snapshot fetched after D_Y.
const fixtureFiles = (elo = ELO) => new Map([
  ['2029.tsv', cached(table(elo), '2030-10-01')],
  ['2030_results.tsv', cached(`2030\t01\t05\tUA\tUB\t0\t0\tF\t\t0\t${elo.UA}\t${elo.UB}\t0\t0\t1\t2`, '2030-10-01')],
  ['2030.tsv', cached(table(elo), '2030-10-01')],
]);
const fixtureInput = (overrides = {}) => ({ season: fixtureSeason, builtIn: true, hasFm: true, rosters: fixtureRosters(), fielded: Object.keys(FIXTURE_NATIONS),
  contentHash: 'abcdef012345', auditPath: 'docs/design/football-roster-audit.json', setCoverage: null,
  audit: { linking: { pairs: 120, meanEaMinusFm: -0.2, ci95: [-0.4, 0] } }, ...overrides });
const report = (overrides = {}, files = fixtureFiles()) => buildReport({ nations: FIXTURE_NATIONS, codes: FIXTURE_CODES, files,
  inputs: [fixtureInput(overrides)] });

test('a consistent season passes; the suspended nation is reported apart from the gate set', () => {
  const result = report(), [season] = result.seasons;
  assert.equal(season.verdict, 'pass');
  assert.deepEqual(season.verdicts, { build: 'pass', crossSectional: 'pass', linking: 'pass' });
  assert.equal(season.elo.method, 'replay');
  assert.equal(season.elo.completeBy, 'fetched 2030-10-01 (fetch)');
  assert.deepEqual(season.elo.check, { file: '2030.tsv', teams: 8, exact: 8, mismatched: [] });
  const cross = season.crossSectional;
  assert.equal(cross.gateSet.n, 7);
  assert.equal(cross.gateSet.spearman, 1);
  assert.ok(cross.allNations.spearman < 1, 'scoring the suspended nation would cost agreement');
  assert.equal(cross.allNations.n, 8);
  assert.deepEqual([cross.ofc.n, cross.gateSetWithoutOfc.n], [2, 5]);
  assert.deepEqual(cross.excludedNations.map(row => [row.id, row.status, row.eloRank, row.strengthRank]), [['S1', 'suspended', 2, 7]]);
  assert.deepEqual(Object.fromEntries(Object.entries(cross.withinConfederation.byConfederation).map(([conf, row]) => [conf, row.n])),
    { UEFA: 3, CONMEBOL: 0, CAF: 2, AFC: 0, CONCACAF: 0, OFC: 2 });
  assert.equal(cross.withinConfederation.weightedSpearman, 1);
  assert.equal(cross.top50ByElo.n, 7);
  assert.equal(cross.eaOnlyXIs.n, 7);
  assert.deepEqual(result.elo.files.map(file => [file.file, file.fetchedAt, file.dateFrom]),
    [['2029.tsv', '2030-10-01', 'fetch'], ['2030.tsv', '2030-10-01', 'fetch'], ['2030_results.tsv', '2030-10-01', 'fetch']], 'the report says how each date was decided');
  const rows = [...cross.excludedNations, ...cross.rankGaps.squadAboveElo, ...cross.rankGaps.squadBelowElo];
  assert.ok(rows.length && rows.every(row => Object.keys(row).every(key => !/^elo$|rating/i.test(key))), 'Elo values stay out of the report');
  assert.equal(season.elo.ratings, undefined);
});

test('only the nations fielding a side are scored', () => {
  const fielded = Object.keys(FIXTURE_NATIONS).filter(id => id !== 'O2');
  const [season] = report({ fielded }).seasons;
  assert.equal(season.crossSectional.allNations.n, 7);
  assert.deepEqual([season.build.fielded, season.build.noTeam], [7, ['O2']]);
});

test('missing linking is incomplete, failed checks fail, and a season without FM has nothing to link', () => {
  const missing = report({ audit: null }).seasons[0];
  assert.equal(missing.linking.verdict, 'not available');
  assert.equal(missing.verdict, 'incomplete');
  const noField = report({ audit: { coverage: [] } }).seasons[0];
  assert.match(noField.linking.reasons[0], /no linking\.meanEaMinusFm/);
  assert.equal(report({ audit: { linking: { pairs: 50, meanEaMinusFm: 1.4 } } }).seasons[0].verdict, 'fail');
  assert.equal(report({ audit: { linking: { pairs: 50, meanEaMinusFm: -1 } } }).seasons[0].linking.verdict, 'pass', '|mean| ≤ 1 is inclusive');
  const eaOnly = report({ hasFm: false, audit: null, builtIn: false }).seasons[0];
  assert.deepEqual([eaOnly.linking.verdict, eaOnly.reepLinking.verdict, eaOnly.engineScale.verdict], [NOT_APPLICABLE, NOT_APPLICABLE, NOT_APPLICABLE]);
  assert.equal(eaOnly.verdict, 'pass', 'not applicable counts for neither pass nor fail');

  const thin = fixtureRosters();
  thin.C2[2].pop();
  thin.U1[2][0] = shirt(99.5);
  const build = report({ rosters: thin }).seasons[0];
  assert.equal(build.verdict, 'fail');
  assert.deepEqual(build.build.wrongShirtCount, [{ id: 'C2', shirts: 10 }], 'every built-in XI is 11 strong');
  assert.deepEqual(build.build.badRatings, [{ id: 'U1', player: 'Player', rating: 99.5 }]);
  const short = fixtureRosters();
  short.C2[2].pop();
  const season = report({ rosters: short, builtIn: false, hasFm: false, audit: null }).seasons[0];
  assert.deepEqual([season.build.verdict, season.build.shortXIs], ['pass', 1], 'a season file keeps its thin XIs, listed');
  const absent = fixtureRosters();
  delete absent.O2;
  const gap = report({ rosters: absent }).seasons[0];
  assert.deepEqual(gap.build.missing, ['O2']);
  assert.equal(gap.crossSectional.verdict, 'incomplete', 'an unscored gate nation leaves the gate unevaluated');
  assert.equal(report({ contentHash: null }).seasons[0].build.verdict, 'fail');

  // Swap the two strongest UEFA squads' Elo: Spearman on 7 nations falls below 0.90.
  const weak = report({}, fixtureFiles({ ...ELO, UA: 1500, OA: 2000, UB: 1450 })).seasons[0];
  assert.ok(weak.crossSectional.gateSet.spearman < 0.9);
  assert.equal(weak.crossSectional.verdict, 'fail');
  assert.equal(weak.verdict, 'fail');

  const noElo = report({}, new Map()).seasons[0];
  assert.equal(noElo.crossSectional.verdict, 'incomplete');
  assert.equal(noElo.verdict, 'incomplete');
  // A replay whose year table is missing, or from another snapshot, is not scored as a pass.
  const noTable = fixtureFiles();
  noTable.delete('2030.tsv');
  const unverified = report({}, noTable).seasons[0];
  assert.equal(unverified.crossSectional.verdict, 'incomplete');
  assert.match(unverified.crossSectional.reasons.join(' '), /2030\.tsv is not cached/);
  const apart = fixtureFiles();
  apart.set('2030.tsv', cached(table(ELO), '2030-08-01'));
  assert.equal(report({}, apart).seasons[0].crossSectional.verdict, 'incomplete');
});

test('the 0.90 gate compares the unrounded Spearman', () => {
  // 169 nations whose Elo order is the squad order with five disjoint swaps: Σd² = 80446, so
  // Spearman = 1 − 6·80446/(169·(169² − 1)) ≈ 0.8999975, which rounds to 0.9.
  const n = 169, order = Array.from({ length: n }, (_, i) => i);
  for (const [a, b] of [[0, 168], [1, 110], [2, 12], [13, 16], [17, 20]]) [order[a], order[b]] = [order[b], order[a]];
  const ids = order.map((_, i) => `N${String(i).padStart(3, '0')}`);
  const nations = Object.fromEntries(ids.map(id => [id, [id, id, 'UEFA']])), codes = Object.fromEntries(ids.map(id => [id, `E${id}`]));
  const rosters = Object.fromEntries(ids.map((id, i) => [id, [1000 - i, 30, Array.from({ length: 11 }, () => shirt(70))]]));
  const elo = { method: 'world', ratings: new Map(ids.map((id, i) => [codes[id], 5000 - order[i]])), reasons: [] };
  close(spearman(ids.map((_, i) => -i), ids.map((_, i) => -order[i])), 1 - 6 * 80446 / (n * (n ** 2 - 1)));
  const cross = crossSectional({ season: { nationStatus: {} }, rosters, nations, fielded: ids, elo, codes });
  assert.equal(cross.gateSet.n, n);
  assert.equal(cross.gateSet.spearman, GATE.spearmanMin, 'the report rounds to 4 decimals');
  assert.equal(cross.verdict, 'fail', 'the gate does not');
  assert.match(cross.reasons[0], /Gate-set Spearman 0\.89999751\d* is below 0\.9/);
});

test('the manifest is checked: seasons newest first, the built-in on top, valid dates, statuses and the results pin', () => {
  assert.doesNotThrow(() => validateManifest(manifest, NATIONS));
  const bad = edit => { const copy = structuredClone(manifest); edit(copy); return () => validateManifest(copy, NATIONS); };
  assert.throws(bad(m => { m.seasons.reverse(); }), /newest first|built-in/);
  assert.throws(bad(m => { m.seasons[1].label = '2025-26'; }), /label must be 2025\/26/);
  assert.throws(bad(m => { m.seasons[1].squads = 'cm0102-2002-11'; }), /squads must be built-in/);
  assert.throws(bad(m => { m.seasons[0].informationDate = '2026-10-01'; }), /informationDate not before ratingsDate/);
  assert.throws(bad(m => { m.seasons[0].nationStatus = { 643: 'banned' }; }), /invalid nation status 643: banned/);
  assert.throws(bad(m => { m.results.sha256 = 'x'; }), /results needs/);
});

test('a season without Elo exits 1 and is not written unless --allow-incomplete', async () => withTemp(async dir => {
  const empty = path.join(dir, 'elo'), output = path.join(dir, 'out.json'), noData = path.join(dir, 'data');
  const blocked = runCli('--offline', `--elo-dir=${empty}`, `--data=${noData}`, `--output=${output}`);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.ok(!existsSync(output), 'missing Elo never replaces a report');
  assert.match(blocked.stderr, /Seasons? .* incomplete/);
  assert.match(blocked.stderr, /Not cached in .*World\.tsv/);
  assert.match(blocked.stderr, /--elo-seed=dir/);
  assert.match(blocked.stderr, /pass --allow-incomplete/);
  const allowed = runCli('--offline', `--elo-dir=${empty}`, `--data=${noData}`, `--output=${output}`, '--allow-incomplete');
  assert.equal(allowed.status, 0, allowed.stderr);
  const written = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(written.seasons.map(season => season.id), manifest.seasons.map(season => season.id));
  assert.ok(written.seasons.every(season => season.verdict === 'incomplete'));
  assert.equal(written.results.cached, false);
  assert.match(runCli('--frobnicate').stderr, /Unknown option\(s\) --frobnicate/);
}));

test('the committed validation.json scores every manifest season at the shipped squads, and the built-in passes', async () => {
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  const stale = `${VALIDATION_FILE} is stale; run npm run validate:football`;
  assert.deepEqual([committed.gate.spearmanMin, committed.gate.linkingMaxAbsMean], [GATE.spearmanMin, GATE.linkingMaxAbsMean]);
  const fields = ['id', 'label', 'squads', 'sources', 'ratingsDate', 'informationDate'];
  const pick = season => Object.fromEntries(fields.map(field => [field, season[field]]));
  assert.deepEqual(committed.seasons.map(pick), manifest.seasons.map(pick), stale);
  const rosters = await readFile(path.join(root, 'src/data/rosters.js'));
  const builtIn = committed.seasons.find(season => season.squads === 'built-in');
  assert.equal(builtIn.contentHash, sha(rosters).slice(0, 12), `${stale}: the built-in squads changed`);
  for (const season of committed.seasons.filter(row => row.squads !== 'built-in')) {
    const file = JSON.parse(await readFile(path.join(root, `public/football/${season.squads}.json`), 'utf8'));
    assert.equal(season.contentHash, file.version, `${stale}: ${season.squads} changed`);
  }
  // The built-in's audit numbers are the ones scored.
  const audit = JSON.parse(await readFile(path.join(root, 'docs/design/football-roster-audit.json'), 'utf8'));
  assert.deepEqual([builtIn.linking.meanEaMinusFm, builtIn.reepLinking.meanEaMinusFm], [audit.linking.meanEaMinusFm, audit.linking.reep.meanEaMinusFm], stale);
  assert.deepEqual(builtIn.verdicts, { build: 'pass', crossSectional: 'pass', linking: 'pass' }, `the built-in squads fail the provisional gate: ${builtIn.implication}`);
  const engineScale = JSON.parse(await readFile(engineScalePath, 'utf8'));
  assert.equal(engineScale.builtIn.contentHash, builtIn.contentHash, `${ENGINE_SCALE_FILE} is stale; run npm run engine-scale:football, then npm run validate:football`);
  assert.equal(builtIn.engineScale.verdict, engineScale.builtIn.verdict, stale);
  for (const season of committed.seasons) {
    assert.equal(season.provisionalVerdict, season.verdict, season.id);
    assert.deepEqual(Object.keys(season.shipVerdicts), ['provisional', 'reepLinking', 'forecast', 'engineScale', 'auditXIs'], season.id);
    assert.equal(season.shipVerdict, shipVerdictOf(season.shipVerdicts), season.id);
    const newer = nextNewerSeason(season, manifest.seasons);
    assert.equal(season.forecast.window.to, newer?.informationDate ?? null, season.id);
    if (!newer) assert.equal(season.forecast.verdict, 'not scored', `${season.id} is the newest season, so its window is open`);
    else {
      const fc = season.forecast, rve = fc.rosterVsElo;
      assert.ok(['pass', 'fail'].includes(fc.verdict), `${season.id}: forecast ${fc.verdict} (${fc.reasons.join('; ')})`);
      // Elo frozen at R_Y never comes from a World.tsv taken after R_Y.
      assert.ok(fc.elo.method === 'replay' || (fc.elo.method === 'world' && fc.elo.daysFromRatingsDate === GATE.worldMaxDaysAtR), `${season.id}: Elo at R_Y ${fc.elo.method}`);
      assert.equal(rve.matchWindows, fc.matchWindows.length, season.id);
      assert.equal(rve.seMethodByMatchWindow, rve.matchWindows < FORECAST.jackknifeBelowClusters ? 'cluster jackknife' : 'cluster bootstrap', season.id);
      assert.equal(rve.critical, Math.min(rve.matchWindows, rve.teamPairs) < FORECAST.jackknifeBelowClusters
        ? Math.round(studentTQuantile(0.975, Math.min(rve.matchWindows, rve.teamPairs) - 1) * 1e4) / 1e4 : FORECAST.seMultiplier, season.id);
      assert.equal(rve.se, Math.max(rve.seByMatchWindow, rve.seByTeamPair), season.id);
      assert.equal(fc.partial, fc.coverage.partial, season.id);
      if (fc.partial) assert.match(season.implication, /rests on a partial window.*re-scored when a results\.csv that covers/, season.id);
    }
    assert.equal(season.shipPartial, season.forecast.partial === true, season.id);
  }
  assert.deepEqual([committed.results.commit.sha, committed.results.commit.date, committed.results.sha256],
    [manifest.results.commit, manifest.results.committed, manifest.results.sha256], 'results.csv is the pinned martj42 file');
});

test('the gate reads the same martj42 results.csv as the computed World Cup seasons', async () => {
  const worldCup = JSON.parse(await readFile(path.join(root, 'scripts/data/world-cup-seasons.json'), 'utf8')).sources.results;
  assert.equal(manifest.results.commit, worldCup.commit);
  assert.equal(manifest.results.committed, worldCup.committed);
  assert.equal(manifest.results.folder, worldCup.folder);
  assert.deepEqual([manifest.results.sha256, manifest.results.bytes], [worldCup.files[0].sha256, worldCup.files[0].bytes]);
});

test('the committed validation.json matches a fresh run from the cached Elo and results inputs', { skip: cachesAbsent }, async t => withTemp(async dir => {
  // Work on a copy so that the run never rewrites the cache's sources.json.
  const copy = path.join(dir, 'elo');
  await cp(eloCache, copy, { recursive: true, preserveTimestamps: true });
  const text = await readFile(committedPath, 'utf8'), committed = JSON.parse(text);
  const inputs = await loadEloFiles(committed.elo.files.map(file => file.file), { eloDir: copy, offline: true });
  const differ = committed.elo.files.filter(file => { const local = inputs.get(file.file);
    return !local || local.sha256 !== file.sha256 || local.fetchedAt.slice(0, 10) !== file.fetchedAt || local.dateFrom !== file.dateFrom; });
  if (differ.length) {
    t.skip(`the cached Elo inputs differ from those validation.json records (${differ.map(file => file.file).join(', ')}); rerun npm run validate:football to rescore with them`);
    return;
  }
  const fresh = serializeReport(await runValidation({ root, eloDir: copy, dataDir, offline: true, generatedAt: committed.generatedAt ?? null }));
  const stale = `${VALIDATION_FILE} is stale against the squads, engine-scale.json and the cached inputs; run npm run validate:football`;
  const summary = json => JSON.parse(json).seasons.map(season => [season.id, season.contentHash, season.verdict, season.crossSectional.gateSet?.spearman ?? null,
    season.shipVerdict, season.forecast.verdict, season.forecast.models?.roster.logLoss ?? null, season.forecast.models?.eloAtR.logLoss ?? null]);
  assert.deepEqual(summary(fresh), summary(text), stale);
  assert.equal(fresh, text, stale);
}));

// ---- forecast track ----
test('ordered-logit probabilities are proper and the scoring rules match hand-computed values', () => {
  for (const [z, c] of [[0, 0.6], [2.5, 0.6], [-1.3, 0.2], [0.4, 1.5], [12, 0.7]]) {
    const p = outcomeProbabilities(z, c);
    close(p[0] + p[1] + p[2], 1, `z ${z}, c ${c}:`);
    assert.ok(p.every(v => v > 0 && v < 1));
  }
  const [h, d, a] = outcomeProbabilities(0, 0.6);
  close(h, a, 'z = 0 is symmetric:');
  close(d, 1 / (1 + Math.exp(-0.6)) - 1 / (1 + Math.exp(0.6)), 'draw = σ(z + c) − σ(z − c):');
  assert.ok(outcomeProbabilities(1, 0.6)[0] > h && outcomeProbabilities(1, 0.6)[2] < a, 'a larger z favours home');
  // RPS over home < draw < away is ((p_H − y_H)² + (p_H + p_D − y_H − y_D)²) / 2; Brier sums all three squares.
  assert.deepEqual(scoreForecast([1, 0, 0], 0), { logLoss: 0, rps: 0, brier: 0 });
  const wrong = scoreForecast([0, 0, 1], 0);
  assert.equal(wrong.rps, 1);
  assert.equal(wrong.brier, 2);
  const third = 1 / 3, even = scoreForecast([third, third, third], 1);
  close(even.logLoss, Math.log(3));
  close(even.rps, 1 / 9, 'RPS of a uniform forecast of a draw:');
  close(even.brier, 2 / 3);
  const lean = scoreForecast([0.5, 0.3, 0.2], 2);
  close(lean.logLoss, -Math.log(0.2));
  close(lean.rps, (0.25 + 0.64) / 2);
  close(lean.brier, 0.25 + 0.09 + 0.64);
  assert.ok(scoreForecast([0.2, 0.3, 0.5], 0).rps > scoreForecast([0.2, 0.5, 0.3], 0).rps, 'RPS rewards mass near the outcome');
});

test('fitting synthetic matches recovers the known β, h and c', () => {
  const rng = mulberry32(20261019);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const truth = { beta: [0.8, -0.4], h: 0.3, c: 0.6 };
  const rows = Array.from({ length: 6000 }, () => {
    const x = [gauss(), gauss()], home = rng() < 0.6 ? 1 : 0;
    const p = outcomeProbabilities(truth.beta[0] * x[0] + truth.beta[1] * x[1] + truth.h * home, truth.c);
    const u = rng();
    return { x, home, outcome: u < p[0] ? 0 : u < p[0] + p[1] ? 1 : 2 };
  });
  const fit = fitOrderedLogit(rows, 2);
  assert.ok(fit.converged);
  for (const [k, value] of truth.beta.entries()) assert.ok(Math.abs(fit.beta[k] - value) < 0.1, `β${k} ${fit.beta[k]} vs ${value}`);
  assert.ok(Math.abs(fit.h - truth.h) < 0.1, `h ${fit.h}`);
  assert.ok(Math.abs(fit.c - truth.c) < 0.06, `c ${fit.c}`);
  const base = fitOrderedLogit(rows, 0);
  assert.ok(base.nll > fit.nll, 'the strength terms improve the likelihood');
  assert.deepEqual(fitOrderedLogit(rows, 2), fit, 'deterministic');
  // An all-neutral training set leaves h unidentified; the tiny ridge keeps it at 0 instead of failing.
  const neutral = fitOrderedLogit(rows.map(row => ({ ...row, home: 0 })), 2);
  assert.ok(neutral.converged && Math.abs(neutral.h) < 1e-9);
});

test('results.csv is read with a real CSV parser', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('x,"multi\nline"\n'), [['x', 'multi\nline']]);
  const text = ['date,home_team,away_team,home_score,away_score,tournament,city,country,neutral',
    '2026-06-11,Mexico,South Africa,2,1,FIFA World Cup,Mexico City,Mexico,FALSE',
    '2026-07-05,United States,Wales,1,1,Friendly,"Washington, D.C.",United States,TRUE',
    '2026-11-14,Spain,Italy,NA,NA,UEFA Nations League,Madrid,Spain,FALSE'].join('\n');
  const [first, quoted, fixture] = parseResults(text);
  assert.deepEqual(first, { date: '2026-06-11', home: 'Mexico', away: 'South Africa', homeScore: 2, awayScore: 1, tournament: 'FIFA World Cup', neutral: false });
  assert.equal(quoted.neutral, true, 'a quoted comma does not shift the neutral column');
  assert.equal(quoted.tournament, 'Friendly');
  assert.deepEqual([fixture.homeScore, fixture.awayScore], [null, null], 'unplayed fixtures have no score');
  assert.throws(() => parseResults('date,home_team\n2026-01-01,A'), /lacks column/);
  assert.throws(() => parseResults(`${text.split('\n')[0]}\n2026-01-01,A,B,1,0,Friendly,X,Y`), /has 8 fields/);
});

test('match windows split consecutive match dates at gaps over 10 days', () => {
  const { windows, windowOf } = matchWindows(['2026-06-21', '2026-03-31', '2026-06-11', '2026-06-11', '2026-07-01', '2026-07-12', '2026-09-04']);
  assert.deepEqual(windows, [{ index: 0, from: '2026-03-31', to: '2026-03-31' }, { index: 1, from: '2026-06-11', to: '2026-07-01' },
    { index: 2, from: '2026-07-12', to: '2026-07-12' }, { index: 3, from: '2026-09-04', to: '2026-09-04' }]);
  assert.equal(windowOf.get('2026-06-21'), 1);
  assert.equal(matchWindows(['2026-07-01', '2026-07-11']).windows.length, 1, 'a 10-day gap stays in the window');
  assert.equal(matchWindows(['2026-07-01', '2026-07-12']).windows.length, 2, 'an 11-day gap starts a new one');
  assert.equal(FORECAST.windowGapDays, 10);
});

test('cluster bootstrap SEs are seeded, resample whole clusters and need two clusters', () => {
  const values = [0.1, 0.3, -0.2, 0.4, 0, 0.2], keys = ['a', 'a', 'b', 'b', 'c', 'c'];
  const se = clusterBootstrapSe(values, keys);
  assert.deepEqual(clusterBootstrapSe(values, keys), se);
  assert.equal(se.clusters, 3);
  assert.ok(se.se > 0);
  assert.equal(clusterBootstrapSe([1, 1, 1, 1], ['a', 'a', 'b', 'b']).se, 0, 'equal clusters do not vary');
  assert.equal(clusterBootstrapSe([1, 2], ['a', 'a']).se, null);
  // Cluster order is sorted, so the input order of the matches does not change the answer.
  assert.deepEqual(clusterBootstrapSe(values.slice().reverse(), keys.slice().reverse()), se);
  const z = standardise({ A: 1, B: 2, C: 3 }, ['A', 'B', 'C']);
  close(z.z.A, -Math.sqrt(1.5));
  close(z.sd, Math.sqrt(2 / 3), 'population SD:');
});

test('match windows: each finals tournament is its own window, friendlies, qualifiers and Nations Leagues split by date', () => {
  // The 2026 summer: June friendlies run into the World Cup and go on during it, the ASEAN Championship follows,
  // and the next AFCON straddles New Year. Date gaps alone put the June friendlies and the World Cup in one window.
  const m = (date, tournament) => ({ date, tournament });
  const matches = [m('2026-06-04', 'Friendly'), m('2026-06-09', 'Friendly'), m('2026-06-11', 'FIFA World Cup'), m('2026-06-12', 'Friendly'),
    m('2026-07-19', 'FIFA World Cup'), m('2026-06-30', 'FIFA World Cup'), m('2026-07-25', 'ASEAN Championship'), m('2026-08-26', 'ASEAN Championship'),
    m('2026-09-24', 'UEFA Nations League'), m('2026-10-06', 'African Cup of Nations qualification'), m('2026-09-30', 'Friendly'),
    m('2026-12-21', 'African Cup of Nations'), m('2027-01-18', 'African Cup of Nations'), m('2026-01-10', 'African Cup of Nations')];
  const byDate = matchWindows(matches.map(match => match.date)).windowOf;
  assert.equal(byDate.get('2026-06-09'), byDate.get('2026-06-11'), 'date gaps alone merge the June friendlies into the World Cup');
  const { clusters, clusterOf } = matchClusters(matches);
  assert.deepEqual(clusters.map(c => [c.kind, c.label ?? null, c.from, c.to, c.matches]), [
    ['tournament', 'African Cup of Nations 2026-01-10', '2026-01-10', '2026-01-10', 1],
    ['window', null, '2026-06-04', '2026-06-12', 3],
    ['tournament', 'FIFA World Cup 2026', '2026-06-11', '2026-07-19', 3],
    ['tournament', 'ASEAN Championship 2026', '2026-07-25', '2026-08-26', 2],
    ['window', null, '2026-09-24', '2026-10-06', 3],
    ['tournament', 'African Cup of Nations 2026-12-21', '2026-12-21', '2027-01-18', 2],
  ], 'a tournament straddling New Year stays one window; two starting in one year are told apart by date');
  assert.deepEqual(clusters.map(c => c.index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(clusterOf, [1, 1, 2, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 0]);
  assert.ok(['Friendly', 'FIFA World Cup qualification', 'UEFA Nations League', 'CONCACAF Nations League'].every(isWindowCompetition));
  assert.ok(!['FIFA World Cup', 'Gulf Cup', 'Kirin Cup', 'FIFA Series', 'Oceania Nations Cup'].some(isWindowCompetition));
  assert.deepEqual(matchClusters([m('2026-06-04', 'Friendly'), m('2026-06-04', 'Friendly')]).clusters.map(c => c.matches), [2]);
});

test('folds hold whole windows, k = min(5, windows), balanced by match count', () => {
  const windows = [32, 1, 2, 3, 1, 100, 4, 2, 2, 1, 94, 1, 20, 184, 7, 12, 4, 11, 4].map((matches, index) => ({ index, matches }));
  const loads = foldOf => foldOf.reduce((sum, fold, i) => { sum[fold] += windows[i].matches; return sum; }, new Array(5).fill(0));
  assert.deepEqual(loads(windows.map(w => w.index % 5)), [238, 10, 35, 193, 9], 'index mod 5 would hold out half the matches in fold 0');
  const { k, foldOf } = groupFolds(windows);
  assert.equal(k, 5);
  assert.deepEqual(loads(foldOf), [184, 100, 94, 54, 53]);
  assert.deepEqual([foldOf[13], foldOf[5], foldOf[10]], [0, 1, 2], 'the three large windows each lead a fold');
  assert.deepEqual(groupFolds(windows.slice(0, 3)), { k: 3, foldOf: [0, 2, 1] }, 'fewer windows, fewer folds');
  assert.deepEqual(groupFolds(windows), { k, foldOf }, 'deterministic');
});

test('few clusters: the jackknife SE and a t(G − 1) margin', () => {
  // Cluster sums a 0.4, b 0.2, c 0.2 over two matches each: leave-one-out means 0.1, 0.15, 0.15, so
  // SE = √(2/3 · (0.0333² + 2·0.0167²)) = 1/30, the SE of the three cluster means.
  const values = [0.1, 0.3, -0.2, 0.4, 0, 0.2], keys = ['a', 'a', 'b', 'b', 'c', 'c'];
  close(clusterJackknifeSe(values, keys).se, 1 / 30);
  assert.equal(clusterJackknifeSe([1, 2], ['a', 'a']).se, null);
  assert.equal(clusteredSe(values, keys).method, 'cluster jackknife');
  const many = Array.from({ length: 40 }, (_, i) => (i * 7) % 5 - 2), manyKeys = many.map((_, i) => `k${i % 8}`);
  assert.deepEqual(clusteredSe(many, manyKeys), { ...clusterBootstrapSe(many, manyKeys), method: 'cluster bootstrap' }, 'eight clusters bootstrap');
  assert.equal(clusteredSe(many, many.map((_, i) => `k${i % 7}`)).method, 'cluster jackknife');
  for (const [df, t] of [[1, 12.7062], [2, 4.3027], [3, 3.1824], [4, 2.7764], [5, 2.5706], [6, 2.4469], [7, 2.3646], [30, 2.0423]])
    assert.equal(Math.round(studentTQuantile(0.975, df) * 1e4) / 1e4, t, `t(${df})`);
  assert.ok(Math.abs(studentTQuantile(0.975, 100000) - 1.96) < 1e-3);
  close(studentTCentral(1, 1), 0.5, 'Cauchy: P(|T| ≤ 1) = 1/2:');
  assert.deepEqual(criticalValue(8).critical, 2);
  assert.equal(criticalValue(7).critical, studentTQuantile(0.975, 6));
  assert.match(criticalValue(3).criticalRule, /^t\(2\) = 4\.3027 in place of 2: 3 clusters, fewer than 8/);
  assert.equal(FORECAST.jackknifeBelowClusters, 8);
});

// Twelve nations whose results follow strength i (N11 is suspended), in four match windows, plus matches outside the
// window, against an off-map side and with an excluded nation.
const FC_IDS = Array.from({ length: 12 }, (_, i) => `N${String(i).padStart(2, '0')}`);
const FC_NAMES = Object.fromEntries(FC_IDS.map(id => [`Team ${id}`, id]));
const fcResolve = name => (name in FC_NAMES ? FC_NAMES[name] : name === 'Offshore' ? null : undefined);
const FC_SEASON = { id: '2030-31', ratingsDate: '2030-09-18', informationDate: '2031-03-30', nationStatus: { N11: 'suspended' } };
const FC_NEXT = { id: '2031-32', informationDate: '2031-10-18' };
function forecastFixture({ matches = 120 } = {}) {
  const rng = mulberry32(31), truth = Object.fromEntries(FC_IDS.map((id, i) => [id, i])), z = standardise(truth, FC_IDS).z;
  const days = ['2031-04-0', '2031-06-1', '2031-09-0', '2031-10-0'], rows = [];
  for (let i = 0; i < matches * 4; i++) {
    const day = `${days[i % 4]}${1 + (i % 7)}`;
    const a = FC_IDS[Math.floor(rng() * 11)], b = FC_IDS[(FC_IDS.indexOf(a) + 1 + Math.floor(rng() * 10)) % 11];
    const neutral = rng() < 0.4, p = outcomeProbabilities(1.4 * (z[a] - z[b]) + (neutral ? 0 : 0.3), 0.65), u = rng();
    const [homeScore, awayScore] = u < p[0] ? [2, 0] : u < p[0] + p[1] ? [1, 1] : [0, 1];
    rows.push({ date: day, home: `Team ${a}`, away: `Team ${b}`, homeScore, awayScore, tournament: i % 3 ? 'FIFA World Cup qualification' : 'Friendly', neutral });
  }
  rows.push({ date: '2031-03-30', home: 'Team N01', away: 'Team N02', homeScore: 1, awayScore: 0, tournament: 'Friendly', neutral: false }, // on R_Y: the earlier season's
    { date: '2031-10-19', home: 'Team N01', away: 'Team N02', homeScore: 1, awayScore: 0, tournament: 'Friendly', neutral: false }, // after R_next
    { date: '2031-04-02', home: 'Team N03', away: 'Offshore', homeScore: 3, awayScore: 0, tournament: 'Friendly', neutral: false },
    { date: '2031-06-12', home: 'Team N11', away: 'Team N04', homeScore: 0, awayScore: 0, tournament: 'Friendly', neutral: false },
    { date: '2031-11-20', home: 'Team N01', away: 'Team N05', homeScore: null, awayScore: null, tournament: 'Friendly', neutral: false });
  return { matches: rows, lastMatchDate: '2031-10-19' };
}
const fcElo = values => ({ method: 'replay', ratings: new Map(FC_IDS.map(id => [`E${id}`, values[id]])), reasons: [] });
const fcRun = (overrides = {}) => forecastTrack({ season: FC_SEASON, nextSeason: FC_NEXT, results: forecastFixture(),
  strength: Object.fromEntries(FC_IDS.map((id, i) => [id, 60 + i])), elo: fcElo(Object.fromEntries(FC_IDS.map((id, i) => [id, 1500 + 40 * ((i * 7) % 12)]))),
  codes: Object.fromEntries(FC_IDS.map(id => [id, `E${id}`])), nationIds: FC_IDS, resolveName: fcResolve, ...overrides });

test('the forecast gate scores (R_Y, R_next] out of fold and passes a roster that beats a scrambled Elo', () => {
  const result = fcRun();
  assert.equal(result.verdict, 'pass', result.reasons.join('; '));
  assert.deepEqual(result.window.from, '2031-03-30');
  assert.deepEqual(result.counts, { inWindow: 482, offMap: 1, unknownNames: 0, excludedStatus: 1, gate: 480 });
  assert.deepEqual([result.coverage.complete, result.partial], [true, false], 'a match dated after R_next shows the window is covered');
  assert.deepEqual(result.matchWindows.map(w => [w.kind, w.from, w.to, w.matches, w.fold]),
    [['window', '2031-04-01', '2031-04-07', 120, 0], ['window', '2031-06-11', '2031-06-17', 120, 1], ['window', '2031-09-01', '2031-09-07', 120, 2], ['window', '2031-10-01', '2031-10-07', 120, 3]]);
  assert.match(result.method, /^4-fold cross-validation grouped by match window/);
  const { roster, eloAtR, eloPlusRoster, baseRates } = result.models;
  assert.ok(roster.logLoss < eloAtR.logLoss && roster.logLoss < baseRates.logLoss);
  assert.ok(Math.abs(roster.fitAllMatches.beta[0] - 1.4) < 0.35, `β ${roster.fitAllMatches.beta[0]}`);
  assert.equal(roster.competitive.n + roster.friendlies.n, roster.n, 'friendlies are reported apart, inside the gate');
  assert.equal(roster.folds.length, 4);
  assert.ok(roster.folds.every(fold => fold.trainMatches === 360 && fold.testMatches === 120), 'each window is held out whole');
  assert.equal(eloPlusRoster.features.length, 2);
  assert.equal(roster.excludedStatusMatches.n, 1, 'the suspended nation is scored apart');
  assert.deepEqual(result.excludedStatusMatches.nations, ['N11']);
  const rve = result.rosterVsElo;
  assert.ok(rve.meanDifference < 0 && rve.pass);
  assert.equal(rve.se, Math.max(rve.seByMatchWindow, rve.seByTeamPair), 'the larger clustered SE is used');
  assert.equal(rve.matchWindows, 4);
  // Four windows: a bootstrap of four blocks understates the error, so the window SE is a jackknife and the margin
  // takes t(3) = 3.1824 in place of 2.
  assert.deepEqual([rve.seMethodByMatchWindow, rve.seMethodByTeamPair], ['cluster jackknife', 'cluster bootstrap']);
  assert.equal(rve.critical, 3.1824);
  assert.match(rve.criticalRule, /^t\(3\) = 3\.1824 in place of 2: 4 clusters, fewer than 8/);
  assert.ok(Math.abs(rve.margin - studentTQuantile(0.975, 3) * rve.se) <= 2e-4, `margin ${rve.margin} = t(3)·SE (both rounded)`);
  assert.match(rve.gate, /\+ 3\.1824·SE/);
  assert.deepEqual(fcRun(), result, 'seeded and deterministic');
  // Swapped: a scrambled roster against the true order in Elo loses by far more than 2 SE.
  const swapped = fcRun({ strength: Object.fromEntries(FC_IDS.map((id, i) => [id, 60 + ((i * 7) % 12)])),
    elo: fcElo(Object.fromEntries(FC_IDS.map((id, i) => [id, 1500 + 40 * i]))) });
  assert.equal(swapped.verdict, 'fail');
  assert.match(swapped.reasons[0], /exceeds Elo-at-R_Y log loss/);
  // Reversed: β is free, so a roster in exactly reversed order fits a negative β and forecasts as well as the true
  // order. The sign check fails it.
  const reversed = fcRun({ strength: Object.fromEntries(FC_IDS.map((id, i) => [id, 70 - i])) });
  assert.ok(reversed.models.roster.fitAllMatches.beta[0] < 0);
  assert.ok(reversed.models.roster.logLoss < reversed.models.eloAtR.logLoss, 'the loss alone would pass');
  assert.equal(reversed.verdict, 'fail');
  assert.ok(reversed.reasons.some(reason => /stronger rosters are not predicted to win/.test(reason)));
});

test('the forecast gate is not scored while the window is open and incomplete without inputs', () => {
  const open = fcRun({ nextSeason: null });
  assert.equal(open.verdict, 'not scored');
  assert.equal(open.window.to, null);
  assert.equal(open.mappedMatchesSoFar, 482, 'mapped matches after R_Y so far, for information');
  const noResults = fcRun({ results: null });
  assert.deepEqual([noResults.verdict, noResults.missingInputs], ['incomplete', true]);
  const noElo = fcRun({ elo: { method: 'replay', ratings: new Map(), reasons: ['2031.tsv is not cached'] } });
  assert.deepEqual([noElo.verdict, noElo.missingInputs], ['incomplete', true]);
  assert.match(noElo.reasons.join(' '), /No verified Elo at R_Y 2031-03-30.*2031\.tsv is not cached/);
  const unknown = forecastFixture();
  unknown.matches.push({ date: '2031-06-13', home: 'Atlantis', away: 'Team N02', homeScore: 1, awayScore: 0, tournament: 'Friendly', neutral: true });
  const unmapped = fcRun({ results: unknown });
  assert.equal(unmapped.verdict, 'incomplete', 'an unmapped name never drops out silently');
  assert.equal(unmapped.missingInputs, undefined);
  assert.match(unmapped.reasons[0], /neither RESULTS_NAMES nor OFF_MAP_RESULTS_NAMES: Atlantis/);
  const thin = fcRun({ results: forecastFixture({ matches: 20 }) });
  assert.equal(thin.verdict, 'incomplete');
  assert.match(thin.reasons[0], /80 gate matches; the gate needs at least 100/);
});

test('a window results.csv does not cover yet keeps its verdict, marked partial with the covered range', () => {
  const partial = fcRun({ results: { ...forecastFixture(), lastMatchDate: '2031-10-07' } });
  assert.deepEqual([partial.verdict, partial.partial, partial.coverage.partial], ['pass', true, true], 'not turned into a failure, not hidden');
  assert.deepEqual(partial.coverage.covered, { from: '2031-03-30', to: '2031-10-07' });
  assert.equal(partial.coverage.commit, null);
  assert.match(partial.coverage.note, /no recorded commit.*rests on the partial window \(2031-03-30, 2031-10-07\] and must be re-scored when results\.csv covers 2031-10-18/);
  // A commit dated after R_next covers the window although its last match is earlier (nothing was played after it).
  const commit = date => fcRun({ results: { ...forecastFixture(), lastMatchDate: '2031-10-07', commit: { sha: 'a'.repeat(40), date } } });
  const later = commit('2031-10-19');
  assert.deepEqual([later.verdict, later.partial, later.coverage.covered], ['pass', false, { from: '2031-03-30', to: '2031-10-18' }]);
  assert.match(later.coverage.note, /commit aaaaaaa of 2031-10-19, after 2031-10-18, so it covers the whole window/);
  assert.equal(commit('2031-10-18').partial, true, 'a commit on R_next itself may still miss that day\'s matches');
  const swapped = fcRun({ results: { ...forecastFixture(), lastMatchDate: '2031-10-07' }, strength: Object.fromEntries(FC_IDS.map((id, i) => [id, 60 + ((i * 7) % 12)])),
    elo: fcElo(Object.fromEntries(FC_IDS.map((id, i) => [id, 1500 + 40 * i]))) });
  assert.deepEqual([swapped.verdict, swapped.partial], ['fail', true], 'a failing verdict on a partial window stays a failure');
  // The coverage rule on its own: by a match on or after R_next, or by a commit dated after it.
  const cover = (lastMatchDate, commitDate) => windowCoverage({ from: '2025-09-19', to: '2026-11-01', lastMatchDate, commit: commitDate ? { sha: 'b'.repeat(40), date: commitDate } : null });
  assert.equal(cover('2026-11-01').partial, false, 'a match on R_next');
  assert.equal(cover('2026-10-06', '2026-10-31').partial, true, 'the pinned martj42 commit of 31 October ends 6 October');
  assert.deepEqual(cover('2026-10-06', '2026-10-31').covered, { from: '2025-09-19', to: '2026-10-06' });
  assert.equal(cover('2026-10-06', '2026-11-02').partial, false);
});

// ---- results names ----
test('every map nation has one martj42 results name, distinct from the off-map sides', () => {
  assert.deepEqual(Object.keys(RESULTS_NAMES).sort(), [...TODAY_NATIONS].sort());
  const names = Object.values(RESULTS_NAMES);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(OFF_MAP_RESULTS_NAMES).size, OFF_MAP_RESULTS_NAMES.length, 'off-map names are unique');
  assert.deepEqual(names.filter(name => OFF_MAP_RESULTS_NAMES.includes(name)), []);
  assert.equal(nationForResultsName('Ivory Coast'), '384');
  assert.equal(nationForResultsName('Republic of Ireland'), '372');
  assert.equal(nationForResultsName('Taiwan'), '158');
  assert.equal(nationForResultsName('Czech Republic'), '203');
  assert.deepEqual(['Scotland', 'Wales', 'Northern Ireland', 'Tonga'].map(nationForResultsName), ['SCO', 'WAL', 'NIR', '776'], 'the home nations and the islands are on the map');
  assert.equal(nationForResultsName('Faroe Islands'), null, 'a listed off-map side');
  assert.equal(nationForResultsName('Atlantis'), undefined, 'a name in neither list');
});

test('every team name since 2014 maps to a nation or is listed off-map', {
  skip: !existsSync(resultsFile) && `${path.relative(root, resultsFile)} is absent; save martj42's results.csv there to check the names`,
}, async () => {
  const matches = parseResults(await readFile(resultsFile, 'utf8'));
  const unknown = rows => [...new Set(rows.flatMap(match => [match.home, match.away]))].filter(name => nationForResultsName(name) === undefined).sort();
  assert.deepEqual(unknown(matches.filter(match => match.date >= '2014-01-01')), []);
  const seen = new Set(matches.flatMap(match => [match.home, match.away]));
  assert.deepEqual(Object.values(RESULTS_NAMES).filter(name => !seen.has(name)), [], 'every results name occurs in results.csv');
});

// ---- full ship gate ----
test('ship verdicts: fail wins, an open forecast window is not scored, not applicable counts for neither', () => {
  const all = { provisional: 'pass', reepLinking: 'pass', forecast: 'pass', engineScale: 'pass', auditXIs: 'pass' };
  assert.equal(shipVerdictOf(all), 'pass');
  assert.equal(shipVerdictOf({ ...all, reepLinking: 'not available' }), 'incomplete');
  assert.equal(shipVerdictOf({ ...all, reepLinking: NOT_APPLICABLE, engineScale: NOT_APPLICABLE }), 'pass');
  assert.equal(shipVerdictOf({ ...all, forecast: 'not scored' }), 'not scored');
  assert.equal(shipVerdictOf({ ...all, forecast: 'not scored', engineScale: 'fail' }), 'fail');
  assert.equal(shipVerdictOf({ ...all, engineScale: 'incomplete' }), 'incomplete');
  assert.match(implicationOf({ builtIn: true, provisionalVerdict: 'pass', shipVerdict: 'not scored', shipVerdicts: { ...all, forecast: 'not scored' } }),
    /pass the provisional gate; the full gate waits for the season's forecast window/);
  assert.match(implicationOf({ builtIn: true, provisionalVerdict: 'fail', shipVerdict: 'fail', shipVerdicts: { ...all, provisional: 'fail' } }), /look before shipping them/);
  assert.match(implicationOf({ builtIn: false, provisionalVerdict: 'fail', shipVerdict: 'fail', shipVerdicts: { ...all, provisional: 'fail' } }),
    /^Fails the full gate \(provisional fail\)\. The season ships regardless/);
  const partial = { window: { from: '2025-09-19', to: '2026-11-01' }, covered: { from: '2025-09-19', to: '2026-10-06' } };
  assert.match(implicationOf({ builtIn: false, provisionalVerdict: 'pass', shipVerdict: 'pass', shipVerdicts: all, partial }),
    /^Passes the full gate\. The forecast rests on a partial window: results\.csv covers \(2025-09-19, 2026-10-06\] of \(2025-09-19, 2026-11-01\]/);
});

test('Reep linking, engine-scale and audit XI checks', () => {
  const auditPath = 'docs/design/football-roster-audit.json';
  assert.equal(reepLinkingCheckOf({ linking: { meanEaMinusFm: 0.1 } }).verdict, 'not available', 'fuzzy linking alone is not the Reep rerun');
  assert.equal(reepLinkingCheckOf(null).verdict, 'not available');
  assert.equal(reepLinkingCheckOf({ linking: { reep: { pairs: 9000, meanEaMinusFm: -0.4, ci95: [-0.5, -0.3] } } }).verdict, 'pass');
  assert.equal(reepLinkingCheckOf({ linking: { reep: { meanEaMinusFm: SHIP_GATE.reepLinkingMaxAbsMean } } }).verdict, 'pass', 'inclusive');
  assert.equal(reepLinkingCheckOf({ linking: { reep: { meanEaMinusFm: 1.3 } } }).verdict, 'fail');

  const entry = (contentHash, verdict) => ({ contentHash, label: 'Fixture', verdict, failed: verdict === 'pass' ? [] : ['T_n SD'],
    starters: { sd: 10, quantiles: { q10: 54, q50: 69, q90: 81 } }, strength: { sd: 9.5 }, probe: { favouriteWinRate: 0.74, upsetRate: 0.09, pairs: 3462 }, production: { pooled: {} } });
  const file = verdict => ({ reference: { contentHash: 'aaaaaaaaaaaa', label: 'Before' }, builtIn: entry('bbbbbbbbbbbb', verdict) });
  const season = { contentHash: 'bbbbbbbbbbbb' };
  assert.equal(engineScaleCheck({ engineScale: null, season, builtIn: true }).verdict, 'incomplete');
  assert.equal(engineScaleCheck({ engineScale: file('pass'), season, builtIn: true }).verdict, 'pass');
  assert.deepEqual(engineScaleCheck({ engineScale: file('pass'), season, builtIn: true }).reference, { contentHash: 'aaaaaaaaaaaa', label: 'Before' });
  const failed = engineScaleCheck({ engineScale: file('fail'), season, builtIn: true });
  assert.deepEqual([failed.verdict, failed.reasons], ['fail', ['Engine scale fails T_n SD']]);
  const rebuilt = engineScaleCheck({ engineScale: file('pass'), season: { contentHash: 'cccccccccccc' }, builtIn: true });
  assert.equal(rebuilt.verdict, 'incomplete', 'rebuilt squads need a new engine-scale run');
  assert.match(rebuilt.reasons[0], /scores the built-in at bbbbbbbbbbbb, but the shipped squads are cccccccccccc; run npm run engine-scale:football/);
  assert.equal(engineScaleCheck({ engineScale: file('pass'), season, builtIn: false }).verdict, NOT_APPLICABLE);

  const nations = { A: ['A', 'A', 'UEFA'], B: ['B', 'B', 'UEFA'] }, rosters = { A: [70, 20, new Array(11).fill(shirt(70))], B: [60, 9, new Array(11).fill(shirt(60))] };
  const coverage = [{ id: 'A', players: 11, goalkeeper: true, naturalLineup: true }, { id: 'B', players: 11, goalkeeper: true, naturalLineup: false }];
  const listed = auditXIsCheck({ audit: { coverage }, auditPath, rosters, nations, fielded: ['A', 'B'] });
  assert.deepEqual([listed.verdict, listed.incompleteXIs], ['pass', ['B']]);
  assert.equal(auditXIsCheck({ audit: { coverage: coverage.slice(0, 1) }, auditPath, rosters, nations, fielded: ['A', 'B'] }).verdict, 'fail');
  assert.equal(auditXIsCheck({ audit: { coverage: [coverage[0], { ...coverage[1], players: 10 }] }, auditPath, rosters, nations, fielded: ['A', 'B'] }).verdict, 'fail');
  assert.equal(auditXIsCheck({ audit: {}, auditPath, rosters, nations, fielded: ['A', 'B'] }).verdict, 'not available');
  // A season file's own coverage counts.
  const setCoverage = { listed: { nations: 2, completeXIs: 1 }, withPlayers: 2, naturalXIs: 1 };
  assert.equal(auditXIsCheck({ auditPath: 'public/football/x.json', rosters, nations, fielded: ['A', 'B'], setCoverage }).verdict, 'pass');
  const wrong = auditXIsCheck({ auditPath: 'public/football/x.json', rosters, nations, fielded: ['A', 'B'], setCoverage: { ...setCoverage, naturalXIs: 2 } });
  assert.deepEqual([wrong.verdict, wrong.reasons], ['fail', ['public/football/x.json counts 1 complete natural XIs, its squads 2']]);
});
const reepLinkingCheckOf = audit => buildReport({ nations: FIXTURE_NATIONS, codes: FIXTURE_CODES, files: fixtureFiles(), inputs: [fixtureInput({ audit })] }).seasons[0].reepLinking;

test('the report adds the ship gate beside the unchanged provisional gate', () => {
  const [season] = report().seasons;
  assert.deepEqual([season.gate, season.verdict, season.provisionalVerdict], ['provisional', 'pass', 'pass']);
  assert.deepEqual(season.shipVerdicts, { provisional: 'pass', reepLinking: 'not available', forecast: 'not scored', engineScale: 'incomplete', auditXIs: 'not available' });
  assert.equal(season.shipVerdict, 'not scored', 'the newest season waits for its window');
  const older = { ...fixtureSeason, id: '2029-30', label: '2029/30', squads: 'ea-fc-30' };
  const withNewer = buildReport({ nations: FIXTURE_NATIONS, codes: FIXTURE_CODES, files: fixtureFiles(), seasons: [fixtureSeason, older],
    inputs: [fixtureInput({ season: older, builtIn: false, hasFm: false, audit: null })] });
  assert.equal(withNewer.seasons[0].forecast.window.to, '2030-09-18', 'a newer season closes the window');
  assert.deepEqual([withNewer.seasons[0].forecast.verdict, withNewer.seasons[0].forecast.missingInputs], ['incomplete', true]);
  assert.equal(withNewer.results.cached, false);
});

test('the report never scores the forecast against a World.tsv taken after R_Y, and marks a partly covered window', () => {
  // R_Y on 20 November 2030: the cached 2030 results stop in January and were fetched on 1 October, so no replay
  // reaches R_Y and only World.tsv could stand in.
  const season = { ...fixtureSeason, informationDate: '2030-11-20' }, newer = { ...fixtureSeason, id: '2031-32', informationDate: '2031-10-18' };
  const results = { matches: [], lastMatchDate: '2031-10-06', sha256: 'f'.repeat(64), commit: { sha: 'd'.repeat(40), date: '2031-10-10' },
    source: 'fixture', url: 'https://example.test', license: 'CC0-1.0', file: 'results.csv' };
  const run = worldFetchedAt => buildReport({ nations: FIXTURE_NATIONS, codes: FIXTURE_CODES, seasons: [newer, season], results,
    files: new Map([...fixtureFiles(), ['World.tsv', cached(table(ELO), worldFetchedAt)]]),
    inputs: [fixtureInput({ season })] }).seasons[0];
  const leaky = run('2030-11-23T08:00:00Z');
  assert.equal(leaky.elo.method, 'replay', 'D_Y itself still replays');
  assert.deepEqual([leaky.forecast.verdict, leaky.forecast.missingInputs], ['incomplete', true], 'missing input, not a verdict: the CLI will not write it');
  assert.match(leaky.forecast.reasons.join(' '), /No verified Elo at R_Y 2030-11-20.*World\.tsv was fetched on 2030-11-23, 3 days after 2030-11-20, so it has seen results of matches the forecast gate scores.*\(leakage\)/);
  assert.equal(leaky.forecast.elo.method, null);
  const onTheDay = run('2030-11-20T08:00:00Z');
  assert.deepEqual([onTheDay.forecast.elo.method, onTheDay.forecast.elo.daysFromRatingsDate], ['world', 0]);
  assert.equal(onTheDay.forecast.missingInputs, undefined);
  assert.deepEqual([onTheDay.forecast.partial, onTheDay.shipPartial], [true, true]);
  assert.deepEqual(onTheDay.forecast.coverage.covered, { from: '2030-11-20', to: '2031-10-06' });
  assert.match(onTheDay.implication, /The forecast rests on a partial window: results\.csv covers \(2030-11-20, 2031-10-06\] of \(2030-11-20, 2031-10-18\], so it is re-scored when a results\.csv that covers 2031-10-18 is pinned\.$/);
  assert.equal(report().seasons[0].shipPartial, false, 'an open window is not partial');
});

test('results.csv is the file the manifest pins, read without a download', async () => withTemp(async dir => {
  const header = 'date,home_team,away_team,home_score,away_score,tournament,city,country,neutral';
  const csv = [header, '2026-10-06,Saudi Arabia,United Arab Emirates,2,0,Gulf Cup,Jeddah,Saudi Arabia,FALSE', '2026-11-14,Spain,Italy,NA,NA,Friendly,Madrid,Spain,FALSE'].join('\n');
  await mkdir(path.join(dir, 'martj42-results'));
  await writeFile(path.join(dir, 'martj42-results', 'results.csv'), csv);
  const pin = { ...manifest.results, sha256: sha(csv), bytes: Buffer.byteLength(csv), committed: '2026-10-31' };
  const logs = [];
  const loaded = await loadResults({ dataDir: dir, pin, log: message => logs.push(message) });
  assert.deepEqual([loaded.lastMatchDate, loaded.commit, loaded.matches.length], ['2026-10-06', { sha: pin.commit, date: '2026-10-31' }, 2], 'an unplayed fixture does not count');
  assert.equal(await loadResults({ dataDir: dir, pin: { ...pin, sha256: 'e'.repeat(64) }, log: message => logs.push(message) }), null, 'another file is not used');
  assert.match(logs.at(-1), /is not the pinned file/);
  assert.equal(await loadResults({ dataDir: path.join(dir, 'none'), pin, log: message => logs.push(message) }), null);
  assert.match(logs.at(-1), /is missing; save results\.csv/);
  await assert.rejects(loadResults({ dataDir: dir, pin: { ...pin, committed: '2026-10-05' } }), /match dated 2026-10-06, after its commit's day 2026-10-05/);
}));
