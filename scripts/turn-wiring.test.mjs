// WP-TURN wiring (PLAN §4.8, §5.2 turn-flow / turn-replay rows): the App flow in src/app/turnMethods.jsx driven
// through the real App class — round robin cycles and round numbering (DEC D3), the "You choose" pending-target
// gate (RF§2.5), the targeted draw (0 RNG), map selection, save/resume mid-turn, launch normalisation (DEC D2),
// the compass fallback after continueAsSpectator, skipped round-robin turns, and replay determinism of the
// non-default modes on the real atlas. Every duel turn must consume exactly three campaign RNG samples (DEC D1).
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bundleApp, syncAppFixture, withDom, controlledTime, forceResult, findElement } from './lib/app-harness.mjs';
import { SAVE_KEY } from '../src/config.js';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { PlaybackClock } from '../src/engine/playbackClock.js';
import { parseCampaign, exportCampaign, listCampaigns, loadSave } from '../src/engine/storage.js';
import { buildTargetPanel } from '../src/viewModels/turns.js';
import { runProductionCampaign } from './production-balance.mjs';

const App = await bundleApp();

/** Square countries at fixed points (no `adj`: every option is a direct "sea" strike, DEC D4 tier 2). */
function atlas(points) {
  const paths = Object.fromEntries(Object.entries(points).map(([id, [cx, cy]]) => [id, {
    cx, cy, area: 100, labelX: cx, labelY: cy, bbox: { x: cx - 20, y: cy - 20, w: 40, h: 40 },
    d: `M${cx - 20},${cy - 20}h40v40h-40Z`,
    labelRings: [[[cx - 20, cy - 20], [cx + 20, cy - 20], [cx + 20, cy + 20], [cx - 20, cy + 20]]],
  }]));
  return { paths, countries: Object.keys(paths).map(id => ({ id })), adj: {},
    graticule: { d: '', labels: [] }, fit: { s: 1, tx: 0, ty: 0 }, kmPerUnit: 1 };
}

// 380 sits in the middle: 250, 276 and 724 are in direct reach; 826 hides behind 276 (its route crosses 276 first).
const STAR = { '380': [300, 300], '250': [100, 300], '276': [500, 300], '724': [300, 100], '826': [700, 300] };
const IDS = ['380', '250', '276', '724', '826'];

/** A fixture whose RNG counts its samples; `first` (if given) leads the round-robin order (highest baseEff). */
function fixture({ ids = IDS, points = STAR, role = 'spectator', settings = {}, first = null, seed = 728491 } = {}) {
  const f = syncAppFixture({ App, ids, role, seed, settings });
  f.app.geo = atlas(Object.fromEntries(Object.entries(points).filter(([id]) => ids.includes(id))));
  if (first) f.app.state.teams[first].baseEff = 999;
  f.calls = 0;
  /** Count campaign samples; call again after `resume()`, which replaces `app.rng` with the saved generator. */
  f.countRng = () => {
    const rng = f.app.rng;
    f.app.rng = Object.assign(() => { f.calls++; return rng(); }, { getState: () => rng.getState(), setState: value => rng.setState(value) });
  };
  f.countRng();
  f.saved = () => JSON.parse(f.storage.getItem(SAVE_KEY));
  return f;
}

/**
 * Run `fn(f)` with one fixture and always close it. Fixtures install global fakes (localStorage, timers), so two
 * open at once would share the last one's storage and restore the globals out of order: keep them sequential.
 */
function using(options, fn) {
  const f = typeof options === 'function' ? options() : fixture(options);
  try { return fn(f); } finally { f.close(); }
}

/** End the current turn without playing it (keeps teams and ownership; the next nextAction starts the next turn). */
function skipToIdle(app) {
  app.clearTimers();
  app.setState({ spin: null, atk: null, match: null, tacticalChoice: null });
}

const unchanged = (app, run) => {
  const before = app.state;
  run();
  return app.state === before;
};

