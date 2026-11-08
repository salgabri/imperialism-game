// Tennis's national teams from the Tennis Abstract snapshot (scripts/data/tennis-elo.json, npm run sync:tennis). No I/O.
//
// Every rating is a player's Elo as Tennis Abstract publishes it, on the game's scale: Elo / 25 + 4, rounded (Jannik
// Sinner's 2297 is 96, a 1700 is 72, the list's last, 1050, is 46). A rating point is then 25 Elo points, and the match
// model plays Elo's own odds (src/sports/tennis.js). Nothing is estimated: a player Tennis Abstract does not rate is not
// in the game.
//
// A player plays for the country Tennis Abstract files him under (the IOC code the ATP uses). One the ATP no longer ranks
// (retired, or out of the game) is left out. A nation names its five best by Elo, the team a Davis Cup captain nominates;
// it needs two to play a tie (both singles players then play the doubles too), so a nation with one rated player fields
// no team and its land stays neutral.
import { NATIONS, selectLineup } from '../../src/data/teams.js';

const SPORT = 'tennis';
export const TEAM_SIZE = 5;
export const MIN_PLAYERS = 2;
export const ELO_PER_POINT = 25;
const ELO_OFFSET = 100;
export const SOURCE_ID = 'tennis-abstract';
export const EDITION = 'Tennis Abstract Elo';
const PLAYER_PAGE = key => `https://www.tennisabstract.com/cgi-bin/player.cgi?p=${encodeURIComponent(key).replace(/%27/g, "'")}`;

/** A player's Elo on the game's scale: Elo / 25 + 4, rounded. */
export const gameRating = elo => Math.round((elo + ELO_OFFSET) / ELO_PER_POINT);

// The IOC codes the game's nations do not share (its codes are FIFA's), and the countries with no shape on its map.
const NATION_OF_IOC = { GBR: '826', LBN: '422', LAT: '428' };
const OFF_THE_MAP = new Set(['HKG', 'MON']);
const NATION_OF_CODE = new Map(Object.entries(NATIONS).map(([id, record]) => [record[1], id]));

/** The game's nation for an IOC code, or null for a country the map does not draw. Throws on a code it does not know. */
export function nationOf(ioc) {
  if (OFF_THE_MAP.has(ioc)) return null;
  const id = NATION_OF_IOC[ioc] ?? NATION_OF_CODE.get(ioc);
  if (!id) throw new Error(`No nation for the IOC code ${ioc}`);
  return id;
}

/** The snapshot's row as a player: `[key, name, country, born, elo, hElo, cElo, gElo, eloRank, atpRank]`. */
export function playerOf([key, name, country, born, elo, , , , eloRank, atpRank], updated) {
  return { key, name, country, born, elo, eloRank, atpRank, rating: gameRating(elo), nation: nationOf(country),
    source: { id: `ta:${key}`, source: SOURCE_ID, edition: EDITION, snapshotDate: updated, rawRating: elo, rawScale: 'Elo',
      eloRank, atpRank, url: PLAYER_PAGE(key) } };
}

const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);

/** A squad player as the game's files hold it: `[name, 'SGL', rating, source]`. */
export const tupleOf = player => [player.name, 'SGL', player.rating, player.source];

/**
 * The nations that field a team, strongest first: each `{ id, name, str, squad, players, left }`, `squad` its five best
 * by Elo, `players` how many it has in all, `left` the rated players who are not in the game and why.
 */
export function nationsOf(players) {
  const pools = new Map();
  for (const player of players) {
    if (player.atpRank == null || player.nation == null) continue;
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  return [...pools.entries()].filter(([, pool]) => pool.length >= MIN_PLAYERS).map(([id, pool]) => {
    const squad = pool.slice().sort(byElo).slice(0, TEAM_SIZE);
    const lineup = selectLineup({ sport: SPORT, squad: squad.map(player => ({ name: player.name, pos: 'SGL', rating: player.rating })) });
    return { id, name: NATIONS[id][0], str: lineup.rating, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/** Rated players who play for nobody, by reason: no ATP rank, a country off the map, a nation of one. */
export function leftOut(players) {
  const unranked = players.filter(player => player.atpRank == null);
  const offMap = players.filter(player => player.atpRank != null && player.nation == null);
  const counts = new Map();
  for (const player of players) if (player.atpRank != null && player.nation != null) counts.set(player.nation, (counts.get(player.nation) || 0) + 1);
  const alone = players.filter(player => player.atpRank != null && player.nation != null && counts.get(player.nation) < MIN_PLAYERS);
  return { unranked, offMap, alone };
}
