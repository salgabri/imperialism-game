// League of Legends' earlier seasons (docs/design/league-of-legends.md, "Earlier seasons"): each tournament's match list and
// players list read from the cache, its line-ups worked out (scripts/lib/golgg-lineups.mjs), and the series they make for the
// Elo the built-in season's ratings use (scripts/lib/esports-elo.mjs), a player counting for his share of his team's games.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { readMatchList, readPlayersTable, readTeamsTable, seasonCode } from './golgg.mjs';
import { roleOdds, rolesWithin, usualOf } from './golgg-lineups.mjs';
import { mostOf } from './esports-elo.mjs';
import { ELO_PER_POINT, circuitOf, playerKey } from './league-of-legends.mjs';

/** The seasons built: from 2016, the first year gol.gg's players lists are whole, to the year before the built-in one. */
export const FIRST_SEASON = 2016;
export const LAST_SEASON = 2025;
/** A season rates its players on its own year's games and the year's before. */
export const WINDOW_YEARS = 2;
/**
 * The strongest players a season's scale is set by: their mean Elo reads as the built-in season's same number's does. A
 * season's levels centre whoever gol.gg recorded that year at 1500, five leagues in 2016 and fifty in 2025, so the same Elo
 * says different things of two seasons; the best of a season are the best of their day.
 */
export const ANCHOR_PLAYERS = 25;

const gunzip = async file => gunzipSync(await readFile(file)).toString('utf8');
const listFile = (cache, kind, year, name) => path.join(cache, kind, `${year}`, `${encodeURIComponent(name)}.html.gz`);

/**
 * A season's tournaments, oldest first, each once (gol.gg lists a tournament of two regions twice): [{ name, region, year,
 * from, to, games, minutes (a game's mean), circuit, list, players }], `list` its series with the unlinked ones and `players`
 * its players list, each with the odds of his roles by `model`, or null where the cache lacks it.
 */
export async function readSeasonLists(cache, year, { model = null } = {}) {
  const listed = JSON.parse(await gunzip(path.join(cache, 'tournaments', `${seasonCode(year)}.json.gz`)));
  const byName = new Map();
  for (const t of listed) {
    const kept = byName.get(t.trname);
    // One listed under two regions is played between them.
    if (kept) { byName.set(t.trname, { ...kept, region: kept.region === t.region ? kept.region : 'WR', nbgames: Number(kept.nbgames) + Number(t.nbgames),
      firstgame: kept.firstgame < t.firstgame ? kept.firstgame : t.firstgame, lastgame: kept.lastgame > t.lastgame ? kept.lastgame : t.lastgame }); }
    else byName.set(t.trname, t);
  }
  const tournaments = [];
  for (const t of byName.values()) {
    const list = await gunzip(listFile(cache, 'matchlists', year, t.trname)).then(html => readMatchList(html, { unlinked: true }), () => null);
    const players = await gunzip(listFile(cache, 'players', year, t.trname)).then(readPlayersTable, () => null);
    tournaments.push({ name: t.trname, region: t.region, year, from: t.firstgame, to: t.lastgame, games: Number(t.nbgames), minutes: Number(t.avgtime) / 60,
      circuit: circuitOf(t), list, players: players && model ? players.map(p => ({ ...p, odds: roleOdds(model, p) })) : players });
  }
  return tournaments.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.name.localeCompare(b.name));
}

/** A season's teams list, when the cache holds it: readTeamsTable's rows, else []. */
export const readSeasonTeams = (cache, year) => gunzip(path.join(cache, 'season-teams', `${seasonCode(year)}.html.gz`)).then(readTeamsTable, () => []);
/** The season's figures of each team, as the line-ups read them. */
export const usualOfTeams = teams => new Map(teams.map(team => [team.name, usualOf(team)]));

// ---------- the series ----------

/** A player's tag, without the bracket gol.gg tells two of one tag apart by ("luo (2)"). */
const tagOf = name => name.replace(/ \([^)]*\)$/, '');

