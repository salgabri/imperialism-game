// Snapshot the FBS college football seasons 2009 to 2025, which no game rated, computed from the facts sportsdataverse
// publishes (docs/design/college-football.md, "Earlier seasons"), into scripts/data/cfb-seasons/<season>.json
// (committed), for scripts/build-cfb-seasons.mjs to build the seasons from.
//
// Each season's rostered players of its FBS schools (cfbfastR-data's rosters, CollegeFootballData.com's) are valued from
// their box scores and plays (cfbfastR-cfb-data's ESPN-derived tables) and recruiting (247Sports' composite), over the
// season and the two before it (scripts/lib/cfb-history.mjs); each school's best at each position are ranked across the
// season and read off College Football 27's ratings at that position (the built-in season, Week 10 Ratings). Each school
// then moves toward its results (docs/design/computed-ratings.md, step 5): its Simple Rating System over the season's
// games between FBS schools, the margin the match model gives a point of the strength it plays, and a whole-number move of
// its players toward its target, which never reorders them.
//
// The value's weights were fitted once (--tune) to College Football 27's launch ratings (iteration 1-base, EA SPORTS'
// ratings site, cached in data-src/college-football/1-base/) of the players of 2025 who returned in 2026, and are frozen
// in VALUE_WEIGHTS; scripts/data/cfb-seasons/calibration.json records how well they order each position.
//
// The source files stay in the gitignored data-src/cfb-history/, each read only when it is the file
// scripts/data/cfb-seasons-sources.json pins (SHA-256), fetched (--fetch) from the pinned commits of
// https://github.com/sportsdataverse/cfbfastR-data and https://github.com/sportsdataverse/cfbfastR-cfb-data through
// raw.githubusercontent.com.
//
// Usage: node scripts/sync-cfb-seasons.mjs [--season=<year>] [--check] [--fetch [--pin]] [--tune]
//   --season  one season only
//   --check   rebuild the snapshots and the calibration and compare them byte for byte; writes nothing
//   --fetch   download the pinned source files that data-src/cfb-history/ lacks; with --pin, first pin each source
//             repository's current commit (GitHub's API) and every file's SHA-256
//   --tune    fit the weights again and print them with their agreement; with --write, record them in
//             scripts/data/cfb-seasons/calibration.json
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { politeFetch } from './lib/polite-fetch.mjs';
import { parquetMetadata, readParquet } from './lib/parquet.mjs';
import {
  boxOf, DEPTH, FIRST_CLASS, FIRST_SEASON, fitWeights, LAST_SEASON, PARTICIPANTS_FROM, participantsOf, plain, POSITIONS, rateSeason,
  recruitsOf, regimeOf, rosterOf, scheduleOf, seasonPlayers, SIGNALS, SOURCE_NAMES, standardise, teamTotalsOf, valueSeason, shrinkSignals,
} from './lib/cfb-history.mjs';
import { clubMoveOf, mean, perPointOf, ratingsOf, referenceOf, resultsTargets, spearman, srsOf } from './lib/computed-ratings.mjs';
import { FORMATION, POSITION_OF, shortOf, squadOf } from './lib/nfl.mjs';
import { hashStr, makeRng, selectLineup } from '../src/data/teams.js';
import { americanFootballProfile, sampleResult } from '../src/sports/americanFootball.js';
import * as college from '../src/sports/collegeFootball.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/cfb-history');
const outDir = path.join(root, 'scripts/data/cfb-seasons');
const sourcesFile = path.join(root, 'scripts/data/cfb-seasons-sources.json');
const manifestFile = path.join(root, 'scripts/data/cfb-seasons.json');
const teamsFile = path.join(root, 'scripts/data/cfb-teams.json');
const referenceFile = path.join(root, 'scripts/data/college-football-27.json');
const launchDir = path.join(root, 'data-src/college-football/1-base');
const SPORT = 'college-football';
/** The most lineup places a school's roster may leave short for it to play the season. */
export const MAX_GAPS = 2;
const SEASONS = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
/** The season whose players' facts the weights were fitted on, against College Football 27's launch ratings. */
const TUNING_SEASON = 2025;

/**
 * The value's weights, by regime and position (scripts/lib/cfb-history.mjs SIGNALS): fitted by --tune on 2025 against
 * College Football 27's launch ratings and frozen. Their proportions order the players; they sum to 1.
 */
