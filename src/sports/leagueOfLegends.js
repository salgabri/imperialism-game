import { C } from '../theme.js';
import { defineSportData } from './sportData.js';
import { rulesMemo, rulesYear } from './eras.js';
import { LEAGUE_OF_LEGENDS_GAMES } from '../data/leagueOfLegendsGames.js';
import { GREAT_BRITAIN, HISTORIC_NATIONS, HOME_NATIONS, NATIONS, selectLineup } from '../data/teams.js';
import { clamp, createScorerSampler, gauss, poisson } from '../engine/random.js';

// League of Legends as its playoffs are played (docs/design/league-of-legends.md): two teams of five, one to each of its
// roles (top, jungle, mid, bot, support), a series of games, best of five. A game is over when a Nexus falls. Nations
// only for now: each fields its best player in each role by an Elo of gol.gg's results.
export const GAMES = 5;
export const TO_WIN = 3;
export const ROLES = Object.freeze(['TOP', 'JGL', 'MID', 'BOT', 'SUP']);

// On the clock a game has twelve units of four minutes, forty-eight minutes in all (a longer game ends in the last); the
// shortest series (three games) fills 36 units, and each further game extends it as an overtime period does in other
// sports.
export const MINUTES_PER_UNIT = 4;
export const BLOCK = 12;
export const LENGTH = TO_WIN * BLOCK;
const MS_PER_UNIT = 110;

// Ratings are Elo built from every game gol.gg records (scripts/lib/league-of-legends.mjs), on the game's scale: a rating
// point is 25 Elo points. A team plays at its five players' mean, as the Elo was built, and wins each game with Elo's own
// odds: a 4-point favourite (100 Elo) wins 64% of games, an 8-point one 76%.
export const ELO_PER_POINT = 25;
/** The favourite's chance in one game, `gap` rating points ahead. */
export const gameOdds = gap => 1 / (1 + 10 ** (-gap * ELO_PER_POINT / 400));

// A game as the real ones went (docs/design/league-of-legends.md, "Calibration"), gol.gg's 4,563 games between seasoned
// players from July 2025 to November 2026: 32.1 minutes on average (spread 5.4); the winner's kills 21.5 whatever the
// length, the loser's 10.5 in a game of average length (the 339 games whose kills the cache holds), growing with the
// square of its length; the winner took a Baron in 91% of games, the loser in 16%.
export const LENGTH_MEAN = 32.1;
export const LENGTH_SPREAD = 5.4;
const SHORTEST = 18, LONGEST = 55;
export const WINNER_KILLS = 21.5;
export const LOSER_KILLS = 10.5;
export const WINNER_BARON = 0.91;
export const LOSER_BARON = 0.16;
/** How today's games go; an earlier season's go as its year's did (LEAGUE_OF_LEGENDS_GAMES, `leagueOfLegendsIn`). */
export const GAMES_TODAY = Object.freeze({ minutes: LENGTH_MEAN, spread: LENGTH_SPREAD, winnerKills: WINNER_KILLS, loserKills: LOSER_KILLS,
  winnerBaron: WINNER_BARON, loserBaron: LOSER_BARON });
// A Baron spawns at twenty minutes.
const BARON_FROM = 20;

// Match-day form: one draw for the series in rating points, on every game's gap. It grows with the square of the drama,
// as in the other sports, so Wild swings series hard and Predictable plays Elo's odds game by game. In gol.gg's 468
// best-of-five series between seasoned players, the favourite's odds a game 62.8% on average, the favourite won 66.7%;
// their scorelines are likeliest with a spread of 5 rating points (125 Elo) at Balanced, the favourite then winning 67.3%
// (the 945 best-of-three series: 4).
export const FORM_AT_BALANCED = 5;
const formSpread = variation => FORM_AT_BALANCED * (variation / 6) ** 2;
// No home advantage measured yet: a home venue changes nothing (`homeAdvantage` false).
export const HOME_EDGE = 0;

/** What a nation counts for when none of its players is rated; it fields no team, so nothing reads it in play. */
const EMPTY_STRENGTH = 40;

// ---------- the series ----------

