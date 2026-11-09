// Snapshot the earlier Madden NFL seasons (docs/design/american-football.md, "Earlier seasons"): every rostered
// player's name, team, Madden position and overall in each edition's launch roster, from the sources
// scripts/data/nfl-seasons.json pins, into scripts/data/madden-seasons/<season>.json (committed), which
// npm run build:nfl-seasons builds the seasons from.
//
//   2001–2020, 2022, 2023  maddenratings.net's team spreadsheets of each edition's original roster (Madden NFL 2002
//              to 21, 23 and 24); EA's own lists, where they survive (Madden NFL 16, 17 and 23), check them
//   2021       the Madden NFL 22 launch ratings workbook kellerdevin/Madden-22-Data-Set keeps (maddenratings.net has only
//              the edition's final roster), checked against EA's ratings API as the Wayback Machine kept it in August 2021
//   2024, 2025 theedgepredictor/nfl-madden-data's copies of EA SPORTS' ratings site at launch (Madden NFL 25 and 26),
//              checked against the site's pages the Wayback Machine kept
// EA's ratings services today serve rewritten launch iterations (players removed or re-rated since), so no roster is
// read from them; each comes from a copy made at the time.
//
// Each source is a copy kept in the gitignored data-src/madden-seasons/<season>/, checked against its SHA-256 before
// it is read; a team spreadsheet is kept as team-<EA team id>. Every season is compared with a second source (the
// manifest's `checks`), and the agreement is written into its snapshot. Nothing is converted or guessed: a player the
// source gives no overall is left out and named in the snapshot's notes, as is one the game itself leaves unnamed
// (Madden NFL 2004 and 2005 list a few only by position and number, C.#25 or LG #65: nobody can say who they were);
// a position Madden does not have stops the sync.
//
// Usage: node scripts/sync-madden-seasons.mjs [--season=<year>] [--check]
//   --season  one season only
//   --check   rebuild the snapshots from the cached sources and compare them byte for byte; writes nothing
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readWorkbook } from './lib/madden-workbooks.mjs';
import { LEFT_OUT, POSITION_OF, teamsOf } from './lib/nfl.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestFile = path.join(root, 'scripts/data/nfl-seasons.json');
const teamsFile = path.join(root, 'scripts/data/nfl-teams.json');
const cacheDir = path.join(root, 'data-src/madden-seasons');
const outDir = path.join(root, 'scripts/data/madden-seasons');
// How many differences a check lists by name.
const EXAMPLES = 12;

/** A name as two sources may spell it differently: no accents, case, punctuation or suffix spacing. */
export const plainName = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '')
  .replace(/\s+/g, ' ').trim();
const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
/** A name the game gives a player it leaves unnamed: his position and number ('C.#25', 'LG #65'). */
export const UNNAMED = /#\s?\d+$/;
const known = listed => LEFT_OUT.has(listed) || Object.hasOwn(POSITION_OF, listed);

/** A pinned source file's bytes; throws when it is missing or not the file the manifest pins. */
async function pinned(year, name, sha256) {
  const file = path.join(cacheDir, String(year), name);
  if (!existsSync(file)) throw new Error(`${year}: ${path.relative(root, file)} is missing (see scripts/data/nfl-seasons.json for its source)`);
  const bytes = await readFile(file);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`${year}: ${name} is not the pinned file (SHA-256 ${actual})`);
  return bytes;
}
const jsonOf = bytes => JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8'));

/** A CSV's rows (RFC 4180: quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- a ratings table's columns ----------

const headerKey = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^plyr/, '');
const COLUMNS = {
  first: ['firstname', 'first'], last: ['lastname', 'last'], full: ['fullname', 'fullnameforsearch', 'name'], pos: ['position', 'pos', 'positionshortlabel'],
  overall: ['overall', 'overallrating', 'ovr'], team: ['team', 'teamname'],
};
/** The columns of a header row, or null when the row is no header (it must name a position, an overall and a name). */
export function headerOf(row) {
  const keys = row.map(headerKey);
  const at = names => { for (const name of names) { const i = keys.indexOf(name); if (i >= 0) return i; } return -1; };
  const columns = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, at(names)]));
  // A full name is read only where the first and last names are not both there.
  if (columns.first >= 0 && columns.last >= 0) columns.full = -1;
  if (columns.pos < 0 || columns.overall < 0 || (columns.full < 0 && (columns.first < 0 || columns.last < 0))) return null;
  return columns;
}

