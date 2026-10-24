// Owner: WP-SETUP (see PLAN.md §5.2). Setup wizard: steps, DOM contract, rules of war, launch and Space handling.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import {
  TURN_ORDER_CARDS, buildSetupModel, campaignPreview as modelPreview, countryMapPreview, domesticDescription as modelDescription,
  domesticTheatres, frontRelation, rulesOf, summaryOf, theatreMapPreview, theatreRow, tierOf,
} from '../src/screens/setup/setupModel.js';
import { SCOPES } from '../src/data/teams.js';
import { DOMESTIC } from '../src/data/domestic.js';
import { getSport } from '../src/sports/index.js';
import { empireFill } from '../src/theme.js';

const compiled = await build({
  stdin: { contents: `
    export {default as SetupOverlay, PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS, campaignPreview, domesticDescription} from './src/components/SetupOverlay.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SetupOverlay, PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS, campaignPreview, domesticDescription } = module.exports;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

const BASE = {
  sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker',
  preset: 'standard', seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'spectator',
  managedTeamId: '', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic', turnOrder: 'random', targeting: 'compass',
};
const TEAMS = [
  { id: '250', name: 'France', rating: 86.1 }, { id: '348', name: 'Hungary', rating: 76.4 },
  { id: '380', name: 'Italy', rating: 84.2 }, { id: '724', name: 'Spain', rating: 85.0 },
];

/*
 * console.error / console.warn capture. One sink per test, shared by every mount in it, so a second mount never
 * swaps out the first one's capture. The real functions are taken once here and put back when the test's last mount
 * is released (after its unmount, so unmount warnings count too); a non-empty sink then fails that test.
 */
const realConsole = { error: console.error, warn: console.warn };
const consoleSinks = new Map();
function consoleSink(t) {
  let sink = consoleSinks.get(t);
  if (!sink) {
    sink = { errors: [], holds: 0 };
    consoleSinks.set(t, sink);
    console.error = (...args) => { sink.errors.push(args.join(' ')); };
    console.warn = (...args) => { sink.errors.push(args.join(' ')); };
  }
  sink.holds += 1;
  return {
    errors: sink.errors,
    release() {
      sink.holds -= 1;
      if (sink.holds > 0) return;
      consoleSinks.delete(t);
      console.error = realConsole.error; console.warn = realConsole.warn;
      assert.deepEqual(sink.errors, [], 'no console.error / console.warn during the test');
    },
  };
}

/**
 * Mounts the overlay with App-like setup state: onPick merges into `setup`, as App.pickSetup does, and onDiscard
 * clears `hasSave`, as App's quick-resume discard does. Every render passes fresh callback arrows, like App.
 * `managerTeams: null` omits the prop.
 */
async function mount(t, { setup = {}, managerTeams = TEAMS, hasSave = false, ...props } = {}) {
  const calls = { picks: [], start: 0, resume: 0, discard: 0, cancel: 0, renders: 0, startRender: 0 };
  const sink = consoleSink(t);
  function Harness() {
    const [state, setState] = useState({ ...BASE, ...setup });
    const [saved, setSaved] = useState(hasSave);
    calls.renders += 1;
    const render = calls.renders;
    return React.createElement(SetupOverlay, {
      setup: state, ...(managerTeams === null ? {} : { managerTeams }), hasSave: saved, savedText: '', saveStatus: undefined,
      onPick: (key, value) => { calls.picks.push([key, value]); setState(current => ({ ...current, [key]: value })); },
      onStart: () => { calls.start += 1; calls.startRender = render; }, onResume: () => { calls.resume += 1; },
      onDiscard: () => { calls.discard += 1; setSaved(false); },
      onImport: () => {}, onManageSaves: () => {}, ...props,
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
  const view = {
    host, calls, errors: sink.errors,
    q: selector => host.querySelector(selector),
    qa: selector => [...host.querySelectorAll(selector)],
    section: n => host.querySelector(`section.setup-step[data-step="${n}"]`),
    visibleStep: () => [...host.querySelectorAll('section.setup-step')].filter(section => !section.hidden).map(section => section.dataset.step),
    button(label, within = host) {
      const found = [...within.querySelectorAll('button')].find(element => element.textContent.trim() === label);
      assert.ok(found, `button not found: ${label}`);
      return found;
    },
    async click(element) { await act(async () => element.click()); },
    async key(target, key, init = {}) {
      const event = new dom.window.KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...init });
      await act(async () => target.dispatchEvent(event));
      return event;
    },
  };
  t.after(async () => {
    try {
      await act(async () => root.unmount());
      host.remove();
    } finally {
      sink.release();
    }
  });
  return view;
}

test('frozen named exports keep their values', () => {
  assert.deepEqual(PACING_OPTIONS.map(([id]) => id), ['duel', 'blitz', 'chaos']);
  assert.deepEqual(RESOLUTION_OPTIONS.map(([id]) => id), ['ticker', 'instant']);
  assert.match(PACING_HELP.duel, /neutral transit/i);
  assert.equal(typeof campaignPreview, 'function');
  assert.deepEqual(campaignPreview(32, getSport('football'), { finale: 'best-of-three', resolution: 'ticker' }).matches, '31–33');
  assert.deepEqual(campaignPreview(10, getSport('football'), { resolution: 'instant' }), { matches: '9', duration: 'about 1–2 min at 1× autoplay' });
  // The component re-exports the model's function (the bundle holds its own copy of the module).
  const sample = { finale: 'best-of-three', resolution: 'ticker', express: false };
  assert.deepEqual(campaignPreview(46, getSport('basketball'), sample), modelPreview(46, getSport('basketball'), sample));
});

test('static markup keeps the whole DOM contract on every step', t => {
  const sink = consoleSink(t);
  t.after(() => sink.release());
  for (const sport of ['football', 'basketball']) {
    const markup = renderToStaticMarkup(React.createElement(SetupOverlay, {
      setup: { ...BASE, sport, role: 'manager', scope: 'elite', seed: '42', finale: 'best-of-three' }, managerTeams: TEAMS,
      hasSave: true, savedText: 'Round 4 · 20 nations remaining · Europe', onResume() {}, onCancel() {},
    }));
    const doc = new JSDOM(markup).window.document;
    const steps = [...doc.querySelectorAll('section.setup-step')];
    assert.deepEqual(steps.map(section => section.dataset.step), ['1', '2', '3']);
    assert.deepEqual(steps.map(section => section.hasAttribute('hidden')), [false, true, true], 'only step 1 is shown first');
    for (const id of ['setup-theatre', 'setup-pacing', 'setup-resolution', 'setup-uncertainty', 'setup-finale', 'setup-recruitment', 'setup-seed', 'setup-managed-team']) {
      assert.equal(doc.querySelectorAll(`#${id}`).length, 1, `#${id} is mounted once`);
    }
    const advanced = doc.querySelector('details.setup-advanced');
    for (const id of ['setup-pacing', 'setup-resolution', 'setup-uncertainty', 'setup-finale', 'setup-recruitment', 'setup-seed']) {
      assert.ok(advanced.querySelector(`#${id}`), `#${id} lives in the Match settings disclosure`);
    }
    assert.equal(!!advanced.querySelector('#setup-roster-preset'), sport === 'basketball', 'starting ratings are a basketball setting');
    assert.equal(doc.querySelector('#setup-seed').getAttribute('value'), '42');
    assert.ok(doc.querySelector('section[data-step="3"] #setup-managed-team'));
    const launch = [...doc.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Launch campaign');
    assert.equal(launch.length, 1);
    assert.equal(launch[0].getAttribute('type'), 'submit');
    assert.ok(launch[0].closest('section[data-step="3"] footer'), 'Launch campaign sits in step 3\'s footer');
    for (const label of ['Football', 'Basketball', 'Nations', 'Clubs', 'Next: Rules', 'Next: Nation & role', 'Cancel']) {
      assert.ok([...doc.querySelectorAll('button')].some(button => button.textContent.trim() === label), `button ${label}`);
    }
    const save = doc.querySelector('.setup-save');
    assert.match(save.textContent, /Continue your campaign/);
    assert.ok([...save.querySelectorAll('button')].some(button => button.textContent.trim() === 'Resume'));
    assert.match(markup, /take all of the loser/);
    assert.match(markup, /some signings add bench options/);
    assert.match(markup, /up to three signings/);
    assert.match(markup, /31–33 matches/);
    assert.match(markup, /neutral transit/i);
    assert.doesNotMatch(markup, /Progress saved after every match/);
    assert.doesNotMatch(markup, /aria-modal/);
    assert.ok(doc.querySelector('.setup-overlay'));
  }
});

