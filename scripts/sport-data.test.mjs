// The page's sport data (src/sports/sportData.js): football's players come with the first download and every other
// sport's in a chunk of its own, loaded the first time it is played. Node, and so every other test, has every sport's
// players from the start (sportData.eager.js), and the smoke run bundles without splitting, so there every chunk
// "arrives" within a microtask. These tests run the page's path: the real App, React and storage, with loaders that wait
// until the test lets them arrive or fail (scripts/lib/sport-data-control.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { SPORT_LIST, getSport } from '../src/sports/index.js';
import { EAGER, LOADERS } from '../src/sports/sportData.eager.js';
import * as lazy from '../src/sports/sportData.lazy.js';
import { SPORT_NOTES, sportNote } from '../src/screens/setup/setupModel.js';
import { buildTeam, makeRng } from '../src/data/teams.js';
import { CAMPAIGN_BACKUP_KEY, CAMPAIGN_DAMAGED_KEY, createCampaignId, parseCampaign, writeSave } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const IDS = SPORT_LIST.map(sport => sport.id);
const LAZY_IDS = IDS.filter(id => id !== 'football');

// ---------- what each environment holds ----------

test('Node has every sport\'s players at once; the page has football\'s and a loader for each other sport', async () => {
  assert.deepEqual(Object.keys(EAGER).sort(), [...IDS].sort());
  assert.deepEqual(LOADERS, {});
  assert.deepEqual(Object.keys(lazy.EAGER), ['football']);
  assert.deepEqual(Object.keys(lazy.LOADERS).sort(), [...LAZY_IDS].sort());
  for (const key of ['rosters', 'clubs']) assert.equal(lazy.EAGER.football[key], EAGER.football[key], key);
  for (const [id, load] of Object.entries(lazy.LOADERS)) {
    const players = await load();
    // The very objects Node reads (one module instance each): both paths play the same players.
    assert.deepEqual(Object.keys(players).sort(), Object.keys(EAGER[id]).sort(), id);
    for (const key of Object.keys(players)) assert.equal(players[key], EAGER[id][key], `${id} ${key}`);
  }
});

test('the sport cards say what each sport holds without its players: SPORT_NOTES is each sport\'s sportNote', () => {
  assert.deepEqual(Object.keys(SPORT_NOTES).sort(), [...IDS].sort());
  for (const sport of SPORT_LIST) {
    assert.equal(SPORT_NOTES[sport.id], sportNote(sport), `${sport.id}'s clubs changed: SPORT_NOTES must follow sportNote`);
  }
});

test('the first download holds football\'s players and no other sport\'s, and each other sport\'s are one chunk', async () => {
  const result = await build({
    absWorkingDir: ROOT, entryPoints: ['src/main.jsx'], bundle: true, splitting: true, format: 'esm', platform: 'browser',
    outdir: 'dist-sport-data-check', write: false, metafile: true, jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty' },
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.PROD': 'false' },
  });
  const outputs = Object.values(result.metafile.outputs);
  const playersIn = output => Object.keys(output.inputs).filter(input => /^src\/data\/(rosters(\.[a-z-]+)?|clubs\.[a-z-]+)\.js$/.test(input)).sort();
  const entry = outputs.find(output => output.entryPoint === 'src/main.jsx');
  assert.deepEqual(playersIn(entry), ['src/data/clubs.football.js', 'src/data/rosters.js']);
  const seen = new Set(playersIn(entry));
  for (const id of LAZY_IDS) {
    const chunks = outputs.filter(output => output.entryPoint === `src/data/players/${id}.js`);
    assert.equal(chunks.length, 1, `${id}: one chunk`);
    const source = await readFile(path.join(ROOT, `src/data/players/${id}.js`), 'utf8');
    const own = [...source.matchAll(/from '\.\.\/([a-z.-]+\.js)'/g)].map(([, file]) => `src/data/${file}`).sort();
    assert.ok(own.length > 0, id);
    assert.deepEqual(playersIn(chunks[0]), own, `${id}: its own rosters and clubs`);
    for (const input of own) {
      assert.ok(!seen.has(input), `${input} is in one output only`);
      seen.add(input);
    }
  }
  assert.equal(outputs.filter(output => playersIn(output).length).length, LAZY_IDS.length + 1, 'no other output holds players');
});

