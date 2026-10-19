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
  TURN_ORDER_CARDS, buildSetupModel, campaignPreview as modelPreview, frontRelation, rulesOf, summaryOf, theatreRow, tierOf,
} from '../src/screens/setup/setupModel.js';
import { SCOPES } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';

const compiled = await build({
  stdin: { contents: `
    export {default as SetupOverlay, PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS, campaignPreview} from './src/components/SetupOverlay.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SetupOverlay, PACING_OPTIONS, PACING_HELP, RESOLUTION_OPTIONS, campaignPreview } = module.exports;

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
  assert.match(pick.textContent, /Favourite/);
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
  assert.deepEqual([1, 4, 5, 12, 13, 30, 31].map(tierOf), ['Favourite', 'Favourite', 'Contender', 'Contender', 'Outsider', 'Outsider', 'Long shot']);

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
