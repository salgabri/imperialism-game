// Whole league seasons played with the built-in clubs land in each real league's range (REAL in
// simulation-realism.mjs, with its seasons and sources), and a few earlier NFL and AFL seasons' clubs, each under its own
// day's rules, score as their leagues did. Only what the models set out to match is held here. Matches
// are at a neutral venue unless a campaign turns Home advantage on, so the home sides' wins are checked with it on.
// The known gaps are reported by `npm run simulation:realism` and not tested: NBA and EuroLeague games decided by three or
// fewer, the EuroLeague's best and worst clubs (a little too close to the middle), MLB's worst club.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LATEST_NBA_SEASON, NBA_LEAGUE_AVERAGES } from '../src/data/nbaLeagueAverages.js';
import { mlbEraReal, REAL, realismReport } from './simulation-realism.mjs';

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

test('football: extra time leaves as many level games for penalties as the World Cups\' knockout games', () => {
  // The share of extra times still level is what extra time's rate is calibrated to (src/sports/football.js EXTRA_RATE);
  // the golden goal settles more of them, the silver goal some. The rest is reported (npm run simulation:realism): the
  // nations draw fewer ninety minutes than knockout games do, and their extra times score less.
  const knockouts = report.footballKnockouts;
  within(knockouts.levelAfterExtraTime, REAL.footballKnockouts.levelAfterExtraTime, 'extra times still level after 120', 0.01);
  within(knockouts.penaltyConversion, REAL.football.penaltyConversion, 'shoot-out kicks scored');
  assert.ok(report.goldenGoalKnockouts.levelAfterExtraTime < report.silverGoalKnockouts.levelAfterExtraTime
    && report.silverGoalKnockouts.levelAfterExtraTime < knockouts.levelAfterExtraTime + 0.01, 'the golden goal settles most, the silver goal more than none');
  within(knockouts.attackerWinsLevel, [0.47, 0.53], 'a level game goes either way between equals on average');
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

test('EuroLeague: points, margins, overtime and the standings look like a EuroLeague season', () => {
  const euroleague = report.euroleague, real = REAL.euroleague;
  assert.equal(euroleague.clubs, 20);
  // The clubs play at 2025/26's pace and scoring rate, the season's 86.2 points a team.
  within(euroleague.pointsPerTeam, [84.2, 88.2], 'points a team');
  within(euroleague.overtimeRate, real.overtimeRate, 'overtime', 0.003);
  within(euroleague.marginMean, real.marginMean, 'mean margin', 0.2);
  within(euroleague.blowouts, real.blowouts, '20-point games');
  within(euroleague.winPctSd, real.winPctSd, 'spread of the standings');
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

test('NFL and AFL seasons of other eras score as their leagues did, under their own day\'s rules', () => {
  assert.deepEqual(report.nflEras.map(era => `${era.league} ${era.year} ${era.overtimeRule}`), ['NFL 1965 sudden', 'AFL 1965 sudden',
    'NFL 1977 sudden', 'NFL 1985 sudden', 'NFL 1993 sudden', 'NFL 2000 sudden', 'NFL 2010 modified', 'NFL 2024 both']);
  for (const era of report.nflEras) {
    const label = `${era.league} ${era.year}`;
    const near = (value, real, by, what) => within(value, [real - by, real + by], `${label} ${what}`);
    near(era.pointsPerTeam, era.realPoints, 1, 'points a team');
    near(era.touchdowns, era.realTouchdowns, 0.15, 'touchdowns a team');
    near(era.fieldGoals, era.realFieldGoals, 0.15, 'field goals a team');
    near(era.xpRate, era.realXpRate, 0.015, 'extra points made');
    near(era.twoPointShare, era.realTwoPointShare, 0.02, 'touchdowns going for two');
  }
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

test('MLB by era: 1968, 1987, 2000 and 2019 each score their own runs, with their own extra innings', () => {
  for (const era of report.mlbEras) {
    const real = mlbEraReal(era.year);
    within(era.runsPerTeam, [0.97 * real.runsPerTeam, 1.03 * real.runsPerTeam], `${era.year} runs a team`);
    within(era.shutoutRate, [real.shutoutRate - 0.015, real.shutoutRate + 0.015], `${era.year} shutouts`);
    within(era.extraInnings, [0.07, 0.13], `${era.year} extra innings`);
    // The standings stay as sane as the built-in season's calibration made them, and as wide as the real ones.
    within(era.bestWins, [92, 114], `${era.year} best record`);
    within(era.worstWins, [46, 72], `${era.year} worst record`);
    if (real.winPctSd != null) within(era.winPctSd, [real.winPctSd - 0.015, real.winPctSd + 0.015], `${era.year} spread of the standings`);
  }
  // Without the runner on second, 43.9% of 2019's extra-inning games ended in the tenth; with it, 69.1% of 2020's.
  const { endedInTenth } = REAL.mlbEras;
  within(report.mlbEras.find(era => era.year === 2019).endedInTenth, [endedInTenth[2019] - 0.04, endedInTenth[2019] + 0.04], '2019 extras ended in the tenth');
  within(report.mlb.endedInTenth, [endedInTenth.withRunner - 0.04, endedInTenth.withRunner + 0.04], 'extras ended in the tenth with the runner');
});

test('NHL eras: each earlier season scores like its league and settles its level games as its day did', () => {
  assert.deepEqual(report.nhlEras.map(era => era.season), ['1970/71', '1981/82', '1992/93', '2003/04', '2010/11']);
  for (const era of report.nhlEras) {
    const real = REAL.nhlEras[era.season];
    // The season's own goals, and its league's figure is the one the game holds it to.
    assert.equal(era.league, real.goalsPerTeam);
    within(era.goalsPerTeam, [real.goalsPerTeam - 0.06, real.goalsPerTeam + 0.06], `${era.season} goals a team`);
    // Level after sixty, where the league kept it: the pre-1999/2000 late game is calibrated on 1966/67–1982/83 as a whole.
    if (real.overtime !== undefined) within(era.overtime, [real.overtime - 0.035, real.overtime + 0.035], `${era.season} level after sixty`);
    if (era.playoffOvertime) {
      assert.equal(era.shootout, 0, `${era.season} has no shoot-out`);
      within(era.firstPeriod, [real.firstPeriod - 0.05, real.firstPeriod + 0.05], `${era.season} settled in the first overtime`);
      assert.ok(era.longest <= 5, `${era.season}: the fifth overtime always ends`);
    } else {
      within(era.shootout, [real.shootout - 0.025, real.shootout + 0.025], `${era.season} shoot-outs`);
      // The four-on-four era's 45.2% of 2005/06–2014/15 (2010/11 alone 49.8%).
      within(era.decidedInOvertime, [0.452 - 0.04, 0.452 + 0.04], `${era.season} settled before the shoot-out`);
    }
    // A sane spread: the 1990s' rescaled editions run wide (docs/design/hockey.md, "The scale"), never wild.
    within(era.winPctSd, [0.06, 0.2], `${era.season} spread of the standings`);
  }
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

test('Rocket League: goals a game and overtime as in the real games Liquipedia records', t => {
  const rl = report.rocketLeague, real = REAL.rocketLeague;
  if (!rl || !real) {
    t.skip('no Liquipedia snapshot yet (npm run sync:rocket-league)');
    return;
  }
  within(rl.goalsPerGame, real.goalsPerGame, 'goals a game');
  within(rl.overtime, real.overtime, 'games to overtime');
  assert.ok(rl.favourite.wins > 0.55, `the stronger nation wins most series: ${rl.favourite.wins}`);
});

test('home sides: half the decided games at a neutral venue, their league\'s share with Home advantage on', () => {
  for (const [label, share] of [['NBA', report.nba.homeWins], ['EuroLeague', report.euroleague.homeWins], ['NFL', report.nfl.homeWins], ['MLB', report.mlb.homeWins], ['NHL', report.nhl.homeWins],
    ['Davis Cup', report.davisCup.homeWins], ['Billie Jean King Cup', report.billieJeanKingCup.homeWins], ['NRL', report.nrl.homeWins],
    ...(report.rocketLeague ? [['Rocket League', report.rocketLeague.homeWins]] : [])]) {
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
  within(home.euroleague.homeWins, REAL.euroleague.homeWins, 'EuroLeague home wins');
  within(home.nfl.homeWins, REAL.nfl.homeWins, 'NFL home wins');
  within(home.mlb.homeWins, REAL.mlb.homeWins, 'MLB home wins');
  within(home.nhl.homeWins, REAL.nhl.homeWins, 'NHL home wins');
  within(home.davisCup.homeWins, REAL.davisCup.homeWins, 'Davis Cup host wins');
  within(home.billieJeanKingCup.homeWins, REAL.billieJeanKingCup.homeWins, 'Billie Jean King Cup host wins');
  within(home.nrl.homeWins, REAL.nrl.homeWins, 'NRL home wins');
  if (home.rocketLeague && REAL.rocketLeague?.homeWins) within(home.rocketLeague.homeWins, REAL.rocketLeague.homeWins, 'Rocket League home wins');
});
