// Tennis's national teams from a Tennis Abstract snapshot (npm run sync:tennis, sync:womens-tennis). No I/O.
//
// Every rating is a player's Elo as Tennis Abstract publishes it, on the game's scale: Elo / 25 + 4, rounded (Jannik
// Sinner's 2297 is 96, a 1700 is 72, the men's list's last, 1050, is 46; Elena Rybakina's 2159 is 90). A rating point is
// then 25 Elo points, and the match model plays Elo's own odds (src/sports/tennis.js). Nothing is estimated: a player
// Tennis Abstract does not rate is not in the game.
//
// Two tours, two sports: the ATP's men play the Davis Cup (`tennis`), the WTA's women the Billie Jean King Cup
// (`womens-tennis`). A player plays for the country Tennis Abstract files them under (the IOC code the tour uses). One
// the tour no longer ranks (retired, or out of the game) is left out. A nation names its five best by Elo, the team a
// captain nominates in either cup; it needs two to play a tie (both singles players then play the doubles too), so a
// nation with one rated player fields no team and its land stays neutral.
import { NATIONS, nationIdentity, selectLineup } from '../../src/data/teams.js';
import { tennis } from '../../src/sports/tennis.js';

export const TEAM_SIZE = 5;
export const MIN_PLAYERS = 2;
export const ELO_PER_POINT = 25;
const ELO_OFFSET = 100;
export const SOURCE_ID = 'tennis-abstract';
export const EDITION = 'Tennis Abstract Elo';

// Each tour's snapshot, its sport and its rosters: the rank the source records (`atpRank`, `wtaRank`) and the player's
// page on Tennis Abstract (the women's are wplayer.cgi).
export const TOURS = Object.freeze({
  atp: Object.freeze({ id: 'atp', sport: 'tennis', name: 'ATP', rankKey: 'atpRank', page: 'player.cgi',
    snapshot: 'scripts/data/tennis-elo.json', rosters: 'src/data/rosters.tennis.js', pronoun: 'his' }),
  wta: Object.freeze({ id: 'wta', sport: 'womens-tennis', name: 'WTA', rankKey: 'wtaRank', page: 'wplayer.cgi',
    snapshot: 'scripts/data/womens-tennis-elo.json', rosters: 'src/data/rosters.womens-tennis.js', pronoun: 'her' }),
});
/** A tour by its id ('atp', 'wta'); throws on any other. */
export function tourOf(id = 'atp') {
  const tour = TOURS[id];
  if (!tour) throw new Error(`Unknown tour ${id}: atp or wta`);
  return tour;
}
const playerPage = (key, tour) =>
  `https://www.tennisabstract.com/cgi-bin/${tour.page}?p=${encodeURIComponent(key).replace(/%27/g, "'")}`;

/** A player's Elo on the game's scale: Elo / 25 + 4, rounded. */
export const gameRating = elo => Math.round((elo + ELO_OFFSET) / ELO_PER_POINT);

// The IOC codes the game's nations do not share (its codes are FIFA's), and the countries with no shape on its map.
const NATION_OF_IOC = { GBR: '826', LBN: '422', LAT: '428', SLO: '705', INA: '360' };
const OFF_THE_MAP = new Set(['HKG', 'MON', 'MLT', 'AND', 'LIE']);
// Pacific Oceania, the islands' combined Billie Jean King Cup team, names no country of its own.
const COMBINED = new Set(['POC']);
const NATION_OF_CODE = new Map(Object.entries(NATIONS).map(([id, record]) => [record[1], id]));

/** The game's nation for an IOC code, or null for a country the map does not draw. Throws on a code it does not know. */
export function nationOf(ioc) {
  if (OFF_THE_MAP.has(ioc) || COMBINED.has(ioc)) return null;
  const id = NATION_OF_IOC[ioc] ?? NATION_OF_CODE.get(ioc);
  if (!id) throw new Error(`No nation for the IOC code ${ioc}`);
  return id;
}

/** The snapshot's row as a player: `[key, name, country, born, elo, hElo, cElo, gElo, eloRank, tour rank]`. */
export function playerOf([key, name, country, born, elo, , , , eloRank, rank], updated, tour = TOURS.atp) {
  return { key, name, country, born, elo, eloRank, rank, rating: gameRating(elo), nation: nationOf(country),
    source: { id: `ta:${key}`, source: SOURCE_ID, edition: EDITION, snapshotDate: updated, rawRating: elo, rawScale: 'Elo',
      eloRank, [tour.rankKey]: rank, url: playerPage(key, tour) } };
}

const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);

/** A squad player as the game's files hold it: `[name, 'SGL', rating, source]`. */
export const tupleOf = player => [player.name, 'SGL', player.rating, player.source];

/**
 * The nations that field a team, strongest first: each `{ id, name, str, squad, players }`, `squad` its five best by
 * Elo, `players` how many it has in all. Great Britain plays as one in both cups, as the United Kingdom.
 */
export function nationsOf(players, tour = TOURS.atp) {
  const pools = new Map();
  for (const player of players) {
    if (player.rank == null || player.nation == null) continue;
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  return [...pools.entries()].filter(([, pool]) => pool.length >= MIN_PLAYERS).map(([id, pool]) => {
    const squad = pool.slice().sort(byElo).slice(0, TEAM_SIZE);
    const lineup = selectLineup({ sport: tour.sport, squad: squad.map(player => ({ name: player.name, pos: 'SGL', rating: player.rating })) });
    return { id, name: nationIdentity(id, tennis).name, str: lineup.rating, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/** Rated players who play for nobody, by reason: no tour rank, a country off the map (or a combined team), a nation of one. */
export function leftOut(players) {
  const unranked = players.filter(player => player.rank == null);
  const offMap = players.filter(player => player.rank != null && player.nation == null);
  const counts = new Map();
  for (const player of players) if (player.rank != null && player.nation != null) counts.set(player.nation, (counts.get(player.nation) || 0) + 1);
  const alone = players.filter(player => player.rank != null && player.nation != null && counts.get(player.nation) < MIN_PLAYERS);
  return { unranked, offMap, alone };
}
