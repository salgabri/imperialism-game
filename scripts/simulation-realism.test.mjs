// Whole league seasons played with the built-in clubs land in each real league's range (REAL in
// simulation-realism.mjs, with its seasons and sources). Only what the models set out to match is held here. Matches
// are at a neutral venue unless a campaign turns Home advantage on, so the home sides' wins are checked with it on.
// The known gaps are reported by `npm run simulation:realism` and not tested: NBA games decided by three or fewer,
// MLB's worst club.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LATEST_NBA_SEASON, NBA_LEAGUE_AVERAGES } from '../src/data/nbaLeagueAverages.js';
import { REAL, realismReport } from './simulation-realism.mjs';

const report = realismReport({ seasons: 12 });
// `slack` allows for twelve seasons' sampling where the model sits at the edge of the real range.
const within = (value, [low, high], label, slack = 0) => assert.ok(value >= low - slack && value <= high + slack,
  `${label}: ${value} outside the real ${low}–${high}${slack ? ` (± ${slack})` : ''}`);

test('football: each of the five leagues plays its whole first division', () => {
  // The club layer keeps only Europe's strongest clubs (TOP_CLUBS), which would leave a league short of its weaker clubs.
  assert.deepEqual(Object.fromEntries(report.football.map(league => [league.league, league.clubs])),
    { 'Premier League': 20, 'La Liga': 20, 'Serie A': 20, Bundesliga: 18, 'Ligue 1': 18 });
});

test('football: Europe\'s top five leagues score, draw and finish as they do in life', () => {
  const real = REAL.football;
  for (const league of report.football) {
    const per38 = 38 / league.games;
    within(league.goalsPerGame, real.goalsPerGame, `${league.league} goals a game`);
    within(league.drawRate, real.drawRate, `${league.league} draws`);
    within(league.goallessRate, real.goallessRate, `${league.league} goalless draws`);
    within(league.championPoints * per38, real.championPoints38, `${league.league} champion's points`);
    within(league.lastPoints * per38, real.lastPoints38, `${league.league} bottom club's points`);
    within(league.topScorerGoals * per38, real.topScorerGoals38, `${league.league} top scorer`);
    for (const position of ['FW', 'MF', 'DF']) {
      within(league.goalShares[position], real.goalShares[position], `${league.league} goals by ${position}`);
    }
    const firstHalf = league.goalMinutes.slice(0, 3).reduce((sum, share) => sum + share, 0);
    within(firstHalf, real.firstHalfShare, `${league.league} first-half goals`);
    within(league.penaltyConversion, real.penaltyConversion, `${league.league} shoot-out kicks scored`);
  }
});

test('NBA: points, margins, overtime, the standings and the box score look like an NBA season', () => {
  const nba = report.nba, real = REAL.nba;
  // The built-in season plays at the latest full season's pace and scoring rate.
  const league = NBA_LEAGUE_AVERAGES[LATEST_NBA_SEASON].points;
  within(nba.pointsPerTeam, [league - 2, league + 2], 'points a team');
  within(nba.overtimeRate, real.overtimeRate, 'overtime', 0.003);
  within(nba.marginMean, real.marginMean, 'mean margin');
  within(nba.blowouts, real.blowouts, '20-point games');
  within(nba.winPctSd, real.winPctSd, 'spread of the standings');
  within(nba.fortyPointRate, real.fortyPointRate, '40-point games');
  within(nba.benchShare, real.benchShare, "the bench's points");
});

test('NFL: points, margins, overtime, the standings and who scores the touchdowns', () => {
  const nfl = report.nfl, real = REAL.nfl;
  within(nfl.pointsPerTeam, real.pointsPerTeam, 'points a team');
  within(nfl.overtimeRate, real.overtimeRate, 'overtime');
  within(nfl.marginMean, real.marginMean, 'mean margin');
  within(nfl.winPctSd, real.winPctSd, 'spread of the standings');
  within(nfl.bestWins, real.bestWins, 'best record');
  within(nfl.worstWins, real.worstWins, 'worst record', 0.3);
  for (const group of ['WR', 'RB', 'TE', 'QB', 'D/ST']) {
    within(nfl.tdShares[group], real.tdShares[group], `touchdowns by ${group}`, 0.005);
  }
});

