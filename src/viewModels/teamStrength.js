// A team's strength (teamEff, a lineup search) for the views, worked out once per team object. Committed teams are
// replaced whenever their squad changes, never edited in place (applyConquest copies both sides before it moves a
// player), so the Ledger's standings, the Strength map, the target panel and the spectator panel search lineups again
// only for the teams the last matches replaced, not for every survivor on every open (170 searches in a World War,
// 3–8 ms by sport). Gameplay calls teamEff itself: nothing it decides, and no draw of the campaign RNG, reads this cache.
// Pure: no window, document or timers (PLAN §0.9).
import { teamEff } from '../data/teams.js';

const strengths = new WeakMap();

/**
 * teamEff(team), once per team object. The squad check (the same array, as long as before) only guards code that pushes
 * to a squad it already showed. Throws as teamEff does, and a throw is never cached: each caller keeps its own fallback.
 */
export function viewTeamEff(team) {
  if (team === null || typeof team !== 'object') return teamEff(team);
  const known = strengths.get(team);
  if (known && known.squad === team.squad && known.length === team.squad?.length) return known.value;
  const value = teamEff(team);
  strengths.set(team, { squad: team.squad, length: team.squad?.length, value });
  return value;
}
