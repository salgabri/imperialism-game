// The page's players (`#sport-data` in browser builds, package.json "imports"). Football's, the default setup's, come
// with the first download; every other sport's rosters and clubs are one chunk of their own (src/data/players/),
// loaded the first time that sport is played (sportData.js `loadSportData`).
import { ROSTERS } from '../data/rosters.js';
import { CLUBS } from '../data/clubs.football.js';

/** Sport id → its players, here from the start. */
export const EAGER = { football: { rosters: ROSTERS, clubs: CLUBS } };

const players = load => () => load().then(module => ({
  ...(module.ROSTERS ? { rosters: module.ROSTERS } : {}),
  ...(module.CLUBS ? { clubs: module.CLUBS } : {}),
}));

/** Sport id → a function loading its players (each a separate chunk). */
export const LOADERS = {
  'womens-football': players(() => import('../data/players/womens-football.js')),
  basketball: players(() => import('../data/players/basketball.js')),
  'american-football': players(() => import('../data/players/american-football.js')),
  baseball: players(() => import('../data/players/baseball.js')),
  hockey: players(() => import('../data/players/hockey.js')),
  tennis: players(() => import('../data/players/tennis.js')),
  'womens-tennis': players(() => import('../data/players/womens-tennis.js')),
  'rugby-league': players(() => import('../data/players/rugby-league.js')),
};
