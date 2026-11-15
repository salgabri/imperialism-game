// Results entered by you (README §Scores entered by you, src/engine/enteredResult.js): every match waits for the score the player
// types in after playing it somewhere else, in another game or for real, and the campaign goes on from that score.
// The default (Simulated) plays exactly as before: scripts/seed-replay.test.mjs holds its campaigns to their golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { bundleApp, bundleComponents, syncAppFixture, withDom } from './lib/app-harness.mjs';
import { buildTeam, makeRng } from '../src/data/teams.js';
import { SPORT_LIST, matchSport, settledText } from '../src/sports/index.js';
import { football } from '../src/sports/football.js';
import { EMPTY_DRAFT, entersResults, readResult, scoreText } from '../src/engine/enteredResult.js';
import { campaignSnapshot, createCampaignId, parseCampaign } from '../src/engine/storage.js';
import { buildResultEntry } from '../src/viewModels/resultEntry.js';
import { buildFeedRows, buildLiveMatch } from '../src/viewModels/match.js';
import { skipAheadModel } from '../src/viewModels/campaign.js';
import { SHOW_MATCH_OPTIONS, campaignPreview, estimateNote, showMatchOptions, showMatchesOf, showMatchesWrites } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { DEFAULT_SETUP } from '../src/app/shared.js';

// React reads the page's input events when it loads: load it beside a document (then gone again, so the App fixtures
// below run without one), or a focused field falls back to its old-IE polyfill under jsdom.
const boot = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window: boot.window, document: boot.window.document });
const { createRoot } = await import('react-dom/client');
delete globalThis.window;
delete globalThis.document;

await bundleApp();
const { SetupOverlay, SettingsPanel, ResultEntry } = await bundleComponents({
  SetupOverlay: 'src/components/SetupOverlay.jsx',
  SettingsPanel: ['src/components/CommandBar.jsx', 'SettingsPanel'],
  ResultEntry: 'src/screens/campaign/ResultEntry.jsx',
});

const ENTERED = { results: 'entered' };
const draft = (a, b, pa = '', pb = '') => ({ a: String(a), b: String(b), pa: String(pa), pb: String(pb) });

/** A fixture whose notices and toasts do nothing (they only schedule clears). */
function enteredFixture(options = {}) {
  const f = syncAppFixture({ ...options, settings: { ...ENTERED, ...options.settings } });
  f.app.showPopup = () => {};
  f.app.showToast = () => {};
  return f;
}

test('a score field keeps digits only, at most three, without leading zeros', () => {
  assert.equal(scoreText('07'), '7');
  assert.equal(scoreText('0'), '0');
  assert.equal(scoreText('a1b2'), '12');
  assert.equal(scoreText('1234'), '123');
  assert.equal(scoreText(' 3 '), '3');
  assert.equal(scoreText(null), '');
  assert.equal(entersResults({ results: 'entered' }), true);
  assert.equal(entersResults(DEFAULT_SETUP), false, 'Simulated is the default');
  assert.equal(DEFAULT_SETUP.results, 'simulated');
});