test('Cancel only appears when App passes onCancel (a save exists)', async t => {
  const plain = await mount(t);
  assert.equal(plain.qa('button').filter(button => button.textContent.trim() === 'Cancel').length, 0);
  let cancelled = 0;
  const withSave = await mount(t, { onCancel: () => { cancelled += 1; } });
  await withSave.click(withSave.button('Cancel'));
  assert.equal(cancelled, 1);
});

test('rail, Next and Back move between the three mounted steps and focus the step heading', async t => {
  const view = await mount(t);
  assert.deepEqual(view.visibleStep(), ['1']);
  const rail = () => view.qa('.setup-rail__step').map(step => step.dataset.state);
  assert.deepEqual(rail(), ['current', 'upcoming', 'upcoming']);
  assert.equal(view.q('.setup-rail__step[aria-current="step"]').textContent.includes('Campaign'), true);

  await view.click(view.button('Next: Rules'));
  assert.deepEqual(view.visibleStep(), ['2']);
  assert.deepEqual(rail(), ['done', 'current', 'upcoming']);
  assert.equal(document.activeElement, view.q('#setup-rules-title'));
  assert.match(view.q('.setup-rail__step[data-state="done"]').textContent, /Football · Nations · Europe/);

  await view.click(view.button('Next: Nation & role', view.section(2)));
  assert.deepEqual(view.visibleStep(), ['3']);
  await view.click(view.button('Back', view.section(3)));
  assert.deepEqual(view.visibleStep(), ['2']);
  await view.click(view.button('Back', view.section(2)));
  assert.deepEqual(view.visibleStep(), ['1']);
  await view.click(view.qa('.setup-rail__step')[2]);
  assert.deepEqual(view.visibleStep(), ['3']);
  assert.equal(document.activeElement, view.q('#setup-role-title'));
  assert.equal(view.qa('.setup-rail__step[aria-current="step"]').length, 1);
  assert.deepEqual(view.errors, []);
});

