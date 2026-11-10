// Snapshot the EuroLeague: the season's clubs and their rosters, and every player's per-game statistics for the season
// under way and the two before it, from the EuroLeague's public API (api-live.euroleague.net, the data behind
// www.euroleaguebasketball.net). The responses are cached in the ignored data-src/euroleague/, so a rerun reads them
// instead of the API; only the snapshot is committed.
//
// Usage: node scripts/sync-euroleague.mjs [--refresh]
//   --refresh  download everything again: a new snapshot, dated the day it is fetched
// Output: scripts/data/euroleague-2026-27.json (committed), read by scripts/build-euroleague.mjs.
//
// No source rates EuroLeague players (NBA 2K has carried no EuroLeague teams since 2K17), so the game estimates each
// rating from these statistics (scripts/lib/euroleague.mjs, docs/design/euroleague.md).
//
// A player row is [EuroLeague code, name, club, position, height (cm), nationality, then per-game lines for each of
// `source.seasons`, each [games, minutes, points, rebounds, assists, three-point attempts, PIR] or null]. The name is
// EuroLeague's own, "SURNAME, FIRST NAME" in capitals; `alias` carries its accented spelling where EuroLeague has one,
// and `abbr` its own mixed-case surname ("Miller-McIntyre, C.").
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/euroleague');
const output = path.join(root, 'scripts/data/euroleague-2026-27.json');
const API = 'https://api-live.euroleague.net';
// The season under way, then the two before it: a player's form, and a line for one hurt all last season.
const SEASON = 'E2026';
const SEASONS = ['E2024', 'E2025', 'E2026'];
// The last full season, whose games and team totals give the league's pace, scoring and home record.
const LAST_FULL = 'E2025';
const PAUSE_MS = 400;
const POSITION_OF = { Guard: 'G', Forward: 'F', Center: 'C' };

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One JSON response, from the cache unless `refresh`. */
async function fetched(file, url) {
  const at = path.join(cacheDir, file);
  if (!refresh && existsSync(at)) return JSON.parse(await readFile(at, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game data sync', accept: 'application/json' },
        signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const result = { url, fetchedAt: new Date().toISOString(), body };
      await writeFile(at, JSON.stringify(result));
      await sleep(PAUSE_MS);
      return result;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * 5);
    }
  }
}

await mkdir(cacheDir, { recursive: true });
const dates = new Set();
const note = ({ fetchedAt }) => dates.add(fetchedAt.slice(0, 10));

// ---------- the clubs and their rosters ----------

const clubsResponse = await fetched(`clubs-${SEASON}.json`, `${API}/v2/competitions/E/seasons/${SEASON}/clubs`);
note(clubsResponse);
const clubs = clubsResponse.body.data.map(club => ({ code: club.code, name: club.name, country: club.country.code, city: club.city, tv: club.tvCode }))
  .sort((a, b) => a.code.localeCompare(b.code));
if (clubs.length < 18) throw new Error(`EuroLeague ${SEASON} lists ${clubs.length} clubs`);

const players = new Map();
for (const club of clubs) {
  const response = await fetched(`people-${SEASON}-${club.code}.json`, `${API}/v2/competitions/E/seasons/${SEASON}/clubs/${club.code}/people`);
  note(response);
  for (const row of response.body) {
    if (row.type !== 'J' || !row.active) continue;
    const position = POSITION_OF[row.positionName];
    if (!position) throw new Error(`${row.person.name} (${club.code}) has position ${JSON.stringify(row.positionName)}`);
    if (players.has(row.person.code)) throw new Error(`${row.person.name} is on two rosters: ${players.get(row.person.code).club} and ${club.code}`);
    const { name, alias, abbreviatedName } = row.person;
    players.set(row.person.code, {
      code: row.person.code, name, club: club.code, position, height: row.person.height || null,
      nationality: row.person.country?.code ?? null,
      // EuroLeague's accented spelling of the same name ("KUTLUAY, ÖMER"); an alias that is another name (a player's
      // old surname) is not his name.
      alias: alias && alias !== name && plain(alias) === plain(name) ? alias : null,
      abbr: abbreviatedName?.trim() || null,
      lines: SEASONS.map(() => null),
    });
  }
}

