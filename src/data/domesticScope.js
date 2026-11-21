// Display helpers for a domestic club scope ('domestic:<nation id>', a sport's own map such as 'domestic:nba', or a
// Europe map such as 'domestic:eu124'), shared by the setup screen, titles, saved-campaign previews and the command bar.
import { DOMESTIC } from './domestic.js';
import { DOMESTIC_SEASON_ROWS } from './domesticSeasons.js';
import { CLUB_MAPS } from './clubMaps.js';
import { EUROPE_MAPS } from './europeMaps.js';
import { BUILT_IN_BASKETBALL_SEASONS } from './basketballSeasons.js';
import { NATIONS } from './teams.js';
import { domesticScope, domesticScopeId, isDomesticScope } from '../engine/domestic.js';
import { SPLIT_MIN_CLUBS, parseSplitId, splitMapId } from '../engine/clubSplit.js';

export { isDomesticScope, domesticScopeId };

/**
 * The earlier football seasons' own country maps (src/data/domesticSeasons.js, docs/design/domestic-campaigns.md "Earlier
 * seasons") as index entries, newest season first: `{ id: '826y2011', country: '826', name, season: the season file's
 * id, year, clubs, sections: 100 }`. A country map of today (DOMESTIC) has no `country` or `season`: its id is its nation.
 */
export const SEASON_COUNTRY_MAPS = Object.freeze(DOMESTIC_SEASON_ROWS.flatMap(([season, year, maps]) => maps.map(([country, clubs]) =>
  Object.freeze({ id: `${country}y${year}`, country, name: NATIONS[country]?.[0] ?? country, season, year, clubs, sections: 100 }))));
const SEASON_MAP_BY_ID = new Map(SEASON_COUNTRY_MAPS.map(entry => [entry.id, entry]));

const COUNTRY_MAP_BY_ID = new Map(DOMESTIC.map(entry => [entry.id, entry]));
const cutEntries = new Map();

/**
 * A country map cut to its first `clubs` clubs (engine/clubSplit.js, docs/design/domestic-campaigns.md "Choosing the
 * number of clubs"), as an index entry: its full map's (`base`), with its own id and club count, `cut` the count and
 * `baseClubs` the full map's. Its strongest clubs (`top`) are known once it has loaded. Null when the count is not one
 * the map can be cut to. One object per id.
 */
function cutEntry(base, clubs) {
  if (!base || base.sport || base.theatre || !Number.isInteger(clubs) || clubs < SPLIT_MIN_CLUBS || clubs >= base.clubs) return null;
  const id = splitMapId(base.id, clubs);
  if (!cutEntries.has(id)) {
    cutEntries.set(id, Object.freeze({ ...base, id, country: base.country ?? base.id, clubs, cut: clubs, base: base.id,
      baseClubs: base.clubs, top: [], version: undefined }));
  }
  return cutEntries.get(id);
}

/** The index entry for a domestic scope, or null (unknown or not domestic). */
export function domesticEntry(scope) {
  const id = domesticScopeId(scope);
  if (!id) return null;
  const split = parseSplitId(id);
  if (split) return cutEntry(COUNTRY_MAP_BY_ID.get(split.base) || SEASON_MAP_BY_ID.get(split.base), split.clubs);
  return COUNTRY_MAP_BY_ID.get(id) || SEASON_MAP_BY_ID.get(id) || CLUB_MAPS.find(entry => entry.id === id)
    || EUROPE_MAPS.find(entry => entry.id === id) || null;
}

/** The nation a country map is of ('826' for today's England and for England's of 2010/11), or null for any other map. */
export const countryOfEntry = entry => (!entry || entry.sport ? null : entry.country ?? entry.id);

/** A country map's full map ('724' for Spain's cut to 20 clubs; any other map is its own). */
export const fullMapOf = entry => (entry?.base ? domesticEntry(domesticScope(entry.base)) : entry);

/**
 * The map of a country (`entry`, a full map or one cut) holding its first `clubs` clubs: that full map cut to them, or
 * the full map itself when `clubs` is null or holds them all (or too few to cut to). Any other map is returned as it is.
 */
export function countryMapWith(entry, clubs) {
  const full = fullMapOf(entry);
  if (!full || full.sport || full.theatre) return entry;
  return (clubs != null && cutEntry(full, clubs)) || full;
}

/** The country maps of a season (null: today's, DOMESTIC), in their index's order. */
export const countryMapsOf = (dataSet = null) => (dataSet == null ? DOMESTIC : SEASON_COUNTRY_MAPS.filter(entry => entry.season === dataSet));

/** A nation's map in a season (null: today's), or null when that season has none of it. */
export const countryMapOf = (nationId, dataSet = null) => countryMapsOf(dataSet).find(entry => countryOfEntry(entry) === nationId) || null;

// The sports whose clubs choose between maps: Europe's strongest clubs and its elite (football), and for women's
// football the NWSL's USA too (its entry in CLUB_MAPS); basketball's NBA (USA and Canada) and its EuroLeague (Europe).
const THEATRE_SPORTS = new Set(EUROPE_MAPS.map(entry => entry.sport));
/** Whether a sport's clubs choose between maps (`theatreMapsOf`) rather than always playing one (`clubMapOf`). */
export const hasTheatreMaps = sportId => THEATRE_SPORTS.has(sportId);

// The NBA map each earlier basketball season plays on: an era's, or today's for the seasons since 2014/15 (`seasons` null).
const BASKETBALL_SEASON_MAPS = new Map(BUILT_IN_BASKETBALL_SEASONS.map(season => [season.id, season.map]));

/**
 * Whether a map is a season's (`dataSet`: an earlier season's id, or null for the built-in one) for a new campaign: one
 * that lists it, or the built-in map an earlier basketball season names as its own (the NBA's seasons since 2014/15 play
 * on today's). One another has replaced (`replacedBy`: a season's seven-league map of before its clubs came from all of
 * Europe) serves only the campaigns saved on it (src/engine/footballSets.js isSeasonTheatreMap).
 */
const servesSeason = (entry, dataSet) => !entry.replacedBy && (dataSet == null ? entry.seasons == null
  : !!entry.seasons?.includes(dataSet) || (entry.seasons == null && BASKETBALL_SEASON_MAPS.get(dataSet) === entry.id));

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
 * `theatre`, its theatre its league; an earlier season's from 2000/01 on, of that season's clubs). Empty for a sport whose
 * clubs always play one map (`clubMapOf`) or the world, and for a season without maps (a CM 01/02 set built here).
 */
export const theatreMapsOf = (sportId, dataSet = null) => (hasTheatreMaps(sportId)
  ? [...europeMapsOf(dataSet, sportId), ...CLUB_MAPS.filter(entry => entry.sport === sportId && servesSeason(entry, dataSet)),
    ...EUROPE_MAPS.filter(entry => entry.sport === sportId && !entry.theatre && servesSeason(entry, dataSet))] : []);

/** Whether a map is one a sport's clubs choose between (`theatreMapsOf`), of any season. */
export const isTheatreMap = entry => !!entry && hasTheatreMaps(entry.sport);

/** Whether a scope is a Europe map's, of any season. */
export const isEuropeScope = scope => !!domesticEntry(scope)?.theatre;

/**
 * Whether a scope is one country's own map (football's 'domestic:826', or 'domestic:826y2011' of an earlier season): a
 * theatre a session length leaves as it is, played with the data it is built from (today's FM 26 clubs, or that season's
 * own). An id the index no longer lists counts too: a saved country no longer shipped.
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