test('a typed score reads as a result under every sport\'s rules, and a level one only where a shoot-out settles it', () => {
  for (const { id } of SPORT_LIST) {
    const sport = matchSport({ sport: id });
    assert.equal(readResult(sport, EMPTY_DRAFT, 'a', 'd').state, 'incomplete', id);
    assert.equal(readResult(sport, draft(2, ''), 'a', 'd').state, 'incomplete', id);
    assert.deepEqual(readResult(sport, draft(3, 1), 'a', 'd'), { state: 'ready', ga: 3, gd: 1, tie: null, winner: 'a', shootout: false }, id);
    assert.deepEqual(readResult(sport, draft(0, 2), 'a', 'd'), { state: 'ready', ga: 0, gd: 2, tie: null, winner: 'd', shootout: false }, id);
    const level = readResult(sport, draft(1, 1, 4, 3), 'a', 'd');
    if (sport.tieBreak === 'shootout') {
      // Football and women's football: the shoot-out's score settles it (attacker first), with no kicks to show.
      assert.deepEqual(level, { state: 'ready', ga: 1, gd: 1, winner: 'a', shootout: true,
        tie: { by: 'penalties', periods: [], A: [], D: [], ga: 4, gd: 3 } }, id);
      assert.equal(settledText(sport, level.tie), '4–3 on penalties', id);
      assert.equal(readResult(sport, draft(1, 1, 2, 5), 'a', 'd').winner, 'd', id);
      assert.equal(readResult(sport, draft(1, 1), 'a', 'd').state, 'level', id);
      assert.equal(readResult(sport, draft(1, 1, 3, 3), 'a', 'd').state, 'level', id);
    } else {
      // Overtime, extra innings, golden point: a final score has a winner; a tennis tie or a Rocket League series too.
      assert.deepEqual(level, { state: 'level', ga: 1, gd: 1, tie: null, winner: null, shootout: false }, id);
    }
  }
  // An earlier football season settled level games by lots or a golden goal: a typed shoot-out still reads the same.
  const lots = matchSport({ sport: 'football', dataSet: 'nt-1962', dataYear: 1962 });
  assert.equal(readResult(lots, draft(0, 0, 5, 4), 'a', 'd').winner, 'a');
});

test('the form says what the score does, or what it lacks, in each sport\'s words', () => {
  const f = enteredFixture();
  try {
    f.app.startMatch('250', '276');
    const st = f.app.state, ctx = f.app.viewContext();
    const France = st.teams['250'].name, Germany = st.teams['276'].name;
    const line = (d, sport = 'football') => buildResultEntry({ ...st, resultDraft: d, settings: { ...st.settings, sport } },
      { ...ctx, sport: matchSport({ sport }) }).line;
    assert.equal(line(EMPTY_DRAFT), `Play ${France} v ${Germany}, then type its final score.`);
    assert.equal(line(draft(2, 1)), `${France} wins 2–1 and takes ${Germany}.`);
    assert.equal(line(draft(0, 3)), `${Germany} wins 3–0 and takes ${France}.`, 'the winner\'s score first');
    assert.equal(line(draft(1, 1)), 'Level: type the penalty shoot-out’s score.');
    assert.equal(line(draft(1, 1, 3, 3)), 'A shoot-out needs a winner.');
    assert.equal(line(draft(1, 1, 2, 4)), `${Germany} wins 4–2 on penalties and takes ${France}.`);
    assert.match(line(draft(98, 98), 'basketball'), /score after overtime/);
    assert.match(line(draft(3, 3), 'baseball'), /score after extra innings/);
    assert.match(line(draft(18, 18), 'rugby-league'), /score after golden point/);
    assert.match(line(draft(2, 2), 'hockey'), /overtime and shoot-out included/);
    assert.match(line(draft(2, 2), 'tennis'), /one side wins the tie/);
    const model = buildResultEntry({ ...st, resultDraft: draft(1, 1) }, ctx);
    assert.equal(model.shootout, true);
    assert.equal(model.unit, 'goals');
    assert.equal(model.ready, false);
    assert.equal(buildResultEntry({ ...st, resultDraft: draft(1, 0) }, ctx).ready, true);
  } finally { f.close(); }
});

test('App: the draw\'s match waits for its score, takes no random sample, and holds the campaign until it comes', () => {
  const f = enteredFixture();
  try {
    f.app.setState({ autoplay: true });
    const rng = f.app.rng.getState();
    f.app.startMatch('250', '276');
    const st = f.app.state;
    assert.equal(st.match, null, 'no match is played');
    assert.deepEqual({ ...st.resultEntry, openedAt: 0 }, { aId: '250', dId: '276', route: {}, resumeAutoplay: true, openedAt: 0 });
    assert.deepEqual(st.resultDraft, EMPTY_DRAFT);
    assert.equal(st.autoplay, false, 'autoplay waits with the match');
    assert.equal(f.app.rng.getState(), rng, 'nothing drawn from the campaign\'s random stream');
    // Nothing moves on meanwhile: no turn, no step, no play.
    f.app.nextAction();
    f.app.step();
    f.app.togglePlay();
    assert.equal(f.app.state.resultEntry.aId, '250');
    assert.equal(f.app.state.match, null);
    assert.equal(f.app.rng.getState(), rng);
    assert.equal(f.app.primaryAction().id, 'enter-result');
    assert.equal(f.app.primaryAction().label, 'Enter result');
    assert.equal(skipAheadModel(f.app.state, '250'), null);
  } finally { f.close(); }
});

