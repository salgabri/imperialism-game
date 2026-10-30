// Owner: WP-0 (see PLAN.md §5.2; WP-INT in W3). The v4 view router on the real bundled App: derived views,
// setView/locks, the primary action table, Space (A-8), auto-switch to Match and its revert, speed rescheduling,
// selectTeam/squadBack focus, and render purity in every phase (no throw, CommandBar props kept, RNG/timers unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exportCampaign, loadSave } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';
import { selectLineup } from '../src/data/teams.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { empireNeighbors } from '../src/engine/campaign.js';
import { politicalFill } from '../src/data/empireColours.js';
import { ROOT, bundleApp, findElement, forceResult, syncAppFixture, withDom } from './lib/app-harness.mjs';

const BundledApp = await bundleApp();

const UI_ONLY = ['view', 'viewSource', 'squadReturn', 'tacticalPreview', 'phoneSheet', 'phoneMore', 'wholeMap', 'focusLayout',
  'targetHoverId'];
const PENDING = { attackerId: '250', optionIds: ['276', '826'], selectedId: '276', round: 1, openedAt: 0, resumeAutoplay: false, turn: null };

const fixture = options => syncAppFixture(options);
/** Run `fn(f)` on a fresh fixture and always restore the globals. */
async function withApp(options, fn) {
  const f = fixture(options);
  try { return await fn(f); } finally { f.close(); }
}
const manager = { role: 'manager' };

/** Bring a manager fixture to the signing screen: kickoff, a forced win for ids[0], finishMatch. */
function reachChoice(app) {
  app.startMatch('250', '276');
  app.chooseTactic('balanced');
  forceResult(app, '250', { aId: '250', dId: '276' });
  app.finishMatch();
  assert.ok(app.state.choice, 'the managed win opens the signing choice');
}

/** Render to static markup in Node and check the purity contract. Returns the markup. */
function renderPure(app, label) {
  const rng = app.rng?.getState?.();
  const timers = app.timers.size;
  const state = app.state;
  const tree = app.render();
  const html = renderToStaticMarkup(tree);
  assert.equal(app.rng?.getState?.(), rng, `${label}: render never touches the RNG`);
  assert.equal(app.timers.size, timers, `${label}: render adds no timers`);
  assert.equal(app.state, state, `${label}: render never sets state`);
  const bar = findElement(tree, 'CommandBar');
  assert.ok(bar, `${label}: CommandBar is found by name`);
  assert.ok('saveStatus' in bar.props, `${label}: CommandBar receives saveStatus`);
  assert.equal(typeof bar.props.onCancelNew, 'function', `${label}: CommandBar receives onCancelNew`);
  assert.equal(React.Children.toArray(tree.props.children)[0].type.name, 'CommandBar', `${label}: CommandBar is the first root child`);
  return html;
}

// ---------- derived view ----------

test('currentView: setup while loading/setup, conquest for a choice, map for a pending target, else the chosen view', async () => {
  await withApp({ phase: 'loading' }, ({ app }) => assert.equal(app.currentView(), 'setup'));
  await withApp({ phase: 'setup' }, ({ app }) => assert.equal(app.currentView(), 'setup'));
  await withApp({}, ({ app }) => {
    assert.equal(app.currentView(), 'map');
    for (const view of ['squad', 'match', 'ledger', 'chronicle', 'map']) {
      app.setState({ view });
      assert.equal(app.currentView(), view);
    }
    app.setState({ view: 'ledger', pendingTarget: PENDING });
    assert.equal(app.currentView(), 'map');
    app.setState({ pendingTarget: null, choice: { candidates: [{ index: 0, name: 'A' }], selected: 0 } });
    assert.equal(app.currentView(), 'conquest');
    app.setState({ choice: null, view: 'bogus' });
    assert.equal(app.currentView(), 'map');
    assert.deepEqual(['conquest', 'setup', 'squad', 'map'].map(view => app.navView(view)), ['map', null, 'squad', 'map']);
  });
});

test('setView: known ids only, viewSource user, closes More, ignored for non-map views while locked, never saved', async () => {
  await withApp({}, ({ app, storage }) => {
    const timers = app.timers.size;
    const rng = app.rng.getState();
    app.setState({ phoneMore: true });
    app.setView('ledger');
    assert.deepEqual([app.state.view, app.state.viewSource, app.state.phoneMore], ['ledger', 'user', false]);
    app.setView('nowhere');
    assert.equal(app.state.view, 'ledger');
    app.setView('setup');
    assert.equal(app.state.view, 'ledger', 'setup and conquest are derived, never chosen');
    app.setView('conquest');
    assert.equal(app.state.view, 'ledger');
    app.setState({ pendingTarget: PENDING });
    app.setView('squad');
    assert.equal(app.state.view, 'ledger', 'A-13: the target choice holds the screen');
    app.setView('map');
    assert.equal(app.state.view, 'map', 'Map stays reachable');
    app.setState({ pendingTarget: null, choice: { candidates: [{ index: 0, name: 'A' }], selected: 0 } });
    app.setView('chronicle');
    assert.equal(app.state.view, 'map');
    app.setState({ choice: null });
    app.setView('chronicle');
    assert.equal(app.timers.size, timers, 'routing adds no timers');
    assert.equal(app.rng.getState(), rng);
    app.setState({ squadReturn: 'ledger', tacticalPreview: true, phoneSheet: 'expanded', wholeMap: true, focusLayout: 'conquest',
      targetHoverId: '276' });
    const exported = JSON.parse(exportCampaign(app.state));
    for (const key of UI_ONLY) assert.ok(!(key in exported), `${key} is UI-only`);
    app.persist();
    const saved = JSON.parse(storage.getItem(SAVE_KEY));
    for (const key of UI_ONLY) assert.ok(!(key in saved), `${key} is not persisted`);
  });
});

// ---------- primary action (DEC D13) ----------