test('launchRules normalises turn rules at launch (DEC D2) and startCampaign stores them in settings and initialSettings', () => {
  const f = fixture({ role: 'manager' });
  try {
    const { app } = f;
    assert.deepEqual(app.launchRules({ pacing: 'duel', role: 'manager', turnOrder: 'round-robin', targeting: 'player' }),
      { turnOrder: 'round-robin', targeting: 'player' });
    assert.deepEqual(app.launchRules({ pacing: 'blitz', role: 'manager', turnOrder: 'round-robin', targeting: 'player' }),
      { turnOrder: 'random', targeting: 'compass' });
    assert.deepEqual(app.launchRules({ pacing: 'chaos', role: 'manager', turnOrder: 'round-robin', targeting: 'player' }),
      { turnOrder: 'random', targeting: 'compass' });
    assert.deepEqual(app.launchRules({ pacing: 'duel', role: 'spectator', turnOrder: 'round-robin', targeting: 'player' }),
      { turnOrder: 'round-robin', targeting: 'compass' }, 'spectators always use the compass');
    assert.deepEqual(app.launchRules({}), { turnOrder: 'random', targeting: 'compass' });

    app.state.setup = { ...app.state.setup, pacing: 'chaos', role: 'manager', managedTeamId: '380', turnOrder: 'round-robin', targeting: 'player' };
    app.startCampaign();
    assert.equal(app.state.settings.turnOrder, 'random');
    assert.equal(app.state.settings.targeting, 'compass');
    assert.equal(app.state.initialSettings.turnOrder, 'random');
    assert.equal(app.state.initialSettings.targeting, 'compass');

    app.state.setup = { ...app.state.setup, pacing: 'duel' };
    app.startCampaign();
    assert.equal(app.state.settings.turnOrder, 'round-robin');
    assert.equal(app.state.settings.targeting, 'player');
    assert.deepEqual([app.state.turnQueue, app.state.turnIndex, app.state.pendingTarget], [[], 0, null]);
    assert.equal(app.playerTargets(), true);
  } finally { f.close(); }
});

test('round robin: strongest first, a cycle shares its round, the queue is rebuilt at the boundary, 3 samples per turn', () => {
  const f = fixture({ settings: { turnOrder: 'round-robin' }, first: '826' });
  try {
    const { app } = f;
    app.setState({ round: 0 });
    const attackers = [], rounds = [], indexes = [];
    for (let turn = 0; turn < IDS.length + 1; turn++) {
      const before = f.calls;
      app.nextAction();
      assert.equal(f.calls - before, 3, `turn ${turn + 1} consumes exactly three campaign samples`);
      const st = app.state;
      assert.ok(st.spin, `turn ${turn + 1} draws`);
      attackers.push(st.spin.attackerId);
      rounds.push(st.round);
      indexes.push(st.turnIndex);
      // Saved atomically with the spin: the attacker is the entry just consumed.
      const saved = f.saved();
      assert.equal(saved.spin.attackerId, saved.turnQueue[saved.turnIndex - 1]);
      assert.equal(saved.round, st.round);
      if (turn === 0) assert.equal(app.turnStripModel().detail, `Turn 1 of ${IDS.length} this round`);
      skipToIdle(app);
    }
    assert.equal(attackers[0], '826', 'the strongest starting side attacks first');
    assert.deepEqual(attackers.slice(0, IDS.length).sort(), IDS.slice().sort(), 'every survivor attacks once per cycle');
    assert.equal(attackers[IDS.length], attackers[0], 'the next cycle starts again from the strongest');
    assert.deepEqual(rounds, [1, 1, 1, 1, 1, 2], 'round counts cycles (DEC D3)');
    assert.deepEqual(indexes, [1, 2, 3, 4, 5, 1]);
    assert.equal(app.state.toast, null);
  } finally { f.close(); }
});

test('random × compass (the default) keeps the HEAD duel: no turn state, round per duel, 3 samples', () => {
  const f = fixture();
  try {
    const { app } = f;
    app.setState({ round: 4 });
    app.nextAction();
    assert.equal(f.calls, 3);
    assert.equal(app.state.round, 5);
    assert.deepEqual([app.state.turnQueue, app.state.turnIndex, app.state.pendingTarget], [[], 0, null]);
    assert.equal(app.state.log.length, 0);
    assert.equal(app.turnStripModel().variant, 'random', 'spectators see the random-draw strip');
  } finally { f.close(); }
});

