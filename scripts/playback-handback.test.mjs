// What play hands back when it stops or moves on: a skip ahead ended by an export, the next match left to Continue after
// Pause, Resume or Stop, the results opened once, the speed your match set aside, and the setup's seed field after a
// retry. Real bundled App on the synchronous fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp, forceResult, syncAppFixture } from './lib/app-harness.mjs';

await bundleApp();

const IDS = ['250', '276', '826', '380'];

test('an export while skipping ends the skip, at the speed it started from, as Pause does', () => {
  const f = syncAppFixture({ ids: IDS, role: 'manager' });
  try {
    const { app } = f;
    app.setSpeed(2);
    app.skipToNextMatch();
    app.startMatch('276', '826');
    assert.ok(app.state.skipAhead && app.state.match && !app.state.match.applied, 'a rival match plays while skipping');
    app.exportProgress();
    assert.deepEqual([app.state.skipAhead, app.state.speed, app.state.autoplay, app.state.paused], [null, 2, false, true]);
    app.setState({ exportText: null });
    app.runPrimary(); // Resume
    assert.equal(app.columnModel().fixture.skip.active, false, 'no "Skipping to your next match" left behind');
  } finally { f.close(); }
});

test('after a result, Stop skipping leaves the next match to Continue', () => {
  const f = syncAppFixture({ ids: IDS, role: 'manager' });
  try {
    const { app, time } = f;
    app.followTeam('276'); // a followed rival's match is never compressed, so its result pauses before the next draw
    app.skipToNextMatch();
    app.startMatch('276', '826');
    forceResult(app, '276', { aId: '276', dId: '826' });
    app.finishMatch();
    assert.ok(app.state.skipAhead, 'still skipping after the result');
    const { round, match } = app.state;
    app.stopSkip();
    time.advance(2000);
    assert.deepEqual([app.state.round, app.state.match, app.state.spin, app.state.tacticalChoice], [round, match, null, null],
      'no draw starts by itself');
    assert.equal(app.state.autoplay, false);
    assert.equal(app.primaryAction().label, 'Continue');
  } finally { f.close(); }
});

test('under Fast-forward, Pause then Resume right after a result leaves the next match to Continue', () => {
  const f = syncAppFixture({ ids: IDS, role: 'manager', settings: { express: true } });
  try {
    const { app, time } = f;
    app.setState({ autoplay: true });
    app.startMatch('276', '826');
    forceResult(app, '276', { aId: '276', dId: '826' });
    app.finishMatch();
    assert.equal(app.state.autoplay, true, 'autoplay queued the next draw');
    const { round, match } = app.state;
    app.runPrimary(); // Pause
    app.runPrimary(); // Resume
    time.advance(2000);
    assert.deepEqual([app.state.round, app.state.match, app.state.spin, app.state.tacticalChoice], [round, match, null, null],
      'the queued draw asks for autoplay again and finds it off');
    assert.equal(app.primaryAction().label, 'Continue');
  } finally { f.close(); }
});

test('Results pressed before the closing pause is over stay closed after View map', () => {
  const f = syncAppFixture({ ids: ['250', '276'] });
  try {
    const { app, time } = f;
    app.setState({ autoplay: true });
    app.startMatch('250', '276');
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.equal(app.state.phase, 'playing', 'the results wait for the result notices');
    app.runPrimary(); // Results
    assert.deepEqual([app.state.phase, app.state.autoplay], ['victory', false]);
    app.setState({ phase: 'playing', view: 'map', viewSource: 'user' }); // View map
    time.advance(6000);
    assert.equal(app.state.phase, 'playing', 'the pause no longer reopens them');
  } finally { f.close(); }
});

test('leaving a campaign during your match hands back the speed it slowed to 1×', () => {
  const f = syncAppFixture({ ids: IDS, role: 'manager' });
  try {
    const { app } = f;
    app.setSpeed(2);
    app.startMatch('250', '276');
    app.chooseTactic('balanced');
    assert.equal(app.state.speed, 1, 'your match plays at 1×');
    app.newCampaign(); app.newCampaign();
    assert.equal(app.state.speed, 2, 'setup has your speed back');
    app.startCampaign();
    assert.equal(app.state.speed, 2, 'and so does the next campaign');
    assert.equal(app.speedRestore, null, 'nothing waits to change it later');
  } finally { f.close(); }
});

test('Same draw replays the seed and leaves the setup\'s seed field as the player left it', () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'], role: 'manager' });
  try {
    const { app } = f;
    app.persist();
    const seed = app.state.seed;
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.ok(app.state.managerElimination);
    app.retryManager();
    assert.equal(app.state.seed, seed, 'the same opening');
    assert.equal(String(app.state.setup.seed || ''), '', 'the seed field is still blank');
    app.newCampaign(); app.newCampaign();
    assert.notEqual(app.setupSeed(), seed, 'the next New campaign is a new draw');
  } finally { f.close(); }
});
