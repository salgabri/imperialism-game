// Plays whole league seasons with the built-in clubs, each of football's five leagues whole (leagueClubs), and
// measures what a fan of each league would look at: scores, draws and overtime, margins, standings, and who scores.
// Tennis has no league: its nations play Davis Cup ties, the sixteen strongest each meeting every other once a season.
// Each measure sits beside the real league's figure (REAL below, with its seasons). The defender of each fixture is
// its home side: at a neutral venue, as campaigns play by default, or at home with `--home` (the Home advantage
// launch rule).
// Run: node scripts/simulation-realism.mjs [--seasons=40] [--home] [--json]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEaPlayers } from './lib/football-data.mjs';
import { EA_CLUB_SNAPSHOT, firstDivisionClubs, squadTuples } from './lib/first-divisions.mjs';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { CLUBS as MLB_CLUBS } from '../src/data/clubs.baseball.js';
import { CLUBS as NHL_CLUBS } from '../src/data/clubs.hockey.js';
import { buildClub, buildTeam, hashStr, makeRng, selectLineup, teamEff } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';
import { BENCH, nbaBasketballIn } from '../src/sports/basketball.js';
import { americanFootball } from '../src/sports/americanFootball.js';
import { baseball } from '../src/sports/baseball.js';
import { hockey, PERIOD_MODEL } from '../src/sports/hockey.js';
import { tennis } from '../src/sports/tennis.js';
import { CLUBS as NRL_CLUBS } from '../src/data/clubs.rugby-league.js';
import { onField, rugbyLeague, scoreKind, SLICE_MODEL } from '../src/sports/rugbyLeague.js';

const DRAMA = 6; // Balanced

