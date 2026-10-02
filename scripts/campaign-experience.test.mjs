// Production App lifecycle and scheduling regressions, without network or sleeps.
// Synchronous commits run componentDidUpdate and callbacks in React commit order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { build } from 'esbuild';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { PlaybackClock } from '../src/engine/playbackClock.js';
import { loadSave, parseCampaign, exportCampaign } from '../src/engine/storage.js';
import { SAVE_KEY, SAVE_VERSION } from '../src/config.js';

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

function controlledTime() {
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
        assert.ok(++callbacks < 1000, 'fake-clock callbacks are bounded');
        now = next.at;
        pending.delete(next.id);
        next.callback();
      }
      now = end;
    },
  };
}

function tinyAtlas(ids) {
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

function fixture({ ids = ['250', '276', '826'], seed = 728491, settings = {}, savedText } = {}) {
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
  const sport = getSport('football'), teamRng = makeRng(912);
  const teams = Object.fromEntries(ids.map(id => [id, buildTeam(id, teamRng, sport)]));
  for (const team of Object.values(teams)) { team.baseEff = teamEff(team); team.baseAvg = team.str; }
  class SyncApp extends App {
    constructor(props) {
      super(props);
      this.clock = new PlaybackClock({ now: () => time.now, schedule: time.schedule, cancel: time.cancel });
      this.timers = this.clock.tasks;
      this.geo = tinyAtlas(ids);
      this.labelGeometry = [];
      this.rng = makeRng(seed);
      this.state = { ...this.state, phase: 'playing', teams, seed, rngState: this.rng.getState(),
        own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), round: 1,
        stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])),
        settings: { ...this.state.settings, sport: 'football', scope: 'UEFA', pacing: 'duel',
          resolution: 'ticker', uncertainty: 'balanced', role: 'spectator', finale: 'single', express: false, ...settings } };
      this.ready = true;
    }
    boot() {}
    fitMap() {} // Resume's UI camera fitting is unrelated to campaign state.
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

function resolvedMatch(app, winner = '250') {
  return {
    aId: '250', dId: '276', effA: teamEff(app.state.teams['250']), effD: teamEff(app.state.teams['276']),
    ga: 0, gd: 0, shown: [], allEv: [
      { m: 1, tid: winner, name: app.state.teams[winner].squad[1].name, pts: 1 },
      { m: 40, tid: winner, name: app.state.teams[winner].squad[2].name, pts: 1 },
    ],
    winner, finalGa: winner === '250' ? 2 : 0, finalGd: winner === '276' ? 2 : 0,
    tie: null, tieShown: null, status: 'LIVE', applied: false, done: false, express: false,
  };
}

function forceResult(app, winner) {
  app.clearTimers();
  app.setState({ match: { ...app.state.match, ...resolvedMatch(app, winner) } });
}

function outcome(match) {
  return { aId: match.aId, dId: match.dId, winner: match.winner, ga: match.finalGa, gd: match.finalGd,
    events: match.allEv, tie: match.tie };
}

function findElement(element, name) {
  if (!React.isValidElement(element)) return null;
  if (element.type?.name === name) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return null;
}

test('pausing a real ticker freezes scheduled events and conquest until resume', () => {
  const f = fixture();
  try {
    f.app.setState({ match: resolvedMatch(f.app), autoplay: true });
    f.app.presentMatch();
    f.time.advance(600);
    assert.equal(f.app.state.match.shown.length, 1);
    assert.equal(f.app.state.match.ga, 1);
    f.app.togglePlay();
    const paused = JSON.stringify({ match: f.app.state.match, own: f.app.state.own, matches: f.app.state.matches });
    assert.equal(f.app.state.paused, true);
    assert.equal(f.app.clock.paused, true);
    assert.equal(f.time.pending.size, 0);
    f.time.advance(100000);
    assert.equal(JSON.stringify({ match: f.app.state.match, own: f.app.state.own, matches: f.app.state.matches }), paused);
    f.app.pausePlayback();
    assert.equal(f.app.state.paused, false);
    f.time.advance(1689);
    assert.equal(f.app.state.match.shown.length, 1, 'remaining event delay is preserved');
    f.time.advance(1);
    assert.equal(f.app.state.match.shown.length, 2);
    f.time.advance(4000);
    assert.equal(f.app.state.matches, 1);
    assert.equal(f.app.state.aliveIds.length, 2);
    assert.equal(f.app.state.match.applied, true);
  } finally { f.close(); }
});

