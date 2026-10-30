// Determinism golden (PLAN §4.1 step 0, DEC D1). Captured once on the pristine
// d757dbd tree: seeded production campaigns must replay the same outcomes, final
// RNG state, match count, champion and manager decision count. Never regenerate
// this golden to make a change pass; only the orchestrator may, with a written reason.
// Regenerate (orchestrator only): UPDATE_GOLDEN=1 node --test scripts/seed-replay.test.mjs
// Regenerated once for the home nations: Scotland (XI 79) joined the Elite 32 and the British map was cut in four,
// so c-elite-blitz plays a different field; the two CONMEBOL cases replay unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runProductionCampaign } from './production-balance.mjs';

const goldenUrl = new URL('./data/seed-replay.golden.json', import.meta.url);
const updating = process.env.UPDATE_GOLDEN === '1';

const spectatorDuel = { seed: 73119, sport: 'football', scope: 'CONMEBOL', pacing: 'duel', resolution: 'instant' };
const CASES = {
  'a-spectator-duel': spectatorDuel,
  'b-manager-adaptive': { ...spectatorDuel, managerPolicy: 'adaptive', managerRank: 1 },
  'c-elite-blitz': { seed: 20261002, sport: 'football', scope: 'elite', pacing: 'blitz', resolution: 'instant' },
};

function record(parameters) {
  const { outcomes, finalRngState, matches, championId, decisionCount } = runProductionCampaign(parameters);
  return { outcomes, finalRngState, matches, championId, decisionCount };
}

const actual = Object.fromEntries(Object.entries(CASES).map(([name, parameters]) => [name, record(parameters)]));

if (updating) {
  test('seed-replay golden is written from the current tree', () => {
    mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
    writeFileSync(goldenUrl, `${JSON.stringify({ capturedAt: 'd757dbd', cases: CASES, results: actual }, null, 2)}\n`);
    assert.ok(existsSync(goldenUrl));
  });
} else {
  const golden = existsSync(goldenUrl) ? JSON.parse(readFileSync(goldenUrl, 'utf8')) : null;
  test('seed-replay golden exists', () => {
    assert.ok(golden, `missing ${fileURLToPath(goldenUrl)}`);
    assert.deepEqual(Object.keys(golden.results).sort(), Object.keys(CASES).sort());
    assert.deepEqual(golden.cases, CASES);
  });
  for (const name of Object.keys(CASES)) {
    test(`seed replay ${name} matches the golden`, () => {
      assert.ok(golden?.results?.[name], `golden has no case ${name}`);
      const expected = golden.results[name];
      assert.equal(actual[name].matches, expected.matches, 'match count');
      assert.equal(actual[name].championId, expected.championId, 'champion');
      assert.equal(actual[name].decisionCount, expected.decisionCount, 'manager decision count');
      assert.equal(actual[name].finalRngState, expected.finalRngState, 'final campaign RNG state');
      assert.deepEqual(actual[name].outcomes, expected.outcomes, 'match outcomes');
      assert.deepEqual(actual[name], expected);
    });
  }
}

test('seed-replay cases are non-trivial', () => {
  for (const [name, result] of Object.entries(actual)) {
    assert.ok(result.championId, `${name} produced a champion`);
    assert.equal(result.outcomes.length, result.matches, `${name} records one outcome per match`);
    assert.ok(Number.isInteger(result.finalRngState), `${name} RNG state is an integer`);
  }
  assert.ok(actual['b-manager-adaptive'].decisionCount > 0, 'manager case records decisions');
});
