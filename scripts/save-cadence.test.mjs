// Autosave cadence under Fast-forward, with real React 18 scheduling: createRoot, no act, render() => null, and React's
// own tasks (setImmediate) between timer tasks. syncAppFixture runs setState synchronously, which hides what these
// changes depend on: a timer's update waits for a later React task, and a setState callback runs after a later commit.
// - A fast-forwarded turn commits its draw with its kickoff (startMatch's `decided`), so no match-less checkpoint.
// - A fast-forwarded (express) match's kickoff and reveal are presentation when the last checkpoint already decides
//   them: each match writes once, with its result, and a hidden or closing page writes what is on screen.
// - A crash before that result resumes from a checkpoint that draws and plays the same matches again.
// - Folding nextAction's queued pair keeps the automatic Match view (DEC D11), as series game 2 and a new blitz round
//   do (those two still commit before their kickoff: folded, startMatch would read the view before its return to Map).
// - The tactical gate a Fast-forward turn reaches commits that turn with it. A click between a turn's timer task and
//   React's commit (a save that stores the spent random state, or Next match drawing again) keeps the kickoff after it
//   a checkpoint: the last checkpoint no longer replays it.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { flushSync } from 'react-dom';
import { bundleApp, withDom } from './lib/app-harness.mjs';
import { buildTeam, makeRng, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { PlaybackClock } from '../src/engine/playbackClock.js';
import { loadSave } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';

const FOOTBALL = getSport('football');
const IDS = ['250', '276', '724', '380', '826', '056', '528', '620', '040', '756', '208', '752'];

/** Squares in a grid four wide, each touching its neighbours, so every draw finds a route. */
function gridAtlas(ids) {
  const paths = {}, adj = {};
  ids.forEach((id, i) => {
    const cx = 100 + (i % 4) * 40, cy = 100 + Math.floor(i / 4) * 40;
    paths[id] = { cx, cy, area: 1600, labelX: cx, labelY: cy, bbox: { x: cx - 20, y: cy - 20, w: 40, h: 40 },
      d: `M${cx - 20},${cy - 20}h40v40h-40Z`, labelRings: [[[cx - 20, cy - 20], [cx + 20, cy - 20], [cx + 20, cy + 20], [cx - 20, cy + 20]]] };
  });
  ids.forEach((id, i) => {
    adj[id] = ids.filter((other, j) => j !== i && Math.abs((i % 4) - (j % 4)) + Math.abs(Math.floor(i / 4) - Math.floor(j / 4)) === 1);
  });
  return { paths, countries: ids.map(id => ({ id })), adj, graticule: { d: '', labels: [] }, fit: { s: 1, tx: 0, ty: 0 }, kmPerUnit: 1 };
}

/** Timers wait on a virtual clock until `step()` runs the earliest one (one browser task). */
function virtualClock() {
  let now = 0, seq = 0;
  const pending = new Map();
  return {
    get now() { return now; },
    schedule: (fn, ms = 0) => { const id = ++seq; pending.set(id, { id, at: now + Math.max(0, Number(ms) || 0), fn }); return id; },
    cancel: id => { pending.delete(id); },
    step() {
      const next = [...pending.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) return false;
      now = Math.max(now, next.at);
      pending.delete(next.id);
      next.fn();
      return true;
    },
  };
}

/** React's own tasks: renders and commits queued by the timer task that just ran. */
const reactTasks = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

/** Every resume-pointer write (one per checkpoint), parsed. */
function memoryStorage() {
  const items = new Map(), saves = [];
  return { items, saves,
    getItem: key => items.get(key) ?? null,
    setItem(key, value) { if (key === SAVE_KEY) saves.push(JSON.parse(value)); items.set(key, String(value)); },
    removeItem: key => { items.delete(key); } };
}

/**
 * Real React inside a jsdom, with `storage` as localStorage and animation frames on `time`. The globals are put back,
 * and every mounted view unmounted, when `fn` settles.
 */
async function realReact(fn) {
  await withDom(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const keys = ['localStorage', 'requestAnimationFrame', 'cancelAnimationFrame'];
    const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const mounted = new Set();
    const env = {
      use(storage, time) {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
        Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, writable: true, value: cb => time.schedule(() => cb(time.now), 16) });
        Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, writable: true, value: time.cancel });
      },
      mounted,
    };
    try { await fn(env); } finally {
      for (const view of mounted) view.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    }
  });
}

/**
 * A playing campaign on the grid with real React: football nations, Fast-forward (express), spectator, 4×, duel unless
 * `settings` say otherwise. `state` replaces fields of the opening state; `onCommit(previous)` sees every commit.
 */
