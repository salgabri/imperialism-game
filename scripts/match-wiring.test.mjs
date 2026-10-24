// Owner: WP-MATCH (wiring pass). App ↔ src/app/matchMethods.jsx: the kickoff schedule (events at 450 + m·msPerUnit
// and one whistle, all through `this.after`), the single-token live minute chain on `this.clock.after` (DEC D7: the
// minute lives in `app.minuteStore`, never in `state.match`), pause/resume and clearTimers, revealAll, A-12 speed
// changes (events, whistle, chain and shoot-out kicks re-timed with no duplicates), `match.live` from liveModelFor
// (no campaign RNG), the additive `matchCard` field and the MatchScreen model (PLAN §3.3 match notes, §4.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { bundleApp, bundleComponents, syncAppFixture, findElement, withDom, mount } from './lib/app-harness.mjs';
import { teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { liveModelFor } from '../src/engine/winProbability.js';
import { SAVE_KEY } from '../src/config.js';

await bundleApp();
const { MatchScreen } = await bundleComponents({ MatchScreen: 'src/screens/match/MatchScreen.jsx' });

const FOOTBALL = getSport('football');
const UNIT = FOOTBALL.clock.msPerUnit; // 46
const LEAD = 450;
const WHISTLE = LEAD + (FOOTBALL.clock.length + 1) * UNIT;

/** A decided, not yet revealed football match between 250 and 276; `events` = [[minute, teamId], …] in order. */
function liveMatch(app, events = [], extra = {}) {
  const allEv = events.map(([m, tid], i) => ({ m, tid, name: app.state.teams[tid].squad[(i % 5) + 1].name, pts: 1 }));
  const ga = allEv.filter(e => e.tid === '250').length, gd = allEv.length - ga;
  return { aId: '250', dId: '276', effA: teamEff(app.state.teams['250']), effD: teamEff(app.state.teams['276']),
    ga: 0, gd: 0, shown: [], allEv, winner: ga >= gd ? '250' : '276', finalGa: ga, finalGd: gd, tie: null, tieShown: null,
    status: FOOTBALL.labels.live, applied: false, done: false, express: false, ...extra };
}

/** Popups and toasts schedule their own (non-match) timers; silence them so the clock holds only match work. */
function quiet(app) {
  app.showPopup = () => {};
  app.showToast = () => {};
}

function spyAfter(app) {
  const calls = [];
  const after = app.after.bind(app);
  app.after = (ms, fn, speed) => { calls.push(ms); return after(ms, fn, speed); };
  return calls;
}

function spyPushEvent(app) {
  const pushed = [];
  const pushEvent = app.pushEvent.bind(app);
  app.pushEvent = e => { pushed.push(e.m); pushEvent(e); };
  return pushed;
}

const pendingMatchTasks = app => [...app.matchTasks].filter(token => app.clock.tasks.has(token));
const minute = app => app.minuteStore.get();

test('ticker kickoff: events at 450 + m·msPerUnit and one whistle through this.after; the minute chain uses the clock', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    const calls = spyAfter(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276']]) });
    f.app.minuteStore.set(77); // a stale minute from an earlier match
    f.app.presentMatch();
    assert.deepEqual(calls, [LEAD + 10 * UNIT, LEAD + 40 * UNIT, WHISTLE], 'two events and one whistle, nothing else');
    assert.equal(pendingMatchTasks(f.app).length, 3, 'every match task is tracked');
    assert.ok(f.app.minuteToken && f.app.clock.tasks.has(f.app.minuteToken), 'the chain is one clock token');
    assert.ok(!f.app.matchTasks.has(f.app.minuteToken), 'the chain is not one of the match tasks');
    assert.equal(minute(f.app), 0, 'kickoff resets the store');

    f.time.advance(LEAD + UNIT - 1);
    assert.equal(minute(f.app), 0);
    f.time.advance(1);
    assert.equal(minute(f.app), 1, "minute 1 at 450 + 1·46");
    f.time.advance(8 * UNIT);
    assert.equal(minute(f.app), 9);
    assert.equal(f.app.state.match.shown.length, 0);
    f.time.advance(UNIT);
    assert.equal(f.app.state.match.shown.length, 1, 'the minute-10 event');
    assert.equal(minute(f.app), 10);

    const match = f.app.state.match;
    f.time.advance(5 * UNIT);
    assert.equal(minute(f.app), 15);
    assert.equal(f.app.state.match, match, 'minute ticks never set state.match (DEC D7)');
    assert.ok(!Object.keys(f.app.state.match).some(key => /minute|clock/i.test(key)), 'no minute field in the saved match');
  } finally { f.close(); }
});