/** Circle-method rounds for an even number of teams: every pair meets once in n − 1 rounds. */
function roundRobin(n) {
  const ids = [...Array(n).keys()];
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push(r % 2 ? [ids[n - 1 - i], ids[i]] : [ids[i], ids[n - 1 - i]]);
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

/**
 * `games` rounds for each team, cycling the round robin (a second cycle swaps the sides), teams shuffled per season. An
 * odd number of teams (the NRL's 17) adds a bye: each round one team sits out, as in the NRL.
 */
function schedule(n, games, rng) {
  const slots = n % 2 ? n + 1 : n;
  const order = [...Array(slots).keys()];
  for (let i = slots - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rounds = roundRobin(slots);
  const fixtures = [];
  for (let g = 0; g < games; g++) {
    const flip = Math.floor(g / rounds.length) % 2 === 1;
    for (const [a, b] of rounds[g % rounds.length]) {
      if (order[a] >= n || order[b] >= n) continue;
      fixtures.push(flip ? [order[b], order[a]] : [order[a], order[b]]);
    }
  }
  return fixtures;
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const quantile = (xs, q) => {
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
/** The `count` commonest keys of a tally, each with its share of `total`. */
const commonest = (tally, count, total) => [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
  .map(([key, n]) => `${key} ${pct(n / total)}`);
const share = (xs, test) => xs.filter(test).length / Math.max(1, xs.length);
const pct = x => `${(100 * x).toFixed(1)}%`;
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

/** Position of every starter by name, for the scorer shares. */
function positionsByName(team) {
  return new Map(selectLineup(team).starters.map(p => [p.name, p.assignedPos]));
}

/**
 * Plays `seasons` seasons of `games` rounds between `teams` under `sport` and returns every game and the
 * per-season tables. `full` builds the event feeds (scorers, minutes); otherwise only scores are drawn, with the
 * score-only path's own record of the game (American football's possessions, `plays`). `venue` is the sport's
 * ({ home: true }: the defender, `j`, plays at home; neutral by default).
 */
function playSeasons({ sport, teams, games, seasons, seed, full = true, venue }) {
  const rng = makeRng(seed);
  const eff = teams.map(teamEff);
  const prepared = new Map();
  const played = [];
  const tables = [];
  for (let s = 0; s < seasons; s++) {
    const table = teams.map(() => ({ w: 0, d: 0, l: 0, for: 0, against: 0, pts: 0 }));
    const scorers = new Map();
    for (const [i, j] of schedule(teams.length, games, rng)) {
      const a = teams[i], d = teams[j];
      let result;
      if (full) result = sport.simulate(rng, a, d, DRAMA, eff[i], eff[j], venue);
      else {
        const key = `${i}:${j}`;
        if (!prepared.has(key)) prepared.set(key, sport.prepareMatch(a, d, eff[i], eff[j], venue));
        result = sport.sampleResult(rng, prepared.get(key), DRAMA);
      }
      const regA = result.regA ?? result.ga, regD = result.regD ?? result.gd;
      const game = { i, j, effI: eff[i], effJ: eff[j], ga: result.ga, gd: result.gd, regA, regD, tie: result.tie,
        winner: result.winner === a.id ? i : j, ev: result.ev, plays: result.plays };
      played.push(game);
      const ti = table[i], tj = table[j];
      ti.for += regA; ti.against += regD; tj.for += regD; tj.against += regA;
      if (sport.id === 'football' && regA === regD) { ti.d++; tj.d++; ti.pts++; tj.pts++; }
      else if (game.winner === i) { ti.w++; tj.l++; ti.pts += 3; }
      else { tj.w++; ti.l++; tj.pts += 3; }
      for (const e of result.ev || []) {
        const key = `${e.tid}|${e.name}`;
        scorers.set(key, (scorers.get(key) || 0) + (sport.id === 'football' ? 1 : e.pts));
      }
    }
    tables.push({ table, scorers });
  }
  return { played, tables, eff };
}

/** Favourite (higher lineup rating) record over a set of games: wins, draws (football) and losses. */
function favouriteRecord(played, football = false) {
  const decided = played.filter(g => Math.abs(g.effI - g.effJ) >= 0.5);
  const fav = g => (g.effI > g.effJ ? g.i : g.j);
  const draws = football ? share(decided, g => g.regA === g.regD) : 0;
  const wins = share(decided, g => (football ? g.regA !== g.regD : true) && g.winner === fav(g)
    && (!football || (g.regA > g.regD ? g.i : g.j) === fav(g)));
  return { wins, draws, losses: 1 - wins - draws };
}

function seasonSpread(tables, games, key = 'win') {
  const spreads = [], best = [], worst = [];
  for (const { table } of tables) {
    const values = table.map(t => (key === 'pts' ? t.pts : (t.w + t.d / 2) / games));
    spreads.push(sd(values));
    best.push(Math.max(...values));
    worst.push(Math.min(...values));
  }
  return { sd: mean(spreads), best: mean(best), worst: mean(worst) };
}

// ---- Football -------------------------------------------------------------------------------------------------

// The club layer keeps only Europe's strongest clubs (TOP_CLUBS), so a league season takes its league's clubs from the
// EA snapshot the club layer is built from, each with the XI the club layer gives it (scripts/lib/first-divisions.mjs).
let firstDivisions;
function leagueClubs(league) {
  firstDivisions ??= firstDivisionClubs(parseEaPlayers(readFileSync(EA_CLUB_SNAPSHOT, 'utf8')).players);
  return firstDivisions.filter(c => c.league === league).map(c => buildClub({ id: c.id, name: c.name, league: c.league,
    country: c.country, str: Math.round(c.exact), squad: squadTuples(c.squad) }, football));
}

function footballLeague(league, seasons, seed, venue) {
  const clubs = leagueClubs(league);
  const games = 2 * (clubs.length - 1);
  const { played, tables } = playSeasons({ sport: football, teams: clubs, games, seasons, seed, venue });
  const totals = played.map(g => g.regA + g.regD);
  const teamGoals = played.flatMap(g => [g.regA, g.regD]);
  const scorelines = new Map();
  for (const g of played) {
    const [hi, lo] = g.regA >= g.regD ? [g.regA, g.regD] : [g.regD, g.regA];
    scorelines.set(`${hi}-${lo}`, (scorelines.get(`${hi}-${lo}`) || 0) + 1);
  }
  const positions = new Map(clubs.map(c => [c.id, positionsByName(c)]));
  const byPosition = { FW: 0, MF: 0, DF: 0, GK: 0 };
  const minutes = [0, 0, 0, 0, 0, 0];
  let goals = 0;
  for (const g of played) {
    for (const e of g.ev) {
      byPosition[positions.get(e.tid).get(e.name)]++;
      minutes[Math.min(5, Math.floor((e.m - 1) / 15))]++;
      goals++;
    }
  }
  const topScorer = mean(tables.map(({ scorers }) => Math.max(...scorers.values())));
  const pts = seasonSpread(tables, games, 'pts');
  const shootouts = played.filter(g => g.tie);
  return {
    league, clubs: clubs.length, games,
    goalsPerGame: mean(totals), teamGoalsVarianceToMean: sd(teamGoals) ** 2 / mean(teamGoals),
    drawRate: share(played, g => g.regA === g.regD), goallessRate: share(played, g => g.regA + g.regD === 0),
    homeWins: share(played, g => g.regD > g.regA),
    overFiveRate: share(totals, t => t >= 6),
    marginThreePlus: share(played, g => Math.abs(g.regA - g.regD) >= 3),
    commonScores: commonest(scorelines, 6, played.length),
    championPoints: pts.best, lastPoints: pts.worst, pointsSd: pts.sd,
    topScorerGoals: topScorer,
    favourite: favouriteRecord(played, true),
    goalShares: Object.fromEntries(Object.entries(byPosition).map(([k, v]) => [k, v / goals])),
    goalMinutes: minutes.map(v => v / goals),
    shootoutAttackerWins: share(shootouts, g => g.winner === g.i),
    penaltyConversion: mean(shootouts.flatMap(g => [...g.tie.A, ...g.tie.D])),
  };
}

// ---- Basketball (NBA) -----------------------------------------------------------------------------------------

function nbaSeason(seasons, seed, venue) {
  const sport = nbaBasketballIn();
  const clubs = NBA_CLUBS.map(c => buildClub(c, sport));
  const { played, tables } = playSeasons({ sport, teams: clubs, games: 82, seasons, seed, venue });
  const regTotals = played.map(g => g.regA + g.regD);
  const teamPoints = played.flatMap(g => [g.ga, g.gd]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const topScorers = [];
  let benchPoints = 0, points = 0;
  for (const g of played) {
    for (const tid of [clubs[g.i].id, clubs[g.j].id]) {
      const totals = new Map();
      for (const e of g.ev) if (e.tid === tid && e.name !== BENCH) totals.set(e.name, (totals.get(e.name) || 0) + e.pts);
      topScorers.push(Math.max(...totals.values()));
    }
    for (const e of g.ev) { points += e.pts; if (e.name === BENCH) benchPoints += e.pts; }
  }
  const spread = seasonSpread(tables, 82);
  return {
    clubs: clubs.length,
    pointsPerTeam: mean(teamPoints), teamPointsSd: sd(teamPoints), regulationTotal: mean(regTotals),
    overtimeRate: share(played, g => g.tie),
    marginMean: mean(margins), marginMedian: quantile(margins, 0.5), closeGames: share(margins, m => m <= 3),
    blowouts: share(margins, m => m >= 20),
    winPctSd: spread.sd, bestWins: spread.best * 82, worstWins: spread.worst * 82,
    favourite: favouriteRecord(played),
    topScorerMean: mean(topScorers),
    fortyPointRate: share(topScorers, p => p >= 40), fiftyPointRate: share(topScorers, p => p >= 50),
    benchShare: benchPoints / points, homeWins: share(played, g => g.winner === g.j),
  };
}

// ---- American football (NFL) ----------------------------------------------------------------------------------

function nflSeason(seasons, seed, venue) {
  const clubs = NFL_CLUBS.map(c => buildClub(c, americanFootball));
  const { played, tables } = playSeasons({ sport: americanFootball, teams: clubs, games: 17, seasons, seed, venue });
  const teamPoints = played.flatMap(g => [g.ga, g.gd]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const scores = new Map();
  for (const p of teamPoints) scores.set(p, (scores.get(p) || 0) + 1);
  const positions = new Map(clubs.map(c => [c.id, positionsByName(c)]));
  const tdBy = {};
  let tds = 0;
  for (const g of played) {
    for (const e of g.ev) {
      if (e.pts < 6) continue; // a touchdown is 6 to 8 with its try
      const pos = positions.get(e.tid).get(e.name);
      const group = ['WR', 'RB', 'TE', 'QB'].includes(pos) ? pos : 'D/ST';
      tdBy[group] = (tdBy[group] || 0) + 1;
      tds++;
    }
  }
  // Tries and safeties, from the possessions of a score-only run: the feed keeps a touchdown's points, not its try.
  const tries = { touchdowns: 0, kicks: 0, kicked: 0, twos: 0, converted: 0, safeties: 0 };
  for (const { plays } of playSeasons({ sport: americanFootball, teams: clubs, games: 17, seasons, seed: seed + 1, full: false, venue }).played) {
    for (const p of plays) {
      if (p.pts === 2) tries.safeties++;
      if (p.pts < 6) continue;
      tries.touchdowns++;
      if (p.conversion === 'kick') { tries.kicks++; if (p.pts === 7) tries.kicked++; }
      if (p.conversion === 'two') { tries.twos++; if (p.pts === 8) tries.converted++; }
    }
  }
  const spread = seasonSpread(tables, 17);
  return {
    clubs: clubs.length,
    pointsPerTeam: mean(teamPoints), teamPointsSd: sd(teamPoints),
    overtimeRate: share(played, g => g.tie), shutoutRate: share(teamPoints, p => p === 0),
    marginMean: mean(margins), marginMedian: quantile(margins, 0.5),
    oneScore: share(margins, m => m <= 8), byThree: share(margins, m => m === 3), bySeven: share(margins, m => m === 7),
    byOneOrTwo: share(margins, m => m <= 2), blowouts: share(margins, m => m >= 21),
    commonScores: commonest(scores, 8, teamPoints.length),
    winPctSd: spread.sd, bestWins: spread.best * 17, worstWins: spread.worst * 17,
    favourite: favouriteRecord(played), homeWins: share(played, g => g.winner === g.j),
    tdShares: Object.fromEntries(Object.entries(tdBy).map(([k, v]) => [k, v / tds])),
    xpRate: tries.kicked / tries.kicks, twoPointShare: tries.twos / tries.touchdowns, twoPointRate: tries.converted / tries.twos,
    safetiesPerSeason: tries.safeties / seasons,
  };
}

// ---- Baseball (MLB) -------------------------------------------------------------------------------------------

function mlbSeason(seasons, seed, venue) {
  const clubs = MLB_CLUBS.map(c => buildClub(c, baseball));
  const { played, tables } = playSeasons({ sport: baseball, teams: clubs, games: 162, seasons, seed, full: false, venue });
  const teamRuns = played.flatMap(g => [g.ga, g.gd]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const spread = seasonSpread(tables, 162);
  return {
    clubs: clubs.length,
    runsPerTeam: mean(teamRuns), teamRunsSd: sd(teamRuns),
    extraInnings: share(played, g => g.tie), oneRun: share(margins, m => m === 1), shutoutRate: share(teamRuns, r => r === 0),
    tenPlusRate: share(teamRuns, r => r >= 10),
    marginMean: mean(margins), blowouts: share(margins, m => m >= 5),
    homeWins: share(played, g => g.winner === g.j),
    winPctSd: spread.sd, bestWins: spread.best * 162, worstWins: spread.worst * 162,
    favourite: favouriteRecord(played),
  };
}

// ---- Ice hockey (NHL) -----------------------------------------------------------------------------------------

function nhlSeason(seasons, seed, venue) {
  const clubs = NHL_CLUBS.map(c => buildClub(c, hockey));
  const { played, tables } = playSeasons({ sport: hockey, teams: clubs, games: 82, seasons, seed, venue });
  // A shoot-out's extra goal is on the final score, not on anyone's goal count.
  const inShootout = g => g.tie?.periods.length > 1;
  const teamGoals = played.flatMap(g => [g.ga - (inShootout(g) && g.ga > g.gd ? 1 : 0), g.gd - (inShootout(g) && g.gd > g.ga ? 1 : 0)]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const positions = new Map(clubs.map(c => [c.id, positionsByName(c)]));
  const perSeason = played.length / seasons;
  const topScorers = [];
  let goals = 0, byDefenders = 0;
  for (let s = 0; s < seasons; s++) {
    const tally = new Map();
    for (const g of played.slice(s * perSeason, (s + 1) * perSeason)) {
      for (const e of g.ev) {
        if (e.m > PERIOD_MODEL.MINUTES + PERIOD_MODEL.OVERTIME) continue;
        const key = `${e.tid}|${e.name}`;
        tally.set(key, (tally.get(key) || 0) + 1);
        goals++;
        if (positions.get(e.tid).get(e.name) === 'D') byDefenders++;
      }
    }
    topScorers.push(Math.max(...tally.values()));
  }
  const spread = seasonSpread(tables, 82);
  return {
    clubs: clubs.length,
    goalsPerTeam: mean(teamGoals), teamGoalsSd: sd(teamGoals),
    overtime: share(played, g => g.tie), shootout: share(played, inShootout),
    decidedInOvertime: share(played.filter(g => g.tie), g => !inShootout(g)),
    oneGoal: share(margins, m => m === 1), twoGoal: share(margins, m => m === 2), threePlus: share(margins, m => m >= 3), fivePlus: share(margins, m => m >= 5),
    marginMean: mean(margins), shutoutRate: share(teamGoals, x => x === 0),
    homeWins: share(played, g => g.winner === g.j),
    winPctSd: spread.sd, bestWins: spread.best * 82, worstWins: spread.worst * 82,
    favourite: favouriteRecord(played), topScorer: mean(topScorers), defenderGoals: byDefenders / goals,
  };
}

// ---- Tennis (Davis Cup) ---------------------------------------------------------------------------------------

/** The field: the sixteen strongest tennis nations, about a World Group's worth. */
export function davisCupField(count = 16) {
  const rng = makeRng(1);
  return Object.keys(tennis.rosters).map(id => buildTeam(id, rng, tennis)).sort((a, b) => b.str - a.str).slice(0, count);
}

function davisCup(seasons, seed, venue) {
  const nations = davisCupField();
  const { played } = playSeasons({ sport: tennis, teams: nations, games: nations.length - 1, seasons, seed, venue });
  // Each rubber's sets, from its deciding event's score ("6–4 3–6 7–6(5)"); a walkover has none.
  const rubbers = played.flatMap(g => g.ev.filter(e => e.pts > 0 && e.score !== 'w/o').map(e => e.score.split(' ')));
  const sets = rubbers.flat();
  const score = (w, l) => share(played, g => Math.max(g.ga, g.gd) === w && Math.min(g.ga, g.gd) === l);
  return {
    nations: nations.length,
    ties: played.length,
    sweep: score(3, 0), threeOne: score(3, 1), decider: score(3, 2),
    threeSets: share(rubbers, r => r.length === 3),
    tiebreakSets: share(sets, set => set.includes('(')),
    bagels: share(sets, set => /^6–0/.test(set)),
    favourite: favouriteRecord(played),
    homeWins: share(played, g => g.winner === g.j),
  };
}

// ---- Rugby league (NRL) ---------------------------------------------------------------------------------------

/** Rounds a season: the NRL's 17 clubs play 24 games each, a bye in each round, as 26 rounds of this schedule give. */
const NRL_ROUNDS = 26;
const NRL_GAMES = 24;

export function nrlSeason(seasons, seed, venue) {
  const clubs = NRL_CLUBS.map(c => buildClub(c, rugbyLeague));
  const { played, tables } = playSeasons({ sport: rugbyLeague, teams: clubs, games: NRL_ROUNDS, seasons, seed, venue });
  const teamPoints = played.flatMap(g => [g.ga, g.gd]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const regulation = played.filter(g => !g.tie);
  // Each player's place: the thirteen by position, the interchange as the bench, as NRL.com's team lists count them.
  const positions = new Map(clubs.map(c => {
    const { starters, bench } = onField(selectLineup(c));
    return [c.id, new Map([...starters.map(slot => [slot.player.name, slot.position]), ...bench.map(slot => [slot.player.name, 'BENCH'])])];
  }));
  const events = played.flatMap(g => g.ev);
  const tries = events.filter(e => scoreKind(e) === 'try' && e.m <= SLICE_MODEL.MINUTES);
  const tryShares = {};
  for (const e of tries) {
    const position = positions.get(e.tid).get(e.name) || 'other';
    tryShares[position] = (tryShares[position] || 0) + 1 / tries.length;
  }
  const firstHalf = events.filter(e => e.m <= SLICE_MODEL.HALF).reduce((s, e) => s + e.pts, 0);
  // Win percentages and records by games played: the byes leave each club a game or two either side of 24.
  const spreads = [], best = [], worst = [];
  for (const { table } of tables) {
    const values = table.map(t => (t.w + t.d / 2) / Math.max(1, t.w + t.d + t.l));
    spreads.push(sd(values));
    best.push(Math.max(...values) * NRL_GAMES);
    worst.push(Math.min(...values) * NRL_GAMES);
  }
  return {
    clubs: clubs.length,
    pointsPerTeam: mean(teamPoints), teamPointsSd: sd(teamPoints),
    triesPerTeam: tries.length / teamPoints.length,
    conversionRate: tries.filter(e => e.pts === 6).length / Math.max(1, tries.length),
    penaltyGoalsPerTeam: events.filter(e => scoreKind(e) === 'penalty' && e.m <= SLICE_MODEL.MINUTES).length / teamPoints.length,
    fieldGoalsPerGame: events.filter(e => scoreKind(e) === 'field').length / played.length,
    goldenPoint: share(played, g => g.tie),
    marginMean: mean(margins), withinSix: share(margins, m => m > 0 && m <= 6), withinTwelve: share(margins, m => m > 0 && m <= 12),
    byThirteenPlus: share(margins, m => m >= 13), byTwentyFivePlus: share(margins, m => m >= 25), byOne: share(margins, m => m === 1),
    nilRate: share(teamPoints, p => p === 0), fortyPlusRate: share(teamPoints, p => p >= 40),
    firstHalfShare: firstHalf / Math.max(1, events.reduce((s, e) => s + e.pts, 0)),
    homeWins: share(played, g => g.winner === g.j),
    winPctSd: mean(spreads), bestWins: mean(best), worstWins: mean(worst),
    favourite: favouriteRecord(played), tryShares, regulationShare: regulation.length / played.length,
  };
}

// ---- Real leagues ---------------------------------------------------------------------------------------------

/**
 * What each league looks like in life: the range over the seasons named in `note`, gathered 2026-11-01 from ESPN's and
 * NFL.com's season tables (league totals computed from the per-team tables), Land of Basketball, StatMuse, TSN, The
 * Analyst, RSSSF and the NFL margin data for 1999–2025. Ranges marked "est." are estimates, not sourced figures; a
 * figure no source gave has no range and is reported only.
 */
export const REAL = Object.freeze({
  football: {
    note: 'Premier League, La Liga, Serie A, Bundesliga and Ligue 1, 2021/22–2024/25',
    goalsPerGame: [2.5, 3.28], drawRate: [0.203, 0.295], goallessRate: [0.029, 0.096],
    // Points per 38 games (the Bundesliga's and Ligue 1's 34 scaled up).
    championPoints38: [79, 101], lastPoints38: [12, 32],
    // The five leagues' top scorers, per 38 games.
    topScorerGoals38: [18, 40],
    // est.: forwards 45–50%, midfielders 30–35%, defenders 10–13% and own goals about 3% of all goals.
    goalShares: { FW: [0.45, 0.55], MF: [0.29, 0.37], DF: [0.1, 0.14] },
    // 44.9% before half-time across 11,000 goals in Europe (Alberti et al., 2013); about 47% in the 2024-25 Premier League.
    firstHalfShare: [0.44, 0.48],
    // World Cup shoot-outs 1982–2026 68.6%, Euros 1976–2024 77.0%, the major tournaments 73.1%.
    penaltyConversion: [0.686, 0.77],
    // Home wins in ninety minutes: the Premier League's 40.8% in 2024/25 and 42.9% in 2021/22 (FootballRates), La
    // Liga's 47.9% in 2022/23 (Statista), the five leagues' mean 45.8% in 2022/23 and 43.0% in 2023/24.
    homeWins: [0.408, 0.479],
  },
  nba: {
    note: 'NBA regular seasons 2021/22–2024/25 (2025/26 for the points a team the built-in season plays at)',
    pointsPerTeam: [110.6, 116.5], overtimeRate: [0.047, 0.064], marginMean: [11.2, 13], closeGames: [0.136, 0.157],
    blowouts: [0.15, 0.228], winPctSd: [0.12, 0.161], bestWins: [58, 68], worstWins: [14, 20],
    fortyPointRate: [0.048, 0.083], fiftyPointRate: [0.0073, 0.0102], benchShare: [0.301, 0.312], homeWins: [0.543, 0.58],
  },
  nfl: {
    note: 'NFL regular seasons 2021–2025 (margins 2020–2025, playoffs included)',
    pointsPerTeam: [21.8, 23.0], overtimeRate: [0.048, 0.077], marginMean: [10.6, 11.6], oneScore: [0.507, 0.576],
    byThree: [0.142, 0.162], bySeven: [0.067, 0.087], winPctSd: [0.159, 0.215], bestWins: [13, 15], worstWins: [2, 3],
    homeWins: [0.515, 0.557],
    // Passing 57–59% of touchdowns, rushing 35.5–37%, returns and the defence 4.8–6%, split by position (2023–2025).
    tdShares: { WR: [0.35, 0.4], RB: [0.32, 0.35], TE: [0.128, 0.165], QB: [0.075, 0.09], 'D/ST': [0.048, 0.06] },
    // Extra points made and safeties a season, 2021–2025. Two-point tries made 56.5% of the time in 2023 and 40% in
    // 2024 (47.6% over 2020–2024), after 9.8% of touchdowns in 2024 (Laura Albert's NFL analytics recaps, UW–Madison);
    // est.: about one touchdown in ten goes for two each season.
    xpRate: [0.934, 0.959], twoPointShare: [0.085, 0.11], twoPointRate: [0.4, 0.565], safetiesPerSeason: [8, 17],
  },
  mlb: {
    note: 'MLB regular seasons 2022–2025',
    runsPerTeam: [4.28, 4.62], extraInnings: [0.083, 0.089], oneRun: [0.278, 0.294],
    // est.: 7.1% over the first 1,734 games of 2022.
    shutoutRate: [0.06, 0.072],
    homeWins: [0.521, 0.543], winPctSd: [0.071, 0.089], bestWins: [97, 111], worstWins: [41, 55],
  },
  nhl: {
    note: "NHL regular seasons 2021/22–2025/26, computed 2026-11-07 from every game in the league's own API",
    // Goals a team without a shoot-out's extra goal; the margins are the final scores', which count it.
    goalsPerTeam: [3.01, 3.14], overtime: [0.207, 0.249], shootout: [0.059, 0.091], decidedInOvertime: [0.635, 0.716],
    oneGoal: [0.381, 0.432], twoGoal: [0.175, 0.219], threePlus: [0.393, 0.417], fivePlus: [0.055, 0.065], marginMean: [2.2, 2.31],
    shutoutRate: [0.043, 0.058], homeWins: [0.522, 0.563], winPctSd: [0.082, 0.127], bestWins: [55, 65], worstWins: [19, 25],
    topScorer: [52, 69],
    // est.: 15.2% of the 2025/26 goals of the players on today's rosters.
    defenderGoals: [0.14, 0.17],
  },
  davisCup: {
    note: 'Davis Cup World Group and play-off ties 2003–2016 and the ATP tour, as Tennis Abstract (Jeff Sackmann) measured them',
    // Hosts won 60.9% of 322 ties where Elo expected 53.1%, 7.8 points more, the field's favourites hosting about as often
    // as not.
    homeWins: [0.55, 0.62],
    // About 35% of the ATP's best-of-three matches go to a third set (36% in 2014, 35% in 2023), a mix of matchups
    // unlike a Davis Cup field's, so reported only.
    tourThreeSets: 0.35,
  },
  nrl: {
    note: "NRL regular seasons 2021–2025, computed 2026-11-08 from every game in NRL.com's draw and match centre "
      + '(scripts/lib/nrl-seasons.mjs)',
    pointsPerTeam: [21.6, 23.5], teamPointsSd: [11.6, 13.0], triesPerTeam: [3.8, 4.11], conversionRate: [0.738, 0.766],
    penaltyGoalsPerTeam: [0.375, 0.444], fieldGoalsPerGame: [0.083, 0.198],
    // Level after eighty minutes: 1.6% of 2021's games, 3.6% of 2022's and 4.9% of each season since.
    goldenPoint: [0.016, 0.049],
    marginMean: [14.6, 18.3], withinSix: [0.219, 0.338], withinTwelve: [0.391, 0.539], byThirteenPlus: [0.456, 0.609],
    byTwentyFivePlus: [0.181, 0.302], byOne: [0.034, 0.069], nilRate: [0.01, 0.036], fortyPlusRate: [0.078, 0.128],
    firstHalfShare: [0.481, 0.501], homeWins: [0.536, 0.589], winPctSd: [0.154, 0.223], bestWins: [18, 21], worstWins: [3, 6],
    // 2023–2025, by the scorer's place in the team list.
    tryShares: { WG: [0.292, 0.3], CE: [0.155, 0.184], FB: [0.086, 0.114], SR: [0.104, 0.111], FE: [0.062, 0.066],
      HB: [0.048, 0.054], PR: [0.038, 0.04], HK: [0.029, 0.034], LK: [0.015, 0.025], BENCH: [0.111, 0.134] },
  },
});

const row = (label, value, range, format = num) => {
  const inside = !range || (value >= range[0] && value <= range[1]);
  const real = range ? `${format(range[0])} – ${format(range[1])}` : '';
  return `  ${inside ? ' ' : '!'} ${label.padEnd(34)} ${String(format(value)).padStart(10)}   ${real}`;
};

/** `home`: every fixture is played at its defender's home (the Home advantage launch rule); neutral by default. */
export function realismReport({ seasons = 40, seed = 20261101, home = false } = {}) {
  const leagues = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  const venue = home ? { home: true } : undefined;
  return {
    home,
    football: leagues.map(league => footballLeague(league, seasons, hashStr(`${seed}:${league}`), venue)),
    nba: nbaSeason(seasons, hashStr(`${seed}:nba`), venue),
    nfl: nflSeason(seasons * 4, hashStr(`${seed}:nfl`), venue),
    mlb: mlbSeason(seasons, hashStr(`${seed}:mlb`), venue),
    nhl: nhlSeason(seasons, hashStr(`${seed}:nhl`), venue),
    davisCup: davisCup(seasons, hashStr(`${seed}:davis-cup`), venue),
    nrl: nrlSeason(seasons, hashStr(`${seed}:nrl`), venue),
  };
}

function print(report) {
  const lines = [`Venue: ${report.home ? 'the defender at home (Home advantage on)' : 'neutral (Home advantage off, the default)'}`];
  for (const f of report.football) {
    const scale = 38 / f.games;
    const r = REAL.football;
    lines.push(`\n${f.league} — ${f.clubs} clubs, ${f.games} games (real: ${r.note})`);
    lines.push(row('goals a game', f.goalsPerGame, r.goalsPerGame));
    lines.push(row('team goals variance / mean', f.teamGoalsVarianceToMean, r.teamGoalsVarianceToMean));
    lines.push(row('draws', f.drawRate, r.drawRate, pct));
    lines.push(row('home (defending) side wins in 90', f.homeWins, r.homeWins, pct));
    lines.push(row('0-0', f.goallessRate, r.goallessRate, pct));
    lines.push(row('six or more goals', f.overFiveRate, null, pct));
    lines.push(row('won by three or more', f.marginThreePlus, null, pct));
    lines.push(row('champion points (per 38)', f.championPoints * scale, r.championPoints38, x => num(x, 0)));
    lines.push(row('bottom club points (per 38)', f.lastPoints * scale, r.lastPoints38, x => num(x, 0)));
    lines.push(row('points SD (per 38)', f.pointsSd * scale, r.pointsSd38, x => num(x, 1)));
    lines.push(row('top scorer goals (per 38)', f.topScorerGoals * scale, r.topScorerGoals38, x => num(x, 0)));
    lines.push(row('favourite wins / draws', f.favourite.wins, null, x => `${pct(x)} / ${pct(f.favourite.draws)}`));
    for (const pos of ['FW', 'MF', 'DF']) lines.push(row(`goals by ${pos}`, f.goalShares[pos], r.goalShares[pos], pct));
    lines.push(row('first-half goals', f.goalMinutes[0] + f.goalMinutes[1] + f.goalMinutes[2], r.firstHalfShare, pct));
    lines.push(row('penalty conversion (shoot-outs)', f.penaltyConversion, r.penaltyConversion, pct));
    lines.push(`    scorelines: ${f.commonScores.join(', ')}`);
  }
  const n = report.nba, rn = REAL.nba;
  lines.push(`\nNBA — ${n.clubs} clubs, 82 games (real: ${rn.note})`);
  lines.push(row('points a team', n.pointsPerTeam, rn.pointsPerTeam, x => num(x, 1)));
  lines.push(row('team points SD', n.teamPointsSd, rn.teamPointsSd, x => num(x, 1)));
  lines.push(row('overtime', n.overtimeRate, rn.overtimeRate, pct));
  lines.push(row('mean margin', n.marginMean, rn.marginMean, x => num(x, 1)));
  lines.push(row('decided by 3 or fewer', n.closeGames, rn.closeGames, pct));
  lines.push(row('decided by 20 or more', n.blowouts, rn.blowouts, pct));
  lines.push(row('win% SD', n.winPctSd, rn.winPctSd, x => num(x, 3)));
  lines.push(row('best record (wins)', n.bestWins, rn.bestWins, x => num(x, 0)));
  lines.push(row('worst record (wins)', n.worstWins, rn.worstWins, x => num(x, 0)));
  lines.push(row('favourite wins', n.favourite.wins, rn.favouriteWins, pct));
  lines.push(row("team's top scorer (points)", n.topScorerMean, rn.topScorerMean, x => num(x, 1)));
  lines.push(row('40-point games (per team game)', n.fortyPointRate, rn.fortyPointRate, pct));
  lines.push(row('50-point games (per team game)', n.fiftyPointRate, rn.fiftyPointRate, pct));
  lines.push(row("bench's share of the points", n.benchShare, rn.benchShare, pct));
  lines.push(row('home (defending) side wins', n.homeWins, rn.homeWins, pct));
  const a = report.nfl, ra = REAL.nfl;
  lines.push(`\nNFL — ${a.clubs} clubs, 17 games (real: ${ra.note})`);
  lines.push(row('points a team', a.pointsPerTeam, ra.pointsPerTeam, x => num(x, 1)));
  lines.push(row('team points SD', a.teamPointsSd, ra.teamPointsSd, x => num(x, 1)));
  lines.push(row('overtime', a.overtimeRate, ra.overtimeRate, pct));
  lines.push(row('shutouts (per team game)', a.shutoutRate, ra.shutoutRate, pct));
  lines.push(row('mean margin', a.marginMean, ra.marginMean, x => num(x, 1)));
  lines.push(row('one-score games (≤ 8)', a.oneScore, ra.oneScore, pct));
  lines.push(row('decided by exactly 3', a.byThree, ra.byThree, pct));
  lines.push(row('decided by exactly 7', a.bySeven, ra.bySeven, pct));
  lines.push(row('win% SD', a.winPctSd, ra.winPctSd, x => num(x, 3)));
  lines.push(row('best record (wins)', a.bestWins, ra.bestWins, x => num(x, 1)));
  lines.push(row('worst record (wins)', a.worstWins, ra.worstWins, x => num(x, 1)));
  lines.push(row('favourite wins', a.favourite.wins, ra.favouriteWins, pct));
  lines.push(row('home (defending) side wins', a.homeWins, ra.homeWins, pct));
  for (const group of ['WR', 'RB', 'TE', 'QB', 'D/ST']) {
    lines.push(row(`touchdowns by ${group}`, a.tdShares[group] || 0, ra.tdShares[group], pct));
  }
  lines.push(row('extra points made', a.xpRate, ra.xpRate, pct));
  lines.push(row('touchdowns going for two', a.twoPointShare, ra.twoPointShare, pct));
  lines.push(row('two-point tries made', a.twoPointRate, ra.twoPointRate, pct));
  lines.push(row('safeties a season', a.safetiesPerSeason, ra.safetiesPerSeason, x => num(x, 1)));
  lines.push(`    team scores: ${a.commonScores.join(', ')}`);
  const m = report.mlb, rm = REAL.mlb;
  lines.push(`\nMLB — ${m.clubs} clubs, 162 games (real: ${rm.note})`);
  lines.push(row('runs a team', m.runsPerTeam, rm.runsPerTeam));
  lines.push(row('team runs SD', m.teamRunsSd, rm.teamRunsSd));
  lines.push(row('extra innings', m.extraInnings, rm.extraInnings, pct));
  lines.push(row('one-run games', m.oneRun, rm.oneRun, pct));
  lines.push(row('shutouts (per team game)', m.shutoutRate, rm.shutoutRate, pct));
  lines.push(row('home (defending) side wins', m.homeWins, rm.homeWins, pct));
  lines.push(row('win% SD', m.winPctSd, rm.winPctSd, x => num(x, 3)));
  lines.push(row('best record (wins)', m.bestWins, rm.bestWins, x => num(x, 0)));
  lines.push(row('worst record (wins)', m.worstWins, rm.worstWins, x => num(x, 0)));
  lines.push(row('favourite wins', m.favourite.wins, rm.favouriteWins, pct));
  const h = report.nhl, rh = REAL.nhl;
  lines.push(`\nNHL — ${h.clubs} clubs, 82 games (real: ${rh.note})`);
  lines.push(row('goals a team', h.goalsPerTeam, rh.goalsPerTeam));
  lines.push(row('team goals SD', h.teamGoalsSd, rh.teamGoalsSd));
  lines.push(row('overtime or shoot-out', h.overtime, rh.overtime, pct));
  lines.push(row('shoot-outs', h.shootout, rh.shootout, pct));
  lines.push(row('overtimes decided before a shoot-out', h.decidedInOvertime, rh.decidedInOvertime, pct));
  lines.push(row('won by one', h.oneGoal, rh.oneGoal, pct));
  lines.push(row('won by two', h.twoGoal, rh.twoGoal, pct));
  lines.push(row('won by three or more', h.threePlus, rh.threePlus, pct));
  lines.push(row('won by five or more', h.fivePlus, rh.fivePlus, pct));
  lines.push(row('mean margin', h.marginMean, rh.marginMean));
  lines.push(row('shutouts (per team game)', h.shutoutRate, rh.shutoutRate, pct));
  lines.push(row('home (defending) side wins', h.homeWins, rh.homeWins, pct));
  lines.push(row('win% SD', h.winPctSd, rh.winPctSd, x => num(x, 3)));
  lines.push(row('best record (wins)', h.bestWins, rh.bestWins, x => num(x, 0)));
  lines.push(row('worst record (wins)', h.worstWins, rh.worstWins, x => num(x, 0)));
  lines.push(row('favourite wins', h.favourite.wins, rh.favouriteWins, pct));
  lines.push(row('top scorer (goals)', h.topScorer, rh.topScorer, x => num(x, 0)));
  lines.push(row('goals by defenders', h.defenderGoals, rh.defenderGoals, pct));
  const t = report.davisCup, rt = REAL.davisCup;
  lines.push(`\nDavis Cup — the ${t.nations} strongest nations, ${t.ties} ties (real: ${rt.note})`);
  lines.push(row('ties won 3–0', t.sweep, null, pct));
  lines.push(row('ties won 3–1', t.threeOne, null, pct));
  lines.push(row('ties won 3–2', t.decider, null, pct));
  lines.push(row('rubbers to a third set', t.threeSets, null, pct));
  lines.push(`      (the ATP tour's best-of-three matches: about ${pct(rt.tourThreeSets)}, a different mix of matchups)`);
  lines.push(row('sets decided in a tie-break', t.tiebreakSets, null, pct));
  lines.push(row('sets won 6–0', t.bagels, null, pct));
  lines.push(row('favourite wins', t.favourite.wins, null, pct));
  lines.push(row('host (defending) side wins', t.homeWins, rt.homeWins, pct));
  const r = report.nrl, rr = REAL.nrl;
  lines.push(`\nNRL — ${r.clubs} clubs, ${NRL_GAMES} games (real: ${rr.note})`);
  lines.push(row('points a team', r.pointsPerTeam, rr.pointsPerTeam, x => num(x, 1)));
  lines.push(row('team points SD', r.teamPointsSd, rr.teamPointsSd, x => num(x, 1)));
  lines.push(row('tries a team', r.triesPerTeam, rr.triesPerTeam));
  lines.push(row('conversions made', r.conversionRate, rr.conversionRate, pct));
  lines.push(row('penalty goals a team', r.penaltyGoalsPerTeam, rr.penaltyGoalsPerTeam));
  lines.push(row('field goals a game', r.fieldGoalsPerGame, rr.fieldGoalsPerGame, x => num(x, 3)));
  lines.push(row('golden point', r.goldenPoint, rr.goldenPoint, pct));
  lines.push(row('mean margin', r.marginMean, rr.marginMean, x => num(x, 1)));
  lines.push(row('won by 1', r.byOne, rr.byOne, pct));
  lines.push(row('won by 1–6', r.withinSix, rr.withinSix, pct));
  lines.push(row('won by 1–12', r.withinTwelve, rr.withinTwelve, pct));
  lines.push(row('won by 13 or more', r.byThirteenPlus, rr.byThirteenPlus, pct));
  lines.push(row('won by 25 or more', r.byTwentyFivePlus, rr.byTwentyFivePlus, pct));
  lines.push(row('nil (per team game)', r.nilRate, rr.nilRate, pct));
  lines.push(row('40 or more (per team game)', r.fortyPlusRate, rr.fortyPlusRate, pct));
  lines.push(row('first-half points', r.firstHalfShare, rr.firstHalfShare, pct));
  lines.push(row('home (defending) side wins', r.homeWins, rr.homeWins, pct));
  lines.push(row('win% SD', r.winPctSd, rr.winPctSd, x => num(x, 3)));
  lines.push(row(`best record (wins of ${NRL_GAMES})`, r.bestWins, rr.bestWins, x => num(x, 1)));
  lines.push(row(`worst record (wins of ${NRL_GAMES})`, r.worstWins, rr.worstWins, x => num(x, 1)));
  lines.push(row('favourite wins', r.favourite.wins, rr.favouriteWins, pct));
  for (const position of ['WG', 'CE', 'FB', 'SR', 'FE', 'HB', 'PR', 'HK', 'LK', 'BENCH']) {
    lines.push(row(`tries by ${position}`, r.tryShares[position] || 0, rr.tryShares[position], pct));
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
  const report = realismReport({ seasons: Number(option('seasons')) || 40, home: process.argv.includes('--home') });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${print(report)}\n`);
}
