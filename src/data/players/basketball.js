// Basketball's players: a chunk of its own on the page (src/sports/sportData.lazy.js),
// loaded the first time the sport is played.
import { CLUBS as NBA } from '../clubs.basketball.js';
import { CLUBS as EUROLEAGUE } from '../clubs.euroleague.js';

export { ROSTERS } from '../rosters.basketball.js';
/** The NBA's franchises and the EuroLeague's clubs, each league on its own map: they never meet. */
export const CLUBS = [...NBA, ...EUROLEAGUE];
