import { ROSTERS } from '../data/rosters.womens-football.js';
import { CLUBS } from '../data/clubs.womens-football.js';
import { NATIONS } from '../data/teams.js';
import { football } from './football.js';

/** What a nation counts for when no player of hers is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

/**
 * The women's game: football's rulebook, match model and squad shape, with its own players. Nothing here is invented, so
 * a nation with no rated player fields no team and her land stays neutral; the rest of the game reads `territory`
 * as it does an earlier football season's.
 */
export const womensFootball = {
  ...football,
  id: 'womens-football',
  simulationVersion: 1,
  name: "Women's football",
  blurb: 'Eleven a side, ninety minutes, the women\'s game. Low scores, high drama — level games go to penalties.',
  rosters: ROSTERS,
  clubs: CLUBS,
  territory: { merged: {}, inactive: Object.keys(NATIONS).filter(id => !Object.hasOwn(ROSTERS, id)) },
  fallbackStrength: () => EMPTY_STRENGTH,
};