/**
 * A ratings table's players `{ name, pos, overall, team }`, under each header row it repeats (Madden NFL 12's sheets
 * start one per position), and its rows that rate nobody: `{ skipped: [{ name, pos, why }] }`.
 */
export function tableOf(rows) {
  const players = [], skipped = [];
  let columns = null;
  for (const row of rows) {
    const header = headerOf(row);
    if (header) { columns = header; continue; }
    if (!columns || row.every(cell => !clean(cell))) continue;
    const name = columns.full >= 0 ? clean(row[columns.full]) : clean(`${clean(row[columns.first])} ${clean(row[columns.last])}`);
    const pos = clean(row[columns.pos]), text = clean(row[columns.overall]);
    const team = columns.team >= 0 ? clean(row[columns.team]) : '';
    if (!name) { skipped.push({ name: '(no name)', pos, why: 'no name' }); continue; }
    if (!/^\d+(\.0+)?$/.test(text) || Number(text) < 1 || Number(text) > 99) { skipped.push({ name, pos, why: text ? `overall ${text}` : 'no overall' }); continue; }
    players.push({ name, pos, overall: Number(text), team });
  }
  return { players, skipped };
}

// ---------- the sources ----------

/** The token that shows a team spreadsheet is this franchise's: its nickname, or for Washington its city. */
const tokenOf = name => (name.startsWith('Washington') ? 'washington' : name.split(' ').pop().toLowerCase());

/** maddenratings.net: one spreadsheet per team (team-<EA id>.xlsx or .xls), one sheet each. */
async function fromSpreadsheets(year, source, teams) {
  const byEa = new Map(teams.map(team => [String(team.ea), team]));
  const rows = [], notes = [];
  const files = Object.entries(source.files);
  const eas = files.map(([name]) => /^team-(\d+)\.xlsx?$/.exec(name)?.[1]);
  if (eas.some(ea => !byEa.has(ea)) || new Set(eas).size !== teams.length) throw new Error(`${year}: the spreadsheets are not the season's ${teams.length} teams`);
  for (const [name, sha256] of files) {
    const team = byEa.get(/^team-(\d+)/.exec(name)[1]);
    const sheets = readWorkbook(await pinned(year, name, sha256));
    if (sheets.length !== 1) throw new Error(`${year} ${team.name}: ${sheets.length} sheets`);
    const [sheet] = sheets;
    const { players, skipped } = tableOf(sheet.rows);
    const label = [sheet.name, ...new Set(players.map(p => p.team))].join(' ').toLowerCase();
    if (!label.includes(tokenOf(team.name))) throw new Error(`${year}: ${name} is "${sheet.name}", not the ${team.name}`);
    for (const p of players) rows.push({ name: p.name, ea: team.ea, pos: p.pos, overall: p.overall });
    for (const s of skipped) notes.push(`left out, ${s.why}: ${team.name} ${s.pos || '?'} ${s.name}`);
  }
  return { rows, notes };
}

/**
 * The season's team a source names: its full name ("Washington Commanders"), EA's short form of the two New York teams
 * ("NY Jets"), or its nickname alone ("Commanders", "Football Team"); null for none of the season's.
 */
export function teamOfLabel(teams, label) {
  const name = clean(label).replace(/^NY /, 'New York ');
  return teams.find(team => team.name === name) || teams.find(team => name && team.name.endsWith(` ${name}`)) || null;
}

/** A CSV with a name, team, position and overall per row (theedgepredictor/nfl-madden-data's raw season files). */
function csvTable(bytes) {
  const [header, ...rest] = parseCsv(bytes.toString('utf8'));
  return tableOf([header, ...rest.filter(row => row.length > 1)]);
}

/** One sheet of a workbook, by name (the first sheet when none is named). */
function sheetOf(year, bytes, name) {
  const sheets = readWorkbook(bytes);
  const sheet = name ? sheets.find(s => s.name === name) : sheets[0];
  if (!sheet) throw new Error(`${year}: the workbook has no sheet ${JSON.stringify(name)}`);
  return sheet;
}

