// Europe's first divisions in the EA FC snapshot, each club with its best XI in a 4-4-2. The club layer keeps Europe's
// strongest of them (scripts/build-clubs.mjs, TOP_CLUBS); the realism harness plays whole leagues of them
// (scripts/simulation-realism.mjs), since a league's weaker clubs are not in the club layer.
import { fileURLToPath } from 'node:url';
import { pickFootballSquad, playerTuple } from './football-data.mjs';
import { slug } from './club-identity.mjs';
import { EUROPEAN_LEAGUES } from '../../src/data/footballLeagues.js';

/** The EA FC snapshot the built-in clubs come from. */
export const EA_CLUB_SNAPSHOT = fileURLToPath(new URL('../data/ea-fc27.csv', import.meta.url));

// Europe's first divisions (UEFA's, as the nations' Europe theatre counts them) in EA's data, by EA competition id, with
// each league's name in the game (src/data/footballLeagues.js, which gives the map shape its clubs hold land in). By id
// because names collide internationally: Austria also has a Bundesliga, Ukraine a Premier League, Greece and Switzerland
// a Super League. The earlier seasons' EA editions use the same ids (scripts/lib/ea-seasons.mjs), Russia's among them.
const EA_COMPETITIONS = {
  13: 'Premier League',
  53: 'La Liga',
  31: 'Serie A',
  19: 'Bundesliga',
  16: 'Ligue 1',
  10: 'Eredivisie',
  308: 'Liga Portugal',
  68: 'Süper Lig',
  4: 'Belgian Pro League',
  63: 'Greek Super League',
  319: 'Czech First League',
  50: 'Scottish Premiership',
  1: 'Danish Superliga',
  41: 'Eliteserien',
  332: 'Ukrainian Premier League',
  317: 'Croatian HNL',
  66: 'Ekstraklasa',
  189: 'Swiss Super League',
  80: 'Austrian Bundesliga',
  313: 'Azerbaijan Premier League',
  64: 'Hungarian NB I',
  330: 'Romanian Liga I',
  318: 'Cypriot First Division',
  56: 'Allsvenskan',
  322: 'Veikkausliiga',
  65: 'League of Ireland',
  67: 'Russian Premier League',
};
export const FOOTBALL_LEAGUES = Object.freeze(Object.fromEntries(Object.entries(EA_COMPETITIONS).map(([id, league]) => {
  if (!EUROPEAN_LEAGUES[league]) throw new Error(`EA competition ${id} names ${league}, which src/data/footballLeagues.js does not list`);
  return [id, Object.freeze({ league, country: EUROPEAN_LEAGUES[league] })];
})));
// European first-division clubs EA lists under no competition.
export const LEAGUELESS_CLUBS = { 'PFC Ludogorets': { league: 'Bulgarian First League', country: EUROPEAN_LEAGUES['Bulgarian First League'] } };

const FOOTBALL_SIZE = 11;
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Every first-division club among `players` (loadEaPlayers') that fields a full XI: `{ id, name, league, country, exact,
 * squad }`, strongest first by `exact`, the mean rating of the XI (equals by name), with pickFootballSquad's squad.
 */
export function firstDivisionClubs(players) {
  const byClub = new Map();
  for (const player of players) {
    const home = LEAGUELESS_CLUBS[player.club] ?? (player.leagueLevel === 1 ? FOOTBALL_LEAGUES[player.leagueId] : null);
    if (!home) continue;
    const key = player.club;
    if (!key) throw new Error(`Missing club for ${player.sourceInfo.id}`);
    if (!byClub.has(key)) byClub.set(key, { ...home, players: [] });
    byClub.get(key).players.push(player);
  }
  return [...byClub.entries()]
    .map(([name, info]) => {
      const squad = pickFootballSquad(info.players);
      return { id: `f-${slug(name)}`, name, league: info.league, country: info.country, exact: mean(squad.map(p => p.rating)), squad };
    })
    .filter(c => c.squad.length >= FOOTBALL_SIZE)
    .sort((a, b) => b.exact - a.exact || a.name.localeCompare(b.name));
}

/** A squad as the club files store it, and as buildClub takes it: `[name, role, rating, sourceInfo]` tuples. */
export const squadTuples = squad => squad.map(p => (p.sourceInfo ? playerTuple(p) : [p.name, p.pos, p.rating]));