test('primaryAction follows the §3.3 table and is pure', async () => {
  await withApp({}, ({ app }) => {
    const pure = label => {
      const state = app.state, rng = app.rng.getState(), timers = app.timers.size;
      const action = app.primaryAction();
      assert.equal(app.state, state, `${label}: no setState`);
      assert.equal(app.rng.getState(), rng, `${label}: no RNG`);
      assert.equal(app.timers.size, timers, `${label}: no timers`);
      return action && { id: action.id, label: action.label, mastLabel: action.mastLabel, disabled: !!action.disabled };
    };
    assert.deepEqual(pure('spectator idle'), { id: 'play', label: 'Play campaign', mastLabel: undefined, disabled: false });
    app.setState({ autoplay: true });
    assert.deepEqual(pure('autoplay'), { id: 'pause', label: 'Pause', mastLabel: undefined, disabled: false });
    app.setState({ autoplay: false, paused: true });
    // DEC D13: a spectator's primary is Pause / Play campaign, paused or not (Play resumes the clock and autoplay).
    assert.deepEqual(pure('spectator paused'), { id: 'play', label: 'Play campaign', mastLabel: undefined, disabled: false });
    app.setState({ paused: false, pendingTarget: PENDING });
    assert.deepEqual(pure('pending target'), { id: 'attack', label: `Attack ${app.state.teams['276'].name}`, mastLabel: undefined, disabled: false });
    app.setState({ pendingTarget: { ...PENDING, selectedId: 'gone' } });
    assert.equal(pure('missing target').disabled, true);
    app.setState({ pendingTarget: null, aliveIds: ['250'] });
    assert.deepEqual(pure('completed'), { id: 'results', label: 'Results', mastLabel: undefined, disabled: false });
    app.setState({ aliveIds: ['250', '276', '826'] });
    for (const blocker of [{ storageDialog: { mode: 'slots' } }, { storageConflict: true }, { exportText: '{}' }, { managerElimination: { teamId: '250' } }]) {
      app.setState(blocker);
      assert.equal(pure(Object.keys(blocker)[0]), null);
      app.setState(Object.fromEntries(Object.keys(blocker).map(key => [key, key === 'storageConflict' ? false : null])));
    }
    app.setState({ phase: 'victory' });
    assert.equal(pure('victory'), null);
  });
  await withApp({ phase: 'setup' }, ({ app }) => assert.equal(app.primaryAction(), null));
  await withApp({ phase: 'loading' }, ({ app }) => assert.equal(app.primaryAction(), null));
  await withApp(manager, ({ app }) => {
    assert.deepEqual([app.primaryAction().id, app.primaryAction().label], ['continue', 'Continue']);
    app.setState({ paused: true });
    assert.deepEqual([app.primaryAction().id, app.primaryAction().label], ['resume', 'Resume'], 'a manager resumes a paused match');
    app.setState({ paused: false, spin: { key: 'k', tid: '250' } });
    assert.deepEqual([app.primaryAction().id, app.primaryAction().label, app.primaryAction().disabled], ['drawing', 'Continue', true]);
    app.setState({ spin: null, match: { aId: '250', dId: '276', applied: false, done: false, shown: [] } });
    assert.deepEqual([app.primaryAction().id, app.primaryAction().label], ['finish', 'Finish match']);
    app.setState({ match: null });
    app.startMatch('250', '276');
    assert.ok(app.state.tacticalChoice && !app.state.tacticalPreview, 'DEC D10: the gate does not open its dialog');
    assert.deepEqual([app.primaryAction().id, app.primaryAction().label], ['kickoff', 'Continue']);
  });
  await withApp(manager, ({ app }) => {
    reachChoice(app);
    const [first, second] = app.state.choice.candidates;
    let action = app.primaryAction();
    assert.deepEqual([action.id, action.label, action.mastLabel], ['sign', `Sign ${first.name}`, 'Sign player']);
    app.selectAcquisition(second.index);
    assert.equal(app.state.choice.selected, second.index);
    action = app.primaryAction();
    assert.equal(action.label, `Sign ${second.name}`);
    app.selectAcquisition(-99);
    assert.equal(app.state.choice.selected, second.index, 'unknown candidates are ignored');
  });
});

test('runPrimary runs the enabled action and skips a disabled one', async () => {
  await withApp({}, ({ app }) => {
    app.runPrimary();
    assert.equal(app.state.autoplay, true, 'spectator Play campaign');
    app.runPrimary();
    assert.deepEqual([app.state.autoplay, app.state.paused], [false, true], 'Pause');
    assert.equal(app.clock.paused, true);
    assert.equal(app.primaryAction().id, 'play', 'the paused spectator is offered Play campaign');
    app.runPrimary();
    assert.deepEqual([app.state.autoplay, app.state.paused, app.clock.paused], [true, false, false],
      'Pause then Play keeps the campaign running (autoplay is not lost)');
  });
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    app.chooseTactic('balanced');
    app.pausePlayback();
    assert.equal(app.primaryAction().id, 'resume');
    app.runPrimary();
    assert.deepEqual([app.state.paused, app.state.autoplay, app.clock.paused], [false, false, false], 'manager Resume');
    app.clearTimers();
  });
  await withApp(manager, ({ app }) => {
    app.setState({ spin: { key: 'k', tid: '250' } });
    let ran = 0;
    app.step = () => ran++;
    app.runPrimary();
    assert.equal(ran, 0, 'the drawing primary is disabled');
    app.setState({ spin: null });
    app.runPrimary();
    assert.equal(ran, 1, 'Continue runs step()');
  });
  await withApp(manager, ({ app }) => {
    reachChoice(app);
    const target = app.state.choice.candidates.at(-1);
    app.selectAcquisition(target.index);
    const signed = [];
    app.chooseAcquisition = index => signed.push(index);
    app.runPrimary();
    assert.deepEqual(signed, [target.index], 'Sign runs chooseAcquisition with the selected candidate');
  });
  await withApp({}, ({ app }) => {
    app.setState({ pendingTarget: PENDING });
    let confirmed = 0;
    app.confirmTarget = () => confirmed++;
    app.runPrimary();
    assert.equal(confirmed, 1);
  });
});

// ---------- Space (A-8) ----------

