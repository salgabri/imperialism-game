// Owner: WP-SQUAD wiring (see PLAN.md §4.5). App → Squad view wiring: `squadModel()` feeds SquadScreen from
// `buildSquad(st, ctx, selected || managed || followed)`, Back returns to the origin (`squadBack`), Follow follows,
// claimed-player provenance falls back to `history` for older saves (DEC D8), and the delegate stays render-pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { bundleApp, bundleComponents, findElement, forceResult, syncAppFixture, withDom } from './lib/app-harness.mjs';
import { signedDelta } from '../src/viewModels/format.js';

await bundleApp();
const { squadTeamId } = await bundleComponents({ squadTeamId: ['src/app/squadMethods.jsx', 'squadTeamId'] });

const rngOf = app => app.rng.getState();

test('squadTeamId: selected, else managed, else followed; stale ids fall through', () => {
  const teams = { a: {}, b: {}, c: {} };
  assert.equal(squadTeamId({ teams, selected: 'a' }, { managedId: 'b', followedId: 'c' }), 'a');
  assert.equal(squadTeamId({ teams, selected: null }, { managedId: 'b', followedId: 'c' }), 'b');
  assert.equal(squadTeamId({ teams, selected: 'gone' }, { managedId: null, followedId: 'c' }), 'c');
  assert.equal(squadTeamId({ teams, selected: 'gone' }, { managedId: null, followedId: null }), null);
  assert.equal(squadTeamId({ teams: {} }, null), null);
  assert.equal(squadTeamId(null, null), null);
});

test('loading and setup phases: squadModel returns an empty model without touching the board', () => {
  for (const phase of ['loading', 'setup']) {
    const f = syncAppFixture({ phase });
    try {
      assert.deepEqual(f.app.squadModel(), {}, phase);
    } finally { f.close(); }
  }
});

test('spectator: a map/standings click opens that team in the Squad view with Back and Follow', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const { app } = f;
    const rng = rngOf(app), timers = app.timers.size;
    app.selectTeam('276');
    assert.equal(app.state.view, 'squad');
    assert.equal(app.state.tab, 'squad', 'smoke compat');
    assert.equal(app.state.squadReturn, 'map');
    const model = app.squadModel();
    assert.equal(model.teamId, '276');
    assert.equal(model.name, app.state.teams['276'].name);
    assert.deepEqual(model.back, { label: 'Back to map' });
    assert.equal(model.canFollow, true);
    assert.equal(model.following, false);
    assert.equal(model.home, null);
    assert.ok(model.groups.length >= 3, 'starters grouped by line');
    assert.equal(model.groups.reduce((n, group) => n + group.rows.length, 0), 11, 'football XI');
    assert.equal(model.pitch.length, 11);
    assert.equal(model.sport, 'football');
    assert.equal(app.squadModel(), model, 'memoised on state identities (squad:model)');
    // Render tree: the Squad view gets the model spread plus the FROZEN callbacks.
    const screen = findElement(app.render(), 'SquadScreen');
    assert.ok(screen, 'SquadScreen rendered on the squad view');
    assert.equal(screen.props.teamId, '276');
    assert.equal(typeof screen.props.onBack, 'function');
    assert.equal(typeof screen.props.onFollow, 'function');
    assert.equal(typeof screen.props.onSelectTeam, 'function');
    assert.equal(rngOf(app), rng, 'model/render never move the campaign RNG');
    assert.equal(app.timers.size, timers, 'no timers scheduled by the view');

    screen.props.onFollow('276');
    assert.equal(app.state.followedId, '276');
    assert.equal(app.squadModel().following, true);
    screen.props.onBack();
    assert.equal(app.state.view, 'map');
    assert.equal(rngOf(app), rng);
  } finally { f.close(); }
});

test('Back label and destination follow the origin: Ledger → standings, Chronicle → history', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const { app } = f;
    for (const [origin, label] of [['ledger', 'Back to standings'], ['chronicle', 'Back to history'], ['match', 'Back to match']]) {
      app.setView(origin);
      app.selectTeam('826');
      assert.equal(app.state.squadReturn, origin);
      assert.deepEqual(app.squadModel().back, { label }, origin);
      app.squadBack();
      assert.equal(app.state.view, origin, `${origin}: back returns to the origin`);
    }
  } finally { f.close(); }
});

test('manager: the Squad tab shows the managed team (no Follow, no Back); another team offers "Your squad"', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const { app } = f;
    app.setView('squad');
    let model = app.squadModel();
    assert.equal(model.teamId, '250', 'managed team when nothing is selected');
    assert.equal(model.canFollow, false);
    assert.equal(model.back, null, 'C1: no back button without an origin');
    assert.equal(model.home, null);
    app.selectTeam('276');
    model = app.squadModel();
    assert.equal(model.teamId, '276');
    assert.deepEqual(model.home, { teamId: '250', label: 'Your squad' });
    findElement(app.render(), 'SquadScreen').props.onSelectTeam(model.home.teamId);
    assert.equal(app.state.selected, '250');
    assert.equal(app.state.view, 'squad');
    assert.equal(app.squadModel().teamId, '250');
  } finally { f.close(); }
});

