// Sport registry. A sport supplies its own squad shape, roster data, match model
// and vocabulary; everything else in the campaign — territory, targeting, the
// spinner, conquest, autosave — is sport-agnostic.

import { football } from './football.js';
import { basketball, nbaBasketball } from './basketball.js';
import { americanFootball } from './americanFootball.js';

export const SPORTS = { football, basketball, 'american-football': americanFootball };
export const SPORT_LIST = [football, basketball, americanFootball];
export const DEFAULT_SPORT = 'football';

export const getSport = id => SPORTS[id] || SPORTS[DEFAULT_SPORT];

/**
 * The sport a campaign's matches are played under, from its settings or a setup (`sport`, `layer`). Basketball's
 * clubs are NBA franchises and play NBA rules; its nations play FIBA's. Every other sport has one rulebook.
 */
export function matchSport(settings) {
  const sport = getSport(settings?.sport);
  return sport === basketball && settings?.layer === 'clubs' ? nbaBasketball : sport;
}
