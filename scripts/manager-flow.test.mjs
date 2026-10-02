// Exercise the bundled production App with deterministic timers and atlas fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { build } from 'esbuild';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { PlaybackClock } from '../src/engine/playbackClock.js';
import { loadSave, loadCampaign, parseCampaign, exportCampaign } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/App.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react'], loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const App = module.exports.default;

function controlledTime() {
  let now = 0, nextId = 1;
  const pending = new Map();
  return { pending, get now() { return now; },
    schedule(callback, delay = 0) { const id = nextId++; pending.set(id, { id, at: now + Number(delay), callback }); return id; },
    cancel(id) { pending.delete(id); },
    advance(ms) {
      const end = now + ms; let callbacks = 0;
      for (;;) {
        const task = [...pending.values()].filter(item => item.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!task) break;
        assert.ok(++callbacks < 1000, 'scheduled callbacks remain bounded');
        now = task.at; pending.delete(task.id); task.callback();
      }
      now = end;
    },
  };
}

function tinyAtlas(ids) {
  return { countries: ids.map(id => ({ id })), adj: {}, graticule: { d: '', labels: [] }, fit: { s: 1, tx: 0, ty: 0 }, kmPerUnit: 1,
    paths: Object.fromEntries(ids.map((id, index) => {
      const cx = 100 + index * 100, cy = 100;
      return [id, { cx, cy, area: 100, labelX: cx, labelY: cy, bbox: { x: cx - 20, y: cy - 20, w: 40, h: 40 },
        d: `M${cx - 20},${cy - 20}h40v40h-40Z`, labelRings: [[[cx - 20, cy - 20], [cx + 20, cy - 20], [cx + 20, cy + 20], [cx - 20, cy + 20]]] }];
    })) };
}

function fixture({ ids = ['250', '276', '826'], role = 'manager', seed = 728491, settings = {}, savedText } = {}) {
  const time = controlledTime(), items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
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
      this.clock = new PlaybackClock({ now: () => time.now, schedule: time.schedule, cancel: time.cancel }); this.timers = this.clock.tasks;
      this.geo = tinyAtlas(ids); this.labelGeometry = []; this.rng = makeRng(seed);
      this.state = { ...this.state, phase: 'playing', teams, seed, rngState: this.rng.getState(),
        own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), round: 1,
        stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])),
        managedTeamId: role === 'manager' ? ids[0] : null, followedId: role === 'manager' ? ids[0] : null,
        settings: { ...this.state.settings, sport: 'football', scope: 'UEFA', pacing: 'duel', resolution: 'ticker',
          uncertainty: 'balanced', role, finale: 'single', express: false, managedTeamId: role === 'manager' ? ids[0] : '', ...settings } };
      this.state.initialSettings = { ...this.state.settings };
      this.ready = true;
    }
    boot() {}
    fitMap() {}
    opening() { return { included: structuredClone(Object.values(teams)), own: Object.fromEntries(ids.map(id => [id, id])), scopeName: 'Fixture theatre' }; }
    setState(update, callback) {
      const previous = this.state, next = typeof update === 'function' ? update(this.state, this.props) : update;
      if (next) this.state = { ...this.state, ...next };
      if (this.ready) this.componentDidUpdate(this.props, previous);
      callback?.call(this);
    }
  }
  const app = new SyncApp({});
  return { app, time, storage, items, close() {
    app.componentWillUnmount();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  } };
}

function forceResult(app, winner = '250') {
  app.clearTimers();
  const aId = '250', dId = '276';
  app.setState({ match: { ...app.state.match, aId, dId, effA: teamEff(app.state.teams[aId]), effD: teamEff(app.state.teams[dId]),
    ga: 0, gd: 0, shown: [], allEv: [{ m: 1, tid: winner, name: app.state.teams[winner].squad[1].name, pts: 1 }],
    winner, finalGa: winner === aId ? 1 : 0, finalGd: winner === dId ? 1 : 0,
    tie: null, tieShown: null, status: 'LIVE', applied: false, done: false, express: false } });
}
function outcome(match) { return { aId: match.aId, dId: match.dId, winner: match.winner, ga: match.finalGa, gd: match.finalGd, events: match.allEv, tie: match.tie }; }
function findElement(element, name) {
  if (!React.isValidElement(element)) return null;
  if (element.type?.name === name) return element;
  for (const child of React.Children.toArray(element.props.children)) { const found = findElement(child, name); if (found) return found; }
  return null;
}