test('App: Confirm result plays the typed score at once, conquers with it and archives it as entered', () => {
  const f = enteredFixture();
  try {
    f.app.setState({ autoplay: true });
    f.app.startMatch('250', '276');
    const rng = f.app.rng.getState();
    f.app.setResultDraft({ a: 'x1', b: '3' });
    assert.deepEqual(f.app.state.resultDraft, { ...EMPTY_DRAFT, a: '1', b: '3' });
    assert.equal(f.app.primaryAction().id, 'submit-result');
    assert.equal(f.app.primaryAction().label, 'Confirm result');
    f.app.runPrimary();
    const m = f.app.state.match;
    assert.equal(f.app.state.resultEntry, null);
    assert.equal(f.app.state.resultDraft, null);
    assert.deepEqual([m.aId, m.dId, m.finalGa, m.finalGd, m.winner, m.tie, m.allEv, m.entered, m.instant, m.live],
      ['250', '276', 1, 3, '276', null, [], true, true, null]);
    assert.equal(f.app.state.autoplay, true, 'autoplay comes back with the result');
    assert.equal(f.app.rng.getState(), rng, 'a typed score draws nothing');
    f.time.advance(5000);
    const after = f.app.state;
    assert.deepEqual(after.aliveIds, ['276', '826'], 'France fell');
    assert.equal(after.own['250'], '276');
    const entry = after.history.at(-1);
    assert.deepEqual([String(entry.a.score), String(entry.b.score), entry.winnerId, entry.entered, entry.events.length], ['1', '3', '276', true, 0]);
    // The Match view shows the score with no chart, no clock and no invented half-time score.
    const view = buildLiveMatch(after, f.app.viewContext());
    assert.equal(view.model, null);
    assert.match(view.chartNote, /entered this result/);
    const rows = buildFeedRows(view, 0);
    assert.deepEqual(rows.map(row => row.key), ['status', 'entered']);
    assert.match(rows[0].text, /1–3/);
  } finally { f.close(); }
});

test('App: a followed team’s typed-in score is shown, not paused at its kick-off', () => {
  const f = enteredFixture();
  try {
    f.app.setState({ autoplay: true, followedId: '250', pauseFollow: true });
    f.app.startMatch('250', '276');
    f.app.setResultDraft({ a: '1', b: '0' });
    f.app.submitResult();
    assert.equal(f.app.state.paused, false, 'no pause at the kick-off of a score you typed in');
    f.time.advance(3000);
    assert.deepEqual(f.app.state.aliveIds, ['250', '826'], 'the result is applied');
    assert.equal(f.app.state.autoplay, false, 'autoplay stops after the followed team’s match, as for any of its matches');
  } finally { f.close(); }
});

test('App: a level football score goes to its typed shoot-out, with no kicks to reveal', () => {
  const f = enteredFixture();
  try {
    f.app.startMatch('250', '276');
    f.app.setResultDraft({ a: '2', b: '2' });
    assert.equal(f.app.primaryAction().id, 'enter-result', 'level, no shoot-out yet');
    f.app.submitResult();
    assert.ok(f.app.state.resultEntry, 'an unsettled score is not submitted');
    f.app.setResultDraft({ pa: '5', pb: '4' });
    f.app.submitResult();
    const m = f.app.state.match;
    assert.deepEqual([m.finalGa, m.finalGd, m.winner, m.tie.by, m.tie.ga, m.tie.gd], [2, 2, '250', 'penalties', 5, 4]);
    f.time.advance(5000);
    const entry = f.app.state.history.at(-1);
    assert.equal(entry.result.tieText, '5–4 on penalties');
    assert.equal(entry.kicks ?? null, null, 'no kick dots for kicks nobody recorded');
  } finally { f.close(); }
});