function plain(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

// ---------- the players' statistics ----------

const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
for (const [s, season] of SEASONS.entries()) {
  const response = await fetched(`players-${season}.json`,
    `${API}/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=${season}&statisticMode=PerGame&limit=1000`);
  note(response);
  const { players: rows, total } = response.body;
  if (rows.length !== total) throw new Error(`${season}: ${rows.length} of ${total} players' statistics`);
  for (const row of rows) {
    const player = players.get(row.player.code);
    if (!player || !row.gamesPlayed) continue;
    player.lines[s] = [row.gamesPlayed, round(row.minutesPlayed), round(row.pointsScored), round(row.totalRebounds), round(row.assists),
      round(row.threePointersAttempted), round(row.pir)];
  }
}

// ---------- the last full season: pace, scoring and home record ----------

const teams = (await fetched(`teams-${LAST_FULL}.json`,
  `${API}/v3/competitions/E/statistics/teams/traditional?seasonMode=Single&seasonCode=${LAST_FULL}&statisticMode=Accumulated&limit=100`)).body.teams;
const games = (await fetched(`games-${LAST_FULL}.json`, `${API}/v2/competitions/E/seasons/${LAST_FULL}/games`)).body.data
  .filter(game => game.played && game.phaseType.code === 'RS');
// Possessions: field-goal attempts + 0.44 free-throw attempts - offensive rebounds + turnovers, each side's, halved.
const possessions = teams.reduce((sum, t) => sum + t.twoPointersAttempted + t.threePointersAttempted + 0.44 * t.freeThrowsAttempted
  - t.offensiveRebounds + t.turnovers, 0);
const teamGames = teams.reduce((sum, t) => sum + t.gamesPlayed, 0);
const points = teams.reduce((sum, t) => sum + t.pointsScored, 0);
const scores = games.flatMap(game => [game.local.score, game.road.score]);
const margins = games.map(game => Math.abs(game.local.score - game.road.score));
// That season's own clubs, a club that won nothing included.
const wins = new Map(games.flatMap(game => [[game.local.club.code, 0], [game.road.club.code, 0]]));
for (const game of games) {
  const winner = game.local.score > game.road.score ? game.local.club.code : game.road.club.code;
  wins.set(winner, wins.get(winner) + 1);
}
const share = (list, test) => round(list.filter(test).length / list.length, 3);
const league = {
  season: LAST_FULL,
  // Every game the clubs played, playoffs included, for the rate a possession scores at.
  pace: round(possessions / teamGames), rating: round(100 * points / possessions),
  // The regular season's games.
  games: games.length, points: round(scores.reduce((sum, p) => sum + p, 0) / scores.length),
  overtime: share(games, game => Object.keys(game.local.partials?.extraPeriods ?? {}).length > 0),
  margin: round(margins.reduce((sum, m) => sum + m, 0) / margins.length), close: share(margins, m => m <= 3), blowouts: share(margins, m => m >= 20),
  homeWins: share(games, game => game.local.score > game.road.score),
  clubs: wins.size, bestWins: Math.max(...wins.values()), worstWins: Math.min(...wins.values()),
};

// ---------- the snapshot ----------

if (dates.size !== 1) console.warn(`  warning: the responses were fetched on ${[...dates].join(', ')}`);
const retrieved = [...dates].sort().at(-1);
const source = {
  name: 'EuroLeague', season: SEASON, label: 'EuroLeague 2026-27', retrieved, api: API,
  clubs: `${API}/v2/competitions/E/seasons/${SEASON}/clubs`, rosters: `${API}/v2/competitions/E/seasons/${SEASON}/clubs/{club}/people`,
  stats: `${API}/v3/competitions/E/statistics/players/traditional?seasonCode={season}&statisticMode=PerGame`, seasons: SEASONS,
  terms: "EuroLeague's public data API, as its own site reads it; the rosters and box-score statistics are facts, the ratings the game's own estimate",
};
const rows = [...players.values()]
  .sort((a, b) => a.club.localeCompare(b.club) || a.name.localeCompare(b.name))
  .map(p => [p.code, p.name, p.club, p.position, p.height, p.nationality, ...p.lines,
    ...(p.alias || p.abbr ? [{ ...(p.alias ? { alias: p.alias } : {}), ...(p.abbr ? { abbr: p.abbr } : {}) }] : [])]);
const text = `{\n"source": ${JSON.stringify(source)},\n"league": ${JSON.stringify(league)},\n"clubs": [\n${clubs.map(club => JSON.stringify(club)).join(',\n')}\n],\n"players": [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
await writeFile(output, text);
const rated = [...players.values()].filter(p => p.lines.some(Boolean)).length;
console.log(`EuroLeague ${SEASON}: ${clubs.length} clubs, ${players.size} players (${rated} with EuroLeague games since ${SEASONS[0]}), ${retrieved} -> ${path.relative(root, output)}`);
console.log(`  ${LAST_FULL}: ${league.points} points a team, pace ${league.pace}, ${league.rating} points per 100, home sides won ${league.homeWins}`);
