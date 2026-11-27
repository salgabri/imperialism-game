// League of Legends' ratings from gol.gg's results (docs/design/league-of-legends.md): the cached pages
// (scripts/lib/golgg.mjs) read into the series an Elo of players plays (scripts/lib/esports-elo.mjs), game by game, the
// role each player plays and the nation he plays for.
import { readdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { NATIONS, nationIdentity, selectLineup } from '../../src/data/teams.js';
import { nationOfFlag } from './rocket-league.mjs';
import { readGamePage, readMatchList, readPlayerList, readSummaryPage, yearOfSeason } from './golgg.mjs';
import { favouriteBins, mostOf, oddsBin, runElo } from './esports-elo.mjs';

export const SPORT = 'league-of-legends';
/** League's five roles, in the order gol.gg lists a side's players. */
export const ROLES = Object.freeze(['TOP', 'JGL', 'MID', 'BOT', 'SUP']);
/** A nation's squad: its five starters and two in reserve. */
export const TEAM_SIZE = 7;
/** The five who play a game. */
export const LINEUP = 5;
/** The fewest games a player needs behind him to be rated at all. */
export const MIN_GAMES = 20;
/** How long since his last game a player still plays for his nation: a year. */
export const ACTIVE_DAYS = 365;
/** The K scale (scripts/sync-league-of-legends.mjs --tune: 160 the best of 80…400 with the circuits' levels): K = K_SCALE / (games + 5)^0.4. */
export const K_SCALE = 160;
/**
 * Whether a newcomer starts at his home circuit's level (circuitLevels in scripts/lib/esports-elo.mjs) rather than 1500:
 * yes, as the leagues meet too seldom for Elo to place them (the LEC's teams never play the national leagues below it).
 */
export const CIRCUIT_LEVELS = true;
/**
 * The circuits' levels' own prior (circuitLevels `levelSpread`): a normal spread of 500 Elo around the players' mean, since
 * 2026-11-21. Without it a circuit tied to the rest by a few dozen games went as far as they allowed (Japan's LJL to 1098,
 * Portugal's to 992); with it the held-out games between circuits went from 0.6027 to 0.5973 log loss and the rest from
 * 0.6228 to 0.6190 (--tune --rolling; 300 to 700 do about as well).
 */
export const LEVEL_SPREAD = 500;
/**
 * A rating point is 25 Elo points: rating = (Elo − ELO_BASE) / 25, rounded. The circuits' levels centre all of gol.gg's
 * players at 1500, two thousand of every tier, which puts the LCK's and the LPL's best near 2530: a base of 100, not
 * Rocket League's 50, keeps them at 97, under the game's 99.
 */
export const ELO_PER_POINT = 25;
export const ELO_BASE = 100;
export const gameRating = (elo, base = ELO_BASE) => Math.round((elo - base) / ELO_PER_POINT);
export const SOURCE_ID = 'golgg';
export const EDITION = 'gol.gg Elo';
export const SITE_URL = 'https://gol.gg';

// ---------- tournaments ----------

/**
 * A second tier's tournament: an academy league, a second division, a regional league below the first ("1st Div 2025" is
 * not); in the earlier seasons also the Challenger Series of Europe and North America (EU CS, NA CS), Challengers Korea
 * (CK), Brazil's Circuitão (BRCC), Czechia's Hitpoint Challengers, Spain's LVP2 and the LCS's Proving Grounds.
 */
const SECOND_TIER = /\bCL\b|Academy|NACL|\bCD\b|Circuito Desafiante|\bDiv ?2\b|2nd Div|\bLR[NS]\b|\bCS\b|\bCK\b|\bBRCC\b|Hitpoint Challengers|\bLVP2\b|Proving Grounds/i;
/** A tournament between circuits, whatever region gol.gg files it under: a promotion, the European Masters, the Iberian Cup. */
const BETWEEN_CIRCUITS = /\bpromo(tion)?\b|\bE(U|MEA) Masters?\b|Iberian Cup/i;

/**
 * A tournament's circuit: gol.gg's region (KR, CN, EUW, FR, …), its second tier apart ("KR-2": the LCK's academy league),
 * the Pacific's and South America's multinational leagues by name, and the NLC (Northern Europe's league, which gol.gg files
 * under EUW with the LEC) its own; null for the international stage (Worlds, MSI, the Esports World Cup, First Stand, EMEA
 * Masters, a promotion tournament between two divisions).
 */
export function circuitOf(tournament) {
  const name = tournament.trname, region = tournament.region;
  if (BETWEEN_CIRCUITS.test(name)) return null;
  if (region === 'WR') {
    if (/\b(PCS|LCP)\b/.test(name)) return 'PCS';
    if (/kespa/i.test(name)) return 'KR';
    if (/LTA (North|South)/i.test(name)) return /north/i.test(name) ? 'NA' : 'LTA South';
    return null;
  }
  if (/LTA South/i.test(name)) return 'LTA South';
  if (region === 'EUW' && /\bNLC\b/.test(name)) return 'NLC';
  if (region === 'EUW' && /Challenge France/i.test(name)) return 'FR';
  return SECOND_TIER.test(name) ? `${region}-2` : region;
}

// ---------- the cache, read ----------

const gunzip = async file => gunzipSync(await readFile(file)).toString('utf8');

/**
 * Every cached series of the seasons' tournaments, read: [{ id, date, tournament, region, year, stage, bestOf, teams,
 * games: [{ winner, duration, sides? }], players: [[…], […]] }] (the page's own sides, the winner 1 for its first), and
 * gol.gg's players (id → { name, country }) from a page's search box.
 */
export async function readCache(cache) {
  const series = [];
  const missing = [];
  let people = new Map();
  for (const name of (await readdir(path.join(cache, 'tournaments')).catch(() => [])).sort()) {
    const year = yearOfSeason(name.split('.')[0]);
    const tournaments = JSON.parse(await gunzip(path.join(cache, 'tournaments', name)));
    for (const tournament of tournaments) {
      const file = path.join(cache, 'matchlists', `${year}`, `${encodeURIComponent(tournament.trname)}.html.gz`);
      const html = await gunzip(file).catch(() => null);
      if (html == null) continue;
      for (const one of readMatchList(html)) {
        const page = await gunzip(path.join(cache, 'series', `${one.id}.html.gz`)).catch(() => null);
        if (page == null) { missing.push(one.id); continue; }
        // A copy: the strings read off a page are slices of it, and would keep every page whole in memory.
        const read = structuredClone(one.page === 'summary' ? readSummaryPage(page) : readGamePage(page));
        if (!read || !read.games.length) continue;
        // Every page carries the whole list as it stood when the page was fetched: the longest is the newest.
        if (people.size < 1000) {
          const list = readPlayerList(page);
          if (list.size > people.size) people = list;
        }
        series.push({ id: one.id, date: one.date, tournament: tournament.trname, region: tournament.region, year, stage: one.stage,
          circuit: circuitOf(tournament), ...read });
      }
    }
  }
  series.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return { series, missing, people };
}

/** A player's key: his gol.gg page. */
export const playerKey = player => `gg:${player.id}`;

/**
 * The series as the Elo plays them, in date order: each game one Elo game between the sides' players, as the page lists
 * them (a series with a substitute has six on that side, each counting in every game). A side of fewer than five on the
 * page is left out, with its series. Each player's role is counted where his side lists exactly five, in ROLES' order.
 */
export function seriesOf(read, people) {
  const series = [];
  for (const one of read) {
    if (one.players.some(side => side.length < LINEUP)) continue;
    const sides = one.players.map((side, s) => side.map((player, i) => ({ key: playerKey(player), name: player.name,
      flag: people.get(player.id)?.country?.toLowerCase() ?? null, team: one.teams[s]?.name ?? null,
      role: side.length === LINEUP ? ROLES[i] : null })));
    series.push({ id: one.id, date: one.date, circuit: one.circuit, tournament: one.tournament, bestOf: one.bestOf,
      teams: one.teams.map(team => team.name), games: one.games.map(game => ({ ...game, sides })) });
  }
  return series;
}

/** Each player's roles, counted over the series: key → Map(role → games). */
export function rolesOf(series) {
  const roles = new Map();
  for (const one of series) {
    for (const entry of one.games[0].sides.flat()) {
      if (!entry.role) continue;
      if (!roles.has(entry.key)) roles.set(entry.key, new Map());
      const counts = roles.get(entry.key);
      counts.set(entry.role, (counts.get(entry.role) ?? 0) + one.games.length);
    }
  }
  return roles;
}

/** A player's flag: the country gol.gg files him under. */
export const flagOf = player => mostOf(player.flags);

/** The nation a player plays for: his country's, or none. */
export const nationOfPlayer = player => nationOfFlag(flagOf(player));

/** The snapshot's row: `[key, name, flag, nation, role, elo, games, wins, last, team, circuit]`. */
export const rowOf = p => [p.key, p.name, p.flag, p.nation, p.role, p.elo, p.games, p.wins, p.last, p.team, p.circuit];

/**
 * A snapshot row as a player of the game: his rating (an earlier season's read from its own `base`), role and nation, and the
 * source a squad keeps.
 */
export function playerOf([key, name, flag, nation, role, elo, games, wins, last, team, circuit], snapshotDate, eloRank, base = ELO_BASE) {
  const id = key.replace(/^gg:/, '');
  return { key, name, flag, nation, role, elo, games, wins, last, team, circuit, rating: gameRating(elo, base),
    source: { id: key, source: SOURCE_ID, edition: EDITION, snapshotDate, rawRating: elo, rawScale: 'Elo', eloRank, games,
      lastPlayed: last, ...(team ? { team } : {}), url: `${SITE_URL}/players/player-stats/${id}/season-ALL/split-ALL/tournament-ALL/` } };
}

/** A squad player as the game's files hold it: `[name, role, rating, source]`. */
export const tupleOf = player => [player.name, player.role ?? 'MID', player.rating, player.source];

// ---------- how the real games went ----------

/**
 * How the real games went, for the match model (src/sports/leagueOfLegends.js) and its checks
 * (scripts/simulation-realism.mjs): the games from `from` whose ten players had each played MIN_GAMES games before, each
 * at its own pre-game Elo odds. Their lengths (`minutes`: mean and spread), the kills and Barons of the single games whose
 * pages give them (`kills`, `barons`), the series' scores (`series`), the favourite's record by its odds (`favourites`) and
 * the games by their odds (`odds`: [bin, games, favourite won]).
 */
export function playOf(series, { scale, starts, homes, from }) {
  const lengths = [];
  const kills = { games: 0, winner: 0, loser: 0, winnerBaron: 0, loserBaron: 0 };
  const byOdds = new Map();
  const seriesRows = [];
  let current = null;
  runElo(series, { scale, starts, homes, onGame: (one, game, e, sides) => {
    if (one.date < from) return;
    const seasoned = sides.flat().every(player => player.games >= MIN_GAMES);
    if (current?.one !== one) {
      current = { one, odds: e, seasoned, won: [0, 0] };
      if (one.bestOf === 3 || one.bestOf === 5) seriesRows.push(current);
    }
    current.won[game.winner - 1]++;
    if (!seasoned) { current.seasoned = false; return; }
    if (game.duration) lengths.push(game.duration / 60);
    const won = game.winner === 1 ? 1 : 0;
    const bin = oddsBin(e);
    const row = byOdds.get(bin) ?? [bin, 0, 0];
    row[1]++;
    if ((e >= 0.5) === (won === 1)) row[2]++;
    byOdds.set(bin, row);
    if (game.stats?.every(side => Number.isFinite(side.kills) && Number.isFinite(side.barons))) {
      const winner = game.stats[game.winner - 1], loser = game.stats[2 - game.winner];
      kills.games++;
      kills.winner += winner.kills;
      kills.loser += loser.kills;
      if (winner.barons > 0) kills.winnerBaron++;
      if (loser.barons > 0) kills.loserBaron++;
    }
  } });
  const round3 = x => Math.round(x * 1000) / 1000;
  const mean = lengths.reduce((sum, x) => sum + x, 0) / Math.max(1, lengths.length);
  const spread = Math.sqrt(lengths.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, lengths.length));
  const play = { from, minGames: MIN_GAMES, games: lengths.length, minutes: { mean: round3(mean), spread: round3(spread) },
    kills: { games: kills.games, winner: round3(kills.winner / Math.max(1, kills.games)), loser: round3(kills.loser / Math.max(1, kills.games)) },
    barons: { winner: round3(kills.winnerBaron / Math.max(1, kills.games)), loser: round3(kills.loserBaron / Math.max(1, kills.games)) },
    series: {} };
  for (const row of seriesRows) {
    if (!row.seasoned) continue;
    const toWin = (row.one.bestOf + 1) / 2;
    if (Math.max(...row.won) !== toWin) continue;
    const key = `bo${row.one.bestOf}`;
    const score = `${toWin}-${Math.min(...row.won)}`;
    play.series[key] ??= {};
    play.series[key][score] = (play.series[key][score] ?? 0) + 1;
  }
  play.favourites = favouriteBins(seriesRows.filter(row => row.seasoned).map(row => ({ bestOf: row.one.bestOf, odds: row.odds, won: row.won })));
  play.odds = [...byOdds.values()].sort((a, b) => a[0] - b[0]);
  return play;
}

