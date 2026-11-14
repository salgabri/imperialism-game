// The EuroLeague's public data API (api-live.euroleague.net, the data behind www.euroleaguebasketball.net), as the
// EuroLeague syncs read it (scripts/sync-euroleague.mjs, scripts/sync-euroleague-seasons.mjs): every response cached in
// the ignored data-src/euroleague/ as { url, fetchedAt, body }, so a rerun reads the cache instead of the API. Requests
// go through scripts/lib/polite-fetch.mjs (one generic User-Agent, robots.txt read first and obeyed;
// api-live.euroleague.net has none: HTTP 404, read 2026-11-10).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { politeFetch } from './polite-fetch.mjs';

export const API = 'https://api-live.euroleague.net';
export const POSITION_OF = Object.freeze({ Guard: 'G', Forward: 'F', Center: 'C' });
const PAUSE_MS = 400;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A reader of the API through the cache under `root`/data-src/euroleague: `fetched(file, url)` is the cached response
 * (downloaded first when `refresh` or when the file is missing), and `dates` the days its responses were fetched on.
 */
export async function apiCache(root, { refresh = false } = {}) {
  const cacheDir = path.join(root, 'data-src/euroleague');
  await mkdir(cacheDir, { recursive: true });
  const dates = new Set();
  async function fetched(file, url) {
    const at = path.join(cacheDir, file);
    if (!refresh && existsSync(at)) {
      const cached = JSON.parse(await readFile(at, 'utf8'));
      dates.add(cached.fetchedAt.slice(0, 10));
      return cached;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await politeFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const result = { url, fetchedAt: new Date().toISOString(), body };
        await writeFile(at, JSON.stringify(result));
        dates.add(result.fetchedAt.slice(0, 10));
        await sleep(PAUSE_MS);
        return result;
      } catch (error) {
        if (attempt === 2 || error.fatal) throw new Error(`${url}: ${error.message}`);
        await sleep(PAUSE_MS * 5);
      }
    }
    throw new Error('unreachable');
  }
  return { fetched, dates };
}

/** The API's addresses, by season code ('E2009'). */
export const urls = {
  clubs: season => `${API}/v2/competitions/E/seasons/${season}/clubs`,
  people: (season, club) => `${API}/v2/competitions/E/seasons/${season}/clubs/${club}/people`,
  // Per game, sorted by average: only the players EuroLeague's leaderboards qualify (a share of their club's games), as
  // the built-in season's snapshot reads them.
  players: season => `${API}/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=${season}&statisticMode=PerGame&limit=1000`,
  // Per game, sorted by total: every player with a game (343 in 2009/10, where the leaderboard qualifies 155).
  allPlayers: season => `${API}/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=${season}&statisticMode=PerGame&statisticSortMode=accumulated&limit=1000`,
  teams: season => `${API}/v3/competitions/E/statistics/teams/traditional?seasonMode=Single&seasonCode=${season}&statisticMode=Accumulated&limit=100`,
  games: season => `${API}/v2/competitions/E/seasons/${season}/games`,
};

/** Letters only, without accents or case: two spellings of one name compare equal. */
export function plain(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

const round = (value, digits = 1) => Number(Number(value).toFixed(digits));

/** A per-game statistics row as a line: [games, minutes, points, rebounds, assists, three-point attempts, PIR]. */
export const lineOf = row => [row.gamesPlayed, round(row.minutesPlayed), round(row.pointsScored), round(row.totalRebounds), round(row.assists),
  round(row.threePointersAttempted), round(row.pir)];

/**
 * A season's league figures from its team totals and games: pace and points per 100 possessions over every game the
 * clubs played, the average team's PIR a game, and the regular season's points, overtime, margins, home record and the
 * spread of its clubs' wins. `regular`: the regular season's played games.
 */
export function leagueFigures(season, teams, regular) {
  // Possessions: field-goal attempts + 0.44 free-throw attempts - offensive rebounds + turnovers, each side's, halved.
  const possessions = teams.reduce((sum, t) => sum + t.twoPointersAttempted + t.threePointersAttempted + 0.44 * t.freeThrowsAttempted
    - t.offensiveRebounds + t.turnovers, 0);
  const teamGames = teams.reduce((sum, t) => sum + t.gamesPlayed, 0);
  const points = teams.reduce((sum, t) => sum + t.pointsScored, 0);
  const scores = regular.flatMap(game => [game.local.score, game.road.score]);
  const margins = regular.map(game => Math.abs(game.local.score - game.road.score));
  // That season's own clubs, a club that won nothing included.
  const wins = new Map(regular.flatMap(game => [[game.local.club.code, 0], [game.road.club.code, 0]]));
  for (const game of regular) {
    const winner = game.local.score > game.road.score ? game.local.club.code : game.road.club.code;
    wins.set(winner, wins.get(winner) + 1);
  }
  const share = (list, test) => round(list.filter(test).length / list.length, 3);
  return {
    season,
    // Every game the clubs played, playoffs included, for the rate a possession scores at.
    pace: round(possessions / teamGames), rating: round(100 * points / possessions),
    // The regular season's games.
    games: regular.length, points: round(scores.reduce((sum, p) => sum + p, 0) / scores.length),
    overtime: share(regular, game => Object.keys(game.local.partials?.extraPeriods ?? {}).length > 0),
    margin: round(margins.reduce((sum, m) => sum + m, 0) / margins.length), close: share(margins, m => m <= 3), blowouts: share(margins, m => m >= 20),
    homeWins: share(regular, game => game.local.score > game.road.score),
    clubs: wins.size, bestWins: Math.max(...wins.values()), worstWins: Math.min(...wins.values()),
  };
}
