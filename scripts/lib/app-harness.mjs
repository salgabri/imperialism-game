// Owner: WP-0 (see PLAN.md §5.3). Shared App/component test harness, frozen after W1: new tests import these helpers
// instead of copying them. Patterns are the ones campaign-experience, manager-flow, ui-interaction and visual-polish use.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { buildTeam, makeRng, teamEff } from '../../src/data/teams.js';
import { getSport } from '../../src/sports/index.js';
import { PlaybackClock } from '../../src/engine/playbackClock.js';
import { SAVE_KEY } from '../../src/config.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const BUILD = {
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
};

function evaluate(result) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

let appPromise = null;
let bundledApp = null;
/** esbuild of `src/App.jsx` (CSS empty, `BASE_URL` '/'), evaluated once per process. Resolves to the App class. */
export function bundleApp() {
  appPromise ||= build({ ...BUILD, entryPoints: [fileURLToPath(new URL('../../src/App.jsx', import.meta.url))], jsx: 'automatic' })
    .then(result => { bundledApp = evaluate(result).default; return bundledApp; });
  return appPromise;
}

/**
 * Bundle a stdin re-export module and evaluate it. `map` values: `'src/x/Y.jsx'` (default export) or
 * `['src/x/Y.jsx', 'name']` (named export). Paths are repo-relative. The classic JSX transform is the default, so a
 * component that forgets `import React from 'react'` fails here as it would in the other component tests.
 */
export async function bundleComponents(map, { jsx } = {}) {
  const lines = Object.entries(map).map(([as, spec]) => {
    const [file, name = 'default'] = Array.isArray(spec) ? spec : [spec];
    const from = JSON.stringify(`./${String(file).replace(/^\.?\//, '')}`);
    return `export { ${name} as ${as} } from ${from};`;
  });
  const result = await build({ ...BUILD, ...(jsx ? { jsx } : {}),
    stdin: { contents: lines.join('\n'), resolveDir: ROOT, loader: 'jsx' } });
  return evaluate(result);
}

