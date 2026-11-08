// Snapshot tennis's players: the men's Elo ratings Jeff Sackmann publishes on Tennis Abstract
// (tennisabstract.com/reports/atp_elo_ratings.html, updated weekly) and each player's country and birth date from the
// same site's ATP rankings report (reports/atpRankings.html), or, for a rated player the rankings no longer list, from his
// own page there (cgi-bin/player.cgi?p=<key>). The pages are cached in the ignored data-src/tennis/, so a rerun reads
// them instead of the site; only the snapshot is committed.
//
// Usage: node scripts/sync-tennis.mjs [--refresh]
//   --refresh  download everything again: a new snapshot, dated by the report's own "Last update"
// Output: scripts/data/tennis-elo.json (committed), read by scripts/build-tennis.mjs.
//
// A snapshot row is [key, name, country, birth date, Elo, hard-court Elo, clay Elo, grass Elo, Elo rank, ATP rank]:
// `key` is Tennis Abstract's (its player page's `p=`), `country` the IOC code the site files him under, the Elos
// Tennis Abstract's own, unrounded, and the ATP rank null for a player the rankings report does not list.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/tennis');
const output = path.join(root, 'scripts/data/tennis-elo.json');
const SITE = 'https://tennisabstract.com';
const ELO = `${SITE}/reports/atp_elo_ratings.html`;
const RANKINGS = `${SITE}/reports/atpRankings.html`;
const PLAYER = key => `https://www.tennisabstract.com/cgi-bin/player.cgi?p=${key}`;
const PAUSE_MS = 1500;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One page's HTML, from the cache unless `refresh`. */
async function fetched(file, url) {
  const at = path.join(cacheDir, file);
  if (!refresh && existsSync(at)) return readFile(at, 'utf8');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game data sync' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      await mkdir(path.dirname(at), { recursive: true });
      await writeFile(at, body);
      await sleep(PAUSE_MS);
      return body;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * 3);
    }
  }
}

const text = cell => cell.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The report's sortable table (`id="reportable"`) → [{ key, cells }], one per player row, its header checked. */
function reportRows(html, header) {
  const table = html.slice(html.indexOf('id="reportable"'));
  const rows = [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].map(match => match[1]);
  const head = [...rows[0].matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map(match => text(match[1]));
  if (JSON.stringify(head) !== JSON.stringify(header)) throw new Error(`The report's columns changed: ${JSON.stringify(head)}`);
  return rows.slice(1).map(row => ({
    // Keys keep a name's apostrophes and dots: BenjaminO'Connell, EricJr.Olivarez.
    key: row.match(/player\.cgi\?p=([^"<>]+)"/)?.[1] ?? null,
    cells: [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(match => text(match[1])),
  }));
}

/** The report's own date: "Last update: 2026-11-02". */
const updatedOf = html => html.match(/Last update:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

await mkdir(cacheDir, { recursive: true });
const eloPage = await fetched('atp_elo_ratings.html', ELO);
const rankingsPage = await fetched('atpRankings.html', RANKINGS);
const updated = updatedOf(eloPage);
if (!updated) throw new Error('No "Last update" date on the Elo report');
if (updatedOf(rankingsPage) !== updated) console.warn(`  warning: the rankings report was updated ${updatedOf(rankingsPage)}, the Elo report ${updated}`);

const ELO_HEADER = ['Elo Rank', 'Player', 'Age', 'Elo', '', 'hElo Rank', 'hElo', 'cElo Rank', 'cElo', 'gElo Rank', 'gElo', '', 'Peak Elo',
  'Peak Month', '', 'ATP Rank', 'Log diff'];
const RANKINGS_HEADER = ['Rank', 'Player', 'Country', 'Birthdate'];
const number = (value, what) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a number for ${what}: ${JSON.stringify(value)}`);
  return n;
};

const ranked = new Map();
for (const { key, cells } of reportRows(rankingsPage, RANKINGS_HEADER)) {
  if (!key) throw new Error(`A rankings row without a player link: ${cells.join(' | ')}`);
  const [rank, name, country, born] = cells;
  if (!/^[A-Z]{3}$/.test(country)) throw new Error(`${name}: no country code (${country})`);
  ranked.set(key, { rank: number(rank, name), name, country, born: /^\d{4}-\d{2}-\d{2}$/.test(born) ? born : null });
}

const rows = [], fromPages = [];
for (const { key, cells } of reportRows(eloPage, ELO_HEADER)) {
  if (!key) throw new Error(`An Elo row without a player link: ${cells.join(' | ')}`);
  const [eloRank, name, , elo, , , hElo, , cElo, , gElo, , , , , atpRank] = cells;
  let place = ranked.get(key);
  if (!place) {
    // Not in the rankings report (retired, or out of the rankings): his own page says where he is from.
    const page = await fetched(`players/${key}.html`, PLAYER(key));
    const country = page.match(/var country = '([A-Z]{3})';/)?.[1];
    const dob = page.match(/var dob = (\d{8});/)?.[1];
    if (!country) throw new Error(`${name}: no country on ${PLAYER(key)}`);
    place = { rank: null, name, country, born: dob ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6)}` : null };
    fromPages.push(`${name} (${country})`);
  }
  rows.push([key, name, place.country, place.born, number(elo, name), number(hElo, name), number(cElo, name), number(gElo, name),
    number(eloRank, name), atpRank === '' ? place.rank : number(atpRank, name)]);
}
if (new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('A player is listed twice');

const retrieved = new Date().toISOString().slice(0, 10);
const source = { name: 'Tennis Abstract', author: 'Jeff Sackmann', updated, retrieved, players: rows.length, elo: ELO, rankings: RANKINGS };
const textOut = `{\n"source": ${JSON.stringify(source)},\n"players": [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
await writeFile(output, textOut);
console.log(`Tennis Abstract Elo of ${updated}: ${rows.length} players, ${new Set(rows.map(row => row[2])).size} countries -> ${path.relative(root, output)}`);
console.log(`  countries from player pages: ${fromPages.join(', ') || 'none'}`);