test('a stale selection falls back to the followed team; nothing to show keeps the Back copy', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const { app } = f;
    app.followTeam('826');
    app.setState({ selected: 'not-a-team', view: 'squad', squadReturn: 'ledger' });
    assert.equal(app.squadModel().teamId, '826');
    app.setState({ followedId: null });
    assert.deepEqual(app.squadModel(), { back: { label: 'Back to standings' } });
    app.setState({ squadReturn: null });
    assert.deepEqual(app.squadModel(), {});
  } finally { f.close(); }
});

test('claimed provenance after a real conquest, and the history fallback for an older save (DEC D8)', () => {
  const f = syncAppFixture({ role: 'spectator', ids: ['250', '276', '826'] });
  try {
    const { app } = f;
    app.startMatch('250', '276');
    assert.ok(app.state.match, 'spectator match starts without a tactical gate');
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.equal(app.state.match.applied, true);
    const loser = app.state.teams['276'];
    const winner = app.state.teams['250'];
    const claimed = winner.squad.filter(player => player.from === loser.code);
    assert.equal(claimed.length, 1, 'the winner claimed one player from the loser');
    const entry = app.state.history.at(-1);
    assert.equal(entry.result.player.name, claimed[0].name);

    app.selectTeam('250');
    const fresh = app.squadModel();
    assert.equal(fresh.claimedCount, 1);
    const claim = fresh.claimed[0];
    // History stores the rounded XI delta; applyConquest's own `claimGain` (when WP-CONQ stores it) is the same delta.
    const gain = signedDelta(entry.result.strengthGain).tone === 'gain' ? signedDelta(entry.result.strengthGain).text : '±0.0';
    assert.equal(claim.name, claimed[0].name);
    assert.equal(claim.code, loser.code);
    assert.equal(claim.fromName, loser.name);
    assert.equal(claim.roman, 'R I');
    assert.match(claim.gain, /^(\+\d+\.\d|±0\.0)$/);
    assert.ok(fresh.kicker.endsWith('1 claimed in conquest'));
    const acquired = [...fresh.groups.flatMap(group => group.rows), ...fresh.depth.all].find(row => row.name === claimed[0].name);
    assert.equal(acquired.acquired.label, `${loser.code} · R I`);

    // An older save: the moved player carries only `from` (no fromId/joined/claimGain) → read from history.
    const legacySquad = winner.squad.map(player => {
      if (player.from == null) return player;
      const { fromId, joined, claimGain, ...rest } = player;
      return rest;
    });
    app.setState({ teams: { ...app.state.teams, 250: { ...winner, squad: legacySquad } } });
    const legacy = app.squadModel();
    assert.notEqual(legacy, fresh, 'new team identity recomputes');
    assert.deepEqual(
      { name: legacy.claimed[0].name, code: legacy.claimed[0].code, fromName: legacy.claimed[0].fromName,
        roman: legacy.claimed[0].roman, gain: legacy.claimed[0].gain },
      { name: claim.name, code: claim.code, fromName: claim.fromName, roman: 'R I', gain });
    assert.equal(legacy.claimedCount, 1);
  } finally { f.close(); }
});

test('basketball: court layout, starting five', () => {
  const f = syncAppFixture({ role: 'spectator', settings: { sport: 'basketball' } });
  try {
    const { app } = f;
    app.selectTeam('276');
    const model = app.squadModel();
    assert.equal(model.sport, 'basketball');
    assert.equal(model.layout, 'court');
    assert.equal(model.formation, 'Starting five');
    assert.equal(model.pitch.length, 5);
  } finally { f.close(); }
});

test('the real App element mounts in the DOM: header, rows, Follow and Back work, console stays clean', async () => {
  const f = syncAppFixture({ role: 'spectator' });
  const errors = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...args) => errors.push(args.join(' '));
  console.warn = (...args) => errors.push(args.join(' '));
  try {
    await withDom(async ({ document, mount }) => {
      const { app } = f;
      app.setView('ledger');
      app.selectTeam('276');
      const screen = findElement(app.render(), 'SquadScreen');
      const view = await mount(screen);
      const section = document.getElementById('view-panel-squad');
      assert.ok(section);
      assert.equal(section.dataset.empty, undefined, 'not the empty state');
      assert.equal(section.querySelector('.squad-head__name').textContent, app.state.teams['276'].name);
      assert.ok(section.querySelectorAll('.squad-table [role=row]').length >= 11);
      const follow = section.querySelector('.squad-head .fi-follow-team');
      assert.equal(follow.getAttribute('aria-pressed'), 'false');
      await act(async () => follow.click());
      assert.equal(app.state.followedId, '276');
      const back = section.querySelector('.squad-head .fi-squad-back');
      assert.equal(back.textContent, 'Back to standings');
      await act(async () => back.click());
      assert.equal(app.state.view, 'ledger');
      await view.unmount();
    });
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    f.close();
  }
  assert.deepEqual(errors, []);
});
