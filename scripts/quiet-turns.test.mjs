// Background work's turns on the page's thread (src/engine/quietTurns.js), shared by the flag rasteriser and Flags
// mode's warm-up: no turn within QUIET_MS of the player's last input (a watch's start counts as one), several steps
// to a turn within its budget, a stop as soon as the work is no longer wanted, and one set of input listeners on the
// window however many watch. Real timers; the window is a bare EventTarget.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { QUIET_MS, runQuietly, watchInput } from '../src/engine/quietTurns.js';

const target = new EventTarget();
const calls = [];
globalThis.window = {
  addEventListener: (type, listener, options) => { calls.push(['add', type]); target.addEventListener(type, listener, options); },
  removeEventListener: (type, listener, options) => { calls.push(['remove', type]); target.removeEventListener(type, listener, options); },
};
after(() => { delete globalThis.window; });

// Counts trips round the event loop: steps that see the same count ran in one task, so in one turn.
let loops = 0, looping = false;
const loop = () => { loops++; if (looping) setImmediate(loop); };

/** Steps that record when each ran (and in which trip round the event loop), `count` of them, each busy for `ms`. */
function* timedSteps(times, count, ms = 0, trips = []) {
  for (let i = 0; i < count; i++) {
    times.push(performance.now());
    trips.push(loops);
    for (const end = performance.now() + ms; performance.now() < end;);
    yield;
  }
}

test('steps run in turns that wait out the quiet period, several to a turn within its budget', async () => {
  const times = [], trips = [], started = performance.now();
  looping = true;
  loop();
  try {
    assert.equal(await runQuietly(timedSteps(times, 30, 1, trips), { budgetMs: 8 }), true);
  } finally { looping = false; }
  assert.equal(times.length, 30);
  assert.ok(times[0] - started >= QUIET_MS, `the first step ${(times[0] - started).toFixed(0)} ms after the start`);
  // Steps of 1 ms in turns of 8 ms: each turn runs steps until its budget is spent, then gives the page back.
  const turns = [...new Set(trips)].map(trip => times.filter((_, i) => trips[i] === trip));
  assert.ok(turns.length >= 3 && turns.length <= 8, `${turns.length} turns for 30 steps`);
  for (const turn of turns.slice(0, -1)) assert.ok(turn.length >= 2, `${turn.length} steps in a turn of 8 ms`);
});

test('input pushes the next turn back; work no longer wanted stops before its next step', async () => {
  const times = [];
  let wanted = true;
  const steps = timedSteps(times, 1000);
  const run = runQuietly(steps, { budgetMs: 0, wanted: () => wanted });
  await new Promise(resolve => setTimeout(resolve, QUIET_MS / 2));
  const pressed = performance.now();
  target.dispatchEvent(new Event('keydown'));
  await new Promise(resolve => setTimeout(resolve, QUIET_MS * 2));
  assert.ok(times.length > 0 && times[0] - pressed >= QUIET_MS, 'the first step waited a quiet period after the key');
  wanted = false;
  assert.equal(await run, false);
  const ran = times.length;
  await new Promise(resolve => setTimeout(resolve, QUIET_MS * 2));
  assert.equal(times.length, ran, 'no step after it stopped');
});

test('one set of input listeners while any work watches, gone when the last watch ends', async () => {
  calls.length = 0;
  watchInput(true);
  const run = runQuietly(timedSteps([], 3));
  assert.equal(calls.filter(([kind]) => kind === 'add').length, 5, 'press, move, key, wheel and touch, once');
  assert.equal(await run, true);
  assert.equal(calls.filter(([kind]) => kind === 'remove').length, 0, 'still watched');
  watchInput(false);
  assert.equal(calls.filter(([kind]) => kind === 'remove').length, 5);
});
