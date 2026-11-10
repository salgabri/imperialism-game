// Snapshot the current EA SPORTS FC edition from EA's public ratings API (drop-api.ea.com, the data behind
// www.ea.com/games/ea-sports-fc/ratings): every man's names, positions, overall, nationality, club and date of birth,
// reduced to the columns scripts/lib/football-data.mjs reads — scripts/data/ea-fc26.csv's SoFIFA-schema columns, plus
// nationality_id and reference_long_name. The API's pages are cached in the ignored data-src/ea-fc<NN>/, so a rerun
// reads them instead of the API; only the reduced CSV is committed. drop-api.ea.com has no robots.txt and www.ea.com's
// does not cover the ratings pages; EA's User Agreement allows non-commercial use only.
//
// Usage: node scripts/sync-ea-fc.mjs [--refresh]
//   --refresh  download the pages again: a new snapshot, dated the day it is fetched
// Output: scripts/data/ea-fc27.csv (committed), read by scripts/build-rosters.mjs and scripts/build-clubs.mjs.
//
// The API has no league ids, gives dates of birth as M/D/YYYY, sponsors' league names and EA's own nation labels, so:
// - nations come from scripts/data/ea-nations.json by nationality id (FC 26's names); an id FC 26 never had keeps the
//   API's label, with a warning;
// - each API league name takes the FC 26 league id that a strict majority of its clubs held in FC 26, with that
//   league's FC 26 name and level. Promoted clubs follow their new league; mixed groups and leagues FC 26 lacked stay
//   empty;
// - a club FC 26 also had keeps its FC 26 name ("Paris Saint-Germain", not the API's "Paris SG"), so its club id
//   (f-<name>) stays the same between seasons. Clubs EA re-numbered (FC 27's unlicensed Serie A: Lombardia FC is
//   Inter) reach their FC 26 club through scripts/data/ea-club-aliases.json first; club_team_id keeps EA's own id. A
//   club of the club layer's seven leagues that is new to FC 26 yet mostly one FC 26 club the API no longer lists
//   stops the reduce until it has an alias;
// - long_name is the API's first and last name ("Rahim Alhassane"). When FC 26's long name of the same player holds
//   all its names and more (EA's legal name, "Abdel Rahim Alhassane Bonkano"), it is kept as reference_long_name,
//   which only the FM duplicate check reads (loadFootballData).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { EA_PLAYER_PAGE, nameTokens, parseCsv, ROLE_OF_POSITION } from './lib/football-data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = 27;
const ENDPOINT = 'https://drop-api.ea.com/rating/ea-sports-fc';
// Without this header the CDN can still serve the previous edition.
const HEADERS = { 'drop-referrer': 'https://www.ea.com/games/ea-sports-fc/ratings/' };
const LIMIT = 100, PAUSE_MS = 1000;
// The club layer's leagues (scripts/build-clubs.mjs), by FC 26 league id: their clubs must keep their identity.
const CLUB_LEAGUES = [13, 53, 31, 19, 16, 10, 308];
const REFERENCE = 'ea-fc26.csv';
export const COLUMNS = ['player_id', 'player_url', 'fifa_version', 'fifa_update', 'fifa_update_date',
  'short_name', 'long_name', 'player_positions', 'overall', 'nationality_id', 'nationality_name',
  'club_name', 'club_team_id', 'league_id', 'league_name', 'league_level', 'dob', 'reference_long_name'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const data = file => path.join(root, 'scripts/data', file);

/**
 * Every page of one gender's ratings (0 men's, 1 women's), each from `cacheDir` unless `refresh` → { items, pages, date }.
 * `headers` are the request's: without the referrer (`{}`) the CDN serves the previous edition.
 * One pull is one snapshot: a set that changes mid-pull, or pages fetched on two days, must be fetched again.
 */
export async function pullPages(cacheDir, gender, refresh, { headers = HEADERS } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const first = await page(cacheDir, 0, refresh, gender, headers);
  const pages = Math.ceil(first.totalItems / LIMIT);
  const items = [...first.items], dates = new Set([first.fetchedAt.slice(0, 10)]);
  for (let i = 1; i < pages; i++) {
    const body = await page(cacheDir, i * LIMIT, refresh, gender, headers);
    // A different total means EA changed the set mid-pull: refetch it whole.
    if (body.totalItems !== first.totalItems) throw new Error(`The edition changed mid-pull: ${body.totalItems} players, not ${first.totalItems}; rerun with --refresh`);
    dates.add(body.fetchedAt.slice(0, 10));
    items.push(...body.items);
    if (i % 40 === 0) console.log(`  page ${i}/${pages}`);
  }
  const ids = new Set(items.map(item => item.id));
  if (items.length !== first.totalItems || ids.size !== first.totalItems) throw new Error(`Expected ${first.totalItems} players; got ${items.length} rows, ${ids.size} ids`);
  // fifa_update_date is the day of the pull: one pull, one snapshot.
  if (dates.size !== 1) throw new Error(`The pages were fetched on ${[...dates].join(', ')}; rerun with --refresh to fetch them in one pull`);
  return { items, pages, date: [...dates][0] };
}

// Letters NFD does not decompose. EA's slugs fold them the same way (vini-jr and kylian-mbappe resolve).
const FOLD = { Ø: 'O', ø: 'o', Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Ł: 'L', ł: 'l', ı: 'i', ß: 'ss',
  Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Þ: 'Th', þ: 'th' };
export const slugify = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[ØøĐđÐðŁłıßÆæŒœÞþ]/g, c => FOLD[c]).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 'M/D/YYYY h:mm' (the time is always 0:00), or EA FC 26's 'M/D/YYYY h:mm:ss AM' → 'YYYY-MM-DD'. */
export function isoBirthdate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) \d{1,2}:\d{2}(?::\d{2} [AP]M)?$/.exec(value || '');
  if (!match) throw new Error(`Unexpected EA birthdate "${value}"`);
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`Invalid EA birthdate "${value}"`);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** EA shows the common name when there is one (Vini Jr.), else the initial and surname. */
export function eaNames(item) {
  const first = (item.firstName || '').trim(), last = (item.lastName || '').trim(), common = (item.commonName || '').trim();
  const long = `${first} ${last}`.trim();
  const short = common || (first && last ? `${[...first][0]}. ${last}` : last || first);
  if (!short || !long) throw new Error(`EA player ${item.id} has no name`);
  return { short, long, display: common || long };
}

