// Display helpers for a domestic club scope ('domestic:<nation id>'), shared by
// the setup screen, titles, saved-campaign previews and the command bar.
import { DOMESTIC } from './domestic.js';
import { domesticScopeId, isDomesticScope } from '../engine/domestic.js';

export { isDomesticScope, domesticScopeId };

/** The index entry for a domestic scope, or null (unknown or not domestic). */
export function domesticEntry(scope) {
  const id = domesticScopeId(scope);
  return id ? DOMESTIC.find(entry => entry.id === id) || null : null;
}

/** "England · top 100 clubs"; a save for a country no longer shipped still reads sensibly. */
export function domesticLabel(scope) {
  const entry = domesticEntry(scope);
  if (entry) return `${entry.name} · top ${entry.clubs} clubs`;
  return isDomesticScope(scope) ? 'One country · top clubs' : null;
}
