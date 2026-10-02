// Exercise the production ticker with real React batching. A single browser
// tick can deliver scoring runs or penalties from both sides before a commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react'], loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const App = module.exports.default;

async function fixture() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  class FixtureApp extends App {
    componentDidMount() {} // These tests need no atlas, storage or network.
    componentDidUpdate() {}
    showPopup() {}
    showToast() {}
    render() { return React.createElement('div', null, `${this.state.match?.ga}:${this.state.match?.gd}`); }
  }
  let app;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(FixtureApp, { ref: value => { if (value) app = value; } })));
  await act(async () => app.setState({
    settings: { ...app.state.settings, sport: 'basketball' },
    teams: { A: { id: 'A', name: 'Attacker' }, D: { id: 'D', name: 'Defender' } },
    match: { aId: 'A', dId: 'D', effA: 75, effD: 75, ga: 0, gd: 0, shown: [], allEv: [], applied: false,
      tie: { A: [1, 0], D: [0, 1] }, tieShown: { A: [], D: [] } },
  }));
  return { app, async close() {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  } };
}

test('simultaneous scoring runs preserve every event and both scores', async () => {
  const f = await fixture();
  try {
    const events = [
      { m: 12, tid: 'A', name: 'First', pts: 2 },
      { m: 12, tid: 'D', name: 'Second', pts: 3 },
      { m: 12, tid: 'A', name: 'Third', pts: 1 },
    ];
    await act(async () => events.forEach(event => f.app.pushEvent(event)));
    assert.deepEqual(f.app.state.match.shown, events);
    assert.equal(f.app.state.match.ga, 3);
    assert.equal(f.app.state.match.gd, 3);
  } finally { await f.close(); }
});

test('batched penalty callbacks retain both sides and never append a nonexistent kick', async () => {
  const f = await fixture();
  try {
    await act(async () => ['A', 'D', 'A', 'D', 'A', 'D'].forEach(side => f.app.pushKick(side)));
    assert.deepEqual(f.app.state.match.tieShown, { A: [1, 0], D: [0, 1] });
  } finally { await f.close(); }
});

test('callbacks queued behind match completion cannot change its final score or kicks', async () => {
  const f = await fixture();
  try {
    await act(async () => {
      f.app.setState(state => ({ match: { ...state.match, ga: 84, gd: 81, applied: true } }));
      f.app.pushEvent({ m: 40, tid: 'A', name: 'Late callback', pts: 3 });
      f.app.pushKick('A');
    });
    assert.equal(f.app.state.match.ga, 84);
    assert.equal(f.app.state.match.gd, 81);
    assert.deepEqual(f.app.state.match.shown, []);
    assert.deepEqual(f.app.state.match.tieShown, { A: [], D: [] });
  } finally { await f.close(); }
});

test('penalty reveals respect the sampled first kicker and legacy saves default to attacker first', async () => {
  for (const first of ['A', 'D', undefined]) {
    const f = await fixture();
    try {
      const tasks = [];
      f.app.after = (ms, callback) => tasks.push({ ms, callback });
      await act(async () => f.app.setState(state => ({
        settings: { ...state.settings, sport: 'football' },
        match: { ...state.match, tie: { ...state.match.tie, first }, tieShown: null },
      })));
      f.app.presentMatch();
      assert.equal(tasks.length, 1, 'the regulation whistle is scheduled before penalty reveals');
      await act(async () => tasks.shift().callback());
      tasks.sort((a, b) => a.ms - b.ms);
      assert.equal(tasks[0].ms, 350);
      assert.equal(tasks[1].ms, 600);
      await act(async () => tasks.shift().callback());
      const firstSide = first === 'D' ? 'D' : 'A';
      const secondSide = firstSide === 'A' ? 'D' : 'A';
      assert.equal(f.app.state.match.tieShown[firstSide].length, 1);
      assert.equal(f.app.state.match.tieShown[secondSide].length, 0);
      await act(async () => tasks.shift().callback());
      assert.equal(f.app.state.match.tieShown[secondSide].length, 1);
    } finally { await f.close(); }
  }
});

test('resuming between shootout kicks reveals the pending opponent reply before the next round', async () => {
  const cases = [
    { first: 'A', A: [1, 0], D: [0, 1], expected: ['D', 'A', 'D'] },
    { first: 'D', A: [1, 0], D: [0, 1], expected: ['A', 'D', 'A'] },
    { first: 'A', A: [1, 1, 1], D: [0, 0], expected: ['D', 'A', 'D', 'A'] },
    { first: 'D', A: [0, 0], D: [1, 1, 1], expected: ['A', 'D', 'A', 'D'] },
  ];
  for (const scenario of cases) {
    const { first, expected } = scenario;
    const f = await fixture();
    try {
      const tasks = [], observed = [];
      const second = first === 'A' ? 'D' : 'A';
      const shown = { A: [], D: [] };
      shown[first] = [scenario[first][0]];
      f.app.after = (ms, callback) => tasks.push({ ms, callback });
      let finished = 0;
      f.app.finishMatch = () => { finished++; };
      const pushKick = f.app.pushKick.bind(f.app);
      f.app.pushKick = side => { observed.push(side); pushKick(side); };
      await act(async () => f.app.setState(state => ({
        settings: { ...state.settings, sport: 'football' },
        match: { ...state.match, tie: { A: scenario.A, D: scenario.D, first }, tieShown: shown },
      })));
      f.app.presentMatch();
      await act(async () => tasks.shift().callback());
      tasks.sort((a, b) => a.ms - b.ms);
      assert.deepEqual(tasks.slice(0, 3).map(task => task.ms), [350, 600, 850]);
      await act(async () => tasks.shift().callback());
      assert.deepEqual(observed, [second]);
      assert.equal(f.app.state.match.tieShown.A.length, 1);
      assert.equal(f.app.state.match.tieShown.D.length, 1);
      await act(async () => tasks.shift().callback());
      assert.deepEqual(observed, [second, first]);
      assert.equal(f.app.state.match.tieShown[first].length, 2);
      assert.equal(f.app.state.match.tieShown[second].length, 1);
      assert.equal(finished, 0);
      for (const task of tasks) await act(async () => task.callback());
      assert.deepEqual(observed, expected);
      assert.deepEqual(f.app.state.match.tieShown, { A: scenario.A, D: scenario.D });
      assert.equal(finished, 1, 'the resumed match completes once, after every remaining kick');
    } finally { await f.close(); }
  }
});
