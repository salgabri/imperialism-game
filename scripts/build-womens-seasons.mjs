// Build the built-in earlier women's football seasons (docs/design/womens-football.md, "Earlier seasons").
//
//   npm run build:womens-seasons             writes public/womens-football/eaw-*.json, src/data/womensFootballSeasons.js
//                                            and docs/design/womens-seasons-audit.json
//   npm run build:womens-seasons -- --check  builds every file and compares it byte for byte, writes nothing
//
// Each season is one EA edition's women from the committed snapshots (npm run sync:womens-seasons), built by the
// built-in season's rules (scripts/lib/ea-women-seasons.mjs). scripts/data/ea-women-seasons.json lists the editions,
// EA's leagues and the clubs' names.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CLUBS } from '../src/data/clubs.womens-football.js';
import { EA_SCALE } from '../src/data/eaPlayers.js';
import { assembleWomensSeason, clubNameOf } from './lib/ea-women-seasons.mjs';
import { parseCsv } from './lib/football-data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/womens-football');
const listingFile = path.join(root, 'src/data/womensFootballSeasons.js');
const auditFile = path.join(root, 'docs/design/womens-seasons-audit.json');
const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);

const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-women-seasons.json'), 'utf8'));
const table = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-women-leagues.json'), 'utf8'));
// The game's leagues by their real names (the site snapshots' league_name), one object each.
const leagueByName = new Map(Object.values(table.leagues).map(league => [league.name, { name: league.name, country: league.country, main: !!league.main }]));
// The export's leagues by EA league id.
const leagueById = new Map(Object.entries(manifest.leagues).map(([id, league]) => [id, { name: league.name, country: league.country, main: !!league.main }]));
const EA_PAGE = /\/player-ratings\/([a-z0-9-]+)\/(\d{1,10})$/;
// A SoFIFA link, as the export gives it: /player/<EA id>/<slug>/<roster id>.
const PLAYER_LINK = /^(?:https:\/\/sofifa\.com)?\/player\/(\d{1,10})\/([a-z0-9-]+)\/(\d{6})\/?$/;
// The built-in clubs' ids by EA team id, so a club keeps its id (and its crest and colour) in every season.
const builtIn = new Map(CLUBS.map(club => [String(club.squad[0][3].clubId), club.id]));

/** The export's rows of one edition as the season's records and source block. */
function exportSeason(rows, edition) {
  const mine = rows.filter(row => Number(row.fifa_version) === edition.fifaVersion && Number(row.fifa_update) === edition.update);
  if (!mine.length) throw new Error(`${edition.edition}: the snapshot has no rows`);
  const dates = [...new Set(mine.map(row => row.update_as_of))], rosters = new Set();
  if (dates.length !== 1) throw new Error(`${edition.edition}: roster dates ${dates.join(', ')}, not one`);
  const records = mine.map(row => {
    const link = PLAYER_LINK.exec(row.player_url);
    if (!link || link[1] !== row.player_id) throw new Error(`${edition.edition}: player ${row.player_id} links to ${JSON.stringify(row.player_url)}`);
    rosters.add(link[3]);
    const teamId = Number(row.club_team_id) || null;
    return { eaId: row.player_id, name: row.short_name, fullName: row.long_name, overall: row.overall, positions: row.player_positions,
      keys: row.player_positions.split(',').map(key => key.trim()), dob: row.dob, nationality: row.nationality_name,
      club: teamId ? clubNameOf(row.club_name, teamId, manifest.clubs) : '', slug: link[2], teamId,
      league: teamId ? leagueById.get(row.league_id) ?? null : null };
  });
  if (rosters.size !== 1) throw new Error(`${edition.edition}: rows from rosters ${[...rosters].join(', ')}, not one`);
  const source = { provider: 'EA Sports', edition: edition.edition, update: edition.update, roster: [...rosters][0], snapshotDate: dates[0],
    url: manifest.exports[edition.export].url, rawScale: EA_SCALE };
  return { records, source };
}

