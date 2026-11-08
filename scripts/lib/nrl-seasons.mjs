// The real NRL's figures, season by season, from NRL.com's draw and match centre (scripts/sync-nrl.mjs caches every
// game): what the rugby league match model is checked against (scripts/simulation-realism.mjs, REAL.nrl). Regular
// seasons only: the finals have no draws, and golden point there runs until someone scores.

const mean = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const share = (xs, test) => xs.filter(test).length / Math.max(1, xs.length);
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const round3 = x => Math.round(x * 1000) / 1000;
const POINTS = { Try: 4, Goal: 2, OnePointFieldGoal: 1, TwoPointFieldGoal: 2 };
const FULL_TIME = 80 * 60;

/** A game of the regular season, not a final: NRL.com's finals are titled "Finals Week …", "Semi Finals" and so on. */
export const isRegular = game => /^Round \d+$/.test(game.roundName || game.title || '');

/** The result, home first: the draw's score, else the match centre's. */
const resultOf = game => game.result || [game.home.score, game.away.score];

/**
 * Whether the match centre scored the game in full: its scoring events add up to the result. Three 2021 games have no
 * match centre data at all, and four more no timeline; they count for results, not for how the points came.
 */
export function scoredInFull(game) {
  const [home, away] = resultOf(game);
  let h = 0, a = 0;
  for (const [type, , , teamId] of game.events) {
    const pts = POINTS[type];
    if (!pts) continue;
    if (teamId === game.home.id) h += pts; else a += pts;
  }
  return h === home && a === away && game.home.score === home && game.away.score === away;
}

/** One side's scoring in a game: tries, conversions made and tried, penalty goals, one- and two-point field goals. */
export function sideScoring(game, side) {
  const team = game[side];
  const own = game.events.filter(([, , , teamId]) => teamId === team.id);
  const count = test => own.filter(test).length;
  return {
    tries: count(([type]) => type === 'Try'),
    conversions: count(([type, title]) => type === 'Goal' && /conversion/i.test(title)),
    conversionTries: count(([type, title]) => /^Goal(Missed)?$/.test(type) && /conversion/i.test(title)),
    penaltyGoals: count(([type, title]) => type === 'Goal' && /penalty/i.test(title)),
    fieldGoals1: count(([type]) => type === 'OnePointFieldGoal'),
    fieldGoals2: count(([type]) => type === 'TwoPointFieldGoal'),
    firstHalf: own.filter(([type, , seconds]) => POINTS[type] && seconds <= FULL_TIME / 2).reduce((s, [type]) => s + POINTS[type], 0),
  };
}

/** A season's figures from its finished games (NRL.com match centre replies, as scripts/sync-nrl.mjs keeps them). */
export function seasonFigures(games) {
  const regular = games.filter(isRegular);
  const results = regular.map(resultOf);
  const points = results.flat();
  const margins = results.map(([h, a]) => Math.abs(h - a));
  const decided = results.filter(([h, a]) => h !== a);
  const scored = regular.filter(scoredInFull);
  const sides = scored.flatMap(game => [sideScoring(game, 'home'), sideScoring(game, 'away')]);
  const sum = key => sides.reduce((s, side) => s + side[key], 0);
  // Golden point: a game level after eighty minutes plays on (NRL.com's clock runs past 80:00), won or drawn.
  const golden = regular.filter(game => game.seconds > FULL_TIME);
  const records = new Map();
  regular.forEach((game, i) => {
    const [h, a] = results[i];
    for (const [nick, own, other] of [[game.home.nick, h, a], [game.away.nick, a, h]]) {
      const record = records.get(nick) || { won: 0, drawn: 0, played: 0 };
      record.played++;
      if (own > other) record.won++;
      else if (own === other) record.drawn++;
      records.set(nick, record);
    }
  });
  const winPct = [...records.values()].map(r => (r.won + r.drawn / 2) / r.played);
  return {
    games: regular.length,
    scoredInFull: scored.length,
    pointsPerTeam: round3(mean(points)),
    teamPointsSd: round3(sd(points)),
    triesPerTeam: round3(sum('tries') / sides.length),
    conversionRate: round3(sum('conversions') / Math.max(1, sum('conversionTries'))),
    penaltyGoalsPerTeam: round3(sum('penaltyGoals') / sides.length),
    fieldGoalsPerGame: round3((sum('fieldGoals1') + sum('fieldGoals2')) / scored.length),
    twoPointFieldGoals: sum('fieldGoals2'),
    goldenPoint: round3(golden.length / regular.length),
    draws: regular.length - decided.length,
    marginMean: round3(mean(margins)),
    withinSix: round3(share(margins, m => m > 0 && m <= 6)),
    withinTwelve: round3(share(margins, m => m > 0 && m <= 12)),
    byThirteenPlus: round3(share(margins, m => m >= 13)),
    byTwentyFivePlus: round3(share(margins, m => m >= 25)),
    byOne: round3(share(margins, m => m === 1)),
    nilRate: round3(share(points, p => p === 0)),
    fortyPlusRate: round3(share(points, p => p >= 40)),
    firstHalfShare: round3(sum('firstHalf') / Math.max(1, scored.flatMap(game => resultOf(game)).reduce((s, p) => s + p, 0))),
    homeWins: round3(share(decided, ([h, a]) => h > a)),
    winPctSd: round3(sd(winPct)),
    bestWins: Math.max(...[...records.values()].map(r => r.won)),
    worstWins: Math.min(...[...records.values()].map(r => r.won)),
    gamesPerTeam: Math.round(mean([...records.values()].map(r => r.played))),
  };
}
