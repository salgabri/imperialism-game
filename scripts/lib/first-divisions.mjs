// Europe's first divisions in the EA FC snapshot, each club with its best XI in a 4-4-2. The club layer keeps Europe's
// strongest of them (scripts/build-clubs.mjs, TOP_CLUBS); the realism harness plays whole leagues of them
// (scripts/simulation-realism.mjs), since a league's weaker clubs are not in the club layer.
import { fileURLToPath } from 'node:url';
import { pickFootballSquad, playerTuple } from './football-data.mjs';
import { slug } from './club-identity.mjs';

/** The EA FC snapshot the built-in clubs come from. */
export const EA_CLUB_SNAPSHOT = fileURLToPath(new URL('../data/ea-fc27.csv', import.meta.url));

// Europe's first divisions (UEFA's, as the nations' Europe theatre counts them) in the EA snapshot, by EA competition
// id, with each league's name in the game and the map shape its clubs hold land in. By id because names collide
// internationally: Austria also has a Bundesliga, Ukraine a Premier League, Greece and Switzerland a Super League.
export const FOOTBALL_LEAGUES = {
  13: { league: 'Premier League', country: '826' },
  53: { league: 'La Liga', country: '724' },
  31: { league: 'Serie A', country: '380' },
  19: { league: 'Bundesliga', country: '276' },
  16: { league: 'Ligue 1', country: '250' },
  10: { league: 'Eredivisie', country: '528' },
  308: { league: 'Liga Portugal', country: '620' },
  68: { league: 'Süper Lig', country: '792' },
  4: { league: 'Belgian Pro League', country: '056' },
  63: { league: 'Greek Super League', country: '300' },
  319: { league: 'Czech First League', country: '203' },
  50: { league: 'Scottish Premiership', country: 'SCO' },
  1: { league: 'Danish Superliga', country: '208' },
  41: { league: 'Eliteserien', country: '578' },
  332: { league: 'Ukrainian Premier League', country: '804' },
  317: { league: 'Croatian HNL', country: '191' },
  66: { league: 'Ekstraklasa', country: '616' },
  189: { league: 'Swiss Super League', country: '756' },
  80: { league: 'Austrian Bundesliga', country: '040' },
  313: { league: 'Azerbaijan Premier League', country: '031' },
  64: { league: 'Hungarian NB I', country: '348' },
  330: { league: 'Romanian Liga I', country: '642' },
  318: { league: 'Cypriot First Division', country: '196' },
  56: { league: 'Allsvenskan', country: '752' },
  322: { league: 'Veikkausliiga', country: '246' },
  65: { league: 'League of Ireland', country: '372' },
};
// European first-division clubs EA lists under no competition.
export const LEAGUELESS_CLUBS = { 'PFC Ludogorets': { league: 'Bulgarian First League', country: '100' } };

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
