// Plays whole league seasons with the built-in clubs and measures what a fan of each league would look at:
// scores, draws and overtime, margins, standings, and who scores. Each measure sits beside the real league's
// figure (REAL below, with its seasons). Run: node scripts/simulation-realism.mjs [--seasons=40] [--json]
import { pathToFileURL } from 'node:url';
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { CLUBS as MLB_CLUBS } from '../src/data/clubs.baseball.js';
import { buildClub, hashStr, makeRng, selectLineup, teamEff } from '../src/data/teams.js';
import { football } from '../src/sports/football.js';
import { BENCH, nbaBasketballIn } from '../src/sports/basketball.js';
import { americanFootball } from '../src/sports/americanFootball.js';
import { baseball } from '../src/sports/baseball.js';

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

/** `games` rounds for each team, cycling the round robin (a second cycle swaps the sides), teams shuffled per season. */
function schedule(n, games, rng) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rounds = roundRobin(n);
  const fixtures = [];
  for (let g = 0; g < games; g++) {
    const flip = Math.floor(g / rounds.length) % 2 === 1;
    for (const [a, b] of rounds[g % rounds.length]) fixtures.push(flip ? [order[b], order[a]] : [order[a], order[b]]);
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
 * per-season tables. `full` builds the event feeds (scorers, minutes); otherwise only scores are drawn.
 */
function playSeasons({ sport, teams, games, seasons, seed, full = true }) {
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
      if (full) result = sport.simulate(rng, a, d, DRAMA, eff[i], eff[j]);
      else {
        const key = `${i}:${j}`;
        if (!prepared.has(key)) prepared.set(key, sport.prepareMatch(a, d, eff[i], eff[j]));
        result = sport.sampleResult(rng, prepared.get(key), DRAMA);
      }
      const regA = result.regA ?? result.ga, regD = result.regD ?? result.gd;
      const game = { i, j, effI: eff[i], effJ: eff[j], ga: result.ga, gd: result.gd, regA, regD, tie: result.tie,
        winner: result.winner === a.id ? i : j, ev: result.ev };
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

function footballLeague(league, seasons, seed) {
  const clubs = FOOTBALL_CLUBS.filter(c => c.league === league).map(c => buildClub(c, football));
  const games = 2 * (clubs.length - 1);
  const { played, tables } = playSeasons({ sport: football, teams: clubs, games, seasons, seed });
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

function nbaSeason(seasons, seed) {
  const sport = nbaBasketballIn();
  const clubs = NBA_CLUBS.map(c => buildClub(c, sport));
  const { played, tables } = playSeasons({ sport, teams: clubs, games: 82, seasons, seed });
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

function nflSeason(seasons, seed) {
  const clubs = NFL_CLUBS.map(c => buildClub(c, americanFootball));
  const { played, tables } = playSeasons({ sport: americanFootball, teams: clubs, games: 17, seasons, seed });
  const teamPoints = played.flatMap(g => [g.ga, g.gd]);
  const margins = played.map(g => Math.abs(g.ga - g.gd));
  const scores = new Map();
  for (const p of teamPoints) scores.set(p, (scores.get(p) || 0) + 1);
  const positions = new Map(clubs.map(c => [c.id, positionsByName(c)]));
  const tdBy = {};
  let tds = 0;
  for (const g of played) {
    for (const e of g.ev) {
      if (e.pts !== 7) continue;
      const pos = positions.get(e.tid).get(e.name);
      const group = ['WR', 'RB', 'TE', 'QB'].includes(pos) ? pos : 'D/ST';
      tdBy[group] = (tdBy[group] || 0) + 1;
      tds++;
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
    impossibleScores: share(teamPoints, p => [1, 2, 4, 5, 8, 11].includes(p)),
    winPctSd: spread.sd, bestWins: spread.best * 17, worstWins: spread.worst * 17,
    favourite: favouriteRecord(played), homeWins: share(played, g => g.winner === g.j),
    tdShares: Object.fromEntries(Object.entries(tdBy).map(([k, v]) => [k, v / tds])),
  };
}

// ---- Baseball (MLB) -------------------------------------------------------------------------------------------

function mlbSeason(seasons, seed) {
  const clubs = MLB_CLUBS.map(c => buildClub(c, baseball));
  const { played, tables } = playSeasons({ sport: baseball, teams: clubs, games: 162, seasons, seed, full: false });
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
  },
  mlb: {
    note: 'MLB regular seasons 2022–2025',
    runsPerTeam: [4.28, 4.62], extraInnings: [0.083, 0.089], oneRun: [0.278, 0.294],
    // est.: 7.1% over the first 1,734 games of 2022.
    shutoutRate: [0.06, 0.072],
    homeWins: [0.521, 0.543], winPctSd: [0.071, 0.089], bestWins: [97, 111], worstWins: [41, 55],
  },
});

const row = (label, value, range, format = num) => {
  const inside = !range || (value >= range[0] && value <= range[1]);
  const real = range ? `${format(range[0])} – ${format(range[1])}` : '';
  return `  ${inside ? ' ' : '!'} ${label.padEnd(34)} ${String(format(value)).padStart(10)}   ${real}`;
};

export function realismReport({ seasons = 40, seed = 20261101 } = {}) {
  const leagues = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  return {
    football: leagues.map(league => footballLeague(league, seasons, hashStr(`${seed}:${league}`))),
    nba: nbaSeason(seasons, hashStr(`${seed}:nba`)),
    nfl: nflSeason(seasons * 4, hashStr(`${seed}:nfl`)),
    mlb: mlbSeason(seasons, hashStr(`${seed}:mlb`)),
  };
}

function print(report) {
  const lines = [];
  for (const f of report.football) {
    const scale = 38 / f.games;
    const r = REAL.football;
    lines.push(`\n${f.league} — ${f.clubs} clubs, ${f.games} games (real: ${r.note})`);
    lines.push(row('goals a game', f.goalsPerGame, r.goalsPerGame));
    lines.push(row('team goals variance / mean', f.teamGoalsVarianceToMean, r.teamGoalsVarianceToMean));
    lines.push(row('draws', f.drawRate, r.drawRate, pct));
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
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
  const report = realismReport({ seasons: Number(option('seasons')) || 40 });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${print(report)}\n`);
}
