// The EuroLeague's earlier seasons, 2000/01 to 2025/26 (docs/design/euroleague.md, "Earlier seasons"): each season's
// clubs with their best fives, rated by the built-in season's rule (scripts/lib/euroleague.mjs) with each season's PIR
// put on 2025/26's league level, and the maps they play on, one per run of seasons with the same clubs. Read by
// scripts/build-euroleague.mjs (the audit and the seasons' league figures), scripts/build-nba-seasons.mjs (each season's
// clubs ride in its NBA season's file) and scripts/build-europe-maps.mjs (the maps). The snapshots are
// scripts/sync-euroleague-seasons.mjs's.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { colourFor } from './club-identity.mjs';
import { FIVE, blendedPir, displayName, estimateRating, per36, positionsOf, startingFive } from './euroleague.mjs';
import { selectLineup } from '../../src/data/teams.js';

/** The season whose league level every earlier season's PIR is put on: 2025/26, the built-in season's last full one. */
export const REFERENCE_SEASON = 2025;
/** A season's lines: the season itself and the two before it, oldest first, as the built-in season's (SEASON_WEIGHTS). */
const SPAN = 3;
// A line is [games, minutes, points, rebounds, assists, three-point attempts, PIR], per game.
const REB = 3, AST = 4, TPA = 5, PIR = 6;

const seasonLabel = year => `${year}/${String(year + 1).slice(2)}`;
/** The NBA season a EuroLeague season is played beside, by its year as the game counts seasons (2009/10 is 2010). */
export const gameYearOf = year => year + 1;
/** A season's era map: 'el2010' for the run of seasons starting in 2009/10, as the NBA's era maps are named. */
export const mapIdOf = year => `el${gameYearOf(year)}`;

/** The committed snapshots, by EuroLeague year (2009 for 2009/10): `{ year: snapshot }`. */
export function readSnapshots(root) {
  const dir = path.join(root, 'scripts/data/euroleague-seasons');
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter(file => /^E\d{4}\.json$/.test(file)).sort()
    .map(file => [Number(file.slice(1, 5)), JSON.parse(readFileSync(path.join(dir, file), 'utf8'))]));
}

/** The game's identity for EuroLeague club `code` in season `year`: an era's, today's club's, or a club of the past's. */
export function identityOf(identity, code, year) {
  const era = identity.eras?.[code]?.find(entry => year >= entry.from && year <= entry.to);
  const team = era ?? identity.clubs[code] ?? identity.history?.[code];
  if (!team) throw new Error(`No identity for EuroLeague club ${code} in ${seasonLabel(year)}`);
  const { id, name, code: short, country } = team;
  return { id, name, code: short, country };
}

/**
 * How much a season's box score counts on the reference season's scale, column by column: the reference's average team
 * PIR, rebounds, assists and three-point attempts a game over the season's. PIR follows scoring, which rose from 74 to 86
 * points a team a game between 2010/11 and 2025/26; assists were counted far more sparingly in the 2000s (10.7 a team
 * a game in 2000/01, 18.8 in 2025/26), and three-pointers were fewer (18.2 and 26.6 attempts).
 */
export function seasonScale(snapshots, year) {
  const ref = snapshots[REFERENCE_SEASON].league, own = snapshots[year].league;
  return { pir: ref.pir / own.pir, reb: ref.reb / own.reb, ast: ref.ast / own.ast, tpa: ref.tpa / own.tpa };
}
export const pirScale = (snapshots, year) => seasonScale(snapshots, year).pir;

/**
 * The EuroLeague position of a player no roster lists (a few who played a game or two, mostly in the 2000s), from his
 * box score per 36 minutes: a guard with 4 assists, a centre with 9 rebounds and under 1.5 three-point attempts, else a
 * forward.
 */
export function boxScorePosition(lines) {
  const rates = per36(lines);
  if (!rates) return 'F';
  return rates.ast >= 4 ? 'G' : rates.reb >= 9 && rates.tpa < 1.5 ? 'C' : 'F';
}

