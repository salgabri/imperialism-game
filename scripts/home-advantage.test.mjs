// Home advantage, the launch rule that plays every match at the defender's home (off by default: a neutral venue).
// Each sport's edge lives in its prepared match, so the result, the odds and the live chart read the same edge, and
// equal sides win at home about as often as home sides do in the sport's league (REAL in simulation-realism.mjs). The
// default plays exactly as before: scripts/seed-replay.test.mjs holds the neutral campaigns to their golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { bundleApp, bundleComponents, syncAppFixture } from './lib/app-harness.mjs';
import { buildClub, buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as NBA_CLUBS } from '../src/data/clubs.basketball.js';
import { CLUBS as NFL_CLUBS } from '../src/data/clubs.american-football.js';
import { CLUBS as MLB_CLUBS } from '../src/data/clubs.baseball.js';
import { CLUBS as NHL_CLUBS } from '../src/data/clubs.hockey.js';
import { CLUBS as WOMENS_CLUBS } from '../src/data/clubs.womens-football.js';
import { CLUBS as NRL_CLUBS } from '../src/data/clubs.rugby-league.js';
import { football } from '../src/sports/football.js';
import { basketball, nbaBasketball } from '../src/sports/basketball.js';
import { americanFootball } from '../src/sports/americanFootball.js';
import { baseball } from '../src/sports/baseball.js';
import { hockey } from '../src/sports/hockey.js';
import { womensFootball } from '../src/sports/womensFootball.js';
import { HOME_EDGE, tennis } from '../src/sports/tennis.js';
import { rugbyLeague } from '../src/sports/rugbyLeague.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { liveModelFor, winProbabilityAt } from '../src/engine/winProbability.js';
import { tacticalMatchParameters } from '../src/engine/managerStrategy.js';
import { campaignSnapshot, createCampaignId, parseCampaign } from '../src/engine/storage.js';
import { matchupOdds } from '../src/viewModels/odds.js';
import { campaignFacts, moreRulesSummary } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { DEFAULT_SETUP } from '../src/app/shared.js';
import { runProductionCampaign } from './production-balance.mjs';
import { REAL } from './simulation-realism.mjs';

await bundleApp();
const { SetupOverlay } = await bundleComponents({ SetupOverlay: 'src/components/SetupOverlay.jsx' });

const HOME = { home: true };

/** Two copies of a sport's median built-in club (equal sides), or of a 75-rated lineup for FIBA nations. */
function equalSides(sport, clubs) {
  let side;
  if (clubs) {
    const built = clubs.map(club => buildClub(club, sport)).sort((x, y) => teamEff(x) - teamEff(y));
    side = built[Math.floor(built.length / 2)];
  } else {
    side = { sport: sport.id, squad: sport.positionPlan.map((pos, i) => ({ name: `Player ${i}`, pos, rating: 75 })) };
  }
  return [{ ...side, id: 'a' }, { ...side, id: 'd' }];
}

// Each sport's league range for home wins; FIBA nations share the NBA's (their per-possession edge is the same). Football
// reads in ninety minutes: about 45% home wins and 26% draws, and the shoot-out stays even, so 58% in all. Women's football
// plays the men's model and has no real range to meet: the band only says the men's edge reads the same on its median
// club, whose attack outrates its defence, so its mirror game is an open one (3.5 goals, fewer draws).
const SPORTS = [
  { label: 'football', sport: football, clubs: FOOTBALL_CLUBS, ninety: { homeWins: [0.42, 0.48], draws: [0.24, 0.3], defender: [0.55, 0.61] } },
  { label: "women's football", sport: womensFootball, clubs: WOMENS_CLUBS, ninety: { homeWins: [0.45, 0.51], draws: [0.19, 0.25], defender: [0.56, 0.62] } },
  { label: 'basketball (FIBA)', sport: basketball, clubs: null, range: REAL.nba.homeWins },
  { label: 'basketball (NBA)', sport: nbaBasketball, clubs: NBA_CLUBS, range: REAL.nba.homeWins },
  { label: 'American football', sport: americanFootball, clubs: NFL_CLUBS, range: REAL.nfl.homeWins },
  { label: 'baseball', sport: baseball, clubs: MLB_CLUBS, range: REAL.mlb.homeWins },
  { label: 'ice hockey', sport: hockey, clubs: NHL_CLUBS, range: REAL.nhl.homeWins },
  // Tennis has no clubs: four 75-rated players a side.
  { label: 'tennis', sport: tennis, clubs: null, range: REAL.davisCup.homeWins },
  { label: 'rugby league', sport: rugbyLeague, clubs: NRL_CLUBS, range: REAL.nrl.homeWins },
];
const scoreFields = ({ ga, gd, tie, winner }) => ({ ga, gd, tie, winner });