/** A site snapshot's rows (EA's ratings API or website, scripts/data/ea-fc2<n>-women.csv) as the season's records and source block. */
function siteSeason(rows, site) {
  const dates = [...new Set(rows.map(row => row.fifa_update_date))];
  if (dates.length !== 1) throw new Error(`${site.edition}: snapshot dates ${dates.join(', ')}, not one`);
  if (site.snapshotDate && dates[0] !== site.snapshotDate) throw new Error(`${site.edition}: snapshot of ${dates[0]}, not ${site.snapshotDate}`);
  const records = rows.map(row => {
    if (Number(row.fifa_version) !== site.fifaVersion) throw new Error(`${site.edition}: player ${row.player_id} is of edition ${row.fifa_version}`);
    const link = EA_PAGE.exec(row.player_url);
    if (!link || link[2] !== row.player_id) throw new Error(`${site.edition}: player ${row.player_id} links to ${JSON.stringify(row.player_url)}`);
    const club = row.club_name;
    const league = club ? leagueByName.get(row.league_name) : null;
    if (club && !league) throw new Error(`${site.edition}: ${club} plays in ${JSON.stringify(row.league_name)}, not a league of ea-women-leagues.json`);
    return { eaId: row.player_id, name: row.short_name, fullName: row.long_name, overall: row.overall, positions: row.player_positions,
      keys: row.player_positions.split(',').map(key => key.trim()), dob: row.dob, nationality: row.nationality_name, club,
      slug: link[1], teamId: club ? row.club_team_id || `name:${club}` : null, league };
  });
  const source = { provider: 'EA Sports', edition: site.edition, update: site.update, roster: site.roster, snapshotDate: dates[0],
    url: site.url, rawScale: EA_SCALE };
  return { records, source };
}

const rowsOf = async file => {
  const [header, ...cells] = parseCsv(await readFile(path.join(root, file), 'utf8'));
  return cells.map(row => Object.fromEntries(header.map((name, i) => [name, row[i]])));
};
const options = { rest: manifest.rest, builtIn };
const results = [];
for (const site of manifest.site) {
  const { records, source } = siteSeason(await rowsOf(site.snapshot), site);
  results.push(assembleWomensSeason(records, { ...site, source }, options));
}
const exported = await rowsOf(manifest.snapshot);
for (const edition of manifest.editions) {
  const { records, source } = exportSeason(exported, edition);
  results.push(assembleWomensSeason(records, { ...edition, source }, options));
}

const listing = `// GENERATED by npm run build:womens-seasons from EA's FIFA / FC rosters (scripts/data/ea-women-seasons.json); do not edit.
${manifest.site.map(site => `// ${site.edition}: ${site.name}
`).join('')}${Object.values(manifest.exports).map(source => `// ${source.name}, SHA-256 ${source.sha256.slice(0, 12)}…`).join('\n')}
// The built-in earlier women's football seasons, newest first. Each is public/womens-football/<id>.json, loaded when a
// setup chooses it (src/engine/footballSets.js). FIFA 16 to FIFA 22 have national teams only.
export const BUILT_IN_WOMENS_SEASONS = Object.freeze([
${results.map(({ doc }) => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`).join('\n')}
]);
`;
const audit = `${JSON.stringify({ generatedBy: 'scripts/build-womens-seasons.mjs', site: manifest.site, exports: manifest.exports,
  seasons: results.map(result => result.audit) }, null, 2)}\n`;
const files = [...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]), [listingFile, listing], [auditFile, audit]];

for (const { doc, audit: row } of results) {
  console.log(`${doc.id} ${doc.season} ${doc.label} (${row.snapshotDate}, ${row.rows} players): ${doc.coverage.nations} nations, `
    + `${doc.coverage.completeXIs} natural XIs, ${doc.coverage.clubs} clubs in ${doc.coverage.leagues} leagues`);
  for (const warning of row.warnings) console.log(`  warning: ${warning}`);
}
if (check) {
  let differs = false;
  for (const [file, text] of files) {
    let current = null;
    try { current = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n'); } catch { /* missing */ }
    if (current !== text) { console.error(`differs: ${path.relative(root, file)}`); differs = true; }
  }
  if (differs) process.exit(1);
  console.log(`Verified ${results.length} women's seasons, their listing and audit byte for byte.`);
} else {
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of files) await writeFile(file, text);
  console.log(`Wrote ${results.length} women's seasons to public/womens-football/, ${path.relative(root, listingFile)} and ${path.relative(root, auditFile)}`);
}
