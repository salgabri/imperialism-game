// The earlier football seasons' own country maps (docs/design/domestic-campaigns.md, "Earlier seasons"): each season
// with clubs gets a map of every country whose clubs its source rates, at least ten of them, each holding that season's
// top clubs of the country (as many as its tier takes, src/data/domesticTiers.js) with that season's players. England's
// map of 2010/11 holds FIFA 11's 89 English league clubs, its map of 2020/21 FIFA 21's. An EA season whose season has a
// CM 01/02 Update Team database (scripts/data/cm0102-updates.json) also gets a map of every country that database rates
// ten clubs of and the EA edition does not, with that database's clubs and players (since 17 November 2026).
//
// Usage:
//   node scripts/build-season-countries.mjs --homes [--data=<dir>] [--retro-data=<dir>] [--cm-data=<dir>]
//       find every season club's home: today's map of its country, the Europe maps, Wikidata's and GeoNames' cached
//       answers (data-src/domestic/) and the hand overrides (scripts/data/season-club-locations.json); writes
//       scripts/data/season-club-homes.json, where a club it already lists keeps its home unless an override names it
//   node scripts/build-season-countries.mjs --ids [--data=<dir>] [--retro-data=<dir>] [--cm-data=<dir>]
//       check, from the seasons' clubs alone (a minute; no boundaries), that every map keeps its clubs and their ids:
//       run it after build:ea-seasons or build:retro-seasons, as a season file's field gives its clubs' ids
//   node scripts/build-season-countries.mjs [--seasons=ea-fifa-11,...] [--only=826y2011,...] [--jobs=8] [--check | --dry-run] [--data=<dir>]
//       build the maps: public/domestic/<country>y<year>.json, src/data/domesticSeasons.js (the setup's index),
//       public/domestic/ATTRIBUTION-seasons.txt and docs/design/domestic-seasons-audit.json. --check rebuilds offline and
//       compares every output byte for byte; --dry-run builds and writes nothing.
//
// Inputs: each season's own source (as scripts/build-ea-seasons.mjs reads it; `--data`, default data-src/), the season
// files (public/football/<season>.json, whose club ids the maps keep), today's snapshots (scripts/data/domestic/), the
// homes above, and the boundary caches of scripts/build-domestic.mjs (data-src/boundaries/).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import path from 'node:path';
import { NATIONS, buildClub, selectLineup } from '../src/data/teams.js';
import { expandSetPlayer, setHasClubs } from '../src/engine/footballSets.js';
import { buildFootballSet } from '../src/data/footballSetBuild.js';
import { TOP_CLUBS } from '../src/data/scopes.js';
import { createBoundarySource, createDownloader, GB_CITATION, ONS_LAD_LICENSE, ONS_LAD_SOURCE } from './lib/domestic-boundaries.mjs';
import { buildCountry, logging } from './lib/domestic-build.mjs';
import { createWikidata, ensureGeonames } from './lib/domestic-locate.mjs';
import { buildClubSeasons } from './lib/ea-season-builds.mjs';
import { readExport } from './lib/ea-season-files.mjs';
import { slug } from './lib/club-identity.mjs';
import { homeInSeason, LOCATE_REGIONS, locateSeasonClubs } from './lib/season-club-homes.mjs';
import { countryFields, eaSeasonClubs, retroSeasonClubs } from './lib/season-country-clubs.mjs';
import { seasonMapIds } from './lib/season-map-ids.mjs';
import { buildRetroSeason } from './lib/retro-season-builds.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/domestic');
const seasonDir = path.join(root, 'public/football');
const snapshotDir = path.join(root, 'scripts/data/domestic');
const homesFile = path.join(root, 'scripts/data/season-club-homes.json');
const overridesFile = path.join(root, 'scripts/data/season-club-locations.json');
const europeFile = path.join(root, 'scripts/data/europe-clubs.json');
const indexFile = path.join(root, 'src/data/domesticSeasons.js');
const auditFile = path.join(root, 'docs/design/domestic-seasons-audit.json');
const attributionFile = path.join(outDir, 'ATTRIBUTION-seasons.txt');
const boundaryCache = path.join(root, 'data-src/boundaries');
const locateCache = path.join(root, 'data-src/domestic');
const worldFile = path.join(root, 'public/countries-50m.json');
/** A season map's id: its country's and the season's year, "826y2011" (src/engine/domestic.js ids are alphanumeric). */
export const seasonMapId = (country, year) => `${country}y${year}`;
const SEASON_MAP = /^(\d{3}|[A-Z]{3})y(\d{4})\.json$/;
// Arc points per season map (today's maps take 14,000): a country has a map for every season that rates its clubs.
const SEASON_POINT_TARGET = 8000;