test('manager conquest waits for a signing and applies the chosen player exactly once', () => {
  const f = fixture({ settings: { role: 'manager' } });
  try {
    f.app.setState({ followedId: '250', match: resolvedMatch(f.app) });
    const before = structuredClone({ own: f.app.state.own, teams: f.app.state.teams, alive: f.app.state.aliveIds });
    f.app.finishMatch();
    assert.ok(f.app.state.choice);
    assert.equal(f.app.state.choice.candidates.length, 3);
    assert.deepEqual(f.app.state.own, before.own);
    assert.deepEqual(f.app.state.teams, before.teams);
    assert.deepEqual(f.app.state.aliveIds, before.alive);
    assert.equal(f.app.state.matches, 0);
    assert.equal(f.app.state.history.length, 0);
    assert.equal(f.app.timers.size, 0, 'the result cannot advance past the signing choice');
    const candidate = f.app.state.choice.candidates.at(-1);
    const chosen = f.app.state.teams['276'].squad[candidate.index];
    f.app.chooseAcquisition(candidate.index);
    assert.equal(f.app.state.choice, null);
    assert.equal(f.app.state.own['276'], '250');
    assert.equal(f.app.state.teams['250'].squad.length, before.teams['250'].squad.length + 1);
    assert.equal(f.app.state.teams['276'].squad.length, before.teams['276'].squad.length - 1);
    assert.equal(f.app.state.teams['250'].squad.filter(player => player.name === chosen.name).length, 1);
    assert.equal(f.app.state.match.playerTaken.name, chosen.name);
    f.app.chooseAcquisition(candidate.index);
    f.app.finishMatch();
    f.app.applyConquest(candidate.index);
    assert.equal(f.app.state.matches, 1);
    assert.equal(f.app.state.fallen.length, 1);
    assert.equal(f.app.state.stats['250'].conq, 1);
    assert.equal(f.app.state.history.length, 1);
  } finally { f.close(); }
});

test('a pending manager signing survives reload without premature conquest', () => {
  const original = fixture({ settings: { role: 'manager' } });
  let savedText;
  try {
    original.app.setState({ followedId: '250', match: resolvedMatch(original.app) });
    original.app.finishMatch();
    savedText = original.storage.getItem(SAVE_KEY);
  } finally { original.close(); }
  const resumed = fixture({ savedText });
  try {
    resumed.app.saved = loadSave();
    resumed.app.resume();
    assert.ok(resumed.app.state.choice);
    assert.equal(resumed.app.state.matches, 0);
    assert.equal(resumed.app.state.own['276'], '276');
    assert.equal(resumed.app.timers.size, 0);
    resumed.app.chooseAcquisition(resumed.app.state.choice.candidates[0].index);
    assert.equal(resumed.app.state.matches, 1);
    assert.equal(resumed.app.state.own['276'], '250');
  } finally { resumed.close(); }
});

test('best-of-three final transfers nothing until one side wins its second game', () => {
  const f = fixture({ ids: ['250', '276'], settings: { finale: 'best-of-three' } });
  try {
    const initial = structuredClone({ teams: f.app.state.teams, own: f.app.state.own });
    for (const [index, winner] of ['250', '276', '250'].entries()) {
      f.app.startMatch('250', '276');
      forceResult(f.app, winner);
      f.app.finishMatch();
      assert.equal(f.app.state.matches, index + 1);
      if (index < 2) {
        assert.equal(f.app.state.match.noConquest, true);
        assert.deepEqual(f.app.state.own, initial.own);
        assert.deepEqual(f.app.state.teams, initial.teams);
        assert.equal(f.app.state.aliveIds.length, 2);
        assert.equal(f.app.state.fallen.length, 0);
      }
    }
    assert.deepEqual(f.app.state.series.wins, { '250': 2, '276': 1 });
    assert.deepEqual(f.app.state.aliveIds, ['250']);
    assert.equal(f.app.state.own['276'], '250');
    assert.equal(f.app.state.teams['250'].squad.length, initial.teams['250'].squad.length + 1);
    assert.equal(f.app.state.teams['276'].squad.length, initial.teams['276'].squad.length - 1);
    assert.equal(f.app.state.stats['250'].conq, 1);
    assert.equal(f.app.state.history.length, 3);
    const completedAt = f.app.state.completedAt;
    assert.ok(completedAt > 0);
    assert.equal(parseCampaign(exportCampaign(f.app.state)).completedAt, completedAt);
    f.app.setState({ startedAt: completedAt - 120_000 });
    const originalNow = Date.now;
    try {
      Date.now = () => completedAt + 3_600_000;
      assert.equal(f.app.victoryPanel().recap['Elapsed time'], '2 min', 'completed duration does not grow while inspecting results');
    } finally { Date.now = originalNow; }
  } finally { f.close(); }
});

