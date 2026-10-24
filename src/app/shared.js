// Owner: WP-0 (see PLAN.md §4). Frozen constants and helpers shared by App.jsx and the method modules (§1.4, §3.8).
import { C } from '../theme.js';
import { DEFAULT_SPORT, getSport } from '../sports/index.js';
import { domesticScopeId } from '../engine/domestic.js';

export const LOG_CAP = 220;
export const FEED_CAP = 90;
export const BATTLE_SCARS = 7;
export const DEFAULT_SETUP = { sport: DEFAULT_SPORT, layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
  preset: 'standard', seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'spectator',
  managedTeamId: '', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic',
  // Turn modes (DEC D1): the defaults reproduce the original random draw with compass targets.
  turnOrder: 'random', targeting: 'compass',
  // A football data set id (docs/design/football-years.md); null plays the built-in season.
  dataSet: null };

/** The country whose own map a setup or saved campaign is played on, or null for the world. Pure. */
export function domesticIdOf(settings) {
  return settings?.layer === 'clubs' && getSport(settings.sport).id === 'football' ? domesticScopeId(settings.clubScope) : null;
}

/** The data set a setup or saved campaign is played on, or null for the built-in data (country maps use it too). Pure. */
export function dataSetOf(settings) {
  return getSport(settings?.sport).id === 'football' && !domesticIdOf(settings) ? settings?.dataSet ?? null : null;
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