// ---------- the page's path ----------

const CONTROL = path.join(ROOT, 'scripts', 'lib', 'sport-data-control.mjs');
const PAGE = await build({
  absWorkingDir: ROOT,
  stdin: { contents: `
    export { default as App } from './src/App.jsx';
    export * as control from './scripts/lib/sport-data-control.mjs';
    export * as sportData from './src/sports/sportData.js';
    export * as storage from './src/engine/storage.js';
    export { getSport } from './src/sports/index.js';
  `, resolveDir: ROOT, loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
  plugins: [{ name: 'page-sport-data', setup(builder) { builder.onResolve({ filter: /^#sport-data$/ }, () => ({ path: CONTROL })); } }],
});

/** A fresh copy of the page's modules: football has its players, no other sport has yet. */
function page() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', PAGE.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

/** A Map-backed localStorage as the global, for `run`; resolves to what `run` resolves to. */
async function withStorage(items, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key), key: index => [...items.keys()][index] ?? null, get length() { return items.size; } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return await run(storage); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}

/** A campaign in mid-play, as App saves it. */
function campaignOf(sport, ids, name) {
  const rng = makeRng(7), teams = Object.fromEntries(ids.map(id => [id, buildTeam(id, rng, getSport(sport))]));
  return { phase: 'playing', settings: { sport, layer: 'nations', scope: 'world', pacing: 'duel', resolution: 'ticker', role: 'spectator' },
    teams, own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), fallen: [], stats: {},
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 7, rngState: rng.getState(), campaignId: createCampaignId(),
    revision: 0, campaignName: name, metrics: { acquisitions: [], leaderChanges: 0 },
    match: null, spin: null, choice: null, series: null, tacticalChoice: null };
}

/** The storage a page leaves behind after saving a hockey campaign (written in Node, the same bytes the page writes). */
async function savedHockey() {
  const items = new Map(), campaign = campaignOf('hockey', ['124', '840'], 'Hockey campaign');
  await withStorage(items, () => assert.equal(writeSave(campaign).ok, true));
  return { items, id: campaign.campaignId, text: items.get(SAVE_KEY) };
}

test('on the page a sport\'s players are read only once loaded; they load once, and a failed load is tried again', async () => {
  const { sportData, getSport: sportOf, control } = page();
  const hockey = sportOf('hockey');
  assert.ok(Object.keys(sportOf('football').rosters).length > 100, 'football comes with the page');
  assert.throws(() => hockey.rosters, /The hockey players have not loaded yet/);
  assert.throws(() => hockey.clubs, /The hockey players have not loaded yet/);
  assert.throws(() => sportOf('tennis').territory, /The tennis players have not loaded yet/, 'a territory worked out from the players');
  assert.deepEqual(hockey.territory.inactive, [], 'a territory written out needs none');
  const first = sportData.loadSportData('hockey'), again = sportData.loadSportData('hockey');
  assert.deepEqual(control.requested(), ['hockey'], 'one request for both');
  control.fail('hockey');
  await assert.rejects(first, /dynamically imported module/);
  await assert.rejects(again, /dynamically imported module/);
  assert.equal(sportData.sportDataLoaded('hockey'), false);
  assert.throws(() => hockey.rosters, /not loaded yet/, 'a failed load leaves nothing half read');
  const retry = sportData.loadSportData('hockey');
  assert.deepEqual(control.requested(), ['hockey', 'hockey'], 'a failed load is asked for again');
  control.release('hockey');
  await retry;
  assert.equal(sportData.sportDataLoaded('hockey'), true);
  assert.deepEqual(Object.keys(hockey.rosters), Object.keys(EAGER.hockey.rosters));
  assert.deepEqual(hockey.clubs.map(club => club.id), EAGER.hockey.clubs.map(club => club.id));
  await assert.rejects(sportData.loadSportData('curling'), /Unknown sport "curling"/);
  let runs = 0;
  assert.equal(sportData.withSportData(['hockey', 'football'], () => ++runs), 1, 'nothing to load: at once');
  const later = sportData.withSportData(['tennis', 'tennis'], () => ++runs);
  assert.equal(runs, 1);
  control.release('tennis');
  assert.equal(await later, 2);
  assert.ok(sportOf('tennis').territory.inactive.length > 0);
});

test('saves of a sport whose players have not loaded list and stay put, and read whole once those players are here', async () => {
  const { items, id, text } = await savedHockey();
  const expected = await withStorage(new Map([[SAVE_KEY, text]]), () => parseCampaign(text));
  const { storage, control, getSport: sportOf } = page();
  await withStorage(items, async () => {
    assert.equal(storage.sportOfText(text), 'hockey');
    assert.equal(storage.sportOfText('not a campaign'), null);
    assert.equal(storage.campaignSport(id), 'hockey');
    assert.deepEqual(storage.listCampaigns().map(item => [item.id, item.name, item.settings.sport, !!item.damaged]),
      [[id, 'Hockey campaign', 'hockey', false]], 'listed for what it is, not as damaged');
    const pointer = storage.inspectSave();
    assert.equal(pointer.state, 'unloaded');
    assert.equal(pointer.sport, 'hockey');
    assert.equal(pointer.summary.campaignId, id);
    assert.equal(storage.inspectCampaign(id).state, 'unloaded');
    // Another campaign started on this page moves the hockey pointer to its recovery copy, as any other: never to the
    // damaged bytes.
    const football = campaignOf('football', ['250', '276'], 'Football campaign');
    assert.equal(storage.writeSave(football).ok, true);
    assert.equal(items.get(CAMPAIGN_BACKUP_KEY), text);
    assert.equal(items.has(CAMPAIGN_DAMAGED_KEY), false);
    assert.deepEqual(storage.listCampaigns().map(item => item.name).sort(), ['Football campaign', 'Hockey campaign']);
    assert.equal(control.requested().length, 0, 'none of that loads the hockey players');
    assert.equal(storage.deleteCampaign(id).ok, true);
    assert.deepEqual(storage.listCampaigns().map(item => item.name), ['Football campaign']);
    assert.throws(() => sportOf('hockey').rosters, /not loaded yet/, 'and none of it read the hockey players');
  });
  // The pointer as boot read it is read whole from the same parse once the players are here: what Node reads.
  const fresh = page();
  await withStorage(new Map([[SAVE_KEY, text]]), async () => {
    const pointer = fresh.storage.inspectSave();
    assert.equal(pointer.state, 'unloaded');
    const load = fresh.sportData.loadSportData('hockey');
    fresh.control.release('hockey');
    await load;
    const ready = pointer.read();
    assert.equal(ready.state, 'ready');
    assert.deepEqual(ready.campaign, expected);
  });
});

// ---------- the real App on the page's path ----------

const mapText = readFile(path.join(ROOT, 'public', 'world-110m.v1.json'), 'utf8');

/**
 * The page's fetch: the 110m rules map from public/. Everything else is a 404: without the 50m atlas the page draws the
 * rules map, and without the season index it lists the built-in seasons.
 */
async function servePublic(url) {
  const rel = decodeURIComponent(new URL(String(url), 'http://localhost/').pathname).replace(/^\/+/, '');
  const body = rel === 'world-110m.v1.json' ? await mapText : null;
  const status = body == null ? 404 : 200;
  return { ok: status === 200, status, url: String(url), text: async () => body ?? '',
    json: async () => { if (body == null) throw new SyntaxError(`HTTP ${status} for ${url}`); return JSON.parse(body); } };
}

const GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'Node',
  'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle'];

/** Open the page at `url` with `items` in its storage: the real App, booting on the page's sport data. */
async function openPage({ url = 'http://localhost/', items = new Map() } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const [key, value] of items) window.localStorage.setItem(key, value);
  window.fetch = servePublic;
  const saved = new Map([...GLOBALS, 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of GLOBALS) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const modules = page();
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('root'));
  let app = null;
  root.render(React.createElement(modules.App, { ref: instance => { app = instance; } }));
  const view = {
    ...modules, window, document: window.document,
    get app() { return app; },
    card: id => window.document.querySelector(`[aria-describedby="setup-sport-${id}-note"]`),
    step: () => window.document.querySelector('.setup-overlay')?.dataset.step,
    next: () => window.document.querySelector('.setup-step[data-step="1"] .setup-foot__next'),
    note: () => window.document.querySelector('.setup-step[data-step="1"] .setup-foot__note')?.textContent || '',
    space() { window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); },
    arrow(element) { element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); },
    async close() {
      root.unmount();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
      window.close();
    },
  };
  await until(() => app, 'the App mounts');
  return view;
}