/**
 * Prepare a series once for cheap resampling: the attacker's edge in rating points on every game (`gap`), tactics,
 * upsets and the venue included. `venue.home`: the defender is at home.
 */
export function prepareMatch(attacker, defender, effA, effD, { home = false } = {}) {
  const lineupA = selectLineup(attacker), lineupD = selectLineup(defender);
  const adjustmentA = (Number.isFinite(effA) ? effA : lineupA.rating) - lineupA.rating;
  const adjustmentD = (Number.isFinite(effD) ? effD : lineupD.rating) - lineupD.rating;
  const gap = lineupA.rating + adjustmentA - (lineupD.rating + adjustmentD) - (home ? HOME_EDGE : 0);
  return { attackerId: attacker.id, defenderId: defender.id, lineupA, lineupD, gap, series: { games: GAMES, toWin: TO_WIN }, nexus: true };
}

/**
 * Score-only path: one form draw for the series, then each game won with Elo's odds for the gap until a side has three.
 * Also returns the form and who won each game (`games`, 'A' or 'D'), which the full simulation plays out.
 */
export function sampleResult(rng, prepared, drama = 6) {
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const form = gauss(rng) * formSpread(variation);
  const odds = gameOdds(prepared.gap + form);
  const games = [];
  let ga = 0, gd = 0;
  while (ga < TO_WIN && gd < TO_WIN) {
    if (rng() < odds) { ga++; games.push('A'); } else { gd++; games.push('D'); }
  }
  return { ga, gd, regA: ga, regD: gd, tie: null, winner: ga > gd ? prepared.attackerId : prepared.defenderId, form, games };
}

// Who stands out: first blood's killer and the game's best player are any of the five, the better player more often, each
// in proportion to his rating above the floor. gol.gg records each player's kills game by game, but the model draws them
// from the ratings alone.
const STANDOUT_WEIGHTS = Object.fromEntries(ROLES.map(role => [role, 1]));
const STANDOUT_FLOOR = 40;