/** Two of a nation's who go by one name: the second gets " II". */
function distinctNames(squad) {
  const seen = new Set();
  return squad.map(player => {
    const name = seen.has(player.name) ? `${player.name} II` : player.name;
    seen.add(player.name);
    return name === player.name ? player : { ...player, name };
  });
}

/**
 * The nations that field a team, strongest first: each `{ id, name, str, squad, players }`. A squad names the nation's best
 * player in each role it has one for, then its best others by Elo, TEAM_SIZE in all; `str` is the lineup's rating as the
 * game picks it (selectLineup: one a role, a player out of his own playing below his rating). A nation with fewer than
 * LINEUP rated players, or off the map, fields none.
 */
export function nationsOf(players, sport) {
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null || !Object.hasOwn(NATIONS, player.nation)) continue;
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);
  return [...pools.entries()].filter(([, pool]) => pool.length >= LINEUP).map(([id, pool]) => {
    const sorted = pool.slice().sort(byElo);
    const starters = ROLES.map(role => sorted.find(player => player.role === role)).filter(Boolean);
    const rest = sorted.filter(player => !starters.includes(player));
    const squad = distinctNames([...starters, ...rest].slice(0, TEAM_SIZE).sort(byElo));
    const str = selectLineup({ sport: SPORT, squad: squad.map(player => ({ name: player.name, pos: player.role ?? 'MID', rating: player.rating })) }).rating;
    return { id, name: nationIdentity(id, sport).name, str, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}
