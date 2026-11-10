// Theatre choices for a club campaign on the world board. Football's clubs play Europe's strongest clubs or its elite on a
// map of Europe where a club's land lies in its own country (src/data/europeMaps.js, docs/design/domestic-campaigns.md); the
// world board plays those two only for a set with no such map (a CM 01/02 database built on this computer). Women's
// football's play every European club or the elite on maps of Europe, or the NWSL on its own USA (src/data/clubMaps.js).
// Nation theatres live in SCOPES in teams.js; which of them a sport offers is decided here (`nationTheatres`).
import { nationPriority } from './domesticTiers.js';
import { NATIONS, SCOPES } from './teams.js';
import { fieldedNations } from '../engine/footballSets.js';

/** How many of a continent's nations must field a team, each a real side (footballSets.js `fieldedNations`), for a sport to offer it. */
export const MIN_REAL_SIDES = 4;
/** The Elite theatre's size: a sport offers it once that many nations field a team. */
export const ELITE_NATIONS = 32;

const nationTheatreCache = new WeakMap();
/**
 * A sport's nation theatres (a sport object: a season's once it has loaded). A sport is offered where it is played.
 * The world is always offered, whole. A continent needs MIN_REAL_SIDES of its nations to field a real side, so none is
 * empty, one team's walkover or a field of generated players (rugby league in Africa); the Elite 32 needs 32 real sides.
 * `fallback` stands in for a theatre the sport lacks: its heartland, the offered continent with the most real sides
 * (the first in SCOPES's order of equals), else the world. Campaigns already launched keep theirs: SCOPES names them all.
 */
function theatresOf(sport) {
  if (!nationTheatreCache.has(sport)) {
    // Only nations with a real side field a team.
    const real = fieldedNations(sport);
    const sides = scope => real.filter(id => scope.filter({ conf: NATIONS[id][2] })).length;
    const offered = Object.freeze(SCOPES.filter(scope => scope.id === 'world'
      || (scope.id === 'elite' ? real.length >= ELITE_NATIONS : sides(scope) >= MIN_REAL_SIDES)));
    const heartland = offered.filter(scope => scope.id !== 'world' && scope.id !== 'elite')
      .reduce((best, scope) => (!best || sides(scope) > sides(best) ? scope : best), null);
    nationTheatreCache.set(sport, { offered, fallback: heartland || offered[0] });
  }
  return nationTheatreCache.get(sport);
}

/** The nation theatres `sport` offers, as SCOPES entries in their order (`theatresOf`). */
export const nationTheatres = sport => theatresOf(sport).offered;

/**
 * The nation theatre a setup's choice (`id`) plays in `sport`: that theatre if the sport offers it, else the sport's
 * heartland (`theatresOf`). The choice itself stays in the setup, so it comes back with a sport that offers it.
 */
export function nationTheatre(sport, id) {
  const { offered, fallback } = theatresOf(sport);
  return offered.find(scope => scope.id === id) || fallback;
}

/** How many clubs the two theatres field: the built-in season's clubs are exactly the first (scripts/build-clubs.mjs). */
export const TOP_CLUBS = 124;
export const ELITE_CLUBS = 32;

/** A club list's `count` strongest. Equal strengths keep the list's order, so a list always gives the same clubs. */
export const strongestClubs = (clubs, count) => clubs.slice().sort((a, b) => b.str - a.str).slice(0, count);

/** Whether a club is European, by the confederation of its country: women's football's play Europe's maps, the NWSL's its own. */
export const isEuropeanClub = club => NATIONS[club.country]?.[2] === 'UEFA';

/**
 * A world campaign's club theatre by name: a football set with no Europe maps plays these two theatres, and a campaign
 * saved before there were any (women's football's before 9 November 2026, of any season) played all the game's clubs
 * ('all') or one league, whose id is its name.
 */
export function worldClubTheatreName({ clubScope, dataSet = null, sport = 'football' } = {}) {
  if (clubScope === 'elite') return `Elite ${ELITE_CLUBS}`;
  if (clubScope && clubScope !== 'all' && !clubScope.startsWith('domestic:')) return clubScope;
  return dataSet == null || sport !== 'football' ? 'All Leagues' : `Top ${TOP_CLUBS}`;
}

const inStrongest = count => (club, i, clubs) => strongestClubs(clubs, count).includes(club);

/**
 * A sport's club theatres on the world board. Football has no league theatres: its two are Europe's strongest clubs and
 * its elite. Women's football's clubs play the same two among Europe's clubs, and the NWSL's apart: in setup each is a
 * map of its own (src/data/europeMaps.js, clubMaps.js), and these ids name them. Another sport with clubs and no map of
 * its own has every club, the elite and each league; one without clubs, none.
 */
export function CLUB_SCOPES(sport) {
  // A sport with no clubs (tennis: nations only) has no club theatre.
  if (!sport?.clubs?.length) return [];
  if (sport?.id === 'womens-football') {
    const leagues = [...new Set(sport.clubs.filter(club => !isEuropeanClub(club)).map(club => club.league))];
    return [
      {
        id: 'all',
        name: 'Europe',
        desc: 'Every European club, each on land in its own country.',
        filter: isEuropeanClub,
      },
      {
        id: 'elite',
        name: `Elite ${ELITE_CLUBS}`,
        desc: `The ${ELITE_CLUBS} strongest clubs in Europe, each on land in its own country.`,
        filter: (club, i, clubs) => strongestClubs(clubs.filter(isEuropeanClub), ELITE_CLUBS).includes(club),
      },
      ...leagues.map(league => ({
        id: league,
        name: league,
        desc: `The ${league}'s ${sport.clubs.filter(c => c.league === league).length} clubs, each in its own state.`,
        filter: c => c.league === league,
      })),
    ];
  }
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
