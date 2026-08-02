// Sport registry. A sport supplies its own squad shape, roster data, match model
// and vocabulary; everything else in the campaign — territory, targeting, the
// spinner, conquest, autosave — is sport-agnostic.

import { football } from './football.js';
import { basketball } from './basketball.js';

export const SPORTS = { football, basketball };
export const SPORT_LIST = [football, basketball];
export const DEFAULT_SPORT = 'football';

export const getSport = id => SPORTS[id] || SPORTS[DEFAULT_SPORT];