test('App: every sport takes a typed score through the whole conquest', () => {
  for (const { id } of SPORT_LIST) {
    const f = enteredFixture({ settings: { sport: id } });
    try {
      f.app.startMatch('276', '250');
      assert.ok(f.app.state.resultEntry, id);
      f.app.setResultDraft({ a: '2', b: '2' });
      if (matchSport(f.app.state.settings).tieBreak === 'shootout') f.app.setResultDraft({ pa: '3', pb: '1' });
      else f.app.setResultDraft({ a: '3' });
      f.app.submitResult();
      f.time.advance(5000);
      assert.deepEqual(f.app.state.aliveIds, ['276', '826'], id);
      assert.equal(f.app.state.history.at(-1).entered, true, id);
    } finally { f.close(); }
  }
});

test('App: Simulate plays the waiting match on the model after all, as any match would be', () => {
  const f = enteredFixture();
  try {
    f.app.startMatch('250', '276');
    const state = f.app.rng.getState();
    const a = f.app.state.teams['250'], d = f.app.state.teams['276'];
    f.app.simulateEntry();
    const m = f.app.state.match;
    assert.equal(f.app.state.resultEntry, null);
    assert.equal(m.entered, undefined);
    assert.equal(m.instant, true, 'decided at once, as the fixture\'s Simulate is');
    const rng = makeRng(0);
    rng.setState(state);
    const expected = football.simulate(rng, a, d, m.matchDrama, m.effA, m.effD, {});
    assert.deepEqual([m.winner, m.finalGa, m.finalGd, m.allEv], [expected.winner, expected.ga, expected.gd, expected.ev]);
    assert.equal(f.app.rng.getState(), rng.getState(), 'one match draw');
  } finally { f.close(); }
});

test('App: a manager skips the approach (no model plays the match) but still signs a player after a win', () => {
  const f = enteredFixture({ role: 'manager' });
  try {
    f.app.startMatch('250', '276');
    assert.equal(f.app.state.tacticalChoice, null, 'no tactical gate under entered results');
    assert.ok(f.app.state.resultEntry);
    f.app.setResultDraft({ a: '2', b: '0' });
    f.app.submitResult();
    assert.equal(f.app.state.match.tactic, null, 'no approach is recorded for a match played elsewhere');
    f.time.advance(2000);
    assert.ok(f.app.state.choice, 'the manager\'s signing still waits');
    assert.equal(f.app.state.choice.loserName, f.app.state.teams['276'].name);
  } finally { f.close(); }
});

test('App: Results can go back to Simulated mid-campaign: the waiting match kicks off on the model', () => {
  const spectator = enteredFixture();
  try {
    spectator.app.startMatch('276', '826');
    spectator.app.setSetting('results', 'simulated');
    assert.equal(spectator.app.state.settings.results, 'simulated');
    assert.equal(spectator.app.state.resultEntry, null);
    assert.ok(spectator.app.state.match && !spectator.app.state.match.entered, 'played on the model');
    spectator.app.setSetting('results', 'sometimes');
    assert.equal(spectator.app.state.settings.results, 'simulated', 'an unknown value is refused');
  } finally { spectator.close(); }
  const manager = enteredFixture({ role: 'manager' });
  try {
    manager.app.startMatch('250', '276');
    manager.app.setSetting('results', 'simulated');
    assert.equal(manager.app.state.resultEntry, null);
    assert.ok(manager.app.state.tacticalChoice, 'the manager\'s own match opens its tactical gate');
  } finally { manager.close(); }
  // And to entered scores: the next kick-off waits.
  const later = syncAppFixture();
  try {
    later.app.showPopup = () => {};
    later.app.setSetting('results', 'entered');
    later.app.startMatch('250', '276');
    assert.ok(later.app.state.resultEntry);
  } finally { later.close(); }
});