const log = (...parts) => logging.sink(format(...parts));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- The seasons' clubs ----

/**
 * Every season with clubs, newest first, each `{ id, year, edition, source, kind, clubs }` (scripts/lib/season-country-clubs.mjs):
 * the EA seasons' from `dataDir`, the seasons before them (Championship Manager's and SWOS's) from `retroDir`.
 */
async function seasonClubs(dataDir, retroDir, cmDir) {
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-seasons.json'), 'utf8'));
  const rows = await readExport(manifest.dataset, path.join(dataDir, 'ea-leone', manifest.dataset.file));
  const ea = await buildClubSeasons(manifest, { root, dataDir, rows, assemble: (records, info) => eaSeasonClubs(records, info) });
  const retro = JSON.parse(await readFile(path.join(root, 'scripts/data/retro-seasons.json'), 'utf8'));
  const before = [];
  for (const season of retro.seasons.filter(entry => setHasClubs(entry.id))) {
    const result = await buildRetroSeason(season, retroDir, season.retrieved ?? retro.retrieved, { everyClub: true });
    before.push(retroSeasonClubs(result));
  }
  return [...ea, ...await updateTeamFills(ea, cmDir), ...before].sort((a, b) => b.year - a.year || Number(!!a.fills) - Number(!!b.fills));
}

/**
 * The CM 01/02 Update Team's database of each EA season's season (scripts/data/cm0102-updates.json, its tables in
 * `cmDir`/cm0102/<release>/Data/, scripts/sync-cm0102-updates.mjs), read by the CM 01/02 builder with every club, as
 * that EA season's fill: its maps are the countries the EA edition rates too few clubs of (seasonFields). Each table
 * must have its pinned size and SHA-256. Shipped by the user's choice of 2026-11-17, credited to the Update Team.
 */
async function updateTeamFills(eaSeasons, cmDir) {
  const updates = JSON.parse(await readFile(path.join(root, 'scripts/data/cm0102-updates.json'), 'utf8'));
  const fills = [];
  for (const season of eaSeasons) {
    const label = `${season.year - 1}/${String(season.year % 100).padStart(2, '0')}`;
    const release = updates.releases.find(entry => entry.season === label);
    if (!release) continue;
    const files = {};
    for (const file of release.files) {
      const at = path.join(cmDir, 'cm0102', release.id, 'Data', file.name);
      if (!existsSync(at)) throw new Error(`${at} is missing: node scripts/sync-cm0102-updates.mjs fetches it (or --zip=<the release you downloaded>)`);
      const bytes = await readFile(at);
      if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`${at} is not the pinned ${release.id} table`);
      files[file.name] = new Uint8Array(bytes);
    }
    const result = buildFootballSet(files, { local: false, everyClub: true, topClubs: TOP_CLUBS,
      sourceExtra: { compiler: 'CM 01/02 Update Team', provenance: release.zip.item ?? 'the champman0102.co.uk forum, downloaded by the user',
        retrieved: release.retrieved ?? updates.retrieved } });
    if (result.doc.season !== label) throw new Error(`${release.id} is the database of ${result.doc.season}, not ${label}`);
    fills.push({ ...retroSeasonClubs(result), id: season.id, year: season.year, fills: season.id, release: release.id });
  }
  return fills;
}