/**
 * FC 26's long name of the same player when it is the API's plus more names (Rahim Alhassane: Abdel Rahim Alhassane
 * Bonkano), else ''. A changed name, or one that differs only in script or spelling, carries nothing.
 */
export function referenceLongName(long, reference) {
  if (!reference) return '';
  const api = nameTokens(long), legal = nameTokens(reference);
  return api.length && api.every(token => legal.includes(token)) && legal.some(token => !api.includes(token)) ? reference : '';
}

/** ea-club-aliases.json's entries for one edition: API team id → { referenceId, name, label }. */
export function readClubAliases(file, version, reference) {
  const edition = file.editions?.[version];
  if (!edition) return new Map();
  if (edition.reference !== reference) throw new Error(`ea-club-aliases.json: FC ${version} aliases name ${edition.reference}, not ${reference}`);
  return new Map(Object.entries(edition.clubs).map(([id, alias]) => {
    if (!/^\d+$/.test(id) || !Number.isInteger(alias.referenceId) || !alias.name || !alias.label) throw new Error(`ea-club-aliases.json: invalid FC ${version} alias ${id}`);
    return [Number(id), alias];
  }));
}

/** API league names → FC 26 leagues, each by the majority of its clubs that FC 26 also had. */
export function resolveLeagues(items, referenceRows, aliases = new Map()) {
  const [header, ...rows] = referenceRows;
  const col = name => header.indexOf(name);
  const clubLeague = new Map(), leagues = new Map(), clubNames = new Map();
  for (const row of rows) {
    const clubId = Number(row[col('club_team_id')]), leagueId = Number(row[col('league_id')]);
    if (!clubId || !leagueId) continue;
    if (clubLeague.has(clubId) && clubLeague.get(clubId) !== leagueId) throw new Error(`FC 26 club ${clubId} is in two leagues`);
    clubLeague.set(clubId, leagueId);
    clubNames.set(clubId, row[col('club_name')]);
    leagues.set(leagueId, { leagueId, name: row[col('league_name')], level: Number(row[col('league_level')]) });
  }
  const clubsByLeagueName = new Map();
  for (const item of items) {
    if (!clubsByLeagueName.has(item.leagueName)) clubsByLeagueName.set(item.leagueName, new Set());
    clubsByLeagueName.get(item.leagueName).add(aliases.get(item.team.id)?.referenceId ?? item.team.id);
  }
  const resolved = new Map(), report = [];
  for (const [leagueName, clubs] of [...clubsByLeagueName].sort((a, b) => a[0].localeCompare(b[0]))) {
    const votes = new Map();
    for (const clubId of clubs) if (clubLeague.has(clubId)) votes.set(clubLeague.get(clubId), (votes.get(clubLeague.get(clubId)) || 0) + 1);
    const shared = [...votes.values()].reduce((total, n) => total + n, 0);
    const [winner, count = 0] = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [];
    const league = count * 2 > shared ? leagues.get(winner) : null;
    if (league) resolved.set(leagueName, league);
    report.push({ leagueName, clubs: clubs.size, shared, leagueId: league?.leagueId ?? null, name: league?.name ?? null, votes: count });
  }
  return { resolved, report, clubNames };
}

