// The built-in football seasons before FIFA 05 (docs/design/football-years.md, "Seasons before FIFA 05"), each read
// from its pinned sources by its reader: shared by scripts/build-retro-seasons.mjs, which writes the season files, and
// scripts/build-season-countries.mjs, which takes every club of every division from the same database (`everyClub`).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { CM_CONVERSION, CM_SCALE } from '../../src/data/cmPlayers.js';
import { SWOS_CONVERSION, SWOS_PRICES, SWOS_SCALE } from '../../src/data/swosPlayers.js';
import { buildFootballSet, seasonYear } from '../../src/data/footballSetBuild.js';
import { setHasClubs } from '../../src/engine/footballSets.js';
import { TOP_CLUBS } from '../../src/data/scopes.js';
import { buildCm9798Season } from './cm9798.mjs';
import { SWOS_EUROPE_LEAGUES, SWOS_LEAGUES, SWOS_LEAGUE_FILES, buildSwosSeason } from './swos.mjs';
import { SWOS_NATIONAL_FILES, readTeamFile, swosRows } from './swos-files.mjs';

/** A source file's bytes, after checking it is the pinned one. */
export async function pinned(dataDir, file) {
  const at = path.join(dataDir, file.folder, file.name);
  if (!existsSync(at)) {
    throw new Error(`${at} is missing: ${file.download ? `download ${file.download} into data-src/${file.folder}/` : 'npm run sync:retro-cds reads it from its CD image'}`);
  }
  const bytes = await readFile(at);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`${at} is not the pinned ${file.name} (SHA-256 ${digest}, ${bytes.length} bytes); see scripts/data/retro-seasons.json`);
  }
  return bytes;
}

/**
 * The fields every season's source block adds to its maker's: who compiled it, from where, and when it was read (the
 * manifest's date, or the season's own where its sources were read another day).
 */
const credits = (season, retrieved) => ({ compiler: season.compiler, ...(season.provenance ? { provenance: season.provenance } : {}),
  retrieved: season.retrieved ?? retrieved });

/**
 * A CM 01/02-format database: the zip's .dat files, read by the CM 01/02 builder as a known release. A season may name
 * players of its own day to check the stored birth years against (`birthdays`), the clubs whose players of a nationality
 * play for another nation of their day (`noNationAt.playsFor`: East Germany's clubs, in 1989/90) or for none (`noNationAt`), and its
 * nations alone (src/engine/footballSets.js setHasClubs).
 */
async function buildCmZip(season, dataDir, retrieved, { everyClub = false } = {}) {
  const zip = await pinned(dataDir, season.file);
  // Only the Data folder's tables: the language and picture files are not read.
  const files = unzipSync(zip, { filter: entry => /^[^/]+\.dat$/i.test(entry.name) });
  return buildFootballSet(files, { local: false, sourceExtra: credits(season, retrieved), ...(season.birthdays ? { famous: season.birthdays } : {}),
    ...(season.noNationAt ? { noNationAt: season.noNationAt } : {}), ...(setHasClubs(season.id) ? { topClubs: TOP_CLUBS } : { clubs: false }), everyClub });
}

/** A Data folder's tables, each pinned on its own (taken from a CD, scripts/sync-retro-cds.mjs), read by the CM 01/02 builder as a known release. */
async function buildCmTables(season, dataDir, retrieved, { everyClub = false } = {}) {
  const files = {};
  for (const file of season.files) files[file.name] = new Uint8Array(await pinned(dataDir, file));
  return buildFootballSet(files, { local: false, kind: season.kind, sourceExtra: credits(season, retrieved), topClubs: TOP_CLUBS, everyClub });
}

async function buildCm9798(season, dataDir, retrieved, { everyClub = false } = {}) {
  const [players, teams] = await Promise.all(season.files.map(async file => JSON.parse((await pinned(dataDir, file)).toString('utf8'))));
  const source = { provider: season.maker, edition: season.edition, version: season.version, snapshotDate: season.snapshotDate, url: season.url,
    rawScale: CM_SCALE, conversion: CM_CONVERSION, ...credits(season, retrieved) };
  return buildCm9798Season({ players, teams }, { source, year: seasonYear(season.season), everyClub });
}

