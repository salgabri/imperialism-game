import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.js';
import { clamp, gauss, minuteSampler, pickScorer, poisson } from '../engine/random.js';

const MINUTES = 90;
/** Chances fall to the front line, and to quality above a 55-rating floor. */
const SCORER_WEIGHTS = { FW: 5, MF: 2.4, DF: 0.7, GK: 0.06 };

/** Sudden death after five kicks each; a stronger keeper drags the other side down. */
function shootout(rng, attacker, defender) {
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

export const football = {
  id: 'football',
  name: 'Football',
  blurb: 'Eleven a side, ninety minutes. Low scores, high drama — level games go to penalties.',
  rosters: ROSTERS,

  squadSize: 11,
  formation: { GK: 1, DF: 4, MF: 4, FW: 2 },
  positionPlan: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  positionColors: { GK: C.gold, DF: C.cyan, MF: C.green, FW: C.red },

  /** Hand-tuned national strength for the nations with no dataset entry. */
  fallbackStrength: (rec, confMeta) => rec[4] || confMeta[rec[2]].baseStr,
  requiredPositions: ['GK'],

  clock: { length: MINUTES, msPerUnit: 46 },
  tieBreak: 'shootout',
  labels: {
    score: 'GOALS',
    start: 'KICK-OFF…',
    live: 'LIVE',
    end: 'FULL TIME',
    tie: 'PENALTIES',
    tieShort: 'PENS',
  },

  /** `Q`-free: football events are simply minute-stamped goals. */
  formatEvent: (e, code) => ({ when: `${e.m}'`, text: `GOAL — ${e.name} (${code})` }),
  formatToast: e => `${e.m}' GOAL — ${e.name.toUpperCase()}`,

  simulate(rng, attacker, defender, drama, effA, effD) {
    const perf = effA - effD + gauss(rng) * drama;
    const lamA = clamp(1.42 + perf * 0.105, 0.22, 4.4);
    const lamD = clamp(1.42 - perf * 0.105, 0.22, 4.4);
    const ga = poisson(rng, lamA);
    const gd = poisson(rng, lamD);

    const minute = minuteSampler(rng, MINUTES);
    const ev = [];
    for (let i = 0; i < ga; i++) {
      ev.push({ m: minute(), tid: attacker.id, name: pickScorer(rng, attacker, SCORER_WEIGHTS, 55), pts: 1 });
    }
    for (let i = 0; i < gd; i++) {
      ev.push({ m: minute(), tid: defender.id, name: pickScorer(rng, defender, SCORER_WEIGHTS, 55), pts: 1 });
    }
    ev.sort((x, y) => x.m - y.m);

    let tie = null;
    let winner;
    if (ga === gd) {
      tie = shootout(rng, attacker, defender);
      winner = tie.ga > tie.gd ? attacker.id : defender.id;
    } else {
      winner = ga > gd ? attacker.id : defender.id;
    }
    return { ga, gd, ev, tie, winner };
  },
};