/** A club's strength as the game computes it from its season's players (its lineup's rating). */
const strengthOf = season => club => selectLineup(buildClub({ ...club,
  squad: club.squad.map(player => expandSetPlayer(player.tuple, season.source, season.kind)) }, { id: 'football' })).rating;

/**
 * The season's country fields with their clubs' ids: a club the season file has (the Europe maps' clubs) keeps its id
 * there, every other one takes `f-<slug of its name>`, with a number after it when another club of the season has that
 * id already (as the season builders do). A fill (updateTeamFills) keeps only the countries its EA season's own fields
 * (`primary`, this function's answer for it) lack, and numbers its ids after theirs. → { fields, short, ids }
 */
async function seasonFields(season, primary = null) {
  const { fields, short } = countryFields(season.clubs, strengthOf(season));
  if (primary) for (const country of primary.fields.keys()) fields.delete(country);
  const file = JSON.parse(await readFile(path.join(seasonDir, `${season.id}.json`), 'utf8'));
  // A fill's players are another source's, so none of its clubs takes a season file club's id, but those the season
  // file takes from the fill itself (`fill`: Europe's strongest that EA lacks, scripts/lib/europe-field.mjs) keep theirs.
  // The season's own clubs take no id of the fill's.
  const own = file.clubs.filter(club => !!club.fill === !!primary);
  const known = new Map(own.map(club => [`${club.country}:${club.name}`, club.id]));
  const taken = new Set([...file.clubs.filter(club => !club.fill).map(club => club.id), ...(primary ? own.map(club => club.id) : []), ...(primary?.ids ?? [])]);
  for (const list of fields.values()) {
    for (const club of list) {
      club.id = known.get(`${club.country}:${club.name}`) ?? null;
    }
  }
  // Every other club keeps the id its map already gives it (scripts/lib/season-map-ids.mjs), so a change to the season
  // file's field moves no club's id; a club new to the map takes one in turn, strongest first across the season (ties
  // by country and name), so the strongest keeps the plain id.
  const committed = await seasonMapIds(root, season.year);
  const rest = [];
  for (const club of [...fields.values()].flat().filter(entry => !entry.id)) {
    const id = committed.get(`${club.country}:${club.name}`);
    if (id && !taken.has(id)) { taken.add(id); club.id = id; } else rest.push(club);
  }
  rest.sort((a, b) => b.str - a.str || byText(a.country, b.country) || byText(a.name, b.name));
  for (const club of rest) {
    const base = `f-${slug(club.name)}`.slice(0, 60);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    club.id = id;
  }
  const ids = [...taken, ...[...fields.values()].flat().map(club => club.id)];
  return { fields, short: primary ? short.filter(entry => !primary.fields.has(entry.country)) : short, ids };
}

/**
 * Every season's fields, a fill's after its EA season's (seasonFields): Map(season object → { fields, short, ids }).
 * `onlySeasons` limits it to those seasons (a fill comes with its EA season, whose fields it needs).
 */
async function everySeasonFields(seasons, onlySeasons = null) {
  const out = new Map(), byId = new Map();
  for (const season of seasons.filter(entry => !entry.fills)) {
    if (onlySeasons && !onlySeasons.includes(season.id)) continue;
    const result = await seasonFields(season);
    out.set(season, result);
    byId.set(season.id, result);
  }
  for (const season of seasons.filter(entry => entry.fills)) {
    if (!byId.has(season.fills)) continue;
    out.set(season, await seasonFields(season, byId.get(season.fills)));
  }
  return out;
}

/**
 * `--ids`: whether every season map would keep its clubs and their ids, read from the seasons' fields alone (no
 * boundaries, no geometry): a map whose clubs change needs a rebuild, and its saves no longer fit it. Throws listing them.
 */