/**
 * One table of the whole league (a CSV, or the sheet `source.sheet` of a workbook), each row naming its team: the
 * season's teams by name or nickname. theedgepredictor/nfl-madden-data's 2024 and 2025 files, and the Madden NFL 22
 * launch workbook.
 */
async function fromLeagueTable(year, source, teams) {
  const rows = [], notes = [];
  for (const [name, sha256] of Object.entries(source.files)) {
    const bytes = await pinned(year, name, sha256);
    const { players, skipped } = /\.xlsx?$/.test(name) ? tableOf(sheetOf(year, bytes, source.sheet).rows) : csvTable(bytes);
    for (const p of players) {
      const team = teamOfLabel(teams, p.team);
      if (!team) throw new Error(`${year}: ${p.name}'s team ${JSON.stringify(p.team)} is not one of the season's`);
      rows.push({ name: p.name, ea: team.ea, pos: p.pos, overall: p.overall });
    }
    for (const s of skipped) notes.push(`left out, ${s.why}: ${s.pos || '?'} ${s.name}`);
  }
  if (new Set(rows.map(r => r.ea)).size !== teams.length) throw new Error(`${year}: the table does not have the season's ${teams.length} teams`);
  return { rows, notes };
}

const READERS = { maddenratings: fromSpreadsheets, table: fromLeagueTable };

// ---------- the second sources ----------

/**
 * A check's players `{ name, pos, overall, ea? }`: a CSV or a workbook's sheet (`sheet`) of the whole league, or EA
 * SPORTS' own ratings as the Wayback Machine kept them, its ratings API's documents or its ratings site's items (both
 * naming each player's team by EA's id).
 */
async function checkRows(year, check) {
  const rows = [];
  for (const [name, sha256] of Object.entries(check.files)) {
    const bytes = await pinned(year, name, sha256);
    if (check.kind === 'table') {
      rows.push(...(/\.xlsx?$/.test(name) ? tableOf(sheetOf(year, bytes, check.sheet).rows) : csvTable(bytes)).players);
    } else if (check.kind === 'ea-ratings-api') {
      for (const doc of jsonOf(bytes).docs) rows.push({ name: clean(`${doc.firstName} ${doc.lastName}`), pos: doc.position, overall: doc.overall_rating, ea: doc.teamId });
    } else if (check.kind === 'ea-ratings-site') {
      for (const item of jsonOf(bytes).items) {
        rows.push({ name: clean(`${item.firstName} ${item.lastName}`), pos: item.position?.shortLabel ?? '', overall: item.overallRating, ea: item.team?.id });
      }
    } else throw new Error(`${year}: unknown check ${check.kind}`);
  }
  return rows;
}

/**
 * How a second source agrees with the season's players: each of the season's players found there by name (on the
 * same team where the check names teams by EA's ids; of several, the one at the same position, else the one rated the
 * same), and how many of those it gives the same overall and position. `differences` names the first few that differ,
 * as "name position overall (the check's overall)".
 */
