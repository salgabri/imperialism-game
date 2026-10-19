// Save size and quota behaviour (W3 fix for the world-blitz resume smoke). A checkpoint is stored up to four times
// (slot, resume pointer and a previous copy of each). A v3 170-nation checkpoint was ~0.95M code units at kickoff and
// ~1.36M at the end, so it reached a browser-sized ~5M-character quota by round 2-3. Before the fix a quota error
// part-way through writeSave left the slot at revision + 1 while the caller stayed at the old revision, so the next
// autosave reported "changed in another tab" and froze the run. v4 stores bundled roster sources by id: a full world
// campaign now keeps every copy (budget below); the quota tests still cover checkpoints whose sources stay inline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { CAPITALS } from '../src/data/capitals.js';
import { NATIONS, buildTeam, makeRng } from '../src/data/teams.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { getSport } from '../src/sports/index.js';
import { CAMPAIGN_BACKUP_KEY, CAMPAIGN_INDEX_KEY, campaignSnapshot, campaignStorageKey, createCampaignId,
  deleteCampaign, detectSaveConflict, forkCampaign, loadCampaign, loadSave, writeSave } from '../src/engine/storage.js';
import { bundleApp } from './lib/app-harness.mjs';

const QUOTA = 5_000_000; // jsdom's default and Chromium's per-origin localStorage limit, in UTF-16 code units
const slotBackupKey = id => `${campaignStorageKey(id)}:backup`;

/** A Map-backed localStorage with the jsdom quota rule (keys + values, an existing key's old value excluded). */
function quotaStorage(quota = QUOTA) {
  const items = new Map();
  const storage = {
    items, failOn: null, attempts: [],
    getItem: key => items.get(key) ?? null,
    removeItem: key => { items.delete(key); },
    setItem(key, value) {
      const text = String(value);
      storage.attempts.push(key);
      const failure = storage.failOn?.(key);
      if (failure) throw failure;
      let total = key.length + text.length;
      for (const [k, v] of items) if (k !== key) total += k.length + v.length;
      if (total > quota) throw new DOMException(`The ${quota}-code unit storage quota has been exceeded.`, 'QuotaExceededError');
      items.set(key, text);
    },
    used() { let total = 0; for (const [k, v] of items) total += k.length + v.length; return total; },
  };
  return storage;
}
function withStorage(storage, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return run(); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
async function withStorageAsync(storage, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return await run(); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

/** `inline`: sources from an earlier roster snapshot, which v4 cannot reference, so the checkpoint is v3-sized. */
function campaign(ids, settings, { inline = false } = {}) {
  const rng = makeRng(20260910), sport = getSport('football');
  const teams = Object.fromEntries(ids.map(id => [id, buildTeam(id, rng, sport)]));
  if (inline) {
    for (const team of Object.values(teams)) {
      team.squad = team.squad.map(player => (player.sourceInfo
        ? { ...player, sourceInfo: { ...player.sourceInfo, snapshotDate: '2024-09-19' } } : player));
    }
  }
  return { phase: 'playing', settings: { sport: 'football', layer: 'nations', resolution: 'instant', role: 'spectator', ...settings },
    teams, own: Object.fromEntries(ids.map(id => [id, id])), aliveIds: ids.slice(), fallen: [],
    stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])),
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 20260910, rngState: rng.getState(),
    followedId: null, managedTeamId: null, campaignId: createCampaignId(), revision: 0, campaignName: 'World war',
    metrics: { acquisitions: [], leaderChanges: 0 }, match: null, spin: null, choice: null, series: null,
    tacticalChoice: null, turnQueue: [], turnIndex: 0, pendingTarget: null };
}
const worldCampaign = options => campaign(Object.keys(NATIONS), { scope: 'world', pacing: 'blitz' }, options);
const inlineWorldCampaign = () => worldCampaign({ inline: true });
const smallCampaign = () => campaign(['250', '276'], { scope: 'UEFA', pacing: 'duel' });

