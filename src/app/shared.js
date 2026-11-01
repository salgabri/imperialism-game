// Owner: WP-0 (see PLAN.md §4). Frozen constants and helpers shared by App.jsx and the method modules (§1.4, §3.8).
import { C } from '../theme.js';
import { DEFAULT_SPORT, getSport } from '../sports/index.js';
import { domesticScopeId } from '../engine/domestic.js';
import { CLUB_MAPS } from '../data/clubMaps.js';
import { setSportOf } from '../engine/footballSets.js';

export const LOG_CAP = 220;
export const FEED_CAP = 90;
export const BATTLE_SCARS = 7;
export const DEFAULT_SETUP = { sport: DEFAULT_SPORT, layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
  preset: 'standard', seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'spectator',
  managedTeamId: '', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic',
  // Turn modes (DEC D1): the defaults reproduce the original random draw with compass targets.
  turnOrder: 'random', targeting: 'compass',
  // An earlier season's data set id (docs/design/football-years.md); null plays the built-in season.
  dataSet: null };

/**
 * The map a setup or saved campaign is played on instead of the world: a country's (football clubs) or a sport's own
 * (basketball clubs: the NBA's USA and Canada), or null for the world. Pure.
 */
export function domesticIdOf(settings) {
  const id = settings?.layer === 'clubs' ? domesticScopeId(settings.clubScope) : null;
  if (!id) return null;
  const own = CLUB_MAPS.find(map => map.id === id);
  return (own ? own.sport : 'football') === getSport(settings.sport).id ? id : null;
}

/**
 * The data set a setup or saved campaign is played on, or null for the built-in data. A set plays in its own sport:
 * a football season on the world (country maps use the built-in data), a basketball season with clubs only, on its
 * era's map. Pure.
 */
export function dataSetOf(settings) {
  const id = settings?.dataSet ?? null, sport = getSport(settings?.sport).id;
  if (id == null || setSportOf(id) !== sport) return null;
  return (sport === 'football' ? !domesticIdOf(settings) : settings.layer === 'clubs') ? id : null;
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