test('pause freezes the chain with the match; resume continues it; clearTimers drops it', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[30, '250']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 2 * UNIT);
    assert.equal(minute(f.app), 2);
    f.app.pausePlayback();
    assert.equal(f.app.clock.paused, true);
    assert.equal(f.time.pending.size, 0, 'no armed timer while paused');
    f.time.advance(100000);
    assert.equal(minute(f.app), 2);
    f.app.pausePlayback();
    f.time.advance(UNIT - 1);
    assert.equal(minute(f.app), 2);
    f.time.advance(1);
    assert.equal(minute(f.app), 3, 'the remaining delay is preserved');
    f.app.clearTimers();
    assert.equal(f.app.minuteToken, null);
    assert.equal(f.time.pending.size, 0);
    f.time.advance(100000);
    assert.equal(minute(f.app), 3);
  } finally { f.close(); }
});

test('the chain stops at the last tick, the whistle settles the minute and leaves only the result task', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    let finished = 0;
    f.app.finishMatch = () => { finished++; };
    f.app.setState({ match: liveMatch(f.app) });
    f.app.presentMatch();
    f.time.advance(LEAD + FOOTBALL.clock.length * UNIT);
    assert.equal(minute(f.app), 90);
    assert.equal(f.app.minuteToken, null, 'the chain ends at the last tick');
    assert.equal(f.app.state.match.status, FOOTBALL.labels.live);
    f.time.advance(UNIT);
    assert.equal(f.app.state.match.status, FOOTBALL.labels.end);
    assert.equal(minute(f.app), 90);
    assert.equal(f.app.timers.size, 1, 'only the result task remains');
    f.time.advance(420);
    assert.equal(finished, 1);
    assert.equal(f.app.timers.size, 0);
  } finally { f.close(); }
});

test('basketball overtime: the chain runs to the last overtime minute', () => {
  const f = syncAppFixture({ settings: { sport: 'basketball' } });
  try {
    quiet(f.app);
    f.app.finishMatch = () => {};
    const sport = getSport('basketball');
    f.app.setState({ match: { ...liveMatch(f.app, [[12, '250'], [43, '276']]), status: sport.labels.live,
      tie: { periods: [{}] } } });
    f.app.presentMatch();
    f.time.advance(LEAD + 43 * sport.clock.msPerUnit);
    assert.equal(minute(f.app), 43);
    assert.equal(f.app.minuteToken, null);
    assert.equal(f.app.state.match.shown.length, 2);
    f.time.advance(sport.clock.msPerUnit);
    assert.equal(f.app.state.match.status, sport.labels.tie);
  } finally { f.close(); }
});

