// Sampling helpers shared by every sport's match model. All take an injected
// `rng` so a campaign replays identically from the same seed.

import { selectLineup } from '../data/teams.js';

/** Standard normal via Box-Muller. */
export function gauss(rng) {
  const u = Math.max(Number.EPSILON, 1 - clamp(rng(), 0, 1));
  const v = clamp(rng(), 0, 1);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Inverse Poisson CDF: one random draw, no rejection or unbounded RNG loop. */
export function poisson(rng, lambda) {
  if (!Number.isFinite(lambda) || lambda < 0) throw new RangeError('Poisson rate must be finite and non-negative.');
  if (lambda === 0) return 0;
  // Match rates are small. A normal approximation avoids underflow for other
  // callers using very large rates, without making ordinary goal draws approximate.
  if (lambda > 64) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(rng)));
  const target = clamp(rng(), 0, 1 - Number.EPSILON);
  let probability = Math.exp(-lambda);
  let cumulative = probability;
  let k = 0;
  while (target > cumulative && k < 256) {
    probability *= lambda / ++k;
    const next = cumulative + probability;
    // Floating-point addition can stop just short of 1 at an endpoint draw.
    // The remaining tail is below machine precision, not another 200 goals.
    if (next === cumulative) break;
    cumulative = next;
  }
  return k;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Pick a squad member weighted by position and quality, so the front line scores
 * more than the back line and better players score more than worse ones.
 */
export function pickScorer(rng, team, weights, floor, lineup = selectLineup(team)) {
  return createScorerSampler(lineup, weights, floor)(rng);
}

/** Compute a lineup's scoring weights once, then reuse them for its timeline. */
export function createScorerSampler(lineup, weights, floor) {
  const starters = lineup.starters;
  if (!starters.length) return () => 'Unfilled shirt';
  let total = 0;
  const w = starters.map(p => {
    const x = (weights[p.assignedPos] || 1) * Math.max(1, p.effectiveRating - floor);
    total += x;
    return x;
  });
  return rng => {
    let r = rng() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return starters[i].name;
    }
    return starters.at(-1).name;
  };
}

/** Distinct minutes within a period length, so no two events share a clock. */
export function minuteSampler(rng, periodLength) {
  if (!Number.isInteger(periodLength) || periodLength < 1) throw new RangeError('A period needs a positive whole length.');
  const available = Array.from({ length: periodLength }, (_, i) => i + 1);
  return () => {
    if (!available.length) throw new RangeError('No distinct minutes remain in this period.');
    const index = Math.min(available.length - 1, Math.floor(clamp(rng(), 0, 1) * available.length));
    const m = available[index];
    available[index] = available.at(-1);
    available.pop();
    return m;
  };
}