async function checkIds(seasons) {
  const differs = [];
  let maps = 0;
  for (const [season, { fields }] of await everySeasonFields(seasons)) {
    for (const [country, clubs] of fields) {
      const file = path.join(outDir, `${seasonMapId(country, season.year)}.json`);
      if (!existsSync(file)) { differs.push(`${seasonMapId(country, season.year)}: no map yet`); continue; }
      maps++;
      const committed = JSON.parse(await readFile(file, 'utf8')).clubs.map(club => `${club.id} ${club.name}`).sort();
      const now = clubs.map(club => `${club.id} ${club.name}`).sort();
      const gone = committed.filter(entry => !now.includes(entry)), added = now.filter(entry => !committed.includes(entry));
      if (gone.length || added.length) differs.push(`${seasonMapId(country, season.year)}: ${gone.map(e => `-${e}`).concat(added.map(e => `+${e}`)).join(', ')}`);
    }
  }
  if (differs.length) throw new Error(`${differs.length} season maps would change their clubs:\n  ${differs.join('\n  ')}`);
  console.log(`${maps} season maps keep their clubs and ids`);
}

// ---- Homes ----

const nationOf = id => ({ id, name: NATIONS[id][0] });

async function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback;
}

/** Today's snapshot of a country, or null (Scotland, Wales and Northern Ireland have none). */
async function snapshotOf(country) {
  return readJson(path.join(snapshotDir, `${country}.json`), null);
}

/**
 * Every season club's home (`--homes`): one call per country, its clubs strongest first by their best season. A club the
 * homes file already places (or leaves unplaced) keeps that, unless a hand override names it, so a season added later
 * never moves another season's club: Wikidata gives each item to one name only, and a new season's name for a club
 * (SWOS's "MyPa") would otherwise take it from the name another season gives it ("Myllykosken Pallo-47"). Delete a
 * club's entry to find its home again.
 */
async function findHomes(seasons) {
  const strongest = new Map(), shortOf = new Map();
  for (const [, { fields }] of await everySeasonFields(seasons)) {
    for (const [country, clubs] of fields) {
      const names = strongest.get(country) || strongest.set(country, new Map()).get(country);
      for (const club of clubs) {
        names.set(club.name, Math.max(names.get(club.name) ?? -Infinity, club.str));
        // A short name the season's source gives (the Update Team's "Vasco" for "Clube de Regatas Vasco da Gama").
        if (club.short && club.short !== club.name && !shortOf.has(`${country}|${club.name}`)) shortOf.set(`${country}|${club.name}`, club.short);
      }
    }
  }
  const overrides = await readJson(overridesFile, { clubs: {} });
  const europe = (await readJson(europeFile, { clubs: {} })).clubs;
  const previous = (await readJson(homesFile, { clubs: {} })).clubs;
  const locate = { wikidata: createWikidata({ cacheDir: locateCache }), geoFiles: ensureGeonames(locateCache) };
  const out = {};
  for (const country of [...strongest.keys()].sort(byText)) {
    const clubs = [...strongest.get(country)].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
      .map(([name]) => ({ name, short: shortOf.get(`${country}|${name}`) ?? null }));
    const kept = previous[country] || {}, own = overrides.clubs[country] || {};
    const keeps = name => Object.hasOwn(kept, name) && !Object.hasOwn(own, name);
    const found = await locateSeasonClubs({ nation: nationOf(country), clubs: clubs.filter(({ name }) => !keeps(name)), snapshot: await snapshotOf(country),
      europe, idOf: name => `f-${slug(name)}`, overrides: own, locate });
    out[country] = Object.fromEntries(clubs.map(({ name }) => [name, keeps(name) ? kept[name] : found.get(name) ?? null]).sort(([a], [b]) => byText(a, b)));
    const sources = {};
    for (const home of Object.values(out[country])) { const kind = home ? home.source.split(':')[0] : 'none'; sources[kind] = (sources[kind] || 0) + 1; }
    console.log(`${country} ${NATIONS[country][0]}: ${clubs.length} clubs, ${JSON.stringify(sources)}`);
  }
  const text = `{\n"about": ${JSON.stringify(HOMES_ABOUT)},\n"clubs": {\n${Object.entries(out).map(([country, clubs]) => `${JSON.stringify(country)}: {\n${Object.entries(clubs)
    .map(([name, home]) => `  ${JSON.stringify(name)}: ${JSON.stringify(home)}`).join(',\n')}\n}`).join(',\n')}\n}\n}\n`;
  await writeFile(homesFile, text);
  console.log(`Wrote ${path.relative(root, homesFile)}`);
}

