// Snapshot a tour's players: the Elo ratings Jeff Sackmann publishes on Tennis Abstract (the men's
// tennisabstract.com/reports/atp_elo_ratings.html, the women's wta_elo_ratings.html, updated weekly) and each player's
// country and birth date from the same site's rankings report (reports/atpRankings.html, reports/wtaRankings.html), or,
// for a rated player the rankings no longer list, from the player's own page there (cgi-bin/player.cgi?p=<key>, the
// women's wplayer.cgi). The pages are cached in the ignored data-src/tennis/, so a rerun reads them instead of the site;
// only the snapshot is committed.
//
// Usage: node scripts/sync-tennis.mjs [--tour=atp|wta] [--refresh]
//   --tour     the men's tour (atp, the default: npm run sync:tennis) or the women's (wta: npm run sync:womens-tennis)
//   --refresh  download everything again: a new snapshot, dated by the report's own "Last update"
// Output: scripts/data/tennis-elo.json (the men's) or scripts/data/womens-tennis-elo.json (the women's), committed, read
// by scripts/build-tennis.mjs.
//
// A snapshot row is [key, name, country, birth date, Elo, hard-court Elo, clay Elo, grass Elo, Elo rank, tour rank]:
// `key` is Tennis Abstract's (its player page's `p=`), `country` the IOC code the site files the player under, the Elos
// Tennis Abstract's own, unrounded, and the tour rank (ATP or WTA) null for a player the rankings report does not list.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/tennis');
const SITE = 'https://tennisabstract.com';
const TOURS = {
  atp: { elo: 'atp_elo_ratings.html', rankings: 'atpRankings.html', rank: 'ATP Rank', page: 'player.cgi', pages: 'players',
    output: 'scripts/data/tennis-elo.json' },
  wta: { elo: 'wta_elo_ratings.html', rankings: 'wtaRankings.html', rank: 'WTA Rank', page: 'wplayer.cgi', pages: 'wplayers',
    output: 'scripts/data/womens-tennis-elo.json' },
};
const PAUSE_MS = 1500;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh' && !/^--tour=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const tourId = args.find(arg => arg.startsWith('--tour='))?.slice('--tour='.length) ?? 'atp';
const tour = TOURS[tourId];
if (!tour) throw new Error(`Unknown tour ${tourId}: atp or wta`);
const ELO = `${SITE}/reports/${tour.elo}`;
const RANKINGS = `${SITE}/reports/${tour.rankings}`;
const PLAYER = key => `https://www.tennisabstract.com/cgi-bin/${tour.page}?p=${key}`;
const output = path.join(root, tour.output);
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
    // Keys keep a name's apostrophes and dots: BenjaminO'Connell, EricJr.Olivarez. The women's pages are wplayer.cgi.
    key: row.match(/player\.cgi\?p=([^"<>]+)"/)?.[1] ?? null,
    cells: [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(match => text(match[1])),
  }));
}

/** The report's own date: "Last update: 2026-11-02". */
const updatedOf = html => html.match(/Last update:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

await mkdir(cacheDir, { recursive: true });
const eloPage = await fetched(tour.elo, ELO);
const rankingsPage = await fetched(tour.rankings, RANKINGS);
const updated = updatedOf(eloPage);
if (!updated) throw new Error('No "Last update" date on the Elo report');
if (updatedOf(rankingsPage) !== updated) console.warn(`  warning: the rankings report was updated ${updatedOf(rankingsPage)}, the Elo report ${updated}`);

const ELO_HEADER = ['Elo Rank', 'Player', 'Age', 'Elo', '', 'hElo Rank', 'hElo', 'cElo Rank', 'cElo', 'gElo Rank', 'gElo', '', 'Peak Elo',
  'Peak Month', '', tour.rank, 'Log diff'];
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
  const [eloRank, name, , elo, , , hElo, , cElo, , gElo, , , , , tourRank] = cells;
  let place = ranked.get(key);
  if (!place) {
    // Not in the rankings report (retired, or out of the rankings): the player's own page says where from.
    const page = await fetched(`${tour.pages}/${key}.html`, PLAYER(key));
    const country = page.match(/var country = '([A-Z]{3})';/)?.[1];
    const dob = page.match(/var dob = (\d{8});/)?.[1];
    if (!country) throw new Error(`${name}: no country on ${PLAYER(key)}`);
    place = { rank: null, name, country, born: dob ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6)}` : null };
    fromPages.push(`${name} (${country})`);
  }
  rows.push([key, name, place.country, place.born, number(elo, name), number(hElo, name), number(cElo, name), number(gElo, name),
    number(eloRank, name), tourRank === '' ? place.rank : number(tourRank, name)]);
}
if (new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('A player is listed twice');

const retrieved = new Date().toISOString().slice(0, 10);
const source = { name: 'Tennis Abstract', author: 'Jeff Sackmann', updated, retrieved, players: rows.length, elo: ELO, rankings: RANKINGS };
const textOut = `{\n"source": ${JSON.stringify(source)},\n"players": [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
await writeFile(output, textOut);
console.log(`Tennis Abstract ${tourId.toUpperCase()} Elo of ${updated}: ${rows.length} players, ${new Set(rows.map(row => row[2])).size} countries -> ${path.relative(root, output)}`);
console.log(`  countries from player pages: ${fromPages.join(', ') || 'none'}`);
