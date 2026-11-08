// Snapshot ice hockey's players: EA SPORTS NHL 27's ratings from EA's public ratings API (drop-api.ea.com, the data behind
// www.ea.com/games/nhl/ratings, which lists only the game's top 300) and every club's current roster and the players'
// statistics from the NHL's public API (api-web.nhle.com). The responses are cached in the ignored data-src/nhl/, so a
// rerun reads them instead of the APIs; only the snapshot is committed.
//
// Usage: node scripts/sync-nhl.mjs [--refresh]
//   --refresh  download everything again: a new snapshot, dated the day it is fetched
// Output: scripts/data/nhl-27.json (committed), read by scripts/build-hockey.mjs.
//
// A snapshot row is [NHL id, name, team, position, birth country, EA nationality, EA overall, games, seconds on ice,
// points, shots faced, saves], the EA fields null for a player EA does not list and the last four the regular-season
// totals of `source.seasons`. A player EA rates whom no club's roster lists (hurt, say) keeps EA's team and has no NHL
// id, birth country or statistics.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/nhl');
const output = path.join(root, 'scripts/data/nhl-27.json');
const EA = 'https://drop-api.ea.com/rating/nhl';
// Without this header the CDN can still serve the previous edition.
const EA_HEADERS = { 'drop-referrer': 'https://www.ea.com/games/nhl/ratings/' };
const NHL = 'https://api-web.nhle.com/v1';
// The last full season and the one under way, so a player's form counts and a rookie has a line.
const SEASONS = [20252026, 20262027];
const LIMIT = 100, PAUSE_MS = 400;
const POSITION_OF = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };
const EA_POSITION_OF = { Center: 'C', 'Left Wing': 'LW', 'Right Wing': 'RW', 'Left Defense': 'D', 'Right Defense': 'D', Defense: 'D', Goalie: 'G' };

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One JSON response, from the cache unless `refresh`. */
async function fetched(file, url, headers = {}) {
  const at = path.join(cacheDir, file);
  if (!refresh && existsSync(at)) return JSON.parse(await readFile(at, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game data sync', ...headers }, signal: AbortSignal.timeout(30000) });
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

// Letters NFD does not decompose (Ø, ł…) fold by hand; EA and the NHL spell some names with and some without them.
const FOLD = { ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };
const norm = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[øđðłıßæœþ]/g, c => FOLD[c])
  .replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

await mkdir(cacheDir, { recursive: true });
const teams = JSON.parse(await readFile(path.join(root, 'scripts/data/nhl-teams.json'), 'utf8')).teams;
const codes = Object.values(teams).map(team => team.code);

// ---------- EA's ratings ----------

const rated = [];
let total = Infinity, dates = new Set();
for (let offset = 0; offset < total; offset += LIMIT) {
  const { body, fetchedAt } = await fetched(`ea-${offset / LIMIT}.json`, `${EA}?locale=en&limit=${LIMIT}&offset=${offset}`, EA_HEADERS);
  total = body.totalItems;
  rated.push(...body.items);
  dates.add(fetchedAt.slice(0, 10));
}
if (rated.length !== total || new Set(rated.map(item => item.id)).size !== total) throw new Error(`Expected ${total} EA players; got ${rated.length}`);
const edition = rated[0].avatarUrl?.match(/\/NHL(\d+)\//)?.[1];
if (edition !== '27') throw new Error(`EA's ratings are NHL ${edition}'s, not NHL 27's: update this script and the snapshot's name`);

// ---------- the NHL's rosters and statistics ----------

const players = new Map();
for (const code of codes) {
  const { body, fetchedAt } = await fetched(`roster-${code}.json`, `${NHL}/roster/${code}/current`);
  dates.add(fetchedAt.slice(0, 10));
  for (const row of [...body.forwards, ...body.defensemen, ...body.goalies]) {
    if (!POSITION_OF[row.positionCode]) throw new Error(`Unknown NHL position ${row.positionCode} (${row.id})`);
    players.set(row.id, { id: row.id, name: `${row.firstName.default} ${row.lastName.default}`, last: row.lastName.default, team: code,
      pos: POSITION_OF[row.positionCode], born: row.birthCountry, games: 0, seconds: 0, points: 0, shots: 0, saves: 0, overall: null, nation: null });
  }
}
for (const code of codes) {
  for (const season of SEASONS) {
    const { body } = await fetched(`stats-${code}-${season}.json`, `${NHL}/club-stats/${code}/${season}/2`);
    for (const row of body.skaters || []) {
      const player = players.get(row.playerId);
      if (!player) continue;
      player.games += row.gamesPlayed;
      player.seconds += Math.round(row.avgTimeOnIcePerGame * row.gamesPlayed);
      player.points += row.points;
    }
    for (const row of body.goalies || []) {
      const player = players.get(row.playerId);
      if (!player) continue;
      player.games += row.gamesPlayed;
      player.seconds += row.timeOnIce;
      player.shots += row.shotsAgainst;
      player.saves += row.saves;
    }
  }
}

// ---------- joining the two ----------

// EA and the NHL spell some names differently (Alex and Alexander, Mitch and Mitchell): by full name, then by surname
// on the same team, then by a surname nobody else in the league has with the same first letter. Two players can share a
// name (the Canucks have two Elias Petterssons, a centre and a defender; there are two Sebastian Ahos): then by team and
// by whether each is a forward, a defender or a goalie.
const roster = [...players.values()];
const groupOf = pos => (pos === 'G' || pos === 'D' ? pos : 'F');
const byFullName = (name, team, pos) => {
  const named = roster.filter(player => norm(player.name) === norm(name));
  if (named.length < 2) return named[0];
  return named.find(p => p.team === team && groupOf(p.pos) === groupOf(pos)) ?? named.find(p => groupOf(p.pos) === groupOf(pos)) ?? named.find(p => p.team === team);
};
const offRoster = [], loose = [];
for (const item of rated) {
  const name = `${item.firstName} ${item.lastName}`.trim();
  const pos = EA_POSITION_OF[item.position?.label];
  if (!pos) throw new Error(`Unknown EA position ${item.position?.label} (${name})`);
  const team = codes.find(code => teams[Object.keys(teams).find(id => teams[id].code === code)].name.endsWith(item.team?.label ?? '\0'))
    ?? Object.entries(teams).find(([, t]) => norm(t.name).includes(norm(item.team?.label ?? '\0')))?.[1].code ?? null;
  const last = norm(item.lastName);
  let player = byFullName(name, team, pos);
  if (!player) {
    const same = roster.filter(p => norm(p.last) === last);
    player = same.find(p => p.team === team && p.overall === null)
      ?? (same.length === 1 && same[0].overall === null && norm(same[0].name)[0] === norm(name)[0] ? same[0] : undefined);
    if (player) loose.push(`${name} = ${player.name} (${player.team})`);
  }
  if (player) {
    if (player.overall !== null) throw new Error(`Two EA players for ${player.name}: ${name}`);
    player.overall = item.overallRating;
    player.nation = item.nationality?.label ?? null;
  } else {
    if (!team) throw new Error(`${name}: no club for EA's team ${item.team?.label}`);
    offRoster.push({ id: null, name, team, pos, born: null, games: 0, seconds: 0, points: 0, shots: 0, saves: 0, overall: item.overallRating, nation: item.nationality?.label ?? null });
  }
}
if (dates.size !== 1) console.warn(`  warning: the responses were fetched on ${[...dates].join(', ')}`);
const rows = [...roster, ...offRoster]
  .sort((a, b) => codes.indexOf(a.team) - codes.indexOf(b.team) || (b.overall ?? 0) - (a.overall ?? 0) || a.name.localeCompare(b.name))
  .map(p => [p.id, p.name, p.team, p.pos, p.born, p.nation, p.overall, p.games, p.seconds, p.points, p.shots, p.saves]);
const retrieved = [...dates].sort().at(-1);
const source = { edition: 'EA SPORTS NHL 27', retrieved, rated: total, floor: Math.min(...rated.map(item => item.overallRating)),
  ratings: 'https://www.ea.com/games/nhl/ratings', rosters: `${NHL}/roster/{team}/current`, stats: `${NHL}/club-stats/{team}/{season}/2`, seasons: SEASONS };
const text = `{\n"source": ${JSON.stringify(source)},\n"players": [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
await writeFile(output, text);
console.log(`NHL 27: ${total} rated players (lowest ${source.floor}) and ${roster.length} on rosters, ${retrieved} -> ${path.relative(root, output)}`);
console.log(`  ${roster.filter(p => p.overall !== null).length} rated players on a roster, ${offRoster.length} off every roster: ${offRoster.map(p => `${p.name} (${p.team})`).join(', ') || 'none'}`);
console.log(`  matched by surname: ${loose.join(', ') || 'none'}`);
