// Basketball's players: on the page, one chunk with the other smaller sports' players (vite.config.js chunkOf), loaded
// the first time one of them is played (src/sports/sportData.lazy.js).
import { CLUBS as NBA } from '../clubs.basketball.js';
import { CLUBS as EUROLEAGUE } from '../clubs.euroleague.js';

export { ROSTERS } from '../rosters.basketball.js';
/** The NBA's franchises and the EuroLeague's clubs, each league on its own map: they never meet. */
export const CLUBS = [...NBA, ...EUROLEAGUE];
