// Sampling helpers shared by every sport's match model. All take an injected
// `rng` so a campaign replays identically from the same seed.

/** Standard normal via Box-Muller. */
export function gauss(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Poisson draw by Knuth's method — fine at the small lambdas a scoreline uses. */
export function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Pick a squad member weighted by position and quality, so the front line scores
 * more than the back line and better players score more than worse ones.
 */
export function pickScorer(rng, team, weights, floor) {
  let total = 0;
  const w = team.squad.map(p => {
    const x = (weights[p.pos] || 1) * Math.max(1, p.rating - floor);
    total += x;
    return x;
  });
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return team.squad[i].name;
  }
  return team.squad[0].name;
}

/** Distinct minutes within a period length, so no two events share a clock. */
export function minuteSampler(rng, periodLength) {
  const used = new Set();
  return () => {
    let m;
    do {
      m = 1 + Math.floor(rng() * periodLength);
    } while (used.has(m));
    used.add(m);
    return m;
  };
}