/** A history entry shaped like the App's (display marks, events, conquest result with sourced players): ~2.2k chars. */
function historyEntry(state, n) {
  const ids = state.aliveIds.filter(id => state.teams[id].squad.length >= 2);
  const aId = ids[n % ids.length], dId = ids[(n * 7 + 3) % ids.length] === aId ? ids[(n + 1) % ids.length] : ids[(n * 7 + 3) % ids.length];
  const A = state.teams[aId], D = state.teams[dId], stolen = D.squad[n % D.squad.length];
  const mark = (team, score) => ({ name: team.name, score, eff: '80.0', code: team.code, color: team.col, id: team.id });
  return { id: `match-${n}`, round: 1 + Math.floor(n / 85), aId, bId: dId, dId, a: mark(A, 2), b: mark(D, 1),
    winnerId: aId, winnerName: A.name, ratingGap: 1.2, upsetGap: 0.4,
    events: [12, 47, 81].map((m, i) => ({ when: `${m}'`, text: `${(i % 2 ? D : A).squad[i].name} scores`, color: (i % 2 ? D : A).col })),
    odds: { a: 0.48, b: 0.52 }, series: null, routeLabel: '', mode: 'instant', status: 'FULL TIME', statusColor: '#777',
    statusLive: false, startLabel: 'Kick-off', kicks: null, noEvents: false, minuteFallback: 81,
    result: { title: `${A.name.toUpperCase()} ANNEXES ${D.name.toUpperCase()}`, text: `+1 territories · steals ${stolen.name}`,
      upset: false, background: 'rgba(229,51,77,0.1)', winnerId: aId, loserId: dId, winnerName: A.name, loserName: D.name,
      territories: 1, player: { ...stolen }, strengthBefore: 80, strengthAfter: 80.5, strengthGain: 0.5,
      territoryNames: [D.name], territoryIds: [dId], replacedPlayer: { ...A.squad[1], originalIndex: 1 }, tieText: null } };
}
const recoveryTier = (storage, id) => storage.items.has(slotBackupKey(id))
  ? (storage.items.has(CAMPAIGN_BACKUP_KEY) ? 'both' : 'slot') : (storage.items.has(CAMPAIGN_BACKUP_KEY) ? 'pointer' : 'none');

test('the world kickoff checkpoint stores roster sources by reference (v4 size budget)', () => withStorage(quotaStorage(), () => {
  const state = worldCampaign();
  assert.equal(state.aliveIds.length, Object.keys(NATIONS).length);
  const v3Size = JSON.stringify(campaignSnapshot(state)).length; // every source inline, as v3 stored it
  assert.equal(writeSave(state).ok, true);
  const size = localStorage.getItem(SAVE_KEY).length;
  // d757dbd measured 945,969 code units for the smoke's world kickoff; v4 measured 279,184.
  assert.ok(v3Size > 900_000 && size < 300_000, `world kickoff checkpoint is ${size} code units (${v3Size} inline)`);
  assert.deepEqual(loadSave().teams, JSON.parse(JSON.stringify(state.teams)), 'every squad and source is rebuilt');
}));

test('with room to spare every copy is written exactly as before', () => withStorage(quotaStorage(), () => {
  const state = smallCampaign();
  const texts = [];
  for (let round = 1; round <= 3; round++) {
    state.round = round;
    const result = writeSave(state);
    assert.equal(result.ok, true);
    Object.assign(state, { campaignId: result.campaignId, revision: result.revision });
    texts.push(localStorage.getItem(campaignStorageKey(state.campaignId)));
  }
  assert.equal(localStorage.getItem(SAVE_KEY), texts[2]);
  assert.equal(localStorage.getItem(slotBackupKey(state.campaignId)), texts[1]);
  assert.equal(localStorage.getItem(CAMPAIGN_BACKUP_KEY), texts[1]);
  assert.equal(JSON.parse(localStorage.getItem(CAMPAIGN_INDEX_KEY))[0].revision, 3);
}));

