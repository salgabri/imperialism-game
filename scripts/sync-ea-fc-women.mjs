// Snapshot the women's players of the current EA SPORTS FC edition from EA's public ratings API (scripts/sync-ea-fc.mjs
// reads the men's the same way), reduced to the same columns. The API's pages are cached in the ignored
// data-src/ea-fc<NN>-women/, so a rerun reads them instead of the API; only the reduced CSV is committed.
//
// Usage: node scripts/sync-ea-fc-women.mjs [--refresh]
//   --refresh  download the pages again: a new snapshot, dated the day it is fetched
// Output: scripts/data/ea-fc27-women.csv (committed), read by scripts/build-womens-football.mjs.
//
// The API has no league ids, and gives sponsors' league names and some shortened or garbled club names:
// scripts/data/ea-women-leagues.json gives each league its real name, a number of the game's own and its country, and
// each such club its full name. A league or nationality missing from those tables stops the reduce.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { COLUMNS, pullPages, reduceItems, toCsv } from './sync-ea-fc.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = 27;
const data = file => path.join(root, 'scripts/data', file);

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);

const { items, pages, date } = await pullPages(path.join(root, `data-src/ea-fc${VERSION}-women`), 1, args.includes('--refresh'));
const table = JSON.parse(await readFile(data('ea-women-leagues.json'), 'utf8'));
const nations = JSON.parse(await readFile(data('ea-nations.json'), 'utf8')).nationalities;

const unnamed = [...new Set(items.map(item => item.leagueName))].filter(name => !table.leagues[name]);
if (unnamed.length) throw new Error(`Leagues not in ea-women-leagues.json: ${unnamed.join(', ')}`);
const leagues = new Map(Object.entries(table.leagues).map(([label, league]) => [label, { leagueId: league.id, name: league.name, level: 1 }]));
const clubNames = new Map(items.filter(item => table.clubs[item.team?.label]).map(item => [item.team.id, table.clubs[item.team.label]]));
const { rows, labelNations } = reduceItems(items, { version: VERSION, date, nations, leagues, clubNames, gender: 1 });
if (labelNations.length) throw new Error(`Nationalities not in ea-nations.json: ${labelNations.map(n => `${n.id} ${n.label}`).join(', ')}`);

// Strongest first, then by EA id, so a rerun of one pull writes the same file.
const overall = COLUMNS.indexOf('overall'), id = COLUMNS.indexOf('player_id');
const sorted = rows.slice().sort((a, b) => b[overall] - a[overall] || a[id] - b[id]);
const output = data(`ea-fc${VERSION}-women.csv`);
await writeFile(output, toCsv([COLUMNS, ...sorted]));
console.log(`EA FC ${VERSION}: ${rows.length} women from ${pages} pages fetched ${date} -> ${path.relative(root, output)}`);