test('Space runs the primary unless focus is on a control, a modal is open, or the press is repeated/modified', async () => {
  await withDom(async ({ document, window }) => withApp({}, ({ app }) => {
    document.body.innerHTML = `<main id="page"><p id="text" tabindex="-1">Copy</p>
      <button id="button">B</button><input id="input"><select id="select"><option>a</option></select><textarea id="area"></textarea>
      <details><summary id="summary">S</summary></details><a id="link" href="#x">L</a><div id="editable" contenteditable="true"></div>
      <div role="button" id="rb"></div><div role="tab" id="tab"></div><div role="switch" id="switch"></div><div role="menu"><span id="menuitem"></span></div>
      <div role="radiogroup"><div role="radio" id="loose-radio"></div></div>
      <div role="dialog"><span id="in-dialog"></span></div>
      <section id="phone-more" class="more-sheet" aria-label="More" tabindex="-1"><p id="in-sheet">Copy</p></section></main>`;
    const press = (id, init = {}) => {
      const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...init });
      document.getElementById(id).dispatchEvent(event);
      return event.defaultPrevented;
    };
    window.addEventListener('keydown', app.handleKeyDown);
    try {
      const rng = app.rng.getState();
      // The More sheet focuses itself when it opens: Space there scrolls it, never the campaign behind it.
      for (const id of ['button', 'input', 'select', 'area', 'summary', 'link', 'editable', 'rb', 'tab', 'switch', 'menuitem', 'loose-radio', 'in-dialog',
        'phone-more', 'in-sheet']) {
        assert.equal(press(id), false, `${id} keeps its own Space`);
        assert.equal(app.state.autoplay, false, `${id}: no primary`);
      }
      assert.equal(press('text', { repeat: true }), false, 'auto-repeat is ignored');
      for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) assert.equal(press('text', { [modifier]: true }), false, modifier);
      assert.equal(press('text', { key: 'Enter' }), false, 'only Space');
      const blocked = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      blocked.preventDefault();
      document.getElementById('text').dispatchEvent(blocked);
      assert.equal(app.state.autoplay, false, 'an already handled press is ignored');
      document.body.insertAdjacentHTML('beforeend', '<div aria-modal="true" id="modal"></div>');
      assert.equal(press('text'), false, 'an open modal owns the keyboard');
      document.getElementById('modal').remove();
      assert.equal(app.rng.getState(), rng, 'ignored presses never touch the RNG');
      assert.equal(app.timers.size, 0);

      assert.equal(press('text'), true, 'plain text focus: Space runs the primary and prevents scrolling');
      assert.equal(app.state.autoplay, true);
      assert.equal(press('page'), true);
      assert.deepEqual([app.state.autoplay, app.state.paused], [false, true]);
      app.setState({ storageDialog: { mode: 'slots' } });
      const paused = app.state.paused;
      assert.equal(press('page'), false, 'no primary while a dialog state is set');
      assert.equal(app.state.paused, paused);
    } finally {
      window.removeEventListener('keydown', app.handleKeyDown);
    }
  }));
});