test('late timers never accumulate: the minute stays on the event and whistle timeline (one anchor)', () => {
  for (const speed of [1, 4]) {
    const f = syncAppFixture();
    try {
      quiet(f.app);
      f.app.finishMatch = () => {};
      f.app.setState({ speed });
      // Every timer the clock arms fires LATE ms after it was due (a render, a busy main thread). The old
      // relative chain lost LATE per tick: 88' landed with the clock near 77' and the whistle jumped ~10 minutes.
      const LATE = 6;
      const schedule = f.app.clock.schedule;
      f.app.clock.schedule = (fn, ms) => schedule(fn, ms + LATE);
      const atPush = [];
      const pushEvent = f.app.pushEvent.bind(f.app);
      f.app.pushEvent = e => { atPush.push([e.m, minute(f.app)]); pushEvent(e); };
      let beforeWhistle = null;
      const stop = f.app.stopMinuteClock.bind(f.app);
      f.app.stopMinuteClock = () => { if (f.app.state.match?.status === FOOTBALL.labels.live) beforeWhistle = minute(f.app); stop(); };
      f.app.setState({ match: liveMatch(f.app, [[40, '250'], [62, '276'], [88, '250']]) });
      f.app.presentMatch();
      const step = UNIT / speed;
      f.time.advance(LEAD / speed + 30 * step + LATE);
      assert.equal(minute(f.app), 30, `${speed}×: thirty late ticks, still minute 30`);
      f.time.advance(60 * step);
      assert.equal(minute(f.app), 90, `${speed}×: the last tick lands on time`);
      assert.equal(f.app.state.match.status, FOOTBALL.labels.live, 'the whistle has not gone yet');
      assert.deepEqual(atPush.map(([m]) => m), [40, 62, 88]);
      for (const [m, shown] of atPush) assert.ok(shown >= m - 1, `${speed}×: the ${m}' goal found the clock at ${shown}'`);
      f.time.advance(step);
      assert.equal(f.app.state.match.status, FOOTBALL.labels.end);
      assert.equal(beforeWhistle, 90, `${speed}×: no jump to full time`);
    } finally { f.close(); }
  }
});

test('a tick that runs very late catches up to the schedule instead of falling behind', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[60, '250']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 10 * UNIT);
    assert.equal(minute(f.app), 10);
    // One 5-minute stall: the next timer fires 5·UNIT late; the clock reads the anchor and shows the scheduled minute.
    const schedule = f.app.clock.schedule;
    let stalled = false;
    f.app.clock.schedule = (fn, ms) => schedule(fn, ms + (stalled ? 0 : (stalled = true, 5 * UNIT)));
    // Restart the chain at minute 10 through the stalling scheduler: minute 11's timer is the one delayed.
    f.app.startMinuteClock(10, 90, UNIT, 1, 0);
    f.time.advance(6 * UNIT);
    assert.equal(minute(f.app), 16, 'minute 11 ran 5 minutes late and showed 16, not 11');
    f.time.advance(UNIT);
    assert.equal(minute(f.app), 17, 'then back on the per-minute schedule');
  } finally { f.close(); }
});

test('the minute never runs ahead of the next unrevealed event', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250']]) });
    f.app.pushEvent = () => {}; // the event is "late": it has not reached state yet
    f.app.presentMatch();
    f.time.advance(LEAD + 25 * UNIT);
    assert.equal(minute(f.app), 10);
  } finally { f.close(); }
});

test('speed 1× → 4× at minute k re-times the next event to (m − k)·msPerUnit/4, the whistle and the chain, once', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    let finished = 0;
    f.app.finishMatch = () => { finished++; };
    const pushed = spyPushEvent(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276'], [70, '250']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 20 * UNIT);
    assert.equal(minute(f.app), 20);
    assert.deepEqual(pushed, [10]);
    const stale = pendingMatchTasks(f.app);
    f.app.setSpeed(4);
    assert.equal(f.app.state.speed, 4);
    assert.ok(stale.every(token => !f.app.clock.tasks.has(token)), 'the old tokens are cancelled');
    assert.equal(pendingMatchTasks(f.app).length, 3, 'two events and the whistle, re-timed');
    f.time.advance((40 - 20) * UNIT / 4 - 1);
    assert.deepEqual(pushed, [10]);
    f.time.advance(1);
    assert.deepEqual(pushed, [10, 40], 'the next event lands at (40 − 20)·46/4');
    assert.equal(minute(f.app), 40, 'the chain runs at the new rate');
    f.time.advance((70 - 40) * UNIT / 4);
    assert.deepEqual(pushed, [10, 40, 70]);
    f.time.advance((91 - 70) * UNIT / 4);
    assert.equal(f.app.state.match.status, FOOTBALL.labels.end, 'the whistle moved too');
    assert.equal(minute(f.app), 90);
    f.time.advance(420 / 4);
    assert.equal(finished, 1);
    assert.deepEqual(pushed, [10, 40, 70], 'no event ran twice');
    assert.equal(f.app.state.match.shown.length, 3);
    assert.equal(f.app.timers.size, 0);
  } finally { f.close(); }
});

