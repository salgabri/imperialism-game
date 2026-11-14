import { HISTORIC_NATIONS, NATIONS } from '../data/teams.js';
import { football, footballUnderRules } from './football.js';
import { rulesMemo, rulesYear } from './eras.js';
import { defineSportData } from './sportData.js';

/** What a nation counts for when no player of hers is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

/**
 * How a women's season ending in `year` settles a game still level after extra time (football.js KNOCKOUTS): 'golden'
 * from 1996/97 to 2003/04, else 'penalties', as today's game does (the built-in season, null, too). FIFA's women's
 * tournaments played the golden goal from the 1996 Olympic tournament, which MacMillan's 100th-minute goal against Norway
 * settled a semi-final of, to the 2003 World Cup, whose final Künzer's was "the last golden goal in FIFA Women's World Cup
 * history"; the 1995 World Cup played both halves of extra time, then penalties, and in February 2004 the IFAB took the
 * golden goal out of the Laws after Euro 2004, before the Olympic tournament of August 2004. Each read 2026-11-14 at
 * https://en.wikipedia.org/w/index.php?oldid=<revision>: "Football at the 1996 Summer Olympics – Women's tournament"
 * 1371348622, "2003 FIFA Women's World Cup knockout stage" 1385538331, "1995 FIFA Women's World Cup knockout stage"
 * 1385546057, "Golden goal" 1384247203. The seasons are the computed World Cups' and Olympic tournaments'
 * (docs/design/womens-football.md, "Computed seasons") and EA's, from 2015/16.
 */
export function womensKnockoutIn(year) {
  return Number.isInteger(year) && year >= 1997 && year <= 2004 ? 'golden' : 'penalties';
}

/**
 * The women's game: football's rulebook, match model and squad shape, with its own players. Nothing here is invented, so
 * a nation with no rated player fields no team and her land stays neutral; the rest of the game reads `territory`
 * as it does an earlier football season's. A level game goes to extra time, then to its season's tie-break
 * (`womensKnockoutIn`: the golden goal in 1996/97 to 2003/04, penalties in every other season). Version 2: extra time
 * (version 1 went straight to penalties).
 */
export const womensFootball = defineSportData({
  ...football,
  id: 'womens-football',
  simulationVersion: 2,
  name: "Women's football",
  blurb: 'Eleven a side, ninety minutes, the women\'s game. Low scores, high drama — level games go to extra time, then penalties.',
  /** The rules a campaign plays (matchSport): its season's tie-break (`womensKnockoutIn`), one object per set of rules. */
  rulesFor: settings => womensFootballIn(rulesYear(settings)),
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: undefined,
  territory: undefined,
  fallbackStrength: () => EMPTY_STRENGTH,
}, { territoryOf: rosters => ({ merged: {}, inactive: Object.keys(NATIONS).filter(id => !HISTORIC_NATIONS.includes(id) && !Object.hasOwn(rosters, id)) }) });

const womensFootballUnder = rulesMemo(id => (id === 'penalties' ? womensFootball : footballUnderRules(womensFootball, id)));

/** Women's football as a season ending in `year` played it (null for the built-in season, today's rules). */
export const womensFootballIn = year => womensFootballUnder(womensKnockoutIn(year));