test('Space on the selected conquest option (rendered ConquestScreen) signs that candidate', async () => {
  await withDom(async ({ document, window, mount }) => withApp(manager, async ({ app }) => {
    reachChoice(app);
    const chosen = app.state.choice.candidates.at(-1);
    app.selectAcquisition(chosen.index);
    const signed = [];
    app.chooseAcquisition = index => signed.push(index);
    const screen = findElement(app.render(), 'ConquestScreen');
    assert.ok(screen, 'the choice renders the conquest screen');
    const view = await mount(screen);
    const article = view.host.querySelector('article.screen--conquest');
    assert.ok(article);
    assert.equal(article.getAttribute('role'), null, 'a screen, never a dialog');
    assert.equal(article.getAttribute('aria-modal'), null);
    const radio = view.host.querySelector('[data-space-primary] [role=radio][aria-checked="true"]');
    assert.ok(radio, 'the selected option is a radio inside [data-space-primary]');
    window.addEventListener('keydown', app.handleKeyDown);
    try {
      await act(async () => radio.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    } finally {
      window.removeEventListener('keydown', app.handleKeyDown);
    }
    assert.deepEqual(signed, [chosen.index]);
    assert.equal(document.querySelectorAll('[aria-modal="true"]').length, 0);
  }));
});

test('Space on a target row (rendered TargetPanel) confirms the target', async () => {
  await withDom(async ({ window, mount }) => withApp({}, async ({ app }) => {
    app.setState({ pendingTarget: PENDING });
    let confirmed = 0;
    app.confirmTarget = () => confirmed++;
    const column = findElement(app.render(), 'CampaignColumn');
    assert.ok(column?.props.targetPanel, 'the pending target puts TargetPanel in the column');
    const teams = app.state.teams;
    const rows = PENDING.optionIds.map(id => ({ teamId: id, flagId: teams[id].flagId, isClub: false, code: teams[id].code, name: teams[id].name,
      eff: '80.5', spoils: '+1', win: '66%', tone: 'gain', selected: id === PENDING.selectedId }));
    const view = await mount(React.cloneElement(column.props.targetPanel, { rows, count: '2 neighbours in reach', selectedId: '276',
      ctaLabel: `Attack ${teams['276'].name}` }));
    assert.ok(!view.host.querySelector('[role=dialog], [aria-modal]'));
    const row = view.host.querySelector('[data-space-primary] [role=radio][aria-checked="true"]');
    assert.ok(row, 'the selected row is a radio inside [data-space-primary]');
    window.addEventListener('keydown', app.handleKeyDown);
    try {
      await act(async () => row.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    } finally {
      window.removeEventListener('keydown', app.handleKeyDown);
    }
    assert.equal(confirmed, 1);
  }));
});

// ---------- flow gates while a target is pending ----------

test('a pending target blocks step, togglePlay, pausePlayback and nextAction', async () => {
  await withApp({}, ({ app }) => {
    app.setState({ pendingTarget: PENDING });
    const before = { round: app.state.round, rng: app.rng.getState() };
    app.step(); app.togglePlay(); app.pausePlayback(); app.nextAction();
    assert.deepEqual([app.state.round, app.state.autoplay, app.state.paused, app.rng.getState()], [before.round, false, false, before.rng]);
    assert.equal(app.timers.size, 0);
  });
});

// ---------- resume ----------

test('a reloaded signing is framed like the live one; other reloads reset the camera layout', () => {
  const live = fixture(manager);
  let savedText, framing;
  try {
    reachChoice(live.app);
    framing = { focusLayout: live.app.state.focusLayout, focusBounds: live.app.state.focusBounds };
    assert.equal(framing.focusLayout, 'conquest');
    assert.deepEqual(framing.focusBounds, { x: 180, y: 80, w: 40, h: 40 }, 'the taken land of 276 on the tiny atlas');
    savedText = live.storage.getItem(SAVE_KEY);
  } finally { live.close(); }
  const resumed = fixture({ ...manager, savedText });
  try {
    const { app } = resumed;
    app.saved = loadSave();
    const focusKey = app.state.focusKey;
    app.resume();
    assert.ok(app.state.choice, 'the signing is restored');
    assert.deepEqual([app.state.focusLayout, app.state.focusBounds], [framing.focusLayout, framing.focusBounds]);
    assert.equal(app.state.focusKey, focusKey + 1, 'the framing is applied as a new focus request');
    assert.equal(app.currentView(), 'conquest');
    assert.equal(app.rng.getState(), app.saved.rngState, 'framing draws nothing');
    assert.equal(app.timers.size, 0);
  } finally { resumed.close(); }
  const plain = fixture({});
  try {
    plain.app.persist();
    const text = plain.storage.getItem(SAVE_KEY);
    const again = fixture({ savedText: text });
    try {
      again.app.saved = loadSave();
      again.app.setState({ focusLayout: 'conquest' });
      again.app.resume();
      assert.equal(again.app.state.focusLayout, null, 'no signing: the conquest layout is dropped');
    } finally { again.close(); }
  } finally { plain.close(); }
});

// ---------- auto-switch to Match (DEC D11) ----------

function kickoff(options, { view = 'map', express = false, simulate = false } = {}) {
  const f = fixture({ ...manager, ...options, settings: { express, ...options?.settings } });
  f.app.setState({ view });
  f.app.startMatch('250', '276');
  if (simulate) f.app.simulateResult(); else f.app.chooseTactic('balanced');
  return f;
}

test('a managed ticker kickoff from Map switches to Match without timers or RNG of its own', () => {
  const fromMap = kickoff();
  const fromLedger = kickoff({}, { view: 'ledger' });
  try {
    assert.deepEqual([fromMap.app.state.view, fromMap.app.state.viewSource], ['match', 'auto']);
    assert.deepEqual([fromLedger.app.state.view, fromLedger.app.state.viewSource], ['ledger', 'user'], 'only from Map');
    assert.equal(fromMap.app.timers.size, fromLedger.app.timers.size, 'the switch schedules nothing');
    assert.equal(fromMap.app.rng.getState(), fromLedger.app.rng.getState(), 'the switch draws nothing');
    assert.equal(fromMap.app.state.match.instant, false);
    assert.equal(fromMap.app.state.tacticalPreview, false);
  } finally { fromMap.close(); fromLedger.close(); }
});

test('no auto-switch for an express match, instant resolution or "simulate the result"', async () => {
  for (const [label, f] of [['instant', kickoff({ settings: { resolution: 'instant' } })], ['simulate', kickoff({}, { simulate: true })]]) {
    try {
      assert.deepEqual([f.app.state.view, f.app.state.viewSource], ['map', 'user'], label);
      if (label === 'simulate') assert.equal(f.app.state.match.instant, true);
    } finally { f.close(); }
  }
  // Express never shortens a match the manager plays in, so that match still switches; an express match never does.
  const expressSetting = kickoff({}, { express: true });
  try {
    assert.equal(expressSetting.app.state.match.express, false);
    assert.deepEqual([expressSetting.app.state.view, expressSetting.app.state.viewSource], ['match', 'auto']);
  } finally { expressSetting.close(); }
  await withApp(manager, ({ app }) => {
    const st = app.state;
    assert.deepEqual(app.autoMatchView(st, '250', '276'), { view: 'match', viewSource: 'auto' });
    assert.deepEqual(app.autoMatchView(st, '250', '276', { express: true }), {});
    assert.deepEqual(app.autoMatchView(st, '250', '276', { instant: true }), {});
    assert.deepEqual(app.autoMatchView(st, '276', '826'), {}, 'not the managed team');
    assert.deepEqual(app.autoMatchView({ ...st, view: 'squad' }, '250', '276'), {}, 'only from Map');
    assert.deepEqual(app.autoMatchView({ ...st, settings: { ...st.settings, resolution: 'instant' } }, '250', '276'), {});
  });
});

test('a spectator auto-switches only for the followed team, and nextAction reverts to Map with no extra timers', async () => {
  await withApp({}, ({ app }) => {
    app.startMatch('250', '276');
    assert.equal(app.state.view, 'map', 'no followed team: stay on Map');
  });
  const run = viewSource => {
    const f = fixture({});
    f.app.followTeam('250');
    f.app.startMatch('250', '276');
    if (viewSource === 'auto') assert.deepEqual([f.app.state.view, f.app.state.viewSource], ['match', 'auto']);
    else f.app.setState({ view: 'map', viewSource: 'user' });
    forceResult(f.app, '250', { aId: '250', dId: '276' });
    f.app.finishMatch();
    f.time.advance(10000);
    f.app.clearTimers();
    assert.ok(f.app.state.match.applied);
    f.app.nextAction();
    return f;
  };
  const reverted = run('auto'), stayed = run('user');
  try {
    assert.deepEqual([reverted.app.state.view, reverted.app.state.viewSource], ['map', 'user'], 'reverts at the next action');
    assert.equal(reverted.app.timers.size, stayed.app.timers.size, 'the revert schedules nothing of its own');
    assert.equal(reverted.app.rng.getState(), stayed.app.rng.getState());
  } finally { reverted.close(); stayed.close(); }
  await withApp({}, ({ app }) => {
    app.setState({ view: 'ledger', viewSource: 'user', match: { applied: true } });
    app.nextAction();
    assert.equal(app.state.view, 'ledger', 'a view the user chose is kept');
    app.clearTimers();
  });
});

test('the match preview opens and closes the tactical dialog; Continue kicks off with balanced', async () => {
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    assert.ok(!renderPure(app, 'gate').includes('data-tactic'), 'no auto-open');
    app.openMatchPreview();
    assert.equal(app.state.tacticalPreview, true);
    const previewHtml = renderPure(app, 'preview');
    assert.ok(previewHtml.includes('data-tactic'));
    // Board 07: the dialog gets the full preview model (both sides) and the "simulate the result" link (DEC D10).
    const dialog = findElement(app.render(), 'TacticalChoice');
    assert.equal(dialog.props.preview, app.matchPreviewModel(), 'the memoised preview model reaches the dialog');
    assert.ok(dialog.props.preview?.a && dialog.props.preview?.b, 'both XIs are in the preview');
    assert.equal(typeof dialog.props.onSimulate, 'function');
    assert.match(previewHtml, /simulate the result/);
    app.closeMatchPreview();
    assert.equal(app.state.tacticalPreview, false);
    const chosen = [];
    const original = app.chooseTactic.bind(app);
    app.chooseTactic = (id, options) => { chosen.push(id); return original(id, options); };
    app.runPrimary();
    assert.deepEqual(chosen, ['balanced']);
    assert.ok(app.state.match && !app.state.tacticalChoice);
  });
});

test('the preview dialog "simulate the result" link kicks off an instant match with the default approach', async () => {
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    app.openMatchPreview();
    findElement(app.render(), 'TacticalChoice').props.onSimulate();
    assert.ok(app.state.match && !app.state.tacticalChoice && !app.state.tacticalPreview);
    assert.deepEqual([app.state.match.instant, app.state.match.tactic], [true, 'balanced']);
    assert.deepEqual([app.state.view, app.state.viewSource], ['map', 'user'], 'an instant match never auto-switches');
  });
});

// ---------- speed (A-12 hook) ----------

test('setSpeed and cycleSpeed hand the previous speed to rescheduleForSpeed', async () => {
  await withApp({}, ({ app }) => {
    const calls = [];
    app.rescheduleForSpeed = previous => calls.push([previous, app.state.speed]);
    app.setSpeed(4);
    app.setSpeed(4);
    app.setSpeed(3);
    app.cycleSpeed();
    app.cycleSpeed();
    app.cycleSpeed();
    assert.deepEqual(calls, [[1, 4], [4, 1], [1, 2], [2, 4]]);
    assert.equal(app.timers.size, 0);
  });
});

// ---------- selectTeam / squadBack / showDetails ----------

