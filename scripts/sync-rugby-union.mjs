// Snapshot rugby union's built-in season, 2025/26, from RugbyPass's match centre (scripts/lib/rugbypass.mjs; the method in
// docs/design/rugby-union.md): every game of the Premiership, the Top 14, the United Rugby Championship, the Champions Cup
// and the Challenge Cup in 2023/24, 2024/25 and 2025/26, and every Test of those seasons, each with both team sheets,
// its scores and each player's stats. Each reply's part read is cached in the ignored data-src/rugby-union/ (fixtures/,
// games/), so a rerun reads the cache instead of the site; only the snapshot is committed.
//
// Usage: node scripts/sync-rugby-union.mjs [--fetch] [--refresh-fixtures]
//   --fetch             download whatever the cache lacks, then write the snapshot
//   --refresh-fixtures  read every competition's season lists and games again (finished games are never fetched again)
// Without --fetch the sync reads the cache alone and stops on anything missing.
// Output: scripts/data/rugby-union-2025-26.json (committed), read by scripts/build-rugby-union.mjs.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { politeFetch } from './lib/polite-fetch.mjs';
import { RUGBYPASS, fixturesOf, gameOf, seasonsOf } from './lib/rugbypass.mjs';
import { snapshotOf, snapshotText } from './lib/rugby-union.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/rugby-union');
const output = path.join(root, 'scripts/data/rugby-union-2025-26.json');
const args = new Set(process.argv.slice(2));
const FETCH = args.has('--fetch');
const REFRESH_FIXTURES = args.has('--refresh-fixtures');

/**
 * The competitions read, by RugbyPass's address: the clubs' leagues and European cups, and the Tests (the British and
 * Irish Lions' tour among them, whose Tests are representative games).
 */
export const COMPETITIONS = Object.freeze({
  club: ['premiership', 'top-14', 'united-rugby-championship', 'european-champions-cup', 'challenge-cup'],
  test: ['six-nations', 'autumn-nations-series', 'internationals', 'the-rugby-championship', 'nations-championship',
    'pacific-nations-cup', 'rugby-world-cup', 'rugby-europe-championship', 'british-irish-lions'],
});
/** The seasons read, each from 1 August to 31 July: the built-in season and the two before it (the window, 3:2:1). */
export const SEASONS = Object.freeze([
  { key: '2025/26', from: Date.UTC(2025, 7, 1), to: Date.UTC(2026, 7, 1) },
  { key: '2024/25', from: Date.UTC(2024, 7, 1), to: Date.UTC(2025, 7, 1) },
  { key: '2023/24', from: Date.UTC(2023, 7, 1), to: Date.UTC(2024, 7, 1) },
]);
const FIRST = Math.min(...SEASONS.map(season => season.from)), LAST = Math.max(...SEASONS.map(season => season.to));
const YEARS = new Set(Array.from({ length: new Date(LAST).getUTCFullYear() - new Date(FIRST).getUTCFullYear() + 1 },
  (_, i) => new Date(FIRST).getUTCFullYear() + i));
// One request at a time per worker, two workers, and a pause after each.
const WORKERS = 2, PAUSE_MS = 900;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (url, status) => appendFile(path.join(cacheDir, 'FETCH-LOG.tsv'), `${new Date().toISOString()}\t${status}\t${url}\n`);

async function cached(file, fetchIt, { refresh = false } = {}) {
  const at = path.join(cacheDir, file);
  if (existsSync(at) && !refresh) return JSON.parse(await readFile(at, 'utf8'));
  if (!FETCH) throw new Error(`${file} is not cached: run with --fetch`);
  const value = await fetchIt();
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, `${JSON.stringify(value)}\n`);
  return value;
}

