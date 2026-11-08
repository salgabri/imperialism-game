import { ROSTERS } from '../data/rosters.womens-tennis.js';
import { tennisSport, WTA } from './tennis.js';

/**
 * The women's game (docs/design/womens-tennis.md): the Billie Jean King Cup, whose qualifiers and play-offs play the
 * Davis Cup's five rubbers in the Davis Cup's order, with the WTA's players rated by Tennis Abstract's Elo and the WTA's
 * serve. Nothing here is invented, so a nation with fewer than two rated players fields no team and its land stays
 * neutral.
 */
export const womensTennis = tennisSport({
  id: 'womens-tennis',
  name: "Women's tennis",
  blurb: 'Billie Jean King Cup ties: four singles and a doubles over two days, first to three rubbers. Every match is best of three sets.',
  rosters: ROSTERS,
  tour: WTA,
});