test('selectTeam opens Squad with tab squad and remembers where it came from; squadBack restores focus', async () => {
  await withDom(async ({ document }) => withApp({}, ({ app }) => {
    document.body.innerHTML = '<section id="view-panel-squad" tabindex="-1"></section>'
      + '<section id="view-panel-ledger" tabindex="-1"><button data-team-id="250">Fra</button><button data-team-id="276">Ger</button></section>'
      + '<aside id="campaign-details" tabindex="-1"></aside>';
    app.selectTeam('276');
    assert.deepEqual([app.state.selected, app.state.tab, app.state.view, app.state.squadReturn], ['276', 'squad', 'squad', 'map']);
    assert.equal(document.activeElement.id, 'view-panel-squad');
    app.setView('ledger');
    app.selectTeam('276');
    assert.equal(app.state.squadReturn, 'ledger');
    app.selectTeam('250');
    assert.equal(app.state.squadReturn, 'ledger', 'a squad opened from a squad keeps the original origin');
    app.squadBack();
    assert.equal(app.state.view, 'ledger');
    assert.equal(document.activeElement.dataset.teamId, '250', 'focus returns to the team row');
    app.selectTeam('nobody');
    assert.equal(app.state.view, 'ledger', 'unknown ids are ignored');
    app.showDetails();
    assert.equal(app.state.view, 'map');
    assert.equal(document.activeElement.id, 'campaign-details');
    app.setState({ pendingTarget: PENDING });
    app.selectTeam('826');
    assert.deepEqual([app.state.selected, app.state.view], ['826', 'map'], 'a pending decision keeps the screen');
    assert.equal(app.timers.size, 0);
  }));
});

test('a Squad opened from the nav has no origin (board C1); re-selecting Squad keeps the current one', async () => {
  await withApp({}, ({ app }) => {
    app.selectTeam('276');
    assert.equal(app.state.squadReturn, 'map');
    app.setView('squad');
    assert.equal(app.state.squadReturn, 'map', 'already on Squad: the origin is kept');
    app.setView('ledger');
    app.setView('squad');
    assert.deepEqual([app.state.view, app.state.squadReturn], ['squad', null], 'the nav-opened squad has no Back origin');
    assert.equal(findElement(app.render(), 'SquadScreen').props.back ?? null, null, 'no Back button on a nav-opened squad');
    app.squadBack();
    assert.equal(app.state.view, 'map', 'Back/Escape falls back to the map');
    app.setView('chronicle');
    app.selectTeam('250');
    assert.equal(app.state.squadReturn, 'chronicle', 'selectTeam still records where it came from');
  });
});

test('Back from a squad opened in the Chronicle returns focus to the selected history row', async () => {
  await withDom(async ({ document, mount }) => withApp({}, async ({ app, time }) => {
    app.startMatch('250', '276');
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.finishMatch();
    time.advance(10000);
    app.clearTimers();
    const entry = app.state.history.at(-1);
    assert.ok(entry?.id, 'the finished match is in the history');
    app.setView('chronicle');
    app.setState({ selectedHistoryId: entry.id });
    const chronicle = findElement(app.render(), 'ChronicleScreen');
    assert.ok(chronicle, 'the Chronicle view renders ChronicleScreen');
    const view = await mount(chronicle);
    assert.ok(view.host.querySelector(`#view-panel-chronicle .fi-history-list [aria-pressed="true"][data-history-id="${entry.id}"]`),
      'the real Chronicle markup carries the pressed history row');
    app.selectTeam('276');
    assert.deepEqual([app.state.view, app.state.squadReturn], ['squad', 'chronicle']);
    app.squadBack();
    assert.equal(app.state.view, 'chronicle');
    assert.equal(document.activeElement?.dataset?.historyId, String(entry.id), 'focus lands on the selected history row');
    assert.equal(app.timers.size, 0);
  }));
});

// ---------- render in Node, every phase ----------

test('render is pure in loading (no geo, teams {}) and setup (teams {}, aliveIds [])', async () => {
  await withApp({ phase: 'loading' }, ({ app }) => {
    assert.equal(app.geo, undefined);
    assert.deepEqual(app.state.teams, {});
    assert.match(renderPure(app, 'loading'), /loading-screen/);
    app.setState({ err: 'MAP DATA FAILED TO LOAD' });
    assert.match(renderPure(app, 'load error'), /Try again/);
  });
  await withApp({ phase: 'setup' }, ({ app }) => {
    assert.deepEqual([app.state.teams, app.state.aliveIds], [{}, []]);
    const html = renderPure(app, 'setup');
    assert.match(html, /data-view="setup"/);
    assert.match(html, /setup-overlay/);
    assert.ok(!html.includes('mast__nav'), 'no nav before a campaign');
    assert.match(html, /<main class="campaign-layout" data-view="setup" inert="">/, 'the covered map is inert behind the wizard');
  });
  await withApp({}, ({ app }) => {
    assert.match(renderPure(app, 'campaign'), /<main class="campaign-layout" data-view="map">/, 'a campaign map is never inert');
  });
});

test('setupTeams: best five starters and opening-board land neighbours for the wizard, cached, without the campaign RNG', async () => {
  await withApp({ ids: ['208', '276', '250'] }, ({ app }) => {
    const rng = app.rng.getState();
    // Denmark's Greenland (an overseas dependency, as at launch) borders Germany here; Germany also borders France.
    app.geo = { ...app.geo, adj: { 208: [], 304: ['276'], 276: ['250', '304'], 250: ['276'] } };
    app.setupTeamsCache = null;
    const setup = { ...app.state.setup, sport: 'football', layer: 'nations', scope: 'UEFA', seed: '7' };
    const teams = app.setupTeams(setup);
    assert.equal(app.setupTeams(setup), teams, 'cached per setup key');
    assert.deepEqual(teams.map(team => team.name), teams.map(team => team.name).slice().sort((a, b) => a.localeCompare(b)));
    const byId = Object.fromEntries(teams.map(team => [team.id, team]));
    assert.deepEqual(byId['208'].neighbours, ['276']);
    assert.deepEqual(byId['276'].neighbours.slice().sort(), ['208', '250']);
    assert.deepEqual(byId['250'].neighbours, ['276']);
    for (const team of teams) {
      const built = app.state.teams[team.id];
      const best = selectLineup(built).starters.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name)).slice(0, 5);
      assert.deepEqual(team.players, best.map(player => ({ pos: player.pos, name: player.name, rating: player.rating })), `${team.id} best players`);
      assert.ok(team.players.every((player, index) => index === 0 || team.players[index - 1].rating >= player.rating));
    }
    assert.equal(app.rng.getState(), rng, 'the wizard list never touches the campaign RNG');
    assert.equal(app.timers.size, 0);
  });
});

