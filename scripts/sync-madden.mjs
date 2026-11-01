// Snapshot one weekly update of EA SPORTS Madden NFL ratings: every player's name, team, position and overall, as
// EA's ratings site lists them. The site renders each page of 100 players on the server and embeds them in the page as
// JSON (Next.js `__NEXT_DATA__`); this reads that JSON as data, never running the page's scripts. The public ratings
// API (drop-api.ea.com) still serves the previous edition without teams, so the pages are the only source of the
// current one.
//
// Usage: node scripts/sync-madden.mjs [--iteration=madden-ratings-week-7] [--refresh]
//   --iteration  the ratings update to read (the site's Week filter); the default is the one the game ships
//   --refresh    download the pages again instead of reading data-src/madden/<iteration>/
// Output: scripts/data/madden-nfl-27.json (committed), read by scripts/build-nfl.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAME = 'madden-nfl-27';
const EDITION = 'Madden NFL 27';
const SEASON = '2026';
const DEFAULT_ITERATION = 'madden-ratings-week-7';
const PAGE_URL = 'https://www.ea.com/games/madden-nfl/ratings';
const PAGE_SIZE = 100;
const PAUSE_MS = 1500;
const output = path.join(root, `scripts/data/${GAME}.json`);

const args = process.argv.slice(2);
const arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const iteration = arg('iteration') || DEFAULT_ITERATION;
const refresh = args.includes('--refresh');
const cacheDir = path.join(root, 'data-src/madden', iteration);

const pageUrl = page => `${PAGE_URL}?iteration=${encodeURIComponent(iteration)}&page=${page}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The page's embedded Next.js data, parsed as JSON. */
function nextData(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('The ratings page has no __NEXT_DATA__ block');
  return JSON.parse(match[1]);
}

/** One page's players and the page's own description of the game and update, from the cache or the site. */
async function readPage(page) {
  const file = path.join(cacheDir, `page-${page}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(pageUrl(page), { headers: { 'user-agent': 'Mozilla/5.0 (imperialism-game roster sync)' },
        signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const props = nextData(await response.text()).props?.pageProps;
      const details = props?.ratingDetails;
      if (!details || !Array.isArray(details.items) || !Number.isInteger(details.totalItems)) throw new Error('no ratings on the page');
      const data = {
        url: pageUrl(page), retrieved: new Date().toISOString().slice(0, 10), game: props.themeSlug, totalItems: details.totalItems,
        iterations: (props.ratingsFilters?.iterations || []).map(({ id, label }) => ({ id, label })),
        items: details.items,
      };
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(data));
      await sleep(PAUSE_MS);
      return data;
    } catch (error) {
      if (attempt === 2) throw new Error(`${pageUrl(page)}: ${error.message}`);
      await sleep(PAUSE_MS * (attempt + 2));
    }
  }
}

function player(item, at) {
  const name = [item.firstName, item.lastName].map(part => String(part ?? '').trim()).filter(Boolean).join(' ');
  if (!Number.isInteger(item.id) || !name) throw new Error(`${at}: a player without an id or a name`);
  if (item.iteration?.id !== iteration) throw new Error(`${at}: ${name} is from the update ${item.iteration?.id}, not ${iteration}`);
  if (!Number.isInteger(item.team?.id) || typeof item.team.label !== 'string') throw new Error(`${at}: ${name} has no team`);
  if (typeof item.position?.id !== 'string') throw new Error(`${at}: ${name} has no position`);
  if (!Number.isInteger(item.overallRating) || item.overallRating < 1 || item.overallRating > 99) throw new Error(`${at}: ${name} has no overall`);
  return { id: item.id, name, team: item.team, position: item.position.id, overall: item.overallRating,
    jersey: Number.isInteger(item.jerseyNum) ? item.jerseyNum : null };
}

const first = await readPage(1);
if (first.game !== GAME) throw new Error(`The ratings site shows ${first.game}, not ${GAME}`);
const update = first.iterations.find(item => item.id === iteration);
if (!update) throw new Error(`The ratings site has no update ${iteration}: ${first.iterations.map(item => item.id).join(', ')}`);
const pages = Math.ceil(first.totalItems / PAGE_SIZE);
const players = new Map(), teams = new Map();
for (let page = 1; page <= pages; page++) {
  const data = page === 1 ? first : await readPage(page);
  if (data.totalItems !== first.totalItems) throw new Error(`Page ${page} counts ${data.totalItems} players, page 1 ${first.totalItems}`);
  data.items.forEach((item, i) => {
    const row = player(item, `page ${page} row ${i + 1}`);
    players.set(row.id, row);
    teams.set(row.team.id, row.team.label);
  });
  console.log(`page ${page}/${pages}: ${data.items.length} players`);
}
if (players.size !== first.totalItems) throw new Error(`Read ${players.size} distinct players of ${first.totalItems}`);
if (teams.size !== 32) throw new Error(`Expected the 32 NFL teams, found ${teams.size}`);

const snapshot = {
  note: `Every player of ${EDITION}'s ${update.label.toLowerCase()} (${iteration}) on EA SPORTS' ratings site, as [EA id, name, team id, Madden position, overall, jersey number]. Read by scripts/build-nfl.mjs; refreshed by npm run sync:madden.`,
  source: {
    name: `EA SPORTS ${EDITION} ratings`, edition: EDITION, season: SEASON, url: PAGE_URL,
    iteration: { id: iteration, label: update.label }, retrieved: first.retrieved, players: players.size,
  },
  teams: Object.fromEntries([...teams.entries()].sort((a, b) => a[1].localeCompare(b[1]))),
  players: [...players.values()]
    .sort((a, b) => a.team.label.localeCompare(b.team.label) || b.overall - a.overall || a.name.localeCompare(b.name))
    .map(p => [p.id, p.name, p.team.id, p.position, p.overall, p.jersey]),
};
const body = `{\n${[
  `  "note": ${JSON.stringify(snapshot.note)}`,
  `  "source": ${JSON.stringify(snapshot.source)}`,
  `  "teams": ${JSON.stringify(snapshot.teams)}`,
  `  "players": [\n${snapshot.players.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`,
].join(',\n')}\n}\n`;
await writeFile(output, body);
console.log(`Wrote ${players.size} players of ${teams.size} teams (${update.label}) to ${path.relative(root, output)}`);
