// Exercise real App state, React commits and SVG presentation with a tiny atlas.
// Timers and frames are controlled independently to reproduce background/race
// behavior without sleeps, network access or a seeded full campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { unstable_batchedUpdates } from 'react-dom';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { buildTeam, makeRng } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react'], loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports);
const App = module.exports.default;

function controlledClock() {
  let now = 0, nextId = 1;
  const timers = new Map(), frames = new Map();
  const timerHistory = [], frameHistory = [];
  const clock = {
    timers, frames, timerHistory, frameHistory,
    get now() { return now; },
    setTimeout(callback, delay = 0, ...args) {
      const entry = { id: nextId++, at: now + Number(delay), delay: Number(delay), callback: () => callback(...args) };
      timers.set(entry.id, entry);
      timerHistory.push(entry);
      return entry.id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      const entry = { id: nextId++, callback };
      frames.set(entry.id, entry);
      frameHistory.push(entry);
      return entry.id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    async frame() {
      const entry = frames.values().next().value;
      assert.ok(entry, 'a requested animation frame is pending');
      frames.delete(entry.id);
      await act(async () => entry.callback(now));
      return entry;
    },
    async tick(ms) {
      const end = now + ms;
      let runs = 0;
      for (;;) {
        const next = [...timers.values()].filter(entry => entry.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        assert.ok(++runs < 100, 'timer loop is bounded');
        now = next.at;
        timers.delete(next.id);
        await act(async () => next.callback());
      }
      now = end;
    },
  };
  return clock;
}

function tinyAtlas() {
  const points = { '250': [150, 130, 100], '276': [500, 240, 30], '826': [410, 240, 10] };
  const paths = Object.fromEntries(Object.entries(points).map(([id, [cx, cy, area]]) => [id, {
    cx, cy, area, labelX: cx, labelY: cy,
    d: `M${cx - 25},${cy - 20}h50v40h-50Z`,
    bbox: { x: cx - 25, y: cy - 20, w: 50, h: 40 },
    labelRings: [[[cx - 25, cy - 20], [cx + 25, cy - 20], [cx + 25, cy + 20], [cx - 25, cy + 20]]],
  }]));
  return { paths, countries: Object.keys(paths).map(id => ({ id })), adj: {},
    graticule: { d: '', labels: [] }, fit: { s: 1, tx: 0, ty: 0 }, kmPerUnit: 1 };
}

async function fixture({ speed = 1, reducedMotion = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const clock = controlledClock();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame,
  };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.matchMedia = query => ({ matches: reducedMotion && query.includes('prefers-reduced-motion'), media: query,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  dom.window.SVGElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 });
  const sport = getSport('football');
  const teamRng = makeRng(1209);
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, teamRng, sport)]));
  let rngCalls = 0;
  class FixtureApp extends App {
    constructor(props) {
      super(props);
      this.geo = tinyAtlas();
      this.labelGeometry = [];
      this.kickoffs = [];
      this.rng = () => { rngCalls++; return [0, 0, .8][(rngCalls - 1) % 3]; };
      this.state = { ...this.state, phase: 'playing', speed, teams,
        own: { '250': '250', '826': '250', '276': '276' }, aliveIds: ['250', '276'],
        settings: { ...this.state.settings, sport: 'football', pacing: 'duel', scope: 'UEFA' } };
    }
    boot() {} // Avoid network; every draw/state/render method is production code.
    startMatch(attackerId, targetId) {
      this.clearDraw();
      this.kickoffs.push({ attackerId, targetId, at: clock.now });
      this.setState({ spin: null, match: {
        aId: attackerId, dId: targetId, effA: 80, effD: 80, ga: 0, gd: 0,
        shown: [], allEv: [], tie: null, tieShown: null, winner: attackerId,
        finalGa: 1, finalGd: 0, status: 'LIVE', applied: false, done: false,
      } });
    }
  }
  let app, unmounted = false;
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(FixtureApp, { ref: value => { if (value) app = value; } })));
  const f = { app, clock, dom,
    get rngCalls() { return rngCalls; },
    compass: () => dom.window.document.querySelector('[data-testid="draw-compass"]'),
    needle: () => dom.window.document.querySelector('[data-testid="draw-compass-needle"]'),
    route: () => dom.window.document.querySelector('[data-testid="attack-vector"]'),
    async begin() { await act(async () => app.beginDuel()); },
    async setState(state) { await act(async () => app.setState(state)); },
    async spin() { await clock.frame(); await clock.frame(); },
    async unmount() { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } },
    async close() {
      await f.unmount();
      dom.window.close();
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
  return f;
}

function cleanDraw(f) {
  assert.equal(f.app.activeDrawKey, null);
  assert.equal(f.app.startedDrawKey, null);
  assert.equal(f.app.lockedDrawKey, null);
  assert.equal(f.app.drawFrames.size, 0);
  assert.equal(f.app.drawTimers.size, 0);
  assert.equal(f.app.timers.size, 0);
  assert.equal(f.clock.frames.size, 0);
  assert.equal(f.clock.timers.size, 0);
}

