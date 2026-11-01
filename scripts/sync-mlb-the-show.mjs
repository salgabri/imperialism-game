// Snapshot the Live series of MLB The Show: every MLB player's card, as the game's own public API lists it
// (https://mlb26.theshow.com/apis/docs, Sony Interactive Entertainment). The Live series is the current roster of
// every club, its ratings moved by each roster update; the other series (legends, award and event cards) are left
// out. The API is JSON throughout: nothing here reads a page or runs a script.
//
// Usage: node scripts/sync-mlb-the-show.mjs [--edition=26] [--refresh] [--parallel=1]
//   --edition  the edition to read (mlb<edition>.theshow.com); the default is the one the game ships
//   --refresh  download the pages again instead of reading data-src/mlb-the-show/mlb<edition>/
//   --parallel pages requested at once, at most 4 (default 1): the older editions' hosts take 15-25 s a page
// Output: scripts/data/mlb-the-show-<edition>.json (committed), read by scripts/build-mlb.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const edition = arg('edition') || '26';
if (!/^\d\d$/.test(edition)) throw new Error(`--edition takes two digits (26 for MLB The Show 26), not ${edition}`);
const refresh = args.includes('--refresh');
const parallel = Math.max(1, Math.min(4, Number(arg('parallel')) || 1));

const EDITION = `MLB The Show ${edition}`;
// The Show's edition N rates the season of the year 20N.
const SEASON = `20${edition}`;
const HOST = `https://mlb${edition}.theshow.com`;
const API = `${HOST}/apis`;
const LIVE = 'Live';
const PAUSE_MS = 1500;
const cacheDir = path.join(root, 'data-src/mlb-the-show', `mlb${edition}`);
const output = path.join(root, `scripts/data/mlb-the-show-${edition}.json`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One API answer, from the cache or the API. */
async function readJson(name, url) {
  const file = path.join(cacheDir, `${name}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (imperialism-game roster sync)', accept: 'application/json' },
        signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = { url, retrieved: new Date().toISOString().slice(0, 10), body: await response.json() };
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(data));
      await sleep(PAUSE_MS);
      return data;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * (attempt + 2));
    }
  }
}

const itemsUrl = page => `${API}/items.json?type=mlb_card&page=${page}`;

/** A Live card as the snapshot keeps it, or null for any other series. */
function card(item, at) {
  if (item.type !== 'mlb_card') throw new Error(`${at}: not a player card (${item.type})`);
  if (item.series !== LIVE) return null;
  const name = String(item.name ?? '').trim();
  if (!/^[0-9a-f]{32}$/.test(item.uuid) || !name) throw new Error(`${at}: a card without a uuid or a name`);
  if (!Number.isInteger(item.ovr) || item.ovr < 1 || item.ovr > 99) throw new Error(`${at}: ${name} has no overall`);
  if (!/^[A-Z]{2,3}$/.test(item.team_short_name || '') || typeof item.team !== 'string') throw new Error(`${at}: ${name} has no team`);
  if (typeof item.display_position !== 'string' || !item.display_position) throw new Error(`${at}: ${name} has no position`);
  const secondary = String(item.display_secondary_positions ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { uuid: item.uuid, name, team: item.team_short_name, teamName: item.team, position: item.display_position, secondary,
    overall: item.ovr, born: String(item.born ?? '').trim() };
}

const updates = (await readJson('roster-updates', `${API}/roster_updates.json`)).body.roster_updates;
if (!Array.isArray(updates) || !updates.length) throw new Error('The API lists no roster updates');
const latest = updates.reduce((best, update) => (update.id > best.id ? update : best));
const first = await readJson('items-1', itemsUrl(1));
const pages = first.body.total_pages;
if (!Number.isInteger(pages) || pages < 1) throw new Error('The items API gives no page count');
const cards = new Map(), teams = new Map();
let all = 0;
for (let batch = 1; batch <= pages; batch += parallel) {
  const numbers = Array.from({ length: Math.min(parallel, pages - batch + 1) }, (_, k) => batch + k);
  const read = await Promise.all(numbers.map(page => (page === 1 ? first : readJson(`items-${page}`, itemsUrl(page)))));
  // Pages are read in order, whatever order they arrived in.
  read.forEach((data, k) => {
    const page = numbers[k];
    if (data.body.total_pages !== pages) throw new Error(`Page ${page} counts ${data.body.total_pages} pages, page 1 ${pages}`);
    data.body.items.forEach((item, i) => {
      all++;
      const row = card(item, `page ${page} item ${i + 1}`);
      if (!row) return;
      if (cards.has(row.uuid)) throw new Error(`${row.name} (${row.uuid}) is listed twice`);
      cards.set(row.uuid, row);
      if (teams.has(row.team) && teams.get(row.team) !== row.teamName) throw new Error(`${row.team} is both ${teams.get(row.team)} and ${row.teamName}`);
      teams.set(row.team, row.teamName);
    });
    console.log(`page ${page}/${pages}: ${data.body.items.length} cards`);
  });
}

const snapshot = {
  note: `Every Live series card of ${EDITION} (the current roster of each MLB club) from the game's public API, as [uuid, name, team, position, secondary positions, overall, born]. "born" is a US state or a country. Read by scripts/build-mlb.mjs; refreshed by npm run sync:mlb-the-show.`,
  source: {
    name: `${EDITION} Live series`, edition: EDITION, season: SEASON, url: `${API}/items.json`, docs: `${API}/docs`,
    rosterUpdate: { id: latest.id, name: latest.name }, retrieved: first.retrieved, cards: cards.size, allCards: all,
  },
  teams: Object.fromEntries([...teams.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  players: [...cards.values()]
    .sort((a, b) => a.team.localeCompare(b.team) || b.overall - a.overall || a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid))
    .map(p => [p.uuid, p.name, p.team, p.position, p.secondary.join(','), p.overall, p.born]),
};
const body = `{\n${[
  `  "note": ${JSON.stringify(snapshot.note)}`,
  `  "source": ${JSON.stringify(snapshot.source)}`,
  `  "teams": ${JSON.stringify(snapshot.teams)}`,
  `  "players": [\n${snapshot.players.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`,
].join(',\n')}\n}\n`;
await writeFile(output, body);
console.log(`Wrote ${cards.size} Live cards of ${teams.size} teams (roster update ${latest.id}, ${latest.name}) to ${path.relative(root, output)}`);