/** Spearman's rank correlation of two lists (average ranks for ties). */
export function spearman(xs, ys) {
  const ranks = list => {
    const order = list.map((value, i) => [value, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(list.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  };
  const a = ranks(xs), b = ranks(ys), n = xs.length;
  const mean = list => list.reduce((s, v) => s + v, 0) / n;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

/**
 * One season's clubs, strongest first, as the built-in season's: each with its best five as `[name, 'PG/SG', rating]`
 * and `str` the five's mean. A player's lines are his seasons `year` - 2 to `year`, each season's PIR on the reference
 * scale; he plays for the club the snapshot gives him. Returns `{ year, season, label, clubs, players, warnings }`,
 * `players` every player of the season as rated, and each club its `record` ([wins, games]) that season.
 */
export function seasonClubs(snapshots, year, identity) {
  const snapshot = snapshots[year];
  if (!snapshot) throw new Error(`No EuroLeague snapshot for ${seasonLabel(year)}`);
  const names = identity.names ?? {};
  const warnings = [];
  // Every player's line in each season of the span, by EuroLeague code, on the reference season's scale.
  const lineOf = new Map();
  for (let s = 0; s < SPAN; s++) {
    const at = year - (SPAN - 1) + s;
    if (!snapshots[at]) continue;
    const scale = seasonScale(snapshots, at);
    for (const row of snapshots[at].players) {
      if (!lineOf.has(row[0])) lineOf.set(row[0], new Array(SPAN).fill(null));
      const line = row[6].slice();
      line[REB] *= scale.reb;
      line[AST] *= scale.ast;
      line[TPA] *= scale.tpa;
      line[PIR] *= scale.pir;
      lineOf.get(row[0])[s] = line;
    }
  }
  const players = snapshot.players.map(row => {
    const [code, name, club, position, height, nationality, , extra = {}] = row;
    const lines = lineOf.get(code);
    return { code, club, nationality, name: displayName(name, extra, names[code]), positions: positionsOf(position ?? boxScorePosition(lines), height, lines),
      rating: estimateRating(lines), pir: blendedPir(lines), games: row[6][0] };
  });
  const seen = new Set();
  for (const player of players) {
    const key = `${player.club}|${player.name}`;
    if (seen.has(key)) throw new Error(`Two players called ${player.name} at ${player.club} in ${seasonLabel(year)}`);
    seen.add(key);
  }
  const clubs = snapshot.clubs.map(entry => {
    const team = identityOf(identity, entry.code, year);
    const pool = players.filter(player => player.club === entry.code).map(p => ({ ...p, pos: p.positions[0] }));
    const five = startingFive(pool);
    if (five.length < FIVE) throw new Error(`${team.name} has ${five.length} players in ${seasonLabel(year)}`);
    const stretched = selectLineup({ sport: 'basketball', squad: five }).slots.filter(slot => slot.outOfPosition)
      .map(slot => `${slot.player.name} at ${slot.position}`);
    if (stretched.length) warnings.push(`${team.name} plays ${stretched.join(', ')} out of position`);
    return { ...team, league: 'EuroLeague', col: colourFor(team.id), str: Math.round(five.reduce((sum, p) => sum + p.rating, 0) / five.length),
      squad: five.map(p => [p.name, p.positions.join('/'), p.rating]), source: entry.code, record: [entry.wins, entry.games], regular: entry.regular };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const ids = new Set(clubs.map(club => club.id)), codes = new Set(clubs.map(club => club.code));
  if (ids.size !== clubs.length || codes.size !== clubs.length) throw new Error(`${seasonLabel(year)}: two clubs share an id or a code`);
  return { year, season: seasonLabel(year), label: snapshot.source.label, clubs, players, warnings };
}

/**
 * Every season's clubs and the maps they play on: `{ seasons: [seasonClubs + { map }], maps: [{ id, years, clubs }] }`,
 * oldest first. A run of seasons with the very same clubs shares one map (each club holds the land its home gives it,
 * whatever its strength), named after its first season and ranked by its first season's strengths.
 */
export function euroleagueSeasons(root, identity = JSON.parse(readFileSync(path.join(root, 'scripts/data/euroleague-teams.json'), 'utf8'))) {
  const snapshots = readSnapshots(root);
  const years = Object.keys(snapshots).map(Number).sort((a, b) => a - b);
  if (years.length && !snapshots[REFERENCE_SEASON]) throw new Error(`The reference season ${seasonLabel(REFERENCE_SEASON)} has no snapshot`);
  const seasons = years.map(year => seasonClubs(snapshots, year, identity));
  const maps = [];
  for (const season of seasons) {
    const key = season.clubs.map(club => club.id).sort().join();
    const last = maps.at(-1);
    if (last && last.key === key && last.years.at(-1) === season.year - 1) last.years.push(season.year);
    else maps.push({ id: mapIdOf(season.year), key, years: [season.year], clubs: season.clubs });
    season.map = maps.at(-1).id;
  }
  return { snapshots, seasons, maps: maps.map(({ key, ...map }) => map) };
}
