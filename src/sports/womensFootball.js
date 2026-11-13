import { HISTORIC_NATIONS, NATIONS } from '../data/teams.js';
import { football } from './football.js';
import { defineSportData } from './sportData.js';

/** What a nation counts for when no player of hers is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

/**
 * The women's game: football's rulebook, match model and squad shape, with its own players. Nothing here is invented, so
 * a nation with no rated player fields no team and her land stays neutral; the rest of the game reads `territory`
 * as it does an earlier football season's. Every season it has, 2015/16 to the built-in one, settles a level game as
 * today's men's game does: extra time, then penalties (football's own rules, so it has no `rulesFor`). Version 2:
 * extra time (version 1 went straight to penalties).
 */
export const womensFootball = defineSportData({
  ...football,
  id: 'womens-football',
  simulationVersion: 2,
  name: "Women's football",
  blurb: 'Eleven a side, ninety minutes, the women\'s game. Low scores, high drama — level games go to extra time, then penalties.',
  rulesFor: undefined,
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  territory: undefined,
  fallbackStrength: () => EMPTY_STRENGTH,
}, { territoryOf: rosters => ({ merged: {}, inactive: Object.keys(NATIONS).filter(id => !HISTORIC_NATIONS.includes(id) && !Object.hasOwn(rosters, id)) }) });