const HOMES_ABOUT = 'Where each club of the earlier seasons\' country maps stands, by country and the name its season gives it, '
  + 'written by node scripts/build-season-countries.mjs --homes (scripts/lib/season-club-homes.mjs): home [lon, lat] from a hand override '
  + '(source "override", scripts/data/season-club-locations.json), the same club on today\'s map of its country (source "map:<its id there>", '
  + 'also its twin), the Europe maps\' clubs (source "europe:<id>"), Wikidata (source "wikidata:Q…", CC0) or GeoNames (source "geonames:<id>", '
  + 'CC BY 4.0). eras: the season years (from and through, both included) in which a club that moved stood elsewhere, by hand override, and '
  + 'that ground. null: none of them places it, and the map starts it at a populous place no other club stands in, an estimate.';

// ---- Building ----

// The GeoNames country of a nation a season rates ten clubs of but today's maps do not have (SWOS's Suriname, the Update
// Team's Philippines and Belize); Scotland, Wales and Northern Ireland take theirs from LOCATE_REGIONS.
const UNMAPPED_GEONAMES = Object.freeze({ 740: { country: 'SR', admin1: null }, 608: { country: 'PH', admin1: null }, '084': { country: 'BZ', admin1: null } });

/** The GeoNames country and region of a nation, as its snapshot names them (Scotland's: the United Kingdom's, Scotland's region). */
async function geonamesOf(country) {
  const region = LOCATE_REGIONS[country];
  if (region) return { country: region.a2, admin1: region.admin1 };
  if (UNMAPPED_GEONAMES[country]) return UNMAPPED_GEONAMES[country];
  const snapshot = await snapshotOf(country);
  if (!snapshot?.nation?.geonames) throw new Error(`${country}: no snapshot gives its GeoNames country; add it to LOCATE_REGIONS`);
  return snapshot.nation.geonames;
}

/** The jobs: one per season and country, `{ id, snapshot, season }` as buildCountry takes them (without `season.expand`). */
async function mapJobs(seasons, homes, { only, onlySeasons }) {
  const jobs = [], short = [];
  for (const [season, { fields, short: below }] of await everySeasonFields(seasons, onlySeasons)) {
    short.push(...below.map(entry => ({ season: season.id, ...entry })));
    for (const [country, clubs] of fields) {
      const id = seasonMapId(country, season.year);
      if (only && !only.includes(id)) continue;
      const missing = clubs.filter(club => !Object.hasOwn(homes[country] || {}, club.name));
      if (missing.length) throw new Error(`${id}: no home found yet for ${missing.map(club => club.name).join(', ')}; run --homes first`);
      jobs.push({
        id,
        season: { id: season.id, year: season.year, kind: season.kind, source: season.source },
        snapshot: {
          nation: { id: country, name: NATIONS[country][0], geonames: await geonamesOf(country) },
          clubs: clubs.map(club => {
            const home = homeInSeason(homes[country][club.name], season.year);
            return { id: club.id, name: club.name, league: club.league || `${NATIONS[country][0]} football`,
              location: home ? { lon: home.lon, lat: home.lat, source: home.source } : null, ...(home?.twin ? { twin: home.twin } : {}),
              squad: club.squad.map(player => player.tuple) };
          }),
        },
      });
    }
  }
  return { jobs, short };
}

