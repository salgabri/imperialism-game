// Reduce the sources of the women's earlier seasons to the snapshots the build reads, which are committed
// (scripts/data/ea-women-seasons.json names every source; downloads and API pages stay in the ignored data-src/).
//
// Usage: node scripts/sync-womens-seasons.mjs [--data=<dir>] [--refresh]
//   --data     where the downloads and the API cache are (default data-src/)
//   --refresh  fetch EA FC 26 from EA's API again (else its cached pages are read)
//
// - EA FC 26: EA's ratings API, which serves the previous edition to a request without the ratings site's referrer,
//   reduced as scripts/sync-ea-fc-women.mjs reduces EA FC 27 (scripts/data/ea-fc26-women.csv).
// - EA FC 25: an export of EA's ratings website a week after release, reduced to the same columns
//   (scripts/data/ea-fc25-women.csv). It has no dates of birth, full names or club ids: a club takes its EA team id
//   from EA FC 26 or EA FC 27 by name.
// - FIFA 16 – EA FC 24: the women's table of the Kaggle export behind the men's FIFA 15 – EA FC 24 seasons, each edition's
//   launch roster (update 2), but for FIFA 16 and FIFA 19, whose roster the manifest takes from the same compiler's file
//   of every roster update (update 3: FIFA 19's update 2 is a pre-release roster still carrying FIFA 18's ratings), all
//   reduced to the columns the build reads (scripts/data/ea-women-16-24.csv).
// Each is written strongest first, then by EA id, so a rerun writes the same file.
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EA_COLUMNS } from './lib/ea-seasons.mjs';
import { pinned } from './lib/ea-season-files.mjs';
import { parseCsv } from './lib/football-data.mjs';
import { COLUMNS, pullPages, reduceItems, toCsv } from './sync-ea-fc.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = read('scripts/data/ea-women-seasons.json');
const table = read('scripts/data/ea-women-leagues.json');
const nations = read('scripts/data/ea-nations.json').nationalities;

const args = {};
for (const arg of process.argv.slice(2)) {
  const [, key, value] = /^--([a-z]+)(?:=(.+))?$/s.exec(arg) || [];
  if (key === 'data' && value) args.data = value;
  else if (key === 'refresh' && value === undefined) args.refresh = true;
  else throw new Error(`Unknown option ${arg}`);
}
const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));

/** The columns the women's build reads from the export: the men's export columns, and each league's name for the reader. */
export const WOMEN_COLUMNS = [...EA_COLUMNS, 'league_name'];
// The export writes whole numbers as floats ("24.0", "116009.0").
const whole = value => (/^\d+\.0$/.test(value) ? value.slice(0, -2) : value);
const INTEGERS = new Set(['player_id', 'fifa_version', 'fifa_update', 'overall', 'club_team_id', 'league_id']);
const strongestFirst = (columns, ...keys) => {
  const [overall, id, version] = ['overall', 'player_id', 'fifa_version'].map(name => columns.indexOf(name));
  return (a, b) => (keys.includes('version') ? b[version] - a[version] : 0) || b[overall] - a[overall] || a[id] - b[id];
};
const rowsOf = file => {
  const [header, ...rows] = parseCsv(readFileSync(path.join(root, file), 'utf8'));
  return rows.map(row => Object.fromEntries(header.map((name, i) => [name, row[i]])));
};
const write = async (file, columns, rows) => {
  await writeFile(path.join(root, file), toCsv([columns, ...rows]));
  return rows.length;
};
const [fc26, fc25] = ['eaw-fc-26', 'eaw-fc-25'].map(id => manifest.site.find(site => site.id === id));
// The ratings site's league labels as scripts/data/ea-women-leagues.json knows them (FC 25's "Liga F" is "Liga F Moeve").
const leagueOf = label => table.leagues[manifest.siteLeagues[label] ?? label];

