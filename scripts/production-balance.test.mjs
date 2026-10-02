import test from 'node:test';
import assert from 'node:assert/strict';
import { runProductionCampaign, summarizeProduction, wilsonInterval, productionMatrix } from './production-balance.mjs';

test('production campaigns replay the same draws, scores, manager decisions and RNG state', () => {
  const parameters = { seed: 73119, sport: 'football', scope: 'CONMEBOL', pacing: 'duel', managerPolicy: 'adaptive', managerRank: 1 };
  const first = runProductionCampaign(parameters), replay = runProductionCampaign(parameters);
  assert.deepEqual(replay, first);
  assert.equal(first.completed, true);
  assert.equal(first.conquests, first.startingTeams - 1);
  assert.ok(first.decisionCount > 0);
  assert.ok(first.firstDecisionMatch >= 1);
  assert.equal(first.outcomes.length, first.matches);
  assert.ok(first.managedMatches > 0);
  assert.ok(Object.values(first.tacticalChoices).reduce((sum, count) => sum + count, 0) > 0);
});

test('production runner covers club seeding, competitive rosters, best-fit capture and a real final series', () => {
  const result = runProductionCampaign({ seed: 73119, sport: 'basketball', layer: 'clubs', clubScope: 'elite',
    pacing: 'blitz', uncertainty: 'wild', finale: 'best-of-three', acquisitionPolicy: 'best-fit', rosterPreset: 'competitive' });
  assert.equal(result.completed, true);
  assert.equal(result.conquests, result.startingTeams - 1);
  assert.ok(result.matches > result.conquests, 'the production final requires multiple games before conquest');
  assert.equal(result.acquisitions, result.conquests);
  assert.ok(result.usefulAcquisitions <= result.acquisitions);
  assert.ok(result.championInitialRank >= 1 && result.championInitialRank <= result.startingTeams);
});

test('confidence intervals and diversity summaries reflect the measured campaign counts', () => {
  assert.equal(wilsonInterval(0, 0), null);
  assert.deepEqual(wilsonInterval(50, 100), [.4038, .5962]);
  const base = { completed: true, acquisitions: 10, usefulAcquisitions: 7, matches: 10, conquests: 9, redraws: 0, acquisitionGain: 3 };
  const summary = summarizeProduction([
    { ...base, champion: 'Alfa', championInitialRank: 1 },
    { ...base, champion: 'Beta', championInitialRank: 8 },
  ]);
  assert.equal(summary.distinctChampions, 2);
  assert.equal(summary.effectiveChampionCount, 2);
  assert.equal(summary.topFiveChampionShare, .5);
  assert.equal(summary.leadingChampionShare, .5);
  assert.equal(summary.usefulAcquisitionShare, .7);
  assert.equal(summary.meanManagedMatches, null);
});

test('coverage matrix includes both layers, all pacing/uncertainty choices and each manager approach', () => {
  const matrix = productionMatrix();
  for (const [field, values] of Object.entries({ sport: ['football', 'basketball'], layer: ['nations', 'clubs'],
    pacing: ['duel', 'blitz', 'chaos'], uncertainty: ['predictable', 'balanced', 'wild'],
    acquisitionPolicy: ['highest-rated', 'best-fit'], rosterPreset: ['authentic', 'competitive'],
    managerPolicy: ['spectator', 'balanced', 'adaptive', 'attack', 'defend'] }))
    for (const value of values) assert.ok(matrix.some(entry => entry[field] === value), `${field}: ${value}`);
  const paired = productionMatrix('competitive');
  assert.equal(paired.length, 2);
  assert.equal(paired[0].sport, 'basketball');
  assert.deepEqual({ ...paired[0], rosterPreset: 'competitive' }, paired[1]);
});