async function buildJob(job, source) {
  try {
    const season = { ...job.season, points: Number(process.env.SEASON_POINTS) || SEASON_POINT_TARGET,
      expand: tuple => expandSetPlayer(tuple, job.season.source, job.season.kind) };
    return { result: await buildCountry(job.id, job.snapshot, source, season) };
  } catch (error) {
    log(`${job.id} FAILED: ${error.stack || error.message}`);
    return { error: error.message };
  }
}

/** Worker thread: builds the maps it is sent one at a time; cache misses go to the main thread. */
function runWorker() {
  const waiting = new Map();
  let nextKey = 0;
  const download = (url, file, opts) => (existsSync(file) ? readFile(file, 'utf8') : new Promise((resolve, reject) => {
    waiting.set(nextKey, { resolve, reject, file });
    parentPort.postMessage({ type: 'download', key: nextKey++, url, file, opts });
  }));
  const { offline } = workerData;
  const source = createBoundarySource({ cacheDir: boundaryCache, worldFile, offline, log, ...(offline ? {} : { download }) });
  parentPort.on('message', async msg => {
    if (msg.type === 'downloaded') {
      const { resolve, reject, file } = waiting.get(msg.key);
      waiting.delete(msg.key);
      if (msg.error) reject(new Error(msg.error));
      else resolve(readFile(file, 'utf8'));
      return;
    }
    const lines = [];
    logging.sink = line => lines.push(line);
    const outcome = await buildJob(msg.job, source);
    parentPort.postMessage({ type: 'built', id: msg.job.id, lines, ...outcome });
  });
}

/** Builds the jobs on `jobs` worker threads, the most clubs first; returns { built, failures }. */
async function buildParallel(queue, jobs, { offline, download }) {
  const built = new Map(), failures = [];
  queue = [...queue].sort((a, b) => b.snapshot.clubs.length - a.snapshot.clubs.length || byText(a.id, b.id));
  await new Promise(resolve => {
    let running = 0;
    const start = () => {
      running++;
      let current = null;
      const worker = new Worker(new URL(import.meta.url), { workerData: { offline } });
      const next = () => {
        current = queue.shift() ?? null;
        if (current) worker.postMessage({ type: 'build', job: current });
        else worker.terminate();
      };
      const lost = reason => {
        if (!current) return;
        failures.push(`${current.id}: ${reason}`);
        console.error(`${current.id} FAILED: ${reason}`);
        current = null;
      };
      worker.on('message', msg => {
        if (msg.type === 'download') {
          download(msg.url, msg.file, msg.opts).then(() => worker.postMessage({ type: 'downloaded', key: msg.key }),
            error => worker.postMessage({ type: 'downloaded', key: msg.key, error: error.message }));
          return;
        }
        for (const line of msg.lines) (msg.error ? console.error : console.log)(line);
        if (msg.error) failures.push(`${msg.id}: ${msg.error}`);
        else built.set(msg.id, msg.result);
        current = null;
        next();
      });
      worker.on('error', error => lost(error.stack || error.message));
      worker.on('exit', code => {
        lost(`worker exited with code ${code}`);
        running--;
        if (queue.length) start();
        else if (!running) resolve();
      });
      next();
    };
    for (let i = 0; i < Math.min(jobs, queue.length); i++) start();
  });
  return { built, failures };
}

// ---- Index, attribution, audit ----