test('a neutral venue is the default, and plays exactly as before', () => {
  for (const { label, sport, clubs } of SPORTS) {
    const [a, d] = equalSides(sport, clubs);
    const prepared = sport.prepareMatch(a, d, 74, 76);
    assert.deepEqual(sport.prepareMatch(a, d, 74, 76, { home: false }), prepared, label);
    assert.notDeepEqual(sport.prepareMatch(a, d, 74, 76, HOME), prepared, `${label}: home changes the prepared match`);
    for (const seed of [1, 2, 3]) {
      const neutral = sport.simulate(makeRng(seed), a, d, 6, 74, 76);
      assert.deepEqual(sport.simulate(makeRng(seed), a, d, 6, 74, 76, { home: false }), neutral, label);
    }
    // The odds cache keeps its neutral entry; a home venue is an estimate (and a sample stream) of its own.
    const args = { sport, attacker: a, defender: d, samples: 20000 };
    const neutralOdds = estimateWinProbability(args);
    assert.strictEqual(estimateWinProbability({ ...args, home: false }), neutralOdds, label);
    const homeOdds = estimateWinProbability({ ...args, home: true });
    assert.notStrictEqual(homeOdds, neutralOdds);
    assert.ok(homeOdds.defender > neutralOdds.defender + 0.02, `${label}: ${homeOdds.defender} v ${neutralOdds.defender}`);
  }
  const [a, d] = equalSides(football, FOOTBALL_CLUBS);
  assert.equal('home' in tacticalMatchParameters({ attacker: a, defender: d, managedId: null }), false, 'neutral adds nothing');
  assert.equal(tacticalMatchParameters({ attacker: a, defender: d, managedId: 'a', tactic: 'attack', home: true }).home, true);
  assert.equal(DEFAULT_SETUP.homeAdvantage, 'off');
});

test('at home, equal sides win about as often as home sides do in their leagues', () => {
  const samples = 60000;
  for (const { label, sport, clubs, range, ninety } of SPORTS) {
    const [a, d] = equalSides(sport, clubs);
    const prepared = sport.prepareMatch(a, d, undefined, undefined, HOME);
    const rng = makeRng(20261101);
    let defenderWins = 0, homeWins = 0, draws = 0;
    for (let i = 0; i < samples; i++) {
      const result = sport.sampleResult(rng, prepared, 6);
      if (result.winner === 'd') defenderWins++;
      const regA = result.regA ?? result.ga, regD = result.regD ?? result.gd;
      if (regD > regA) homeWins++; else if (regD === regA) draws++;
    }
    if (ninety) {
      const shares = { homeWins: homeWins / samples, draws: draws / samples, defender: defenderWins / samples };
      for (const [key, [low, high]] of Object.entries(ninety)) assert.ok(shares[key] > low && shares[key] < high, `${label} ${key}: ${shares[key]}`);
    } else {
      const share = defenderWins / samples;
      assert.ok(share >= range[0] && share <= range[1], `${label}: the home side won ${share}, real ${range.join('–')}`);
    }
  }
});

