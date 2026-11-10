// Display helpers for a domestic club scope ('domestic:<nation id>', a sport's own map such as 'domestic:nba', or a
// Europe map such as 'domestic:eu124'), shared by the setup screen, titles, saved-campaign previews and the command bar.
import { DOMESTIC } from './domestic.js';
import { CLUB_MAPS } from './clubMaps.js';
import { EUROPE_MAPS } from './europeMaps.js';
import { domesticScope, domesticScopeId, isDomesticScope } from '../engine/domestic.js';

export { isDomesticScope, domesticScopeId };

/** The index entry for a domestic scope, or null (unknown or not domestic). */
export function domesticEntry(scope) {
  const id = domesticScopeId(scope);
  return id ? DOMESTIC.find(entry => entry.id === id) || CLUB_MAPS.find(entry => entry.id === id)
    || EUROPE_MAPS.find(entry => entry.id === id) || null : null;
}

/**
 * The map a sport's clubs always play on (basketball: the NBA's USA and Canada), or null. An earlier season names its
 * own era's map (`mapId`, a basketball season's `clubMap`).
 */
export const clubMapOf = (sportId, mapId = null) => CLUB_MAPS.find(entry => entry.sport === sportId
  && (mapId == null ? entry.seasons == null : entry.id === mapId)) || null;

/** That map's club theatre ('domestic:nba'), or null. */
export function clubMapScope(sportId) {
  const map = clubMapOf(sportId);
  return map ? domesticScope(map.id) : null;
}

/**
 * Every map a sport's clubs play on in a season, as its club theatres list them: its own (`clubMapOf`), then, in the
 * built-in season, its other leagues' maps of Europe (basketball's EuroLeague: a Europe map with no football `theatre`).
 */
export function clubMapsOf(sportId, mapId = null) {
  const own = clubMapOf(sportId, mapId);
  const more = mapId == null ? EUROPE_MAPS.filter(entry => entry.sport === sportId && !entry.theatre && entry.seasons == null) : [];
  return [own, ...more].filter(Boolean);
}

/**
 * Whether a scope is one of a sport's own maps of the built-in season (the NBA's, the EuroLeague's), which a setup keeps
 * while it plays that season.
 */
export function isBuiltInClubMap(scope, sportId) {
  const entry = domesticEntry(scope);
  return !!entry && clubMapsOf(sportId).includes(entry);
}

/**
 * The Europe map of a football theatre ('all' or 'elite') in a season (`dataSet`: an earlier season's id, or null for the
 * built-in one), or null: a CM 01/02 set built on this computer has none.
 */
export const europeMapOf = (theatre, dataSet = null) => EUROPE_MAPS.find(entry => entry.theatre === theatre
  && (dataSet == null ? entry.seasons == null : !!entry.seasons?.includes(dataSet))) || null;

/** A season's Europe maps, the strongest clubs first: what its club theatres list. */
export const europeMapsOf = (dataSet = null) => ['all', 'elite'].map(theatre => europeMapOf(theatre, dataSet)).filter(Boolean);

/** Whether a scope is a Europe map's, of any season. */
export const isEuropeScope = scope => !!domesticEntry(scope)?.theatre;

/**
 * Whether a scope is one country's own map (football's 'domestic:826'): a theatre a session length leaves as it is,
 * played only with the built-in data. An id the index no longer lists counts too: a saved country no longer shipped.
 */
export function isCountryScope(scope) {
  if (!isDomesticScope(scope)) return false;
  const entry = domesticEntry(scope);
  return !entry || !entry.sport;
}

/** "England · top 100 clubs", "NBA · USA and Canada", "Top 124 · Europe"; a save for a country no longer shipped still reads sensibly. */
export function domesticLabel(scope) {
  const entry = domesticEntry(scope);
  if (entry) return entry.league ? `${entry.league} · ${entry.name}` : `${entry.name} · top ${entry.clubs} clubs`;
  return isDomesticScope(scope) ? 'One country · top clubs' : null;
}