test('saving and resuming a pending real simulation retains outcome and the next match RNG', () => {
  const original = fixture();
  let savedText, pending, rngState, nextOutcome, nextRngState;
  try {
    original.app.startMatch('250', '276');
    original.time.advance(1000);
    assert.equal(original.app.state.match.applied, false);
    pending = outcome(original.app.state.match);
    rngState = original.app.rng.getState();
    savedText = original.storage.getItem(SAVE_KEY);
    const saved = parseCampaign(savedText);
    assert.deepEqual(outcome(saved.match), pending);
    assert.equal(saved.rngState, rngState);
    original.app.clearTimers();
    original.app.finishMatch();
    original.app.startMatch(...original.app.state.aliveIds);
    nextOutcome = outcome(original.app.state.match);
    nextRngState = original.app.rng.getState();
  } finally { original.close(); }
  const resumed = fixture({ savedText });
  try {
    resumed.app.saved = loadSave();
    resumed.app.resume();
    assert.deepEqual(outcome(resumed.app.state.match), pending);
    assert.equal(resumed.app.rng.getState(), rngState, 'presentation never rerolls the saved outcome');
    resumed.app.clearTimers();
    resumed.app.finishMatch();
    resumed.app.startMatch(...resumed.app.state.aliveIds);
    assert.deepEqual(outcome(resumed.app.state.match), nextOutcome);
    assert.equal(resumed.app.rng.getState(), nextRngState);
  } finally { resumed.close(); }
});

test('save quota failure reaches the header and leaves exportable campaign state intact', () => {
  const f = fixture();
  try {
    f.app.persist();
    const goodSave = f.storage.getItem(SAVE_KEY);
    f.storage.failWrites = true;
    f.app.persist();
    assert.equal(f.app.state.saveStatus.ok, false);
    assert.match(f.app.state.saveStatus.message, /could not be saved.*Export/i);
    assert.equal(f.storage.getItem(SAVE_KEY), goodSave, 'failed saves preserve the previous checkpoint');
    const header = findElement(f.app.render(), 'CommandBar');
    assert.ok(header);
    assert.equal(header.props.saveStatus.ok, false);
    const exported = parseCampaign(exportCampaign(f.app.state));
    assert.deepEqual(exported.own, f.app.state.own);
    assert.deepEqual(exported.teams, f.app.state.teams);
  } finally { f.close(); }
});

test('version-one saves migrate and resume without rewriting ownership or squads', () => {
  const f = fixture();
  try {
    const old = {
      v: 1, settings: { sport: 'football', scope: 'UEFA', pacing: 'duel', resolution: 'ticker' },
      teams: structuredClone(f.app.state.teams), own: { ...f.app.state.own }, aliveIds: [...f.app.state.aliveIds],
      round: 7, matches: 3, queue: [], stats: f.app.state.stats,
    };
    Object.values(old.teams).forEach(team => { delete team.sport; });
    f.storage.setItem(SAVE_KEY, JSON.stringify(old));
    const migrated = loadSave();
    assert.equal(migrated.v, SAVE_VERSION);
    assert.equal(migrated.legacy, true);
    assert.equal(migrated.seed, 1);
    assert.equal(migrated.rngState, 1);
    f.app.saved = migrated;
    f.app.resume();
    assert.deepEqual(f.app.state.own, old.own);
    assert.deepEqual(f.app.state.teams, old.teams);
    assert.equal(f.app.state.round, 7);
    assert.equal(f.app.state.matches, 3);
    assert.equal(f.app.rng.getState(), 1);
    assert.equal(JSON.parse(f.storage.getItem(SAVE_KEY)).v, SAVE_VERSION);
  } finally { f.close(); }
});

test('cancelling new campaign or opening setup keeps the current save available', () => {
  const f = fixture();
  try {
    f.app.persist();
    const saved = f.storage.getItem(SAVE_KEY);
    f.app.newCampaign();
    assert.equal(f.app.state.confirmNew, true);
    const header = findElement(f.app.render(), 'CommandBar');
    assert.ok(header?.props.onCancelNew);
    header.props.onCancelNew();
    assert.equal(f.app.state.confirmNew, false);
    assert.equal(f.app.state.phase, 'playing');
    assert.equal(f.storage.getItem(SAVE_KEY), saved);
    f.app.newCampaign();
    f.app.newCampaign();
    assert.equal(f.app.state.phase, 'setup');
    assert.equal(f.storage.getItem(SAVE_KEY), saved);
    assert.ok(f.app.state.hasSave);
    f.app.pickSetup('sport', 'basketball');
    assert.equal(f.storage.getItem(SAVE_KEY), saved, 'setup preferences do not overwrite the active checkpoint');
    f.app.resume();
    assert.equal(f.app.state.phase, 'playing');
    assert.equal(f.app.state.settings.sport, 'football');
  } finally { f.close(); }
});