export const VALUE_WEIGHTS = Object.freeze({
  full: Object.freeze({
    QB: Object.freeze({ passYdsPG: 0.253, anya: 0.16, rushYdsPG: 0.126, grade: 0.276, exp: 0.185 }),
    RB: Object.freeze({ rushYdsPG: 0.516, ypc: 0.033, recYdsPG: 0.034, grade: 0.271, exp: 0.145 }),
    WR: Object.freeze({ recShare: 0.141, recYdsPG: 0.409, recTdPG: 0.023, grade: 0.266, exp: 0.161 }),
    TE: Object.freeze({ recShare: 0.092, recYdsPG: 0.501, grade: 0.248, exp: 0.159 }),
    OL: Object.freeze({ grade: 0.316, exp: 0.43, weight: 0.084, appearShare: 0.17 }),
    DL: Object.freeze({ tacklesPG: 0.165, sacksPG: 0.174, appearShare: 0.05, grade: 0.263, exp: 0.204, weight: 0.145 }),
    LB: Object.freeze({ tacklesPG: 0.352, sacksPG: 0.133, pdPG: 0.02, intPG: 0.091, grade: 0.206, exp: 0.197 }),
    CB: Object.freeze({ pdPG: 0.077, tacklesPG: 0.144, intPG: 0.152, appearShare: 0.12, grade: 0.276, exp: 0.232 }),
    S: Object.freeze({ tacklesPG: 0.247, pdPG: 0.012, intPG: 0.187, appearShare: 0.07, grade: 0.236, exp: 0.248 }),
    K: Object.freeze({ fgmPG: 0.249, fgPct: 0.117, xpaPG: 0.205, grade: 0.158, exp: 0.272 }),
  }),
  early: Object.freeze({
    QB: Object.freeze({ passYdsPG: 0.253, anya: 0.16, rushYdsPG: 0.126, grade: 0.276, exp: 0.185 }),
    RB: Object.freeze({ rushYdsPG: 0.516, ypc: 0.033, recYdsPG: 0.034, grade: 0.271, exp: 0.145 }),
    WR: Object.freeze({ recShare: 0.141, recYdsPG: 0.409, recTdPG: 0.023, grade: 0.266, exp: 0.161 }),
    TE: Object.freeze({ recShare: 0.092, recYdsPG: 0.501, grade: 0.248, exp: 0.159 }),
    OL: Object.freeze({ grade: 0.375, exp: 0.519, weight: 0.099, boxAppearShare: 0.006 }),
    DL: Object.freeze({ boxAppearShare: 0.069, grade: 0.379, exp: 0.398, weight: 0.155 }),
    LB: Object.freeze({ intPG: 0.308, boxAppearShare: 0.015, grade: 0.305, exp: 0.372 }),
    CB: Object.freeze({ intPG: 0.356, boxAppearShare: 0.04, grade: 0.299, exp: 0.305 }),
    S: Object.freeze({ intPG: 0.338, boxAppearShare: 0.059, grade: 0.254, exp: 0.349 }),
    K: Object.freeze({ fgmPG: 0.249, fgPct: 0.117, xpaPG: 0.205, grade: 0.158, exp: 0.272 }),
  }),
});

// ---------- the sources ----------