test('the edge is the prepared match\'s: the defender gains what the visitors lose, and every path agrees', () => {
  for (const { label, sport, clubs } of SPORTS) {
    const [a, d] = equalSides(sport, clubs);
    const neutral = sport.prepareMatch(a, d, 75, 75), home = sport.prepareMatch(a, d, 75, 75, HOME);
    if ('rubbers' in neutral) {
      // Tennis: one gap a rubber, the attacker's lead, which the host's edge takes down.
      neutral.rubbers.forEach((rubber, i) => assert.ok(Math.abs(rubber.gap - home.rubbers[i].gap
        - (rubber.doubles ? HOME_EDGE.doubles : HOME_EDGE.singles)) < 1e-9, `${label}: rubber ${i + 1}'s edge`));
    } else {
      // Hockey's prepared rates are goals a game and rugby league's tries a game, so their edge is in their logs.
      const inRates = 'rateA' in neutral || 'triesA' in neutral, read = inRates ? Math.log : value => value;
      const [keyA, keyD] = 'rateA' in neutral ? ['rateA', 'rateD'] : 'triesA' in neutral ? ['triesA', 'triesD'] : 'logA' in neutral ? ['logA', 'logD'] : 'efficiencyA' in neutral ? ['efficiencyA', 'efficiencyD'] : ['edgeA', 'edgeD'];
      const gain = read(home[keyD]) - read(neutral[keyD]), loss = read(neutral[keyA]) - read(home[keyA]);
      assert.ok(gain > 0, `${label}: the defender gains`);
      assert.ok(Math.abs(gain - loss) < 1e-9, `${label}: the visitors lose as much (${gain} v ${loss})`);
    }
    if ('kickingA' in neutral) assert.deepEqual([home.kickingA, home.kickingD], [neutral.kickingA, neutral.kickingD], 'kickers unchanged');
    for (const seed of [11, 12, 13, 14]) {
      const full = sport.simulate(makeRng(seed), a, d, 6, 75, 75, HOME);
      assert.deepEqual(scoreFields(sport.sampleResult(makeRng(seed), home, 6)), scoreFields(full), `${label} seed ${seed}`);
    }
  }
});

test('the live chart starts from the home odds', () => {
  // Kick-off tolerances as the sports' own tests hold them against the fixture odds.
  const tolerance = { football: 0.035, 'womens-football': 0.035, basketball: 0.02, 'american-football': 0.03, baseball: 0.02, hockey: 0.02,
    tennis: 0.015, 'rugby-league': 0.02 };
  for (const { label, sport, clubs } of SPORTS) {
    const [a, d] = equalSides(sport, clubs);
    const neutral = liveModelFor(sport, a, d, undefined, undefined, 6);
    const model = liveModelFor(sport, a, d, undefined, undefined, 6, true);
    assert.notDeepEqual(model, neutral, label);
    const start = 1 - winProbabilityAt(model, 0, 0);
    const odds = estimateWinProbability({ sport, attacker: a, defender: d, home: true, samples: 20000 }).defender;
    assert.ok(start > 0.52, `${label}: the defender starts ahead (${start})`);
    assert.ok(Math.abs(start - odds) < tolerance[sport.id], `${label}: kick-off ${start} v odds ${odds}`);
  }
});

test('App: a home-advantage campaign plays the match, its odds and its live chart at the defender\'s home', () => {
  const f = syncAppFixture({ settings: { homeAdvantage: 'on' } });
  try {
    f.app.showPopup = () => {};
    f.app.showToast = () => {};
    const a = f.app.state.teams['250'], d = f.app.state.teams['276'];
    const state = f.app.rng.getState();
    f.app.startMatch('250', '276');
    const m = f.app.state.match, drama = m.matchDrama;
    // The real result is the sport's own draw at home, from the campaign's random stream.
    const rng = makeRng(0);
    rng.setState(state);
    const expected = football.simulate(rng, a, d, drama, m.effA, m.effD, HOME);
    assert.deepEqual([m.winner, m.finalGa, m.finalGd, m.allEv], [expected.winner, expected.ga, expected.gd, expected.ev]);
    assert.equal(f.app.rng.getState(), rng.getState(), 'one match draw, nothing else');
    const odds = estimateWinProbability({ sport: football, attacker: a, defender: d, drama, effA: m.effA, effD: m.effD, home: true, samples: 512 });
    assert.deepEqual(m.odds, { a: odds.attacker, b: odds.defender });
    assert.deepEqual(m.live, liveModelFor(football, a, d, m.effA, m.effD, drama, true));
    assert.notDeepEqual(m.live, liveModelFor(football, a, d, m.effA, m.effD, drama));
    const ctx = f.app.viewContext();
    assert.equal(ctx.homeAdvantage, true);
    assert.equal(matchupOdds(f.app.state, ctx, '250', '276').defender, odds.defender, 'map and column odds read the same rule');
  } finally { f.close(); }
  const neutral = syncAppFixture();
  try { assert.equal(neutral.app.viewContext().homeAdvantage, false); } finally { neutral.close(); }
});

