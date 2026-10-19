// Owner: WP-CONQ wiring (see PLAN.md §4.6). App → conquest wiring in src/app/conquestMethods.jsx: the finishMatch
// signing gate (choice.selected on the best fit, conquest framing, no transfer, no timers), the ConquestScreen /
// callout / elimination models, claimed-player provenance on confirm (DEC D8), the v4 notice copy, and render purity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp, findElement, forceResult, syncAppFixture } from './lib/app-harness.mjs';
import { exportCampaign, loadSave, parseCampaign } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';

await bundleApp();

const rngOf = app => app.rng.getState();
/** Tiny-atlas box of the country at `index` (scripts/lib/app-harness.mjs tinyAtlas). */
const boxAt = index => ({ x: 80 + index * 100, y: 80, w: 40, h: 40 });

/** A managed France (250) win over Germany (276) waiting for the signing. */
function pendingSigning() {
  const f = syncAppFixture({ role: 'manager' });
  forceResult(f.app, '250', { aId: '250', dId: '276' });
  return f;
}

test('finishMatch opens the signing on the best fit with conquest framing, no transfer and no timers', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const { app } = f;
    forceResult(app, '250', { aId: '250', dId: '276' });
    app.setState({ toast: { code: 'FRA', txt: "90' GOAL", k: 1 }, pu: { kind: 'vs', label: 'stale', k: 1 } });
    const before = structuredClone({ own: app.state.own, teams: app.state.teams, alive: app.state.aliveIds });
    const rng = rngOf(app), focusKey = app.state.focusKey;
    app.finishMatch();
    const { choice } = app.state;
    assert.ok(choice);
    assert.equal(choice.candidates.length, 3);
    assert.equal(choice.selected, choice.candidates[0].index, 'DEC D15: the best lineup fit is preselected');
    assert.equal(app.state.focusLayout, 'conquest');
    assert.deepEqual(app.state.focusBounds, boxAt(1), 'frames the taken land');
    assert.equal(app.state.focusKey, focusKey + 1);
    assert.equal(app.state.toast, null);
    assert.equal(app.state.pu, null);
    assert.deepEqual(app.state.own, before.own, 'no transfer before signing');
    assert.deepEqual(app.state.teams, before.teams);
    assert.deepEqual(app.state.aliveIds, before.alive);
    assert.equal(app.state.matches, 0);
    assert.equal(app.timers.size, 0, 'the campaign waits for the choice');
    assert.equal(app.currentView(), 'conquest');
    assert.equal(rngOf(app), rng);
    assert.equal(parseCampaign(f.storage.getItem(SAVE_KEY)).choice.selected, choice.selected, 'the selection is saved');

    const preview = app.conquestPreview();
    assert.deepEqual(preview.taken, ['276']);
    assert.equal(preview.own['276'], '250');
    assert.deepEqual(preview.bounds, boxAt(1));
    assert.equal(app.conquestPreview(), preview, 'memoised on state identities (conq:preview)');
  } finally { f.close(); }
});

test('the conquest view renders ConquestScreen from buildConquest, the callout anchor and the selection', () => {
  const f = pendingSigning();
  try {
    const { app } = f;
    app.finishMatch();
    const rng = rngOf(app), timers = app.timers.size;
    const W = app.state.teams['250'].name, L = app.state.teams['276'].name;
    const [first, , third] = app.state.choice.candidates;

    const model = app.conquestModel();
    assert.equal(model.kicker, 'Round I · Conquest');
    assert.equal(model.headline, `${L} is out`);
    assert.equal(model.standfirst, `${W} beat ${L} 1–0. ${W} take ${L}’s only territory and one player.`);
    assert.deepEqual(model.effects.map(effect => [effect.label, effect.value]), [['Territory', '+1'], ['Empire', '2']]);
    assert.equal(model.options.length, 3);
    assert.equal(model.selectedIndex, first.index);
    assert.equal(model.ctaLabel, `Sign ${first.name}`);

    const element = app.render();
    const screen = findElement(element, 'ConquestScreen');
    assert.ok(screen, 'ConquestScreen is mounted in the conquest view');
    assert.equal(screen.props.headline, model.headline);
    assert.deepEqual(screen.props.options.map(option => option.index), app.state.choice.candidates.map(c => c.index));
    const map = findElement(element, 'WorldMap');
    assert.equal(map.props.focusLayout, 'conquest');
    const anchors = app.conquestAnchors();
    assert.equal(anchors.length, 1);
    assert.deepEqual({ key: anchors[0].key, x: anchors[0].x, y: anchors[0].y, align: anchors[0].align },
      { key: 'conquest-callout', x: 200, y: 100, align: 'center' });
    assert.equal(anchors[0].node.type.name, 'ConquestCallout');
    assert.deepEqual(anchors[0].node.props, { figure: '+1', label: 'Territory taken', sub: `Now part of ${W}` });
    assert.ok(map.props.anchors.some(anchor => anchor.key === 'conquest-callout'), 'App passes it through mapAnchors()');
    assert.equal(findElement(element, 'CampaignColumn'), null);

    app.selectAcquisition(third.index);
    assert.equal(app.state.choice.selected, third.index);
    const moved = app.conquestModel();
    assert.equal(moved.selectedIndex, third.index);
    assert.equal(moved.ctaLabel, `Sign ${third.name}`);
    assert.deepEqual(moved.options.filter(option => option.selected).map(option => option.index), [third.index]);
    assert.equal(app.primaryAction().label, `Sign ${third.name}`);
    assert.equal(loadSave().choice.selected, third.index, 'selectAcquisition persists choice.selected');
    assert.equal(parseCampaign(exportCampaign(app.state)).choice.selected, third.index, 'export round trip');
    assert.equal(rngOf(app), rng, 'render, models and selection never move the RNG');
    assert.equal(app.timers.size, timers);
    assert.equal(app.timers.size, 0);
  } finally { f.close(); }
});