test('the turn strip is drawn on the Map view only (modes-13/14): no strip row on Squad, Match, Ledger, Chronicle, Conquest', () => {
  const strip = app => findElement(app.render(), 'TurnStrip')?.props.variant ?? null;
  // Spectator, random draw: the strip on the map; every other view renders none (TurnStrip returns null: no 52px row).
  using({}, ({ app }) => {
    assert.equal(app.turnStripModel().variant, 'random');
    assert.equal(strip(app), 'random');
    for (const view of ['squad', 'match', 'ledger', 'chronicle']) {
      app.setState({ view });
      assert.equal(app.currentView(), view);
      assert.equal(app.turnStripModel().variant, null, view);
      assert.equal(strip(app), null, `${view} renders no strip`);
    }
    app.setState({ view: 'map' });
    assert.equal(app.turnStripModel().variant, 'random', 'back on the map the strip returns');
  });
  // Round robin, manager: the your-turn state (pending target) holds the Map, so the strip shows there even when the
  // chosen view was another screen; the signing (conquest) screen draws none.
  using({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' }, ({ app }) => {
    app.setState({ view: 'ledger' });
    assert.equal(app.turnStripModel().variant, null, 'ledger');
    app.nextAction();
    assert.ok(app.state.pendingTarget, 'your turn: the target choice is pending');
    assert.equal(app.state.view, 'ledger', 'the chosen view is kept underneath');
    assert.equal(app.currentView(), 'map');
    assert.equal(app.turnStripModel().variant, 'round-robin', 'your turn on the map shows the strip');
    assert.equal(strip(app), 'round-robin');
    app.setState({ pendingTarget: null, choice: { winnerId: '380', loserId: '250' } });
    assert.equal(app.currentView(), 'conquest');
    assert.equal(app.turnStripModel().variant, null, 'conquest');
  });
});

test('"You choose": the managed attacker waits on the target panel; nothing runs until Attack', () => {
  const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' });
  try {
    const { app } = f;
    app.setState({ autoplay: true, round: 0 });
    app.nextAction();
    const pending = app.state.pendingTarget;
    assert.equal(f.calls, 3, 'the turn still draws its three samples');
    assert.ok(pending, 'pending target choice');
    assert.equal(pending.attackerId, '380');
    assert.deepEqual(pending.optionIds.slice().sort(), ['250', '276', '724'], 'only empires in direct reach (826 is blocked)');
    assert.equal(pending.round, 1);
    assert.equal(pending.resumeAutoplay, true);
    assert.deepEqual(pending.turn, { turnQueue: app.state.turnQueue, turnIndex: 1, round: 1, newRound: true });
    assert.equal(app.state.round, 1);
    assert.equal(app.state.turnIndex, 1);
    assert.equal(app.state.spin, null);
    assert.equal(app.state.autoplay, false);
    assert.equal(app.timers.size, 0, 'no timers while the choice is pending');
    assert.equal(app.currentView(), 'map');
    // Preselection contract (W2-UI-LOG): panel, rows[0], state and the masthead primary agree.
    const panel = buildTargetPanel(app.state, app.viewContext());
    assert.equal(panel.selectedId, pending.selectedId);
    assert.equal(panel.rows[0].teamId, pending.selectedId);
    assert.equal(app.targetPanelModel().selectedId, pending.selectedId);
    assert.equal(app.primaryAction().id, 'attack');
    assert.equal(app.primaryAction().label, `Attack ${app.state.teams[pending.selectedId].name}`);
    assert.equal(app.reachModel().selectedId, pending.selectedId);
    assert.ok(app.reachModel().preview?.dashed, 'dashed preview arrow');
    assert.equal(app.targetAnchors().length, 1);
    assert.match(renderToStaticMarkup(app.targetAnchors()[0].node), /target-card/);
    // Saved, and parseCampaign accepts it.
    assert.equal(app.state.saveStatus?.ok, true);
    assert.deepEqual(parseCampaign(f.storage.getItem(SAVE_KEY)).pendingTarget, pending);
    // Gate: none of the flow entry points move.
    for (const name of ['step', 'togglePlay', 'pausePlayback', 'nextAction', 'beginTurn', 'beginDuel']) {
      assert.ok(unchanged(app, () => app[name]()), `${name} is blocked`);
    }
    assert.equal(f.calls, 3);
    // Render stays pure with the panel up.
    const rng = app.rng.getState();
    app.render();
    assert.equal(app.rng.getState(), rng);
  } finally { f.close(); }
});