async function mountCampaign(env, App, { storage, ids = IDS, seed = 777, settings = {}, state = {}, onCommit } = {}) {
  const { createRoot } = await import('react-dom/client');
  const time = virtualClock();
  env.use(storage, time);
  const teamRng = makeRng(912);
  const teams = Object.fromEntries(ids.map(id => [id, buildTeam(id, teamRng, FOOTBALL)]));
  for (const team of Object.values(teams)) { team.baseEff = teamEff(team); team.baseAvg = team.str; }
  let app = null;
  class Real extends App {
    constructor(props) {
      super(props);
      app = this;
      this.clock = new PlaybackClock({ now: () => time.now, schedule: time.schedule, cancel: time.cancel });
      this.timers = this.clock.tasks;
      this.geo = gridAtlas(ids);
      this.labelGeometry = [];
      this.rng = makeRng(seed);
      this.state = { ...this.state, phase: 'playing', teams, seed, rngState: this.rng.getState(),
        own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), round: 0, matches: 0,
        stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])), campaignId: 'c1', revision: 0, speed: 4,
        settings: { ...this.state.settings, sport: 'football', scope: 'UEFA', uncertainty: 'balanced', pacing: 'duel',
          resolution: 'ticker', express: true, finale: 'single', role: 'spectator', ...settings }, ...state };
      this.state.initialSettings = { ...this.state.settings };
    }
    componentDidUpdate(props, previous) {
      super.componentDidUpdate(props, previous);
      onCommit?.call(this, previous);
    }
    boot() {}
    fitMap() {} // the camera: the grid has no projection
    render() { return null; }
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  root.render(React.createElement(Real));
  await reactTasks();
  const view = {
    app, time,
    /** Run timer tasks, each followed by React's, until `done(app)`; autoplay is pressed again when it stops. */
    async playUntil(done, limit = 20000) {
      for (let i = 0; i < limit; i++) {
        if (done(app)) return true;
        if (!time.step()) {
          if (app.state.autoplay) return false;
          app.togglePlay();
        }
        await reactTasks();
      }
      return false;
    },
    close() { if (env.mounted.delete(view)) { root.unmount(); host.remove(); } },
  };
  env.mounted.add(view);
  return view;
}

const live = st => !!st.match && !st.match.applied;
const settledAt = n => app => app.state.matches >= n && !live(app.state) && !app.state.spin;
/** Everything a seed decides: replayed exactly after a resume. */
const played = app => JSON.stringify({ rng: app.rng.getState(), history: app.state.history, teams: app.state.teams,
  own: app.state.own, aliveIds: app.state.aliveIds, round: app.state.round, log: app.state.log });

await bundleApp();

test('under Fast-forward a turn commits with its kickoff, and each match writes one checkpoint, with its result', async () => {
  const App = await bundleApp();
  await realReact(async env => {
    const storage = memoryStorage(), kickoffs = [];
    const f = await mountCampaign(env, App, { storage, onCommit(previous) {
      const match = this.state.match;
      if (live(this.state) && previous.match?.allEv !== match.allEv) {
        kickoffs.push({ after: previous.matches, fromNull: previous.match == null, round: this.state.round - previous.round, express: !!match.express });
      }
    } });
    f.app.persist();
    await reactTasks();
    assert.ok(await f.playUntil(settledAt(1)), 'the first match settles');
    const from = storage.saves.length;
    assert.ok(await f.playUntil(settledAt(9)), 'eight more matches settle');
    const later = kickoffs.filter(kickoff => kickoff.after >= 1);
    assert.equal(later.length, 8);
    // Before, the turn committed `match: null` (never painted) and React ran the kickoff in the same task.
    assert.ok(later.every(kickoff => !kickoff.fromNull), 'each kickoff commits straight over the settled match');
    assert.ok(later.every(kickoff => kickoff.round === 1), 'and with its turn: the round moves on in the same commit');
    const express = later.filter(kickoff => kickoff.express).length;
    assert.ok(express >= 6, `${express} of 8 matches fast-forwarded`);
    const saves = storage.saves.slice(from);
    assert.deepEqual(saves.filter(save => save.match?.applied).map(save => save.matches), [2, 3, 4, 5, 6, 7, 8, 9],
      'every result is a checkpoint, written once');
    assert.equal(saves.filter(save => !save.match).length, 0, 'no match-less turn checkpoint');
    assert.equal(saves.filter(save => !save.match.applied && save.match.express).length, 0,
      'a fast-forwarded kickoff and reveal wait for the result');
    // An upset is never fast-forwarded: its kickoff and final score stay checkpoints of their own.
    assert.equal(saves.length, 8 + 2 * (8 - express), `${saves.length} checkpoints for 8 matches`);
    const last = saves.at(-1);
    assert.deepEqual([last.round, last.matches, last.rngState], [f.app.state.round, f.app.state.matches, f.app.rng.getState()]);
  });
});