test('saves keep the rule and the match waiting for its score; a reload asks for the score again', () => {
  const f = enteredFixture();
  try {
    f.app.startMatch('250', '276');
    f.app.setResultDraft({ a: '4' });
    const saved = parseCampaign(JSON.stringify(campaignSnapshot(f.app.state)));
    assert.equal(saved.settings.results, 'entered');
    assert.deepEqual([saved.resultEntry.aId, saved.resultEntry.dId], ['250', '276']);
    assert.equal(saved.resultDraft, undefined, 'the typed scores are not saved');
    f.app.restoreCampaign(saved, null);
    assert.deepEqual([f.app.state.resultEntry.aId, f.app.state.resultEntry.dId], ['250', '276']);
    assert.deepEqual(f.app.state.resultDraft, EMPTY_DRAFT);
    assert.equal(f.app.state.match, null, 'nothing is played on the reload');
  } finally { f.close(); }

  const rng = makeRng(42);
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, rng, football)]));
  const base = { phase: 'playing', settings: { sport: 'football', layer: 'nations', pacing: 'duel', resolution: 'ticker', results: 'entered' },
    teams, own: { 250: '250', 276: '276' }, aliveIds: ['250', '276'], fallen: [], stats: {}, round: 1, matches: 0, queue: [],
    history: [], log: [], seed: 42, rngState: rng.getState(), followedId: null, campaignId: createCampaignId(), revision: 0,
    campaignName: 'Entered', metrics: { acquisitions: [], leaderChanges: 0 }, match: null, spin: null, choice: null, series: null,
    tacticalChoice: null, resultEntry: { aId: '250', dId: '276', route: {}, resumeAutoplay: false, openedAt: 1 } };
  assert.equal(parseCampaign(JSON.stringify(campaignSnapshot(base))).resultEntry.dId, '276');
  const odd = structuredClone(base);
  odd.settings.results = 'sometimes';
  assert.throws(() => parseCampaign(JSON.stringify(campaignSnapshot(odd))), /results setting is unsupported/);
  const gone = structuredClone(base);
  gone.resultEntry.dId = '826';
  assert.throws(() => parseCampaign(JSON.stringify(campaignSnapshot(gone))), /result entry references an unavailable team/);
  const both = structuredClone(base);
  both.tacticalChoice = { aId: '250', dId: '276' };
  assert.throws(() => parseCampaign(JSON.stringify(campaignSnapshot(both))));
});

test('setup and the in-game settings offer it as Show matches\' fourth mode, and a challenge link carries it', () => {
  assert.deepEqual(SHOW_MATCH_OPTIONS.map(([id]) => id), ['ticker', 'instant', 'express', 'entered']);
  assert.equal(showMatchesOf({ results: 'entered', express: true, resolution: 'instant' }), 'entered', 'entered scores win');
  // Entered scores leave Fast-forward (the draws and notices keep their pace) and write only what changes.
  assert.deepEqual(showMatchesWrites('entered', { resolution: 'ticker' }), [['results', 'entered']]);
  assert.deepEqual(showMatchesWrites('entered', { express: true }), [['express', false], ['results', 'entered']]);
  assert.deepEqual(showMatchesWrites('entered', { results: 'entered' }), []);
  // Leaving them: the mode the game shows its matches in first, then `results`, so a waiting match kicks off in it.
  assert.deepEqual(showMatchesWrites('instant', { results: 'entered', resolution: 'ticker' }), [['resolution', 'instant'], ['results', 'simulated']]);
  assert.deepEqual(showMatchesWrites('ticker', { results: 'entered', resolution: 'ticker' }), [['results', 'simulated']]);
  assert.deepEqual(showMatchesWrites('express', { results: 'entered' }), [['express', true], ['results', 'simulated']]);
  // During a draw or a live match, entered scores can still be picked: they start at the next kick-off.
  assert.deepEqual(showMatchOptions({ resolution: 'ticker' }, { busy: true }).map(option => option.disabled), [false, true, false, false]);
  assert.deepEqual(showMatchOptions({ results: 'entered', resolution: 'instant' }, { busy: true }).map(option => option.disabled),
    [true, false, false, false]);

  assert.equal(challengeQuery({ ...DEFAULT_SETUP, results: 'entered' }, 7), 'show=entered&seed=7');
  assert.equal(challengeQuery(DEFAULT_SETUP, 7), 'seed=7');
  const link = readChallenge('show=entered&seed=7');
  assert.deepEqual([link.setup.results, link.setup.resolution, link.setup.express], ['entered', 'ticker', false]);
  assert.deepEqual(link.ignored, []);
  assert.equal(campaignPreview(24, football, { ...DEFAULT_SETUP, results: 'entered' }).duration, 'at your pace');
  assert.equal(estimateNote('entered', 'spectator'), 'Every match waits for the score you type in.');

  for (const results of ['simulated', 'entered']) {
    const markup = renderToStaticMarkup(React.createElement(SetupOverlay, {
      setup: { ...DEFAULT_SETUP, results }, managerTeams: [], hasSave: false, savedText: '',
      onPick() {}, onStart() {}, onResume() {}, onDiscard() {}, onImport() {}, onManageSaves() {} }));
    const doc = new JSDOM(markup).window.document;
    const select = doc.querySelector('#setup-step-rules .setup-playback #setup-resolution');
    assert.equal(select.querySelector('option[selected]')?.value ?? select.value, results === 'entered' ? 'entered' : 'ticker');
    assert.equal(select.querySelector('option[value=entered]').textContent, 'Scores entered by you');
    if (results === 'entered') assert.match(doc.querySelector('#setup-resolution-help').textContent, /type in its score/);
  }
  const panel = renderToStaticMarkup(React.createElement(SettingsPanel, { settings: { ...DEFAULT_SETUP, results: 'entered' },
    onSetting() {}, onNew() {}, saveStatus: null }));
  const doc = new JSDOM(panel).window.document;
  assert.equal(doc.querySelector('#campaign-resolution option[selected]')?.value, 'entered', 'in game, under Settings');
});