test('confirming applies once with provenance on the claimed player, ends the framing and shows v4 notices', () => {
  const f = pendingSigning();
  try {
    const { app } = f;
    app.finishMatch();
    const W = app.state.teams['250'], L = app.state.teams['276'];
    const candidate = app.state.choice.candidates[1];
    const squadBefore = W.squad.length;
    app.selectAcquisition(candidate.index);
    app.runPrimary();
    assert.equal(app.state.choice, null);
    assert.equal(app.state.own['276'], '250');
    assert.equal(app.state.focusLayout, null, 'the conquest framing ends with the decision');
    const winner = app.state.teams['250'];
    assert.equal(winner.squad.length, squadBefore + 1);
    const claimed = winner.squad.at(-1);
    assert.equal(claimed.name, candidate.name);
    assert.deepEqual({ from: claimed.from, fromId: claimed.fromId, joined: claimed.joined, claimGain: claimed.claimGain },
      { from: L.code, fromId: '276', joined: 1, claimGain: app.state.match.strengthGained });
    assert.equal(typeof claimed.claimGain, 'number');
    assert.equal(app.state.match.playerTaken.fromId, undefined, 'the archived player stays the loser’s record');
    const saved = parseCampaign(exportCampaign(app.state)).teams['250'].squad.at(-1);
    assert.deepEqual([saved.fromId, saved.joined, saved.claimGain], ['276', 1, claimed.claimGain]);

    assert.equal(app.state.pu.kind, 'result');
    assert.deepEqual({ label: app.state.pu.label, score: app.state.pu.score, title: app.state.pu.title, sub: app.state.pu.sub },
      { label: 'Full time — Round I', score: `${W.code} 1–0 ${L.code}`, title: `${W.name} annexes ${L.name}`, sub: '+1 territory' });
    assert.equal(app.renderPopup().type.name, 'ResultPopup');
    f.time.advance(1820);
    assert.equal(app.state.pu.kind, 'steal');
    assert.equal(app.state.pu.sMeta, `Rating ${claimed.rating} · ${claimed.pos}`);
    assert.equal(app.state.pu.sSub, `Joins ${W.name}`);
    assert.equal(app.renderPopup().type.name, 'StealPopup');

    app.chooseAcquisition(candidate.index);
    app.finishMatch();
    app.applyConquest(candidate.index);
    assert.equal(app.state.matches, 1, 'applied exactly once');
    assert.equal(app.state.teams['250'].squad.filter(player => player.name === candidate.name).length, 1);
    assert.equal(app.conquestPreview(), null);
    assert.deepEqual(app.conquestAnchors(), []);
    assert.equal(app.conquestModel().choice, null);
  } finally { f.close(); }
});

test('a reloaded pending signing keeps its selection and its article', () => {
  const original = pendingSigning();
  let savedText, selected;
  try {
    original.app.finishMatch();
    selected = original.app.state.choice.candidates[2].index;
    original.app.selectAcquisition(selected);
    savedText = original.storage.getItem(SAVE_KEY);
  } finally { original.close(); }
  const resumed = syncAppFixture({ role: 'manager', savedText });
  try {
    resumed.app.saved = loadSave();
    resumed.app.resume();
    assert.equal(resumed.app.state.choice.selected, selected);
    assert.equal(resumed.app.conquestModel().selectedIndex, selected);
    assert.equal(resumed.app.timers.size, 0);
    assert.ok(findElement(resumed.app.render(), 'ConquestScreen'));
  } finally { resumed.close(); }
});