test('a hidden or closing page writes the fast-forwarded kickoff or final score on screen, once', async () => {
  const App = await bundleApp();
  await realReact(async env => {
    const storage = memoryStorage();
    const f = await mountCampaign(env, App, { storage });
    f.app.persist();
    await reactTasks();
    let count = 0;
    const fresh = () => { const saves = storage.saves.slice(count); count = storage.saves.length; return saves; };
    // From a written result to the next fast-forwarded kickoff (an upset is never fast-forwarded: play it out).
    for (let n = 1; ; n = f.app.state.matches + 1) {
      assert.ok(n <= 8, 'a fast-forwarded match within eight');
      assert.ok(await f.playUntil(settledAt(n)));
      count = storage.saves.length;
      assert.ok(await f.playUntil(app => live(app.state)));
      if (f.app.state.match.express) break;
    }
    assert.equal(f.app.state.match.status, FOOTBALL.labels.live);
    assert.equal(fresh().length, 0, 'the kickoff waits for its result');
    f.app.handlePageHide();
    let saves = fresh();
    assert.equal(saves.length, 1, 'closing the page writes the kickoff');
    assert.deepEqual([saves[0].match.aId, saves[0].match.dId, saves[0].match.applied, saves[0].match.shown.length],
      [f.app.state.match.aId, f.app.state.match.dId, false, 0]);
    assert.equal(saves[0].rngState, f.app.rng.getState(), 'with the random state the kickoff left');
    f.app.handlePageHide();
    assert.equal(fresh().length, 0, 'nothing new, nothing written');
    assert.ok(await f.playUntil(app => live(app.state) && app.state.match.status === FOOTBALL.labels.end), 'the final score shows');
    assert.equal(fresh().length, 0, 'the reveal waits for the result');
    f.app.handlePageHide();
    saves = fresh();
    assert.equal(saves.length, 1, 'closing the page between reveal and result writes the reveal');
    assert.deepEqual([saves[0].match.status, saves[0].match.applied, saves[0].match.shown.length],
      [FOOTBALL.labels.end, false, f.app.state.match.allEv.length]);
    f.app.handlePageHide();
    assert.equal(fresh().length, 0);
    const matches = f.app.state.matches;
    assert.ok(await f.playUntil(settledAt(matches + 1)));
    assert.deepEqual(fresh().map(save => [save.matches, save.match.applied]), [[matches + 1, true]], 'then the result');
  });
});

test('a crash right after a fast-forwarded kickoff resumes from a checkpoint that plays the same matches again', async () => {
  const App = await bundleApp();
  const blitz = { pacing: 'blitz' };
  const express = st => live(st) && st.match.express;
  const cases = [
    // The previous result decides the kickoff: it stays the stored checkpoint, and resuming it draws the same turn.
    { label: 'a duel turn', settings: {}, until: 9, stored: 'result', crash: st => st.matches >= 5 && express(st) },
    // A batch's draw is saved with its queue and without its first match, so that first kickoff is a checkpoint.
    { label: "a blitz batch's first match", settings: blitz, until: 9, stored: 'kickoff',
      crash: st => st.matches >= 1 && express(st) && st.batchTotal > 1 && st.queue.length === st.batchTotal - 1 },
    { label: 'a queued blitz pair', settings: blitz, until: 9, stored: 'result',
      crash: st => st.matches >= 3 && express(st) && st.queue.length < st.batchTotal - 1 },
  ];
  await realReact(async env => {
    for (const { label, settings, until, stored, crash } of cases) {
      // The first seed whose run reaches the crash point (an upset kicks off a match that is not fast-forwarded).
      let storage, seed, kicked = null;
      for (seed of [777, 4242, 31337, 2026]) {
        storage = memoryStorage();
        const f = await mountCampaign(env, App, { storage, seed, settings });
        f.app.persist();
        const reached = await f.playUntil(app => crash(app.state) || settledAt(until)(app));
        kicked = reached && crash(f.app.state) ? f.app.state.match : null;
        f.close(); // the tab dies: no pagehide, nothing flushed
        if (kicked) break;
      }
      assert.ok(kicked, `${label}: a crash point`);

      const f = await mountCampaign(env, App, { storage: memoryStorage(), seed, settings });
      f.app.persist();
      assert.ok(await f.playUntil(settledAt(until)), `${label}: the uninterrupted run`);
      const reference = played(f.app);
      f.close();

      const g = await mountCampaign(env, App, { storage, seed, settings });
      g.app.saved = loadSave();
      const save = g.app.saved.match;
      // Without a match, a batch's first pair (already off the stored queue) would never be played after the resume.
      assert.ok(save, `${label}: the stored checkpoint holds a match`);
      assert.equal(stored === 'kickoff' ? !save.applied && save.aId === kicked.aId && save.dId === kicked.dId && save.finalGa === kicked.finalGa
        : save.applied, true, `${label}: the stored checkpoint holds the ${stored}`);
      g.app.resume();
      await reactTasks();
      g.app.setSpeed(4);
      assert.ok(await g.playUntil(settledAt(until)), `${label}: the resumed run`);
      assert.equal(played(g.app), reference, `${label}: resuming replays the same matches and random state`);
      g.close();
    }
  });
});