/** A manual clock for `setTimeout`/`requestAnimationFrame` and PlaybackClock: nothing runs until `advance(ms)`. */
export function controlledTime() {
  let now = 0, nextId = 1;
  const pending = new Map();
  return {
    pending,
    get now() { return now; },
    schedule(callback, delay = 0) {
      const id = nextId++;
      pending.set(id, { id, at: now + Number(delay), callback });
      return id;
    },
    cancel(id) { pending.delete(id); },
    advance(ms) {
      const end = now + ms;
      let callbacks = 0;
      for (;;) {
        const next = [...pending.values()].filter(task => task.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        assert.ok(++callbacks < 5000, 'fake-clock callbacks are bounded');
        now = next.at;
        pending.delete(next.id);
        next.callback();
      }
      now = end;
    },
  };
}

/** Square countries in a row: no `displayGeo`, no `capitals`, no `invert`, `adj: {}` (PLAN §0.9a). */
export function tinyAtlas(ids) {
  const paths = Object.fromEntries(ids.map((id, index) => {
    const cx = 100 + index * 100, cy = 100;
    return [id, { cx, cy, area: 100, labelX: cx, labelY: cy,
      bbox: { x: cx - 20, y: cy - 20, w: 40, h: 40 },
      d: `M${cx - 20},${cy - 20}h40v40h-40Z`,
      labelRings: [[[cx - 20, cy - 20], [cx + 20, cy - 20], [cx + 20, cy + 20], [cx - 20, cy + 20]]],
    }];
  }));
  return { paths, countries: ids.map(id => ({ id })), adj: {},
    graticule: { d: '', labels: [] }, fit: { s: 1, tx: 0, ty: 0 }, kmPerUnit: 1 };
}

/**
 * The campaign-experience `SyncApp` pattern: synchronous `setState` (componentDidUpdate and the callback run at
 * once), a controlled clock, fake `localStorage`/`setTimeout`/`requestAnimationFrame`, the tiny atlas, seeded RNG.
 * - `phase: 'playing'` (default): every id is a team holding its own country, round 1.
 * - `phase: 'setup'`: geo is loaded but `teams: {}`, `aliveIds: []` (the state after boot).
 * - `phase: 'loading'`: `this.geo` stays undefined and `teams: {}`.
 * `role: 'manager'` manages (and follows) `ids[0]`. Pass `App` to use another class; otherwise `await bundleApp()` first.
 * Returns `{ app, time, storage, items, close() }`; always call `close()` (restores the globals).
 */
export function syncAppFixture({ App = bundledApp, ids = ['250', '276', '826'], seed = 728491, settings = {}, savedText,
  phase = 'playing', role = 'spectator' } = {}) {
  if (!App) throw new Error('syncAppFixture: await bundleApp() first or pass { App }');
  const time = controlledTime();
  const items = new Map();
  const storage = {
    failWrites: false,
    getItem: key => items.get(key) ?? null,
    setItem(key, value) { if (storage.failWrites) throw new Error('quota'); items.set(key, String(value)); },
    removeItem: key => items.delete(key),
  };
  if (savedText) storage.setItem(SAVE_KEY, savedText);
  const globals = { localStorage: storage, setTimeout: time.schedule, clearTimeout: time.cancel,
    requestAnimationFrame: callback => time.schedule(() => callback(time.now), 16), cancelAnimationFrame: time.cancel };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const playing = phase === 'playing' || phase === 'victory';
  const sport = getSport(settings.sport || 'football'), teamRng = makeRng(912);
  const teams = playing ? Object.fromEntries(ids.map(id => [id, buildTeam(id, teamRng, sport)])) : {};
  for (const team of Object.values(teams)) { team.baseEff = teamEff(team); team.baseAvg = team.str; }
  const managed = playing && role === 'manager' ? ids[0] : null;
  class SyncApp extends App {
    constructor(props) {
      super(props);
      this.clock = new PlaybackClock({ now: () => time.now, schedule: time.schedule, cancel: time.cancel });
      this.timers = this.clock.tasks;
      if (phase !== 'loading') this.geo = tinyAtlas(ids);
      this.labelGeometry = [];
      this.rng = makeRng(seed);
      this.state = playing ? { ...this.state, phase, teams, seed, rngState: this.rng.getState(),
        own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), round: 1,
        stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])),
        managedTeamId: managed, followedId: managed,
        settings: { ...this.state.settings, sport: 'football', scope: 'UEFA', pacing: 'duel', resolution: 'ticker',
          uncertainty: 'balanced', role, finale: 'single', express: false, managedTeamId: managed || '', ...settings } }
        : { ...this.state, phase, setup: { ...this.state.setup, ...settings } };
      if (playing) this.state.initialSettings = { ...this.state.settings };
      this.ready = true;
    }
    boot() {}
    fitMap() {} // UI camera fitting is unrelated to campaign state.
    opening() {
      return { included: structuredClone(Object.values(teams)), own: Object.fromEntries(ids.map(id => [id, id])), scopeName: 'Fixture theatre' };
    }
    setState(update, callback) {
      const previous = this.state;
      const next = typeof update === 'function' ? update(this.state, this.props) : update;
      if (next) this.state = { ...this.state, ...next };
      if (this.ready) this.componentDidUpdate(this.props, previous);
      callback?.call(this);
    }
  }
  const app = new SyncApp({});
  return {
    app, time, storage, items,
    close() {
      app.componentWillUnmount();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

/** Replace the current match with a decided one (no RNG): `winner` scores, the other side does not. */
export function forceResult(app, winner, { aId = app.state.match?.aId ?? app.state.aliveIds[0],
  dId = app.state.match?.dId ?? app.state.aliveIds[1] } = {}) {
  app.clearTimers();
  app.setState({ match: { ...app.state.match, aId, dId, effA: teamEff(app.state.teams[aId]), effD: teamEff(app.state.teams[dId]),
    ga: 0, gd: 0, shown: [], allEv: [{ m: 1, tid: winner, name: app.state.teams[winner].squad[1].name, pts: 1 }],
    winner, finalGa: winner === aId ? 1 : 0, finalGd: winner === dId ? 1 : 0,
    tie: null, tieShown: null, status: 'LIVE', applied: false, done: false, express: false } });
}

/** Depth-first search of a rendered element tree for the first element whose component function is named `name`. */
export function findElement(element, name) {
  if (!React.isValidElement(element)) return null;
  if (element.type?.name === name) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return null;
}

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent',
  'MouseEvent', 'getComputedStyle'];
let activeDom = null;

/**
 * Run `fn({ window, document, mount })` with a fresh jsdom installed as the globals and `IS_REACT_ACT_ENVIRONMENT`.
 * Every view `mount` creates inside is unmounted, and the previous globals are restored, when `fn` settles.
 */
export async function withDom(fn, { url = 'http://localhost/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url, pretendToBeVisual: true });
  const saved = new Map([...DOM_GLOBALS, 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of DOM_GLOBALS) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView ||= () => {};
  const previous = activeDom;
  activeDom = { dom, views: new Set() };
  const current = activeDom;
  try {
    return await fn({ window: dom.window, document: dom.window.document, mount });
  } finally {
    for (const view of [...current.views].reverse()) await view.unmount();
    activeDom = previous;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
}

/**
 * Mount `Component` (or a ready element when `Component` is a React element) into a fresh host inside `withDom`.
 * Returns `{ host, root, render(nextProps), unmount() }`; `render` and `unmount` run inside `act`.
 * Assert on strings and booleans (`assert.ok(!host.querySelector(…))`), never `assert.equal(node, null)`: a failing
 * assertion inspects the jsdom node graph and can stall the test process for minutes.
 */
export async function mount(Component, props = {}) {
  if (!activeDom) throw new Error('mount() needs a DOM: call it inside withDom()');
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const element = next => (React.isValidElement(Component) ? Component : React.createElement(Component, next));
  const view = {
    host, root,
    async render(next = props) { await act(async () => root.render(element(next))); },
    async unmount() {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
      host.remove();
      activeDom?.views.delete(view);
    },
  };
  activeDom.views.add(view);
  await view.render(props);
  return view;
}