test('saves keep the rule and refuse a value the game does not offer', () => {
  const rng = makeRng(42);
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, rng, football)]));
  const state = { phase: 'playing', settings: { sport: 'football', layer: 'nations', pacing: 'duel', resolution: 'ticker', homeAdvantage: 'on' },
    teams, own: { 250: '250', 276: '276' }, aliveIds: ['250', '276'],
    fallen: [], stats: {}, round: 1, matches: 0, queue: [], history: [], log: [], seed: 42, rngState: rng.getState(),
    followedId: '250', campaignId: createCampaignId(), revision: 0, campaignName: 'Home campaign',
    metrics: { acquisitions: [], leaderChanges: 0 }, match: null, spin: null, choice: null, series: null, tacticalChoice: null };
  assert.equal(parseCampaign(JSON.stringify(campaignSnapshot(state))).settings.homeAdvantage, 'on');
  const odd = structuredClone(state);
  odd.settings.homeAdvantage = 'sometimes';
  assert.throws(() => parseCampaign(JSON.stringify(campaignSnapshot(odd))), /homeAdvantage setting is unsupported/);
});

test('setup offers it under More rules, This campaign lists it when on, and a challenge link carries it', () => {
  assert.equal(moreRulesSummary({ ...DEFAULT_SETUP, homeAdvantage: 'on' }), 'Home advantage: On');
  assert.equal(moreRulesSummary(DEFAULT_SETUP), 'Standard');
  const facts = campaignFacts({ sport: 'basketball', homeAdvantage: 'on' }, { seed: 7 });
  assert.deepEqual(facts.map(row => row.id).slice(-4), ['recruitment', 'home-advantage', 'roster-preset', 'seed']);
  assert.deepEqual(facts.find(row => row.id === 'home-advantage'), { id: 'home-advantage', label: 'Home advantage', value: 'On', stored: 'on' });
  assert.equal(campaignFacts({}).some(row => row.id === 'home-advantage'), false, 'off is the default, as before');

  assert.equal(challengeQuery({ ...DEFAULT_SETUP, homeAdvantage: 'on', finale: 'best-of-three' }, 7), 'final=best-of-three&home=on&seed=7');
  assert.equal(challengeQuery(DEFAULT_SETUP, 7), 'seed=7');
  assert.equal(readChallenge('home=on&seed=7').setup.homeAdvantage, 'on');
  assert.deepEqual(readChallenge('home=sometimes').ignored, ['home']);

  for (const homeAdvantage of ['off', 'on']) {
    const markup = renderToStaticMarkup(React.createElement(SetupOverlay, {
      setup: { ...DEFAULT_SETUP, homeAdvantage }, managerTeams: [], hasSave: false, savedText: '',
      onPick() {}, onStart() {}, onResume() {}, onDiscard() {}, onImport() {}, onManageSaves() {} }));
    const doc = new JSDOM(markup).window.document;
    const select = doc.querySelector('details.setup-advanced #setup-home-advantage');
    assert.ok(select, 'the choice lives in the More rules disclosure');
    assert.equal(select.querySelector('option[selected]')?.value ?? select.value, homeAdvantage);
    assert.match(select.closest('label').querySelector('.control-help').textContent, homeAdvantage === 'on' ? /defending team plays at home/ : /neutral ground/);
  }
});

test('a production campaign with home advantage completes and replays, and plays other matches than a neutral one', () => {
  const parameters = { seed: 73119, sport: 'football', scope: 'CONMEBOL', pacing: 'duel', homeAdvantage: 'on' };
  const first = runProductionCampaign(parameters);
  assert.equal(first.completed, true);
  assert.equal(first.conquests, first.startingTeams - 1);
  assert.deepEqual(runProductionCampaign(parameters), first);
  const { homeAdvantage: _home, ...neutral } = parameters;
  assert.notDeepEqual(first.outcomes, runProductionCampaign(neutral).outcomes);
  // A best-of-three final at home: the series defender hosts every game.
  for (const sport of ['basketball', 'baseball']) {
    const result = runProductionCampaign({ ...parameters, sport, scope: 'elite', pacing: 'blitz', finale: 'best-of-three' });
    assert.equal(result.completed, true, sport);
    assert.equal(result.conquests, result.startingTeams - 1, sport);
  }
});
