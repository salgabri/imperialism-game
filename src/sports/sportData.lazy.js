// The page's players (`#sport-data` in browser builds, package.json "imports"). Football's, the default setup's, come
// with the first download; every other sport's rosters and clubs (src/data/players/) load the first time that sport is
// played (sportData.js `loadSportData`). Women's football's are a chunk of their own; the seven smaller sports' share
// one, so a first visit's worker fetches one file for them, not seven (vite.config.js chunkOf).
import { ROSTERS } from '../data/rosters.js';
import { CLUBS } from '../data/clubs.football.js';

/** Sport id → its players, here from the start. */
export const EAGER = { football: { rosters: ROSTERS, clubs: CLUBS } };

const players = load => () => load().then(module => ({
  ...(module.ROSTERS ? { rosters: module.ROSTERS } : {}),
  ...(module.CLUBS ? { clubs: module.CLUBS } : {}),
}));

/** Sport id → a function loading its players (two chunks between them, see above). */
export const LOADERS = {
  'womens-football': players(() => import('../data/players/womens-football.js')),
  basketball: players(() => import('../data/players/basketball.js')),
  'american-football': players(() => import('../data/players/american-football.js')),
  baseball: players(() => import('../data/players/baseball.js')),
  hockey: players(() => import('../data/players/hockey.js')),
  tennis: players(() => import('../data/players/tennis.js')),
  'womens-tennis': players(() => import('../data/players/womens-tennis.js')),
  'rugby-league': players(() => import('../data/players/rugby-league.js')),
  'rocket-league': players(() => import('../data/players/rocket-league.js')),
};