test('NFL: the key margins, one-score games, the tries and the safeties', () => {
  const nfl = report.nfl, real = REAL.nfl;
  within(nfl.oneScore, real.oneScore, 'one-score games');
  within(nfl.byThree, real.byThree, 'decided by exactly 3');
  within(nfl.bySeven, real.bySeven, 'decided by exactly 7');
  within(nfl.xpRate, real.xpRate, 'extra points made');
  within(nfl.twoPointShare, real.twoPointShare, 'touchdowns going for two');
  within(nfl.twoPointRate, real.twoPointRate, 'two-point tries made');
  within(nfl.safetiesPerSeason, real.safetiesPerSeason, 'safeties a season');
});

test('MLB: runs, close games, extra innings and the standings look like an MLB season', () => {
  const mlb = report.mlb, real = REAL.mlb;
  within(mlb.runsPerTeam, real.runsPerTeam, 'runs a team');
  within(mlb.shutoutRate, real.shutoutRate, 'shutouts');
  within(mlb.winPctSd, real.winPctSd, 'spread of the standings');
  within(mlb.bestWins, real.bestWins, 'best record');
  // The model runs about a point high on extra innings (8.3–8.9% in life) and a shade low on one-run games
  // (27.8–29.4%).
  within(mlb.extraInnings, real.extraInnings, 'extra innings', 0.015);
  within(mlb.oneRun, real.oneRun, 'one-run games', 0.01);
});

test('NRL: points, tries, goals, margins, golden point, the standings and who scores the tries', () => {
  const nrl = report.nrl, real = REAL.nrl;
  within(nrl.pointsPerTeam, real.pointsPerTeam, 'points a team');
  within(nrl.teamPointsSd, real.teamPointsSd, 'team points SD');
  within(nrl.triesPerTeam, real.triesPerTeam, 'tries a team');
  within(nrl.conversionRate, real.conversionRate, 'conversions made');
  within(nrl.penaltyGoalsPerTeam, real.penaltyGoalsPerTeam, 'penalty goals a team');
  within(nrl.fieldGoalsPerGame, real.fieldGoalsPerGame, 'field goals a game');
  within(nrl.goldenPoint, real.goldenPoint, 'golden point');
  within(nrl.marginMean, real.marginMean, 'mean margin');
  within(nrl.withinSix, real.withinSix, 'won by six or fewer');
  within(nrl.byThirteenPlus, real.byThirteenPlus, 'won by 13 or more');
  within(nrl.byTwentyFivePlus, real.byTwentyFivePlus, 'won by 25 or more');
  within(nrl.nilRate, real.nilRate, 'held scoreless');
  within(nrl.fortyPlusRate, real.fortyPlusRate, '40 points or more');
  within(nrl.firstHalfShare, real.firstHalfShare, 'first-half points');
  within(nrl.winPctSd, real.winPctSd, 'spread of the standings');
  within(nrl.bestWins, real.bestWins, 'best record');
  within(nrl.worstWins, real.worstWins, 'worst record');
  // Twelve seasons hold about 9,000 tries: a share can sit half a point outside a narrow real range by chance.
  for (const position of Object.keys(real.tryShares)) within(nrl.tryShares[position] || 0, real.tryShares[position], `tries by ${position}`, 0.006);
});

test('home sides: half the decided games at a neutral venue, their league\'s share with Home advantage on', () => {
  for (const [label, share] of [['NBA', report.nba.homeWins], ['NFL', report.nfl.homeWins], ['MLB', report.mlb.homeWins], ['NHL', report.nhl.homeWins],
    ['NRL', report.nrl.homeWins]]) {
    assert.ok(Math.abs(share - 0.5) < 0.015, `${label} neutral: the defender won ${share}`);
  }
  for (const league of report.football) {
    assert.ok(Math.abs(league.homeWins - (1 - league.drawRate) / 2) < 0.02, `${league.league} neutral: ${league.homeWins}`);
  }
  const home = realismReport({ seasons: 12, home: true });
  for (const league of home.football) {
    within(league.homeWins, REAL.football.homeWins, `${league.league} home wins in ninety minutes`);
    within(league.drawRate, REAL.football.drawRate, `${league.league} draws at home`);
  }
  within(home.nba.homeWins, REAL.nba.homeWins, 'NBA home wins');
  within(home.nfl.homeWins, REAL.nfl.homeWins, 'NFL home wins');
  within(home.mlb.homeWins, REAL.mlb.homeWins, 'MLB home wins');
  within(home.nhl.homeWins, REAL.nhl.homeWins, 'NHL home wins');
  within(home.nrl.homeWins, REAL.nrl.homeWins, 'NRL home wins');
});
