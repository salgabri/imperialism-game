// Snapshot the EuroLeague: the season's clubs and their rosters, and every player's per-game statistics for the season
// under way and the two before it, from the EuroLeague's public API (api-live.euroleague.net, the data behind
// www.euroleaguebasketball.net). The responses are cached in the ignored data-src/euroleague/, so a rerun reads them
// instead of the API; only the snapshot is committed. Requests go through scripts/lib/polite-fetch.mjs (one generic
// User-Agent, robots.txt read first and obeyed; api-live.euroleague.net has none: HTTP 404, read 2026-11-10), by way
// of scripts/lib/euroleague-api.mjs. The earlier seasons have their own sync, scripts/sync-euroleague-seasons.mjs.
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
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { API, POSITION_OF, apiCache, leagueFigures, lineOf, plain, urls } from './lib/euroleague-api.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'scripts/data/euroleague-2026-27.json');
// The season under way, then the two before it: a player's form, and a line for one hurt all last season.
const SEASON = 'E2026';
const SEASONS = ['E2024', 'E2025', 'E2026'];
// The last full season, whose games and team totals give the league's pace, scoring and home record.
const LAST_FULL = 'E2025';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const { fetched, dates } = await apiCache(root, { refresh: args.includes('--refresh') });

// ---------- the clubs and their rosters ----------

const clubsResponse = await fetched(`clubs-${SEASON}.json`, urls.clubs(SEASON));
const clubs = clubsResponse.body.data.map(club => ({ code: club.code, name: club.name, country: club.country.code, city: club.city, tv: club.tvCode }))
  .sort((a, b) => a.code.localeCompare(b.code));
if (clubs.length < 18) throw new Error(`EuroLeague ${SEASON} lists ${clubs.length} clubs`);

const players = new Map();
for (const club of clubs) {
  const response = await fetched(`people-${SEASON}-${club.code}.json`, urls.people(SEASON, club.code));
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

// ---------- the players' statistics ----------

for (const [s, season] of SEASONS.entries()) {
  const response = await fetched(`players-${season}.json`, urls.players(season));
  const { players: rows, total } = response.body;
  if (rows.length !== total) throw new Error(`${season}: ${rows.length} of ${total} players' statistics`);
  for (const row of rows) {
    const player = players.get(row.player.code);
    if (!player || !row.gamesPlayed) continue;
    player.lines[s] = lineOf(row);
  }
}

// ---------- the last full season: pace, scoring and home record ----------

const teams = (await fetched(`teams-${LAST_FULL}.json`, urls.teams(LAST_FULL))).body.teams;
const games = (await fetched(`games-${LAST_FULL}.json`, urls.games(LAST_FULL))).body.data
  .filter(game => game.played && game.phaseType.code === 'RS');
const league = leagueFigures(LAST_FULL, teams, games);

// ---------- the snapshot ----------

if (dates.size !== 1) console.warn(`  warning: the responses were fetched on ${[...dates].join(', ')}`);
const retrieved = [...dates].sort().at(-1);
const source = {
  name: 'EuroLeague', season: SEASON, label: 'EuroLeague 2026-27', retrieved, api: API,
  clubs: urls.clubs(SEASON), rosters: `${API}/v2/competitions/E/seasons/${SEASON}/clubs/{club}/people`,
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