test('opening the target choice ends the last conquest\'s hatch flash (its clear timer is cancelled with the rest, DEC D15)', () => {
  const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' });
  try {
    const { app } = f;
    // An AI conquest just landed: applyConquest's flash and its 1.5 s clear are pending (Express / quick Continue).
    app.setState({ flash: { '826': true }, conquestIds: ['826'] });
    app.after(1500, () => app.setState({ flash: {} }));
    assert.deepEqual([...app.mapConquestIds()], ['826'], 'hatched during the flash');
    app.nextAction();
    assert.ok(app.state.pendingTarget, 'the managed attacker chooses');
    assert.equal(app.timers.size, 0, 'no timers while the choice is pending');
    assert.deepEqual(app.state.flash, {});
    assert.deepEqual([...app.mapConquestIds()], [], 'no hatch left on the map through the target choice');
  } finally { f.close(); }
});

test('the tactical gate ends the last conquest hatch flash too (its clearTimers cancels the 1.5 s clear)', () => {
  using({ role: 'manager' }, f => {
    const { app } = f;
    app.setState({ flash: { '826': true }, conquestIds: ['826'] });
    app.after(1500, () => app.setState({ flash: {} }));
    app.startMatch('380', '250');
    assert.ok(app.state.tacticalChoice, 'the managed side reaches the tactical gate');
    assert.deepEqual(app.state.flash, {});
    assert.deepEqual([...app.mapConquestIds()], [], 'no hatch left on the map through the gate');
  });
});

test('patchMatch only patches the live match: a settled match is never flipped back to unapplied', () => {
  using({}, f => {
    const { app } = f;
    app.startMatch('380', '250');
    assert.equal(app.state.match.applied, false);
    app.patchMatch({ status: 'LIVE*' });
    assert.equal(app.state.match.status, 'LIVE*', 'the live match takes the patch');
    const settled = { ...app.state.match, applied: true, done: true, status: 'FULL TIME' };
    app.setState({ match: settled });
    app.patchMatch({ status: 'TIE', applied: false });
    assert.equal(app.state.match, settled, 'a stale patch after the settlement is dropped');
    app.clearTimers();
  });
});

test('the theatre name outside setup drops the data footnote marker (Asia & Oceania*)', () => {
  using({}, f => {
    const { app } = f;
    assert.equal(app.scopeName({ scope: 'AFC' }), 'Asia & Oceania');
    // The fixture stubs opening(); the real one names the launched campaign and its first log line.
    const opening = App.prototype.opening.call(app, { sport: 'football', layer: 'nations', scope: 'AFC' }, makeRng(1));
    assert.equal(opening.scopeName, 'Asia & Oceania');
  });
});

test('selectTarget / selectCountry / hoverTarget only accept in-reach options', () => {
  const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' });
  try {
    const { app } = f;
    app.nextAction();
    const pending = app.state.pendingTarget;
    const other = pending.optionIds.find(id => id !== pending.selectedId);
    assert.ok(unchanged(app, () => app.selectTarget('826')), 'out of reach');
    assert.ok(unchanged(app, () => app.selectTarget('380')), 'the attacker itself');
    assert.ok(unchanged(app, () => app.selectTarget(pending.selectedId)), 'already selected');
    app.selectTarget(other);
    assert.equal(app.state.pendingTarget.selectedId, other);
    assert.equal(app.state.pendingTarget.optionIds, pending.optionIds, 'optionIds identity kept');
    assert.equal(f.saved().pendingTarget.selectedId, other, 'persisted');
    assert.equal(app.primaryAction().label, `Attack ${app.state.teams[other].name}`);

    // Map clicks: in reach selects; out of reach, own land and unknown land are inert; no squad view while pending.
    const back = pending.selectedId;
    app.selectCountry(back);
    assert.equal(app.state.pendingTarget.selectedId, back);
    for (const cid of ['826', '380', 'nowhere']) assert.ok(unchanged(app, () => app.selectCountry(cid)), `click on ${cid}`);
    assert.equal(app.state.view, 'map');

    app.hoverTarget(other);
    assert.equal(app.state.targetHoverId, other);
    assert.ok(unchanged(app, () => app.hoverTarget(other)), 'no setState when unchanged');
    app.hoverTarget('826');
    assert.equal(app.state.targetHoverId, null, 'out-of-reach hover clears');
    assert.ok(unchanged(app, () => app.hoverTarget(null)));
    assert.equal(f.calls, 3, 'selection never touches the campaign RNG');
  } finally { f.close(); }
});