test('a speed change while paused re-times from the frozen minute and waits for resume', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 20 * UNIT);
    f.app.pausePlayback();
    f.app.setSpeed(2);
    assert.equal(f.time.pending.size, 0, 'nothing is armed while paused');
    f.time.advance(100000);
    assert.equal(f.app.state.match.shown.length, 1);
    assert.equal(minute(f.app), 20);
    f.app.pausePlayback();
    f.time.advance((40 - 20) * UNIT / 2 - 1);
    assert.equal(f.app.state.match.shown.length, 1);
    f.time.advance(1);
    assert.equal(f.app.state.match.shown.length, 2);
    assert.equal(minute(f.app), 40);
  } finally { f.close(); }
});

test('shoot-out: a speed change re-times the remaining kicks and the result; after full time nothing moves', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    let finished = 0;
    f.app.finishMatch = () => { finished++; };
    const tie = { A: [1, 1, 0], D: [1, 0, 1], first: 'A', ga: 2, gd: 2 };
    f.app.setState({ match: liveMatch(f.app, [], { tie }) });
    f.app.presentMatch();
    f.time.advance(WHISTLE);
    assert.equal(f.app.state.match.status, FOOTBALL.labels.tie);
    f.time.advance(350);
    assert.equal(f.app.state.match.tieShown.A.length, 1, 'the first kick at +350');
    f.app.setSpeed(2);
    f.time.advance(250 / 2 - 1);
    assert.equal(f.app.state.match.tieShown.D.length, 0);
    f.time.advance(1);
    assert.equal(f.app.state.match.tieShown.D.length, 1, 'the next kick 250/2 after the change');
    f.time.advance(4 * 250 / 2);
    assert.deepEqual(f.app.state.match.tieShown, { A: tie.A, D: tie.D }, 'every kick once, in order');
    assert.equal(finished, 0);
    f.time.advance(650 / 2 - 1);
    assert.equal(finished, 0);
    f.time.advance(1);
    assert.equal(finished, 1, 'the result 650/2 after the last kick');
    assert.equal(f.app.timers.size, 0);
  } finally { f.close(); }

  const g = syncAppFixture();
  try {
    quiet(g.app);
    let finished = 0;
    g.app.finishMatch = () => { finished++; };
    g.app.setState({ match: liveMatch(g.app) });
    g.app.presentMatch();
    g.time.advance(WHISTLE);
    assert.equal(g.app.state.match.status, FOOTBALL.labels.end);
    const [result] = pendingMatchTasks(g.app);
    g.app.setSpeed(4);
    assert.deepEqual(pendingMatchTasks(g.app), [result], 'between the whistle and the result the task is kept');
    g.time.advance(419);
    assert.equal(finished, 0);
    g.time.advance(1);
    assert.equal(finished, 1);
  } finally { g.close(); }
});

test('revealAll stops the chain, shows the final minute and drops pending ticker work', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    let finished = 0;
    f.app.finishMatch = () => { finished++; };
    const pushed = spyPushEvent(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 20 * UNIT);
    f.app.revealAll();
    assert.equal(f.app.minuteToken, null);
    assert.equal(minute(f.app), 90);
    assert.equal(pendingMatchTasks(f.app).length, 0);
    assert.equal(f.app.state.match.shown.length, 2);
    f.time.advance(10000);
    assert.equal(finished, 1);
    assert.deepEqual(pushed, [10], 'no event is pushed after the reveal');
    assert.equal(f.app.state.match.shown.length, 2);
  } finally { f.close(); }
});

