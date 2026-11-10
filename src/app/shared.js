// Owner: WP-0 (see PLAN.md §4). Frozen constants and helpers shared by App.jsx and the method modules (§1.4, §3.8).
import { C } from '../theme.js';
import { DEFAULT_SPORT, getSport } from '../sports/index.js';
import { domesticScope, domesticScopeId } from '../engine/domestic.js';
import { clubMapScope, domesticEntry, hasTheatreMaps, isCountryScope, isEuropeScope, theatreMapsOf, theatreOf } from '../data/domesticScope.js';
import { seasonMapOf, setHasClubs, setHasNations, setSportOf } from '../engine/footballSets.js';

export const LOG_CAP = 220;
export const FEED_CAP = 90;
export const BATTLE_SCARS = 7;
export const DEFAULT_SETUP = { sport: DEFAULT_SPORT, layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
  preset: 'standard', seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'spectator',
  managedTeamId: '', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic',
  // Home advantage: 'on' plays every match at the defender's home; 'off' (the default) at a neutral venue.
  homeAdvantage: 'off',
  // Turn modes (DEC D1): the defaults reproduce the original random draw with compass targets.
  turnOrder: 'random', targeting: 'compass',
  // An earlier season's data set id (docs/design/football-years.md); null plays the built-in season.
  dataSet: null };

/**
 * The map a setup or saved campaign is played on instead of the world: a country's or a Europe map (football clubs), a
 * Europe map or the NWSL's USA (women's football clubs), or a sport's own (basketball clubs: the NBA's USA and Canada),
 * or null for the world. Pure.
 */
export function domesticIdOf(settings) {
  const id = settings?.layer === 'clubs' ? domesticScopeId(settings.clubScope) : null;
  if (!id) return null;
  const own = domesticEntry(settings.clubScope);
  return (own?.sport ?? 'football') === getSport(settings.sport).id ? id : null;
}

/**
 * The data set a setup or saved campaign is played on, or null for the built-in data. A set plays in its own sport: a
 * football season on its Europe maps, or the world for a set without them (country maps use the built-in data, and so
 * do clubs with a season of nations only: FIFA 05 and FIFA 06), a
 * basketball season with clubs only, on its era's map, a baseball season with its nations or with its clubs on its
 * era's map, and a women's football season with its nations or with its clubs on its own maps. Pure.
 */
export function dataSetOf(settings) {
  const id = settings?.dataSet ?? null, sport = getSport(settings?.sport).id;
  if (id == null || setSportOf(id) !== sport) return null;
  if (sport === 'football') {
    return (domesticIdOf(settings) && !isEuropeScope(settings.clubScope)) || (settings.layer === 'clubs' && !setHasClubs(id))
      ? null : id;
  }
  // Any other sport's season plays the layer it has: its clubs (on its era's map or its own maps, if it has them), or its
  // nations.
  return (settings.layer === 'clubs' ? setHasClubs(id) : setHasNations(id)) ? id : null;
}

/**
 * The setup's club theatre. A sport with its own map plays only there (American football: the NFL's USA). An earlier
 * season with a map of its era plays there (basketball's NBA seasons). Football's clubs play on Europe's maps, the
 * season's own: its strongest clubs, or its elite; women's football's on Europe's (every club, or the elite) or on the
 * NWSL's USA; basketball's on the NBA's USA and Canada or the EuroLeague's Europe. The theatre carries over between
 * seasons and sports that have it; a league's theatre of before, or a map with no counterpart, falls back to Europe's
 * strongest clubs, or a sport's first map (the NBA's). One country's map stays chosen, with the built-in football data it
 * is built from; a data set brings its own clubs, so it leaves that map for the set's. A set with no maps (a CM 01/02
 * database built on this computer) plays football's two theatres on the world. Shared by App's setup and challenge links.
 */
export function setClubScope(setup) {
  const sportId = getSport(setup.sport).id;
  const dataSet = setup.dataSet != null && setSportOf(setup.dataSet) === sportId ? setup.dataSet : null;
  const era = dataSet != null ? seasonMapOf(dataSet) : null;
  if (era) return domesticScope(era);
  const own = clubMapScope(sportId);
  if (own) return own;
  if (!hasTheatreMaps(sportId)) return domesticEntry(setup.clubScope)?.sport ? 'all' : setup.clubScope;
  if (sportId === 'football' && dataSet == null && isCountryScope(setup.clubScope)) return setup.clubScope;
  const chosen = domesticEntry(setup.clubScope);
  const theatre = chosen ? theatreOf(chosen) : setup.clubScope;
  const maps = theatreMapsOf(sportId, dataSet);
  const map = maps.find(entry => theatreOf(entry) === theatre) || maps.find(entry => theatreOf(entry) === 'all') || maps[0];
  return map ? domesticScope(map.id) : theatre === 'elite' ? 'elite' : 'all';
}

/** A rating delta as an explicitly signed string, plus the colour to show it in. */
export function signed(delta) {
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.05) return { text: '±0.0', color: C.textFaint };
  return {
    text: (rounded > 0 ? '+' : '−') + Math.abs(rounded).toFixed(1),
    color: rounded > 0 ? C.green : C.red,
  };
}
