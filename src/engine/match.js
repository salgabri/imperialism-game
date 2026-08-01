// Match simulation. Everything here is driven by an injected `rng` so a campaign
// replays identically from the same seed.

import { teamEff } from '../data/teams.js';

// Who is likely to be on the end of a chance. Weighted toward the front line,
// and toward quality above a 55-rating floor.
const SCORER_WEIGHTS = { FW: 5, MF: 2.4, DF: 0.7, GK: 0.06 };

function gauss(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function pickScorer(rng, team) {
  let total = 0;
  const weights = team.squad.map(p => {
    const w = (SCORER_WEIGHTS[p.pos] || 1) * Math.max(1, p.rating - 55);
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return team.squad[i].name;
  }
  return team.squad[0].name;
}

/**
 * Resolve one match in full. The caller decides how much of it to reveal and how
 * fast — `ev` carries per-minute goals for the live ticker, `pens` is non-null
 * only when regulation ended level.
 */
export function simulateMatch(rng, attacker, defender, drama) {
  const effA = teamEff(attacker);
  const effD = teamEff(defender);
  const perf = effA - effD + gauss(rng) * drama;
  const lamA = Math.min(4.4, Math.max(0.22, 1.42 + perf * 0.105));
  const lamD = Math.min(4.4, Math.max(0.22, 1.42 - perf * 0.105));
  const ga = poisson(rng, lamA);
  const gd = poisson(rng, lamD);

  const used = new Set();
  const minute = () => {
    let m;
    do {
      m = 1 + Math.floor(rng() * 90);
    } while (used.has(m));
    used.add(m);
    return m;
  };
  const ev = [];
  for (let i = 0; i < ga; i++) ev.push({ m: minute(), tid: attacker.id, name: pickScorer(rng, attacker) });
  for (let i = 0; i < gd; i++) ev.push({ m: minute(), tid: defender.id, name: pickScorer(rng, defender) });
  ev.sort((x, y) => x.m - y.m);

  let pens = null;
  let winner;
  if (ga === gd) {
    pens = simulateShootout(rng, attacker, defender);
    winner = pens.ga > pens.gd ? attacker.id : defender.id;
  } else {
    winner = ga > gd ? attacker.id : defender.id;
  }
  return { effA, effD, ga, gd, ev, pens, winner };
}

/** Sudden death after five kicks each; a stronger keeper drags the other side down. */
export function simulateShootout(rng, attacker, defender) {
  const keeper = t => {
    const g = t.squad.filter(p => p.pos === 'GK').sort((x, y) => y.rating - x.rating)[0];
    return g ? g.rating : 70;
  };
  const pa = 0.78 - (keeper(defender) - 74) * 0.006;
  const pd = 0.78 - (keeper(attacker) - 74) * 0.006;
  const A = [];
  const D = [];
  let ga = 0;
  let gd = 0;
  for (let r = 0; r < 20; r++) {
    const sa = rng() < pa ? 1 : 0;
    const sd = rng() < pd ? 1 : 0;
    A.push(sa);
    D.push(sd);
    ga += sa;
    gd += sd;
    if (r >= 4 && ga !== gd) break;
    if (r === 19 && ga === gd) {
      // Hard stop so a coin-flip run cannot loop forever.
      A.push(1);
      D.push(0);
      ga++;
    }
  }
  return { A, D, ga, gd };
}