test('App: Show matches\' writes take a waiting match off entered scores and kick it off as the mode shows it', () => {
  const f = enteredFixture();
  try {
    f.app.startMatch('276', '826');
    for (const [key, value] of showMatchesWrites('instant', f.app.state.settings)) f.app.setSetting(key, value);
    const st = f.app.state;
    assert.deepEqual([st.settings.results, st.settings.resolution, st.resultEntry], ['simulated', 'instant', null]);
    assert.ok(st.match && !st.match.entered);
    for (const [key, value] of showMatchesWrites('entered', st.settings)) f.app.setSetting(key, value);
    assert.equal(f.app.state.settings.results, 'entered', 'picked during a live match: the next kick-off waits');
  } finally { f.close(); }
});

test('the form: two score fields (a shoot-out\'s when level), Enter moves on until the score is complete, then confirms', async () => {
  await withDom(async ({ document }) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const team = (id, name, code) => ({ teamId: id, flagId: id, isClub: false, code, color: '#123456', name });
    const calls = [];
    const render = props => act(() => root.render(React.createElement(ResultEntry, {
      round: 'Round III', a: team('250', 'France', 'FRA'), b: team('276', 'Germany', 'GER'), unit: 'goals', draft: EMPTY_DRAFT,
      shootout: false, ready: false, line: 'Play France v Germany, then type its final score.',
      onDraft: patch => calls.push(['draft', patch]), onSubmit: () => calls.push(['submit']), onSimulate: () => calls.push(['simulate']),
      ...props })));
    await render();
    const form = document.getElementById('result-entry');
    assert.ok(form);
    assert.deepEqual([...form.querySelectorAll('input')].map(input => input.getAttribute('aria-label')), ['France goals', 'Germany goals']);
    assert.equal(form.querySelector('input').getAttribute('inputmode'), 'numeric');
    assert.equal(form.querySelector('.result-entry__confirm').disabled, true);
    await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(document.activeElement, form.querySelector('#result-entry-a'), 'Enter goes to the first empty field');
    assert.deepEqual(calls, []);
    await render({ draft: draft(1, 1), shootout: true, line: 'Level: type the penalty shoot-out’s score.' });
    assert.deepEqual([...form.querySelectorAll('input')].map(input => input.id), ['result-entry-a', 'result-entry-b', 'result-entry-pa', 'result-entry-pb']);
    await render({ draft: draft(2, 1), ready: true });
    assert.equal(form.querySelector('.result-entry__confirm').disabled, false);
    await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { form.querySelector('.result-entry__simulate').click(); });
    assert.deepEqual(calls, [['submit'], ['simulate']]);
    act(() => root.unmount());
  });
});
