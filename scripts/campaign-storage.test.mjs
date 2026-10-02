import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY } from '../src/config.js';
import { buildTeam, makeRng } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { CAMPAIGN_BACKUP_KEY, CAMPAIGN_DAMAGED_KEY, campaignStorageKey, createCampaignId, parseCampaign, writeSave,
  campaignSnapshot, inspectSave, inspectCampaign, loadSave, loadCampaign, listCampaigns, renameCampaign,
  forkCampaign, clearSave, detectSaveConflict, isCampaignStorageEvent } from '../src/engine/storage.js';

function checkpoint() {
  const rng = makeRng(42), sport = getSport('football');
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, rng, sport)]));
  return { phase: 'playing', settings: { sport: 'football', layer: 'nations', pacing: 'duel', resolution: 'ticker', role: 'manager' },
    teams, own: { 250: '250', 276: '276' }, aliveIds: ['250', '276'], fallen: [], stats: {},
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 42, rngState: rng.getState(),
    followedId: '250', managedTeamId: '250', campaignId: createCampaignId(), revision: 0,
    campaignName: 'France campaign', metrics: { acquisitions: [], leaderChanges: 0 },
    match: null, spin: null, choice: null, series: null, tacticalChoice: null };
}
function withStorage(run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run({ storage, items }); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
function saved(state) { return JSON.stringify(campaignSnapshot(state)); }
function match() { return { aId: '250', dId: '276', winner: '250', finalGa: 2, finalGd: 0, effA: 84, effD: 82,
  ga: 0, gd: 0, allEv: [{ m: 10, tid: '250', name: 'Scorer' }], shown: [], applied: false, done: false }; }

test('strict import rejects invalid state before it can replace the existing checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint();
  assert.equal(writeSave(state).ok, true);
  const good = storage.getItem(SAVE_KEY);
  const variants = [
    [s => { s.queue = [['250', 'missing']]; }, /fixture queue/],
    [s => { s.queue = [['250', '250']]; }, /fixture queue/],
    [s => { s.history = 42; }, /history must be a list/],
    [s => { s.rngState = 'bad'; }, /random state/],
    [s => { s.rngState = null; }, /random state/],
    [s => { s.seed = -1; }, /random state/],
    [s => { s.aliveIds.push('250'); }, /territory/],
    [s => { s.own['276'] = 'missing'; }, /territory/],
    [s => { s.settings.sport = 'tennis'; }, /setting/],
    [s => { s.match = { ...match(), winner: 'missing' }; }, /match is incomplete/],
    [s => { s.match = { ...match(), allEv: [{ m: 2, tid: 'missing' }] }; }, /match is incomplete/],
    [s => { s.spin = { targetId: '276' }; }, /draw references/],
    [s => { s.choice = { candidates: [] }; }, /signing decision/],
    [s => { s.match = match(); s.choice = { candidates: [{ index: 999, name: 'Missing', rating: 82, gain: 0 }] }; }, /candidate/],
    [s => { s.tacticalChoice = { aId: '250', dId: 'missing' }; }, /tactical decision/],
    [s => { s.series = { teamIds: ['250', '276'], wins: { 250: 2, 276: 0 }, games: 1 }; }, /series/],
    [s => { s.phase = 'victory'; }, /one champion/],
  ];
  for (const [mutate, expected] of variants) {
    const invalid = structuredClone(state); mutate(invalid);
    assert.throws(() => parseCampaign(saved(invalid)), expected);
    assert.equal(storage.getItem(SAVE_KEY), good);
  }
}));

test('pending match, signing and manager decisions retain their references on export/import', () => {
  const state = checkpoint(); state.match = match();
  state.choice = { candidates: [{ ...state.teams['276'].squad[0], index: 0, gain: 0.3 }], winnerName: 'France', loserName: 'Germany' };
  assert.equal(parseCampaign(saved(state)).choice.candidates[0].index, 0);
  state.choice = null; state.match = null; state.tacticalChoice = { aId: '250', dId: '276', managerName: 'France', opponentName: 'Germany',
    options: ['attack', 'balanced', 'defend'].map(id => ({ id, label: id, description: 'Approach', strength: 84, bonus: 0, support: 0, drama: 6, baseDrama: 6 })) };
  assert.equal(parseCampaign(saved(state)).tacticalChoice.dId, '276');
});

test('numeric penalty results and player evidence survive a campaign checkpoint', () => withStorage(() => {
  const state = checkpoint();
  const player = state.teams['276'].squad[0];
  const mark = id => ({ name: state.teams[id].name, score: 1, eff: '80.0', id });
  state.history = [{ id: 'match-1', aId: '250', dId: '276', winnerId: '250', a: mark('250'), b: mark('276'),
    events: [], kicks: { a: [1, 0, 1, 1, 1], b: [1, 0, 1, 0] },
    result: { title: 'France wins on penalties', player: { ...player }, strengthBefore: 80, strengthAfter: 81, strengthGain: 1 } }];
  assert.equal(writeSave(state).ok, true, 'the simulator records scored/missed penalties as 1/0');
  assert.deepEqual(loadSave().history[0].kicks, state.history[0].kicks);
  assert.deepEqual(loadSave().history[0].result.player.sourceInfo, player.sourceInfo);
  state.history[0].kicks.a = [true, false];
  assert.deepEqual(parseCampaign(saved(state)).history[0].kicks.a, [true, false], 'legacy boolean kicks remain valid');
  for (const invalid of [2, 'scored', null]) {
    state.history[0].kicks.a = [invalid];
    assert.throws(() => parseCampaign(saved(state)), /match history is incomplete/);
  }
}));

