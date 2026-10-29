// Display helpers for a domestic club scope ('domestic:<nation id>', or a sport's own
// map such as 'domestic:nba'), shared by the setup screen, titles, saved-campaign
// previews and the command bar.
import { DOMESTIC } from './domestic.js';
import { CLUB_MAPS } from './clubMaps.js';
import { domesticScope, domesticScopeId, isDomesticScope } from '../engine/domestic.js';

export { isDomesticScope, domesticScopeId };

/** The index entry for a domestic scope, or null (unknown or not domestic). */
export function domesticEntry(scope) {
  const id = domesticScopeId(scope);
  return id ? DOMESTIC.find(entry => entry.id === id) || CLUB_MAPS.find(entry => entry.id === id) || null : null;
}

/** The map a sport's clubs always play on (basketball: the NBA's USA and Canada), or null. */
export const clubMapOf = sportId => CLUB_MAPS.find(entry => entry.sport === sportId) || null;

/** That map's club theatre ('domestic:nba'), or null. */
export function clubMapScope(sportId) {
  const map = clubMapOf(sportId);
  return map ? domesticScope(map.id) : null;
}

/** "England · top 100 clubs", "NBA · USA and Canada"; a save for a country no longer shipped still reads sensibly. */
export function domesticLabel(scope) {
  const entry = domesticEntry(scope);
  if (entry) return entry.league ? `${entry.league} · ${entry.name}` : `${entry.name} · top ${entry.clubs} clubs`;
  return isDomesticScope(scope) ? 'One country · top clubs' : null;
}