test('manager launch requires an included team and records that immutable team on success', () => {
  const f = fixture();
  try {
    f.app.persist(); const previous = f.storage.getItem(SAVE_KEY);
    f.app.setState({ phase: 'setup', setup: { ...f.app.state.settings, managedTeamId: '', seed: String(f.app.state.seed) } });
    f.app.startCampaign();
    assert.equal(f.app.state.phase, 'setup'); assert.match(f.app.state.saveStatus.message, /Choose the team/);
    assert.equal(f.storage.getItem(SAVE_KEY), previous);
    f.app.pickSetup('managedTeamId', '276'); f.app.startCampaign();
    assert.equal(f.app.state.phase, 'playing'); assert.equal(f.app.state.managedTeamId, '276');
    assert.equal(f.app.state.initialSettings.managedTeamId, '276');
  } finally { f.close(); }
});

test('tactical choice precedes production outcome RNG and cannot be stolen by changing favourite', () => {
  const f = fixture();
  try {
    const rng = f.app.rng.getState();
    f.app.startMatch('250', '276');
    assert.ok(f.app.state.tacticalChoice); assert.equal(f.app.state.match, null); assert.equal(f.app.rng.getState(), rng);
    f.app.followTeam('276'); assert.equal(f.app.state.managedTeamId, '250');
    f.app.chooseTactic('unknown'); assert.equal(f.app.rng.getState(), rng); assert.ok(f.app.state.tacticalChoice);
    f.app.chooseTactic('balanced');
    assert.equal(f.app.state.tacticalChoice, null); assert.ok(f.app.state.match); assert.notEqual(f.app.rng.getState(), rng);
    assert.equal(f.app.state.decisionLedger.at(-1).teamId, '250');
    f.app.followTeam('826'); forceResult(f.app, '250'); f.app.finishMatch();
    assert.ok(f.app.state.choice, 'A managed win requests its signing even while following another team');
    assert.equal(f.app.state.choice.winnerName, f.app.state.teams['250'].name);
  } finally { f.close(); }
});

test('following a live winner grants no signing control when the actual manager loses', () => {
  const f = fixture();
  try {
    f.app.startMatch('250', '276'); f.app.chooseTactic('attack'); f.app.followTeam('276');
    forceResult(f.app, '276'); f.app.finishMatch();
    assert.equal(f.app.state.choice, null); assert.equal(f.app.state.managerElimination.teamId, '250');
    assert.equal(f.app.state.managedTeamId, '250'); assert.equal(f.app.state.followedId, '276');
  } finally { f.close(); }
});

test('pending tactical reload preserves RNG and the exact outcome of committing the same choice', () => {
  const original = fixture(); let savedText, rng, expected, nextRng;
  try {
    original.app.startMatch('250', '276'); savedText = original.storage.getItem(SAVE_KEY); rng = original.app.rng.getState();
    assert.ok(parseCampaign(savedText).tacticalChoice); assert.equal(parseCampaign(savedText).match, null);
    original.app.chooseTactic('defend'); expected = outcome(original.app.state.match); nextRng = original.app.rng.getState();
  } finally { original.close(); }
  const resumed = fixture({ savedText });
  try {
    resumed.app.saved = loadSave(); resumed.app.resume();
    assert.ok(resumed.app.state.tacticalChoice); assert.equal(resumed.app.rng.getState(), rng); assert.equal(resumed.time.pending.size, 0);
    resumed.app.followTeam('276'); resumed.app.chooseTactic('defend');
    assert.deepEqual(outcome(resumed.app.state.match), expected); assert.equal(resumed.app.rng.getState(), nextRng);
  } finally { resumed.close(); }
});

test('pending signing reload preserves RNG and claims once for the committed manager', () => {
  const original = fixture(); let savedText, rng, chosen;
  try {
    original.app.startMatch('250', '276'); original.app.chooseTactic('balanced'); forceResult(original.app); original.app.finishMatch();
    rng = original.app.rng.getState(); chosen = original.app.state.choice.candidates[0].index; savedText = original.storage.getItem(SAVE_KEY);
  } finally { original.close(); }
  const resumed = fixture({ savedText });
  try {
    resumed.app.saved = loadSave(); resumed.app.resume();
    assert.ok(resumed.app.state.choice); assert.equal(resumed.app.rng.getState(), rng); assert.equal(resumed.app.state.matches, 0);
    resumed.app.followTeam('276'); resumed.app.chooseAcquisition(chosen); resumed.app.chooseAcquisition(chosen);
    assert.equal(resumed.app.state.matches, 1); assert.equal(resumed.app.state.own['276'], '250'); assert.equal(resumed.app.rng.getState(), rng);
    assert.equal(resumed.app.state.decisionLedger.at(-1).teamId, '250');
  } finally { resumed.close(); }
});