test('manager elimination: the article model is winner-first and reaches ManagerElimination', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const { app } = f;
    assert.equal(app.eliminationModel(), null);
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.ok(app.state.managerElimination);
    const W = app.state.teams['276'].name, L = app.state.teams['250'].name;
    const model = app.eliminationModel();
    assert.equal(model.kicker, 'Round I · Eliminated');
    assert.equal(model.headline, `${L} is out`);
    assert.equal(model.standfirst, `${W} held off ${L} 1–0. ${W} take ${L}’s only territory. Your campaign ends here.`);
    const dialog = findElement(app.render(), 'ManagerElimination');
    assert.deepEqual(dialog.props.model, model);
    assert.equal(app.state.focusLayout, null);
  } finally { f.close(); }
});

test('spectator AI conquest: no waiting screen, provenance on the automatic claim, source-case notice', () => {
  const f = syncAppFixture({ role: 'spectator' });
  try {
    const { app } = f;
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.finishMatch();
    assert.equal(app.state.choice, null);
    assert.equal(app.state.focusLayout, null);
    assert.equal(app.state.own['250'], '276');
    const claimed = app.state.teams['276'].squad.at(-1);
    assert.equal(claimed.name, app.state.match.playerTaken.name);
    assert.deepEqual([claimed.fromId, claimed.joined, claimed.claimGain], ['250', 1, app.state.match.strengthGained]);
    assert.equal(app.state.pu.title, `${app.state.teams['276'].name} annexes ${app.state.teams['250'].name}`);
    assert.deepEqual(app.conquestAnchors(), []);
    assert.equal(app.eliminationModel(), null);
  } finally { f.close(); }
});

test('the defeat drops the notice and toast whose clears it cancels, and leaves no hatch behind', () => {
  const f = syncAppFixture({ role: 'manager' });
  try {
    const { app } = f;
    forceResult(app, '276', { aId: '250', dId: '276' });
    app.setState({ pu: { kind: 'vs', label: 'Round I — France attacks Germany', k: 1 }, toast: { code: 'GER', txt: "90' GOAL", k: 1 } });
    app.finishMatch();
    assert.ok(app.state.managerElimination);
    assert.equal(app.state.pu, null, 'no stale kick-off notice beside the elimination article');
    assert.equal(app.state.toast, null);
    assert.equal(app.renderPopup(), null);
    assert.deepEqual(app.mapConquestIds(), [], 'the paused clock has no token to clear a hatch, so none is set');
    assert.equal(app.timers.size, 0);
    app.continueAsSpectator();
    f.time.advance(5000);
    assert.deepEqual(app.mapConquestIds(), [], 'the spectator campaign starts without the old hatch');
  } finally { f.close(); }
});

// ---------- one settlement per match ----------

/**
 * React 18 commits a timer's setState in a later task, so until then `this.state` is the previous state. Switch a sync
 * fixture to that model: updates queue (objects merge in order, updaters see the queued result) and `commit()` applies
 * them, then runs componentDidUpdate and the callbacks (whose own updates queue for the next round).
 */
function deferCommits(app) {
  const queue = [];
  app.setState = (update, callback) => { queue.push({ update, callback }); };
  return function commit() {
    while (queue.length) {
      const batch = queue.splice(0);
      const previous = app.state;
      let next = previous;
      for (const { update } of batch) {
        const partial = typeof update === 'function' ? update(next, app.props) : update;
        if (partial) next = { ...next, ...partial };
      }
      app.state = next;
      app.componentDidUpdate(app.props, previous);
      for (const { callback } of batch) callback?.call(app);
    }
  };
}

const campaignOf = app => ({ history: app.state.history.map(entry => entry.id), fallen: app.state.fallen.map(item => item.id),
  matches: app.state.matches, alive: app.state.aliveIds.slice(), stats: structuredClone(app.state.stats),
  squads: Object.fromEntries(Object.entries(app.state.teams).map(([id, team]) => [id, team.squad.length])),
  elims: app.state.log.filter(entry => entry.t === 'elim').length, series: app.state.series });

