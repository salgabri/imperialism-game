import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, teamEff, buildTeam, selectLineup } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { tacticalOptions, tacticalMatchParameters, tacticalProfile, competitiveBasketballTeams } from '../src/engine/managerStrategy.js';
import { acquisitionCandidates, acquisitionOptions, automaticAcquisition } from '../src/engine/campaignExperience.js';

function team(id, rating = 75, sportId = 'football') {
  const sport = getSport(sportId);
  return { id, sport: sportId, str: rating,
    squad: sport.positionPlan.map((pos, index) => ({ name: `${id}-${index}`, pos, rating })) };
}

test('tactics change the controlled side only, with a strength/variation tradeoff', () => {
  const attacker = team('a'), defender = team('d');
  const attack = tacticalMatchParameters({ attacker, defender, managedId: 'd', tactic: 'attack', drama: 6 });
  const balanced = tacticalMatchParameters({ attacker, defender, managedId: 'd', tactic: 'balanced', drama: 6 });
  const defend = tacticalMatchParameters({ attacker, defender, managedId: 'd', tactic: 'defend', drama: 6 });
  assert.equal(attack.effA, 75);
  assert.ok(attack.effD > balanced.effD);
  assert.ok(attack.drama > balanced.drama);
  assert.ok(defend.effD < balanced.effD);
  assert.ok(defend.drama < balanced.drama);
  assert.deepEqual(tacticalMatchParameters({ attacker, defender, managedId: 'absent', tactic: 'attack', drama: 6 }),
    { effA: 75, effD: 75, drama: 6, tactic: 'balanced', bonus: 0, support: 0, varianceMultiplier: 1 });
  assert.deepEqual(tacticalMatchParameters({ attacker, defender, managedId: 'd', tactic: 'invalid', drama: 6 }), balanced);
  assert.ok(tacticalOptions(attacker, defender, 0).find(option => option.id === 'attack').drama > 0,
    'Attack retains its risk even in Predictable campaigns');
});

test('a reserve supports its natural role, does not displace better starters and cannot stack', () => {
  const winner = team('a', 90);
  const reserve = { name: 'Reserve defender', pos: 'DF', rating: 80 };
  const supported = { ...winner, squad: [...winner.squad, reserve] };
  assert.equal(teamEff(supported), teamEff(winner));
  assert.equal(tacticalProfile(supported).attack, 0);
  assert.ok(tacticalProfile(supported).defend > 0);
  assert.deepEqual(tacticalProfile({ ...winner, squad: [...winner.squad, ...Array(30).fill(reserve)] }), tacticalProfile(supported));
  assert.ok(tacticalProfile({ ...winner, squad: [...winner.squad, { ...reserve, rating: 500 }] }).defend <= 1.2);
  const before = tacticalOptions(winner, team('d', 80), 6).find(option => option.id === 'defend');
  const after = tacticalOptions(supported, team('d', 80), 6).find(option => option.id === 'defend');
  assert.ok(after.strength > before.strength, 'a bench signing has a real match parameter effect');
});

test('signing cards cover lineup and tactical roles and show the exact legal before/after lineup', () => {
  const winner = team('a', 80);
  const loser = { ...team('d'), squad: [
    { name: 'Forward', pos: 'FW', rating: 83 },
    { name: 'Reserve defender', pos: 'DF', rating: 79 },
    { name: 'Midfielder', pos: 'MF', rating: 81 },
  ] };
  const options = acquisitionOptions(winner, loser);
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map(candidate => candidate.index)).size, 3);
  const immediate = options.find(candidate => candidate.name === 'Forward');
  const defensive = options.find(candidate => candidate.name === 'Reserve defender');
  assert.ok(immediate.gain > defensive.gain);
  assert.ok(defensive.defendGain > immediate.defendGain);
  assert.ok(defensive.gain + defensive.defendGain > immediate.gain + immediate.defendGain,
    'the defensive reserve is preferable when prioritising Defend');
  assert.equal(defensive.entersLineup, false);
  assert.deepEqual(defensive.lineupPreview.after, defensive.lineupPreview.before);
  for (const candidate of options) {
    const after = selectLineup({ ...winner, squad: [...winner.squad, loser.squad[candidate.index]] });
    assert.equal(candidate.lineupPreview.afterRating, after.rating);
    assert.deepEqual(candidate.lineupPreview.after.map(slot => slot.name), after.slots.map(slot => slot.player.name));
  }
  assert.equal(acquisitionOptions(winner, loser, { limit: 2 }).length, 2);
  assert.equal(acquisitionOptions(winner, { ...loser, squad: [] }).length, 0);
});