test('Attack: targeted draw (0 samples) → locked spin → tactical gate → match; ledger entry; autoplay restored', () => {
  const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' });
  try {
    const { app, time } = f;
    app.setState({ autoplay: true, round: 0, view: 'ledger' });
    app.nextAction();
    const pending = app.state.pendingTarget;
    assert.equal(app.currentView(), 'map', 'the choice holds the map');
    const choice = pending.optionIds.at(-1);
    app.selectTarget(choice);
    app.hoverTarget(choice);
    app.primaryAction().run();
    const st = app.state;
    assert.equal(st.view, 'map', 'the attack line is shown on the map');
    assert.equal(f.calls, 3, 'createTargetedDraw consumes no RNG');
    assert.equal(st.pendingTarget, null);
    assert.equal(st.targetHoverId, null);
    assert.equal(st.autoplay, true, 'resumeAutoplay');
    assert.equal(st.spin.stage, 'locked');
    assert.equal(st.spin.chosen, true);
    assert.equal(st.spin.attackerId, '380');
    assert.equal(st.spin.targetId, choice);
    assert.equal(st.spin.ang, st.spin.rotation);
    assert.ok(st.atk && st.atk.x1 === st.spin.x && st.atk.x2 === st.spin.targetX);
    assert.equal(st.round, 1, 'confirm does not bump the round again');
    assert.equal(st.turnIndex, 1);
    const entry = st.decisionLedger.at(-1);
    assert.equal(entry.type, 'target');
    assert.equal(entry.teamId, '380');
    assert.equal(entry.choice, choice);
    assert.deepEqual(entry.options, pending.optionIds);
    assert.equal(entry.preselected, pending.selectedId);
    // The saved locked spin passes parseCampaign.
    assert.equal(parseCampaign(f.storage.getItem(SAVE_KEY)).spin.targetId, choice);
    // A stray lockDuel/animateDuel for the key is inert (no second kickoff).
    app.lockDuel(st.spin.key);
    app.animateDuel(st.spin.key);
    assert.equal(app.timers.size, 1, 'only the hold is pending');
    time.advance(st.spin.holdMs + 1);
    assert.equal(app.state.spin, null);
    assert.ok(app.state.tacticalChoice, 'the manager reaches the tactical gate as before');
    assert.equal(app.state.tacticalChoice.aId, '380');
    assert.equal(app.state.tacticalChoice.dId, choice);
    assert.equal(f.calls, 3, 'the gate draws nothing');
    app.chooseTactic('balanced');
    assert.equal(app.state.match.aId, '380');
    assert.equal(app.state.match.dId, choice);
  } finally { f.close(); }
});

test('player targeting moves the RNG exactly like the compass: same offset before the sim', () => {
  const offsets = {};
  for (const targeting of ['compass', 'player']) {
    const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting }, first: '380' });
    try {
      const { app, time } = f;
      app.nextAction();
      if (targeting === 'player') {
        const pending = app.state.pendingTarget;
        app.selectTarget(pending.optionIds.at(-1));
        app.confirmTarget();
      }
      time.advance(5000);
      assert.ok(app.state.tacticalChoice, `${targeting}: tactical gate`);
      offsets[targeting] = { calls: f.calls, state: app.rng.getState() };
      app.chooseTactic('balanced');
      assert.ok(app.state.match);
    } finally { f.close(); }
  }
  assert.equal(offsets.compass.calls, 3);
  assert.deepEqual(offsets.player, offsets.compass);
});

test('random draw + "You choose": the drawn manager still chooses, even under express while following another team', () => {
  const f = fixture({ role: 'manager', settings: { targeting: 'player', express: true } });
  try {
    const { app } = f;
    app.setState({ followedId: '826', round: 3 });
    let opened = 0;
    for (let i = 0; i < 40 && !app.state.pendingTarget; i++) {
      app.nextAction();
      if (app.state.pendingTarget) { opened++; break; }
      skipToIdle(app);
      app.setState({ match: null });
    }
    assert.equal(opened, 1, 'the managed side was drawn and waits for its choice');
    assert.equal(app.state.pendingTarget.attackerId, '380');
    assert.equal(app.state.pendingTarget.turn, null);
    assert.equal(app.state.pendingTarget.round, app.state.round);
    assert.deepEqual([app.state.turnQueue, app.state.turnIndex], [[], 0], 'random mode keeps no queue');
  } finally { f.close(); }
});