function indexModule(entries, years) {
  const bySeason = new Map();
  for (const entry of entries) (bySeason.get(entry.season) || bySeason.set(entry.season, []).get(entry.season)).push(entry);
  const rows = [...bySeason].map(([season, list]) => `  [${JSON.stringify(season)}, ${years.get(season)}, ${JSON.stringify(list.map(entry => [entry.country, entry.clubs]))}],`);
  return `// GENERATED by scripts/build-season-countries.mjs from public/domestic/<country>y<year>.json; do not edit.
// The earlier football seasons' own country maps (docs/design/domestic-campaigns.md, "Earlier seasons"): one per season
// and country whose source rates ten or more of its clubs. The setup lists a season's when that season is chosen, and
// the loader fetches public/domestic/<country>y<year>.json on demand.
// [season file's id, its year, [[country, clubs], ...]], newest season first.

export const DOMESTIC_SEASON_ROWS = [
${rows.join('\n')}
];
`;
}

function attributionText(docs) {
  const lines = [
    "Earlier seasons' country maps (public/domestic/<country>y<year>.json)",
    'Generated by scripts/build-season-countries.mjs; do not edit.',
    '',
    "Each is one country's map in one earlier football season: its sections are derived from the same administrative",
    "boundary layers as today's map of the country (public/domestic/ATTRIBUTION.txt lists their sources and licences),",
    'grown around that season\'s clubs. Scotland\'s, which today\'s maps lack, are listed below.',
    `geoBoundaries (https://www.geoboundaries.org), gbOpen release, files pinned to commit 9469f09: ${GB_CITATION}`,
    `England's districts (the game's 826): ${ONS_LAD_SOURCE}, ${ONS_LAD_LICENSE}.`,
    "Clubs and players: the season's own source, as its season file credits it (public/football/<season>.json,",
    "  docs/design/football-years.md); in an EA season, a country the EA edition rates too few clubs of takes the CM 01/02",
    "  Update Team's database of that season (credited to the CM 01/02 Update Team, https://www.champman0102.co.uk;",
    '  scripts/data/cm0102-updates.json), as the map\'s line below names it. Club home towns: Wikidata (CC0 1.0), GeoNames cities1000 (https://www.geonames.org,',
    '  CC BY 4.0), today\'s maps\' homes and hand overrides (scripts/data/season-club-homes.json lists each with its source).',
    '',
    'Per map:',
  ];
  for (const doc of docs) {
    const b = doc.boundaries;
    const players = doc.source.compiler === 'CM 01/02 Update Team' ? `${doc.source.edition}, ${doc.source.version} by the CM 01/02 Update Team` : doc.source.edition;
    lines.push(`${doc.id} ${doc.name} ${doc.season} (${players}): ${b.provider} ${b.iso3} ${b.level}${b.mask ? ` (${b.mask})` : ''}${b.part ? ` (${b.part})` : ''}, ${b.license}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---- Main ----

if (isMainThread) await main();
else runWorker();

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }));
  for (const key of Object.keys(args)) if (!['homes', 'ids', 'seasons', 'only', 'jobs', 'check', 'dry-run', 'data', 'retro-data', 'cm-data'].includes(key)) throw new Error(`Unknown option --${key}`);
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const retroDir = path.resolve(args['retro-data'] ?? path.join(root, 'data-src'));
  const cmDir = path.resolve(args['cm-data'] ?? path.join(root, 'data-src'));
  const started = Date.now();
  const seasons = await seasonClubs(dataDir, retroDir, cmDir);
  console.log(`Read ${seasons.length} seasons' clubs in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (args.homes === 'true') return findHomes(seasons);
  if (args.ids === 'true') return checkIds(seasons);

  const check = args.check === 'true', dryRun = args['dry-run'] === 'true';
  const only = args.only ? args.only.split(',').map(s => s.trim()) : null;
  const onlySeasons = args.seasons ? args.seasons.split(',').map(s => s.trim()) : null;
  const homes = (await readJson(homesFile, { clubs: {} })).clubs;
  const { jobs: queue, short } = await mapJobs(seasons, homes, { only, onlySeasons });
  const jobs = Math.min(queue.length, Math.max(1, Number(args.jobs) || Math.min(8, availableParallelism() - 1)));
  const download = createDownloader({ offline: check, log });
  const { built, failures } = await buildParallel(queue, jobs, { offline: check, download });
  failures.sort();

  // The index, attribution and audit cover every shipped season map, rebuilt or not. A full run retires maps whose
  // season and country no longer make one.
  const partial = !!(only || onlySeasons);
  const wanted = new Set(queue.map(job => job.id));
  const present = existsSync(outDir) ? (await readdir(outDir)).filter(f => SEASON_MAP.test(f)).map(f => f.replace('.json', '')) : [];
  const stale = partial ? [] : present.filter(id => !wanted.has(id));
  const allIds = [...new Set([...present.filter(id => !stale.includes(id)), ...built.keys()])].sort();
  const docs = [], entries = [];
  for (const id of allIds) {
    const text = built.get(id)?.text ?? await readFile(path.join(outDir, `${id}.json`), 'utf8');
    const doc = JSON.parse(text);
    docs.push(doc);
    entries.push(built.get(id)?.index ?? { id, country: doc.country, season: doc.season, clubs: doc.clubs.length, version: doc.version });
  }
  // Newest season first, then the countries in id order.
  const yearOf = id => Number(id.slice(id.indexOf('y') + 1));
  entries.sort((a, b) => yearOf(b.id) - yearOf(a.id) || byText(a.country, b.country));
  docs.sort((a, b) => b.year - a.year || byText(a.country, b.country));
  const previous = await readJson(auditFile, { maps: [] });
  const auditById = new Map(previous.maps.filter(entry => allIds.includes(entry.id)).map(entry => [entry.id, entry]));
  for (const [id, b] of built) {
    const a = b.audit;
    auditById.set(id, { id, version: b.index.version, name: a.name, level: a.level, clubs: a.clubs, located: a.located, unlocated: a.unlocated,
      placed: a.placed.map(p => p.club), homeInSection: a.homeInSection, displacementKm: a.displacementKm, bytes: a.bytes });
  }
  const audit = {
    generatedBy: 'scripts/build-season-countries.mjs',
    note: "Per earlier season's country map: boundary layer, clubs, homes found, placed and in their own section, file size; and each season's countries below ten clubs.",
    maps: [...auditById.values()].sort((a, b) => yearOf(b.id) - yearOf(a.id) || byText(a.id, b.id)),
    ...(partial ? { short: previous.short ?? [] } : { short }),
  };

  const outputs = new Map();
  for (const [id, b] of built) outputs.set(path.join(outDir, `${id}.json`), b.text);
  outputs.set(indexFile, indexModule(entries, new Map(docs.map(doc => [doc.season, doc.year]))));
  outputs.set(attributionFile, attributionText(docs));
  outputs.set(auditFile, `${JSON.stringify(audit, null, 1)}\n`);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (dryRun) {
    for (const id of stale) log(`would remove public/domestic/${id}.json`);
    log(`Dry run: built ${built.size} season maps in ${seconds} s, wrote nothing.`);
  } else if (check) {
    const differs = stale.map(id => `public/domestic/${id}.json (no longer a map)`);
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    for (const f of differs) console.error(`differs: ${f}`);
    if (differs.length) process.exitCode = 1;
    else log(`Verified ${built.size} season maps and ${outputs.size - built.size} generated files byte for byte in ${seconds} s.`);
  } else {
    await mkdir(outDir, { recursive: true });
    for (const [file, text] of outputs) await writeFile(file, text);
    for (const id of stale) {
      await rm(path.join(outDir, `${id}.json`));
      log(`Removed public/domestic/${id}.json.`);
    }
    log(`Wrote ${built.size} season maps, the index (${entries.length} maps), attribution and audit in ${seconds} s.`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`failed: ${f}`);
    process.exitCode = 1;
  }
}