test('step 1 binds sport, teams and theatre; the theatre mirror select stays value-bound', async t => {
  const view = await mount(t);
  const football = view.button('Football');
  assert.equal(football.getAttribute('role'), 'radio');
  assert.equal(football.getAttribute('aria-checked'), 'true');
  await view.click(view.button('Basketball'));
  assert.deepEqual(view.calls.picks.at(-1), ['sport', 'basketball']);
  await view.click(view.button('Basketball'));
  assert.equal(view.calls.picks.length, 1, 're-selecting the current sport does not reset the setup');
  await view.click(view.button('Clubs'));
  assert.deepEqual(view.calls.picks.at(-1), ['layer', 'clubs']);
  assert.ok(view.qa('.setup-theatre').some(row => /All Leagues/.test(row.textContent)));
  await view.click(view.button('Nations'));

  const africa = view.qa('.setup-theatre').find(row => /Africa/.test(row.textContent));
  await view.click(africa);
  assert.deepEqual(view.calls.picks.at(-1), ['scope', 'CAF']);
  assert.equal(africa.getAttribute('aria-checked'), 'true');
  const mirror = view.q('#setup-theatre');
  assert.equal(mirror.value, 'CAF');
  assert.equal(mirror.getAttribute('aria-hidden'), 'true');
  mirror.value = 'elite';
  await act(async () => mirror.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  assert.deepEqual(view.calls.picks.at(-1), ['scope', 'elite']);
  assert.match(view.q('.setup-stats').textContent, /32/);
  assert.match(view.q('[role="status"].sr-only').textContent, /32 nations · 31 matches/);

  // Arrow keys move the radio selection (and focus) within a group.
  const first = view.qa('.setup-theatre')[0];
  await view.key(view.q('.setup-theatre[aria-checked="true"]'), 'Home');
  assert.equal(document.activeElement, first);
  assert.deepEqual(view.calls.picks.at(-1), ['scope', 'world']);
  await view.key(first, 'ArrowDown');
  assert.deepEqual(view.calls.picks.at(-1), ['scope', 'UEFA']);
  assert.deepEqual(view.errors, []);
});

/**
 * M§3.5: every matrix tag is the board's verbatim copy (one line); the board's " · selected" suffix is a separate
 * "Selected" status line on the selected cell only (decorative: aria-checked carries the state).
 */
function assertSelectedCell(step, selected, tag) {
  const tags = [...step.querySelectorAll('.rule-matrix__tag')].map(element => element.textContent);
  assert.deepEqual(tags, ['Manager', 'Spectator-ready', 'Manager', 'Spectator-ready · classic']);
  assert.equal(selected.querySelector('.rule-matrix__tag').textContent, tag);
  const status = [...step.querySelectorAll('.rule-matrix__selected')];
  assert.equal(status.length, 1, 'one status line, on the selected cell');
  assert.equal(status[0].closest('.rule-matrix__cell'), selected);
  assert.equal(status[0].textContent, 'Selected');
  assert.equal(status[0].getAttribute('aria-hidden'), 'true');
  assert.ok(status[0].previousElementSibling.classList.contains('rule-matrix__tag'), 'the status line follows the tag');
  assert.doesNotMatch(step.querySelector('.rule-matrix').textContent, /· selected/i);
}

test('rules of war: radio cards, matrix cells set both switches, disabled note away from One by one', async t => {
  const view = await mount(t);
  await view.click(view.button('Next: Rules'));
  const step = view.section(2);
  const groups = [...step.querySelectorAll('.setup-main [role="radiogroup"]')];
  assert.equal(groups.length, 2);
  for (const group of groups) {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    assert.equal(radios.length, 2);
    assert.equal(radios.filter(radio => radio.getAttribute('aria-checked') === 'true').length, 1);
    assert.equal(radios.filter(radio => radio.tabIndex === 0).length, 1, 'roving tabindex');
    assert.ok(group.getAttribute('aria-labelledby'));
  }
  const roundRobin = step.querySelector('#rule-order-round-robin-title').closest('[role="radio"]');
  await view.click(roundRobin);
  assert.deepEqual(view.calls.picks.at(-1), ['turnOrder', 'round-robin']);
  assert.equal(roundRobin.getAttribute('aria-checked'), 'true');
  await view.key(roundRobin, 'ArrowRight');
  assert.deepEqual(view.calls.picks.at(-1), ['turnOrder', 'random']);

  const cell = step.querySelector('.rule-matrix__cell[data-turn-order="round-robin"][data-targeting="player"]');
  view.calls.picks.length = 0;
  await view.click(cell);
  assert.deepEqual(view.calls.picks, [['turnOrder', 'round-robin'], ['targeting', 'player']]);
  assert.equal(cell.getAttribute('aria-checked'), 'true');
  assertSelectedCell(step, cell, 'Manager');
  assert.equal(step.querySelectorAll('.rule-matrix__cell[aria-checked="true"]').length, 1);
  assert.equal(step.querySelector('#rule-target-player-title').closest('[role="radio"]').getAttribute('aria-checked'), 'true');
  assert.match(step.querySelector('.setup-summary').textContent, /Balanced — strength matters, upsets happen/);
  assert.match(step.textContent, /Watching as a spectator\?/);
  assert.equal(step.querySelector('.rule-note'), null);

  // Blitz: rules cards disabled with a note; the matrix shows the effective random × compass draw.
  const pacing = view.q('#setup-pacing');
  pacing.value = 'blitz';
  await act(async () => pacing.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  assert.deepEqual(view.calls.picks.at(-1), ['pacing', 'blitz']);
  const note = step.querySelector('.rule-note');
  assert.match(note.textContent, /apply to One by one pacing/);
  assert.ok([...step.querySelectorAll('.rule-card, .rule-matrix__cell')].every(button => button.disabled));
  assert.equal(step.querySelector('.rule-matrix__cell[aria-checked="true"]').dataset.turnOrder, 'random');
  assertSelectedCell(step, step.querySelector('.rule-matrix__cell[aria-checked="true"]'), 'Spectator-ready · classic');
  await view.click(view.button('Use One by one', note));
  assert.deepEqual(view.calls.picks.at(-1), ['pacing', 'duel']);
  assert.equal(step.querySelector('.rule-note'), null);
  assert.equal(step.querySelector('.rule-matrix__cell[aria-checked="true"]').dataset.targeting, 'player', 'stored choice returns');
  assert.deepEqual(view.errors, []);
});

test('launch: enabled for spectators from any step, requires a managed team for managers', async t => {
  const spectator = await mount(t);
  const launch = spectator.button('Launch campaign');
  assert.equal(launch.disabled, false);
  await spectator.click(launch);   // smoke clicks it while step 1 is showing
  assert.equal(spectator.calls.start, 1);

  const manager = await mount(t, { setup: { role: 'manager' } });
  assert.equal(manager.button('Launch campaign').disabled, true);
  await manager.click(manager.qa('.setup-rail__step')[2]);
  assert.match(manager.section(3).querySelector('.setup-foot__note').textContent, /Choose a nation to manage/);
  const italy = manager.qa('.setup-team').find(row => /Italy/.test(row.textContent));
  await manager.click(italy);
  assert.deepEqual(manager.calls.picks.at(-1), ['managedTeamId', '380']);
  assert.equal(manager.q('#setup-managed-team').value, '380');
  const pick = manager.q('.setup-pick');
  assert.match(pick.textContent, /Selected nation/);
  assert.match(pick.textContent, /Italy/);
  assert.match(pick.textContent, /3 \/ 4/);
  assert.match(pick.textContent, /Outsider/, 'third of a four-team field (tiers scale with the field)');
  assert.ok(pick.querySelectorAll('.setup-player').length > 0, 'best players come from the roster data');
  assert.equal(manager.button('Launch campaign').disabled, false);
  await manager.click(manager.button('Launch campaign'));
  assert.equal(manager.calls.start, 1);

  // Role cards are radios; switching to spectator hides the team list.
  await manager.click(manager.q('#setup-role-spectator-title').closest('[role="radio"]'));
  assert.deepEqual(manager.calls.picks.at(-1), ['role', 'spectator']);
  assert.equal(manager.q('#setup-managed-team'), null);
  assert.ok(manager.q('.setup-shortlist'));
  assert.deepEqual(manager.errors, []);
});

test('type-ahead jumps through the team list', async t => {
  const view = await mount(t, { setup: { role: 'manager', managedTeamId: '250' } });
  await view.click(view.qa('.setup-rail__step')[2]);
  const france = view.qa('.setup-team').find(row => /France/.test(row.textContent));
  france.focus();
  await view.key(france, 's');
  assert.deepEqual(view.calls.picks.at(-1), ['managedTeamId', '724']);
  assert.match(document.activeElement.textContent, /Spain/);
});

test('Space advances steps, launches on step 3 and is ignored on inputs, selects, buttons and repeats', async t => {
  const view = await mount(t);
  await view.key(document.body, ' ');
  assert.deepEqual(view.visibleStep(), ['2']);
  await view.key(document.body, ' ', { repeat: true });
  assert.deepEqual(view.visibleStep(), ['2'], 'key repeat ignored');
  const ignored = await view.key(view.q('#setup-seed'), ' ');
  assert.equal(ignored.defaultPrevented, false);
  await view.key(view.q('#setup-pacing'), ' ');
  await view.key(view.button('Back', view.section(2)), ' ');
  await view.key(view.q('.setup-rail__step'), ' ');
  await view.key(view.q('.rule-card'), ' ');
  assert.deepEqual(view.visibleStep(), ['2']);
  assert.equal(view.calls.start, 0);
  const advanced = await view.key(view.q('#setup-rules-title'), ' ');
  assert.equal(advanced.defaultPrevented, true);
  assert.deepEqual(view.visibleStep(), ['3']);
  await view.key(document.body, ' ');
  assert.equal(view.calls.start, 1, 'Space submits Launch campaign on step 3');

  // A modal dialog over setup keeps Space.
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  await view.key(document.body, ' ');
  assert.equal(view.calls.start, 1);
  modal.remove();

  const manager = await mount(t, { setup: { role: 'manager' } });
  await manager.click(manager.qa('.setup-rail__step')[2]);
  await manager.key(document.body, ' ');
  assert.equal(manager.calls.start, 0, 'no launch without a managed team');
});

test('quick resume card resumes or asks before clearing, and focus never falls to the body', async t => {
  const view = await mount(t, { hasSave: true, savedText: 'Round 4 · 20 nations remaining · Europe', onExport() {} });
  const save = view.q('.setup-save');
  assert.match(save.textContent, /Round 4 · 20 nations remaining/);
  assert.ok(view.qa('.setup-saves button').some(button => button.textContent.trim() === 'Export campaign'));
  await view.click(view.button('Resume', save));
  assert.equal(view.calls.resume, 1);

  await view.click(view.button('Clear quick resume', save));
  assert.match(view.q('.setup-confirmation').textContent, /Clear quick resume\?/);
  assert.equal(document.activeElement, view.button('Keep save', save), 'opening the confirmation focuses Keep save');
  await view.key(document.body, ' ');
  assert.deepEqual(view.visibleStep(), ['1'], 'Space waits while the confirmation is showing');

  await view.click(view.button('Keep save', save));
  assert.equal(view.calls.discard, 0);
  assert.equal(view.q('.setup-confirmation'), null);
  const trigger = view.button('Clear quick resume', save);
  assert.equal(document.activeElement, trigger, 'Keep save returns focus to its trigger');

  await view.click(trigger);
  await view.click(view.button('Clear quick resume', view.q('.setup-confirmation')));
  assert.equal(view.calls.discard, 1);
  assert.equal(view.q('.setup-save'), null, 'App clears hasSave, so the card unmounts');
  assert.equal(document.activeElement, view.q('#setup-campaign-title'), 'the discard moves focus to the step heading');
});

test('leaving step 1 dismisses a pending confirmation, so Space keeps advancing', async t => {
  const view = await mount(t, { hasSave: true, savedText: 'Round 4' });
  await view.click(view.button('Clear quick resume', view.q('.setup-save')));
  assert.ok(view.q('.setup-confirmation'));
  await view.click(view.qa('.setup-rail__step')[1]);
  assert.deepEqual(view.visibleStep(), ['2']);
  await view.key(document.body, ' ');
  assert.deepEqual(view.visibleStep(), ['3'], 'the hidden confirmation no longer swallows Space');
  await view.key(document.body, ' ');
  assert.equal(view.calls.start, 1);
  await view.click(view.qa('.setup-rail__step')[0]);
  assert.equal(view.q('.setup-confirmation'), null, 'step 1 shows the quick-resume card again');
  assert.ok(view.button('Resume', view.q('.setup-save')));
  assert.equal(view.calls.discard, 0);
});

test('mounting moves focus into the wizard unless a modal dialog holds it', async t => {
  const view = await mount(t);
  assert.equal(document.activeElement, view.q('#setup-campaign-title'));

  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  const field = document.createElement('button');
  modal.append(field);
  document.body.append(modal);
  t.after(() => modal.remove());
  field.focus();
  const behind = await mount(t);
  assert.equal(document.activeElement, field, 'an open dialog keeps its focus');
  assert.ok(behind.q('.setup-overlay'));
});

test('the Space listener is not re-added on App re-renders and calls the latest onStart', async t => {
  const added = [];
  const original = document.addEventListener;
  document.addEventListener = function addEventListener(type, ...rest) {
    if (type === 'keydown') added.push(type);
    return original.call(this, type, ...rest);
  };
  t.after(() => { delete document.addEventListener; });
  const view = await mount(t, { managerTeams: null });   // prop omitted, as before App has teams
  assert.equal(added.length, 1);
  await view.click(view.button('Basketball'));
  await view.click(view.button('Clubs'));
  await view.click(view.button('Nations'));
  assert.ok(view.calls.renders >= 4);
  assert.equal(added.length, 1, 'fresh onStart arrows and an omitted managerTeams do not churn the listener');
  await view.click(view.qa('.setup-rail__step')[2]);
  await view.key(document.body, ' ');
  assert.equal(view.calls.start, 1);
  assert.equal(view.calls.startRender, view.calls.renders, 'Space calls the onStart from the latest render');
});

test('setup.css keeps the reviewed token and hit-target rules', () => {
  const css = readFileSync(new URL('../src/components/setup.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `rule ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };
  // M§3.4: Round robin squares are always `you`; only an unselected Random draw paints its filled squares muted.
  assert.match(rule('.rule-dot--on'), /background:var\(--you\)/);
  assert.match(rule('.rule-dot--current'), /background:var\(--you\).*0 0 0 3px var\(--you\)/);
  assert.match(rule('.rule-card[data-dots=rand]:not([aria-checked=true]) .rule-dot--on'), /background:var\(--muted\)/);
  assert.doesNotMatch(css, /\.rule-card\[aria-checked=true\] \.rule-dot/);
  // DECISIONS: hit targets >= 44px on touch / phone — the D2 escape link keeps the primitive's var(--tap) floor.
  assert.doesNotMatch(css, /\.rule-note__action \{[^}]*min-height:0/);
  assert.match(css, /@media \(max-width:699\.98px\), \(pointer:coarse\) \{\s*\.rule-note__action \{[^}]*min-height:max\(44px, var\(--tap\)\)/);
  // WP-LEDGER's `.save-status.is-unsaved` weight survives the setup restyle.
  assert.doesNotMatch(rule('.setup-overlay .save-controls .save-status'), /font:/);
  assert.match(rule('.setup-overlay .save-controls .save-status.is-unsaved'), /font-weight:600/);
  // Low std band (1200–1399) tightens the frame so option-card and matrix titles hold one line down to 1200.
  const bandQuery = '@media (min-width:1200px) and (max-width:1399.98px) {';
  assert.ok(css.includes(bandQuery));
  const band = css.slice(css.indexOf(bandQuery) + bandQuery.length);   // up to the next @media: this band's rules
  assert.match(band, /^[^@]*--setup-rail-w:224px;/);
  assert.match(band, /^[^@]*\.rule-card__title, \.setup-card__button \{ font-size:21px;/);
  assert.match(band, /^[^@]*\.rule-matrix__title \{ font-size:16px; \}/);
  // ...and the rail subtitles and matrix tags hold one line there too (W4 review: they wrapped at 1366). Measured in
  // Chrome: 146px rail text column vs "Football · Nations · Europe" 141px at 12px; cells ≥159px inside at 1200 vs
  // "Spectator-ready · classic" 152px at 11px / .06em.
  assert.match(band, /^[^@]*\.setup-rail \{ padding:28px 12px; \}/);
  assert.match(band, /^[^@]*\.setup-rail__step \{ gap:10px; padding:14px 6px 14px 10px; \}/);
  assert.match(band, /^[^@]*\.setup-rail__sub \{ font-size:12px; \}/);
  assert.match(band, /^[^@]*\.rule-matrix \{ grid-template-columns:92px minmax\(0, 1fr\) minmax\(0, 1fr\); column-gap:8px; \}/);
  assert.match(band, /^[^@]*\.rule-matrix__tag, \.rule-matrix__selected \{ font-size:11px; letter-spacing:\.06em; \}/);
  // Step 3: 8–12px between the nation list and the "Management stays…" note (W4 final: flush, so the list read as
  // clipped). A bare `.setup-teams__help` loses to `.control-help { margin:0 }` (primitives.css loads later): the rule
  // must out-rank it (measured in Chrome before: computed margin-top 0px at 1366/1440/1920/820/390).
  assert.match(rule('.setup-group--list .setup-teams__help'), /margin-top:(8|9|10|11|12)px/);
  assert.doesNotMatch(css, /(^|\})\s*\.setup-teams__help \{/, 'no single-class rule that .control-help overrides');
  // The "Selected" status line never wraps; done-summary parts stay whole so a long summary wraps at a separator.
  assert.match(rule('.rule-matrix__selected'), /white-space:nowrap/);
  assert.match(rule('.setup-rail__part'), /white-space:nowrap/);
  // M§3.5: matrix tags are nowrap at every band down to the 390 phone (RC2 review: "Spectator-ready · classic" wrapped
  // in the 149px phone cell). Measured in Chrome: 146.7px at 11px / .04em. Phones narrower than 390 wrap instead of
  // spilling out of the cell.
  assert.match(rule('.rule-matrix__tag'), /white-space:nowrap/);
  const phoneQuery = '@media (max-width:699.98px) {';
  const phone = css.slice(css.lastIndexOf(phoneQuery) + phoneQuery.length);   // the layout band (the first holds tokens)
  assert.match(phone, /^[^@]*\.rule-matrix__cell \{ min-height:0; padding:12px; \}/);
  assert.match(phone, /^[^@]*\.rule-matrix__tag, \.rule-matrix__selected \{ font-size:11px; letter-spacing:\.04em; \}/);
  assert.doesNotMatch(phone.split('@')[0], /white-space:normal/, 'the phone band itself keeps the tags on one line');
  const narrowQuery = '@media (max-width:389.98px) {';
  assert.ok(css.indexOf(narrowQuery) > css.lastIndexOf(phoneQuery), 'the sub-390 fallback follows (and so overrides) the phone band');
  const narrow = css.slice(css.indexOf(narrowQuery) + narrowQuery.length);
  assert.match(narrow, /^\s*\.rule-matrix__tag \{ white-space:normal; \}/);
  // The phone step bar never overflows the screen: "Next: Nation & role" + its "Step 2 of 3" hint spilled past the
  // right edge at 360. The hint may ellipsize before the bar overflows, and below 390 the bar's padding tightens so
  // the hint stays whole (measured in Chrome at 360: 41px free for the 59px hint before, 64.5px after; 390 unchanged).
  assert.match(phone, /^[^@]*\.setup-foot \.setup-foot__next \{ flex:1 1 auto; min-width:0;/);
  assert.match(rule('.setup-foot .btn-primary[data-bar-hint]::after'), /min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;/);
  assert.match(narrow, /^[^@]*\.setup-foot \.setup-foot__back \{ padding:0 14px; \}\s*\.setup-foot \.setup-foot__next \{ padding:0 12px; \}\s*\}/);
});

test('theatre footnote: a "*"-marked scope name resolves to its description; summaries drop the marker', async t => {
  // The marker rule on synthetic scopes.
  assert.deepEqual(theatreRow({ id: 'x', name: 'East*', desc: 'A plus B.' }, 3), { id: 'x', name: 'East*', label: 'East', count: 3, note: 'A plus B.' });
  assert.deepEqual(theatreRow({ id: 'y', name: 'West *' }, 2), { id: 'y', name: 'West *', label: 'West', count: 2, note: '' }, 'no description: the marker is just dropped');
  assert.deepEqual(theatreRow({ id: 'z', name: 'Elite 32', desc: 'Top.' }, 32), { id: 'z', name: 'Elite 32', label: 'Elite 32', count: 32, note: '' });

  // Real data: the AFC theatre ("Asia & Oceania*", desc "AFC plus OFC — the whole east." in SCOPES).
  const data = SCOPES.find(scope => scope.id === 'AFC');
  const marked = /\*\s*$/.test(data.name);
  const label = data.name.replace(/\s*\*\s*$/, '');
  const model = buildSetupModel({ ...BASE, scope: 'AFC' }, { managerTeams: TEAMS });
  const asia = model.scopes.find(scope => scope.id === 'AFC');
  assert.equal(asia.name, data.name, 'the data name is kept for the list');
  assert.equal(asia.label, label);
  assert.equal(asia.note, marked ? data.desc : '');
  assert.deepEqual(model.theatreNotes.map(scope => scope.id), marked ? ['AFC'] : []);
  assert.ok(model.scopes.filter(scope => scope.id !== 'AFC').every(scope => !scope.note));
  assert.equal(model.campaignSummary, `Football · Nations · ${label}`);
  assert.equal(model.stepSummaries[1], `Football · Nations · ${label}`);
  assert.equal(model.roleMeta, `${label} · Football nations · ${asia.count} nations`);
  assert.equal(model.scopeName, label);
  assert.deepEqual(buildSetupModel({ ...BASE, layer: 'clubs' }).theatreNotes, [], 'club theatres carry no marker');

  const view = await mount(t, { setup: { scope: 'AFC' } });
  const row = view.q('.setup-theatre[aria-checked="true"]');
  assert.equal(row.querySelector('.setup-theatre__name').textContent, marked ? `${label}*` : label);
  if (marked) {
    assert.equal(row.querySelector('.setup-theatre__mark').getAttribute('aria-hidden'), 'true');
    const note = view.q(`#${row.getAttribute('aria-describedby')}`);
    assert.ok(note?.classList.contains('setup-theatres__note'), 'the starred row is described by its footnote');
    assert.equal(note.textContent, `* ${data.desc}`);
    assert.equal(view.qa('.setup-theatres__note').length, 1);
  } else {
    assert.equal(view.qa('.setup-theatres__note').length, 0);
  }
  assert.ok(view.qa('.setup-theatre').filter(element => element !== row).every(element => !element.hasAttribute('aria-describedby')));
  assert.equal(view.q('#setup-theatre option[value="AFC"]').textContent, `${label} · ${asia.count} nations`);

  // The done rail summary keeps its text but renders each part whole, and has no dangling "*".
  await view.click(view.button('Next: Rules'));
  const sub = view.q('.setup-rail__step[data-state="done"] .setup-rail__sub');
  assert.equal(sub.textContent, `Football · Nations · ${label}`);
  assert.deepEqual([...sub.querySelectorAll('.setup-rail__part')].map(part => part.textContent), ['Football', 'Nations', label]);

  await view.click(view.button('Clubs', view.section(1)));
  assert.equal(view.qa('.setup-theatres__note').length, 0, 'no footnote without a marked theatre');
  assert.deepEqual(view.errors, []);
});

test('turn-order cards mark their dot style for the CSS', async t => {
  assert.deepEqual(TURN_ORDER_CARDS.map(card => card.dotStyle), ['rr', 'rand']);
  const view = await mount(t);
  await view.click(view.button('Next: Rules'));
  const card = value => view.q(`#rule-order-${value}-title`).closest('[role="radio"]');
  assert.equal(card('round-robin').dataset.dots, 'rr');
  assert.equal(card('random').dataset.dots, 'rand');
  assert.equal(card('round-robin').querySelectorAll('.rule-dot--current').length, 1);
  assert.equal(view.q('#rule-target-player-title').closest('[role="radio"]').hasAttribute('data-dots'), false);
});

test('step 3 heading follows the role; the Selected panel shows board 03 Fronts when App supplies neighbours', async t => {
  const teams = [
    { id: '250', name: 'France', rating: 86.1 }, { id: '348', name: 'Hungary', rating: 76.4 },
    { id: '380', name: 'Italy', rating: 84.2, neighbours: ['250', '348', '724', '380', 'zzz'] }, { id: '724', name: 'Spain', rating: 85.0 },
    { id: '056', name: 'Belgium', rating: 82.1, neighbours: [] },
  ];
  const view = await mount(t, { managerTeams: teams, setup: { role: 'manager', managedTeamId: '380' } });
  await view.click(view.qa('.setup-rail__step')[2]);
  assert.equal(view.q('#setup-role-title').textContent, 'Choose your nation');
  const fronts = view.q('.setup-pick .setup-pick__fronts');
  assert.ok(fronts);
  assert.match(fronts.querySelector('.kicker').textContent, /Fronts.*3 land borders/);
  const rows = [...fronts.querySelectorAll('.setup-front')].map(row => [
    row.querySelector('.setup-front__name').textContent, row.querySelector('.setup-front__eff').textContent,
    row.querySelector('.setup-front__rel').textContent, row.querySelector('.setup-front__rel').dataset.tone,
  ]);
  assert.deepEqual(rows, [['France', '86.1', 'Stronger', 'loss'], ['Spain', '85.0', 'Level', 'even'], ['Hungary', '76.4', 'Weaker', 'gain']]);
  assert.ok(fronts.compareDocumentPosition(view.q('.setup-pick__note')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'Fronts sit above the note');

  await view.click(view.qa('.setup-team').find(row => /Belgium/.test(row.textContent)));
  assert.match(view.q('.setup-pick__fronts').textContent, /0 land borders/);
  assert.match(view.q('.setup-pick__fronts').textContent, /No land borders — every war goes by sea\./);
  await view.click(view.qa('.setup-team').find(row => /Spain/.test(row.textContent)));
  assert.equal(view.q('.setup-pick__fronts'), null, 'no neighbour data, no Fronts block');

  await view.click(view.q('#setup-role-spectator-title').closest('[role="radio"]'));
  assert.equal(view.q('#setup-role-title').textContent, 'Choose your role');
});

test('view model: rules normalisation, summaries, tiers and pure inputs', () => {
  assert.deepEqual([rulesOf({}).turnOrder, rulesOf({}).targeting], ['random', 'compass'], 'defaults reproduce HEAD (DEC D1)');
  const chaos = rulesOf({ pacing: 'chaos', turnOrder: 'round-robin', targeting: 'player' });
  assert.equal(chaos.applies, false);
  assert.deepEqual([chaos.turnOrder, chaos.targeting], ['random', 'compass']);
  assert.deepEqual(chaos.stored, { turnOrder: 'round-robin', targeting: 'player' });
  assert.equal(chaos.cells.filter(cell => cell.selected).length, 1);
  assert.equal(rulesOf({ pacing: 'duel', turnOrder: 'round-robin', targeting: 'player' }).summary, 'Round robin · You choose');
  assert.deepEqual(summaryOf({}), {
    pacing: 'One by one — a compass picks each fixture', uncertainty: 'Balanced — strength matters, upsets happen',
    finale: 'Single decisive match', recruitment: 'Highest-rated player for unmanaged teams',
  });
  assert.deepEqual([1, 4, 5, 12, 13, 30, 31].map(rank => tierOf(rank)), ['Favourite', 'Favourite', 'Contender', 'Contender', 'Outsider', 'Outsider', 'Long shot']);
  assert.deepEqual([1, 4, 5, 12, 13, 30, 31].map(rank => tierOf(rank, 46)), ['Favourite', 'Favourite', 'Contender', 'Contender', 'Outsider', 'Outsider', 'Long shot'],
    'a 46-team field keeps the board cut-offs');
  assert.deepEqual([1, 2, 3, 4, 7, 8, 10].map(rank => tierOf(rank, 10)), ['Favourite', 'Contender', 'Contender', 'Outsider', 'Outsider', 'Long shot', 'Long shot'],
    'a ten-club country scales them down: its weakest club is a long shot, not a contender');

  const setup = Object.freeze({ ...BASE, role: 'manager', managedTeamId: '380' });
  const teams = Object.freeze(TEAMS.map(team => Object.freeze({ ...team })));
  const model = buildSetupModel(setup, { managerTeams: teams });
  assert.equal(model.campaignSummary, 'Football · Nations · Europe');
  assert.equal(model.managed.rankText, '3 / 4');
  assert.equal(model.managed.meta, 'UEFA · Football nation');
  assert.deepEqual(model.favourites.map(team => team.name), ['France', 'Spain', 'Italy', 'Hungary']);
  assert.equal(model.canLaunch, true);
  assert.equal(model.managed.fronts, null, 'no neighbour data: the Fronts block is left out');
  assert.equal(buildSetupModel({ ...BASE, role: 'manager' }, { managerTeams: teams }).canLaunch, false);
  // Step 3 heading: managers choose a nation / club, spectators choose only their role.
  assert.equal(model.roleTitle, 'Choose your nation');
  assert.equal(buildSetupModel({ ...BASE, role: 'spectator' }, { managerTeams: teams }).roleTitle, 'Choose your role');
  assert.equal(buildSetupModel({ ...BASE, layer: 'clubs', role: 'manager' }, { managerTeams: [] }).roleTitle, 'Choose your club');

  // Board 03 Fronts: the four strongest land-border neighbours, unknown ids and the team itself dropped.
  const ring = Object.freeze([
    { id: 'a', name: 'Alpha', rating: 80, neighbours: Object.freeze(['b', 'c', 'd', 'e', 'f', 'a', 'x', 'b']) },
    { id: 'b', name: 'Bravo', rating: 81.5 }, { id: 'c', name: 'Charlie', rating: 80.9 }, { id: 'd', name: 'Delta', rating: 78.9 },
    { id: 'e', name: 'Echo', rating: 70 }, { id: 'f', name: 'Foxtrot', rating: 79.2 },
  ].map(team => Object.freeze(team)));
  const withFronts = buildSetupModel({ ...BASE, role: 'manager', managedTeamId: 'a' }, { managerTeams: ring });
  assert.equal(withFronts.managed.fronts.count, 5);
  assert.equal(withFronts.managed.fronts.countText, '5 land borders');
  assert.deepEqual(withFronts.managed.fronts.rows.map(front => [front.name, front.ratingText, front.rel, front.tone]), [
    ['Bravo', '81.5', 'Stronger', 'loss'], ['Charlie', '80.9', 'Level', 'even'], ['Foxtrot', '79.2', 'Level', 'even'], ['Delta', '78.9', 'Weaker', 'gain'],
  ]);
  assert.equal(buildSetupModel({ ...BASE, role: 'manager', managedTeamId: 'a' }, {
    managerTeams: [{ ...ring[0], neighbours: ['b'] }, ring[1]],
  }).managed.fronts.countText, '1 land border');
  assert.deepEqual([frontRelation(82, 80), frontRelation(81, 80), frontRelation(79, 80), frontRelation(78.9, 80)].map(r => r.rel),
    ['Stronger', 'Level', 'Level', 'Weaker']);
  // Tolerates App's setup phase before teams exist, and stale club scopes after a sport switch.
  const empty = buildSetupModel({}, {});
  assert.equal(empty.teams.length, 0);
  assert.equal(empty.canLaunch, true);
  const stale = buildSetupModel({ ...BASE, sport: 'basketball', layer: 'clubs', clubScope: 'Serie A' });
  assert.equal(stale.scopeId, 'all');
  assert.match(stale.sports.find(sport => sport.id === 'basketball').note, /NBA/);
});

// ---------- One country's own top clubs (main 83b26cc, ported into the wizard; MERGE-DOMESTIC UI-10) ----------

const ENGLAND = DOMESTIC.find(entry => entry.id === '826');
const COUNTRY = { layer: 'clubs', clubScope: 'domestic:826' };

test('football clubs list every shipped country after the leagues, in one radio group; the mirror groups them', async t => {
  const sorted = DOMESTIC.slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = domesticTheatres();
  assert.deepEqual(rows.map(row => row.id), sorted.map(entry => `domestic:${entry.id}`));
  assert.deepEqual(rows[0], { id: `domestic:${sorted[0].id}`, name: sorted[0].name, label: sorted[0].name, count: sorted[0].clubs, note: '' });
  const clubs = buildSetupModel({ ...BASE, layer: 'clubs' });
  assert.ok(clubs.scopes.length > 1 && !clubs.scopes.some(scope => scope.id.startsWith('domestic:')), 'model.scopes stays the league rows');
  assert.equal(clubs.domesticScopes, rows);
  for (const setup of [{ ...BASE }, { ...BASE, sport: 'basketball', layer: 'clubs' }, { ...BASE, sport: 'basketball' }]) {
    assert.deepEqual(buildSetupModel(setup).domesticScopes, [], `${setup.sport} ${setup.layer}: no single-country theatres`);
  }

  const view = await mount(t, { setup: { layer: 'clubs' } });
  const list = view.q('.setup-theatres');
  assert.ok(list.hasAttribute('data-long'), 'the long list scrolls in its own box');
  assert.equal(view.qa('[role="radiogroup"][aria-labelledby="setup-theatre-label"]').length, 1);
  assert.equal(view.qa('.setup-theatre').length, clubs.scopes.length + rows.length);
  const heading = view.q('.setup-theatres__group');
  assert.equal(heading.textContent, 'One country · top clubs');
  assert.equal(heading.getAttribute('aria-hidden'), 'true');
  assert.equal(heading.previousElementSibling.dataset.name, clubs.scopes.at(-1).label, 'leagues first, then the countries');
  const england = view.qa('.setup-theatre').find(row => row.dataset.name === 'England');
  assert.equal(england.querySelector('.setup-theatre__count').textContent, `${ENGLAND.clubs} clubs`);

  // The mirror: "European leagues" holds the league ids in order; the countries read "Name · N clubs", A–Z.
  const mirror = view.q('#setup-theatre');
  const groups = [...mirror.querySelectorAll('optgroup')];
  assert.deepEqual(groups.map(group => group.getAttribute('label')), ['European leagues', 'One country · top clubs']);
  assert.deepEqual([...groups[0].querySelectorAll('option')].map(option => option.value), clubs.scopes.map(scope => scope.id));
  assert.deepEqual([...groups[1].querySelectorAll('option')].map(option => [option.value, option.textContent]),
    sorted.map(entry => [`domestic:${entry.id}`, `${entry.name} · ${entry.clubs} clubs`]));
  mirror.value = 'domestic:826';
  await act(async () => mirror.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  assert.deepEqual(view.calls.picks.at(-1), ['clubScope', 'domestic:826']);

  // Arrow keys walk from the last league into the first country; a letter jumps to the next name starting with it.
  const leagues = view.qa('.setup-theatre').slice(0, clubs.scopes.length);
  await view.key(leagues.at(-1), 'ArrowDown');
  assert.deepEqual(view.calls.picks.at(-1), ['clubScope', rows[0].id]);
  const checked = view.q('.setup-theatre[aria-checked="true"]');
  const names = view.qa('.setup-theatre').map(row => row.dataset.name);
  const from = names.indexOf(checked.dataset.name);
  const next = [...names.slice(from + 1), ...names.slice(0, from + 1)].find(name => name.toLowerCase().startsWith('s'));
  await view.key(checked, 's');
  assert.equal(document.activeElement.dataset.name, next);
  assert.deepEqual(view.calls.picks.at(-1), ['clubScope', rows.find(row => row.label === next)?.id ?? clubs.scopes.find(scope => scope.label === next).id]);
  assert.deepEqual(view.errors, []);

  // Nations keep v4's flat list and mirror.
  const nations = await mount(t);
  assert.equal(nations.q('.setup-theatres').hasAttribute('data-long'), false);
  assert.equal(nations.q('.setup-theatres__group'), null);
  assert.equal(nations.qa('#setup-theatre optgroup').length, 0);
  assert.ok(!nations.qa('#setup-theatre option').some(option => option.value.startsWith('domestic:')));
});

test('a chosen country: description, counts, summaries, and its map load gating Launch', async t => {
  assert.equal(domesticDescription(ENGLAND), modelDescription(ENGLAND), 'SetupOverlay re-exports the model description');
  assert.equal(modelDescription({ name: 'X', clubs: 3, top: ['A', 'B', 'C'] }),
    'A, B and C lead 3 clubs fighting over X, split into 3 sections drawn from its administrative divisions.');
  assert.match(modelDescription({ name: 'X', clubs: 1, top: ['A'] }), /^A leads 1 clubs/);
  assert.match(modelDescription({ name: 'X', clubs: 2 }), /^The strongest clubs lead/);

  const model = buildSetupModel({ ...BASE, ...COUNTRY }, { domestic: { state: 'ready' } });
  assert.equal(model.scopeId, 'domestic:826');
  assert.equal(model.scopeName, 'England · top 100 clubs');
  assert.equal(model.campaignSummary, 'Football · Clubs · England · top 100 clubs');
  assert.equal(model.roleMeta, 'England · top 100 clubs · Football clubs · 100 clubs');
  assert.equal(model.count, ENGLAND.clubs);
  assert.equal(model.stats[0].value, String(ENGLAND.clubs));
  assert.match(model.status, /^100 clubs · 99 matches/);
  assert.equal(model.canLaunch, true);
  assert.equal(model.countryNote, modelDescription(ENGLAND));
  const states = Object.fromEntries(['loading', 'error', 'ready', 'idle'].map(state => [state,
    buildSetupModel({ ...BASE, ...COUNTRY }, { domestic: { state, message: state === 'error' ? 'Network down.' : null } })]));
  assert.deepEqual(Object.values(states).map(m => m.canLaunch), [false, false, true, true]);
  assert.equal(states.loading.launchNote, 'Loading the map of England…');
  assert.equal(states.loading.teamsEmpty, 'Loading the map of England…');
  assert.equal(states.error.launchNote, 'The map of England could not be loaded.');
  assert.equal(states.error.countryMessage, 'Network down.');
  const busy = buildSetupModel({ ...BASE, ...COUNTRY }, { domestic: { state: 'ready' }, launching: true });
  assert.equal(busy.canLaunch, false);
  assert.equal(busy.launchNote, 'Preparing the map of England…');
  // A country is a football-clubs theatre only: elsewhere the stale scope falls back like a stale league.
  const basketball = buildSetupModel({ ...BASE, ...COUNTRY, sport: 'basketball' }, { domestic: { state: 'loading' } });
  assert.equal(basketball.scopeId, 'all');
  assert.equal(basketball.canLaunch, true);

  // Loading: polite status under the description, Launch disabled, step 3 explains the empty club list.
  const loading = await mount(t, { setup: { ...COUNTRY, role: 'manager' }, managerTeams: [], domestic: { state: 'loading', message: null, onRetry() {} } });
  const row = loading.q('.setup-theatre[aria-checked="true"]');
  assert.equal(row.dataset.name, 'England');
  assert.equal(row.getAttribute('aria-describedby'), 'setup-theatre-description');
  const description = loading.q('#setup-theatre-description').textContent;
  assert.ok(ENGLAND.top.every(name => description.includes(name)) && description.includes('England') && description.includes('100 sections'));
  assert.equal(loading.q('.setup-domestic__status[role="status"]').textContent, 'Loading the map of England…');
  assert.equal(loading.q('#setup-theatre').value, 'domestic:826');
  assert.match(loading.q('.setup-stats').textContent, /100/);
  assert.equal(loading.button('Launch campaign').disabled, true);
  assert.equal(loading.q('.setup-map').getAttribute('data-state'), 'loading');
  await loading.click(loading.qa('.setup-rail__step')[2]);
  assert.equal(loading.q('.setup-empty').textContent, 'Loading the map of England…');
  assert.equal(loading.section(3).querySelector('.setup-foot__note').textContent, 'Loading the map of England…');
  await loading.key(document.body, ' ');
  assert.equal(loading.calls.start, 0, 'Space never launches while the map loads');
  await loading.click(loading.qa('.setup-rail__step')[0]);
  await loading.click(loading.button('Next: Rules'));
  assert.match(loading.q('.setup-rail__step[data-state="done"]').textContent, /Football · Clubs · England · top 100 clubs/);

  // Error: an alert with App's message and Retry (step 1 only); Launch stays disabled.
  let retried = 0;
  const failed = await mount(t, {
    setup: COUNTRY, domestic: { state: 'error', message: 'The map of England could not be loaded. 404', onRetry: () => { retried += 1; } },
  });
  const alert = failed.q('.setup-domestic__error[role="alert"]');
  assert.match(alert.textContent, /could not be loaded\. 404/);
  assert.equal(failed.qa('button').filter(button => button.textContent.trim() === 'Retry').length, 1);
  await failed.click(failed.button('Retry', alert));
  assert.equal(retried, 1);
  assert.equal(failed.button('Launch campaign').disabled, true);
  assert.equal(failed.q('.setup-domestic__status'), null);

  // Ready: Launch works; while App prepares the campaign the button is busy and a second submit is ignored.
  const ready = await mount(t, { setup: COUNTRY, domestic: { state: 'ready', message: null, onRetry() {} } });
  assert.equal(ready.q('.setup-domestic__status'), null);
  assert.equal(ready.q('.setup-map'), null, 'no card without a preview from App');
  await ready.click(ready.button('Launch campaign'));
  assert.equal(ready.calls.start, 1);
  const launching = await mount(t, { setup: COUNTRY, launching: true, domestic: { state: 'ready', message: null, onRetry() {} } });
  const launch = launching.button('Launch campaign');
  assert.equal(launch.disabled, true);
  assert.equal(launch.getAttribute('aria-busy'), 'true');
  assert.equal(launching.section(3).querySelector('.setup-foot__note').textContent, 'Preparing the map of England…');
  await act(async () => launching.q('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(launching.calls.start, 0);
  assert.deepEqual(launching.visibleStep(), ['1'], 'a submit while launching does not jump to step 3');
  assert.deepEqual([...loading.errors, ...failed.errors, ...ready.errors, ...launching.errors], []);
});

test('a country restore in progress disables Resume and Cancel', async t => {
  const view = await mount(t, { hasSave: true, savedText: 'Round 2', restoring: true, onCancel: () => {} });
  assert.equal(view.button('Resume', view.q('.setup-save')).disabled, true);
  assert.equal(view.button('Cancel').disabled, true);
  const idle = await mount(t, { hasSave: true, savedText: 'Round 2', onCancel: () => {} });
  assert.equal(idle.button('Resume', idle.q('.setup-save')).disabled, false);
  assert.equal(idle.button('Cancel').disabled, false);
});

test('country card: sections in their kick-off pastels over the neighbouring land, static and decorative', async t => {
  const paths = {
    s1: { d: 'M0,0L10,0L10,10Z', fullBounds: { x: 0, y: 0, w: 10, h: 10 } },
    s2: { d: 'M10,0L20,0L20,10Z', fullBounds: { x: 10, y: 0, w: 10, h: 10 } },
    s3: { d: 'M0,10L5,10L5,12Z', fullBounds: { x: 0, y: 10, w: 5, h: 2 } },
  };
  const map = {
    geo: { paths, focusView: () => ({ x: 0, y: 0, w: 20, h: 10 }) }, focus: [0, 0, 1, 1],
    sectionNames: { s1: 'North', s2: 'South', s3: 'Isle' },
    clubs: [{ id: 'd999-1', homeSection: 's1' }, { id: 'd999-2', homeSection: 's2' }],
  };
  const backdrop = [{ id: '250', d: 'M-5,-5L0,-5L0,0Z', rings: [] }];
  const preview = countryMapPreview(map, backdrop);
  assert.equal(preview.viewBox, '-0.8 -0.8 21.6 11.6', 'framed on the opening focus, 4% margin');
  assert.deepEqual(preview.sections.map(section => [section.id, section.fill]),
    [['s1', empireFill('d999-1')], ['s2', empireFill('d999-2')], ['s3', '#e8e9e4']]);
  assert.deepEqual(preview.backdrop, [{ id: '250', d: 'M-5,-5L0,-5L0,0Z' }]);
  assert.equal(countryMapPreview(map, backdrop), preview, 'memoised per map, paths and backdrop');
  assert.notEqual(countryMapPreview(map, [...backdrop]), preview);
  const unfocused = countryMapPreview({ ...map, focus: null }, null);
  assert.equal(unfocused.viewBox, '-0.8 -0.8 21.6 13.6', 'no focus: the union of the sections');
  assert.deepEqual(unfocused.backdrop, []);
  assert.equal(countryMapPreview(null), null);
  assert.equal(countryMapPreview({ geo: { paths: {} }, sectionNames: {} }), null);

  // A real shipped map: every section, each in its own home club's pastel.
  const { decodeDomestic } = await import('../src/engine/domestic.js');
  const decoded = decodeDomestic(JSON.parse(readFileSync(new URL('../public/domestic/826.json', import.meta.url), 'utf8')), '826');
  const real = countryMapPreview(decoded, []);
  assert.equal(real.sections.length, ENGLAND.clubs);
  const home = new Map(decoded.clubs.map(club => [club.homeSection, club.id]));
  assert.ok(real.sections.every(section => section.fill === empireFill(home.get(section.id))));
  assert.ok(real.viewBox.split(' ').map(Number).every(Number.isFinite));

  const view = await mount(t, { setup: COUNTRY, domestic: { state: 'ready', message: null, onRetry() {}, preview } });
  const card = view.q('.setup-step[data-step="1"] .setup-side > .setup-map');
  assert.ok(card, 'the card leads the side column of step 1');
  assert.equal(card.getAttribute('aria-hidden'), 'true');
  assert.equal(card.querySelector('svg').getAttribute('viewBox'), preview.viewBox);
  assert.equal(card.querySelectorAll('.setup-map__backdrop path').length, 1);
  assert.deepEqual([...card.querySelectorAll('.setup-map__sections path')].map(path => path.getAttribute('fill')),
    preview.sections.map(section => section.fill));
  assert.equal(card.querySelectorAll('[data-country], [role], [tabindex]').length, 0, 'never territory, never interactive');
  assert.equal(card.querySelector('figcaption').textContent, 'England · 3 sections, one per club');
  assert.deepEqual(view.errors, []);
});

test('world card: a theatre opening board in kick-off pastels over unclaimed land, framed on the teams or a focus', async t => {
  const box = (x, y) => ({ x, y, w: 10, h: 10 });
  const basePaths = {
    a: { d: 'M0,0h10v10h-10Z', bbox: box(0, 0) }, b: { d: 'M10,0h10v10h-10Z', bbox: box(10, 0) },
    c: { d: 'M90,90h10v10h-10Z', bbox: box(90, 90) }, n: { d: 'M50,50h10v10h-10Z', bbox: box(50, 50) }, gone: {},
  };
  const countries = ['n', 'a', 'b', 'c', 'gone'].map(id => ({ id }));
  // `c` is overseas land of `a`: painted in a's pastel, but only the starting land (`frameIds`) sets the frame.
  const own = { a: 'a', b: 'b', c: 'a' };
  const frameIds = ['a', 'b'];
  const preview = theatreMapPreview({ countries, basePaths, own, frameIds });
  assert.deepEqual(preview.sections.map(section => [section.id, section.fill]), [['a', empireFill('a')], ['b', empireFill('b')], ['c', empireFill('a')]]);
  assert.deepEqual(preview.backdrop, [{ id: 'n', d: 'M50,50h10v10h-10Z' }], 'unclaimed land is drawn; shapes without a path are not');
  assert.equal(preview.viewBox, '-0.8 -0.8 21.6 11.6', 'framed on the starting land, 4% margin');
  assert.equal(preview.teams, 2);
  assert.equal(theatreMapPreview({ countries, basePaths, own, frameIds }), preview, 'memoised per board, paths and focus');
  const focused = theatreMapPreview({ countries, basePaths, own, frameIds, focus: { x: 0, y: 0, w: 100, h: 50 } });
  assert.equal(focused.viewBox, '-4 -4 108 58', 'a focus (the European camera) wins over the starting land');
  const display = { a: { d: 'M0,0h5v5h-5Z', bbox: box(0, 0) } };
  assert.equal(theatreMapPreview({ countries, paths: display, basePaths, own, frameIds }).sections[0].d, 'M0,0h5v5h-5Z',
    'the display atlas draws a shape it has, the topology the rest');
  assert.equal(theatreMapPreview({ countries, basePaths, own: {}, frameIds: [] }), null, 'no held land, no card');
  assert.equal(theatreMapPreview(), null);

  const nations = await mount(t, { setup: { scope: 'UEFA' }, theatreMap: preview });
  const card = nations.q('.setup-step[data-step="1"] .setup-side > .setup-map[data-kind="world"]');
  assert.ok(card, 'every world theatre leads step 1 with its map');
  assert.equal(card.getAttribute('aria-hidden'), 'true');
  assert.equal(card.querySelector('svg').getAttribute('viewBox'), preview.viewBox);
  assert.equal(card.querySelectorAll('.setup-map__backdrop path').length, 1);
  assert.deepEqual([...card.querySelectorAll('.setup-map__sections path')].map(path => path.getAttribute('fill')),
    preview.sections.map(section => section.fill));
  assert.equal(card.querySelectorAll('[data-country], [role], [tabindex]').length, 0, 'never territory, never interactive');
  assert.equal(card.querySelector('figcaption').textContent, 'Europe · 2 nations, each on its own land');
  const clubs = await mount(t, { setup: { layer: 'clubs', clubScope: 'all' }, theatreMap: preview });
  assert.match(clubs.q('.setup-map figcaption').textContent, /^All Leagues · 2 clubs dealt onto the nearest free land$/i);
  const none = await mount(t, { setup: { scope: 'UEFA' }, theatreMap: null });
  assert.equal(none.q('.setup-map'), null, 'no card before App has a board');
  // A chosen country shows its own card, never a world board App may still hold while the country loads.
  const country = await mount(t, { setup: COUNTRY, theatreMap: preview, domestic: { state: 'loading', message: null, onRetry() {} } });
  assert.deepEqual(country.qa('.setup-map').map(element => element.dataset.kind), ['country']);
  assert.deepEqual([...nations.errors, ...clubs.errors, ...none.errors, ...country.errors], []);
});

test('a pressed segment keeps its white label on hover (Teams toggle, history kinds, squad view)', () => {
  const css = readFileSync(new URL('../src/styles/primitives.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The hover colour outranks the pressed rule, so it must skip the pressed segment or paint ink on the ink fill.
  assert.match(css, /\.segmented > button:hover:not\(:disabled\):not\(\[aria-pressed=true\]\):not\(\[aria-checked=true\]\) \{ color:var\(--ink\); \}/);
  assert.doesNotMatch(css, /\.segmented > button:hover:not\(:disabled\) \{/);
  assert.match(css, /\.segmented > button\[aria-pressed=true\], \.segmented > button\[aria-checked=true\] \{ background:var\(--ink\); color:var\(--on-ink\);/);
});