test('damaged current save is retained and offers the last valid checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint(), first = writeSave(state);
  Object.assign(state, first); state.round = 2;
  assert.equal(writeSave(state).ok, true);
  storage.setItem(SAVE_KEY, '{damaged');
  const inspection = inspectSave();
  assert.equal(inspection.state, 'recovery'); assert.equal(inspection.raw, '{damaged');
  assert.equal(inspection.backup.round, 1); assert.match(inspection.message, /previous checkpoint/);
  assert.equal(loadSave(), null); assert.equal(storage.getItem(SAVE_KEY), '{damaged');
  const restored = forkCampaign(inspection.backup, 'Recovered France');
  assert.equal(writeSave(restored).ok, true);
  assert.equal(loadSave().campaignName, 'Recovered France');
  assert.equal(storage.getItem(CAMPAIGN_DAMAGED_KEY), '{damaged', 'damaged bytes survive recovery');
  assert.equal(loadCampaign(state.campaignId).round, 2, 'recovering never overwrites the old slot');
}));

test('missing and unreadable browser storage are distinct from a damaged checkpoint', () => withStorage(({ storage }) => {
  assert.equal(inspectSave().state, 'missing');
  storage.setItem(SAVE_KEY, '{}'); storage.setItem(CAMPAIGN_BACKUP_KEY, '{}');
  assert.equal(inspectSave().state, 'recovery'); assert.equal(inspectSave().backup, null);
  storage.getItem = () => { throw new Error('blocked'); };
  assert.equal(inspectSave().state, 'unavailable');
}));

test('named slots survive starting, renaming, loading and discarding a resume pointer', () => withStorage(() => {
  const first = checkpoint(), second = forkCampaign(first, 'Germany experiment');
  Object.assign(first, writeSave(first));
  Object.assign(second, writeSave(second));
  assert.equal(listCampaigns().length, 2);
  assert.equal(loadCampaign(first.campaignId).campaignName, 'France campaign');
  const renamed = renameCampaign(first.campaignId, 'French comeback');
  assert.equal(renamed.ok, true); assert.equal(renamed.revision, 2);
  assert.equal(loadCampaign(first.campaignId).campaignName, 'French comeback');
  assert.equal(loadCampaign(second.campaignId).campaignName, 'Germany experiment');
  assert.equal(loadSave().campaignId, second.campaignId, 'renaming an inactive run does not switch quick resume');
  assert.equal(clearSave(), true); assert.equal(loadSave(), null);
  assert.equal(listCampaigns().length, 2, 'discarding does not delete named runs');
}));

test('a damaged named slot can recover its own previous checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint(); Object.assign(state, writeSave(state));
  state.round = 3; Object.assign(state, writeSave(state));
  storage.setItem(campaignStorageKey(state.campaignId), '{broken slot');
  const inspection = inspectCampaign(state.campaignId);
  assert.equal(inspection.state, 'recovery'); assert.equal(inspection.raw, '{broken slot');
  assert.equal(inspection.backup.round, 1);
  assert.equal(listCampaigns()[0].damaged, true);
}));

test('two independent tabs cannot overwrite each other and can fork a stale campaign', () => withStorage(({ storage }) => {
  const state = checkpoint(); Object.assign(state, writeSave(state));
  const tabOne = loadCampaign(state.campaignId), tabTwo = loadCampaign(state.campaignId);
  tabOne.round = 7; Object.assign(tabOne, writeSave(tabOne));
  const current = storage.getItem(campaignStorageKey(state.campaignId));
  tabTwo.round = 4;
  const conflict = writeSave(tabTwo);
  assert.equal(conflict.ok, false); assert.equal(conflict.conflict.round, 7);
  assert.equal(storage.getItem(campaignStorageKey(state.campaignId)), current);
  assert.equal(detectSaveConflict(tabTwo).round, 7);
  assert.equal(detectSaveConflict(tabOne), null);
  const fork = forkCampaign(tabTwo, 'My tab'); Object.assign(fork, writeSave(fork));
  assert.notEqual(fork.campaignId, state.campaignId);
  assert.equal(loadCampaign(fork.campaignId).round, 4); assert.equal(loadCampaign(state.campaignId).round, 7);
  assert.equal(isCampaignStorageEvent({ key: campaignStorageKey(state.campaignId) }, state.campaignId), true);
  assert.equal(isCampaignStorageEvent({ key: campaignStorageKey(fork.campaignId) }, state.campaignId), false);
}));

test('version-one saves retain squads/ownership and migrate manager identity safely', () => {
  const state = checkpoint(), legacy = campaignSnapshot(state);
  legacy.v = 1; delete legacy.campaignId; delete legacy.revision; delete legacy.seed; delete legacy.rngState;
  delete legacy.managedTeamId;
  const migrated = parseCampaign(JSON.stringify(legacy));
  assert.equal(migrated.legacy, true); assert.equal(migrated.seed, 1);
  assert.equal(migrated.managedTeamId, '250'); assert.deepEqual(migrated.teams, legacy.teams);
});

test('starting a new campaign archives the old singleton instead of overwriting its only copy', () => withStorage(({ storage }) => {
  const legacy = campaignSnapshot(checkpoint()); legacy.v = 1;
  delete legacy.campaignId; delete legacy.revision;
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const next = checkpoint(); next.campaignName = 'Fresh campaign';
  assert.equal(writeSave(next).ok, true);
  const slots = listCampaigns(); assert.equal(slots.length, 2);
  const archived = loadCampaign(slots.find(item => item.id !== next.campaignId).id);
  assert.deepEqual(archived.own, legacy.own); assert.deepEqual(archived.teams, legacy.teams);
}));
