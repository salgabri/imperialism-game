// Theatre choices for a club campaign on the world board. Football's clubs play Europe's strongest clubs or its elite on a
// map of Europe where a club's land lies in its own country (src/data/europeMaps.js, docs/design/domestic-campaigns.md); the
// world board plays those two only for a set with no such map (a CM 01/02 database built on this computer). Nation
// theatres live in SCOPES in teams.js.
import { nationPriority } from './domesticTiers.js';

/** How many clubs the two theatres field: the built-in season's clubs are exactly the first (scripts/build-clubs.mjs). */
export const TOP_CLUBS = 124;
export const ELITE_CLUBS = 32;

/** A club list's `count` strongest. Equal strengths keep the list's order, so a list always gives the same clubs. */
export const strongestClubs = (clubs, count) => clubs.slice().sort((a, b) => b.str - a.str).slice(0, count);

/**
 * A world campaign's club theatre by name: a set with no Europe maps plays these two theatres, and a campaign saved
 * before there were any played all the game's clubs ('all') or one league, whose id is its name.
 */
export function worldClubTheatreName({ clubScope, dataSet = null } = {}) {
  if (clubScope === 'elite') return `Elite ${ELITE_CLUBS}`;
  if (clubScope && clubScope !== 'all' && !clubScope.startsWith('domestic:')) return clubScope;
  return dataSet == null ? 'All Leagues' : `Top ${TOP_CLUBS}`;
}

const inStrongest = count => (club, i, clubs) => strongestClubs(clubs, count).includes(club);

/**
 * A sport's club theatres on the world board. Football has no league theatres: its two are Europe's strongest clubs and
 * its elite. Another sport with clubs and no map of its own has every club, the elite and each league; one without clubs,
 * none.
 */
export function CLUB_SCOPES(sport) {
  // A sport with no clubs (tennis: nations only) has no club theatre.
  if (!sport?.clubs?.length) return [];
  if (sport?.id === 'football') {
    return [
      {
        id: 'all',
        name: `Top ${TOP_CLUBS}`,
        desc: `Europe's ${TOP_CLUBS} strongest clubs, each on land in its own country.`,
        filter: inStrongest(TOP_CLUBS),
      },
      {
        id: 'elite',
        name: `Elite ${ELITE_CLUBS}`,
        desc: `The ${ELITE_CLUBS} strongest clubs in Europe, each on land in its own country.`,
        filter: inStrongest(ELITE_CLUBS),
      },
    ];
  }
  // Leagues in their countries' priority order (domesticTiers.js), else as the clubs first list them.
  const rank = new Map();
  for (const c of sport.clubs) rank.set(c.league, Math.min(rank.get(c.league) ?? Infinity, nationPriority(c.country)));
  const leagues = [...rank.keys()].sort((a, b) => rank.get(a) - rank.get(b) || 0);
  return [
    {
      id: 'all',
      name: 'All Leagues',
      desc: 'Every club in the game, fighting for the whole map.',
      filter: () => true,
    },
    {
      id: 'elite',
      name: `Elite ${ELITE_CLUBS}`,
      desc: `The ${ELITE_CLUBS} strongest clubs on the board, whatever their league.`,
      filter: inStrongest(ELITE_CLUBS),
    },
    ...leagues.map(league => ({
      id: league,
      name: league,
      desc: `${sport.clubs.filter(c => c.league === league).length} clubs contest their own continent.`,
      filter: c => c.league === league,
    })),
  ];
}