/** Resolves once `check()` is truthy (React commits on its own schedule here); fails after `timeout` ms. */
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  for (;;) {
    let value = false;
    try { value = check(); } catch { /* not yet */ }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const setUp = view => until(() => view.document.querySelector('.setup-overlay') && view.card('football'), 'setup is up');

test('a first visit sets up football without any other sport\'s players, and every card still says what it holds', async () => {
  const view = await openPage();
  try {
    await setUp(view);
    assert.deepEqual(view.control.requested(), [], 'no other sport\'s players are asked for');
    for (const sport of SPORT_LIST) {
      assert.equal(view.document.getElementById(`setup-sport-${sport.id}-note`).textContent, SPORT_NOTES[sport.id], sport.id);
    }
    assert.equal(view.card('football').getAttribute('aria-checked'), 'true');
  } finally { await view.close(); }
});

test('a sport picked before its players arrive shows as picked, holds the steps and Launch, and is set up once they do', async () => {
  const view = await openPage();
  try {
    await setUp(view);
    view.card('hockey').click();
    await until(() => view.card('hockey').getAttribute('aria-busy') === 'true', 'the hockey card is busy');
    assert.equal(view.card('hockey').getAttribute('aria-checked'), 'true');
    assert.equal(view.card('football').getAttribute('aria-checked'), 'false');
    assert.deepEqual(view.control.requested(), ['hockey']);
    assert.equal(view.app.state.setup.sport, 'football', 'setup keeps football until the hockey players are here');
    assert.equal(view.next().disabled, true);
    assert.match(view.note(), /Loading Ice hockey…/);
    view.space();
    view.document.querySelector('.setup-rail__step[aria-controls="setup-step-role"]').click();
    await pause(30);
    assert.equal(view.step(), '1', 'neither Space nor the rail leaves the first step');
    view.app.launchCampaign();
    await pause(30);
    assert.equal(view.app.state.phase, 'setup', 'Launch waits');
    view.control.release('hockey');
    await until(() => view.app.state.setup.sport === 'hockey', 'hockey is set up');
    await until(() => !view.card('hockey').hasAttribute('aria-busy') && !view.next().disabled, 'the steps open');
    assert.equal(view.document.getElementById('setup-sport-hockey-note').textContent, SPORT_NOTES.hockey);
    view.next().click();
    await until(() => view.step() === '2', 'Next moves on');
  } finally { await view.close(); }
});

test('the latest pick wins: picking the sport set up again drops the wait, and its team stays picked', async () => {
  const view = await openPage();
  try {
    await setUp(view);
    view.app.pickSetup('managedTeamId', '250');
    await until(() => view.app.state.setup.managedTeamId === '250', 'France is picked');
    view.card('hockey').click();
    await until(() => view.card('hockey').getAttribute('aria-checked') === 'true', 'hockey shows as picked');
    view.card('football').click();
    await until(() => view.card('football').getAttribute('aria-checked') === 'true' && !view.next().disabled, 'football again');
    view.control.release('hockey');
    await pause(30);
    assert.equal(view.app.state.setup.sport, 'football', 'the late hockey players do not win');
    assert.equal(view.app.state.setup.managedTeamId, '250', 'the team stays picked');
    assert.equal(view.card('hockey').getAttribute('aria-checked'), 'false');
  } finally { await view.close(); }
});

test('arrow keys through the sport cards load only the first one passed and the one the player stays on', async () => {
  const view = await openPage();
  try {
    await setUp(view);
    const order = ['womens-football', 'basketball', 'american-football'];
    let from = view.card('football');
    for (const id of order) {
      from.focus();
      view.arrow(from);
      await until(() => view.card(id).getAttribute('aria-checked') === 'true', `${id} shows as picked`);
      from = view.card(id);
    }
    assert.deepEqual(view.control.requested(), ['womens-football'], 'a pick made while another loads waits a moment');
    await until(() => view.control.requested().length === 2, 'the last pick loads');
    assert.deepEqual(view.control.requested(), ['womens-football', 'american-football']);
    view.control.release('womens-football');
    await pause(30);
    assert.equal(view.app.state.setup.sport, 'football', 'a pick passed over never applies');
    view.control.release('american-football');
    await until(() => view.app.state.setup.sport === 'american-football', 'the last pick applies');
  } finally { await view.close(); }
});

test('a sport whose players will not load says so, offers Retry and Reload, and keeps the steps held', async () => {
  const view = await openPage();
  try {
    await setUp(view);
    view.card('hockey').click();
    await until(() => view.control.requested().length === 1, 'hockey is asked for');
    view.control.fail('hockey');
    const alert = await until(() => view.document.querySelector('.setup-sport__error'), 'the error shows');
    assert.match(alert.textContent, /Ice hockey could not be loaded\. Failed to fetch dynamically imported module/);
    assert.deepEqual([...alert.querySelectorAll('button')].map(button => button.textContent), ['Retry', 'Reload']);
    assert.equal(view.next().disabled, true);
    assert.equal(view.card('hockey').getAttribute('aria-checked'), 'true');
    assert.equal(view.card('hockey').hasAttribute('aria-busy'), false);
    assert.equal(view.app.state.setup.sport, 'football');
    alert.querySelector('button').click();
    await until(() => view.control.requested().length === 2, 'Retry asks again');
    view.control.release('hockey');
    await until(() => view.app.state.setup.sport === 'hockey' && !view.document.querySelector('.setup-sport__error'), 'hockey is set up');
  } finally { await view.close(); }
});

test('a challenge link to another sport loads its players with the maps, and setup opens on it', async () => {
  const view = await openPage({ url: 'http://localhost/?sport=hockey&theatre=world&role=manager&team=124&seed=7' });
  try {
    await until(() => view.app.geo, 'the rules map is in');
    assert.deepEqual(view.control.requested(), ['hockey']);
    await pause(30);
    assert.ok(view.document.querySelector('.loading-screen'), 'setup waits for the link\'s sport');
    view.control.release('hockey');
    await setUp(view);
    assert.equal(view.app.state.setup.sport, 'hockey');
    assert.equal(view.app.state.setup.managedTeamId, '124');
    assert.equal(view.card('hockey').getAttribute('aria-checked'), 'true');
    assert.ok(view.document.querySelector('.setup-challenge'));
  } finally { await view.close(); }
});

test('a challenge link whose sport will not load stops at boot with Try again and Reload', async () => {
  const view = await openPage({ url: 'http://localhost/?sport=hockey' });
  try {
    await until(() => view.control.requested().length === 1, 'hockey is asked for');
    view.control.fail('hockey');
    const screen = await until(() => view.document.querySelector('.loading-screen[role="alert"]'), 'the error');
    assert.match(screen.textContent, /GAME DATA FAILED TO LOAD — Ice hockey could not be loaded\./);
    const buttons = [...screen.querySelectorAll('button')];
    assert.deepEqual(buttons.map(button => button.textContent), ['Try again', 'Reload']);
    buttons[0].click();
    await until(() => view.control.requested().length === 2, 'Try again asks again');
    view.control.release('hockey');
    await setUp(view);
    assert.equal(view.app.state.setup.sport, 'hockey');
  } finally { await view.close(); }
});

test('a quick-resume campaign of another sport is read once its players arrive at boot, and resumes', async () => {
  const { items } = await savedHockey();
  const view = await openPage({ items });
  try {
    await until(() => view.control.requested().length === 1, 'hockey is asked for');
    assert.deepEqual(view.control.requested(), ['hockey']);
    view.control.release('hockey');
    await setUp(view);
    assert.equal(view.app.state.setup.sport, 'football', 'setup itself stays a new football campaign');
    const resume = await until(() => view.document.querySelector('.setup-save__resume'), 'Resume shows');
    assert.match(view.document.querySelector('.setup-save__text').textContent, /Round 1/);
    resume.click();
    await until(() => view.app.state.phase === 'playing', 'the campaign resumes');
    assert.equal(view.app.state.settings.sport, 'hockey');
    assert.deepEqual(Object.keys(view.app.state.teams).sort(), ['124', '840']);
  } finally { await view.close(); }
});

test('a quick-resume campaign whose players will not load leaves setup up without it, and says why', async () => {
  const { items } = await savedHockey();
  const view = await openPage({ items });
  try {
    await until(() => view.control.requested().length === 1, 'hockey is asked for');
    view.control.fail('hockey');
    await setUp(view);
    assert.equal(view.app.state.hasSave, false);
    assert.ok(!view.document.querySelector('.setup-save__resume'));
    assert.match(view.app.state.saveStatus.message, /Your saved campaign could not be opened\. The Ice hockey players could not be loaded/);
  } finally { await view.close(); }
});

test('Saved campaigns opens a campaign of another sport once its players are here', async () => {
  const { items } = await savedHockey();
  items.delete(SAVE_KEY);
  const view = await openPage({ items });
  try {
    await setUp(view);
    assert.deepEqual(view.control.requested(), []);
    view.app.openStorageDialog('slots');
    const resume = await until(() => [...view.document.querySelectorAll('.campaign-storage-slot-actions button')]
      .find(button => button.textContent === 'Resume Hockey campaign'), 'the slot is listed');
    resume.click();
    await until(() => /Loading Ice hockey…/.test(view.document.querySelector('.campaign-storage-busy')?.textContent || ''), 'the wait shows');
    view.control.release('hockey');
    await until(() => view.app.state.phase === 'playing', 'the campaign resumes');
    assert.equal(view.app.state.settings.sport, 'hockey');
  } finally { await view.close(); }
});

test('importing a campaign of another sport reads it once its players are here', async () => {
  const { text } = await savedHockey();
  const view = await openPage();
  try {
    await setUp(view);
    const imported = view.app.importProgress({ size: text.length, text: async () => text });
    await until(() => view.control.requested().length === 1, 'hockey is asked for');
    assert.equal(view.app.state.storageDialog, null);
    view.control.release('hockey');
    await imported;
    await until(() => view.app.state.storageDialog?.mode === 'import' || view.app.state.saveStatus?.ok === false,
      'the import dialog opens');
    assert.equal(view.app.state.storageDialog?.mode, 'import', view.app.state.saveStatus?.message);
    assert.equal(view.app.state.storageDialog.campaign.settings.sport, 'hockey');
  } finally { await view.close(); }
});