test('after continueAsSpectator every turn uses the compass again', () => {
  const f = fixture({ role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' });
  try {
    const { app } = f;
    app.continueAsSpectator();
    assert.equal(app.playerTargets(), false);
    app.nextAction();
    assert.equal(app.state.pendingTarget, null);
    assert.equal(app.state.spin?.attackerId, '380');
    assert.equal(f.calls, 3);
  } finally { f.close(); }
});

test('resume mid-turn neither skips nor repeats a round-robin turn', () => {
  const options = { settings: { turnOrder: 'round-robin' }, first: '826' };
  const first = using(options, f => {
    f.app.nextAction();
    assert.equal(f.app.state.spin.attackerId, f.app.state.turnQueue[0]);
    return { text: f.storage.getItem(SAVE_KEY), queue: f.app.state.turnQueue, round: f.app.state.round };
  });
  using(options, g => {
    g.app.saved = parseCampaign(first.text);
    g.app.resume();
    g.countRng();
    assert.equal(g.app.state.match?.aId, first.queue[0], 'the saved spin kicks off');
    assert.deepEqual([g.app.state.turnQueue, g.app.state.turnIndex, g.app.state.round], [first.queue, 1, first.round]);
    g.app.clearTimers();
    g.app.setState({ match: { ...g.app.state.match, applied: true, done: true } });
    const before = g.calls;
    g.app.nextAction();
    assert.equal(g.calls - before, 3);
    assert.equal(g.app.state.spin.attackerId, first.queue[1], 'the next entry, not a repeat');
    assert.equal(g.app.state.turnIndex, 2);
    assert.equal(g.app.state.round, first.round, 'same cycle');
  });
});

test('resume with a pending target restores the panel without scheduling anything; Attack then plays that turn', () => {
  const options = { role: 'manager', settings: { turnOrder: 'round-robin', targeting: 'player' }, first: '380' };
  const first = using(options, f => {
    f.app.setState({ autoplay: true });
    f.app.nextAction();
    return { text: f.storage.getItem(SAVE_KEY), pending: f.app.state.pendingTarget };
  });
  using(options, g => {
    g.app.saved = parseCampaign(first.text);
    g.app.resume();
    g.countRng();
    assert.deepEqual(g.app.state.pendingTarget, first.pending);
    assert.equal(g.app.timers.size, 0);
    assert.equal(g.app.primaryAction().id, 'attack');
    g.app.confirmTarget();
    assert.equal(g.app.state.spin?.attackerId, '380');
    assert.equal(g.app.state.spin?.targetId, first.pending.selectedId);
    assert.equal(g.app.state.turnIndex, 1);
    assert.equal(g.app.state.autoplay, true, 'resumeAutoplay survives the reload');
    assert.equal(g.calls, 0, 'no new draw after resume');
  });
});

test('a blocked round-robin attacker logs a skipped turn (3 samples, no toast) and autoplay moves on', () => {
  // 826 owns land with no placed path: it can never be drawn, so its turn is skipped instead of rerolled.
  const points = { ...STAR };
  delete points['826'];
  const f = fixture({ settings: { turnOrder: 'round-robin' }, first: '826', points });
  try {
    const { app, time } = f;
    app.setState({ autoplay: true, round: 0 });
    app.nextAction();
    assert.equal(f.calls, 3);
    assert.equal(app.state.spin, null);
    assert.equal(app.state.toast, null);
    assert.equal(app.state.round, 1);
    assert.equal(app.state.turnQueue[0], '826');
    assert.equal(app.state.turnIndex, 1);
    assert.match(app.state.log.at(-1).txt, /HAS NO ROUTE THIS TURN$/);
    assert.equal(f.saved().turnIndex, 1, 'the skipped turn is saved');
    time.advance(1000);
    assert.equal(f.calls, 6, 'autoplay continued with the next attacker');
    assert.equal(app.state.spin?.attackerId, app.state.turnQueue[1]);
    assert.equal(app.state.turnIndex, 2);
    assert.equal(app.state.round, 1);
  } finally { f.close(); }
});

test('a v2 save (before turn modes) resumes as random × compass', () => {
  const text = using({ settings: { turnOrder: 'round-robin' } }, f => {
    const data = JSON.parse(exportCampaign({ ...f.app.state, rngState: f.app.rng.getState() }));
    data.v = 2;
    for (const key of ['turnQueue', 'turnIndex', 'pendingTarget']) delete data[key];
    for (const settings of [data.settings, data.initialSettings].filter(Boolean)) { delete settings.turnOrder; delete settings.targeting; }
    return JSON.stringify(data);
  });
  using({}, g => {
    g.app.saved = parseCampaign(text);
    g.app.resume();
    g.countRng();
    assert.equal(g.app.state.settings.turnOrder, 'random');
    assert.equal(g.app.state.settings.targeting, 'compass');
    g.app.nextAction();
    assert.ok(g.app.state.spin);
    assert.equal(g.calls, 3);
    assert.deepEqual([g.app.state.turnQueue, g.app.state.turnIndex], [[], 0]);
  });
});

test('resuming an id-less (v1) save keeps one campaign: its first checkpoint replaces the singleton, no frozen copy', () => {
  // A v1 checkpoint after one played match: no campaignId, revision, seed or rngState (nor turn state).
  const text = using({}, f => {
    const { app } = f;
    app.startMatch('250', '276');
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.finishMatch();
    const data = JSON.parse(exportCampaign({ ...app.state, rngState: app.rng.getState() }));
    data.v = 1;
    for (const key of ['campaignId', 'revision', 'seed', 'rngState', 'turnQueue', 'turnIndex', 'pendingTarget']) delete data[key];
    assert.equal(data.matches, 1);
    return JSON.stringify(data);
  });
  using({}, g => {
    const { app } = g;
    g.storage.setItem(SAVE_KEY, text);
    app.saved = loadSave();
    assert.equal(app.saved.legacy, true);
    app.resume();
    assert.equal(app.state.saveStatus?.ok, true);
    let campaigns = listCampaigns();
    assert.equal(campaigns.length, 1, 'the resumed legacy campaign is listed once');
    assert.equal(campaigns[0].id, app.state.campaignId);
    assert.equal(loadSave().campaignId, app.state.campaignId, 'the running campaign took over the pointer');
    // Play on: still one entry, carrying the new match.
    app.startMatch('380', '724');
    forceResult(app, '380', { aId: '380', dId: '724' });
    app.finishMatch();
    app.persist();
    campaigns = listCampaigns();
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].matches, 2);
  });
  // A new campaign started over the same legacy save still archives it (it is that save's only copy).
  using({}, g => {
    const { app } = g;
    g.storage.setItem(SAVE_KEY, text);
    app.saved = loadSave();
    app.state.setup = { ...app.state.setup, pacing: 'duel', role: 'spectator' };
    app.startCampaign();
    const campaigns = listCampaigns();
    assert.equal(campaigns.length, 2, 'the legacy singleton is migrated beside the new campaign');
    assert.ok(campaigns.some(item => item.id !== app.state.campaignId && item.matches === 1));
  });
});

