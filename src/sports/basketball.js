import { C } from '../theme.js';
import { ROSTERS } from '../data/rosters.basketball.js';
import { CLUBS } from '../data/clubs.basketball.js';
import { clamp, gauss, pickScorer } from '../engine/random.js';

const MINUTES = 40; // FIBA: four ten-minute quarters
const QUARTER = 10;
const OVERTIME = 5;

/** Guards and wings carry the scoring load; the floor is lower than football's. */
const SCORER_WEIGHTS = { SG: 2.8, SF: 2.5, PG: 2.3, PF: 2.0, C: 1.8 };

// A basket-by-basket ticker would fire eighty events in a few seconds, so scoring
// is logged as runs — a real basketball unit, and readable at speed.
const MIN_RUN = 2;
const MAX_RUN = 9;

/** Split a final score into plausible scoring runs. */
function toRuns(rng, total) {
  const runs = [];
  let left = total;
  while (left > 0) {
    const size = Math.min(left, MIN_RUN + Math.floor(rng() * (MAX_RUN - MIN_RUN + 1)));
    // Never strand a single point: basketball has no one-point field goal.
    runs.push(left - size === 1 ? size + 1 : size);
    left -= runs[runs.length - 1];
  }
  return runs;
}

export const basketball = {
  id: 'basketball',
  name: 'Basketball',
  blurb: 'Starting fives, forty minutes. Scores in the eighties — level games go to overtime.',
  rosters: ROSTERS,
  clubs: CLUBS,

  squadSize: 5,
  formation: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  positionPlan: ['PG', 'SG', 'SF', 'PF', 'C'],
  positionColors: { PG: C.gold, SG: C.cyan, SF: C.green, PF: C.red, C: '#B07CD8' },

  // Nations outside the curated list are basketball minnows, well below the
  // forty federations that field real players.
  fallbackStrength: (rec, confMeta) => Math.max(40, confMeta[rec[2]].baseStr - 8),
  requiredPositions: [],

  clock: { length: MINUTES, msPerUnit: 95 },
  tieBreak: 'overtime',
  labels: {
    score: 'POINTS',
    start: 'TIP-OFF…',
    live: 'LIVE',
    end: 'FINAL',
    tie: 'OVERTIME',
    tieShort: 'OT',
  },

  formatEvent: (e, code) => ({
    when: e.m > MINUTES ? 'OT' : `Q${Math.min(4, Math.ceil(e.m / QUARTER))}`,
    text: `+${e.pts} — ${e.name} (${code})`,
  }),
  formatToast: e => `+${e.pts} ${e.name.toUpperCase()}`,

  simulate(rng, attacker, defender, drama, effA, effD) {
    // Both sides share the game's pace, then the rating gap splits the points.
    const pace = 168 + gauss(rng) * 11;
    const edge = (effA - effD + gauss(rng) * drama) * 0.85;
    let ga = Math.round(clamp(pace / 2 + edge / 2 + gauss(rng) * 4, 48, 140));
    let gd = Math.round(clamp(pace / 2 - edge / 2 + gauss(rng) * 4, 48, 140));

    let tie = null;
    if (ga === gd) {
      // Overtime periods until someone edges it — the scoreline keeps climbing.
      const periods = [];
      for (let i = 0; i < 4 && ga === gd; i++) {
        const a = Math.max(0, Math.round(11 + gauss(rng) * 4));
        const b = Math.max(0, Math.round(11 + gauss(rng) * 4));
        periods.push([a, b]);
        ga += a;
        gd += b;
      }
      if (ga === gd) ga += 2; // hard stop
      tie = { periods, ga, gd };
    }

    const ev = [];
    const push = (team, runs, offset) => {
      const span = offset ? OVERTIME * tie.periods.length : MINUTES;
      runs.forEach((pts, i) => {
        ev.push({
          m: offset + Math.min(span, Math.max(1, Math.round(((i + 1) / (runs.length + 1)) * span + gauss(rng)))),
          tid: team.id,
          name: pickScorer(rng, team, SCORER_WEIGHTS, 45),
          pts,
        });
      });
    };
    const regA = tie ? ga - tie.periods.reduce((s, p) => s + p[0], 0) : ga;
    const regD = tie ? gd - tie.periods.reduce((s, p) => s + p[1], 0) : gd;
    push(attacker, toRuns(rng, regA), 0);
    push(defender, toRuns(rng, regD), 0);
    if (tie) {
      push(attacker, toRuns(rng, ga - regA), MINUTES);
      push(defender, toRuns(rng, gd - regD), MINUTES);
    }
    ev.sort((x, y) => x.m - y.m);

    return { ga, gd, ev, tie, winner: ga > gd ? attacker.id : defender.id };
  },
};