/**
 * A tournament's line-ups: Map(team name → [{ id, name, country, games, wins, role, share }]), `share` the part of the team's
 * games a player played, most games first.
 */
export function lineupsOf(tournament, solution) {
  const lineups = new Map();
  for (const team of solution.teams) {
    const members = tournament.players.filter(p => solution.teamOf.get(p.id) === team.name);
    if (!members.length) continue;
    const roles = rolesWithin(members);
    const games = Math.max(team.games, ...members.map(p => p.games));
    lineups.set(team.name, members.sort((a, b) => b.games - a.games || a.id - b.id)
      .map(p => ({ id: p.id, name: tagOf(p.name), country: p.country, games: p.games, wins: p.wins, role: roles.get(p.id), share: p.games / games })));
  }
  return lineups;
}

/** Who won each game of a series won `a`–`b` (1 its first side), in an order it may have gone: the winner's and the loser's in turn. */
export function gamesInTurn(a, b) {
  const winner = a >= b ? 1 : 2;
  const [more, fewer] = a >= b ? [a, b] : [b, a];
  const games = [];
  for (let n = 0; n < more; n++) {
    games.push(winner);
    if (n < fewer) games.push(3 - winner);
  }
  return games;
}

/** The fewest of a side's five places known for its series to count: three. */
const LEAST_KNOWN = 3;

/**
 * A tournament's series as the Elo plays them (seriesOf's shape in scripts/lib/league-of-legends.mjs), oldest first: each game
 * between the sides' line-ups in that tournament. A series one of whose sides has fewer than three of its five places known is
 * left out (`short` counts them). `exact`: Map(series id → a series whose page is read), played as that page has it instead.
 */
export function listedSeries(tournament, lineups, { exact = new Map(), flagOf = () => null } = {}) {
  const series = [];
  let short = 0;
  tournament.list.slice().reverse().forEach((one, n) => {
    const known = one.id == null ? null : exact.get(one.id);
    if (known) { series.push({ ...known, order: one.id }); return; }
    const [a, b] = one.score;
    if (!a && !b) return;
    const sides = [one.left, one.right].map(team => (lineups.get(team) ?? []).map(p => ({ key: playerKey(p), name: p.name,
      flag: flagOf(p), team, role: p.role, share: p.share })));
    if (sides.some(side => side.reduce((sum, entry) => sum + entry.share, 0) < LEAST_KNOWN)) { short++; return; }
    series.push({ id: one.id ?? `${tournament.name} ${n}`, order: one.id ?? 0, date: one.date, circuit: tournament.circuit, tournament: tournament.name,
      teams: [one.left, one.right], games: gamesInTurn(a, b).map(winner => ({ winner, sides })) });
  });
  return { series, short };
}

/** Series in the order they were played: by date, then as gol.gg numbers its games. */
export const inOrder = series => series.sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? a.id) - (b.order ?? b.id) || String(a.id).localeCompare(String(b.id)));

/** The series a season's ratings stand on: its window's, from 1 January of the year before to 31 December. */
export const windowOf = (series, year) => series.filter(one => one.date >= `${year - WINDOW_YEARS + 1}-01-01` && one.date <= `${year}-12-31`);

// ---------- roles ----------

// What the year before says of a player's role beside what his own year does.
const OTHER_YEAR = 0.5;
// What a player's whole career says of his role beside his season: as much. The line-ups' roles are read off the players'
// figures, which a season can misread for a player (Ale and 369, top laners, as mid laners in 2021 and 2022); his
// career's settles a season split between two roles, and a season of one role still stands (Rekkles' move to support).
const CAREER = 1;