test('a quota error after the slot write rolls back and the next save is not a conflict', () => {
  const storage = quotaStorage(Infinity);
  withStorage(storage, () => {
    const state = smallCampaign();
    for (const round of [1, 2]) { state.round = round; Object.assign(state, writeSave(state)); }
    assert.equal(state.revision, 2);
    const before = new Map(storage.items);
    storage.failOn = key => key === SAVE_KEY && quotaError(); // the slot (revision 3) is already written by then
    const failed = writeSave({ ...state, round: 3 });
    assert.equal(failed.ok, false);
    assert.equal(failed.conflict, undefined);
    assert.match(failed.message, /could not be saved/);
    assert.deepEqual(storage.items, before, 'every key the failed save touched is restored');
    assert.equal(loadCampaign(state.campaignId).revision, 2);
    assert.equal(detectSaveConflict(state), null, 'the caller still matches the stored revision');
    storage.failOn = null;
    const next = writeSave({ ...state, round: 3 });
    assert.equal(next.ok, true);
    assert.equal(next.conflict, undefined);
    assert.equal(next.revision, 3);
    assert.equal(loadSave().round, 3);
  });
});

test('other storage errors are not retried and keep the recovery copies', () => {
  const storage = quotaStorage(Infinity);
  withStorage(storage, () => {
    const state = smallCampaign();
    for (const round of [1, 2]) { state.round = round; Object.assign(state, writeSave(state)); }
    const before = new Map(storage.items);
    storage.attempts.length = 0;
    storage.failOn = key => key === CAMPAIGN_BACKUP_KEY && new Error('blocked');
    const failed = writeSave({ ...state, round: 3 });
    assert.equal(failed.ok, false);
    assert.equal(failed.conflict, undefined);
    assert.equal(storage.attempts.filter(key => key === CAMPAIGN_BACKUP_KEY).length, 1, 'no lean retry');
    assert.deepEqual(storage.items, before);
  });
});

test('a growing inline-source world campaign keeps saving under a 5M quota by shedding its own recovery copies', () => {
  const storage = quotaStorage();
  withStorage(storage, () => {
    const state = inlineWorldCampaign();
    const tiers = [];
    let n = 0, size = 0;
    while (size < 2_300_000) {
      const result = writeSave(state);
      size = localStorage.getItem(SAVE_KEY)?.length ?? size;
      assert.equal(result.ok, true, `autosave at ${n} matches (${size} code units)`);
      assert.equal(result.conflict, undefined);
      assert.equal(result.revision, state.revision + 1);
      Object.assign(state, { campaignId: result.campaignId, revision: result.revision });
      assert.equal(JSON.parse(localStorage.getItem(SAVE_KEY)).revision, state.revision);
      assert.equal(JSON.parse(localStorage.getItem(campaignStorageKey(state.campaignId))).revision, state.revision);
      assert.ok(storage.used() <= QUOTA);
      const tier = recoveryTier(storage, state.campaignId);
      if (state.revision > 1 && tiers.at(-1) !== tier) tiers.push(tier);
      for (let i = 0; i < 25; i++) state.history.push(historyEntry(state, n++));
      state.matches = n;
    }
    assert.ok(n > 200, `the run reached ${n} matches`);
    assert.deepEqual(tiers, ['both', 'slot', 'none'], 'the pointer copy goes first, then the slot copy');
    assert.equal(loadSave().history.length, state.history.length - 25);

    // Past what even two copies can hold the save fails cleanly; trimming back saves again with no conflict.
    const stored = new Map(storage.items);
    const extra = Array.from({ length: 250 }, () => historyEntry(state, n++));
    const failed = writeSave({ ...state, history: [...state.history, ...extra] });
    assert.equal(failed.ok, false);
    assert.equal(failed.conflict, undefined);
    assert.deepEqual(storage.items, stored, 'the oversize save leaves storage as it was');
    const resumed = writeSave(state);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.conflict, undefined);
    assert.equal(resumed.revision, state.revision + 1);
  });
});

