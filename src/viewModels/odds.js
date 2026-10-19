// Owner: WP-0 (see PLAN.md §4). Shared win-chance helpers (PLAN §3.4) — FROZEN.
// DEC D5: every win chance uses the repo's estimateWinProbability (its own seeded, cached generator),
// never the campaign RNG. Same call shape as App.startMatch, so the estimate cache is shared.
import { estimateWinProbability } from '../engine/odds.js';
import { tacticalMatchParameters } from '../engine/managerStrategy.js';

/** → { attacker, defender, samples, effA, effD } | null */
export function matchupOdds(st, ctx, attackerId, defenderId, { tactic = 'balanced', samples = 512 } = {}) {
  const attacker = st?.teams?.[attackerId];
  const defender = st?.teams?.[defenderId];
  if (!attacker || !defender || attackerId === defenderId || !ctx?.sport) return null;
  try {
    const params = tacticalMatchParameters({ attacker, defender, managedId: ctx.managedId ?? null, tactic, drama: ctx.drama });
    const { effA, effD, drama } = params;
    const odds = estimateWinProbability({ sport: ctx.sport, attacker, defender, drama, effA, effD, samples });
    return { attacker: odds.attacker, defender: odds.defender, samples: odds.samples, effA, effD };
  } catch {
    return null;
  }
}

/** Win chance of `teamId` attacking `opponentId` (fronts, target panel; ED§4b) → number | null. */
export function winChanceFor(st, ctx, teamId, opponentId) {
  return matchupOdds(st, ctx, teamId, opponentId)?.attacker ?? null;
}