test('series game 2, a new blitz round and a queued pair keep the automatic Match view of a followed team', async () => {
  // README "Match": a followed team's match that kicks off while you are on Map switches to Match, and an automatic
  // switch returns to Map at the next turn. nextAction queues that return in the same tick as the kickoff, before
  // React commits it: a kickoff that reads the view from this.state must get the return in `decided`, or wait for it.
  const App = await bundleApp();
  const settled = (aId, dId) => ({ aId, dId, winner: aId, finalGa: 1, finalGd: 0, effA: 80, effD: 79, ga: 1, gd: 0,
    allEv: [{ m: 10, tid: aId, pts: 1, name: 'Scorer' }], shown: [{ m: 10, tid: aId, pts: 1, name: 'Scorer' }], tie: null, tieShown: null,
    applied: true, done: true, seriesResolved: true, noConquest: true, status: FOOTBALL.labels.end, express: false });
  const kickoff = async (env, ids, settings, state) => {
    const f = await mountCampaign(env, App, { storage: memoryStorage(), ids, seed: 4242, settings,
      state: { round: 3, matches: 2, view: 'match', viewSource: 'auto', autoplay: true, ...state } });
    f.app.nextAction(); // the timer task
    await reactTasks(); // React's
    const st = f.app.state;
    f.close();
    return { kicked: live(st) ? [st.match.aId, st.match.dId] : [], view: `${st.view}/${st.viewSource}` };
  };
  await realReact(async env => {
    const series = await kickoff(env, ['250', '276'], { finale: 'best-of-three' }, { followedId: '250', match: settled('250', '276'),
      series: { teamIds: ['250', '276'], wins: { 250: 1, 276: 0 }, games: 1 } });
    assert.deepEqual(series, { kicked: ['250', '276'], view: 'match/auto' }, 'series game 2');

    const six = IDS.slice(0, 6), views = [];
    for (const followed of six) {
      const round = await kickoff(env, six, { pacing: 'blitz' }, { followedId: followed, match: settled(followed, six.find(id => id !== followed)) });
      if (round.kicked.includes(followed)) views.push(round.view);
    }
    assert.ok(views.length >= 1, 'a followed team plays the last match of a blitz round and the first of the next');
    assert.deepEqual(views, views.map(() => 'match/auto'), 'a new blitz round');

    // A team followed during the batch plays the next queued pair, after an automatic switch for the last match.
    const queued = await kickoff(env, six, { pacing: 'blitz' }, { followedId: '826', queue: [['826', '056']], batchTotal: 3,
      match: settled('250', '276') });
    assert.deepEqual(queued, { kicked: ['826', '056'], view: 'match/auto' }, 'a queued pair');
  });
});

test('the tactical gate a Fast-forward turn reaches commits with that turn, in one write', async () => {
  // A manager following another team: a draw of the managed team without the followed one takes Fast-forward's
  // shortcut, and startMatch opens the gate instead of kicking off. The turn (`decided`) commits with the gate.
  const App = await bundleApp();
  await realReact(async env => {
    let found = null;
    for (const seed of [777, 4242, 31337, 2026]) {
      const storage = memoryStorage();
      const f = await mountCampaign(env, App, { storage, seed, settings: { role: 'manager' },
        state: { managedTeamId: IDS[0], followedId: IDS[11] }, onCommit(previous) {
          // persist has already run for this commit (App.componentDidUpdate): the gate is the last save.
          if (this.state.tacticalChoice && !previous.tacticalChoice && !previous.spin && !found) {
            found = { before: previous.round, round: this.state.round, saves: storage.saves.slice(-2), rng: this.rng.getState() };
          }
        } });
      f.app.persist();
      await reactTasks();
      for (let n = 0; n < 6 && !found; n++) {
        if (!await f.playUntil(app => !!app.state.tacticalChoice || !!app.state.managerElimination) || f.app.state.managerElimination) break;
        if (!found) { f.app.chooseTactic('balanced'); await reactTasks(); } // a gate the compass reached
      }
      f.close();
      if (found) break;
    }
    assert.ok(found, 'a gate reached through the Fast-forward shortcut');
    const { before, round, saves: [prior, gate], rng } = found;
    assert.equal(round, before + 1, "the turn's round commits with the gate");
    assert.deepEqual([prior.match?.applied, prior.round], [true, before], 'the previous result, then no match-less turn checkpoint');
    assert.deepEqual([gate.round, !!gate.tacticalChoice, gate.match, gate.rngState], [round, true, null, rng], 'the gate holds its turn');
  });
});