/**
 * Club identity across editions for the club layer's leagues (`clubLeagues`, league ids). Each alias must name a team
 * the API lists and an FC 26 club, under its FC 26 name, that the API no longer lists and that held most of the aliased
 * squad's players FC 26 also had. A league club new to FC 26 passes only when no vanished FC 26 club holds most (and at
 * least five) of those players: a promoted club FC 26 lacked, not one EA re-numbered. Returns the aliased and new clubs.
 */
export function checkClubIdentity(items, referenceRows, { aliases = new Map(), leagues, clubLeagues }) {
  const [header, ...rows] = referenceRows;
  const col = name => header.indexOf(name);
  const referenceClubs = new Map(), formerClub = new Map();
  for (const row of rows) {
    const clubId = Number(row[col('club_team_id')]);
    if (!clubId) continue;
    referenceClubs.set(clubId, row[col('club_name')]);
    formerClub.set(Number(row[col('player_id')]), clubId);
  }
  const teams = new Map();
  for (const item of items) {
    if (!teams.has(item.team.id)) teams.set(item.team.id, { id: item.team.id, label: item.team.label, leagueName: item.leagueName, players: [] });
    teams.get(item.team.id).players.push(item.id);
  }
  const former = team => {
    const votes = new Map();
    for (const id of team.players) if (formerClub.has(id)) votes.set(formerClub.get(id), (votes.get(formerClub.get(id)) || 0) + 1);
    const [clubId = null, count = 0] = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [];
    return { clubId, name: referenceClubs.get(clubId) ?? null, count, shared: [...votes.values()].reduce((total, n) => total + n, 0) };
  };
  const warnings = [], aliased = [], added = [];
  for (const [id, alias] of aliases) {
    const team = teams.get(id), where = `ea-club-aliases.json: ${id} -> ${alias.referenceId}`;
    if (!team) throw new Error(`${where}: the API lists no team ${id}`);
    if (referenceClubs.get(alias.referenceId) !== alias.name) throw new Error(`${where}: FC 26 has ${referenceClubs.get(alias.referenceId) ?? 'no club'} under ${alias.referenceId}, not ${alias.name}`);
    if (teams.has(alias.referenceId)) throw new Error(`${where}: the API still lists ${alias.referenceId}, so both would be ${alias.name}`);
    const was = former(team);
    if (was.clubId !== alias.referenceId || was.count * 2 <= was.shared) throw new Error(`${where}: ${was.count} of ${was.shared} shared players were at ${was.name}, not mostly at ${alias.name}`);
    if (team.label !== alias.label) warnings.push(`EA team ${id} is now "${team.label}", not "${alias.label}"; check the alias`);
    aliased.push({ id, label: team.label, referenceId: alias.referenceId, name: alias.name, players: team.players.length, ...was });
  }
  const inClubLeagues = new Set(clubLeagues.map(Number));
  for (const team of teams.values()) {
    const league = leagues.get(team.leagueName);
    if (!league || league.level !== 1 || !inClubLeagues.has(league.leagueId) || aliases.has(team.id) || referenceClubs.has(team.id)) continue;
    const was = former(team);
    if (was.count >= 5 && was.count * 2 > was.shared && !teams.has(was.clubId)) {
      throw new Error(`EA team ${team.id} "${team.label}" (${league.name}) is new to FC 26, but ${was.count} of its ${was.shared} players FC 26 also had were at ${was.name} (${was.clubId}), which the API no longer lists: add ${team.id} -> ${was.clubId} to scripts/data/ea-club-aliases.json`);
    }
    added.push({ id: team.id, label: team.label, league: league.name, players: team.players.length, shared: was.shared });
  }
  return { aliased, added, warnings };
}

/**
 * The API's players as CSV rows (COLUMNS), with the nations, leagues, club names and legal names resolved. `gender` is
 * the API's: 0 men's football (this script), 1 women's (scripts/sync-ea-fc-women.mjs).
 */