/** Each player's games at each role over `series`, `weight(one)` each series' weight → Map(key → Map(role → games)). */
function roleCounts(series, weight = () => 1) {
  const counts = new Map();
  for (const one of series) {
    const games = weight(one) * one.games.length;
    for (const entry of one.games[0].sides.flat()) {
      if (!entry.role) continue;
      if (!counts.has(entry.key)) counts.set(entry.key, new Map());
      const played = counts.get(entry.key);
      played.set(entry.role, (played.get(entry.role) ?? 0) + games * (entry.share ?? 1));
    }
  }
  return counts;
}

/** Each player's games at each role over all the series there are (every season's): his career's word, for rolesIn. */
export const careerRoles = series => roleCounts(series);

/**
 * Each player's role in season `year`: the one he played most over the window's series, the year before counting half,
 * his career's shares (`career`, careerRoles') added to his season's (CAREER). → Map(key → role)
 */
export function rolesIn(series, year, career = null) {
  const shares = played => {
    const all = [...played.values()].reduce((a, b) => a + b, 0);
    return new Map([...played].map(([role, games]) => [role, games / all]));
  };
  return new Map([...roleCounts(series, one => (one.date >= `${year}-01-01` ? 1 : OTHER_YEAR))].map(([key, played]) => {
    const own = shares(played);
    const whole = career?.has(key) ? shares(career.get(key)) : new Map();
    const score = new Map([...new Set([...own.keys(), ...whole.keys()])].map(role => [role, (own.get(role) ?? 0) + CAREER * (whole.get(role) ?? 0)]));
    return [key, mostOf(score)];
  }));
}

// ---------- the scale ----------

/**
 * The base a season's Elo reads from: its strongest ANCHOR_PLAYERS average what the built-in season's do, unless that puts
 * its best above TOP_RATING (a year one team ran away with: 2025's Gen.G), when the base rises to keep him there.
 */
export function baseOf(elos, todays, todaysBase) {
  const mean = list => list.slice().sort((a, b) => b - a).slice(0, ANCHOR_PLAYERS).reduce((sum, elo) => sum + elo, 0) / Math.min(ANCHOR_PLAYERS, list.length);
  const anchored = Math.round(todaysBase + mean(elos) - mean(todays));
  // The lowest base at which the best reads TOP_RATING or less, rounded: (best − base) / 25 under TOP_RATING + ½.
  const capped = Math.floor(Math.max(...elos) - (TOP_RATING + 0.5) * ELO_PER_POINT) + 1;
  return Math.max(anchored, capped);
}
/** The highest a season's best player reads: two short of the scale's end. */
export const TOP_RATING = 98;

// ---------- how the year's games went ----------

/** A straight line's fit, weighted: { low, high } its values at 0 and at 1. */
function lineOf(points) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y, weight] of points) { n += weight; sx += weight * x; sy += weight * y; sxx += weight * x * x; sxy += weight * x * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const low = (sy - slope * sx) / n;
  return { low, high: low + slope };
}

// A team with fewer games says little of how a winner's games differ from a loser's.
const LEAST_GAMES = 10;

/**
 * How a year's games went, from its tournaments and its teams list: a game's mean length in minutes, and the kills and the
 * Barons a game of its winner and its loser, each read off the line of the teams' figures against their share of games won
 * (a side that never loses takes a winner's every game, one that never wins a loser's).
 */
export function yearOfGames(tournaments, teams) {
  const games = tournaments.reduce((sum, t) => sum + t.games, 0);
  const minutes = tournaments.reduce((sum, t) => sum + t.games * t.minutes, 0) / games;
  const regular = teams.filter(team => team.games >= LEAST_GAMES);
  const line = figure => lineOf(regular.filter(team => team[figure] != null).map(team => [team.wins / team.games, team[figure], team.games]));
  const round = x => Math.round(x * 1000) / 1000;
  const kills = line('kills'), nashors = line('nashors');
  return { games, minutes: round(minutes), kills: { winner: round(kills.high), loser: round(kills.low) },
    nashors: { winner: round(nashors.high), loser: round(nashors.low) }, teams: regular.length };
}