test('render models are empty outside a campaign and without a pending target', () => {
  for (const phase of ['loading', 'setup']) {
    using(() => syncAppFixture({ App, phase }), ({ app }) => {
      assert.equal(app.reachModel(), null);
      assert.deepEqual(app.targetAnchors(), []);
      assert.deepEqual(app.targetPanelModel().rows, []);
      assert.equal(app.turnStripModel().variant, null, phase);
      assert.doesNotThrow(() => app.render(), phase);
    });
  }
  using({}, ({ app }) => {
    assert.equal(app.reachModel(), null);
    assert.deepEqual(app.targetAnchors(), []);
    assert.deepEqual(app.targetPanelModel().rows, []);
    const panel = app.spectatorPanelModel();
    assert.equal(panel.thisTurn.state, 'idle');
    assert.ok(Array.isArray(panel.teams) && panel.teams.length === IDS.length);
    assert.doesNotThrow(() => app.render());
  });
});

test('mounted App: the target panel, strip, masthead primary and map card render; click selects; Space attacks', async () => {
  const time = controlledTime();
  const items = new Map();
  const fakes = { setTimeout: time.schedule, clearTimeout: time.cancel, localStorage: {
    getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) },
  requestAnimationFrame: callback => time.schedule(() => callback(time.now), 16), cancelAnimationFrame: time.cancel };
  const saved = new Map(Object.keys(fakes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const errors = [];
  const { error, warn } = console;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  console.warn = (...args) => errors.push(args.map(String).join(' '));
  try {
    await withDom(async ({ window, document, mount }) => {
      for (const [key, value] of Object.entries(fakes)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      window.matchMedia = media => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      const sport = getSport('football'), teamRng = makeRng(912);
      const teams = Object.fromEntries(IDS.map(id => [id, buildTeam(id, teamRng, sport)]));
      for (const team of Object.values(teams)) team.baseEff = teamEff(team);
      teams['380'].baseEff = 999;
      let app;
      class MountedApp extends App {
        constructor(props) {
          super(props);
          this.clock = new PlaybackClock({ now: () => time.now, schedule: time.schedule, cancel: time.cancel });
          this.timers = this.clock.tasks;
          this.geo = atlas(STAR);
          this.labelGeometry = [];
          this.rng = makeRng(5);
          this.state = { ...this.state, phase: 'playing', teams, own: Object.fromEntries(IDS.map(id => [id, id])), aliveIds: IDS.slice(),
            stats: Object.fromEntries(IDS.map(id => [id, { conq: 0, steals: [] }])), managedTeamId: '380', followedId: '380',
            seed: 5, rngState: this.rng.getState(),
            settings: { ...this.state.settings, sport: 'football', scope: 'UEFA', pacing: 'duel', resolution: 'ticker', role: 'manager',
              managedTeamId: '380', turnOrder: 'round-robin', targeting: 'player' } };
          this.state.initialSettings = { ...this.state.settings };
        }
        boot() {}
      }
      await mount(React.createElement(MountedApp, { ref: value => { if (value) app = value; } }));
      await act(async () => app.nextAction());
      const pending = app.state.pendingTarget;
      assert.ok(pending, 'pending target');
      const rows = [...document.querySelectorAll('section.target-panel [role=radiogroup][data-space-primary] [role=radio]')];
      assert.equal(rows.length, pending.optionIds.length);
      assert.equal(rows.find(row => row.getAttribute('aria-checked') === 'true')?.dataset.teamId, pending.selectedId);
      assert.equal(document.querySelector('.mast__cta')?.textContent, `Attack ${teams[pending.selectedId].name}`);
      assert.match(document.querySelector('.turn-strip')?.textContent || '', /Turn 1 of 5/);
      assert.ok(document.querySelector('.target-card'), 'the map card is anchored on the map');
      const other = rows.find(row => row.dataset.teamId !== pending.selectedId);
      await act(async () => other.click());
      assert.equal(app.state.pendingTarget.selectedId, other.dataset.teamId);
      other.focus();
      await act(async () => other.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
      assert.equal(app.state.pendingTarget, null, 'Space on a target row runs the primary (A-8)');
      assert.equal(app.state.spin?.stage, 'locked');
      assert.equal(app.state.spin?.targetId, other.dataset.teamId);
      assert.equal(document.querySelector('section.target-panel'), null);
      await act(async () => time.advance(1000));
      assert.equal(app.state.tacticalChoice?.dId, other.dataset.teamId);
    });
  } finally {
    console.error = error;
    console.warn = warn;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
  assert.deepEqual(errors, [], 'console-clean');
});

test('non-default modes replay deterministically on the real atlas (turn-replay)', () => {
  const base = { seed: 73119, sport: 'football', scope: 'CONMEBOL', pacing: 'duel', resolution: 'instant' };
  const roundRobin = { ...base, turnOrder: 'round-robin' };
  const first = runProductionCampaign(roundRobin);
  assert.deepEqual(runProductionCampaign(roundRobin), first);
  assert.equal(first.completed, true);
  assert.equal(first.redraws, 0);
  assert.notDeepEqual(first.outcomes, runProductionCampaign(base).outcomes, 'round robin really changes who attacks');

  const choosing = { ...base, turnOrder: 'round-robin', targeting: 'player', managerPolicy: 'adaptive', managerRank: 1 };
  const chosen = runProductionCampaign(choosing);
  assert.deepEqual(runProductionCampaign(choosing), chosen);
  assert.equal(chosen.completed, true);
  assert.ok(chosen.targetDecisions > 0, 'the manager chose targets');
  assert.equal(chosen.stoppedReason, null);

  const randomChoosing = { ...base, targeting: 'player', managerPolicy: 'balanced', managerRank: 1 };
  const randomChosen = runProductionCampaign(randomChoosing);
  assert.deepEqual(runProductionCampaign(randomChoosing), randomChosen);
  assert.equal(randomChosen.completed, true);
  assert.ok(randomChosen.targetDecisions > 0);
});