test('setupMapPreview: the step-1 map card shows the board a world theatre opens on, framed like its opening camera', async () => {
  await withApp({ ids: ['208', '276', '250'] }, ({ app }) => {
    // Denmark's Greenland (304, an overseas dependency) east of the three nations, and a neutral shape further out.
    const square = x => ({ cx: x + 20, cy: 100, bbox: { x, y: 80, w: 40, h: 40 }, d: `M${x},80h40v40h-40Z` });
    app.geo = { ...app.geo, paths: { ...app.geo.paths, 304: square(380), 999: square(480) },
      countries: [...app.geo.countries, { id: '304' }, { id: '999' }] };
    app.setupTeamsCache = null;
    const setup = { ...app.state.setup, sport: 'football', layer: 'nations', scope: 'world', seed: '7' };
    const preview = app.setupMapPreview(setup);
    // Greenland comes with Denmark, as at launch; the starting land alone sets the frame.
    assert.deepEqual(preview.sections.map(section => [section.id, section.fill]),
      [['208', politicalFill('208')], ['276', politicalFill('276')], ['250', politicalFill('250')], ['304', politicalFill('208')]]);
    assert.deepEqual(preview.backdrop.map(shape => shape.id), ['999']);
    assert.equal(preview.viewBox, '70.4 70.4 259.2 59.2', 'the tiny atlas homes at x 80–320, y 80–120, 4% margin');
    assert.equal(preview.teams, app.setupTeams(setup).length);
    assert.equal(app.setupMapPreview(setup), preview, 'memoised while the setup key holds');
    // Europe frames the continent, exactly as the European opening camera does.
    const europe = app.setupMapPreview({ ...setup, scope: 'UEFA' });
    const focus = app.europeFocus();
    const pad = Math.max(focus.w, focus.h) * .04;
    assert.equal(europe.viewBox, [focus.x - pad, focus.y - pad, focus.w + pad * 2, focus.h + pad * 2].map(n => Number(n.toFixed(1))).join(' '));
    // A country theatre has its own card.
    assert.equal(app.setupMapPreview({ ...setup, layer: 'clubs', clubScope: 'domestic:826' }), null);
  });
  await withApp({ phase: 'setup' }, ({ app }) => {
    assert.match(renderPure(app, 'setup with its map'), /class="setup-map" aria-hidden="true" data-state="ready" data-kind="world"/);
  });
});

test('render is pure for every view of an idle spectator campaign, with the phone sheets open', async () => {
  await withApp({}, ({ app }) => {
    const markers = { map: 'id="campaign-details"', squad: 'id="view-panel-squad"', match: 'id="view-panel-match"',
      ledger: 'id="view-panel-ledger"', chronicle: 'id="view-panel-chronicle"' };
    app.setState({ selected: '276' });
    for (const [view, marker] of Object.entries(markers)) {
      app.setView(view);
      const html = renderPure(app, view);
      assert.ok(html.includes(marker), `${view} renders its screen`);
      assert.match(html, new RegExp(`id="view-tab-${view}"[^>]*aria-current="page"`), `${view} tab is current`);
      assert.match(html, new RegExp(`class="app-shell has-campaign" data-view="${view}" data-role="spectator"`));
      assert.equal((html.match(/data-testid="world-map"/g) || []).length, 1, 'WorldMap is always mounted');
    }
    app.setView('ledger');
    assert.equal((renderPure(app, 'ledger').match(/<table[^>]*class="fi-standings/g) || []).length, 1, 'exactly one standings table');
    app.setState({ phoneMore: true, phoneSheet: 'expanded' });
    const html = renderPure(app, 'phone more');
    assert.match(html, /class="more-sheet"/);
    assert.match(html, /id="sheet-campaign-resolution"/);
    app.setState({ storageDialog: { mode: 'slots' } });
    renderPure(app, 'storage dialog');
  });
});

test('render is pure through a manager campaign: idle, gate, live, choice, pending target, elimination, victory', async () => {
  await withApp(manager, ({ app }) => {
    assert.match(renderPure(app, 'manager idle'), /data-role="manager"/);
    app.startMatch('250', '276');
    renderPure(app, 'tactical gate');
    app.chooseTactic('balanced');
    assert.match(renderPure(app, 'live match'), /id="view-panel-match"/);
    app.setView('map');
    assert.match(renderPure(app, 'live match on map'), /data-testid="match-card"/);
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.finishMatch();
    const choiceHtml = renderPure(app, 'choice');
    assert.match(choiceHtml, /data-view="conquest"/);
    assert.match(choiceHtml, /data-space-primary/);
    assert.ok(!choiceHtml.includes('aria-modal="true"'), 'the conquest screen is not a modal');
    app.chooseAcquisition(app.selectedCandidate().index);
    assert.equal(app.state.view, 'map');
    renderPure(app, 'after signing');
  });
  await withApp({}, ({ app }) => {
    app.setState({ pendingTarget: PENDING });
    assert.match(renderPure(app, 'pending target'), /data-view="map"/);
  });
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    app.chooseTactic('balanced');
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.ok(app.state.managerElimination);
    assert.equal(app.primaryAction(), null);
    renderPure(app, 'elimination');
  });
  await withApp({}, ({ app }) => {
    app.setState({ phase: 'victory', aliveIds: ['250'], completedAt: Date.now() });
    renderPure(app, 'victory');
    app.setState({ phase: 'playing' });
    assert.equal(app.primaryAction().id, 'results');
    renderPure(app, 'completed map');
  });
});

test('matches injected without odds, route, live, tactic or express still render in every view', async () => {
  await withApp({}, ({ app }) => {
    // The shape smoke injects (smoke.entry acquire()): no odds, routeKind, routeLabel, live, tactic or express.
    app.setState({ round: 2, match: { aId: '250', dId: '276', effA: 80.1, effD: 79.4, ga: 1, gd: 0, shown: [], allEv: [], tie: null,
      tieShown: null, winner: '250', finalGa: 1, finalGd: 0, status: 'FT', applied: false, done: true } });
    for (const view of ['map', 'match', 'ledger', 'chronicle', 'squad']) {
      app.setView(view);
      renderPure(app, `odds-less ${view}`);
    }
  });
});

// ---------- decision gates and the playback clock ----------

test('Export during the signing screen leaves the clock running, so the signing plays on', async () => {
  for (const autoplay of [false, true]) {
    await withApp({ ...manager, ids: ['250', '276', '826', '380'] }, ({ app, time }) => {
      app.setState({ autoplay });
      reachChoice(app);
      app.exportProgress();
      assert.ok(app.state.exportText, 'the export dialog opens');
      assert.deepEqual([app.state.paused, app.clock.paused], [false, false], 'a decision gate is never paused by an export');
      app.setState({ exportText: null }); // ExportCheckpoint onClose
      assert.equal(app.primaryAction().id, 'sign');
      app.runPrimary();
      assert.deepEqual([app.state.paused, app.clock.paused], [false, false]);
      assert.ok(app.state.pu, 'the result notice shows');
      time.advance(10000);
      assert.equal(app.state.pu, null, 'the notice clears on the running clock');
      assert.deepEqual(app.state.flash, {}, 'the hatch flash clears');
      if (!autoplay) assert.equal(app.primaryAction().id, 'continue');
      else assert.ok(app.state.matches >= 1 && (app.state.spin || app.state.tacticalChoice || app.state.pendingTarget
        || app.state.round > 1), 'autoplay carries on to the next turn');
      app.clearTimers();
    });
  }
  // Outside a gate an export still holds a live match (unchanged).
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    app.chooseTactic('balanced');
    app.exportProgress();
    assert.deepEqual([app.state.paused, app.clock.paused], [true, true]);
    app.clearTimers();
  });
  // Safety net: a signing made while the clock is somehow paused unfreezes it, as applyConquest writes paused:false.
  await withApp(manager, ({ app }) => {
    reachChoice(app);
    app.clock.pause();
    app.runPrimary();
    assert.deepEqual([app.state.paused, app.clock.paused], [false, false]);
    app.clearTimers();
  });
});