test('manager elimination stops autoplay and all clocks until spectator continuation', () => {
  const f = fixture();
  try {
    f.app.setState({ autoplay: true }); f.app.startMatch('250', '276'); f.app.chooseTactic('balanced');
    forceResult(f.app, '276'); f.app.finishMatch();
    assert.equal(f.app.state.paused, true); assert.equal(f.app.state.autoplay, false); assert.equal(f.app.clock.paused, true);
    assert.equal(f.time.pending.size, 0); const eliminated = exportCampaign(f.app.state);
    f.app.step(); f.app.togglePlay(); f.time.advance(10000); assert.equal(exportCampaign(f.app.state).replace(/"savedAt": \d+/, '"savedAt":0'), eliminated.replace(/"savedAt": \d+/, '"savedAt":0'));
    f.app.continueAsSpectator();
    assert.equal(f.app.state.managementEnded, true); assert.equal(f.app.managedId(), null); assert.equal(f.app.state.managerElimination, null);
    assert.equal(f.app.state.paused, false); assert.equal(f.app.clock.paused, false);
  } finally { f.close(); }
});

test('retrying management creates a fresh campaign while retaining the eliminated slot and chosen setup', () => {
  const f = fixture();
  try {
    f.app.persist(); const originalId = f.app.state.campaignId;
    forceResult(f.app, '276'); f.app.finishMatch(); const old = loadCampaign(originalId);
    assert.ok(old.managerElimination); f.app.retryManager();
    assert.notEqual(f.app.state.campaignId, originalId); assert.equal(f.app.state.managedTeamId, '250');
    assert.equal(f.app.state.seed, old.seed); assert.equal(f.app.state.matches, 0); assert.equal(f.app.state.managerElimination, null);
    assert.deepEqual(loadCampaign(originalId).aliveIds, old.aliveIds); assert.ok(loadCampaign(originalId).managerElimination);
  } finally { f.close(); }
});

test('campaign role, uncertainty, recruitment and finale stay locked between series games', () => {
  const f = fixture({ ids: ['250', '276'], role: 'spectator', settings: { finale: 'best-of-three' } });
  try {
    f.app.startMatch('250', '276'); forceResult(f.app); f.app.finishMatch();
    const series = structuredClone(f.app.state.series), settings = { ...f.app.state.settings };
    for (const [key, value] of [['role', 'manager'], ['uncertainty', 'wild'], ['finale', 'single'], ['acquisitionPolicy', 'highest-rated'], ['pacing', 'chaos']]) f.app.setSetting(key, value);
    assert.deepEqual(f.app.state.settings, settings); assert.deepEqual(f.app.state.series, series);
    f.app.setSetting('resolution', 'instant'); assert.equal(f.app.state.settings.resolution, 'instant');
    f.app.startMatch('250', '276'); assert.equal(f.app.state.match.series.aWins, 1); assert.equal(f.app.state.series.games, 1);
  } finally { f.close(); }
});

test('import preview and cancellation preserve active checkpoint, RNG and pending playback', async () => {
  const f = fixture({ role: 'spectator' });
  try {
    f.app.startMatch('250', '276'); f.app.setState({ autoplay: true }); f.app.persist();
    const previous = f.storage.getItem(SAVE_KEY), rng = f.app.rng.getState(), match = outcome(f.app.state.match);
    const data = parseCampaign(previous); data.campaignName = 'Imported campaign'; data.seed = 12; const text = JSON.stringify(data);
    await f.app.importProgress({ size: text.length, text: async () => text });
    assert.equal(f.app.state.storageDialog.mode, 'import'); assert.equal(f.storage.getItem(SAVE_KEY), previous); assert.equal(f.app.rng.getState(), rng);
    assert.equal(f.app.clock.paused, true); f.app.closeStorageDialog();
    assert.equal(f.app.state.storageDialog, null); assert.equal(f.app.state.autoplay, true); assert.equal(f.app.clock.paused, false);
    assert.equal(f.storage.getItem(SAVE_KEY), previous); assert.deepEqual(outcome(f.app.state.match), match);
  } finally { f.close(); }
});

test('renaming the active slot in the same tab updates revision without self-conflict', () => {
  const f = fixture({ role: 'spectator' });
  try {
    f.app.persist(); const id = f.app.state.campaignId, revision = f.app.state.revision;
    f.app.openStorageDialog('slots'); const dialog = findElement(f.app.render(), 'CampaignStorageDialog'); assert.ok(dialog);
    dialog.props.onRename(id, 'My named campaign');
    assert.equal(f.app.state.revision, revision + 1); assert.equal(f.app.state.campaignName, 'My named campaign');
    f.app.closeStorageDialog(); f.app.persist();
    assert.equal(f.app.state.storageConflict, false); assert.equal(f.app.state.saveStatus.ok, true);
    assert.equal(loadCampaign(id).campaignName, 'My named campaign'); assert.equal(f.app.state.revision, revision + 2);
  } finally { f.close(); }
});