test('an attacker blocked by neutral land pauses with feedback and never starts an illegal match', async () => {
  const f = await fixture({ speed: 4 });
  try {
    // Both French-held capitals lie west of this neutral wall; Germany is east.
    f.app.displayGeo = { paths: { ...f.app.geo.paths,
      wall: { labelRings: [[[460, -1000], [465, -1000], [465, 1000], [460, 1000]]] },
    } };
    await f.setState({ autoplay: true });
    const before = structuredClone(f.app.state.own);
    await f.begin();
    assert.equal(f.app.state.autoplay, false);
    assert.equal(f.app.state.round, 0);
    assert.equal(f.app.state.spin, null);
    assert.equal(f.app.kickoffs.length, 0);
    assert.deepEqual(f.app.state.own, before);
    assert.match(f.dom.window.document.body.textContent, /No clear route.*Next match/);
    assert.equal(f.clock.frames.size, 0);
    assert.equal(f.app.drawTimers.size, 0);
    await f.clock.tick(6000);
    assert.equal(f.app.state.toast, null);
    assert.equal(f.app.kickoffs.length, 0);
    cleanDraw(f);
  } finally { await f.close(); }
});

test('real App ready/spinning/locked/kickoff stages and CSS share the 1x/2x/4x timing snapshot', async () => {
  for (const speed of [1, 2, 4]) {
    const f = await fixture({ speed });
    try {
      await f.begin();
      const draw = f.app.state.spin;
      assert.equal(f.compass().dataset.stage, 'ready');
      assert.equal(f.needle().style.transition, 'none');
      assert.equal(f.app.state.round, 1);
      assert.equal(f.rngCalls, 3);
      assert.match(f.compass().getAttribute('transform'), /^translate\(410 240\)/, 'the actual nearest held territory owns the compass');
      await f.spin();
      assert.equal(f.compass().dataset.stage, 'spinning');
      assert.equal(f.needle().style.transition, `transform ${1550 / speed}ms cubic-bezier(.12,.64,.16,1)`);
      assert.equal(Number(f.compass().dataset.angle) % 360, draw.bearing);
      await f.clock.tick(draw.spinMs + 33.9);
      assert.equal(f.app.state.spin.stage, 'spinning', 'the needle is not cut off before its final paint');
      assert.equal(f.route(), null);
      await f.clock.tick(.1);
      assert.equal(f.app.state.spin.stage, 'locked');
      assert.ok(f.route());
      assert.deepEqual([f.app.state.atk.x1, f.app.state.atk.y1, f.app.state.atk.x2, f.app.state.atk.y2],
        [draw.x, draw.y, draw.targetX, draw.targetY]);
      assert.equal(f.needle().style.transition, 'none');
      await f.clock.tick(draw.holdMs - .1);
      assert.equal(f.app.kickoffs.length, 0);
      await f.clock.tick(.1);
      assert.deepEqual(f.app.kickoffs.map(k => [k.attackerId, k.targetId]), [[draw.attackerId, draw.targetId]]);
      assert.equal(f.app.state.spin, null);
      assert.equal(f.compass(), null);
      cleanDraw(f);
      await f.clock.tick(10000);
      assert.equal(f.app.kickoffs.length, 1);
    } finally { await f.close(); }
  }
});

test('reduced motion resolves without rAF or a spinning transition and uses its shorter captured timing', async () => {
  for (const speed of [1, 4]) {
    const f = await fixture({ speed, reducedMotion: true });
    try {
      await f.begin();
      assert.equal(f.clock.frames.size, 0);
      assert.equal(f.app.drawFrames.size, 0);
      assert.equal(f.needle().style.transition, 'none');
      assert.equal(Number(f.compass().dataset.angle), f.app.state.spin.rotation);
      await f.clock.tick(160 / speed);
      assert.equal(f.compass().dataset.stage, 'locked');
      assert.equal(f.route().style.animation, 'none');
      await f.clock.tick(320 / speed);
      assert.equal(f.app.kickoffs.length, 1);
      cleanDraw(f);
    } finally { await f.close(); }
  }
});

test('a speed change during the spin applies to future draws, not the pending animation or hold', async () => {
  const f = await fixture();
  try {
    await f.begin();
    await f.spin();
    await f.clock.tick(500);
    await act(async () => { f.app.cycleSpeed(); });
    await act(async () => { f.app.cycleSpeed(); });
    assert.equal(f.app.state.speed, 4);
    assert.equal(f.app.state.spin.speed, 1);
    assert.match(f.needle().style.transition, /1550ms/);
    await f.clock.tick(1084);
    assert.equal(f.app.state.spin.stage, 'locked');
    await f.clock.tick(479.9);
    assert.equal(f.app.kickoffs.length, 0);
    await f.clock.tick(.1);
    assert.equal(f.app.kickoffs[0].at, 2064);
    await f.setState({ match: null });
    await f.begin();
    assert.equal(f.app.state.spin.speed, 4);
    assert.equal(f.app.state.spin.spinMs, 387.5);
  } finally { await f.close(); }
});