// ---------- stale notices after a reset ----------

const NOTICE = { kind: 'result', label: 'Full time', title: 'France annexes Germany', sub: '+1 territory' };
const TOAST = { code: 'FRA', txt: '90’ GOAL — K. MBAPPÉ', col: '#123456' };

test('loading, restarting or spectating after an elimination drops the previous notice and goal toast', async () => {
  // resume(): Load / Import / Reload / Fork all go through continueSaved → resume.
  await withApp({}, ({ app, time }) => {
    app.persist();
    app.saved = loadSave();
    app.showPopup(NOTICE, 1750);
    app.showToast(TOAST, 1150);
    app.openStorageDialog('slots'); // pauses the clock with both clear tasks pending
    app.continueSaved(app.saved);
    assert.deepEqual([app.state.pu, app.state.toast], [null, null], 'resume');
    time.advance(20000);
    assert.deepEqual([app.state.pu, app.state.toast], [null, null]);
  });
  // startCampaign(): New campaign / Retry this setup.
  await withApp({}, ({ app }) => {
    app.showPopup(NOTICE, 1750);
    app.showToast(TOAST, 1150);
    app.startCampaign();
    assert.equal(app.state.matches, 0);
    assert.deepEqual([app.state.pu, app.state.toast], [null, null], 'startCampaign');
  });
  // The elimination cancels the toast's clear task; both ways out of it drop the toast.
  for (const exit of ['continueAsSpectator', 'retryManager']) {
    await withApp(manager, ({ app, time }) => {
      app.startMatch('250', '276');
      app.chooseTactic('balanced');
      forceResult(app, '276', { aId: '250', dId: '276' });
      app.showToast(TOAST, 1150);
      app.finishMatch();
      assert.ok(app.state.managerElimination);
      app[exit]();
      time.advance(20000);
      assert.deepEqual([app.state.pu, app.state.toast], [null, null], exit);
      app.clearTimers();
    });
  }
});

// ---------- focus after a decision screen ----------

test('confirming a signing or a target hands focus to the enabled primary, never <body>', async () => {
  await withDom(async ({ document }) => withApp(manager, ({ app }) => {
    document.body.innerHTML = '<header><button type="button" id="mast-cta" data-primary>Sign player</button></header>'
      + '<div><button type="button" id="phone-cta" data-primary>Sign player</button></div><button type="button" id="other">Other</button>';
    const mast = document.getElementById('mast-cta'), phone = document.getElementById('phone-cta');
    reachChoice(app);
    document.activeElement?.blur?.();
    app.chooseAcquisition(app.selectedCandidate().index);
    assert.equal(app.state.choice, null);
    assert.equal(document.activeElement?.id, 'mast-cta', 'the signing hands focus to the masthead primary');
    app.clearTimers();

    // A disabled primary (the masthead's here) is skipped for the next one; a fully disabled one is retried later.
    app.setState({ pendingTarget: PENDING });
    mast.blur();
    mast.disabled = true;
    app.setState({ pendingTarget: null });
    assert.equal(document.activeElement?.id, 'phone-cta', 'the first enabled primary takes focus');
    app.setState({ pendingTarget: PENDING });
    phone.blur();
    phone.disabled = true;
    app.setState({ pendingTarget: null, spin: { key: 'k', tid: '250' } });
    assert.equal(document.activeElement, document.body, 'nothing enabled yet (the locked draw)');
    mast.disabled = false;
    app.setState({ spin: null });
    assert.equal(document.activeElement?.id, 'mast-cta', 'focus follows the primary once it is enabled');

    // Focus the user moves in the meantime is never taken away.
    app.setState({ pendingTarget: PENDING });
    mast.blur();
    mast.disabled = true;
    app.setState({ pendingTarget: null });
    document.getElementById('other').focus();
    mast.disabled = false;
    app.setState({ spin: null });
    assert.equal(document.activeElement?.id, 'other');
    assert.equal(app.timers.size, 0, 'the rescue schedules nothing');
  }));
});

test('More sheet: Chronicle is disabled while a decision holds the screen and focuses the Chronicle panel', async () => {
  await withDom(async ({ document }) => withApp({}, ({ app }) => {
    document.body.innerHTML = '<section id="view-panel-chronicle" tabindex="-1"></section>';
    app.setState({ phoneMore: true });
    let sheet = findElement(app.render(), 'PhoneMoreSheet');
    assert.equal(sheet.props.locked, false);
    sheet.props.onChronicle();
    assert.deepEqual([app.state.view, app.state.phoneMore], ['chronicle', false]);
    assert.equal(document.activeElement?.id, 'view-panel-chronicle');
    app.setState({ phoneMore: true, pendingTarget: PENDING });
    sheet = findElement(app.render(), 'PhoneMoreSheet');
    assert.equal(sheet.props.locked, true, 'A-13: the target choice locks the Chronicle link');
  }));
});

// ---------- country theatres (domestic campaigns on the v4 App) ----------

/**
 * A setup fixture on the real App lifecycle for country maps: `fetch` serves the shipped `public/domestic` files and
 * a country's fitMap runs for real (the tiny world atlas has no projection, so a world fit stays the fixture's no-op).
 */