test('a primary action before React commits a conquest cannot settle the match a second time', () => {
  const f = syncAppFixture({ role: 'manager' }); // France (250) manages; Germany beats the UK (AI)
  try {
    const { app } = f;
    forceResult(app, '276', { aId: '276', dId: '826' });
    const squads = Object.fromEntries(Object.entries(app.state.teams).map(([id, team]) => [id, team.squad.length]));
    const commit = deferCommits(app);
    app.finishMatch(); // the reveal's finish timer: the conquest is queued, not committed
    assert.equal(app.primaryAction().id, 'finish', 'the uncommitted state still offers Finish match');
    app.runPrimary(); // Space: step → fastForward → revealAll queues a stale unapplied copy and another finish
    commit();
    f.time.advance(3000);
    commit();
    const after = campaignOf(app);
    assert.deepEqual(after.history, ['match-1'], 'archived once');
    assert.deepEqual(after.fallen, ['826'], 'the loser falls once');
    assert.equal(after.matches, 1);
    assert.deepEqual(after.alive, ['250', '276']);
    assert.equal(after.stats['276'].conq, 1);
    assert.equal(after.stats['276'].steals.length, 1, 'one claimed player');
    assert.deepEqual(after.squads, { 250: squads[250], 276: squads[276] + 1, 826: squads[826] - 1 });
    assert.equal(after.elims, 1);
    assert.equal(app.state.match.applied, true, 'the settled match is back over the stale copy');
    assert.equal(app.state.match.territoriesGained, 1);
    assert.equal(app.primaryAction().id, 'continue');

    // A second finish of the same match before anything commits changes nothing either.
    forceResult(app, '276', { aId: '276', dId: '250' }); commit();
    const before = campaignOf(app);
    app.finishMatch(); app.finishMatch(); app.applyConquest();
    commit();
    const settled = campaignOf(app);
    assert.equal(settled.matches, before.matches + 1);
    assert.equal(settled.history.length, before.history.length + 1);
    assert.equal(settled.elims, before.elims + 1);
    assert.equal(settled.stats['276'].conq, 2);
  } finally { f.close(); }
});

test('a primary action before React commits a series game cannot count it twice', () => {
  const f = syncAppFixture({ role: 'manager', ids: ['250', '276'], settings: { finale: 'best-of-three' } });
  try {
    const { app } = f;
    app.setState({ series: { teamIds: ['250', '276'], wins: { 250: 0, 276: 0 }, games: 0 } });
    forceResult(app, '276', { aId: '250', dId: '276' });
    const commit = deferCommits(app);
    app.finishMatch();
    assert.equal(app.primaryAction().id, 'finish');
    app.runPrimary();
    commit();
    f.time.advance(3000);
    commit();
    const after = campaignOf(app);
    assert.deepEqual(after.series.wins, { 250: 0, 276: 1 }, 'game one counted once');
    assert.equal(after.series.games, 1);
    assert.deepEqual(after.history, ['match-1']);
    assert.equal(after.matches, 1);
    assert.deepEqual(after.alive, ['250', '276'], 'the series continues: nobody is eliminated');
    assert.equal(app.state.managerElimination, null);
    assert.equal(app.state.match.applied, true);
  } finally { f.close(); }
});

test('a deciding series game advances the series and annexes once even when a stale copy drops its flag', () => {
  const f = syncAppFixture({ role: 'spectator', ids: ['250', '276'], settings: { finale: 'best-of-three' } });
  try {
    const { app } = f;
    app.setState({ series: { teamIds: ['250', '276'], wins: { 250: 0, 276: 1 }, games: 1 } });
    forceResult(app, '276', { aId: '250', dId: '276' });
    const stale = app.state.match;
    const commit = deferCommits(app);
    app.finishMatch(); // series complete: queued, its callback finishes the conquest
    app.setState({ match: { ...stale, status: 'FULL TIME' } }); // a stale patchMatch copy lands after it
    commit();
    f.time.advance(3000);
    commit();
    assert.deepEqual(app.state.series.wins, { 250: 0, 276: 2 }, 'the deciding game is counted once');
    assert.equal(app.state.series.games, 2);
    assert.deepEqual(app.state.aliveIds, ['276']);
    assert.deepEqual(app.state.fallen.map(item => item.id), ['250']);
    assert.equal(app.state.history.length, 1);
    assert.equal(app.state.match.applied, true);
  } finally { f.close(); }
});

test('render-time conquest delegates are empty outside a campaign and never throw', () => {
  for (const phase of ['loading', 'setup']) {
    const f = syncAppFixture({ phase });
    try {
      const { app } = f;
      app.setState({ pu: { kind: 'result', label: 'x', title: 'y', k: 1 } });
      assert.equal(app.renderPopup(), null, phase);
      assert.equal(app.conquestPreview(), null, phase);
      assert.deepEqual(app.conquestAnchors(), [], phase);
      assert.equal(app.eliminationModel(), null, phase);
      assert.equal(app.conquestModel().choice, null, phase);
      assert.ok(app.render(), `${phase} renders`);
    } finally { f.close(); }
  }
});