export function agreement(players, others) {
  const byName = new Map();
  for (const other of others) {
    const key = plainName(other.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(other);
  }
  let matched = 0, sameOverall = 0, samePosition = 0;
  const differences = [];
  for (const p of players) {
    const candidates = (byName.get(plainName(p.name)) || []).filter(other => other.ea == null || other.ea === p.ea);
    if (!candidates.length) continue;
    const other = candidates.find(c => c.pos === p.pos && c.overall === p.overall) || candidates.find(c => c.pos === p.pos)
      || candidates.find(c => c.overall === p.overall) || candidates[0];
    matched++;
    if (p.overall === other.overall) sameOverall++;
    else differences.push(`${p.name} ${p.pos} ${p.overall} (${other.overall})`);
    if (p.pos === other.pos) samePosition++;
  }
  return { rows: others.length, matched, sameOverall, samePosition, differences: differences.slice(0, EXAMPLES) };
}

// ---------- a season ----------

const byTeamThenRating = names => (a, b) => names.get(a.ea).localeCompare(names.get(b.ea)) || b.overall - a.overall || a.name.localeCompare(b.name)
  || a.pos.localeCompare(b.pos);

/** Season `year`'s snapshot as text. */
async function snapshotOf(year, manifest, franchises) {
  const source = manifest.sources[year];
  if (!source) throw new Error(`The manifest has no source for ${year}`);
  const read = READERS[source.kind];
  if (!read) throw new Error(`${year}: unknown source ${source.kind}`);
  const teams = teamsOf(franchises, manifest, year);
  const { rows, notes } = await read(year, source, teams);
  for (const row of rows) {
    if (!known(row.pos)) throw new Error(`${year}: unknown Madden position ${row.pos} (${row.name})`);
    if (!Number.isInteger(row.overall) || row.overall < 1 || row.overall > 99) throw new Error(`${year}: ${row.name} has no overall`);
  }
  const names = new Map(teams.map(team => [team.ea, team.name]));
  // A row repeated word for word is one player listed twice; two players of one name and position on a team (rated
  // apart) are two. A player the game names only by position and number is nobody anyone can name.
  const rowsSeen = new Set(), peopleSeen = new Set(), namesakes = new Set(), unnamed = [];
  const players = rows.filter(row => {
    const key = `${row.ea}|${row.name}|${row.pos}|${row.overall}`, person = `${row.ea}|${row.name}|${row.pos}`;
    if (UNNAMED.test(row.name)) { unnamed.push(row); return false; }
    if (rowsSeen.has(key)) { notes.push(`listed twice, kept once: ${names.get(row.ea)} ${row.pos} ${row.name}`); return false; }
    if (peopleSeen.has(person)) namesakes.add(`${names.get(row.ea)} ${row.pos} ${row.name}`);
    rowsSeen.add(key);
    peopleSeen.add(person);
    return true;
  }).sort(byTeamThenRating(names));
  if (namesakes.size) notes.push(`two players of one name and position, both kept: ${[...namesakes].join('; ')}`);
  if (unnamed.length) {
    notes.push(`left out, unnamed by the game: ${unnamed.sort(byTeamThenRating(names)).map(row => `${names.get(row.ea)} ${row.pos} ${row.name} (${row.overall})`).join('; ')}`);
  }
  const checks = [];
  for (const check of source.checks || []) checks.push({ name: check.name, url: check.url, ...agreement(players, await checkRows(year, check)) });
  const { files, checks: _, ...about } = source;
  const snapshot = {
    note: `Every player of ${source.edition}'s launch roster (the ${year} season) as [name, EA team id, Madden position, overall], read by npm run sync:madden-seasons from the sources scripts/data/nfl-seasons.json pins; npm run build:nfl-seasons builds the season from it.`,
    source: { ...about, season: String(year), files: Object.keys(files).length, players: players.length },
    teams: Object.fromEntries(teams.map(team => [team.ea, team.name])),
    checks,
    notes,
  };
  const head = Object.entries(snapshot).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${[...head, `  "players": [\n${players.map(row => `    ${JSON.stringify([row.name, row.ea, row.pos, row.overall])}`).join(',\n')}\n  ]`].join(',\n')}\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = args.find(arg => arg.startsWith('--season='))?.slice('--season='.length);
  const unknown = args.filter(arg => arg !== '--check' && !arg.startsWith('--season='));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const franchises = JSON.parse(await readFile(teamsFile, 'utf8')).teams;
  // The Tecmo seasons' snapshots are npm run sync:tecmo's, Madden NFL 99 to 2001's (source ndb) npm run
  // sync:madden-early's and the computed seasons' (pfa) npm run sync:pfa's.
  const madden = manifest.seasons.filter(year => !['tecmo', 'ndb', 'pfa'].includes(manifest.sources[year]?.kind));
  const years = only ? [Number(only)] : madden;
  if (years.some(year => !madden.includes(year))) throw new Error(`No Madden season ${only} in the manifest`);
  const differs = [];
  for (const year of years) {
    const text = await snapshotOf(year, manifest, franchises);
    const file = path.join(outDir, `${year}.json`);
    const parsed = JSON.parse(text);
    console.log(`${year} ${parsed.source.edition}: ${parsed.source.players} players of ${Object.keys(parsed.teams).length} teams; `
      + parsed.checks.map(c => `${c.name}: ${c.sameOverall}/${c.matched} same overall`).join(', '));
    if (check) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    } else {
      await mkdir(outDir, { recursive: true });
      await writeFile(file, text);
    }
  }
  if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
  console.log(check ? `Verified ${years.length} snapshots byte for byte.` : `Wrote ${years.length} snapshots to ${path.relative(root, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`sync-madden-seasons: ${error.message}`);
    process.exitCode = 1;
  });
}