/** Grow `state` by history entries (numbered from `from`) until its checkpoint is at least `size` code units. */
function grow(state, size, from = 0) {
  let n = from;
  while (JSON.stringify(campaignSnapshot(state)).length < size) {
    for (let i = 0; i < 25; i++) state.history.push(historyEntry(state, n++));
    state.matches = n;
  }
  return n;
}

/** A finished-size inline-source world campaign (~1.36M) saved twice: slot, pointer and its slot backup fill ~4.08M of 5M. */
function storedWorldCampaign(storage) {
  const first = inlineWorldCampaign();
  first.campaignName = 'First world war';
  grow(first, 1_360_000);
  for (let i = 0; i < 2; i++) {
    const result = writeSave(first);
    assert.equal(result.ok, true);
    Object.assign(first, { campaignId: result.campaignId, revision: result.revision });
  }
  assert.ok(storage.items.has(slotBackupKey(first.campaignId)), 'the first campaign keeps its recovery copy');
  assert.ok(storage.used() > 4_000_000, `${storage.used()} code units in use`);
  return first;
}

// Merge with main (domestic campaigns): full storage never sheds another campaign's copies (docs/design/domestic-campaigns.md:
// "a campaign may drop only its own recovery copy"); the player frees room in Saved campaigns instead.
test('a second world campaign never sheds another campaign\'s recovery copy: it reports full storage until a campaign is deleted', () => {
  const storage = quotaStorage();
  withStorage(storage, () => {
    const first = storedWorldCampaign(storage);
    const firstBackup = storage.items.get(slotBackupKey(first.campaignId));
    const second = inlineWorldCampaign();
    second.campaignName = 'Second world war';
    const before = new Map(storage.items);
    const blocked = writeSave(second);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.quota, true, 'reported as full storage');
    assert.equal(blocked.conflict, undefined);
    assert.match(blocked.message, /storage is full.*Saved campaigns/);
    assert.deepEqual(storage.items, before, 'nothing was written or removed');
    assert.equal(storage.items.get(slotBackupKey(first.campaignId)), firstBackup, 'the first campaign keeps its recovery copy');
    assert.equal(loadCampaign(first.campaignId).revision, 2);
    // Deleting the first campaign frees its slot and copy; the second then saves all the way to finished size.
    assert.equal(deleteCampaign(first.campaignId).ok, true);
    let n = 0;
    for (const size of [0, 1_100_000, 1_250_000, 1_360_000]) {
      n = grow(second, size, n);
      const result = writeSave(second);
      assert.equal(result.ok, true, `second campaign saves at ${localStorage.getItem(SAVE_KEY)?.length} code units`);
      assert.equal(result.revision, second.revision + 1);
      Object.assign(second, { campaignId: result.campaignId, revision: result.revision });
      assert.ok(storage.used() <= QUOTA);
      assert.equal(loadSave().campaignId, second.campaignId);
    }
    assert.equal(loadSave().history.length, second.history.length);
  });
});

test('another campaign\'s recovery copy stays while its own slot is unreadable (then the save fails cleanly)', () => {
  const storage = quotaStorage();
  withStorage(storage, () => {
    const first = storedWorldCampaign(storage);
    const slot = campaignStorageKey(first.campaignId);
    storage.items.set(slot, `{${'x'.repeat(storage.items.get(slot).length - 1)}`); // damaged, same size
    const before = new Map(storage.items);
    const result = writeSave(inlineWorldCampaign());
    assert.equal(result.ok, false);
    assert.equal(result.conflict, undefined);
    assert.match(result.message, /could not be saved/);
    assert.deepEqual(storage.items, before, 'the only readable copy of the damaged campaign survives; nothing else changed');
  });
});

