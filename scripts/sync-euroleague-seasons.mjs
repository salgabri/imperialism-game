// Snapshot the EuroLeague's earlier seasons, 2000/01 (its first, E2000) to 2025/26 (E2025), the seasons before the
// built-in one (scripts/sync-euroleague.mjs): each season's clubs, every player who played in it with his per-game box
// score, the club he counts for, and the league's figures, from the EuroLeague's public API (api-live.euroleague.net).
// The API holds nothing before 2000/01 (its E1999 lists no club, and its statistics answer HTTP 404). Responses are
// cached in the ignored data-src/euroleague/ (scripts/lib/euroleague-api.mjs, through polite-fetch); only the snapshots
// are committed.
//
// Usage: node scripts/sync-euroleague-seasons.mjs [--refresh]
//   --refresh  download everything again
// Output: scripts/data/euroleague-seasons/E<year>.json (committed), read by scripts/lib/euroleague-seasons.mjs.
//
// A season's players are every player with a game in its statistics, read sorted by totals (`urls.allPlayers`): sorted
// by averages, EuroLeague lists only the players its leaderboards qualify, 155 of 343 in 2009/10, and a club knocked out
// early would have had nobody. Each season's league figures add the average team's PIR, assists, rebounds and
// three-point attempts a game, the level its box scores are read at. A player with no position on any roster has null
// (scripts/lib/euroleague-seasons.mjs places him by his box score). A player row is [EuroLeague code, name, club,
// position, height (cm), nationality, line, extra?]: the line his per-game box score that season, [games, minutes,
// points, rebounds, assists, three-point attempts, PIR], as EuroLeague counts it. A player who played for two clubs that
// season (EuroLeague lists him as "TEL;PAN") counts once, for the club he played the most minutes for, then the most
// games, then the one EuroLeague lists first, as an NBA season's traded players do: his own season page splits his
// games and minutes by club (`extra.clubs`: { club: [games, minutes] }). His position is the one his club's roster gives
// him that season (else another roster's, the nearest season first); height and nationality are his person record's.
// `extra.alias` and `extra.abbr` are EuroLeague's accented spelling and own mixed-case surname, as in the built-in season.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { API, POSITION_OF, apiCache, leagueFigures, lineOf, plain, urls } from './lib/euroleague-api.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'scripts/data/euroleague-seasons');
const FIRST_SEASON = 2000;
const LAST_SEASON = 2025;

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
const seasonsOf = () => Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);

// ---------- every season's responses ----------

const api = await apiCache(root, { refresh });
const seasons = new Map();
for (const year of seasonsOf()) {
  const code = `E${year}`;
  const before = new Set(api.dates);
  api.dates.clear();
  const clubs = (await api.fetched(`clubs-${code}.json`, urls.clubs(code))).body.data;
  if (clubs.length < 16) throw new Error(`EuroLeague ${code} lists ${clubs.length} clubs`);
  const people = new Map();
  for (const club of clubs) people.set(club.code, (await api.fetched(`people-${code}-${club.code}.json`, urls.people(code, club.code))).body);
  const stats = (await api.fetched(`players-all-${code}.json`, urls.allPlayers(code))).body;
  if (stats.players.length !== stats.total) throw new Error(`${code}: ${stats.players.length} of ${stats.total} players' statistics`);
  const teams = (await api.fetched(`teams-${code}.json`, urls.teams(code))).body.teams;
  const games = (await api.fetched(`games-${code}.json`, urls.games(code))).body.data.filter(game => game.played);
  seasons.set(year, { code, clubs, people, stats: stats.players, teams, games, dates: new Set(api.dates) });
  for (const date of before) api.dates.add(date);
}

// Every roster place of every person, by season: his position, club and dates.
const rosterOf = new Map();
const personOf = new Map();
for (const [year, season] of seasons) {
  for (const [club, rows] of season.people) {
    for (const row of rows) {
      if (row.type !== 'J') continue;
      const code = row.person.code;
      if (!rosterOf.has(code)) rosterOf.set(code, []);
      rosterOf.get(code).push({ year, club, position: POSITION_OF[row.positionName] ?? null });
      const known = personOf.get(code);
      // The same person record on every roster; the tallest height any of them gives.
      if (!known || (row.person.height || 0) > (known.height || 0)) personOf.set(code, row.person);
    }
  }
}

/** A player's position in a season: his club's roster's, else another roster's that season, else the nearest season's. */
function positionOf(code, year, club) {
  const places = (rosterOf.get(code) ?? []).filter(place => place.position);
  const pick = places.find(place => place.year === year && place.club === club)
    ?? places.find(place => place.year === year)
    ?? places.slice().sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) || a.year - b.year)[0];
  return pick?.position ?? null;
}

// ---------- the players who played for two clubs ----------

/** A mover's games and minutes for each club in season `year`, from his own season page: { club code: [games, minutes] }. */
async function splitOf(player, year, listed) {
  const season = seasons.get(year);
  const response = await api.fetched(`person-${player.code}.json`, `${API}/v2/people/${player.code}/stats`);
  season.dates.add(response.fetchedAt.slice(0, 10));
  const rows = response.body.find(competition => competition.competitionCode === 'E')?.seasons.filter(row => row.seasonCode === season.code) ?? [];
  // The page names a club by its broadcast code that season (Maccabi's MTA), or by its club code.
  const clubOf = team => listed.find(code => code === team || season.clubs.find(club => club.code === code)?.tvCode === team);
  const split = {};
  for (const row of rows) {
    const club = clubOf(row.teamCode);
    if (!club) continue;
    const [games, minutes] = split[club] ?? [0, 0];
    split[club] = [games + row.stats.gamesPlayed, round(minutes + row.stats.timePlayed / 60, 0)];
  }
  // One club the page names by another code: the listed club left over.
  const unmatched = rows.filter(row => !clubOf(row.teamCode));
  const left = listed.filter(code => !split[code]);
  if (unmatched.length === 1 && left.length === 1) split[left[0]] = [unmatched[0].stats.gamesPlayed, round(unmatched[0].stats.timePlayed / 60, 0)];
  return split;
}