test('rapid draw requests and the fallback racing delivered frames create one round and one kickoff', async () => {
  const f = await fixture({ speed: 4 });
  try {
    await act(async () => { f.app.beginDuel(); f.app.beginDuel(); f.app.nextAction(); });
    assert.equal(f.app.state.round, 1);
    assert.equal(f.rngCalls, 3);
    await f.clock.frame();
    const delayed = f.clock.frames.values().next().value;
    await f.clock.tick(160);
    assert.equal(f.app.state.spin.stage, 'spinning');
    assert.equal(f.clock.timers.size, 1, 'fallback starts only one lock timer');
    await f.clock.frame();
    await act(async () => delayed.callback(f.clock.now));
    assert.equal(f.clock.timers.size, 1, 'duplicate/delayed frames do not restart the animation');
    await f.clock.tick(387.5 + 34 + 120);
    assert.equal(f.app.kickoffs.length, 1);
    cleanDraw(f);
  } finally { await f.close(); }
});

test('a hidden tab with no delivered animation frames still resolves through the guarded fallback', async () => {
  const f = await fixture({ speed: 2 });
  try {
    await f.begin();
    await f.clock.tick(159.9);
    assert.equal(f.app.state.spin.stage, 'ready');
    await f.clock.tick(.1);
    assert.equal(f.app.state.spin.stage, 'spinning');
    await f.clock.tick(775 + 34 + 240);
    assert.equal(f.app.kickoffs.length, 1);
    assert.equal(f.app.state.spin, null);
    cleanDraw(f);
  } finally { await f.close(); }
});

test('duplicate lock requests in one React batch schedule exactly one hold and kickoff', async () => {
  const f = await fixture();
  try {
    await f.begin();
    await f.spin();
    const draw = f.app.state.spin;
    await act(async () => unstable_batchedUpdates(() => {
      f.app.lockDuel(draw.key);
      f.app.lockDuel(draw.key);
      f.app.lockDuel(draw.key);
    }));
    assert.equal(f.app.state.spin.stage, 'locked');
    assert.equal(f.clock.timerHistory.filter(entry => entry.delay === draw.holdMs).length, 1,
      'queued setState callbacks must not each schedule the same kickoff');
    await f.clock.tick(draw.holdMs);
    assert.equal(f.app.kickoffs.length, 1);
    cleanDraw(f);
  } finally { await f.close(); }
});

test('cancelled late frame and timeout callbacks cannot resurrect the spinner or add new work', async () => {
  const f = await fixture();
  try {
    await f.begin();
    await f.clock.frame();
    const frame = f.clock.frames.values().next().value;
    const timeout = f.clock.timers.values().next().value;
    const draw = f.app.state.spin;
    await act(async () => unstable_batchedUpdates(() => {
      f.app.startMatch(draw.attackerId, draw.targetId);
      frame.callback(f.clock.now);
      timeout.callback();
    }));
    assert.equal(f.app.state.spin, null);
    assert.equal(f.compass(), null);
    assert.equal(f.app.kickoffs.length, 1);
    cleanDraw(f);
  } finally { await f.close(); }
});

test('unmount cancels every owned callback, including work already delivered by the platform', async () => {
  for (const atStage of ['ready', 'spinning', 'locked']) {
    const f = await fixture({ speed: 4 });
    try {
      await f.begin();
      if (atStage !== 'ready') await f.spin();
      if (atStage === 'locked') await f.clock.tick(387.5 + 34);
      const oldFrames = [...f.clock.frames.values()];
      const oldTimers = [...f.clock.timers.values()];
      await f.unmount();
      cleanDraw(f);
      const scheduled = f.clock.timerHistory.length + f.clock.frameHistory.length;
      await act(async () => {
        oldFrames.forEach(entry => entry.callback(f.clock.now));
        oldTimers.forEach(entry => entry.callback());
      });
      assert.equal(f.app.kickoffs.length, 0);
      assert.equal(f.clock.timerHistory.length + f.clock.frameHistory.length, scheduled);
      cleanDraw(f);
    } finally { await f.close(); }
  }
});

test('cancellation before the initial React commit cannot schedule orphan frames or timers', async () => {
  for (const reducedMotion of [false, true]) {
    const f = await fixture({ reducedMotion });
    try {
      await act(async () => unstable_batchedUpdates(() => {
        f.app.beginDuel();
        f.app.clearTimers();
        f.app.setState({ spin: null });
      }));
      assert.equal(f.app.state.spin, null);
      assert.equal(f.compass(), null);
      cleanDraw(f);
      assert.equal(f.app.kickoffs.length, 0);
    } finally { await f.close(); }
  }
});