export function reduceItems(items, { version, date, nations, leagues, clubNames = new Map(), aliases = new Map(), referenceNames = new Map(), gender = 0 }) {
  const unknownPositions = new Map(), labelNations = new Map();
  let carried = 0;
  const rows = items.map(item => {
    if (item.gender?.id !== gender) throw new Error(`EA player ${item.id} is not in ${gender === 0 ? "men's" : "women's"} football`);
    if (!Number.isInteger(item.id) || item.id <= 0) throw new Error(`Invalid EA player id ${item.id}`);
    if (!Number.isInteger(item.overallRating) || item.overallRating < 1 || item.overallRating > 99) throw new Error(`Invalid EA overall for ${item.id}`);
    const positions = [...new Set([item.position, ...(item.alternatePositions || [])].map(p => p?.shortLabel))];
    for (const position of positions) if (!ROLE_OF_POSITION[position]) unknownPositions.set(position, (unknownPositions.get(position) || 0) + 1);
    const nationalityId = String(item.nationality?.id ?? '');
    let nationality = nations[nationalityId];
    if (!nationality) {
      nationality = (item.nationality?.label || '').trim();
      if (!nationality) throw new Error(`EA player ${item.id} has no nationality`);
      labelNations.set(nationalityId, { id: nationalityId, label: nationality, players: (labelNations.get(nationalityId)?.players || 0) + 1 });
    }
    const { short, long, display } = eaNames(item);
    const legal = referenceLongName(long, referenceNames.get(item.id));
    if (legal) carried++;
    const league = item.team ? leagues.get(item.leagueName) : null;
    const clubId = aliases.get(item.team?.id)?.referenceId ?? item.team?.id;
    return [item.id, `${EA_PLAYER_PAGE}${slugify(display)}/${item.id}`, version, '', date, short, long, positions.join(', '),
      item.overallRating, nationalityId, nationality, clubNames.get(clubId) ?? item.team?.label ?? '', item.team?.id ?? '',
      league?.leagueId ?? '', league?.name ?? '', league?.level ?? '', isoBirthdate(item.birthdate), legal];
  });
  if (unknownPositions.size) throw new Error(`Unknown EA positions: ${[...unknownPositions].map(([p, n]) => `${p} ×${n}`).join(', ')}`);
  return { rows, labelNations: [...labelNations.values()], carried };
}

const csvField = value => `"${String(value).replaceAll('"', '""')}"`;
export const toCsv = rows => rows.map(row => row.map(csvField).join(',')).join('\n') + '\n';

/** One page of the API, from the cache unless `refresh`. */
async function page(cacheDir, offset, refresh, gender = 0, headers = HEADERS) {
  const file = path.join(cacheDir, `page-${String(offset / LIMIT).padStart(4, '0')}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const url = `${ENDPOINT}?locale=en&limit=${LIMIT}&offset=${offset}&gender=${gender}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.items) || !Number.isInteger(body.totalItems)) throw new Error('Unexpected response');
      const result = { url, fetchedAt: new Date().toISOString(), ...body };
      await writeFile(file, JSON.stringify(result));
      await sleep(PAUSE_MS);
      return result;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * 5);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== '--refresh');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const refresh = args.includes('--refresh');
  const cacheDir = path.join(root, `data-src/ea-fc${VERSION}`);
  const { items, pages, date } = await pullPages(cacheDir, 0, refresh);

  const nations = JSON.parse(await readFile(data('ea-nations.json'), 'utf8')).nationalities;
  const aliases = readClubAliases(JSON.parse(await readFile(data('ea-club-aliases.json'), 'utf8')), VERSION, REFERENCE);
  const reference = parseCsv(await readFile(data(REFERENCE), 'utf8'));
  const { resolved, report, clubNames } = resolveLeagues(items, reference, aliases);
  const identity = checkClubIdentity(items, reference, { aliases, leagues: resolved, clubLeagues: CLUB_LEAGUES });
  const [header, ...referenceRows] = reference;
  const referenceNames = new Map(referenceRows.map(row => [Number(row[header.indexOf('player_id')]), row[header.indexOf('long_name')]]));
  const { rows, labelNations, carried } = reduceItems(items, { version: VERSION, date, nations, leagues: resolved, clubNames, aliases, referenceNames });
  const output = data(`ea-fc${VERSION}.csv`);
  await writeFile(output, toCsv([COLUMNS, ...rows]));
  console.log(`EA FC ${VERSION}: ${rows.length} men from ${pages} pages fetched ${date} -> ${path.relative(root, output)}`);
  for (const row of report) {
    console.log(`  ${row.leagueName.padEnd(38)} ${String(row.clubs).padStart(2)} clubs, ${String(row.shared).padStart(2)} in FC 26 -> `
      + (row.leagueId ? `${row.leagueId} ${row.name} (${row.votes}/${row.shared})` : 'unresolved, league fields left empty'));
  }
  for (const club of identity.aliased) {
    console.log(`  Alias ${club.id} "${club.label}" -> ${club.referenceId} ${club.name}: ${club.count} of the ${club.shared} players FC 26 also had (squad ${club.players})`);
  }
  console.log(`  New to FC 26 in the club leagues: ${identity.added.map(club => `${club.label} (${club.league})`).join(', ') || 'none'}`);
  console.log(`  Kept ${carried} FC 26 legal names as reference_long_name (the API's first and last name is part of each).`);
  for (const warning of identity.warnings) console.warn(`  warning: ${warning}`);
  for (const nation of labelNations) console.warn(`  warning: nationality ${nation.id} "${nation.label}" (${nation.players} players) is not in ea-nations.json; used the API label`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(`sync-ea-fc: ${error.message}`);
    process.exitCode = 1;
  });
}