test('automatic best-fit recruitment chooses the biggest legal gain, with stable rating/index ties', () => {
  const winner = team('a', 80);
  winner.squad.filter(player => player.pos === 'FW').forEach(player => { player.rating = 97; });
  winner.squad.filter(player => player.pos === 'MF').forEach(player => { player.rating = 60; });
  const loser = { ...team('d'), squad: [
    { name: 'Star forward', pos: 'FW', rating: 98 },
    { name: 'Useful midfielder', pos: 'MF', rating: 90 },
    { name: 'Equal midfielder', pos: 'MF', rating: 90 },
  ] };
  assert.equal(automaticAcquisition(winner, loser).index, 0);
  assert.equal(automaticAcquisition(winner, loser, 'best-fit').index, 1);
  assert.ok(acquisitionCandidates(winner, loser)[1].gain > acquisitionCandidates(winner, loser)[0].gain);
  assert.equal(automaticAcquisition(winner, { ...loser, squad: [] }, 'best-fit'), null);
});

test('competitive basketball compresses starting gaps, preserves player gaps and leaves authentic input intact', () => {
  const sport = getSport('basketball');
  const authentic = Object.fromEntries(['840', '250', '276', '392'].map(id => [id, buildTeam(id, makeRng(12), sport)]));
  const snapshot = structuredClone(authentic);
  assert.equal(competitiveBasketballTeams(authentic), authentic);
  const competitive = competitiveBasketballTeams(authentic, 'competitive');
  const range = values => Math.max(...values) - Math.min(...values);
  assert.ok(range(Object.values(competitive).map(teamEff)) < range(Object.values(authentic).map(teamEff)) * .4);
  assert.deepEqual(authentic, snapshot);
  for (const [id, current] of Object.entries(competitive)) {
    const before = authentic[id];
    assert.equal(current.authenticEff, teamEff(before));
    for (let index = 0; index < current.squad.length; index++) {
      assert.equal(current.squad[index].authenticRating, before.squad[index].rating);
      assert.ok(current.squad[index].rating >= 1 && current.squad[index].rating <= 99);
      assert.ok(Math.abs((current.squad[index].rating - current.squad[0].rating)
        - (before.squad[index].rating - before.squad[0].rating)) < .001);
    }
  }
  const football = { a: team('a') };
  assert.equal(competitiveBasketballTeams(football, 'competitive').a, football.a);
});

// Outcome evidence uses the sport's production score sampler, not an invented
// logistic formula. Matched seeds keep comparisons repeatable; broad gaps avoid
// overfitting exact percentages to a particular simulation revision.
for (const sportId of ['football', 'basketball']) {
  test(`${sportId}: an attacking underdog and a defending favourite have different useful approaches`, () => {
    const sport = getSport(sportId);
    const winRates = gap => {
      const attacker = team('a', 75 + gap, sportId), defender = team('d', 75, sportId);
      return Object.fromEntries(['attack', 'balanced', 'defend'].map(tactic => {
        const params = tacticalMatchParameters({ attacker, defender, managedId: 'a', tactic, drama: 6 });
        const prepared = sport.prepareMatch(attacker, defender, params.effA, params.effD);
        const rng = makeRng(7293);
        let wins = 0;
        for (let trial = 0; trial < 20_000; trial++) wins += sport.sampleResult(rng, prepared, params.drama).winner === 'a';
        return [tactic, wins / 20_000];
      }));
    };
    const underdog = winRates(-10), favourite = winRates(15);
    assert.ok(underdog.attack > underdog.balanced + .02, JSON.stringify(underdog));
    assert.ok(underdog.balanced > underdog.defend, JSON.stringify(underdog));
    assert.ok(favourite.defend > favourite.balanced, JSON.stringify(favourite));
    assert.ok(favourite.balanced > favourite.attack + .02, JSON.stringify(favourite));
    if (sportId === 'basketball') {
      const close = winRates(3);
      assert.ok(close.balanced > close.attack && close.balanced > close.defend, JSON.stringify(close));
    }
  });
}