test('Finish match drops the kickoff notice and goal toast whose clears it cancels', () => {
  const f = syncAppFixture();
  try {
    f.app.finishMatch = () => {};
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276']]) });
    f.app.presentMatch();
    f.time.advance(LEAD + 10 * UNIT);
    assert.ok(f.app.state.pu, 'the kickoff notice is still up');
    assert.ok(f.app.state.toast, 'the minute-10 goal toast is up');
    f.app.fastForward();
    assert.equal(f.app.state.pu, null);
    assert.equal(f.app.state.toast, null);
    f.time.advance(10000);
    assert.equal(f.app.state.toast, null, 'nothing is left to show a stale goal over the result');
  } finally { f.close(); }
});

test('instant and express reveals show the final minute and give the match clock nothing to re-time', () => {
  for (const [settings, extra] of [[{ resolution: 'instant' }, {}], [{}, { express: true }], [{}, { instant: true }]]) {
    const f = syncAppFixture({ settings });
    try {
      quiet(f.app);
      let finished = 0;
      f.app.finishMatch = () => { finished++; };
      f.app.setState({ match: liveMatch(f.app, [[10, '250']], extra) });
      f.app.minuteStore.set(3);
      f.app.presentMatch();
      assert.equal(minute(f.app), 90, JSON.stringify({ settings, extra }));
      assert.equal(f.app.minuteToken, null);
      assert.equal(pendingMatchTasks(f.app).length, 0);
      f.app.setSpeed(2);
      assert.equal(pendingMatchTasks(f.app).length, 0, 'no ticker work appears after a speed change');
      f.time.advance(10000);
      assert.equal(finished, 1);
      assert.equal(f.app.state.match.shown.length, 1);
    } finally { f.close(); }
  }
});

test('a resumed ticker restarts the chain from the last revealed minute', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    const match = liveMatch(f.app, [[10, '250'], [40, '276']]);
    f.app.setState({ match: { ...match, shown: match.allEv.slice(0, 1), ga: 1 } });
    f.app.minuteStore.set(88);
    const calls = spyAfter(f.app);
    f.app.presentMatch();
    assert.equal(minute(f.app), 10);
    assert.deepEqual(calls, [LEAD + 30 * UNIT, LEAD + 81 * UNIT]);
    f.time.advance(LEAD + UNIT);
    assert.equal(minute(f.app), 11);
  } finally { f.close(); }
});

test('startMatch stores match.live from liveModelFor; the model consumes no campaign RNG', () => {
  const run = stub => {
    const f = syncAppFixture();
    try {
      quiet(f.app);
      if (stub) f.app.matchLiveModel = () => null;
      f.app.startMatch('250', '276');
      return { match: f.app.state.match, rng: f.app.rng.getState(), teams: f.app.state.teams };
    } finally { f.close(); }
  };
  const real = run(false), stubbed = run(true);
  assert.equal(real.rng, stubbed.rng, 'same RNG state with and without the live model');
  assert.equal(real.match.live.kind, 'poisson');
  assert.deepEqual(real.match.live, liveModelFor(FOOTBALL, real.teams['250'], real.teams['276'], real.match.effA,
    real.match.effD, real.match.matchDrama));
  assert.ok(JSON.stringify(real.match.live).length < 300, 'small JSON (rule 12)');

  const f = syncAppFixture({ settings: { sport: 'basketball' } });
  try {
    const before = f.app.rng.getState();
    const a = f.app.state.teams['250'], d = f.app.state.teams['276'];
    const model = f.app.matchLiveModel(getSport('basketball'), a, d, teamEff(a), teamEff(d), 6);
    assert.equal(model.kind, 'normal');
    assert.equal(f.app.rng.getState(), before);
    assert.equal(f.app.matchLiveModel(FOOTBALL, null, d, 80, 80, 6), null);
  } finally { f.close(); }
});