/** A game's minute as League shows it: "31:42". */
export const gameClock = minutes => {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
/** A minute's clock unit within its game's block: 1 for the first four minutes, 12 from the forty-fifth. */
const unitOf = minutes => clamp(Math.ceil(minutes / MINUTES_PER_UNIT), 1, BLOCK);

/**
 * One game for a known winner (`winner` 'A' or 'D'), as its year's games went (`games`, today's unless given) → { minutes,
 * kills: { A, D }, barons: [{ side, minute }], firstBlood: { side, minute } }: its length, each side's kills (the winner's at
 * their real mean, the loser's growing with the game's length), the Barons taken and who drew first blood (a kill of the
 * game, so the side with more kills more often).
 */
export function playGame(rng, winner, games = GAMES_TODAY) {
  const loser = winner === 'A' ? 'D' : 'A';
  const minutes = clamp(games.minutes + gauss(rng) * games.spread, SHORTEST, LONGEST);
  const kills = { [winner]: poisson(rng, games.winnerKills), [loser]: poisson(rng, games.loserKills * (minutes / games.minutes) ** 2) };
  if (kills[winner] === 0) kills[winner] = 1;
  const barons = [];
  if (minutes > BARON_FROM + 2) {
    if (rng() < games.loserBaron) barons.push({ side: loser, minute: BARON_FROM + rng() * (minutes - BARON_FROM) * 0.6 });
    if (rng() < games.winnerBaron) barons.push({ side: winner, minute: BARON_FROM + (0.3 + 0.65 * rng()) * (minutes - BARON_FROM) });
  }
  barons.sort((x, y) => x.minute - y.minute);
  const total = kills.A + kills.D;
  const firstBlood = total > 0 ? { side: rng() < kills.A / total ? 'A' : 'D', minute: 1.5 + Math.min(minutes / 2, -Math.log(1 - clamp(rng(), 0, 0.999)) * 4) } : null;
  return { minutes, kills, barons, firstBlood };
}

/**
 * The whole series: sampleResult's own draws decide every game (so a seed gives the same score on both paths), then each
 * game is played out given its winner, as its year's games went (`yearOfGames`, today's unless given). Events: first blood
 * (`pts` 0, the score counts games), each Baron, and the game's end (`pts` 1, the winner's), named for its best player, with
 * the kills from his side and the game's length.
 */
export function simulateSeries(rng, prepared, drama = 6, yearOfGames = GAMES_TODAY) {
  const result = sampleResult(rng, prepared, drama);
  const standout = { A: createScorerSampler(prepared.lineupA, STANDOUT_WEIGHTS, STANDOUT_FLOOR),
    D: createScorerSampler(prepared.lineupD, STANDOUT_WEIGHTS, STANDOUT_FLOOR) };
  const ev = [];
  result.games.forEach((winner, k) => {
    const start = k * BLOCK;
    const loser = winner === 'A' ? 'D' : 'A';
    const game = playGame(rng, winner, yearOfGames);
    if (game.firstBlood) {
      ev.push({ m: start + unitOf(game.firstBlood.minute), side: game.firstBlood.side, name: standout[game.firstBlood.side](rng),
        pts: 0, game: k + 1, kind: 'first-blood', clock: gameClock(game.firstBlood.minute) });
    }
    for (const baron of game.barons) {
      ev.push({ m: start + unitOf(baron.minute), side: baron.side, name: null, pts: 0, game: k + 1, kind: 'baron',
        clock: gameClock(baron.minute) });
    }
    ev.push({ m: start + unitOf(game.minutes), side: winner, name: standout[winner](rng), pts: 1, game: k + 1, kind: 'nexus',
      score: `${game.kills[winner]}–${game.kills[loser]}`, clock: gameClock(game.minutes) });
  });
  return { ga: result.ga, gd: result.gd, ev, winner: result.winner };
}

/** The game an event or clock unit falls in: G1 for units 1–12, G2 for 13–24… (the start counts as the first). */
export const gameAt = m => clamp(Math.ceil((Number(m) || 0) / BLOCK), 1, GAMES);

/** League of Legends' nations-only rulebook: no clubs, Great Britain as one. Its players come from sportData.js. */
const territoryOf = rosters => ({
  merged: Object.fromEntries(HOME_NATIONS.map(nation => [nation, '826'])),
  // East Germany and South Vietnam (HISTORIC_NATIONS) are not on today's map.
  inactive: Object.keys(NATIONS).filter(nation => !HOME_NATIONS.includes(nation) && !HISTORIC_NATIONS.includes(nation)
    && !Object.hasOwn(rosters, nation)),
});

/** A campaign's match with games as `yearOfGames` has them: the series and its events, each side's events under its team's id. */
const simulateAs = yearOfGames => (rng, attacker, defender, drama, effA, effD, venue) => {
  const prepared = prepareMatch(attacker, defender, effA, effD, venue);
  const { ga, gd, ev, winner } = simulateSeries(rng, prepared, drama, yearOfGames);
  return { ga, gd, regA: ga, regD: gd, tie: null, winner,
    ev: ev.map(({ side, ...e }) => ({ ...e, tid: side === 'A' ? attacker.id : defender.id })) };
};

const leagueOfLegendsRules = {
  id: 'league-of-legends',
  simulationVersion: 1,
  name: 'League of Legends',
  blurb: 'Five-a-side battle arena, one player in each role, best of five. A game is won when the enemy Nexus falls.',
  // Read from the sport's players (sportData.js), once they have loaded.
  rosters: undefined,
  clubs: [],
  // Nations only, for now: the orgs (clubs) have no map yet.
  nationsOnly: true,
  homeAdvantage: false,
  territory: undefined,
  // Great Britain plays as one: the home nations' shapes start in the United Kingdom's (826) empire.
  playsAs: { '826': GREAT_BRITAIN },

  squadSize: 7,
  formation: { TOP: 1, JGL: 1, MID: 1, BOT: 1, SUP: 1 },
  positionPlan: ['TOP', 'JGL', 'MID', 'BOT', 'SUP', 'MID', 'BOT'],
  positionColors: { TOP: C.goldHi, JGL: C.green, MID: C.cyan, BOT: C.red, SUP: C.gold },

  fallbackStrength: () => EMPTY_STRENGTH,
  requiredPositions: [],

  // Twelve clock units a game; the chart ticks at the end of each. A series ends with its deciding game, the last event.
  clock: { length: LENGTH, msPerUnit: MS_PER_UNIT, ot: BLOCK, tick: BLOCK },
  tieBreak: 'none',
  labels: { score: 'GAMES', start: 'CHAMPION SELECT…', live: 'LIVE', end: 'FINAL', tie: 'FINAL', tieShort: '' },

  words: { kickoff: 'Start', end: 'Final', lineup: 'Team', lineupShort: 'Team', lineupNoun: 'team', lineupTitle: 'Team',
    overtime: null, half: null },

  // The clock shows the game in play: "G3".
  formatClock: m => `G${gameAt(m)}`,
  // The chart's axis: the end of each game.
  formatTick: t => (t > 0 ? `G${Math.round(t / BLOCK)}` : ''),
  // The feed's live row: "game 3, best of 5".
  clockLeft: now => `game ${gameAt(now)}, best of ${GAMES}`,
  // A game's end names its best player: "GAME 2 — KOR · 22–9 kills · Faker" (match.js reads it back from history).
  formatEvent: (e, code) => ({ when: `G${e.game || gameAt(e.m)}${e.clock ? ` ${e.clock}` : ''}`, text: e.pts > 0
    ? `GAME ${e.game} — ${code} · ${e.score} kills${e.name ? ` · ${e.name}` : ''}`
    : e.kind === 'baron' ? `BARON — ${code}` : `FIRST BLOOD — ${e.name} (${code})` }),
  formatToast: e => (e.pts > 0 ? `GAME ${e.game} — ${e.score}`
    : e.kind === 'baron' ? 'BARON NASHOR' : `FIRST BLOOD — ${String(e.name).toUpperCase()}`),

  /** The rules a campaign plays (matchSport): an earlier season's games (`leagueOfLegendsIn`), today's for the built-in one. */
  rulesFor: settings => leagueOfLegendsIn(settings),

  prepareMatch,
  sampleResult,
  simulate: simulateAs(GAMES_TODAY),
};

export const leagueOfLegends = defineSportData({ ...leagueOfLegendsRules }, { clubs: false, territoryOf });

/**
 * League of Legends with an earlier season's games (`rules`: { year, games }): the same series, each game as long and as
 * bloody as that year's were. Who wins is Elo's whatever the games, so a season's odds are today's and its simulation
 * version too.
 */
export function leagueOfLegendsWith(rules) {
  return defineSportData({ ...leagueOfLegendsRules, rules, simulate: simulateAs(rules.games) }, { clubs: false, territoryOf });
}

const seasonLeague = rulesMemo(year => leagueOfLegendsWith(Object.freeze({ year, games: LEAGUE_OF_LEGENDS_GAMES[year] })));

/**
 * League of Legends as a setup's or campaign's season played it (`settings`: `dataSet`, `dataYear`; matchSport): each earlier
 * season with its own year's games (LEAGUE_OF_LEGENDS_GAMES). The built-in season, which has no data set, and a year the table
 * lacks play today's (`leagueOfLegends` itself).
 */
export function leagueOfLegendsIn(settings) {
  const year = rulesYear(settings);
  return year != null && Object.hasOwn(LEAGUE_OF_LEGENDS_GAMES, year) ? seasonLeague(year) : leagueOfLegends;
}

/**
 * Squad-screen strength profile: the five who play and the best of them → { team, best } on the player-rating scale.
 * Takes a `selectLineup` result, or a team whose lineup is selected first. Read-only; no RNG.
 */
export function leagueOfLegendsProfile(lineup) {
  const selected = Array.isArray(lineup?.slots) ? lineup : Array.isArray(lineup?.squad) ? selectLineup(lineup) : null;
  if (!selected?.slots?.length) return { team: 0, best: 0 };
  const ratings = selected.slots.map(slot => slot.effectiveRating);
  return { team: ratings.reduce((sum, r) => sum + r, 0) / ratings.length, best: Math.max(...ratings) };
}

/** The constants the live win-probability model mirrors (src/engine/winProbability.js). */
export const GAMES_MODEL = Object.freeze({ GAMES, TO_WIN, BLOCK, LENGTH, FORM_AT_BALANCED });
