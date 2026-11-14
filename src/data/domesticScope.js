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

// The sports whose clubs choose between maps: Europe's strongest clubs and its elite (football), and for women's
// football the NWSL's USA too (its entry in CLUB_MAPS); basketball's NBA (USA and Canada) and its EuroLeague (Europe).
const THEATRE_SPORTS = new Set(EUROPE_MAPS.map(entry => entry.sport));
/** Whether a sport's clubs choose between maps (`theatreMapsOf`) rather than always playing one (`clubMapOf`). */
export const hasTheatreMaps = sportId => THEATRE_SPORTS.has(sportId);

/**
 * Whether a map is a season's (`dataSet`: an earlier season's id, or null for the built-in one) for a new campaign. One
 * another has replaced (`replacedBy`: a season's seven-league map of before its clubs came from all of Europe) serves
 * only the campaigns saved on it (src/engine/footballSets.js isSeasonTheatreMap).
 */
const servesSeason = (entry, dataSet) => !entry.replacedBy && (dataSet == null ? entry.seasons == null : !!entry.seasons?.includes(dataSet));

/**
 * The map a sport's clubs always play on (basketball: the NBA's USA and Canada), or null. An earlier season names its
 * own era's map (`mapId`, a basketball season's `clubMap`). A sport whose clubs choose between maps has none.
 */
export const clubMapOf = (sportId, mapId = null) => (hasTheatreMaps(sportId) ? null : CLUB_MAPS.find(entry => entry.sport === sportId
  && (mapId == null ? entry.seasons == null : entry.id === mapId)) || null);

/** That map's club theatre ('domestic:nba'), or null. */
export function clubMapScope(sportId) {
  const map = clubMapOf(sportId);
  return map ? domesticScope(map.id) : null;
}

/**
 * The Europe map of a theatre ('all' or 'elite') in a sport (football unless named) and season (`dataSet`: an earlier
 * season's id, or null for the built-in one), or null: a CM 01/02 set built on this computer has none.
 */
export const europeMapOf = (theatre, dataSet = null, sportId = 'football') => EUROPE_MAPS.find(entry => entry.sport === sportId
  && entry.theatre === theatre && servesSeason(entry, dataSet)) || null;

/** A season's Europe maps, the strongest clubs first: what football's club theatres list. */
export const europeMapsOf = (dataSet = null, sportId = 'football') => ['all', 'elite'].map(theatre => europeMapOf(theatre, dataSet, sportId)).filter(Boolean);

/** The theatre a map is: a Europe map's ('all' or 'elite'), else its league's ('NWSL', 'NBA'); null for a country's. */
export const theatreOf = entry => entry?.theatre ?? entry?.league ?? null;

/**
 * The maps a sport's clubs choose between in a season, in the setup's order: Europe's strongest clubs and its elite,
 * then a league on a map of its own (women's football: the NWSL's USA; basketball: the NBA's USA and Canada, or an
 * earlier season's map of its era), then a league on a map of Europe (basketball's EuroLeague: a Europe map with no
 * `theatre`, its theatre its league). Empty for a sport whose clubs always play one map (`clubMapOf`) or the world, and
 * for a season without maps (a CM 01/02 set built here).
 */
export const theatreMapsOf = (sportId, dataSet = null) => (hasTheatreMaps(sportId)
  ? [...europeMapsOf(dataSet, sportId), ...CLUB_MAPS.filter(entry => entry.sport === sportId && servesSeason(entry, dataSet)),
    ...EUROPE_MAPS.filter(entry => entry.sport === sportId && !entry.theatre && servesSeason(entry, dataSet))] : []);

/** Whether a map is one a sport's clubs choose between (`theatreMapsOf`), of any season. */
export const isTheatreMap = entry => !!entry && hasTheatreMaps(entry.sport);

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

/**
 * "England · top 100 clubs", "NBA · USA and Canada", "Top 124 · Europe", and "Europe" alone for a theatre named after its
 * map (women's football's every European club); a save for a country no longer shipped still reads sensibly.
 */
export function domesticLabel(scope) {
  const entry = domesticEntry(scope);
  if (entry) return entry.league ? (entry.league === entry.name ? entry.name : `${entry.league} · ${entry.name}`) : `${entry.name} · top ${entry.clubs} clubs`;
  return isDomesticScope(scope) ? 'One country · top clubs' : null;
}