/**
 * A SWOS edition read from the game's own team files (scripts/lib/swos-files.mjs): its national squads, and Europe's
 * strongest TOP_CLUBS clubs of the top divisions of its European league files (SWOS_EUROPE_LEAGUES), as every other
 * season's club layer; with `everyClub`, every division's clubs of every league file too.
 */
async function buildSwosFiles(season, dataDir, retrieved, { everyClub = false } = {}) {
  const read = await Promise.all(season.files.map(async file => readTeamFile(await pinned(dataDir, file), file.name.replace(/^TEAM\./, ''))));
  const numbers = read.map(file => file.number).sort();
  if (JSON.stringify(numbers) !== JSON.stringify([...SWOS_NATIONAL_FILES, ...Object.keys(SWOS_LEAGUES)].sort())) {
    throw new Error(`${season.id} must list the six national and seven league files, not ${numbers.join(', ')}`);
  }
  const leagueFiles = await leagueFilesOf(season, dataDir, read);
  // Price steps as the SWOS 96/97 database stores them (0 as 1, 49 as 48), each one moved listed in the audit.
  const clamped = [];
  const rows = read.filter(file => SWOS_NATIONAL_FILES.includes(file.number)).flatMap(file => swosRows(file, 'NATIONAL', clamped));
  // Europe's first divisions (division 0 of each European league file).
  const clubRows = leagueFiles.filter(file => Object.hasOwn(SWOS_EUROPE_LEAGUES, file.number))
    .flatMap(file => swosRows({ ...file, teams: file.teams.filter(team => team.division === 0) }, 'CLUB', clamped));
  const source = { provider: season.maker, edition: season.edition, version: season.version, snapshotDate: season.snapshotDate, url: season.url,
    rawScale: SWOS_SCALE, conversion: SWOS_CONVERSION, ...credits(season, retrieved) };
  const result = buildSwosSeason(rows, { source, year: seasonYear(season.season), prices: SWOS_PRICES, id: season.id, clubRows, topClubs: TOP_CLUBS,
    // Every division's clubs of every league file, for the season's own country maps.
    ...(everyClub ? { everyClubRows: leagueFiles.flatMap(file => swosRows(file, 'CLUB', [])) } : {}) });
  return { ...result, audit: { ...result.audit, clamped } };
}

/**
 * Every league file of a SWOS season's edition (SWOS_LEAGUE_FILES): the seven it reads for its nations' file, and its
 * `leagueFiles`, the other leagues' files, whose top divisions join the season's club layer and whose every division
 * its own country maps read.
 */
async function leagueFilesOf(season, dataDir, read) {
  const others = await Promise.all((season.leagueFiles ?? []).map(async file => readTeamFile(await pinned(dataDir, file), file.name.replace(/^TEAM\./, ''))));
  const files = [...read.filter(file => Object.hasOwn(SWOS_LEAGUES, file.number)), ...others];
  const numbers = files.map(file => file.number).sort();
  if (JSON.stringify(numbers) !== JSON.stringify(Object.keys(SWOS_LEAGUE_FILES).sort())) {
    throw new Error(`${season.id}'s files and leagueFiles must be every league file of SWOS_LEAGUE_FILES, not ${numbers.join(', ')}`);
  }
  return files;
}

// By the season's `reader` where it names one, else by its kind (every SWOS season names its reader, 'swos-files').
export const BUILDERS = { cm0102: buildCmZip, cm: buildCm9798, 'swos-files': buildSwosFiles, tables: buildCmTables };

/**
 * One season of scripts/data/retro-seasons.json, read by its reader (`season.reader`, else its kind) from `dataDir`:
 * the CM 01/02 builder's or another reader's `{ doc, text, audit, warnings }`, and with `everyClub` its `allClubs` too.
 */
export function buildRetroSeason(season, dataDir, retrieved, options = {}) {
  const build = BUILDERS[season.reader ?? season.kind];
  if (!build) throw new Error(`${season.id} has kind ${season.kind}${season.reader ? ` and reader ${season.reader}` : ''}, which no builder makes`);
  return build(season, dataDir, retrieved, options);
}