async function request(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await politeFetch(url, init);
      await log(url, response.status);
      if (response.ok) {
        const text = await response.text();
        await sleep(PAUSE_MS);
        return text;
      }
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 || attempt >= 4) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status });
    } catch (error) {
      if (error.fatal || error.status === 404 || attempt >= 4) throw error;
      console.warn(`  ${url}: ${error.message}; again in ${attempt * 10} s`);
    }
    await sleep(attempt * 10_000);
  }
}

/** A competition's seasons that fall in the window, from its fixtures page. */
const seasonsIn = competition => cached(`fixtures/${competition}-seasons.json`, async () =>
  seasonsOf(await request(`${RUGBYPASS}/${competition}/fixtures-results/`)), { refresh: REFRESH_FIXTURES });

/** A competition season's games, from the fixtures app's season filter. */
function seasonGames(competition, season) {
  return cached(`fixtures/${competition}-${season}.json`, async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ action: 'filter-fixtures', season, team: 0, comp: 0, isContent: 1 })) form.set(key, String(value));
    return fixturesOf(JSON.parse(await request(`${RUGBYPASS}/${competition}/fixtures-results`, { method: 'POST', body: form })));
  }, { refresh: REFRESH_FIXTURES });
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const fixtures = [];
  for (const kind of Object.keys(COMPETITIONS)) {
    for (const competition of COMPETITIONS[kind]) {
      const seasons = (await seasonsIn(competition)).filter(season => season.years.some(year => YEARS.has(Number(year))));
      for (const { season } of seasons) {
        for (const game of await seasonGames(competition, season)) {
          const at = game.epoch * 1000;
          if (at >= FIRST && at < LAST) fixtures.push({ ...game, kind, competition, season });
        }
      }
      console.log(`${competition}: ${seasons.map(s => s.label).join(', ')}; ${fixtures.filter(f => f.competition === competition).length} games in the window`);
    }
  }
  // Played games only, each once (a game listed by two competitions keeps its first).
  const played = [...new Map(fixtures.filter(game => game.played && !game.canceled && !game.postponed).map(game => [game.id, game])).values()];
  const missing = played.filter(game => !existsSync(path.join(cacheDir, `games/${game.id}.json`)));
  console.log(`${played.length} games played, ${missing.length} to download`);
  if (missing.length && !FETCH) throw new Error(`${missing.length} games are not cached: run with --fetch`);
  let done = 0;
  const queue = missing.slice();
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    for (let game = queue.shift(); game; game = queue.shift()) {
      try {
        await cached(`games/${game.id}.json`, async () => gameOf(await request(game.url)));
      } catch (error) {
        console.warn(`  ${game.id} ${game.url}: ${error.message}`);
      }
      if (++done % 50 === 0) console.log(`  ${done} of ${missing.length}`);
    }
  }));
  const games = [];
  for (const fixture of played) {
    const at = path.join(cacheDir, `games/${fixture.id}.json`);
    if (existsSync(at)) games.push({ fixture, game: JSON.parse(await readFile(at, 'utf8')) });
  }
  // The days the cached replies were read, from the fetch log.
  const days = (await readFile(path.join(cacheDir, 'FETCH-LOG.tsv'), 'utf8')).split('\n').filter(Boolean).map(line => line.slice(0, 10)).sort();
  const source = {
    provider: 'RugbyPass', url: RUGBYPASS, retrieved: days.at(-1), read: [days[0], days.at(-1)],
    terms: 'robots.txt (read 2026-11-18) disallows none of the paths read and allows ClaudeBot and anthropic-ai by name; its llms.txt asks that results, fixtures and player statistics be attributed to RugbyPass, World Rugby\'s own site',
    competitions: COMPETITIONS, window: SEASONS.map(season => season.key),
  };
  const snapshot = snapshotOf({ seasons: SEASONS, competitions: COMPETITIONS, games, source });
  await writeFile(output, snapshotText(snapshot));
  console.log(`Wrote ${path.relative(root, output)}: ${snapshot.games.length} games, ${snapshot.players.length} players`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