// ---------- v4 budget across whole campaigns ----------
/**
 * Every checkpoint of a full campaign, kickoff to champion. 4 × 700k = 2.8M keeps the slot, the resume pointer and both
 * recovery copies inside the 5M quota with room for another campaign's checkpoint and its copy.
 * Measured on seed 20261002 (v4): football world 279k at kickoff, 586k at the end (v3: 946k → 1.36M); basketball world
 * (no source metadata) 655k; England's 100 clubs (FM players packed) 112k → 306k.
 */
const CHECKPOINT_BUDGET = 700_000;
const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
let atlas = null;
function worldAtlas() {
  if (!atlas) {
    const geo = new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS));
    const displayGeo = new WorldGeometry(load('countries-50m.json'), CAPITALS);
    displayGeo.paths = displayGeo.buildPaths(geo.fit.s, geo.fit.tx, geo.fit.ty);
    atlas = { geo, displayGeo };
  }
  return atlas;
}
const cloneGeo = geo => Object.assign(Object.create(Object.getPrototypeOf(geo)), geo);
/** Country maps load through fetch; serve them from public/ like the dev server. */
async function servePublic(url) {
  try { const json = load(String(url).replace(/^\//, '')); return { ok: true, status: 200, json: async () => json }; }
  catch { return { ok: false, status: 404 }; }
}

/**
 * The production lifecycle of scripts/production-balance.mjs (spectator, instant results) with its autosave left on:
 * every checkpoint the App makes goes through writeSave into `storage`. Resolves to the App and one row per autosave.
 */
async function savedCampaign(App, storage, setup) {
  const saves = [];
  class SavingCampaign extends App {
    constructor() {
      super({});
      this.geo = cloneGeo(worldAtlas().geo);
      this.displayGeo = cloneGeo(worldAtlas().displayGeo);
      this.labelGeometry = [];
      this.state = { ...this.state, phase: 'setup', setup: { ...this.state.setup, ...setup } };
      this.ready = true;
    }
    setState(update, callback) {
      const previous = this.state;
      const next = typeof update === 'function' ? update(this.state, this.props) : update;
      if (next) this.state = { ...this.state, ...next };
      if (this.ready) this.componentDidUpdate(this.props, previous);
      callback?.call(this);
    }
    persist() {
      super.persist();
      const status = this.state.saveStatus || {};
      saves.push({ matches: this.state.matches, ok: status.ok, conflict: status.conflict, revision: status.revision,
        message: status.message, size: storage.items.get(SAVE_KEY)?.length ?? 0, used: storage.used(),
        tier: recoveryTier(storage, status.campaignId) });
    }
    fitMap() {}
    after() { return null; }
    drawFrame() {}
    presentMatch() {}
    showPopup() {}
    showToast() {}
  }
  const app = new SavingCampaign();
  const fetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: servePublic });
  try { await app.startCampaign(); } finally {
    if (fetch) Object.defineProperty(globalThis, 'fetch', fetch); else delete globalThis.fetch;
  }
  assert.equal(app.state.phase, 'playing', app.state.saveStatus?.message);
  for (let steps = 0; app.state.aliveIds.length > 1 && steps < 5000; steps++) {
    const st = app.state;
    assert.ok(!st.choice && !st.tacticalChoice && !st.pendingTarget && !st.managerElimination, 'a spectator run has no decisions');
    if (st.match && !st.match.applied) app.finishMatch();
    else if (st.spin) { app.lockDuel(st.spin.key); app.startMatch(st.spin.attackerId, st.spin.targetId, st.spin); }
    else app.nextAction();
  }
  app.clearTimers();
  return { app, saves };
}

const RUNS = {
  'football world': { sport: 'football', layer: 'nations', scope: 'world' },
  'basketball world': { sport: 'basketball', layer: 'nations', scope: 'world' },
  'England domestic': { sport: 'football', layer: 'clubs', clubScope: 'domestic:826' },
};
const played = new Map();
/** Each run is played once per process into its own fresh 5M storage, which later tests may keep using. */
function playedCampaign(name) {
  if (!played.has(name)) {
    const storage = quotaStorage();
    played.set(name, bundleApp().then(App => withStorageAsync(storage, () => savedCampaign(App, storage, {
      pacing: 'blitz', uncertainty: 'balanced', finale: 'single', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic',
      role: 'spectator', managedTeamId: '', seed: '20261002', resolution: 'instant', express: false, ...RUNS[name] })))
      .then(run => ({ ...run, storage })));
  }
  return played.get(name);
}

for (const name of Object.keys(RUNS)) {
  test(`a full ${name} campaign stays under the checkpoint budget and keeps every recovery copy`, async () => {
    const { app, saves, storage } = await playedCampaign(name);
    const st = app.state;
    assert.equal(st.aliveIds.length, 1, 'the campaign reaches a champion');
    assert.equal(st.history.length, Object.keys(st.teams).length - 1);
    assert.ok(saves.length > 3 * st.matches, `${saves.length} autosaves over ${st.matches} matches`);
    saves.forEach((save, i) => {
      const at = `autosave ${i + 1} (match ${save.matches}, ${save.size} code units)`;
      assert.equal(save.ok, true, at);
      assert.equal(save.conflict, undefined, at);
      assert.equal(save.revision, i + 1, at);
      assert.equal(save.message, 'Progress saved', at);
      assert.ok(save.size <= CHECKPOINT_BUDGET, `${at} is over the ${CHECKPOINT_BUDGET} budget`);
      assert.ok(save.used <= 4 * CHECKPOINT_BUDGET + 20_000, `${at}: ${save.used} code units in storage`);
      if (i) assert.equal(save.tier, 'both', `${at} drops a recovery copy`);
    });
    const peak = Math.max(...saves.map(save => save.size));
    if (name === 'football world') {
      assert.ok(saves[0].size < 300_000, `kickoff checkpoint is ${saves[0].size} code units`);
      assert.ok(peak < 650_000, `the football world peak is ${peak} code units`);
    }
    // The UI reads the rebuilt checkpoint: squads with their sources, and the whole history.
    const text = storage.items.get(SAVE_KEY);
    if (st.settings.sport === 'football') assert.equal((text.match(/"sourceInfo":\{/g) || []).length, 0, 'no source is stored inline');
    withStorage(storage, () => {
      const loaded = loadSave();
      assert.equal(loaded.revision, saves.length);
      assert.equal(JSON.stringify(loaded.teams), JSON.stringify(st.teams), 'squads rebuild exactly, key order included');
      assert.equal(JSON.stringify(loaded.history), JSON.stringify(st.history));
    });
  });
}

test('a second finished world campaign saves beside the first, and both keep every recovery copy', async () => {
  const { app, storage } = await playedCampaign('football world');
  withStorage(storage, () => {
    const first = loadSave(), firstBackup = storage.items.get(slotBackupKey(first.campaignId));
    assert.ok(firstBackup, 'the first campaign has its recovery copy');
    const second = forkCampaign(app.state, 'Second world war');
    for (let i = 0; i < 2; i++) {
      const result = writeSave(second);
      assert.equal(result.ok, true, `second campaign save ${i + 1}: ${result.message}`);
      assert.equal(result.message, 'Progress saved');
      Object.assign(second, { campaignId: result.campaignId, revision: result.revision });
    }
    assert.equal(recoveryTier(storage, second.campaignId), 'both');
    assert.equal(storage.items.get(slotBackupKey(first.campaignId)), firstBackup, 'the first campaign keeps its copy');
    assert.equal(loadCampaign(first.campaignId).revision, first.revision);
    assert.ok(storage.used() <= QUOTA, `${storage.used()} code units in use`);
  });
});