// ---------- the snapshots ----------

await mkdir(outDir, { recursive: true });
const report = [];
for (const [year, season] of seasons) {
  const clubCodes = new Set(season.clubs.map(club => club.code));
  // Each club's wins and games: in every game it played that season, and in the regular season alone.
  const records = new Map(season.clubs.map(club => [club.code, { all: [0, 0], regular: [0, 0] }]));
  for (const game of season.games) {
    for (const side of [game.local, game.road]) {
      if (!records.has(side.club.code)) continue;
      const won = side.score > (side === game.local ? game.road : game.local).score ? 1 : 0;
      for (const record of game.phaseType.code === 'RS' ? [records.get(side.club.code).all, records.get(side.club.code).regular] : [records.get(side.club.code).all]) {
        record[0] += won;
        record[1]++;
      }
    }
  }
  const players = [];
  const warnings = [];
  for (const row of season.stats) {
    if (!row.gamesPlayed) continue;
    const listed = row.player.team.code.split(';').filter(Boolean);
    const unknownClubs = listed.filter(code => !clubCodes.has(code));
    if (unknownClubs.length) throw new Error(`${season.code}: ${row.player.name} played for ${unknownClubs.join(', ')}, not in the season`);
    let club = listed[0];
    let clubs = null;
    if (listed.length > 1) {
      // A club his page has no line for is one he was listed by but played no game for.
      clubs = await splitOf(row.player, year, listed);
      if (!Object.keys(clubs).length) warnings.push(`${row.player.name}: his season page splits none of ${listed.join(', ')}; he counts for ${listed[0]}`);
      club =listed.slice().sort((a, b) => (clubs[b]?.[1] ?? -1) - (clubs[a]?.[1] ?? -1) || (clubs[b]?.[0] ?? -1) - (clubs[a]?.[0] ?? -1)
        || listed.indexOf(a) - listed.indexOf(b))[0];
    }
    const person = personOf.get(row.player.code);
    const name = person?.name ?? row.player.name;
    // null for the few no roster lists: scripts/lib/euroleague-seasons.mjs places them by their box score.
    const position = positionOf(row.player.code, year, club);
    const alias = person?.alias && person.alias !== name && plain(person.alias) === plain(name) ? person.alias : null;
    const abbr = person?.abbreviatedName?.trim() || null;
    const extra = { ...(alias ? { alias } : {}), ...(abbr ? { abbr } : {}), ...(clubs ? { clubs } : {}) };
    players.push([row.player.code, name, club, position, person?.height || null, person?.country?.code ?? null, lineOf(row),
      ...(Object.keys(extra).length ? [extra] : [])]);
  }
  players.sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const regular = season.games.filter(game => game.phaseType.code === 'RS');
  // The average team's PIR, assists, rebounds and three-point attempts a game: the level a season's box scores are read at.
  const teamGames = season.teams.reduce((sum, t) => sum + t.gamesPlayed, 0);
  const perTeamGame = key => round(season.teams.reduce((sum, t) => sum + t[key], 0) / teamGames);
  const league = { ...leagueFigures(season.code, season.teams, regular), pir: perTeamGame('pir'), ast: perTeamGame('assists'),
    reb: perTeamGame('totalRebounds'), tpa: perTeamGame('threePointersAttempted') };
  const clubs = season.clubs.map(club => ({ code: club.code, name: club.name, country: club.country.code, city: club.city, tv: club.tvCode,
    wins: records.get(club.code).all[0], games: records.get(club.code).all[1], regular: records.get(club.code).regular }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const retrieved = [...season.dates].sort().at(-1);
  const label = `EuroLeague ${year}-${String(year + 1).slice(2)}`;
  const source = {
    name: 'EuroLeague', season: season.code, label, retrieved, api: API, clubs: urls.clubs(season.code),
    rosters: `${API}/v2/competitions/E/seasons/${season.code}/clubs/{club}/people`, stats: urls.allPlayers(season.code), split: `${API}/v2/people/{player}/stats`,
    terms: "EuroLeague's public data API, as its own site reads it; the rosters and box-score statistics are facts, the ratings the game's own estimate",
  };
  const text = `{\n"source": ${JSON.stringify(source)},\n"league": ${JSON.stringify(league)},\n"clubs": [\n${clubs.map(club => JSON.stringify(club)).join(',\n')}\n],\n"players": [\n${players.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
  await writeFile(path.join(outDir, `${season.code}.json`), text);
  const movers = players.filter(row => row[7]?.clubs).length, unlisted = players.filter(row => !row[3]).length;
  report.push(`${label}: ${clubs.length} clubs, ${players.length} players (${movers} for two clubs, ${unlisted} on no roster), ${regular.length} regular-season games; `
    + `pace ${league.pace}, ${league.points} points a team, team PIR ${league.pir}, home sides won ${league.homeWins}`);
  for (const warning of warnings) report.push(`  warning: ${warning}`);
}
console.log(report.join('\n'));
console.log(`-> ${path.relative(root, outDir)}/E${FIRST_SEASON}.json … E${LAST_SEASON}.json`);