test('a click between a turn\'s timer task and React\'s commit: a crash after the kickoff still resumes to that kickoff', async () => {
  // A sync click renders before the turn a timer task queued, on the settled match. A Chronicle pick saves that match
  // with the random state the turn already spent; Next match draws again, so two turns' samples are spent. Either way
  // the last checkpoint no longer replays what kicks off, so the kickoff must be written at once. (A crash in the gap
  // itself still resumes from the spent random state, and the second draw is a race of its own: known issues on HEAD.)
  const App = await bundleApp();
  const clicks = {
    'a save': app => app.setState({ selectedHistoryId: app.state.history.at(-1).id }, () => app.persist()),
    'Next match': app => app.step(),
  };
  const kickoffOf = m => [m.aId, m.dId, m.finalGa, m.finalGd, m.allEv.length];
  await realReact(async env => {
    for (const [name, click] of Object.entries(clicks)) {
      let checked = false;
      for (let n = 2; n <= 9 && !checked; n++) {
        const storage = memoryStorage();
        const f = await mountCampaign(env, App, { storage });
        f.app.persist();
        assert.ok(await f.playUntil(settledAt(n)), `${name}: match ${n} settles`);
        // Timer tasks one at a time, until one takes random samples (the turn's draw) while the settled match is
        // still committed.
        let spent = false;
        for (let i = 0; i < 400 && !spent; i++) {
          const rng = f.app.rng.getState();
          if (!f.time.step()) { if (!f.app.state.autoplay) f.app.togglePlay(); await reactTasks(); continue; }
          if (f.app.rng.getState() !== rng && f.app.state.match?.applied && !f.app.state.spin) spent = true;
          else await reactTasks();
        }
        assert.ok(spent, `${name}: a turn whose timer task drew`);
        flushSync(() => click(f.app));
        await reactTasks();
        const st = f.app.state;
        f.close(); // the tab dies right after the kickoff: no pagehide, nothing flushed
        if (!live(st) || !st.match.express) continue; // an upset is never fast-forwarded: try the next match
        const g = await mountCampaign(env, App, { storage });
        g.app.saved = loadSave();
        g.app.resume();
        await reactTasks();
        g.app.setSpeed(4);
        assert.ok(await g.playUntil(app => live(app.state)), `${name}: the resumed campaign kicks off`);
        assert.deepEqual(kickoffOf(g.app.state.match), kickoffOf(st.match), `${name}: the resume kicks off the match that was on screen`);
        g.close();
        checked = true;
      }
      assert.ok(checked, `${name}: a fast-forwarded kickoff after the click`);
    }
  });
});

test('a second turn start before React commits the first draws nothing: the seed plays the same campaign', async () => {
  // Two starts in one task stand for the browser's races: Play re-arms the turn timer a pause held and schedules its
  // own, and a Next match click can land between a turn's timer task and React's commit. this.state still shows the
  // settled match then, so a second start drew again and the campaign parted from its seed (nextAction's guard).
  const App = await bundleApp();
  await realReact(async env => {
    const runs = {};
    for (const starts of [1, 2]) {
      const f = await mountCampaign(env, App, { storage: memoryStorage() });
      assert.ok(await f.playUntil(settledAt(3)), `${starts}: three matches settle`);
      const before = f.app.rng.getState();
      for (let i = 0; i < starts; i++) f.app.nextAction();
      const drawn = f.app.rng.getState();
      assert.notEqual(drawn, before, `${starts}: the turn drew`);
      await reactTasks();
      assert.ok(await f.playUntil(settledAt(8)), `${starts}: eight matches settle`);
      runs[starts] = { drawn, played: played(f.app) };
      f.close();
    }
    assert.equal(runs[2].drawn, runs[1].drawn, 'the second start took no samples');
    assert.equal(runs[2].played, runs[1].played, 'and the campaign plays on exactly as from one start');
  });
});