test('matchCard keeps the frozen model, adds minuteFallback, and is empty outside a campaign', () => {
  const f = syncAppFixture();
  try {
    const match = liveMatch(f.app, [[10, '250'], [40, '276']]);
    f.app.setState({ match: { ...match, shown: match.allEv, ga: 1, gd: 1 } });
    const card = f.app.matchCard();
    for (const key of ['round', 'mode', 'status', 'statusColor', 'statusLive', 'startLabel', 'a', 'b', 'kicks', 'events',
      'noEvents', 'odds', 'series', 'routeLabel', 'result']) assert.ok(key in card, key);
    assert.deepEqual(Object.keys(card.a), ['teamId', 'id', 'isClub', 'code', 'color', 'name', 'eff', 'score']);
    assert.equal(card.round, '001');
    assert.equal(card.minuteFallback, 40);
    assert.equal(JSON.parse(JSON.stringify(card)).minuteFallback, 40, 'a plain number (it is persisted in history)');
    assert.equal(f.app.matchCard(match).minuteFallback, 0, 'explicit matches still work');
  } finally { f.close(); }

  for (const phase of ['loading', 'setup']) {
    const g = syncAppFixture({ phase });
    try {
      g.app.setState({ match: { aId: '250', dId: '276', shown: [], allEv: [], applied: false } });
      assert.equal(g.app.matchCard(), null, phase);
      const model = g.app.liveMatchModel();
      assert.equal(model.state, null, phase);
      assert.equal(model.empty?.title, 'No match yet', phase);
      assert.doesNotThrow(() => g.app.render(), phase);
    } finally { g.close(); }
  }
});

test('liveMatchModel feeds MatchScreen the live view-model, and the screen reads the minute from the store', async () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    quiet(f.app);
    f.app.setState({ match: { ...liveMatch(f.app, [[10, '250']]),
      live: liveModelFor(FOOTBALL, f.app.state.teams['250'], f.app.state.teams['276'], 80, 78, 6) } });
    const model = f.app.liveMatchModel();
    assert.equal(model.state, 'live');
    assert.equal(model.a.teamId, '250');
    assert.equal(model.b.teamId, '276');
    assert.equal(model.model.kind, 'poisson');
    assert.equal(model.perspective.side, 'A', 'the managed side');
    f.app.setView('match');
    const screen = findElement(f.app.render(), 'MatchScreen');
    assert.ok(screen, 'MatchScreen is rendered in the match view');
    assert.equal(screen.props.state, 'live');
    assert.equal(screen.props.minuteStore, f.app.minuteStore);

    await withDom(async ({ mount: mountView }) => {
      f.app.presentMatch();
      const props = () => ({ ...f.app.liveMatchModel(), minuteStore: f.app.minuteStore, speed: 1, paused: false,
        onSpeed() {}, onPause() {}, onSelectTeam() {} });
      const view = await mountView(MatchScreen, props());
      const text = () => view.host.querySelector('.match-score__minute-text')?.textContent;
      assert.equal(text(), "0' · LIVE");
      await act(async () => f.time.advance(LEAD + 5 * UNIT));
      assert.equal(text(), "5' · LIVE", 'the store re-renders the minute without an App render');
    });
  } finally { f.close(); }
});

test('the kickoff notice carries v4 source-case copy with the roman round', () => {
  const f = syncAppFixture();
  try {
    f.app.setState({ round: 12, match: liveMatch(f.app) });
    f.app.presentMatch();
    const { teams } = f.app.state;
    assert.equal(f.app.state.pu.kind, 'vs');
    assert.equal(f.app.state.pu.label, `Round XII — ${teams['250'].name} attacks ${teams['276'].name}`);
  } finally { f.close(); }
});

