// Every sport's players from the start: what `#sport-data` (package.json "imports") gives Node, so the tests and
// scripts read every sport at once, as they always have. The page gets sportData.lazy.js instead.
import { ROSTERS as FOOTBALL } from '../data/rosters.js';
import { CLUBS as FOOTBALL_CLUBS } from '../data/clubs.football.js';
import { ROSTERS as WOMENS_FOOTBALL } from '../data/rosters.womens-football.js';
import { CLUBS as WOMENS_CLUBS } from '../data/clubs.womens-football.js';
// The NBA's franchises and the EuroLeague's clubs in one list: the very array the page's basketball chunk holds.
import { ROSTERS as BASKETBALL, CLUBS as BASKETBALL_CLUBS } from '../data/players/basketball.js';
import { CLUBS as NFL_CLUBS } from '../data/clubs.american-football.js';
import { ROSTERS as BASEBALL } from '../data/rosters.baseball.js';
import { CLUBS as MLB_CLUBS } from '../data/clubs.baseball.js';
import { ROSTERS as HOCKEY } from '../data/rosters.hockey.js';
import { CLUBS as NHL_CLUBS } from '../data/clubs.hockey.js';
import { ROSTERS as TENNIS } from '../data/rosters.tennis.js';
import { ROSTERS as WOMENS_TENNIS } from '../data/rosters.womens-tennis.js';
import { ROSTERS as RUGBY_LEAGUE } from '../data/rosters.rugby-league.js';
import { CLUBS as NRL_CLUBS } from '../data/clubs.rugby-league.js';

/** Sport id → its players: `rosters` and `clubs`, each only where the sport reads them from its players. */
export const EAGER = {
  football: { rosters: FOOTBALL, clubs: FOOTBALL_CLUBS },
  'womens-football': { rosters: WOMENS_FOOTBALL, clubs: WOMENS_CLUBS },
  basketball: { rosters: BASKETBALL, clubs: BASKETBALL_CLUBS },
  'american-football': { clubs: NFL_CLUBS },
  baseball: { rosters: BASEBALL, clubs: MLB_CLUBS },
  hockey: { rosters: HOCKEY, clubs: NHL_CLUBS },
  tennis: { rosters: TENNIS },
  'womens-tennis': { rosters: WOMENS_TENNIS },
  'rugby-league': { rosters: RUGBY_LEAGUE, clubs: NRL_CLUBS },
};

/** Nothing to load: every sport is here. */
export const LOADERS = {};