// ---------- EA FC 26: EA's API without the referrer ----------
{
  const { items, pages, date } = await pullPages(path.join(dataDir, fc26.cache), 1, args.refresh, { headers: {} });
  if (items.length !== fc26.players) throw new Error(`EA's API served ${items.length} women, not EA FC 26's ${fc26.players}: it may serve another edition now`);
  const unnamed = [...new Set(items.map(item => item.leagueName))].filter(label => !leagueOf(label));
  if (unnamed.length) throw new Error(`Leagues not in ea-women-leagues.json: ${unnamed.join(', ')}`);
  const leagues = new Map(Object.keys(table.leagues).map(label => [label, { leagueId: table.leagues[label].id, name: table.leagues[label].name, level: 1 }]));
  const clubNames = new Map(items.filter(item => table.clubs[item.team?.label]).map(item => [item.team.id, table.clubs[item.team.label]]));
  const { rows, labelNations } = reduceItems(items, { version: fc26.fifaVersion, date, nations, leagues, clubNames, gender: 1 });
  if (labelNations.length) throw new Error(`Nationalities not in ea-nations.json: ${labelNations.map(n => `${n.id} ${n.label}`).join(', ')}`);
  // Every player's club and league come from the copy taken during the season: the API now names no club for the players
  // of clubs EA has dropped since, and gives some clubs EA FC 27's names. The copy must rate every player as the API does,
  // which also proves the API served EA FC 26.
  const { clubs: copy } = fc26;
  const [copyHeader, ...copyCells] = parseCsv(await pinned(path.join(dataDir, copy.folder, copy.file), copy.sha256, `EA FC 26 women's copy; download ${copy.download}`));
  if (copyCells.length !== copy.rows) throw new Error(`${copy.file} has ${copyCells.length} rows, not ${copy.rows}`);
  const copied = new Map(copyCells.map(cell => Object.fromEntries(copyHeader.map((name, k) => [name, cell[k]]))).map(row => [row.ID, row]));
  const col = name => COLUMNS.indexOf(name);
  const apiTeamIds = new Map(rows.filter(row => row[col('club_team_id')]).map(row => [row[col('club_name')], row[col('club_team_id')]]));
  let filled = 0, renamed = 0;
  for (const row of rows) {
    const other = copied.get(String(row[col('player_id')]));
    if (!other || Number(other.OVR) !== row[col('overall')]) throw new Error(`EA FC 26 player ${row[col('player_id')]}: the API and ${copy.file} disagree`);
    if (!other.Team) {
      for (const name of ['club_name', 'club_team_id', 'league_id', 'league_name', 'league_level']) row[col(name)] = '';
      continue;
    }
    const league = leagueOf(other.League);
    if (!league) throw new Error(`EA FC 26: league ${JSON.stringify(other.League)} is not in ea-women-leagues.json`);
    const own = manifest.siteClubs[other.Team];
    const club = own?.name ?? table.clubs[other.Team] ?? other.Team;
    if (!row[col('club_name')]) filled++;
    else if (row[col('club_name')] !== club) renamed++;
    // The API's team id stays the club's (EA keeps it across editions); a club the API no longer names takes the id the
    // manifest pins for it, or another player's of the same club, or none.
    const teamId = row[col('club_team_id')] || String(own?.team ?? apiTeamIds.get(club) ?? '');
    Object.assign(row, { [col('club_name')]: club, [col('club_team_id')]: teamId,
      [col('league_id')]: league.id, [col('league_name')]: league.name, [col('league_level')]: 1 });
  }
  const count = await write(fc26.snapshot, COLUMNS, rows.slice().sort(strongestFirst(COLUMNS)));
  console.log(`EA FC 26: ${count} women from ${pages} pages fetched ${date} -> ${fc26.snapshot}; from ${copy.file}: ${filled} clubs the API no longer names, ${renamed} renamed back`);
}

