import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { contents: `
    export {default as Sidebar} from './src/components/Sidebar.jsx';
    export {default as WorldMap} from './src/components/WorldMap.jsx';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Sidebar, WorldMap } = module.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

async function mount(Component, props, context) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const view = {
    host,
    async render(nextProps) { await act(async () => root.render(React.createElement(Component, nextProps))); },
    async close() { await act(async () => root.unmount()); host.remove(); },
  };
  context.after(() => view.close());
  await view.render(props);
  return view;
}

const fixtures = [
  { id: 'm1', round: 1, aId: 'a', bId: 'b', a: { teamId: 'a', name: 'Alfa', code: 'ALF', score: 2 }, b: { teamId: 'b', name: 'Beta', code: 'BET', score: 1 } },
  { id: 'm2', round: 2, aId: 'c', bId: 'd', a: { teamId: 'c', name: 'Gamma', code: 'GAM', score: 0 }, b: { teamId: 'd', name: 'Delta', code: 'DEL', score: 1 } },
  { id: 'm3', round: 3, aId: 'a', bId: 'e', a: { teamId: 'a', name: 'Alfa', code: 'ALF', score: 3 }, b: { teamId: 'e', name: 'Echo', code: 'ECH', score: 1 } },
];
const teams = [{ id: 'a', name: 'Alfa' }, { id: 'c', name: 'Gamma' }, { id: 'z', name: 'Zulu' }];
async function chooseFilter(view, value) {
  await act(async () => {
    const select = view.host.querySelector('#history-team');
    select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

test('filter changes replace unrelated history reports and clear empty selections', async context => {
  const selected = [];
  function Details() {
    const [id, setId] = useState('m2');
    const [filter, setFilter] = useState('');
    return React.createElement(Sidebar, {
      tab: 'history', history: fixtures, historyTeams: teams,
      selectedHistory: fixtures.find(entry => entry.id === id), historyFilter: filter, onHistoryFilter: setFilter,
      onHistorySelect: next => { selected.push(next); setId(next); },
    });
  }
  const view = await mount(Details, {}, context);
  assert.match(view.host.querySelector('.fi-history .fi-match').textContent, /Gamma/);
  await chooseFilter(view, 'a');
  assert.equal(selected.at(-1), 'm3');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm3');
  assert.match(view.host.querySelector('.fi-history .fi-match').textContent, /Echo/);
  assert.doesNotMatch(view.host.querySelector('.fi-history .fi-match').textContent, /Gamma/);
  await chooseFilter(view, 'z');
  assert.equal(selected.at(-1), null);
  assert.equal(view.host.querySelector('.fi-history .fi-match'), null);
  assert.match(view.host.querySelector('.fi-history').textContent, /No matches for this team/);
});

test('history filters and selected reports survive squad inspection, Escape and other tabs', async context => {
  function Details() {
    const [tab, setTab] = useState('history');
    const [id, setId] = useState('m3');
    const [filter, setFilter] = useState('');
    const [team, setTeam] = useState(null);
    return React.createElement(Sidebar, {
      tab, onTab: setTab, history: fixtures, historyTeams: teams,
      selectedHistory: fixtures.find(entry => entry.id === id), historyFilter: filter, onHistoryFilter: setFilter, onHistorySelect: setId,
      squad: team ? { teamId: team, name: 'Alfa', code: 'ALF', players: [], territories: 1, conquests: 0, stolen: 0, eff: '80', avg: '80', status: 'ALIVE' } : null,
      onSelectTeam: next => { setTeam(next); setTab('squad'); },
    });
  }
  const view = await mount(Details, {}, context);
  await chooseFilter(view, 'a');
  await act(async () => view.host.querySelector('[data-history-id="m1"]').click());
  await act(async () => view.host.querySelector('.fi-history [aria-label="View Alfa squad"]').click());
  assert.equal(view.host.querySelector('.fi-squad-back').textContent, 'Back to history');
  await act(async () => view.host.querySelector('[role="tabpanel"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(view.host.querySelector('#history-team').value, 'a');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1');
  assert.equal(document.activeElement.dataset.historyId, 'm1');
  await act(async () => view.host.querySelector('#intel-tab-power').click());
  await act(async () => view.host.querySelector('#intel-tab-history').click());
  assert.equal(view.host.querySelector('#history-team').value, 'a');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1');
});

test('local history state also persists when a caller omits controlled filter props', async context => {
  function Details() {
    const [tab, setTab] = useState('history');
    return React.createElement(Sidebar, { tab, onTab: setTab, history: fixtures, historyTeams: teams });
  }
  const view = await mount(Details, {}, context);
  await chooseFilter(view, 'a');
  await act(async () => view.host.querySelector('[data-history-id="m1"]').click());
  await act(async () => view.host.querySelector('#intel-tab-power').click());
  await act(async () => view.host.querySelector('#intel-tab-history').click());
  assert.equal(view.host.querySelector('#history-team').value, 'a');
  assert.equal(view.host.querySelector('.fi-history-list [aria-pressed="true"]').dataset.historyId, 'm1');
});

test('managed identity stays pinned while following remains independent', async context => {
  const followed = [];
  const view = await mount(Sidebar, { managed: { id: 'a', name: 'Alfa', alive: true },
    followed: { id: 'c', name: 'Gamma', alive: true }, historyTeams: teams, onFollow: id => followed.push(id),
  }, context);
  assert.match(view.host.querySelector('[aria-label="Managed team"]').textContent, /Alfa/);
  assert.equal(view.host.querySelector('[aria-label="Managed team"] select'), null);
  const selector = view.host.querySelector('#followed-team');
  await act(async () => { selector.value = 'a'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.deepEqual(followed, ['a']);
  assert.match(view.host.querySelector('[aria-label="Managed team"]').textContent, /Alfa/);
});

const mapProps = () => ({ countries: [], flagPatterns: [], graticule: { d: '' }, homes: [], battleMarks: [], labels: [], ownership: {}, tooltip: {}, playing: true, svgRef: React.createRef(), onPointerMove() {}, viewResetKey: 'world' });
const viewBox = view => view.host.querySelector('svg.political-map').getAttribute('viewBox').split(' ').map(Number);

test('explicit conquests zoom in and Back restores the prior exploration camera and keyboard focus', async context => {
  const props = mapProps();
  const view = await mount(WorldMap, props, context);
  await act(async () => view.host.querySelector('[aria-label="Zoom in"]').click());
  const previous = viewBox(view);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 1 });
  assert.ok(viewBox(view)[2] < previous[2]);
  // A second conquest still returns to the camera from before inspection began.
  await view.render({ ...props, focusBounds: { x: 650, y: 200, w: 60, h: 45 }, focusKey: 2 });
  await act(async () => view.host.querySelector('.map-return').click());
  assert.deepEqual(viewBox(view), previous);
  assert.equal(view.host.querySelector('.map-return'), null);
  assert.equal(document.activeElement, view.host.querySelector('[aria-label="Zoom in"]'));
});

test('resetting or changing theatres discards the obsolete conquest return camera', async context => {
  const props = mapProps();
  const view = await mount(WorldMap, props, context);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 1 });
  assert.ok(view.host.querySelector('.map-return'));
  await act(async () => view.host.querySelector('[aria-label="Reset view"]').click());
  assert.equal(view.host.querySelector('.map-return'), null);
  await view.render({ ...props, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 2 });
  assert.ok(view.host.querySelector('.map-return'));
  await view.render({ ...props, viewResetKey: 'europe', initialFocus: { x: 400, y: 150, w: 100, h: 80 }, focusBounds: { x: 440, y: 260, w: 30, h: 20 }, focusKey: 2 });
  assert.equal(view.host.querySelector('.map-return'), null);
});