async function withCountry(fn) {
  const fetchBefore = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  globalThis.fetch = async url => {
    const file = path.join(ROOT, 'public', ...String(url).replace(/^\//, '').split('/'));
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
  };
  const f = fixture({ phase: 'setup', settings: { sport: 'football', layer: 'clubs', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.fitMap = function fitMap(...args) { return this.domesticMap() ? BundledApp.prototype.fitMap.apply(this, args) : undefined; };
  f.app.opening = BundledApp.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (fetchBefore) Object.defineProperty(globalThis, 'fetch', fetchBefore); else delete globalThis.fetch;
  }
}

test('a country theatre: wizard preview, kickoff on its sections, section names, victory and restore on its map', async () => {
  await withCountry(async ({ app, time }) => {
    // Choosing the country starts its (debounced) load; the wizard waits with an empty field.
    app.pickSetup('clubScope', 'domestic:826');
    assert.equal(app.domesticStatus().state, 'loading');
    assert.deepEqual(app.setupTeams(), []);
    assert.equal(app.scopeName(app.state.setup), 'England · top 100 clubs');
    time.advance(200);
    const loaded = await app.loadCountry('826');
    await new Promise(resolve => setImmediate(resolve));
    const status = app.domesticStatus();
    assert.equal(status.state, 'ready');
    assert.equal(app.geo, loaded.geo, 'the (inert) setup map behind the wizard shows the sections');
    assert.equal(status.preview.sections.length, Object.keys(loaded.sectionNames).length, 'the step-1 card draws every section');
    assert.equal(app.domesticStatus().preview, status.preview, 'the card data is memoised per map');
    const teams = app.setupTeams();
    assert.equal(teams.length, loaded.clubs.length);
    assert.ok(teams.every(team => team.isClub && /^[A-Z]{3}$/.test(team.code) && Array.isArray(team.neighbours)),
      'country clubs carry their own codes and fronts on the sections');
    renderPure(app, 'country setup');

    // Kickoff: one club per section, the map build stamped, routes aim across section borders.
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.equal(st.settings.domesticVersion, loaded.meta.version);
    assert.equal(st.settings.turnOrder, 'random');
    for (const club of loaded.clubs) assert.equal(st.own[club.homeSection], club.id);
    const board = app.board();
    assert.equal(board.borderRoutes, true);
    assert.ok(Array.isArray(board.obstacles));
    assert.equal(app.viewContext().sectionNames, loaded.sectionNames);
    assert.match(st.campaignName, /England · top 100 clubs/);
    renderPure(app, 'country campaign');

    // A conquest is reported in section names.
    const [a] = st.aliveIds;
    const b = [...empireNeighbors(board, a)][0];
    app.startMatch(a, b);
    forceResult(app, a, { aId: a, dId: b });
    app.finishMatch();
    const result = app.state.history.at(-1).result;
    assert.ok(result.territoryNames.length > 0);
    assert.deepEqual(result.territoryNames, result.territoryIds.map(cid => loaded.sectionNames[cid]));
    app.clearTimers();

    // The champion "has conquered England", not the theatre label.
    app.setState({ phase: 'victory', aliveIds: [a] });
    assert.match(app.victoryPanel().subtitle, /^has conquered England in (1 battle|\d+ battles)$/);
    app.setState({ phase: 'playing', aliveIds: st.aliveIds.filter(id => id !== b) });

    // A save from another build of the map is moved club by club; its interrupted round-robin draw starts again.
    const saved = { ...loadSave(), settings: { ...loadSave().settings, turnOrder: 'round-robin', domesticVersion: '826-00000000' },
      turnQueue: st.aliveIds.slice(0, 4), turnIndex: 3, round: 1,
      spin: { attackerId: st.aliveIds[2], targetId: st.aliveIds[3], key: 'stale' }, match: null };
    app.continueSaved(saved);
    assert.equal(app.geo, loaded.geo);
    assert.equal(app.state.settings.domesticVersion, loaded.meta.version, 'the restored campaign is re-stamped');
    assert.equal(app.state.spin, null, 'the stale draw is not replayed');
    assert.equal(app.state.turnIndex, 2, 'the same attacker draws again');
    assert.equal(app.state.saveStatus.message, 'Campaign restored on an updated map of England. The interrupted draw starts again.');
    renderPure(app, 'country restore');
  });
});

test('phone bar minute: floored at the last revealed event', async () => {
  await withApp(manager, ({ app }) => {
    app.setState({ match: { aId: '250', dId: '276', applied: false, done: false, shown: [{ m: 12 }, { m: 37 }, { m: 30 }] } });
    assert.deepEqual(app.phoneBarModel(), { right: null, rightKind: 'minute', minuteFallback: 37 });
    app.setState({ match: { aId: '250', dId: '276', applied: false, done: false, shown: [] } });
    assert.equal(app.phoneBarModel().minuteFallback, 0);
  });
});

test('the quick-resume card counts the teams left in the plural and calls a won save complete', async () => {
  await withApp({}, ({ app }) => {
    assert.equal(app.savedProgress({ alive: 12, settings: { layer: 'nations' } }), '12 nations remaining');
    assert.equal(app.savedProgress({ alive: 2, settings: { layer: 'clubs' } }), '2 clubs remaining');
    assert.equal(app.savedProgress({ alive: 1, settings: { layer: 'clubs' } }), 'Campaign complete', 'never "1 clubs remaining"');
  });
});

test('closing the results ("View map") returns to the map the final\'s automatic Match view replaced', async () => {
  await withApp({}, ({ app }) => {
    const champion = app.state.aliveIds[0];
    app.setState({ view: 'match', viewSource: 'auto', aliveIds: [champion], phase: 'victory', completedAt: 1, matches: 1,
      own: Object.fromEntries(Object.keys(app.state.own).map(id => [id, champion])) });
    const overlay = findElement(app.render(), 'VictoryOverlay');
    assert.match(overlay.props.subtitle, / in 1 battle$/, 'one battle, not "1 battles"');
    overlay.props.onClose();
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.currentView(), 'map');
  });
});

test('the column\'s Chronicle link is not offered while a target choice holds the screen', async () => {
  await withApp(manager, ({ app }) => {
    assert.equal(typeof findElement(app.render(), 'CampaignColumn').props.onOpenChronicle, 'function');
    app.setState({ pendingTarget: PENDING });
    assert.equal(findElement(app.render(), 'CampaignColumn').props.onOpenChronicle, undefined,
      'setView refuses the Chronicle during the choice: no link that does nothing');
  });
});

test('following another team after the managed team falls keeps it on record as the managed team', async () => {
  await withApp(manager, ({ app }) => {
    app.startMatch('250', '276');
    app.chooseTactic('balanced');
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.finishMatch();
    app.continueAsSpectator();
    assert.equal(app.state.managedTeamId, '250');
    app.followTeam('826');
    assert.equal(app.state.followedId, '826');
    assert.equal(app.state.managedTeamId, '250', 'the Spectator panel and the save still name the eliminated team');
    assert.equal(app.spectatorPanelModel().managed?.id, '250');
    app.clearTimers();
  });
});