test('module stays render-pure: no React state and no RNG in the minute chain', () => {
  const f = syncAppFixture();
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[60, '250']]) });
    f.app.presentMatch();
    let renders = 0;
    const setState = f.app.setState.bind(f.app);
    f.app.setState = (...args) => { renders++; return setState(...args); };
    const rng = f.app.rng.getState();
    f.time.advance(LEAD + 50 * UNIT);
    assert.equal(minute(f.app), 50);
    assert.equal(renders, 0, 'fifty minutes pass without a setState');
    assert.equal(f.app.rng.getState(), rng);
    assert.equal(React.isValidElement(f.app.render()), true);
  } finally { f.close(); }
});

test('a ticker match saves at kickoff, whistle and result, not per goal; a hidden or closing page saves the reveal', () => {
  // A whole checkpoint per revealed goal (and per compass stage) was most of a campaign's work: the outcome is fixed
  // at kickoff, so the reveal rides along with the next checkpoint, or is written when the page goes away.
  const f = syncAppFixture();
  try {
    quiet(f.app);
    const writes = [];
    const setItem = f.storage.setItem;
    f.storage.setItem = (key, value) => {
      if (key === SAVE_KEY) writes.push(JSON.parse(value).match);
      return setItem.call(f.storage, key, value);
    };
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276'], [70, '250']]) });
    assert.equal(writes.length, 1, 'the kickoff is a checkpoint');
    assert.equal(writes[0].shown.length, 0);
    f.app.presentMatch();
    f.time.advance(LEAD + 75 * UNIT);
    assert.equal(f.app.state.match.shown.length, 3, 'three goals revealed');
    assert.equal(writes.length, 1, 'revealing goals decided at kickoff writes nothing');
    f.app.handlePageHide();
    assert.equal(writes.length, 2, 'closing the page saves the reveal');
    assert.equal(writes[1].shown.length, 3);
    f.app.handlePageHide();
    assert.equal(writes.length, 2, 'nothing new, nothing written');
    f.time.advance(WHISTLE - (LEAD + 75 * UNIT));
    assert.equal(writes.length, 3, 'the final whistle is a checkpoint');
    assert.equal(writes[2].status, FOOTBALL.labels.end);
    f.time.advance(420);
    assert.equal(f.app.state.match.applied, true);
    assert.equal(writes.length, 4, 'the result saves once, though its update and its callback both ask');
    assert.equal(writes[3].applied, true);
  } finally { f.close(); }
});

test('a reveal queued behind a pending timer update saves once: React re-running patchMatch on a rebase is no change', async () => {
  // Real React scheduling (no act queue): a timer's setState is default priority and waits for its render, while the
  // Finish click's reveal (patchMatch) is sync. Every sync re-render then rebases and re-runs the patchMatch updater,
  // minting an equal-but-new match; componentDidUpdate used to save on match identity, and the save's own setState is
  // such a re-render, so it re-saved on every pass until React threw "Maximum update depth exceeded" (smoke, under load).
  const App = await bundleApp();
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const f = syncAppFixture(); // only for a playing campaign with a live match
  let state;
  try {
    quiet(f.app);
    f.app.setState({ match: liveMatch(f.app, [[10, '250'], [40, '276']]) });
    state = f.app.state;
  } finally { f.close(); }
  await withDom(async ({ document }) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    let app = null, saves = 0;
    class Probe extends App {
      constructor(props) { super(props); app = this; this.state = state; }
      componentDidMount() {}
      persist() { saves++; this.setState(s => ({ revision: (Number(s.revision) || 0) + 1 })); } // the save's own re-render
      render() { return null; }
    }
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    flushSync(() => root.render(React.createElement(Probe)));
    try {
      app.setState({ pu: null }); // a timer's update: default priority, not rendered yet
      flushSync(() => app.patchMatch({ status: FOOTBALL.labels.end })); // the click's reveal: sync priority
      assert.equal(app.state.match.status, FOOTBALL.labels.end);
      assert.equal(saves, 1, 'the reveal saves once');
      await new Promise(resolve => setTimeout(resolve, 30)); // the timer's update renders; an equal match is no change
      assert.equal(saves, 1);
      assert.equal(app.state.match.status, FOOTBALL.labels.end);
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });
});