const REPOS = Object.freeze({
  'cfbfastR-data': { owner: 'sportsdataverse', repo: 'cfbfastR-data' },
  'cfbfastR-cfb-data': { owner: 'sportsdataverse', repo: 'cfbfastR-cfb-data' },
});
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Every source file: its repository, its path there and where data-src/cfb-history/ keeps it. */
export function sourceFiles() {
  const cfb = (dataset, years) => years.map(year => ({ repo: 'cfbfastR-cfb-data', path: `cfb/${dataset}/parquet/${dataset}_${year}.parquet`,
    local: `cfbfastR-cfb-data/${dataset}/${dataset}_${year}.parquet` }));
  return [
    ...range(FIRST_SEASON, LAST_SEASON).map(year => ({ repo: 'cfbfastR-data', path: `rosters/csv/cfb_rosters_${year}.csv`,
      local: `cfbfastR-data/rosters/cfb_rosters_${year}.csv` })),
    ...cfb('cfb_schedules', range(FIRST_SEASON - 2, LAST_SEASON)),
    ...cfb('player_box', range(FIRST_CLASS, LAST_SEASON)),
    ...cfb('play_participants', range(PARTICIPANTS_FROM, LAST_SEASON)),
    ...cfb('cfb_recruits', range(FIRST_CLASS, LAST_SEASON)),
  ];
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rawUrl = (file, commit) => `https://raw.githubusercontent.com/${REPOS[file.repo].owner}/${REPOS[file.repo].repo}/${commit}/${file.path}`;

async function pinRepos() {
  const repos = {};
  for (const [key, { owner, repo }] of Object.entries(REPOS)) {
    const response = await politeFetch(`https://api.github.com/repos/${owner}/${repo}/commits/main`, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub's API answered ${response.status} for ${owner}/${repo}`);
    const commit = (await response.json()).sha;
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`No commit for ${owner}/${repo}`);
    repos[key] = { url: `https://github.com/${owner}/${repo}`, commit };
  }
  return repos;
}

async function fetchSources(pin) {
  let sources = existsSync(sourcesFile) ? JSON.parse(await readFile(sourcesFile, 'utf8')) : null;
  if (pin || !sources) {
    sources = { note: SOURCES_NOTE, retrieved: new Date().toISOString().slice(0, 10), repos: await pinRepos(), files: {} };
  }
  for (const file of sourceFiles()) {
    const local = path.join(cacheDir, file.local);
    const pinned = sources.files[file.local];
    // A file already pinned and on disk is kept; pinning reads every file again from the pinned commit.
    if (pinned && existsSync(local) && sha256(await readFile(local)) === pinned) continue;
    const response = await politeFetch(rawUrl(file, sources.repos[file.repo].commit), { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (pinned && sha256(bytes) !== pinned) throw new Error(`${file.path} at ${sources.repos[file.repo].commit} is not the pinned file`);
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, bytes);
    sources.files[file.local] = sha256(bytes);
    console.log(`fetched ${file.repo}/${file.path} (${Math.round(bytes.length / 1024)} KB)`);
  }
  sources.files = Object.fromEntries(Object.entries(sources.files).sort((a, b) => a[0].localeCompare(b[0])));
  await writeFile(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`Pinned ${Object.keys(sources.files).length} files at ${Object.entries(sources.repos).map(([k, r]) => `${k}@${r.commit.slice(0, 8)}`).join(', ')}`);
}
const SOURCES_NOTE = 'The files the earlier college football seasons are computed from (scripts/sync-cfb-seasons.mjs): sportsdataverse\'s cfbfastR-data (rosters, CollegeFootballData.com\'s) and cfbfastR-cfb-data (schedules, box scores, play participants and recruiting classes, ESPN- and 247Sports-derived), each at the pinned commit, fetched through raw.githubusercontent.com and kept in the gitignored data-src/cfb-history/ (the path each key names), each read only when its SHA-256 is the one pinned here.';

// ---------- reading ----------

let pins = null;
const cache = new Map();
/** A pinned source file's bytes (data-src/cfb-history/<local>). */
async function pinned(local) {
  pins ??= JSON.parse(await readFile(sourcesFile, 'utf8'));
  const want = pins.files[local];
  if (!want) throw new Error(`${local} is not pinned in ${path.relative(root, sourcesFile)}`);
  const file = path.join(cacheDir, local);
  if (!existsSync(file)) throw new Error(`${local} is not in data-src/cfb-history/: run npm run sync:cfb-seasons -- --fetch`);
  const bytes = await readFile(file);
  if (sha256(bytes) !== want) throw new Error(`${local} is not the pinned file`);
  return bytes;
}
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
// The columns each table is read for (the others' pages are never decoded); parsed rows are not kept, only what is made of them.
const COLUMNS = {
  cfb_schedules: ['game_id', 'season', 'season_type', 'completed', 'neutral_site', 'home_id', 'home_division', 'home_conference', 'home_points',
    'away_id', 'away_division', 'away_conference', 'away_points'],
  player_box: ['game_id', 'team_id', 'athlete_id', 'athlete_name', 'category', 'completions/passingAttempts', 'passingYards', 'passingTouchdowns',
    'interceptions', 'rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns',
    'fieldGoalsMade/fieldGoalAttempts', 'extraPointsMade/extraPointAttempts', 'kickReturns', 'puntReturns'],
  play_participants: ['game_id', 'tackler_player_id', 'assisted_by_player_id', 'sacked_by_player_id', 'pass_defender_player_id', 'forced_by_player_id'],
  cfb_recruits: ['player_name', 'grade', 'stars', 'position', 'team_id'],
};
// A table's file may lack a column no row of its season fills (2004's box scores have no kick returns): those are skipped.
const parquet = async (dataset, year) => {
  const bytes = new Uint8Array(await pinned(`cfbfastR-cfb-data/${dataset}/${dataset}_${year}.parquet`));
  const present = new Set(parquetMetadata(bytes).columns.map(column => column.name));
  return readParquet(bytes, { columns: COLUMNS[dataset].filter(name => present.has(name)) });
};

async function context() {
  return once('context', async () => {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const teams = JSON.parse(await readFile(teamsFile, 'utf8')).teams;
    const espnOf = manifest.espn;
    const schoolOfEspn = new Map(Object.entries(espnOf).map(([school, espn]) => [espn, school]));
    // The rosters name schools as CollegeFootballData.com does: by the game's label, or as SOURCE_NAMES has them.
    const byLabel = new Map(Object.entries(teams).map(([id, t]) => [t.label, id]));
    for (const [id, school] of Object.entries(manifest.schools ?? {})) byLabel.set(school.name, id);
    const schoolOf = name => byLabel.get(name) ?? SOURCE_NAMES[name] ?? null;
    return { manifest, teams, espnOf, schoolOfEspn, schoolOf };
  });
}

/** Everything season `s` is computed from (scripts/lib/cfb-history.mjs seasonPlayers). */
async function seasonData(s) {
  const { espnOf, schoolOf } = await context();
  const rosters = new Map(), boxes = new Map(), participants = new Map(), totals = new Map(), fbs = new Map();
  for (const year of range(FIRST_SEASON, LAST_SEASON)) {
    rosters.set(year, await once(`roster/${year}`, async () => rosterOf((await pinned(`cfbfastR-data/rosters/cfb_rosters_${year}.csv`)).toString('utf8'), schoolOf)));
  }
  for (const year of range(s - 2, s)) {
    const schedule = await once(`schedule/${year}`, async () => scheduleOf(await parquet('cfb_schedules', year)));
    fbs.set(year, schedule.fbs);
    const box = await once(`box/${year}`, async () => boxOf(await parquet('player_box', year)));
    boxes.set(year, box);
    totals.set(year, await once(`totals/${year}`, async () => teamTotalsOf(box)));
    if (year >= PARTICIPANTS_FROM) participants.set(year, await once(`participants/${year}`, async () => participantsOf(await parquet('play_participants', year))));
  }
  const recruits = await once(`recruits/${s}`, async () => recruitsOf(await Promise.all(range(FIRST_CLASS, s).map(async year => [year, await parquet('cfb_recruits', year)]))));
  const firstSeen = await once(`first/${s}`, async () => {
    const out = new Map();
    for (const year of range(FIRST_CLASS, s)) {
      const box = await once(`box/${year}`, async () => boxOf(await parquet('player_box', year)));
      for (const id of box.keys()) if (!out.has(id)) out.set(id, year);
      if (year >= FIRST_SEASON) for (const e of rosters.get(year)) if (!out.has(e.id)) out.set(e.id, year);
    }
    return out;
  });
  // Every school each athlete played for, by year: his box scores' (any division's) and his rosters' (the game's schools).
  const history = await once(`history/${s}`, async () => {
    const out = new Map();
    const add = (id, year, team) => { if (team == null) return; if (!out.has(id)) out.set(id, []); out.get(id).push([year, team]); };
    for (const year of range(FIRST_CLASS, s)) {
      const box = await once(`box/${year}`, async () => boxOf(await parquet('player_box', year)));
      for (const [id, p] of box) add(id, year, p.team);
      if (year >= FIRST_SEASON) for (const e of rosters.get(year)) add(e.id, year, espnOf[e.school]);
    }
    return out;
  });
  const schools = (await once(`schedule/${s}`, async () => scheduleOf(await parquet('cfb_schedules', s)))).schools;
  return { season: s, espnOf, rosters, boxes, participants, totals, fbs, schools, recruits, firstSeen, history };
}

/** College Football 27's ratings at each game position, each school's (Week 10 Ratings, the built-in season). */
async function referenceClubs() {
  return once('reference', async () => {
    const snapshot = JSON.parse(await readFile(referenceFile, 'utf8'));
    const byPosition = Object.fromEntries(POSITIONS.map(p => [p, new Map()]));
    for (const [, , team, listed, overall] of snapshot.players) {
      const position = POSITION_OF[listed];
      if (!position) continue;
      if (!byPosition[position].has(team)) byPosition[position].set(team, []);
      byPosition[position].get(team).push(overall);
    }
    const reference = Object.fromEntries(POSITIONS.map(p => [p, referenceOf([...byPosition[p].values()], DEPTH[p])]));
    return { reference, source: snapshot.source };
  });
}

// ---------- the tuning ----------

/** College Football 27's launch ratings (iteration 1-base) from data-src/college-football/1-base/: Map 'plain name|school' and plain name → `{ overall, position }`. */
async function launchRatings() {
  const { teams } = await context();
  const schoolOfEa = new Map(Object.entries(teams).map(([id, t]) => [t.ea, id]));
  if (!existsSync(launchDir)) throw new Error('No launch ratings in data-src/college-football/1-base/: run the College Football sync with --iteration=1-base');
  const byTeam = new Map(), byName = new Map();
  for (const file of (await readdir(launchDir)).filter(f => /^page-\d+\.json$/.test(f))) {
    const page = JSON.parse(await readFile(path.join(launchDir, file), 'utf8'));
    if (page.game !== 'college-football-27') throw new Error(`${file} is ${page.game}`);
    for (const item of page.items) {
      if (item.iteration?.id !== '1-base') throw new Error(`${file}: an item of ${item.iteration?.id}`);
      const name = plain(`${item.firstName} ${item.lastName}`), school = schoolOfEa.get(item.team.id);
      const rec = { overall: item.overallRating, position: POSITION_OF[item.position.id] ?? item.position.id };
      byTeam.set(`${name}|${school}`, rec);
      byName.set(name, byName.has(name) ? null : rec);
    }
  }
  return { byTeam, byName };
}

/**
 * The weights fitted on the tuning season, by regime and position: each position's players matched by name (at their
 * school, else uniquely by name: a transfer) to College Football 27's launch ratings, the regime's signals standardised
 * over all the season's players at the position, regressed on the launch rating (fitWeights). Also how well they order
 * the matched players, in and out of sample (two halves of the schools, each fitted on the other).
 */
async function tune() {
  const data = await seasonData(TUNING_SEASON);
  const { players } = seasonPlayers(data);
  const launch = await launchRatings();
  const out = { season: TUNING_SEASON, regimes: {} };
  for (const regime of ['full', 'early']) {
    out.regimes[regime] = {};
    for (const position of POSITIONS) {
      const at = players.filter(p => p.position === position).map(p => ({ ...p, signals: { ...p.signals } }));
      shrinkSignals(at);
      const { columns } = standardise(at, SIGNALS[regime][position]);
      const matched = [];
      at.forEach((p, i) => {
        const key = plain(p.name);
        const m = launch.byTeam.get(`${key}|${p.school}`) ?? launch.byName.get(key);
        if (m && m.position === position) matched.push(i);
      });
      const X = Object.fromEntries(Object.entries(columns).map(([s, col]) => [s, matched.map(i => col[i])]));
      const y = matched.map(i => { const p = at[i], key = plain(p.name); return (launch.byTeam.get(`${key}|${p.school}`) ?? launch.byName.get(key)).overall; });
      const { weights } = fitWeights(X, y);
      const value = i => Object.entries(weights).reduce((t, [s, w]) => t + w * columns[s][i], 0);
      const inSample = spearman(matched.map(value), y);
      // Out of sample: schools split by their id's hash; each half's players valued by weights fitted on the other.
      const half = i => hashStr(at[i].school) % 2;
      const held = [];
      for (const h of [0, 1]) {
        const train = matched.map((i, k) => [i, k]).filter(([i]) => half(i) !== h);
        const test = matched.map((i, k) => [i, k]).filter(([i]) => half(i) === h);
        const fitted = fitWeights(Object.fromEntries(Object.keys(columns).map(s => [s, train.map(([i]) => columns[s][i])])), train.map(([, k]) => y[k])).weights;
        for (const [i, k] of test) held.push([Object.entries(fitted).reduce((t, [s, w]) => t + w * columns[s][i], 0), y[k]]);
      }
      const outSample = spearman(held.map(r => r[0]), held.map(r => r[1]));
      out.regimes[regime][position] = { players: matched.length, weights, spearman: Math.round(inSample * 1000) / 1000, heldOut: Math.round(outSample * 1000) / 1000 };
    }
  }
  return out;
}

const CALIBRATION_NOTE = "How the frozen weights (scripts/sync-cfb-seasons.mjs VALUE_WEIGHTS) were fitted: each position's players of the 2025 season (full: with the tacklers, pass rushers and pass defenders the plays name, as from 2014; early: without them, as 2009–2013) matched by name to College Football 27's launch ratings (EA SPORTS' ratings site, iteration 1-base, retrieved 2026-11-18), their signals standardised over all the season's players at the position and regressed on the launch rating, signals with a negative weight dropped (fitWeights). spearman: the fitted value against the launch rating; heldOut: each half of the schools valued by weights fitted on the other half.";

// ---------- the move toward results ----------

/** The strength the match model plays a squad at: its lineup's offence and defence, averaged (scripts/lib/nfl-results.mjs). */
export function playedStrength(squad) {
  const { offence, defence } = americanFootballProfile(selectLineup({ sport: SPORT, squad }));
  return (offence + defence) / 2;
}
/** Games played at each gap when m is measured. */
export const PER_POINT_GAMES = 40000;
/** m: the margin a point of played strength gives under `rules` (perPointOf, Balanced form, neutral venue). */
export function marginPerPoint(rules, seed, games = PER_POINT_GAMES) {
  const play = (delta, rng) => {
    const { ga, gd } = sampleResult(rng, { attackerId: 'A', defenderId: 'D', rules, drives: rules.drives,
      edgeA: rules.edge + delta, edgeD: rules.edge - delta, kickingA: rules.kicker, kickingD: rules.kicker }, 6);
    return ga - gd;
  };
  return Math.round(perPointOf({ play, rng: makeRng(hashStr(seed)), games }) * 1000) / 1000;
}
const rounded = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// ---------- a season ----------

const recordOf = (school, games) => {
  let w = 0, l = 0, t = 0, pf = 0, pa = 0;
  for (const g of games) {
    if (g.home !== school && g.away !== school) continue;
    const us = g.home === school ? g.homeScore : g.awayScore, them = g.home === school ? g.awayScore : g.homeScore;
    pf += us; pa += them;
    if (us > them) w++; else if (us < them) l++; else t++;
  }
  return { record: t ? `${w}–${l}–${t}` : `${w}–${l}`, for: pf, against: pa, games: w + l + t };
};

async function snapshotOf(s, weights) {
  const { espnOf, schoolOfEspn, manifest } = await context();
  const data = await seasonData(s);
  const { players, left } = seasonPlayers(data);
  const regime = regimeOf(s);
  valueSeason(players, weights, regime);
  const { reference, source: referenceSource } = await referenceClubs();
  const { rated, population } = rateSeason(players, reference, ratingsOf);
  // The season's schools: its FBS schools the game knows.
  const schedule = await once(`schedule/${s}`, async () => scheduleOf(await parquet('cfb_schedules', s)));
  const schools = [...schedule.schools].map(espn => schoolOfEspn.get(espn)).filter(Boolean).sort();
  const unknown = [...schedule.schools].filter(espn => !schoolOfEspn.has(espn));
  if (unknown.length) throw new Error(`${s}: FBS schools with no game id: ESPN ${unknown.join(', ')}`);
  // Each school's squad (scripts/lib/nfl.mjs squadOf, college football's lineup), a place it is short of left to the game
  // (an option offence's tight end); a school whose roster leaves more than MAX_GAPS places short (Idaho's of 2009–2015
  // list 26–34 players and no linemen) does not play the season.
  const pools = {}, gaps = {};
  left.schools = [];
  for (const school of schools.slice()) {
    const pool = rated.filter(p => p.school === school).map(p => ({ name: p.name, pos: p.position, rating: p.rating, id: p.id }));
    const short = shortOf(pool);
    if (Object.values(short).reduce((t, n) => t + n, 0) > MAX_GAPS) {
      left.schools.push({ school, players: pool.length, short });
      schools.splice(schools.indexOf(school), 1);
      continue;
    }
    if (Object.keys(short).length) gaps[school] = short;
    pools[school] = squadOf(pool, `${s} ${school}`, { gaps: short, sport: SPORT }).squad;
  }
  // The move: S from the season's games between FBS schools, m under the season's rules.
  const games = schedule.games.map(g => ({ home: schoolOfEspn.get(g.home), away: schoolOfEspn.get(g.away), homeScore: g.homeScore, awayScore: g.awayScore,
    neutral: g.neutral, postseason: g.postseason }));
  // Every game counts toward the SRS, a school that does not play the season's too (its opponents' margins are real).
  const srs = srsOf(games);
  // m under the season's own rules (src/sports/collegeFootball.js collegeSeasonRules, without a data set, so that m does
  // not depend on the move it sets), else today's.
  const rules = college.collegeSeasonRules?.(s, null) ?? college.COLLEGE_RULES;
  const perPoint = marginPerPoint(rules, `cfb m ${s}`);
  const strengthOf = school => pool => playedStrength(squadOf(pool, `${s} ${school}`, { gaps: gaps[school] ?? {}, sport: SPORT }).squad);
  const before = Object.fromEntries(schools.map(school => [school, strengthOf(school)(pools[school])]));
  const unplayable = schools.filter(school => !Number.isFinite(before[school]) || !Number.isFinite(srs.ratings[school]));
  if (unplayable.length) throw new Error(`${s}: no strength or SRS for ${unplayable.map(school => `${school} (${before[school]}, SRS ${srs.ratings[school]}, ${pools[school].length} players)`).join(', ')}`);
  const level = mean(schools.map(school => before[school]));
  const { scale, targets } = resultsTargets(srs, { mean: level, perPoint });
  const moves = {}, moved = {};
  for (const school of schools) {
    const move = clubMoveOf(pools[school], targets[school], strengthOf(school));
    // The squad the game fields from the moved players (the strength the move measured): a school short of a place may
    // start another of its players out of position once the ratings move, and keeps only the squad it fields.
    moved[school] = squadOf(move.pool, `${s} ${school}`, { gaps: gaps[school] ?? {}, sport: SPORT }).squad;
    moves[school] = { srs: rounded(srs.ratings[school], 2), target: rounded(targets[school], 2), before: rounded(move.before, 2),
      after: rounded(move.after, 2), shift: move.shift, plus: move.plus };
  }
  const byId = new Map(rated.map(p => [p.id, p]));
  const conferenceOf = school => manifest.conferences[schedule.conference.get(espnOf[school])] ?? schedule.conference.get(espnOf[school]);
  const snapshot = {
    note: `The ${s} FBS season, computed (scripts/sync-cfb-seasons.mjs; docs/design/college-football.md, "Earlier seasons"): each school's squad as [name, position, years in college, recruiting grade or null, value, rank at the position, rating before the move, rating]; its conference, record and points against FBS schools, its Simple Rating System and its move; and the season's games between FBS schools as [home, away, home points, away points, neutral, postseason].`,
    source: { season: s, league: 'FBS', regime, retrieved: pins.retrieved,
      repos: Object.fromEntries(Object.entries(pins.repos).map(([key, repo]) => [key, `${repo.url}/tree/${repo.commit}`])) },
    conversion: {
      overall: conversionText(s, regime, perPoint, srs, level),
      weights: weights[regime], reference: `${referenceSource.edition}, ${referenceSource.iteration.label}`, depth: DEPTH, population,
      move: { srs: { reliability: rounded(srs.reliability, 3), homeEdge: rounded(srs.homeEdge, 2), sigma: rounded(srs.sigma, 2) },
        perPoint, mean: rounded(level, 3), scale: rounded(scale, 4) },
    },
    left,
    schools: Object.fromEntries(schools.map(school => [school, { espn: espnOf[school], conference: conferenceOf(school), ...recordOf(school, games) }])),
    lineup: { needs: FORMATION, gaps },
    squads: Object.fromEntries(schools.map(school => [school, moved[school].map(p => {
      const r = byId.get(p.id);
      return [p.name, p.pos, r.exp, r.grade == null ? null : rounded(r.grade, 2), r.value, r.rank, r.rating, p.rating];
    })])),
    moves,
    games: games.map(g => [g.home, g.away, g.homeScore, g.awayScore, g.neutral ? 1 : 0, g.postseason ? 1 : 0]),
  };
  return snapshot;
}

function conversionText(s, regime, perPoint, srs, level) {
  const signals = regime === 'full' ? 'their share of their school\'s passes, carries and catches, their yards, the tackles, sacks and passes defended their plays name, their interceptions and field goals'
    : 'their share of their school\'s passes, carries and catches, their yards, interceptions and field goals (plays before 2014 name no tacklers)';
  return `Computed: each player's value is a weighted sum of standardised signals of his position (${signals}, his 247Sports recruiting grade and his years in college), pooled over ${s} and the two seasons before it 3:2:1; the weights were fitted to College Football 27's launch ratings of the players of 2025 who returned in 2026 and frozen. Each school's best at each position (College Football 27's depth) are ranked across the season's FBS schools and read off College Football 27's ratings at that position (Week 10 Ratings). Each school then moves toward its results: its Simple Rating System over the season's games between FBS schools (reliability ${rounded(srs.reliability, 3)}), times √reliability ÷ ${perPoint} points a game per point of played strength, about the schools' mean ${rounded(level, 2)}; every player of the school by a whole number and its best few one more, never reordered.`;
}

function serialize(snapshot) {
  const { squads, games, ...rest } = snapshot;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const squadText = Object.entries(squads).map(([school, rows]) => `    ${JSON.stringify(school)}: [\n${rows.map(row => `      ${JSON.stringify(row)}`).join(',\n')}\n    ]`).join(',\n');
  return `${head},\n  "squads": {\n${squadText}\n  },\n  "games": [\n${games.map(g => `    ${JSON.stringify(g)}`).join(',\n')}\n  ]\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const check = args.includes('--check');
  if (args.includes('--fetch')) { await fetchSources(args.includes('--pin')); return; }
  if (args.includes('--tune')) {
    const result = await tune();
    for (const [regime, positions] of Object.entries(result.regimes)) {
      for (const [position, r] of Object.entries(positions)) console.log(`${regime} ${position}: ${r.players} players, Spearman ${r.spearman} (held out ${r.heldOut}), ${JSON.stringify(r.weights)}`);
    }
    const frozen = JSON.stringify(Object.fromEntries(Object.entries(result.regimes).map(([regime, positions]) => [regime,
      Object.fromEntries(Object.entries(positions).map(([position, r]) => [position, r.weights]))])));
    if (frozen !== JSON.stringify(VALUE_WEIGHTS)) console.log('The fitted weights differ from VALUE_WEIGHTS.');
    if (args.includes('--write')) {
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, 'calibration.json'), `${JSON.stringify({ note: CALIBRATION_NOTE, ...result }, null, 2)}
`);
      console.log(`Wrote ${path.relative(root, path.join(outDir, 'calibration.json'))}`);
    }
    return;
  }
  const only = arg('season') ? [Number(arg('season'))] : SEASONS;
  const weights = VALUE_WEIGHTS;
  if (!Object.keys(weights.full).length) throw new Error('No frozen weights: run --tune and set VALUE_WEIGHTS');
  const differs = [];
  for (const s of only) {
    const snapshot = await snapshotOf(s, weights);
    const text = serialize(snapshot);
    const file = path.join(outDir, `${s}.json`);
    if (check) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    } else {
      await mkdir(outDir, { recursive: true });
      await writeFile(file, text);
    }
    const strengths = Object.values(snapshot.moves).map(m => m.after);
    console.log(`${s} (${snapshot.source.regime}): ${Object.keys(snapshot.schools).length} schools, ${Object.values(snapshot.squads).flat().length} squad players, `
      + `SRS reliability ${snapshot.conversion.move.srs.reliability}, m ${snapshot.conversion.move.perPoint}, played ${Math.min(...strengths).toFixed(1)}–${Math.max(...strengths).toFixed(1)}, `
      + `gaps ${Object.keys(snapshot.lineup.gaps).length}, ${Math.round(Buffer.byteLength(text) / 1024)} KB`);
  }
  if (check) {
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified ${only.length} college football snapshots byte for byte.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`sync-cfb-seasons: ${error.message}`);
    process.exitCode = 1;
  });
}