// ---------- EA FC 25: EA's ratings website, as exported a week after release ----------
{
  const text = await pinned(path.join(dataDir, fc25.folder, fc25.file), fc25.sha256, `EA FC 25 women's export; download ${fc25.download}`);
  const [header, ...cells] = parseCsv(text);
  if (cells.length !== fc25.rows) throw new Error(`${fc25.file} has ${cells.length} rows, not ${fc25.rows}`);
  // A club's EA team id by its full name, from the later editions' snapshots.
  const teamIds = new Map();
  for (const file of [fc26.snapshot, 'scripts/data/ea-fc27-women.csv']) {
    for (const row of rowsOf(file)) if (row.club_team_id && !teamIds.has(row.club_name)) teamIds.set(row.club_name, row.club_team_id);
  }
  const unplaced = new Map();
  const rows = cells.map((cell, i) => {
    const row = Object.fromEntries(header.map((name, k) => [name, cell[k]]));
    const link = /\/player-ratings\/([a-z0-9-]+)\/(\d{1,10})$/.exec(row.url);
    if (!link) throw new Error(`Row ${i + 2}: no EA player link ${JSON.stringify(row.url)}`);
    const league = row.Team ? leagueOf(row.League) : null;
    if (row.Team && !league) throw new Error(`Row ${i + 2}: league ${JSON.stringify(row.League)} is not in ea-women-leagues.json`);
    const own = manifest.siteClubs[row.Team];
    const club = row.Team ? own?.name ?? table.clubs[row.Team] ?? row.Team : '';
    const teamId = club ? String(own?.team ?? teamIds.get(club) ?? '') : '';
    if (club && !teamId) unplaced.set(club, (unplaced.get(club) || 0) + 1);
    const positions = [row.Position, ...row['Alternative positions'].split(',').map(key => key.trim()).filter(Boolean)];
    return [link[2], row.url, String(fc25.fifaVersion), String(fc25.update), fc25.snapshotDate, row.Name, row.Name,
      [...new Set(positions)].join(', '), row.OVR, '', row.Nation, club, teamId, league?.id ?? '', league?.name ?? '', league ? 1 : '', '', ''];
  });
  const count = await write(fc25.snapshot, COLUMNS, rows.sort(strongestFirst(COLUMNS)));
  console.log(`EA FC 25: ${count} women -> ${fc25.snapshot}`);
  if (unplaced.size) console.log(`  clubs with no EA team id in a later edition (grouped by name): ${[...unplaced].map(([club, n]) => `${club} (${n})`).join(', ')}`);
}

// ---------- FIFA 16 – EA FC 24: the Kaggle exports ----------
{
  const kept = [];
  for (const [key, source] of Object.entries(manifest.exports)) {
    const wanted = new Set(manifest.editions.filter(edition => edition.export === key).map(edition => `${edition.fifaVersion}/${edition.update}`));
    if (!wanted.size) continue;
    const text = await pinned(path.join(dataDir, source.folder, source.file), source.sha256, `women's export; download ${source.download}`);
    const [header, ...rows] = parseCsv(text);
    if (rows.length !== source.rows) throw new Error(`${source.file} has ${rows.length} rows, not ${source.rows}`);
    // The file of every update names the roster date fifa_update_date; the other, update_as_of.
    const at = WOMEN_COLUMNS.map(name => {
      const index = header.indexOf(name === 'update_as_of' && source.dateColumn ? source.dateColumn : name);
      if (index < 0) throw new Error(`${source.file} has no "${name}" column`);
      return index;
    });
    const mine = rows.map((row, i) => {
      if (row.length !== header.length) throw new Error(`${source.file} row ${i + 2} has ${row.length} fields; expected ${header.length}`);
      return WOMEN_COLUMNS.map((name, k) => (INTEGERS.has(name) ? whole(row[at[k]]) : row[at[k]]));
    }).filter(row => wanted.has(`${row[2]}/${row[3]}`));
    const missing = [...wanted].filter(want => !mine.some(row => `${row[2]}/${row[3]}` === want));
    if (missing.length) throw new Error(`${source.file} has no rows of ${missing.join(', ')}`);
    kept.push(...mine);
  }
  const count = await write(manifest.snapshot, WOMEN_COLUMNS, kept.sort(strongestFirst(WOMEN_COLUMNS, 'version')));
  console.log(`FIFA 16 – EA FC 24: ${count} women of ${manifest.editions.length} editions -> ${manifest.snapshot}`);
}
